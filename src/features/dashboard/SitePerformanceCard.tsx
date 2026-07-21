import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { StatCardRow } from '@/components/data/StatCardRow'
import { currency } from '@/lib/format'
import { fetchSitePerformance, siteMetrics, siteNumber, type SitePerformanceFeed } from '@/lib/queries/sitePerformance'

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`)

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

  const m = siteMetrics(feed, siteNumber(locationName))
  const hasData = m.cars != null || m.sales != null || m.conversion != null || m.churn != null

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
            { label: 'Cars today', value: m.cars != null ? String(m.cars) : '—' },
            { label: 'Sales today', value: m.sales != null ? currency(m.sales) : '—' },
            { label: 'Cars / hr', value: m.carsPerHour != null ? m.carsPerHour.toFixed(1) : '—' },
            { label: 'Conversion (today)', value: pct(m.conversion) },
            { label: 'Churn', value: pct(m.churn) },
            { label: 'Recharge MTD', value: m.rechargeMtd != null ? currency(m.rechargeMtd) : '—' },
          ]}
        />
      )}
    </section>
  )
}
