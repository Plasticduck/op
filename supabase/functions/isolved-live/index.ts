// isolved-live — Supabase Edge Function (Deno).
// Real-time labor: who is currently clocked in, broken out by site, with each
// person's hours for the current pay week. The pay week runs Sunday -> Saturday,
// so "this week" = Sunday of the current week through today (inclusive).
//
// Source: iSolved timecardData. An OPEN punch (clocked in, not out) is an entry
// with outPunchId null and a real in-time; its clock-in time is
// inPunchDateTimeEffective (Central local). Week hours = sum of payItemHours
// (paid hours, matching the Labor Data report) plus time accrued on an open punch.
//
// Auth: kevan@washlyfe.com (matches Labor Data), or the service role.
// Secrets: ISOLVED_BASE_URL, ISOLVED_CLIENT_ID, ISOLVED_API_SECRET, ISOLVED_CLIENT,
//          ISOLVED_LEGAL.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any
// Who may view live labor (matches the Labor Data page allowlist).
const LABOR_DATA_EMAILS = new Set(['kevan@washlyfe.com', 'lkeith@mighty-wash.com'])
const OPEN_ACCRUAL_CAP_H = 16 // cap in-progress time added to week totals (guards forgotten punches)
const FT_YEAR_HOURS = 2080
const OT_MULTIPLIER = 1.5

// Effective hourly rate for estimating labor cost (base rate, else derived).
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
const siteNumOf = (label: string): number => { const m = label.match(/^MW(\d+)$/); return m ? parseInt(m[1], 10) : 9999 }

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

// Timecard "Location" labor codes: NN -> MWNN, COR -> Corporate, SPO -> Spotless.
function siteLabel(code: string): string {
  if (!code) return 'Unassigned'
  if (/^\d+$/.test(code)) return 'MW' + code.padStart(2, '0')
  const u = code.toUpperCase()
  if (u === 'COR') return 'Corporate'
  if (u === 'SPO') return 'Spotless'
  return code
}

