import type { TunnelAsset, TunnelItem, TunnelLayout } from '@/lib/queries/miTunnel'
import { expressTemplate } from '../../expressTemplate'

// Sample data for the dev preview: the standard express tunnel as if it had been set up
// at a site. Shapes with a machine type are linked to a made-up machine; presoak,
// protectant and tire shine stay unlinked, as they do on a real site today.

const DOWN: Record<string, TunnelAsset['status']> = {
  'Top Brush 2': 'offline_unplanned',
  'Wheel Boss PS': 'offline_planned',
  'Air Comp 2': 'offline_unplanned',
}
const OPEN_WOS: Record<string, number> = { 'Top Brush 2': 2, 'Wrap DS1': 1, 'Dryers': 1, 'Air Comp 2': 1 }
const NO_STICKER = new Set(['Roller Down', 'Short Brush', 'Turbine 2'])
const TAG_NOT_PRINTED = new Set(['Wrap PS2', 'Hydra Flex'])

export type Fixture = {
  layout: Pick<TunnelLayout, 'length_ft' | 'width_ft' | 'zones'>
  items: TunnelItem[]
  assets: Record<string, TunnelAsset>
}

export function sampleTunnel(opts: { linked?: boolean } = {}): Fixture {
  const linked = opts.linked ?? true
  const t = expressTemplate()
  const assets: Record<string, TunnelAsset> = {}
  const items: TunnelItem[] = (t.items ?? []).map((row, k) => {
    const id = `item-${String(k).padStart(2, '0')}`
    let asset_id: string | null = null
    if (linked && row.match_type) {
      asset_id = `asset-${String(k).padStart(2, '0')}`
      assets[asset_id] = {
        id: asset_id,
        name: `#07 - ${row.match_type}`,
        type: row.match_type,
        status: DOWN[row.label] ?? 'online',
        crit_class: k % 5 === 0 ? 'A' : k % 3 === 0 ? 'B' : 'C',
        area_name: row.zone ?? undefined,
        tag: NO_STICKER.has(row.label) ? undefined : `MF-B-${String(100 + k).padStart(5, '0')}`,
        tag_printed: !NO_STICKER.has(row.label) && !TAG_NOT_PRINTED.has(row.label),
        open_wos: OPEN_WOS[row.label] ?? 0,
        children: row.kind === 'wrap' ? 6 : row.kind === 'blower' ? 12 : k % 4,
        last_serviced_at: '2026-10-28',
        usage_since: row.kind === 'equipment' || row.kind === 'vacuum' ? undefined : '2026-03-02',
        cars_since: row.kind === 'equipment' || row.kind === 'vacuum' ? undefined : 18000 + ((k * 7919) % 60000),
        usage_state: 'ok',
        usage_basis: 'all_cars',
      }
    }
    return { ...row, id, asset_id, rotation: 0, props: row.props ?? {} }
  })
  return { layout: { length_ft: t.length_ft ?? 134, width_ft: t.width_ft ?? 16, zones: t.zones ?? [] }, items, assets }
}
