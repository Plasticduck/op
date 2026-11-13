// purchase-requests — Supabase Edge Function (Deno).
// Finance > Purchase Request: every step after the draft, with Operator's
// e-signature engine (_shared/esign.ts, _shared/esign_pdf.ts).
//
// The app writes drafts itself (RLS). Everything that is part of the signed record
// happens here, with the service role, so timestamps, IP addresses and devices come
// from the server: sending, viewing, consent, signing, declining, voiding, paper
// signatures, completion and the sealed PDF.
//
// POST { action, ...}:
//   prepare   {request_id, signers[], cc[], sign_in_order}  -> the exact document + fingerprint to review
//   send      {...prepare, document_hash, signature, consent?, message?, save_signature?}  requester signs and sends
//   view      {request_id}                       records a signer's first view
//   sign      {request_id, envelope_id, document_hash, signature, consent?, save_signature?}
//   decline   {request_id, reason}
//   paper_request {request_id, note?}            a signer asks to sign on paper
//   paper_sign {request_id, recipient_id, file_base64, file_name, mime, signed_on?}  AP records it
//   void      {request_id, reason}                requester or AP
//   reopen    {request_id}                        requester, after a decline or void: back to draft
//   remind    {request_id}                        re-emails whoever's turn it is (once an hour)
//   purchased {request_id, po_number?, actual_amount?, note?}  AP
//   pdf       {request_id, envelope_id?}          sealed PDF link, or a marked copy while unfinished
//   consent / withdraw_consent / disclosure_pdf
//
// AP ("finance") = an owner or a finance-category user, as on Per Diem and Mileage.
// Auth: a signed-in user (owner, manager, technician). The service role may act
// as a user for checks ({as_user: email, no_email: true}); verify_jwt stays on, so
// the gateway has checked the token before the role is read.
// Secrets: RESEND_API_KEY (+ RESEND_FROM); ESIGN_SEAL_P12 + ESIGN_SEAL_P12_PASS (the seal).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'
import {
  type Consent, type Disclosure, type Envelope, type EsignEvent, type Recipient, type SignatureInput,
  activeOrder, allSigned, canonicalJson, clientIp, fromBase64, INTENT_TEXT, INTENT_VERSION, sha256Hex,
  toBase64, userAgent, usd, validSignature,
} from '../_shared/esign.ts'
import { addCertificate, addDisclosure, loadSealCert, newDoc, pdfBytes, sealPdf, stampPages } from '../_shared/esign_pdf.ts'
import { buildDocument, type Party, type PrDocument, type PrFile, prNumber, type PrRow, renderRequest, validate } from './doc.ts'
import { type EmailSummary, emailHtml } from './email.ts'

const APP_URL = 'https://operator.washlyfe.com'
const PAGE_URL = `${APP_URL}/app/purchase-requests`
const BUCKET = 'purchase-requests'
const PR_ROLES = new Set(['owner', 'manager', 'technician'])
const MAX_SIGNERS = 10
const MAX_CC = 10
const MEANING_SENDER = 'I submit this purchase request and certify that it is accurate and for a legitimate business purpose.'
const MEANING_APPROVER = 'I approve this purchase request.'

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

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message)
}

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

type Me = {
  id: string; account_id: string; role: string; role_category: string | null
  name: string; email: string; finance: boolean
}
type Ctx = {
  svc: SupabaseClient
  me: Me
  ip: string
  ua: string
  noEmail: boolean
  company: string
  brandLogo: string | null
}
// deno-lint-ignore no-explicit-any
type Body = Record<string, any>

const nowIso = () => new Date().toISOString()
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const uniq = (a: unknown): string[] => [...new Set((Array.isArray(a) ? a : []).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))]

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const auth = req.headers.get('Authorization') ?? ''
    let body: Body = {}
    try { body = await req.json() } catch { /* empty */ }

    const isService = jwtRole(auth) === 'service_role'
    let uid: string | null = null
    if (isService) {
      if (typeof body.as_user !== 'string') fail(400, 'as_user', 'as_user (an email) is required with the service role.')
      const { data } = await svc.from('users').select('id').ilike('email', body.as_user).maybeSingle()
      uid = data?.id ?? null
    } else {
      const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
      const { data: u } = await userClient.auth.getUser()
      uid = u.user?.id ?? null
    }
    if (!uid) return json({ error: 'unauthorized', message: 'Sign in again.' }, 401)
    const { data: p } = await svc.from('users').select('id, account_id, role, role_category, name, email').eq('id', uid).maybeSingle()
    if (!p || !PR_ROLES.has(p.role) || p.role_category === 'corporate_display') {
      return json({ error: 'forbidden', message: "Your login can't use purchase requests." }, 403)
    }
    const { data: acct } = await svc.from('accounts').select('name, brand_logo_url').eq('id', p.account_id).maybeSingle()
    const ctx: Ctx = {
      svc,
      me: { ...p, finance: p.role === 'owner' || p.role_category === 'finance' } as Me,
      ip: clientIp(req),
      ua: userAgent(req),
      noEmail: isService && body.no_email === true,
      company: acct?.name ?? 'Your company',
      brandLogo: acct?.brand_logo_url ?? null,
    }

    switch (body.action) {
      case 'prepare': return json(await prepare(ctx, body))
      case 'send': return json(await send(ctx, body))
      case 'view': return json(await view(ctx, body))
      case 'sign': return json(await sign(ctx, body))
      case 'decline': return json(await decline(ctx, body))
      case 'paper_request': return json(await paperRequest(ctx, body))
      case 'paper_sign': return json(await paperSign(ctx, body))
      case 'void': return json(await voidIt(ctx, body))
      case 'reopen': return json(await reopen(ctx, body))
      case 'remind': return json(await remind(ctx, body))
      case 'purchased': return json(await purchased(ctx, body))
      case 'pdf': return json(await pdf(ctx, body))
      case 'consent': return json(await consentAction(ctx, body))
      case 'withdraw_consent': return json(await withdrawConsent(ctx))
      case 'disclosure_pdf': return json(await disclosurePdf(ctx))
      default: fail(400, 'bad_action', 'Unknown action.')
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status)
    console.error('[purchase-requests]', e)
    return json({ error: 'failed', message: 'Something went wrong on our side. Try again in a moment.' }, 500)
  }
})

