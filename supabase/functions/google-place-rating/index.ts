// google-place-rating — Supabase Edge Function (Deno).
// Returns each site's live Google star rating for the dashboard. Ratings are
// cached on the locations row and refreshed from the Google Places API (New)
// at most once per TTL window (about a day) to keep Places API cost low, since
// star ratings move slowly. Refresh is lazy: it happens when a dashboard loads
// and finds a stale cache, so no cron is needed.
//
// Secrets: GOOGLE_MAPS_API_KEY (returns 503 no_key if absent).
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

const TTL_MS = 20 * 60 * 60 * 1000 // ~ once a day per site
const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places/'

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
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

type LocRow = {
  id: string
  google_place_id: string | null
  google_rating: number | null
  google_rating_count: number | null
  google_rating_synced_at: string | null
}

async function fetchPlaceRating(placeId: string, apiKey: string) {
  const res = await fetch(PLACES_ENDPOINT + encodeURIComponent(placeId), {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'rating,userRatingCount',
    },
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  if (!body || typeof body.rating !== 'number') return null
  return { rating: body.rating as number, count: (body.userRatingCount as number) ?? null }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
  if (!apiKey) return json({ error: 'no_key', message: 'GOOGLE_MAPS_API_KEY is not configured.' }, 503)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Identify the caller and scope everything to their account.
  const auth = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const uid = u.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: me } = await svc.from('users').select('account_id').eq('id', uid).single()
  const accountId = (me as { account_id: string } | null)?.account_id
  if (!accountId) return json({ error: 'unauthorized' }, 401)

  let requestedIds: string[] | null = null
  try {
    const parsed = await req.json()
    if (Array.isArray(parsed?.location_ids)) requestedIds = parsed.location_ids as string[]
  } catch { /* body optional */ }

  // Only ever touch locations in the caller's account.
  let query = svc
    .from('locations')
    .select('id, google_place_id, google_rating, google_rating_count, google_rating_synced_at')
    .eq('account_id', accountId)
    .eq('archived', false)
  if (requestedIds && requestedIds.length > 0) query = query.in('id', requestedIds)
  const { data: locData, error: locErr } = await query
  if (locErr) return json({ error: 'query_failed', message: locErr.message }, 500)
  const locations = (locData as LocRow[] | null) ?? []

  const now = Date.now()
  const results: Array<{ location_id: string; rating: number | null; count: number | null; synced_at: string | null }> = []

  for (const loc of locations) {
    let rating = loc.google_rating
    let count = loc.google_rating_count
    let synced = loc.google_rating_synced_at
    const stale = !synced || now - new Date(synced).getTime() > TTL_MS
    if (loc.google_place_id && stale) {
      const fresh = await fetchPlaceRating(loc.google_place_id, apiKey)
      if (fresh) {
        rating = fresh.rating
        count = fresh.count
        synced = new Date(now).toISOString()
        await svc
          .from('locations')
          .update({ google_rating: rating, google_rating_count: count, google_rating_synced_at: synced })
          .eq('id', loc.id)
      }
    }
    results.push({ location_id: loc.id, rating, count, synced_at: synced })
  }

  return json({ ratings: results })
})
