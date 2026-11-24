// The world: built from a level, then stepped one tick at a time.
//
// A tick while the level is being played:
//   clock -> wake/sleep entities -> solid entities update -> the rest update
//   -> Maxx -> droplets fly, the gun fires -> touches -> dead entities go
//   -> camera.
// During a pipe or door trip only the trip advances. Once the level is over
// (clear, grimed, timeup) only Maxx's walk or flop and the camera move.
import { ACTIONS, COINS_PER_LIFE, MAX_PIPS, START_LIVES, STEP_HZ, TILE, VIEW_H, VIEW_W } from '../contract'
import type { ActionState, InputFrame, LevelDef } from '../contract'
import { downHeld, emit, endInGrime, hurtPlayer, makeEntity, music, pipeSpan, sfx, upHeld } from './api'
import { START_KIND, WASHED_FLAG, countCars, findMarker, findStart, numberTokens, parseArea, tileFeetX, tileFeetY } from './level'
import { floorUnder, makePlayer, stepFlop, stepPlayer } from './player'
import { getBehavior } from './registry'
import { fireGun, stepDroplets } from './spray'
import { TUNING as T } from './tuning'
import type { AreaState, Entity, Player, TouchSide, Warp, World, WorldOpts } from './types'

/** How far into something's top Maxx's feet may already be and still count as landing on it. */
const STOMP_TOL = 8
/** Seconds on the clock for a level whose `time` is missing or not above 0 (validateLevel calls that an error). */
const FALLBACK_TIME = 300

/** A session counter made safe: a whole number from 0 to `max`, or `fallback` if it is not a number at all. */
function counter(v: number, max: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : fallback
}

function noActions(): ActionState {
  const s = {} as ActionState
  for (const a of ACTIONS) s[a] = false
  return s
}

/** Nothing pressed: what Maxx gets once the level is over. Never written. */
const IDLE: InputFrame = {
  held: noActions(),
  pressed: noActions(),
  released: noActions(),
  repeat: noActions(),
  axisX: 0,
  axisY: 0,
  device: 'keyboard',
}

/** Build a fresh World for a level attempt. */
export function createWorld(level: LevelDef, opts: WorldOpts): World {
  const areas: Record<string, AreaState> = {}
  const list: AreaState[] = []
  for (const def of level.areas) {
    const area = parseArea(def)
    list.push(area)
    if (!areas[def.id]) areas[def.id] = area
  }
  numberTokens(list)

  const cp = opts.checkpoint && areas[opts.checkpoint.areaId] ? opts.checkpoint : null
  const first = cp ? areas[cp.areaId] : list[0]
  const start = findStart(list[0])
  const feetX = cp ? cp.x : start ? tileFeetX(start.tx) : TILE * 2.5
  const feetY = cp ? cp.y : start ? tileFeetY(start.ty) : TILE * 2

  const session = opts.session
  // 0 pips means the last attempt ended GRIMED: a retry starts shiny.
  if (!(session.pips >= 1 && session.pips <= MAX_PIPS)) session.pips = MAX_PIPS
  else session.pips = Math.floor(session.pips)
  // The session is the shell's object: whatever state it is in, the counters must start as whole numbers in range.
  session.lives = counter(session.lives, T.maxLives, START_LIVES)
  session.score = counter(session.score, T.maxScore, 0)
  session.coins = counter(session.coins, COINS_PER_LIFE - 1, 0)
  session.turbo = session.turbo === true
  const flags = { ...(opts.flags ?? {}) }
  let washed = 0
  for (const name of Object.keys(flags)) if (name.startsWith(WASHED_FLAG)) washed++

  const w: World = {
    level,
    area: first.def,
    grid: first.grid,
    player: makePlayer(feetX, feetY, session.pips, session.turbo),
    entities: [],
    droplets: [],
    camera: { x: 0, y: 0 },
    tick: 0,
    timeLeft: Math.round((level.time > 0 ? level.time : FALLBACK_TIME) * STEP_HZ),
    status: 'play',
    exit: null,
    clearWalk: true,
    statusT: 0,
    events: [],
    stats: {
      carsTotal: countCars(list),
      // Cars washed on an earlier attempt stay counted (see washCar).
      carsWashed: washed,
      tokens: opts.tokens ? [opts.tokens[0], opts.tokens[1], opts.tokens[2]] : [false, false, false],
      coins: 0,
      score: 0,
    },
    session,
    checkpoint: cp ? { areaId: cp.areaId, x: cp.x, y: cp.y } : null,
    boss: null,
    bossMusic: null,
    flags,
    seed: (opts.seed ?? 0x2f6e2b1) | 0,
    nextId: 1,
    input: IDLE,
    lastAxisY: 0,
    areas,
    warp: null,
    warpLock: false,
    bumps: [],
    chain: 0,
    chainT: 0,
    camLook: 0,
    camBounds: null,
    sfxAt: {},
    solids: [],
    actives: [],
  }
  enterArea(w, first.def.id)
  stepCamera(w, true)
  return w
}

