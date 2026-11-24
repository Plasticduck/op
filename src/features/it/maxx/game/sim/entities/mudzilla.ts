// MUDZILLA, the final boss (end of level 8, The Mega Tunnel), and what it throws.
//
// A monster truck so filthy it has become a monster: 200 x 150, 150 dirt. It is washed,
// not killed: three phases (from 100%, 66% and 33% dirt), each a cleaner body and a faster,
// longer pattern, and at 0 it shrinks back into a happy little truck and the level completes.
//
// FOR LEVEL DESIGNERS
//
//   mudzilla   Put its character on the floor row, anywhere in the right-hand third of its
//              arena. It finds the arena itself: the first solid tile to its right on that
//              row is the right wall's face, and the arena floor is the `arena` tiles (22)
//              left of it. It parks itself 12 px off the right wall and sleeps until Maxx's
//              middle is 80 px inside the floor's left edge. Then, on that tick: a steel shutter
//              (mz_shutter) drops into a doorway in the column left of the floor if there is
//              one, the versus card goes up, the boss song starts, the clock is topped up and it
//              wakes. For the wake (2 s) the camera holds the whole truck with Maxx at the left
//              edge; then it is locked to the floor plus one wall column each side and follows him.
//              props: arena (floor tiles between the walls, 22), dirt (150),
//                     music ('boss'; '' leaves the song alone),
//                     clock (seconds the level clock is topped up to when the fight starts,
//                     300; 0 leaves it alone).
//              The arena it was tuned and tested in is levels/dev/mudzilla.ts: build that.
//              When the last dirt goes it plays its finish (about 6.3 s, the clock stopped),
//              then sets flag 'mudzilla' to 1, frees the camera and completes the level
//              (completeLevel 'goal': the clear jingle). A world that starts with the flag set
//              has no Mudzilla.
//
// THE FIGHT (ticks; three numbers are phase 1 / 2 / 3)
//
//   It sits at one end of the arena ("home": 12 px off the wall) facing the other. It makes a
//   run of attacks, then is winded (tongue out, 160 / 140 / 125 ticks): that is when to wash
//   it. A drop of water takes 0.12 dirt off while it is winded and 0.03 at any other time
//   (turbo water counts TUNING.turboBossPower, 1.5, as on every boss). At 100 and 50 dirt it
//   roars (thunder, a long shake):
//   the water does nothing for that moment, the body turns cleaner, and the next phase starts
//   its pattern from the top. A line crossed mid-attack waits for the attack to finish.
//   Runs, in turn:  1: stomp+rain, blobs+spin, hop.   2: stomp+rain+spin, blobs+hop+stomp.
//                   3: spin+stomp+rain, blobs+hop+stomp, rain+spin+hop.
//   (A stomp's waves are still rolling when the next attack starts: never the tyre spray next.)
//
//   stomp   rears up on its back wheels (50 / 42 / 36; later ones of a set 34 / 34 / 28); the
//           last 14 ticks of every rear-up are the hitch (it jerks higher, mouth wide open, a
//           rev): then it slams. A wave 30 x 20 bursts out from under each tyre, forward from
//           the front one and back from the rear one, leaving at 30% of its speed and reaching
//           240 / 270 / 300 px/s over 24 ticks, to the wall: hop it, or be on a catwalk.
//           1 / 2 / 3 slams.
//   rain    revs (44 / 38 / 32) and flings mud up. Each clod has a mark on the floor from
//           the moment it is flung, and lands on it 104 / 94 / 84 ticks later, falling
//           through catwalks (never through a block). Clods are 112 / 96 / 84 px apart, the
//           first volley has one aimed at Maxx; 1 / 2 / 3 volleys 46 / 46 / 40 ticks apart,
//           each shifted sideways. Water knocks a clod out of the air.
//   blobs   shakes (44 / 38 / 32) and tosses 2 / 3 / 3 globs, one at where Maxx stands
//           (catwalks included), each with a mark where it will land. When he is up on a
//           catwalk the others land well clear of it, so their arcs never come down across it.
//           A glob that lands becomes a 'blob' (critters) walking at Maxx. With 4 of its blobs
//           (or globs) already about it throws just the one; a blob that walks back into it,
//           out of the arena, or into the tyre spray is gone.
//   spin    drops its nose and smokes its tyres (56 / 54 / 50) while orange chevrons mark the
//           floor 320 / 360 / 380 px ahead of it; then that stretch, 30 px high, is a spray of
//           mud for 44 / 52 / 60 ticks. Catwalks are above it, so is a full jump with the
//           hover, and the far end of the floor is out of reach (no start needs the hover).
//   hop     crouches (46 / 40 / 36), then crosses to the other end in 2 / 2 / 3 hops of
//           84 / 76 / 70 ticks, 150 / 150 / 140 px high at the top, with a shadow where each
//           will land: run under it while it is up. Catwalks are in its way: get down.
//
//   Touching it costs a pip at any time until it is washed. Nothing here grimes Maxx outright.
//   The fight's song is set with setBossMusic, so Mighty Wax running out mid-fight hands back to it.
//
// FOR THE RENDERER (render/entities/mudzilla.ts). All anchored at the feet: (e.x + e.w / 2, e.y + e.h).
//
//   mudzilla  box 200 x 150 (124 x 76 once it has shrunk), z 0, e.facing is the way it looks.
//     states  'sleep' | 'wake' (MZ.wake ticks; it roars from MZ.wakeRoar; stateT 0 is the
//             picture on the versus card) | 'idle'
//             | 'stompTell' (its last MZ.hitch ticks are the hitch) | 'stomp' (it hits the
//             floor on stateT MZ.slam)
//             | 'rainTell' | 'rain' | 'blobTell' | 'blobs' | 'spinTell' | 'spin'
//             | 'hopTell' | 'hop' | 'hopLand' | 'winded' | 'recover'
//             | 'roar' (MZ.roar ticks; the body changes on stateT MZ.roarStage)
//             | 'washed' (the finish: see MZ.fin for its beats).
//     vars    phase 1..3 (body: caked, streaky, nearly clean); size 0..4 (the finish: how
//             far it has shrunk); pitch (px the front axle is lifted; negative = nose down);
//             sink (px the body sits low on its springs; negative = stretched); spin (px
//             the tyres have turned); hitT (ticks since water last hit it); side (1 = it is
//             at, or came from, the right end); floor (y of the floor line); ax0, ax1 (the
//             arena's left edge and the right wall's face); n (slams, volleys or hops done
//             in this attack); tx (where the hop in progress lands, box x).
//   mz_mark   a shadow on the ground where something will land. Box (vars.w) x 6 on the
//             surface (vars.floor), z 0. stateT counts up to vars.life (impact). vars.kind 0
//             clod (vars.top: where the clod starts falling), 1 glob, 2 Mudzilla itself.
//   mz_clod   22 x 22 falling mud, z 1. vars.floor is where it bursts.
//   mz_glob   20 x 20 grime in flight, z 1. stateT / vars.life is how far along its arc.
//   mz_wave   30 x 20 on the floor, z 1, e.facing is the way it runs; stateT its age.
//   mz_fan    the tyre spray: its box is the stretch of floor, z 1. 'warn' (harmless, the
//             tell; vars.warn ticks) then 'on' (vars.on ticks). e.facing is the way the mud
//             flies; the truck's end of the box is where it starts.
//   mz_shutter 32 x (doorway height), solid, z 0, 'shut' for good; stateT counts from the drop.
import { DT, TILE, VIEW_W } from '../../contract'
import type { MusicId } from '../../contract'
import {
  addScore,
  areaWidth,
  banner,
  clearBoss,
  completeLevel,
  fx,
  getFlag,
  hurtPlayer,
  kill,
  lockCamera,
  music,
  overlaps,
  playerCx,
  propNum,
  propStr,
  registerEntity,
  rumble,
  setBoss,
  setBossMusic,
  setBox,
  setFlag,
  sfx,
  sfxEvery,
  shake,
  solidAt,
  spawn,
  tileAt,
  unlockCamera,
  versus,
} from '../api'
import type { Entity, World } from '../types'

