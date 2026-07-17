import { format } from 'date-fns'

// A blank, printable inventory count sheet: one row per item with an empty
// "Count" box to write the counted number in the field. jspdf loads on demand.

const stamp = () => format(new Date(), 'yyyy-MM-dd')
const fileSafe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()

export type CountSheetRow = { category: string | null; brand: string | null; item: string | null }

// withOnline adds an empty "OL Count" column (used for chemicals, which record
// both a physical count and an online reading).
export async function exportCountSheet(
  divisionLabel: string,
  rows: CountSheetRow[],
  withOnline = false,
): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF()

  doc.setFontSize(15)
  doc.text(`Inventory Count Sheet - ${divisionLabel}`, 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(70)
  doc.text('Site: ____________________     Date: ______________     Counted by: ____________________', 14, 24)
  doc.setTextColor(0)

  const head = withOnline
    ? ['Category', 'Brand', 'Item', 'Count', 'OL Count']
    : ['Category', 'Brand', 'Item', 'Count']

  autoTable(doc, {
    startY: 30,
    head: [head],
    body: rows.map((r) =>
      withOnline
        ? [r.category ?? '', r.brand ?? '', r.item ?? '', '', '']
        : [r.category ?? '', r.brand ?? '', r.item ?? '', ''],
    ),
    // Taller rows and visible gridlines give room to hand-write each count.
    styles: { fontSize: 9, cellPadding: 3, minCellHeight: 10, lineColor: [170, 170, 170], lineWidth: 0.1 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: withOnline ? { 3: { cellWidth: 28 }, 4: { cellWidth: 28 } } : { 3: { cellWidth: 42 } },
    margin: { left: 14, right: 14 },
  })

  doc.save(`count-sheet-${fileSafe(divisionLabel)}-${stamp()}.pdf`)
}
