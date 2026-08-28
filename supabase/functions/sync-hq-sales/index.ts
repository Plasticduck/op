// sync-hq-sales — Supabase Edge Function (Deno).
// Archives the daily net sales of the DRB "HQ" site (Mighty Wash Headquarters,
// SiteWatch site id 98) into site_performance_days as a standalone "HQ" row so
// its revenue (central recharges, website signups, plans sold) rolls into the
// company sales total. HQ is a central-billing/e-commerce bucket, not a wash: it
// has no cars/labor, so those are stored as 0 and it is excluded from labor,
// scorecards, and region grouping (site_number is null; the History/TTAF views
// show it under a standalone "HQ" group).
//
// Net sales = branches 001001..001004 (same definition as the wash sites/lube),
// which captures recharges (001004006), website sales (001004013), plans, etc.
// One row per day, so multi-year ranges stay under the dashboard's 1000-row cap.
//
// Service role (cron/backfill). Secrets: MW_DASHBOARD_PASSWORD, MW_DASHBOARD_URL.

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const HQ_SITE = 98 // SiteWatch site id for "Mighty Wash Headquarters"
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const SALES_BRANCHES = "(rc.BRANCH STARTING WITH '001001' OR rc.BRANCH STARTING WITH '001002' OR rc.BRANCH STARTING WITH '001003' OR rc.BRANCH STARTING WITH '001004')"

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
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

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

type SqlResult = { rows: unknown[][] }
async function runSql(base: string, cookie: string, sql: string): Promise<SqlResult> {
  const r = await fetch(`${base}/api/custom_query`, {
    method: 'POST',
    headers: { Cookie: cookie, 'User-Agent': BROWSER_UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data || data.error) {
    throw new Error(`custom_query failed (status ${r.status}): ${JSON.stringify(data?.error ?? data).slice(0, 300)}`)
  }
  return data as SqlResult
}

function jwtRole(auth: string): string | null {
  const token = auth.replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null
  } catch { return null }
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const password = Deno.env.get('MW_DASHBOARD_PASSWORD')
  if (!password) return json({ error: 'no_key', message: 'MW_DASHBOARD_PASSWORD is not configured.' }, 503, origin)
  const base = (Deno.env.get('MW_DASHBOARD_URL') ?? DEFAULT_BASE).replace(/\/$/, '')

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { start?: string; end?: string } = {}
  try { body = await req.json() } catch { body = {} }

  // Service role (cron/backfill), or owner of the MW account.
  const authHeader = req.headers.get('Authorization') ?? ''
  let accountId = MW_ACCOUNT
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await userClient.auth.getUser()
    const uid = userData.user?.id
    if (!uid) return json({ error: 'unauthorized' }, 401, origin)
    const { data: profile } = await svc.from('users').select('role, account_id').eq('id', uid).single()
    if (!profile || profile.role !== 'owner') return json({ error: 'forbidden' }, 403, origin)
    if (profile.account_id !== MW_ACCOUNT) return json({ error: 'unsupported_account' }, 400, origin)
    accountId = profile.account_id as string
  }

  const end = isDate(body.end) ? body.end : new Date().toISOString().slice(0, 10)
  const start = isDate(body.start) ? body.start : new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)

  let cookie: string
  try { cookie = await login(base, password) } catch (e) { return json({ error: 'login_failed', message: String(e) }, 502, origin) }

  const sql = `SELECT s.LOGDATE AS D, ROUND(SUM(CASE WHEN ${SALES_BRANCHES} THEN si.AMT ELSE 0 END),2) AS NET
    FROM SALEITEMS si
    JOIN SALE s ON s.SITE = si.SITE AND s.OBJID = si.SALEID
    JOIN ITEM it ON it.OBJID = si.ITEM
    JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY
    WHERE s.SITE = ${HQ_SITE} AND s.LOGDATE >= '${start}' AND s.LOGDATE <= '${end}'
    GROUP BY s.LOGDATE ORDER BY s.LOGDATE`

  let res: SqlResult
  try { res = await runSql(base, cookie, sql) } catch (e) { return json({ error: 'query_failed', message: String(e) }, 502, origin) }

  const rows = (res.rows ?? []).map((r) => ({
    account_id: accountId,
    site: 'HQ',
    site_number: null,
    date: String(r[0] ?? '').slice(0, 10),
    cars: 0,
    hours: 0,
    cars_per_hour: null,
    sales: Number(r[1]) || 0,
    labor_cost: 0,
    labor_pct: null,
    recharge: 0,
  })).filter((r) => r.date)

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await svc.from('site_performance_days').upsert(rows.slice(i, i + 500), { onConflict: 'account_id,site,date' })
    if (error) return json({ error: 'db_upsert_failed', message: error.message }, 500, origin)
  }

  return json({ ok: true, persisted: rows.length, start, end }, 200, origin)
})
