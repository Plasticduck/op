import { supabase } from '@/lib/supabase'
import { flexwashSales } from '@/lib/queries/flexwashSales'

// Monthly wash-package usage for the Chemicals hub. Counts EVERY wash that used
// each package (retail sales + member redemptions), across ALL sites:
//  - DRB SiteWatch sites: from the POS ledger (same source as the dashboards) via
//    the site-performance custom-query proxy. Packages live under the "Carwashes"
//    report category (BRANCH 001001001); each wash posts exactly one package line
//    there (members post it too, offset by redemption discounts elsewhere), so
//    counting those lines by tier gives total usage, not just retail.
//  - FlexWash sites (MW17/MW18): counted from FlexWash line items exactly as the
//    FlexWash Sales Reports page does (flexwashSales.lineItemBreakdown -> carsByTier:
//    one "Package" line per paid wash, member redemptions included).

export type PackageCounts = { wonder: number; superShine: number; mighty: number; total: number; flexIncluded: boolean }

// First and last calendar day (YYYY-MM-DD) of a 'YYYY-MM' month.
export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, '0')}` }
}

// The most recent COMPLETE month as 'YYYY-MM' (last month, since the current one
// is still in progress).
export function lastCompleteMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type TierCounts = { wonder: number; superShine: number; mighty: number }

// FlexWash (MW17/MW18) washes by tier, reusing the Sales Reports page logic
// (carsByTier). FlexWash labels Mighty Protector as just "Mighty".
async function fetchFlexCounts(start: string, end: string): Promise<TierCounts> {
  const sites = await flexwashSales.sites()
  const ids = sites.map((s) => s.car_wash_id).filter(Boolean)
  if (!ids.length) return { wonder: 0, superShine: 0, mighty: 0 }
  const bd = await flexwashSales.lineItemBreakdown(ids, start, end)
  const out: TierCounts = { wonder: 0, superShine: 0, mighty: 0 }
  for (const t of bd.carsByTier) {
    if (t.label === 'Wonder') out.wonder = t.count
    else if (t.label === 'Super Shine') out.superShine = t.count
    else if (t.label === 'Mighty') out.mighty = t.count
  }
  return out
}

export async function fetchPackageCounts(ym: string): Promise<PackageCounts> {
  const { start, end } = monthRange(ym)
  const sw = await fetchSiteWatchCounts(start, end)
  // FlexWash is best-effort: if it fails, still show the SiteWatch sites and flag it.
  let flex: TierCounts = { wonder: 0, superShine: 0, mighty: 0 }
  let flexIncluded = false
  try {
    flex = await fetchFlexCounts(start, end)
    flexIncluded = true
  } catch {
    /* best-effort: keep SiteWatch-only totals and flag flexIncluded=false */
  }
  const wonder = sw.wonder + flex.wonder
  const superShine = sw.superShine + flex.superShine
  const mighty = sw.mighty + flex.mighty
  return { wonder, superShine, mighty, total: wonder + superShine + mighty, flexIncluded }
}

// SiteWatch (DRB) wash counts by tier for a date range.
async function fetchSiteWatchCounts(start: string, end: string): Promise<TierCounts> {
  const sql =
    "SELECT (CASE " +
    "WHEN UPPER(it.NAME) LIKE '%MIGHTY PROTECT%' THEN 'Mighty Protector' " +
    "WHEN UPPER(it.NAME) LIKE '%SUPER SHINE%' THEN 'Super Shine' " +
    "WHEN UPPER(it.NAME) LIKE '%WONDER%' THEN 'Wonder' " +
    "ELSE 'Other' END) AS TIER, COUNT(*) AS N " +
    "FROM SALEITEMS si " +
    "JOIN SALE s ON s.SITE=si.SITE AND s.OBJID=si.SALEID " +
    "JOIN ITEM it ON it.OBJID=si.ITEM " +
    "JOIN ITEMRPTCATEGORY rc ON rc.OBJID=it.REPORTCATEGORY " +
    `WHERE s.LOGDATE>='${start}' AND s.LOGDATE<='${end}' AND si.FLAGS>=0 AND rc.BRANCH='001001001' ` +
    "GROUP BY 1"

  const { data, error } = await supabase.functions.invoke('site-performance', {
    body: { api: { path: '/api/custom_query', method: 'POST', body: { sql } } },
  })
  if (error) throw new Error(error.message)
  const resp = data as { status?: number; data?: { rows?: Array<[string, number | string]>; error?: unknown } } | null
  if (resp?.data?.error) throw new Error('The wash-package report could not be run right now.')
  const rows = resp?.data?.rows ?? []

  const counts: TierCounts = { wonder: 0, superShine: 0, mighty: 0 }
  for (const [tierRaw, nRaw] of rows) {
    const tier = String(tierRaw).trim()
    const n = Number(nRaw) || 0
    if (tier === 'Wonder') counts.wonder = n
    else if (tier === 'Super Shine') counts.superShine = n
    else if (tier === 'Mighty Protector') counts.mighty = n
  }
  return counts
}
