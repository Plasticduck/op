// Draws MUDSLINGER and the pieces of its fight (sim/entities/mudslinger.ts, the states and vars
// are in its header) from the 'mudslinger' atlas (scripts/maxx/art-mudslinger.mjs).
//
// The truck is a stack of layers on one anchor, the middle of its box on the ground line,
// mirrored together when it faces right: the two tyres, the body (by dirt stage), the bed (by
// stage and how far it is tipped), the face, the light bar, then the extras of the moment.
// Which face goes with which state is the table in pose(). Its eyes follow Maxx: when he is behind
// it, an open-eyed face is swapped for the one glancing back over its shoulder. Being sprayed
// squeezes its eyes shut except while it revs or charges, so the tell of a charge is never hidden.
import type { DrawOpts } from '../../contract'
import type { Entity } from '../../sim/types'
import { registerRenderer } from '../registry'
import type { RenderCtx } from '../registry'

const BW = 136
const FLIP: DrawOpts = { flipX: true }

// Geometry the generator wrote into atlas.meta; these are its values, used until the atlas is read.
let wheels: number[] = [36, 106]
let wheelR = 18
let stepPx = 4.71
let metaRead = false
const SPOT = {
  beam: [3, 25],
  honk: [0, 43],
  vein: [34, 9],
  sweat: [3, 11],
  stack: [84, 0],
  tail: [138, 50],
}

const names = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `mudslinger/${prefix}${i}`)
const BODY = names('body', 4)
const BED = [0, 1, 2, 3].map((s) => names(`bed${s}_`, 4))
const WHEEL_MUD = names('wheelm', 6)
const WHEEL_CLEAN = names('wheelc', 6)
const BAR = names('bar', 4)
const CLOD = names('clod', 4)
const SLAB = names('slab', 2)
const MARK = names('mark', 5)
const MARK_WIDE = names('markw', 5)
const DROP = names('drop', 2)
const RAGE_HOP = [0, 3, 5, 6, 5, 3, 0, 0, 0, 0, 0, 0]
const PUDDLE = names('puddle', 2)
const DRY = 'mudslinger/puddleDry'
const HONK = names('honk', 2)
const SWEAT = names('sweat', 2)
const DASH = names('dash', 3)
const BEAM = names('beam', 2)
const VEIN = 'mudslinger/vein'
const DOOR_HEAD = 'mudslinger/doorHead'
const DOOR_SLAT = 'mudslinger/doorSlat'
const DOOR_FOOT = 'mudslinger/doorFoot'

const F = {
  smug: 'mudslinger/face_smug',
  glee: 'mudslinger/face_glee',
  angry: 'mudslinger/face_angry',
  glare: 'mudslinger/face_glare',
  yell: 'mudslinger/face_yell',
  dizzy: 'mudslinger/face_dizzy',
  pant: 'mudslinger/face_pant',
  pant2: 'mudslinger/face_pant2',
  squeeze: 'mudslinger/face_squeeze',
  joy: 'mudslinger/face_joy',
  happy: 'mudslinger/face_happy',
  blink: 'mudslinger/face_blink',
  toot: 'mudslinger/face_toot',
}
/** The same face glancing back toward its tail, for the faces with open eyes. */
const BACK = new Map<string, string>([F.smug, F.glee, F.angry, F.glare, F.yell, F.pant, F.pant2, F.happy].map((f): [string, string] => [f, `${f}_b`]))

/** What one frame of the truck shows. Filled in place by pose(), never reallocated. */
const look = {
  face: F.smug,
  tip: 0,
  bar: 0,
  dy: 0,
  hop: 0,
  spin: -1,
  honk: -1,
  beam: -1,
  dash: -1,
  sweat: -1,
  vein: false,
}

function readMeta(rc: RenderCtx): void {
  metaRead = true
  const meta = rc.sprites.atlas('mudslinger')?.meta
  if (!meta) return
  if (Array.isArray(meta.wheels)) wheels = meta.wheels as number[]
  if (typeof meta.wheelR === 'number') wheelR = meta.wheelR
  if (typeof meta.wheelStepPx === 'number') stepPx = meta.wheelStepPx
  const spots = meta.spots as Record<string, number[]> | undefined
  if (spots) {
    for (const k of Object.keys(SPOT) as (keyof typeof SPOT)[]) if (Array.isArray(spots[k])) SPOT[k] = spots[k]
  }
}

function stage(e: Entity): number {
  return e.hp <= 0 ? 0 : Math.ceil((3 * e.hp) / e.maxHp)
}

