// Particles and floating popups: everything cosmetic that an `fx` or `popup` event asks
// for. One pool of plain numbers, capped, no allocation once it is made; when the pool is
// full a new particle takes the place of an old one.
//
// Frames come from the 'fx' atlas (scripts/maxx/art-fx.mjs), animation '<id>' for each
// FxId; an id with no frames yet is drawn as a small square. How each one moves:
//   splash    drops arc out and fall                 sparkle   twinkles where it is
//   dust      puffs low along the ground and thins   debris    chunks tumble, bounce once
//   mud       blobs fly and stick where they land    bubble    rises, wobbles, pops
//   star      bursts outward, flashing               smoke     rises and thins
//   foam      clumps burst and sink slowly           snow      a soft puff that settles
//   confetti  shoots up, then flutters down          drip      falls straight, lands in a crown
//   steam     wisps go up fast                       coin      pops up spinning, ends in a twinkle
//   shine     big glints over a wide patch           leaf      flutters down on the wind
//   spark     quick hot streaks
// `dir` (-1 or 1) leans the ones that fly sideways.
import { DT, TILE, VIEW_H, VIEW_W } from '../contract'
import type { Sprites, SpriteFrame } from '../contract'
import { drawText } from '../engine/text'
import type { TextStyle } from '../engine/text'
import { TILE_FLAGS, T_ONEWAY, T_SOLID } from '../sim'
import type { FxId, TileGrid, World } from '../sim/types'
import { BACK_FX } from './clock'
import type { Lerp } from './clock'

/**
 * The renderer's own: 'mist', a droplet that ran out of reach; 'spatter', water bouncing off
 * something alive (a car's face): the splash's smaller drops, thrown back toward `dir` and kept
 * off the face.
 */
export type ParticleId = FxId | 'mist' | 'spatter'

const IDS: readonly ParticleId[] = ['splash', 'sparkle', 'dust', 'debris', 'mud', 'bubble', 'star', 'smoke', 'foam', 'snow', 'confetti', 'drip', 'steam', 'coin', 'shine', 'leaf', 'spark', 'mist', 'spatter']
/** A kind drawn with another's frames, from the given one on. */
const FRAMES_FROM: Partial<Record<ParticleId, [FxId, number]>> = { spatter: ['splash', 1] }
const KIND = {} as Record<ParticleId, number>
IDS.forEach((id, i) => (KIND[id] = i))
// The kinds that frameOf() and update() treat in their own way.
const SPARKLE = KIND.sparkle
const DEBRIS = KIND.debris
const MUD = KIND.mud
const BUBBLE = KIND.bubble
const STAR = KIND.star
const CONFETTI = KIND.confetti
const DRIP = KIND.drip
const COIN = KIND.coin
const LEAF = KIND.leaf

/** Per kind, in the order of IDS: pull of gravity (px/s2), share of speed kept each tick, fastest fall (0 = no limit), sideways sway (px/s). */
const table = (over: Partial<Record<ParticleId, number>>, base: number): Float32Array => {
  const out = new Float32Array(IDS.length).fill(base)
  for (const id of IDS) if (over[id] !== undefined) out[KIND[id]] = over[id] as number
  return out
}
const GRAVITY = table({ splash: 560, spatter: 560, debris: 1000, mud: 900, star: 240, foam: 110, snow: 150, confetti: 420, drip: 700, coin: 900, leaf: 190, spark: 650, bubble: -14, smoke: -20, steam: -30 }, 0)
const KEEP = table({ dust: 0.9, star: 0.955, smoke: 0.96, foam: 0.9, snow: 0.93, confetti: 0.97, steam: 0.97, leaf: 0.97, bubble: 0.97, mist: 0.9 }, 1)
const MAX_FALL = table({ foam: 40, snow: 34, confetti: 52, leaf: 44 }, 0)
const SWAY = table({ bubble: 16, snow: 14, confetti: 30, leaf: 34, smoke: 6, steam: 8 }, 0)
/** What it does on meeting the floor: 0 nothing, 1 sticks, 2 bounces once. */
const LANDS = table({ drip: 1, mud: 1, debris: 2 }, 0)

