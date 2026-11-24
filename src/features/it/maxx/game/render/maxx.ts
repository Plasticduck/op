// Maxx on screen: which frame his state calls for, and everything worn on top of it.
//
//   blink        every other pair of ticks while player.invuln > 0 (after a hit, after a pipe)
//   lost shine   maxx/grime1 (2 pips) or grime2 (1 pip), laid over the body only
//   Mighty Wax   a one-pixel ring round him shimmers gold, white and blue, a glint of polish
//                crosses him now and then, and he sheds sparkles; in the last two seconds the
//                shimmer stutters
//   hover        a column of water from the nozzle down to the ground, fanning out in a foot of
//                spray where it lands, breaking into drops where it does not reach
//   turbo        the nozzle glows (fx/turbo), wherever the pose holds it, and sheds a glint
//                now and then that a run leaves behind
//   pipe         he sinks into the rim and rises out of the far one (cut off at the rim,
//                and the world renderer draws him behind the tiles)
//   door         he fades out in four steps and fades in on the far side
//   clear        runs on, then cheers with a burst of stars
//   grimed       the flop, a splat of mud when he lands; in sludge he sinks behind it
//
// Other scenes can use maxxAnim / timedFrame / maxxGrime and drawMaxxFrame on their own.
import { MAXX_H, MAXX_W, MAX_PIPS, MUZZLE, TILE } from '../contract'
import type { DrawOpts, SpriteFrame, Sprites } from '../contract'
import { TILE_FLAGS, T_ONEWAY, T_SOLID } from '../sim'
import type { Player, World } from '../sim/types'
import { DICE, DICE_MASK } from './particles'
import type { ParticleId } from './particles'

/** Pixels of running per run frame, unless the maxx atlas says otherwise in meta.runStride. */
const RUN_STRIDE = 7
/** Ticks per frame of an animation the maxx atlas gives no timing for in meta.ticks. */
const FRAME_TICKS = 8
/** Running over a one-tile gap takes him off the ground for about 3 ticks: no fall pose before this many. */
const FALL_AFTER = 5
/** The hover jet reaches this far down when there is no ground under it. */
const JET_MAX = 44
/** Under this much wax left the shimmer stutters, as a warning. */
const WAX_WARN = 120
/** Mighty Wax: the ring round him steps through these every WAX_STEP ticks, and a glint crosses him every GLINT_EVERY. */
const WAX_RING = ['#ffe866', '#f7f4f8', '#5cc8ff', '#f7f4f8']
const WAX_STEP = 4
const GLINT_EVERY = 48
const GLINT_SPEED = 5
const GLINT_CORE = '#f7f4f8'
const GLINT_EDGE = '#ffe866'
const WATER = '#b9ecff'
const WATER_CORE = '#f7f4f8'
const WATER_EDGE = '#1456b8'
const C_SLUDGE = '~'.charCodeAt(0)
/** Where the nozzle is while the gun is carried, not fired: measured in the atlas, one past the brass tip like MUZZLE. */
const MUZZLE_CARRY = { x: 28, y: -20 }

const POSE_PLAIN = ['jump', 'fall', 'run', 'idle']
const POSE_SPRAY = ['sprayJump', 'sprayFall', 'sprayRun', 'sprayIdle']
const POSE_SPRAY_UP = ['sprayUpJump', 'sprayUpFall', 'sprayUpRun', 'sprayUpIdle']
const FLIP: DrawOpts = { flipX: true }

/** The animation of the maxx atlas his state calls for. */
export function maxxAnim(p: Player): string {
  if (p.state === 'grimed') return 'grimed'
  if (p.state === 'hurt') return 'hurt'
  if (p.state === 'warp') return 'idle'
  const moving = Math.abs(p.vx) > 12
  // The victory walk is a run; the cheer starts once he stands.
  if (p.state === 'clear') return moving ? 'run' : 'win'
  const air = !p.onGround && (p.vy < 0 || p.airT >= FALL_AFTER)
  const pose = air ? (p.vy < 0 ? 0 : 1) : moving ? 2 : 3
  if (!p.spraying) return p.skidding && p.onGround ? 'skid' : POSE_PLAIN[pose]
  if (p.aim === 'down') return 'sprayDown'
  return (p.aim === 'up' ? POSE_SPRAY_UP : POSE_SPRAY)[pose]
}

