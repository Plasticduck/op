import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Clock, AlertTriangle, Users, MapPin } from 'lucide-react'
import { isolvedLive, type LiveResponse } from '@/lib/queries/isolved'
import { useAuth } from '@/lib/auth'
import { fnErrorMessage } from '@/lib/fnError'
import { cn } from '@/lib/utils'

// Live "who's on the clock" view, broken out by site, with each person's hours for
// the current pay week (Monday -> Sunday). Auto-refreshes while mounted.

const REFRESH_MS = 60_000
const STALE_H = 14 // an open punch running this long is probably a missed clock-out
const PTO_COLOR = '#7c3aed' // violet — PTO is highlighted distinctly from worked time

const hrs = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const elapsed = (h: number) => {
  const m = Math.round(h * 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// Allowed (budgeted) WORKED hours for a site for the day. Placeholder for now —
// returns null (= not set) until admins can set per-site/day allowed hours from
// the Labor Dashboard. Once a value exists, each card compares the day's running
// total against it: under = green, over = red with an alert.
// TODO: wire to the per-site/day allowed-hours config (Labor Dashboard).
function allowedHoursFor(site: string): number | null {
  void site // placeholder: will look up the per-site/day allowed hours
  return null
}

// Per-account region scoping. Some regional managers only need their own
// region's sites on this page. Site strings here are the iSolved MW codes
// (MWNN), which match each location's name. Region -> site membership mirrors
// accounts.company_settings.regions; MW33/MW34 are folded into Lubbock here per
// ops request even though they are not yet in that saved config.
const REGION_SITES: Record<string, string[]> = {
  'Lubbock Region': ['MW01', 'MW05', 'MW07', 'MW09', 'MW10', 'MW11', 'MW14', 'MW33', 'MW34'],
  'Permian Basin Region (A)': ['MW02', 'MW04', 'MW06', 'MW08', 'MW13', 'MW15', 'MW22', 'MW24', 'MW25'],
  'Permian Basin Region (B)': ['MW03', 'MW12', 'MW31'],
  'New Mexico Region': ['MW16', 'MW17', 'MW18', 'MW19', 'MW20', 'MW21', 'MW23', 'MW26'],
  'Central Region': ['MW27', 'MW28', 'MW29', 'MW30', 'Spotless'],
}
// Email -> the single region that account is scoped to. Anyone not listed here
// (owners, other admins) sees every site.
const SITE_SCOPE_BY_EMAIL: Record<string, string> = {
  'mcanales@mighty-wash.com': 'Lubbock Region',
  'isabel@mighty-wash.com': 'Permian Basin Region (A)',
  'lester@mighty-wash.com': 'Permian Basin Region (B)',
  'rbreed@mighty-wash.com': 'New Mexico Region',
  'djones@mighty-wash.com': 'Central Region',
}

export default function OnTheClock() {
  const { profile } = useAuth()
  const [data, setData] = useState<LiveResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [onlyIn, setOnlyIn] = useState(false)
  const [regionFilter, setRegionFilter] = useState<string>('all')
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: d, error: err } = await isolvedLive()
      if (err || d?.error) {
        setError(await fnErrorMessage(err, (d ?? null) as { message?: string; error?: string } | null, 'Could not load live labor from iSolved.'))
        return
      }
      setData(d ?? null)
      setError(null)
      setUpdatedAt(new Date())
    } catch {
      setError('Could not load live labor from iSolved.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    timer.current = window.setInterval(() => void load(), REFRESH_MS)
    return () => { if (timer.current) window.clearInterval(timer.current) }
  }, [load])

  // Region scope for the signed-in user (null = may see every site). Scoped
  // users are locked to their region; everyone else may filter the admin view
  // by region, which defaults to all sites.
  const scopedRegion = SITE_SCOPE_BY_EMAIL[(profile?.email ?? '').toLowerCase()] ?? null
  const activeRegion = scopedRegion ?? (regionFilter === 'all' ? null : regionFilter)
  const allowedSites = useMemo(
    () => (activeRegion ? new Set(REGION_SITES[activeRegion] ?? []) : null),
    [activeRegion],
  )

  // The sites this user may see, and the headline totals rolled up from just
  // those sites so the summary matches the cards shown.
  const sites = data ? (allowedSites ? data.sites.filter((s) => allowedSites.has(s.site)) : data.sites) : []
  const totals = !data
    ? null
    : allowedSites
      ? {
          clockedIn: sites.reduce((a, s) => a + s.clockedIn, 0),
          weekHours: sites.reduce((a, s) => a + s.weekHours, 0),
          weekCost: sites.reduce((a, s) => a + s.weekCost, 0),
          weekPTO: sites.reduce((a, s) => a + s.weekPTO, 0),
          employees: new Set(sites.flatMap((s) => s.employees.map((e) => e.employeeNumber))).size,
        }
      : data.totals

  // Every "check punch" (open punch running STALE_H+ hours) across the visible
  // sites, gathered into one card. These also stay flagged inline in each card.
  const checkPunches = sites
    .flatMap((s) =>
      s.employees
        .filter((e) => e.onClock && e.elapsedHours >= STALE_H)
        .map((e) => ({ site: s.site, name: e.name, salaried: e.salaried, employeeNumber: e.employeeNumber, clockInTime: e.clockInTime, elapsedHours: e.elapsedHours })),
    )
    .sort((a, b) => b.elapsedHours - a.elapsedHours)

  return (
    <div className="mt-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-full bg-ok-soft text-ok"><Clock className="size-5" /></span>
          <div>
            <div className="text-2xl font-bold tabular-nums text-ink">{totals ? totals.clockedIn : '—'}</div>
            <div className="text-xs text-ink-subtle">on the clock now</div>
          </div>
        </div>
        <div className="h-9 w-px bg-border" />
        <div>
          <div className="text-lg font-semibold tabular-nums text-ink">{totals ? hrs(totals.weekHours) : '—'}</div>
          <div className="text-xs text-ink-subtle">total hours this week</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums text-ink">{totals ? usd(totals.weekCost) : '—'}</div>
          <div className="text-xs text-ink-subtle">est. labor cost</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums text-ink">{totals ? totals.employees : '—'}</div>
          <div className="text-xs text-ink-subtle">worked this week</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums" style={{ color: PTO_COLOR }}>{totals ? hrs(totals.weekPTO) : '—'}</div>
          <div className="text-xs text-ink-subtle">PTO hours</div>
        </div>
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
              className="h-8 rounded-lg border border-border bg-content px-2 text-sm font-medium text-ink hover:border-accent focus:border-accent focus:outline-none"
            >
              <option value="all">All sites</option>
              {Object.keys(REGION_SITES).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
        {data && <div className="text-xs text-ink-muted">Pay week {data.central.weekLabel} (Mon–Sun)</div>}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={onlyIn} onChange={(e) => setOnlyIn(e.target.checked)} className="accent-accent" />
            On the clock only
          </label>
          {updatedAt && <span className="text-xs text-ink-subtle">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-content px-3 text-sm font-medium text-ink-muted hover:border-accent hover:text-ink disabled:opacity-60">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
      {loading && !data && (
        <div className="mt-8 flex items-center justify-center gap-2 text-ink-muted"><Loader2 className="size-5 animate-spin" /> Loading live labor…</div>
      )}

      {data && (
        <>
          {/* Check punches — every open punch running STALE_H+ hours, gathered
              from all sites (they also stay flagged inline in each site card). */}
          <section className={`mt-4 overflow-hidden rounded-xl border bg-card ${checkPunches.length ? 'border-warn/40' : 'border-border'}`}>
            <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${checkPunches.length ? 'border-warn/30 bg-warn-soft' : 'border-border bg-content'}`}>
              <AlertTriangle className={`size-4 ${checkPunches.length ? 'text-warn' : 'text-ink-subtle'}`} />
              <span className="font-semibold text-ink">Check punches</span>
              <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${checkPunches.length ? 'bg-warn text-white' : 'bg-ink/10 text-ink-muted'}`}>{checkPunches.length}</span>
              <span className="ml-auto text-xs text-ink-muted">Open punches running {STALE_H}h+ — likely missed clock-outs</span>
            </div>
            {checkPunches.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">No questionable punches right now.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-4 py-1.5 font-medium">Employee</th>
                    <th className="px-4 py-1.5 font-medium">Site</th>
                    <th className="px-4 py-1.5 font-medium">Clocked in</th>
                    <th className="px-4 py-1.5 text-right font-medium">Running</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {checkPunches.map((e) => (
                    <tr key={e.site + e.employeeNumber} className="bg-warn-soft/30">
                      <td className="px-4 py-1.5 font-medium text-ink">{e.name}{e.salaried && <span className="ml-2 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent" title="Salaried employee">Salary</span>}</td>
                      <td className="px-4 py-1.5 text-ink-muted">{e.site}</td>
                      <td className="px-4 py-1.5 text-ink-muted">{e.clockInTime ?? '—'}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums font-semibold text-warn">{elapsed(e.elapsedHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sites
            .filter((s) => !onlyIn || s.clockedIn > 0)
            .map((s) => {
              const emps = onlyIn ? s.employees.filter((e) => e.onClock) : s.employees
              // Running daily worked-hours total vs the site's allowed hours.
              const dayHours = s.employees.reduce((a, e) => a + e.siteDayHours, 0)
              const allowed = allowedHoursFor(s.site)
              const overAllowed = allowed != null && dayHours > allowed
              return (
                <section key={s.site} className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-content px-4 py-2.5">
                    <span className="font-semibold text-ink">{s.site}</span>
                    {s.clockedIn > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
                        <span className="size-1.5 rounded-full bg-ok" /> {s.clockedIn} on the clock
                      </span>
                    ) : (
                      <span className="rounded-full bg-content px-2 py-0.5 text-xs font-medium text-ink-subtle">none clocked in</span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-ink-muted"><Users className="size-3.5" />{s.employeeCount} · {hrs(s.weekHours)} hrs</span>
                    <span
                      title={allowed == null
                        ? 'Allowed hours not set yet — this turns green while the day stays under the allowed total and red when it goes over.'
                        : `Today's worked hours vs allowed (${hrs(allowed)} hrs)`}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                        allowed == null
                          ? 'border border-border bg-card text-ink-muted'
                          : overAllowed ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok',
                      )}
                    >
                      {overAllowed && <AlertTriangle className="size-3.5" />}
                      Day {hrs(dayHours)} / {allowed == null ? '—' : hrs(allowed)} allowed
                    </span>
                    {s.weekPTO > 0 && <span className="text-xs font-semibold" style={{ color: PTO_COLOR }}>PTO {hrs(s.weekPTO)}h</span>}
                    <div className="ml-auto flex items-center gap-4" title="Estimated weekly labor cost. Hourly: from punches this week (OT 1.5x). Salary: active salaried staff assigned to this site at annual ÷ 52.">
                      <div className="text-right leading-tight">
                        <div className="text-sm font-bold tabular-nums text-ink">{usd(s.weekCostHourly)}</div>
                        <div className="text-[10px] uppercase tracking-wide text-ink-subtle">hourly</div>
                      </div>
                      <div className="text-right leading-tight">
                        <div className="text-sm font-bold tabular-nums text-ink">{usd(s.weekCostSalary)}</div>
                        <div className="text-[10px] uppercase tracking-wide text-ink-subtle">salary</div>
                      </div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                      <tr>
                        <th className="px-4 py-1.5 font-medium">Employee</th>
                        <th className="px-4 py-1.5 font-medium">Status</th>
                        <th className="px-4 py-1.5 text-right font-medium">Day hrs</th>
                        <th className="px-4 py-1.5 text-right font-medium">Day cost</th>
                        <th className="px-4 py-1.5 text-right font-medium">Total wk</th>
                        <th className="px-4 py-1.5 text-right font-medium">PTO</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {emps.map((e) => {
                        const stale = e.onClock && e.elapsedHours >= STALE_H
                        const onPTO = !e.onClock && e.siteWeekPTO > 0
                        return (
                          <tr key={e.employeeNumber} className={e.onClock ? 'bg-ok-soft/30' : undefined} style={onPTO ? { backgroundColor: PTO_COLOR + '14' } : undefined}>
                            <td className="px-4 py-1.5 font-medium text-ink">{e.name}{e.salaried && <span className="ml-2 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent" title="Salaried employee">Salary</span>}</td>
                            <td className="px-4 py-1.5">
                              {e.onClock ? (
                                stale ? (
                                  <span className="inline-flex items-center gap-1 text-warn" title="Open punch running unusually long — likely a missed clock-out">
                                    <AlertTriangle className="size-3.5" /> {e.clockInTime} · {elapsed(e.elapsedHours)} — check punch
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 text-ok">
                                    <span className="size-1.5 rounded-full bg-ok" /> On since {e.clockInTime} · {elapsed(e.elapsedHours)}
                                  </span>
                                )
                              ) : onPTO ? (
                                <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: PTO_COLOR }}>
                                  <span className="size-1.5 rounded-full" style={{ backgroundColor: PTO_COLOR }} /> PTO{e.siteDayPTO > 0 ? ' today' : ''}
                                </span>
                              ) : (
                                <span className="text-ink-subtle">Off</span>
                              )}
                            </td>
                            <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{hrs(e.siteDayHours)}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{usd(e.siteDayCost)}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums font-semibold text-ink">{hrs(e.totalWeekHours)}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                              {e.siteWeekPTO > 0 ? <span style={{ color: PTO_COLOR }}>{hrs(e.siteWeekPTO)}</span> : <span className="text-ink-subtle">—</span>}
                            </td>
                          </tr>
                        )
                      })}
                      {emps.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-3 text-center text-xs text-ink-subtle">No one clocked in.</td></tr>
                      )}
                    </tbody>
                  </table>
                </section>
              )
            })}
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-ink-subtle">
        Live from iSolved timecard punches. Week hours are paid hours Monday–Sunday plus time accrued on the current open punch. Per card, <span className="font-medium text-ink-muted">Hourly</span> cost is estimated from punches (base rate, OT 1.5x) and <span className="font-medium text-ink-muted">Salary</span> is each site's active salaried staff at annual ÷ 52 (they don't punch); neither is payroll gross. An open punch running over {STALE_H}h is flagged as a likely missed clock-out. Salaried staff who punch are tagged “Salary.” <span className="font-medium" style={{ color: PTO_COLOR }}>PTO</span> is shown separately and is excluded from worked hours and cost. Auto-refreshes every minute.
      </p>
    </div>
  )
}
