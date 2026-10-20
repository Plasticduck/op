// tips-hours — Supabase Edge Function (Deno).
// Returns iSolved WORKED hours per employee for the "Tips NEW" page. Worked
// hours = all timecard pay items except PTO. SALARIED staff are always excluded
// (payType from the roster), since the tip pool replenishes an hourly wage
// offset. Two modes over a date range:
//   • company-wide (default): every hourly employee, EXCLUDING anyone whose
//     roster work location is in `excludeSites` (e.g. the New Mexico sites).
//   • single site: pass `site` (e.g. "MW17") to get just that location.
// Only name + hours + site leave the function. Mighty Wash only.
// Auth: service-role (cron/test) or a MW owner/manager.

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
// Roster workLocation ("MightyWash #17") -> "MW17".
function siteFromWorkLocation(wl: string): string {
  if (!wl) return 'Unassigned'
  const m = wl.match(/#\s*(\d+)/)
  if (m) return 'MW' + m[1].padStart(2, '0')
  const u = wl.trim().toUpperCase()
  if (u.startsWith('COR')) return 'Corporate'
  if (u.startsWith('SPT') || u.startsWith('SPO')) return 'Spotless'
  return 'Unassigned'
}
// Normalize a site reference (16, "16", "MW16", "MightyWash #16") to "MW16".
function toSiteLabel(x: unknown): string {
  const s = String(x).trim().toUpperCase()
  if (/^\d+$/.test(s)) return 'MW' + s.padStart(2, '0')
  const m = s.match(/(\d+)/)
  if (m && s.includes('MW')) return 'MW' + m[1].padStart(2, '0')
  if (m && s.includes('#')) return 'MW' + m[1].padStart(2, '0')
  return s
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

  let body: { start?: string; end?: string; site?: string; excludeSites?: Array<string | number> } = {}
  try { body = await req.json() } catch { /* empty */ }
  const re = /^\d{4}-\d{2}-\d{2}$/
  const { start, end } = body
  const targetSite = String(body.site ?? '').trim() // e.g. "MW17"; empty = company-wide
  const companyMode = !targetSite
  const excludeSet = new Set((body.excludeSites ?? []).map(toSiteLabel))
  if (!start || !end || !re.test(start) || !re.test(end)) {
    return json({ error: 'bad_request', message: 'start and end (YYYY-MM-DD) are required.' }, 400, origin)
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
      if (!res.ok) throw new Error(`isolved ${res.status} ${(await res.text()).slice(0, 180)}`)
      return await res.json()
    }
    // iSolved returns 404 (not an empty page) when you page past the last page at
    // some page sizes, so a 404 after page 0 means "no more pages"; a 404 on page
    // 0 is a real error. Page at 100 to match the Labor Data function, which is
    // proven in production (larger sizes are unreliable).
    const PAGE_SIZE = 100
    const isEndOf404 = (e: unknown, page: number) =>
      page > 0 && e instanceof Error && /^isolved 404/.test(e.message)

    // Roster first: salaried employees (excluded) + each employee's work-location
    // site (used to drop New Mexico staff in company mode). Keyed by both
    // employeeNumber and id since the timecard can carry either. A roster failure
    // is non-fatal: hours are still returned (salaried/NM just aren't filtered)
    // and the problem is reported in rosterError.
    const salaried = new Set<string>()
    const siteByKey = new Map<string, string>()
    let rosterError: string | null = null
    try {
      for (let page = 0; page < 200; page++) {
        let d: Any
        try { d = await getJson(`${base}/api/clients/${client}/legals/${legal}/employees?pageSize=${PAGE_SIZE}&page=${page}`) }
        catch (e) { if (isEndOf404(e, page)) break; throw e }
        const results = (d.results ?? []) as Any[]
        if (results.length === 0) break
        for (const e of results) {
          const wlSite = siteFromWorkLocation(String(e.workLocation ?? ''))
          if (e.employeeNumber != null) siteByKey.set(String(e.employeeNumber), wlSite)
          if (e.id != null) siteByKey.set('id:' + String(e.id), wlSite)
          if (String(e.payType ?? '') !== 'Salary') continue
          if (e.employeeNumber != null) salaried.add(String(e.employeeNumber))
          if (e.id != null) salaried.add('id:' + String(e.id))
        }
      }
    } catch (e) {
      rosterError = e instanceof Error ? e.message : String(e)
    }
    const isSalaried = (r: Any) =>
      salaried.has(String(r.employeeNumber ?? '\u0000')) || salaried.has('id:' + String(r.employeeId ?? '\u0000'))

    // Accumulate worked hours per employee, with a per-site tally so we can resolve
    // each person's effective work location (roster first, else where they worked most).
    const emps = new Map<string, { number: string; empId: string; name: string; hours: number; siteHours: Record<string, number> }>()
    for (let page = 0; page < 400; page++) {
      let d: Any
      try { d = await getJson(`${base}/api/clients/${client}/legals/${legal}/timecardData?startDate=${start}&endDate=${end}&pageSize=${PAGE_SIZE}&page=${page}`) }
      catch (e) { if (isEndOf404(e, page)) break; throw e }
      const results = (d.results ?? []) as Any[]
      if (results.length === 0) break
      for (const r of results) {
        if (isSalaried(r)) continue
        const number = String(r.employeeNumber ?? r.employeeId ?? '')
        const empId = String(r.employeeId ?? '')
        const name = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').trim() || number
        for (const tc of r.timecardData ?? []) {
          const loc = (tc.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
          const sLabel = siteLabel(String(loc))
          if (!companyMode && sLabel !== targetSite) continue
          for (const p of tc.payItems ?? []) {
            const hrs = Number(p.payItemHours) || 0
            if (!hrs) continue
            if (isPTO(String(p.payItemName ?? ''), String(p.payItemCode ?? ''))) continue
            const e = emps.get(number) ?? { number, empId, name, hours: 0, siteHours: {} }
            e.hours += hrs
            e.siteHours[sLabel] = (e.siteHours[sLabel] ?? 0) + hrs
            emps.set(number, e)
          }
        }
      }
    }

    // Resolve each employee's site and, in company mode, drop excluded (NM) staff.
    let excludedEmployees = 0
    const employees: Array<{ number: string; name: string; hours: number; site: string }> = []
    for (const e of emps.values()) {
      const rosterSite = siteByKey.get(e.number) ?? (e.empId ? siteByKey.get('id:' + e.empId) : undefined) ?? ''
      const dominant = Object.entries(e.siteHours).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unassigned'
      const site = rosterSite && rosterSite !== 'Unassigned' ? rosterSite : dominant
      if (companyMode && excludeSet.has(site)) { excludedEmployees++; continue }
      const hours = Math.round(e.hours * 100) / 100
      if (hours > 0) employees.push({ number: e.number, name: e.name, hours, site })
    }
    employees.sort((a, b) => b.hours - a.hours)
    const totalHours = Math.round(employees.reduce((a, e) => a + e.hours, 0) * 100) / 100
    return json({
      ok: true,
      scope: companyMode ? 'company' : targetSite,
      excludedSites: [...excludeSet],
      employees,
      totalHours,
      days,
      salariedExcluded: salaried.size,
      excludedEmployees,
      rosterError,
    }, 200, origin)
  } catch (e) {
    return json({ error: 'fetch_failed', message: e instanceof Error ? e.message : String(e) }, 500, origin)
  }
})
