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

  // Hard-delete an invoice (Needs Attention > Delete Invoice). Best-effort
  // removes the stored file first so it isn't orphaned.
  remove: async (id: string, filePath?: string | null) => {
    if (filePath) await supabase.storage.from('ops-invoices').remove([filePath])
    return supabase.from('ops_invoices').delete().eq('id', id)
  },

  // Short-lived signed URL to view/download an emailed-in invoice file.
  fileUrl: async (path: string): Promise<string | null> => {
    const { data } = await supabase.storage.from('ops-invoices').createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  },

  // Signed URL that forces a download (Content-Disposition attachment) instead
  // of opening in the browser.
  downloadUrl: async (path: string): Promise<string | null> => {
    const { data } = await supabase.storage.from('ops-invoices').createSignedUrl(path, 3600, { download: true })
    return data?.signedUrl ?? null
  },
}
