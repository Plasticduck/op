// Mighty Wash vehicle GPS from Verizon Connect Reveal. All access goes through
// the reveal-fleet edge function, which holds the Reveal credentials
// server-side. Pre-launch: kevan@washlyfe.com only (enforced in the function).
import { supabase } from '@/lib/supabase'

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
