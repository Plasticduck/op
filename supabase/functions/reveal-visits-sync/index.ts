// reveal-visits-sync — Supabase Edge Function (Deno).
// Turns Mighty Wash vehicle trips from Verizon Connect Reveal into site visits
// (vehicle_site_visits) and keeps the people list (fleet_people) current.
//
// Body: { start?: 'YYYY-MM-DD', end?: 'YYYY-MM-DD' } (Central dates). Default:
// yesterday through today. The window also reaches back (up to 4 days) to the
// oldest visit still marked as parked, so its departure gets filled in.
//
// Reveal segments (GET /rad/v1/vehicles/<n>/segments?startdateutc=...) are
// trips, ignition on -> off, for the 24 hours from startdateutc. A stop runs
// from one trip's end to the next trip's start; a stop within a site's
// geofence (locations lat/lng + geofence_radius_m) is a visit. Stops at the
// same site split only by moving the vehicle within the lot are merged.
// Vehicles with no vehicle number in Reveal can't be queried by vehicle, so
// drivers who didn't show up on any numbered vehicle that day are queried by
// driver (GET /rad/v1/drivers/<n>/segments) and only their trips in vehicles
// without a number are kept.
//
// Callers: the hourly cron (service role) or kevan@washlyfe.com ("Sync now").
// Secrets: REVEAL_USERNAME, REVEAL_PASSWORD, REVEAL_APP_ID.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

const API = 'https://fim.api.us.fleetmatics.com'
const MW_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const ADMIN_EMAIL = 'kevan@washlyfe.com'
const TZ = 'America/Chicago'
const DEFAULT_RADIUS_M = 200
const MAX_DAYS = 16
// Covers a vehicle parked at a site over a weekend; older open visits (a
// tracker that stopped reporting) are left open rather than re-fetched hourly.
const OPEN_LOOKBACK_DAYS = 4
const CONCURRENCY = 6

const ALLOWED_ORIGINS = new Set<string>([
  'https://operator.washlyfe.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
])

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

// The gateway has already verified the JWT; this just reads its role claim.
function jwtRole(auth: string): string | null {
  const parts = auth.replace(/^Bearer\s+/i, '').split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null
  } catch {
    return null
  }
}

const centralDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// The UTC instant of midnight Central on a date (CDT = UTC-5, CST = UTC-6).
function centralMidnight(ymd: string): Date {
  for (const h of ['05', '06']) {
    const d = new Date(`${ymd}T${h}:00:00Z`)
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d)
    if (hour === '00') return d
  }
  return new Date(`${ymd}T06:00:00Z`)
}
// Reveal timestamps are UTC with no zone suffix.
const utc = (s: unknown): string | null => (typeof s === 'string' && s ? `${s.replace(/Z$/, '')}Z` : null)

function meters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (x: number) => (x * Math.PI) / 180
  const dLat = r(bLat - aLat)
  const dLng = r(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(h))
}

// Same cleanup as reveal-fleet: drop the tracker IMEI and install timestamp.
function cleanName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/_\d{8}T[\d:]*/g, ' ')
    .replace(/\d{9,}/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .trim()
}

let token: { value: string; exp: number } | null = null
async function getToken(user: string, pass: string, force = false): Promise<string> {
  if (!force && token && token.exp > Date.now()) return token.value
  const r = await fetch(`${API}/token`, {
    headers: { Authorization: `Basic ${btoa(`${user}:${pass}`)}`, Accept: 'text/plain' },
  })
  const text = (await r.text()).trim()
  if (!r.ok) throw new Error(`token ${r.status}: ${text.slice(0, 120)}`)
  token = { value: text.replace(/^"|"$/g, ''), exp: Date.now() + 18 * 60_000 }
  return token.value
}

// Run tasks with at most `n` in flight.
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

type Site = { id: string; lat: number; lng: number; radius: number }
type Person = { key: string; name: string; email: string | null }
type Trip = { start: string; end: string | null; endLat: number | null; endLng: number | null; startLat: number | null; startLng: number | null; person: Person | null }
type Visit = { location_id: string; vehicle_number: string; vehicle_name: string | null; person_key: string | null; person_name: string | null; arrived_at: string; departed_at: string | null }

