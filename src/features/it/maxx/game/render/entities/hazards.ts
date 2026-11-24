// Draws the hazards of sim/entities/hazards.ts (drip, drip_drop, icicle, brush, brush_rail, jet,
// blower) from the 'hazards' atlas (scripts/maxx/art-hazards.mjs). What each state and var means
// is in the header of the sim file; the sizes and anchors of the frames are in the atlas meta.
//
// Things the simulation does not need but the player does are drawn here too: the stain under
// a leak, the cold wax under a jet, a brush's rail and what holds it up.
import { TILE } from '../../contract'
import type { Entity } from '../../sim/types'
import { registerRenderer } from '../registry'
import type { RenderCtx } from '../registry'

const names = (base: string, n: number): string[] => Array.from({ length: n }, (_, i) => `hazards/${base}${i}`)

const LEAK = 'hazards/leak'
const SWELL = names('swell', 4)
const SWELL_OIL = names('swellOil', 4)
const DROP = names('drop', 2)
const DROP_OIL = names('dropOil', 2)
const SPLASH = names('splash', 3)
const SPLASH_OIL = names('splashOil', 3)
const PUDDLE = 'hazards/puddle'
const PUDDLE_OIL = 'hazards/puddleOil'

const ICICLE = 'hazards/icicle'
const CRACK = 'hazards/icicleCrack'
const STUB = 'hazards/icicleStub'
const SHATTER = names('shatter', 4)

const TIER_A = names('brushTierA', 4)
const TIER_B = names('brushTierB', 4)
const BRUSH_TOP = 'hazards/brushTop'
const BRUSH_BOT = 'hazards/brushBot'
const RAIL = 'hazards/rail'
const RAIL_V = 'hazards/railV'
const RAIL_STOP = 'hazards/railStop'
const CARRIAGE = names('carriage', 2)
const ROD = 'hazards/rod'

const NOZZLE = 'hazards/nozzle'
const NOZZLE_HOT = 'hazards/nozzleHot'
const NOZZLE_UP = 'hazards/nozzleUp'
const NOZZLE_UP_HOT = 'hazards/nozzleUpHot'
const FLOW = names('flow', 4)
const FLOW_UP = names('flowUp', 4)
const HEAD = names('flowHead', 4)
const HEAD_UP = names('flowHeadUp', 4)
const WAX_SPLASH = names('waxSplash', 3)
const WAX_SPLASH_UP = names('waxSplashUp', 3)
const SPURT = names('spurt', 3)
const SPURT_UP = names('spurtUp', 3)
const STAIN = 'hazards/waxStain'
const STAIN_UP = 'hazards/waxStainUp'

const BLOWER = names('blower', 3)
const POST = 'hazards/blowerPost'
const FOOT = 'hazards/blowerFoot'
const GUST = names('gust', 3)
const GUST_R = names('gustR', 3)

/** Sizes from the atlas meta, read once it is loaded (these are the values the art script writes). */
const M = {
  mouth: 8,
  swell: [6, 8, 8, 8],
  tier: 8,
  brushFrom: 2,
  brushTo: 3,
  railTile: 16,
  nozzle: 12,
  flowTile: 16,
  head: 10,
  unit: 32,
}
let metaRead = false
function readMeta(rc: RenderCtx): void {
  const meta = rc.sprites.atlas('hazards')?.meta as Record<string, Record<string, unknown>> | undefined
  if (!meta) return
  metaRead = true
  const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback)
  M.mouth = num(meta.leak?.mouth, M.mouth)
  if (Array.isArray(meta.swell?.ticks) && meta.swell.ticks.length === 4) M.swell = meta.swell.ticks as number[]
  M.tier = num(meta.brush?.tier, M.tier)
  M.brushFrom = num(meta.brush?.from, M.brushFrom)
  M.brushTo = num(meta.brush?.to, M.brushTo)
  M.railTile = num(meta.rail?.tile, M.railTile)
  M.nozzle = num(meta.jet?.nozzle, M.nozzle)
  M.flowTile = num(meta.jet?.tile, M.flowTile)
  M.head = num(meta.jet?.head, M.head)
  M.unit = num(meta.blower?.unit, M.unit)
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Part of a frame, `sh` rows from row `sy`, with its top-left at a world point. */
function drawRows(g: CanvasRenderingContext2D, rc: RenderCtx, name: string, left: number, top: number, sy: number, sh: number): void {
  const src = rc.sprites.source(name)
  if (!src || sh <= 0) return
  const f = src.frame
  g.drawImage(src.image, f.x, f.y + sy, f.w, sh, rc.sx(left), rc.sy(top), f.w, sh)
}

