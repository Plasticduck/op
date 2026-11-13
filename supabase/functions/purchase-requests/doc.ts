// A purchase request as a signed document: the exact snapshot that is
// fingerprinted and signed, and its pages in the PDF.
import { type Recipient, fmtDate, fmtTime, money, usd } from '../_shared/esign.ts'
import { autoTable, type Doc, drawSignature, ensure, heading, PAGE, paragraph, PDF_COLORS } from '../_shared/esign_pdf.ts'

export type LineItem = { description?: string; quantity?: number | string; unit_price?: number | string }

export type PrRow = {
  id: string
  account_id: string
  number: number
  requester_id: string | null
  requester_name: string
  requester_email: string
  title: string
  vendor: string | null
  site: string | null
  category: string | null
  gl_code: string | null
  payment_method: string | null
  needed_by: string | null
  priority: 'normal' | 'urgent'
  justification: string | null
  line_items: LineItem[]
  subtotal: number
  shipping: number
  tax: number
  total: number
  status: 'draft' | 'pending' | 'approved' | 'purchased' | 'declined' | 'voided'
  envelope_id: string | null
  ever_sent: boolean
  submitted_at: string | null
  approved_at: string | null
  purchased_at: string | null
  purchased_by_name: string | null
  po_number: string | null
  actual_amount: number | null
  purchase_note: string | null
}

export type PrFile = { id: string; name: string; size: number | null; sha256: string | null; path: string }

export type Party = { user_id: string; name: string; email: string; required_by_rule?: string | null }

export type PrDocument = {
  type: 'purchase_request'
  schema: 1
  company: string
  request_id: string
  number: string
  version: number
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
  currency: 'USD'
  requester: { id: string; name: string; email: string }
  attachments: { id: string; name: string; size: number; sha256: string }[]
  routing: {
    sign_in_order: boolean
    signers: { user_id: string; name: string; email: string; order: number; required_by_rule: string | null }[]
    cc: { user_id: string; name: string; email: string }[]
  }
}

export const prNumber = (n: number) => `PR-${n}`

// Money in cents so the snapshot's math is exact.
const cents = (v: unknown) => Math.round(Number(v || 0) * 100)

export function lineAmounts(items: LineItem[]) {
  const lines = items.map((it) => {
    const q = Number(it.quantity || 0)
    const unit = cents(it.unit_price)
    return { description: String(it.description ?? '').trim(), q, unit, amount: Math.round(q * unit) }
  })
  return { lines, subtotal: lines.reduce((s, l) => s + l.amount, 0) }
}

// What a request needs before it can be sent. Returns the problems, if any.
export function validate(pr: PrRow): string[] {
  const out: string[] = []
  if (!pr.title.trim()) out.push('Add what you are buying.')
  if (!pr.vendor?.trim()) out.push('Add the vendor.')
  if (!pr.site?.trim()) out.push('Pick the site.')
  if (!pr.category?.trim()) out.push('Pick a category.')
  if (!pr.justification?.trim()) out.push('Add the business reason.')
  const items = Array.isArray(pr.line_items) ? pr.line_items : []
  if (!items.length) out.push('Add at least one line item.')
  items.forEach((it, i) => {
    const q = Number(it.quantity)
    const p = Number(it.unit_price)
    if (!String(it.description ?? '').trim()) out.push(`Line ${i + 1} needs a description.`)
    if (!(q > 0) || !/^\d+(\.\d{1,3})?$/.test(String(it.quantity))) out.push(`Line ${i + 1} needs a quantity above 0 (up to 3 decimals).`)
    if (!(p >= 0) || !/^\d+(\.\d{1,2})?$/.test(String(it.unit_price))) out.push(`Line ${i + 1} needs a unit price in dollars and cents.`)
  })
  if (Number(pr.total) <= 0) out.push('The total must be more than $0.00.')
  return out
}

