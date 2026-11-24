// SIR STREAKS of Streak City Express: secret rival 2. A tall squeegee knight, absurdly proud.
//
//   streaks        props: left (tile column of the arena's left wall; default: 15 columns
//                  left of where he is placed), hp (260).
//   streaks_blade  the wiper blade he throws. It skims the floor out and back like a
//                  boomerang: jump it both times. Water goes over it.
//   streaks_slick  the wet streak a low dash leaves. While it lasts the plain ground ('#')
//                  under it is slick ('I'); it puts back exactly what was there when it dries
//                  (300 ticks), wherever Maxx is. Nothing but '#' is ever touched.
//
// THE FIGHT. He waits until Maxx is inside the arena, then: versus card, camera locked.
// Each round: one thrown blade, then one dash (two once a third of him is clean).
//   throw   winds up (throwTell), throws; the blade flies up to 420 px, hangs for 6 ticks
//           and comes back to his hand. He never dashes while a blade is out.
//   dash    his stance says which for the whole tell (vars.high): crouched = a LOW slide
//           along the floor (jump it), raised = a HIGH flying charge 64 to 108 px up (stay
//           on the ground, or hover above it). The very first dash is low. A low dash
//           leaves a slick streak.
//           The last dash of a round ends in the wall: 'stuck' for 100 ticks, harmless,
//           and water counts in full. An earlier one is always low and skids to a stop
//           84 px short of the wall ('skid', 'turn'); then he faces Maxx and goes again.
//           A dash that starts less than 200 px from the wall it faces, or with Maxx less
//           than 200 px from it, always ends in it: he never skids to a halt where Maxx is
//           coming down from jumping him.
//           Stuck in the corner Maxx stands in, he takes the room: Maxx is eased out toward the
//           open floor (3 px a tick) while he is stuck or recovering.
// Outside 'stuck' water counts CHIP (a twentieth). He gets cleaner, quicker and more rattled
// at 2/3 and 1/3, with a soap bubble for a Maxx missing shine (see rival_bill.ts), and Maxx on
// his head is hopped off sideways unhurt. The fall: flag, jingle, banner, camera freed, his
// blade gone; then he glides on his polish out to at least REST_ROOM from both walls and bows.
//
// FOR THE RENDERER (vars.cx is his middle, vars.floor his feet; facing = the way he looks):
//   wait, intro (90), pace       standing, 30 x 68
//   throwTell                    winding up, blade in the back hand, for vars.tellT ticks
//   throw                        arm out, blade away (vars.blade is its id)
//   catch                        10 ticks
//   dashTell                     vars.high 0 crouched / 1 raised, for vars.tellT ticks
//   dash                         low: 56 x 36 on the floor. high: 56 x 44, 64 px up
//   skid (14), turn (12)         after a dash that stopped short
//   stuck                        34 x 64 against the wall he faces, for vars.stuckT ticks
//   recover (28)                 pops free, a step back from the wall
//   beaten                       for good: polished, standing 30 x 68 (stateT runs on). He
//                                glides upright until vars.arrive (the stateT he got to his
//                                place, 0 on the way), then bows
// vars.flinch > 0 for 8 ticks after water hit him, vars.rattle > 0 for 40 ticks after he lost a
// third, vars.bonk > 0 for 10 ticks after Maxx was hopped off his head. Dirt stage: rivalPhase(e)
// from rival_bill.ts. The dash telegraph is drawn at the height he will come through:
// vars.floor - 18 for a low dash, vars.floor - 86 for a high one.
//   streaks_blade 28 x 10, 8 px off the floor (z 1). vars.back 1 on the way home, vars.dir.
//   streaks_slick spans the tiles vars.tx0..vars.tx1 of row vars.ty; vars.ttl counts down.
import { TILE, VIEW_W } from '../../contract'
import { entityById, fx, kill, lockCamera, overlaps, playerCx, propNum, pushPlayer, rand, registerEntity, rumble, setBox, setState, setTile, sfx, sfxEvery, shake, spawn, tileAt, versus } from '../api'
import type { Entity, World } from '../types'
import { CHIP, arenaInit, fightBegins, fightTick, rivalDown, rivalPhase, rivalTimers, rivalTouch, setHarm, soak } from './rival_bill'

const NAME = 'SIR STREAKS'
const NUMBER = 2
const HOME_COL = 15
const STEP = 1 / 60

