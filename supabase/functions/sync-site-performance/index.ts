// sync-site-performance — Supabase Edge Function (Deno).
// Archives the Mighty Wash dashboard's daily per-site numbers into
// site_performance_days so history accumulates beyond the feed's ~30-day window.
// Each run pulls /api/report (cars, hours, sales, labor) and
// /api/recharge_revenue_report (daily recharge) and upserts every day the feed
// carries — idempotent, so a daily run both extends history and self-heals gaps.
//
// Secrets: MW_DASHBOARD_PASSWORD (required), MW_DASHBOARD_URL (optional).
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
//
// Auth: the daily cron passes the service-role JWT; a signed-in owner may also
// trigger it manually.

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

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

function siteNum(name: string): number | null {
  const m = String(name ?? '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
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

async function getFeed(base: string, cookie: string, path: string): Promise<unknown> {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie, 'User-Agent': BROWSER_UA } })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

// deno-lint-ignore no-explicit-any
type Any = any

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const password = Deno.env.get('MW_DASHBOARD_PASSWORD')
  const base = Deno.env.get('MW_DASHBOARD_URL') ?? DEFAULT_BASE
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  if (!password) return json({ error: 'no_key', message: 'MW_DASHBOARD_PASSWORD not set.' }, 503, origin)

  // Auth: cron (service-role JWT) or a signed-in owner.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden' }, 403, origin)
  }

  let cookie: string
  try {
    cookie = await login(base, password)
  } catch (e) {
    return json({ error: 'login_failed', message: String(e) }, 502, origin)
  }

  let report: Any, recharge: Any
  try {
    report = await getFeed(base, cookie, '/api/report')
    recharge = await getFeed(base, cookie, '/api/recharge_revenue_report').catch(() => null)
  } catch (e) {
    return json({ error: 'fetch_failed', message: String(e) }, 502, origin)
  }

  const reportSites = (report?.sites ?? {}) as Record<string, Any[]>
  if (!Object.keys(reportSites).length) {
    return json({ error: 'empty_report', message: 'Report feed had no sites.' }, 502, origin)
  }

  // Recharge lookup keyed by site number + date.
  const rechargeByKey = new Map<string, number>()
  for (const [name, days] of Object.entries((recharge?.sites ?? {}) as Record<string, Any[]>)) {
    const n = siteNum(name)
    for (const d of days) if (d?.date != null) rechargeByKey.set(`${n}|${d.date}`, Number(d.amount))
  }

  const { data: accts } = await svc
    .from('accounts')
    .select('id')
    .eq('site_performance_enabled', true)
  const accountIds = ((accts ?? []) as { id: string }[]).map((a) => a.id)
  if (!accountIds.length) return json({ accounts: 0, upserted: 0 }, 200, origin)

  const now = new Date().toISOString()
  let upserted = 0
  const errors: string[] = []

  for (const accountId of accountIds) {
    const rows: Record<string, unknown>[] = []
    for (const [name, days] of Object.entries(reportSites)) {
      const n = siteNum(name)
      for (const d of days) {
        if (d?.date == null) continue
        rows.push({
          account_id: accountId,
          site: name,
          site_number: n,
          date: d.date,
          cars: d.cars ?? null,
          hours: d.hours ?? null,
          cars_per_hour: d.cars_per_hour ?? null,
          sales: d.sales ?? null,
          labor_cost: d.labor_cost ?? null,
          labor_pct: d.labor_pct ?? null,
          recharge: rechargeByKey.get(`${n}|${d.date}`) ?? null,
          updated_at: now,
        })
      }
    }
    const { error } = await svc
      .from('site_performance_days')
      .upsert(rows, { onConflict: 'account_id,site,date' })
    if (error) errors.push(`${accountId}: ${error.message}`)
    else upserted += rows.length
  }

  return json({ accounts: accountIds.length, upserted, errors: errors.slice(0, 5) }, 200, origin)
})