// Central-time parts for a Date (DST-safe via Intl).
function centralParts(d: Date): { date: string; iso: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value
  const hh = p.hour === '24' ? '00' : p.hour
  return { date: `${p.year}-${p.month}-${p.day}`, iso: `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}` }
}
const dowOf = (dateStr: string): number => new Date(dateStr + 'T12:00:00Z').getUTCDay() // 0=Sun
const addDays = (dateStr: string, n: number): string => new Date(new Date(dateStr + 'T00:00:00Z').getTime() + n * 86400_000).toISOString().slice(0, 10)
// Minutes between two naive Central datetime strings (same tz), in hours.
const diffHours = (fromIso: string, toIso: string): number => (Date.parse(toIso + 'Z') - Date.parse(fromIso + 'Z')) / 3600_000
const isMidnight = (iso: string): boolean => /T00:00:00$/.test(iso)
const hhmm = (iso: string): string => {
  const m = iso.match(/T(\d{2}):(\d{2})/)
  if (!m) return ''
  let h = parseInt(m[1], 10); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12
  return `${h}:${m[2]} ${ap}`
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
  if (jwtRole(auth) !== 'service_role') {
    if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    if (!LABOR_DATA_EMAILS.has((u.user.email ?? '').toLowerCase())) return json({ error: 'forbidden', message: 'Labor data is restricted to approved users.' }, 403, origin)
  }

  const base = Deno.env.get('ISOLVED_BASE_URL')
  const cid = Deno.env.get('ISOLVED_CLIENT_ID')
  const secret = Deno.env.get('ISOLVED_API_SECRET')
  const client = Deno.env.get('ISOLVED_CLIENT')
  const legal = Deno.env.get('ISOLVED_LEGAL')
  if (!base || !cid || !secret || !client || !legal) return json({ error: 'no_key', message: 'iSolved is not configured.' }, 503, origin)

  const now = new Date()
  const cNow = centralParts(now)
  const today = cNow.date
  const weekStart = addDays(today, -dowOf(today)) // Sunday of the current week

  type Emp = {
    employeeNumber: string; name: string
    onClock: boolean; clockInAt: string | null; clockInSite: string | null; elapsedHours: number
    totalWeekHours: number; totalWeekCost: number
    bySite: Map<string, { hours: number; dayHours: number; cost: number; onClock: boolean; clockInAt: string | null; elapsedHours: number }>
  }
  const emps = new Map<string, Emp>()
  const empOf = (num: string, name: string): Emp => {
    let e = emps.get(num)
    if (!e) { e = { employeeNumber: num, name, onClock: false, clockInAt: null, clockInSite: null, elapsedHours: 0, totalWeekHours: 0, totalWeekCost: 0, bySite: new Map() }; emps.set(num, e) }
    return e
  }
  const siteBucket = (e: Emp, site: string) => {
    let b = e.bySite.get(site)
    if (!b) { b = { hours: 0, dayHours: 0, cost: 0, onClock: false, clockInAt: null, elapsedHours: 0 }; e.bySite.set(site, b) }
    return b
  }

  try {
    let token = await getToken(base, cid, secret)
    const getJson = async (pageUrl: string): Promise<Any> => {
      let res = await fetch(pageUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      if (res.status === 401) { token = await getToken(base, cid, secret); res = await fetch(pageUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }) }
      if (!res.ok) throw new Error(`isolved ${res.status}`)
      return await res.json()
    }

    // The iSolved API is 0-INDEXED and its nextPageUrl is unreliable at large page
    // sizes (starting at page=1 silently drops the whole first page). Page from 0
    // with a modest size until an empty page.
    const PAGE_SIZE = 100

    // Employee roster -> hourly rate, for an ESTIMATED labor cost (base rate x
    // hours, overtime at 1.5x). Rates/names only; no SSN/DOB leaves the function.
    const rateByKey = new Map<string, number>()
    for (let page = 0; page < 100; page++) {
      const d = await getJson(`${base}/api/clients/${client}/legals/${legal}/employees?pageSize=${PAGE_SIZE}&page=${page}`)
      const results = d.results ?? []
      if (results.length === 0) break
      for (const e of results) {
        const r = effRate(e)
        if (e.employeeNumber != null) rateByKey.set(String(e.employeeNumber), r)
        if (e.id != null) rateByKey.set('id:' + String(e.id), r)
      }
    }

    for (let page = 0; page < 60; page++) {
      const d = await getJson(`${base}/api/clients/${client}/legals/${legal}/timecardData?startDate=${weekStart}&endDate=${today}&pageSize=${PAGE_SIZE}&page=${page}`)
      const results = d.results ?? []
      if (results.length === 0) break
      for (const r of results) {
        const num = String(r.employeeNumber ?? r.employeeId ?? '')
        const name = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').trim() || num
        const rate = rateByKey.get(num) ?? rateByKey.get('id:' + String(r.employeeId)) ?? 0
        const e = empOf(num, name)
        for (const t of r.timecardData ?? []) {
          const loc = (t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
          const site = siteLabel(String(loc))
          const bucket = siteBucket(e, site)
          const isToday = String(t.timecardDate ?? '').slice(0, 10) === today
          // Paid hours + estimated cost for completed/partial entries.
          let hrs = 0, cost = 0
          for (const p of t.payItems ?? []) {
            const h = Number(p.payItemHours) || 0
            hrs += h
            const type = String(p.payItemName || p.payItemCode || '')
            cost += rate * h * (/overtime/i.test(type) ? OT_MULTIPLIER : 1)
          }
          bucket.hours += hrs; bucket.cost += cost
          e.totalWeekHours += hrs; e.totalWeekCost += cost
          if (isToday) bucket.dayHours += hrs
          // Open punch = currently clocked in (real in-time, no out).
          const inEff = String(t.inPunchDateTimeEffective ?? '')
          const open = (t.outPunchId == null || !t.outPunchDateTimeEffective) && inEff && !isMidnight(inEff)
          if (open) {
            const elapsed = Math.max(0, diffHours(inEff, cNow.iso))
            const accr = Math.min(elapsed, OPEN_ACCRUAL_CAP_H)
            bucket.onClock = true; bucket.clockInAt = inEff; bucket.elapsedHours = Math.round(elapsed * 100) / 100
            bucket.hours += accr; e.totalWeekHours += accr
            bucket.cost += rate * accr; e.totalWeekCost += rate * accr
            if (isToday) bucket.dayHours += accr
            // An employee's headline clock-in = their most recent open punch.
            if (!e.clockInAt || inEff > e.clockInAt) { e.onClock = true; e.clockInAt = inEff; e.clockInSite = site; e.elapsedHours = Math.round(elapsed * 100) / 100 }
          }
        }
      }
    }
  } catch (e) {
    return json({ error: 'isolved_error', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }

  // Build per-site breakout.
  type SiteEmp = { employeeNumber: string; name: string; onClock: boolean; clockInAt: string | null; clockInTime: string | null; elapsedHours: number; siteDayHours: number; siteWeekHours: number; siteWeekCost: number; totalWeekHours: number }
  const sitesMap = new Map<string, { site: string; clockedIn: number; weekHours: number; weekCost: number; employees: SiteEmp[] }>()
  const round = (n: number) => Math.round(n * 100) / 100
  for (const e of emps.values()) {
    for (const [site, b] of e.bySite) {
      if (b.hours <= 0 && !b.onClock) continue
      let s = sitesMap.get(site)
      if (!s) { s = { site, clockedIn: 0, weekHours: 0, weekCost: 0, employees: [] }; sitesMap.set(site, s) }
      s.employees.push({
        employeeNumber: e.employeeNumber, name: e.name,
        onClock: b.onClock, clockInAt: b.clockInAt, clockInTime: b.clockInAt ? hhmm(b.clockInAt) : null,
        elapsedHours: round(b.elapsedHours), siteDayHours: round(b.dayHours), siteWeekHours: round(b.hours), siteWeekCost: round(b.cost), totalWeekHours: round(e.totalWeekHours),
      })
      s.weekHours += b.hours
      s.weekCost += b.cost
      if (b.onClock) s.clockedIn += 1
    }
  }
  const sites = [...sitesMap.values()].map((s) => ({
    site: s.site, clockedIn: s.clockedIn, weekHours: round(s.weekHours), weekCost: round(s.weekCost), employeeCount: s.employees.length,
    employees: s.employees.sort((a, b) => (Number(b.onClock) - Number(a.onClock)) || (b.siteWeekHours - a.siteWeekHours)),
  })).sort((a, b) => (siteNumOf(a.site) - siteNumOf(b.site)) || a.site.localeCompare(b.site, undefined, { numeric: true }))

  const totalClockedIn = [...emps.values()].filter((e) => e.onClock).length
  return json({
    ok: true,
    generatedAt: now.toISOString(),
    central: { now: cNow.iso, today, weekStart, weekLabel: `${weekStart} to ${addDays(weekStart, 6)}` },
    totals: {
      clockedIn: totalClockedIn,
      weekHours: round([...emps.values()].reduce((s, e) => s + e.totalWeekHours, 0)),
      weekCost: round([...emps.values()].reduce((s, e) => s + e.totalWeekCost, 0)),
      employees: emps.size,
      sites: sites.length,
    },
    sites,
  }, 200, origin)
})
