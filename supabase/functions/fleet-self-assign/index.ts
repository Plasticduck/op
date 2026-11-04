// fleet-self-assign — Supabase Edge Function (Deno).
// A driver scans the QR sticker on a vehicle's dash (/v/<code>) and puts
// themselves on it in Verizon Connect Reveal. Any signed-in Mighty Wash user.
//
// Actions (body.action):
//   lookup  { code }                         the vehicle, who's driving it, and who you are in Reveal
//   claim   { code, driver? | create? }      assign yourself (linking or adding your driver record first)
//   release { code }                         take yourself off (only if you're its driver)
//
// Who you are in Reveal: a fleet_driver_links row (0208), else the Reveal driver
// whose email is your login email. Someone with neither picks themselves from
// the drivers no one is linked to (`driver`), or gets a new driver record made
// from their name and email (`create`). Every link and assignment is logged in
// fleet_changes, and Admins can undo a link on Fleet Management.
//
// Reveal behavior relied on (tested 2026-11-04, see fleet-admin): an assignment
// releases the vehicle's previous driver and the driver's previous vehicle; a
// failed POST still answers 200, so the result is read back; an assignment ends
// by re-posting it with an EndDateUTC.
//
// Secrets: REVEAL_USERNAME, REVEAL_PASSWORD, REVEAL_APP_ID.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

