// Hazards of the wash: drip, icicle, brush, jet, blower. Made at runtime by them: 'drip_drop'
// (the drop a drip lets go) and 'brush_rail' (a brush's rail; never place one).
//
// FOR LEVEL DESIGNERS (props, all optional; a tick is 1/60 s)
//
//   drip    'd'  a leak in the ceiling. Put the character in the open tile just under the
//           ceiling. Every `every` ticks (100, at least 40) a drop swells for 30 ticks (the
//           tell), lets go, falls and splashes on the first thing that would hold Maxx up
//           (floor, catwalk, lift, clean car roof). `phase` delays its beat by that many ticks.
//           `oil: true` is the dark oil look (the default in theme 'lube'), `oil: false`
//           grimy water. The drop costs a pip; spray pops it in the air.
//   icicle  'i'  16 x 28, hangs from the ceiling: the character goes in the open tile under
//           it. When Maxx is under it (his middle within 40 px of its middle, below it,
//           no more than 8 tiles down, nothing solid between) it shakes for 20 ticks, then
//           falls and shatters on the first thing that would hold Maxx up. One hit of
//           spray drops it at once (+50), so it can be cleared from a safe distance.
//           Only the falling icicle hurts. It does not grow back: a stub stays on the ceiling.
//   brush   'z'  a spinning wash brush on a rail, 28 wide and `h` px tall (64, at least 32).
//           The character is where its feet are at the start of the rail. `axis` 'x'
//           (default) or 'y'; `range` tiles along the rail (3; negative = left or up,
//           positive = right or down); `speed` px/s (60); `wait` ticks at each end (20);
//           `start` 0..1 how far along the rail it begins (0). A rail that runs into a wall,
//           floor or ceiling ends there (a 'y' rail stops 18 px under a ceiling, room for
//           its trolley). It always hurts; water is soaked up by it (it shields what is
//           behind it). It keeps time while off screen, so two brushes stay in step.
//   jet     'j'  a hot wax jet. Default: a nozzle under the ceiling (character in the open
//           tile under it) firing down. `dir: 'up'`: a nozzle on the floor (character in
//           the open tile above it) firing up. Beat: off `off` ticks (80), sputter 20 (the
//           tell), on `on` ticks (50). The column runs from the nozzle at most `len` tiles
//           from the nozzle's wall (6) and shoots out at 24 px a tick. It stops where Maxx
//           would: a down jet on a solid tile, a catwalk, a lift or a clean car roof; an up
//           jet only on a solid tile or a solid block's underside (it passes up through
//           catwalks and lifts, as he does). It hurts only while on. `phase` delays the beat:
//           0, 50, 100 on three jets with the default beat is a wave.
//   blower  (no default character) a dryer. The character is the machine; the wind zone
//           is the `w` (4) x `h` (3) tiles in front of it, starting at the next tile and
//           standing on the same floor line. `force` px/s (-120): negative blows left
//           (zone to the left of the machine), positive right. It pushes Maxx by that
//           speed, on the ground and in the air (never past the area's edge or out of a
//           locked arena), and bends the prep gun's water; it never hurts. 60 shortens
//           jumps, 120 is a slog, 180 cuts a full run (215) to a crawl. Zones that overlap
//           add up: two 120s against him are more than he can run into.
//           Gusts: `on` ticks of wind and `off` ticks of calm (both must be set), with the
//           last 20 calm ticks a spin-up tell, and `phase`. `machine: false` hides the
//           machine (weather: wind with no dryer).
//
// Beats (drip, jet, gusts) read world.tick, not the entity's own clock, so a row keeps its
// wave however the camera reached it.
//
// FOR THE RENDERER (render/entities/hazards.ts)
//
//   drip       box: 12 wide, from the ceiling line down to the surface its drops land on
//              (the lane), so it is drawn whenever any of it is on screen. 'idle' | 'swell'.
//              vars.swell 0..30: ticks into the swell. vars.oil 0 | 1. vars.dry 1: the lane
//              has no floor (a pit), so no stain.
//   drip_drop  box 8 x 10, z 1, born with its bottom 19 px under the ceiling (where the
//              swollen drop hung). 'fall' | 'splash' (8 ticks, harmless, then gone). vars.oil.
//   icicle     box 16 x 28, z 1. 'hang' | 'shake' (stateT 1..20) | 'fall' | 'shatter'
//              (12 ticks, where it landed) | 'gone' (box 16 x 6 back at the ceiling: a stub).
//   brush      box 28 x props.h, z 1. Always 'spin'. vars.axis 0 (x) | 1 (y), vars.run its
//              rail in px (signed, cut short at a wall), vars.t 0..1 along it, vars.dir,
//              vars.wait, vars.rail the id of its brush_rail.
//   brush_rail z 0 (behind Maxx). Its box covers everything it draws. vars.axis; vars.x0,
//              vars.x1 (a rail along x: its ends; along y both are its line), vars.y0, vars.y1
//              (along y: its ends; along x both are its line); vars.h0, vars.h1: where what
//              holds each end meets the room (a ceiling's underside above, or a floor below;
//              -1 none). Along y only h0 is used: a ceiling above the top end, or -1.
//   jet        z 1. 'off' | 'sputter' (stateT 1..20) | 'on'. vars.up 0 | 1. The nozzle's
//              mouth is at (vars.mx, vars.my); vars.full how far the column can run through
//              the tiles, vars.capped 1 when that ends in mid-air (no tile under it: no cold
//              wax stain). While on: vars.stop how far it can run this tick (a lift or a car
//              may cut it short), vars.len the column's length now, vars.end 1 when it ends
//              on something (draw a splash once len reaches stop). While on, the box is the
//              column (14 wide); otherwise it is 14 x 0 at the mouth and len is 0.
//   blower     box = the wind zone, z 0. 'blow' | 'calm' | 'rev' (stateT 1..20, the
//              spin-up). facing -1 blows left: the machine stands just right of the box.
//              vars.force px/s (signed).
import { DT, TILE } from '../../contract'
import {
  addScore,
  areaHeight,
  areaWidth,
  fx,
  hurtPlayer,
  inView,
  kill,
  moveBody,
  playerCx,
  propBool,
  propNum,
  propStr,
  pushPlayer,
  registerEntity,
  setBox,
  setState,
  sfxEvery,
  shoot,
  shuttle,
  solidAt,
  solidTop,
  spawn,
  tileInfoAt,
} from '../api'
import type { Entity, MoveOpts, World } from '../types'

