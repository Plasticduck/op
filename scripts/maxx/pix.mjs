// pix.mjs: the pixel-art toolkit behind every art script of Super Mighty Maxx.
// Node only, on top of pngjs. Hard edges everywhere: nothing here anti-aliases,
// blends or dithers, so what a script draws is exactly what ships.
//
// API SUMMARY
//
// Colours
//   A colour is a '#rrggbb' / '#rrggbbaa' / '#rgb' string, or a packed 0xRRGGBBAA
//   number (what get() returns). 0, null and 'none' are transparent.
//   rgba(c) -> packed number          hex(c) -> '#rrggbb' ('none' when transparent)
//   lum(c) -> 0..255 brightness       dist(a, b) -> perceptual-ish distance
//   nearest(c, palette) -> the palette entry closest to c
//
// Canvas (all drawing clips to the canvas; coordinates are whole pixels)
//   new Canvas(w, h, fill?)           c.w, c.h, c.d (Uint32Array of packed colours)
//   get(x, y) / set(x, y, col)        solid(x, y) -> true when not transparent
//   clear(col?)  clone()
//   rect(x, y, w, h, col)             filled
//   box(x, y, w, h, col)              1 px frame
//   line(x0, y0, x1, y1, col, thick?) Bresenham
//   ellipse(cx, cy, rx, ry, col, { fill }) / circle(cx, cy, r, col, { fill })
//                                     a whole-pixel centre gives 2r + 1 across, a
//                                     half-pixel centre (cx = 7.5) gives 2r across
//   poly([[x, y], ...], col, { fill, close })   even-odd fill plus its edges
//   flood(x, y, col, { diagonal })    bucket fill of the same-coloured region
//   blit(src, dx, dy, { flipX, flipY, swap, mode, sx, sy, sw, sh })
//       mode 'over' (default) | 'atop' (only onto solid pixels) | 'behind' (only
//       onto empty pixels) | 'erase' (punch the source's shape out)
//       swap: { '#from': '#to', ... } palette swap applied to the source
//   replace(from, to)  swap({ from: to, ... })   colour replace, in place
//   map((col, x, y) => col)           in place per-pixel rewrite
//   outline(col, { diagonal })        1 px outline around the solid shape, in place
//                                     (leave a 1 px margin or use pad(1) first)
//   mask(col?) -> Canvas              silhouette of the solid pixels
//   scale(n) -> Canvas                nearest neighbour, whole factor
//   flipX() / flipY() / crop(x, y, w, h) / pad(l, t?, r?, b?) -> Canvas
//   rot90(turns = 1) -> Canvas        quarter turns clockwise (negative = anticlockwise);
//                                     pixel (x, y) of a w x h canvas lands on (h - 1 - y, x)
//   bounds() -> { x, y, w, h } | null  trim() -> { canvas, x, y }
//   colours() -> Map(packed -> count) count() -> solid pixels
//   text(x, y, str, col, scale?)      built-in 3x5 caps font, returns the width drawn
//   save(file)                        palette PNG when 256 colours or fewer, else RGBA
//   Canvas.load(file)  Canvas.fromPNG(png)  toPNG()
//   Canvas.fromText(rows, legend)     hand-pixelled art: one character per pixel,
//                                     legend { char: colour }, '.' or ' ' is empty
//
// Review
//   contactSheet(rows, { bg, scale, flipX, ground, labels, wrap, file }) -> Canvas
//       rows: [{ label, frames: [{ canvas, ax, ay, label }] }] (or one flat frame
//       list). Every frame of a row sits on the same anchor, so jitter shows.
//   rulerSheet(canvas, { bg, scale, step, grid, file }) -> Canvas
//       one canvas blown up with pixel coordinates along the edges, for editing.
//
// Atlas packer
//   const a = new Atlas('cars', { script: 'art-cars.mjs' })
//   a.add('sedan0', canvas, { ax, ay })          one frame, exactly as drawn
//   a.addAnim('run', [canvas | { canvas, ax, ay }, ...], { ax, ay }) -> names run0..
//   a.anim('idle', ['stand0', 'stand1'])         an animation over existing frames
//   a.meta({ ... })                              merged into atlas.meta
//   a.write()  -> writes <name>.png + <name>.atlas.ts into ASSETS_DIR, then reads
//                 the PNG back and throws if it differs from what was packed
//   Frames are never trimmed, and sit 1 transparent pixel apart in the sheet so
//   neighbours cannot bleed. Identical frames share one spot in the sheet.
//   meta.sheet ({ w, h }) is added for you.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import pngjs from 'pngjs'
import { ASSETS_DIR } from './paths.mjs'

