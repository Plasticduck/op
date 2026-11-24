// The helper API for entity behaviours.
//
// WRITING AN ENTITY KIND
//
//   // sim/entities/blob.ts   (every file in this folder is loaded by glob)
//   import { registerEntity, setBox, patrol, damage, kill, fx, sfx, addScore, stompBounce } from '../api'
//
//   registerEntity('blob', {
//     init(e) {
//       setBox(e, 24, 20)          // size the box and stand it on the spawn tile
//       e.hp = 3
//       e.harmful = true
//     },
//     update(e, w) {
//       patrol(e, w, 30, true)     // walk, turn at walls and ledges
//     },
//     onSpray(e, w, d) {
//       if (damage(e, d.power)) { kill(e); fx(w, 'splash', e.x + e.w / 2, e.y, 6) }
//       return true                // the droplet is used up
//     },
//     onTouch(e, w, side) {
//       if (side !== 'stomp') return false   // not handled: `harmful` costs Maxx a pip
//       kill(e); stompBounce(w); addScore(w, 100, e.x, e.y); sfx(w, 'stomp')
//       return true
//     },
//   })
//
// HOW AN ENTITY LIVES
//
// - Spawn. A legend character in the level, or spawn() / shoot() at runtime. init(e, w) gets
//   e.x, e.y as the bottom-centre of the spawn tile (where feet go); call setBox(e, w, h) to
//   size and place the box. After init, e.spawnX/e.spawnY hold the box's home position.
//   Defaults: facing -1 (left) unless props.dir is 1 or 'right'; state 'idle'; hp 1; gravity
//   1; collides true; solid 'none'; harmful false; z 0. A token's slot is in e.vars.token.
//   To change size later (a jet growing), write e.x, e.y, e.w, e.h yourself.
// - Sleep. A level entity sleeps until the camera comes within TUNING.activeMargin of it,
//   then update() runs every tick. TUNING.sleepMargin outside the view it sleeps again, or
//   is removed if the behaviour says `offscreen: 'remove'` / 'removeBehind' (unless its
//   `keep(e)` holds: a counted dirty car is never thrown away). `alwaysActive`
//   skips all that. Anything that is not alwaysActive and leaves the area by
//   TUNING.areaMargin through the bottom or a side (a fall into a pit) is removed; nothing
//   is removed for flying off the top.
// - Tick order: solid entities update (the ones with collides off first, so a lift has
//   moved before a washed car standing on it), then the rest, then Maxx moves (carried by
//   whatever he rides), then droplets fly (onSpray) and the prep gun fires, then touches.
//   The framework counts e.stateT up before update(), so it is 1 on the first one;
//   setState() restarts it. Something made by spawn() is awake at once, but its first
//   update() is on the next tick. Maxx can touch it (onTouch) on the tick it appears, and
//   water cannot hit it until the tick after.
// - Touch. When Maxx's box overlaps the entity's: onTouch(e, w, side) first; if it is
//   missing or returns false and e.harmful is set, he takes a hit, knocked away from the
//   entity. side is 'stomp' (he came down onto its top), 'below' (he came up under it) or
//   'side'. Mighty Wax and the blinking after a hit already stop the generic hit; onTouch
//   still runs, so check w.player.wax > 0 there if wax should do something special.
//   Nothing touches him while he is in a pipe or door, or once the level is over.
// - Water. A droplet hits the first awake entity whose onSpray returns true; return false
//   to let it fly on. d.vx tells you which way it came from (a tumbleweed pushed back).
//   Forward spray leaves the nozzle 30 px above the floor and has dropped about 7 px half
//   way along its reach, 28 px at the end of it. So a critter that walks the floor should
//   be at least 28 px tall, or it can only be washed from three tiles off, or stomped.
// - Solid entities (e.solid 'top' or 'full') are ground: Maxx and other bodies stand on
//   them and are carried. Standing is not overlapping, so onTouch does not fire for it:
//   test w.player.ridingId === e.id instead. Move a solid entity by changing x/y in
//   update() (directly, with moveBody or with shuttle); riders follow the difference from
//   e.px/e.py. A 'top' one that rises under a ceiling slips past its rider. A 'full' one
//   is a wall too: one that moves into Maxx shoves him along, and if a wall stops him it
//   passes over him and costs him a pip (he is squeezed). When its standable top is not the
//   flat top of its box (a washed car's roof line), give it e.ground, a shared array of how far
//   below e.y the top is in each pixel column (see Entity.ground; mirror it when it turns round).
//   Anything landing on it by hand asks solidTop(s, x, width) where the top is.
// - Death. kill(e) removes it at the end of the tick. It is safe to spawn and kill
//   from update, onTouch, onSpray and onBump.
// - Looking around: w.solids and w.actives are this tick's awake entities (solid ones, and
//   the rest); w.entities is every entity of the area, asleep ones too.
// - Input for behaviours is w.input (this tick's InputFrame).
// - Everything must be deterministic: rand(w), never Math.random. No DOM, no timers. sin, cos
//   and hypot come from ./mathx, never Math (engines round them differently); no tan, atan2,
//   exp, pow, log or **. sim.mjs fails on any of them in sim/** or levels/**.
// - e.props is the level's config and is never written. e.vars is yours (numbers only).
//   e.slot says which level spawn it is (-1 if made at runtime), the same on every attempt.
//
// RECIPES FOR THE KINDS STILL TO COME
//
//   walker (blob)        patrol(e, w, speed, true); stomp in onTouch, damage() in onSpray
//   flier (bird, bugs)   init: e.gravity = 0; e.collides = false. update: set e.vx / e.vy
//                        and call moveBody, or write e.x / e.y from e.spawnX and e.stateT
//   bouncer (tumbleweed) moveBody(e, w, BOUNCE) with const BOUNCE = { bounceY: 0.8, bounceX: 1 }
//   dropper (drip, bird) if (every(e, 90, propNum(e, 'phase', 0))) shoot(w, 'splat', x, y, 0, 0)
//   projectile           offscreen: 'remove'; update: moveBody, then kill it once
//                        e.onGround || e.hitWall !== 0 || e.hitCeil (see 'clod' in entities/cars.ts)
//   trap (icicle)        wait until nearPlayer(e, w, 20) && dyToPlayer(e, w) > 0, then
//                        setState(e, 'fall'); e.gravity = 1
//   rail rider (brush)   init: e.gravity = 0; e.collides = false. update: shuttle(e, dx, dy, speed, wait)
//   timed hazard (jet)   flip e.harmful with setState and e.stateT; its box is the flame
//   wind (blower)        make the entity's box the wind zone and leave e.harmful false;
//                        onTouch: pushPlayer(w, e.facing * 1.5); return true
//   boss                 alwaysActive: true, boss: true (turbo water counts TUNING.turboBossPower
//                        on it). Phases are states: if (e.hp <= e.maxHp / 2) setState(e, 'angry').
//                        Call setBoss(w, name, e.hp, e.maxHp) each tick and clearBoss(w) when it
//                        falls; versus(w, e, name, tagline), lockCamera(w, x0, x1) and, for a
//                        song of its own, setBossMusic(w, 'boss') when the fight starts (Mighty
//                        Wax running out then hands back to the fight's song). To stay beaten
//                        after a retry: setFlag(w, 'mudslinger') when it falls, and in
//                        init: if (getFlag(w, 'mudslinger')) kill(e).
//
// WHAT IS IN HERE
//
//   events     emit sfx sfxEvery fx popup banner music jingle versus rumble shake
//   random     rand randRange randInt chance
//   tiles      tileAt tileInfoAt setTile solidAt bumpTile pipeSpan areaWidth areaHeight
//   bodies     overlaps moveBody patrol groundAhead solidTop inView shuttle
//   entities   registerEntity spawn shoot kill setState every setBox turnAround damage
//              propNum propStr propBool entityById countAlive
//   Maxx       hurtPlayer grimePlayer healPlayer giveTurbo giveWax giveLife launchPlayer
//              stompBounce pushPlayer playerCenter playerCx playerCy distToPlayer
//              dxToPlayer dyToPlayer facePlayer nearPlayer upPressed upHeld downHeld
//   score      addScore addCoins collectToken creditCar isSpotless
//   level      completeLevel warpTo setCheckpoint setBoss clearBoss setBossMusic lockCamera
//              unlockCamera getFlag setFlag areaMusic
import { COINS_PER_LIFE, DT, MAX_PIPS, TILE, VIEW_H, VIEW_W } from '../contract'
import type { JingleId, MusicId, SfxId, SpawnSpec } from '../contract'
import { WASHED_FLAG, findMarker, parseTarget } from './level'
import { hypot } from './mathx'
import { F_NO_ONEWAY, F_SOLIDS, F_TILES, carryRider, conveyorUnder, sweepX, sweepY, tileCode, tileFlags, topAt } from './physics'
import { getBehavior } from './registry'
import { AIR, TILE_BY_CODE, TILE_INFO, T_ONEWAY, T_SOLID } from './tiles'
import type { TileInfo } from './tiles'
import { TUNING } from './tuning'
import type { Body, Entity, FxId, GameEvent, HurtOpts, MoveOpts, Rect, World } from './types'

