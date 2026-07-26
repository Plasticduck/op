// issuetrak — Supabase Edge Function (Deno).
// Authenticated proxy to the Issuetrak API v2 (the Mighty Wash instance at
// https://mightywash.issuetrak.com/api/v2). Holds the Issuetrak API token
// (X-Api-Key) server-side and forwards allowlisted calls. Issuetrak is a
// Mighty-Wash-only integration, so callers must belong to that account and be
// an owner or manager.
//
// Request body: { path: "/Issues/Search", method?: "GET"|"POST"|"PATCH"|"PUT", body?: object }
//   - path is required and must start with one of ALLOWED_PREFIXES.
//   - method defaults to GET (POST when a body is present).
// Response: { status, data }  (data is Issuetrak's JSON response, or null).
//
// Secrets: ISSUETRAK_API_KEY (required; 503 no_key otherwise).
//          ISSUETRAK_BASE_URL (optional; defaults to the Mighty Wash instance).
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://mightywash.issuetrak.com/api/v2'
// Issuetrak is licensed to Mighty Wash only. Lock the integration to that account.
const MIGHTY_WASH_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

// Only these resource families may be reached through the proxy.
const ALLOWED_PREFIXES = [
  '/Authenticate',
  '/Issues',
  '/Priorities',
  '/IssueTypes',
  '/Classes',
  '/Substatuses',
  '/Statuses',
  '/Causes',
  '/Users',
  '/Locations',
  '/Organizations',
  '/Departments',
  '/Groups',
]

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
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const rawKey = Deno.env.get('ISSUETRAK_API_KEY')
  if (!rawKey) {
    return json({ error: 'no_key', message: 'Issuetrak is not connected yet.' }, 503, origin)
  }
  // Secrets set from a paste often carry a trailing newline or surrounding
  // quotes, which Issuetrak rejects as an invalid token (401). Send it clean.
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '')
  const base = (Deno.env.get('ISSUETRAK_BASE_URL') ?? DEFAULT_BASE).replace(/\/$/, '')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: an owner/manager who belongs to the Mighty Wash account.
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
  const { data: p } = await svc
    .from('users')
    .select('role, account_id')
    .eq('id', u.user.id)
    .single()
  if (!p || (p.role !== 'owner' && p.role !== 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }
  if (p.account_id !== MIGHTY_WASH_ACCOUNT) {
    return json({ error: 'forbidden', message: 'Issuetrak is available for Mighty Wash only.' }, 403, origin)
  }

  let payload: { path?: string; method?: string; body?: unknown } = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }
  const path = payload.path ?? ''

  // Temporary diagnostic: reports token shape (masked) and a live
  // /Authenticate/test result so we can tell a malformed secret from a bad
  // token without exposing the value. Remove once the connection is verified.
  if (path === '/__diag') {
    let authStatus = 0
    let authBody = ''
    try {
      const r = await fetch(`${base}/Authenticate/test`, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      })
      authStatus = r.status
      authBody = (await r.text()).slice(0, 200)
    } catch (e) {
      authBody = e instanceof Error ? e.message : String(e)
    }
    return json(
      {
        status: 200,
        data: {
          rawLen: rawKey.length,
          cleanLen: apiKey.length,
          hadSurroundingJunk: rawKey.length !== apiKey.length,
          prefix: apiKey.slice(0, 3),
          suffix: apiKey.slice(-3),
          baseUrl: base,
          authTestStatus: authStatus,
          authTestBody: authBody,
        },
      },
      200,
      origin,
    )
  }

  if (!path.startsWith('/') || path.includes('..')) {
    return json({ error: 'bad_request', message: 'path must be an absolute Issuetrak path' }, 400, origin)
  }
  // Match the allowlist against the pathname only (ignore any query string).
  const pathname = path.split('?')[0]
  if (!ALLOWED_PREFIXES.some((pre) => pathname === pre || pathname.startsWith(pre + '/'))) {
    return json({ error: 'bad_request', message: `path ${pathname} is not allowed` }, 400, origin)
  }

  const method = (payload.method ?? (payload.body !== undefined ? 'POST' : 'GET')).toUpperCase()
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return json({ error: 'bad_request', message: `method ${method} is not allowed` }, 400, origin)
  }

  const headers: Record<string, string> = { 'X-Api-Key': apiKey, Accept: 'application/json' }
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && payload.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(payload.body)
  }

  let res: Response
  try {
    res = await fetch(`${base}${path}`, init)
  } catch (e) {
    return json({ error: 'upstream_unreachable', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  // The proxy call itself succeeded; surface Issuetrak's own status inside the
  // body so the client can distinguish 400/401/403/404 without invoke() treating
  // it as a transport error. Non-2xx HTTP is reserved for proxy-level failures.
  return json({ status: res.status, data }, 200, origin)
})
