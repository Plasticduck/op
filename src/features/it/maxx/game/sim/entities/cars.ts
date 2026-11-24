// Cars, the mud a pickup throws, and the spawner that feeds cars in.
//
//   car      variant: compact | sedan | suv | pickup | sports | van | monster
//            (numbers in TUNING.cars).  props: dir (1 = drives right; default
//            left), dirt, speed (0 parks it), bonus (true = does not count
//            toward SPOTLESS), clean (true = it starts washed: a ride, never
//            counted, no points), paint (which of the variant's colours, 0..3;
//            read by the renderer only).
//   clod     the pickup's mud ball. Spray it out of the air.
//   spawner  sends cars from where it stands, while it is within props.range
//            pixels of the screen.  props: variant or variants ('sedan,suv',
//            taken in turn; random: true picks at random), every (ticks between
//            cars, 240), max (dirty ones about at once, 3, at least 1; a washed car
//            driving off does not count), count (how many in all; 0 or missing =
//            endless, and those cars are bonus cars), dir, delay (ticks before
//            the first, 30). It waits while a car is still standing on its spot.
//
// SPOTLESS and retries: each counted car is credited once (creditCar), and the
// credit lives in world.flags, so a retry from a checkpoint keeps it. The cars
// themselves come back dirty on a retry; washing one again adds nothing. A
// counted car left behind dirty is never removed for being far off screen (it
// sleeps), so going back for it finds it; bonus and washed cars far behind
// are removed. A spawner's car carries vars.owner (the spawner's id), vars.from
// (its slot) and vars.n (0 for its first car, 1 for the next ...).
//
// FOR THE RENDERER (render/entities/cars.ts reads exactly this)
//
// A car's box is its variant's size from TUNING.cars and it faces e.facing
// (-1 = driving left). Dirt stage = ceil(3 * hp / maxHp): 3, 2, 1 while dirty,
// 0 clean.
//
//   state      'rev'     a sports car sits revving for TUNING.revTicks after it wakes
//                        (sfx 'rev' on its first tick, fx 'dust' as it sets off)
//              'drive'   dirty and harmful, driving
//              'windup'  a pickup has braked and is about to throw: CAR_FX.windupTicks
//                        long, the clod leaves on its last tick (sfx 'mudThrow')
//              'fling'   the follow-through, CAR_FX.flingTicks, still standing
//              'clean'   washed: harmless, faster, its top is ground along its roof line
//                        (CAR_TOPS, as e.ground: hood, roof and trunk at their drawn heights).
//                        stateT counts from the wash; the honk sounds at stateT = TUNING.honkDelay
//   vars       startle   ticks of fright left (CAR_FX.startleTicks, 0 = calm). Only the first drop
//                        after a dry spell of CAR_FX.calmTicks startles it: under a steady stream
//                        it is soaking, not startled
//              wet       ticks of water still running off (CAR_FX.wetTicks after each droplet), so
//                        CAR_FX.wetTicks - wet is the ticks since the last drop: under the spray
//                        while that is small
//              shed      ticks left of shaking off a stage of dirt (CAR_FX.shedTicks from when it let go)
//                        (the stage letting go sends sfx 'pop' and the variant's own dirt as fx)
//              greet     ticks left of looking up at Maxx after he first lands on its roof
//                        (CAR_FX.greetTicks), with a hello honk unless its wash honk was under 40 ticks ago
//              (speed, throwT, honk, greeted, owner, from, n are the behaviour's own)
//
// On the tick it comes clean a car sends fx 'sparkle' and 'shine' and sfx
// 'carClean'. A clod is 12 x 12 (z 1, in front); its facing is the way it
// flies. A spawner draws nothing ('idle' | 'send' | 'done').
import { TILE, VIEW_W } from '../../contract'
import type { SpawnSpec } from '../../contract'
import {
  addScore,
  banner,
  creditCar,
  damage,
  dxToPlayer,
  fx,
  hurtPlayer,
  isSpotless,
  kill,
  moveBody,
  playerCx,
  propBool,
  propNum,
  propStr,
  rand,
  registerEntity,
  rumble,
  setBox,
  setState,
  sfx,
  sfxEvery,
  shoot,
  spawn,
  tileInfoAt,
  turnAround,
} from '../api'
import { TUNING as T } from '../tuning'
import type { Entity, FxId, MoveOpts, World } from '../types'

