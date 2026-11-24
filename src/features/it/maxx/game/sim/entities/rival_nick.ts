// NIMBUS NICK of the Free Rain Wash Co.: secret rival 4, the last and the hardest. A smug
// little storm cloud in sunglasses who thinks rain is a free car wash and wonders why anyone
// pays. He floats overhead: this is the fight about aiming up and using the catwalks.
//
//   nick         props: left (tile column of the arena's left wall; default: 10 columns left
//                of where he is placed), hp (310). His legend character goes on the arena
//                floor (that row is the floor he measures from); he floats up from there.
//   nick_rain    one column of dirty rain. 'tell' (faint, harmless), then 'fall' (it hurts,
//                and it may sweep sideways), then 'stop'. It stops at the first catwalk or
//                floor under its top: under a catwalk is dry.
//   nick_bolt    a lightning strike. 'mark' on the ground for vars.mark ticks, then 'strike'
//                (10 ticks, 16 px wide, from the top of the arena down to the mark), 'scorch'.
//                It goes through catwalks.
//   nick_gust    the wind. 'tell' (streaks show the way it will blow), then 'blow': Maxx is
//                shoved vars.dir * vars.push px a tick. A rain curtain falls at the wall it
//                blows toward.
//
// THE FIGHT. He waits until Maxx is inside the arena, then: versus card, camera locked.
// Between attacks ('float') he drifts toward the spot above Maxx. A round is two attacks
// and then he is out of breath ('pant', sagging lower, harmless): that is when water counts
// in full. Outside 'pant' it counts a fifth and cannot end a stage.
//   rain   swells up (rainTell, the columns already showing faintly where they will fall),
//          then rains (rain), the columns sweeping slowly sideways; 2 or 3 waves, each with
//          its own tell, the gaps somewhere new each time, never narrower than 2 tiles.
//   bolt   crackles (boltTell), then marks 3 or 4 spots in turn (bolt), each where Maxx
//          stands when it appears (later stages a little ahead of a runner), each striking
//          46 to 52 ticks later ('thunder').
//   gust   puffs his cheeks (gustTell, streaks blowing the way the wind will go), then
//          blows (gust) Maxx toward the wall away from himself, where a rain curtain falls.
// Later the attacks overlap, never so that their safe spots disagree:
//   stage 1+  one mark during each gust, where Maxx stands (the wind blows him off it, so the
//             danger is fighting the wind into it); none if he is within 90 px of the curtain.
//   stage 2   one mark during the last rain wave, where he stands, only if the dry stretch he
//             is in still has 36 px of room beside the strike when it comes.
// Each share of water lost (in a pant: 30%, 26%, 26% of the bar) he wrings out ('shrink'):
// smaller, lower, more worried, his sunglasses slipping; a Maxx missing shine gets a bubble.
// Stage 3 is the puff (the last 18%): tiny, at head height, harmless, fleeing; water counts
// in full. Finish him: he rains himself out into one small clean rainbow ('beaten').
//
// FOR THE RENDERER. His box is centred on (vars.cx, vars.cy) and sized by stage:
// NICK_SIZE[vars.stage] (stage 0 big and smug .. 3 the puff); while 'shrink' the box goes
// from the old size to the new over SHRINK_T ticks. facing = toward Maxx.
//   wait, intro (90 ticks), float         idle, smug
//   rainTell (vars.tell ticks)            swelling, dark, rumbling     rain    raining hard
//   boltTell (vars.tell ticks)            crackling, arm up            bolt    throwing bolts
//   gustTell (vars.tell ticks)            cheeks puffed toward vars.dir   gust  blowing
//   pant (vars.tell ticks), recover (24)  out of breath, sagging; open to water
//   shrink (SHRINK_T)                     wringing out                 puff    tiny, fleeing
//   beaten                                rained out: a little white cloud over a rainbow
//                                         whose feet are on vars.floor. z -1 from then on;
//                                         he drifts out to vars.restX (at least REST_ROOM from
//                                         both walls) within the first 40 ticks
// vars.flinch > 0 for a few ticks after water hit him.
//   nick_rain: box = the column (top vars.top to the arena floor), state tell | fall | stop.
//              Draw it down to the first catwalk or floor at each x (as the hit test does).
//   nick_bolt: vars.x, vars.sy = the mark's middle on the surface; state mark | strike | scorch.
//   nick_gust: box = the arena; vars.dir -1 | 1; state tell | blow.
import { MAX_PIPS, VIEW_W } from '../../contract'
import {
  fx,
  hurtPlayer,
  kill,
  lockCamera,
  playerCx,
  propNum,
  pushPlayer,
  rand,
  registerEntity,
  rumble,
  setBox,
  setState,
  sfx,
  sfxEvery,
  shake,
  spawn,
  versus,
} from '../api'
import type { Droplet, Entity, World } from '../types'
import { REST_ROOM, STEP, arenaInit, clamp, fightBegins, fightTick, rivalFall, setHarm, surfaceBelow, washRival } from './rival_ollie'

