// sync-flexwash — Supabase Edge Function (Deno).
// Archives FlexWash daily per-site numbers into site_performance_days so the
// FlexWash sites (MW17, MW18, ...) sit alongside the SiteWatch sites in the
// History view and are queryable by Operator AI. For each mapped site it pulls
// the daily temporal wash + revenue stats and upserts one row per day. Calls
// FlexWash directly, reusing the cached token in service_tokens.
//
// Body: { days?: number }  — trailing days to (re)sync (default 5; up to ~120 for backfill).
// Secrets: FLEXWASH_CLIENT_ID, FLEXWASH_CLIENT_SECRET.
// Auth: service-role JWT (cron) or a signed-in owner.

import { createClient } from 'npm:@supabase/supabase-js@2'

const FLEX_BASE = 'https://api.flexwash.com'

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
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

function jwtRole(auth: string): string | null {
  const token = auth.replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null
  } catch {
    return null
  }
}

const day = (iso: string) => String(iso).slice(0, 10)
const money = (cents: unknown) => (Number(cents) || 0) / 100

// Reuse the cached FlexWash token (service_tokens), minting a new one only when
// missing or near expiry. Same scheme as the flexwash proxy.
// deno-lint-ignore no-explicit-any
async function getToken(svc: any, clientId: string, clientSecret: string): Promise<string> {
  const { data: cached } = await svc
    .from('service_tokens')
    .select('token, expires_at')
    .eq('provider', 'flexwash')
    .maybeSingle()
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) {
    return cached.token as string
  }
  const res = await fetch(`${FLEX_BASE}/external/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.accessToken) throw new Error(`token request failed (${res.status})`)
  await svc.from('service_tokens').upsert(
    {
      provider: 'flexwash',
      token: j.accessToken,
      expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'provider' },
  )
  return j.accessToken as string
}

type FlexSite = { site_number: number; car_wash_id: string; name: string | null; account_id: string }

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const clientId = Deno.env.get('FLEXWASH_CLIENT_ID')
  const clientSecret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  if (!clientId || !clientSecret) {
    return json({ error: 'no_key', message: 'FlexWash credentials are not configured.' }, 503, origin)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden' }, 403, origin)
  }

  let days = 5
  try {
    const body = await req.json()
    if (typeof body?.days === 'number') days = body.days
  } catch {
    // default
  }
  days = Math.max(1, Math.min(120, Math.round(days)))

  const today = new Date()
  const end = day(today.toISOString())
  const startDate = new Date(today.getTime() - (days - 1) * 86400_000)
  const start = day(startDate.toISOString())

  let token: string
  try {
    token = await getToken(svc, clientId, clientSecret)
  } catch (e) {
    return json({ error: 'auth_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }

  // Call a FlexWash temporal endpoint directly.
  // deno-lint-ignore no-explicit-any
  async function flex(path: string, cwid: string): Promise<any> {
    const res = await fetch(`${FLEX_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ carWashIds: [cwid], interval: 'day', dateRange: { start, end } }),
    })
    return res.json().catch(() => null)
  }

  const { data: sites } = await svc
    .from('flexwash_sites')
    .select('site_number, car_wash_id, name, account_id')
    .eq('active', true)
  const list = (sites ?? []) as FlexSite[]

  const now = new Date().toISOString()
  let upserted = 0
  const errors: string[] = []

  for (const s of list) {
    try {
      const [wash, rev] = await Promise.all([
        flex('/external/wash-and-revenue-stats/get-temporal-wash-stats', s.car_wash_id),
        flex('/external/wash-and-revenue-stats/get-temporal-revenue-stats', s.car_wash_id),
      ])
      // deno-lint-ignore no-explicit-any
      const washByDate = new Map<string, any>()
      for (const w of wash?.washStats ?? []) washByDate.set(day(w.iso8601), w)
      // deno-lint-ignore no-explicit-any
      const revByDate = new Map<string, any>()
      for (const r of rev?.revenueStats ?? []) revByDate.set(day(r.iso8601), r)

      const dates = new Set<string>([...washByDate.keys(), ...revByDate.keys()])
      const rows: Record<string, unknown>[] = []
      for (const d of dates) {
        const w = washByDate.get(d)
        const r = revByDate.get(d)
        const cars = w
          ? (Number(w.singleWashCount) || 0) +
            (Number(w.memberWashCount) || 0) +
            (Number(w.expressWashCount) || 0) +
            (Number(w.fleetWashCount) || 0) +
            (Number(w.detailWashCount) || 0) +
            (Number(w.fullServiceWashCount) || 0)
          : null
        const sales = r
          ? money(
              (Number(r.detailRevenue) || 0) +
                (Number(r.expressRevenue) || 0) +
                (Number(r.fullServiceRevenue) || 0) +
                (Number(r.fleetRevenue) || 0) +
                (Number(r.membershipRevenue) || 0) +
                (Number(r.giftCardRevenue) || 0) +
                (Number(r.washBookRevenue) || 0) +
                (Number(r.otherRevenue) || 0),
            )
          : null
        rows.push({
          account_id: s.account_id,
          site: s.name ?? `Mighty Wash #${s.site_number}`,
          site_number: s.site_number,
          date: d,
          cars,
          hours: null,
          cars_per_hour: null,
          sales,
          labor_cost: null,
          labor_pct: null,
          recharge: r ? money(r.membershipRevenue) : null,
          updated_at: now,
        })
      }
      if (rows.length) {
        const { error } = await svc
          .from('site_performance_days')
          .upsert(rows, { onConflict: 'account_id,site,date' })
        if (error) errors.push(`${s.car_wash_id}: ${error.message}`)
        else upserted += rows.length
      }
    } catch (e) {
      errors.push(`${s.car_wash_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return json({ sites: list.length, days, upserted, errors: errors.slice(0, 5) }, 200, origin)
})
