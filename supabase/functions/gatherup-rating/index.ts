// gatherup-rating — Supabase Edge Function (Deno).
// Returns each site's Google star rating for the dashboard, sourced from GatherUp
// (the account's review-management tool) instead of the Google Places API. The
// average + count are computed from the site's Google reviews and cached on the
// locations row (google_rating / google_rating_count / google_rating_synced_at),
// so the rating tiles and Site Scorecard need no change. Recent reviews are
// cached in gatherup_reviews for a dashboard feed. Refresh is lazy (TTL ~1 day).
//
// GatherUp auth: each request is signed hash = SHA256(privateKey + concat of the
// params sorted by key as key+value...). Secrets: GATHERUP_CLIENT_ID,
// GATHERUP_PRIVATE_KEY (503 no_key if absent).
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

const TTL_MS = 20 * 60 * 60 * 1000 // ~ once a day per site
const GU_BASE = 'https://app.gatherup.com/api/'

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

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// deno-lint-ignore no-explicit-any
async function guCall(clientId: string, privateKey: string, endpoint: string, params: Record<string, string | number>): Promise<any | null> {
  const body: Record<string, string | number> = { ...params, clientId }
  const concat = Object.keys(body).sort().map((k) => k + String(body[k])).join('')
  ;(body as Record<string, string>).hash = await sha256Hex(privateKey + concat)
  try {
    const r = await fetch(GU_BASE + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) return null
    return await r.json().catch(() => null)
  } catch { return null }
}

type Review = { reviewId: number; reviewAuthor: string; reviewRating: number; reviewContent: string; reviewTime: string }

// All Google reviews for a business (paginated).
async function fetchGoogleReviews(clientId: string, privateKey: string, businessId: number): Promise<Review[] | null> {
  const all: Review[] = []
  let page = 1
  let pages = 1
  do {
    const d = await guCall(clientId, privateKey, 'online-reviews/get', { businessId, type: 'google', page, aggregateResponse: 1 })
    if (!d || d.errorCode) return all.length ? all : null
    pages = Number(d.pages) || 1
    for (const rv of (d.data ?? [])) all.push(rv as Review)
    page += 1
  } while (page <= pages && page <= 20)
  return all
}

type LocRow = {
  id: string
  gatherup_business_id: number | null
  google_rating: number | null
  google_rating_count: number | null
  google_rating_synced_at: string | null
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const clientId = Deno.env.get('GATHERUP_CLIENT_ID')
  const privateKey = Deno.env.get('GATHERUP_PRIVATE_KEY')
  if (!clientId || !privateKey) return json({ error: 'no_key', message: 'GATHERUP_CLIENT_ID / GATHERUP_PRIVATE_KEY are not configured.' }, 503)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

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

  let query = svc
    .from('locations')
    .select('id, gatherup_business_id, google_rating, google_rating_count, google_rating_synced_at')
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
    if (loc.gatherup_business_id && stale) {
      const reviews = await fetchGoogleReviews(clientId, privateKey, loc.gatherup_business_id)
      if (reviews && reviews.length) {
        const rated = reviews.filter((r) => Number(r.reviewRating) > 0)
        count = rated.length
        rating = count ? Math.round((rated.reduce((s, r) => s + Number(r.reviewRating), 0) / count) * 10) / 10 : null
        synced = new Date(now).toISOString()
        await svc.from('locations')
          .update({ google_rating: rating, google_rating_count: count, google_rating_synced_at: synced })
          .eq('id', loc.id)

        // Cache the 25 most recent reviews for the dashboard feed.
        const recent = [...reviews]
          .sort((a, b) => new Date(b.reviewTime).getTime() - new Date(a.reviewTime).getTime())
          .slice(0, 25)
          .map((r) => ({
            review_id: r.reviewId,
            account_id: accountId,
            location_id: loc.id,
            author: r.reviewAuthor || null,
            rating: Number(r.reviewRating) || null,
            content: (r.reviewContent || '').trim() || null,
            review_time: r.reviewTime ? new Date(r.reviewTime).toISOString() : null,
            synced_at: synced,
          }))
        await svc.from('gatherup_reviews').delete().eq('location_id', loc.id)
        if (recent.length) await svc.from('gatherup_reviews').insert(recent)
      }
    }
    results.push({ location_id: loc.id, rating, count, synced_at: synced })
  }

  return json({ ratings: results })
})
