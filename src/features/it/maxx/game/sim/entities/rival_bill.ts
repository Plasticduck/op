// BUCKET BILL of Bucket Bros. Driveway Wash: secret rival 1, the gentlest. A dented tin
// bucket on stubby legs, a sponge for a hat, a wire handle for eyebrows. Also the helpers both
// rivals of this slice share (the arena, the washing, the fall); rival_streaks.ts imports them.
//
//   bill         props: left (tile column of the arena's left wall; default: 14 columns left
//                of where he is placed), hp (210).
//   bill_sponge  a wet sponge he lobs. Spray it out of the air (+50) or step out from under it.
//   bill_wave    the low dirty wave he sloshes along the floor. Jump it; water goes over it.
//
// THE FIGHT. He waits until Maxx is inside the arena, then: versus card, camera locked.
// Each round is a string of attacks that ends in a slosh, and a slosh empties him:
//   hop     squashes down (hopTell) with a ring where he will land (vars.tx), then
//           bounces there in an arc. He lands where Maxx stood when the squash began,
//           never nearer a wall than POCKET (his middle 64 px from it, so Maxx always fits
//           in the corner beside him) and never more than 230 px away.
//   lob     reaches into himself (lobTell), then lobs 2 or 3 sponges, each at where Maxx
//           stands as it leaves his hand. Too close for that, he first hops back. With Maxx
//           right at his hand (over his head) a sponge is held, and dropped from the volley
//           after HOLD_MAX ticks: never thrown into his face.
//   slosh   leans back (sloshTell), flops forward and pours a wave the way he faces.
//           Then he is empty: 'dizzy' for 90 ticks, harmless, and water counts in full.
// Never a new attack while a sponge is still flying. Outside 'dizzy' water counts CHIP (a
// twentieth). He gets cleaner, quicker and more rattled at 2/3 and 1/3 of his bar, and if
// that third cost Maxx any shine a soap bubble (core kind 'bubble') floats up on the far side.
// Maxx on his head (or Sir Streaks's), falling onto it or with the rival rising into him, is
// hopped off sideways unhurt (rivalTouch), never refilling his hover; any other touch while he
// is dangerous costs a pip. The fall: flag, jingle, banner, camera freed; then he is knocked
// head over heels out to at least REST_ROOM from both walls and lies there as scenery (z -1).
//
// FOR THE RENDERER (box 40 x 50, feet on vars.floor, facing = the way he looks):
//   wait      before the fight                 intro     80 ticks, taunting
//   idle      between attacks                  hopTell   squashed; ring at vars.tx
//   (every tell lasts vars.tellT ticks, set on its first tick)
//   hop       in the air, stateT of vars.hopT  land      14 ticks of squash
//   lobTell   digging for a sponge             lob       throwing; vars.throwT counts up from a
//                                                       throw, vars.n sponges still to come
//   sloshTell leaning back                     slosh     16 ticks, flopped forward, pouring
//   dizzy     empty, stars                     recover   26 ticks, shakes, fills up again
//   beaten    for good: upside down, spotless (stateT runs on); vars.arrive is the stateT he
//             landed at his resting place (0 while flying there)
// vars.flinch > 0 for 8 ticks after water hit him, vars.rattle > 0 for 40 ticks after he lost a
// third, vars.bonk > 0 for 10 ticks after Maxx was hopped off his head. Dirt stage:
// rivalPhase(e) 0 (dirty), 1, 2 (nearly clean); beaten is spotless.
//   bill_sponge 16 x 12 (z 1), spins as it flies; vars.tx, vars.fy = where it lands, vars.n =
//               its flight in ticks.   bill_wave 34 x 22 (z 1), facing = its way.
import { MAX_PIPS, TILE, VIEW_W } from '../../contract'
import {
  addScore,
  banner,
  clearBoss,
  countAlive,
  fx,
  getFlag,
  hurtPlayer,
  jingle,
  kill,
  lockCamera,
  moveBody,
  overlaps,
  playerCx,
  propNum,
  pushPlayer,
  registerEntity,
  rumble,
  setBoss,
  setBox,
  setFlag,
  setState,
  sfx,
  sfxEvery,
  shake,
  shoot,
  spawn,
  unlockCamera,
  versus,
} from '../api'
import type { Droplet, Entity, MoveOpts, TouchSide, World } from '../types'

