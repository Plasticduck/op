// The reachability map of a level, computed with the real simulation.
//
//   import { createReach, MODE } from './lib/reach.mjs'
//   const r = createReach(sim, contract, level)          // sim, contract: from loadSim(); opts.hover
//   const g = r.graph(0)                                  // mode 0: grime kept, gates closed, no car roofs, hidden blocks hidden
//   g.reached                                             // Set of node keys Maxx can stand on
//   g.edges.get(key)                                      // [{ from, to, macro, tau, offset, ticks, cost, hover, res }]
//   g.exits, g.touched, g.bumped, g.fatal                 // what each edge reached on the way (see graph())
//   r.routeTo(g, 'goal')                                  // the cheapest fair route, move by move
//   r.windowOf(g, edge)                                   // how many take-off ticks of a jump still work
//   r.play(mode, node, macro, tau, offset, { jumpAt })    // one macro on its own, for a solver
//   r.explore(mode, { ticks })                            // random play on the same world: a second opinion
//
// THE MODEL
//
// A node is a place Maxx can stand at rest: 'area|col|feetY' (feetY in pixels, the top of what
// he stands on; for a tile surface feetY = 32 * the surface tile's row), or 'area|m<slot>|<k>':
// riding the moving platform of level spawn <slot> at the k-th 15-tick bucket of its cycle.
// From each node a fixed set of input macros (MACROS) is played on a copy of a probe world:
// the level with everything harmful removed, everything non-solid removed except pipes, doors
// and the exits, droplets cleared every tick (water washes nothing here: grime is a mode) and
// the clock stopped. The macro ends when Maxx is at rest again (on the ground, not moving,
// two ticks running), falls out, lands in sludge, or runs out of ticks (480). Where he comes
// to rest is an edge with its tick cost; a run that took a hit is no edge.
// What is kept is decided from the data model (Entity.solid, Entity.harmful), not from a list
// of kinds, so kinds added later are handled the same way: a non-harmful solid stays, and one
// that moves on its own (a lift, a washed car on a beat) is timed on its own clock with the
// camera on it, then tried at several phases (6) from the ground within 12 columns of its path.
// One that moves off and is gone for good (a washed car driving out of the level) is left out:
// it is ground for a moment only. Grime a droplet wears in the tick it is fired is put back.
// Targets are everything Maxx touches to take it (onTouch, no onSpray, not harmful, not solid:
// pickups, checkpoints, buttons), tracked tick by tick against his box; the goal and the
// secret exit stay in the world and end a macro the way they end the level.
//
// The hover. Its 42 ticks are a stretch of airtime that runs down from its first tick whether
// down + spray stays held or not (sim/player.ts), so no way of pressing it beats a hold begun
// on the same tick. But a hold begun later than the top of the jump goes further than one
// begun at the top (he keeps his full run until it starts): 10-tile pits instead of 9, and up
// to 12 tiles onto a ledge 4 down (NOTES.md section 5). So the macros hold it from the top (as
// level 2 teaches), from LATE ticks after the top, and tap it (pulsed): a "cannot be reached"
// must hold against any of those players. opts.hover leaves some out: 'off', 'top' (held from
// the top only), 'held' (never tapped), 'all' (the default). The very longest jumps also need
// the last coyote tick and a run-up right to the pixel: the lip sweep (FINE) tries those from
// one place a lip, and what only it finds counts as too tight for a route. With all of it the
// map finds exactly the widest gaps of `sim.mjs --ledges` (tests/reach.mjs pins them).
//
// Routes are cheapest in ticks from rest to rest, plus a little for every jump (8) and a lot
// for a hover (600, 600 more for one begun late, 36000 more for a tapped one) or a jump with a
// take-off window under 4 ticks (3600): so the route walks where walking will do, and a hover
// or a tight jump left on it is one the level needs.
//
// Modes are a bit mask (MODE): grime blocks washed away, gates open (every props.flag in the
// level set to its min when the world is made; a flag-carrying solid that is still a wall
// after that is removed), a washed car parked at every car spawn and spawner, hidden blocks
// already bumped (used). A macro's result is reused across modes when nothing that the modes
// change lies within one tile of anywhere Maxx's box went during it.
//
// Play also changes the level for good: a brick bumped from below is gone, and a button
// touched sets its flag (its gates open, its doors unlock). graph() maps, then maps again from
// every place in a world with the bricks it broke gone and the flags it set set (a variant: the
// mode number's bits 5 and up), until nothing new happens. Every edge keeps the world it was
// found in; needsBricks(edge) and needsFlags(edge) say what it needs done first.
//
// copyWorld(w) is an exact copy of a World (proved in tests/reach.mjs by stepping a copy and
// the original side by side and comparing worldHash every tick, in every level there is).

const AIR = 32
const NOT_TARGETS = new Set(['blower'])
/**
 * Route cost added to a jump and to a hover, so a route walks where walking will do and hovers only
 * when there is no way round worth 10 seconds (so a hover left on a route is one the level needs).
 * Reported times leave it out.
 */
const JUMP_BIAS = 8
const HOVER_BIAS = 600
/** On top of HOVER_BIAS: a hover begun late is a skill nobody is taught, taken only when nothing else gets there within 20 s. */
const LATE_BIAS = 600
/**
 * On top of HOVER_BIAS: a pulsed hover (tapping it). Tapping reaches no place a hold does not
 * (tests/reach.mjs), though from one place it may land where none of the held macros from there
 * do; so a route takes a tapped move only when the map has no held way at all (10 minutes).
 */
const PULSE_BIAS = 36000
/** Route cost added to a jump that works on fewer than TIGHT take-off ticks, so the route takes it only when there is no other way. */
const TIGHT = 4
const TIGHT_BIAS = 3600
const CH = (c) => c.charCodeAt(0)
const G_CODE = CH('g')
const HID_CODES = [CH('H'), CH('h')]
const USED = CH('U')
const BRICK = CH('B')
/**
 * A mode number's bits 5 and up name a set of bricks already broken (see graph()); bit 4 marks, in a
 * macro's `rel`, that it came within a tile of a brick.
 */
const VARIANT_SHIFT = 5
const NEAR_BRICK = 16

export const MODE = { GRIME: 1, GATES: 2, CARS: 4, HIDDEN: 8 }
export const ALL_MODES = 15
const MODE_KEYS = [
  ['grime', MODE.GRIME, 'kept', 'washed'],
  ['gates', MODE.GATES, 'closed', 'open'],
  ['cars', MODE.CARS, 'none', 'roofs'],
  ['hidden', MODE.HIDDEN, 'off', 'on'],
]

/** 'grime kept, gates closed, cars none, hidden off' */
export function modeName(m) {
  return MODE_KEYS.map(([k, bit, off, on]) => `${k} ${m & bit ? on : off}`).join(', ')
}
/** What a mode adds to another: 'grime washed + hidden on', or '' when nothing. */
export function modeDelta(m, base = 0) {
  return MODE_KEYS.filter(([, bit]) => m & bit && !(base & bit)).map(([k, , , on]) => `${k} ${on}`).join(' + ')
}
/**
 * Parse 'grime=washed,hidden=on', 'all', 'none' (also 'grime washed'). Returns a mask or throws.
 * Starts from `base` so 'cars=roofs' adds to whatever was given before.
 */
export function parseMode(text, base = 0) {
  let m = base
  for (const raw of String(text).split(/[,+]/)) {
    const part = raw.trim().toLowerCase()
    if (!part) continue
    if (part === 'all') {
      m = ALL_MODES
      continue
    }
    if (part === 'none' || part === 'base') {
      m = 0
      continue
    }
    const [k, v] = part.split(/[=\s:]+/)
    const row = MODE_KEYS.find(([key]) => key === k)
    if (!row || (v !== row[2] && v !== row[3])) throw new Error(`unknown mode '${raw.trim()}' (use grime=kept|washed, gates=closed|open, cars=none|roofs, hidden=off|on, all)`)
    m = v === row[3] ? m | row[1] : m & ~row[1]
  }
  return m
}

/* ------------------------------------------------------------------ */
/* An exact copy of a World                                            */
/* ------------------------------------------------------------------ */

const copyGrid = (g) => ({ ...g, t: g.t.slice(), d: g.d.slice() })

/**
 * A deep copy of everything in a World that the simulation writes, sharing what it never
 * writes (the LevelDef, area defs, spawn lists, entity props, the input frame, event objects).
 * Aliases inside the world are kept: w.grid and w.entities stay the current area's own, and
 * w.solids / w.actives point at the copied entities.
 */
export function copyWorld(src) {
  const entMap = new Map()
  const ent = (e) => {
    let c = entMap.get(e)
    if (!c) {
      c = { ...e, vars: { ...e.vars } }
      entMap.set(e, c)
    }
    return c
  }
  const gridMap = new Map()
  const listMap = new Map()
  const areas = {}
  for (const id of Object.keys(src.areas)) {
    const a = src.areas[id]
    const grid = copyGrid(a.grid)
    gridMap.set(a.grid, grid)
    const list = a.entities ? a.entities.map(ent) : null
    if (a.entities) listMap.set(a.entities, list)
    areas[id] = { ...a, grid, entities: list }
  }
  const w = {}
  for (const key of Object.keys(src)) {
    const v = src[key]
    switch (key) {
      case 'level':
      case 'area':
      case 'input':
        w[key] = v
        break
      case 'areas':
        w.areas = areas
        break
      case 'grid':
        w.grid = gridMap.get(v) ?? copyGrid(v)
        break
      case 'entities':
        w.entities = listMap.get(v) ?? v.map(ent)
        break
      case 'solids':
      case 'actives':
        w[key] = v.map(ent)
        break
      case 'player':
      case 'camera':
      case 'session':
      case 'flags':
      case 'sfxAt':
        w[key] = { ...v }
        break
      case 'checkpoint':
      case 'boss':
      case 'warp':
      case 'camBounds':
        w[key] = v ? { ...v } : null
        break
      case 'stats':
        w.stats = { ...v, tokens: [...v.tokens] }
        break
      case 'droplets':
      case 'bumps':
        w[key] = v.map((o) => ({ ...o }))
        break
      case 'events':
        w.events = v.slice()
        break
      default:
        // A field added to World after this was written: copied whole, so the copy stays exact.
        w[key] = v !== null && typeof v === 'object' ? structuredClone(v) : v
    }
  }
  return w
}

/* ------------------------------------------------------------------ */
/* Input frames                                                        */
/* ------------------------------------------------------------------ */

