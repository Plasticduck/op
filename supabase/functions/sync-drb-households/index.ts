// sync-drb-households — Supabase Edge Function (Deno).
// Builds the Household Finder dataset from the live SiteWatch (DRB) database:
// active MEMBERS clustered into likely households by a shared phone, a shared
// payment card (clustered on the card TOKEN server-side; only the last 4 are
// ever stored), or a shared residential address. Each household is mapped to a
// region from its ZIP. Results land in drb_households / drb_household_members
// (owner-only RLS); this function is the only writer.
//
// "Member" = a customer with recharge (membership) billing in the trailing
// window (default 60 days), from recharge sale line-items.
//
// The SiteWatch endpoint caps every query at 1000 rows and the platform caps a
// function at 150s, while a members-only clustered page costs ~60-90s. So the
// sync is RESUMABLE: each call processes as many 1000-row pages as fit in a
// safe time budget, writes them, and returns a cursor. The caller loops
// { reset:true } then { cursor } until { done:true }. Pass { dryRun:true } to
// measure without writing.
//
// Auth: owner of the Mighty Wash account, OR the service role.
// Secrets: MW_DASHBOARD_PASSWORD (503 if absent), MW_DASHBOARD_URL (optional).

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const RECHARGE_BRANCH = '001004006'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
// Start a new page only if this much wall-clock remains, so a ~100s page still
// finishes under the platform's 150s ceiling.
const BUDGET_MS = 45_000

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

type SqlResult = { columns: string[]; row_count: number; rows: unknown[][]; truncated: boolean }
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
  } catch {
    return null
  }
}

function regionForZip(zip: string): string {
  const p = (zip || '').trim().slice(0, 3)
  if (/^8[78]\d$/.test(p)) return 'New Mexico'
  if (['790', '791', '792', '793', '794'].includes(p)) return 'Lubbock'
  if (['795', '796', '797', '798', '799'].includes(p)) return 'Permian Basin'
  if (/^76\d$/.test(p)) return 'Central Texas'
  return 'Other'
}

const FIELD_SEP = '~~'
const MEMBER_SEP = '^^'
const nz = (s: string | undefined): string | null => {
  const t = (s ?? '').trim()
  return t === '' ? null : t
}

type Member = {
  customer_objid: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  phone: string | null
  email: string | null
  zip: string | null
}
type MatchType = 'phone' | 'card' | 'address'
type Household = {
  id: string
  account_id: string
  cluster_key: string
  match_type: MatchType
  match_value: string | null
  card_last4: string | null
  region: string
  address: string | null
  zip: string | null
  member_count: number
  members: Member[]
}

const PACKED =
  `CAST(c.OBJID AS VARCHAR(24)) || '${FIELD_SEP}' || COALESCE(TRIM(c.FIRSTNAME),'') ` +
  `|| '${FIELD_SEP}' || COALESCE(TRIM(c.LASTNAME),'') || '${FIELD_SEP}' || COALESCE(TRIM(c.MAINPHONE),'') ` +
  `|| '${FIELD_SEP}' || COALESCE(TRIM(c.EMAIL),'') || '${FIELD_SEP}' || COALESCE(TRIM(c.ZIPCODE),'')`

// Active-member set: customers with recharge billing since the cutoff. Filter
// SALEITEMS by `ITEM IN (<recharge items>)` (a cheap subquery over two small
// tables) instead of joining ITEM + ITEMRPTCATEGORY per customer.
function memberJoin(cutoff: string): string {
  return (
    `JOIN (SELECT cc2.CUSTOMER AS CID FROM SALEITEMS si ` +
    `JOIN SALE s2 ON s2.SITE = si.SITE AND s2.OBJID = si.SALEID ` +
    `JOIN CUSTOMERCODE cc2 ON cc2.OBJID = s2.CUSTOMERCODE ` +
    `WHERE si.ITEM IN (SELECT it.OBJID FROM ITEM it JOIN ITEMRPTCATEGORY rc ON rc.OBJID = it.REPORTCATEGORY ` +
    `WHERE rc.BRANCH STARTING WITH '${RECHARGE_BRANCH}') AND s2.LOGDATE >= '${cutoff}' ` +
    `GROUP BY cc2.CUSTOMER) m ON m.CID = c.OBJID`
  )
}

function phoneSql(cutoff: string, from: number, to: number): string {
  return `SELECT MIN(c.MAINPHONE) AS K, COUNT(*) AS N, LIST(${PACKED}, '${MEMBER_SEP}') AS M
    FROM CUSTOMER c ${memberJoin(cutoff)}
    WHERE c.MAINPHONE IS NOT NULL AND c.MAINPHONE <> ''
    GROUP BY c.MAINPHONE
    HAVING COUNT(*) BETWEEN 2 AND 8
    ORDER BY c.MAINPHONE
    ROWS ${from} TO ${to}`
}