/** Advance the world one tick (1/60 s). */
export function stepWorld(w: World, input: InputFrame): void {
  w.input = input
  tick(w, input)
  w.lastAxisY = input.axisY
}

function tick(w: World, input: InputFrame): void {
  const p = w.player
  if (w.status !== 'play') {
    w.statusT++
    // Everything else has stopped: whatever he stands on must not go on carrying him.
    for (let i = 0; i < w.solids.length; i++) {
      const s = w.solids[i]
      s.px = s.x
      s.py = s.y
    }
    if (w.status === 'clear') stepPlayer(w, IDLE)
    else stepFlop(w)
    if (w.droplets.length > 0) w.droplets.length = 0
    stepBumps(w)
    stepCamera(w, false)
    return
  }
  if (w.warp) {
    stepWarp(w, w.warp)
    stepBumps(w)
    return
  }

  w.tick++
  w.timeLeft--
  if (w.timeLeft <= 0) {
    w.timeLeft = 0
    endInGrime(w, 'timeup', 'TIME UP!')
    return
  }
  if (w.timeLeft % STEP_HZ === 0 && T.timeWarnAt.includes(w.timeLeft / STEP_HZ)) sfx(w, 'timeWarn')
  if (w.chainT > 0 && --w.chainT === 0) w.chain = 0
  if (w.warpLock && !upHeld(w) && !downHeld(w)) w.warpLock = false

  wake(w)
  updateAll(w, w.solids)
  updateAll(w, w.actives)
  // A behaviour may have sent him down a pipe or ended the level.
  if (w.status === 'play' && !w.warp) {
    stepPlayer(w, input)
    stepDroplets(w)
    if (w.status === 'play') {
      fireGun(w)
      touches(w, p)
    }
  }
  sweepDead(w)
  stepBumps(w)
  stepCamera(w, false)
  w.session.pips = p.pips
  w.session.turbo = p.turbo
}

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

/** Decide who is awake this tick, and sort the awake into solids (updated first) and the rest. */
function wake(w: World): void {
  const ents = w.entities
  const c = w.camera
  const aL = c.x - T.activeMargin
  const aR = c.x + VIEW_W + T.activeMargin
  const aT = c.y - T.activeMargin
  const aB = c.y + VIEW_H + T.activeMargin
  const sL = c.x - T.sleepMargin
  const sR = c.x + VIEW_W + T.sleepMargin
  const sT = c.y - T.sleepMargin
  const sB = c.y + VIEW_H + T.sleepMargin
  const areaW = w.grid.w * TILE
  const areaH = w.grid.h * TILE
  w.solids.length = 0
  w.actives.length = 0
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]
    if (e.dead) continue
    const beh = getBehavior(e.kind)
    if (!beh) continue
    if (beh.alwaysActive) {
      e.active = true
    } else {
      const right = e.x + e.w
      const bottom = e.y + e.h
      if (e.y > areaH + T.areaMargin || right < -T.areaMargin || e.x > areaW + T.areaMargin) {
        e.dead = true
        continue
      }
      if (!e.active) {
        if (e.x < aR && right > aL && e.y < aB && bottom > aT) e.active = true
      } else if (e.x > sR || right < sL || e.y > sB || bottom < sT) {
        const mode = beh.offscreen
        if (mode === 'remove') {
          e.dead = true
          continue
        }
        if (mode === 'removeBehind' && !beh.keep?.(e)) {
          const heading = e.vx !== 0 ? e.vx : e.facing
          if ((right < sL && heading < 0) || (e.x > sR && heading > 0)) {
            e.dead = true
            continue
          }
        }
        e.active = false
      }
    }
    if (!e.active) continue
    e.px = e.x
    e.py = e.y
    if (e.solid !== 'none') w.solids.push(e)
    else w.actives.push(e)
  }
  // Solid things that can ride (a washed car) go after the ones that cannot (a lift), keeping
  // their order otherwise: a carrier has to have moved before its rider asks how far.
  const solids = w.solids
  let carriers = 0
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    if (s.collides) continue
    for (let j = i; j > carriers; j--) solids[j] = solids[j - 1]
    solids[carriers++] = s
  }
}

