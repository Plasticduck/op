import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type MaintenanceOrder = T['maintenance_orders']['Row']
// Hydrated row used by the list: includes the site name.
export type MaintenanceOrderRow = MaintenanceOrder & { location: { name: string } | null }

// Order statuses mirror the signage order tracker.
export const MAINTENANCE_ORDER_STATUSES = [
  { value: 'ordered', label: 'Ordered' },
  { value: 'in_production', label: 'In Production' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

export const maintenanceOrders = {
  // Every order the caller can see. RLS scopes rows to the caller's own orders
  // (requested_by); kevan@washlyfe.com sees all of the account's orders for the
  // admin tracker.
  list: () =>
    supabase
      .from('maintenance_orders')
      .select('*, location:location_id(name)')
      .order('created_at', { ascending: false }),
  create: (row: T['maintenance_orders']['Insert']) =>
    supabase.from('maintenance_orders').insert(row).select().single(),
  // Admin tracker only (RLS gates to manager+).
  updateStatus: (id: string, patch: { status?: string; tracking_number?: string | null; status_updated_at?: string }) =>
    supabase.from('maintenance_orders').update(patch).eq('id', id),
  remove: (id: string) => supabase.from('maintenance_orders').delete().eq('id', id),
  // Best-effort: email the maintenance team (+ a confirmation to the placer) when
  // a new order is placed.
  emailOrder: (orderId: string) =>
    supabase.functions.invoke('maintenance-order-email', { body: { order_id: orderId } }),

  // Upload one photo to the private bucket under the account folder, returning its
  // storage path. Uploaded BEFORE the order row is inserted (order UPDATE is
  // manager-only), so the path can be saved on the row at creation.
  uploadPhoto: async (accountId: string, file: File): Promise<{ path: string | null; error: { message: string } | null }> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${accountId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage
      .from('maintenance-order-photos')
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
    return { path: error ? null : path, error: error ? { message: error.message } : null }
  },
  // Signed URLs for a set of photo paths, returned as a path -> url map.
  photoUrls: async (paths: string[], expiresIn = 3600): Promise<Record<string, string>> => {
    if (!paths.length) return {}
    const { data } = await supabase.storage.from('maintenance-order-photos').createSignedUrls(paths, expiresIn)
    const map: Record<string, string> = {}
    for (const d of data ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl
    return map
  },
}