const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'spray', 'confirm', 'cancel', 'pause', 'select']
const A = { left: 1, right: 2, up: 4, down: 8, jump: 16, spray: 32 }
const frameCache = new Map()
/** The InputFrame for holding `mask` after `prev` (pressed and released follow), axisX from left/right unless given. Never written by the simulation, so shared. */
function frameFor(prev, mask, axisX) {
  const key = prev * 64 + mask + (axisX === undefined ? 0 : 4096 * (axisX + 2))
  let f = frameCache.get(key)
  if (f) return f
  const held = {}
  const pressed = {}
  const released = {}
  for (const a of ACTIONS) {
    const bit = A[a] ?? 0
    held[a] = bit !== 0 && (mask & bit) !== 0
    pressed[a] = bit !== 0 && (mask & bit) !== 0 && (prev & bit) === 0
    released[a] = bit !== 0 && (mask & bit) === 0 && (prev & bit) !== 0
  }
  f = {
    held,
    pressed,
    released,
    repeat: pressed,
    axisX: axisX ?? (mask & A.right ? 1 : 0) - (mask & A.left ? 1 : 0),
    axisY: (mask & A.down ? 1 : 0) - (mask & A.up ? 1 : 0),
    device: 'keyboard',
  }
  frameCache.set(key, f)
  return f
}

/* ------------------------------------------------------------------ */
/* Macros                                                              */
/* ------------------------------------------------------------------ */

// ground  'step' (until his middle crosses into the next column), 'run' (until he leaves the
//         ground, meets a wall, or `limit` ticks, 150), 'walk' (the stick half over), 'stand' (jump on
//         the first tick), 'runup' (run `run` ticks, then jump), 'edge' (run to the lip of the
//         ledge or to the wall, jump there), 'pipe' (hold down), 'door' (push up)
// hold    ticks the jump button is held
// air     what the stick does while he is in the air: 'hold' the direction, 'none', 'late'
//         (nothing until the top, then the direction), 'turn' (the direction, then back the
//         other way from the top), 'stop' (the direction until the top, then let go)
// hover   false; true: hold down + spray from the top of the jump (once he is falling) to the
//         landing; a number n: the same hold begun n ticks after the top (a late hover);
//         'pulse': down + spray for one tick whenever his fall speed passes PULSE_VY (tapping it).
// coyote  with ground 'edge': run off the lip and press jump on the last tick a jump off the
//         ledge is still allowed (the coyote time), the furthest take-off there is.
// onlyIfAirborne  play it only if that macro (played first) left the ground: a run that never
//         runs off a ledge has no air to hover in.
// onlyIfLip  play it only if that 'edge' macro found a lip (not a wall).
// onlyIfFalls  [macro, n]: play it only if that macro's flight fell for more than n ticks; a
//         hover begun later than the landing is no hover, so the flight is that macro's own.
// fine    one of the lip sweep's (FINE): played only there, with the run-up shifted by pixels.

/** A late hover is begun this many ticks after the top of the jump. On flat ground 14 goes furthest; lower landings want later starts. */
export const LATE = [6, 12, 18, 24]
/**
 * The lip sweep. The longest jumps (NOTES.md section 5: 11 tiles onto a ledge 1 down, 12 onto
 * one 4 down) work only from the last coyote tick, with the hover begun within a tick or two of
 * one moment, and from a run-up whose start is right to the pixel (where he is between ticks as
 * he reaches the lip). The macros above try one run-up a column, so from one place a lip (the
 * column where a run to it takes FINE.from..FINE.to ticks) the sweep tries these too: run-ups
 * moved 0..3 px back (a tick of running is 3.6 px) times the hover begun every other tick from
 * the top to 26 after it. What it alone finds is pixel-exact: a route treats it as too tight.
 */
export const FINE = { late: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26], shifts: [0, 1, 2, 3], from: 16, to: 26 }

function makeMacros(late) {
  const list = []
  for (const d of [1, -1]) {
    const s = d > 0 ? 'right' : 'left'
    const m = (id, o) => list.push({ id: `${id}-${s}`, d, hold: 0, air: 'hold', hover: false, ...o })
    m('step', { ground: 'step', air: 'none' })
    m('step-on', { ground: 'step', air: 'hold', onlyIfAirborne: `step-${s}` })
    m('run', { ground: 'run' })
    m('run-off', { ground: 'run', air: 'none', onlyIfAirborne: `run-${s}` })
    m('dash', { ground: 'run', limit: 45 })
    m('walk', { ground: 'walk', air: 'none' })
    m('hop', { ground: 'stand', hold: 1 })
    m('jump8', { ground: 'stand', hold: 8 })
    m('jump', { ground: 'stand', hold: 40 })
    m('jump-stop', { ground: 'stand', hold: 40, air: 'stop' })
    m('jump-turn', { ground: 'stand', hold: 40, air: 'turn' })
    m('jump-hover', { ground: 'stand', hold: 40, hover: true })
    m('up-then', { ground: 'stand', hold: 40, air: 'late' })
    m('runjump', { ground: 'runup', run: 12, hold: 40 })
    m('runjump8', { ground: 'runup', run: 12, hold: 8 })
    m('runjump-hover', { ground: 'runup', run: 12, hold: 40, hover: true })
    m('edge', { ground: 'edge', hold: 40 })
    m('edge8', { ground: 'edge', hold: 8 })
    m('edge-hover', { ground: 'edge', hold: 40, hover: true })
    m('coyote', { ground: 'edge', coyote: true, hold: 40, onlyIfLip: `edge-${s}` })
    m('coyote-hover', { ground: 'edge', coyote: true, hold: 40, hover: true, onlyIfLip: `edge-${s}` })
    m('run-hover', { ground: 'run', hover: true, onlyIfAirborne: `run-${s}` })
    for (const n of late) {
      m(`jump-late${n}`, { ground: 'stand', hold: 40, hover: n, onlyIfFalls: [`jump-${s}`, n] })
      m(`runjump-late${n}`, { ground: 'runup', run: 12, hold: 40, hover: n, onlyIfFalls: [`runjump-${s}`, n] })
      m(`edge-late${n}`, { ground: 'edge', hold: 40, hover: n, onlyIfFalls: [`edge-${s}`, n] })
      m(`coyote-late${n}`, { ground: 'edge', coyote: true, hold: 40, hover: n, onlyIfFalls: [`coyote-${s}`, n] })
      m(`run-late${n}`, { ground: 'run', hover: n, onlyIfFalls: [`run-${s}`, n] })
    }
    m('jump-pulse', { ground: 'stand', hold: 40, hover: 'pulse' })
    m('runjump-pulse', { ground: 'runup', run: 12, hold: 40, hover: 'pulse' })
    m('edge-pulse', { ground: 'edge', hold: 40, hover: 'pulse' })
    m('run-pulse', { ground: 'run', hover: 'pulse', onlyIfAirborne: `run-${s}` })
  }
  list.push({ id: 'up', d: 0, ground: 'stand', hold: 40, air: 'none', hover: false })
  list.push({ id: 'up-hop', d: 0, ground: 'stand', hold: 1, air: 'none', hover: false })
  return list
}
/** The lip sweep's macros, both ways: the coyote take-off without the hover, with it from the top, and begun FINE.late ticks after. */
function makeFine() {
  const list = []
  for (const d of [1, -1]) {
    const s = d > 0 ? 'right' : 'left'
    const m = (id, hover) => list.push({ id: `fine-${id}-${s}`, d, ground: 'edge', coyote: true, hold: 40, air: 'hold', hover, fine: true })
    m('plain', false)
    m('hover', true)
    for (const n of FINE.late) m(`late${n}`, n)
  }
  return list
}
const BASE_MACROS = makeMacros(LATE)
const FINE_MACROS = makeFine()
/** A pulsed hover fires one hover tick whenever the fall speed is over this (the best of 45..420 for distance). */
export const PULSE_VY = 80
/**
 * Whether a macro holds down + spray on this tick (he is in the air). `fall`: the ticks he has
 * fallen so far in this flight (FALL.next), which places a late hover's start.
 */
export function wantsHover(macro, p, fall = 0) {
  if (!macro.hover || p.onGround) return false
  if (macro.hover === 'pulse') return p.vy > PULSE_VY
  if (macro.hover === true) return p.vy > 0
  return fall > macro.hover
}
/** The fall counter for wantsHover, stepped once after every tick: ticks going down since the top (0 on the ground or rising). */
export const FALL = { next: (fall, p) => (p.onGround || p.vy <= 0 ? 0 : fall + 1) }
/** Which hover macros each hover setting keeps. */
const HOVER_SETS = {
  off: (m) => !m.hover,
  top: (m) => m.hover === false || m.hover === true,
  held: (m) => m.hover !== 'pulse',
  all: () => true,
}
export const HOVER_NAMES = {
  off: 'without the hover',
  top: 'the hover held from the top of the jump only',
  held: 'the hover held, from the top or begun late, never tapped',
  all: 'every hover: held, begun late, tapped',
}
const PIPE_MACRO = { id: 'pipe', d: 0, ground: 'pipe', hold: 0, air: 'none', hover: false }
const DOOR_MACRO = { id: 'door', d: 0, ground: 'door', hold: 0, air: 'none', hover: false }
export const MACROS = [...BASE_MACROS, PIPE_MACRO, DOOR_MACRO]
const MACRO_BY_ID = new Map([...MACROS, ...FINE_MACROS].map((m) => [m.id, m]))

/** Words for a macro, for people. */
export function describeMacro(m) {
  const s = m.d > 0 ? 'right' : m.d < 0 ? 'left' : ''
  const held = m.hold >= 40 ? 'full' : m.hold <= 1 ? 'tap' : `${m.hold} ticks held`
  const hover = m.hover === 'pulse' ? ' + pulsed hover' : typeof m.hover === 'number' ? ` + hover begun ${m.hover} ticks after the top` : m.hover ? ' + hover' : ''
  const extra = hover + (m.air === 'stop' ? ', let go at the top' : m.air === 'turn' ? ', turn back at the top' : '')
  switch (m.ground) {
    case 'step':
      return `step ${s}${m.air === 'hold' ? ' (keep pushing in the air)' : ''}`
    case 'run':
      if (m.hover) return `run ${s} off the ledge${extra}`
      return m.air === 'none' ? `run ${s}, let go in the air` : m.limit ? `run ${s} for ${m.limit} ticks` : `run ${s}`
    case 'walk':
      return `walk ${s} (stick half over)`
    case 'stand':
      if (!m.d) return m.hold <= 1 ? 'hop straight up' : 'jump straight up'
      if (m.air === 'late') return `jump straight up, then ${s} from the top`
      return `${m.hold <= 1 ? 'hop' : 'jump'} ${s} from a stand (${held})${extra}`
    case 'runup':
      return `running jump ${s} after ${m.run} ticks of run (${held})${extra}`
    case 'edge':
      if (m.coyote) return `run ${s} off the lip and jump on the last tick it still counts (${held})${extra}`
      return `run ${s} and jump at the lip (${held})${extra}`
    case 'pipe':
      return 'down the pipe'
    case 'door':
      return 'up through the door'
    case 'ride':
      return 'ride'
  }
  return m.id
}

