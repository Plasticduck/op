// work-request-portal — Supabase Edge Function (Deno), public (no JWT).
// Backs the shareable Work Request form. Anyone with a portal link can look up
// the portal and submit a request; both go through the service role so no anon
// RLS is exposed. Deploy with --no-verify-jwt.
//
// Actions:
//   info   { token }  -> { name, locations: [{id,name}] }  (form setup)
//   submit { token, title, description, priority, location_id, requester_name,
//            requester_email } -> { ok: true }

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
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

const PRIORITIES = new Set(['none', 'low', 'medium', 'high'])

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty */ }
  const token = String(body.token ?? '')
  if (!token) return json({ error: 'bad_request', message: 'Missing portal token.' }, 400, origin)

  const { data: portal } = await svc
    .from('work_request_portals')
    .select('id, account_id, name, location_id, active')
    .eq('token', token)
    .maybeSingle()
  if (!portal || !portal.active) return json({ error: 'not_found', message: 'This request link is not active.' }, 404, origin)

  if (body.action === 'info') {
    let locations: Array<{ id: string; name: string }> = []
    if (portal.location_id) {
      const { data } = await svc.from('locations').select('id, name').eq('id', portal.location_id)
      locations = (data as Array<{ id: string; name: string }> | null) ?? []
    } else {
      const { data } = await svc.from('locations').select('id, name').eq('account_id', portal.account_id).order('name')
      locations = (data as Array<{ id: string; name: string }> | null) ?? []
    }
    return json({ ok: true, name: portal.name, fixedLocation: !!portal.location_id, locations }, 200, origin)
  }

  if (body.action === 'submit') {
    const title = String(body.title ?? '').trim()
    const locationId = String(body.location_id ?? '')
    if (!title) return json({ error: 'bad_request', message: 'A title is required.' }, 400, origin)
    // Validate the location belongs to this portal's account.
    const { data: loc } = await svc
      .from('locations')
      .select('id')
      .eq('id', locationId)
      .eq('account_id', portal.account_id)
      .maybeSingle()
    if (!loc) return json({ error: 'bad_request', message: 'Please choose a valid site.' }, 400, origin)

    const priority = PRIORITIES.has(String(body.priority)) ? String(body.priority) : 'none'
    const { error } = await svc.from('work_requests').insert({
      account_id: portal.account_id,
      location_id: locationId,
      title,
      description: body.description ? String(body.description).slice(0, 4000) : null,
      priority,
      requester_name: body.requester_name ? String(body.requester_name).slice(0, 200) : null,
      requester_email: body.requester_email ? String(body.requester_email).slice(0, 200) : null,
      status: 'pending',
    })
    if (error) return json({ error: 'insert_failed', message: error.message }, 500, origin)
    return json({ ok: true }, 200, origin)
  }

  return json({ error: 'bad_request', message: 'Unknown action.' }, 400, origin)
})
