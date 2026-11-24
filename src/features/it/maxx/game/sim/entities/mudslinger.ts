// MUDSLINGER, the mini-boss at the end of MW04 Mud Season: a jacked-up, mud-caked pickup
// with an attitude. Kinds: mudslinger, and its own ms_clod, ms_mark, ms_puddle, ms_door.
//
// FOR LEVEL DESIGNERS
//
//   mudslinger   box 136 x 88, dirt 80. The arena is levels/dev/mudslinger.ts; build it exactly so
//                (arena columns count from the arena's left wall, column 0):
//                  - 20 columns, one screen. Columns 0 and 19 are walls one tile thick, from the
//                    top of the area down to a doorway two tiles high on the floor.
//                  - a flat floor of plain ground ('#') right across, no pits, no blocks, no mud.
//                  - two catwalks ('=') three tiles above the floor (tile row = floor row - 3),
//                    arena columns 5-7 and 12-14. Nothing else inside, open sky above (clods rise
//                    232 px over the floor; a roof lower than that is not supported).
//                  - its character on the row above the floor in arena column 16: it backs up
//                    against the right wall by itself.
//                  - Maxx comes in by the left doorway. Put the level's gate (kind 'gate', props
//                    flag 'mudslinger', h 2) in the right doorway, the way out.
//                The fight starts once Maxx is wholly inside: the camera locks on the arena and a
//                shutter (ms_door) drops into each doorway that nothing solid already fills (so,
//                with the gate in place, only the way in), and rolls up again when it is washed.
//                props: dirt (80); arenaX (tile column of the arena's left wall; default its own
//                column - 16) and arenaW (20); music (the fight's song, 'boss'; 'none' leaves the
//                level's song alone); dir: 1 mirrors the fight (it starts at the left wall, the
//                way in is on the right, and its own column is then arena column 3).
//                Washed, it sets flag 'mudslinger' to 1 at once (the gate opens on that), and on a
//                retry with the flag set it is not there at all: no lock, no shutter.
//
// THE FIGHT (ticks; calm / angry, which it turns once half its dirt is off)
//
//   tip + fling  it turns its tail to the arena and tips the bed up for 44 / 32 ticks: the tell.
//                From the first tick of the tell a shadow (ms_mark) lies where each lump will
//                land: the slop, a slab of the load that slides out over the tailgate and flops
//                onto the floor from 10 to 82 px behind it (always: its tail, and the floor under
//                a catwalk over it, are no place to hide), one clod where Maxx stands, on a
//                catwalk too (beside the slop if that covers him), and the rest of the 3 / 5
//                clods in steps of 92-112 / 84-96 px from his; any the floor has no room for go
//                onto a catwalk, as far from any other up there (angry: 5 clods in most
//                layouts, else 4). The clods leave the bed
//                10 / 8 ticks apart and fly 64 / 58 ticks like a mortar: straight up out of the
//                bed, across high up, straight down onto the shadow; they only move sideways in
//                the middle of the flight, above the head of a Maxx on a catwalk. They land on the
//                highest surface (a catwalk shields the floor under it). Angry, a lump that lands on the
//                floor leaves a puddle (ms_puddle) for 240 ticks that holds a run to 95 px/s; it
//                never weakens a jump. Spray knocks a lump away.
//   rev + charge once the last lump is down it turns round and revs for 78 / 62 ticks (three
//                lamps on its roof count it down, the headlights flash) and charges to the far
//                wall at 300 / 370 px/s. Get up on a catwalk, or jump it with the hover.
//   spent        nose in the wall, it pants for 120 / 84 ticks: wash it. Spray takes 0.072 dirt a
//                droplet at any time, 0.144 while it is bonked or spent; a turbo droplet counts
//                TUNING.turboBossPower (1.5) times, as on every boss. Mighty Wax touching it scrubs
//                as fast as spraying it (half a droplet's worth a tick).
//   Touching the dirty truck or a lump costs a pip (hurtPlayer). Nothing else hurts.
//   The fight's song is set with setBossMusic, so Mighty Wax running out mid-fight hands back to it.
//
// FOR THE RENDERER
//
//   mudslinger  box 136 x 88, z 0. facing: where its nose points. Dirt stage
//               ceil(3 * hp / maxHp): 3, 2, 1, and 0 clean. vars.phase 0 calm, 1 angry.
//               vars.wet > 0: water hit it within the last 8 ticks (flinch).
//               vars.dur: how many ticks the current state lasts (0 = open ended).
//               States:
//                 wait     before the fight, idling at its wall
//                 intro    dur 150: taunts (a rev at tick 1, a honk at 60)
//                 turn     dur 20: a hop; facing flips at tick 10
//                 tip      dur 44 / 32: the bed rises; the shadows are down
//                 fling    one clod every 10 / 8 ticks: vars.i thrown so far of vars.n,
//                          vars.kick ticks since the last one left; the slop pours at tick 1
//                 settle   bed comes down while the last clods are in the air
//                 rev      dur 78 / 62: vars.lamps 1, 2, 3 lit as the thirds pass
//                 charge   e.vx is its speed
//                 bonk     dur 16: nose in the wall
//                 spent    dur 120 / 84: panting
//                 recover  dur 20: shakes it off
//                 rage     dur 64: once, when it turns angry
//                 clean    dur 150: washed. Sparkle to tick 30, honks at 40 and 64
//                 happy    for good: parked, grinning, solid 'top' along its drawn outline
//                          (TRUCK_TOP as e.ground: the light bar, the cab, the bed's rim, the
//                          hood and the eyes at their drawn heights)
//   ms_clod     box 16 x 16, z 1. vars.t ticks flown of vars.T. e.vx, e.vy are its speed.
//               vars.slop 1: the slop instead, box 72 x 14, sliding out of the bed in 26 ticks.
//   ms_mark     box 40 x 6 lying on the surface where a lump will land (84 x 6 for the slop),
//               z 0. vars.t ticks until it lands, of vars.dur.
//   ms_puddle   box 44 x 6 on the floor, z 1 (over Maxx's boots). 'idle', then 'dry' for its
//               last 40 ticks. vars.life ticks left of 240.
//   ms_door     box 32 x props.h in a doorway, z 0. 'shut' (comes down over its first
//               vars.slam ticks) | 'open' (DOOR_OPEN = 24 ticks rolling up, not solid, then gone).
import { DT, TILE } from '../../contract'
import type { MusicId } from '../../contract'
import {
  addScore,
  areaMusic,
  banner,
  clearBoss,
  damage,
  entityById,
  fx,
  getFlag,
  hurtPlayer,
  jingle,
  kill,
  lockCamera,
  moveBody,
  music,
  overlaps,
  playerCx,
  propNum,
  propStr,
  rand,
  randRange,
  registerEntity,
  rumble,
  setBoss,
  setBossMusic,
  setBox,
  setFlag,
  setState,
  sfx,
  sfxEvery,
  shake,
  solidAt,
  spawn,
  tileInfoAt,
  unlockCamera,
  versus,
} from '../api'
import type { Entity, MoveOpts, World } from '../types'

