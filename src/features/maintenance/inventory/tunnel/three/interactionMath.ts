import type { TunnelItem, TunnelLayout } from '@/lib/queries/miTunnel'
import { snap } from '../geometry'

// The numbers behind the pointer: what counts as a click, and where a dragged machine may
// stand. Kept apart from interaction.ts so they can be read without a canvas in the way.
// Positions are layout feet: x along the tunnel, y across it from the centerline.

// A click is a press and release this close together, in pixels and milliseconds.
// Anything longer or further was the camera (or, in move mode, a machine).
export const CLICK_PX = 6
export const CLICK_PX_TOUCH = 10
export const CLICK_MS = 400
// Two clicks whose presses are this close in time are a double-click: the Windows and
// macOS default, timed press to press as they do. Shorter, and many people's ordinary
// double-click on a small machine becomes two clicks, the second landing where the
// fly-to after the first has already moved the view away (empty floor: it deselects).
export const DOUBLE_MS = 500
// A pointer that misses every machine still gets the one whose footprint center is
// within this many pixels: a photo eye is a few pixels wide from across the lot.
export const NEAR_PX = 24
// The grid a dragged machine lands on, as in the 2D editor: half a foot, a tenth with Alt.
export const SNAP_FT = 0.5
export const SNAP_FINE_FT = 0.1
// How far past the edge of the concrete a machine beside the tunnel can be carried. The
// concrete is laid around where the machines stand (a couple of feet of margin), so its
// edge isn't a wall: the floor follows when the machine is put down. Held to the edge
// itself, moving a machine away from the tunnel would take a drag for every two feet.
export const GROW_FT = 8

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number }

export const clickSlop = (pointerType: string) => (pointerType === 'touch' ? CLICK_PX_TOUCH : CLICK_PX)

// Rooms and labels are scenery, and everything in the tunnel stands over the conveyor:
// none of them is dragged.
export const movable = (it: { scenery: boolean; item: Pick<TunnelItem, 'kind'> }) => !it.scenery && it.item.kind !== 'conveyor'

// From where the drawing starts to where it ends along the tunnel: its zones, and the
// tunnel's own length when the zones stop short of it.
export function drawingSpan(layout: Pick<TunnelLayout, 'length_ft' | 'zones'>): { from: number; to: number } {
  let from = 0
  let to = Number(layout.length_ft) || 0
  for (const z of layout.zones ?? []) {
    from = Math.min(from, Number(z.x_from))
    to = Math.max(to, Number(z.x_to))
  }
  return { from, to }
}

// Where the center of a dragged machine may go.
export type MoveLimits = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  // Beside the tunnel: how near its center may come to the tunnel's centerline before
  // its footprint would cross a wall. 0: no wall to mind.
  wall: number
}

// In the tunnel a machine slides along it and stays inside the drawing's length. Beside
// the tunnel it moves both ways, stays on the concrete or within GROW_FT of it, and out
// from between the walls. The limits always take in where it stands now, so picking a
// machine up never moves it.
export function moveLimits(
  m: { x: number; y: number; w: number; h: number; outside: boolean },
  layout: Pick<TunnelLayout, 'length_ft' | 'width_ft' | 'zones'>,
  bounds: Rect,
  slab: Rect,
): MoveLimits {
  if (!m.outside) {
    const span = drawingSpan(layout)
    let lo = span.from
    let hi = span.to
    // A drawing with no length yet: the slab is all there is to go by.
    if (hi - lo < m.w) {
      lo = slab.minX
      hi = slab.maxX
    }
    return { minX: Math.min(lo + m.w / 2, m.x), maxX: Math.max(hi - m.w / 2, m.x), minY: m.y, maxY: m.y, wall: 0 }
  }
  const wall = (Number(layout.width_ft) || 16) / 2 + m.h / 2
  return {
    minX: Math.min(bounds.minX - GROW_FT + m.w / 2, m.x),
    maxX: Math.max(bounds.maxX + GROW_FT - m.w / 2, m.x),
    minY: Math.min(bounds.minZ - GROW_FT + m.h / 2, m.y),
    maxY: Math.max(bounds.maxZ + GROW_FT - m.h / 2, m.y),
    // Drawn standing in the tunnel already: let it be dragged out.
    wall: Math.abs(m.y) < wall - 0.01 ? 0 : wall,
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
// 0.1 steps leave 29.700000000000003 behind.
const tidy = (v: number) => Math.round(v * 1e4) / 1e4

// Where a machine lands for a pointer asking for (x, y): on the grid, then inside its
// limits (an end of the tunnel isn't always on the grid, and flush against it wins).
// lastY is where it stood a moment ago: a machine beside the tunnel stops at the wall on
// its own side while the pointer is over the tunnel, and crosses only once the pointer
// is clear of the far wall. Writes into out, so a drag allocates nothing.
export function resolveMove(l: MoveLimits, x: number, y: number, step: number, lastY: number, out: { x: number; y: number }): void {
  out.x = clamp(tidy(snap(x, step)), l.minX, l.maxX)
  if (l.minY === l.maxY) {
    out.y = l.minY
    return
  }
  let ny = tidy(snap(y, step))
  if (l.wall > 0 && Math.abs(ny) < l.wall) ny = lastY < 0 ? -l.wall : l.wall
  out.y = clamp(ny, l.minY, l.maxY)
}