const NAME = 'NIMBUS NICK'
// The last words are the hint the fight needs: he floats overhead, and only water aimed up reaches him.
const TAGLINE = 'WHY PAY? WAIT FOR RAIN. LOOK UP!'
const NUMBER = 4
const HOME_COL = 10

/** Box by stage: 0 big and smug, 1, 2, 3 the puff. */
export const NICK_SIZE: readonly (readonly [number, number])[] = [
  [88, 56],
  [68, 44],
  [50, 34],
  [26, 20],
]
/** Height of his middle above the floor, by stage. The puff is at Maxx's head height. */
const HIGH = [222, 192, 170, 34]
/** How far a pant sags him. */
const SAG = [44, 40, 34, 0]
const DRIFT = [55, 70, 85, 0]
/** Share of the bar left at the end of each stage. */
const FLOORS = [0.7, 0.44, 0.18, 0]
const CHIP = 0.2
const INTRO_T = 90
const SHRINK_T = 80
const RECOVER_T = 24
const PUFF_SPEED = 46
/**
 * Pixels a tick he drifts, rained out, to where he rests. From the corner a puff can be chased
 * into that is 112 px: there in under 40 ticks, before his rainbow shows, so it never slides.
 */
const REST_DRIFT = 3
const STRIKE_T = 10
const SCORCH_T = 24
const STOP_T = 14
/** The rain starts this far above the floor (the top of the screen in a 12-row arena). */
const RAIN_TOP = 262
/** Ticks into a wave's fall, and into a gust, when the lightning marks for them come. */
const RAIN_BOLT_AT = 24
const GUST_BOLT_AT = 18
const GUST_BOLT_GAP = 40
/** Between waves the next columns show faintly this long. */
const WAVE_TELL = [46, 42, 40]

const RAIN = 1
const BOLT = 2
const GUST = 3
const PANT = 4

interface Stage {
  plan: number[]
  idle: number
  rainTell: number
  waves: number
  fall: number
  sweep: number
  cw: number
  gap: number
  boltTell: number
  bolts: number
  mark: number
  boltGap: number
  /** Share of his running speed the mark leads him by, in seconds. */
  lead: number
  gustTell: number
  blow: number
  push: number
  curtain: number
  pant: number
  /** A lightning mark during each rain wave (where it leaves him a dry spot), and during a gust. */
  rainBolt: boolean
  gustBolts: number
}

const STAGES: Stage[] = [
  { plan: [RAIN, BOLT, PANT, GUST, BOLT, PANT], idle: 44, rainTell: 56, waves: 2, fall: 110, sweep: 36, cw: 48, gap: 144, boltTell: 30, bolts: 3, mark: 52, boltGap: 36, lead: 0, gustTell: 52, blow: 80, push: 2.2, curtain: 64, pant: 140, rainBolt: false, gustBolts: 0 },
  { plan: [BOLT, RAIN, PANT, GUST, BOLT, PANT], idle: 36, rainTell: 50, waves: 2, fall: 100, sweep: 42, cw: 52, gap: 136, boltTell: 26, bolts: 4, mark: 48, boltGap: 32, lead: 0.1, gustTell: 48, blow: 90, push: 2.5, curtain: 72, pant: 135, rainBolt: false, gustBolts: 1 },
  { plan: [RAIN, BOLT, PANT, GUST, BOLT, PANT], idle: 30, rainTell: 46, waves: 2, fall: 92, sweep: 48, cw: 56, gap: 128, boltTell: 22, bolts: 4, mark: 46, boltGap: 28, lead: 0.16, gustTell: 46, blow: 100, push: 2.4, curtain: 80, pant: 130, rainBolt: true, gustBolts: 1 },
]

