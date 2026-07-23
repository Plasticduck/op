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
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData } = await userClient.auth.getUser()
    const uid = userData.user?.id
    if (!uid) return json({ error: 'unauthorized' }, 401, origin)
    const { data: profile } = await svc.from('users').select('role').eq('id', uid).single()
    if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) {
      return json({ error: 'forbidden' }, 403, origin)
    }
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

  return json(payload, 200, origin)
})