/** Where a beat of `period` ticks stands, `phase` ticks late: 0 .. period - 1. */
function beat(w: World, period: number, phase: number): number {
  const c = (w.tick - Math.round(phase)) % period
  return c < 0 ? c + period : c
}

/** Would something falling stop on this tile? Solid tiles and catwalks. */
function standsAt(w: World, tx: number, ty: number): boolean {
  const info = tileInfoAt(w, tx, ty)
  return info.solid || info.oneWay
}

function solidTile(w: World, tx: number, ty: number): boolean {
  return tileInfoAt(w, tx, ty).solid
}

/* ------------------------------------------------------------------ */
/* drip                                                                */
/* ------------------------------------------------------------------ */

export const DRIP_SWELL = 30
const DRIP_MIN_EVERY = DRIP_SWELL + 10
/** Where the fully swollen drop hangs down to, under the ceiling: the falling drop starts with its bottom there. */
const DROP_START = 19
const DROP_SPLASH = 8
/** A drop only makes a sound when it lands this close to Maxx, so a room of leaks does not chatter. */
const DROP_EARSHOT = 200
const DROP_MOVE: MoveOpts = { conveyor: false, maxFall: 380 }
const OIL: Record<string, boolean> = Object.freeze({ oil: true })
const WATER: Record<string, boolean> = Object.freeze({ oil: false })

