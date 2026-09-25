// drb-msa-audit — Supabase Edge Function (Deno).
// Sale-level audit of MSA (Membership Sales Associate) conversion for DRB sites,
// straight from the live SiteWatch database, so the MSA Performance conversion %
// (which comes from the external dashboard) can be checked against raw sales.
//
// Attribution: the MSA on a sale is the employee attached with the "Wash Sales"
// role (EMPROLE 101, role type 30). The self-serve kiosk seller ("xpt employee")
// is bucketed separately as it is not a real associate.
//
// Numerator (memberships sold): distinct sales carrying an item in the ARM Plans
// Sold category (001004005), non-voided line (FLAGS >= 0). Excluded per the
// owner's rules: (a) a plan CHANGE — the customer already had an active plan
// (a recharge in the 45 days before, or a plan transfer on the day); (b) a
// customer whose plan lapsed on a card DECLINE and who returned within 90 days.
// Both signals come from V_ARM_CUSTOMER_STATS, joined by customer.
//
// Denominator (eligible washes): distinct sales that are pure retail washes by a
// non-member — ARMCUSTOMER IS NULL, a paid Carwashes line (001001001, AMT > 0,
// FLAGS >= 0), and NO comp / employee / rewash / free line (the wash-discount
// categories 001001006 / 001001007 or those words in the item name).
//
// Body: { site: number, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } | { list: true }
// Auth: owner/manager of the Mighty Wash account, or the service role.
// Secrets: MW_DASHBOARD_PASSWORD (503 if absent), MW_DASHBOARD_URL (optional).

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const WASH_SALES_ROLE = 101 // EMPROLE.OBJID for "Wash Sales" (role type 30 = Sales)
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const PLAN_CHANGE_RECHARGE_DAYS = 45 // a recharge within N days before = already an active member
const DECLINE_LAPSE_DAYS = 90        // returned within N days of a card decline

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
  if (!r.ok || !data || (data as { error?: unknown }).error) {
    throw new Error(`custom_query failed (status ${r.status})`)
  }
  return data as SqlResult
}

// SiteWatch SALE.SITE is an internal site id, NOT the MW store number. The real
// store number lives in SITELIST.SITENAME ("MightyWash 001" -> MW01). OLD/HQ rows
// don't match and are skipped.
async function loadSiteMap(base: string, cookie: string): Promise<Map<number, { store: number; label: string }>> {
  const m = new Map<number, { store: number; label: string }>()
  let res: SqlResult
  try { res = await runSql(base, cookie, `SELECT sl.ID, TRIM(sl.SITENAME) FROM SITELIST sl`) } catch { return m }
  for (const r of res.rows ?? []) {
    const id = Math.trunc(Number(r[0]) || 0)
    const nm = String(r[1] ?? '')
    const mm = nm.match(/mightywash\s*0*(\d+)/i)
    if (!id || !mm) continue
    const store = parseInt(mm[1], 10)
    if (!Number.isFinite(store) || store <= 0) continue
    m.set(id, { store, label: `MW${String(store).padStart(2, '0')}` })
  }
  return m
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const addDays = (d: string, n: number): string => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400_000).toISOString().slice(0, 10)
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0)
const nameOf = (first: unknown, last: unknown, empId: unknown): string =>
  [String(first ?? '').trim(), String(last ?? '').trim()].filter(Boolean).join(' ').trim() || `#${empId}`
