// Mighty Wash vehicle GPS from Verizon Connect Reveal. Live positions go
// through the reveal-fleet edge function, which holds the Reveal credentials
// server-side. Site visits are synced hourly into vehicle_site_visits by
// reveal-visits-sync (0178). Pre-launch: kevan@washlyfe.com only (enforced in
// the functions and by RLS).
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type SiteVisit = T['vehicle_site_visits']['Row']
export type FleetPerson = T['fleet_people']['Row']
export type FleetCategory = 'regional_manager' | 'maintenance' | 'other'
export const FLEET_CATEGORY_LABEL: Record<FleetCategory, string> = {
  regional_manager: 'Regional Manager',
  maintenance: 'Maintenance',
  other: 'Other',
}

export type FleetVehicle = {
  number: string
  name: string // cleaned Reveal vehicle name, usually the assigned person
  vehicle: string | null // "2024 Nissan Frontier"
  driver: string | null // driver on the latest GPS plot
  lat: number
  lng: number
  address: string | null
  city: string | null
  status: string | null // 'Moving' | 'Idle' | 'Stop'
  speed_mph: number | null
  heading: string | null // "North East"
  direction: number | null // degrees
  geofence: string | null
  updated_at: string | null // ISO, UTC
}
// Vehicles Reveal can't place: no vehicle number set in Reveal, no GPS yet, or
// marked private.
export type FleetMissing = { name: string; reason: 'no_vehicle_number' | 'no_data' | 'private' }
export type FleetLive = { fetched_at: string; vehicles: FleetVehicle[]; missing: FleetMissing[] }

export const fleet = {
  live: async (): Promise<FleetLive> => {
    const { data, error } = await supabase.functions.invoke('reveal-fleet', { body: { action: 'live' } })
    if (error) throw error
    return data as FleetLive
  },
}

export const siteVisits = {
  // Every visit arriving on or after `sinceIso` (optionally before `untilIso`),
  // newest first, paged past the 1000-row API cap.
  between: async (sinceIso: string, untilIso?: string): Promise<SiteVisit[]> => {
    const out: SiteVisit[] = []
    for (let from = 0; ; from += 1000) {
      let q = supabase.from('vehicle_site_visits').select('*').gte('arrived_at', sinceIso)
      if (untilIso) q = q.lt('arrived_at', untilIso)
      const { data, error } = await q.order('arrived_at', { ascending: false }).range(from, from + 999)
      if (error) throw error
      out.push(...(data ?? []))
      if (!data || data.length < 1000) return out
    }
  },
  // One person-set's visits since `sinceIso` (RM Site Reviews vehicle check).
  forPeople: async (personKeys: string[], sinceIso: string): Promise<SiteVisit[]> => {
    if (personKeys.length === 0) return []
    const { data, error } = await supabase
      .from('vehicle_site_visits')
      .select('*')
      .in('person_key', personKeys)
      .gte('arrived_at', sinceIso)
      .order('arrived_at', { ascending: false })
      .limit(1000)
    if (error) throw error
    return data ?? []
  },
  // When visit tracking begins (the earliest synced visit).
  firstArrival: async (): Promise<string | null> => {
    const { data } = await supabase.from('vehicle_site_visits').select('arrived_at').order('arrived_at').limit(1)
    return data?.[0]?.arrived_at ?? null
  },
  people: () => supabase.from('fleet_people').select('*').order('name'),
  setCategory: (personKey: string, category: FleetCategory | null) =>
    supabase
      .from('fleet_people')
      .update({ category, updated_at: new Date().toISOString() })
      .eq('person_key', personKey)
      .select('person_key'),
  // Re-sync yesterday and today now instead of waiting for the hourly run.
  sync: () => supabase.functions.invoke('reveal-visits-sync', { body: {} }),
}