// ------------------------------------------------------------------ loading

async function loadRequest(ctx: Ctx, id: unknown): Promise<PrRow> {
  if (typeof id !== 'string') fail(400, 'request_id', 'request_id is required.')
  const { data } = await ctx.svc.from('purchase_requests').select('*').eq('id', id).eq('account_id', ctx.me.account_id).maybeSingle()
  if (!data) fail(404, 'not_found', "That purchase request doesn't exist.")
  return data as PrRow
}

async function envelopesOf(ctx: Ctx, prId: string): Promise<{ id: string }[]> {
  const { data } = await ctx.svc.from('esign_envelopes').select('id').eq('source_type', 'purchase_request').eq('source_id', prId)
  return data ?? []
}

async function canView(ctx: Ctx, pr: PrRow): Promise<boolean> {
  if (pr.requester_id === ctx.me.id || ctx.me.finance) return true
  const envs = await envelopesOf(ctx, pr.id)
  if (!envs.length) return false
  const { count } = await ctx.svc.from('esign_recipients').select('id', { count: 'exact', head: true })
    .eq('user_id', ctx.me.id).in('envelope_id', envs.map((e) => e.id))
  return (count ?? 0) > 0
}

async function loadEnvelope(ctx: Ctx, id: string | null): Promise<Envelope> {
  if (!id) fail(409, 'no_envelope', 'This request has not been sent for signature.')
  const { data } = await ctx.svc.from('esign_envelopes').select('*').eq('id', id).eq('account_id', ctx.me.account_id).maybeSingle()
  if (!data) fail(404, 'no_envelope', 'The signing record was not found.')
  return data as Envelope
}

async function loadRecipients(ctx: Ctx, envId: string): Promise<Recipient[]> {
  const { data } = await ctx.svc.from('esign_recipients').select('*').eq('envelope_id', envId).order('routing_order').order('created_at')
  return (data ?? []) as Recipient[]
}

async function loadEvents(ctx: Ctx, envId: string): Promise<EsignEvent[]> {
  const { data } = await ctx.svc.from('esign_events').select('*').eq('envelope_id', envId).order('id')
  return (data ?? []) as EsignEvent[]
}

async function logEvent(ctx: Ctx, env: Pick<Envelope, 'id' | 'account_id'>, event: string, o: {
  recipient?: Pick<Recipient, 'id'> | null
  detail?: Record<string, unknown>
  system?: boolean
} = {}) {
  const { error } = await ctx.svc.from('esign_events').insert({
    envelope_id: env.id,
    account_id: env.account_id,
    recipient_id: o.recipient?.id ?? null,
    actor_user_id: o.system ? null : ctx.me.id,
    actor_name: o.system ? null : ctx.me.name,
    actor_email: o.system ? null : ctx.me.email,
    event,
    ip: o.system ? null : ctx.ip,
    user_agent: o.system ? null : ctx.ua,
    detail: o.detail ?? {},
  })
  if (error) throw new Error(`audit event ${event}: ${error.message}`)
}

async function activeDisclosure(ctx: Ctx): Promise<Disclosure> {
  const { data } = await ctx.svc.from('esign_disclosures').select('version, title, body, body_sha256')
    .eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) fail(503, 'no_disclosure', 'E-signature is not set up yet.')
  return data as Disclosure
}

async function currentConsent(ctx: Ctx, version: string): Promise<Consent | null> {
  const { data } = await ctx.svc.from('esign_consents').select('*').eq('user_id', ctx.me.id)
    .eq('disclosure_version', version).is('withdrawn_at', null).order('consented_at', { ascending: false }).limit(1).maybeSingle()
  return (data as Consent | null) ?? null
}

// The signer must have accepted the current disclosure, or accept it with this
// request. Returns the consent and whether it was given just now.
async function ensureConsent(ctx: Ctx, given: unknown): Promise<{ consent: Consent; isNew: boolean }> {
  const d = await activeDisclosure(ctx)
  const existing = await currentConsent(ctx, d.version)
  if (existing) return { consent: existing, isNew: false }
  const g = given as { version?: string; accept?: boolean } | null
  if (!g || g.accept !== true || g.version !== d.version) {
    fail(428, 'consent_required', 'Read and accept the Electronic Record and Signature Disclosure before you sign.')
  }
  const { data, error } = await ctx.svc.from('esign_consents').insert({
    account_id: ctx.me.account_id, user_id: ctx.me.id, user_name: ctx.me.name, user_email: ctx.me.email,
    disclosure_version: d.version, disclosure_sha256: d.body_sha256, ip: ctx.ip, user_agent: ctx.ua,
  }).select('*').single()
  if (error) throw new Error(`consent: ${error.message}`)
  return { consent: data as Consent, isNew: true }
}

async function saveSignature(ctx: Ctx, s: SignatureInput) {
  await ctx.svc.from('esign_saved_signatures').upsert({
    user_id: ctx.me.id, kind: s.kind, image: s.image, typed_name: s.name.trim(), updated_at: nowIso(),
  })
}

function summaryOf(pr: PrRow): EmailSummary {
  return {
    number: prNumber(pr.number), title: pr.title, vendor: pr.vendor ?? '', site: pr.site ?? '',
    total: pr.total, requester: pr.requester_name,
  }
}

async function notify(ctx: Ctx, userIds: (string | null)[], pr: PrRow, text: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))]
  if (!ids.length) return
  await ctx.svc.from('notifications').insert(ids.map((user_id) => ({
    user_id, kind: 'purchase_request', payload: { request_id: pr.id, number: prNumber(pr.number), text },
  })))
}

