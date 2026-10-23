import { supabase } from '@/lib/supabase'
import { flexwashSales, type FlexSite } from '@/lib/queries/flexwashSales'
import { fetchMonthlyCars } from '@/lib/queries/sitePerformance'

// Monthly wash-package usage for the Chemicals hub, broken down by site. Counts
// EVERY wash that used each package (retail sales + member redemptions), across
// all wash sites except EXCLUDED_SITES:
//  - DRB SiteWatch sites: from the POS ledger (same source as the dashboards) via
//    the site-performance custom-query proxy. Packages live under the "Carwashes"
//    report category (BRANCH 001001001); each wash posts exactly one package line
//    there (members post it too, offset by redemption discounts elsewhere). Site
//    name comes from SITELIST (SALE.SITE = SITELIST.ID -> SITENAME "MightyWash 0NN").
//    "MIGHTY PROT" (not "PROTECT") so "Mighty Prot +HD" counts as Mighty Protector.
//  - FlexWash sites: counted from FlexWash line items like the FlexWash Sales
//    report does (flexwashSales.lineItemBreakdown -> carsByTier: one paid "Package"
//    line per wash, member redemptions included), minus SKIP_FLEX_PACKAGE.
//  Each FlexWash site switches on its cutover date (flexwash_sites.start_date):
//  SiteWatch counts it through that day (sites switch mid-day), FlexWash from that
//  day on, so a month that spans a cutover keeps both halves and nothing is double
//  counted (SiteWatch only has stray residuals after cutover). One row per site.
//  - Sites on neither system (MW33): their monthly car total from
//    site_performance_months (the car count sheet), shown as a total-only row with
//    no package split. It counts in the grand total of washes, not the packages.

export type TierKey = 'wonder' | 'superShine' | 'mighty'
// One package (item name) at one site, from one source; count is washes.
export type PackageLine = { name: string; tier: TierKey; source: 'SiteWatch' | 'FlexWash'; count: number }
export type SitePackageRow = {
  site: string
  wonder: number
  superShine: number
  mighty: number
  total: number
  packages: PackageLine[]
  // Total washes only (from the monthly car count sheet), no package split.
  totalOnly?: boolean
}
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

const swName = (n: number) => `MightyWash ${String(n).padStart(3, '0')}`

const dayAfter = (d: string) => new Date(new Date(d + 'T00:00:00Z').getTime() + 86_400_000).toISOString().slice(0, 10)

// SQL condition that drops each FlexWash site's SiteWatch rows after its cutover
// (SITENAME is "MightyWash 0NN"). The cutover day itself keeps its SiteWatch rows:
// sites switch mid-day (e.g. MW12 on 9/14: 192 washes in SiteWatch, 65 in
// FlexWash), and after that SiteWatch only has stray residuals. Sites not yet on
// FlexWash, or cutting over after the range, are left alone.
function cutoverExclusions(flex: FlexSite[], start: string, end: string): string {
  return flex
    .filter((s) => s.start_date && dayAfter(s.start_date) <= end)
    .map((s) => dayAfter(s.start_date!) <= start
      ? `AND TRIM(sl.SITENAME)<>'${swName(s.site_number)}' `
      : `AND NOT (TRIM(sl.SITENAME)='${swName(s.site_number)}' AND s.LOGDATE>='${dayAfter(s.start_date!)}') `)
    .join('')
}

// Left out of the report and its grand total (requested 2026-10-20): MW19 is the
// lube shop and Headquarters isn't a wash site. Matched on the SiteWatch SITENAME
// the rows carry. Filtered after the fetch rather than in the SQL so the
// dashboard's query endpoint sees the same query it already accepts.
const EXCLUDED_SITES = new Set(['MightyWash 019', 'Mighty Wash Headquarters'])

// FlexWash package lines left out of the counts (requested 2026-10-23): the
// "- Issue" packages (e.g. "Wonder Clean - Issue") and the Wex/Voyager fleet plan
// lines ("Wex/Voyager Yearly Mighty", "Wex/Voyager 1 Month Super").
const SKIP_FLEX_PACKAGE = (name: string) => /-\s*issue\s*$/i.test(name.trim()) || /wex|voyager/i.test(name)

