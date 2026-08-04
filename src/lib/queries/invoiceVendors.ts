// Master vendor list for Invoice Approval. Seeded from the account's vendor
// sheet; powers the AI match on inbound and the vendor dropdown in the modal.
import { supabase } from '@/lib/supabase'

export const invoiceVendors = {
  list: () => supabase.from('invoice_vendors').select('name').eq('active', true).order('name'),
}
