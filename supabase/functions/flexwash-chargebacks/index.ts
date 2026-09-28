// flexwash-chargebacks — Supabase Edge Function (Deno).
// Chargebacks = failed/declined card charges (mostly membership rebills) for a
// FlexWash site. FlexWash has no card-network dispute feed; the closest is a card
// payment that failed (ccFailureReason), which is what car-wash operators track as
// a chargeback/failed recharge. This function lists them for a site + date range,
// enriched with the customer, package, amount, reason, processor, and card last
// four, and can return a single customer's activity timeline.
//
// Body:
//   { mode?: 'list', car_wash_id: string, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
//   { mode: 'customer', customer_id: string }
//   { mode: 'sites' }  -> selectable FlexWash sites for this account
//
// Auth: account OWNER (the page is owner-only), or the service role.
// Secrets: FLEXWASH_CLIENT_ID, FLEXWASH_CLIENT_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2'

const FLEX_BASE = 'https://api.flexwash.com'
const PROVIDER = 'flexwash'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

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

async function getFlexToken(svc: Any, clientId: string, clientSecret: string): Promise<string> {
  const { data: cached } = await svc.from('service_tokens').select('token, expires_at').eq('provider', PROVIDER).maybeSingle()
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) return cached.token as string
  const res = await fetch(`${FLEX_BASE}/external/access-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.accessToken) throw new Error(`token request failed (${res.status})`)
  await svc.from('service_tokens').upsert(
    { provider: PROVIDER, token: j.accessToken, expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'provider' },
  )
  return j.accessToken as string
}

async function flex(token: string, path: string, body: unknown): Promise<Any> {
  const res = await fetch(`${FLEX_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  })
  return await res.json().catch(() => null)
}

// Run tasks with limited concurrency (FlexWash order lookups).
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const clientId = Deno.env.get('FLEXWASH_CLIENT_ID')
  const clientSecret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  if (!clientId || !clientSecret) return json({ error: 'no_key', message: 'FlexWash is not configured.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: OWNER of the Mighty Wash account, or the service role.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden' }, 403, origin)
    if (p.account_id !== MW_ACCOUNT) return json({ error: 'unsupported_account' }, 400, origin)
  }

  let body: { mode?: string; car_wash_id?: string; customer_id?: string; start?: string; end?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const mode = body.mode ?? 'list'

  // Selectable FlexWash sites for the picker.
  if (mode === 'sites') {
    const { data } = await svc.from('flexwash_sites').select('site_number, car_wash_id').eq('active', true).order('site_number')
    const sites = ((data as { site_number: number; car_wash_id: string }[] | null) ?? [])
      .map((s) => ({ car_wash_id: String(s.car_wash_id), site_number: s.site_number, name: `MW${String(s.site_number).padStart(2, '0')}` }))
    return json({ ok: true, sites }, 200, origin)
  }

  let token: string
  try { token = await getFlexToken(svc, clientId, clientSecret) } catch (e) { return json({ error: 'auth_failed', message: String(e) }, 502, origin) }

  // A single customer's activity timeline.
  if (mode === 'customer') {
    const customerId = String(body.customer_id ?? '')
    if (!customerId) return json({ error: 'bad_request', message: 'customer_id required' }, 400, origin)
    const tl = await flex(token, '/external/customers/load-timeline', { customerId })
    const events = (tl?.events ?? []).map((e: Any) => ({
      type: e.type ?? null,
      name: e.name ?? null,
      at: e.eventTime?.value ?? null,
      orderId: e.orderId ?? null,
      totalCents: e.totalInCents ?? null,
      text: e.text ?? null,
      user: e.userName ?? e.employee?.name ?? null,
      items: (e.vehicleSubscriptionLineItems ?? []).map((li: Any) => li.name).filter(Boolean),
    }))
    return json({ ok: true, timezone: tl?.timezone ?? null, events }, 200, origin)
  }

  // Chargebacks list for a site + range.
  const carWashId = String(body.car_wash_id ?? '')
  if (!carWashId) return json({ error: 'bad_request', message: 'car_wash_id required' }, 400, origin)
  if (!isDate(body.start) || !isDate(body.end) || body.start > body.end) {
    return json({ error: 'bad_request', message: 'start and end must be YYYY-MM-DD with start <= end.' }, 400, origin)
  }

  const pay = await flex(token, '/external/accounting/get-payments-detail', {
    carWashIds: [carWashId], dateRange: { start: body.start, end: body.end },
  })
  if (!pay || pay.error) return json({ error: 'flex_error', message: pay?.error ?? 'payments-detail failed' }, 502, origin)
  const failures = (pay.paymentsDetail ?? []).filter((p: Any) => p.ccFailureReason)
  // Distinct failed order ids (a retried order can have several failed attempts).
  const orderIds = [...new Set(failures.map((f: Any) => String(f.order?.id ?? '')).filter(Boolean))] as string[]

  const orders = await pool(orderIds, 8, (id) => flex(token, '/external/orders/get-order', { orderId: id }))

  const chargebacks = orders.filter(Boolean).map((o: Any) => {
    const pmt = (o.payments ?? []).find((p: Any) => p.cardLastFour) ?? (o.payments ?? [])[0] ?? {}
    return {
      orderId: String(o.id ?? ''),
      at: o.localizedInsertedAt ?? o.insertedAt?.value ?? null,
      status: o.status ?? null,
      type: o.type ?? null,
      amountCents: Number(o.total) || 0,
      reason: o.ccFailureReason ?? null,
      processor: o.integrationPlatform ?? null,
      cardLastFour: pmt.cardLastFour ?? null,
      package: o.package?.name ?? null,
      customerId: o.customer?.id ? String(o.customer.id) : null,
      customer: o.customer?.name ?? null,
      email: o.customer?.email ?? null,
      site: o.carWash?.name ?? null,
      receipt: o.receiptLink ?? null,
    }
  }).sort((a: Any, b: Any) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  const totalCents = chargebacks.reduce((s: number, c: Any) => s + (c.amountCents || 0), 0)
  const byReason: Record<string, number> = {}
  for (const c of chargebacks) byReason[c.reason ?? 'Unknown'] = (byReason[c.reason ?? 'Unknown'] || 0) + 1

  return json({ ok: true, range: { start: body.start, end: body.end }, count: chargebacks.length, totalCents, byReason, chargebacks }, 200, origin)
})
