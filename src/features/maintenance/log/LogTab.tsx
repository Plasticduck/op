import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import {
  CalendarCheck, ClipboardCheck, Download, Droplet, Image as ImageIcon, Package, RefreshCw, Search, SlidersHorizontal, Sparkles, StickyNote, Wrench, X,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { downloadCsv } from '@/lib/csv'
import { mi } from '@/lib/queries/maintenanceInventory'
import { ml, type FeedFilter, type FeedKind, type FeedRow } from '@/lib/queries/maintenanceLog'
import { cn } from '@/lib/utils'
import { useMi } from '../inventory/context'
import { errText, money } from '../inventory/format'
import { Chips, ErrorNote, Loading, Muted, SearchBox, useDebounced } from '../inventory/ui'
import { LOG_CHANGED } from './context'
import { addDays, ENTRY_TYPE, isoDay, RESULT } from './labels'

const BASE = '/app/maintenance-log'
const INV = '/app/maintenance-inventory'

const ICON: Record<string, LucideIcon> = {
  repair: Wrench,
  inspection: Search,
  cleaning: Sparkles,
  lubrication: Droplet,
  replacement: RefreshCw,
  adjustment: SlidersHorizontal,
  preventive: CalendarCheck,
  note: StickyNote,
  parts: Package,
  work_order: ClipboardCheck,
}

type Range = '7' | '30' | '90' | '365'
const RANGES: Array<{ value: Range; label: string }> = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '12 months' },
]
type Kind = 'all' | FeedKind
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'all', label: 'Everything' },
  { value: 'log', label: 'Log entries' },
  { value: 'work_order', label: 'Work orders' },
  { value: 'parts', label: 'Parts off the shelf' },
]

function feedLink(r: FeedRow): string {
  if (r.kind === 'log') return `${BASE}/entries/${r.id}`
  if (r.kind === 'work_order') return `${INV}/work-orders/${r.id}`
  return r.part_id ? `${INV}/parts/${r.part_id}` : BASE
}

