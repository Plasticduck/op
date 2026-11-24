// SLICK OLLIE of Slick's Lube-N-Splash: secret rival 3. A dapper green oil can with a long
// brass spout for a nose, a slicked pompadour of his own oil, a pencil moustache and a bow
// tie. Smooth, smug, slippery.
// Also the helpers both rivals of this slice share (the arena, the washing, the fall);
// rival_nick.ts imports them from here.
//
//   ollie         props: left (tile column of the arena's left wall; default: 14 columns left
//                 of where he is placed), hp (540). Legend character on the arena floor row.
//   ollie_glob    an oil glob he squirts in an arc. It lands exactly on its mark and leaves an
//                 oil slick there. Spray it out of the air (+50) or step aside. Never lands
//                 within 48 px of a wall, so the last stretch against a wall is out of reach.
//   ollie_drip    a drop he lets fall straight down from his spout, off a catwalk (through
//                 the grating he stands on, to whatever is under it). No slick.
//   ollie_puddle  the slick: two floor tiles turned to 'O' (almost no grip) for 6 seconds,
//                 then put back. Never more than 8 oily tiles at once: the oldest dries early.
//
// THE ARENA is one screen, 20 columns, the outer two wall: open floor from vars.ax0 to
// vars.ax1, flat, at vars.floor. He looks for a catwalk ('=' run of 3 or more tiles, 2 to 4
// tiles above the floor, 3 preferred) to hop onto; without one he slides instead.
//
// THE FIGHT. He waits until Maxx is inside the arena, then: versus card, camera locked.
// A round is a string of attacks with a breath ('idle') between them, ending in a refill:
//   squirt   leans back, cheeks full (squirtTell), then squirts 2 to 4 globs, each aimed at
//            where Maxx stands (every other one at where he is running to) as it leaves.
//            Nearer than 150 px to Maxx he first moonwalks back ('glide') to make room.
//   slide    winds up like a bowler (slideTell), then belly-slides along the floor to the
//            wall he faces, where he bumps and sits dizzy, harmless (slideEnd). Later rounds:
//            there and back, then there, back and there. Jump him (or stand on a catwalk).
//   hop      crouches (hopTell), jumps onto the catwalk (hop), shuffles to get his spout over
//            Maxx (perch) and lets 4 to 6 drops go (dripTell: a drop swells on his spout while
//            a mark shows where it will land), then crouches again (dropTell) and jumps down
//            beside the catwalk on Maxx's side (drop, land); if Maxx is up on the catwalk too,
//            off the far end instead, so the jump never sweeps along the catwalk through him.
//            A shadow marks each landing.
//   refill   he is empty: lifts his cap (hair and all) and tips a bottle into himself for 120
//            ticks, glugging, harmless. Then a burp (30 ticks) and the next round.
// In 'refill' and 'burp' water counts in full. Outside them it counts 15% and cannot end a
// stage. Washed down to within 35% of a stage of its end he is running dry: after one more
// attack he refills, whatever the round had left. When a stage's third goes (in a refill)
// he is 'stagger' for 84 ticks: a coat of oil comes off, his hair is less perfect, he is
// more rattled, and the next round is longer and quicker. A Maxx missing shine gets a bubble.
//
// FOR THE RENDERER (box 44 x 56 standing, 64 x 28 while sliding; feet on vars.floor or on
// the catwalk at vars.py; facing = the way he looks or slides):
//   wait        before the fight               intro      80 ticks, a bow then smug
//   idle        between attacks                glide      moonwalking back to vars.gx
//   squirtTell  leaning back, cheeks full      squirt     vars.shotT counts up from each glob
//   slideTell   the bowler wind-up, vars.tell ticks long
//   slide       on his belly                   slideEnd   30 ticks against the wall, dizzy
//   hopTell     crouched; shadow at (vars.landX, vars.landY)
//   hop         in the air, 40 ticks           perch      on the catwalk, shuffling
//   dripTell    leaning over, a drop swelling for vars.tell ticks at (vars.aimX, feet - 24);
//               its mark at (vars.aimX, vars.aimY)
//   dropTell    crouched on the catwalk; shadow at (vars.landX, vars.landY)
//   drop        in the air, 34 ticks           land       18 ticks of squash
//   refill      glugging                       burp       30 ticks
//   stagger     84 ticks, the oil coming off   beaten     for good: sitting, spotless
//               (z -1 from then on, sliding 3 px a tick out to vars.restX, at least REST_ROOM
//               from both walls)
// vars.stage is 0 (oily), 1, 2 (nearly clean); beaten is spotless. vars.flinch > 0 for a
// few ticks after water hit him. Globs leave the spout's tip, (30, -42) from his feet.
//   ollie_glob 16 x 16 (z 1): vars.tx, vars.fy = where it lands, vars.n = flight ticks.
//   ollie_drip 10 x 12 (z 1): the same three.
//   ollie_puddle: box = the oily tiles' top 6 px; vars.ttl ticks left (it blinks under 60),
//   vars.n tiles from tile column vars.tx, in row vars.ty.
import { MAX_PIPS, TILE, VIEW_W } from '../../contract'
import type { JingleId } from '../../contract'
import {
  addScore,
  banner,
  clearBoss,
  fx,
  getFlag,
  hurtPlayer,
  jingle,
  kill,
  lockCamera,
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
  setTile,
  sfx,
  sfxEvery,
  shake,
  spawn,
  tileAt,
  tileInfoAt,
  unlockCamera,
  versus,
} from '../api'
import type { Droplet, Entity, World } from '../types'

