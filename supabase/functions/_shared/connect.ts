// Operator AI connections: each person signs in to CoreNav or FlexWash with their
// own login, and Operator AI uses it through that service's MCP server. This file
// is the sign-in (OAuth with PKCE) and token side; mcp.ts runs the tools.
// Used by mcp-oauth (connect, disconnect) and ask-operator (answering).
// Tokens live in Vault through the mcp_tokens_* functions (migration 0226).
//
// How Operator identifies itself differs by provider:
//   CoreNav  registers clients on request (/register). Operator registered once;
//            the result is in oauth_clients with the secret in Vault.
//   FlexWash (Auth0) takes a client ID metadata document: Operator's client ID is
//            the URL of public/oauth/flexwash-client.json. Checked 2026-11-10,
//            FlexWash answers "Unknown client" until they allow it. If FlexWash
//            issues Operator a client ID instead, set FLEXWASH_MCP_CLIENT_ID (and
//            FLEXWASH_MCP_CLIENT_SECRET if they give one); that wins.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { McpSession } from './mcp.ts'

export type ProviderKey = 'corenav' | 'flexwash'
export type Provider = {
  key: ProviderKey
  label: string
  mcp: string
  authorize: string
  token: string
  revoke?: string
  register?: string // dynamic client registration endpoint
  clientIdUrl?: string // client ID metadata document
  envClientId?: string // a client ID the provider issued by hand (env var name)
  envClientSecret?: string
  scope?: string
  redirectUris: string[]
  toolPrefix: string
  // Ask the provider's sign-in page whether it accepts Operator before sending
  // anyone there, so a refusal becomes a clear message instead of their error page.
  probe?: boolean
}

// CoreNav and FlexWash are Mighty Wash's.
export const CONNECT_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

export const PROVIDERS: Record<ProviderKey, Provider> = {
  corenav: {
    key: 'corenav',
    label: 'CoreNav',
    mcp: 'https://expand.corenav.ai/api/mcp',
    authorize: 'https://expand.corenav.ai/authorize',
    token: 'https://expand.corenav.ai/token',
    revoke: 'https://expand.corenav.ai/revoke',
    register: 'https://expand.corenav.ai/register',
    // Changing this list makes Operator register with CoreNav again.
    redirectUris: ['https://operator.washlyfe.com/app/corenav/callback', 'http://localhost:5173/app/corenav/callback'],
    toolPrefix: 'corenav',
  },
  flexwash: {
    key: 'flexwash',
    label: 'FlexWash',
    mcp: 'https://api.flexwash.com/mcp',
    authorize: 'https://flex-wash.us.auth0.com/authorize',
    token: 'https://flex-wash.us.auth0.com/oauth/token',
    revoke: 'https://flex-wash.us.auth0.com/oauth/revoke',
    clientIdUrl: 'https://operator.washlyfe.com/oauth/flexwash-client.json',
    envClientId: 'FLEXWASH_MCP_CLIENT_ID',
    envClientSecret: 'FLEXWASH_MCP_CLIENT_SECRET',
    scope: 'openid offline_access',
    // Must match redirect_uris in public/oauth/flexwash-client.json.
    redirectUris: ['https://operator.washlyfe.com/app/flexwash/callback'],
    toolPrefix: 'flexwash_mcp',
    probe: true,
  },
}
export const isProvider = (x: unknown): x is ProviderKey => x === 'corenav' || x === 'flexwash'

type OAuthClient = { client_id: string; client_secret: string | null }
export type Tokens = { access_token: string; refresh_token: string | null; expires_at: number | null }

// A login that has to be signed in again (refresh refused or revoked).
export class ReconnectNeeded extends Error {}
// The provider doesn't accept Operator yet (their setting, not ours).
export class NotReady extends Error {}

const sameList = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x))

export async function getOAuthClient(svc: SupabaseClient, p: Provider): Promise<OAuthClient> {
  const issued = p.envClientId ? Deno.env.get(p.envClientId) : undefined
  if (issued) return { client_id: issued, client_secret: (p.envClientSecret && Deno.env.get(p.envClientSecret)) || null }
  if (p.clientIdUrl) return { client_id: p.clientIdUrl, client_secret: null }
  if (!p.register) throw new Error(`No way to sign in to ${p.label}.`)
  const { data } = await svc.rpc('oauth_client_get', { p_provider: p.key })
  const c = data as { client_id?: string; client_secret?: string | null; redirect_uris?: string[] } | null
  if (c?.client_id && sameList(c.redirect_uris, p.redirectUris)) return { client_id: c.client_id, client_secret: c.client_secret ?? null }
  return register(svc, p)
}

