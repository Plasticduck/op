import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'
import { Boxes, CalendarClock, Download, Eye, Grid3x3, List, Loader2, Plus, Search, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useLocations } from '@/lib/locations'
import { currency } from '@/lib/format'
import { exportExcel, type ExportColumn } from '@/lib/opsExport'
import { cn } from '@/lib/utils'
import { itInventory, type ItAssetRow } from '@/lib/queries/itInventory'
import { ItAssetModal } from './ItAssetModal'
import ItAssetDetail from './ItAssetDetail'
import {
  assetTag,
  categoryOf,
  DUE_WINDOW_DAYS,
  dueEntries,
  dueLabel,
  IT_CATEGORIES,
  IT_GROUPS,
  IT_STATUSES,
  needsCheck,
  NO_SITE,
  statusOf,
  VERIFY_STALE_DAYS,
} from './itInventorySchema'

// IT Inventory: a running database of IT gear and recurring IT services, by
// site. /app/it-inventory is the list (plus By site and Coming due views);
// /app/it-inventory/:id is one record with its history and a QR label. Filters
// live in the URL so coming back from a record keeps them.

type View = 'list' | 'sites' | 'due'
const VIEWS: { key: View; label: string; icon: typeof List }[] = [
  { key: 'list', label: 'List', icon: List },
  { key: 'sites', label: 'By site', icon: Grid3x3 },
  { key: 'due', label: 'Coming due', icon: CalendarClock },
]

const fmtDay = (day: string) => format(parseISO(day), 'MMM d, yyyy')

function searchText(r: ItAssetRow): string {
  return [
    assetTag(r.asset_number), r.name, categoryOf(r.category).label, r.manufacturer, r.model, r.serial_number,
    r.hostname, r.ip_address, r.mac_address, r.assigned_to, r.placement, r.vendor, r.location?.name, r.notes,
  ].filter(Boolean).join(' ').toLowerCase()
}

export default function ItInventoryPage() {
  const { id } = useParams()
  return id ? <ItAssetDetail id={id} /> : <InventoryList />
}

