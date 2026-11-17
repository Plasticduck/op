// The emailed Site Audit PDF: the form's questions, how the audit answered them,
// and the layout. Mirrors src/lib/reports/siteAuditPdf.ts (and the shared
// renderer in src/lib/reports/siteReviewPdf.ts), so the email and the PDF button
// in the app show the same thing.

import autoTable from 'npm:jspdf-autotable@5.0.8'
import { format } from 'npm:date-fns@4'

// deno-lint-ignore no-explicit-any
type Any = any

// The default Site Audit form: an exact copy of DEFAULT_SITE_AUDIT_SCHEMA in
// src/features/opssuite/siteAuditSchema.ts. Change both together. The account's
// customized form overrides it when there is one. An answer to a question
// missing here still prints, under "Other answers", but with a label made from
// its id instead of the question.
export const DEFAULT_SCHEMA: Any = {
  version: 1,
  sections: [
    {
      id: 'initial_observations',
      title: 'Initial Observations (Curb Appeal)',
      items: [
        { id: 'observations', label: 'Paint, Signage, Trash, Team Appearance/Hustle', type: 'comments' },
        { id: 'dress_code', label: 'Dress Code', type: 'pass_fail' },
      ],
    },
    {
      id: 'primary',
      title: 'Primary (Washing your Car)',
      items: [
        { id: 'pay_stations', label: 'Pay Stations', type: 'pass_fail', helpText: 'Attended? Clean? Free of Sticky Notes? Etc.' },
        { id: 'vac_attendant_present', label: 'VAC Attendant Present', type: 'pass_fail' },
        { id: 'prep', label: 'Prep', type: 'pass_fail', helpText: 'Friendly? Neat Appearance? Efficient? Timely?' },
        { id: 'tunnel', label: 'Tunnel', type: 'pass_fail', helpText: 'Clean? Uncluttered?' },
        { id: 'grating', label: 'Grating', type: 'pass_fail' },
        { id: 'equipment', label: 'Equipment', type: 'pass_fail', helpText: 'Clean? Working/Spinning? Touching the car?' },
        { id: 'chemical', label: 'Chemical', type: 'pass_fail', helpText: 'Working? Good Coverage?' },
        { id: 'blowers', label: 'Blowers', type: 'pass_fail', helpText: 'Clean? Functioning? Free of Debris?' },
        { id: 'qc', label: 'QC', type: 'pass_fail', helpText: 'Friendly? Neat Appearance? Efficient? Complete?' },
        { id: 'bam', label: 'BAM', type: 'pass_fail' },
        { id: 'smile_and_wave', label: 'Smile and Wave', type: 'pass_fail' },
        { id: 'primary_comments', label: 'Section comments (optional)', type: 'comments' },
      ],
    },
    {
      id: 'secondary',
      title: 'Secondary (Behind the Scenes)',
      items: [
        { id: 'mechanical_room', label: 'Mechanical Room', type: 'pass_fail', helpText: 'Clean? Neat? Organized?' },
        { id: 'soft_water_logs', label: 'Soft Water Logs Present and Updated', type: 'pass_fail' },
        { id: 'office', label: 'Office', type: 'pass_fail', helpText: 'Clean? Neat? Organized?' },
        { id: 'restrooms', label: 'Restrooms', type: 'pass_fail', helpText: 'Clean? Neat? Supplies?' },
        { id: 'vac_shed', label: 'Vac Shed', type: 'pass_fail', helpText: 'Uncluttered? Organized?' },
        { id: 'vac_area', label: 'Vac Area', type: 'pass_fail', helpText: 'Clean? Hoses? Attachments? Trash Cans?' },
        { id: 'vac_pressure', label: 'Vac Pressure', type: 'pass_fail' },
        { id: 'secondary_comments', label: 'Section comments (optional)', type: 'comments' },
      ],
    },
    {
      id: 'priority',
      title: 'Priority (Safety)',
      items: [
        { id: 'fire_extinguishers', label: 'Fire Extinguishers', type: 'pass_fail', helpText: 'Tagged? Off the Ground?' },
        { id: 'safety_supplies', label: 'Safety Supplies', type: 'pass_fail', helpText: 'Stocked?' },
        { id: 'first_aid_kit', label: 'First Aid Kit', type: 'pass_fail', helpText: 'Stocked?' },
        { id: 'hazmat_suits', label: 'Hazmat Suits', type: 'pass_fail', helpText: 'Available?' },
        { id: 'safety_signage', label: 'Safety Signage', type: 'pass_fail', helpText: 'Visible? Clean?' },
        { id: 'housekeeping', label: 'Housekeeping', type: 'pass_fail', helpText: 'Complete?' },
        { id: 'storage_tool_room', label: 'Storage/Tool Room', type: 'pass_fail', helpText: 'Clean? Organized?' },
        { id: 'site_hazards', label: 'Site Hazards', type: 'pass_fail', helpText: 'Extension Cords? Ladders? Electrical Boxes?' },
        { id: 'priority_comments', label: 'Section comments (optional)', type: 'comments' },
      ],
    },
    {
      id: 'final_thoughts',
      title: 'Final Thoughts (Customer Takeaways)',
      items: [
        { id: 'customer_service', label: 'Customer Service', type: 'pass_fail' },
        { id: 'fast', label: 'Fast', type: 'pass_fail' },
        { id: 'friendly', label: 'Friendly', type: 'pass_fail' },
        { id: 'clean', label: 'Clean', type: 'pass_fail' },
        { id: 'efficient', label: 'Efficient', type: 'pass_fail' },
        { id: 'anything_stand_out', label: 'Anything Stand Out: (Good or Bad)', type: 'pass_fail' },
        { id: 'final_thoughts_comments', label: 'Section comments (optional)', type: 'comments' },
      ],
    },
    {
      id: 'explanation',
      title: 'Explanation',
      items: [
        { id: 'explanation', label: 'Explanation', type: 'comments' },
      ],
    },
    {
      id: 'attachments',
      title: 'Attachments',
      items: [
        { id: 'photos', label: 'Photos / attachments', type: 'attachment' },
      ],
    },
  ],
}

