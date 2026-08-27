// sync-drb-households — Supabase Edge Function (Deno).
// Builds the Household Finder dataset: it clusters the live SiteWatch (DRB)
// CUSTOMER table into likely households by shared residential address, maps each
// household to a region from its ZIP, and stores the result in the
// `drb_households` / `drb_household_members` tables for the admin-only page to
// read. It talks to the same password-gated Mighty Wash dashboard the
// `site-performance` function uses (raw read-only SQL via /api/custom_query),
// and it only writes to the two household tables.
//
// Owner-only, and only for the Mighty Wash account (the one with dashboard
// access). The heavy lifting stays on the SiteWatch side: each page is a single
// grouped pass returning <=1000 household rows (the dashboard caps every query
// at 1000 rows and cannot survive a live join against the huge SALE table).
//
// Secrets (set via `supabase secrets set`):
//   MW_DASHBOARD_PASSWORD — the dashboard's sign-in password (503 'no_key' if absent)
//   MW_DASHBOARD_URL      — base URL, defaults to the known Funnel host
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
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
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

// Log in and return the Flask `session` cookie (302 carries the Set-Cookie, so
// we must not auto-follow the redirect or the cookie is lost).
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
    throw new Error(`custom_query failed (status ${r.status}): ${JSON.stringify(data?.error ?? data)}`)
  }
  return data as SqlResult
}

// Residential region from a US ZIP, using the Mighty Wash geography. West Texas
// and SE New Mexico only; anything else lands in "Other".
function regionForZip(zip: string): string {
  const p = (zip || '').trim().slice(0, 3)
  if (/^8[78]\d$/.test(p)) return 'New Mexico' // 87x / 88x SE-NM (Hobbs, Carlsbad, Lovington)
  if (['790', '791', '792', '793', '794'].includes(p)) return 'Lubbock'
  if (['795', '796', '797', '798', '799'].includes(p)) return 'Permian Basin'
  if (/^76\d$/.test(p)) return 'Central Texas' // Waco / Central TX
  return 'Other'
}

const FIELD_SEP = '~~'
const MEMBER_SEP = '^^'

// One page of household clusters. Each row is a household (2..8 customers sharing
// an uppercased street address + ZIP); MEMBERS packs each member's fields so the
// per-member values never drift out of alignment (parallel LIST()s would).
function pageSql(fromRow: number, toRow: number): string {
  return `SELECT MIN(ZIPCODE) AS ZIP, MIN(ADDRESS1) AS ADDR, COUNT(*) AS N,
    LIST(CAST(OBJID AS VARCHAR(24)) || '${FIELD_SEP}' || COALESCE(TRIM(FIRSTNAME),'')
      || '${FIELD_SEP}' || COALESCE(TRIM(LASTNAME),'')
      || '${FIELD_SEP}' || COALESCE(TRIM(MAINPHONE),'')
      || '${FIELD_SEP}' || COALESCE(TRIM(EMAIL),''), '${MEMBER_SEP}') AS MEMBERS
    FROM CUSTOMER
    WHERE ADDRESS1 IS NOT NULL AND ADDRESS1 <> '' AND ZIPCODE IS NOT NULL AND ZIPCODE <> ''
    GROUP BY UPPER(ADDRESS1), ZIPCODE
    HAVING COUNT(*) BETWEEN 2 AND 8
    ORDER BY UPPER(ADDRESS1), ZIPCODE
    ROWS ${fromRow} TO ${toRow}`
}

type MemberRow = {
  customer_objid: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  phone: string | null
  email: string | null
}
type HouseholdRow = {
  id: string
  account_id: string
  cluster_key: string
  match_type: string
  region: string
  address: string | null
  city: null
  state: null
  zip: string | null
  member_count: number
  members: MemberRow[]
}

