// it-field-checklist-email — Supabase Edge Function (Deno).
// Emails a submitted IT Field Checklist to Mighty Wash: a summary (site, tech,
// tally, and every item marked Issue with its comment) plus the report PDF,
// built client-side and passed in as base64. Stamps it_field_checklists.emailed_at
// on success so the page can offer a re-send when it didn't go out.
//
// Body: { checklist_id: uuid, pdf_base64?: string, file_name?: string }
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// Who gets a copy of every submitted checklist.
const RECIPIENTS = ['kjowers@mighty-wash.com']

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

type Item = { key: string; section: string; label: string; checked: boolean; issue?: boolean; comment: string; media: unknown[] }

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

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

  let body: { checklist_id?: string; pdf_base64?: string | null; file_name?: string | null } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!body.checklist_id) return json({ error: 'bad_request' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: caller } = await svc.from('users').select('account_id, role').eq('id', callerId).maybeSingle()
  if (!caller) return json({ error: 'forbidden' }, 403, origin)

  const { data: r } = await svc
    .from('it_field_checklists')
    .select('*, locations:location_id(name)')
    .eq('id', body.checklist_id)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  const o = r as any
  if (!o || o.account_id !== caller.account_id) return json({ error: 'not_found' }, 404, origin)
  if (o.status !== 'submitted') return json({ error: 'not_submitted' }, 409, origin)
  // The tech who did it (or an owner) can send it.
  if (o.tech_id !== callerId && caller.role !== 'owner') return json({ error: 'forbidden' }, 403, origin)

  const site = (o.locations?.name ?? '').trim() || 'Site'
  const tech = (o.tech_name ?? '').trim() || 'IT tech'
  const items: Item[] = Array.isArray(o.items) ? o.items : []
  const checked = items.filter((i) => i.checked).length
  const issues = items.filter((i) => i.issue)
  const notDone = items.filter((i) => !i.checked && !i.issue)
  const when = fmtStamp(o.submitted_at ?? o.created_at)
  const link = `https://operator.washlyfe.com/app/it-field-checklist/${o.id}`

  const issueBlock = issues.length
    ? `<div style="margin:18px 0 0;padding:12px 14px;border:1px solid #f3b4bb;background:#fdecee;border-radius:8px;">
         <div style="font-weight:700;color:#c81e2d;font-size:14px;margin-bottom:6px;">${issues.length} issue${issues.length === 1 ? '' : 's'}</div>
         ${issues.map((i) => `<div style="margin:8px 0 0;font-size:14px;"><div style="font-weight:600;">${esc(i.label)}</div><div style="color:#444;">${esc(i.comment)}</div></div>`).join('')}
       </div>`
    : `<p style="margin:18px 0 0;font-size:14px;color:#16803d;font-weight:600;">No issues reported.</p>`
  const notDoneBlock = notDone.length
    ? `<div style="margin:14px 0 0;font-size:13px;color:#666;"><strong>Not done:</strong> ${notDone.map((i) => esc(i.label)).join('; ')}</div>`
    : ''
  const notes = (o.notes ?? '').trim()
  const pdf = typeof body.pdf_base64 === 'string' && body.pdf_base64.length > 100 ? body.pdf_base64 : null
  const fileName = (body.file_name ?? '').trim() || `it-field-checklist-${o.id.slice(0, 8)}.pdf`

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 4px;font-size:20px;">IT Field Checklist: ${esc(site)}</h2>
      <p style="margin:0;color:#555;font-size:14px;">${esc(tech)} · Submitted ${esc(when)}</p>
      <p style="margin:14px 0 0;font-size:14px;"><strong style="color:#16803d;">${checked} checked</strong> · <strong style="color:${issues.length ? '#c81e2d' : '#555'};">${issues.length} issue${issues.length === 1 ? '' : 's'}</strong> · ${notDone.length} not done</p>
      ${issueBlock}
      ${notDoneBlock}
      ${notes ? `<div style="margin:14px 0 0;font-size:14px;"><strong>Notes:</strong> ${esc(notes)}</div>` : ''}
      <p style="margin:22px 0 0;">
        <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;font-size:15px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Open in Operator</a>
      </p>
      <p style="margin:16px 0 0;color:#888;font-size:12px;">${pdf ? 'The full report, with photos, is attached as a PDF. ' : ''}Sent from WashLyfe Operator.</p>
    </div>`

  try {
    const resend = new Resend(resendKey)
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: RECIPIENTS,
      replyTo: callerEmail || undefined,
      subject: `IT Field Checklist: ${site} (${when})${issues.length ? `, ${issues.length} issue${issues.length === 1 ? '' : 's'}` : ''}`,
      html,
      attachments: pdf ? [{ filename: fileName, content: pdf }] : undefined,
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'send_failed' }, 502, origin)
  }

  await svc.from('it_field_checklists').update({ emailed_at: new Date().toISOString() }).eq('id', o.id)
  return json({ ok: true, sent_to: RECIPIENTS }, 200, origin)
})
