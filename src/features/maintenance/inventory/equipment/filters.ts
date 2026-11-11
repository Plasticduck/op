import type { EquipmentRow } from '@/lib/queries/miEquipment'
import { needsSticker, warrantyState } from './format'

// Every list filter lives in the URL, so the back button, shared links and saved views
// reproduce a view exactly (same as the IT Inventory list).

export const FILTER_KEYS = ['q', 'site', 'level', 'status', 'zone', 'type', 'crit', 'sticker', 'wo', 'usage', 'warranty', 'mfr'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]
export type EquipmentFilters = Record<FilterKey, string>

// Behind the Filters button (search, site, level and status are always on screen).
export const PANEL_KEYS: FilterKey[] = ['zone', 'type', 'crit', 'sticker', 'wo', 'usage', 'warranty', 'mfr']

export function readFilters(params: URLSearchParams): EquipmentFilters {
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as EquipmentFilters
  if (!f.site) f.site = 'all'
  return f
}

export const panelCount = (f: EquipmentFilters) => PANEL_KEYS.filter((k) => f[k]).length

// level: '' machines (top level), 'components', 'all'.
// status: '' in service, 'down' either kind of down, a status, 'retired', 'any'.
export function matches(r: EquipmentRow, f: EquipmentFilters, ctx: { zoneName: (id?: string) => string | undefined }, haystack: string): boolean {
  if (f.site !== 'all' && r.location_id !== f.site) return false
  if (f.level === '' && r.parent_id) return false
  if (f.level === 'components' && !r.parent_id) return false
  if (f.status === '' && r.status === 'retired') return false
  if (f.status === 'down' && r.status !== 'offline_planned' && r.status !== 'offline_unplanned') return false
  if (f.status && !['', 'down', 'any'].includes(f.status) && r.status !== f.status) return false
  if (f.zone && (f.zone === '-' ? !!r.area_id : ctx.zoneName(r.area_id)?.toLowerCase() !== f.zone.toLowerCase())) return false
  if (f.type && (r.type ?? '').toLowerCase() !== f.type.toLowerCase()) return false
  if (f.crit && (f.crit === '-' ? !!r.crit_class : r.crit_class !== f.crit)) return false
  if (f.sticker === 'needs' && !needsSticker(r)) return false
  if (f.sticker === 'printed' && !r.tag_printed) return false
  if (f.wo === 'open' && !r.open_wos) return false
  if (f.wo === 'none' && r.open_wos) return false
  if (f.usage === 'counted' && r.cars_since == null) return false
  if (f.usage === 'unset' && (r.usage_since || r.usage_basis === 'none')) return false
  if (f.warranty) {
    const w = warrantyState(r.warranty_expiry)
    const state = !w ? 'none' : w.tone === 'ok' ? 'active' : w.tone === 'warn' ? 'expiring' : 'expired'
    if (state !== f.warranty) return false
  }
  if (f.mfr && (r.manufacturer ?? '').toLowerCase() !== f.mfr.toLowerCase()) return false
  if (f.q) {
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.every((w) => haystack.includes(w))) return false
  }
  return true
}

export type ViewParams = Record<string, string>
export const DEFAULT_VIEWS: Array<{ id: string; name: string; params: ViewParams }> = [
  { id: 'all', name: 'Machines in service', params: {} },
  { id: 'down', name: 'Down right now', params: { status: 'down', level: 'all' } },
  { id: 'broken', name: 'Broken down', params: { status: 'offline_unplanned', level: 'all' } },
  { id: 'wo', name: 'With open work orders', params: { wo: 'open', level: 'all' } },
  { id: 'crit', name: 'Criticality A', params: { crit: 'A', level: 'all' } },
  { id: 'sticker', name: 'Needs a sticker', params: { sticker: 'needs' } },
  { id: 'counting', name: 'Counting cars', params: { usage: 'counted', level: 'all', sort: 'cars', dir: 'desc' } },
  { id: 'components', name: 'Components only', params: { level: 'components' } },
]
