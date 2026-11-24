// Critters: blob, bird (a grackle) and the splat it drops, bugs (a swarm), tumbleweed.
//
//   blob        a grumpy heap of grime that walks the floor. 30 x 28 (as tall as the prep gun
//               needs: the water leaves 30 px up). Walks 30 px/s, turns at walls, at ledges and
//               when it meets another blob head on. Where there is no room to walk (a one-tile
//               pillar or pen) it stands and looks about, turning every 50 ticks, instead of
//               spinning. Belts carry it: walking against one it treads water, or is pressed to
//               the wall the belt runs into. Three spray hits wash it away, or one stomp squashes
//               it; either way +100. It narrows 2 px with each hit (30, 28, 26 wide; always 28
//               tall). Touching it anywhere else costs a pip. Sinks in sludge.
//               props: dir (1 = starts off to the right), speed (30), edges (false = walks off ledges).
//   bird        a grackle. 28 x 20, flies a wave 14 px either side of the row it is placed in,
//               at 70 px/s, to and fro over a beat of props.range tiles each way (5; 0 = straight
//               on and never back). It turns at a wall across its own row and at the area's edge;
//               a ceiling or a ledge above or below just flattens its wave (it never enters a
//               tile). While Maxx is below it and within 160 px sideways it drops a splat every
//               110 to 150 ticks; for the 20 ticks before each one it stops dead, rears up and
//               squawks. It never starts that warning while there is no room under it for a splat
//               (low over a ledge or a catwalk): it waits till it is clear. Two spray hits and it
//               flees (+200); the first hit also spoils a drop it was about to make. It hurts to
//               touch, from above too. props: dir, range (tiles), amp (px, 14), speed (70).
//   splat       what the grackle drops: 10 x 12, falls straight down (slowly: 290 px/s at most),
//               costs a pip, bursts on the first floor, catwalk, lift or car roof under it (dirty
//               cars too) and rides along on a lift or a car. Caught on the very corner of a ledge
//               it slides off and falls on. Into sludge it just sinks. Water washes it out of the air.
//   bugs        a swarm, 36 x 36, hanging in the air where it is placed until Maxx comes within
//               props.range tiles (10). It bunches up for 24 ticks, then drifts at him at 40 px/s
//               through walls and floors. Six spray hits scatter it (+200); each one stops it,
//               knocks it back 6 px and thins it (its box shrinks 2 px a hit, to 26 x 26). After
//               it stings him it backs off for 50 ticks. It gives up at 1.75 x its range (and,
//               like anything, sleeps once the screen is far away). props: range (tiles), speed.
//   tumbleweed  30 x 30, rolls at 90 px/s in hops of 8, 28 and 8 px (a cycle is 62 ticks, 93 px);
//               bounces back off walls, rolls off ledges, sinks in sludge. Two that meet bounce
//               apart. Every drop of water shoves it back (a steady stream walks it backwards),
//               and one driven back into another hands the shove on. Five hits break it into
//               twigs (+100). It hurts to touch. props: dir (1 = rolls right), speed (90).
//
// Water only counts as a hit every few ticks (blob 8, bird 12, bugs 5, tumbleweed 8): the
// drops in between are used up and do nothing more, so each hit can be seen. Turbo water
// counts double, as on cars. Mighty Wax washes any of them on touch, for the same points.
// Nothing here hurts him while he blinks: the hits all go through hurtPlayer or `harmful`.
//
// FOR THE RENDERER (every sprite is anchored at the feet: e.x + e.w / 2, e.y + e.h)
//
//   blob        'walk' | 'hit' (stopped, reeling from a hit) | 'pop' (washed: 18 ticks, then gone)
//               | 'squash' (stomped: 22 ticks, then gone). Stage = e.hp: 3 whole, 2, 1.
//               vars.wait > 0: standing still in 'walk', looking about. Faces e.facing. z 0.
//   bird        'fly' | 'tell' (20 ticks, then the splat leaves) | 'hit' (12 ticks) | 'flee'
//               (up and away, harmless, gone when it leaves the top of the screen).
//               e.hp 2, then 1 (ruffled). While it flees vars.fx, vars.fy is where it was hit
//               (feathers come loose there). Faces e.facing. z 1.
//   splat       'fall' | 'land' (40 ticks, harmless, then gone). z 1.
//   bugs        'idle' | 'alert' (24 ticks) | 'chase' | 'recoil' (50 ticks) | 'scatter' (30 ticks,
//               harmless, then gone). e.hp 6..1 is how thick the swarm is; vars.stun > 0 for
//               the few ticks after a hit. Its box is the swarm: e.w is 24 + 2 * hp. z 1.
//   tumbleweed  'roll' | 'break' (30 ticks, harmless, then gone). vars.roll is how far it has
//               rolled in pixels, signed (left is negative): turn the picture by it.
//               vars.stun > 0 after a hit; e.hp 5..1. Faces e.facing (the way it rolls). z 0.
import { DT, TILE } from '../../contract'
import {
  addScore,
  areaWidth,
  damage,
  dxToPlayer,
  dyToPlayer,
  entityById,
  facePlayer,
  fx,
  hurtPlayer,
  kill,
  moveBody,
  patrol,
  playerCx,
  playerCy,
  propNum,
  randInt,
  registerEntity,
  rumble,
  setBox,
  setState,
  sfx,
  sfxEvery,
  shoot,
  solidAt,
  solidTop,
  stompBounce,
  tileInfoAt,
  turnAround,
} from '../api'
import { hypot, sin } from '../mathx'
import type { Droplet, Entity, MoveOpts, World } from '../types'

