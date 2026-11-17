// site-work-orders — Supabase Edge Function (Deno).
// The work orders still open in MaintainX (Open, In Progress, On Hold) for one
// Operator site, read live from the MaintainX API, so an auditor can see what's
// already reported while auditing (Site Audit NEW). Read-only. The lookup itself
// is _shared/maintainx_site.ts.
//
// Body: { location_id: string }
// Auth: a signed-in Mighty Wash user who can see that site (RLS on locations
// decides), or the service role.
// Secret: MAINTAINX_API_TOKEN (503 no_key otherwise); MAINTAINX_BASE_URL optional.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { maintainxToken, openWorkOrdersForSite } from '../_shared/maintainx_site.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const MIGHTY_WASH = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

const ALLOWED_ORIGINS = new Set<string>(['https://operator.washlyfe.com', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return { 'Access-Control-Allow-Origin': allow, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (!maintainxToken()) return json({ error: 'no_key', message: 'MaintainX is not connected.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: { location_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const locationId = body.location_id
  if (!locationId || !/^[0-9a-f-]{36}$/i.test(locationId)) return json({ error: 'bad_request' }, 400, origin)

  // Read the site as the caller, so RLS decides whether they may see it.
  const auth = req.headers.get('Authorization') ?? ''
  const isService = jwtRole(auth) === 'service_role' || auth === `Bearer ${serviceKey}`
  if (!isService && !auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const db = isService
    ? createClient(url, serviceKey, { auth: { persistSession: false } })
    : createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: site } = await db.from('locations').select('id, name, account_id, maintainx_id').eq('id', locationId).maybeSingle()
  const s = site as Any
  if (!s) return json({ error: 'not_found' }, 404, origin)
  if (s.account_id !== MIGHTY_WASH) return json({ error: 'not_connected', message: 'MaintainX is connected for Mighty Wash only.' }, 404, origin)

  try {
    return json(await openWorkOrdersForSite({ name: String(s.name ?? ''), maintainx_id: s.maintainx_id }), 200, origin)
  } catch (e) {
    return json({ error: 'maintainx_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
