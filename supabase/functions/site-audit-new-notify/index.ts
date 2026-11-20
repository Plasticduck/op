// site-audit-new-notify — Supabase Edge Function (Deno).
// When a Site Audit is submitted, emails its PDF (grade, every item, comments,
// photos) and texts a one-line result. Live since 2026-11-20 (it was Kevan-only
// while the graded audit was Site Audit NEW): see recipients() for who.
//
// Body: { audit_id, event?, resend?, smsOnly?, emailOnly?, check?, preview?, test?, dryRun? }.
// Sends once per audit: the row's notified_at is claimed before sending, so a retry
// or a second tab doesn't send it again; resend: true sends it again anyway (smsOnly /
// emailOnly: just one). check: true reads back delivery from Resend and Twilio
// (accepted is not delivered); preview: true returns the PDF (base64) and how each
// photo was read, sending nothing. test: true sends only to Kevan (his email and
// phone), without claiming the send. dryRun: true returns who it would go to and
// the text, sending nothing.
//
// event: 'acknowledged' is the follow-up (migration 0248): once the site's Regional
// Manager (or an Admin) marks the audit complete, an email (their answers and the
// final PDF) and a text say so, to the same people. Claims ack_notified_at the same
// way, so it goes once.
//
// Only Mighty Wash's audits are sent: the recipients are theirs.
//
// Auth: the audit's auditor, an Admin (owner) of its account, or the service role;
// for the acknowledged text, also the person who completed it.
// Secrets: RESEND_API_KEY (optional RESEND_FROM) for email; TWILIO_ACCOUNT_SID,
// TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET and TWILIO_MESSAGING_SERVICE_SID or
// TWILIO_FROM for the text. Either one missing just skips that channel.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'
import { jsPDF } from 'npm:jspdf@4.2.1'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'
import { SECTIONS, fmtPoints, gradeTone, normalizeAnswers, renderAuditNew, sectionStatus, type Answer } from './report.ts'
import { openWorkOrdersForSite } from '../_shared/maintainx_site.ts'

// deno-lint-ignore no-explicit-any
type Any = any

// Who hears about an audit (Kevan, 2026-11-20): the people the earlier Site Audits
// emailed (email-site-audit): this leadership list, the site's own mailbox (MW05 ->
// mw05@mighty-wash.com) and the site's Regional Manager this quarter. Texts go to
// those of them whose Operator login has a phone and is signed up for texts, looked
// up at send time, so anyone who signs up later starts getting them.
const LEADERSHIP = [
  'kjowers@mighty-wash.com', 'jay@mighty-wash.com', 'staci@mymightywash.com',
  'kstaton@mighty-wash.com', 'debra@mighty-wash.com', 'justin.gamboa@mighty-wash.com',
  'zachary@mighty-wash.com', 'ernest@mighty-wash.com', 'lkeith@mighty-wash.com',
]
const TEST_EMAIL = ['kjowers@mighty-wash.com']
const TEST_SMS = [{ to: '+19408676366', name: 'Kevan Jowers' }]
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

// Times in Central, where the audits are reviewed (the worker runs in UTC). Intl
// puts a narrow no-break space before AM/PM, which the PDF font can't draw (it
// spaced out the whole line), so it becomes a plain space.
const central = (d: string | Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d)).replace(/[\u202f\u00a0]/g, ' ')
const centralDate = (d: string | Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(d))

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