/** Every number of the fight. Arrays of three are phase 1, 2, 3. Times in ticks, speeds px/s. */
export const MZ = {
  name: 'MUDZILLA',
  tagline: 'DIRTIEST TRUCK IN WEST TEXAS',
  flag: 'mudzilla',
  w: 200,
  h: 150,
  dirt: 150,
  arenaTiles: 22,
  /** Room left between it and the wall (or the arena's open edge) when it is at home. */
  wallGap: 12,
  /** How far inside the arena's left edge Maxx's middle has to be for the fight to start. */
  trigger: 80,
  clock: 300,
  score: 5000,
  washWinded: 0.12,
  washChip: 0.03,
  wake: 120,
  wakeRoar: 40,
  /** For the wake the camera is held where it shows the whole truck (and Maxx at the left edge); then it follows him. */
  wakeCamMargin: 12,
  roar: 100,
  roarStage: 34,
  idle: [50, 36, 26],
  winded: [160, 140, 125],
  recover: [36, 30, 24],

  stompTell: [50, 42, 36],
  stompAgain: [34, 34, 28],
  stomps: [1, 2, 3],
  /** The tick of 'stomp' on which the front wheels hit the floor. */
  slam: 5,
  stompGap: 8,
  stompRest: [30, 24, 20],
  /** Front axle lift while it rears up, then for the hitch: the last `hitch` ticks of the tell it jerks higher, mouth open. */
  rearUp: 26,
  rearHitch: 46,
  hitch: 14,
  waveSpeed: [240, 270, 300],
  /** Waves leave the tyre at this share of their speed and reach full speed after waveRamp ticks. */
  waveStart: 0.3,
  waveRamp: 24,
  wave: { w: 30, h: 20 },
  /** Where the tyres touch the floor, from the back of the box when it faces right: the waves start there. */
  tyreX: { rear: 46, front: 156 },

  rainTell: [44, 38, 32],
  volleys: [1, 2, 3],
  volleyGap: [46, 46, 40],
  rainFall: [104, 94, 84],
  rainSpacing: [112, 96, 84],
  clod: { w: 22, h: 22, speed: 330, drop: 336 },

  blobTell: [44, 38, 32],
  blobs: [2, 3, 3],
  blobCap: 4,
  blobRest: 60,
  glob: { w: 20, h: 20, flight: 56, apex: 110 },

  spinTell: [56, 54, 50],
  spinOn: [44, 52, 60],
  spinReach: [320, 360, 380],
  spinRest: 18,
  fanH: 30,

  hopTell: [46, 40, 36],
  hops: [2, 2, 3],
  hopTicks: [84, 76, 70],
  hopHeight: [150, 150, 140],
  hopLand: [14, 10, 8],
  hopRest: 16,

  /** The finish, in ticks of 'washed': it stares, shrinks in `steps` pops, is sheepish, then happy, then the level completes. */
  fin: { shrinkAt: 50, step: 26, steps: 4, sheepAt: 154, happyAt: 238, doneAt: 378 },
  /** Its box once it has shrunk (the art's plain pickup). */
  small: { w: 124, h: 76 },
  /** Where the top of its exhaust stack is, from the back of the box: the backfire comes out there. */
  stackX: 67,
} as const

