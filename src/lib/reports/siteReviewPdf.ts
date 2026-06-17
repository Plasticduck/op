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

export async function buildSiteReviewPdf(input: SiteReviewPdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
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

  return doc.output('blob')
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
