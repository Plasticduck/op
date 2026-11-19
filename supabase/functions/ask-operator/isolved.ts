// Operator AI's iSolved tools: labor hours and estimated cost for a date range
// (the isolved-labor function, behind Labor Data / Salaried Labor) and who is on
// the clock now (isolved-live, behind On the Clock), both pulled live from the
// iSolved API. They're called with the signed-in person's own login, so each
// function's access rules decide what comes back, exactly as on those pages.
// isolved-live returns every site and the page narrows a Regional Manager to
// their region, so that narrowing is done here before the model sees anything.
// Results are trimmed to what a question needs (a full pull is 70-120 KB).

import type Anthropic from 'npm:@anthropic-ai/sdk'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const ISOLVED_LABOR_TOOL: Anthropic.Tool = {
  name: 'isolved_labor',
  description:
    "Labor hours and estimated labor cost from iSolved payroll timecards for a date range: totals, each site, and employees (hours, pay type, rate, cost). Hourly staff are costed from their punches (overtime 1.5x); salaried staff from annual salary spread over the days. It is a base-rate estimate, not payroll gross (no taxes, benefits or bonuses). PTO hours are listed separately and not costed. Paid hours only: a shift still open has no hours yet (use isolved_on_the_clock for right now). salaried: 'exclude' = hourly only (default); 'include' = hourly plus the wash sites' salaried staff (Corporate salaried left out); 'only' = salaried staff only, every site including Corporate. site: one site (MW05, 5, Corporate, Spotless) to list all of its employees. employee: part of a name to find people. region: a region name, for people who can see every site. What each person may see is decided by iSolved access rules: some see every site, Regional Managers only their own region's hourly staff, others nothing.",
  input_schema: {
    type: 'object',
    properties: {
      start: { type: 'string', description: 'Start date YYYY-MM-DD.' },
      end: { type: 'string', description: 'End date YYYY-MM-DD (today at the latest).' },
      salaried: { type: 'string', enum: ['exclude', 'include', 'only'], description: "Which salaried staff to count (default 'exclude')." },
      site: { type: 'string', description: 'Optional site to list all of its employees, e.g. "MW05".' },
      employee: { type: 'string', description: 'Optional part of an employee name.' },
      region: { type: 'string', description: 'Optional region name (e.g. "Lubbock Region"), for people who can see every site.' },
    },
    required: ['start', 'end'],
  },
}

export const ISOLVED_ON_CLOCK_TOOL: Anthropic.Tool = {
  name: 'isolved_on_the_clock',
  description:
    "Live from iSolved: who is clocked in right now at each site (clock-in time, hours so far), plus this pay week's hours, PTO and estimated cost per site (pay weeks run Monday to Sunday, Central time). Hourly cost is from punches so far (overtime 1.5x); salaried cost is each site's active salaried staff at annual salary / 52. Omit site for every site the user can see (each site's totals and who is on the clock); pass site (MW05, 5, Spotless) for that site's full employee list with day and week hours. Same access as the On the Clock page.",
  input_schema: {
    type: 'object',
    properties: {
      site: { type: 'string', description: 'Optional site for its full employee list, e.g. "MW05".' },
    },
  },
}

export const ISOLVED_NOTE =
  'iSolved (payroll and time clock): isolved_labor gives labor hours and estimated cost for any date range (by site, pay type and employee); isolved_on_the_clock gives who is clocked in right now and this pay week so far. Use them for labor hours, labor cost, overtime, PTO, who worked, and who is on the clock. Costs are base-rate estimates, not payroll gross; say so when you give a dollar figure. If a result starts with NO_ACCESS, tell the user that iSolved labor data is limited to approved people (an Admin can grant the Labor Data or On the Clock page), and do not try to get it another way.'

type LaborInput = { start?: string; end?: string; salaried?: string; site?: string; employee?: string; region?: string }
type LiveInput = { site?: string }

const SCOPE: Record<string, string> = { exclude: 'none', include: 'exclude-corporate', only: 'only' }
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// "5", "MW5", "#05", "Mighty Wash 5" -> "MW05"; Corporate and Spotless by name.
export function siteKey(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (/^cor/i.test(s)) return 'Corporate'
  if (/spot/i.test(s)) return 'Spotless'
  const m = s.match(/(\d+)/)
  return m ? `MW${m[1].padStart(2, '0')}` : s
}