const STOMP = 0
const RAIN = 1
const BLOBS = 2
const SPIN = 3
const HOP = 4
/** Attack ids, for vars.force (tests and the dev page: -1 follows the pattern). */
export const MZ_ATTACKS = ['stomp', 'rain', 'blobs', 'spin', 'hop'] as const

// A stomp's waves are still rolling into whatever comes next, so a stomp is never followed by the
// tyre spray (both would want the far end of the floor at once).
const RUNS: readonly (readonly (readonly number[])[])[] = [
  [[STOMP, RAIN], [BLOBS, SPIN], [HOP]],
  [
    [STOMP, RAIN, SPIN],
    [BLOBS, HOP, STOMP],
  ],
  [
    [SPIN, STOMP, RAIN],
    [BLOBS, HOP, STOMP],
    [RAIN, SPIN, HOP],
  ],
]

const DIR_L: Record<string, number> = Object.freeze({ dir: -1 })
const DIR_R: Record<string, number> = Object.freeze({ dir: 1 })

const cx = (e: Entity): number => e.x + e.w / 2
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Switch state and restart its clock, even into the state it is already in. */
function go(e: Entity, state: string): void {
  e.state = state
  e.stateT = 0
}

/** Ease the body toward a pose. */
function pose(e: Entity, pitch: number, sink: number, rate = 0.3): void {
  const v = e.vars
  v.pitch += (pitch - v.pitch) * rate
  v.sink += (sink - v.sink) * rate
}

/** The x of its front bumper, the end that faces the arena. */
function frontX(e: Entity): number {
  return e.facing < 0 ? e.x : e.x + e.w
}

/** World x of a point `u` px from the back of the box (as drawn facing right), whichever way it faces. */
function tyreAt(e: Entity, u: number): number {
  return e.facing > 0 ? e.x + u : e.x + e.w - u
}

/** The floor it is not standing on: [left, right] of the stretch in front of it. */
function freeSpan(e: Entity, out: { l: number; r: number }): void {
  const v = e.vars
  if (e.facing < 0) {
    out.l = v.ax0 + 10
    out.r = e.x - 30
  } else {
    out.l = e.x + e.w + 30
    out.r = v.ax1 - 10
  }
}
const SPAN = { l: 0, r: 0 }

/* ------------------------------------------------------------------ */
/* What it throws                                                      */
/* ------------------------------------------------------------------ */

/** A shadow on the surface at (x, y) that lasts until something lands there `life` ticks from now. */
function mark(w: World, x: number, y: number, width: number, life: number, kind: number): Entity | null {
  const m = spawn(w, 'mz_mark', x, y)
  if (!m) return null
  m.x = x - width / 2
  m.w = width
  m.vars.w = width
  m.vars.life = life
  m.vars.kind = kind
  m.vars.floor = y
  return m
}

registerEntity('mz_mark', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 26, 6)
    e.gravity = 0
    e.collides = false
    e.vars.life = 90
    e.vars.kind = 0
    e.vars.w = 26
    e.vars.floor = e.y + e.h
    e.vars.top = e.y + e.h - MZ.clod.drop + MZ.clod.h
    e.vars.fall = 0
  },
  update(e, w) {
    const v = e.vars
    // A clod's mark sends the clod itself, timed to land as the mark runs out.
    if (v.kind === 0 && e.stateT === v.life - v.fall) {
      const c = spawn(w, 'mz_clod', cx(e), v.top)
      if (c) c.vars.floor = v.floor
    }
    if (e.stateT >= v.life) kill(e)
  },
})

/**
 * Where a clod over (x, floor) starts (its feet) and how many ticks it falls: from high above
 * the screen, or from just under a block in the way, so it never passes through one.
 */
function clodDrop(w: World, m: Entity): void {
  const v = m.vars
  const x = cx(m)
  let top = v.floor - MZ.clod.drop + MZ.clod.h
  for (let y = v.floor - TILE / 2; y > top - MZ.clod.h; y -= TILE) {
    if (!solidAt(w, x, y)) continue
    top = Math.max(top, (Math.floor(y / TILE) + 1) * TILE + MZ.clod.h)
    break
  }
  v.top = top
  v.fall = Math.max(1, Math.ceil(((v.floor - top) / MZ.clod.speed) * 60))
}

function burst(e: Entity, w: World): void {
  kill(e)
  fx(w, 'mud', cx(e), e.y + e.h, 6)
  sfxEvery(w, 'splat', 4)
}

function washedAway(e: Entity, w: World): boolean {
  kill(e)
  fx(w, 'splash', cx(e), e.y + e.h / 2, 5)
  sfxEvery(w, 'sprayHit', 5)
  return true
}

function hitsMaxx(e: Entity, w: World): boolean {
  hurtPlayer(w, { fromX: cx(e) })
  burst(e, w)
  return true
}

registerEntity('mz_clod', {
  offscreen: 'remove',
  init(e) {
    setBox(e, MZ.clod.w, MZ.clod.h)
    e.gravity = 0
    e.collides = false
    e.harmful = true
    e.z = 1
    e.state = 'fall'
    e.vars.floor = e.y + e.h + MZ.clod.drop
  },
  update(e, w) {
    e.vy = MZ.clod.speed
    e.y += e.vy * DT
    if (e.y + e.h < e.vars.floor) return
    e.y = e.vars.floor - e.h
    burst(e, w)
  },
  onSpray: washedAway,
  onTouch: hitsMaxx,
})