const BOB = [0, 1, 2, 2, 3, 3, 2, 2, 1, 0, -1, -2, -2, -3, -3, -2, -2, -1]

/** Hp at which a stage ends. */
function stageFloor(e: Entity, stage: number): number {
  return Math.round(e.maxHp * FLOORS[Math.min(3, stage)])
}

function face(e: Entity, w: World): void {
  const dx = playerCx(w) - e.vars.cx
  if (dx !== 0) e.facing = dx < 0 ? -1 : 1
}

/** Box from his middle and his stage (between two stages while he shrinks). */
function place(e: Entity): void {
  const v = e.vars
  let bw: number = NICK_SIZE[v.stage][0]
  let bh: number = NICK_SIZE[v.stage][1]
  if (e.state === 'shrink' && v.stage > 0) {
    const u = Math.min(1, e.stateT / SHRINK_T)
    bw = Math.round(NICK_SIZE[v.stage - 1][0] + (bw - NICK_SIZE[v.stage - 1][0]) * u)
    bh = Math.round(NICK_SIZE[v.stage - 1][1] + (bh - NICK_SIZE[v.stage - 1][1]) * u)
  }
  e.w = bw
  e.h = bh
  e.x = v.cx - bw / 2
  e.y = v.cy - bh / 2
}

/** Drift his middle toward (x, y) at `speed` px/s, kept inside the arena. */
function driftTo(e: Entity, x: number, y: number, speed: number): void {
  const v = e.vars
  const half = NICK_SIZE[v.stage][0] / 2 + 8
  const tx = clamp(x, v.ax0 + half, v.ax1 - half)
  const step = speed * STEP
  v.cx += clamp(tx - v.cx, -step, step)
  v.cy += clamp(y - v.cy, -1.5, 1.5)
}

function homeY(e: Entity): number {
  const v = e.vars
  return v.floor - HIGH[v.stage] + BOB[Math.floor(e.stateT / 5) % BOB.length]
}

/* ------------------------------------------------------------------ */
/* Rain                                                                */
/* ------------------------------------------------------------------ */

/** A column of rain from x0 (nominal left edge, may start outside the walls) cw wide. */
function rainColumn(w: World, nick: Entity, x0: number, cw: number, vx: number, tell: number, fall: number): void {
  const v = nick.vars
  const r = spawn(w, 'nick_rain', x0 + cw / 2, v.floor)
  if (!r) return
  const rv = r.vars
  rv.nx = x0
  rv.cw = cw
  rv.vx = vx
  rv.tell = tell
  rv.fall = fall
  rv.ax0 = v.ax0
  rv.ax1 = v.ax1
  rv.top = v.floor - RAIN_TOP
  rv.floor = v.floor
  clipColumn(r)
}

/**
 * One wave: columns cw wide with gaps between them, laid out from the wall they sweep
 * toward, so the gap against that wall still has room for Maxx when the sweep is done.
 */
function rainWave(e: Entity, w: World, S: Stage, dir: number, phase: number, tell: number): void {
  const v = e.vars
  const width = v.ax1 - v.ax0
  const reach = (S.sweep * S.fall) / 60
  const edge = Math.round(reach + 72 + phase)
  for (let k = 0; k < 8; k++) {
    const far = edge + k * (S.cw + S.gap)
    if (far >= width - 12) break
    // In arena terms: the column's side toward the downwind wall is `far` from that wall.
    const x0 = dir > 0 ? v.ax1 - far - S.cw : v.ax0 + far
    rainColumn(w, e, x0, S.cw, dir * S.sweep, tell, S.fall)
  }
}

function clipColumn(r: Entity): void {
  const v = r.vars
  const x0 = Math.max(v.ax0, v.nx)
  const x1 = Math.min(v.ax1, v.nx + v.cw)
  r.x = x0
  r.w = Math.max(0, x1 - x0)
  r.y = v.top
  r.h = v.floor - v.top
}