const NAME = 'MUDSLINGER'
const TAGLINE = 'ALLERGIC TO SOAP'
const FLAG = 'mudslinger'

const BOX_W = 136
const BOX_H = 88
/** The arena's side walls are one tile thick. */
const WALL = TILE

// Pairs are [calm, angry].
const INTRO_T = 150
const TURN_T = 20
const TIP_T = [44, 32]
const CLODS = [3, 5]
const FLING_GAP = [10, 8]
const FLIGHT_T = [64, 58]
const REV_T = [78, 62]
const CHARGE_V = [300, 370]
const CHARGE_ACCEL = 1500
const BONK_T = 16
const SPENT_T = [120, 84]
const RECOVER_T = 20
const RAGE_T = 64
const CLEAN_T = 150

const DIRT = 80
const DMG = 0.072
const DMG_SPENT = 0.144
const SCORE = 5000

/** How far apart two clods of one volley land: a mark is 40 wide, so the gap between two is wider than Maxx. */
const GAP_CALM = [92, 112]
const GAP_ANGRY = [84, 96]
const CLOD = 16
const MARK_W = 40
const MARK_H = 6
/** Clods top out this far above the floor (their top edge), whatever their range. */
const APEX = 232
/** Share of its flight into which a clod's sideways travel is squeezed (it rises and falls plumb outside it). */
const CROSS_FROM = 0.2
const CROSS_TO = 0.75
/**
 * The slop: the load sliding out over the tailgate as a slab SLOP_W x SLOP_H, landing with its
 * middle SLOP_OUT out from the tail, SLOP_T ticks after it starts to slide. Its shadow is
 * SLOP_MARK wide, so the whole strip under a catwalk that hangs over the tail is covered.
 */
const SLOP_W = 72
const SLOP_H = 14
const SLOP_OUT = 46
const SLOP_T = 26
const SLOP_MARK = 84
/** It starts in the bed, its bottom this far above the floor, and rises this much more first. */
const SLOP_FROM = 54
const SLOP_RISE = 10
const PUDDLE_W = 44
const PUDDLE_H = 6
const PUDDLE_T = 240
/** Run speed left to Maxx in a puddle, before the push of his own legs: about half his run. */
const PUDDLE_SPEED = 95
const DOOR_SLAM = 8
const DOOR_OPEN = 24

