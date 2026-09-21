// drb-interior — Supabase Edge Function (Deno).
// Interior/detail reporting from the live SiteWatch (DRB) database, for the
// Mighty Wash sites still on DRB. Sums SALEITEMS over a date range for every
// item in the "Detail Services" and "Detail Extras" report categories, plus a
// short allow-list of MVP ARM plan items the owner wants counted as interior.
// Returns one aggregated row per item name (count, quantity, revenue $).
//
// The SiteWatch endpoint is the password-gated MW dashboard's /api/custom_query
// (Firebird SQL). Money (AMT) is already in dollars.
//
// Auth: owner/manager of the Mighty Wash account, or the service role.
// Secrets: MW_DASHBOARD_PASSWORD (503 if absent), MW_DASHBOARD_URL (optional).

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

// Report-category branch prefixes (STARTING WITH catches any nested children):
//   001002001 = Detail Services, 001002002 = Detail Extras.
const DETAIL_BRANCHES = ['001002001', '001002002']
// Specific ARM plan items the owner counts as interior (exact SiteWatch names).
const ARM_ITEMS = ['MVP Mighty ARM Sld', 'Intro MVP PB/NM Rchg', 'Intro MVP Rchg', 'MVP Mighty Switch Rc']

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
  const m = setCookie.match(/session=[^;]+/)
  if (!m) throw new Error(`login failed (status ${res.status})`)
  return m[0]
}

type SqlResult = { columns: string[]; row_count: number; rows: unknown[][]; truncated: boolean }
async function runSql(base: string, cookie: string, sql: string): Promise<SqlResult> {
  const r = await fetch(`${base}/api/custom_query`, {
    method: 'POST',
    headers: { Cookie: cookie, 'User-Agent': BROWSER_UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data || (data as { error?: unknown }).error) {
    throw new Error(`custom_query failed (status ${r.status})`)
  }
  return data as SqlResult
}

// Only YYYY-MM-DD is accepted; anything else is rejected so nothing user-supplied
// reaches the SQL string unescaped.
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const nextDay = (d: string): string => new Date(new Date(d + 'T00:00:00Z').getTime() + 86400_000).toISOString().slice(0, 10)
const numify = (v: unknown): number => (v == null ? 0 : Number(v) || 0)

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const password = Deno.env.get('MW_DASHBOARD_PASSWORD')
  if (!password) return json({ error: 'no_key', message: 'MW_DASHBOARD_PASSWORD is not configured.' }, 503, origin)
  const base = (Deno.env.get('MW_DASHBOARD_URL') ?? DEFAULT_BASE).replace(/\/$/, '')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).single()
    if (!p || (p.role !== 'owner' && p.role !== 'manager')) return json({ error: 'forbidden' }, 403, origin)
    if (p.account_id !== MW_ACCOUNT) return json({ error: 'unsupported_account' }, 400, origin)
  }

  let body: { start?: string; end?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!isDate(body.start) || !isDate(body.end) || body.start! > body.end!) {
    return json({ error: 'bad_request', message: 'start and end must be YYYY-MM-DD with start <= end.' }, 400, origin)
  }
  const start = body.start!
  const endExclusive = nextDay(body.end!)

  const branchPred = DETAIL_BRANCHES.map((b) => `rc.BRANCH STARTING WITH '${b}'`).join(' OR ')
  const armList = ARM_ITEMS.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ')
  const sql =
    `SELECT TRIM(it.NAME), TRIM(rc.NAME), COUNT(*), SUM(si.QTY), SUM(si.AMT) ` +
    `FROM SALEITEMS si ` +
    `JOIN SALE s ON s.SITE = si.SITE AND s.OBJID = si.SALEID ` +
    `JOIN ITEM it ON it.OBJID = si.ITEM ` +
    `JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY ` +
    `WHERE s.LOGDATE >= '${start} 00:00:00' AND s.LOGDATE < '${endExclusive} 00:00:00' ` +
    `AND ( (${branchPred}) OR TRIM(it.NAME) IN (${armList}) ) ` +
    `GROUP BY TRIM(it.NAME), TRIM(rc.NAME) ` +
    `ORDER BY 5 DESC`

  let cookie: string
  try { cookie = await login(base, password) } catch (e) { return json({ error: 'login_failed', message: String(e) }, 502, origin) }

  let res: SqlResult
  try { res = await runSql(base, cookie, sql) } catch (e) { return json({ error: 'query_failed', message: String(e) }, 502, origin) }

  const items = (res.rows ?? []).map((r) => ({
    name: String(r[0] ?? '').trim() || '—',
    category: String(r[1] ?? '').trim() || '—',
    count: Math.round(numify(r[2])),
    qty: numify(r[3]),
    revenue: numify(r[4]),
  }))
  const total = items.reduce(
    (a, it) => ({ count: a.count + it.count, qty: a.qty + it.qty, revenue: a.revenue + it.revenue }),
    { count: 0, qty: 0, revenue: 0 },
  )

  return json({ ok: true, items, total, truncated: !!res.truncated }, 200, origin)
})
