import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clock, Loader2, MapPin, RefreshCw } from 'lucide-react'
import { flexwashLabor, type FlexLaborResponse, type FlexLaborStat } from '@/lib/queries/flexwashLabor'
import { useAuth } from '@/lib/auth'
import { fnErrorMessage } from '@/lib/fnError'
import { REGION_SITES, SITE_SCOPE_BY_EMAIL } from './regions'

// The FlexWash tab on On the Clock: hours and cost from FlexWash's own time clock
// by site, for today, this pay week and this pay period. FlexWash's API has totals
// only (no names or clock-in times), and FlexWash refreshes them every ~10 minutes.

const REFRESH_MS = 5 * 60_000

const hrs = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const add = (a: FlexLaborStat, b: FlexLaborStat): FlexLaborStat => ({ hours: a.hours + b.hours, cost: a.cost + b.cost })
const ZERO: FlexLaborStat = { hours: 0, cost: 0 }

export default function FlexWashLabor() {
  const { profile } = useAuth()
  const [data, setData] = useState<FlexLaborResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [regionFilter, setRegionFilter] = useState<string>('all')
  const timer = useRef<number | null>(null)

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    try {
      const { data: d, error: err } = await flexwashLabor(fresh)
      if (err || d?.error) {
        setError(await fnErrorMessage(err, (d ?? null) as { message?: string; error?: string } | null, 'Could not load labor from FlexWash.'))
        return
      }
      setData(d ?? null)
      setError(null)
      setUpdatedAt(new Date())
    } catch {
      setError('Could not load labor from FlexWash.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    timer.current = window.setInterval(() => void load(), REFRESH_MS)
    return () => { if (timer.current) window.clearInterval(timer.current) }
  }, [load])

  // Same region rules as the iSolved tab: scoped regional managers see only their
  // region; everyone else may filter by region.
  const scopedRegion = SITE_SCOPE_BY_EMAIL[(profile?.email ?? '').toLowerCase()] ?? null
  const activeRegion = scopedRegion ?? (regionFilter === 'all' ? null : regionFilter)
  const allowed = useMemo(() => (activeRegion ? new Set(REGION_SITES[activeRegion] ?? []) : null), [activeRegion])
  const sites = data ? data.sites.filter((s) => !allowed || allowed.has(s.site)) : []
  const idle = data ? data.idle.filter((s) => !allowed || allowed.has(s)) : []
  const totals = sites.reduce(
    (t, s) => ({ today: add(t.today, s.today), week: add(t.week, s.week), period: add(t.period, s.period) }),
    { today: ZERO, week: ZERO, period: ZERO },
  )
  const c = data?.central

  return (
    <div className="mt-3" data-testid="flexwash-labor">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent"><Clock className="size-5" /></span>
          <div>
            <div className="text-2xl font-bold tabular-nums text-ink">{data ? sites.length : '—'}</div>
            <div className="text-xs text-ink-subtle">{data ? `of ${sites.length + idle.length} sites on the FlexWash clock` : 'sites on the FlexWash clock'}</div>
          </div>
        </div>
        <div className="hidden h-9 w-px bg-border sm:block" />
        <Stat label="today" s={data ? totals.today : null} />
        <Stat label="this week" s={data ? totals.week : null} />
        <Stat label="this pay period" s={data ? totals.period : null} />
        {scopedRegion ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent" title="You are viewing a single region">
            <MapPin className="size-3.5" /> {scopedRegion}
          </span>
        ) : (
          <label className="inline-flex items-center gap-1.5 text-sm text-ink-muted" title="Filter the view to a single region">
            <MapPin className="size-4 text-ink-subtle" />
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              aria-label="Region"
              className="h-9 rounded-lg border border-border bg-content px-2 py-0 text-sm font-medium leading-tight text-ink hover:border-accent focus:border-accent focus:outline-none"
            >
              <option value="all">All sites</option>
              {Object.keys(REGION_SITES).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        <div className="ml-auto flex items-center gap-3">
          {updatedAt && <span className="text-xs text-ink-subtle">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button onClick={() => void load(true)} disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-content px-3 text-sm font-medium text-ink-muted hover:border-accent hover:text-ink disabled:opacity-60">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
      {loading && !data && (
        <div className="mt-8 flex items-center justify-center gap-2 text-ink-muted"><Loader2 className="size-5 animate-spin" /> Loading labor from FlexWash…</div>
      )}

      {data && c && (
        <>
          <section className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-content px-4 py-2.5">
              <span className="font-semibold text-ink">By site</span>
              <span className="text-xs text-ink-muted">
                Week {day(c.weekStart)}–{day(c.today)} · Pay period {day(c.periodStart)}–{day(c.periodEnd)}
              </span>
            </div>
            {sites.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-muted">
                {activeRegion ? `No ${activeRegion} sites are clocking in on FlexWash yet.` : 'No sites are clocking in on FlexWash yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-ink-subtle">
                    <tr className="border-b border-border">
                      <th rowSpan={2} className="px-4 py-1.5 text-left align-bottom font-medium">Site</th>
                      <th colSpan={2} className="border-l border-border px-4 pt-1.5 text-center font-semibold text-ink-muted">Today</th>
                      <th colSpan={2} className="border-l border-border px-4 pt-1.5 text-center font-semibold text-ink-muted">This week</th>
                      <th colSpan={2} className="border-l border-border px-4 pt-1.5 text-center font-semibold text-ink-muted">Pay period</th>
                      <th rowSpan={2} className="border-l border-border px-4 py-1.5 text-right align-bottom font-medium" title="Pay period cost ÷ pay period hours">Cost / hr</th>
                    </tr>
                    <tr>
                      {['Today', 'Week', 'Period'].map((k) => (
                        <FragmentCols key={k} />
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sites.map((s) => (
                      <tr key={s.site}>
                        <td className="px-4 py-2 font-semibold text-ink">{s.site}</td>
                        {s.error ? (
                          <td colSpan={7} className="border-l border-border px-4 py-2 text-xs text-danger">
                            <AlertTriangle className="mr-1 inline size-3.5" />{s.error}
                          </td>
                        ) : (
                          <>
                            <Cells s={s.today} />
                            <Cells s={s.week} />
                            <Cells s={s.period} strong />
                            <td className="border-l border-border px-4 py-2 text-right tabular-nums text-ink-muted">
                              {s.period.hours > 0 ? usd(s.period.cost / s.period.hours) : '—'}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {sites.length > 1 && (
                    <tfoot className="border-t-2 border-border bg-content font-semibold">
                      <tr>
                        <td className="px-4 py-2 text-ink">Total</td>
                        <Cells s={totals.today} />
                        <Cells s={totals.week} />
                        <Cells s={totals.period} strong />
                        <td className="border-l border-border px-4 py-2 text-right tabular-nums text-ink-muted">
                          {totals.period.hours > 0 ? usd(totals.period.cost / totals.period.hours) : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </section>

          {idle.length > 0 && (
            <section className="mt-4 rounded-xl border border-border bg-card px-4 py-3">
              <div className="text-sm font-semibold text-ink">Not on the FlexWash clock yet <span className="font-normal text-ink-subtle">({idle.length})</span></div>
              <p className="mt-0.5 text-xs text-ink-muted">These sites have no FlexWash hours this pay period. They move up to the table once their staff start clocking in on FlexWash.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {idle.map((s) => <span key={s} className="rounded-full bg-content px-2 py-0.5 text-xs font-medium text-ink-muted">{s}</span>)}
              </div>
            </section>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-ink-subtle">
        From FlexWash's own time clock. FlexWash updates these totals about every 10 minutes, shifts still in progress included. FlexWash shares totals only, so names and clock-in times aren't available here; the iSolved tab has those. Cost is FlexWash's labor cost, which also counts any daily salary amount set up in FlexWash. The week runs Monday to Sunday and the pay period is two weeks. Refreshes every 5 minutes.
      </p>
    </div>
  )
}

function Stat({ label, s }: { label: string; s: FlexLaborStat | null }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums text-ink">
        {s ? <>{hrs(s.hours)} hrs <span className="text-ink-muted">· {usd(s.cost)}</span></> : '—'}
      </div>
      <div className="text-xs text-ink-subtle">{label}</div>
    </div>
  )
}

function FragmentCols() {
  return (
    <>
      <th className="border-l border-border px-4 pb-1.5 text-right font-medium">Hrs</th>
      <th className="px-4 pb-1.5 text-right font-medium">Cost</th>
    </>
  )
}

function Cells({ s, strong }: { s: FlexLaborStat; strong?: boolean }) {
  return (
    <>
      <td className={`border-l border-border px-4 py-2 text-right tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{hrs(s.hours)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{usd(s.cost)}</td>
    </>
  )
}
