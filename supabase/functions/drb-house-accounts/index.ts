// drb-house-accounts — Supabase Edge Function (Deno).
// House Account activity for MW19 (the Lube Shop; DRB internal SITE 17). House
// accounts are charge/on-account customers (mostly commercial fleets) billed on
// account. In SiteWatch their charges are the "House Acct Charge" tender line
// (ITEM 4309, under the House Accounts tender category 001008003). The tender AMT
// is stored negative, so revenue = -SUM(AMT). Tender lines carry FLAGS = -32768,
// so FLAGS is NOT filtered.
//
// Lube only: a charge counts only when its ticket has at least one lube line (item
// report category branch 001003, the same lube branch lube-stats counts). Tickets
// with only washes (or anything else) are left out; `excluded` reports how many and
// how much for the chosen dates. A counted ticket keeps its whole charge, so
// `washOnLube` reports wash dollars (branch 001001) that ride along on lube tickets.
//
// Returns per-account revenue for a chosen period and a compare period, with %
// change, visits, average ticket, last visit, and new/lapsed flags, plus a
// rolled-up summary. The compare period is whatever the caller sends; without one
// it is the immediately preceding equal-length period.
//
// Body: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', compareStart?: 'YYYY-MM-DD', compareEnd?: 'YYYY-MM-DD' }
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
// A grouping key for "same company, slightly different name": the company lives in
// the first-name field (e.g. "FLEXSTEEL", "FLEX STEEL", "LUCKY HEALTH"); uppercased
// with all non-alphanumerics stripped so spacing/punctuation variants collapse.
const normCompany = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

// The ticket (alias s) has at least one lube line.
const HAS_LUBE =
  `EXISTS (SELECT 1 FROM SALEITEMS li ` +
  `JOIN ITEM lit ON lit.OBJID = li.ITEM ` +
  `JOIN ITEMRPTCATEGORY lrc ON lrc.OBJID = lit.REPORTCATEGORY ` +
  `WHERE li.SITE = s.SITE AND li.SALEID = s.OBJID AND lrc.BRANCH STARTING WITH '001003')`

