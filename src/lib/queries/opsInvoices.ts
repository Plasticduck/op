// Invoice Approval data. Rows are created by the invoice-inbound edge function
// (emailed-in invoices) and land here scoped to the caller's account by RLS.
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type OpsInvoice = Database['public']['Tables']['ops_invoices']['Row']

export const opsInvoices = {
  list: () =>
    supabase.from('ops_invoices').select('*').order('submitted_at', { ascending: false }),

  // Short-lived signed URL to view/download an emailed-in invoice file.
  fileUrl: async (path: string): Promise<string | null> => {
    const { data } = await supabase.storage.from('ops-invoices').createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  },
}
