import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type Equipment = T['equipment']['Row']
export type Part = T['parts_inventory']['Row']
export type WorkOrder = T['work_orders']['Row']
export type WorkOrderPart = T['work_order_parts']['Row']
export type DowntimeEvent = T['downtime_events']['Row']
export type Checklist = T['checklists']['Row']
export type ChecklistItem = T['checklist_items']['Row']
export type ChecklistCompletion = T['checklist_completions']['Row']
export type Closeout = T['closeouts']['Row']
export type DocumentRow = T['documents']['Row']
export type Contact = T['contacts']['Row']
export type SupplyRequest = T['supplies_requests']['Row']

// ---- Equipment -------------------------------------------------------------
export const equipment = {
  list: (loc: string) =>
    supabase.from('equipment').select('*').eq('location_id', loc).order('name'),
  get: (id: string) =>
    supabase.from('equipment').select('*').eq('id', id).single(),
  create: (row: T['equipment']['Insert']) =>
    supabase.from('equipment').insert(row).select().single(),
  update: (id: string, patch: T['equipment']['Update']) =>
    supabase.from('equipment').update(patch).eq('id', id),
  remove: (id: string) => supabase.from('equipment').delete().eq('id', id),
}

// ---- Parts -----------------------------------------------------------------
export const parts = {
  list: (loc: string) =>
    supabase.from('parts_inventory').select('*').eq('location_id', loc).order('name'),
  create: (row: T['parts_inventory']['Insert']) =>
    supabase.from('parts_inventory').insert(row).select().single(),
  update: (id: string, patch: T['parts_inventory']['Update']) =>
    supabase
      .from('parts_inventory')
      .update({ ...patch, last_updated_at: new Date().toISOString() })
      .eq('id', id),
  remove: (id: string) => supabase.from('parts_inventory').delete().eq('id', id),
}

// ---- Work orders -----------------------------------------------------------
export const workOrders = {
  list: (loc: string) =>
    supabase
      .from('work_orders')
      .select('*, equipment(name), assigned:assigned_to(name)')
      .eq('location_id', loc)
      .order('created_at', { ascending: false }),
  get: (id: string) =>
    supabase
      .from('work_orders')
      .select('*, equipment(id, name), assigned:assigned_to(name), creator:created_by(name)')
      .eq('id', id)
      .single(),
  create: (row: T['work_orders']['Insert']) =>
    supabase.from('work_orders').insert(row).select().single(),
  update: (id: string, patch: T['work_orders']['Update']) =>
    supabase.from('work_orders').update(patch).eq('id', id),
  remove: (id: string) => supabase.from('work_orders').delete().eq('id', id),
  listParts: (woId: string) =>
    supabase.from('work_order_parts').select('*').eq('work_order_id', woId),
  addPart: (row: T['work_order_parts']['Insert']) =>
    supabase.from('work_order_parts').insert(row).select().single(),
  removePart: (id: string) =>
    supabase.from('work_order_parts').delete().eq('id', id),
}

// ---- Downtime --------------------------------------------------------------
export const downtime = {
  list: (loc: string) =>
    supabase
      .from('downtime_events')
      .select('*, equipment(name)')
      .eq('location_id', loc)
      .order('started_at', { ascending: false }),
  forEquipment: (equipmentId: string, sinceIso: string) =>
    supabase
      .from('downtime_events')
      .select('started_at, ended_at')
      .eq('equipment_id', equipmentId)
      .gte('started_at', sinceIso),
  create: (row: T['downtime_events']['Insert']) =>
    supabase.from('downtime_events').insert(row).select().single(),
  end: (id: string) =>
    supabase
      .from('downtime_events')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', id),
}

// ---- Checklists ------------------------------------------------------------
// New model (migration 0031): templates are account-scoped, assigned to one
// or many locations via checklist_locations, and materialize into daily
// checklist_instances. Items toggle via append-only checklist_item_events.

export type ChecklistInstance = T['checklist_instances']['Row']
export type ChecklistItemEvent = T['checklist_item_events']['Row']

