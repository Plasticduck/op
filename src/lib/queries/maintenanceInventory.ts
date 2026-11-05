import { supabase } from '@/lib/supabase'

// Maintenance Inventory (docs/maintenance-inventory). Stock never changes from here
// directly: every change is a role-checked database function. Reads are mostly
// one-call screen functions (mi_home, mi_part_detail...) so phones stay quick.

export type MiRole = 'site_tech' | 'site_manager' | 'regional_manager' | 'corporate_maintenance_director' | 'admin'
export const MI_ROLE_LABEL: Record<MiRole, string> = {
  site_tech: 'Site tech',
  site_manager: 'Site manager',
  regional_manager: 'Regional manager',
  corporate_maintenance_director: 'Corporate maintenance director',
  admin: 'Admin',
}

export type MiSettings = {
  account_id: string
  sms_enabled: boolean
  quiet_start_hour: number
  quiet_end_hour: number
  timezone: string
  count_variance_threshold: number
  count_tolerance_pct: number
  po_limits: Record<string, number>
  stale_days: number
  carrying_rate: number
  auto_counts_enabled: boolean
  count_schedule: { critical_days: number; a_days: number; b_days: number; c_days: number }
  high_value_photo_cost: number | null
}

export type MiMe =
  | { member: false }
  | { member: true; role: MiRole; rank: number; site_ids: string[]; region_names: string[]; my_regions: string[]; settings: MiSettings; has_sample_data: boolean }

export type MiLocationType = 'stockroom' | 'cabinet' | 'truck' | 'regional_warehouse'
export type MiLocation = {
  id: string
  name: string
  type: MiLocationType
  site_id: string | null
  region_name: string | null
  active: boolean
  assigned_user_id: string | null
  is_sample: boolean
  can_act: boolean
  can_manage: boolean
}
export type MiPerson = { id: string; name: string; email: string | null; role: MiRole; site_ids: string[]; region_names: string[]; has_phone: boolean }
export type MiRefs = {
  sites: Array<{ id: string; name: string }>
  locations: MiLocation[]
  bins: Array<{ id: string; name: string; location_id: string }>
  categories: Array<{ id: string; name: string }>
  vendors: Array<{ id: string; name: string; email: string | null }>
  people: MiPerson[]
  regions: string[]
}

export type StockRow = {
  part_id: string
  part_name: string
  sku: string | null
  uom: string | null
  is_critical: boolean
  photo_path: string | null
  location_id: string
  location_name: string
  site_id: string | null
  site_name: string | null
  bin_id: string | null
  bin_name: string | null
  on_hand: number
  reserved: number
  available: number
  min_qty: number | null
  max_qty: number | null
  avg_cost: number
  can_act: boolean
  reorder_point?: number | null
  on_order?: number
  last_moved_at?: string | null
  can_manage?: boolean
}

export type ScanResult =
  | { kind: 'bin'; code: string; id: string; name: string; location_id: string; location_name: string; site_id: string | null; can_act: boolean; stock: StockRow[] }
  | { kind: 'part'; code: string; id: string; name: string; stock: StockRow[] }
  | { kind: 'tool' | 'asset' | 'location' | 'po'; code: string; id: string }
  | { kind: 'other_site'; code: string; message: string }
  | { kind: 'unknown'; raw: string }

export type ToolStatus = 'available' | 'checked_out' | 'in_repair' | 'lost' | 'retired'
export type ToolCondition = 'good' | 'needs_repair' | 'damaged' | 'missing_parts'
export type ToolRow = {
  id: string
  name: string
  category: string | null
  serial_number: string | null
  status: ToolStatus
  condition: ToolCondition
  due_at: string | null
  overdue: boolean | null
  custodian: string | null
  custodian_is_me: boolean | null
  home_name: string | null
  pending: boolean
}
export type ToolDetail = {
  hidden?: boolean
  message?: string
  tool: ToolRow & {
    make: string | null
    model: string | null
    cost: number | null
    notes: string | null
    home_location_id: string
    pending_to: string | null
    tag: string | null
    can_accept: boolean | null
    holds_it: boolean | null
    can_manage: boolean
  }
  chain: Array<{ id: string; action: string; created_at: string; condition: string | null; status: string | null; due_at: string | null; notes: string | null; from: string | null; to: string | null; by: string | null }>
}

