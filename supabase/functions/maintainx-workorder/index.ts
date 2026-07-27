// maintainx-workorder — Supabase Edge Function (Deno).
// Two-way write path for Mighty Wash work orders. Pushes Operator work-order
// mutations to MaintainX (the system of record) and mirrors the result locally.
// MaintainX is Mighty-Wash-only, so callers must belong to that account.
//
// Actions:
//   create  -> POST /workorders, then insert the Operator row linked by
//              maintainx_id, numbered by MaintainX's sequentialId (which also
//              avoids colliding with the imported 1..4907 numbers).
//   update  -> PATCH /workorders/{id} (title/description/priority/type/asset/site)
//   status  -> PATCH /workorders/{id}/status
//   delete  -> DELETE /workorders/{id}
// (update/status/delete are used by the change-capture push worker; create is
//  called synchronously from the New Work Order form.)
//
// Secret: MAINTAINX_API_TOKEN (503 no_key if missing).

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://api.getmaintainx.com/v1'
const MIGHTY_WASH_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

const PRIORITY: Record<string, string> = { none: 'NONE', low: 'LOW', medium: 'MEDIUM', high: 'HIGH' }
const WTYPE: Record<string, string> = {
  reactive: 'REACTIVE', preventive: 'PREVENTIVE', inspection: 'REACTIVE', project: 'REACTIVE', other: 'REACTIVE',
}

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

