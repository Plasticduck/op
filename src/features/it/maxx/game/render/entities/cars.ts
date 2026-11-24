// Draws the cars of sim/entities/cars.ts, the pickup's mud clod, and the sports car's warning
// at the edge of the screen. Art: the 'cars' atlas (scripts/maxx/art-cars.mjs); its meta has
// the sizes, wheel places, squash lines and frame counts this file reads.
//
// A car is a stack of layers on one anchor, the middle of its box on the ground line: the body
// (under road grime while it is filthy, its own bright paint once it is nearly clean), the dirt
// of its stage, water running off, a glint, the face, the white flash of the wash, then the
// wheels. The art faces left; the stack is mirrored for a car facing right, except the wheels,
// which are drawn unmirrored at the mirrored place so they keep their light and turn with the
// road (frame from e.x). Squash and stretch add or take out whole rows and columns of pixels
// at the lines the atlas names, so the art never smears. What it shows comes from the entity:
//
//   paint   props.paint, else picked from e.slot (or the spawner's slot and count, else e.id),
//           so a level shows the same car in the same colour on every visit and every retry
//   face    clean: 'joy' while it bounces, 'honk' with its honk, 'up' while it greets Maxx on
//           its roof, else 'happy' with a laughing blink now and then. Dirty: 'angry' while a
//           sports car revs or a pickup winds up, 'yell' as the clod leaves, 'wide' when the
//           first water hits it or a stage of dirt lets go, then under the spray 'brr' (cold,
//           teeth chattering) while it is filthy and 'bliss' once it is nearly clean; left
//           alone, grump / sad / meh by dirt stage (3 / 2 / 1) with a slow, droopy blink
//   motion  the wash bounce (squash, hop, stretch, land, settle) over the first BOUNCE ticks of
//           'clean', then a springy step as it drives off; a filthy car sits low and chugs; a
//           startled one jumps; under the spray a dirty one shivers; a pickup crouches with a mud
//           ball rising out of its bed while it winds up; a revving sports car shudders and spins
//           its wheels; the monster truck rides up and down on its springs. Nothing moves the
//           roof while Maxx stands on it: his feet stay on the art.
//   extras  exhaust puffs, drips while wet, twinkles round a clean car (cosmetic, rc.fx), flies
//           round a filthy car that scatter when the water comes
import { VIEW_H, VIEW_W } from '../../contract'
import type { DrawOpts, Sprites } from '../../contract'
import { TUNING } from '../../sim'
import { CAR_FX } from '../../sim/entities/cars'
import type { Entity } from '../../sim/types'
import { registerRenderer } from '../registry'
import type { RenderCtx } from '../registry'

/** Every face the atlas draws for each variant; the first twelve are the original set (title screens use them by name). */
export const CAR_FACES = ['grump', 'sad', 'meh', 'shut', 'wide', 'scrunch', 'angry', 'yell', 'happy', 'joy', 'up', 'honk', 'bliss', 'brr'] as const
export type CarFace = (typeof CAR_FACES)[number]
const FACE_AT = {} as Record<CarFace, number>
CAR_FACES.forEach((f, i) => (FACE_AT[f] = i))

interface VariantMeta {
  w: number
  h: number
  paints: string[]
  wheel: number
  wheelX: number[]
  exhaust: { x: number; y: number }
  glint: number
  wet: number
  bed: { x: number; floor: number } | null
  squash?: { x: number; y: number }
}
interface CarsMeta {
  variants: Record<string, VariantMeta>
  wheels: Record<string, { frames: number; stride: number }>
  dullFrom?: number
}

interface CarArt {
  w: number
  h: number
  body: string[]
  /** The body in each paint under road grime; '' where the atlas has none. */
  dull: string[]
  /** By dirt stage; [0] is unused. */
  dirt: string[]
  /** The same for a car facing right: words in the dirt drawn back to front, so the mirrored layer reads. */
  dirtRight: string[]
  /** In the order of CAR_FACES. */
  faces: string[]
  glint: string[]
  wet: string[]
  flash: string
  wheelClean: string[]
  wheelDirty: string[]
  stride: number
  wheelX: number[]
  exX: number
  exY: number
  bed: { x: number; floor: number } | null
  /** Squash lines, from the anchor: rows are added or dropped at cutY, columns at cutX. */
  cutX: number
  cutY: number
  monster: boolean
}

let arts: Map<string, CarArt> | null = null
const NONE = new Map<string, CarArt>()
let dullFrom = 2
let clodFrames: string[] = []
let markFrames: string[] = []
let twinkleFrames: string[] = []
let flyFrames: string[] = []