export type PartListRow = {
  id: string
  name: string
  sku: string | null
  manufacturer: string | null
  mfr_part_number: string | null
  uom: string | null
  is_critical: boolean
  abc_class: string | null
  photo_path: string | null
  is_sample: boolean
  category: string | null
  on_hand: number
  available: number
  locations: number
  low: boolean
  value: number
}
export type PartDetail = {
  part: PartListRow & {
    description: string | null
    barcode: string | null
    pack_qty: number
    lead_time_days: number | null
    unit_cost: number | null
    category_id: string | null
    stale_days: number | null
    spec: Record<string, unknown>
    link_url: string | null
    sku_legacy_dup: boolean
  }
  stock: StockRow[]
  elsewhere: Elsewhere[]
  vendors: Array<{ id: string; vendor_id: string; vendor_name: string; vendor_part_number: string | null; price: number | null; pack_qty: number; lead_time_days: number | null; preferred: boolean }>
  assets: Array<{ id: string; name: string; site_name: string; qty_per: number }>
  history: Array<{ id: string; type: string; qty: number; qty_after: number; unit_cost: number; created_at: string; reason_code: string | null; notes: string | null; location_name: string; by: string | null; work_order_id: string | null; work_order_number: number | null; asset_name: string | null }>
  attachments: Array<{ id: string; storage_path: string; file_name: string | null; kind: string; created_at: string }>
}
export type Elsewhere = { location_id: string; location_name: string; site_name: string | null; type: string; available: number; max_qty: number | null }

export type ConsumeContext = {
  work_orders: Array<{ id: string; number: number; title: string; equipment_id: string | null; asset_name: string | null; rank: number }>
  assets: Array<{ id: string; name: string; qty_per: number }>
  elsewhere: Elsewhere[]
}

export type HomeData = {
  my_tools: Array<{ id: string; name: string; status: ToolStatus; due_at: string | null; overdue: boolean | null }>
  handoffs: Array<{ id: string; name: string; from: string | null }>
  my_work_orders: Array<{ id: string; number: number; title: string; site_name: string; priority: string; asset_name: string | null }>
  low_stock: StockRow[]
  low_stock_total: number
  to_do: Record<'transfers_to_approve' | 'transfers_to_ship' | 'transfers_to_receive' | 'counts_open' | 'counts_to_review' | 'pos_to_approve' | 'pos_to_receive' | 'part_requests', number>
}

export type AssetRow = { id: string; name: string; type: string | null; status: string; parent_id: string | null; crit_class: string | null; area_id: string | null; area_name: string | null; bom_lines: number }
export type AssetDetail = {
  hidden?: boolean
  message?: string
  asset: {
    id: string; name: string; type: string | null; status: string; description: string | null; location_id: string; manufacturer: string | null; model: string | null; serial_number: string | null
    install_date: string | null; purchase_date: string | null; warranty_expiry: string | null; crit_class: string | null; area_id: string | null; vendor_id: string | null
    site_name: string; area_name: string | null; vendor_name: string | null; parent_name: string | null; parent_asset_id: string | null; tag: string | null; can_manage: boolean
  }
  children: Array<{ id: string; name: string }>
  bom: Array<{ part_id: string; part_name: string; sku: string | null; qty_per: number; is_critical: boolean; on_hand_at_site: number }>
  open_work_orders: Array<{ id: string; number: number; title: string; status: string; priority: string }>
  service_history: Array<{ id: string; number: number; title: string; status: string; completed_at: string | null; created_at: string }>
  parts_cost: number
  parts_used: Array<{ part_id: string; part_name: string; qty: number; cost: number; created_at: string; type: string }>
}

