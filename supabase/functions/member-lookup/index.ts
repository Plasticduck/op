// member-lookup — Supabase Edge Function (Deno).
// Active-member lookup by license plate for the lube center. Given a plate, it
// asks BOTH car-wash systems whether that vehicle is an active member:
//   - FlexWash: POST /external/resolve-vehicle { licensePlate } -> the vehicle's
//     subscription (current status from its statusLog, package, memberSince).
//   - DRB (SiteWatch): find the plate in the live database and decide "active"
//     from recent membership billing (an ARM plan purchase or recharge in the
//     trailing window). SiteWatch's plate table isn't referenced anywhere else in
//     the app, so the plate column is DISCOVERED from the Firebird catalog at
//     runtime (cached) and the match is reported in `drb.diagnostics` so the exact
//     schema can be confirmed against a real plate.
//
// Body: { plate: string, state?: string } | { mode: 'discover' }
// Auth: owner/manager of the Mighty Wash account, or the service role.
// Secrets: FLEXWASH_CLIENT_ID, FLEXWASH_CLIENT_SECRET, MW_DASHBOARD_PASSWORD,
//          MW_DASHBOARD_URL (optional).

import { createClient } from 'npm:@supabase/supabase-js@2'

const FLEX_BASE = 'https://api.flexwash.com'
const PROVIDER = 'flexwash'
const DEFAULT_DRB_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
// ARM membership billing lives under this report-category branch; a purchase or
// recharge here in the trailing window means an active DRB member.
const ARM_BILLING_BRANCH = '001004'
const ACTIVE_WINDOW_DAYS = 45
// FlexWash subscription statuses that count as an active (or paused-but-kept) member.
const FLEX_ACTIVE = new Set(['active', 'active_external', 'prepaid_active'])
const FLEX_PAUSED = new Set(['frozen'])

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

// Normalize a plate for matching: uppercase, strip everything but A-Z0-9.
const normPlate = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// ---- FlexWash -------------------------------------------------------------
async function getFlexToken(svc: Any, clientId: string, clientSecret: string): Promise<string> {
  const { data: cached } = await svc.from('service_tokens').select('token, expires_at').eq('provider', PROVIDER).maybeSingle()
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) return cached.token as string
  const res = await fetch(`${FLEX_BASE}/external/access-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.accessToken) throw new Error(`token request failed (${res.status})`)
  await svc.from('service_tokens').upsert(
    { provider: PROVIDER, token: j.accessToken, expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'provider' },
  )
  return j.accessToken as string
}

async function flexResolve(token: string, plate: string): Promise<Any> {
  const res = await fetch(`${FLEX_BASE}/external/resolve-vehicle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ licensePlate: plate }),
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

function flexResult(status: number, data: Any) {
  if (status === 404) return { found: false, active: false, status: null as string | null, label: 'Not a member', plan: null, memberSince: null, customerId: null }
  if (status >= 400 || !data?.vehicle) {
    return { found: false, active: false, status: null, label: 'Lookup failed', plan: null, memberSince: null, customerId: null, error: data?.error ?? `status ${status}` }
  }
  const v = data.vehicle
  const sub = v.vehicleSubscription
  // Current status = the most recent entry in the subscription's statusLog.
  let cur: string | null = null
  if (sub?.statusLog?.length) {
    const sorted = [...sub.statusLog].sort((a: Any, b: Any) => (String(a.insertedAt) < String(b.insertedAt) ? 1 : -1))
    cur = sorted[0]?.status ?? null
  }
  const active = cur ? FLEX_ACTIVE.has(cur) : false
  const paused = cur ? FLEX_PAUSED.has(cur) : false
  const label = !sub ? 'Not a member' : active ? 'Active member' : paused ? 'Frozen' : 'Inactive'
  return {
    found: true,
    active,
    paused,
    status: cur,
    label,
    plan: sub?.package?.name ?? null,
    priceCents: sub?.package?.priceInCents ?? null,
    memberSince: v.memberSince ?? null,
    customerId: v.customerId ?? null,
  }
}

// ---- DRB / SiteWatch ------------------------------------------------------
async function drbLogin(base: string, password: string): Promise<string> {
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
    throw new Error(`custom_query failed (${r.status}): ${JSON.stringify((data as Any)?.error ?? '').slice(0, 200)}`)
  }
  return data as SqlResult
}

// Candidate plate columns, discovered from the Firebird catalog and cached for the
// life of the (warm) function instance. Each entry knows its table and how it links
// to a customer so membership can be judged.
type PlateCol = { table: string; col: string; link: 'ARMCUSTOMER' | 'CUSTOMER' | 'CUSTOMERCODE' | null }
let plateColsCache: PlateCol[] | null = null

