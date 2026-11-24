// The solver: a player that finishes a level in the real simulation, with every car, critter,
// hazard and boss present, by looking ahead on copies of the world. It plays like a careful
// person on a controller, not a speedrun:
//
//   import { createSolver } from './lib/solver.mjs'
//   const s = createSolver(sim, contract, level, { exit: 'goal', tokens: false, spotless: false, seed: null })
//   const result = s.solve()        // { ok, replay, summary, struggles, failure ... } (see solve())
//   formatResult(result)            // the report as lines of text
//
// HOW IT PLAYS
//
// The map comes from lib/reach.mjs: places Maxx can stand at rest, joined by input macros
// that were played in the real simulation on a world with everything harmful taken out. The
// solver works out, for its current target, the cheapest fair cost from every place to the
// target (a reverse Dijkstra over that graph; a jump the map measures at under 4 take-off
// ticks, or one only its lip sweep found, is banned unless --allow-tight; a hover begun late is
// taken only when nothing taught gets there within about 10 s, a tapped one never while a held
// one does, and each use is a line in the report). At each decision it is standing somewhere: it finds
// its place in the graph, takes the next move of the cheapest way on, and tries that move
// for real on a copy of the world it believes in, at several timings and after things that
// clear the way (waiting, backing off, spraying forward or up at what is in the way until it
// is washed or gone, a jump with the gun on). It takes the try that gets it further unharmed,
// soonest, and checks that it is still safe a moment after it lands. When no single try
// works it searches deeper: a beam over short sequences of those tries, scored by progress
// along the way, threats washed and hits taken.
//
// What it knows. The world it looks ahead in is a copy of the real one with everything taken
// out that it has not seen yet: an entity counts as seen 10 ticks after its box first came on
// screen (reaction time), and nothing it never saw is in its copy (no information from off
// screen); once something comes into sight it looks again. Something made during play (a
// clod, a wave) that its own look-ahead had already foreseen, from a telegraph it saw, is
// known at once: the expectation (the believed world, stepped on with the real input) has it
// in the same place. It also looks again when something known and dangerous nearby is not
// where the expectation has it (a car turned round off one it had not seen yet). In the air it
// can still steer: a new threat mid-jump gets the rest of the flight re-chosen (keep going, let
// go, turn back, hover). What it learned about a level is kept when it retries from a checkpoint.
// Inert things (coins, signs, markers, the exits) are always in the copy: they are the map.
// A hit is a hurt, not only a pip lost: a bubble taken on the same tick heals the pip at once.
//
// What the map needs. A target the base map cannot reach is planned with grime washed, gates
// open and hidden blocks bumped (reach modes), and the solver earns each of those in play:
// it washes the grime blocks a move passes through, bumps the hidden blocks a move stands on
// (from under them), and opens a gate or a locked door by touching the button that sets its
// flag, by spraying things that might set it, or by beating the boss in front of it. Moves the
// map found only after breaking a brick or pressing a button (reach's variants) get the brick
// broken (the map's own bump of it) or the button pressed first. A goal the map cannot reach
// at all is approached as near as it goes (a boss may end the level): in its own area, or, if
// nothing there is reached, the places farthest into the level.
//
// Bosses and rivals (anything that sets world.boss): while a fight is on, every decision runs
// a small beam three moves deep over short moves (spray at it, wait, step, jump, the map's
// jumps from where he stands), checks that the best lines can still be survived a second
// later, and plays the first move of the best: no hit first, then dirt washed off the boss.
//
// When it is stuck it says where and why: the place, the move it wanted, every try and what
// hit it, and the thing that kept hitting it on the moves it gave up.
//
// The run is recorded tick by tick. The replay (REPLAY_FORMAT) holds the level id, the seed,
// the options and every attempt's input, and replays to the same worldHash (playReplay).
import { FALL, MODE, copyWorld, createReach, modeDelta, wantsHover } from './reach.mjs'

export const REPLAY_FORMAT = 'maxx-replay-1'

/* ------------------------------------------------------------------ */
/* Input frames and their record                                       */
/* ------------------------------------------------------------------ */

// One tick of input is a mask: left 1, right 2, up 4, down 8, jump 16, spray 32, and 64 for
// the stick half over (axisX +-0.5 instead of +-1).
const L = 1
const R = 2
const U = 4
const D = 8
const J = 16
const S = 32
const HALF = 64
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'spray', 'confirm', 'cancel', 'pause', 'select']
const BITS = { left: L, right: R, up: U, down: D, jump: J, spray: S }

const frameCache = new Map()
/** The InputFrame for holding `mask` after `prev`. Shared and never written by the simulation. */
export function frameFor(prev, mask) {
  const key = (prev & 63) * 128 + mask
  let f = frameCache.get(key)
  if (f) return f
  const held = {}
  const pressed = {}
  const released = {}
  for (const a of ACTIONS) {
    const b = BITS[a] ?? 0
    held[a] = b !== 0 && (mask & b) !== 0
    pressed[a] = held[a] && (prev & b) === 0
    released[a] = b !== 0 && (mask & b) === 0 && (prev & b) !== 0
  }
  const dx = (mask & R ? 1 : 0) - (mask & L ? 1 : 0)
  f = { held, pressed, released, repeat: pressed, axisX: mask & HALF ? dx * 0.5 : dx, axisY: (mask & D ? 1 : 0) - (mask & U ? 1 : 0), device: 'keyboard' }
  frameCache.set(key, f)
  return f
}

/** The actions a mask holds, as the debug API takes them: ['right', 'jump'], and the axis for a half stick. */
export function maskActions(mask) {
  const list = Object.keys(BITS).filter((a) => mask & BITS[a])
  const dx = (mask & R ? 1 : 0) - (mask & L ? 1 : 0)
  return { list, axis: mask & HALF && dx ? { x: dx * 0.5 } : null }
}

/** '2*60 18 2*30': each mask, with a count when it repeats. */
export function encodeInput(masks) {
  const out = []
  for (let i = 0; i < masks.length; ) {
    let j = i
    while (j < masks.length && masks[j] === masks[i]) j++
    out.push(j - i > 1 ? `${masks[i]}*${j - i}` : String(masks[i]))
    i = j
  }
  return out.join(' ')
}
export function decodeInput(text) {
  const masks = []
  for (const tok of String(text ?? '').trim().split(/\s+/)) {
    if (!tok) continue
    const [m, n] = tok.split('*')
    const mask = Number(m)
    const count = n === undefined ? 1 : Number(n)
    if (!Number.isInteger(mask) || mask < 0 || mask > 127 || !Number.isInteger(count) || count < 1) throw new Error(`bad input token '${tok}'`)
    for (let k = 0; k < count; k++) masks.push(mask)
  }
  return masks
}

/** How often (ticks) a replay stores a hash on the way, so a mismatch can be placed. */
export const MARK_EVERY = 600

/**
 * Play a replay in Node. Returns { ok, attempts: [{ ticks, hash, want, status, exit, marks, diverged }], hash, status, exit }.
 * `diverged` is the first stored mark that differs: [tick, got, want], or null.
 */
