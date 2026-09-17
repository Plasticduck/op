// isolved-labor — Supabase Edge Function (Deno).
// Rolls up iSolved labor for a date range by site, pay type, and employee, with
// an ESTIMATED labor cost in dollars. Two modes (body.includeSalaried):
//   - all-in (default): hourly staff costed from timecard punches (rate x hours,
//     OT 1.5x); ACTIVE salaried staff costed from the roster instead — their
//     salary allocated to the range (annual / 365 x days) and assigned to their
//     iSolved work location — so Corporate and salaried overhead are included
//     even though salaried employees don't punch a clock.
//   - timecard only (includeSalaried=false): everyone costed from punches.
// This is a base-rate estimate, NOT the payroll gross (no employer taxes/
// benefits, differentials, bonuses, retro pay, or mid-period rate changes; rates
// are current). Credentials live in secrets; only rate/name fields (never SSN/
// DOB) leave the function. Restricted to a single admin (kevan@washlyfe.com).

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any
const ADMIN_EMAIL = 'kevan@washlyfe.com'
const FT_YEAR_HOURS = 2080
const OT_MULTIPLIER = 1.5

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

// Timecard "Location" labor codes: NN -> MWNN, COR -> Corporate, SPO -> Spotless.
function siteLabel(code: string): string {
  if (!code) return 'Unassigned'
  if (/^\d+$/.test(code)) return 'MW' + code.padStart(2, '0')
  const u = code.toUpperCase()
  if (u === 'COR') return 'Corporate'
  if (u === 'SPO') return 'Spotless'
  return code
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
// Effective hourly rate for costing hourly staff: base rate, else derived.
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

  let body: { startDate?: string; endDate?: string; includeSalaried?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }
  const re = /^\d{4}-\d{2}-\d{2}$/
  const { startDate, endDate } = body
  const includeSalaried = body.includeSalaried !== false // default all-in
  if (!startDate || !endDate || !re.test(startDate) || !re.test(endDate)) {
    return json({ error: 'bad_request', message: 'startDate and endDate (YYYY-MM-DD) are required.' }, 400, origin)
  }
  const days = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1)

  type Site = { code: string; site: string; total: number; cost: number; byType: Record<string, number>; emps: Set<string> }
  type Emp = { number: string; name: string; payType: string; rate: number; rated: boolean; total: number; cost: number; byType: Record<string, number>; sites: Set<string> }

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

    // 1) Employee roster: rate lookup for timecard costing + the active-salaried
    //    list for overhead costing. Only rate/name/location fields are kept.
    const rateByKey = new Map<string, { rate: number; payType: string }>()
    const roster: Array<{ number: string; name: string; payType: string; rate: number; annual: number; site: string }> = []
    let empUrl = `${base}/api/clients/${client}/legals/${legal}/employees?pageSize=200&page=1`
    let ep = 0
    while (empUrl && ep < 200) {
      const d = await getJson(empUrl)
      ep++
      for (const e of d.results ?? []) {
        const payType = String(e.payType ?? '')
        const rec = { rate: effRate(e), payType }
        if (e.employeeNumber != null) rateByKey.set(String(e.employeeNumber), rec)
        if (e.id != null) rateByKey.set('id:' + String(e.id), rec)
        if (includeSalaried && String(e.employmentStatus) === 'Active') {
          const na = e.nameAddress ?? {}
          const name = [na.firstName, na.lastName].filter(Boolean).join(' ').trim() || String(e.employeeNumber ?? '')
          roster.push({ number: String(e.employeeNumber ?? e.id ?? ''), name, payType, rate: rec.rate, annual: annualSalaryOf(e), site: siteFromWorkLocation(String(e.workLocation ?? '')) })
        }
      }
      empUrl = d.nextPageUrl ?? ''
    }

    const sitesMap = new Map<string, Site>()
    const empsMap = new Map<string, Emp>()
    const typeTotals: Record<string, number> = {}
    let grandHours = 0
    let grandCost = 0
    const unratedEmps = new Set<string>()
    let unratedHours = 0
    const siteOf = (label: string): Site => {
      let s = sitesMap.get(label)
      if (!s) { s = { code: '', site: label, total: 0, cost: 0, byType: {}, emps: new Set() }; sitesMap.set(label, s) }
      return s
    }

    // 2) Timecards -> hourly (and, in timecard-only mode, salaried) cost.
    let pageUrl = `${base}/api/clients/${client}/legals/${legal}/timecardData?startDate=${startDate}&endDate=${endDate}&pageSize=200&page=1`
    let pages = 0
    while (pageUrl && pages < 200) {
      const d = await getJson(pageUrl)
      pages++
      for (const r of d.results ?? []) {
        const empId = r.employeeId as number
        const empNum = String(r.employeeNumber ?? empId ?? '')
        const rr = rateByKey.get(empNum) ?? rateByKey.get('id:' + String(empId)) ?? { rate: 0, payType: '' }
        // In all-in mode salaried are costed from the roster instead of punches.
        if (includeSalaried && rr.payType === 'Salary') continue
        const name = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').trim() || empNum
        let emp = empsMap.get(empNum)
        if (!emp) {
          emp = { number: empNum, name, payType: rr.payType, rate: rr.rate, rated: rr.rate > 0, total: 0, cost: 0, byType: {}, sites: new Set() }
          empsMap.set(empNum, emp)
        }
        for (const t of r.timecardData ?? []) {
          const loc = (t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
          const site = siteOf(siteLabel(String(loc)))
          site.emps.add(empNum)
          for (const p of t.payItems ?? []) {
            const hrs = Number(p.payItemHours) || 0
            if (!hrs) continue
            const type = String(p.payItemName || p.payItemCode || 'Other')
            const cost = rr.rate * hrs * (/overtime/i.test(type) ? OT_MULTIPLIER : 1)
            site.total += hrs; site.cost += cost; site.byType[type] = (site.byType[type] || 0) + hrs
            emp.total += hrs; emp.cost += cost; emp.byType[type] = (emp.byType[type] || 0) + hrs; emp.sites.add(site.site)
            typeTotals[type] = (typeTotals[type] || 0) + hrs
            grandHours += hrs; grandCost += cost
            if (rr.rate <= 0) { unratedEmps.add(empNum); unratedHours += hrs }
          }
        }
      }
      pageUrl = d.nextPageUrl ?? ''
    }

    // 3) Salaried overhead (all-in): allocate each active salaried person's salary
    //    across the range and assign it to their work-location site. Hours are a
    //    full-time-equivalent estimate so blended $/hr stays sensible.
    if (includeSalaried) {
      const ftHours = (FT_YEAR_HOURS / 365) * days
      for (const s of roster) {
        if (s.payType === 'Salary') {
          const cost = (s.annual / 365) * days
          const rate = s.annual > 0 ? s.annual / FT_YEAR_HOURS : 0
          const site = siteOf(s.site)
          site.emps.add(s.number)
          site.total += ftHours; site.cost += cost; site.byType['Salaried'] = (site.byType['Salaried'] || 0) + ftHours
          let emp = empsMap.get(s.number)
          if (!emp) { emp = { number: s.number, name: s.name, payType: 'Salary', rate, rated: s.annual > 0, total: 0, cost: 0, byType: {}, sites: new Set() }; empsMap.set(s.number, emp) }
          emp.total += ftHours; emp.cost += cost; emp.byType['Salaried'] = (emp.byType['Salaried'] || 0) + ftHours; emp.sites.add(site.site)
          typeTotals['Salaried'] = (typeTotals['Salaried'] || 0) + ftHours
          grandHours += ftHours; grandCost += cost
          if (s.annual <= 0) { unratedEmps.add(s.number); unratedHours += ftHours }
        } else if (!empsMap.has(s.number)) {
          // Active hourly who did not punch in this range: list at their home site
          // with no worked hours ($0) so the active roster is complete.
          const site = siteOf(s.site)
          site.emps.add(s.number)
          empsMap.set(s.number, { number: s.number, name: s.name, payType: 'Hourly', rate: s.rate, rated: s.rate > 0, total: 0, cost: 0, byType: {}, sites: new Set([s.site]) })
        }
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100
    const roundRec = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))
    const payTypes = Object.keys(typeTotals).sort()
    const sites = [...sitesMap.values()]
      .map((s) => ({ code: s.code, site: s.site, totalHours: round(s.total), cost: round(s.cost), byPayType: roundRec(s.byType), employees: s.emps.size }))
      .sort((a, b) => a.site.localeCompare(b.site, undefined, { numeric: true }))
    const employees = [...empsMap.values()]
      .map((e) => ({ employeeNumber: e.number, name: e.name, payType: e.payType, rate: round(e.rate), rated: e.rated, totalHours: round(e.total), cost: round(e.cost), byPayType: roundRec(e.byType), sites: [...e.sites].sort() }))
      .sort((a, b) => b.cost - a.cost)

    return json(
      {
        range: { startDate, endDate },
        includeSalaried,
        payTypes,
        sites,
        employees,
        totals: {
          totalHours: round(grandHours),
          totalCost: round(grandCost),
          byPayType: roundRec(typeTotals),
          employees: empsMap.size,
          sites: sitesMap.size,
          unratedEmployees: unratedEmps.size,
          unratedHours: round(unratedHours),
        },
        assumptions: {
          otMultiplier: OT_MULTIPLIER,
          salariedBasis: includeSalaried ? 'active salaried costed from roster: annual / 365 x days, FT-equivalent hours' : 'salaried costed from timecard punches',
          days,
          note: 'Base-rate estimate, not payroll gross.',
        },
      },
      200,
      origin,
    )
  } catch (e) {
    return json({ error: 'isolved_error', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
