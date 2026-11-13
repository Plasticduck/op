// The signed-record PDF: the parts every signed document shares. The certificate
// of completion (who signed what, when, from where, and how), the disclosure each
// signer accepted, an envelope ID on every page, and the digital seal.
//
// The seal is a PDF digital signature (adbe.pkcs7.detached) made with Operator's
// seal certificate (secrets ESIGN_SEAL_P12, base64 PKCS#12, and
// ESIGN_SEAL_P12_PASS). Adobe Acrobat/Reader shows it in the Signature Panel and
// reports any change made to the file after sealing. Without the secrets the PDF
// is still built and fingerprinted; it just isn't digitally sealed.

import { jsPDF } from 'npm:jspdf@4.2.1'
import autoTableImport from 'npm:jspdf-autotable@5.0.8'
import { SignPdf } from 'npm:@signpdf/signpdf@3.2.5'
import { P12Signer } from 'npm:@signpdf/signer-p12@3.2.4'
import { plainAddPlaceholder } from 'npm:@signpdf/placeholder-plain@3.2.5'
import forge from 'npm:node-forge@1.3.1'
import { Buffer } from 'node:buffer'
import {
  type Consent, type Disclosure, type Envelope, type EsignEvent, type Recipient,
  describeUA, fmtTime, fromBase64, INTENT_TEXT, isoUtc, parsePng, pdfSafe, TZ,
} from './esign.ts'

// deno-lint-ignore no-explicit-any
export type Doc = any

// The package's types miss its default-export call signature; it is the function at runtime.
// deno-lint-ignore no-explicit-any
export const autoTable = autoTableImport as unknown as (doc: Doc, options: Record<string, any>) => void

export const PAGE = { w: 612, h: 792, m: 48 }
const INK: [number, number, number] = [17, 24, 39]
const MUTED: [number, number, number] = [100, 108, 120]
const LINE: [number, number, number] = [221, 225, 231]
const ACCENT: [number, number, number] = [37, 99, 235]
const OK: [number, number, number] = [21, 128, 61]

export function newDoc(): Doc {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true }) as Doc
  doc.setProperties({ creator: 'Operator (operator.washlyfe.com)', producer: 'Operator e-signature' })
  // Every string drawn (including autoTable's cells) goes through pdfSafe.
  const text = doc.text.bind(doc)
  // deno-lint-ignore no-explicit-any
  doc.text = (t: string | string[], ...rest: any[]) => text(Array.isArray(t) ? t.map(pdfSafe) : pdfSafe(String(t)), ...rest)
  const split = doc.splitTextToSize.bind(doc)
  // deno-lint-ignore no-explicit-any
  doc.splitTextToSize = (t: string | string[], ...rest: any[]) => split(Array.isArray(t) ? t.map((x) => pdfSafe(String(x ?? ''))) : pdfSafe(String(t ?? '')), ...rest)
  return doc
}

// Starts a new page when `need` points won't fit; returns the y to draw at.
export function ensure(doc: Doc, y: number, need: number): number {
  if (y + need <= PAGE.h - 60) return y
  doc.addPage()
  return 60
}

export function heading(doc: Doc, y: number, text: string): number {
  y = ensure(doc, y, 40)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK)
  doc.text(text, PAGE.m, y)
  doc.setDrawColor(...LINE); doc.setLineWidth(0.75)
  doc.line(PAGE.m, y + 5, PAGE.w - PAGE.m, y + 5)
  return y + 20
}

export function paragraph(doc: Doc, y: number, text: string, o: { size?: number; color?: [number, number, number]; width?: number; x?: number; bold?: boolean } = {}): number {
  const size = o.size ?? 9.5
  doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(o.color ?? INK))
  const lines: string[] = doc.splitTextToSize(text || ' ', o.width ?? PAGE.w - PAGE.m * 2)
  const lh = size * 1.35
  for (const line of lines) {
    y = ensure(doc, y, lh)
    doc.text(line, o.x ?? PAGE.m, y)
    y += lh
  }
  return y
}