/** Frame names, built once: nothing is put together while drawing. */
function load(rc: RenderCtx): Map<string, CarArt> {
  if (arts) return arts
  const atlas = rc.sprites.atlas('cars')
  const meta = atlas?.meta as unknown as CarsMeta | undefined
  // Not loaded yet: ask again next frame rather than remember an empty map.
  if (!meta?.variants) return NONE
  arts = new Map()
  dullFrom = meta.dullFrom ?? 2
  const has = (n: string): string => (rc.sprites.has(n) ? n : '')
  for (const [name, m] of Object.entries(meta.variants)) {
    const spin = meta.wheels[String(m.wheel)] ?? { frames: 1, stride: 1 }
    const wheel = (kind: string): string[] => Array.from({ length: spin.frames }, (_, i) => `cars/wheel${m.wheel}${kind}${i}`)
    arts.set(name, {
      w: m.w,
      h: m.h,
      body: m.paints.map((_, k) => `cars/${name}_p${k}`),
      dull: m.paints.map((_, k) => has(`cars/${name}_dull${k}`)),
      dirt: ['', `cars/${name}_d1`, `cars/${name}_d2`, `cars/${name}_d3`],
      dirtRight: ['', ...[1, 2, 3].map((s) => has(`cars/${name}_d${s}m`) || `cars/${name}_d${s}`)],
      faces: CAR_FACES.map((f) => has(`cars/${name}_${f}`)),
      glint: Array.from({ length: m.glint }, (_, i) => `cars/${name}_g${i}`),
      wet: Array.from({ length: m.wet }, (_, i) => `cars/${name}_w${i}`),
      flash: `cars/${name}_flash`,
      wheelClean: wheel('c'),
      wheelDirty: wheel('d'),
      stride: spin.stride,
      wheelX: m.wheelX,
      exX: m.exhaust.x,
      exY: m.exhaust.y,
      bed: m.bed,
      cutX: m.squash?.x ?? 0,
      cutY: m.squash?.y ?? -Math.round(m.h / 3),
      monster: name === 'monster',
    })
  }
  clodFrames = rc.sprites.anim('cars', 'clod')
  markFrames = rc.sprites.anim('cars', 'mark')
  twinkleFrames = rc.sprites.anim('cars', 'twinkle')
  flyFrames = rc.sprites.anim('cars', 'fly')
  return arts
}

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

