import { format, parseISO } from 'date-fns'
import type { PoDetail } from '@/lib/queries/maintenanceInventory'

// The purchase order a vendor receives. Built in the browser so the same PDF is what
// downloads and what the mi-po-send function attaches.
export async function buildPoPdf(d: PoDetail, companyName: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const money = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(`Purchase Order ${d.po.number}`, 40, 50)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`${companyName}. ${format(parseISO(d.po.created_at), 'MMMM d, yyyy')}${d.po.urgent ? '. URGENT' : ''}`, 40, 68)

  doc.setFont('helvetica', 'bold')
  doc.text('Vendor', 40, 98)
  doc.text('Ship to', 320, 98)
  doc.setFont('helvetica', 'normal')
  const vendor = [d.vendor.name, d.vendor.address, d.vendor.phone, d.vendor.email].filter(Boolean) as string[]
  vendor.forEach((t, i) => doc.text(doc.splitTextToSize(t, 250)[0] as string, 40, 112 + i * 13))
  const ship = [`${d.location.name}${d.location.site_name ? ` (${d.location.site_name})` : ''}`, d.location.address].filter(Boolean) as string[]
  ship.forEach((t, i) => doc.text(doc.splitTextToSize(t, 250)[0] as string, 320, 112 + i * 13))

  autoTable(doc, {
    startY: 112 + Math.max(vendor.length, ship.length) * 13 + 14,
    head: [['Part', 'Your part #', 'Qty', 'Each', 'Total']],
    body: d.lines.map((l) => [
      l.part_name + (l.sku ? `\nOur SKU ${l.sku}` : ''),
      l.vendor_part_number ?? '',
      `${Number(l.qty_ordered).toLocaleString('en-US', { maximumFractionDigits: 3 })}${l.uom && l.uom !== 'ea' ? ` ${l.uom}` : ''}`,
      money(l.unit_cost),
      money(l.line_total),
    ]),
    foot: [['', '', '', 'Total', money(d.po.total)]],
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [37, 99, 235] },
    footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  })
  if (d.po.notes) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20
    doc.setFont('helvetica', 'bold')
    doc.text('Notes', 40, y)
    doc.setFont('helvetica', 'normal')
    doc.text(doc.splitTextToSize(d.po.notes, 530) as string[], 40, y + 14)
  }
  return doc
}
