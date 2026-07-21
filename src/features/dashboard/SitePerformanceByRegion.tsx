import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { useCompany } from '@/lib/company'
import { groupByRegions, resolveRegions } from '@/lib/regions'
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

// Per-region averages of the live Site Performance metrics, for the all-sites view.
export function SitePerformanceByRegion({ locations }: { locations: Loc[] }) {
  const { settings } = useCompany()
  const { feed, loading, error } = useSitePerformanceFeed(true)

  const rows = useMemo(() => {
    if (!feed) return []
    return groupByRegions(locations, resolveRegions(settings.regions))
      .map((g) => {
        const metrics = g.locations.map((l) => siteMetrics(feed, siteNumber(l.name)))
        const withData = metrics.filter((m) => m.cars != null || m.conversion != null || m.churn != null)
        return {
          region: g.region,
          sites: withData.length,
          avgCars: avg(metrics.map((m) => m.cars)),
          avgSales: avg(metrics.map((m) => m.sales)),
          avgCph: avg(metrics.map((m) => m.carsPerHour)),
          avgConv: avg(metrics.map((m) => m.conversion)),
          avgChurn: avg(metrics.map((m) => m.churn)),
        }
      })
      .filter((r) => r.sites > 0)
  }, [feed, locations, settings.regions])

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Activity className="size-4 text-ink-muted" />
          Site Performance by region
        </h2>
        <Link to="/app/site-performance" className="text-xs font-medium text-accent hover:underline">
          View all
        </Link>
      </header>
      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-ink-muted">Live performance data is unavailable right now.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No live performance data yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Region</th>
                <th className="px-3 py-2.5 text-right font-medium">Sites</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg Cars</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg Sales</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg Cars/hr</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg Conversion</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg Churn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.region} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{r.region}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{r.sites}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{whole(r.avgCars)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{money(r.avgSales)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{dec(r.avgCph)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{pct(r.avgConv)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{pct(r.avgChurn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-subtle">Averages across each region's sites. Cars, sales, and conversion are today; churn is period to date.</p>
    </section>
  )
}
