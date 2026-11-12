// flexwash-labor — Supabase Edge Function (Deno).
// Labor from FlexWash's own time clock, by site, for the FlexWash tab on
// Human Resources > On the Clock: hours and cost for today, this pay week
// (Monday -> Sunday) and the current pay period (two weeks from Mon 2026-10-19).
//
// Source: FlexWash partner API /external/labor-costs/get-labor-stats, one call per
// car wash (it sums whatever car washes it is given). FlexWash fills it from its
// time cards every ~10 minutes, shifts in progress included. The API has no
// per-employee time cards (names, clock-in/out times), so this is totals only.
// Cost includes any daily salary cost set up in FlexWash (cost with no hours).
//
// Car washes come from FlexWash's own list (not flexwash_sites), so a site that
// starts on the FlexWash time clock before it goes live on FlexWash sales still
// shows up. Names "MW #NN" / "MightyWash 0NN" -> MWNN; anything else is skipped.
//
// Auth: the On the Clock allowlist (same as isolved-live), or the service role.
// Secrets: FLEXWASH_CLIENT_ID, FLEXWASH_CLIENT_SECRET (503 no_key otherwise).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { centralToday, ranges, siteOf } from './util.ts'

// deno-lint-ignore no-explicit-any
type Json = any

// Same people as isolved-live's LABOR_DATA_EMAILS (the On the Clock page).
const ON_THE_CLOCK_EMAILS = new Set([
  'kevan@washlyfe.com',
  'lkeith@mighty-wash.com',
  'kellyspiller@mighty-wash.com',
  'kspiller@mighty-wash.com',
  'zachary@mighty-wash.com',
  'mcanales@mighty-wash.com',
  'isabel@mighty-wash.com',
  'rbreed@mighty-wash.com',
  'lester@mighty-wash.com',
  'djones@mighty-wash.com',
])

const FLEX_BASE = 'https://api.flexwash.com'
const PROVIDER = 'flexwash'
// FlexWash refreshes every ~10 minutes; a warm instance answers repeat loads from here.
const CACHE_MS = 4 * 60_000

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
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