/** Part of a frame, `sw` columns from column `sx`, with its top-left at a world point. */
function drawCols(g: CanvasRenderingContext2D, rc: RenderCtx, name: string, left: number, top: number, sx: number, sw: number): void {
  const src = rc.sprites.source(name)
  if (!src || sw <= 0) return
  const f = src.frame
  g.drawImage(src.image, f.x + sx, f.y, sw, f.h, rc.sx(left), rc.sy(top), sw, f.h)
}

/** A frame repeated down a column from y0 to y1, centred on x (the last copy cut short). */
function tileDown(g: CanvasRenderingContext2D, rc: RenderCtx, name: string, x: number, y0: number, y1: number, step: number): void {
  const f = rc.sprites.frame(name)
  if (!f) return
  const left = Math.round(x) - (f.ax ?? 0)
  for (let y = y0; y < y1; y += step) drawRows(g, rc, name, left, y, 0, Math.min(step, y1 - y))
}

/* ------------------------------------------------------------------ */
/* drip and its drops                                                  */
/* ------------------------------------------------------------------ */

function swellFrame(t: number): number {
  let k = 0
  let end = M.swell[0]
  while (k < 3 && t > end) end += M.swell[++k]
  return k
}

registerRenderer('drip', (_g, e, rc) => {
  if (!metaRead) readMeta(rc)
  const cx = e.x + e.w / 2
  const oil = e.vars.oil === 1
  // Where its drops land (the bottom of its box, the lane): a stain, so the spot shows before the first drop does.
  if (e.vars.dry !== 1) rc.draw(oil ? PUDDLE_OIL : PUDDLE, cx, e.y + e.h)
  rc.draw(LEAK, cx, e.y)
  const swell = e.vars.swell ?? 0
  if (e.state === 'swell' && swell > 0) rc.draw((oil ? SWELL_OIL : SWELL)[swellFrame(swell)], cx, e.y + M.mouth)
})

registerRenderer('drip_drop', (_g, e, rc) => {
  const oil = e.vars.oil === 1
  const cx = e.x + e.w / 2
  const foot = e.y + e.h
  if (e.state === 'splash') rc.draw((oil ? SPLASH_OIL : SPLASH)[Math.min(2, Math.floor((e.stateT - 1) / 3))], cx, foot)
  else rc.draw((oil ? DROP_OIL : DROP)[e.vy > 170 ? 1 : 0], cx, foot)
})

/* ------------------------------------------------------------------ */
/* icicle                                                              */
/* ------------------------------------------------------------------ */

registerRenderer('icicle', (_g, e, rc) => {
  const cx = e.x + e.w / 2
  const home = e.spawnX + e.w / 2
  switch (e.state) {
    case 'shake': {
      // A slow wobble, then a fast one once it cracks: the last moment to step aside.
      const late = e.stateT > 10
      const dx = (late ? e.stateT >> 1 : e.stateT >> 2) & 1 ? 1 : -1
      rc.draw(late ? CRACK : ICICLE, cx + dx, e.y)
      break
    }
    case 'fall':
      // The piece that broke off keeps its crack, so the first tick of the fall does not flash back to whole.
      rc.draw(STUB, home, e.spawnY)
      rc.draw(CRACK, cx, e.y)
      break
    case 'shatter':
      rc.draw(STUB, home, e.spawnY)
      rc.draw(SHATTER[Math.min(3, Math.floor((e.stateT - 1) / 3))], cx, e.y + e.h)
      break
    case 'gone':
      rc.draw(STUB, cx, e.y)
      break
    default:
      rc.draw(ICICLE, cx, e.y)
  }
})

/* ------------------------------------------------------------------ */
/* brush and its rail                                                  */
/* ------------------------------------------------------------------ */

