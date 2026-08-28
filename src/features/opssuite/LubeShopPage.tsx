import { useEffect, useMemo, useState } from 'react'
import { Wrench, Receipt, DollarSign, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { fetchLubeStats, type LubeStats } from '@/lib/queries/lube'

// Lube Shop dashboard: live DRB statistics for store 019 (the quick-lube),
// separate from car-wash reporting. Owner/manager only (route-gated).

type RangeKey = 'mtd' | 'd30' | 'd90' | 'ytd'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'mtd', label: 'This month' },
  { key: 'd30', label: 'Last 30 days' },
  { key: 'd90', label: 'Last 90 days' },
  { key: 'ytd', label: 'Year to date' },
]

function rangeDates(key: RangeKey): { start: string; end: string } {
  const now = new Date()
  const end = now.toISOString().slice(0, 10)
  let start: Date
  if (key === 'mtd') start = new Date(now.getFullYear(), now.getMonth(), 1)
  else if (key === 'ytd') start = new Date(now.getFullYear(), 0, 1)
  else start = new Date(now.getTime() - (key === 'd30' ? 30 : 90) * 86400_000)
  return { start: start.toISOString().slice(0, 10), end }
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const money2 = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function LubeShopPage() {
  const [range, setRange] = useState<RangeKey>('mtd')
  const [data, setData] = useState<LubeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const { start, end } = rangeDates(range)
    let alive = true
    setLoading(true)
    setError(null)
    fetchLubeStats(start, end)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [range])

  const avgTicket = useMemo(() => {
    if (!data || !data.totals.tickets) return 0
    return data.totals.net_sales / data.totals.tickets
  }, [data])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lube Shop"
        subtitle="Live DRB statistics for the quick-lube (store 019). Kept separate from car-wash sales."
      />

      {/* Range selector */}
      <div className="flex flex-wrap gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium transition',
              range === r.key ? 'bg-accent text-white' : 'bg-card border border-border text-ink-muted hover:text-ink',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={DollarSign} label="Net sales" value={data ? money(data.totals.net_sales) : '—'} loading={loading} />
        <Kpi icon={Receipt} label="Tickets" value={data ? data.totals.tickets.toLocaleString() : '—'} loading={loading} />
        <Kpi icon={TrendingUp} label="Avg ticket" value={data ? money2(avgTicket) : '—'} loading={loading} />
        <Kpi icon={Wrench} label="Sales tax" value={data ? money(data.totals.tax) : '—'} loading={loading} />
      </div>

      {/* Daily trend */}
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Daily net sales</h2>
        {loading ? (
          <div className="h-48 animate-pulse rounded bg-content" />
        ) : data && data.days.length ? (
          <TrendChart days={data.days} />
        ) : (
          <div className="py-10 text-center text-sm text-ink-muted">No data in this range.</div>
        )}
      </section>

      {/* Category breakdown */}
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Sales by category</h2>
        {loading ? (
          <div className="h-48 animate-pulse rounded bg-content" />
        ) : data && data.categories.length ? (
          <CategoryBars categories={data.categories} />
        ) : (
          <div className="py-10 text-center text-sm text-ink-muted">No data in this range.</div>
        )}
      </section>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, loading }: { icon: typeof DollarSign; label: string; value: string; loading: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
        <Icon className="size-4 text-ink-subtle" /> {label}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tabular text-ink', loading && 'opacity-40')}>{value}</div>
    </div>
  )
}

function TrendChart({ days }: { days: { date: string; net_sales: number }[] }) {
  const W = 900
  const H = 180
  const pad = { t: 8, r: 8, b: 20, l: 8 }
  const max = Math.max(1, ...days.map((d) => d.net_sales))
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const x = (i: number) => pad.l + (days.length <= 1 ? 0 : (i / (days.length - 1)) * iw)
  const y = (v: number) => pad.t + ih - (v / max) * ih
  const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.net_sales).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(days.length - 1).toFixed(1)} ${(pad.t + ih).toFixed(1)} L ${x(0).toFixed(1)} ${(pad.t + ih).toFixed(1)} Z`
  const fmtDay = (s: string) => { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full min-w-[560px]" preserveAspectRatio="none">
        <path d={area} className="fill-accent/10" />
        <path d={line} className="fill-none stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {days.map((d, i) => (
          <circle key={d.date} cx={x(i)} cy={y(d.net_sales)} r={2} className="fill-accent">
            <title>{`${fmtDay(d.date)}: ${money2(d.net_sales)}`}</title>
          </circle>
        ))}
        <text x={pad.l} y={H - 6} className="fill-ink-subtle text-[10px]">{days.length ? fmtDay(days[0].date) : ''}</text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-ink-subtle text-[10px]">{days.length ? fmtDay(days[days.length - 1].date) : ''}</text>
      </svg>
    </div>
  )
}

function CategoryBars({ categories }: { categories: { name: string; dollars: number; items: number }[] }) {
  const top = categories.slice(0, 14)
  const max = Math.max(1, ...top.map((c) => c.dollars))
  return (
    <div className="flex flex-col gap-2">
      {top.map((c) => (
        <div key={c.name} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-xs text-ink" title={c.name}>{c.name}</div>
          <div className="h-4 flex-1 overflow-hidden rounded bg-content">
            <div className="h-full rounded bg-accent" style={{ width: `${Math.max(2, (c.dollars / max) * 100)}%` }} />
          </div>
          <div className="w-24 shrink-0 text-right text-xs tabular font-medium text-ink">{money(c.dollars)}</div>
        </div>
      ))}
    </div>
  )
}