registerEntity('mz_glob', {
  offscreen: 'remove',
  init(e) {
    setBox(e, MZ.glob.w, MZ.glob.h)
    e.gravity = 0
    e.collides = false
    e.harmful = true
    e.z = 1
    e.state = 'fly'
    e.vars.life = MZ.glob.flight
    e.vars.x0 = e.x
    e.vars.y0 = e.y
    e.vars.x1 = e.x
    e.vars.y1 = e.y
    e.vars.apex = MZ.glob.apex
    e.vars.mz = 0
  },
  update(e, w) {
    const v = e.vars
    const t = Math.min(1, e.stateT / v.life)
    const x = v.x0 + (v.x1 - v.x0) * t
    const y = v.y0 + (v.y1 - v.y0) * t - 4 * v.apex * t * (1 - t)
    e.vx = (x - e.x) / DT
    e.vy = (y - e.y) / DT
    e.x = x
    e.y = y
    if (t < 1) return
    const feetX = cx(e)
    const feetY = e.y + e.h
    burst(e, w)
    // It walks at Maxx from where it lands. Kind 'blob' belongs to the critters.
    const b = spawn(w, 'blob', feetX, feetY, { props: playerCx(w) < feetX ? DIR_L : DIR_R })
    if (b) b.vars.mz = 1
  },
  onSpray(e, w) {
    addScore(w, 50, cx(e), e.y - 6)
    return washedAway(e, w)
  },
  onTouch: hitsMaxx,
})

/** A wave's speed on tick `t` of its life (1 = the first): from MZ.waveStart of full speed up to full over MZ.waveRamp ticks. */
export function waveSpeedAt(full: number, t: number): number {
  return full * Math.min(1, MZ.waveStart + ((1 - MZ.waveStart) * t) / MZ.waveRamp)
}

registerEntity('mz_wave', {
  offscreen: 'remove',
  init(e) {
    setBox(e, MZ.wave.w, MZ.wave.h)
    e.gravity = 0
    e.collides = false
    e.harmful = true
    e.z = 1
    e.state = 'run'
    e.vars.speed = MZ.waveSpeed[0]
    e.vars.lo = -1e9
    e.vars.hi = 1e9
  },
  update(e, w) {
    const v = e.vars
    // It surges out from under the tyre and gathers speed: the moment after a slam is the one to read it in.
    e.vx = e.facing * waveSpeedAt(v.speed, e.stateT)
    e.x += e.vx * DT
    if (e.stateT % 5 === 0) fx(w, 'dust', cx(e), e.y + e.h, 1, -e.facing)
    if (e.x + e.w > v.hi || e.x < v.lo) {
      kill(e)
      fx(w, 'mud', e.facing > 0 ? v.hi : v.lo, e.y + e.h - 6, 5)
      sfxEvery(w, 'splat', 6)
    }
  },
})

registerEntity('mz_fan', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 32, MZ.fanH)
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.state = 'warn'
    e.vars.warn = MZ.spinTell[0]
    e.vars.on = MZ.spinOn[0]
  },
  update(e, w) {
    const v = e.vars
    if (e.state === 'warn') {
      if (e.stateT < v.warn) return
      go(e, 'on')
      e.harmful = true
      return
    }
    if (e.stateT % 4 === 1) sweepBlobs(e, w)
    if (e.stateT % 4 === 0) fx(w, 'mud', e.facing < 0 ? e.x : e.x + e.w, e.y + e.h - 8, 1, e.facing)
    if (e.stateT >= v.on) kill(e)
  },
})

/** Its own blobs caught on the floor in the spray are blasted away with it. */
function sweepBlobs(fan: Entity, w: World): void {
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const b = ents[i]
    if (b.kind !== 'blob' || b.dead || b.vars.mz !== 1 || (b.state !== 'walk' && b.state !== 'hit')) continue
    if (!overlaps(fan, b)) continue
    kill(b)
    fx(w, 'mud', cx(b), b.y + b.h / 2, 6, fan.facing)
    sfxEvery(w, 'splat', 4)
  }
}

/**
 * The steel shutter it drops into the arena's doorway when the fight starts: a wall for good
 * (the level ends with the fight). The picture slides it down over MZ.shutter ticks.
 */
registerEntity('mz_shutter', {
  alwaysActive: true,
  init(e) {
    setBox(e, TILE, 2 * TILE)
    e.gravity = 0
    e.collides = false
    e.solid = 'full'
    e.state = 'shut'
  },
  update() {},
})

/* ------------------------------------------------------------------ */
/* Mudzilla                                                            */
/* ------------------------------------------------------------------ */

function phaseIx(e: Entity): number {
  return clamp(e.vars.phase, 1, 3) - 1
}

/** The dirt it cannot go below in this phase: the next phase starts there. */
function phaseFloor(e: Entity): number {
  return (e.maxHp * (3 - e.vars.phase)) / 3
}

function currentRun(e: Entity): readonly number[] {
  const runs = RUNS[phaseIx(e)]
  return runs[e.vars.run % runs.length]
}

function idle(e: Entity, wait: number): void {
  e.vars.wait = wait
  go(e, 'idle')
}

/** A doorway in the left wall, one column outside the arena: shut it. */
function shutDoor(e: Entity, w: World): void {
  const v = e.vars
  const x = v.ax0 - TILE / 2
  if (x < 0 || solidAt(w, x, v.floor - TILE / 2)) return
  let h = 1
  while (h < 4 && !solidAt(w, x, v.floor - h * TILE - TILE / 2)) h++
  // No wall above it: an open edge, nothing to shut.
  if (!solidAt(w, x, v.floor - h * TILE - TILE / 2)) return
  const s = spawn(w, 'mz_shutter', x, v.floor)
  if (!s) return
  s.h = h * TILE
  s.y = v.floor - s.h
  sfx(w, 'door')
}