/** The state of the fight, as a face, a bed, a bob, and the extras. */
function pose(e: Entity, tick: number): void {
  const t = e.stateT
  const v = e.vars
  const dur = v.dur > 0 ? v.dur : 1
  const angry = v.phase === 1
  look.face = angry ? F.angry : F.smug
  look.tip = 0
  look.bar = 0
  look.dy = 0
  look.hop = 0
  look.spin = -1
  look.honk = -1
  look.beam = -1
  look.dash = -1
  look.sweat = -1
  look.vein = angry
  let flinch = true
  switch (e.state) {
    case 'wait':
      // Idling: the engine rocks it on its springs.
      look.dy = (tick >> 4) & 1
      look.face = tick % 180 < 6 ? F.blink : F.smug
      flinch = false
      break
    case 'intro':
      if (t < 56) {
        look.face = F.glee
        look.dy = (t >> 1) & 1
        look.spin = tick
      } else if (t < 84) {
        look.face = F.toot
        look.honk = (t >> 3) & 1
      } else {
        look.face = F.smug
        look.dy = (tick >> 3) & 1
      }
      break
    case 'turn':
      look.hop = Math.round(Math.sin((Math.PI * Math.min(t, 20)) / 20) * 9)
      look.spin = tick
      break
    case 'tip':
      look.face = F.glee
      look.tip = Math.min(3, 1 + Math.floor((t * 3) / dur))
      look.dy = (t >> 2) & 1
      break
    case 'fling':
      look.face = F.glee
      look.tip = 3
      look.dy = v.kick < 4 ? 2 : 0
      break
    case 'settle':
      look.tip = Math.max(0, 3 - Math.floor(t / 6))
      break
    case 'rev': {
      // The long tell: lamps on the roof count it down, the headlights flash faster each third.
      const lamps = v.lamps
      look.bar = lamps
      const flash = lamps >= 3 ? (t >> 2) & 1 : lamps === 2 ? (t >> 3) & 1 : 0
      look.face = flash ? F.glare : F.angry
      look.beam = flash ? (t >> 2) & 1 : -1
      look.dy = (t >> 1) & 1
      look.spin = tick * 2
      flinch = false
      break
    }
    case 'charge':
      look.face = F.yell
      look.bar = (t >> 2) & 1 ? 3 : 0
      look.dy = (t >> 1) & 1
      look.dash = (t >> 2) % 3
      flinch = false
      break
    case 'bonk':
      look.face = F.dizzy
      look.dy = t < 5 ? 3 : 1
      break
    case 'spent':
      // Panting: the second breath lets its tongue out further, a bead of sweat runs down.
      look.face = Math.floor(t / 18) % 2 ? F.pant2 : F.pant
      look.dy = Math.floor(t / 18) % 2
      look.sweat = t % 36 < 18 ? 0 : 1
      if (v.wet > 0) look.face = (tick >> 2) & 1 ? F.squeeze : F.pant
      flinch = false
      break
    case 'recover':
      look.face = t < 10 ? F.squeeze : F.angry
      look.dy = (t >> 1) & 1
      break
    case 'rage':
      look.face = (t >> 3) & 1 ? F.yell : F.angry
      look.bar = (t >> 2) & 1 ? 3 : 0
      // Stamping on its springs in a tantrum.
      look.hop = RAGE_HOP[t % RAGE_HOP.length]
      look.dy = t & 1
      look.vein = true
      flinch = false
      break
    case 'clean':
      look.vein = false
      look.hop = t < 18 ? Math.round(Math.sin((Math.PI * t) / 18) * 8) : 0
      if ((t >= 40 && t < 54) || (t >= 64 && t < 78)) {
        look.face = F.toot
        look.honk = (t >> 2) & 1
      } else look.face = t < 40 ? F.joy : F.happy
      flinch = false
      break
    case 'happy':
      look.vein = false
      look.face = tick % 200 < 7 ? F.blink : F.happy
      flinch = false
      break
  }
  if (flinch && v.wet > 0) {
    look.face = F.squeeze
    look.dy = (tick >> 1) & 1
  }
}

/** Box x (as drawn facing left) to world x for the way it faces. */
function boxX(e: Entity, bx: number): number {
  return e.facing > 0 ? e.x + BW - bx : e.x + bx
}

