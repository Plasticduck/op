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
//    Flash ("Flash Wash") is a fourth package that only some sites sell, and
//    "Test Car" washes count in their own column (they use chemicals too; Site
//    Performance leaves them out). Lines are summed by QTY, so a refunded wash
//    (original sale + a -1 refund ticket) nets to zero, as in DRB's car count.
//  - FlexWash sites: counted from FlexWash line items like the FlexWash Sales
//    report does (flexwashSales.lineItemBreakdown -> carsByPackage: one paid
//    "Package" line per wash, member redemptions included), plus promotional
//    washes. "- Issue" washes count under the package their name carries and
//    Grand Opening Wash under Other. The Wex/Voyager fleet plan lines stay out,
//    as do interior-only and add-on "packages" (Express Interior, Wheel and Tire).
//  Each FlexWash site adds FlexWash from its cutover date (flexwash_sites.start_date)
//  on, while SiteWatch counts every day: before the cutover that's the whole site,
//  on the cutover day the half before the switch, and after it a few stray washes
//  still rung up in SiteWatch, which Operator keeps (as the car count sheet and
//  Site Performance do; the dashboard's TTAF drops them). One row per site.
//  - Sites on neither system (MW33): their monthly car total from
//    site_performance_months (the car count sheet), shown as a total-only row with
//    no package split. It counts in the grand total of washes, not the packages.

export type TierKey = 'flash' | 'wonder' | 'superShine' | 'mighty' | 'testCar' | 'other'
// One package (item name) at one site, from one source; count is washes.
export type PackageLine = { name: string; tier: TierKey; source: 'SiteWatch' | 'FlexWash'; count: number }
export type PackageTotals = {
  flash: number
  wonder: number
  superShine: number
  mighty: number
  testCar: number
  other: number
  total: number
}
export type SitePackageRow = PackageTotals & {
  site: string
  packages: PackageLine[]
  // Total washes only (from the monthly car count sheet), no package split.
  totalOnly?: boolean
}
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

const emptyRow = (site: string): SitePackageRow =>
  ({ site, flash: 0, wonder: 0, superShine: 0, mighty: 0, testCar: 0, other: 0, total: 0, packages: [] })
const tierSum = (r: PackageTotals) => r.flash + r.wonder + r.superShine + r.mighty + r.testCar + r.other

// Left out of the report and its grand total (requested 2026-10-20): MW19 is the
// lube shop and Headquarters isn't a wash site. Matched on the SiteWatch SITENAME
// the rows carry. Filtered after the fetch rather than in the SQL so the
// dashboard's query endpoint sees the same query it already accepts.
const EXCLUDED_SITES = new Set(['MightyWash 019', 'Mighty Wash Headquarters'])

// FlexWash package lines left out of the counts (requested 2026-10-23): the
// Wex/Voyager fleet plan lines ("Wex/Voyager Yearly Mighty", "Wex/Voyager 1 Month
// Super"). The "- Issue" packages were left out at first, then added back the
// same day: they're real washes, counted as cars.
const SKIP_FLEX_PACKAGE = (name: string) => /wex|voyager/i.test(name)

// FlexWash wash packages that aren't one of the named packages but are real
// washes (requested 2026-10-23): counted under Other. Interiors stay out.
const OTHER_FLEX_WASH = (name: string) => /grand opening wash/i.test(name)

