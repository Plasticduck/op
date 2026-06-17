import { format } from 'date-fns'

// A column definition shared by the on-screen export. `value` returns the plain
// cell text for a row (no JSX) so the same columns drive both Excel and PDF.
export type ExportColumn<T> = {
  header: string
  value: (row: T) => string | number | null | undefined
}

const cell = <T,>(col: ExportColumn<T>, row: T): string => {
  const v = col.value(row)
  return v == null ? '' : String(v)
}

const stamp = () => format(new Date(), 'yyyy-MM-dd')

// xlsx and jspdf are heavy (~600 KB combined). Load them on demand so they're
// only fetched when a user actually exports, not on every Ops Suite page view.
export async function exportExcel<T>(filename: string, columns: ExportColumn<T>[], rows: T[]): Promise<void> {
  const XLSX = await import('xlsx')
  const aoa = [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => cell(c, r)))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Export')
  XLSX.writeFile(wb, `${filename}-${stamp()}.xlsx`)
}

export async function exportPdf<T>(title: string, columns: ExportColumn<T>[], rows: T[], subtitle?: string): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait' })
  doc.setFontSize(14)
  doc.text(title, 14, 16)
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(`${subtitle ? subtitle + ' · ' : ''}${rows.length} record${rows.length === 1 ? '' : 's'} · ${format(new Date(), 'PP')}`, 14, 22)
  autoTable(doc, {
    startY: 27,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => cell(c, r))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235] }, // accent blue
    alternateRowStyles: { fillColor: [247, 248, 250] },
  })
  doc.save(`${title.replace(/\s+/g, '-').toLowerCase()}-${stamp()}.pdf`)
}