/** The arena: the floor and one wall column each side. The camera follows Maxx inside it. */
function lockArena(e: Entity, w: World): void {
  lockCamera(w, e.vars.ax0 - TILE, e.vars.ax1 + TILE)
}

function startFight(e: Entity, w: World): void {
  const v = e.vars
  go(e, 'wake')
  // For the wake the picture holds the whole truck, with Maxx at its left edge: the follow-cam
  // would show only its nose while he stands in the doorway.
  const p = w.player
  const x0 = Math.max(v.ax0 - TILE, Math.min(e.x + e.w + MZ.wakeCamMargin - VIEW_W, p.x - MZ.wakeCamMargin))
  lockCamera(w, x0, x0 + VIEW_W)
  shutDoor(e, w)
  versus(w, e, MZ.name, MZ.tagline)
  const song = propStr(e, 'music', 'boss')
  if (song !== '') {
    setBossMusic(w, song as MusicId)
    v.song = 1
  }
  const clock = propNum(e, 'clock', MZ.clock) * 60
  if (w.timeLeft < clock) w.timeLeft = clock
  setBoss(w, MZ.name, e.hp, e.maxHp)
}

/** Blobs of its own that have left the arena or walked back into it are gone. */
function tidyBlobs(e: Entity, w: World): void {
  const ents = w.entities
  const grounded = e.state !== 'hop'
  for (let i = 0; i < ents.length; i++) {
    const b = ents[i]
    if (b.kind !== 'blob' || b.dead || b.vars.mz !== 1) continue
    if (b.x + b.w < e.vars.ax0 - 16) kill(b)
    else if (grounded && (b.state === 'walk' || b.state === 'hit') && overlaps(e, b)) {
      kill(b)
      fx(w, 'mud', cx(b), b.y + b.h / 2, 5)
    }
  }
}

function liveBlobs(w: World): number {
  let n = 0
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const b = ents[i]
    if (b.kind === 'blob' && !b.dead && b.vars.mz === 1 && b.state !== 'pop' && b.state !== 'squash') n++
    else if (b.kind === 'mz_glob' && !b.dead) n++
  }
  return n
}

/** Everything it has thrown goes, the moment it is washed. */
function clearField(w: World): void {
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (o.dead || o.kind === 'mz_shutter') continue
    if (o.kind === 'blob' ? o.vars.mz === 1 : o.kind.startsWith('mz_')) {
      kill(o)
      if (o.kind !== 'mz_mark') fx(w, 'bubble', cx(o), o.y + o.h / 2, 3)
    }
  }
}

function slam(e: Entity, w: World): void {
  const v = e.vars
  const ix = phaseIx(e)
  v.pitch = -6
  v.n++
  shake(w, 10, 4)
  rumble(w, 0.8, 0.5, 200)
  sfx(w, 'crumble')
  sfx(w, 'bump')
  fx(w, 'dust', tyreAt(e, MZ.tyreX.front), v.floor, 8)
  for (let side = -1; side <= 1; side += 2) {
    // Each bursts out from under a tyre: forward from the front one, back from the rear one. Starting
    // under the truck rather than at its bumper gives whoever stands in front the moment to see it.
    const from = tyreAt(e, side === e.facing ? MZ.tyreX.front : MZ.tyreX.rear)
    const wave = spawn(w, 'mz_wave', from, v.floor)
    if (!wave) continue
    wave.facing = side < 0 ? -1 : 1
    wave.vars.speed = MZ.waveSpeed[ix]
    wave.vars.lo = v.ax0
    wave.vars.hi = v.ax1
  }
}

/** One volley of clods: a row of marks across the floor it is not on, each of which sends its clod. */
function volley(e: Entity, w: World, n: number): void {
  const v = e.vars
  const ix = phaseIx(e)
  const spacing = MZ.rainSpacing[ix]
  freeSpan(e, SPAN)
  const first = SPAN.l + MZ.clod.w / 2 + 2
  let off = (v.aim + (n * spacing) / MZ.volleys[ix]) % spacing
  if (off < 0) off += spacing
  for (let x = first + off; x <= SPAN.r - MZ.clod.w / 2; x += spacing) {
    const m = mark(w, Math.round(x), v.floor, MZ.clod.w + 4, MZ.rainFall[ix], 0)
    if (m) clodDrop(w, m)
  }
  sfx(w, 'mudThrow')
}