export const checklists = {
  // Templates: account-scoped, with per-template location M:N.
  templatesForAccount: () =>
    supabase
      .from('checklists')
      .select('*, locations:checklist_locations(location_id)')
      .eq('archived', false)
      .order('name'),
  template: (id: string) =>
    supabase
      .from('checklists')
      .select('*, locations:checklist_locations(location_id)')
      .eq('id', id)
      .single(),
  createTemplate: (row: T['checklists']['Insert']) =>
    supabase.from('checklists').insert(row).select().single(),
  updateTemplate: (id: string, patch: T['checklists']['Update']) =>
    supabase.from('checklists').update(patch).eq('id', id).select().single(),
  archiveTemplate: (id: string) =>
    supabase.from('checklists').update({ archived: true }).eq('id', id),
  removeTemplate: (id: string) => supabase.from('checklists').delete().eq('id', id),

  // Location assignment (M:N).
  setLocations: async (checklistId: string, locationIds: string[]) => {
    await supabase.from('checklist_locations').delete().eq('checklist_id', checklistId)
    if (locationIds.length === 0) return { error: null }
    return supabase
      .from('checklist_locations')
      .insert(locationIds.map((location_id) => ({ checklist_id: checklistId, location_id })))
  },

  // Items.
  items: (checklistId: string) =>
    supabase
      .from('checklist_items')
      .select('*')
      .eq('checklist_id', checklistId)
      .order('order_index'),
  addItem: (row: T['checklist_items']['Insert']) =>
    supabase.from('checklist_items').insert(row).select().single(),
  removeItem: (id: string) =>
    supabase.from('checklist_items').delete().eq('id', id),
  updateItem: (id: string, patch: T['checklist_items']['Update']) =>
    supabase.from('checklist_items').update(patch).eq('id', id),

  // Daily instances. ensureTodayForLocation materializes today's instances
  // for every template assigned to the location (no-op for templates whose
  // days_of_week excludes today). Returns the list of active instances with
  // their template + items + current state joined.
  ensureTodayForLocation: async (locationId: string) => {
    const { error: rpcErr } = await supabase.rpc('ensure_today_instances', { p_location_id: locationId })
    if (rpcErr) return { data: null, error: rpcErr }
    // "Today" must be resolved in the location's timezone, not UTC: instances are
    // keyed by the local date (ensure_checklist_instance computes it in the site's
    // tz), so a UTC date would miss them in the evening after the UTC rollover.
    const { data: loc } = await supabase
      .from('locations')
      .select('timezone')
      .eq('id', locationId)
      .single()
    const tz = (loc as { timezone: string | null } | null)?.timezone || 'America/Chicago'
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    return supabase
      .from('checklist_instances')
      .select('*, checklist:checklist_id(id, name, description, opens_at_local, closes_at_local, reset_policy, roles)')
      .eq('location_id', locationId)
      .eq('instance_date', today)
      .order('opens_at')
  },
  itemStateFor: (instanceIds: string[]) =>
    instanceIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('checklist_item_state')
          .select('*')
          .in('instance_id', instanceIds),
  toggleItem: (instanceId: string, itemId: string, check: boolean, actorId: string, actorName: string | null) =>
    supabase
      .from('checklist_item_events')
      .insert({
        instance_id: instanceId,
        item_id: itemId,
        action: check ? 'check' : 'uncheck',
        actor_id: actorId,
        actor_name: actorName,
      })
      .select()
      .single(),
  eventsForInstance: (instanceId: string) =>
    supabase
      .from('checklist_item_events')
      .select('*, item:item_id(label)')
      .eq('instance_id', instanceId)
      .order('occurred_at', { ascending: false }),
  instancesHistoryForLocation: (locationId: string, sinceIso: string) =>
    supabase
      .from('checklist_instances')
      .select('*, checklist:checklist_id(name)')
      .eq('location_id', locationId)
      .gte('instance_date', sinceIso.slice(0, 10))
      .order('instance_date', { ascending: false }),

  // ---- Photo + AI verification (migration 0050) ----------------------------
  // Per-site baseline reference photos, keyed by (item, location). Metadata only
  // (no data_uri) so lists stay light; fetch the full image with getBaseline.
  baselinesFor: (itemIds: string[], locationId: string) =>
    itemIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('checklist_item_baselines')
          .select('id, item_id, location_id, created_at')
          .in('item_id', itemIds)
          .eq('location_id', locationId),
  getBaseline: (itemId: string, locationId: string) =>
    supabase
      .from('checklist_item_baselines')
      .select('id, data_uri')
      .eq('item_id', itemId)
      .eq('location_id', locationId)
      .maybeSingle(),
  setBaseline: (params: { item_id: string; location_id: string; data_uri: string; created_by: string }) =>
    supabase
      .from('checklist_item_baselines')
      .upsert(
        {
          item_id: params.item_id,
          location_id: params.location_id,
          data_uri: params.data_uri,
          created_by: params.created_by,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'item_id,location_id' },
      )
      .select('id')
      .single(),

  // Employee photo submissions and their AI verdicts.
  submitPhoto: (params: {
    instance_id: string
    item_id: string
    location_id: string
    data_uri: string
    submitted_by: string
    submitted_by_name: string | null
  }) => supabase.from('checklist_submissions').insert(params).select('id').single(),
  verifySubmission: (submissionId: string) =>
    supabase.functions.invoke('verify-checklist-photo', { body: { submission_id: submissionId } }),
  latestSubmissionsFor: (instanceIds: string[]) =>
    instanceIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('checklist_submission_latest')
          .select('*')
          .in('instance_id', instanceIds),
  submissionImage: (id: string) =>
    supabase.from('checklist_submissions').select('data_uri').eq('id', id).single(),
}

