import { supabase } from '@/lib/supabase'

// iSolved payroll/labor. Timecard hours for a date range, rolled up by site,
// pay type, and employee. The credentials live server-side in the isolved-labor
// edge function, which is restricted to a single admin.
export type LaborSite = { code: string; site: string; totalHours: number; byPayType: Record<string, number>; employees: number }
export type LaborEmployee = { employeeNumber: string; name: string; totalHours: number; byPayType: Record<string, number>; sites: string[] }
export type LaborResponse = {
  range: { startDate: string; endDate: string }
  payTypes: string[]
  sites: LaborSite[]
  employees: LaborEmployee[]
  totals: { totalHours: number; byPayType: Record<string, number>; employees: number; sites: number }
  error?: string
  message?: string
}

export const isolvedLabor = (startDate: string, endDate: string) =>
  supabase.functions.invoke<LaborResponse>('isolved-labor', { body: { startDate, endDate } })
