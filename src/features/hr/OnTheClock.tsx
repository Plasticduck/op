import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Clock, AlertTriangle, Users } from 'lucide-react'
import { isolvedLive, type LiveResponse } from '@/lib/queries/isolved'
import { fnErrorMessage } from '@/lib/fnError'

// Live "who's on the clock" view, broken out by site, with each person's hours for
// the current pay week (Sunday -> Saturday). Auto-refreshes while mounted.

const REFRESH_MS = 60_000
const STALE_H = 14 // an open punch running this long is probably a missed clock-out

const hrs = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const elapsed = (h: number) => {
  const m = Math.round(h * 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
export default function OnTheClock() {
  const [data, setData] = useState<LiveResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [onlyIn, setOnlyIn] = useState(false)
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

  return (
    <div className="mt-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-full bg-ok-soft text-ok"><Clock className="size-5" /></span>
          <div>
            <div className="text-2xl font-bold tabular-nums text-ink">{data ? data.totals.clockedIn : '—'}</div>
            <div className="text-xs text-ink-subtle">on the clock now</div>
          </div>
        </div>
        <div className="h-9 w-px bg-border" />
        <div>
          <div className="text-lg font-semibold tabular-nums text-ink">{data ? hrs(data.totals.weekHours) : '—'}</div>
          <div className="text-xs text-ink-subtle">total hours this week</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums text-ink">{data ? usd(data.totals.weekCost) : '—'}</div>
          <div className="text-xs text-ink-subtle">est. labor cost</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums text-ink">{data ? data.totals.employees : '—'}</div>
          <div className="text-xs text-ink-subtle">worked this week</div>
        </div>
        {data && <div className="text-xs text-ink-muted">Pay week {data.central.weekLabel} (Sun–Sat)</div>}
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
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.sites
            .filter((s) => !onlyIn || s.clockedIn > 0)
            .map((s) => {
              const emps = onlyIn ? s.employees.filter((e) => e.onClock) : s.employees
              return (
                <section key={s.site} className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex items-center gap-3 border-b border-border bg-content px-4 py-2.5">
                    <span className="font-semibold text-ink">{s.site}</span>
                    {s.clockedIn > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
                        <span className="size-1.5 rounded-full bg-ok" /> {s.clockedIn} on the clock
                      </span>
                    ) : (
                      <span className="rounded-full bg-content px-2 py-0.5 text-xs font-medium text-ink-subtle">none clocked in</span>
                    )}
                    <span className="ml-auto flex items-center gap-1 text-xs text-ink-muted"><Users className="size-3.5" />{s.employeeCount} · {hrs(s.weekHours)} hrs · {usd(s.weekCost)} est.</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                      <tr>
                        <th className="px-4 py-1.5 font-medium">Employee</th>
                        <th className="px-4 py-1.5 font-medium">Status</th>
                        <th className="px-4 py-1.5 text-right font-medium">Wk hrs</th>
                        <th className="px-4 py-1.5 text-right font-medium">Est. cost</th>
                        <th className="px-4 py-1.5 text-right font-medium">Total wk</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {emps.map((e) => {
                        const stale = e.onClock && e.elapsedHours >= STALE_H
                        return (
                          <tr key={e.employeeNumber} className={e.onClock ? 'bg-ok-soft/30' : undefined}>
                            <td className="px-4 py-1.5 font-medium text-ink">{e.name}</td>
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
                              ) : (
                                <span className="text-ink-subtle">Off</span>
                              )}
                            </td>
                            <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{hrs(e.siteWeekHours)}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{usd(e.siteWeekCost)}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums font-semibold text-ink">{hrs(e.totalWeekHours)}</td>
                          </tr>
                        )
                      })}
                      {emps.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-3 text-center text-xs text-ink-subtle">No one clocked in.</td></tr>
                      )}
                    </tbody>
                  </table>
                </section>
              )
            })}
        </div>
      )}

      <p className="mt-4 text-xs text-ink-subtle">
        Live from iSolved timecard punches. Week hours are paid hours Sunday–Saturday plus time accrued on the current open punch; est. cost is a base-rate estimate (overtime at 1.5x), not payroll gross. An open punch running over {STALE_H}h is flagged as a likely missed clock-out. Auto-refreshes every minute.
      </p>
    </div>
  )
}
