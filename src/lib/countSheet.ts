import { format } from 'date-fns'

// A blank, printable inventory count sheet: one row per item with an empty
// "Count" box to write the counted number in the field. jspdf loads on demand.

const stamp = () => format(new Date(), 'yyyy-MM-dd')
const fileSafe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()

export type CountSheetRow = { category: string | null; brand: string | null; item: string | null }

export async function exportCountSheet(divisionLabel: string, rows: CountSheetRow[]): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF()

  doc.setFontSize(15)
  doc.text(`Inventory Count Sheet - ${divisionLabel}`, 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(70)
  doc.text('Site: ____________________     Date: ______________     Counted by: ____________________', 14, 24)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 30,
    head: [['Category', 'Brand', 'Item', 'Count']],
    body: rows.map((r) => [r.category ?? '', r.brand ?? '', r.item ?? '', '']),
    // Taller rows and visible gridlines give room to hand-write each count.
    styles: { fontSize: 9, cellPadding: 3, minCellHeight: 10, lineColor: [170, 170, 170], lineWidth: 0.1 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: { 3: { cellWidth: 42 } },
    margin: { left: 14, right: 14 },
  })

  doc.save(`count-sheet-${fileSafe(divisionLabel)}-${stamp()}.pdf`)
}