/**
 * The washed truck's outline as it is drawn parked (clean body, bed down, light bar, the eyes on
 * its hood; not the eyebrows, which float over them): for each pixel column of its box, nose first
 * as the art faces left, how far below the box top the outline is. 'n*k' is n, k times. The stack
 * pokes 2 px over the box and is held to its top. It is the parked truck's standable top
 * (Entity.ground), as CAR_TOPS is a washed car's; sim.mjs checks it against the atlas, so art that
 * changes the silhouette fails there until this follows.
 */
export const TRUCK_TOP = '27 26 25 21 18 17 16 15*3 16 17 18 21 19 17 16 15*2 14*5 15*2 16 17 19 22 20 19 18 17*6 18 19 17 16 15*2 13 12 11 9 8 7 6 5*2 4 1 0*22 1 0*10 23*46 24'

/** TRUCK_TOP as one number per column. */
export function truckTop(): number[] {
  const out: number[] = []
  for (const part of TRUCK_TOP.split(' ')) {
    const [n, k] = part.split('*')
    for (let i = 0, times = k === undefined ? 1 : Number(k); i < times; i++) out.push(Number(n))
  }
  return out
}

const TRUCK_LEFT: readonly number[] = Object.freeze(truckTop())
const TRUCK_RIGHT: readonly number[] = Object.freeze(truckTop().reverse())

const MOVE: MoveOpts = { solids: false, conveyor: false }
/** Landing spots of a volley: 0..4 the clods, SLOP the slop. */
const SLOP = 5
const TX = ['tx0', 'tx1', 'tx2', 'tx3', 'tx4', 'tx5']
const TY = ['ty0', 'ty1', 'ty2', 'ty3', 'ty4', 'ty5']
const MARK = ['mk0', 'mk1', 'mk2', 'mk3', 'mk4', 'mk5']
const xs: number[] = []
const spare: number[] = []

function stage(e: Entity): number {
  return e.hp <= 0 ? 0 : Math.ceil((3 * e.hp) / e.maxHp)
}

function enter(e: Entity, state: string, dur: number): void {
  setState(e, state)
  e.stateT = 0
  e.vars.dur = dur
}

/** The world x of its tail end, and which way the arena lies from it. */
function tailX(e: Entity): number {
  return e.vars.side > 0 ? e.x : e.x + e.w
}

/** The top of whatever a falling clod meets first at world x: a catwalk, or the floor. */
function surfaceAt(w: World, x: number, floorY: number): number {
  const tx = Math.floor(x / TILE)
  const bottom = Math.floor(floorY / TILE)
  let ty = Math.max(0, Math.floor((floorY - APEX) / TILE))
  // A roof over the arena: start under it.
  while (ty < bottom && tileInfoAt(w, tx, ty).solid) ty++
  for (; ty < bottom; ty++) {
    const info = tileInfoAt(w, tx, ty)
    if (info.solid || info.oneWay) return ty * TILE
  }
  return floorY
}

/** Shut the doorway in a side wall of the arena, if there is one and nothing solid stands in it already. */
function shutDoorway(e: Entity, w: World, wallX: number): void {
  const floorY = e.vars.fy
  const x = wallX + TILE / 2
  let n = 0
  while (n < 4 && !solidAt(w, x, floorY - n * TILE - 1)) n++
  if (n === 0 || n === 4) return
  const hole = { x: wallX, y: floorY - n * TILE, w: TILE, h: n * TILE }
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (!o.dead && o.solid !== 'none' && overlaps(o, hole)) return
  }
  spawn(w, 'ms_door', x, floorY, { props: { h: n * TILE } })
}

function fightSong(e: Entity): MusicId | null {
  const song = propStr(e, 'music', 'boss')
  return song === 'none' ? null : (song as MusicId)
}

function startFight(e: Entity, w: World): void {
  const v = e.vars
  lockCamera(w, v.x0, v.x1)
  versus(w, e, NAME, TAGLINE)
  setBoss(w, NAME, e.hp, e.maxHp)
  const song = fightSong(e)
  if (song) setBossMusic(w, song)
  shutDoorway(e, w, v.x0)
  shutDoorway(e, w, v.x1 - WALL)
  sfx(w, 'stomp')
  shake(w, 6, 2)
  enter(e, 'intro', INTRO_T)
}

