// CoreNav (expand.corenav.ai) for Operator AI: OAuth with each person's own
// CoreNav login, and an MCP client for its tools. Used by corenav-oauth (connect
// and disconnect) and ask-operator (answering).
//
// OAuth facts (from https://expand.corenav.ai/.well-known/oauth-authorization-server,
// checked 2026-11-10): authorization code + PKCE (S256), refresh tokens,
// client_secret_post, dynamic client registration at /register, revocation at
// /revoke. Operator registers itself once (oauth_clients row, secret in Vault).
// Tokens live in Vault through the corenav_tokens_* functions (migration 0225).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { Client } from 'npm:@modelcontextprotocol/sdk@1/client/index.js'
import { StreamableHTTPClientTransport } from 'npm:@modelcontextprotocol/sdk@1/client/streamableHttp.js'

export const CORENAV_MCP = 'https://expand.corenav.ai/api/mcp'
const ISSUER = 'https://expand.corenav.ai'
const AUTHORIZE = `${ISSUER}/authorize`
const TOKEN = `${ISSUER}/token`
const REGISTER = `${ISSUER}/register`
const REVOKE = `${ISSUER}/revoke`
const PROVIDER = 'corenav'
// CoreNav is Mighty Wash's; the button and tools are for that account only.
export const CORENAV_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
// Where CoreNav sends people back. Changing this list re-registers Operator.
export const REDIRECT_URIS = [
  'https://operator.washlyfe.com/app/corenav/callback',
  'http://localhost:5173/app/corenav/callback',
]

type OAuthClient = { client_id: string; client_secret: string | null }
export type Tokens = { access_token: string; refresh_token: string | null; expires_at: number | null }

// A CoreNav login that has to be signed in again (refresh refused or revoked).
export class ReconnectNeeded extends Error {}

const sameList = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x))

export async function getOAuthClient(svc: SupabaseClient): Promise<OAuthClient> {
  const { data } = await svc.rpc('oauth_client_get', { p_provider: PROVIDER })
  const c = data as { client_id?: string; client_secret?: string | null; redirect_uris?: string[] } | null
  if (c?.client_id && sameList(c.redirect_uris, REDIRECT_URIS)) return { client_id: c.client_id, client_secret: c.client_secret ?? null }
  return register(svc)
}

async function register(svc: SupabaseClient): Promise<OAuthClient> {
  const res = await fetch(REGISTER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Operator AI (Mighty Wash)',
      client_uri: 'https://operator.washlyfe.com',
      redirect_uris: REDIRECT_URIS,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.client_id) {
    throw new Error(`CoreNav didn't accept Operator's registration (${res.status}${j.error ? `: ${j.error_description ?? j.error}` : ''}).`)
  }
  const { error } = await svc.rpc('oauth_client_save', {
    p_provider: PROVIDER, p_client_id: j.client_id, p_client_secret: j.client_secret ?? null, p_redirect_uris: REDIRECT_URIS,
  })
  if (error) throw new Error(`Couldn't save the CoreNav registration: ${error.message}`)
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

export function authorizeUrl(client: OAuthClient, redirectUri: string, state: string, challenge: string): string {
  const u = new URL(AUTHORIZE)
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: CORENAV_MCP,
  }).toString()
  return u.toString()
}

async function tokenRequest(client: OAuthClient, params: Record<string, string>, keepRefresh: string | null = null): Promise<Tokens> {
  const body = new URLSearchParams({ ...params, client_id: client.client_id, resource: CORENAV_MCP })
  if (client.client_secret) body.set('client_secret', client.client_secret)
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.access_token) {
    const why = j.error_description ?? j.error ?? `status ${res.status}`
    if (j.error === 'invalid_grant' || j.error === 'invalid_client' || res.status === 401) throw new ReconnectNeeded(`CoreNav sign-in expired (${why}).`)
    throw new Error(`CoreNav sign-in failed (${why}).`)
  }
  const secs = Number(j.expires_in)
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? keepRefresh,
    expires_at: Number.isFinite(secs) && secs > 0 ? Date.now() + secs * 1000 : null,
  }
}