// How each kind is born, as numbers per kind, so one loop makes them all with its arithmetic
// inline: a helper that returned a fraction would hand back a boxed number, an allocation
// for every particle.
//   SHAPE   0 plain (vx and vy from their ranges), 1 a fan either side of straight up
//           (SPREAD radians, leaning LEAN radians toward dir), 2 a burst every way (less LIFT on vy)
//   JX JY   scatter of the start, either way; EXACT the first of a call starts on the spot
//   OX OY   offset of the start: OX for each one after the first (a row of coins), OY once
//   VX0..1  sideways speed; SIGN 1: either way at random, 2: toward dir (random when 0);
//           VXDIR more for dir. VY0..1 up-down speed (negative is up). S0..1 speed of a fan or burst
//   L0..1   ticks of life; DSTEP DMAX each one after the first waits DSTEP more, at most DMAX
const SHAPE = table({ splash: 1, spatter: 1, spark: 1, star: 2, foam: 2 }, 0)
const SPREAD = table({ splash: 1.1, spatter: 0.42, spark: 1.5 }, 0)
const LEAN = table({ spatter: 1.0 }, 0.5)
const LIFT = table({ star: 40, foam: 30 }, 0)
const JX = table({ sparkle: 11, shine: 26, dust: 3, debris: 8, mud: 4, bubble: 9, smoke: 3, foam: 6, snow: 6, confetti: 8, drip: 2, steam: 5, leaf: 6, mist: 2 }, 0)
const JY = table({ sparkle: 11, shine: 16, debris: 8, mud: 6, bubble: 6, smoke: 3, foam: 6, snow: 4, steam: 3, leaf: 6, mist: 2 }, 0)
const EXACT = table({ sparkle: 1, shine: 1 }, 0)
const OX = table({ coin: 6 }, 0)
const OY = table({ dust: -2, coin: -10 }, 0)
const VX0 = table({ dust: 25, debris: 40, mud: 30, bubble: -14, smoke: -10, snow: -60, confetti: 30, steam: -8, leaf: -50, mist: -14 }, 0)
const VX1 = table({ dust: 75, debris: 150, mud: 150, bubble: 14, smoke: 10, snow: 60, confetti: 160, steam: 8, leaf: 50, mist: 14 }, 0)
const SIGN = table({ dust: 2, debris: 1, mud: 1, confetti: 1 }, 0)
const VXDIR = table({ debris: 60, mud: 60, smoke: 24, snow: 30, steam: 18, leaf: 60 }, 0)
const VY0 = table({ dust: -26, debris: -340, mud: -300, bubble: -44, smoke: -36, snow: -100, confetti: -360, drip: 10, steam: -80, coin: -310, leaf: -130, mist: -14 }, 0)
const VY1 = table({ dust: -4, debris: -180, mud: -110, bubble: -18, smoke: -18, snow: -20, confetti: -170, drip: 50, steam: -40, coin: -310, leaf: -30, mist: 14 }, 0)
const S0 = table({ splash: 60, spatter: 55, spark: 110, star: 80, foam: 30 }, 0)
const S1 = table({ splash: 170, spatter: 125, spark: 270, star: 190, foam: 130 }, 0)
const L0 = table({ splash: 12, spatter: 10, sparkle: 18, dust: 16, debris: 40, mud: 34, bubble: 36, star: 26, smoke: 30, foam: 28, snow: 30, confetti: 80, drip: 60, steam: 22, coin: 32, shine: 20, leaf: 60, spark: 8, mist: 8 }, 10)
const L1 = table({ splash: 22, spatter: 16, sparkle: 26, dust: 24, debris: 56, mud: 48, bubble: 60, star: 38, smoke: 44, foam: 44, snow: 52, confetti: 120, drip: 60, steam: 30, coin: 32, shine: 28, leaf: 96, spark: 16, mist: 12 }, 10)
const DSTEP = table({ sparkle: 3, shine: 4, bubble: 2, smoke: 3, drip: 5, steam: 2, coin: 4 }, 0)
const DMAX = table({ sparkle: 60, shine: 80, bubble: 40, smoke: 30, drip: 40, steam: 30, coin: 30 }, 0)

