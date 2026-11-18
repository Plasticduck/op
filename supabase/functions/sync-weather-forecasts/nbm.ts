// National Blend of Models (NBM) text forecasts, as archived by the Iowa
// Environmental Mesonet, turned into one row per forecast day. No imports, so
// the handler and the tests share it.
//
// The extended blend (NBE) has a row every 12 hours at 00Z and 12Z: at 00Z, txn
// is the daytime high and p12/q12 cover 12Z-00Z (about 7am-7pm Central); at 12Z,
// txn is the overnight low and p12/q12 cover the 00Z-12Z before it. q12 is in
// hundredths of an inch. The short-range blend (NBS) runs every 3 hours from
// 18Z, so a morning run still has the same day's daytime row.

export type NbmRow = { runtime: string; ftime: string; txn: number | null; p12: number | null; q12: number | null }
export type Model = 'NBS' | 'NBE'
export type ForecastRow = {
  station: string
  issued_at: string
  issued_date: string
  forecast_date: string
  lead_days: number
  model: Model
  temp_max: number | null
  temp_min: number | null
  precip_chance: number | null
  precip_chance_night: number | null
  precip_in: number | null
  precip_in_night: number | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// "2026-06-10 12:00", "2026-06-10 12:00:00" or "2026-06-10T12:00:00.000" -> "2026-06-10T12:00Z"
export const utcKey = (s: unknown) => String(s ?? '').slice(0, 16).replace(' ', 'T') + 'Z'
const KEY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/

export function normRow(raw: Record<string, unknown>): NbmRow | null {
  const runtime = utcKey(raw.runtime_utc ?? raw.runtime)
  const ftime = utcKey(raw.ftime_utc ?? raw.ftime)
  if (!KEY_RE.test(runtime) || !KEY_RE.test(ftime)) return null
  return { runtime, ftime, txn: num(raw.txn), p12: num(raw.p12), q12: num(raw.q12) }
}

// The IEM bulk download: plain comma-separated values, header first, no quoting.
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const head = lines[0].split(',')
  return lines.slice(1).map((l) => {
    const f = l.split(',')
    return Object.fromEntries(head.map((h, i) => [h, f[i] ?? '']))
  })
}

export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// The morning run for each date: 12Z (about 6-7am Central), else the closest
// run from 10Z to 16Z. Those are all the same date in Central and Mountain time.
export function morningRuns(rows: NbmRow[]): Map<string, string> {
  const best = new Map<string, { rt: string; off: number }>()
  for (const rt of new Set(rows.map((r) => r.runtime))) {
    const h = Number(rt.slice(11, 13))
    if (h < 10 || h > 16) continue
    const day = rt.slice(0, 10)
    const off = Math.abs(h - 12)
    const cur = best.get(day)
    if (!cur || off < cur.off || (off === cur.off && rt < cur.rt)) best.set(day, { rt, off })
  }
  return new Map([...best].map(([day, v]) => [day, v.rt]))
}

const inches = (q: number | null | undefined) => (q == null ? null : Math.round(q) / 100)

// One run's forecast days. NBE: days 1-10. NBS: day 0's daytime only (its
// overnight already happened, and NBE covers the later days).
export function forecastDays(station: string, model: Model, run: NbmRow[], runtime: string): ForecastRow[] {
  const issued = runtime.slice(0, 10)
  const at = new Map(run.filter((r) => r.runtime === runtime).map((r) => [r.ftime, r]))
  const [first, last] = model === 'NBS' ? [0, 0] : [1, 10]
  const out: ForecastRow[] = []
  for (let lead = first; lead <= last; lead++) {
    const d = addDays(issued, lead)
    const day = at.get(`${addDays(d, 1)}T00:00Z`)
    const night = lead === 0 ? undefined : at.get(`${d}T12:00Z`)
    if (!day && !night) continue
    out.push({
      station,
      issued_at: runtime,
      issued_date: issued,
      forecast_date: d,
      lead_days: lead,
      model,
      temp_max: day?.txn ?? null,
      temp_min: night?.txn ?? null,
      precip_chance: day?.p12 ?? null,
      precip_chance_night: night?.p12 ?? null,
      precip_in: inches(day?.q12),
      precip_in_night: inches(night?.q12),
    })
  }
  return out
}

// Every morning's forecast in a span of downloaded runs, for issue dates from..to.
export function forecastsFor(station: string, nbe: NbmRow[], nbs: NbmRow[], from: string, to: string): ForecastRow[] {
  const out: ForecastRow[] = []
  const inSpan = (d: string) => d >= from && d <= to
  for (const [day, rt] of morningRuns(nbe)) if (inSpan(day)) out.push(...forecastDays(station, 'NBE', nbe, rt))
  for (const [day, rt] of morningRuns(nbs)) if (inSpan(day)) out.push(...forecastDays(station, 'NBS', nbs, rt))
  return out
}