// Where the RM's acknowledgement stands, for the PDF (as the app's PDF shows it).
function followUpFor(audit: Any, answers: Record<string, Answer>) {
  const reds = SECTIONS.flatMap((s) => s.items.map((it) => ({ key: `${s.id}.${it.id}`, section: s.title, label: it.label })))
    .filter((r) => answers[r.key]?.value === 'fail')
  if (audit.review_status === 'needs_attention') {
    return {
      title: 'Follow-up', note: 'Needs attention', tone: 'danger' as const,
      message: reds.length
        ? `Waiting on the site's Regional Manager to answer ${reds.length} red item${reds.length === 1 ? '' : 's'} and mark the audit complete.`
        : "Nothing red. Waiting on the site's Regional Manager to acknowledge it.",
    }
  }
  if (audit.review_status !== 'complete') return null
  if (!audit.completed_by_name) {
    return { title: 'Follow-up', note: 'Complete', tone: 'ok' as const, message: 'No red items, so no Regional Manager follow-up was needed.' }
  }
  const role = audit.completed_role === 'admin' ? 'Admin' : 'Regional Manager'
  const responses = (audit.rm_responses ?? {}) as Record<string, string>
  const rows = [
    ...reds.map((r) => [`${r.section}\n${r.label}`, answers[r.key].comments.trim() || '-', responses[r.key] || '-']),
    ...(audit.rm_note ? [['Note', '', String(audit.rm_note)]] : []),
  ]
  return {
    title: role === 'Admin' ? 'Follow-up' : 'Regional Manager response',
    note: `Complete. Acknowledged by ${audit.completed_by_name} (${role})${audit.completed_at ? ' on ' + central(audit.completed_at) : ''}.`,
    tone: 'ok' as const,
    message: reds.length ? undefined : 'Nothing was red on this audit.',
    rows,
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
    workOrders: audit.work_orders ?? null,
    followUp: followUpFor(audit, answers),
    fmtDate: centralDate,
    fmtDateTime: (iso) => central(iso),
  })
  return {
    pdf: encodeBase64(new Uint8Array(doc.output('arraybuffer'))),
    photos: paths.map((p) => ({ path: p.split('/').slice(-2).join('/'), how: photoImages[p]?.how ?? 'missing' })),
  }
}

// One line in the email about the open work orders (the PDF has the list).
function woLine(wo: Any, site: string): string {
  if (!wo) return ''
  const p = (t: string) => `<p style="margin:16px 0 0;font-size:14px;">${esc(t)}</p>`
  if (wo.error) return p('Open work orders: MaintainX could not be reached when this was sent.')
  if (!wo.matched) return p(`Open work orders: ${site || 'this site'} isn't set up in MaintainX.`)
  const list: Any[] = wo.workOrders ?? []
  if (!list.length) return p(`No open work orders at ${site || 'this site'} in MaintainX.`)
  const high = list.filter((w) => w.priority === 'HIGH').length
  return p(`${list.length} open work order${list.length === 1 ? '' : 's'} at ${site || 'this site'} in MaintainX${high ? ` (${high} high priority)` : ''}, listed at the end of the PDF.`)
}

const e164 = (raw: unknown): string | null => {
  const s = String(raw ?? '').trim()
  const d = s.replace(/\D/g, '')
  if (s.startsWith('+') && d.length >= 11) return '+' + d
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}

type Recipients = {
  emails: string[]
  sms: { to: string; name: string }[]
  rm: { name: string; email: string | null } | null
}

