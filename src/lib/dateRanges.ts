import {
  startOfMonth, endOfMonth, subMonths,
  startOfYear, endOfYear, subYears, isWithinInterval,
} from 'date-fns'

// "Quick Reports" timeframes used across the Ops Suite.
export type RangeKey = 'all' | 'this-month' | 'last-month' | 'this-year' | 'last-year'

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'this-month', label: 'Current Month' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'this-year', label: 'Current Year' },
  { key: 'last-year', label: 'Last Year' },
]

export function rangeBounds(key: RangeKey, now = new Date()): { start: Date; end: Date } | null {
  switch (key) {
    case 'this-month': return { start: startOfMonth(now), end: endOfMonth(now) }
    case 'last-month': { const d = subMonths(now, 1); return { start: startOfMonth(d), end: endOfMonth(d) } }
    case 'this-year': return { start: startOfYear(now), end: endOfYear(now) }
    case 'last-year': { const d = subYears(now, 1); return { start: startOfYear(d), end: endOfYear(d) } }
    case 'all': default: return null
  }
}

export function inRange(d: string | Date | null | undefined, key: RangeKey): boolean {
  const b = rangeBounds(key)
  if (!b) return true
  if (!d) return false
  return isWithinInterval(new Date(d), b)
}

export function rangeLabel(key: RangeKey): string {
  return RANGE_OPTIONS.find((r) => r.key === key)?.label ?? 'All time'
}
