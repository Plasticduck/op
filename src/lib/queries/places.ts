import { supabase } from '@/lib/supabase'

// Google Places (New) business search, proxied through the places-search edge
// function so the API key stays server-side. Used by Market Explorer. The
// function returns { error: 'no_key' } when Google isn't configured, so callers
// fall back to the free OpenStreetMap search.
export type PlaceHit = { id?: string | null; name: string; address: string; lat: number; lon: number }
export type PlacesResponse = { results?: PlaceHit[]; error?: string; message?: string }

// Richer Google listing for one place (fetched when a pin is clicked).
export type PlaceDetail = {
  name: string
  address: string
  rating: number | null
  ratingCount: number | null
  phone: string | null
  website: string | null
  googleUrl: string | null
  openNow: boolean | null
  hoursToday: string | null
}
export const placeDetails = (placeId: string) =>
  supabase.functions.invoke<{ detail?: PlaceDetail; error?: string; message?: string }>('places-search', {
    body: { placeId },
  })

export const placesSearch = (body: {
  includedTypes?: string[]
  textQuery?: string
  lat: number
  lon: number
  radius: number
}) => supabase.functions.invoke<PlacesResponse>('places-search', { body })

// Normalized wrapper for callers: distinguishes "Google isn't configured"
// (reason 'nokey' -> fall back to the free search) from a real failure
// (reason 'error' -> tell the user it's busy). invoke() puts non-2xx bodies on
// the error's context Response, not on data, so we read it from there.
export type PlacesOutcome =
  | { ok: true; hits: PlaceHit[] }
  | { ok: false; reason: 'nokey' | 'error'; message?: string }

// Census demographics for a tapped point, proxied server-side (the Census
// geocoder sends no CORS headers, so the browser can't call it directly).
// Returns raw ACS values keyed by variable code; the caller formats them.
export type CensusResponse = {
  name?: string
  scope?: 'place' | 'county'
  values?: Record<string, string>
  error?: string
  message?: string
}
export const censusDemographics = (lat: number, lon: number) =>
  supabase.functions.invoke<CensusResponse>('census-demographics', { body: { lat, lon } })

export async function searchPlaces(body: Parameters<typeof placesSearch>[0]): Promise<PlacesOutcome> {
  const { data, error } = await placesSearch(body)
  if (error) {
    let payload: PlacesResponse | null = null
    try {
      const ctx = (error as { context?: Response }).context
      payload = ctx ? ((await ctx.json()) as PlacesResponse) : null
    } catch {
      /* non-JSON body */
    }
    if (payload?.error === 'no_key') return { ok: false, reason: 'nokey' }
    return { ok: false, reason: 'error', message: payload?.message ?? error.message }
  }
  if (data?.error === 'no_key') return { ok: false, reason: 'nokey' }
  return { ok: true, hits: data?.results ?? [] }
}
