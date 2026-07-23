import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { useCompany } from '@/lib/company'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import {
  buildRegionIndex,
  fetchSitePerformance,
  fetchSitePerformanceHistory,
  fetchSitePerformanceHistoryBounds,
  groupByRegion,
  siteNumber,
  type MsaRow,
  type RegionIndex,
  type SiteDay,
  type SitePerfDayRow,
  type SitePerformanceFeed,
} from '@/lib/queries/sitePerformance'

// The dashboard refreshes its live tabs every 60s; mirror that here.
const REFRESH_MS = 60_000
const PLAN_ORDER = ['Mighty Plan', 'Super Plan', 'Wonder Plan', 'MVP Plan']

type ViewKey =
  | 'site' | 'history' | 'msa' | 'recharge_revenue' | 'recharge_audit' | 'rinsed'
  | 'under15' | 'churn' | 'records' | 'sitebreak'

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'site', label: 'By Site' },
  { key: 'history', label: 'History' },
  { key: 'msa', label: 'By MSA' },
  { key: 'recharge_revenue', label: 'Recharge $' },
  { key: 'recharge_audit', label: 'Recharge Audit' },
  { key: 'rinsed', label: 'Conversions' },
  { key: 'under15', label: 'Under 15%' },
  { key: 'churn', label: 'Churn' },
  { key: 'records', label: 'Company Records' },
  { key: 'sitebreak', label: 'Site Breakdown' },
]

const FRESHNESS: Record<ViewKey, string> = {
  site: 'Live, updates every 60s',
  history: 'Archived daily; covers every day since the archive began',
  msa: 'Live, updates every 60s',
  recharge_revenue: 'Updated nightly, not continuously live',
  recharge_audit: 'Live, updates every 60s',
  rinsed: 'As of the last automated Rinsed/FlexWash pull',
  under15: 'As of the last automated Rinsed/FlexWash pull',
  churn: 'Last month, refreshed nightly',
  records: 'Live: today/this month can hold a provisional record until it is over',
  sitebreak: 'Freshness varies by row, see each metric',
}

// ---------- formatting + heat ----------

const money = (v: number, dp = 0) =>
  '$' + v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp })
const DASH = '—'

// Data heat scale (not a UI token): red = worse, green = better, tuned to read
// on the app's light card surface. `t` runs 0 (worst) to 1 (best).
function heat(t: number | null): string {
  if (t === null) return 'inherit'
  const c = Math.max(0, Math.min(1, t))
  const hue = 4 + c * 136 // 4deg red -> 140deg green
  return `hsl(${hue}, 68%, 40%)`
}
const RANGES = {
  cph: { lo: 1, hi: 8, invert: false },
  labor: { lo: 8, hi: 25, invert: true },
  conv: { lo: 15, hi: 25, invert: false },
  churn: { lo: 3, hi: 9, invert: true },
}
function heatFor(v: number | null | undefined, key: keyof typeof RANGES): string {
  if (v === null || v === undefined) return 'inherit'
  const { lo, hi, invert } = RANGES[key]
  let t = (v - lo) / (hi - lo)
  if (invert) t = 1 - t
  return heat(t)
}

// Short, recognizable site label from any feed's naming ("MightyWash 001",
// "Mighty Wash #24" -> "#1", "#24").
function siteLabel(name: string): string {
  const n = siteNumber(name)
  return n !== null ? `#${n}` : name
}

// ---------- shared chrome ----------

