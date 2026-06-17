import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']

// We use the legacy `equipment` table under the hood. The Asset type is just
// a renamed view of the equipment row so the rest of the app reads naturally.
export type Asset = T['equipment']['Row']
export type AssetInsert = T['equipment']['Insert']
export type AssetUpdate = T['equipment']['Update']
export type AssetPhoto = T['asset_photos']['Row']

export type AssetCriticality = 'none' | 'low' | 'medium' | 'high'
export type AssetStatus = 'online' | 'offline_planned' | 'offline_unplanned' | 'retired'

// Hydrated row used by the list: includes the parent, children count, and
// open-work-orders count for visible badges.
export type AssetRow = Asset & {
  location: { id: string; name: string } | null
  parent: { id: string; name: string; asset_number: number } | null
  sub_count: { count: number }[]
  open_wo_count: { count: number }[]
}

export const STATUS_LABEL: Record<AssetStatus, string> = {
  online: 'Online',
  offline_planned: 'Offline (Planned)',
  offline_unplanned: 'Offline (Unplanned)',
  retired: 'Retired',
}

export const STATUS_TONE: Record<AssetStatus, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  online: 'ok',
  offline_planned: 'warn',
  offline_unplanned: 'danger',
  retired: 'neutral',
}

export const CRITICALITY_LABEL: Record<AssetCriticality, string> = {
  none: 'Normal',
  low: 'Low',
  medium: 'Important',
  high: 'Critical',
}

export const CRITICALITY_TONE: Record<AssetCriticality, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  none: 'neutral',
  low: 'ok',
  medium: 'warn',
  high: 'danger',
}

export const assets = {
  list: (opts?: { locationId?: string | null }) => {
    let q = supabase
      .from('equipment')
      .select(`
        *,
        location:locations(id, name),
        parent:equipment!parent_asset_id(id, name, asset_number),
        sub_count:equipment!parent_asset_id(count),
        open_wo_count:work_orders!equipment_id(count)
      `)
      .order('asset_number')
    if (opts?.locationId) q = q.eq('location_id', opts.locationId)
    return q
  },

  byId: (id: string) =>
    supabase
      .from('equipment')
      .select(`
        *,
        location:locations(id, name),
        parent:equipment!parent_asset_id(id, name, asset_number),
        sub_assets:equipment!parent_asset_id(id, name, asset_number, status, criticality),
        photos:asset_photos(*)
      `)
      .eq('id', id)
      .single(),

  byQr: (qr: string) =>
    supabase.from('equipment').select('id, name, asset_number').eq('qr_code', qr).maybeSingle(),

  // asset_number is filled in by a BEFORE-INSERT trigger; the generated type
  // marks it required so we accept a looser payload and cast at the boundary.
  create: (row: Omit<AssetInsert, 'asset_number'>) =>
    supabase.from('equipment').insert(row as AssetInsert).select().single(),

  update: (id: string, patch: AssetUpdate) =>
    supabase.from('equipment').update(patch).eq('id', id).select().single(),

  remove: (id: string) => supabase.from('equipment').delete().eq('id', id),

  // Work-order history for this asset, with the assignees joined so the
  // History tab can render avatars without a second round trip.
  workOrderHistory: (assetId: string) =>
    supabase
      .from('work_orders')
      .select('id, number, title, status, priority, completed_at, created_at, assignees:work_order_assignees(user_name)')
      .eq('equipment_id', assetId)
      .order('created_at', { ascending: false }),

  uploadPhoto: async (accountId: string, assetId: string, file: File, caption?: string) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${accountId}/${assetId}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('asset-photos')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) return { error: upErr, data: null }
    return supabase
      .from('asset_photos')
      .insert({ asset_id: assetId, storage_path: path, caption: caption ?? null })
      .select()
      .single()
  },

  removePhoto: async (id: string, storagePath: string) => {
    await supabase.storage.from('asset-photos').remove([storagePath])
    return supabase.from('asset_photos').delete().eq('id', id)
  },

  photoSignedUrl: async (path: string, expiresIn = 3600) => {
    const { data, error } = await supabase.storage.from('asset-photos').createSignedUrl(path, expiresIn)
    return { error, url: data?.signedUrl ?? null }
  },
}
