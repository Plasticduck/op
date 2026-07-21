import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { compareLocationName } from '@/lib/utils'
import { currency } from '@/lib/format'
import { siteMetrics, siteNumber } from '@/lib/queries/sitePerformance'
import { useSitePerformanceFeed } from '@/lib/useSitePerformanceFeed'

type Loc = { id: string; name: string }

const avg = (vals: (number | null)[]) => {
  const nums = vals.filter((v): v is number => v != null)
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)
const dec = (v: number | null) => (v == null ? '—' : v.toFixed(1))
const whole = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString())
const money = (v: number | null) => (v == null ? '—' : currency(v))

// Per-site Site Performance for a single region, with a region-average footer.
export function SitePerformanceSites({ locations }: { locations: Loc[] }) {
  const { feed, loading, error } = useSitePerformanceFeed(true)

  const rows = useMemo(() => {
    if (!feed) return []
    return [...locations]
      .sort((a, b) => compareLocationName(a.name, b.name))
      .map((l) => ({ id: l.id, name: l.name, m: siteMetrics(feed, siteNumber(l.name)) }))
  }, [feed, locations])
  const withData = rows.filter((r) => r.m.cars != null || r.m.conversion != null || r.m.churn != null)

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Activity className="size-4 text-ink-muted" />
          Site Performance
        </h2>
        <Link to="/app/site-performance" className="text-xs font-medium text-accent hover:underline">
          View all
        </Link>
      </header>
      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-ink-muted">Live performance data is unavailable right now.</p>
      ) : withData.length === 0 ? (
        <p className="text-sm text-ink-muted">No live performance data for this region yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 text-right font-medium">Cars</th>
                <th className="px-3 py-2.5 text-right font-medium">Sales</th>
                <th className="px-3 py-2.5 text-right font-medium">Cars/hr</th>
                <th className="px-3 py-2.5 text-right font-medium">Conversion</th>
                <th className="px-3 py-2.5 text-right font-medium">Churn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{r.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{whole(r.m.cars)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{money(r.m.sales)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{dec(r.m.carsPerHour)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{pct(r.m.conversion)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{pct(r.m.churn)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-content font-semibold">
                <td className="px-3 py-2.5 text-ink">Region average</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">{whole(avg(rows.map((r) => r.m.cars)))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">{money(avg(rows.map((r) => r.m.sales)))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">{dec(avg(rows.map((r) => r.m.carsPerHour)))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">{pct(avg(rows.map((r) => r.m.conversion)))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">{pct(avg(rows.map((r) => r.m.churn)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-subtle">Cars, sales, and conversion are today; churn is period to date.</p>
    </section>
  )
}