// A signature image fitted inside a box, keeping its shape.
export function drawSignature(doc: Doc, dataUrl: string, x: number, y: number, maxW: number, maxH: number) {
  const png = parsePng(dataUrl)
  if (!png) return
  const scale = Math.min(maxW / png.width, maxH / png.height)
  const w = png.width * scale
  const h = png.height * scale
  doc.addImage(png.bytes, 'PNG', x, y + (maxH - h) / 2, w, h)
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Envelope created',
  consent: 'Accepted the e-sign disclosure',
  signed: 'Signed',
  sent: 'Sent for signature',
  viewed: 'Viewed',
  declined: 'Declined',
  voided: 'Voided',
  completed: 'Completed',
  sealed: 'Sealed',
  email_sent: 'Email sent',
  reminder_sent: 'Reminder sent',
  paper_requested: 'Asked to sign on paper',
  paper_signed: 'Paper signature recorded',
  consent_withdrawn: 'Withdrew e-sign consent',
  downloaded: 'Downloaded',
  purchased: 'Marked purchased',
}
export const eventLabel = (e: string) => EVENT_LABEL[e] ?? e

function roleLabel(r: Recipient): string {
  return r.label || (r.role === 'sender' ? 'Sender' : r.role === 'cc' ? 'Copy' : 'Signer')
}

function adoption(r: Recipient): string {
  if (r.signature_kind === 'paper') return 'Signed on paper (scan attached to the record)'
  if (r.signature_kind === 'drawn') return 'Drawn on device'
  if (r.signature_kind === 'typed') return 'Typed, shown in a signature style'
  return ''
}

