import { format } from 'date-fns'
import type { SiteReviewSchema, SiteReviewAnswers } from '@/features/opssuite/siteReviewSchema'

export type SiteReviewPdfInput = {
  title?: string
  siteName?: string | null
  date?: string | null
  weather?: string | null
  timeArrived?: string | null
  schema: SiteReviewSchema
  answers: SiteReviewAnswers
  summaryText?: string | null
  submitterName?: string | null
  // Resolved item photos, keyed by storage path. `url` is a long-lived signed URL
  // used for the clickable link; `dataUrl` (+ pixel size) is the embedded JPEG
  // thumbnail, absent when the source couldn't be decoded (e.g. HEIC).
  photoImages?: Record<string, { url: string; dataUrl?: string; w?: number; h?: number }>
  // Optional brand logo drawn at the top-right (e.g. the account's wash logo).
  logo?: { dataUrl: string; w: number; h: number } | null
}

function drawPhotoPlaceholder(
  doc: { setDrawColor: (r: number, g: number, b: number) => void; setFillColor: (r: number, g: number, b: number) => void; rect: (x: number, y: number, w: number, h: number, style: string) => void; setFontSize: (n: number) => void; setTextColor: (r: number, g: number, b: number) => void; text: (t: string, x: number, y: number, o?: { align: 'center' }) => void },
  x: number, y: number, w: number, h: number,
): void {
  doc.setDrawColor(210, 214, 220)
  doc.setFillColor(240, 242, 245)
  doc.rect(x, y, w, h, 'FD')
  doc.setFontSize(7)
  doc.setTextColor(140, 146, 154)
  doc.text('Photo', x + w / 2, y + h / 2, { align: 'center' })
}

const fmt12 = (hhmm: string | null | undefined): string => {
  if (!hhmm) return '-'
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return '-'
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + period
}

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '-'
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return '-'
  return format(parsed, 'MMM d, yyyy')
}

const fmtDateTime = (d: Date): string => format(d, 'MMM d, yyyy h:mm a')

type JsPdf = import('jspdf').jsPDF
type AutoTableFn = (typeof import('jspdf-autotable'))['default']

