// places-search — Supabase Edge Function (Deno).
// Proxies the Google Places API (New) so the API key stays server-side (a
// Supabase secret) and never ships to the browser. Used by Market Explorer's
// business search. Two modes:
//   - category: Nearby Search by Place type(s) within a radius.
//   - text:     Text Search for a free-text business name, biased to the area.
// Returns a normalized { results: [{ name, address, lat, lon }] }.
// Required secret: GOOGLE_PLACES_API_KEY. Returns { error: 'no_key' } (503) when
// unset so the client falls back to the free OpenStreetMap search.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

const ALLOWED_ORIGINS = new Set<string>([
  'https://operator.washlyfe.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return {
    'Access-Control-Allow-Origin': allow,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location'
// Richer fields for one listing (a clicked pin). Details is a pricier SKU, so
// it's only fetched on demand.
const DETAIL_MASK =
  'id,displayName,formattedAddress,rating,userRatingCount,nationalPhoneNumber,websiteUri,googleMapsUri,regularOpeningHours,currentOpeningHours'

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  // Reuses the same key as the Google ratings functions (google-place-rating,
  // gatherup-rating). It already has Places API (New) enabled, which is the same
  // API these search endpoints use, so no separate key is needed.
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
  if (!apiKey) return json({ error: 'no_key', message: 'Google Places is not configured.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const callerId = u.user?.id
  if (!callerId) return json({ error: 'unauthorized' }, 401, origin)

  // Places calls cost money, so gate to managers+ (owner/manager). Regional
  // Manager / Executive carry role='manager', so they pass too.
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: caller } = await svc.from('users').select('role').eq('id', callerId).maybeSingle()
  const role = (caller as Any)?.role
  if (!(role === 'owner' || role === 'manager')) return json({ error: 'forbidden' }, 403, origin)

  let body: {
    includedTypes?: string[]
    textQuery?: string
    lat?: number
    lon?: number
    radius?: number
    placeId?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }

  // Details for one listing (a clicked pin). No lat/lon needed.
  if (typeof body.placeId === 'string' && body.placeId.trim()) {
    try {
      const dRes = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(body.placeId.trim())}`, {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': DETAIL_MASK },
      })
      const d = (await dRes.json()) as Any
      if (!dRes.ok) return json({ error: 'places_error', message: d?.error?.message ?? `Places ${dRes.status}` }, 502, origin)
      const desc: string[] = d.regularOpeningHours?.weekdayDescriptions ?? []
      const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
      return json(
        {
          detail: {
            name: d.displayName?.text ?? '',
            address: d.formattedAddress ?? '',
            rating: typeof d.rating === 'number' ? d.rating : null,
            ratingCount: typeof d.userRatingCount === 'number' ? d.userRatingCount : null,
            phone: d.nationalPhoneNumber ?? null,
            website: d.websiteUri ?? null,
            googleUrl: d.googleMapsUri ?? null,
            openNow: (d.currentOpeningHours?.openNow ?? d.regularOpeningHours?.openNow) ?? null,
            hoursToday: desc.find((s) => s.startsWith(dayName)) ?? null,
          },
        },
        200,
        origin,
      )
    } catch (e) {
      return json({ error: 'places_error', message: e instanceof Error ? e.message : String(e) }, 502, origin)
    }
  }

  const lat = Number(body.lat)
  const lon = Number(body.lon)
  const radius = Math.min(Math.max(Number(body.radius) || 5000, 100), 50000)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'bad_request' }, 400, origin)

  let endpoint: string
  let payload: Record<string, unknown>
  if (body.includedTypes?.length) {
    endpoint = 'https://places.googleapis.com/v1/places:searchNearby'
    payload = {
      includedTypes: body.includedTypes,
      maxResultCount: 20,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius } },
    }
  } else if (body.textQuery?.trim()) {
    endpoint = 'https://places.googleapis.com/v1/places:searchText'
    payload = {
      textQuery: body.textQuery.trim(),
      locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius } },
    }
  } else {
    return json({ error: 'bad_request' }, 400, origin)
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(payload),
    })
    const data = (await res.json()) as Any
    if (!res.ok) {
      const msg = data?.error?.message ?? `Places error ${res.status}`
      return json({ error: 'places_error', message: msg }, 502, origin)
    }
    const results = ((data.places ?? []) as Any[])
      .map((p) => ({
        id: p.id ?? null,
        name: p.displayName?.text ?? 'Business',
        address: p.formattedAddress ?? '',
        lat: p.location?.latitude,
        lon: p.location?.longitude,
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    return json({ results }, 200, origin)
  } catch (e) {
    return json({ error: 'places_error', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
