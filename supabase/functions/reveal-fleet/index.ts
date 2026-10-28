// reveal-fleet — Supabase Edge Function (Deno).
// Bridges Operator to Verizon Connect Reveal (Mighty Wash's vehicle GPS). Holds
// the Reveal integration credentials server-side and never exposes them to the
// browser. One action:
//   { action: 'live' } -> every vehicle's latest position + status, with driver
//                         names, plus the vehicles Reveal can't locate
//
// Reveal REST (fim.api.us.fleetmatics.com):
//   GET  /token                      Basic user:pass -> plain-text JWT, valid 20 min
//   GET  /cmd/v1/vehicles            vehicle list (VehicleNumber keys everything else)
//   GET  /cmd/v1/drivers             driver list (DriverNumber -> name)
//   POST /rad/v1/vehicles/locations  latest GPS plot for up to 100 vehicle numbers
// Every call after /token sends "Atmosphere atmosphere_app_id=<app id>, Bearer <token>".
// Speeds come back in km/h. A vehicle with no VehicleNumber in Reveal can't be
// queried; those are returned in `missing` so they can be fixed in Reveal.
//
// Pre-launch: restricted to kevan@washlyfe.com.
// Secrets: REVEAL_USERNAME, REVEAL_PASSWORD, REVEAL_APP_ID.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

const API = 'https://fim.api.us.fleetmatics.com'
const ALLOWED_EMAILS = ['kevan@washlyfe.com']

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

// Warm instances reuse these between requests: the token for most of its 20
// minutes, the vehicle and driver lists for 10 (they rarely change).
let token: { value: string; exp: number } | null = null
let roster: { vehicles: Any[]; drivers: Map<string, string>; exp: number } | null = null

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

// "Jack Mclanahan- Red Frontier358503107847411" -> "Jack Mclanahan - Red Frontier".
// Reveal names carry the tracker's IMEI and an install timestamp.
function cleanName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/_\d{8}T[\d:]*/g, ' ')
    .replace(/\d{9,}/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .trim()
}

const kmhToMph = (kmh: unknown) => (typeof kmh === 'number' ? Math.round(kmh * 0.621371) : null)

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const user = Deno.env.get('REVEAL_USERNAME')
  const pass = Deno.env.get('REVEAL_PASSWORD')
  const appId = Deno.env.get('REVEAL_APP_ID')
  if (!user || !pass || !appId) return json({ error: 'no_key', message: 'Verizon Connect is not configured.' }, 503, origin)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
  if (!ALLOWED_EMAILS.includes((u.user.email ?? '').toLowerCase())) {
    return json({ error: 'forbidden', message: 'The fleet map is restricted.' }, 403, origin)
  }

  let body: Any = {}
  try { body = await req.json() } catch { /* default */ }
  const action = String(body.action ?? 'live')
  if (action !== 'live') return json({ error: 'unknown_action' }, 400, origin)

  // One retry with a fresh token if Reveal rejects the cached one.
  const reveal = async (path: string, init?: RequestInit): Promise<Response> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await getToken(user, pass, attempt > 0)
      const r = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Atmosphere atmosphere_app_id=${appId}, Bearer ${t}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })
      if (r.status !== 401 || attempt > 0) return r
    }
    throw new Error('unreachable')
  }

  try {
    if (!roster || roster.exp < Date.now()) {
      const [vr, dr] = await Promise.all([reveal('/cmd/v1/vehicles'), reveal('/cmd/v1/drivers')])
      if (!vr.ok) return json({ error: 'reveal_failed', step: 'vehicles', status: vr.status }, 502, origin)
      const vehicles = (await vr.json()) as Any[]
      const drivers = new Map<string, string>()
      // Driver names are a nicety; the map still works without them.
      if (dr.ok) {
        for (const row of (await dr.json()) as Any[]) {
          const d = row?.Driver ?? row
          const num = String(d?.DriverNumber ?? '').trim()
          const name = `${String(d?.FirstName ?? '').trim()} ${String(d?.LastName ?? '').trim()}`.trim()
          if (num && num !== 'null' && name) drivers.set(num.toLowerCase(), name)
        }
      }
      roster = { vehicles: Array.isArray(vehicles) ? vehicles : [], drivers, exp: Date.now() + 10 * 60_000 }
    }

    const located = roster.vehicles.filter((v) => v?.VehicleNumber)
    const missing: Any[] = roster.vehicles
      .filter((v) => !v?.VehicleNumber)
      .map((v) => ({ name: cleanName(v.Name), reason: 'no_vehicle_number' }))

    // Latest plot for every vehicle, 100 vehicle numbers per call.
    const plots = new Map<string, Any>()
    for (let i = 0; i < located.length; i += 100) {
      const nums = located.slice(i, i + 100).map((v) => v.VehicleNumber)
      const r = await reveal('/rad/v1/vehicles/locations', { method: 'POST', body: JSON.stringify(nums) })
      if (!r.ok) return json({ error: 'reveal_failed', step: 'locations', status: r.status }, 502, origin)
      for (const row of (await r.json()) as Any[]) {
        if (row?.StatusCode === 200 && row.ContentResource?.Value) plots.set(row.VehicleNumber, row.ContentResource.Value)
      }
    }

    const out: Any[] = []
    for (const v of located) {
      const p = plots.get(v.VehicleNumber)
      if (!p || typeof p.Latitude !== 'number' || typeof p.Longitude !== 'number' || p.IsPrivate) {
        missing.push({ name: cleanName(v.Name), reason: p?.IsPrivate ? 'private' : 'no_data' })
        continue
      }
      const driverNum = p.DriverNumber ? String(p.DriverNumber).trim() : null
      const a = p.Address ?? {}
      out.push({
        number: v.VehicleNumber,
        name: cleanName(v.Name) || String(v.VehicleNumber),
        vehicle: [v.Year || null, v.Make, v.Model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || null,
        driver: driverNum ? (roster.drivers.get(driverNum.toLowerCase()) ?? null) : null,
        lat: p.Latitude,
        lng: p.Longitude,
        // AddressLine1 is usually the full one-line address already.
        address: String(a.AddressLine1 ?? '').trim() || null,
        city: [a.Locality, a.AdministrativeArea].filter(Boolean).join(', ') || null,
        status: p.DisplayState ?? null, // 'Moving' | 'Idle' | 'Stop'
        speed_mph: kmhToMph(p.Speed),
        heading: p.Heading ?? null,
        direction: typeof p.Direction === 'number' ? p.Direction : null,
        geofence: p.GeoFenceName ?? null,
        // UpdateUTC has no zone suffix.
        updated_at: p.UpdateUTC ? `${String(p.UpdateUTC).replace(/Z$/, '')}Z` : null,
      })
    }

    return json({ fetched_at: new Date().toISOString(), vehicles: out, missing }, 200, origin)
  } catch (e) {
    return json({ error: 'reveal_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