/** Throw the globs: the first at where Maxx stands, the rest spread over the floor. */
function toss(e: Entity, w: World): void {
  const v = e.vars
  const ix = phaseIx(e)
  const p = w.player
  freeSpan(e, SPAN)
  const count = Math.max(1, Math.min(MZ.blobs[ix], MZ.blobCap - liveBlobs(w)))
  const aimX = clamp(playerCx(w), SPAN.l + 12, SPAN.r - 12)
  // On whatever he stands on, so a catwalk is no hiding place; in mid-air it is the floor.
  const aimY = p.onGround && p.y + p.h <= v.floor ? p.y + p.h : v.floor
  // Up on a catwalk, the one meant for him must leave him somewhere to step to on it: the others
  // land well clear of that catwalk, where their arcs cannot come down across it.
  let cw0 = 0
  let cw1 = 0
  if (aimY < v.floor - 4) {
    const ty = Math.floor((aimY + 2) / TILE)
    let a = Math.floor(aimX / TILE)
    if (tileAt(w, a, ty) !== '=') a += tileAt(w, a - 1, ty) === '=' ? -1 : 1
    let b = a
    while (tileAt(w, a - 1, ty) === '=') a--
    while (tileAt(w, b + 1, ty) === '=') b++
    cw0 = a * TILE
    cw1 = (b + 1) * TILE
  }
  for (let i = 0; i < count; i++) {
    let x = aimX
    let y = aimY
    if (i > 0) {
      const share = count === 2 ? 0.45 : i === 1 ? 0.3 : 0.68
      x = frontX(e) + e.facing * (30 + share * (SPAN.r - SPAN.l))
      if (Math.abs(x - aimX) < 56) x += x < aimX ? -64 : 64
      if (cw1 > cw0) {
        // Its last 110 px before landing come down through catwalk height.
        const near = e.facing > 0 ? cw0 - 40 : cw0 - 110
        const far = e.facing > 0 ? cw1 + 110 : cw1 + 40
        if (x > near && x < far) x = e.facing > 0 ? far : near
        if (x < SPAN.l + 12 || x > SPAN.r - 12) continue
      }
      x = clamp(x, SPAN.l + 12, SPAN.r - 12)
      y = v.floor
    }
    const life = MZ.glob.flight + i * 9
    const g = spawn(w, 'mz_glob', cx(e) - e.facing * 30, e.y + 30)
    if (!g) continue
    g.vars.life = life
    g.vars.x0 = g.x
    g.vars.y0 = g.y
    g.vars.x1 = Math.round(x) - MZ.glob.w / 2
    g.vars.y1 = y - MZ.glob.h
    g.vars.apex = MZ.glob.apex + i * 14
    mark(w, Math.round(x), y, MZ.glob.w + 6, life, 1)
  }
  sfx(w, 'mudThrow')
  fx(w, 'mud', cx(e), e.y + 20, 8)
}

function startSpin(e: Entity, w: World): void {
  const v = e.vars
  const ix = phaseIx(e)
  const front = frontX(e)
  const far = clamp(front + e.facing * MZ.spinReach[ix], v.ax0, v.ax1)
  const f = spawn(w, 'mz_fan', (front + far) / 2, v.floor)
  if (!f) return
  f.x = Math.min(front, far)
  f.w = Math.abs(far - front)
  f.facing = e.facing
  f.vars.warn = MZ.spinTell[ix]
  f.vars.on = MZ.spinOn[ix]
}

/** Box x of where hop number `k` (1 = the first) of this crossing lands. */
function hopTarget(e: Entity, k: number): number {
  const v = e.vars
  const from = v.side > 0 ? v.homeR : v.homeL
  const to = v.side > 0 ? v.homeL : v.homeR
  return Math.round(from + ((to - from) * k) / MZ.hops[phaseIx(e)])
}

function startHop(e: Entity, w: World): void {
  const v = e.vars
  const ix = phaseIx(e)
  v.x0 = e.x
  v.tx = hopTarget(e, v.n + 1)
  // The first hop's shadow has been there since it crouched.
  if (v.n > 0) mark(w, v.tx + e.w / 2, v.floor, e.w - 8, MZ.hopTicks[ix], 2)
  go(e, 'hop')
  sfx(w, 'spring')
  fx(w, 'dust', cx(e), v.floor, 6)
}

function begin(e: Entity, w: World, attack: number): void {
  const v = e.vars
  v.n = 0
  if (attack === STOMP) go(e, 'stompTell')
  else if (attack === RAIN) go(e, 'rainTell')
  else if (attack === BLOBS) go(e, 'blobTell')
  else if (attack === SPIN) go(e, 'spinTell')
  else {
    go(e, 'hopTell')
    mark(w, hopTarget(e, 1) + e.w / 2, v.floor, e.w - 8, MZ.hopTell[phaseIx(e)] + MZ.hopTicks[phaseIx(e)], 2)
  }
}

/** An attack is over: the next one of the run, or it is out of breath. */
function advance(e: Entity, w: World): void {
  const v = e.vars
  v.step++
  if (v.step < (v.force >= 0 ? 1 : currentRun(e).length)) {
    idle(e, MZ.idle[phaseIx(e)])
    return
  }
  go(e, 'winded')
  // Out of breath: a backfire from the exhaust and stars round its head.
  sfx(w, 'pop')
  fx(w, 'smoke', e.facing > 0 ? e.x + MZ.stackX : e.x + e.w - MZ.stackX, e.y - 4, 4, -e.facing)
  fx(w, 'star', frontX(e) - e.facing * 30, e.y + 30, 4)
}

function startFinish(e: Entity, w: World): void {
  const v = e.vars
  v.fin = 2
  v.roar = 0
  e.harmful = false
  e.hp = 0
  e.y = v.floor - e.h
  clearField(w)
  go(e, 'washed')
}