registerEntity('drip', {
  init(e, w) {
    e.x -= 6
    e.y -= TILE
    e.w = 12
    // The box is the drop's lane, down to the first surface under the leak.
    const tx = Math.floor((e.x + 6) / TILE)
    const rows = w.grid.h
    let end = rows * TILE
    e.vars.dry = 1
    for (let ty = Math.floor(e.y / TILE); ty < rows; ty++) {
      if (!standsAt(w, tx, ty)) continue
      end = ty * TILE
      e.vars.dry = 0
      break
    }
    e.h = Math.max(8, end - e.y)
    e.gravity = 0
    e.collides = false
    e.vars.oil = propBool(e, 'oil', w.area.theme === 'lube') ? 1 : 0
    e.vars.swell = 0
  },
  update(e, w) {
    const every = Math.max(DRIP_MIN_EVERY, Math.round(propNum(e, 'every', 100)))
    const c = beat(w, every, propNum(e, 'phase', 0))
    const swell = c >= every - DRIP_SWELL ? c - (every - DRIP_SWELL) + 1 : 0
    e.vars.swell = swell
    setState(e, swell > 0 ? 'swell' : 'idle')
    if (c === 0) shoot(w, 'drip_drop', e.x + e.w / 2, e.y + DROP_START, 0, 0, { props: e.vars.oil ? OIL : WATER })
  },
})

function splashDrop(e: Entity, w: World): void {
  setState(e, 'splash')
  e.harmful = false
  e.vx = 0
  e.vy = 0
  fx(w, 'drip', e.x + e.w / 2, e.y + e.h, 3)
  if (Math.abs(playerCx(w) - (e.x + e.w / 2)) <= DROP_EARSHOT && inView(e, w)) sfxEvery(w, 'pop', 10)
}

registerEntity('drip_drop', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 8, 10)
    e.harmful = true
    e.gravity = 0.4
    e.z = 1
    e.state = 'fall'
    e.vars.oil = e.props.oil === true ? 1 : 0
  },
  update(e, w) {
    if (e.state === 'splash') {
      if (e.stateT >= DROP_SPLASH) kill(e)
      return
    }
    moveBody(e, w, DROP_MOVE)
    if (e.onGround || e.hitCeil || e.hitWall !== 0) splashDrop(e, w)
  },
  onSpray(e, w) {
    if (e.state !== 'fall') return false
    splashDrop(e, w)
    return true
  },
  onTouch(e, w) {
    if (e.state !== 'fall') return true
    hurtPlayer(w, { fromX: e.x + e.w / 2 })
    splashDrop(e, w)
    return true
  },
})

/* ------------------------------------------------------------------ */
/* icicle                                                              */
/* ------------------------------------------------------------------ */

export const ICICLE_SHAKE = 20
const ICICLE_W = 16
const ICICLE_H = 28
/** How far to either side of it Maxx's middle sets it off. */
const ICICLE_RANGE = 40
/** ... and how far below it, in pixels. */
const ICICLE_DEPTH = 8 * TILE
const ICICLE_SHATTER = 12
const ICICLE_STUB = 6
const ICICLE_SCORE = 50
const ICICLE_MOVE: MoveOpts = { conveyor: false }

/** Is Maxx under it, with nothing solid in between? */
function maxxUnder(e: Entity, w: World): boolean {
  const p = w.player
  const cx = e.x + e.w / 2
  if (Math.abs(playerCx(w) - cx) > ICICLE_RANGE) return false
  const tip = e.y + e.h
  if (p.y + p.h <= tip || p.y > tip + ICICLE_DEPTH) return false
  for (let y = tip + 1; y < p.y; y += TILE) if (solidAt(w, cx, y)) return false
  return true
}

function shakeIcicle(e: Entity, w: World): void {
  if (!setState(e, 'shake')) return
  if (inView(e, w)) sfxEvery(w, 'freeze', 12)
  fx(w, 'snow', e.x + e.w / 2, e.y + 4, 2)
}

function dropIcicle(e: Entity): void {
  setState(e, 'fall')
  e.gravity = 0.7
  e.collides = true
  e.harmful = true
}

function stopIcicle(e: Entity): void {
  e.harmful = false
  e.gravity = 0
  e.collides = false
  e.vx = 0
  e.vy = 0
}

function shatterIcicle(e: Entity, w: World): void {
  setState(e, 'shatter')
  stopIcicle(e)
  fx(w, 'snow', e.x + e.w / 2, e.y + e.h - 4, 8)
  fx(w, 'sparkle', e.x + e.w / 2, e.y + e.h - 8, 3)
  if (inView(e, w)) sfxEvery(w, 'crumble', 6)
}