registerRenderer('mudslinger', (_g, e, rc) => {
  if (!metaRead) readMeta(rc)
  pose(e, rc.tick)
  const s = stage(e)
  const flip = e.facing > 0 ? FLIP : undefined
  const ground = e.y + e.h
  const cx = e.x + e.w / 2
  const lift = look.hop
  const y = ground + look.dy - lift
  // It keeps an eye on Maxx: behind it, it glances back over its shoulder.
  const p = rc.world.player
  const behind = (p.x + p.w / 2 - cx) * e.facing < -e.w / 4
  const face = behind ? (BACK.get(look.face) ?? look.face) : look.face

  // Tyres: turning with the road under them, or spinning in place while it revs.
  const wheelSet = s > 0 ? WHEEL_MUD : WHEEL_CLEAN
  const roll = look.spin >= 0 ? look.spin : Math.floor((e.x * e.facing) / stepPx)
  const wf = wheelSet[((roll % 6) + 6) % 6]
  for (let i = 0; i < wheels.length; i++) rc.draw(wf, boxX(e, wheels[i]), ground - wheelR - lift, flip)

  rc.draw(BODY[s], cx, y, flip)
  rc.draw(BED[s][look.tip], cx, y, flip)
  rc.draw(face, cx, y, flip)
  rc.draw(BAR[look.bar], cx, y, flip)

  const top = e.y + look.dy - lift
  if (look.vein && s > 0) rc.draw(VEIN, boxX(e, SPOT.vein[0]), top + SPOT.vein[1] + ((rc.tick >> 3) & 1), flip)
  if (look.sweat >= 0) rc.draw(SWEAT[look.sweat], boxX(e, SPOT.sweat[0]), top + SPOT.sweat[1] + ((e.stateT % 18) >> 2), flip)
  if (look.honk >= 0) rc.draw(HONK[look.honk], boxX(e, SPOT.honk[0]), top + SPOT.honk[1], flip)
  if (look.beam >= 0) rc.draw(BEAM[look.beam], boxX(e, SPOT.beam[0]), top + SPOT.beam[1], flip)
  if (look.dash >= 0) rc.draw(DASH[look.dash], boxX(e, SPOT.tail[0]), top + SPOT.tail[1], flip)
}, {
  // Smoke out of the stack while it revs, charges or throws its tantrum: once a tick, so a fast screen cannot double it nor a slow one skip it.
  tick(e, rc) {
    const st = e.state
    if (!(st === 'rev' || st === 'charge' || st === 'rage' || (st === 'intro' && e.stateT < 56)) || rc.tick % 7 !== 0) return
    pose(e, rc.tick)
    rc.fx('smoke', boxX(e, SPOT.stack[0]), e.y + look.dy - look.hop + SPOT.stack[1], 1, e.facing > 0 ? -1 : 1)
  },
})

registerRenderer('ms_clod', (_g, e, rc) => {
  const flip = e.vx < 0 ? FLIP : undefined
  if (e.vars.slop) rc.draw(SLAB[((rc.tick >> 3) + e.id) & 1], e.x + e.w / 2, e.y + e.h / 2, flip)
  else rc.draw(CLOD[((rc.tick >> 2) + e.id) & 3], e.x + e.w / 2, e.y + e.h / 2, flip)
})

registerRenderer('ms_mark', (_g, e, rc) => {
  const left = e.vars.t
  const dur = e.vars.dur > 0 ? e.vars.dur : 1
  // Grows as the clod comes; its ring blinks yellow for the last 24 ticks.
  let f = Math.min(3, Math.floor(((dur - left) * 4) / dur))
  if (left <= 24 && (left >> 2) & 1) f = 4
  const x = e.x + e.w / 2
  const bob = DROP[(rc.tick >> 3) & 1]
  if (e.w > 40) {
    // The slop's: one long shadow, a chevron at each end.
    rc.draw(MARK_WIDE[f], x, e.y + e.h)
    rc.draw(bob, x - 24, e.y + e.h - 14)
    rc.draw(bob, x + 24, e.y + e.h - 14)
    return
  }
  rc.draw(MARK[f], x, e.y + e.h)
  rc.draw(bob, x, e.y + e.h - 14)
})

registerRenderer('ms_puddle', (_g, e, rc) => {
  const frame = e.state === 'dry' ? DRY : PUDDLE[((rc.tick >> 4) + e.id) & 1]
  rc.draw(frame, e.x + e.w / 2, e.y + e.h)
})

registerRenderer('ms_door', (_g, e, rc) => {
  // The curtain drops over vars.slam ticks and rolls back up over 24.
  const k = e.state === 'open' ? Math.max(0, 1 - e.stateT / 24) : Math.min(1, e.stateT / (e.vars.slam > 0 ? e.vars.slam : 8))
  const len = Math.round(e.h * k)
  const x = e.x + e.w / 2
  for (let y = 0; y < len - 8; y += 8) rc.draw(DOOR_SLAT, x, e.y + y)
  if (len >= 8) rc.draw(DOOR_FOOT, x, e.y + len)
  rc.draw(DOOR_HEAD, x, e.y - 2)
})