function updateAll(w: World, list: Entity[]): void {
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (e.dead) continue
    e.stateT++
    getBehavior(e.kind)?.update(e, w)
  }
}

function touches(w: World, p: Player): void {
  if (p.state !== 'normal' && p.state !== 'hurt') return
  const ents = w.entities
  const n = ents.length
  for (let i = 0; i < n; i++) {
    const e = ents[i]
    if (!e.active || e.dead) continue
    if (p.x >= e.x + e.w || p.x + p.w <= e.x || p.y >= e.y + e.h || p.y + p.h <= e.y) continue
    const beh = getBehavior(e.kind)
    if (!beh) continue
    const handled = beh.onTouch ? beh.onTouch(e, w, touchSide(p, e)) : false
    if (!handled && e.harmful && !e.dead && p.invuln === 0 && p.wax === 0) hurtPlayer(w, { fromX: e.x + e.w / 2 })
    if (w.status !== 'play' || w.warp) return
  }
}

/** Which way Maxx met it, judged by where both were a tick ago and how they closed. */
function touchSide(p: Player, e: Entity): TouchSide {
  const closing = p.y - p.py - (e.y - e.py)
  if (closing > 0 && p.py + p.h <= e.py + STOMP_TOL) return 'stomp'
  if (closing < 0 && p.py >= e.py + e.h - STOMP_TOL) return 'below'
  return 'side'
}

function sweepDead(w: World): void {
  const ents = w.entities
  let k = 0
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]
    if (!e.dead) ents[k++] = e
  }
  ents.length = k
}

function stepBumps(w: World): void {
  const bumps = w.bumps
  for (let i = bumps.length - 1; i >= 0; i--) {
    if (++bumps[i].t >= T.bumpTicks) bumps.splice(i, 1)
  }
}

/* ------------------------------------------------------------------ */
/* Areas and warps                                                     */
/* ------------------------------------------------------------------ */

/** Make an area the current one. Its entities are built the first time and kept from then on. */
export function enterArea(w: World, areaId: string): void {
  const area = w.areas[areaId]
  w.droplets.length = 0
  w.solids.length = 0
  w.actives.length = 0
  w.bumps.length = 0
  w.camBounds = null
  // A fight belongs to its area, as its camera lock does.
  w.bossMusic = null
  w.area = area.def
  w.grid = area.grid
  w.entities = buildArea(w, areaId)
}

/**
 * An area's entities, built from its spawns the first time it is asked for (exactly as the first
 * entry builds them) and kept from then on. It does not make the area the current one, so the
 * level tools can build every area of a world up front. Returns the area's entity list.
 */
export function buildArea(w: World, areaId: string): Entity[] {
  const area = w.areas[areaId]
  if (area.entities) return area.entities
  const keep = { def: w.area, grid: w.grid, entities: w.entities }
  // A kind's init sees the area it is born in, and what it spawns goes into that area's list.
  w.area = area.def
  w.grid = area.grid
  area.entities = []
  w.entities = area.entities
  for (let slot = 0; slot < area.spawns.length; slot++) {
    const sp = area.spawns[slot]
    const { kind, variant, props } = sp.spec
    if (kind === START_KIND) continue
    // Unknown kinds are skipped: another module may add them later.
    const e = makeEntity(w, kind, tileFeetX(sp.tx), tileFeetY(sp.ty), variant, props, sp.token, slot)
    if (e) area.entities.push(e)
  }
  w.area = keep.def
  w.grid = keep.grid
  w.entities = keep.entities
  return area.entities
}

