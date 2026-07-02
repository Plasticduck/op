// google-oauth-callback — Supabase Edge Function (Deno).
// Google redirects the browser here with ?code&state after the user consents.
// Verifies the signed state, exchanges the code for tokens, stores them for the
// user, and redirects back to the app. Public (browser redirect, no JWT):
// deploy with --no-verify-jwt.

import { createClient } from 'npm:@supabase/supabase-js@2'

function fromB64url(s: string): Uint8Array {
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
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
  const appUrl = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'
  const back = (status: string) =>
    Response.redirect(`${appUrl}/app/calendar?google=${status}`, 302)

  const reqUrl = new URL(req.url)
  const code = reqUrl.searchParams.get('code')
  const state = reqUrl.searchParams.get('state')
  const oauthError = reqUrl.searchParams.get('error')
  if (oauthError || !code || !state) return back('error')

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  if (!clientId || !clientSecret) return back('error')

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Verify state signature + expiry.
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return back('error')
  const expected = await signState(payload, serviceKey)
  if (sig !== expected) return back('error')
  let claims: { uid: string; aid: string; exp: number }
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)))
  } catch {
    return back('error')
  }
  if (!claims.uid || !claims.exp || claims.exp < Date.now()) return back('error')

  const redirectUri = `${url}/functions/v1/google-oauth-callback`

  // Exchange the authorization code for tokens.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tok = await tokenRes.json()
  if (!tok.access_token) return back('error')

  // Look up the connected account's email (best effort).
  let email: string | null = null
  try {
    const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })
    const uij = await ui.json()
    email = uij.email ?? null
  } catch {
    email = null
  }

  const expiry = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString()
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  const row: Record<string, unknown> = {
    account_id: claims.aid,
    user_id: claims.uid,
    email,
    calendar_id: 'primary',
    access_token: tok.access_token,
    token_expiry: expiry,
    updated_at: new Date().toISOString(),
  }
  // refresh_token only comes back on consent; prompt=consent forces it, but
  // guard anyway so a re-auth without it doesn't wipe the stored one.
  if (tok.refresh_token) row.refresh_token = tok.refresh_token

  const { error } = await svc
    .from('google_calendar_connections')
    .upsert(row, { onConflict: 'user_id' })
  if (error) return back('error')

  return back('connected')
})
