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
  groupByRegion,
  siteNumber,
  type MsaRow,
  type RegionIndex,
  type SiteDay,
  type SitePerformanceFeed,
} from '@/lib/queries/sitePerformance'

// The dashboard refreshes its live tabs every 60s; mirror that here.
const REFRESH_MS = 60_000
const PLAN_ORDER = ['Mighty Plan', 'Super Plan', 'Wonder Plan', 'MVP Plan']

type ViewKey =
  | 'site' | 'msa' | 'recharge_revenue' | 'recharge_audit' | 'rinsed'
  | 'under15' | 'churn' | 'records' | 'sitebreak'

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'site', label: 'By Site' },
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
    </div>
  )
}

type ViewProps = { feed: SitePerformanceFeed; idx: RegionIndex }

// ---------- By Site ----------

function BySite({ feed, idx }: ViewProps) {
  const report = feed.report
  const [metric, setMetric] = useState<'cars_per_hour' | 'labor_pct'>('cars_per_hour')
  const [days, setDays] = useState<7 | 14 | 30>(7)
  if (!report || !Object.keys(report.sites).length) return <Empty />

  const today = Object.entries(report.sites).map(([site, ds]) => ({ site, ...ds[ds.length - 1] }))
  const groups = groupByRegion(today, (r) => r.site, idx)

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
          {groups.map((g) => {
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
        title="Day by Day"
        sub="Heat-mapped trend across every site"
        actions={<div className="flex flex-wrap gap-2">
          <Seg value={metric} onChange={setMetric} tone="neutral"
            options={[{ key: 'cars_per_hour', label: 'Cars/Man-Hr' }, { key: 'labor_pct', label: 'Labor %' }]} />
          <DaysSeg value={days} onChange={setDays} />
        </div>}
      >
        <Heatmap
          report={report} idx={idx} days={days}
          value={(d) => d[metric]}
          format={(v) => (v === null ? DASH : metric === 'labor_pct' ? v + '%' : String(v))}
          color={(v) => heatFor(v, metric === 'labor_pct' ? 'labor' : 'cph')}
        />
      </Panel>
      <Footnote>
        Cars = physical washes rung up. Hours = clocked labor across every employee at the site.
        Labor % = (hours x wage rate) / sales. Region subtotals weight Cars/Man-Hr and Labor % by the region total.
      </Footnote>
    </div>
  )
}

function Heatmap({
  report, idx, days, value, format, color,
}: {
  report: NonNullable<SitePerformanceFeed['report']>
  idx: RegionIndex
  days: number
  value: (d: SiteDay) => number | null
  format: (v: number | null) => string
  color: (v: number | null) => string
}) {
  const siteNames = Object.keys(report.sites)
  const first = report.sites[siteNames[0]] ?? []
  const dates = first.slice(-days).map((d) => d.date)
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
            const ds = report.sites[site].slice(-days)
            return (
              <tr key={site}>
                <td className={td} title={site}>{siteLabel(site)}</td>
                {ds.map((d) => {
                  const v = value(d)
                  return <td key={d.date} className={td} style={{ color: color(v) }}>{format(v)}</td>
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
  if (!rr || !Object.keys(rr.sites).length) return <Empty />
  const rows = Object.entries(rr.sites).map(([site, ds]) => ({
    site, amount: ds[ds.length - 1]?.amount ?? 0, mtd: rr.mtd_by_site[site] ?? 0,
  }))
  const groups = groupByRegion(rows, (r) => r.site, idx)
  const totalToday = rr.totals[rr.totals.length - 1]

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Recharge Revenue" sub="ARM recharge $ by site, today and month-to-date">
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
            <td className={td}>{money(totalToday?.amount ?? 0)}{totalToday?.source === 'sitewatch' ? ' *' : ''}</td>
            <td className={td}>{money(rr.mtd_total)}</td>
          </tr>
        </TableShell>
      </Panel>
      <Footnote>
        Per-site amounts are SiteWatch's own RECHARGEAMOUNT, refreshed nightly. The Company Total uses the official combined SiteWatch + FlexWash number (marked * where today's is still SiteWatch-only). FlexWash #17/#18 rebilled revenue only appears in the total, not the per-site rows.
      </Footnote>
    </div>
  )
}

// ---------- Recharge Audit ----------

function RechargeAudit({ feed, idx }: ViewProps) {
  const ra = feed.recharge_audit
  if (!ra || !Object.keys(ra.sites).length) return <Empty />
  const rows = Object.entries(ra.sites).map(([site, ds]) => ({ site, ...ds[ds.length - 1] }))
  const groups = groupByRegion(rows, (r) => r.site, idx)
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Recharge Audit" sub="Did every site get an ARM recharge batch today">
        <TableShell head={<>{['Site', 'Recharges Today', 'Status'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
          {groups.map((g) => {
            const rs = [...g.items].sort((a, b) => a.count - b.count)
            const failing = rs.filter((r) => !r.passed).length
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={rs.length} right={failing ? `${failing} failing` : 'all clear'} />
                {rs.map((r) => (
                  <tr key={r.site}>
                    <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                    <td className={td}>{r.count}</td>
                    <td className={td}>
                      {r.passed
                        ? <Pill tone="ok">Pass</Pill>
                        : <Pill tone="danger">0 recharges</Pill>}
                    </td>
                  </tr>
                ))}
              </FragmentRegion>
            )
          })}
        </TableShell>
      </Panel>
      <Footnote>Same check and site set as the 7:00 AM Daily Recharge Audit email, recomputed live.</Footnote>
    </div>
  )
}

// ---------- Conversions (Rinsed) ----------

function Conversions({ feed, idx }: ViewProps) {
  const rin = feed.rinsed
  if (!rin || !Object.keys(rin.sites).length) return <Empty />
  const rows = Object.entries(rin.sites).map(([site, d]) => ({
    site, live: d.live_conversion_pct, mtd: d.avg_to_date,
  }))
  const groups = groupByRegion(rows, (r) => r.site, idx)
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Conversions" sub="Every site's conversion %, live and month-to-date">
        <TableShell head={<>{['Site', 'Live', 'MTD Conversion'].map((h) => <th key={h} className={th}>{h}</th>)}</>}>
          {groups.map((g) => {
            const rs = [...g.items].sort((a, b) => (b.mtd ?? -1) - (a.mtd ?? -1))
            return (
              <FragmentRegion key={g.region}>
                <RegionHead region={g.region} count={rs.length} />
                {rs.map((r) => (
                  <tr key={r.site}>
                    <td className={td} title={r.site}>{siteLabel(r.site)}</td>
                    <td className={td} style={{ color: heatFor(r.live, 'conv') }}>{r.live !== null && r.live !== undefined ? r.live + '%' : DASH}</td>
                    <td className={td} style={{ color: heatFor(r.mtd, 'conv') }}>{r.mtd !== null ? r.mtd + '%' : DASH}</td>
                  </tr>
                ))}
              </FragmentRegion>
            )
          })}
        </TableShell>
      </Panel>
      <Footnote>
        MTD comes from the same "Monthly sale % by site" sheet the Rinsed/FlexWash automation writes to. Live is genuinely live for the SiteWatch sites (site-wide, not roster-filtered). {rin.company_avg != null && `Company average ${rin.company_avg}%.`}
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

// ---------- small shared bits ----------

function DaysSeg({ value, onChange }: { value: 7 | 14 | 30; onChange: (v: 7 | 14 | 30) => void }) {
  return <Seg value={String(value) as '7' | '14' | '30'} tone="neutral"
    onChange={(k) => onChange(Number(k) as 7 | 14 | 30)}
    options={[{ key: '7', label: '7d' }, { key: '14', label: '14d' }, { key: '30', label: '30d' }]} />
}

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