/** Timing and places the picture shares with the rules. Ticks and pixels. */
export const CAR_FX = {
  startleTicks: 14,
  /** Dry this long, and the next drop startles it again. */
  calmTicks: 30,
  wetTicks: 48,
  shedTicks: 8,
  greetTicks: 40,
  windupTicks: 26,
  flingTicks: 12,
  /** A pickup's clod leaves from over its bed: this far behind the middle of the box ... */
  bedBack: 24,
  /** ... with its underside this far above the roof. */
  launchUp: 8,
} as const

/**
 * Each variant's roof line, read off its body art (every paint and the grimy bodies share one
 * silhouette): for each pixel column of the box, nose first as the art faces left, how far below
 * the box top the outline is. 'n*k' is n, k times. It is a washed car's standable top
 * (Entity.ground), so Maxx stands on the roof, the hood or the trunk and never on the air over
 * them. tests/cars.mjs checks it against the atlas: redrawn art that changes a silhouette fails
 * there until this follows.
 */
export const CAR_TOPS: Record<string, string> = {
  compact: '15 13 12 11 11 11 12 13 15 13 12 12 11 11 11 12 12 13 15 13 11 8 5 3 2 1 0*39 1 1 2 4 6 9 12',
  sedan: '15 13 12 11 11 11 12 13 15 13 12 12 11 11 11 12 12 13 15*4 13 11 8 6 4 2 1 0*33 1 1 2 3 5 7 8 10 12 14*14 15 16 17',
  suv: '20 18 17 16 16 16 17 18 20 19 18 17 16 16 16 17 18 19 21 22 20 17 15 12 9 7 5 4 3 3 3 1 0*55 1 3 4 5 6',
  pickup: '20 18 17 16 16 16 17 18 20 19 18 17 16 16 16 17 18 19 21 22 22 22 19 16 14 11 8 5 3 2 1 0*67 1 26',
  sports: '11 10 9 8 8 8 9 10 11 10 9 8*5 9 10 11 15 15 15 14*6 13*5 12*4 10 9 8 7 6 4 3 2 1 0*15 1 1 2 2 3 4 5 5 6 7 8 8 9 10 10 1 0*14 1',
  van: '24 22 21 20 20 20 21 22 24 23 22 21 20 20 20 19 16 12 9 5 3 2 1 0*74 1 2 3',
  monster: '39 38 23 14 12 11 10 9 9 9 10 11 12 14 12 11 10 10 9 9 9 10 10 11 12 14 16 16 15 13 11 10 8 6 4 3 2 1 0*73 1 3 6 9 12 15 19 37 38',
}

/** CAR_TOPS as one number per column. */
export function carTop(variant: string): number[] {
  const out: number[] = []
  for (const part of (CAR_TOPS[variant] ?? CAR_TOPS.compact).split(' ')) {
    const [n, k] = part.split('*')
    for (let i = 0, times = k === undefined ? 1 : Number(k); i < times; i++) out.push(Number(n))
  }
  return out
}

/** Entity.ground for each variant, built once: driving left (as drawn) and driving right (mirrored). */
const GROUND_LEFT: Record<string, readonly number[]> = {}
const GROUND_RIGHT: Record<string, readonly number[]> = {}
for (const v of Object.keys(CAR_TOPS)) {
  const cols = carTop(v)
  GROUND_LEFT[v] = Object.freeze(cols.slice())
  GROUND_RIGHT[v] = Object.freeze(cols.reverse())
}

/** Its roof line the way it faces now. Call whenever it may have turned round. */
function roofLine(e: Entity): void {
  e.ground = (e.facing > 0 ? GROUND_RIGHT : GROUND_LEFT)[e.variant] ?? null
}

/** What flies off each variant when a stage of dirt lets go: its own kind of dirt. */
const DIRT_FX: Record<string, FxId> = {
  compact: 'dust',
  sedan: 'mud',
  suv: 'leaf',
  pickup: 'mud',
  sports: 'debris',
  van: 'snow',
  monster: 'mud',
}

const dirtStage = (e: Entity): number => Math.ceil((3 * e.hp) / e.maxHp)

function makeClean(e: Entity): void {
  e.hp = 0
  e.harmful = false
  e.solid = 'top'
  setState(e, 'clean')
}