/* ------------------------------------------------------------------ */
/* Shared by the rivals of this slice                                  */
/* ------------------------------------------------------------------ */

/** A rival's arena is one screen: 20 columns, the outer two meant to be wall. */
export const ARENA_COLS = 20
export const RIVALS_FLAG = 'rivalsBeaten'
/** Share of a droplet that counts outside the wash window. */
export const CHIP = 0.05
/** A beaten rival comes to rest with his middle at least this far from either wall. */
export const REST_ROOM = 4 * TILE
const STEP = 1 / 60

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * For init, after setBox: work out the arena from where the rival stands (`homeCol` is the
 * arena column his legend character goes in) or from props.left, and remove him if the
 * flag says he was beaten on an earlier attempt. Sets vars.cam (the screen's left edge),
 * vars.ax0 / vars.ax1 (the open floor between the walls) and vars.floor.
 */
export function arenaInit(e: Entity, w: World, homeCol: number, number: number): void {
  const col = Math.floor((e.x + e.w / 2) / TILE)
  const left = Math.round(propNum(e, 'left', col - homeCol))
  const v = e.vars
  v.cam = left * TILE
  v.ax0 = (left + 1) * TILE
  v.ax1 = (left + ARENA_COLS - 1) * TILE
  v.floor = e.y + e.h
  v.soak = 0
  v.flinch = 0
  v.rattle = 0
  v.bonk = 0
  v.grace = 0
  v.safe = 1
  v.inT = 0
  e.gravity = 0
  e.collides = false
  e.state = 'wait'
  if (getFlag(w, RIVALS_FLAG) >= number) kill(e)
}

/** While 'wait': true once Maxx has stood inside the arena for a third of a second. */
export function fightBegins(e: Entity, w: World): boolean {
  const v = e.vars
  const px = playerCx(w)
  if (w.player.state !== 'normal' || px < v.ax0 + 24 || px > v.ax1 - 8) {
    v.inT = 0
    return false
  }
  return ++v.inT >= 20
}

/** Every tick of a fight: the bar, the camera, Maxx kept between the walls, the little timers. */
export function fightTick(e: Entity, w: World, name: string): void {
  const v = e.vars
  setBoss(w, name, e.hp, e.maxHp)
  // Coming back through a door drops the lock: put it on again.
  if (!w.camBounds) lockCamera(w, v.cam, v.cam + VIEW_W)
  const p = w.player
  // An arena built with a doorway instead of a wall still has to hold him.
  if (p.x < v.ax0) pushPlayer(w, Math.min(6, v.ax0 - p.x))
  else if (p.x + p.w > v.ax1) pushPlayer(w, -Math.min(6, p.x + p.w - v.ax1))
}

/** The renderer's little timers, counted down first thing every tick whatever the state. */
export function rivalTimers(e: Entity): void {
  const v = e.vars
  if (v.flinch > 0) v.flinch--
  if (v.rattle > 0) v.rattle--
  if (v.bonk > 0) v.bonk--
}

/**
 * Set e.harmful for this tick. A rival that turns dangerous while Maxx is standing in him
 * (he was being washed a moment ago) gives him up to 45 ticks to step out first.
 */
export function setHarm(e: Entity, w: World, dangerous: boolean): void {
  const v = e.vars
  if (!dangerous) {
    v.grace = 0
    v.safe = 1
    e.harmful = false
    return
  }
  if (v.safe === 1) {
    v.safe = 0
    v.grace = overlaps(e, w.player) ? 45 : 0
  }
  if (v.grace > 0 && (--v.grace === 0 || !overlaps(e, w.player))) v.grace = 0
  e.harmful = v.grace === 0
}

/** 0 while more than two thirds of the dirt is left, then 1, then 2. */
export function rivalPhase(e: Entity): number {
  return e.hp * 3 > e.maxHp * 2 ? 0 : e.hp * 3 > e.maxHp ? 1 : 2
}

/** Water on a rival: `share` of the droplet counts. True when that washed the last of him. */
export function soak(e: Entity, w: World, d: Droplet, share: number): boolean {
  const v = e.vars
  const before = rivalPhase(e)
  v.soak += d.power * share
  const whole = Math.floor(v.soak)
  if (whole > 0) {
    v.soak -= whole
    e.hp = Math.max(0, e.hp - whole)
  }
  v.flinch = 8
  fx(w, 'splash', d.x, d.y, 1)
  if (e.hp > 0 && rivalPhase(e) !== before) {
    v.rattle = 40
    sfx(w, 'bossHit')
    fx(w, 'foam', e.x + e.w / 2, e.y + e.h / 2, 10)
    shake(w, 5, 2)
    rumble(w, 0.4, 0.4, 160)
    // A third of him washed off: if it cost Maxx some shine, a soap bubble floats up out of
    // the foam on the far side of the arena, at head height, to give one back.
    if (w.player.pips < MAX_PIPS) {
      const left = e.x + e.w / 2 > (v.ax0 + v.ax1) / 2
      spawn(w, 'bubble', left ? v.ax0 + 3 * TILE : v.ax1 - 3 * TILE, v.floor - 34)
      sfx(w, 'pop')
    }
  }
  return e.hp <= 0
}

/** How deep into a rival's top Maxx's feet may be and still count as on his head. */
const HEAD = 14
const HOP_OFF_VY = 260
const HOP_OFF_VX = 230
/**
 * The fastest a rival's top is taken to rise (px/s). Sir Streaks changes the shape of his box
 * between states with no real motion (standing, a high dash lifted off the floor, a low dash or a
 * skid, stuck in the wall): read as a rise, the top jumping 28 to 40 px in one tick threw Maxx
 * about 2000 px into the sky. No rival really rises faster (Bill's hop leaves the floor at 490 to
 * 590 px/s, and the hop off still outruns it).
 */
const RISE_MAX = 500

/**
 * Maxx on a rival's head (coming down on it, or the rival rising into his feet) is hopped off it
 * to the side and nothing else: no wash, no hit. The hop is small and sideways so he is back on
 * the floor beside the rival in about half a second, never kept up in the air for the next
 * attack, and always quicker upward than a rival rising under him. It does not give back his hover.
 */
export function rivalTouch(e: Entity, w: World, side: TouchSide): boolean {
  if (e.state === 'beaten') return false
  const p = w.player
  const rise = Math.min(RISE_MAX, (e.py - e.y) / STEP)
  const head = side === 'stomp' || (p.y + p.h <= e.y + HEAD && (rise > 0 || p.vy >= 0))
  if (!head) return false
  pushPlayer(w, 0, e.y - (p.y + p.h))
  const cx = p.x + p.w / 2
  const v = e.vars
  // On the way he was going (jumping over him carries on over), else off the side his middle
  // is on; never into a wall right there.
  let away = Math.abs(p.vx) > 40 ? (p.vx < 0 ? -1 : 1) : cx < e.x + e.w / 2 ? -1 : 1
  if ((away < 0 ? cx - v.ax0 : v.ax1 - cx) < 40) away = -away
  p.vy = Math.min(-HOP_OFF_VY, -rise - 120)
  p.vx = away * Math.max(HOP_OFF_VX, Math.abs(p.vx))
  p.onGround = false
  p.coyote = 0
  p.jumping = false
  p.jumpCut = false
  p.ridingId = 0
  v.bonk = 10
  sfxEvery(w, 'spring', 6)
  return true
}

/** The fall: the flag (so the way on opens and a retry finds him gone), the jingle, the camera let go. */
export function rivalDown(e: Entity, w: World, number: number, text: string, mine: string): void {
  e.hp = 0
  e.harmful = false
  e.vars.flinch = 0
  e.vars.rattle = 0
  setState(e, 'beaten')
  // He takes his bow (or his sigh) toward Maxx, and from now on he is scenery: behind Maxx and
  // the door. He ends up at least REST_ROOM from both walls (vars.restX), in plain view and
  // clear of the doorways; vars.arrive is the stateT he got there (0 while on his way).
  const v = e.vars
  e.facing = playerCx(w) < e.x + e.w / 2 ? -1 : 1
  e.z = -1
  v.fromX = e.x + e.w / 2
  v.fromY = e.y
  v.restX = clamp(v.fromX, v.ax0 + REST_ROOM, v.ax1 - REST_ROOM)
  v.arrive = Math.abs(v.restX - v.fromX) < 2 ? 1 : 0
  setFlag(w, RIVALS_FLAG, Math.max(getFlag(w, RIVALS_FLAG), number))
  clearBoss(w)
  unlockCamera(w)
  jingle(w, 'rivalDown')
  sfx(w, 'bossDown')
  banner(w, text, 150)
  const cx = e.x + e.w / 2
  addScore(w, 2000, cx, e.y - 14)
  fx(w, 'sparkle', cx, e.y + e.h / 2, 14)
  fx(w, 'confetti', cx, e.y, 18)
  rumble(w, 0.5, 0.7, 320)
  shake(w, 8, 3)
  // Whatever he had in the air (kinds starting `mine`) goes with him.
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (o.dead || !o.kind.startsWith(mine)) continue
    kill(o)
    fx(w, 'splash', o.x + o.w / 2, o.y + o.h / 2, 4)
  }
}

