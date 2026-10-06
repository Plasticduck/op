import { useEffect, useMemo, useState } from 'react'
import { Building2, Download, Search, ArrowUpDown, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { exportExcel, type ExportColumn } from '@/lib/opsExport'
import { houseAccounts, type HouseAccountsResult, type HouseAccount } from '@/lib/queries/houseAccounts'

// House Account Activity for MW19 (DRB Lube). Charge-account (fleet/commercial)
// revenue per account for a period vs. the preceding equal-length period.

type RangeKey = 'd30' | 'mtd' | 'lastmonth' | 'd90' | 'ytd' | 'lastyear'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'd30', label: 'Last 30 days' },
  { key: 'mtd', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
  { key: 'd90', label: 'Last 90 days' },
  { key: 'ytd', label: 'This year' },
  { key: 'lastyear', label: 'Last year' },
]
function rangeDates(key: RangeKey): { start: string; end: string } {
  const now = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  if (key === 'lastmonth') {
    return { start: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: iso(new Date(now.getFullYear(), now.getMonth(), 0)) }
  }
  if (key === 'lastyear') {
    return { start: iso(new Date(now.getFullYear() - 1, 0, 1)), end: iso(new Date(now.getFullYear() - 1, 11, 31)) }
  }
  const end = iso(now)
  if (key === 'mtd') return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end }
  if (key === 'ytd') return { start: iso(new Date(now.getFullYear(), 0, 1)), end }
  if (key === 'd90') return { start: iso(new Date(now.getTime() - 89 * 86400_000)), end }
  return { start: iso(new Date(now.getTime() - 29 * 86400_000)), end }
}

const usd = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = (n: number) => Math.round(n).toLocaleString()
const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function PctBadge({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct == null) return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">New</span>
  const up = pct >= 0
  // For revenue, up is good (ok/green); invert for metrics where down is good.
  const good = invert ? !up : up
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', good ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
      <Icon className="size-3" />{up ? '+' : ''}{pct}%
    </span>
  )
}

function StatCard({ label, value, pct, sub }: { label: string; value: string; pct?: number | null; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-2xl font-bold tabular text-ink">{value}</span>
        {pct !== undefined && <span className="mb-0.5"><PctBadge pct={pct} /></span>}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-muted">{sub}</div>}
    </div>
  )
}

type SortKey = 'revenue' | 'pctChange' | 'visits' | 'avgTicket' | 'name'
type Filter = 'all' | 'new' | 'lapsed' | 'declining' | 'growing'
// A table row is either a single account or a merged company group (count > 1).
type DisplayRow = HouseAccount & { count: number; members?: HouseAccount[] }
const round2 = (n: number) => Math.round(n * 100) / 100

