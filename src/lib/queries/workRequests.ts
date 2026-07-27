import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type WorkRequest = T['work_requests']['Row']
export type WorkRequestPortal = T['work_request_portals']['Row']

export type WorkRequestRow = WorkRequest & { location: { id: string; name: string } | null }
export type PortalRow = WorkRequestPortal & { location: { id: string; name: string } | null }

export type PortalInfo = { ok: true; name: string; fixedLocation: boolean; locations: Array<{ id: string; name: string }> }

export const workRequests = {
  list: (status?: 'pending' | 'approved' | 'declined' | 'all') => {
    let q = supabase
      .from('work_requests')
      .select('*, location:locations(id, name)')
      .order('created_at', { ascending: false })
    if (status && status !== 'all') q = q.eq('status', status)
    return q
  },

  review: (id: string, patch: T['work_requests']['Update']) =>
    supabase.from('work_requests').update(patch).eq('id', id).select().single(),

  // --- portals (admin) ---------------------------------------------------
  portals: () =>
    supabase.from('work_request_portals').select('*, location:locations(id, name)').order('created_at'),
  createPortal: (row: T['work_request_portals']['Insert']) =>
    supabase.from('work_request_portals').insert(row).select().single(),
  updatePortal: (id: string, patch: T['work_request_portals']['Update']) =>
    supabase.from('work_request_portals').update(patch).eq('id', id).select().single(),
  removePortal: (id: string) => supabase.from('work_request_portals').delete().eq('id', id),

  // --- public (no auth) --------------------------------------------------
  portalInfo: (token: string) =>
    supabase.functions.invoke('work-request-portal', { body: { action: 'info', token } }),
  submitPublic: (payload: {
    token: string
    title: string
    description?: string
    priority?: string
    location_id: string
    requester_name?: string
    requester_email?: string
  }) => supabase.functions.invoke('work-request-portal', { body: { action: 'submit', ...payload } }),
}

// The shareable public URL for a portal token.
export function portalUrl(token: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://operator.washlyfe.com'
  return `${base}/request/${token}`
}
