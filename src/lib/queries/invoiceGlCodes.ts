// GL code list for Invoice Approval, seeded from the account's chart of accounts
// (GL List.xlsx). Powers the GL code dropdown in the invoice modal. Codes are
// stored and shown VERBATIM (e.g. "70000 · Sales and Marketing:700001 · Advertising").
import { supabase } from '@/lib/supabase'

export const invoiceGlCodes = {
  list: () => supabase.from('invoice_gl_codes').select('code').eq('active', true).order('sort_order'),
}