// Renders one review onto the current page (and any overflow pages). Shared by
// the single-review PDF and the multi-review list export.
function renderReview(doc: JsPdf, autoTable: AutoTableFn, input: SiteReviewPdfInput): void {
  doc.setFont('helvetica', 'normal')

  const marginX = 14
  const topMargin = 16
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - marginX * 2

  const title = input.title ?? 'Monthly Site Review'

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(11, 15, 20)
  doc.text(title, marginX, topMargin)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(110, 116, 124)
  const meta = [
    'Site: ' + (input.siteName ?? '-'),
    'Date: ' + fmtDate(input.date),
    'Weather: ' + (input.weather ?? '-'),
    'Time Arrived: ' + fmt12(input.timeArrived),
  ].join('  |  ')
  doc.text(meta, marginX, topMargin + 7)

  if (input.logo?.dataUrl) {
    const logoH = 18
    const logoW = input.logo.w > 0 && input.logo.h > 0 ? logoH * (input.logo.w / input.logo.h) : logoH
    try {
      doc.addImage(input.logo.dataUrl, 'PNG', pageWidth - marginX - logoW, 6, logoW, logoH)
    } catch {
      // Skip a logo jsPDF can't decode.
    }
  }

  let y = topMargin + 14

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 20) {
      doc.addPage()
      y = topMargin
    }
  }

  for (const section of input.schema.sections) {
    const rows: Array<[string, string, string]> = []
    for (const item of section.items) {
      if (item.type === 'attachment') continue
      const ans = input.answers[item.id] as { value?: unknown; comments?: unknown } | undefined
      if (item.type === 'pass_fail') {
        const v = ans?.value
        const pf = v === 'pass' ? 'Pass' : v === 'fail' ? 'Fail' : '-'
        const commentsRaw = (ans?.comments as string | undefined) ?? ''
        const comments = commentsRaw.toString().trim() || '-'
        rows.push([item.label, pf, comments])
      } else {
        const raw = ans?.value
        const text = raw == null || raw === '' ? '-' : String(raw)
        rows.push([item.label, '-', text])
      }
    }

    ensureSpace(14)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(11, 15, 20)
    doc.text(section.title, marginX, y)
    y += 3

    autoTable(doc, {
      startY: y + 2,
      head: [['Item', 'Pass/Fail', 'Comments']],
      body: rows.length > 0 ? rows : [['-', '-', '-']],
      margin: { left: marginX, right: marginX },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [11, 15, 20], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.42 },
        1: { cellWidth: contentWidth * 0.18 },
        2: { cellWidth: contentWidth * 0.40 },
      },
    })

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

    // Photos attached to this section's items: a thumbnail strip, each thumbnail
    // a clickable link to the full image plus a visible "Open" link beneath it.
    if (input.photoImages) {
      const imgH = 30 // mm
      const capH = 5
      const gap = 3
      const linkDoc = doc as unknown as {
        link: (x: number, y: number, w: number, h: number, o: { url: string }) => void
        textWithLink: (t: string, x: number, y: number, o: { url: string }) => void
      }
      for (const item of section.items) {
        const ans = input.answers[item.id] as { photos?: string[] } | undefined
        const paths = (ans?.photos ?? []).filter((p) => input.photoImages?.[p])
        if (paths.length === 0) continue

        ensureSpace(6 + imgH + capH)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(60, 66, 74)
        doc.text('Photos — ' + item.label, marginX, y)
        y += 4

        let x = marginX
        let rowStartY = y
        paths.forEach((p, idx) => {
          const img = input.photoImages![p]
          const ratio = img.w && img.h ? img.w / img.h : 1
          const w = Math.max(12, Math.min(imgH * ratio, contentWidth))
          if (x + w > pageWidth - marginX && x > marginX) {
            x = marginX
            rowStartY += imgH + capH + gap
            if (rowStartY + imgH + capH > pageHeight - 20) {
              doc.addPage()
              rowStartY = topMargin
            }
          }
          if (img.dataUrl) {
            try {
              doc.addImage(img.dataUrl, 'JPEG', x, rowStartY, w, imgH)
            } catch {
              drawPhotoPlaceholder(doc, x, rowStartY, w, imgH)
            }
          } else {
            drawPhotoPlaceholder(doc, x, rowStartY, w, imgH)
          }
          // Whole thumbnail is a link, with a visible caption link below it.
          linkDoc.link(x, rowStartY, w, imgH, { url: img.url })
          doc.setFontSize(7)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(37, 99, 235)
          linkDoc.textWithLink('Open photo ' + (idx + 1) + ' ↗', x, rowStartY + imgH + 3.5, { url: img.url })
          x += w + gap
        })
        y = rowStartY + imgH + capH + 6
      }
    }
  }

  const summary = (input.summaryText ?? '').trim()
  if (summary) {
    ensureSpace(20)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(11, 15, 20)
    doc.text('Summary', marginX, y)
    y += 6

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(40, 44, 52)
    const lines = doc.splitTextToSize(summary, contentWidth) as string[]
    const lineHeight = 5
    for (const line of lines) {
      ensureSpace(lineHeight)
      doc.text(line, marginX, y)
      y += lineHeight
    }
  }

  const footer = (input.submitterName ?? 'Submitted by -') + '  -  generated ' + fmtDateTime(new Date())
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(140, 146, 154)
  doc.text(footer, marginX, pageHeight - 8)
}

// Renders each review on its own page(s), preserving every review's answers and
// clickable photo links (the same layout as the single-review PDF).
export async function buildSiteReviewsPdf(inputs: SiteReviewPdfInput[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  if (inputs.length === 0) {
    doc.setFontSize(12)
    doc.setTextColor(110, 116, 124)
    doc.text('No reviews to export.', 14, 20)
    return doc.output('blob')
  }
  inputs.forEach((input, i) => {
    if (i > 0) doc.addPage()
    renderReview(doc, autoTable, input)
  })
  return doc.output('blob')
}

export async function buildSiteReviewPdf(input: SiteReviewPdfInput): Promise<Blob> {
  return buildSiteReviewsPdf([input])
}

export function openPdfInNewTab(blob: Blob, _suggestedName?: string): void {
  void _suggestedName
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
