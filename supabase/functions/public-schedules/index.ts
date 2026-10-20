// public-schedules — Supabase Edge Function (Deno).
// Backs the hidden, link-only "view published schedules" page. No login: the URL
// carries a portal token (schedule_portals). Everything runs through the service
// role so no anon RLS is exposed, and only PUBLISHED schedules for the token's
// account are ever returned. Deploy with --no-verify-jwt.
//
// Actions (POST body):
//   sites { token }                         -> { account, sites: [{id,name}] }   (sites with published schedules)
//   weeks { token, location_id }            -> { weeks: [{ week_start_date }] }   (published, newest first)
//   week  { token, location_id, week_start_date }
//                                           -> { shifts: [{ employee_id, employee_name, date, start_time, end_time, role_label }] }

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty */ }
  const token = String(body.token ?? '')
  if (!token) return json({ error: 'bad_request', message: 'Missing link token.' }, 400, origin)

  const { data: portal } = await svc
    .from('schedule_portals')
    .select('account_id, active')
    .eq('token', token)
    .maybeSingle()
  if (!portal || !portal.active) return json({ error: 'not_found', message: 'This schedule link is not active.' }, 404, origin)
  const accountId = portal.account_id as string

  // Confirm a location belongs to this portal's account (so a token can't read
  // another account's data by passing an arbitrary location_id).
  const locationInAccount = async (locationId: string): Promise<boolean> => {
    if (!locationId) return false
    const { data } = await svc.from('locations').select('id').eq('id', locationId).eq('account_id', accountId).maybeSingle()
    return !!data
  }

  if (body.action === 'sites') {
    const { data: acct } = await svc.from('accounts').select('name').eq('id', accountId).maybeSingle()
    const { data: locs } = await svc.from('locations').select('id, name').eq('account_id', accountId).order('name')
    const locations = (locs as Array<{ id: string; name: string }> | null) ?? []
    const ids = locations.map((l) => l.id)
    // Which of those sites have at least one published schedule.
    const withPublished = new Set<string>()
    if (ids.length) {
      const { data: scheds } = await svc
        .from('schedules')
        .select('location_id')
        .eq('published', true)
        .in('location_id', ids)
      for (const s of (scheds as Array<{ location_id: string }> | null) ?? []) withPublished.add(s.location_id)
    }
    const sites = locations.filter((l) => withPublished.has(l.id))
    return json({ ok: true, account: (acct as { name?: string } | null)?.name ?? 'Schedules', sites }, 200, origin)
  }

  if (body.action === 'weeks') {
    const locationId = String(body.location_id ?? '')
    if (!(await locationInAccount(locationId))) return json({ error: 'not_found' }, 404, origin)
    const { data } = await svc
      .from('schedules')
      .select('week_start_date')
      .eq('location_id', locationId)
      .eq('published', true)
      .order('week_start_date', { ascending: false })
    const weeks = (data as Array<{ week_start_date: string }> | null) ?? []
    return json({ ok: true, weeks }, 200, origin)
  }

  if (body.action === 'week') {
    const locationId = String(body.location_id ?? '')
    const weekStart = String(body.week_start_date ?? '')
    if (!(await locationInAccount(locationId)) || !weekStart) return json({ error: 'not_found' }, 404, origin)
    const { data: sched } = await svc
      .from('schedules')
      .select('id')
      .eq('location_id', locationId)
      .eq('week_start_date', weekStart)
      .eq('published', true)
      .maybeSingle()
    if (!sched) return json({ ok: true, shifts: [] }, 200, origin)
    const { data: rows } = await svc
      .from('shifts')
      .select('employee_id, date, start_time, end_time, role_label, employee:employee_id(first_name, last_name)')
      .eq('schedule_id', (sched as { id: string }).id)
    const shifts = ((rows as Any[] | null) ?? []).map((r) => ({
      employee_id: r.employee_id as string,
      employee_name: `${r.employee?.first_name ?? ''} ${r.employee?.last_name ?? ''}`.trim() || 'Employee',
      date: r.date as string,
      start_time: r.start_time as string,
      end_time: r.end_time as string,
      role_label: (r.role_label as string | null) ?? null,
    }))
    return json({ ok: true, shifts }, 200, origin)
  }

  return json({ error: 'bad_request', message: 'Unknown action.' }, 400, origin)
})
