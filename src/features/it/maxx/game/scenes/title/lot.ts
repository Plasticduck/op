// The living picture behind the title: Maxx running in place along a Mighty Wash lot that
// scrolls past in layers, bubbles drifting up, and now and then a dirty car coming the
// other way that he sprays clean before it rolls past him shining.
//
// Everything here is cosmetic and pre-allocated: pools of droplets, splashes and bubbles,
// one car at a time. The scenery is the 'title' atlas (scripts/maxx/art-title.mjs), the
// cars are the game's own ('cars' atlas, through ./cars), and Maxx is Maxx.
import { VIEW_H, VIEW_W } from '../../contract'
import type { Sprites } from '../../contract'
import { PAL } from '../../engine/ui'
import { BOB_LIFT, BOUNCE_LIFT, BOUNCE_SY, carBox, drawCar, pose, stageOf } from './cars'
import type { CarKind } from './cars'
import { noise } from './kit'

type G = CanvasRenderingContext2D

/** Pixels a tick the front sidewalk (and so Maxx) moves. The run cycle steps every 7 px. */
const SPEED = 3
const RUN_STRIDE = 7
/** Layer speeds as a share of SPEED: far hills, clouds, buildings, the lane, the front walk. */
const FAR_K = 0.12
const CLOUD_K = 0.05
const MID_K = 0.5
const LANE_K = 0.8

const HORIZON = 252
const BACK_WALK = 285
const LANE_TOP = 294
const LANE_FEET = 314
const FRONT_TOP = 316
/** Maxx's feet. */
export const MAXX_X = 176
export const MAXX_FEET = 330
const MUZZLE_X = MAXX_X + 30
const MUZZLE_Y = MAXX_FEET - 30
/** How far ahead of the nozzle a dirty car has to be before he opens up on it. */
const RANGE = 210

/** The cars that come up the lane, in turn (each in a paint of its own), and how much washing and how much hurry each has. */
const LINEUP: readonly CarKind[] = ['compact', 'sedan', 'van', 'suv', 'pickup', 'sports', 'sedan', 'compact', 'monster']
// Indices into each kind's paints in the cars atlas: blue, yellow, blue, teal, yellow, orange, teal, green, green.
const PAINTS = [1, 1, 0, 3, 1, 2, 2, 2, 1]
const DIRT: Record<CarKind, number> = { compact: 12, sedan: 16, suv: 18, pickup: 18, sports: 10, van: 20, monster: 24 }
const HURRY: Record<CarKind, number> = { compact: 0.6, sedan: 0.6, suv: 0.6, pickup: 0.55, sports: 1.6, van: 0.5, monster: 0.35 }
const STARTLE_TICKS = 14
const SHED_TICKS = 8
const WET_TICKS = 48

const MID_LOOP = 1100
// [frame, x in the loop]. wash, vacs: bottom-left anchors; the rest bottom-centre.
const MID_NAMES = ['title/wash', 'title/pole', 'title/vacs', 'title/cone', 'title/bush', 'title/pylon', 'title/pole', 'title/bush', 'title/cone', 'title/bush']
const MID_X = [0, 372, 404, 588, 626, 686, 772, 846, 884, 1010]
const FAR_W = 640
// Turbines on the mesa tops: x in the far strip, top of the mesa in the strip.
const TURBINE_X = [66, 112, 372, 426, 556]
const TURBINE_TOP = [26, 26, 34, 34, 24]
const ROTOR = ['title/rotor0', 'title/rotor1', 'title/rotor2']
const SPARK = ['title/spark0', 'title/spark1', 'title/spark2', 'title/spark3', 'title/spark2', 'title/spark1']
const BUBBLE = ['title/bubble0', 'title/bubble1', 'title/bubble2']
const SPLASH = ['title/splash0', 'title/splash1', 'title/splash2']
const CLOUD_LOOP = 960
const CLOUD_NAMES = ['title/cloud0', 'title/cloud1', 'title/cloud2', 'title/cloud1']
const CLOUD_X = [40, 360, 640, 820]
const CLOUD_Y = [150, 176, 158, 140]

interface Drop {
  on: boolean
  x: number
  y: number
  vx: number
  vy: number
  life: number
}
interface Splash {
  on: boolean
  x: number
  y: number
  t: number
}
interface Bubble {
  on: boolean
  x: number
  y: number
  vy: number
  size: number
  phase: number
}
interface Car {
  on: boolean
  kind: CarKind
  paint: number
  x: number
  hp: number
  maxHp: number
  cleanT: number
  roll: number
  startle: number
  shed: number
  wet: number
}

export interface Lot {
  /** Ticks since it started. */
  readonly t: number
  /** True while Maxx has the gun up (a car is being washed). */
  readonly spraying: boolean
  /** The car on the lot: its dirt stage 0..3, or -1 for no car. */
  readonly carStage: number
  update(): void
  draw(g: G, sprites: Sprites): void
}

