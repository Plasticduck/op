// What the play scene lays over the picture to hide a cut: its own iris (the level opening on
// Maxx, closing on him before a retry) and the short shade round a pipe or door trip.
// Hard pixel edges, the same black as the shell's own transitions.
import { VIEW_H, VIEW_W } from '../../contract'

type G = CanvasRenderingContext2D

export const COVER = '#000'

/** The smallest radius at which a hole centred on (cx, cy) shows the whole screen. */
export function irisFar(cx: number, cy: number): number {
  return Math.ceil(Math.hypot(Math.max(cx, VIEW_W - cx), Math.max(cy, VIEW_H - cy)))
}

/** Black everywhere but a round hole of radius `r` at (cx, cy). r <= 0 is a black screen. */
export function drawIris(g: G, cx: number, cy: number, r: number): void {
  cx = Math.round(cx)
  cy = Math.round(cy)
  r = Math.round(r)
  g.fillStyle = COVER
  if (r <= 0) {
    g.fillRect(0, 0, VIEW_W, VIEW_H)
    return
  }
  const top = Math.max(0, cy - r)
  const bottom = Math.min(VIEW_H, cy + r)
  if (top > 0) g.fillRect(0, 0, VIEW_W, top)
  if (bottom < VIEW_H) g.fillRect(0, bottom, VIEW_W, VIEW_H - bottom)
  // Row by row, so the edge is made of whole pixels.
  for (let y = top; y < bottom; y++) {
    const dy = y + 0.5 - cy
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)))
    if (cx - half > 0) g.fillRect(0, y, cx - half, 1)
    if (cx + half < VIEW_W) g.fillRect(cx + half, y, VIEW_W - cx - half, 1)
  }
}

/** The whole screen darkened in four steps, like a palette fade. `level` 0 (clear) to 1 (black). */
export function drawShade(g: G, level: number): void {
  if (level <= 0) return
  g.globalAlpha = Math.min(1, Math.ceil(level * 4) / 4)
  g.fillStyle = COVER
  g.fillRect(0, 0, VIEW_W, VIEW_H)
  g.globalAlpha = 1
}

/** A flat veil under a menu, so the level stays visible but steps back. */
export function drawDim(g: G, alpha = 0.6): void {
  g.globalAlpha = alpha
  g.fillStyle = COVER
  g.fillRect(0, 0, VIEW_W, VIEW_H)
  g.globalAlpha = 1
}

/** 0 to 1 with a little overshoot on the way: things that land with a bounce. */
export function bounceIn(k: number): number {
  if (k <= 0) return 0
  if (k >= 1) return 1
  const c = 2.2
  const u = k - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}
