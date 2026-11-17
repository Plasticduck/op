// site-audit-new-notify — Supabase Edge Function (Deno).
// When a Site Audit NEW is submitted, emails its PDF (grade, every item, comments,
// photos) and texts a one-line result. Pre-launch it goes only to Kevan (his
// request, 2026-11-17), not the old Site Audits list in email-site-audit.
//
// Body: { audit_id, resend?, smsOnly?, emailOnly?, check?, preview? }. Sends once per audit: the row's
// notified_at is claimed before sending, so a retry or a second tab doesn't send it
// again; resend: true sends it again anyway (smsOnly / emailOnly: just one). check: true
// reads back delivery from Resend and Twilio (accepted is not delivered); preview:
// true returns the PDF (base64) and how each photo was read, sending nothing.
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
// What a picture's bytes are, whatever its name or stated type says.
function sniff(b: Uint8Array): 'JPEG' | 'PNG' | 'WEBP' | 'GIF' | 'HEIC' | 'AVIF' | 'other' {
  if (b[0] === 0xff && b[1] === 0xd8) return 'JPEG'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'PNG'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'WEBP'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'GIF'
  const brand = String.fromCharCode(...b.slice(8, 12))
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return /avi/.test(brand) ? 'AVIF' : 'HEIC'
  return 'other'
}

type Fmt = 'JPEG' | 'PNG' | 'WEBP'
type Photo = { url: string; dataUrl: string | null; fmt: Fmt; w: number; h: number; how: string }