const { PNG } = pngjs

/* ------------------------------------------------------------------ */
/* Colours                                                             */
/* ------------------------------------------------------------------ */

/** Any colour form -> packed 0xRRGGBBAA. */
export function rgba(c) {
  if (c == null || c === 0 || c === 'none') return 0
  if (typeof c === 'number') return c >>> 0
  let s = String(c).trim().replace(/^#/, '')
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
  if (s.length === 6) s += 'ff'
  if (!/^[0-9a-f]{8}$/i.test(s)) throw new Error(`pix: bad colour "${c}"`)
  return parseInt(s, 16) >>> 0
}

/** Packed or string colour -> '#rrggbb' (alpha dropped), or 'none'. */
export function hex(c) {
  const v = rgba(c)
  if ((v & 0xff) === 0) return 'none'
  return '#' + (v >>> 8).toString(16).padStart(6, '0')
}

const R = (v) => v >>> 24
const G = (v) => (v >>> 16) & 0xff
const B = (v) => (v >>> 8) & 0xff
const A = (v) => v & 0xff

export function lum(c) {
  const v = rgba(c)
  return 0.299 * R(v) + 0.587 * G(v) + 0.114 * B(v)
}

/** Weighted RGB distance ("redmean"): good enough to snap a pixel to a palette. */
export function dist(a, b) {
  const p = rgba(a)
  const q = rgba(b)
  const rm = (R(p) + R(q)) / 2
  const dr = R(p) - R(q)
  const dg = G(p) - G(q)
  const db = B(p) - B(q)
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}

/** The entry of `palette` (array of colours) closest to c, as a packed colour. */
export function nearest(c, palette) {
  let best = 0
  let bd = Infinity
  for (const p of palette) {
    const d = dist(c, p)
    if (d < bd) {
      bd = d
      best = rgba(p)
    }
  }
  return best
}

function swapMap(swap) {
  if (!swap) return null
  const m = new Map()
  const entries = swap instanceof Map ? swap.entries() : Object.entries(swap)
  for (const [from, to] of entries) m.set(rgba(from), rgba(to))
  return m
}

/* ------------------------------------------------------------------ */
/* A 3x5 font for labels on review sheets (not game text)              */
/* ------------------------------------------------------------------ */

const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001110',
  '.': '000000000000010', ',': '000000000010100', ':': '000010000010000', '-': '000000111000000',
  '+': '000010111010000', '/': '001001010100100', '(': '010100100100010', ')': '010001001001010',
  '#': '101111101111101', '!': '010010010000010', '?': '110001010000010', _: '000000000000111',
  '=': '000111000111000', '%': '101001010100101', "'": '010010000000000', '<': '001010100010001',
  '>': '100010001010100', '*': '000101010101000',
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

export class Canvas {
  constructor(w, h, fill = 0) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error(`pix: bad canvas size ${w}x${h}`)
    this.w = w
    this.h = h
    this.d = new Uint32Array(w * h)
    const f = rgba(fill)
    if (f) this.d.fill(f)
  }

  /* pixels */

  get(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.d[y * this.w + x] : 0
  }

  set(x, y, col) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = rgba(col)
    return this
  }

  solid(x, y) {
    return A(this.get(x, y)) > 0
  }

  clear(col = 0) {
    this.d.fill(rgba(col))
    return this
  }

  clone() {
    const c = new Canvas(this.w, this.h)
    c.d.set(this.d)
    return c
  }

  /* shapes */

  rect(x, y, w, h, col) {
    const v = rgba(col)
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) this.d[j * this.w + i] = v
    }
    return this
  }

  box(x, y, w, h, col) {
    this.rect(x, y, w, 1, col)
    this.rect(x, y + h - 1, w, 1, col)
    this.rect(x, y, 1, h, col)
    this.rect(x + w - 1, y, 1, h, col)
    return this
  }

  line(x0, y0, x1, y1, col, thick = 1) {
    x0 = Math.round(x0)
    y0 = Math.round(y0)
    x1 = Math.round(x1)
    y1 = Math.round(y1)
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    const lo = -Math.floor((thick - 1) / 2)
    for (;;) {
      if (thick <= 1) this.set(x0, y0, col)
      else this.rect(x0 + lo, y0 + lo, thick, thick, col)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
    return this
  }

  ellipse(cx, cy, rx, ry, col, { fill = true } = {}) {
    const inside = (x, y) => {
      const dx = (x - cx) / (rx + 0.5)
      const dy = (y - cy) / (ry + 0.5)
      return dx * dx + dy * dy <= 1
    }
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (!inside(x, y)) continue
        if (fill || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) this.set(x, y, col)
      }
    }
    return this
  }

  circle(cx, cy, r, col, opts) {
    return this.ellipse(cx, cy, r, r, col, opts)
  }

  /** Polygon through pixel centres. Fills even-odd, then strokes the edges so every vertex is part of the shape. */
  poly(pts, col, { fill = true, close = true } = {}) {
    if (fill && pts.length > 2) {
      let y0 = Infinity
      let y1 = -Infinity
      for (const [, y] of pts) {
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
      for (let y = Math.ceil(y0); y <= Math.floor(y1); y++) {
        const xs = []
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i]
          const [bx, by] = pts[(i + 1) % pts.length]
          if (ay === by) continue
          // half-open on the upper end, so a vertex shared by two edges counts once
          if (y >= Math.min(ay, by) && y < Math.max(ay, by)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
        }
        xs.sort((a, b) => a - b)
        for (let i = 0; i + 1 < xs.length; i += 2) {
          for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) this.set(x, y, col)
        }
      }
    }
    const n = close ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[(i + 1) % pts.length]
      this.line(ax, ay, bx, by, col)
    }
    return this
  }

  flood(x, y, col, { diagonal = false } = {}) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this
    const from = this.d[y * this.w + x]
    const to = rgba(col)
    if (from === to) return this
    const stack = [[x, y]]
    while (stack.length) {
      const [px, py] = stack.pop()
      if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue
      if (this.d[py * this.w + px] !== from) continue
      this.d[py * this.w + px] = to
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1])
      if (diagonal) stack.push([px + 1, py + 1], [px - 1, py - 1], [px + 1, py - 1], [px - 1, py + 1])
    }
    return this
  }

  /* compositing */

  blit(src, dx = 0, dy = 0, { flipX = false, flipY = false, swap = null, mode = 'over', sx = 0, sy = 0, sw = src.w - sx, sh = src.h - sy } = {}) {
    const m = swapMap(swap)
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        let v = src.get(sx + (flipX ? sw - 1 - i : i), sy + (flipY ? sh - 1 - j : j))
        if (A(v) === 0) continue
        const x = dx + i
        const y = dy + j
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue
        const k = y * this.w + x
        const under = A(this.d[k]) > 0
        if (mode === 'erase') {
          this.d[k] = 0
          continue
        }
        if (mode === 'atop' && !under) continue
        if (mode === 'behind' && under) continue
        if (m && m.has(v)) v = m.get(v)
        this.d[k] = v
      }
    }
    return this
  }

  replace(from, to) {
    const f = rgba(from)
    const t = rgba(to)
    for (let i = 0; i < this.d.length; i++) if (this.d[i] === f) this.d[i] = t
    return this
  }

  swap(map) {
    const m = swapMap(map)
    for (let i = 0; i < this.d.length; i++) if (m.has(this.d[i])) this.d[i] = m.get(this.d[i])
    return this
  }

  map(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const k = y * this.w + x
        this.d[k] = rgba(fn(this.d[k], x, y))
      }
    }
    return this
  }

  /** Paint every empty pixel that touches the solid shape. */
  outline(col, { diagonal = false } = {}) {
    const v = rgba(col)
    const hits = []
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.solid(x, y)) continue
        let touch = this.solid(x - 1, y) || this.solid(x + 1, y) || this.solid(x, y - 1) || this.solid(x, y + 1)
        if (!touch && diagonal) touch = this.solid(x - 1, y - 1) || this.solid(x + 1, y - 1) || this.solid(x - 1, y + 1) || this.solid(x + 1, y + 1)
        if (touch) hits.push(y * this.w + x)
      }
    }
    for (const k of hits) this.d[k] = v
    return this
  }

  mask(col = '#ffffff') {
    const v = rgba(col)
    const c = new Canvas(this.w, this.h)
    for (let i = 0; i < this.d.length; i++) if (A(this.d[i]) > 0) c.d[i] = v
    return c
  }

  /* whole-canvas transforms (each returns a new canvas) */

  scale(n) {
    if (!Number.isInteger(n) || n < 1) throw new Error('pix: scale takes a whole factor')
    const c = new Canvas(this.w * n, this.h * n)
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) c.d[y * c.w + x] = this.d[Math.floor(y / n) * this.w + Math.floor(x / n)]
    }
    return c
  }

  flipX() {
    const c = new Canvas(this.w, this.h)
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) c.d[y * this.w + x] = this.d[y * this.w + (this.w - 1 - x)]
    return c
  }

  flipY() {
    const c = new Canvas(this.w, this.h)
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) c.d[y * this.w + x] = this.d[(this.h - 1 - y) * this.w + x]
    return c
  }

  /** Quarter turns clockwise (negative = anticlockwise). Exact: every pixel moves, none is resampled. */
  rot90(turns = 1) {
    const t = ((turns % 4) + 4) % 4
    if (t === 0) return this.clone()
    const c = t === 2 ? new Canvas(this.w, this.h) : new Canvas(this.h, this.w)
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = this.d[y * this.w + x]
        if (t === 1) c.d[x * c.w + (this.h - 1 - y)] = v
        else if (t === 2) c.d[(this.h - 1 - y) * c.w + (this.w - 1 - x)] = v
        else c.d[(this.w - 1 - x) * c.w + y] = v
      }
    }
    return c
  }

  crop(x, y, w, h) {
    const c = new Canvas(w, h)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) c.d[j * w + i] = this.get(x + i, y + j)
    return c
  }

  /** Grow the canvas: pad(1) on every side, or pad(left, top, right, bottom). */
  pad(l, t = l, r = l, b = t) {
    const c = new Canvas(this.w + l + r, this.h + t + b)
    c.blit(this, l, t)
    return c
  }

  /* measuring */

  bounds() {
    let x0 = this.w
    let y0 = this.h
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (A(this.d[y * this.w + x]) === 0) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  }

  /** The solid part only, and where it was: add x / y back to any anchor you keep. */
  trim() {
    const b = this.bounds() ?? { x: 0, y: 0, w: 1, h: 1 }
    return { canvas: this.crop(b.x, b.y, b.w, b.h), x: b.x, y: b.y }
  }

  colours() {
    const m = new Map()
    for (const v of this.d) if (A(v) > 0) m.set(v, (m.get(v) ?? 0) + 1)
    return m
  }

  count() {
    let n = 0
    for (const v of this.d) if (A(v) > 0) n++
    return n
  }

  /* text and files */

  text(x, y, str, col, scale = 1) {
    let cx = x
    for (const ch of String(str).toUpperCase()) {
      const g = FONT[ch]
      if (g) {
        for (let i = 0; i < 15; i++) {
          if (g[i] === '1') this.rect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, col)
        }
      }
      cx += 4 * scale
    }
    return cx - x
  }

  toPNG() {
    const png = new PNG({ width: this.w, height: this.h })
    for (let i = 0; i < this.d.length; i++) {
      const v = this.d[i]
      png.data[i * 4] = R(v)
      png.data[i * 4 + 1] = G(v)
      png.data[i * 4 + 2] = B(v)
      png.data[i * 4 + 3] = A(v)
    }
    return png
  }

  /** Writes a palette PNG when the canvas has 256 colours or fewer (a fraction of the size), else RGBA. */
  save(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, encodeIndexed(this) ?? PNG.sync.write(this.toPNG(), { colorType: 6 }))
    return this
  }

  /** Alpha is made hard: anything under half becomes empty, the rest fully opaque. */
  static fromPNG(png) {
    const c = new Canvas(png.width, png.height)
    for (let i = 0; i < c.d.length; i++) {
      const a = png.data[i * 4 + 3]
      c.d[i] = a < 128 ? 0 : ((png.data[i * 4] << 24) | (png.data[i * 4 + 1] << 16) | (png.data[i * 4 + 2] << 8) | 0xff) >>> 0
    }
    return c
  }

  static load(file) {
    return Canvas.fromPNG(PNG.sync.read(fs.readFileSync(file)))
  }

  /** Hand-pixelled art from text rows: each character is a colour from `legend`; '.' and ' ' are empty. */
  static fromText(rows, legend) {
    const w = Math.max(...rows.map((r) => r.length))
    const c = new Canvas(w, rows.length)
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        if (ch === '.' || ch === ' ') continue
        if (!(ch in legend)) throw new Error(`pix: no colour for "${ch}" in row ${y}: ${row}`)
        c.set(x, y, legend[ch])
      }
    })
    return c
  }
}