// The rail is an entity of its own (z 0, behind Maxx), laid out by the simulation, so a long
// rail is drawn whole even while its brush is far along it, off screen.
registerRenderer('brush_rail', (g, e, rc) => {
  if (!metaRead) readMeta(rc)
  const v = e.vars
  if (v.x0 === undefined) return
  if (v.axis === 1) {
    if (v.h0 >= 0) tileDown(g, rc, ROD, v.x0, v.h0, v.y0, M.railTile)
    tileDown(g, rc, RAIL_V, v.x0, v.y0, v.y1, M.railTile)
    rc.draw(RAIL_STOP, v.x0, v.y0)
    rc.draw(RAIL_STOP, v.x0, v.y1)
    return
  }
  const y = v.y0
  // Rods up to a ceiling, or legs down to the floor.
  for (let end = 0; end < 2; end++) {
    const x = end ? v.x1 : v.x0
    const h = end ? v.h1 : v.h0
    if (h < 0) continue
    if (h < y) tileDown(g, rc, ROD, x, h, y - 3, M.railTile)
    else tileDown(g, rc, ROD, x, y + 3, h, M.railTile)
  }
  const top = Math.round(y) - 3
  for (let x = v.x0; x < v.x1; x += M.railTile) drawCols(g, rc, RAIL, x, top, 0, Math.min(M.railTile, v.x1 - x))
  rc.draw(RAIL_STOP, v.x0, y)
  rc.draw(RAIL_STOP, v.x1, y)
})

/** The rail runs this far above the brush's top (sim RAIL_GAP); the shaft fills the gap. */
const RAIL_GAP = 12

registerRenderer('brush', (g, e, rc) => {
  if (!metaRead) readMeta(rc)
  const cx = e.x + e.w / 2
  // The trolley on the rail, the shaft down to the brush, then the brush, spinning.
  const top = e.y
  tileDown(g, rc, ROD, cx, top - RAIL_GAP, top, M.railTile)
  rc.draw(CARRIAGE[(rc.tick >> 4) & 1], cx, top - RAIL_GAP)
  const f = (rc.tick >> 1) & 3
  const y0 = top + M.brushFrom
  const y1 = top + e.h - M.brushTo
  const n = Math.max(1, Math.ceil((y1 - y0) / M.tier))
  // Bottom tier first; the last one is moved up to end exactly on y1.
  for (let i = n - 1; i >= 0; i--) rc.draw((i & 1 ? TIER_B : TIER_A)[f], cx, Math.min(y0 + i * M.tier, y1 - M.tier))
  rc.draw(BRUSH_TOP, cx, top)
  rc.draw(BRUSH_BOT, cx, top + e.h)
})

/* ------------------------------------------------------------------ */
/* jet                                                                 */
/* ------------------------------------------------------------------ */

// While off, the box is the mouth alone, but the cold wax shows `full` px away: in a tall area
// the stain can be on screen while the nozzle is far off it.
const jetReach = (e: Entity): number => (e.vars.full ?? 0) + TILE

registerRenderer('jet', (g, e, rc) => {
  if (!metaRead) readMeta(rc)
  const v = e.vars
  const up = v.up === 1
  const mx = v.mx
  const my = v.my
  const full = v.full ?? 0
  // Cold wax where the column lands on the tiles, so the spot shows while it is off.
  if (!v.capped && full > 0) rc.draw(up ? STAIN_UP : STAIN, mx, up ? my - full : my + full)

  const len = e.state === 'on' ? (v.len ?? 0) : 0
  if (len > 0) {
    const f = (rc.tick / 3) & 3
    // It ends on something (a floor, a catwalk, a lift, a car roof) once it has reached it.
    const landed = v.end === 1 && len >= (v.stop ?? full)
    const body = landed ? len : Math.max(0, len - M.head)
    const tile = M.flowTile
    const name = (up ? FLOW_UP : FLOW)[f]
    const fr = rc.sprites.frame(name)
    if (fr) {
      const left = Math.round(mx) - (fr.ax ?? 0)
      for (let d = 0; d < body; d += tile) {
        const n = Math.min(tile, body - d)
        if (up) drawRows(g, rc, name, left, my - d - n, tile - n, n)
        else drawRows(g, rc, name, left, my + d, 0, n)
      }
    }
    if (landed) rc.draw((up ? WAX_SPLASH_UP : WAX_SPLASH)[((rc.tick / 3) | 0) % 3], mx, up ? my - len : my + len)
    else rc.draw((up ? HEAD_UP : HEAD)[f], mx, up ? my - body : my + body)
  } else if (e.state === 'sputter') {
    // The tell: it spits in time with the pops the simulation plays, every 8 ticks.
    const k = Math.min(2, Math.floor(((e.stateT - 1) % 8) / 3))
    rc.draw((up ? SPURT_UP : SPURT)[k], mx, my)
  }
  // The nozzle glows while it is about to fire or firing; in the sputter it flickers, then holds.
  const hot = e.state === 'on' || (e.state === 'sputter' && (e.stateT > 12 || (e.stateT >> 1) & 1))
  if (up) rc.draw(hot ? NOZZLE_UP_HOT : NOZZLE_UP, mx, my + M.nozzle)
  else rc.draw(hot ? NOZZLE_HOT : NOZZLE, mx, my - M.nozzle)
}, { margin: jetReach })