/** The numbers of each critter. Speeds px/s, times ticks. */
export const CRITTERS = {
  blob: {
    w: 30,
    h: 28,
    speed: 30,
    hp: 3,
    score: 100,
    hitGap: 8,
    popTicks: 18,
    squashTicks: 22,
    /** Two turns this close together (px) mean there is no room to walk: it stands and looks about for `look` ticks. */
    cramped: 8,
    look: 50,
  },
  bird: {
    w: 28,
    h: 20,
    speed: 70,
    hp: 2,
    score: 200,
    /** Tiles it flies either side of where it was placed. */
    range: 5,
    /** The wave: pixels above and below its row, and ticks for one whole wave. */
    amp: 14,
    period: 96,
    /** It only drops while Maxx is this close sideways. */
    see: 160,
    dropMin: 110,
    dropMax: 150,
    /** Ticks it hangs still, reared up, before a splat leaves. */
    tell: 20,
    hitGap: 12,
    /** Speed it gains or sheds each tick: turning round takes about half a second. */
    accel: 5,
    fleeTicks: 110,
  },
  splat: { w: 10, h: 12, gravity: 0.3, maxFall: 290, v0: 30, landTicks: 40 },
  bugs: {
    size: 36,
    /** The box at the last hit left. */
    minSize: 26,
    speed: 40,
    hp: 6,
    score: 200,
    /** Tiles: how near Maxx comes before the swarm goes for him. */
    range: 10,
    giveUp: 1.75,
    alert: 24,
    hitGap: 5,
    /** px/s gained each tick: it is slow to turn, so it can be led round. */
    accel: 2,
    knock: 6,
    recoil: 50,
    recoilSpeed: 55,
    scatterTicks: 30,
  },
  tumbleweed: {
    size: 30,
    speed: 90,
    hp: 5,
    score: 100,
    gravity: 0.4,
    /** Launch speed of each hop in turn: two small, one big. */
    hops: [130, 130, 235],
    hitGap: 8,
    /** Each droplet adds this much speed along the water, up to pushMax; pushKeep of it is left a tick later. */
    push: 50,
    pushMax: 170,
    pushKeep: 0.9,
    breakTicks: 30,
  },
} as const

const cx = (e: Entity): number => e.x + e.w / 2
const cy = (e: Entity): number => e.y + e.h / 2
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Water landing on a critter: the same small splash and tick whether or not it counts. */
function wet(w: World, d: Droplet): void {
  fx(w, 'splash', d.x, d.y, 1)
  sfxEvery(w, 'sprayHit', 5)
}

function inSludge(e: Entity, w: World): boolean {
  return tileInfoAt(w, Math.floor(cx(e) / TILE), Math.floor((e.y + e.h - 2) / TILE)).hazard === 'sludge'
}

/** Sunk in a sludge pit: gone, and nobody gets points for it. */
function sink(e: Entity, w: World): boolean {
  if (!inSludge(e, w)) return false
  kill(e)
  fx(w, 'mud', cx(e), e.y + e.h, 6)
  sfxEvery(w, 'splat', 4)
  return true
}

