// site-performance — Supabase Edge Function (Deno).
// Proxies the Mighty Wash live-ops dashboard (a password-gated Flask app on a
// Tailscale Funnel URL) so the Operator app can render its data without ever
// exposing the dashboard password to the browser. On each call it logs in with
// the stored password, then pulls all of the dashboard's JSON feeds in parallel
// and returns them as one combined payload.
//
// Secrets (set via `supabase secrets set`):
//   MW_DASHBOARD_PASSWORD — the dashboard's sign-in password (503 'no_key' if absent)
//   MW_DASHBOARD_URL      — base URL, defaults to the known Funnel host
// Auto-provided by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://dashboard.tail1e050b.ts.net'

// The dashboard now sits behind Cloudflare, which blocks requests with no
// User-Agent. Send a browser-like UA on every request so the login and feeds go
// through.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

// Restrict browser CORS to the known origins. JWT verification below is the real
// auth gate; this just keeps the surface tight.
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

// The dashboard's JSON endpoints, mapped to the keys the frontend expects.
const FEEDS: Record<string, string> = {
  report: '/api/report',
  msa: '/api/msa_report',
  recharge_revenue: '/api/recharge_revenue_report',
  recharge_audit: '/api/recharge_audit_report',
  rinsed: '/api/rinsed_report',
  under15: '/api/under15_report',
  plan_breakdown: '/api/plan_breakdown_report',
  churn: '/api/churn_report',
  high_conversion_flags: '/api/high_conversion_flags',
  company_records: '/api/company_records_report',
}

// --- FlexWash augmentation -------------------------------------------------
// MW17/MW18 aren't in the SiteWatch dashboard, so the guided query pulls their
// numbers from FlexWash and merges them into the result. carWashId 352 = MW17,
// 350 = MW18. Only for the Mighty Wash account.
const FLEX_BASE = 'https://api.flexwash.com'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const FLEX_SITES = [
  { name: 'MightyWash 017', cw: '352' },
  { name: 'MightyWash 018', cw: '350' },
]
// Metrics whose values sum into the TOTAL row (counts/dollars, not percentages).
const ADDITIVE = new Set(['cars', 'revenue', 'recharge', 'plans_total', 'plans_mighty', 'plans_super', 'plans_wonder', 'plans_mvp'])
const num = (v: unknown) => Number(v) || 0
const round2 = (v: number) => Math.round(v * 100) / 100
// deno-lint-ignore no-explicit-any
function sumArr(arr: any[] | undefined, f: (x: any) => number): number {
  return (arr ?? []).reduce((s, x) => s + f(x), 0)
}

