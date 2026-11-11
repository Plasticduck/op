import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import {
  Archive, ArchiveRestore, ArrowRight, ClipboardCheck, ClipboardList, Copy, Layers, Loader2, MapPin, MessageSquareWarning, NotebookPen,
  PackageMinus, Pencil, Plus, Printer, RefreshCw, RotateCcw, Tag, Trash2, Upload, Workflow, type LucideIcon,
} from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { miEquipment, type TimelineItem } from '@/lib/queries/miEquipment'
import { cn } from '@/lib/utils'
import { errText, money, qty } from '../format'
import { ErrorNote } from '../ui'
import { STATUS } from './format'

// Everything that happened to one machine, newest first: edits (from any page, written
// by a database trigger), logged work, work orders and parts.

const EVENTS: Record<string, { label: string; icon: LucideIcon; tone?: 'ok' | 'warn' | 'danger' | 'accent' }> = {
  created: { label: 'Added', icon: Plus, tone: 'ok' },
  imported: { label: 'Imported', icon: Upload, tone: 'ok' },
  cloned: { label: 'Added as a copy', icon: Copy, tone: 'ok' },
  updated: { label: 'Edited', icon: Pencil },
  status_changed: { label: 'Status changed', icon: RefreshCw, tone: 'accent' },
  retired: { label: 'Retired', icon: Archive, tone: 'danger' },
  restored: { label: 'Restored', icon: ArchiveRestore, tone: 'ok' },
  moved_site: { label: 'Moved to another site', icon: MapPin, tone: 'accent' },
  moved_zone: { label: 'Zone changed', icon: Layers },
  parent_changed: { label: 'Moved under another machine', icon: Workflow },
  tag_applied: { label: 'Sticker applied', icon: Tag },
  tag_retired: { label: 'Sticker retired', icon: Tag },
  label_printed: { label: 'Sticker printed', icon: Printer },
  audited: { label: 'Audited', icon: ClipboardCheck, tone: 'ok' },
  problem_reported: { label: 'Problem reported', icon: MessageSquareWarning, tone: 'danger' },
  diagram_linked: { label: 'Placed on the tunnel diagram', icon: Layers },
  diagram_unlinked: { label: 'Taken off the tunnel diagram', icon: Layers },
  deleted: { label: 'Deleted', icon: Trash2, tone: 'danger' },
}

const FIELD: Record<string, string> = {
  name: 'Name', type: 'Type', description: 'Notes', status: 'Status', parent_asset_id: 'Part of', area_id: 'Zone', vendor_id: 'Vendor',
  crit_class: 'Criticality', criticality: 'Criticality (old)', manufacturer: 'Manufacturer', model: 'Model', serial_number: 'Serial',
  purchase_date: 'Bought', install_date: 'Installed', warranty_expiry: 'Warranty until', usage_basis: 'Use counted by', location_id: 'Site',
  last_audited_at: 'Last audited', maintainx_id: 'MaintainX link', usage_packages: 'Packages',
}
// Ids aren't worth showing; the label says what moved.
const HIDE_VALUE = new Set(['parent_asset_id', 'area_id', 'vendor_id', 'location_id', 'criticality', 'last_audited_at'])

const FILTERS: Array<{ key: string; label: string; kinds: Array<TimelineItem['kind']> | null }> = [
  { key: '', label: 'Everything', kinds: null },
  { key: 'work', label: 'Work and work orders', kinds: ['log', 'wo'] },
  { key: 'parts', label: 'Parts', kinds: ['part'] },
  { key: 'changes', label: 'Changes', kinds: ['event'] },
]

function show(k: string, v: unknown): string {
  if (v == null || v === '') return 'blank'
  if (k === 'status') return STATUS[v as keyof typeof STATUS]?.label ?? String(v)
  if (/_date$|_expiry$/.test(k) && typeof v === 'string') return format(parseISO(v), 'MMM d, yyyy')
  return String(v)
}