/* ------------------------------------------------------------------ */
/* blob                                                                */
/* ------------------------------------------------------------------ */

const B = CRITTERS.blob

function popBlob(e: Entity, w: World): void {
  e.hp = 0
  e.harmful = false
  e.vx = 0
  e.vy = 0
  setState(e, 'pop')
  addScore(w, B.score, cx(e), e.y - 6)
  sfx(w, 'pop')
  fx(w, 'bubble', cx(e), cy(e), 8)
  fx(w, 'sparkle', cx(e), cy(e), 4)
}

function squashBlob(e: Entity, w: World): void {
  e.harmful = false
  e.vx = 0
  setState(e, 'squash')
  addScore(w, B.score, cx(e), e.y - 6)
  stompBounce(w)
  sfx(w, 'stomp')
  fx(w, 'mud', cx(e), e.y + e.h - 4, 6)
  rumble(w, 0.3, 0.2, 80)
}

/** Another blob it has just walked into, or null. */
function blobAhead(e: Entity, w: World): Entity | null {
  const list = w.actives
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (o === e || o.kind !== 'blob' || o.dead || (o.state !== 'walk' && o.state !== 'hit')) continue
    if (o.y >= e.y + e.h || o.y + o.h <= e.y) continue
    const gap = e.facing > 0 ? o.x - (e.x + e.w) : e.x - (o.x + o.w)
    if (gap <= 0 && gap > -e.w / 2) return o
  }
  return null
}

registerEntity('blob', {
  init(e) {
    setBox(e, B.w, B.h)
    e.hp = B.hp
    e.harmful = true
    e.state = 'walk'
    e.vars.wait = 0
    e.vars.turnX = -1e6
  },
  update(e, w) {
    if (e.state === 'pop') {
      if (e.stateT >= B.popTicks) kill(e)
      return
    }
    if (e.state === 'squash') {
      e.vx = 0
      moveBody(e, w)
      if (e.stateT >= B.squashTicks) kill(e)
      return
    }
    const v = e.vars
    if (e.state === 'hit') {
      e.vx = 0
      moveBody(e, w)
      if (e.stateT >= B.hitGap) setState(e, 'walk')
    } else if (v.wait > 0) {
      v.wait--
      e.vx = 0
      moveBody(e, w)
    } else {
      // Before the walk, so that a turn the ledge then forces is the one that stands.
      const other = blobAhead(e, w)
      if (other) {
        const headOn = other.facing !== e.facing
        if (headOn) turnAround(other)
        if (headOn || other.state === 'hit') turnAround(e)
      }
      if (patrol(e, w, propNum(e, 'speed', B.speed), e.props.edges !== false)) {
        // A one-tile pillar or pen: rather than spin on the spot every tick, it stands and looks about.
        if (Math.abs(e.x - v.turnX) < B.cramped) v.wait = B.look
        v.turnX = e.x
      }
    }
    sink(e, w)
  },
  onSpray(e, w, d) {
    if (e.state === 'pop' || e.state === 'squash') return false
    wet(w, d)
    if (e.state === 'hit') return true
    if (damage(e, d.power)) {
      popBlob(e, w)
    } else {
      setState(e, 'hit')
      fx(w, 'foam', cx(e), e.y + 6, 3)
      // It shrinks as it is washed, so its box narrows with it (2 px a stage, about its middle);
      // it keeps its height, which the gun needs to reach it.
      const mid = cx(e)
      e.w = B.w - 2 * (B.hp - e.hp)
      e.x = mid - e.w / 2
    }
    return true
  },
  onTouch(e, w, side) {
    if (e.state === 'pop' || e.state === 'squash') return true
    if (w.player.wax > 0) {
      popBlob(e, w)
      return true
    }
    if (side !== 'stomp') return false
    squashBlob(e, w)
    return true
  },
})

/* ------------------------------------------------------------------ */
/* bird: the grackle, and its splat                                    */
/* ------------------------------------------------------------------ */

const G = CRITTERS.bird
const S = CRITTERS.splat
const TWO_PI = Math.PI * 2

/** A floor of any kind (solid or catwalk) at this world point. */
function floorAt(w: World, px: number, py: number): boolean {
  const info = tileInfoAt(w, Math.floor(px / TILE), Math.floor(py / TILE))
  return info.solid || info.oneWay
}