registerEntity('nick_rain', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 32, 32)
    e.gravity = 0
    e.collides = false
    e.z = 0
    e.state = 'tell'
    const v = e.vars
    v.nx = e.x
    v.cw = 32
    v.vx = 0
    v.tell = 40
    v.fall = 60
    v.ax0 = -1e9
    v.ax1 = 1e9
    v.top = e.y
    v.floor = e.y + 32
  },
  update(e, w) {
    const v = e.vars
    const t = e.stateT
    if (e.state === 'tell') {
      if (t >= v.tell) {
        setState(e, 'fall')
        sfxEvery(w, 'splat', 6)
      }
    } else if (e.state === 'fall') {
      v.nx += v.vx * STEP
      if (t >= v.fall) setState(e, 'stop')
    } else if (t >= STOP_T) {
      kill(e)
      return
    }
    clipColumn(e)
    if (e.state !== 'fall' || e.w < 8) return
    if (t % 9 === 0) fx(w, 'drip', e.x + e.w / 2, v.floor - 2, 1)
    // It hurts where it reaches him: down to the first catwalk or floor over his middle.
    const p = w.player
    const cx = p.x + p.w / 2
    if (cx < e.x + 3 || cx > e.x + e.w - 3 || p.y + p.h < v.top) return
    if (p.y < surfaceBelow(w, cx, v.top, v.floor)) hurtPlayer(w, { fromX: e.x + e.w / 2 })
  },
})

/* ------------------------------------------------------------------ */
/* Lightning                                                           */
/* ------------------------------------------------------------------ */

/** A lightning mark at world x, on whatever Maxx would stand on there, striking `mark` ticks later. */
function boltAt(e: Entity, w: World, x: number, mark: number): void {
  const v = e.vars
  const p = w.player
  const sy = surfaceBelow(w, x, Math.min(p.y + p.h, v.floor), v.floor)
  const b = spawn(w, 'nick_bolt', x, sy)
  if (!b) return
  b.vars.x = x
  b.vars.sy = sy
  b.vars.mark = mark
  b.vars.top = v.floor - RAIN_TOP - 40
  sfx(w, 'freeze')
}

/** One of a string of marks: where Maxx stands, a little ahead of him in later stages. */
function markBolt(e: Entity, w: World, S: Stage): void {
  const v = e.vars
  boltAt(e, w, clamp(playerCx(w) + w.player.vx * S.lead, v.ax0 + 16, v.ax1 - 16), S.mark)
}

/** Is a Maxx on the floor with his middle at x dry `ticks` from now? (No rain falling over him then, or a catwalk over his head.) */
function dryAt(w: World, x: number, ticks: number, top: number, floor: number): boolean {
  if (surfaceBelow(w, x, top, floor) < floor) return true
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const r = ents[i]
    if (r.dead || r.kind !== 'nick_rain' || r.state === 'stop') continue
    const rv = r.vars
    const start = r.state === 'tell' ? rv.tell - r.stateT : 0
    const end = r.state === 'tell' ? start + rv.fall : rv.fall - r.stateT
    if (ticks < start || ticks > end) continue
    const nx = rv.nx + rv.vx * STEP * (ticks - start)
    if (x >= Math.max(rv.ax0, nx) + 3 && x <= Math.min(rv.ax1, nx + rv.cw) - 3) return false
  }
  return true
}

/**
 * A mark in the middle of a rain wave, where Maxx stands, but only if the dry stretch he is in
 * still leaves him room beside the strike when it comes: the rain never pens him onto it.
 */
function rainBolt(e: Entity, w: World, S: Stage): void {
  const v = e.vars
  const top = v.floor - RAIN_TOP
  const px = playerCx(w)
  if (!dryAt(w, px, 0, top, v.floor) || !dryAt(w, px, S.mark, top, v.floor)) return
  // The dry stretch round him when it strikes.
  let x0 = px
  let x1 = px
  while (x0 - 2 >= v.ax0 + 11 && dryAt(w, x0 - 2, S.mark, top, v.floor)) x0 -= 2
  while (x1 + 2 <= v.ax1 - 11 && dryAt(w, x1 + 2, S.mark, top, v.floor)) x1 += 2
  const bx = clamp(px, v.ax0 + 16, v.ax1 - 16)
  if (Math.max(bx - 21 - x0, x1 - (bx + 21)) < 36) return
  boltAt(e, w, bx, S.mark)
}

/**
 * A mark where Maxx stands while the wind blows: it pushes him off it, so he must not fight
 * the wind into it. Not when he is near the rain at the far wall, so the two never pin him.
 */