/* ------------------------------------------------------------------ */
/* Bucket Bill                                                         */
/* ------------------------------------------------------------------ */

const NAME = 'BUCKET BILL'
const NUMBER = 1
const HOME_COL = 14
const BW = 40
const BH = 50
/** The gentlest: a shorter bar than Sir Streaks's 250. */
const HP = 210

// By phase: 0 dirty, 1, 2 nearly clean.
const IDLE_T = [34, 28, 22]
const HOP_TELL = [30, 27, 24]
const HOP_T = [46, 42, 38]
const HOP_HEIGHT = 96
const HOP_MAX = 230
/** His middle never lands nearer a wall than this, so the corner is never a trap. */
const POCKET = 64
const LAND_T = 14
const LOB_TELL = [28, 26, 24]
const LOB_N = [2, 3, 3]
const LOB_GAP = [42, 36, 32]
const LOB_FLIGHT = [56, 52, 48]
const LOB_END = 22
/** Nearer than this he hops back before lobbing, so there is room to step out from under a sponge. */
const LOB_ROOM = 96
const LOB_BACK = 190
/** A sponge is held while Maxx is this close to the hand, at most HOLD_MAX ticks, then dropped from the volley. */
const HAND_ROOM = 20
const HOLD_MAX = 40
const SLOSH_TELL = [48, 44, 40]
const SLOSH_T = 16
const SLOSH_POUR = 3
const WAVE_SPEED = [190, 215, 240]
const DIZZY_T = 90
const RECOVER_T = 26
const INTRO_T = 80
const FALL_HOP_T = 36
const FALL_HOP_H = 44
const SPONGE_GRAVITY = 0.45
const GRAV = 2300

