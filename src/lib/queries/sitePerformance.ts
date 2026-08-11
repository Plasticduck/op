// Site Performance — client access to the Mighty Wash live-ops dashboard, proxied
// through the `site-performance` edge function (the dashboard is password-gated;
// the password lives only as a server secret, never in the browser). One typed
// module for the whole feed, mirroring the dashboard's own JSON shapes.

import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'
import { DEFAULT_REGIONS, resolveRegions, type RegionDef } from '@/lib/regions'

// ---------- Feed shapes (mirror the dashboard's /api/* responses) ----------

export type SiteDay = {
  date: string
  cars: number
  hours: number
  cars_per_hour: number | null
  sales: number
  labor_cost: number
  labor_pct: number | null
}
export type SiteReport = {
  end_date: string
  generated_at: string
  sites: Record<string, SiteDay[]>
}

export type MsaRow = {
  msa: string
  site: string
  today_conversion_pct: number | null
  today_eligible_washes: number
  today_sales: number
  today_hours_worked?: number
  mtd_conversion_pct: number | null
  mtd_eligible_washes: number
  mtd_sales: number
  mtd_days_worked?: number
}
export type MsaReport = { generated_at: string; month_start: string; rows: MsaRow[] }

export type RechargeDay = { date: string; amount: number }
export type RechargeTotal = { date: string; amount: number; source: 'sitewatch' | 'official' }
export type RechargeRevenueReport = {
  cache_generated_at: string | null
  month_start: string
  sites: Record<string, RechargeDay[]>
  mtd_by_site: Record<string, number>
  mtd_total: number
  totals: RechargeTotal[]
}

export type AuditDay = { date: string; count: number; passed: boolean }
export type RechargeAuditReport = { sites: Record<string, AuditDay[]> }

export type RinsedSite = {
  avg_to_date: number | null
  live_conversion_pct: number | null
  days: { date: string; conversion_pct: number | null }[]
}
export type RinsedReport = {
  cache_generated_at: string | null
  company_avg: number | null
  sites: Record<string, RinsedSite>
}

export type Rep = { name: string; conversion_pct: number }
export type Under15Site = {
  site: string
  avg_to_date: number
  top_rep: Rep | null
  low_rep: Rep | null
}
export type Under15Report = {
  cache_generated_at: string | null
  generated_at: string | null
  threshold: number
  company_avg: number | null
  sites: Under15Site[]
}

export type PlanCounts = Record<string, number>
export type PlanSite = {
  today: PlanCounts
  mtd: PlanCounts
  by_employee?: Record<string, { today: PlanCounts; mtd: PlanCounts }>
}
export type PlanBreakdownReport = { sites: Record<string, PlanSite> }

export type ChurnSite = {
  voluntary_churn_pct: number | null
  cc_churn_pct: number | null
  period_total?: number
}
export type ChurnReport = { cache_generated_at: string | null; sites: Record<string, ChurnSite> }

export type HcFlag = {
  msa: string
  site: string
  sales: number
  denominator: number
  conversion_display: string
  likely_cause: string
  earliest_sale_time: string | null
  earliest_punch_in_time: string | null
}
export type HighConversionFlags = { flags: HcFlag[]; threshold: number }

export type RecordEntry = {
  value: number
  date?: string
  month?: string
  site?: string
  msa?: string
  eligible_washes?: number
  conversion_pct?: number | null
  days_worked?: number
  hours_worked?: number
  still_counting?: boolean
}
export type RecordMetric = { day?: RecordEntry; month?: RecordEntry }
export type CompanyRecordsReport = { generated_at: string; records: Record<string, RecordMetric> }

export type SitePerformanceFeed = {
  fetched_at: string
  report: SiteReport | null
  msa: MsaReport | null
  recharge_revenue: RechargeRevenueReport | null
  recharge_audit: RechargeAuditReport | null
  rinsed: RinsedReport | null
  under15: Under15Report | null
  plan_breakdown: PlanBreakdownReport | null
  churn: ChurnReport | null
  high_conversion_flags: HighConversionFlags | null
  company_records: CompanyRecordsReport | null
}

