// site-audit-new-notify — Supabase Edge Function (Deno).
// When a Site Audit NEW is submitted, emails its PDF (grade, every item, comments,
// photos) and texts a one-line result. Pre-launch it goes only to Kevan (his
// request, 2026-11-17), not the old Site Audits list in email-site-audit.
//
// Body: { audit_id, resend?, smsOnly?, check? }. Sends once per audit: the row's
// notified_at is claimed before sending, so a retry or a second tab doesn't send it
// again; resend: true sends it again anyway (smsOnly: just the text). check: true
// reads back delivery from Resend and Twilio (accepted is not delivered).
//
// Auth: the audit's auditor, an Admin (owner) of its account, or the service role.
// Secrets: RESEND_API_KEY (optional RESEND_FROM) for email; TWILIO_ACCOUNT_SID,
// TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET and TWILIO_MESSAGING_SERVICE_SID or
// TWILIO_FROM for the text. Either one missing just skips that channel.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'
import { jsPDF } from 'npm:jspdf@4.2.1'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'
import { SECTIONS, fmtPoints, gradeTone, normalizeAnswers, renderAuditNew, sectionStatus, type Answer } from './report.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const EMAIL_TO = ['kjowers@mighty-wash.com']
const SMS_TO = ['+19408676366'] // Kevan
const BUCKET = 'site-audit-photos'
const APP = 'https://operator.washlyfe.com'
const MIGHTY_WASH = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

const ALLOWED_ORIGINS = new Set<string>(['https://operator.washlyfe.com', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return { 'Access-Control-Allow-Origin': allow, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Times in Central, where the audits are reviewed (the worker runs in UTC).
const central = (d: string | Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d))

function pngSize(b: Uint8Array) {
  return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] }
}
function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i < b.length - 8) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
    i += 2 + ((b[i + 2] << 8) | b[i + 3])
  }
  return null
}

// A small JPEG thumbnail from Storage's resizer (the worker never downloads the
// full photo) plus a long-lived link to the full image.
async function resolvePhoto(svc: Any, path: string) {
  const { data: full } = await svc.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 5)
  const url = full?.signedUrl ?? ''
  let dataUrl: string | null = null
  let w = 3, h = 4
  try {
    const { data: thumb } = await svc.storage.from(BUCKET).createSignedUrl(path, 3600, { transform: { width: 512, height: 512, resize: 'contain', quality: 55 } })
    if (thumb?.signedUrl) {
      const r = await fetch(thumb.signedUrl, { headers: { Accept: 'image/jpeg' } })
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer())
        const dim = jpegSize(bytes)
        if (dim && dim.w > 0 && dim.h > 0) { w = dim.w; h = dim.h; dataUrl = 'data:image/jpeg;base64,' + encodeBase64(bytes) }
      }
    }
  } catch (_) { /* link only */ }
  return url || dataUrl ? { url, dataUrl, w, h } : null
}

type Outcome = { title: string; detail: string; tone: 'ok' | 'warn' | 'danger'; failedItems: string[]; warnItems: string[]; short: string }

function outcome(audit: Any, answers: Record<string, Answer>): Outcome {
  const safetyFailed = !!audit.safety_failed
  const score = Number(audit.score ?? 0)
  const failed: string[] = audit.failed_sections ?? []
  const passed = sectionStatus(answers).filter((r) => r.status === 'pass').length
  const passedLine = `${passed} of ${SECTIONS.length} sections passed (${fmtPoints(score)} of 100 points).`
  const failedItems: string[] = []
  const warnItems: string[] = []
  for (const s of SECTIONS) {
    for (const it of s.items) {
      const v = answers[`${s.id}.${it.id}`].value
      if (v === 'fail') failedItems.push(`${s.title}: ${it.label}`)
      if (v === 'warn') warnItems.push(`${s.title}: ${it.label}`)
    }
  }
  if (safetyFailed) {
    return {
      title: 'FAILED  (Safety)',
      detail: `A Safety item failed, so the whole audit fails. ${passedLine}${failed.length ? ' Failed: ' + failed.join(', ') + '.' : ''}`,
      tone: 'danger', failedItems, warnItems,
      short: `FAILED on Safety (${fmtPoints(score)}/100 points)`,
    }
  }
  return {
    title: `Grade ${audit.grade}   ${fmtPoints(score)} / 100`,
    detail: `${passedLine}${failed.length ? ' Failed: ' + failed.join(', ') + '.' : ' Every section passed.'}`,
    tone: gradeTone(audit.grade, false) as Outcome['tone'], failedItems, warnItems,
    short: `Grade ${audit.grade}, ${fmtPoints(score)}/100`,
  }
}