function markAt(e: Entity, w: World, slot: number, x: number, y: number, ticks: number, width = MARK_W): void {
  const v = e.vars
  v[TX[slot]] = x
  v[TY[slot]] = y
  v[MARK[slot]] = 0
  const mark = spawn(w, 'ms_mark', x, y)
  if (!mark) return
  mark.x = x - width / 2
  mark.w = width
  mark.vars.t = ticks
  mark.vars.dur = ticks
  v[MARK[slot]] = mark.id
}

/** Can a clod land at x: anywhere up on a catwalk, but on the floor only clear of the slop's shadow. */
function clodSpot(e: Entity, w: World, x: number, floorEnd: number): boolean {
  if (surfaceAt(w, x, e.vars.fy) < e.vars.fy) return true
  return e.vars.side > 0 ? x <= floorEnd : x >= floorEnd
}

/** A whole-pixel landing spot at x, nudged (at most half a clod) off the end of a catwalk so the clod lands wholly on one surface. */
function onOneSurface(w: World, x: number, fy: number): number {
  const r = Math.round(x)
  const left = surfaceAt(w, r - CLOD / 2, fy)
  if (left === surfaceAt(w, r + CLOD / 2 - 1, fy)) return r
  // A tile edge lies under the clod: keep it on the side its middle is over.
  const edge = Math.floor((r + CLOD / 2 - 1) / TILE) * TILE
  return surfaceAt(w, r, fy) === left ? edge - CLOD / 2 : edge + CLOD / 2
}

/**
 * Pick where this volley lands and put the shadows down: the slop right behind the tail, one clod
 * where Maxx stands (on a catwalk too; beside the slop if that already covers him), the rest in
 * step from his.
 */
function aim(e: Entity, w: World): void {
  const v = e.vars
  const p = v.phase
  const out = -v.side
  const tail = tailX(e)
  const slop = tail + out * SLOP_OUT
  // The nearest a clod may land on the floor: its shadow just meets the slop's.
  const floorEnd = slop + (out * (SLOP_MARK + MARK_W)) / 2
  let lo = v.x0 + WALL + 12
  let hi = v.x1 - WALL - 12
  // Never on the truck itself.
  if (out < 0) hi = Math.min(hi, tail - CLOD)
  else lo = Math.max(lo, tail + CLOD)
  const want = CLODS[p]
  const range = p ? GAP_ANGRY : GAP_CALM
  const gap = randRange(w, range[0], range[1])
  let mine = onOneSurface(w, Math.max(lo, Math.min(hi, playerCx(w))), v.fy)
  if (!clodSpot(e, w, mine, floorEnd)) mine = Math.round(floorEnd)
  let n = 0
  xs[n++] = mine
  let c = 0
  for (let k = -1; k <= 1; k += 2) {
    for (let x = mine + k * gap; x >= lo && x <= hi; x += k * gap) {
      const at = onOneSurface(w, x, v.fy)
      if (clodSpot(e, w, at, floorEnd)) spare[c++] = at
    }
  }
  for (let i = 0; i < c && n < want; i++) {
    const j = i + Math.floor(rand(w) * (c - i))
    const pick = spare[j]
    spare[j] = spare[i]
    xs[n++] = pick
  }
  // Short of room on the floor: the rest go onto a catwalk, as far from any other on that catwalk.
  // (One landing up there never reaches the floor, which the catwalk shields.)
  for (let tx = Math.floor(lo / TILE); n < want && tx * TILE <= hi; tx++) {
    const x = tx * TILE + TILE / 2
    const y = surfaceAt(w, x, v.fy)
    if (x < lo || x > hi || y >= v.fy) continue
    let clear = true
    for (let k = 0; k < n && clear; k++) clear = surfaceAt(w, xs[k], v.fy) !== y || Math.abs(xs[k] - x) >= gap
    if (clear) xs[n++] = x
  }
  // Thrown nearest first, so the splats walk away from the truck.
  const home = e.x + e.w / 2
  for (let i = 1; i < n; i++) {
    const x = xs[i]
    let j = i - 1
    for (; j >= 0 && Math.abs(xs[j] - home) > Math.abs(x - home); j--) xs[j + 1] = xs[j]
    xs[j + 1] = x
  }
  for (let i = 0; i < n; i++) {
    const x = Math.round(xs[i])
    markAt(e, w, i, x, surfaceAt(w, x, v.fy), TIP_T[p] + i * FLING_GAP[p] + FLIGHT_T[p])
  }
  markAt(e, w, SLOP, Math.round(slop), v.fy, TIP_T[p] + SLOP_T, SLOP_MARK)
  v.n = n
  v.i = 0
}

