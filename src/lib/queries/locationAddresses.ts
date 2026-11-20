import { supabase } from '@/lib/supabase'

// A site's other addresses (migration 0258). MW34 is three car washes in Hereford
// and still one site: the main address stays on locations, the rest are here. They
// show on the maps, count toward Site Visits, and pass the time clock geofence.
export type LocationAddress = {
  id: string
  location_id: string
  address: string
  latitude: number | null
  longitude: number | null
}

const COLS = 'id, location_id, address, latitude, longitude'

export const locationAddresses = {
  list: () => supabase.from('location_addresses').select(COLS).order('created_at'),

  listFor: (locationId: string) =>
    supabase.from('location_addresses').select(COLS).eq('location_id', locationId).order('created_at'),

  add: (row: { account_id: string; location_id: string; address: string; latitude: number | null; longitude: number | null }) =>
    supabase.from('location_addresses').insert(row).select(COLS).single(),

  // Returns the deleted row so a no-op (not allowed) can be told apart from success.
  remove: (id: string) => supabase.from('location_addresses').delete().eq('id', id).select('id'),
}