// Answers by item id, from the audit's split columns (siteAuditColumns.ts).
export function reconstructAnswers(schema: Any, audit: Any): Record<string, Any> {
  const answers: Record<string, Any> = {}
  const merge = (obj: Any) => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) answers[k] = v
  }
  merge(audit.primary_section); merge(audit.secondary_section); merge(audit.priority_section); merge(audit.final_thoughts)
  if (audit.section_comments && typeof audit.section_comments === 'object') for (const v of Object.values(audit.section_comments)) merge(v)
  const setFirst = (sectionId: string, text: string | null) => {
    if (!text) return
    const sec = (schema.sections as Any[]).find((s) => s.id === sectionId)
    const item = sec?.items.find((it: Any) => it.type === 'comments')
    if (item) answers[item.id] = { value: text }
  }
  setFirst('initial_observations', audit.initial_observations)
  setFirst('explanation', audit.explanation)
  return answers
}

// Answers to questions that aren't on the form (a customized form dropped them,
// or DEFAULT_SCHEMA fell behind the app's form), so nothing the auditor answered
// is left off the PDF. Only ids the form builder makes count: audits from before
// this form kept answers by position ("0", "1") and old photos as "primary / 4",
// with no question to show.
export function unlistedSection(schema: Any, answers: Record<string, Any>): Any | null {
  const onForm = new Set((schema.sections as Any[]).flatMap((s) => (s.items as Any[]).map((it) => it.id)))
  const items: Any[] = []
  for (const [id, a] of Object.entries(answers)) {
    if (onForm.has(id) || !/^[a-z0-9_]+$/.test(id) || /^\d+$/.test(id)) continue
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue
    const v = a.value
    const hasPhotos = Array.isArray(a.photos) && a.photos.length > 0
    if ((v == null || v === '') && !hasPhotos) continue
    const label = id.replace(/_+/g, ' ').trim()
    items.push({
      id,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      type: v === 'pass' || v === 'warn' || v === 'fail' ? 'pass_fail' : 'comments',
    })
  }
  return items.length ? { id: '_unlisted', title: 'Other answers (not on the current form)', items } : null
}

function drawPhotoPlaceholder(doc: Any, x: number, y: number, w: number, h: number): void {
  doc.setDrawColor(210, 214, 220); doc.setFillColor(240, 242, 245); doc.rect(x, y, w, h, 'FD')
  doc.setFontSize(7); doc.setTextColor(140, 146, 154); doc.text('Photo', x + w / 2, y + h / 2, { align: 'center' })
}
const fmtDateTime = (d: Date): string => format(d, 'MMM d, yyyy h:mm a')

