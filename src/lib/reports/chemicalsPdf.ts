import { format } from 'date-fns'
import { loadPdfLogo, placePdfLogo } from '@/lib/pdfLogo'
import type { PackageTotals, SitePackageRow } from '@/lib/queries/chemicals'

// PDF export for the Chemicals wash-package report: a per-site table with a grand
// total, and the brand (MW) logo top-right. jspdf + jspdf-autotable load on demand.

const ACCENT: [number, number, number] = [37, 99, 235]
const fileSafe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
const nf = (n: number) => n.toLocaleString('en-US')

type Doc = import('jspdf').jsPDF & { lastAutoTable?: { finalY: number } }

export async function exportChemicalsPdf(opts: {
  monthLabel: string
  sites: SitePackageRow[]
  grand: PackageTotals
  logoUrl?: string | null
  flexIncluded: boolean
}): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const logo = await loadPdfLogo(opts.logoUrl)

  const doc = new jsPDF() as Doc
  placePdfLogo(doc, logo)

  doc.setFontSize(15)
  doc.text('Wash Package Report', 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`${opts.monthLabel} · every wash by package, excluding MW19 and Headquarters · Generated ${format(new Date(), 'PP')}`, 14, 22)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 28,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: ACCENT },
    footStyles: { fillColor: [237, 240, 245], textColor: 20, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
    head: [['Site', 'Flash', 'Wonder', 'Super Shine', 'Mighty Protector', 'Test Car', 'Other', 'Total']],
    body: opts.sites.map((r) => r.totalOnly
      ? [`${r.site} †`, '—', '—', '—', '—', '—', '—', nf(r.total)]
      : [
          r.site, r.flash ? nf(r.flash) : '—', nf(r.wonder), nf(r.superShine), nf(r.mighty),
          r.testCar ? nf(r.testCar) : '—', r.other ? nf(r.other) : '—', nf(r.total),
        ]),
    foot: [[
      'Grand total',
      { content: nf(opts.grand.flash), styles: { halign: 'right' } },
      { content: nf(opts.grand.wonder), styles: { halign: 'right' } },
      { content: nf(opts.grand.superShine), styles: { halign: 'right' } },
      { content: nf(opts.grand.mighty), styles: { halign: 'right' } },
      { content: nf(opts.grand.testCar), styles: { halign: 'right' } },
      { content: nf(opts.grand.other), styles: { halign: 'right' } },
      { content: nf(opts.grand.total), styles: { halign: 'right' } },
    ]],
    showFoot: 'lastPage',
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [i, { halign: 'right' as const }])),
  })

  const notes: string[] = []
  if (opts.sites.some((r) => r.totalOnly)) {
    notes.push('† Not on DRB or FlexWash: the month\'s total washes from the car count sheet, with no package split. Included in the grand total, not the package totals.')
  }
  if (!opts.flexIncluded) notes.push('Note: the FlexWash sites could not be loaded and are not included in these totals.')
  if (notes.length) {
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(notes, 14, (doc.lastAutoTable?.finalY ?? 28) + 8)
    doc.setTextColor(0)
  }

  doc.save(`mighty-wash-packages-${fileSafe(opts.monthLabel)}.pdf`)
}
