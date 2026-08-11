import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, X, Building2, Layers, Dot } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { usePresentationMode } from '@/lib/presentation'
import { useLocations } from '@/lib/locations'
import { useCompany } from '@/lib/company'
import { useSitePerformanceFeed } from '@/lib/useSitePerformanceFeed'
import { siteMetrics, siteNumber, type SiteMetrics, type SitePerformanceFeed } from '@/lib/queries/sitePerformance'
import { groupByRegions, resolveRegions, shortRegionLabel } from '@/lib/regions'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'

type LocationRow = ReturnType<typeof useLocations>['locations'][number]
type Selection =
  | { kind: 'all' }
  | { kind: 'region'; name: string }
  | { kind: 'site'; id: string }

// ---- formatters (null-safe, big-and-legible) ----
const num = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'))
const money = (n: number | null | undefined) => (n == null ? '—' : currency(n))
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`)
const oneDp = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1))

// Sum a metric across sites (nulls ignored); null when none reported.
function agg(ms: SiteMetrics[], key: keyof SiteMetrics, mode: 'sum' | 'avg'): number | null {
  const vals = ms.map((m) => m[key]).filter((v): v is number => v != null)
  if (!vals.length) return null
  const total = vals.reduce((a, b) => a + b, 0)
  return mode === 'sum' ? total : total / vals.length
}

function combine(feed: SitePerformanceFeed | null, locs: LocationRow[]): SiteMetrics {
  const ms = locs.map((l) => siteMetrics(feed, siteNumber(l.name)))
  return {
    cars: agg(ms, 'cars', 'sum'),
    sales: agg(ms, 'sales', 'sum'),
    rechargeMtd: agg(ms, 'rechargeMtd', 'sum'),
    carsPerHour: agg(ms, 'carsPerHour', 'avg'),
    conversion: agg(ms, 'conversion', 'avg'),
    churn: agg(ms, 'churn', 'avg'),
    laborPct: agg(ms, 'laborPct', 'avg'),
  }
}

export default function PresentationMode() {
  const { active, exit } = usePresentationMode()
  const { locations, activeLocation } = useLocations()
  const { settings } = useCompany()
  const { feed, loading, error } = useSitePerformanceFeed(active)

  // Region groups when the account has regions configured; otherwise sites are
  // offered flat (no redundant "Other" bucket).
  const groups = useMemo(() => {
    const regs = resolveRegions(settings.regions)
    return regs.length ? groupByRegions(locations, regs) : []
  }, [locations, settings.regions])

  const [sel, setSel] = useState<Selection>({ kind: 'all' })
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState('')

  // Open on the currently active site (if any) the first time we enter.
  useEffect(() => {
    if (active) setSel(activeLocation ? { kind: 'site', id: activeLocation.id } : { kind: 'all' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Exit on Esc or Tab, per the spec (plus the on-screen button).
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); exit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, exit])

  // Close the picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  // Light "updated" clock, refreshed as the feed re-fetches.
  useEffect(() => {
    if (!active) return
    setNow(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  }, [active, feed])

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  // Resolve the current selection into a title, subtitle, and metric set.
  const view = useMemo(() => {
    if (sel.kind === 'site') {
      const loc = byId.get(sel.id)
      if (loc) return { title: loc.name, subtitle: 'Single site', metrics: siteMetrics(feed, siteNumber(loc.name)), count: 1 }
    }
    if (sel.kind === 'region') {
      const g = groups.find((x) => x.region === sel.name)
      const locs = g?.locations ?? []
      return { title: sel.name, subtitle: `${locs.length} ${locs.length === 1 ? 'site' : 'sites'}`, metrics: combine(feed, locs), count: locs.length }
    }
    return { title: 'All Sites', subtitle: `${locations.length} ${locations.length === 1 ? 'site' : 'sites'}`, metrics: combine(feed, locations), count: locations.length }
  }, [sel, byId, groups, feed, locations])

  if (!active) return null

  const m = view.metrics
  const isRoll = view.count !== 1
  // Metric tiles. For a roll-up, cars/sales/recharge are totals and cars-per-hour/
  // conversion/churn are averages across the sites.
  const tiles: { label: string; value: string; glow: string }[] = [
    { label: isRoll ? 'Cars today (total)' : 'Cars today', value: num(m.cars), glow: 'from-sky-400/30' },
    { label: isRoll ? 'Sales today (total)' : 'Sales today', value: money(m.sales), glow: 'from-emerald-400/30' },
    { label: isRoll ? 'Recharge MTD (total)' : 'Recharge MTD', value: money(m.rechargeMtd), glow: 'from-violet-400/30' },
    { label: isRoll ? 'Conversion (avg)' : 'Conversion', value: pct(m.conversion), glow: 'from-amber-400/30' },
    { label: isRoll ? 'Churn (avg)' : 'Churn', value: pct(m.churn), glow: 'from-rose-400/30' },
    { label: isRoll ? 'Cars / hr (avg)' : 'Cars / hr', value: oneDp(m.carsPerHour), glow: 'from-cyan-400/30' },
  ]

  const pickBtn = (label: string, onClick: () => void, activeSel: boolean, icon?: ReactNode) => (
    <button
      type="button"
      onClick={() => { onClick(); setPickerOpen(false) }}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[15px] transition',
        activeSel ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-[#0a0f1a] text-white">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(37,99,235,0.25),transparent)]" />

      {/* top bar */}
      <div className="relative z-10 flex items-center justify-between gap-4 px-6 py-5 sm:px-10 sm:py-6">
        <Logo invert size="lg" className="w-40 sm:w-52" />
        <div className="flex items-center gap-3">
          {/* site / region picker */}
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
            >
              <span className="max-w-[40vw] truncate">{view.title}</span>
              <ChevronDown className="size-4 shrink-0 opacity-70" />
            </button>
            {pickerOpen && (
              <div className="absolute right-0 z-20 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1424] p-1.5 shadow-2xl">
                {pickBtn('All Sites', () => setSel({ kind: 'all' }), sel.kind === 'all', <Building2 className="size-4 shrink-0 opacity-70" />)}
                {groups.length === 0 && locations.map((l) => pickBtn(l.name, () => setSel({ kind: 'site', id: l.id }), sel.kind === 'site' && sel.id === l.id, <Dot className="size-4 shrink-0 opacity-70" />))}
                {groups.map((g) => (
                  <div key={g.region} className="mt-1">
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">{shortRegionLabel(g.region)}</div>
                    {pickBtn(`Entire ${shortRegionLabel(g.region)}`, () => setSel({ kind: 'region', name: g.region }), sel.kind === 'region' && sel.name === g.region, <Layers className="size-4 shrink-0 opacity-70" />)}
                    {g.locations.map((l) => pickBtn(l.name, () => setSel({ kind: 'site', id: l.id }), sel.kind === 'site' && sel.id === l.id, <Dot className="size-4 shrink-0 opacity-70" />))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={exit}
            title="Exit presentation (Esc)"
            aria-label="Exit presentation"
            className="rounded-xl border border-white/15 bg-white/5 p-2.5 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* headline */}
      <div className="relative z-10 px-6 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{view.title}</h1>
            <p className="mt-1 text-base text-white/50 sm:text-lg">{view.subtitle}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/50">
            <span className="relative flex size-2.5">
              <span className={cn('absolute inline-flex h-full w-full rounded-full bg-emerald-400', !error && 'animate-ping opacity-75')} />
              <span className={cn('relative inline-flex size-2.5 rounded-full', error ? 'bg-rose-500' : 'bg-emerald-400')} />
            </span>
            {error ? 'Live data unavailable' : loading && !feed ? 'Connecting…' : `Live · updated ${now}`}
          </div>
        </div>
      </div>

      {/* metric tiles */}
      <div className="relative z-10 flex flex-1 items-center px-6 py-6 sm:px-10 sm:py-8">
        <div className="grid w-full grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
          {tiles.map((t) => (
            <div
              key={t.label}
              className={cn(
                'relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6 sm:p-8',
                'bg-gradient-to-br to-transparent',
                t.glow,
              )}
            >
              <div className="text-xs font-semibold uppercase tracking-widest text-white/50 sm:text-sm">{t.label}</div>
              <div className="mt-3 text-5xl font-bold tabular-nums leading-none sm:text-7xl">{t.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 px-6 pb-6 text-center text-xs text-white/30 sm:px-10">
        Press Esc or Tab, or tap the X, to exit presentation mode.
      </div>
    </div>
  )
}
