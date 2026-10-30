import type { ItAssetRow } from '@/lib/queries/itInventory'
import type { ItRefs } from './useItRefs'
import { daysUntil, needsSticker, WARRANTY_WINDOW_DAYS } from './format'

// Every list filter, read from and written to the URL, so the back button,
// shared links and saved views all reproduce a view exactly.

export const FILTER_KEYS = [
  'q', 'site', 'cat', 'status', 'sticker', 'area', 'model', 'mfr', 'out', 'health', 'warranty', 'audit', 'from', 'to', 'cf', 'cfv',
] as const
export type FilterKey = (typeof FILTER_KEYS)[number]
export type AssetFilters = Record<FilterKey, string>

// The ones behind the "Filters" button (search, site, category and status are
// always on screen).
export const PANEL_KEYS: FilterKey[] = ['area', 'model', 'mfr', 'out', 'health', 'warranty', 'audit', 'sticker', 'from', 'to', 'cf']

export function readFilters(params: URLSearchParams, defaultSite: string): AssetFilters {
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as AssetFilters
  if (!params.has('site')) f.site = defaultSite
  return f
}

export const panelCount = (f: AssetFilters) => PANEL_KEYS.filter((k) => f[k]).length

// status: '' active (not retired), 'all', 'archived', 'type:<type>',
// 'name:<label name>' (used by the built-in views), or a status label id.
export function statusMatches(r: ItAssetRow, status: string, refs: ItRefs): boolean {
  const s = refs.status.get(r.status_label_id)
  if (status === '' ) return s?.type !== 'archived'
  if (status === 'all' || status === 'archived') return true
  if (status.startsWith('type:')) return s?.type === status.slice(5)
  if (status.startsWith('name:')) return s?.name.toLowerCase() === status.slice(5).toLowerCase()
  return r.status_label_id === status
}

export function matches(r: ItAssetRow, f: AssetFilters, refs: ItRefs, haystack: string): boolean {
  if (f.site && f.site !== 'all' && r.location_id !== f.site) return false
  if (f.cat && r.category_id !== f.cat) return false
  if (!statusMatches(r, f.status, refs)) return false
  if (f.area && r.area_id !== f.area) return false
  if (f.model && r.model_id !== f.model) return false
  if (f.mfr && (r.model_id ? refs.model.get(r.model_id)?.manufacturer_id : null) !== f.mfr) return false

  if (f.out === 'out' && !r.assigned_type) return false
  if (f.out === 'in' && r.assigned_type) return false
  if (['user', 'area', 'asset', 'site'].includes(f.out) && r.assigned_type !== f.out) return false

  if (f.health && r.health_state !== f.health) return false

  if (f.warranty) {
    const d = r.warranty_end_date ? daysUntil(r.warranty_end_date) : null
    const state = d === null ? 'none' : d < 0 ? 'expired' : d <= WARRANTY_WINDOW_DAYS ? 'expiring' : 'active'
    if (state !== f.warranty) return false
  }
  if (f.audit) {
    const d = r.next_audit_date ? daysUntil(r.next_audit_date) : null
    const state = d === null ? 'none' : d < 0 ? 'overdue' : d <= refs.settings.audit_warning_days ? 'due' : 'ok'
    if (state !== f.audit) return false
  }
  if (f.sticker) {
    if (f.sticker === 'needs' ? !needsSticker(r) : r.sticker_condition !== f.sticker) return false
  }
  if (f.from && (!r.purchase_date || r.purchase_date < f.from)) return false
  if (f.to && (!r.purchase_date || r.purchase_date > f.to)) return false
  if (f.cf) {
    const v = (r.custom_values as Record<string, unknown> | null)?.[f.cf]
    const text = v == null ? '' : String(v).toLowerCase()
    if (f.cfv ? !text.includes(f.cfv.toLowerCase()) : !text) return false
  }
  if (f.q) {
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.every((w) => haystack.includes(w))) return false
  }
  return true
}

// The built-in views (spec: Offline now, Warranty expiring, Audit overdue,
// Out for repair, Checked out to people, Needs sticker). Saved views from
// people live in it_saved_views.
export type ViewParams = Record<string, string>
export const DEFAULT_VIEWS: { id: string; name: string; params: ViewParams }[] = [
  { id: 'all', name: 'Everything active', params: {} },
  { id: 'offline', name: 'Offline now', params: { health: 'offline' } },
  { id: 'warranty', name: `Warranty ending in ${WARRANTY_WINDOW_DAYS} days`, params: { warranty: 'expiring' } },
  { id: 'audit', name: 'Audit overdue', params: { audit: 'overdue' } },
  { id: 'repair', name: 'Out for repair', params: { status: 'name:Out for Repair' } },
  { id: 'people', name: 'Checked out to people', params: { out: 'user' } },
  { id: 'sticker', name: 'Needs a sticker', params: { sticker: 'needs' } },
]
