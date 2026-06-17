import { cn } from '@/lib/utils'

// A 12-hour AM/PM time picker that always renders the same regardless of the
// device's OS clock (native <input type="time"> follows the OS locale, which can
// be 24-hour). Value contract matches the old inputs: a 24-hour "HH:mm" string
// in, "HH:mm" out (or "" when allowEmpty and unset).
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

function parse(value: string | null | undefined): { h: number; min: number } | null {
  if (!value) return null
  const m = value.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (Number.isNaN(h) || Number.isNaN(min)) return null
  return { h, min }
}

function buildMinutes(step: number, include: number | null): number[] {
  const out: number[] = []
  for (let i = 0; i < 60; i += step) out.push(i)
  if (include != null && !out.includes(include)) {
    out.push(include)
    out.sort((a, b) => a - b)
  }
  return out
}

export function TimeSelect({
  id,
  value,
  onChange,
  allowEmpty = false,
  minuteStep = 5,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  allowEmpty?: boolean
  minuteStep?: number
}) {
  const parsed = parse(value)
  const has = parsed != null
  const h24 = parsed?.h ?? 9
  const min = parsed?.min ?? 0
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const minutes = buildMinutes(minuteStep, has ? min : null)

  // Compose a 24-hour "HH:mm" string from the three controls.
  const build = (nh12: number, nmin: number, nperiod: 'AM' | 'PM'): string => {
    let h = nh12 % 12
    if (nperiod === 'PM') h += 12
    return `${String(h).padStart(2, '0')}:${String(nmin).padStart(2, '0')}`
  }

  // Hide the native dropdown chevron across browsers. `appearance-none` alone
  // is not enough on Safari/iOS — they need the -webkit prefix, plus
  // background-image:none kills any UA-painted chevron. Without this the
  // chevron sits on top of the digits when three selects share a narrow modal
  // column. The selects still open natively on tap/click.
  const sel =
    'h-10 cursor-pointer rounded-md border border-border bg-card px-2 text-center text-sm text-ink ' +
    '[appearance:none] [-webkit-appearance:none] [-moz-appearance:none] [background-image:none] ' +
    '[&::-ms-expand]:hidden ' +
    'focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="flex w-full min-w-0 items-center gap-1.5">
      <select
        id={id}
        aria-label="Hour"
        className={cn(sel, 'min-w-0 flex-1')}
        value={has ? String(h12) : allowEmpty ? '' : String(h12)}
        onChange={(e) => {
          if (e.target.value === '') return onChange('')
          onChange(build(Number(e.target.value), has ? min : 0, has ? period : 'AM'))
        }}
      >
        {allowEmpty && <option value="">––</option>}
        {HOURS.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="shrink-0 text-ink-muted">:</span>
      <select
        aria-label="Minute"
        className={cn(sel, 'min-w-0 flex-1')}
        value={String(min)}
        disabled={!has}
        onChange={(e) => onChange(build(h12, Number(e.target.value), period))}
      >
        {minutes.map((mm) => (
          <option key={mm} value={mm}>{String(mm).padStart(2, '0')}</option>
        ))}
      </select>
      <select
        aria-label="AM or PM"
        className={cn(sel, 'min-w-0 flex-1')}
        value={period}
        disabled={!has}
        onChange={(e) => onChange(build(h12, min, e.target.value as 'AM' | 'PM'))}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