export function buildDocument(o: {
  pr: PrRow
  company: string
  version: number
  files: PrFile[]
  signers: Party[]
  cc: Party[]
  signInOrder: boolean
}): PrDocument {
  const { pr } = o
  const { lines, subtotal } = lineAmounts(pr.line_items ?? [])
  const shipping = cents(pr.shipping)
  const tax = cents(pr.tax)
  return {
    type: 'purchase_request',
    schema: 1,
    company: o.company,
    request_id: pr.id,
    number: prNumber(pr.number),
    version: o.version,
    title: pr.title.trim(),
    vendor: (pr.vendor ?? '').trim(),
    site: (pr.site ?? '').trim(),
    category: (pr.category ?? '').trim(),
    gl_code: (pr.gl_code ?? '').trim(),
    payment_method: (pr.payment_method ?? '').trim(),
    needed_by: pr.needed_by ?? '',
    priority: pr.priority === 'urgent' ? 'Urgent' : 'Normal',
    justification: (pr.justification ?? '').trim(),
    line_items: lines.map((l) => ({
      description: l.description,
      quantity: String(l.q),
      unit_price: money(l.unit / 100),
      amount: money(l.amount / 100),
    })),
    subtotal: money(subtotal / 100),
    shipping: money(shipping / 100),
    tax: money(tax / 100),
    total: money((subtotal + shipping + tax) / 100),
    currency: 'USD',
    requester: { id: pr.requester_id ?? '', name: pr.requester_name, email: pr.requester_email },
    attachments: o.files.map((f) => ({ id: f.id, name: f.name, size: Number(f.size ?? 0), sha256: f.sha256 ?? '' })),
    routing: {
      sign_in_order: o.signInOrder,
      signers: o.signers.map((s, i) => ({
        user_id: s.user_id, name: s.name, email: s.email,
        order: o.signInOrder ? i + 1 : 1, required_by_rule: s.required_by_rule ?? null,
      })),
      cc: o.cc.map((c) => ({ user_id: c.user_id, name: c.name, email: c.email })),
    },
  }
}

