import { format } from 'date-fns'
import { currency } from '@/lib/format'
import { loadPdfLogo, placePdfLogo } from '@/lib/pdfLogo'
import type { GmBonusResult } from '@/lib/gmBonus'

// PDF export for the GM/AGM bonus calculator. jspdf + jspdf-autotable are heavy,
// so they load on demand only when a user actually exports.

const stamp = () => format(new Date(), 'yyyy-MM-dd')
const fileSafe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`
const pts = (frac: number | null) =>
  frac === null ? '—' : `${frac >= 0 ? '+' : ''}${(frac * 100).toFixed(1)} pts`
const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'Yes' : 'No')

const ACCENT: [number, number, number] = [37, 99, 235]

type Doc = import('jspdf').jsPDF & { lastAutoTable?: { finalY: number } }

async function loaders() {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  return { jsPDF, autoTable }
}


export async function exportSiteBonusPdf(
  site: string,
  monthLabel: string,
  r: GmBonusResult,
  logoUrl?: string | null,
): Promise<void> {
  const { jsPDF, autoTable } = await loaders()
  const logo = await loadPdfLogo(logoUrl)
  const doc = new jsPDF() as Doc
  placePdfLogo(doc, logo)
  doc.setFontSize(15)
  doc.text('GM / AGM Monthly Bonus', 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`${site} · ${monthLabel} · Generated ${format(new Date(), 'PP')}`, 14, 22)
  doc.setTextColor(0)

  const common = {
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: ACCENT },
    footStyles: { fillColor: [237, 240, 245] as [number, number, number], textColor: 20, fontStyle: 'bold' as const },
    margin: { left: 14, right: 14 },
  }
  const next = () => (doc.lastAutoTable?.finalY ?? 24) + 6

  autoTable(doc, {
    ...common,
    startY: 28,
    head: [['Membership Level', 'Members', 'Share', 'Change vs Prev', 'Change vs Base']],
    body: r.levels.map((l) => [l.label, String(l.count), pct(l.pct), pts(l.pctChange), pts(l.pctChangeSinceBase)]),
    foot: [['Total', String(r.currentTotal), `prev ${r.previousTotal ?? '—'}`, '', '']],
  })

  autoTable(doc, {
    ...common,
    startY: next(),
    head: [['One-time Bonus', 'Detail', 'Earned', 'Amount']],
    body: [
      [
        'Lifetime Value (avg months +1 vs base)',
        `base ${r.avgMos.base ?? '—'} to ${r.avgMos.current} (${r.avgMos.delta === null ? '—' : `${r.avgMos.delta >= 0 ? '+' : ''}${r.avgMos.delta.toFixed(1)}`} mo)`,
        yesNo(r.lifetimeValue.earned),
        currency(r.lifetimeValue.amount),
      ],
      [
        'Membership (Mighty + Super +10 pts vs base)',
        `combined ${pts(r.membership.combinedChangeSinceBase)}`,
        yesNo(r.membership.earned),
        currency(r.membership.amount),
      ],
    ],
    foot: [['One-time total', '', '', currency(r.oneTimeTotal)]],
  })

  autoTable(doc, {
    ...common,
    startY: next(),
    head: [['Monthly Reward', 'Detail', 'Amount']],
    body: [
      [`Churn reward (${r.churn.bracket})`, `churn ${r.churn.pct}%`, currency(r.churn.amount)],
      [
        'Conversion reward',
        `conversion ${r.conversion.pct}%${r.conversion.capped ? ' (capped, churn >= 15%)' : ''}`,
        currency(r.conversion.amount),
      ],
    ],
  })

  autoTable(doc, {
    ...common,
    startY: next(),
    body: [
      ['Total GM monthly bonus', currency(r.gmTotal)],
      ['Total AGM monthly bonus (1/2 of GM)', currency(r.agmTotal)],
    ],
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', fontStyle: 'bold' } },
  })

  doc.save(`gm-bonus-${fileSafe(site)}-${fileSafe(monthLabel)}-${stamp()}.pdf`)
}

export type AllSitesRow = { site: string; result: GmBonusResult | null }

export async function exportAllSitesBonusPdf(
  monthLabel: string,
  rows: AllSitesRow[],
  logoUrl?: string | null,
): Promise<void> {
  const { jsPDF, autoTable } = await loaders()
  const logo = await loadPdfLogo(logoUrl)
  const doc = new jsPDF() as Doc
  placePdfLogo(doc, logo)
  doc.setFontSize(15)
  doc.text('GM / AGM Bonus - All Sites', 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`${monthLabel} · Generated ${format(new Date(), 'PP')}`, 14, 22)
  doc.setTextColor(0)

  const withData = rows.filter((r) => r.result)
  const gmSum = withData.reduce((a, r) => a + (r.result?.gmTotal ?? 0), 0)
  const agmSum = withData.reduce((a, r) => a + (r.result?.agmTotal ?? 0), 0)

  autoTable(doc, {
    startY: 28,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: ACCENT },
    footStyles: { fillColor: [237, 240, 245], textColor: 20, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
    head: [['Site', 'One-time', 'Churn', 'Conversion', 'GM Total', 'AGM Total']],
    body: rows.map((r) =>
      r.result
        ? [
            r.site,
            currency(r.result.oneTimeTotal),
            currency(r.result.churn.amount),
            currency(r.result.conversion.amount),
            currency(r.result.gmTotal),
            currency(r.result.agmTotal),
          ]
        : [r.site, 'No data', '', '', '', ''],
    ),
    foot: [['Total', '', '', '', currency(gmSum), currency(agmSum)]],
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
  })

  doc.save(`gm-bonus-all-sites-${fileSafe(monthLabel)}-${stamp()}.pdf`)
}

export type RegionalRow = {
  region: string
  manager?: string
  pct: number
  sites: number
  combined: number
  bonus: number
}

export async function exportRegionalBonusPdf(
  quarterLabel: string,
  rows: RegionalRow[],
  logoUrl?: string | null,
): Promise<void> {
  const { jsPDF, autoTable } = await loaders()
  const logo = await loadPdfLogo(logoUrl)
  const doc = new jsPDF() as Doc
  placePdfLogo(doc, logo)
  doc.setFontSize(15)
  doc.text('Regional Manager Quarterly Bonus', 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`${quarterLabel} · Generated ${format(new Date(), 'PP')}`, 14, 22)
  doc.setTextColor(0)

  const totalCombined = rows.reduce((a, r) => a + r.combined, 0)
  const totalBonus = rows.reduce((a, r) => a + r.bonus, 0)

  autoTable(doc, {
    startY: 28,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: ACCENT },
    footStyles: { fillColor: [237, 240, 245], textColor: 20, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
    head: [['Region', 'Regional Manager', 'Sites', 'Share', 'Combined GM Bonus', 'Regional Mgr Bonus']],
    body: rows.map((r) => [
      r.region,
      r.manager ?? '',
      String(r.sites),
      `${Math.round(r.pct * 100)}%`,
      currency(r.combined),
      currency(r.bonus),
    ]),
    foot: [['Total', '', '', '', currency(totalCombined), currency(totalBonus)]],
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  })

  doc.save(`regional-bonus-${fileSafe(quarterLabel)}-${stamp()}.pdf`)
}
