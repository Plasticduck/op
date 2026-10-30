import type { ReactNode } from 'react'
import { format } from 'date-fns'
import { Sticker } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ItAssetRow } from '@/lib/queries/itInventory'
import { ItIcon } from './ItIcon'
import type { ItRefs } from './useItRefs'
import { daysUntil, fmtDay, healthBadge, needsSticker, statusTone, warrantyState } from './format'

// The list's columns. `get` is the plain value used for sorting and CSV export;
// `cell` is what the table shows (defaults to `get`).

export type ColCtx = { refs: ItRefs; siteName: Map<string, string> }
export type Col = {
  key: string
  label: string
  get: (r: ItAssetRow, c: ColCtx) => string | number | null
  cell?: (r: ItAssetRow, c: ColCtx) => ReactNode
  mono?: boolean
  right?: boolean
}

export const DEFAULT_COLS = ['tag', 'item', 'site', 'status', 'out', 'health', 'warranty', 'serial']

const muted = (v: ReactNode) => (v == null || v === '' ? <span className="text-ink-subtle">–</span> : v)
const model = (r: ItAssetRow, c: ColCtx) => (r.model_id ? c.refs.model.get(r.model_id) : undefined)

export function allColumns(refs: ItRefs): Col[] {
  const base: Col[] = [
    {
      key: 'tag', label: 'Tag', mono: true, get: (r) => r.asset_tag,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.asset_tag}
          {needsSticker(r) && <Sticker className="size-3.5 text-warn" aria-label="Needs a sticker" />}
        </span>
      ),
    },
    {
      key: 'item', label: 'Item', get: (r) => r.name,
      cell: (r, c) => {
        const cat = c.refs.category.get(r.category_id)
        const m = model(r, c)
        return (
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/15 text-accent"><ItIcon name={cat?.icon} className="size-4" /></span>
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{r.name}</div>
              <div className="truncate text-xs text-ink-muted">{[cat?.name, m && m.name !== r.name ? m.name : null].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        )
      },
    },
    { key: 'category', label: 'Category', get: (r, c) => c.refs.category.get(r.category_id)?.name ?? null },
    { key: 'model', label: 'Model', get: (r, c) => model(r, c)?.name ?? null },
    {
      key: 'mfr', label: 'Manufacturer',
      get: (r, c) => { const m = model(r, c); return m?.manufacturer_id ? c.refs.manufacturer.get(m.manufacturer_id)?.name ?? null : null },
    },
    {
      key: 'site', label: 'Site', get: (r, c) => c.siteName.get(r.location_id) ?? 'Archived site',
      cell: (r, c) => (
        <>
          <div className="text-ink">{c.siteName.get(r.location_id) ?? 'Archived site'}</div>
          {r.area_id && <div className="text-xs text-ink-muted">{c.refs.area.get(r.area_id)?.name}</div>}
        </>
      ),
    },
    { key: 'area', label: 'Area', get: (r, c) => (r.area_id ? c.refs.area.get(r.area_id)?.name ?? null : null) },
    {
      key: 'status', label: 'Status', get: (r, c) => c.refs.status.get(r.status_label_id)?.name ?? null,
      cell: (r, c) => { const s = c.refs.status.get(r.status_label_id); return <Badge tone={statusTone(s)}>{s?.name ?? '–'}</Badge> },
    },
    { key: 'out', label: 'Checked out to', get: (r) => r.assigned_label, cell: (r) => <span className="text-ink-muted">{muted(r.assigned_label)}</span> },
    {
      key: 'health', label: 'Health', get: (r) => (r.health_state === 'unknown' ? null : healthBadge(r.health_state).label),
      cell: (r) => { if (r.health_state === 'unknown') return muted(null); const h = healthBadge(r.health_state); return <Badge tone={h.tone}>{h.label}</Badge> },
    },
    {
      key: 'warranty', label: 'Warranty', get: (r) => r.warranty_end_date,
      cell: (r) => {
        const w = warrantyState(r.warranty_end_date)
        if (w.days === null) return muted(null)
        return <span className={cn('whitespace-nowrap text-xs font-medium', w.tone === 'danger' ? 'text-danger' : w.tone === 'warn' ? 'text-warn' : 'text-ok')}>{w.label}</span>
      },
    },
    { key: 'serial', label: 'Serial', mono: true, get: (r) => r.serial },
    { key: 'ip', label: 'IP address', mono: true, get: (r) => (r.ip_address as string | null) ?? null },
    { key: 'mac', label: 'MAC address', mono: true, get: (r) => (r.mac_address as string | null) ?? null },
    { key: 'hostname', label: 'Hostname', mono: true, get: (r) => r.hostname },
    { key: 'purchased', label: 'Purchased', get: (r) => r.purchase_date, cell: (r) => muted(r.purchase_date ? fmtDay(r.purchase_date) : null) },
    { key: 'cost', label: 'Cost', right: true, get: (r) => r.purchase_cost, cell: (r) => muted(r.purchase_cost != null ? currency(r.purchase_cost) : null) },
    { key: 'supplier', label: 'Bought from', get: (r, c) => (r.supplier_id ? c.refs.supplier.get(r.supplier_id)?.name ?? null : null) },
    {
      key: 'sticker', label: 'Sticker',
      get: (r) => (needsSticker(r) ? (r.sticker_condition === 'unknown' ? 'Not printed' : r.sticker_condition) : r.sticker_condition === 'ok' ? 'Readable' : 'Printed'),
      cell: (r) => needsSticker(r)
        ? <Badge tone={r.sticker_condition === 'missing' ? 'danger' : 'warn'}>{r.sticker_condition === 'missing' ? 'Missing' : r.sticker_condition === 'faded' ? 'Faded' : 'Not printed'}</Badge>
        : <span className="text-xs text-ink-muted">{r.sticker_condition === 'ok' ? 'Readable' : 'Printed'}</span>,
    },
    {
      key: 'audit', label: 'Next audit', get: (r) => r.next_audit_date,
      cell: (r) => r.next_audit_date
        ? <span className={cn('whitespace-nowrap text-xs', daysUntil(r.next_audit_date) < 0 ? 'font-medium text-danger' : 'text-ink-muted')}>{fmtDay(r.next_audit_date)}</span>
        : muted(null),
    },
    {
      key: 'seen', label: 'Last seen', get: (r) => r.last_seen_at,
      cell: (r) => muted(r.last_seen_at ? format(new Date(r.last_seen_at), 'MMM d, h:mm a') : null),
    },
    { key: 'notes', label: 'Notes', get: (r) => r.notes, cell: (r) => <span className="line-clamp-2 text-xs text-ink-muted">{muted(r.notes)}</span> },
  ]
  // Custom fields (never secrets: those are only shown to admins on the item).
  const custom: Col[] = refs.fields.filter((f) => f.field_type !== 'secret').map((f) => ({
    key: `cf:${f.key}`,
    label: f.name,
    get: (r) => {
      const v = (r.custom_values as Record<string, unknown> | null)?.[f.key]
      if (v == null || v === '') return null
      if (f.field_type === 'boolean') return v ? 'Yes' : 'No'
      return typeof v === 'number' ? v : String(v)
    },
  }))
  return [...base, ...custom]
}

// Default columns plus custom fields marked "show in list".
export function defaultColumnKeys(refs: ItRefs): string[] {
  return [...DEFAULT_COLS, ...refs.fields.filter((f) => f.show_in_list && f.field_type !== 'secret').map((f) => `cf:${f.key}`)]
}

export function compareValues(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1 // blanks last either way
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}
