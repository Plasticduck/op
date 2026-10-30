import type { jsPDF as JsPDF } from 'jspdf'
import {
  drawCalibrationLabel,
  drawLabel,
  labelSlot,
  labelsPerPage,
  PT_MM,
  type Drawing,
  type LabelContent,
  type LabelLayoutSpec,
  type LabelSpec,
} from './layout'

// Sticker PDFs from the label layout. Black on white, vectors only, so they
// print sharp on thermal and laser printers alike. Every mark goes through the
// template's calibration (page mm = offset + scale x position), so the test
// page, the preview and the real stickers line up the same way.

export type PrintTemplate = {
  name: string
  page_spec: LabelSpec
  layout: LabelLayoutSpec
  offset_x_mm: number
  offset_y_mm: number
  scale: number
}

type Xf = { ox: number; oy: number; s: number }

async function newDoc(spec: LabelSpec): Promise<JsPDF> {
  const { jsPDF } = await import('jspdf')
  if (spec.page) return new jsPDF({ unit: 'mm', format: [spec.page.w_mm, spec.page.h_mm], orientation: 'portrait' })
  const { w_mm: w, h_mm: h } = spec.label
  return new jsPDF({ unit: 'mm', format: [w, h], orientation: w > h ? 'landscape' : 'portrait' })
}

function addPage(doc: JsPDF, spec: LabelSpec) {
  if (spec.page) doc.addPage([spec.page.w_mm, spec.page.h_mm], 'portrait')
  else doc.addPage([spec.label.w_mm, spec.label.h_mm], spec.label.w_mm > spec.label.h_mm ? 'landscape' : 'portrait')
}

function paint(doc: JsPDF, d: Drawing, slotX: number, slotY: number, t: Xf) {
  const X = (x: number) => t.ox + t.s * (slotX + x)
  const Y = (y: number) => t.oy + t.s * (slotY + y)
  doc.setFillColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)
  doc.setTextColor(0, 0, 0)
  for (const r of d.rects) doc.rect(X(r.x), Y(r.y), r.w * t.s, r.h * t.s, 'F')
  for (const st of d.strokes) {
    doc.setLineWidth(st.width * t.s)
    doc.line(X(st.x1), Y(st.y1), X(st.x2), Y(st.y2))
  }
  for (const tb of d.texts) {
    const w = tb.w * t.s
    let size = tb.sizePt * t.s
    doc.setFont(tb.font, tb.bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    let lines: string[]
    if (tb.font === 'courier') {
      // A tag is never cut short: shrink it until it fits.
      while (size > 4 && doc.getTextWidth(tb.text) > w) {
        size -= 0.25
        doc.setFontSize(size)
      }
      lines = [tb.text]
    } else {
      lines = doc.splitTextToSize(tb.text, w) as string[]
      if (lines.length > tb.maxLines) {
        lines = lines.slice(0, tb.maxLines)
        let last = lines[lines.length - 1]
        while (last.length > 1 && doc.getTextWidth(last + '...') > w) last = last.slice(0, -1).trimEnd()
        lines[lines.length - 1] = last + '...'
      }
    }
    const lh = size * PT_MM * 1.18
    lines.forEach((ln, k) => {
      doc.text(ln, tb.align === 'center' ? X(tb.x) + w / 2 : X(tb.x), Y(tb.y) + k * lh, { baseline: 'top', align: tb.align })
    })
  }
}

const xf = (t: PrintTemplate): Xf => ({ ox: Number(t.offset_x_mm) || 0, oy: Number(t.offset_y_mm) || 0, s: Number(t.scale) || 1 })

// Stickers for each item, `copies` of each (secondary stickers share a tag).
// `startAt` skips positions already used on the first sheet.
export async function buildLabelsPdf(
  t: PrintTemplate,
  items: LabelContent[],
  opts: { copies?: number; startAt?: number } = {},
): Promise<{ doc: JsPDF; labels: number }> {
  const spec = t.page_spec
  const doc = await newDoc(spec)
  const copies = Math.max(1, opts.copies ?? 1)
  const startAt = spec.page ? Math.max(0, Math.min(labelsPerPage(spec) - 1, opts.startAt ?? 0)) : 0
  let i = 0
  let page = 0
  for (const item of items) {
    const d = drawLabel(item, spec, t.layout)
    for (let k = 0; k < copies; k++) {
      const slot = labelSlot(spec, i, startAt)
      while (page < slot.page) {
        addPage(doc, spec)
        page++
      }
      paint(doc, d, slot.x, slot.y, xf(t))
      i++
    }
  }
  return { doc, labels: i }
}

// A test page: every label position outlined with a centre cross, plus a 50 mm
// ruler on sheets to check the printer isn't scaling the page.
export async function buildCalibrationPdf(t: PrintTemplate): Promise<JsPDF> {
  const spec = t.page_spec
  const doc = await newDoc(spec)
  const n = spec.page ? labelsPerPage(spec) : 2
  let page = 0
  for (let i = 0; i < n; i++) {
    const slot = labelSlot(spec, i)
    while (page < slot.page) {
      addPage(doc, spec)
      page++
    }
    paint(doc, drawCalibrationLabel(spec, i + 1), slot.x, slot.y, xf(t))
  }
  if (spec.page) {
    const y = Math.max(3, spec.margin_top_mm / 2)
    const ruler: Drawing = {
      rects: [],
      strokes: [
        { x1: 20, y1: y, x2: 70, y2: y, width: 0.3 },
        ...Array.from({ length: 6 }, (_, k) => ({ x1: 20 + k * 10, y1: y - 1.5, x2: 20 + k * 10, y2: y, width: 0.3 })),
      ],
      texts: [{
        x: 74, y: y - 1.6, w: 120, sizePt: 7, font: 'helvetica', bold: false, maxLines: 1, align: 'left',
        text: 'This line should measure 50 mm. Print at 100% (Actual size).',
      }],
    }
    doc.setPage(1)
    paint(doc, ruler, 0, 0, xf(t))
  }
  return doc
}
