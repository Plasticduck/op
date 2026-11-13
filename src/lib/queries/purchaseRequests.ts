import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fnErrorMessage } from '@/lib/fnError'

// Finance > Purchase Request and Operator's e-signature records (migration 0238).
// The app writes only drafts and their attachments; every signing step goes
// through the purchase-requests edge function, which keeps the audit trail.
// RLS: the requester, anyone on the request's signing list, and AP (owners and
// the finance category) can read a request.
type T = Database['public']['Tables']

export type LineItem = { description: string; quantity: number | string; unit_price: number | string }
export type PurchaseRequest = Omit<T['purchase_requests']['Row'], 'line_items'> & { line_items: LineItem[] }
export type PurchaseRequestDraft = Pick<PurchaseRequest,
  'title' | 'vendor' | 'site' | 'category' | 'gl_code' | 'payment_method' | 'needed_by' | 'priority' | 'justification' | 'line_items' | 'shipping' | 'tax'>
export type PrFile = T['purchase_request_files']['Row']
export type ApprovalRule = T['purchase_approval_rules']['Row']
export type Envelope = T['esign_envelopes']['Row']
export type Recipient = T['esign_recipients']['Row']
export type EsignEvent = T['esign_events']['Row'] & { detail: Record<string, unknown> }
export type Disclosure = T['esign_disclosures']['Row']
export type Consent = T['esign_consents']['Row']
export type SavedSignature = T['esign_saved_signatures']['Row']

export type SignatureInput = { kind: 'drawn' | 'typed'; image: string; name: string }
export type Party = { user_id: string; name: string; email: string; required_by_rule?: string | null }

// The exact snapshot that is signed (built by the function; see doc.ts there).
export type PrDocument = {
  number: string
  version: number
  company: string
  title: string
  vendor: string
  site: string
  category: string
  gl_code: string
  payment_method: string
  needed_by: string
  priority: string
  justification: string
  line_items: { description: string; quantity: string; unit_price: string; amount: string }[]
  subtotal: string
  shipping: string
  tax: string
  total: string
  requester: { id: string; name: string; email: string }
  attachments: { id: string; name: string; size: number; sha256: string }[]
  routing: {
    sign_in_order: boolean
    signers: { user_id: string; name: string; email: string; order: number; required_by_rule: string | null }[]
    cc: { user_id: string; name: string; email: string }[]
  }
}

export type Prepared = {
  document: PrDocument
  document_hash: string
  signers: Party[]
  cc: Party[]
  needs_consent: boolean
  disclosure_version: string
  intent: string
  meaning: string
}

const BUCKET = 'purchase-requests'

// One call into the purchase-requests function. Throws with the function's own
// message so the page can show it.
async function act<R = { ok: true }>(action: string, body: Record<string, unknown>): Promise<R> {
  const { data, error } = await supabase.functions.invoke('purchase-requests', { body: { action, ...body } })
  if (error) throw new Error(await fnErrorMessage(error, data, 'That did not go through'))
  return data as R
}

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file'

