// signage-status-email — Supabase Edge Function (Deno).
// Emails the person who placed a signage order when its status changes
// (Ordered / Shipped / Completed). Shipped emails include the tracking number.
// Triggered by the admin from the Signage order tracker, so it is gated to
// kevan@washlyfe.com. Required secret: RESEND_API_KEY. Optional: RESEND_FROM.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// deno-lint-ignore no-explicit-any
type Any = any
const ADMIN_EMAIL = 'kevan@washlyfe.com'
const APP_BASE = 'https://operator.washlyfe.com'

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
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
const label = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Updated')

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key', message: 'Email is not configured.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const fromAddr = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
  if ((u.user.email ?? '').toLowerCase() !== ADMIN_EMAIL) return json({ error: 'forbidden' }, 403, origin)

  let body: { request_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const requestId = body.request_id
  if (!requestId) return json({ error: 'bad_request' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: r } = await svc
    .from('signage_requests')
    .select('id, account_id, status, tracking_number, title, sign_category, sign_type, quantity, requested_by, location:location_id(name)')
    .eq('id', requestId)
    .maybeSingle()
  const row = r as Any
  if (!row) return json({ error: 'not_found' }, 404, origin)

  let toEmail: string | null = null
  let toName = ''
  if (row.requested_by) {
    const { data: usr } = await svc.from('users').select('email, name').eq('id', row.requested_by).maybeSingle()
    toEmail = ((usr as Any)?.email ?? '').trim() || null
    toName = (usr as Any)?.name ?? ''
  }
  if (!toEmail) return json({ ok: true, skipped: 'no_requester_email' }, 200, origin)

  const status = String(row.status ?? '')
  const statusLabel = label(status)
  const orderName = row.title || row.sign_category || 'Signage order'
  const site = row.location?.name ? ` for ${row.location.name}` : ''
  const isShipped = status.toLowerCase() === 'shipped'
  const tracking = (row.tracking_number ?? '').toString().trim()

  const rows: [string, string][] = [
    ['Order', orderName + (row.sign_type ? ` (${row.sign_type})` : '')],
    ['Site', row.location?.name ?? 'All sites'],
    ['Quantity', String(row.quantity ?? '—')],
    ['Status', statusLabel],
  ]
  if (isShipped && tracking) rows.push(['Tracking #', tracking])

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 4px;font-size:20px;">Your signage order is now ${esc(statusLabel)}</h2>
      <p style="margin:0 0 16px;color:#555;font-size:14px;">${esc(toName || 'Hi')}, here is an update on your signage order${esc(site)}.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(v)}</td></tr>`).join('')}
      </table>
      ${isShipped && !tracking ? `<p style="margin:14px 0 0;font-size:13px;color:#555;">A tracking number will follow once it is available.</p>` : ''}
      <p style="margin:22px 0 0;">
        <a href="${esc(APP_BASE + '/app/signage')}" style="display:inline-block;background:#2563eb;color:#fff;font-size:15px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">View your orders</a>
      </p>
      <p style="margin:16px 0 0;color:#888;font-size:12px;">Sent from WashLyfe Operator.</p>
    </div>`

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: [toEmail],
      subject: `Signage order ${statusLabel}: ${orderName}`,
      html,
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
    return json({ ok: true, to: toEmail }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