export async function fetchSitePerformance(): Promise<SitePerformanceFeed> {
  const { data, error } = await supabase.functions.invoke('site-performance', { body: {} })
  if (error || (data && data.error)) {
    const msg = await fnErrorMessage(error, data, 'Could not load site performance data.')
    throw new Error(msg)
  }
  return data as SitePerformanceFeed
}

// ---------- Historical archive (site_performance_days) ----------
//
// The live feed only carries ~30 days; this archive accumulates daily so any
// date range can be queried. Rows are scoped to the caller's account by RLS.
export type SitePerfDayRow = {
  site: string
  site_number: number | null
  date: string
  cars: number | null
  hours: number | null
  cars_per_hour: number | null
  sales: number | null
  labor_cost: number | null
  labor_pct: number | null
  recharge: number | null
}

export async function fetchSitePerformanceHistory(
  startDate: string,
  endDate: string,
): Promise<SitePerfDayRow[]> {
  const { data, error } = await supabase
    .from('site_performance_days')
    .select('site, site_number, date, cars, hours, cars_per_hour, sales, labor_cost, labor_pct, recharge')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')
  if (error) throw new Error(error.message)
  return (data as SitePerfDayRow[] | null) ?? []
}

// ---------- Custom Query (dashboard's guided + raw-SQL query feature) ----------
//
// Proxied through the site-performance function's /api passthrough, which reaches
// the dashboard's own query endpoints under the shared authenticated session.
export type CustomQueryResult = {
  columns: string[]
  rows: (string | number | null)[][]
  row_count: number
  truncated?: boolean
  error?: string
}
export type GuidedOption = { key: string; label: string }
export type GuidedSite = { name: string; interior_capable?: boolean }
export type GuidedOptions = { metrics: GuidedOption[]; sites: GuidedSite[] }

async function dashApi(path: string, method: 'GET' | 'POST', apiBody?: unknown): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('site-performance', {
    body: { api: { path, method, body: apiBody } },
  })
  if (error) {
    const msg = await fnErrorMessage(error, data, 'Dashboard request failed.')
    throw new Error(msg)
  }
  return (data as { data?: unknown } | null)?.data ?? null
}

export async function fetchGuidedQueryOptions(): Promise<GuidedOptions> {
  return (await dashApi('/api/guided_query_options', 'GET')) as GuidedOptions
}
export async function runGuidedQuery(p: {
  metric: string
  sites: string[]
  start: string
  end: string
}): Promise<CustomQueryResult> {
  return (await dashApi('/api/guided_query', 'POST', p)) as CustomQueryResult
}
export async function runCustomSql(sql: string): Promise<CustomQueryResult> {
  return (await dashApi('/api/custom_query', 'POST', { sql })) as CustomQueryResult
}

// Just the By-MSA feed (salesperson conversion), without the ~10 other reports
// the full feed pulls. Used by the standalone MSA Performance page.
export async function fetchMsaReport(): Promise<MsaReport> {
  return (await dashApi('/api/msa_report', 'GET')) as MsaReport
}

// ---------- TTAF (Total To Account For) ----------
//
// Monthly per-site figure replicating the dashboard's "TTAF by Site" sheet:
// TTAF = recharge revenue + retail dollars (all the money to account for).
// The report carries every backfilled month, keyed "YYYY-MM" then site number.
export type TtafSite = {
  site_number: number
  cars_washed: number
  actual_recharge_count: number
  actual_recharge_revenue: number
  retail_dollars: number
  ttaf: number
  dollars_per_recharge: number
  pct_rev_from_recharge: number
  conversion_pct: number | null
  total_members: number
}
export type TtafReport = {
  first_month: string | null
  last_live_refresh: string | null
  months: Record<string, Record<string, TtafSite>>
}
export async function fetchTtafReport(): Promise<TtafReport> {
  return (await dashApi('/api/ttaf_report', 'GET')) as TtafReport
}

