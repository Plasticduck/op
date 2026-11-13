// Hourly car counts per Mighty Wash site, from DRB SiteWatch and FlexWash, for
// the site_hourly_cars table (sync-site-hourly, migration 0235) and Operator AI's
// hourly_cars tool.
//
// DRB: SiteWatch "Carwashes" report category (BRANCH 001001001) lines, SUM(QTY) so
//   refunds net out, by the business date (SALE.LOGDATE) and the hour on the
//   ticket (SALE.CREATED, the site's local time). Per site and day this equals the
//   official car count exactly (checked 2026-11-13 at every DRB site). "Test Car"
//   washes are counted and also returned apart, since Site Performance leaves
//   them out.
// FlexWash: get-temporal-wash-stats with interval 'hour'; cars = single + member
//   washes, as in the daily numbers (sync-site-daily). FlexWash labels each hour in
//   the car wash's FlexWash timezone (written like a UTC time), and some are set
//   wrong (MW #24 is New York), so hours are moved into the site's real zone.
//   Hours outside a site's operating window are folded into its first/last hour.
//
// A site on FlexWash keeps a few stray DRB washes after its cutover; both parts
// are stored and added together, like site_daily_totals.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const DEFAULT_DASH = 'https://dashboard.tail1e050b.ts.net'
const FLEX_BASE = 'https://api.flexwash.com'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const FLEX_MAX_DAYS = 60 // FlexWash's cap for one temporal-stats call

export type HourRow = { date: string; site_number: number; hour: number; cars: number; test_cars: number }
export type Source = 'drb' | 'flex'

// The New Mexico sites run on Mountain time; every other site is Central.
const NM_SITES = new Set([16, 17, 18, 19, 20, 21, 23, 26])
export const siteZone = (n: number) => (NM_SITES.has(n) ? 'America/Denver' : 'America/Chicago')

const num = (v: unknown) => Number(v) || 0
const pad = (n: number) => String(n).padStart(2, '0')
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
export const minDate = (a: string, b: string) => (a < b ? a : b)
export const maxDate = (a: string, b: string) => (a > b ? a : b)
export function centralToday(d = new Date()): string {
  const p = zoneParts('America/Chicago', d.getTime())
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

// ---- time zones ------------------------------------------------------------
function zoneParts(zone: string, t: number) {
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(t)) p[x.type] = x.value
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}
const offsetMs = (zone: string, t: number) => {
  const p = zoneParts(zone, t)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t
}
// A wall-clock hour in one zone, as the wall-clock date and hour in another.
export function moveWall(date: string, hour: number, from: string, to: string): { date: string; hour: number } {
  if (from === to) return { date, hour }
  const wall = Date.parse(`${date}T${pad(hour)}:00:00Z`)
  let t = wall - offsetMs(from, wall)
  t = wall - offsetMs(from, t)
  const p = zoneParts(to, t)
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, hour: p.h }
}

// ---- DRB (SiteWatch through the MW dashboard's custom_query) ----------------
export type Drb = { base: string; cookie: string }

export async function drbLogin(): Promise<Drb> {
  const password = Deno.env.get('MW_DASHBOARD_PASSWORD')
  if (!password) throw new Error('MW_DASHBOARD_PASSWORD is not configured.')
  const base = (Deno.env.get('MW_DASHBOARD_URL') ?? DEFAULT_DASH).replace(/\/$/, '')
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
    body: `password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  })
  const m = (res.headers.get('set-cookie') ?? '').match(/session=[^;]+/)
  if (!m) throw new Error(`DRB dashboard login failed (${res.status}).`)
  return { base, cookie: m[0] }
}

async function drbSql(drb: Drb, sql: string): Promise<unknown[][]> {
  const res = await fetch(`${drb.base}/api/custom_query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: drb.cookie, 'User-Agent': BROWSER_UA },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(90_000),
  })
  const j = (await res.json().catch(() => null)) as { rows?: unknown[][]; error?: unknown } | null
  if (!res.ok || !j?.rows || j.error) throw new Error(`SiteWatch query failed (${res.status}${j?.error ? `: ${String(j.error).slice(0, 160)}` : ''}).`)
  return j.rows
}

const swName = (n: number) => `MightyWash ${String(n).padStart(3, '0')}`
const NOT_WASHES = new Set([19]) // store 019 is the lube shop