async function sendEmail(ctx: Ctx, o: {
  to: string[]
  subject: string
  html: string
  attachments?: { filename: string; content: string }[]
}): Promise<string | null> {
  const to = [...new Set(o.to.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (!to.length || ctx.noEmail) return null
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) { console.error('[purchase-requests] RESEND_API_KEY missing; email skipped'); return null }
  try {
    const resend = new Resend(key)
    const { data, error } = await resend.emails.send({
      from: Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>',
      to, subject: o.subject, html: o.html, attachments: o.attachments,
    })
    if (error) { console.error('[purchase-requests] email failed:', error.message); return null }
    return data?.id ?? null
  } catch (e) {
    console.error('[purchase-requests] email failed:', String((e as Error)?.message ?? e))
    return null
  }
}

const link = (pr: PrRow) => `${PAGE_URL}?r=${pr.id}`

// ------------------------------------------------------------------ compose

type Composed = {
  document: PrDocument
  hash: string
  version: number
  signers: Party[]
  cc: Party[]
  files: PrFile[]
  signInOrder: boolean
}

// Works out exactly what will be signed: the request, its files (fingerprinted
// here, from storage), and who signs, including anyone an approval rule requires.
async function compose(ctx: Ctx, pr: PrRow, body: Body): Promise<Composed> {
  const { svc, me } = ctx
  if (pr.requester_id !== me.id) fail(403, 'not_yours', 'Only the person who wrote this request can send it.')
  if (pr.status !== 'draft') fail(409, 'not_draft', 'This request has already been sent.')
  const problems = validate(pr)
  if (problems.length) fail(422, 'incomplete', problems.join(' '))

  const picked = uniq(body.signers)
  if (picked.includes(me.id)) fail(422, 'self_approval', "You can't approve your own request. Pick someone else to approve it.")
  const { data: rules } = await svc.from('purchase_approval_rules').select('id, label, min_amount, category, signer_ids, sort_order')
    .eq('account_id', me.account_id).eq('active', true).order('sort_order').order('min_amount')
  const ruleOf = new Map<string, string>()
  const required: string[] = []
  for (const r of rules ?? []) {
    if (Number(pr.total) < Number(r.min_amount)) continue
    if (r.category && r.category !== pr.category) continue
    const label = r.label?.trim() || `${usd(r.min_amount)} and over${r.category ? `, ${r.category}` : ''}`
    for (const sid of (r.signer_ids ?? []) as string[]) {
      if (sid === me.id) continue
      if (!ruleOf.has(sid)) ruleOf.set(sid, label)
      if (!picked.includes(sid) && !required.includes(sid)) required.push(sid)
    }
  }
  const signerIds = [...picked, ...required]
  const ccIds = uniq(body.cc).filter((id) => !signerIds.includes(id) && id !== me.id)
  if (!signerIds.length) fail(422, 'no_signers', 'Add at least one approver.')
  if (signerIds.length > MAX_SIGNERS) fail(422, 'too_many', `Up to ${MAX_SIGNERS} approvers.`)
  if (ccIds.length > MAX_CC) fail(422, 'too_many', `Up to ${MAX_CC} people can get a copy.`)

  const { data: users } = await svc.from('users').select('id, name, email, role, role_category, account_id').in('id', [...signerIds, ...ccIds])
  const byId = new Map((users ?? []).map((u) => [u.id as string, u]))
  const party = (id: string): Party => {
    const u = byId.get(id)!
    return { user_id: id, name: u.name, email: u.email, required_by_rule: ruleOf.get(id) ?? null }
  }
  for (const id of signerIds) {
    const u = byId.get(id)
    if (!u || u.account_id !== me.account_id || !PR_ROLES.has(u.role) || u.role_category === 'corporate_display') {
      fail(422, 'bad_signer', `${u?.name ?? 'One of the approvers'} can't sign purchase requests.`)
    }
  }
  for (const id of ccIds) {
    const u = byId.get(id)
    if (!u || u.account_id !== me.account_id) fail(422, 'bad_cc', 'One of the people getting a copy is not on this account.')
  }

  const files = await fingerprintFiles(ctx, pr)
  const envs = await envelopesOf(ctx, pr.id)
  const version = envs.length + 1
  const signInOrder = body.sign_in_order !== false
  const document = buildDocument({
    pr, company: ctx.company, version, files,
    signers: signerIds.map(party), cc: ccIds.map(party), signInOrder,
  })
  return { document, hash: await sha256Hex(canonicalJson(document)), version, signers: signerIds.map(party), cc: ccIds.map(party), files, signInOrder }
}

// Fingerprints each attachment from the stored bytes; never trusts the browser's.
async function fingerprintFiles(ctx: Ctx, pr: PrRow): Promise<PrFile[]> {
  const { data } = await ctx.svc.from('purchase_request_files').select('id, name, size, sha256, path, locked')
    .eq('request_id', pr.id).eq('kind', 'attachment').is('removed_at', null).order('created_at')
  const out: PrFile[] = []
  for (const f of data ?? []) {
    if (f.locked && f.sha256) { out.push(f); continue }
    const { data: blob, error } = await ctx.svc.storage.from(BUCKET).download(f.path)
    if (error || !blob) fail(409, 'file_missing', `The attachment ${f.name} could not be read. Remove it and add it again.`)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const sha256 = await sha256Hex(bytes)
    await ctx.svc.from('purchase_request_files').update({ sha256, size: bytes.length }).eq('id', f.id)
    out.push({ ...f, sha256, size: bytes.length })
  }
  return out
}

async function prepare(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  const c = await compose(ctx, pr, body)
  const d = await activeDisclosure(ctx)
  const consent = await currentConsent(ctx, d.version)
  return {
    document: c.document,
    document_hash: c.hash,
    signers: c.signers,
    cc: c.cc,
    needs_consent: !consent,
    disclosure_version: d.version,
    intent: INTENT_TEXT,
    meaning: MEANING_SENDER,
  }
}

// ---------------------------------------------------------------------- send

async function send(ctx: Ctx, body: Body) {
  const { svc, me } = ctx
  const pr = await loadRequest(ctx, body.request_id)
  const c = await compose(ctx, pr, body)
  if (body.document_hash !== c.hash) {
    fail(409, 'changed', 'This request changed since you reviewed it. Review it again before you sign.')
  }
  if (!validSignature(body.signature)) fail(422, 'bad_signature', 'Draw or type your signature first.')
  const sig = body.signature as SignatureInput
  const { consent, isNew } = await ensureConsent(ctx, body.consent)
  const sigSha = await sha256Hex(fromBase64(sig.image.split(',')[1]))

  const { data: envRow, error: envErr } = await svc.from('esign_envelopes').insert({
    account_id: me.account_id,
    source_type: 'purchase_request',
    source_id: pr.id,
    version: c.version,
    title: `${prNumber(pr.number)}: ${pr.title}`.slice(0, 300),
    message: str(body.message, 2000) || null,
    document: c.document,
    document_hash: c.hash,
    sign_in_order: c.signInOrder,
    created_by: me.id,
    created_by_name: me.name,
    created_by_email: me.email,
    created_ip: ctx.ip,
    created_user_agent: ctx.ua,
  }).select('*').single()
  if (envErr) throw new Error(`envelope: ${envErr.message}`)
  const env = envRow as Envelope

  try {
    const now = nowIso()
    const n = c.signers.length
    const lastOrder = c.signInOrder ? n : 1
    const rows = [
      {
        envelope_id: env.id, account_id: me.account_id, user_id: me.id, name: me.name, email: me.email,
        role: 'sender', label: 'Requested by', routing_order: 0, status: 'signed',
        sent_at: now, viewed_at: now, signed_at: now,
        signature_kind: sig.kind, signature_image: sig.image, signature_name: sig.name.trim(), signature_sha256: sigSha,
        signed_document_hash: c.hash, consent_id: consent.id, ip: ctx.ip, user_agent: ctx.ua,
      },
      ...c.signers.map((s, i) => ({
        envelope_id: env.id, account_id: me.account_id, user_id: s.user_id, name: s.name, email: s.email,
        role: 'signer', label: n > 1 ? `Approver ${i + 1} of ${n}` : 'Approver',
        routing_order: c.signInOrder ? i + 1 : 1, required_by_rule: s.required_by_rule ?? null, status: 'waiting',
      })),
      ...c.cc.map((s) => ({
        envelope_id: env.id, account_id: me.account_id, user_id: s.user_id, name: s.name, email: s.email,
        role: 'cc', label: 'Copy', routing_order: lastOrder + 1, status: 'waiting',
      })),
    ]
    const { data: inserted, error: rErr } = await svc.from('esign_recipients').insert(rows).select('id, role')
    if (rErr) throw new Error(`recipients: ${rErr.message}`)
    const sender = inserted!.find((r) => r.role === 'sender')!

    await logEvent(ctx, env, 'created', { detail: { version: c.version, document_hash: c.hash, signers: c.signers.length, cc: c.cc.length, sign_in_order: c.signInOrder } })
    if (isNew) await logEvent(ctx, env, 'consent', { recipient: sender, detail: { consent_id: consent.id, version: consent.disclosure_version } })
    await logEvent(ctx, env, 'signed', {
      recipient: sender,
      detail: { meaning: MEANING_SENDER, intent: INTENT_TEXT, intent_version: INTENT_VERSION, document_hash: c.hash, signature_kind: sig.kind, signature_sha256: sigSha },
    })
    if (c.files.length) {
      await svc.from('purchase_request_files').update({ locked: true }).in('id', c.files.map((f) => f.id))
    }
    const { error: pErr } = await svc.from('purchase_requests').update({
      status: 'pending', envelope_id: env.id, ever_sent: true, submitted_at: now, approved_at: null, closed_at: null,
    }).eq('id', pr.id).eq('status', 'draft')
    if (pErr) throw new Error(`request: ${pErr.message}`)
    if (body.save_signature) await saveSignature(ctx, sig)
  } catch (e) {
    await svc.from('esign_envelopes').update({ status: 'voided', voided_at: nowIso(), void_reason: 'Sending failed; nothing was sent.' }).eq('id', env.id)
    throw e
  }

  const fresh = await loadRequest(ctx, pr.id)
  await advance(ctx, fresh, env)
  return { ok: true, envelope_id: env.id }
}

// Moves an envelope along after a signature: sends it to the next routing step,
// or completes it once everyone has signed. Safe to run twice at once: each
// change is conditional, so only one caller acts.
async function advance(ctx: Ctx, pr: PrRow, env: Envelope) {
  const rs = await loadRecipients(ctx, env.id)
  if (allSigned(rs)) return complete(ctx, pr, env)
  const order = activeOrder(rs)
  if (order === null) return
  const { data: woken } = await ctx.svc.from('esign_recipients').update({ status: 'sent', sent_at: nowIso() })
    .eq('envelope_id', env.id).eq('role', 'signer').eq('routing_order', order).eq('status', 'waiting').select('*')
  for (const r of (woken ?? []) as Recipient[]) {
    const emailId = await sendEmail(ctx, {
      to: [r.email],
      subject: `Please sign: ${prNumber(pr.number)} ${pr.title} (${usd(pr.total)})`,
      html: emailHtml({
        heading: `${pr.requester_name} needs your approval`,
        intro: `${prNumber(pr.number)} is ready for your signature. Review it in Operator, then sign or decline.`,
        summary: summaryOf(pr),
        note: env.message ?? undefined,
        button: { label: 'Review and sign', url: link(pr) },
      }),
    })
    await logEvent(ctx, env, 'sent', { recipient: r, system: true, detail: { to: r.name, email: r.email, email_id: emailId } })
    await notify(ctx, [r.user_id], pr, `${pr.requester_name} needs your signature on ${prNumber(pr.number)}: ${pr.title}`)
  }
}

async function complete(ctx: Ctx, pr: PrRow, env: Envelope) {
  const { svc } = ctx
  const now = nowIso()
  const { data: won } = await svc.from('esign_envelopes').update({ status: 'completed', completed_at: now })
    .eq('id', env.id).eq('status', 'sent').select('*').maybeSingle()
  if (!won) return
  await logEvent(ctx, won, 'completed', { system: true })
  await svc.from('esign_recipients').update({ status: 'completed', sent_at: now }).eq('envelope_id', env.id).eq('role', 'cc')
  await svc.from('purchase_requests').update({ status: 'approved', approved_at: now }).eq('id', pr.id).eq('status', 'pending')

  const sealed = await seal(ctx, { ...pr, status: 'approved' }, won as Envelope)
  const rs = await loadRecipients(ctx, env.id)
  const emailId = await sendEmail(ctx, {
    to: rs.map((r) => r.email),
    subject: `Approved: ${prNumber(pr.number)} ${pr.title}`,
    html: emailHtml({
      heading: `${prNumber(pr.number)} is approved`,
      intro: sealed
        ? 'Everyone has signed. The sealed PDF, with its certificate of completion, is attached for your records. You can download it again in Operator any time.'
        : 'Everyone has signed. Download the sealed PDF, with its certificate of completion, from Operator.',
      summary: summaryOf(pr),
      button: { label: 'Open in Operator', url: link(pr) },
      footer: 'Keep this email or the attached PDF for your records. It is the completed, sealed copy of the signed request.',
    }),
    attachments: sealed ? [{ filename: sealed.filename, content: toBase64(sealed.bytes) }] : undefined,
  })
  await logEvent(ctx, won, 'email_sent', { system: true, detail: { purpose: 'completed copy', to: rs.map((r) => r.name).join(', '), email_id: emailId, attached: !!sealed } })
  await notify(ctx, rs.map((r) => r.user_id), pr, `${prNumber(pr.number)} is approved: ${pr.title}`)
}

// Builds the final PDF, seals it, stores it, and records its fingerprint.
async function seal(ctx: Ctx, pr: PrRow, env: Envelope): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const filename = `${prNumber(pr.number)}-v${env.version}-signed.pdf`
  try {
    const cert = loadSealCert()
    const unsealed = await buildPdf(ctx, pr, env, { banner: null, seal: cert ? { subject: cert.subject, fingerprint: cert.fingerprint } : null })
    const sealedAt = new Date()
    const bytes = cert
      ? await sealPdf(unsealed, cert, { reason: `Completed and sealed by Operator: ${prNumber(pr.number)}, envelope ${env.id}`, signedAt: sealedAt })
      : unsealed
    const sha = await sha256Hex(bytes)
    const path = `${pr.account_id}/${pr.id}/sealed/${filename}`
    const { error: upErr } = await ctx.svc.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true })
    if (upErr) throw new Error(`upload: ${upErr.message}`)
    const { data: done } = await ctx.svc.from('esign_envelopes').update({
      sealed_pdf_path: path, sealed_pdf_sha256: sha, sealed_at: sealedAt.toISOString(),
      seal_certificate: cert ? `${cert.subject}; SHA-256 ${cert.fingerprint}` : null, seal_error: null,
    }).eq('id', env.id).is('sealed_pdf_sha256', null).select('id').maybeSingle()
    if (!done) return null
    await logEvent(ctx, env, 'sealed', { system: true, detail: { sha256: sha, digital_seal: !!cert, certificate: cert?.fingerprint ?? null } })
    return { bytes, filename }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500)
    console.error('[purchase-requests] seal failed:', msg)
    await ctx.svc.from('esign_envelopes').update({ seal_error: msg }).eq('id', env.id)
    return null
  }
}

