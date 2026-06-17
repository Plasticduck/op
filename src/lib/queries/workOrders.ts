import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type WorkOrder = T['work_orders']['Row']
export type WorkOrderInsert = T['work_orders']['Insert']
export type WorkOrderUpdate = T['work_orders']['Update']
export type WorkOrderCategory = T['work_order_categories']['Row']
export type WorkOrderAssignee = T['work_order_assignees']['Row']
export type WorkOrderPart = T['work_order_parts']['Row']
export type WorkOrderTimeEntry = T['work_order_time_entries']['Row']
export type WorkOrderOtherCost = T['work_order_other_costs']['Row']
export type WorkOrderFile = T['work_order_files']['Row']
export type WorkOrderComment = T['work_order_comments']['Row']
export type Vendor = T['vendors']['Row']
export type VendorContact = T['vendor_contacts']['Row']

export type WorkOrderStatus = 'open' | 'on_hold' | 'in_progress' | 'done' | 'skipped'
export type WorkOrderPriority = 'none' | 'low' | 'medium' | 'high'
export type WorkOrderWorkType = 'reactive' | 'preventive' | 'inspection' | 'project' | 'other'
export type WorkOrderRecurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

// Hydrated row used by the list view: includes the related assignee names,
// category labels, the equipment name, and counts of photos / comments for
// row decorations.
export type WorkOrderRow = WorkOrder & {
  location: { id: string; name: string } | null
  equipment: { id: string; name: string } | null
  assignees: Array<{ user_id: string; user_name: string }>
  categories: Array<{ category: { id: string; name: string; color: string; icon: string | null } | null }>
  vendors: Array<{ vendor: { id: string; name: string } | null }>
  photo_count: { count: number }[]
  comment_count: { count: number }[]
}