function stepWarp(w: World, wp: Warp): void {
  const p = w.player
  p.stateT++
  wp.t++
  const k = Math.min(1, wp.t / wp.ticks)
  if (wp.phase === 'out') {
    if (wp.mode === 'pipe') {
      p.x = wp.fromX + (wp.toX - wp.fromX) * Math.min(1, k * 3)
      p.y = wp.fromY + (p.h + 4) * k
    }
    if (wp.t >= wp.ticks) arrive(w, wp)
    return
  }
  if (wp.mode === 'pipe') p.y = wp.fromY - p.h * k
  if (wp.t < wp.ticks) return
  w.warp = null
  w.warpLock = true
  p.state = 'normal'
  p.stateT = 0
  p.px = p.x
  p.py = p.y
  p.onGround = true
  // Read now, not at his first landing: a jump on the very first tick off a mud arrival is a mud jump.
  p.floor = floorUnder(w, p)
  p.jumpBuf = 0
  p.airT = 0
  p.coyote = T.coyoteTicks + 1
  p.hover = T.hoverTicks
  p.invuln = Math.max(p.invuln, T.warpGrace)
}

/** The far side of a warp: swap areas, put Maxx at the marker, tell the play scene. */
function arrive(w: World, wp: Warp): void {
  const p = w.player
  const dest = w.areas[wp.toArea]
  const marker = dest ? findMarker(dest, wp.toMarker) : undefined
  if (!dest || !marker) {
    // warpTo checked the target, so this is only a level edited mid-trip. Put him back.
    p.x = wp.fromX
    p.y = wp.fromY
    p.state = 'normal'
    w.warp = null
    return
  }
  const songBefore = w.bossMusic ?? w.area.music ?? w.level.music
  enterArea(w, wp.toArea)

  const pipe = pipeSpan(w, marker.tx, marker.ty + 1)
  const feetY = tileFeetY(marker.ty)
  p.x = (pipe ? pipe.x + pipe.w / 2 : tileFeetX(marker.tx)) - p.w / 2
  p.y = feetY - p.h
  p.vx = 0
  p.vy = 0
  p.ridingId = 0
  p.floor = ''
  stepCamera(w, true)

  wp.phase = 'in'
  wp.t = 0
  wp.fromX = p.x
  wp.toX = p.x
  if (wp.mode === 'pipe' && pipe) {
    // He starts wholly inside the pipe and rises out of it.
    wp.ticks = T.pipeInTicks
    wp.fromY = feetY
    p.y = feetY
    sfx(w, 'pipe')
  } else {
    wp.mode = 'door'
    wp.ticks = T.doorInTicks
    wp.fromY = p.y
  }
  p.px = p.x
  p.py = p.y

  emit(w, { type: 'area', areaId: wp.toArea })
  const song = w.area.music ?? w.level.music
  if (song !== songBefore && p.wax === 0) music(w, song)
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

/**
 * Follow Maxx: a little ahead of the way he faces, never past the edges of
 * the area. Areas no taller than the screen sit on their bottom edge; taller
 * ones scroll to keep him between two lines. `snap` jumps straight there.
 */
function stepCamera(w: World, snap: boolean): void {
  const p = w.player
  const c = w.camera
  const want = p.facing * T.camLookAhead
  if (snap) w.camLook = want
  else if (w.camLook < want) w.camLook = Math.min(want, w.camLook + T.camLookSpeed)
  else if (w.camLook > want) w.camLook = Math.max(want, w.camLook - T.camLookSpeed)

  const maxX = w.grid.w * TILE - VIEW_W
  if (maxX <= 0) {
    c.x = maxX / 2
  } else {
    const arena = w.camBounds
    const lo = arena ? Math.min(maxX, arena.x0) : 0
    const hi = arena ? Math.max(lo, Math.min(maxX, arena.x1 - VIEW_W)) : maxX
    const x = Math.max(lo, Math.min(hi, p.x + p.w / 2 + w.camLook - VIEW_W / 2))
    // Following Maxx never needs this much speed, so the limit only shows when an arena locks or
    // lets go: the camera slides there. More than a screen away is a teleport, and a cut.
    c.x = snap || Math.abs(x - c.x) > VIEW_W ? x : Math.max(c.x - T.camMaxSpeed, Math.min(c.x + T.camMaxSpeed, x))
  }

  const maxY = w.grid.h * TILE - VIEW_H
  if (maxY <= TILE) {
    c.y = maxY
    return
  }
  const top = p.y - T.camTop
  const bottom = p.y + p.h - T.camBottom
  let y = c.y
  if (snap) y = bottom
  else if (y > top) y = Math.max(top, y - T.camUpSpeed)
  else if (y < bottom) y = Math.min(bottom, y + T.camDownSpeed)
  c.y = Math.max(0, Math.min(maxY, y))
}
