import { supabase } from '@/lib/supabase'

// iSolved payroll/labor. Timecard hours for a date range, rolled up by site,
// pay type, and employee. The credentials live server-side in the isolved-labor
// edge function, which is restricted to a single admin.
export type LaborSite = { code: string; site: string; totalHours: number; cost: number; byPayType: Record<string, number>; employees: number }
export type LaborEmployee = { employeeNumber: string; name: string; payType: string; rate: number; rated: boolean; totalHours: number; cost: number; byPayType: Record<string, number>; sites: string[] }
// Which salaried staff a labor query includes:
//   - 'exclude-corporate': hourly + salaried except Corporate salaried (Labor Data)
//   - 'none':              hourly only, no salaried (Labor Data, salaried hidden)
//   - 'only':              salaried only, all sites incl. Corporate (Salaried Labor)
export type SalariedScope = 'exclude-corporate' | 'none' | 'only'

export type LaborResponse = {
  range: { startDate: string; endDate: string }
  payTypes: string[]
  sites: LaborSite[]
  employees: LaborEmployee[]
  salariedScope?: SalariedScope
  totals: { totalHours: number; totalCost: number; byPayType: Record<string, number>; employees: number; sites: number; unratedEmployees: number; unratedHours: number }
  assumptions?: { otMultiplier: number; salariedBasis: string; note: string }
  error?: string
  message?: string
}

export const isolvedLabor = (startDate: string, endDate: string, salariedScope: SalariedScope = 'exclude-corporate') =>
  supabase.functions.invoke<LaborResponse>('isolved-labor', { body: { startDate, endDate, salariedScope } })

// Real-time labor: who is clocked in now, by site, with current pay-week hours
// (the pay week runs Sunday -> Saturday). Served by the isolved-live function.
export type LiveSiteEmployee = {
  employeeNumber: string
  name: string
  onClock: boolean
  clockInAt: string | null // naive Central ISO of the open punch
  clockInTime: string | null // e.g. "10:58 AM"
  elapsedHours: number
  siteDayHours: number
  siteWeekHours: number
  siteWeekCost: number
  totalWeekHours: number
}
export type LiveSite = {
  site: string
  clockedIn: number
  weekHours: number
  weekCost: number
  employeeCount: number
  employees: LiveSiteEmployee[]
}
export type LiveResponse = {
  ok: boolean
  generatedAt: string
  central: { now: string; today: string; weekStart: string; weekLabel: string }
  totals: { clockedIn: number; weekHours: number; weekCost: number; employees: number; sites: number }
  sites: LiveSite[]
  error?: string
  message?: string
}

export const isolvedLive = () => supabase.functions.invoke<LiveResponse>('isolved-live', { body: {} })
