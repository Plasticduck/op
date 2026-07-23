// sync-weather — Supabase Edge Function (Deno).
// Pulls recent daily weather from Open-Meteo (keyless) for every location that
// has coordinates and upserts it into weather_days, building a permanent archive
// that outlives Open-Meteo's ~90-day history window. Runs daily via pg_cron and
// can be triggered manually by an owner (e.g. a one-time backfill).
//
// Body: { days?: number }  — trailing days to (re)sync. Default 3 (daily catch-up
// plus a couple days back for late corrections); up to 92 for an initial backfill.
//
// Auth: the daily cron passes the service-role key as Bearer; a signed-in owner
// may also call it. Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

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
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

// WMO weather code -> short human label (mirrors the app's weatherLabel).
function conditions(code: number): string {
  if (code <= 1) return code === 0 ? 'Clear' : 'Mainly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  if (code <= 86) return 'Snow showers'
  return 'Storm'
}

// Read the `role` claim from a Bearer JWT without verifying (the gateway already
// verified the signature via verify_jwt).
function jwtRole(auth: string): string | null {
  const token = auth.replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

type Loc = { id: string; account_id: string; latitude: number | null; longitude: number | null }

async function fetchDays(lat: number, lon: number, past: number) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&past_days=${past}&forecast_days=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`open-meteo ${res.status}`)
  const j = (await res.json()) as {
    daily?: {
      time: string[]
      weather_code: number[]
      temperature_2m_max: (number | null)[]
      temperature_2m_min: (number | null)[]
      precipitation_sum: (number | null)[]
    }
  }
  const d = j.daily
  if (!d?.time) return []
  return d.time.map((date, i) => ({
    date,
    weather_code: d.weather_code[i] ?? null,
    conditions: conditions(d.weather_code[i] ?? 0),
    temp_max: d.temperature_2m_max[i] == null ? null : Math.round(d.temperature_2m_max[i] as number),
    temp_min: d.temperature_2m_min[i] == null ? null : Math.round(d.temperature_2m_min[i] as number),
    precip_in:
      d.precipitation_sum[i] == null
        ? null
        : Math.round((d.precipitation_sum[i] as number) * 100) / 100,
  }))
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: allow the cron (service-role JWT) or a signed-in owner. The gateway
  // already validated the JWT (verify_jwt), so decode its role claim rather than
  // string-matching the key, which can vary in format between the Vault copy and
  // the injected SUPABASE_SERVICE_ROLE_KEY.
  const authHeader = req.headers.get('Authorization') ?? ''
  const isService = jwtRole(authHeader) === 'service_role'
  if (!isService) {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden' }, 403, origin)
  }

  let days = 3
  try {
    const body = await req.json()
    if (typeof body?.days === 'number') days = body.days
  } catch {
    // default
  }
  days = Math.max(1, Math.min(92, Math.round(days)))

  const { data: locs } = await svc
    .from('locations')
    .select('id, account_id, latitude, longitude')
    .eq('archived', false)
  const withCoords = ((locs ?? []) as Loc[]).filter((l) => l.latitude != null && l.longitude != null)

  let upserted = 0
  const errors: string[] = []
  for (const loc of withCoords) {
    try {
      const rows = await fetchDays(loc.latitude as number, loc.longitude as number, days)
      if (!rows.length) continue
      const payload = rows.map((r) => ({
        account_id: loc.account_id,
        location_id: loc.id,
        ...r,
        source: 'open-meteo',
        updated_at: new Date().toISOString(),
      }))
      const { error } = await svc
        .from('weather_days')
        .upsert(payload, { onConflict: 'location_id,date' })
      if (error) errors.push(`${loc.id}: ${error.message}`)
      else upserted += payload.length
    } catch (e) {
      errors.push(`${loc.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return json(
    { locations: withCoords.length, days, upserted, errors: errors.slice(0, 10) },
    200,
    origin,
  )
})
