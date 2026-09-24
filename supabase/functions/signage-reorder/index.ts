// signage-reorder — Supabase Edge Function (Deno).
// Persists the display order of one category's gallery. The full ordered list of
// artwork (path + name) is sent; each becomes a signage_artwork row for the
// caller's account with sort_order = its index, so galleries render in that order.
// Locked to a single admin: only kevan@washlyfe.com may call it. Everyone else
// gets 403, so no one else can rearrange the gallery.
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

type OrderItem = { path?: string; name?: string | null }

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
  // Only the named admin may rearrange the gallery.
  if ((caller.email ?? '').toLowerCase() !== ADMIN_EMAIL) {
    return json({ error: 'forbidden', message: 'Only the admin can rearrange the gallery.' }, 403, origin)
  }

  let body: { category?: string; order?: OrderItem[] } = {}
  try { body = await req.json() } catch { /* empty */ }
  const category = (body.category ?? '').trim()
  const order = Array.isArray(body.order) ? body.order : []
  if (!category) return json({ error: 'bad_request', message: 'category required' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Scope to the admin's own account (artwork paths are prefixed with account id).
  const { data: me } = await svc.from('users').select('account_id').eq('id', caller.id).maybeSingle()
  const accountId = (me as { account_id?: string } | null)?.account_id
  if (!accountId) return json({ error: 'forbidden' }, 403, origin)

  const rows = order
    .map((o, idx) => ({ path: (o.path ?? '').trim(), name: o.name ?? null, sort_order: idx }))
    .filter((o) => o.path)
    .map((o) => ({
      account_id: accountId,
      path: o.path,
      name: o.name,
      sign_category: category,
      sort_order: o.sort_order,
    }))

  if (rows.length) {
    const { error } = await svc.from('signage_artwork').upsert(rows, { onConflict: 'account_id,path' })
    if (error) return json({ error: 'db', message: error.message }, 500, origin)
  }

  return json({ ok: true, count: rows.length }, 200, origin)
})
