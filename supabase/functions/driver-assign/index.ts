// driver-assign — Supabase Edge Function (Deno).
// Backs the Driver Assignment phone app (operator.washlyfe.com/driverassignment,
// driverassignment.html). A driver opens it, enters their 4-digit PIN, and scans
// the QR sticker on a vehicle's dash; this puts them on that vehicle in Verizon
// Connect Reveal.
//
// Drivers have no Operator login here: the PIN alone says who they are
// (fleet_driver_pins, 0265; Admins see and change PINs in Fleet Management). So
// this runs without the gateway's JWT check (config.toml, --no-verify-jwt), wrong
// PINs are capped per IP address and overall (as the Secret Shopper app does), and
// an assignment also needs a real sticker code (fleet_vehicle_codes, 0208), which
// means standing at the vehicle. Service role throughout: both tables are RLS-locked.
//
// Actions (the PIN comes with every call; nothing is kept between calls):
//   sign_in { pin }        -> { ok, driver: { name }, vehicle: { name } | null }   their vehicle now
//   assign  { pin, code }  -> { ok, vehicle: { name, description }, already?, replaced? }
//                             `code` is the sticker code or the whole scanned link (.../v/<code>)
//
// Reveal behavior relied on (tested 2026-11-04, see fleet-admin): an assignment
// releases the vehicle's previous driver and the driver's previous vehicle, and a
// failed POST still answers 200, so the result is read back before it's reported.
// Every assignment is logged in fleet_changes under the driver's name.
//
// Secrets: REVEAL_USERNAME, REVEAL_PASSWORD, REVEAL_APP_ID.
// Deploy: npx supabase functions deploy driver-assign --project-ref ppwjqifyyihesuoubixk --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2'
import { stickerCode } from './code.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const API = 'https://fim.api.us.fleetmatics.com'
const MW_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

// Wrong PINs: per address over 15 minutes, and for everyone over an hour. A PIN
// alone only shows a driver's name and vehicle; changing an assignment also takes
// a sticker code.
const MAX_BAD_PINS_PER_IP = 8
const BAD_PIN_WINDOW_MS = 15 * 60_000
const MAX_BAD_PINS_PER_HOUR = 60

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
const revealNow = () => new Date().toISOString().slice(0, 19)
const driverName = (d: Any) => `${String(d?.FirstName ?? '').trim()} ${String(d?.LastName ?? '').trim()}`.trim() || String(d?.DriverNumber ?? '')

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (fwd || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown').slice(0, 64)
}