function webpSize(b: Uint8Array): { w: number; h: number } | null {
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (chunk === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff }
  if (chunk === 'VP8L') return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
  if (chunk === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  return null
}

// jsPDF reads JPEG, PNG and WebP. JPEG goes in as is; PNG and WebP are decoded,
// which costs CPU, so only small ones (the 400px thumbnails) are allowed.
function embeddable(bytes: Uint8Array, maxDecodeBytes = 600_000): { dataUrl: string; fmt: Fmt; w: number; h: number } | null {
  const kind = sniff(bytes)
  const d = kind === 'JPEG' ? jpegSize(bytes) : kind === 'PNG' ? pngSize(bytes) : kind === 'WEBP' ? webpSize(bytes) : null
  if (!d || d.w <= 0 || d.h <= 0) return null
  if (kind !== 'JPEG' && (bytes.length > maxDecodeBytes || d.w * d.h > 700_000)) return null
  const mime = kind === 'JPEG' ? 'image/jpeg' : kind === 'PNG' ? 'image/png' : 'image/webp'
  return { dataUrl: `data:${mime};base64,` + encodeBase64(bytes), fmt: kind as Fmt, ...d }
}

// A photo for the PDF, whatever format it was taken in. Storage's resizer makes a
// 400px thumbnail (plenty for the 28 mm the PDF draws) from any common format
// (JPEG, PNG, HEIC, WebP, GIF, AVIF, TIFF, BMP). It answers in the photo's own
// format unless the request says it takes WebP, so a PNG came back as PNG and the
// first version, which only took JPEG, dropped it (2026-11-17). So: ask for JPEG,
// take JPEG, PNG or WebP; if it's anything else, ask again for WebP. If the
// resizer fails, the original when it's a JPEG. Otherwise a placeholder that
// links to the photo. `how` records which way worked.
async function resolvePhoto(svc: Any, path: string): Promise<Photo | null> {
  const { data: full } = await svc.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 5)
  const url = full?.signedUrl ?? ''
  const notes: string[] = []
  try {
    const { data: thumb } = await svc.storage.from(BUCKET).createSignedUrl(path, 3600, { transform: { width: 400, height: 400, resize: 'contain', quality: 70 } })
    if (thumb?.signedUrl) {
      for (const accept of ['image/jpeg', 'image/webp']) {
        const r = await fetch(thumb.signedUrl, { headers: { Accept: accept } })
        if (!r.ok) { notes.push(`resize ${r.status}`); break }
        const bytes = new Uint8Array(await r.arrayBuffer())
        const e = embeddable(bytes)
        if (e) return { url, ...e, how: `resized (${e.fmt})` }
        notes.push(`resize gave ${sniff(bytes)} ${bytes.length}b`)
      }
    }
  } catch (e) { notes.push('resize error ' + (e instanceof Error ? e.message : String(e))) }
  try {
    const { data: blob, error } = await svc.storage.from(BUCKET).download(path)
    if (error) notes.push('download ' + error.message)
    else {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const e = embeddable(bytes, 250_000)
      if (e) return { url, ...e, how: `original (${e.fmt}); ${notes.join('; ')}` }
      notes.push(`original is ${sniff(bytes)} ${bytes.length}b`)
    }
  } catch (e) { notes.push('download error ' + (e instanceof Error ? e.message : String(e))) }
  return url ? { url, dataUrl: null, fmt: 'JPEG', w: 4, h: 3, how: 'link only: ' + notes.join('; ') } : null
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

async function buildPdf(svc: Any, audit: Any, answers: Record<string, Answer>, site: string, o: Outcome): Promise<{ pdf: string; photos: { path: string; how: string }[] }> {
  const photoImages: Record<string, Any> = {}
  const paths = Object.values(answers).flatMap((a) => a.photos)
  // Two at a time, to keep memory down on the worker.
  for (let i = 0; i < paths.length; i += 2) {
    const batch = paths.slice(i, i + 2)
    const got = await Promise.all(batch.map((p) => resolvePhoto(svc, p)))
    batch.forEach((p, j) => { if (got[j]) photoImages[p] = got[j] })
  }
  // The small logo: the full one is 1191x1842 and decoding it costs as much CPU
  // as several photos. A missing file on Vercel answers with the app's HTML, so
  // check it's really a PNG.
  let logo: Any = null
  if (audit.account_id === MIGHTY_WASH) {
    try {
      const lr = await fetch(APP + '/mw-logo-pdf.png')
      const lb = lr.ok ? new Uint8Array(await lr.arrayBuffer()) : null
      if (lb && sniff(lb) === 'PNG') { const d = pngSize(lb); logo = { dataUrl: 'data:image/png;base64,' + encodeBase64(lb), w: d.w, h: d.h } }
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
  return {
    pdf: encodeBase64(new Uint8Array(doc.output('arraybuffer'))),
    photos: paths.map((p) => ({ path: p.split('/').slice(-2).join('/'), how: photoImages[p]?.how ?? 'missing' })),
  }
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

  let body: { audit_id?: string; resend?: boolean; check?: boolean; smsOnly?: boolean; emailOnly?: boolean; preview?: boolean } = {}
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

  const answers = normalizeAnswers(a.answers)
  const site = String(a.location?.name ?? '').trim()
  const o = outcome(a, answers)
  const link = `${APP}/app/site-audits-new/${a.id}`

  // preview: true builds the emailed PDF and returns it, sending nothing.
  if (body.preview) {
    const built = await buildPdf(svc, a, answers, site, o)
    return json(built, 200, origin)
  }

  // Claim the send, so two calls can't both send it.
  if (!body.resend) {
    const { data: claimed } = await svc.from('site_audits_v2').update({ notified_at: new Date().toISOString() }).eq('id', auditId).is('notified_at', null).select('id')
    if (!claimed?.length) return json({ ok: true, already: true, notified_at: a.notified_at }, 200, origin)
  }

  // ---- Email ---- (smsOnly with resend keeps the earlier email result)
  let email: Any = body.smsOnly ? (a.notify_result?.email ?? { ok: false, skipped: true }) : { ok: false, error: 'no_key' }
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey && !body.smsOnly) {
    let pdf: string | null = null
    let pdfError: string | null = null
    let photoNotes: { path: string; how: string }[] = []
    try { const built = await buildPdf(svc, a, answers, site, o); pdf = built.pdf; photoNotes = built.photos } catch (e) { pdfError = e instanceof Error ? e.message : String(e) }
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
      email = error ? { ok: false, to: EMAIL_TO, error: (error as Any).message ?? 'send_failed' } : { ok: true, to: EMAIL_TO, id: (data as Any)?.id, pdf: !!pdf, pdfError, photos: photoNotes }
    } catch (e) {
      email = { ok: false, to: EMAIL_TO, error: e instanceof Error ? e.message : 'send_failed' }
    }
  }

  // ---- Text ----
  // No link: carriers filtered the first one that had a link (Twilio 30007), while
  // this sender's link-free texts all deliver. The email has the link.
  const reds = o.failedItems.length ? ` Red: ${o.failedItems.join(', ')}.` : ''
  const text = `Site Audit: ${site || 'site'}. ${o.short}.${reds} By ${a.auditor_name ?? 'unknown'}. Full PDF report emailed.`
  // emailOnly with resend keeps the earlier text result.
  const sms = body.emailOnly ? ((a.notify_result?.sms ?? []) as Any[]) : await Promise.all(SMS_TO.map((to) => sendSms(to, text)))

  const anySent = email.ok || sms.some((s) => s.ok)
  const result = { email, sms, at: new Date().toISOString() }
  // Nothing went out: free the claim so the app (or a person) can try again.
  await svc.from('site_audits_v2').update({ notify_result: result, ...(anySent ? {} : { notified_at: null }) }).eq('id', auditId)
  return json({ ok: anySent, ...result }, anySent ? 200 : 502, origin)
})
