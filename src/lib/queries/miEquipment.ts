import { supabase } from '@/lib/supabase'
import { miRpc, type AssetDetail } from '@/lib/queries/maintenanceInventory'

// Maintenance Inventory equipment (docs/maintenance-inventory/EQUIPMENT.md): the
// `equipment` table run the way IT Inventory runs devices. Every write is a
// role-checked database function; reads are one call per screen.

export type EquipmentStatus = 'online' | 'offline_planned' | 'offline_unplanned' | 'retired'
export type TagCondition = 'ok' | 'faded' | 'missing' | 'damaged'
export type StickerQueueRow = {
  id: string
  name: string
  type?: string
  location_id: string
  site_name: string
  area_name?: string
  tag?: string
  printed_count: number
  condition?: TagCondition
  reason: 'none' | 'never_printed' | 'faded' | 'missing' | 'damaged'
}
export type BlankBatch = { batch_id: string; site_id: string | null; site_name: string | null; created_at: string; count: number; first: string; last: string; printed: boolean; codes: string[] }
export type UsageBasis = 'all_cars' | 'packages' | 'none'

// One row of the list. Nulls are left out of the payload, so most fields are optional.
export type EquipmentRow = {
  id: string
  location_id: string
  name: string
  type?: string
  status: EquipmentStatus
  parent_id?: string
  area_id?: string
  crit_class?: 'A' | 'B' | 'C'
  manufacturer?: string
  model?: string
  serial_number?: string
  asset_number?: number
  install_date?: string
  warranty_expiry?: string
  last_serviced_at?: string
  last_audited_at?: string
  retired_at?: string
  usage_basis: UsageBasis
  maintainx_id?: number
  tag?: string
  tag_printed?: boolean
  tag_condition?: TagCondition
  on_diagram?: boolean
  children: number
  bom_lines: number
  open_wos: number
  usage_since?: string
  cars_since?: number
}

export type MiArea = { id: string; site_id: string; name: string; sort_order: number }
export type SiteCars = { id: string; name: string; site_number: number | null; cars_30d: number | null; data_through: string | null }
export type EquipmentList = { today: string; rows: EquipmentRow[]; areas: MiArea[]; sites: SiteCars[] }

export type UsageState = 'ok' | 'no_site_number' | 'no_data' | 'not_counted'
export type Usage = {
  asset_id: string
  basis: UsageBasis
  since: string | null
  since_source: 'install' | 'reset' | null
  cars_since: number | null
  cars_today: number
  cars_30d: number | null
  cars_12m: number | null
  cars_all: number | null
  data_from: string | null
  data_through: string | null
  state: UsageState
}

export type EquipmentDetail = Omit<AssetDetail, 'asset' | 'children'> & {
  asset: AssetDetail['asset'] & {
    status: EquipmentStatus
    asset_number: number | null
    usage_basis: UsageBasis
    last_audited_at: string | null
    last_serviced_at: string | null
    retired_at: string | null
    maintainx_id: number | null
    tag_printed_count: number
    tag_last_printed_at: string | null
    tag_condition: TagCondition | null
    site_number: number | null
    can_move_site: boolean
  }
  children: Array<{ id: string; name: string; type: string | null; status: EquipmentStatus; crit_class: string | null; children: number }>
  ancestors: Array<{ id: string; name: string }>
  usage: Usage | null
  resets: Array<{ id: string; on: string; notes: string | null; by: string | null }>
  diagram: Array<{ layout_id: string; item_id: string; label: string; tunnel_no: number; via_parent: boolean }>
}

export type TimelineItem =
  | { kind: 'event'; at: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string | null; by: string | null }
  | { kind: 'log'; at: string; id: string; entry_type: string; title: string; result: string; notes: string | null; by: string | null; resets_usage: boolean; voided: boolean; downtime_minutes: number | null; work_order_id: string | null }
  | { kind: 'wo'; what: 'opened' | 'closed'; at: string; id: string; number: number; title: string; status: string; by?: string | null }
  | { kind: 'part'; at: string; type: string; part_id: string; part_name: string; qty: number; cost: number; work_order_id: string | null }

export type EquipmentInput = {
  id?: string
  location_id?: string
  name?: string
  type?: string | null
  description?: string | null
  status?: Exclude<EquipmentStatus, 'retired'>
  parent_asset_id?: string | null
  area_id?: string | null
  area_name?: string | null
  vendor_id?: string | null
  crit_class?: string | null
  manufacturer?: string | null
  model?: string | null
  serial_number?: string | null
  purchase_date?: string | null
  install_date?: string | null
  warranty_expiry?: string | null
  usage_basis?: UsageBasis
}

export type SavedView = { id: string; user_id: string; name: string; params: Record<string, string>; is_shared: boolean }

export type EquipmentImportResult = {
  ok: boolean; committed: boolean; created: number; updated: number; errors: number
  rows: Array<{ row: number; status: 'create' | 'update' | 'error'; machine: string | null; site: string | null; message?: string }>
}

