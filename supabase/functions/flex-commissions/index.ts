// flex-commissions — Supabase Edge Function (Deno).
// PROTOTYPE. Membership-sale commissions from FlexWash. Each new membership sale
// (classification membershipsSoldNew) carries the salesperson (employeeName), a
// per-member code (the prefix of the line-item name, e.g. "AWPK66 - ..."), and a
// plan tier (Mighty / Super Shine / Wonder). A commission is EARNED at the sale
// but becomes PAYABLE once that membership makes its FIRST RECHARGE
// (membershipsRebilled for the same code, on a later day). Rates:
//   Mighty $12, Super Shine $10, Wonder $3.
//
// Aggregates server-side (FlexWash returns every line item) and returns only a
// per-salesperson summary + capped detail. Restricted to kevan@washlyfe.com.
//
// Body: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', carWashIds?: string[] }

import { createClient } from 'npm:@supabase/supabase-js@2'
// deno-lint-ignore no-explicit-any
type Any = any

const KEVAN = 'kevan@washlyfe.com'
const RATES: Record<string, number> = { Mighty: 12, 'Super Shine': 10, Wonder: 3 }

const tierOf = (name: string): string => {
  const n = String(name || '').toLowerCase()
  if (n.includes('mighty')) return 'Mighty'
  if (n.includes('super')) return 'Super Shine'
  if (n.includes('wonder')) return 'Wonder'
  return 'Other'
}
const codeOf = (name: string): string | null => {
  const m = String(name || '').match(/^([A-Za-z0-9]+) - /)
  return m ? m[1] : null
}
// FlexWash localizedInsertedAt is "M/D/YYYY h:mm AM" → YYYY-MM-DD.
const dayOf = (s: string): string | null => {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}
function centralToday(): string {
  const p: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day}`
}

const ALLOWED_ORIGINS = new Set<string>(['https://operator.washlyfe.com', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return { 'Access-Control-Allow-Origin': allow, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''

  if (jwtRole(auth) !== 'service_role') {
    if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    if ((u.user.email ?? '').toLowerCase() !== KEVAN) return json({ error: 'forbidden', message: 'Commissions is restricted.' }, 403, origin)
  }

  let body: { start?: string; end?: string; carWashIds?: string[] } = {}
  try { body = await req.json() } catch { /* */ }
  const re = /^\d{4}-\d{2}-\d{2}$/
  const today = centralToday()
  const start = body.start && re.test(body.start) ? body.start : null
  const end = body.end && re.test(body.end) ? body.end : today
  if (!start) return json({ error: 'bad_request', message: 'start (YYYY-MM-DD) is required.' }, 400, origin)

  const svc = createClient(url, svcKey, { auth: { persistSession: false } })

  // Resolve sites.
  let carWashIds = (body.carWashIds ?? []).map(String).filter(Boolean)
  const nameById = new Map<string, string>()
  {
    const { data } = await svc.from('flexwash_sites').select('car_wash_id, name, active, site_number').eq('active', true).order('site_number')
    const rows = (data as Any[] | null) ?? []
    for (const r of rows) nameById.set(String(r.car_wash_id), r.name ?? `Site ${r.site_number}`)
    if (!carWashIds.length) carWashIds = rows.map((r) => String(r.car_wash_id))
  }

  // Call the flexwash proxy (service-role) per site. Window is [start, today] so a
  // sale's first recharge (≈1 month later) is captured for any sale in [start,end].
  // Call FlexWash directly (reusing the shared cached token the flexwash proxy
  // stores in service_tokens), rather than proxying through the flexwash function.
  const FLEX_BASE = 'https://api.flexwash.com'
  const clientId = Deno.env.get('FLEXWASH_CLIENT_ID')
  const clientSecret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  if (!clientId || !clientSecret) return json({ error: 'no_key', message: 'FlexWash is not configured.' }, 503, origin)
  let flexToken = ''
  const getFlexToken = async (): Promise<string> => {
    const { data: cached } = await svc.from('service_tokens').select('token, expires_at').eq('provider', 'flexwash').maybeSingle()
    if (cached && new Date((cached as Any).expires_at).getTime() > Date.now() + 60_000) return (cached as Any).token as string
    const res = await fetch(`${FLEX_BASE}/external/access-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) })
    const j = await res.json().catch(() => ({})) as Any
    if (!res.ok || !j.accessToken) throw new Error(`flex token failed (${res.status})`)
    await svc.from('service_tokens').upsert({ provider: 'flexwash', token: j.accessToken, expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'provider' })
    return j.accessToken as string
  }
  const flex = async (path: string, b: unknown): Promise<Any> => {
    if (!flexToken) flexToken = await getFlexToken()
    const r = await fetch(`${FLEX_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${flexToken}` }, body: JSON.stringify(b) })
    return await r.json().catch(() => null)
  }

  type Sale = { code: string; tier: string; emp: string; day: string; site: string }
  const sales: Sale[] = []
  const firstRebillDay = new Map<string, string>() // code -> earliest rebill day

  for (const id of carWashIds) {
    let data: Any = null
    try {
      data = await flex('/external/accounting/get-line-items-detail', { carWashIds: [id], dateRange: { start, end: today } })
    } catch { continue }
    const items = (data?.lineItemsDetail ?? []) as Any[]
    const siteName = nameById.get(id) ?? id
    for (const it of items) {
      const cls = String(it.orderClassification ?? '')
      const code = codeOf(it.name)
      const day = dayOf(it.localizedInsertedAt)
      if (!code || !day) continue
      if (cls === 'membershipsRebilled') {
        const p = firstRebillDay.get(code)
        if (!p || day < p) firstRebillDay.set(code, day)
      } else if (cls === 'membershipsSoldNew' && day >= start && day <= end) {
        sales.push({ code, tier: tierOf(it.name), emp: String(it.employeeName ?? '').trim() || '(Unattributed)', day, site: siteName })
      }
    }
  }

  // Aggregate per salesperson. A sale is payable once its code has a rebill on a
  // LATER day than the sale (= the membership's first recharge has posted).
  type Agg = {
    name: string
    sales: number; payableCount: number; pendingCount: number
    payableAmount: number; pendingAmount: number
    byTier: Record<string, { sold: number; payable: number; pending: number }>
  }
  const byEmp = new Map<string, Agg>()
  const tot = { sales: 0, payableCount: 0, pendingCount: 0, payableAmount: 0, pendingAmount: 0, byTier: {} as Record<string, { sold: number; payable: number }> }
  const detail: Any[] = []
  for (const s of sales) {
    const rate = RATES[s.tier] ?? 0
    const fr = firstRebillDay.get(s.code)
    const payable = !!fr && fr > s.day
    let a = byEmp.get(s.emp)
    if (!a) { a = { name: s.emp, sales: 0, payableCount: 0, pendingCount: 0, payableAmount: 0, pendingAmount: 0, byTier: {} }; byEmp.set(s.emp, a) }
    a.sales += 1
    a.byTier[s.tier] ??= { sold: 0, payable: 0, pending: 0 }
    a.byTier[s.tier].sold += 1
    tot.sales += 1
    tot.byTier[s.tier] ??= { sold: 0, payable: 0 }
    tot.byTier[s.tier].sold += 1
    if (payable) { a.payableCount += 1; a.payableAmount += rate; a.byTier[s.tier].payable += 1; tot.payableCount += 1; tot.payableAmount += rate; tot.byTier[s.tier].payable += 1 }
    else { a.pendingCount += 1; a.pendingAmount += rate; a.byTier[s.tier].pending += 1; tot.pendingCount += 1; tot.pendingAmount += rate }
    if (detail.length < 3000) detail.push({ emp: s.emp, tier: s.tier, code: s.code, site: s.site, saleDay: s.day, firstRecharge: fr ?? null, payable, amount: rate })
  }
  const employees = [...byEmp.values()].sort((a, b) => b.payableAmount - a.payableAmount || b.sales - a.sales)

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    start, end, today,
    rates: RATES,
    totals: tot,
    employees,
    detail,
    siteCount: carWashIds.length,
  }, 200, origin)
})
