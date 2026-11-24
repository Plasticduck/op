// The game's own cars, put together from the 'cars' atlas (scripts/maxx/art-cars.mjs) the way
// the world draws them (render/entities/cars.ts, whose faces, bounce and layer drawing this
// uses), for the screens around the game: the title's lot, How To Play and the ending's parade
// show the very cars the player meets in a level. A filthy car wears its dull body, a car
// driving right its mirror-ready dirt, and squash and stretch add or take out whole rows and
// columns of pixels at the atlas's squash lines, never a fractional scale.
//
// Everything the layers need is read from the atlas's meta (variants, paints, wheels, faces)
// and turned into frame names once. A layer the atlas does not have is skipped, so a car
// still draws if the cars slice adds or drops one.
import type { Sprites } from '../../contract'
import { BOB_LIFT as GAME_BOB_LIFT, BOUNCE_LIFT as GAME_BOUNCE_LIFT, BOUNCE_ROWS, CAR_FACES, bendCar, carLayer } from '../../render/entities/cars'
import type { CarFace } from '../../render/entities/cars'

export { CAR_FACES }
export type { CarFace }

type G = CanvasRenderingContext2D

const FACE_AT = {} as Record<CarFace, number>
CAR_FACES.forEach((f, i) => (FACE_AT[f] = i))

/** The kinds, smallest to biggest. */
export const CAR_KINDS = ['compact', 'sedan', 'suv', 'pickup', 'sports', 'van', 'monster'] as const
export type CarKind = (typeof CAR_KINDS)[number]

interface VariantMeta {
  w: number
  h: number
  paints: string[]
  wheel: number
  wheelX: number[]
  squash?: { x: number; y: number }
  mirrorDirt?: boolean
}
interface CarsMeta {
  variants?: Record<string, VariantMeta>
  wheels?: Record<string, { frames: number; stride: number }>
  dullFrom?: number
}

export interface CarArt {
  w: number
  h: number
  paints: number
  body: string[]
  /** The body in each paint under road grime, worn from dirt stage `dullFrom`; '' where the atlas has none. */
  dull: string[]
  dullFrom: number
  /** By dirt stage; [0] is ''. */
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
  /** Squash lines, from the anchor: rows are added or dropped at cutY, columns at cutX. */
  cutX: number
  cutY: number
}

/** What one car looks like on one frame. */
export interface CarPose {
  /** 0 clean, 1..3 dirty (3 = filthy). */
  stage: number
  face: CarFace
  /** Paint index; wraps round the variant's paints. */
  paint: number
  /** Distance the car has rolled along the road: turns the wheels. */
  roll: number
  /** The art faces left; true for a car driving right. */
  flip: boolean
  /**
   * Squash and stretch, as whole rows of pixels added (+) or squeezed out (-) and columns likewise.
   * `sy` is the older way to say it (1 = none; 1 + rows / SQUASH_ROWS, as BOUNCE_SY holds): used
   * when rows and cols are both 0.
   */
  rows: number
  cols: number
  sy: number
  lift: number
  /** How far the wheels leave the road with it (a hop does, a springy step does not). */
  wheelLift: number
  /** Frame of water running off, -1 for none. */
  wet: number
  /** Frame of the glint sweeping a clean car, -1 for none. */
  glint: number
  /** The white flash of the moment it comes clean. */
  flash: boolean
}

export function pose(): CarPose {
  return { stage: 0, face: 'happy', paint: 0, roll: 0, flip: false, rows: 0, cols: 0, sy: 1, lift: 0, wheelLift: 0, wet: -1, glint: -1, flash: false }
}

/** A row of squash is this much `sy`. */
export const SQUASH_ROWS = 32
/** Columns that go with rows of squash (index rows + 3): squashed flat it spreads out, stretched tall it slims. */
const COLS_FOR_ROWS = [2, 2, 1, 0, 0, -1, -1]

/** The wash bounce, one entry a tick from the moment a car comes clean: the world's own numbers, as `sy` (see CarPose). */
export const BOUNCE_SY = BOUNCE_ROWS.map((r) => 1 + r / SQUASH_ROWS)
export const BOUNCE_LIFT = GAME_BOUNCE_LIFT
/** A washed car's springy step as it drives off. */
export const BOB_LIFT = GAME_BOB_LIFT

const arts = new Map<string, CarArt | null>()
let artsOf: Sprites | null = null

