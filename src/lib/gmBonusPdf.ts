import { format } from 'date-fns'
import { currency } from '@/lib/format'
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

type Logo = { dataUrl: string; w: number; h: number }

// Load the brand logo into a data URL so jsPDF can embed it. Same-origin
// (public/) so the canvas is not tainted. Returns null on any failure so an
// export never breaks over a missing logo.
async function loadLogo(url?: string | null): Promise<Logo | null> {
  if (!url) return null
  try {
    return await new Promise<Logo>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('no canvas context'))
          ctx.drawImage(img, 0, 0)
          resolve({ dataUrl: canvas.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight })
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('logo load failed'))
      img.src = url
    })
  } catch {
    return null
  }
}

function placeLogo(doc: Doc, logo: Logo | null) {
  if (!logo) return
  const width = 42
  const height = width * (logo.h / logo.w)
  const pageW = doc.internal.pageSize.getWidth()
  doc.addImage(logo.dataUrl, 'PNG', pageW - 14 - width, 8, width, height)
}

export async function exportSiteBonusPdf(
  site: string,
  monthLabel: string,
  r: GmBonusResult,
  logoUrl?: string | null,
): Promise<void> {
  const { jsPDF, autoTable } = await loaders()
  const logo = await loadLogo(logoUrl)
  const doc = new jsPDF() as Doc
  placeLogo(doc, logo)
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
  const logo = await loadLogo(logoUrl)
  const doc = new jsPDF() as Doc
  placeLogo(doc, logo)
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
