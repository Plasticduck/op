// The SUPER MIGHTY MAXX logo as the title shows it: dropped in with a bounce, a gleam of
// light sweeping across the letters now and then, and sparkles twinkling on it.
import type { Sprites } from '../../contract'
import { PAL } from '../../engine/ui'
import { bounce } from './kit'

type G = CanvasRenderingContext2D

/** Ticks between the starts of two gleams, and how long one takes to cross. */
const GLEAM_EVERY = 300
const GLEAM_TICKS = 44
const DROP_TICKS = 46
const SPARK = ['title/spark0', 'title/spark1', 'title/spark2', 'title/spark3', 'title/spark2', 'title/spark1']
// Where sparkles sit on the logo (from its top-left), and when each one twinkles.
const SPARKLES: ReadonlyArray<readonly [number, number, number]> = [
  [24, 18, 0],
  [214, 12, 70],
  [372, 32, 140],
  [505, 46, 35],
  [512, 104, 105],
  [134, 92, 175],
]

export interface Logo {
  /** Start the drop-in again (the logo falls from above the screen). */
  drop(): void
  /** Skip the drop-in. */
  land(): void
  /** True once the drop-in is over. */
  readonly landed: boolean
  update(): void
  /** Top-centre at (cx, y). `lift` moves it up, for the attract loop. */
  draw(g: G, sprites: Sprites, cx: number, y: number, lift?: number): void
  /** The logo's height in pixels, once the atlas is loaded. */
  height(sprites: Sprites): number
}

export function createLogo(): Logo {
  let t = 0
  let dropT = DROP_TICKS
  let shine: HTMLCanvasElement | null = null
  let shineG: CanvasRenderingContext2D | null = null

  function gleam(g: G, sprites: Sprites, left: number, top: number, k: number): void {
    const src = sprites.source('title/logoGleam')
    if (!src) return
    const f = src.frame
    if (!shine) {
      shine = document.createElement('canvas')
      shine.width = f.w
      shine.height = f.h
      shineG = shine.getContext('2d')
    }
    const c = shineG
    if (!c) return
    c.globalCompositeOperation = 'copy'
    c.drawImage(src.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
    c.globalCompositeOperation = 'source-in'
    // A band slanted the way the letters lean, a wide stroke and a thin one, row by row so its edges stay hard.
    const bx = Math.round(-40 + k * (f.w + f.h))
    c.fillStyle = PAL.white
    for (let y = 0; y < f.h; y++) {
      const x = bx - (y >> 1)
      c.fillRect(x, y, 7, 1)
      c.fillRect(x + 11, y, 3, 1)
    }
    c.globalCompositeOperation = 'source-over'
    g.drawImage(shine, left, top)
  }

  return {
    drop() {
      dropT = 0
    },
    land() {
      dropT = DROP_TICKS
    },
    get landed() {
      return dropT >= DROP_TICKS
    },
    update() {
      t++
      if (dropT < DROP_TICKS) dropT++
    },
    height(sprites) {
      return sprites.frame('title/logo')?.h ?? 0
    },
    draw(g, sprites, cx, y, lift = 0) {
      const f = sprites.frame('title/logo')
      if (!f) return
      const fall = Math.round((1 - bounce(dropT / DROP_TICKS)) * -(f.h + y + 10))
      const top = Math.round(y + fall - lift)
      const left = Math.round(cx - (f.ax ?? 0))
      sprites.draw(g, 'title/logo', cx, top)
      if (dropT < DROP_TICKS || lift > 0) return
      const phase = t % GLEAM_EVERY
      if (phase < GLEAM_TICKS) gleam(g, sprites, left, top, phase / GLEAM_TICKS)
      for (let i = 0; i < SPARKLES.length; i++) {
        const s = SPARKLES[i]
        const k = (t + GLEAM_EVERY - s[2]) % 210
        if (k < 24) sprites.draw(g, SPARK[k >> 2], left + s[0], top + s[1])
      }
    },
  }
}
