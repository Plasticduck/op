// sync-maintainx — Supabase Edge Function (Deno).
// Incrementally refreshes Mighty Wash work orders from MaintainX. Pulls work
// orders changed since the last sync (MAX(maintainx_updated_at) watermark, with
// a 2h overlap) and upserts them via the sync_maintainx_work_orders RPC, which
// resolves site/asset by the backfilled maintainx_id columns and defaults
// unmapped sites to "Mighty Wash (Unassigned)".
//
// Auth: service-role JWT (cron) or an owner/manager (manual "Sync now").
// Secret: MAINTAINX_API_TOKEN (required; 503 no_key otherwise).
//         MAINTAINX_BASE_URL (optional; defaults to api.getmaintainx.com/v1).

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://api.getmaintainx.com/v1'
const MIGHTY_WASH_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const OVERLAP_MS = 2 * 60 * 60 * 1000 // re-pull a 2h window to catch late writes
const FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

const STATUS: Record<string, string> = {
  DONE: 'done', OPEN: 'open', ON_HOLD: 'on_hold', IN_PROGRESS: 'in_progress', CANCELED: 'skipped',
}
const PRIORITY: Record<string, string> = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', NONE: 'none' }
const WTYPE: Record<string, string> = { REACTIVE: 'reactive', PREVENTIVE: 'preventive' }

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
  const token = auth.replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null
  } catch {
    return null
  }
}

// deno-lint-ignore no-explicit-any
async function mxGetAll(base: string, token: string, path: string, key: string): Promise<any[]> {
  const out: any[] = [] // deno-lint-ignore-line no-explicit-any
  let cursor: string | null = null
  let pages = 0
  do {
    const url = `${base}${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`MaintainX ${path} -> ${res.status}`)
    const d = await res.json()
    out.push(...(d[key] ?? []))
    cursor = d.nextCursor ?? null
    pages++
  } while (cursor && pages < 300)
  return out
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const token = Deno.env.get('MAINTAINX_API_TOKEN')
  if (!token) return json({ error: 'no_key', message: 'MaintainX is not connected.' }, 503, origin)
  const base = (Deno.env.get('MAINTAINX_BASE_URL') ?? DEFAULT_BASE).replace(/\/$/, '')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: service-role (cron) or an owner/manager of the Mighty Wash account.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).single()
    if (!p || p.account_id !== MIGHTY_WASH_ACCOUNT || (p.role !== 'owner' && p.role !== 'manager')) {
      return json({ error: 'forbidden' }, 403, origin)
    }
  }

  try {
    // Watermark: newest MaintainX updatedAt we already have, minus overlap.
    const { data: wm } = await svc
      .from('work_orders')
      .select('maintainx_updated_at')
      .eq('account_id', MIGHTY_WASH_ACCOUNT)
      .not('maintainx_id', 'is', null)
      .order('maintainx_updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const watermark = wm?.maintainx_updated_at ? new Date(wm.maintainx_updated_at).getTime() : null
    const sinceMs = watermark ? watermark - OVERLAP_MS : Date.now() - FIRST_RUN_LOOKBACK_MS
    const since = new Date(sinceMs).toISOString()

    const [changed, users] = await Promise.all([
      mxGetAll(base, token, `/workorders?updatedAt[gte]=${encodeURIComponent(since)}`, 'workOrders'),
      mxGetAll(base, token, '/users', 'users'),
    ])
    const nameOf = new Map<number, string>()
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || null
      if (name) nameOf.set(u.id, name)
    }

    const rows = changed.map((w) => {
      const creator = nameOf.get(w.creatorId) ?? null
      return {
        maintainx_id: w.id,
        mx_location_id: w.locationId ?? null,
        mx_asset_id: w.assetId ?? null,
        number: w.sequentialId,
        title: (w.title && String(w.title).trim()) || `Work order ${w.sequentialId}`,
        description: w.description ?? null,
        status: STATUS[w.status] ?? 'open',
        priority: PRIORITY[w.priority] ?? 'none',
        work_type: WTYPE[w.type] ?? 'reactive',
        created_at: w.createdAt ?? null,
        completed_at: w.completedAt ?? null,
        updated_at: w.updatedAt ?? null,
        requested_by_name: creator,
        created_by_name: creator,
        completed_by_name: w.completedAt ? (nameOf.get(w.completerId) ?? null) : null,
      }
    })

    let synced = 0
    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
      const { data, error } = await svc.rpc('sync_maintainx_work_orders', { p_rows: rows.slice(i, i + BATCH) })
      if (error) throw new Error(error.message)
      synced += typeof data === 'number' ? data : 0
    }

    return json({ ok: true, since, changed: rows.length, synced }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
