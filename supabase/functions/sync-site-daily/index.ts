// sync-site-daily — Supabase Edge Function (Deno).
// Fills site_daily_metrics: one row per site per day with the DRB part and the
// FlexWash part of cars / gross sales / recharge $ kept separate. Site
// Performance History adds them (site_daily_totals, migration 0168).
//  - DRB: the dashboard's guided_query for ONE day at a time (fast; long ranges
//    time out), naming every site explicitly — the default roster now leaves out
//    the FlexWash sites, though the dashboard still has their DRB history.
//  - FlexWash: each converted site from its cutover day on. Cars = single +
//    member washes (the service-tier counts re-count the same washes), sales =
//    every revenue bucket (cents), recharge = the membershipsRebilled bucket,
//    which FlexWash only reports as a range total, so it's asked one day at a time.
// Processes at most maxDays days per call; the caller advances start to
// nextStart until done. The hourly cron covers yesterday + today.
//
// Body: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', maxDays?: number, parts?: 'drb' | 'flex' | 'both' }
// Auth: service-role JWT (cron/backfill driver) or a signed-in owner.
// Secrets: MW_DASHBOARD_URL (optional), MW_DASHBOARD_PASSWORD,
//          FLEXWASH_CLIENT_ID, FLEXWASH_CLIENT_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const FLEX_BASE = 'https://api.flexwash.com'
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

const num = (v: unknown) => Number(v) || 0
const round2 = (v: number) => Math.round(v * 100) / 100
const siteNumber = (name: string): number | null => {
  const m = String(name).match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}
const swName = (n: number) => `MightyWash ${String(n).padStart(3, '0')}`
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (start: string, end: string): string[] => {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

// Run fn over items with at most `limit` in flight.
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

type Row = {
  account_id: string
  site_number: number
  date: string
  updated_at: string
  drb_cars?: number | null
  drb_sales?: number | null
  drb_recharge?: number | null
  flex_cars?: number
  flex_sales?: number
  flex_recharge?: number
}

// ---- DRB (dashboard guided_query, one day) --------------------------------

// One metric for one day, every named site. A name the dashboard doesn't know
// fails the whole query ("Unknown site: X"), so drop it and retry.
async function guidedDay(base: string, cookie: string, metric: string, day: string, names: string[]): Promise<Map<number, number> | null> {
  let sites = [...names]
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${base}/api/guided_query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'User-Agent': BROWSER_UA },
      body: JSON.stringify({ metric, sites, start: day, end: day }),
      signal: AbortSignal.timeout(60000),
    })
    const j = await res.json().catch(() => null) as { rows?: [string, number][]; error?: string } | null
    const unknown = String(j?.error ?? '').match(/Unknown site:\s*(.+)$/i)
    if (unknown) { sites = sites.filter((s) => s !== unknown[1].trim()); continue }
    if (!res.ok || !j?.rows) return null
    const m = new Map<number, number>()
    for (const [name, v] of j.rows) {
      if (String(name).toUpperCase() === 'TOTAL') continue
      const n = siteNumber(name)
      if (n != null) m.set(n, num(v))
    }
    return m
  }
  return null
}