// Sort key: the trailing site number ("MightyWash 001" -> 1); names without a
// number (e.g. Headquarters) sort last.
function siteNum(name: string): number {
  const m = name.match(/(\d+)\s*$/)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

async function fetchSiteWatchPerSite(start: string, end: string, flex: FlexSite[]): Promise<SitePackageRow[]> {
  const sql =
    "SELECT TRIM(sl.SITENAME) AS SITE, (CASE " +
    "WHEN UPPER(it.NAME) LIKE '%MIGHTY PROT%' THEN 'M' " +
    "WHEN UPPER(it.NAME) LIKE '%SUPER SHINE%' THEN 'S' ELSE 'W' END) AS TIER, TRIM(it.NAME) AS ITEM, COUNT(*) AS N " +
    "FROM SALEITEMS si " +
    "JOIN SALE s ON s.SITE=si.SITE AND s.OBJID=si.SALEID " +
    "JOIN ITEM it ON it.OBJID=si.ITEM " +
    "JOIN ITEMRPTCATEGORY rc ON rc.OBJID=it.REPORTCATEGORY " +
    "JOIN SITELIST sl ON sl.ID=s.SITE " +
    `WHERE s.LOGDATE>='${start}' AND s.LOGDATE<='${end}' AND si.FLAGS>=0 AND rc.BRANCH='001001001' ` +
    "AND (UPPER(it.NAME) LIKE '%MIGHTY PROT%' OR UPPER(it.NAME) LIKE '%SUPER SHINE%' OR UPPER(it.NAME) LIKE '%WONDER%') " +
    cutoverExclusions(flex, start, end) +
    "GROUP BY 1, 2, 3"

  const { data, error } = await supabase.functions.invoke('site-performance', {
    body: { api: { path: '/api/custom_query', method: 'POST', body: { sql } } },
  })
  if (error) throw new Error(error.message)
  const resp = data as { data?: { rows?: Array<[string, string, string, number | string]>; error?: unknown } } | null
  if (resp?.data?.error) throw new Error('The wash-package report could not be run right now.')
  const rows = resp?.data?.rows ?? []

  const bySite = new Map<string, SitePackageRow>()
  for (const [siteRaw, tierRaw, itemRaw, nRaw] of rows) {
    const site = String(siteRaw).trim()
    const n = Number(nRaw) || 0
    const row = bySite.get(site) ?? { site, wonder: 0, superShine: 0, mighty: 0, total: 0, packages: [] }
    const code = String(tierRaw).trim()
    const tier: TierKey = code === 'M' ? 'mighty' : code === 'S' ? 'superShine' : 'wonder'
    row[tier] += n
    row.total = row.wonder + row.superShine + row.mighty
    row.packages.push({ name: String(itemRaw).trim(), tier, source: 'SiteWatch', count: n })
    bySite.set(site, row)
  }
  return [...bySite.values()]
}

const FLEX_TIER: Record<string, TierKey> = { Wonder: 'wonder', 'Super Shine': 'superShine', Mighty: 'mighty' }

async function fetchFlexPerSite(start: string, end: string, flex: FlexSite[]): Promise<SitePackageRow[]> {
  // Only sites on FlexWash during the range, from their cutover on.
  const active = flex.filter((s) => s.car_wash_id && s.start_date && s.start_date <= end)
  if (!active.length) return []
  return Promise.all(
    active.map(async (st) => {
      const from = st.start_date! > start ? st.start_date! : start
      const bd = await flexwashSales.lineItemBreakdown([st.car_wash_id], from, end, { skipPackage: SKIP_FLEX_PACKAGE })
      const row: SitePackageRow = { site: swName(st.site_number), wonder: 0, superShine: 0, mighty: 0, total: 0, packages: [] }
      for (const p of bd.carsByPackage) {
        const tier = FLEX_TIER[p.tier]
        if (!tier) continue // "Other" packages aren't one of the three
        row[tier] += p.count
        row.packages.push({ name: p.name, tier, source: 'FlexWash', count: p.count })
      }
      row.total = row.wonder + row.superShine + row.mighty
      return row
    }),
  )
}

export async function fetchPackageReport(ym: string): Promise<PackageReport> {
  const { start, end } = monthRange(ym)
  const flexSites = await flexwashSales.sites().catch(() => [] as FlexSite[])
  const sw = await fetchSiteWatchPerSite(start, end, flexSites)
  // FlexWash is best-effort: if it fails, still show the SiteWatch sites and flag it.
  let flex: SitePackageRow[] = []
  let flexIncluded = false
  try {
    flex = await fetchFlexPerSite(start, end, flexSites)
    flexIncluded = true
  } catch {
    /* keep SiteWatch-only, flexIncluded stays false */
  }

  // A site that cut over mid-month has a SiteWatch part and a FlexWash part: one row.
  const merged = new Map<string, SitePackageRow>()
  for (const r of [...sw, ...flex]) {
    const m = merged.get(r.site)
    if (!m) { merged.set(r.site, { ...r, packages: [...r.packages] }); continue }
    m.wonder += r.wonder; m.superShine += r.superShine; m.mighty += r.mighty; m.total += r.total
    m.packages.push(...r.packages)
  }
  // Packages listed Wonder -> Super Shine -> Mighty, SiteWatch before FlexWash
  // (a split site's DRB days came first), biggest first.
  const tierRank: Record<TierKey, number> = { wonder: 0, superShine: 1, mighty: 2 }
  const sourceRank = (s: PackageLine['source']) => (s === 'SiteWatch' ? 0 : 1)
  for (const r of merged.values()) {
    r.packages.sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || sourceRank(a.source) - sourceRank(b.source) || b.count - a.count)
  }
  // Sites with no package data anywhere: their monthly total from the car count sheet.
  const monthly = await fetchMonthlyCars(start, end).catch(() => new Map<number, number>())
  for (const [n, cars] of monthly) {
    const site = swName(n)
    if (merged.has(site) || cars <= 0) continue
    merged.set(site, { site, wonder: 0, superShine: 0, mighty: 0, total: cars, packages: [], totalOnly: true })
  }
  const sites = [...merged.values()]
    .filter((r) => !EXCLUDED_SITES.has(r.site))
    .sort((a, b) => siteNum(a.site) - siteNum(b.site) || a.site.localeCompare(b.site))
  const grand = sites.reduce<PackageTotals>(
    (a, r) => ({ wonder: a.wonder + r.wonder, superShine: a.superShine + r.superShine, mighty: a.mighty + r.mighty, total: a.total + r.total }),
    { wonder: 0, superShine: 0, mighty: 0, total: 0 },
  )
  return { sites, grand, flexIncluded }
}
