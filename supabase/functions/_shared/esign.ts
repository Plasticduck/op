// Operator's e-signature engine: the pieces any signed document shares. The
// purchase-requests function is the first user; another document type adds a
// source_type (migration) and its own document builder and pages.
//
// Legal basis: the federal ESIGN Act (15 U.S.C. 7001 et seq.) and the Texas
// Uniform Electronic Transactions Act (Tex. Bus. & Com. Code ch. 322). What each
// requirement maps to is in docs/purchase-requests/ESIGN.md.

// Shown next to every Sign button and saved with each signature, so the record
// shows what the signer agreed to when they signed (intent to sign).
export const INTENT_VERSION = '2026-11-13'
export const INTENT_TEXT =
  'By selecting Sign, I adopt the signature shown above as my electronic signature on this record. ' +
  'I agree it is the legal equivalent of my handwritten signature, and I intend to sign.'

export const TZ = 'America/Chicago'

export type SignatureInput = { kind: 'drawn' | 'typed'; image: string; name: string }

export type Recipient = {
  id: string
  envelope_id: string
  user_id: string | null
  name: string
  email: string
  role: 'sender' | 'signer' | 'cc'
  label: string | null
  routing_order: number
  required_by_rule: string | null
  status: 'waiting' | 'sent' | 'viewed' | 'signed' | 'declined' | 'completed'
  sent_at: string | null
  viewed_at: string | null
  signed_at: string | null
  declined_at: string | null
  decline_reason: string | null
  paper_requested_at: string | null
  signature_kind: 'drawn' | 'typed' | 'paper' | null
  signature_image: string | null
  signature_name: string | null
  signature_sha256: string | null
  signed_document_hash: string | null
  consent_id: string | null
  ip: string | null
  user_agent: string | null
  paper_file_path: string | null
  paper_file_sha256: string | null
  paper_recorded_by: string | null
}

export type EsignEvent = {
  id: number
  envelope_id: string
  recipient_id: string | null
  actor_user_id: string | null
  actor_name: string | null
  actor_email: string | null
  event: string
  at: string
  ip: string | null
  user_agent: string | null
  detail: Record<string, unknown>
}

export type Envelope = {
  id: string
  account_id: string
  source_type: string
  source_id: string
  version: number
  title: string
  message: string | null
  document: Record<string, unknown>
  document_hash: string
  sign_in_order: boolean
  status: 'sent' | 'completed' | 'declined' | 'voided'
  created_by: string | null
  created_by_name: string
  created_by_email: string
  created_ip: string | null
  created_user_agent: string | null
  sent_at: string
  completed_at: string | null
  declined_at: string | null
  voided_at: string | null
  void_reason: string | null
  voided_by_name: string | null
  sealed_pdf_path: string | null
  sealed_pdf_sha256: string | null
  sealed_at: string | null
  seal_certificate: string | null
  seal_error: string | null
  last_reminded_at: string | null
}

export type Consent = {
  id: string
  user_id: string | null
  user_name: string
  user_email: string
  disclosure_version: string
  disclosure_sha256: string
  consented_at: string
  ip: string | null
  user_agent: string | null
  withdrawn_at: string | null
}

export type Disclosure = { version: string; title: string; body: string; body_sha256: string }

// JSON with keys sorted at every level and no whitespace, so the same content
// always hashes the same. undefined values are dropped, like JSON.stringify.
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}'
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (fwd || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown').slice(0, 64)
}

export function userAgent(req: Request): string {
  return (req.headers.get('user-agent') ?? 'unknown').slice(0, 400)
}

// "Chrome 142 on Windows", for the certificate. The full string is kept too.
export function describeUA(ua: string | null): string {
  if (!ua || ua === 'unknown') return 'Unknown device'
  const os = /iPhone|iPad|iPod/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone')
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux' : 'Unknown OS'
  const m = ua.match(/Edg\/(\d+)/) ? ['Edge', ua.match(/Edg\/(\d+)/)![1]]
    : ua.match(/OPR\/(\d+)/) ? ['Opera', ua.match(/OPR\/(\d+)/)![1]]
    : ua.match(/Firefox\/(\d+)/) ? ['Firefox', ua.match(/Firefox\/(\d+)/)![1]]
    : ua.match(/CriOS\/(\d+)/) ? ['Chrome', ua.match(/CriOS\/(\d+)/)![1]]
    : ua.match(/Chrome\/(\d+)/) ? ['Chrome', ua.match(/Chrome\/(\d+)/)![1]]
    : ua.match(/Version\/(\d+).*Safari/) ? ['Safari', ua.match(/Version\/(\d+).*Safari/)![1]]
    : /WashLyfe|wv\)/.test(ua) ? ['Operator app', ''] : null
  const browser = m ? `${m[0]}${m[1] ? ' ' + m[1] : ''}` : 'Browser'
  return `${browser} on ${os}`
}

// "Nov 13, 2026, 3:42:10 PM CST"
export function fmtTime(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return ''
  // Newer ICU puts a narrow no-break space before AM/PM; plain spaces print everywhere.
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(new Date(iso)).replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
}

// "2026-11-13T22:04:13.324Z", whatever precision the database returned.
export function isoUtc(iso: string | null | undefined): string {
  return iso ? new Date(iso).toISOString() : ''
}

// Characters the PDF's standard fonts (WinAnsi) can print. Anything else would make
// jsPDF re-encode the whole line and space it out, so it is swapped or replaced.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
export function pdfSafe(s: string): string {
  return s
    .replace(/[\u00a0\u2002\u2003\u2007\u2009\u200a\u202f]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\u2010-\u2012]/g, '-')
    .replace(/[^\x00-\xff]/gu, (c) => (WIN_ANSI_EXTRA.has(c) ? c : '?'))
}

export function fmtDate(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
}

// The routing step being signed now: the lowest order among signers who haven't
// signed. null once every signer has.
export function activeOrder(recipients: Pick<Recipient, 'role' | 'status' | 'routing_order'>[]): number | null {
  const open = recipients.filter((r) => r.role === 'signer' && r.status !== 'signed')
  return open.length ? Math.min(...open.map((r) => r.routing_order)) : null
}

export function allSigned(recipients: Pick<Recipient, 'role' | 'status'>[]): boolean {
  return recipients.filter((r) => r.role === 'sender' || r.role === 'signer').every((r) => r.status === 'signed')
}

// A signature arrives as a PNG data URL drawn or typed on the device. Only a
// real PNG of a sensible size is accepted.
export function parsePng(dataUrl: string): { bytes: Uint8Array; width: number; height: number } | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '')
  if (!m || m[1].length > 380_000) return null
  let bin: string
  try { bin = atob(m[1]) } catch { return null }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return null
  const dv = new DataView(bytes.buffer)
  const width = dv.getUint32(16)
  const height = dv.getUint32(20)
  if (!width || !height || width > 4000 || height > 2000) return null
  return { bytes, width, height }
}

export function validSignature(s: unknown): s is SignatureInput {
  const v = s as SignatureInput
  return !!v && (v.kind === 'drawn' || v.kind === 'typed') && typeof v.name === 'string'
    && v.name.trim().length >= 2 && v.name.length <= 120 && !!parsePng(v.image)
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

export function usd(n: number | string): string {
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