/**
 * Send a lump of bw x bh, its box's top-left at (x, y), to land with its middle on the spot of
 * `slot`, topping out at topY.
 */
function launch(e: Entity, w: World, x: number, y: number, bw: number, bh: number, slot: number, T: number, topY: number, slop: number): void {
  const v = e.vars
  const clod = spawn(w, 'ms_clod', x + bw / 2, y + bh)
  if (!clod) return
  clod.x = x
  clod.y = y
  clod.w = bw
  clod.h = bh
  const c = clod.vars
  const endY = v[TY[slot]] - bh
  const top = Math.min(topY, clod.y - 4, endY - 4)
  const up = Math.sqrt(clod.y - top)
  const down = Math.sqrt(endY - top)
  const t1 = (T * up) / (up + down)
  c.sx = clod.x
  c.sy = clod.y
  c.dx = v[TX[slot]] - bw / 2 - clod.x
  c.ey = endY
  c.T = T
  c.g = (2 * (clod.y - top)) / (t1 * t1)
  c.vy0 = -c.g * t1
  c.t = 0
  c.mark = v[MARK[slot]]
  c.puddle = v.phase
  c.fy = v.fy
  c.slop = slop
}

function fling(e: Entity, w: World, i: number): void {
  const v = e.vars
  // Out of the middle of the bed, which is behind the cab.
  const sx = e.x + e.w / 2 - e.facing * 36
  launch(e, w, sx - CLOD / 2, e.y + 4, CLOD, CLOD, i, FLIGHT_T[v.phase], v.fy - APEX, 0)
  v.kick = 0
  sfx(w, 'mudThrow')
  fx(w, 'mud', sx, e.y + 8, 3, -e.facing)
}

/** The load slides out of the tipped bed over the tailgate and flops down behind it. */
function pour(e: Entity, w: World): void {
  const v = e.vars
  const out = -v.side
  // It starts in the back of the bed, just over the tailgate, and slides out.
  const lip = tailX(e) + out * 10
  const x = out < 0 ? lip : lip - SLOP_W
  const y = v.fy - SLOP_FROM - SLOP_H
  launch(e, w, x, y, SLOP_W, SLOP_H, SLOP, SLOP_T, y - SLOP_RISE, 1)
  sfx(w, 'splat')
  fx(w, 'mud', tailX(e), y, 6, out)
}

/** Whatever of the fight is still in the air or on the ground goes when the truck comes clean. */
function clearField(w: World): void {
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (o.dead) continue
    if (o.kind === 'ms_clod') {
      kill(o)
      fx(w, 'splash', o.x + o.w / 2, o.y + o.h / 2, 4)
    } else if (o.kind === 'ms_mark') {
      kill(o)
    } else if (o.kind === 'ms_puddle') {
      o.vars.life = Math.min(o.vars.life, 30)
    }
  }
}

function openDoors(w: World): void {
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (o.dead || o.kind !== 'ms_door' || !setState(o, 'open')) continue
    o.solid = 'none'
    sfx(w, 'gate')
  }
}

function wash(e: Entity, w: World): void {
  const cx = e.x + e.w / 2
  e.hp = 0
  e.harmful = false
  e.vars.wet = 0
  e.vars.lamps = 0
  setFlag(w, FLAG, 1)
  clearBoss(w)
  clearField(w)
  enter(e, 'clean', CLEAN_T)
  // clearBoss has ended the fight's song: the level's comes back under the jingle.
  if (fightSong(e)) music(w, areaMusic(w))
  jingle(w, 'rivalDown')
  sfx(w, 'bossDown')
  sfx(w, 'carClean')
  fx(w, 'sparkle', cx, e.y + e.h / 2, 16)
  fx(w, 'shine', cx, e.y + e.h / 2, 1)
  fx(w, 'confetti', cx, e.y, 24)
  addScore(w, SCORE, cx, e.y - 12)
  banner(w, 'SQUEAKY CLEAN!', 120)
  rumble(w, 0.6, 0.8, 320)
  shake(w, 8, 2)
}

/** Take dirt off. True when that washed it. */
function scrub(e: Entity, w: World, amount: number, x: number, y: number): boolean {
  const before = stage(e)
  e.vars.wet = 8
  if (damage(e, amount)) {
    wash(e, w)
    return true
  }
  if (stage(e) < before) {
    // A slab of caked mud lets go: the paint under it shows.
    fx(w, 'mud', x, y, 10)
    fx(w, 'mud', e.x + e.w / 2, e.y + e.h - 20, 8)
    sfx(w, 'bossHit')
    shake(w, 4, 2)
  }
  if (e.hp <= e.maxHp / 2) e.vars.angry = 1
  return false
}