/* ------------------------------------------------------------------ */
/* Shared by the two rivals of this slice (rival_nick.ts imports them) */
/* ------------------------------------------------------------------ */

export const RIVALS_FLAG = 'rivalsBeaten'
/** A rival's arena is one screen: 20 columns, the outer two meant to be wall. */
export const ARENA_COLS = 20
export const STEP = 1 / 60
/** A beaten rival comes to rest with his middle at least this far from either wall: clear of the doorways. */
export const REST_ROOM = 4 * TILE

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * For init, after the box is placed: the arena from where the rival stands (`homeCol` is the
 * arena column his legend character goes in) or from props.left; and removal if the flag says
 * he was beaten before. Sets vars.cam (the screen's left edge), vars.ax0 / vars.ax1 (the open
 * floor between the walls) and vars.floor (his feet, which must be on the arena floor).
 */
export function arenaInit(e: Entity, w: World, homeCol: number, number: number): void {
  const col = Math.floor((e.x + e.w / 2) / TILE)
  const left = Math.round(propNum(e, 'left', col - homeCol))
  const v = e.vars
  v.cam = left * TILE
  v.ax0 = (left + 1) * TILE
  v.ax1 = (left + ARENA_COLS - 1) * TILE
  v.floor = e.y + e.h
  v.stage = 0
  v.step = 0
  v.force = 0
  v.soak = 0
  v.flinch = 0
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

/** Every tick of a fight: the bar, the camera, Maxx kept between the walls, the flinch. */
export function fightTick(e: Entity, w: World, name: string): void {
  const v = e.vars
  setBoss(w, name, e.hp, e.maxHp)
  // Coming back through a door drops the lock: put it on again.
  if (!w.camBounds) lockCamera(w, v.cam, v.cam + VIEW_W)
  const p = w.player
  // An arena built with a doorway instead of a wall still has to hold him.
  if (p.x < v.ax0) pushPlayer(w, Math.min(6, v.ax0 - p.x))
  else if (p.x + p.w > v.ax1) pushPlayer(w, -Math.min(6, p.x + p.w - v.ax1))
  if (v.flinch > 0) v.flinch--
}

/**
 * Set e.harmful for this tick. A rival that turns dangerous while Maxx is standing in him
 * (he was washing him a moment ago) gives him up to 45 ticks to step out first.
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

/**
 * Water on a rival: `share` of the droplet counts, and it never takes him below `stop` hp
 * (a rival only loses a stage in his wash window, so outside it the caller stops short).
 */
export function washRival(e: Entity, w: World, d: Droplet, share: number, stop: number): void {
  const v = e.vars
  v.soak += d.power * share
  const whole = Math.floor(v.soak)
  if (whole > 0) {
    v.soak -= whole
    e.hp = Math.max(Math.min(e.hp, stop), e.hp - whole)
  }
  v.flinch = 8
  fx(w, 'splash', d.x, d.y, 1)
}

/** The fall: the flag (so the way on opens and a retry finds him gone), the jingle, the camera let go. */
export function rivalFall(e: Entity, w: World, number: number, text: string, mine: string, tune: JingleId, points: number): void {
  e.hp = 0
  e.harmful = false
  e.vars.flinch = 0
  setState(e, 'beaten')
  setFlag(w, RIVALS_FLAG, Math.max(getFlag(w, RIVALS_FLAG), number))
  clearBoss(w)
  unlockCamera(w)
  jingle(w, tune)
  sfx(w, 'bossDown')
  banner(w, text, 150)
  const cx = e.x + e.w / 2
  addScore(w, points, cx, e.y - 14)
  fx(w, 'sparkle', cx, e.y + e.h / 2, 14)
  fx(w, 'confetti', cx, e.y, 18)
  rumble(w, 0.5, 0.7, 320)
  shake(w, 8, 3)
  // Whatever he had going (kinds starting `mine`) goes with him.
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (o.dead || !o.kind.startsWith(mine) || o.kind === mine + 'puddle') continue
    kill(o)
    fx(w, 'splash', o.x + o.w / 2, o.y + o.h / 2, 3)
  }
}

