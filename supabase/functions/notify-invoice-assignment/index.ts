// notify-invoice-assignment — Supabase Edge Function (Deno).
// Emails the newly assigned reviewer when a manager/owner routes an invoice to
// them. The DB write happens client-side; this function is a best-effort
// side-effect, so a missing Resend key just returns 503 { error: 'no_key' } and
// the caller flips the row's notify_status without surfacing an error.
//
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM, APP_URL.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

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
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatCurrency(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
  } catch {
    return `$${n.toFixed(2)}`
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    return json({ error: 'no_key', message: 'Resend is not configured.' }, 503, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const appUrl = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'
  // Default sender must be a Resend-verified domain. washlyfe.com is verified;
  // the operator.washlyfe.com subdomain is not, so sending from it is rejected.
  const fromAddr = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const callerId = u.user?.id
  if (!callerId) return json({ error: 'unauthorized' }, 401, origin)

  let body: { invoice_id?: string } = {}
  try { body = await req.json() } catch { /* allow empty */ }
  const invoiceId = body.invoice_id
  if (!invoiceId || typeof invoiceId !== 'string') {
    return json({ error: 'bad_request' }, 400, origin)
  }

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller } = await svc
    .from('users')
    .select('account_id, role, name')
    .eq('id', callerId)
    .maybeSingle()
  if (!caller || (caller.role !== 'owner' && caller.role !== 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }

  const { data: invoice } = await svc
    .from('ops_invoices')
    .select('id, account_id, vendor_name, amount, location_id, location_ids, class_names, assigned_to, approver_ids, submitted_by_name')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice || invoice.account_id !== caller.account_id) {
    return json({ error: 'not_found' }, 404, origin)
  }
  // Any assigned approver can act, so notify all of them (fall back to the
  // legacy single assignee).
  const approverIds: string[] = invoice.approver_ids?.length
    ? invoice.approver_ids
    : (invoice.assigned_to ? [invoice.assigned_to] : [])
  if (approverIds.length === 0) {
    return json({ error: 'no_assignee' }, 400, origin)
  }

  const { data: approvers } = await svc
    .from('users')
    .select('email, name')
    .in('id', approverIds)
  const recipients = (approvers ?? []).filter((a) => a.email)
  if (recipients.length === 0) {
    return json({ error: 'assignee_missing' }, 404, origin)
  }

  // Site name(s): QuickBooks classes (class_names) first; fall back to legacy
  // location rows for older invoices.
  let siteLabel = 'Unassigned site'
  const classNames: string[] = invoice.class_names ?? []
  if (classNames.length) {
    siteLabel = classNames.join(', ')
  } else {
    const siteIds: string[] = invoice.location_ids?.length
      ? invoice.location_ids
      : (invoice.location_id ? [invoice.location_id] : [])
    if (siteIds.length) {
      const { data: locs } = await svc.from('locations').select('name').in('id', siteIds)
      const names = (locs ?? []).map((l) => l.name).filter(Boolean)
      if (names.length) siteLabel = names.join(', ')
    }
  }

  const vendor = invoice.vendor_name?.trim() || 'Unnamed vendor'
  const amount = formatCurrency(Number(invoice.amount ?? 0))
  // Who routed it to the approver: the current user clicking "Send for approval".
  const assignedBy = caller.name?.trim() || 'A teammate'
  const reviewUrl = `${appUrl}/app/invoices`
  const subject = `Invoice assigned to you: ${vendor}`

  const htmlFor = (greeting: string) => `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">You have a new invoice to review</h2>
      <p style="margin:0 0 16px;">Hi ${escapeHtml(greeting)}, ${escapeHtml(assignedBy)} assigned an invoice to you in WashLyfe Operator.</p>
      <table style="border-collapse:collapse;width:100%;margin:0 0 20px;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;width:120px;">Vendor</td><td style="padding:6px 0;">${escapeHtml(vendor)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Amount</td><td style="padding:6px 0;">${escapeHtml(amount)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Site</td><td style="padding:6px 0;">${escapeHtml(siteLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Assigned by</td><td style="padding:6px 0;">${escapeHtml(assignedBy)}</td></tr>
      </table>
      <p style="margin:0 0 24px;">
        <a href="${reviewUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Review invoice</a>
      </p>
      <p style="margin:0;color:#888;font-size:12px;">You're receiving this because you were assigned an invoice in WashLyfe Operator.</p>
    </div>
  `

  const resend = new Resend(resendKey)
  let sent = 0
  let lastError: string | null = null
  for (const r of recipients) {
    try {
      const { error } = await resend.emails.send({
        from: fromAddr,
        to: [r.email as string],
        subject,
        html: htmlFor(r.name?.trim() || 'there'),
      })
      if (error) lastError = (error as { message?: string }).message ?? 'send_failed'
      else sent++
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'send_failed'
    }
  }
  if (sent === 0) return json({ ok: false, error: lastError ?? 'send_failed' }, 502, origin)
  return json({ ok: true, sent }, 200, origin)
})
