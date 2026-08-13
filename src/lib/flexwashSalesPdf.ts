import { format } from 'date-fns'
import { loadPdfLogo, placePdfLogo } from '@/lib/pdfLogo'
import { currency } from '@/lib/format'
import type { FlexSalesReport, FlexBreakdown } from '@/lib/queries/flexwashSales'

// Renders the FlexWash sales report to a branded PDF (jspdf + autotable load on
// demand). Mirrors the on-screen sections.

const ACCENT: [number, number, number] = [37, 99, 235]
const GROUP_FILL: [number, number, number] = [230, 236, 245]
const MUTED = 120
const MARGIN = 14

type Doc = import('jspdf').jsPDF & { lastAutoTable?: { finalY: number } }
type Cell = string | { content: string; styles?: Record<string, unknown> }

const money = (n: number) => currency(n)
const num = (n: number) => Math.round(n).toLocaleString('en-US')
const ticket = (rev: number, cnt: number) => money(cnt ? rev / cnt : 0)
const bold = (content: string): Cell => ({ content, styles: { fontStyle: 'bold' } })
const boldR = (content: string): Cell => ({ content, styles: { fontStyle: 'bold', halign: 'right' } })
// Right-aligned header cell, so a numeric column's title lines up over its values.
const headR = (content: string): Cell => ({ content, styles: { halign: 'right' } })

export async function downloadFlexwashSalesPdf(
  report: FlexSalesReport,
  breakdown: FlexBreakdown | null,
  meta: { siteLabel: string; fileTag: string; start: string; end: string; generatedBy?: string; brandLogoUrl?: string | null; accountName?: string },
): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const logo = await loadPdfLogo(meta.brandLogoUrl)

  const doc = new jsPDF() as Doc
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  placePdfLogo(doc, logo)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(20)
  doc.text(`${meta.fileTag} Sales Report`, MARGIN, 18)

  const d = (s: string) => format(new Date(s + 'T12:00:00'), 'PP')
  const range = meta.start === meta.end ? d(meta.start) : `${d(meta.start)} - ${d(meta.end)}`
  const generated = `Generated ${format(new Date(), 'PP')}${meta.generatedBy ? ` by ${meta.generatedBy}` : ''}`
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(MUTED)
  doc.text([range, meta.accountName, generated].filter(Boolean).join('  ·  '), MARGIN, 25)

  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, 29, pageW - MARGIN, 29)

  // Reserve top/bottom margins so tables break before the page edge and never
  // collide with the footer (some printers also clip ~6mm at the bottom edge).
  const common = {
    styles: { fontSize: 9, cellPadding: 2.2, overflow: 'linebreak' as const },
    headStyles: { fillColor: ACCENT, fontStyle: 'bold' as const },
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 20 },
  }
  let y = 37
  const afterTable = () => (doc.lastAutoTable?.finalY ?? y) + 7
  const heading = (t: string) => {
    if (y > pageH - 34) { doc.addPage(); y = 18 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(20)
    doc.text(t, MARGIN, y)
    y += 5
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (opts: Record<string, unknown>) => { autoTable(doc, { ...common, ...opts } as any); y = afterTable() }

  // Summary
  heading('Summary')
  table({
    startY: y,
    head: [['Metric', headR('Value')]],
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    body: [
      ['Cars washed', num(report.wash.total)],
      ...(breakdown?.carsByTier ?? []).map((t): Cell[] => [`    ${t.label}`, num(t.count)]),
      ['Plans sold', num(report.plans.total)],
      ['Net site sales', money(report.accounting?.net ?? report.revenue.total)],
      ['Membership recharge', money(report.revenue.membership)],
    ],
  })

  // Line Item Sales Breakdown
  if (breakdown && breakdown.groups.length) {
    heading('Line Item Sales Breakdown')
    const body: Cell[][] = []
    const groupRows = new Set<number>()
    for (const g of breakdown.groups) {
      groupRows.add(body.length)
      body.push([g.label, num(g.count), ticket(g.revenue, g.count), money(g.revenue)])
      for (const it of g.items) body.push([`    ${it.name}`, num(it.count), ticket(it.revenue, it.count), money(it.revenue)])
    }
    table({
      startY: y,
      head: [['Line Item', headR('Count'), headR('Ticket Avg'), headR('Revenue')]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section === 'body' && groupRows.has(data.row.index)) {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = GROUP_FILL
        }
      },
    })
  }

  // Discounts
  if (report.discounts.length) {
    heading('Discounts')
    table({
      startY: y,
      head: [['Discount', headR('Count'), headR('Amount')]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      body: [
        ...report.discounts.map((x) => [x.name, num(x.count), money(-Math.abs(x.amount))]),
        [bold('Total Discounts'), boldR(num(report.discounts.reduce((a, x) => a + x.count, 0))), boldR(money(-report.discounts.reduce((a, x) => a + Math.abs(x.amount), 0)))],
      ],
    })
  }

  // Total to Account For
  if (report.accounting) {
    const a = report.accounting
    const toAccount = a.cash + a.card + a.giftCard + a.fleetUnpaid
    heading('Total to Account For')
    const rows: Cell[][] = [
      ['Gross Sales', money(a.gross)],
      ['Less Discounts', money(-a.discount)],
    ]
    if (a.promotion) rows.push(['Less Promotions', money(-a.promotion)])
    rows.push(['Less Refunds', money(-a.refund)])
    rows.push([bold('Net Sales'), boldR(money(a.net))])
    rows.push(['Cash', money(a.cash)])
    rows.push(['Credit / Debit Card', money(a.card)])
    if (a.giftCard) rows.push(['Gift Card', money(a.giftCard)])
    if (a.fleetUnpaid) rows.push(['Fleet (unpaid / A/R)', money(a.fleetUnpaid)])
    rows.push([bold('Total to Account For'), boldR(money(toAccount))])
    rows.push(['Sales Tax', money(a.tax)])
    table({ startY: y, head: [['Description', headR('Amount')]], columnStyles: { 1: { halign: 'right' } }, body: rows })
  }

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text('FlexWash Sales Report · WashLyfe Operator', MARGIN, pageH - 11)
    doc.text(`Page ${p} of ${pages}`, pageW - MARGIN, pageH - 11, { align: 'right' })
  }

  const dateTag = meta.start === meta.end ? meta.start : `${meta.start} to ${meta.end}`
  doc.save(`${meta.fileTag} FW Sales Report ${dateTag}.pdf`)
}
