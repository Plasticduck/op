import { format } from 'date-fns'
import { loadPdfLogo, placePdfLogo } from '@/lib/pdfLogo'
import { itemsOf, itFieldChecklists, type ItChecklistItem, type ItFieldChecklistRow } from '@/lib/queries/itFieldChecklists'

// PDF for a submitted IT Field Checklist: site / tech / dates, a tally, each
// section's items with their status (Checked, Issue in red, Not done) and comment,
// the item's photos embedded as thumbnails beneath it (clickable to the full
// photo) and videos as linked "Video" tiles, then the overall notes. Mighty Wash
// logo top-right. Same photo approach as the RM Site Reviews export.

// Links in a saved PDF should keep working: 5-year signed URLs (as Site Reviews).
const MEDIA_LINK_TTL = 60 * 60 * 24 * 365 * 5
const RED: [number, number, number] = [200, 30, 45]
const GREEN: [number, number, number] = [22, 128, 61]

type MediaImg = { url: string; kind: 'image' | 'video'; dataUrl?: string; w?: number; h?: number }
type Doc = import('jspdf').jsPDF & { lastAutoTable?: { finalY: number } }

// Long-lived links for every photo/video, plus a JPEG thumbnail for photos (redrawn
// through a canvas so it's same-origin and JPEG whatever the source; a photo the
// browser can't decode, e.g. HEIC, keeps its link and gets a placeholder tile).
async function resolveMedia(items: ItChecklistItem[]): Promise<Record<string, MediaImg>> {
  const all = items.flatMap((i) => i.media)
  const urls = await itFieldChecklists.mediaUrls(all.map((m) => m.path), MEDIA_LINK_TTL)
  const out: Record<string, MediaImg> = {}
  await Promise.all(all.map(async (m) => {
    const url = urls[m.path]
    if (!url) return
    out[m.path] = { url, kind: m.kind }
    if (m.kind !== 'image') return
    try {
      const resp = await fetch(url)
      if (!resp.ok) return
      const objUrl = URL.createObjectURL(await resp.blob())
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image()
          im.onload = () => resolve(im)
          im.onerror = reject
          im.src = objUrl
        })
        const scale = Math.min(1, 1000 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
        const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
        const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, w, h)
        out[m.path] = { url, kind: 'image', dataUrl: canvas.toDataURL('image/jpeg', 0.8), w, h }
      } finally {
        URL.revokeObjectURL(objUrl)
      }
    } catch {
      // Keep the link; skip the thumbnail.
    }
  }))
  return out
}

function statusOf(i: ItChecklistItem): 'Issue' | 'Checked' | 'Not done' {
  return i.issue ? 'Issue' : i.checked ? 'Checked' : 'Not done'
}