export function Timeline({ assetId }: { assetId: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => {
    let alive = true
    miEquipment.timeline(assetId).then((r) => { if (alive) setItems(r) }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [assetId])
  const kinds = FILTERS.find((x) => x.key === filter)?.kinds
  const shown = useMemo(() => (items ?? []).filter((i) => !kinds || kinds.includes(i.kind)), [items, kinds])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!items) return <div className="grid place-items-center py-10 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
  return (
    <div className="flex flex-col gap-3">
      <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show" className="sm:w-56">
        {FILTERS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
      </Select>
      {shown.length === 0 ? <p className="py-6 text-center text-sm text-ink-muted">Nothing yet.</p> : (
        <ol className="relative ml-3 border-l border-border">
          {shown.map((i, n) => <Item key={n} i={i} />)}
        </ol>
      )}
    </div>
  )
}

function Item({ i }: { i: TimelineItem }) {
  let icon: LucideIcon
  let tone: 'ok' | 'warn' | 'danger' | 'accent' | undefined
  let title: React.ReactNode
  let body: React.ReactNode = null
  let by: string | null | undefined
  if (i.kind === 'event') {
    const e = EVENTS[i.action] ?? { label: i.action, icon: Pencil }
    icon = e.icon
    tone = e.tone
    title = e.label
    by = i.by
    const keys = Object.keys(i.after ?? {}).filter((k) => FIELD[k])
    if (i.action !== 'created' && i.action !== 'cloned' && i.action !== 'imported' && keys.length > 0) {
      body = (
        <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
          {keys.map((k) => (
            <li key={k}>
              {FIELD[k]}{HIDE_VALUE.has(k) ? ' changed' : <>: {show(k, i.before?.[k])} <ArrowRight className="inline size-3" /> <span className="text-ink">{show(k, i.after?.[k])}</span></>}
            </li>
          ))}
        </ul>
      )
    }
    if (i.note) body = <>{body}<p className="mt-1 text-xs text-ink-muted">"{i.note}"</p></>
  } else if (i.kind === 'log') {
    icon = i.resets_usage ? RotateCcw : NotebookPen
    tone = i.voided ? undefined : i.result === 'failed' ? 'danger' : i.result === 'follow_up' ? 'warn' : 'ok'
    title = <Link to={`/app/maintenance-log/entries/${i.id}`} className={cn('hover:underline', i.voided && 'line-through')}>{i.title}</Link>
    by = i.by
    body = (
      <p className="mt-0.5 text-xs text-ink-muted">
        {[i.entry_type.replace(/_/g, ' '), i.resets_usage ? 'use count restarted' : null, i.downtime_minutes ? `${i.downtime_minutes} min down` : null, i.voided ? 'voided' : null].filter(Boolean).join(' · ')}
        {i.notes && <span className="block">"{i.notes}"</span>}
      </p>
    )
  } else if (i.kind === 'wo') {
    icon = ClipboardList
    tone = i.what === 'closed' ? 'ok' : 'accent'
    title = <Link to={`/app/maintenance-inventory/work-orders/${i.id}`} className="hover:underline">Work order #{i.number} {i.what}</Link>
    body = <p className="mt-0.5 truncate text-xs text-ink-muted">{i.title}</p>
    by = i.by
  } else {
    icon = PackageMinus
    title = <Link to={`/app/maintenance-inventory/parts/${i.part_id}`} className="hover:underline">{i.type === 'return' ? 'Returned' : 'Used'} {i.part_name}</Link>
    body = <p className="mt-0.5 text-xs text-ink-muted">x{qty(Math.abs(i.qty))}, {money(Math.abs(i.cost))}</p>
  }
  const Icon = icon
  return (
    <li className="mb-4 ml-5">
      <span className={cn('absolute -left-3 grid size-6 place-items-center rounded-full border border-border bg-card',
        tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger', tone === 'accent' && 'text-accent', !tone && 'text-ink-muted')}>
        <Icon className="size-3.5" />
      </span>
      <div className="text-sm font-medium text-ink">{title}</div>
      {body}
      <div className="mt-0.5 text-[11px] text-ink-subtle">{format(parseISO(i.at), 'MMM d, yyyy h:mm a')}{by ? ` · ${by}` : ''}</div>
    </li>
  )
}
