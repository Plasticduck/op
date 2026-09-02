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

  const linkDoc = doc as unknown as {
    link: (x: number, y: number, w: number, h: number, o: { url: string }) => void
  }
  // Photo thumbnails are drawn into space reserved at the bottom of each item's
  // table row, so each item's photos sit directly beneath its line. imgH is the
  // thumbnail height; topPad/botPad frame the reserved block.
  const imgH = 28
  const gap = 3
  const topPad = 2
  const botPad = 2
  type PhotoImg = { url: string; dataUrl?: string; w?: number; h?: number }
  type PhotoPos = { x: number; row: number; w: number; img: PhotoImg }
  const layoutPhotos = (imgs: PhotoImg[]): { positions: PhotoPos[]; blockH: number } => {
    const positions: PhotoPos[] = []
    let x = 0
    let row = 0
    for (const img of imgs) {
      const ratio = img.w && img.h ? img.w / img.h : 1
      const w = Math.max(12, Math.min(imgH * ratio, contentWidth))
      if (x > 0 && x + w > contentWidth) {
        x = 0
        row += 1
      }
      positions.push({ x, row, w, img })
      x += w + gap
    }
    const nRows = row + 1
    return { positions, blockH: topPad + nRows * imgH + (nRows - 1) * gap + botPad }
  }

  for (const section of input.schema.sections) {
    const rows: Array<[string, string, string]> = []
    // Per body-row photo layout, parallel to `rows`, or null when the item has none.
    const rowPhotos: ({ positions: PhotoPos[]; blockH: number } | null)[] = []
    for (const item of section.items) {
      if (item.type === 'attachment') continue
      const ans = input.answers[item.id] as { value?: unknown; comments?: unknown; photos?: string[] } | undefined
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
      const imgs = (ans?.photos ?? [])
        .map((p) => input.photoImages?.[p])
        .filter((im): im is PhotoImg => !!im)
      rowPhotos.push(imgs.length ? layoutPhotos(imgs) : null)
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
      // Keep a row and the photos reserved beneath it on the same page.
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [11, 15, 20], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.42 },
        1: { cellWidth: contentWidth * 0.18 },
        2: { cellWidth: contentWidth * 0.40 },
      },
      // Reserve space at the bottom of a row for its photos...
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const layout = rowPhotos[data.row.index]
        if (!layout) return
        data.cell.styles.cellPadding = { top: 3, right: 3, bottom: 3 + layout.blockH, left: 3 }
      },
      // ...then draw the photos into that reserved band, spanning the table width.
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        const layout = rowPhotos[data.row.index]
        if (!layout) return
        const blockTop = data.cell.y + data.cell.height - layout.blockH + topPad
        for (const pos of layout.positions) {
          const xx = marginX + pos.x
          const yy = blockTop + pos.row * (imgH + gap)
          if (pos.img.dataUrl) {
            try {
              doc.addImage(pos.img.dataUrl, 'JPEG', xx, yy, pos.w, imgH)
            } catch {
              drawPhotoPlaceholder(doc, xx, yy, pos.w, imgH)
            }
          } else {
            drawPhotoPlaceholder(doc, xx, yy, pos.w, imgH)
          }
          linkDoc.link(xx, yy, pos.w, imgH, { url: pos.img.url })
        }
      },
    })

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
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
