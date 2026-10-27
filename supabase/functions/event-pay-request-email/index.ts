// event-pay-request-email — Supabase Edge Function (Deno).
// Emails a new Event Pay Request: (1) to payroll (Tayler), with the request's PDF
// attached (built client-side and passed in as base64), and (2) a copy to the
// person who submitted it. Stamps event_pay_requests.emailed_at on success. The
// row is saved client-side first, so a missing key just returns
// 503 { error: 'no_key' } and the request can be re-sent from the page.
//
// Body: { request_id: uuid, pdf_base64?: string }
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// Every submitted request goes to payroll.
const RECIPIENTS = ['tayler@mighty-wash.com']
// The one account that can see (and re-send) every request; everyone else only
// their own. Mirrors the RLS in migration 0175.
const ADMIN_EMAIL = 'kevan@washlyfe.com'

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

  let body: { request_id?: string; pdf_base64?: string | null } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!body.request_id) return json({ error: 'bad_request' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: caller } = await svc.from('users').select('account_id').eq('id', callerId).maybeSingle()
  if (!caller) return json({ error: 'forbidden' }, 403, origin)

  const { data: r } = await svc
    .from('event_pay_requests')
    .select('*, locations:location_id(name)')
    .eq('id', body.request_id)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  const o = r as any
  if (!o || o.account_id !== caller.account_id) return json({ error: 'not_found' }, 404, origin)
  // Only the submitter (or the admin) can send a request.
  if (o.submitted_by !== callerId && callerEmail.toLowerCase() !== ADMIN_EMAIL) return json({ error: 'forbidden' }, 403, origin)

  const site = (o.locations?.name ?? '').trim() || 'Not specified'
  const people: Attendee[] = Array.isArray(o.attendees) ? o.attendees : []
  const rows: [string, string][] = [
    ['Site', site],
    ['Event', o.event_name],
    ['Event date', fmtDate(o.event_date)],
    ['Requested by', o.requester_name],
    ...(o.submitter_name && o.submitter_name !== o.requester_name ? [['Submitted by', o.submitter_name] as [string, string]] : []),
    ...(o.notes ? [['Notes', o.notes] as [string, string]] : []),
  ]
  const payNote = 'Mighty Maxx is paid the flat amount shown. Every other team member is paid their hourly rate for the hours shown.'
  const pdf = typeof body.pdf_base64 === 'string' && body.pdf_base64.length > 100 ? body.pdf_base64 : null
  const fileSlug = String(o.event_name ?? 'event').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'event'
  const attachments = pdf ? [{ filename: `event-pay-${fileSlug}-${o.event_date}.pdf`, content: pdf }] : undefined

  const resend = new Resend(resendKey)
  const page = (heading: string, intro: string) => `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:640px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 6px;font-size:20px;">${esc(heading)}</h2>
      <p style="margin:0 0 16px;color:#555;font-size:14px;">${esc(intro)}</p>
      ${detailTable(rows)}
      ${attendeeTable(people)}
      <p style="margin:14px 0 0;color:#666;font-size:12px;">${esc(payNote)}${pdf ? ' The PDF is attached.' : ''}</p>
      <p style="margin:18px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
    </div>`

  // 1) To payroll.
  let sendError: string | null = null
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: RECIPIENTS,
      replyTo: callerEmail || undefined,
      subject: `Event Pay Request: ${o.event_name} (${site}, ${fmtDate(o.event_date)})`,
      html: page(`Event Pay Request: ${o.event_name}`, `${o.requester_name} is requesting event pay for ${people.length} team member${people.length === 1 ? '' : 's'}.`),
      attachments,
    })
    if (error) sendError = (error as { message?: string }).message ?? 'send_failed'
  } catch (e) {
    sendError = e instanceof Error ? e.message : 'send_failed'
  }
  if (sendError) return json({ ok: false, error: sendError }, 502, origin)

  await svc.from('event_pay_requests').update({ emailed_at: new Date().toISOString() }).eq('id', o.id)

  // 2) A copy to the submitter (best-effort), unless they're already a recipient.
  let copyTo: string | null = null
  if (callerEmail && !RECIPIENTS.includes(callerEmail.toLowerCase())) {
    try {
      const { error } = await resend.emails.send({
        from: fromAddr,
        to: [callerEmail],
        subject: `Submitted: Event Pay Request for ${o.event_name}`,
        html: page('Your event pay request was submitted', 'It was emailed to Tayler. Here is a copy for your records.'),
        attachments,
      })
      if (!error) copyTo = callerEmail
    } catch { /* best-effort */ }
  }

  return json({ ok: true, sent_to: RECIPIENTS, copy_to: copyTo }, 200, origin)
})