export { registerEntity } from './registry'

const USED = 'U'.charCodeAt(0)
const PIPE = 'P'.charCodeAt(0)
const NO_PROPS: Record<string, number | string | boolean> = Object.freeze({})

/* ------------------------------------------------------------------ */
/* Events: how the simulation talks to the screen and the speakers     */
/* ------------------------------------------------------------------ */

export function emit(w: World, event: GameEvent): void {
  w.events.push(event)
}

export function sfx(w: World, id: SfxId): void {
  w.events.push({ type: 'sfx', id })
}

/** A sound effect that would otherwise machine-gun: at most once every `gap` ticks. */
export function sfxEvery(w: World, id: SfxId, gap: number): void {
  const last = w.sfxAt[id]
  if (last !== undefined && w.tick - last < gap) return
  w.sfxAt[id] = w.tick
  w.events.push({ type: 'sfx', id })
}

/** Ask the renderer for `n` particles of an effect at a world position. `dir` is -1/1 for effects that fly one way. */
export function fx(w: World, id: FxId, x: number, y: number, n = 1, dir?: number): void {
  w.events.push(dir === undefined ? { type: 'fx', fx: id, x, y, n } : { type: 'fx', fx: id, x, y, n, dir })
}

/** Small floating text in the world. */
export function popup(w: World, text: string, x: number, y: number): void {
  w.events.push({ type: 'popup', text, x, y })
}

/** Big text across the screen. No em dashes: players read this. */
export function banner(w: World, text: string, ticks = 120): void {
  w.events.push({ type: 'banner', text, ticks })
}