/** Wash a car on the spot: the prep gun does this at 0 dirt, Mighty Wax on touch. */
export function washCar(e: Entity, w: World): void {
  if (e.kind !== 'car' || e.state === 'clean') return
  const cx = e.x + e.w / 2
  makeClean(e)
  e.vars.honk = T.honkDelay
  e.vars.startle = 0
  e.vars.wet = CAR_FX.wetTicks

  w.chain++
  w.chainT = T.chainTicks
  addScore(w, T.chainScores[Math.min(w.chain, T.chainScores.length) - 1], cx, e.y - 10)
  sfx(w, 'carClean')
  fx(w, 'sparkle', cx, e.y + e.h / 2, 12)
  fx(w, 'shine', cx, e.y + e.h / 2, 1)
  fx(w, 'star', cx, e.y, 4)
  rumble(w, 0.25, 0.5, 140)

  // A car already counted on an earlier attempt (the level was retried from a checkpoint) is not counted again.
  if (e.props.bonus === true || !creditCar(e, w)) return
  if (isSpotless(w)) {
    banner(w, 'SPOTLESS!', 150)
    fx(w, 'confetti', cx, e.y, 20)
  }
}

/** The gap to the car carToward() found. */
let towardGap = 0

/** The nearest car within carGap the way `dir` points, on the same stretch of road, or null (awake ones: w.solids and w.actives). */
function carToward(e: Entity, w: World, dir: number): Entity | null {
  let best: Entity | null = null
  towardGap = T.carGap
  for (let pass = 0; pass < 2; pass++) {
    const list = pass === 0 ? w.solids : w.actives
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      if (o === e || o.kind !== 'car' || o.dead) continue
      if (o.y >= e.y + e.h || o.y + o.h <= e.y) continue
      const gap = dir > 0 ? o.x - (e.x + e.w) : e.x - (o.x + o.w)
      if (gap < towardGap && gap > -e.w / 2) {
        towardGap = gap
        best = o
      }
    }
  }
  return best
}

/**
 * The pickup's throw, told in three beats so it can be read and dodged: it brakes and
 * winds up ('windup'), the clod leaves on the last tick of that, and it stands a moment
 * longer ('fling'). One throw every TUNING.clodEvery ticks, wind-up included.
 */
function pickupThrow(e: Entity, w: World): void {
  const v = e.vars
  if (e.state === 'windup') {
    if (e.stateT < CAR_FX.windupTicks) return
    const x = e.x + e.w / 2 - e.facing * CAR_FX.bedBack
    const y = e.y - CAR_FX.launchUp
    // Aimed from where it leaves, to come down on Maxx about clodFlight seconds later.
    const reach = (playerCx(w) - x) * e.facing
    const speed = Math.max(T.clodMinSpeed, Math.min(T.clodMaxSpeed, reach / T.clodFlight))
    if (shoot(w, 'clod', x, y, e.facing * speed, -T.clodUp)) sfx(w, 'mudThrow')
    fx(w, 'mud', x, y, 4, e.facing)
    v.throwT = Math.max(1, T.clodEvery - CAR_FX.windupTicks)
    setState(e, 'fling')
    return
  }
  if (v.throwT > 0) v.throwT--
  if (e.state === 'fling') {
    if (e.stateT >= CAR_FX.flingTicks) setState(e, 'drive')
    return
  }
  if (v.throwT > 0 || !e.onGround) return
  const dx = dxToPlayer(e, w)
  if (Math.abs(dx) > T.clodRange || dx * e.facing <= 0) return
  setState(e, 'windup')
}