function statusLabel(pr: PrRow, env: Envelope | null): string {
  if (!env) return 'Draft'
  if (env.status === 'completed') return pr.status === 'purchased' ? 'Approved, purchased' : 'Approved, all signatures complete'
  if (env.status === 'declined') return 'Declined'
  if (env.status === 'voided') return 'Voided'
  return 'Awaiting signatures'
}

async function loadLogo(ctx: Ctx): Promise<{ bytes: Uint8Array; w: number; h: number } | null> {
  if (!ctx.brandLogo) return null
  try {
    const res = await fetch(new URL(ctx.brandLogo.replace(/\.png$/i, '-pdf.jpg'), APP_URL))
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const size = jpegSize(bytes)
    return size ? { bytes, ...size } : null
  } catch { return null }
}

function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3])
  }
  return null
}

async function buildPdf(ctx: Ctx, pr: PrRow, env: Envelope | null, o: {
  banner: string | null
  seal?: { subject: string; fingerprint: string } | null
  draftDoc?: PrDocument
}): Promise<Uint8Array> {
  const doc = newDoc()
  const recipients = env ? await loadRecipients(ctx, env.id) : []
  const document = (env?.document as unknown as PrDocument) ?? o.draftDoc!
  const label = statusLabel(pr, env)
  const pages = renderRequest(doc, document, recipients, { logo: await loadLogo(ctx), sentAt: env?.sent_at ?? null, statusLabel: label })
  doc.setProperties({ title: `${document.number} Purchase Request`, subject: document.title, author: document.requester.name })
  if (env) {
    const events = await loadEvents(ctx, env.id)
    const ids = recipients.map((r) => r.consent_id).filter((x): x is string => !!x)
    const { data: cs } = ids.length ? await ctx.svc.from('esign_consents').select('*').in('id', ids) : { data: [] }
    const consents = new Map(((cs ?? []) as Consent[]).map((c) => [c.id, c]))
    addCertificate(doc, {
      company: ctx.company, envelope: env, recipients, events, consents,
      documentLabel: `Purchase Request ${document.number}, version ${document.version}`,
      documentPages: pages, seal: o.seal ?? null, statusLabel: label,
    })
    const versions = [...new Set([...consents.values()].map((c) => c.disclosure_version))]
    const { data: ds } = versions.length
      ? await ctx.svc.from('esign_disclosures').select('version, title, body, body_sha256').in('version', versions)
      : { data: [await activeDisclosure(ctx)] }
    for (const d of (ds ?? []) as Disclosure[]) {
      const accepted = [...consents.values()].filter((c) => c.disclosure_version === d.version).map((c) => ({ name: c.user_name, at: c.consented_at }))
      addDisclosure(doc, d, ctx.company, accepted)
    }
  }
  stampPages(doc, { envelopeId: env?.id ?? null, footer: `${document.number} · Purchase Request · ${ctx.company}`, banner: o.banner })
  return pdfBytes(doc)
}