/** What is left is a stub on the ceiling, so the place it hung still shows. */
function icicleStub(e: Entity): void {
  setState(e, 'gone')
  stopIcicle(e)
  e.x = e.spawnX
  e.y = e.spawnY
  e.h = ICICLE_STUB
}

registerEntity('icicle', {
  init(e) {
    e.x -= ICICLE_W / 2
    e.y -= TILE
    e.w = ICICLE_W
    e.h = ICICLE_H
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.state = 'hang'
  },
  update(e, w) {
    switch (e.state) {
      case 'hang':
        if (maxxUnder(e, w)) shakeIcicle(e, w)
        break
      case 'shake':
        if (e.stateT >= ICICLE_SHAKE) dropIcicle(e)
        break
      case 'fall':
        moveBody(e, w, ICICLE_MOVE)
        if (e.onGround || e.hitCeil || e.hitWall !== 0) shatterIcicle(e, w)
        // Down a pit it is simply lost, before the world takes the whole thing away, stub and all.
        else if (e.y > areaHeight(w)) icicleStub(e)
        break
      case 'shatter':
        if (e.stateT >= ICICLE_SHATTER) icicleStub(e)
        break
    }
  },
  onSpray(e, w, d) {
    if (e.state !== 'hang' && e.state !== 'shake') return false
    dropIcicle(e)
    fx(w, 'sparkle', d.x, d.y, 2)
    fx(w, 'snow', e.x + e.w / 2, e.y + 2, 3)
    addScore(w, ICICLE_SCORE, e.x + e.w / 2, e.y + e.h)
    sfxEvery(w, 'sprayHit', 5)
    return true
  },
  onTouch(e, w) {
    if (e.state !== 'fall') return true
    hurtPlayer(w, { fromX: e.x + e.w / 2 })
    shatterIcicle(e, w)
    return true
  },
})

/* ------------------------------------------------------------------ */
/* brush and its rail                                                  */
/* ------------------------------------------------------------------ */

const BRUSH_W = 28
/** The rail runs this far above the brush's top; the trolley that rides it fills the gap. */
export const RAIL_GAP = 12
/** Room the trolley needs above the brush's top: a 'y' rail stops this far under a ceiling. */
const TROLLEY = 18
/** The rail runs on past the brush's furthest middle, so the trolley never leaves it. */
const RAIL_PAD = 16
/** ... but only this far where a wall cuts it short. */
const RAIL_PAD_WALL = 10
/** What holds a rail up: a rod to a ceiling at most this many tiles above, else legs to the floor. */
const HANG_TILES = 10

/** Is any tile in columns c0..c1 x rows r0..r1 solid? */
function solidSpan(w: World, c0: number, c1: number, r0: number, r1: number): boolean {
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (solidTile(w, c, r)) return true
  return false
}

/**
 * How far the brush can really run along its rail from where it was placed: `run` px, cut
 * short where the brush (or, along x, its trolley) would enter a solid tile.
 */
function brushRun(e: Entity, w: World, upright: boolean, run: number): number {
  if (run === 0) return 0
  const T = TILE
  if (!upright) {
    const r0 = Math.floor((e.y - TROLLEY) / T)
    const r1 = Math.floor((e.y + e.h - 1) / T)
    if (run > 0) {
      const right = e.x + e.w
      for (let c = Math.floor(right / T); c <= Math.floor((right + run - 1) / T); c++) if (solidSpan(w, c, c, r0, r1)) return Math.max(0, c * T - right)
    } else {
      for (let c = Math.floor((e.x - 1) / T); c >= Math.floor((e.x + run) / T); c--) if (solidSpan(w, c, c, r0, r1)) return Math.min(0, (c + 1) * T - e.x)
    }
    return run
  }
  const c0 = Math.floor(e.x / T)
  const c1 = Math.floor((e.x + e.w - 1) / T)
  if (run < 0) {
    const top = e.y - TROLLEY
    for (let r = Math.floor((top - 1) / T); r >= Math.floor((top + run) / T); r--) if (solidSpan(w, c0, c1, r, r)) return Math.min(0, (r + 1) * T - top)
  } else {
    const bottom = e.y + e.h
    for (let r = Math.floor(bottom / T); r <= Math.floor((bottom + run - 1) / T); r++) if (solidSpan(w, c0, c1, r, r)) return Math.max(0, r * T - bottom)
  }
  return run
}

