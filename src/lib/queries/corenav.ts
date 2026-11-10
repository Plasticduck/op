import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// CoreNav for Operator AI: each person connects their own CoreNav login. The
// corenav-oauth function runs the sign-in and keeps the tokens in Vault;
// ask-operator then uses them (read-only tools). Mighty Wash only, and not on
// the shared office login.

export const CORENAV_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
// Must match REDIRECT_URIS in supabase/functions/_shared/corenav.ts.
export const CORENAV_CALLBACK_PATH = '/app/corenav/callback'

export type CoreNavStatus = { connected: boolean; connected_at?: string; needs_reconnect?: boolean }
export type CoreNavFinish = { connected: boolean; tools: string[] | null; skipped: string[]; tools_error: string | null }

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('corenav-oauth', { body })
  if (error || (data as { error?: string } | null)?.error) {
    throw new Error(await fnErrorMessage(error, data as { message?: string; error?: string } | null, fallback))
  }
  return data as T
}

export const corenav = {
  status: async (): Promise<CoreNavStatus> => {
    const { data, error } = await supabase.rpc('corenav_status')
    if (error) throw new Error(error.message)
    return (data as CoreNavStatus | null) ?? { connected: false }
  },
  // Where to send the person to sign in to CoreNav.
  start: () =>
    call<{ url: string }>({ action: 'start', redirect_uri: window.location.origin + CORENAV_CALLBACK_PATH }, "Couldn't start the CoreNav sign-in."),
  finish: (code: string, state: string) => call<CoreNavFinish>({ action: 'finish', code, state }, "Couldn't finish connecting CoreNav."),
  disconnect: () => call<{ connected: false }>({ action: 'disconnect' }, "Couldn't disconnect CoreNav."),
}