async function buildPdf(svc: Any, audit: Any, answers: Record<string, Answer>, site: string, o: Outcome): Promise<string> {
  const photoImages: Record<string, Any> = {}
  for (const p of Object.values(answers).flatMap((a) => a.photos)) {
    const r = await resolvePhoto(svc, p)
    if (r) photoImages[p] = r
  }
  let logo: Any = null
  if (audit.account_id === MIGHTY_WASH) {
    try {
      const lr = await fetch(APP + '/mw-logo.png')
      if (lr.ok) { const lb = new Uint8Array(await lr.arrayBuffer()); const d = pngSize(lb); logo = { dataUrl: 'data:image/png;base64,' + encodeBase64(lb), w: d.w, h: d.h } }
    } catch (_) { /* no logo */ }
  }
  // compress: the logo PNG is stored raw otherwise, about 9 MB.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true })
  renderAuditNew(doc, {
    metaLine: ['Site: ' + (site || '-'), 'Date: ' + central(audit.submitted_at ?? audit.created_at), 'Auditor: ' + (audit.auditor_name ?? '-')].join('  |  '),
    logo,
    banner: { title: o.title, detail: o.detail, tone: o.tone },
    answers,
    photoImages,
    footer: `Audited by ${audit.auditor_name ?? '-'}  -  generated ${central(new Date())}`,
  })
  return encodeBase64(new Uint8Array(doc.output('arraybuffer')))
}