// Certificate of Completion: the audit trail as part of the record itself.
export function addCertificate(doc: Doc, o: {
  company: string
  envelope: Envelope
  recipients: Recipient[]
  events: EsignEvent[]
  consents: Map<string, Consent>
  documentLabel: string
  documentPages: number
  seal: { subject: string; fingerprint: string } | null
  statusLabel: string
}) {
  const { envelope: env } = o
  doc.addPage()
  let y = 64
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK)
  doc.text('Certificate of Completion', PAGE.m, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED)
  doc.text(`${o.company} · Electronic signature audit trail`, PAGE.m, y + 16)
  drawSealBadge(doc, PAGE.w - PAGE.m - 34, y - 2, env.status === 'completed' && !!o.seal)
  y += 34

  const originator = o.recipients.find((r) => r.role === 'sender')
  const summary: [string, string][] = [
    ['Envelope ID', env.id.toUpperCase()],
    ['Subject', env.title],
    ['Document', `${o.documentLabel} (${o.documentPages} page${o.documentPages === 1 ? '' : 's'} plus this certificate)`],
    ['Document fingerprint', `SHA-256 ${env.document_hash}`],
    ['Status', o.statusLabel],
    ['Signing order', env.sign_in_order ? 'In order, one step at a time' : 'Any order'],
    ['Envelope originator', `${env.created_by_name} (${env.created_by_email})${env.created_ip ? `, IP ${env.created_ip}` : ''}`],
    ['Sent', `${fmtTime(env.sent_at)} (${isoUtc(env.sent_at)})`],
  ]
  if (env.completed_at) summary.push(['Completed', `${fmtTime(env.completed_at)} (${isoUtc(env.completed_at)})`])
  if (env.declined_at) summary.push(['Declined', fmtTime(env.declined_at)])
  if (env.voided_at) summary.push(['Voided', `${fmtTime(env.voided_at)}${env.void_reason ? `. Reason: ${env.void_reason}` : ''}`])
  summary.push(['Time zone', `All times are US Central (${TZ}); UTC shown in parentheses where given.`])
  if (o.seal) summary.push(['Seal certificate', `${o.seal.subject}; SHA-256 fingerprint ${o.seal.fingerprint}`])

  autoTable(doc, {
    startY: y,
    body: summary,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: { top: 3, bottom: 3, left: 0, right: 6 }, textColor: INK, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 118, textColor: MUTED, fontStyle: 'bold' }, 1: { cellWidth: PAGE.w - PAGE.m * 2 - 118 } },
    margin: { left: PAGE.m, right: PAGE.m, top: 60, bottom: 60 },
  })
  y = doc.lastAutoTable.finalY + 18

  // Signers: identity, how they signed, where from, and every timestamp.
  y = heading(doc, y, 'Signer events')
  const signers = o.recipients.filter((r) => r.role !== 'cc').sort((a, b) => a.routing_order - b.routing_order)
  const rows = signers.map((r) => {
    const c = r.consent_id ? o.consents.get(r.consent_id) : undefined
    const who = [r.name, r.email, roleLabel(r) + (r.required_by_rule ? ` (required by rule: ${r.required_by_rule})` : '')]
    const security = [
      'Authentication: signed in to Operator',
      r.ip ? `IP address: ${r.ip}` : '',
      r.user_agent ? `Device: ${describeUA(r.user_agent)}` : '',
    ].filter(Boolean)
    const sig = [
      r.status === 'signed' ? adoption(r) : r.status === 'declined' ? 'Declined' : 'Not signed',
      r.signature_kind && r.signature_kind !== 'paper' ? `Signature ID: ${r.id.slice(0, 8).toUpperCase()}` : '',
      r.signature_sha256 ? `Image SHA-256: ${r.signature_sha256.slice(0, 16)}…` : '',
      r.paper_file_sha256 ? `Scan SHA-256: ${r.paper_file_sha256.slice(0, 16)}…` : '',
      r.paper_recorded_by ? `Recorded by ${r.paper_recorded_by}` : '',
    ].filter(Boolean)
    const times = [
      r.sent_at ? `Sent: ${fmtTime(r.sent_at)}` : '',
      r.viewed_at ? `Viewed: ${fmtTime(r.viewed_at)}` : '',
      r.signed_at ? `Signed: ${fmtTime(r.signed_at)}` : '',
      r.declined_at ? `Declined: ${fmtTime(r.declined_at)}` : '',
      r.decline_reason ? `Reason: ${r.decline_reason}` : '',
      c ? `Disclosure accepted: ${fmtTime(c.consented_at)} (version ${c.disclosure_version}, ID ${c.id.slice(0, 8).toUpperCase()})` : '',
    ].filter(Boolean)
    return [[...who, '', ...security].join('\n'), sig.join('\n'), times.join('\n')]
  })
  autoTable(doc, {
    startY: y,
    head: [['Signer', 'Signature', 'Timestamps']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 7.8, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: [243, 244, 246], textColor: MUTED, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 190 }, 1: { cellWidth: 150, minCellHeight: 92 }, 2: { cellWidth: PAGE.w - PAGE.m * 2 - 340 } },
    margin: { left: PAGE.m, right: PAGE.m, top: 60, bottom: 60 },
    // deno-lint-ignore no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 1 && signers[data.row.index]?.signature_image) {
        data.cell.styles.cellPadding = { top: 52, left: 5, right: 5, bottom: 5 }
      }
    },
    // deno-lint-ignore no-explicit-any
    didDrawCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 1) return
      const img = signers[data.row.index]?.signature_image
      if (img) drawSignature(doc, img, data.cell.x + 6, data.cell.y + 6, data.cell.width - 12, 40)
    },
  })
  y = doc.lastAutoTable.finalY + 18

  const ccs = o.recipients.filter((r) => r.role === 'cc')
  if (ccs.length) {
    y = heading(doc, y, 'Copies sent')
    autoTable(doc, {
      startY: y,
      head: [['Name', 'Email', 'Completed copy sent']],
      body: ccs.map((r) => [r.name, r.email, r.sent_at ? fmtTime(r.sent_at) : 'When completed']),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.5 },
      headStyles: { fillColor: [243, 244, 246], textColor: MUTED, fontStyle: 'bold' },
      margin: { left: PAGE.m, right: PAGE.m, top: 60, bottom: 60 },
    })
    y = doc.lastAutoTable.finalY + 18
  }

  y = heading(doc, y, 'Envelope history')
  const shown = o.events.filter((e) => e.event !== 'downloaded')
  autoTable(doc, {
    startY: y,
    head: [['Event', 'By', 'Time (Central)', 'IP address']],
    body: shown.map((e) => {
      const d = e.detail ?? {}
      const extra = typeof d.to === 'string' ? ` to ${d.to}` : typeof d.reason === 'string' && d.reason ? `: ${d.reason}` : ''
      return [eventLabel(e.event) + extra, [e.actor_name, e.actor_email].filter(Boolean).join('\n') || 'Operator', `${fmtTime(e.at)}\n${isoUtc(e.at)}`, e.ip ?? '']
    }),
    theme: 'grid',
    styles: { fontSize: 7.6, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.5, overflow: 'linebreak' },
    headStyles: { fillColor: [243, 244, 246], textColor: MUTED, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 170 }, 1: { cellWidth: 140 }, 2: { cellWidth: 130 } },
    margin: { left: PAGE.m, right: PAGE.m, top: 60, bottom: 60 },
  })
  y = doc.lastAutoTable.finalY + 18

  y = heading(doc, y, 'Legal notice')
  y = paragraph(doc, y,
    'Each signature in this record was applied electronically under the federal Electronic Signatures in Global and National ' +
    'Commerce Act (15 U.S.C. 7001 et seq.) and the Texas Uniform Electronic Transactions Act (Texas Business and Commerce Code, ' +
    'Chapter 322). Before signing, each signer reviewed the document, accepted the Electronic Record and Signature Disclosure ' +
    'included at the end of this record (or signed on paper), adopted their signature, and confirmed this statement: "' + INTENT_TEXT + '"',
    { size: 8.5 })
  y += 6
  y = paragraph(doc, y,
    'Each signature is linked to the document fingerprint above, which covers the full content that was signed. Operator ' +
    'recorded the time of every step on its own servers. ' +
    (o.seal
      ? 'This file is digitally sealed with the certificate named above. Adobe Acrobat or Reader shows the seal in its Signature ' +
        'Panel, and any change made to the file after sealing breaks it. '
      : '') +
    'To confirm a copy is the original, use Verify a PDF on the Purchase Requests page in Operator.',
    { size: 8.5, color: MUTED })
}