/** The long finish. The clock stands still for it: nobody should run out of time while the truck says sorry. */
function finish(e: Entity, w: World): void {
  const v = e.vars
  const t = e.stateT
  const F = MZ.fin
  const mid = cx(e)
  w.timeLeft++
  if (t === 1) {
    sfx(w, 'bossDown')
    shake(w, 24, 3)
    rumble(w, 1, 0.7, 500)
    fx(w, 'splash', mid, e.y + e.h / 2, 16)
    addScore(w, MZ.score, mid, e.y - 12)
    // The fight's song ends with clearBoss; a hush for the finish, then the clear jingle.
    clearBoss(w)
    if (v.song === 1) music(w, null)
  }
  pose(e, 0, t < F.shrinkAt ? 6 : 0)
  for (let k = 1; k <= F.steps; k++) {
    if (t !== F.shrinkAt + (k - 1) * F.step) continue
    v.size = k
    sfx(w, 'pop')
    fx(w, 'foam', mid, e.y + e.h / 2, 8)
    fx(w, 'steam', mid, e.y + 30, 4)
    fx(w, 'mud', mid, e.y + e.h - 20, 6)
  }
  if (t === F.sheepAt) {
    e.x = mid - MZ.small.w / 2
    e.w = MZ.small.w
    e.h = MZ.small.h
    e.y = v.floor - e.h
    sfx(w, 'carClean')
    fx(w, 'sparkle', mid, e.y + e.h / 2, 14)
    fx(w, 'shine', mid, e.y + e.h / 2, 1)
  }
  if (t === F.happyAt) {
    banner(w, 'SQUEAKY CLEAN!', 150)
    sfx(w, 'honk')
    fx(w, 'confetti', mid, e.y - 20, 30)
  }
  if (t === F.happyAt + 36) {
    sfx(w, 'honk')
    fx(w, 'confetti', mid - 60, e.y - 30, 16)
    fx(w, 'confetti', mid + 60, e.y - 30, 16)
  }
  if (t === F.happyAt + 80) fx(w, 'sparkle', mid, e.y + 20, 10)
  if (t >= F.doneAt) {
    setFlag(w, MZ.flag, 1)
    unlockCamera(w)
    completeLevel(w, 'goal')
  }
}