function gustBolt(e: Entity, w: World, S: Stage): void {
  const v = e.vars
  const px = playerCx(w)
  const edge = v.dir > 0 ? v.ax1 - S.curtain : v.ax0 + S.curtain
  if ((v.dir > 0 ? edge - px : px - edge) < 90) return
  boltAt(e, w, clamp(px, v.ax0 + 16, v.ax1 - 16), S.mark)
}

registerEntity('nick_bolt', {
  offscreen: 'remove',
  init(e) {
    // The strike hurts 16 px wide: the bolt's bright core, not its glow.
    setBox(e, 16, 6)
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.state = 'mark'
    const v = e.vars
    v.x = e.x + 8
    v.sy = e.y + 6
    v.mark = 45
    v.top = e.y - 300
  },
  update(e, w) {
    const v = e.vars
    const t = e.stateT
    if (e.state === 'mark') {
      if (t < v.mark) return
      setState(e, 'strike')
      e.y = v.top
      e.h = v.sy - v.top
      e.harmful = true
      sfx(w, 'thunder')
      shake(w, 6, 3)
      rumble(w, 0.6, 0.4, 140)
      fx(w, 'spark', v.x, v.sy - 4, 8)
      fx(w, 'smoke', v.x, v.sy - 6, 3)
    } else if (e.state === 'strike') {
      if (t >= STRIKE_T) {
        setState(e, 'scorch')
        e.harmful = false
        e.y = v.sy - 6
        e.h = 6
      }
    } else if (t >= SCORCH_T) {
      kill(e)
    }
  },
})

/* ------------------------------------------------------------------ */
/* Wind                                                                */
/* ------------------------------------------------------------------ */

registerEntity('nick_gust', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 32, 32)
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.state = 'tell'
    const v = e.vars
    v.dir = 1
    v.tell = 40
    v.blow = 60
    v.push = 2
  },
  update(e, w) {
    const v = e.vars
    if (e.state === 'tell') {
      if (e.stateT >= v.tell) {
        setState(e, 'blow')
        sfx(w, 'hover')
      }
      return
    }
    if (e.stateT > v.blow) {
      kill(e)
      return
    }
    pushPlayer(w, v.dir * v.push)
    sfxEvery(w, 'hover', 30)
  },
})

/* ------------------------------------------------------------------ */
/* Nimbus Nick                                                         */
/* ------------------------------------------------------------------ */

function startTell(e: Entity, state: string, ticks: number): void {
  e.vars.tell = ticks
  setState(e, state)
}

function nextAttack(e: Entity, w: World): void {
  const v = e.vars
  const S = STAGES[v.stage]
  let what = S.plan[v.step % S.plan.length]
  if (v.force > 0) {
    what = v.force
    v.force = 0
  } else {
    v.step++
  }
  face(e, w)
  if (what === RAIN) {
    v.wave = 0
    v.sweepDir = playerCx(w) < (v.ax0 + v.ax1) / 2 ? -1 : 1
    if (rand(w) < 0.5) v.sweepDir = -v.sweepDir
    rainWave(e, w, S, v.sweepDir, 0, S.rainTell)
    startTell(e, 'rainTell', S.rainTell)
    sfx(w, 'thunder')
  } else if (what === BOLT) {
    v.n = S.bolts
    startTell(e, 'boltTell', S.boltTell)
    sfx(w, 'freeze')
  } else if (what === GUST) {
    const dx = playerCx(w) - v.cx
    v.dir = Math.abs(dx) > 24 ? Math.sign(dx) : playerCx(w) < (v.ax0 + v.ax1) / 2 ? -1 : 1
    e.facing = v.dir > 0 ? 1 : -1
    const g = spawn(w, 'nick_gust', (v.ax0 + v.ax1) / 2, v.floor)
    if (g) {
      g.x = v.ax0
      g.w = v.ax1 - v.ax0
      g.y = v.floor - RAIN_TOP
      g.h = RAIN_TOP
      g.vars.dir = v.dir
      g.vars.tell = S.gustTell
      g.vars.blow = S.blow
      g.vars.push = S.push
    }
    rainColumn(w, e, v.dir > 0 ? v.ax1 - S.curtain : v.ax0, S.curtain, 0, S.gustTell, S.blow)
    startTell(e, 'gustTell', S.gustTell)
    sfx(w, 'pop')
  } else {
    startTell(e, 'pant', S.pant)
    sfx(w, 'pop')
  }
}