export class NoAccess extends Error {}

// Calls a function as the signed-in person; a 403 is their access, not a fault.
async function invoke(userClient: SupabaseClient, fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await userClient.functions.invoke(fn, { body })
  if (!error) return (data ?? {}) as Record<string, unknown>
  let message = error.message
  let status: number | undefined
  const res = (error as { context?: Response }).context
  if (res && typeof res.status === 'number') {
    status = res.status
    try {
      const j = await res.json()
      message = j?.message ?? j?.error ?? message
    } catch { /* keep the generic message */ }
  }
  if (status === 403 || status === 401) throw new NoAccess(message)
  throw new Error(message)
}

type LaborEmp = { employeeNumber: string; name: string; payType: string; rate: number; totalHours: number; cost: number; byPayType: Record<string, number>; sites: string[] }
type LaborSite = { site: string; totalHours: number; cost: number; byPayType: Record<string, number>; employees: number; onClock: number }

// The labor pull, cut down: totals and every site, plus the employees that
// matter for the question (a site's or a name's, else the top ones by cost).
export function summarizeLabor(d: Record<string, unknown>, input: LaborInput) {
  const sites = ((d.sites ?? []) as LaborSite[]).map((s) => ({
    site: s.site, hours: s.totalHours, cost: s.cost, by_pay_type: s.byPayType, employees: s.employees, on_clock_now: s.onClock,
  }))
  let emps = [...((d.employees ?? []) as LaborEmp[])].sort((a, b) => (b.cost - a.cost) || (b.totalHours - a.totalHours))
  const filtered = !!(input.site || input.employee)
  if (input.site) {
    const want = siteKey(input.site)
    emps = emps.filter((e) => (e.sites ?? []).some((x) => x === want))
  }
  if (input.employee) {
    const q = input.employee.trim().toLowerCase()
    emps = emps.filter((e) => (e.name ?? '').toLowerCase().includes(q))
  }
  const worked = emps.filter((e) => e.totalHours > 0 || e.cost > 0)
  const list = filtered ? emps : worked
  const limit = filtered ? 250 : 40
  return {
    range: d.range,
    salaried: Object.entries(SCOPE).find(([, v]) => v === d.salariedScope)?.[0] ?? d.salariedScope,
    region: d.region,
    regions_available: d.regions,
    includes_today: d.includesToday,
    totals: d.totals,
    sites: input.site ? sites.filter((s) => s.site === siteKey(input.site)) : sites,
    employees: list.slice(0, limit).map((e) => ({
      name: e.name, number: e.employeeNumber, pay_type: e.payType, rate: e.rate, hours: e.totalHours, cost: e.cost, by_pay_type: e.byPayType, sites: e.sites,
    })),
    employees_note: filtered
      ? `${list.length} employees match${list.length > limit ? `; showing the ${limit} with the highest cost` : ''}.`
      : `${worked.length} employees worked in the range${worked.length > limit ? `; showing the ${limit} with the highest cost (pass site or employee for more)` : ''}.`,
    assumptions: d.assumptions,
  }
}

type LiveEmp = { employeeNumber: string; name: string; salaried: boolean; onClock: boolean; clockInTime: string | null; elapsedHours: number; siteDayHours: number; siteDayCost: number; siteWeekHours: number; siteWeekCost: number; siteWeekPTO: number; totalWeekHours: number }
type LiveSite = { site: string; clockedIn: number; weekHours: number; weekCost: number; weekCostSalary: number; weekCostHourly: number; weekPTO: number; employeeCount: number; employees: LiveEmp[] }

const round = (n: number) => Math.round(n * 100) / 100