export function music(w: World, id: MusicId | null): void {
  w.events.push({ type: 'music', id })
}

export function jingle(w: World, id: JingleId): void {
  w.events.push({ type: 'jingle', id })
}

/** A boss or rival appears: the play scene shows its card, with `e` drawn on it by its own renderer. */
export function versus(w: World, e: Entity, name: string, tagline: string): void {
  w.events.push({ type: 'versus', id: e.id, name, tagline })
}

/** Shake the controller. Magnitudes 0..1. */
export function rumble(w: World, strong: number, weak: number, ms: number): void {
  w.events.push({ type: 'rumble', strong, weak, ms })
}

export function shake(w: World, ticks: number, mag: number): void {
  w.events.push({ type: 'shake', ticks, mag })
}

/* ------------------------------------------------------------------ */
/* Random                                                              */
/* ------------------------------------------------------------------ */

/** 0 <= n < 1, from the world's own seed. The same inputs always give the same numbers. */
export function rand(w: World): number {
  let t = (w.seed = (w.seed + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function randRange(w: World, a: number, b: number): number {
  return a + (b - a) * rand(w)
}

/** A whole number from a to b, both included. */
export function randInt(w: World, a: number, b: number): number {
  return a + Math.floor(rand(w) * (b - a + 1))
}

export function chance(w: World, p: number): boolean {
  return rand(w) < p
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

/** The tile character at a tile position. Outside the area is ' '. */
export function tileAt(w: World, tx: number, ty: number): string {
  return String.fromCharCode(tileCode(w, tx, ty))
}

export function tileInfoAt(w: World, tx: number, ty: number): TileInfo {
  return TILE_BY_CODE[tileCode(w, tx, ty)] ?? TILE_INFO[' ']
}

/** Change a tile. Anything that is not a tile character (or lies outside the area) is ignored. */
export function setTile(w: World, tx: number, ty: number, ch: string): void {
  const g = w.grid
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h || !TILE_INFO[ch]) return
  const i = ty * g.w + tx
  g.t[i] = ch.charCodeAt(0)
  g.d[i] = 0
}

/** Is the tile under this pixel a wall or floor? (Catwalks and hidden blocks are not.) */
export function solidAt(w: World, px: number, py: number): boolean {
  return (tileFlags(w, Math.floor(px / TILE), Math.floor(py / TILE)) & T_SOLID) !== 0
}

/**
 * The pipe whose top row includes tile (tx, ty): its left edge and width in
 * pixels. Null if that tile is not pipe.
 */
export function pipeSpan(w: World, tx: number, ty: number): { x: number; w: number } | null {
  if (tileCode(w, tx, ty) !== PIPE) return null
  let left = tx
  let right = tx
  while (tileCode(w, left - 1, ty) === PIPE) left--
  while (tileCode(w, right + 1, ty) === PIPE) right++
  return { x: left * TILE, w: (right - left + 1) * TILE }
}

/** Size of the current area in pixels. */
export function areaWidth(w: World): number {
  return w.grid.w * TILE
}
export function areaHeight(w: World): number {
  return w.grid.h * TILE
}

/**
 * Hit a block from below, as Maxx's head does: bricks break, prize blocks pay
 * out, hidden blocks appear. Anything standing on the block gets onBump.
 */
export function bumpTile(w: World, tx: number, ty: number): void {
  const g = w.grid
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return
  const i = ty * g.w + tx
  const info = TILE_BY_CODE[g.t[i]]
  if (!info || info.bump === 'none') return
  if (info.bump === 'thud') {
    sfxEvery(w, 'bump', 8)
    return
  }
  const cx = tx * TILE + TILE / 2
  const top = ty * TILE
  switch (info.bump) {
    case 'break':
      g.t[i] = AIR
      sfx(w, 'brick')
      fx(w, 'debris', cx, top + TILE / 2, 6)
      addScore(w, TUNING.brickScore)
      break
    case 'coins':
      g.d[i]++
      coinOut(w, cx, top)
      if (g.d[i] >= TUNING.coinBrickCoins) {
        g.t[i] = USED
        g.d[i] = 0
      }
      break
    case 'coin':
      g.t[i] = USED
      coinOut(w, cx, top)
      break
    case 'power':
      g.t[i] = USED
      prizeOut(w, w.player.pips < MAX_PIPS ? 'bubble' : 'turbo', tx, ty)
      break
    case 'wax':
      g.t[i] = USED
      prizeOut(w, 'wax', tx, ty)
      break
    case 'life':
      g.t[i] = USED
      prizeOut(w, 'oneup', tx, ty)
      break
  }
  if (info.bump !== 'break') w.bumps.push({ tx, ty, t: 0 })
  rumble(w, 0.2, 0.35, 60)

  const ents = w.entities
  const left = tx * TILE
  for (let k = 0; k < ents.length; k++) {
    const e = ents[k]
    if (!e.active || e.dead) continue
    if (e.x >= left + TILE || e.x + e.w <= left) continue
    const gap = top - (e.y + e.h)
    if (gap < -2 || gap > 8) continue
    getBehavior(e.kind)?.onBump?.(e, w)
  }
}

function coinOut(w: World, cx: number, top: number): void {
  addCoins(w, 1)
  sfx(w, 'coin')
  fx(w, 'coin', cx, top, 1)
}

/** The prize starts inside its block and rises out of the top (the pickups handle `props.pop`). */
function prizeOut(w: World, kind: string, tx: number, ty: number): void {
  spawn(w, kind, tx * TILE + TILE / 2, (ty + 1) * TILE, { props: POP })
  sfx(w, 'prize')
}
const POP: Record<string, number | string | boolean> = Object.freeze({ pop: true })

/* ------------------------------------------------------------------ */
/* Bodies                                                              */
/* ------------------------------------------------------------------ */

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * One tick of physics for a body: gravity, then its velocity, stopped by
 * tiles and solid entities. Sets onGround, hitWall and hitCeil. While it
 * stands on a conveyor, a lift or a washed car it is carried along.
 * Hitting a wall zeroes vx, so a walker sets vx again every tick (see patrol).
 */
export function moveBody(b: Body, w: World, opts?: MoveOpts): void {
  const own = b as Body & { gravity?: number; collides?: boolean }
  const grav = opts?.gravity ?? own.gravity ?? 1
  const collide = opts?.collide ?? own.collides ?? true
  b.hitWall = 0
  b.hitCeil = false
  if (grav !== 0) b.vy = Math.min(b.vy + grav * TUNING.gravFall * DT, opts?.maxFall ?? TUNING.fallCap)
  if (!collide) {
    b.x += b.vx * DT
    b.y += b.vy * DT
    b.onGround = false
    return
  }
  let flags = F_TILES
  if (opts?.solids !== false && w.solids.length > 0) flags |= F_SOLIDS
  if (opts?.oneWay === false) flags |= F_NO_ONEWAY
  if (b.onGround) {
    if (flags & F_SOLIDS) carryRider(w, b)
    if (opts?.conveyor !== false) {
      const belt = conveyorUnder(w, b)
      if (belt !== 0) sweepX(w, b, belt * TUNING.conveyorSpeed * DT, flags)
    }
  }
  const dx = b.vx * DT
  const dy = b.vy * DT
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / TUNING.maxStep))
  let sx = dx / steps
  let sy = dy / steps
  let landed = false
  for (let i = 0; i < steps; i++) {
    if (sx !== 0) {
      const hit = sweepX(w, b, sx, flags)
      if (hit !== 0) {
        b.hitWall = hit
        const keep = opts?.bounceX ?? 0
        b.vx = keep > 0 ? -b.vx * keep : 0
        sx = keep > 0 ? -sx * keep : 0
      }
    }
    if (sy !== 0) {
      const hit = sweepY(w, b, sy, flags)
      if (hit === 1) {
        landed = true
        const keep = opts?.bounceY ?? 0
        // Below this speed a bounce would only be a buzz on the floor.
        b.vy = keep > 0 && b.vy > 120 ? -b.vy * keep : 0
        sy = 0
      } else if (hit === -1) {
        b.hitCeil = true
        b.vy = 0
        sy = 0
      }
    }
  }
  b.onGround = landed
}

/**
 * Walk in the direction it faces at `speed`, turning round at walls (and at
 * ledges when `turnAtEdges`). Returns true on the tick it turns.
 */
export function patrol(e: Entity, w: World, speed: number, turnAtEdges = false, opts?: MoveOpts): boolean {
  let turned = false
  if (turnAtEdges && e.onGround && !groundAhead(e, w)) {
    turnAround(e)
    turned = true
  }
  e.vx = e.facing * speed
  moveBody(e, w, opts)
  if (e.hitWall !== 0 && e.hitWall === e.facing) {
    turnAround(e)
    turned = true
  }
  return turned
}

/** Is there floor just in front of its leading foot? False at a ledge (and at a drop in a ground profile bigger than TUNING.groundStep). */
export function groundAhead(e: Entity, w: World, reach = 2): boolean {
  const x = e.facing > 0 ? e.x + e.w + reach : e.x - reach
  const y = e.y + e.h + 2
  if (tileFlags(w, Math.floor(x / TILE), Math.floor(y / TILE)) & (T_SOLID | T_ONEWAY)) return true
  const solids = w.solids
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    if (s === e || s.dead || x < s.x || x > s.x + s.w) continue
    if (s.ground === null ? Math.abs(y - s.y) <= 4 : Math.abs(topAt(s, s.x, s.y, x, 0) - (e.y + e.h)) <= TUNING.groundStep) return true
  }
  return false
}

