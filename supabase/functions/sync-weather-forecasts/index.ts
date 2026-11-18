// sync-weather-forecasts — Supabase Edge Function (Deno).
// Keeps a record of past weather forecasts as they were issued: each morning's
// National Blend of Models forecast (the National Weather Service's basis for
// its forecasts) for 0 to 10 days ahead, per site, from the Iowa Environmental
// Mesonet's free archive. See migration 0251 for the tables.
//
// NBM text forecasts are per airport weather station, so each site is matched
// once to its nearest station that has them (within 60 miles); new sites are
// matched on the next run.
//
// Daily (pg_cron, 15:00 and 18:00 UTC, after the 12Z run is out): fetches the
// morning forecast for each station for any of the last few days it doesn't
// have yet. Backfill: { backfill: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD',
// station?: 'KLBB' } } downloads the span in one request per station and model.
// Re-running either is safe: a morning's rows are replaced, never doubled.
//
// Body: { days?: number (daily lookback, default 3, up to 10), backfill?: {...} }
// Auth: service role (cron) or an owner. Auto-provided: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { addDays, forecastDays, forecastsFor, morningRuns, normRow, parseCsv, type ForecastRow, type NbmRow } from './nbm.ts'

const IEM = 'https://mesonet.agron.iastate.edu'
const HEADERS = { 'User-Agent': 'WashLyfe-Operator/1.0 (forecast archive)' }
const NETWORKS = ['TX', 'NM', 'OK', 'CO', 'KS', 'MO', 'AZ', 'LA', 'AR'].map((s) => `${s}_ASOS`)
const MAX_MI = 60

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

async function getJson(url: string): Promise<unknown> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (res.ok) return await res.json()
      if (res.status === 404 || res.status === 422) return null
    } catch { /* retry */ }
    await sleep(1500 * (i + 1))
  }
  return null
}

async function getText(url: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (res.ok) return await res.text()
    } catch { /* retry */ }
    await sleep(2000 * (i + 1))
  }
  throw new Error(`IEM download failed: ${url}`)
}

// One run from the IEM API, or [] when that run isn't there.
async function fetchRun(station: string, model: 'NBE' | 'NBS', runtime?: string): Promise<NbmRow[]> {
  const q = `${IEM}/api/1/mos.json?station=${station}&model=${model}${runtime ? `&runtime=${runtime}` : ''}`
  const j = (await getJson(q)) as { data?: Record<string, unknown>[] } | null
  return (j?.data ?? []).map(normRow).filter((r): r is NbmRow => r !== null)
}

async function upsert(svc: SupabaseClient, rows: ForecastRow[]): Promise<string | null> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await svc.from('weather_forecasts').upsert(rows.slice(i, i + 500), { onConflict: 'station,issued_date,forecast_date' })
    if (error) return error.message
  }
  return null
}

const miles = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(x))
}

// Match sites that have coordinates but no station yet to the nearest station
// with NBM forecasts.
async function assignStations(svc: SupabaseClient) {
  const [{ data: locs, error: e1 }, { data: have, error: e2 }] = await Promise.all([
    svc.from('locations').select('id, account_id, name, latitude, longitude').eq('archived', false).not('latitude', 'is', null).not('longitude', 'is', null),
    svc.from('weather_forecast_stations').select('location_id'),
  ])
  if (e1 || e2) throw new Error((e1 ?? e2)!.message)
  const known = new Set((have ?? []).map((h) => h.location_id as string))
  const todo = (locs ?? []).filter((l) => !known.has(l.id as string))
  if (todo.length === 0) return { assigned: [] as string[], unmatched: [] as string[] }

  const stations: { icao: string; name: string; lat: number; lon: number }[] = []
  for (const net of NETWORKS) {
    const g = (await getJson(`${IEM}/geojson/network/${net}.geojson`)) as { features?: { id?: string; properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] } | null
    for (const f of g?.features ?? []) {
      const sid = String(f.properties.sid ?? f.id ?? '')
      if (!/^[A-Z0-9]{3,4}$/.test(sid) || f.properties.archive_end) continue
      stations.push({ icao: sid.length === 3 ? `K${sid}` : sid, name: String(f.properties.sname ?? sid), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })
    }
  }
  const hasNbm = new Map<string, boolean>()
  const assigned: string[] = []
  const unmatched: string[] = []
  for (const l of todo) {
    const near = stations
      .map((s) => ({ ...s, mi: miles(Number(l.latitude), Number(l.longitude), s.lat, s.lon) }))
      .filter((s) => s.mi <= MAX_MI)
      .sort((a, b) => a.mi - b.mi)
      .slice(0, 8)
    let pick: (typeof near)[number] | null = null
    for (const s of near) {
      if (!hasNbm.has(s.icao)) {
        hasNbm.set(s.icao, (await fetchRun(s.icao, 'NBE')).length > 0)
        await sleep(150)
      }
      if (hasNbm.get(s.icao)) { pick = s; break }
    }
    if (!pick) { unmatched.push(l.name as string); continue }
    const { error } = await svc.from('weather_forecast_stations').upsert({
      location_id: l.id, account_id: l.account_id, station: pick.icao, station_name: pick.name, distance_mi: Math.round(pick.mi * 10) / 10,
    })
    if (error) throw new Error(error.message)
    assigned.push(`${l.name} -> ${pick.icao} (${pick.mi.toFixed(1)} mi)`)
  }
  return { assigned, unmatched }
}