registerEntity('car', {
  countsAsCar: true,
  offscreen: 'removeBehind',
  // A counted car still dirty is never thrown away, parked or penned or driving off: it sleeps
  // where it is left, so going back for it finds it and SPOTLESS can still be had.
  keep: (e) => e.state !== 'clean' && e.props.bonus !== true,
  carCount: (spec: SpawnSpec) => (spec.props?.bonus === true || spec.props?.clean === true ? 0 : 1),
  init(e) {
    if (!T.cars[e.variant]) e.variant = 'compact'
    const spec = T.cars[e.variant]
    const v = e.vars
    setBox(e, spec.w, spec.h)
    e.hp = propNum(e, 'dirt', spec.dirt)
    e.maxHp = e.hp
    e.harmful = true
    e.state = e.variant === 'sports' ? 'rev' : 'drive'
    v.speed = propNum(e, 'speed', spec.speed)
    // The first clod leaves half a period after the truck wakes, wind-up included.
    v.throwT = Math.max(1, T.clodEvery / 2 - CAR_FX.windupTicks)
    v.honk = 0
    v.startle = 0
    v.wet = 0
    v.shed = 0
    v.greet = 0
    v.greeted = 0
    roofLine(e)
    if (propBool(e, 'clean', false)) {
      makeClean(e)
      // Long washed: nothing to bounce or honk about.
      e.stateT = 600
    }
  },
  update(e, w) {
    const v = e.vars
    if (v.startle > 0) v.startle--
    if (v.wet > 0) v.wet--
    if (v.shed > 0) v.shed--
    if (v.greet > 0) v.greet--

    if (e.state === 'rev') {
      if (e.stateT === 1) sfx(w, 'rev')
      if (e.stateT < T.revTicks) {
        e.vx = 0
        moveBody(e, w)
        return
      }
      setState(e, 'drive')
      fx(w, 'dust', e.x + e.w / 2 - e.facing * (e.w / 2 - 10), e.y + e.h, 5, -e.facing)
    }
    const clean = e.state === 'clean'
    const standing = e.state === 'windup' || e.state === 'fling'
    e.vx = standing ? 0 : e.facing * v.speed * (clean ? T.cleanSpeedUp : 1)
    moveBody(e, w)
    if (e.hitWall !== 0 && e.hitWall === e.facing) turnAround(e)

    // Meeting a car coming the other way, it turns round.
    const ahead = carToward(e, w, e.facing)
    if (ahead && ahead.facing !== e.facing) turnAround(e)
    // Never into another car, whatever moved it this tick (its own wheels or a belt carrying it
    // backwards): give back as much of the move as the gap is short.
    const moved = e.x - e.px
    if (moved !== 0 && carToward(e, w, moved > 0 ? 1 : -1)) e.x -= Math.sign(moved) * Math.min(T.carGap - towardGap, Math.abs(moved))
    roofLine(e)

    if (clean) {
      if (v.honk > 0 && --v.honk === 0) sfx(w, 'honk')
      // The first time Maxx steps onto its roof it looks up at him, and says thanks if its wash honk is long done.
      if (v.greeted === 0 && w.player.ridingId === e.id) {
        v.greeted = 1
        v.greet = CAR_FX.greetTicks
        if (v.honk === 0 && e.stateT > T.honkDelay + 40) sfx(w, 'honk')
      }
    } else if (e.variant === 'pickup') {
      pickupThrow(e, w)
    }

    if (tileInfoAt(w, Math.floor((e.x + e.w / 2) / TILE), Math.floor((e.y + e.h - 2) / TILE)).hazard === 'sludge') {
      kill(e)
      fx(w, 'mud', e.x + e.w / 2, e.y + e.h, 12)
      sfx(w, 'splat')
    }
  },
  onSpray(e, w, d) {
    // Water goes straight past a clean car, so it cannot shield the dirty one behind it.
    if (e.state === 'clean') return false
    const stage = dirtStage(e)
    const v = e.vars
    if (CAR_FX.wetTicks - v.wet >= CAR_FX.calmTicks) v.startle = CAR_FX.startleTicks
    v.wet = CAR_FX.wetTicks
    // No splash of our own: the world renderer already throws one where a drop dies on a car,
    // and a third on top of those buries the car's face, which is where the water lands.
    sfxEvery(w, 'sprayHit', 5)
    if (damage(e, d.power)) {
      washCar(e, w)
    } else if (dirtStage(e) < stage) {
      // A whole stage lets go at once, all along the body, with a pop the player hears as progress.
      const dirt = DIRT_FX[e.variant] ?? 'mud'
      const cy = e.y + e.h / 2
      v.shed = CAR_FX.shedTicks
      sfx(w, 'pop')
      fx(w, dirt, d.x, d.y, 4)
      fx(w, dirt, e.x + e.w * 0.3, cy, 2)
      fx(w, dirt, e.x + e.w * 0.7, cy, 2)
    }
    return true
  },
  onTouch(e, w) {
    if (e.state === 'clean') return true
    if (w.player.wax > 0) {
      washCar(e, w)
      return true
    }
    return false
  },
})

const CLOD_MOVE: MoveOpts = { solids: false, conveyor: false }

