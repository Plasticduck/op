// isolved-roster-sync — Supabase Edge Function (Deno).
// Pulls the ACTIVE iSolved employee roster and mirrors it into Operator's
// `employees` table so staff show up as schedulable labor at their site without
// anyone hand-creating a profile. Idempotent: rows are upserted by iSolved
// employee number; anyone no longer Active in iSolved is set to 'inactive' so
// they drop off the scheduler. Corporate / Unassigned / unmapped work locations
// are skipped (not schedulable at a wash). Only name/site/rate fields are kept —
// never SSN/DOB. Mighty Wash only. Auth: service-role (cron) or a MW owner/manager.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const FT_YEAR_HOURS = 2080

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

// Role claim from a JWT bearer, used to recognize the cron's service-role call.
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

// Roster "work location" strings look like "HOB #19", "COR ", "SPT", "LBK #1".
function siteFromWorkLocation(wl: string): string {
  if (!wl) return 'Unassigned'
  const m = wl.match(/#\s*(\d+)/)
  if (m) return 'MW' + m[1].padStart(2, '0')
  const u = wl.trim().toUpperCase()
  if (u.startsWith('COR')) return 'Corporate'
  if (u.startsWith('SPT') || u.startsWith('SPO')) return 'Spotless'
  return 'Unassigned'
}

function annualSalaryOf(e: Any): number {
  const annual = Number(e.annualSalary) || 0
  if (annual > 0) return annual
  const perPay = Number(e.perPaySalary) || 0
  const freq = Number(e.payFrequency) || 0
  return perPay > 0 && freq > 0 ? perPay * freq : 0
}
function effRate(e: Any): number {
  const hr = Number(e.hourlyRate) || 0
  if (hr > 0) return hr
  const annual = annualSalaryOf(e)
  return annual > 0 ? annual / FT_YEAR_HOURS : 0
}

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

  // Auth: the cron calls with the service-role key; a human must be a Mighty Wash
  // owner/manager.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  // The cron calls with a service-role JWT; a human must be a MW owner/manager.
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: row } = await svc.from('users').select('account_id, role').eq('id', u.user.id).maybeSingle()
    const ok = !!row && row.account_id === MW_ACCOUNT && (row.role === 'owner' || row.role === 'manager')
    if (!ok) return json({ error: 'forbidden', message: 'Roster sync is restricted to Mighty Wash managers.' }, 403, origin)
  }

  const base = Deno.env.get('ISOLVED_BASE_URL')
  const cid = Deno.env.get('ISOLVED_CLIENT_ID')
  const secret = Deno.env.get('ISOLVED_API_SECRET')
  const client = Deno.env.get('ISOLVED_CLIENT')
  const legal = Deno.env.get('ISOLVED_LEGAL')
  if (!base || !cid || !secret || !client || !legal) {
    return json({ error: 'no_key', message: 'iSolved is not configured.' }, 503, origin)
  }

  try {
    // Mighty Wash locations, keyed by name (which is the MW site code, e.g. "MW01").
    const { data: locs } = await svc.from('locations').select('id, name').eq('account_id', MW_ACCOUNT)
    const locByName = new Map<string, string>()
    for (const l of (locs ?? []) as Array<{ id: string; name: string }>) locByName.set(l.name, l.id)

    // 1) Pull the active roster. The iSolved API is 0-indexed; page until empty.
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
    type Rec = { number: string; first: string; last: string; site: string; hourly: number | null }
    const roster: Rec[] = []
    const skipped = { corporate: 0, unassigned: 0, unmapped: 0, noName: 0 }
    const PAGE_SIZE = 100
    for (let page = 0; page < 100; page++) {
      const d = await getJson(`${base}/api/clients/${client}/legals/${legal}/employees?pageSize=${PAGE_SIZE}&page=${page}`)
      const results = (d.results ?? []) as Any[]
      if (results.length === 0) break
      for (const e of results) {
        if (String(e.employmentStatus) !== 'Active') continue
        const number = String(e.employeeNumber ?? e.id ?? '').trim()
        if (!number) continue
        const site = siteFromWorkLocation(String(e.workLocation ?? ''))
        if (site === 'Corporate') { skipped.corporate++; continue }
        if (site === 'Unassigned') { skipped.unassigned++; continue }
        const na = e.nameAddress ?? {}
        const first = String(na.firstName ?? '').trim()
        const last = String(na.lastName ?? '').trim()
        if (!first && !last) { skipped.noName++; continue }
        if (!locByName.has(site)) { skipped.unmapped++; continue }
        const payType = String(e.payType ?? '')
        const rate = effRate(e)
        roster.push({ number, first, last, site, hourly: payType === 'Hourly' && rate > 0 ? rate : null })
      }
    }

    // 2) Upsert each active roster member into employees (by iSolved number). Only
    //    the sync-managed fields are written, so a PIN, login, or contact details
    //    added in Operator are preserved on update.
    const rows = roster.map((r) => ({
      isolved_number: r.number,
      first_name: r.first || r.last,
      last_name: r.first ? r.last : '',
      location_id: locByName.get(r.site)!,
      hourly_rate: r.hourly,
      status: 'active',
    }))
    let upserted = 0
    if (rows.length > 0) {
      const { error: upErr, count } = await svc
        .from('employees')
        .upsert(rows, { onConflict: 'isolved_number', count: 'exact' })
      if (upErr) return json({ error: 'upsert_failed', message: upErr.message }, 500, origin)
      upserted = count ?? rows.length
    }

    // 3) Deactivate anyone previously synced who is no longer in the active roster.
    const activeNumbers = new Set(roster.map((r) => r.number))
    const mwLocIds = [...locByName.values()]
    const { data: existing } = await svc
      .from('employees')
      .select('id, isolved_number, status')
      .not('isolved_number', 'is', null)
      .in('location_id', mwLocIds)
    const staleIds = ((existing ?? []) as Array<{ id: string; isolved_number: string; status: string }>)
      .filter((e) => !activeNumbers.has(e.isolved_number) && e.status !== 'inactive')
      .map((e) => e.id)
    let deactivated = 0
    if (staleIds.length > 0) {
      const { error: deErr } = await svc.from('employees').update({ status: 'inactive' }).in('id', staleIds)
      if (!deErr) deactivated = staleIds.length
    }

    return json(
      { ok: true, synced: upserted, active_roster: roster.length, deactivated, skipped, synced_at: new Date().toISOString() },
      200,
      origin,
    )
  } catch (e) {
    return json({ error: 'sync_failed', message: e instanceof Error ? e.message : String(e) }, 500, origin)
  }
})
