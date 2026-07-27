import { supabase } from '@/lib/supabase'

// Editable earned-labor-hours benchmark: a forecast-cars band maps to a maximum
// benchmark hours value. Operating at or below the benchmark is the goal.
export type BenchmarkTier = { min_cars: number; max_cars: number | null; max_hours: number }

// One day of actual site performance, used for the rolling chart + MTD summary.
export type LaborDay = {
  date: string
  cars: number
  hours: number
  sales: number
  labor_cost: number
  labor_pct: number | null
  cars_per_hour: number | null
}

// Fallback used when an account has no configured tiers (matches the sample).
export const DEFAULT_TIERS: BenchmarkTier[] = [
  { min_cars: 0, max_cars: 250, max_hours: 42 },
  { min_cars: 251, max_cars: 300, max_hours: 47 },
  { min_cars: 301, max_cars: 350, max_hours: 52 },
  { min_cars: 351, max_cars: 400, max_hours: 57 },
  { min_cars: 401, max_cars: 450, max_hours: 58 },
  { min_cars: 451, max_cars: 500, max_hours: 63 },
  { min_cars: 501, max_cars: 550, max_hours: 69 },
  { min_cars: 551, max_cars: null, max_hours: 75 },
]

// Max benchmark hours for a car count.
export function benchmarkFor(tiers: BenchmarkTier[], cars: number): number {
  for (const t of tiers) {
    if (cars >= t.min_cars && (t.max_cars == null || cars <= t.max_cars)) return t.max_hours
  }
  return tiers.length ? tiers[tiers.length - 1].max_hours : 0
}

type TierRow = { location_id: string | null; min_cars: number; max_cars: number | null; max_hours: number }

export const labor = {
  // Tiers for a site: the site's own override if it has one, else the account
  // default (location_id null), else the built-in default.
  tiersForSite: async (
    accountId: string,
    locationId: string | null,
  ): Promise<{ tiers: BenchmarkTier[]; isSiteOverride: boolean }> => {
    const { data } = await supabase
      .from('labor_benchmark_tiers')
      .select('location_id, min_cars, max_cars, max_hours')
      .eq('account_id', accountId)
    const rows = ((data as TierRow[] | null) ?? []).map((r) => ({ ...r, max_hours: Number(r.max_hours) }))
    const siteRows = locationId ? rows.filter((r) => r.location_id === locationId) : []
    const defaultRows = rows.filter((r) => r.location_id === null)
    const use = siteRows.length ? siteRows : defaultRows.length ? defaultRows : DEFAULT_TIERS.map((t) => ({ location_id: null, ...t }))
    const tiers = use
      .map((r) => ({ min_cars: r.min_cars, max_cars: r.max_cars, max_hours: r.max_hours }))
      .sort((a, b) => a.min_cars - b.min_cars)
    return { tiers, isSiteOverride: siteRows.length > 0 }
  },

  // Replace all tiers for a scope (a site override, or the account default when
  // locationId is null).
  saveTiers: async (accountId: string, locationId: string | null, tiers: BenchmarkTier[]) => {
    let del = supabase.from('labor_benchmark_tiers').delete().eq('account_id', accountId)
    del = locationId ? del.eq('location_id', locationId) : del.is('location_id', null)
    const { error: delErr } = await del
    if (delErr) return { error: delErr }
    if (!tiers.length) return { error: null }
    const { error } = await supabase.from('labor_benchmark_tiers').insert(
      tiers.map((t) => ({ account_id: accountId, location_id: locationId, min_cars: t.min_cars, max_cars: t.max_cars, max_hours: t.max_hours })),
    )
    return { error }
  },

  // Remove a site's override so it falls back to the account default.
  clearSiteOverride: (accountId: string, locationId: string) =>
    supabase.from('labor_benchmark_tiers').delete().eq('account_id', accountId).eq('location_id', locationId),

  // Recent daily actuals for one site (by site number), oldest first.
  days: async (siteNumber: number, sinceISO: string): Promise<LaborDay[]> => {
    const { data } = await supabase
      .from('site_performance_days')
      .select('date, cars, hours, sales, labor_cost, labor_pct, cars_per_hour')
      .eq('site_number', siteNumber)
      .gte('date', sinceISO)
      .order('date', { ascending: true })
    type Row = { date: string; cars: number | null; hours: number | null; sales: number | null; labor_cost: number | null; labor_pct: number | null; cars_per_hour: number | null }
    return ((data as Row[] | null) ?? []).map((r) => ({
      date: r.date,
      cars: Number(r.cars) || 0,
      hours: Number(r.hours) || 0,
      sales: Number(r.sales) || 0,
      labor_cost: Number(r.labor_cost) || 0,
      labor_pct: r.labor_pct == null ? null : Number(r.labor_pct),
      cars_per_hour: r.cars_per_hour == null ? null : Number(r.cars_per_hour),
    }))
  },
}

// Forecast tomorrow's cars from history: average the same weekday over the most
// recent occurrences (up to 4), falling back to the latest day with cars.
export function forecastCars(days: LaborDay[], targetWeekday: number): number {
  const withCars = days.filter((d) => d.cars > 0)
  const sameDow = withCars.filter((d) => new Date(d.date + 'T12:00:00').getDay() === targetWeekday).slice(-4)
  if (sameDow.length) return Math.round(sameDow.reduce((s, d) => s + d.cars, 0) / sameDow.length)
  return withCars.length ? withCars[withCars.length - 1].cars : 0
}