/* ------------------------------------------------------------------ */
/* Palette PNG writer (pngjs only writes truecolour)                   */
/* ------------------------------------------------------------------ */

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  data.copy(out, 8)
  let c = 0xffffffff
  for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 0xff] ^ (c >>> 8)
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length)
  return out
}

function encodeIndexed(c) {
  const index = new Map([[0, 0]])
  for (const v of c.d) {
    if (!index.has(v)) index.set(v, index.size)
    if (index.size > 256) return null
  }
  const colours = [...index.keys()]
  const head = Buffer.alloc(13)
  head.writeUInt32BE(c.w, 0)
  head.writeUInt32BE(c.h, 4)
  head.set([8, 3, 0, 0, 0], 8)
  const plte = Buffer.from(colours.flatMap((v) => [R(v), G(v), B(v)]))
  const trns = Buffer.from(colours.map((v) => A(v)))
  const raw = Buffer.alloc((c.w + 1) * c.h)
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) raw[y * (c.w + 1) + 1 + x] = index.get(c.d[y * c.w + x])
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', head),
    pngChunk('PLTE', plte),
    pngChunk('tRNS', trns),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ */
/* Review sheets                                                       */
/* ------------------------------------------------------------------ */

/**
 * Lay frames out for a look: one row per animation, every frame of a row in an
 * equal cell with its anchor at the same spot, scaled up, labelled.
 * rows: [{ label, frames: [{ canvas, ax = 0, ay = 0, label }] }], or a flat frame list.
 * opts: bg, scale (default 4), flipX (mirror every frame around its anchor),
 *       ground (draw the anchor line and tick), labels, wrap (frames per line), file.
 */