// ---------------------------------------------------------------- signing

// The recipient row whose turn it is for the current user, or a clear refusal.
async function myTurn(ctx: Ctx, pr: PrRow) {
  if (pr.status !== 'pending') fail(409, 'not_pending', 'This request is not waiting for signatures.')
  const env = await loadEnvelope(ctx, pr.envelope_id)
  if (env.status !== 'sent') fail(409, 'not_pending', 'This request is not waiting for signatures.')
  const rs = await loadRecipients(ctx, env.id)
  const mine = rs.filter((r) => r.user_id === ctx.me.id && r.role === 'signer' && r.status !== 'signed')
  if (!mine.length) fail(403, 'not_signer', "You aren't an approver on this request, or you already signed it.")
  const order = activeOrder(rs)
  const r = mine.find((x) => x.routing_order === order)
  if (!r) fail(409, 'not_your_turn', "It isn't your turn to sign yet. You'll get an email when it is.")
  if (r.status !== 'sent' && r.status !== 'viewed') fail(409, 'not_your_turn', "It isn't your turn to sign yet.")
  return { env, rs, r }
}

async function view(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  if (!(await canView(ctx, pr))) fail(403, 'forbidden', "You can't open this request.")
  if (pr.status !== 'pending' || !pr.envelope_id) return { ok: true }
  const env = await loadEnvelope(ctx, pr.envelope_id)
  if (env.status !== 'sent') return { ok: true }
  const { data: seen } = await ctx.svc.from('esign_recipients').update({ status: 'viewed', viewed_at: nowIso() })
    .eq('envelope_id', env.id).eq('user_id', ctx.me.id).eq('status', 'sent').select('id')
  for (const r of seen ?? []) await logEvent(ctx, env, 'viewed', { recipient: r })
  return { ok: true }
}

