// Invoice Approval data. Rows are created by the invoice-inbound edge function
// (emailed-in invoices) or added by hand from the page, and land here scoped to
// the caller's account by RLS.
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type OpsInvoice = Database['public']['Tables']['ops_invoices']['Row']
export type OpsInvoiceInsert = Database['public']['Tables']['ops_invoices']['Insert']
export type OpsInvoiceUpdate = Database['public']['Tables']['ops_invoices']['Update']

// Same matching the invoice-inbound function uses to flag duplicates.
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const normNumber = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')

export const opsInvoices = {
  list: () =>
    supabase.from('ops_invoices').select('*').order('submitted_at', { ascending: false }),

  // A manually added invoice. Mirrors what invoice-inbound files for an emailed
  // one, so it starts in Unassigned and runs through the same workflow.
  create: (row: OpsInvoiceInsert) =>
    supabase.from('ops_invoices').insert(row).select().single(),

  // Store the invoice document at the same path layout invoice-inbound uses:
  // {account_id}/{invoice_id}/{file name}.
  uploadFile: async (accountId: string, invoiceId: string, file: File) => {
    const path = `${accountId}/${invoiceId}/${file.name}`
    const { error } = await supabase.storage
      .from('ops-invoices')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    return { error, path: error ? null : path }
  },

  // Earliest prior invoice with the same vendor + invoice number, if any.
  findDuplicate: async (invoiceNumber: string | null, vendorName: string): Promise<string | null> => {
    if (!invoiceNumber?.trim()) return null
    const { data } = await supabase
      .from('ops_invoices')
      .select('id, invoice_number, vendor_name')
      .not('invoice_number', 'is', null)
      .neq('status', 'cancelled')
      .order('submitted_at', { ascending: true })
    const hit = (data ?? []).find((p) =>
      normNumber(String(p.invoice_number ?? '')) === normNumber(invoiceNumber) &&
      normName(String(p.vendor_name ?? '')) === normName(vendorName))
    return hit?.id ?? null
  },

  update: (id: string, patch: OpsInvoiceUpdate) =>
    supabase.from('ops_invoices').update(patch).eq('id', id).select().single(),

  // Bulk transition (used to mark a batch of approved invoices exported).
  updateMany: (ids: string[], patch: OpsInvoiceUpdate) =>
    supabase.from('ops_invoices').update(patch).in('id', ids).select('id'),

  // Hard-delete an invoice (Needs Attention > Delete Invoice). Best-effort
  // removes the stored file first so it isn't orphaned.
  // Non-admins can't delete (RLS locks it to kevan@washlyfe.com); they request
  // deletion, which emails the admin a link to the invoice.
  requestDelete: (invoiceId: string, reason?: string) =>
    supabase.functions.invoke('invoice-delete-request', { body: { invoice_id: invoiceId, reason } }),

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
