import { supabase } from '@/lib/supabase'

// iSolved payroll/labor. Timecard hours for a date range, rolled up by site,
// pay type, and employee. The credentials live server-side in the isolved-labor
// edge function, which is restricted to a single admin.
// onClock = people clocked in at the site right now (only when the range includes today).
export type LaborSite = { code: string; site: string; totalHours: number; cost: number; byPayType: Record<string, number>; employees: number; onClock?: number }
export type LaborEmployee = { employeeNumber: string; name: string; payType: string; rate: number; rated: boolean; totalHours: number; cost: number; byPayType: Record<string, number>; sites: string[] }
// Which salaried staff a labor query includes:
//   - 'exclude-corporate': hourly + salaried except Corporate salaried (Labor Data)
//   - 'none':              hourly only, no salaried (Labor Data, salaried hidden)
//   - 'only':              salaried only, all sites incl. Corporate (Salaried Labor)
export type SalariedScope = 'exclude-corporate' | 'none' | 'only'

export type LaborResponse = {
  range: { startDate: string; endDate: string }
  includesToday?: boolean
  payTypes: string[]
  sites: LaborSite[]
  employees: LaborEmployee[]
  salariedScope?: SalariedScope
  totals: { totalHours: number; totalCost: number; byPayType: Record<string, number>; employees: number; sites: number; unratedEmployees: number; unratedHours: number; onClock?: number }
  assumptions?: { otMultiplier: number; salariedBasis: string; note: string }
  error?: string
  message?: string
}

export const isolvedLabor = (startDate: string, endDate: string, salariedScope: SalariedScope = 'exclude-corporate') =>
  supabase.functions.invoke<LaborResponse>('isolved-labor', { body: { startDate, endDate, salariedScope } })

// Real-time labor: who is clocked in now, by site, with current pay-week hours
// (the pay week runs Monday -> Sunday). Served by the isolved-live function.
export type LiveSiteEmployee = {
  employeeNumber: string
  name: string
  salaried: boolean
  onClock: boolean
  clockInAt: string | null // naive Central ISO of the open punch
  clockInTime: string | null // e.g. "10:58 AM"
  elapsedHours: number
  siteDayHours: number
  siteDayCost: number
  siteWeekHours: number
  siteWeekCost: number
  siteWeekPTO: number
  siteDayPTO: number
  totalWeekHours: number
}
export type LiveSite = {
  site: string
  clockedIn: number
  weekHours: number
  weekCost: number
  weekCostSalary: number
  weekCostHourly: number
  weekPTO: number
  employeeCount: number
  employees: LiveSiteEmployee[]
}
export type LiveResponse = {
  ok: boolean
  generatedAt: string
  central: { now: string; today: string; weekStart: string; weekLabel: string }
  totals: { clockedIn: number; weekHours: number; weekCost: number; weekCostSalary: number; weekCostHourly: number; weekPTO: number; employees: number; sites: number }
  sites: LiveSite[]
  error?: string
  message?: string
}

export const isolvedLive = () => supabase.functions.invoke<LiveResponse>('isolved-live', { body: {} })

// iSolved worked hours per employee over a date range (Tips NEW). Company-wide
// by default (pass excludeSites to drop e.g. New Mexico staff), or one site.
export type TipsHoursEmployee = { number: string; name: string; hours: number; site?: string }
export type TipsHoursResponse = {
  ok?: boolean
  scope?: string
  excludedSites?: string[]
  employees?: TipsHoursEmployee[]
  totalHours?: number
  days?: number
  salariedExcluded?: number
  excludedEmployees?: number
  rosterError?: string | null
  error?: string
  message?: string
}
export const tipsHours = (
  start: string,
  end: string,
  opts: { site?: string; excludeSites?: Array<string | number> } = {},
) => supabase.functions.invoke<TipsHoursResponse>('tips-hours', { body: { start, end, ...opts } })

// Sync the active iSolved roster into the `employees` table so staff show up as
// schedulable labor at their site (no manual profiles). Mighty Wash only; the
// edge function is gated to MW owners/managers. Returns per-run counts.
export type RosterSyncResponse = {
  ok?: boolean
  synced?: number
  active_roster?: number
  deactivated?: number
  skipped?: { corporate: number; unassigned: number; unmapped: number; noName: number }
  synced_at?: string
  error?: string
  message?: string
}
export const isolvedRosterSync = () =>
  supabase.functions.invoke<RosterSyncResponse>('isolved-roster-sync', { body: {} })
