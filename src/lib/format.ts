import { format, formatDistanceToNow } from 'date-fns'

export function currency(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

export function shortDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return format(new Date(d), 'MMM d, yyyy')
}

export function dateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return format(new Date(d), 'MMM d, yyyy h:mm a')
}

// 12-hour AM/PM rendering of a wall-clock time string ("14:30" or "14:30:00").
// These come from Postgres `time` columns (shift start/end, closeout) which are
// timezone-less, so they're reformatted but not shifted.
export function timeOfDay(t: string | null | undefined): string {
  if (!t) return '—'
  const [hRaw, mRaw] = t.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw ?? 0)
  if (Number.isNaN(h)) return t
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(Number.isNaN(m) ? 0 : m).padStart(2, '0')} ${period}`
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return formatDistanceToNow(new Date(d), { addSuffix: true })
}

// Whole-hours-and-minutes duration between two instants.
export function durationHm(start: string | Date, end: string | Date): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return '—'
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
