// Household Finder — admin-only view of DRB/SiteWatch customers clustered into
// likely households (by shared residential address) and grouped by region. The
// data is produced by the `sync-drb-households` edge function and stored in the
// `drb_households` / `drb_household_members` tables (owner-only RLS). This module
// is the single typed entry point the page uses.

import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// The drb_household* tables aren't in the generated Database types yet, so reach
// them through a loosely-typed handle. Swap back to the typed client once
// database.types.ts has been regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export type HouseholdMember = {
  id: string
  household_id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
}

export type Household = {
  id: string
  region: string | null
  address: string | null
  zip: string | null
  member_count: number
  match_type: string
  synced_at: string
}

export type RegionSummary = { region: string; households: number; people: number }

export type HouseholdSyncResult = {
  ok?: boolean
  households: number
  members: number
  by_region: Record<string, number>
  synced_at?: string
}

// Region display order, so the summary always reads the same way.
export const REGION_ORDER = ['Lubbock', 'Permian Basin', 'New Mexico', 'Central Texas', 'Other']

export function regionRank(region: string): number {
  const i = REGION_ORDER.indexOf(region)
  return i === -1 ? REGION_ORDER.length : i
}

export async function householdsSyncedAt(): Promise<string | null> {
  const { data } = await db
    .from('drb_households')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.synced_at ?? null
}

export async function regionSummary(): Promise<RegionSummary[]> {
  const { data, error } = await db.from('drb_households').select('region, member_count')
  if (error) throw error
  const map = new Map<string, { households: number; people: number }>()
  for (const r of (data ?? []) as { region: string | null; member_count: number | null }[]) {
    const key = r.region ?? 'Other'
    const cur = map.get(key) ?? { households: 0, people: 0 }
    cur.households += 1
    cur.people += r.member_count ?? 0
    map.set(key, cur)
  }
  return [...map.entries()]
    .map(([region, v]) => ({ region, households: v.households, people: v.people }))
    .sort((a, b) => regionRank(a.region) - regionRank(b.region))
}

export async function listHouseholds(region?: string): Promise<Household[]> {
  let q = db
    .from('drb_households')
    .select('id, region, address, zip, member_count, match_type, synced_at')
    .order('member_count', { ascending: false })
    .order('address', { ascending: true })
    .limit(2000)
  if (region && region !== 'All') q = q.eq('region', region)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Household[]
}

export async function listMembers(householdId: string): Promise<HouseholdMember[]> {
  const { data, error } = await db
    .from('drb_household_members')
    .select('id, household_id, full_name, first_name, last_name, phone, email')
    .eq('household_id', householdId)
    .order('last_name', { ascending: true })
  if (error) throw error
  return (data ?? []) as HouseholdMember[]
}

export async function runHouseholdSync(): Promise<HouseholdSyncResult> {
  const { data, error } = await supabase.functions.invoke('sync-drb-households', { body: {} })
  if (error) throw new Error(await fnErrorMessage(error, data, 'Household sync failed.'))
  return data as HouseholdSyncResult
}