const API = 'https://fim.api.us.fleetmatics.com'
const MW_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

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
const utcIso = (s: unknown): string | null => (typeof s === 'string' && s ? `${s.replace(/Z$/, '')}Z` : null)
const revealNow = () => new Date().toISOString().slice(0, 19)
const realEmail = (e: unknown): string | null => {
  const s = String(e ?? '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null
}
const driverName = (d: Any) => `${String(d?.FirstName ?? '').trim()} ${String(d?.LastName ?? '').trim()}`.trim() || String(d?.DriverNumber ?? '')

class UserError extends Error {}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const rUser = Deno.env.get('REVEAL_USERNAME')
  const rPass = Deno.env.get('REVEAL_PASSWORD')
  const appId = Deno.env.get('REVEAL_APP_ID')
  if (!rUser || !rPass || !appId) return json({ error: 'no_key', message: 'Verizon Connect is not configured.' }, 503, origin)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: me } = await svc.from('users').select('id, name, email, account_id').eq('id', u.user.id).single()
  if (!me || me.account_id !== MW_ACCOUNT_ID) {
    return json({ error: 'forbidden', message: 'This sticker belongs to another company.' }, 403, origin)
  }

  let body: Any = {}
  try { body = await req.json() } catch { /* default */ }
  const action = String(body.action ?? 'lookup')
  const code = String(body.code ?? '').trim().toUpperCase()

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
  const log = async (row: Record<string, unknown>) => {
    await svc.from('fleet_changes').insert({ account_id: MW_ACCOUNT_ID, user_id: me.id, user_name: me.name, ...row })
  }

  try {
    const { data: tag } = await svc.from('fleet_vehicle_codes').select('vehicle_number').eq('code', code).eq('account_id', MW_ACCOUNT_ID).maybeSingle()
    if (!tag) throw new UserError('This sticker isn\'t set up for a vehicle. Ask an Admin to reprint it.')
    const vNum = tag.vehicle_number

    const [vr, dr, linksRes, usersRes] = await Promise.all([
      reveal('GET', `/cmd/v1/vehicles/${enc(vNum)}`),
      reveal('GET', '/cmd/v1/drivers'),
      svc.from('fleet_driver_links').select('user_id, driver_number').eq('account_id', MW_ACCOUNT_ID),
      svc.from('users').select('id, email').eq('account_id', MW_ACCOUNT_ID),
    ])
    if (vr.status !== 200) throw new UserError('Verizon Connect doesn\'t have this vehicle anymore. Ask an Admin to check it.')
    if (dr.status !== 200) throw new Error(`drivers ${dr.status}`)
    const vehicle = vr.body
    const vehicleName = cleanName(vehicle.Name) || vNum
    const drivers = ((dr.body ?? []) as Any[]).map((row) => row?.Driver ?? row).filter((d) => String(d?.DriverNumber ?? '').trim())
    const byNum = new Map(drivers.map((d) => [String(d.DriverNumber).trim(), d]))
    const links = linksRes.data ?? []
    const linkedNums = new Set(links.map((l: Any) => l.driver_number))
    const userEmails = new Set((usersRes.data ?? []).map((x: Any) => String(x.email ?? '').toLowerCase()))

    // Who the caller is in Reveal.
    const myLink = links.find((l: Any) => l.user_id === me.id)
    const myEmail = String(me.email ?? '').toLowerCase()
    let mine: Any = myLink ? byNum.get(myLink.driver_number) ?? null : null
    if (!mine) mine = drivers.find((d) => realEmail(d.EmailAddress) === myEmail) ?? null

    // Drivers no Operator login is tied to, which the caller may say they are.
    const candidates = drivers
      .filter((d) => !linkedNums.has(String(d.DriverNumber).trim()) && !(realEmail(d.EmailAddress) && userEmails.has(realEmail(d.EmailAddress)!)))
      .map((d) => ({ number: String(d.DriverNumber).trim(), name: driverName(d) }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const current = await vehicleAssignment(vNum)
    const currentDriver = current ? byNum.get(String(current.DriverNumber).trim()) : null
    const describe = (a: Any, d: Any) => (a ? {
      name: d ? driverName(d) : String(a.DriverNumber),
      since: utcIso(a.StartDateUTC),
      is_me: !!mine && String(a.DriverNumber).trim() === String(mine.DriverNumber).trim(),
    } : null)
    const vehicleInfo = {
      name: vehicleName,
      description: [vehicle.Year, vehicle.Make, vehicle.Model].filter(Boolean).join(' ') || null,
      plate: vehicle.RegistrationNumber ?? null,
    }

    if (action === 'lookup') {
      return json({
        vehicle: vehicleInfo,
        current: describe(current, currentDriver),
        me: { name: me.name, driver: mine ? { number: String(mine.DriverNumber).trim(), name: driverName(mine) } : null },
        candidates: mine ? [] : candidates,
      }, 200, origin)
    }

    if (action === 'claim') {
      if (!mine && body.driver) {
        const pick = String(body.driver).trim()
        if (!candidates.some((c) => c.number === pick)) throw new UserError('That driver is already tied to someone else\'s login. Ask an Admin.')
        const { error } = await svc.from('fleet_driver_links').insert({ account_id: MW_ACCOUNT_ID, user_id: me.id, driver_number: pick, source: 'self' })
        if (error) throw new UserError('Someone just linked that driver. Refresh and try again.')
        mine = byNum.get(pick)
        await log({ action: 'linked', driver_number: pick, driver_name: driverName(mine), details: { source: 'self', via: 'qr' } })
      } else if (!mine && body.create) {
        // A new driver record from the caller's own name and email.
        const parts = String(me.name ?? '').trim().split(/\s+/)
        const first = parts[0] || 'Driver'
        const last = parts.length > 1 ? parts.slice(1).join(' ') : '-'
        const base = `${first.charAt(0)}${parts.length > 1 ? parts[parts.length - 1] : first}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || 'DRIVER'
        let num = base
        for (let i = 2; byNum.has(num) && i < 100; i++) num = `${base}${i}`
        if (byNum.has(num)) throw new UserError('Couldn\'t pick a driver number. Ask an Admin to add you.')
        const r = await reveal('POST', '/cmd/v1/drivers', { DriverNumber: num, FirstName: first, LastName: last, EmailAddress: realEmail(me.email), PhoneNumber: null, EnableMobileAccess: false })
        if (r.status !== 201 && r.status !== 200) throw new UserError(`Verizon didn't add you as a driver: ${revealMessage(r) || r.status}`)
        await svc.from('fleet_driver_links').insert({ account_id: MW_ACCOUNT_ID, user_id: me.id, driver_number: num, source: 'created' })
        mine = { DriverNumber: num, FirstName: first, LastName: last }
        await log({ action: 'driver_added', driver_number: num, driver_name: driverName(mine), details: { source: 'self', via: 'qr', email: realEmail(me.email) } })
      }
      if (!mine) throw new UserError('Pick who you are first.')
      const dNum = String(mine.DriverNumber).trim()
      if (current && String(current.DriverNumber).trim() === dNum) {
        return json({ ok: true, already: true, vehicle: vehicleName }, 200, origin)
      }
      const r = await reveal('POST', '/da/v1/driverassignments', [{ DriverNumber: dNum, VehicleNumber: vNum, StartDateUTC: revealNow(), EndDateUTC: null }])
      const after = await vehicleAssignment(vNum)
      if (r.status >= 300 || /fail/i.test(revealMessage(r)) || String(after?.DriverNumber ?? '').trim() !== dNum) {
        throw new UserError(`Verizon didn't make the assignment: ${revealMessage(r) || r.status}`)
      }
      await log({
        action: 'assigned', driver_number: dNum, driver_name: driverName(mine), vehicle_number: vNum, vehicle_name: vehicleName,
        details: { self: true, via: 'qr', replaced_driver: current ? current.DriverNumber : null },
      })
      return json({ ok: true, vehicle: vehicleName, replaced: current && currentDriver ? driverName(currentDriver) : null }, 200, origin)
    }

    if (action === 'release') {
      if (!current || !mine || String(current.DriverNumber).trim() !== String(mine.DriverNumber).trim()) {
        throw new UserError('You aren\'t this vehicle\'s driver right now.')
      }
      const r = await reveal('POST', '/da/v1/driverassignments', [
        { DriverNumber: current.DriverNumber, VehicleNumber: vNum, StartDateUTC: current.StartDateUTC, EndDateUTC: revealNow() },
      ])
      if (r.status >= 300 || /fail/i.test(revealMessage(r)) || await vehicleAssignment(vNum)) {
        throw new UserError(`Verizon didn't take you off: ${revealMessage(r) || r.status}`)
      }
      await log({ action: 'unassigned', driver_number: current.DriverNumber, driver_name: driverName(mine), vehicle_number: vNum, vehicle_name: vehicleName, details: { self: true, via: 'qr' } })
      return json({ ok: true, vehicle: vehicleName }, 200, origin)
    }

    return json({ error: 'unknown_action' }, 400, origin)
  } catch (e) {
    if (e instanceof UserError) return json({ error: 'rejected', message: e.message }, 400, origin)
    return json({ error: 'reveal_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