export default function HouseAccountsPage() {
  const [range, setRange] = useState<RangeKey>('d30')
  const [data, setData] = useState<HouseAccountsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [groupSimilar, setGroupSimilar] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  useEffect(() => {
    const { start, end } = rangeDates(range)
    let alive = true
    setLoading(true); setError(null)
    houseAccounts(start, end)
      .then(({ data: d, error: err }) => {
        if (!alive) return
        if (err) throw new Error(err.message)
        if (!d || d.error) throw new Error(d?.message ?? d?.error ?? 'Failed to load.')
        setData(d)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [range])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc') }
  }

  // Individual accounts, or accounts merged into company groups (similar names).
  const baseRows = useMemo<DisplayRow[]>(() => {
    const all = data?.accounts ?? []
    if (!groupSimilar) return all.map((a) => ({ ...a, count: 1 }))
    const groups = new Map<string, HouseAccount[]>()
    for (const a of all) { const arr = groups.get(a.companyKey) ?? []; arr.push(a); groups.set(a.companyKey, arr) }
    const out: DisplayRow[] = []
    for (const [key, members] of groups) {
      if (members.length === 1) { out.push({ ...members[0], count: 1 }); continue }
      const revenue = round2(members.reduce((s, m) => s + m.revenue, 0))
      const priorRevenue = round2(members.reduce((s, m) => s + m.priorRevenue, 0))
      const visits = members.reduce((s, m) => s + m.visits, 0)
      const priorVisits = members.reduce((s, m) => s + m.priorVisits, 0)
      const sorted = [...members].sort((a, b) => b.revenue - a.revenue)
      const lastVisit = members.reduce<string | null>((mx, m) => (m.lastVisit && (!mx || m.lastVisit > mx) ? m.lastVisit : mx), null)
      out.push({
        customerId: 'grp:' + key, companyKey: key, company: sorted[0].company, name: sorted[0].company || sorted[0].name, phone: null,
        revenue, priorRevenue, visits, priorVisits,
        avgTicket: visits > 0 ? round2(revenue / visits) : 0,
        pctChange: priorRevenue > 0 ? Math.round(((revenue - priorRevenue) / priorRevenue) * 1000) / 10 : null,
        isNew: revenue > 0 && priorRevenue === 0, isLapsed: revenue === 0 && priorRevenue > 0,
        lastVisit, count: members.length, members: sorted,
      })
    }
    return out
  }, [data, groupSimilar])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = baseRows.filter((a) => {
      if (needle) {
        const hay = `${a.name} ${a.phone ?? ''} ${(a.members ?? []).map((m) => m.name).join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (filter === 'new') return a.isNew
      if (filter === 'lapsed') return a.isLapsed
      if (filter === 'declining') return a.pctChange != null && a.pctChange < 0
      if (filter === 'growing') return a.pctChange != null && a.pctChange > 0
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    r = [...r].sort((a, b) => {
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name)
      if (sortKey === 'pctChange') {
        const av = a.pctChange ?? (a.isNew ? Infinity : -Infinity)
        const bv = b.pctChange ?? (b.isNew ? Infinity : -Infinity)
        return dir * (av - bv)
      }
      return dir * ((a[sortKey] as number) - (b[sortKey] as number))
    })
    return r
  }, [baseRows, q, filter, sortKey, sortDir])

  const exportRows = () => {
    const cols: ExportColumn<DisplayRow>[] = [
      { header: 'Account', value: (a) => a.name },
      { header: 'Accounts', value: (a) => a.count },
      { header: 'Phone', value: (a) => a.phone ?? '' },
      { header: 'Visits', value: (a) => a.visits },
      { header: 'Avg ticket', value: (a) => a.avgTicket },
      { header: 'Revenue', value: (a) => a.revenue },
      { header: 'Prior revenue', value: (a) => a.priorRevenue },
      { header: '% change', value: (a) => (a.pctChange == null ? (a.isNew ? 'new' : '') : a.pctChange) },
      { header: 'Last visit', value: (a) => a.lastVisit ?? '' },
      { header: 'Status', value: (a) => (a.isNew ? 'New' : a.isLapsed ? 'Lapsed' : '') },
    ]
    void exportExcel('mw19-house-accounts', cols, rows)
  }

  const s = data?.summary
  const sortHead = (k: SortKey, label: string, right = false) => (
    <th key={k} className={cn('px-3 py-2.5 font-medium', right && 'text-right')}>
      <button type="button" onClick={() => toggleSort(k)} className={cn('inline-flex items-center gap-1 hover:text-ink', right && 'flex-row-reverse')}>
        {label}<ArrowUpDown className={cn('size-3', sortKey === k ? 'text-accent' : 'text-ink-subtle/50')} />
      </button>
    </th>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="House Accounts"
        subtitle="Charge-account (fleet & commercial) activity at MW19 — revenue per account vs. the prior period."
      />

      {/* Range */}
      <div className="flex flex-wrap items-center gap-1">
        {RANGES.map((r) => (
          <button key={r.key} type="button" onClick={() => setRange(r.key)}
            className={cn('rounded-full px-3 py-1 text-sm font-medium transition', range === r.key ? 'bg-accent text-white' : 'bg-content border border-border text-ink-muted hover:text-ink')}>
            {r.label}
          </button>
        ))}
        {data && <span className="ml-2 text-xs text-ink-subtle">{data.range.start} to {data.range.end} · vs {data.priorRange.start} to {data.priorRange.end}</span>}
      </div>

      {error && <div className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}

      {loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-content" />
      ) : s && data ? (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Revenue" value={usd(s.totalRevenue)} pct={s.revenuePctChange} sub={`prior ${usd(s.priorTotalRevenue)}`} />
            <StatCard label="Active accounts" value={int(s.activeAccounts)} sub={`prior ${int(s.priorActiveAccounts)}`} />
            <StatCard label="Visits" value={int(s.totalVisits)} sub={`prior ${int(s.priorTotalVisits)}`} />
            <StatCard label="Avg ticket" value={usd2(s.avgTicket)} />
            <StatCard label="New accounts" value={int(s.newAccounts)} sub="no charges prior period" />
            <StatCard label="Lapsed" value={int(s.lapsedAccounts)} sub="active prior, none now" />
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account or phone…" className="pl-9" />
            </div>
            <div className="flex flex-wrap gap-1">
              {([['all', 'All'], ['growing', 'Growing'], ['declining', 'Declining'], ['new', 'New'], ['lapsed', 'Lapsed']] as [Filter, string][]).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)}
                  className={cn('rounded-full px-3 py-1 text-sm font-medium transition', filter === key ? 'bg-accent text-white' : 'bg-content border border-border text-ink-muted hover:text-ink')}>
                  {label}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={groupSimilar} onChange={(e) => setGroupSimilar(e.target.checked)} className="accent-accent" />
              Group similar names
            </label>
            <Button variant="secondary" size="sm" onClick={exportRows} disabled={!rows.length}><Download className="size-4" /> Excel</Button>
          </div>

          <p className="-mt-2 text-xs text-ink-subtle">
            {int(rows.length)} {groupSimilar ? 'group' : 'account'}{rows.length === 1 ? '' : 's'} shown{groupSimilar ? ` · ${int(data.accounts.length)} accounts merged by company name` : ''}.{data.truncated ? ' Showing the top 1,000 by revenue for this range.' : ''} Revenue = House Acct Charge billed at MW19.
          </p>

          {/* Table */}
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  {sortHead('name', 'Account')}
                  {sortHead('visits', 'Visits', true)}
                  {sortHead('avgTicket', 'Avg ticket', true)}
                  <th className="px-3 py-2.5 text-right font-medium">Prior</th>
                  {sortHead('revenue', 'Revenue', true)}
                  {sortHead('pctChange', 'Change', true)}
                  <th className="px-3 py-2.5 font-medium">Last visit</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-ink-muted">No accounts match.</td></tr>
                ) : rows.flatMap((a) => {
                  const grouped = a.count > 1
                  const open = grouped && expanded.has(a.customerId)
                  const main = (
                    <tr key={a.customerId} className={cn('border-t border-border hover:bg-content', grouped && 'cursor-pointer')} onClick={grouped ? () => toggleExpand(a.customerId) : undefined}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {grouped && <ChevronDown className={cn('size-3.5 shrink-0 text-ink-muted transition', open && 'rotate-180')} />}
                          <span className="font-medium text-ink">{a.name}</span>
                          {grouped && <span className="rounded-full bg-content px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">{a.count} accounts</span>}
                          {a.isNew && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">New</span>}
                          {a.isLapsed && <span className="rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">Lapsed</span>}
                        </div>
                        {!grouped && a.phone && <div className="text-xs text-ink-muted">{a.phone}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular text-ink-muted">{int(a.visits)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-ink-muted">{a.avgTicket ? usd2(a.avgTicket) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular text-ink-subtle">{a.priorRevenue ? usd(a.priorRevenue) : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular text-ink">{usd(a.revenue)}</td>
                      <td className="px-3 py-2.5 text-right"><PctBadge pct={a.pctChange} /></td>
                      <td className="px-3 py-2.5 text-ink-muted">{fmtDate(a.lastVisit)}</td>
                    </tr>
                  )
                  if (!open || !a.members) return [main]
                  const subs = a.members.map((m) => (
                    <tr key={a.customerId + ':' + m.customerId} className="border-t border-border/50 bg-content/40">
                      <td className="px-3 py-1.5 pl-9">
                        <span className="text-ink-muted">{m.name}</span>
                        {m.phone && <span className="ml-2 text-xs text-ink-subtle">{m.phone}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular text-ink-subtle">{int(m.visits)}</td>
                      <td className="px-3 py-1.5 text-right tabular text-ink-subtle">{m.avgTicket ? usd2(m.avgTicket) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular text-ink-subtle">{m.priorRevenue ? usd(m.priorRevenue) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular text-ink">{usd(m.revenue)}</td>
                      <td className="px-3 py-1.5 text-right"><PctBadge pct={m.pctChange} /></td>
                      <td className="px-3 py-1.5 text-ink-subtle">{fmtDate(m.lastVisit)}</td>
                    </tr>
                  ))
                  return [main, ...subs]
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <Building2 className="size-8 text-ink-subtle" />
          <p className="text-sm text-ink-muted">No house-account activity for this range.</p>
        </div>
      )}
    </div>
  )
}