class UserError extends Error {}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const rUser = Deno.env.get('REVEAL_USERNAME')
  const rPass = Deno.env.get('REVEAL_PASSWORD')
  const appId = Deno.env.get('REVEAL_APP_ID')
  if (!rUser || !rPass || !appId) return json({ error: 'no_key', message: 'Driver assignment isn\'t set up yet.' }, 503, origin)
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: Any = {}
  try { body = await req.json() } catch { /* default */ }
  const action = String(body.action ?? '')
  if (action !== 'sign_in' && action !== 'assign') return json({ error: 'unknown_action' }, 400, origin)

  // Too many wrong PINs from here, or from everywhere: stop before checking this one.
  const ip = clientIp(req)
  const [{ count: mine }, { count: all }] = await Promise.all([
    svc.from('fleet_driver_bad_pins').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('at', new Date(Date.now() - BAD_PIN_WINDOW_MS).toISOString()),
    svc.from('fleet_driver_bad_pins').select('id', { count: 'exact', head: true }).gte('at', new Date(Date.now() - 3600_000).toISOString()),
  ])
  if ((mine ?? 0) >= MAX_BAD_PINS_PER_IP) {
    return json({ error: 'locked', message: 'Too many wrong PINs. Wait 15 minutes and try again.' }, 429, origin)
  }
  if ((all ?? 0) >= MAX_BAD_PINS_PER_HOUR) {
    return json({ error: 'locked', message: 'Too many wrong PINs right now. Try again in a little while.' }, 429, origin)
  }

  const pin = String(body.pin ?? '').trim()
  const { data: pinRow } = /^\d{4}$/.test(pin)
    ? await svc.from('fleet_driver_pins').select('driver_number').eq('account_id', MW_ACCOUNT_ID).eq('pin', pin).maybeSingle()
    : { data: null }
  if (!pinRow) {
    await svc.from('fleet_driver_bad_pins').insert({ ip })
    // Keep the table small: a day of history is plenty.
    await svc.from('fleet_driver_bad_pins').delete().lt('at', new Date(Date.now() - 86_400_000).toISOString())
    return json({ error: 'bad_pin', message: 'That PIN didn\'t work.' }, 401, origin)
  }
  const dNum = String(pinRow.driver_number).trim()

  const reveal = async (method: string, path: string, payload?: unknown): Promise<{ status: number; body: Any }> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await getToken(rUser, rPass, attempt > 0)
      const r = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Atmosphere atmosphere_app_id=${appId}, Bearer ${t}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
      if (r.status === 401 && attempt === 0) continue
      const text = await r.text()
      let parsed: Any = text
      try { parsed = text ? JSON.parse(text) : null } catch { /* keep text */ }
      return { status: r.status, body: parsed }
    }
    throw new Error('unreachable')
  }
  const revealMessage = (r: { body: Any }): string => {
    const b = r.body
    if (typeof b === 'string') return b
    if (Array.isArray(b) && typeof b[0] === 'string') return b[0]
    return b?.Message ?? b?.message ?? ''
  }
  const enc = encodeURIComponent
  const vehicleAssignment = async (num: string): Promise<Any | null> => {
    const r = await reveal('GET', `/da/v1/driverassignments/vehicles/${enc(num)}/currentassignment`)
    return r.status === 200 && r.body?.DriverNumber ? r.body : null
  }

  try {
    const dr = await reveal('GET', `/cmd/v1/drivers/${enc(dNum)}`)
    const driver = dr.status === 200 ? (dr.body?.Driver ?? dr.body) : null
    if (!driver) throw new UserError('Your PIN works, but your driver record isn\'t in Verizon anymore. Ask an Admin.')
    const name = driverName(driver)

    if (action === 'sign_in') {
      const a = await reveal('GET', `/da/v1/driverassignments/drivers/${enc(dNum)}/currentassignment`)
      const vNum = a.status === 200 && a.body?.VehicleNumber ? String(a.body.VehicleNumber) : null
      let vehicle: { name: string } | null = null
      if (vNum) {
        const v = await reveal('GET', `/cmd/v1/vehicles/${enc(vNum)}`)
        vehicle = { name: (v.status === 200 && cleanName(v.body?.Name)) || vNum }
      }
      return json({ ok: true, driver: { name }, vehicle }, 200, origin)
    }

    // assign
    const code = stickerCode(body.code)
    if (!code) throw new UserError('That isn\'t a vehicle sticker. Scan the QR code on the dash.')
    const { data: tag } = await svc.from('fleet_vehicle_codes').select('vehicle_number').eq('code', code).eq('account_id', MW_ACCOUNT_ID).maybeSingle()
    if (!tag) throw new UserError('This sticker isn\'t set up for a vehicle. Ask an Admin to reprint it.')
    const vNum = String(tag.vehicle_number)
    const vr = await reveal('GET', `/cmd/v1/vehicles/${enc(vNum)}`)
    if (vr.status !== 200) throw new UserError('Verizon Connect doesn\'t have this vehicle anymore. Ask an Admin to check it.')
    const vehicle = {
      name: cleanName(vr.body?.Name) || vNum,
      description: [vr.body?.Year, vr.body?.Make, vr.body?.Model].filter(Boolean).join(' ') || null,
    }

    const current = await vehicleAssignment(vNum)
    if (current && String(current.DriverNumber).trim() === dNum) {
      return json({ ok: true, already: true, vehicle }, 200, origin)
    }
    let replaced: string | null = null
    if (current) {
      const pd = await reveal('GET', `/cmd/v1/drivers/${enc(String(current.DriverNumber))}`)
      replaced = pd.status === 200 ? driverName(pd.body?.Driver ?? pd.body) : String(current.DriverNumber)
    }
    const r = await reveal('POST', '/da/v1/driverassignments', [{ DriverNumber: dNum, VehicleNumber: vNum, StartDateUTC: revealNow(), EndDateUTC: null }])
    const after = await vehicleAssignment(vNum)
    if (r.status >= 300 || /fail/i.test(revealMessage(r)) || String(after?.DriverNumber ?? '').trim() !== dNum) {
      throw new UserError(`Verizon didn't make the assignment: ${revealMessage(r) || r.status}. Try again, or ask an Admin.`)
    }
    await svc.from('fleet_changes').insert({
      account_id: MW_ACCOUNT_ID, user_id: null, user_name: name,
      action: 'assigned', driver_number: dNum, driver_name: name, vehicle_number: vNum, vehicle_name: vehicle.name,
      details: { self: true, via: 'pin', replaced_driver: current ? current.DriverNumber : null },
    })
    return json({ ok: true, vehicle, replaced }, 200, origin)
  } catch (e) {
    if (e instanceof UserError) return json({ error: 'rejected', message: e.message }, 400, origin)
    console.error('driver-assign:', e instanceof Error ? e.message : e)
    return json({ error: 'reveal_failed', message: 'Couldn\'t reach Verizon Connect. Try again in a minute.' }, 502, origin)
  }
})