export default function LogTab() {
  const { refs } = useMi()
  const [params, setParams] = useSearchParams()
  const assetFilter = params.get('asset')
  const [assetName, setAssetName] = useState<string | null>(null)
  const [site, setSite] = useState('')
  const [range, setRange] = useState<Range>('30')
  const [kind, setKind] = useState<Kind>('all')
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const [rows, setRows] = useState<FeedRow[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!assetFilter) { setAssetName(null); return }
    let alive = true
    void mi.assetDetail(assetFilter).then((d) => { if (alive) setAssetName(d.hidden ? 'a machine' : d.asset.name) }).catch(() => {})
    return () => { alive = false }
  }, [assetFilter])

  const filter = useMemo<FeedFilter>(() => {
    const today = isoDay()
    return {
      // With one machine picked, go back a few years: that's its whole history.
      from: assetFilter ? addDays(today, -365 * 3) : addDays(today, -(Number(range) - 1)),
      to: today,
      site_id: site || null,
      asset_id: assetFilter,
      q: dq.trim() || undefined,
      kinds: kind === 'all' ? undefined : [kind],
      limit: 100,
    }
  }, [assetFilter, range, site, dq, kind])

  const load = useCallback(async () => {
    try {
      const f = await ml.feed(filter)
      setRows(f.rows)
      setMore(f.more)
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [filter])
  useEffect(() => {
    void load()
    window.addEventListener(LOG_CHANGED, load)
    window.addEventListener('mi-changed', load)
    return () => {
      window.removeEventListener(LOG_CHANGED, load)
      window.removeEventListener('mi-changed', load)
    }
  }, [load])

  const loadMore = async () => {
    if (!rows?.length) return
    setBusy(true)
    try {
      const f = await ml.feed({ ...filter, before: rows[rows.length - 1].at })
      setRows([...rows, ...f.rows])
      setMore(f.more)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = async () => {
    setBusy(true)
    try {
      const f = await ml.feed({ ...filter, limit: 1000 })
      downloadCsv(`maintenance-log-${filter.from}-to-${filter.to}`, [
        ['Date', 'Time', 'Site', 'Machine', 'Source', 'Kind of work', 'What', 'Result', 'On time', 'Who', 'Parts cost', 'Outside cost', 'Time spent (min)', 'Machine down (min)', 'Vendor', 'Work order', 'Notes'],
        ...f.rows.map((r) => [
          format(parseISO(r.at), 'yyyy-MM-dd'), format(parseISO(r.at), 'HH:mm'), r.site_name, r.asset_name,
          r.kind === 'log' ? 'Log entry' : r.kind === 'work_order' ? 'Work order' : 'Parts',
          ENTRY_TYPE[r.entry_type] ?? r.entry_type, r.title, RESULT[r.result]?.label ?? r.result,
          r.on_time == null ? '' : r.on_time ? 'Yes' : 'No', r.who, r.parts_cost, r.outside_cost ?? '', r.labor_minutes ?? '', r.downtime_minutes ?? '',
          r.vendor_name ?? '', r.work_order_number ?? '', r.notes ?? '',
        ]),
      ])
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  // Newest first, under a heading per day.
  const days = useMemo(() => {
    const out: Array<{ day: string; rows: FeedRow[] }> = []
    for (const r of rows ?? []) {
      const d = format(parseISO(r.at), 'EEEE, MMM d, yyyy')
      if (out[out.length - 1]?.day === d) out[out.length - 1].rows.push(r)
      else out.push({ day: d, rows: [r] })
    }
    return out
  }, [rows])

  const total = (rows ?? []).reduce((s, r) => s + Number(r.parts_cost ?? 0) + Number(r.outside_cost ?? 0), 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => setSite(e.target.value)} className="w-full sm:w-44" aria-label="Site">
          <option value="">All my sites</option>
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <SearchBox value={q} onChange={setQ} placeholder="Search what was done, machine or person" className="min-w-[200px] flex-1" />
        <Button variant="secondary" onClick={() => void exportCsv()} disabled={busy || !rows?.length}><Download className="size-4" /> CSV</Button>
      </div>
      {assetFilter ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">History of</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-3 py-1 font-medium text-accent">
            {assetName ?? 'this machine'}
            <button type="button" aria-label="Show every machine" onClick={() => setParams((p) => { p.delete('asset'); return p })}><X className="size-3.5" /></button>
          </span>
          <Link to={`${INV}/assets/${assetFilter}`} className="text-accent hover:underline">Machine details</Link>
        </div>
      ) : (
        <Chips value={range} onChange={setRange} options={RANGES} />
      )}
      <Chips value={kind} onChange={setKind} options={KINDS} />

      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && (
        <Muted>Nothing logged{assetFilter ? ' on this machine' : ' in this range'} yet. Use the + button to log a job.</Muted>
      )}
      {rows && rows.length > 0 && (
        <p className="text-xs text-ink-muted">
          {rows.length}{more ? '+' : ''} {rows.length === 1 ? 'item' : 'items'}{total > 0 ? `, ${money(total)} in parts and outside costs${more ? ' so far' : ''}` : ''}
        </p>
      )}
      {days.map((d) => (
        <section key={d.day} className="flex flex-col gap-1.5">
          <h3 className="sticky top-0 z-10 bg-content/95 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted backdrop-blur">{d.day}</h3>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {d.rows.map((r) => <FeedItem key={`${r.kind}-${r.id}`} r={r} />)}
          </ul>
        </section>
      ))}
      {more && <Button variant="secondary" onClick={() => void loadMore()} disabled={busy}>{busy ? 'Loading...' : 'Show older'}</Button>}
    </div>
  )
}

export function FeedItem({ r, showSite = true }: { r: FeedRow; showSite?: boolean }) {
  const Icon = ICON[r.kind === 'work_order' ? 'work_order' : r.entry_type] ?? Wrench
  const cost = Number(r.parts_cost ?? 0) + Number(r.outside_cost ?? 0)
  return (
    <li>
      <Link to={feedLink(r)} className={cn('flex min-h-14 items-start gap-3 px-3 py-2.5 hover:bg-content', r.voided && 'opacity-60')}>
        <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
          r.result === 'failed' ? 'bg-danger-soft text-danger' : r.result === 'follow_up' ? 'bg-warn-soft text-warn' : r.kind === 'parts' ? 'bg-border/60 text-ink-muted' : 'bg-accent-soft text-accent')}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('text-sm font-medium text-ink', r.voided && 'line-through')}>{r.title}</span>
            {r.kind === 'work_order' && <Badge>WO #{r.work_order_number}</Badge>}
            {r.result !== 'ok' && <Badge tone={RESULT[r.result].tone}>{RESULT[r.result].label}</Badge>}
            {r.on_time === false && <Badge tone="warn">Late</Badge>}
            {r.voided && <Badge>Voided</Badge>}
            {r.is_sample && <Badge>Sample</Badge>}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {[showSite ? r.site_name : null, r.asset_name, r.kind === 'parts' ? r.location_name : null, r.who, format(parseISO(r.at), 'h:mm a')].filter(Boolean).join(' · ')}
          </p>
          {r.notes && r.kind !== 'parts' && <p className="mt-0.5 line-clamp-2 text-xs text-ink">{r.notes}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-ink-muted">
          {cost > 0 && <span className="tabular-nums text-ink">{money(cost)}</span>}
          {!!r.photos && <span className="inline-flex items-center gap-0.5"><ImageIcon className="size-3.5" />{r.photos}</span>}
        </div>
      </Link>
    </li>
  )
}
