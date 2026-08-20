// signage-artwork-remove — Supabase Edge Function (Deno).
// Deletes one artwork from the library: the storage file, its signage_artwork
// row(s), and any signage_requests references to it (so the card doesn't linger
// as a broken thumbnail). Locked to a single admin: only kevan@washlyfe.com may
// call it. Everyone else gets 403, so no one else can delete artwork.
//
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

const ADMIN_EMAIL = 'kevan@washlyfe.com'

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

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const caller = u.user
  if (!caller) return json({ error: 'unauthorized' }, 401, origin)
  // Only the named admin may delete artwork.
  if ((caller.email ?? '').toLowerCase() !== ADMIN_EMAIL) {
    return json({ error: 'forbidden', message: 'Only the admin can remove artwork.' }, 403, origin)
  }

  let body: { path?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const path = (body.path ?? '').trim()
  if (!path) return json({ error: 'bad_request', message: 'path required' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Scope to the admin's own account (artwork paths are prefixed with account id).
  const { data: me } = await svc.from('users').select('account_id').eq('id', caller.id).maybeSingle()
  const accountId = (me as { account_id?: string } | null)?.account_id
  if (!accountId) return json({ error: 'forbidden' }, 403, origin)

  // 1) Remove the stored PDF (ignore "not found" so a re-delete still succeeds).
  const { error: rmErr } = await svc.storage.from('signage-artwork').remove([path])
  if (rmErr && !/not.*found/i.test(rmErr.message)) {
    return json({ error: 'storage', message: rmErr.message }, 500, origin)
  }

  // 2) Delete standalone library rows for this path.
  await svc.from('signage_artwork').delete().eq('account_id', accountId).eq('path', path)

  // 3) Clear the reference on any orders that used it, so it leaves the library
  //    cleanly instead of lingering as a broken thumbnail.
  await svc.from('signage_requests')
    .update({ artwork_path: null, artwork_name: null })
    .eq('account_id', accountId)
    .eq('artwork_path', path)

  return json({ ok: true }, 200, origin)
})