/**
 * Which frame of a timed animation shows after `t` ticks. `ticks[i]` is how long frame i
 * stays (the maxx atlas ships these in meta.ticks); 0 holds that frame for good, so
 * 'grimed' plays once and stays down while the others loop.
 */
export function timedFrame(ticks: readonly number[], t: number): number {
  let hold = -1
  let total = 0
  for (let i = 0; i < ticks.length; i++) {
    if (ticks[i] <= 0) {
      hold = i
      break
    }
    total += ticks[i]
  }
  let left = Math.max(0, t)
  if (hold < 0 && total > 0) left %= total
  for (let i = 0; i < ticks.length; i++) {
    if (i === hold || left < ticks[i]) return i
    left -= ticks[i]
  }
  return ticks.length - 1
}

/** The dirt he wears for the shine he has lost: an overlay frame of the maxx atlas, or ''. */
export function maxxGrime(p: Player): string {
  if (p.state === 'grimed' || p.pips >= MAX_PIPS) return ''
  return p.pips >= MAX_PIPS - 1 ? 'maxx/grime1' : 'maxx/grime2'
}

/** Up to his waist in sludge: the world renderer then draws him behind the tiles, so he sinks into it. */
export function maxxInSludge(w: World): boolean {
  const p = w.player
  const g = w.grid
  const tx = Math.floor((p.x + p.w / 2) / TILE)
  const ty = Math.floor((p.y + p.h - 4) / TILE)
  return tx >= 0 && ty >= 0 && tx < g.w && ty < g.h && g.t[ty * g.w + tx] === C_SLUDGE
}

/* ------------------------------------------------------------------ */
/* Body and overlay, put together off screen                           */
/* ------------------------------------------------------------------ */

let scratch: HTMLCanvasElement | null = null
let scratchG: CanvasRenderingContext2D | null = null

/** A body frame with `grime` laid over it (and nowhere else), on the shared scratch canvas. Null if there is nothing to draw. */
function compose(sprites: Sprites, frame: string, grime: string): CanvasRenderingContext2D | null {
  const f = sprites.frame(frame)
  if (!f) return null
  if (!scratch) {
    scratch = document.createElement('canvas')
    scratchG = scratch.getContext('2d')
  }
  const s = scratchG
  if (!s) return null
  if (scratch.width < f.w || scratch.height < f.h) {
    scratch.width = Math.max(scratch.width, f.w)
    scratch.height = Math.max(scratch.height, f.h)
  }
  s.globalCompositeOperation = 'source-over'
  s.clearRect(0, 0, scratch.width, scratch.height)
  sprites.draw(s, frame, f.ax ?? 0, f.ay ?? 0)
  s.globalCompositeOperation = 'source-atop'
  if (grime) sprites.draw(s, grime, f.ax ?? 0, f.ay ?? 0)
  return s
}

/** The top-left corner of a frame on a scratch canvas, put with the frame's anchor at (x, y), mirrored if asked. */
function blitAt(g: CanvasRenderingContext2D, src: HTMLCanvasElement, f: SpriteFrame, x: number, y: number, flipX: boolean, alpha: number): void {
  g.save()
  g.translate(x | 0, y | 0)
  if (flipX) g.scale(-1, 1)
  if (alpha < 1) g.globalAlpha *= alpha
  g.drawImage(src, 0, 0, f.w, f.h, -(f.ax ?? 0), -(f.ay ?? 0), f.w, f.h)
  g.restore()
}

function stamp(g: CanvasRenderingContext2D, sprites: Sprites, frame: string, x: number, y: number, flipX: boolean, alpha: number): void {
  const f = sprites.frame(frame)
  if (f && scratch) blitAt(g, scratch, f, Math.round(x), Math.round(y), flipX, alpha)
}

let halo: HTMLCanvasElement | null = null
let haloG: CanvasRenderingContext2D | null = null
/** One pixel all round, square and diagonal: a ring that follows his outline. */
const RING_X = [1, -1, 0, 0, 1, 1, -1, -1]
const RING_Y = [0, 0, 1, -1, 1, -1, 1, -1]