/** The first thing to stand on at or below `fromY` in the column of world x: its top, in pixels. */
export function surfaceBelow(w: World, x: number, fromY: number, floor: number): number {
  const tx = Math.floor(x / TILE)
  const last = Math.round(floor / TILE)
  for (let ty = Math.max(0, Math.floor((fromY - 1) / TILE)); ty < last; ty++) {
    const info = tileInfoAt(w, tx, ty)
    if (info.solid || info.oneWay) return ty * TILE
  }
  return floor
}

/* ------------------------------------------------------------------ */
/* Slick Ollie                                                         */
/* ------------------------------------------------------------------ */

const NAME = 'SLICK OLLIE'
const TAGLINE = 'SMOOTH OPERATOR.'
const NUMBER = 3
const HOME_COL = 14

const BW = 44
const BH = 56
const SLIDE_W = 64
const SLIDE_H = 28

/** Share of a droplet that counts outside the refill. */
const CHIP = 0.15
/** Within this share of a stage of its end, he is running dry. */
const CHIP_NOTCH = 0.35
const INTRO_T = 80
const REFILL_T = 120
const BURP_T = 30
const STAGGER_T = 84
const SLIDE_END_T = 30
const HOP_TELL_T = 36
const HOP_T = 40
const HOP_ARC = 52
const DROP_TELL_T = 32
const DROP_T = 34
const DROP_ARC = 30
const LAND_T = 18
const PERCH_SPEED = 64
/** The tip of his spout from his middle (facing right) and up from his feet. */
const SPOUT_X = 30
const SPOUT_Y = 42
/** Leaning over to drip, the tip of his spout swings down to here. */
const DRIP_X = 34
const DRIP_Y = 24
/** A slide toward a wall nearer than this would be over before it began: he goes the other way. */
const SLIDE_ROOM = 110
/** Nearer than GLIDE_IF to Maxx he moonwalks back to GLIDE_TO before he squirts: room to dodge in. */
const GLIDE_IF = 150
const GLIDE_TO = 210
const GLIDE_SPEED = 250
/** Pixels a tick he slides, beaten, out to where he rests. */
const REST_SLIDE = 3

const GLOB_G = 900
const DRIP_G = 1100
const PUDDLE_T = 360
const PUDDLE_FADE = 24
/** Most floor tiles that may be oily at once, of the arena's 18. */
const OIL_CAP = 8

const SQUIRT = 1
const SLIDE = 2
const HOP = 3
const REFILL = 4

interface Stage {
  plan: number[]
  idle: number
  squirtTell: number
  globs: number
  globGap: number
  flight: number
  slides: number
  /** Ticks of wind-up before the first slide, and before each one after it. */
  windUp: number
  rewind: number
  speed: number
  drips: number
  dripGap: number
  dripTell: number
}

// By stage: 0 oily, 1, 2 nearly clean.
const STAGES: Stage[] = [
  { plan: [SQUIRT, SLIDE, REFILL], idle: 40, squirtTell: 34, globs: 2, globGap: 24, flight: 58, slides: 1, windUp: 46, rewind: 34, speed: 380, drips: 0, dripGap: 0, dripTell: 0 },
  { plan: [SQUIRT, SLIDE, HOP, REFILL], idle: 34, squirtTell: 30, globs: 3, globGap: 22, flight: 54, slides: 2, windUp: 42, rewind: 32, speed: 420, drips: 4, dripGap: 38, dripTell: 28 },
  { plan: [SQUIRT, HOP, SLIDE, SQUIRT, REFILL], idle: 28, squirtTell: 28, globs: 4, globGap: 20, flight: 50, slides: 3, windUp: 40, rewind: 30, speed: 480, drips: 6, dripGap: 30, dripTell: 26 },
]

const middle = (e: Entity): number => e.x + e.w / 2
const feet = (e: Entity): number => e.y + e.h

function face(e: Entity, w: World): void {
  const dx = playerCx(w) - middle(e)
  if (dx !== 0) e.facing = dx < 0 ? -1 : 1
}

function stand(e: Entity, cx: number, bottom: number): void {
  e.x = cx - e.w / 2
  e.y = bottom - e.h
}