export async function exchangeCode(client: OAuthClient, code: string, verifier: string, redirectUri: string): Promise<Tokens> {
  return tokenRequest(client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
}

async function loadTokens(svc: SupabaseClient, userId: string): Promise<Tokens | null> {
  const { data, error } = await svc.rpc('corenav_tokens_get', { p_user: userId })
  if (error) throw new Error(error.message)
  const t = data as Tokens | null
  return t?.access_token ? t : null
}

// The person's CoreNav access token, refreshed when it's about to run out.
// null when they haven't connected CoreNav.
export async function accessTokenFor(svc: SupabaseClient, userId: string): Promise<string | null> {
  const t = await loadTokens(svc, userId)
  if (!t) return null
  if (!t.expires_at || t.expires_at > Date.now() + 60_000) return t.access_token
  if (!t.refresh_token) {
    await svc.rpc('corenav_set_error', { p_user: userId, p_error: 'expired, no refresh token' })
    throw new ReconnectNeeded('CoreNav sign-in expired.')
  }
  try {
    const next = await tokenRequest(await getOAuthClient(svc), { grant_type: 'refresh_token', refresh_token: t.refresh_token }, t.refresh_token)
    await svc.rpc('corenav_tokens_save', { p_user: userId, p_tokens: next })
    return next.access_token
  } catch (e) {
    // Another request may have refreshed first (refresh tokens can be single use).
    const again = await loadTokens(svc, userId)
    if (again && again.access_token !== t.access_token && (!again.expires_at || again.expires_at > Date.now() + 60_000)) {
      return again.access_token
    }
    await svc.rpc('corenav_set_error', { p_user: userId, p_error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

export async function revokeAndForget(svc: SupabaseClient, userId: string): Promise<void> {
  const t = await loadTokens(svc, userId).catch(() => null)
  if (t) {
    const client = await getOAuthClient(svc).catch(() => null)
    if (client) {
      for (const [token, hint] of [[t.refresh_token, 'refresh_token'], [t.access_token, 'access_token']] as const) {
        if (!token) continue
        const body = new URLSearchParams({ token, token_type_hint: hint, client_id: client.client_id })
        if (client.client_secret) body.set('client_secret', client.client_secret)
        await fetch(REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).catch(() => null)
      }
    }
  }
  const { error } = await svc.rpc('corenav_tokens_delete', { p_user: userId })
  if (error) throw new Error(error.message)
}

// ---- MCP ----

export type McpToolInfo = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string }
}
export type CoreNavTool = { name: string; apiName: string; description: string; inputSchema: Record<string, unknown> }

// Verbs that change something wherever they appear in a name.
const WRITE_ANY = new Set(['create', 'update', 'delete', 'remove', 'add', 'insert', 'edit', 'modify', 'archive', 'unarchive',
  'assign', 'unassign', 'upload', 'import', 'merge', 'rename', 'save', 'submit', 'approve', 'reject', 'cancel', 'reopen', 'upsert',
  'enroll', 'invite', 'publish', 'send', 'write', 'set', 'move', 'mark'])
// Words that are verbs that change something only when they lead the name
// ("log_call" writes; "get_activity_log" reads).
const WRITE_FIRST = new Set(['post', 'put', 'patch', 'run', 'execute', 'trigger', 'start', 'stop', 'schedule', 'close', 'complete',
  'link', 'unlink', 'tag', 'untag', 'share', 'email', 'message', 'notify', 'log', 'record', 'convert', 'clone', 'copy', 'generate'])
const READ_WORDS = new Set(['get', 'list', 'search', 'find', 'query', 'read', 'fetch', 'lookup', 'look', 'describe', 'count',
  'summarize', 'summarise', 'summary', 'show', 'view', 'browse', 'retrieve', 'explore', 'analyze', 'analyse', 'compare', 'whoami',
  'me', 'stats', 'report', 'details', 'detail', 'overview', 'info', 'schema', 'profile', 'history', 'timeline'])
const wordsOf = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

// Operator AI only reads. A tool counts as read-only when CoreNav marks it so;
// unmarked tools go by their name: the leading verb decides, then any word, and
// anything unclear is left out.
export function isReadOnlyTool(t: McpToolInfo): boolean {
  if (t.annotations?.readOnlyHint === true) return true
  if (t.annotations?.readOnlyHint === false || t.annotations?.destructiveHint === true) return false
  const w = wordsOf(t.name)
  if (!w.length) return false
  if (WRITE_ANY.has(w[0]) || WRITE_FIRST.has(w[0])) return false
  if (READ_WORDS.has(w[0])) return true
  if (w.some((x) => WRITE_ANY.has(x))) return false
  return w.some((x) => READ_WORDS.has(x))
}

// Claude tool names: letters, digits, _ and -, at most 64 characters.
export function apiNameFor(name: string, taken: Set<string>): string {
  const base = ('corenav_' + name.replace(/[^a-zA-Z0-9_-]+/g, '_')).slice(0, 64)
  let n = base
  for (let i = 2; taken.has(n); i++) n = `${base.slice(0, 60)}_${i}`
  taken.add(n)
  return n
}

export function toTools(list: McpToolInfo[]): { tools: CoreNavTool[]; skipped: string[] } {
  const taken = new Set<string>()
  const tools: CoreNavTool[] = []
  const skipped: string[] = []
  for (const t of list) {
    if (!isReadOnlyTool(t)) { skipped.push(t.name); continue }
    const schema = t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : {}
    tools.push({
      name: t.name,
      apiName: apiNameFor(t.name, taken),
      description: `CoreNav: ${(t.description ?? t.title ?? t.annotations?.title ?? t.name).slice(0, 4000)}`,
      inputSchema: { ...schema, type: 'object', properties: (schema as { properties?: unknown }).properties ?? {} },
    })
  }
  return { tools, skipped }
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))])

