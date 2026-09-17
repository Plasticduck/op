// invoice-delete-request — Supabase Edge Function (Deno).
// A non-admin user requests deletion of an invoice; this emails the admin
// (kevan@washlyfe.com) with the invoice details and a direct link to open it in
// Invoice Approval. Only the admin can actually delete (enforced by RLS).
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM, INVOICE_DELETE_EMAIL_TO.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// deno-lint-ignore no-explicit-any
type Any = any
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
function money(v: unknown): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—'
}
function fmtDate(d: unknown): string {
  const s = String(d ?? '').trim()
  if (!s) return '—'
  const p = new Date(s)
  return Number.isNaN(p.getTime()) ? s : p.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
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
  const toAddr = Deno.env.get('INVOICE_DELETE_EMAIL_TO') ?? 'kevan@washlyfe.com'

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const callerId = u.user?.id
  if (!callerId) return json({ error: 'unauthorized' }, 401, origin)

  let body: { invoice_id?: string; reason?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const invoiceId = body.invoice_id
  if (!invoiceId) return json({ error: 'bad_request' }, 400, origin)
  const reason = String(body.reason ?? '').trim().slice(0, 500)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller } = await svc.from('users').select('account_id, name, email').eq('id', callerId).maybeSingle()
  const callerRow = caller as Any
  if (!callerRow?.account_id) return json({ error: 'forbidden' }, 403, origin)

  const { data: inv } = await svc
    .from('ops_invoices')
    .select('id, account_id, vendor_name, amount, invoice_date, invoice_number, status, file_name')
    .eq('id', invoiceId)
    .maybeSingle()
  const invoice = inv as Any
  if (!invoice || invoice.account_id !== callerRow.account_id) return json({ error: 'not_found' }, 404, origin)

  const requester = (callerRow.name || callerRow.email || 'A user').toString()
  const link = `${APP_BASE}/app/invoices?invoice=${encodeURIComponent(invoice.id)}`
  const vendor = invoice.vendor_name || 'Unknown vendor'

  const rows: [string, string][] = [
    ['Vendor', vendor],
    ['Amount', money(invoice.amount)],
    ['Invoice date', fmtDate(invoice.invoice_date)],
    ['Invoice #', invoice.invoice_number || '—'],
    ['Status', invoice.status || '—'],
    ['File', invoice.file_name || '—'],
    ['Requested by', requester],
  ]
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 4px;font-size:20px;">Invoice deletion requested</h2>
      <p style="margin:0 0 16px;color:#555;font-size:14px;">${esc(requester)} asked to delete an invoice. You are the only person who can delete it.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(v)}</td></tr>`).join('')}
      </table>
      ${reason ? `<p style="margin:16px 0 0;font-size:14px;"><span style="color:#666;">Reason:</span> ${esc(reason)}</p>` : ''}
      <p style="margin:22px 0 0;">
        <a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;font-size:15px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Open the invoice</a>
      </p>
      <p style="margin:16px 0 0;color:#888;font-size:12px;">Or paste this link: ${esc(link)}</p>
    </div>`

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: [toAddr],
      subject: `Invoice deletion requested: ${vendor} ${money(invoice.amount)}`,
      html,
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
    return json({ ok: true }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