async function sign(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  const { env, r } = await myTurn(ctx, pr)
  if (body.envelope_id && body.envelope_id !== env.id) fail(409, 'changed', 'This request was sent again. Reload it and review the new version.')
  if (body.document_hash !== env.document_hash) fail(409, 'changed', 'What you reviewed does not match the request. Reload it and review it again.')
  if (!validSignature(body.signature)) fail(422, 'bad_signature', 'Draw or type your signature first.')
  const sig = body.signature as SignatureInput
  const { consent, isNew } = await ensureConsent(ctx, body.consent)
  const sigSha = await sha256Hex(fromBase64(sig.image.split(',')[1]))
  const now = nowIso()
  const { data: done } = await ctx.svc.from('esign_recipients').update({
    status: 'signed', signed_at: now, viewed_at: r.viewed_at ?? now,
    signature_kind: sig.kind, signature_image: sig.image, signature_name: sig.name.trim(), signature_sha256: sigSha,
    signed_document_hash: env.document_hash, consent_id: consent.id, ip: ctx.ip, user_agent: ctx.ua,
  }).eq('id', r.id).in('status', ['sent', 'viewed']).is('signed_at', null).select('id')
  if (!done?.length) fail(409, 'already_signed', 'This was already signed.')
  if (!r.viewed_at) await logEvent(ctx, env, 'viewed', { recipient: r })
  if (isNew) await logEvent(ctx, env, 'consent', { recipient: r, detail: { consent_id: consent.id, version: consent.disclosure_version } })
  await logEvent(ctx, env, 'signed', {
    recipient: r,
    detail: { meaning: MEANING_APPROVER, intent: INTENT_TEXT, intent_version: INTENT_VERSION, document_hash: env.document_hash, signature_kind: sig.kind, signature_sha256: sigSha },
  })
  if (body.save_signature) await saveSignature(ctx, sig)
  await advance(ctx, pr, env)
  const after = await loadRequest(ctx, pr.id)
  return { ok: true, status: after.status }
}

async function decline(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  const reason = str(body.reason, 1000)
  if (!reason) fail(422, 'reason', 'Say why you are declining, so the requester can fix it.')
  const { env, r, rs } = await myTurn(ctx, pr)
  const now = nowIso()
  const { data: done } = await ctx.svc.from('esign_recipients').update({
    status: 'declined', declined_at: now, decline_reason: reason, ip: ctx.ip, user_agent: ctx.ua,
  }).eq('id', r.id).in('status', ['sent', 'viewed']).select('id')
  if (!done?.length) fail(409, 'already', 'This request already moved on.')
  await ctx.svc.from('esign_envelopes').update({ status: 'declined', declined_at: now }).eq('id', env.id).eq('status', 'sent')
  await ctx.svc.from('purchase_requests').update({ status: 'declined', closed_at: now }).eq('id', pr.id).eq('status', 'pending')
  await logEvent(ctx, env, 'declined', { recipient: r, detail: { reason } })
  const signedBefore = rs.filter((x) => x.status === 'signed' && x.role === 'signer')
  await sendEmail(ctx, {
    to: [pr.requester_email, ...signedBefore.map((x) => x.email)],
    subject: `Declined: ${prNumber(pr.number)} ${pr.title}`,
    html: emailHtml({
      heading: `${ctx.me.name} declined ${prNumber(pr.number)}`,
      intro: 'The request was not approved. The requester can edit it and send it again.',
      summary: summaryOf(pr),
      note: `Reason: ${reason}`,
      button: { label: 'Open in Operator', url: link(pr) },
    }),
  })
  await notify(ctx, [pr.requester_id, ...signedBefore.map((x) => x.user_id)], pr, `${ctx.me.name} declined ${prNumber(pr.number)}: ${reason}`)
  return { ok: true }
}

async function paperRequest(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  const { env, r } = await myTurn(ctx, pr)
  const note = str(body.note, 1000)
  await ctx.svc.from('esign_recipients').update({ paper_requested_at: nowIso() }).eq('id', r.id).is('paper_requested_at', null)
  await logEvent(ctx, env, 'paper_requested', { recipient: r, detail: note ? { note } : {} })
  await sendEmail(ctx, {
    to: [pr.requester_email],
    subject: `Paper signature requested: ${prNumber(pr.number)}`,
    html: emailHtml({
      heading: `${ctx.me.name} would like to sign on paper`,
      intro: `Download the PDF of ${prNumber(pr.number)} in Operator and give it to ${ctx.me.name} to sign by hand. Then give the signed copy to Accounts Payable, who will scan it into the request.`,
      summary: summaryOf(pr),
      note: note || undefined,
      button: { label: 'Open in Operator', url: link(pr) },
    }),
  })
  await notify(ctx, [pr.requester_id], pr, `${ctx.me.name} asked to sign ${prNumber(pr.number)} on paper`)
  return { ok: true }
}

