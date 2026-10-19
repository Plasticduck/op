// maintenance-order-email — Supabase Edge Function (Deno).
// On a new maintenance (equipment) order, sends two emails: (1) an internal
// notification to the maintenance team, and (2) a confirmation to the person who
// placed the order. Best-effort side-effect: the order row is written client-side
// first, so a missing key just returns 503 { error: 'no_key' }.
//
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// Who gets notified of every new maintenance order.
const MAINTENANCE_TEAM = [
  'justin.gamboa@mighty-wash.com',
  'ernest@mighty-wash.com',
  'kjowers@mighty-wash.com',
]

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

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function detailTable(rows: [string, string][]): string {
  return `<table style="border-collapse:collapse;width:100%;font-size:14px;">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(v)}</td></tr>`,
      )
      .join('')}
  </table>`
}

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
  const callerId = u.user?.id
  const callerEmail = (u.user?.email ?? '').trim()
  if (!callerId) return json({ error: 'unauthorized' }, 401, origin)

  let body: { order_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const orderId = body.order_id
  if (!orderId) return json({ error: 'bad_request' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller } = await svc.from('users').select('account_id').eq('id', callerId).maybeSingle()
  if (!caller) return json({ error: 'forbidden' }, 403, origin)

  const { data: r } = await svc
    .from('maintenance_orders')
    .select('*, locations:location_id(name)')
    .eq('id', orderId)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  const o = r as any
  if (!o || o.account_id !== caller.account_id) return json({ error: 'not_found' }, 404, origin)

  const siteName = o.location_id ? (o.locations?.name ?? '').trim() || '—' : 'All sites'
  const requester = (o.requester_name ?? '').trim() || '—'

  const rows: [string, string][] = [
    ['Item', o.item ?? '—'],
    ['Quantity', String(o.quantity ?? '—')],
    ['Site', siteName],
    ['Requested by', requester],
    ['Notes', o.notes ?? '—'],
  ]

  const resend = new Resend(resendKey)

  // Attach any photos the placer added (download from the private bucket).
  // deno-lint-ignore no-explicit-any
  const attachments: any[] = []
  const photoPaths: string[] = Array.isArray(o.photo_paths) ? o.photo_paths : []
  for (let i = 0; i < photoPaths.length && i < 10; i++) {
    const p = photoPaths[i]
    const { data: blob } = await svc.storage.from('maintenance-order-photos').download(p)
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const ext = (p.split('.').pop() || 'jpg').toLowerCase()
      attachments.push({ filename: `photo-${i + 1}.${ext}`, content: toBase64(bytes) })
    }
  }
  const photoNote = attachments.length ? ` ${attachments.length} photo${attachments.length > 1 ? 's' : ''} attached.` : ''

  // 1) Internal notification to the maintenance team.
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">New Maintenance Order${siteName && siteName !== '—' ? ' — ' + esc(siteName) : ''}</h2>
      ${detailTable(rows)}
      <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.${esc(photoNote)}</p>
    </div>`
  let internalError: string | null = null
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: MAINTENANCE_TEAM,
      subject: `Maintenance Order: ${o.item ?? 'equipment'}${siteName && siteName !== '—' ? ' — ' + siteName : ''}`,
      html,
      attachments: attachments.length ? attachments : undefined,
    })
    if (error) internalError = (error as { message?: string }).message ?? 'send_failed'
  } catch (e) {
    internalError = e instanceof Error ? e.message : 'send_failed'
  }

  // 2) Confirmation to the person who placed the order (best-effort). Skip if
  // their inbox is already on the team list.
  let placerEmail = callerEmail
  if (!placerEmail && o.requested_by) {
    const { data: usr } = await svc.from('users').select('email').eq('id', o.requested_by).maybeSingle()
    placerEmail = (((usr as { email?: string } | null)?.email) ?? '').trim()
  }
  let confirmationTo: string | null = null
  if (placerEmail && !MAINTENANCE_TEAM.includes(placerEmail.toLowerCase())) {
    const confirmHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 4px;font-size:20px;">We received your maintenance order</h2>
        <p style="margin:0 0 16px;color:#555;font-size:14px;">Your order has been sent to the maintenance team. Here is a copy for your records.</p>
        ${detailTable(rows.filter(([k]) => k !== 'Requested by'))}
        <p style="margin:22px 0 0;">
          <a href="https://operator.washlyfe.com/app/maintenance-orders" style="display:inline-block;background:#2563eb;color:#fff;font-size:15px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">View your orders</a>
        </p>
        <p style="margin:16px 0 0;color:#888;font-size:12px;">Sent from WashLyfe Operator.</p>
      </div>`
    try {
      const { error } = await resend.emails.send({
        from: fromAddr,
        to: [placerEmail],
        subject: `Maintenance order received: ${o.item ?? 'equipment'}`,
        html: confirmHtml,
      })
      if (!error) confirmationTo = placerEmail
    } catch { /* best-effort */ }
  }

  if (internalError) return json({ ok: false, error: internalError, confirmation_sent: !!confirmationTo }, 502, origin)
  return json({ ok: true, confirmation_sent: !!confirmationTo, confirmation_to: confirmationTo }, 200, origin)
})