/* ------------------------------------------------------------------ */
/* blower                                                              */
/* ------------------------------------------------------------------ */

const FLIP = { flipX: true }
/** Lanes of air are this far apart up the zone. */
const LANE = 12
/** Air moves this many times faster than it pushes Maxx, so it reads as wind and not as drift. */
const AIR_SPEED = 2.6

/**
 * Streaks of air leaving the machine's mouth and running `reach` px downwind, cut off where
 * they leave it: one lane every LANE px up the zone, a streak every `gap` px or so along it.
 */
function airStreaks(g: CanvasRenderingContext2D, rc: RenderCtx, e: Entity, reach: number, speed: number, gap: number, short: boolean): void {
  const right = e.facing > 0
  const set = right ? GUST_R : GUST
  const mouth = Math.round(right ? e.x : e.x + e.w)
  const lo = right ? mouth : mouth - reach
  const hi = right ? mouth + reach : mouth
  const lanes = Math.max(1, Math.floor((e.h - 4) / LANE))
  for (let i = 0; i < lanes; i++) {
    // A fixed scatter per lane, so the lanes do not march in step.
    const hash = ((i * 73 + e.id * 31) % 97) / 97
    const name = set[short ? 2 : (i + e.id) % 3]
    const fr = rc.sprites.frame(name)
    if (!fr) continue
    const step = Math.round(gap * (0.75 + 0.5 * hash))
    const y = e.y + 5 + i * LANE + ((i * 5) % 5) - (fr.ay ?? 0)
    // How far the nearest streak's head has come from the mouth; the others follow every `step`.
    let travel = Math.floor((rc.tick * speed * (0.85 + 0.3 * hash) + hash * 613) % step)
    for (; travel < reach + fr.w; travel += step) {
      // Its left end: the head leads downwind.
      const left = right ? mouth + travel - fr.w : mouth - travel
      const from = Math.max(left, lo)
      const to = Math.min(left + fr.w, hi)
      if (to > from) drawCols(g, rc, name, from, y, from - left, to - from)
    }
  }
}

registerRenderer('blower', (g, e, rc) => {
  if (!metaRead) readMeta(rc)
  const force = Math.abs(e.vars.force ?? 0)
  const right = e.facing > 0
  if (e.state === 'blow' && force > 0) {
    // Stronger wind: faster air and more of it.
    const speed = Math.max(1.5, (force / 60) * AIR_SPEED)
    airStreaks(g, rc, e, e.w, speed, Math.max(56, Math.min(170, 10000 / force)), false)
  } else if (e.state === 'rev') {
    // The spin-up: short puffs that do not get far yet.
    airStreaks(g, rc, e, Math.min(e.w, 2 * TILE), 1.2, 44, true)
  }
  if (e.props.machine === false) return

  // The machine stands on the zone's floor line, in the tile just upwind of it.
  const unit = M.unit
  const cx = right ? e.x - unit / 2 : e.x + e.w + unit / 2
  const floor = e.y + e.h
  const units = Math.max(1, Math.round(e.h / unit))
  tileDown(g, rc, POST, cx + (right ? -7 : 7), floor - units * unit + 6, floor, 16)
  rc.draw(FOOT, cx + (right ? -7 : 7), floor)
  // The fan: flat out while it blows, winding up through the tell, still in the calm.
  const t = e.state === 'blow' ? rc.tick >> 1 : e.state === 'rev' ? (e.stateT > 10 ? e.stateT >> 1 : e.stateT >> 2) : 0
  const frame = BLOWER[t % 3]
  for (let k = 0; k < units; k++) rc.draw(frame, cx, floor - k * unit, right ? FLIP : undefined)
})
