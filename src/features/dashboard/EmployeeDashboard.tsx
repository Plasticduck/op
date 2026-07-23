import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Coffee, Users } from 'lucide-react'
import { addDays, format, startOfWeek } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import {
  useBreakNotifications,
  getBreakRemindersPref,
  setBreakRemindersPref,
  ensureNotificationPermission,
} from '@/lib/useBreakNotifications'
import { isNativeShell } from '@/lib/nativeBridge'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { WeatherOutlook } from '@/components/data/WeatherOutlook'
import {
  breaks as breaksQ,
  currentlyWorking,
  employees as empQ,
  type Break,
  type Employee,
} from '@/lib/queries/people'

type TE = { clock_in: string; clock_out: string | null }
type Working = { name: string; since: string }

// HH:MM:SS for a live elapsed duration.
function elapsed(fromIso: string, now: number) {
  const ms = Math.max(0, now - new Date(fromIso).getTime())
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export default function EmployeeDashboard() {
  const { profile } = useAuth()
  const { activeLocation } = useLocations()
  const [emp, setEmp] = useState<Employee | null>(null)
  const [entries, setEntries] = useState<TE[]>([])
  const [working, setWorking] = useState<Working[]>([])
  const [myBreaks, setMyBreaks] = useState<Break[]>([])
  const [now, setNow] = useState(Date.now())
  const [remindersOn, setRemindersOn] = useState(() =>
    profile ? getBreakRemindersPref(profile.id) : false,
  )

  // Tick once a second to drive the live timers.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const weekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), [])

  const load = useCallback(async () => {
    if (!profile || !activeLocation) return
    const { data: e } = await empQ.byUser(profile.id)
    const employee = (e as Employee | null) ?? null
    setEmp(employee)

    const { data: cw } = await currentlyWorking(activeLocation.id)
    setWorking((cw as Working[] | null) ?? [])

    if (employee) {
      const { data: te } = await supabase
        .from('time_entries')
        .select('clock_in, clock_out')
        .eq('employee_id', employee.id)
        .gte('clock_in', weekStart.toISOString())
        .order('clock_in')
      setEntries((te as TE[] | null) ?? [])

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const { data: br } = await breaksQ.forEmployee(employee.id, todayStart.toISOString())
      setMyBreaks((br as Break[] | null) ?? [])
    }
  }, [profile, activeLocation, weekStart])

  useEffect(() => {
    void load()
  }, [load])

  useBreakNotifications(myBreaks, remindersOn)

  const toggleReminders = async () => {
    const next = !remindersOn
    // Native shell: permission was already requested in the onboarding wizard;
    // ensureNotificationPermission() returns 'granted' and we let any OS-level
    // denial cause notifications to silently no-op (no in-app re-nag).
    if (next) await ensureNotificationPermission()
    setRemindersOn(next)
    if (profile) setBreakRemindersPref(profile.id, next)
  }
  // The "blocked" hint only applies in a browser — inside the native shell the
  // web's Notification API doesn't reflect the OS permission state.
  const notifBlocked =
    remindersOn && !isNativeShell() && 'Notification' in window && Notification.permission === 'denied'

  const openEntry = entries.find((e) => !e.clock_out)
  const activeBreak = myBreaks.find((b) => b.started_at && !b.ended_at)
  const upcomingBreak = myBreaks
    .filter((b) => !b.started_at && new Date(b.scheduled_start).getTime() > now - 60_000)
    .sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start))[0]

  const dayHours = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    return days.map((d) => {
      const key = format(d, 'yyyy-MM-dd')
      const hrs = entries.reduce((a, e) => {
        if (format(new Date(e.clock_in), 'yyyy-MM-dd') !== key) return a
        const end = e.clock_out ? new Date(e.clock_out).getTime() : now
        return a + Math.max(0, end - new Date(e.clock_in).getTime()) / 3600000
      }, 0)
      return { day: d, hrs }
    })
  }, [entries, weekStart, now])

  const weekTotal = dayHours.reduce((a, d) => a + d.hrs, 0)

  // Going on break auto-clocks the employee out (server-side). Returning is
  // kiosk-only — clocking back in at the kiosk ends the break.
  const startBreak = async (id: string) => {
    await breaksQ.start(id)
    void load()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {greeting()}, {profile?.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-ink-muted sm:text-base">
            {activeLocation?.name} · {format(new Date(), 'EEEE, MMMM d')}
          </p>
        </div>
        <ThemeToggle variant="pill" />
      </div>

      <WeatherOutlook
        latitude={activeLocation?.latitude ?? null}
        longitude={activeLocation?.longitude ?? null}
      />

      {/* Status / active hours / break */}
      {activeBreak ? (
        <div className="rounded-md border border-warn/40 bg-warn-soft p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Coffee className="size-6 text-warn" />
              <div>
                <div className="text-sm font-semibold text-warn">On break · clocked out</div>
                <div className="tabular text-3xl font-semibold text-ink">{elapsed(activeBreak.started_at!, now)}</div>
              </div>
            </div>
            <p className="text-sm font-medium text-warn">
              Clock in at the kiosk to end your break
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
              <Clock className="size-3.5" /> Current shift
            </div>
            {openEntry ? (
              <>
                <div className="tabular mt-2 text-3xl font-semibold text-ink">{elapsed(openEntry.clock_in, now)}</div>
                <div className="mt-1 text-xs text-ok">Clocked in since {format(new Date(openEntry.clock_in), 'h:mm a')}</div>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Not clocked in. Clock in at the time-clock kiosk to start your shift.</p>
            )}
          </div>

          <div className="rounded-md border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
              <Coffee className="size-3.5" /> Break
            </div>
            {upcomingBreak ? (
              <>
                <div className="mt-2 text-sm text-ink">
                  Scheduled {format(new Date(upcomingBreak.scheduled_start), 'h:mm a')}–{format(new Date(upcomingBreak.scheduled_end), 'h:mm a')}
                </div>
                {openEntry ? (
                  <Button className="mt-3" variant="secondary" size="sm" onClick={() => startBreak(upcomingBreak.id)}>
                    Start break
                  </Button>
                ) : (
                  <p className="mt-2 text-xs text-ink-subtle">Clock in at the kiosk first to start your break.</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">No break scheduled today.</p>
            )}
          </div>
        </div>
      )}

      {/* Break reminders are opt-in and per-device — never forced on. */}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
        <input type="checkbox" checked={remindersOn} onChange={toggleReminders} />
        Remind me before my breaks start and end (this device)
        {notifBlocked && (
          <span className="text-warn">— notifications are blocked in your browser settings</span>
        )}
      </label>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Hours this week */}
        <section className="rounded-md border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Hours this week</h2>
            <span className="tabular text-sm font-medium text-ink">{weekTotal.toFixed(1)} h</span>
          </div>
          <ul className="space-y-1.5">
            {dayHours.map(({ day, hrs }) => (
              <li key={day.toISOString()} className="flex items-center gap-3 text-sm">
                <span className="w-10 text-ink-muted">{format(day, 'EEE')}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-content">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (hrs / 10) * 100)}%` }} />
                </div>
                <span className="tabular w-12 text-right text-ink">{hrs.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Currently working */}
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <Users className="size-4 text-ink-muted" /> Currently working
          </h2>
          {working.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody is clocked in right now.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {working.map((w) => (
                <li key={w.name + w.since} className="flex items-center justify-between py-2">
                  <span className="text-ink">{w.name}</span>
                  <span className="tabular text-xs text-ink-muted">since {format(new Date(w.since), 'h:mm a')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/app/schedule"><Button variant="secondary" size="sm">My schedule</Button></Link>
        <Link to="/app/checklists"><Button variant="secondary" size="sm">Checklists</Button></Link>
        <Link to="/app/time-off"><Button variant="secondary" size="sm">Time off</Button></Link>
        <Link to="/app/calendar"><Button variant="secondary" size="sm">Calendar</Button></Link>
        {!emp && (
          <Badge tone="warn">No employee record linked to your login yet</Badge>
        )}
      </div>
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
