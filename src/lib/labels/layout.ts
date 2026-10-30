import QRCode from 'qrcode'
import { CODE128_QUIET, code128Widths } from '@/lib/barcode/code128'

// Sticker label geometry, in millimetres, for any label size. Pure: no DOM and
// no PDF library, so the same layout drives the printed PDF, the on-screen
// preview (which renders that PDF) and the scan tests. Text blocks carry a
// width and a line limit; the renderer wraps and truncates them.
//
// Scan reliability comes first: the QR keeps a 4-module quiet zone, the
// Code 128 keeps its 10-module quiet zones, and bars are never drawn narrower
// than 0.19 mm (the barcode is left off rather than printed unreadable). A
// logo only ever takes the top of the text column beside the QR, and is left
// off when the tag wouldn't fit under it.

export type LabelSpec = {
  page: { w_mm: number; h_mm: number } | null // null = roll, one label per page
  label: { w_mm: number; h_mm: number }
  cols: number
  rows: number
  margin_top_mm: number
  margin_left_mm: number
  pitch_x_mm: number
  pitch_y_mm: number
}

export type LabelStyle = 'standard' | 'compact' | 'outdoor'
export type LabelLayoutSpec = { style: LabelStyle; show: string[] }

export type LabelContent = {
  tag: string
  url: string
  name?: string | null
  site?: string | null
  phone?: string | null
}

export type Rect = { x: number; y: number; w: number; h: number }
export type TextBlock = {
  x: number
  y: number // top of the first line
  w: number
  text: string
  sizePt: number
  font: 'helvetica' | 'courier'
  bold: boolean
  maxLines: number
  align: 'left' | 'center'
}
export type Stroke = { x1: number; y1: number; x2: number; y2: number; width: number }
export type Drawing = { rects: Rect[]; texts: TextBlock[]; strokes: Stroke[] }

export const PT_MM = 25.4 / 72
const lineMm = (pt: number) => pt * PT_MM * 1.18
export const MIN_BAR_MM = 0.19
const QR_QUIET = 4
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Dark QR modules as rects, merged along rows.
function qrRects(url: string, x: number, y: number, box: number, ecc: 'M' | 'Q'): { rects: Rect[]; moduleMm: number } {
  const qr = QRCode.create(url, { errorCorrectionLevel: ecc })
  const n = qr.modules.size
  const m = box / (n + QR_QUIET * 2)
  const ox = x + QR_QUIET * m
  const oy = y + QR_QUIET * m
  const rects: Rect[] = []
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!qr.modules.data[r * n + c]) { c++; continue }
      const start = c
      while (c < n && qr.modules.data[r * n + c]) c++
      // A hair taller than a module so rows overlap: no white seams where
      // renderers and printers round between rows.
      rects.push({ x: ox + start * m, y: oy + r * m, w: (c - start) * m, h: m + Math.min(0.05, m * 0.1) })
    }
  }
  return { rects, moduleMm: m }
}

// Code 128 bars filling at most `maxW` (quiet zones included). Null when the
// bars would come out too thin to scan.
function barcodeRects(tag: string, x: number, y: number, maxW: number, h: number): { rects: Rect[]; barMm: number; w: number } | null {
  const widths = code128Widths(tag)
  const total = widths.reduce((a, b) => a + b, 0) + CODE128_QUIET * 2
  const xdim = Math.min(0.33, maxW / total)
  if (xdim < MIN_BAR_MM) return null
  const rects: Rect[] = []
  let cx = x + CODE128_QUIET * xdim
  widths.forEach((wm, i) => {
    if (i % 2 === 0) rects.push({ x: cx, y, w: wm * xdim, h })
    cx += wm * xdim
  })
  return { rects, barMm: xdim, w: total * xdim }
}