export function playReplay(sim, level, rep, opts = {}) {
  const out = { ok: true, attempts: [], hash: null, status: null, exit: null }
  let w = null
  for (const at of rep.attempts) {
    w = sim.createWorld(level, {
      session: { ...at.session },
      checkpoint: at.checkpoint ?? null,
      flags: at.flags ? { ...at.flags } : undefined,
      tokens: at.tokens ? [at.tokens[0], at.tokens[1], at.tokens[2]] : undefined,
      seed: rep.seed ?? undefined,
    })
    const masks = decodeInput(at.input)
    const marks = []
    let prev = 0
    for (let i = 0; i < masks.length; i++) {
      sim.stepWorld(w, frameFor(prev, masks[i]))
      w.events.length = 0
      prev = masks[i] & 63
      if ((i + 1) % MARK_EVERY === 0) marks.push([i + 1, sim.worldHash(w)])
      if (opts.each) opts.each(w, i)
    }
    const hash = sim.worldHash(w)
    const want = at.end?.hash ?? null
    let diverged = null
    for (const [tick, h] of marks) {
      const stored = (at.marks ?? []).find((m) => m[0] === tick)
      if (stored && stored[1] !== h) {
        diverged = [tick, h, stored[1]]
        break
      }
    }
    const ok = want === null || want === hash
    if (!ok) out.ok = false
    out.attempts.push({ ticks: masks.length, hash, want, status: w.status, exit: w.exit, marks, diverged })
  }
  if (w) {
    out.hash = sim.worldHash(w)
    out.status = w.status
    out.exit = w.exit
    if (rep.result?.hash && rep.result.hash !== out.hash) out.ok = false
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The solver                                                          */
/* ------------------------------------------------------------------ */

/** Ticks after something first shows on screen before the player acts on it. */
const REACT = 10
/** Ticks of standing still after a move that must also be safe. */
const TAIL = 12
/** Timings tried for a move that does not work at once. */
const WAITS = [6, 12, 20, 30, 45, 60, 90, 130, 180]
/** Route cost of a move that needs something done first (grime washed, a block bumped, a gate opened). */
const MODE_COST = 240
const JUMP_BIAS = 8
const HOVER_BIAS = 600
const LATE_BIAS = 600
/** As reach's: a tapped hover only when the map has no held way at all. */
const PULSE_BIAS = 36000
const TIGHT = 4
const HIT = 2000
/** No progress for this long (ticks of play) is stuck. */
const STALL = 60 * 60
/** More than this long (ticks of play) without getting nearer is worth a line in the report. */
const SLOW = 8 * 60
/** Simulated ticks one decision may spend before it settles for what it has. */
const DECISION_TICKS = 600000
const PLAN_BITS = MODE.GRIME | MODE.GATES | MODE.HIDDEN
const G_CODE = 'g'.charCodeAt(0)
const B_CODE = 'B'.charCodeAt(0)
const HIDDEN_CODES = ['H'.charCodeAt(0), 'h'.charCodeAt(0)]

const popcount = (m) => [1, 2, 4, 8].filter((b) => m & b).length
const mod = (a, n) => ((a % n) + n) % n

/**
 * opts: exit 'goal' | 'secret' (default 'goal'), tokens (also take the three gold tokens),
 * spotless (wash every car), seed (null: the world's default seed, as the play scene uses),
 * allowTight (may use jumps the map measures under 4 take-off ticks), lives (3), budget
 * (seconds of wall time before it gives up, 900), maxTicks (ticks of play before it gives up:
 * the level's clock times 3), log (fn(line) for progress), reach (a createReach to reuse),
 * flags (the flags the first attempt's world is made with, as the play scene starts Rival Row
 * with { rivalsBeaten: <save> }; they travel in the replay), ride (for a token only a car roof
 * reaches, which the map does not plan: ride(world, tick) is asked whenever a decision is due on
 * the ground, and returns null or a segment { why, done, input(world, prev) -> mask or null when
 * finished, after(world) } that plays until it ends; scripts/maxx/rides/mw01-tokens.mjs uses it).
 */
export function createSolver(sim, contract, level, options = {}) {
  const { TILE, MAXX_W, MAXX_H, VIEW_W, VIEW_H } = contract
  const T = sim.TUNING
  const opt = { exit: 'goal', tokens: false, spotless: false, seed: null, allowTight: false, lives: 3, budget: 900, log: null, ...options }
  const log = typeof opt.log === 'function' ? opt.log : () => {}
  const r = opt.reach ?? createReach(sim, contract, level)
  const IDLE = frameFor(0, 0)
  const stats = { simTicks: 0, decisions: 0, rollouts: 0, ms: 0 }
  const t0 = performance.now()

  /* ---------------- helpers ---------------- */
  const colOf = (p) => Math.floor((p.x + p.w / 2) / TILE)
  const feetRow = (p) => Math.floor((p.y + p.h - 1) / TILE)
  const placeOf = (w) => `${w.area.id} ${colOf(w.player)},${feetRow(w.player)}`
  const cx = (e) => e.x + e.w / 2
  const behavior = (e) => sim.getBehavior(e.kind)
  const entityBySlot = (w, slot) => w.entities.find((e) => e.slot === slot && !e.dead)
  const entityById = (w, id) => w.entities.find((e) => e.id === id && !e.dead)
  const flagOf = (e) => (typeof e.props?.flag === 'string' && e.props.flag !== '' ? e.props.flag : null)
  const nameOf = (e) => (e.kind === 'car' ? `${e.variant} car` : e.kind)
  /** Something that matters to a careful player: it can hurt, it is ground, it takes water, it sends cars. */
  function matters(e) {
    if (e.harmful || e.solid !== 'none') return true
    const b = behavior(e)
    return !!(b && (b.onSpray || b.countsAsCar || b.carCount))
  }
  function isCar(e) {
    const b = behavior(e)
    return !!(b && b.countsAsCar)
  }

  /* ---------------- planning modes and the graph ---------------- */
  const g0 = r.graph(0)
  const tokenTargets = r.targets.filter((t) => t.kind === 'token').sort((a, b) => a.token - b.token)
  const exitWanted = opt.exit === 'secret' ? 'secret' : 'goal'
  const hasExit = (g, type) => g.exits.some((e) => e.exit === type)
  /** The fewest reach modes (grime, gates, hidden) that make test(graph) true, or null. */
  function minimal(test, bits = PLAN_BITS) {
    const subsets = []
    for (let m = 0; m <= 15; m++) if ((m & bits) === m) subsets.push(m)
    subsets.sort((a, b) => popcount(a) - popcount(b) || a - b)
    for (const m of subsets) if (test(r.graph(m))) return m
    return null
  }
  const planNotes = []
  let M = 0
  const exitMode = minimal((g) => hasExit(g, exitWanted))
  const unreachable = []
  if (exitMode === null) {
    const withCars = minimal((g) => hasExit(g, exitWanted), 15)
    unreachable.push({ what: exitWanted === 'goal' ? 'the goal' : 'the secret exit', exit: exitWanted, needs: withCars })
  } else M |= exitMode
  const tokenModes = new Map()
  // Tokens only a car roof reaches, left to opt.ride: the map does not plan rides on cars.
  const rideTokens = []
  if (opt.tokens) {
    for (const t of tokenTargets) {
      const m = minimal((g) => g.touched.has(t.id))
      if (m === null) {
        const withCars = minimal((g) => g.touched.has(t.id), 15)
        if (withCars !== null && opt.ride) rideTokens.push(t)
        else unreachable.push({ what: `token ${t.token + 1}`, token: t, needs: withCars })
      } else {
        tokenModes.set(t.id, m)
        M |= m
      }
    }
  }
  const g = r.graph(M)
  if (M) planNotes.push(`planned with ${modeDelta(M, 0)}; the solver earns those in play`)

  // Edges that the base map has too need nothing done first.
  const baseSig = new Set()
  const sig = (e) => `${e.from}|${e.macro.id}|${e.tau}|${e.offset ?? ''}|${e.exit ?? e.to}`
  if (M) {
    for (const list of g0.edges.values()) for (const e of list) baseSig.add(sig(e))
    for (const e of g0.exits) baseSig.add(sig(e))
    for (const list of g0.touched.values()) for (const e of list) baseSig.add(sig(e))
  }
  const needsMode = (e) => M !== 0 && !baseSig.has(sig(e))
  const isJump = (e) => e.macro.ground === 'stand' || e.macro.ground === 'runup' || e.macro.ground === 'edge'
  const bans = new Set()
  const banWhy = new Map()
  let banVersion = 0
  const routeCost = (e) => (bans.has(e) ? Infinity : e.cost + (isJump(e) ? JUMP_BIAS : 0) + (e.hover ? HOVER_BIAS : 0) + (e.late ? LATE_BIAS : 0) + (e.pulse ? PULSE_BIAS : 0) + (needsMode(e) ? MODE_COST : 0))

  // Reverse edges, and the tile nodes of each area.
  const rev = new Map()
  const tileNodes = new Map()
  for (const [from, list] of g.edges) {
    for (const e of list) {
      if (!e.to) continue
      let l = rev.get(e.to)
      if (!l) rev.set(e.to, (l = []))
      l.push(e)
    }
    const n = r.nodes.get(from)
    if (n && n.kind === 'tile') {
      let l = tileNodes.get(n.area)
      if (!l) tileNodes.set(n.area, (l = []))
      l.push(n)
    }
  }

  /** Terminal moves of a goal: [{ from, cost, edge }]. */
  function terminals(goal) {
    const out = []
    if (goal.type === 'exit') for (const e of g.exits) if (e.exit === goal.exit) out.push({ from: e.from, cost: routeCost(e), edge: e })
    // A move that takes the thing and then runs on into an exit would end the level: not a way to take it.
    if (goal.type === 'touch') for (const e of g.touched.get(goal.id) ?? []) if (!e.res.exit) out.push({ from: e.from, cost: routeCost(e), edge: e })
    if (goal.type === 'nodes') for (const k of goal.keys) if (g.reached.has(k)) out.push({ from: k, cost: 0, edge: null })
    return out
  }
  /** Cheapest cost from every node to the goal: { dist: Map key -> cost, next: Map key -> { edge, terminal } }. */
  function reverseDijkstra(goal) {
    const dist = new Map()
    const next = new Map()
    const heap = []
    const push = (c, k) => {
      heap.push([c, k])
      for (let i = heap.length - 1; i > 0; ) {
        const p = (i - 1) >> 1
        if (heap[p][0] <= heap[i][0]) break
        ;[heap[i], heap[p]] = [heap[p], heap[i]]
        i = p
      }
    }
    const pop = () => {
      const top = heap[0]
      const last = heap.pop()
      if (heap.length) {
        heap[0] = last
        for (let i = 0; ; ) {
          const l = 2 * i + 1
          const rr = l + 1
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr
          if (m === i) break
          ;[heap[i], heap[m]] = [heap[m], heap[i]]
          i = m
        }
      }
      return top
    }
    for (const t of terminals(goal)) {
      if (!(t.cost < (dist.get(t.from) ?? Infinity))) continue
      dist.set(t.from, t.cost)
      next.set(t.from, { edge: t.edge, terminal: true })
      push(t.cost, t.from)
    }
    while (heap.length) {
      const [c, k] = pop()
      if (c > dist.get(k)) continue
      for (const e of rev.get(k) ?? []) {
        const nc = c + routeCost(e)
        if (nc < (dist.get(e.from) ?? Infinity)) {
          dist.set(e.from, nc)
          next.set(e.from, { edge: e, terminal: false })
          push(nc, e.from)
        }
      }
    }
    return { dist, next }
  }
  const routes = new Map()
  const goalKey = (goal) => `${goal.type}|${goal.exit ?? goal.id ?? [...(goal.keys ?? [])].join(',')}`
  /** The cost table for a goal, with every too-tight jump on the way from `from` banned first. */
  function routeFor(goal, from) {
    const key = goalKey(goal)
    let rt = routes.get(key)
    for (let round = 0; round < 30; round++) {
      if (!rt || rt.version !== banVersion) {
        rt = { ...reverseDijkstra(goal), version: banVersion }
        routes.set(key, rt)
      }
      if (opt.allowTight || !from) return rt
      // Walk the way on from here; ban any jump the map measured as too tight, and look again.
      let changed = false
      const seen = new Set()
      for (let k = from, n = 0; k && n < 400 && !seen.has(k); n++) {
        seen.add(k)
        const step = rt.next.get(k)
        if (!step || !step.edge) break
        const e = step.edge
        if (isJump(e)) {
          const win = r.windowOf(g, e)
          if (win && ((win.works !== null && win.works < TIGHT) || win.fine)) {
            bans.add(e)
            banWhy.set(e, win.fine ? 'pixel-exact (one run-up to the pixel and one hover start)' : `too tight (works on ${win.works} of ${win.tried} ${win.unit})`)
            changed = true
            break
          }
        }
        if (step.terminal) break
        k = e.to
      }
      if (!changed) return rt
      banVersion++
    }
    return rt
  }
  /** What hurt it on the moves it gave up in play, and how often: the reason a level is stuck. */
  const banBlame = new Map()
  function ban(e, why, blamed = null) {
    if (bans.has(e)) return
    bans.add(e)
    banWhy.set(e, why)
    if (blamed) banBlame.set(blamed, (banBlame.get(blamed) ?? 0) + 1)
    banVersion++
  }

  /* ---------------- movers: their exact cycle, and where in it one is ---------------- */
  const fine = new Map()
  function timelineOf(area, slot) {
    const key = `${area}|${slot}`
    if (fine.has(key)) return fine.get(key)
    let tl = null
    const mv = r.movers(area).list.find((m) => m.slot === slot)
    if (mv) {
      const w = copyWorld(r.base(0).per.get(area))
      const e = w.entities.find((x) => x.slot === slot)
      const ghost = w.player
      ghost.state = 'warp'
      const states = []
      for (let t = 0; t < mv.period && e && !e.dead; t++) {
        states.push({ x: e.x, y: e.y, facing: e.facing, vars: { ...e.vars } })
        ghost.x = e.x + e.w / 2 - MAXX_W / 2
        ghost.y = -1e6
        ghost.vy = 0
        sim.stepWorld(w, IDLE)
        w.events.length = 0
      }
      if (states.length) tl = { period: states.length, states, mover: mv }
    }
    fine.set(key, tl)
    return tl
  }
  /** Where in its cycle a mover is now (ticks), by its state. */
  function phaseOf(area, slot, e) {
    const tl = timelineOf(area, slot)
    if (!tl) return 0
    let best = 0
    let bd = Infinity
    for (let i = 0; i < tl.states.length; i++) {
      const s = tl.states[i]
      let d = Math.abs(s.x - e.x) + Math.abs(s.y - e.y) + (s.facing !== e.facing ? 500 : 0)
      for (const k in s.vars) d += Math.abs((e.vars[k] ?? 0) - s.vars[k]) * 64
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }
  const moverInfo = (area, slot) => r.movers(area).list.find((m) => m.slot === slot) ?? null
  /** The mover a phase-bound move depends on: the one it lands on or leaves, else the nearest one. */
  function moverFor(e) {
    const from = r.nodes.get(e.from)
    if (from?.kind === 'mover') return { area: from.area, slot: from.slot }
    const to = e.to ? r.nodes.get(e.to) : null
    if (to?.kind === 'mover') return { area: to.area, slot: to.slot }
    const list = r.movers(from.area).list
    if (!list.length) return null
    let best = null
    for (const m of list) {
      const d = from.col < m.c0 ? m.c0 - from.col : from.col > m.c1 ? from.col - m.c1 : 0
      if (!best || d < best.d) best = { d, m }
    }
    return { area: from.area, slot: best.m.slot }
  }
  /** Does a move only work at some moments of a lift's cycle? */
  const phaseBound = (e) => e.cost > e.ticks || r.nodes.get(e.from)?.kind === 'mover' || (e.to && r.nodes.get(e.to)?.kind === 'mover')

  /* ---------------- where Maxx is, as a place in the graph ---------------- */
  function resolve(w) {
    const p = w.player
    const area = w.area.id
    if (p.ridingId) {
      const s = w.entities.find((e) => e.id === p.ridingId)
      if (s && s.slot >= 0 && moverInfo(area, s.slot)) {
        const mv = moverInfo(area, s.slot)
        const ph = phaseOf(area, s.slot, s)
        const k0 = Math.round(ph / 15) % mv.buckets
        for (let dk = 0; dk <= mv.buckets; dk++) {
          for (const k of [mod(k0 + dk, mv.buckets), mod(k0 - dk, mv.buckets)]) {
            const key = `${area}|m${s.slot}|${k}`
            if (g.reached.has(key)) return { key, mover: s.slot, phase: ph }
          }
        }
      }
    }
    const col = colOf(p)
    const feetY = Math.round((p.y + p.h) * 100) / 100
    const exact = `${area}|${col}|${feetY}`
    if (g.reached.has(exact)) return { key: exact }
    let best = null
    for (const n of tileNodes.get(area) ?? []) {
      if (Math.abs(n.feetY - feetY) > 2) continue
      const dx = Math.abs(n.col - col)
      if (dx <= 3 && (!best || dx < best.dx)) best = { key: n.key, dx }
    }
    return best ? { key: best.key, near: true } : null
  }

  /* ---------------- what the player has seen ---------------- */
  // knownAt: entity id -> the tick (of this attempt) from which the player may act on it.
  let knownAt = new Map()
  const learned = new Set()
  let attemptTick = 0
  // What the player expects: the world as believed at the last decision, stepped on with the
  // same input as the real one. Something made during play (a clod, a wave) that the
  // expectation has too, in the same place, was foreseen from a telegraph the player saw: it
  // needs no reaction time. Anything else does.
  let expect = null
  let foreseenIds = new Set()
  function foreseen(w, e) {
    if (!expect || expect.area.id !== w.area.id) return false
    for (const m of expect.entities) {
      if (m.dead || m.kind !== e.kind) continue
      if (Math.abs(cx(m) - cx(e)) < 32 && Math.abs(m.y - e.y) < 32) return true
    }
    return false
  }
  function look(w) {
    const c = w.camera
    for (const e of w.entities) {
      if (e.dead || knownAt.has(e.id)) continue
      if (e.slot >= 0 && learned.has(`${w.area.id}|${e.slot}`)) {
        knownAt.set(e.id, 0)
        continue
      }
      const vis = e.w <= 0 && e.h <= 0 ? e.x >= c.x && e.x <= c.x + VIEW_W && e.y >= c.y && e.y <= c.y + VIEW_H : e.x < c.x + VIEW_W && e.x + e.w > c.x && e.y < c.y + VIEW_H && e.y + e.h > c.y
      if (!vis) continue
      if (e.slot < 0 && foreseen(w, e)) {
        knownAt.set(e.id, attemptTick)
        foreseenIds.add(e.id)
      } else knownAt.set(e.id, attemptTick + REACT)
      if (e.slot >= 0) learned.add(`${w.area.id}|${e.slot}`)
    }
  }
  const known = (e) => (knownAt.get(e.id) ?? Infinity) <= attemptTick
  /** The world as the player believes it: everything that matters and was not seen long enough is left out. */
  function belief(real) {
    const w = copyWorld(real)
    for (const id of Object.keys(w.areas)) {
      const list = w.areas[id].entities
      if (!list) continue
      let k = 0
      for (const e of list) if (!matters(e) || known(e)) list[k++] = e
      list.length = k
    }
    return w
  }

  /* ---------------- segments: what the controller does, tick by tick ---------------- */
  // A plan is a list of segment specs. makeSeg(spec) gives a controller with
  //   input(w, prev) -> the mask for this tick, or null when it is over (before this tick)
  //   after(w)       after the tick was stepped
  // and fields done, ok. The same controllers run on copies (look-ahead) and in the real world.
  function makeSeg(spec) {
    switch (spec.t) {
      case 'idle':
        return idleSeg(spec)
      case 'align':
        return alignSeg(spec)
      case 'macro':
        return macroSeg(spec)
      case 'phase':
        return phaseSeg(spec)
      case 'spray':
        return spraySeg(spec)
      case 'run':
        return runSeg(spec)
      case 'jumpspray':
        return jumpSpraySeg(spec)
      case 'air':
        return airSeg(spec)
    }
    throw new Error(`unknown segment '${spec.t}'`)
  }
  /** Steer in the air: hold spec.mask (jump only while rising) until he lands. */
  function airSeg(spec) {
    let t = 0
    return {
      done: false,
      ok: true,
      input(w) {
        const p = w.player
        if ((t++ > 0 && p.onGround) || t > 300 || p.state !== 'normal') return null
        return (spec.mask & (L | R | D | S)) | (spec.mask & J && p.vy < 0 ? J : 0)
      },
      after() {},
    }
  }
  /**
   * Something new came into sight while he is in the air: does the flight still land safe? If not,
   * the first stick (and hover) choice for the rest of it that does. null: keep the plan.
   */
  function decideAir(bel, prev) {
    const p = bel.player
    const d = p.vx >= 0 ? 1 : -1
    const fwd = d > 0 ? R : L
    const back = d > 0 ? L : R
    const opts = [
      [fwd | J, 'keep going'],
      [J, 'let go of the stick'],
      [back | J, `turn back ${d > 0 ? 'left' : 'right'}`],
      [fwd | D | S, 'hover on'],
      [D | S, 'hover, stick let go'],
      [back | D | S, `hover back ${d > 0 ? 'left' : 'right'}`],
    ]
    for (const [mask, words] of opts) {
      const out = rollout(bel, [{ t: 'air', mask }, { t: 'idle', n: 24 }], { prev, max: 330 })
      if (out.hurt || out.dead) continue
      return mask === (fwd | J) ? null : { specs: [{ t: 'air', mask }], why: `in the air, something new in sight: ${words}` }
    }
    return null
  }
  function idleSeg(spec) {
    let n = spec.n
    return {
      done: false,
      ok: true,
      input() {
        if (n-- <= 0) return null
        return 0
      },
      after() {},
    }
  }
  function grip(p) {
    return p.onGround && p.floor ? (sim.TILE_INFO[p.floor]?.grip ?? 1) : 1
  }
  /** Walk to box x (or to x on a moving platform: spec.slot) and stop there. */
  function alignSeg(spec) {
    let t = 0
    const tol = spec.tol ?? 1
    const seg = {
      done: false,
      ok: false,
      input(w) {
        const p = w.player
        if (seg.done) return null
        if (++t > (spec.max ?? 160)) return (seg.done = true), null
        if (p.state !== 'normal' || !p.onGround) return 0
        let target = spec.x
        if (spec.slot !== undefined && spec.slot !== null) {
          const m = entityBySlot(w, spec.slot)
          if (!m) return (seg.done = true), null
          target = m.x + spec.x
        }
        const dx = target - p.x
        if (Math.abs(dx) <= tol && Math.abs(p.vx) < 0.5) {
          seg.done = true
          seg.ok = true
          return null
        }
        const decel = T.groundDecel * grip(p)
        const stop = (p.vx * Math.abs(p.vx)) / (2 * decel)
        const want = dx - stop
        if (Math.abs(want) <= 0.4 || (Math.abs(dx) <= tol && Math.sign(p.vx) === Math.sign(dx))) return 0
        return (want > 0 ? R : L) | (Math.abs(dx) > 40 ? 0 : HALF)
      },
      after() {},
    }
    return seg
  }
  /** One of reach's macros, driven exactly as reach plays it (see play() in lib/reach.mjs). */
  function macroSeg(spec) {
    const macro = r.macroById(spec.id)
    if (!macro) throw new Error(`no macro '${spec.id}'`)
    const d = macro.d
    const dirBit = d > 0 ? R : d < 0 ? L : 0
    const jumpRule = spec.jumpAt ?? (macro.ground === 'stand' ? 0 : macro.ground === 'runup' ? macro.run : macro.ground === 'edge' ? 'edge' : null)
    const firstPress = jumpRule === 0 || macro.ground === 'door'
    let stage = 'ground'
    let t = 0
    let jumpT = -1
    let rest = 0
    let startCol = 0
    let walkCols = 0
    let lastCol = 0
    let started = false
    let fall = 0
    const airDir = (vy) => {
      switch (macro.air) {
        case 'hold':
          return dirBit
        case 'late':
          return vy < 0 ? 0 : dirBit
        case 'turn':
          return vy < 0 ? dirBit : d > 0 ? L : R
        case 'stop':
          return vy < 0 ? dirBit : 0
        default:
          return 0
      }
    }
    const seg = {
      done: false,
      ok: false,
      airborne: false,
      why: undefined,
      macro,
      input(w, prev) {
        if (seg.done) return null
        const p = w.player
        if (!started) {
          // A jump or a push up must be a fresh press: let go for a tick first if it is held.
          if (firstPress && prev & (J | U)) return 0
          if (p.state !== 'normal' && !w.warp) return 0
          started = true
          startCol = lastCol = colOf(p)
        }
        let mask = 0
        if (stage === 'ground') {
          const col = colOf(p)
          if (macro.ground === 'pipe') {
            mask = t < 6 ? D : 0
            if (t >= 6 && !w.warp) stage = 'settle'
          } else if (macro.ground === 'door') {
            mask = t < 2 ? U : 0
            if (t >= 2 && !w.warp) stage = 'settle'
          } else if (jumpRule === null) {
            const off = !p.onGround && p.airT > 1
            if (off) {
              stage = 'air'
              seg.airborne = true
            } else if (macro.ground === 'step' && (col !== startCol || t >= 24 || (t > 0 && p.hitWall === d))) stage = 'settle'
            else if (macro.ground === 'run' && ((t > 0 && p.hitWall === d) || t >= (macro.limit ?? 150))) stage = 'settle'
            else if (macro.ground === 'walk') {
              if (col !== lastCol) {
                walkCols++
                lastCol = col
              }
              if (walkCols >= 2 || t >= 60 || (t > 0 && p.hitWall === d)) stage = 'settle'
            }
            if (stage === 'ground') mask = dirBit | (macro.ground === 'walk' ? HALF : 0)
          } else {
            let press = false
            if (jumpRule === 'edge') {
              if (!p.onGround && t > 0) seg.why = 'lip'
              else if (t > 0 && p.hitWall === d) seg.why = 'wall'
              else if (t >= 60) {
                seg.done = true
                return null
              }
              press = seg.why !== undefined && !(macro.coyote && seg.why === 'lip' && p.coyote > 1)
            } else press = t >= jumpRule
            if (press) {
              stage = 'air'
              jumpT = t
              mask = J | dirBit
            } else mask = dirBit
          }
        }
        if (stage === 'air' || stage === 'settle') {
          if (stage === 'air' && jumpT >= 0 && t - jumpT < macro.hold) mask |= J
          if (stage === 'air' && t === jumpT) mask = J | (macro.air === 'late' ? 0 : dirBit)
          else if (!p.onGround || (stage === 'air' && t - jumpT < 2)) {
            mask |= airDir(p.vy)
            if (wantsHover(macro, p, fall)) mask |= D | S
          }
        }
        return mask
      },
      after(w) {
        if (seg.done) return
        const p = w.player
        fall = FALL.next(fall, p)
        if (w.status !== 'play') {
          seg.done = true
          seg.ok = w.status === 'clear'
          return
        }
        if (stage === 'air' && p.onGround && t - jumpT >= 1) stage = 'settle'
        if (stage === 'settle') {
          if (w.warp || p.state !== 'normal' || !p.onGround) rest = 0
          else if (p.ridingId) rest = p.vx === 0 ? rest + 1 : 0
          else rest = p.vx === 0 && p.y === p.py ? rest + 1 : 0
          if (rest >= 2) {
            seg.done = true
            seg.ok = true
          }
        }
        t++
        if (t >= 480) seg.done = true
      },
    }
    return seg
  }
  /** Wait until a mover is at a moment of its cycle (spec.at, ticks), or give up after spec.max. */
  function phaseSeg(spec) {
    const tl = timelineOf(spec.area, spec.slot)
    let phase = null
    let t = 0
    const seg = {
      done: false,
      ok: false,
      input(w) {
        if (seg.done) return null
        const e = entityBySlot(w, spec.slot)
        if (!tl || !e || w.area.id !== spec.area) return (seg.done = true), null
        if (phase === null) phase = phaseOf(spec.area, spec.slot, e)
        if (mod(spec.at - phase, tl.period) === 0) {
          seg.done = true
          seg.ok = true
          return null
        }
        if (++t > tl.period + 4) return (seg.done = true), null
        return 0
      },
      after(w) {
        if (phase !== null && w.status === 'play' && !w.warp) phase = (phase + 1) % tl.period
      },
    }
    return seg
  }
  /**
   * Spray, facing spec.dir, forward or up (spec.aim), until spec.until holds or spec.max ticks:
   *   { id }            that entity is gone, washed (a car) or harmless
   *   { boss: true }    never (a fight: spray for the ticks given)
   *   { cells: [...] }  those grime blocks are gone
   *   { flag, min }     the flag is set
   */
  function spraySeg(spec) {
    let t = 0
    const seg = {
      done: false,
      ok: false,
      input(w) {
        if (seg.done) return null
        if (untilMet(w, spec.until)) {
          seg.done = true
          seg.ok = true
          return null
        }
        if (t >= spec.max) return (seg.done = true), null
        t++
        const p = w.player
        let m = S | (spec.aim === 'up' ? U : 0)
        if (p.facing !== spec.dir && t <= 3) m |= spec.dir > 0 ? R : L
        return m
      },
      after() {},
    }
    return seg
  }
  function untilMet(w, u) {
    if (!u) return false
    if (u.id !== undefined) {
      const e = entityById(w, u.id)
      if (!e) return true
      if (e.kind === 'car' || isCar(e)) return e.state === 'clean'
      return !e.harmful && !behavior(e)?.onSpray
    }
    if (u.cells) return u.cells.every(([a, c, row]) => cellCode(w, a, c, row) !== G_CODE)
    if (u.flag) return (w.flags[u.flag] ?? 0) >= u.min
    return false
  }
  function cellCode(w, area, c, row) {
    const gr = w.areas[area]?.grid
    if (!gr || c < 0 || row < 0 || c >= gr.w || row >= gr.h) return 32
    return gr.t[row * gr.w + c]
  }
  function runSeg(spec) {
    let n = spec.n
    return {
      done: false,
      ok: true,
      input() {
        if (n-- <= 0) return null
        return (spec.dir > 0 ? R : L) | (spec.spray ? S : 0)
      },
      after() {},
    }
  }
  /** A jump straight up with the gun on (forward, or up), facing spec.dir, until he lands. */
  function jumpSpraySeg(spec) {
    let t = 0
    let pressed = false
    const seg = {
      done: false,
      ok: true,
      input(w, prev) {
        if (seg.done) return null
        const p = w.player
        if (!pressed) {
          if (prev & J) return 0
          if (!p.onGround || p.state !== 'normal') {
            if (++t > 40) return (seg.done = true), null
            return 0
          }
          pressed = true
          t = 0
          return J | S | (spec.up ? U : 0) | (p.facing !== spec.dir ? (spec.dir > 0 ? R : L) : 0)
        }
        t++
        if (t > 2 && p.onGround) return (seg.done = true), null
        if (t > 150) return (seg.done = true), null
        return (t < (spec.hold ?? 40) ? J : 0) | S | (spec.up ? U : 0) | (spec.drift ? (spec.dir > 0 ? R : L) : 0)
      },
      after() {},
    }
    return seg
  }

  /* ---------------- playing a plan ---------------- */
  /**
   * Step `w` through a plan. Returns { ticks, hurt, dead, exit, status, ok (every segment that
   * cares reached its aim), segs, path (Maxx's x, y per tick when opts.path), blame, hitAt }.
   * opts: max (ticks), prev (the mask of the tick before), record (array to push masks into),
   * path (record the trajectory), stopOnHurt (default true).
   */
  function runPlan(w, specs, opts = {}) {
    const max = opts.max ?? 1500
    let prev = opts.prev ?? 0
    const out = { ticks: 0, hurt: 0, dead: false, exit: null, status: w.status, ok: true, path: opts.path ? [] : null, blame: null, hitAt: null, prev }
    let i = 0
    let cur = null
    const p = w.player
    let pips = p.pips
    while (out.ticks < max && w.status === 'play') {
      if (!cur) {
        if (i >= specs.length) break
        cur = makeSeg(specs[i++])
      }
      const m = cur.input(w, prev)
      if (m === null) {
        if (cur.ok === false) out.ok = false
        cur = null
        continue
      }
      // Something that hurts and is gone the same tick (a clod bursts on him) must still be named.
      const close = nearestHarm(w)
      sim.stepWorld(w, frameFor(prev, m))
      const hit = tookHit(w, pips)
      w.events.length = 0
      prev = m & 63
      out.ticks++
      stats.simTicks++
      if (opts.record) opts.record.push(m)
      cur.after(w)
      if (out.path) out.path.push(p.x, p.y)
      if (hit) {
        out.hurt++
        if (!out.blame) {
          out.blame = blame(w, close)
          out.hitAt = placeOf(w)
        }
      }
      pips = p.pips
      if (w.status !== 'play') break
      if (out.hurt && opts.stopOnHurt !== false) break
      if (cur.done) {
        if (cur.ok === false) out.ok = false
        cur = null
      }
    }
    if (cur && !cur.done) out.ok = false
    if (cur === null && i < specs.length) out.ok = false
    out.prev = prev
    out.status = w.status
    out.exit = w.exit
    out.dead = w.status === 'grimed' || w.status === 'timeup'
    if (out.dead && !out.blame) {
      out.blame = blame(w)
      out.hitAt = placeOf(w)
    }
    return out
  }
  /**
   * Did the tick just stepped hurt him? Fewer pips, or the hurt itself: a bubble picked up on the
   * same tick heals the pip at once, and that is still a hit (read before world.events is emptied).
   */
  function tookHit(w, pipsBefore) {
    if (w.player.pips < pipsBefore) return true
    for (const ev of w.events) if (ev.type === 'sfx' && ev.id === 'hurt') return true
    return false
  }
  /** The harmful thing nearest Maxx (within 40 px), described, or null: taken before a tick in case it is gone after. */
  function nearestHarm(w) {
    const p = w.player
    let best = null
    for (const e of w.entities) {
      if (e.dead || !e.harmful) continue
      const gap = Math.max(e.x - (p.x + p.w), p.x - (e.x + e.w), e.y - (p.y + p.h), p.y - (e.y + e.h))
      if (gap < 40 && (!best || gap < best.gap)) best = { gap, e }
    }
    return best ? `${nameOf(best.e)} (${w.area.id} ${Math.floor(cx(best.e) / TILE)},${Math.floor((best.e.y + best.e.h - 1) / TILE)})` : null
  }
  /** What hurt him: the harmful thing touching him, a hazard tile, a fall, the clock. `before`: nearestHarm() of the tick before. */
  function blame(w, before = null) {
    const p = w.player
    if (w.status === 'timeup') return 'the clock ran out'
    if (p.y > w.grid.h * TILE) return 'a fall out of the bottom of the area'
    for (let ty = Math.floor((p.y + 8) / TILE); ty <= Math.floor((p.y + p.h) / TILE); ty++) {
      for (let tx = Math.floor((p.x + 4) / TILE); tx <= Math.floor((p.x + p.w - 4) / TILE); tx++) {
        const info = sim.tileInfoAt(w, tx, ty)
        if (info.hazard === 'sludge') return `sludge at ${w.area.id} ${tx},${ty}`
      }
    }
    const now = nearestHarm(w)
    if (now) return now
    if (before) return before
    for (let ty = Math.floor(p.y / TILE); ty <= Math.floor((p.y + p.h) / TILE); ty++) {
      for (let tx = Math.floor(p.x / TILE); tx <= Math.floor((p.x + p.w) / TILE); tx++) {
        const info = sim.tileInfoAt(w, tx, ty)
        if (info.hazard !== 'none') return `${info.name} at ${w.area.id} ${tx},${ty}`
      }
    }
    return 'something gone at once (squeezed by a solid, or a thing that vanished as it hit)'
  }

  /* ---------------- obstacles a move needs cleared ---------------- */
  const traces = new Map()
  /** Every cell Maxx's box passes through on a move, and the cells he stands on, in the planning mode. */
  function traceOf(e) {
    if (traces.has(e)) return traces.get(e)
    let tr = null
    const node = r.nodes.get(e.from)
    const w = node ? r.place(e.mode ?? M, node, e.tau, e.offset, e.macro.d || 1) : null
    if (w) {
      const cells = new Map()
      const feet = new Map()
      const seg = macroSeg({ id: e.macro.id })
      let prev = 0
      const p = w.player
      for (let i = 0; i < 520; i++) {
        const m = seg.input(w, prev)
        if (m === null) break
        sim.stepWorld(w, frameFor(prev, m))
        w.events.length = 0
        w.droplets.length = 0
        prev = m & 63
        seg.after(w)
        const a = w.area.id
        const c0 = Math.floor(p.x / TILE)
        const c1 = Math.floor((p.x + p.w - 0.01) / TILE)
        for (let row = Math.floor(p.y / TILE); row <= Math.floor((p.y + p.h - 0.01) / TILE); row++) for (let c = c0; c <= c1; c++) cells.set(`${a}|${c}|${row}`, [a, c, row])
        if (p.onGround) {
          const row = Math.floor((p.y + p.h + 1) / TILE)
          for (let c = c0; c <= c1; c++) feet.set(`${a}|${c}|${row}`, [a, c, row])
        }
        if (seg.done || w.status !== 'play') break
      }
      tr = { cells: [...cells.values()], feet: [...feet.values()] }
    }
    traces.set(e, tr)
    return tr
  }
  /** What stands in the way of a move in the real world: grime to wash, hidden blocks to bump, bricks to break, a flag to set. */
  function obstaclesOf(real, e) {
    // Bricks the map broke before it found this move, still whole here.
    const bricks = r
      .needsBricks(e)
      .map((id) => {
        const [area, at] = id.split('@')
        const [c, row] = at.split(',').map(Number)
        return [area, c, row]
      })
      .filter((cell) => cellCode(real, ...cell) === B_CODE)
    // Flags the map set by touching a button before it found this move, not yet set here.
    const pressed = r.needsFlags(e).filter((f) => (real.flags[f.flag] ?? 0) < f.min)
    if (!needsMode(e)) return bricks.length || pressed.length ? { grime: [], hidden: [], flags: pressed, bricks } : null
    const tr = traceOf(e)
    const out = { grime: [], hidden: [], flags: [...pressed], bricks }
    if (tr) {
      if (M & MODE.GRIME) for (const cell of tr.cells) if (cellCode(real, ...cell) === G_CODE) out.grime.push(cell)
      if (M & MODE.HIDDEN) for (const cell of tr.feet) if (HIDDEN_CODES.includes(cellCode(real, ...cell))) out.hidden.push(cell)
      if (M & MODE.GATES) {
        const areas = new Set(tr.cells.map((c) => c[0]))
        for (const a of areas) {
          for (const ent of real.areas[a]?.entities ?? []) {
            const flag = flagOf(ent)
            if (!flag || ent.dead || ent.solid !== 'full') continue
            const hit = tr.cells.some(([ca, c, row]) => ca === a && c * TILE < ent.x + ent.w && (c + 1) * TILE > ent.x && row * TILE < ent.y + ent.h && (row + 1) * TILE > ent.y)
            if (hit) out.flags.push({ flag, min: typeof ent.props.min === 'number' ? ent.props.min : 1, what: `${ent.kind} at ${a} ${Math.floor(ent.x / TILE)},${Math.floor((ent.y + ent.h - 1) / TILE)}` })
          }
        }
      }
    }
    if (M & MODE.GATES && e.macro.id === 'door') {
      const from = r.nodes.get(e.from)
      const fx = from.x + MAXX_W / 2
      for (const ent of real.areas[from.area]?.entities ?? []) {
        const flag = flagOf(ent)
        if (ent.kind !== 'door' || !flag || ent.state !== 'locked') continue
        if (fx >= ent.x - 2 && fx <= ent.x + ent.w + 2) out.flags.push({ flag, min: typeof ent.props.min === 'number' ? ent.props.min : 1, what: `the locked door at ${from.area} ${Math.floor(cx(ent) / TILE)},${Math.floor((ent.y + ent.h - 1) / TILE)}` })
      }
    }
    if (!out.grime.length && !out.hidden.length && !out.flags.length && !out.bricks.length) return null
    return out
  }

  /* ---------------- goals ---------------- */
  // The goal stack: the level's targets in order (tokens, then the exit), with subgoals pushed
  // on top while something must be done first (wash, bump, set a flag).
  let stack = []
  /** Car id -> the tick SPOTLESS last failed to wash it. */
  const missedCars = new Map()
  function goalDone(w, goal) {
    switch (goal.type) {
      case 'exit':
        return w.status === 'clear'
      case 'touch':
        if (goal.token !== undefined) return w.stats.tokens[goal.token]
        return touchDone(w, goal)
      case 'wash':
        return goal.cells.every((c) => cellCode(w, ...c) !== G_CODE)
      case 'bump':
        return !HIDDEN_CODES.includes(cellCode(w, ...goal.cell))
      case 'break':
        return cellCode(w, ...goal.cell) !== B_CODE
      case 'flag':
        return (w.flags[goal.flag] ?? 0) >= goal.min
      case 'nodes':
        return false
    }
    return false
  }
  function touchDone(w, goal) {
    const area = w.areas[goal.area]
    if (!area?.entities) return false
    const e = area.entities.find((x) => x.slot === goal.slot)
    return !e || e.dead || e.state !== goal.state0
  }
  function goalLabel(goal) {
    switch (goal.type) {
      case 'exit':
        return goal.exit === 'goal' ? 'the goal' : 'the secret exit'
      case 'touch':
        return goal.label
      case 'wash':
        return `wash the grime at ${goal.cells.map((c) => `${c[0]} ${c[1]},${c[2]}`).join(' ')}`
      case 'bump':
        return `bump the hidden block at ${goal.cell[0]} ${goal.cell[1]},${goal.cell[2]}`
      case 'break':
        return `break the brick at ${goal.cell[0]} ${goal.cell[1]},${goal.cell[2]}`
      case 'flag':
        return `open ${goal.what} (flag '${goal.flag}')`
      case 'nodes':
        return goal.label
    }
    return goal.type
  }

  /* ---------------- look-ahead ---------------- */
  let decisionTicks = 0
  function rollout(base, specs, opts = {}) {
    stats.rollouts++
    const w = copyWorld(base)
    const startTicks = stats.simTicks
    const out = runPlan(w, specs, { max: opts.max ?? 1500, prev: opts.prev ?? 0, path: opts.path })
    decisionTicks += stats.simTicks - startTicks
    out.w = w
    return out
  }
  /**
   * Is it safe to be where a plan ends? Standing still for TAIL ticks must be; and with a threat
   * coming (within 8 tiles), one of a few simple answers (stand, spray at it, back off and spray,
   * jump over it, jump up) must keep him unhurt for the next 90 ticks.
   */
  function tailSafe(w) {
    const c = copyWorld(w)
    const out = runPlan(c, [{ t: 'idle', n: TAIL }], { max: TAIL + 2 })
    decisionTicks += out.ticks
    if (out.hurt || out.dead) return false
    const th = threats(w, 8 * TILE).filter((t) => t.coming)
    if (!th.length) return true
    const t = th[0]
    const aim = t.above ? 'up' : 'fwd'
    const answers = [
      [{ t: 'idle', n: 90 }],
      [{ t: 'spray', dir: t.dir, aim, max: 90, until: { id: t.e.id } }, { t: 'idle', n: 30 }],
      [{ t: 'run', dir: -t.dir, n: 16 }, { t: 'spray', dir: t.dir, aim, max: 74, until: { id: t.e.id } }, { t: 'idle', n: 30 }],
      [{ t: 'macro', id: t.dir > 0 ? 'jump-right' : 'jump-left' }, { t: 'idle', n: 20 }],
      [{ t: 'macro', id: 'up' }, { t: 'idle', n: 20 }],
    ]
    for (const a of answers) {
      const o = rollout(w, a, { max: 120 })
      if (!o.hurt && !o.dead) return true
    }
    return false
  }
  /**
   * The known threats near Maxx, nearest first: harmful things, and dirty cars. `coming`: it is
   * still, or heading his way.
   */
  function threats(w, range = 9 * 32) {
    const p = w.player
    const list = []
    for (const e of w.entities) {
      if (e.dead || !e.active) continue
      const car = isCar(e)
      if (!(e.harmful || (car && e.state !== 'clean'))) continue
      const dx = cx(e) - (p.x + p.w / 2)
      const dy = e.y + e.h / 2 - (p.y + p.h / 2)
      if (Math.abs(dx) > range || Math.abs(dy) > 6 * TILE) continue
      const vx = e.x - e.px
      list.push({ e, d: Math.hypot(dx, dy), dir: dx >= 0 ? 1 : -1, above: e.y + e.h < p.y + 8, coming: Math.abs(vx) < 0.05 || dx * vx < 0 })
    }
    return list.sort((a, b) => a.d - b.d)
  }
  /**
   * About the ticks it will take to deal with what is still coming: a dirty car or a critter
   * costs 2 ticks of spray a point of dirt, and a little more to get set. Falls as they are washed.
   */
  function threatLoad(w) {
    let n = 0
    for (const t of threats(w, 10 * TILE)) if (t.coming) n += 40 + Math.min(80, Math.max(0, t.e.hp)) * 2
    return n
  }

  /** How good a place is for a goal: its cost to go, or an estimate for a place off the map. */
  function costHere(w, rt) {
    const res = resolve(w)
    if (!res) return Infinity
    const c = rt.dist.get(res.key)
    if (c === undefined) return Infinity
    if (res.near) {
      const n = r.nodes.get(res.key)
      return c + Math.abs(n.x - w.player.x) / 3
    }
    return c
  }

  /* ---------------- decisions ---------------- */
  // Every decision returns { specs, why, note, path } for the real world, or null to idle a moment.
  let lastFailure = null
  let decisionPrev = 0
  function decide(real, bel) {
    if (real.boss) return decideFight(real, bel)
    if (opt.spotless) {
      const d = decideSpotless(real, bel)
      if (d) return d
    }
    for (let depth = 0; depth < 6; depth++) {
      while (stack.length && goalDone(real, stack[stack.length - 1])) stack.pop()
      if (!stack.length) return null
      const goal = stack[stack.length - 1]
      if (goal.type === 'wash') return decideWash(real, bel, goal)
      if (goal.type === 'flag') {
        const d = decideFlag(real, bel, goal)
        if (d === 'retry') continue
        return d
      }
      if (goal.type === 'bump' || goal.type === 'break') {
        const d = goal.type === 'bump' ? decideBump(real, bel, goal) : decideBreak(real, bel, goal)
        if (d === 'retry') continue
        return d
      }
      const d = decideRoute(real, bel, goal)
      if (d === 'retry') continue
      return d
    }
    return null
  }

  /** The best move on from a place: for a lift, the best moment of its cycle to leave it as well. */
  function nextMove(cur, rt) {
    if (cur.mover !== undefined) {
      const [area] = cur.key.split('|')
      const mv = moverInfo(area, cur.mover)
      const tl = timelineOf(area, cur.mover)
      let best = null
      for (let k = 0; k < mv.buckets; k++) {
        const key = `${area}|m${cur.mover}|${k}`
        if (!g.reached.has(key)) continue
        const at = mod(k * 15 + 1, tl.period)
        const wait = mod(at - cur.phase, tl.period)
        for (const e of g.edges.get(key) ?? []) {
          if (!e.to) continue
          const to = r.nodes.get(e.to)
          if (to?.kind === 'mover' && to.slot === cur.mover) continue
          const c = wait + routeCost(e) + (rt.dist.get(e.to) ?? Infinity)
          if (c < Infinity && (!best || c < best.c)) best = { c, edge: e, at, terminal: false }
        }
        const step = rt.next.get(key)
        if (step?.terminal && step.edge) {
          const c = wait + routeCost(step.edge)
          if (!best || c < best.c) best = { c, edge: step.edge, at, terminal: true }
        }
      }
      return best
    }
    const step = rt.next.get(cur.key)
    if (!step || !step.edge) return null
    return { c: rt.dist.get(cur.key), edge: step.edge, terminal: step.terminal, at: null }
  }

  /** Where to stand for a move: box x, and the platform it is measured on (null for the ground). */
  function startOf(real, e) {
    const node = r.nodes.get(e.from)
    if (node.kind === 'mover') {
      const m = entityBySlot(real, node.slot)
      const room = (m ? m.w : (node.mover?.w ?? 96)) - MAXX_W
      const x = e.offset === 'left' ? Math.min(2, room / 2) : e.offset === 'right' ? Math.max(room / 2, room - 2) : room / 2
      return { x, slot: node.slot }
    }
    return { x: e.offset === 'alt' ? node.altX : node.x + (typeof e.offset === 'number' ? e.offset : 0), slot: null }
  }
  /** The segments that make a move from where it starts: walk to its spot, wait for the lift, play it. */
  function moveSpecs(real, e, phaseShift = 0) {
    const st = startOf(real, e)
    const specs = [{ t: 'align', x: st.x, slot: st.slot }]
    if (phaseBound(e)) {
      const mv = moverFor(e)
      const tl = mv ? timelineOf(mv.area, mv.slot) : null
      if (tl) {
        const from = r.nodes.get(e.from)
        const at = from.kind === 'mover' ? from.k * 15 + 1 : e.tau + 1
        specs.push({ t: 'phase', area: mv.area, slot: mv.slot, at: mod(at + phaseShift, tl.period) })
      }
    }
    specs.push({ t: 'macro', id: e.macro.id })
    return specs
  }
  /** A run along one floor: run on to the farthest place along the way that is still the same floor. */
  function plainRun(real, cur, rt, e) {
    const from = r.nodes.get(e.from)
    const isPlain = (x) => x && x.to && !x.res?.airborne && (x.macro.ground === 'run' || x.macro.ground === 'step') && r.nodes.get(x.from)?.kind === 'tile' && r.nodes.get(x.to)?.kind === 'tile' && r.nodes.get(x.to).feetY === r.nodes.get(x.from).feetY && !needsMode(x)
    if (!isPlain(e) || from.kind !== 'tile') return null
    let k = e.to
    let last = r.nodes.get(e.to)
    for (let n = 0; n < 12; n++) {
      const step = rt.next.get(k)
      if (!step || step.terminal || !isPlain(step.edge) || step.edge.macro.d !== e.macro.d) break
      const to = r.nodes.get(step.edge.to)
      if (Math.abs(to.col - from.col) > 10) break
      last = to
      k = step.edge.to
    }
    return { specs: [{ t: 'align', x: last.x, slot: null, tol: 2, max: 400 }], to: last.key }
  }

  /** Judge a rollout for a goal: { ok, score, cost } (lower score is better). */
  function judge(out, goal, rt, curCost) {
    if (out.dead) return { ok: false, score: 1e9, cost: Infinity }
    if (goal.type === 'exit' && out.exit === goal.exit) return { ok: !out.hurt, score: out.ticks + HIT * out.hurt, cost: 0 }
    if (out.exit) return { ok: false, score: 1e9, cost: Infinity }
    if (goal.type !== 'exit' && goal.type !== 'nodes' && goalDone(out.w, goal)) return { ok: !out.hurt, score: out.ticks + HIT * out.hurt, cost: 0 }
    const c = costHere(out.w, rt)
    const ok = !out.hurt && c < curCost - 0.5 && out.w.player.onGround
    // The map knows nothing of cars and critters: what is still coming costs about the time to wash it.
    return { ok, score: out.ticks + c + HIT * out.hurt + threatLoad(out.w), cost: c }
  }

  function decideRoute(real, bel, goal) {
    const res = resolve(real)
    const rt = routeFor(goal, res?.key)
    if (!res) return improvise(real, bel, goal, rt, 'he is standing somewhere the map does not know')
    const mv = nextMove(res, rt)
    if (!mv) {
      if (goal.type === 'nodes' && goal.keys.has(res.key)) {
        if (goal.reachedAt === undefined) goal.reachedAt = attemptTick
        return { specs: [{ t: 'idle', n: 60 }], why: `at ${goal.label}: waits for something to open a way` }
      }
      return improvise(real, bel, goal, rt, 'the map has no way on from here')
    }
    const e = mv.edge
    const curCost = mv.c
    // Something to do first?
    const obs = obstaclesOf(real, e)
    if (obs && pushSubgoals(real, obs, e)) return 'retry'
    const cands = []
    const add = (label, specs, extra = {}) => cands.push({ label, specs, ...extra })
    const plain = plainRun(real, res, rt, e)
    if (plain) add('run on', plain.specs)
    add('go', moveSpecs(real, e))
    if (phaseBound(e)) for (const s of [-3, 3, -8, 8, -15, 15]) add(`go (lift ${s > 0 ? '+' : ''}${s})`, moveSpecs(real, e, s))
    for (const n of WAITS) add(`wait ${n}`, [{ t: 'idle', n }, ...moveSpecs(real, e)])
    const dir = e.macro.d || (real.player.facing > 0 ? 1 : -1)
    for (const th of threats(bel).slice(0, 2)) {
      const until = { id: th.e.id }
      add(`spray at the ${nameOf(th.e)}`, [{ t: 'spray', dir: th.dir, aim: th.above ? 'up' : 'fwd', max: 200, until }, ...moveSpecs(real, e)])
      add(`spray up at the ${nameOf(th.e)}`, [{ t: 'spray', dir: th.dir, aim: th.above ? 'fwd' : 'up', max: 200, until }, ...moveSpecs(real, e)])
      add(`back off from the ${nameOf(th.e)}, spray`, [{ t: 'run', dir: -th.dir, n: 14 }, { t: 'idle', n: 6 }, { t: 'spray', dir: th.dir, aim: th.above ? 'up' : 'fwd', max: 200, until }, ...moveSpecs(real, e)])
      add(`jump and spray at the ${nameOf(th.e)}`, [{ t: 'jumpspray', dir: th.dir, up: th.above }, ...moveSpecs(real, e)])
    }
    add('back off', [{ t: 'run', dir: -dir, n: 20 }, { t: 'idle', n: 20 }, ...moveSpecs(real, e)])
    // Jumps from where he stands, no walking to a spot first: over what is coming, or out of its way.
    if (threats(bel, 6 * TILE).length) {
      for (const id of [dir > 0 ? 'jump-right' : 'jump-left', 'up', dir > 0 ? 'runjump-right' : 'runjump-left', dir > 0 ? 'jump-left' : 'jump-right']) add(`at once: ${r.describeMacro(r.macroById(id))}`, [{ t: 'macro', id }])
    }
    // Other ways on from here, now and a little later.
    const alts = []
    for (const x of g.edges.get(res.key) ?? []) {
      if (x === e || !x.to || bans.has(x)) continue
      const c = routeCost(x) + (rt.dist.get(x.to) ?? Infinity)
      if (c < Infinity && c < curCost + 600) alts.push({ x, c })
    }
    alts.sort((a, b) => a.c - b.c)
    const seenAlt = new Set()
    for (const { x } of alts) {
      if (seenAlt.size >= 4 || seenAlt.has(x.to)) continue
      seenAlt.add(x.to)
      add(`another way: ${r.describeMacro(x.macro)}`, moveSpecs(real, x), { edge: x })
      if (seenAlt.size <= 2) for (const n of [15, 40, 80]) add(`wait ${n}, another way: ${r.describeMacro(x.macro)}`, [{ t: 'idle', n }, ...moveSpecs(real, x)], { edge: x })
    }
    const pick = evaluate(real, bel, cands, goal, rt, curCost, e)
    if (opt.debug) {
      const seen = new Set(threats(bel, 12 * TILE).map((x) => x.e.id))
      const unseen = threats(real, 12 * TILE).filter((x) => !seen.has(x.e.id))
      if (unseen.length) log(`      not yet seen long enough: ${unseen.map((x) => `${nameOf(x.e)} at ${placeOf({ area: real.area, player: x.e })}`).join(', ')}`)
    }
    if (pick) return pick
    // Nothing works on its own: search deeper.
    const deep = beam(real, bel, goal, rt, curCost, e)
    if (deep) return deep
    noteFailure(real, goal, e, cands)
    failures.set(e, (failures.get(e) ?? 0) + 1)
    if (failures.get(e) >= 3) {
      const blamed = cands.find((c) => c.out?.blame)?.out?.blame ?? null
      ban(e, `it kept failing in play (${blamed ?? 'no way through'})`, blamed)
      return 'retry'
    }
    return holdOn(bel)
  }
  /** Nothing gets on yet: wait, but not where something is about to run into him (spray it, back off, hop). */
  function holdOn(bel) {
    const idle = [{ t: 'idle', n: 20 }]
    const th = threats(bel, 7 * TILE).find((x) => x.coming)
    const opts = [idle]
    if (th) {
      const aim = th.above ? 'up' : 'fwd'
      opts.push([{ t: 'spray', dir: th.dir, aim, max: 20 }], [{ t: 'run', dir: -th.dir, n: 12 }, { t: 'spray', dir: th.dir, aim, max: 12 }], [{ t: 'macro', id: 'up' }], [{ t: 'macro', id: th.dir > 0 ? 'jump-left' : 'jump-right' }])
    }
    for (const specs of opts) {
      const out = rollout(bel, [...specs, { t: 'idle', n: 30 }], { prev: decisionPrev, max: 200 })
      if (!out.hurt && !out.dead) return { specs, why: specs === idle ? 'nothing works yet: waits' : `nothing works yet: holds off the ${nameOf(th.e)} (${specWords(specs[0])})`, stuck: true }
    }
    return { specs: idle, why: 'nothing works yet: waits', stuck: true }
  }
  const failures = new Map()

  /** Try candidates in order; the first move that works at once and is safe after wins outright. */
  function evaluate(real, bel, cands, goal, rt, curCost, e) {
    const found = []
    const prev = decisionPrev
    for (let i = 0; i < cands.length; i++) {
      if (decisionTicks > DECISION_TICKS) break
      const c = cands[i]
      const out = rollout(bel, c.specs, { prev, path: true })
      c.out = out
      const j = judge(out, goal, rt, curCost)
      c.judge = j
      if (!j.ok) continue
      c.safe = goal.type === 'exit' && out.exit ? true : tailSafe(out.w)
      found.push(c)
      if (c.safe && i <= 1) break
    }
    if (opt.debug && !(found[0]?.safe && cands.indexOf(found[0]) <= 1)) {
      for (const c of cands) if (c.out) log(`      ${c.label.padEnd(44)} ${c.out.ticks} ticks${c.out.hurt ? ` HIT by ${c.out.blame} at ${c.out.hitAt}` : ''}${c.out.dead ? ' DEAD' : ''} cost ${c.judge.cost === Infinity ? 'off map' : Math.round(c.judge.cost)} (now ${Math.round(curCost)})${c.judge.ok ? (c.safe ? ' OK' : ' ok but unsafe after') : ''} ends ${placeOfW(c.out.w)}`)
    }
    if (!found.length) return null
    const safe = found.filter((c) => c.safe)
    let best = safe.sort((a, b) => a.judge.score - b.judge.score)[0]
    if (!best) {
      // Lands somewhere that is not safe to stand: fine if the next move from there works.
      for (const c of found.sort((a, b) => a.judge.score - b.judge.score)) {
        if (followUp(c.out.w, goal, rt)) {
          best = c
          break
        }
      }
    }
    if (!best) return null
    return { specs: best.specs, why: best.label, path: best.out.path, edge: best.edge ?? e }
  }
  /** Depth 2: from where a move ends, does some next move work? */
  function followUp(w, goal, rt) {
    const res = resolve(w)
    if (!res) return false
    const mv = nextMove(res, rt)
    if (!mv) return goal.type === 'nodes'
    const specs = [moveSpecs(w, mv.edge), [{ t: 'idle', n: 6 }, ...moveSpecs(w, mv.edge)], [{ t: 'idle', n: 14 }, ...moveSpecs(w, mv.edge)]]
    for (const th of threats(w).slice(0, 1)) specs.push([{ t: 'spray', dir: th.dir, aim: th.above ? 'up' : 'fwd', max: 160, until: { id: th.e.id } }, ...moveSpecs(w, mv.edge)])
    for (const s of specs) {
      const out = rollout(w, s, { max: 900 })
      if (judge(out, goal, rt, mv.c).ok) return true
    }
    return false
  }

  /** Short sequences of tries, best first on progress, threats washed and hits taken. */
  function beam(real, bel, goal, rt, curCost, e) {
    const dir = e?.macro.d || (real.player.facing > 0 ? 1 : -1)
    const options = (w) => {
      const list = [
        [{ t: 'idle', n: 15 }],
        [{ t: 'idle', n: 45 }],
        [{ t: 'spray', dir, aim: 'fwd', max: 30 }],
        [{ t: 'spray', dir, aim: 'up', max: 30 }],
        [{ t: 'spray', dir: -dir, aim: 'fwd', max: 30 }],
        [{ t: 'spray', dir: -dir, aim: 'up', max: 30 }],
        [{ t: 'run', dir: -dir, n: 12 }],
        [{ t: 'run', dir, n: 8 }],
        [{ t: 'jumpspray', dir, up: false }],
        [{ t: 'jumpspray', dir, up: true }],
        [{ t: 'macro', id: dir > 0 ? 'jump-left' : 'jump-right' }],
        [{ t: 'macro', id: dir > 0 ? 'jump-right' : 'jump-left' }],
        [{ t: 'macro', id: dir > 0 ? 'runjump-right' : 'runjump-left' }],
        [{ t: 'macro', id: 'up' }],
      ]
      const res = resolve(w)
      if (res) {
        const mv = nextMove(res, rt)
        if (mv) list.push(moveSpecs(w, mv.edge))
        const alts = (g.edges.get(res.key) ?? []).filter((x) => x.to && !bans.has(x) && rt.dist.has(x.to)).sort((a, b) => routeCost(a) + rt.dist.get(a.to) - routeCost(b) - rt.dist.get(b.to))
        for (const x of alts.slice(0, 3)) if (x !== mv?.edge) list.push(moveSpecs(w, x))
      }
      return list
    }
    const h = (out) => out.ticksSoFar + costHere(out.w, rt) * 1 + threatLoad(out.w) + HIT * out.hurts
    let states = [{ w: bel, specs: [], ticksSoFar: 0, hurts: 0, prev: decisionPrev }]
    let best = null
    let bestProgress = null
    for (let depth = 0; depth < 4; depth++) {
      const next = []
      for (const s of states) {
        for (const o of options(s.w)) {
          if (decisionTicks > DECISION_TICKS) break
          const out = rollout(s.w, o, { prev: s.prev, max: 900 })
          if (out.dead) continue
          const st = { w: out.w, specs: [...s.specs, ...o], ticksSoFar: s.ticksSoFar + out.ticks, hurts: s.hurts + out.hurt, prev: out.prev }
          const j = judge({ ...out, ticks: st.ticksSoFar, hurt: st.hurts }, goal, rt, curCost)
          if (j.ok && tailSafe(out.w)) {
            if (!best || j.score < best.score) best = { score: j.score, specs: st.specs }
            continue
          }
          st.h = h(st)
          if (!st.hurts && (!bestProgress || st.h < bestProgress.h)) bestProgress = st
          next.push(st)
        }
      }
      if (best) break
      next.sort((a, b) => a.h - b.h)
      states = []
      const seen = new Set()
      for (const s of next) {
        const k = `${Math.round(s.w.player.x / 4)},${Math.round(s.w.player.y / 4)},${s.hurts},${Math.round(threatLoad(s.w) / 20)}`
        if (seen.has(k)) continue
        seen.add(k)
        states.push(s)
        if (states.length >= 6) break
      }
      if (!states.length) break
    }
    if (best) return { specs: best.specs, why: `searched: ${best.specs.map(specWords).join(', ')}`, deep: true }
    // No sequence gets there unhurt: take the first step of the most promising one, if it helps.
    const here = curCost + threatLoad(bel)
    if (bestProgress && bestProgress.h < here - 20) return { specs: bestProgress.specs.slice(0, 1), why: `edging on: ${specWords(bestProgress.specs[0])}`, deep: true, partial: true }
    return null
  }
  function specWords(s) {
    switch (s.t) {
      case 'idle':
        return `wait ${s.n}`
      case 'align':
        return 'walk to the spot'
      case 'macro':
        return r.describeMacro(r.macroById(s.id))
      case 'phase':
        return 'wait for the platform'
      case 'spray':
        return `spray ${s.aim === 'up' ? 'up ' : ''}${s.dir > 0 ? 'right' : 'left'}`
      case 'run':
        return `run ${s.dir > 0 ? 'right' : 'left'} ${s.n} ticks`
      case 'jumpspray':
        return `jump and spray ${s.up ? 'up ' : ''}${s.dir > 0 ? 'right' : 'left'}`
    }
    return s.t
  }

  /** Off the map: try every macro from here and take the one that lands best for the goal. */
  function improvise(real, bel, goal, rt, why) {
    const here = costHere(real, rt)
    const cands = []
    // The late hovers are left out: off the map is no place for a record jump.
    for (const m of r.macros) if (!m.onlyIfFalls) cands.push({ label: r.describeMacro(m), specs: [{ t: 'macro', id: m.id }] })
    let best = null
    for (const c of cands) {
      if (c.specs[0].id === 'pipe' || c.specs[0].id === 'door') continue
      const out = rollout(bel, c.specs, { max: 600 })
      const j = judge(out, goal, rt, here)
      if (out.hurt || out.dead || j.cost === Infinity) continue
      if (!best || j.score < best.score) best = { score: j.score, c }
    }
    if (best) return { specs: best.c.specs, why: `off the map (${why}): ${best.c.label}` }
    noteFailure(real, goal, null, [], why)
    return { specs: [{ t: 'idle', n: 30 }], why: `stuck: ${why}`, stuck: true }
  }

  /* ---------------- subgoals ---------------- */
  function pushSubgoals(real, obs, e) {
    let pushed = false
    if (obs.flags.length) {
      const f = obs.flags[0]
      if (!stack.some((s) => s.type === 'flag' && s.flag === f.flag)) {
        stack.push({ type: 'flag', flag: f.flag, min: f.min, what: f.what, edge: e, since: attemptTick, tried: new Set() })
        pushed = true
      }
    }
    if (obs.hidden.length) {
      // The lowest first: a staircase is climbed from the bottom.
      const cells = [...obs.hidden].sort((a, b) => a[2] - b[2])
      for (const cell of cells) {
        if (stack.some((s) => s.type === 'bump' && s.cell.join() === cell.join())) continue
        stack.push({ type: 'bump', cell, since: attemptTick })
        pushed = true
      }
    }
    if (obs.grime.length) {
      if (!stack.some((s) => s.type === 'wash' && s.edge === e)) {
        stack.push({ type: 'wash', cells: obs.grime, edge: e, since: attemptTick })
        pushed = true
      }
    }
    for (const cell of [...(obs.bricks ?? [])].sort((a, b) => a[2] - b[2])) {
      if (stack.some((s) => s.type === 'break' && s.cell.join() === cell.join())) continue
      stack.push({ type: 'break', cell, id: `${cell[0]}@${cell[1]},${cell[2]}`, since: attemptTick })
      pushed = true
    }
    return pushed
  }

  /** Break a brick a move needs gone: from where the map first bumped it, play that move. */
  function decideBreak(real, bel, goal) {
    const edges = (g.bumped.get(goal.id) ?? []).filter((x) => !bans.has(x) && !goal.tried?.has(x))
    if (!edges.length) {
      noteFailure(real, goal, null, [], 'nothing on the map bumps it')
      stack.pop()
      return 'retry'
    }
    const res = resolve(real)
    const here = res ? edges.filter((x) => x.from === res.key).sort((a, b) => a.cost - b.cost) : []
    for (const x of here.slice(0, 3)) {
      for (const n of [0, 10, 30, 60]) {
        const specs = [...(n ? [{ t: 'idle', n }] : []), ...moveSpecs(real, x)]
        const out = rollout(bel, specs, { prev: decisionPrev })
        if (!out.hurt && !out.dead && goalDone(out.w, goal)) return { specs, why: `${goalLabel(goal)}: ${r.describeMacro(x.macro)}` }
      }
      ;(goal.tried ??= new Set()).add(x)
    }
    if (here.length) return 'retry'
    const [area, tx, ty] = goal.cell
    return decideRoute(real, bel, { type: 'nodes', keys: new Set(edges.map((x) => x.from)), label: `under the brick at ${area} ${tx},${ty}` })
  }

  /** Wash grime blocks a move needs gone: from where the move starts, spray until they are. */
  function decideWash(real, bel, goal) {
    const from = r.nodes.get(goal.edge.from)
    const res = resolve(real)
    if (!res || res.key !== goal.edge.from) {
      // Get to where the move starts first (on the map that is a route to that place).
      const sub = { type: 'nodes', keys: new Set([goal.edge.from]), label: `the spot below the grime (${from.area} ${from.col},${from.row})` }
      const d = decideRoute(real, bel, sub)
      return d === 'retry' ? null : d
    }
    const left = (w) => goal.cells.reduce((n, c) => n + (cellCode(w, ...c) === G_CODE ? T.grimeBlockHits - (w.areas[c[0]].grid.d[c[2] * w.areas[c[0]].grid.w + c[1]] ?? 0) : 0), 0)
    const meanX = goal.cells.reduce((n, c) => n + c[1], 0) / goal.cells.length
    const dir = meanX * TILE + TILE / 2 >= real.player.x + MAXX_W / 2 ? 1 : -1
    const until = { cells: goal.cells }
    const opts = [
      [{ t: 'spray', dir, aim: 'fwd', max: 60, until }],
      [{ t: 'spray', dir, aim: 'up', max: 60, until }],
      [{ t: 'jumpspray', dir, up: false }],
      [{ t: 'jumpspray', dir, up: true }],
      [{ t: 'run', dir: -dir, n: 6 }],
      [{ t: 'run', dir: -dir, n: 14 }],
      [{ t: 'run', dir, n: 4 }],
    ]
    let states = [{ w: bel, specs: [], ticks: 0, prev: decisionPrev, left: left(bel) }]
    const start = states[0].left
    let best = null
    for (let depth = 0; depth < 5 && !best; depth++) {
      const next = []
      for (const s of states) {
        for (const o of opts) {
          const out = rollout(s.w, o, { prev: s.prev, max: 400 })
          if (out.hurt || out.dead) continue
          const st = { w: out.w, specs: [...s.specs, ...o], ticks: s.ticks + out.ticks, prev: out.prev, left: left(out.w) }
          if (st.left === 0) {
            if (!best || st.ticks < best.ticks) best = st
            continue
          }
          next.push(st)
        }
      }
      next.sort((a, b) => a.left - b.left || a.ticks - b.ticks)
      states = next.slice(0, 5)
      if (!states.length) break
    }
    if (best) return { specs: best.specs, why: `${goalLabel(goal)}: ${best.specs.map(specWords).join(', ')}` }
    if (states.length && states[0].left < start) return { specs: states[0].specs, why: `${goalLabel(goal)} (part way)` }
    noteFailure(real, goal, goal.edge, [], 'the water does not reach the grime from here')
    stack.pop()
    ban(goal.edge, 'its grime could not be washed from where it starts')
    return null
  }

  /** Bump a hidden block from below: stand under it and jump straight up. */
  function decideBump(real, bel, goal) {
    const [area, tx, ty] = goal.cell
    const bottom = (ty + 1) * TILE
    const keys = new Set()
    for (const n of tileNodes.get(area) ?? []) {
      if (n.col !== tx) continue
      if (n.feetY - MAXX_H < bottom || n.feetY - 186 > bottom) continue
      keys.add(n.key)
    }
    if (!keys.size) {
      noteFailure(real, goal, null, [], 'there is nowhere to stand under it')
      stack.pop()
      return 'retry'
    }
    const res = resolve(real)
    if (res && keys.has(res.key)) {
      const x = tx * TILE + TILE / 2 - MAXX_W / 2
      const specs = [{ t: 'align', x, slot: null, tol: 1 }, { t: 'macro', id: 'up' }]
      const out = rollout(bel, specs, { prev: decisionPrev })
      if (!out.hurt && !out.dead && goalDone(out.w, goal)) return { specs, why: goalLabel(goal) }
      for (const n of [10, 30, 60]) {
        const s2 = [{ t: 'idle', n }, ...specs]
        const o2 = rollout(bel, s2, { prev: decisionPrev })
        if (!o2.hurt && !o2.dead && goalDone(o2.w, goal)) return { specs: s2, why: goalLabel(goal) }
      }
      noteFailure(real, goal, null, [], 'jumping up under it does not bump it')
      stack.pop()
      return 'retry'
    }
    const d = decideRoute(real, bel, { type: 'nodes', keys, label: `under the hidden block at ${area} ${tx},${ty}` })
    return d
  }

  /** Open a gate or a locked door: its button, something to wash, or a boss in front of it. */
  function decideFlag(real, bel, goal) {
    // A button (or anything touched) that sets the flag.
    const buttons = r.targets.filter((t) => t.type === 'touch' && r.base(0).per.get(t.area).areas[t.area].spawns[t.slot]?.spec.props?.flag === goal.flag)
    for (const b of buttons) {
      if (!g.touched.has(b.id) || goal.tried.has(`b${b.id}`)) continue
      const st = real.areas[b.area]?.entities?.find((x) => x.slot === b.slot)?.state ?? 'up'
      goal.tried.add(`b${b.id}`)
      stack.push({ type: 'touch', id: b.id, area: b.area, slot: b.slot, state0: st, label: `the ${b.kind} at ${b.area} ${b.tx},${b.ty} (it sets '${goal.flag}')` })
      return 'retry'
    }
    // Something in view that takes water: wash it and see whether the flag goes up.
    // Gates, doors and other barriers wait for flags; anything else that carries the same flag
    // name is the likeliest to set it, so it is tried first.
    const p = real.player
    const sprayable = bel.entities
      .filter((e) => {
        if (e.dead || goal.tried.has(`e${e.id}`) || !known(e)) return false
        const b = behavior(e)
        return b?.onSpray && !e.harmful && e.solid !== 'full' && e.kind !== 'gate' && e.kind !== 'door' && !isCar(e) && Math.abs(cx(e) - (p.x + p.w / 2)) <= 10 * TILE
      })
      .sort((a, b) => (flagOf(b) === goal.flag) - (flagOf(a) === goal.flag) || Math.abs(cx(a) - p.x) - Math.abs(cx(b) - p.x))
    for (const e of sprayable) {
      const dx = cx(e) - (p.x + p.w / 2)
      const dir = dx >= 0 ? 1 : -1
      const until = { flag: goal.flag, min: goal.min }
      const tries = [
        [{ t: 'spray', dir, aim: 'fwd', max: 240, until }],
        [{ t: 'run', dir, n: 16 }, { t: 'spray', dir, aim: 'fwd', max: 240, until }],
        [{ t: 'run', dir, n: 36 }, { t: 'spray', dir, aim: 'fwd', max: 240, until }],
        [{ t: 'spray', dir, aim: 'up', max: 240, until }],
        [{ t: 'run', dir: -dir, n: 16 }, { t: 'spray', dir, aim: 'up', max: 240, until }],
        [{ t: 'run', dir, n: 16 }, { t: 'spray', dir, aim: 'up', max: 240, until }],
        [{ t: 'jumpspray', dir, up: false }, { t: 'jumpspray', dir, up: false }, { t: 'jumpspray', dir, up: false }],
      ]
      for (const specs of tries) {
        const out = rollout(bel, specs, { prev: decisionPrev })
        if (!out.hurt && !out.dead && (out.w.flags[goal.flag] ?? 0) >= goal.min) return { specs, why: `${goalLabel(goal)}: wash the ${nameOf(e)}` }
      }
      goal.tried.add(`e${e.id}`)
    }
    // A boss or rival on the way: walk on toward the gate; the fight starts there.
    const res = resolve(real)
    const from = goal.edge.from
    if (res && res.key !== from && !goal.atGate) {
      const d = decideRoute(real, bel, { type: 'nodes', keys: new Set([from]), label: `in front of ${goal.what}` })
      if (d && d !== 'retry') return d
    }
    goal.atGate = true
    // No boss or rival in this area to raise the flag, and no button or wash did: a barred door
    // a careful player sees and leaves for another way (Rival Row's back doors, locked on rivals
    // further on, on a visit that has not beaten them), not a wait for something that cannot come.
    if (!real.entities.some((x) => !x.dead && behavior(x)?.boss)) {
      // No ': ' in the reason: the report splits a ban at its last one.
      ban(goal.edge, `barred, and nothing in its area raises '${goal.flag}'`)
      stack.pop()
      return 'retry'
    }
    if (attemptTick - goal.since > 30 * 60) {
      noteFailure(real, goal, goal.edge, [], `${goal.what} waits for flag '${goal.flag}' >= ${goal.min}, and nothing the solver can reach or wash sets it`)
      return { specs: [{ t: 'idle', n: 30 }], why: `waiting for '${goal.flag}'`, stuck: true, fatal: true }
    }
    return { specs: [{ t: 'idle', n: 60 }], why: `waiting for flag '${goal.flag}' at ${goal.what}`, stuck: true }
  }

  /* ---------------- SPOTLESS ---------------- */
  function decideSpotless(real, bel) {
    const p = real.player
    for (const th of threats(bel, 12 * TILE)) {
      const e = th.e
      // A car it could not wash is tried again a little later: it may have turned round.
      if (!isCar(e) || e.state === 'clean' || e.props.bonus === true || attemptTick - (missedCars.get(e.id) ?? -1e9) < 180) continue
      const until = { id: e.id }
      const aim = th.above ? 'up' : 'fwd'
      const tries = [
        [{ t: 'spray', dir: th.dir, aim, max: 300, until }],
        [{ t: 'run', dir: -th.dir, n: 16 }, { t: 'spray', dir: th.dir, aim, max: 300, until }],
        [{ t: 'run', dir: th.dir, n: 20 }, { t: 'spray', dir: th.dir, aim, max: 300, until }],
        // One driving away: run after it with the gun on (a spraying run outpaces every car but the sports car).
        [{ t: 'run', dir: th.dir, n: 60, spray: true }, { t: 'spray', dir: th.dir, aim, max: 240, until }],
        [{ t: 'idle', n: 30 }, { t: 'spray', dir: th.dir, aim, max: 300, until }],
        [{ t: 'jumpspray', dir: th.dir, up: false }, { t: 'spray', dir: th.dir, aim, max: 300, until }],
      ]
      for (const specs of tries) {
        const out = rollout(bel, specs, { prev: decisionPrev, path: true })
        const c = out.w.entities.find((x) => x.id === e.id)
        if (!out.hurt && !out.dead && (!c || c.state === 'clean') && tailSafe(out.w)) return { specs, why: `SPOTLESS: wash the ${nameOf(e)}`, path: out.path }
      }
      missedCars.set(e.id, attemptTick)
    }
    // A counted spawner still sending: stay by it.
    for (const e of bel.entities) {
      if (e.kind !== 'spawner' || e.state === 'done' || !known(e)) continue
      const count = Number(e.props.count) || 0
      if (count <= 0) continue
      if (Math.abs(e.x - (p.x + p.w / 2)) > VIEW_W) continue
      const key = `spawner${e.id}`
      const since = waitedAt.get(key) ?? attemptTick
      waitedAt.set(key, since)
      if (attemptTick - since > 40 * 60) continue
      const out = rollout(bel, [{ t: 'idle', n: 20 }])
      if (!out.hurt && !out.dead) return { specs: [{ t: 'idle', n: 20 }], why: `SPOTLESS: wait for the spawner's cars (${e.vars.sent ?? 0} of ${count} sent)` }
    }
    return null
  }
  const waitedAt = new Map()

  /* ---------------- fights ---------------- */
  function bossEntity(w) {
    if (!w.boss) return null
    let best = null
    for (const e of w.entities) {
      if (e.dead || e.maxHp !== w.boss.maxHp) continue
      const d = Math.abs(e.hp - w.boss.hp)
      if (!best || d < best.d) best = { d, e }
    }
    if (best) return best.e
    return threats(w, VIEW_W)[0]?.e ?? null
  }
  /** The short moves of a fight, from where Maxx is in `w`: spray at it, wait, step, jump, the map's jumps from here. */
  function fightOptions(w) {
    const boss = bossEntity(w)
    const p = w.player
    const toward = boss ? (cx(boss) >= p.x + p.w / 2 ? 1 : -1) : p.facing
    const options = [
      { label: 'spray at it', specs: [{ t: 'spray', dir: toward, aim: 'fwd', max: 16 }] },
      { label: 'spray up at it', specs: [{ t: 'spray', dir: toward, aim: 'up', max: 16 }] },
      { label: 'wait', specs: [{ t: 'idle', n: 12 }] },
      { label: 'step left', specs: [{ t: 'run', dir: -1, n: 12 }] },
      { label: 'step right', specs: [{ t: 'run', dir: 1, n: 12 }] },
      { label: 'jump and spray at it', specs: [{ t: 'jumpspray', dir: toward, up: false }] },
      { label: 'jump and spray up at it', specs: [{ t: 'jumpspray', dir: toward, up: true }] },
    ]
    for (const id of ['jump-left', 'jump-right', 'up', 'runjump-left', 'runjump-right', 'dash-left', 'dash-right']) options.push({ label: r.describeMacro(r.macroById(id)), specs: [{ t: 'macro', id }] })
    const res = p.onGround ? resolve(w) : null
    if (res) {
      const seenTo = new Set()
      for (const e of g.edges.get(res.key) ?? []) {
        if (!e.to || seenTo.has(e.to) || seenTo.size >= 4 || !isJump(e)) continue
        seenTo.add(e.to)
        options.push({ label: r.describeMacro(e.macro), specs: [{ t: 'macro', id: e.macro.id }] })
      }
    }
    return options
  }
  /**
   * A fight: a small beam, three moves deep, over the fight's short moves. A line of play is
   * worth what it washes off the boss, far less than any hit it takes; the first move of the
   * best line is played, and the next decision looks again.
   */
  function decideFight(real, bel) {
    const hp0 = real.boss.hp
    const value = (s) => {
      const w = s.w
      const hp = w.boss ? w.boss.hp : 0
      const boss = bossEntity(w)
      const p = w.player
      // A little room from it is better than none, all else being equal; and so is room either side:
      // backed into the arena's wall, a charge cannot be dodged by stepping away.
      const gap = boss ? Math.max(boss.x - (p.x + p.w), p.x - (boss.x + boss.w), 0) : 96
      const arena = w.camBounds
      const room = arena ? Math.min(p.x - arena.x0, arena.x1 - (p.x + p.w)) : 96
      return (s.dead ? -1e6 : 0) - HIT * s.hurts + 30 * (hp0 - hp) + (w.boss || w.status === 'clear' ? 0 : 5000) + (w.status === 'clear' ? 8000 : 0) - 0.02 * s.ticks + Math.min(gap, 96) / 24 + Math.min(Math.max(room, 0), 96) / 8
    }
    let states = [{ w: bel, first: null, ticks: 0, hurts: 0, dead: false, prev: decisionPrev }]
    const finals = []
    for (let depth = 0; depth < 3; depth++) {
      const next = []
      for (const s of states) {
        for (const o of fightOptions(s.w)) {
          if (decisionTicks > DECISION_TICKS) break
          const out = rollout(s.w, o.specs, { prev: s.prev, max: 150, path: depth === 0 })
          const st = { w: out.w, first: s.first ?? { o, path: out.path }, ticks: s.ticks + out.ticks, hurts: s.hurts + out.hurt, dead: out.dead, prev: out.prev }
          st.v = value(st)
          if (out.dead || out.status !== 'play' || depth === 2 || !out.w.boss) finals.push(st)
          else next.push(st)
        }
      }
      next.sort((a, b) => b.v - a.v)
      states = []
      const seen = new Set()
      for (const s of next) {
        const k = `${Math.round(s.w.player.x / 12)},${Math.round(s.w.player.y / 12)},${s.hurts},${Math.round((s.w.boss?.hp ?? 0) * 2)}`
        if (seen.has(k)) continue
        seen.add(k)
        states.push(s)
        if (states.length >= 7) break
      }
      if (!states.length) break
    }
    for (const s of states) finals.push(s)
    finals.sort((a, b) => b.v - a.v)
    // The best lines must still be survivable a second past their end: a line that leaves him
    // where the next landing or wave cannot be dodged by any simple answer counts as a hit.
    const tails = [[{ t: 'idle', n: 60 }], [{ t: 'macro', id: 'dash-left' }], [{ t: 'macro', id: 'dash-right' }], [{ t: 'macro', id: 'up' }], [{ t: 'macro', id: 'jump-left' }], [{ t: 'macro', id: 'jump-right' }]]
    for (const s of finals.slice(0, 8)) {
      if (s.dead || s.w.status !== 'play' || !s.w.boss) continue
      let ok = false
      // The map's own jumps from where the line ends too (up onto a catwalk, out of a charge's way).
      const res = s.w.player.onGround ? resolve(s.w) : null
      const own = []
      for (const e of res ? (g.edges.get(res.key) ?? []) : []) if (isJump(e) && e.to && !own.some((x) => x[0].id === e.macro.id) && own.length < 3) own.push([{ t: 'macro', id: e.macro.id }])
      for (const tl of [...tails, ...own]) {
        const o = rollout(s.w, tl, { prev: s.prev, max: 90 })
        if (!o.hurt && !o.dead) {
          ok = true
          break
        }
      }
      if (!ok) s.v -= HIT
    }
    finals.sort((a, b) => b.v - a.v)
    const best = finals[0]
    if (opt.debug) log(`      fight at ${placeOf(real)} boss ${real.boss.hp.toFixed(1)}/${real.boss.maxHp}: ${finals.slice(0, 5).map((s) => `${s.first.o.label} ${Math.round(s.v)}`).join('; ')}`)
    return { specs: best.first.o.specs, why: `fight: ${best.first.o.label}`, path: best.first.path, fight: true }
  }

  /* ---------------- failures, struggles ---------------- */
  const struggles = []
  function noteFailure(real, goal, e, cands, why = null) {
    const tried = cands
      .filter((c) => c.out)
      .slice(0, 12)
      .map((c) => `${c.label}: ${c.out.dead ? `GRIMED by ${c.out.blame}` : c.out.hurt ? `hit by ${c.out.blame} at ${c.out.hitAt}` : c.judge && c.judge.cost < Infinity ? `ends at a place no nearer (${placeOfW(c.out.w)})` : `ends off the way (${placeOfW(c.out.w)})`}`)
    if (tried.length) lastTried = tried
    lastFailure = { at: placeOf(real), tick: attemptTick, goal: goalLabel(goal), move: e ? `${r.describeMacro(e.macro)} from ${nodeWords(e.from)} to ${e.exit ? (e.exit === 'goal' ? 'the goal' : 'the secret exit') : nodeWords(e.to)}` : null, why, tried }
  }
  let lastTried = []
  /** Why it is stuck, in words: what kept hurting it, when it gave up every way on for that. */
  function stuckWhy(fallback) {
    if (!banBlame.size) return fallback
    const top = [...banBlame].sort((a, b) => b[1] - a[1])
    return `every way on was tried in play and failed: hit by ${top.map(([b, n]) => `${b} (on ${n} move${n === 1 ? '' : 's'})`).join(', ')}`
  }
  const placeOfW = (w) => (w.status === 'clear' ? `the ${w.exit === 'goal' ? 'goal' : 'secret exit'}` : placeOf(w))
  function nodeWords(key) {
    const n = r.nodes.get(key)
    if (!n) return key
    if (n.kind === 'mover') return `${n.area} on the ${n.mover?.kind ?? 'platform'} at col ${n.col}`
    return n.row !== null ? `${n.area} ${n.col},${n.row}` : `${n.area} col ${n.col}`
  }

  /* ---------------- the run ---------------- */
  /**
   * Play the level. Returns:
   *   ok, exit, status, ticks (all attempts), clock (level seconds), timeLeft (ticks), hits, lives
   *   lost, carsWashed, carsTotal, tokens, score, struggles: [{ at, tick, what }], failure (on
   *   a failure: { kind, at, goal, move, why, tried }), replay (REPLAY_FORMAT), stats, notes.
   */
  function solve() {
    const session = { lives: 3, score: 0, coins: 0, pips: 3, turbo: false }
    const replay = { format: REPLAY_FORMAT, level: level.id, seed: opt.seed ?? null, options: { exit: exitWanted, tokens: !!opt.tokens, spotless: !!opt.spotless, allowTight: !!opt.allowTight }, attempts: [], result: null }
    const result = { ok: false, level: level.id, name: level.name, exit: null, status: null, ticks: 0, clock: level.time, timeLeft: 0, hits: 0, livesLost: 0, carsWashed: 0, carsTotal: 0, tokens: [false, false, false], score: 0, struggles, failure: null, replay, stats, notes: planNotes, unreachable }
    // Targets the map cannot reach at all.
    const exitUnreachable = unreachable.find((u) => u.exit)
    for (const u of unreachable) {
      const place = u.exit ? exitPlace(u.exit) : `${u.token.area} ${u.token.tx},${u.token.ty}`
      const near = u.exit ? nearestTo(u.exit) : nearestToTarget(u.token)
      u.text = `${u.what} at ${place} cannot be reached: ${u.needs !== null ? `the map needs ${modeDelta(u.needs, 0)}, and the solver cannot ride car roofs yet` : 'the reachability map finds no way there, even with grime washed, gates open, car roofs and hidden blocks'}${near ? `; the nearest Maxx can stand is ${near}` : ''}`
    }
    const tokenUnreachable = unreachable.filter((u) => u.token)
    if (tokenUnreachable.length) {
      // Each is explained on its own 'map' line above the block.
      const first = tokenUnreachable[0].token
      result.failure = { kind: 'unreachable', at: `${first.area} ${first.tx},${first.ty}`, why: `${tokenUnreachable.length} token${tokenUnreachable.length === 1 ? '' : 's'} the map cannot reach (see the map lines): it does not start`, tried: [] }
      return finish(result, null, session)
    }
    let real = null
    let checkpoint = null
    let flags = opt.flags ? { ...opt.flags } : undefined
    let tokens
    for (let attempt = 0; ; attempt++) {
      const snap = { ...session }
      real = sim.createWorld(level, { session, checkpoint, flags, tokens, seed: opt.seed ?? undefined })
      const masks = []
      const marks = []
      knownAt = new Map()
      attemptTick = 0
      expect = null
      foreseenIds = new Set()
      stack = []
      planGoals(real, exitUnreachable)
      let plan = null
      let prev = 0
      let lastMove = { tick: 0, cost: Infinity, sig: '' }
      let lastBlame = null
      let pips = real.player.pips
      let interrupt = false
      let fatal = null
      const atStart = { session: snap, checkpoint: checkpoint ? { ...checkpoint } : null, flags: flags ? { ...flags } : null, tokens: tokens ? [...tokens] : null }
      const p = real.player
      look(real)
      while (real.status === 'play') {
        if ((performance.now() - t0) / 1000 > opt.budget) {
          fatal = { kind: 'budget', why: `the solver ran out of its ${opt.budget} s budget` }
          break
        }
        if (attemptTick > (opt.maxTicks ?? level.time * 60 * 3)) {
          fatal = { kind: 'stuck', why: 'played far longer than the clock without finishing' }
          break
        }
        let mask = 0
        const busy = real.warp || p.state !== 'normal'
        if (!busy) {
          // A new threat in sight mid-jump: steer the rest of the flight if it would land him in it.
          if (plan && interrupt && !p.onGround && !plan.air && !plan.fight && !plan.airChecked && !plan.ride) {
            plan.airChecked = true
            const a = decideAir(belief(real), prev)
            if (a) {
              plan = { specs: a.specs, i: 0, seg: null, path: null, start: attemptTick, why: a.why, air: true }
              log(`  t ${String(attemptTick).padStart(6)}  ${placeOf(real).padEnd(16)} ${a.why}`)
            }
          }
          if (plan && interrupt && p.onGround && !plan.ride) plan = null
          if (plan) {
            mask = plan.seg ? plan.seg.input(real, prev) : null
            while (mask === null && plan) {
              plan.seg = null
              if (plan.i >= plan.specs.length) {
                plan = null
                break
              }
              plan.seg = makeSeg(plan.specs[plan.i++])
              mask = plan.seg.input(real, prev)
            }
          }
          // A ride the caller plays by rule (opt.ride), for a token only a car roof reaches.
          if (!plan && p.onGround && opt.ride && rideTokens.some((t) => !real.stats.tokens[t.token])) {
            const seg = opt.ride(real, attemptTick)
            if (seg) {
              plan = { specs: [], i: 0, seg, path: null, start: attemptTick, why: seg.why, ride: true }
              log(`  t ${String(attemptTick).padStart(6)}  ${placeOf(real).padEnd(16)} ${seg.why}`)
              mask = seg.input(real, prev)
              if (mask === null) {
                plan = null
                mask = 0
              }
            }
          }
          if (!plan && (p.onGround || real.boss)) {
            decisionPrev = prev
            decisionTicks = 0
            const tStart = performance.now()
            const bel = belief(real)
            const d = decide(real, bel)
            expect = bel
            const ms = performance.now() - tStart
            stats.decisions++
            stats.ms += ms
            interrupt = false
            if (d && d.fatal) {
              fatal = { kind: 'stuck', why: lastFailure?.why ?? d.why }
              break
            }
            if (d && (ms > 2000 || decisionTicks > 200000)) struggles.push({ at: placeOf(real), tick: attemptTick, what: `${(ms / 1000).toFixed(1)} s of search (${Math.round(decisionTicks / 1000)}k ticks looked ahead) before: ${d.why}` })
            if (d) {
              // A skill few players know is a place they will be stuck: say so.
              const hov = d.specs.map((s) => (s.t === 'macro' ? r.macroById(s.id)?.hover : null)).find((h) => h === 'pulse' || typeof h === 'number')
              if (hov === 'pulse') struggles.push({ at: placeOf(real), tick: attemptTick, what: `used the pulsed hover (tapping spray with down held): ${d.why}` })
              else if (hov !== undefined) struggles.push({ at: placeOf(real), tick: attemptTick, what: `used the hover begun late (held from ${hov} ticks after the top of the jump), which nobody is taught: ${d.why}` })
              plan = { specs: d.specs, i: 0, seg: null, path: d.path ?? null, start: attemptTick, why: d.why, fight: !!d.fight }
              log(`  t ${String(attemptTick).padStart(6)}  ${placeOf(real).padEnd(16)} ${d.why}${opt.debug && !d.fight ? `   [${d.specs.map(specWords).join(', ')}${d.path ? `; ${d.path.length / 2} ticks foreseen` : ''}]` : ''}`)
            } else plan = null
            if (plan) {
              mask = null
              while (mask === null && plan) {
                if (plan.i >= plan.specs.length) {
                  plan = null
                  break
                }
                plan.seg = makeSeg(plan.specs[plan.i++])
                mask = plan.seg.input(real, prev)
              }
            }
          }
          if (mask === null) mask = 0
        }
        const closeReal = nearestHarm(real)
        const frame = frameFor(prev, mask)
        sim.stepWorld(real, frame)
        const hitNow = tookHit(real, pips)
        real.events.length = 0
        if (expect && expect.status === 'play') {
          sim.stepWorld(expect, frame)
          expect.events.length = 0
        }
        prev = mask & 63
        masks.push(mask)
        attemptTick++
        if (plan?.seg) plan.seg.after(real)
        if (plan?.seg?.done) plan.seg = null
        if (masks.length % MARK_EVERY === 0) marks.push([masks.length, sim.worldHash(real)])
        // What the player sees now, and whether the plan still holds.
        look(real)
        // Something that matters has been in sight for its reaction time: look again (a fight looks every move anyway).
        if (plan && !plan.fight) {
          for (const e of real.entities) {
            if (knownAt.get(e.id) === attemptTick && !foreseenIds.has(e.id) && matters(e)) interrupt = true
          }
        }
        if (plan?.path && !interrupt) {
          const k = (attemptTick - plan.start - 1) * 2
          if (k + 1 < plan.path.length && (Math.abs(plan.path[k] - p.x) > 6 || Math.abs(plan.path[k + 1] - p.y) > 6)) interrupt = true
        }
        // Something known and dangerous nearby is not doing what he expected (a car turned round off one
        // he had not seen yet): look again, as a player would.
        if (plan && !plan.fight && !interrupt && expect && (attemptTick & 3) === 0) {
          for (const e of real.entities) {
            if (e.dead || !known(e) || !(e.harmful || (isCar(e) && e.state !== 'clean')) || Math.abs(cx(e) - (p.x + p.w / 2)) > 8 * TILE) continue
            const m = expect.entities.find((x) => x.id === e.id && x.kind === e.kind)
            if (!m || m.dead || Math.abs(m.x - e.x) > 12 || Math.abs(m.y - e.y) > 12) {
              interrupt = true
              if (opt.debug) log(`      t ${attemptTick}: the ${nameOf(e)} at ${placeOf({ area: real.area, player: e })} is not where it was expected: looks again`)
              break
            }
          }
        }
        if (real.status !== 'play' && real.status !== 'clear' && !lastBlame) lastBlame = blame(real, closeReal)
        if (hitNow && real.status !== 'timeup') {
          result.hits++
          struggles.push({ at: placeOf(real), tick: attemptTick, what: `took a hit from ${blame(real, closeReal)}${plan ? ` while: ${plan.why}` : ''}` })
          plan = null
        }
        pips = p.pips
        // Progress: is it any nearer its goal?
        if (!real.boss && p.onGround && attemptTick % 30 === 0 && stack.length) {
          const goal = stack[stack.length - 1]
          const sigNow = stack.map(goalKey).join(';')
          let c = Infinity
          if (goal.type === 'wash') c = goal.cells.reduce((n, cell) => n + (cellCode(real, ...cell) === G_CODE ? 1 : 0), 0)
          else {
            const rt = routes.get(goalKey(goal))
            c = rt ? costHere(real, rt) : Infinity
          }
          if (sigNow !== lastMove.sig || c < lastMove.cost - 1) {
            // Getting on from here took a while: a place the designer should look at.
            if (sigNow === lastMove.sig && attemptTick - lastMove.tick > SLOW) struggles.push({ at: lastMove.place, tick: lastMove.tick, what: `${((attemptTick - lastMove.tick) / 60).toFixed(1)} s of play to get on from here (${lastMove.why ?? 'waiting'})` })
            lastMove = { tick: attemptTick, cost: c, sig: sigNow, place: placeOf(real), why: plan?.why }
          }
          else if (attemptTick - lastMove.tick > STALL) {
            fatal = { kind: 'stuck', why: lastFailure?.why ?? `no progress for ${STALL / 60} s` }
            break
          }
          if (goal.type === 'nodes' && goal.approach && goal.reachedAt !== undefined && attemptTick - goal.reachedAt > 600) {
            fatal = { kind: 'unreachable', why: 'it went as near as the map goes and waited 10 s: no fight started and nothing opened a way on' }
            break
          }
        }
        if (real.boss) lastMove.tick = attemptTick
      }
      const endHash = sim.worldHash(real)
      replay.attempts.push({ ...atStart, ticks: masks.length, input: encodeInput(masks), marks, end: { status: real.status, exit: real.exit, hash: endHash, tick: masks.length } })
      result.ticks += masks.length
      if (fatal) {
        const noWay = fatal.why === 'the map has no way on from here' || fatal.why.startsWith('no progress')
        result.failure = { kind: fatal.kind, at: lastFailure?.at ?? placeOf(real), goal: lastFailure?.goal ?? (stack.length ? goalLabel(stack[stack.length - 1]) : null), move: lastFailure?.move ?? null, why: noWay ? stuckWhy(fatal.why) : fatal.why, tried: lastFailure?.tried?.length ? lastFailure.tried : lastTried }
        return finish(result, real, session)
      }
      if (real.status === 'clear') {
        if (real.exit !== exitWanted && !(exitUnreachable && real.exit)) {
          result.failure = { kind: 'wrong exit', at: placeOf(real), why: `it left by the ${real.exit === 'goal' ? 'goal' : 'secret exit'}, not the ${exitWanted === 'goal' ? 'goal' : 'secret exit'}`, tried: [] }
          return finish(result, real, session)
        }
        result.ok = true
        return finish(result, real, session)
      }
      // Grimed or out of time: a life, and a retry from the checkpoint, as the play scene does.
      const why = lastBlame ?? blame(real)
      struggles.push({ at: placeOf(real), tick: attemptTick, what: `${real.status === 'timeup' ? 'TIME UP' : 'GRIMED'} by ${why}; a life lost` })
      result.livesLost++
      session.lives = Math.max(0, session.lives - 1)
      if (session.lives <= 0 || result.livesLost >= opt.lives) {
        result.failure = { kind: 'out of lives', at: placeOf(real), goal: stack.length ? goalLabel(stack[stack.length - 1]) : null, why: `lost ${result.livesLost} li${result.livesLost === 1 ? 'fe' : 'ves'}; the last to ${why}`, tried: lastFailure?.tried ?? [] }
        return finish(result, real, session)
      }
      checkpoint = real.checkpoint ? { ...real.checkpoint } : null
      flags = { ...real.flags }
      tokens = [...real.stats.tokens]
    }
  }

  function planGoals(real, exitUnreachable) {
    stack = []
    if (exitUnreachable) {
      const near = nearestNodes(exitUnreachable.exit)
      stack.push({ type: 'nodes', keys: near, approach: true, label: `as near ${exitUnreachable.what} as the map goes` })
    } else stack.push({ type: 'exit', exit: exitWanted })
    if (!opt.tokens) return
    // Tokens in the cheapest order (all orders of what is left are tried).
    const left = tokenTargets.filter((t) => !real.stats.tokens[t.token] && tokenModes.has(t.id))
    const start = resolve(real)?.key ?? g.start
    const tables = new Map()
    const tbl = (goal) => {
      const k = goalKey(goal)
      if (!tables.has(k)) tables.set(k, routeFor(goal, null))
      return tables.get(k)
    }
    const endOf = (t, from) => {
      const rt = tbl({ type: 'touch', id: t.id })
      for (let k = from, n = 0; k && n < 500; n++) {
        const s = rt.next.get(k)
        if (!s || !s.edge) return null
        if (s.terminal) return s.edge.to
        k = s.edge.to
      }
      return null
    }
    const perms = (list) => (list.length <= 1 ? [list] : list.flatMap((x, i) => perms([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p])))
    let best = null
    for (const order of perms(left)) {
      let c = 0
      let at = start
      for (const t of order) {
        const rt = tbl({ type: 'touch', id: t.id })
        const d = rt.dist.get(at)
        if (d === undefined) {
          c = Infinity
          break
        }
        c += d
        at = endOf(t, at)
        if (!at) {
          c = Infinity
          break
        }
      }
      if (c < Infinity && !exitUnreachable) c += tbl({ type: 'exit', exit: exitWanted }).dist.get(at) ?? 1e6
      if (!best || c < best.c) best = { c, order }
    }
    const order = best ? best.order : left
    for (let i = order.length - 1; i >= 0; i--) {
      const t = order[i]
      stack.push({ type: 'touch', id: t.id, token: t.token, area: t.area, slot: t.slot, label: `token ${t.token + 1} (${t.area} ${t.tx},${t.ty})` })
    }
  }
  function exitPlace(type) {
    const t = r.targets.find((x) => x.type === type)
    return t ? `${t.area} ${t.tx},${t.ty}` : '(none in the level)'
  }
  /**
   * The reached places nearest a target's spot (same area), as node keys. When nothing in its area
   * is reached (an exit in an area no way leads to, as in a boss room that ends the level itself),
   * the places farthest into the level instead: the costliest to get to from the start.
   */
  function nearestNodes(type) {
    const t = r.targets.find((x) => x.type === type)
    const keys = new Set()
    if (!t) return keys
    let best = Infinity
    const list = (tileNodes.get(t.area) ?? []).filter((n) => g.reached.has(n.key))
    if (!list.length) {
      const { dist } = r.costs(g)
      let far = -1
      for (const [k, c] of dist) if (r.nodes.get(k)?.kind === 'tile' && c > far) far = c
      for (const [k, c] of dist) if (r.nodes.get(k)?.kind === 'tile' && c >= far - 30) keys.add(k)
      return keys
    }
    for (const n of list) best = Math.min(best, Math.abs(n.col - t.tx) * 4 + Math.abs((n.row ?? 0) - t.ty))
    for (const n of list) if (Math.abs(n.col - t.tx) * 4 + Math.abs((n.row ?? 0) - t.ty) === best) keys.add(n.key)
    return keys
  }
  function nearestTo(type) {
    const keys = nearestNodes(type)
    const k = [...keys][0]
    return k ? nodeWords(k) : null
  }
  function nearestToTarget(t) {
    let best = null
    for (const n of (tileNodes.get(t.area) ?? []).filter((x) => g.reached.has(x.key))) {
      const d = Math.abs(n.col - t.tx) * 4 + Math.abs((n.row ?? 0) - t.ty)
      if (!best || d < best.d) best = { d, n }
    }
    return best ? nodeWords(best.n.key) : null
  }

  /** The counted cars no wash was credited for (world.flags 'washed:<area>:<slot>' or '...:<sender slot>.<n>'), by where they start. */
  function unwashed(real) {
    const out = []
    for (const info of r.areaInfo.values()) {
      for (const c of info.carBoxes) {
        const spec = r.base(0).per.get(c.area).areas[c.area].spawns[c.slot]?.spec
        const beh = spec && sim.getBehavior(spec.kind)
        const n = beh?.carCount ? beh.carCount(spec) : beh?.countsAsCar ? 1 : 0
        if (!n) continue
        if (c.kind === 'car') {
          if (!real.flags[`washed:${c.area}:${c.slot}`]) out.push(`the ${c.variant} car placed at ${c.area} ${c.tx},${c.ty}${learned.has(`${c.area}|${c.slot}`) ? '' : ' (never on screen)'}`)
          continue
        }
        const missing = []
        for (let k = 0; k < n; k++) if (!real.flags[`washed:${c.area}:${c.slot}.${k}`]) missing.push(k + 1)
        if (missing.length) out.push(`the ${c.kind} at ${c.area} ${c.tx},${c.ty}: car${missing.length > 1 ? 's' : ''} ${missing.join(', ')} of ${n} not washed (or never sent)`)
      }
    }
    return out
  }

  function finish(result, real, session) {
    if (real) {
      result.status = real.status
      result.exit = real.exit
      result.timeLeft = real.timeLeft
      result.carsWashed = real.stats.carsWashed
      result.carsTotal = real.stats.carsTotal
      result.tokens = [...real.stats.tokens]
      result.score = session.score
      // The world as the last attempt left it (the session has had a life taken since, on a failure).
      result.hash = result.replay.attempts.length ? result.replay.attempts[result.replay.attempts.length - 1].end.hash : sim.worldHash(real)
      result.replay.result = { ok: result.ok, status: real.status, exit: real.exit, hash: result.hash, ticks: result.ticks, hits: result.hits, livesLost: result.livesLost, carsWashed: result.carsWashed, carsTotal: result.carsTotal, tokens: result.tokens, score: result.score }
      if (opt.spotless && result.ok && result.carsWashed < result.carsTotal) {
        result.ok = false
        result.failure = { kind: 'not spotless', at: placeOf(real), why: `${result.carsTotal - result.carsWashed} of ${result.carsTotal} cars were not washed (missed, or gone before it could)`, tried: [], missed: unwashed(real) }
      }
      if (opt.tokens && result.ok && !tokenTargets.every((t) => result.tokens[t.token])) {
        result.ok = false
        result.failure = { kind: 'tokens', at: placeOf(real), why: `tokens taken: ${result.tokens.map((t, i) => (t ? i + 1 : null)).filter(Boolean).join(', ') || 'none'}`, tried: [] }
      }
    }
    result.seconds = (performance.now() - t0) / 1000
    result.bans = [...new Set([...banWhy].map(([e, why]) => `${r.describeMacro(e.macro)} from ${nodeWords(e.from)}: ${why}`))]
    return result
  }

  return { solve, reach: r, graph: g, mode: M }
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

const secs = (ticks) => `${(ticks / 60).toFixed(1)} s`

/** The result as lines of text for a person. */
export function formatResult(res) {
  const lines = []
  const head = res.ok ? 'SOLVED' : 'FAILED'
  lines.push(`${head} ${res.level} "${res.name}"${res.replay?.options ? `  (exit ${res.replay.options.exit}${res.replay.options.tokens ? ', tokens' : ''}${res.replay.options.spotless ? ', spotless' : ''}${res.replay.seed !== null && res.replay.seed !== undefined ? `, seed ${res.replay.seed}` : ''})` : ''}`)
  if (res.status) {
    const clockTicks = res.clock * 60
    lines.push(`  time         ${res.ticks} ticks = ${secs(res.ticks)} played (clock ${res.clock} s${res.timeLeft ? `, ${secs(res.timeLeft)} left at the end` : ''}; ${Math.round((100 * res.ticks) / clockTicks)}% of the clock)`)
    lines.push(`  hits taken   ${res.hits}${res.livesLost ? `; lives lost ${res.livesLost} (retried from the checkpoint)` : ''}`)
    lines.push(`  cars washed  ${res.carsWashed} of ${res.carsTotal}`)
    lines.push(`  tokens       ${res.tokens.map((t, i) => (t ? `${i + 1}` : '-')).join(' ')}`)
    lines.push(`  score        ${res.score}`)
    lines.push(`  ended        ${res.status}${res.exit ? ` by the ${res.exit === 'goal' ? 'goal' : 'secret exit'}` : ''}`)
  }
  for (const n of res.notes ?? []) lines.push(`  note         ${n}`)
  for (const u of res.unreachable ?? []) if (u.text) lines.push(res.ok ? `  note         the map has no way to ${u.what}: the level was finished in play (a boss or rival ended it)` : `  map          ${u.text}`)
  if (res.struggles?.length) {
    lines.push(`  where it struggled (${res.struggles.length}):`)
    for (const s of res.struggles.slice(0, 40)) lines.push(`    ${String(s.at).padEnd(16)} tick ${String(s.tick).padStart(6)}  ${s.what}`)
    if (res.struggles.length > 40) lines.push(`    ... and ${res.struggles.length - 40} more`)
  }
  if (res.bans?.length) {
    // One line per reason: the moves, then why.
    const by = new Map()
    for (const b of res.bans) {
      const i = b.lastIndexOf(': ')
      const why = b.slice(i + 2)
      if (!by.has(why)) by.set(why, [])
      by.get(why).push(b.slice(0, i))
    }
    lines.push(`  moves it would not use:`)
    for (const [why, list] of by) lines.push(`    ${why}: ${list.length > 3 ? `${list.slice(0, 3).join('; ')} and ${list.length - 3} more` : list.join('; ')}`)
  }
  if (res.failure) {
    const f = res.failure
    lines.push(`  STUCK at ${f.at}${f.kind === 'stuck' ? '' : ` (${f.kind})`}`)
    if (f.goal) lines.push(`    going for   ${f.goal}`)
    if (f.move) lines.push(`    next move   ${f.move}`)
    if (f.why) lines.push(`    why         ${f.why}`)
    if (f.missed?.length) {
      lines.push(`    not washed:`)
      for (const m of f.missed) lines.push(`      ${m}`)
    }
    if (f.tried?.length) {
      lines.push(`    what it tried:`)
      for (const t of f.tried) lines.push(`      ${t}`)
    }
  }
  lines.push(`  search       ${res.stats.decisions} decisions, ${res.stats.rollouts} look-aheads, ${(res.stats.simTicks / 1e6).toFixed(2)}M ticks simulated, ${(res.seconds ?? 0).toFixed(1)} s`)
  return lines
}