/** Go on to `next`, unless it has just lost half its dirt: then the tantrum comes first. `plan` 0 = a volley after it, 1 = turn and charge. */
function goOn(e: Entity, w: World, plan: number): void {
  const v = e.vars
  if (v.angry === 1 && v.phase === 0) {
    v.after = plan
    enter(e, 'rage', RAGE_T)
    sfx(w, 'thunder')
    sfx(w, 'honk')
    shake(w, 14, 3)
    rumble(w, 0.8, 0.5, 400)
    return
  }
  if (plan === 0) {
    enter(e, 'tip', TIP_T[v.phase])
  } else {
    v.next = 1
    enter(e, 'turn', TURN_T)
  }
}

registerEntity('mudslinger', {
  alwaysActive: true,
  boss: true,
  init(e, w) {
    const col = Math.floor(e.x / TILE)
    setBox(e, BOX_W, BOX_H)
    if (getFlag(w, FLAG) >= 1) {
      kill(e)
      return
    }
    const v = e.vars
    const side = e.facing < 0 ? 1 : -1
    const width = Math.max(12, Math.round(propNum(e, 'arenaW', 20)))
    const left = Math.round(propNum(e, 'arenaX', side > 0 ? col - (width - 4) : col - 3))
    e.hp = Math.max(1, propNum(e, 'dirt', DIRT))
    e.maxHp = e.hp
    e.harmful = true
    e.state = 'wait'
    v.x0 = left * TILE
    v.x1 = (left + width) * TILE
    v.fy = e.y + e.h
    // Which wall it is at: 1 the right one, -1 the left.
    v.side = side
    e.x = side > 0 ? v.x1 - WALL - BOX_W : v.x0 + WALL
    v.phase = 0
    v.angry = 0
    v.wet = 0
    v.dur = 0
    v.lamps = 0
    v.n = 0
    v.i = 0
    v.kick = 99
    v.next = 0
    v.after = 0
    v.ride = 0
  },
  update(e, w) {
    const v = e.vars
    const st = e.state
    if (st === 'wait') {
      const p = w.player
      // Wholly inside, so a shutter never comes down on him.
      if (p.state === 'normal' && p.x >= v.x0 + WALL + 4 && p.x + p.w <= v.x1 - WALL - 4) startFight(e, w)
      return
    }
    if (v.wet > 0) v.wet--
    const t = e.stateT
    const ph = v.phase
    const lo = v.x0 + WALL
    const hi = v.x1 - WALL - e.w
    if (st !== 'charge' && st !== 'clean') e.vx = 0

    switch (st) {
      case 'intro':
        if (t === 1) sfx(w, 'rev')
        if (t === 60) sfx(w, 'honk')
        if (t >= INTRO_T) {
          v.next = 0
          enter(e, 'turn', TURN_T)
        }
        break
      case 'turn':
        if (t === 1) {
          sfx(w, 'skid')
          fx(w, 'dust', e.x + e.w / 2, e.y + e.h, 6)
        }
        if (t === TURN_T / 2) e.facing = e.facing > 0 ? -1 : 1
        if (t >= TURN_T) {
          if (v.next === 0) enter(e, 'tip', TIP_T[ph])
          else enter(e, 'rev', REV_T[ph])
        }
        break
      case 'tip':
        if (t === 1) {
          aim(e, w)
          sfx(w, 'hydraulic')
        }
        if (t >= TIP_T[ph]) enter(e, 'fling', 0)
        break
      case 'fling':
        v.kick++
        if (t === 1) pour(e, w)
        if (v.i < v.n && (t - 1) % FLING_GAP[ph] === 0) {
          fling(e, w, v.i)
          v.i++
          rumble(w, 0.3, 0.2, 60)
        }
        if (v.i >= v.n && v.kick >= FLING_GAP[ph]) enter(e, 'settle', FLIGHT_T[ph])
        break
      case 'settle':
        // Nothing new starts until the last clod is down: the attacks never overlap.
        if (t >= FLIGHT_T[ph]) goOn(e, w, 1)
        break
      case 'rev': {
        const third = Math.ceil(REV_T[ph] / 3)
        const lamps = Math.min(3, 1 + Math.floor((t - 1) / third))
        if (lamps !== v.lamps) {
          v.lamps = lamps
          sfx(w, 'rev')
          rumble(w, 0.25 + lamps * 0.1, 0.2, 140)
        }
        if (t % 6 === 0) fx(w, 'mud', e.x + e.w / 2 - e.facing * 56, e.y + e.h - 6, 2, -e.facing)
        if (t >= REV_T[ph]) {
          v.lamps = 0
          enter(e, 'charge', 0)
          sfx(w, 'honk')
          shake(w, 5, 2)
        }
        break
      }
      case 'charge': {
        const dir = e.facing
        e.vx = dir * Math.min(CHARGE_V[ph], Math.abs(e.vx) + CHARGE_ACCEL * DT)
        if (t % 5 === 0) fx(w, 'dust', e.x + e.w / 2 - dir * 60, e.y + e.h, 2, -dir)
        break
      }
      case 'bonk':
        if (t >= BONK_T) enter(e, 'spent', SPENT_T[ph])
        break
      case 'spent':
        if (t % 14 === 1) fx(w, 'steam', e.x + e.w / 2 + e.facing * 40, e.y + 30, 2)
        if (t >= SPENT_T[ph]) enter(e, 'recover', RECOVER_T)
        break
      case 'recover':
        if (t >= RECOVER_T) goOn(e, w, 0)
        break
      case 'rage':
        if (t % 8 === 1) fx(w, 'steam', e.x + e.w / 2, e.y + 6, 2)
        if (t === 24) sfx(w, 'rev')
        if (t >= RAGE_T) {
          v.phase = 1
          goOn(e, w, v.after)
        }
        break
      case 'clean':
        // Washed in mid-charge: it brakes.
        e.vx = Math.abs(e.vx) < 30 ? 0 : e.vx * 0.86
        if (t === 40 || t === 64) sfx(w, 'honk')
        if (t % 10 === 1) fx(w, 'sparkle', e.x + rand(w) * e.w, e.y + rand(w) * e.h, 2)
        if (t >= CLEAN_T) {
          unlockCamera(w)
          openDoors(w)
          e.solid = 'top'
          // Parked for good, so its outline never has to turn round with it.
          e.ground = e.facing > 0 ? TRUCK_RIGHT : TRUCK_LEFT
          e.vx = 0
          enter(e, 'happy', 0)
        }
        break
      case 'happy': {
        const on = w.player.ridingId === e.id ? 1 : 0
        if (on && !v.ride) sfxEvery(w, 'honk', 50)
        v.ride = on
        break
      }
    }

    moveBody(e, w, MOVE)
    if (e.x < lo) e.x = lo
    else if (e.x > hi) e.x = hi
    // Only the wall it is heading for stops it: it sets off from the other one.
    if (e.state === 'charge' && ((e.facing < 0 && e.x <= lo) || (e.facing > 0 && e.x >= hi) || e.hitWall === e.facing)) {
      const dir = e.facing
      e.vx = 0
      v.side = dir > 0 ? 1 : -1
      enter(e, 'bonk', BONK_T)
      sfx(w, 'stomp')
      sfx(w, 'crumble')
      shake(w, 10, 4)
      rumble(w, 0.9, 0.7, 260)
      fx(w, 'debris', dir > 0 ? e.x + e.w : e.x, e.y + 40, 6)
      fx(w, 'star', e.x + e.w / 2 + dir * 30, e.y - 4, 4)
    }
    if (e.state !== 'clean' && e.state !== 'happy') setBoss(w, NAME, e.hp, e.maxHp)
  },
  onSpray(e, w, d) {
    const st = e.state
    if (st === 'clean' || st === 'happy') return false
    fx(w, 'splash', d.x, d.y, 1)
    if (st === 'wait') return true
    const spent = st === 'spent' || st === 'bonk'
    sfxEvery(w, 'sprayHit', 5)
    if (spent) sfxEvery(w, 'bossHit', 24)
    scrub(e, w, d.power * (spent ? DMG_SPENT : DMG), d.x, d.y)
    return true
  },
  onTouch(e, w) {
    const st = e.state
    if (st === 'clean' || st === 'happy') return true
    if (w.player.wax > 0 && st !== 'wait') {
      // Mighty Wax scrubs on touch, as it washes a car; on a boss it is worth spraying it, no more.
      const spent = st === 'spent' || st === 'bonk'
      scrub(e, w, (spent ? DMG_SPENT : DMG) / 2, playerCx(w), w.player.y + w.player.h / 2)
      return true
    }
    return false
  },
})

