// daily-approver-digest — Supabase Edge Function (Deno).
// Once a day at 5pm Central, emails each approver a single digest of the invoices
// assigned to them since the previous day's 5pm. Replaces the old per-assignment
// email (notify-invoice-assignment). An approver with nothing new in the window
// gets no email at all.
//
// Scheduled by pg_cron at 22:00 & 23:00 UTC; the function only sends when
// America/Chicago hour === 17, so it fires exactly once at 5pm whether CDT or CST.
// The 24h window itself is computed in SQL (invoice_approver_digest RPC), so the
// 5pm boundary is exact regardless of the minute the cron actually fires.
//
// Body (optional): { force?: true, dryRun?: true, to?: "override@…" }
//   force  bypasses the 5pm time guard (manual test)
//   dryRun returns the per-approver plan without sending
//   to     sends every approver's digest to this address instead (test)
//
// Secrets: RESEND_API_KEY (required). Optional: RESEND_FROM, APP_URL.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

const json = (b: unknown, s: number) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function money(n: number): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) }
  catch { return `$${n.toFixed(2)}` }
}

type Inv = {
  id: string
  vendor_name: string | null
  amount: number | null
  invoice_number: string | null
  class_names: string[] | null
  approver_ids: string[] | null
  assigned_to: string | null
  submitted_by_name: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key' }, 503)
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: service-role (cron) or an owner (manual test).
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const uc = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await uc.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden' }, 403)
  }

  let body: { force?: boolean; dryRun?: boolean; to?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  // Time guard: only send at 5pm Central unless forced.
  const chicagoHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()))
  if (!body.force && chicagoHour !== 17) return json({ skipped: true, reason: 'not 5pm Central', chicagoHour }, 200)

  // Invoices assigned in the window ending at today 5pm Central.
  const { data: invs, error } = await svc.rpc('invoice_approver_digest')
  if (error) return json({ error: 'query_failed', detail: String(error) }, 500)
  const invoices = (invs ?? []) as Inv[]

  // Group by approver: an invoice with multiple approvers appears for each.
  const byApprover = new Map<string, Inv[]>()
  for (const inv of invoices) {
    const ids = inv.approver_ids?.length ? inv.approver_ids : (inv.assigned_to ? [inv.assigned_to] : [])
    for (const aid of ids) {
      const list = byApprover.get(aid) ?? []
      list.push(inv)
      byApprover.set(aid, list)
    }
  }
  if (byApprover.size === 0) return json({ ok: true, sent: 0, approvers: 0, invoices: 0 }, 200)

  const { data: users } = await svc.from('users').select('id, email, name').in('id', [...byApprover.keys()])
  const userById = new Map((users ?? []).map((u) => [u.id as string, u as { id: string; email: string | null; name: string | null }]))

  const appUrl = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const reviewUrl = `${appUrl}/app/invoices`

  const plan = [...byApprover.entries()].map(([aid, list]) => {
    const user = userById.get(aid)
    return {
      approver_id: aid,
      name: user?.name ?? null,
      email: body.to ?? user?.email ?? null,
      count: list.length,
      total: list.reduce((s, i) => s + (Number(i.amount) || 0), 0),
      invoices: list,
    }
  }).filter((p) => p.email)

  if (body.dryRun) {
    return json({
      dryRun: true,
      approvers: plan.length,
      plan: plan.map((p) => ({ name: p.name, email: p.email, count: p.count, total: p.total,
        invoices: p.invoices.map((i) => ({ vendor: i.vendor_name, amount: Number(i.amount ?? 0), invoice_number: i.invoice_number, sites: i.class_names ?? [] })) })),
    }, 200)
  }

  const resend = new Resend(resendKey)
  let sent = 0
  let lastError: string | null = null
  for (const p of plan) {
    const rows = p.invoices.map((i) => {
      const sites = (i.class_names ?? []).join(', ') || 'Unassigned site'
      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;">${escapeHtml(i.vendor_name?.trim() || 'Unnamed vendor')}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;">${escapeHtml(i.invoice_number || '—')}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;">${escapeHtml(sites)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;">${escapeHtml(money(Number(i.amount) || 0))}</td>
        </tr>`
    }).join('')
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 6px;font-size:20px;">Invoices awaiting your approval</h2>
        <p style="margin:0 0 16px;color:#475569;">Hi ${escapeHtml(p.name || 'there')}, ${p.count} invoice${p.count === 1 ? ' was' : 's were'} assigned to you for approval. Total ${escapeHtml(money(p.total))}.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 20px;">
          <thead>
            <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;">
              <th style="padding:6px 10px;">Vendor</th>
              <th style="padding:6px 10px;">Invoice #</th>
              <th style="padding:6px 10px;">Site</th>
              <th style="padding:6px 10px;text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:0 0 24px;">
          <a href="${reviewUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Review invoices</a>
        </p>
        <p style="margin:0;color:#888;font-size:12px;">You're receiving this daily summary because invoices were assigned to you in WashLyfe Operator. Sent at 5pm Central.</p>
      </div>`
    const subject = `${p.count} invoice${p.count === 1 ? '' : 's'} awaiting your approval`
    try {
      const { error: e } = await resend.emails.send({ from, to: [p.email as string], subject, html })
      if (e) lastError = (e as { message?: string }).message ?? 'send_failed'
      else sent++
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'send_failed'
    }
  }
  return json({ ok: true, sent, approvers: plan.length, invoices: invoices.length, error: lastError }, 200)
})