// One period's per-account charge aggregate (lube tickets only), keyed by CUSTOMER
// OBJID. custom_query returns at most 1,000 rows, and a long range has more
// accounts than that, so it pages with FIRST/SKIP (highest revenue first, OBJID
// breaking ties so pages don't overlap) until a short page. MAX_PAGES bounds it.
const PAGE = 1000
const MAX_PAGES = 20
async function periodAccounts(base: string, cookie: string, startTs: string, endTs: string): Promise<{ rows: Any[][]; truncated: boolean }> {
  const rows: Any[][] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const sql =
      `SELECT FIRST ${PAGE} SKIP ${rows.length} c.OBJID, TRIM(c.FIRSTNAME), TRIM(c.LASTNAME), TRIM(c.MAINPHONE), ` +
      `COUNT(DISTINCT s.OBJID), SUM(si.AMT), MAX(s.LOGDATE) ` +
      `FROM SALE s ` +
      `JOIN SALEITEMS si ON si.SITE = s.SITE AND si.SALEID = s.OBJID ` +
      `JOIN CUSTOMERCODE cc ON cc.OBJID = s.CUSTOMERCODE ` +
      `JOIN CUSTOMER c ON c.OBJID = cc.CUSTOMER ` +
      `WHERE s.SITE = ${LUBE_SITE} AND si.ITEM = ${HOUSE_CHARGE_ITEM} ` +
      `AND s.LOGDATE >= '${startTs}' AND s.LOGDATE < '${endTs}' AND ${HAS_LUBE} ` +
      `GROUP BY c.OBJID, TRIM(c.FIRSTNAME), TRIM(c.LASTNAME), TRIM(c.MAINPHONE) ` +
      `ORDER BY SUM(si.AMT) ASC, c.OBJID ASC` // AMT is negative: most negative = highest revenue
    const res = await runSql(base, cookie, sql)
    const got = res.rows ?? []
    rows.push(...got)
    // A full page (or the server saying it cut rows) means there may be more.
    if (got.length === 0 || (got.length < PAGE && !res.truncated)) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

// House charges left out for having no lube line: tickets and dollars.
async function excludedCharges(base: string, cookie: string, startTs: string, endTs: string) {
  const sql =
    `SELECT COUNT(DISTINCT s.OBJID), SUM(si.AMT) ` +
    `FROM SALE s ` +
    `JOIN SALEITEMS si ON si.SITE = s.SITE AND si.SALEID = s.OBJID ` +
    `WHERE s.SITE = ${LUBE_SITE} AND si.ITEM = ${HOUSE_CHARGE_ITEM} ` +
    `AND s.LOGDATE >= '${startTs}' AND s.LOGDATE < '${endTs}' AND NOT ${HAS_LUBE}`
  const r = (await runSql(base, cookie, sql)).rows?.[0] ?? []
  return { tickets: Math.round(num(r[0])), revenue: Math.round(-num(r[1]) * 100) / 100 }
}

// Wash dollars on house-charged lube tickets (they stay in the totals).
async function washOnLubeTickets(base: string, cookie: string, startTs: string, endTs: string) {
  const sql =
    `SELECT COUNT(DISTINCT s.OBJID), SUM(wi.AMT) ` +
    `FROM SALE s ` +
    `JOIN SALEITEMS wi ON wi.SITE = s.SITE AND wi.SALEID = s.OBJID ` +
    `JOIN ITEM wit ON wit.OBJID = wi.ITEM ` +
    `JOIN ITEMRPTCATEGORY wrc ON wrc.OBJID = wit.REPORTCATEGORY ` +
    `WHERE s.SITE = ${LUBE_SITE} AND wrc.BRANCH STARTING WITH '001001' ` +
    `AND s.LOGDATE >= '${startTs}' AND s.LOGDATE < '${endTs}' AND ${HAS_LUBE} ` +
    `AND EXISTS (SELECT 1 FROM SALEITEMS hi WHERE hi.SITE = s.SITE AND hi.SALEID = s.OBJID AND hi.ITEM = ${HOUSE_CHARGE_ITEM})`
  const r = (await runSql(base, cookie, sql)).rows?.[0] ?? []
  return { tickets: Math.round(num(r[0])), revenue: Math.round(num(r[1]) * 100) / 100 }
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

  let body: { start?: unknown; end?: unknown; compareStart?: unknown; compareEnd?: unknown } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!isDate(body.start) || !isDate(body.end) || body.start > body.end) {
    return json({ error: 'bad_request', message: 'start and end must be YYYY-MM-DD with start <= end.' }, 400, origin)
  }
  const start = body.start as string
  const end = body.end as string
  const hasCompare = body.compareStart != null || body.compareEnd != null
  if (hasCompare && (!isDate(body.compareStart) || !isDate(body.compareEnd) || body.compareStart > body.compareEnd)) {
    return json({ error: 'bad_request', message: 'compareStart and compareEnd must be YYYY-MM-DD with compareStart <= compareEnd.' }, 400, origin)
  }
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400_000) + 1)
  const curStartTs = `${start} 00:00:00`
  const curEndTs = `${addDays(end, 1)} 00:00:00`
  const priorStart = hasCompare ? (body.compareStart as string) : addDays(start, -days)
  const priorEnd = hasCompare ? (body.compareEnd as string) : addDays(start, -1)
  const priorStartTs = `${priorStart} 00:00:00`
  const priorEndTs = `${addDays(priorEnd, 1)} 00:00:00`

  let curRes: { rows: Any[][]; truncated: boolean }, priorRes: { rows: Any[][]; truncated: boolean }
  let excluded: { tickets: number; revenue: number } | null = null
  let washOnLube: { tickets: number; revenue: number } | null = null
  let cookie: string
  try {
    cookie = await login(base, password)
    // The two notes are extras: if either query fails the page still loads.
    ;[curRes, priorRes, excluded, washOnLube] = await Promise.all([
      periodAccounts(base, cookie, curStartTs, curEndTs),
      periodAccounts(base, cookie, priorStartTs, priorEndTs),
      excludedCharges(base, cookie, curStartTs, curEndTs).catch(() => null),
      washOnLubeTickets(base, cookie, curStartTs, curEndTs).catch(() => null),
    ])
  } catch (e) {
    return json({ error: 'query_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }

  type Acct = {
    customerId: string; name: string; company: string; companyKey: string; phone: string | null
    revenue: number; priorRevenue: number; visits: number; priorVisits: number
    avgTicket: number; lastVisit: string | null; pctChange: number | null
    isNew: boolean; isLapsed: boolean
  }
  const byId = new Map<string, Acct>()
  const get = (id: string, first: string, last: string, phone: string | null): Acct => {
    let a = byId.get(id)
    if (!a) {
      const name = nameOf(first, last, id)
      const company = (first.trim() || last.trim() || name).trim()
      const key = normCompany(company)
      a = { customerId: id, name, company, companyKey: key.length >= 2 ? key : 'id:' + id, phone, revenue: 0, priorRevenue: 0, visits: 0, priorVisits: 0, avgTicket: 0, lastVisit: null, pctChange: null, isNew: false, isLapsed: false }
      byId.set(id, a)
    }
    return a
  }
  for (const r of curRes.rows ?? []) {
    const id = String(r[0] ?? '')
    const a = get(id, String(r[1] ?? ''), String(r[2] ?? ''), String(r[3] ?? '').trim() || null)
    a.visits = Math.round(num(r[4]))
    a.revenue = Math.round(-num(r[5]) * 100) / 100 // AMT is negative
    a.lastVisit = r[6] ? String(r[6]).slice(0, 10) : null
  }
  for (const r of priorRes.rows ?? []) {
    const id = String(r[0] ?? '')
    const a = get(id, String(r[1] ?? ''), String(r[2] ?? ''), String(r[3] ?? '').trim() || null)
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
    priorRange: { start: priorStart, end: priorEnd },
    summary,
    accounts,
    truncated: !!(curRes.truncated || priorRes.truncated),
    lubeOnly: true,
    excluded,
    washOnLube,
    note: 'Revenue = House Acct Charge tender (item 4309) at MW19 on tickets with a lube service (branch 001003). Wash-only tickets, employee charges and account payments are excluded.',
  }, 200, origin)
})
