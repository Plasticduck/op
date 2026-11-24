// Secret rivals 3 and 4: SLICK OLLIE and NIMBUS NICK, and everything they throw
// (sim/entities/rival_ollie.ts, rival_nick.ts; art from scripts/maxx/art-rivals-b.mjs).
// The states and vars each one reads are listed in the header of its sim file.
import { TILE } from '../../contract'
import { TILE_FLAGS, T_ONEWAY, T_SOLID } from '../../sim'
import type { World } from '../../sim/types'
import { registerRenderer } from '../registry'
import type { RenderCtx } from '../registry'
import { drawTileAs } from '../tiles'

const ATLAS = 'rivals_b'
const NONE: readonly string[] = []
const cache = new Map<string, readonly string[]>()
const FLIP = { flipX: true }
const FADE = { alpha: 0.45 }
const HALF_FADE = { alpha: 0.6 }

/** The frames of an animation, looked up once (names are module constants, so nothing is built per frame). */
function frames(rc: RenderCtx, anim: string): readonly string[] {
  let f = cache.get(anim)
  if (f === undefined) {
    f = rc.sprites.anim(ATLAS, anim)
    if (f.length === 0) return NONE
    cache.set(anim, f)
  }
  return f
}

/** Animation names by stage, built once: NAMES[stage][pose]. */
function names(prefix: string, stages: number, poses: readonly string[]): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (let s = 0; s < stages; s++) {
    const row: Record<string, string> = {}
    for (const p of poses) row[p] = prefix + s + p
    out.push(row)
  }
  return out
}

/** Frame `i` of an animation, wrapped. */
function pick(f: readonly string[], i: number): string {
  return f.length ? f[((i % f.length) + f.length) % f.length] : ''
}

/** The top of the first catwalk or solid tile at or below y in world column x. */
function surfaceBelow(w: World, x: number, y: number, floor: number): number {
  const g = w.grid
  const tx = Math.floor(x / TILE)
  if (tx < 0 || tx >= g.w) return floor
  const last = Math.min(g.h, Math.round(floor / TILE))
  for (let ty = Math.max(0, Math.floor(y / TILE)); ty < last; ty++) {
    if (TILE_FLAGS[g.t[ty * g.w + tx]] & (T_SOLID | T_ONEWAY)) return ty * TILE
  }
  return floor
}

/* ------------------------------------------------------------------ */
/* Slick Ollie                                                         */
/* ------------------------------------------------------------------ */

const OLLIE_POSES = ['idle', 'hit', 'bow', 'squirtTell', 'squirt', 'glide', 'windup', 'dizzy', 'crouch', 'air', 'land', 'shuffle', 'lean', 'refill', 'burp', 'stagger', 'slide', 'beaten'] as const
const OLLIE = names('o', 4, OLLIE_POSES)
/** The idle loop: blink at the end. */
const IDLE_T = [40, 30, 30, 8]
const IDLE_LEN = 108
/** How far up from his feet a drip swells, leaning over (rival_ollie.ts DRIP_Y). */
const DRIP_Y = 24
/** Tip, glug, glug, tip. */
const REFILL_SEQ = [0, 1, 2, 1]
/** How far his widest poses reach from his middle. */
const REACH = 27

function idleFrame(t: number): number {
  let k = t % IDLE_LEN
  for (let i = 0; i < IDLE_T.length; i++) {
    if (k < IDLE_T[i]) return i
    k -= IDLE_T[i]
  }
  return 0
}