/** Change the box, feet where they are, keeping one side in place: -1 the left, 1 the right. */
function reshape(e: Entity, width: number, height: number, keep: -1 | 1): void {
  const bottom = feet(e)
  if (keep > 0) e.x += e.w - width
  e.w = width
  e.h = height
  e.y = bottom - height
}

/** Hp at which a stage ends. */
function stageFloor(e: Entity, stage: number): number {
  return stage >= 2 ? 0 : Math.round((e.maxHp * (2 - stage)) / 3)
}

/** Washed down to here, he is running dry: one more attack and he must refill. */
function chipStop(e: Entity, stage: number): number {
  return stageFloor(e, stage) + Math.round((e.maxHp / 3) * CHIP_NOTCH)
}

/**
 * Launch speeds for something that should land `n` ticks from now at (tx, fy), stepped as
 * fly() does it (gravity first, then the move).
 */
function lob(o: Entity, tx: number, fy: number, n: number, g: number): void {
  o.vars.tx = tx
  o.vars.fy = fy
  o.vars.n = n
  o.vx = (tx - middle(o)) / (n * STEP)
  o.vy = (fy - feet(o) - (g * STEP * STEP * n * (n + 1)) / 2) / (n * STEP)
}

/** One tick of a glob or drop in the air. True on the tick it lands, set down exactly on its mark. */
function fly(o: Entity, g: number): boolean {
  o.vy += g * STEP
  o.x += o.vx * STEP
  o.y += o.vy * STEP
  if (feet(o) < o.vars.fy && o.stateT < o.vars.n + 30) return false
  stand(o, o.vars.tx, o.vars.fy)
  return true
}

/** Is Maxx standing on the catwalk from px0 to px1 at height py? */
function onPerch(w: World, px0: number, px1: number, py: number): boolean {
  const p = w.player
  const cx = p.x + p.w / 2
  return p.onGround && Math.abs(p.y + p.h - py) < 1 && cx > px0 - 8 && cx < px1 + 8
}

const UPS = [3, 2, 4]

/**
 * The catwalk he will use: the run nearest Maxx (but not the one Maxx stands on, if there is
 * another), in the row closest to three tiles up. False if the arena has none.
 */
function findPerch(e: Entity, w: World): boolean {
  const v = e.vars
  const floorRow = Math.round(v.floor / TILE)
  const c0 = Math.round(v.ax0 / TILE)
  const c1 = Math.round(v.ax1 / TILE) - 1
  const px = playerCx(w)
  for (let k = 0; k < UPS.length; k++) {
    const up = UPS[k]
    const row = floorRow - up
    let best = Infinity
    let from = -1
    for (let c = c0; c <= c1 + 1; c++) {
      const on = c <= c1 && tileInfoAt(w, c, row).oneWay
      if (on && from < 0) from = c
      if (on || from < 0) continue
      if (c - from >= 3) {
        let d = Math.abs((from + c) * 0.5 * TILE - px)
        if (onPerch(w, from * TILE, c * TILE, row * TILE)) d += 10000
        if (d < best) {
          best = d
          v.px0 = from * TILE
          v.px1 = c * TILE
          v.py = row * TILE
        }
      }
      from = -1
    }
    if (best < Infinity) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Oil on the floor                                                    */
/* ------------------------------------------------------------------ */

function puddleOver(w: World, tx: number, ty: number): Entity | null {
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (o.dead || o.kind !== 'ollie_puddle' || o.vars.ty !== ty) continue
    if (tx >= o.vars.tx && tx < o.vars.tx + o.vars.n) return o
  }
  return null
}

/** A slick two tiles wide where a glob landed at world x on the floor at `fy`. */
function spill(w: World, x: number, fy: number, ax0: number, ax1: number): void {
  const ty = Math.round(fy / TILE)
  const c0 = Math.round(ax0 / TILE)
  const c1 = Math.round(ax1 / TILE) - 1
  const first = clamp(Math.floor(x / TILE) - (x % TILE < TILE / 2 ? 1 : 0), c0, c1 - 1)

  // Oil that is already there is topped up; the rest becomes this slick's own tiles.
  let from = -1
  let n = 0
  for (let tx = first; tx <= first + 1; tx++) {
    const old = puddleOver(w, tx, ty)
    if (old) {
      old.vars.ttl = PUDDLE_T
      continue
    }
    const info = tileInfoAt(w, tx, ty)
    if (!info.solid || info.grip !== 1 || info.speed !== 1 || info.conveyor !== 0 || info.bump !== 'thud') continue
    if (from < 0) from = tx
    n = tx - from + 1
  }
  if (from < 0) return

  // Always dry ground to stand on: over the cap, the oldest slicks dry up now.
  let oily = n
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) if (!ents[i].dead && ents[i].kind === 'ollie_puddle' && ents[i].vars.ttl > PUDDLE_FADE) oily += ents[i].vars.n
  for (let i = 0; i < ents.length && oily > OIL_CAP; i++) {
    const o = ents[i]
    if (o.dead || o.kind !== 'ollie_puddle' || o.vars.ttl <= PUDDLE_FADE) continue
    o.vars.ttl = PUDDLE_FADE
    oily -= o.vars.n
  }

  const p = spawn(w, 'ollie_puddle', from * TILE + TILE / 2, ty * TILE)
  if (!p) return
  p.vars.tx = from
  p.vars.ty = ty
  p.vars.n = n
  p.x = from * TILE
  p.w = n * TILE
  for (let i = 0; i < n; i++) {
    p.vars[i === 0 ? 'c0' : 'c1'] = tileAt(w, from + i, ty).charCodeAt(0)
    setTile(w, from + i, ty, 'O')
  }
}