/**
 * A ring of one colour round whatever is on the scratch canvas (the body frame `f`), drawn
 * on `g` behind where the body will go: the shimmer of Mighty Wax.
 */
function ring(g: CanvasRenderingContext2D, f: SpriteFrame, x: number, y: number, flipX: boolean, alpha: number, color: string): void {
  if (!scratch) return
  if (!halo) {
    halo = document.createElement('canvas')
    haloG = halo.getContext('2d')
  }
  const h = haloG
  if (!h) return
  if (halo.width < f.w || halo.height < f.h) {
    halo.width = Math.max(halo.width, f.w)
    halo.height = Math.max(halo.height, f.h)
  }
  h.globalCompositeOperation = 'source-over'
  h.clearRect(0, 0, f.w, f.h)
  h.drawImage(scratch, 0, 0, f.w, f.h, 0, 0, f.w, f.h)
  h.globalCompositeOperation = 'source-in'
  h.fillStyle = color
  h.fillRect(0, 0, f.w, f.h)
  h.globalCompositeOperation = 'source-over'
  const px = Math.round(x)
  const py = Math.round(y)
  for (let i = 0; i < RING_X.length; i++) blitAt(g, halo, f, px + RING_X[i], py + RING_Y[i], flipX, alpha)
}

/**
 * One frame of Maxx with its anchor (the middle of his feet) at screen (x, y), wearing a
 * grime overlay if one is named ('maxx/grime1' | 'maxx/grime2'). For scenes that show him
 * outside a level.
 */
export function drawMaxxFrame(g: CanvasRenderingContext2D, sprites: Sprites, frame: string, x: number, y: number, flipX = false, grime = ''): void {
  if (!grime || !sprites.has(grime)) {
    sprites.draw(g, frame, x, y, flipX ? FLIP : undefined)
    return
  }
  if (compose(sprites, frame, grime)) stamp(g, sprites, frame, x, y, flipX, 1)
}

/* ------------------------------------------------------------------ */
/* The painter                                                         */
/* ------------------------------------------------------------------ */

interface Anim {
  frames: string[]
  /** Ticks per frame, or null for FRAME_TICKS each. */
  ticks: number[] | null
  /** Stepped by distance run, not by time. */
  byDistance: boolean
}

export type FxEmit = (id: ParticleId, x: number, y: number, n?: number, dir?: number) => void

export interface MaxxPainter {
  reset(): void
  /** Once a tick: the particles he sheds (wax sparkles, the hover's splash, the mud of a flop). */
  update(world: World, tick: number, emit: FxEmit): void
  draw(g: CanvasRenderingContext2D, world: World, camX: number, camY: number, tick: number, debug: boolean): void
  /** The body frame last chosen ('maxx/run3'), drawn or blinked away. */
  readonly frame: string
}