/* ------------------------------------------------------------------ */
/* ms_clod: a lump of mud out of the bed                               */
/* ------------------------------------------------------------------ */

function killMark(w: World, id: number): void {
  const mark = id > 0 ? entityById(w, id) : null
  if (mark) kill(mark)
}

registerEntity('ms_clod', {
  offscreen: 'remove',
  init(e) {
    setBox(e, CLOD, CLOD)
    e.harmful = true
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.state = 'fly'
  },
  update(e, w) {
    const c = e.vars
    if (!(c.T > 0)) {
      kill(e)
      return
    }
    const t = ++c.t
    if (t >= c.T) {
      const cx = c.sx + c.dx + e.w / 2
      const ground = c.ey + e.h
      kill(e)
      killMark(w, c.mark)
      fx(w, 'mud', cx, ground - 4, c.slop ? 12 : 7)
      sfxEvery(w, 'splat', 4)
      if (c.puddle > 0 && ground >= c.fy) puddleAt(w, cx, ground)
      return
    }
    // Lobbed like a mortar: straight up out of the bed, across high overhead, straight down onto
    // its shadow. It only moves sideways in the middle of its flight, when it is higher than Maxx's
    // head even on a catwalk; low down it is only ever over the bed or over its own shadow, so the
    // shadow tells the whole truth about where it is not safe to stand. The slop just slides out.
    const u = c.slop ? t / c.T : Math.max(0, Math.min(1, (t / c.T - CROSS_FROM) / (CROSS_TO - CROSS_FROM)))
    const x = c.sx + c.dx * u * u * u * (10 - 15 * u + 6 * u * u)
    const y = c.sy + c.vy0 * t + 0.5 * c.g * t * t
    e.vx = (x - e.x) / DT
    e.vy = (y - e.y) / DT
    e.x = x
    e.y = y
  },
  onSpray(e, w) {
    kill(e)
    killMark(w, e.vars.mark)
    fx(w, 'splash', e.x + e.w / 2, e.y + e.h / 2, 5)
    sfxEvery(w, 'sprayHit', 5)
    return true
  },
  onTouch(e, w) {
    hurtPlayer(w, { fromX: e.x + e.w / 2 })
    kill(e)
    killMark(w, e.vars.mark)
    fx(w, 'mud', e.x + e.w / 2, e.y + e.h / 2, 6)
    return true
  },
})