export function contactSheet(rows, { bg = '#6cc4ff', scale = 4, flipX = false, ground = true, labels = true, wrap = 12, file = null } = {}) {
  if (rows.length && !rows[0].frames) rows = [{ label: '', frames: rows }]
  const back = rgba(bg)
  const dark = lum(back) < 110
  const ink = dark ? '#f7f4f8' : '#16161d'
  const guide = dark ? '#4b4f5c' : '#3f9bdc'
  const gap = 2
  const labelH = labels ? 8 : 0
  const blocks = []
  let sheetW = 1
  let sheetH = gap
  for (const row of rows) {
    const frames = row.frames.map((f) => {
      const canvas = flipX ? f.canvas.flipX() : f.canvas
      const ax = f.ax ?? 0
      return { canvas, ax: flipX ? f.canvas.w - ax : ax, ay: f.ay ?? 0, label: f.label ?? '' }
    })
    let left = 0
    let right = 1
    let top = 0
    let bottom = 1
    for (const f of frames) {
      left = Math.max(left, f.ax)
      right = Math.max(right, f.canvas.w - f.ax)
      top = Math.max(top, f.ay)
      bottom = Math.max(bottom, f.canvas.h - f.ay)
    }
    const cw = left + right
    const ch = top + bottom
    const lines = Math.ceil(frames.length / wrap)
    const perLine = Math.min(wrap, frames.length)
    const w = gap + perLine * (cw * scale + gap)
    const titleH = labels && row.label ? 8 : 0
    const h = titleH + lines * (ch * scale + labelH + gap)
    blocks.push({ row, frames, left, top, cw, ch, y: sheetH, titleH })
    sheetW = Math.max(sheetW, w, labels && row.label ? gap + row.label.length * 4 + gap : 0)
    sheetH += h + gap
  }
  const sheet = new Canvas(sheetW, sheetH, back)
  for (const b of blocks) {
    if (b.titleH) sheet.text(gap, b.y + 1, b.row.label, ink)
    b.frames.forEach((f, i) => {
      const cx = gap + (i % wrap) * (b.cw * scale + gap)
      const cy = b.y + b.titleH + Math.floor(i / wrap) * (b.ch * scale + labelH + gap)
      const cell = new Canvas(b.cw, b.ch, back)
      if (ground) {
        cell.rect(0, b.top, b.cw, 1, guide)
        cell.rect(b.left, b.top, 1, 2, ink)
      }
      cell.blit(f.canvas, b.left - f.ax, b.top - f.ay)
      sheet.blit(cell.scale(scale), cx, cy)
      if (labels && f.label) sheet.text(cx, cy + b.ch * scale + 2, f.label, ink)
    })
  }
  if (file) sheet.save(file)
  return sheet
}