export function createMaxxPainter(sprites: Sprites): MaxxPainter {
  const anims = new Map<string, Anim | null>()
  let lastAnim = ''
  let since = 0
  let shown = ''
  let flopped = false
  let cheered = false
  let lastStep = 0
  // Where the next roll of the particles' dice is read: inline, so no fraction is boxed.
  let die = 0x2a5

  /** The animation to play for a name, falling back to a plainer pose the atlas does have. */
  function resolve(name: string): Anim | null {
    const known = anims.get(name)
    if (known !== undefined) return known
    const meta = sprites.atlas('maxx')?.meta
    const timings = (meta?.ticks ?? {}) as Record<string, unknown>
    let found: Anim | null = null
    for (const n of [name, name.replace('sprayUp', 'spray'), name.replace(/^spray(Up)?/, '').toLowerCase(), 'idle']) {
      const frames = sprites.anim('maxx', n).filter((f) => sprites.has(f))
      if (!frames.length) continue
      const t = timings[n]
      const ok = Array.isArray(t) && t.length === frames.length && t.every((v) => typeof v === 'number')
      found = { frames, ticks: ok ? (t as number[]) : null, byDistance: /run$/i.test(n) }
      break
    }
    anims.set(name, found)
    return found
  }

  function stride(): number {
    const v = sprites.atlas('maxx')?.meta?.runStride
    return typeof v === 'number' && v > 0 ? v : RUN_STRIDE
  }

  // Looked up once: building the 'fx/turbo' name again every frame would be an allocation.
  let glow: string[] | null = null
  let carry: { x: number; y: number } | null = null
  /** Where the nozzle is while the gun is carried: the hero artist measures it (meta.carry), else our own measure. */
  function carried(): { x: number; y: number } {
    if (carry) return carry
    const c = sprites.atlas('maxx')?.meta?.carry as { x?: unknown; y?: unknown } | undefined
    carry = c && typeof c.x === 'number' && typeof c.y === 'number' ? { x: c.x, y: c.y } : MUZZLE_CARRY
    return carry
  }

  /** Ticks into the flop at which he lies flat: where the held frame of 'grimed' begins. */
  function flopAt(): number {
    const a = resolve('grimed')
    if (!a || !a.ticks) return 39
    let t = 0
    for (let i = 0; i < a.ticks.length && a.ticks[i] > 0; i++) t += a.ticks[i]
    return t
  }

  /** How far below the nozzle the hover jet meets ground, at most JET_MAX. */
  function jetReach(w: World, x: number, y: number): number {
    const g = w.grid
    const tx = Math.floor(x / TILE)
    if (tx < 0 || tx >= g.w) return JET_MAX
    const last = Math.min(g.h - 1, Math.floor((y + JET_MAX) / TILE))
    for (let ty = Math.max(0, Math.floor(y / TILE)); ty <= last; ty++) {
      // A whole number: a fraction handed back would be boxed every frame of a hover.
      if (TILE_FLAGS[g.t[ty * g.w + tx]] & (T_SOLID | T_ONEWAY)) return Math.max(0, Math.min(JET_MAX, ty * TILE - Math.round(y))) | 0
    }
    return JET_MAX
  }

  /**
   * The hover jet: a column of water from the nozzle at (x, y) (x on the line between two pixel
   * columns) `len` pixels down, with swells running down it. Where it meets the ground it fans
   * out in a foot of spray; where it does not, it breaks up into drops.
   */
  function drawJet(g: CanvasRenderingContext2D, x: number, y: number, len: number, tick: number): void {
    if (len <= 0) return
    const ground = len < JET_MAX
    // The last few pixels of a jet that hits nothing thin out.
    const body = ground ? len : len - 8
    for (let pass = 0; pass < 3; pass++) {
      g.fillStyle = pass === 0 ? WATER_EDGE : pass === 1 ? WATER : WATER_CORE
      for (let yy = 0; yy < body; yy += 2) {
        const swell = (((yy - tick * 3) >> 3) & 3) === 0 ? 1 : 0
        const half = (yy < 4 ? 2 : 3) + swell
        if (pass === 0) g.fillRect(x - half - 1, y + yy, half * 2 + 2, 2)
        else if (pass === 1) g.fillRect(x - half, y + yy, half * 2, 2)
        else if (((yy + tick * 4) & 7) < 5) g.fillRect(x - 1, y + yy, 2, 2)
      }
    }
    if (ground) {
      // The foot: spray thrown out both ways along the floor.
      const spread = 7 + ((tick >> 1) & 3)
      const foot = y + len
      g.fillStyle = WATER_EDGE
      g.fillRect(x - spread - 1, foot - 3, spread * 2 + 2, 3)
      g.fillStyle = WATER
      g.fillRect(x - spread, foot - 4, spread * 2, 3)
      g.fillStyle = WATER_CORE
      g.fillRect(x - spread + 2, foot - 5, 3, 1)
      g.fillRect(x + spread - 5, foot - 5, 3, 1)
      g.fillRect(x - 2, foot - 4, 4, 1)
      // Flecks either side, hopping with the clock.
      const hop = (tick >> 2) & 1
      g.fillRect(x - spread - 4, foot - 7 - hop, 2, 2)
      g.fillRect(x + spread + 2, foot - 6 - (1 - hop), 2, 2)
      return
    }
    // In the air: the column breaks into drops that fall on below it.
    g.fillStyle = WATER
    for (let i = 0; i < 3; i++) {
      const dy = body + ((tick * 3 + i * 7) % 18)
      const dx = i === 1 ? -2 : i === 2 ? 1 : 0
      g.fillRect(x - 1 + dx, y + dy, 2, 3)
    }
  }

  /**
   * A glint of polish running across the body now and then, like light down a freshly waxed
   * hood: a thin white slant with a pale gold edge, on the scratch canvas (composite mode is
   * already source-atop, so it lands on him only).
   */
  function glint(s: CanvasRenderingContext2D, w: number, h: number, tick: number): void {
    const head = (tick % GLINT_EVERY) * GLINT_SPEED - 12
    if (head - (h >> 1) > w) return
    s.fillStyle = GLINT_EDGE
    for (let y = 0; y < h; y += 2) s.fillRect(head - (y >> 1) - 3, y, 2, 2)
    s.fillStyle = GLINT_CORE
    for (let y = 0; y < h; y += 2) s.fillRect(head - (y >> 1), y, 3, 2)
  }

  return {
    reset() {
      lastAnim = ''
      since = 0
      flopped = false
      cheered = false
      lastStep = 0
    },
    update(w, tick, emit) {
      // Whole pixels go to emit(): a fraction handed to a function is a boxed number, an allocation.
      const p = w.player
      const cx = Math.round(p.x + p.w / 2) | 0
      const top = Math.round(p.y) | 0
      const feet = (top + p.h) | 0
      if (p.wax > 0 && p.state !== 'grimed') {
        if (tick % 5 === 0) emit('sparkle', (cx + (DICE[die++ & DICE_MASK] - 0.5) * 36) | 0, (top + DICE[die++ & DICE_MASK] * p.h) | 0, 1)
        if (tick % 22 === 0) emit('shine', (cx + (DICE[die++ & DICE_MASK] - 0.5) * 20) | 0, (top + 8 + DICE[die++ & DICE_MASK] * 30) | 0, 1)
      }
      if (p.turbo && p.state === 'normal' && !w.warp && tick % 14 === 0) {
        // The turbo nozzle sheds a glint now and then, which a run leaves behind like a trail.
        const m = p.spraying ? MUZZLE[p.aim] : carried()
        emit('sparkle', (cx + p.facing * m.x + (DICE[die++ & DICE_MASK] - 0.5) * 6) | 0, (feet + m.y + (DICE[die++ & DICE_MASK] - 0.5) * 6) | 0, 1)
      }
      if (p.hovering) {
        const nx = (cx + p.facing * MUZZLE.down.x) | 0
        const ny = (feet + MUZZLE.down.y) | 0
        const len = jetReach(w, nx, ny) | 0
        if (len < JET_MAX) {
          if (tick % 3 === 0) emit('splash', nx, ny + len - 2, 1, DICE[die++ & DICE_MASK] < 0.5 ? -1 : 1)
        } else if (tick % 4 === 0) {
          emit('mist', nx, ny + len, 1)
        }
      }
      if (p.state === 'grimed') {
        if (maxxInSludge(w)) {
          // He goes under: the sludge spits.
          if (tick % 8 === 0) emit('mud', (cx + (DICE[die++ & DICE_MASK] - 0.5) * 24) | 0, Math.floor((feet - 4) / TILE) * TILE + 6, 1)
        } else if (!flopped && p.onGround && p.stateT >= flopAt()) {
          flopped = true
          emit('mud', cx, feet - 6, 10)
          emit('dust', cx, feet, 4)
        }
      } else {
        flopped = false
      }
      if (p.state === 'clear') {
        if (!cheered && p.onGround && Math.abs(p.vx) <= 12) {
          cheered = true
          emit('star', cx, top + 4, 7)
          emit('sparkle', cx, top - 6, 5)
        }
      } else {
        cheered = false
      }
      // Mud, foam and snow kick up behind a run, as the theme's floor is drawn: slick is foam in
      // the tunnels, ice in winter, wet mud in the storm, black oil in the lube pit (no spray).
      if (p.state === 'normal' && p.onGround && (p.floor === 'M' || p.floor === 'I') && Math.abs(p.vx) > 80) {
        if (Math.abs(p.runDist - lastStep) >= 22) {
          lastStep = p.runDist
          const back = p.vx > 0 ? -1 : 1
          const theme = w.area.theme
          if (p.floor === 'M' || theme === 'storm') emit('mud', cx + back * 8, feet - 3, 1, back)
          else if (theme === 'winter') emit('snow', cx + back * 8, feet - 3, 1, back)
          else if (theme !== 'lube') emit('foam', cx + back * 8, feet - 3, 1, back)
        }
      }
    },
    draw(g, w, camX, camY, tick, debug) {
      const p = w.player
      const left = Math.round(p.x) - camX
      const top = Math.round(p.y) - camY
      const x = left + MAXX_W / 2
      const y = top + MAXX_H
      const flipX = p.facing < 0

      const name = maxxAnim(p)
      if (name !== lastAnim) {
        lastAnim = name
        since = tick
      }
      const a = resolve(name)
      if (a) {
        // His own states (the flop, a hit) keep the simulation's time; the rest start afresh each time they begin.
        const t = name === 'grimed' || name === 'hurt' ? p.stateT : tick - since
        const i = a.byDistance ? Math.floor(Math.abs(p.runDist) / stride()) : a.ticks ? timedFrame(a.ticks, t) : Math.floor(Math.max(0, t) / FRAME_TICKS)
        shown = a.frames[i % a.frames.length]
      } else {
        shown = ''
      }

      if (debug) {
        g.strokeStyle = '#ffe866'
        g.lineWidth = 1
        g.strokeRect(left + 0.5, top + 0.5, MAXX_W - 1, MAXX_H - 1)
      }
      if (p.invuln > 0 && p.state !== 'grimed' && ((tick >> 1) & 1) === 0) return

      const trip = w.warp
      let alpha = 1
      if (trip && trip.mode === 'door') {
        const k = Math.min(1, trip.t / Math.max(1, trip.ticks))
        alpha = Math.ceil((trip.phase === 'out' ? 1 - k : k) * 4) / 4
        if (alpha <= 0) return
      }
      const inPipe = !!trip && trip.mode === 'pipe'
      if (trip && inPipe) {
        // Nothing of him shows below the rim he is sliding through.
        const rim = Math.round(trip.phase === 'out' ? trip.fromY + MAXX_H : trip.fromY) - camY
        g.save()
        g.beginPath()
        g.rect(-64, -4096, 4096, 4096 + rim)
        g.clip()
      }

      if (!shown) {
        g.fillStyle = '#d10713'
        g.fillRect(left, top, MAXX_W, MAXX_H)
        g.fillStyle = '#f7f4f8'
        g.fillRect(flipX ? left + 2 : left + MAXX_W - 8, top + 10, 6, 6)
      } else {
        const grime = maxxGrime(p)
        const dirt = grime && sprites.has(grime) ? grime : ''
        const waxed = p.wax > 0 && p.state !== 'grimed' && (p.wax > WAX_WARN || ((tick >> 3) & 1) === 0)
        if (dirt || waxed || alpha < 1) {
          const s = compose(sprites, shown, dirt)
          const f = sprites.frame(shown)
          if (s && f) {
            if (waxed) {
              ring(g, f, x, y, flipX, alpha, WAX_RING[((tick / WAX_STEP) | 0) % WAX_RING.length])
              glint(s, f.w, f.h, tick)
            }
            stamp(g, sprites, shown, x, y, flipX, alpha)
          }
        } else {
          sprites.draw(g, shown, x, y, flipX ? FLIP : undefined)
        }
      }

      if (!trip && p.turbo && name !== 'win' && (p.state === 'normal' || p.state === 'clear')) {
        // The brass tip: one pixel inside the mouth while he sprays, and where the carried gun points otherwise.
        const m = p.spraying ? MUZZLE[p.aim] : carried()
        const gx = m.x - 1
        glow ??= sprites.anim('fx', 'turbo')
        const px = flipX ? x - 1 - gx : x + gx
        if (glow.length) {
          sprites.draw(g, glow[(tick >> 2) % glow.length], px, y + m.y - 1)
        } else {
          g.fillStyle = '#f97316'
          g.fillRect(px - 1, y + m.y - 2, 3, 3)
        }
      }
      if (p.hovering) {
        const nx = x + p.facing * MUZZLE.down.x
        const ny = y + MUZZLE.down.y
        drawJet(g, nx, ny, jetReach(w, nx + camX, ny + camY), tick)
      }
      if (inPipe) g.restore()
    },
    get frame() {
      return shown
    },
  }
}