// A fixed table of fractions, read in turn: the particles' own dice. Cosmetic only, and the
// reading place goes back to the start on reset, so a scripted run photographs the same twice.
// render/maxx.ts rolls the same dice (read inline: DICE[i++ & DICE_MASK]).
const DICE_N = 4096
export const DICE_MASK = DICE_N - 1
export const DICE = new Float64Array(DICE_N)
{
  let s = 0x2f6e2b1
  for (let i = 0; i < DICE_N; i++) {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    DICE[i] = (s >>> 0) / 4294967296
  }
}
const HALF_PI = Math.PI / 2
const TWO_PI = Math.PI * 2
const FLAT_COLOR: string[] = IDS.map(
  (id) =>
    ({ splash: '#b9ecff', sparkle: '#ffe866', dust: '#d6dae3', debris: '#a9afbd', mud: '#6b4522', bubble: '#b9ecff', star: '#ffe866', smoke: '#a9afbd', foam: '#f7f4f8', snow: '#f7f4f8', confetti: '#f51924', drip: '#b9ecff', steam: '#f7f4f8', coin: '#d6dae3', shine: '#f7f4f8', leaf: '#49b23c', spark: '#ffe866', mist: '#b9ecff', spatter: '#b9ecff' })[id],
)

const CAP = 400
const F_LANDED = 1
const F_BOUNCED = 2

const POPUP_CAP = 12
const POPUP_TICKS = 54
const POPUP_RISE = 26
const POPUP_FADE = 12
const POP_SCORE: TextStyle = { align: 'center', color: '#ffe866', outline: '#1e0d06' }
const POP_FLASH: TextStyle = { align: 'center', color: '#f7f4f8', outline: '#1e0d06' }
const POP_LIFE: TextStyle = { align: 'center', color: '#9be04f', outline: '#1e0d06' }
const POP_WORD: TextStyle = { align: 'center', color: '#b9ecff', outline: '#1b2253' }

export interface Particles {
  /** Drop everything (a new world or area). */
  reset(): void
  /** `n` particles of an effect at a world position. */
  emit(id: ParticleId, x: number, y: number, n?: number, dir?: number): void
  popup(text: string, x: number, y: number): void
  /** One tick. The grid is what blobs and chunks land on. */
  update(world: World): void
  /** `lerp`: the world renderer's (render/clock.ts), to draw between two updates on a fast screen. */
  draw(g: CanvasRenderingContext2D, camX: number, camY: number, lerp?: Lerp): void
  drawPopups(g: CanvasRenderingContext2D, camX: number, camY: number, lerp?: Lerp): void
  readonly count: number
  readonly popups: number
}

