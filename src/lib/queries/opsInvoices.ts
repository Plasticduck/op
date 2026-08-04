// Invoice Approval data. Rows are created by the invoice-inbound edge function
// (emailed-in invoices) and land here scoped to the caller's account by RLS.
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type OpsInvoice = Database['public']['Tables']['ops_invoices']['Row']
export type OpsInvoiceUpdate = Database['public']['Tables']['ops_invoices']['Update']

export const opsInvoices = {
  list: () =>
    supabase.from('ops_invoices').select('*').order('submitted_at', { ascending: false }),

  update: (id: string, patch: OpsInvoiceUpdate) =>
    supabase.from('ops_invoices').update(patch).eq('id', id).select().single(),

  // Bulk transition (used to mark a batch of approved invoices exported).
  updateMany: (ids: string[], patch: OpsInvoiceUpdate) =>
    supabase.from('ops_invoices').update(patch).in('id', ids).select('id'),

  // Email the assigned approver that an invoice is waiting on them.
  notifyAssignment: (invoiceId: string) =>
    supabase.functions.invoke('notify-invoice-assignment', { body: { invoice_id: invoiceId } }),

  // Short-lived signed URL to view/download an emailed-in invoice file.
  fileUrl: async (path: string): Promise<string | null> => {
    const { data } = await supabase.storage.from('ops-invoices').createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  },
}
