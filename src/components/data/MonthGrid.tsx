import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

export type MonthGridEvent = {
  id: string
  date: Date | string
  title: string
  tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'neutral'
  // Optional emoji shown before the title (used by the holiday calendar).
  emoji?: string
}

const TONE_BG: Record<NonNullable<MonthGridEvent['tone']>, string> = {
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-content text-ink-muted',
}

// Six-week calendar grid (Sun-Sat) for a given month. Click a day to dispatch
// onDayClick(date); click an event chip to dispatch onEventClick(event).
// Events without a clear "tone" default to accent. Each cell shows up to three
// chips and rolls the remainder into a "+N more" badge to keep the grid tight.
export function MonthGrid({
  month,
  events,
  onMonthChange,
  onDayClick,
  onEventClick,
  todayLabel = 'Today',
  rightSlot,
}: {
  month: Date
  events: MonthGridEvent[]
  onMonthChange: (next: Date) => void
  onDayClick?: (date: Date) => void
  onEventClick?: (event: MonthGridEvent) => void
  todayLabel?: string
  rightSlot?: React.ReactNode
}) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 })
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 })

  const days = useMemo(() => {
    const out: Date[] = []
    for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
      out.push(d)
    }
    return out
  }, [start, end])

  const today = new Date()

  const byDay = useMemo(() => {
    const m = new Map<string, MonthGridEvent[]>()
    for (const e of events) {
      const d = typeof e.date === 'string' ? new Date(e.date) : e.date
      const key = format(d, 'yyyy-MM-dd')
      const arr = m.get(key) ?? []
      arr.push(e)
      m.set(key, arr)
    }
    return m
  }, [events])

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-content px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[10ch] text-center text-sm font-semibold text-ink">
            {format(month, 'MMMM yyyy')}
          </span>
          <Button variant="secondary" size="icon" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onMonthChange(new Date())}>
            {todayLabel}
          </Button>
        </div>
        {rightSlot}
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-content text-center text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="px-2 py-1.5">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd')
          const inMonth = isSameMonth(d, month)
          const isToday = isSameDay(d, today)
          const dayEvents = byDay.get(key) ?? []
          const shown = dayEvents.slice(0, 3)
          const overflow = dayEvents.length - shown.length
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDayClick?.(d)}
              className={cn(
                'group flex min-h-[96px] flex-col items-stretch gap-1 border-b border-r border-border px-1.5 py-1.5 text-left transition',
                inMonth ? 'bg-card text-ink' : 'bg-content/40 text-ink-subtle',
                onDayClick && 'cursor-pointer hover:bg-accent-soft/40',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                    isToday ? 'bg-accent text-white' : 'text-ink',
                  )}
                >
                  {format(d, 'd')}
                </span>
                {overflow > 0 && (
                  <span className="rounded-full bg-border/70 px-1.5 text-[10px] text-ink-muted">+{overflow}</span>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {shown.map((e) => (
                  <span
                    key={e.id}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onEventClick?.(e)
                    }}
                    className={cn(
                      'truncate rounded px-1.5 py-0.5 text-[11px] font-medium',
                      TONE_BG[e.tone ?? 'accent'],
                      onEventClick && 'cursor-pointer hover:brightness-95',
                    )}
                  >
                    {e.emoji && <span className="mr-1">{e.emoji}</span>}
                    {e.title}
                  </span>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
