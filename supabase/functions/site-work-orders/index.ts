// site-work-orders — Supabase Edge Function (Deno).
// The work orders still open in MaintainX (Open, In Progress, On Hold) for one
// Operator site, read live from the MaintainX API, so an auditor can see what's
// already reported while auditing (Site Audit NEW). Read-only.
//
// Body: { location_id: string }
// Auth: a signed-in Mighty Wash user who can see that site (RLS on locations
// decides), or the service role.
// Secret: MAINTAINX_API_TOKEN (503 no_key otherwise); MAINTAINX_BASE_URL optional.
//
// Site matching: the site's locations.maintainx_id (backfilled by the 2026-07
// import), else the MaintainX location named "#NN - City" for MWNN (Spotless by
// name), plus every location under it. Work orders, locations, users and teams
// come from the API; locations/users/teams are cached for 10 minutes per worker.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

const MIGHTY_WASH = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const DEFAULT_BASE = 'https://api.getmaintainx.com/v1'
const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD']
const PRIORITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 }
const CACHE_MS = 10 * 60 * 1000

const ALLOWED_ORIGINS = new Set<string>(['https://operator.washlyfe.com', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return { 'Access-Control-Allow-Origin': allow, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

async function mxGetAll(base: string, token: string, path: string, key: string, maxPages = 20): Promise<Any[]> {
  const out: Any[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const url: string = `${base}${path}${path.includes('?') ? '&' : '?'}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`MaintainX ${path.split('?')[0]} ${res.status}`)
    const d: Any = await res.json()
    out.push(...((d?.[key] ?? []) as Any[]))
    cursor = d?.nextCursor ?? null
    pages++
  } while (cursor && pages < maxPages)
  return out
}

type Lookups = { at: number; locations: Map<number, { id: number; name: string; parentId: number | null }>; users: Map<number, string>; teams: Map<number, string> }
let cache: Lookups | null = null

async function lookups(base: string, token: string): Promise<Lookups> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache
  const [locs, users, teams] = await Promise.all([
    mxGetAll(base, token, '/locations', 'locations'),
    mxGetAll(base, token, '/users', 'users').catch(() => []),
    mxGetAll(base, token, '/teams', 'teams').catch(() => []),
  ])
  cache = {
    at: Date.now(),
    locations: new Map(locs.map((l) => [Number(l.id), { id: Number(l.id), name: String(l.name ?? ''), parentId: l.parentId != null ? Number(l.parentId) : null }])),
    users: new Map(users.map((u) => [Number(u.id), [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || 'Someone'])),
    teams: new Map(teams.map((t) => [Number(t.id), String(t.name ?? 'A team')])),
  }
  return cache
}

// The MaintainX locations for an Operator site: its stored id, else "#NN ..." by
// the site's number (Spotless by name), then everything under those.
function siteLocations(site: { name: string; maintainx_id: number | null }, locs: Lookups['locations']): number[] {
  const roots = new Set<number>()
  if (site.maintainx_id && locs.has(Number(site.maintainx_id))) roots.add(Number(site.maintainx_id))
  if (!roots.size) {
    const num = site.name.match(/^MW\s*0*(\d+)$/i)?.[1]
    for (const l of locs.values()) {
      if (num && new RegExp(`^#\\s*0*${num}(?!\\d)`).test(l.name.trim())) roots.add(l.id)
      if (!num && site.name.trim() && l.name.toLowerCase().includes(site.name.trim().toLowerCase())) roots.add(l.id)
    }
  }
  const all = new Set(roots)
  // Children, however deep (bounded so a bad parent loop can't spin).
  for (let pass = 0; pass < 6; pass++) {
    let added = false
    for (const l of locs.values()) if (l.parentId != null && all.has(l.parentId) && !all.has(l.id)) { all.add(l.id); added = true }
    if (!added) break
  }
  return [...all]
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const token = Deno.env.get('MAINTAINX_API_TOKEN') ?? Deno.env.get('MAINTAINX_API_KEY')
  if (!token) return json({ error: 'no_key', message: 'MaintainX is not connected.' }, 503, origin)
  const base = (Deno.env.get('MAINTAINX_BASE_URL') ?? DEFAULT_BASE).replace(/\/$/, '')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: { location_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const locationId = body.location_id
  if (!locationId || !/^[0-9a-f-]{36}$/i.test(locationId)) return json({ error: 'bad_request' }, 400, origin)

  // Read the site as the caller, so RLS decides whether they may see it.
  const auth = req.headers.get('Authorization') ?? ''
  const isService = jwtRole(auth) === 'service_role' || auth === `Bearer ${serviceKey}`
  if (!isService && !auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const db = isService
    ? createClient(url, serviceKey, { auth: { persistSession: false } })
    : createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: site } = await db.from('locations').select('id, name, account_id, maintainx_id').eq('id', locationId).maybeSingle()
  const s = site as Any
  if (!s) return json({ error: 'not_found' }, 404, origin)
  if (s.account_id !== MIGHTY_WASH) return json({ error: 'not_connected', message: 'MaintainX is connected for Mighty Wash only.' }, 404, origin)

  try {
    const lk = await lookups(base, token)
    const mxIds = siteLocations({ name: String(s.name ?? ''), maintainx_id: s.maintainx_id }, lk.locations)
    if (!mxIds.length) {
      return json({ site: s.name, matched: false, locations: [], workOrders: [], fetchedAt: new Date().toISOString() }, 200, origin)
    }
    const q = [
      ...mxIds.map((id) => `locations=${id}`),
      ...OPEN_STATUSES.map((st) => `statuses=${st}`),
      'expand=asset', 'expand=assignees', 'expand=categories',
    ].join('&')
    const wos = await mxGetAll(base, token, `/workorders?${q}`, 'workOrders', 5)
    const rows = wos
      .filter((w) => OPEN_STATUSES.includes(w.status) && !w.deletedAt)
      .map((w) => ({
        id: w.id,
        number: w.sequentialId ?? null,
        title: String(w.title ?? 'Untitled'),
        status: w.status,
        priority: w.priority ?? 'NONE',
        type: w.type ?? null,
        createdAt: w.createdAt ?? null,
        dueDate: w.dueDate ?? null,
        asset: w.asset?.name ?? null,
        location: lk.locations.get(Number(w.locationId))?.name ?? null,
        assignees: ((w.assignees ?? []) as Any[])
          .map((a) => (a.type === 'TEAM' ? lk.teams.get(Number(a.id)) : lk.users.get(Number(a.id))) ?? null)
          .filter(Boolean),
        categories: ((w.categories ?? []) as Any[]).map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean),
      }))
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || String(a.createdAt).localeCompare(String(b.createdAt)))
    return json({
      site: s.name,
      matched: true,
      locations: mxIds.map((id) => lk.locations.get(id)?.name).filter(Boolean),
      workOrders: rows,
      fetchedAt: new Date().toISOString(),
    }, 200, origin)
  } catch (e) {
    return json({ error: 'maintainx_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
