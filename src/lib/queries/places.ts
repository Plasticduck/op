import { supabase } from '@/lib/supabase'

// Google Places (New) business search, proxied through the places-search edge
// function so the API key stays server-side. Used by Market Explorer. The
// function returns { error: 'no_key' } when Google isn't configured, so callers
// fall back to the free OpenStreetMap search.
export type PlaceHit = { name: string; address: string; lat: number; lon: number }
export type PlacesResponse = { results?: PlaceHit[]; error?: string; message?: string }

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