export function createParticles(sprites: Sprites): Particles {
  const kind = new Uint8Array(CAP)
  const flags = new Uint8Array(CAP)
  const vary = new Uint8Array(CAP)
  const wait = new Uint8Array(CAP)
  const age = new Int16Array(CAP)
  const life = new Int16Array(CAP)
  const px = new Float32Array(CAP)
  const py = new Float32Array(CAP)
  // Where each was before the last update(), to draw it on its way between two.
  const qx = new Float32Array(CAP)
  const qy = new Float32Array(CAP)
  const vx = new Float32Array(CAP)
  const vy = new Float32Array(CAP)
  let n = 0
  let ring = 0

  const popText: string[] = new Array<string>(POPUP_CAP).fill('')
  const popX = new Float32Array(POPUP_CAP)
  const popY = new Float32Array(POPUP_CAP)
  const popT = new Int16Array(POPUP_CAP)
  let pops = 0

  // The frames of each kind, looked up once the atlas is in.
  const frames: SpriteFrame[][] = IDS.map(() => [])
  let image: CanvasImageSource | null = null
  let looked = false
  function lookUp(): void {
    looked = true
    IDS.forEach((id, k) => {
      const [anim, from] = FRAMES_FROM[id] ?? [id, 0]
      for (const name of sprites.anim('fx', anim).slice(from)) {
        const src = sprites.source(name)
        if (!src) continue
        image = src.image
        frames[k].push(src.frame)
      }
    })
  }

  // Where the next roll of the dice is read.
  let die = 0

  function solid(grid: TileGrid, x: number, y: number): boolean {
    const tx = Math.floor(x / TILE)
    const ty = Math.floor(y / TILE)
    if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return false
    return (TILE_FLAGS[grid.t[ty * grid.w + tx]] & (T_SOLID | T_ONEWAY)) !== 0
  }

  function remove(i: number): void {
    const last = --n
    if (i === last) return
    kind[i] = kind[last]
    flags[i] = flags[last]
    vary[i] = vary[last]
    wait[i] = wait[last]
    age[i] = age[last]
    life[i] = life[last]
    px[i] = px[last]
    py[i] = py[last]
    qx[i] = qx[last]
    qy[i] = qy[last]
    vx[i] = vx[last]
    vy[i] = vy[last]
  }

  /** Which frame of its animation particle i shows, given the animation has `count` frames. */
  function frameOf(i: number, k: number, count: number): number {
    const a = age[i]
    switch (k) {
      case DEBRIS:
        return ((a >> 2) + vary[i]) % count
      case COIN:
        return (a >> 1) % count
      case LEAF:
        return ((a >> 3) + vary[i]) % count
      case CONFETTI:
        // Three colours, each flat on and edge on.
        return ((vary[i] % 3) * 2 + (((a + vary[i]) >> 2) & 1)) % count
      case STAR: {
        const left = life[i] - a
        return left > 8 ? (a >> 2) & 1 : Math.min(count - 1, left > 4 ? 2 : 3)
      }
      case MUD:
        return flags[i] & F_LANDED ? count - 1 : vary[i] % Math.max(1, count - 1)
      case DRIP:
        if (flags[i] & F_LANDED) return Math.min(count - 1, 2 + ((a / 3) | 0))
        return a < 6 ? 0 : 1
      case BUBBLE: {
        const left = life[i] - a
        if (left <= 6) return Math.min(count - 1, left > 3 ? 3 : 4)
        return Math.min(2, (a / 6) | 0)
      }
      default:
        return Math.min(count - 1, ((a * count) / life[i]) | 0)
    }
  }

  return {
    reset() {
      n = 0
      ring = 0
      pops = 0
      die = 0
    },
    emit(id, x, y, count = 1, dir = 0) {
      const k = KIND[id]
      if (k === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return
      const many = Math.max(1, Math.min(48, Math.round(count))) | 0
      const lean = dir > 0 ? 1 : dir < 0 ? -1 : 0
      const shape = SHAPE[k]
      const sign = SIGN[k]
      for (let i = 0; i < many; i++) {
        // Every number below is worked out right here and goes straight into the pool's arrays.
        const j = n < CAP ? n++ : (ring = (ring + 1) % CAP)
        let x0 = x + (i ? OX[k] * i : 0)
        let y0 = y + OY[k]
        if (i > 0 || EXACT[k] === 0) {
          x0 += (DICE[die++ & DICE_MASK] * 2 - 1) * JX[k]
          y0 += (DICE[die++ & DICE_MASK] * 2 - 1) * JY[k]
        }
        let sx: number
        let sy: number
        if (shape === 0) {
          sx = VX0[k] + (VX1[k] - VX0[k]) * DICE[die++ & DICE_MASK]
          if (sign === 2 && lean !== 0) sx *= lean
          else if (sign !== 0 && DICE[die++ & DICE_MASK] < 0.5) sx = -sx
          sx += lean * VXDIR[k]
          sy = VY0[k] + (VY1[k] - VY0[k]) * DICE[die++ & DICE_MASK]
        } else {
          const a = shape === 1 ? lean * LEAN[k] - HALF_PI + (DICE[die++ & DICE_MASK] * 2 - 1) * SPREAD[k] : DICE[die++ & DICE_MASK] * TWO_PI
          const s = S0[k] + (S1[k] - S0[k]) * DICE[die++ & DICE_MASK]
          sx = Math.cos(a) * s
          sy = Math.sin(a) * s - LIFT[k]
        }
        kind[j] = k
        flags[j] = 0
        vary[j] = (DICE[die++ & DICE_MASK] * 256) | 0
        wait[j] = Math.min(DMAX[k], i * DSTEP[k])
        age[j] = 0
        life[j] = (L0[k] + (L1[k] - L0[k]) * DICE[die++ & DICE_MASK] + 0.5) | 0
        px[j] = qx[j] = x0
        py[j] = qy[j] = y0
        vx[j] = sx
        vy[j] = sy
      }
    },
    popup(text, x, y) {
      if (!text) return
      if (pops >= POPUP_CAP) {
        // The oldest makes way.
        for (let i = 1; i < pops; i++) {
          popText[i - 1] = popText[i]
          popX[i - 1] = popX[i]
          popY[i - 1] = popY[i]
          popT[i - 1] = popT[i]
        }
        pops--
      }
      popText[pops] = text
      popX[pops] = x
      popY[pops] = y
      popT[pops] = 0
      pops++
    },
    update(world) {
      const grid = world.grid
      for (let i = 0; i < n; ) {
        qx[i] = px[i]
        qy[i] = py[i]
        if (wait[i] > 0) {
          wait[i]--
          i++
          continue
        }
        const k = kind[i]
        if (++age[i] >= life[i]) {
          if (k === COIN) {
            // The coin ends in a twinkle where it was caught.
            kind[i] = SPARKLE
            flags[i] = 0
            age[i] = 0
            life[i] = 18
            vx[i] = 0
            vy[i] = 0
            i++
          } else {
            remove(i)
          }
          continue
        }
        if (flags[i] & F_LANDED) {
          i++
          continue
        }
        let sy = vy[i] + GRAVITY[k] * DT
        const cap = MAX_FALL[k]
        if (cap > 0 && sy > cap) sy = cap
        const keep = KEEP[k]
        let sx = vx[i]
        if (keep < 1) {
          sx *= keep
          if (GRAVITY[k] <= 0 || cap === 0) sy *= keep
        }
        vx[i] = sx
        vy[i] = sy
        const sway = SWAY[k]
        px[i] += (sx + (sway ? sway * Math.sin((age[i] + vary[i]) * 0.19) : 0)) * DT
        py[i] += sy * DT
        const lands = LANDS[k]
        if (lands && sy > 0 && solid(grid, px[i], py[i])) {
          const top = Math.floor(py[i] / TILE) * TILE
          if (lands === 1) {
            flags[i] |= F_LANDED
            py[i] = top
            age[i] = 0
            life[i] = k === DRIP ? 9 : 30
          } else if (flags[i] & F_BOUNCED) {
            remove(i)
            continue
          } else {
            flags[i] |= F_BOUNCED
            py[i] = top - 1
            vy[i] = -sy * 0.42
            vx[i] = sx * 0.6
          }
        }
        i++
      }
      for (let i = 0; i < pops; ) {
        if (++popT[i] <= POPUP_TICKS) {
          i++
          continue
        }
        for (let j = i + 1; j < pops; j++) {
          popText[j - 1] = popText[j]
          popX[j - 1] = popX[j]
          popY[j - 1] = popY[j]
          popT[j - 1] = popT[j]
        }
        pops--
      }
    },
    draw(g, camX, camY, lerp) {
      if (!looked) lookUp()
      const back = lerp ? lerp[BACK_FX] : 0
      for (let i = 0; i < n; i++) {
        if (wait[i] > 0) continue
        let x = Math.round(px[i]) - camX
        let y = Math.round(py[i]) - camY
        if (back > 0) {
          x = Math.round(px[i] - (px[i] - qx[i]) * back) - camX
          y = Math.round(py[i] - (py[i] - qy[i]) * back) - camY
        }
        if (x < -16 || y < -16 || x > VIEW_W + 16 || y > VIEW_H + 16) continue
        const k = kind[i]
        const list = frames[k]
        if (image && list.length) {
          const f = list[frameOf(i, k, list.length)]
          // The stuck frame of a blob or a drip sits on the floor, not across it.
          const ay = flags[i] & F_LANDED ? f.h : (f.ay ?? 0)
          g.drawImage(image, f.x, f.y, f.w, f.h, x - (f.ax ?? 0), y - ay, f.w, f.h)
        } else {
          g.fillStyle = FLAT_COLOR[k]
          g.fillRect(x - 1, y - 1, 3, 3)
        }
      }
    },
    drawPopups(g, camX, camY, lerp) {
      // Between two updates it has risen part of the way from where the one before left it.
      const back = lerp ? lerp[BACK_FX] : 0
      for (let i = 0; i < pops; i++) {
        const text = popText[i]
        const t = popT[i]
        const k = 1 - (t > back ? t - back : 0) / POPUP_TICKS
        const x = Math.round(popX[i]) - camX
        const y = Math.round(popY[i]) - camY - Math.round(POPUP_RISE * (1 - k * k)) - 8
        const first = text.charCodeAt(0)
        const number = first >= 48 && first <= 57
        // A thousand or more flashes; a word (CLEAN!) is water blue; an extra life is green.
        const style = text === '1UP' ? POP_LIFE : !number ? POP_WORD : text.length >= 4 && ((t >> 2) & 1) === 1 ? POP_FLASH : POP_SCORE
        const left = POPUP_TICKS - t
        if (left < POPUP_FADE) g.globalAlpha = left < 4 ? 0.25 : left < 8 ? 0.5 : 0.75
        drawText(g, text, x, y, style)
        if (left < POPUP_FADE) g.globalAlpha = 1
      }
    },
    get count() {
      return n
    },
    get popups() {
      return pops
    },
  }
}
