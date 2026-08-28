// Lube Shop (DRB store 019) statistics — pulled live from DRB via the
// `lube-stats` edge function, kept entirely separate from car-wash reporting.
// A daily job also archives each day into lube_stats_days for durable history.

import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

export type LubeDay = { date: string; tickets: number; net_sales: number; tax: number }
export type LubeCategory = { name: string; dollars: number; items: number }
export type LubeTotals = { net_sales: number; tax: number; tickets: number }
export type LubeStats = {
  start: string
  end: string
  days: LubeDay[]
  categories: LubeCategory[]
  totals: LubeTotals
}

export async function fetchLubeStats(start: string, end: string): Promise<LubeStats> {
  const { data, error } = await supabase.functions.invoke('lube-stats', { body: { start, end } })
  if (error) throw new Error(await fnErrorMessage(error, data, 'Could not load lube shop stats.'))
  const d = data as LubeStats
  return { start: d.start, end: d.end, days: d.days ?? [], categories: d.categories ?? [], totals: d.totals ?? { net_sales: 0, tax: 0, tickets: 0 } }
}