function wrap(v: number, m: number): number {
  return ((v % m) + m) % m
}

export function createLot(): Lot {
  const rnd = noise(1989)
  const drops: Drop[] = []
  for (let i = 0; i < 40; i++) drops.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 })
  const splashes: Splash[] = []
  for (let i = 0; i < 10; i++) splashes.push({ on: false, x: 0, y: 0, t: 0 })
  const bubbles: Bubble[] = []
  for (let i = 0; i < 28; i++) bubbles.push({ on: false, x: 0, y: 0, vy: 0, size: 0, phase: 0 })
  const car: Car = { on: false, kind: 'compact', paint: 0, x: 0, hp: 0, maxHp: 1, cleanT: 0, roll: 0, startle: 0, shed: 0, wet: 0 }
  const look = pose()
  // The car's box, from the atlas: known once the sprites are in.
  let carW = 80
  let carH = 40

  let t = 0
  let dist = 0
  let nextCar = 100
  let carsSent = 0
  let sprayHold = 0
  let spraying = false
  let run: string[] = []
  let sprayRun: string[] = []
  let sized: Sprites | null = null

  function bubble(x: number, y: number, size: number): void {
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i]
      if (b.on) continue
      b.on = true
      b.x = x
      b.y = y
      b.size = size
      b.vy = 0.35 + rnd() * 0.45 + (2 - size) * 0.15
      b.phase = rnd() * 6.28
      return
    }
  }

  function splash(x: number, y: number): void {
    for (let i = 0; i < splashes.length; i++) {
      const s = splashes[i]
      if (s.on) continue
      s.on = true
      s.x = x
      s.y = y
      s.t = 0
      return
    }
  }

  function hit(): void {
    const before = stageOf(car.hp, car.maxHp)
    car.hp--
    car.startle = STARTLE_TICKS
    car.wet = WET_TICKS
    if (car.hp > 0 && stageOf(car.hp, car.maxHp) < before) car.shed = SHED_TICKS
    if (car.hp <= 0) {
      car.hp = 0
      car.cleanT = 0
      for (let k = 0; k < 6; k++) bubble(car.x - carW / 2 + rnd() * carW, LANE_FEET - rnd() * carH, k % 3 === 0 ? 2 : 1)
    }
  }

  function update(): void {
    t++
    dist += SPEED

    // Air full of suds, always.
    if (t % 16 === 0) bubble(8 + rnd() * (VIEW_W - 16), VIEW_H + 8, rnd() < 0.55 ? 0 : rnd() < 0.75 ? 1 : 2)

    if (!car.on && --nextCar <= 0) {
      car.on = true
      car.kind = LINEUP[carsSent % LINEUP.length]
      car.paint = PAINTS[carsSent % LINEUP.length]
      carsSent++
      car.maxHp = car.hp = DIRT[car.kind]
      car.cleanT = car.roll = car.startle = car.shed = car.wet = 0
      if (sized) {
        const box = carBox(sized, car.kind)
        carW = box.w
        carH = box.h
      }
      car.x = VIEW_W + carW / 2 + 8
    }

    let wantSpray = false
    if (car.on) {
      const clean = car.hp <= 0
      const v = LANE_K * SPEED + (clean ? 2.4 : HURRY[car.kind])
      car.x -= v
      car.roll += v - LANE_K * SPEED
      if (clean) car.cleanT++
      if (car.startle > 0) car.startle--
      if (car.shed > 0) car.shed--
      if (car.wet > 0) car.wet--
      const front = car.x - carW / 2
      if (!clean && front - MUZZLE_X < RANGE && front > MUZZLE_X - 30) wantSpray = true
      // He never lets one past him dirty: the last drops finish it.
      if (!clean && front < MUZZLE_X + 4) hit()
      if (car.x < -carW) {
        car.on = false
        nextCar = 110 + Math.floor(rnd() * 120)
      }
    }
    if (wantSpray) sprayHold = 12
    else if (sprayHold > 0) sprayHold--
    spraying = sprayHold > 0

    if (spraying && t % 2 === 0) {
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i]
        if (d.on) continue
        d.on = true
        d.x = MUZZLE_X
        d.y = MUZZLE_Y + Math.round((rnd() - 0.5) * 2)
        d.vx = 7.2 + rnd() * 0.8
        d.vy = (rnd() - 0.6) * 0.5
        d.life = 24
        break
      }
    }

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]
      if (!d.on) continue
      d.x += d.vx
      d.y += d.vy
      d.vy += 0.05
      if (--d.life <= 0 || d.x > VIEW_W + 4) {
        d.on = false
        continue
      }
      if (car.on && car.hp > 0 && d.x >= car.x - carW / 2 + 3 && d.x <= car.x + carW / 2 && d.y >= LANE_FEET - carH + 4 && d.y <= LANE_FEET - 4) {
        d.on = false
        splash(d.x, d.y)
        hit()
        if (car.hp % 4 === 0) bubble(d.x, d.y - 4, car.hp % 8 === 0 ? 1 : 0)
      }
    }
    for (let i = 0; i < splashes.length; i++) {
      const s = splashes[i]
      if (s.on && ++s.t >= 9) s.on = false
    }
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i]
      if (!b.on) continue
      b.y -= b.vy
      b.x -= 0.15
      if (b.y < -12) b.on = false
    }
  }

  function drawGround(g: G): void {
    // The back walk the buildings stand on.
    g.fillStyle = PAL.grey[5]
    g.fillRect(0, BACK_WALK - 1, VIEW_W, LANE_TOP - BACK_WALK + 1)
    g.fillStyle = PAL.white
    g.fillRect(0, BACK_WALK - 1, VIEW_W, 2)
    g.fillStyle = PAL.grey[4]
    g.fillRect(0, LANE_TOP - 1, VIEW_W, 1)
    const midOff = wrap(Math.round(dist * MID_K), 32)
    for (let x = -midOff; x < VIEW_W; x += 32) g.fillRect(x, BACK_WALK + 1, 1, LANE_TOP - BACK_WALK - 2)

    // The lane the cars use.
    g.fillStyle = PAL.grey[2]
    g.fillRect(0, LANE_TOP, VIEW_W, FRONT_TOP - LANE_TOP)
    g.fillStyle = PAL.grey[1]
    g.fillRect(0, LANE_TOP, VIEW_W, 1)
    const laneOff = wrap(Math.round(dist * LANE_K), 64)
    for (let x = -laneOff; x < VIEW_W; x += 64) {
      g.fillStyle = PAL.yellow[1]
      g.fillRect(x + 6, LANE_TOP + 9, 30, 2)
      g.fillStyle = PAL.yellow[0]
      g.fillRect(x + 6, LANE_TOP + 11, 30, 1)
      g.fillStyle = PAL.grey[3]
      g.fillRect(x + 48, LANE_TOP + 4, 2, 1)
      g.fillRect(x + 20, LANE_TOP + 16, 2, 1)
    }

    // The front walk Maxx runs on.
    g.fillStyle = PAL.grey[5]
    g.fillRect(0, FRONT_TOP, VIEW_W, VIEW_H - FRONT_TOP)
    g.fillStyle = PAL.white
    g.fillRect(0, FRONT_TOP, VIEW_W, 2)
    g.fillStyle = PAL.grey[3]
    g.fillRect(0, FRONT_TOP + 2, VIEW_W, 1)
    const frontOff = wrap(dist, 48)
    g.fillStyle = PAL.grey[4]
    for (let x = -frontOff; x < VIEW_W; x += 48) {
      g.fillRect(x, FRONT_TOP + 3, 1, VIEW_H - FRONT_TOP - 3)
      g.fillRect(x + 17, FRONT_TOP + 22, 3, 1)
      g.fillRect(x + 33, FRONT_TOP + 35, 2, 1)
    }
  }

  function drawTheCar(g: G, sprites: Sprites): void {
    const clean = car.hp <= 0
    const c = car.cleanT
    look.stage = stageOf(car.hp, car.maxHp)
    look.paint = car.paint
    look.roll = car.roll
    look.flip = false
    look.sy = 1
    look.lift = 0
    look.wheelLift = 0
    look.wet = car.wet > 0 ? Math.floor(t / 3) : -1
    look.glint = -1
    look.flash = clean && c < 3
    if (clean) {
      if (c < BOUNCE_SY.length) {
        look.sy = BOUNCE_SY[c]
        look.lift = look.wheelLift = BOUNCE_LIFT[c]
      } else {
        look.lift = BOB_LIFT[c % BOB_LIFT.length]
      }
      if (c >= 3) look.glint = (c - 3) >> 1
      look.face = c < 16 ? 'joy' : c < 40 ? 'honk' : (t + 40) % 170 < 7 ? 'joy' : 'happy'
    } else {
      // A dirty car chugs along.
      look.lift = Math.floor(car.roll / 9) & 1
      look.face = car.shed > 0 ? 'scrunch' : car.startle > 0 ? 'wide' : look.stage >= 3 ? 'grump' : look.stage === 2 ? 'sad' : 'meh'
    }
    drawCar(g, sprites, car.kind, car.x, LANE_FEET, look)
    // A shower of sparkles round it once it is washed.
    if (clean && c < 70) {
      const lift = look.lift
      for (let k = 0; k < 4; k++) {
        const f = (c + k * 5) % 24
        if (f >= 18) continue
        const sx = Math.round(car.x - carW / 2 + ((k * 37 + 11) % carW))
        const sy = LANE_FEET - ((k * 23 + 9) % carH) - lift
        sprites.draw(g, SPARK[f >> 2], sx, sy)
      }
    }
  }

  function draw(g: G, sprites: Sprites): void {
    if (!run.length) {
      run = sprites.anim('maxx', 'run')
      sprayRun = sprites.anim('maxx', 'sprayRun')
    }
    if (sized !== sprites) {
      sized = sprites
      const box = carBox(sprites, car.kind)
      carW = box.w
      carH = box.h
    }

    // Sky: flat bands, a haze above the horizon.
    g.fillStyle = PAL.blue[3]
    g.fillRect(0, 0, VIEW_W, 196)
    g.fillStyle = PAL.blue[4]
    g.fillRect(0, 196, VIEW_W, HORIZON - 196)
    g.fillStyle = PAL.ice[0]
    g.fillRect(0, 224, VIEW_W, HORIZON - 224)

    const cloudOff = dist * CLOUD_K + t * 0.12
    for (let i = 0; i < CLOUD_NAMES.length; i++) sprites.draw(g, CLOUD_NAMES[i], Math.round(wrap(CLOUD_X[i] - cloudOff, CLOUD_LOOP)) - 140, CLOUD_Y[i])

    // Far hills and the wind farm.
    const farOff = wrap(Math.round(dist * FAR_K), FAR_W)
    sprites.draw(g, 'title/far', -farOff, HORIZON)
    sprites.draw(g, 'title/far', FAR_W - farOff, HORIZON)
    const rotor = ROTOR[(t >> 3) % 3]
    for (let i = 0; i < TURBINE_X.length; i++) {
      const foot = HORIZON - 64 + TURBINE_TOP[i] + 1
      for (let k = 0; k < 2; k++) {
        const sx = wrap(TURBINE_X[i] - farOff, FAR_W) - k * FAR_W
        if (sx < -30 || sx > VIEW_W + 30) continue
        sprites.draw(g, 'title/mast', sx, foot)
        sprites.draw(g, rotor, sx - 1, foot - 40)
      }
    }

    // Red dirt and dry grass between the hills and the lot.
    g.fillStyle = PAL.wood[6]
    g.fillRect(0, HORIZON, VIEW_W, BACK_WALK - HORIZON)
    g.fillStyle = PAL.wood[7]
    g.fillRect(0, HORIZON, VIEW_W, 1)
    const fieldOff = wrap(Math.round(dist * 0.3), 80)
    g.fillStyle = PAL.wood[4]
    for (let x = -fieldOff; x < VIEW_W; x += 80) {
      g.fillRect(x + 10, HORIZON + 6, 6, 1)
      g.fillRect(x + 44, HORIZON + 14, 8, 1)
      g.fillRect(x + 66, HORIZON + 24, 5, 1)
      g.fillRect(x + 28, HORIZON + 28, 7, 1)
    }

    // The wash, its vacuums and signs.
    const midOff = dist * MID_K
    for (let i = 0; i < MID_NAMES.length; i++) {
      const sx = Math.round(wrap(MID_X[i] - midOff, MID_LOOP)) - 360
      if (sx > VIEW_W + 360) continue
      sprites.draw(g, MID_NAMES[i], sx, BACK_WALK)
    }

    drawGround(g)
    if (car.on) drawTheCar(g, sprites)

    // Maxx, and his shadow.
    g.fillStyle = PAL.grey[4]
    g.fillRect(MAXX_X - 13, MAXX_FEET - 1, 26, 3)
    g.fillRect(MAXX_X - 16, MAXX_FEET, 32, 1)
    const anim = spraying && sprayRun.length ? sprayRun : run
    if (anim.length) sprites.draw(g, anim[Math.floor(dist / RUN_STRIDE) % anim.length], MAXX_X, MAXX_FEET)

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]
      if (!d.on) continue
      const x = Math.round(d.x)
      const y = Math.round(d.y)
      g.fillStyle = PAL.blue[3]
      g.fillRect(x - 4, y, 3, 2)
      g.fillStyle = PAL.white
      g.fillRect(x - 1, y - 1, 2, 2)
    }
    for (let i = 0; i < splashes.length; i++) {
      const s = splashes[i]
      if (s.on) sprites.draw(g, SPLASH[Math.min(2, Math.floor(s.t / 3))], Math.round(s.x), Math.round(s.y))
    }
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i]
      if (b.on) sprites.draw(g, BUBBLE[b.size], Math.round(b.x + Math.sin(b.phase + b.y / 18) * 3), Math.round(b.y))
    }
  }

  return {
    get t() {
      return t
    },
    get spraying() {
      return spraying
    },
    get carStage() {
      return car.on ? stageOf(car.hp, car.maxHp) : -1
    },
    update,
    draw,
  }
}
