import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// IT Inventory: every piece of IT gear and recurring IT service, by site. RLS:
// owners, managers and technicians; managers see their own sites plus anything
// with no site (office or storage). it_asset_events is the record's history:
// moves, status changes, reassignments and in-person checks are logged by a DB
// trigger, so the page only ever inserts notes and repairs by hand.
type T = Database['public']['Tables']
export type ItAsset = T['it_assets']['Row']
export type ItAssetRow = ItAsset & { location: { name: string } | null }
export type ItAssetInsert = T['it_assets']['Insert']
export type ItAssetPatch = T['it_assets']['Update']
export type ItAssetEvent = T['it_asset_events']['Row']

const SELECT = '*, location:location_id(name)'

export const itInventory = {
  list: () => supabase.from('it_assets').select(SELECT).order('asset_number', { ascending: true }),
  get: (id: string) => supabase.from('it_assets').select(SELECT).eq('id', id).maybeSingle(),
  // asset_number 0 = take the next tag number (assigned by trigger).
  create: (row: ItAssetInsert) =>
    supabase.from('it_assets').insert({ ...row, asset_number: 0 }).select('id, asset_number').single(),
  update: (id: string, patch: ItAssetPatch) => supabase.from('it_assets').update(patch).eq('id', id),
  markVerified: (id: string) =>
    supabase.from('it_assets').update({ last_verified_at: new Date().toISOString() }).eq('id', id),
  remove: (id: string) => supabase.from('it_assets').delete().eq('id', id),

  events: (assetId: string) =>
    supabase
      .from('it_asset_events')
      .select('*')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false }),
  addEvent: (row: {
    account_id: string
    asset_id: string
    kind: 'note' | 'repair'
    summary: string
    actor_id: string
    actor_name: string | null
  }) => supabase.from('it_asset_events').insert(row),
}
