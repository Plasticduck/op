import { miRpc } from './maintenanceInventory'

// Maintenance Log (docs/maintenance-inventory/MAINTENANCE_LOG.md): schedules and the log
// of work done. Same access as Maintenance Inventory (mi_members). Logging a job goes
// through the offline queue (act('mi_log_add', ...)), so it isn't in here.

export type ScheduleStatus = 'overdue' | 'due' | 'soon' | 'ok' | 'paused'
export type TaskType = 'inspect' | 'lubricate' | 'clean' | 'replace' | 'adjust' | 'test' | 'other'
export type EntryType = 'preventive' | 'repair' | 'inspection' | 'cleaning' | 'lubrication' | 'replacement' | 'adjustment' | 'note'
export type EntryResult = 'ok' | 'follow_up' | 'failed' | 'skipped'
export type EveryUnit = 'days' | 'weeks' | 'months'

export type SchedulePart = { part_id: string; part_name: string; sku: string | null; uom: string | null; qty: number; available: number }
export type ScheduleRow = {
  id: string
  site_id: string
  site_name: string
  asset_id: string | null
  asset_name: string | null
  title: string
  instructions: string | null
  task_type: TaskType
  priority: 'low' | 'medium' | 'high'
  every_n: number | null
  every_unit: EveryUnit | null
  every_cars: number | null
  soon_days: number
  start_date: string
  last_done_at: string | null
  next_due_date: string | null
  assigned_user_id: string | null
  assigned_name: string | null
  auto_work_order: boolean
  active: boolean
  is_sample: boolean
  cars_since: number | null
  daily_cars: number | null
  cars_pct: number | null
  cars_due_on: string | null
  due_on: string | null
  days_left: number | null
  status: ScheduleStatus
  parts: SchedulePart[]
  parts_ready: boolean
  open_work_order: { id: string; number: number; status: string } | null
  done_count: number
}
export type ScheduleDetail = {
  schedule: ScheduleRow
  can_manage: boolean
  history: Array<{ id: string; performed_at: string; who: string | null; result: EntryResult; on_time: boolean | null; due_date: string | null; cars_since_last: number | null; notes: string | null; voided: boolean; work_order_number: number | null }>
}
export type ScheduleInput = {
  id?: string
  site_ids?: string[]
  asset_id?: string | null
  title: string
  instructions?: string
  task_type: TaskType
  priority: 'low' | 'medium' | 'high'
  every_n?: number | null
  every_unit?: EveryUnit | null
  every_cars?: number | null
  soon_days?: number
  next_due_date?: string | null
  start_date?: string | null
  last_done_on?: string | null
  assigned_user_id?: string | null
  auto_work_order?: boolean
  active?: boolean
  parts?: Array<{ part_id: string; qty: number }>
}

export type FeedKind = 'log' | 'work_order' | 'parts'
export type FeedRow = {
  kind: FeedKind
  id: string
  at: string
  site_id: string | null
  site_name: string | null
  asset_id: string | null
  asset_name: string | null
  title: string
  entry_type: EntryType | 'parts'
  result: EntryResult
  who: string | null
  notes: string | null
  labor_minutes?: number | null
  downtime_minutes?: number | null
  outside_cost?: number | null
  vendor_name?: string | null
  parts_cost: number | null
  parts_count: number | null
  photos?: number
  schedule_id?: string | null
  work_order_id?: string | null
  work_order_number?: number | null
  on_time?: boolean | null
  voided: boolean
  is_sample: boolean
  source?: string
  priority?: string
  part_id?: string
  location_name?: string
}
export type FeedFilter = {
  from?: string
  to?: string
  site_id?: string | null
  asset_id?: string | null
  schedule_id?: string | null
  q?: string
  kinds?: FeedKind[]
  limit?: number
  before?: string | null
  include_voided?: boolean
}
export type Feed = { rows: FeedRow[]; more: boolean; from: string; to: string }

