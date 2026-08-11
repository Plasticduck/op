import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, X, Building2, Layers, Dot, Check, Sun, Moon, Pause, Play } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { useTheme } from '@/lib/theme'
import { usePresentationMode } from '@/lib/presentation'
import { useLocations } from '@/lib/locations'
import { useCompany } from '@/lib/company'
import { useSitePerformanceFeed } from '@/lib/useSitePerformanceFeed'
import { siteMetrics, siteNumber, type SiteMetrics, type SitePerformanceFeed } from '@/lib/queries/sitePerformance'
import { groupByRegions, resolveRegions, shortRegionLabel } from '@/lib/regions'
import { computeScorecards, letterFor, type Scorecard, type SitePerformanceInput } from '@/lib/scorecard'
import { ratings, type SiteRating } from '@/lib/queries/ratings'
import { assets } from '@/lib/queries/assets'
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
  const { resolved, setTheme } = useTheme()
  const dark = resolved === 'dark'
  const { locations, activeLocation } = useLocations()
  const { settings } = useCompany()
  const { feed, error } = useSitePerformanceFeed(active)

  // Region groups when the account has regions configured; otherwise sites are
  // offered flat (no redundant "Other" bucket).
  const groups = useMemo(() => {
    const regs = resolveRegions(settings.regions)
    return regs.length ? groupByRegions(locations, regs) : []
  }, [locations, settings.regions])

  const [sel, setSel] = useState<Selection>({ kind: 'all' })
  const [autoplay, setAutoplay] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState('')
  // Per-location scorecards, Google ratings, and equipment-down counts.
  const [cards, setCards] = useState<Record<string, Scorecard>>({})
  const [rmap, setRmap] = useState<Record<string, SiteRating>>({})
  const [dmap, setDmap] = useState<Record<string, number>>({})

  // All sites in number order — the auto-scroll rotation.
  const orderedSites = useMemo(
    () => [...locations].sort((a, b) => (siteNumber(a.name) ?? 1e9) - (siteNumber(b.name) ?? 1e9)),
    [locations],
  )

  // On enter: start auto-scroll and open on the active site (or the first site).
  useEffect(() => {
    if (!active) return
    setAutoplay(true)
    setSel(
      activeLocation
        ? { kind: 'site', id: activeLocation.id }
        : orderedSites[0]
          ? { kind: 'site', id: orderedSites[0].id }
          : { kind: 'all' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Auto-scroll: every 60s advance to the next site by number (wraps around).
  useEffect(() => {
    if (!active || !autoplay || orderedSites.length === 0) return
    const id = setInterval(() => {
      setSel((cur) => {
        const i = cur.kind === 'site' ? orderedSites.findIndex((l) => l.id === cur.id) : -1
        return { kind: 'site', id: orderedSites[(i + 1) % orderedSites.length].id }
      })
    }, 60_000)
    return () => clearInterval(id)
  }, [active, autoplay, orderedSites])

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

  // "Updated" clock, stamped only once the live feed actually arrives.
  useEffect(() => {
    if (!active || !feed) return
    setNow(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  }, [active, feed])

  // Load scorecards + Google ratings + equipment-down counts for every site.
  useEffect(() => {
    if (!active || !locations.length) return
    let cancel = false
    void (async () => {
      const locIds = locations.map((l) => l.id)
      const [rats, downs] = await Promise.all([
        ratings.fetch(locIds).catch(() => [] as SiteRating[]),
        assets.downCounts().catch(() => ({} as Record<string, number>)),
      ])
      if (cancel) return
      const r: Record<string, SiteRating> = {}
      for (const x of rats) r[x.location_id] = x
      setRmap(r)
      setDmap(downs)
      const perfByLoc: Record<string, SitePerformanceInput> = {}
      for (const l of locations) {
        const sm = siteMetrics(feed, siteNumber(l.name))
        perfByLoc[l.id] = {
          carsPerHour: sm.carsPerHour ?? undefined,
          laborPct: sm.laborPct ?? undefined,
          conversion: sm.conversion ?? undefined,
          churn: sm.churn ?? undefined,
          googleRating: r[l.id]?.rating ?? undefined,
        }
      }
      const sc = await computeScorecards(locIds, perfByLoc).catch(() => ({} as Record<string, Scorecard>))
      if (!cancel) setCards(sc)
    })()
    return () => { cancel = true }
  }, [active, feed, locations])

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  // Resolve the current selection into a title, subtitle, and metric set.
  const view = useMemo(() => {
    if (sel.kind === 'site') {
      const loc = byId.get(sel.id)
      if (loc) return { title: loc.name, subtitle: 'Single site', metrics: siteMetrics(feed, siteNumber(loc.name)), count: 1, locs: [loc] }
    }
    if (sel.kind === 'region') {
      const g = groups.find((x) => x.region === sel.name)
      const locs = g?.locations ?? []
      return { title: sel.name, subtitle: `${locs.length} ${locs.length === 1 ? 'site' : 'sites'}`, metrics: combine(feed, locs), count: locs.length, locs }
    }
    return { title: 'All Sites', subtitle: `${locations.length} ${locations.length === 1 ? 'site' : 'sites'}`, metrics: combine(feed, locations), count: locations.length, locs: locations }
  }, [sel, byId, groups, feed, locations])

  if (!active) return null

  const m = view.metrics
  const isRoll = view.count !== 1
  const selLocs = view.locs

  // Score Card: the site's letter grade, or the region/all average grade.
  const scoreTotals = selLocs.map((l) => cards[l.id]?.total).filter((v): v is number => v != null)
  const scoreAvg = scoreTotals.length ? scoreTotals.reduce((a, b) => a + b, 0) / scoreTotals.length : null
  const scoreLetter = selLocs.length === 1 ? (cards[selLocs[0]?.id]?.letter ?? null) : scoreAvg != null ? letterFor(scoreAvg) : null
  const scoreTone = scoreAvg == null ? '' : scoreAvg >= 90 ? 'text-ok' : scoreAvg >= 75 ? 'text-accent' : scoreAvg >= 60 ? 'text-warn' : 'text-danger'
  // Google Rating: the site's rating, or the average across the selection.
  const rVals = selLocs.map((l) => rmap[l.id]?.rating).filter((v): v is number => v != null)
  const ratingVal = rVals.length ? rVals.reduce((a, b) => a + b, 0) / rVals.length : null
  // Equipment Down: total units in an unplanned-offline state across the selection.
  const downVal = selLocs.reduce((a, l) => a + (dmap[l.id] ?? 0), 0)

  // Feed-based tiles show a skeleton until the (slow) live feed arrives.
  const feedLoading = !feed && !error
  // Metric tiles. For a roll-up, cars/sales/recharge/equipment-down are totals and
  // cars-per-hour/conversion/churn/rating are averages. `dot` is an app status color.
  const tiles: { label: string; value: string; dot: string; tone?: string; feed?: boolean }[] = [
    { label: 'Score Card', value: scoreLetter ?? '—', dot: 'bg-accent', tone: scoreTone },
    { label: 'Google Rating', value: ratingVal != null ? `${ratingVal.toFixed(1)} ★` : '—', dot: 'bg-warn' },
    { label: isRoll ? 'Equipment Down (total)' : 'Equipment Down', value: String(downVal), dot: downVal > 0 ? 'bg-danger' : 'bg-ok', tone: downVal > 0 ? 'text-danger' : '' },
    { label: isRoll ? 'Cars today (total)' : 'Cars today', value: num(m.cars), dot: 'bg-accent', feed: true },
    { label: isRoll ? 'Sales today (total)' : 'Sales today', value: money(m.sales), dot: 'bg-ok', feed: true },
    { label: isRoll ? 'Recharge MTD (total)' : 'Recharge MTD', value: money(m.rechargeMtd), dot: 'bg-accent', feed: true },
    { label: isRoll ? 'Conversion (avg)' : 'Conversion', value: pct(m.conversion), dot: 'bg-warn', feed: true },
    { label: isRoll ? 'Churn (avg)' : 'Churn', value: pct(m.churn), dot: 'bg-danger', feed: true },
    { label: isRoll ? 'Cars / hr (avg)' : 'Cars / hr', value: oneDp(m.carsPerHour), dot: 'bg-ok', feed: true },
  ]

  const pickBtn = (label: string, onClick: () => void, activeSel: boolean, icon?: ReactNode) => (
    <button
      type="button"
      onClick={() => { onClick(); setPickerOpen(false); setAutoplay(false) }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition',
        activeSel ? 'bg-content text-ink' : 'text-ink-muted hover:bg-content hover:text-ink',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {activeSel && <Check className="ml-auto size-4 shrink-0 text-accent" />}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-content text-ink">
      {/* top bar (highest z so its dropdown overlays the content below) */}
      <div className="relative z-30 flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-4 sm:px-10 sm:py-5">
        <Logo size="lg" className="w-32 sm:w-40" />
        <div className="flex items-center gap-2 sm:gap-3">
          {/* auto-scroll pause / play, directly left of the site picker */}
          <button
            type="button"
            onClick={() => setAutoplay((v) => !v)}
            title={autoplay ? 'Pause auto-scroll' : 'Resume auto-scroll'}
            aria-label={autoplay ? 'Pause auto-scroll' : 'Resume auto-scroll'}
            className="rounded-lg border border-border bg-card p-2.5 text-ink-muted hover:border-accent hover:text-ink"
          >
            {autoplay ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          {/* site / region picker */}
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-ink hover:border-accent"
            >
              <span className="max-w-[40vw] truncate">{view.title}</span>
              <ChevronDown className="size-4 shrink-0 text-ink-muted" />
            </button>
            {pickerOpen && (
              <div className="absolute right-0 z-40 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-lg">
                {pickBtn('All Sites', () => setSel({ kind: 'all' }), sel.kind === 'all', <Building2 className="size-4 shrink-0 text-ink-subtle" />)}
                {groups.length === 0 && locations.map((l) => pickBtn(l.name, () => setSel({ kind: 'site', id: l.id }), sel.kind === 'site' && sel.id === l.id, <Dot className="size-4 shrink-0 text-ink-subtle" />))}
                {groups.map((g) => (
                  <div key={g.region} className="mt-1">
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{shortRegionLabel(g.region)}</div>
                    {pickBtn(`Entire ${shortRegionLabel(g.region)}`, () => setSel({ kind: 'region', name: g.region }), sel.kind === 'region' && sel.name === g.region, <Layers className="size-4 shrink-0 text-ink-subtle" />)}
                    {g.locations.map((l) => pickBtn(l.name, () => setSel({ kind: 'site', id: l.id }), sel.kind === 'site' && sel.id === l.id, <Dot className="size-4 shrink-0 text-ink-subtle" />))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            title={dark ? 'Light mode' : 'Dark mode'}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="rounded-lg border border-border bg-card p-2.5 text-ink-muted hover:border-accent hover:text-ink"
          >
            {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
          <button
            type="button"
            onClick={exit}
            title="Exit presentation (Esc)"
            aria-label="Exit presentation"
            className="rounded-lg border border-border bg-card p-2.5 text-ink-muted hover:border-accent hover:text-ink"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* headline (Mighty Wash logo centered, 30% larger than the dashboard logo) */}
      <div className="relative z-10 px-6 pt-6 sm:px-10 sm:pt-8">
        <img
          src="/mighty-max-in-flight.png"
          alt="Mighty Wash"
          className="pointer-events-none absolute left-1/2 top-0 h-auto w-[415px] max-w-[70vw] -translate-x-1/2 sm:top-1"
        />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-6xl">{view.title}</h1>
            <p className="mt-1 text-base text-ink-muted sm:text-lg">{view.subtitle}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="relative flex size-2.5">
              <span className={cn('absolute inline-flex h-full w-full rounded-full', error ? 'bg-danger' : feed ? 'bg-ok animate-ping opacity-75' : 'bg-warn')} />
              <span className={cn('relative inline-flex size-2.5 rounded-full', error ? 'bg-danger' : feed ? 'bg-ok' : 'bg-warn')} />
            </span>
            {error ? 'Live data unavailable' : !feed ? 'Loading site data...' : `Live, updated ${now}`}
          </div>
        </div>
      </div>

      {/* metric tiles */}
      <div className="relative z-0 flex flex-1 items-center px-6 py-6 sm:px-10 sm:py-8">
        <div className="grid w-full grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-border bg-card p-6 sm:p-8">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted sm:text-sm">
                <span className={cn('size-2 rounded-full', t.dot)} />
                {t.label}
              </div>
              {t.feed && feedLoading ? (
                <div className="mt-4 h-9 w-28 animate-pulse rounded-md bg-ink/10 sm:h-12 sm:w-40" />
              ) : (
                <div className={cn('mt-3 text-5xl font-bold tabular-nums leading-none sm:text-7xl', t.tone || 'text-ink')}>{t.value}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-0 px-6 pb-6 text-center text-xs text-ink-subtle sm:px-10">
        Press Esc or Tab, or tap the X, to exit presentation mode.
      </div>
    </div>
  )
}
