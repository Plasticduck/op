// Draws the critters (sim/entities/critters.ts) from the 'critters' atlas
// (scripts/maxx/art-critters.mjs): blob, bird, splat, bugs, tumbleweed.
//
// All art faces right and is mirrored for facing -1. Everything that only the picture
// knows (the swarm's little bugs, feathers, twigs, a blink) is worked out from the
// entity's own numbers and rc.tick, so nothing here keeps state or allocates per frame.
import { TILE } from '../../contract'
import type { DrawOpts } from '../../contract'
import { TILE_FLAGS, T_ONEWAY, T_SOLID } from '../../sim'
import type { Entity, World } from '../../sim/types'
import { registerRenderer } from '../registry'
import type { RenderCtx } from '../registry'

const A = 'critters/'
const names = (anim: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${A}${anim}${i}`)

const FLIP: DrawOpts = { flipX: true }
const PLAIN: DrawOpts = {}
/** One reusable options object for faded draws; set it, draw, done. */
const FADE: DrawOpts = { alpha: 1, flipX: false }
const opt = (flip: boolean): DrawOpts => (flip ? FLIP : PLAIN)
function fade(alpha: number, flip: boolean): DrawOpts {
  FADE.alpha = alpha
  FADE.flipX = flip
  return FADE
}

/** Which frame of a play-once animation `t` ticks in, holding the last. */
function once(ticks: readonly number[], t: number): number {
  let left = t
  for (let i = 0; i < ticks.length; i++) {
    if (left < ticks[i]) return i
    left -= ticks[i]
  }
  return ticks.length - 1
}
const mod = (n: number, m: number): number => ((n % m) + m) % m
/** A blink of `len` ticks every `period`, put out of step from its neighbours by the entity id. */
const blinking = (e: Entity, tick: number, period: number, len: number): boolean => mod(tick + e.id * 53, period) < len

/* ------------------------------------------------------------------ */
/* blob                                                                */
/* ------------------------------------------------------------------ */

// Indexed by e.hp (1..3).
const BLOB_WALK = [[], names('blob1Walk', 4), names('blob2Walk', 4), names('blob3Walk', 4)]
const BLOB_BLINK = [[], names('blob1Blink', 4), names('blob2Blink', 4), names('blob3Blink', 4)]
const BLOB_HIT = names('blobHit', 3)
const BLOB_SQUASH = names('blobSquash', 2)
const BLOB_POP = names('blobPop', 4)
const T_SQUASH = [6, 16]
const T_POP = [4, 4, 5, 5]
/** Pixels walked per frame of the walk. */
const BLOB_STRIDE = 4

registerRenderer('blob', (_g, e, rc) => {
  const fx = e.x + e.w / 2
  const fy = e.y + e.h
  const flip = e.facing < 0
  if (e.state === 'pop') {
    rc.draw(BLOB_POP[once(T_POP, e.stateT)], fx, fy)
    return
  }
  if (e.state === 'squash') {
    rc.draw(BLOB_SQUASH[once(T_SQUASH, e.stateT)], fx, fy, opt(flip))
    return
  }
  const stage = Math.max(1, Math.min(3, e.hp))
  if (e.state === 'hit') {
    // It reels: a shudder on the spot.
    rc.draw(BLOB_HIT[stage - 1], fx + ((e.stateT >> 1) & 1 ? 1 : -1), fy, opt(flip))
    return
  }
  // A frame of the ooze every 4 px it goes, whichever way; standing still (looking about) it holds one.
  const step = mod(Math.floor((flip ? -e.x : e.x) / BLOB_STRIDE), 4)
  const set = blinking(e, rc.tick, 170, 7) ? BLOB_BLINK : BLOB_WALK
  rc.draw(set[stage][step], fx, fy, opt(flip))
})

/* ------------------------------------------------------------------ */
/* bird and splat                                                      */
/* ------------------------------------------------------------------ */

const BIRD_FLY = names('birdFly', 4)
const BIRD_FLY_HURT = names('birdFlyHurt', 4)
const BIRD_TELL = names('birdTell', 2)
const BIRD_TELL_HURT = names('birdTellHurt', 2)
const BIRD_HIT = names('birdHit', 2)
const BIRD_FLEE = names('birdFlee', 2)
const FEATHER = names('feather', 3)
const SPLAT_FALL = names('splatFall', 2)
const SPLAT_LAND = names('splatLand', 3)
const T_SPLAT_LAND = [5, 20, 15]
const SHADOW = '#1e0d06'
const TELL_TICKS = 20
const FEATHER_TICKS = 72

/** The top of the first floor (or catwalk) at or below world point (x, y), or -1. */
function floorBelow(w: World, x: number, y: number): number {
  const g = w.grid
  const tx = Math.floor(x / TILE)
  if (tx < 0 || tx >= g.w) return -1
  for (let ty = Math.max(0, Math.floor(y / TILE)); ty < g.h; ty++) {
    if (TILE_FLAGS[g.t[ty * g.w + tx]] & (T_SOLID | T_ONEWAY)) return ty * TILE
  }
  return -1
}

/** Where the splat will land, darkening as the grackle takes aim: the tell on the ground. */
function dropShadow(g: CanvasRenderingContext2D, e: Entity, rc: RenderCtx): void {
  const x = e.x + e.w / 2
  const top = floorBelow(rc.world, x, e.y + e.h)
  if (top < 0) return
  const half = 3 + Math.min(4, Math.floor((e.stateT * 5) / TELL_TICKS))
  const sx = rc.sx(x)
  const sy = rc.sy(top)
  g.fillStyle = SHADOW
  g.fillRect(sx - half + 1, sy - 2, 2 * half - 2, 1)
  g.fillRect(sx - half, sy - 1, 2 * half, 1)
}

registerRenderer('bird', (g, e, rc) => {
  const fx = e.x + e.w / 2
  const fy = e.y + e.h
  const flip = e.facing < 0
  const hurt = e.hp <= 1
  if (e.state === 'flee') {
    rc.draw(BIRD_FLEE[(e.stateT >> 2) & 1], fx, fy, opt(flip))
    // Three feathers come loose where it was hit and see-saw down.
    const t = e.stateT
    if (t < FEATHER_TICKS) {
      const alpha = t < FEATHER_TICKS - 16 ? 1 : (FEATHER_TICKS - t) / 16
      for (let i = 0; i < 3; i++) {
        const sway = Math.sin(t * 0.13 + i * 2.1)
        const x = e.vars.fx + (i - 1) * (5 + t * 0.18) + sway * 5
        const y = e.vars.fy + t * (0.42 + i * 0.07) - Math.abs(sway) * 2
        rc.draw(FEATHER[i], x, y, fade(alpha, sway < 0))
      }
    }
    return
  }
  if (e.state === 'hit') {
    rc.draw(BIRD_HIT[(e.stateT >> 2) & 1], fx + ((e.stateT >> 1) & 1 ? 1 : -1), fy, opt(flip))
    return
  }
  if (e.state === 'tell') {
    dropShadow(g, e, rc)
    // Reared up and taking aim, it shivers its tail end: the drop is coming.
    const shiver = e.stateT < 4 ? 0 : (e.stateT >> 1) & 1 ? 1 : -1
    rc.draw((hurt ? BIRD_TELL_HURT : BIRD_TELL)[(e.stateT >> 2) & 1], fx + shiver, fy, opt(flip))
    return
  }
  const frames = hurt ? BIRD_FLY_HURT : BIRD_FLY
  rc.draw(frames[mod((rc.tick + e.id * 7) >> 2, 4)], fx, fy, opt(flip))
})

registerRenderer('splat', (_g, e, rc) => {
  const fx = e.x + e.w / 2
  const fy = e.y + e.h
  if (e.state === 'land') rc.draw(SPLAT_LAND[once(T_SPLAT_LAND, e.stateT)], fx, fy)
  else rc.draw(SPLAT_FALL[(e.stateT / 5) & 1], fx, fy)
})

/* ------------------------------------------------------------------ */
/* bugs                                                                */
/* ------------------------------------------------------------------ */

const BUG_BIG = names('bugBig', 2)
const BUG_BIG_HIT = names('bugBigHit', 2)
const BUG_SMALL = names('bugSmall', 2)
const GNAT = names('gnat', 2)
const BANG = `${A}bang0`
/** At full strength a swarm shows this many yellow-jackets and gnats; each hit takes some away. */
const JACKETS = 16
const GNATS = 18
const SWARM = JACKETS + GNATS
const SCATTER_TICKS = 30

// Each bug loops its own figure round the middle of the swarm: yellow-jackets first, then gnats.
const BUG_FX = new Float32Array(SWARM)
const BUG_FY = new Float32Array(SWARM)
const BUG_PX = new Float32Array(SWARM)
const BUG_PY = new Float32Array(SWARM)
const BUG_R = new Float32Array(SWARM)
for (let i = 0; i < SWARM; i++) {
  const h = Math.sin(i * 12.9898 + 4.1) * 43758.5453
  const r = h - Math.floor(h)
  const gnat = i >= JACKETS
  BUG_FX[i] = (gnat ? 0.11 : 0.07) + ((i * 37) % 11) * 0.007
  BUG_FY[i] = (gnat ? 0.13 : 0.09) + ((i * 53) % 13) * 0.006
  BUG_PX[i] = i * 2.39996
  BUG_PY[i] = i * 1.7 + r * 3
  BUG_R[i] = (gnat ? 0.3 : 0.55) + (gnat ? 0.7 : 0.45) * r
}

registerRenderer('bugs', (_g, e, rc) => {
  const mx = e.x + e.w / 2
  const my = e.y + e.h / 2
  const t = rc.tick + e.id * 31
  const buzz = (t >> 1) & 1
  if (e.state === 'scatter') {
    // Every bug for itself, straight out from the middle, gone in half a second.
    const s = e.stateT
    const alpha = s < SCATTER_TICKS - 10 ? 1 : Math.max(0, (SCATTER_TICKS - s) / 10)
    for (let i = 0; i < SWARM; i += 2) {
      const a = BUG_PX[i] + 0.4
      const d = 6 + s * (2 + BUG_R[i] * 2)
      const flip = Math.cos(a) < 0
      const frames = i < JACKETS ? BUG_SMALL : GNAT
      rc.draw(frames[(buzz + i) & 1], mx + Math.cos(a) * d, my + Math.sin(a) * d * 0.8, fade(alpha, flip))
    }
    rc.draw(BUG_BIG_HIT[buzz], mx + (s & 2 ? 1 : -1), my - s * 1.4, fade(alpha, e.facing < 0))
    return
  }
  const alert = e.state === 'alert'
  const stunned = e.vars.stun > 0
  // Bunched up tight before it comes; blown wide for a moment by a hit.
  const reach = (e.w / 2 - 3) * (alert ? 0.6 : stunned ? 1.25 : 1)
  const pace = alert ? 1.8 : 1
  const hp = Math.max(0, e.hp)
  const jackets = Math.min(JACKETS, 4 + 2 * hp)
  const gnats = Math.min(GNATS, 3 * hp)
  // Gnats behind, yellow-jackets over them.
  for (let k = 0; k < gnats + jackets; k++) {
    const i = k < gnats ? JACKETS + k : k - gnats
    const ax = t * BUG_FX[i] * pace + BUG_PX[i]
    const ay = t * BUG_FY[i] * pace + BUG_PY[i]
    const x = mx + Math.sin(ax) * reach * BUG_R[i]
    const y = my + Math.sin(ay) * reach * (0.6 + 0.4 * BUG_R[i])
    rc.draw((i < JACKETS ? BUG_SMALL : GNAT)[(buzz + i) & 1], x, y, opt(Math.cos(ax) < 0))
  }
  const bob = Math.round(Math.sin(t * 0.12) * 2)
  rc.draw((stunned ? BUG_BIG_HIT : BUG_BIG)[buzz], mx, my + bob, opt(e.facing < 0))
  if (alert) rc.draw(BANG, mx, e.y - 2 - ((e.stateT >> 2) & 1))
})

/* ------------------------------------------------------------------ */
/* tumbleweed                                                          */
/* ------------------------------------------------------------------ */

const TURNS = 8
/** Pixels rolled per eighth of a turn (the art's meta.weed.turnPx). */
const TURN_PX = (Math.PI * 30) / TURNS
// By hits left: whole at 5 and 4, thinner at 3 and 2, a few stems at 1.
const WEED = [names('weedC', TURNS), names('weedC', TURNS), names('weedB', TURNS), names('weedB', TURNS), names('weedA', TURNS), names('weedA', TURNS)]
const WEED_EYES = names('weedEyes', 2)
const WEED_EYES_HIT = `${A}weedEyesHit0`
const WEED_EYES_DIZZY = names('weedEyesDizzy', 2)
const TWIG = names('twig', 4)
const BREAK_TICKS = 30
// The twigs it breaks into: speeds in px/s.
const TWIG_VX = [-95, -40, 30, 85, -70, 60]
const TWIG_VY = [-210, -260, -240, -190, -140, -150]
const TWIG_G = 700

registerRenderer('tumbleweed', (_g, e, rc) => {
  const fx = e.x + e.w / 2
  const fy = e.y + e.h
  const my = e.y + e.h / 2
  if (e.state === 'break') {
    const s = e.stateT / 60
    const alpha = e.stateT < BREAK_TICKS - 8 ? 1 : Math.max(0, (BREAK_TICKS - e.stateT) / 8)
    for (let i = 0; i < TWIG_VX.length; i++) {
      const x = fx + TWIG_VX[i] * s
      const y = my + TWIG_VY[i] * s + 0.5 * TWIG_G * s * s
      rc.draw(TWIG[i & 3], x, y, fade(alpha, (i & 1) === 1))
    }
    return
  }
  // The ball turns with the distance rolled (clockwise to the right); it is never mirrored.
  const turn = mod(Math.floor(e.vars.roll / TURN_PX), TURNS)
  rc.draw(WEED[Math.max(0, Math.min(5, e.hp))][turn], fx, fy)
  // The eyes look the way it rolls and do not turn with it.
  const flip = e.facing < 0
  const ex = fx + e.facing * 2
  if (e.vars.stun > 0) rc.draw(WEED_EYES_HIT, ex, my, opt(flip))
  else if (e.hp <= 1) rc.draw(WEED_EYES_DIZZY[(rc.tick >> 3) & 1], ex, my, opt(flip))
  else rc.draw(WEED_EYES[blinking(e, rc.tick, 140, 6) ? 1 : 0], ex, my, opt(flip))
})
