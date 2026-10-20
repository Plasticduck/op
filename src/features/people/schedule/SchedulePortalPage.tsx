import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { addDays, format } from 'date-fns'
import { Select } from '@/components/ui/Select'
import { Logo } from '@/components/ui/Logo'
import { timeOfDay } from '@/lib/format'
import { publicSchedules, type PublicShift, type PublicSite, type PublicWeek } from '@/lib/queries/people'

// Public, link-only page to view an account's PUBLISHED schedules per site. No
// login and no navigation to the rest of Operator — just a site + week picker and
// a read-only grid. Backed by the public-schedules edge function (token in URL).
export default function SchedulePortalPage() {
  const { token = '' } = useParams()
  const [account, setAccount] = useState('Schedules')
  const [sites, setSites] = useState<PublicSite[]>([])
  const [siteId, setSiteId] = useState('')
  const [weeks, setWeeks] = useState<PublicWeek[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [shifts, setShifts] = useState<PublicShift[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingWeeks, setLoadingWeeks] = useState(false)
  const [loadingGrid, setLoadingGrid] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data, error } = await publicSchedules.sites(token)
      const res = data as { ok?: boolean; account?: string; sites?: PublicSite[]; message?: string } | null
      if (error || !res?.ok) {
        setLoadErr(res?.message || 'This schedule link is not active.')
      } else {
        setAccount(res.account ?? 'Schedules')
        setSites(res.sites ?? [])
        if ((res.sites ?? []).length === 1) setSiteId(res.sites![0].id)
      }
      setLoading(false)
    })()
  }, [token])

  useEffect(() => {
    if (!siteId) { setWeeks([]); setWeekStart(''); setShifts([]); return }
    setLoadingWeeks(true)
    void publicSchedules.weeks(token, siteId).then(({ data }) => {
      const w = (data as { weeks?: PublicWeek[] } | null)?.weeks ?? []
      setWeeks(w)
      setWeekStart(w[0]?.week_start_date ?? '')
      setLoadingWeeks(false)
    })
  }, [siteId, token])

  useEffect(() => {
    if (!siteId || !weekStart) { setShifts([]); return }
    setLoadingGrid(true)
    void publicSchedules.week(token, siteId, weekStart).then(({ data }) => {
      setShifts((data as { shifts?: PublicShift[] } | null)?.shifts ?? [])
      setLoadingGrid(false)
    })
  }, [siteId, weekStart, token])

  const days = useMemo(
    () => (weekStart ? Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStart + 'T00:00'), i)) : []),
    [weekStart],
  )
  const employees = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of shifts) m.set(s.employee_id, s.employee_name)
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [shifts])
  const fmtDay = (d: Date) => format(d, 'yyyy-MM-dd')

  const weekLabel = (ws: string) => `Week of ${format(new Date(ws + 'T00:00'), 'MMM d, yyyy')}`

  return (
    <div className="min-h-dvh bg-content px-3 py-6 sm:px-4 sm:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex justify-center"><Logo brand="washlyfe" /></div>

        {loading ? (
          <p className="text-center text-sm text-ink-muted">Loading…</p>
        ) : loadErr ? (
          <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-ink-muted">{loadErr}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent"><CalendarDays className="size-4" /></span>
              <div>
                <h1 className="text-lg font-semibold text-ink">{account} — Published Schedules</h1>
                <p className="text-xs text-ink-muted">Choose a site to see its published schedules.</p>
              </div>
            </div>

            {sites.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-muted">No published schedules are available yet.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                    Site
                    <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-9 w-56">
                      <option value="">Select a site…</option>
                      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </label>
                  {siteId && (
                    <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                      Schedule
                      <Select
                        value={weekStart}
                        onChange={(e) => setWeekStart(e.target.value)}
                        className="h-9 w-56"
                        disabled={loadingWeeks || weeks.length === 0}
                      >
                        {weeks.length === 0 && <option value="">No published schedules</option>}
                        {weeks.map((w) => <option key={w.week_start_date} value={w.week_start_date}>{weekLabel(w.week_start_date)}</option>)}
                      </Select>
                    </label>
                  )}
                </div>

                {!siteId ? (
                  <p className="py-8 text-center text-sm text-ink-muted">Pick a site above.</p>
                ) : loadingWeeks ? (
                  <p className="py-8 text-center text-sm text-ink-muted">Loading…</p>
                ) : weeks.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-muted">No published schedules for this site yet.</p>
                ) : (
                  <div className="mt-4">
                    <h2 className="mb-2 text-sm font-semibold text-ink">{weekLabel(weekStart)}</h2>
                    {loadingGrid ? (
                      <p className="py-8 text-center text-sm text-ink-muted">Loading…</p>
                    ) : employees.length === 0 ? (
                      <p className="py-8 text-center text-sm text-ink-muted">No shifts on this schedule.</p>
                    ) : (
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full min-w-[760px] border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-border bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                              <th className="sticky left-0 z-10 bg-content px-3 py-2.5 font-medium">Employee</th>
                              {days.map((d) => (
                                <th key={fmtDay(d)} className="px-2 py-2.5 text-center font-medium">
                                  <div>{format(d, 'EEE')}</div>
                                  <div className="text-ink-subtle">{format(d, 'M/d')}</div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {employees.map((emp) => (
                              <tr key={emp.id} className="border-b border-border last:border-0">
                                <td className="sticky left-0 z-10 bg-card px-3 py-2 align-top font-medium text-ink">{emp.name}</td>
                                {days.map((d) => {
                                  const dayStr = fmtDay(d)
                                  const cell = shifts.filter((s) => s.employee_id === emp.id && s.date === dayStr)
                                  return (
                                    <td key={dayStr} className="px-1.5 py-1.5 align-top">
                                      <div className="flex flex-col gap-1">
                                        {cell.map((s, i) => (
                                          <div key={i} className="rounded bg-accent-soft px-1.5 py-1 text-xs text-accent">
                                            {timeOfDay(s.start_time)} to {timeOfDay(s.end_time)}
                                            {s.role_label && <div className="text-[10px] text-ink-muted">{s.role_label}</div>}
                                          </div>
                                        ))}
                                      </div>
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-ink-subtle">Published schedules only · view-only</p>
      </div>
    </div>
  )
}
