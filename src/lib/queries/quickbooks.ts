import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import type { OpsInvoice } from '@/lib/queries/opsInvoices'

// QuickBooks Enterprise sync (migration 0199, qbwc edge function): the Web
// Connector login, the lists it brings back, and the bills waiting to go or
// already sent. Admins only (RLS).

type T = Database['public']['Tables']
export type QbConnection = Pick<T['qb_connections']['Row'],
  'account_id' | 'username' | 'owner_id' | 'file_id' | 'company_file' | 'qbxml_version' | 'last_contact_at'
  | 'last_error' | 'lists_requested_at' | 'lists_synced_at'>
export type QbListItem = T['qb_list_items']['Row']
export type QbJob = T['qb_jobs']['Row']
export type QbJobInsert = T['qb_jobs']['Insert']
export type QbJobStatus = 'queued' | 'sent' | 'posted' | 'failed' | 'unknown' | 'canceled'

const PAGE = 1000

export const quickbooks = {
  connection: async () => {
    const { data, error } = await supabase.from('qb_connections')
      .select('account_id, username, owner_id, file_id, company_file, qbxml_version, last_contact_at, last_error, lists_requested_at, lists_synced_at')
      .maybeSingle()
    return { data: (data as QbConnection | null) ?? null, error: error?.message ?? null }
  },
  // A new Web Connector password, shown once.
  newPassword: async () => {
    const { data, error } = await supabase.rpc('qb_new_password')
    const row = (data as { username: string; password: string }[] | null)?.[0] ?? null
    return { data: row, error: error?.message ?? null }
  },
  requestLists: () => supabase.rpc('qb_request_lists'),
  // Vendor lists run to thousands; PostgREST caps a response at 1,000 rows.
  listItems: async () => {
    const out: QbListItem[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from('qb_list_items').select('*')
        .order('list_type').order('list_id').range(from, from + PAGE - 1)
      if (error) return { data: null, error: error.message }
      out.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
    return { data: out, error: null }
  },
  approvedInvoices: async () => {
    const { data, error } = await supabase.from('ops_invoices').select('*').eq('status', 'approved')
      .order('invoice_date', { ascending: true, nullsFirst: false })
    return { data: (data as OpsInvoice[] | null) ?? [], error: error?.message ?? null }
  },
  jobs: async () => {
    const { data, error } = await supabase.from('qb_jobs').select('*').order('created_at', { ascending: false }).limit(300)
    return { data: (data as QbJob[] | null) ?? [], error: error?.message ?? null }
  },
  queueBills: (rows: QbJobInsert[]) => supabase.from('qb_jobs').insert(rows).select('id'),
  setJobStatus: (id: string, status: 'queued' | 'canceled') => supabase.from('qb_jobs').update({ status }).eq('id', id),
  // An unanswered bill someone found in QuickBooks: mark it entered and its
  // invoice exported, like the Web Connector would have.
  confirmPosted: async (job: QbJob, by: { id: string; name: string }) => {
    const { error } = await supabase.from('qb_jobs').update({ status: 'posted' }).eq('id', job.id).eq('status', 'unknown')
    if (error || !job.invoice_id) return { error: error?.message ?? null }
    const { error: e2 } = await supabase.from('ops_invoices').update({
      status: 'exported', exported_at: new Date().toISOString(), exported_by: by.id, exported_by_name: `${by.name} (found in QuickBooks)`,
    }).eq('id', job.invoice_id).eq('status', 'approved')
    return { error: e2?.message ?? null }
  },
}