// ---- FlexWash -------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function flexToken(svc: any): Promise<string | null> {
  const { data: cached } = await svc.from('service_tokens').select('token, expires_at').eq('provider', 'flexwash').maybeSingle()
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) return cached.token as string
  const id = Deno.env.get('FLEXWASH_CLIENT_ID')
  const secret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  if (!id || !secret) return null
  try {
    const res = await fetch(`${FLEX_BASE}/external/access-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: id, clientSecret: secret }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.accessToken) return null
    await svc.from('service_tokens').upsert({ provider: 'flexwash', token: j.accessToken, expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'provider' })
    return j.accessToken as string
  } catch { return null }
}
// deno-lint-ignore no-explicit-any
async function flexPost(token: string, path: string, body: unknown): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${FLEX_BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
      if (r.ok) return await r.json()
      if (r.status !== 429 && r.status < 500) return null
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)))
  }
  return null
}

// Daily cars / sales / recharge for one car wash over [start, end]. Null when a
// FlexWash call failed, so the caller doesn't write zeros over good data.
async function flexDays(token: string, cw: string, start: string, end: string): Promise<Map<string, { cars: number; sales: number; recharge: number }> | null> {
  const dr = { carWashIds: [cw], dateRange: { start, end } }
  const [wash, rev] = await Promise.all([
    flexPost(token, '/external/wash-and-revenue-stats/get-temporal-wash-stats', { ...dr, interval: 'day' }),
    flexPost(token, '/external/wash-and-revenue-stats/get-temporal-revenue-stats', { ...dr, interval: 'day' }),
  ])
  if (!wash || !rev) return null
  const out = new Map<string, { cars: number; sales: number; recharge: number }>()
  for (const d of daysBetween(start, end)) out.set(d, { cars: 0, sales: 0, recharge: 0 })
  for (const w of wash.washStats ?? []) {
    const d = out.get(String(w.iso8601).slice(0, 10))
    if (d) d.cars = num(w.singleWashCount) + num(w.memberWashCount)
  }
  for (const r of rev.revenueStats ?? []) {
    const d = out.get(String(r.iso8601).slice(0, 10))
    if (d) d.sales = round2((num(r.detailRevenue) + num(r.expressRevenue) + num(r.fullServiceRevenue) + num(r.fleetRevenue) + num(r.membershipRevenue) + num(r.giftCardRevenue) + num(r.washBookRevenue) + num(r.otherRevenue)) / 100)
  }
  let failed = false
  await pool([...out.keys()], 4, async (day) => {
    const g = await flexPost(token, '/external/revenue-analytics/get-line-items-grouped-by-classification', { carWashIds: [cw], dateRange: { start: day, end: day } })
    if (!g) { failed = true; return }
    let cents = 0
    for (const c of g.aggregate?.membershipsRebilled ?? []) cents += num(c.totalRevenueInCents)
    out.get(day)!.recharge = round2(cents / 100)
  })
  return failed ? null : out
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

  let body: { start?: string; end?: string; maxDays?: number; parts?: string } = {}
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
  const maxDays = Math.max(1, Math.min(60, Math.round(body.maxDays ?? 10)))
  const end = [body.end as string, addDays(start, maxDays - 1)].sort()[0]
  const doDrb = body.parts !== 'flex'
  const doFlex = body.parts !== 'drb'
  const days = daysBetween(start, end)
  const now = new Date().toISOString()
  const errors: string[] = []
  let upserted = 0

  const { data: flexSites } = await svc
    .from('flexwash_sites')
    .select('site_number, car_wash_id, start_date')
    .eq('account_id', MW_ACCOUNT)
    .eq('active', true)
  const flex = (flexSites ?? []) as { site_number: number; car_wash_id: string | null; start_date: string | null }[]

  const save = async (rows: Row[]) => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await svc.from('site_daily_metrics').upsert(rows.slice(i, i + 500), { onConflict: 'account_id,date,site_number' })
      if (error) errors.push(error.message)
      else upserted += Math.min(500, rows.length - i)
    }
  }

  if (doDrb) {
    let cookie: string | null = null
    try {
      cookie = await login(base, password)
    } catch (e) {
      errors.push(`dashboard login: ${String(e)}`)
    }
    if (cookie) {
      // Every site the dashboard lists plus every FlexWash site (no longer listed).
      const optRes = await fetch(`${base}/api/guided_query_options`, { headers: { Cookie: cookie, 'User-Agent': BROWSER_UA } })
      const opts = await optRes.json().catch(() => null) as { sites?: { name: string }[] } | null
      const names = [...new Set([...(opts?.sites ?? []).map((s) => s.name), ...flex.map((f) => swName(f.site_number))])]
      // Two days at a time (three queries each) — gentle on the production dashboard.
      await pool(days, 2, async (day) => {
        const [cars, sales, recharge] = await Promise.all(
          ['cars', 'revenue', 'recharge'].map((m) => guidedDay(base, cookie!, m, day, names)),
        )
        if (!cars && !sales && !recharge) { errors.push(`${day}: dashboard returned nothing`); return }
        const nums = new Set<number>([...(cars?.keys() ?? []), ...(sales?.keys() ?? []), ...(recharge?.keys() ?? [])])
        const rows: Row[] = [...nums].map((n) => ({
          account_id: MW_ACCOUNT, site_number: n, date: day, updated_at: now,
          // Only overwrite a metric whose query worked.
          ...(cars ? { drb_cars: cars.get(n) ?? null } : {}),
          ...(sales ? { drb_sales: sales.get(n) ?? null } : {}),
          ...(recharge ? { drb_recharge: recharge.get(n) ?? null } : {}),
        }))
        await save(rows)
      })
    }
  }

  if (doFlex) {
    const token = await flexToken(svc)
    if (!token) errors.push('flexwash: no token')
    else {
      // Converted sites only, from their cutover day on.
      const active = flex.filter((f) => f.car_wash_id && f.start_date && f.start_date <= end)
      await pool(active, 3, async (f) => {
        const from = f.start_date! > start ? f.start_date! : start
        const m = await flexDays(token, f.car_wash_id!, from, end)
        if (!m) { errors.push(`flexwash MW${f.site_number}: request failed`); return }
        await save([...m.entries()].map(([date, v]) => ({
          account_id: MW_ACCOUNT, site_number: f.site_number, date, updated_at: now,
          flex_cars: v.cars, flex_sales: v.sales, flex_recharge: v.recharge,
        })))
      })
    }
  }

  const done = end >= (body.end as string)
  return json({ start, end, days: days.length, upserted, nextStart: done ? null : addDays(end, 1), done, errors: errors.slice(0, 10) }, 200, origin)
})