// The span in one bulk download per station and model.
async function backfill(svc: SupabaseClient, station: string, from: string, to: string) {
  const url = (model: string) => `${IEM}/cgi-bin/request/mos.py?station=${station}&model=${model}&sts=${from}T00:00Z&ets=${addDays(to, 1)}T00:00Z&format=csv`
  const nbe = parseCsv(await getText(url('NBE'))).map(normRow).filter((r): r is NbmRow => r !== null)
  await sleep(300)
  const nbs = parseCsv(await getText(url('NBS'))).map(normRow).filter((r): r is NbmRow => r !== null)
  const rows = forecastsFor(station, nbe, nbs, from, to)
  const err = await upsert(svc, rows)
  if (err) throw new Error(err)
  return { station, mornings: morningRuns(nbe).size, rows: rows.length }
}

// The last few mornings a station is missing: 12Z, else 13Z or 11Z.
async function daily(svc: SupabaseClient, station: string, days: number) {
  const today = new Date().toISOString().slice(0, 10)
  const first = addDays(today, -(days - 1))
  const { data, error } = await svc.from('weather_forecasts').select('issued_date, model')
    .eq('station', station).gte('issued_date', first)
  if (error) throw new Error(error.message)
  const have = new Set((data ?? []).map((r) => `${r.issued_date}|${r.model}`))
  let rows = 0
  for (let d = first; d <= today; d = addDays(d, 1)) {
    for (const model of ['NBE', 'NBS'] as const) {
      if (have.has(`${d}|${model}`)) continue
      for (const h of ['12', '13', '11']) {
        const rt = `${d}T${h}:00Z`
        const run = await fetchRun(station, model, rt)
        await sleep(120)
        if (run.length === 0) continue
        const out = forecastDays(station, model, run, run[0].runtime)
        const err = await upsert(svc, out)
        if (err) throw new Error(err)
        rows += out.length
        break
      }
    }
  }
  return { station, rows }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const url = Deno.env.get('SUPABASE_URL')!
  const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const auth = req.headers.get('Authorization') ?? ''
  if (jwtRole(auth) !== 'service_role') {
    const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: u } = await uc.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (p?.role !== 'owner') return json({ error: 'forbidden' }, 403)
  }

  let body: { days?: number; backfill?: { from?: string; to?: string; station?: string } } = {}
  try { body = await req.json() } catch { /* empty */ }

  try {
    const matched = await assignStations(svc)
    const { data: st, error } = await svc.from('weather_forecast_stations').select('station')
    if (error) throw new Error(error.message)
    let stations = [...new Set((st ?? []).map((s) => s.station as string))].sort()

    if (body.backfill) {
      const { from, to, station } = body.backfill
      if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return json({ error: 'bad_dates' }, 400)
      if (station) stations = stations.filter((s) => s === station)
      const results = []
      for (const s of stations) {
        results.push(await backfill(svc, s, from, to))
        await sleep(500)
      }
      return json({ ok: true, mode: 'backfill', from, to, matched, results })
    }

    const days = Math.min(10, Math.max(1, Math.round(body.days ?? 3)))
    const results = []
    for (const s of stations) results.push(await daily(svc, s, days))
    return json({ ok: true, mode: 'daily', days, matched, rows: results.reduce((n, r) => n + r.rows, 0), results })
  } catch (e) {
    return json({ error: 'sync_failed', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})
