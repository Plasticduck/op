// invoice-inbound — Supabase Edge Function (Deno), PUBLIC webhook.
// Receives a parsed inbound email (from whatever inbound-email provider the
// domain owner points at this URL: Resend Inbound, a Cloudflare Email Worker,
// SendGrid Inbound Parse, etc.), resolves which wash it is for by the recipient
// address, stores the attachment, and inserts an ops_invoices row with status
// 'unassigned' so it lands on the Invoice Approval > Unassigned tab.
//
// Secured by a shared secret (env INVOICE_INBOUND_SECRET), checked against the
// `x-webhook-secret` header or `?secret=` query param. Deploy with
// --no-verify-jwt (config.toml sets verify_jwt = false).
//
// Expected JSON body (tolerant of common provider field names):
//   {
//     "to":   "mwinvoices@washlyfe.com" | ["a@x", ...],
//     "from": "Acme Supply <ap@acme.com>" | {name, email},
//     "subject": "Invoice 1234",
//     "text": "...", "html": "...",
//     "messageId": "<...>",
//     "attachments": [{ "filename": "inv.pdf", "contentType": "application/pdf",
//                        "content": "<base64>" }]
//   }

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Pull an email address + display name out of the many shapes providers use.
function parseAddress(v: Any): { email: string; name: string } {
  if (!v) return { email: '', name: '' }
  if (typeof v === 'object') {
    const email = String(v.email ?? v.address ?? '').trim()
    return { email, name: String(v.name ?? '').trim() }
  }
  const s = String(v)
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim(), email: m[2].trim() }
  return { email: s.trim(), name: '' }
}

// Every recipient address on the message (to + cc), normalized lowercase.
function recipients(body: Any): string[] {
  const out: string[] = []
  const push = (v: Any) => {
    if (!v) return
    if (Array.isArray(v)) v.forEach(push)
    else if (typeof v === 'object') push(v.email ?? v.address)
    else String(v).split(',').forEach((p) => { const e = parseAddress(p).email; if (e) out.push(e.toLowerCase()) })
  }
  push(body.to); push(body.cc); push(body.recipient); push(body.envelope?.to)
  return [...new Set(out)]
}

// First currency-looking amount in the subject, then the body. Best-effort.
function parseAmount(subject: string, text: string): number {
  for (const src of [subject, text]) {
    const m = String(src || '').match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]+\.[0-9]{2})/)
    if (m) return Number(m[1].replace(/,/g, '')) || 0
  }
  return 0
}

function vendorFrom(from: { email: string; name: string }): string {
  if (from.name) return from.name
  const dom = from.email.split('@')[1] ?? ''
  const base = dom.split('.')[0] ?? from.email
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : (from.email || 'Unknown vendor')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const secret = Deno.env.get('INVOICE_INBOUND_SECRET')
  if (!secret) return json({ error: 'no_key', message: 'INVOICE_INBOUND_SECRET is not set.' }, 503)
  const url = new URL(req.url)
  const given = req.headers.get('x-webhook-secret') ?? url.searchParams.get('secret') ?? ''
  if (given !== secret) return json({ error: 'unauthorized' }, 401)

  let body: Any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request', message: 'Body must be JSON.' }, 400)
  }

  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(supaUrl, serviceKey, { auth: { persistSession: false } })

  // Resolve the wash from the recipient address: the invoiceInboxEmail override
  // first, then the generated <token>@invoices.washlyfe.com local-part token.
  let accountId: string | null = null
  for (const addr of recipients(body)) {
    const { data: byOverride } = await svc
      .from('accounts')
      .select('id')
      .filter('company_settings->>invoiceInboxEmail', 'eq', addr)
      .limit(1)
      .maybeSingle()
    if (byOverride?.id) { accountId = byOverride.id as string; break }
    const localpart = addr.split('@')[0]
    const { data: acc } = await svc.rpc('account_for_invoice_token', { p_token: localpart })
    if (acc) { accountId = acc as string; break }
  }
  if (!accountId) {
    return json({ error: 'unknown_recipient', message: 'No wash matches the recipient address.', to: recipients(body) }, 422)
  }

  const from = parseAddress(body.from ?? body.sender)
  const subject = String(body.subject ?? '').trim()
  const text = String(body.text ?? body.plain ?? '')
  const messageId = String(body.messageId ?? body.message_id ?? body['message-id'] ?? '').trim() || null

  // Idempotency: skip a message we've already filed for this wash.
  if (messageId) {
    const { data: existing } = await svc
      .from('ops_invoices')
      .select('id')
      .eq('account_id', accountId)
      .eq('email_message_id', messageId)
      .maybeSingle()
    if (existing?.id) return json({ ok: true, deduped: true, invoice_id: existing.id }, 200)
  }

  const invoiceId = crypto.randomUUID()

  // Store attachments (prefer a PDF/image as the primary file).
  const atts: Any[] = Array.isArray(body.attachments) ? body.attachments : []
  let filePath: string | null = null
  let fileName: string | null = null
  let fileType: string | null = null
  const stored: string[] = []
  for (const a of atts) {
    const name = String(a.filename ?? a.name ?? a.fileName ?? 'attachment').replace(/[^\w.\-]+/g, '_')
    const ctype = String(a.contentType ?? a.content_type ?? a.type ?? 'application/octet-stream')
    const b64 = a.content ?? a.content_base64 ?? a.contentBase64 ?? a.data
    if (!b64 || typeof b64 !== 'string') continue
    let bytes: Uint8Array
    try {
      const bin = atob(b64.replace(/^data:[^;]+;base64,/, ''))
      bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    } catch {
      continue
    }
    const path = `${accountId}/${invoiceId}/${name}`
    const { error: upErr } = await svc.storage.from('ops-invoices').upload(path, bytes, { contentType: ctype, upsert: true })
    if (upErr) continue
    stored.push(path)
    if (!filePath) { filePath = path; fileName = name; fileType = ctype }
  }

  const { error: insErr } = await svc.from('ops_invoices').insert({
    id: invoiceId,
    account_id: accountId,
    vendor_name: vendorFrom(from),
    amount: parseAmount(subject, text),
    status: 'unassigned',
    email_from: from.email || null,
    email_subject: subject || null,
    email_message_id: messageId,
    file_name: fileName,
    file_type: fileType,
    file_path: filePath,
    submitted_by_name: 'Emailed in',
  })
  if (insErr) {
    // Unique (account_id, email_message_id) race -> already filed.
    if (insErr.code === '23505') return json({ ok: true, deduped: true }, 200)
    return json({ error: 'insert_failed', message: insErr.message }, 500)
  }

  return json({ ok: true, invoice_id: invoiceId, account_id: accountId, attachments: stored.length }, 200)
})
