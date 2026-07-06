import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarCog,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Loader2,
  Plus,
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
import { updateCompany, type ShiftTemplate } from '@/lib/queries/companySettings'
import {
  employees as empQ,
  schedules,
  type Employee,
  type Shift,
  type TimeOffRequest,
} from '@/lib/queries/people'

const fmtDay = (d: Date) => format(d, 'yyyy-MM-dd')
const hoursBetween = (s: string, e: string) => {
  const [sh, sm] = s.split(':').map(Number)
  const [eh, em] = e.split(':').map(Number)
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60)
}

const PRESETS: { label: string; start: string; end: string }[] = [
  { label: 'Open 6 to 2', start: '06:00', end: '14:00' },
  { label: 'Mid 10 to 6', start: '10:00', end: '18:00' },
  { label: 'Close 2 to 10', start: '14:00', end: '22:00' },
  { label: 'Full 6 to 10', start: '06:00', end: '22:00' },
]

// Drag payload type for a shift preset dragged from the palette onto a cell.
const SHIFT_DND_TYPE = 'application/shift-template'

// Lunch shifts are marked with this role_label sentinel. They are unpaid breaks:
// present on the schedule but excluded from all hour and labor totals.
const LUNCH_LABEL = 'Lunch'
const isLunchShift = (s: { role_label?: string | null }) =>
  (s.role_label ?? '').trim().toLowerCase() === LUNCH_LABEL.toLowerCase()
// Hours a shift contributes to totals: zero for lunch/unpaid breaks.
const paidHours = (s: Shift) => (isLunchShift(s) ? 0 : hoursBetween(s.start_time, s.end_time))

