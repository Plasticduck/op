// The emailed Site Audit NEW PDF. Mirrors src/lib/reports/siteAuditNewPdf.ts (on
// the shared renderer src/lib/reports/siteReviewPdf.ts), so the email and the PDF
// button in the app show the same thing.

import autoTable from 'npm:jspdf-autotable@5.0.8'

// deno-lint-ignore no-explicit-any
type Any = any

// A copy of AUDIT_SECTIONS in src/features/opssuite/siteauditnew/form.ts (ids and
// labels). Change both together.
export const SECTIONS: { id: string; title: string; failsAudit?: boolean; items: { id: string; label: string }[] }[] = [
  { id: 'site', title: 'SITE', items: [
    { id: 'lot_cleanliness', label: 'Lot Cleanliness' },
    { id: 'landscaping', label: 'Landscaping' },
    { id: 'dumpster_trash_cans', label: 'Dumpster and/or Trash Cans' },
    { id: 'lot_trash', label: 'Lot Trash' },
  ] },
  { id: 'msa', title: 'MSA', items: [
    { id: 'attended', label: 'Attended' },
    { id: 'smile_wave', label: 'Smile and Wave' },
    { id: 'greet', label: 'Greet' },
    { id: 'dress_code', label: 'Dress Code (vest included)' },
  ] },
  { id: 'prep', title: 'PREP', items: [
    { id: 'bam', label: 'B.A.M. (Big Arm Movements)' },
    { id: 'smile_wave', label: 'Smile and Wave' },
    { id: 'pass_off', label: 'Pass off to Loader' },
    { id: 'dress_code', label: 'Dress Code (vest & PPE included)' },
    { id: 'under_45_seconds', label: 'Under 45 Seconds' },
    { id: 'positioning', label: 'Positioning' },
  ] },
  { id: 'tunnel', title: 'TUNNEL EQUIPMENT & CLEANLINESS', items: [
    { id: 'cleanliness', label: 'Cleanliness' },
    { id: 'equipment_working', label: 'Equipment Working' },
  ] },
  { id: 'qc', title: 'QC', items: [
    { id: 'dress_code', label: 'Dress Code (vest & PPE included)' },
    { id: 'smile_wave', label: 'Smile and Wave' },
    { id: 'positioning', label: 'Positioning' },
  ] },
  { id: 'vacs', title: 'VACS', items: [
    { id: 'cleanliness', label: 'Cleanliness' },
    { id: 'suction', label: 'Suction' },
    { id: 'trash', label: 'Trash' },
    { id: 'vac_pads', label: 'Vac Pads' },
    { id: 'holsters', label: 'Holsters' },
    { id: 'hoses', label: 'Hoses' },
    { id: 'air_pressure', label: 'Air Pressure' },
  ] },
  { id: 'site_walk', title: 'SITE WALK', items: [
    { id: 'bathrooms', label: 'Bathrooms' },
    { id: 'office', label: 'Office' },
    { id: 'storage', label: 'Storage' },
    { id: 'vac_shed', label: 'Vac Shed' },
    { id: 'mechanical_room', label: 'Mechanical Room' },
  ] },
  { id: 'safety', title: 'SAFETY', failsAudit: true, items: [
    { id: 'fire_extinguishers', label: 'Fire Extinguishers' },
    { id: 'safety_supplies', label: 'Safety Supplies' },
    { id: 'first_aid_kits', label: '1st Aid Kits' },
    { id: 'hazmat_suits', label: 'Hazmat Suits' },
    { id: 'eye_wash_stations', label: 'Eye Wash Stations' },
  ] },
]
export const SECTION_POINTS = 100 / SECTIONS.length

export type Answer = { value: 'pass' | 'warn' | 'fail' | null; comments: string; photos: string[] }