// Render the audit: header, per-section tables (Pass/Warn/Fail), each item's
// help text under its label, photos inline under each item's row, footer.
export function renderAudit(doc: Any, input: Any): void {
  doc.setFont('helvetica', 'normal')
  const marginX = 14, topMargin = 16
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - marginX * 2

  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 15, 20)
  doc.text('Site Audit', marginX, topMargin)
  const titleWidth = doc.getTextWidth('Site Audit')
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 116, 124)
  doc.text(input.metaLine ?? '', marginX, topMargin + 7)
  if (input.titleNote) doc.text(input.titleNote, marginX + titleWidth + 4, topMargin)

  if (input.logo?.dataUrl) {
    const logoH = 18
    const logoW = input.logo.w > 0 && input.logo.h > 0 ? logoH * (input.logo.w / input.logo.h) : logoH
    try { doc.addImage(input.logo.dataUrl, 'PNG', pageWidth - marginX - logoW, 6, logoW, logoH) } catch { /* skip */ }
  }

  let y = topMargin + 14
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

  // Help text goes in small grey type under the item's label, in space kept free
  // at the bottom of the label's cell (above any photos).
  const k = doc.internal.scaleFactor
  const helpSize = 7.5, helpGap = 0.8
  const labelWidth = contentWidth * 0.42
  const layoutHelp = (text: unknown) => {
    const t = String(text ?? '').trim()
    if (!t) return null
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(t, labelWidth - 6, { fontSize: helpSize }) as string[]
    return { lines, h: helpGap + lines.length * (helpSize / k) * doc.getLineHeightFactor() }
  }

  for (const section of input.schema.sections) {
    if (!section.items.some((it: Any) => it.type !== 'attachment')) continue
    const rows: Any[] = []
    const rowPhotos: Any[] = []
    const rowHelp: Any[] = []
    for (const item of section.items) {
      if (item.type === 'attachment') continue
      const ans = input.answers[item.id]
      if (item.type === 'pass_fail') {
        const v = ans?.value
        const pf = v === 'pass' ? 'Pass' : v === 'warn' ? 'Warn' : v === 'fail' ? 'Fail' : '-'
        rows.push([item.label, pf, '-'])
      } else {
        const raw = ans?.value
        rows.push([item.label, '-', raw == null || raw === '' ? '-' : String(raw)])
      }
      const imgs = ((ans?.photos ?? []) as string[]).map((p) => input.photoImages?.[p]).filter(Boolean)
      rowPhotos.push(imgs.length ? layoutPhotos(imgs) : null)
      rowHelp.push(layoutHelp(item.helpText))
    }

    ensureSpace(14)
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 15, 20)
    doc.text(section.title, marginX, y); y += 3

    autoTable(doc, {
      startY: y + 2,
      head: [['Item', 'Status', 'Notes']],
      body: rows.length > 0 ? rows : [['-', '-', '-']],
      margin: { left: marginX, right: marginX },
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [11, 15, 20], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      columnStyles: { 0: { cellWidth: labelWidth }, 1: { cellWidth: contentWidth * 0.18 }, 2: { cellWidth: contentWidth * 0.4 } },
      didParseCell: (data: Any) => {
        if (data.section !== 'body') return
        const photosH = rowPhotos[data.row.index]?.blockH ?? 0
        const helpH = data.column.index === 0 ? rowHelp[data.row.index]?.h ?? 0 : 0
        if (!photosH && !helpH) return
        data.cell.styles.cellPadding = { top: 3, right: 3, bottom: 3 + helpH + photosH, left: 3 }
      },
      didDrawCell: (data: Any) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        const help = rowHelp[data.row.index]
        if (help) {
          const labelH = data.cell.text.length * (data.cell.styles.fontSize / k) * doc.getLineHeightFactor()
          const top = data.cell.y + 3 + labelH + helpGap
          doc.setFont('helvetica', 'normal'); doc.setFontSize(helpSize); doc.setTextColor(110, 116, 124)
          doc.text(help.lines, data.cell.x + 3, top + (helpSize / k) * 0.85)
        }
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
  }

  const footer = (input.submitterName ?? 'Submitted by -') + '  -  generated ' + fmtDateTime(new Date())
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(140, 146, 154)
  doc.text(footer, marginX, pageHeight - 8)
}
