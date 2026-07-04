import { supabase } from '@/lib/supabase'
import { SITE_URL } from '@/lib/siteUrl'
import type { Role } from '@/lib/rbac'

// Roles that can be handed out via an invite link. Owner is set only at account
// creation, never invited.
export type InvitableRole = Exclude<Role, 'owner'>

export type AccountUser = {
  id: string
  name: string
  email: string
  role: Role
  location_ids: string[]
  last_seen_at: string | null
  created_at: string
}

export type Invitation = {
  id: string
  email: string
  role: InvitableRole
  location_ids: string[]
  token: string
  status: 'pending' | 'accepted' | 'expired'
  created_at: string
  expires_at: string
}

export type LocationFull = {
  id: string
  account_id: string
  name: string
  address: string | null
  timezone: string
  closeout_time: string
  overtime_threshold_hours: number
  pay_period_type: string
  downtime_alert_hours: number
  latitude: number | null
  longitude: number | null
  geofence_radius_m: number
  require_geofence: boolean
  require_punch_photo: boolean
  archived: boolean
  created_at: string
}

export async function listUsers() {
  return supabase
    .from('users')
    .select('id, name, email, role, location_ids, last_seen_at, created_at')
    .order('created_at')
}

export async function updateUserRoleLocations(
  id: string,
  role: Role,
  location_ids: string[],
) {
  return supabase.from('users').update({ role, location_ids }).eq('id', id)
}

export async function removeUser(id: string) {
  return supabase.from('users').delete().eq('id', id)
}

export async function listInvitations() {
  return supabase
    .from('invitations')
    .select('id, email, role, location_ids, token, status, created_at, expires_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
}

export async function createInvitation(params: {
  account_id: string
  invited_by: string
  email: string
  role: InvitableRole
  location_ids: string[]
}) {
  return supabase.from('invitations').insert(params).select().single()
}

export async function revokeInvitation(id: string) {
  return supabase.from('invitations').delete().eq('id', id)
}

export async function resendInvitation(id: string) {
  // Fresh 72h window. Token stays the same so existing links keep working.
  const expires_at = new Date(Date.now() + 72 * 3600 * 1000).toISOString()
  return supabase.from('invitations').update({ expires_at }).eq('id', id).select().single()
}

export async function listAllLocations() {
  return supabase
    .from('locations')
    .select('*')
    .order('archived')
    .order('name')
}

export async function createLocation(params: {
  account_id: string
  name: string
  address?: string | null
  timezone: string
  latitude?: number | null
  longitude?: number | null
}) {
  return supabase.from('locations').insert(params).select().single()
}

export async function updateLocation(
  id: string,
  patch: Partial<Omit<LocationFull, 'id' | 'account_id' | 'created_at'>>,
) {
  return supabase.from('locations').update(patch).eq('id', id)
}

// Permanently delete a location. Destructive: related records cascade-delete.
export async function deleteLocation(id: string) {
  return supabase.from('locations').delete().eq('id', id)
}

export function inviteUrl(token: string) {
  return `${SITE_URL}/invite/${token}`
}
