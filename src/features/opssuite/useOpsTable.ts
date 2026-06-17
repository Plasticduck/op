import { useMemo, useState } from 'react'
import { inRange, type RangeKey } from '@/lib/dateRanges'

export type SortKey = 'newest' | 'oldest'

// Shared list state for every Ops Suite page: a Quick-Reports timeframe filter
// plus newest/oldest sorting, both keyed off one date accessor per page.
export function useOpsTable<T>(rows: T[], dateOf: (row: T) => string | null | undefined) {
  const [range, setRange] = useState<RangeKey>('all')
  const [sort, setSort] = useState<SortKey>('newest')

  const processed = useMemo(() => {
    const filtered = rows.filter((r) => inRange(dateOf(r), range))
    const dir = sort === 'newest' ? -1 : 1
    return [...filtered].sort((a, b) => {
      const ta = dateOf(a) ? new Date(dateOf(a) as string).getTime() : 0
      const tb = dateOf(b) ? new Date(dateOf(b) as string).getTime() : 0
      return (ta - tb) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range, sort])

  return { range, setRange, sort, setSort, rows: processed }
}
