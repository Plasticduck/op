// backfill-cars — Supabase Edge Function (Deno).
// One-time (re-runnable) backfill of official daily car counts per site into
// site_performance_days, using the SiteWatch dashboard's own `cars` guided
// metric (the same number every other screen shows). Raw SiteWatch SQL was
// rejected: SALE-row counts don't match the official metric and the internal
// SITE ids don't map to our store numbers, so we go through guided_query.
//
// Walks one day at a time (each call returns every site for that day) from
// `start` forward, capped at `maxDays` per invocation so a single run stays
// well under the wall-clock limit. The caller advances `start` to `nextStart`
// until `done`. Intended for historical dates only (before the live archive
// begins), so it never overwrites days that carry hours/sales/labor.
//
// Body: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', maxDays?: number }
// Auth: service-role JWT (cron/backfill driver) or a signed-in owner.
// Secrets: MW_DASHBOARD_URL (optional), MW_DASHBOARD_PASSWORD.

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

const ALLOWED_ORIGINS = new Set<string>([
  'https://operator.washlyfe.com',
  'http://localhost:5173',
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

async function login(base: string, password: string): Promise<string> {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
    body: `password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/session=[^;]+/)
  if (!match) throw new Error(`login failed (status ${res.status}, no session cookie)`)
  return match[0]
}

const siteNumber = (name: string): number | null => {
  const m = String(name).match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const password = Deno.env.get('MW_DASHBOARD_PASSWORD')
  if (!password) return json({ error: 'no_key', message: 'MW_DASHBOARD_PASSWORD is not configured.' }, 503, origin)
  const base = (Deno.env.get('MW_DASHBOARD_URL') ?? DEFAULT_BASE).replace(/\/$/, '')
  const svc = createClient(supaUrl, serviceKey, { auth: { persistSession: false } })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(supaUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden' }, 403, origin)
  }

  let body: { start?: string; end?: string; maxDays?: number } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!isDate(body.start) || !isDate(body.end)) {
    return json({ error: 'bad_request', message: 'start and end (YYYY-MM-DD) are required.' }, 400, origin)
  }
  const start = body.start as string
  const end = body.end as string
  const maxDays = Math.max(1, Math.min(90, Math.round(body.maxDays ?? 45)))

  let cookie: string
  try {
    cookie = await login(base, password)
  } catch (e) {
    return json({ error: 'login_failed', message: String(e) }, 502, origin)
  }

  const now = new Date().toISOString()
  let processed = 0
  let upserted = 0
  let lastDate: string | null = null
  const emptyDays: string[] = []
  const errors: string[] = []

  let day = start
  while (day <= end && processed < maxDays) {
    try {
      const res = await fetch(`${base}/api/guided_query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, 'User-Agent': BROWSER_UA },
        body: JSON.stringify({ metric: 'cars', sites: [], start: day, end: day }),
      })
      const j = await res.json().catch(() => null) as { rows?: [string, number][] } | null
      const rows = (j?.rows ?? []).filter((r) => String(r[0]).toUpperCase() !== 'TOTAL')
      if (rows.length === 0) {
        emptyDays.push(day)
      } else {
        const upserts = rows.map(([name, cars]) => ({
          account_id: MW_ACCOUNT,
          site: name,
          site_number: siteNumber(name),
          date: day,
          cars: Number(cars) || 0,
          updated_at: now,
        }))
        const { error } = await svc.from('site_performance_days').upsert(upserts, { onConflict: 'account_id,site,date' })
        if (error) errors.push(`${day}: ${error.message}`)
        else upserted += upserts.length
      }
    } catch (e) {
      errors.push(`${day}: ${e instanceof Error ? e.message : String(e)}`)
    }
    lastDate = day
    processed += 1
    day = addDays(day, 1)
    // Be gentle on the production dashboard between per-day queries.
    if (day <= end && processed < maxDays) await new Promise((r) => setTimeout(r, 150))
  }

  const done = day > end
  return json(
    { processed, upserted, lastDate, nextStart: done ? null : day, done, emptyDays: emptyDays.slice(0, 10), errors: errors.slice(0, 5) },
    200,
    origin,
  )
})