function edgeInTile(w: World, x: number, bw: number, py: number): boolean {
  return solidAt(w, x + 1, py) || solidAt(w, x + bw / 2, py) || solidAt(w, x + bw - 1, py)
}

/** `y`, moved as little as it takes to keep a bw x bh box at x out of solid tiles: the wave flattens against a ceiling or a floor. */
function clearOfTiles(w: World, x: number, y: number, bw: number, bh: number): number {
  if (edgeInTile(w, x, bw, y)) y = (Math.floor(y / TILE) + 1) * TILE
  const low = y + bh - 0.5
  if (edgeInTile(w, x, bw, low)) y = Math.floor(low / TILE) * TILE - bh
  return y
}

/** Where a splat's feet start: its box just under the bird's. */
const dropFeet = (e: Entity): number => e.y + e.h + S.h

/** Room under the bird for a splat to start falling (it would begin inside a ledge or a catwalk otherwise). */
function dropClear(e: Entity, w: World): boolean {
  const x = cx(e)
  return !floorAt(w, x, e.y + e.h + 1) && !floorAt(w, x, dropFeet(e) - 1)
}

function shooBird(e: Entity, w: World): void {
  // Away from Maxx, so it never leaves through him.
  const away = dxToPlayer(e, w) > 0 ? -1 : 1
  e.hp = 0
  e.harmful = false
  e.vars.dir = away
  e.facing = away
  e.vx = away * 50
  e.vy = -70
  e.vars.fx = cx(e)
  e.vars.fy = cy(e)
  setState(e, 'flee')
  addScore(w, G.score, cx(e), e.y - 6)
  sfx(w, 'squawk')
  fx(w, 'star', cx(e), cy(e), 3)
}

registerEntity('bird', {
  init(e) {
    setBox(e, G.w, G.h)
    e.hp = G.hp
    e.harmful = true
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.state = 'fly'
    e.vars.dir = e.facing
    e.vars.t = 0
    // Not random: init runs while the level is built, and the first drop should not depend on the seed.
    e.vars.drop = 30 + ((e.id * 17) % 30)
    e.vars.turnT = 0
  },
  update(e, w) {
    const v = e.vars
    if (e.state === 'flee') {
      e.vx += (v.dir * 140 - e.vx) * 0.08
      e.vy = Math.max(-250, e.vy - 8)
      e.x += e.vx * DT
      e.y += e.vy * DT
      if (e.stateT === 14) sfx(w, 'squawk')
      if (e.stateT >= G.fleeTicks || e.y + e.h < w.camera.y - 64) kill(e)
      return
    }
    if (e.state === 'hit' && e.stateT >= G.hitGap) setState(e, 'fly')
    if (e.state === 'tell' && e.stateT >= G.tell) {
      if (dropClear(e, w) && shoot(w, 'splat', cx(e), dropFeet(e), 0, S.v0)) sfx(w, 'mudThrow')
      v.drop = randInt(w, G.dropMin, G.dropMax) - G.tell
      setState(e, 'fly')
    }

    // Which way: back at the end of its beat, at a wall across its own row, at the edge of the area.
    const x = cx(e)
    const range = propNum(e, 'range', G.range) * TILE
    if (v.turnT > 0) v.turnT--
    if (range > 0 && (x - (e.spawnX + e.w / 2)) * v.dir >= range) {
      v.dir = -v.dir
    } else if (v.turnT === 0) {
      const ahead = x + v.dir * (e.w / 2 + 10)
      if (solidAt(w, ahead, e.spawnY + e.h / 2) || (range > 0 && (ahead < 0 || ahead > areaWidth(w)))) {
        v.dir = -v.dir
        v.turnT = 30
      }
    }

    const speed = propNum(e, 'speed', G.speed)
    const want = e.state === 'fly' ? v.dir * speed : e.state === 'hit' ? v.dir * speed * 0.4 : 0
    e.vx += clamp(want - e.vx, -G.accel, G.accel)
    if (e.vx !== 0) e.facing = e.vx > 0 ? 1 : -1
    // It holds its height while it takes aim.
    if (e.state !== 'tell') v.t++
    e.x += e.vx * DT
    const y = clearOfTiles(w, e.x, e.spawnY + propNum(e, 'amp', G.amp) * sin((v.t * TWO_PI) / G.period), e.w, e.h)
    e.vy = (y - e.y) / DT
    e.y = y

    if (e.state !== 'fly' || Math.abs(dxToPlayer(e, w)) > G.see || dyToPlayer(e, w) <= 0) return
    if (v.drop > 0) v.drop--
    // Never a warning for a drop that could not fall (a ledge right under it): it waits till it is clear.
    if (v.drop > 0 || !dropClear(e, w)) return
    setState(e, 'tell')
    sfx(w, 'squawk')
  },
  onSpray(e, w, d) {
    if (e.state === 'flee') return false
    wet(w, d)
    if (e.state === 'hit') return true
    if (damage(e, d.power)) {
      shooBird(e, w)
    } else {
      // A hit spoils its aim: what it was about to drop stays in.
      if (e.state === 'tell') e.vars.drop = 45
      setState(e, 'hit')
    }
    return true
  },
  onTouch(e, w) {
    if (e.state === 'flee') return true
    if (w.player.wax > 0) {
      shooBird(e, w)
      return true
    }
    return false
  },
})

