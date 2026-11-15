import type { TunnelAsset, TunnelItem, TunnelLayout } from '@/lib/queries/miTunnel'
import { shortName, STATUS } from '../../../equipment/format'
import { shapeFor } from '../../shapes'

// The words and the arithmetic the 3D view's overlays share: what a shape is called,
// the order machines come in, how a nudge moves one.

export type Machine = { item: TunnelItem; asset: TunnelAsset | null; name: string }

// A shape goes by its own label first, as on the diagram, then by its machine's name,
// then by what kind of shape it is.
export const nameOf = (item: TunnelItem, asset: TunnelAsset | null | undefined): string =>
  item.label || (asset ? shortName(asset.name) : shapeFor(item.kind).label)

// Everything that can be picked, entrance to exit: the order the keyboard and the card's
// Previous / Next walk in. Rooms and labels are scenery and stay out.
export function tunnelOrder(items: TunnelItem[], assets: Record<string, TunnelAsset>): Machine[] {
  return items
    .filter((i) => !shapeFor(i.kind).scenery)
    .sort((a, b) => Number(a.x_ft) - Number(b.x_ft) || Number(a.y_ft) - Number(b.y_ft))
    .map((item) => {
      const asset = item.asset_id ? assets[item.asset_id] ?? null : null
      return { item, asset, name: nameOf(item, asset) }
    })
}

export const statusOf = (asset: TunnelAsset) => STATUS[asset.status] ?? { label: asset.status, tone: 'neutral' as const, short: asset.status }

export const openOrders = (n: number): string => `${n} open work order${n === 1 ? '' : 's'}`

// What a screen reader hears for a machine: "Wrap DS1, running, 2 open work orders".
export function spokenLabel(m: Machine, where?: string): string {
  const parts = [m.name]
  if (!m.asset) parts.push('not linked to a machine')
  else {
    parts.push(statusOf(m.asset).label.toLowerCase())
    if (m.asset.open_wos > 0) parts.push(openOrders(m.asset.open_wos))
  }
  if (where) parts.push(where)
  return parts.join(', ')
}

// One decimal is as fine as a move gets (Alt steps are a tenth of a foot), and whole feet
// go without it: "32 ft (+6)", "29.5 ft (+3.5)".
export const feet = (v: number): string => {
  const r = Math.round(v * 10) / 10
  return String(r === 0 ? 0 : r)
}
// The sign goes by what is shown: a hair over zero reads "0", not "+0".
export const signed = (v: number): string => {
  const s = feet(v)
  return (Number(s) > 0 ? '+' : '') + s
}

// "29.5 ft from the entrance". The prep lane is before it. Spelled out (what a screen
// reader hears), exactly one is "1 foot".
export const alongText = (x: number, unit: 'ft' | 'feet' = 'ft'): string => {
  const n = feet(Math.abs(x))
  const u = unit === 'feet' && n === '1' ? 'foot' : unit
  return x < -0.04 ? `${n} ${u} before the entrance` : `${n} ${u} from the entrance`
}

// Why the scene refused a ride, in a manager's words. It rides the drawing's first
// conveyor, and only while that conveyor's machine is running (any conveyor in the
// showroom). "Down" is kept for a machine that really is down: an unlinked conveyor
// isn't broken.
export function noRideText(items: TunnelItem[], assets: Record<string, TunnelAsset>, preview: boolean): string {
  const conveyor = items.find((i) => i.kind === 'conveyor')
  if (!conveyor) return 'No ride: this drawing has no conveyor'
  const asset = !preview && conveyor.asset_id ? assets[conveyor.asset_id] ?? null : null
  if (!preview && !asset) return "No ride: the conveyor isn't linked to a machine yet"
  if (asset?.status === 'retired') return 'No ride: the conveyor is retired'
  if (asset && asset.status !== 'online') return 'No ride while the conveyor is down'
  return 'No ride right now'
}

// The conveyor is the tunnel's spine and stays put; rooms and labels are scenery.
export const isMovable = (item: TunnelItem): boolean => !shapeFor(item.kind).scenery && item.kind !== 'conveyor'

export type NudgeSize = 'step' | 'fine' | 'big'

// Where a machine lands when it's nudged along the tunnel: on the next half foot (Alt: the
// next tenth; Shift: five feet on), kept on the drawing. A machine that already stands
// past the ends isn't pulled back by a nudge the other way.
export function nudgeAlong(item: TunnelItem, layout: Pick<TunnelLayout, 'length_ft' | 'zones'>, dir: -1 | 1, size: NudgeSize = 'step'): number {
  const x = Number(item.x_ft)
  const grid = size === 'fine' ? 0.1 : 0.5
  const next = size === 'big'
    ? Math.round((x + dir * 5) / grid) * grid
    : dir > 0 ? Math.floor(x / grid + 1e-6) * grid + grid : Math.ceil(x / grid - 1e-6) * grid - grid
  const turned = item.rotation === 90 || item.rotation === 270
  const w = Number(turned ? item.h_ft : item.w_ft)
  let from = 0
  let to = Number(layout.length_ft) || 0
  for (const z of layout.zones ?? []) {
    from = Math.min(from, Number(z.x_from))
    to = Math.max(to, Number(z.x_to))
  }
  // Beside the tunnel there is ground past both ends.
  const past = item.side === 'outside' ? 40 : 0
  const lo = Math.min(x, from - past + w / 2)
  const hi = Math.max(x, to + past - w / 2)
  return Math.round(Math.min(hi, Math.max(lo, next)) * 100) / 100
}