export type WoRow = { id: string; number: number; title: string; status: string; priority: string; site_name: string; asset_name: string | null; created_at: string; parts_lines: number; parts_cost: number }
export type WoDetail = {
  work_order: { id: string; number: number; title: string; description: string | null; status: string; priority: string; location_id: string; equipment_id: string | null; site_name: string; asset_name: string | null }
  parts: Array<{ id: string; part_id: string | null; part_name: string; qty_planned: number; qty_issued: number; qty_returned: number; quantity: number; unit_cost: number | null; cost: number; location_id: string | null; location_name: string | null }>
  parts_cost: number
  bom: Array<{ part_id: string; part_name: string; qty_per: number }>
  locations: Array<{ id: string; name: string }>
}

export type Suggestion = {
  part_id: string; part_name: string; sku: string | null; is_critical: boolean; uom: string | null
  location_id: string; location_name: string; site_name: string | null
  available: number; on_order: number; reorder_point: number; min_qty: number | null; max_qty: number | null
  vendor_id: string | null; vendor_name: string | null; vendor_part_number: string | null; pack_qty: number; lead_time_days: number | null; unit_cost: number | null
  suggested_qty: number
  overstock: Array<{ location_id: string; location_name: string; site_name: string | null; excess: number }>
}

export type PoStatus = 'draft' | 'submitted' | 'approved' | 'sent' | 'partially_received' | 'received' | 'closed' | 'cancelled'
export type PoRow = { id: string; number: number; status: PoStatus; urgent: boolean; vendor_name: string; location_name: string; created_at: string; total: number; lines: number; is_sample: boolean }
export type PoDetail = {
  po: { id: string; number: number; status: PoStatus; urgent: boolean; notes: string | null; created_at: string; sent_to: string | null; sent_at: string | null; total: number; can_manage: boolean; can_receive: boolean; can_approve: boolean; approval_limit: number | null; ship_to_location_id: string; vendor_id: string }
  vendor: { id: string; name: string; email: string | null; phone: string | null; address: string | null }
  location: { id: string; name: string; site_name: string | null; address: string | null }
  lines: Array<{ id: string; part_id: string; part_name: string; sku: string | null; uom: string | null; vendor_part_number: string | null; barcode: string | null; qty_ordered: number; qty_received: number; qty_open: number; unit_cost: number; normal_unit_cost: number | null; line_total: number }>
  receipts: Array<{ id: string; received_at: string; by: string | null; packing_slip_path: string | null; lines: Array<{ part_name: string; qty: number; unit_cost: number }> | null }>
}

export type TransferRow = {
  id: string; number: number; status: 'requested' | 'approved' | 'in_transit' | 'received' | 'rejected' | 'cancelled'; notes: string | null; requested_at: string; shipped_at: string | null; received_at: string | null
  from_id: string; from_name: string; to_id: string; to_name: string; requested_by: string | null
  can_approve: boolean; can_ship: boolean; can_receive: boolean; can_cancel: boolean
  lines: Array<{ id: string; part_id: string; part_name: string; qty_requested: number; qty_shipped: number; qty_received: number; variance_qty: number | null; available_at_source: number | null }>
}

export type CountRow = { id: string; number: number; status: 'open' | 'in_review' | 'posted' | 'cancelled'; blind: boolean; forced: boolean; scheduled: boolean; scope_type: string; due_date: string | null; notes: string | null; created_at: string; location_id: string; location_name: string; lines: number; counted: number }
export type CountDetail = {
  count: CountRow & { location_name: string }
  threshold: number
  lines: Array<{ id: string; part_id: string; part_name: string; sku: string | null; uom: string | null; bin_id: string | null; bin_name: string | null; expected_qty: number | null; variance_qty: number | null; variance_value: number | null; unit_cost: number | null; counted_qty: number | null; counted_at: string | null; reason_code: string | null; posted: boolean }>
}

export type MiAlert = { id: string; kind: string; message: string; status: string; created_at: string; sent_at: string | null; detail: unknown }