/**
 * The top of solid entity `s` under world x .. x + width (0: a point): where something landing
 * there comes to rest. The highest point of its ground profile there, else its box top; Infinity
 * where the span misses its profile.
 */
export function solidTop(s: Entity, x: number, width = 0): number {
  return topAt(s, s.x, s.y, x, width)
}

/** Is the box on screen, give or take `margin` pixels? */
export function inView(r: Rect, w: World, margin = 0): boolean {
  const c = w.camera
  return r.x < c.x + VIEW_W + margin && r.x + r.w > c.x - margin && r.y < c.y + VIEW_H + margin && r.y + r.h > c.y - margin
}

/**
 * Slide to and fro along a straight rail, from where it was placed to (dx, dy) pixels
 * away and back, at `speed` px/s, resting `wait` ticks at each end: a lift, a brush on
 * its rail. Call it every tick from update(), instead of moveBody. It keeps its place in
 * e.vars.t (0..1 along the rail; set it in init to start part-way), e.vars.dir and
 * e.vars.wait (ticks of rest left), and sets e.vx / e.vy to the speed it moved at.
 * Riders are carried if the entity is solid. Returns true on the tick it reaches an end.
 */
export function shuttle(e: Entity, dx: number, dy: number, speed: number, wait = 0): boolean {
  const v = e.vars
  if (v.dir === undefined) {
    v.t = v.t ?? 0
    v.dir = 1
    v.wait = v.wait ?? 0
  }
  const run = Math.sqrt(dx * dx + dy * dy)
  e.vx = 0
  e.vy = 0
  if (!(run > 0) || !(speed > 0)) return false
  if (v.wait > 0) {
    v.wait--
    return false
  }
  v.t += (v.dir * speed * DT) / run
  const arrived = v.t >= 1 || v.t <= 0
  if (arrived) {
    v.t = v.t >= 1 ? 1 : 0
    v.dir = -v.dir
    v.wait = Math.max(0, Math.round(wait))
  }
  // Placed from its home every tick, so it can never drift off its rail.
  const x = e.spawnX + dx * v.t
  const y = e.spawnY + dy * v.t
  e.vx = (x - e.x) / DT
  e.vy = (y - e.y) / DT
  e.x = x
  e.y = y
  return arrived
}

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build an entity and run its init. (x, y) is where its feet go. Used for
 * level spawns (asleep) and by spawn() (awake). Null if nothing is registered
 * for the kind.
 */