export const workOrders = {
  // List for the side-by-side view. Returns everything the row needs in one
  // round trip via nested selects. Filtered to the active location when one
  // is provided so the list narrows on the location switcher.
  list: (opts?: { locationId?: string | null; status?: WorkOrderStatus | 'all' }) => {
    let q = supabase
      .from('work_orders')
      .select(`
        *,
        location:locations(id, name),
        equipment:equipment(id, name),
        assignees:work_order_assignees(user_id, user_name),
        categories:work_order_category_links(category:work_order_categories(id, name, color, icon)),
        vendors:work_order_vendor_links(vendor:vendors(id, name)),
        photo_count:work_order_files(count),
        comment_count:work_order_comments(count)
      `)
      .order('updated_at', { ascending: false })
    if (opts?.locationId) q = q.eq('location_id', opts.locationId)
    if (opts?.status && opts.status !== 'all') q = q.eq('status', opts.status)
    return q
  },

  // Single WO with everything attached. The detail pane re-queries this when
  // an action lands so it stays in sync with the realtime list.
  byId: (id: string) =>
    supabase
      .from('work_orders')
      .select(`
        *,
        location:locations(id, name),
        equipment:equipment(id, name),
        assignees:work_order_assignees(user_id, user_name),
        categories:work_order_category_links(category:work_order_categories(id, name, color, icon)),
        vendors:work_order_vendor_links(vendor:vendors(id, name)),
        parts:work_order_parts(*),
        time_entries:work_order_time_entries(*),
        other_costs:work_order_other_costs(*),
        files:work_order_files(*),
        comments:work_order_comments(*),
        sub_work_orders:work_orders!parent_work_order_id(id, number, title, status, priority)
      `)
      .eq('id', id)
      .single(),

  create: (row: WorkOrderInsert) =>
    supabase.from('work_orders').insert(row).select().single(),

  update: (id: string, patch: WorkOrderUpdate) =>
    supabase.from('work_orders').update(patch).eq('id', id).select().single(),

  setStatus: (id: string, status: WorkOrderStatus) =>
    supabase.from('work_orders').update({ status }).eq('id', id),

  remove: (id: string) => supabase.from('work_orders').delete().eq('id', id),

  // Assignees / categories / vendors are managed as set-and-replace from the
  // detail page; these helpers wrap the typical "delete then insert" pattern.
  setAssignees: async (workOrderId: string, users: Array<{ user_id: string; user_name: string }>) => {
    await supabase.from('work_order_assignees').delete().eq('work_order_id', workOrderId)
    if (users.length > 0) {
      await supabase
        .from('work_order_assignees')
        .insert(users.map((u) => ({ work_order_id: workOrderId, ...u })))
    }
  },
  setCategories: async (workOrderId: string, categoryIds: string[]) => {
    await supabase.from('work_order_category_links').delete().eq('work_order_id', workOrderId)
    if (categoryIds.length > 0) {
      await supabase
        .from('work_order_category_links')
        .insert(categoryIds.map((id) => ({ work_order_id: workOrderId, category_id: id })))
    }
  },
  setVendors: async (workOrderId: string, vendorIds: string[]) => {
    await supabase.from('work_order_vendor_links').delete().eq('work_order_id', workOrderId)
    if (vendorIds.length > 0) {
      await supabase
        .from('work_order_vendor_links')
        .insert(vendorIds.map((id) => ({ work_order_id: workOrderId, vendor_id: id })))
    }
  },

  addPart: (row: T['work_order_parts']['Insert']) =>
    supabase.from('work_order_parts').insert(row).select().single(),
  removePart: (id: string) => supabase.from('work_order_parts').delete().eq('id', id),

  addTimeEntry: (row: T['work_order_time_entries']['Insert']) =>
    supabase.from('work_order_time_entries').insert(row).select().single(),
  removeTimeEntry: (id: string) => supabase.from('work_order_time_entries').delete().eq('id', id),

  addOtherCost: (row: T['work_order_other_costs']['Insert']) =>
    supabase.from('work_order_other_costs').insert(row).select().single(),
  removeOtherCost: (id: string) => supabase.from('work_order_other_costs').delete().eq('id', id),

  uploadFile: async (accountId: string, workOrderId: string, file: File, kind: 'photo' | 'file') => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const path = `${accountId}/${workOrderId}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('work-order-files')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) return { error: upErr, data: null }
    return supabase
      .from('work_order_files')
      .insert({
        work_order_id: workOrderId,
        kind,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      })
      .select()
      .single()
  },
  removeFile: async (id: string, storagePath: string) => {
    await supabase.storage.from('work-order-files').remove([storagePath])
    return supabase.from('work_order_files').delete().eq('id', id)
  },
  fileSignedUrl: async (path: string, expiresIn = 3600) => {
    const { data, error } = await supabase.storage
      .from('work-order-files')
      .createSignedUrl(path, expiresIn)
    return { error, url: data?.signedUrl ?? null }
  },

  addComment: (row: T['work_order_comments']['Insert']) =>
    supabase.from('work_order_comments').insert(row).select().single(),
  removeComment: (id: string) => supabase.from('work_order_comments').delete().eq('id', id),
}

export const workOrderCategories = {
  list: () =>
    supabase.from('work_order_categories').select('*').order('name'),
  create: (row: T['work_order_categories']['Insert']) =>
    supabase.from('work_order_categories').insert(row).select().single(),
  update: (id: string, patch: T['work_order_categories']['Update']) =>
    supabase.from('work_order_categories').update(patch).eq('id', id).select().single(),
  remove: (id: string) =>
    supabase.from('work_order_categories').delete().eq('id', id),
}

export const vendors = {
  list: () =>
    supabase
      .from('vendors')
      .select('*, contacts:vendor_contacts(*)')
      .order('name'),
  byId: (id: string) =>
    supabase
      .from('vendors')
      .select('*, contacts:vendor_contacts(*)')
      .eq('id', id)
      .single(),
  create: (row: T['vendors']['Insert']) =>
    supabase.from('vendors').insert(row).select().single(),
  update: (id: string, patch: T['vendors']['Update']) =>
    supabase.from('vendors').update(patch).eq('id', id).select().single(),
  remove: (id: string) =>
    supabase.from('vendors').delete().eq('id', id),
  addContact: (row: T['vendor_contacts']['Insert']) =>
    supabase.from('vendor_contacts').insert(row).select().single(),
  removeContact: (id: string) =>
    supabase.from('vendor_contacts').delete().eq('id', id),
}

// --- Label helpers used by both the list and the new-WO modal ------------

export const PRIORITY_OPTIONS: Array<{ value: WorkOrderPriority; label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' }> = [
  { value: 'none', label: 'None', tone: 'neutral' },
  { value: 'low', label: 'Low', tone: 'ok' },
  { value: 'medium', label: 'Medium', tone: 'warn' },
  { value: 'high', label: 'High', tone: 'danger' },
]

export const WORK_TYPE_OPTIONS: Array<{ value: WorkOrderWorkType; label: string }> = [
  { value: 'reactive', label: 'Reactive' },
  { value: 'preventive', label: 'Preventive' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'project', label: 'Project' },
  { value: 'other', label: 'Other' },
]

export const RECURRENCE_OPTIONS: Array<{ value: WorkOrderRecurrence; label: string }> = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom' },
]

export const STATUS_OPTIONS: Array<{ value: WorkOrderStatus; label: string; tone: 'accent' | 'warn' | 'ok' | 'neutral' | 'danger' }> = [
  { value: 'open', label: 'Open', tone: 'accent' },
  { value: 'on_hold', label: 'On Hold', tone: 'warn' },
  { value: 'in_progress', label: 'In Progress', tone: 'accent' },
  { value: 'done', label: 'Done', tone: 'ok' },
  { value: 'skipped', label: 'Skipped', tone: 'danger' },
]