const SPLAT_MOVE: MoveOpts = { maxFall: S.maxFall, conveyor: false }

/** Something to stand on just under world point (x, y): a floor tile, a catwalk, or the top of a solid entity. */
function footing(w: World, x: number, y: number): boolean {
  if (floorAt(w, x, y + 1)) return true
  const list = w.solids
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    if (!s.dead && x >= s.x && x <= s.x + s.w && Math.abs(y - solidTop(s, x)) <= 2) return true
  }
  return false
}

/** A car whose roof the splat came down onto this tick (`was`: the splat's bottom before it moved). */
function carUnder(e: Entity, w: World, was: number): Entity | null {
  const x = cx(e)
  const bottom = e.y + e.h
  const list = w.actives
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (o.kind !== 'car' || o.dead || x < o.x || x > o.x + o.w) continue
    // Its roof line, not its box: over the hood a splat comes down onto the hood.
    const top = solidTop(o, x)
    if (was <= top + 2 && bottom >= top) return o
  }
  return null
}

registerEntity('splat', {
  offscreen: 'remove',
  init(e) {
    setBox(e, S.w, S.h)
    e.harmful = true
    e.gravity = S.gravity
    e.z = 1
    e.state = 'fall'
    e.vars.ride = 0
    e.vars.slid = 0
  },
  update(e, w) {
    if (e.state === 'land') {
      // On a dirty car's roof (which is not solid) it rides along with the car.
      const car = e.vars.ride > 0 ? entityById(w, e.vars.ride) : null
      if (car) e.x += car.x - car.px
      // Carried off the end of the roof line (the car turned round under it): it falls.
      const top = car ? solidTop(car, cx(e)) : Infinity
      if (Number.isFinite(top)) {
        e.y = top - e.h
      } else {
        e.vars.ride = 0
        moveBody(e, w, SPLAT_MOVE)
      }
      if (e.stateT >= S.landTicks) kill(e)
      return
    }
    const bottom = e.y + e.h
    moveBody(e, w, SPLAT_MOVE)
    if (inSludge(e, w)) {
      // Into the sludge with a plop, not onto the floor of the pit under it.
      kill(e)
      fx(w, 'mud', cx(e), e.y + e.h, 2)
      sfxEvery(w, 'splat', 4)
      return
    }
    const car = e.onGround ? null : carUnder(e, w, bottom)
    if (car) {
      e.y = solidTop(car, cx(e)) - e.h
      e.vars.ride = car.id
    } else if (!e.onGround && e.hitWall === 0 && !e.hitCeil) {
      return
    } else if (e.onGround && e.vars.slid < 2 && !footing(w, cx(e), e.y + e.h)) {
      // Caught on the very corner of a ledge or a lift: it slides off and falls on, rather
      // than splashing out over thin air.
      const y = e.y + e.h
      const x0 = e.x
      const held = (): boolean => footing(w, e.x + 0.01, y) || footing(w, e.x + e.w - 0.01, y)
      const dir = footing(w, e.x + 0.01, y) ? 1 : -1
      for (let i = 0; i <= e.w && held(); i++) e.x += dir
      e.vars.slid++
      if (!held()) {
        e.onGround = false
        return
      }
      // Footing on both sides of a narrow gap: it lands where it is.
      e.x = x0
    }
    e.harmful = false
    e.vx = 0
    e.vy = 0
    setState(e, 'land')
    sfxEvery(w, 'splat', 4)
  },
  onSpray(e, w, d) {
    if (e.state !== 'fall') return false
    wet(w, d)
    kill(e)
    fx(w, 'splash', cx(e), cy(e), 4)
    return true
  },
  onTouch(e, w) {
    if (e.state !== 'fall') return true
    if (w.player.wax > 0) {
      kill(e)
      fx(w, 'sparkle', cx(e), cy(e), 3)
      return true
    }
    // While he blinks it falls on through him.
    if (!hurtPlayer(w, { fromX: cx(e) })) return true
    kill(e)
    sfxEvery(w, 'splat', 4)
    return true
  },
})