// Stack the text that fits in a column: tag, then name (up to 2 lines), site,
// phone. Lower-priority lines drop out first when space runs short.
function textColumn(c: LabelContent, show: string[], x: number, y: number, w: number, h: number, tagPt: number, align: 'left' | 'center'): TextBlock[] {
  const out: TextBlock[] = []
  const smallPt = clamp(tagPt * 0.62, 5.5, 9)
  let cy = y
  const fits = (pt: number, lines: number) => cy + lineMm(pt) * lines <= y + h + 0.01
  if (show.includes('tag') && fits(tagPt, 1)) {
    out.push({ x, y: cy, w, text: c.tag, sizePt: tagPt, font: 'courier', bold: true, maxLines: 1, align })
    cy += lineMm(tagPt) + 0.4
  }
  if (show.includes('name') && c.name) {
    const lines = fits(smallPt, 2) ? 2 : fits(smallPt, 1) ? 1 : 0
    if (lines) {
      out.push({ x, y: cy, w, text: c.name, sizePt: smallPt, font: 'helvetica', bold: true, maxLines: lines, align })
      cy += lineMm(smallPt) * lines
    }
  }
  const tinyPt = smallPt * 0.9
  if (show.includes('site') && c.site && fits(tinyPt, 1)) {
    out.push({ x, y: cy, w, text: c.site, sizePt: tinyPt, font: 'helvetica', bold: false, maxLines: 1, align })
    cy += lineMm(tinyPt)
  }
  if (show.includes('phone') && c.phone && fits(tinyPt, 1)) {
    out.push({ x, y: cy, w, text: `Help: ${c.phone}`, sizePt: tinyPt, font: 'helvetica', bold: false, maxLines: 1, align })
  }
  return out
}

// The logo's box at the top of a text column (aspect = width / height), or
// null when it would crowd out the tag and a line of name, or come out too
// thin to make out.
function logoBand(aspect: number, x: number, y: number, w: number, h: number): Rect | null {
  let lh = clamp(h * 0.24, 3, 10)
  let lw = lh * aspect
  if (lw > w) {
    lw = w
    lh = lw / aspect
  }
  if (lh < 2.2) return null
  if (h - lh - 0.8 < lineMm(7) + 0.4 + lineMm(5.5)) return null
  return { x, y, w: lw, h: lh }
}

export type LabelDrawing = Drawing & { qrModuleMm: number; barMm: number | null; logo: Rect | null }

// One label at (0, 0), sized spec.label. Also returns what scanning depends on,
// and where the logo goes when there is one (logoAspect) and the layout shows it.
export function drawLabel(c: LabelContent, spec: LabelSpec, layout: LabelLayoutSpec, logoAspect?: number | null): LabelDrawing {
  const W = spec.label.w_mm
  const H = spec.label.h_mm
  const pad = clamp(Math.min(W, H) * 0.05, 1.2, 3)
  const show = layout.show
  const d: Drawing = { rects: [], texts: [], strokes: [] }
  let barMm: number | null = null
  let logo: Rect | null = null
  const wantLogo = !!logoAspect && logoAspect > 0 && show.includes('logo')

  if (layout.style === 'outdoor') {
    // Big QR with extra error correction (survives dirt and fading), tag under it.
    const band = H * 0.24
    const box = Math.min(W - 2 * pad, H - 2 * pad - band)
    const qr = qrRects(c.url, (W - box) / 2, pad, box, 'Q')
    d.rects.push(...qr.rects)
    const tagPt = clamp((band * 0.5) / PT_MM / 1.18, 7, 16)
    d.texts.push(...textColumn(c, show.filter((s) => s === 'tag' || s === 'name'), pad, pad + box + 0.5, W - 2 * pad, band - 0.5, tagPt, 'center'))
    return { ...d, qrModuleMm: qr.moduleMm, barMm, logo }
  }

  const wantBar = show.includes('barcode')
  const side = W - H >= 28
  if (side) {
    // QR full height on the left; text and barcode in the column beside it.
    const box = H - 2 * pad
    const qr = qrRects(c.url, pad, pad, box, 'M')
    d.rects.push(...qr.rects)
    const x0 = pad + box + 1
    const cw = W - x0 - pad
    let textH = H - 2 * pad
    if (wantBar) {
      const hb = clamp(H * 0.26, 4, 10)
      const bar = barcodeRects(c.tag, x0, H - pad - hb, cw, hb)
      if (bar) {
        d.rects.push(...bar.rects)
        barMm = bar.barMm
        textH -= hb + 0.8
      }
    }
    let ty = pad
    if (wantLogo) {
      logo = logoBand(logoAspect, x0, pad, cw, textH)
      if (logo) {
        ty += logo.h + 0.8
        textH -= logo.h + 0.8
      }
    }
    const tagPt = clamp((textH * 0.3) / PT_MM / 1.18, 7, layout.style === 'compact' ? 11 : 16)
    d.texts.push(...textColumn(c, show, x0, ty, cw, textH, tagPt, 'left'))
    return { ...d, qrModuleMm: qr.moduleMm, barMm, logo }
  }

  // Stacked: QR and text on top, barcode across the full width underneath.
  let topH = H - 2 * pad
  if (wantBar) {
    const hb = clamp(H * 0.24, 5, 9)
    const bar = barcodeRects(c.tag, pad, H - pad - hb, W - 2 * pad, hb)
    if (bar) {
      // Center the bars (quiet zones included) in the band.
      const shift = (W - 2 * pad - bar.w) / 2
      d.rects.push(...bar.rects.map((r) => ({ ...r, x: r.x + shift })))
      barMm = bar.barMm
      topH -= hb + 1
    }
  }
  const box = topH
  const qr = qrRects(c.url, pad, pad, box, 'M')
  d.rects.push(...qr.rects)
  const x0 = pad + box + 1
  let ty = pad
  let textH = topH
  if (wantLogo) {
    logo = logoBand(logoAspect, x0, pad, W - x0 - pad, topH)
    if (logo) {
      ty += logo.h + 0.8
      textH -= logo.h + 0.8
    }
  }
  const tagPt = clamp((textH * 0.3) / PT_MM / 1.18, 7, 14)
  d.texts.push(...textColumn(c, show, x0, ty, W - x0 - pad, textH, tagPt, 'left'))
  return { ...d, qrModuleMm: qr.moduleMm, barMm, logo }
}

