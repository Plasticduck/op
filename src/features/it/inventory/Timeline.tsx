import { useEffect, useMemo, useState } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  Activity,
  Archive,
  ArrowRight,
  ClipboardCheck,
  Eye,
  Loader2,
  LogIn,
  LogOut,
  MessageSquareWarning,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Tag,
  Upload,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { itInventory, type ItActivity, type ItAsset } from '@/lib/queries/itInventory'
import type { ItRefs } from './useItRefs'
import { fmtDay } from './format'

// An asset's history, read from it_activity_log (written by database triggers,
// so nothing that changed the asset is missing from it).

const ACTIONS: Record<string, { label: string; icon: LucideIcon; tone?: 'ok' | 'warn' | 'danger' | 'accent' }> = {
  created: { label: 'Added', icon: Plus, tone: 'ok' },
  imported: { label: 'Imported', icon: Upload, tone: 'ok' },
  updated: { label: 'Edited', icon: Pencil },
  status_changed: { label: 'Status changed', icon: RefreshCw, tone: 'accent' },
  health_changed: { label: 'Health changed', icon: Activity, tone: 'warn' },
  checked_out: { label: 'Checked out', icon: LogOut, tone: 'accent' },
  checked_in: { label: 'Checked in', icon: LogIn, tone: 'accent' },
  label_printed: { label: 'Sticker printed', icon: Printer },
  tag_applied: { label: 'Sticker tag applied', icon: Tag },
  tag_retired: { label: 'Tag retired', icon: Archive },
  maintenance_logged: { label: 'Maintenance logged', icon: Wrench, tone: 'warn' },
  audited: { label: 'Audited', icon: ClipboardCheck, tone: 'ok' },
  deleted: { label: 'Archived', icon: Archive, tone: 'danger' },
  secret_revealed: { label: 'Secret field viewed', icon: Eye, tone: 'warn' },
  problem_reported: { label: 'Problem reported', icon: MessageSquareWarning, tone: 'danger' },
}

const FILTERS: { key: string; label: string; actions: string[] | null }[] = [
  { key: '', label: 'All activity', actions: null },
  { key: 'status', label: 'Status and health', actions: ['status_changed', 'health_changed'] },
  { key: 'checkout', label: 'Check-outs', actions: ['checked_out', 'checked_in'] },
  { key: 'sticker', label: 'Stickers', actions: ['label_printed', 'tag_applied', 'tag_retired'] },
  { key: 'problems', label: 'Problem reports', actions: ['problem_reported'] },
  { key: 'maintenance', label: 'Maintenance', actions: ['maintenance_logged'] },
  { key: 'edits', label: 'Edits', actions: ['created', 'imported', 'updated', 'deleted', 'secret_revealed'] },
]

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', location_id: 'Site', area_id: 'Area', status_label_id: 'Status', category_id: 'Category',
  model_id: 'Model', serial: 'Serial', ip_address: 'IP address', mac_address: 'MAC address', hostname: 'Hostname',
  purchase_date: 'Purchase date', purchase_cost: 'Cost', supplier_id: 'Bought from', order_number: 'Order number',
  warranty_end_date: 'Warranty ends', eol_date: 'End of life', notes: 'Notes', sticker_condition: 'Sticker',
  sticker_last_verified_at: 'Sticker checked', health_state: 'Health', image_path: 'Photo', parent_asset_id: 'Part of',
  next_audit_date: 'Next audit', last_audit_at: 'Last audit', deleted_at: 'Archived', custom_values: 'Custom fields',
  monitoring_enabled: 'Monitoring', monitor_method: 'Monitor method', monitor_target: 'Monitor target',
  status: 'Tag status', secret_field: 'Secret field', value: 'Value',
}