function fileSize(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

// The purchase request itself: details, line items, reason, attachments and the
// signature blocks. Returns how many pages it took.
export function renderRequest(doc: Doc, d: PrDocument, recipients: Recipient[], o: {
  logo: { bytes: Uint8Array; w: number; h: number } | null
  sentAt: string | null
  statusLabel: string
}): number {
  const { INK, MUTED, LINE } = PDF_COLORS
  let y = 64
  if (o.logo) {
    const w = 110
    const h = Math.min(54, w * (o.logo.h / o.logo.w))
    const ww = h * (o.logo.w / o.logo.h)
    doc.addImage(o.logo.bytes, 'JPEG', PAGE.w - PAGE.m - ww, 44, ww, h)
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...MUTED)
  doc.text(d.company.toUpperCase(), PAGE.m, y)
  doc.setFontSize(20); doc.setTextColor(...INK)
  doc.text('Purchase Request', PAGE.m, y + 22)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...MUTED)
  doc.text(`${d.number} · Version ${d.version} · ${o.statusLabel}`, PAGE.m, y + 38)
  y += 62

  y = paragraph(doc, y, d.title, { size: 13, bold: true })
  y += 4

  const pairs: [string, string][] = [
    ['Requested by', `${d.requester.name} (${d.requester.email})`],
    ['Submitted', o.sentAt ? fmtTime(o.sentAt) : 'Not sent yet'],
    ['Vendor', d.vendor],
    ['Site', d.site],
    ['Category', d.category],
    ['GL code', d.gl_code || 'Not set'],
    ['Payment method', d.payment_method || 'Not set'],
    ['Needed by', d.needed_by ? fmtDate(d.needed_by) : 'No date'],
    ['Priority', d.priority],
    ['Total', usd(d.total)],
  ]
  const colW = (PAGE.w - PAGE.m * 2) / 2
  for (let i = 0; i < pairs.length; i += 2) {
    y = ensure(doc, y, 30)
    for (let j = 0; j < 2; j++) {
      const p = pairs[i + j]
      if (!p) continue
      const x = PAGE.m + j * colW
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
      doc.text(p[0].toUpperCase(), x, y)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK)
      doc.text(doc.splitTextToSize(p[1], colW - 12)[0] ?? '', x, y + 13)
    }
    y += 30
  }
  y += 4

  y = heading(doc, y, 'Line items')
  autoTable(doc, {
    startY: y,
    head: [['#', 'Description', 'Qty', 'Unit price', 'Amount']],
    body: d.line_items.map((l, i) => [String(i + 1), l.description, l.quantity, usd(l.unit_price), usd(l.amount)]),
    foot: [
      ['', '', '', 'Subtotal', usd(d.subtotal)],
      ['', '', '', 'Shipping', usd(d.shipping)],
      ['', '', '', 'Tax', usd(d.tax)],
      ['', '', '', 'Total', usd(d.total)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5, overflow: 'linebreak' },
    headStyles: { fillColor: [243, 244, 246], textColor: MUTED, fontStyle: 'bold' },
    footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' }, 2: { cellWidth: 48, halign: 'right' },
      3: { cellWidth: 82, halign: 'right' }, 4: { cellWidth: 86, halign: 'right' },
    },
    margin: { left: PAGE.m, right: PAGE.m, top: 60, bottom: 60 },
  })
  y = doc.lastAutoTable.finalY + 20

  y = heading(doc, y, 'Business reason')
  y = paragraph(doc, y, d.justification)
  y += 10

  if (d.attachments.length) {
    y = heading(doc, y, 'Attachments')
    autoTable(doc, {
      startY: y,
      head: [['File', 'Size', 'SHA-256 fingerprint']],
      body: d.attachments.map((a) => [a.name, fileSize(a.size), a.sha256]),
      theme: 'grid',
      styles: { fontSize: 7.8, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.5, overflow: 'linebreak' },
      headStyles: { fillColor: [243, 244, 246], textColor: MUTED, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 170 }, 1: { cellWidth: 52 }, 2: { font: 'courier', fontSize: 7 } },
      margin: { left: PAGE.m, right: PAGE.m, top: 60, bottom: 60 },
    })
    y = doc.lastAutoTable.finalY + 8
    y = paragraph(doc, y, 'Attachments are kept with this record in Operator. Each fingerprint identifies the exact file that was signed.', { size: 7.8, color: MUTED })
    y += 10
  }

  y = ensure(doc, y, 136)
  y = heading(doc, y, 'Signatures')
  const parties = recipients.filter((r) => r.role !== 'cc').sort((a, b) => a.routing_order - b.routing_order)
  for (const r of parties) {
    y = ensure(doc, y, 84)
    const boxW = 210
    if (r.signature_image) drawSignature(doc, r.signature_image, PAGE.m, y, boxW, 46)
    else if (r.signature_kind === 'paper') {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(...MUTED)
      doc.text('Signed on paper (scan attached)', PAGE.m, y + 30)
    }
    doc.setDrawColor(...INK); doc.setLineWidth(0.6)
    doc.line(PAGE.m, y + 50, PAGE.m + boxW, y + 50)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK)
    doc.text(r.signature_name || r.name, PAGE.m, y + 63)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(r.label ?? '', PAGE.m, y + 74)

    const x2 = PAGE.m + boxW + 24
    const info = r.status === 'signed'
      ? [`Signed ${fmtTime(r.signed_at)}`, r.signature_kind === 'paper' ? `Recorded by ${r.paper_recorded_by ?? 'Accounts Payable'}` : `Signature ID ${r.id.slice(0, 8).toUpperCase()}`, r.ip ? `IP ${r.ip}` : '', r.email]
      : r.status === 'declined'
        ? [`Declined ${fmtTime(r.declined_at)}`, r.decline_reason ? `Reason: ${r.decline_reason}` : '', r.email]
        : ['Awaiting signature', r.email]
    doc.setFontSize(8.5)
    let yy = y + 18
    for (const line of info.filter(Boolean)) {
      doc.setTextColor(...(line.startsWith('Signed') ? PDF_COLORS.OK : line.startsWith('Declined') ? [185, 28, 28] as [number, number, number] : MUTED))
      for (const l of doc.splitTextToSize(line, PAGE.w - PAGE.m - x2)) { doc.text(l, x2, yy); yy += 11 }
    }
    y += 92
  }
  return doc.getNumberOfPages()
}