export function normalizeAnswers(raw: unknown): Record<string, Answer> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Any>) : {}
  const out: Record<string, Answer> = {}
  for (const s of SECTIONS) {
    for (const it of s.items) {
      const k = `${s.id}.${it.id}`
      const a = src[k] && typeof src[k] === 'object' ? src[k] : {}
      out[k] = {
        value: a.value === 'pass' || a.value === 'warn' || a.value === 'fail' ? a.value : null,
        comments: typeof a.comments === 'string' ? a.comments : '',
        photos: Array.isArray(a.photos) ? a.photos.filter((p: unknown): p is string => typeof p === 'string') : [],
      }
    }
  }
  return out
}

// A red item fails its section; a section passes once every item is rated and none is red.
export function sectionStatus(answers: Record<string, Answer>) {
  return SECTIONS.map((s) => {
    const vals = s.items.map((it) => answers[`${s.id}.${it.id}`]?.value)
    const status = vals.includes('fail') ? 'fail' : vals.every(Boolean) ? 'pass' : 'open'
    return { section: s, status, points: status === 'pass' ? SECTION_POINTS : 0 }
  })
}

export const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

type Tone = 'ok' | 'warn' | 'danger' | 'muted'
const INK: Record<Tone, [number, number, number]> = { ok: [21, 128, 61], warn: [161, 98, 7], danger: [185, 28, 28], muted: [110, 116, 124] }
const FILL: Record<Tone, [number, number, number]> = { ok: [220, 252, 231], warn: [254, 249, 195], danger: [254, 226, 226], muted: [241, 243, 245] }

export function gradeTone(grade: string | null, safetyFailed: boolean): Tone {
  if (safetyFailed) return 'danger'
  if (grade === 'A' || grade === 'B') return 'ok'
  if (grade === 'C') return 'warn'
  return 'danger'
}

function drawPhotoPlaceholder(doc: Any, x: number, y: number, w: number, h: number): void {
  doc.setDrawColor(210, 214, 220); doc.setFillColor(240, 242, 245); doc.rect(x, y, w, h, 'FD')
  doc.setFontSize(7); doc.setTextColor(140, 146, 154); doc.text('Photo', x + w / 2, y + h / 2, { align: 'center' })
}

export type RenderInput = {
  metaLine: string
  logo: { dataUrl: string; w: number; h: number } | null
  banner: { title: string; detail: string; tone: Tone }
  answers: Record<string, Answer>
  photoImages: Record<string, { url: string; dataUrl: string | null; w: number; h: number }>
  footer: string
}