// ---- FlexWash (company key; token cached in service_tokens, shared with the other FlexWash functions) ----
async function getToken(svc: SupabaseClient, force = false): Promise<string> {
  if (!force) {
    const { data: cached } = await svc.from('service_tokens').select('token, expires_at').eq('provider', PROVIDER).maybeSingle()
    if (cached && new Date(cached.expires_at as string).getTime() > Date.now() + 60_000) return cached.token as string
  }
  const res = await fetch(`${FLEX_BASE}/external/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: Deno.env.get('FLEXWASH_CLIENT_ID'), clientSecret: Deno.env.get('FLEXWASH_CLIENT_SECRET') }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.accessToken) throw new Error(`FlexWash sign-in failed (${res.status}).`)
  await svc.from('service_tokens').upsert(
    { provider: PROVIDER, token: j.accessToken, expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'provider' },
  )
  return j.accessToken as string
}

// Mighty Wash's FlexWash organization (see ask-operator/flexwash.ts).
async function getOrgId(svc: SupabaseClient): Promise<string> {
  const env = Deno.env.get('FLEXWASH_ORG_ID')
  if (env) return env
  const { data } = await svc.from('service_tokens').select('token').eq('provider', 'flexwash_org').maybeSingle()
  return (data?.token as string | undefined) || '275'
}

function flexClient(svc: SupabaseClient) {
  let token: Promise<string> | null = null
  let org: Promise<string> | null = null
  return async (path: string, body: unknown): Promise<Json> => {
    token ??= getToken(svc)
    org ??= getOrgId(svc)
    const url = `${FLEX_BASE}${path}?organizationId=${encodeURIComponent(await org)}`
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let data: Json = null
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      // A rejected cached token: mint one fresh token (once per run) and retry.
      if (res.status === 401 && attempt === 0) { token = getToken(svc, true); continue }
      if (!res.ok) {
        const msg = typeof data === 'object' && data ? (data.message ?? data.error ?? '') : ''
        throw new Error(`FlexWash answered ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}.`)
      }
      return data
    }
    throw new Error('FlexWash rejected the sign-in.')
  }
}

// A few at a time: be kind to FlexWash.
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

type Stat = { hours: number; cost: number }
const ZERO: Stat = { hours: 0, cost: 0 }
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

let cache: { at: number; today: string; body: Json } | null = null

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const auth = req.headers.get('Authorization') ?? ''
  if (jwtRole(auth) !== 'service_role') {
    if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    if (!ON_THE_CLOCK_EMAILS.has((u.user.email ?? '').toLowerCase())) {
      return json({ error: 'forbidden', message: 'Labor data is restricted to approved users.' }, 403, origin)
    }
  }
  if (!Deno.env.get('FLEXWASH_CLIENT_ID') || !Deno.env.get('FLEXWASH_CLIENT_SECRET')) {
    return json({ error: 'no_key', message: 'FlexWash credentials are not configured.' }, 503, origin)
  }

  let body: { fresh?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }
  const r = ranges(centralToday())
  if (!body.fresh && cache && cache.today === r.today && Date.now() - cache.at < CACHE_MS) return json(cache.body, 200, origin)

  try {
    const flex = flexClient(svc)
    const list = await flex('/external/car-wash/get-car-washes', {})
    const washes = ((list?.carWashes ?? []) as Json[])
      .map((w) => ({ carWashId: String(w.id), name: String(w.name ?? ''), site: siteOf(w.name) }))
      .filter((w): w is { carWashId: string; name: string; site: string } => !!w.site)

    const stat = async (carWashId: string, start: string, end: string): Promise<Stat> => {
      const d = await flex('/external/labor-costs/get-labor-stats', { carWashIds: [carWashId], dateRange: { start, end } })
      return { hours: round(Number(d?.laborHours) || 0), cost: round((Number(d?.costInCents) || 0) / 100) }
    }
    // The pay period holds this week and today, so a site with nothing in the
    // period needs no more calls (keeps a load to ~one call per car wash).
    const rows = await pool(washes, 6, async (w) => {
      try {
        const period = await stat(w.carWashId, r.periodStart, r.today)
        if (!period.hours && !period.cost) return { ...w, today: ZERO, week: ZERO, period, error: null }
        const [week, today] = await Promise.all([
          r.weekStart === r.periodStart ? Promise.resolve(period) : stat(w.carWashId, r.weekStart, r.today),
          stat(w.carWashId, r.today, r.today),
        ])
        return { ...w, today, week, period, error: null }
      } catch (e) {
        return { ...w, today: ZERO, week: ZERO, period: ZERO, error: e instanceof Error ? e.message : String(e) }
      }
    })

    const num = (s: string) => Number(s.slice(2))
    const sites = rows.filter((x) => x.period.hours || x.period.cost || x.error).sort((a, b) => num(a.site) - num(b.site))
    const idle = rows.filter((x) => !x.period.hours && !x.period.cost && !x.error).map((x) => x.site).sort((a, b) => num(a) - num(b))
    const sum = (k: 'today' | 'week' | 'period'): Stat => ({
      hours: round(sites.reduce((a, s) => a + s[k].hours, 0)),
      cost: round(sites.reduce((a, s) => a + s[k].cost, 0)),
    })
    const out = {
      ok: true,
      generatedAt: new Date().toISOString(),
      central: { ...r },
      sites,
      idle,
      totals: { today: sum('today'), week: sum('week'), period: sum('period'), sites: sites.length, carWashes: rows.length },
    }
    if (!sites.some((s) => s.error)) cache = { at: Date.now(), today: r.today, body: out }
    return json(out, 200, origin)
  } catch (e) {
    return json({ error: 'failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
