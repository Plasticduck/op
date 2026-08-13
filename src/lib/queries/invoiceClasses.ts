// QuickBooks class list for Invoice Approval (the sites), seeded VERBATIM from
// the account's Class List. Powers the Site(s) dropdown in the invoice modal and
// the "Class" column in the QuickBooks export. Stored/shown exactly as in QB
// (e.g. "22- 87th and Evans Odessa", "08 - IBA").
import { supabase } from '@/lib/supabase'

export const invoiceClasses = {
  list: () => supabase.from('invoice_classes').select('class').eq('active', true).order('sort_order'),
}