const HP = 260
const STAND_W = 30
const STAND_H = 68
const DASH_W = 56
const LOW_H = 36
const HIGH_H = 44
const HIGH_LIFT = 64
const STUCK_W = 34
const STUCK_H = 64

// By phase: 0 streaky, 1, 2 nearly polished.
const PACE_T = [40, 32, 26]
const THROW_TELL = [34, 30, 26]
const BLADE_SPEED = [320, 350, 380]
const BLADE_RANGE = 420
const BLADE_HANG = 6
const CATCH_T = 10
const DASH_TELL = [44, 38, 32]
const DASH_SPEED = [440, 480, 520]
const DASHES = [1, 2, 2]
/** A dash that is not the round's last stops this far short of the wall ... */
const SHORT_STOP = 84
/** ... unless it starts this close to it: then it ends in it. */
const SHORT_MIN = 200
const SKID_T = 14
const TURN_T = 12
const STUCK_T = [100, 100, 92]
const RECOVER_T = 28
const INTRO_T = 90
const SLICK_TTL = 300
/** Pixels a tick Maxx is eased out of a stuck Streaks. */
const EASE_OUT = 3
/** Pixels a tick he glides to where he takes his bow. */
const GLIDE = 4

function pose(e: Entity, width: number, height: number, lift = 0): void {
  const v = e.vars
  e.w = width
  e.h = height
  e.x = v.cx - width / 2
  e.y = v.floor - lift - height
}

function face(e: Entity, w: World): void {
  const dx = playerCx(w) - e.vars.cx
  if (dx !== 0) e.facing = dx < 0 ? -1 : 1
}

/** The wall he is facing: the edge of the open floor on that side. */
const wallAhead = (e: Entity): number => (e.facing > 0 ? e.vars.ax1 : e.vars.ax0)

/* ---- the slick streak ---- */

/** Only plain ground goes slick: the renderer draws the streak over it as the ground it really is. */
function canSlick(w: World, tx: number, ty: number): boolean {
  return tileAt(w, tx, ty) === '#'
}

function wet(s: Entity, w: World, tx: number): void {
  const sv = s.vars
  if (!canSlick(w, tx, sv.ty)) return
  sv['c' + tx] = tileAt(w, tx, sv.ty).charCodeAt(0)
  setTile(w, tx, sv.ty, 'I')
}

/** Put back every tile a streak made slick. */
function dry(s: Entity, w: World): void {
  const sv = s.vars
  for (let tx = sv.tx0; tx <= sv.tx1; tx++) {
    const code = sv['c' + tx]
    if (code > 0 && tileAt(w, tx, sv.ty) === 'I') setTile(w, tx, sv.ty, String.fromCharCode(code))
  }
}

/** The floor tile under his heels turns slick. One streak entity holds them all, as one unbroken run. */
function laySlick(e: Entity, w: World): void {
  const v = e.vars
  const tx = Math.floor((v.cx - e.facing * (DASH_W / 2 - 6)) / TILE)
  if (tx * TILE < v.ax0 || (tx + 1) * TILE > v.ax1) return
  let s = v.slick > 0 ? entityById(w, v.slick) : null
  if (!s) {
    s = spawn(w, 'streaks_slick', tx * TILE + TILE / 2, v.floor)
    if (!s) return
    v.slick = s.id
    s.vars.ty = Math.floor(v.floor / TILE)
    s.vars.tx0 = tx
    s.vars.tx1 = tx
    wet(s, w, tx)
  }
  const sv = s.vars
  sv.ttl = SLICK_TTL
  while (tx > sv.tx1) wet(s, w, ++sv.tx1)
  while (tx < sv.tx0) wet(s, w, --sv.tx0)
  s.x = sv.tx0 * TILE
  s.w = (sv.tx1 - sv.tx0 + 1) * TILE
}

registerEntity('streaks_slick', {
  // Always awake: it has tiles to give back, wherever the camera is.
  alwaysActive: true,
  init(e) {
    setBox(e, TILE, 4)
    e.gravity = 0
    e.collides = false
    e.vars.ttl = SLICK_TTL
    e.vars.tx0 = 0
    e.vars.tx1 = -1
    e.vars.ty = 0
  },
  update(e, w) {
    if (--e.vars.ttl > 0) return
    dry(e, w)
    kill(e)
  },
})

/* ---- the wiper blade ---- */

