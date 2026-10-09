import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// Per Diem reimbursement requests submitted to AP. RLS scopes reads: the submitter
// sees their own; account owners (AP) see everyone's.
type T = Database['public']['Tables']
export type PerDiemRequest = T['per_diem_requests']['Row']
export type PerDiemInsert = T['per_diem_requests']['Insert']

export const perDiem = {
  list: () =>
    supabase
      .from('per_diem_requests')
      .select('*')
      .order('created_at', { ascending: false }),
  create: (row: PerDiemInsert) =>
    supabase.from('per_diem_requests').insert(row).select().single(),
  update: (id: string, patch: T['per_diem_requests']['Update']) =>
    supabase.from('per_diem_requests').update(patch).eq('id', id),
  remove: (id: string) => supabase.from('per_diem_requests').delete().eq('id', id),
}