const nz = (s: string): string | null => {
  const t = (s ?? '').trim()
  return t === '' ? null : t
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

  // Owner-only, Mighty Wash only (the account wired to the dashboard).
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData } = await userClient.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401, origin)
  const { data: profile } = await svc.from('users').select('role, account_id').eq('id', uid).single()
  if (!profile || profile.role !== 'owner') return json({ error: 'forbidden' }, 403, origin)
  const accountId = profile.account_id as string
  if (accountId !== MW_ACCOUNT) return json({ error: 'unsupported_account' }, 400, origin)

  let cookie: string
  try {
    cookie = await login(base, password)
  } catch (e) {
    return json({ error: 'login_failed', message: String(e) }, 502, origin)
  }

  // Page through the household clusters. Each page returns <=1000 rows; stop when
  // a page comes back short. Hard cap keeps a pathological run bounded.
  const households: HouseholdRow[] = []
  const PAGE = 1000
  const MAX_PAGES = 20
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const fromRow = page * PAGE + 1
      const res = await runSql(base, cookie, pageSql(fromRow, fromRow + PAGE - 1))
      const rows = res.rows ?? []
      for (const row of rows) {
        const zip = String(row[0] ?? '').trim()
        const addr = String(row[1] ?? '').trim()
        const packed = String(row[3] ?? '')
        if (!packed) continue
        const members: MemberRow[] = []
        for (const chunk of packed.split(MEMBER_SEP)) {
          if (!chunk) continue
          const [objid, fn, ln, ph, em] = chunk.split(FIELD_SEP)
          const first = nz(fn ?? '')
          const last = nz(ln ?? '')
          const full = [first, last].filter(Boolean).join(' ') || null
          members.push({
            customer_objid: nz(objid ?? ''),
            first_name: first,
            last_name: last,
            full_name: full,
            phone: nz(ph ?? ''),
            email: nz(em ?? ''),
          })
        }
        if (members.length < 2) continue
        households.push({
          id: crypto.randomUUID(),
          account_id: accountId,
          cluster_key: `${addr.toUpperCase()}|${zip}`,
          match_type: 'address',
          region: regionForZip(zip),
          address: nz(addr),
          city: null,
          state: null,
          zip: nz(zip),
          member_count: members.length,
          members,
        })
      }
      if (rows.length < PAGE) break
    }
  } catch (e) {
    return json({ error: 'query_failed', message: String(e) }, 502, origin)
  }

  // Replace the account's dataset atomically enough for a periodic refresh:
  // delete the old households (members cascade), then insert the fresh set.
  const { error: delErr } = await svc.from('drb_households').delete().eq('account_id', accountId)
  if (delErr) return json({ error: 'db_delete_failed', message: delErr.message }, 500, origin)

  const syncedAt = new Date().toISOString()
  const hRows = households.map((h) => ({
    id: h.id,
    account_id: h.account_id,
    cluster_key: h.cluster_key,
    match_type: h.match_type,
    region: h.region,
    address: h.address,
    city: h.city,
    state: h.state,
    zip: h.zip,
    member_count: h.member_count,
    synced_at: syncedAt,
  }))
  for (let i = 0; i < hRows.length; i += 500) {
    const { error } = await svc.from('drb_households').insert(hRows.slice(i, i + 500))
    if (error) return json({ error: 'db_insert_households_failed', message: error.message }, 500, origin)
  }

  const mRows = households.flatMap((h) =>
    h.members.map((m) => ({
      household_id: h.id,
      account_id: h.account_id,
      customer_objid: m.customer_objid,
      first_name: m.first_name,
      last_name: m.last_name,
      full_name: m.full_name,
      phone: m.phone,
      email: m.email,
      address: h.address,
      city: h.city,
      state: h.state,
      zip: h.zip,
    })),
  )
  for (let i = 0; i < mRows.length; i += 500) {
    const { error } = await svc.from('drb_household_members').insert(mRows.slice(i, i + 500))
    if (error) return json({ error: 'db_insert_members_failed', message: error.message }, 500, origin)
  }

  const byRegion: Record<string, number> = {}
  for (const h of households) byRegion[h.region] = (byRegion[h.region] ?? 0) + 1

  return json(
    { ok: true, households: households.length, members: mRows.length, by_region: byRegion, synced_at: syncedAt },
    200,
    origin,
  )
})
