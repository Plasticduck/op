// event-pay-request-email — Supabase Edge Function (Deno).
// Emails Event Pay Requests, with the request's PDF attached (built client-side
// and passed in as base64). The row is saved client-side first, so a failed send
// can be retried from the page.
//
// action 'send' (default), after a request is saved:
//   - from a Regional Manager (needs_approval): to the approver (Garland) for
//     approval, stamping approval_requested_at, plus a copy to the submitter.
//   - otherwise, or once approved: to payroll (Tayler), stamping emailed_at, plus a
//     copy to the submitter.
// action 'approve' / 'reject' (the approver only, while pending): records the
//   decision, then approve emails payroll and tells the submitter; reject (with a
//   reason in `note`) tells the submitter and nothing goes to payroll.
//
// Body: { request_id: uuid, action?: 'send' | 'approve' | 'reject', pdf_base64?: string, note?: string }
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// Every request ends up with payroll.
const PAYROLL = ['tayler@mighty-wash.com']
// Approves requests from Regional Managers before they go to payroll (RLS 0177).
const APPROVER_EMAIL = 'gwatson@mighty-wash.com'
// Can re-send any request. Mirrors the RLS in migrations 0175-0177.
const ADMIN_EMAIL = 'kevan@washlyfe.com'
const APP_URL = 'https://operator.washlyfe.com/app/event-pay'

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

type Attendee = { name: string; arrival: string; departure: string; hours: number; mighty_maxx: boolean; amount: number | null }

