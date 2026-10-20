import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarCog,
  Link2,
  UsersRound,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { Field } from '@/components/forms/Field'
import { TimeSelect } from '@/components/forms/TimeSelect'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { currency, timeOfDay } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { updateCompany } from '@/lib/queries/companySettings'
import { isolvedRosterSync } from '@/lib/queries/isolved'
import { fnErrorMessage } from '@/lib/fnError'
import {
  employees as empQ,
  schedules,
  schedulePortal,
  shiftFavorites as shiftFavoritesQ,
  type Employee,
  type Shift,
  type ShiftFavorite,
  type TimeOffRequest,
} from '@/lib/queries/people'

// Mighty Wash account: its schedulable staff come from iSolved (synced into
// `employees`), so the "Sync Employee Info" action only shows for this account.
const ISOLVED_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

const fmtDay = (d: Date) => format(d, 'yyyy-MM-dd')
const hoursBetween = (s: string, e: string) => {
  const [sh, sm] = s.split(':').map(Number)
  const [eh, em] = e.split(':').map(Number)
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60)
}

// Drag payload type for a shift dragged from the palette onto a cell.
const SHIFT_DND_TYPE = 'application/shift-template'

// Legacy lunch shifts (created before lunches were removed) stay unpaid so old
// schedules still total correctly; nothing creates lunch shifts anymore.
const LUNCH_LABEL = 'Lunch'
const isLunchShift = (s: { role_label?: string | null }) =>
  (s.role_label ?? '').trim().toLowerCase() === LUNCH_LABEL.toLowerCase()
// Hours a shift contributes to totals: zero for legacy lunch/unpaid breaks.
const paidHours = (s: Shift) => (isLunchShift(s) ? 0 : hoursBetween(s.start_time, s.end_time))

// Normalize a time to "HH:MM" so remembered shifts dedupe cleanly.
const hhmm = (t: string) => t.slice(0, 5)

// Compact label matching the user's shorthand: 08:00 -> 14:00 becomes "8-2".
const hour12 = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  const hh = h % 12 || 12
  return m ? `${hh}:${String(m).padStart(2, '0')}` : `${hh}`
}
const shiftChipLabel = (start: string, end: string, lunch?: boolean) =>
  `${lunch ? 'LUNCH ' : ''}${hour12(start)}-${hour12(end)}`

type CrossShift = {
  id: string
  employee_id: string
  date: string
  start_time: string
  end_time: string
  schedule: { id: string; location_id: string } | null
}

// Copied day of shifts, ready to paste onto another day. Held by the parent so
// it can be pasted across weeks in the multi-week views.
type DayClipboard = {
  label: string
  shifts: { start_time: string; end_time: string; role_label: string | null; notes: string | null }[]
}