const isKiosk = (name: string): boolean => /\bxpt\b/i.test(name) || /kiosk/i.test(name)
const dayKey = (v: unknown): string => String(v ?? '').slice(0, 10)

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

  let body: { site?: unknown; start?: unknown; end?: unknown; list?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }

  let cookie: string
  try { cookie = await login(base, password) } catch (e) { return json({ error: 'login_failed', message: String(e) }, 502, origin) }

  // Selectable DRB sites: active MightyWash stores with sales in the last 60 days,
  // minus FlexWash stores (they're audited on the FlexWash side) and HQ. The
  // dropdown value is the internal SITE id; the label is the real store number.
  if (body.list) {
    const { data: fw } = await svc.from('flexwash_sites').select('site_number').eq('active', true)
    const fwStores = new Set(((fw as { site_number: number }[] | null) ?? []).map((s) => s.site_number))
    const cutoff = addDays(new Date().toISOString().slice(0, 10), -60)
    let recent: SqlResult, map: Map<number, { store: number; label: string }>
    try {
      recent = await runSql(base, cookie, `SELECT s.SITE FROM SALE s WHERE s.LOGDATE >= '${cutoff} 00:00:00' GROUP BY s.SITE`)
      map = await loadSiteMap(base, cookie)
    } catch (e) { return json({ error: 'query_failed', message: String(e) }, 502, origin) }
    const recentIds = new Set((recent.rows ?? []).map((r) => Math.trunc(num(r[0]))))
    const sites = [...map.entries()]
      .filter(([id, info]) => recentIds.has(id) && !fwStores.has(info.store))
      .map(([id, info]) => ({ site_number: id, store: info.store, name: info.label }))
      .sort((a, b) => a.store - b.store)
    return json({ ok: true, sites }, 200, origin)
  }

  const site = Math.trunc(num(body.site))
  if (!Number.isInteger(site) || site <= 0) return json({ error: 'bad_request', message: 'site required' }, 400, origin)
  if (!isDate(body.start) || !isDate(body.end) || body.start > body.end) {
    return json({ error: 'bad_request', message: 'start and end must be YYYY-MM-DD with start <= end.' }, 400, origin)
  }
  const start = body.start as string
  const endX = addDays(body.end as string, 1) // exclusive

  const startTs = `${start} 00:00:00`
  const endTs = `${endX} 00:00:00`

  // 1) Membership sales (numerator base), per (sale, Wash-Sales employee, item).
  const soldSql =
    `SELECT s.OBJID, s.CODE, s.LOGDATE, s.CUSTOMERCODE, se.EMPLOYEE, TRIM(e.FIRSTNAME), TRIM(e.LASTNAME), TRIM(it.NAME) ` +
    `FROM SALE s ` +
    `JOIN SALEITEMS si ON si.SITE = s.SITE AND si.SALEID = s.OBJID ` +
    `JOIN ITEM it ON it.OBJID = si.ITEM ` +
    `JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY ` +
    `JOIN SALEEMPLOYEES se ON se.SITE = s.SITE AND se.SALEID = s.OBJID AND se.EMPROLE = ${WASH_SALES_ROLE} ` +
    `JOIN EMPLOYEE e ON e.OBJID = se.EMPLOYEE ` +
    `WHERE s.SITE = ${site} AND si.FLAGS >= 0 AND rc.BRANCH STARTING WITH '001004005' ` +
    `AND s.LOGDATE >= '${startTs}' AND s.LOGDATE < '${endTs}' ` +
    `ORDER BY s.LOGDATE`

  // 2) Eligible washes (denominator), aggregated per Wash-Sales employee. A pure
  //    retail paid wash: a Carwashes line actually paid for (AMT > 0), the sale
  //    total > 0 (not a zeroed-out ticket), and NO comp/employee/rewash line.
  //    (Loyalty/package discount lines are normal on retail washes, so we exclude
  //    by item NAME, not by the discount category.)
  const paidWash = `EXISTS (SELECT 1 FROM SALEITEMS si JOIN ITEM it ON it.OBJID = si.ITEM JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY WHERE si.SITE = s.SITE AND si.SALEID = s.OBJID AND si.FLAGS >= 0 AND rc.BRANCH STARTING WITH '001001001' AND si.AMT > 0)`
  const compLike = `EXISTS (SELECT 1 FROM SALEITEMS si2 JOIN ITEM it2 ON it2.OBJID = si2.ITEM WHERE si2.SITE = s.SITE AND si2.SALEID = s.OBJID AND si2.FLAGS >= 0 AND (UPPER(it2.NAME) CONTAINING 'COMP' OR UPPER(it2.NAME) CONTAINING 'EMPL' OR UPPER(it2.NAME) CONTAINING 'REWASH'))`
  const washSql =
    `SELECT se.EMPLOYEE, TRIM(e.FIRSTNAME), TRIM(e.LASTNAME), COUNT(DISTINCT s.OBJID) ` +
    `FROM SALE s ` +
    `JOIN SALEEMPLOYEES se ON se.SITE = s.SITE AND se.SALEID = s.OBJID AND se.EMPROLE = ${WASH_SALES_ROLE} ` +
    `JOIN EMPLOYEE e ON e.OBJID = se.EMPLOYEE ` +
    `WHERE s.SITE = ${site} AND s.ARMCUSTOMER IS NULL AND s.TOTAL > 0 ` +
    `AND s.LOGDATE >= '${startTs}' AND s.LOGDATE < '${endTs}' ` +
    `AND ${paidWash} AND NOT ${compLike} ` +
    `GROUP BY se.EMPLOYEE, TRIM(e.FIRSTNAME), TRIM(e.LASTNAME)`

  // 3) Exclusion flags per sold sale, one row per sale (avoids the endpoint's
  //    1000-row cap that raw event pulls hit). Correlated against the ARM stats
  //    view by customer: DECL90 = a card decline in the 90d before; PLANCHG = an
  //    active plan just before (recharge within 45d) or a plan transfer that day.
  const flagsSql =
    `SELECT s.OBJID, ` +
    `(SELECT COUNT(*) FROM V_ARM_CUSTOMER_STATS v WHERE v.SITE = s.SITE AND v.CUSTOMER = s.CUSTOMERCODE AND v.DECLINED > 0 AND v.LOGDATE < s.LOGDATE AND v.LOGDATE >= CAST(s.LOGDATE AS DATE) - ${DECLINE_LAPSE_DAYS}), ` +
    `(SELECT COUNT(*) FROM V_ARM_CUSTOMER_STATS v2 WHERE v2.SITE = s.SITE AND v2.CUSTOMER = s.CUSTOMERCODE AND ((v2.RECHARGECOUNT > 0 AND v2.LOGDATE < s.LOGDATE AND v2.LOGDATE >= CAST(s.LOGDATE AS DATE) - ${PLAN_CHANGE_RECHARGE_DAYS}) OR ((v2.TRANSFERINCOUNT > 0 OR v2.TRANSFEROUTCOUNT > 0) AND CAST(v2.LOGDATE AS DATE) = CAST(s.LOGDATE AS DATE)))) ` +
    `FROM SALE s ` +
    `WHERE s.SITE = ${site} AND s.LOGDATE >= '${startTs}' AND s.LOGDATE < '${endTs}' ` +
    `AND EXISTS (SELECT 1 FROM SALEITEMS si JOIN ITEM it ON it.OBJID = si.ITEM JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY WHERE si.SITE = s.SITE AND si.SALEID = s.OBJID AND si.FLAGS >= 0 AND rc.BRANCH STARTING WITH '001004005')`

  let soldRes: SqlResult, washRes: SqlResult, flagRes: SqlResult
  try {
    soldRes = await runSql(base, cookie, soldSql)
    washRes = await runSql(base, cookie, washSql)
    flagRes = await runSql(base, cookie, flagsSql)
  } catch (e) {
    return json({ error: 'query_failed', message: String(e) }, 502, origin)
  }

  // Per-sale exclusion flags by OBJID.
  const flagByObjid = new Map<string, { reactivation: boolean; planChange: boolean }>()
  for (const r of flagRes.rows ?? []) {
    flagByObjid.set(String(r[0] ?? ''), { reactivation: num(r[1]) > 0, planChange: num(r[2]) > 0 })
  }

  // Fold membership-sale rows into one record per sale.
  type Sale = { objid: string; code: string; day: string; customer: string; empId: string; empName: string; items: Set<string> }
  const sales = new Map<string, Sale>()
  for (const r of soldRes.rows ?? []) {
    const objid = String(r[0] ?? '')
    const empId = String(r[4] ?? '')
    const key = objid + ':' + empId // credit each Wash-Sales employee on the sale
    let rec = sales.get(key)
    if (!rec) {
      rec = { objid, code: String(r[1] ?? ''), day: dayKey(r[2]), customer: String(r[3] ?? ''), empId, empName: nameOf(r[5], r[6], empId), items: new Set() }
      sales.set(key, rec)
    }
    const item = String(r[7] ?? '').trim()
    if (item) rec.items.add(item)
  }

  type Row = { employeeId: string; name: string; kiosk: boolean; eligibleWashes: number; soldRaw: number; soldNet: number; excludedPlanChange: number; excludedReactivation: number; conversionPct: number | null }
  const rows = new Map<string, Row>()
  const rowFor = (empId: string, name: string): Row => {
    let row = rows.get(empId)
    if (!row) { row = { employeeId: empId, name, kiosk: isKiosk(name), eligibleWashes: 0, soldRaw: 0, soldNet: 0, excludedPlanChange: 0, excludedReactivation: 0, conversionPct: null }; rows.set(empId, row) }
    return row
  }

  for (const [, w] of washRes.rows.entries()) {
    const empId = String(w[0] ?? '')
    const row = rowFor(empId, nameOf(w[1], w[2], empId))
    row.eligibleWashes += Math.round(num(w[3]))
  }

  const detail: Any[] = []
  for (const s of sales.values()) {
    const row = rowFor(s.empId, s.empName)
    row.soldRaw += 1
    const f = flagByObjid.get(s.objid)
    let excluded: string | null = null
    if (f?.reactivation) { excluded = 'reactivation_90d'; row.excludedReactivation += 1 }
    else if (f?.planChange) { excluded = 'plan_change'; row.excludedPlanChange += 1 }
    else row.soldNet += 1
    detail.push({ code: s.code, day: s.day, customer: s.customer || null, employeeId: s.empId, employee: s.empName, kiosk: isKiosk(s.empName), items: [...s.items], excluded })
  }

  const out = [...rows.values()].map((r) => ({
    ...r,
    conversionPct: r.eligibleWashes > 0 ? Math.round((r.soldNet / r.eligibleWashes) * 1000) / 10 : null,
  })).sort((a, b) => (b.conversionPct ?? -1) - (a.conversionPct ?? -1))

  detail.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))

  const siteLabel = (await loadSiteMap(base, cookie)).get(site)?.label ?? `Site ${site}`

  return json({
    ok: true,
    site,
    siteLabel,
    range: { start, end: body.end },
    rows: out,
    detail,
    rules: {
      attribution: 'Wash Sales role (EMPROLE 101); "xpt"/kiosk shown separately',
      soldExclusions: `plan change (recharge within ${PLAN_CHANGE_RECHARGE_DAYS}d or transfer) and card-decline return within ${DECLINE_LAPSE_DAYS}d`,
      eligibleWash: 'non-member (ARMCUSTOMER null), sale total > 0, a paid Carwashes line, no comp/employee/rewash line',
    },
    diag: { soldSales: flagByObjid.size, excludedPlanChange: [...rows.values()].reduce((a, r) => a + r.excludedPlanChange, 0), excludedReactivation: [...rows.values()].reduce((a, r) => a + r.excludedReactivation, 0) },
  }, 200, origin)
})
