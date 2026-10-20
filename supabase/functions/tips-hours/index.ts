// tips-hours — Supabase Edge Function (Deno).
// Returns iSolved WORKED hours per employee for one site over a date range, for
// the "Tips NEW" page (hours-weighted tip distribution). Worked hours = all
// timecard pay items except PTO. Only name + hours leave the function. Mighty
// Wash only. Auth: service-role (cron/test) or a MW owner/manager.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

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

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

// Timecard "Location" labor code -> site: NN -> MWNN, COR -> Corporate, SPO -> Spotless.
function siteLabel(code: string): string {
  if (!code) return 'Unassigned'
  if (/^\d+$/.test(code)) return 'MW' + code.padStart(2, '0')
  const u = code.toUpperCase()
  if (u === 'COR') return 'Corporate'
  if (u === 'SPO') return 'Spotless'
  return code
}
const isPTO = (name: string, code: string) => /pto/i.test(name) || code === '03'

async function getToken(base: string, cid: string, secret: string): Promise<string> {
  const res = await fetch(base + '/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(cid + ':' + secret) },
    body: 'grant_type=client_credentials',
  })
  const j = (await res.json()) as Any
  if (!res.ok || !j.access_token) throw new Error('token failed ' + res.status)
  return j.access_token as string
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: row } = await svc.from('users').select('account_id, role').eq('id', u.user.id).maybeSingle()
    const ok = !!row && row.account_id === MW_ACCOUNT && (row.role === 'owner' || row.role === 'manager')
    if (!ok) return json({ error: 'forbidden', message: 'Tips is restricted to Mighty Wash managers.' }, 403, origin)
  }

  const base = Deno.env.get('ISOLVED_BASE_URL')
  const cid = Deno.env.get('ISOLVED_CLIENT_ID')
  const secret = Deno.env.get('ISOLVED_API_SECRET')
  const client = Deno.env.get('ISOLVED_CLIENT')
  const legal = Deno.env.get('ISOLVED_LEGAL')
  if (!base || !cid || !secret || !client || !legal) {
    return json({ error: 'no_key', message: 'iSolved is not configured.' }, 503, origin)
  }

  let body: { start?: string; end?: string; site?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const re = /^\d{4}-\d{2}-\d{2}$/
  const { start, end } = body
  const targetSite = String(body.site ?? '').trim() // e.g. "MW17"
  if (!start || !end || !re.test(start) || !re.test(end) || !targetSite) {
    return json({ error: 'bad_request', message: 'start, end (YYYY-MM-DD) and site are required.' }, 400, origin)
  }
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1)

  try {
    let token = await getToken(base, cid, secret)
    const getJson = async (pageUrl: string): Promise<Any> => {
      let res = await fetch(pageUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      if (res.status === 401) {
        token = await getToken(base, cid, secret)
        res = await fetch(pageUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      }
      if (!res.ok) throw new Error(`isolved ${res.status}`)
      return await res.json()
    }

    const emps = new Map<string, { number: string; name: string; hours: number }>()
    const PAGE_SIZE = 200
    for (let page = 0; page < 200; page++) {
      const d = await getJson(`${base}/api/clients/${client}/legals/${legal}/timecardData?startDate=${start}&endDate=${end}&pageSize=${PAGE_SIZE}&page=${page}`)
      const results = (d.results ?? []) as Any[]
      if (results.length === 0) break
      for (const r of results) {
        const number = String(r.employeeNumber ?? r.employeeId ?? '')
        const name = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').trim() || number
        for (const t of r.timecardData ?? []) {
          const loc = (t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
          if (siteLabel(String(loc)) !== targetSite) continue
          for (const p of t.payItems ?? []) {
            const hrs = Number(p.payItemHours) || 0
            if (!hrs) continue
            if (isPTO(String(p.payItemName ?? ''), String(p.payItemCode ?? ''))) continue
            const e = emps.get(number) ?? { number, name, hours: 0 }
            e.hours += hrs
            emps.set(number, e)
          }
        }
      }
    }

    const employees = [...emps.values()]
      .map((e) => ({ ...e, hours: Math.round(e.hours * 100) / 100 }))
      .filter((e) => e.hours > 0)
      .sort((a, b) => b.hours - a.hours)
    const totalHours = Math.round(employees.reduce((a, e) => a + e.hours, 0) * 100) / 100
    return json({ ok: true, site: targetSite, employees, totalHours, days }, 200, origin)
  } catch (e) {
    return json({ error: 'fetch_failed', message: e instanceof Error ? e.message : String(e) }, 500, origin)
  }
})