const FIRST = ['hop', 'slosh']
const ROUNDS = [
  ['lob', 'hop', 'slosh'],
  ['hop', 'lob', 'hop', 'slosh'],
  ['hop', 'hop', 'lob', 'hop', 'slosh'],
]

const middle = (e: Entity): number => e.x + e.w / 2

function face(e: Entity, w: World): void {
  const dx = playerCx(w) - middle(e)
  if (dx !== 0) e.facing = dx < 0 ? -1 : 1
}

function nextAttack(e: Entity): void {
  const v = e.vars
  let list = v.round < 0 ? FIRST : ROUNDS[v.round]
  if (v.step >= list.length) {
    v.round = rivalPhase(e)
    v.step = 0
    list = ROUNDS[v.round]
  }
  const what = list[v.step++]
  setState(e, what === 'hop' ? 'hopTell' : what === 'lob' ? 'lobTell' : 'sloshTell')
}

/** Where a hop back would land: LOB_BACK away from Maxx on Bill's own side, as far as the wall allows. */
function backTarget(e: Entity, w: World): number {
  const v = e.vars
  const px = playerCx(w)
  const side = middle(e) >= px ? 1 : -1
  return clamp(px + side * LOB_BACK, v.ax0 + POCKET, v.ax1 - POCKET)
}

