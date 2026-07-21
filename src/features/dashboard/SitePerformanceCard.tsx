import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { StatCardRow } from '@/components/data/StatCardRow'
import { currency } from '@/lib/format'
import {
  fetchSitePerformance,
  siteNumber,
  type SitePerformanceFeed,
  type SiteDay,
  type MsaRow,
  type ChurnSite,
} from '@/lib/queries/sitePerformance'

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`)

// The dashboard names each feed's sites inconsistently, so match on site number.
function findByNumber<T>(rec: Record<string, T> | null | undefined, n: number | null): T | undefined {
  if (!rec || n == null) return undefined
  for (const [k, v] of Object.entries(rec)) if (siteNumber(k) === n) return v
  return undefined
}

// Per-site slice of the Site Performance feed, shown on that site's dashboard.
export function SitePerformanceCard({ locationName }: { locationName: string }) {
  const [feed, setFeed] = useState<SitePerformanceFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(false)
    fetchSitePerformance()
      .then((f) => { if (active) { setFeed(f); setLoading(false) } })
      .catch(() => { if (active) { setError(true); setLoading(false) } })
    return () => { active = false }
  }, [])

  const n = siteNumber(locationName)
  const days = findByNumber<SiteDay[]>(feed?.report?.sites, n)
  const day = days && days.length ? days[days.length - 1] : undefined
  const msaRow: MsaRow | undefined = feed?.msa?.rows?.find((r) => siteNumber(r.site) === n)
  const churn: ChurnSite | undefined = findByNumber(feed?.churn?.sites, n)
  const rechargeMtd = findByNumber<number>(feed?.recharge_revenue?.mtd_by_site, n)
  const hasData = !!(day || msaRow || churn)

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
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
      ) : !hasData ? (
        <p className="text-sm text-ink-muted">No live performance data for {locationName} yet.</p>
      ) : (
        <StatCardRow
          className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
          items={[
            { label: 'Cars today', value: day?.cars != null ? String(day.cars) : '—' },
            {
              label: 'Sales today',
              value:
                day?.sales != null
                  ? currency(day.sales)
                  : msaRow?.today_sales != null
                    ? currency(msaRow.today_sales)
                    : '—',
            },
            { label: 'Cars / hr', value: day?.cars_per_hour != null ? day.cars_per_hour.toFixed(1) : '—' },
            { label: 'Conversion (today)', value: pct(msaRow?.today_conversion_pct) },
            { label: 'Churn', value: pct(churn?.voluntary_churn_pct) },
            { label: 'Recharge MTD', value: rechargeMtd != null ? currency(rechargeMtd) : '—' },
          ]}
        />
      )}
    </section>
  )
}