/* ------------------------------------------------------------------ */
/* bugs                                                                */
/* ------------------------------------------------------------------ */

const U = CRITTERS.bugs

/** The swarm's box for the hits it has left: it thins toward its middle. */
function swarmSize(e: Entity): number {
  const steps = (U.size - U.minSize) / 2 + 1
  return U.minSize - 2 + 2 * clamp(Math.ceil((e.hp * steps) / e.maxHp), 1, steps)
}

function resize(e: Entity, side: number): void {
  const mx = cx(e)
  const my = cy(e)
  e.w = side
  e.h = side
  e.x = mx - side / 2
  e.y = my - side / 2
}

/** Ease its velocity toward `speed` in the direction (dx, dy). */
function steer(e: Entity, dx: number, dy: number, speed: number): void {
  const d = hypot(dx, dy)
  const wantX = d > 1 ? (dx / d) * speed : 0
  const wantY = d > 1 ? (dy / d) * speed : 0
  e.vx += clamp(wantX - e.vx, -U.accel, U.accel)
  e.vy += clamp(wantY - e.vy, -U.accel, U.accel)
  const v = hypot(e.vx, e.vy)
  if (v > speed && v > 0) {
    e.vx *= speed / v
    e.vy *= speed / v
  }
}

function scatterBugs(e: Entity, w: World): void {
  e.hp = 0
  e.harmful = false
  e.vx = 0
  e.vy = 0
  setState(e, 'scatter')
  addScore(w, U.score, cx(e), e.y - 6)
  sfx(w, 'pop')
  fx(w, 'star', cx(e), cy(e), 4)
}

registerEntity('bugs', {
  init(e) {
    setBox(e, U.size, U.size)
    e.hp = U.hp
    e.harmful = true
    e.gravity = 0
    e.collides = false
    e.z = 1
    e.vars.stun = 0
  },
  update(e, w) {
    if (e.state === 'scatter') {
      if (e.stateT >= U.scatterTicks) kill(e)
      return
    }
    const v = e.vars
    if (v.stun > 0) v.stun--
    const dx = playerCx(w) - cx(e)
    const dy = playerCy(w) - cy(e)
    const far = hypot(dx, dy)
    const range = propNum(e, 'range', U.range) * TILE
    if (e.state === 'idle') {
      steer(e, 0, 0, U.speed)
      if (far <= range) setState(e, 'alert')
    } else if (e.state === 'alert') {
      steer(e, 0, 0, U.speed)
      facePlayer(e, w)
      if (e.stateT >= U.alert) setState(e, 'chase')
    } else if (e.state === 'recoil') {
      // Up and away from him: it has had its bite.
      steer(e, dx > 0 ? -1 : 1, -0.6, U.recoilSpeed)
      if (e.stateT >= U.recoil) setState(e, 'chase')
    } else {
      steer(e, dx, dy, propNum(e, 'speed', U.speed))
      facePlayer(e, w)
      if (far > range * U.giveUp) setState(e, 'idle')
    }
    e.x += e.vx * DT
    e.y += e.vy * DT
  },
  onSpray(e, w, d) {
    if (e.state === 'scatter') return false
    wet(w, d)
    const v = e.vars
    if (v.stun > 0) return true
    if (damage(e, d.power)) {
      scatterBugs(e, w)
      return true
    }
    v.stun = U.hitGap
    resize(e, swarmSize(e))
    // Stopped dead and knocked back along the water.
    e.vx = 0
    e.vy = 0
    e.x += (Math.abs(d.vx) > 60 ? Math.sign(d.vx) : cx(e) >= playerCx(w) ? 1 : -1) * U.knock
    // Sprayed from out of its range: now it knows he is there.
    if (e.state === 'idle') setState(e, 'chase')
    return true
  },
  onTouch(e, w) {
    if (e.state === 'scatter') return true
    if (w.player.wax > 0) {
      scatterBugs(e, w)
      return true
    }
    // Handled here, not by `harmful`, so the swarm knows the sting landed and backs off.
    if (hurtPlayer(w, { fromX: cx(e) })) {
      setState(e, 'recoil')
      e.stateT = 0
    }
    return true
  },
})