function drawSealBadge(doc: Doc, cx: number, cy: number, sealed: boolean) {
  const c = sealed ? OK : MUTED
  doc.setDrawColor(...c); doc.setLineWidth(1.6)
  doc.circle(cx, cy, 26)
  doc.setLineWidth(0.6)
  doc.circle(cx, cy, 22)
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...c)
  doc.setFontSize(7.5)
  doc.text(sealed ? 'SEALED' : 'NOT', cx, cy - 2, { align: 'center' })
  doc.setFontSize(5.6)
  doc.text(sealed ? 'OPERATOR' : 'SEALED', cx, cy + 6, { align: 'center' })
}

// The disclosure each signer agreed to, word for word, as part of the record.
export function addDisclosure(doc: Doc, d: Disclosure, company: string, accepted: { name: string; at: string }[], newPage = true) {
  if (newPage) doc.addPage()
  let y = 64
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK)
  doc.text(d.title, PAGE.m, y)
  y += 16
  y = paragraph(doc, y, `Version ${d.version} · SHA-256 ${d.body_sha256}`, { size: 8, color: MUTED })
  if (accepted.length) {
    y = paragraph(doc, y, 'Accepted by: ' + accepted.map((a) => `${a.name} (${fmtTime(a.at)})`).join('; '), { size: 8, color: MUTED })
  }
  y += 8
  for (const raw of d.body.replaceAll('{company}', company).split('\n')) {
    const line = raw.trimEnd()
    if (!line) { y += 5; continue }
    if (line.startsWith('## ')) {
      y += 4
      y = paragraph(doc, y, line.slice(3), { size: 10.5, bold: true })
      y += 1
    } else if (line.startsWith('- ')) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
      y = ensure(doc, y, 13)
      doc.setTextColor(...INK)
      doc.text('•', PAGE.m + 4, y)
      y = paragraph(doc, y, line.slice(2), { x: PAGE.m + 16, width: PAGE.w - PAGE.m * 2 - 16 })
    } else {
      y = paragraph(doc, y, line)
    }
  }
}