async function discoverPlateCols(base: string, cookie: string): Promise<PlateCol[]> {
  if (plateColsCache) return plateColsCache
  // Tables/columns whose name contains PLATE (LICENSEPLATE, PLATE, PLATENUMBER…).
  const cat = await runSql(base, cookie,
    `SELECT TRIM(rf.RDB$RELATION_NAME), TRIM(rf.RDB$FIELD_NAME) ` +
    `FROM RDB$RELATION_FIELDS rf ` +
    `WHERE rf.RDB$FIELD_NAME CONTAINING 'PLATE' AND rf.RDB$RELATION_NAME NOT STARTING WITH 'RDB$' AND rf.RDB$RELATION_NAME NOT STARTING WITH 'MON$'`)
  const raw = (cat.rows ?? []).map((r) => ({ table: String(r[0] ?? '').trim(), col: String(r[1] ?? '').trim() })).filter((x) => x.table && x.col)
  if (!raw.length) { plateColsCache = []; return [] }
  // For each candidate table, learn which customer-link columns it has.
  const tables = [...new Set(raw.map((x) => x.table))]
  const inList = tables.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ')
  const colsRes = await runSql(base, cookie,
    `SELECT TRIM(RDB$RELATION_NAME), TRIM(RDB$FIELD_NAME) FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME IN (${inList})`)
  const colsByTable = new Map<string, Set<string>>()
  for (const r of colsRes.rows ?? []) {
    const t = String(r[0] ?? '').trim(); const c = String(r[1] ?? '').trim().toUpperCase()
    if (!colsByTable.has(t)) colsByTable.set(t, new Set())
    colsByTable.get(t)!.add(c)
  }
  const linkOf = (t: string): PlateCol['link'] => {
    const cols = colsByTable.get(t) ?? new Set()
    if (cols.has('ARMCUSTOMER')) return 'ARMCUSTOMER'
    if (cols.has('CUSTOMER')) return 'CUSTOMER'
    if (cols.has('CUSTOMERCODE')) return 'CUSTOMERCODE'
    return null
  }
  // Prefer tables that link to a customer; among those, ARM links first.
  const out = raw.map((x) => ({ ...x, link: linkOf(x.table) }))
  out.sort((a, b) => {
    const rank = (l: PlateCol['link']) => (l === 'ARMCUSTOMER' ? 0 : l === 'CUSTOMER' ? 1 : l === 'CUSTOMERCODE' ? 2 : 3)
    return rank(a.link) - rank(b.link)
  })
  plateColsCache = out
  return out
}

// Resolve a normalized plate to customer OBJIDs via a candidate plate column.
async function plateToCustomers(base: string, cookie: string, pc: PlateCol, plate: string): Promise<string[]> {
  const normExpr = `UPPER(REPLACE(REPLACE(REPLACE(TRIM(p.${pc.col}), ' ', ''), '-', ''), '.', ''))`
  let sql: string
  if (pc.link === 'CUSTOMER') {
    sql = `SELECT DISTINCT p.CUSTOMER FROM ${pc.table} p WHERE ${normExpr} = '${plate}' ROWS 50`
  } else if (pc.link === 'CUSTOMERCODE') {
    sql = `SELECT DISTINCT cc.CUSTOMER FROM ${pc.table} p JOIN CUSTOMERCODE cc ON cc.OBJID = p.CUSTOMERCODE WHERE ${normExpr} = '${plate}' ROWS 50`
  } else if (pc.link === 'ARMCUSTOMER') {
    // ARMCUSTOMER row -> its CUSTOMER. ARMCUSTOMER has a CUSTOMER column.
    sql = `SELECT DISTINCT ac.CUSTOMER FROM ${pc.table} p JOIN ARMCUSTOMER ac ON ac.OBJID = p.ARMCUSTOMER WHERE ${normExpr} = '${plate}' ROWS 50`
  } else {
    return []
  }
  const res = await runSql(base, cookie, sql)
  return (res.rows ?? []).map((r) => String(r[0] ?? '').trim()).filter(Boolean)
}

// Is any of these customers an active DRB member? (ARM plan purchase or recharge
// under the ARM billing branch in the trailing window.) Returns the best record.
async function drbActiveFor(base: string, cookie: string, customerIds: string[]): Promise<Any> {
  if (!customerIds.length) return { active: false }
  const ids = customerIds.map((c) => c.replace(/[^0-9]/g, '')).filter(Boolean)
  if (!ids.length) return { active: false }
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400_000).toISOString().slice(0, 10)
  const inIds = ids.join(', ')
  // Name + most recent ARM-billing date per customer.
  const sql =
    `SELECT c.OBJID, TRIM(c.FIRSTNAME), TRIM(c.LASTNAME), ` +
    `(SELECT MAX(s.LOGDATE) FROM SALE s ` +
    `  JOIN CUSTOMERCODE cc ON cc.OBJID = s.CUSTOMERCODE AND cc.CUSTOMER = c.OBJID ` +
    `  JOIN SALEITEMS si ON si.SITE = s.SITE AND si.SALEID = s.OBJID AND si.FLAGS >= 0 ` +
    `  JOIN ITEM it ON it.OBJID = si.ITEM ` +
    `  JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY ` +
    `  WHERE rc.BRANCH STARTING WITH '${ARM_BILLING_BRANCH}') ` +
    `FROM CUSTOMER c WHERE c.OBJID IN (${inIds})`
  const res = await runSql(base, cookie, sql)
  let best: Any = { active: false }
  for (const r of res.rows ?? []) {
    const name = [String(r[1] ?? '').trim(), String(r[2] ?? '').trim()].filter(Boolean).join(' ').trim() || null
    const lastBill = r[3] ? String(r[3]).slice(0, 10) : null
    const active = !!lastBill && lastBill >= cutoff
    const rec = { active, name, customerObjid: String(r[0] ?? ''), lastBillingDate: lastBill }
    if (active) return { ...rec, label: 'Active member' }
    if (!best.name) best = { ...rec, label: lastBill ? 'Inactive (lapsed)' : 'Not a member' }
  }
  return best
}

