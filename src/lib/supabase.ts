import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  // Surface this loudly during dev — the app cannot function without it.
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local',
  )
}

// supabase-js serializes auth ops behind navigator.locks. In practice that lock
// can wedge — most often when HMR (or StrictMode) creates a second client on
// the same storage key — and then getSession()/token refresh hang forever,
// leaving the app stuck on the auth loader. We don't need cross-tab lock
// coordination here, so use a passthrough lock that just runs the operation.
const passthroughLock = async <R,>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => fn()

function makeClient(): SupabaseClient<Database> {
  return createClient<Database>(url ?? 'http://localhost', anon ?? 'public-anon-key-missing', {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      lock: passthroughLock,
    },
  })
}

// Reuse a single client across HMR reloads so we never have two GoTrueClients
// fighting over the same storage key.
const g = globalThis as typeof globalThis & {
  __tunnelsyncSupabase?: SupabaseClient<Database>
}
export const supabase: SupabaseClient<Database> = g.__tunnelsyncSupabase ?? makeClient()
if (import.meta.env.DEV) g.__tunnelsyncSupabase = supabase