// Where label number i (0-based, after skipping `startAt` used positions on
// the first sheet) lands: page index and top-left in page millimetres.
export function labelSlot(spec: LabelSpec, i: number, startAt = 0): { page: number; x: number; y: number } {
  if (!spec.page) return { page: i, x: 0, y: 0 }
  const per = spec.cols * spec.rows
  const pos = i + startAt
  const within = pos % per
  return {
    page: Math.floor(pos / per),
    x: spec.margin_left_mm + (within % spec.cols) * spec.pitch_x_mm,
    y: spec.margin_top_mm + Math.floor(within / spec.cols) * spec.pitch_y_mm,
  }
}

export const labelsPerPage = (spec: LabelSpec) => (spec.page ? spec.cols * spec.rows : 1)

// The calibration test for one label position: its outline, a centre cross,
// and its number. Printed with the same offsets and scale as real labels, so
// the outline shows exactly where stickers will land.
export function drawCalibrationLabel(spec: LabelSpec, n: number): Drawing {
  const W = spec.label.w_mm
  const H = spec.label.h_mm
  const inset = spec.page ? 0 : 1 // roll printers can't print to the very edge
  const s = 0.25
  const cx = W / 2
  const cy = H / 2
  const arm = Math.min(4, Math.min(W, H) / 4)
  return {
    rects: [],
    strokes: [
      { x1: inset, y1: inset, x2: W - inset, y2: inset, width: s },
      { x1: W - inset, y1: inset, x2: W - inset, y2: H - inset, width: s },
      { x1: W - inset, y1: H - inset, x2: inset, y2: H - inset, width: s },
      { x1: inset, y1: H - inset, x2: inset, y2: inset, width: s },
      { x1: cx - arm, y1: cy, x2: cx + arm, y2: cy, width: s },
      { x1: cx, y1: cy - arm, x2: cx, y2: cy + arm, width: s },
    ],
    texts: [{
      x: inset + 1, y: inset + 1, w: W - 2 * inset - 2, text: spec.page ? `Label ${n}` : 'Box should sit 1 mm inside the label edge',
      sizePt: Math.min(7, Math.max(4.5, H / 5)), font: 'helvetica', bold: false, maxLines: 2, align: 'left',
    }],
  }
}
