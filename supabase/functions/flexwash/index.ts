// flexwash — Supabase Edge Function (Deno).
// Authenticated proxy to the FlexWash REST API (https://api.flexwash.com). It
// mints an access token from the HQ client credentials, caches it in
// service_tokens (FlexWash tokens last 24h and generation is capped at 75/day),
// and forwards a call to any /external/* endpoint with the bearer token.
//
// Request body: { path: "/external/...", body?: object }
//   - path is required and must start with /external/.
//   - body is the JSON payload POSTed to that endpoint (default {}).
// Response: { status, data }  (data is FlexWash's JSON response).
//
// Secrets: FLEXWASH_CLIENT_ID, FLEXWASH_CLIENT_SECRET (both required; 503 no_key otherwise).
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
//
// Auth: owner/manager JWT (app), or the service-role JWT (cron/archive jobs).

import { createClient } from 'npm:@supabase/supabase-js@2'

const FLEX_BASE = 'https://api.flexwash.com'
const PROVIDER = 'flexwash'

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

// deno-lint-ignore no-explicit-any
async function getToken(svc: any, clientId: string, clientSecret: string): Promise<string> {
  const { data: cached } = await svc
    .from('service_tokens')
    .select('token, expires_at')
    .eq('provider', PROVIDER)
    .maybeSingle()
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) {
    return cached.token as string
  }
  const res = await fetch(`${FLEX_BASE}/external/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.accessToken) {
    throw new Error(`token request failed (${res.status})`)
  }
  // Tokens last 24h; cache for 23h to stay safely inside the window.
  await svc.from('service_tokens').upsert(
    {
      provider: PROVIDER,
      token: j.accessToken,
      expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'provider' },
  )
  return j.accessToken as string
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const clientId = Deno.env.get('FLEXWASH_CLIENT_ID')
  const clientSecret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    return json({ error: 'no_key', message: 'FlexWash credentials are not configured.' }, 503, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: service-role (cron/archive) or an owner/manager.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (!p || (p.role !== 'owner' && p.role !== 'manager')) {
      return json({ error: 'forbidden' }, 403, origin)
    }
  }

  let payload: { path?: string; body?: unknown } = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }
  const path = payload.path ?? ''
  if (!path.startsWith('/external/') || path.includes('..')) {
    return json({ error: 'bad_request', message: 'path must start with /external/' }, 400, origin)
  }

  let token: string
  try {
    token = await getToken(svc, clientId, clientSecret)
  } catch (e) {
    return json({ error: 'auth_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }

  const res = await fetch(`${FLEX_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload.body ?? {}),
  })
  const data = await res.json().catch(() => null)
  return json({ status: res.status, data }, res.ok ? 200 : 502, origin)
})