/* ------------------------------------------------------------------ */
/* tumbleweed                                                          */
/* ------------------------------------------------------------------ */

const W = CRITTERS.tumbleweed

/** Another rolling tumbleweed it is bumping into, or null. */
function weedTouching(e: Entity, w: World): Entity | null {
  const list = w.actives
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (o === e || o.kind !== 'tumbleweed' || o.dead || o.state !== 'roll') continue
    if (o.x < e.x + e.w - 4 && o.x + o.w > e.x + 4 && o.y < e.y + e.h - 4 && o.y + o.h > e.y + 4) return o
  }
  return null
}

function breakWeed(e: Entity, w: World): void {
  e.hp = 0
  e.harmful = false
  e.gravity = 0
  e.vx = 0
  e.vy = 0
  setState(e, 'break')
  addScore(w, W.score, cx(e), e.y - 6)
  sfx(w, 'crumble')
  fx(w, 'dust', cx(e), cy(e), 6)
}

registerEntity('tumbleweed', {
  offscreen: 'removeBehind',
  init(e) {
    setBox(e, W.size, W.size)
    e.hp = W.hp
    e.harmful = true
    e.gravity = W.gravity
    e.state = 'roll'
    e.vars.dir = e.facing
    e.vars.hop = 0
    e.vars.push = 0
    e.vars.roll = 0
    e.vars.stun = 0
  },
  update(e, w) {
    if (e.state === 'break') {
      if (e.stateT >= W.breakTicks) kill(e)
      return
    }
    const v = e.vars
    if (v.stun > 0) v.stun--
    if (e.onGround) {
      // Every landing is the start of the next hop.
      e.vy = -W.hops[v.hop % W.hops.length]
      v.hop = (v.hop + 1) % W.hops.length
      fx(w, 'dust', cx(e), e.y + e.h, 1)
    }
    v.push *= W.pushKeep
    if (Math.abs(v.push) < 2) v.push = 0
    e.vx = v.dir * propNum(e, 'speed', W.speed) + v.push
    moveBody(e, w)
    if (e.hitWall !== 0) {
      // A wall in its way turns it round; a wall the water pressed it against just stops the shove.
      if (e.hitWall === v.dir) v.dir = -v.dir
      v.push = 0
    }
    const o = weedTouching(e, w)
    if (o) {
      // Two that meet bounce apart, and one the water drives into another hands the shove on.
      const away = cx(e) < cx(o) ? -1 : 1
      if (v.push * away < 0) {
        o.vars.push = clamp(o.vars.push + v.push, -W.pushMax, W.pushMax)
        v.push = 0
      }
      if (v.dir !== away) fx(w, 'dust', (cx(e) + cx(o)) / 2, cy(e), 2)
      v.dir = away
      o.vars.dir = -away
    }
    e.facing = v.dir > 0 ? 1 : -1
    v.roll += e.x - e.px
    sink(e, w)
  },
  onSpray(e, w, d) {
    if (e.state === 'break') return false
    wet(w, d)
    const v = e.vars
    const along = Math.abs(d.vx) > 60 ? Math.sign(d.vx) : cx(e) >= playerCx(w) ? 1 : -1
    v.push = clamp(v.push + along * W.push, -W.pushMax, W.pushMax)
    if (v.stun > 0) return true
    if (damage(e, d.power)) {
      breakWeed(e, w)
    } else {
      v.stun = W.hitGap
      fx(w, 'dust', cx(e), cy(e), 2)
    }
    return true
  },
  onTouch(e, w) {
    if (e.state === 'break') return true
    if (w.player.wax > 0) {
      breakWeed(e, w)
      return true
    }
    return false
  },
})
