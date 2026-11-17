import { format } from 'date-fns'
import type { SiteReviewSchema, SiteReviewAnswers } from '@/features/opssuite/siteReviewSchema'

export type SiteReviewPdfInput = {
  title?: string
  siteName?: string | null
  date?: string | null
  weather?: string | null
  timeArrived?: string | null
  // Overrides the default "Site | Date | Weather | Time Arrived" meta line (used
  // by reports without weather/arrival, e.g. Site Audits).
  metaLine?: string
  // Small text beside the title, clear of the logo at the end of the meta line.
  titleNote?: string
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
  // Prints each item's help text (the prompts under it on the form, e.g. "Clean?
  // Organized?") in small grey type beneath its label.
  showHelpText?: boolean
  // A coloured result box under the meta line (e.g. an audit's grade).
  banner?: { title: string; detail?: string; tone: PdfTone } | null
  // A coloured note at the right end of a section's title, by section id.
  sectionNotes?: Record<string, { text: string; tone: PdfTone }>
  // Prints the Pass / Warn / Fail column in green / amber / red, with this word
  // for Warn (default "Warn").
  colorStatus?: boolean
  warnLabel?: string
  // Extra tables after the sections (e.g. an audit's open work orders). `message`
  // prints instead of a table; `tones` colours cells, per row by column index.
  appendix?: PdfAppendix[]
}

export type PdfAppendix = {
  title: string
  note?: { text: string; tone: PdfTone }
  message?: string
  head?: string[]
  body?: string[][]
  widths?: number[]
  tones?: Record<number, PdfTone | null>[]
}