/**
 * One canvas blown up with pixel coordinates along the top and left edges and
 * a faint grid line every `step` pixels: for picking exact pixels to edit.
 */
export function rulerSheet(canvas, { bg = '#6cc4ff', scale = 8, step = 8, grid = true, file = null } = {}) {
  const back = rgba(bg)
  const dark = lum(back) < 110
  const ink = dark ? '#f7f4f8' : '#16161d'
  const guide = dark ? '#4b4f5c' : '#3f9bdc'
  const m = 14
  const sheet = new Canvas(m + canvas.w * scale + 1, m + canvas.h * scale + 1, back)
  const flat = new Canvas(canvas.w, canvas.h, back)
  flat.blit(canvas, 0, 0)
  sheet.blit(flat.scale(scale), m, m)
  for (let x = 0; x <= canvas.w; x += step) {
    if (grid) sheet.rect(m + x * scale, m, 1, canvas.h * scale, guide)
    sheet.rect(m + x * scale, m - 3, 1, 3, ink)
    if (x < canvas.w) sheet.text(m + x * scale + 2, 2, String(x), ink)
  }
  for (let y = 0; y <= canvas.h; y += step) {
    if (grid) sheet.rect(m, m + y * scale, canvas.w * scale, 1, guide)
    sheet.rect(m - 3, m + y * scale, 3, 1, ink)
    if (y < canvas.h) sheet.text(1, m + y * scale + 2, String(y), ink)
  }
  if (file) sheet.save(file)
  return sheet
}