// Hourly cars at every current store (or just `sites`) over [start, end]. The SQL
// gateway returns at most 1,000 rows, so it pages; one day for every site is ~250.
export async function drbHourly(drb: Drb, start: string, end: string, sites?: number[] | null): Promise<HourRow[]> {
  const only = sites?.length ? ` AND TRIM(sl.SITENAME) IN (${sites.map((n) => `'${swName(n)}'`).join(',')})` : ''
  const out: HourRow[] = []
  for (let skip = 0; skip < 50_000; skip += 1000) {
    const rows = await drbSql(drb,
      `SELECT FIRST 1000 SKIP ${skip} TRIM(sl.SITENAME), CAST(s.LOGDATE AS DATE), EXTRACT(HOUR FROM s.CREATED), SUM(si.QTY), ` +
      "SUM(CASE WHEN UPPER(it.NAME) LIKE '%TEST CAR%' THEN si.QTY ELSE 0 END) " +
      'FROM SALEITEMS si JOIN SALE s ON s.SITE=si.SITE AND s.OBJID=si.SALEID JOIN ITEM it ON it.OBJID=si.ITEM ' +
      'JOIN ITEMRPTCATEGORY rc ON rc.OBJID=it.REPORTCATEGORY JOIN SITELIST sl ON sl.ID=s.SITE ' +
      `WHERE s.LOGDATE>='${start}' AND s.LOGDATE<='${end}' AND si.FLAGS>=0 AND rc.BRANCH='001001001'${only} ` +
      'GROUP BY 1, 2, 3 ORDER BY 1, 2, 3')
    for (const [name, date, hour, cars, tests] of rows) {
      // Current stores only ("MightyWash 0NN"); "OLD MW.." and HQ rows are skipped,
      // and so is the lube shop, which the official car count leaves out.
      const m = String(name).match(/^MightyWash (\d+)$/)
      if (!m || hour == null || NOT_WASHES.has(Number(m[1]))) continue
      out.push({ date: String(date).slice(0, 10), site_number: Number(m[1]), hour: Number(hour), cars: num(cars), test_cars: num(tests) })
    }
    if (rows.length < 1000) break
  }
  return out
}

// ---- FlexWash -------------------------------------------------------------
export type FlexSite = { site_number: number; car_wash_id: string; start_date: string }

