import { supabase } from '@/lib/supabase'
import { flexwashSales } from '@/lib/queries/flexwashSales'

// Monthly wash-package usage for the Chemicals hub, broken down by site. Counts
// EVERY wash that used each package (retail sales + member redemptions), across
// ALL sites:
//  - DRB SiteWatch sites: from the POS ledger (same source as the dashboards) via
//    the site-performance custom-query proxy. Packages live under the "Carwashes"
//    report category (BRANCH 001001001); each wash posts exactly one package line
//    there (members post it too, offset by redemption discounts elsewhere). Site
//    name comes from SITELIST (SALE.SITE = SITELIST.ID -> SITENAME "MightyWash 0NN").
//    MW17/MW18 are FlexWash now; their SiteWatch rows are tiny residuals, so they
//    are excluded here and taken from FlexWash instead (no double-count).
//  - FlexWash sites (MW17/MW18): per site, counted from FlexWash line items exactly
//    as the FlexWash Sales report does (flexwashSales.lineItemBreakdown -> carsByTier:
//    one paid "Package" line per wash, member redemptions included).

export type SitePackageRow = { site: string; wonder: number; superShine: number; mighty: number; total: number }
export type PackageTotals = { wonder: number; superShine: number; mighty: number; total: number }
export type PackageReport = { sites: SitePackageRow[]; grand: PackageTotals; flexIncluded: boolean }

// First and last calendar day (YYYY-MM-DD) of a 'YYYY-MM' month.
export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, '0')}` }
}

// The most recent COMPLETE month as 'YYYY-MM' (last month).
export function lastCompleteMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// FlexWash sites to take from FlexWash instead of SiteWatch (their DRB rows are
// stale residuals). Matched on the SiteWatch SITENAME.
const FLEX_SITENAMES = ["'MightyWash 017'", "'MightyWash 018'"].join(', ')

// Sort key: the trailing site number ("MightyWash 001" -> 1); names without a
// number (e.g. Headquarters) sort last.
function siteNum(name: string): number {
  const m = name.match(/(\d+)\s*$/)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

async function fetchSiteWatchPerSite(start: string, end: string): Promise<SitePackageRow[]> {
  const sql =
    "SELECT TRIM(sl.SITENAME) AS SITE, (CASE " +
    "WHEN UPPER(it.NAME) LIKE '%MIGHTY PROTECT%' THEN 'M' " +
    "WHEN UPPER(it.NAME) LIKE '%SUPER SHINE%' THEN 'S' ELSE 'W' END) AS TIER, COUNT(*) AS N " +
    "FROM SALEITEMS si " +
    "JOIN SALE s ON s.SITE=si.SITE AND s.OBJID=si.SALEID " +
    "JOIN ITEM it ON it.OBJID=si.ITEM " +
    "JOIN ITEMRPTCATEGORY rc ON rc.OBJID=it.REPORTCATEGORY " +
    "JOIN SITELIST sl ON sl.ID=s.SITE " +
    `WHERE s.LOGDATE>='${start}' AND s.LOGDATE<='${end}' AND si.FLAGS>=0 AND rc.BRANCH='001001001' ` +
    "AND (UPPER(it.NAME) LIKE '%MIGHTY PROTECT%' OR UPPER(it.NAME) LIKE '%SUPER SHINE%' OR UPPER(it.NAME) LIKE '%WONDER%') " +
    `AND TRIM(sl.SITENAME) NOT IN (${FLEX_SITENAMES}) ` +
    "GROUP BY 1, 2"

  const { data, error } = await supabase.functions.invoke('site-performance', {
    body: { api: { path: '/api/custom_query', method: 'POST', body: { sql } } },
  })
  if (error) throw new Error(error.message)
  const resp = data as { data?: { rows?: Array<[string, string, number | string]>; error?: unknown } } | null
  if (resp?.data?.error) throw new Error('The wash-package report could not be run right now.')
  const rows = resp?.data?.rows ?? []

  const bySite = new Map<string, SitePackageRow>()
  for (const [siteRaw, tierRaw, nRaw] of rows) {
    const site = String(siteRaw).trim()
    const n = Number(nRaw) || 0
    const row = bySite.get(site) ?? { site, wonder: 0, superShine: 0, mighty: 0, total: 0 }
    const tier = String(tierRaw).trim()
    if (tier === 'M') row.mighty += n
    else if (tier === 'S') row.superShine += n
    else row.wonder += n
    row.total = row.wonder + row.superShine + row.mighty
    bySite.set(site, row)
  }
  return [...bySite.values()]
}

async function fetchFlexPerSite(start: string, end: string): Promise<SitePackageRow[]> {
  const sites = await flexwashSales.sites()
  const active = sites.filter((s) => s.car_wash_id)
  if (!active.length) return []
  return Promise.all(
    active.map(async (st) => {
      const bd = await flexwashSales.lineItemBreakdown([st.car_wash_id], start, end)
      let wonder = 0, superShine = 0, mighty = 0
      for (const t of bd.carsByTier) {
        if (t.label === 'Wonder') wonder = t.count
        else if (t.label === 'Super Shine') superShine = t.count
        else if (t.label === 'Mighty') mighty = t.count
      }
      const site = `MightyWash ${String(st.site_number).padStart(3, '0')}`
      return { site, wonder, superShine, mighty, total: wonder + superShine + mighty }
    }),
  )
}

export async function fetchPackageReport(ym: string): Promise<PackageReport> {
  const { start, end } = monthRange(ym)
  const sw = await fetchSiteWatchPerSite(start, end)
  // FlexWash is best-effort: if it fails, still show the SiteWatch sites and flag it.
  let flex: SitePackageRow[] = []
  let flexIncluded = false
  try {
    flex = await fetchFlexPerSite(start, end)
    flexIncluded = true
  } catch {
    /* keep SiteWatch-only, flexIncluded stays false */
  }

  const sites = [...sw, ...flex].sort((a, b) => siteNum(a.site) - siteNum(b.site) || a.site.localeCompare(b.site))
  const grand = sites.reduce<PackageTotals>(
    (a, r) => ({ wonder: a.wonder + r.wonder, superShine: a.superShine + r.superShine, mighty: a.mighty + r.mighty, total: a.total + r.total }),
    { wonder: 0, superShine: 0, mighty: 0, total: 0 },
  )
  return { sites, grand, flexIncluded }
}