// ---------- Details (Interior Services / attach rate) ----------
//
// Powers the standalone Details page, mirroring the dashboard's "Details" tab.
// Attach rate = (hustles + intro MVP + mighty MVP sales) / cars washed. Teams
// and per-site rollups each carry a live "today" figure and a month-to-date one;
// the daily breakdown is a separate per-site + month query.
export type InteriorDailyRow = {
  date: string
  cars: number
  hustles: number
  intro_mvp: number
  mighty_mvp: number
  conv: number
  run_pct: number
  extras: number
}
export type InteriorTeam = {
  team: string
  sites: number[]
  today_cars: number; today_conv: number; today_hustles: number
  today_intro_mvp: number; today_mighty_mvp: number; today_pct: number; today_extras: number
  mtd_cars: number; mtd_conv: number; mtd_hustles: number
  mtd_intro_mvp: number; mtd_mighty_mvp: number; mtd_pct: number; mtd_extras: number
}
export type InteriorSiteRollup = {
  site_number: number
  site_name: string
  team: string | null
  yesterday_pct: number | null
  today_cars: number; today_conv: number; today_hustles: number
  today_intro_mvp: number; today_mighty_mvp: number; today_pct: number; today_extras: number
  mtd_cars: number; mtd_conv: number; mtd_hustles: number
  mtd_intro_mvp: number; mtd_mighty_mvp: number; mtd_pct: number; mtd_extras: number
}
export type InteriorServicesReport = {
  generated_at: string
  window: { start: string; end: string }
  commentary: string[]
  teams: InteriorTeam[]
  site_rollup: InteriorSiteRollup[]
  site_daily: Record<string, InteriorDailyRow[]>
}
export async function fetchInteriorServicesReport(): Promise<InteriorServicesReport> {
  return (await dashApi('/api/interior_services_report', 'GET')) as InteriorServicesReport
}

export type InteriorDailyBreakdown = {
  site_number: number | string
  year: number
  month: number
  days: InteriorDailyRow[]
  totals: {
    cars: number; conv: number; hustles: number
    intro_mvp: number; mighty_mvp: number; pct: number; extras: number
  }
}
export async function fetchInteriorDailyBreakdown(
  site: string | number,
  year: number,
  month: number,
): Promise<InteriorDailyBreakdown> {
  const q = `?site=${encodeURIComponent(String(site))}&year=${year}&month=${month}`
  return (await dashApi(`/api/interior_daily_breakdown${q}`, 'GET')) as InteriorDailyBreakdown
}

// Earliest and latest archived dates, so the UI can show what history exists.
export async function fetchSitePerformanceHistoryBounds(): Promise<{ min: string | null; max: string | null }> {
  const [{ data: lo }, { data: hi }] = await Promise.all([
    supabase.from('site_performance_days').select('date').order('date', { ascending: true }).limit(1),
    supabase.from('site_performance_days').select('date').order('date', { ascending: false }).limit(1),
  ])
  return {
    min: (lo as { date: string }[] | null)?.[0]?.date ?? null,
    max: (hi as { date: string }[] | null)?.[0]?.date ?? null,
  }
}

// ---------- Per-site metric extraction ----------
//
// The feeds name sites inconsistently, so pull a site's headline numbers by its
// site NUMBER. Shared by the dashboard cards and region views.

function findByNumber<T>(rec: Record<string, T> | null | undefined, n: number | null): T | undefined {
  if (!rec || n == null) return undefined
  for (const [k, v] of Object.entries(rec)) if (siteNumber(k) === n) return v
  return undefined
}

export type SiteMetrics = {
  cars: number | null
  sales: number | null
  carsPerHour: number | null
  laborPct: number | null
  conversion: number | null
  churn: number | null
  rechargeMtd: number | null
  plansSold: number | null
}