function siteAt(sites: Site[], lat: number | null, lng: number | null): Site | null {
  if (lat == null || lng == null) return null
  let best: Site | null = null
  let bestD = Infinity
  for (const s of sites) {
    const d = meters(lat, lng, s.lat, s.lng)
    if (d <= s.radius && d < bestD) {
      best = s
      bestD = d
    }
  }
  return best
}

// Stops between consecutive trips -> visits at sites.
function visitsFor(vehicleNumber: string, vehicleName: string | null, trips: Trip[], sites: Site[]): Visit[] {
  const sorted = [...trips].sort((a, b) => a.start.localeCompare(b.start))
  const out: Visit[] = []
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]
    if (!t.end) continue // still driving, or ended past the fetched window
    const site = siteAt(sites, t.endLat, t.endLng)
    if (!site) continue
    const next = sorted[i + 1] ?? null
    const last = out[out.length - 1]
    // Moved within the same lot (the trip between started and ended at this
    // site): extend the previous visit instead of starting a new one.
    if (last && last.location_id === site.id && last.departed_at === t.start && siteAt(sites, t.startLat, t.startLng)?.id === site.id) {
      last.departed_at = next?.start ?? null
      continue
    }
    out.push({
      location_id: site.id,
      vehicle_number: vehicleNumber,
      vehicle_name: vehicleName,
      person_key: t.person?.key ?? null,
      person_name: t.person?.name ?? null,
      arrived_at: t.end,
      departed_at: next?.start ?? null,
    })
  }
  return out
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const user = Deno.env.get('REVEAL_USERNAME')
  const pass = Deno.env.get('REVEAL_PASSWORD')
  const appId = Deno.env.get('REVEAL_APP_ID')
  if (!user || !pass || !appId) return json({ error: 'no_key', message: 'Verizon Connect is not configured.' }, 503, origin)

  const auth = req.headers.get('Authorization') ?? ''
  if (jwtRole(auth) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    if ((u.user.email ?? '').toLowerCase() !== ADMIN_EMAIL) return json({ error: 'forbidden' }, 403, origin)
  }
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: Any = {}
  try { body = await req.json() } catch { /* defaults */ }
  const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const today = centralDate(new Date())
  let end = isDate(body.end) ? String(body.end) : today
  if (end > today) end = today
  let start = isDate(body.start) ? String(body.start) : addDays(end, -1)

  // Reach back to the oldest visit still marked as parked so it gets a departure.
  const { data: open } = await svc
    .from('vehicle_site_visits')
    .select('arrived_at')
    .eq('account_id', MW_ACCOUNT_ID)
    .is('departed_at', null)
    .gte('arrived_at', new Date(Date.now() - OPEN_LOOKBACK_DAYS * 86400_000).toISOString())
    .order('arrived_at', { ascending: true })
    .limit(1)
  if (open?.[0]?.arrived_at) {
    const openDay = centralDate(new Date(open[0].arrived_at))
    if (openDay < start) start = openDay
  }
  if (start > end) return json({ error: 'bad_request', message: 'start is after end.' }, 400, origin)

  // Fetch one extra day past `end` (when it exists) so the last stop's
  // departure is known; only visits arriving inside [start, end] are written.
  const fetchEnd = end < today ? addDays(end, 1) : end
  const days: string[] = []
  for (let d = start; d <= fetchEnd; d = addDays(d, 1)) days.push(d)
  if (days.length > MAX_DAYS + 1) return json({ error: 'bad_request', message: `At most ${MAX_DAYS} days per call.` }, 400, origin)
  const writeFrom = centralMidnight(start).toISOString()
  const writeTo = centralMidnight(addDays(end, 1)).toISOString()

  const reveal = async (path: string): Promise<Response> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await getToken(user, pass, attempt > 0)
      const r = await fetch(`${API}${path}`, {
        headers: { Authorization: `Atmosphere atmosphere_app_id=${appId}, Bearer ${t}`, Accept: 'application/json' },
      })
      if (r.status !== 401 || attempt > 0) return r
    }
    throw new Error('unreachable')
  }

  try {
    const { data: locs } = await svc
      .from('locations')
      .select('id, latitude, longitude, geofence_radius_m')
      .eq('account_id', MW_ACCOUNT_ID)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
    const sites: Site[] = (locs ?? []).map((l: Any) => ({
      id: l.id, lat: l.latitude, lng: l.longitude, radius: l.geofence_radius_m || DEFAULT_RADIUS_M,
    }))

    const [vr, dr] = await Promise.all([reveal('/cmd/v1/vehicles'), reveal('/cmd/v1/drivers')])
    if (!vr.ok || !dr.ok) return json({ error: 'reveal_failed', step: 'roster', status: vr.ok ? dr.status : vr.status }, 502, origin)
    const vehicles = ((await vr.json()) as Any[]).filter((v) => String(v?.VehicleNumber ?? '').trim())
    const driverRows = ((await dr.json()) as Any[]).map((row) => row?.Driver ?? row)
    const drivers = new Map<string, Person>()
    for (const d of driverRows) {
      const num = String(d?.DriverNumber ?? '').trim()
      if (!num || num === 'null') continue
      drivers.set(num, {
        key: num,
        name: `${String(d.FirstName ?? '').trim()} ${String(d.LastName ?? '').trim()}`.trim() || num,
        email: String(d.EmailAddress ?? '').trim().toLowerCase() || null,
      })
    }
    const personFor = (d: Any): Person | null => {
      const num = String(d?.Number ?? '').trim()
      if (!num) return null
      return drivers.get(num) ?? { key: num, name: `${String(d.FirstName ?? '').trim()} ${String(d.LastName ?? '').trim()}`.trim() || num, email: null }
    }

    // Trips by vehicle (key = trimmed vehicle number, or 'driver:<n>' for a
    // vehicle with no number, found through its driver).
    const trips = new Map<string, { name: string | null; trips: Trip[] }>()
    const seenDrivers = new Map<string, Set<string>>() // day -> drivers seen on numbered vehicles
    const failed: string[] = []
    // Vehicles with a failed day are left as they were rather than half-rewritten.
    const failedKeys = new Set<string>()
    const addTrips = (key: string, name: string | null, o: Any) => {
      if (!trips.has(key)) trips.set(key, { name, trips: [] })
      const person = personFor(o?.Driver)
      for (const s of (o?.Segments ?? []) as Any[]) {
        const startAt = utc(s.StartDateUtc)
        if (!startAt) continue
        trips.get(key)!.trips.push({
          start: startAt,
          end: s.IsComplete && !s.EndLocationIsPrivate ? utc(s.EndDateUtc) : null,
          endLat: s.EndLocation?.Latitude ?? null,
          endLng: s.EndLocation?.Longitude ?? null,
          startLat: s.StartLocation?.Latitude ?? null,
          startLng: s.StartLocation?.Longitude ?? null,
          person: person ?? (name ? { key: `v:${key}`, name, email: null } : null),
        })
      }
    }

    const vehicleTasks = vehicles.flatMap((v) => days.map((day) => ({ v, day })))
    await pool(vehicleTasks, CONCURRENCY, async ({ v, day }) => {
      const num = String(v.VehicleNumber).trim()
      const r = await reveal(`/rad/v1/vehicles/${encodeURIComponent(num)}/segments?startdateutc=${centralMidnight(day).toISOString().slice(0, 19)}`)
      if (!r.ok) { failed.push(`${num} ${day} ${r.status}`); failedKeys.add(num); return }
      for (const o of ((await r.json()) ?? []) as Any[]) {
        addTrips(num, cleanName(v.Name) || num, o)
        const dn = String(o?.Driver?.Number ?? '').trim()
        if (dn) {
          if (!seenDrivers.has(day)) seenDrivers.set(day, new Set())
          seenDrivers.get(day)!.add(dn)
        }
      }
    })

    const numbered = new Set(vehicles.map((v) => String(v.VehicleNumber).trim()))
    const driverTasks = [...drivers.keys()].flatMap((dn) => days.filter((day) => !seenDrivers.get(day)?.has(dn)).map((day) => ({ dn, day })))
    await pool(driverTasks, CONCURRENCY, async ({ dn, day }) => {
      const r = await reveal(`/rad/v1/drivers/${encodeURIComponent(dn)}/segments?startdateutc=${centralMidnight(day).toISOString().slice(0, 19)}`)
      if (!r.ok) { failed.push(`driver ${dn} ${day} ${r.status}`); failedKeys.add(`driver:${dn}`); return }
      for (const o of ((await r.json()) ?? []) as Any[]) {
        const vn = String(o?.Vehicle?.Number ?? '').trim()
        if (vn && numbered.has(vn)) continue // already fetched by vehicle
        addTrips(vn || `driver:${dn}`, cleanName(o?.Vehicle?.Name) || null, o)
      }
    })

    const visits: Visit[] = []
    for (const [vn, v] of trips) {
      if (failedKeys.has(vn)) continue
      for (const visit of visitsFor(vn, v.name, v.trips, sites)) {
        if (visit.arrived_at >= writeFrom && visit.arrived_at < writeTo) visits.push(visit)
      }
    }

    // People: add new ones, refresh names/emails and Operator user matches, and
    // pre-tag untagged Regional Managers and Executives from their Operator
    // role. A category already set is never changed.
    const people = new Map<string, Person>()
    for (const v of trips.values()) for (const t of v.trips) if (t.person) people.set(t.person.key, t.person)
    if (people.size) {
      const { data: users } = await svc.from('users').select('id, email, role_category').eq('account_id', MW_ACCOUNT_ID)
      const byEmail = new Map((users ?? []).map((u: Any) => [String(u.email ?? '').toLowerCase(), u]))
      const { data: existing } = await svc.from('fleet_people').select('person_key, category').eq('account_id', MW_ACCOUNT_ID)
      const has = new Map((existing ?? []).map((p: Any) => [p.person_key, p.category]))
      const rows = [...people.values()].map((p) => {
        const u: Any = p.email ? byEmail.get(p.email) : null
        const fromRole = u?.role_category === 'regional_manager' || u?.role_category === 'executive' ? u.role_category : null
        return {
          account_id: MW_ACCOUNT_ID,
          person_key: p.key,
          name: p.name,
          email: p.email,
          user_id: u?.id ?? null,
          category: has.get(p.key) ?? fromRole,
          updated_at: new Date().toISOString(),
        }
      })
      const { error } = await svc.from('fleet_people').upsert(rows, { onConflict: 'account_id,person_key' })
      if (error) return json({ error: 'db_failed', step: 'people', message: error.message }, 500, origin)
    }

    // Replace the window's visits for every vehicle that returned data.
    const keys = [...trips.keys()].filter((k) => !failedKeys.has(k))
    if (keys.length) {
      const { error: delErr } = await svc
        .from('vehicle_site_visits')
        .delete()
        .eq('account_id', MW_ACCOUNT_ID)
        .in('vehicle_number', keys)
        .gte('arrived_at', writeFrom)
        .lt('arrived_at', writeTo)
      if (delErr) return json({ error: 'db_failed', step: 'delete', message: delErr.message }, 500, origin)
    }
    if (visits.length) {
      const { error: insErr } = await svc
        .from('vehicle_site_visits')
        .insert(visits.map((v) => ({ ...v, account_id: MW_ACCOUNT_ID })))
      if (insErr) return json({ error: 'db_failed', step: 'insert', message: insErr.message }, 500, origin)
    }

    return json({
      ok: true,
      start,
      end,
      vehicles: keys.length,
      calls: vehicleTasks.length + driverTasks.length,
      visits: visits.length,
      failed: failed.slice(0, 20),
    }, 200, origin)
  } catch (e) {
    return json({ error: 'reveal_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
