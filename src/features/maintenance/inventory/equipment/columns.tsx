import type { ReactNode } from 'react'
import { Sticker } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import type { EquipmentRow } from '@/lib/queries/miEquipment'
import { day } from '../format'
import { cars, CRIT, needsSticker, shortName, STATUS, warrantyState } from './format'

// The list's columns. `get` is the plain value used for sorting and CSV export;
// `cell` is what the table shows (defaults to `get`).

export type ColCtx = {
  siteName: Map<string, string>
  zoneName: (id?: string) => string | undefined
  rowName: Map<string, string>
  showSite: boolean
}
export type Col = {
  key: string
  label: string
  get: (r: EquipmentRow, c: ColCtx) => string | number | null
  cell?: (r: EquipmentRow, c: ColCtx) => ReactNode
  mono?: boolean
  right?: boolean
}

export const DEFAULT_COLS = ['item', 'site', 'status', 'crit', 'wos', 'cars', 'serviced', 'tag']

const muted = (v: ReactNode) => (v == null || v === '' ? <span className="text-ink-subtle">–</span> : v)

export const COLUMNS: Col[] = [
  {
    key: 'item', label: 'Equipment', get: (r) => r.name,
    cell: (r, c) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{c.showSite ? r.name : shortName(r.name)}</div>
        <div className="truncate text-xs text-ink-muted">
          {[r.parent_id ? `Part of ${shortName(c.rowName.get(r.parent_id) ?? 'another machine')}` : null,
            r.children ? `${r.children} component${r.children === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || r.type}
        </div>
      </div>
    ),
  },
  { key: 'type', label: 'Type', get: (r) => r.type ?? null },
  {
    key: 'site', label: 'Site', get: (r, c) => c.siteName.get(r.location_id) ?? null,
    cell: (r, c) => (
      <>
        <div className="text-ink">{c.siteName.get(r.location_id) ?? '–'}</div>
        {r.area_id && <div className="text-xs text-ink-muted">{c.zoneName(r.area_id)}</div>}
      </>
    ),
  },
  { key: 'zone', label: 'Zone', get: (r, c) => c.zoneName(r.area_id) ?? null },
  {
    key: 'status', label: 'Status', get: (r) => STATUS[r.status]?.label ?? r.status,
    cell: (r) => <Badge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.short ?? r.status}</Badge>,
  },
  {
    key: 'crit', label: 'Crit.', get: (r) => r.crit_class ?? null,
    cell: (r) => (r.crit_class ? <Badge tone={CRIT[r.crit_class].tone}>{r.crit_class}</Badge> : muted(null)),
  },
  {
    key: 'wos', label: 'Open WOs', right: true, get: (r) => r.open_wos || null,
    cell: (r) => (r.open_wos ? <span className="font-medium text-warn">{r.open_wos}</span> : muted(null)),
  },
  {
    key: 'cars', label: 'Cars since', right: true, get: (r) => r.cars_since ?? null,
    cell: (r) => (r.cars_since != null ? <span title={r.usage_since ? `Since ${day(r.usage_since)}` : undefined}>{cars(r.cars_since)}</span> : muted(null)),
  },
  { key: 'since', label: 'Counting since', get: (r) => r.usage_since ?? null, cell: (r) => muted(r.usage_since ? day(r.usage_since) : null) },
  { key: 'serviced', label: 'Last serviced', get: (r) => r.last_serviced_at ?? null, cell: (r) => muted(r.last_serviced_at ? day(r.last_serviced_at) : null) },
  { key: 'installed', label: 'Installed', get: (r) => r.install_date ?? null, cell: (r) => muted(r.install_date ? day(r.install_date) : null) },
  {
    key: 'warranty', label: 'Warranty', get: (r) => r.warranty_expiry ?? null,
    cell: (r) => {
      const w = warrantyState(r.warranty_expiry)
      if (!w) return muted(null)
      return <span className={cn('whitespace-nowrap text-xs font-medium', w.tone === 'warn' ? 'text-warn' : w.tone === 'ok' ? 'text-ok' : 'text-ink-muted')}>{w.label}</span>
    },
  },
  { key: 'mfr', label: 'Manufacturer', get: (r) => r.manufacturer ?? null },
  { key: 'model', label: 'Model', get: (r) => r.model ?? null },
  { key: 'serial', label: 'Serial', mono: true, get: (r) => r.serial_number ?? null },
  { key: 'number', label: 'Asset #', mono: true, right: true, get: (r) => r.asset_number ?? null },
  { key: 'parts', label: 'Parts listed', right: true, get: (r) => r.bom_lines || null },
  {
    key: 'tag', label: 'Sticker', mono: true, get: (r) => r.tag ?? null,
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5">
        {r.tag ?? (r.parent_id ? null : <span className="font-sans text-ink-subtle">None</span>)}
        {needsSticker(r) && <Sticker className="size-3.5 text-warn" aria-label="Needs a sticker" />}
      </span>
    ),
  },
  { key: 'audited', label: 'Last audited', get: (r) => r.last_audited_at ?? null, cell: (r) => muted(r.last_audited_at ? day(r.last_audited_at) : null) },
]

export function compareValues(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}