export function Timeline({ asset, refs, siteName }: { asset: ItAsset; refs: ItRefs; siteName: Map<string, string> }) {
  const [rows, setRows] = useState<ItActivity[] | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    void itInventory.activity(asset.id).then(({ data }) => { if (alive) setRows(data ?? []) })
    return () => { alive = false }
  }, [asset.id, asset.updated_at])

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)?.actions
    return (rows ?? []).filter((r) => !f || f.includes(r.action))
  }, [rows, filter])

  const fmtVal = (key: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return 'empty'
    const s = String(v)
    switch (key) {
      case 'location_id': return siteName.get(s) ?? 'another site'
      case 'area_id': return refs.area.get(s)?.name ?? 'an area'
      case 'status_label_id': return refs.status.get(s)?.name ?? 'a status'
      case 'category_id': return refs.category.get(s)?.name ?? 'a category'
      case 'model_id': return refs.model.get(s)?.name ?? 'a model'
      case 'supplier_id': return refs.supplier.get(s)?.name ?? 'a supplier'
      case 'parent_asset_id': return 'another item'
      case 'purchase_cost': return currency(Number(v))
      case 'image_path': return 'new photo'
      case 'custom_values': return 'updated'
      case 'deleted_at': return 'yes'
      case 'sticker_last_verified_at':
      case 'last_audit_at': return format(new Date(s), 'MMM d, yyyy')
    }
    if (typeof v === 'boolean') return v ? 'on' : 'off'
    if (/_date$/.test(key) && /^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDay(s)
    return s
  }

  // One line of plain English for each entry, plus the field changes for edits.
  const describe = (r: ItActivity): {
    summary: string | null
    changes: { label: string; from: string; to: string }[]
    label?: string
    photo?: string
  } => {
    const after = (r.after ?? {}) as Record<string, unknown>
    const before = (r.before ?? {}) as Record<string, unknown>
    if (r.entity_type === 'attachment') {
      return {
        label: r.action === 'deleted' ? 'Photo removed' : 'Photo added',
        summary: after.caption ? String(after.caption) : null,
        changes: [],
        photo: r.action === 'created' && after.storage_path ? String(after.storage_path) : undefined,
      }
    }
    switch (r.action) {
      case 'created':
      case 'imported':
        return { summary: `at ${fmtVal('location_id', after.location_id)}${after.area_id ? `, ${fmtVal('area_id', after.area_id)}` : ''}`, changes: [] }
      case 'checked_out':
        return {
          summary: `to ${String(after.assigned_label ?? 'someone')}`
            + (after.expected_return_at ? `, due back ${format(new Date(String(after.expected_return_at)), 'MMM d')}` : '')
            + (after.note ? `. "${String(after.note)}"` : ''),
          changes: [],
        }
      case 'checked_in':
        return { summary: after.checkin_note ? `"${String(after.checkin_note)}"` : null, changes: [] }
      case 'label_printed': {
        const copies = Number(after.copies ?? 1)
        return { summary: `${String(after.template ?? 'Sticker')}${copies > 1 ? `, ${copies} copies` : ''}`, changes: [] }
      }
      case 'maintenance_logged':
        return { summary: String(after.title ?? ''), changes: [] }
      case 'secret_revealed':
        return { summary: String(after.field ?? ''), changes: [] }
      case 'problem_reported':
        return { summary: after.description ? `"${String(after.description)}"` : null, changes: [] }
    }
    if (r.entity_type !== 'asset' && r.action !== 'updated') return { summary: null, changes: [] }
    // A note set with the change (status, move, check-in) reads as a quote.
    const keys = Object.keys(after).filter((k) => k !== 'note' && (k !== 'deleted_at' || r.action !== 'deleted'))
    return {
      summary: r.action === 'updated' && before.deleted_at && !after.deleted_at ? 'Restored'
        : after.note ? `"${String(after.note)}"` : null,
      changes: keys.map((k) => ({ label: FIELD_LABELS[k] ?? k.replace(/_/g, ' '), from: fmtVal(k, before[k]), to: fmtVal(k, after[k]) })),
    }
  }

  if (rows === null) {
    return <div className="grid place-items-center py-12 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{shown.length} event{shown.length === 1 ? '' : 's'}</div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 max-w-[200px]" aria-label="Show">
          {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 rounded-md border border-border bg-content/40 p-3 text-sm text-ink-muted">Nothing here yet.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {shown.map((r) => {
            const meta = ACTIONS[r.action] ?? ACTIONS.updated
            const d = describe(r)
            return (
              <li key={r.id} className="flex gap-3">
                <span className={cn(
                  'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full',
                  meta.tone === 'ok' ? 'bg-ok-soft text-ok'
                    : meta.tone === 'warn' ? 'bg-warn-soft text-warn'
                      : meta.tone === 'danger' ? 'bg-danger-soft text-danger'
                        : meta.tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-content text-ink-muted',
                )}>
                  <meta.icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="text-ink">
                    <span className="font-medium">{d.summary === 'Restored' ? 'Restored' : d.label ?? meta.label}</span>
                    {d.summary && d.summary !== 'Restored' && <span className="text-ink-muted"> {d.summary}</span>}
                    {d.photo && (
                      <button type="button" className="ml-2 text-xs font-medium text-accent hover:underline"
                        onClick={() => { void itInventory.photoUrl(d.photo!).then((u) => { if (u) window.open(u, '_blank', 'noopener') }) }}>
                        View
                      </button>
                    )}
                  </div>
                  {d.changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {d.changes.map((c) => (
                        <li key={c.label} className="flex flex-wrap items-center gap-1 text-ink-muted">
                          <span className="font-medium text-ink">{c.label}:</span>
                          <span className="line-through decoration-ink-subtle/60">{c.from}</span>
                          <ArrowRight className="size-3 shrink-0" />
                          <span className="text-ink">{c.to}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-0.5 text-[11px] text-ink-subtle" title={format(new Date(r.created_at), 'MMM d, yyyy h:mm a')}>
                    {r.actor_name ?? (r.actor_system ? 'Operator' : 'Someone')} · {formatDistanceToNowStrict(new Date(r.created_at), { addSuffix: true })}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
