// google-oauth-start — Supabase Edge Function (Deno).
// Returns the Google OAuth consent URL for the calling user to connect their
// Google Calendar (read-only). The signed `state` carries the user id so the
// callback (hit by the browser, unauthenticated) knows who connected.
// Inert (503 'no_key') until GOOGLE_CLIENT_ID is set. Deploy --no-verify-jwt.

import { createClient } from 'npm:@supabase/supabase-js@2'

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

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
async function signState(payload: string, key: string): Promise<string> {
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(payload))
  return b64url(new Uint8Array(sig))
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  if (!clientId) return json({ error: 'no_key', message: 'Google is not configured.' }, 503)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await svc
    .from('users')
    .select('account_id')
    .eq('id', u.user.id)
    .single()
  if (!profile) return json({ error: 'no_profile' }, 400)

  const payloadObj = { uid: u.user.id, aid: profile.account_id, exp: Date.now() + 600000 }
  const payload = b64url(new TextEncoder().encode(JSON.stringify(payloadObj)))
  const sig = await signState(payload, serviceKey)
  const state = `${payload}.${sig}`

  const redirectUri = `${url}/functions/v1/google-oauth-callback`
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set(
    'scope',
    'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email',
  )
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('include_granted_scopes', 'true')
  authUrl.searchParams.set('state', state)

  return json({ url: authUrl.toString() })
})