/** The layers of one kind of car, or null while the atlas is not there. */
export function carArt(sprites: Sprites, kind: string): CarArt | null {
  if (artsOf !== sprites) {
    arts.clear()
    artsOf = sprites
  }
  const known = arts.get(kind)
  if (known !== undefined) return known
  const meta = sprites.atlas('cars')?.meta as CarsMeta | undefined
  const m = meta?.variants?.[kind]
  // Not loaded yet: ask again next time rather than remember a miss.
  if (!m) return null
  const spin = meta?.wheels?.[String(m.wheel)] ?? { frames: 1, stride: 1 }
  const has = (n: string) => (sprites.has(n) ? n : '')
  const wheel = (k: string) => Array.from({ length: spin.frames }, (_, i) => has(`cars/wheel${m.wheel}${k}${i}`))
  const run = (prefix: string) => {
    const out: string[] = []
    for (let i = 0; sprites.has(`cars/${kind}_${prefix}${i}`); i++) out.push(`cars/${kind}_${prefix}${i}`)
    return out
  }
  const dirt = ['', has(`cars/${kind}_d1`), has(`cars/${kind}_d2`), has(`cars/${kind}_d3`)]
  const art: CarArt = {
    w: m.w,
    h: m.h,
    paints: Math.max(1, m.paints.length),
    body: m.paints.map((_, k) => has(`cars/${kind}_p${k}`)),
    dull: m.paints.map((_, k) => has(`cars/${kind}_dull${k}`)),
    dullFrom: meta?.dullFrom ?? 2,
    dirt,
    dirtRight: dirt.map((d, s) => (s > 0 && has(`cars/${kind}_d${s}m`)) || d),
    faces: CAR_FACES.map((f) => has(`cars/${kind}_${f}`)),
    glint: run('g'),
    wet: run('w'),
    flash: has(`cars/${kind}_flash`),
    wheelClean: wheel('c'),
    wheelDirty: wheel('d'),
    stride: spin.stride || 1,
    wheelX: m.wheelX,
    cutX: m.squash?.x ?? 0,
    cutY: m.squash?.y ?? -Math.round(m.h / 3),
  }
  arts.set(kind, art)
  return art
}

/** A face the variant has, or the nearest one it does (as the world does). */
function faceName(art: CarArt, face: CarFace): string {
  return art.faces[FACE_AT[face]] || art.faces[face === 'brr' ? FACE_AT.wide : face === 'bliss' ? FACE_AT.happy : FACE_AT.meh]
}

/** One car with the middle of its box on the road at (x, feet). False if its art is missing. */
export function drawCar(g: G, sprites: Sprites, kind: string, x: number, feet: number, p: CarPose): boolean {
  const art = carArt(sprites, kind)
  if (!art) return false
  let rows = Math.round(p.rows)
  let cols = Math.round(p.cols)
  if (rows === 0 && cols === 0 && p.sy !== 1) {
    rows = Math.max(-3, Math.min(3, Math.round((p.sy - 1) * SQUASH_ROWS)))
    cols = COLS_FOR_ROWS[rows + 3]
  }
  const right = bendCar(rows, cols, art.cutX, art.cutY)
  const left = cols - right
  const ax = Math.round(x)
  const ay = Math.round(feet)
  const stage = Math.max(0, Math.min(3, p.stage))
  const paint = ((p.paint % art.paints) + art.paints) % art.paints
  g.save()
  g.translate(ax, ay - Math.round(p.lift))
  if (p.flip) g.scale(-1, 1)
  carLayer(g, sprites, (stage >= art.dullFrom && art.dull[paint]) || art.body[paint])
  if (stage > 0) carLayer(g, sprites, (p.flip ? art.dirtRight : art.dirt)[stage])
  if (p.wet >= 0 && art.wet.length) carLayer(g, sprites, art.wet[p.wet % art.wet.length])
  if (p.glint >= 0 && p.glint < art.glint.length) carLayer(g, sprites, art.glint[p.glint])
  carLayer(g, sprites, faceName(art, p.face))
  if (p.flash) carLayer(g, sprites, art.flash)
  g.restore()
  bendCar(0, 0, 0, 0)
  // Wheels: never mirrored, at the mirrored place, turning with the road; a wheel on the tail
  // side of the column cut moves with the tail.
  const wheels = stage >= 2 ? art.wheelDirty : art.wheelClean
  const n = wheels.length
  const name = wheels[((Math.floor((p.flip ? p.roll : -p.roll) / art.stride) % n) + n) % n]
  const wy = ay - Math.round(p.wheelLift)
  for (let i = 0; i < art.wheelX.length; i++) {
    const wx = art.wheelX[i] + (art.wheelX[i] >= art.cutX ? right : -left)
    sprites.draw(g, name, ax + (p.flip ? -wx : wx), wy)
  }
  return true
}

/** Size of a kind's box, or a stand-in while the atlas is missing. */
export function carBox(sprites: Sprites, kind: string): { w: number; h: number } {
  return carArt(sprites, kind) ?? FALLBACK
}
const FALLBACK = { w: 80, h: 40 }

/** The dirt stage a car with `hp` of `max` dirt shows, as in the game. */
export function stageOf(hp: number, max: number): number {
  return hp <= 0 || max <= 0 ? 0 : Math.max(1, Math.min(3, Math.ceil((3 * hp) / max)))
}