function shrink(e: Entity, w: World): void {
  const v = e.vars
  v.stage++
  v.step = 0
  setState(e, 'shrink')
  sfx(w, 'bossHit')
  sfx(w, 'splat')
  fx(w, 'splash', v.cx, v.cy + 10, 14)
  fx(w, 'drip', v.cx, v.cy + 12, 8)
  shake(w, 6, 2)
  rumble(w, 0.4, 0.4, 180)
  // A little mercy for a Maxx who has been hit: a bubble drops out of the wrung water.
  if (w.player.pips < MAX_PIPS) spawn(w, 'bubble', clamp(v.cx, v.ax0 + 40, v.ax1 - 40), v.floor - 22)
  // Nothing of his is left hanging over Maxx while he wrings out.
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (!o.dead && o.kind.startsWith('nick_')) kill(o)
  }
}

registerEntity('nick', {
  boss: true,
  alwaysActive: true,
  init(e, w) {
    setBox(e, NICK_SIZE[0][0], NICK_SIZE[0][1])
    // In front of Maxx, and of his own rain (z 0), which falls from the sky behind him.
    e.z = 1
    e.hp = Math.max(10, Math.round(propNum(e, 'hp', 310)))
    e.maxHp = e.hp
    const v = e.vars
    v.cx = e.x + e.w / 2
    v.restX = v.cx
    v.wave = 0
    v.sweepDir = 1
    v.n = 0
    v.dir = 1
    v.tell = 0
    v.boltT = 0
    arenaInit(e, w, HOME_COL, NUMBER)
    v.cy = v.floor - HIGH[0]
    place(e)
  },
  update(e, w) {
    const v = e.vars
    const t = e.stateT
    if (e.state === 'wait') {
      face(e, w)
      v.cy = homeY(e)
      place(e)
      if (!fightBegins(e, w)) return
      setState(e, 'intro')
    }
    if (e.state === 'beaten') {
      // Rained out: what is left of him floats up a little, out to vars.restX, and stays.
      v.cy = Math.max(v.floor - 46, v.cy - 0.5)
      const d = v.restX - v.cx
      v.cx = Math.abs(d) <= REST_DRIFT ? v.restX : v.cx + (d < 0 ? -REST_DRIFT : REST_DRIFT)
      if (t < 60 && t % 6 === 0) fx(w, 'drip', v.cx, v.cy + 8, 1)
      place(e)
      return
    }
    fightTick(e, w, NAME)
    const S = STAGES[Math.min(2, v.stage)]
    const px = playerCx(w)
    switch (e.state) {
      case 'intro':
        face(e, w)
        v.cy = homeY(e)
        if (t === 1) {
          versus(w, e, NAME, TAGLINE)
          lockCamera(w, v.cam, v.cam + VIEW_W)
        }
        if (t >= INTRO_T) setState(e, 'float')
        break
      case 'float':
        face(e, w)
        driftTo(e, px, homeY(e), DRIFT[v.stage])
        if (t >= S.idle) nextAttack(e, w)
        break
      case 'rainTell':
        driftTo(e, (v.ax0 + v.ax1) / 2, homeY(e), DRIFT[v.stage] * 0.5)
        if (t >= v.tell) setState(e, 'rain')
        break
      case 'rain':
        driftTo(e, (v.ax0 + v.ax1) / 2, homeY(e), DRIFT[v.stage] * 0.5)
        if (S.rainBolt && v.wave === S.waves - 1 && t === RAIN_BOLT_AT) rainBolt(e, w, S)
        if (t >= S.fall) {
          v.wave++
          if (v.wave < S.waves) {
            v.sweepDir = -v.sweepDir
            const tell = WAVE_TELL[v.stage]
            rainWave(e, w, S, v.sweepDir, v.wave % 2 === 1 ? 56 : 28, tell)
            startTell(e, 'rainTell', tell)
            sfx(w, 'thunder')
          } else {
            setState(e, 'float')
          }
        }
        break
      case 'boltTell':
        face(e, w)
        driftTo(e, px, homeY(e), DRIFT[v.stage] * 0.5)
        if (t >= v.tell) {
          v.boltT = 0
          setState(e, 'bolt')
        }
        break
      case 'bolt':
        face(e, w)
        driftTo(e, px, homeY(e), DRIFT[v.stage] * 0.5)
        if (v.n > 0 && v.boltT <= 0) {
          markBolt(e, w, S)
          v.n--
          v.boltT = S.boltGap
        }
        v.boltT--
        // Done once the last mark has struck.
        if (v.n === 0 && v.boltT <= -(S.mark - S.boltGap + STRIKE_T)) setState(e, 'float')
        break
      case 'gustTell':
        v.cy = homeY(e)
        if (t >= v.tell) {
          setState(e, 'gust')
          v.tell = S.blow
        }
        break
      case 'gust':
        v.cy = homeY(e)
        if (t % 8 === 0) fx(w, 'smoke', v.cx + v.dir * (e.w / 2 + 6), v.cy, 1, v.dir)
        if (t >= GUST_BOLT_AT && t < GUST_BOLT_AT + S.gustBolts * GUST_BOLT_GAP && (t - GUST_BOLT_AT) % GUST_BOLT_GAP === 0) gustBolt(e, w, S)
        if (t >= S.blow) setState(e, 'float')
        break
      case 'pant':
        // Out of breath he sinks, and water counts in full.
        v.cy = Math.min(v.floor - HIGH[v.stage] + SAG[v.stage], v.cy + 2)
        if (t % 30 === 1) sfx(w, 'pop')
        if (t >= v.tell) setState(e, 'recover')
        break
      case 'recover':
        v.cy = Math.max(v.floor - HIGH[v.stage], v.cy - 2)
        if (t >= RECOVER_T) setState(e, 'float')
        break
      case 'shrink': {
        const goal = v.floor - HIGH[v.stage]
        v.cy += clamp(goal - v.cy, -3, 3)
        if (t % 10 === 0) fx(w, 'drip', v.cx, v.cy + 8, 2)
        if (t >= SHRINK_T) {
          v.cy = goal
          setState(e, v.stage >= 3 ? 'puff' : 'float')
          if (v.stage >= 3) sfx(w, 'pop')
        }
        break
      }
      case 'puff': {
        // Tiny and scared: away from Maxx along the floor, at his head height.
        e.facing = px < v.cx ? -1 : 1
        if (v.dir === 0 || (v.dir > 0 ? v.cx > v.ax1 - 30 : v.cx < v.ax0 + 30)) v.dir = px < v.cx ? 1 : -1
        if (Math.abs(px - v.cx) < 120 && Math.sign(px - v.cx) === v.dir) v.dir = -v.dir
        v.cx = clamp(v.cx + v.dir * PUFF_SPEED * STEP, v.ax0 + 16, v.ax1 - 16)
        v.cy = v.floor - HIGH[3] + (BOB[Math.floor(t / 3) % BOB.length] >> 1)
        if (t % 40 === 1) fx(w, 'drip', v.cx, v.cy + 8, 1)
        break
      }
    }
    place(e)
    const s = e.state
    setHarm(e, w, s !== 'intro' && s !== 'pant' && s !== 'recover' && s !== 'shrink' && s !== 'puff')
  },
  onSpray(e, w, d: Droplet) {
    const s = e.state
    if (s === 'wait' || s === 'beaten') return false
    const v = e.vars
    if (s === 'intro' || s === 'shrink') {
      v.flinch = 8
      return true
    }
    const open = s === 'pant' || s === 'puff'
    const floor = stageFloor(e, v.stage)
    washRival(e, w, d, open ? 1 : CHIP, open ? floor : floor + 1)
    if (Math.floor(w.tick / 4) % 2 === 0) fx(w, 'drip', d.x, d.y, 1)
    if (!open) {
      sfxEvery(w, 'bump', 16)
    } else if (e.hp > floor) {
      sfxEvery(w, 'sprayHit', 5)
    } else if (v.stage < 3) {
      shrink(e, w)
    } else {
      v.cy = v.floor - HIGH[3]
      rivalFall(e, w, NUMBER, 'NIMBUS NICK IS RAINED OUT!', 'nick_', 'champion', 5000)
      fx(w, 'drip', v.cx, v.cy + 8, 10)
      // From now on he is scenery, behind Maxx and the door. A puff is often finished in a
      // corner, which can be the one by the way on: he drifts out to vars.restX, in plain view.
      e.z = -1
      v.restX = clamp(v.cx, v.ax0 + REST_ROOM, v.ax1 - REST_ROOM)
    }
    return true
  },
})