registerRenderer('ollie', (_g, e, rc) => {
  const v = e.vars
  const beaten = e.state === 'beaten'
  const N = OLLIE[beaten ? 3 : Math.max(0, Math.min(2, v.stage | 0))]
  const t = e.stateT
  const tick = rc.tick
  let anim = N.idle
  let i = idleFrame(tick)
  switch (e.state) {
    case 'intro':
      if (t < 50) {
        anim = N.bow
        i = t < 20 ? 0 : 1
      }
      break
    case 'squirtTell':
      anim = N.squirtTell
      i = tick >> 3
      break
    case 'squirt':
      anim = N.squirt
      i = v.shotT < 8 ? 0 : 1
      break
    case 'glide':
      anim = N.glide
      i = t / 6
      break
    case 'slideTell':
      anim = N.windup
      i = t < v.tell * 0.35 ? 0 : t < v.tell * 0.7 ? 1 : 2
      break
    case 'slide':
      anim = N.slide
      i = tick >> 2
      break
    case 'slideEnd':
      anim = N.dizzy
      i = tick >> 3
      break
    case 'hopTell':
    case 'dropTell':
      anim = N.crouch
      i = 0
      break
    case 'hop':
    case 'drop':
      anim = N.air
      i = 0
      break
    case 'perch':
      if (e.x !== e.px) {
        anim = N.shuffle
        i = tick / 10
      }
      break
    case 'dripTell':
      anim = N.lean
      i = t < v.tell / 2 ? 0 : 1
      break
    case 'land':
      anim = N.land
      i = 0
      break
    case 'refill':
      anim = N.refill
      i = REFILL_SEQ[Math.floor(t / 14) % 4]
      break
    case 'burp':
      anim = N.burp
      i = 0
      break
    case 'stagger':
      anim = N.stagger
      i = tick / 6
      break
    case 'beaten':
      anim = N.beaten
      i = tick / 40
      break
  }
  // Water in his face, outside the refill: he flinches.
  if (v.flinch > 0 && (anim === N.idle || anim === N.shuffle || anim === N.squirt || anim === N.glide || anim === N.land || anim === N.burp)) {
    anim = N.hit
    i = 0
  }
  // Where he is about to land shows on the floor first.
  if (e.state === 'hopTell' || e.state === 'hop' || e.state === 'dropTell' || e.state === 'drop') {
    rc.draw(pick(frames(rc, 'landShadow'), tick >> 3), v.landX, v.landY)
  }
  // His arms, hair and loafers reach past his box: against a wall, draw him a step out of the bricks.
  const cx = e.x + e.w / 2
  const at = anim === N.slide || !(v.ax1 > v.ax0) ? cx : Math.min(Math.max(cx, v.ax0 + REACH), v.ax1 - REACH)
  rc.draw(pick(frames(rc, anim), Math.floor(i)), at, e.y + e.h, e.facing < 0 ? FLIP : undefined)
  if (e.state === 'dripTell') {
    // A drop swelling on the spout's tip, and the mark of where it will land.
    const grow = Math.min(2, Math.floor((t / Math.max(1, v.tell)) * 3))
    rc.draw(pick(frames(rc, 'dripSwell'), grow), v.aimX, e.y + e.h - DRIP_Y)
    rc.draw(pick(frames(rc, 'dripMark'), tick >> 3), v.aimX, v.aimY)
  }
})

registerRenderer('ollie_glob', (_g, e, rc) => {
  const v = e.vars
  const left = v.n - e.stateT
  rc.draw(pick(frames(rc, 'globMark'), left < 12 ? 2 : left < 28 ? 1 : 0), v.tx, v.fy)
  rc.draw(pick(frames(rc, 'glob'), rc.tick >> 2), e.x + e.w / 2, e.y + e.h / 2, e.vx < 0 ? FLIP : undefined)
})

registerRenderer('ollie_drip', (_g, e, rc) => {
  const v = e.vars
  rc.draw(pick(frames(rc, 'dripMark'), rc.tick >> 3), v.tx, v.fy)
  rc.draw(pick(frames(rc, 'drip'), rc.tick >> 3), e.x + e.w / 2, e.y + e.h / 2)
})

// The puddle's tiles are oily ('O'), which the tile layer draws as the theme's oily floor; a
// player should see the floor it was under a slick: so those tiles are drawn as the floor ('#';
// the floor round them already counts oil as ground), then the slick goes on top.
const C_OIL = 'O'.charCodeAt(0)

registerRenderer('ollie_puddle', (g, e, rc) => {
  const v = e.vars
  const w = rc.world
  for (let k = 0; k < v.n; k++) {
    const tx = v.tx + k
    if (tx >= 0 && tx < w.grid.w && v.ty >= 0 && v.ty < w.grid.h && w.grid.t[v.ty * w.grid.w + tx] === C_OIL) drawTileAs(g, rc.sprites, w, tx, v.ty, '#', rc.camX, rc.camY)
  }
  // Drying, it blinks.
  if (v.ttl < 60 && (rc.tick >> 3) % 2 === 1) return
  const f = frames(rc, 'slick')
  for (let k = 0; k < v.n; k++) rc.draw(pick(f, (rc.tick >> 4) + k), (v.tx + k) * TILE, v.ty * TILE)
})

