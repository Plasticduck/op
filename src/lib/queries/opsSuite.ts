import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type SiteEvaluation = T['site_evaluations']['Row']
export type SiteAudit = T['site_audits']['Row']
export type OpsNote = T['ops_notes']['Row']
export type OpsInvoice = T['ops_invoices']['Row']
export type InventoryItem = T['inventory_items']['Row']
export type InventoryCount = T['inventory_counts']['Row']
export type CapitalRequest = T['capital_requests']['Row']
export type MarketResearch = T['market_research']['Row']
export type SiteViolation = T['site_violations']['Row']
export type OpsAttachment = T['ops_attachments']['Row']
export type CustomForm = T['custom_forms']['Row']

const withLoc = '*, location:location_id(name)'

export const siteEvaluations = {
  list: () => supabase.from('site_evaluations').select(withLoc).order('submitted_at', { ascending: false }),
  create: (row: T['site_evaluations']['Insert']) => supabase.from('site_evaluations').insert(row).select().single(),
}
export const siteAudits = {
  list: () => supabase.from('site_audits').select(withLoc).order('created_at', { ascending: false }),
  create: (row: T['site_audits']['Insert']) => supabase.from('site_audits').insert(row).select().single(),
}
export const opsNotes = {
  list: () => supabase.from('ops_notes').select(withLoc).order('created_at', { ascending: false }),
  create: (row: T['ops_notes']['Insert']) => supabase.from('ops_notes').insert(row).select().single(),
}
export const opsInvoices = {
  list: () => supabase.from('ops_invoices').select(withLoc).order('submitted_at', { ascending: false }),
  create: (row: T['ops_invoices']['Insert']) => supabase.from('ops_invoices').insert(row).select().single(),
  decide: (id: string, status: 'approved' | 'rejected', userId: string, name: string, reason: string | null) =>
    supabase
      .from('ops_invoices')
      .update({ status, decided_by: userId, decided_by_name: name, decided_at: new Date().toISOString(), decision_reason: reason })
      .eq('id', id),
  // Assigns an invoice to a user (writes both id and snapshot name) and stamps
  // assigned_at. The email side-effect is triggered separately by the caller via
  // the notify-invoice-assignment edge function so DB writes stay atomic and we
  // don't lose the assignment when email delivery fails.
  assign: (id: string, assigneeId: string, assigneeName: string) =>
    supabase
      .from('ops_invoices')
      .update({ assigned_to: assigneeId, assigned_to_name: assigneeName, assigned_at: new Date().toISOString() })
      .eq('id', id),
  setNotifyStatus: (id: string, status: 'sent' | 'failed' | 'no_key') =>
    supabase.from('ops_invoices').update({ notify_status: status }).eq('id', id),
}
export const inventory = {
  items: () => supabase.from('inventory_items').select('*').order('category').order('item'),
  counts: () => supabase.from('inventory_counts').select(withLoc).order('created_at', { ascending: false }),
  createItem: (row: T['inventory_items']['Insert']) =>
    supabase.from('inventory_items').insert(row).select().single(),
  createCount: (row: T['inventory_counts']['Insert']) =>
    supabase.from('inventory_counts').insert(row).select().single(),
  updateItem: (id: string, patch: T['inventory_items']['Update']) =>
    supabase.from('inventory_items').update(patch).eq('id', id),
  deleteItem: (id: string) => supabase.from('inventory_items').delete().eq('id', id),

  // Count sessions: a saved, resumable count of a site + division.
  sessions: () =>
    supabase
      .from('inventory_count_sessions')
      .select('*, location:location_id(name)')
      .order('created_at', { ascending: false }),
  createSession: (row: T['inventory_count_sessions']['Insert']) =>
    supabase.from('inventory_count_sessions').insert(row).select('*, location:location_id(name)').single(),
  updateSession: (id: string, patch: T['inventory_count_sessions']['Update']) =>
    supabase
      .from('inventory_count_sessions')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id),
  deleteSession: (id: string) => supabase.from('inventory_count_sessions').delete().eq('id', id),
  sessionLines: (sessionId: string) =>
    supabase.from('inventory_count_lines').select('*').eq('session_id', sessionId),
  saveLines: (rows: T['inventory_count_lines']['Insert'][]) =>
    rows.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('inventory_count_lines').upsert(rows, { onConflict: 'session_id,item_id' }),
}
export type InventoryCountSession = T['inventory_count_sessions']['Row']
export type InventoryCountLine = T['inventory_count_lines']['Row']
export const capitalRequests = {
  list: () => supabase.from('capital_requests').select(withLoc).order('created_at', { ascending: false }),
  create: (row: T['capital_requests']['Insert']) => supabase.from('capital_requests').insert(row).select().single(),
  decide: (id: string, status: 'approved' | 'rejected' | 'completed', userId: string, name: string, reason: string | null) =>
    supabase
      .from('capital_requests')
      .update({ status, decided_by: userId, decided_by_name: name, decided_at: new Date().toISOString(), decision_reason: reason })
      .eq('id', id),
}
export type MarketResearchDeal = T['market_research_deals']['Row']
export type MarketResearchSuggestion = T['market_research_suggestions']['Row']

