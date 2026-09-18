import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// Facilities service board: internal requests-for-service with a progress log.
// RLS scopes rows to the account (and the requester's sites); manager+/technician
// work them. Distinct from the MaintainX Work Orders.
type T = Database['public']['Tables']
export type FacilityRequest = T['facility_requests']['Row'] & { location?: { name: string } | null }
export type FacilityRequestInsert = T['facility_requests']['Insert']
export type FacilityRequestPatch = T['facility_requests']['Update']
export type FacilityUpdate = T['facility_request_updates']['Row']

const withLoc = '*, location:location_id(name)'

export const facilities = {
  list: () =>
    supabase.from('facility_requests').select(withLoc).order('created_at', { ascending: false }),
  create: (row: FacilityRequestInsert) =>
    supabase.from('facility_requests').insert(row).select(withLoc).single(),
  update: (id: string, patch: FacilityRequestPatch) =>
    supabase
      .from('facility_requests')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(withLoc)
      .single(),
  remove: (id: string) => supabase.from('facility_requests').delete().eq('id', id),

  updates: (requestId: string) =>
    supabase.from('facility_request_updates').select('*').eq('request_id', requestId).order('created_at', { ascending: true }),
  addUpdate: (row: T['facility_request_updates']['Insert']) =>
    supabase.from('facility_request_updates').insert(row).select().single(),
}
