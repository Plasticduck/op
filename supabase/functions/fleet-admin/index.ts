// fleet-admin — Supabase Edge Function (Deno).
// Fleet Management for Admins: the drivers, vehicles and driver-to-vehicle
// assignments in Verizon Connect Reveal (Mighty Wash's vehicle GPS). Reveal is the
// source of truth; every change made here is also written to fleet_changes (0207).
//
// Actions (body.action):
//   overview                                   vehicles + drivers + current assignments
//   driver_create  { number, first, last, email?, phone? }
//   driver_update  { number, first, last, email?, phone? }
//   driver_delete  { number }                  ends their assignment first
//   assign         { driver, vehicle }
//   unassign       { vehicle }
//   vehicle_update { vehicle, fields: { name, plate, vin, year, make, model, fuel_type, size } }
//   odometer       { vehicle, miles }
//
// Reveal behavior this relies on (tested 2026-11-04):
//   - POST /da/v1/driverassignments moves people: assigning a driver ends their
//     previous vehicle's assignment and the vehicle's previous driver's. A failed
//     POST still answers 200, with ["Failed to add driver assignment ..."], so
//     every write is read back before it's reported as done.
//   - An assignment is ended by POSTing it again with its StartDateUTC and an
//     EndDateUTC. (DELETE /da/v1/driverassignments, as documented, rejects every
//     body shape we tried.)
//   - PUT on a driver or vehicle replaces the whole record (a field left out comes
//     back as junk), so updates send the current record with the edits merged in.
//   - Vehicles can't be created or deleted through the API, only edited.
//
// Callers: Admins (owner role) of the Mighty Wash account.
// Secrets: REVEAL_USERNAME, REVEAL_PASSWORD, REVEAL_APP_ID.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

const API = 'https://fim.api.us.fleetmatics.com'
const MW_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const CONCURRENCY = 6
const KM_PER_MILE = 1.609344

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

// Warm instances reuse the token for most of its 20 minutes.
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

// Reveal timestamps are UTC with no zone suffix, and it wants them back that way.
const utcIso = (s: unknown): string | null => (typeof s === 'string' && s ? `${s.replace(/Z$/, '')}Z` : null)
const revealNow = () => new Date().toISOString().slice(0, 19)

