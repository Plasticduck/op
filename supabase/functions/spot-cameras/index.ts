// spot-cameras — Supabase Edge Function (Deno).
// Bridges Operator to the Spot AI camera system. Holds the Spot AI API key
// server-side and never exposes it to the browser. Two actions:
//   { action: 'list' }               -> cameras grouped by site, scoped to the
//                                       caller (owners: all sites; managers:
//                                       only their assigned locations)
//   { action: 'embed', camera_id }   -> a short-lived iframe-embeddable live URL
//
// Site scoping matches auth_has_location: owners see every account location,
// managers see only rows whose store number is in their users.location_ids.
// Spot AI cameras carry location_name "Mighty Wash #NN"; Operator locations are
// "MWNN" — matched by the store number parsed from each.
//
// Secrets: SPOT_AI_API_KEY (required), SPOT_AI_API_BASE (default dev-api host).

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

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

// First run of digits in a site name: "Mighty Wash #20" -> 20, "MW07" -> 7.
function storeNum(name: string | null | undefined): number | null {
  const m = String(name ?? '').match(/(\d+)/)
  return m ? Number(m[1]) : null
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const apiKey = Deno.env.get('SPOT_AI_API_KEY')
  const apiBase = (Deno.env.get('SPOT_AI_API_BASE') ?? 'https://dev-api.spot.ai/v1').replace(/\/$/, '')
  if (!apiKey) return json({ error: 'no_key', message: 'Spot AI is not configured.' }, 503, origin)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const uid = u.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: prof } = await svc.from('users').select('account_id, role, location_ids').eq('id', uid).maybeSingle()
  if (!prof || (prof.role !== 'owner' && prof.role !== 'manager')) return json({ error: 'forbidden' }, 403, origin)

  // Store numbers this caller may see. null = all (owner); a Set = managers.
  let allowed: Set<number> | null = null
  if (prof.role === 'manager') {
    allowed = new Set<number>()
    const locIds = (prof.location_ids ?? []) as string[]
    if (locIds.length) {
      const { data: locs } = await svc.from('locations').select('name').in('id', locIds)
      for (const l of (locs ?? []) as Any[]) {
        const n = storeNum(l.name)
        if (n != null) allowed.add(n)
      }
    }
  }

  const spot = (path: string, init?: RequestInit) =>
    fetch(`${apiBase}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })

  let body: Any = {}
  try { body = await req.json() } catch { /* default */ }
  const action = String(body.action ?? 'list')

  if (action === 'list') {
    // Paginate every camera (cursor-based, 100/page).
    const cams: Any[] = []
    let cursor = ''
    for (let i = 0; i < 20; i++) {
      const q = new URLSearchParams({ limit: '100' })
      if (cursor) q.set('cursor', cursor)
      const r = await spot(`/cameras?${q.toString()}`)
      if (!r.ok) return json({ error: 'spot_failed', status: r.status }, 502, origin)
      const j = await r.json()
      for (const c of (j.cameras ?? [])) cams.push(c)
      cursor = j.next ?? ''
      if (!cursor) break
    }

    const bySite = new Map<string, { site: string; store: number | null; cameras: Any[] }>()
    for (const c of cams) {
      const store = storeNum(c.location_name)
      if (allowed && (store == null || !allowed.has(store))) continue
      const key = (c.location_name as string) ?? '(unknown site)'
      if (!bySite.has(key)) bySite.set(key, { site: key, store, cameras: [] })
      bySite.get(key)!.cameras.push({
        id: c.id, name: c.name, status: c.status, has_speakers: !!c.has_speakers,
      })
    }
    const sites = [...bySite.values()].sort((a, b) => (a.store ?? 999) - (b.store ?? 999))
    for (const s of sites) s.cameras.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return json({ sites }, 200, origin)
  }

  if (action === 'embed_many') {
    // Batch embed for the wall view. Longer-lived tokens so a wall left open
    // through a shift keeps playing.
    let ids: number[] = Array.isArray(body.camera_ids)
      ? (body.camera_ids as Any[]).map(Number).filter((n) => Number.isFinite(n))
      : []
    ids = ids.slice(0, 64)
    if (!ids.length) return json({ urls: [] }, 200, origin)
    // Managers: keep only cameras at their allowed sites.
    if (allowed) {
      const allowedIds = new Set<number>()
      let cursor = ''
      for (let i = 0; i < 20; i++) {
        const q = new URLSearchParams({ limit: '100' })
        if (cursor) q.set('cursor', cursor)
        const r = await spot(`/cameras?${q.toString()}`)
        if (!r.ok) break
        const j = await r.json()
        for (const c of (j.cameras ?? [])) {
          const s = storeNum(c.location_name)
          if (s != null && allowed.has(s)) allowedIds.add(Number(c.id))
        }
        cursor = j.next ?? ''
        if (!cursor) break
      }
      ids = ids.filter((id) => allowedIds.has(id))
    }
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const er = await spot(`/embeds/live`, { method: 'POST', body: JSON.stringify({ camera_id: id, expires_in: 21600 }) })
        const ej = await er.json().catch(() => ({}))
        return er.ok && ej.url ? { id, url: ej.url as string } : null
      } catch { return null }
    }))
    return json({ urls: results.filter(Boolean) }, 200, origin)
  }

  if (action === 'embed') {
    const cameraId = Number(body.camera_id)
    if (!Number.isFinite(cameraId)) return json({ error: 'bad_request' }, 400, origin)
    // Managers: confirm the camera's site is one they're allowed to see.
    if (allowed) {
      const cr = await spot(`/cameras/${cameraId}`)
      if (!cr.ok) return json({ error: 'not_found' }, 404, origin)
      const cj = await cr.json()
      const store = storeNum(cj.location_name)
      if (store == null || !allowed.has(store)) return json({ error: 'forbidden' }, 403, origin)
    }
    const er = await spot(`/embeds/live`, { method: 'POST', body: JSON.stringify({ camera_id: cameraId, expires_in: 3600 }) })
    const ej = await er.json().catch(() => ({}))
    if (!er.ok || !ej.url) return json({ error: 'embed_failed', status: er.status }, 502, origin)
    return json({ url: ej.url }, 200, origin)
  }

  return json({ error: 'unknown_action' }, 400, origin)
})