// The wash bounce, one entry a tick of 'clean': rows added (+) or squeezed out (-), columns
// added or taken out, and how high the whole car is off the road. Squash under the flash, a hop
// that stretches it tall, a squashed landing (tick 14), a wobble, and still by the honk's end.
// Exported for the screens around the game (scenes/title/cars.ts), so their cars bounce the same.
export const BOUNCE_ROWS = [-3, -3, -2, -1, 2, 3, 3, 2, 1, 0, 0, 1, 1, 1, -3, -3, -2, -1, 1, 2, 1, 0, -1, 0]
export const BOUNCE_COLS = [2, 2, 2, 1, -1, -1, -2, -1, 0, 0, 0, 0, 0, 0, 2, 2, 2, 1, 0, -1, 0, 0, 0, 0]
export const BOUNCE_LIFT = [0, 0, 0, 0, 3, 6, 9, 11, 12, 12, 11, 9, 6, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
/** The spring in a washed car's step: a little hop of the body on its wheels, then a beat on the road. */
export const BOB_LIFT = [0, 1, 2, 3, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
export const BOB_ROWS = [0, 0, 1, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
const HONK_FACE_TICKS = 20
const FLASH_TICKS = 3
/** Water runs off it this long after the last drop (drips go on for all of CAR_FX.wetTicks). */
const WET_SHOW = 30
/** A drop within this many ticks means it is still under the spray. */
const SOAK_TICKS = 8
/** The first glint goes over as the flash fades, all through the hop; then one every GLINT_EVERY ticks. */
const GLINT_FROM = FLASH_TICKS
const GLINT_EVERY = 150
const BLINK_EVERY = 170
const DROOP_EVERY = 230
/** Twinkles round a clean car: where (share of the width from the middle, share of the height from the top). */
const TWINKLE_AT = [-0.36, 0.1, 0.12, -0.08, 0.42, 0.35, -0.12, 0.6, 0.3, 0.72, -0.44, 0.62, 0.05, 0.3]
const TWINKLE_STEPS = [0, 1, 2, 3, 2, 1, 0]

const FLIPPED: DrawOpts = { flipX: true }

/** Cosmetic puffs and drips are counted in slots of time per car, so a fast screen cannot double them and a slow one cannot skip them. */
const SLOTS = 256
const puffSlot = new Int32Array(SLOTS).fill(-1)
const dripSlot = new Int32Array(SLOTS).fill(-1)
function due(slots: Int32Array, e: Entity, tick: number, every: number): boolean {
  const k = e.id & (SLOTS - 1)
  const slot = Math.floor((tick + e.id * 13) / every)
  if (slots[k] === slot) return false
  const first = slots[k] < 0
  slots[k] = slot
  return !first
}

/** Which of its paints: the level's own choice, else the same pick for the same spawn every time. */
export function paintOf(e: Entity, n: number): number {
  if (n <= 1) return 0
  const p = e.props.paint
  if (typeof p === 'number' && Number.isFinite(p)) return ((Math.floor(p) % n) + n) % n
  const from = e.vars.from
  const key = e.slot >= 0 ? e.slot : from !== undefined && from >= 0 ? from * 31 + (e.vars.n ?? 0) + 7 : e.id
  return (Math.imul(key + 1, 0x9e3779b1) >>> 28) % n
}

export const dirtStage = (e: Entity): number => (e.state === 'clean' || e.maxHp <= 0 ? 0 : Math.max(0, Math.min(3, Math.ceil((3 * e.hp) / e.maxHp))))

/** Ticks since the last drop of water hit it (CAR_FX.wetTicks or more: none lately). */
const sinceWater = (e: Entity): number => CAR_FX.wetTicks - (e.vars.wet ?? 0)

/** The face it wears this frame (see the header). */
export function faceOf(e: Entity, tick: number): CarFace {
  const v = e.vars
  if (e.state === 'clean') {
    if (e.stateT < TUNING.honkDelay) return 'joy'
    if (e.stateT < TUNING.honkDelay + HONK_FACE_TICKS) return 'honk'
    const greet = v.greet ?? 0
    if (greet > 0) {
      // It honked hello if Maxx landed long after its wash (the rule is in sim/entities/cars.ts).
      const landedAt = e.stateT - (CAR_FX.greetTicks - greet)
      return greet > CAR_FX.greetTicks - 12 && landedAt > TUNING.honkDelay + 40 ? 'honk' : 'up'
    }
    return (tick + e.id * 37) % BLINK_EVERY < 7 ? 'joy' : 'happy'
  }
  if (e.state === 'rev' || e.state === 'windup') return 'angry'
  if (e.state === 'fling') return 'yell'
  const stage = dirtStage(e)
  if ((v.shed ?? 0) > 0 || (v.startle ?? 0) > 0) return 'wide'
  if (sinceWater(e) < SOAK_TICKS) return stage >= 2 ? 'brr' : 'bliss'
  if ((tick + e.id * 53) % DROOP_EVERY < 9) return 'shut'
  return stage >= 3 ? 'grump' : stage === 2 ? 'sad' : 'meh'
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

// How the body is bent this frame, set by drawCar before its layers go down.
let bendRows = 0
let bendCols = 0
let artCutX = 0
let artCutY = 0
/** How far the parts either side of the column cut move: the car widens or narrows about its middle. */
let leftDX = 0
let rightDX = 0

function bend(art: CarArt, rows: number, cols: number): void {
  bendCar(rows, cols, art.cutX, art.cutY)
}

/**
 * Set the bend for the layers drawn next (carLayer): `rows` added (+) or squeezed out (-) at the
 * row `cutY` from the anchor, `cols` likewise at the column `cutX` (the atlas meta's squash line
 * of the variant). Returns how far the parts right of the column cut move, for the wheels there;
 * those left of it move by cols - that. bendCar(0, 0, 0, 0) when done.
 */
export function bendCar(rows: number, cols: number, cutX: number, cutY: number): number {
  bendRows = rows
  bendCols = cols
  artCutX = cutX
  artCutY = cutY
  const half = Math.floor(cols / 2)
  leftDX = -half
  rightDX = cols - half
  return rightDX
}

function piece(g: CanvasRenderingContext2D, img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
  if (sw > 0 && sh > 0 && dw > 0 && dh > 0) g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

/**
 * One layer under the transform set up by drawCar, its anchor on the origin. With a bend, the
 * rows above the cut move up (rows added: the cut row is repeated into the gap) or down (rows
 * dropped from just above the cut), and the columns either side of the column cut move apart or
 * together the same way. Every layer cuts at the same lines, so they stay in register.
 */
function layer(g: CanvasRenderingContext2D, rc: RenderCtx, name: string): void {
  carLayer(g, rc.sprites, name)
}

/** One layer of a car with its anchor on the canvas's origin, bent as bendCar() last said. */
export function carLayer(g: CanvasRenderingContext2D, sprites: Sprites, name: string): void {
  if (!name) return
  const src = sprites.source(name)
  if (!src) return
  const f = src.frame
  const img = src.image
  const ax = f.ax ?? 0
  const ay = f.ay ?? 0
  if (bendRows === 0 && bendCols === 0) {
    g.drawImage(img, f.x, f.y, f.w, f.h, -ax, -ay, f.w, f.h)
    return
  }
  // The cuts in this frame's own rows and columns.
  const r = Math.max(0, Math.min(f.h, artCutY + ay))
  const c = Math.max(0, Math.min(f.w, artCutX + ax))
  const dropT = bendRows < 0 ? Math.min(-bendRows, r) : 0
  const dropL = bendCols < 0 ? Math.min(-bendCols, c) : 0
  const topH = r - dropT
  const leftW = c - dropL
  const yTop = (bendRows > 0 ? -bendRows : dropT) - ay
  const yBot = r - ay
  const xLeft = leftDX - ax
  const xRight = c + rightDX - ax
  // The four quarters.
  piece(g, img, f.x, f.y, leftW, topH, xLeft, yTop, leftW, topH)
  piece(g, img, f.x + c, f.y, f.w - c, topH, xRight, yTop, f.w - c, topH)
  piece(g, img, f.x, f.y + r, leftW, f.h - r, xLeft, yBot, leftW, f.h - r)
  piece(g, img, f.x + c, f.y + r, f.w - c, f.h - r, xRight, yBot, f.w - c, f.h - r)
  // Rows added: the cut row, repeated into the gap.
  if (bendRows > 0 && r > 0 && r < f.h) {
    piece(g, img, f.x, f.y + r, leftW, 1, xLeft, yBot - bendRows, leftW, bendRows)
    piece(g, img, f.x + c, f.y + r, f.w - c, 1, xRight, yBot - bendRows, f.w - c, bendRows)
  }
  // Columns added: the cut column, repeated into the gap (and the corner where both gaps meet).
  if (bendCols > 0 && c > 0 && c < f.w) {
    const xGap = c + leftDX - ax
    piece(g, img, f.x + c, f.y, 1, topH, xGap, yTop, bendCols, topH)
    piece(g, img, f.x + c, f.y + r, 1, f.h - r, xGap, yBot, bendCols, f.h - r)
    if (bendRows > 0 && r > 0 && r < f.h) piece(g, img, f.x + c, f.y + r, 1, 1, xGap, yBot - bendRows, bendCols, bendRows)
  }
}

function drawCar(g: CanvasRenderingContext2D, e: Entity, rc: RenderCtx): void {
  const art = load(rc).get(e.variant)
  if (!art) {
    g.fillStyle = e.state === 'clean' ? '#5cc8ff' : '#8a5f33'
    g.fillRect(rc.sx(e.x), rc.sy(e.y), e.w, e.h)
    return
  }
  const v = e.vars
  const tick = rc.tick
  const clean = e.state === 'clean'
  const ridden = rc.world.player.ridingId === e.id
  const stage = dirtStage(e)
  const left = e.facing < 0
  const ax = e.x + e.w / 2
  const ay = e.y + e.h
  const moving = e.onGround && Math.abs(e.vx) > 1
  const since = sinceWater(e)

  // How the body moves this frame: rows added or squeezed out, columns likewise, lift off the
  // road, the wheels' lift, and a sideways nudge (toward the tail is +).
  let rows = 0
  let cols = 0
  let lift = 0
  let wheelLift = 0
  let nudge = 0
  if (clean) {
    const t = e.stateT
    if (t < BOUNCE_ROWS.length) {
      rows = BOUNCE_ROWS[t]
      cols = BOUNCE_COLS[t]
      lift = wheelLift = BOUNCE_LIFT[t]
    } else if (moving) {
      const k = (t + e.id * 7) % BOB_LIFT.length
      lift = BOB_LIFT[k]
      rows = BOB_ROWS[k]
    } else if ((tick + e.id * 17) % 96 < 8) {
      // Parked and pleased with itself: a little bounce now and then.
      rows = 1
    }
  } else if (e.state === 'windup') {
    const p = Math.min(1, e.stateT / CAR_FX.windupTicks)
    rows = -Math.round(3 * p)
    cols = p > 0.5 ? 1 : 0
    if (p > 0.55) nudge = (tick >> 1) & 1 ? 1 : -1
  } else if (e.state === 'fling') {
    if (e.stateT < 5) {
      rows = 2
      cols = -1
      nudge = -2
    }
  } else if (e.state === 'rev') {
    // Crouched like a sprinter on the line, shuddering.
    rows = -1
    lift = (tick >> 1) & 1
    nudge = (tick >> 2) & 1
  } else {
    // A filthy car sits low under its load.
    if (stage >= 3) rows = -1
    const startle = v.startle ?? 0
    if (startle > CAR_FX.startleTicks - 5) {
      // The first cold drop: it jumps.
      lift = wheelLift = 2
      rows = 1
    } else if ((v.shed ?? 0) > 0) {
      nudge = (tick >> 1) & 1 ? 1 : -1
      rows = 1
    } else if (since < SOAK_TICKS && stage >= 2) {
      // Shivering under the cold water.
      nudge = (tick >> 1) & 1 ? 1 : -1
    } else if (!art.monster && moving) {
      // A dirty car chugs along.
      lift = Math.floor(Math.abs(e.x) / 9) & 1
    }
  }
  // The monster truck's body rides its springs over the wheels.
  if (art.monster && !ridden && wheelLift === 0 && e.state !== 'windup') lift += Math.round(Math.sin(e.x * 0.09 + e.id) * 2)
  if (ridden) {
    rows = 0
    cols = 0
    lift = 0
    wheelLift = 0
    nudge = 0
  }
  bend(art, rows, cols)

  g.save()
  g.translate(rc.sx(ax) + (left ? nudge : -nudge), rc.sy(ay) - lift)
  if (!left) g.scale(-1, 1)
  const paint = paintOf(e, art.body.length)
  const dull = stage >= dullFrom ? art.dull[paint] : ''
  layer(g, rc, dull || art.body[paint])
  if (stage > 0) layer(g, rc, (left ? art.dirt : art.dirtRight)[stage])
  // Water runs off a dirty car; a washed one comes out of its flash gleaming (it only drips).
  if (!clean && since < WET_SHOW) layer(g, rc, art.wet[Math.floor(tick / 3) % art.wet.length])
  if (clean) {
    const gt = e.stateT - GLINT_FROM
    const gi = gt >= 0 ? (gt % GLINT_EVERY) >> 1 : art.glint.length
    if (gi < art.glint.length) layer(g, rc, art.glint[gi])
  }
  const face = faceOf(e, tick)
  layer(g, rc, art.faces[FACE_AT[face]] || art.faces[face === 'brr' ? FACE_AT.wide : face === 'bliss' ? FACE_AT.happy : FACE_AT.meh])
  if (clean && e.stateT < FLASH_TICKS) layer(g, rc, art.flash)
  // The mud ball the pickup is about to throw, coming up out of its bed.
  if (e.state === 'windup' && art.bed && clodFrames.length) {
    const p = Math.min(1, e.stateT / CAR_FX.windupTicks)
    const top = -art.h - CAR_FX.launchUp - 6
    // The bed is above the squash row, so it rides up and down with the top of the body.
    const y = Math.round(art.bed.floor + (top - art.bed.floor) * p * p) - bendRows
    const src = rc.sprites.source(clodFrames[(e.stateT >> 2) % clodFrames.length])
    if (src) {
      const f = src.frame
      g.drawImage(src.image, f.x, f.y, f.w, f.h, CAR_FX.bedBack + rightDX - (f.ax ?? 0), y - (f.ay ?? 0), f.w, f.h)
    }
  }
  g.restore()

  // Wheels: unmirrored, at the mirrored place, turning with the road. A revving sports car
  // spins them on the spot.
  const wheels = stage >= 2 ? art.wheelDirty : art.wheelClean
  const n = wheels.length
  const roll = e.state === 'rev' ? Math.floor(e.x / art.stride) + (left ? -(tick >> 1) : tick >> 1) : Math.floor(e.x / art.stride)
  const frame = wheels[((roll % n) + n) % n]
  for (let i = 0; i < art.wheelX.length; i++) {
    const wx = art.wheelX[i]
    // A wheel on the tail side of the column cut moves with the tail.
    const shift = wx >= art.cutX ? rightDX : leftDX
    rc.draw(frame, ax + (left ? wx + shift : -(wx + shift)), ay - wheelLift)
  }
  bend(art, 0, 0)

  // Cosmetic particles.
  const exX = ax + (left ? art.exX : -art.exX)
  const exY = ay + art.exY - lift
  const puffEvery = e.state === 'rev' ? 5 : e.state === 'windup' ? 7 : clean ? 110 : 60
  if (due(puffSlot, e, tick, puffEvery)) rc.fx('smoke', exX, exY, 1, left ? 1 : -1)
  if ((v.wet ?? 0) > 0 && due(dripSlot, e, tick, 5)) {
    const across = ((tick * 37 + e.id * 11) % 100) / 100 - 0.5
    rc.fx('drip', ax + across * (art.w - 16), ay - 6 - lift, 1)
  }
  if (clean && twinkleFrames.length) drawTwinkles(e, rc, art, ax, ay - lift)
  // Flies keep to a filthy car until the water comes.
  if (stage >= 3 && since >= CAR_FX.wetTicks && flyFrames.length) drawFlies(e, rc, art, ax, ay - lift)
  if (e.variant === 'sports' && !clean && e.active) drawWarning(e, rc)
}

/** Twinkles: a shower of them for a while after the wash, then one now and then. */
function drawTwinkles(e: Entity, rc: RenderCtx, art: CarArt, ax: number, ay: number): void {
  const t = e.stateT
  const n = TWINKLE_AT.length / 2
  const cycle = TWINKLE_STEPS.length * 2
  const count = t < 100 ? 3 : (rc.tick + e.id * 29) % 90 < cycle ? 1 : 0
  for (let k = 0; k < count; k++) {
    const local = t < 100 ? t + k * 5 : (rc.tick + e.id * 29) % 90
    const step = Math.floor(local / 2) % TWINKLE_STEPS.length
    const which = (Math.floor(local / cycle) * 3 + k * 2 + e.id) % n
    const x = ax + TWINKLE_AT[which * 2] * art.w * (e.facing < 0 ? 1 : -1)
    const y = ay - art.h + TWINKLE_AT[which * 2 + 1] * art.h
    rc.draw(twinkleFrames[TWINKLE_STEPS[step] % twinkleFrames.length], x, y)
  }
}

/** Two flies looping over the front half of the car, out of step with each other. */
function drawFlies(e: Entity, rc: RenderCtx, art: CarArt, ax: number, ay: number): void {
  const front = e.facing < 0 ? -1 : 1
  const cx = ax + front * art.w * 0.2
  const cy = ay - art.h - 5
  const rx = Math.max(10, art.w * 0.22)
  for (let k = 0; k < 2; k++) {
    // A lazy loop with a buzzing zigzag on it, so they read as flies and not as specks.
    const a = rc.tick * (k ? 0.11 : 0.087) + k * 2.6 + e.id
    const zig = (((rc.tick + k * 5) >> 2) % 3) - 1
    const x = cx + Math.cos(a) * rx + zig
    const y = cy + Math.sin(a * 2) * 5 - k * 4 - zig
    rc.draw(flyFrames[((rc.tick >> 1) + k) % flyFrames.length], x, y)
  }
}

/** A fast car that is still off screen: a flashing sign on the edge it will come in from. */
function drawWarning(e: Entity, rc: RenderCtx): void {
  if (!markFrames.length) return
  const sl = rc.sx(e.x)
  const fromRight = sl >= VIEW_W && e.facing < 0
  const fromLeft = sl + e.w <= 0 && e.facing > 0
  if (!fromRight && !fromLeft) return
  const y = Math.max(18, Math.min(VIEW_H - 18, rc.sy(e.y + e.h / 2)))
  // It nudges toward the edge and back, and flashes yellow and red.
  const x = fromRight ? VIEW_W - 19 + ((rc.tick >> 3) & 1) : 19 - ((rc.tick >> 3) & 1)
  rc.draw(markFrames[Math.floor(rc.tick / 5) % markFrames.length], rc.camX + x, rc.camY + y, fromLeft ? FLIPPED : undefined)
}

registerRenderer('car', drawCar)

registerRenderer('clod', (_g, e, rc) => {
  load(rc)
  if (!clodFrames.length) return
  const n = clodFrames.length
  const turn = (rc.tick >> 2) % n
  rc.draw(clodFrames[e.vx < 0 ? (n - turn) % n : turn], e.x + e.w / 2, e.y + e.h / 2)
})

// The spawner is invisible (its box shows in debug).
registerRenderer('spawner', () => {})