// On the Clock, kept to the sites this person may see (null = every site).
export function summarizeLive(d: Record<string, unknown>, allowed: Set<string> | null, input: LiveInput) {
  let sites = (d.sites ?? []) as LiveSite[]
  if (allowed) sites = sites.filter((s) => allowed.has(s.site))
  const sum = (k: keyof LiveSite) => round(sites.reduce((a, s) => a + (Number(s[k]) || 0), 0))
  const totals = allowed
    ? { clocked_in: sum('clockedIn'), week_hours: sum('weekHours'), week_cost: sum('weekCost'), week_cost_hourly: sum('weekCostHourly'), week_cost_salary: sum('weekCostSalary'), week_pto: sum('weekPTO'), sites: sites.length }
    : d.totals
  const base = { generated_at: d.generatedAt, central: d.central, scope: allowed ? 'your region' : 'every site', totals }
  if (input.site) {
    const want = siteKey(input.site)
    const s = sites.find((x) => x.site === want)
    if (!s) return { ...base, site: want, error: allowed ? 'That site is not one you can see, or nobody has worked there this week.' : 'Nobody has worked at that site this week.' }
    return {
      ...base,
      site: { site: s.site, clocked_in: s.clockedIn, week_hours: s.weekHours, week_cost: s.weekCost, week_cost_hourly: s.weekCostHourly, week_cost_salary: s.weekCostSalary, week_pto: s.weekPTO },
      employees: s.employees.map((e) => ({
        name: e.name, salaried: e.salaried, on_clock: e.onClock, clock_in: e.clockInTime, hours_so_far: e.onClock ? e.elapsedHours : undefined,
        day_hours: e.siteDayHours, day_cost: e.siteDayCost, week_hours: e.siteWeekHours, week_cost: e.siteWeekCost, week_pto: e.siteWeekPTO || undefined, all_sites_week_hours: e.totalWeekHours,
      })),
    }
  }
  return {
    ...base,
    sites: sites.map((s) => ({
      site: s.site, clocked_in: s.clockedIn, week_hours: s.weekHours, week_cost: s.weekCost, week_cost_hourly: s.weekCostHourly, week_cost_salary: s.weekCostSalary, week_pto: s.weekPTO, employees: s.employeeCount,
      on_clock: s.employees.filter((e) => e.onClock).map((e) => ({ name: e.name, clock_in: e.clockInTime, hours_so_far: e.elapsedHours })),
    })),
  }
}

export type IsolvedCtx = { userClient: SupabaseClient; svc: SupabaseClient; uid: string; accountId: string; roleCategory: string | null }

// A Regional Manager's sites (location names, e.g. MW05) from Company settings
// for the current quarter; null for everyone else (they see every site).
async function rmSites(ctx: IsolvedCtx): Promise<Set<string> | null> {
  if (ctx.roleCategory !== 'regional_manager') return null
  const { data, error } = await ctx.svc.rpc('site_audit_v2_rm_map', { p_account: ctx.accountId })
  if (error) throw new Error(error.message)
  const ids = ((data ?? []) as { location_id: string; user_id: string | null }[]).filter((r) => r.user_id === ctx.uid).map((r) => r.location_id)
  if (!ids.length) return new Set()
  const { data: locs, error: e2 } = await ctx.svc.from('locations').select('name').in('id', ids)
  if (e2) throw new Error(e2.message)
  return new Set((locs ?? []).map((l) => String(l.name)))
}

const noAccess = (e: NoAccess) => `NO_ACCESS: ${e.message || 'iSolved labor data is limited to approved people.'}`

export async function isolvedLabor(input: LaborInput, ctx: IsolvedCtx): Promise<string> {
  if (!isDate(input.start) || !isDate(input.end)) throw new Error('start and end must be dates (YYYY-MM-DD).')
  if (input.start > input.end) throw new Error('start must be on or before end.')
  try {
    const data = await invoke(ctx.userClient, 'isolved-labor', {
      startDate: input.start,
      endDate: input.end,
      salariedScope: SCOPE[input.salaried ?? 'exclude'] ?? 'none',
      ...(input.region ? { region: input.region } : {}),
    })
    if (data.error) throw new Error(String(data.message ?? data.error))
    return JSON.stringify(summarizeLabor(data, input))
  } catch (e) {
    if (e instanceof NoAccess) return noAccess(e)
    throw e
  }
}

export async function isolvedOnTheClock(input: LiveInput, ctx: IsolvedCtx): Promise<string> {
  try {
    const allowed = await rmSites(ctx)
    if (allowed && allowed.size === 0) return 'NO_ACCESS: No region is assigned to this Regional Manager in Company settings this quarter, so there are no sites to show.'
    const data = await invoke(ctx.userClient, 'isolved-live', {})
    if (data.error) throw new Error(String(data.message ?? data.error))
    return JSON.stringify(summarizeLive(data, allowed, input))
  } catch (e) {
    if (e instanceof NoAccess) return noAccess(e)
    throw e
  }
}
