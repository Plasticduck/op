import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']

export type Part = T['parts']['Row']
export type PartInsert = T['parts']['Insert']
export type PartUpdate = T['parts']['Update']
export type PartStock = T['parts_inventory']['Row']
export type PartRestockLog = T['part_restock_log']['Row']

// Hydrated row used by the list view: includes the vendor, aggregated stock
// across all locations, and the minimum-in-stock for the Needs Restock filter.
export type PartRow = Part & {
  vendor: { id: string; name: string } | null
  stock: Array<{ location_id: string; quantity_on_hand: number; minimum_in_stock: number; location: { id: string; name: string } | null }>
}

export const parts = {
  list: () =>
    supabase
      .from('parts')
      .select(`
        *,
        vendor:vendors(id, name),
        stock:parts_inventory(location_id, quantity_on_hand, minimum_in_stock, location:locations(id, name))
      `)
      .order('part_number'),

  byId: (id: string) =>
    supabase
      .from('parts')
      .select(`
        *,
        vendor:vendors(id, name),
        stock:parts_inventory(id, location_id, quantity_on_hand, minimum_in_stock, location:locations(id, name)),
        asset_links:part_assets(asset:equipment(id, asset_number, name))
      `)
      .eq('id', id)
      .single(),

  byQr: (qr: string) =>
    supabase.from('parts').select('id, name, part_number').eq('qr_code', qr).maybeSingle(),

  create: (row: Omit<PartInsert, 'part_number' | 'qr_code'>) =>
    supabase.from('parts').insert(row as PartInsert).select().single(),

  update: (id: string, patch: PartUpdate) =>
    supabase.from('parts').update(patch).eq('id', id).select().single(),

  remove: (id: string) => supabase.from('parts').delete().eq('id', id),

  // Stock: create the per-location row the first time, or update quantity.
  upsertStock: (partId: string, locationId: string, quantity: number, minimum: number) =>
    supabase
      .from('parts_inventory')
      .upsert({
        part_id: partId,
        location_id: locationId,
        name: '', // legacy required field; gets set by trigger? No — keep empty for now
        quantity_on_hand: quantity,
        minimum_in_stock: minimum,
        reorder_threshold: minimum,
        unit_cost: 0,
      } as T['parts_inventory']['Insert'], { onConflict: 'part_id,location_id' })
      .select()
      .single(),

  removeStock: (id: string) =>
    supabase.from('parts_inventory').delete().eq('id', id),

  // Restock = log + bump stock. Two writes; the log entry is what survives.
  restock: async (opts: {
    partId: string
    locationId: string
    quantityAdded: number
    unitCost: number | null
    notes: string | null
    userId: string | null
    userName: string
  }) => {
    const { data: existing } = await supabase
      .from('parts_inventory')
      .select('id, quantity_on_hand')
      .eq('part_id', opts.partId)
      .eq('location_id', opts.locationId)
      .maybeSingle()
    const newQty = (existing?.quantity_on_hand ?? 0) + opts.quantityAdded
    if (existing) {
      await supabase
        .from('parts_inventory')
        .update({ quantity_on_hand: newQty, last_updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabase.from('parts_inventory').insert({
        part_id: opts.partId,
        location_id: opts.locationId,
        name: '',
        quantity_on_hand: opts.quantityAdded,
        minimum_in_stock: 0,
        reorder_threshold: 0,
        unit_cost: opts.unitCost ?? 0,
      } as T['parts_inventory']['Insert'])
    }
    return supabase.from('part_restock_log').insert({
      part_id: opts.partId,
      location_id: opts.locationId,
      quantity_added: opts.quantityAdded,
      unit_cost_at_time: opts.unitCost,
      notes: opts.notes,
      restocked_by: opts.userId,
      restocked_by_name: opts.userName,
    })
  },

  history: (partId: string) =>
    supabase
      .from('part_restock_log')
      .select('*, location:locations(id, name)')
      .eq('part_id', partId)
      .order('created_at', { ascending: false }),

  // Many-to-many assets
  linkedAssets: (partId: string) =>
    supabase
      .from('part_assets')
      .select('asset:equipment(id, asset_number, name)')
      .eq('part_id', partId),

  setLinkedAssets: async (partId: string, assetIds: string[]) => {
    await supabase.from('part_assets').delete().eq('part_id', partId)
    if (assetIds.length > 0) {
      await supabase
        .from('part_assets')
        .insert(assetIds.map((a) => ({ part_id: partId, asset_id: a })))
    }
  },
}

// Helper: total stock across all locations for a part.
export function totalStock(row: PartRow | { stock: Array<{ quantity_on_hand: number }> }): number {
  return row.stock.reduce((a, s) => a + Number(s.quantity_on_hand ?? 0), 0)
}

// Helper: does this part need restock? True if any stock row is below its
// minimum_in_stock.
export function needsRestock(row: PartRow | { stock: Array<{ quantity_on_hand: number; minimum_in_stock: number }> }): boolean {
  return row.stock.some((s) => Number(s.quantity_on_hand) < Number(s.minimum_in_stock ?? 0))
}