registerEntity('ollie_puddle', {
  // Never asleep and never dropped for being off screen: it has tiles to put back.
  alwaysActive: true,
  init(e) {
    setBox(e, TILE, 6)
    e.y += 6
    e.gravity = 0
    e.collides = false
    const v = e.vars
    v.ttl = PUDDLE_T
    v.tx = 0
    v.ty = 0
    v.n = 0
    v.c0 = 0
    v.c1 = 0
  },
  update(e, w) {
    const v = e.vars
    if (--v.ttl > 0) return
    for (let i = 0; i < v.n; i++) {
      const was = i === 0 ? v.c0 : v.c1
      if (was > 0 && tileAt(w, v.tx + i, v.ty) === 'O') setTile(w, v.tx + i, v.ty, String.fromCharCode(was))
    }
    kill(e)
  },
})

/* ------------------------------------------------------------------ */
/* What he throws                                                      */
/* ------------------------------------------------------------------ */

function burst(e: Entity, w: World): void {
  kill(e)
  fx(w, 'mud', middle(e), e.y + e.h / 2, 5)
}

registerEntity('ollie_glob', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 16, 16)
    e.harmful = true
    e.gravity = 0
    e.collides = false
    e.z = 1
    const v = e.vars
    v.tx = e.x + 8
    v.fy = e.y + 16
    v.n = 1
    v.ax0 = -1e9
    v.ax1 = 1e9
  },
  update(e, w) {
    if (!fly(e, GLOB_G)) return
    burst(e, w)
    sfxEvery(w, 'splat', 4)
    spill(w, e.vars.tx, e.vars.fy, e.vars.ax0, e.vars.ax1)
  },
  onSpray(e, w) {
    burst(e, w)
    fx(w, 'splash', middle(e), e.y + e.h / 2, 5)
    addScore(w, 50, middle(e), e.y - 4)
    sfx(w, 'pop')
    return true
  },
  onTouch(e, w) {
    hurtPlayer(w, { fromX: middle(e) })
    burst(e, w)
    return true
  },
})

registerEntity('ollie_drip', {
  offscreen: 'remove',
  init(e) {
    setBox(e, 10, 12)
    e.harmful = true
    e.gravity = 0
    e.collides = false
    e.z = 1
    const v = e.vars
    v.tx = e.x + 5
    v.fy = e.y + 12
    v.n = 1
  },
  update(e, w) {
    if (!fly(e, DRIP_G)) return
    burst(e, w)
    sfxEvery(w, 'splat', 4)
  },
  onSpray(e, w) {
    burst(e, w)
    fx(w, 'splash', middle(e), e.y + e.h / 2, 3)
    sfxEvery(w, 'pop', 4)
    return true
  },
  onTouch(e, w) {
    hurtPlayer(w, { fromX: middle(e) })
    burst(e, w)
    return true
  },
})

/* ------------------------------------------------------------------ */
/* Slick Ollie                                                         */
/* ------------------------------------------------------------------ */

function squirtGlob(e: Entity, w: World, S: Stage, i: number): void {
  const v = e.vars
  const p = w.player
  let tx = playerCx(w)
  // Every other glob goes where he is running to, so running in a straight line is not the answer.
  if (i % 2 === 1) tx += clamp(p.vx * 0.5, -90, 90)
  // Never into the last stretch against a wall: running into a corner must not be a trap.
  tx = clamp(tx, v.ax0 + 48, v.ax1 - 48)
  const g = spawn(w, 'ollie_glob', spoutX(e), feet(e) - SPOUT_Y + 8)
  if (!g) return
  g.vars.ax0 = v.ax0
  g.vars.ax1 = v.ax1
  lob(g, tx, v.floor, S.flight, GLOB_G)
  v.shotT = 0
  sfx(w, 'mudThrow')
  fx(w, 'mud', middle(g), g.y, 3, e.facing)
}