export type EntryDetail = {
  entry: {
    id: string; site_id: string; asset_id: string | null; schedule_id: string | null; work_order_id: string | null
    entry_type: EntryType; title: string; notes: string | null; result: EntryResult; performed_at: string; performed_by: string | null; performed_by_name: string | null
    vendor_id: string | null; labor_minutes: number | null; downtime_minutes: number | null; outside_cost: number | null
    due_date: string | null; cars_since_last: number | null; on_time: boolean | null; source: string; is_sample: boolean; created_at: string
    voided_at: string | null; void_reason: string | null; voided_by_name: string | null
    site_name: string; asset_name: string | null; asset_status: string | null; schedule_title: string | null; vendor_name: string | null
    work_order: { id: string; number: number; status: string } | null
    follow_up: { id: string; number: number; status: string } | null
    can_edit: boolean; can_void: boolean
  }
  parts: Array<{ part_id: string | null; part_name: string; qty: number; unit_cost: number | null; cost: number; location_name: string | null }>
  parts_cost: number
  photos: Array<{ id: string; storage_path: string; file_name: string | null }>
}
export type LogInput = {
  site_id?: string | null
  asset_id?: string | null
  schedule_id?: string | null
  work_order_id?: string | null
  entry_type?: EntryType
  title?: string
  notes?: string
  result?: EntryResult
  performed_at?: string
  vendor_id?: string | null
  labor_minutes?: number | null
  downtime_minutes?: number | null
  outside_cost?: number | null
  asset_status?: string | null
  follow_up?: boolean
  parts?: Array<{ part_id: string; location_id: string; qty: number }>
  photos?: string[]
}
export type LogAddResult = { ok: true; id: string; parts: number; is_sample: boolean; work_order_id: string | null; work_order_number: number | null; follow_up: { id: string; number: number } | null; deduped?: boolean }

export type LogCounts = { overdue: number; due: number; soon: number }

export type ForecastRow = {
  site_id: string; site_name: string; part_id: string; part_name: string; sku: string | null; uom: string | null; is_critical: boolean
  need: number; available: number; on_order: number; short: number; first_due: string | null
  schedules: Array<{ schedule_id: string; title: string; times: number; qty: number; due_on: string | null }>
  vendor_id: string | null; vendor_name: string | null; unit_cost: number | null; pack_qty: number
  location_id: string | null; location_name: string | null; can_order: boolean
}

export type LogReport = {
  range: { from: string; to: string }
  scheduled_done: number
  skipped: number
  on_time_pct: number | null
  schedules_active: number
  overdue_now: number
  due_now: number
  entries: number
  work_orders_done: number
  repairs: number
  preventive: number
  labor_hours: number
  downtime_hours: number
  parts_cost: number
  outside_cost: number
  by_site: Array<{ site_id: string; site_name: string; scheduled_done: number; on_time_pct: number | null; overdue_now: number; repairs: number; parts_cost: number; outside_cost: number; labor_hours: number; downtime_hours: number; cars: number }>
  by_type: Record<string, number>
  top_assets: Array<{ asset_id: string; asset_name: string; site_name: string | null; cost: number; events: number }>
  repeat_problems: Array<{ asset_id: string; asset_name: string; site_name: string | null; count: number; last_at: string }>
  monthly: Array<{ month: string; preventive: number; repairs: number }>
}

export const ml = {
  feed: (f: FeedFilter) => miRpc<Feed>('mi_log_feed', { p: f }),
  entry: (id: string) => miRpc<EntryDetail>('mi_log_entry', { p_id: id }),
  update: (id: string, p: Partial<LogInput>) => miRpc<void>('mi_log_update', { p_id: id, p }),
  void: (id: string, reason: string) => miRpc<void>('mi_log_void', { p_id: id, p_reason: reason }),
  counts: () => miRpc<LogCounts>('mi_log_counts'),
  schedules: (o: { site?: string | null; asset?: string | null; part?: string | null; status?: 'attention' | 'paused' | null; q?: string } = {}) =>
    miRpc<ScheduleRow[]>('mi_schedules_list', { p_site: o.site ?? null, p_asset: o.asset ?? null, p_part: o.part ?? null, p_status: o.status ?? null, p_q: o.q ?? null }),
  schedule: (id: string) => miRpc<ScheduleDetail>('mi_schedule_detail', { p_id: id }),
  saveSchedule: (p: ScheduleInput) => miRpc<{ ids: string[]; created: number; matched_assets: number; missing_assets: number }>('mi_save_schedule', { p }),
  archiveSchedule: (id: string) => miRpc<void>('mi_archive_schedule', { p_id: id }),
  scheduleWorkOrder: (id: string) => miRpc<{ work_order_id: string; number: number; already_open: boolean }>('mi_schedule_work_order', { p_id: id }),
  forecast: (days: number, site?: string | null) => miRpc<ForecastRow[]>('mi_parts_forecast', { p_days: days, p_site: site ?? null }),
  report: (o: { from?: string; to?: string; site?: string | null }) => miRpc<LogReport>('mi_log_report', { p_from: o.from ?? null, p_to: o.to ?? null, p_site: o.site ?? null }),
}