// deno-lint-ignore no-explicit-any
async function flexToken(svc: any): Promise<string | null> {
  const { data: cached } = await svc.from('service_tokens').select('token, expires_at').eq('provider', 'flexwash').maybeSingle()
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) return cached.token as string
  const id = Deno.env.get('FLEXWASH_CLIENT_ID')
  const secret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  if (!id || !secret) return null
  try {
    const res = await fetch(`${FLEX_BASE}/external/access-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: id, clientSecret: secret }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.accessToken) return null
    await svc.from('service_tokens').upsert({ provider: 'flexwash', token: j.accessToken, expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'provider' })
    return j.accessToken as string
  } catch { return null }
}
// deno-lint-ignore no-explicit-any
async function flexPost(token: string, path: string, body: unknown): Promise<any | null> {
  try {
    const r = await fetch(`${FLEX_BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

// One metric's value for a FlexWash car wash over [start,end], or null if the
// metric has no FlexWash equivalent. Definitions match sync-flexwash.
async function flexMetric(token: string, cw: string, metric: string, start: string, end: string): Promise<number | null> {
  const dr = { carWashIds: [cw], dateRange: { start, end } }
  switch (metric) {
    case 'cars': {
      const d = await flexPost(token, '/external/wash-and-revenue-stats/get-temporal-wash-stats', { ...dr, interval: 'day' })
      // Cars = single + member only. The express/fullService/detail/fleet fields
      // re-count the SAME washes by service tier, so adding them double-counts.
      return d ? sumArr(d.washStats, (w) => num(w.singleWashCount) + num(w.memberWashCount)) : null
    }
    case 'revenue': {
      const d = await flexPost(token, '/external/wash-and-revenue-stats/get-temporal-revenue-stats', { ...dr, interval: 'day' })
      // FlexWash revenue is in cents.
      return d ? round2(sumArr(d.revenueStats, (r) => num(r.detailRevenue) + num(r.expressRevenue) + num(r.fullServiceRevenue) + num(r.fleetRevenue) + num(r.membershipRevenue) + num(r.giftCardRevenue) + num(r.washBookRevenue) + num(r.otherRevenue)) / 100) : null
    }
    case 'recharge': {
      const d = await flexPost(token, '/external/wash-and-revenue-stats/get-temporal-revenue-stats', { ...dr, interval: 'day' })
      return d ? round2(sumArr(d.revenueStats, (r) => num(r.membershipRevenue)) / 100) : null
    }
    case 'plans_total':
    case 'plans_mighty':
    case 'plans_super':
    case 'plans_wonder': {
      const d = await flexPost(token, '/external/memberships/get-new-membership-stats', dr)
      if (!d) return null
      if (metric === 'plans_total') return num(d.count)
      const re = metric === 'plans_mighty' ? /mighty/i : metric === 'plans_super' ? /super/i : /wonder/i
      return sumArr(d.byPackageTemplate, (p) => (re.test(String(p.packageTemplateName || '')) ? num(p.count) : 0))
    }
    case 'churn_voluntary':
    case 'churn_cc': {
      const d = await flexPost(token, '/external/memberships/get-churn-percentages', dr)
      if (!d) return null
      const frac = metric === 'churn_voluntary' ? d.voluntaryChurnPercent : d.involuntaryChurnPercent
      return frac == null ? null : round2(num(frac) * 100)
    }
    default:
      return null
  }
}

// Daily FlexWash cars + gross sales for a car wash, keyed by YYYY-MM-DD.
async function flexDaily(token: string, cw: string, start: string, end: string): Promise<Map<string, { cars: number; sales: number }>> {
  const [wash, rev] = await Promise.all([
    flexPost(token, '/external/wash-and-revenue-stats/get-temporal-wash-stats', { carWashIds: [cw], interval: 'day', dateRange: { start, end } }),
    flexPost(token, '/external/wash-and-revenue-stats/get-temporal-revenue-stats', { carWashIds: [cw], interval: 'day', dateRange: { start, end } }),
  ])
  const m = new Map<string, { cars: number; sales: number }>()
  const day = (iso: string) => String(iso).slice(0, 10)
  for (const w of wash?.washStats ?? []) {
    const d = day(w.iso8601)
    // Single + member only; the service-tier fields re-count the same washes.
    const cars = num(w.singleWashCount) + num(w.memberWashCount)
    m.set(d, { cars, sales: m.get(d)?.sales ?? 0 })
  }
  for (const r of rev?.revenueStats ?? []) {
    const d = day(r.iso8601)
    // FlexWash revenue is in cents.
    const sales = round2((num(r.detailRevenue) + num(r.expressRevenue) + num(r.fullServiceRevenue) + num(r.fleetRevenue) + num(r.membershipRevenue) + num(r.giftCardRevenue) + num(r.washBookRevenue) + num(r.otherRevenue)) / 100)
    m.set(d, { cars: m.get(d)?.cars ?? 0, sales })
  }
  return m
}

// Overlay FlexWash cars + sales onto the live By-Site report for the FlexWash
// sites (SiteWatch's feed shows 0 cars for them). Respects each site's cutover
// (start_date) so pre-conversion SiteWatch days are left intact. Keeps the
// SiteWatch hours/labor (FlexWash has none) and recomputes the ratios.
// deno-lint-ignore no-explicit-any
async function augmentReport(report: any, svc: any) {
  if (!report?.sites) return
  const { data: sites } = await svc
    .from('flexwash_sites')
    .select('site_number, car_wash_id, name, start_date')
    .eq('account_id', MW_ACCOUNT)
    .eq('active', true)
  if (!sites?.length) return
  const token = await flexToken(svc)
  if (!token) return
  const allDates: string[] = []
  for (const arr of Object.values(report.sites)) for (const d of arr as { date: string }[]) allDates.push(d.date)
  if (!allDates.length) return
  const start = allDates.reduce((a, b) => (a < b ? a : b))
  const end = (report.end_date as string) ?? allDates.reduce((a, b) => (a > b ? a : b))

  await Promise.all((sites as { site_number: number; car_wash_id: string; name: string | null; start_date: string | null }[]).map(async (fs) => {
    const name = fs.name ?? `MightyWash ${String(fs.site_number).padStart(3, '0')}`
    const days = report.sites[name] as { date: string; cars: number; hours: number; sales: number; labor_cost: number; cars_per_hour: number | null; labor_pct: number | null }[] | undefined
    if (!days) return
    const from = fs.start_date && fs.start_date > start ? fs.start_date : start
    const flexMap = await flexDaily(token, fs.car_wash_id, from, end)
    for (const row of days) {
      if (fs.start_date && row.date < fs.start_date) continue
      const fx = flexMap.get(row.date)
      if (!fx) continue
      row.cars = fx.cars
      // FlexWash is authoritative for a converted site: never let a stale
      // SiteWatch sales figure survive on a FlexWash-owned date, even when
      // FlexWash reports 0 (e.g. an in-progress current day).
      row.sales = fx.sales
      row.cars_per_hour = row.hours > 0 ? round2(fx.cars / row.hours) : null
      row.labor_pct = row.sales > 0 ? round2((row.labor_cost / row.sales) * 100) : null
    }
  }))
}

// deno-lint-ignore no-explicit-any
function augmentGuidedOptions(data: any) {
  if (!Array.isArray(data?.sites)) return
  for (const fs of FLEX_SITES) {
    if (!data.sites.some((s: { name?: string }) => s.name === fs.name)) data.sites.push({ name: fs.name, interior_capable: false })
  }
}
// deno-lint-ignore no-explicit-any
async function augmentGuidedQuery(data: any, apiBody: any, svc: any) {
  const rows = data?.rows
  if (!Array.isArray(rows)) return
  const metric = String(apiBody?.metric ?? '')
  const start = String(apiBody?.start ?? '')
  const end = String(apiBody?.end ?? '')
  const sites: string[] = Array.isArray(apiBody?.sites) ? apiBody.sites : []
  if (!metric || !start || !end) return
  const targets = FLEX_SITES.filter((fs) => sites.length === 0 || sites.includes(fs.name))
  if (!targets.length) return
  const token = await flexToken(svc)
  if (!token) return
  const flexRows: [string, number][] = []
  let flexSum = 0
  for (const fs of targets) {
    if (rows.some((r: unknown[]) => String(r[0]) === fs.name)) continue
    const val = await flexMetric(token, fs.cw, metric, start, end)
    if (val != null) {
      flexRows.push([fs.name, val])
      flexSum += val
    }
  }
  if (!flexRows.length) return
  const totalIdx = rows.findIndex((r: unknown[]) => String(r[0]).toUpperCase() === 'TOTAL')
  if (totalIdx >= 0) {
    rows.splice(totalIdx, 0, ...flexRows)
    if (ADDITIVE.has(metric)) {
      const tRow = rows[totalIdx + flexRows.length] as (string | number)[]
      tRow[1] = round2(num(tRow[1]) + flexSum)
    }
  } else {
    rows.push(...flexRows)
  }
  data.row_count = rows.length
}

// Log in and return the Flask `session` cookie. The login endpoint answers with
// a 302 that carries the Set-Cookie, so we must NOT auto-follow the redirect or
// the cookie header is lost.
async function login(base: string, password: string): Promise<string> {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
    body: `password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/session=[^;]+/)
  if (!match) {
    throw new Error(`login failed (status ${res.status}, no session cookie)`)
  }
  return match[0]
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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  let body: { api?: { path?: string; method?: string; body?: unknown } } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const password = Deno.env.get('MW_DASHBOARD_PASSWORD')
  if (!password) {
    return json({ error: 'no_key', message: 'MW_DASHBOARD_PASSWORD is not configured.' }, 503, origin)
  }
  const base = (Deno.env.get('MW_DASHBOARD_URL') ?? DEFAULT_BASE).replace(/\/$/, '')

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Identify the caller and confirm they are an owner/manager, matching the
  // access level of the other opssuite performance pages.
  const authHeader = req.headers.get('Authorization') ?? ''
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  let callerAccount: string | null = null
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData } = await userClient.auth.getUser()
    const uid = userData.user?.id
    if (!uid) return json({ error: 'unauthorized' }, 401, origin)
    const { data: profile } = await svc.from('users').select('role, account_id').eq('id', uid).single()
    if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) {
      return json({ error: 'forbidden' }, 403, origin)
    }
    callerAccount = profile.account_id as string
  }

  let cookie: string
  try {
    cookie = await login(base, password)
  } catch (e) {
    return json({ error: 'login_failed', message: String(e) }, 502, origin)
  }

  // Proxy a dashboard /api/ endpoint through the authenticated session. Used by
  // the Custom Query tab (guided_query_options, guided_query, custom_query).
  // Restricted to /api/ paths; the dashboard owns its own query safety + row caps.
  const api = body.api
  if (api && typeof api.path === 'string' && api.path.startsWith('/api/')) {
    const method = api.method === 'GET' ? 'GET' : 'POST'
    const r = await fetch(`${base}${api.path}`, {
      method,
      headers: {
        Cookie: cookie,
        'User-Agent': BROWSER_UA,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(api.body ?? {}) : undefined,
    })
    const data = await r.json().catch(() => null)
    // Merge the FlexWash sites (17/18) into the guided query for Mighty Wash.
    if (r.ok && data && callerAccount === MW_ACCOUNT) {
      try {
        if (api.path === '/api/guided_query_options') augmentGuidedOptions(data)
        else if (api.path === '/api/guided_query') await augmentGuidedQuery(data, api.body, svc)
      } catch { /* best-effort: FlexWash merge never breaks the base result */ }
    }
    return json({ status: r.status, data }, r.ok ? 200 : 502, origin)
  }

  // Pull every feed in parallel. A single feed failing (or returning a
  // still-warming { loading: true }) shouldn't sink the whole payload, so each
  // is caught to null and the page degrades that section gracefully.
  const entries = await Promise.all(
    Object.entries(FEEDS).map(async ([key, path]) => {
      try {
        const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie, 'User-Agent': BROWSER_UA } })
        if (!res.ok) return [key, null] as const
        return [key, await res.json()] as const
      } catch {
        return [key, null] as const
      }
    }),
  )

  const payload: Record<string, unknown> = { fetched_at: new Date().toISOString() }
  for (const [key, value] of entries) payload[key] = value

  // Merge FlexWash cars/sales into the By-Site report for the FlexWash sites.
  if (callerAccount === MW_ACCOUNT) {
    try { await augmentReport(payload.report, svc) } catch { /* best-effort */ }
  }

  return json(payload, 200, origin)
})