function Panel({
  title, sub, actions, children,
}: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Seg<T extends string>({
  value, options, onChange, tone = 'accent',
}: {
  value: T
  options: { key: T; label: string }[]
  onChange: (k: T) => void
  tone?: 'accent' | 'neutral'
}) {
  return (
    <div className="inline-flex gap-1 rounded-lg border border-border bg-content p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition',
            value === o.key
              ? tone === 'accent'
                ? 'bg-accent text-white'
                : 'bg-ink text-white'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Footnote({ children }: { children: ReactNode }) {
  return <p className="px-1 pt-1 text-xs leading-relaxed text-ink-subtle">{children}</p>
}

function RegionHead({ region, count, right }: { region: string; count: number; right?: ReactNode }) {
  return (
    <tr className="bg-content/70">
      <td colSpan={99} className="px-4 py-1.5 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-ink">{region}</span>
          <span className="text-[11px] text-ink-subtle">{count} sites</span>
          {right && <span className="ml-auto text-xs text-ink-muted">{right}</span>}
        </div>
      </td>
    </tr>
  )
}

const th = 'px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle first:text-left sm:px-4'
const td = 'px-3 py-2 text-right text-sm text-ink first:text-left sm:px-4 tabular-nums'

function TableShell({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-border">{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  )
}

// ---------- page ----------

export default function SitePerformancePage() {
  const { settings } = useCompany()
  const { locations } = useLocations()
  const [feed, setFeed] = useState<SitePerformanceFeed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [view, setView] = useState<ViewKey>('site')

  const regionIndex = useMemo(
    () => buildRegionIndex(locations, settings.regions),
    [locations, settings.regions],
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await fetchSitePerformance()
        if (!active) return
        setFeed(data)
        setError(null)
        setUpdatedAt(new Date().toLocaleTimeString())
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Site Performance"
        subtitle="Live Mighty Wash operations, grouped by region."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-ink-muted">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {error ? 'Update failed' : updatedAt ? `Updated ${updatedAt}` : 'Connecting...'}
          </span>
        }
      />

      <div className="overflow-x-auto">
        <div className="w-max">
          <Seg value={view} options={VIEWS} onChange={setView} />
        </div>
      </div>
      <p className="-mt-2 text-xs text-ink-subtle">{FRESHNESS[view]}</p>

      {/* History reads the archive, not the live feed, so it renders on its own. */}
      {view === 'history' ? (
        <History idx={regionIndex} />
      ) : (
        <>
          {error && !feed && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Could not load performance data.</p>
                <p className="mt-0.5 text-danger/80">{error}</p>
              </div>
            </div>
          )}

          {!feed && !error && (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
              Warming up. First load can take ~20s.
            </p>
          )}

          {feed && (
            <>
              {view === 'site' && <BySite feed={feed} idx={regionIndex} />}
              {view === 'msa' && <ByMsa feed={feed} idx={regionIndex} />}
              {view === 'recharge_revenue' && <RechargeRevenue feed={feed} idx={regionIndex} />}
              {view === 'recharge_audit' && <RechargeAudit feed={feed} idx={regionIndex} />}
              {view === 'rinsed' && <Conversions feed={feed} idx={regionIndex} />}
              {view === 'under15' && <Under15 feed={feed} idx={regionIndex} />}
              {view === 'churn' && <Churn feed={feed} idx={regionIndex} />}
              {view === 'records' && <CompanyRecords feed={feed} />}
              {view === 'sitebreak' && <SiteBreakdown feed={feed} idx={regionIndex} />}
            </>
          )}
        </>
      )}
    </div>
  )
}

type ViewProps = { feed: SitePerformanceFeed; idx: RegionIndex }

// ---------- By Site ----------

// Date-range presets over the report feed's ~30-day daily window. Computed
// relative to the latest date the feed carries (its "today").
const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7', label: 'Last 7' },
  { key: '14', label: 'Last 14' },
  { key: '30', label: 'Last 30' },
  { key: 'month', label: 'This month' },
] as const

function presetRange(key: string, allDates: string[]): [string, string] {
  const max = allDates[allDates.length - 1] ?? ''
  const min = allDates[0] ?? ''
  if (!max) return ['', '']
  if (key === 'today') return [max, max]
  if (key === 'yesterday') { const y = allDates[allDates.length - 2] ?? max; return [y, y] }
  if (key === 'month') { const start = max.slice(0, 8) + '01'; return [start < min ? min : start, max] }
  const n = parseInt(key, 10)
  if (!Number.isNaN(n)) return [allDates[Math.max(0, allDates.length - n)] ?? min, max]
  return [min, max]
}

const dateInputCls = 'rounded-md border border-border bg-content px-2 py-1 text-xs text-ink'

type Range = { key: string; start: string; end: string }

function resolveRange(range: Range, allDates: string[]): [string, string] {
  const [defStart, defEnd] = presetRange(range.key === 'custom' ? '30' : range.key, allDates)
  return [range.start || defStart, range.end || defEnd]
}

// Reusable preset + custom date-range control over a feed's ~30-day daily window.
function RangeActions({
  range, setRange, allDates,
}: { range: Range; setRange: (r: Range) => void; allDates: string[] }) {
  const [start, end] = resolveRange(range, allDates)
  const minDate = allDates[0]
  const maxDate = allDates[allDates.length - 1]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Seg
        value={range.key}
        tone="neutral"
        options={RANGE_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
        onChange={(k) => { const [s, e] = presetRange(k, allDates); setRange({ key: k, start: s, end: e }) }}
      />
      <input
        type="date"
        min={minDate}
        max={maxDate}
        value={start}
        onChange={(e) => setRange({ key: 'custom', start: e.target.value, end: end < e.target.value ? e.target.value : end })}
        className={dateInputCls}
      />
      <span className="text-xs text-ink-muted">to</span>
      <input
        type="date"
        min={minDate}
        max={maxDate}
        value={end}
        onChange={(e) => setRange({ key: 'custom', start: start > e.target.value ? e.target.value : start, end: e.target.value })}
        className={dateInputCls}
      />
    </div>
  )
}

function BySite({ feed, idx }: ViewProps) {
  const report = feed.report
  const [metric, setMetric] = useState<'cars_per_hour' | 'labor_pct'>('cars_per_hour')
  const allDates = useMemo(
    () => (report ? Array.from(new Set(Object.values(report.sites).flatMap((ds) => ds.map((d) => d.date)))).sort() : []),
    [report],
  )
  const [range, setRange] = useState<{ key: string; start: string; end: string }>({ key: '7', start: '', end: '' })
  if (!report || !Object.keys(report.sites).length) return <Empty />

  const [defStart, defEnd] = presetRange('7', allDates)
  const start = range.start || defStart
  const end = range.end || defEnd
  const dates = allDates.filter((d) => d >= start && d <= end)
  const inRange = (d: SiteDay) => d.date >= start && d.date <= end
  const rangeLabel = start === end ? start : `${start} to ${end}`
  const minDate = allDates[0]
  const maxDate = allDates[allDates.length - 1]

  const today = Object.entries(report.sites).map(([site, ds]) => ({ site, ...ds[ds.length - 1] }))
  const todayGroups = groupByRegion(today, (r) => r.site, idx)

  // Per-site totals/averages over the selected range.
  const rangeRows = Object.entries(report.sites).map(([site, ds]) => {
    const d = ds.filter(inRange)
    const cars = sum(d, (x) => x.cars)
    const hours = sum(d, (x) => x.hours)
    const sales = sum(d, (x) => x.sales)
    const labor = sum(d, (x) => x.labor_cost)
    return {
      site,
      cars,
      hours,
      sales,
      labor,
      cph: hours > 0 ? round(cars / hours, 2) : null,
      laborPct: sales > 0 ? round((labor / sales) * 100, 1) : null,
    }
  })
  const rangeGroups = groupByRegion(rangeRows, (r) => r.site, idx)

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Today" sub="Every site, ranked by cars per man-hour so far today">
        <TableShell
          head={<>
            {['Site', 'Cars', 'Hours', 'Cars/Man-Hr', 'Sales', 'Labor %'].map((h) => (
              <th key={h} className={th}>{h}</th>
            ))}
          </>}
        >
          {todayGroups.map((g) => {
            const rows = [...g.items].sort((a, b) => (b.cars_per_hour ?? -1) - (a.cars_per_hour ?? -1))
            const cars = sum(rows, (r) => r.cars)
            const hours = sum(rows, (r) => r.hours)
            const sales = sum(rows, (r) => r.sales)
            const labor = sum(rows, (r) => r.labor_cost)
            const cph = hours > 0 ? round(cars / hours, 2) : null
            const laborPct = sales > 0 ? round((labor / sales) * 100, 1) : null
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={rows.length} />
                {rows.map((r) => (
                  <tr key={r.site}>
                    <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                    <td className={td}>{r.cars}</td>
                    <td className={td}>{r.hours}</td>
                    <td className={td} style={{ color: heatFor(r.cars_per_hour, 'cph') }}>{r.cars_per_hour ?? DASH}</td>
                    <td className={td}>{money(r.sales)}</td>
                    <td className={td} style={{ color: heatFor(r.labor_pct, 'labor') }}>{r.labor_pct !== null ? r.labor_pct + '%' : DASH}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-ink">
                  <td className={td}>Subtotal</td>
                  <td className={td}>{cars}</td>
                  <td className={td}>{round(hours, 1)}</td>
                  <td className={td} style={{ color: heatFor(cph, 'cph') }}>{cph ?? DASH}</td>
                  <td className={td}>{money(sales)}</td>
                  <td className={td} style={{ color: heatFor(laborPct, 'labor') }}>{laborPct !== null ? laborPct + '%' : DASH}</td>
                </tr>
              </FragmentRegion>
            )
          })}
        </TableShell>
      </Panel>

      <Panel
        title="Selected Range"
        sub={`Totals and averages per site for ${rangeLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              value={range.key}
              tone="neutral"
              options={RANGE_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
              onChange={(k) => { const [s, e] = presetRange(k, allDates); setRange({ key: k, start: s, end: e }) }}
            />
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={start}
              onChange={(e) => setRange({ key: 'custom', start: e.target.value, end: end < e.target.value ? e.target.value : end })}
              className={dateInputCls}
            />
            <span className="text-xs text-ink-muted">to</span>
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={end}
              onChange={(e) => setRange({ key: 'custom', start: start > e.target.value ? e.target.value : start, end: e.target.value })}
              className={dateInputCls}
            />
          </div>
        }
      >
        <TableShell
          head={<>
            {['Site', 'Cars', 'Hours', 'Cars/Man-Hr', 'Sales', 'Labor %'].map((h) => (
              <th key={h} className={th}>{h}</th>
            ))}
          </>}
        >
          {rangeGroups.map((g) => {
            const rows = [...g.items].sort((a, b) => (b.cph ?? -1) - (a.cph ?? -1))
            const cars = sum(rows, (r) => r.cars)
            const hours = sum(rows, (r) => r.hours)
            const sales = sum(rows, (r) => r.sales)
            const labor = sum(rows, (r) => r.labor)
            const cph = hours > 0 ? round(cars / hours, 2) : null
            const laborPct = sales > 0 ? round((labor / sales) * 100, 1) : null
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={rows.length} />
                {rows.map((r) => (
                  <tr key={r.site}>
                    <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                    <td className={td}>{r.cars}</td>
                    <td className={td}>{round(r.hours, 1)}</td>
                    <td className={td} style={{ color: heatFor(r.cph, 'cph') }}>{r.cph ?? DASH}</td>
                    <td className={td}>{money(r.sales)}</td>
                    <td className={td} style={{ color: heatFor(r.laborPct, 'labor') }}>{r.laborPct !== null ? r.laborPct + '%' : DASH}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-ink">
                  <td className={td}>Subtotal</td>
                  <td className={td}>{cars}</td>
                  <td className={td}>{round(hours, 1)}</td>
                  <td className={td} style={{ color: heatFor(cph, 'cph') }}>{cph ?? DASH}</td>
                  <td className={td}>{money(sales)}</td>
                  <td className={td} style={{ color: heatFor(laborPct, 'labor') }}>{laborPct !== null ? laborPct + '%' : DASH}</td>
                </tr>
              </FragmentRegion>
            )
          })}
        </TableShell>
      </Panel>

      <Panel
        title="Day by Day"
        sub="Heat-mapped trend across every site for the selected range"
        actions={
          <Seg value={metric} onChange={setMetric} tone="neutral"
            options={[{ key: 'cars_per_hour', label: 'Cars/Man-Hr' }, { key: 'labor_pct', label: 'Labor %' }]} />
        }
      >
        <Heatmap
          report={report} idx={idx} dates={dates}
          value={(d) => d[metric]}
          format={(v) => (v === null ? DASH : metric === 'labor_pct' ? v + '%' : String(v))}
          color={(v) => heatFor(v, metric === 'labor_pct' ? 'labor' : 'cph')}
        />
      </Panel>
      <Footnote>
        Cars = physical washes rung up. Hours = clocked labor across every employee at the site.
        Labor % = (hours x wage rate) / sales. Region subtotals weight Cars/Man-Hr and Labor % by the region total.
        Ranges cover the ~30 days the feed carries; older history is not available.
      </Footnote>
    </div>
  )
}

function Heatmap({
  report, idx, dates, value, format, color,
}: {
  report: NonNullable<SitePerformanceFeed['report']>
  idx: RegionIndex
  dates: string[]
  value: (d: SiteDay) => number | null
  format: (v: number | null) => string
  color: (v: number | null) => string
}) {
  const siteNames = Object.keys(report.sites)
  const groups = groupByRegion(siteNames.map((s) => ({ site: s })), (r) => r.site, idx)
  return (
    <TableShell
      head={<>
        <th className={th}>Site</th>
        {dates.map((d) => <th key={d} className={th}>{d.slice(5)}</th>)}
      </>}
    >
      {groups.map((g) => (
        <FragmentRegion key={g.region}>
          <RegionHead region={g.region} count={g.items.length} />
          {g.items.map(({ site }) => {
            const byDate = new Map(report.sites[site].map((d) => [d.date, d]))
            return (
              <tr key={site}>
                <td className={td} title={site}>{siteLabel(site)}</td>
                {dates.map((date) => {
                  const d = byDate.get(date)
                  const v = d ? value(d) : null
                  return <td key={date} className={td} style={{ color: color(v) }}>{d ? format(v) : DASH}</td>
                })}
              </tr>
            )
          })}
        </FragmentRegion>
      ))}
    </TableShell>
  )
}

// ---------- By MSA ----------

function ByMsa({ feed, idx }: ViewProps) {
  const msa = feed.msa
  const flags = feed.high_conversion_flags?.flags ?? []
  const [period, setPeriod] = useState<'today' | 'mtd'>('today')
  if (!msa || !msa.rows.length) return <Empty />

  const convKey = period === 'today' ? 'today_conversion_pct' : 'mtd_conversion_pct'
  const washKey = period === 'today' ? 'today_eligible_washes' : 'mtd_eligible_washes'
  const salesKey = period === 'today' ? 'today_sales' : 'mtd_sales'
  const groups = groupByRegion(msa.rows, (r) => r.site, idx)

  return (
    <div className="flex flex-col gap-4">
      {flags.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3">
          <p className="text-sm font-semibold text-warn">
            {flags.length} conversion{flags.length > 1 ? 's' : ''} today look too high to be real. Check punch records.
          </p>
          {flags.map((f) => (
            <p key={f.msa + f.site} className="mt-1 text-xs text-ink-muted">
              <span className="font-semibold text-ink">{f.msa}</span> · {siteLabel(f.site)} · {f.sales} sales / {f.denominator} eligible = {f.conversion_display}. {f.likely_cause}
            </p>
          ))}
        </div>
      )}
      <Panel
        title="MSA Conversions"
        sub="Every salesperson on the current roster, ranked by conversion %"
        actions={<Seg value={period} onChange={setPeriod} tone="neutral"
          options={[{ key: 'today', label: 'Today' }, { key: 'mtd', label: 'MTD' }]} />}
      >
        <TableShell
          head={<>
            {['MSA', 'Site', 'Conversion', 'Eligible Washes', 'Sales'].map((h) => <th key={h} className={th}>{h}</th>)}
          </>}
        >
          {groups.map((g) => {
            const rows = [...g.items].sort((a, b) => ((b[convKey] as number | null) ?? -1) - ((a[convKey] as number | null) ?? -1))
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={new Set(rows.map((r) => r.site)).size} />
                {rows.map((r) => (
                  <tr key={r.msa + r.site}>
                    <td className={td}>{r.msa}</td>
                    <td className={td}>{siteLabel(r.site)}</td>
                    <td className={td} style={{ color: heatFor(r[convKey] as number | null, 'conv') }}>
                      {r[convKey] !== null ? r[convKey] + '%' : DASH}
                    </td>
                    <td className={td}>{r[washKey]}</td>
                    <td className={td}>{r[salesKey]}</td>
                  </tr>
                ))}
              </FragmentRegion>
            )
          })}
        </TableShell>
      </Panel>
      <Footnote>
        Conversion % and eligible washes use the same formula as the Google Sheets MSA dashboard, filtered to the current Sales Roster. Today = live so far today; MTD = month to date.
      </Footnote>
    </div>
  )
}

// ---------- Recharge Revenue ----------

function RechargeRevenue({ feed, idx }: ViewProps) {
  const rr = feed.recharge_revenue
  const allDates = useMemo(
    () => (rr ? Array.from(new Set(Object.values(rr.sites).flatMap((ds) => ds.map((d) => d.date)))).sort() : []),
    [rr],
  )
  const [range, setRange] = useState<Range>({ key: '7', start: '', end: '' })
  if (!rr || !Object.keys(rr.sites).length) return <Empty />
  const [start, end] = resolveRange(range, allDates)
  const rangeLabel = start === end ? start : `${start} to ${end}`
  const inRange = (d: { date: string }) => d.date >= start && d.date <= end

  const rows = Object.entries(rr.sites).map(([site, ds]) => ({
    site, amount: sum(ds.filter(inRange), (d) => d.amount), mtd: rr.mtd_by_site[site] ?? 0,
  }))
  const groups = groupByRegion(rows, (r) => r.site, idx)
  const totalRange = sum((rr.totals ?? []).filter(inRange), (t) => t.amount)

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Recharge Revenue"
        sub={`ARM recharge $ by site for ${rangeLabel}, plus month-to-date`}
        actions={<RangeActions range={range} setRange={setRange} allDates={allDates} />}
      >
        <TableShell head={<>{['Site', 'Recharge $', 'MTD $'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
          {groups.map((g) => {
            const rs = [...g.items].sort((a, b) => b.amount - a.amount)
            const amt = sum(rs, (r) => r.amount)
            const mtd = sum(rs, (r) => r.mtd)
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={rs.length} right={money(amt)} />
                {rs.map((r) => (
                  <tr key={r.site}>
                    <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                    <td className={td}>{money(r.amount)}</td>
                    <td className={td}>{money(r.mtd)}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-ink">
                  <td className={td}>Subtotal</td>
                  <td className={td}>{money(amt)}</td>
                  <td className={td}>{money(mtd)}</td>
                </tr>
              </FragmentRegion>
            )
          })}
          <tr className="border-t-2 border-border font-bold text-ink">
            <td className={td}>Company Total</td>
            <td className={td}>{money(totalRange)}</td>
            <td className={td}>{money(rr.mtd_total)}</td>
          </tr>
        </TableShell>
      </Panel>
      <Footnote>
        Per-site amounts are SiteWatch's own RECHARGEAMOUNT, summed over the selected range (the feed carries ~30 days). MTD is the official month-to-date figure. FlexWash #17/#18 rebilled revenue only appears in the company total, not the per-site rows.
      </Footnote>
    </div>
  )
}

// ---------- Recharge Audit ----------

function RechargeAudit({ feed, idx }: ViewProps) {
  const ra = feed.recharge_audit
  const allDates = useMemo(
    () => (ra ? Array.from(new Set(Object.values(ra.sites).flatMap((ds) => ds.map((d) => d.date)))).sort() : []),
    [ra],
  )
  const [range, setRange] = useState<Range>({ key: '7', start: '', end: '' })
  if (!ra || !Object.keys(ra.sites).length) return <Empty />
  const [start, end] = resolveRange(range, allDates)
  const rangeLabel = start === end ? start : `${start} to ${end}`
  const inRange = (d: { date: string }) => d.date >= start && d.date <= end

  const rows = Object.entries(ra.sites).map(([site, ds]) => {
    const d = ds.filter(inRange)
    return { site, count: sum(d, (x) => x.count), passed: d.filter((x) => x.passed).length, days: d.length }
  })
  const groups = groupByRegion(rows, (r) => r.site, idx)
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Recharge Audit"
        sub={`Did every site get an ARM recharge batch, for ${rangeLabel}`}
        actions={<RangeActions range={range} setRange={setRange} allDates={allDates} />}
      >
        <TableShell head={<>{['Site', 'Recharges', 'Days Passed'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
          {groups.map((g) => {
            const rs = [...g.items].sort((a, b) => (a.passed / (a.days || 1)) - (b.passed / (b.days || 1)))
            const missing = rs.filter((r) => r.passed < r.days).length
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={rs.length} right={missing ? `${missing} with misses` : 'all clear'} />
                {rs.map((r) => (
                  <tr key={r.site}>
                    <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                    <td className={td}>{r.count}</td>
                    <td className={td}>
                      {r.days === 0
                        ? DASH
                        : r.passed === r.days
                          ? <Pill tone="ok">{r.passed}/{r.days}</Pill>
                          : <Pill tone="danger">{r.passed}/{r.days}</Pill>}
                    </td>
                  </tr>
                ))}
              </FragmentRegion>
            )
          })}
        </TableShell>
      </Panel>
      <Footnote>Same check and site set as the 7:00 AM Daily Recharge Audit email. Recharges = ARM batches counted across the range; Days Passed = days the site got at least one.</Footnote>
    </div>
  )
}

// ---------- Conversions (Rinsed) ----------

function Conversions({ feed, idx }: ViewProps) {
  const rin = feed.rinsed
  const allDates = useMemo(
    () => (rin ? Array.from(new Set(Object.values(rin.sites).flatMap((s) => (s.days ?? []).map((d) => d.date)))).sort() : []),
    [rin],
  )
  const [range, setRange] = useState<Range>({ key: '7', start: '', end: '' })
  if (!rin || !Object.keys(rin.sites).length) return <Empty />
  const [start, end] = resolveRange(range, allDates)
  const rangeLabel = start === end ? start : `${start} to ${end}`

  const rows = Object.entries(rin.sites).map(([site, d]) => {
    const days = (d.days ?? []).filter((x) => x.date >= start && x.date <= end && x.conversion_pct != null)
    const avg = days.length ? round(days.reduce((a, x) => a + (x.conversion_pct as number), 0) / days.length, 1) : null
    return { site, live: d.live_conversion_pct, avg }
  })
  const groups = groupByRegion(rows, (r) => r.site, idx)
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Conversions"
        sub={`Every site's conversion %, live and averaged over ${rangeLabel}`}
        actions={<RangeActions range={range} setRange={setRange} allDates={allDates} />}
      >
        <TableShell head={<>{['Site', 'Live', 'Range Avg'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
          {groups.map((g) => {
            const rs = [...g.items].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={rs.length} />
                {rs.map((r) => (
                  <tr key={r.site}>
                    <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                    <td className={td} style={{ color: heatFor(r.live, 'conv') }}>{r.live !== null && r.live !== undefined ? r.live + '%' : DASH}</td>
                    <td className={td} style={{ color: heatFor(r.avg, 'conv') }}>{r.avg !== null ? r.avg + '%' : DASH}</td>
                  </tr>
                ))}
              </FragmentRegion>
            )
          })}
        </TableShell>
      </Panel>
      <Footnote>
        Live is genuinely live for the SiteWatch sites (site-wide, not roster-filtered). Range Avg is the mean of each day's conversion % over the selected range (the feed carries ~30 days). {rin.company_avg != null && `Company MTD average ${rin.company_avg}%.`}
      </Footnote>
    </div>
  )
}

// ---------- Under 15% ----------

function Under15({ feed, idx }: ViewProps) {
  const u = feed.under15
  if (!u) return <Empty />
  const groups = groupByRegion(u.sites, (r) => r.site, idx)
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Sites Under 15%"
        sub={`Sites below the ${u.threshold}% MTD conversion threshold${u.company_avg != null ? ` · company avg ${u.company_avg}%` : ''}`}
      >
        {u.sites.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-muted">Every site is clear of the threshold right now.</p>
        ) : (
          <TableShell head={<>{['Site', 'MTD Conversion', 'Top Rep', 'Lowest Rep'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
            {groups.map((g) => (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={g.items.length} />
                {g.items.map((s) => (
                  <tr key={s.site}>
                    <td className={td} title={s.site}>{siteLabel(s.site)}</td>
                    <td className={td} style={{ color: heatFor(s.avg_to_date, 'conv') }}>{s.avg_to_date}%</td>
                    <td className={td}>{s.top_rep ? `${s.top_rep.name} (${s.top_rep.conversion_pct}%)` : DASH}</td>
                    <td className={td}>{s.low_rep ? `${s.low_rep.name} (${s.low_rep.conversion_pct}%)` : DASH}</td>
                  </tr>
                ))}
              </FragmentRegion>
            ))}
          </TableShell>
        )}
      </Panel>
      <Footnote>Same threshold, source, and top/lowest-rep logic as the Friday "Sites under 15% conversion" email, recomputed daily. Rep figures are month-to-date through yesterday.</Footnote>
    </div>
  )
}

// ---------- Churn ----------

function Churn({ feed, idx }: ViewProps) {
  const c = feed.churn
  if (!c || !Object.keys(c.sites).length) return <Empty />
  const rows = Object.entries(c.sites).map(([site, s]) => ({ site, ...s }))
  const groups = groupByRegion(rows, (r) => r.site, idx)
  const total = (v: { voluntary_churn_pct: number | null; cc_churn_pct: number | null }) =>
    v.voluntary_churn_pct != null && v.cc_churn_pct != null
      ? round(v.voluntary_churn_pct + v.cc_churn_pct, 1) : null
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Churn" sub="Voluntary vs. credit-card churn %, last full month">
        <TableShell head={<>{['Site', 'Voluntary Churn %', 'CC Churn %', 'Total Churn %'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
          {groups.map((g) => {
            const rs = [...g.items].sort((a, b) => siteNumber(a.site)! - siteNumber(b.site)!)
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={rs.length} />
                {rs.map((r) => {
                  const t = total(r)
                  return (
                    <tr key={r.site}>
                      <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                      <td className={td} style={{ color: heatFor(r.voluntary_churn_pct, 'churn') }}>{r.voluntary_churn_pct != null ? r.voluntary_churn_pct + '%' : DASH}</td>
                      <td className={td} style={{ color: heatFor(r.cc_churn_pct, 'churn') }}>{r.cc_churn_pct != null ? r.cc_churn_pct + '%' : DASH}</td>
                      <td className={td}>{t != null ? t + '%' : DASH}</td>
                    </tr>
                  )
                })}
              </FragmentRegion>
            )
          })}
        </TableShell>
      </Panel>
      <Footnote>Sourced from Rinsed's "Subscriber Churn by Type Last Month" report. This is a trailing full-calendar-month figure, not Today/MTD.</Footnote>
    </div>
  )
}

// ---------- Company Records (no region grouping — company-wide) ----------

function CompanyRecords({ feed }: { feed: SitePerformanceFeed }) {
  const rec = feed.company_records
  if (!rec || !Object.keys(rec.records).length) return <Empty />
  const r = rec.records
  const rowsFor = (period: 'day' | 'month') => [
    period === 'month' && ['Revenue', r.revenue?.[period], money(r.revenue?.[period]?.value ?? 0, 2)],
    ['Cars', r.cars?.[period], (r.cars?.[period]?.value ?? 0).toLocaleString()],
    ['Best Site Conversion %', r.best_site_conversion_pct?.[period], (r.best_site_conversion_pct?.[period]?.value ?? 0) + '%'],
    ['Plans Sold', r.plans_sold?.[period], (r.plans_sold?.[period]?.value ?? 0).toLocaleString()],
    ['MSA Conversion %', r.msa_conversion_pct?.[period], (r.msa_conversion_pct?.[period]?.value ?? 0) + '%'],
  ].filter(Boolean) as [string, { value: number; date?: string; month?: string; site?: string; msa?: string; still_counting?: boolean } | undefined, string][]

  const Card = ({ title, period }: { title: string; period: 'day' | 'month' }) => (
    <Panel title={title} sub={period === 'day' ? 'All-time best single day, company-wide' : 'All-time best calendar month, company-wide'}>
      <TableShell head={<>{['Metric', 'Value', period === 'day' ? 'Date' : 'Month', 'Detail'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
        {rowsFor(period).map(([label, entry, valueStr]) => (
          <tr key={label}>
            <td className={td}>{label}</td>
            <td className={td}>{entry ? valueStr : DASH}</td>
            <td className={td}>
              {entry ? (period === 'day' ? entry.date : entry.month) : DASH}
              {entry?.still_counting && <span className="ml-1"><Pill tone="accent">still counting</Pill></span>}
            </td>
            <td className={td}>{entry?.site ? (entry.msa ? `${entry.msa} at ${siteLabel(entry.site)}` : siteLabel(entry.site)) : DASH}</td>
          </tr>
        ))}
      </TableShell>
    </Panel>
  )
  return (
    <div className="flex flex-col gap-5">
      <Card title="Day Records" period="day" />
      <Card title="Month Records" period="month" />
      <Footnote>Backfilled to 2023-01-01. Conversion records require a minimum volume (100 cars/day or 2,000/month) so a slow day can't post a meaningless high percentage.</Footnote>
    </div>
  )
}

// ---------- Site Breakdown ----------

function SiteBreakdown({ feed, idx }: ViewProps) {
  const report = feed.report
  const siteNames = useMemo(() => Object.keys(report?.sites ?? {}).sort((a, b) => (siteNumber(a) ?? 0) - (siteNumber(b) ?? 0)), [report])
  const [site, setSite] = useState('')
  const active = site || siteNames[0] || ''
  if (!report || !siteNames.length) return <Empty />

  const num = siteNumber(active)
  const days = report.sites[active] ?? []
  const today = days[days.length - 1]
  const monthStart = report.end_date.slice(0, 8) + '01'
  const monthDays = days.filter((d) => d.date >= monthStart)
  const mtdCars = sum(monthDays, (d) => d.cars)
  const mtdHours = sum(monthDays, (d) => d.hours)
  const mtdSales = sum(monthDays, (d) => d.sales)
  const mtdLabor = sum(monthDays, (d) => d.labor_cost)
  const untrusted = monthDays.some((d) => d.hours >= 0.5 && d.cars_per_hour === null)
  const mtdCph = !untrusted && mtdHours >= 0.5 ? round(mtdCars / mtdHours, 2) : null
  const mtdLaborPct = mtdSales > 0 && mtdHours >= 0.5 ? round((mtdLabor / mtdSales) * 100, 1) : null

  const rrDays = feed.recharge_revenue?.sites[active]
  const rrToday = rrDays?.[rrDays.length - 1]
  const rrMtd = feed.recharge_revenue?.mtd_by_site[active]
  const raDays = feed.recharge_audit?.sites[active]
  const raToday = raDays?.[raDays.length - 1]
  const raMonth = raDays?.filter((d) => d.date >= monthStart) ?? []
  const rinKey = feed.rinsed ? Object.keys(feed.rinsed.sites).find((n) => siteNumber(n) === num) : undefined
  const rin = rinKey ? feed.rinsed!.sites[rinKey] : undefined
  const churn = feed.churn?.sites[active]

  const rows: [string, ReactNode, ReactNode][] = [
    ['Cars', today?.cars ?? DASH, round(mtdCars, 0)],
    ['Hours', today?.hours ?? DASH, round(mtdHours, 1)],
    ['Cars/Man-Hr', today?.cars_per_hour ?? DASH, mtdCph ?? DASH],
    ['Sales', money(today?.sales ?? 0), money(mtdSales)],
    ['Labor %', today?.labor_pct != null ? today.labor_pct + '%' : DASH, mtdLaborPct != null ? mtdLaborPct + '%' : DASH],
    ['Recharge $', rrToday ? money(rrToday.amount) : DASH, rrMtd !== undefined ? money(rrMtd) : DASH],
    ['Recharge Audit',
      raToday ? (raToday.passed ? <Pill tone="ok">Pass ({raToday.count})</Pill> : <Pill tone="danger">0 recharges</Pill>) : DASH,
      raMonth.length ? `${raMonth.filter((d) => d.passed).length}/${raMonth.length} days` : DASH],
    ['Conversion', rin?.live_conversion_pct != null ? rin.live_conversion_pct + '%' : DASH, rin?.avg_to_date != null ? rin.avg_to_date + '%' : DASH],
    ['Voluntary Churn % (last month)', DASH, churn?.voluntary_churn_pct != null ? churn.voluntary_churn_pct + '%' : DASH],
    ['CC Churn % (last month)', DASH, churn?.cc_churn_pct != null ? churn.cc_churn_pct + '%' : DASH],
  ]

  const salespeople = (feed.msa?.rows ?? []).filter((r) => siteNumber(r.site) === num)
    .sort((a, b) => (b.mtd_conversion_pct ?? -1) - (a.mtd_conversion_pct ?? -1))
  const plan = feed.plan_breakdown?.sites[active]

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Site Breakdown"
        sub={`${idx.regionForNumber(num)} · every metric this dashboard tracks, for one site`}
        actions={
          <Select value={active} onChange={(e) => setSite(e.target.value)} className="h-9 w-44">
            {siteNames.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        }
      >
        <TableShell head={<>{['Metric', 'Today / Live', 'MTD'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
          {rows.map(([label, t, m]) => (
            <tr key={label}>
              <td className={td}>{label}</td>
              <td className={td}>{t}</td>
              <td className={td}>{m}</td>
            </tr>
          ))}
        </TableShell>
      </Panel>

      <Panel title="Salespeople at This Site" sub="Same live per-employee numbers as By MSA, filtered to this site">
        {salespeople.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-muted">No salespeople on the current roster at this site.</p>
        ) : (
          <TableShell head={<>{['MSA', 'Today Conv', 'Today Washes', 'Today Sales', 'MTD Conv', 'MTD Washes', 'MTD Sales'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
            {salespeople.map((r: MsaRow) => (
              <tr key={r.msa}>
                <td className={td}>{r.msa}</td>
                <td className={td} style={{ color: heatFor(r.today_conversion_pct, 'conv') }}>{r.today_conversion_pct != null ? r.today_conversion_pct + '%' : DASH}</td>
                <td className={td}>{r.today_eligible_washes}</td>
                <td className={td}>{r.today_sales}</td>
                <td className={td} style={{ color: heatFor(r.mtd_conversion_pct, 'conv') }}>{r.mtd_conversion_pct != null ? r.mtd_conversion_pct + '%' : DASH}</td>
                <td className={td}>{r.mtd_eligible_washes}</td>
                <td className={td}>{r.mtd_sales}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>

      <Panel title="Plan Types Sold" sub="Mighty / Super / Wonder / MVP sale counts at this site">
        {!plan ? (
          <p className="px-5 pb-5 text-sm text-ink-muted">No commission data at this site (e.g. #17/#18).</p>
        ) : (
          <TableShell head={<>{['Plan', 'Today', 'MTD'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
            {PLAN_ORDER.map((p) => (
              <tr key={p}>
                <td className={td}>{p}</td>
                <td className={td}>{plan.today[p] ?? 0}</td>
                <td className={td}>{plan.mtd[p] ?? 0}</td>
              </tr>
            ))}
            <tr className="font-semibold text-ink">
              <td className={td}>Total</td>
              <td className={td}>{sum(PLAN_ORDER, (p) => plan.today[p] ?? 0)}</td>
              <td className={td}>{sum(PLAN_ORDER, (p) => plan.mtd[p] ?? 0)}</td>
            </tr>
          </TableShell>
        )}
      </Panel>
    </div>
  )
}

// ---------- History (from the site_performance_days archive) ----------

const HIST_PRESETS = [
  { key: 'last30', label: 'Last 30' },
  { key: 'last90', label: 'Last 90' },
  { key: 'thismonth', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
  { key: 'thisquarter', label: 'This quarter' },
  { key: 'lastquarter', label: 'Last quarter' },
  { key: 'thisyear', label: 'This year' },
  { key: 'lastyear', label: 'Last year' },
] as const

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function histPreset(key: string): [string, string] {
  const now = new Date()
  const today = ymd(now)
  const y = now.getFullYear()
  const m = now.getMonth()
  const startOfMonth = (yy: number, mm: number) => ymd(new Date(yy, mm, 1))
  const endOfMonth = (yy: number, mm: number) => ymd(new Date(yy, mm + 1, 0))
  const back = (n: number) => { const s = new Date(now); s.setDate(s.getDate() - n); return ymd(s) }
  switch (key) {
    case 'last30': return [back(29), today]
    case 'last90': return [back(89), today]
    case 'thismonth': return [startOfMonth(y, m), today]
    case 'lastmonth': {
      const pm = m === 0 ? 11 : m - 1
      const py = m === 0 ? y - 1 : y
      return [startOfMonth(py, pm), endOfMonth(py, pm)]
    }
    case 'thisquarter': return [startOfMonth(y, Math.floor(m / 3) * 3), today]
    case 'lastquarter': {
      let q = Math.floor(m / 3) * 3 - 3
      let qy = y
      if (q < 0) { q += 12; qy -= 1 }
      return [startOfMonth(qy, q), endOfMonth(qy, q + 2)]
    }
    case 'thisyear': return [`${y}-01-01`, today]
    case 'lastyear': return [`${y - 1}-01-01`, `${y - 1}-12-31`]
    default: return [back(29), today]
  }
}

function History({ idx }: { idx: RegionIndex }) {
  const [rangeKey, setRangeKey] = useState('last30')
  const [start, setStart] = useState(() => histPreset('last30')[0])
  const [end, setEnd] = useState(() => histPreset('last30')[1])
  const [rows, setRows] = useState<SitePerfDayRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bounds, setBounds] = useState<{ min: string | null; max: string | null }>({ min: null, max: null })

  useEffect(() => {
    void fetchSitePerformanceHistoryBounds().then(setBounds).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fetchSitePerformanceHistory(start, end)
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [start, end])

  const applyPreset = (k: string) => {
    const [s, e] = histPreset(k)
    setRangeKey(k)
    setStart(s)
    setEnd(e)
  }

  const bySite = useMemo(() => {
    const map = new Map<string, { site: string; cars: number; hours: number; sales: number; labor: number; recharge: number }>()
    for (const r of rows ?? []) {
      const cur = map.get(r.site) ?? { site: r.site, cars: 0, hours: 0, sales: 0, labor: 0, recharge: 0 }
      cur.cars += Number(r.cars) || 0
      cur.hours += Number(r.hours) || 0
      cur.sales += Number(r.sales) || 0
      cur.labor += Number(r.labor_cost) || 0
      cur.recharge += Number(r.recharge) || 0
      map.set(r.site, cur)
    }
    return Array.from(map.values()).map((s) => ({
      ...s,
      cph: s.hours > 0 ? round(s.cars / s.hours, 2) : null,
      laborPct: s.sales > 0 ? round((s.labor / s.sales) * 100, 1) : null,
    }))
  }, [rows])

  const groups = groupByRegion(bySite, (r) => r.site, idx)
  const tot = bySite.reduce(
    (a, s) => ({ cars: a.cars + s.cars, hours: a.hours + s.hours, sales: a.sales + s.sales, recharge: a.recharge + s.recharge }),
    { cars: 0, hours: 0, sales: 0, recharge: 0 },
  )
  const rangeLabel = start === end ? start : `${start} to ${end}`

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="History"
        sub={`Per-site totals for ${rangeLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              value={rangeKey}
              tone="neutral"
              options={HIST_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
              onChange={applyPreset}
            />
            <input
              type="date"
              value={start}
              max={end}
              onChange={(e) => { setRangeKey('custom'); setStart(e.target.value) }}
              className={dateInputCls}
            />
            <span className="text-xs text-ink-muted">to</span>
            <input
              type="date"
              value={end}
              min={start}
              onChange={(e) => { setRangeKey('custom'); setEnd(e.target.value) }}
              className={dateInputCls}
            />
          </div>
        }
      >
        {loading ? (
          <p className="px-5 pb-5 text-sm text-ink-muted">Loading…</p>
        ) : error ? (
          <p className="px-5 pb-5 text-sm text-danger">{error}</p>
        ) : bySite.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-muted">No archived data in this range.</p>
        ) : (
          <TableShell
            head={<>
              {['Site', 'Cars', 'Hours', 'Cars/Man-Hr', 'Sales', 'Labor %', 'Recharge $'].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </>}
          >
            {groups.map((g) => {
              const rs = [...g.items].sort((a, b) => (b.cph ?? -1) - (a.cph ?? -1))
              const cars = sum(rs, (r) => r.cars)
              const hours = sum(rs, (r) => r.hours)
              const sales = sum(rs, (r) => r.sales)
              const labor = sum(rs, (r) => r.labor)
              const recharge = sum(rs, (r) => r.recharge)
              const cph = hours > 0 ? round(cars / hours, 2) : null
              const laborPct = sales > 0 ? round((labor / sales) * 100, 1) : null
              return (
                <FragmentRegion key={g.region}>
                  <RegionHead region={g.region} count={rs.length} />
                  {rs.map((r) => (
                    <tr key={r.site}>
                      <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                      <td className={td}>{round(r.cars, 0)}</td>
                      <td className={td}>{round(r.hours, 1)}</td>
                      <td className={td} style={{ color: heatFor(r.cph, 'cph') }}>{r.cph ?? DASH}</td>
                      <td className={td}>{money(r.sales)}</td>
                      <td className={td} style={{ color: heatFor(r.laborPct, 'labor') }}>{r.laborPct !== null ? r.laborPct + '%' : DASH}</td>
                      <td className={td}>{money(r.recharge)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-ink">
                    <td className={td}>Subtotal</td>
                    <td className={td}>{round(cars, 0)}</td>
                    <td className={td}>{round(hours, 1)}</td>
                    <td className={td} style={{ color: heatFor(cph, 'cph') }}>{cph ?? DASH}</td>
                    <td className={td}>{money(sales)}</td>
                    <td className={td} style={{ color: heatFor(laborPct, 'labor') }}>{laborPct !== null ? laborPct + '%' : DASH}</td>
                    <td className={td}>{money(recharge)}</td>
                  </tr>
                </FragmentRegion>
              )
            })}
            <tr className="border-t-2 border-border font-bold text-ink">
              <td className={td}>Company Total</td>
              <td className={td}>{round(tot.cars, 0)}</td>
              <td className={td}>{round(tot.hours, 1)}</td>
              <td className={td}>{tot.hours > 0 ? round(tot.cars / tot.hours, 2) : DASH}</td>
              <td className={td}>{money(tot.sales)}</td>
              <td className={td}>{DASH}</td>
              <td className={td}>{money(tot.recharge)}</td>
            </tr>
          </TableShell>
        )}
      </Panel>
      <Footnote>
        History is archived daily from the live dashboard.
        {bounds.min ? ` Available from ${bounds.min} to ${bounds.max}.` : ' Building up as of today.'}
        {' '}Dates before the archive began are not available. Totals sum each day in the range;
        Cars/Man-Hr and Labor % are computed on the range totals.
      </Footnote>
    </div>
  )
}

// ---------- small shared bits ----------

function Pill({ tone, children }: { tone: 'ok' | 'danger' | 'accent'; children: ReactNode }) {
  const cls = tone === 'ok' ? 'bg-ok-soft text-ok' : tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-semibold', cls)}>{children}</span>
}

function FragmentRegion({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function Empty() {
  return <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">No data for this view yet.</p>
}

function sum<T>(items: T[], pick: (t: T) => number): number {
  return items.reduce((a, t) => a + pick(t), 0)
}
function round(v: number, dp: number): number {
  const f = Math.pow(10, dp)
  return Math.round(v * f) / f
}
