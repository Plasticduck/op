// sync-site-hourly — Supabase Edge Function (Deno).
// Fills site_hourly_cars (migration 0235): cars per site per hour of the day from
// DRB SiteWatch and FlexWash, for the days asked. Counting lives in
// _shared/hourly_cars.ts (shared with Operator AI's hourly_cars tool).
//
// Body: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', maxDays?: number, parts?: 'drb' | 'flex' | 'both' }
// Handles at most maxDays days per call (default 7, up to 31); the caller moves
// start to nextStart until done. The hourly cron covers yesterday + today and the
// nightly one the trailing week.
// Auth: service-role JWT (cron/backfill) or a signed-in Mighty Wash owner.
// Secrets: MW_DASHBOARD_PASSWORD (+ MW_DASHBOARD_URL), FLEXWASH_CLIENT_ID,
//          FLEXWASH_CLIENT_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { MW_ACCOUNT, addDays, minDate, syncHourly } from '../_shared/hourly_cars.ts'

const ALLOWED_ORIGINS = new Set<string>([
  'https://operator.washlyfe.com',
  'http://localhost:5173',
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

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const auth = req.headers.get('Authorization') ?? ''
  if (jwtRole(auth) !== 'service_role') {
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner' || p.account_id !== MW_ACCOUNT) return json({ error: 'forbidden' }, 403, origin)
  }

  let body: { start?: string; end?: string; maxDays?: number; parts?: 'drb' | 'flex' | 'both' } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!isDate(body.start) || !isDate(body.end) || body.start > body.end) {
    return json({ error: 'bad_request', message: 'start and end (YYYY-MM-DD, start <= end) are required.' }, 400, origin)
  }
  const maxDays = Math.max(1, Math.min(31, Math.floor(Number(body.maxDays) || 7)))
  const end = minDate(body.end, addDays(body.start, maxDays - 1))
  const parts = body.parts === 'drb' || body.parts === 'flex' ? body.parts : 'both'

  const t0 = Date.now()
  const r = await syncHourly(svc, body.start, end, parts)
  const done = end >= body.end
  return json({
    start: body.start, end, parts, ...r,
    nextStart: done ? null : addDays(end, 1), done,
    ms: Date.now() - t0,
  }, r.errors.length && !r.drbRows && !r.flexRows ? 502 : 200, origin)
})