/** The underside of the first solid tile above y in column tx, within HANG_TILES; -1 if none. */
function ceilingOver(w: World, tx: number, y: number): number {
  const r0 = Math.floor((y - 1) / TILE)
  for (let r = r0; r > r0 - HANG_TILES && r >= 0; r--) if (solidTile(w, tx, r)) return (r + 1) * TILE
  return -1
}

/** The top of the first tile something can stand on at or below y in column tx, within HANG_TILES; -1 if none. */
function floorUnder(w: World, tx: number, y: number): number {
  const r0 = Math.floor(y / TILE)
  for (let r = r0; r < r0 + HANG_TILES && r < w.grid.h; r++) if (standsAt(w, tx, r)) return r * TILE
  return -1
}

/** Lay out the brush's rail (and what holds it up) as an entity of its own, so it is drawn even when the brush is far off along it. */
function layRail(e: Entity, w: World, upright: boolean, run: number, cut: number): void {
  const rail = spawn(w, 'brush_rail', e.x + e.w / 2, e.y)
  if (!rail) return
  const v = rail.vars
  const mid = e.x + e.w / 2
  v.axis = upright ? 1 : 0
  if (!upright) {
    const y = e.y - RAIL_GAP
    // Where the run was cut by a wall the rail stops short of it too.
    const padLo = run < 0 && cut !== 0 ? RAIL_PAD_WALL : RAIL_PAD
    const padHi = run > 0 && cut !== 0 ? RAIL_PAD_WALL : RAIL_PAD
    v.x0 = mid + Math.min(0, run) - padLo
    v.x1 = mid + Math.max(0, run) + padHi
    v.y0 = y
    v.y1 = y
    for (const end of [0, 1]) {
      const x = end ? v.x1 : v.x0
      const tx = Math.floor(x / TILE)
      const up = ceilingOver(w, tx, y - 4)
      v[end ? 'h1' : 'h0'] = up >= 0 ? up : floorUnder(w, tx, y + 4)
    }
  } else {
    const top = e.y + Math.min(0, run) - RAIL_GAP
    const ceil = ceilingOver(w, Math.floor(mid / TILE), top)
    v.x0 = mid
    v.x1 = mid
    // Up to the ceiling if it is near, else on a little past the trolley's highest place.
    v.y0 = ceil >= 0 && ceil >= top - RAIL_PAD ? ceil : top - RAIL_PAD
    v.y1 = e.y + Math.max(0, run) + e.h
    v.h0 = ceil >= 0 && ceil < v.y0 ? ceil : -1
    v.h1 = -1
  }
  // The box holds all of it, so the world renderer never leaves part of it out.
  let x0 = v.x0 - 6
  let x1 = v.x1 + 6
  let y0 = v.y0 - 6
  let y1 = v.y1 + 6
  for (const h of [v.h0, v.h1]) {
    if (h < 0) continue
    y0 = Math.min(y0, h)
    y1 = Math.max(y1, h)
  }
  if (upright) {
    x0 = Math.min(x0, mid - 12)
    x1 = Math.max(x1, mid + 12)
  }
  rail.x = x0
  rail.y = y0
  rail.w = x1 - x0
  rail.h = y1 - y0
  e.vars.rail = rail.id
}