// The envelope ID on top of every page, page numbers below, and a banner plus
// watermark on any copy that isn't a completed record.
export function stampPages(doc: Doc, o: { envelopeId: string | null; footer: string; banner?: string | null }) {
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    if (o.envelopeId) doc.text(`Operator Envelope ID: ${o.envelopeId.toUpperCase()}`, PAGE.m, 30)
    doc.text(o.footer, PAGE.m, PAGE.h - 28)
    doc.text(`Page ${i} of ${n}`, PAGE.w - PAGE.m, PAGE.h - 28, { align: 'right' })
    if (o.banner) {
      doc.setFillColor(185, 28, 28)
      doc.rect(0, 0, PAGE.w, 16, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
      doc.text(o.banner, PAGE.w / 2, 11, { align: 'center' })
      try {
        doc.saveGraphicsState()
        doc.setGState(new doc.GState({ opacity: 0.07 }))
        doc.setFont('helvetica', 'bold'); doc.setFontSize(64); doc.setTextColor(185, 28, 28)
        const word = o.banner.split(':')[0].trim() || 'COPY'
        const tw = doc.getTextWidth(word)
        const a = (35 * Math.PI) / 180
        doc.text(word, PAGE.w / 2 - (tw / 2) * Math.cos(a), PAGE.h / 2 + (tw / 2) * Math.sin(a), { angle: 35 })
        doc.restoreGraphicsState()
      } catch { /* watermark is a nicety; the banner says it */ }
    }
  }
  doc.setPage(n)
}

export function pdfBytes(doc: Doc): Uint8Array {
  return new Uint8Array(doc.output('arraybuffer'))
}

export type SealCert = { subject: string; fingerprint: string; p12: Uint8Array; pass: string }

let cachedCert: SealCert | null | undefined
export function loadSealCert(): SealCert | null {
  if (cachedCert !== undefined) return cachedCert
  const b64 = Deno.env.get('ESIGN_SEAL_P12')?.replace(/\s+/g, '')
  const pass = Deno.env.get('ESIGN_SEAL_P12_PASS') ?? ''
  if (!b64) return (cachedCert = null)
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(b64)), pass)
    const bag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]
    if (!bag?.cert) throw new Error('no certificate in the seal file')
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(bag.cert)).getBytes()
    const md = forge.md.sha256.create()
    md.update(der)
    const fingerprint = (md.digest().toHex().toUpperCase().match(/../g) ?? []).join(':')
    // deno-lint-ignore no-explicit-any
    const subject = bag.cert.subject.attributes.map((a: any) => `${a.shortName ?? a.name}=${a.value}`).join(', ')
    cachedCert = { subject, fingerprint, p12: fromBase64(b64), pass }
  } catch (e) {
    console.error('[esign] seal certificate unusable:', String((e as Error)?.message ?? e))
    cachedCert = null
  }
  return cachedCert
}

// Digitally signs the finished PDF with the seal certificate.
export async function sealPdf(pdf: Uint8Array, cert: SealCert, o: { reason: string; signedAt: Date }): Promise<Uint8Array> {
  const withPlaceholder = plainAddPlaceholder({
    pdfBuffer: Buffer.from(pdf),
    reason: o.reason.slice(0, 200),
    contactInfo: 'operator.washlyfe.com',
    name: 'Operator Document Seal',
    location: 'United States',
    signatureLength: 16384,
  })
  const signer = new P12Signer(Buffer.from(cert.p12), { passphrase: cert.pass })
  const signed = await new SignPdf().sign(withPlaceholder, signer, o.signedAt)
  return new Uint8Array(signed)
}

export const PDF_COLORS = { INK, MUTED, LINE, ACCENT, OK }