export function makeEntity(
  w: World,
  kind: string,
  x: number,
  y: number,
  variant: string | undefined,
  props: Record<string, number | string | boolean> | undefined,
  token: number,
  slot = -1,
): Entity | null {
  const beh = getBehavior(kind)
  if (!beh) return null
  const cfg = props ?? NO_PROPS
  const e: Entity = {
    x,
    y,
    w: 0,
    h: 0,
    vx: 0,
    vy: 0,
    onGround: false,
    hitWall: 0,
    hitCeil: false,
    id: w.nextId++,
    kind,
    variant: variant ?? '',
    facing: cfg.dir === 1 || cfg.dir === 'right' ? 1 : -1,
    state: 'idle',
    stateT: 0,
    hp: 1,
    maxHp: 1,
    active: false,
    dead: false,
    harmful: false,
    solid: 'none',
    ground: null,
    gravity: 1,
    collides: true,
    z: 0,
    props: cfg,
    vars: {},
    spawnX: x,
    spawnY: y,
    px: x,
    py: y,
    slot,
  }
  if (token >= 0) e.vars.token = token
  beh.init(e, w)
  if (e.maxHp < e.hp) e.maxHp = e.hp
  e.spawnX = e.x
  e.spawnY = e.y
  e.px = e.x
  e.py = e.y
  return e
}

/**
 * Add an entity to the area Maxx is in, awake at once. (x, y) is where its
 * feet go: the bottom-centre of its box once init has called setBox. Returns
 * null if no behaviour is registered for the kind.
 */
export function spawn(w: World, kind: string, x: number, y: number, spec?: Partial<SpawnSpec>): Entity | null {
  const e = makeEntity(w, kind, x, y, spec?.variant, spec?.props, -1)
  if (!e) return null
  e.active = true
  w.entities.push(e)
  return e
}

/**
 * spawn() for something thrown or dropped (a clod, a splat, a drip): it starts with its
 * feet point at (x, y), moving at (vx, vy) px/s and facing the way it flies.
 */
export function shoot(w: World, kind: string, x: number, y: number, vx: number, vy: number, spec?: Partial<SpawnSpec>): Entity | null {
  const e = spawn(w, kind, x, y, spec)
  if (!e) return null
  e.vx = vx
  e.vy = vy
  if (vx !== 0) e.facing = vx > 0 ? 1 : -1
  return e
}

/** Remove it at the end of this tick. */
export function kill(e: Entity): void {
  e.dead = true
}

/** Switch state and restart its stateT clock. Returns false (and leaves stateT alone) if it was already in that state. */
export function setState(e: Entity, state: string): boolean {
  if (e.state === state) return false
  e.state = state
  e.stateT = 0
  return true
}

/**
 * True once every `period` ticks of the entity's current state, `phase` ticks in: the
 * beat for a drip, a jet, a thrower. (It reads e.stateT, which setState() restarts.)
 */
export function every(e: Entity, period: number, phase = 0): boolean {
  const n = Math.floor(period)
  return n >= 1 && (e.stateT - Math.floor(phase)) % n === 0
}

/**
 * For init: give the entity its size and stand it on the spawn point, which
 * arrives in (e.x, e.y) as the bottom-centre of the spawn tile. `lift` raises
 * it off the floor (16 centres a 0-high point in the tile).
 */
export function setBox(e: Entity, width: number, height: number, lift = 0): void {
  e.x -= width / 2
  e.y -= height + lift
  e.w = width
  e.h = height
}

export function turnAround(e: Entity): void {
  e.facing = e.facing === 1 ? -1 : 1
}

/** Take `amount` off e.hp. True when that used it up. */
export function damage(e: Entity, amount: number): boolean {
  e.hp = Math.max(0, e.hp - amount)
  return e.hp <= 0
}

/** Read level config (SpawnSpec.props) with a fallback. */
export function propNum(e: Entity, name: string, fallback: number): number {
  const v = e.props[name]
  return typeof v === 'number' ? v : fallback
}
export function propStr(e: Entity, name: string, fallback: string): string {
  const v = e.props[name]
  return typeof v === 'string' ? v : fallback
}
export function propBool(e: Entity, name: string, fallback: boolean): boolean {
  const v = e.props[name]
  return typeof v === 'boolean' ? v : fallback
}

