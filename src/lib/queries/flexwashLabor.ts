import { supabase } from '@/lib/supabase'

// Labor from FlexWash's own time clock (the FlexWash tab on On the Clock), served
// by the flexwash-labor function. FlexWash's API gives totals only: hours and
// cost per car wash for a date range, no names or clock-in times.
export type FlexLaborStat = { hours: number; cost: number }
export type FlexLaborSite = {
  carWashId: string
  name: string // FlexWash's name, e.g. "MW #15"
  site: string // MWNN
  today: FlexLaborStat
  week: FlexLaborStat
  period: FlexLaborStat
  error: string | null
}
export type FlexLaborResponse = {
  ok: boolean
  generatedAt: string
  // Central dates: pay week Monday -> today, pay period (two weeks) start -> today.
  central: { today: string; weekStart: string; periodStart: string; periodEnd: string }
  sites: FlexLaborSite[] // sites with FlexWash labor this pay period
  idle: string[] // FlexWash car washes with none yet (not on the FlexWash time clock)
  totals: { today: FlexLaborStat; week: FlexLaborStat; period: FlexLaborStat; sites: number; carWashes: number }
  error?: string
  message?: string
}

// fresh: skip the function's few-minute cache (the Refresh button).
export const flexwashLabor = (fresh = false) =>
  supabase.functions.invoke<FlexLaborResponse>('flexwash-labor', { body: fresh ? { fresh: true } : {} })