const fmtTime = (t: string) => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return String(t ?? '')
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`
}
const money = (n: number) => `$${n.toFixed(2)}`
const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })

function attendeeTable(people: Attendee[]): string {
  const th = 'padding:8px 10px;text-align:left;font-size:12px;color:#fff;background:#2563eb;'
  const td = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;'
  const right = 'text-align:right;'
  const totalHours = people.reduce((a, p) => a + (Number(p.hours) || 0), 0)
  const maxxTotal = people.filter((p) => p.mighty_maxx).reduce((a, p) => a + (Number(p.amount) || 0), 0)
  return `<table style="border-collapse:collapse;width:100%;margin-top:16px;">
    <tr><th style="${th}">Team member</th><th style="${th}">Arrival</th><th style="${th}">Departure</th><th style="${th}${right}">Hours</th><th style="${th}">Mighty Maxx</th><th style="${th}${right}">Pay</th></tr>
    ${people
      .map(
        (p) => `<tr>
          <td style="${td}font-weight:600;">${esc(p.name)}</td>
          <td style="${td}">${esc(fmtTime(p.arrival))}</td>
          <td style="${td}">${esc(fmtTime(p.departure))}</td>
          <td style="${td}${right}">${(Number(p.hours) || 0).toFixed(2)}</td>
          <td style="${td}">${p.mighty_maxx ? 'Yes' : 'No'}</td>
          <td style="${td}${right}">${p.mighty_maxx ? money(Number(p.amount) || 0) : 'Hourly rate'}</td>
        </tr>`,
      )
      .join('')}
    <tr>
      <td style="${td}font-weight:700;" colspan="3">Total</td>
      <td style="${td}${right}font-weight:700;">${totalHours.toFixed(2)}</td>
      <td style="${td}"></td>
      <td style="${td}${right}font-weight:700;">${maxxTotal ? money(maxxTotal) : ''}</td>
    </tr>
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

  let body: { request_id?: string; pdf_base64?: string | null; action?: string; note?: string | null } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!body.request_id) return json({ error: 'bad_request' }, 400, origin)
  const action = body.action === 'approve' || body.action === 'reject' ? body.action : 'send'
  const note = String(body.note ?? '').trim()

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: caller } = await svc.from('users').select('account_id, name').eq('id', callerId).maybeSingle()
  if (!caller) return json({ error: 'forbidden' }, 403, origin)

  const { data: r } = await svc
    .from('event_pay_requests')
    .select('*, locations:location_id(name)')
    .eq('id', body.request_id)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  const o = r as any
  if (!o || o.account_id !== caller.account_id) return json({ error: 'not_found' }, 404, origin)

  const me = callerEmail.toLowerCase()
  const isSubmitter = o.submitted_by === callerId
  const isApprover = me === APPROVER_EMAIL
  if (action === 'send') {
    // The submitter, the admin, or (for a request that needs approval) the approver.
    if (!isSubmitter && me !== ADMIN_EMAIL && !(isApprover && o.needs_approval)) return json({ error: 'forbidden' }, 403, origin)
    if (o.approval_status === 'rejected') return json({ error: 'rejected', message: 'This request was not approved.' }, 409, origin)
  } else {
    if (!isApprover) return json({ error: 'forbidden', message: 'Only Garland Watson can approve event pay requests.' }, 403, origin)
    if (!o.needs_approval || o.approval_status !== 'pending') return json({ error: 'not_pending', message: 'This request is not waiting for approval.' }, 409, origin)
    if (action === 'reject' && !note) return json({ error: 'bad_request', message: 'Give a reason for not approving it.' }, 400, origin)
  }

  // Record the decision first, and only while the request is still pending, so
  // two clicks can't both go through.
  if (action !== 'send') {
    const decision = {
      approval_status: action === 'approve' ? 'approved' : 'rejected',
      decided_by: callerId,
      decided_by_name: (caller.name ?? '').trim() || callerEmail,
      decided_at: new Date().toISOString(),
      decision_note: note || null,
    }
    const { data: upd } = await svc
      .from('event_pay_requests')
      .update(decision)
      .eq('id', o.id)
      .eq('approval_status', 'pending')
      .select('id')
    if (!upd?.length) return json({ error: 'not_pending', message: 'This request is not waiting for approval.' }, 409, origin)
    Object.assign(o, decision)
  }

  // The submitter's address, for their copy and the approval outcome.
  let submitterEmail = isSubmitter ? callerEmail : ''
  if (!submitterEmail && o.submitted_by) {
    const { data: s } = await svc.from('users').select('email').eq('id', o.submitted_by).maybeSingle()
    submitterEmail = String(s?.email ?? '').trim()
  }

  const site = (o.locations?.name ?? '').trim() || 'Not specified'
  const people: Attendee[] = Array.isArray(o.attendees) ? o.attendees : []
  const rows: [string, string][] = [
    ['Site', site],
    ['Event', o.event_name],
    ['Event date', fmtDate(o.event_date)],
    ['Requested by', o.requester_name],
    ...(o.submitter_name && o.submitter_name !== o.requester_name ? [['Submitted by', o.submitter_name] as [string, string]] : []),
    ...(o.notes ? [['Notes', o.notes] as [string, string]] : []),
    ...(o.approval_status === 'approved' ? [['Approved by', `${o.decided_by_name}, ${fmtStamp(o.decided_at)}`] as [string, string]] : []),
    ...(o.approval_status === 'rejected'
      ? [['Not approved by', `${o.decided_by_name}, ${fmtStamp(o.decided_at)}`] as [string, string], ['Reason', o.decision_note ?? ''] as [string, string]]
      : []),
  ]
  const payNote = 'Mighty Maxx is paid the flat amount shown. Every other team member is paid their hourly rate for the hours shown.'
  const pdf = typeof body.pdf_base64 === 'string' && body.pdf_base64.length > 100 ? body.pdf_base64 : null
  const fileSlug = String(o.event_name ?? 'event').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'event'
  const attachments = pdf ? [{ filename: `event-pay-${fileSlug}-${o.event_date}.pdf`, content: pdf }] : undefined
  const count = `${people.length} team member${people.length === 1 ? '' : 's'}`
  const subjectTail = `${o.event_name} (${site}, ${fmtDate(o.event_date)})`

  const resend = new Resend(resendKey)
  const page = (heading: string, intro: string, button?: { label: string; href: string }) => `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:640px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 6px;font-size:20px;">${esc(heading)}</h2>
      <p style="margin:0 0 16px;color:#555;font-size:14px;">${esc(intro)}</p>
      ${button ? `<p style="margin:0 0 18px;"><a href="${esc(button.href)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px;">${esc(button.label)}</a></p>` : ''}
      ${detailTable(rows)}
      ${attendeeTable(people)}
      <p style="margin:14px 0 0;color:#666;font-size:12px;">${esc(payNote)}${pdf ? ' The PDF is attached.' : ''}</p>
      <p style="margin:18px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
    </div>`
  // Returns an error message, or null when the email went out.
  const send = async (to: string[], subject: string, html: string, withPdf = true): Promise<string | null> => {
    try {
      const { error } = await resend.emails.send({
        from: fromAddr,
        to,
        replyTo: submitterEmail && !to.includes(submitterEmail) ? submitterEmail : undefined,
        subject,
        html,
        attachments: withPdf ? attachments : undefined,
      })
      return error ? ((error as { message?: string }).message ?? 'send_failed') : null
    } catch (e) {
      return e instanceof Error ? e.message : 'send_failed'
    }
  }
  // Best-effort note to the submitter, unless they already got the main email.
  const tellSubmitter = async (subject: string, heading: string, intro: string, skip: string[], withPdf = true) => {
    if (!submitterEmail || skip.includes(submitterEmail.toLowerCase())) return null
    return (await send([submitterEmail], subject, page(heading, intro), withPdf)) ? null : submitterEmail
  }
  const now = () => new Date().toISOString()

  // Not approved: tell the submitter; nothing goes to payroll.
  if (action === 'reject') {
    const notified = await tellSubmitter(
      `Not approved: Event Pay Request for ${o.event_name}`,
      'Your event pay request was not approved',
      `${o.decided_by_name} did not approve this request, so it was not sent to payroll. The reason is below.`,
      [],
      false,
    )
    return json({ ok: true, status: 'rejected', notified }, 200, origin)
  }

  // From a Regional Manager and still pending: to the approver.
  if (o.needs_approval && o.approval_status === 'pending') {
    const err = await send(
      [APPROVER_EMAIL],
      `Approval needed: Event Pay Request for ${subjectTail}`,
      page(
        `Approval needed: ${o.event_name}`,
        `${o.requester_name} is requesting event pay for ${count}. Approve or reject it in Operator. Once it's approved, it is emailed to Tayler for payroll.`,
        { label: 'Review in Operator', href: APP_URL },
      ),
    )
    if (err) return json({ ok: false, error: err, status: 'pending' }, 502, origin)
    await svc.from('event_pay_requests').update({ approval_requested_at: now() }).eq('id', o.id)
    const copyTo = await tellSubmitter(
      `Submitted for approval: Event Pay Request for ${o.event_name}`,
      'Your event pay request was sent for approval',
      'It was sent to Garland Watson for approval. Once Garland approves it, it goes to Tayler for payroll. Here is a copy for your records.',
      [APPROVER_EMAIL],
    )
    return json({ ok: true, status: 'pending', sent_to: [APPROVER_EMAIL], copy_to: copyTo }, 200, origin)
  }

  // No approval needed, or approved: to payroll.
  const approved = o.approval_status === 'approved'
  const err = await send(
    PAYROLL,
    `Event Pay Request: ${subjectTail}`,
    page(
      `Event Pay Request: ${o.event_name}`,
      `${o.requester_name} is requesting event pay for ${count}.${approved ? ` Approved by ${o.decided_by_name}.` : ''}`,
    ),
  )
  if (err) return json({ ok: false, error: err, status: o.approval_status ?? 'direct' }, 502, origin)
  await svc.from('event_pay_requests').update({ emailed_at: now() }).eq('id', o.id)

  const copyTo = approved
    ? await tellSubmitter(
      `Approved: Event Pay Request for ${o.event_name}`,
      'Your event pay request was approved',
      `${o.decided_by_name} approved it, and it was sent to Tayler for payroll.`,
      PAYROLL,
    )
    : await tellSubmitter(
      `Submitted: Event Pay Request for ${o.event_name}`,
      'Your event pay request was submitted',
      'It was emailed to Tayler. Here is a copy for your records.',
      PAYROLL,
    )
  return json({ ok: true, status: o.approval_status ?? 'direct', sent_to: PAYROLL, copy_to: copyTo }, 200, origin)
})
