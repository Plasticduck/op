// flexwash-site-watch — Supabase Edge Function (Deno), CRON.
// Every morning, asks FlexWash for Mighty Wash's full store list and adds any store
// that has started running washes to flexwash_sites, so a site moving to FlexWash
// doesn't drop out of the reports (Kevan, 2026-11-02; MW5 and MW10 went live on
// 2026-10-27 and nothing told Operator). Runs before sync-site-daily-week, and also
// loads the new site's days itself.
//
// A store counts as live once it has a day with MIN_WASHES or more, so a couple of
// test washes don't add it. Its flexwash_sites.start_date is its first wash in the
// LEAD_DAYS before that day: stores often start with a few washes the day or two
// before a full day (MW6: 2 washes on 10-12, a full day on 10-14), but a stray test
// wash weeks earlier isn't the switch. That matches every cutover set by hand since
// the rollout. New sites are reporting-only (dashboard_source false, see migration
// 0165). A store already in flexwash_sites is left alone, even if inactive:
// switching one off stays off.
//
// Auth: the cron's service-role JWT, or the Mighty Wash owner (manual run). The
// caller's token is passed on to flexwash and sync-site-daily, which accept the
// same. (This function's own SUPABASE_SERVICE_ROLE_KEY is an sb_secret key, which
// those reject.)
// Body: { dryRun? (report what it would add, change nothing) }
// Schedule: pg_cron at 09:10 UTC.

import { createClient } from 'npm:@supabase/supabase-js@2'

const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const MW_FLEX_ORG = '275' // FlexWash organization id; the token doesn't carry one.
const TZ = 'America/Chicago'
const MIN_WASHES = 10
const LEAD_DAYS = 7
const LOOKBACK_DAYS = 60

// deno-lint-ignore no-explicit-any
type Any = any

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

async function callFn(auth: string, name: string, body: unknown): Promise<Any> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${name} answered ${res.status}: ${JSON.stringify(data)?.slice(0, 200)}`)
  return data
}

// The day this store went live on FlexWash, or null if it hasn't yet.
async function firstLiveDay(auth: string, carWashId: string, end: string): Promise<string | null> {
  const resp = await callFn(auth, 'flexwash', {
    path: '/external/wash-and-revenue-stats/get-temporal-wash-stats',
    body: { carWashIds: [carWashId], interval: 'day', dateRange: { start: addDays(end, -LOOKBACK_DAYS), end } },
  })
  const days = ((resp?.data?.washStats ?? []) as Any[])
    .map((d) => ({ date: String(d.iso8601).slice(0, 10), washes: (Number(d.singleWashCount) || 0) + (Number(d.memberWashCount) || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const fullDay = days.find((d) => d.washes >= MIN_WASHES)
  if (!fullDay) return null
  const from = addDays(fullDay.date, -LEAD_DAYS)
  return days.find((d) => d.washes > 0 && d.date >= from)?.date ?? fullDay.date
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const auth = req.headers.get('Authorization') ?? ''
  if (jwtRole(auth) !== 'service_role') {
    const { data: u } = await svc.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
    if (!u?.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).maybeSingle()
    if (!p || p.account_id !== MW_ACCOUNT || p.role !== 'owner') return json({ error: 'forbidden' }, 403)
  }

  let body: { dryRun?: boolean } = {}
  try { body = await req.json() } catch { /* cron sends {} */ }

  let stores: { id: string; name: string }[]
  try {
    const resp = await callFn(auth, 'flexwash', { path: `/external/car-wash/get-car-washes?organizationId=${MW_FLEX_ORG}`, body: { carWashIds: null } })
    stores = ((resp?.data?.carWashes ?? []) as Any[]).map((w) => ({ id: String(w.id), name: String(w.name ?? '') }))
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 300)
    console.error('[flexwash-site-watch] store list failed:', message)
    return json({ error: 'store_list_failed', message }, 502)
  }
  if (!stores.length) return json({ error: 'store_list_empty' }, 502)

  const { data: rows, error: rowsErr } = await svc.from('flexwash_sites').select('site_number, car_wash_id').eq('account_id', MW_ACCOUNT)
  if (rowsErr) return json({ error: 'read_failed', message: rowsErr.message }, 500)
  const knownIds = new Set(((rows ?? []) as Any[]).map((r) => String(r.car_wash_id)))
  const knownSites = new Set(((rows ?? []) as Any[]).map((r) => Number(r.site_number)))

  const end = today()
  const added: { site: number; car_wash_id: string; start_date: string }[] = []
  const waiting: string[] = []
  const needsLook: string[] = []
  const errors: string[] = []

  for (const store of stores.filter((s) => !knownIds.has(s.id))) {
    let live: string | null
    try {
      live = await firstLiveDay(auth, store.id, end)
    } catch (e) {
      errors.push(`${store.name}: ${String((e as Error)?.message ?? e).slice(0, 200)}`)
      continue
    }
    if (!live) { waiting.push(store.name); continue }
    // "MW #5" -> 5. A name that doesn't fit, or a second store for a site already on
    // the list, needs a person to look at it rather than a guess.
    const m = store.name.match(/^MW\s*#\s*(\d+)$/i)
    const site = m ? Number(m[1]) : null
    if (site === null || knownSites.has(site)) { needsLook.push(`${store.name} (${store.id}), live since ${live}`); continue }
    if (!body.dryRun) {
      const { error } = await svc.from('flexwash_sites').insert({
        account_id: MW_ACCOUNT, site_number: site, car_wash_id: store.id, name: `Mighty Wash #${site}`, start_date: live, dashboard_source: false,
      })
      if (error) { errors.push(`${store.name}: ${error.message}`); continue }
    }
    knownSites.add(site)
    added.push({ site, car_wash_id: store.id, start_date: live })
  }

  // Load the new sites' days now. If this fails, sync-site-daily-week picks up the
  // last 8 days at 09:40 UTC anyway.
  let synced: unknown = null
  if (added.length && !body.dryRun) {
    const start = added.map((a) => a.start_date).sort()[0]
    try {
      synced = await callFn(auth, 'sync-site-daily', { start, end, maxDays: LOOKBACK_DAYS + 1 })
    } catch (e) {
      errors.push(`sync-site-daily: ${String((e as Error)?.message ?? e).slice(0, 200)}`)
    }
  }

  const result = { ok: errors.length === 0, dryRun: !!body.dryRun, stores: stores.length, added, waiting, needsLook, errors, synced }
  console.log('[flexwash-site-watch]', JSON.stringify(result))
  return json(result)
})