// One week of the schedule grid. The parent (`Scheduler`) owns the work-week
// start day and the planning period, and renders one WeekBlock per week in the
// visible range (1 for weekly, 2 for bi-weekly, 4-6 for monthly). Everything
// about a single week -- shifts, drag+drop, publish, AI suggest, copy/clear --
// lives here and operates on the `weekStart` it is handed.
function WeekBlock({
  locationId,
  weekStart,
  clipboard,
  setClipboard,
  positions,
  recordShift,
}: {
  locationId: string
  weekStart: Date
  clipboard: DayClipboard | null
  setClipboard: (c: DayClipboard | null) => void
  positions: string[]
  recordShift: (start: string, end: string) => void
}) {
  const { profile } = useAuth()
  const [emps, setEmps] = useState<Employee[]>([])
  const [scheduleId, setScheduleId] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [crossShifts, setCrossShifts] = useState<CrossShift[]>([])
  const [timeOffRows, setTimeOffRows] = useState<TimeOffRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [addFor, setAddFor] = useState<{ employeeId: string; date: string } | null>(null)
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiResult, setAiResult] = useState<AISuggestionResult | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [copyBusy, setCopyBusy] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const isIsolvedAccount = profile?.account_id === ISOLVED_ACCOUNT_ID
  // Drag-and-drop state. `drag` describes what's being dragged (an existing
  // shift, or an employee from the row header). `dragOver` lets us highlight
  // the target cell while a drag is in progress.
  const [drag, setDrag] = useState<
    | { kind: 'shift'; shiftId: string }
    | { kind: 'employee'; employeeId: string }
    | null
  >(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const weekStartStr = fmtDay(weekStart)
  const weekEndStr = fmtDay(addDays(weekStart, 6))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: empData } = await empQ.listActive(locationId)
    const empList = (empData as Employee[] | null) ?? []
    setEmps(empList)

    let sched = (await schedules.getWeek(locationId, weekStartStr)).data as { id: string; published: boolean } | null
    if (!sched) {
      const { data } = await schedules.create({
        location_id: locationId,
        week_start_date: weekStartStr,
        created_by: profile?.id ?? null,
      })
      sched = data as { id: string; published: boolean }
    }
    setScheduleId(sched?.id ?? null)
    setPublished(sched?.published ?? false)
    if (sched?.id) {
      const { data: sh } = await schedules.shifts(sched.id)
      setShifts((sh as Shift[] | null) ?? [])
    } else {
      setShifts([])
    }

    // Conflict signals.
    const empIds = empList.map((e) => e.id)
    const [crossRes, offRes] = await Promise.all([
      schedules.shiftsForEmployeesInRange(empIds, weekStartStr, weekEndStr),
      empIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from('time_off_requests')
            .select('*')
            .in('employee_id', empIds)
            .in('status', ['pending', 'approved'])
            .or(`and(start_date.lte.${weekEndStr},end_date.gte.${weekStartStr})`),
    ])
    setCrossShifts(((crossRes as { data: CrossShift[] | null }).data ?? []))
    setTimeOffRows(((offRes as { data: TimeOffRequest[] | null }).data ?? []))

    setLoading(false)
  }, [locationId, weekStartStr, weekEndStr, profile?.id])

  useEffect(() => { void load() }, [load])

  const laborCost = shifts.reduce((acc, s) => {
    const emp = emps.find((e) => e.id === s.employee_id)
    const rate = emp?.hourly_rate ?? 0
    return acc + paidHours(s) * rate
  }, 0)
  const totalHours = shifts.reduce((a, s) => a + paidHours(s), 0)

  const hoursByEmployee = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of shifts) {
      m.set(s.employee_id, (m.get(s.employee_id) ?? 0) + paidHours(s))
    }
    return m
  }, [shifts])

  const hoursByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of shifts) {
      m.set(s.date, (m.get(s.date) ?? 0) + paidHours(s))
    }
    return m
  }, [shifts])

  // Build conflict lookup: a Set of "${employeeId}|${date}|${reason}" for each
  // off-day or other-location overlap so the cell can render a warning chip.
  const conflicts = useMemo(() => {
    const m = new Map<string, string[]>()
    const push = (key: string, reason: string) => {
      const arr = m.get(key) ?? []
      arr.push(reason)
      m.set(key, arr)
    }
    for (const t of timeOffRows) {
      for (let d = new Date(t.start_date); d <= new Date(t.end_date); d.setDate(d.getDate() + 1)) {
        const ds = fmtDay(d)
        if (ds >= weekStartStr && ds <= weekEndStr) {
          push(`${t.employee_id}|${ds}`, t.status === 'approved' ? 'Approved time off' : 'Pending time off')
        }
      }
    }
    for (const s of crossShifts) {
      if (!s.schedule || s.schedule.location_id === locationId) continue
      push(`${s.employee_id}|${s.date}`, `Also scheduled at another site ${timeOfDay(s.start_time)} to ${timeOfDay(s.end_time)}`)
    }
    return m
  }, [timeOffRows, crossShifts, locationId, weekStartStr, weekEndStr])

  const removeShift = async (id: string) => {
    await schedules.removeShift(id)
    setShifts((arr) => arr.filter((s) => s.id !== id))
  }

  const togglePublish = async () => {
    if (!scheduleId) return
    await schedules.publish(scheduleId, !published)
    setPublished((p) => !p)
  }

  // Pull the active iSolved roster into `employees` so staff become schedulable
  // without manual profiles, then reload this week's board.
  const syncRoster = async () => {
    setSyncBusy(true)
    setSyncMsg(null)
    const { data, error } = await isolvedRosterSync()
    if (error || data?.error) {
      setSyncMsg(await fnErrorMessage(error, (data ?? null) as { message?: string; error?: string } | null, 'Could not sync staff from iSolved.'))
      setSyncBusy(false)
      return
    }
    await load()
    const d = data ?? {}
    setSyncMsg(`Synced ${d.synced ?? 0} staff from iSolved${d.deactivated ? ` · ${d.deactivated} deactivated` : ''}.`)
    setSyncBusy(false)
  }

  const copyPreviousWeek = async () => {
    if (!scheduleId) return
    const prevStart = fmtDay(addWeeks(weekStart, -1))
    if (!window.confirm(`Copy every shift from the week of ${prevStart} into the current week? Existing shifts are kept; only missing slots are filled.`)) return
    setCopyBusy(true)
    const prev = (await schedules.getWeek(locationId, prevStart)).data as { id: string } | null
    if (!prev?.id) {
      setCopyBusy(false)
      window.alert('No schedule found for the previous week.')
      return
    }
    const { data: prevShifts } = await schedules.shifts(prev.id)
    const list = (prevShifts as Shift[] | null) ?? []
    const existingKey = new Set(shifts.map((s) => `${s.employee_id}|${s.date}|${s.start_time}|${s.end_time}`))
    const added: Shift[] = []
    for (const s of list) {
      const newDate = fmtDay(addWeeks(new Date(s.date), 1))
      const key = `${s.employee_id}|${newDate}|${s.start_time}|${s.end_time}`
      if (existingKey.has(key)) continue
      const { data } = await schedules.addShift({
        schedule_id: scheduleId,
        employee_id: s.employee_id,
        date: newDate,
        start_time: s.start_time,
        end_time: s.end_time,
        role_label: s.role_label,
        notes: s.notes,
      })
      if (data) added.push(data as Shift)
    }
    setShifts((arr) => [...arr, ...added])
    setCopyBusy(false)
  }

  const clearWeek = async () => {
    if (shifts.length === 0) return
    if (!window.confirm(`Remove all ${shifts.length} shift${shifts.length === 1 ? '' : 's'} from this week? This cannot be undone.`)) return
    setClearBusy(true)
    await Promise.all(shifts.map((s) => schedules.removeShift(s.id)))
    setShifts([])
    setClearBusy(false)
  }

  const requestAISuggest = async () => {
    setAiBusy(true)
    setAiError(null)
    setAiResult(null)
    const { data, error } = await supabase.functions.invoke('suggest-schedule', {
      body: { location_id: locationId, week_start: weekStartStr },
    })
    setAiBusy(false)
    if (error) {
      setAiError(error.message || 'Suggestion failed')
      return
    }
    const res = data as AISuggestionResult
    if (!res || !Array.isArray(res.suggestions)) {
      setAiError('Unexpected response from the suggestion service.')
      return
    }
    setAiResult(res)
  }

  // ---- Copy / paste a day ---------------------------------------------------
  // Copy every shift in an (employee, day) cell to a shared clipboard, then
  // paste them onto any other cell (same or different employee/day/week).
  const copyDay = (employeeId: string, date: string, empName: string) => {
    const cellShifts = shifts.filter((s) => s.employee_id === employeeId && s.date === date)
    if (cellShifts.length === 0) return
    setClipboard({
      label: `${empName.trim()} on ${format(new Date(date + 'T00:00'), 'EEE MMM d')}`,
      shifts: cellShifts.map((s) => ({
        start_time: s.start_time,
        end_time: s.end_time,
        role_label: s.role_label,
        notes: s.notes,
      })),
    })
  }

  const pasteDay = async (employeeId: string, date: string) => {
    if (!clipboard || !scheduleId) return
    const added: Shift[] = []
    for (const t of clipboard.shifts) {
      const { data } = await schedules.addShift({
        schedule_id: scheduleId,
        employee_id: employeeId,
        date,
        start_time: t.start_time,
        end_time: t.end_time,
        role_label: t.role_label,
        notes: t.notes,
      })
      if (data) added.push(data as Shift)
    }
    if (added.length) setShifts((arr) => [...arr, ...added])
  }

  // ---- Drag-and-drop --------------------------------------------------------
  // Dropping a shift on a different (employee, date) cell moves it. We optimistically
  // update local state, then persist via updateShift; on error we reload to recover.
  const moveShift = async (shiftId: string, employeeId: string, date: string) => {
    const current = shifts.find((s) => s.id === shiftId)
    if (!current) return
    if (current.employee_id === employeeId && current.date === date) return
    setShifts((arr) =>
      arr.map((s) => (s.id === shiftId ? { ...s, employee_id: employeeId, date } : s)),
    )
    const { error } = await schedules.updateShift(shiftId, { employee_id: employeeId, date })
    if (error) void load()
  }

  // The employee's default position (stored on employees.role_title) — new shifts
  // for them pre-fill with it.
  const defaultPositionFor = (employeeId: string) =>
    emps.find((e) => e.id === employeeId)?.role_title ?? null

  // Set/clear an employee's default position (persists to employees.role_title).
  const setEmployeePosition = async (employeeId: string, position: string) => {
    const value = position.trim() || null
    setEmps((arr) => arr.map((e) => (e.id === employeeId ? { ...e, role_title: value } : e)))
    await empQ.update(employeeId, { role_title: value })
  }

  // Dropping an employee chip onto a day creates a new shift with a sane default
  // length (their most recent shift, else 8 to 4) and their default position.
  const createShiftFromEmployee = async (employeeId: string, date: string) => {
    if (!scheduleId) return
    const empShifts = shifts.filter((s) => s.employee_id === employeeId)
    const [start, end] = empShifts.length > 0
      ? [empShifts[0].start_time, empShifts[0].end_time]
      : ['08:00', '16:00']
    const { data } = await schedules.addShift({
      schedule_id: scheduleId,
      employee_id: employeeId,
      date,
      start_time: start,
      end_time: end,
      role_label: defaultPositionFor(employeeId),
      notes: null,
    })
    if (data) { setShifts((arr) => [...arr, data as Shift]); recordShift(hhmm(start), hhmm(end)) }
  }

  // Dropping a remembered shift from the palette creates a shift with that exact
  // start/end time and the employee's default position.
  const createShiftFromTemplate = async (
    employeeId: string,
    date: string,
    start: string,
    end: string,
  ) => {
    if (!scheduleId) return
    const { data } = await schedules.addShift({
      schedule_id: scheduleId,
      employee_id: employeeId,
      date,
      start_time: start,
      end_time: end,
      role_label: defaultPositionFor(employeeId),
      notes: null,
    })
    if (data) { setShifts((arr) => [...arr, data as Shift]); recordShift(hhmm(start), hhmm(end)) }
  }

  const onDropCell = (employeeId: string, date: string) => async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    // A remembered shift dragged from the palette carries its time in dataTransfer.
    const tplRaw = e.dataTransfer.getData(SHIFT_DND_TYPE)
    if (tplRaw) {
      try {
        const tpl = JSON.parse(tplRaw) as { start: string; end: string }
        await createShiftFromTemplate(employeeId, date, tpl.start, tpl.end)
      } catch {
        /* malformed payload, ignore */
      }
      return
    }
    if (!drag) return
    if (drag.kind === 'shift') await moveShift(drag.shiftId, employeeId, date)
    else await createShiftFromEmployee(drag.employeeId, date)
    setDrag(null)
  }

  const applyAISuggestions = async () => {
    if (!aiResult || !scheduleId) return
    setAiBusy(true)
    const inserted: Shift[] = []
    for (const s of aiResult.suggestions) {
      const date = fmtDay(addDays(weekStart, s.day_index))
      const { data } = await schedules.addShift({
        schedule_id: scheduleId,
        employee_id: s.employee_id,
        date,
        start_time: s.start_time,
        end_time: s.end_time,
        role_label: s.role_label ?? null,
      })
      if (data) inserted.push(data as Shift)
    }
    setShifts((prev) => [...prev, ...inserted])
    setAiResult(null)
    setAiBusy(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">
            {format(weekStart, 'MMM d')} to {format(addDays(weekStart, 6), 'MMM d, yyyy')}
          </span>
          <Badge tone={published ? 'ok' : 'warn'}>{published ? 'Published' : 'Draft'}</Badge>
          <span className="ml-1 text-xs text-ink-muted">
            Hours <span className="tabular font-medium text-ink">{totalHours.toFixed(1)}</span>
            <span className="mx-1.5 text-ink-subtle">.</span>
            Labor <span className="tabular font-medium text-ink">{currency(laborCost)}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void requestAISuggest()}
            disabled={aiBusy}
            title="Build a draft week from team history with Claude"
          >
            <Sparkles className="size-4" /> {aiBusy && !aiResult ? 'Thinking...' : 'AI suggest'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copyPreviousWeek()}
            disabled={copyBusy || !scheduleId}
            title="Carry over every shift from the previous week"
          >
            {copyBusy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCopy className="size-4" />}
            Copy previous week
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void clearWeek()}
            disabled={clearBusy || shifts.length === 0}
          >
            {clearBusy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Clear week
          </Button>
          {isIsolvedAccount && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void syncRoster()}
              disabled={syncBusy}
              title="Pull active staff from iSolved so they can be scheduled at their site"
            >
              {syncBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Sync Employee Info
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={togglePublish}>{published ? 'Unpublish' : 'Publish'}</Button>
        </div>
      </div>

      {syncMsg && (
        <div className="rounded-md border border-border bg-content px-3 py-2 text-xs text-ink-muted">{syncMsg}</div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : emps.length === 0 ? (
        <div className="flex flex-col items-start gap-2 text-sm text-ink-muted">
          <p>
            {isIsolvedAccount
              ? 'No staff at this site yet. Use “Sync Employee Info” to pull this location’s active employees in as schedulable labor.'
              : 'Add active employees first to build a schedule.'}
          </p>
          {isIsolvedAccount && (
            <Button size="sm" onClick={() => void syncRoster()} disabled={syncBusy}>
              {syncBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Sync Employee Info
            </Button>
          )}
        </div>
      ) : (
        <>
        <div className="rounded-md border border-accent/20 bg-accent-soft/40 px-3 py-2 text-xs text-ink-muted">
          <span className="font-medium text-accent">Tip:</span> Add a shift with the + on any day — Operator remembers it so you can drag it from the Shifts palette next time. Drag an existing shift to move it, or an employee's name onto a day to create one. New shifts use the employee's position.
        </div>
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="sticky left-0 z-10 bg-content px-3 py-2.5 font-medium">Employee</th>
                {days.map((d) => (
                  <th key={fmtDay(d)} className="px-2 py-2.5 text-center font-medium">
                    <div>{format(d, 'EEE')}</div>
                    <div className="text-ink-subtle">{format(d, 'M/d')}</div>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {emps.map((emp) => {
                const empHours = hoursByEmployee.get(emp.id) ?? 0
                return (
                  <tr key={emp.id} className="border-b border-border last:border-0">
                    <td
                      className={cn(
                        'sticky left-0 z-10 bg-card px-3 py-2 align-top',
                        drag?.kind === 'employee' && drag.employeeId === emp.id && 'opacity-50',
                      )}
                      draggable
                      onDragStart={(e) => {
                        setDrag({ kind: 'employee', employeeId: emp.id })
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onDragEnd={() => { setDrag(null); setDragOver(null) }}
                      title="Drag onto a day to create a shift"
                    >
                      <div className="cursor-grab active:cursor-grabbing select-none">
                        <div className="font-medium text-ink">{emp.first_name} {emp.last_name}</div>
                      </div>
                      {/* Default position — not draggable so it can be changed inline. */}
                      <select
                        draggable={false}
                        value={emp.role_title ?? ''}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => void setEmployeePosition(emp.id, e.target.value)}
                        title="Default position"
                        className="mt-1 w-full max-w-[9rem] rounded border border-border bg-content px-1 py-0.5 text-[11px] text-ink-muted"
                      >
                        <option value="">No position</option>
                        {emp.role_title && !positions.includes(emp.role_title) && (
                          <option value={emp.role_title}>{emp.role_title}</option>
                        )}
                        {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    {days.map((d) => {
                      const dayStr = fmtDay(d)
                      const cell = shifts.filter((s) => s.employee_id === emp.id && s.date === dayStr)
                      const cellConflicts = conflicts.get(`${emp.id}|${dayStr}`) ?? []
                      const hasConflict = cellConflicts.length > 0 && cell.length > 0
                      const cellKey = `${emp.id}|${dayStr}`
                      const isOver = dragOver === cellKey
                      return (
                        <td
                          key={dayStr}
                          onDragOver={(e) => {
                            // A palette preset shows up as a dataTransfer type
                            // during the drag (its value can't be read yet).
                            const isTemplate = e.dataTransfer.types.includes(SHIFT_DND_TYPE)
                            if (!drag && !isTemplate) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = drag?.kind === 'shift' ? 'move' : 'copy'
                            if (dragOver !== cellKey) setDragOver(cellKey)
                          }}
                          onDragLeave={() => { if (dragOver === cellKey) setDragOver(null) }}
                          onDrop={onDropCell(emp.id, dayStr)}
                          className={cn(
                            'px-1.5 py-1.5 align-top transition',
                            hasConflict && 'bg-danger-soft/40',
                            isOver && 'bg-accent-soft ring-2 ring-inset ring-accent/60',
                          )}
                        >
                          <div className="flex flex-col gap-1">
                            {cell.map((s) => (
                              <div
                                key={s.id}
                                draggable
                                onDragStart={(e) => {
                                  setDrag({ kind: 'shift', shiftId: s.id })
                                  e.dataTransfer.effectAllowed = 'move'
                                }}
                                onDragEnd={() => { setDrag(null); setDragOver(null) }}
                                className={cn(
                                  'group relative rounded text-xs cursor-grab active:cursor-grabbing',
                                  isLunchShift(s) ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent',
                                  drag?.kind === 'shift' && drag.shiftId === s.id && 'opacity-40',
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => setEditShift(s)}
                                  className="block w-full px-1.5 py-1 text-left"
                                  title="Click to edit, drag to move"
                                >
                                  {timeOfDay(s.start_time)} to {timeOfDay(s.end_time)}
                                  {s.role_label && <div className="text-[10px] text-ink-muted">{s.role_label}</div>}
                                  {s.notes && <div className="truncate text-[10px] text-ink-muted">{s.notes}</div>}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); void removeShift(s.id) }}
                                  title="Remove shift"
                                  className="absolute right-0.5 top-0.5 hidden rounded p-0.5 text-accent hover:bg-card group-hover:block"
                                >
                                  <X className="size-3" />
                                </button>
                              </div>
                            ))}
                            {cellConflicts.length > 0 && (
                              <div
                                title={cellConflicts.join(' . ')}
                                className="inline-flex items-center gap-1 rounded bg-danger-soft px-1 py-0.5 text-[10px] text-danger"
                              >
                                <AlertTriangle className="size-3" />
                                {cellConflicts.length === 1 ? cellConflicts[0] : `${cellConflicts.length} conflicts`}
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setAddFor({ employeeId: emp.id, date: dayStr })}
                                title="Add a shift"
                                className="flex-1 rounded border border-dashed border-border px-1.5 py-1 text-xs text-ink-subtle hover:border-accent hover:text-accent"
                              >
                                <Plus className="mx-auto size-3" />
                              </button>
                              {cell.length > 0 && (
                                <button
                                  onClick={() => copyDay(emp.id, dayStr, `${emp.first_name} ${emp.last_name}`)}
                                  title="Copy this day's shifts"
                                  className="rounded border border-border px-1.5 py-1 text-ink-subtle hover:border-accent hover:text-accent"
                                >
                                  <ClipboardCopy className="size-3" />
                                </button>
                              )}
                              {clipboard && (
                                <button
                                  onClick={() => void pasteDay(emp.id, dayStr)}
                                  title={`Paste ${clipboard.shifts.length} shift${clipboard.shifts.length === 1 ? '' : 's'} from ${clipboard.label}`}
                                  className="rounded border border-accent/40 bg-accent-soft px-1.5 py-1 text-accent hover:bg-accent-soft"
                                >
                                  <ClipboardPaste className="size-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-right align-top tabular">
                      <span className={cn('text-sm font-medium text-ink', empHours > 40 && 'text-warn')}>
                        {empHours.toFixed(1)}
                      </span>
                      <div className="text-[10px] text-ink-subtle">hrs</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-content text-xs uppercase tracking-wide text-ink-muted">
                <td className="sticky left-0 z-10 bg-content px-3 py-2 font-medium">Day total</td>
                {days.map((d) => {
                  const dayStr = fmtDay(d)
                  const h = hoursByDay.get(dayStr) ?? 0
                  return (
                    <td key={dayStr} className="px-2 py-2 text-center tabular font-medium text-ink">
                      {h > 0 ? h.toFixed(1) : '-'}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right tabular font-medium text-ink">
                  {totalHours.toFixed(1)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}

      {addFor && scheduleId && (
        <ShiftModal
          mode="add"
          scheduleId={scheduleId}
          employeeId={addFor.employeeId}
          date={addFor.date}
          positions={positions}
          defaultPosition={defaultPositionFor(addFor.employeeId)}
          onClose={() => setAddFor(null)}
          onSaved={(shift) => {
            setShifts((arr) => [...arr, shift])
            recordShift(hhmm(shift.start_time), hhmm(shift.end_time))
            setAddFor(null)
          }}
        />
      )}

      {editShift && (
        <ShiftModal
          mode="edit"
          scheduleId={editShift.schedule_id}
          employeeId={editShift.employee_id}
          date={editShift.date}
          shift={editShift}
          positions={positions}
          defaultPosition={editShift.role_label ?? defaultPositionFor(editShift.employee_id)}
          onClose={() => setEditShift(null)}
          onSaved={(shift) => {
            setShifts((arr) => arr.map((s) => (s.id === shift.id ? shift : s)))
            setEditShift(null)
          }}
          onDeleted={(id) => {
            setShifts((arr) => arr.filter((s) => s.id !== id))
            setEditShift(null)
          }}
        />
      )}

      {aiError && (
        <Modal open onClose={() => setAiError(null)} title="AI suggestion failed" size="sm">
          <p className="text-sm text-ink">{aiError}</p>
          <div className="mt-4 flex justify-end"><Button onClick={() => setAiError(null)}>OK</Button></div>
        </Modal>
      )}

      {aiResult && (
        <Modal open onClose={() => setAiResult(null)} title="AI suggested schedule" size="lg">
          <div className="flex flex-col gap-3">
            {aiResult.suggestions.length === 0 ? (
              <p className="text-sm text-ink-muted">Not enough recent history to draft a useful schedule yet. Add a couple weeks of shifts manually first and try again.</p>
            ) : (
              <>
                <p className="text-sm text-ink-muted">{aiResult.suggestions.length} suggested shift{aiResult.suggestions.length === 1 ? '' : 's'} based on the last few weeks of history. Review and apply, or close to dismiss.</p>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Day</th>
                        <th className="px-3 py-2 font-medium">Employee</th>
                        <th className="px-3 py-2 font-medium">Time</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiResult.suggestions.map((s, i) => {
                        const emp = aiResult.employees.find((e) => e.id === s.employee_id)
                        const date = addDays(weekStart, s.day_index)
                        return (
                          <tr key={i} className="border-t border-border">
                            <td className="px-3 py-2 text-ink">{format(date, 'EEE MMM d')}</td>
                            <td className="px-3 py-2 text-ink">{emp?.name ?? '-'}</td>
                            <td className="px-3 py-2 tabular text-ink-muted">{timeOfDay(s.start_time)} to {timeOfDay(s.end_time)}</td>
                            <td className="px-3 py-2 text-ink-muted">{s.role_label ?? '-'}</td>
                            <td className="px-3 py-2 text-xs text-ink-muted">{s.rationale ?? ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAiResult(null)}>Close</Button>
              {aiResult.suggestions.length > 0 && (
                <Button onClick={() => void applyAISuggestions()} disabled={aiBusy}>
                  {aiBusy ? 'Applying...' : 'Apply all'}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

type AISuggestion = {
  employee_id: string
  day_index: number
  start_time: string
  end_time: string
  role_label: string | null
  rationale?: string | null
}
type AISuggestionResult = {
  suggestions: AISuggestion[]
  employees: { id: string; name: string }[]
  model: string
  week_start: string
}

function ShiftModal({
  mode,
  scheduleId,
  employeeId,
  date,
  shift,
  positions,
  defaultPosition,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: 'add' | 'edit'
  scheduleId: string
  employeeId: string
  date: string
  shift?: Shift
  positions: string[]
  defaultPosition?: string | null
  onClose: () => void
  onSaved: (s: Shift) => void
  onDeleted?: (id: string) => void
}) {
  const [start, setStart] = useState(shift?.start_time?.slice(0, 5) ?? '08:00')
  const [end, setEnd] = useState(shift?.end_time?.slice(0, 5) ?? '16:00')
  // Position defaults to the shift's own, else the employee's default position.
  const [role, setRole] = useState(shift?.role_label ?? defaultPosition ?? '')
  const [notes, setNotes] = useState(shift?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError(null)
    setBusy(true)
    if (mode === 'add') {
      const { data, error: err } = await schedules.addShift({
        schedule_id: scheduleId, employee_id: employeeId, date,
        start_time: start, end_time: end, role_label: role.trim() || null,
        notes: notes.trim() || null,
      })
      setBusy(false)
      if (err || !data) return setError(err?.message ?? 'Failed')
      onSaved(data as Shift)
    } else if (shift) {
      const { data, error: err } = await schedules.updateShift(shift.id, {
        start_time: start, end_time: end, role_label: role.trim() || null, notes: notes.trim() || null,
      })
      setBusy(false)
      if (err || !data) return setError(err?.message ?? 'Failed')
      onSaved(data as Shift)
    }
  }

  const remove = async () => {
    if (!shift || !onDeleted) return
    if (!window.confirm('Remove this shift?')) return
    setBusy(true)
    await schedules.removeShift(shift.id)
    setBusy(false)
    onDeleted(shift.id)
  }

  const hours = hoursBetween(start, end)

  return (
    <Modal
      open
      onClose={onClose}
      title={`${mode === 'add' ? 'Add shift' : 'Edit shift'} . ${format(new Date(date + 'T00:00'), 'EEE MMM d')}`}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Start">{(id) => <TimeSelect id={id} value={start} onChange={setStart} />}</Field>
          <Field label="End">{(id) => <TimeSelect id={id} value={end} onChange={setEnd} />}</Field>
        </div>
        <div className="text-xs text-ink-muted">Duration: <span className="font-medium text-ink">{hours.toFixed(1)} hrs</span></div>
        <Field label="Position">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">No position</option>
              {role && !positions.includes(role) && <option value={role}>{role}</option>}
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Notes (optional)">
          {(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shift notes, training, etc." />}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {mode === 'edit' && onDeleted ? (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void remove()}>
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === 'add' ? 'Add shift' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

type Period = 'weekly' | 'biweekly' | 'monthly'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function readPeriod(): Period {
  try {
    const v = localStorage.getItem('schedule.period')
    if (v === 'biweekly' || v === 'monthly') return v
  } catch {
    /* ignore */
  }
  return 'weekly'
}

// Left-hand palette of the user's remembered shifts. Operator learns the shifts a
// user creates (by use count); drag a chip onto a cell to schedule it.
function ShiftPalette({
  favorites,
  onForget,
}: {
  favorites: ShiftFavorite[]
  onForget: (start: string, end: string) => void
}) {
  const chips = [...favorites]
    .sort((a, b) => b.count - a.count || (b.last_used > a.last_used ? 1 : -1))
    .slice(0, 12)
  return (
    <div className="rounded-lg border border-border bg-card p-3 lg:sticky lg:top-4 lg:w-52 lg:shrink-0">
      <h3 className="mb-1 text-sm font-semibold text-ink">Shifts</h3>
      {chips.length === 0 ? (
        <p className="text-xs text-ink-muted">Shifts you create show up here, with your most-used first, so you can drag them onto the schedule.</p>
      ) : (
        <>
          <p className="mb-2.5 text-xs text-ink-muted">Drag a shift onto the schedule.</p>
          <div className="flex flex-wrap gap-1.5 lg:flex-col">
            {chips.map((c) => (
              <div
                key={`${c.start}-${c.end}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(SHIFT_DND_TYPE, JSON.stringify({ start: c.start, end: c.end }))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                title={`${timeOfDay(c.start)} to ${timeOfDay(c.end)} · used ${c.count}×`}
                className="group flex cursor-grab items-center justify-between gap-2 rounded-md border border-border bg-content px-2.5 py-1.5 text-sm text-ink hover:border-accent active:cursor-grabbing"
              >
                <span className="font-medium tabular">{shiftChipLabel(c.start, c.end)}</span>
                <button
                  type="button"
                  onClick={() => onForget(c.start, c.end)}
                  title="Remove from palette"
                  className="rounded p-0.5 text-ink-subtle hover:text-danger lg:hidden lg:group-hover:block"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Manage the account's job positions (each employee gets a default position used
// to pre-fill their new shifts).
function PositionsModal({
  positions,
  onClose,
  onSave,
}: {
  positions: string[]
  onClose: () => void
  onSave: (next: string[]) => Promise<void> | void
}) {
  const [list, setList] = useState<string[]>(positions)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const add = () => {
    const v = input.trim()
    if (!v || list.some((p) => p.toLowerCase() === v.toLowerCase())) { setInput(''); return }
    setList((l) => [...l, v])
    setInput('')
  }

  return (
    <Modal open onClose={onClose} title="Positions" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Create the positions you schedule for (e.g. Cashier, Attendant, Detailer). Set each employee's default
          position on their row — new shifts use it, and you can still change a shift's position.
        </p>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            placeholder="Add a position…"
          />
          <Button variant="secondary" onClick={add}>Add</Button>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-ink-subtle">No positions yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((p) => (
              <li key={p} className="flex items-center justify-between rounded-md border border-border bg-content px-3 py-1.5 text-sm text-ink">
                {p}
                <button type="button" onClick={() => setList((l) => l.filter((x) => x !== p))} title="Remove" className="rounded p-0.5 text-ink-subtle hover:text-danger">
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => { setBusy(true); await onSave(list); setBusy(false) }}>
            {busy && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Manager scheduling surface. Owns the two knobs the user asked for -- the
// work-week start day (a per-account setting) and the planning period -- then
// stacks one WeekBlock per week in the visible range, with the shift palette
// on the left.
function Scheduler({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const { settings, reload: reloadCompany } = useCompany()
  const weekStartsOn = ((settings.scheduleWeekStart ?? 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const [period, setPeriod] = useState<Period>(readPeriod)
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [showWorkWeek, setShowWorkWeek] = useState(false)
  const [showPositions, setShowPositions] = useState(false)
  const [publicLink, setPublicLink] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  // Shared across all week blocks so a copied day can be pasted into any week.
  const [clipboard, setClipboard] = useState<DayClipboard | null>(null)

  // The hidden, link-only public page for viewing published schedules per site.
  const openPublicLink = async () => {
    if (!profile?.account_id) return
    setLinkBusy(true)
    const token = await schedulePortal.ensureToken(profile.account_id)
    setLinkBusy(false)
    if (token) setPublicLink(`${window.location.origin}/schedule/${token}`)
  }

  // Account positions (used as each employee's default when scheduling).
  const positions = settings.positions ?? []
  const savePositions = async (next: string[]) => {
    if (!profile?.account_id) return
    await updateCompany(profile.account_id, { settings: { ...settings, positions: next } })
    await reloadCompany()
    setShowPositions(false)
  }

  // Per-user remembered shifts — learned from the shifts this user creates, shown
  // in the palette. Loaded once; updated optimistically and persisted on change.
  const [favorites, setFavorites] = useState<ShiftFavorite[]>([])
  useEffect(() => {
    const uid = profile?.id
    if (!uid) return
    void shiftFavoritesQ.get(uid).then(setFavorites)
  }, [profile?.id])

  const persistFavorites = (next: ShiftFavorite[]) => {
    const uid = profile?.id
    if (uid) void shiftFavoritesQ.set(uid, next)
  }
  const recordShift = (start: string, end: string) => {
    setFavorites((prev) => {
      const next = prev.map((f) => ({ ...f }))
      const i = next.findIndex((f) => f.start === start && f.end === end)
      if (i >= 0) { next[i].count += 1; next[i].last_used = new Date().toISOString() }
      else next.push({ start, end, count: 1, last_used: new Date().toISOString() })
      next.sort((a, b) => b.count - a.count || (b.last_used > a.last_used ? 1 : -1))
      const trimmed = next.slice(0, 20)
      persistFavorites(trimmed)
      return trimmed
    })
  }
  const forgetShift = (start: string, end: string) => {
    setFavorites((prev) => {
      const next = prev.filter((f) => !(f.start === start && f.end === end))
      persistFavorites(next)
      return next
    })
  }

  const changePeriod = (p: Period) => {
    setPeriod(p)
    try {
      localStorage.setItem('schedule.period', p)
    } catch {
      /* ignore */
    }
  }

  // The list of week-start dates to render. Weekly is one week; bi-weekly is
  // two; monthly is every week that overlaps the anchor's month, aligned to the
  // chosen work-week start day.
  const weeks = useMemo(() => {
    const first = startOfWeek(anchor, { weekStartsOn })
    if (period === 'weekly') return [first]
    if (period === 'biweekly') return [first, addWeeks(first, 1)]
    const monthEnd = endOfMonth(anchor)
    const out: Date[] = []
    let w = startOfWeek(startOfMonth(anchor), { weekStartsOn })
    while (w <= monthEnd) {
      out.push(w)
      w = addWeeks(w, 1)
    }
    return out
  }, [anchor, period, weekStartsOn])

  const step = (dir: -1 | 1) => {
    setAnchor((a) =>
      period === 'monthly'
        ? dir === 1
          ? addMonths(a, 1)
          : subMonths(a, 1)
        : addWeeks(a, dir * (period === 'biweekly' ? 2 : 1)),
    )
  }

  const rangeLabel =
    period === 'monthly'
      ? format(anchor, 'MMMM yyyy')
      : `${format(weeks[0], 'MMM d')} to ${format(addDays(weeks[weeks.length - 1], 6), 'MMM d, yyyy')}`

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Schedule"
        subtitle="Shift planning. Set the work week and plan weekly, bi-weekly, or monthly."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={linkBusy} onClick={() => void openPublicLink()}>
              <Link2 className="size-4" /> Share link
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowPositions(true)}>
              <UsersRound className="size-4" /> Positions
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowWorkWeek(true)}>
              <CalendarCog className="size-4" /> Set work week
            </Button>
            <Select
              aria-label="Planning period"
              value={period}
              onChange={(e) => changePeriod(e.target.value as Period)}
              className="h-9 w-auto"
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => step(-1)}><ChevronLeft className="size-4" /></Button>
          <span className="min-w-[13rem] text-center text-sm font-medium text-ink">{rangeLabel}</span>
          <Button variant="secondary" size="icon" onClick={() => step(1)}><ChevronRight className="size-4" /></Button>
        </div>
        <span className="text-xs text-ink-muted">Work week starts {DAY_NAMES[weekStartsOn]}</span>
      </div>

      {clipboard && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent-soft/50 px-3 py-2 text-xs text-ink">
          <span>
            Copied {clipboard.shifts.length} shift{clipboard.shifts.length === 1 ? '' : 's'} from{' '}
            <span className="font-medium">{clipboard.label}</span>. Click the paste icon on any day to drop them in.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setClipboard(null)}>Clear</Button>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <ShiftPalette favorites={favorites} onForget={forgetShift} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {weeks.map((w) => (
            <WeekBlock
              key={fmtDay(w)}
              locationId={locationId}
              weekStart={w}
              clipboard={clipboard}
              setClipboard={setClipboard}
              positions={positions}
              recordShift={recordShift}
            />
          ))}
        </div>
      </div>

      {showWorkWeek && (
        <WorkWeekModal
          current={weekStartsOn}
          onClose={() => setShowWorkWeek(false)}
          onSaved={async (day) => {
            if (profile?.account_id) {
              await updateCompany(profile.account_id, {
                settings: { ...settings, scheduleWeekStart: day },
              })
              await reloadCompany()
            }
            setShowWorkWeek(false)
          }}
        />
      )}

      {publicLink && (
        <Modal open onClose={() => setPublicLink(null)} title="Public schedule link" size="sm">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Anyone with this link can view your <span className="font-medium text-ink">published</span> schedules by site —
              no login, and no access to the rest of Operator. Unpublished schedules never appear.
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={publicLink} onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="secondary"
                onClick={() => { void navigator.clipboard?.writeText(publicLink) }}
              >
                Copy
              </Button>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setPublicLink(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}

      {showPositions && (
        <PositionsModal
          positions={positions}
          onClose={() => setShowPositions(false)}
          onSave={savePositions}
        />
      )}
    </div>
  )
}

function WorkWeekModal({
  current,
  onClose,
  onSaved,
}: {
  current: number
  onClose: () => void
  onSaved: (day: number) => Promise<void> | void
}) {
  const [day, setDay] = useState(current)
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title="Set work week" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Choose which day your work week starts on. Schedules, hours, and labor totals are grouped by this day for everyone in your company.
        </p>
        <Field label="Work week starts on">
          {(id) => (
            <Select id={id} value={String(day)} onChange={(e) => setDay(Number(e.target.value))}>
              {DAY_NAMES.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onSaved(day)
              setBusy(false)
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Employees get a read-only view of their own published shifts. RLS already
// limits what they can see/write; this just gives them a clean personal view
// without the manager grid's edit/publish controls.
function MyScheduleView({ locationId }: { locationId: string }) {
  const { settings } = useCompany()
  const weekStartsOn = ((settings.scheduleWeekStart ?? 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const weekStart = useMemo(() => startOfWeek(anchor, { weekStartsOn }), [anchor, weekStartsOn])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [published, setPublished] = useState(false)
  const [loading, setLoading] = useState(true)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  useEffect(() => {
    let active = true
    setLoading(true)
    schedules.getWeek(locationId, fmtDay(weekStart)).then(async ({ data }) => {
      if (!active) return
      const sched = data as { id: string; published: boolean } | null
      setPublished(sched?.published ?? false)
      if (sched?.id) {
        const { data: sh } = await schedules.shifts(sched.id)
        if (active) setShifts((sh as Shift[] | null) ?? [])
      } else {
        setShifts([])
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [locationId, weekStart])

  const totalHours = shifts.reduce((a, s) => a + paidHours(s), 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My schedule" subtitle="Your shifts for the week." />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => setAnchor((a) => addWeeks(a, -1))}><ChevronLeft className="size-4" /></Button>
          <span className="text-sm font-medium text-ink">
            {format(weekStart, 'MMM d')} to {format(addDays(weekStart, 6), 'MMM d, yyyy')}
          </span>
          <Button variant="secondary" size="icon" onClick={() => setAnchor((a) => addWeeks(a, 1))}><ChevronRight className="size-4" /></Button>
        </div>
        <span className="tabular text-sm text-ink-muted">{totalHours.toFixed(1)} hrs</span>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : !published ? (
        <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-ink-muted">
          This week's schedule hasn't been published yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((d) => {
            const dayStr = fmtDay(d)
            const cell = shifts.filter((s) => s.date === dayStr)
            return (
              <div key={dayStr} className="rounded-md border border-border bg-card p-3">
                <div className="text-sm font-medium text-ink">{format(d, 'EEE')}</div>
                <div className="text-xs text-ink-muted">{format(d, 'MMM d')}</div>
                <div className="mt-2 flex flex-col gap-1">
                  {cell.length === 0 ? (
                    <span className="text-xs text-ink-subtle">Off</span>
                  ) : (
                    cell.map((s) => (
                      <span key={s.id} className="rounded bg-accent-soft px-1.5 py-1 text-xs text-accent">
                        {timeOfDay(s.start_time)} to {timeOfDay(s.end_time)}
                        {s.role_label && <span className="block text-[10px] text-ink-muted">{s.role_label}</span>}
                        {s.notes && <span className="block text-[10px] text-ink-muted">{s.notes}</span>}
                      </span>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function SchedulePage() {
  const { profile } = useAuth()
  return (
    <LocationGate>
      {(locationId) =>
        profile?.role === 'employee' ? (
          <MyScheduleView locationId={locationId} />
        ) : (
          <Scheduler locationId={locationId} />
        )
      }
    </LocationGate>
  )
}
