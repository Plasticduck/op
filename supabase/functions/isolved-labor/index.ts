// isolved-labor — Supabase Edge Function (Deno).
// Pulls iSolved timecard data for a date range and rolls it up by site, pay
// type, and employee. Credentials (OAuth2 client-credentials) live in secrets;
// the browser never sees them. Restricted to a single admin (kevan@washlyfe.com)
// since it exposes payroll hours.
// Secrets: ISOLVED_BASE_URL, ISOLVED_CLIENT_ID, ISOLVED_API_SECRET,
//   ISOLVED_CLIENT (numeric client id), ISOLVED_LEGAL (numeric legal id).

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any
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
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

// iSolved "Location" labor codes map to Operator sites: NN -> MWNN, COR ->
// Corporate, SPO -> Spotless (same scheme as the invoice classes).
function siteLabel(code: string): string {
  if (!code) return 'Unassigned'
  if (/^\d+$/.test(code)) return 'MW' + code.padStart(2, '0')
  const u = code.toUpperCase()
  if (u === 'COR') return 'Corporate'
  if (u === 'SPO') return 'Spotless'
  return code
}

async function getToken(base: string, cid: string, secret: string): Promise<string> {
  const res = await fetch(base + '/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(cid + ':' + secret),
    },
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

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
  if ((u.user.email ?? '').toLowerCase() !== ADMIN_EMAIL) {
    return json({ error: 'forbidden', message: 'Payroll labor is restricted.' }, 403, origin)
  }

  const base = Deno.env.get('ISOLVED_BASE_URL')
  const cid = Deno.env.get('ISOLVED_CLIENT_ID')
  const secret = Deno.env.get('ISOLVED_API_SECRET')
  const client = Deno.env.get('ISOLVED_CLIENT')
  const legal = Deno.env.get('ISOLVED_LEGAL')
  if (!base || !cid || !secret || !client || !legal) {
    return json({ error: 'no_key', message: 'iSolved is not configured.' }, 503, origin)
  }

  let body: { startDate?: string; endDate?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }
  const re = /^\d{4}-\d{2}-\d{2}$/
  const { startDate, endDate } = body
  if (!startDate || !endDate || !re.test(startDate) || !re.test(endDate)) {
    return json({ error: 'bad_request', message: 'startDate and endDate (YYYY-MM-DD) are required.' }, 400, origin)
  }

  try {
    let token = await getToken(base, cid, secret)

    const sitesMap = new Map<string, { code: string; site: string; total: number; byType: Record<string, number>; emps: Set<number> }>()
    const empsMap = new Map<string, { number: string; name: string; total: number; byType: Record<string, number>; sites: Set<string> }>()
    const typeTotals: Record<string, number> = {}
    let grand = 0

    let pageUrl = `${base}/api/clients/${client}/legals/${legal}/timecardData?startDate=${startDate}&endDate=${endDate}&pageSize=200&page=1`
    let pages = 0
    while (pageUrl && pages < 200) {
      let res = await fetch(pageUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      if (res.status === 401) {
        // Token is short-lived (~5 min); refresh once mid-pagination.
        token = await getToken(base, cid, secret)
        res = await fetch(pageUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      }
      if (!res.ok) return json({ error: 'isolved_error', message: `timecard ${res.status}` }, 502, origin)
      const d = (await res.json()) as Any
      pages++
      for (const r of d.results ?? []) {
        const empId = r.employeeId as number
        const empNum = String(r.employeeNumber ?? empId ?? '')
        const name = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').trim() || empNum
        let emp = empsMap.get(empNum)
        if (!emp) {
          emp = { number: empNum, name, total: 0, byType: {}, sites: new Set() }
          empsMap.set(empNum, emp)
        }
        for (const t of r.timecardData ?? []) {
          const loc = (t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
          const label = siteLabel(String(loc))
          let site = sitesMap.get(label)
          if (!site) {
            site = { code: String(loc), site: label, total: 0, byType: {}, emps: new Set() }
            sitesMap.set(label, site)
          }
          for (const p of t.payItems ?? []) {
            const hrs = Number(p.payItemHours) || 0
            if (!hrs) continue
            const type = String(p.payItemName || p.payItemCode || 'Other')
            site.total += hrs
            site.byType[type] = (site.byType[type] || 0) + hrs
            site.emps.add(empId)
            emp.total += hrs
            emp.byType[type] = (emp.byType[type] || 0) + hrs
            emp.sites.add(label)
            typeTotals[type] = (typeTotals[type] || 0) + hrs
            grand += hrs
          }
        }
      }
      pageUrl = d.nextPageUrl ?? ''
    }

    const round = (n: number) => Math.round(n * 100) / 100
    const roundRec = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))
    const payTypes = Object.keys(typeTotals).sort()
    const sites = [...sitesMap.values()]
      .map((s) => ({ code: s.code, site: s.site, totalHours: round(s.total), byPayType: roundRec(s.byType), employees: s.emps.size }))
      .sort((a, b) => a.site.localeCompare(b.site, undefined, { numeric: true }))
    const employees = [...empsMap.values()]
      .map((e) => ({ employeeNumber: e.number, name: e.name, totalHours: round(e.total), byPayType: roundRec(e.byType), sites: [...e.sites].sort() }))
      .sort((a, b) => b.totalHours - a.totalHours)

    return json(
      {
        range: { startDate, endDate },
        payTypes,
        sites,
        employees,
        totals: { totalHours: round(grand), byPayType: roundRec(typeTotals), employees: empsMap.size, sites: sitesMap.size },
      },
      200,
      origin,
    )
  } catch (e) {
    return json({ error: 'isolved_error', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
