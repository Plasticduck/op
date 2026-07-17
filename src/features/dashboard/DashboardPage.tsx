import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Boxes, ClipboardList, DollarSign, Sparkles, Wrench } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { StatCardRow } from '@/components/data/StatCardRow'
import { WeatherOutlook } from '@/components/data/WeatherOutlook'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { insights as insightsQ, type Insight } from '@/lib/queries/insights'
import { currency, shortDate } from '@/lib/format'
import EmployeeDashboard from '@/features/dashboard/EmployeeDashboard'
import AllSitesDashboard from '@/features/dashboard/AllSitesDashboard'
import { SiteScorecard } from '@/features/dashboard/SiteScorecard'
import { CarWashFunFact } from '@/features/dashboard/CarWashFunFacts'
import { AccountBrandLogo } from '@/features/dashboard/AccountBrandLogo'
import { GoogleRatingTile } from '@/components/data/GoogleRating'
import { ratings, type SiteRating } from '@/lib/queries/ratings'
import { cn } from '@/lib/utils'

type WorkOrder = {
  id: string
  title: string
  priority: 'low' | 'medium' | 'high'
  status: string
  created_at: string
}

type Stats = {
  openWorkOrders: number
  equipmentDown: number
  lowParts: number
  completionsToday: number
}

type RecentCloseout = {
  id: string
  date: string
  total_sales: number | null
  cash_amount: number | null
  card_amount: number | null
  gsr_extracted_at: string | null
  location: { name: string } | { name: string }[] | null
}

const priorityTone = { high: 'danger', medium: 'warn', low: 'neutral' } as const