registerEntity('mudzilla', {
  alwaysActive: true,
  boss: true,
  init(e, w) {
    setBox(e, MZ.w, MZ.h)
    e.gravity = 0
    e.collides = false
    e.facing = -1
    e.state = 'sleep'
    if (getFlag(w, MZ.flag) >= 1) {
      kill(e)
      return
    }
    e.hp = Math.max(3, propNum(e, 'dirt', MZ.dirt))
    e.maxHp = e.hp
    e.harmful = true
    const v = e.vars
    v.floor = e.y + e.h
    // The right wall: the first solid tile on its own row, from where it was put.
    let wall = areaWidth(w)
    for (let x = cx(e); x < areaWidth(w); x += TILE) {
      if (!solidAt(w, x, v.floor - TILE / 2)) continue
      wall = Math.floor(x / TILE) * TILE
      break
    }
    v.ax1 = wall
    v.ax0 = Math.max(0, wall - Math.max(16, Math.round(propNum(e, 'arena', MZ.arenaTiles))) * TILE)
    v.arena = v.ax1 - v.ax0
    v.homeR = v.ax1 - MZ.wallGap - e.w
    v.homeL = v.ax0 + MZ.wallGap
    e.x = v.homeR
    v.side = 1
    v.phase = 1
    v.run = 0
    v.step = 0
    v.n = 0
    v.wait = 0
    v.force = -1
    v.roar = 0
    v.fin = 0
    v.size = 0
    v.song = 0
    v.pitch = 0
    v.sink = 0
    v.spin = 0
    v.hitT = 999
    v.aim = 0
    v.x0 = e.x
    v.tx = e.x
  },
  update(e, w) {
    const v = e.vars
    if (v.hitT < 999) v.hitT++
    if (e.state === 'sleep') {
      pose(e, 0, 5)
      if (playerCx(w) >= v.ax0 + MZ.trigger) startFight(e, w)
      return
    }
    if (e.state === 'washed') {
      finish(e, w)
      return
    }
    setBoss(w, MZ.name, e.hp, e.maxHp)
    if (w.tick % 8 === 0) tidyBlobs(e, w)
    if (v.fin === 1 && e.state !== 'hop') {
      startFinish(e, w)
      return
    }
    const ix = phaseIx(e)
    const t = e.stateT
    if (v.roar === 1 && (e.state === 'idle' || e.state === 'winded' || e.state === 'recover')) {
      go(e, 'roar')
      return
    }

    switch (e.state) {
      case 'wake':
        pose(e, t >= MZ.wakeRoar ? 20 : 0, 0)
        if (t === MZ.wakeRoar) {
          sfx(w, 'thunder')
          shake(w, 36, 3)
          rumble(w, 0.9, 0.6, 500)
        }
        if (t >= MZ.wake) {
          lockArena(e, w)
          idle(e, 30)
        }
        break

      case 'idle':
        pose(e, 0, 0)
        if (t >= v.wait) begin(e, w, v.force >= 0 ? Math.min(HOP, Math.floor(v.force)) : currentRun(e)[v.step])
        break

      case 'stompTell': {
        // Up on its back wheels, front tyres pawing the air; then the hitch, the same few ticks
        // before every slam: it jerks higher with its mouth open, and down it comes.
        const len = v.n === 0 ? MZ.stompTell[ix] : MZ.stompAgain[ix]
        const hitch = t > len - MZ.hitch
        if (t === 1) sfx(w, 'rev')
        if (t === len - MZ.hitch + 1) {
          sfx(w, 'rev')
          fx(w, 'smoke', tyreAt(e, MZ.tyreX.rear), v.floor - 6, 3, -e.facing)
        }
        pose(e, hitch ? MZ.rearHitch : MZ.rearUp, 0, hitch ? 0.45 : 0.16)
        v.spin += hitch ? 9 : 4
        if (t >= len) go(e, 'stomp')
        break
      }
      case 'stomp':
        if (t < MZ.slam) v.pitch *= 0.5
        else if (t === MZ.slam) slam(e, w)
        else pose(e, 0, 0, 0.35)
        if (t >= MZ.slam + (v.n < MZ.stomps[ix] ? MZ.stompGap : MZ.stompRest[ix])) {
          if (v.n < MZ.stomps[ix]) go(e, 'stompTell')
          else advance(e, w)
        }
        break

      case 'rainTell':
        if (t === 1) sfx(w, 'rev')
        pose(e, -6, 5)
        v.spin += 14
        if (t % 6 === 0) fx(w, 'mud', cx(e) - e.facing * 60, v.floor - 40, 2, -e.facing)
        if (t >= MZ.rainTell[ix]) {
          // One clod of the first volley is meant for him.
          freeSpan(e, SPAN)
          v.aim = playerCx(w) - (SPAN.l + MZ.clod.w / 2 + 2)
          v.n = 0
          go(e, 'rain')
        }
        break
      case 'rain':
        pose(e, 10, 0)
        if (v.n < MZ.volleys[ix] && t >= 1 + v.n * MZ.volleyGap[ix]) {
          volley(e, w, v.n)
          v.n++
        }
        if (t >= (MZ.volleys[ix] - 1) * MZ.volleyGap[ix] + MZ.rainFall[ix] + 16) advance(e, w)
        break

      case 'blobTell':
        if (t === 1) sfx(w, 'crumble')
        pose(e, 0, 4)
        if (t % 8 === 0) fx(w, 'mud', cx(e), e.y + 30, 1)
        if (t >= MZ.blobTell[ix]) {
          toss(e, w)
          go(e, 'blobs')
        }
        break
      case 'blobs':
        pose(e, 6, 0)
        if (t >= MZ.blobRest) advance(e, w)
        break

      case 'spinTell':
        if (t === 1) {
          sfx(w, 'rev')
          startSpin(e, w)
        }
        pose(e, -8, 6)
        v.spin += 4 + (14 * t) / MZ.spinTell[ix]
        if (t % 5 === 0) fx(w, 'smoke', frontX(e) - e.facing * 44, v.floor - 8, 1, e.facing)
        if (t >= MZ.spinTell[ix]) go(e, 'spin')
        break
      case 'spin':
        pose(e, -8, 6)
        if (t <= MZ.spinOn[ix]) {
          v.spin += 22
          sfxEvery(w, 'mudThrow', 9)
        }
        if (t >= MZ.spinOn[ix] + MZ.spinRest) advance(e, w)
        break

      case 'hopTell':
        if (t === 1) sfx(w, 'rev')
        pose(e, 0, 15, 0.18)
        if (t >= MZ.hopTell[ix]) startHop(e, w)
        break
      case 'hop': {
        const k = Math.min(1, t / MZ.hopTicks[ix])
        e.x = v.x0 + (v.tx - v.x0) * k
        e.y = v.floor - e.h - 4 * MZ.hopHeight[ix] * k * (1 - k)
        pose(e, k < 0.5 ? 10 : -8, -8)
        v.spin += 6
        if (k < 1) break
        e.x = v.tx
        e.y = v.floor - e.h
        v.n++
        v.sink = 16
        v.pitch = 0
        shake(w, 8, 4)
        rumble(w, 0.9, 0.5, 220)
        sfx(w, 'crumble')
        sfx(w, 'bump')
        fx(w, 'dust', e.x + 20, v.floor, 6, -1)
        fx(w, 'dust', e.x + e.w - 20, v.floor, 6, 1)
        go(e, 'hopLand')
        break
      }
      case 'hopLand':
        pose(e, 0, 0, 0.25)
        if (v.n < MZ.hops[ix]) {
          if (t >= MZ.hopLand[ix]) startHop(e, w)
          break
        }
        // Across: it turns to face the arena again.
        if (t === MZ.hopLand[ix]) {
          v.side = -v.side
          e.facing = v.side > 0 ? -1 : 1
        }
        if (t >= MZ.hopLand[ix] + MZ.hopRest) advance(e, w)
        break

      case 'winded':
        pose(e, -3, 7, 0.2)
        if (t >= MZ.winded[ix]) go(e, 'recover')
        break
      case 'recover':
        pose(e, 0, 0)
        if (t >= MZ.recover[ix]) {
          v.run++
          v.step = 0
          idle(e, 14)
        }
        break

      case 'roar':
        if (t === 1) {
          sfx(w, 'thunder')
          shake(w, 40, 3)
          rumble(w, 1, 0.6, 600)
        }
        pose(e, 22, 0)
        if (t === MZ.roarStage) {
          v.phase = Math.min(3, v.phase + 1)
          sfx(w, 'crumble')
          fx(w, 'mud', cx(e), e.y + e.h / 2, 20)
          fx(w, 'splash', cx(e), e.y + 40, 10)
        }
        if (t >= MZ.roar) {
          v.roar = 0
          v.run = 0
          v.step = 0
          idle(e, 20)
        }
        break
    }
  },
  onSpray(e, w, d) {
    const v = e.vars
    // Asleep it is scenery, and once it is washed the water has nothing left to do.
    if (e.state === 'sleep' || e.state === 'washed' || v.fin !== 0) return false
    fx(w, 'splash', d.x, d.y, 1)
    v.hitT = 0
    // Mid-roar (and while one is owed) it is between bodies: the water only wets it.
    if (e.state === 'wake' || e.state === 'roar' || v.roar === 1) {
      sfxEvery(w, 'sprayHit', 5)
      return true
    }
    const winded = e.state === 'winded'
    const before = e.hp
    const least = phaseFloor(e)
    e.hp = Math.max(least, e.hp - (winded ? MZ.washWinded : MZ.washChip) * d.power)
    if (winded) sfxEvery(w, 'bossHit', 12)
    else sfxEvery(w, 'sprayHit', 5)
    if (Math.floor(before) !== Math.floor(e.hp)) fx(w, 'mud', d.x, d.y, 2)
    if (e.hp > least) return true
    if (v.phase < 3) {
      v.roar = 1
    } else {
      // Washed. Whatever is in the air goes at once; a hop in progress is allowed to land first.
      v.fin = 1
      e.harmful = false
      clearField(w)
    }
    return true
  },
})
