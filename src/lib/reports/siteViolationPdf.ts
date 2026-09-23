import { format } from 'date-fns'
import { placePdfLogo, type PdfLogo } from '@/lib/pdfLogo'

export { openPdfInNewTab, downloadBlob } from './siteReviewPdf'

export type ViolationAttachment = { id: string; label: string | null; file_type: string | null; file_name: string | null; data_uri: string | null }

export type SiteViolationPdfInput = {
  siteName?: string | null
  department?: string | null
  violationType?: string | null
  severity?: string | null
  status?: string | null
  description?: string | null
  reportedByName?: string | null
  reportedAt?: string | null
  dueDate?: string | null
  resolvedByName?: string | null
  resolvedAt?: string | null
  resolutionNotes?: string | null
  attachments: ViolationAttachment[]
  logo: PdfLogo | null
}

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '-'
  const p = new Date(d)
  return Number.isNaN(p.getTime()) ? '-' : format(p, 'MMM d, yyyy')
}
const titleCase = (s: string | null | undefined): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : '-'

// Decode a base64 image data URI into a downscaled JPEG thumbnail with pixel
// size. Returns null on failure so one bad image never fails the export.
async function imageToThumb(src: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = src
    })
    const maxDim = 1400
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), w, h }
  } catch {
    return null
  }
}

export async function buildSiteViolationPdf(input: SiteViolationPdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })

  const marginX = 14
  const topMargin = 16
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - marginX * 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(11, 15, 20)
  doc.text('Site Violation', marginX, topMargin)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(110, 116, 124)
  const meta = ['Site: ' + (input.siteName ?? '-'), 'Department: ' + (input.department ?? '-'), 'Reported: ' + fmtDate(input.reportedAt)].join('  |  ')
  doc.text(meta, marginX, topMargin + 7)

  placePdfLogo(doc, input.logo, { width: 34, margin: marginX, y: 6 })

  // Detail rows (blank/absent fields dropped so resolved-only info is omitted
  // for open violations).
  const rows: [string, string][] = []
  const push = (k: string, v: string | null | undefined) => { if (v && String(v).trim()) rows.push([k, String(v).trim()]) }
  push('Violation Type', input.violationType)
  push('Severity', titleCase(input.severity))
  push('Status', titleCase(input.status))
  push('Reported by', input.reportedByName)
  push('Due date', input.dueDate ? fmtDate(input.dueDate) : null)
  push('Resolved by', input.resolvedByName)
  push('Resolved', input.resolvedAt ? fmtDate(input.resolvedAt) : null)
  push('Resolution notes', input.resolutionNotes)
  push('Notes / description', input.description)

  autoTable(doc, {
    startY: topMargin + 14,
    body: rows.length ? rows : [['-', '-']],
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, valign: 'top' },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.28, fontStyle: 'bold', textColor: [90, 96, 104] },
      1: { cellWidth: contentWidth * 0.72, textColor: [20, 24, 30] },
    },
  })
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // Photos: embed image attachments as thumbnails; list any non-image documents.
  const images = input.attachments.filter((a) => (a.file_type ?? '').startsWith('image/') && a.data_uri)
  const docs = input.attachments.filter((a) => !(a.file_type ?? '').startsWith('image/'))

  if (images.length) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(11, 15, 20)
    doc.text('Photos', marginX, y)
    y += 4

    const gap = 4
    const cols = 2
    const cellW = (contentWidth - gap * (cols - 1)) / cols
    const cellH = 55 // mm max per photo
    let col = 0
    for (const a of images) {
      const thumb = await imageToThumb(a.data_uri as string)
      if (y + cellH > pageHeight - 16) { doc.addPage(); y = topMargin }
      const x = marginX + col * (cellW + gap)
      if (thumb) {
        const ratio = thumb.w / thumb.h
        let w = cellW
        let h = w / ratio
        if (h > cellH) { h = cellH; w = h * ratio }
        try { doc.addImage(thumb.dataUrl, 'JPEG', x, y, w, h) } catch { /* skip a bad image */ }
      } else {
        doc.setDrawColor(210, 214, 220)
        doc.setFillColor(240, 242, 245)
        doc.rect(x, y, cellW, cellH, 'FD')
      }
      col += 1
      if (col >= cols) { col = 0; y += cellH + gap }
    }
    if (col !== 0) y += cellH + gap
  }

  if (docs.length) {
    if (y + 12 > pageHeight - 16) { doc.addPage(); y = topMargin }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(11, 15, 20)
    doc.text('Attached documents', marginX, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(90, 96, 104)
    for (const d of docs) {
      doc.text('• ' + (d.file_name ?? d.label ?? 'document'), marginX, y)
      y += 5
    }
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(140, 146, 154)
  doc.text('Generated ' + format(new Date(), 'MMM d, yyyy h:mm a'), marginX, pageHeight - 8)

  return doc.output('blob')
}