// Reveal stores a placeholder (not an address) when a driver has no email.
const realEmail = (e: unknown): string | null => {
  const s = String(e ?? '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

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
  const { data: me } = await svc.from('users').select('id, name, role, account_id').eq('id', u.user.id).single()
  if (!me || me.role !== 'owner' || me.account_id !== MW_ACCOUNT_ID) {
    return json({ error: 'forbidden', message: 'Fleet Management is for Admins.' }, 403, origin)
  }

  let body: Any = {}
  try { body = await req.json() } catch { /* default */ }
  const action = String(body.action ?? 'overview')

  // One retry with a fresh token if Reveal rejects the cached one. Returns the
  // status and the parsed body (text when it isn't JSON).
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

  const getDriver = async (num: string): Promise<Any | null> => {
    const r = await reveal('GET', `/cmd/v1/drivers/${enc(num)}`)
    return r.status === 200 ? (r.body?.Driver ?? r.body) : null
  }
  const getVehicle = async (num: string): Promise<Any | null> => {
    const r = await reveal('GET', `/cmd/v1/vehicles/${enc(num)}`)
    return r.status === 200 ? r.body : null
  }
  // { DriverNumber, VehicleNumber, StartDateUTC } or null when unassigned.
  const vehicleAssignment = async (num: string): Promise<Any | null> => {
    const r = await reveal('GET', `/da/v1/driverassignments/vehicles/${enc(num)}/currentassignment`)
    return r.status === 200 && r.body?.DriverNumber ? r.body : null
  }
  const driverAssignment = async (num: string): Promise<Any | null> => {
    const r = await reveal('GET', `/da/v1/driverassignments/drivers/${enc(num)}/currentassignment`)
    return r.status === 200 && r.body?.VehicleNumber ? r.body : null
  }
  const driverName = (d: Any) => `${String(d?.FirstName ?? '').trim()} ${String(d?.LastName ?? '').trim()}`.trim() || String(d?.DriverNumber ?? '')

  // Close an assignment: Reveal ends it when it's re-posted with an end date.
  const endAssignment = async (a: Any): Promise<void> => {
    const r = await reveal('POST', '/da/v1/driverassignments', [
      { DriverNumber: a.DriverNumber, VehicleNumber: a.VehicleNumber, StartDateUTC: a.StartDateUTC, EndDateUTC: revealNow() },
    ])
    if (r.status >= 300 || /fail/i.test(revealMessage(r))) throw new UserError(`Verizon didn't end the assignment: ${revealMessage(r) || r.status}`)
    if (await vehicleAssignment(a.VehicleNumber)) throw new UserError('Verizon still shows the vehicle as assigned.')
  }

  const log = async (row: Record<string, unknown>) => {
    await svc.from('fleet_changes').insert({ account_id: MW_ACCOUNT_ID, user_id: me.id, user_name: me.name, ...row })
  }

  try {
    if (action === 'overview') {
      const [vr, dr] = await Promise.all([reveal('GET', '/cmd/v1/vehicles'), reveal('GET', '/cmd/v1/drivers')])
      if (vr.status !== 200) return json({ error: 'reveal_failed', step: 'vehicles', status: vr.status }, 502, origin)
      if (dr.status !== 200) return json({ error: 'reveal_failed', step: 'drivers', status: dr.status }, 502, origin)
      const rawVehicles = (vr.body ?? []) as Any[]
      const rawDrivers = ((dr.body ?? []) as Any[]).map((row) => row?.Driver ?? row)
      const numbered = rawVehicles.filter((v) => String(v?.VehicleNumber ?? '').trim())

      const assignments = new Map<string, Any>()
      await pool(numbered, CONCURRENCY, async (v) => {
        const a = await vehicleAssignment(String(v.VehicleNumber))
        if (a) assignments.set(String(v.VehicleNumber), a)
      })
      const plots = new Map<string, Any>()
      for (let i = 0; i < numbered.length; i += 100) {
        const nums = numbered.slice(i, i + 100).map((v) => v.VehicleNumber)
        const r = await reveal('POST', '/rad/v1/vehicles/locations', nums)
        if (r.status !== 200) continue // GPS freshness is a nicety here
        for (const row of (r.body ?? []) as Any[]) {
          if (row?.StatusCode === 200 && row.ContentResource?.Value) plots.set(row.VehicleNumber, row.ContentResource.Value)
        }
      }

      // Match drivers to Operator logins by email, as the visit sync does.
      const { data: users } = await svc.from('users').select('id, name, email').eq('account_id', MW_ACCOUNT_ID)
      const userByEmail = new Map((users ?? []).map((x: Any) => [String(x.email ?? '').toLowerCase(), x]))
      const driverByNum = new Map(rawDrivers.map((d) => [String(d.DriverNumber ?? '').trim(), d]))
      const vehicleOfDriver = new Map([...assignments.values()].map((a) => [String(a.DriverNumber).trim(), String(a.VehicleNumber).trim()]))

      const vehicles = numbered.map((v) => {
        const num = String(v.VehicleNumber)
        const a = assignments.get(num)
        const d = a ? driverByNum.get(String(a.DriverNumber).trim()) : null
        const p = plots.get(num)
        return {
          number: num,
          name: cleanName(v.Name) || num,
          plate: v.RegistrationNumber ?? null,
          vin: v.VIN ?? null,
          year: v.Year ?? null,
          make: v.Make ?? null,
          model: v.Model ?? null,
          fuel_type: v.FuelType ?? 0,
          size: v.VehicleSize ?? 0,
          driver: a ? { number: String(a.DriverNumber), name: d ? driverName(d) : String(a.DriverNumber), since: utcIso(a.StartDateUTC) } : null,
          gps_at: utcIso(p?.UpdateUTC),
          status: p?.DisplayState ?? null,
        }
      }).sort((a, b) => a.name.localeCompare(b.name))

      const drivers = rawDrivers
        .filter((d) => String(d?.DriverNumber ?? '').trim() && d.DriverNumber !== 'null')
        .map((d) => {
          const num = String(d.DriverNumber).trim()
          const email = realEmail(d.EmailAddress)
          const op: Any = email ? userByEmail.get(email.toLowerCase()) : null
          return {
            number: num,
            first: String(d.FirstName ?? '').trim(),
            last: String(d.LastName ?? '').trim(),
            email,
            phone: d.PhoneNumber ? String(d.PhoneNumber) : null,
            created_at: utcIso(d.CreatedDateUTC),
            vehicle: vehicleOfDriver.get(num) ?? null,
            operator_user: op ? { id: op.id, name: op.name } : null,
          }
        })
        .sort((a, b) => `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`))

      const unnumbered = rawVehicles.filter((v) => !String(v?.VehicleNumber ?? '').trim()).map((v) => cleanName(v.Name))
      return json({ fetched_at: new Date().toISOString(), vehicles, drivers, unnumbered }, 200, origin)
    }

    if (action === 'driver_create' || action === 'driver_update') {
      const num = String(body.number ?? '').trim()
      const first = String(body.first ?? '').trim()
      const last = String(body.last ?? '').trim()
      const email = String(body.email ?? '').trim() || null
      const phone = String(body.phone ?? '').replace(/[^\d+]/g, '') || null
      if (!num || !first || !last) throw new UserError('First name, last name and driver number are required.')
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(num)) throw new UserError('Driver numbers use letters, numbers, - and _ (up to 20).')
      if (email && !realEmail(email)) throw new UserError('That email address doesn\'t look right.')

      const existing = await getDriver(num)
      if (action === 'driver_create') {
        if (existing) throw new UserError(`Driver number ${num} is already used by ${driverName(existing)}.`)
        const r = await reveal('POST', '/cmd/v1/drivers', { DriverNumber: num, FirstName: first, LastName: last, EmailAddress: email, PhoneNumber: phone, EnableMobileAccess: false })
        if (r.status !== 201 && r.status !== 200) throw new UserError(`Verizon didn't add the driver: ${revealMessage(r) || r.status}`)
        await log({ action: 'driver_added', driver_number: num, driver_name: `${first} ${last}`, details: { email, phone } })
        return json({ ok: true }, 200, origin)
      }
      if (!existing) throw new UserError(`Driver ${num} isn't in Verizon anymore.`)
      const r = await reveal('PUT', `/cmd/v1/drivers/${enc(num)}`, {
        DriverNumber: num, FirstName: first, LastName: last,
        EmailAddress: email ?? realEmail(existing.EmailAddress),
        PhoneNumber: phone, EnableMobileAccess: !!existing.EnableMobileAccess,
      })
      if (r.status >= 300) throw new UserError(`Verizon didn't save the driver: ${revealMessage(r) || r.status}`)
      await log({
        action: 'driver_edited', driver_number: num, driver_name: `${first} ${last}`,
        details: { before: { first: existing.FirstName, last: existing.LastName, email: realEmail(existing.EmailAddress), phone: existing.PhoneNumber }, after: { first, last, email, phone } },
      })
      return json({ ok: true }, 200, origin)
    }

    if (action === 'driver_delete') {
      const num = String(body.number ?? '').trim()
      const existing = num ? await getDriver(num) : null
      if (!existing) throw new UserError(`Driver ${num} isn't in Verizon.`)
      const a = await driverAssignment(num)
      if (a) await endAssignment(a)
      const r = await reveal('DELETE', `/cmd/v1/drivers/${enc(num)}`)
      if (r.status >= 300) throw new UserError(`Verizon didn't remove the driver: ${revealMessage(r) || r.status}`)
      await log({ action: 'driver_removed', driver_number: num, driver_name: driverName(existing), vehicle_number: a?.VehicleNumber ?? null, details: { email: realEmail(existing.EmailAddress) } })
      return json({ ok: true }, 200, origin)
    }

    if (action === 'assign') {
      const dNum = String(body.driver ?? '').trim()
      const vNum = String(body.vehicle ?? '').trim()
      const [d, v] = await Promise.all([getDriver(dNum), getVehicle(vNum)])
      if (!d) throw new UserError(`Driver ${dNum} isn't in Verizon.`)
      if (!v) throw new UserError(`Vehicle ${vNum} isn't in Verizon.`)
      const [prevOfVehicle, prevOfDriver] = await Promise.all([vehicleAssignment(vNum), driverAssignment(dNum)])
      const r = await reveal('POST', '/da/v1/driverassignments', [{ DriverNumber: dNum, VehicleNumber: vNum, StartDateUTC: revealNow(), EndDateUTC: null }])
      const after = await vehicleAssignment(vNum)
      if (r.status >= 300 || /fail/i.test(revealMessage(r)) || String(after?.DriverNumber ?? '').trim() !== dNum) {
        throw new UserError(`Verizon didn't make the assignment: ${revealMessage(r) || r.status}`)
      }
      await log({
        action: 'assigned', driver_number: dNum, driver_name: driverName(d), vehicle_number: vNum, vehicle_name: cleanName(v.Name),
        details: {
          replaced_driver: prevOfVehicle && String(prevOfVehicle.DriverNumber).trim() !== dNum ? prevOfVehicle.DriverNumber : null,
          moved_from_vehicle: prevOfDriver && String(prevOfDriver.VehicleNumber).trim() !== vNum ? prevOfDriver.VehicleNumber : null,
        },
      })
      return json({ ok: true }, 200, origin)
    }

    if (action === 'unassign') {
      const vNum = String(body.vehicle ?? '').trim()
      const a = vNum ? await vehicleAssignment(vNum) : null
      if (!a) throw new UserError('That vehicle has no driver assigned.')
      const [d, v] = await Promise.all([getDriver(String(a.DriverNumber)), getVehicle(vNum)])
      await endAssignment(a)
      await log({ action: 'unassigned', driver_number: a.DriverNumber, driver_name: d ? driverName(d) : null, vehicle_number: vNum, vehicle_name: v ? cleanName(v.Name) : null })
      return json({ ok: true }, 200, origin)
    }

    if (action === 'vehicle_update') {
      const vNum = String(body.vehicle ?? '').trim()
      const v = vNum ? await getVehicle(vNum) : null
      if (!v) throw new UserError(`Vehicle ${vNum} isn't in Verizon.`)
      const f = body.fields ?? {}
      const str = (x: unknown) => (String(x ?? '').trim() || null)
      const name = str(f.name)
      if (!name) throw new UserError('The vehicle needs a name.')
      // Keep the tracker's IMEI on the name: installers append it, and it's how a
      // tracker is matched to a vehicle in Reveal. Every Operator page hides it.
      const imei = String(v.Name ?? '').match(/\d{15}/)?.[0]
      const year = f.year == null || f.year === '' ? null : Number(f.year)
      if (year != null && (!Number.isInteger(year) || year < 1950 || year > 2100)) throw new UserError('Year should be like 2024.')
      const fuel = Number(f.fuel_type ?? v.FuelType ?? 0)
      const size = Number(f.size ?? v.VehicleSize ?? 0)
      if (![0, 1, 2].includes(fuel) || ![0, 1, 2].includes(size)) throw new UserError('Pick a fuel type and size from the list.')
      const want = {
        Name: imei && !name.includes(imei) ? `${name} ${imei}` : name,
        RegistrationNumber: str(f.plate),
        VIN: str(f.vin),
        Make: str(f.make),
        Model: str(f.model),
        Year: year,
        FuelType: fuel,
        VehicleSize: size,
      }
      const r = await reveal('PUT', `/cmd/v1/vehicles/${enc(vNum)}`, {
        Name: want.Name, VehicleNumber: vNum, RegistrationNumber: want.RegistrationNumber, VIN: want.VIN,
        Make: want.Make, Year: want.Year, Model: want.Model, TankCapacity: v.TankCapacity ?? 0,
        HighwayMPG: v.HighwayMPG ?? null, CityMPG: v.CityMPG ?? null, FuelType: want.FuelType, VehicleSize: want.VehicleSize,
        HasNavigationDevice: !!v.HasNavigationDevice, HasTachograph: !!v.HasTachograph,
      })
      if (r.status >= 300) throw new UserError(`Verizon didn't save the vehicle: ${revealMessage(r) || r.status}`)
      // Report any field Verizon didn't keep rather than claiming it saved.
      const after = await getVehicle(vNum)
      const labels: Record<string, string> = { Name: 'name', RegistrationNumber: 'plate', VIN: 'VIN', Make: 'make', Model: 'model', Year: 'year', FuelType: 'fuel type', VehicleSize: 'size' }
      const notSaved = Object.entries(want)
        .filter(([k, val]) => String(after?.[k] ?? '').trim().toLowerCase() !== String(val ?? '').trim().toLowerCase())
        .map(([k]) => labels[k])
      await log({
        action: 'vehicle_edited', vehicle_number: vNum, vehicle_name: name,
        details: { before: { name: cleanName(v.Name), plate: v.RegistrationNumber, vin: v.VIN, make: v.Make, model: v.Model, year: v.Year, fuel_type: v.FuelType, size: v.VehicleSize }, after: { ...f, name }, not_saved: notSaved },
      })
      return json({ ok: true, not_saved: notSaved }, 200, origin)
    }

    if (action === 'odometer') {
      const vNum = String(body.vehicle ?? '').trim()
      const miles = Number(body.miles)
      if (!Number.isFinite(miles) || miles < 0 || miles > 2_000_000) throw new UserError('Enter the odometer in miles.')
      const v = vNum ? await getVehicle(vNum) : null
      if (!v) throw new UserError(`Vehicle ${vNum} isn't in Verizon.`)
      const r = await reveal('PUT', `/cmd/v1/vehicles/${enc(vNum)}/odometer`, { Odometer: Math.round(miles * KM_PER_MILE), AsOf: revealNow() })
      if (r.status >= 300) throw new UserError(`Verizon didn't set the odometer: ${revealMessage(r) || r.status}`)
      await log({ action: 'odometer_set', vehicle_number: vNum, vehicle_name: cleanName(v.Name), details: { miles: Math.round(miles) } })
      return json({ ok: true }, 200, origin)
    }

    return json({ error: 'unknown_action' }, 400, origin)
  } catch (e) {
    if (e instanceof UserError) return json({ error: 'rejected', message: e.message }, 400, origin)
    return json({ error: 'reveal_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