export const marketResearch = {
  list: () => supabase.from('market_research').select(withLoc).order('created_at', { ascending: false }),
  get: (id: string) => supabase.from('market_research').select(withLoc).eq('id', id).single(),
  create: (row: T['market_research']['Insert']) => supabase.from('market_research').insert(row).select().single(),
  update: (id: string, patch: T['market_research']['Update']) =>
    supabase.from('market_research').update(patch).eq('id', id).select().single(),
  remove: (id: string) => supabase.from('market_research').delete().eq('id', id),
}

export const marketResearchDeals = {
  forResearch: (researchId: string) =>
    supabase
      .from('market_research_deals')
      .select('*')
      .eq('market_research_id', researchId)
      .order('created_at', { ascending: false }),
  create: (row: T['market_research_deals']['Insert']) =>
    supabase.from('market_research_deals').insert(row).select().single(),
  update: (id: string, patch: T['market_research_deals']['Update']) =>
    supabase.from('market_research_deals').update(patch).eq('id', id).select().single(),
  remove: (id: string) => supabase.from('market_research_deals').delete().eq('id', id),
}

export const marketResearchSuggestions = {
  forResearch: (researchId: string) =>
    supabase
      .from('market_research_suggestions')
      .select('*')
      .eq('market_research_id', researchId)
      .order('generated_at', { ascending: false }),
  acknowledge: (id: string, userId: string) =>
    supabase
      .from('market_research_suggestions')
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
      .eq('id', id),
}
export const siteViolations = {
  list: () => supabase.from('site_violations').select(withLoc).order('created_at', { ascending: false }),
  create: (row: T['site_violations']['Insert']) => supabase.from('site_violations').insert(row).select().single(),
  resolve: (id: string, userId: string, name: string, notes: string | null) =>
    supabase
      .from('site_violations')
      .update({ status: 'resolved', resolved_by: userId, resolved_by_name: name, resolved_at: new Date().toISOString(), resolution_notes: notes })
      .eq('id', id),
}
// Per-account customizable form schemas. One row per (account_id, form_key).
// Returns null when the account hasn't customized that form yet — the caller
// then falls back to the built-in default schema.
export const customForms = {
  get: (formKey: string) =>
    supabase.from('custom_forms').select('*').eq('form_key', formKey).maybeSingle(),
  upsert: (formKey: string, schema: unknown, userId: string, accountId: string) =>
    supabase
      .from('custom_forms')
      .upsert(
        { account_id: accountId, form_key: formKey, schema: schema as never, updated_by: userId, updated_at: new Date().toISOString() },
        { onConflict: 'account_id,form_key' },
      )
      .select()
      .single(),
}

export const attachments = {
  // metadata only — the data_uri blob is fetched separately on demand.
  metaForEntity: (type: string, id: string) =>
    supabase.from('ops_attachments').select('id, label, file_name, file_type, created_at').eq('entity_type', type).eq('entity_id', id).order('created_at'),
  data: (id: string) => supabase.from('ops_attachments').select('data_uri, file_name, file_type').eq('id', id).single(),
}