export function renderAuditNew(doc: Any, input: RenderInput): void {
  doc.setFont('helvetica', 'normal')
  const marginX = 14, topMargin = 16
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - marginX * 2

  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 15, 20)
  doc.text('Site Audit', marginX, topMargin)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 116, 124)
  doc.text(input.metaLine, marginX, topMargin + 7)
  if (input.logo?.dataUrl) {
    const logoH = 18
    const logoW = input.logo.w > 0 && input.logo.h > 0 ? logoH * (input.logo.w / input.logo.h) : logoH
    try { doc.addImage(input.logo.dataUrl, 'PNG', pageWidth - marginX - logoW, 6, logoW, logoH) } catch { /* skip */ }
  }

  let y = topMargin + 14

  // The result box.
  {
    const { title, detail, tone } = input.banner
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(detail, contentWidth - 10) as string[]
    const h = 11 + lines.length * 4.6
    doc.setFillColor(...FILL[tone]); doc.setDrawColor(...INK[tone]); doc.setLineWidth(0.4)
    doc.roundedRect(marginX, y - 2, contentWidth, h, 2, 2, 'FD')
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK[tone])
    doc.text(title, marginX + 5, y + 5)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 44, 52)
    doc.text(lines, marginX + 5, y + 10.5)
    y += h + 6
  }

  const ensureSpace = (needed: number) => { if (y + needed > pageHeight - 20) { doc.addPage(); y = topMargin } }
  const imgH = 28, gap = 3, topPad = 2, botPad = 2
  const layoutPhotos = (imgs: Any[]) => {
    const positions: Any[] = []
    let x = 0, row = 0
    for (const img of imgs) {
      const ratio = img.w && img.h ? img.w / img.h : 1
      const w = Math.max(12, Math.min(imgH * ratio, contentWidth))
      if (x > 0 && x + w > contentWidth) { x = 0; row += 1 }
      positions.push({ x, row, w, img })
      x += w + gap
    }
    return { positions, blockH: topPad + (row + 1) * imgH + row * gap + botPad }
  }
  const labelWidth = contentWidth * 0.42

  const results = sectionStatus(input.answers)
  results.forEach((r, si) => {
    const section = r.section
    const rows: string[][] = []
    const rowStatus: (string | null)[] = []
    const rowPhotos: Any[] = []
    for (const it of section.items) {
      const a = input.answers[`${section.id}.${it.id}`]
      const pf = a.value === 'pass' ? 'Pass' : a.value === 'warn' ? 'Needs attention' : a.value === 'fail' ? 'Fail' : '-'
      rows.push([it.label, pf, a.comments.trim() || '-'])
      rowStatus.push(a.value)
      const imgs = a.photos.map((p) => input.photoImages[p]).filter(Boolean)
      rowPhotos.push(imgs.length ? layoutPhotos(imgs) : null)
    }

    ensureSpace(14)
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 15, 20)
    doc.text(`${si + 1}. ${section.title}`, marginX, y)
    const pts = `${fmtPoints(r.points)} / ${fmtPoints(SECTION_POINTS)} pts`
    const note = r.status === 'pass' ? { text: `PASS  ${pts}`, tone: 'ok' as Tone }
      : r.status === 'fail' ? { text: `FAIL  ${pts}${section.failsAudit ? '  (fails the audit)' : ''}`, tone: 'danger' as Tone }
      : { text: `Not finished  ${pts}`, tone: 'muted' as Tone }
    doc.setFontSize(10); doc.setTextColor(...INK[note.tone])
    doc.text(note.text, pageWidth - marginX, y, { align: 'right' })
    y += 3

    // Cast: Deno types the npm default export as the module, though it's the function.
    ;(autoTable as Any)(doc, {
      startY: y + 2,
      head: [['Item', 'Pass/Fail', 'Comments']],
      body: rows,
      margin: { left: marginX, right: marginX },
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [11, 15, 20], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      columnStyles: { 0: { cellWidth: labelWidth }, 1: { cellWidth: contentWidth * 0.18 }, 2: { cellWidth: contentWidth * 0.4 } },
      didParseCell: (data: Any) => {
        if (data.section !== 'body') return
        if (data.column.index === 1) {
          const v = rowStatus[data.row.index]
          const tone: Tone | null = v === 'pass' ? 'ok' : v === 'warn' ? 'warn' : v === 'fail' ? 'danger' : null
          if (tone) { data.cell.styles.textColor = INK[tone]; data.cell.styles.fontStyle = 'bold' }
        }
        const photosH = rowPhotos[data.row.index]?.blockH ?? 0
        if (photosH) data.cell.styles.cellPadding = { top: 3, right: 3, bottom: 3 + photosH, left: 3 }
      },
      didDrawCell: (data: Any) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        const layout = rowPhotos[data.row.index]
        if (!layout) return
        const blockTop = data.cell.y + data.cell.height - layout.blockH + topPad
        for (const pos of layout.positions) {
          const xx = marginX + pos.x
          const yy = blockTop + pos.row * (imgH + gap)
          if (pos.img.dataUrl) {
            try { doc.addImage(pos.img.dataUrl, 'JPEG', xx, yy, pos.w, imgH) } catch { drawPhotoPlaceholder(doc, xx, yy, pos.w, imgH) }
          } else { drawPhotoPlaceholder(doc, xx, yy, pos.w, imgH) }
          if (pos.img.url) doc.link(xx, yy, pos.w, imgH, { url: pos.img.url })
        }
      },
    })
    y = doc.lastAutoTable.finalY + 8
  })

  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(140, 146, 154)
  doc.text(input.footer, marginX, pageHeight - 8)
}