export const purchaseRequests = {
  list: () => supabase.from('purchase_requests').select('*').order('created_at', { ascending: false }).limit(2000),
  get: (id: string) => supabase.from('purchase_requests').select('*').eq('id', id).maybeSingle(),
  create: (row: Partial<PurchaseRequestDraft>) =>
    supabase.from('purchase_requests').insert(row as T['purchase_requests']['Insert']).select('*').single(),
  update: (id: string, patch: Partial<PurchaseRequestDraft>) =>
    supabase.from('purchase_requests').update(patch as T['purchase_requests']['Update']).eq('id', id).select('*').single(),
  remove: (id: string) => supabase.from('purchase_requests').delete().eq('id', id),

  files: (requestId: string) =>
    supabase.from('purchase_request_files').select('*').eq('request_id', requestId).order('created_at'),
  upload: async (accountId: string, requestId: string, file: File) => {
    const path = `${accountId}/${requestId}/${crypto.randomUUID()}-${safeName(file.name)}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (up.error) return { data: null, error: up.error }
    const row = await supabase.from('purchase_request_files').insert({
      request_id: requestId, account_id: accountId, path, name: file.name.slice(0, 200), size: file.size, mime: file.type || null,
    }).select('*').single()
    if (row.error) await supabase.storage.from(BUCKET).remove([path])
    return row
  },
  // A file that was part of a sent request stays in storage for the record; it
  // is only taken off the draft.
  removeFile: async (f: PrFile) => {
    if (f.locked) return supabase.from('purchase_request_files').update({ removed_at: new Date().toISOString() }).eq('id', f.id)
    const res = await supabase.from('purchase_request_files').delete().eq('id', f.id)
    if (!res.error) await supabase.storage.from(BUCKET).remove([f.path])
    return res
  },
  fileUrl: async (path: string, download?: string): Promise<string | null> => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600, download ? { download } : undefined)
    return data?.signedUrl ?? null
  },

  envelopes: (requestId: string) =>
    supabase.from('esign_envelopes').select('*').eq('source_type', 'purchase_request').eq('source_id', requestId).order('version', { ascending: false }),
  recipients: (envelopeIds: string[]) =>
    supabase.from('esign_recipients').select('*').in('envelope_id', envelopeIds).order('routing_order').order('created_at'),
  // Every signing-list row this person can see (RLS), for the list's progress
  // column and the To Sign tab. Signature images are left out to keep it light.
  allRecipients: () =>
    supabase.from('esign_recipients')
      .select('id, envelope_id, user_id, name, email, role, label, routing_order, status, sent_at, signed_at, declined_at, required_by_rule')
      .order('routing_order').limit(5000),
  events: (envelopeId: string) => supabase.from('esign_events').select('*').eq('envelope_id', envelopeId).order('id'),

  rules: () => supabase.from('purchase_approval_rules').select('*').order('sort_order').order('min_amount'),
  saveRule: (r: Partial<ApprovalRule> & { account_id: string }) =>
    r.id
      ? supabase.from('purchase_approval_rules').update({ ...r, updated_at: new Date().toISOString() }).eq('id', r.id)
      : supabase.from('purchase_approval_rules').insert(r as T['purchase_approval_rules']['Insert']),
  removeRule: (id: string) => supabase.from('purchase_approval_rules').delete().eq('id', id),

  prepare: (requestId: string, signers: string[], cc: string[], signInOrder: boolean) =>
    act<Prepared>('prepare', { request_id: requestId, signers, cc, sign_in_order: signInOrder }),
  send: (p: {
    requestId: string; signers: string[]; cc: string[]; signInOrder: boolean; documentHash: string
    signature: SignatureInput; consentVersion: string | null; message: string; saveSignature: boolean
  }) => act<{ ok: true; envelope_id: string }>('send', {
    request_id: p.requestId, signers: p.signers, cc: p.cc, sign_in_order: p.signInOrder, document_hash: p.documentHash,
    signature: p.signature, consent: p.consentVersion ? { version: p.consentVersion, accept: true } : undefined,
    message: p.message, save_signature: p.saveSignature,
  }),
  view: (requestId: string) => act('view', { request_id: requestId }),
  sign: (p: { requestId: string; envelopeId: string; documentHash: string; signature: SignatureInput; consentVersion: string | null; saveSignature: boolean }) =>
    act<{ ok: true; status: string }>('sign', {
      request_id: p.requestId, envelope_id: p.envelopeId, document_hash: p.documentHash, signature: p.signature,
      consent: p.consentVersion ? { version: p.consentVersion, accept: true } : undefined, save_signature: p.saveSignature,
    }),
  decline: (requestId: string, reason: string) => act('decline', { request_id: requestId, reason }),
  paperRequest: (requestId: string, note: string) => act('paper_request', { request_id: requestId, note }),
  paperSign: (p: { requestId: string; recipientId: string; fileBase64: string; fileName: string; mime: string; signedOn: string }) =>
    act('paper_sign', { request_id: p.requestId, recipient_id: p.recipientId, file_base64: p.fileBase64, file_name: p.fileName, mime: p.mime, signed_on: p.signedOn }),
  void: (requestId: string, reason: string) => act('void', { request_id: requestId, reason }),
  reopen: (requestId: string) => act('reopen', { request_id: requestId }),
  remind: (requestId: string) => act<{ ok: true; reminded: string[] }>('remind', { request_id: requestId }),
  purchased: (requestId: string, p: { po_number: string; actual_amount: number | null; note: string }) =>
    act('purchased', { request_id: requestId, ...p }),
  pdf: (requestId: string, envelopeId?: string) =>
    act<{ url?: string; base64?: string; filename: string; sealed: boolean }>('pdf', { request_id: requestId, envelope_id: envelopeId }),
}

export const esign = {
  disclosure: () =>
    supabase.from('esign_disclosures').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  myConsents: (userId: string) =>
    supabase.from('esign_consents').select('*').eq('user_id', userId).order('consented_at', { ascending: false }),
  savedSignature: (userId: string) => supabase.from('esign_saved_signatures').select('*').eq('user_id', userId).maybeSingle(),
  removeSavedSignature: (userId: string) => supabase.from('esign_saved_signatures').delete().eq('user_id', userId),
  consent: (version: string) => act<{ ok: true; consent: Consent }>('consent', { version, accept: true }),
  withdraw: () => act<{ ok: true; withdrawn: number; pending: number }>('withdraw_consent', {}),
  disclosurePdf: () => act<{ base64: string; filename: string }>('disclosure_pdf', {}),
  verify: (sha256: string) => supabase.rpc('esign_verify_pdf', { p_sha256: sha256 }),
}

// Saves a PDF the function returned (base64) or opens its download link.
export function savePdf(r: { url?: string; base64?: string; filename: string }) {
  const a = document.createElement('a')
  a.rel = 'noopener'
  if (r.url) {
    a.href = r.url
  } else if (r.base64) {
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  } else return
  a.download = r.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function sha256OfFile(file: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