export type PdfTone = 'ok' | 'warn' | 'danger' | 'muted'
const TONE_INK: Record<PdfTone, [number, number, number]> = {
  ok: [21, 128, 61],
  warn: [161, 98, 7],
  danger: [185, 28, 28],
  muted: [110, 116, 124],
}
const TONE_FILL: Record<PdfTone, [number, number, number]> = {
  ok: [220, 252, 231],
  warn: [254, 249, 195],
  danger: [254, 226, 226],
  muted: [241, 243, 245],
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
  const titleWidth = doc.getTextWidth(title)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(110, 116, 124)
  const meta = input.metaLine ?? [
    'Site: ' + (input.siteName ?? '-'),
    'Date: ' + fmtDate(input.date),
    'Weather: ' + (input.weather ?? '-'),
    'Time Arrived: ' + fmt12(input.timeArrived),
  ].join('  |  ')
  doc.text(meta, marginX, topMargin + 7)
  if (input.titleNote) doc.text(input.titleNote, marginX + titleWidth + 4, topMargin)

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

  if (input.banner) {
    const { title: bTitle, detail, tone } = input.banner
    doc.setFontSize(9.5)
    doc.setFont('helvetica', 'normal')
    const detailLines = detail ? (doc.splitTextToSize(detail, contentWidth - 10) as string[]) : []
    const h = 11 + detailLines.length * 4.6
    doc.setFillColor(...TONE_FILL[tone])
    doc.setDrawColor(...TONE_INK[tone])
    doc.setLineWidth(0.4)
    doc.roundedRect(marginX, y - 2, contentWidth, h, 2, 2, 'FD')
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...TONE_INK[tone])
    doc.text(bTitle, marginX + 5, y + 5)
    if (detailLines.length) {
      doc.setFontSize(9.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(40, 44, 52)
      doc.text(detailLines, marginX + 5, y + 10.5)
    }
    y += h + 6
  }

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

  // Help text goes under the item's label, in space kept free at the bottom of
  // the label's cell (above any photos).
  const k = doc.internal.scaleFactor
  const helpSize = 7.5
  const helpGap = 0.8
  const labelWidth = contentWidth * 0.42
  type HelpBlock = { lines: string[]; h: number }
  const layoutHelp = (text: string | undefined): HelpBlock | null => {
    const t = (text ?? '').trim()
    if (!input.showHelpText || !t) return null
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(t, labelWidth - 6, { fontSize: helpSize }) as string[]
    return { lines, h: helpGap + lines.length * (helpSize / k) * doc.getLineHeightFactor() }
  }

  for (const section of input.schema.sections) {
    const rows: Array<[string, string, string]> = []
    // Per body-row photo layout and help text, parallel to `rows`, or null when
    // the item has none.
    const rowPhotos: ({ positions: PhotoPos[]; blockH: number } | null)[] = []
    const rowHelp: (HelpBlock | null)[] = []
    for (const item of section.items) {
      if (item.type === 'attachment') continue
      const ans = input.answers[item.id] as { value?: unknown; comments?: unknown; photos?: string[] } | undefined
      if (item.type === 'pass_fail') {
        const v = ans?.value
        const pf = v === 'pass' ? 'Pass' : v === 'warn' ? (input.warnLabel ?? 'Warn') : v === 'fail' ? 'Fail' : '-'
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
      rowHelp.push(layoutHelp(item.helpText))
    }

    ensureSpace(14)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(11, 15, 20)
    doc.text(section.title, marginX, y)
    const note = input.sectionNotes?.[section.id]
    if (note) {
      doc.setFontSize(10)
      doc.setTextColor(...TONE_INK[note.tone])
      doc.text(note.text, pageWidth - marginX, y, { align: 'right' })
    }
    y += 3
    // Status of each body row, for colouring the Pass/Fail column.
    const rowStatus = section.items
      .filter((it) => it.type !== 'attachment')
      .map((it) => (it.type === 'pass_fail' ? (input.answers[it.id] as { value?: unknown } | undefined)?.value : null))

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
        0: { cellWidth: labelWidth },
        1: { cellWidth: contentWidth * 0.18 },
        2: { cellWidth: contentWidth * 0.40 },
      },
      // Reserve space at the bottom of a row for its photos (and of the label's
      // cell for its help text)...
      didParseCell: (data) => {
        if (data.section !== 'body') return
        if (input.colorStatus && data.column.index === 1) {
          const v = rowStatus[data.row.index]
          const tone: PdfTone | null = v === 'pass' ? 'ok' : v === 'warn' ? 'warn' : v === 'fail' ? 'danger' : null
          if (tone) {
            data.cell.styles.textColor = TONE_INK[tone]
            data.cell.styles.fontStyle = 'bold'
          }
        }
        const photosH = rowPhotos[data.row.index]?.blockH ?? 0
        const helpH = data.column.index === 0 ? rowHelp[data.row.index]?.h ?? 0 : 0
        if (!photosH && !helpH) return
        data.cell.styles.cellPadding = { top: 3, right: 3, bottom: 3 + helpH + photosH, left: 3 }
      },
      // ...then draw them into it: the help text under the label, the photos in a
      // band spanning the table width.
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        const help = rowHelp[data.row.index]
        if (help) {
          const labelH = data.cell.text.length * (data.cell.styles.fontSize / k) * doc.getLineHeightFactor()
          const top = data.cell.y + 3 + labelH + helpGap
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(helpSize)
          doc.setTextColor(110, 116, 124)
          doc.text(help.lines, data.cell.x + 3, top + (helpSize / k) * 0.85)
        }
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
          if (pos.img.url) linkDoc.link(xx, yy, pos.w, imgH, { url: pos.img.url })
        }
      },
    })

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  }

  for (const ap of input.appendix ?? []) {
    ensureSpace(24)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(11, 15, 20)
    doc.text(ap.title, marginX, y)
    if (ap.note) {
      doc.setFontSize(10)
      doc.setTextColor(...TONE_INK[ap.note.tone])
      doc.text(ap.note.text, pageWidth - marginX, y, { align: 'right' })
    }
    y += 3
    if (ap.message || !ap.body?.length) {
      doc.setFontSize(9.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60, 64, 72)
      doc.text(ap.message ?? '-', marginX, y + 5)
      y += 12
      continue
    }
    const widths = ap.widths ?? []
    autoTable(doc, {
      startY: y + 2,
      head: ap.head ? [ap.head] : undefined,
      body: ap.body,
      margin: { left: marginX, right: marginX },
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.5, valign: 'top' },
      headStyles: { fillColor: [11, 15, 20], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }])),
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const tone = ap.tones?.[data.row.index]?.[data.column.index]
        if (!tone) return
        data.cell.styles.textColor = TONE_INK[tone]
        if (data.column.index !== ap.body![0].length - 1) data.cell.styles.fontStyle = 'bold'
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