// The emails (leadership, the site's mailbox, its RM) and, for those with an
// Operator login that has a phone and is signed up for texts, the texts.
async function recipients(svc: Any, a: Any, site: string): Promise<Recipients> {
  const { data: map } = await svc.rpc('site_audit_v2_rm_map', { p_account: a.account_id })
  const m = ((map ?? []) as Any[]).find((x) => x.location_id === a.location_id)
  let rm: Recipients['rm'] = null
  if (m?.user_id) {
    const { data: u } = await svc.from('users').select('name, email').eq('id', m.user_id).maybeSingle()
    rm = { name: String(u?.name ?? m.name ?? ''), email: u?.email ? String(u.email).toLowerCase() : null }
  }
  const local = site.toLowerCase().replace(/[^a-z0-9]/g, '')
  const emails = [...new Set([...LEADERSHIP, ...(local ? [`${local}@mighty-wash.com`] : []), ...(rm?.email ? [rm.email] : [])])]

  const { data: people } = await svc.from('users').select('name, email, phone, sms_opt_in')
    .eq('account_id', a.account_id).eq('sms_opt_in', true).not('phone', 'is', null)
  const want = new Set(emails)
  const sms: Recipients['sms'] = []
  for (const p of (people ?? []) as Any[]) {
    const to = e164(p.phone)
    if (!to || !want.has(String(p.email ?? '').toLowerCase()) || sms.some((s) => s.to === to)) continue
    sms.push({ to, name: String(p.name ?? '') })
  }
  return { emails, sms, rm }
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

  let body: { audit_id?: string; event?: string; resend?: boolean; check?: boolean; smsOnly?: boolean; emailOnly?: boolean; preview?: boolean; test?: boolean; dryRun?: boolean } = {}
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

  const { data: audit } = await svc.from('site_audits_v2').select('*, location:locations(name, maintainx_id)').eq('id', auditId).maybeSingle()
  const a = audit as Any
  const isAck = body.event === 'acknowledged'
  if (body.event && !isAck) return json({ error: 'bad_request' }, 400, origin)
  if (!a || (caller && !(caller.account_id === a.account_id
    && (caller.id === a.auditor_id || caller.role === 'owner' || (isAck && !!a.completed_by && caller.id === a.completed_by))))) {
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
    const smsStatus = async (list: Any[]) => {
      const got: Any[] = []
      for (const s of list) {
        if (!s?.sid || !accountSid || !keySid || !keySecret) continue
        const tr = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${s.sid}.json`, { headers: { Authorization: 'Basic ' + btoa(`${keySid}:${keySecret}`) } })
        const td = await tr.json().catch(() => null)
        got.push({ to: td?.to, from: td?.from, status: td?.status, error_code: td?.error_code, error_message: td?.error_message, date_sent: td?.date_sent, http: tr.status })
      }
      return got
    }
    out.sms = await smsStatus((r.sms ?? []) as Any[])
    if (a.ack_notify_result) out.ack = { ack_notified_at: a.ack_notified_at, sms: await smsStatus((a.ack_notify_result.sms ?? []) as Any[]) }
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

  // Only Mighty Wash's audits go out: the recipients below are theirs.
  if (a.account_id !== MIGHTY_WASH) return json({ ok: true, skipped: 'not_mighty_wash' }, 200, origin)

  const answers = normalizeAnswers(a.answers)
  const site = String(a.location?.name ?? '').trim()
  const reds = Object.values(answers).filter((x) => x.value === 'fail').length
  const o = outcome(a, answers)
  const link = `${APP}/app/site-audits/${a.id}`
  const who = await recipients(svc, a, site)
  const emailTo = body.test ? TEST_EMAIL : who.emails
  const smsTo = body.test ? TEST_SMS : who.sms
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const pdfName = `site-audit-${(site || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`
  // Test sends (only to Kevan) don't claim the audit's real send.
  const claims = !body.resend && !body.test

  // ---- Acknowledged: the RM (or an Admin) marked it complete ----
  if (isAck) {
    if (a.review_status !== 'complete' || !a.completed_by) return json({ error: 'not_acknowledged' }, 409, origin)
    const by = `${a.completed_role === 'admin' ? 'Admin' : 'RM'} ${a.completed_by_name ?? 'unknown'}`
    const text = `Site Audit at ${site || 'site'} has been acknowledged by ${by}. ${reds ? `${reds} red item${reds === 1 ? '' : 's'} answered` : 'Nothing red'}; marked complete. Full PDF report emailed.`
    const subject = `Site Audit${site ? ': ' + site : ''} · Acknowledged by ${a.completed_by_name ?? 'unknown'}`
    if (body.dryRun) return json({ dryRun: true, event: 'acknowledged', email: { to: emailTo, subject }, sms: { to: smsTo, text } }, 200, origin)
    if (claims) {
      const { data: claimed } = await svc.from('site_audits_v2').update({ ack_notified_at: new Date().toISOString() }).eq('id', auditId).is('ack_notified_at', null).select('id')
      if (!claimed?.length) return json({ ok: true, already: true, ack_notified_at: a.ack_notified_at }, 200, origin)
    }

    let email: Any = body.smsOnly ? (a.ack_notify_result?.email ?? { ok: false, skipped: true }) : { ok: false, error: 'no_key' }
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (resendKey && !body.smsOnly) {
      let pdf: string | null = null
      let pdfError: string | null = null
      try { pdf = (await buildPdf(svc, a, answers, site, o)).pdf } catch (e) { pdfError = e instanceof Error ? e.message : String(e) }
      const responses = (a.rm_responses ?? {}) as Record<string, string>
      const answered = SECTIONS.flatMap((s) => s.items.map((it) => ({ key: `${s.id}.${it.id}`, label: `${s.title}: ${it.label}` })))
        .filter((r) => answers[r.key]?.value === 'fail')
        .map((r) => `<li style="margin:0 0 8px;"><b>${esc(r.label)}</b>${answers[r.key].comments.trim() ? `<br><span style="color:#666;">Auditor: ${esc(answers[r.key].comments.trim())}</span>` : ''}<br>Response: ${esc(responses[r.key] ?? '-')}</li>`)
      const role = a.completed_role === 'admin' ? 'an Admin' : 'the Regional Manager'
      const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;font-size:20px;">Site Audit acknowledged${site ? ': ' + esc(site) : ''}</h2>
        <div style="border:1px solid #15803d;background:#dcfce7;border-radius:6px;padding:12px 16px;margin:0 0 16px;">
          <p style="margin:0;font-size:16px;font-weight:700;color:#15803d;">Complete</p>
          <p style="margin:4px 0 0;font-size:14px;">Acknowledged by ${esc(a.completed_by_name ?? 'unknown')} (${role})${a.completed_at ? ' on ' + esc(central(a.completed_at)) : ''}.</p>
        </div>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          ${([['Site', site || '-'], ['Result', o.short], ['Auditor', a.auditor_name ?? '-'], ['Submitted', central(a.submitted_at)]] as [string, string][])
            .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(v)}</td></tr>`).join('')}
        </table>
        ${answered.length
          ? `<p style="margin:16px 0 6px;font-size:14px;font-weight:600;color:#b91c1c;">Red items and responses</p><ul style="margin:0;padding-left:18px;font-size:14px;">${answered.join('')}</ul>`
          : '<p style="margin:16px 0 0;font-size:14px;">Nothing was red on this audit.</p>'}
        ${a.rm_note ? `<p style="margin:12px 0 0;font-size:14px;"><b>Note:</b> ${esc(a.rm_note)}</p>` : ''}
        <p style="margin:20px 0 0;font-size:14px;">${pdf ? 'The final audit, with the responses, is attached as a PDF.' : 'The PDF could not be built this time (' + esc(pdfError) + '); open the audit in Operator instead.'}</p>
        <p style="margin:16px 0 0;"><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;">Open in Operator</a></p>
        <p style="margin:20px 0 0;color:#888;font-size:12px;">Sent from WashLyfe Operator.</p>
      </div>`
      try {
        const resend = new Resend(resendKey)
        const { data, error } = await resend.emails.send({
          from, to: emailTo, subject, html,
          ...(pdf ? { attachments: [{ filename: pdfName, content: pdf }] } : {}),
        })
        email = error ? { ok: false, to: emailTo, error: (error as Any).message ?? 'send_failed' } : { ok: true, to: emailTo, id: (data as Any)?.id, pdf: !!pdf, pdfError }
      } catch (e) {
        email = { ok: false, to: emailTo, error: e instanceof Error ? e.message : 'send_failed' }
      }
    }
    const sms = body.emailOnly ? ((a.ack_notify_result?.sms ?? []) as Any[]) : await Promise.all(smsTo.map((s) => sendSms(s.to, text)))
    const anySent = email.ok || sms.some((s) => s.ok)
    const result = { email, sms, test: !!body.test, at: new Date().toISOString() }
    if (!body.test) {
      await svc.from('site_audits_v2').update({ ack_notify_result: result, ...(anySent ? {} : { ack_notified_at: null }) }).eq('id', auditId)
    }
    return json({ ok: anySent, ...result }, anySent ? 200 : 502, origin)
  }

  // Every audit waits on the site's Regional Manager to acknowledge it (0256).
  const rmName = who.rm?.name || null
  const waiting = rmName
    ? `${esc(rmName)} (Regional Manager) to ${reds ? 'answer them and mark it complete' : 'acknowledge it'}`
    : `an Admin to ${reds ? 'answer them and mark it complete' : 'acknowledge it'}, since this site has no Regional Manager`
  const followUpHtml = `<p style="margin:16px 0 0;font-size:14px;"><b style="color:#b91c1c;">Needs attention.</b> ${reds ? `${reds} red item${reds === 1 ? '' : 's'}. ` : 'Nothing red. '}Waiting on ${waiting}, in Operator's Needs Attention tab.</p>`
  const followUpText = rmName ? ` Waiting on RM ${rmName}.` : ' Waiting on an Admin (no RM for this site).'

  // The site's open MaintainX work orders, saved on the audit the first time it's
  // sent (right after submit), so its PDF and report keep the list as it was then.
  // A failed try is saved too ({ error }) and tried again on the next send.
  const needWorkOrders = !a.work_orders || a.work_orders.error
  const takeWorkOrders = async (): Promise<Any> => {
    try {
      return await openWorkOrdersForSite({ name: site, maintainx_id: a.location?.maintainx_id ?? null })
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), site, fetchedAt: new Date().toISOString() }
    }
  }

  // No link: carriers filtered the first one that had a link (Twilio 30007), while
  // this sender's link-free texts all deliver. The email has the link.
  const redList = o.failedItems.length ? ` Red: ${o.failedItems.join(', ')}.` : ''
  const text = `Site Audit: ${site || 'site'}. ${o.short}.${redList}${followUpText} By ${a.auditor_name ?? 'unknown'}. Full PDF report emailed.`
  const subject = `Site Audit${site ? ': ' + site : ''} · ${o.short}`
  if (body.dryRun) return json({ dryRun: true, event: 'submitted', email: { to: emailTo, subject }, sms: { to: smsTo, text } }, 200, origin)

  // preview: true builds the emailed PDF and returns it, sending nothing (and
  // saving nothing).
  if (body.preview) {
    if (needWorkOrders) a.work_orders = await takeWorkOrders()
    const built = await buildPdf(svc, a, answers, site, o)
    return json(built, 200, origin)
  }

  // Claim the send, so two calls can't both send it.
  if (claims) {
    const { data: claimed } = await svc.from('site_audits_v2').update({ notified_at: new Date().toISOString() }).eq('id', auditId).is('notified_at', null).select('id')
    if (!claimed?.length) return json({ ok: true, already: true, notified_at: a.notified_at }, 200, origin)
  }

  if (needWorkOrders) {
    a.work_orders = await takeWorkOrders()
    await svc.from('site_audits_v2').update({ work_orders: a.work_orders }).eq('id', auditId)
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
        ${followUpHtml}
        ${woLine(a.work_orders, site)}
        <p style="margin:20px 0 0;font-size:14px;">${pdf ? 'The full audit is attached as a PDF, with comments and photos under each item.' : 'The PDF could not be built this time (' + esc(pdfError) + '); open the audit in Operator instead.'}</p>
        <p style="margin:16px 0 0;"><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;">Open in Operator</a></p>
        <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
      </div>`
    try {
      const resend = new Resend(resendKey)
      const { data, error } = await resend.emails.send({
        from, to: emailTo, subject, html,
        ...(pdf ? { attachments: [{ filename: pdfName, content: pdf }] } : {}),
      })
      email = error ? { ok: false, to: emailTo, error: (error as Any).message ?? 'send_failed' } : { ok: true, to: emailTo, id: (data as Any)?.id, pdf: !!pdf, pdfError, photos: photoNotes }
    } catch (e) {
      email = { ok: false, to: emailTo, error: e instanceof Error ? e.message : 'send_failed' }
    }
  }

  // ---- Text ---- (emailOnly with resend keeps the earlier text result)
  const sms = body.emailOnly ? ((a.notify_result?.sms ?? []) as Any[]) : await Promise.all(smsTo.map((s) => sendSms(s.to, text)))

  const anySent = email.ok || sms.some((s) => s.ok)
  const result = { email, sms, test: !!body.test, at: new Date().toISOString() }
  // Nothing went out: free the claim so the app (or a person) can try again.
  if (!body.test) {
    await svc.from('site_audits_v2').update({ notify_result: result, ...(anySent ? {} : { notified_at: null }) }).eq('id', auditId)
  }
  return json({ ok: anySent, ...result }, anySent ? 200 : 502, origin)
})