/** The tip of his spout, where a drip swells and falls from. */
const spoutX = (e: Entity): number => middle(e) + e.facing * SPOUT_X

/** A drop let go from the spout: it falls straight down onto the mark. */
function letDrip(e: Entity, w: World): void {
  const v = e.vars
  const d = spawn(w, 'ollie_drip', v.aimX, feet(e) - DRIP_Y + 12)
  if (!d) return
  const n = Math.max(6, Math.round(Math.sqrt((2 * Math.max(1, v.aimY - feet(d))) / DRIP_G) * 60))
  lob(d, v.aimX, v.aimY, n, DRIP_G)
  sfx(w, 'pop')
}

function startSlideTell(e: Entity, ticks: number, dir: number): void {
  const v = e.vars
  const room = dir > 0 ? v.ax1 - (e.x + e.w) : e.x - v.ax0
  v.dir = room < SLIDE_ROOM ? -dir : dir
  e.facing = v.dir > 0 ? 1 : -1
  v.tell = ticks
  setState(e, 'slideTell')
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
  // Washed nearly dry: one more attack, then he has to refill. (So a stage the last refill did
  // not quite finish is not a long wait with the bar standing still.)
  if (what !== REFILL && e.hp <= chipStop(e, v.stage)) v.force = REFILL
  if (what === HOP && !findPerch(e, w)) what = SLIDE
  if (what === SQUIRT) {
    face(e, w)
    const px = playerCx(w)
    const away = middle(e) >= px ? 1 : -1
    v.gx = clamp(px + away * GLIDE_TO, v.ax0 + BW / 2 + 4, v.ax1 - BW / 2 - 4)
    if (Math.abs(middle(e) - px) < GLIDE_IF && Math.abs(v.gx - middle(e)) > 24) {
      setState(e, 'glide')
      sfx(w, 'skid')
    } else {
      setState(e, 'squirtTell')
    }
  } else if (what === SLIDE) {
    v.slides = S.slides
    const dx = playerCx(w) - middle(e)
    startSlideTell(e, S.windUp, dx !== 0 ? Math.sign(dx) : middle(e) < (v.ax0 + v.ax1) / 2 ? 1 : -1)
  } else if (what === HOP) {
    // Onto the catwalk; if Maxx is up there already, onto the end away from him.
    const px = playerCx(w)
    if (onPerch(w, v.px0, v.px1, v.py)) v.landX = px - v.px0 > v.px1 - px ? v.px0 + 26 : v.px1 - 26
    else v.landX = clamp(middle(e), v.px0 + 30, v.px1 - 30)
    v.landY = v.py
    v.drips = S.drips
    setState(e, 'hopTell')
  } else {
    setState(e, 'refill')
  }
}

function beaten(e: Entity, w: World): void {
  if (e.w !== BW) reshape(e, BW, BH, e.facing > 0 ? 1 : -1)
  rivalFall(e, w, NUMBER, 'SLICK OLLIE IS SPOTLESS!', 'ollie_', 'rivalDown', 3000)
  // From now on he is scenery, behind Maxx and the door. His refill mostly follows a slide into a
  // wall, which can be the one by the way on: he slides out to vars.restX, in plain view.
  e.z = -1
  e.vars.restX = clamp(middle(e), e.vars.ax0 + REST_ROOM, e.vars.ax1 - REST_ROOM)
  // The floor dries.
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (!o.dead && o.kind === 'ollie_puddle') o.vars.ttl = Math.min(o.vars.ttl, PUDDLE_FADE)
  }
}

/** A third of him has gone: the oil comes off, and the next round is the next stage's. */
function stagger(e: Entity, w: World): void {
  const v = e.vars
  v.stage++
  v.step = 0
  setState(e, 'stagger')
  const cx = middle(e)
  sfx(w, 'crumble')
  sfx(w, 'bossHit')
  fx(w, 'mud', cx, e.y + e.h / 2, 12)
  fx(w, 'foam', cx, e.y + e.h / 2, 10)
  shake(w, 6, 2)
  rumble(w, 0.4, 0.4, 180)
  // A little mercy for a Maxx who has been hit: a bubble rolls out of him.
  if (w.player.pips < MAX_PIPS) spawn(w, 'bubble', clamp(cx - e.facing * 70, v.ax0 + 40, v.ax1 - 40), v.floor - 22)
}