registerEntity('brush', {
  // Like a lift: it keeps its place on the rail while off screen, so pairs stay in step.
  alwaysActive: true,
  init(e, w) {
    setBox(e, BRUSH_W, Math.max(TILE, Math.round(propNum(e, 'h', 64))))
    e.harmful = true
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.state = 'spin'
    const upright = propStr(e, 'axis', 'x') === 'y'
    const want = Math.round(propNum(e, 'range', 3) * TILE)
    const run = brushRun(e, w, upright, want)
    e.vars.axis = upright ? 1 : 0
    e.vars.run = run
    e.vars.t = Math.max(0, Math.min(1, propNum(e, 'start', 0)))
    e.vars.dir = 1
    e.vars.wait = 0
    layRail(e, w, upright, run, run !== want ? 1 : 0)
  },
  update(e, w) {
    const run = e.vars.run
    // It whirs as it turns at an end of its rail, if anyone is there to hear it.
    if (shuttle(e, e.vars.axis ? 0 : run, e.vars.axis ? run : 0, propNum(e, 'speed', 60), propNum(e, 'wait', 20)) && inView(e, w)) sfxEvery(w, 'whir', 20)
  },
  onSpray(_e, w, d) {
    fx(w, 'foam', d.x, d.y, 1, d.vx > 0 ? -1 : 1)
    return true
  },
})

registerEntity('brush_rail', {
  init(e) {
    e.w = 0
    e.h = 0
    e.gravity = 0
    e.collides = false
    e.vars.h0 = -1
    e.vars.h1 = -1
  },
  update() {},
})

/* ------------------------------------------------------------------ */
/* jet                                                                 */
/* ------------------------------------------------------------------ */

export const JET_SPUTTER = 20
const JET_W = 14
/** The nozzle hangs this far out of its ceiling (or stands this far off its floor). */
const JET_NOZZLE = 12
/** Pixels a tick the column shoots out at. */
const JET_GROW = 24

/** Does the column stop on this tile? Down onto a floor or a catwalk; up only into something solid. */
function jetStopsAt(w: World, up: boolean, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE)
  const ty = Math.floor(y / TILE)
  return up ? solidTile(w, tx, ty) : standsAt(w, tx, ty)
}

/** How far the column can run through the tiles from the mouth: to the first tile it stops on, `len` tiles from the nozzle's wall, or the area's edge. */
function jetReach(e: Entity, w: World): void {
  const v = e.vars
  const up = v.up === 1
  const dir = up ? -1 : 1
  const edge = up ? v.my : areaHeight(w) - v.my
  const limit = Math.max(0, Math.min(Math.max(1, Math.round(propNum(e, 'len', 6))) * TILE - JET_NOZZLE, edge))
  let reach = 0
  // The mouth sits JET_NOZZLE into its tile: the first step ends on that tile's far edge.
  let step = TILE - JET_NOZZLE
  while (reach < limit && !jetStopsAt(w, up, v.mx, v.my + dir * (reach + 1))) {
    reach += step
    step = TILE
  }
  v.full = Math.min(reach, limit)
  v.capped = jetStopsAt(w, up, v.mx, v.my + dir * (v.full + 1)) ? 0 : 1
}

/** This tick's reach: a lift or a clean car under a down jet (or a solid block over an up one) cuts the column short. */
function jetStop(e: Entity, w: World): void {
  const v = e.vars
  const up = v.up === 1
  let stop = v.full
  let end = v.capped ? 0 : 1
  const left = v.mx - JET_W / 2
  const right = v.mx + JET_W / 2
  const solids = w.solids
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    if (s.dead || s.x >= right || s.x + s.w <= left) continue
    if (up) {
      if (s.solid !== 'full' || s.y >= v.my) continue
      const d = Math.max(0, v.my - (s.y + s.h))
      if (d < stop) {
        stop = d
        end = 1
      }
    } else {
      if (s.y + s.h <= v.my) continue
      // Its roof line (a washed car's hood sits lower than its box top).
      const d = Math.max(0, solidTop(s, left, JET_W) - v.my)
      if (d < stop) {
        stop = d
        end = 1
      }
    }
  }
  v.stop = stop
  v.end = end
}

function jetBox(e: Entity, len: number): void {
  e.vars.len = len
  e.h = len
  e.y = e.vars.up ? e.vars.my - len : e.vars.my
}

