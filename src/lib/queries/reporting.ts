import { supabase } from '@/lib/supabase'

// Shared queries for the MaintainX-style Reporting page. All queries are
// scoped to the caller's account via existing RLS; the date-range params are
// applied to created_at / completed_at as appropriate.

export type DateRange = { from: string; to: string } // ISO strings

export const reporting = {
  // All work orders in the range with the minimum metadata needed by the
  // various Work Orders tab tiles.
  workOrdersInRange: (r: DateRange) =>
    supabase
      .from('work_orders')
      .select('id, number, title, status, priority, work_type, recurrence, created_at, completed_at, location_id, equipment_id')
      .gte('created_at', r.from)
      .lte('created_at', r.to)
      .order('created_at', { ascending: false }),

  // All completed work orders in the range (by completed_at, not created_at)
  // — needed for the "Created vs. Completed" chart's right side.
  workOrdersCompletedInRange: (r: DateRange) =>
    supabase
      .from('work_orders')
      .select('id, completed_at, created_at, work_type')
      .gte('completed_at', r.from)
      .lte('completed_at', r.to)
      .not('completed_at', 'is', null),

  // Assets with their open work order count for the Asset Health tab.
  assetsWithMetrics: () =>
    supabase
      .from('equipment')
      .select(`
        id, asset_number, name, type, status, criticality,
        location:locations(id, name),
        open_wo:work_orders!equipment_id(count),
        all_wo:work_orders!equipment_id(id, status, completed_at, created_at)
      `)
      .order('asset_number'),

  // Recent activity = a window of comments + their parent WO title for the
  // feed. Returned newest first.
  recentActivity: (r: DateRange, limit = 100) =>
    supabase
      .from('work_order_comments')
      .select('id, body, kind, user_name, created_at, work_order:work_orders(id, number, title)')
      .gte('created_at', r.from)
      .lte('created_at', r.to)
      .order('created_at', { ascending: false })
      .limit(limit),

  // For the Time to Complete tile we want the per-WO time entries summed.
  timeEntriesInRange: (r: DateRange) =>
    supabase
      .from('work_order_time_entries')
      .select('id, work_order_id, minutes, created_at')
      .gte('created_at', r.from)
      .lte('created_at', r.to),
}

// ---- Pure helpers --------------------------------------------------------

export type WoStatus = 'open' | 'on_hold' | 'in_progress' | 'done' | 'skipped'

export function statusCounts(rows: Array<{ status: string }>): Record<WoStatus, number> {
  const out: Record<WoStatus, number> = { open: 0, on_hold: 0, in_progress: 0, done: 0, skipped: 0 }
  for (const r of rows) {
    if (r.status in out) out[r.status as WoStatus]++
  }
  return out
}

export function workTypeCounts(rows: Array<{ work_type: string }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[r.work_type] = (out[r.work_type] ?? 0) + 1
  return out
}

export function repeatingCounts(rows: Array<{ recurrence: string }>): { repeating: number; nonRepeating: number } {
  let repeating = 0, nonRepeating = 0
  for (const r of rows) {
    if (r.recurrence && r.recurrence !== 'none') repeating++
    else nonRepeating++
  }
  return { repeating, nonRepeating }
}

// Bucket rows by week starting on the from-date for nice chart bars.
export function bucketByWeek<T extends { created_at: string }>(
  rows: T[], from: string, to: string,
): Array<{ weekStart: Date; count: number }> {
  const fromD = new Date(from)
  const toD = new Date(to)
  const buckets: Array<{ weekStart: Date; count: number }> = []
  for (let d = new Date(fromD); d <= toD; d = new Date(d.getTime() + 7 * 86400000)) {
    buckets.push({ weekStart: new Date(d), count: 0 })
  }
  if (buckets.length === 0) return buckets
  for (const r of rows) {
    const t = new Date(r.created_at).getTime()
    let idx = Math.floor((t - fromD.getTime()) / (7 * 86400000))
    if (idx < 0) idx = 0
    if (idx >= buckets.length) idx = buckets.length - 1
    buckets[idx].count++
  }
  return buckets
}

export function bucketCompletedByWeek<T extends { completed_at: string | null }>(
  rows: T[], from: string, to: string,
): Array<{ weekStart: Date; count: number }> {
  const completed = rows.filter((r) => r.completed_at).map((r) => ({ created_at: r.completed_at as string }))
  return bucketByWeek(completed, from, to)
}