/** Is Maxx well away from where a sponge leaves Bill's hand? */
function handClear(e: Entity, w: World): boolean {
  const p = w.player
  const hx = middle(e) + (playerCx(w) < middle(e) ? -12 : 12)
  const hy = e.y - 10
  return hx < p.x - HAND_ROOM || hx > p.x + p.w + HAND_ROOM || hy < p.y - HAND_ROOM || hy > p.y + p.h + HAND_ROOM
}

function throwSponge(e: Entity, w: World, phase: number): void {
  const v = e.vars
  face(e, w)
  const sx = middle(e) + e.facing * 12
  const sy = e.y - 4
  const n = LOB_FLIGHT[phase]
  const g = SPONGE_GRAVITY * GRAV
  // moveBody adds gravity before it moves, so n ticks drop by vy n dt + g dt^2 n (n + 1) / 2.
  const vy = (v.floor - sy - (g * STEP * STEP * n * (n + 1)) / 2) / (n * STEP)
  const vx = clamp((playerCx(w) - sx) / (n * STEP), -430, 430)
  const s = shoot(w, 'bill_sponge', sx, sy, vx, vy)
  if (s) {
    // Where it comes down, for the drip mark on the floor.
    s.vars.tx = sx + vx * n * STEP
    s.vars.fy = v.floor
    s.vars.n = n
    sfx(w, 'mudThrow')
  }
  v.throwT = 0
}

