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

export type WeatherDay = {
  date: string
  precip_in: number | null
  conditions: string | null
  temp_max: number | null
  temp_min: number | null
  weather_code: number | null
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

  // Recent + forecast weather for one site (by Operator location id), oldest first.
  weather: async (locationId: string, sinceISO: string): Promise<WeatherDay[]> => {
    const { data } = await supabase
      .from('weather_days')
      .select('date, precip_in, conditions, temp_max, temp_min, weather_code')
      .eq('location_id', locationId)
      .gte('date', sinceISO)
      .order('date', { ascending: true })
    return ((data as WeatherDay[] | null) ?? []).map((w) => ({
      ...w,
      precip_in: w.precip_in == null ? null : Number(w.precip_in),
      temp_max: w.temp_max == null ? null : Number(w.temp_max),
      temp_min: w.temp_min == null ? null : Number(w.temp_min),
    }))
  },

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

// Tunable weather effect on the forecast. `rain` tiers cut the forecast by a
// percentage once precipitation reaches the tier's threshold (heaviest matching
// tier wins). `temp` tiers cut it when the forecast high is at/below the tier's
// temperature (coldest matching tier wins). Percentages are negative = a cut.
export type WeatherAdjustConfig = {
  rain: Array<{ min_in: number; pct: number }>
  temp: Array<{ max_f: number; pct: number }>
}

export const DEFAULT_WEATHER_CONFIG: WeatherAdjustConfig = {
  rain: [
    { min_in: 0.1, pct: -10 }, // light
    { min_in: 0.25, pct: -20 }, // moderate
    { min_in: 0.5, pct: -35 }, // heavy
  ],
  temp: [
    { max_f: 32, pct: -35 }, // freezing (high at/below 32)
    { max_f: 40, pct: -15 }, // near freezing
    { max_f: 50, pct: -5 }, // cold
  ],
}

export type WeatherForecast = {
  cars: number // weather-adjusted forecast
  baseline: number // same-weekday (dry) baseline before weather adjustment
  factor: number // combined multiplier applied (1 = no adjustment)
  rainPct: number // rain cut applied (0 = none)
  tempPct: number // temperature cut applied (0 = none)
  wet: boolean // is tomorrow forecast to be wet?
  weather: WeatherDay | null // tomorrow's forecast weather
}

const WET_THRESHOLD_IN = 0.1
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Forecast tomorrow's cars: a same-weekday (dry-day) baseline, adjusted by the
// configured rain + temperature effects for tomorrow's forecast.
export function weatherForecast(
  days: LaborDay[],
  weather: Map<string, WeatherDay>,
  tomorrow: Date,
  cfg: WeatherAdjustConfig = DEFAULT_WEATHER_CONFIG,
): WeatherForecast {
  const withCars = days.filter((d) => d.cars > 0)
  const dow = tomorrow.getDay()
  const isWet = (date: string) => {
    const w = weather.get(date)
    return w?.precip_in != null && w.precip_in >= WET_THRESHOLD_IN
  }

  // Baseline: recent same-weekday days, preferring dry ones (so the rain effect
  // isn't double-counted).
  const sameDow = withCars.filter((d) => new Date(d.date + 'T12:00:00').getDay() === dow)
  const dryDow = sameDow.filter((d) => !isWet(d.date))
  const baseSet = (dryDow.length ? dryDow : sameDow).slice(-6)
  const baseline = baseSet.length
    ? Math.round(baseSet.reduce((s, d) => s + d.cars, 0) / baseSet.length)
    : withCars.length
      ? withCars[withCars.length - 1].cars
      : 0

  const wx = weather.get(ymd(tomorrow)) ?? null
  const precip = wx?.precip_in ?? 0
  const high = wx?.temp_max

  // Rain: heaviest matching tier.
  let rainPct = 0
  for (const t of [...cfg.rain].sort((a, b) => a.min_in - b.min_in)) if (precip >= t.min_in) rainPct = t.pct
  // Temperature: coldest (tightest) matching tier.
  let tempPct = 0
  if (high != null) for (const t of [...cfg.temp].sort((a, b) => a.max_f - b.max_f)) { if (high <= t.max_f) { tempPct = t.pct; break } }

  const factor = Math.min(1.2, Math.max(0.3, (1 + rainPct / 100) * (1 + tempPct / 100)))
  const cars = Math.round(baseline * factor)
  return { cars, baseline, factor, rainPct, tempPct, wet: precip >= WET_THRESHOLD_IN, weather: wx }
}

// One planned day: its weather-adjusted forecast plus the date it applies to.
export type DayForecast = WeatherForecast & { date: string }

// Forecast a run of consecutive days (e.g. the coming week). `start` is the
// first day to plan (typically tomorrow); `count` days are returned in order.
export function weekForecast(
  days: LaborDay[],
  weather: Map<string, WeatherDay>,
  start: Date,
  count: number,
  cfg: WeatherAdjustConfig = DEFAULT_WEATHER_CONFIG,
): DayForecast[] {
  const out: DayForecast[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    out.push({ ...weatherForecast(days, weather, d, cfg), date: ymd(d) })
  }
  return out
}