/* ------------------------------------------------------------------ */
/* The level, made playable for probing                                */
/* ------------------------------------------------------------------ */

/** Build a World for the level with every area's entities made, exactly as entering each would (sim.buildArea). */
export function buildWorld(sim, level, worldOpts = {}) {
  const w = sim.createWorld(level, { session: { lives: 3, score: 0, coins: 0, pips: 3, turbo: false }, seed: 1, ...worldOpts })
  for (const def of level.areas) if (w.areas[def.id]) sim.buildArea(w, def.id)
  return w
}

/** Every flag any spawn of the level asks for (props.flag with props.min / props.value), at the level that opens it. */
export function openingFlags(level) {
  const flags = {}
  for (const def of level.areas) {
    for (const spec of Object.values(def.legend ?? {})) {
      const f = spec?.props?.flag
      if (typeof f !== 'string' || f === '') continue
      const min = [spec.props.min, spec.props.value].find((v) => typeof v === 'number') ?? 1
      flags[f] = Math.max(flags[f] ?? 0, min)
    }
  }
  return flags
}

/* ------------------------------------------------------------------ */
/* The solver                                                          */
/* ------------------------------------------------------------------ */

/**
 * opts: bucket (ticks per lift node, 15), phases (lift phases tried from nearby ground, 6),
 * moverRange (columns from a lift's path within which ground nodes try every phase, 12),
 * hover ('all', 'held', 'top' or 'off': which hover macros it plays, see HOVER_NAMES; the old
 * noHover and noPulse are 'off' and 'held'), late (the late hover's starts, LATE).
 */