/* ------------------------------------------------------------------ */
/* Nimbus Nick                                                         */
/* ------------------------------------------------------------------ */

const NICK_POSES = ['float', 'hit', 'rainTell', 'rain', 'boltTell', 'bolt', 'gustTell', 'gust', 'pant', 'wring', 'puff', 'beaten'] as const
const NICK = names('n', 4, NICK_POSES)
const SHRINK_T = 80

registerRenderer('nick', (_g, e, rc) => {
  const v = e.vars
  const tick = rc.tick
  const t = e.stateT
  let stage = Math.max(0, Math.min(3, v.stage | 0))
  let anim = NICK[Math.min(2, stage)].float
  let i = tick / 10
  const N = NICK[Math.min(2, stage)]
  switch (e.state) {
    case 'rainTell':
      anim = N.rainTell
      i = tick >> 2
      break
    case 'rain':
      anim = N.rain
      i = tick / 5
      break
    case 'boltTell':
      anim = N.boltTell
      i = tick / 5
      break
    case 'bolt':
      anim = N.bolt
      i = tick >> 3
      break
    case 'gustTell':
      anim = N.gustTell
      i = tick / 6
      break
    case 'gust':
      anim = N.gust
      i = tick >> 2
      break
    case 'pant':
      anim = N.pant
      i = tick / 12
      // Washing him: he winces between gasps.
      if (v.flinch > 0 && (tick >> 2) % 2 === 1) anim = N.hit
      break
    case 'shrink':
      // Wringing out: the old size first, then the new one.
      if (t < SHRINK_T / 2 && stage > 0) stage--
      anim = stage >= 3 ? NICK[3].puff : NICK[stage].wring
      i = tick / 6
      break
    case 'puff':
      anim = v.flinch > 0 ? NICK[3].hit : NICK[3].puff
      i = tick / 6
      break
    case 'beaten':
      anim = NICK[3].beaten
      i = tick / 30
      break
  }
  if (v.flinch > 0 && anim === N.float) {
    anim = N.hit
    i = 0
  }
  // Rained out by a wall, he and his rainbow keep clear of the bricks.
  const cx = e.state === 'beaten' && v.ax1 > v.ax0 ? Math.min(Math.max(e.x + e.w / 2, v.ax0 + 24), v.ax1 - 24) : e.x + e.w / 2
  if (e.state === 'beaten' && t > 40) {
    // One small clean rainbow, his feet on the floor.
    rc.draw(pick(frames(rc, 'rainbow'), tick >> 4), cx, v.floor, t < 70 && (t >> 2) % 2 === 0 ? HALF_FADE : undefined)
  }
  rc.draw(pick(frames(rc, anim), Math.floor(i)), cx, e.y + e.h, e.facing < 0 ? FLIP : undefined)
})
// The rain's tell, in the master palette: the column's edges, and its drops (two shades that blink).
const TELL_EDGE = '#a9afbd'
const TELL_DROP = '#9a7fe0'
const TELL_DROP2 = '#767b8a'