export class CoreNavSession {
  readonly byApiName: Map<string, CoreNavTool>
  private constructor(private client: Client, readonly tools: CoreNavTool[], readonly skipped: string[]) {
    this.byApiName = new Map(tools.map((t) => [t.apiName, t]))
  }

  // `server` is only for tests.
  static async open(token: string, server = CORENAV_MCP): Promise<CoreNavSession> {
    const transport = new StreamableHTTPClientTransport(new URL(server), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
    const client = new Client({ name: 'operator-ai', version: '1.0.0' })
    await withTimeout(client.connect(transport), 12_000, 'Connecting to CoreNav')
    const all: McpToolInfo[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const r = (await withTimeout(client.listTools(cursor ? { cursor } : undefined), 12_000, 'Listing CoreNav tools')) as {
        tools: McpToolInfo[]
        nextCursor?: string
      }
      all.push(...r.tools)
      cursor = r.nextCursor
      if (!cursor) break
    }
    const { tools, skipped } = toTools(all)
    return new CoreNavSession(client, tools, skipped)
  }

  // Runs one tool and returns its text, cut to `max` characters.
  async call(apiName: string, args: unknown, max = 20000): Promise<{ text: string; isError: boolean }> {
    const t = this.byApiName.get(apiName)
    if (!t) return { text: 'That CoreNav tool is not available.', isError: true }
    const r = (await withTimeout(
      this.client.callTool({ name: t.name, arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> }),
      60_000, `CoreNav ${t.name}`,
    )) as { content?: unknown[]; structuredContent?: unknown; isError?: boolean }
    const parts: string[] = []
    for (const c of (r.content ?? []) as { type: string; text?: string; resource?: { text?: string; uri?: string } }[]) {
      if (c.type === 'text' && c.text) parts.push(c.text)
      else if (c.type === 'resource' && c.resource) parts.push(c.resource.text ?? `[resource ${c.resource.uri ?? ''}]`)
      else parts.push(`[${c.type}]`)
    }
    if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent))
    let text = parts.join('\n')
    if (text.length > max) text = `${text.slice(0, max)}…(truncated: ${text.length.toLocaleString('en-US')} characters in all. Ask for less.)`
    return { text, isError: r.isError === true }
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => {})
  }
}