function InventoryList() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const { locations } = useLocations()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<ItAssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<null | { copyFrom?: ItAssetRow }>(null)
  const [exporting, setExporting] = useState(false)

  const view = (params.get('view') as View | null) ?? 'list'
  const q = params.get('q') ?? ''
  const site = params.get('site') ?? '' // '' all, 'none' no site, else a location id
  const cat = params.get('cat') ?? '' // '' all, 'group:<name>', else a category key
  const status = params.get('status') ?? '' // '' active only, 'all', else a status key
  const unchecked = params.get('check') === '1'
  const setParam = (patch: Record<string, string>) =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      return next
    }, { replace: true })

  const load = useCallback(async () => {
    const { data, error: err } = await itInventory.list()
    setError(err ? err.message : null)
    setRows((data as unknown as ItAssetRow[]) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (site === 'none' ? !!r.location_id : !!site && r.location_id !== site) return false
      if (cat.startsWith('group:') ? categoryOf(r.category).group !== cat.slice(6) : !!cat && r.category !== cat) return false
      if (status !== 'all' && (status ? r.status !== status : !statusOf(r.status).active)) return false
      if (unchecked && !needsCheck(r)) return false
      return !needle || searchText(r).includes(needle)
    })
  }, [rows, q, site, cat, status, unchecked])

  const stats = useMemo(() => {
    const active = rows.filter((r) => statusOf(r.status).active)
    const devices = active.filter((r) => categoryOf(r.category).kind === 'device')
    return {
      devices: devices.length,
      spare: active.filter((r) => r.status === 'spare').length,
      repair: active.filter((r) => r.status === 'in_repair').length,
      monthly: active.reduce((a, r) => a + (r.monthly_cost ?? 0), 0),
      services: active.filter((r) => categoryOf(r.category).kind === 'service').length,
      due: active.reduce((a, r) => a + dueEntries(r).length, 0),
      unchecked: rows.filter(needsCheck).length,
    }
  }, [rows])

  const open = (r: ItAssetRow) => navigate(`/app/it-inventory/${r.id}`, { state: { back: routerLocation.search } })
  const filtersOn = !!(q || site || cat || status || unchecked)

  const exportRows = async () => {
    setExporting(true)
    try {
      await exportExcel('it-inventory', EXPORT_COLUMNS, filtered)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="IT Inventory"
        subtitle="Every computer, pay station, camera, network box and IT service, by site."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void exportRows()} disabled={exporting || !filtered.length}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export
            </Button>
            <Button onClick={() => setModal({})}>
              <Plus className="size-4" /> Add item
            </Button>
          </div>
        }
      />

      {error && (
        <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load the inventory: {error}</p>
      )}

      <StatCardRow
        className="mt-5"
        items={[
          { label: 'Active gear', value: stats.devices, hint: `${stats.spare} spare, ${stats.repair} in repair` },
          { label: 'Monthly recurring', value: currency(stats.monthly), hint: `${stats.services} services and plans, plus leases` },
          { label: 'Coming due', value: stats.due, hint: `Warranties and renewals, next ${DUE_WINDOW_DAYS} days` },
          { label: 'Needs a check', value: stats.unchecked, hint: `Not seen in person in ${Math.round(VERIFY_STALE_DAYS / 30)} months` },
        ]}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" onClick={() => setParam({ view: v.key === 'list' ? '' : v.key })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
                view === v.key ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink',
              )}>
              <v.icon className="size-4" /> {v.label}
              {v.key === 'due' && stats.due > 0 && (
                <span className="rounded-full bg-warn-soft px-1.5 text-xs font-semibold text-warn">{stats.due}</span>
              )}
            </button>
          ))}
        </div>
        {stats.unchecked > 0 && view === 'list' && (
          <button type="button" onClick={() => setParam({ check: unchecked ? '' : '1' })}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
              unchecked ? 'border-warn bg-warn-soft text-warn' : 'border-border bg-card text-ink-muted hover:text-ink',
            )}>
            <Eye className="size-4" /> Needs a check ({stats.unchecked})
          </button>
        )}
      </div>

      {view === 'list' && (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_200px_220px_200px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={q} onChange={(e) => setParam({ q: e.target.value })} className="pl-9"
                placeholder="Search name, serial, IP, MAC, person…" />
            </div>
            <Select value={site} onChange={(e) => setParam({ site: e.target.value })} aria-label="Site">
              <option value="">All sites</option>
              <option value="none">{NO_SITE}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select value={cat} onChange={(e) => setParam({ cat: e.target.value })} aria-label="Category">
              <option value="">All categories</option>
              {IT_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  <option value={`group:${g}`}>All {g.toLowerCase()}</option>
                  {IT_CATEGORIES.filter((c) => c.group === g).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </optgroup>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setParam({ status: e.target.value })} aria-label="Status">
              <option value="">Active (not retired or lost)</option>
              <option value="all">Any status</option>
              {IT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </div>

          <div className="mt-3">
            {loading ? (
              <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-ink-muted">Loading inventory…</p>
            ) : rows.length === 0 && !error ? (
              <EmptyState
                icon={Boxes}
                title="Nothing in the inventory yet"
                description="Add the gear at each site: computers, pay stations, cameras, network equipment, plus internet and software you pay for monthly."
                action={<Button onClick={() => setModal({})}><Plus className="size-4" /> Add the first item</Button>}
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Nothing matches these filters"
                action={
                  <Button variant="secondary" onClick={() => setParam({ q: '', site: '', cat: '', status: '', check: '' })}>
                    <X className="size-4" /> Clear filters
                  </Button>
                }
              />
            ) : (
              <AssetTable rows={filtered} onOpen={open} />
            )}
            {!loading && filtered.length > 0 && (
              <p className="mt-2 text-xs text-ink-muted">
                Showing {filtered.length} of {rows.length}
                {filtersOn && (
                  <button type="button" className="ml-2 text-accent hover:underline"
                    onClick={() => setParam({ q: '', site: '', cat: '', status: '', check: '' })}>
                    Clear filters
                  </button>
                )}
              </p>
            )}
          </div>
        </>
      )}

      {view === 'sites' && !loading && (
        <BySite rows={rows} locations={locations}
          onPick={(siteId, group) => setParam({ view: '', site: siteId, cat: group ? `group:${group}` : '', status: '', q: '', check: '' })} />
      )}

      {view === 'due' && !loading && <ComingDue rows={rows} onOpen={open} />}

      {modal && (
        <ItAssetModal
          copyFrom={modal.copyFrom}
          defaultSiteId={site && site !== 'none' ? site : ''}
          onClose={() => setModal(null)}
          onSaved={(id) => {
            setModal(null)
            void load()
            if (id) navigate(`/app/it-inventory/${id}`, { state: { back: routerLocation.search } })
          }}
        />
      )}
    </div>
  )
}

