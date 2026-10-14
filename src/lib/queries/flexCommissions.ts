import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Membership-sale commissions from FlexWash (PROTOTYPE), aggregated server-side by
// the flex-commissions edge function. Restricted to kevan@washlyfe.com.

export type TierCount = { sold: number; payable: number; pending: number }
export type CommissionEmployee = {
  name: string
  sales: number
  payableCount: number
  pendingCount: number
  payableAmount: number
  pendingAmount: number
  byTier: Record<string, TierCount>
}
export type CommissionDetail = {
  emp: string
  tier: string
  code: string
  site: string
  saleDay: string
  firstRecharge: string | null
  payable: boolean
  amount: number
}
export type CommissionReport = {
  ok: boolean
  generatedAt: string
  start: string
  end: string
  today: string
  rates: Record<string, number>
  totals: {
    sales: number
    payableCount: number
    pendingCount: number
    payableAmount: number
    pendingAmount: number
    byTier: Record<string, { sold: number; payable: number }>
  }
  employees: CommissionEmployee[]
  detail: CommissionDetail[]
  siteCount: number
}

export async function fetchCommissions(
  start: string,
  end: string,
  carWashIds?: string[],
): Promise<CommissionReport> {
  const { data, error } = await supabase.functions.invoke('flex-commissions', {
    body: { start, end, ...(carWashIds && carWashIds.length ? { carWashIds } : {}) },
  })
  if (error || (data && (data as { error?: string }).error)) {
    throw new Error(await fnErrorMessage(error, data, 'Could not load commissions.'))
  }
  return data as CommissionReport
}
