// drb-house-accounts — Supabase Edge Function (Deno).
// House Account activity for MW19 (the Lube Shop; DRB internal SITE 17). House
// accounts are charge/on-account customers (mostly commercial fleets) billed on
// account. In SiteWatch their charges are the "House Acct Charge" tender line
// (ITEM 4309, under the House Accounts tender category 001008003). The tender AMT
// is stored negative, so revenue = -SUM(AMT). Tender lines carry FLAGS = -32768,
// so FLAGS is NOT filtered.
//
// Returns per-account revenue for a chosen period and the immediately preceding
// equal-length period, with % change, visits, average ticket, last visit, and
// new/lapsed flags, plus a rolled-up summary.
//
// Body: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
// Auth: owner/manager of the Mighty Wash account, or the service role.
// Secrets: MW_DASHBOARD_PASSWORD (503 if absent), MW_DASHBOARD_URL (optional).

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const LUBE_SITE = 17 // SiteWatch internal SITE id for MightyWash 019 (MW19)
const HOUSE_CHARGE_ITEM = 4309 // "House Acct Charge" tender item
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

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

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

async function login(base: string, password: string): Promise<string> {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
    body: `password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  })
  const m = (res.headers.get('set-cookie') ?? '').match(/session=[^;]+/)
  if (!m) throw new Error(`login failed (status ${res.status})`)
  return m[0]
}
type SqlResult = { columns: string[]; row_count: number; rows: Any[][]; truncated?: boolean }
async function runSql(base: string, cookie: string, sql: string): Promise<SqlResult> {
  const r = await fetch(`${base}/api/custom_query`, {
    method: 'POST',
    headers: { Cookie: cookie, 'User-Agent': BROWSER_UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data || (data as { error?: unknown }).error) throw new Error(`custom_query failed (${r.status})`)
  return data as SqlResult
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const addDays = (d: string, n: number): string => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400_000).toISOString().slice(0, 10)
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0)
const nameOf = (first: unknown, last: unknown, id: unknown): string =>
  [String(first ?? '').trim(), String(last ?? '').trim()].filter(Boolean).join(' ').trim() || `#${id}`

// One period's per-account charge aggregate, keyed by CUSTOMER OBJID.
async function periodAccounts(base: string, cookie: string, startTs: string, endTs: string) {
  const sql =
    `SELECT c.OBJID, TRIM(c.FIRSTNAME), TRIM(c.LASTNAME), TRIM(c.MAINPHONE), ` +
    `COUNT(DISTINCT s.OBJID), SUM(si.AMT), MAX(s.LOGDATE) ` +
    `FROM SALE s ` +
    `JOIN SALEITEMS si ON si.SITE = s.SITE AND si.SALEID = s.OBJID ` +
    `JOIN CUSTOMERCODE cc ON cc.OBJID = s.CUSTOMERCODE ` +
    `JOIN CUSTOMER c ON c.OBJID = cc.CUSTOMER ` +
    `WHERE s.SITE = ${LUBE_SITE} AND si.ITEM = ${HOUSE_CHARGE_ITEM} ` +
    `AND s.LOGDATE >= '${startTs}' AND s.LOGDATE < '${endTs}' ` +
    `GROUP BY c.OBJID, TRIM(c.FIRSTNAME), TRIM(c.LASTNAME), TRIM(c.MAINPHONE) ` +
    `ORDER BY SUM(si.AMT) ASC` // most negative (highest revenue) first; keeps the top within the 1000-row cap
  const res = await runSql(base, cookie, sql)
  return res
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const password = Deno.env.get('MW_DASHBOARD_PASSWORD')
  if (!password) return json({ error: 'no_key', message: 'DRB is not configured.' }, 503, origin)
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

  let body: { start?: unknown; end?: unknown } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!isDate(body.start) || !isDate(body.end) || body.start > body.end) {
    return json({ error: 'bad_request', message: 'start and end must be YYYY-MM-DD with start <= end.' }, 400, origin)
  }
  const start = body.start as string
  const end = body.end as string
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400_000) + 1)
  const curStartTs = `${start} 00:00:00`
  const curEndTs = `${addDays(end, 1)} 00:00:00`
  const priorStart = addDays(start, -days)
  const priorStartTs = `${priorStart} 00:00:00`
  const priorEndTs = `${start} 00:00:00`

  let curRes: SqlResult, priorRes: SqlResult
  let cookie: string
  try {
    cookie = await login(base, password)
    ;[curRes, priorRes] = await Promise.all([
      periodAccounts(base, cookie, curStartTs, curEndTs),
      periodAccounts(base, cookie, priorStartTs, priorEndTs),
    ])
  } catch (e) {
    return json({ error: 'query_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }

  type Acct = {
    customerId: string; name: string; phone: string | null
    revenue: number; priorRevenue: number; visits: number; priorVisits: number
    avgTicket: number; lastVisit: string | null; pctChange: number | null
    isNew: boolean; isLapsed: boolean
  }
  const byId = new Map<string, Acct>()
  const get = (id: string, name: string, phone: string | null): Acct => {
    let a = byId.get(id)
    if (!a) { a = { customerId: id, name, phone, revenue: 0, priorRevenue: 0, visits: 0, priorVisits: 0, avgTicket: 0, lastVisit: null, pctChange: null, isNew: false, isLapsed: false }; byId.set(id, a) }
    return a
  }
  for (const r of curRes.rows ?? []) {
    const id = String(r[0] ?? '')
    const a = get(id, nameOf(r[1], r[2], id), String(r[3] ?? '').trim() || null)
    a.visits = Math.round(num(r[4]))
    a.revenue = Math.round(-num(r[5]) * 100) / 100 // AMT is negative
    a.lastVisit = r[6] ? String(r[6]).slice(0, 10) : null
  }
  for (const r of priorRes.rows ?? []) {
    const id = String(r[0] ?? '')
    const a = get(id, nameOf(r[1], r[2], id), String(r[3] ?? '').trim() || null)
    a.priorVisits = Math.round(num(r[4]))
    a.priorRevenue = Math.round(-num(r[5]) * 100) / 100
  }
  const accounts = [...byId.values()]
  for (const a of accounts) {
    a.avgTicket = a.visits > 0 ? Math.round((a.revenue / a.visits) * 100) / 100 : 0
    a.isNew = a.revenue > 0 && a.priorRevenue === 0
    a.isLapsed = a.revenue === 0 && a.priorRevenue > 0
    a.pctChange = a.priorRevenue > 0 ? Math.round(((a.revenue - a.priorRevenue) / a.priorRevenue) * 1000) / 10 : null
  }
  accounts.sort((a, b) => b.revenue - a.revenue)

  const sum = (f: (a: Acct) => number) => accounts.reduce((s, a) => s + f(a), 0)
  const totalRevenue = Math.round(sum((a) => a.revenue) * 100) / 100
  const priorTotalRevenue = Math.round(sum((a) => a.priorRevenue) * 100) / 100
  const totalVisits = sum((a) => a.visits)
  const summary = {
    totalRevenue,
    priorTotalRevenue,
    revenuePctChange: priorTotalRevenue > 0 ? Math.round(((totalRevenue - priorTotalRevenue) / priorTotalRevenue) * 1000) / 10 : null,
    activeAccounts: accounts.filter((a) => a.revenue > 0).length,
    priorActiveAccounts: accounts.filter((a) => a.priorRevenue > 0).length,
    totalVisits,
    priorTotalVisits: sum((a) => a.priorVisits),
    avgTicket: totalVisits > 0 ? Math.round((totalRevenue / totalVisits) * 100) / 100 : 0,
    newAccounts: accounts.filter((a) => a.isNew).length,
    lapsedAccounts: accounts.filter((a) => a.isLapsed).length,
  }

  return json({
    ok: true,
    site: LUBE_SITE,
    siteLabel: 'MW19',
    range: { start, end },
    priorRange: { start: priorStart, end: addDays(start, -1) },
    summary,
    accounts,
    truncated: !!(curRes.truncated || priorRes.truncated),
    note: 'Revenue = House Acct Charge tender (item 4309) at MW19. Employee charges and account payments are excluded.',
  }, 200, origin)
})