registerEntity('bill', {
  boss: true,
  alwaysActive: true,
  init(e, w) {
    setBox(e, BW, BH)
    e.hp = Math.max(3, Math.round(propNum(e, 'hp', HP)))
    e.maxHp = e.hp
    const v = e.vars
    v.round = -1
    v.step = 0
    v.tx = e.x + e.w / 2
    v.x0 = v.tx
    v.hopT = HOP_T[0]
    v.away = 0
    v.backed = 0
    v.throwT = 99
    v.next = 1
    v.n = 0
    v.gap = LOB_GAP[0]
    v.tellT = HOP_TELL[0]
    v.waveV = WAVE_SPEED[0]
    arenaInit(e, w, HOME_COL, NUMBER)
  },
  update(e, w) {
    const v = e.vars
    rivalTimers(e)
    if (e.state === 'wait') {
      face(e, w)
      if (fightBegins(e, w)) setState(e, 'intro')
      return
    }
    if (e.state === 'beaten') {
      if (v.arrive === 0) {
        // Knocked head over heels out into the open: a hop that lands him on his head.
        const u = Math.min(1, e.stateT / FALL_HOP_T)
        e.x = v.fromX + (v.restX - v.fromX) * u - e.w / 2
        e.y = v.fromY + (v.floor - e.h - v.fromY) * u - 4 * FALL_HOP_H * u * (1 - u)
        if (u >= 1) {
          v.arrive = e.stateT
          sfx(w, 'bump')
          fx(w, 'dust', middle(e), v.floor, 5)
        }
      } else {
        // Beaten in mid-hop where he stands: he comes down where he is.
        e.y = Math.min(v.floor - e.h, e.y + 7)
      }
      return
    }
    fightTick(e, w, NAME)
    const phase = rivalPhase(e)
    const t = e.stateT
    switch (e.state) {
      case 'intro':
        face(e, w)
        if (t === 1) {
          versus(w, e, NAME, 'A BUCKET AND A DREAM.')
          lockCamera(w, v.cam, v.cam + VIEW_W)
        }
        if (t >= INTRO_T) setState(e, 'idle')
        break
      case 'idle':
        face(e, w)
        // Never a new attack while a sponge is still in the air: one thing to read at a time.
        if (t >= IDLE_T[phase] && (countAlive(w, 'bill_sponge') === 0 || t > 120)) nextAttack(e)
        break
      case 'hopTell':
        if (t === 1) {
          const cx = middle(e)
          const want = v.away > 0 ? backTarget(e, w) : clamp(playerCx(w), v.ax0 + POCKET, v.ax1 - POCKET)
          v.x0 = cx
          v.tx = clamp(cx + clamp(want - cx, -HOP_MAX, HOP_MAX), v.ax0 + POCKET, v.ax1 - POCKET)
          v.hopT = HOP_T[phase]
          v.tellT = HOP_TELL[phase]
          if (v.away === 0) face(e, w)
          sfx(w, 'spring')
        }
        if (t >= v.tellT) {
          setState(e, 'hop')
          sfx(w, 'jump')
        }
        break
      case 'hop': {
        const u = Math.min(1, t / v.hopT)
        e.x = v.x0 + (v.tx - v.x0) * u - e.w / 2
        e.y = v.floor - e.h - 4 * HOP_HEIGHT * u * (1 - u)
        if (u >= 1) {
          setState(e, 'land')
          sfx(w, 'stomp')
          sfx(w, 'bump')
          shake(w, 5, 2)
          rumble(w, 0.45, 0.3, 110)
          fx(w, 'dust', middle(e), v.floor, 6)
        }
        break
      }
      case 'land':
        if (t >= LAND_T) {
          // A hop back was only to make room: the sponges follow at once.
          if (v.away > 0) {
            v.away = 0
            setState(e, 'lobTell')
          } else {
            setState(e, 'idle')
          }
        }
        break
      case 'lobTell':
        if (t === 1) {
          face(e, w)
          const cx = middle(e)
          const px = playerCx(w)
          if (v.backed === 0 && Math.abs(px - cx) < LOB_ROOM && Math.abs(backTarget(e, w) - px) >= Math.abs(px - cx) + 40) {
            v.backed = 1
            v.away = 1
            setState(e, 'hopTell')
            break
          }
          v.tellT = LOB_TELL[phase]
          sfx(w, 'pop')
        }
        if (t >= v.tellT) {
          setState(e, 'lob')
          v.n = LOB_N[phase]
          v.gap = LOB_GAP[phase]
        }
        break
      case 'lob':
        v.throwT++
        if (t === 1) v.next = 1
        if (v.n > 0 && t >= v.next) {
          // Never into Maxx's face: with him right at the hand (over Bill's head, say) the sponge
          // waits, and after a while it is not thrown at all.
          const clear = handClear(e, w)
          if (clear) throwSponge(e, w, phase)
          if (clear || t >= v.next + HOLD_MAX) {
            v.n--
            v.next = t + v.gap
          }
        } else if (v.n === 0 && v.throwT >= LOB_END) {
          v.backed = 0
          setState(e, 'idle')
        }
        break
      case 'sloshTell':
        if (t === 1) {
          face(e, w)
          v.tellT = SLOSH_TELL[phase]
          v.waveV = WAVE_SPEED[phase]
          sfx(w, 'pipe')
        }
        if (t >= v.tellT) setState(e, 'slosh')
        break
      case 'slosh':
        if (t === SLOSH_POUR) {
          const wave = spawn(w, 'bill_wave', middle(e) + e.facing * (e.w / 2 + 17), v.floor)
          if (wave) {
            wave.facing = e.facing
            wave.vx = e.facing * v.waveV
            wave.vars.x0 = v.ax0
            wave.vars.x1 = v.ax1
          }
          sfx(w, 'splat')
          shake(w, 4, 2)
          fx(w, 'mud', middle(e) + e.facing * e.w, v.floor - 8, 8, e.facing)
        }
        if (t >= SLOSH_T) {
          setState(e, 'dizzy')
          sfx(w, 'bump')
        }
        break
      case 'dizzy':
        if (t % 24 === 1) fx(w, 'star', middle(e), e.y - 8, 1)
        if (t >= DIZZY_T) setState(e, 'recover')
        break
      case 'recover':
        if (t === 10) {
          sfx(w, 'pop')
          fx(w, 'bubble', middle(e), e.y, 4)
        }
        if (t >= RECOVER_T) setState(e, 'idle')
        break
    }
    const s = e.state
    setHarm(e, w, s !== 'intro' && s !== 'dizzy' && s !== 'recover')
  },
  onSpray(e, w, d) {
    if (e.state === 'wait' || e.state === 'beaten') return false
    if (e.state === 'intro') return true
    const open = e.state === 'dizzy'
    if (soak(e, w, d, open ? 1 : CHIP)) rivalDown(e, w, NUMBER, 'BUCKET BILL IS SPOTLESS!', 'bill_')
    else if (open) sfxEvery(w, 'sprayHit', 5)
    else sfxEvery(w, 'bump', 16)
    return true
  },
  onTouch: rivalTouch,
})

