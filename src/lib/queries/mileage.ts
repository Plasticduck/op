import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// Mileage reimbursement requests submitted to AP. RLS scopes reads: the submitter
// sees their own; account owners and the finance team (AP) see everyone's. Flow:
// draft -> submitted -> approved.
type T = Database['public']['Tables']
export type MileageRequest = T['mileage_requests']['Row']
export type MileageInsert = T['mileage_requests']['Insert']
export type MileageUpdate = T['mileage_requests']['Update']

// A single stop on the route, stored in the `stops` jsonb column.
export type RouteStop = { address: string; lat: number | null; lon: number | null }

export const mileage = {
  list: () =>
    supabase
      .from('mileage_requests')
      .select('*')
      .order('created_at', { ascending: false }),
  create: (row: MileageInsert) =>
    supabase.from('mileage_requests').insert(row).select().single(),
  update: (id: string, patch: MileageUpdate) =>
    supabase.from('mileage_requests').update(patch).eq('id', id),
  remove: (id: string) => supabase.from('mileage_requests').delete().eq('id', id),
}