async function paperSign(ctx: Ctx, body: Body) {
  if (!ctx.me.finance) fail(403, 'forbidden', 'Only Accounts Payable can record a paper signature.')
  const pr = await loadRequest(ctx, body.request_id)
  if (pr.status !== 'pending') fail(409, 'not_pending', 'This request is not waiting for signatures.')
  const env = await loadEnvelope(ctx, pr.envelope_id)
  const rs = await loadRecipients(ctx, env.id)
  const order = activeOrder(rs)
  const r = rs.find((x) => x.id === body.recipient_id)
  if (!r || r.role !== 'signer' || r.status === 'signed') fail(422, 'bad_recipient', 'Pick an approver who has not signed.')
  if (r.routing_order !== order || (r.status !== 'sent' && r.status !== 'viewed')) fail(409, 'not_their_turn', "It isn't that approver's turn yet.")
  const mime = str(body.mime, 100)
  if (!/^(application\/pdf|image\/(png|jpeg|heic|heif|webp))$/.test(mime)) fail(422, 'bad_file', 'Upload the signed page as a PDF or a photo.')
  let bytes: Uint8Array
  try { bytes = fromBase64(String(body.file_base64 ?? '')) } catch { fail(422, 'bad_file', 'That file could not be read.') }
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) fail(422, 'bad_file', 'The scan must be under 10 MB.')
  const name = (str(body.file_name, 120) || 'signed-page').replace(/[^\w.\- ]+/g, '_')
  const path = `${pr.account_id}/${pr.id}/paper/${r.id}-${Date.now()}-${name}`
  const { error: upErr } = await ctx.svc.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
  if (upErr) throw new Error(`paper upload: ${upErr.message}`)
  const sha = await sha256Hex(bytes)
  await ctx.svc.from('purchase_request_files').insert({
    request_id: pr.id, account_id: pr.account_id, path, name, size: bytes.length, mime, sha256: sha,
    kind: 'paper_signature', locked: true, uploaded_by: ctx.me.id, uploaded_by_name: ctx.me.name,
  })
  const signedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.signed_on ?? '')) ? String(body.signed_on) : null
  const { data: done } = await ctx.svc.from('esign_recipients').update({
    status: 'signed', signed_at: nowIso(), signature_kind: 'paper', signature_name: r.name,
    signed_document_hash: env.document_hash, paper_file_path: path, paper_file_sha256: sha, paper_recorded_by: ctx.me.name,
  }).eq('id', r.id).in('status', ['sent', 'viewed']).select('id')
  if (!done?.length) fail(409, 'already', 'That approver already signed.')
  await logEvent(ctx, env, 'paper_signed', { recipient: r, detail: { recorded_by: ctx.me.name, signed_on: signedOn, file_sha256: sha, signer: r.name } })
  await advance(ctx, pr, env)
  return { ok: true }
}

async function voidIt(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  if (pr.requester_id !== ctx.me.id && !ctx.me.finance) fail(403, 'forbidden', 'Only the requester or Accounts Payable can void a request.')
  if (pr.status !== 'pending') fail(409, 'not_pending', 'Only a request that is waiting for signatures can be voided.')
  const reason = str(body.reason, 1000)
  if (!reason) fail(422, 'reason', 'Say why you are voiding it.')
  const env = await loadEnvelope(ctx, pr.envelope_id)
  const now = nowIso()
  const { data: done } = await ctx.svc.from('esign_envelopes').update({
    status: 'voided', voided_at: now, void_reason: reason, voided_by_name: ctx.me.name,
  }).eq('id', env.id).eq('status', 'sent').select('id')
  if (!done?.length) fail(409, 'already', 'This request already finished.')
  await ctx.svc.from('purchase_requests').update({ status: 'voided', closed_at: now }).eq('id', pr.id).eq('status', 'pending')
  await logEvent(ctx, env, 'voided', { detail: { reason } })
  const rs = await loadRecipients(ctx, env.id)
  const told = rs.filter((r) => r.role !== 'cc' && r.user_id !== ctx.me.id && (r.sent_at || r.role === 'sender'))
  await sendEmail(ctx, {
    to: told.map((r) => r.email),
    subject: `Voided: ${prNumber(pr.number)} ${pr.title}`,
    html: emailHtml({
      heading: `${prNumber(pr.number)} was voided`,
      intro: `${ctx.me.name} voided this request. Nothing more needs to be signed.`,
      summary: summaryOf(pr),
      note: `Reason: ${reason}`,
      button: { label: 'Open in Operator', url: link(pr) },
    }),
  })
  await notify(ctx, told.map((r) => r.user_id), pr, `${ctx.me.name} voided ${prNumber(pr.number)}`)
  return { ok: true }
}

async function reopen(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  if (pr.requester_id !== ctx.me.id) fail(403, 'forbidden', 'Only the requester can edit and resend a request.')
  if (pr.status !== 'declined' && pr.status !== 'voided') fail(409, 'bad_status', 'Only a declined or voided request can be edited and sent again.')
  await ctx.svc.from('purchase_requests').update({ status: 'draft', submitted_at: null, approved_at: null, closed_at: null })
    .eq('id', pr.id).in('status', ['declined', 'voided'])
  return { ok: true }
}

async function remind(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  if (pr.requester_id !== ctx.me.id && !ctx.me.finance) fail(403, 'forbidden', 'Only the requester or Accounts Payable can send a reminder.')
  if (pr.status !== 'pending') fail(409, 'not_pending', 'This request is not waiting for signatures.')
  const env = await loadEnvelope(ctx, pr.envelope_id)
  if (env.last_reminded_at && Date.now() - Date.parse(env.last_reminded_at) < 60 * 60 * 1000) {
    fail(429, 'too_soon', 'A reminder went out less than an hour ago.')
  }
  const rs = await loadRecipients(ctx, env.id)
  const order = activeOrder(rs)
  const waiting = rs.filter((r) => r.role === 'signer' && r.routing_order === order && (r.status === 'sent' || r.status === 'viewed'))
  if (!waiting.length) fail(409, 'nobody', 'Nobody is waiting to sign right now.')
  await ctx.svc.from('esign_envelopes').update({ last_reminded_at: nowIso() }).eq('id', env.id)
  const emailId = await sendEmail(ctx, {
    to: waiting.map((r) => r.email),
    subject: `Reminder: please sign ${prNumber(pr.number)} ${pr.title}`,
    html: emailHtml({
      heading: `Reminder: ${prNumber(pr.number)} is waiting for you`,
      intro: `${ctx.me.name} sent a reminder. Review the request in Operator, then sign or decline.`,
      summary: summaryOf(pr),
      button: { label: 'Review and sign', url: link(pr) },
    }),
  })
  await logEvent(ctx, env, 'reminder_sent', { detail: { to: waiting.map((r) => r.name).join(', '), email_id: emailId } })
  await notify(ctx, waiting.map((r) => r.user_id), pr, `Reminder: ${prNumber(pr.number)} needs your signature`)
  return { ok: true, reminded: waiting.map((r) => r.name) }
}