export type AuditResult ='not_checked' | 'found' | 'missing' | 'wrong_site' | 'unregistered'
export type AuditSummary = { expected: number; found: number; missing: number; moved: number; wrong_site: number; unregistered: number; stickers_bad: number; no_sticker: number }
export type AuditRunRow = {
  id: string; location_id: string; site_name: string; scope: 'all' | 'stickered'; status: 'in_progress' | 'completed' | 'cancelled'
  started_at: string; started_by_name: string | null; completed_at: string | null; completed_by_name: string | null
  summary: AuditSummary | null; progress: { checked: number; expected: number }
}
export type AuditsList = {
  sites: Array<{ id: string; name: string; machines: number; stickered: number; open_run: string | null; last_completed: string | null }>
  runs: AuditRunRow[]
}
export type AuditItem = {
  id: string; equipment_id?: string; tag?: string; expected: boolean; result: AuditResult; listed_area_id?: string; found_area_id?: string
  sticker_condition?: TagCondition; note?: string; checked_by_name?: string; checked_at?: string; name?: string; type?: string; other_site?: string
}
export type AuditDetail = {
  run: AuditRunRow & { note: string | null; can_cancel: boolean }
  areas: Array<{ id: string; name: string }>
  items: AuditItem[]
}
export type AuditScanResult =
  | { result: 'found'; code: string; item_id: string; name: string; unlisted?: boolean; again?: boolean; moved?: boolean }
  | { result: 'wrong_site'; code: string; item_id: string; name: string; other_site: string }
  | { result: 'unregistered'; code: string; item_id: string }
  | { result: 'blank' | 'retired'; code: string }

export const miEquipment = {
  list: (includeRetired = false) => miRpc<EquipmentList>('mi_equipment_list', { p_include_retired: includeRetired }),
  detail: (id: string) => miRpc<EquipmentDetail & { hidden?: boolean; message?: string }>('mi_equipment_detail', { p_asset: id }),
  save: (p: EquipmentInput) => miRpc<{ id: string; name: string }>('mi_equipment_save', { p }),
  clone: (id: string, count: number, withChildren: boolean, names?: string[]) =>
    miRpc<Array<{ id: string; name: string }>>('mi_equipment_clone', { p_asset: id, p_count: count, p_with_children: withChildren, p_names: names ?? null }),
  bulk: (ids: string[], op: 'status' | 'crit' | 'zone' | 'site', value: string) =>
    miRpc<{ changed: number }>('mi_equipment_bulk', { p_ids: ids, p_op: op, p_value: value }),
  retire: (ids: string[], note?: string) => miRpc<{ retired: number }>('mi_equipment_retire', { p_ids: ids, p_note: note ?? null }),
  restore: (ids: string[]) => miRpc<{ restored: number }>('mi_equipment_restore', { p_ids: ids }),
  timeline: (id: string, limit = 150) => miRpc<TimelineItem[]>('mi_equipment_timeline', { p_asset: id, p_limit: limit }),
  resetUsage: (id: string, on: string | null, note?: string) =>
    miRpc<{ ok: boolean; id: string }>('mi_reset_usage', { p_asset: id, p_on: on, p_note: note ?? null, p_client_txn_id: crypto.randomUUID() }),

  // Stickers
  stickerQueue: (site?: string | null) => miRpc<StickerQueueRow[]>('mi_sticker_queue', { p_site: site ?? null }),
  blankTags: (site?: string | null) => miRpc<BlankBatch[]>('mi_blank_tags', { p_site: site ?? null }),
  generateBlankTags: (count: number, site?: string | null) => miRpc<{ batch_id: string; codes: string[] }>('mi_generate_blank_tags', { p_count: count, p_site: site ?? null }),
  claimTag: (code: string, asset: string, replace = false) => miRpc<{ code: string; already?: boolean; replaced?: string | null }>('mi_claim_tag', { p_code: code, p_asset: asset, p_replace: replace }),
  retireTag: (code: string, reason?: string) => miRpc<void>('mi_retire_tag', { p_code: code, p_reason: reason ?? null }),
  setTagCondition: (codes: string[], condition: TagCondition) => miRpc<{ changed: number }>('mi_set_tag_condition', { p_codes: codes, p_condition: condition }),

  importEquipment: (rows: Array<Record<string, string>>, commit: boolean) => miRpc<EquipmentImportResult>('mi_import_equipment', { p_rows: rows, p_commit: commit }),

  // Audits
  audits: () => miRpc<AuditsList>('mi_audits_list'),
  auditStart: (site: string, scope: 'all' | 'stickered') => miRpc<string>('mi_audit_start', { p_site: site, p_scope: scope }),
  auditDetail: (run: string) => miRpc<AuditDetail>('mi_audit_detail', { p_run: run }),
  auditScan: (run: string, code: string, area?: string | null, condition?: TagCondition | null) =>
    miRpc<AuditScanResult>('mi_audit_scan', { p_run: run, p_code: code, p_area: area ?? null, p_condition: condition ?? null }),
  auditMark: (item: string, result: 'not_checked' | 'found' | 'missing', o: { condition?: TagCondition | null; area?: string | null; note?: string } = {}) =>
    miRpc<void>('mi_audit_mark', { p_item: item, p_result: result, p_condition: o.condition ?? null, p_area: o.area ?? null, p_note: o.note ?? null }),
  auditComplete: (run: string, note?: string, restMissing = false) => miRpc<AuditSummary>('mi_audit_complete', { p_run: run, p_note: note ?? null, p_rest_missing: restMissing }),
  auditCancel: (run: string) => miRpc<void>('mi_audit_cancel', { p_run: run }),

  savedViews: async (): Promise<SavedView[]> => {
    const { data, error } = await supabase.from('mi_saved_views').select('id, user_id, name, params, is_shared').eq('entity', 'equipment').order('name')
    if (error) throw new Error(error.message)
    return (data ?? []) as SavedView[]
  },
  saveView: async (row: { account_id: string; name: string; params: Record<string, string>; is_shared: boolean }) => {
    const { error } = await supabase.from('mi_saved_views').insert({ ...row, entity: 'equipment' })
    if (error) throw new Error(error.message)
  },
  deleteView: async (id: string) => {
    const { error } = await supabase.from('mi_saved_views').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}