async function sendSms(to: string, text: string): Promise<Any> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const keySid = Deno.env.get('TWILIO_API_KEY_SID')
  const keySecret = Deno.env.get('TWILIO_API_KEY_SECRET')
  const fromNum = Deno.env.get('TWILIO_FROM')
  const messagingServiceSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')
  if (!accountSid || !keySid || !keySecret || (!fromNum && !messagingServiceSid)) return { to, ok: false, error: 'twilio_not_configured' }
  const form = new URLSearchParams()
  form.set('To', to)
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid)
  else form.set('From', fromNum as string)
  form.set('Body', text)
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${keySid}:${keySecret}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const d = await res.json().catch(() => null)
    if (!res.ok) return { to, ok: false, status: res.status, code: d?.code, error: d?.message ?? 'twilio_error' }
    return { to, ok: true, sid: d?.sid }
  } catch (e) {
    return { to, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { audit_id?: string; resend?: boolean; check?: boolean; smsOnly?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }
  const auditId = body.audit_id
  if (!auditId || !/^[0-9a-f-]{36}$/i.test(auditId)) return json({ error: 'bad_request' }, 400, origin)

  // The auditor, an Admin of the account, or the service role.
  const auth = req.headers.get('Authorization') ?? ''
  const isService = jwtRole(auth) === 'service_role' || auth === `Bearer ${serviceKey}`
  let caller: { id: string; account_id: string; role: string } | null = null
  if (!isService) {
    if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user?.id) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('id, account_id, role').eq('id', u.user.id).maybeSingle()
    if (!p) return json({ error: 'unauthorized' }, 401, origin)
    caller = p as Any
  }

  const { data: audit } = await svc.from('site_audits_v2').select('*, location:locations(name)').eq('id', auditId).maybeSingle()
  const a = audit as Any
  if (!a || (caller && !(caller.account_id === a.account_id && (caller.id === a.auditor_id || caller.role === 'owner')))) {
    return json({ error: 'not_found' }, 404, origin)
  }
  if (a.status !== 'submitted') return json({ error: 'not_submitted' }, 409, origin)

  // check: true reads back what happened to the last send (accepted is not delivered).
  if (body.check) {
    const r = a.notify_result ?? {}
    const out: Any = { notified_at: a.notified_at }
    const emailId = r.email?.id
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (emailId && resendKey) {
      const er = await fetch(`https://api.resend.com/emails/${emailId}`, { headers: { Authorization: `Bearer ${resendKey}` } })
      const ed = await er.json().catch(() => null)
      out.email = { to: ed?.to, from: ed?.from, subject: ed?.subject, last_event: ed?.last_event, created_at: ed?.created_at, http: er.status, error: er.ok ? undefined : ed }
    }
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const keySid = Deno.env.get('TWILIO_API_KEY_SID')
    const keySecret = Deno.env.get('TWILIO_API_KEY_SECRET')
    out.sms = []
    for (const s of (r.sms ?? []) as Any[]) {
      if (!s?.sid || !accountSid || !keySid || !keySecret) continue
      const tr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${s.sid}.json`, { headers: { Authorization: 'Basic ' + btoa(`${keySid}:${keySecret}`) } })
      const td = await tr.json().catch(() => null)
      out.sms.push({ to: td?.to, from: td?.from, status: td?.status, error_code: td?.error_code, error_message: td?.error_message, date_sent: td?.date_sent, http: tr.status })
    }
    // The account's recent texts (no bodies), to tell a filtered message from a blocked sender.
    if (accountSid && keySid && keySecret) {
      const lr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?PageSize=15`, { headers: { Authorization: 'Basic ' + btoa(`${keySid}:${keySecret}`) } })
      const ld = await lr.json().catch(() => null)
      out.recent = ((ld?.messages ?? []) as Any[]).map((m) => ({
        to: String(m.to ?? '').slice(-4), from: m.from, status: m.status, error_code: m.error_code, date: m.date_created,
        has_link: /https?:\/\//.test(String(m.body ?? '')), chars: String(m.body ?? '').length,
      }))
    }
    return json(out, 200, origin)
  }

  // Claim the send, so two calls can't both send it.
  if (!body.resend) {
    const { data: claimed } = await svc.from('site_audits_v2').update({ notified_at: new Date().toISOString() }).eq('id', auditId).is('notified_at', null).select('id')
    if (!claimed?.length) return json({ ok: true, already: true, notified_at: a.notified_at }, 200, origin)
  }

  const answers = normalizeAnswers(a.answers)
  const site = String(a.location?.name ?? '').trim()
  const o = outcome(a, answers)
  const link = `${APP}/app/site-audits-new/${a.id}`

  // ---- Email ---- (smsOnly with resend keeps the earlier email result)
  let email: Any = body.smsOnly ? (a.notify_result?.email ?? { ok: false, skipped: true }) : { ok: false, error: 'no_key' }
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey && !body.smsOnly) {
    let pdf: string | null = null
    let pdfError: string | null = null
    try { pdf = await buildPdf(svc, a, answers, site, o) } catch (e) { pdfError = e instanceof Error ? e.message : String(e) }
    const color = o.tone === 'ok' ? '#15803d' : o.tone === 'warn' ? '#a16207' : '#b91c1c'
    const bg = o.tone === 'ok' ? '#dcfce7' : o.tone === 'warn' ? '#fef9c3' : '#fee2e2'
    const list = (title: string, items: string[], c: string) => items.length
      ? `<p style="margin:16px 0 4px;font-size:14px;font-weight:600;color:${c};">${esc(title)}</p><ul style="margin:0;padding-left:18px;font-size:14px;">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : ''
    const rows: [string, string][] = [['Site', site || '-'], ['Auditor', a.auditor_name ?? '-'], ['Submitted', central(a.submitted_at)]]
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;font-size:20px;">Site Audit${site ? ': ' + esc(site) : ''}</h2>
        <div style="border:1px solid ${color};background:${bg};border-radius:6px;padding:12px 16px;margin:0 0 16px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:${color};">${esc(o.title.replace(/\s+/g, ' '))}</p>
          <p style="margin:4px 0 0;font-size:14px;">${esc(o.detail)}</p>
        </div>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          ${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(v)}</td></tr>`).join('')}
        </table>
        ${list('Failed (red)', o.failedItems, '#b91c1c')}
        ${list('Needs attention (yellow)', o.warnItems, '#a16207')}
        <p style="margin:20px 0 0;font-size:14px;">${pdf ? 'The full audit is attached as a PDF, with comments and photos under each item.' : 'The PDF could not be built this time (' + esc(pdfError) + '); open the audit in Operator instead.'}</p>
        <p style="margin:16px 0 0;"><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;">Open in Operator</a></p>
        <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
      </div>`
    try {
      const resend = new Resend(resendKey)
      const { data, error } = await resend.emails.send({
        from: Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>',
        to: EMAIL_TO,
        subject: `Site Audit${site ? ': ' + site : ''} · ${o.short}`,
        html,
        ...(pdf ? { attachments: [{ filename: `site-audit-${(site || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`, content: pdf }] } : {}),
      })
      email = error ? { ok: false, to: EMAIL_TO, error: (error as Any).message ?? 'send_failed' } : { ok: true, to: EMAIL_TO, id: (data as Any)?.id, pdf: !!pdf, pdfError }
    } catch (e) {
      email = { ok: false, to: EMAIL_TO, error: e instanceof Error ? e.message : 'send_failed' }
    }
  }

  // ---- Text ----
  // No link: carriers filtered the first one that had a link (Twilio 30007), while
  // this sender's link-free texts all deliver. The email has the link.
  const reds = o.failedItems.length ? ` Red: ${o.failedItems.join(', ')}.` : ''
  const text = `Site Audit: ${site || 'site'}. ${o.short}.${reds} By ${a.auditor_name ?? 'unknown'}. Full PDF report emailed.`
  const sms = await Promise.all(SMS_TO.map((to) => sendSms(to, text)))

  const anySent = email.ok || sms.some((s) => s.ok)
  const result = { email, sms, at: new Date().toISOString() }
  // Nothing went out: free the claim so the app (or a person) can try again.
  await svc.from('site_audits_v2').update({ notify_result: result, ...(anySent ? {} : { notified_at: null }) }).eq('id', auditId)
  return json({ ok: anySent, ...result }, anySent ? 200 : 502, origin)
})