function ManagerDashboard() {
  const { profile } = useAuth()
  const { activeLocation, loading: locLoading } = useLocations()
  const [stats, setStats] = useState<Stats | null>(null)
  const [openOrders, setOpenOrders] = useState<WorkOrder[]>([])
  const [topInsights, setTopInsights] = useState<Insight[]>([])
  const [recentCloseouts, setRecentCloseouts] = useState<RecentCloseout[]>([])
  const [loading, setLoading] = useState(true)
  const [googleRating, setGoogleRating] = useState<SiteRating | null>(null)
  const [ratingLoading, setRatingLoading] = useState(true)

  const isManagerPlus = profile?.role !== 'employee'

  useEffect(() => {
    if (!isManagerPlus) return
    let active = true
    insightsQ.active().then(({ data }) => {
      if (!active) return
      const rows = (data as Insight[] | null) ?? []
      setTopInsights(
        rows.filter((i) => i.severity === 'critical' || i.severity === 'warning').slice(0, 3),
      )
    })
    return () => { active = false }
  }, [isManagerPlus])

  useEffect(() => {
    if (!isManagerPlus) return
    let active = true
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
    supabase
      .from('closeouts')
      .select('id, date, total_sales, cash_amount, card_amount, gsr_extracted_at, location:location_id(name)')
      .gte('date', since)
      .order('date', { ascending: true })
      .then(({ data }) => {
        if (!active) return
        setRecentCloseouts((data as RecentCloseout[] | null) ?? [])
      })
    return () => { active = false }
  }, [isManagerPlus])

  useEffect(() => {
    if (!activeLocation) return
    let active = true
    setLoading(true)

    const loc = activeLocation.id
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    Promise.all([
      supabase
        .from('work_orders')
        .select('id, title, priority, status, created_at')
        .eq('location_id', loc)
        .neq('status', 'closed')
        .order('created_at', { ascending: true }),
      supabase
        .from('equipment')
        .select('id, status')
        .eq('location_id', loc),
      supabase
        .from('parts_inventory')
        .select('quantity_on_hand, reorder_threshold')
        .eq('location_id', loc),
      supabase
        .from('checklist_completions')
        .select('id', { count: 'exact', head: true })
        .eq('location_id', loc)
        .gte('completed_at', todayStart.toISOString()),
    ]).then(([wo, eq, parts, comps]) => {
      if (!active) return
      const orders = (wo.data as WorkOrder[] | null) ?? []
      const equipment = (eq.data as { status: string }[] | null) ?? []
      const partRows =
        (parts.data as { quantity_on_hand: number; reorder_threshold: number }[] | null) ?? []
      setOpenOrders(orders)
      setStats({
        openWorkOrders: orders.length,
        equipmentDown: equipment.filter((e) => e.status === 'down').length,
        lowParts: partRows.filter((p) => p.quantity_on_hand <= p.reorder_threshold).length,
        completionsToday: comps.count ?? 0,
      })
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [activeLocation])

  useEffect(() => {
    if (!isManagerPlus || !activeLocation) return
    let active = true
    setRatingLoading(true)
    ratings.fetch([activeLocation.id]).then((rows) => {
      if (!active) return
      setGoogleRating(rows[0] ?? null)
      setRatingLoading(false)
    })
    return () => {
      active = false
    }
  }, [isManagerPlus, activeLocation])

  if (locLoading) return null

  if (!activeLocation) {
    return (
      <EmptyState
        icon={Boxes}
        title="No location yet"
        description="Add a location to start tracking operations."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {greeting()}, {profile?.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-ink-muted sm:text-base">
          {activeLocation.name} · {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
        <CarWashFunFact />
      </div>

      <WeatherOutlook
        latitude={activeLocation.latitude ?? null}
        longitude={activeLocation.longitude ?? null}
      />

      {isManagerPlus && (
        <SiteScorecard locationId={activeLocation.id} locationName={activeLocation.name} />
      )}

      {isManagerPlus && (
        <GoogleRatingTile
          rating={googleRating?.rating ?? null}
          count={googleRating?.count ?? null}
          syncedAt={googleRating?.synced_at ?? null}
          loading={ratingLoading}
        />
      )}

      {isManagerPlus && (
        <StatCardRow
          className="grid-cols-2"
          items={[
            { label: 'Open work orders', value: stats?.openWorkOrders ?? '—' },
            { label: 'Equipment down', value: stats?.equipmentDown ?? '—' },
            { label: 'Parts below reorder', value: stats?.lowParts ?? '—' },
            { label: 'Checklists done today', value: stats?.completionsToday ?? '—' },
          ]}
        />
      )}

      {isManagerPlus && topInsights.length > 0 && (
        <section className="rounded-md border border-border bg-card p-4">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Sparkles className="size-4 text-accent" />
              AI Insights
            </h2>
            <Link to="/app/insights" className="text-xs font-medium text-accent hover:underline">
              View all
            </Link>
          </header>
          <ul className="space-y-2">
            {topInsights.map((ins) => (
              <li key={ins.id} className="flex items-start gap-2 text-sm">
                <Badge tone={ins.severity === 'critical' ? 'danger' : 'warn'}>{ins.severity}</Badge>
                <span className="text-ink">{ins.insight_text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isManagerPlus && <RecentSales rows={recentCloseouts} />}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-4">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Wrench className="size-4 text-ink-muted" />
              Open work orders
            </h2>
            <Link to="/app/work-orders" className="text-xs font-medium text-accent hover:underline">
              View all
            </Link>
          </header>
          {loading ? (
            <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
          ) : openOrders.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No open work orders"
              description="Everything's running. New work orders show up here."
            />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {openOrders.slice(0, 6).map((wo) => (
                <li key={wo.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-ink">{wo.title}</div>
                    <div className="text-xs text-ink-muted">
                      opened {format(new Date(wo.created_at), 'MMM d')}
                    </div>
                  </div>
                  <Badge tone={priorityTone[wo.priority]}>{wo.priority}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <AlertTriangle className="size-4 text-ink-muted" />
              Attention
            </h2>
          </header>
          <ul className="space-y-2 text-sm">
            <AttentionRow
              label="Equipment currently down"
              value={stats?.equipmentDown ?? 0}
              to="/app/equipment"
              show={isManagerPlus}
            />
            <AttentionRow
              label="Parts below reorder threshold"
              value={stats?.lowParts ?? 0}
              to="/app/parts"
              show={isManagerPlus}
            />
            {!isManagerPlus && (
              <li className="text-ink-muted">
                Head to <Link to="/app/checklists" className="text-accent hover:underline">Checklists</Link> to complete today's tasks.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}

function RecentSales({ rows }: { rows: RecentCloseout[] }) {
  const totalSales = rows.reduce((acc, r) => acc + (r.total_sales ?? 0), 0)
  const totalCash = rows.reduce((acc, r) => acc + (r.cash_amount ?? 0), 0)
  const avgDaily = totalSales / 14
  const cashShare = totalSales > 0 ? Math.round((totalCash / totalSales) * 100) : 0
  const recent5 = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5)

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <DollarSign className="size-4 text-ink-muted" />
          Recent sales
        </h2>
        <Link to="/app/closeouts" className="text-xs font-medium text-accent hover:underline">
          View all
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-ink-muted">
          No closeouts in the last 14 days.{' '}
          <Link to="/app/closeouts" className="text-accent hover:underline">
            Submit one from the Closeouts page
          </Link>{' '}
          to start seeing sales here.
        </div>
      ) : (
        <>
          <StatCardRow
            className="sm:grid-cols-3 lg:grid-cols-3"
            items={[
              { label: 'Total sales (14d)', value: currency(totalSales) },
              { label: 'Average daily sales', value: currency(avgDaily) },
              { label: 'Cash share', value: `${cashShare}%` },
            ]}
          />
          <div className="rounded-md border border-border bg-card p-4">
            <ul className="divide-y divide-border text-sm">
              {recent5.map((r) => {
                const locName = Array.isArray(r.location)
                  ? r.location[0]?.name
                  : r.location?.name
                return (
                  <li key={r.id} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      <div className="text-ink">{shortDate(r.date)}</div>
                      <div className="truncate text-xs text-ink-muted">{locName ?? 'Unknown location'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.gsr_extracted_at && <Badge tone="accent">GSR</Badge>}
                      <span className="tabular text-ink">{currency(r.total_sales)}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

function AttentionRow({
  label,
  value,
  to,
  show,
}: {
  label: string
  value: number
  to: string
  show: boolean
}) {
  if (!show) return null
  return (
    <li className="flex items-center justify-between">
      <span className="text-ink-muted">{label}</span>
      {value > 0 ? (
        <Link to={to}>
          <Badge tone="warn">{value}</Badge>
        </Link>
      ) : (
        <Badge tone="ok">0</Badge>
      )}
    </li>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function ViewToggle({
  view,
  onChange,
}: {
  view: 'all' | 'site'
  onChange: (v: 'all' | 'site') => void
}) {
  const { activeLocation } = useLocations()
  const options: { key: 'all' | 'site'; label: string }[] = [
    { key: 'all', label: 'All sites' },
    { key: 'site', label: activeLocation ? activeLocation.name : 'Current site' },
  ]
  return (
    <div className="flex w-fit gap-1 rounded-lg border border-border bg-card p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition',
            view === o.key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const { locations, loading } = useLocations()
  // View is driven by the URL so a site card (?view=site) opens that site's
  // single-site dashboard, and the toggle stays shareable/back-navigable.
  const [searchParams, setSearchParams] = useSearchParams()
  const view: 'all' | 'site' = searchParams.get('view') === 'site' ? 'site' : 'all'
  const setView = (v: 'all' | 'site') =>
    setSearchParams(v === 'site' ? { view: 'site' } : {}, { replace: true })

  if (profile?.role === 'employee') return <EmployeeDashboard />
  if (loading) return null
  // Single-site accounts get the classic per-site dashboard directly.
  if (locations.length <= 1) return <ManagerDashboard />

  return (
    <div className="flex flex-col gap-6">
      <div className="relative flex items-center">
        <ViewToggle view={view} onChange={setView} />
        <div className="pointer-events-none absolute left-1/2 top-1/2 mt-6 -translate-x-1/2 -translate-y-1/2">
          <AccountBrandLogo />
        </div>
      </div>
      {view === 'all' ? <AllSitesDashboard /> : <ManagerDashboard />}
    </div>
  )
}
