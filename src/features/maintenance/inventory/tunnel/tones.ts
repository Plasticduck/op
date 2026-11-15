import type { TunnelAsset, TunnelItem } from '@/lib/queries/miTunnel'

// What a machine's color says. The 2D diagram and the 3D view both ask here, so the two
// can never disagree about which machine is fine and which needs someone. Rules only: no
// React, no three.js, no colors. Each view turns a tone into its own paint (the diagram
// into token classes, the 3D view into floor pads and markers in the same token colors).

export type ColorBy = 'status' | 'usage' | 'wos' | 'sticker'

// Use is shaded in five steps, relative to the busiest machine on the drawing.
export const HEAT_TONES = ['heat0', 'heat1', 'heat2', 'heat3', 'heat4'] as const
export type HeatTone = (typeof HEAT_TONES)[number]
// How strongly each step is filled with the accent color. The diagram's HEAT classes
// (fill-accent/10 and so on) say the same numbers: change them together.
export const HEAT_ALPHA: readonly number[] = [0.1, 0.25, 0.45, 0.65, 0.85]

// 'neutral': nothing to report (no open work orders, or no use count to shade).
// 'unlinked': the shape has no machine yet. 'retired': its machine is out of service for good.
export type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'unlinked' | 'retired' | HeatTone

// The most cars any machine on the drawing has seen since its start date.
export function maxCarsOf(items: ReadonlyArray<Pick<TunnelItem, 'asset_id'>>, assets: Record<string, TunnelAsset>): number {
  let max = 0
  for (const i of items) {
    const cars = i.asset_id ? assets[i.asset_id]?.cars_since ?? 0 : 0
    if (cars > max) max = cars
  }
  return max
}

// The tone of a shape linked to `asset` (none: not linked) in a color-by mode. Scenery
// (rooms, labels) has no tone and is never asked about.
export function toneFor(asset: TunnelAsset | null | undefined, colorBy: ColorBy, maxCars: number): Tone {
  if (!asset) return 'unlinked'
  if (asset.status === 'retired') return 'retired'
  if (colorBy === 'status') return asset.status === 'offline_unplanned' ? 'danger' : asset.status === 'offline_planned' ? 'warn' : 'ok'
  if (colorBy === 'wos') return asset.open_wos >= 2 ? 'danger' : asset.open_wos === 1 ? 'warn' : 'neutral'
  if (colorBy === 'sticker') return asset.tag_printed ? 'ok' : asset.tag ? 'warn' : 'danger'
  if (asset.cars_since == null || !maxCars) return 'neutral'
  const step = Math.floor((asset.cars_since / maxCars) * HEAT_TONES.length)
  return HEAT_TONES[Math.min(HEAT_TONES.length - 1, Math.max(0, step))]
}

// Which heat step a tone is (0 to 4), or -1 when it isn't one.
export function heatStep(tone: Tone): number {
  return (HEAT_TONES as readonly string[]).indexOf(tone)
}
