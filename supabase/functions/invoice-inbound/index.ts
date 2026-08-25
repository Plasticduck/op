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
import Anthropic from 'npm:@anthropic-ai/sdk'

// deno-lint-ignore no-explicit-any
type Any = any

// Ask Claude to match an inbound invoice to a vendor in the account's list.
// Returns the exact list name, or null when there's no confident match (we only
// accept a verbatim list member, so a hallucinated name is rejected).
async function matchVendor(
  apiKey: string,
  model: string,
  sender: { name: string; email: string },
  subject: string,
  vendors: string[],
): Promise<string | null> {
  try {
    const anthropic = new Anthropic({ apiKey })
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 100,
      system:
        'You match an incoming vendor invoice to the correct vendor from a fixed list. ' +
        'Reply with ONLY the exact vendor name copied verbatim from the list, or the single ' +
        'word NONE if there is no confident match. Output nothing else.',
      messages: [{
        role: 'user',
        content: `Sender name: ${sender.name || '(none)'}\nSender email: ${sender.email || '(none)'}\n` +
          `Email subject: ${subject || '(none)'}\n\nVendor list:\n${vendors.join('\n')}`,
      }],
    })
    const block = msg.content.find((b) => b.type === 'text')
    const raw = (block && 'text' in block ? block.text : '').trim()
    if (!raw || raw.toUpperCase() === 'NONE') return null
    return vendors.find((v) => v.toLowerCase() === raw.toLowerCase()) ?? null
  } catch {
    return null
  }
}