/* ------------------------------------------------------------------ */
/* ms_mark: the shadow where a clod will land                          */
/* ------------------------------------------------------------------ */

registerEntity('ms_mark', {
  offscreen: 'remove',
  init(e) {
    setBox(e, MARK_W, MARK_H)
    e.gravity = 0
    e.collides = false
    e.vars.t = 1
    e.vars.dur = 1
  },
  update(e) {
    if (--e.vars.t <= 0) kill(e)
  },
})

/* ------------------------------------------------------------------ */
/* ms_puddle: mud left on the floor                                    */
/* ------------------------------------------------------------------ */

function puddleAt(w: World, x: number, floorY: number): void {
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i]
    if (o.dead || o.kind !== 'ms_puddle' || Math.abs(o.x + o.w / 2 - x) > PUDDLE_W / 2) continue
    o.vars.life = PUDDLE_T
    setState(o, 'idle')
    return
  }
  spawn(w, 'ms_puddle', x, floorY)
}

registerEntity('ms_puddle', {
  offscreen: 'remove',
  init(e) {
    setBox(e, PUDDLE_W, PUDDLE_H)
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.vars.life = PUDDLE_T
  },
  update(e) {
    const life = --e.vars.life
    if (life <= 0) kill(e)
    else if (life < 40) setState(e, 'dry')
  },
  onSpray(e, w, d) {
    // Water thins it out. Only what is aimed down reaches it: forward spray passes above.
    e.vars.life -= 16
    fx(w, 'splash', d.x, d.y, 1)
    return true
  },
  onTouch(_e, w) {
    const p = w.player
    if (!p.onGround) return true
    // It drags at his boots and nothing more: the jump out of it is a full one.
    if (p.vx > PUDDLE_SPEED) p.vx = PUDDLE_SPEED
    else if (p.vx < -PUDDLE_SPEED) p.vx = -PUDDLE_SPEED
    return true
  },
})

/* ------------------------------------------------------------------ */
/* ms_door: the shutter over a doorway of the arena                    */
/* ------------------------------------------------------------------ */

registerEntity('ms_door', {
  init(e) {
    setBox(e, TILE, Math.max(TILE, propNum(e, 'h', 2 * TILE)))
    e.solid = 'full'
    e.gravity = 0
    e.collides = false
    e.state = 'shut'
    e.vars.slam = DOOR_SLAM
  },
  update(e) {
    if (e.state === 'open' && e.stateT >= DOOR_OPEN) kill(e)
  },
})