// ---- List -------------------------------------------------------------------

function AssetTable({ rows, onOpen }: { rows: ItAssetRow[]; onOpen: (r: ItAssetRow) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
          <tr>
            <th className="px-3 py-2 font-medium">Tag</th>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Site</th>
            <th className="px-3 py-2 font-medium">Network</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Coming due</th>
            <th className="px-3 py-2 font-medium">Last checked</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const c = categoryOf(r.category)
            const s = statusOf(r.status)
            const due = dueEntries(r).sort((a, b) => a.days - b.days)[0]
            const stale = needsCheck(r)
            const makeModel = [r.manufacturer, r.model].filter(Boolean).join(' ')
            return (
              <tr key={r.id} onClick={() => onOpen(r)} className="cursor-pointer hover:bg-content">
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink-muted">{assetTag(r.asset_number)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-content text-ink-muted">
                      <c.icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{r.name}</div>
                      <div className="truncate text-xs text-ink-muted">{[c.label, makeModel].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className={r.location ? 'text-ink' : 'text-ink-muted'}>{r.location?.name ?? NO_SITE}</div>
                  {r.placement && <div className="text-xs text-ink-muted">{r.placement}</div>}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">
                  {r.ip_address || r.hostname ? (
                    <>
                      {r.ip_address && <div className="text-ink">{r.ip_address}</div>}
                      {r.hostname && <div className="text-ink-muted">{r.hostname}</div>}
                    </>
                  ) : <span className="text-ink-subtle">–</span>}
                </td>
                <td className="px-3 py-2.5"><Badge tone={s.tone}>{s.label}</Badge></td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {due ? (
                    <span className={cn('text-xs font-medium', due.days < 0 || due.days <= 14 ? 'text-danger' : 'text-warn')}>
                      {dueLabel(due)}
                    </span>
                  ) : <span className="text-ink-subtle">–</span>}
                </td>
                <td className={cn('whitespace-nowrap px-3 py-2.5 text-xs', stale ? 'font-medium text-warn' : 'text-ink-muted')}>
                  {r.last_verified_at ? formatDistanceToNowStrict(new Date(r.last_verified_at), { addSuffix: true }) : categoryOf(r.category).kind === 'service' ? '–' : 'Never'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---- By site: what each site has, by group ------------------------------------

function BySite({
  rows,
  locations,
  onPick,
}: {
  rows: ItAssetRow[]
  locations: { id: string; name: string }[]
  onPick: (siteId: string, group: string | null) => void
}) {
  const active = rows.filter((r) => statusOf(r.status).active)
  // Every current site (an empty row is worth seeing), plus any site that only
  // shows up on records (e.g. archived since), plus no-site gear last.
  const sites: { id: string; name: string }[] = [...locations]
  for (const r of active) {
    if (r.location_id && !sites.some((s) => s.id === r.location_id)) sites.push({ id: r.location_id, name: r.location?.name ?? 'Other site' })
  }
  sites.push({ id: 'none', name: NO_SITE })

  const table = sites.map((s) => {
    const items = active.filter((r) => (s.id === 'none' ? !r.location_id : r.location_id === s.id))
    return {
      ...s,
      counts: IT_GROUPS.map((g) => items.filter((r) => categoryOf(r.category).group === g).length),
      total: items.length,
      monthly: items.reduce((a, r) => a + (r.monthly_cost ?? 0), 0),
    }
  })
  const totals = IT_GROUPS.map((_, i) => table.reduce((a, t) => a + t.counts[i], 0))

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="border-b border-border bg-content text-[11px] uppercase tracking-wide text-ink-subtle">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Site</th>
            {IT_GROUPS.map((g) => <th key={g} className="px-3 py-2 text-right font-medium">{g}</th>)}
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">Monthly</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {table.map((t) => (
            <tr key={t.id} className={t.total === 0 ? 'text-ink-subtle' : undefined}>
              <td className="px-3 py-2">
                <button type="button" onClick={() => onPick(t.id, null)}
                  className={cn('text-left font-medium hover:text-accent', t.total ? 'text-ink' : 'text-ink-muted')}>
                  {t.name}
                </button>
              </td>
              {t.counts.map((n, i) => (
                <td key={IT_GROUPS[i]} className="px-1 py-1 text-right tabular-nums">
                  {n ? (
                    <button type="button" onClick={() => onPick(t.id, IT_GROUPS[i])}
                      className="rounded-md px-2 py-1 text-ink hover:bg-accent-soft hover:text-accent">
                      {n}
                    </button>
                  ) : <span className="px-2 text-ink-subtle">·</span>}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{t.total || ''}</td>
              <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{t.monthly ? currency(t.monthly) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-content font-semibold">
          <tr>
            <td className="px-3 py-2 text-ink">All sites</td>
            {totals.map((n, i) => <td key={IT_GROUPS[i]} className="px-3 py-2 text-right tabular-nums text-ink">{n}</td>)}
            <td className="px-3 py-2 text-right tabular-nums text-ink">{active.length}</td>
            <td className="px-3 py-2 text-right tabular-nums text-ink">{currency(active.reduce((a, r) => a + (r.monthly_cost ?? 0), 0))}</td>
          </tr>
        </tfoot>
      </table>
      <p className="border-t border-border px-3 py-2 text-xs text-ink-muted">Active items only. Click a number to see those items.</p>
    </div>
  )
}

// ---- Coming due: warranties ending and renewals, soonest first --------------

function ComingDue({ rows, onOpen }: { rows: ItAssetRow[]; onOpen: (r: ItAssetRow) => void }) {
  const entries = rows
    .flatMap((r) => dueEntries(r).map((e) => ({ ...e, row: r })))
    .sort((a, b) => a.days - b.days)

  if (!entries.length) {
    return (
      <EmptyState className="mt-3" icon={CalendarClock} title={`Nothing due in the next ${DUE_WINDOW_DAYS} days`}
        description="Warranties that are about to end and services that are about to renew show up here. Add the dates on each item to track them." />
    )
  }
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
          <tr>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">What</th>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Site</th>
            <th className="px-3 py-2 text-right font-medium">Monthly</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((e) => (
            <tr key={`${e.row.id}-${e.what}`} onClick={() => onOpen(e.row)} className="cursor-pointer hover:bg-content">
              <td className="whitespace-nowrap px-3 py-2.5 text-ink">{fmtDay(e.date)}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <span className={cn('text-xs font-medium', e.days < 0 || e.days <= 14 ? 'text-danger' : 'text-warn')}>{dueLabel(e)}</span>
              </td>
              <td className="px-3 py-2.5">
                <div className="font-medium text-ink">{e.row.name}</div>
                <div className="text-xs text-ink-muted">
                  {assetTag(e.row.asset_number)} · {categoryOf(e.row.category).label}{e.row.vendor ? ` · ${e.row.vendor}` : ''}
                </div>
              </td>
              <td className="px-3 py-2.5 text-ink-muted">{e.row.location?.name ?? NO_SITE}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                {e.row.monthly_cost ? currency(e.row.monthly_cost) : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Excel export -------------------------------------------------------------

const EXPORT_COLUMNS: ExportColumn<ItAssetRow>[] = [
  { header: 'Tag', value: (r) => assetTag(r.asset_number) },
  { header: 'Name', value: (r) => r.name },
  { header: 'Category', value: (r) => categoryOf(r.category).label },
  { header: 'Group', value: (r) => categoryOf(r.category).group },
  { header: 'Status', value: (r) => statusOf(r.status).label },
  { header: 'Site', value: (r) => r.location?.name ?? NO_SITE },
  { header: 'Where at site', value: (r) => r.placement },
  { header: 'Assigned to', value: (r) => r.assigned_to },
  { header: 'Manufacturer', value: (r) => r.manufacturer },
  { header: 'Model / plan', value: (r) => r.model },
  { header: 'Serial / account #', value: (r) => r.serial_number },
  { header: 'Hostname', value: (r) => r.hostname },
  { header: 'IP address', value: (r) => r.ip_address },
  { header: 'MAC address', value: (r) => r.mac_address },
  { header: 'Operating system', value: (r) => r.operating_system },
  { header: 'Remote access ID', value: (r) => r.remote_access_id },
  { header: 'Vendor / provider', value: (r) => r.vendor },
  { header: 'Purchase / start date', value: (r) => r.purchase_date },
  { header: 'Purchase cost', value: (r) => r.purchase_cost },
  { header: 'Warranty expires', value: (r) => r.warranty_expires },
  { header: 'Monthly cost', value: (r) => r.monthly_cost },
  { header: 'Renews on', value: (r) => r.renewal_date },
  { header: 'Last checked', value: (r) => (r.last_verified_at ? format(new Date(r.last_verified_at), 'yyyy-MM-dd') : '') },
  { header: 'Notes', value: (r) => r.notes },
]