// Read a single attached file (PDF or image) with Claude: decide whether it is
// actually a vendor invoice, and if so pull the billing fields off the page
// (vendor matched to the account's list when it clearly refers to a listed
// company, else as printed; invoice date, total amount, invoice number).
// Best-effort: any hard failure returns null and the caller falls back to the
// email-metadata heuristics (and treats the file as an invoice, conservatively).
async function extractInvoice(
  apiKey: string,
  model: string,
  file: { b64: string; contentType: string },
  vendors: string[],
): Promise<{ isInvoice: boolean; vendor: string | null; invoiceDate: string | null; amount: number | null; invoiceNumber: string | null } | null> {
  const isPdf = file.contentType.includes('pdf')
  const isImg = file.contentType.startsWith('image/')
  if (!isPdf && !isImg) return null
  try {
    const anthropic = new Anthropic({ apiKey })
    const doc = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.b64 } }
      : { type: 'image', source: { type: 'base64', media_type: file.contentType, data: file.b64 } }
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 400,
      system:
        'You inspect a single file attached to an email and, if it is a vendor invoice, extract its billing fields. ' +
        'Reply with ONLY a JSON object and nothing else. Keys: ' +
        '"is_invoice" (boolean: true if this file is a vendor invoice or bill — a document requesting or recording payment owed to a vendor; ' +
        'false if it is NOT an invoice, e.g. a company logo or other non-document image, a marketing flyer, an email-signature image, ' +
        'general correspondence, a blank page, or a plain account statement with no invoice detail. When unsure, use true.), ' +
        '"vendor" (the company that issued the invoice / is being paid), "invoice_date" (the invoice date as YYYY-MM-DD, or null), ' +
        '"amount" (the total amount due as a plain number with no currency symbol or commas, or null), "invoice_number" (as printed, or null). ' +
        'For "vendor": if one of the names in the provided Vendor list clearly refers to the same company, copy that list name VERBATIM; otherwise use the vendor name exactly as printed on the invoice.',
      messages: [{
        role: 'user',
        // deno-lint-ignore no-explicit-any
        content: [doc as any, { type: 'text', text: `Vendor list:\n${vendors.join('\n') || '(none)'}\n\nReturn the JSON now.` }],
      }],
    })
    const block = msg.content.find((b) => b.type === 'text')
    const raw = (block && 'text' in block ? block.text : '').trim()
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    const vendorRaw = typeof parsed.vendor === 'string' ? parsed.vendor.trim() : ''
    const matched = vendors.find((v) => v.toLowerCase() === vendorRaw.toLowerCase())
    const amt = Number(parsed.amount)
    const dateStr = typeof parsed.invoice_date === 'string' ? parsed.invoice_date.trim() : ''
    const numStr = typeof parsed.invoice_number === 'string' ? parsed.invoice_number.trim() : ''
    return {
      // Only a confident, explicit false skips the file; anything else is kept.
      isInvoice: parsed.is_invoice !== false,
      vendor: matched ?? (vendorRaw || null),
      invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null,
      amount: Number.isFinite(amt) && amt > 0 ? amt : null,
      invoiceNumber: numStr || null,
    }
  } catch {
    return null
  }
}

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

  // Vendor list + aliases for this wash, read once and reused for every attachment.
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'
  let vendors: string[] = []
  if (anthropicKey) {
    const { data: vrows } = await svc
      .from('invoice_vendors').select('name').eq('account_id', accountId).eq('active', true)
    vendors = (vrows ?? []).map((r: Any) => r.name as string)
  }
  const { data: aliasRows } = await svc
    .from('invoice_vendor_aliases').select('alias_name, canonical_name').eq('account_id', accountId)
  const aliases = aliasRows ?? []
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  // File an invoice under a different dropdown vendor when an alias matches
  // (e.g. Arnold Oil -> A-Line Auto Parts).
  const applyAlias = (name: string): string => {
    const a = aliases.find((x: Any) => norm(String(x.alias_name)) === norm(name))
    return a ? String(a.canonical_name) : name
  }
  // Soft duplicate: same account + vendor + invoice number as an earlier
  // non-cancelled invoice; the earliest match is treated as the original.
  const findDuplicate = async (invoiceNumber: string | null, vendorName: string): Promise<string | null> => {
    if (!invoiceNumber) return null
    const numKey = invoiceNumber.trim().toLowerCase().replace(/\s+/g, '')
    const { data: prior } = await svc
      .from('ops_invoices')
      .select('id, invoice_number, vendor_name')
      .eq('account_id', accountId)
      .not('invoice_number', 'is', null)
      .neq('status', 'cancelled')
      .order('submitted_at', { ascending: true })
    const hit = (prior ?? []).find((p: Any) =>
      String(p.invoice_number ?? '').trim().toLowerCase().replace(/\s+/g, '') === numKey &&
      norm(String(p.vendor_name ?? '')) === norm(vendorName))
    return hit ? (hit.id as string) : null
  }

  const emailVendor = vendorFrom(from)
  const emailAmount = parseAmount(subject, text)

  // Attachment keys already filed for this message, so a re-run does not double
  // file (idempotency is now per attachment, not per message).
  const seenKeys = new Set<string>()
  if (messageId) {
    const { data: prev } = await svc
      .from('ops_invoices').select('email_attachment_key')
      .eq('account_id', accountId).eq('email_message_id', messageId)
    for (const r of prev ?? []) if (r.email_attachment_key) seenKeys.add(r.email_attachment_key as string)
  }

  // File ONE invoice per attachment that reads as an invoice. Non-invoice files
  // (logos, marketing, signatures, statements) and unreadable formats are skipped.
  const atts: Any[] = Array.isArray(body.attachments) ? body.attachments : []
  const filed: string[] = []
  const skipped: Array<{ file: string; reason: string }> = []

  for (let idx = 0; idx < atts.length; idx++) {
    const a = atts[idx]
    const name = String(a.filename ?? a.name ?? a.fileName ?? a.Name ?? `attachment_${idx}`).replace(/[^\w.\-]+/g, '_')
    const ctype = String(a.contentType ?? a.content_type ?? a.type ?? a.ContentType ?? 'application/octet-stream')
    const b64raw = a.content ?? a.content_base64 ?? a.contentBase64 ?? a.contentBytes ?? a.ContentBytes ?? a.data
    const attKey = `${idx}:${name}`
    if (seenKeys.has(attKey)) { skipped.push({ file: name, reason: 'already_filed' }); continue }
    if (!b64raw || typeof b64raw !== 'string') { skipped.push({ file: name, reason: 'no_content' }); continue }
    const clean = b64raw.replace(/^data:[^;]+;base64,/, '')
    let bytes: Uint8Array
    try {
      const bin = atob(clean)
      bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    } catch { skipped.push({ file: name, reason: 'bad_base64' }); continue }

    const isPdf = ctype.includes('pdf')
    const isImg = ctype.startsWith('image/')
    if (!isPdf && !isImg) { skipped.push({ file: name, reason: 'unreadable_format' }); continue }

    // Read + classify the file. A confident "not an invoice" is skipped; an
    // extraction error (null) is treated as an invoice with metadata fallback.
    const extracted = anthropicKey ? await extractInvoice(anthropicKey, model, { b64: clean, contentType: ctype }, vendors) : null
    if (extracted && !extracted.isInvoice) { skipped.push({ file: name, reason: 'not_an_invoice' }); continue }

    let vendorName = emailVendor
    let amount = emailAmount
    let invoiceDate: string | null = null
    let invoiceNumber: string | null = null
    if (extracted) {
      if (extracted.vendor) vendorName = extracted.vendor
      if (extracted.amount != null) amount = extracted.amount
      invoiceDate = extracted.invoiceDate
      invoiceNumber = extracted.invoiceNumber
    } else if (anthropicKey && vendors.length) {
      const matched = await matchVendor(anthropicKey, model, from, subject, vendors)
      if (matched) vendorName = matched
    }
    vendorName = applyAlias(vendorName)

    const invoiceId = crypto.randomUUID()
    const path = `${accountId}/${invoiceId}/${name}`
    const { error: upErr } = await svc.storage.from('ops-invoices').upload(path, bytes, { contentType: ctype, upsert: true })
    if (upErr) { skipped.push({ file: name, reason: 'upload_failed' }); continue }

    const duplicateOf = await findDuplicate(invoiceNumber, vendorName)
    // Due date defaults to 30 days after the invoice date.
    const dueDate = (() => {
      if (!invoiceDate) return null
      const d = new Date(invoiceDate + 'T12:00:00Z')
      d.setUTCDate(d.getUTCDate() + 30)
      return d.toISOString().slice(0, 10)
    })()
    const { error: insErr } = await svc.from('ops_invoices').insert({
      id: invoiceId,
      account_id: accountId,
      vendor_name: vendorName,
      amount,
      invoice_date: invoiceDate,
      due_date: dueDate,
      invoice_number: invoiceNumber,
      status: 'unassigned',
      email_from: from.email || null,
      email_subject: subject || null,
      email_message_id: messageId,
      email_attachment_key: attKey,
      file_name: name,
      file_type: ctype,
      file_path: path,
      duplicate_of: duplicateOf,
      submitted_by_name: 'Emailed in',
    })
    if (insErr) {
      // Lost an idempotency race for this (message, attachment): drop the orphan file.
      await svc.storage.from('ops-invoices').remove([path]).catch(() => {})
      if (insErr.code !== '23505') skipped.push({ file: name, reason: `insert_failed:${insErr.message}` })
      else skipped.push({ file: name, reason: 'already_filed' })
      continue
    }
    filed.push(invoiceId)
    seenKeys.add(attKey)
  }

  // Body-only email (no attachments): keep the legacy single metadata row so a
  // plain-text invoice notification still lands. Idempotent via a fixed key.
  if (atts.length === 0 && !(messageId && seenKeys.has('__body__'))) {
    let vendorName = applyAlias(emailVendor)
    if (anthropicKey && vendors.length) {
      const matched = await matchVendor(anthropicKey, model, from, subject, vendors)
      if (matched) vendorName = applyAlias(matched)
    }
    const invoiceId = crypto.randomUUID()
    const { error: insErr } = await svc.from('ops_invoices').insert({
      id: invoiceId, account_id: accountId, vendor_name: vendorName, amount: emailAmount,
      invoice_date: null, invoice_number: null, status: 'unassigned',
      email_from: from.email || null, email_subject: subject || null,
      email_message_id: messageId, email_attachment_key: messageId ? '__body__' : null,
      file_name: null, file_type: null, file_path: null, duplicate_of: null,
      submitted_by_name: 'Emailed in',
    })
    if (!insErr) filed.push(invoiceId)
    else if (insErr.code !== '23505') return json({ error: 'insert_failed', message: insErr.message }, 500)
  }

  return json({ ok: true, account_id: accountId, filed: filed.length, invoices: filed, skipped }, 200)
})
