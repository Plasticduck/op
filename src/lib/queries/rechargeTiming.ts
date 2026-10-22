import { supabase } from '@/lib/supabase'
import { flexwashSales } from '@/lib/queries/flexwashSales'

// When memberships recharge across the company: recharges per calendar day, from
// both billing systems. Converted sites still bill their legacy members in
// SiteWatch while new members bill in FlexWash, so the two are separate members
// and are simply added (no cutover split).
//  - SiteWatch: every line in the "ARM Plans Recharged" report category (BRANCH
//    001004006), all sites — the same figure as the DRB General Sales Report
//    (Sep 2026: 77,074 / $2,903,201.44).
//  - FlexWash: the membershipsRebilled bucket of get-line-items-grouped-by-
//    classification (line count + revenue), one call per day across every site.

export type DayTotals = { count: number; amount: number }
export type RechargeDaily = {
  // Per calendar date (YYYY-MM-DD).
  siteWatch: Map<string, DayTotals>
  flexWash: Map<string, DayTotals>
  flexIncluded: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const nextDay = (d: string) => new Date(new Date(d + 'T00:00:00Z').getTime() + 86_400_000).toISOString().slice(0, 10)

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = nextDay(d)) out.push(d)
  return out
}

async function fetchSiteWatch(start: string, end: string): Promise<Map<string, DayTotals>> {
  const sql =
    'SELECT CAST(s.LOGDATE AS DATE) AS D, COUNT(*) AS N, SUM(si.AMT) AS A ' +
    'FROM SALEITEMS si ' +
    'JOIN SALE s ON s.SITE=si.SITE AND s.OBJID=si.SALEID ' +
    'JOIN ITEM it ON it.OBJID=si.ITEM ' +
    'JOIN ITEMRPTCATEGORY rc ON rc.OBJID=it.REPORTCATEGORY ' +
    `WHERE s.LOGDATE>='${start}' AND s.LOGDATE<'${nextDay(end)}' AND si.FLAGS>=0 AND rc.BRANCH='001004006' ` +
    'GROUP BY 1 ORDER BY 1'
  const { data, error } = await supabase.functions.invoke('site-performance', {
    body: { api: { path: '/api/custom_query', method: 'POST', body: { sql } } },
  })
  if (error) throw new Error(error.message)
  const resp = data as { data?: { rows?: Array<[string, number | string, number | string]>; error?: unknown } } | null
  if (resp?.data?.error) throw new Error('The SiteWatch recharge query could not be run right now.')
  const m = new Map<string, DayTotals>()
  for (const [d, n, a] of resp?.data?.rows ?? []) {
    m.set(String(d).slice(0, 10), { count: Number(n) || 0, amount: Number(a) || 0 })
  }
  return m
}

async function flexApi(path: string, body: unknown): Promise<Any> {
  const { data, error } = await supabase.functions.invoke('flexwash', { body: { path, body } })
  if (error) throw new Error(error.message)
  return (data as { data?: Any } | null)?.data ?? null
}

async function fetchFlexWash(dates: string[], onProgress?: (done: number, total: number) => void): Promise<Map<string, DayTotals>> {
  const sites = await flexwashSales.sites()
  const ids = sites.map((s) => s.car_wash_id).filter(Boolean)
  const m = new Map<string, DayTotals>()
  if (!ids.length) return m
  let i = 0
  let done = 0
  // A handful at a time; FlexWash throttles big bursts.
  await Promise.all(Array.from({ length: Math.min(6, dates.length) }, async () => {
    while (i < dates.length) {
      const date = dates[i++]
      const res = await flexApi('/external/revenue-analytics/get-line-items-grouped-by-classification', {
        carWashIds: ids, dateRange: { start: date, end: date },
      })
      let count = 0
      let cents = 0
      for (const c of (res?.aggregate?.membershipsRebilled ?? []) as Any[]) {
        count += Number(c.totalLineItemCount) || 0
        cents += Number(c.totalRevenueInCents) || 0
      }
      m.set(date, { count, amount: cents / 100 })
      onProgress?.(++done, dates.length)
    }
  }))
  return m
}

export async function fetchRechargeDaily(
  start: string,
  end: string,
  onProgress?: (done: number, total: number) => void,
): Promise<RechargeDaily> {
  const dates = datesBetween(start, end)
  const [siteWatch, flex] = await Promise.all([
    fetchSiteWatch(start, end),
    // FlexWash is best-effort: still show SiteWatch if it fails, and say so.
    fetchFlexWash(dates, onProgress).then((m) => ({ m, ok: true })).catch(() => ({ m: new Map<string, DayTotals>(), ok: false })),
  ])
  return { siteWatch, flexWash: flex.m, flexIncluded: flex.ok }
}