export function entityById(w: World, id: number): Entity | null {
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) if (ents[i].id === id) return ents[i].dead ? null : ents[i]
  return null
}

/** How many live entities of a kind the current area holds (optionally only one variant). */
export function countAlive(w: World, kind: string, variant?: string): number {
  let n = 0
  const ents = w.entities
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]
    if (!e.dead && e.kind === kind && (variant === undefined || e.variant === variant)) n++
  }
  return n
}

/* ------------------------------------------------------------------ */
/* Maxx                                                                */
/* ------------------------------------------------------------------ */

function playerBusy(w: World): boolean {
  const s = w.player.state
  return w.status !== 'play' || w.warp !== null || s === 'grimed' || s === 'warp' || s === 'clear'
}

/**
 * Cost Maxx a shine pip: knockback, blinking, the turbo nozzle lost. At 0
 * pips he is GRIMED. Returns false if nothing happened (he is blinking, waxed,
 * or the level is already over).
 */
export function hurtPlayer(w: World, opts?: HurtOpts): boolean {
  if (playerBusy(w)) return false
  const p = w.player
  if (!opts?.force && (p.invuln > 0 || p.wax > 0)) return false
  p.pips = Math.max(0, p.pips - 1)
  p.turbo = false
  if (p.pips <= 0) {
    grimePlayer(w)
    return true
  }
  const cx = p.x + p.w / 2
  const away = opts?.fromX === undefined || opts.fromX === cx ? -p.facing : cx < opts.fromX ? -1 : 1
  p.state = 'hurt'
  p.stateT = 0
  p.invuln = TUNING.invulnTicks
  p.vx = away * TUNING.knockX
  // The hop is off the ground only. In the air a hit may slow a rise but never lifts him or
  // stops a fall: a hit there would be a second jump, over a 5-tile wall or an 11-tile pit.
  p.vy = p.onGround ? -TUNING.knockY : Math.max(p.vy, -TUNING.knockY)
  p.onGround = false
  p.coyote = 0
  p.ridingId = 0
  p.jumping = false
  p.spraying = false
  p.hovering = false
  p.skidding = false
  sfx(w, 'hurt')
  fx(w, 'mud', cx, p.y + p.h / 2, 6)
  rumble(w, 0.7, 0.5, 180)
  shake(w, 6, 3)
  return true
}

/** GRIMED at once, whatever his shine (sludge, a pit, a boss's worst). */
export function grimePlayer(w: World): void {
  endInGrime(w, 'grimed', 'GRIMED!')
}

/** The simulation's own two ways to lose: out of shine, or out of time. */
export function endInGrime(w: World, status: 'grimed' | 'timeup', text: string): void {
  if (w.status !== 'play') return
  const p = w.player
  w.status = status
  w.statusT = 0
  w.warp = null
  p.state = 'grimed'
  p.stateT = 0
  p.pips = 0
  p.turbo = false
  p.wax = 0
  p.invuln = 0
  p.spraying = false
  p.hovering = false
  p.skidding = false
  p.jumping = false
  p.ridingId = 0
  p.vx = 0
  p.vy = -TUNING.grimeHop
  p.onGround = false
  w.session.pips = 0
  w.session.turbo = false
  banner(w, text, 120)
  jingle(w, 'grimed')
  fx(w, 'mud', p.x + p.w / 2, p.y + p.h / 2, 14)
  rumble(w, 1, 0.8, 450)
  shake(w, 12, 4)
}

/** Give back shine. Returns false if he was already full. */
export function healPlayer(w: World, pips = 1): boolean {
  const p = w.player
  if (p.pips >= MAX_PIPS) return false
  p.pips = Math.min(MAX_PIPS, p.pips + pips)
  sfx(w, 'heal')
  return true
}

export function giveTurbo(w: World): void {
  w.player.turbo = true
  sfx(w, 'powerup')
}

/** Mighty Wax: invincible for TUNING.waxTicks, and the wax song plays. */
export function giveWax(w: World, ticks = TUNING.waxTicks): void {
  w.player.wax = ticks
  sfx(w, 'waxStart')
  music(w, 'wax')
}

export function giveLife(w: World): void {
  const p = w.player
  if (w.session.lives < TUNING.maxLives) w.session.lives++
  sfx(w, 'oneUp')
  popup(w, '1UP', p.x + p.w / 2, p.y - 6)
}

/**
 * Throw Maxx upward at `speed` px/s (a spring, a geyser). He keeps the full
 * height whether or not the jump button is held, and gets his hover back.
 */
export function launchPlayer(w: World, speed: number): void {
  const p = w.player
  p.vy = -speed
  p.onGround = false
  p.coyote = 0
  p.ridingId = 0
  p.jumping = false
  p.jumpCut = false
  p.jumpBuf = 0
  p.hover = TUNING.hoverTicks
}

/** The hop after stomping something: higher with the jump button held. */
export function stompBounce(w: World): void {
  launchPlayer(w, w.input.held.jump ? TUNING.stompBounceHeld : TUNING.stompBounce)
}