registerEntity('clod', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 12, 12)
    e.harmful = true
    e.gravity = T.clodGravity
    e.z = 1
  },
  update(e, w) {
    moveBody(e, w, CLOD_MOVE)
    if (!e.onGround && e.hitWall === 0 && !e.hitCeil) return
    kill(e)
    fx(w, 'mud', e.x + e.w / 2, e.y + e.h / 2, 5)
    sfxEvery(w, 'splat', 4)
  },
  onSpray(e, w) {
    kill(e)
    fx(w, 'splash', e.x + e.w / 2, e.y + e.h / 2, 4)
    sfxEvery(w, 'sprayHit', 5)
    return true
  },
  onTouch(e, w) {
    hurtPlayer(w, { fromX: e.x + e.w / 2 })
    kill(e)
    fx(w, 'mud', e.x + e.w / 2, e.y + e.h / 2, 5)
    return true
  },
})

/**
 * Dirty cars of this spawner still about. A washed one on its way out does not hold up the next,
 * and nor does a counted one asleep far off screen (kept for SPOTLESS, not about).
 */
function carsFrom(w: World, spawnerId: number): number {
  let n = 0
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (!o.dead && o.active && o.kind === 'car' && o.vars.owner === spawnerId && o.state !== 'clean') n++
  }
  return n
}

/** Is another car standing where a `variant` sent from (x, y) would appear? */
function spotTaken(w: World, variant: string, x: number, y: number): boolean {
  const size = T.cars[variant] ?? T.cars.compact
  const left = x - size.w / 2 - T.carGap
  const right = x + size.w / 2 + T.carGap
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (o.dead || o.kind !== 'car') continue
    if (o.x < right && o.x + o.w > left && o.y < y && o.y + o.h > y - size.h) return true
  }
  return false
}

/** A spawner's variants, split once per distinct prop text (vars hold numbers only), blanks dropped. */
const VARIANT_LISTS = new Map<string, string[]>()
function variantList(text: string): string[] {
  let list = VARIANT_LISTS.get(text)
  if (!list) {
    list = text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
    if (!list.length) list = ['compact']
    VARIANT_LISTS.set(text, list)
  }
  return list
}

function spawnerCount(props: SpawnSpec['props']): number {
  const count = props?.count
  return typeof count === 'number' && count > 0 ? Math.floor(count) : 0
}

registerEntity('spawner', {
  alwaysActive: true,
  carCount: (spec: SpawnSpec) => spawnerCount(spec.props),
  init(e) {
    setBox(e, 0, 0)
    e.gravity = 0
    e.collides = false
    e.vars.timer = Math.max(0, propNum(e, 'delay', 30))
    e.vars.sent = 0
  },
  update(e, w) {
    const v = e.vars
    const count = spawnerCount(e.props)
    if (count > 0 && v.sent >= count) {
      setState(e, 'done')
      return
    }
    const range = Math.min(propNum(e, 'range', T.spawnRange), T.sleepMargin - 16)
    if (e.x < w.camera.x - range || e.x > w.camera.x + VIEW_W + range) return
    if (v.timer > 0) {
      v.timer--
      return
    }
    // Full house: look again next tick. (max 0 would never send its counted cars and make SPOTLESS impossible.)
    if (carsFrom(w, e.id) >= Math.max(1, propNum(e, 'max', 3))) return

    const variants = variantList(propStr(e, 'variants', propStr(e, 'variant', e.variant || 'compact')))
    // The pick is kept until it is sent, so a car waiting for room does not reroll every tick.
    if (!(v.pick >= 0)) v.pick = propBool(e, 'random', false) ? Math.floor(rand(w) * variants.length) : v.sent % variants.length
    const variant = variants[v.pick % variants.length]
    // The last car has not cleared the spot (a queue backed up to here): wait, do not stack them.
    if (spotTaken(w, variant, e.x, e.y)) return
    const car = spawn(w, 'car', e.x, e.y, { variant, props: { dir: e.facing, bonus: count === 0 } })
    v.pick = -1
    if (!car) return
    car.vars.owner = e.id
    // Who it is, for creditCar: the spawner's place in the level and which of its cars this is.
    car.vars.from = e.slot
    car.vars.n = v.sent
    v.sent++
    v.timer = Math.max(1, propNum(e, 'every', 240))
    setState(e, 'send')
    e.stateT = 0
  },
})
