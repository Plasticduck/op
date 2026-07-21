import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, ChevronDown } from 'lucide-react'
import { fetchWeatherHistory, weatherLabel, type WeatherDay } from '@/lib/weather'
import { useSitePerformanceFeed } from '@/lib/useSitePerformanceFeed'
import { siteNumber, type SiteDay } from '@/lib/queries/sitePerformance'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'

const RANGES = [7, 14, 30, 90] as const

// A per-site weather log: pull previous days' weather and, when the Site
// Performance feed covers the day, line it up with that day's cars and sales so
// a day's result can be read against the weather.
export function WeatherLog({
  latitude,
  longitude,
  locationName,
  perfEnabled,
}: {
  latitude: number | null
  longitude: number | null
  locationName: string
  perfEnabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState<number>(14)
  const [rows, setRows] = useState<WeatherDay[] | null>(null)
  const [error, setError] = useState(false)

  const hasCoords = latitude != null && longitude != null
  const { feed } = useSitePerformanceFeed(perfEnabled && open)

  useEffect(() => {
    if (!open || !hasCoords) return
    let active = true
    setRows(null)
    setError(false)
    fetchWeatherHistory(latitude as number, longitude as number, days)
      .then((r) => { if (active) setRows(r) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [open, hasCoords, latitude, longitude, days])

  // Map each date to this site's performance day (matched by site number).
  const perfByDate = useMemo(() => {
    if (!perfEnabled || !feed?.report) return new Map<string, SiteDay>()
    const n = siteNumber(locationName)
    const entry = Object.entries(feed.report.sites).find(([k]) => siteNumber(k) === n)
    return new Map((entry?.[1] ?? []).map((d) => [d.date, d]))
  }, [feed, perfEnabled, locationName])

  const showPerf = perfEnabled

  return (
    <section className="rounded-md border border-border bg-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 p-4 text-left">
        <CalendarClock className="size-4 text-ink-muted" />
        <span className="flex-1 text-sm font-semibold text-ink">Weather Log</span>
        <span className="text-xs text-ink-subtle">Past days vs. performance</span>
        <ChevronDown className={cn('size-4 text-ink-subtle transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          {!hasCoords ? (
            <p className="text-sm text-ink-muted">
              Add this site's address (Settings, Locations) to log its weather.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDays(r)}
                    className={cn(
                      'rounded-md border px-3 py-1 text-xs font-medium transition',
                      days === r
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border bg-card text-ink-muted hover:bg-content',
                    )}
                  >
                    Last {r}
                  </button>
                ))}
              </div>

              {error ? (
                <p className="text-sm text-ink-muted">Could not load weather history.</p>
              ) : !rows ? (
                <p className="text-sm text-ink-muted">Loading…</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Weather</th>
                        <th className="px-3 py-2 text-right font-medium">High</th>
                        <th className="px-3 py-2 text-right font-medium">Low</th>
                        <th className="px-3 py-2 text-right font-medium">Precip</th>
                        {showPerf && <th className="px-3 py-2 text-right font-medium">Cars</th>}
                        {showPerf && <th className="px-3 py-2 text-right font-medium">Sales</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {[...rows].reverse().map((w) => {
                        const wx = weatherLabel(w.code)
                        const perf = perfByDate.get(w.date)
                        return (
                          <tr key={w.date} className="border-t border-border">
                            <td className="px-3 py-1.5 text-ink">{w.date.slice(5)}</td>
                            <td className="px-3 py-1.5">
                              <span className="inline-flex items-center gap-1.5 text-ink">
                                <wx.Icon className="size-4" style={{ color: wx.color }} />
                                {wx.label}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">{w.tMax}&deg;</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">{w.tMin}&deg;</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">{w.precip ? `${w.precip}"` : '—'}</td>
                            {showPerf && <td className="px-3 py-1.5 text-right tabular-nums text-ink">{perf ? perf.cars : '—'}</td>}
                            {showPerf && <td className="px-3 py-1.5 text-right tabular-nums text-ink">{perf ? currency(perf.sales) : '—'}</td>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-[11px] text-ink-subtle">
                Weather covers the last ~90 days. Cars and sales are shown for days the performance feed carries (about 30 days).
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