async function mx(base: string, token: string, path: string, method: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  const init: RequestInit = { method, headers }
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body) }
  const res = await fetch(`${base}${path}`, init)
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { ok: res.ok, status: res.status, data }
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

  // Auth: service-role (push worker) or an authenticated Mighty Wash member.
  const authHeader = req.headers.get('Authorization') ?? ''
  let caller: { id: string; name: string | null } | null = null
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('account_id, name, role').eq('id', u.user.id).single()
    if (!p || p.account_id !== MIGHTY_WASH_ACCOUNT) return json({ error: 'forbidden' }, 403, origin)
    caller = { id: u.user.id, name: p.name }
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty */ }
  const action = body.action

  try {
    if (action === 'create') {
      const wo = (body.work_order ?? {}) as Record<string, unknown>
      const title = String(wo.title ?? '').trim()
      if (!title) return json({ error: 'bad_request', message: 'title required' }, 400, origin)

      // Resolve Operator site/asset to MaintainX ids via the backfilled columns.
      let mxLocation: number | null = null
      let mxAsset: number | null = null
      if (wo.location_id) {
        const { data } = await svc.from('locations').select('maintainx_id').eq('id', wo.location_id).maybeSingle()
        mxLocation = (data?.maintainx_id as number | null) ?? null
      }
      if (wo.equipment_id) {
        const { data } = await svc.from('equipment').select('maintainx_id').eq('id', wo.equipment_id).maybeSingle()
        mxAsset = (data?.maintainx_id as number | null) ?? null
      }

      // deno-lint-ignore no-explicit-any
      const payload: Record<string, any> = {
        title,
        description: wo.description ? String(wo.description) : undefined,
        priority: PRIORITY[String(wo.priority ?? 'none')] ?? 'NONE',
        type: WTYPE[String(wo.work_type ?? 'reactive')] ?? 'REACTIVE',
      }
      if (mxLocation != null) payload.locationId = mxLocation
      if (mxAsset != null) payload.assetId = mxAsset
      if (wo.due_at) payload.dueDate = wo.due_at
      if (wo.start_at) payload.startDate = wo.start_at

      const created = await mx(base, token, '/workorders', 'POST', payload)
      if (!created.ok) return json({ error: 'maintainx_failed', status: created.status, data: created.data }, 502, origin)
      // deno-lint-ignore no-explicit-any
      const mxId = (created.data as any)?.id
      if (!mxId) return json({ error: 'maintainx_bad_response', data: created.data }, 502, origin)
      // POST returns only { id }; fetch the created WO to get its sequentialId
      // (used as the Operator number) and timestamps. Response wraps in workOrder.
      const fetched = await mx(base, token, `/workorders/${mxId}`, 'GET')
      // deno-lint-ignore no-explicit-any
      const mxwo = (fetched.data as any)?.workOrder ?? {}
      const seq = mxwo?.sequentialId
      if (!seq) return json({ error: 'maintainx_no_number', data: fetched.data }, 502, origin)

      const myName = caller?.name ?? 'Operator'
      const { data: row, error } = await svc
        .from('work_orders')
        .insert({
          account_id: MIGHTY_WASH_ACCOUNT,
          location_id: wo.location_id,
          equipment_id: wo.equipment_id ?? null,
          number: seq,
          title,
          description: wo.description ?? null,
          status: 'open',
          priority: wo.priority ?? 'none',
          work_type: wo.work_type ?? 'reactive',
          recurrence: wo.recurrence ?? 'none',
          estimated_minutes: wo.estimated_minutes ?? null,
          due_at: wo.due_at ?? null,
          start_at: wo.start_at ?? null,
          parent_work_order_id: wo.parent_work_order_id ?? null,
          created_by: caller?.id ?? null,
          created_by_name: myName,
          requested_by: caller?.id ?? null,
          requested_by_name: myName,
          maintainx_id: mxId,
          maintainx_updated_at: mxwo?.updatedAt ?? new Date().toISOString(),
        })
        .select()
        .single()
      if (error) return json({ error: 'db_insert_failed', message: error.message, maintainx_id: mxId }, 500, origin)
      return json({ ok: true, work_order: row }, 200, origin)
    }

    if (action === 'update' || action === 'status' || action === 'delete') {
      const mxId = Number(body.maintainx_id)
      if (!mxId) return json({ error: 'bad_request', message: 'maintainx_id required' }, 400, origin)
      if (action === 'delete') {
        const r = await mx(base, token, `/workorders/${mxId}`, 'DELETE')
        return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502, origin)
      }
      if (action === 'status') {
        const map: Record<string, string> = {
          open: 'OPEN', on_hold: 'ON_HOLD', in_progress: 'IN_PROGRESS', done: 'DONE', skipped: 'CANCELED',
        }
        const s = map[String(body.status)]
        if (!s) return json({ error: 'bad_request', message: 'bad status' }, 400, origin)
        const r = await mx(base, token, `/workorders/${mxId}/status`, 'PATCH', { status: s })
        return json({ ok: r.ok, status: r.status, data: r.data }, r.ok ? 200 : 502, origin)
      }
      // update fields
      const p = (body.patch ?? {}) as Record<string, unknown>
      // deno-lint-ignore no-explicit-any
      const payload: Record<string, any> = {}
      if (p.title != null) payload.title = p.title
      if ('description' in p) payload.description = p.description
      if (p.priority != null) payload.priority = PRIORITY[String(p.priority)] ?? 'NONE'
      if (p.work_type != null) payload.type = WTYPE[String(p.work_type)] ?? 'REACTIVE'
      if ('due_at' in p) payload.dueDate = p.due_at
      if ('start_at' in p) payload.startDate = p.start_at
      if (Object.keys(payload).length === 0) return json({ ok: true, noop: true }, 200, origin)
      const r = await mx(base, token, `/workorders/${mxId}`, 'PATCH', payload)
      return json({ ok: r.ok, status: r.status, data: r.data }, r.ok ? 200 : 502, origin)
    }

    // Drain the change-capture outbox (status/edit/delete). Cron only.
    if (action === 'process_outbox') {
      if (caller) return json({ error: 'forbidden' }, 403, origin)
      const STATUS_MAP: Record<string, string> = {
        open: 'OPEN', on_hold: 'ON_HOLD', in_progress: 'IN_PROGRESS', done: 'DONE', skipped: 'CANCELED',
      }
      const { data: pending } = await svc
        .from('maintainx_wo_outbox')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50)
      let done = 0
      let failed = 0
      for (const row of pending ?? []) {
        // deno-lint-ignore no-explicit-any
        const r = row as any
        let res: { ok: boolean; status: number; data: unknown }
        try {
          if (r.op === 'delete') {
            res = await mx(base, token, `/workorders/${r.maintainx_id}`, 'DELETE')
          } else if (r.op === 'status') {
            const s = STATUS_MAP[r.payload?.status]
            res = s
              ? await mx(base, token, `/workorders/${r.maintainx_id}/status`, 'PATCH', { status: s })
              : { ok: false, status: 400, data: 'bad status' }
          } else {
            const p = r.payload ?? {}
            // deno-lint-ignore no-explicit-any
            const body2: Record<string, any> = {}
            if (p.title != null) body2.title = p.title
            body2.description = p.description ?? null
            if (p.priority != null) body2.priority = PRIORITY[p.priority] ?? 'NONE'
            if (p.work_type != null) body2.type = WTYPE[p.work_type] ?? 'REACTIVE'
            if ('due_at' in p) body2.dueDate = p.due_at
            if ('start_at' in p) body2.startDate = p.start_at
            res = await mx(base, token, `/workorders/${r.maintainx_id}`, 'PATCH', body2)
          }
        } catch (e) {
          res = { ok: false, status: 0, data: e instanceof Error ? e.message : String(e) }
        }
        if (res.ok) {
          await svc.from('maintainx_wo_outbox').update({ status: 'done', processed_at: new Date().toISOString() }).eq('id', r.id)
          done++
        } else {
          const attempts = (r.attempts ?? 0) + 1
          await svc.from('maintainx_wo_outbox').update({
            attempts,
            last_error: `${res.status}: ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`.slice(0, 500),
            status: attempts >= 5 ? 'error' : 'pending',
          }).eq('id', r.id)
          failed++
        }
      }
      return json({ ok: true, processed: (pending ?? []).length, done, failed }, 200, origin)
    }

    return json({ error: 'bad_request', message: `unknown action ${action}` }, 400, origin)
  } catch (e) {
    return json({ error: 'error', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