const SPONGE_MOVE: MoveOpts = { solids: false, conveyor: false, oneWay: false }

registerEntity('bill_sponge', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 16, 12)
    e.harmful = true
    e.gravity = SPONGE_GRAVITY
    e.z = 1
  },
  update(e, w) {
    moveBody(e, w, SPONGE_MOVE)
    if (!e.onGround && e.hitWall === 0 && !e.hitCeil) return
    kill(e)
    fx(w, 'splash', e.x + e.w / 2, e.y + e.h, 5)
    sfxEvery(w, 'splat', 4)
  },
  onSpray(e, w) {
    kill(e)
    fx(w, 'splash', e.x + e.w / 2, e.y + e.h / 2, 6)
    fx(w, 'foam', e.x + e.w / 2, e.y + e.h / 2, 3)
    addScore(w, 50, e.x + e.w / 2, e.y - 4)
    sfx(w, 'pop')
    return true
  },
  onTouch(e, w) {
    hurtPlayer(w, { fromX: e.x + e.w / 2 })
    kill(e)
    fx(w, 'splash', e.x + e.w / 2, e.y + e.h / 2, 5)
    return true
  },
})

registerEntity('bill_wave', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 34, 22)
    e.harmful = true
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.vars.x0 = -1e9
    e.vars.x1 = 1e9
  },
  update(e, w) {
    e.x += e.vx * STEP
    const spent = e.vx === 0 || e.stateT > 360 || (e.vx < 0 ? e.x <= e.vars.x0 : e.x + e.w >= e.vars.x1)
    if (!spent) return
    kill(e)
    fx(w, 'splash', e.vx < 0 ? e.x : e.x + e.w, e.y + e.h / 2, 8)
    fx(w, 'mud', e.vx < 0 ? e.x : e.x + e.w, e.y + e.h / 2, 4)
    sfxEvery(w, 'splat', 6)
  },
})
