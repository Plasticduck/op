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
  // Tenders + accounting totals, from get-accounting (DRB "Total to Account For").
  accounting: {
    cash: number
    card: number
    giftCard: number
    fleetUnpaid: number
    cardByProcessor: Record<string, number>
    gross: number
    net: number
    discount: number
    promotion: number
    refund: number
    tax: number
    tip: number
    cashDeposit: number
    washBookSales: number
    giftCardSales: number
    prepaidSales: number
  } | null
  // Named discount lines, from get-discount-stats (DRB "Less Wash Discounts").
  discounts: { name: string; count: number; amount: number }[]
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

// Line-item breakdown (from get-line-items-detail), grouped like FlexWash's own
// "Line Item Sales Breakdown" report.
export type FlexLineRow = { name: string; revenue: number; count: number }
export type FlexLineGroup = { key: string; label: string; revenue: number; count: number; items: FlexLineRow[] }

const CLASS_LABEL: Record<string, string> = {
  membershipsSoldNew: 'Memberships Sold (New)',
  membershipsRebilled: 'Memberships Recharged',
  memberWashes: 'Member Washes',
  fleetWashes: 'Fleet Washes',
  singleWashes: 'Single Washes',
  otherWashes: 'Other Washes',
  miscellaneous: 'Tax, Discounts & Misc',
}
const CLASS_ORDER = ['membershipsSoldNew', 'membershipsRebilled', 'memberWashes', 'fleetWashes', 'singleWashes', 'otherWashes', 'miscellaneous']

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
    const [rev, wash, mem, churn, acct, disc] = await Promise.all([
      flexApi('/external/wash-and-revenue-stats/get-temporal-revenue-stats', { ...scope, interval: 'day' }),
      flexApi('/external/wash-and-revenue-stats/get-temporal-wash-stats', { ...scope, interval: 'day' }),
      flexApi('/external/memberships/get-new-membership-stats', scope),
      flexApi('/external/memberships/get-churn-percentages', scope).catch(() => null),
      flexApi('/external/accounting/get-accounting', scope).catch(() => null),
      flexApi('/external/discounts/get-discount-stats', scope).catch(() => null),
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

    // Accounting: sum every date across every payout group for the site.
    let accounting: FlexSalesReport['accounting'] = null
    const acctRoot = (acct?.accounting ?? []) as Any[]
    if (acctRoot.length) {
      const t = { cash: 0, card: 0, giftCard: 0, fleetUnpaid: 0, gross: 0, net: 0, discount: 0, promotion: 0, refund: 0, tax: 0, tip: 0, cashDeposit: 0, washBookSales: 0, giftCardSales: 0, prepaidSales: 0 }
      const cardByProcessor: Record<string, number> = {}
      for (const cw of acctRoot) {
        for (const pg of (cw.payoutGroups ?? []) as Any[]) {
          for (const dt of (pg.dates ?? []) as Any[]) {
            const a = dt.accounting ?? {}
            t.cash += toDollars(a.cashNetPayments)
            t.card += toDollars(a.cardNetPayments)
            t.giftCard += toDollars(a.giftCardNetPayments)
            t.fleetUnpaid += toDollars(a.fleetUnpaidNetPayments)
            t.gross += toDollars(a.grossSales)
            t.net += toDollars(a.netSales)
            t.discount += toDollars(a.discountAmount)
            t.promotion += toDollars(a.promotionAmount)
            t.refund += toDollars(a.refundAmount)
            t.tax += toDollars(a.taxAmount)
            t.tip += toDollars(a.tipAmount)
            t.cashDeposit += toDollars(a.cashDepositAmount)
            t.washBookSales += toDollars(a.washBookSalesAmount)
            t.giftCardSales += toDollars(a.giftCardSalesAmount)
            t.prepaidSales += toDollars(a.prepaidSalesAmount)
            for (const [k, v] of Object.entries((a.cardNetPaymentsByProcessor ?? {}) as Record<string, unknown>)) {
              cardByProcessor[k] = (cardByProcessor[k] ?? 0) + toDollars(v)
            }
          }
        }
      }
      accounting = { ...t, cardByProcessor }
    }

    const discounts = ((disc?.records ?? []) as Any[])
      .map((d) => ({ name: String(d.discount?.name ?? '—'), count: Number(d.count) || 0, amount: toDollars(d.amountInCents) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))

    const days = new Set([...rs.map((x) => String(x.iso8601).slice(0, 10)), ...ws.map((x) => String(x.iso8601).slice(0, 10))]).size

    return { revenue, wash: wsh, plans, churn: churnR, accounting, discounts, days }
  },

  // Every transaction line item for a site + range, aggregated by classification
  // then by line-item name (revenue + count) — the detailed sales breakdown.
  lineItemBreakdown: async (carWashId: string, start: string, end: string): Promise<FlexLineGroup[]> => {
    const data = await flexApi('/external/accounting/get-line-items-detail', {
      carWashIds: [carWashId],
      dateRange: { start, end },
    })
    const items = (data?.lineItemsDetail ?? []) as Any[]
    const groups = new Map<string, { revenue: number; count: number; items: Map<string, FlexLineRow> }>()
    for (const it of items) {
      const cls = String(it.orderClassification ?? 'miscellaneous')
      const name = String(it.name ?? '—')
      const rev = toDollars(it.priceInCents)
      let g = groups.get(cls)
      if (!g) { g = { revenue: 0, count: 0, items: new Map() }; groups.set(cls, g) }
      g.revenue += rev
      g.count += 1
      const row = g.items.get(name) ?? { name, revenue: 0, count: 0 }
      row.revenue += rev
      row.count += 1
      g.items.set(name, row)
    }
    const rank = (k: string) => { const i = CLASS_ORDER.indexOf(k); return i < 0 ? 99 : i }
    return [...groups.entries()]
      .map(([key, g]) => ({
        key,
        label: CLASS_LABEL[key] ?? key,
        revenue: g.revenue,
        count: g.count,
        items: [...g.items.values()].sort((a, b) => b.revenue - a.revenue),
      }))
      .sort((a, b) => rank(a.key) - rank(b.key))
  },
}