export type Dashboard = {
  range: { from: string; to: string }
  inventory_value: number
  value_by_site: Array<{ label: string; value: number }>
  value_by_location: Array<{ label: string; type: string; value: number }>
  value_by_category: Array<{ label: string; value: number }>
  in_transit_value: number
  stockouts: Array<{ part_id: string; part_name: string; location_name: string; is_critical: boolean }>
  critical_zero_days: number
  site_signals: Array<{ site_id: string; site_name: string; required_lines: number; ok_lines: number; compliance_pct: number; signal: 'green' | 'yellow' | 'red'; missing: Array<{ part_id: string; part_name: string; need: number; have: number }> }>
  critical_compliance_pct: number | null
  fill_rate: { lines: number; filled: number; pct: number | null }
  issue_cost_12m: number
  avg_inventory_value: number
  turns: number | null
  carrying_cost: number
  carrying_rate: number
  dead_stock: { value: number; lines: number; top: Array<{ part_id: string; part_name: string; location_name: string; value: number; last_moved_at: string | null }> }
  parts_cost: number
  cars: number
  parts_cost_per_car: number | null
  parts_cost_by_site: Array<{ label: string; value: number; cars: number; per_car: number | null }>
  top_assets: Array<{ asset_id: string; label: string; value: number }>
  count_accuracy: { lines: number; within_tolerance: number; pct: number | null; net_variance: number; gross_variance: number }
  tools: { total: number; checked_out: number; overdue: number; utilization_pct: number | null; overdue_list: Array<{ id: string; name: string; due_at: string; custodian: string | null }>; lost_or_damaged_value: number }
  equipment_reliability: Array<{ category: string; events: number; mttr_hours: number | null; mtbf_days: number | null }>
  emergency: { orders: number; total: number; premium: number }
  monthly_issue_cost: Array<{ month: string; value: number }>
}

export type ImportRowResult = { row: number; status: 'create' | 'update' | 'error'; part: string | null; location: string | null; message?: string }
export type ImportResult = { ok: boolean; committed: boolean; created: number; updated: number; errors: number; rows: ImportRowResult[] }

export type LabelSetup = {
  settings: { short_code: string; support_phone: string | null; label_logo_path: string | null; label_show_logo: boolean } | null
  templates: Array<{ id: string; name: string; page_spec: unknown; layout: unknown; offset_x_mm: number; offset_y_mm: number; scale: number; is_default: boolean; is_outdoor: boolean }>
}

// The generated types can't follow a function name held in a variable.
type RpcFn = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>

export async function miRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as RpcFn).call(supabase, name, args)
  if (error) throw new Error(error.message)
  return data as T
}

const BUCKET = 'maintenance-inventory'

