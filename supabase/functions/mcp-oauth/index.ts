// mcp-oauth — Supabase Edge Function (Deno).
// Connects a person's own CoreNav or FlexWash login to Operator AI
// (see _shared/connect.ts). Replaces corenav-oauth.
//
// Body { provider: 'corenav' | 'flexwash', action }:
//   start      { redirect_uri }  -> { url }  The provider's sign-in page to send them to.
//              If the provider doesn't accept Operator yet: 409 { error: 'not_ready', message }.
//   finish     { code, state }   -> { connected, tools, skipped, tools_error }  Back from the
//              provider: swaps the code for tokens (kept in Vault) and lists the tools
//              Operator AI will use (read-only ones) and the ones it leaves out.
//   disconnect                   -> { connected: false }  Revokes the tokens and forgets them.
//   register   (service role only, CoreNav) -> { client_id }  Registers Operator ahead of time.
//
// Auth: a signed-in person on the Mighty Wash account, not the shared office
// login. Their own login at the provider decides what they can see there.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  CONNECT_ACCOUNT, PROVIDERS, ReconnectNeeded, authorizeUrl, exchangeCode, getOAuthClient, isProvider,
  pkceChallenge, randomToken, revokeAndForget, signInProblem,
} from '../_shared/connect.ts'
import { McpSession } from '../_shared/mcp.ts'

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

const STATE_MINUTES = 15

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { provider?: string; action?: string; redirect_uri?: string; code?: string; state?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!isProvider(body.provider)) return json({ error: 'bad_request', message: 'Unknown connection.' }, 400, origin)
  const p = PROVIDERS[body.provider]

  const authHeader = req.headers.get('Authorization') ?? ''
  try {
    if (jwtRole(authHeader) === 'service_role') {
      if (body.action !== 'register') return json({ error: 'bad_request' }, 400, origin)
      const c = await getOAuthClient(svc, p)
      return json({ client_id: c.client_id, redirect_uris: p.redirectUris }, 200, origin)
    }

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const uid = u.user.id
    const { data: profile } = await svc.from('users').select('account_id, role_category').eq('id', uid).single()
    if (!profile || profile.account_id !== CONNECT_ACCOUNT) {
      return json({ error: 'not_available', message: `${p.label} isn't set up for this account.` }, 403, origin)
    }
    if (profile.role_category === 'corporate_display') {
      return json({ error: 'not_available', message: `The shared office login can't connect a personal ${p.label} login.` }, 403, origin)
    }

    if (body.action === 'start') {
      const redirect = String(body.redirect_uri ?? '')
      if (!p.redirectUris.includes(redirect)) return json({ error: 'bad_request', message: 'Unknown return address.' }, 400, origin)
      const client = await getOAuthClient(svc, p)
      const state = randomToken(32)
      const verifier = randomToken(48)
      const signIn = authorizeUrl(p, client, redirect, state, await pkceChallenge(verifier))
      if (p.probe) {
        const problem = await signInProblem(signIn)
        if (problem) {
          return json({
            error: 'not_ready',
            message: `${p.label} hasn't turned on sign-in for Operator yet (${problem}). It needs to allow Operator AI (operator.washlyfe.com) to connect.`,
          }, 409, origin)
        }
      }
      // Tidy up sign-ins that were never finished.
      await svc.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
      const { error } = await svc.from('oauth_states').insert({ state, provider: p.key, user_id: uid, code_verifier: verifier, redirect_uri: redirect })
      if (error) throw new Error(error.message)
      return json({ url: signIn }, 200, origin)
    }

    if (body.action === 'finish') {
      const code = String(body.code ?? '')
      const state = String(body.state ?? '')
      if (!code || !state) return json({ error: 'bad_request', message: 'Missing code or state.' }, 400, origin)
      // One use only, only by the person who started it, only for this provider.
      const { data: rows, error: delErr } = await svc.from('oauth_states').delete()
        .eq('state', state).eq('provider', p.key).eq('user_id', uid).select('code_verifier, redirect_uri, created_at')
      if (delErr) throw new Error(delErr.message)
      const s = rows?.[0]
      if (!s || Date.now() - new Date(s.created_at as string).getTime() > STATE_MINUTES * 60_000) {
        return json({ error: 'expired', message: `That sign-in took too long or was already used. Try Connect to ${p.label} again.` }, 400, origin)
      }
      const tokens = await exchangeCode(p, await getOAuthClient(svc, p), code, s.code_verifier as string, s.redirect_uri as string)
      const { error: saveErr } = await svc.rpc('mcp_tokens_connect', { p_user: uid, p_provider: p.key, p_tokens: tokens })
      if (saveErr) throw new Error(saveErr.message)
      // What Operator AI will be able to use. Connected either way.
      let tools: string[] | null = null
      let skipped: string[] = []
      let toolsError: string | null = null
      try {
        const session = await McpSession.open(p.mcp, tokens.access_token, p.toolPrefix, p.label, p.toolRules)
        tools = session.tools.map((t) => t.name)
        skipped = session.skipped
        await session.close()
      } catch (e) {
        toolsError = e instanceof Error ? e.message : String(e)
      }
      console.log(JSON.stringify({ mcp_connected: p.key, tools: tools?.length ?? null, skipped, toolsError }))
      return json({ connected: true, tools, skipped, tools_error: toolsError }, 200, origin)
    }

    if (body.action === 'disconnect') {
      await revokeAndForget(svc, uid, p)
      return json({ connected: false }, 200, origin)
    }

    return json({ error: 'bad_request', message: 'Unknown action.' }, 400, origin)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return json({ error: e instanceof ReconnectNeeded ? 'reconnect' : 'failed', message }, e instanceof ReconnectNeeded ? 401 : 502, origin)
  }
})