/** Shove Maxx by (dx, dy) pixels this tick, stopped by walls: wind, a pushing arm. */
export function pushPlayer(w: World, dx: number, dy = 0): void {
  if (playerBusy(w)) return
  const p = w.player
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / TUNING.maxStep))
  for (let i = 0; i < steps; i++) {
    if (dx !== 0) sweepX(w, p, dx / steps, F_TILES | F_SOLIDS)
    if (dy !== 0) sweepY(w, p, dy / steps, F_TILES | F_SOLIDS)
  }
}

/** Up was pushed on this very tick, on the D-pad, a key or the stick (how a door is entered). */
export function upPressed(w: World): boolean {
  return w.input.pressed.up || (w.input.axisY < -TUNING.stickPress && w.lastAxisY >= -TUNING.stickPress)
}
/** Up or down is being held, on the D-pad, a key or the stick. */
export function upHeld(w: World): boolean {
  return w.input.held.up || w.input.axisY < -TUNING.stickPress
}
export function downHeld(w: World): boolean {
  return w.input.held.down || w.input.axisY > TUNING.stickPress
}

/** The middle of Maxx's box. Allocates: in a hot loop use playerCx / playerCy. */
export function playerCenter(w: World): { x: number; y: number } {
  return { x: playerCx(w), y: playerCy(w) }
}
export function playerCx(w: World): number {
  return w.player.x + w.player.w / 2
}
export function playerCy(w: World): number {
  return w.player.y + w.player.h / 2
}

/** Horizontal distance from the entity's middle to Maxx's: positive when he is to its right. */
export function dxToPlayer(e: Rect, w: World): number {
  return playerCx(w) - (e.x + e.w / 2)
}
/** Vertical distance, middle to middle: positive when he is below it. */
export function dyToPlayer(e: Rect, w: World): number {
  return playerCy(w) - (e.y + e.h / 2)
}
/** Straight-line distance, middle to middle. */
export function distToPlayer(e: Rect, w: World): number {
  return hypot(dxToPlayer(e, w), dyToPlayer(e, w))
}

export function facePlayer(e: Entity, w: World): void {
  e.facing = dxToPlayer(e, w) < 0 ? -1 : 1
}

/** Is Maxx's middle within `rx` pixels sideways (and `ry` up or down) of the entity's? */
export function nearPlayer(e: Rect, w: World, rx: number, ry = Infinity): boolean {
  return Math.abs(dxToPlayer(e, w)) <= rx && Math.abs(dyToPlayer(e, w)) <= ry
}

/* ------------------------------------------------------------------ */
/* Score                                                               */
/* ------------------------------------------------------------------ */

/** Add points (the counters stop at TUNING.maxScore). With a position, the number floats up from there. */
export function addScore(w: World, points: number, x?: number, y?: number): void {
  if (!Number.isFinite(points)) return
  w.session.score = Math.max(0, Math.min(TUNING.maxScore, w.session.score + points))
  w.stats.score = Math.max(0, Math.min(TUNING.maxScore, w.stats.score + points))
  if (x !== undefined && y !== undefined) popup(w, String(points), x, y)
}

/** Add coins (and their points). Every COINS_PER_LIFE is an extra life. */
export function addCoins(w: World, n: number): void {
  if (!(n >= 1)) return
  const coins = Math.min(Math.floor(n), 9999)
  w.stats.coins += coins
  w.session.coins += coins
  addScore(w, coins * TUNING.coinScore)
  while (w.session.coins >= COINS_PER_LIFE) {
    w.session.coins -= COINS_PER_LIFE
    giveLife(w)
  }
}

/** Mark one of the level's three gold tokens as found. */
export function collectToken(w: World, index: number): void {
  if (index >= 0 && index <= 2) w.stats.tokens[index] = true
}

/**
 * Count a washed car toward the level's total, once only. The credit goes into
 * world.flags, so a retry from a checkpoint starts with it and washing the same car
 * again adds nothing. The car is known by its level spawn (e.slot), or, if something
 * sent it at runtime, by e.vars.from (the sender's slot) and e.vars.n (which of the
 * sender's cars it is). Returns false if it had been counted before.
 */
export function creditCar(e: Entity, w: World): boolean {
  const who = e.slot >= 0 ? String(e.slot) : e.vars.from >= 0 ? `${e.vars.from}.${e.vars.n ?? 0}` : ''
  if (who !== '') {
    const name = `${WASHED_FLAG}${w.area.id}:${who}`
    if (w.flags[name]) return false
    w.flags[name] = 1
  }
  w.stats.carsWashed++
  return true
}

/** Every car in the level has been washed. */
export function isSpotless(w: World): boolean {
  return w.stats.carsTotal > 0 && w.stats.carsWashed >= w.stats.carsTotal
}

/* ------------------------------------------------------------------ */
/* Level flow                                                          */
/* ------------------------------------------------------------------ */

export interface CompleteOpts {
  /**
   * false: no victory walk. He coasts to a stop on the ground (as if the stick were let go), or
   * keeps falling straight on if he is in the air. Default true.
   */
  walk?: boolean
  /**
   * With walk false: the world x where the middle of his feet comes to rest. On the ground he is
   * given just the speed that coasts him there; in the air he drops straight down.
   */
  stopAt?: number
}

/**
 * Win the level. Maxx goes into his victory walk (unless opts.walk is false: an exit that takes
 * him in, such as the EMPLOYEES ONLY door) and world.status becomes 'clear'.
 */
