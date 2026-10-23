import { fetchSitePerformance, fetchSitePerformanceHistory, siteNumber } from '@/lib/queries/sitePerformance'

// Official cars washed per site over a date range, keyed by store number.
// The live dashboard feed (~30 days, includes today so far, every site incl.
// FlexWash) covers recent dates; anything older than the feed comes from the
// site_performance_days archive. Same split the Site Performance By Site tab uses.
// (The dashboard's guided cars query is NOT used: its roster omits FlexWash sites.)
export async function fetchCarsBySite(start: string, end: string): Promise<Map<number, number>> {
  const feed = await fetchSitePerformance()
  const sites = feed.report?.sites ?? {}
  const out = new Map<number, number>()
  let feedMin = ''
  for (const [name, days] of Object.entries(sites)) {
    const n = siteNumber(name)
    for (const d of days) {
      if (!feedMin || d.date < feedMin) feedMin = d.date
      if (n == null || d.date < start || d.date > end) continue
      out.set(n, (out.get(n) ?? 0) + (Number(d.cars) || 0))
    }
  }
  // Dates before the feed's window come from the archive.
  if (feedMin && start < feedMin) {
    const before = new Date(new Date(feedMin + 'T00:00:00Z').getTime() - 86_400_000).toISOString().slice(0, 10)
    const archiveEnd = end < before ? end : before
    for (const r of await fetchSitePerformanceHistory(start, archiveEnd)) {
      const n = r.site_number ?? siteNumber(r.site)
      if (n == null) continue
      out.set(n, (out.get(n) ?? 0) + (Number(r.cars) || 0))
    }
  }
  return out
}