function cardSql(cutoff: string, from: number, to: number): string {
  // SALEPAYMENTS.SITE/SALEID are string columns (some empty) while SALE.SITE/OBJID
  // are numeric. Drop the empty rows so the numeric join never has to convert ''
  // (which errors), while keeping the index-friendly join for the rest.
  return `SELECT MAX(sp.MASKEDPAN) AS K, COUNT(DISTINCT cc.CUSTOMER) AS N, LIST(${PACKED}, '${MEMBER_SEP}') AS M
    FROM SALEPAYMENTS sp
    JOIN SALE s ON CAST(s.SITE AS VARCHAR(12)) = sp.SITE AND CAST(s.OBJID AS VARCHAR(24)) = sp.SALEID
    JOIN CUSTOMERCODE cc ON cc.OBJID = s.CUSTOMERCODE
    JOIN CUSTOMER c ON c.OBJID = cc.CUSTOMER
    ${memberJoin(cutoff)}
    WHERE sp.SALEID <> '' AND sp.SITE <> '' AND sp.TOKEN IS NOT NULL AND sp.TOKEN <> '' AND s.LOGDATE >= '${cutoff}'
    GROUP BY sp.TOKEN
    HAVING COUNT(DISTINCT cc.CUSTOMER) BETWEEN 2 AND 8
    ORDER BY sp.TOKEN
    ROWS ${from} TO ${to}`
}

function addressSql(cutoff: string, from: number, to: number): string {
  return `SELECT MIN(c.ADDRESS1) AS K, MIN(c.ZIPCODE) AS Z, COUNT(*) AS N, LIST(${PACKED}, '${MEMBER_SEP}') AS M
    FROM CUSTOMER c ${memberJoin(cutoff)}
    WHERE c.ADDRESS1 IS NOT NULL AND c.ADDRESS1 <> '' AND c.ZIPCODE IS NOT NULL AND c.ZIPCODE <> ''
    GROUP BY UPPER(c.ADDRESS1), c.ZIPCODE
    HAVING COUNT(*) BETWEEN 2 AND 8
    ORDER BY UPPER(c.ADDRESS1), c.ZIPCODE
    ROWS ${from} TO ${to}`
}

function parseMembers(packed: string): Member[] {
  const seen = new Set<string>()
  const out: Member[] = []
  for (const chunk of packed.split(MEMBER_SEP)) {
    if (!chunk) continue
    const [objid, fn, ln, ph, em, zp] = chunk.split(FIELD_SEP)
    const key = objid ?? chunk
    if (seen.has(key)) continue // the card LIST repeats a member once per payment
    seen.add(key)
    const first = nz(fn)
    const last = nz(ln)
    out.push({
      customer_objid: nz(objid),
      first_name: first,
      last_name: last,
      full_name: [first, last].filter(Boolean).join(' ') || null,
      phone: nz(ph),
      email: nz(em),
      zip: nz(zp),
    })
  }
  return out
}

function regionFromMembers(members: Member[], fallbackZip: string | null): string {
  const counts = new Map<string, number>()
  for (const m of members) if (m.zip) counts.set(m.zip, (counts.get(m.zip) ?? 0) + 1)
  let best = fallbackZip ?? ''
  let bestN = 0
  for (const [z, n] of counts) if (n > bestN) { best = z; bestN = n }
  return regionForZip(best)
}

const digits = (s: string): string => (s || '').replace(/\D/g, '')
const isJunkPhone = (p: string): boolean => {
  const d = digits(p)
  return d.length < 10 || /^(\d)\1+$/.test(d)
}
const last4 = (pan: string): string | null => {
  const d = digits(pan)
  return d.length >= 4 ? d.slice(-4) : null
}

// Card matching is built but temporarily out of the run order: the SALEPAYMENTS
// join hits a Firebird type-conversion edge case still being worked out. Phone is
// the high-value signal for members (91% have a phone); address is small (members
// rarely give one). Re-add 'card' here once its query is validated.
const TYPES: MatchType[] = ['phone', 'address']