registerRenderer('nick_rain', (g, e, rc) => {
  const v = e.vars
  if (e.w < 2) return
  const w = rc.world
  const x0 = e.x
  const x1 = e.x + e.w
  const top = v.top
  const tick = rc.tick
  if (e.state === 'tell') {
    // Faint, but plain: a pale cloud, the column's two edges dashed, a few drops drifting down
    // (more of them as it nears), and a dotted line where it will land.
    for (let x = x0 + 8; x < x1 - 8 + 1; x += 32) rc.draw(pick(frames(rc, 'rainCloudFaint'), tick >> 4), x + 8, top - 2)
    const near = e.stateT * 2 > v.tell
    g.fillStyle = TELL_EDGE
    for (let x = x0 + 1; x < x1; x += Math.max(1, x1 - x0 - 3)) {
      const bottom = surfaceBelow(w, x, top, v.floor)
      const sx = rc.sx(x)
      for (let y = top + (tick % 8); y < bottom - 2; y += 8) g.fillRect(sx, rc.sy(y), 1, 4)
    }
    g.fillStyle = (tick >> 3) % 2 === 0 ? TELL_DROP : TELL_DROP2
    const gap = near ? 10 : 16
    for (let x = x0 + 6; x < x1 - 4; x += 8) {
      const bottom = surfaceBelow(w, x, top, v.floor)
      const sx = rc.sx(x)
      for (let y = top + ((x * 7 + tick * 2) % gap); y < bottom - 4; y += gap) g.fillRect(sx, rc.sy(y), 1, 3)
      g.fillRect(sx - 1, rc.sy(bottom) - 1, 2, 1)
    }
    return
  }
  const opts = e.state === 'stop' ? FADE : undefined
  const drop = frames(rc, 'rainDrop')
  for (let x = x0 + 2; x < x1 - 2; x += 5) {
    const bottom = surfaceBelow(w, x, top, v.floor)
    const lane = (x >> 1) * 7
    for (let y = top + ((lane + tick * 9) % 20); y < bottom - 6; y += 20) rc.draw(pick(drop, lane), x, y + 9, opts)
    if (e.state === 'fall' && ((tick + lane) >> 2) % 3 === 0) rc.draw(pick(frames(rc, 'rainSplash'), tick >> 2), x, bottom, opts)
  }
  for (let x = x0 + 8; x < x1 - 8 + 1; x += 32) rc.draw(pick(frames(rc, 'rainCloud'), (tick >> 4) + (x >> 5)), x + 8, top - 2, opts)
})

registerRenderer('nick_bolt', (g, e, rc) => {
  const v = e.vars
  const tick = rc.tick
  if (e.state === 'mark') {
    // It tightens as the strike comes, under a crackling column that shows where it will come down.
    const k = e.stateT / Math.max(1, v.mark)
    g.fillStyle = (tick >> 1) % 2 === 0 ? '#ffe866' : '#f5c518'
    const from = Math.max(v.top, rc.camY)
    for (let y = from + ((tick * 3) % 10); y < v.sy - 4; y += 10) {
      g.fillRect(rc.sx(v.x - 9), rc.sy(y), 1, 4)
      g.fillRect(rc.sx(v.x + 8), rc.sy(y + 5), 1, 4)
    }
    rc.draw(pick(frames(rc, 'boltMark'), k < 0.4 ? 0 : k < 0.75 ? 1 : 2), v.x, v.sy, (tick >> 2) % 2 === 0 && k > 0.75 ? FADE : undefined)
    return
  }
  if (e.state === 'strike') {
    const seg = frames(rc, 'boltSeg')
    const from = Math.max(v.top, rc.camY - 32)
    let y = v.sy - 32
    let n = 0
    while (y > from - 32) {
      rc.draw(pick(seg, n + (tick >> 1)), v.x, y)
      y -= 32
      n++
    }
    rc.draw(pick(frames(rc, 'boltHit'), tick >> 1), v.x, v.sy)
    return
  }
  rc.draw(pick(frames(rc, 'scorch'), 0), v.x, v.sy, e.stateT > 12 ? FADE : undefined)
})

/** Lanes of wind streaks across the arena: height (share of the box) and phase. */
const LANES = [0.1, 0.2, 0.3, 0.39, 0.47, 0.55, 0.62, 0.69, 0.76, 0.82, 0.88, 0.94]

registerRenderer('nick_gust', (_g, e, rc) => {
  const v = e.vars
  const blowing = e.state === 'blow'
  const f = frames(rc, blowing ? 'gust' : 'gustFaint')
  const speed = blowing ? 9 : 2
  const span = e.w + 80
  const flip = v.dir < 0 ? FLIP : undefined
  for (let k = 0; k < LANES.length; k++) {
    const run = (k * 97 + rc.tick * speed) % span
    const x = v.dir > 0 ? e.x - 40 + run : e.x + e.w + 40 - run
    rc.draw(pick(f, k), x, e.y + e.h * LANES[k], flip)
  }
})