async function drbLookup(base: string, password: string, plateNorm: string): Promise<Any> {
  const cookie = await drbLogin(base, password)
  const cols = await discoverPlateCols(base, cookie)
  const diagnostics: Any = { plateColumns: cols.map((c) => `${c.table}.${c.col}${c.link ? ` -> ${c.link}` : ''}`) }
  if (!cols.length) {
    return { found: false, active: false, label: 'No plate data', plan: null, memberSince: null, diagnostics: { ...diagnostics, note: 'No PLATE column found in SiteWatch.' } }
  }
  // Try candidate columns in preference order; stop at the first that matches a row.
  let matchedVia: string | null = null
  let customers: string[] = []
  for (const pc of cols) {
    if (!pc.link) continue
    try {
      const found = await plateToCustomers(base, cookie, pc, plateNorm)
      if (found.length) { customers = found; matchedVia = `${pc.table}.${pc.col} -> ${pc.link}`; break }
    } catch (e) { diagnostics[`err_${pc.table}_${pc.col}`] = String(e).slice(0, 160) }
  }
  diagnostics.matchedVia = matchedVia
  if (!customers.length) {
    return { found: false, active: false, label: 'Not a member', plan: null, memberSince: null, diagnostics }
  }
  const rec = await drbActiveFor(base, cookie, customers)
  return {
    found: true,
    active: !!rec.active,
    label: rec.label ?? (rec.active ? 'Active member' : 'Inactive'),
    name: rec.name ?? null,
    lastBillingDate: rec.lastBillingDate ?? null,
    plan: null,
    memberSince: null,
    diagnostics,
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: owner/manager of the Mighty Wash account, or the service role.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).single()
    if (!p || (p.role !== 'owner' && p.role !== 'manager')) return json({ error: 'forbidden' }, 403, origin)
    if (p.account_id !== MW_ACCOUNT) return json({ error: 'unsupported_account' }, 400, origin)
  }

  const flexId = Deno.env.get('FLEXWASH_CLIENT_ID')
  const flexSecret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  const drbPassword = Deno.env.get('MW_DASHBOARD_PASSWORD')
  const drbBase = (Deno.env.get('MW_DASHBOARD_URL') ?? DEFAULT_DRB_BASE).replace(/\/$/, '')

  let body: { plate?: string; state?: string; mode?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  // Discovery helper: list SiteWatch plate columns (no plate needed).
  if (body.mode === 'discover') {
    if (!drbPassword) return json({ error: 'no_key', message: 'DRB is not configured.' }, 503, origin)
    try {
      const cookie = await drbLogin(drbBase, drbPassword)
      plateColsCache = null
      const cols = await discoverPlateCols(drbBase, cookie)
      return json({ ok: true, plateColumns: cols }, 200, origin)
    } catch (e) { return json({ error: 'discover_failed', message: String(e) }, 502, origin) }
  }

  const plateRaw = String(body.plate ?? '').trim()
  const plate = normPlate(plateRaw)
  if (!plate || plate.length < 2) return json({ error: 'bad_request', message: 'A license plate is required.' }, 400, origin)

  // Query both systems in parallel; each failure is isolated so one source being
  // down never blanks the other.
  const flexP = (async () => {
    if (!flexId || !flexSecret) return { found: false, active: false, label: 'Not configured', plan: null, memberSince: null }
    try {
      const token = await getFlexToken(svc, flexId, flexSecret)
      const { status, data } = await flexResolve(token, plate)
      return flexResult(status, data)
    } catch (e) { return { found: false, active: false, label: 'Lookup failed', plan: null, memberSince: null, error: String(e).slice(0, 160) } }
  })()
  const drbP = (async () => {
    if (!drbPassword) return { found: false, active: false, label: 'Not configured', plan: null, memberSince: null }
    try { return await drbLookup(drbBase, drbPassword, plate) }
    catch (e) { return { found: false, active: false, label: 'Lookup failed', plan: null, memberSince: null, error: String(e).slice(0, 160) } }
  })()

  const [flex, drb] = await Promise.all([flexP, drbP])
  const anyActive = !!(flex as Any).active || !!(drb as Any).active
  return json({ ok: true, plate: plateRaw, normalizedPlate: plate, anyActive, flexwash: flex, drb }, 200, origin)
})