/* ------------------------------------------------------------------ */
/* Atlas packer                                                        */
/* ------------------------------------------------------------------ */

const isIdent = (s) => /^[A-Za-z_$][\w$]*$/.test(s)

function tsLiteral(v, indent = '') {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const flat = (x) => x === null || typeof x !== 'object' || (Array.isArray(x) ? x.every((y) => y === null || typeof y !== 'object') : Object.values(x).every((y) => y === null || typeof y !== 'object'))
  if (Array.isArray(v)) {
    if (v.every(flat)) return `[${v.map((x) => tsLiteral(x)).join(', ')}]`
    return `[\n${v.map((x) => `${indent}  ${tsLiteral(x, indent + '  ')},`).join('\n')}\n${indent}]`
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined)
  const key = (k) => (isIdent(k) ? k : tsLiteral(k))
  if (!entries.length) return '{}'
  if (flat(v)) return `{ ${entries.map(([k, x]) => `${key(k)}: ${tsLiteral(x)}`).join(', ')} }`
  return `{\n${entries.map(([k, x]) => `${indent}  ${key(k)}: ${tsLiteral(x, indent + '  ')},`).join('\n')}\n${indent}}`
}

export class Atlas {
  /** script: the generator's file name, for the header of the generated module. */
  constructor(name, { script = `art-${name}.mjs`, maxWidth = 0 } = {}) {
    this.name = name
    this.script = script
    this.maxWidth = maxWidth
    this.frames = new Map()
    this.anims = {}
    this.metaData = {}
  }

  add(frameName, canvas, { ax = 0, ay = 0 } = {}) {
    if (this.frames.has(frameName)) throw new Error(`atlas ${this.name}: frame "${frameName}" added twice`)
    if (!Number.isInteger(ax) || !Number.isInteger(ay)) throw new Error(`atlas ${this.name}: frame "${frameName}" needs a whole-pixel anchor`)
    this.frames.set(frameName, { canvas, ax, ay })
    return this
  }

  /** Add frames <name>0, <name>1, ... and the animation <name> over them. Returns the frame names. */
  addAnim(name, frames, { ax = 0, ay = 0 } = {}) {
    const names = frames.map((f, i) => {
      const fr = f instanceof Canvas ? { canvas: f } : f
      this.add(`${name}${i}`, fr.canvas, { ax: fr.ax ?? ax, ay: fr.ay ?? ay })
      return `${name}${i}`
    })
    this.anims[name] = names
    return names
  }