export function flexClient(svc: SupabaseClient) {
  let token: Promise<string> | null = null
  const mint = async (force: boolean): Promise<string> => {
    if (!force) {
      const { data } = await svc.from('service_tokens').select('token, expires_at').eq('provider', 'flexwash').maybeSingle()
      if (data && new Date(data.expires_at as string).getTime() > Date.now() + 60_000) return data.token as string
    }
    const id = Deno.env.get('FLEXWASH_CLIENT_ID')
    const secret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
    if (!id || !secret) throw new Error('FlexWash is not configured.')
    const res = await fetch(`${FLEX_BASE}/external/access-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: id, clientSecret: secret }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.accessToken) throw new Error(`FlexWash sign-in failed (${res.status}).`)
    await svc.from('service_tokens').upsert({ provider: 'flexwash', token: j.accessToken, expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'provider' })
    return j.accessToken as string
  }
  // deno-lint-ignore no-explicit-any
  return async (path: string, body: unknown): Promise<any> => {
    token ??= mint(false)
    for (let attempt = 0; attempt < 4; attempt++) {
      let res: Response
      try {
        res = await fetch(`${FLEX_BASE}${path}?organizationId=275`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45_000),
        })
      } catch (e) {
        if (attempt === 3) throw e
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
        continue
      }
      if (res.ok) return await res.json()
      if (res.status === 401 && attempt === 0) { token = mint(true); continue }
      if (res.status !== 429 && res.status < 500) throw new Error(`FlexWash answered ${res.status}.`)
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
    throw new Error('FlexWash did not answer.')
  }
}

// Each car wash's timezone as set in FlexWash (it labels hours in this zone).
// deno-lint-ignore no-explicit-any
export async function flexZones(flex: (p: string, b: unknown) => Promise<any>): Promise<Map<string, string>> {
  const j = await flex('/external/car-wash/get-car-washes', {})
  return new Map(((j?.carWashes ?? []) as { id: unknown; timezone?: string }[]).map((w) => [String(w.id), w.timezone || 'America/Chicago']))
}

// One FlexWash site's hourly cars over [start, end], in the site's real local time.
export async function flexHourly(
  // deno-lint-ignore no-explicit-any
  flex: (p: string, b: unknown) => Promise<any>,
  site: FlexSite, flexZone: string, start: string, end: string,
): Promise<HourRow[]> {
  const real = siteZone(site.site_number)
  const byKey = new Map<string, HourRow>()
  for (let from = start; from <= end; from = addDays(from, FLEX_MAX_DAYS)) {
    const to = minDate(end, addDays(from, FLEX_MAX_DAYS - 1))
    const j = await flex('/external/wash-and-revenue-stats/get-temporal-wash-stats', {
      carWashIds: [site.car_wash_id], dateRange: { start: from, end: to }, interval: 'hour',
    })
    for (const b of (j?.washStats ?? []) as Record<string, unknown>[]) {
      const cars = num(b.singleWashCount) + num(b.memberWashCount)
      if (!cars) continue
      const iso = String(b.iso8601)
      const w = moveWall(iso.slice(0, 10), Number(iso.slice(11, 13)), flexZone, real)
      if (w.date < start || w.date > end) continue
      const k = `${w.date}|${w.hour}`
      const row = byKey.get(k) ?? { date: w.date, site_number: site.site_number, hour: w.hour, cars: 0, test_cars: 0 }
      row.cars += cars
      byKey.set(k, row)
    }
  }
  return [...byKey.values()]
}

// ---- storing ----------------------------------------------------------------
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

async function replace(svc: SupabaseClient, source: Source, rows: HourRow[], start: string, end: string, site?: number) {
  let del = svc.from('site_hourly_cars').delete().eq('account_id', MW_ACCOUNT).eq('source', source).gte('date', start).lte('date', end)
  if (site != null) del = del.eq('site_number', site)
  const { error: de } = await del
  if (de) throw new Error(`clear ${source}: ${de.message}`)
  const now = new Date().toISOString()
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await svc.from('site_hourly_cars').insert(
      rows.slice(i, i + 1000).map((r) => ({ account_id: MW_ACCOUNT, source, updated_at: now, ...r })),
    )
    if (error) throw new Error(`save ${source}: ${error.message}`)
  }
}

export type SyncResult = { drbDays: number; drbRows: number; flexSites: number; flexRows: number; errors: string[] }

// Re-reads [start, end] from DRB (one day at a time) and/or FlexWash (each site
// from its cutover day) and replaces what's stored for those days. A source that
// fails leaves its stored rows alone.
export async function syncHourly(svc: SupabaseClient, start: string, end: string, parts: 'drb' | 'flex' | 'both' = 'both'): Promise<SyncResult> {
  const out: SyncResult = { drbDays: 0, drbRows: 0, flexSites: 0, flexRows: 0, errors: [] }
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)

  const drbPart = async () => {
    let drb: Drb
    try { drb = await drbLogin() } catch (e) { out.errors.push(String(e instanceof Error ? e.message : e)); return }
    await pool(days, 2, async (day) => {
      try {
        const rows = await drbHourly(drb, day, day)
        await replace(svc, 'drb', rows, day, day)
        out.drbDays++
        out.drbRows += rows.length
      } catch (e) { out.errors.push(`DRB ${day}: ${e instanceof Error ? e.message : e}`) }
    })
  }

  const flexPart = async () => {
    const { data: sites } = await svc.from('flexwash_sites').select('site_number, car_wash_id, start_date')
      .eq('account_id', MW_ACCOUNT).eq('active', true).not('start_date', 'is', null)
    const live = ((sites ?? []) as FlexSite[]).filter((s) => String(s.start_date) <= end)
    if (!live.length) return
    let flex: ReturnType<typeof flexClient>, zones: Map<string, string>
    try { flex = flexClient(svc); zones = await flexZones(flex) } catch (e) { out.errors.push(`FlexWash: ${e instanceof Error ? e.message : e}`); return }
    await pool(live, 4, async (s) => {
      const from = maxDate(start, String(s.start_date))
      try {
        const rows = await flexHourly(flex, s, zones.get(String(s.car_wash_id)) ?? 'America/Chicago', from, end)
        await replace(svc, 'flex', rows, from, end, s.site_number)
        out.flexSites++
        out.flexRows += rows.length
      } catch (e) { out.errors.push(`FlexWash MW${pad(s.site_number)}: ${e instanceof Error ? e.message : e}`) }
    })
  }

  await Promise.all([parts !== 'flex' ? drbPart() : null, parts !== 'drb' ? flexPart() : null])
  return out
}