export function completeLevel(w: World, exit: 'goal' | 'secret', opts?: CompleteOpts): void {
  if (w.status !== 'play') return
  const p = w.player
  w.status = 'clear'
  w.statusT = 0
  w.exit = exit
  w.warp = null
  w.clearWalk = opts?.walk !== false
  p.state = 'clear'
  p.stateT = 0
  p.invuln = 0
  p.spraying = false
  p.hovering = false
  p.skidding = false
  p.jumping = false
  if (!w.clearWalk && opts?.stopAt !== undefined) coastTo(w, opts.stopAt)
  if (exit === 'secret') {
    emit(w, { type: 'secret' })
    jingle(w, 'secret')
  } else {
    jingle(w, 'clear')
  }
}

/** Just the speed that brings the middle of his feet to rest at world x, braking as he does with the stick let go. */
function coastTo(w: World, x: number): void {
  const p = w.player
  if (!p.onGround) {
    p.vx = 0
    return
  }
  const dx = x - (p.x + p.w / 2)
  const decel = TUNING.groundDecel * (p.floor !== '' ? (TILE_INFO[p.floor]?.grip ?? 1) : 1)
  // v^2 = 2ad, plus half a tick of braking: he brakes before he moves on every tick, so without it he stops short.
  p.vx = dx === 0 ? 0 : Math.sign(dx) * (Math.sqrt(2 * decel * Math.abs(dx)) + (decel * DT) / 2)
}

/**
 * Send Maxx through a pipe or door to 'areaId:markerName' (a bare
 * 'markerName' stays in this area). 'pipe' slides him down out of sight and,
 * if the arrival point sits on a pipe, back up out of it; 'door' is a quick
 * cut. `centerX` is the world x he lines up on first (the middle of the pipe).
 * Returns false if he cannot go now or the target does not exist.
 */
export function warpTo(w: World, to: string, mode: 'pipe' | 'door' = 'door', centerX?: number): boolean {
  if (playerBusy(w) || w.warpLock || w.player.state !== 'normal') return false
  const target = parseTarget(to, w.area.id)
  const dest = w.areas[target.area]
  if (!dest || !findMarker(dest, target.marker)) return false
  const p = w.player
  w.warp = {
    mode,
    phase: 'out',
    t: 0,
    ticks: mode === 'pipe' ? TUNING.pipeOutTicks : TUNING.doorOutTicks,
    toArea: target.area,
    toMarker: target.marker,
    fromX: p.x,
    fromY: p.y,
    toX: centerX === undefined ? p.x : centerX - p.w / 2,
  }
  p.state = 'warp'
  p.stateT = 0
  p.vx = 0
  p.vy = 0
  p.spraying = false
  p.hovering = false
  p.skidding = false
  p.jumping = false
  // A jump pressed just before the pipe must not fire on the far side.
  p.jumpBuf = 0
  sfx(w, mode === 'pipe' ? 'pipe' : 'door')
  return true
}

/** Make (x, y), the spot for the middle of Maxx's feet in this area, the place a retry starts. */
export function setCheckpoint(w: World, x: number, y: number): void {
  w.checkpoint = { areaId: w.area.id, x, y }
  emit(w, { type: 'checkpoint' })
  sfx(w, 'checkpoint')
}

/** Show (or update) the boss bar in the HUD. */
export function setBoss(w: World, name: string, hp: number, maxHp: number): void {
  if (w.boss) {
    w.boss.name = name
    w.boss.hp = hp
    w.boss.maxHp = maxHp
  } else {
    w.boss = { name, hp, maxHp }
  }
}

/**
 * The fight is over: the HUD bar goes, and so does the fight's song as the song of the moment
 * (setBossMusic). It asks for no music itself: follow it with music(w, areaMusic(w)) to hand the
 * speakers back to the level, or music(w, null) to hold a silence.
 */
export function clearBoss(w: World): void {
  w.boss = null
  w.bossMusic = null
}

/**
 * A boss or rival fight's song: it plays at once, and areaMusic() names it until clearBoss() or
 * until Maxx leaves the area. So when Mighty Wax runs out mid-fight, or anything else asks for the
 * song of the moment, the fight's song comes back, not the level's. (Wax picked up during the
 * fight still plays its own tune while it lasts.)
 */
export function setBossMusic(w: World, id: MusicId): void {
  w.bossMusic = id
  music(w, id)
}

/**
 * A boss arena: hold the camera between world x `x0` and `x1` and keep Maxx between
 * them too. The camera slides into place rather than jumping, and Maxx is never moved:
 * if he is outside when the lock comes on he can walk in, not further out. The lock
 * ends with unlockCamera(), or when he leaves the area.
 */
export function lockCamera(w: World, x0: number, x1: number): void {
  const lo = Math.max(0, Math.min(x0, x1))
  w.camBounds = { x0: lo, x1: Math.max(lo + VIEW_W, x0, x1) }
}

export function unlockCamera(w: World): void {
  w.camBounds = null
}

/** Level scripting flags: numbers kept across areas and across retries from a checkpoint. Unset reads as 0. */
export function getFlag(w: World, name: string): number {
  return w.flags[name] ?? 0
}
export function setFlag(w: World, name: string, value = 1): void {
  w.flags[name] = value
}

/** The song that belongs to this moment: the wax tune, else the fight's (setBossMusic), else the area's, else the level's. */
export function areaMusic(w: World): MusicId {
  return w.player.wax > 0 ? 'wax' : (w.bossMusic ?? w.area.music ?? w.level.music)
}