// Built-in shift presets shown in the palette. Anything beyond these is a custom
// shift the user creates. Times are 24h "HH:MM". Lunch presets don't count hours.
const DEFAULT_SHIFTS: { start: string; end: string; lunch?: boolean }[] = [
  { start: '08:00', end: '14:00' }, // 8-2
  { start: '14:00', end: '20:00' }, // 2-8
  { start: '07:00', end: '15:00' }, // 7-3
  { start: '15:00', end: '20:00' }, // 3-8
  { start: '07:00', end: '19:00' }, // 7-7
  { start: '08:00', end: '20:00' }, // 8-8
  { start: '14:00', end: '19:00' }, // 2-7
  { start: '07:00', end: '12:00' }, // 7-12
  { start: '12:00', end: '19:00' }, // 12-7
  { start: '12:00', end: '20:00' }, // 12-8
  { start: '11:00', end: '12:00', lunch: true }, // LUNCH 11-12
  { start: '12:00', end: '13:00', lunch: true }, // LUNCH 12-1
  { start: '13:00', end: '14:00', lunch: true }, // LUNCH 1-2
  { start: '14:00', end: '15:00', lunch: true }, // LUNCH 2-3
]

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
}: {
  locationId: string
  weekStart: Date
  clipboard: DayClipboard | null
  setClipboard: (c: DayClipboard | null) => void
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

  // Dropping an employee chip onto a day creates a new shift with a sane default
  // length. Picks the most popular existing duration this employee has, else 8 to 4.
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
      role_label: null,
      notes: null,
    })
    if (data) setShifts((arr) => [...arr, data as Shift])
  }

  // Dropping a shift preset from the palette creates a shift with that preset's
  // exact start/end time.
  const createShiftFromTemplate = async (
    employeeId: string,
    date: string,
    start: string,
    end: string,
    lunch: boolean,
  ) => {
    if (!scheduleId) return
    const { data } = await schedules.addShift({
      schedule_id: scheduleId,
      employee_id: employeeId,
      date,
      start_time: start,
      end_time: end,
      role_label: lunch ? LUNCH_LABEL : null,
      notes: null,
    })
    if (data) setShifts((arr) => [...arr, data as Shift])
  }

  const onDropCell = (employeeId: string, date: string) => async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    // A shift preset dragged from the palette carries its time in dataTransfer.
    const tplRaw = e.dataTransfer.getData(SHIFT_DND_TYPE)
    if (tplRaw) {
      try {
        const tpl = JSON.parse(tplRaw) as { start: string; end: string; lunch?: boolean }
        await createShiftFromTemplate(employeeId, date, tpl.start, tpl.end, !!tpl.lunch)
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
          <Button variant="secondary" size="sm" onClick={togglePublish}>{published ? 'Unpublish' : 'Publish'}</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : emps.length === 0 ? (
        <p className="text-sm text-ink-muted">Add active employees first to build a schedule.</p>
      ) : (
        <>
        <div className="rounded-md border border-accent/20 bg-accent-soft/40 px-3 py-2 text-xs text-ink-muted">
          <span className="font-medium text-accent">Tip:</span> Drag a shift preset from the left onto a cell to schedule it. Drag an existing shift to move it, or an employee's name onto a day to create one.
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
                        <div className="text-xs text-ink-muted">{emp.role_title ?? ''}</div>
                      </div>
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
          onClose={() => setAddFor(null)}
          onSaved={(shift) => { setShifts((arr) => [...arr, shift]); setAddFor(null) }}
        />
      )}

      {editShift && (
        <ShiftModal
          mode="edit"
          scheduleId={editShift.schedule_id}
          employeeId={editShift.employee_id}
          date={editShift.date}
          shift={editShift}
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
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: 'add' | 'edit'
  scheduleId: string
  employeeId: string
  date: string
  shift?: Shift
  onClose: () => void
  onSaved: (s: Shift) => void
  onDeleted?: (id: string) => void
}) {
  const [start, setStart] = useState(shift?.start_time?.slice(0, 5) ?? '08:00')
  const [end, setEnd] = useState(shift?.end_time?.slice(0, 5) ?? '16:00')
  const [role, setRole] = useState(shift?.role_label ?? '')
  const [notes, setNotes] = useState(shift?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applyPreset = (p: typeof PRESETS[number]) => {
    setStart(p.start)
    setEnd(p.end)
  }

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
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Quick presets</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-ink-muted hover:border-accent hover:text-accent"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Start">{(id) => <TimeSelect id={id} value={start} onChange={setStart} />}</Field>
          <Field label="End">{(id) => <TimeSelect id={id} value={end} onChange={setEnd} />}</Field>
        </div>
        <div className="text-xs text-ink-muted">Duration: <span className="font-medium text-ink">{hours.toFixed(1)} hrs</span></div>
        <Field label="Role label">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">None</option>
              <option>Wash</option>
              <option>Detail</option>
              <option>Cashier</option>
              <option>Manager</option>
              <option value="Lunch">Lunch (unpaid, not counted)</option>
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

// Left-hand palette of draggable shift presets (built-in + custom). Dragging a
// chip onto a schedule cell creates a shift with that exact time.
function ShiftPalette({
  custom,
  onCreate,
  onDelete,
}: {
  custom: ShiftTemplate[]
  onCreate: () => void
  onDelete: (id: string) => void
}) {
  const chips = [
    ...DEFAULT_SHIFTS.map((s) => ({
      key: `${s.start}-${s.end}-${s.lunch ? 'L' : ''}`,
      start: s.start,
      end: s.end,
      lunch: !!s.lunch,
      label: shiftChipLabel(s.start, s.end, s.lunch),
      customId: null as string | null,
    })),
    ...custom.map((s) => ({
      key: s.id,
      start: s.start,
      end: s.end,
      lunch: !!s.lunch,
      label: s.label?.trim() || shiftChipLabel(s.start, s.end, s.lunch),
      customId: s.id,
    })),
  ]
  return (
    <div className="rounded-lg border border-border bg-card p-3 lg:sticky lg:top-4 lg:w-52 lg:shrink-0">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Shifts</h3>
        <Button size="sm" variant="secondary" onClick={onCreate}>
          <Plus className="size-4" /> Create
        </Button>
      </div>
      <p className="mb-2.5 text-xs text-ink-muted">Drag a shift onto the schedule.</p>
      <div className="flex flex-wrap gap-1.5 lg:flex-col">
        {chips.map((c) => (
          <div
            key={c.key}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                SHIFT_DND_TYPE,
                JSON.stringify({ start: c.start, end: c.end, lunch: c.lunch }),
              )
              e.dataTransfer.effectAllowed = 'copy'
            }}
            title={`${timeOfDay(c.start)} to ${timeOfDay(c.end)}${c.lunch ? ' (unpaid, not counted)' : ''}`}
            className={cn(
              'group flex cursor-grab items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:border-accent active:cursor-grabbing',
              c.lunch
                ? 'border-warn/40 bg-warn-soft text-warn'
                : 'border-border bg-content text-ink',
            )}
          >
            <span className="font-medium tabular">{c.label}</span>
            {c.customId && (
              <button
                type="button"
                onClick={() => onDelete(c.customId!)}
                title="Delete custom shift"
                className="rounded p-0.5 text-ink-subtle hover:text-danger lg:hidden lg:group-hover:block"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function CreateShiftModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (t: { start: string; end: string; label?: string; lunch?: boolean }) => Promise<void> | void
}) {
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('16:00')
  const [label, setLabel] = useState('')
  const [lunch, setLunch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dur = hoursBetween(start, end)

  return (
    <Modal open onClose={onClose} title="Create a shift" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Add a reusable shift preset. It appears in the palette so you can drag it onto the schedule.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Start">{(id) => <TimeSelect id={id} value={start} onChange={setStart} />}</Field>
          <Field label="End">{(id) => <TimeSelect id={id} value={end} onChange={setEnd} />}</Field>
        </div>
        <div className="text-xs text-ink-muted">
          Duration: <span className="font-medium text-ink">{dur.toFixed(1)} hrs</span>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={lunch}
            onChange={(e) => setLunch(e.target.checked)}
          />
          <span>
            Lunch break
            <span className="block text-xs text-ink-muted">
              Unpaid. Shows on the schedule but does not count toward hours or labor.
            </span>
          </span>
        </label>
        <Field label="Label (optional)" hint={lunch ? 'Defaults to a label like LUNCH 12-1.' : 'Defaults to a short time label like 8-2.'}>
          {(id) => (
            <Input
              id={id}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={shiftChipLabel(start, end, lunch)}
            />
          )}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (dur <= 0) return setError('End time must be after start time')
              setBusy(true)
              await onSave({ start, end, label: label.trim() || undefined, lunch: lunch || undefined })
              setBusy(false)
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Add shift
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
  const [showCreateShift, setShowCreateShift] = useState(false)
  // Shared across all week blocks so a copied day can be pasted into any week.
  const [clipboard, setClipboard] = useState<DayClipboard | null>(null)
  const templates = settings.shiftTemplates ?? []

  const persistTemplates = async (next: ShiftTemplate[]) => {
    if (!profile?.account_id) return
    await updateCompany(profile.account_id, { settings: { ...settings, shiftTemplates: next } })
    await reloadCompany()
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
        <ShiftPalette
          custom={templates}
          onCreate={() => setShowCreateShift(true)}
          onDelete={(id) => void persistTemplates(templates.filter((t) => t.id !== id))}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {weeks.map((w) => (
            <WeekBlock
              key={fmtDay(w)}
              locationId={locationId}
              weekStart={w}
              clipboard={clipboard}
              setClipboard={setClipboard}
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

      {showCreateShift && (
        <CreateShiftModal
          onClose={() => setShowCreateShift(false)}
          onSave={async (t) => {
            await persistTemplates([
              ...templates,
              { id: crypto.randomUUID(), start: t.start, end: t.end, label: t.label, lunch: t.lunch },
            ])
            setShowCreateShift(false)
          }}
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