async function register(svc: SupabaseClient, p: Provider): Promise<OAuthClient> {
  const res = await fetch(p.register!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Operator AI (Mighty Wash)',
      client_uri: 'https://operator.washlyfe.com',
      redirect_uris: p.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.client_id) {
    throw new Error(`${p.label} didn't accept Operator's registration (${res.status}${j.error ? `: ${j.error_description ?? j.error}` : ''}).`)
  }
  const { error } = await svc.rpc('oauth_client_save', {
    p_provider: p.key, p_client_id: j.client_id, p_client_secret: j.client_secret ?? null, p_redirect_uris: p.redirectUris,
  })
  if (error) throw new Error(`Couldn't save the ${p.label} registration: ${error.message}`)
  return { client_id: j.client_id, client_secret: j.client_secret ?? null }
}

const b64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

export function authorizeUrl(p: Provider, client: OAuthClient, redirectUri: string, state: string, challenge: string): string {
  const u = new URL(p.authorize)
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: p.mcp,
  })
  if (p.scope) q.set('scope', p.scope)
  u.search = q.toString()
  return u.toString()
}

// Does the sign-in page accept Operator? null = yes; otherwise what it said.
export async function signInProblem(url: string): Promise<string | null> {
  const res = await fetch(url, { redirect: 'manual' }).catch(() => null)
  if (!res) return null // can't tell; let the person try
  if (res.status < 400) return null
  const text = (await res.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const m = text.match(/(Unknown client[^.]*|Callback URL mismatch[^.]*|invalid_request[^.]{0,160})/i)
  return m ? m[1].trim() : `status ${res.status}`
}

async function tokenRequest(p: Provider, client: OAuthClient, params: Record<string, string>, keepRefresh: string | null = null): Promise<Tokens> {
  const body = new URLSearchParams({ ...params, client_id: client.client_id, resource: p.mcp })
  if (client.client_secret) body.set('client_secret', client.client_secret)
  const res = await fetch(p.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.access_token) {
    const why = j.error_description ?? j.error ?? `status ${res.status}`
    if (j.error === 'invalid_grant' || j.error === 'invalid_client' || res.status === 401) throw new ReconnectNeeded(`${p.label} sign-in expired (${why}).`)
    throw new Error(`${p.label} sign-in failed (${why}).`)
  }
  const secs = Number(j.expires_in)
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? keepRefresh,
    expires_at: Number.isFinite(secs) && secs > 0 ? Date.now() + secs * 1000 : null,
  }
}

export function exchangeCode(p: Provider, client: OAuthClient, code: string, verifier: string, redirectUri: string): Promise<Tokens> {
  return tokenRequest(p, client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
}

async function loadTokens(svc: SupabaseClient, userId: string, p: Provider): Promise<Tokens | null> {
  const { data, error } = await svc.rpc('mcp_tokens_get', { p_user: userId, p_provider: p.key })
  if (error) throw new Error(error.message)
  const t = data as Tokens | null
  return t?.access_token ? t : null
}

// The person's access token, refreshed when it's about to run out. null when
// they haven't connected this provider.
export async function accessTokenFor(svc: SupabaseClient, userId: string, p: Provider): Promise<string | null> {
  const t = await loadTokens(svc, userId, p)
  if (!t) return null
  if (!t.expires_at || t.expires_at > Date.now() + 60_000) return t.access_token
  if (!t.refresh_token) {
    await svc.rpc('mcp_set_error', { p_user: userId, p_provider: p.key, p_error: 'expired, no refresh token' })
    throw new ReconnectNeeded(`${p.label} sign-in expired.`)
  }
  try {
    const next = await tokenRequest(p, await getOAuthClient(svc, p), { grant_type: 'refresh_token', refresh_token: t.refresh_token }, t.refresh_token)
    await svc.rpc('mcp_tokens_save', { p_user: userId, p_provider: p.key, p_tokens: next })
    return next.access_token
  } catch (e) {
    // Another request may have refreshed first (refresh tokens can be single use).
    const again = await loadTokens(svc, userId, p)
    if (again && again.access_token !== t.access_token && (!again.expires_at || again.expires_at > Date.now() + 60_000)) {
      return again.access_token
    }
    await svc.rpc('mcp_set_error', { p_user: userId, p_provider: p.key, p_error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

// The person's session with this provider, or null when they haven't connected it.
export async function openSession(svc: SupabaseClient, userId: string, p: Provider): Promise<McpSession | null> {
  const token = await accessTokenFor(svc, userId, p)
  return token ? McpSession.open(p.mcp, token, p.toolPrefix, p.label) : null
}

export async function revokeAndForget(svc: SupabaseClient, userId: string, p: Provider): Promise<void> {
  const t = await loadTokens(svc, userId, p).catch(() => null)
  if (t && p.revoke) {
    const client = await getOAuthClient(svc, p).catch(() => null)
    if (client) {
      for (const [token, hint] of [[t.refresh_token, 'refresh_token'], [t.access_token, 'access_token']] as const) {
        if (!token) continue
        const body = new URLSearchParams({ token, token_type_hint: hint, client_id: client.client_id })
        if (client.client_secret) body.set('client_secret', client.client_secret)
        await fetch(p.revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).catch(() => null)
      }
    }
  }
  const { error } = await svc.rpc('mcp_tokens_delete', { p_user: userId, p_provider: p.key })
  if (error) throw new Error(error.message)
}