export async function downloadItFieldChecklistPdf(row: ItFieldChecklistRow): Promise<void> {
  const items = itemsOf(row)
  const [{ jsPDF }, autoTableMod, logo, media] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadPdfLogo('/mw-logo.png', { maxPx: 400 }),
    resolveMedia(items),
  ])
  const autoTable = autoTableMod.default
  const doc = new jsPDF({ format: 'letter', compress: true }) as Doc
  const marginX = 14
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - marginX * 2
  const site = row.location?.name ?? 'Site'

  placePdfLogo(doc, logo, { height: 22, y: 8 })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(11, 15, 20)
  doc.text('IT Field Checklist', marginX, 17)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(110, 116, 124)
  doc.text(`Site: ${site}  |  Tech: ${row.tech_name ?? '-'}`, marginX, 24)
  doc.text(
    `Started ${format(new Date(row.created_at), 'MMM d, yyyy h:mm a')}` +
      (row.submitted_at ? `  |  Submitted ${format(new Date(row.submitted_at), 'MMM d, yyyy h:mm a')}` : ''),
    marginX,
    29,
  )

  // Tally.
  const checked = items.filter((i) => i.checked).length
  const issues = items.filter((i) => i.issue).length
  const notDone = items.length - checked - issues
  doc.setFontSize(10)
  doc.setTextColor(40, 44, 52)
  let x = marginX
  const part = (text: string, color: [number, number, number], bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setTextColor(...color)
    doc.text(text, x, 37)
    x += doc.getTextWidth(text)
  }
  part(`${checked} checked`, GREEN, true)
  part('   ·   ', [140, 146, 154])
  part(`${issues} issue${issues === 1 ? '' : 's'}`, issues ? RED : [110, 116, 124], issues > 0)
  part('   ·   ', [140, 146, 154])
  part(`${notDone} not done`, [110, 116, 124])

  // Media thumbnails sit in space reserved at the bottom of each item's row.
  const imgH = 26
  const gap = 3
  type Pos = { x: number; row: number; w: number; m: MediaImg }
  const layout = (ms: MediaImg[]) => {
    const positions: Pos[] = []
    let px = 0
    let r = 0
    for (const m of ms) {
      const ratio = m.kind === 'image' && m.w && m.h ? m.w / m.h : 1.3
      const w = Math.max(14, Math.min(imgH * ratio, contentW))
      if (px > 0 && px + w > contentW) { px = 0; r += 1 }
      positions.push({ x: px, row: r, w, m })
      px += w + gap
    }
    return { positions, blockH: 2 + (r + 1) * imgH + r * gap + 2 }
  }
  const tile = (label: string, xx: number, yy: number, w: number, h: number) => {
    doc.setDrawColor(210, 214, 220)
    doc.setFillColor(240, 242, 245)
    doc.rect(xx, yy, w, h, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(100, 106, 114)
    doc.text(label, xx + w / 2, yy + h / 2 + 1, { align: 'center' })
  }
  const linkDoc = doc as unknown as { link: (x: number, y: number, w: number, h: number, o: { url: string }) => void }

  let y = 44
  const sections: { title: string; items: ItChecklistItem[] }[] = []
  for (const i of items) {
    const s = sections.find((z) => z.title === i.section)
    if (s) s.items.push(i)
    else sections.push({ title: i.section, items: [i] })
  }

  for (const s of sections) {
    if (y + 20 > pageH - 18) { doc.addPage(); y = 16 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(11, 15, 20)
    doc.text(s.title, marginX, y)

    const rowMedia = s.items.map((i) => {
      const ms = i.media.map((m) => media[m.path]).filter((m): m is MediaImg => !!m)
      return ms.length ? layout(ms) : null
    })
    autoTable(doc, {
      startY: y + 3,
      head: [['Status', 'Item', 'Comment']],
      body: s.items.map((i) => [statusOf(i), i.label, i.comment.trim() || '-']),
      margin: { left: marginX, right: marginX },
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, valign: 'top' },
      headStyles: { fillColor: [11, 15, 20], textColor: [255, 255, 255] },
      columnStyles: {
        0: { cellWidth: 22, fontStyle: 'bold' },
        1: { cellWidth: contentW * 0.42 },
        2: { cellWidth: 'auto' },
      },
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const it = s.items[data.row.index]
        if (it.issue) data.cell.styles.fillColor = [253, 236, 238]
        if (data.column.index === 0) {
          data.cell.styles.textColor = it.issue ? RED : it.checked ? GREEN : [140, 146, 154]
        }
        const lay = rowMedia[data.row.index]
        if (lay) data.cell.styles.cellPadding = { top: 3, right: 3, bottom: 3 + lay.blockH, left: 3 }
      },
      // Drawn with the row's last cell, so no later cell background covers the
      // thumbnails (they span the full table width).
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 2) return
        const lay = rowMedia[data.row.index]
        if (!lay) return
        const top = data.cell.y + data.cell.height - lay.blockH + 2
        for (const p of lay.positions) {
          const xx = marginX + p.x
          const yy = top + p.row * (imgH + gap)
          if (p.m.kind === 'image' && p.m.dataUrl) {
            try { doc.addImage(p.m.dataUrl, 'JPEG', xx, yy, p.w, imgH) } catch { tile('Photo', xx, yy, p.w, imgH) }
          } else {
            tile(p.m.kind === 'video' ? 'Video' : 'Photo', xx, yy, p.w, imgH)
          }
          linkDoc.link(xx, yy, p.w, imgH, { url: p.m.url })
        }
      },
    })
    y = (doc.lastAutoTable?.finalY ?? y) + 9
  }

  const notes = (row.notes ?? '').trim()
  if (notes) {
    if (y + 16 > pageH - 18) { doc.addPage(); y = 16 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(11, 15, 20)
    doc.text('Overall notes', marginX, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(40, 44, 52)
    for (const line of doc.splitTextToSize(notes, contentW) as string[]) {
      if (y + 5 > pageH - 18) { doc.addPage(); y = 16 }
      doc.text(line, marginX, y)
      y += 5
    }
  }

  // Footer on every page.
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(140, 146, 154)
    doc.text(`${site} IT Field Checklist  ·  Generated ${format(new Date(), 'MMM d, yyyy h:mm a')}`, marginX, pageH - 8)
    doc.text(`Page ${p} of ${pages}`, pageW - marginX, pageH - 8, { align: 'right' })
  }

  const day = format(new Date(row.submitted_at ?? row.created_at), 'yyyy-MM-dd')
  const slug = site.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'site'
  doc.save(`it-field-checklist-${slug}-${day}.pdf`)
}