async function purchased(ctx: Ctx, body: Body) {
  if (!ctx.me.finance) fail(403, 'forbidden', 'Only Accounts Payable can mark a request purchased.')
  const pr = await loadRequest(ctx, body.request_id)
  if (pr.status !== 'approved') fail(409, 'bad_status', 'Only an approved request can be marked purchased.')
  const amount = body.actual_amount === null || body.actual_amount === undefined || body.actual_amount === '' ? null : Number(body.actual_amount)
  if (amount !== null && !(amount >= 0 && amount < 1e9)) fail(422, 'amount', 'Enter the amount paid in dollars.')
  const po = str(body.po_number, 60) || null
  const note = str(body.note, 1000) || null
  const now = nowIso()
  await ctx.svc.from('purchase_requests').update({
    status: 'purchased', purchased_at: now, purchased_by: ctx.me.id, purchased_by_name: ctx.me.name,
    po_number: po, actual_amount: amount === null ? null : Math.round(amount * 100) / 100, purchase_note: note,
  }).eq('id', pr.id).eq('status', 'approved')
  if (pr.envelope_id) {
    const env = await loadEnvelope(ctx, pr.envelope_id)
    await logEvent(ctx, env, 'purchased', { detail: { po_number: po, actual_amount: amount, note } })
  }
  if (pr.requester_id !== ctx.me.id) await notify(ctx, [pr.requester_id], pr, `${prNumber(pr.number)} was purchased`)
  return { ok: true }
}

// ---------------------------------------------------------------------- pdf

async function pdf(ctx: Ctx, body: Body) {
  const pr = await loadRequest(ctx, body.request_id)
  if (!(await canView(ctx, pr))) fail(403, 'forbidden', "You can't open this request.")
  const envId = typeof body.envelope_id === 'string' ? body.envelope_id : pr.envelope_id
  if (!envId || (pr.status === 'draft' && !body.envelope_id)) {
    if (pr.requester_id !== ctx.me.id && !ctx.me.finance) fail(403, 'forbidden', 'Only the requester can preview a draft.')
    const draftDoc = buildDocument({ pr, company: ctx.company, version: (await envelopesOf(ctx, pr.id)).length + 1, files: await draftFiles(ctx, pr), signers: [], cc: [], signInOrder: true })
    const bytes = await buildPdf(ctx, pr, null, { banner: 'DRAFT: NOT SENT FOR SIGNATURE', draftDoc })
    return { base64: toBase64(bytes), filename: `${prNumber(pr.number)}-draft.pdf`, sealed: false }
  }
  let env = await loadEnvelope(ctx, envId)
  if (env.source_id !== pr.id) fail(404, 'no_envelope', 'That signing record belongs to another request.')
  if (env.status === 'completed') {
    if (!env.sealed_pdf_path) {
      await seal(ctx, pr, env)
      env = await loadEnvelope(ctx, env.id)
    }
    if (env.sealed_pdf_path) {
      const filename = env.sealed_pdf_path.split('/').pop()!
      const { data } = await ctx.svc.storage.from(BUCKET).createSignedUrl(env.sealed_pdf_path, 600, { download: filename })
      if (!data?.signedUrl) fail(500, 'link', 'Could not make a download link. Try again.')
      await logEvent(ctx, env, 'downloaded')
      return { url: data.signedUrl, filename, sealed: true, sha256: env.sealed_pdf_sha256 }
    }
    fail(500, 'seal_failed', 'The sealed PDF could not be made. Try again in a minute.')
  }
  const banner = env.status === 'declined' ? 'DECLINED: NOT A COMPLETED RECORD'
    : env.status === 'voided' ? 'VOIDED: NOT A COMPLETED RECORD' : 'IN PROGRESS: NOT A COMPLETED RECORD'
  const bytes = await buildPdf(ctx, pr, env, { banner })
  return { base64: toBase64(bytes), filename: `${prNumber(pr.number)}-v${env.version}-${env.status === 'sent' ? 'in-progress' : env.status}.pdf`, sealed: false }
}

async function draftFiles(ctx: Ctx, pr: PrRow): Promise<PrFile[]> {
  const { data } = await ctx.svc.from('purchase_request_files').select('id, name, size, sha256, path')
    .eq('request_id', pr.id).eq('kind', 'attachment').is('removed_at', null).order('created_at')
  return (data ?? []) as PrFile[]
}

// ----------------------------------------------------------------- consent

async function consentAction(ctx: Ctx, body: Body) {
  const { consent } = await ensureConsent(ctx, { version: body.version, accept: body.accept })
  return { ok: true, consent }
}

async function withdrawConsent(ctx: Ctx) {
  const now = nowIso()
  const { data: gone } = await ctx.svc.from('esign_consents').update({ withdrawn_at: now, withdrawn_ip: ctx.ip, withdrawn_user_agent: ctx.ua })
    .eq('user_id', ctx.me.id).is('withdrawn_at', null).select('id')
  // Anyone waiting on this person's e-signature learns it will be on paper.
  const { data: open } = await ctx.svc.from('esign_recipients').select('id, envelope_id, esign_envelopes!inner(id, account_id, status, source_id)')
    .eq('user_id', ctx.me.id).eq('role', 'signer').in('status', ['waiting', 'sent', 'viewed']).eq('esign_envelopes.status', 'sent')
  for (const r of open ?? []) {
    // deno-lint-ignore no-explicit-any
    const env = (r as any).esign_envelopes as { id: string; account_id: string; source_id: string }
    await logEvent(ctx, env, 'consent_withdrawn', { recipient: r })
    const { data: pr } = await ctx.svc.from('purchase_requests').select('*').eq('id', env.source_id).maybeSingle()
    if (pr) await notify(ctx, [pr.requester_id], pr as PrRow, `${ctx.me.name} withdrew e-sign consent; ${prNumber(pr.number)} needs their signature on paper`)
  }
  return { ok: true, withdrawn: gone?.length ?? 0, pending: open?.length ?? 0 }
}

async function disclosurePdf(ctx: Ctx) {
  const d = await activeDisclosure(ctx)
  const doc = newDoc()
  addDisclosure(doc, d, ctx.company, [], false)
  stampPages(doc, { envelopeId: null, footer: `${d.title} · ${ctx.company}` })
  return { base64: toBase64(pdfBytes(doc)), filename: `e-sign-disclosure-${d.version}.pdf` }
}