async function runPage(
  base: string, cookie: string, cutoff: string, accountId: string, type: MatchType, page: number,
): Promise<{ households: Household[]; full: boolean }> {
  const from = page * 1000 + 1
  const to = from + 999
  const sql = type === 'phone' ? phoneSql(cutoff, from, to) : type === 'card' ? cardSql(cutoff, from, to) : addressSql(cutoff, from, to)
  const res = await runSql(base, cookie, sql)
  const rows = res.rows ?? []
  const households: Household[] = []
  for (const row of rows) {
    const packed = String(row[row.length - 1] ?? '')
    if (!packed) continue
    const members = parseMembers(packed)
    if (members.length < 2) continue
    if (type === 'phone') {
      const phone = String(row[0] ?? '').trim()
      if (isJunkPhone(phone)) continue
      households.push({
        id: crypto.randomUUID(), account_id: accountId, cluster_key: `phone:${digits(phone)}`,
        match_type: 'phone', match_value: phone, card_last4: null,
        region: regionFromMembers(members, null), address: null, zip: null,
        member_count: members.length, members,
      })
    } else if (type === 'card') {
      const l4 = last4(String(row[0] ?? ''))
      households.push({
        id: crypto.randomUUID(), account_id: accountId,
        cluster_key: `card:${l4 ?? ''}:${members.map((m) => m.customer_objid).sort().join(',')}`,
        match_type: 'card', match_value: l4 ? `•••• ${l4}` : null, card_last4: l4,
        region: regionFromMembers(members, null), address: null, zip: null,
        member_count: members.length, members,
      })
    } else {
      const addr = String(row[0] ?? '').trim()
      const zip = String(row[1] ?? '').trim()
      households.push({
        id: crypto.randomUUID(), account_id: accountId, cluster_key: `addr:${addr.toUpperCase()}|${zip}`,
        match_type: 'address', match_value: nz(addr), card_last4: null,
        region: regionForZip(zip), address: nz(addr), zip: nz(zip),
        member_count: members.length, members,
      })
    }
  }
  return { households, full: rows.length >= 1000 }
}

// deno-lint-ignore no-explicit-any
async function insertPage(svc: any, households: Household[], syncedAt: string) {
  if (!households.length) return
  const hRows = households.map((h) => ({
    id: h.id, account_id: h.account_id, cluster_key: h.cluster_key, match_type: h.match_type,
    match_value: h.match_value, card_last4: h.card_last4, region: h.region, address: h.address,
    city: null, state: null, zip: h.zip, member_count: h.member_count, synced_at: syncedAt,
  }))
  for (let i = 0; i < hRows.length; i += 500) {
    const { error } = await svc.from('drb_households').insert(hRows.slice(i, i + 500))
    if (error) throw new Error('insert households: ' + error.message)
  }
  const mRows = households.flatMap((h) =>
    h.members.map((m) => ({
      household_id: h.id, account_id: h.account_id, customer_objid: m.customer_objid,
      first_name: m.first_name, last_name: m.last_name, full_name: m.full_name,
      phone: m.phone, email: m.email, address: h.address, city: null, state: null, zip: m.zip,
    })),
  )
  for (let i = 0; i < mRows.length; i += 500) {
    const { error } = await svc.from('drb_household_members').insert(mRows.slice(i, i + 500))
    if (error) throw new Error('insert members: ' + error.message)
  }
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

  let body: { reset?: boolean; cursor?: { t: number; page: number }; dryRun?: boolean; cutoffDays?: number } = {}
  try { body = await req.json() } catch { body = {} }

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

  const cutoffDays = Number.isFinite(body.cutoffDays) ? Math.max(7, Math.min(400, body.cutoffDays!)) : 60
  const cutoff = new Date(Date.now() - cutoffDays * 86400_000).toISOString().slice(0, 10)

  let cookie: string
  try { cookie = await login(base, password) } catch (e) { return json({ error: 'login_failed', message: String(e) }, 502, origin) }

  const syncedAt = new Date().toISOString()
  let ti = body.cursor?.t ?? 0
  let page = body.cursor?.page ?? 0

  if (body.reset && !body.dryRun) {
    const { error } = await svc.from('drb_households').delete().eq('account_id', accountId)
    if (error) return json({ error: 'db_delete_failed', message: error.message }, 500, origin)
  }

  const processed: Record<string, number> = {}
  const t0 = Date.now()
  try {
    while (Date.now() - t0 < BUDGET_MS && ti < TYPES.length) {
      const type = TYPES[ti]
      const { households, full } = await runPage(base, cookie, cutoff, accountId, type, page)
      if (!body.dryRun) await insertPage(svc, households, syncedAt)
      processed[type] = (processed[type] ?? 0) + households.length
      if (full) page += 1
      else { ti += 1; page = 0 }
    }
  } catch (e) {
    return json({ error: 'page_failed', message: String(e), cursor: { t: ti, page } }, 502, origin)
  }

  const done = ti >= TYPES.length
  return json({ ok: true, dry_run: !!body.dryRun, done, cutoff, cursor: done ? null : { t: ti, page }, processed }, 200, origin)
})