registerEntity('streaks_blade', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 28, 10, 8)
    e.harmful = true
    e.gravity = 0
    e.collides = false
    e.z = 1
    const v = e.vars
    v.dir = e.facing
    v.speed = BLADE_SPEED[0]
    v.turn = e.x + e.w / 2 + e.facing * BLADE_RANGE
    v.home = 0
    v.back = 0
    v.hang = 0
  },
  update(e, w) {
    const v = e.vars
    const home = v.home > 0 ? entityById(w, v.home) : null
    if (!home || home.state === 'beaten' || e.stateT > 600) {
      kill(e)
      fx(w, 'spark', e.x + e.w / 2, e.y + e.h / 2, 4)
      return
    }
    const cx = e.x + e.w / 2
    if (v.back === 0) {
      const nx = cx + v.dir * v.speed * STEP
      if ((nx - v.turn) * v.dir >= 0) {
        e.x = v.turn - e.w / 2
        v.back = 1
        v.hang = BLADE_HANG
      } else {
        e.x = nx - e.w / 2
      }
    } else if (v.hang > 0) {
      v.hang--
    } else {
      e.x -= v.dir * v.speed * STEP
      const hand = home.x + home.w / 2 + v.dir * 22
      if ((e.x + e.w / 2 - hand) * v.dir <= 0) {
        kill(e)
        home.vars.caught = 1
      }
    }
  },
})

/* ---- Sir Streaks ---- */

function throwBlade(e: Entity, w: World): void {
  const v = e.vars
  const from = v.cx + e.facing * 30
  const b = spawn(w, 'streaks_blade', from, v.floor)
  v.caught = 0
  v.blade = 0
  if (!b) return
  const far = e.facing > 0 ? v.ax1 - 16 : v.ax0 + 16
  b.facing = e.facing
  b.vars.dir = e.facing
  b.vars.speed = v.bladeV
  b.vars.turn = from + e.facing * Math.max(8, Math.min(BLADE_RANGE, (far - from) * e.facing))
  b.vars.home = e.id
  v.blade = b.id
  sfx(w, 'mudThrow')
}

function hitWall(e: Entity, w: World, phase: number): void {
  const v = e.vars
  const wall = wallAhead(e)
  v.cx = wall - (e.facing * STUCK_W) / 2
  v.stuckT = STUCK_T[phase]
  setState(e, 'stuck')
  pose(e, STUCK_W, STUCK_H)
  sfx(w, 'crumble')
  sfx(w, 'stomp')
  shake(w, 9, 3)
  rumble(w, 0.8, 0.5, 220)
  fx(w, 'debris', wall, v.floor - 56, 8, -e.facing)
  fx(w, 'star', v.cx, e.y - 6, 3)
}