registerEntity('jet', {
  init(e, w) {
    const v = e.vars
    v.up = e.props.dir === 'up' ? 1 : 0
    v.mx = e.x
    v.my = v.up ? e.y - JET_NOZZLE : e.y - TILE + JET_NOZZLE
    e.x -= JET_W / 2
    e.w = JET_W
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.state = 'off'
    jetReach(e, w)
    v.stop = v.full
    v.end = v.capped ? 0 : 1
    jetBox(e, 0)
  },
  update(e, w) {
    const off = Math.max(0, Math.round(propNum(e, 'off', 80)))
    const on = Math.max(1, Math.round(propNum(e, 'on', 50)))
    const c = beat(w, off + JET_SPUTTER + on, propNum(e, 'phase', 0))
    const v = e.vars
    const seen = inView(e, w, TILE)
    if (c < off) {
      setState(e, 'off')
      e.harmful = false
      jetBox(e, 0)
    } else if (c < off + JET_SPUTTER) {
      setState(e, 'sputter')
      // Woken part-way through: the clock still says how far into the tell it is.
      e.stateT = c - off + 1
      e.harmful = false
      jetBox(e, 0)
      if (seen && e.stateT % 8 === 1) {
        sfxEvery(w, 'sizzle', 4)
        fx(w, 'spark', v.mx, v.my, 2)
      }
    } else {
      if (setState(e, 'on')) {
        // The tiles may have changed since it last fired (a grime block washed away).
        jetReach(e, w)
        if (seen) sfxEvery(w, 'sizzle', 2)
      }
      e.stateT = c - off - JET_SPUTTER + 1
      e.harmful = true
      jetStop(e, w)
      jetBox(e, Math.min(v.stop, v.len + JET_GROW))
      if (seen && v.end && v.len >= v.stop && e.stateT % 6 === 0) fx(w, 'steam', v.mx, v.my + (v.up ? -v.len : v.len), 1)
    }
  },
})

/* ------------------------------------------------------------------ */
/* blower                                                              */
/* ------------------------------------------------------------------ */

export const BLOWER_REV = 20
/** How hard the wind leans on the prep gun's water, against how hard it leans on Maxx. */
const BLOWER_WATER = 6

registerEntity('blower', {
  init(e) {
    const force = propNum(e, 'force', -120)
    e.vars.force = force
    e.facing = force < 0 ? -1 : 1
    e.w = Math.max(1, Math.round(propNum(e, 'w', 4))) * TILE
    e.h = Math.max(1, Math.round(propNum(e, 'h', 3))) * TILE
    // The character is the machine's tile; the wind fills the tiles in front of it.
    e.x = force < 0 ? e.x - TILE / 2 - e.w : e.x + TILE / 2
    e.y -= e.h
    e.gravity = 0
    e.collides = false
    e.state = 'blow'
  },
  update(e, w) {
    const on = Math.round(propNum(e, 'on', 0))
    const off = Math.round(propNum(e, 'off', 0))
    if (on > 0 && off > 0) {
      const c = beat(w, on + off, propNum(e, 'phase', 0))
      const rev = Math.min(BLOWER_REV, off)
      if (c < on) {
        if (setState(e, 'blow') && inView(e, w, TILE)) sfxEvery(w, 'whir', 10)
      } else if (c < on + off - rev) {
        setState(e, 'calm')
      } else {
        setState(e, 'rev')
        e.stateT = c - (on + off - rev) + 1
      }
    }
    if (e.state !== 'blow') return
    // Bend the prep gun's water. Droplets fly after this in the tick, so the wind is in their next step.
    const dv = e.vars.force * BLOWER_WATER * DT
    const ds = w.droplets
    const x1 = e.x + e.w
    const y1 = e.y + e.h
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]
      if (d.x >= e.x && d.x < x1 && d.y >= e.y && d.y < y1) d.vx += dv
    }
  },
  onTouch(e, w) {
    if (e.state !== 'blow') return true
    // Touches come after he has been kept inside the area (and a locked arena) for this tick,
    // so the push has to respect those edges itself. One already outside is not pushed further out.
    const p = w.player
    let lo = 0
    let hi = areaWidth(w) - p.w
    if (w.camBounds) {
      lo = Math.max(lo, w.camBounds.x0)
      hi = Math.min(hi, w.camBounds.x1 - p.w)
    }
    let dx = e.vars.force * DT
    if (dx < 0) dx = Math.max(dx, Math.min(0, lo - p.x))
    else dx = Math.min(dx, Math.max(0, hi - p.x))
    if (dx !== 0) pushPlayer(w, dx)
    return true
  },
})
