import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// FlexWash (sites 17/18/29/30) sales reporting, grouped to mirror the DRB
// General Sales Report as closely as FlexWash's API allows. All FlexWash money
// is returned in cents; we convert to dollars here.

export type FlexSite = { site_number: number; car_wash_id: string; name: string | null }

export type FlexSalesReport = {
  // Revenue components (dollars), from get-temporal-revenue-stats.
  revenue: {
    express: number
    fullService: number
    detail: number
    fleet: number
    washBook: number
    giftCard: number
    membership: number // recharge (ARM Plans Recharged equivalent)
    other: number // adjustments / discounts (can be negative)
    retailWash: number // express + fullService + detail + fleet
    total: number // everything summed = net site sales / total to account for
  }
  // Wash counts, from get-temporal-wash-stats.
  wash: {
    single: number // non-member (retail) washes
    member: number // member washes (redemptions)
    total: number
    express: number
    fullService: number
    detail: number
    fleet: number
  }
  // New plans sold, from get-new-membership-stats.
  plans: { total: number; byTier: { name: string; count: number }[] }
  // Churn %, from get-churn-percentages (fractions -> percent).
  churn: { voluntary: number | null; cc: number | null }
  days: number
}

// FlexWash payloads are loosely typed; we validate the fields we read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

async function flexApi(path: string, body: unknown): Promise<Any> {
  const { data, error } = await supabase.functions.invoke('flexwash', { body: { path, body } })
  if (error) throw new Error(await fnErrorMessage(error, data, 'FlexWash request failed.'))
  return (data as { data?: Any } | null)?.data ?? null
}

const toDollars = (cents: unknown) => (Number(cents) || 0) / 100

export const flexwashSales = {
  // The FlexWash sites for this account (manager+ only, per RLS).
  sites: async (): Promise<FlexSite[]> => {
    const { data } = await supabase
      .from('flexwash_sites')
      .select('site_number, car_wash_id, name')
      .eq('active', true)
      .order('site_number')
    return (data as FlexSite[] | null) ?? []
  },

  // One combined report for a site over a date range (inclusive). A single day
  // is start === end. Values are summed across the range.
  report: async (carWashId: string, start: string, end: string): Promise<FlexSalesReport> => {
    const scope = { carWashIds: [carWashId], dateRange: { start, end } }
    const [rev, wash, mem, churn] = await Promise.all([
      flexApi('/external/wash-and-revenue-stats/get-temporal-revenue-stats', { ...scope, interval: 'day' }),
      flexApi('/external/wash-and-revenue-stats/get-temporal-wash-stats', { ...scope, interval: 'day' }),
      flexApi('/external/memberships/get-new-membership-stats', scope),
      flexApi('/external/memberships/get-churn-percentages', scope).catch(() => null),
    ])

    const rs = (rev?.revenueStats ?? []) as Any[]
    const ws = (wash?.washStats ?? []) as Any[]
    const sum = (arr: Any[], k: string) => arr.reduce((a, x) => a + (Number(x[k]) || 0), 0)

    const revenue = {
      express: toDollars(sum(rs, 'expressRevenue')),
      fullService: toDollars(sum(rs, 'fullServiceRevenue')),
      detail: toDollars(sum(rs, 'detailRevenue')),
      fleet: toDollars(sum(rs, 'fleetRevenue')),
      washBook: toDollars(sum(rs, 'washBookRevenue')),
      giftCard: toDollars(sum(rs, 'giftCardRevenue')),
      membership: toDollars(sum(rs, 'membershipRevenue')),
      other: toDollars(sum(rs, 'otherRevenue')),
      retailWash: 0,
      total: 0,
    }
    revenue.retailWash = revenue.express + revenue.fullService + revenue.detail + revenue.fleet
    revenue.total = revenue.retailWash + revenue.washBook + revenue.giftCard + revenue.membership + revenue.other

    const wsh = {
      single: sum(ws, 'singleWashCount'),
      member: sum(ws, 'memberWashCount'),
      total: sum(ws, 'singleWashCount') + sum(ws, 'memberWashCount'),
      express: sum(ws, 'expressWashCount'),
      fullService: sum(ws, 'fullServiceWashCount'),
      detail: sum(ws, 'detailWashCount'),
      fleet: sum(ws, 'fleetWashCount'),
    }

    const plans = {
      total: Number(mem?.count) || 0,
      byTier: ((mem?.byPackageTemplate ?? []) as Any[])
        .map((p) => ({ name: String(p.packageTemplateName ?? 'Plan'), count: Number(p.count) || 0 }))
        .sort((a, b) => b.count - a.count),
    }

    const churnR = {
      voluntary: churn?.voluntaryChurnPercent != null ? Number(churn.voluntaryChurnPercent) * 100 : null,
      cc: churn?.involuntaryChurnPercent != null ? Number(churn.involuntaryChurnPercent) * 100 : null,
    }

    const days = new Set([...rs.map((x) => String(x.iso8601).slice(0, 10)), ...ws.map((x) => String(x.iso8601).slice(0, 10))]).size

    return { revenue, wash: wsh, plans, churn: churnR, days }
  },
}
