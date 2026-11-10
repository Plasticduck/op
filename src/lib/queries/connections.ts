import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Operator AI connections: each person connects their own CoreNav and FlexWash
// logins. The mcp-oauth function runs the sign-in and keeps tokens in Vault;
// ask-operator then uses them (read-only tools), side by side with Operator's own
// data and the company FlexWash connection. Mighty Wash only, and not on the
// shared office login.

export type ProviderKey = 'corenav' | 'flexwash'
export const CONNECT_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

export const CONNECTORS: Record<ProviderKey, {
  label: string
  blurb: string
  // Must match the provider's redirect URIs in supabase/functions/_shared/connect.ts.
  callbackPath: string
  // Shown only to these people while the provider isn't letting Operator sign in yet.
  previewEmails?: string[]
}> = {
  corenav: {
    label: 'CoreNav',
    blurb: 'Your CoreNav workspace, with your own CoreNav login.',
    callbackPath: '/app/corenav/callback',
  },
  flexwash: {
    label: 'FlexWash',
    blurb: 'FlexWash with your own login, including what the company connection can\'t see, like the member roster.',
    callbackPath: '/app/flexwash/callback',
  },
}
// The rows in Operator AI > Connections. FlexWash is left out for now (Kevan,
// 2026-11-10): its sign-in answers "Unknown client" until FlexWash allows
// Operator. Everything behind it stays in place (mcp-oauth, the FlexWash return
// page, ask-operator's login-first routing, public/oauth/flexwash-client.json),
// so adding 'flexwash' back here turns it on. The company FlexWash API is
// separate and unaffected.
export const PROVIDER_ORDER: ProviderKey[] = ['corenav']

export type ConnStatus = { connected: boolean; connected_at?: string; needs_reconnect?: boolean }
export type ConnStatuses = Record<ProviderKey, ConnStatus>
export type ConnFinish = { connected: boolean; tools: string[] | null; skipped: string[]; tools_error: string | null }

// An error from mcp-oauth, with its code (e.g. not_ready: the provider doesn't accept Operator yet).
export class ConnectError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('mcp-oauth', { body })
  const code = (data as { error?: string } | null)?.error
  if (error || code) {
    let ctxCode: string | undefined
    if (error && typeof error === 'object' && 'context' in error && (error as { context?: unknown }).context instanceof Response) {
      try { ctxCode = ((await ((error as { context: Response }).context.clone().json())) as { error?: string })?.error } catch { /* not JSON */ }
    }
    throw new ConnectError(await fnErrorMessage(error, data as { message?: string; error?: string } | null, fallback), code ?? ctxCode)
  }
  return data as T
}

export const connections = {
  status: async (): Promise<ConnStatuses> => {
    const { data, error } = await supabase.rpc('mcp_status')
    if (error) throw new Error(error.message)
    const s = (data as Partial<ConnStatuses> | null) ?? {}
    return { corenav: s.corenav ?? { connected: false }, flexwash: s.flexwash ?? { connected: false } }
  },
  // Where to send the person to sign in.
  start: (provider: ProviderKey) =>
    call<{ url: string }>(
      { provider, action: 'start', redirect_uri: window.location.origin + CONNECTORS[provider].callbackPath },
      `Couldn't start the ${CONNECTORS[provider].label} sign-in.`),
  finish: (provider: ProviderKey, code: string, state: string) =>
    call<ConnFinish>({ provider, action: 'finish', code, state }, `Couldn't finish connecting ${CONNECTORS[provider].label}.`),
  disconnect: (provider: ProviderKey) =>
    call<{ connected: false }>({ provider, action: 'disconnect' }, `Couldn't disconnect ${CONNECTORS[provider].label}.`),
}