export function createReach(sim, contract, level, opts = {}) {
  const { TILE, MAXX_W, MAXX_H, VIEW_W, VIEW_H } = contract
  const T = sim.TUNING
  const BUCKET = opts.bucket ?? 15
  const PHASES = opts.phases ?? 6
  const MOVER_RANGE = opts.moverRange ?? 12
  const hover = opts.hover ?? (opts.noHover ? 'off' : opts.noPulse ? 'held' : 'all')
  if (!HOVER_SETS[hover]) throw new Error(`hover '${hover}': use ${Object.keys(HOVER_SETS).join(', ')}`)
  const LATE_SET = opts.late ?? LATE
  const OWN_MACROS = opts.late ? makeMacros(opts.late) : BASE_MACROS
  const MACRO_SET = OWN_MACROS.filter(HOVER_SETS[hover])
  const FINE_SET = opts.fine === false ? [] : FINE_MACROS.filter(HOVER_SETS[hover])
  const macroById = opts.late ? new Map([...OWN_MACROS, ...FINE_MACROS, PIPE_MACRO, DOOR_MACRO].map((m) => [m.id, m])) : MACRO_BY_ID
  const areaIds = []
  for (const def of level.areas) if (!areaIds.includes(def.id)) areaIds.push(def.id)
  const stats = { runs: 0, ticks: 0, reused: 0, ms: 0 }

  /* ---- static facts about each area (mode 0, nothing removed) ---- */
  const full = buildWorld(sim, level)
  const template = { ...full.player }
  const areaInfo = new Map()
  const targets = []
  for (const id of areaIds) {
    const st = full.areas[id]
    const g = st.grid
    const info = { id, w: g.w, h: g.h, grid: g, targets: [], buckets: [], blocks: [], features: null, movers: null, pipes: [], doors: [], exits: [], carBoxes: [], gateBoxes: [] }
    for (let i = 0; i < g.w; i++) info.buckets.push([])
    for (const e of st.entities) {
      const beh = sim.getBehavior(e.kind)
      if (!beh || e.slot < 0) continue
      const sp = st.spawns[e.slot]
      const base = { area: id, slot: e.slot, kind: e.kind, variant: e.variant, x: e.x, y: e.y, w: e.w, h: e.h, tx: sp.tx, ty: sp.ty, token: e.kind === 'token' ? e.vars.token : -1 }
      if (e.kind === 'pipe') info.pipes.push({ ...base, to: e.props.to, name: e.props.name })
      if (e.kind === 'door') info.doors.push({ ...base, to: e.props.to, name: e.props.name, flag: e.props.flag })
      if (e.kind === 'goal' || e.kind === 'secretExit') info.exits.push(base)
      if (e.kind === 'car' || e.kind === 'spawner') info.carBoxes.push(base)
      const gate = { ...base, flag: e.props.flag, min: typeof e.props.min === 'number' ? e.props.min : 1 }
      if (e.solid !== 'none' && typeof e.props.flag === 'string') info.gateBoxes.push(gate)
      if (e.kind === 'door' && typeof e.props.flag === 'string') info.gateBoxes.push(gate)
      // Something Maxx collects or sets off by touching it: a pickup, a checkpoint, a button. Things that take
      // water are critters and hazards, even the ones harmless at rest (an icicle); a blower is a wind zone.
      const touch = beh.onTouch && !beh.onSpray && !e.harmful && e.solid === 'none' && e.w > 0 && e.h > 0 && !NOT_TARGETS.has(e.kind)
      const kind = e.kind === 'goal' ? 'goal' : e.kind === 'secretExit' ? 'secret' : e.kind === 'pipe' || e.kind === 'door' ? e.kind : touch ? 'touch' : null
      if (!kind) continue
      const t = { ...base, id: targets.length, type: kind }
      // Something touched that sets a flag (a button): the map opens that flag's gates once it is touched.
      if (kind === 'touch' && typeof e.props.flag === 'string' && e.props.flag) t.sets = { flag: e.props.flag, value: typeof e.props.value === 'number' ? e.props.value : 1 }
      targets.push(t)
      info.targets.push(t)
      if (kind === 'touch') {
        const c0 = Math.max(0, Math.floor(e.x / TILE))
        const c1 = Math.min(g.w - 1, Math.floor((e.x + e.w - 0.001) / TILE))
        for (let c = c0; c <= c1; c++) info.buckets[c].push(t)
      }
    }
    info.grime = []
    for (let ty = 0; ty < g.h; ty++) {
      for (let tx = 0; tx < g.w; tx++) {
        const code = g.t[ty * g.w + tx]
        const ti = sim.TILE_BY_CODE[code]
        if (ti && (ti.bumpable || ti.hidden)) info.blocks.push({ area: id, tx, ty, ch: ti.ch, i: ty * g.w + tx, id: `${id}@${tx},${ty}` })
        if (code === G_CODE) info.grime.push(ty * g.w + tx)
      }
    }
    info.features = featureMap(info)
    areaInfo.set(id, info)
  }
  const openFlags = openingFlags(level)

  /** Per area, one prefix-sum table per mode bit: which cells hold something a mode changes. */
  function featureMap(info) {
    const { w, h, grid } = info
    const cells = new Uint8Array(w * h)
    const mark = (bit, x, y, bw, bh) => {
      const c0 = Math.max(0, Math.floor(x / TILE))
      const c1 = Math.min(w - 1, Math.floor((x + bw - 0.001) / TILE))
      const r0 = Math.max(0, Math.floor(y / TILE))
      const r1 = Math.min(h - 1, Math.floor((y + bh - 0.001) / TILE))
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * w + c] |= bit
    }
    for (let i = 0; i < w * h; i++) {
      if (grid.t[i] === G_CODE) cells[i] |= MODE.GRIME
      if (HID_CODES.includes(grid.t[i])) cells[i] |= MODE.HIDDEN
      if (grid.t[i] === BRICK) cells[i] |= NEAR_BRICK
    }
    for (const b of info.gateBoxes) mark(MODE.GATES, b.x, b.y, b.w, b.h)
    for (const b of info.carBoxes) {
      const size = T.cars[b.variant] ?? T.cars.compact
      mark(MODE.CARS, sim.tileFeetX(b.tx) - size.w / 2, sim.tileFeetY(b.ty) - size.h, size.w, size.h)
    }
    const sums = []
    for (const bit of [...MODE_KEYS.map((k) => k[1]), NEAR_BRICK]) {
      const s = new Int32Array((w + 1) * (h + 1))
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          s[(r + 1) * (w + 1) + c + 1] = (cells[r * w + c] & bit ? 1 : 0) + s[r * (w + 1) + c + 1] + s[(r + 1) * (w + 1) + c] - s[r * (w + 1) + c]
        }
      }
      sums.push([bit, s])
    }
    return sums
  }
  /** Mode bits with something inside the box of cells (inclusive), grown by one cell. */
  function bitsIn(info, c0, c1, r0, r1) {
    const { w, h } = info
    c0 = Math.max(0, c0 - 1)
    r0 = Math.max(0, r0 - 1)
    c1 = Math.min(w - 1, c1 + 1)
    r1 = Math.min(h - 1, r1 + 1)
    if (c0 > c1 || r0 > r1) return 0
    let bits = 0
    for (const [bit, s] of info.features) {
      const n = s[(r1 + 1) * (w + 1) + c1 + 1] - s[r0 * (w + 1) + c1 + 1] - s[(r1 + 1) * (w + 1) + c0] + s[r0 * (w + 1) + c0]
      if (n > 0) bits |= bit
    }
    return bits
  }

  /* ---- probe worlds, one per mode ---- */
  const bases = new Map()
  function keepInProbe(e, flags) {
    if (e.kind === 'pipe' || e.kind === 'door' || e.kind === 'goal' || e.kind === 'secretExit') return true
    if (e.solid === 'none' || e.harmful) return false
    // A gate whose flag the world was made with is open from its init (its drum is not solid). One
    // that is still a wall does not read flags at init: gone.
    if (typeof e.props.flag === 'string' && e.solid === 'full' && (flags[e.props.flag] ?? 0) >= (typeof e.props.min === 'number' ? e.props.min : 1)) return false
    return true
  }
  /*
   * ---- variants of a mode: what play has changed for good ----
   * Bricks broken by a head bump stay broken, and a flag set by touching something (a button)
   * stays set. A mode number's bits 5 and up name such a variant (see graph()).
   */
  const variants = [{ bricks: [], flags: {} }]
  const variantIndex = new Map([['|', 0]])
  /** The mode number for `mode` with these bricks ('area@tx,ty') broken and these flags set. */
  function withVariant(mode, bricks, flags) {
    const list = [...bricks].sort()
    const fl = Object.fromEntries(Object.entries(flags).sort(([a], [b]) => (a < b ? -1 : 1)))
    const key = `${list.join(';')}|${JSON.stringify(fl)}`
    let i = variantIndex.get(key)
    if (i === undefined) {
      i = variants.length
      variants.push({ bricks: list, flags: fl })
      variantIndex.set(key, i)
    }
    return (mode & 15) | (i << VARIANT_SHIFT)
  }
  const variantOf = (mode) => variants[mode >>> VARIANT_SHIFT] ?? variants[0]
  const brokenIn = (mode) => variantOf(mode).bricks
  const inBox = (edge, area, tx, ty) => {
    const b = edge.res?.box?.find((x) => x[0] === area)
    return !!b && tx >= b[1] - 1 && tx <= b[2] + 1 && ty >= b[3] - 1 && ty <= b[4] + 1
  }
  /** The bricks a move needs broken: those of its world that lie within a tile of where Maxx went. */
  function needsBricks(edge) {
    return brokenIn(edge.mode ?? 0).filter((id) => {
      const [area, at] = id.split('@')
      const [tx, ty] = at.split(',').map(Number)
      return inBox(edge, area, tx, ty)
    })
  }
  /**
   * The flags a move needs set in play (a button pressed): those its world was made with that open
   * a gate or locked door it went within a tile of. [{ flag, min, what }]
   */
  function needsFlags(edge) {
    const flags = variantOf(edge.mode ?? 0).flags
    if (!Object.keys(flags).length || !edge.res?.box) return []
    const out = []
    for (const [area] of edge.res.box) {
      for (const gb of areaInfo.get(area).gateBoxes) {
        if (!(gb.flag in flags) || out.some((o) => o.flag === gb.flag)) continue
        const c0 = Math.floor(gb.x / TILE)
        const c1 = Math.floor((gb.x + gb.w - 0.01) / TILE)
        const r0 = Math.floor(gb.y / TILE)
        const r1 = Math.floor((gb.y + gb.h - 0.01) / TILE)
        let near = false
        for (let c = c0; c <= c1 && !near; c++) for (let r = r0; r <= r1 && !near; r++) near = inBox(edge, area, c, r)
        if (near) out.push({ flag: gb.flag, min: gb.min, what: `the ${gb.kind} at ${area} ${gb.tx},${gb.ty}` })
      }
    }
    return out
  }

  /** The probe world of a mode, one copy per area. `raw`: with every platform in it, for timing them (movers()). */
  function base(mode, raw = false) {
    const key = raw ? `raw${mode}` : mode
    let b = bases.get(key)
    if (b) return b
    const flags = { ...(mode & MODE.GATES ? openFlags : {}) }
    for (const [f, v] of Object.entries(variantOf(mode).flags)) flags[f] = Math.max(flags[f] ?? 0, v)
    const w = buildWorld(sim, level, { flags })
    const broken = new Set(brokenIn(mode))
    for (const id of areaIds) {
      const st = w.areas[id]
      const g = st.grid
      for (let i = 0; i < g.t.length; i++) {
        if (mode & MODE.GRIME && g.t[i] === G_CODE) {
          g.t[i] = AIR
          g.d[i] = 0
        }
        if (mode & MODE.HIDDEN && HID_CODES.includes(g.t[i])) g.t[i] = USED
        if (g.t[i] === BRICK && broken.size && broken.has(`${id}@${i % g.w},${Math.floor(i / g.w)}`)) g.t[i] = AIR
      }
      const list = st.entities
      // A platform that moves off for good (a washed car driving away) is ground for a moment only: left out.
      const gone = raw ? null : movers(id).gone
      let k = 0
      for (const e of list) if (keepInProbe(e, flags) && !gone?.has(e.slot)) list[k++] = e
      list.length = k
      if (mode & MODE.CARS) {
        const keep = { area: w.area, grid: w.grid, entities: w.entities }
        w.area = st.def
        w.grid = st.grid
        w.entities = st.entities
        for (const c of areaInfo.get(id).carBoxes) {
          const sp = st.spawns[c.slot]
          const variant = c.kind === 'car' ? sp.spec.variant : String(sp.spec.props?.variants ?? sp.spec.props?.variant ?? 'compact').split(',')[0].trim()
          const car = sim.makeEntity(w, 'car', sim.tileFeetX(c.tx), sim.tileFeetY(c.ty), variant, { clean: true, speed: 0, bonus: true }, -1, c.slot)
          if (car) st.entities.push(car)
        }
        w.area = keep.area
        w.grid = keep.grid
        w.entities = keep.entities
      }
    }
    w.timeLeft = 1e9
    w.events.length = 0
    // One world per area, already switched to it, for copying.
    const per = new Map()
    for (const id of areaIds) {
      const c = copyWorld(w)
      setArea(c, id)
      per.set(id, c)
    }
    b = { mode, per }
    bases.set(key, b)
    return b
  }
  function setArea(w, id) {
    const st = w.areas[id]
    w.area = st.def
    w.grid = st.grid
    w.entities = st.entities
    w.solids.length = 0
    w.actives.length = 0
    w.droplets.length = 0
    w.bumps.length = 0
    w.camBounds = null
  }

  /* ---- things that move on their own and can be stood on (lifts) ---- */
  function movers(areaId) {
    const info = areaInfo.get(areaId)
    if (info.movers) return info.movers
    const from = base(0, true).per.get(areaId)
    const slots = from.entities.filter((e) => e.solid !== 'none' && e.slot >= 0).map((e) => e.slot)
    const gone = new Set()
    const idle = frameFor(0, 0)
    const LIMIT = 3600
    const list = []
    const timeline = []
    // Each solid thing on its own clock, with the camera on it (a ghost Maxx follows it, far
    // overhead and out of play), so one that sleeps away from the camera runs as it does when
    // Maxx is near it.
    for (const slot of slots) {
      const w = copyWorld(from)
      const e = w.entities.find((x) => x.slot === slot)
      const ghost = w.player
      Object.assign(ghost, template, { y: -1e6, state: 'warp' })
      const start = sig(e)
      const states = []
      let moved = false
      let period = 0
      let still = { s: '', n: 0 }
      for (let t = 0; t <= LIMIT; t++) {
        if (t % BUCKET === 0) {
          states.push({ ...e, vars: { ...e.vars } })
          if (t >= 240 && !moved) break
          if (period && t >= period + BUCKET) break
        }
        ghost.x = e.x + e.w / 2 - MAXX_W / 2
        ghost.y = -1e6
        ghost.vy = 0
        sim.stepWorld(w, idle)
        w.events.length = 0
        if (e.dead) break
        const s = sig(e)
        if (Math.abs(e.x - e.spawnX) > 0.5 || Math.abs(e.y - e.spawnY) > 0.5) moved = true
        if (!moved || period) continue
        if (s === start) period = t + 1
        // Something that moved once and then stopped for good (it fell onto the floor) is no lift.
        if (still.s === s) {
          if (++still.n >= 240) {
            moved = false
            break
          }
        } else still = { s, n: 0 }
      }
      if (moved && e.dead) gone.add(slot)
      if (!moved || e.dead) continue
      const p = period || LIMIT
      states.forEach((s, k) => {
        if (!timeline[k]) timeline[k] = new Map()
        timeline[k].set(slot, s)
      })
      const x0 = Math.min(...states.map((s) => s.x))
      const x1 = Math.max(...states.map((s) => s.x + s.w))
      const y0 = Math.min(...states.map((s) => s.y))
      const y1 = Math.max(...states.map((s) => s.y + s.h))
      // c0..c1 and the pixel box x0..x1, y0..y1: everywhere the platform goes.
      list.push({ slot, kind: e.kind, period: p, buckets: Math.max(1, Math.round(p / BUCKET)), c0: Math.floor(x0 / TILE), c1: Math.floor(x1 / TILE), x0, x1, y0, y1, w: e.w, h: e.h })
    }
    // A mover whose own timeline is shorter than another's keeps going round it.
    for (const m of list) {
      const own = Math.round(m.period / BUCKET)
      for (let k = 0; k < timeline.length; k++) {
        if (!timeline[k]) timeline[k] = new Map()
        if (!timeline[k].has(m.slot) && own > 0) timeline[k].set(m.slot, timeline[k % own]?.get(m.slot))
      }
    }
    const maxPeriod = list.length ? Math.max(...list.map((m) => m.period)) : 0
    info.movers = { list, timeline, maxPeriod, gone }
    return info.movers
    function sig(e) {
      // Rounded: a car's speed in pixels a tick is not a whole number, so its path never repeats to the bit.
      return `${Math.round(e.x)},${Math.round(e.y)},${e.facing},${e.state},${JSON.stringify(e.vars)}`
    }
  }
  /** A probe world for an area at global time tau (lifts where the timeline had them). */
  function probeWorld(mode, areaId, tau) {
    const w = copyWorld(base(mode).per.get(areaId))
    if (tau > 0) {
      const mv = movers(areaId)
      const snap = mv.timeline[Math.round(tau / BUCKET)]
      if (snap) {
        for (const e of w.entities) {
          const s = e.slot >= 0 ? snap.get(e.slot) : null
          if (s && s.kind === e.kind) Object.assign(e, s, { vars: { ...s.vars }, id: e.id, active: true })
        }
      }
    }
    return w
  }

  /* ---- nodes ---- */
  const nodes = new Map()
  function tileNode(area, col, feetY, restX) {
    const key = `${area}|${col}|${feetY}`
    let n = nodes.get(key)
    if (!n) {
      n = { key, kind: 'tile', area, col, feetY, row: feetY % TILE === 0 ? feetY / TILE - 1 : null, x: sim.tileFeetX(col) - MAXX_W / 2, altX: restX, place: new Map() }
      nodes.set(key, n)
    }
    return n
  }
  function moverNode(area, slot, k) {
    const key = `${area}|m${slot}|${k}`
    let n = nodes.get(key)
    if (!n) {
      const mvs = movers(area)
      const mv = mvs.list.find((m) => m.slot === slot)
      const at = mvs.timeline[k]?.get(slot)
      const col = at ? Math.floor((at.x + at.w / 2) / TILE) : mv ? Math.round((mv.c0 + mv.c1) / 2) : 0
      n = { key, kind: 'mover', area, slot, k, mover: mv, col, feetY: at ? at.y : null, row: null, place: new Map() }
      nodes.set(key, n)
    }
    return n
  }

  const boxInSolid = (w, x, y, bw, bh) => {
    const c0 = Math.floor((x + 0.01) / TILE)
    const c1 = Math.floor((x + bw - 0.01) / TILE)
    const r0 = Math.floor((y + 0.01) / TILE)
    const r1 = Math.floor((y + bh - 0.01) / TILE)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (sim.tileInfoAt(w, c, r).solid) return true
    return false
  }

  function snapCamera(w) {
    const p = w.player
    const c = w.camera
    w.camLook = p.facing * T.camLookAhead
    const maxX = w.grid.w * TILE - VIEW_W
    c.x = maxX <= 0 ? maxX / 2 : Math.max(0, Math.min(maxX, p.x + p.w / 2 + w.camLook - VIEW_W / 2))
    const maxY = w.grid.h * TILE - VIEW_H
    c.y = maxY <= TILE ? maxY : Math.max(0, Math.min(maxY, p.y + p.h - T.camBottom))
  }

  const IDLE = frameFor(0, 0)
  /** Put Maxx at rest at a node in a fresh probe world. Returns the world (time already past the settling ticks) or null. */
  function place(mode, node, tau, offset, facing) {
    const w = probeWorld(mode, node.area, tau)
    const p = w.player
    Object.assign(p, template)
    let x
    let feetY
    let mover = null
    if (node.kind === 'mover') {
      mover = w.entities.find((e) => e.slot === node.slot && !e.dead)
      if (!mover) return null
      const room = mover.w - MAXX_W
      x = mover.x + (offset === 'left' ? Math.min(2, room / 2) : offset === 'right' ? Math.max(room / 2, room - 2) : room / 2)
      feetY = mover.y
    } else {
      x = offset === 'alt' ? node.altX : node.x + (typeof offset === 'number' ? offset : 0)
      feetY = node.feetY
    }
    if (x < 0 || x + MAXX_W > w.grid.w * TILE) return null
    p.x = x
    p.y = feetY - MAXX_H
    p.px = p.x
    p.py = p.y
    p.facing = facing >= 0 ? 1 : -1
    if (boxInSolid(w, p.x, p.y, MAXX_W, MAXX_H)) return null
    snapCamera(w)
    w.input = IDLE
    for (let i = 0; i < 6; i++) {
      sim.stepWorld(w, IDLE)
      w.events.length = 0
      w.droplets.length = 0
      if (p.onGround) break
    }
    if (!p.onGround || p.state !== 'normal' || w.status !== 'play') return null
    if (mover ? p.ridingId !== mover.id : Math.abs(p.y + p.h - feetY) > 0.01) return null
    w.ticks0 = w.tick
    return w
  }

  /**
   * Play one macro. `variant` may set jumpAt (the tick the jump is pressed, overriding the
   * macro's own rule) for the take-off windows. Returns what happened.
   *
   * A late hover's flight is its plain macro's flight up to the tick the hover starts, so the
   * plain run takes a copy of everything there for each of `followers` (its late macros) and
   * leaves them in res.snaps; play(..., { from: snap }) carries on from one instead of from the
   * start. That is exact (tests/reach.mjs compares it with playing from the start).
   */
  function play(mode, node, macro, tau, offset, variant = null, share = null) {
    const t0 = performance.now()
    let w
    let res
    let box
    let seen
    let fall = 0
    let stage = 'ground'
    let t = 0
    let prev = 0
    let jumpT = -1
    let rest = 0
    let walkCols = 0
    let startCol = 0
    let lastCol = 0
    let startTau = 0
    let forced = -1
    if (share?.from) {
      const s = share.from
      ;({ w, res, box, seen } = s)
      ;({ fall, stage, t, prev, jumpT, rest, walkCols, startCol, lastCol, startTau } = s.v)
      forced = s.mask
    } else {
      w = place(mode, node, tau, offset, macro.d || 1)
      if (!w) return { invalid: true, ticks: 0, rel: nodeBits(node) }
      res = { to: null, info: null, ticks: 0, dead: false, hurt: false, exit: null, exitTick: 0, timeout: false, airborne: false, hovered: false, fallT: 0, touched: [], bumped: [], jumpAt: -1, rel: 0 }
      box = new Map()
      seen = new Set()
      startTau = tau + w.tick
      startCol = lastCol = Math.floor((w.player.x + w.player.w / 2) / TILE)
    }
    const t1 = t
    const p = w.player
    const followers = share?.followers ?? null
    const snap = (mask) => ({
      w: copyWorld(w),
      res: { ...res, touched: res.touched.slice(), bumped: [], snaps: undefined },
      box: new Map([...box].map(([k, b]) => [k, b.slice()])),
      seen: new Set(seen),
      v: { fall, stage, t, prev, jumpT, rest, walkCols, startCol, lastCol, startTau },
      mask,
    })
    const track = () => {
      const id = w.area.id
      const c0 = Math.floor(p.x / TILE)
      const c1 = Math.floor((p.x + p.w) / TILE)
      const r0 = Math.floor(p.y / TILE)
      const r1 = Math.floor((p.y + p.h) / TILE)
      const b = box.get(id)
      if (!b) box.set(id, [c0, c1, r0, r1])
      else {
        if (c0 < b[0]) b[0] = c0
        if (c1 > b[1]) b[1] = c1
        if (r0 < b[2]) b[2] = r0
        if (r1 > b[3]) b[3] = r1
      }
    }
    if (forced < 0) track()
    const d = macro.d
    const dirBit = d > 0 ? A.right : d < 0 ? A.left : 0
    const jumpRule = variant?.jumpAt ?? (macro.ground === 'stand' ? 0 : macro.ground === 'runup' ? macro.run : macro.ground === 'edge' ? 'edge' : null)
    const LIMIT = 480
    const airDir = (vy) => {
      switch (macro.air) {
        case 'hold':
          return dirBit
        case 'late':
          return vy < 0 ? 0 : dirBit
        case 'turn':
          return vy < 0 ? dirBit : d > 0 ? A.left : A.right
        case 'stop':
          return vy < 0 ? dirBit : 0
        default:
          return 0
      }
    }
    for (; t < LIMIT; t++) {
      let mask = 0
      let axis
      let hoverTick = false
      const resumed = forced >= 0
      if (resumed) {
        // Carrying on from the plain run's copy: this tick's input was worked out there.
        mask = forced
        forced = -1
      } else if (stage === 'ground') {
        const col = Math.floor((p.x + p.w / 2) / TILE)
        if (macro.ground === 'pipe') {
          mask = t < 6 ? A.down : 0
          if (t >= 6 && !w.warp) stage = 'settle'
        } else if (macro.ground === 'door') {
          mask = t < 2 ? A.up : 0
          if (t >= 2 && !w.warp) stage = 'settle'
        } else if (jumpRule === null) {
          // step, run, walk
          const off = !p.onGround && p.airT > 1
          if (off) {
            stage = 'air'
            res.airborne = true
          } else if (macro.ground === 'step' && (col !== startCol || t >= 24 || (t > 0 && p.hitWall === d))) stage = 'settle'
          else if (macro.ground === 'run' && ((t > 0 && p.hitWall === d) || t >= (macro.limit ?? 150))) stage = 'settle'
          else if (macro.ground === 'walk') {
            if (col !== lastCol) {
              walkCols++
              lastCol = col
            }
            if (walkCols >= 2 || t >= 60 || (t > 0 && p.hitWall === d)) stage = 'settle'
          }
          if (stage === 'ground') {
            mask = dirBit
            if (macro.ground === 'walk') axis = d * 0.5
          }
        } else {
          let press = false
          if (jumpRule === 'edge') {
            if (!p.onGround && t > 0) res.why = 'lip'
            else if (t > 0 && p.hitWall === d) res.why = 'wall'
            // No lip and no wall within reach: that is a plain run, which 'run' already covers.
            else if (t >= 60) return { invalid: true, ticks: 0, rel: nodeBits(node) }
            press = res.why !== undefined && !(macro.coyote && res.why === 'lip' && p.coyote > 1)
          } else press = t >= jumpRule
          if (press) {
            stage = 'air'
            jumpT = t
            res.jumpAt = t
            mask = A.jump | dirBit
          } else {
            mask = dirBit
          }
        }
      }
      if (!resumed && (stage === 'air' || stage === 'settle')) {
        if (stage === 'air' && jumpT >= 0 && t - jumpT < macro.hold) mask |= A.jump
        if (stage === 'air' && t === jumpT) mask = A.jump | (macro.air === 'late' ? 0 : dirBit)
        else if (!p.onGround || (stage === 'air' && t - jumpT < 2)) {
          mask |= airDir(p.vy)
          hoverTick = true
          if (wantsHover(macro, p, fall)) mask |= A.down | A.spray
        }
      }
      // The first tick a late hover would hold down + spray: where its flight parts from this one.
      if (followers && hoverTick && !(mask & A.down)) {
        for (const fm of followers) if (!res.snaps?.has(fm.id) && wantsHover(fm, p, fall)) (res.snaps ??= new Map()).set(fm.id, snap(mask | A.down | A.spray))
      }
      const f = frameFor(prev, mask, axis)
      prev = mask
      const pips = p.pips
      sim.stepWorld(w, f)
      w.events.length = 0
      w.droplets.length = 0
      if (w.entities.length && w.entities[w.entities.length - 1].slot < 0) dropRuntime(w)
      keepGrime(w, mode)
      track()
      fall = FALL.next(fall, p)
      if (fall > res.fallT) res.fallT = fall
      if (p.hovering) res.hovered = true
      if (p.pips < pips || p.state === 'hurt') res.hurt = true
      // Touch targets
      if (w.status === 'play' && !w.warp) {
        const info = areaInfo.get(w.area.id)
        const c0 = Math.max(0, Math.floor(p.x / TILE))
        const c1 = Math.min(info.w - 1, Math.floor((p.x + p.w) / TILE))
        for (let c = c0; c <= c1; c++) {
          for (const tg of info.buckets[c]) {
            if (seen.has(tg.id)) continue
            if (p.x < tg.x + tg.w && p.x + p.w > tg.x && p.y < tg.y + tg.h && p.y + p.h > tg.y) {
              seen.add(tg.id)
              res.touched.push([tg.id, t + 1])
            }
          }
        }
      }
      if (w.status === 'clear') {
        res.exit = w.exit
        res.exitTick = t + 1
        break
      }
      if (w.status !== 'play') {
        res.dead = true
        break
      }
      if (stage === 'air' && p.onGround && t - jumpT >= 1) stage = 'settle'
      if (stage !== 'settle') continue
      if (w.warp || p.state !== 'normal' || !p.onGround) {
        rest = 0
        continue
      }
      if (p.ridingId) {
        const s = w.solids.find((e) => e.id === p.ridingId)
        const mv = s && s.slot >= 0 ? movers(w.area.id).list.find((m) => m.slot === s.slot) : null
        if (mv) {
          const tauNow = startTau + t + 1
          if (tauNow % BUCKET === 0) {
            res.to = `${w.area.id}|m${mv.slot}|${Math.round((tauNow % mv.period) / BUCKET) % mv.buckets}`
            res.info = { kind: 'mover', area: w.area.id, slot: mv.slot, k: Math.round((tauNow % mv.period) / BUCKET) % mv.buckets }
            break
          }
          continue
        }
      }
      if (p.vx === 0 && p.y === p.py) rest++
      else rest = 0
      if (rest >= 2) {
        const col = Math.floor((p.x + p.w / 2) / TILE)
        const feetY = Math.round((p.y + p.h) * 100) / 100
        res.to = `${w.area.id}|${col}|${feetY}`
        res.info = { kind: 'tile', area: w.area.id, col, feetY, x: p.x }
        break
      }
    }
    res.ticks = t + 1
    res.pulsed = res.hovered && macro.hover === 'pulse'
    res.late = res.hovered && typeof macro.hover === 'number'
    if (t >= LIMIT) res.timeout = true
    // Blocks bumped (only those whose tile or counter changed: a used block thuds and changes nothing).
    for (const [id] of box) {
      const info = areaInfo.get(id)
      const g = w.areas[id].grid
      const bg = base(mode).per.get(id).areas[id].grid
      for (const b of info.blocks) if (g.t[b.i] !== bg.t[b.i] || g.d[b.i] !== bg.d[b.i]) res.bumped.push(b.id)
    }
    let rel = nodeBits(node)
    for (const [id, b] of box) rel |= bitsIn(areaInfo.get(id), b[0], b[1], b[2], b[3])
    res.rel = rel
    res.box = [...box].map(([id, b]) => [id, ...b])
    stats.runs++
    stats.ticks += res.ticks - t1
    stats.ms += performance.now() - t0
    return res
  }
  function dropRuntime(w) {
    const list = w.entities
    let k = 0
    for (const e of list) if (e.slot >= 0 || e.solid !== 'none') list[k++] = e
    list.length = k
  }
  /**
   * Water washes nothing in a probe: droplets are cleared after every tick, but one fired next to a
   * grime block hits it in the tick it is fired. With grime kept, put any worn grime back.
   */
  function keepGrime(w, mode) {
    if (mode & MODE.GRIME) return
    const cells = areaInfo.get(w.area.id).grime
    if (!cells.length) return
    const g = w.grid
    for (const i of cells) {
      if (g.t[i] === G_CODE && g.d[i] === 0) continue
      g.t[i] = G_CODE
      g.d[i] = 0
    }
  }
  function nodeBits(node) {
    const info = areaInfo.get(node.area)
    if (node.kind === 'mover') {
      const mv = node.mover
      return mv ? bitsIn(info, mv.c0, mv.c1, 0, info.h - 1) : 0
    }
    const r = Math.floor(node.feetY / TILE)
    return bitsIn(info, node.col, node.col, r - 2, r)
  }

  /* ---- what to try from a node ---- */
  function phasesFor(node) {
    const mv = movers(node.area)
    if (node.kind === 'mover') return [node.k * BUCKET]
    if (!mv.list.length) return [0]
    const near = mv.list.some((m) => node.col >= m.c0 - MOVER_RANGE && node.col <= m.c1 + MOVER_RANGE)
    if (!near) return [0]
    const n = Math.min(PHASES, Math.max(1, Math.floor(mv.maxPeriod / BUCKET)))
    const out = []
    for (let i = 0; i < n; i++) out.push(Math.floor((i * mv.maxPeriod) / n / BUCKET) * BUCKET)
    return [...new Set(out)]
  }
  function warpMacros(node) {
    if (node.kind !== 'tile') return []
    const info = areaInfo.get(node.area)
    const cx = node.x + MAXX_W / 2
    const out = []
    for (const pp of info.pipes) {
      if (Math.abs(node.feetY - (pp.y + pp.h)) <= 1 && cx >= pp.x + 6 && cx <= pp.x + pp.w - 6) out.push(PIPE_MACRO)
    }
    for (const dd of info.doors) {
      if (cx >= dd.x && cx <= dd.x + dd.w && node.feetY > dd.y && node.feetY - MAXX_H < dd.y + dd.h) out.push(DOOR_MACRO)
    }
    return [...new Set(out)]
  }

  const cache = new Map()
  function cached(mode, node, macro, tau, offset, share = null) {
    const key = `${node.key}|${macro.id}|${tau}|${offset ?? ''}`
    let list = cache.get(key)
    if (!list) cache.set(key, (list = []))
    for (const e of list) {
      // Another variant (bricks broken, flags set) only matters to a macro that came near a brick or a gate.
      const rel = (e.res.rel & 15) | (e.res.rel & (NEAR_BRICK | MODE.GATES) ? ~31 : 0)
      if (((e.mode ^ mode) & rel) === 0) {
        if (e.mode !== mode) stats.reused++
        return e.res
      }
    }
    const res = play(mode, node, macro, tau, offset, null, share)
    list.push({ mode, res })
    return res
  }
  /** The late macros that carry on from each plain macro's flight (play's followers). */
  const FOLLOWERS = new Map()
  if (opts.share !== false) {
    for (const m of MACRO_SET) {
      if (!m.onlyIfFalls) continue
      if (!FOLLOWERS.has(m.onlyIfFalls[0])) FOLLOWERS.set(m.onlyIfFalls[0], [])
      FOLLOWERS.get(m.onlyIfFalls[0]).push(m)
    }
  }
  /** The offset that places Maxx on a tile node in this mode: the middle of the column, else where he first came to rest. */
  function nodeOffsets(mode, node) {
    if (node.kind === 'mover') return ['left', 'mid', 'right']
    // A variant (bricks broken, a flag set) changes nothing where he stands unless a brick or a gate is near.
    if (mode >>> VARIANT_SHIFT && !(nodeBits(node) & (NEAR_BRICK | MODE.GATES))) return nodeOffsets(mode & 15, node)
    let off = node.place.get(mode)
    if (off === undefined) {
      off = place(mode, node, 0, undefined, 1) ? null : node.altX !== undefined && place(mode, node, 0, 'alt', 1) ? 'alt' : false
      node.place.set(mode, off)
    }
    return off === false ? [] : [off ?? undefined]
  }

  /* ---- graphs ---- */
  const graphs = new Map()
  function startNode() {
    const w = copyWorld(base(0).per.get(areaIds[0]))
    const p = w.player
    for (let t = 0, rest = 0; t < 240; t++) {
      sim.stepWorld(w, IDLE)
      w.events.length = 0
      if (w.status !== 'play') return null
      if (p.onGround && p.vx === 0 && p.y === p.py) rest++
      else rest = 0
      if (rest >= 2 && !p.ridingId) return tileNode(w.area.id, Math.floor((p.x + p.w / 2) / TILE), Math.round(p.y + p.h), p.x)
    }
    return null
  }

  /**
   * Everything reachable in a mode. Returns { mode, start, reached (Set of keys, in the order
   * found), edges (Map key -> [edge]), exits [edge], touched (Map target id -> [edge]),
   * bumped (Map block id -> [edge]), fatal (Map target id -> [edge]: reached only on a run
   * that ends in a grime) }. An edge is { from, to, macro, tau, offset, ticks, cost, hover, res }.
   */
  function graph(mode) {
    if (graphs.has(mode)) return graphs.get(mode)
    const t0 = performance.now()
    const start = startNode()
    const g = { mode, start: start?.key ?? null, reached: new Set(), edges: new Map(), exits: [], touched: new Map(), bumped: new Map(), fatal: new Map(), broken: [], ms: 0 }
    graphs.set(mode, g)
    if (!start) return g
    let queue = [start.key]
    g.reached.add(start.key)
    const push = (map, id, edge) => {
      let l = map.get(id)
      if (!l) map.set(id, (l = []))
      l.push(edge)
    }
    // A brick stays broken and a button stays pressed. Once the map has broken a brick or touched
    // something that sets a flag, every place is tried again in a world with the bricks gone and
    // the flag set (wmode), until nothing new happens. Edges keep the world they were found in
    // (needsBricks, needsFlags).
    const broken = new Set()
    const flags = {}
    const have = mode & MODE.GATES ? openFlags : {}
    const added = new WeakSet()
    let wmode = mode
    for (;;) {
      expand()
      let more = false
      for (const id of g.bumped.keys()) {
        if (broken.has(id) || !brickAt(id)) continue
        broken.add(id)
        more = true
      }
      for (const tid of g.touched.keys()) {
        const s = targets[tid].sets
        if (!s || (have[s.flag] ?? 0) >= s.value || (flags[s.flag] ?? 0) >= s.value) continue
        flags[s.flag] = s.value
        more = true
      }
      if (!more) break
      wmode = withVariant(mode, broken, flags)
      queue = [...g.reached]
    }
    g.broken = [...broken]
    g.flagsSet = { ...flags }
    g.ms = performance.now() - t0
    return g

    function expand() {
    while (queue.length) {
      const key = queue.shift()
      const node = nodes.get(key)
      let out = g.edges.get(key)
      if (!out) g.edges.set(key, (out = []))
      const fresh = []
      const offsets = nodeOffsets(wmode, node)
      if (!offsets.length) continue
      const taus = phasesFor(node)
      const macros = [...MACRO_SET, ...warpMacros(node)]
      const groups = new Map()
      const take = (macro, tau, offset, share = null) => {
        const res = cached(wmode, node, macro, tau, offset, share)
        if (res.invalid) return res
        // The same result again (a later brick pass, nothing changed near it) is already in the graph.
        if (added.has(res)) return res
        added.add(res)
        const edge = { from: key, to: res.to, macro, tau, offset, ticks: res.ticks, cost: res.ticks, hover: res.hovered, late: res.late, pulse: res.pulsed, fine: !!macro.fine, mode: wmode, res }
        for (const [tid, at] of res.touched) push(res.dead || res.hurt ? g.fatal : g.touched, tid, { ...edge, ticks: at, cost: at })
        if (res.dead || res.hurt) return res
        for (const bid of res.bumped) push(g.bumped, bid, edge)
        if (res.exit) {
          g.exits.push({ ...edge, exit: res.exit, ticks: res.exitTick, cost: res.exitTick })
          return res
        }
        if (!res.to || res.to === key) return res
        const gk = `${macro.id}|${offset ?? ''}|${res.to}`
        let grp = groups.get(gk)
        if (!grp) groups.set(gk, (grp = []))
        grp.push(edge)
        out.push(edge)
        fresh.push(edge)
        return res
      }
      for (const tau of taus) {
        for (const offset of offsets) {
          const done = new Map()
          for (const macro of macros) {
            if (macro.onlyIfAirborne && !done.get(macro.onlyIfAirborne)?.airborne) continue
            if (macro.onlyIfLip && done.get(macro.onlyIfLip)?.why !== 'lip') continue
            let share = null
            if (macro.onlyIfFalls) {
              const dep = done.get(macro.onlyIfFalls[0])
              if (!dep || dep.invalid || !(dep.fallT > macro.onlyIfFalls[1])) continue
              const from = dep.snaps?.get(macro.id)
              if (from) share = { from }
            } else if (FOLLOWERS.has(macro.id)) share = { followers: FOLLOWERS.get(macro.id) }
            done.set(macro.id, take(macro, tau, offset, share))
          }
          // The copies are used once (or not at all, when a result from another mode served).
          for (const res of done.values()) if (res.snaps) res.snaps = undefined
          // The lip sweep (FINE), from one place a lip, at the first phase of any platforms near.
          if (offset !== undefined || tau !== taus[0] || !FINE_SET.length || node.kind !== 'tile') continue
          for (const d of [1, -1]) {
            const s = d > 0 ? 'right' : 'left'
            const lip = done.get(`edge-${s}`)
            if (lip?.why !== 'lip') continue
            // Or the far end of a floor too short for that run-up.
            const farEnd = lip.jumpAt < FINE.from && surfaceSpan(wmode, node, node.col) && !surfaceSpan(wmode, node, node.col - d)
            if (!(lip.jumpAt >= FINE.from && lip.jumpAt < FINE.to) && !farEnd) continue
            const coyote = done.get(`coyote-${s}`)
            for (const macro of FINE_SET) {
              if (macro.d !== d || (typeof macro.hover === 'number' && !(coyote?.fallT > macro.hover))) continue
              // The plain shift-0 runs are the coyote macros above (begun 0 ticks after the top is held from the top).
              const regular = macro.hover === false || macro.hover === true || macro.hover === 0 || LATE_SET.includes(macro.hover)
              for (const k of FINE.shifts) if (k || !regular) take(macro, tau, k ? -d * k : undefined)
            }
          }
        }
      }
      // A jump that only works at some phases of a lift costs a wait for the right moment.
      if (taus.length > 1) {
        const period = movers(node.area).maxPeriod
        for (const grp of groups.values()) {
          const share = grp.length / taus.length
          for (const e of grp) e.cost = e.ticks + Math.round(((1 - share) * period) / 2)
        }
      }
      for (const e of fresh) {
        if (g.reached.has(e.to)) continue
        const info = e.res.info
        if (info.kind === 'tile') tileNode(info.area, info.col, info.feetY, info.x)
        else moverNode(info.area, info.slot, info.k)
        g.reached.add(e.to)
        queue.push(e.to)
      }
    }
    }
  }
  const brickAt = (id) => areaInfo.get(id.split('@')[0])?.blocks.some((b) => b.id === id && b.ch === 'B') ?? false

  /* ---- routes ---- */
  const isJump = (e) => e.macro.ground === 'stand' || e.macro.ground === 'runup' || e.macro.ground === 'edge'
  /** What an edge costs a route: its ticks and lift wait, a little more for a jump or a hover, plus `extra` (tight jumps). */
  const routeCost = (e, extra) => e.cost + (isJump(e) ? JUMP_BIAS : 0) + (e.hover ? HOVER_BIAS : 0) + (e.late ? LATE_BIAS : 0) + (e.pulse ? PULSE_BIAS : 0) + (extra?.get(e) ?? 0)
  /** Cheapest costs from the start to every reached node: { dist: Map, via: Map key -> edge }. */
  function dijkstra(g, extra) {
    const dist = new Map()
    const via = new Map()
    if (!g.start) return { dist, via }
    dist.set(g.start, 0)
    const heap = [[0, g.start]]
    const pop = () => {
      const top = heap[0]
      const last = heap.pop()
      if (heap.length) {
        heap[0] = last
        for (let i = 0; ; ) {
          const l = 2 * i + 1
          const r = l + 1
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[i], heap[m]] = [heap[m], heap[i]]
          i = m
        }
      }
      return top
    }
    const add = (item) => {
      heap.push(item)
      for (let i = heap.length - 1; i > 0; ) {
        const p = (i - 1) >> 1
        if (heap[p][0] <= heap[i][0]) break
        ;[heap[i], heap[p]] = [heap[p], heap[i]]
        i = p
      }
    }
    while (heap.length) {
      const [c, key] = pop()
      if (c > dist.get(key)) continue
      for (const e of g.edges.get(key) ?? []) {
        const nc = c + routeCost(e, extra)
        if (nc < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nc)
          via.set(e.to, e)
          add([nc, e.to])
        }
      }
    }
    return { dist, via }
  }
  const dj = new WeakMap()
  /** Route costs from the start (without the tight-jump penalties): { dist, via }. */
  function costs(g) {
    let d = dj.get(g)
    if (!d) dj.set(g, (d = dijkstra(g, null)))
    return d
  }
  function cheapest(g, what, extra) {
    const { dist, via } = extra ? dijkstra(g, extra) : costs(g)
    let best = null
    const consider = (edge) => {
      const c = (dist.get(edge.from) ?? Infinity) + routeCost(edge, extra)
      if (c < Infinity && (!best || c < best.c)) best = { c, last: edge }
    }
    if (what === 'goal' || what === 'secret') for (const e of g.exits) if (e.exit === what) consider(e)
    if (typeof what === 'number') for (const e of g.touched.get(what) ?? []) consider(e)
    if (typeof what === 'string' && what.includes('@')) for (const e of g.bumped.get(what) ?? []) consider(e)
    if (typeof what === 'string' && nodes.has(what) && g.reached.has(what)) {
      const c = dist.get(what)
      if (c !== undefined) best = { c, last: null, node: what }
    }
    if (!best) return null
    const steps = []
    for (let k = best.last ? best.last.from : best.node; k && k !== g.start; ) {
      const e = via.get(k)
      if (!e) return null
      steps.unshift(e)
      k = e.from
    }
    if (best.last) steps.push(best.last)
    return { steps, last: best.last }
  }
  /**
   * The cheapest fair route to 'goal', 'secret', a target id (number), a block id ('area@tx,ty')
   * or a node key: a jump with a take-off window under 4 is only used when nothing else gets
   * there (opts.fair false: the plain cheapest). Returns { ticks (real time: moves plus lift
   * waits), steps: [edge], last } or null.
   */
  function routeTo(g, what, opts = {}) {
    let extra = null
    let found = null
    for (let round = 0; round < 24; round++) {
      found = cheapest(g, what, extra)
      if (!found || opts.fair === false) break
      let changed = false
      for (const e of found.steps) {
        if (extra?.has(e)) continue
        const w = windowCached(g, e)
        if (w && ((w.works !== null && w.works < TIGHT) || w.fine)) {
          extra ??= new Map()
          extra.set(e, TIGHT_BIAS)
          changed = true
        }
      }
      if (!changed) break
    }
    if (!found) return null
    return { ticks: found.steps.reduce((n, e) => n + e.cost, 0), steps: found.steps, last: found.last }
  }
  const windows = new WeakMap()
  function windowCached(g, e) {
    if (!windows.has(e)) windows.set(e, windowOf(g, e))
    return windows.get(e)
  }

  /**
   * How forgiving a jump edge is. Edge jumps and running jumps: the jump is pressed earlier and
   * later, a tick at a time; jumps from a stand: Maxx starts 4 px further back or forward each
   * time (about a tick of running). Returns { tried, works (longest run of neighbours, the
   * edge's own included, that still end in the same place), unit, needsHover, needsLate (only a
   * hover begun late does it), needsPulse (only a tapped one: tapping never beats holding now,
   * so this should not happen), fine (the lip sweep's: one exact run-up and hover start, as
   * tight as any jump can be) } or null for an edge that is not a jump.
   */
  function windowOf(g, edge) {
    const m = edge.macro
    if (!['stand', 'runup', 'edge'].includes(m.ground)) return null
    const target = edge.exit ? null : nodes.get(edge.to)
    // A jump still works if it lands anywhere on the same stretch of floor (or the same platform), not only in the same column.
    const span = target && target.kind === 'tile' ? surfaceSpan(g.mode, target) : null
    const lands = (to, info) => {
      if (to === edge.to) return true
      if (!info || !target) return false
      if (target.kind === 'mover') return info.kind === 'mover' && info.area === target.area && info.slot === target.slot
      return !!span && info.kind === 'tile' && info.area === target.area && info.feetY === target.feetY && info.col >= span[0] && info.col <= span[1]
    }
    const same = (r) => !r.invalid && !r.dead && !r.hurt && (edge.exit ? r.exit === edge.exit : lands(r.to, r.info))
    // Hover: is there a way from the same place to the same place without it (held from the top, untapped)?
    let needsHover = false
    let needsLate = false
    let needsPulse = false
    if (m.hover && edge.hover) {
      const alt = (g.edges.get(edge.from) ?? []).concat(g.exits.filter((e) => e.from === edge.from))
      const sameEnd = (e) => (edge.exit ? e.exit === edge.exit : !e.exit && lands(e.to, e.res.info))
      needsHover = !alt.some((e) => !e.hover && sameEnd(e))
      needsLate = needsHover && (edge.late || edge.pulse) && !alt.some((e) => e.hover && !e.late && !e.pulse && sameEnd(e))
      needsPulse = needsLate && edge.pulse && !alt.some((e) => !e.pulse && sameEnd(e))
    }
    const mode = edge.mode ?? g.mode
    // From a moving platform the take-off is already bound to its timing: no window is measured.
    const fine = !!m.fine
    if (edge.offset === 'left' || edge.offset === 'mid' || edge.offset === 'right') return { tried: 0, works: null, unit: 'from a moving platform', needsHover, needsLate, needsPulse, fine }
    const node = nodes.get(edge.from)
    const results = []
    let unit
    if (m.ground === 'stand') {
      unit = '4 px steps of where he stands'
      for (let k = -6; k <= 6; k++) {
        const off = (edge.offset === 'alt' ? node.altX - node.x : 0) + 4 * k
        results.push(k === 0 ? true : same(play(mode, node, m, edge.tau, off)))
      }
    } else {
      unit = 'take-off ticks'
      const at = edge.res.jumpAt
      for (let k = -8; k <= 8; k++) {
        if (at + k < 0) continue
        results.push(k === 0 ? true : same(play(mode, node, m, edge.tau, edge.offset, { jumpAt: at + k })))
      }
    }
    let works = 0
    let run = 0
    for (const r of results) {
      run = r ? run + 1 : 0
      works = Math.max(works, run)
    }
    return { tried: results.length, works, unit, needsHover, needsLate, needsPulse, fine }
  }

  /**
   * The columns either side of a tile node that are one unbroken floor at its height, and the
   * column beside each end (where his middle is at the lip). With `probe` (a column): whether he
   * can stand in that column at the node's height.
   */
  const spanCache = new Map()
  function surfaceSpan(mode, node, probe) {
    if (node.row === null) return null
    const key = `${mode}|${node.area}`
    let set = spanCache.get(key)
    if (!set) spanCache.set(key, (set = new Set(spots(node.area, mode).map((s) => `${s.col},${s.row}`))))
    const on = (c) => set.has(`${c},${node.row}`)
    if (probe !== undefined) return on(probe)
    // At the lip of a ledge his middle is over the open column beside it: that is the same floor,
    // and so is the column beside its far end.
    if (!on(node.col) && !on(node.col - 1) && !on(node.col + 1)) return [node.col, node.col]
    let c0 = on(node.col) || on(node.col - 1) ? node.col : node.col + 1
    let c1 = on(node.col) || on(node.col + 1) ? node.col : node.col - 1
    while (on(c0 - 1)) c0--
    while (on(c1 + 1)) c1++
    return [Math.min(c0 - 1, node.col), Math.max(c1 + 1, node.col)]
  }

  /* ---- standing spots for the map ---- */
  /** Every cell (col, row) where Maxx could stand with his feet (a solid, catwalk or hidden-used top under him, two open cells above). */
  function spots(areaId, mode = 0) {
    const info = areaInfo.get(areaId)
    const g = base(mode).per.get(areaId).grid
    const out = []
    const flags = (c, r) => (c < 0 || r < 0 || c >= g.w || r >= g.h ? 0 : sim.TILE_FLAGS[g.t[r * g.w + c]])
    for (let r = 0; r < info.h - 1; r++) {
      for (let c = 0; c < info.w; c++) {
        const under = flags(c, r + 1)
        if (!(under & (sim.T_SOLID | sim.T_ONEWAY))) continue
        if (flags(c, r) & (sim.T_SOLID | sim.T_HAZARD) || flags(c, r - 1) & (sim.T_SOLID | sim.T_HAZARD)) continue
        out.push({ col: c, row: r, feetY: sim.tileFeetY(r) })
      }
    }
    return out
  }

  /* ---- a second opinion: random play ---- */
  /**
   * Random input from the start, on the same probe world as graph(mode), as a check on the macro
   * set. It keeps an archive of world copies, one per cell (area, 16 px square, on the ground or
   * rising or falling, hover left, and the moment of the lifts' cycle when there are lifts), and
   * again and again takes a little-tried cell and plays random held inputs from it (directions,
   * the stick half over, jumps held for random times, the hover, up at doors, down on pipes).
   * A run that takes a hit or ends in a grime is dropped, as a macro's is.
   * Returns { places: Map key -> { masks }, riders: Map 'area|m<slot>' -> { masks }, touched:
   * Map target id -> { masks }, exits: Map 'goal'|'secret' -> { masks }, ticks, rollouts, cells }.
   * `masks` is the input from the start that got there (left 1, right 2, up 4, down 8, jump 16,
   * spray 32, half stick 64), so a find can be replayed with replayInput().
   * opts: ticks (budget, 1e6), seed, cell (px, 16), noHover.
   */
  function explore(mode = 0, opts = {}) {
    const budget = opts.ticks ?? 1e6
    const CELL = opts.cell ?? 16
    let seed = (opts.seed ?? 0x2545f491) >>> 0
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0
      let x = seed
      x = Math.imul(x ^ (x >>> 15), x | 1)
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const out = { places: new Map(), riders: new Map(), touched: new Map(), exits: new Map(), ticks: 0, rollouts: 0, cells: 0 }
    const first = copyWorld(base(mode).per.get(areaIds[0]))
    first.input = IDLE
    const cells = []
    const cellIndex = new Map()
    const periods = new Map(areaIds.map((id) => [id, movers(id).maxPeriod]))
    const cellKey = (w) => {
      const p = w.player
      const per = periods.get(w.area.id)
      const phase = per ? Math.floor((w.tick % per) / 20) : 0
      return `${w.area.id}|${Math.floor(p.x / CELL)}|${Math.floor(p.y / CELL)}|${p.onGround ? 0 : p.vy < 0 ? 1 : 2}|${p.hover > 0 ? 1 : 0}|${phase}|${w.warp ? 1 : 0}`
    }
    // Every saved state is a whole world: past this many, new places still count but are not kept to play on from.
    const MAX_CELLS = opts.maxCells ?? 150000
    const addCell = (w, parent, seg, last) => {
      if (cells.length >= MAX_CELLS) {
        out.full = true
        return
      }
      const key = cellKey(w)
      if (cellIndex.has(key)) return
      cellIndex.set(key, cells.length)
      cells.push({ w: copyWorld(w), n: 0, parent, seg, last })
    }
    const pathOf = (cellId, tail) => {
      const parts = [tail]
      for (let c = cellId; c >= 0; c = cells[c].parent) parts.push(cells[c].seg)
      const n = parts.reduce((s, a) => s + a.length, 0)
      const masks = new Uint8Array(n)
      let at = 0
      for (let i = parts.length - 1; i >= 0; i--) {
        masks.set(parts[i], at)
        at += parts[i].length
      }
      return masks
    }
    const note = (map, key, cellId, seg, len) => {
      if (!map.has(key)) map.set(key, { cell: cellId, seg: seg.slice(0, len) })
    }
    addCell(first, -1, new Uint8Array(0), 0)
    const seg = new Uint8Array(400)
    while (out.ticks < budget && cells.length) {
      // A little-tried cell: the least tried of a few picked at random, recent ones a bit more often.
      let pick = -1
      for (let k = 0; k < 4; k++) {
        const i = k === 0 && rnd() < 0.3 ? cells.length - 1 - Math.floor(rnd() * Math.min(cells.length, 64)) : Math.floor(rnd() * cells.length)
        if (pick < 0 || cells[i].n < cells[pick].n) pick = i
      }
      const from = cells[pick]
      from.n++
      out.rollouts++
      const w = copyWorld(from.w)
      const p = w.player
      let prev = from.last
      const len = 20 + Math.floor(rnd() * 160)
      let mask = prev
      let hold = 0
      let ground = p.onGround ? 1 : 0
      for (let t = 0; t < len; t++) {
        if (hold <= 0) {
          const r1 = rnd()
          const dir = r1 < 0.4 ? A.right : r1 < 0.8 ? A.left : 0
          mask = dir
          if (dir && rnd() < 0.12) mask |= 64
          if (rnd() < 0.45) mask |= A.jump
          if (!opts.noHover && rnd() < 0.18) mask |= A.down | A.spray
          else if (rnd() < 0.05) mask |= A.down
          if (rnd() < 0.05) mask |= A.up
          // Mostly short holds, now and then a long one (a full jump, a long run).
          hold = rnd() < 0.7 ? 1 + Math.floor(rnd() * 12) : 1 + Math.floor(rnd() * 60)
        }
        hold--
        const half = mask & 64 ? ((mask & A.right ? 1 : 0) - (mask & A.left ? 1 : 0)) * 0.5 : undefined
        const pips = p.pips
        sim.stepWorld(w, frameFor(prev & 63, mask & 63, half))
        prev = mask & 63
        seg[t] = mask
        out.ticks++
        w.events.length = 0
        w.droplets.length = 0
        if (w.entities.length && w.entities[w.entities.length - 1].slot < 0) dropRuntime(w)
        keepGrime(w, mode)
        if (w.status === 'clear') {
          note(out.exits, w.exit, pick, seg, t + 1)
          break
        }
        if (w.status !== 'play' || p.pips < pips || p.state === 'hurt') break
        if (!w.warp) {
          const info = areaInfo.get(w.area.id)
          const c0 = Math.max(0, Math.floor(p.x / TILE))
          const c1 = Math.min(info.w - 1, Math.floor((p.x + p.w) / TILE))
          for (let c = c0; c <= c1; c++) {
            for (const tg of info.buckets[c]) {
              if (p.x < tg.x + tg.w && p.x + p.w > tg.x && p.y < tg.y + tg.h && p.y + p.h > tg.y) note(out.touched, tg.id, pick, seg, t + 1)
            }
          }
          // Two ticks on the ground: a landing that lasts a tick (the very edge of a moving platform) is no place.
          ground = p.onGround && p.state === 'normal' ? ground + 1 : 0
          if (ground >= 2) {
            const s = p.ridingId ? w.solids.find((e) => e.id === p.ridingId) : null
            if (s && s.slot >= 0 && movers(w.area.id).list.some((m) => m.slot === s.slot)) note(out.riders, `${w.area.id}|m${s.slot}`, pick, seg, t + 1)
            else note(out.places, `${w.area.id}|${Math.floor((p.x + p.w / 2) / TILE)}|${Math.round((p.y + p.h) * 100) / 100}`, pick, seg, t + 1)
          }
        }
        if ((t & 3) === 3 || p.onGround) addCell(w, pick, seg.slice(0, t + 1), prev)
      }
    }
    for (const map of [out.places, out.riders, out.touched, out.exits]) for (const v of map.values()) v.masks = pathOf(v.cell, v.seg)
    out.cells = cells.length
    return out
  }
  /** Play masks (as explore() records them) on the probe world of a mode from the start; returns the world. */
  function replayInput(mode, masks, each) {
    const w = copyWorld(base(mode).per.get(areaIds[0]))
    let prev = 0
    for (let i = 0; i < masks.length; i++) {
      const m = masks[i]
      const half = m & 64 ? ((m & A.right ? 1 : 0) - (m & A.left ? 1 : 0)) * 0.5 : undefined
      sim.stepWorld(w, frameFor(prev, m & 63, half))
      prev = m & 63
      w.events.length = 0
      w.droplets.length = 0
      if (w.entities.length && w.entities[w.entities.length - 1].slot < 0) dropRuntime(w)
      keepGrime(w, mode)
      if (each) each(w, i)
      if (w.status !== 'play') break
    }
    return w
  }

  return {
    level,
    areaIds,
    areaInfo,
    targets,
    nodes,
    stats,
    graph,
    routeTo,
    costs,
    windowOf: windowCached,
    spots,
    movers,
    play,
    place,
    base,
    explore,
    replayInput,
    needsBricks,
    needsFlags,
    brokenIn,
    describeMacro,
    hover,
    macros: MACRO_SET,
    macroById: (id) => macroById.get(id),
  }
}