export function siteMetrics(feed: SitePerformanceFeed | null, n: number | null): SiteMetrics {
  const days = findByNumber<SiteDay[]>(feed?.report?.sites, n)
  const day = days && days.length ? days[days.length - 1] : undefined
  const msaRow = feed?.msa?.rows?.find((r) => siteNumber(r.site) === n)
  const churn = findByNumber(feed?.churn?.sites, n)
  // Plans sold today = the sum of every plan tier's today count for the site.
  const plan = findByNumber<PlanSite>(feed?.plan_breakdown?.sites, n)
  const plansSold = plan?.today ? Object.values(plan.today).reduce((a, b) => a + (Number(b) || 0), 0) : null
  return {
    cars: day?.cars ?? null,
    sales: day?.sales ?? msaRow?.today_sales ?? null,
    carsPerHour: day?.cars_per_hour ?? null,
    laborPct: day?.labor_pct ?? null,
    conversion: msaRow?.today_conversion_pct ?? null,
    churn: churn?.voluntary_churn_pct ?? null,
    rechargeMtd: findByNumber<number>(feed?.recharge_revenue?.mtd_by_site, n) ?? null,
    plansSold,
  }
}

// ---------- Region mapping ----------
//
// The dashboard names sites inconsistently across feeds ("MightyWash 001",
// "Mighty Wash #1", "MightyWash 017"), so every mapping keys off the site
// NUMBER pulled from the name. The number-to-region table is derived from the
// account's saved regions when it has them (resolving each region's location ids
// to a site number via the loaded locations), and falls back to the built-in
// DEFAULT_REGIONS otherwise, so sites always group even before regions are saved.

export const OTHER_REGION = 'Other'

// First run of digits in a name: "MightyWash 001" -> 1, "Mighty Wash #24" -> 24.
export function siteNumber(name: string): number | null {
  const m = name.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

export type RegionIndex = { order: string[]; regionForNumber: (n: number | null) => string }

export function buildRegionIndex(
  locations: { id: string; name: string }[],
  savedRegions?: RegionDef[] | null,
): RegionIndex {
  const saved = resolveRegions(savedRegions)
  const byNumber = new Map<number, string>()
  const order: string[] = []

  if (saved.length) {
    const numberByLocId = new Map<string, number>()
    for (const l of locations) {
      const n = siteNumber(l.name)
      if (n !== null) numberByLocId.set(l.id, n)
    }
    for (const r of saved) {
      order.push(r.name)
      for (const id of r.siteIds) {
        const n = numberByLocId.get(id)
        if (n !== null && n !== undefined) byNumber.set(n, r.name)
      }
    }
  } else {
    for (const r of DEFAULT_REGIONS) {
      order.push(r.name)
      for (const s of r.sites) {
        const n = siteNumber(s)
        if (n !== null) byNumber.set(n, r.name)
      }
    }
  }
  order.push(OTHER_REGION)

  return {
    order,
    regionForNumber: (n) => (n !== null && byNumber.has(n) ? byNumber.get(n)! : OTHER_REGION),
  }
}

// Group any list of dashboard site entities into region order, dropping empty
// regions. `nameOf` extracts the site name from each entity.
export function groupByRegion<T>(
  items: T[],
  nameOf: (item: T) => string,
  index: RegionIndex,
): { region: string; items: T[] }[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const region = index.regionForNumber(siteNumber(nameOf(item)))
    const list = buckets.get(region) ?? []
    list.push(item)
    buckets.set(region, list)
  }
  // Within each region, list sites in numerical order (unnumbered sites last).
  const bySiteNumber = (a: T, b: T) => {
    const na = siteNumber(nameOf(a))
    const nb = siteNumber(nameOf(b))
    if (na == null && nb == null) return 0
    if (na == null) return 1
    if (nb == null) return -1
    return na - nb
  }
  return index.order
    .filter((r) => buckets.has(r))
    .map((region) => ({ region, items: buckets.get(region)!.slice().sort(bySiteNumber) }))
}
