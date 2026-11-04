// Mighty Wash vehicle GPS from Verizon Connect Reveal. Live positions go
// through the reveal-fleet edge function, which holds the Reveal credentials
// server-side. Site visits are synced hourly into vehicle_site_visits by
// reveal-visits-sync (0178). Pre-launch: kevan@washlyfe.com only (enforced in
// the functions and by RLS).
import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type SiteVisit = T['vehicle_site_visits']['Row']
export type FleetPerson = T['fleet_people']['Row']
export type FleetCategory = 'regional_manager' | 'executive' | 'maintenance' | 'facilities' | 'it' | 'other'
// Display order for the People tab and filters.
export const FLEET_CATEGORY_LABEL: Record<FleetCategory, string> = {
  regional_manager: 'Regional Manager',
  executive: 'Executive',
  maintenance: 'Maintenance',
  facilities: 'Facilities',
  it: 'IT',
  other: 'Other',
}
export const FLEET_CATEGORIES = Object.keys(FLEET_CATEGORY_LABEL) as FleetCategory[]

// person_key -> the person it counts as (itself, or who it was merged into).
export function canonicalPeople(people: FleetPerson[]): Map<string, FleetPerson> {
  const byKey = new Map(people.map((p) => [p.person_key, p]))
  return new Map(people.map((p) => [p.person_key, (p.merged_into && byKey.get(p.merged_into)) || p]))
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

// Fleet Management (Admins): drivers, vehicles and assignments in Reveal, through
// the fleet-admin edge function. Every change is logged in fleet_changes (0207).
export type FleetChange = T['fleet_changes']['Row']
export type FleetAdminVehicle = {
  number: string
  name: string
  plate: string | null
  vin: string | null
  year: number | null
  make: string | null
  model: string | null
  fuel_type: number // 0 unleaded, 1 diesel, 2 electric
  size: number // 0 light, 1 medium, 2 heavy duty
  driver: { number: string; name: string; since: string | null } | null
  gps_at: string | null // latest GPS plot, ISO UTC
  status: string | null
}
export type FleetAdminDriver = {
  number: string
  first: string
  last: string
  email: string | null
  phone: string | null
  created_at: string | null
  vehicle: string | null // vehicle number they're assigned to
  operator_user: { id: string; name: string } | null // matched by email
}
export type FleetOverview = { fetched_at: string; vehicles: FleetAdminVehicle[]; drivers: FleetAdminDriver[]; unnumbered: string[] }
export type DriverInput = { number: string; first: string; last: string; email: string; phone: string }
export type VehicleInput = { name: string; plate: string; vin: string; year: string; make: string; model: string; fuel_type: number; size: number }
export const FUEL_TYPES = ['Unleaded', 'Diesel', 'Electric']
export const VEHICLE_SIZES = ['Light duty', 'Medium duty', 'Heavy duty']

async function fleetAdmin<R = { ok: true }>(body: Record<string, unknown>, fallback: string): Promise<R> {
  const { data, error } = await supabase.functions.invoke('fleet-admin', { body })
  if (error) throw new Error(await fnErrorMessage(error, data, fallback))
  return data as R
}

export const fleetAdminApi = {
  overview: () => fleetAdmin<FleetOverview>({ action: 'overview' }, 'Could not load the fleet from Verizon.'),
  createDriver: (d: DriverInput) => fleetAdmin({ action: 'driver_create', ...d }, 'Could not add the driver.'),
  updateDriver: (d: DriverInput) => fleetAdmin({ action: 'driver_update', ...d }, 'Could not save the driver.'),
  deleteDriver: (number: string) => fleetAdmin({ action: 'driver_delete', number }, 'Could not remove the driver.'),
  assign: (driver: string, vehicle: string) => fleetAdmin({ action: 'assign', driver, vehicle }, 'Could not assign the driver.'),
  unassign: (vehicle: string) => fleetAdmin({ action: 'unassign', vehicle }, 'Could not take the driver off.'),
  updateVehicle: (vehicle: string, fields: VehicleInput) =>
    fleetAdmin<{ ok: true; not_saved: string[] }>({ action: 'vehicle_update', vehicle, fields }, 'Could not save the vehicle.'),
  setOdometer: (vehicle: string, miles: number) => fleetAdmin({ action: 'odometer', vehicle, miles }, 'Could not set the odometer.'),
  changes: async (limit = 200): Promise<FleetChange[]> => {
    const { data, error } = await supabase.from('fleet_changes').select('*').order('created_at', { ascending: false }).limit(limit)
    if (error) throw error
    return data ?? []
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
  // Show one person's visits under another (e.g. a vehicle-named entry under
  // its driver). Anything already merged into `fromKey` moves along, so merges
  // stay one level deep.
  merge: async (fromKey: string, intoKey: string) => {
    const moved = await supabase.from('fleet_people').update({ merged_into: intoKey }).eq('merged_into', fromKey)
    if (moved.error) return moved
    return supabase.from('fleet_people').update({ merged_into: intoKey }).eq('person_key', fromKey).select('person_key')
  },
  unmerge: (key: string) =>
    supabase.from('fleet_people').update({ merged_into: null }).eq('person_key', key).select('person_key'),
  // Re-sync yesterday and today now instead of waiting for the hourly run.
  sync: () => supabase.functions.invoke('reveal-visits-sync', { body: {} }),
}