export const mi = {
  me: () => miRpc<MiMe>('mi_me'),
  refs: () => miRpc<MiRefs>('mi_refs'),
  home: () => miRpc<HomeData>('mi_home'),
  resolveScan: (raw: string) => miRpc<ScanResult>('mi_resolve_scan', { p_raw: raw }),
  consumeContext: (part: string, location: string, asset?: string | null) =>
    miRpc<ConsumeContext>('mi_consume_context', { p_part: part, p_location: location, p_asset: asset ?? null }),
  stockElsewhere: (part: string, exclude?: string | null) => miRpc<Elsewhere[]>('mi_stock_elsewhere', { p_part: part, p_exclude: exclude ?? null }),
  locationStock: (location: string, q?: string) => miRpc<StockRow[]>('mi_location_stock', { p_location: location, p_q: q ?? null }),
  partStockForSite: (part: string, site: string) => miRpc<StockRow[]>('mi_part_stock_for_site', { p_part: part, p_site: site }),
  notePartNeeded: (wo: string, part: string, qty: number) => miRpc<void>('mi_note_part_needed', { p_work_order: wo, p_part: part, p_qty: qty }),
  openPoLines: (part: string, location: string) =>
    miRpc<Array<{ id: string; po_id: string; number: number; vendor_name: string; qty_open: number; unit_cost: number }>>('mi_open_po_lines', { p_part: part, p_location: location }),
  openCountLine: (part: string, location: string) =>
    miRpc<{ line_id: string; count_id: string; number: number; blind: boolean; counted_qty: number | null } | null>('mi_open_count_line', { p_part: part, p_location: location }),

  // Parts
  parts: (o: { q?: string; category?: string | null; filter?: string | null; limit?: number; offset?: number }) =>
    miRpc<{ total: number; rows: PartListRow[] }>('mi_parts_list', { p_q: o.q ?? null, p_category: o.category ?? null, p_filter: o.filter ?? null, p_limit: o.limit ?? 100, p_offset: o.offset ?? 0 }),
  partDetail: (id: string) => miRpc<PartDetail>('mi_part_detail', { p_part: id }),
  checkDuplicates: (o: { name: string; manufacturer?: string; mpn?: string; barcode?: string; exclude?: string | null }) =>
    miRpc<{ exact: Array<{ id: string; name: string; sku: string | null; match: string }>; similar: Array<{ id: string; name: string; sku: string | null; score: number }> }>('mi_check_part_duplicates', { p_name: o.name, p_manufacturer: o.manufacturer ?? null, p_mpn: o.mpn ?? null, p_barcode: o.barcode ?? null, p_exclude: o.exclude ?? null }),
  savePart: (p: Record<string, unknown>) => miRpc<{ id: string }>('mi_save_part', { p }),
  requestPart: (o: { name: string; manufacturer?: string; mpn?: string; barcode?: string; notes?: string }) =>
    miRpc<void>('mi_request_part', { p_name: o.name, p_manufacturer: o.manufacturer ?? null, p_mpn: o.mpn ?? null, p_barcode: o.barcode ?? null, p_notes: o.notes ?? null }),
  partRequests: async () => {
    const { data, error } = await supabase.from('mi_part_requests').select('*').eq('status', 'pending').order('requested_at')
    if (error) throw new Error(error.message)
    return data ?? []
  },
  decidePartRequest: (id: string, approve: boolean, part?: Record<string, unknown>) => miRpc<void>('mi_decide_part_request', { p_request: id, p_approve: approve, p_part: part ?? null }),
  setStockParams: (o: { part: string; location: string; bin?: string | null; min?: number | null; max?: number | null; reorder?: number | null }) =>
    miRpc<void>('mi_set_stock_params', { p_part: o.part, p_location: o.location, p_bin: o.bin ?? null, p_min: o.min ?? null, p_max: o.max ?? null, p_reorder: o.reorder ?? null }),
  adjustStock: (o: { part: string; location: string; delta: number; reason: string; cost?: number | null }) =>
    miRpc<void>('mi_adjust_stock', { p_part: o.part, p_location: o.location, p_delta: o.delta, p_reason: o.reason, p_unit_cost: o.cost ?? null }),
  savePartVendor: async (row: { account_id: string; part_id: string; vendor_id: string; vendor_part_number: string | null; price: number | null; pack_qty: number; lead_time_days: number | null; preferred: boolean }) => {
    if (row.preferred) {
      const clear = await supabase.from('mi_part_vendors').update({ preferred: false }).eq('part_id', row.part_id).neq('vendor_id', row.vendor_id)
      if (clear.error) throw new Error(clear.error.message)
    }
    const { error } = await supabase.from('mi_part_vendors').upsert(row, { onConflict: 'part_id,vendor_id' })
    if (error) throw new Error(error.message)
  },
  removePartVendor: async (id: string) => {
    const { error } = await supabase.from('mi_part_vendors').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  // Tools
  tools: (o: { q?: string; status?: string | null; mine?: boolean }) => miRpc<ToolRow[]>('mi_tools_list', { p_q: o.q ?? null, p_status: o.status ?? null, p_mine: !!o.mine }),
  toolDetail: (id: string) => miRpc<ToolDetail>('mi_tool_detail', { p_tool: id }),
  saveTool: (p: Record<string, unknown>) => miRpc<{ id: string }>('mi_save_tool', { p }),
  setToolStatus: (tool: string, status: string, notes?: string) => miRpc<void>('mi_set_tool_status', { p_tool: tool, p_status: status, p_notes: notes ?? null }),
  cancelToolTransfer: (tool: string) => miRpc<void>('mi_cancel_tool_transfer', { p_tool: tool }),
  startToolAudit: (location: string) => miRpc<string>('mi_start_tool_audit', { p_location: location }),
  toolAuditScan: (audit: string, tool: string, condition?: string) => miRpc<void>('mi_tool_audit_scan', { p_audit: audit, p_tool: tool, p_condition: condition ?? 'good' }),
  finishToolAudit: (audit: string) => miRpc<{ missing: number }>('mi_finish_tool_audit', { p_audit: audit }),
  toolAudit: async (audit: string) => {
    const { data, error } = await supabase.from('mi_tool_audit_lines').select('tool_id, found, tool:mi_tools(name)').eq('audit_id', audit)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Array<{ tool_id: string; found: boolean | null; tool: { name: string } | null }>
  },

  // Assets and work orders
  assets: (site: string, q?: string) => miRpc<AssetRow[]>('mi_assets_list', { p_site: site, p_q: q ?? null }),
  assetDetail: (id: string) => miRpc<AssetDetail>('mi_asset_detail', { p_asset: id }),
  updateAsset: (id: string, p: Record<string, unknown>) => miRpc<void>('mi_update_asset', { p_asset: id, p }),
  setBomLine: (asset: string, part: string, qty: number) => miRpc<void>('mi_set_bom_line', { p_asset: asset, p_part: part, p_qty: qty }),
  areas: async (site: string) => {
    const { data, error } = await supabase.from('mi_areas').select('id, name, sort_order').eq('site_id', site).order('sort_order').order('name')
    if (error) throw new Error(error.message)
    return data ?? []
  },
  addArea: async (accountId: string, site: string, name: string) => {
    const { data, error } = await supabase.from('mi_areas').insert({ account_id: accountId, site_id: site, name }).select('id, name, sort_order').single()
    if (error) throw new Error(error.message)
    return data
  },
  workOrders: (o: { site?: string | null; q?: string; status?: string | null }) => miRpc<WoRow[]>('mi_work_orders_list', { p_site: o.site ?? null, p_q: o.q ?? null, p_status: o.status === undefined ? 'open' : o.status }),
  workOrderDetail: (id: string) => miRpc<WoDetail>('mi_work_order_detail', { p_wo: id }),
  createWorkOrder: (o: { site: string; title: string; asset?: string | null; priority?: string; description?: string; parts?: Array<{ part_id: string; qty: number }> }) =>
    miRpc<{ id: string; number: number }>('mi_create_work_order', { p_site: o.site, p_title: o.title, p_asset: o.asset ?? null, p_priority: o.priority ?? 'medium', p_description: o.description ?? null, p_parts: o.parts ?? null }),
  workOrderFromChecklist: (instance: string, item: string, note?: string) =>
    miRpc<{ work_order_id: string; number: number; suggested_parts: number }>('mi_work_order_from_checklist', { p_instance: instance, p_item: item, p_note: note ?? null }),

  // Purchasing
  reorder: (location?: string | null) => miRpc<Suggestion[]>('mi_reorder_suggestions', { p_location: location ?? null }),
  createDraftPos: (lines: Array<{ part_id: string; location_id: string; vendor_id: string; qty: number; unit_cost: number | null }>, urgent: boolean) =>
    miRpc<{ created: Array<{ po_id: string; number: number; vendor_id: string; lines: number }>; skipped: unknown[] }>('mi_create_draft_pos', { p_lines: lines, p_urgent: urgent }),
  pos: (status?: string | null) => miRpc<PoRow[]>('mi_pos_list', { p_status: status ?? null }),
  poDetail: (id: string) => miRpc<PoDetail>('mi_po_detail', { p_po: id }),
  createPo: (vendor: string, location: string, urgent = false, notes?: string) => miRpc<{ id: string }>('mi_create_po', { p_vendor: vendor, p_location: location, p_urgent: urgent, p_notes: notes ?? null }),
  savePoLine: (po: string, part: string, qty: number, cost?: number | null) => miRpc<void>('mi_save_po_line', { p_po: po, p_part: part, p_qty: qty, p_unit_cost: cost ?? null }),
  submitPo: (po: string) => miRpc<void>('mi_submit_po', { p_po: po }),
  approvePo: (po: string, approve = true) => miRpc<void>('mi_approve_po', { p_po: po, p_approve: approve }),
  markPoSent: (po: string, to?: string) => miRpc<void>('mi_mark_po_sent', { p_po: po, p_sent_to: to ?? null }),
  cancelPo: (po: string) => miRpc<void>('mi_cancel_po', { p_po: po }),
  closePo: (po: string) => miRpc<void>('mi_close_po', { p_po: po }),
  sendPoEmail: (po: string, pdfBase64: string, to: string) => supabase.functions.invoke('mi-po-send', { body: { po_id: po, pdf_base64: pdfBase64, to } }),

  // Transfers and counts
  transfers: (status?: string | null) => miRpc<TransferRow[]>('mi_transfers_list', { p_status: status ?? null }),
  decideTransfer: (id: string, approve: boolean) => miRpc<void>('mi_decide_transfer', { p_transfer: id, p_approve: approve }),
  cancelTransfer: (id: string) => miRpc<void>('mi_cancel_transfer', { p_transfer: id }),
  counts: (status?: string | null) => miRpc<CountRow[]>('mi_counts_list', { p_status: status ?? null }),
  countDetail: (id: string) => miRpc<CountDetail>('mi_count_detail', { p_count: id }),
  createCount: (o: { location: string; scopeType: string; scopeValue?: string | null; blind: boolean; due?: string | null; notes?: string }) =>
    miRpc<{ count_id: string; number: number; lines: number }>('mi_create_count', { p_location: o.location, p_scope_type: o.scopeType, p_scope_value: o.scopeValue ?? null, p_blind: o.blind, p_due: o.due ?? null, p_notes: o.notes ?? null }),
  submitCount: (id: string) => miRpc<{ needs_review: boolean }>('mi_submit_count', { p_count: id }),
  postCount: (id: string, decisions: Array<{ line_id: string; reason_code: string }>) => miRpc<{ posted: number; held: number; status: string }>('mi_post_count', { p_count: id, p_decisions: decisions }),
  cancelCount: (id: string) => miRpc<void>('mi_cancel_count', { p_count: id }),

  // Reports, labels, settings
  dashboard: (o: { from?: string; to?: string; site?: string | null }) => miRpc<Dashboard>('mi_dashboard', { p_from: o.from ?? null, p_to: o.to ?? null, p_site: o.site ?? null }),
  alerts: () => miRpc<MiAlert[]>('mi_alerts_list', { p_limit: 100 }),
  exportStock: () => miRpc<Array<Record<string, string | number | null>>>('mi_export_stock'),
  importParts: (rows: Array<Record<string, string>>, commit: boolean) => miRpc<ImportResult>('mi_import_parts', { p_rows: rows, p_commit: commit }),
  ensureTag: (type: 'bin' | 'tool' | 'asset' | 'location', id: string) => miRpc<string>('mi_ensure_tag', { p_type: type, p_id: id }),
  markPrinted: (codes: string[]) => miRpc<void>('mi_mark_printed', { p_codes: codes }),
  labelSetup: () => miRpc<LabelSetup>('mi_label_setup'),
  updateSettings: (p: Record<string, unknown>) => miRpc<MiSettings>('mi_update_settings', { p }),
  setSiteSetting: (site: string, allowNegative: boolean) => miRpc<void>('mi_set_site_setting', { p_site: site, p_allow_negative: allowNegative }),
  siteSettings: async () => {
    const { data, error } = await supabase.from('mi_site_settings').select('site_id, allow_negative')
    if (error) throw new Error(error.message)
    return data ?? []
  },
  setMember: (o: { user: string; role: MiRole; sites: string[]; regions: string[] }) => miRpc<void>('mi_set_member', { p_user: o.user, p_role: o.role, p_site_ids: o.sites, p_region_names: o.regions }),
  removeMember: (user: string) => miRpc<void>('mi_remove_member', { p_user: user }),
  accountUsers: () => miRpc<Array<{ id: string; name: string; email: string }>>('mi_account_users'),
  saveLocation: async (row: { id?: string; account_id: string; name: string; type: MiLocationType; site_id: string | null; region_name: string | null; assigned_user_id: string | null; active?: boolean }) => {
    const { error } = row.id
      ? await supabase.from('mi_stock_locations').update(row).eq('id', row.id)
      : await supabase.from('mi_stock_locations').insert(row)
    if (error) throw new Error(error.message)
  },
  addBin: async (accountId: string, location: string, name: string) => {
    const { data, error } = await supabase.from('mi_bins').insert({ account_id: accountId, location_id: location, name }).select('id, name, location_id').single()
    if (error) throw new Error(error.message)
    return data
  },
  addCategory: async (accountId: string, name: string) => {
    const { error } = await supabase.from('mi_part_categories').insert({ account_id: accountId, name })
    if (error) throw new Error(error.message)
  },
  removeCategory: async (id: string) => {
    const { error } = await supabase.from('mi_part_categories').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
  kits: async () => {
    const { data, error } = await supabase.from('mi_kits').select('id, name, kind, description, is_sample, items:mi_kit_items(part_id, qty, part:parts(name)), sites:mi_site_kits(site_id, tunnels)').order('name')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Array<{ id: string; name: string; kind: string; description: string | null; is_sample: boolean; items: Array<{ part_id: string; qty: number; part: { name: string } | null }>; sites: Array<{ site_id: string; tunnels: number }> }>
  },
  saveKit: async (accountId: string, name: string, kind: string, description?: string) => {
    const { data, error } = await supabase.from('mi_kits').insert({ account_id: accountId, name, kind, description: description ?? null }).select('id').single()
    if (error) throw new Error(error.message)
    return data
  },
  setKitItem: async (kit: string, part: string, qty: number) => {
    const res = qty > 0
      ? await supabase.from('mi_kit_items').upsert({ kit_id: kit, part_id: part, qty }, { onConflict: 'kit_id,part_id' })
      : await supabase.from('mi_kit_items').delete().eq('kit_id', kit).eq('part_id', part)
    if (res.error) throw new Error(res.error.message)
  },
  setSiteKit: async (accountId: string, site: string, kit: string, on: boolean) => {
    const res = on
      ? await supabase.from('mi_site_kits').upsert({ account_id: accountId, site_id: site, kit_id: kit }, { onConflict: 'site_id,kit_id' })
      : await supabase.from('mi_site_kits').delete().eq('site_id', site).eq('kit_id', kit)
    if (res.error) throw new Error(res.error.message)
  },
  removeSampleData: () => miRpc<{ locations: number; parts: number }>('mi_remove_sample_data'),
  previewAlerts: () => supabase.functions.invoke('mi-alerts', { body: { action: 'preview' } }),

  // Files
  fileUrl: async (path: string) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  },
  upload: async (accountId: string, folder: string, file: File | Blob, name: string) => {
    const path = `${accountId}/${folder}/${crypto.randomUUID()}-${name.replace(/[^\w.-]+/g, '_')}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file)
    if (error) throw new Error(error.message)
    return path
  },
  addAttachment: async (row: { account_id: string; entity_type: string; entity_id: string; storage_path: string; file_name: string; kind: string; uploaded_by: string }) => {
    const { error } = await supabase.from('mi_attachments').insert(row)
    if (error) throw new Error(error.message)
  },
}
