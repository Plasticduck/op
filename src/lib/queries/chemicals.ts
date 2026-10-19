import { supabase } from '@/lib/supabase'

// Monthly wash-package usage for the Chemicals hub. Counts EVERY wash that used
// each package (retail sales + member redemptions) from the DRB SiteWatch POS
// ledger — the same source the dashboards use — via the site-performance custom
// query proxy. Packages live under the "Carwashes" report category (BRANCH
// 001001001); each wash posts exactly one package line there (members post the
// package too, offset by redemption discounts in other categories), so counting
// those lines by tier gives total usage, not just retail. FlexWash sites
// (MW17/MW18) aren't in SiteWatch, so they're not included.

export type PackageCounts = { wonder: number; superShine: number; mighty: number; total: number }

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

export async function fetchPackageCounts(ym: string): Promise<PackageCounts> {
  const { start, end } = monthRange(ym)
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

  const counts: PackageCounts = { wonder: 0, superShine: 0, mighty: 0, total: 0 }
  for (const [tierRaw, nRaw] of rows) {
    const tier = String(tierRaw).trim()
    const n = Number(nRaw) || 0
    if (tier === 'Wonder') counts.wonder = n
    else if (tier === 'Super Shine') counts.superShine = n
    else if (tier === 'Mighty Protector') counts.mighty = n
  }
  counts.total = counts.wonder + counts.superShine + counts.mighty
  return counts
}