registerEntity('ollie', {
  boss: true,
  alwaysActive: true,
  init(e, w) {
    setBox(e, BW, BH)
    e.hp = Math.max(3, Math.round(propNum(e, 'hp', 540)))
    e.maxHp = e.hp
    const v = e.vars
    v.shots = 0
    v.shotT = 99
    v.slides = 0
    v.dir = -1
    v.tell = 0
    v.drips = 0
    v.px0 = 0
    v.px1 = 0
    v.py = 0
    v.sx = 0
    v.sy = 0
    v.landX = middle(e)
    v.landY = feet(e)
    v.aimX = middle(e)
    v.aimY = feet(e)
    v.gx = middle(e)
    v.restX = middle(e)
    arenaInit(e, w, HOME_COL, NUMBER)
  },
  update(e, w) {
    const v = e.vars
    if (e.state === 'beaten') {
      // Still slippery, he slides out sitting down.
      const d = v.restX - middle(e)
      if (Math.abs(d) <= REST_SLIDE) {
        e.x = v.restX - e.w / 2
      } else {
        e.x += d < 0 ? -REST_SLIDE : REST_SLIDE
        if (e.stateT % 6 === 0) fx(w, 'sparkle', middle(e), v.floor - 4, 1)
      }
      return
    }
    if (e.state === 'wait') {
      face(e, w)
      if (!fightBegins(e, w)) return
      setState(e, 'intro')
    }
    fightTick(e, w, NAME)
    const S = STAGES[v.stage]
    const t = e.stateT
    switch (e.state) {
      case 'intro':
        face(e, w)
        if (t === 1) {
          versus(w, e, NAME, TAGLINE)
          lockCamera(w, v.cam, v.cam + VIEW_W)
        }
        if (t >= INTRO_T) setState(e, 'idle')
        break
      case 'idle':
        face(e, w)
        if (t >= S.idle) nextAttack(e, w)
        break
      case 'glide': {
        // Backward, still facing him, smooth as you like.
        face(e, w)
        const cx = middle(e)
        const step = GLIDE_SPEED * STEP
        stand(e, cx + clamp(v.gx - cx, -step, step), v.floor)
        if (t % 6 === 0) fx(w, 'dust', middle(e), v.floor, 1)
        if (Math.abs(v.gx - middle(e)) < 0.5 || t > 90) setState(e, 'squirtTell')
        break
      }
      case 'squirtTell':
        face(e, w)
        if (t === 1) sfx(w, 'pipe')
        if (t >= S.squirtTell) {
          v.shots = 0
          v.shotT = 99
          setState(e, 'squirt')
        }
        break
      case 'squirt':
        v.shotT++
        if (v.shots < S.globs) {
          if ((t - 1) % S.globGap === 0) {
            face(e, w)
            squirtGlob(e, w, S, v.shots++)
          }
        } else if (v.shotT >= 26) {
          setState(e, 'idle')
        }
        break
      case 'slideTell':
        if (t === 1) sfx(w, 'rev')
        if (t >= v.tell) {
          // Onto his belly, nose first: the box grows forward only.
          reshape(e, SLIDE_W, SLIDE_H, v.dir > 0 ? -1 : 1)
          setState(e, 'slide')
          sfx(w, 'skid')
        }
        break
      case 'slide': {
        e.x += v.dir * S.speed * STEP
        if (t % 5 === 0) fx(w, 'dust', v.dir > 0 ? e.x : e.x + e.w, v.floor, 1, -v.dir)
        sfxEvery(w, 'skid', 18)
        const hit = v.dir > 0 ? e.x + e.w >= v.ax1 : e.x <= v.ax0
        if (hit) {
          e.x = v.dir > 0 ? v.ax1 - e.w : v.ax0
          reshape(e, BW, BH, v.dir > 0 ? 1 : -1)
          v.slides--
          setState(e, 'slideEnd')
          sfx(w, 'bump')
          shake(w, 5, 2)
          rumble(w, 0.4, 0.3, 110)
          fx(w, 'star', middle(e), e.y, 3)
        }
        break
      }
      case 'slideEnd':
        if (t >= SLIDE_END_T) {
          if (v.slides > 0) startSlideTell(e, S.rewind, -v.dir)
          else setState(e, 'idle')
        }
        break
      case 'hopTell':
        if (t === 1) {
          e.facing = v.landX < middle(e) ? -1 : 1
          sfx(w, 'spring')
        }
        if (t >= HOP_TELL_T) {
          v.sx = middle(e)
          v.sy = feet(e)
          setState(e, 'hop')
          sfx(w, 'jump')
        }
        break
      case 'hop': {
        const u = Math.min(1, t / HOP_T)
        stand(e, v.sx + (v.landX - v.sx) * u, v.sy + (v.landY - v.sy) * u - 4 * HOP_ARC * u * (1 - u))
        if (u >= 1) {
          setState(e, 'perch')
          sfx(w, 'land')
          fx(w, 'dust', middle(e), feet(e), 4)
        }
        break
      }
      case 'perch': {
        face(e, w)
        const cx = middle(e)
        // He shuffles to get his spout over Maxx's head (as far as the catwalk goes).
        let want = clamp(playerCx(w) - e.facing * DRIP_X, v.px0 + 20, v.px1 - 20)
        // Up here with him, he keeps his distance rather than walk into him.
        if (onPerch(w, v.px0, v.px1, v.py)) want = cx
        stand(e, cx + clamp(want - cx, -PERCH_SPEED * STEP, PERCH_SPEED * STEP), v.py)
        if (t < S.dripGap) break
        if (v.drips > 0) {
          v.aimX = middle(e) + e.facing * DRIP_X
          // Through the grating he stands on, down to whatever is under it.
          v.aimY = surfaceBelow(w, v.aimX, feet(e) + TILE, v.floor)
          v.tell = S.dripTell
          setState(e, 'dripTell')
        } else {
          // Down on Maxx's side of the catwalk, if there is floor there. If Maxx is up here with
          // him, off the other end: the jump must not sweep along the catwalk through him.
          let side = playerCx(w) < cx ? -1 : 1
          if (onPerch(w, v.px0, v.px1, v.py)) side = -side
          const left = v.px0 - 50
          const right = v.px1 + 50
          const ok = side < 0 ? left >= v.ax0 + 30 : right <= v.ax1 - 30
          v.landX = clamp((side < 0) === ok ? left : right, v.ax0 + 30, v.ax1 - 30)
          v.landY = v.floor
          e.facing = v.landX < cx ? -1 : 1
          setState(e, 'dropTell')
          sfx(w, 'spring')
        }
        break
      }
      case 'dripTell':
        if (t >= v.tell) {
          letDrip(e, w)
          v.drips--
          setState(e, 'perch')
        }
        break
      case 'dropTell':
        if (t >= DROP_TELL_T) {
          v.sx = middle(e)
          v.sy = feet(e)
          setState(e, 'drop')
          sfx(w, 'jump')
        }
        break
      case 'drop': {
        const u = Math.min(1, t / DROP_T)
        stand(e, v.sx + (v.landX - v.sx) * u, v.sy + (v.landY - v.sy) * u - 4 * DROP_ARC * u * (1 - u))
        if (u >= 1) {
          setState(e, 'land')
          sfx(w, 'stomp')
          shake(w, 5, 2)
          rumble(w, 0.45, 0.3, 110)
          fx(w, 'dust', middle(e), v.floor, 6)
        }
        break
      }
      case 'land':
        if (t >= LAND_T) setState(e, 'idle')
        break
      case 'refill':
        if (t === 1) sfx(w, 'pop')
        if (t === 14 || t === 66) sfx(w, 'pipe')
        if (t >= REFILL_T) setState(e, 'burp')
        break
      case 'burp':
        if (t === 4) {
          sfx(w, 'bump')
          fx(w, 'bubble', middle(e) + e.facing * 20, e.y + 12, 2)
        }
        if (t >= BURP_T) setState(e, 'idle')
        break
      case 'stagger':
        if (t >= STAGGER_T) setState(e, 'idle')
        break
    }
    const s = e.state
    // Dizzy against the wall after a slide, he is no danger to anyone.
    setHarm(e, w, s !== 'intro' && s !== 'refill' && s !== 'burp' && s !== 'stagger' && s !== 'slideEnd' && s !== 'beaten')
  },
  onSpray(e, w, d: Droplet) {
    const s = e.state
    if (s === 'wait' || s === 'beaten') return false
    if (s === 'intro' || s === 'stagger') {
      e.vars.flinch = 8
      return true
    }
    const v = e.vars
    // Glugging and burping he is wide open. Otherwise the oil sheds most of it, and only the
    // refill can finish a stage.
    const open = s === 'refill' || s === 'burp'
    const floor = stageFloor(e, v.stage)
    washRival(e, w, d, open ? 1 : CHIP, open ? floor : floor + 1)
    if (!open) sfxEvery(w, 'bump', 16)
    else if (e.hp > floor) sfxEvery(w, 'sprayHit', 5)
    else if (v.stage < 2) stagger(e, w)
    else beaten(e, w)
    return true
  },
})
