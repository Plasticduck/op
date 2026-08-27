// Household Finder — admin-only view of active DRB members clustered into likely
// households (by shared residential address, shared phone, or shared payment
// card) and grouped by region. The data is produced by the `sync-drb-households`
// edge function and stored in the `drb_households` / `drb_household_members`
// tables (owner-only RLS). This module is the single typed entry point.

import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// The drb_household* tables aren't in the generated Database types yet, so reach
// them through a loosely-typed handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export type MatchType = 'address' | 'phone' | 'card'

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
  match_type: MatchType
  match_value: string | null
  card_last4: string | null
  address: string | null
  zip: string | null
  member_count: number
  synced_at: string
}

export type RegionSummary = { region: string; households: number; people: number }
export type TypeCount = { match_type: MatchType; households: number; people: number }

export type HouseholdSyncTotals = Record<string, number>
type SyncStep = { ok?: boolean; done: boolean; cursor: { t: number; page: number } | null; processed: Record<string, number> }

export const REGION_ORDER = ['Lubbock', 'Permian Basin', 'New Mexico', 'Central Texas', 'Other']
export const MATCH_LABEL: Record<MatchType, string> = {
  address: 'Address',
  phone: 'Phone',
  card: 'Card',
}

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

export async function typeCounts(): Promise<TypeCount[]> {
  const { data, error } = await db.from('drb_households').select('match_type, member_count')
  if (error) throw error
  const map = new Map<MatchType, { households: number; people: number }>()
  for (const r of (data ?? []) as { match_type: MatchType; member_count: number | null }[]) {
    const cur = map.get(r.match_type) ?? { households: 0, people: 0 }
    cur.households += 1
    cur.people += r.member_count ?? 0
    map.set(r.match_type, cur)
  }
  return (['address', 'phone', 'card'] as MatchType[]).map((t) => ({
    match_type: t,
    households: map.get(t)?.households ?? 0,
    people: map.get(t)?.people ?? 0,
  }))
}

export async function regionSummary(matchType: MatchType): Promise<RegionSummary[]> {
  const { data, error } = await db
    .from('drb_households')
    .select('region, member_count')
    .eq('match_type', matchType)
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

export async function listHouseholds(matchType: MatchType, region?: string): Promise<Household[]> {
  let q = db
    .from('drb_households')
    .select('id, region, match_type, match_value, card_last4, address, zip, member_count, synced_at')
    .eq('match_type', matchType)
    .order('member_count', { ascending: false })
    .order('match_value', { ascending: true })
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

// The sync is resumable: the edge function does as many 1000-row pages as fit in
// a safe time budget and hands back a cursor. We loop { reset } then { cursor }
// until done, surfacing running totals so the page can show progress. Each call
// can take ~60-90s, so a full run is several minutes.
export async function runHouseholdSync(onProgress?: (totals: HouseholdSyncTotals) => void): Promise<HouseholdSyncTotals> {
  let cursor: { t: number; page: number } | null = null
  let reset = true
  const totals: HouseholdSyncTotals = {}
  for (let i = 0; i < 60; i++) {
    const { data, error } = await supabase.functions.invoke('sync-drb-households', {
      body: reset ? { reset: true } : { cursor },
    })
    if (error) throw new Error(await fnErrorMessage(error, data, 'Household sync failed.'))
    reset = false
    const step = data as SyncStep
    for (const [k, v] of Object.entries(step.processed ?? {})) totals[k] = (totals[k] ?? 0) + v
    onProgress?.({ ...totals })
    if (step.done) break
    cursor = step.cursor
  }
  return totals
}