export type ChecklistSubmissionLatest = {
  id: string
  instance_id: string
  item_id: string
  location_id: string
  submitted_by_name: string | null
  ai_status: 'pending' | 'pass' | 'discrepancy' | 'unclear' | 'error'
  ai_notes: string | null
  created_at: string
}

// ---- Closeouts -------------------------------------------------------------
export const closeouts = {
  list: (loc: string) =>
    supabase
      .from('closeouts')
      .select('*, submitted_by(name)')
      .eq('location_id', loc)
      .order('date', { ascending: false }),
  create: (row: T['closeouts']['Insert']) =>
    supabase.from('closeouts').insert(row).select().single(),
  update: (id: string, patch: T['closeouts']['Update']) =>
    supabase.from('closeouts').update(patch).eq('id', id),
}

// ---- Documents -------------------------------------------------------------
export const documents = {
  list: (loc: string) =>
    supabase
      .from('documents')
      .select('*')
      .eq('location_id', loc)
      .eq('archived', false)
      .order('created_at', { ascending: false }),
  create: (row: T['documents']['Insert']) =>
    supabase.from('documents').insert(row).select().single(),
  archive: (id: string) =>
    supabase.from('documents').update({ archived: true }).eq('id', id),
}

// ---- Contacts --------------------------------------------------------------
export const contacts = {
  list: (loc: string) =>
    supabase.from('contacts').select('*').eq('location_id', loc).order('name'),
  create: (row: T['contacts']['Insert']) =>
    supabase.from('contacts').insert(row).select().single(),
  update: (id: string, patch: T['contacts']['Update']) =>
    supabase.from('contacts').update(patch).eq('id', id),
  remove: (id: string) => supabase.from('contacts').delete().eq('id', id),
}

// ---- Supplies --------------------------------------------------------------
export const supplies = {
  list: (loc: string) =>
    supabase
      .from('supplies_requests')
      .select('*, requested_by(name)')
      .eq('location_id', loc)
      .order('created_at', { ascending: false }),
  create: (row: T['supplies_requests']['Insert']) =>
    supabase.from('supplies_requests').insert(row).select().single(),
  update: (id: string, patch: T['supplies_requests']['Update']) =>
    supabase.from('supplies_requests').update(patch).eq('id', id),
}