  anim(name, frameNames) {
    this.anims[name] = [...frameNames]
    return this
  }

  meta(obj) {
    Object.assign(this.metaData, obj)
    return this
  }

  /** Shelf-pack tallest first. Deterministic, so a rerun with the same art gives the same files. */
  pack() {
    const unique = []
    const byKey = new Map()
    for (const [name, f] of this.frames) {
      const key = `${f.canvas.w}x${f.canvas.h}:${Buffer.from(f.canvas.d.buffer, f.canvas.d.byteOffset, f.canvas.d.byteLength).toString('latin1')}`
      let u = byKey.get(key)
      if (!u) {
        u = { canvas: f.canvas, x: 0, y: 0, order: unique.length }
        byKey.set(key, u)
        unique.push(u)
      }
      f.slot = u
      void name
    }
    const sorted = [...unique].sort((a, b) => b.canvas.h - a.canvas.h || a.order - b.order)
    let area = 0
    let widest = 0
    for (const u of sorted) {
      area += (u.canvas.w + 1) * (u.canvas.h + 1)
      widest = Math.max(widest, u.canvas.w)
    }
    let limit = this.maxWidth
    if (!limit) {
      limit = 64
      while (limit < widest + 2 || limit * limit < area * 1.15) limit *= 2
    }
    let x = 1
    let y = 1
    let shelf = 0
    let w = 1
    for (const u of sorted) {
      if (x + u.canvas.w + 1 > limit && x > 1) {
        x = 1
        y += shelf + 1
        shelf = 0
      }
      u.x = x
      u.y = y
      x += u.canvas.w + 1
      shelf = Math.max(shelf, u.canvas.h)
      w = Math.max(w, x)
    }
    const sheet = new Canvas(w, y + shelf + 1)
    for (const u of sorted) sheet.blit(u.canvas, u.x, u.y)
    return sheet
  }

  source(sheet) {
    const frames = {}
    for (const [name, f] of this.frames) {
      frames[name] = { x: f.slot.x, y: f.slot.y, w: f.canvas.w, h: f.canvas.h, ax: f.ax, ay: f.ay }
    }
    for (const [anim, names] of Object.entries(this.anims)) {
      for (const n of names) if (!this.frames.has(n)) throw new Error(`atlas ${this.name}: anim "${anim}" uses unknown frame "${n}"`)
    }
    const frameLines = Object.entries(frames).map(([k, v]) => `    ${isIdent(k) ? k : tsLiteral(k)}: ${tsLiteral(v)},`)
    const animLines = Object.entries(this.anims).map(([k, v]) => `    ${isIdent(k) ? k : tsLiteral(k)}: ${tsLiteral(v)},`)
    const meta = { ...this.metaData, sheet: { w: sheet.w, h: sheet.h } }
    return [
      `// GENERATED by scripts/maxx/${this.script}. Do not edit.`,
      `import type { AtlasDef } from '../contract'`,
      `import image from './${this.name}.png'`,
      `export const atlas: AtlasDef = {`,
      `  name: ${tsLiteral(this.name)},`,
      `  image,`,
      `  frames: {`,
      ...frameLines,
      `  },`,
      `  anims: {`,
      ...animLines,
      `  },`,
      `  meta: ${tsLiteral(meta, '  ')},`,
      `}`,
      ``,
    ].join('\n')
  }

  /** Writes <name>.png and <name>.atlas.ts. Returns { png, ts, sheet }. */
  write({ dir = ASSETS_DIR } = {}) {
    const sheet = this.pack()
    const png = path.join(dir, `${this.name}.png`)
    const ts = path.join(dir, `${this.name}.atlas.ts`)
    sheet.save(png)
    // read it back: a frame map over a sheet that did not survive the trip is worse than no atlas
    const back = Canvas.load(png)
    if (back.w !== sheet.w || back.h !== sheet.h || back.d.some((v, i) => v !== sheet.d[i])) throw new Error(`atlas ${this.name}: ${png} does not read back as written`)
    fs.writeFileSync(ts, this.source(sheet))
    return { png, ts, sheet }
  }
}
