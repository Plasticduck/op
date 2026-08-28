// lube-stats — Supabase Edge Function (Deno).
// Live statistics for the Mighty Wash lube shop (DRB store 019 = SiteWatch site
// id 17), kept entirely separate from car-wash reporting. On a normal call it
// returns the daily series, category breakdown, and totals for a date range,
// queried live from DRB. With { persist: true } (service role / cron) it also
// upserts the daily series into lube_stats_days so the history is retained.
//
// DRB accounting: net sales = branches 001001..001004 (wash/detail/lube/plans),
// tax = 001010, tenders/settlement = 001008/001009 (excluded). One row per day,
// so even multi-year ranges stay under the dashboard's 1000-row cap.
//
// Secrets: MW_DASHBOARD_PASSWORD (503 if absent), MW_DASHBOARD_URL (optional).

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const LUBE_SITE = 17 // SiteWatch site id for store 019
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

type SqlResult = { columns: string[]; row_count: number; rows: unknown[][] }
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
const num = (v: unknown) => Number(v) || 0

// Net-sales branches (wash/detail/lube/plans). Tax is 001010; tenders/settlement
// (001008/001009), deposits (001005), paidouts (001006) are excluded.
const SALES_BRANCHES = "(rc.BRANCH STARTING WITH '001001' OR rc.BRANCH STARTING WITH '001002' OR rc.BRANCH STARTING WITH '001003' OR rc.BRANCH STARTING WITH '001004')"

function daysSql(start: string, end: string): string {
  return `SELECT s.LOGDATE AS D, COUNT(DISTINCT s.OBJID) AS TICKETS,
    ROUND(SUM(CASE WHEN ${SALES_BRANCHES} THEN si.AMT ELSE 0 END),2) AS NET,
    ROUND(SUM(CASE WHEN rc.BRANCH STARTING WITH '001010' THEN si.AMT ELSE 0 END),2) AS TAX
    FROM SALEITEMS si
    JOIN SALE s ON s.SITE = si.SITE AND s.OBJID = si.SALEID
    JOIN ITEM it ON it.OBJID = si.ITEM
    JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY
    WHERE s.SITE = ${LUBE_SITE} AND s.LOGDATE >= '${start}' AND s.LOGDATE <= '${end}'
    GROUP BY s.LOGDATE ORDER BY s.LOGDATE`
}

function categoriesSql(start: string, end: string): string {
  return `SELECT rc.NAME AS CAT, ROUND(SUM(si.AMT),2) AS DOLLARS, COUNT(*) AS ITEMS
    FROM SALEITEMS si
    JOIN SALE s ON s.SITE = si.SITE AND s.OBJID = si.SALEID
    JOIN ITEM it ON it.OBJID = si.ITEM
    JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY
    WHERE s.SITE = ${LUBE_SITE} AND s.LOGDATE >= '${start}' AND s.LOGDATE <= '${end}' AND ${SALES_BRANCHES}
    GROUP BY rc.NAME HAVING SUM(si.AMT) <> 0 ORDER BY 2 DESC`
}

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

  let body: { start?: string; end?: string; persist?: boolean } = {}
  try { body = await req.json() } catch { body = {} }

  // Owner/manager of the MW account, or the service role (page + cron).
  const authHeader = req.headers.get('Authorization') ?? ''
  let accountId = MW_ACCOUNT
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await userClient.auth.getUser()
    const uid = userData.user?.id
    if (!uid) return json({ error: 'unauthorized' }, 401, origin)
    const { data: profile } = await svc.from('users').select('role, account_id').eq('id', uid).single()
    if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) return json({ error: 'forbidden' }, 403, origin)
    if (profile.account_id !== MW_ACCOUNT) return json({ error: 'unsupported_account' }, 400, origin)
    accountId = profile.account_id as string
  }

  const end = isDate(body.end) ? body.end : new Date().toISOString().slice(0, 10)
  const start = isDate(body.start) ? body.start : new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)

  let cookie: string
  try { cookie = await login(base, password) } catch (e) { return json({ error: 'login_failed', message: String(e) }, 502, origin) }

  let dayRows: SqlResult, catRows: SqlResult
  try {
    dayRows = await runSql(base, cookie, daysSql(start, end))
    catRows = body.persist ? { columns: [], row_count: 0, rows: [] } : await runSql(base, cookie, categoriesSql(start, end))
  } catch (e) {
    return json({ error: 'query_failed', message: String(e) }, 502, origin)
  }

  const days = (dayRows.rows ?? []).map((r) => ({
    date: String(r[0] ?? '').slice(0, 10),
    tickets: num(r[1]),
    net_sales: num(r[2]),
    tax: num(r[3]),
  }))

  if (body.persist) {
    const rows = days.map((d) => ({
      account_id: accountId, site_number: 19, date: d.date,
      tickets: d.tickets, net_sales: d.net_sales, tax: d.tax, synced_at: new Date().toISOString(),
    }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await svc.from('lube_stats_days').upsert(rows.slice(i, i + 500), { onConflict: 'account_id,date' })
      if (error) return json({ error: 'db_upsert_failed', message: error.message }, 500, origin)
    }
    return json({ ok: true, persisted: rows.length, start, end }, 200, origin)
  }

  const categories = (catRows.rows ?? []).map((r) => ({ name: String(r[0] ?? ''), dollars: num(r[1]), items: num(r[2]) }))
  const totals = days.reduce(
    (a, d) => ({ net_sales: a.net_sales + d.net_sales, tax: a.tax + d.tax, tickets: a.tickets + d.tickets }),
    { net_sales: 0, tax: 0, tickets: 0 },
  )
  return json({ ok: true, start, end, days, categories, totals }, 200, origin)
})