// Sort key: the trailing site number ("MightyWash 001" -> 1); names without a
// number (e.g. Headquarters) sort last.
function siteNum(name: string): number {
  const m = name.match(/(\d+)\s*$/)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

async function fetchSiteWatchPerSite(start: string, end: string): Promise<SitePackageRow[]> {
  const sql =
    "SELECT TRIM(sl.SITENAME) AS SITE, (CASE " +
    "WHEN UPPER(it.NAME) LIKE '%MIGHTY PROT%' THEN 'M' " +
    "WHEN UPPER(it.NAME) LIKE '%SUPER SHINE%' THEN 'S' " +
    "WHEN UPPER(it.NAME) LIKE '%FLASH%' THEN 'F' " +
    "WHEN UPPER(it.NAME) LIKE '%TEST CAR%' THEN 'T' ELSE 'W' END) AS TIER, TRIM(it.NAME) AS ITEM, SUM(si.QTY) AS N " +
    "FROM SALEITEMS si " +
    "JOIN SALE s ON s.SITE=si.SITE AND s.OBJID=si.SALEID " +
    "JOIN ITEM it ON it.OBJID=si.ITEM " +
    "JOIN ITEMRPTCATEGORY rc ON rc.OBJID=it.REPORTCATEGORY " +
    "JOIN SITELIST sl ON sl.ID=s.SITE " +
    `WHERE s.LOGDATE>='${start}' AND s.LOGDATE<='${end}' AND si.FLAGS>=0 AND rc.BRANCH='001001001' ` +
    "AND (UPPER(it.NAME) LIKE '%MIGHTY PROT%' OR UPPER(it.NAME) LIKE '%SUPER SHINE%' OR UPPER(it.NAME) LIKE '%WONDER%' " +
    "OR UPPER(it.NAME) LIKE '%FLASH%' OR UPPER(it.NAME) LIKE '%TEST CAR%') " +
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
    if (n === 0) continue // every sale of it was refunded
    const row = bySite.get(site) ?? emptyRow(site)
    const code = String(tierRaw).trim()
    const tier: TierKey =
      code === 'M' ? 'mighty' : code === 'S' ? 'superShine' : code === 'F' ? 'flash' : code === 'T' ? 'testCar' : 'wonder'
    row[tier] += n
    row.total = tierSum(row)
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
      const bd = await flexwashSales.lineItemBreakdown([st.car_wash_id], from, end, { includePromotional: true })
      const row = emptyRow(swName(st.site_number))
      for (const p of bd.carsByPackage) {
        if (SKIP_FLEX_PACKAGE(p.name)) continue
        // FlexWash's own tiers don't include Flash or Grand Opening (they land in
        // its "Other"), so match those by name.
        const tier: TierKey | undefined = FLEX_TIER[p.tier]
          ?? (/flash/i.test(p.name) ? 'flash' : OTHER_FLEX_WASH(p.name) ? 'other' : undefined)
        if (!tier) continue // interiors, add-ons and the like aren't washes
        row[tier] += p.count
        row.packages.push({ name: p.name, tier, source: 'FlexWash', count: p.count })
      }
      row.total = tierSum(row)
      return row
    }),
  )
}

export async function fetchPackageReport(ym: string): Promise<PackageReport> {
  const { start, end } = monthRange(ym)
  const [flexSites, sw] = await Promise.all([
    flexwashSales.sites().catch(() => [] as FlexSite[]),
    fetchSiteWatchPerSite(start, end),
  ])
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
    m.flash += r.flash; m.wonder += r.wonder; m.superShine += r.superShine; m.mighty += r.mighty
    m.testCar += r.testCar; m.other += r.other; m.total += r.total
    m.packages.push(...r.packages)
  }
  // Packages listed Flash -> Wonder -> Super Shine -> Mighty -> Test Car -> Other,
  // SiteWatch before FlexWash (a split site's DRB days came first), biggest first.
  const tierRank: Record<TierKey, number> = { flash: 0, wonder: 1, superShine: 2, mighty: 3, testCar: 4, other: 5 }
  const sourceRank = (s: PackageLine['source']) => (s === 'SiteWatch' ? 0 : 1)
  for (const r of merged.values()) {
    r.packages.sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || sourceRank(a.source) - sourceRank(b.source) || b.count - a.count)
  }
  // Sites with no package data anywhere: their monthly total from the car count sheet.
  const monthly = await fetchMonthlyCars(start, end).catch(() => new Map<number, number>())
  for (const [n, cars] of monthly) {
    const site = swName(n)
    if (merged.has(site) || cars <= 0) continue
    merged.set(site, { ...emptyRow(site), total: cars, totalOnly: true })
  }
  const sites = [...merged.values()]
    .filter((r) => !EXCLUDED_SITES.has(r.site))
    .sort((a, b) => siteNum(a.site) - siteNum(b.site) || a.site.localeCompare(b.site))
  const grand = sites.reduce<PackageTotals>(
    (a, r) => ({
      flash: a.flash + r.flash,
      wonder: a.wonder + r.wonder,
      superShine: a.superShine + r.superShine,
      mighty: a.mighty + r.mighty,
      testCar: a.testCar + r.testCar,
      other: a.other + r.other,
      total: a.total + r.total,
    }),
    { flash: 0, wonder: 0, superShine: 0, mighty: 0, testCar: 0, other: 0, total: 0 },
  )
  return { sites, grand, flexIncluded }
}
