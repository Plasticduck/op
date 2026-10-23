// isolved-labor — Supabase Edge Function (Deno).
// Rolls up iSolved labor for a date range by site, pay type, and employee, with
// an ESTIMATED labor cost in dollars. Hourly staff are costed from timecard
// punches (rate x hours, OT 1.5x); ACTIVE salaried staff are costed from the
// roster instead — their salary allocated to the range (annual / 365 x days) and
// assigned to their iSolved work location — since salaried employees don't punch
// a clock. Which salaried are included is set by body.salariedScope:
//   - 'exclude-corporate' (default): hourly + salaried EXCEPT Corporate salaried
//     (the operational "Labor Data" view; Corporate salaried is overhead shown
//     only on the Salaried Labor page).
//   - 'none': hourly only, no salaried at all (Labor Data with salaried hidden).
//   - 'only': salaried only, ALL sites including Corporate; no hourly (the
//     Salaried Labor page).
// This is a base-rate estimate, NOT the payroll gross (no employer taxes/
// benefits, differentials, bonuses, retro pay, or mid-period rate changes; rates
// are current). Credentials live in secrets; only rate/name fields (never SSN/
// DOB) leave the function. Restricted to an allowlist (kevan@washlyfe.com +
// lkeith@mighty-wash.com); the salaried-only view stays limited to kevan.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any
const SUPER_ADMIN = 'kevan@washlyfe.com'
// Who may pull Labor Data. The salaried-only view stays limited to SUPER_ADMIN.
const LABOR_DATA_EMAILS = new Set(['kevan@washlyfe.com', 'lkeith@mighty-wash.com'])
const FT_YEAR_HOURS = 2080
const OT_MULTIPLIER = 1.5
// When the range includes today, each site also reports how many people are on
// the clock right now (a headcount only; hours stay paid hours). Same open-punch
// rules as the On the Clock view; a punch open longer than this is treated as a
// forgotten clock-out, not someone working.
const ON_CLOCK_MAX_H = 16
// Central "now" as a naive ISO string, comparable to iSolved effective times.
function centralNowIso(): string {
  const p: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date())) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`
}
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}
const diffHours = (fromIso: string, toIso: string): number => (Date.parse(toIso + 'Z') - Date.parse(fromIso + 'Z')) / 3600_000
const isMidnight = (iso: string): boolean => /T00:00:00$/.test(iso)

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

// Specific salaried staff to omit from the operational Labor Data view (they
// remain on the Salaried Labor page). Matched loosely on name so a Murry/Murray
// spelling or a middle initial still hits. Per request 2026-09-25.
function isExcludedFromLaborData(name: string): boolean {
  const n = name.toLowerCase()
  return n.includes('heather') && n.includes('mur')
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

// --- Region scoping ---------------------------------------------------------
// Regions (and their sites) live in Company settings; each region's Regional
// Manager is effective-dated by quarter (latest entry on/before the quarter
// wins). Labor Data admins see every site and may pick a region; a Regional
// Manager is limited to the region(s) they manage.
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
function quarterStart(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return y + '-' + String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0') + '-01'
}
function effectiveManager(val: unknown, quarter: string): string | null {
  if (typeof val === 'string') return val.trim() || null
  if (!val || typeof val !== 'object') return null
  const keys = Object.keys(val as Record<string, string>).filter((k) => k <= quarter).sort()
  const name = keys.length ? (val as Record<string, string>)[keys[keys.length - 1]] : null
  return name?.trim() || null
}
type LaborAccess = { admin: boolean; rmRegions: string[]; regions: Map<string, Set<string>> }
async function laborAccess(svc: Any, email: string): Promise<LaborAccess> {
  const { data: acct } = await svc.from('accounts').select('company_settings').eq('id', MW_ACCOUNT).single()
  const settings = (acct?.company_settings ?? {}) as Any
  const { data: locs } = await svc.from('locations').select('id, name').eq('account_id', MW_ACCOUNT)
  const nameById = new Map(((locs ?? []) as { id: string; name: string }[]).map((l) => [l.id, String(l.name).trim()]))
  const regions = new Map<string, Set<string>>()
  for (const r of (Array.isArray(settings.regions) ? settings.regions : []) as Array<{ name?: string; siteIds?: string[] }>) {
    const sites = new Set((r.siteIds ?? []).map((id) => nameById.get(id)).filter((n): n is string => !!n))
    if (r.name && sites.size) regions.set(r.name, sites)
  }
  if (LABOR_DATA_EMAILS.has(email)) return { admin: true, rmRegions: [], regions }
  const { data: u } = await svc.from('users').select('name, role_category').eq('account_id', MW_ACCOUNT).ilike('email', email).maybeSingle()
  if (!u || u.role_category !== 'regional_manager') return { admin: false, rmRegions: [], regions }
  const quarter = quarterStart(centralNowIso().slice(0, 10))
  const me = String(u.name ?? '').trim().toLowerCase()
  const managers = (settings.regionalManagers ?? {}) as Record<string, unknown>
  const rmRegions = [...regions.keys()].filter((r) => (effectiveManager(managers[r], quarter) ?? '').toLowerCase() === me)
  return { admin: false, rmRegions, regions }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // region: an admin's region pick. asUser: service-role only, to preview what a
  // given account (e.g. a Regional Manager) would see.
  let body: { startDate?: string; endDate?: string; salariedScope?: string; region?: string; asUser?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  // The service role (server-side jobs / verification) acts as the super admin;
  // otherwise the signed-in user must be on the allowlist.
  let email: string
  if (jwtRole(auth) === 'service_role') {
    email = body.asUser ? String(body.asUser).trim().toLowerCase() : SUPER_ADMIN
  } else {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    email = (u.user.email ?? '').toLowerCase()
  }
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const access = await laborAccess(svc, email)
  if (!access.admin && !access.rmRegions.length) {
    return json({ error: 'forbidden', message: 'Labor Data is limited to approved admins and Regional Managers with an assigned region (signed in as ' + (email || 'unknown') + ').' }, 403, origin)
  }
  // Sites in view: an RM's own region(s); an admin's chosen region, or every site.
  const scopeRegions = access.admin
    ? (body.region && access.regions.has(body.region) ? [body.region] : [])
    : access.rmRegions
  const allowedSites = scopeRegions.length ? new Set(scopeRegions.flatMap((r) => [...(access.regions.get(r) ?? [])])) : null
  const siteOk = (label: string) => !allowedSites || allowedSites.has(label)

  const base = Deno.env.get('ISOLVED_BASE_URL')
  const cid = Deno.env.get('ISOLVED_CLIENT_ID')
  const secret = Deno.env.get('ISOLVED_API_SECRET')
  const client = Deno.env.get('ISOLVED_CLIENT')
  const legal = Deno.env.get('ISOLVED_LEGAL')
  if (!base || !cid || !secret || !client || !legal) {
    return json({ error: 'no_key', message: 'iSolved is not configured.' }, 503, origin)
  }

  const re = /^\d{4}-\d{2}-\d{2}$/
  const { startDate, endDate } = body
  // Which salaried staff to include. Default is the operational Labor Data view.
  // Regional Managers only ever get hourly staff: no salaried hours or estimated
  // salary cost (which would expose their GMs' pay) and never the salaried-only view.
  const scope: 'exclude-corporate' | 'none' | 'only' = !access.admin
    ? 'none'
    : body.salariedScope === 'none' || body.salariedScope === 'only' ? body.salariedScope : 'exclude-corporate'
  // The salaried-only view (Salaried Labor page) stays limited to the super-admin;
  // other allowed emails only get the operational Labor Data views.
  if (scope === 'only' && email !== SUPER_ADMIN) {
    return json({ error: 'forbidden', message: 'Salaried labor is restricted.' }, 403, origin)
  }
  if (!startDate || !endDate || !re.test(startDate) || !re.test(endDate)) {
    return json({ error: 'bad_request', message: 'startDate and endDate (YYYY-MM-DD) are required.' }, 400, origin)
  }
  const days = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1)

  type Site = { code: string; site: string; total: number; cost: number; byType: Record<string, number>; emps: Set<string>; onClock: Set<string> }
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
    // The iSolved API is 0-INDEXED and its nextPageUrl is unreliable at large page
    // sizes (starting at page=1 silently drops the entire first page). Page from 0
    // with a modest size until an empty page.
    const PAGE_SIZE = 100
    for (let page = 0; page < 100; page++) {
      const d = await getJson(`${base}/api/clients/${client}/legals/${legal}/employees?pageSize=${PAGE_SIZE}&page=${page}`)
      const results = d.results ?? []
      if (results.length === 0) break
      for (const e of results) {
        const payType = String(e.payType ?? '')
        const rec = { rate: effRate(e), payType }
        if (e.employeeNumber != null) rateByKey.set(String(e.employeeNumber), rec)
        if (e.id != null) rateByKey.set('id:' + String(e.id), rec)
        if (String(e.employmentStatus) === 'Active') {
          const na = e.nameAddress ?? {}
          const name = [na.firstName, na.lastName].filter(Boolean).join(' ').trim() || String(e.employeeNumber ?? '')
          roster.push({ number: String(e.employeeNumber ?? e.id ?? ''), name, payType, rate: rec.rate, annual: annualSalaryOf(e), site: siteFromWorkLocation(String(e.workLocation ?? '')) })
        }
      }
    }

    // Salaried staff whose home site is Corporate: overhead, kept off Labor Data.
    const corporateSalaried = new Set(roster.filter((s) => s.payType === 'Salary' && s.site === 'Corporate').map((s) => s.number))
    const sitesMap = new Map<string, Site>()
    const empsMap = new Map<string, Emp>()
    const typeTotals: Record<string, number> = {}
    let grandHours = 0
    let grandCost = 0
    const unratedEmps = new Set<string>()
    let unratedHours = 0
    const siteOf = (label: string): Site => {
      let s = sitesMap.get(label)
      if (!s) { s = { code: '', site: label, total: 0, cost: 0, byType: {}, emps: new Set(), onClock: new Set() }; sitesMap.set(label, s) }
      return s
    }

    // 2) Timecards -> hourly cost. Salaried are always costed from the roster
    //    (step 3), never from punches. Skipped entirely on the salaried-only view.
    const nowIso = centralNowIso()
    const includesToday = endDate >= nowIso.slice(0, 10)
    const onClockAll = new Set<string>()
    // Sites where this person is on the clock right now: an open punch (no genuine
    // out, started after their latest clock-out) that's been open no longer than
    // ON_CLOCK_MAX_H. Same open-punch rules as the On the Clock view.
    // Open shifts right now (site + hours worked so far, clock-in -> now). These
    // count toward Total hrs as time actually worked; they become paid hours
    // once the person clocks out.
    const openShifts = (r: Any): { label: string; hours: number }[] => {
      if (!includesToday) return []
      let latestOut = ''
      for (const t of r.timecardData ?? []) {
        const i = String(t.inPunchDateTimeEffective ?? '')
        const o = String(t.outPunchDateTimeEffective ?? '')
        if (o && (t.outPunchId != null || o > i) && o > latestOut) latestOut = o
      }
      const out: { label: string; hours: number }[] = []
      for (const t of r.timecardData ?? []) {
        const inEff = String(t.inPunchDateTimeEffective ?? '')
        const outEff = String(t.outPunchDateTimeEffective ?? '')
        const hasOut = !!outEff && (t.outPunchId != null || outEff > inEff)
        const open = !!inEff && !isMidnight(inEff) && !hasOut && (!latestOut || inEff > latestOut)
        const elapsed = open ? diffHours(inEff, nowIso) : -1
        if (open && elapsed >= 0 && elapsed <= ON_CLOCK_MAX_H) {
          out.push({ label: siteLabel(String((t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? '')), hours: elapsed })
        }
      }
      return out
    }
    const markOnClock = (r: Any, empNum: string) => {
      for (const { label } of openShifts(r)) { if (!siteOk(label)) continue; siteOf(label).onClock.add(empNum); onClockAll.add(empNum) }
    }
    // Add an open shift's time so far to the person's regular hours.
    const addOpenTime = (r: Any, emp: Emp, empNum: string, type: string, rate: number, skip: (label: string) => boolean) => {
      for (const { label, hours } of openShifts(r)) {
        if (skip(label) || !siteOk(label) || hours <= 0) continue
        const site = siteOf(label)
        const cost = rate * hours
        site.emps.add(empNum)
        site.total += hours; site.cost += cost; site.byType[type] = (site.byType[type] || 0) + hours
        emp.total += hours; emp.cost += cost; emp.byType[type] = (emp.byType[type] || 0) + hours; emp.sites.add(label)
        typeTotals[type] = (typeTotals[type] || 0) + hours
        grandHours += hours; grandCost += cost
      }
    }
    const isPtoItem = (p: Any) => /pto/i.test(String(p.payItemName ?? '')) || String(p.payItemCode) === '03'
    for (let page = 0; scope !== 'only' && page < 200; page++) {
      const d = await getJson(`${base}/api/clients/${client}/legals/${legal}/timecardData?startDate=${startDate}&endDate=${endDate}&pageSize=${PAGE_SIZE}&page=${page}`)
      const results = d.results ?? []
      if (results.length === 0) break
      for (const r of results) {
        const empId = r.employeeId as number
        const empNum = String(r.employeeNumber ?? empId ?? '')
        const rr = rateByKey.get(empNum) ?? rateByKey.get('id:' + String(empId)) ?? { rate: 0, payType: '' }
        // Salaried are costed from the roster, not punches — but a salaried person
        // who's clocked in still counts toward On the Clock when salaried is shown.
        if (rr.payType === 'Salary') {
          if (scope !== 'none') markOnClock(r, empNum)
          // Labor Data: salaried staff clock in too, so count their ACTUAL punched
          // hours (their cost still comes from salary, in the roster pass). Same
          // exclusions as the roster pass: Corporate salaried and the named
          // exception. The salaried-only view keeps its full-time-equivalent hours.
          const sName = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').trim() || empNum
          if (scope === 'exclude-corporate' && !corporateSalaried.has(empNum) && !isExcludedFromLaborData(sName)) {
            for (const t of r.timecardData ?? []) {
              const loc = (t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
              const label = siteLabel(String(loc))
              if (label === 'Corporate' || !siteOk(label)) continue
              for (const p of t.payItems ?? []) {
                const hrs = Number(p.payItemHours) || 0
                if (!hrs) continue
                const type = isPtoItem(p) ? 'PTO' : 'Salaried'
                const worked = type === 'PTO' ? 0 : hrs // PTO isn't time worked
                const site = siteOf(label)
                site.emps.add(empNum)
                site.total += worked; site.byType[type] = (site.byType[type] || 0) + hrs
                let emp = empsMap.get(empNum)
                if (!emp) { emp = { number: empNum, name: sName, payType: 'Salary', rate: rr.rate, rated: rr.rate > 0, total: 0, cost: 0, byType: {}, sites: new Set() }; empsMap.set(empNum, emp) }
                emp.total += worked; emp.byType[type] = (emp.byType[type] || 0) + hrs; emp.sites.add(label)
                typeTotals[type] = (typeTotals[type] || 0) + hrs
                grandHours += worked
              }
            }
            // Still on the clock: time so far (no added cost; salary covers it).
            let emp = empsMap.get(empNum)
            if (!emp) { emp = { number: empNum, name: sName, payType: 'Salary', rate: rr.rate, rated: rr.rate > 0, total: 0, cost: 0, byType: {}, sites: new Set() }; empsMap.set(empNum, emp) }
            addOpenTime(r, emp, empNum, 'Salaried', 0, (label) => label === 'Corporate')
          }
          continue
        }
        markOnClock(r, empNum)
        const name = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').trim() || empNum
        let emp = empsMap.get(empNum)
        if (!emp) {
          emp = { number: empNum, name, payType: rr.payType, rate: rr.rate, rated: rr.rate > 0, total: 0, cost: 0, byType: {}, sites: new Set() }
          empsMap.set(empNum, emp)
        }
        for (const t of r.timecardData ?? []) {
          const loc = (t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
          const label = siteLabel(String(loc))
          if (!siteOk(label)) continue
          const site = siteOf(label)
          site.emps.add(empNum)
          for (const p of t.payItems ?? []) {
            const hrs = Number(p.payItemHours) || 0
            if (!hrs) continue
            const type = String(p.payItemName || p.payItemCode || 'Other')
            const cost = rr.rate * hrs * (/overtime/i.test(type) ? OT_MULTIPLIER : 1)
            // PTO is paid (counts in cost and its own column) but isn't time
            // worked, so it stays out of Total hrs.
            const worked = isPtoItem(p) ? 0 : hrs
            site.total += worked; site.cost += cost; site.byType[type] = (site.byType[type] || 0) + hrs
            emp.total += worked; emp.cost += cost; emp.byType[type] = (emp.byType[type] || 0) + hrs; emp.sites.add(site.site)
            typeTotals[type] = (typeTotals[type] || 0) + hrs
            grandHours += worked; grandCost += cost
            if (rr.rate <= 0 && worked) { unratedEmps.add(empNum); unratedHours += worked }
          }
        }
        // Still on the clock: time worked so far on the open shift.
        addOpenTime(r, emp, empNum, 'Hourly', rr.rate, () => false)
      }
    }

    // 3) Roster pass. Salaried overhead: allocate each active salaried person's
    //    salary across the range and assign it to their work-location site (hours
    //    are a full-time-equivalent estimate so blended $/hr stays sensible).
    //    Which salaried are kept depends on scope; Corporate salaried is dropped
    //    from the operational views and kept only on the salaried-only view.
    {
      const ftHours = (FT_YEAR_HOURS / 365) * days
      for (const s of roster) {
        if (!siteOk(s.site)) continue
        if (s.payType === 'Salary') {
          if (scope === 'none') continue
          if (scope === 'exclude-corporate' && s.site === 'Corporate') continue
          if (scope === 'exclude-corporate' && isExcludedFromLaborData(s.name)) continue
          const cost = (s.annual / 365) * days
          const rate = s.annual > 0 ? s.annual / FT_YEAR_HOURS : 0
          // Hours: Labor Data uses salaried staff's actual punches (added in the
          // timecard pass), so only the salaried-only view adds the FT-equivalent
          // estimate. Cost is the salary allocated to the range either way.
          const estHours = scope === 'only' ? ftHours : 0
          const site = siteOf(s.site)
          site.emps.add(s.number)
          site.total += estHours; site.cost += cost
          if (estHours) site.byType['Salaried'] = (site.byType['Salaried'] || 0) + estHours
          let emp = empsMap.get(s.number)
          if (!emp) { emp = { number: s.number, name: s.name, payType: 'Salary', rate, rated: s.annual > 0, total: 0, cost: 0, byType: {}, sites: new Set() }; empsMap.set(s.number, emp) }
          emp.total += estHours; emp.cost += cost; emp.sites.add(site.site)
          if (estHours) { emp.byType['Salaried'] = (emp.byType['Salaried'] || 0) + estHours; typeTotals['Salaried'] = (typeTotals['Salaried'] || 0) + estHours }
          grandHours += estHours; grandCost += cost
          if (s.annual <= 0) { unratedEmps.add(s.number); unratedHours += estHours }
        } else if (scope !== 'only' && !empsMap.has(s.number)) {
          // Active hourly who did not punch in this range: list at their home site
          // with no worked hours ($0) so the active roster is complete. Not shown
          // on the salaried-only view.
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
      .map((s) => ({ code: s.code, site: s.site, totalHours: round(s.total), cost: round(s.cost), byPayType: roundRec(s.byType), employees: s.emps.size, onClock: s.onClock.size }))
      .sort((a, b) => a.site.localeCompare(b.site, undefined, { numeric: true }))
    // In a region view, only people who worked (or are rostered) at its sites.
    const employees = [...empsMap.values()]
      .filter((e) => !allowedSites || [...e.sites].some((x) => allowedSites.has(x)))
      .map((e) => ({ employeeNumber: e.number, name: e.name, payType: e.payType, rate: round(e.rate), rated: e.rated, totalHours: round(e.total), cost: round(e.cost), byPayType: roundRec(e.byType), sites: [...e.sites].sort() }))
      .sort((a, b) => b.cost - a.cost)

    return json(
      {
        range: { startDate, endDate },
        includesToday,
        // Region view: the regions an admin can choose from, and what's in view
        // (locked = a Regional Manager's own region(s)).
        regions: access.admin ? [...access.regions.keys()] : scopeRegions,
        region: { names: scopeRegions, locked: !access.admin },
        salariedScope: scope,
        payTypes,
        sites,
        employees,
        totals: {
          totalHours: round(grandHours),
          totalCost: round(grandCost),
          byPayType: roundRec(typeTotals),
          employees: employees.length,
          sites: sitesMap.size,
          unratedEmployees: unratedEmps.size,
          unratedHours: round(unratedHours),
          onClock: onClockAll.size,
        },
        assumptions: {
          otMultiplier: OT_MULTIPLIER,
          salariedBasis: scope === 'none'
            ? 'salaried excluded; hourly costed from timecard punches'
            : 'active salaried costed from roster: annual / 365 x days, FT-equivalent hours',
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
