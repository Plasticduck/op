import type { TunnelItem, TunnelLayout } from '@/lib/queries/miTunnel'

// The drawing is in feet. Horizontal (desktop): entrance on the left, driver's side on
// top, which is what you see standing over the tunnel facing the way cars go. Vertical
// (phones): entrance at the top, driver's side on the right, so a phone held upright
// scrolls down the tunnel.

export type Orientation = 'h' | 'v'
export type Box = { minX: number; minY: number; maxX: number; maxY: number }

// Layout feet -> screen units.
export function toScreen(o: Orientation, x: number, y: number): [number, number] {
  return o === 'h' ? [x, y] : [-y, x]
}

// The transform that turns layout feet into screen units for a whole group of shapes.
export const groupTransform = (o: Orientation) => (o === 'v' ? 'matrix(0 1 -1 0 0 0)' : undefined)

export function itemBox(i: Pick<TunnelItem, 'x_ft' | 'y_ft' | 'w_ft' | 'h_ft' | 'rotation'>): Box {
  const turned = i.rotation === 90 || i.rotation === 270
  const w = Number(turned ? i.h_ft : i.w_ft)
  const h = Number(turned ? i.w_ft : i.h_ft)
  return { minX: Number(i.x_ft) - w / 2, maxX: Number(i.x_ft) + w / 2, minY: Number(i.y_ft) - h / 2, maxY: Number(i.y_ft) + h / 2 }
}

// Everything that's drawn, in layout feet, with room for labels around the edge.
export function layoutBox(layout: Pick<TunnelLayout, 'length_ft' | 'width_ft' | 'zones'>, items: TunnelItem[], margin = 6): Box {
  const half = Number(layout.width_ft) / 2
  const b: Box = { minX: 0, maxX: Number(layout.length_ft), minY: -half, maxY: half }
  for (const z of layout.zones ?? []) {
    b.minX = Math.min(b.minX, Number(z.x_from))
    b.maxX = Math.max(b.maxX, Number(z.x_to))
  }
  for (const i of items) {
    const x = itemBox(i)
    b.minX = Math.min(b.minX, x.minX)
    b.maxX = Math.max(b.maxX, x.maxX)
    b.minY = Math.min(b.minY, x.minY)
    b.maxY = Math.max(b.maxY, x.maxY)
  }
  return { minX: b.minX - margin, maxX: b.maxX + margin, minY: b.minY - margin, maxY: b.maxY + margin }
}

// The SVG viewBox for that box in the given orientation.
export function viewBox(o: Orientation, b: Box): { x: number; y: number; w: number; h: number } {
  if (o === 'h') return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }
  // (x, y) -> (-y, x)
  return { x: -b.maxY, y: b.minX, w: b.maxY - b.minY, h: b.maxX - b.minX }
}

// A shape's label sits along its long side as it appears on screen.
export function labelVertical(o: Orientation, i: Pick<TunnelItem, 'w_ft' | 'h_ft' | 'rotation'>): boolean {
  const turned = i.rotation === 90 || i.rotation === 270
  const alongX = Number(turned ? i.h_ft : i.w_ft)
  const alongY = Number(turned ? i.w_ft : i.h_ft)
  // On screen, horizontal keeps x as width; vertical swaps them.
  const screenW = o === 'h' ? alongX : alongY
  const screenH = o === 'h' ? alongY : alongX
  return screenH > screenW * 2.2 && screenH > 6
}

export const snap = (v: number, step = 0.5) => Math.round(v / step) * step