registerEntity('streaks', {
  boss: true,
  alwaysActive: true,
  init(e, w) {
    setBox(e, STAND_W, STAND_H)
    e.hp = Math.max(3, Math.round(propNum(e, 'hp', HP)))
    e.maxHp = e.hp
    const v = e.vars
    v.cx = e.x + e.w / 2
    v.high = 0
    v.dashes = 0
    v.left = 0
    v.short = 0
    v.speed = DASH_SPEED[0]
    v.tellT = DASH_TELL[0]
    v.stuckT = STUCK_T[0]
    v.blade = 0
    v.bladeV = BLADE_SPEED[0]
    v.caught = 0
    v.slick = 0
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
      // He glides out into the open on his own polish, upright (and drops to the floor if he
      // was washed in mid-air), then bows: vars.arrive is the tick he got there.
      if (v.arrive === 0) {
        const d = v.restX - v.cx
        v.cx += Math.max(-GLIDE, Math.min(GLIDE, d))
        if (Math.abs(d) <= GLIDE) {
          v.cx = v.restX
          v.arrive = e.stateT
        } else if (e.stateT % 6 === 0) fx(w, 'sparkle', v.cx, v.floor - 4, 1)
      }
      pose(e, STAND_W, STAND_H, Math.max(0, v.floor - (e.y + e.h) - 8))
      return
    }
    fightTick(e, w, NAME)
    const phase = rivalPhase(e)
    const t = e.stateT
    switch (e.state) {
      case 'intro':
        face(e, w)
        if (t === 1) {
          versus(w, e, NAME, 'NEVER MISSES A SPOT. MOSTLY.')
          lockCamera(w, v.cam, v.cam + VIEW_W)
        }
        if (t >= INTRO_T) setState(e, 'pace')
        break
      case 'pace':
        face(e, w)
        if (t >= PACE_T[phase]) {
          v.left = DASHES[phase]
          setState(e, 'throwTell')
        }
        break
      case 'throwTell':
        if (t === 1) {
          face(e, w)
          v.tellT = THROW_TELL[phase]
          v.bladeV = BLADE_SPEED[phase]
          sfx(w, 'skid')
        }
        if (t >= v.tellT) setState(e, 'throw')
        break
      case 'throw':
        if (t === 1) throwBlade(e, w)
        else if (v.caught === 1 || !entityById(w, v.blade) || t > 620) {
          setState(e, 'catch')
          sfx(w, 'pop')
        }
        break
      case 'catch':
        if (t >= CATCH_T) setState(e, 'dashTell')
        break
      case 'dashTell':
        if (t === 1) {
          face(e, w)
          // A dash stops short only far from the wall ahead, and only with Maxx far from it too,
          // so he never skids to a halt right where Maxx is coming down from his jump.
          const wall = wallAhead(e)
          v.short = v.left > 1 && Math.abs(wall - v.cx) >= SHORT_MIN && Math.abs(wall - playerCx(w)) >= SHORT_MIN ? 1 : 0
          // A dash that will stop short lands on its feet, so it is never the flying one.
          v.high = v.dashes === 0 || v.short === 1 ? 0 : rand(w) < 0.5 ? 1 : 0
          v.dashes++
          v.speed = DASH_SPEED[phase]
          v.tellT = DASH_TELL[phase]
          sfx(w, 'rev')
        } else if (v.high === 0 && t % 14 === 0) {
          sfx(w, 'skid')
          fx(w, 'dust', v.cx - e.facing * 10, v.floor, 2, -e.facing)
        }
        if (t >= v.tellT) {
          v.left = v.short === 1 ? v.left - 1 : 0
          setState(e, 'dash')
          sfx(w, v.high === 1 ? 'jump' : 'freeze')
        }
        break
      case 'dash': {
        v.cx += e.facing * v.speed * STEP
        const wall = wallAhead(e)
        const gap = (wall - (v.cx + (e.facing * DASH_W) / 2)) * e.facing
        if (v.high === 0) laySlick(e, w)
        if (v.short === 1 && gap <= SHORT_STOP) {
          setState(e, 'skid')
          sfx(w, 'skid')
        } else if (gap <= 0) {
          hitWall(e, w, phase)
        }
        break
      }
      case 'skid':
        v.cx += e.facing * v.speed * (1 - t / SKID_T) * STEP
        laySlick(e, w)
        if (t % 4 === 0) fx(w, 'dust', v.cx + e.facing * 20, v.floor, 1, e.facing)
        if (t >= SKID_T) setState(e, 'turn')
        break
      case 'turn':
        if (t >= TURN_T) setState(e, 'dashTell')
        break
      case 'stuck':
        if (t % 24 === 1) fx(w, 'star', v.cx, e.y - 8, 1)
        if (t >= v.stuckT) {
          setState(e, 'recover')
          v.cx -= e.facing * 12
          sfx(w, 'pop')
          fx(w, 'dust', v.cx, v.floor, 4)
        }
        break
      case 'recover':
        if (t >= RECOVER_T) setState(e, 'pace')
        break
    }
    const s = e.state
    if (s === 'dash') pose(e, DASH_W, v.high === 1 ? HIGH_H : LOW_H, v.high === 1 ? HIGH_LIFT : 0)
    else if (s === 'skid') pose(e, DASH_W, LOW_H)
    else if (s === 'stuck') pose(e, STUCK_W, STUCK_H)
    else pose(e, STAND_W, STAND_H)
    // Stuck in the corner Maxx was standing in, he takes the room: Maxx is eased out toward the
    // open floor, so he can turn and wash him, and is clear before he is dangerous again.
    if ((s === 'stuck' || s === 'recover') && w.player.onGround && overlaps(e, w.player)) pushPlayer(w, -e.facing * EASE_OUT)
    setHarm(e, w, s !== 'intro' && s !== 'stuck' && s !== 'recover')
  },
  onSpray(e, w, d) {
    if (e.state === 'wait' || e.state === 'beaten') return false
    if (e.state === 'intro') return true
    const open = e.state === 'stuck'
    if (soak(e, w, d, open ? 1 : CHIP)) rivalDown(e, w, NUMBER, 'SIR STREAKS IS SPOTLESS!', 'streaks_blade')
    else if (open) sfxEvery(w, 'sprayHit', 5)
    else sfxEvery(w, 'bump', 16)
    return true
  },
  onTouch: rivalTouch,
})
