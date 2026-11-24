// art-title.mjs: generates the 'title' atlas: the SUPER MIGHTY MAXX logo and everything
// the title, game over, ending and how-to-play screens draw that is neither the hero nor
// the cars (those screens draw the game's own cars, from the 'cars' atlas).
//
//   node scripts/maxx/art-title.mjs                    writes title.png + title.atlas.ts
//   node scripts/maxx/art-title.mjs --review <dir>     also writes contact sheets into <dir>:
//       the logo on the skies it is shown against (1x and 3x), its swoosh's end at 6x,
//       GAME OVER, the scenery strips, the props and the icons
//
// Everything is drawn here from shapes and numbers: there is no source picture. The logo's
// letters are built upright on whole pixels (block capitals with chamfered corners) and
// leaned by sliding each row, one pixel every four rows, so every edge stays a clean stair.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, rgba } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const OUT = PAL.outline
const NAVY = PAL.navy
const WHITE = PAL.grey[6]
const INK = '#ffffff'

/** Deterministic noise for dirt, drips and confetti: the same art on every run. */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* 1. Block capitals                                                   */
/* ------------------------------------------------------------------ */

/** Erase (or with `col`, fill) the k-step triangle in a corner; (dx, dy) point into the shape. */
function tri(c, x, y, dx, dy, k, col = 0) {
  for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) c.set(x + dx * i, y + dy * j, col)
}

/** Cut the outer corners of a box. `which` names them: tl tr bl br. */
function cut(c, x, y, w, h, k, which = 'tl tr bl br') {
  if (which.includes('tl')) tri(c, x, y, 1, 1, k)
  if (which.includes('tr')) tri(c, x + w - 1, y, -1, 1, k)
  if (which.includes('bl')) tri(c, x, y + h - 1, 1, -1, k)
  if (which.includes('br')) tri(c, x + w - 1, y + h - 1, -1, -1, k)
}

/** Punch a counter: a box whose named corners stay filled by k steps. */
function hole(c, x, y, w, h, k, which = 'tl tr bl br') {
  c.rect(x, y, w, h, 0)
  if (which.includes('tl')) tri(c, x, y, 1, 1, k, INK)
  if (which.includes('tr')) tri(c, x + w - 1, y, -1, 1, k, INK)
  if (which.includes('bl')) tri(c, x, y + h - 1, 1, -1, k, INK)
  if (which.includes('br')) tri(c, x + w - 1, y + h - 1, -1, -1, k, INK)
}

// Width of each capital as a share of its height.
const WIDE = { A: 0.86, D: 0.8, E: 0.68, G: 0.9, H: 0.8, M: 1.06, N: 0.84, O: 0.8, P: 0.74, R: 0.78, S: 0.74, T: 0.76, U: 0.8, V: 0.86, W: 1.06, X: 0.86, Y: 0.86 }

/**
 * One capital as a white mask, upright. H: cap height, t: stem width, b: bar height,
 * k: chamfer of the outer corners.
 */
function capital(ch, H, t, { b = Math.max(2, Math.round(t * 0.82)), k = Math.max(1, Math.round(t * 0.36)), w = 0 } = {}) {
  const W = ch === 'I' ? t : w || Math.round(H * WIDE[ch])
  const c = new Canvas(W, H)
  const ki = Math.max(0, k - 2)
  const mid = Math.round((H - b) / 2)
  // Diagonals are a little wider across than the stems, or they would look thin.
  const td = Math.round(t * 1.12)
  const R = (x, y, w2, h2) => c.rect(x, y, w2, h2, INK)
  switch (ch) {
    case 'I':
      R(0, 0, t, H)
      break
    case 'H':
      R(0, 0, t, H)
      R(W - t, 0, t, H)
      R(0, mid, W, b)
      break
    case 'T':
      R(0, 0, W, b)
      R(Math.round((W - t) / 2), 0, t, H)
      break
    case 'E':
      R(0, 0, t, H)
      R(0, 0, W, b)
      R(0, H - b, W, b)
      R(0, mid, W - Math.round(t * 0.4), b)
      break
    case 'O':
    case 'D':
      R(0, 0, W, H)
      cut(c, 0, 0, W, H, k, ch === 'D' ? 'tr br' : undefined)
      hole(c, t, b, W - 2 * t, H - 2 * b, ki, ch === 'D' ? 'tr br' : undefined)
      break
    case 'G': {
      // An open mouth and a short spur, or at this weight it closes up into a blob.
      const sy = Math.round(H * 0.5)
      const sb = Math.max(2, Math.round(b * 0.8))
      R(0, 0, W, H)
      cut(c, 0, 0, W, H, k)
      hole(c, t, b, W - 2 * t, H - 2 * b, ki)
      const lip = b + Math.max(1, Math.round(b * 0.2))
      c.rect(W - t, lip, t, sy - lip, 0)
      const sx = Math.round(W * 0.54)
      R(sx, sy, W - sx, sb)
      break
    }
    case 'W': {
      const m = capital('M', H, t, { b, k, w: W })
      c.blit(m.flipY(), 0, 0)
      break
    }
    case 'U':
      R(0, 0, t, H)
      R(W - t, 0, t, H)
      R(0, H - b, W, b)
      cut(c, 0, 0, W, H, k, 'bl br')
      tri(c, t, H - b - 1, 1, -1, ki, INK)
      tri(c, W - t - 1, H - b - 1, -1, -1, ki, INK)
      break
    case 'S': {
      const lip = Math.max(1, Math.round(b * 0.4))
      R(0, 0, W, b)
      R(0, mid, W, b)
      R(0, H - b, W, b)
      R(0, 0, t, mid + b)
      R(W - t, mid, t, H - mid)
      R(W - t, 0, t, b + lip)
      R(0, H - b - lip, t, b + lip)
      cut(c, 0, 0, W, H, k)
      tri(c, 0, mid + b - 1, 1, -1, k)
      tri(c, W - 1, mid, -1, 1, k)
      tri(c, t, b, 1, 1, ki, INK)
      tri(c, t, mid - 1, 1, -1, ki, INK)
      tri(c, W - t - 1, mid + b, -1, 1, ki, INK)
      tri(c, W - t - 1, H - b - 1, -1, -1, ki, INK)
      break
    }
    case 'P':
    case 'R': {
      const hb = Math.round(H * 0.58)
      R(0, 0, t, H)
      R(0, 0, W, b)
      R(0, hb - b, W, b)
      R(W - t, 0, t, hb)
      cut(c, 0, 0, W, hb, k, 'tr br')
      tri(c, W - t - 1, b, -1, 1, ki, INK)
      tri(c, W - t - 1, hb - b - 1, -1, -1, ki, INK)
      if (ch === 'R') {
        const xm = Math.round(W * 0.36)
        c.poly([[xm, hb - 1], [xm + td - 1, hb - 1], [W - 1, H - 1], [W - td, H - 1]], INK)
      }
      break
    }
    case 'A':
    case 'V': {
      // A flat-topped wedge with a wedge taken out of it; V is the same thing upside down.
      const a = Math.round(t * 1.15) + ((W - Math.round(t * 1.15)) % 2)
      const xl = (W - a) / 2
      const bar = Math.round(H * 0.6)
      for (let y = 0; y < H; y++) {
        const f = y / (H - 1)
        const ol = Math.round(xl * (1 - f))
        const or = W - 1 - ol
        const row = ch === 'A' ? y : H - 1 - y
        c.rect(ol, row, or - ol + 1, 1, INK)
        const il = ol + td
        const ir = or - td
        const inBar = ch === 'A' && y >= bar && y < bar + b
        if (ir >= il && !inBar) c.rect(il, row, ir - il + 1, 1, 0)
      }
      break
    }
    case 'X':
      c.poly([[0, 0], [td - 1, 0], [W - 1, H - 1], [W - td, H - 1]], INK)
      c.poly([[W - td, 0], [W - 1, 0], [td - 1, H - 1], [0, H - 1]], INK)
      break
    case 'Y': {
      const ym = Math.round(H * 0.52)
      const sl = Math.round((W - t) / 2)
      c.poly([[0, 0], [td - 1, 0], [sl + t - 1, ym], [sl, ym]], INK)
      c.poly([[W - td, 0], [W - 1, 0], [sl + t - 1, ym], [sl, ym]], INK)
      R(sl, ym - 1, t, H - ym + 1)
      break
    }
    case 'N':
      R(0, 0, t, H)
      R(W - t, 0, t, H)
      c.poly([[0, 0], [td - 1, 0], [W - 1, H - 1], [W - td, H - 1]], INK)
      break
    case 'M': {
      // Two stems, and a V whose strokes are thinner than the stems, as on the wordmark.
      const hd = Math.max(2, Math.round(t * 0.62))
      const cx = (W - 1) / 2
      const d1 = Math.round(H * 0.5)
      const m = d1 / (cx - t)
      R(0, 0, t, H)
      R(W - t, 0, t, H)
      for (let y = 0; y < H; y++) {
        // The stroke's upper edge leaves the stem's inner top corner; the lower edge runs hd to its left.
        const hi = t - 1 + y / m
        const lo = hi - hd
        const x0 = Math.max(t, Math.round(lo))
        const x1 = Math.min(Math.floor(cx), Math.round(hi))
        if (x1 >= x0 && lo <= cx) {
          c.rect(x0, y, x1 - x0 + 1, 1, INK)
          c.rect(W - 1 - x1, y, x1 - x0 + 1, 1, INK)
        }
      }
      break
    }
    default:
      throw new Error('no capital ' + ch)
  }
  return c
}

/** Slide each row right, one pixel every `per` rows, the bottom row staying put. */
function lean(c, per = 4) {
  const extra = Math.floor((c.h - 1) / per)
  const o = new Canvas(c.w + extra, c.h)
  for (let y = 0; y < c.h; y++) {
    const s = Math.floor((c.h - 1 - y) / per)
    for (let x = 0; x < c.w; x++) {
      const v = c.get(x, y)
      if (v) o.set(x + s, y, v)
    }
  }
  return o
}

/**
 * Letters set on a baseline. spec: [{ ch, H, t, gap }]. Returns the mask and its
 * baseline row (the last row of the tallest letter).
 */
function setWord(spec) {
  const caps = spec.map((s) => ({ ...s, c: capital(s.ch, s.H, s.t, s.o) }))
  const H = Math.max(...caps.map((s) => s.H))
  const W = caps.reduce((n, s, i) => n + s.c.w + (i ? s.gap : 0), 0)
  const out = new Canvas(W, H)
  let x = 0
  caps.forEach((s, i) => {
    if (i) x += s.gap
    out.blit(s.c, x, H - s.H)
    x += s.c.w
  })
  return out
}

/** Paint a white mask in flat bands. bands: [[rowsFromBottom, colour], ...], bottom band first; the last colour runs to the top. */
function paintBands(mask, bands, { top = null, bottom = null } = {}) {
  const o = new Canvas(mask.w, mask.h)
  for (let y = 0; y < mask.h; y++) {
    const up = mask.h - 1 - y
    let col = bands[bands.length - 1][1]
    let edge = 0
    for (const [rows, c] of bands) {
      edge += rows
      if (up < edge) {
        col = c
        break
      }
    }
    for (let x = 0; x < mask.w; x++) if (mask.solid(x, y)) o.set(x, y, col)
  }
  // A lit top edge and a dark foot give the flat bands some weight.
  if (top || bottom) {
    for (let y = 0; y < mask.h; y++) {
      for (let x = 0; x < mask.w; x++) {
        if (!mask.solid(x, y)) continue
        if (top && !mask.solid(x, y - 1)) o.set(x, y, top)
        else if (bottom && !mask.solid(x, y + 1)) o.set(x, y, bottom)
      }
    }
  }
  return o
}

function ring(c, col, n) {
  for (let i = 0; i < n; i++) c.outline(col, { diagonal: i === 0 && n > 1 })
  return c
}

/* ------------------------------------------------------------------ */
/* 2. The logo                                                         */
/* ------------------------------------------------------------------ */

const BIG = { H: 62, t: 18 }
const SMALL = { H: 44, t: 13 }
const GAP = 6

function buildLogo() {
  const big = (ch) => ({ ch, ...BIG, gap: GAP, o: { w: 68 } })
  const small = (ch, gap = GAP) => ({ ch, ...SMALL, gap })
  const mighty = setWord([big('M'), small('I'), small('G'), small('H'), small('T'), small('Y', 5)])
  // The two X's need air between them: touching arms close up into a diamond.
  const maxx = setWord([big('M'), small('A', 4), { ...small('X', 5), o: { w: 34 } }, { ...small('X', 10), o: { w: 34 } }])
  const sup = setWord('SUPER'.split('').map((ch) => ({ ch, H: 17, t: 5, gap: 3, o: { b: 4, k: 2 } })))

  const red = PAL.red
  const blue = PAL.blue
  const paintRed = (m) => paintBands(m, [[12, red[2]], [17, red[3]], [99, red[4]]], { top: red[5], bottom: red[1] })
  // A shade deeper than the red, step for step: the light blues are the sky's, and MAXX must stand off it.
  const paintBlue = (m) => paintBands(m, [[12, blue[0]], [17, blue[1]], [99, blue[2]]], { top: blue[3], bottom: NAVY })

  // Upright layout. Margins leave room for the rings, the drop and the lean.
  const M = 8
  const wordGap = 20
  const top = 12
  const W0 = M + mighty.w + wordGap + maxx.w + M
  const H0 = top + BIG.H
  const faces = new Canvas(W0, H0)
  faces.blit(paintRed(mighty), M, top)
  const maxxX = M + mighty.w + wordGap
  faces.blit(paintBlue(maxx), maxxX, top)

  // SUPER rides the shelf the small capitals leave beside the first big M.
  const supFaces = new Canvas(W0, H0)
  const supX = M + 68 + GAP + 8
  const supY = top + (BIG.H - SMALL.H) - 17 - 6
  supFaces.blit(paintBands(sup, [[6, PAL.yellow[1]], [99, PAL.yellow[2]]], { top: WHITE, bottom: PAL.yellow[0] }), supX, supY)

  const leanFaces = lean(faces)
  const leanSup = lean(supFaces)
  const pad = 6
  const main = ring(ring(leanFaces.pad(pad), WHITE, 2), NAVY, 2)
  const supL = ring(ring(leanSup.pad(pad), NAVY, 2), WHITE, 0)

  const swooshH = 34
  const W = main.w + 10
  const H = main.h + swooshH
  const logo = new Canvas(W, H)

  // The swoosh: a blade of water under the words, thin at the left, full at the right,
  // dipping as it goes, light at its tail and deep at its head like the wordmark's. Its
  // head is cut on the slant the letters lean at, and breaks up into streaks.
  const base = pad + H0 + 1
  const sw = new Canvas(W, H)
  const x0 = 3
  const x1 = W - 34
  const span = x1 - x0
  const topAt = (x) => base + Math.round(8 * Math.pow(Math.min(1, (x - x0) / span), 2))
  const thickAt = (x) => Math.max(2, Math.round(2 + 20 * Math.pow(Math.min(1, (x - x0) / span), 1.3)))
  // Colour by how far along: three steps, their seams leaning with the letters.
  const shade = (x, j) => {
    const f = (x + (j >> 1) - x0) / span
    return f < 0.3 ? [blue[4], WHITE] : f < 0.62 ? [blue[2], blue[3]] : [blue[1], blue[2]]
  }
  for (let x = x0; x <= x1; x++) {
    const thick = thickAt(x)
    for (let j = 0; j < thick; j++) {
      // The slanted head: the bottom rows stop short.
      if (x > x1 - (j >> 1)) continue
      const [body, lit] = shade(x, j)
      sw.set(x, topAt(x) + j, j === 0 && thick >= 4 ? lit : body)
    }
  }
  // Streaks flying off the head: strands of the blade, split by gaps, that run on past it.
  const head = thickAt(x1)
  for (const [j0, rows, cut, run] of [[3, 2, 40, 22], [9, 3, 64, 30], [16, 2, 30, 12]]) {
    if (j0 + rows > head) continue
    // A gap above the strand from `cut` pixels back, then the strand runs on `run` past the head.
    for (let i = 0; i < cut; i++) sw.rect(x1 - (j0 >> 1) - i, topAt(x1 - i) + j0 - 1, 1, 1, 0)
    for (let i = 1; i <= run; i++) {
      const x = x1 - ((j0 + rows) >> 1) + i
      for (let r = 0; r < rows; r++) sw.set(x, topAt(x1) + j0 + r, i > run - 4 ? blue[2] : blue[1])
    }
  }
  ring(sw, NAVY, 2)

  const mainMask = main.mask(NAVY)
  // The drop: the navy shape pushed down and right.
  for (let d = 1; d <= 4; d++) logo.blit(mainMask, d, d)
  logo.blit(sw, 0, 0)
  logo.blit(main, 0, 0)
  const supMask = supL.mask(NAVY)
  for (let d = 1; d <= 2; d++) logo.blit(supMask, d, d)
  logo.blit(supL, 0, 0)

  // Where the letter faces are, for the gleam that sweeps across them.
  const gleam = new Canvas(W, H)
  gleam.blit(leanFaces.mask(INK), pad, pad)
  return { logo, gleam, faces: leanFaces, pad }
}

const LOGO = buildLogo()

/* ------------------------------------------------------------------ */
/* 3. The lot: sky pieces, far hills, the wash, props                  */
/* ------------------------------------------------------------------ */

/** A puffy cloud: bumps on a flat base. No outline: it is weather, not a thing. */
function cloud(w, h, bumps) {
  const c = new Canvas(w, h)
  for (const [x, y, rx, ry] of bumps) c.ellipse(x, y, rx, ry, WHITE)
  c.rect(0, h - 4, w, 4, 0)
  // Shade the underside of every bump.
  const m = c.clone()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m.solid(x, y)) continue
      if (!m.solid(x, y + 1) || !m.solid(x, y + 2) || (!m.solid(x, y + 3) && !m.solid(x + 1, y + 3))) c.set(x, y, PAL.blue[4])
    }
  }
  return c
}

const CLOUDS = [
  cloud(118, 40, [[22, 28, 20, 10], [48, 20, 24, 16], [78, 22, 22, 14], [98, 29, 18, 9], [62, 30, 40, 8]]),
  cloud(78, 28, [[16, 20, 14, 7], [36, 13, 18, 11], [58, 18, 16, 8], [40, 21, 30, 5]]),
  cloud(46, 18, [[10, 12, 9, 5], [24, 8, 11, 7], [36, 12, 9, 5]]),
]

/** Mesas along the horizon, 640 wide, wrapping, with the wind farm standing on them. */
function buildFar() {
  const W = 640
  const H = 64
  const c = new Canvas(W, H)
  const body = PAL.ice[0]
  const lit = PAL.ice[1]
  const each = (fn) => {
    fn(0)
    fn(-W)
    fn(W)
  }
  // [left, right, height, shoulder]
  const mesas = [[30, 150, 38, 12], [120, 210, 24, 8], [250, 300, 44, 7], [330, 470, 30, 14], [520, 610, 40, 10], [590, 680, 22, 9]]
  for (const [l, r, hh, sh] of mesas) {
    each((o) => {
      c.poly([[l + o, H - 1], [l + sh + o, H - hh], [r - sh + o, H - hh], [r + o, H - 1]], body)
      // The sunny western face and a cap rock.
      c.poly([[l + o, H - 1], [l + sh + o, H - hh], [l + sh + 5 + o, H - hh], [l + 9 + o, H - 1]], lit)
      c.rect(l + sh + o, H - hh, r - l - 2 * sh + 1, 2, lit)
    })
  }
  c.rect(0, H - 6, W, 6, body)
  c.rect(0, H - 6, W, 1, lit)
  return c
}

function buildTurbineMast() {
  const c = new Canvas(7, 44)
  c.rect(2, 4, 3, 40, WHITE)
  c.rect(4, 4, 1, 40, PAL.grey[5])
  c.rect(1, 2, 5, 4, WHITE)
  c.rect(1, 5, 5, 1, PAL.grey[5])
  return c
}

/** Three blades, turned by `deg`. Three frames 40 degrees apart make a full turn look continuous. */
function buildRotor(deg) {
  const S = 37
  const c = new Canvas(S, S)
  const m = (S - 1) / 2
  for (let k = 0; k < 3; k++) {
    const a = ((deg + k * 120) * Math.PI) / 180
    const x = m + Math.sin(a) * 17
    const y = m - Math.cos(a) * 17
    c.line(m, m, x, y, WHITE, 2)
    c.line(m, m, m + Math.sin(a) * 8, m - Math.cos(a) * 8, WHITE, 3)
  }
  c.rect(m - 1, m - 1, 3, 3, PAL.grey[5])
  return c
}

/** Tiny leaning capitals for signs. */
function signText(text, H, t, colour) {
  const word = setWord(text.split('').map((ch) => ({ ch, H, t, gap: 2, o: { b: Math.max(2, t - 1), k: 1 } })))
  return lean(paintBands(word, [[99, colour]]), 5)
}

/** The Mighty Wash tunnel building, seen from the lot: the way in at the left, windows on the wash, the sign on the roof. */
function buildWash() {
  const W = 340
  const H = 112
  const c = new Canvas(W, H)
  const wallTop = 40
  c.rect(0, wallTop, W, H - wallTop, PAL.grey[5])
  c.rect(0, wallTop, W, 2, WHITE)
  c.rect(0, H - 10, W, 10, PAL.grey[4])
  c.rect(0, H - 10, W, 1, PAL.grey[3])
  // The fascia: a red band over a blue one, the brand's two colours.
  c.rect(0, wallTop - 14, W, 8, PAL.red[3])
  c.rect(0, wallTop - 14, W, 2, PAL.red[4])
  c.rect(0, wallTop - 6, W, 6, PAL.blue[2])
  c.rect(0, wallTop - 1, W, 1, PAL.blue[1])

  // The way in.
  c.rect(12, wallTop + 8, 72, H - wallTop - 8, PAL.blue[1])
  c.rect(12, wallTop + 8, 72, 2, PAL.blue[2])
  c.rect(18, wallTop + 14, 60, H - wallTop - 14, PAL.grey[1])
  c.rect(18, wallTop + 14, 60, 12, PAL.grey[0])
  for (let i = 0; i < 8; i++) c.rect(20 + i * 7, wallTop + 14, 5, 16 + (i % 2) * 7 + (i % 3) * 2, i % 2 ? PAL.red[3] : PAL.blue[2])
  // Suds on the floor of the tunnel.
  for (const [x, r] of [[26, 4], [34, 6], [45, 5], [55, 7], [66, 5], [73, 3]]) c.circle(x, H - 3, r, WHITE)
  c.rect(18, H - 2, 60, 2, WHITE)
  c.rect(30, wallTop + 2, 36, 5, PAL.yellow[1])
  c.text(34, wallTop + 2, 'ENTER', NAVY)

  // Windows on the wash: brushes turning in the suds.
  for (let i = 0; i < 4; i++) {
    const x = 100 + i * 58
    const y = wallTop + 16
    c.rect(x, y, 46, 34, NAVY)
    c.rect(x + 2, y + 2, 42, 30, PAL.blue[4])
    c.circle(x + 13, y + 20, 9, i % 2 ? PAL.red[3] : PAL.blue[2])
    c.circle(x + 13, y + 20, 5, i % 2 ? PAL.red[4] : PAL.blue[3])
    c.circle(x + 32, y + 18, 9, i % 2 ? PAL.blue[2] : PAL.red[3])
    c.circle(x + 32, y + 18, 5, i % 2 ? PAL.blue[3] : PAL.red[4])
    for (const [bx, r] of [[6, 4], [14, 5], [23, 6], [33, 5], [40, 4]]) c.circle(x + bx + 2, y + 31, r, WHITE)
    c.rect(x + 2, y + 2, 42, 30, 0)
    // Redraw inside the frame only: the brushes and suds above were clipped by hand.
    const pane = new Canvas(42, 30, PAL.blue[4])
    pane.circle(11, 18, 9, i % 2 ? PAL.red[3] : PAL.blue[2])
    pane.circle(11, 18, 5, i % 2 ? PAL.red[4] : PAL.blue[3])
    pane.circle(30, 16, 9, i % 2 ? PAL.blue[2] : PAL.red[3])
    pane.circle(30, 16, 5, i % 2 ? PAL.blue[3] : PAL.red[4])
    for (const [bx, r] of [[4, 4], [12, 5], [21, 6], [31, 5], [38, 4]]) pane.circle(bx, 29, r, WHITE)
    pane.line(6, 10, 14, 2, WHITE)
    pane.line(9, 10, 17, 2, WHITE)
    c.blit(pane, x + 2, y + 2)
  }

  // The sign on the roof.
  const mighty = signText('MIGHTY', 13, 4, PAL.red[3])
  const wash = signText('WASH', 13, 4, PAL.blue[2])
  const bw = mighty.w + wash.w + 22
  const bx = Math.round((W - bw) / 2)
  c.rect(bx, 0, bw, 23, NAVY)
  c.rect(bx + 2, 2, bw - 4, 19, WHITE)
  c.blit(mighty, bx + 7, 5)
  c.blit(wash, bx + 7 + mighty.w + 8, 5)
  c.rect(bx + 14, 23, 4, 3, NAVY)
  c.rect(bx + bw - 18, 23, 4, 3, NAVY)
  // Building edges.
  c.rect(0, wallTop - 14, 1, H - wallTop + 14, NAVY)
  c.rect(W - 1, wallTop - 14, 1, H - wallTop + 14, NAVY)
  c.rect(0, wallTop - 15, W, 1, NAVY)
  return c
}

/** A row of free vacuums: blue arches with a hose and a canister each. */
function buildVacs() {
  const n = 3
  const pitch = 54
  const c = new Canvas(n * pitch, 62)
  for (let i = 0; i < n; i++) {
    const x = i * pitch + 6
    c.rect(x, 4, 4, 58, PAL.blue[1])
    c.rect(x, 4, 40, 4, PAL.blue[1])
    c.rect(x, 4, 40, 1, PAL.blue[2])
    c.rect(x, 4, 1, 58, PAL.blue[2])
    c.rect(x + 36, 4, 4, 14, PAL.blue[1])
    // Hose: down from the arm in a loop.
    for (let k = 0; k <= 26; k++) {
      const f = k / 26
      c.rect(x + 34 - Math.round(Math.sin(f * Math.PI) * 9), 18 + k, 2, 1, PAL.grey[2])
    }
    c.rect(x + 33, 44, 4, 5, PAL.grey[3])
    // Canister.
    c.rect(x + 8, 36, 12, 26, PAL.grey[4])
    c.rect(x + 8, 36, 12, 2, PAL.grey[5])
    c.rect(x + 18, 38, 2, 24, PAL.grey[3])
    c.rect(x + 10, 42, 8, 6, PAL.red[3])
    c.rect(x + 8, 34, 12, 2, PAL.grey[2])
  }
  return c
}

/** The pylon sign by the road: Maxx's own MW shield on a pole. */
function buildPylon() {
  const c = new Canvas(34, 84)
  c.rect(15, 34, 4, 50, PAL.grey[3])
  c.rect(15, 34, 1, 50, PAL.grey[4])
  c.poly([[2, 2], [31, 2], [31, 22], [17, 36], [16, 36], [2, 22]], WHITE)
  c.poly([[2, 2], [31, 2], [31, 22], [17, 36], [16, 36], [2, 22]], NAVY, { fill: false })
  const m = paintBands(capital('M', 12, 4, { w: 15, k: 1 }), [[99, PAL.red[3]]])
  const w2 = paintBands(capital('W', 12, 4, { w: 15, k: 1 }), [[99, PAL.blue[2]]])
  c.blit(m, 9, 5)
  c.blit(w2, 9, 19)
  for (let y = 19; y < 36; y++) for (let x = 0; x < 34; x++) if (c.get(x, y) === rgba(PAL.blue[2]) && (x < 2 + (y - 22) || x > 31 - (y - 22))) c.set(x, y, WHITE)
  c.poly([[2, 2], [31, 2], [31, 22], [17, 36], [16, 36], [2, 22]], NAVY, { fill: false })
  return c
}

/** The lot itself, one 64 px tile: kerb, concrete, a painted line, then the lane the cars use. */
function buildLot() {
  const c = new Canvas(64, 30)
  c.rect(0, 0, 64, 30, PAL.grey[5])
  c.rect(0, 0, 64, 2, WHITE)
  c.rect(0, 9, 64, 1, PAL.grey[4])
  c.rect(0, 10, 64, 20, PAL.grey[2])
  c.rect(0, 10, 64, 1, PAL.grey[1])
  // Expansion joints and a dashed lane line give the scroll something to move.
  c.rect(0, 2, 1, 7, PAL.grey[4])
  c.rect(32, 2, 1, 7, PAL.grey[4])
  c.rect(4, 19, 28, 3, PAL.yellow[1])
  c.rect(4, 21, 28, 1, PAL.yellow[0])
  for (const [x, y] of [[10, 13], [41, 15], [52, 25], [22, 26], [37, 23]]) c.rect(x, y, 2, 1, PAL.grey[3])
  return c
}

function buildCone() {
  const c = new Canvas(14, 17).pad(0)
  c.poly([[5, 1], [7, 1], [10, 12], [2, 12]], PAL.orange[1])
  c.rect(4, 5, 5, 2, WHITE)
  c.rect(3, 9, 7, 1, WHITE)
  c.rect(1, 13, 11, 2, PAL.orange[0])
  c.set(6, 2, PAL.orange[2])
  c.line(5, 3, 4, 8, PAL.orange[2])
  return c.outline(OUT)
}

function buildBush() {
  const c = new Canvas(34, 20)
  for (const [x, y, r] of [[8, 13, 6], [16, 9, 8], [25, 12, 7], [17, 14, 9]]) c.circle(x, y, r, PAL.green[2])
  for (const [x, y, r] of [[7, 11, 3], [15, 6, 4], [24, 9, 3]]) c.circle(x, y, r, PAL.green[3])
  for (const [x, y] of [[12, 15], [20, 16], [27, 15]]) c.rect(x, y, 3, 2, PAL.green[1])
  c.rect(0, 19, 34, 1, 0)
  return c.outline(OUT)
}

/** A lot light with a Mighty Wash banner. */
function buildPole() {
  const c = new Canvas(30, 98)
  c.rect(13, 8, 3, 90, PAL.grey[3])
  c.rect(13, 8, 1, 90, PAL.grey[4])
  c.rect(11, 94, 7, 4, PAL.grey[2])
  c.rect(4, 3, 21, 4, PAL.grey[2])
  c.rect(4, 7, 8, 2, PAL.yellow[2])
  c.rect(17, 7, 8, 2, PAL.yellow[2])
  // The banner: red over blue, a white stripe between.
  c.rect(17, 18, 10, 12, PAL.red[3])
  c.rect(17, 30, 10, 2, WHITE)
  c.rect(17, 32, 10, 12, PAL.blue[2])
  c.poly([[17, 44], [27, 44], [22, 48]], PAL.blue[2])
  c.rect(19, 21, 6, 1, WHITE)
  c.rect(19, 24, 6, 1, WHITE)
  return c.outline(OUT)
}

/* ------------------------------------------------------------------ */
/* 4. Effects                                                          */
/* ------------------------------------------------------------------ */

function spark(r) {
  const S = 2 * r + 1
  const c = new Canvas(S, S)
  c.rect(r, 0, 1, S, PAL.yellow[2])
  c.rect(0, r, S, 1, PAL.yellow[2])
  const k = Math.max(0, Math.floor(r / 2))
  c.rect(r, r - k, 1, 2 * k + 1, WHITE)
  c.rect(r - k, r, 2 * k + 1, 1, WHITE)
  if (r >= 4) {
    c.rect(r - 1, r - 1, 3, 3, WHITE)
    c.set(r - 2, r - 2, PAL.yellow[2])
    c.set(r + 2, r - 2, PAL.yellow[2])
    c.set(r - 2, r + 2, PAL.yellow[2])
    c.set(r + 2, r + 2, PAL.yellow[2])
  }
  return c
}
const SPARKS = [spark(1), spark(2), spark(4), spark(6)]

/** A soap bubble like the ones on the wordmark: a blue ball with a white catch-light. */
function bubble(r) {
  const S = 2 * r + 1
  const c = new Canvas(S, S)
  c.circle(r, r, r, PAL.blue[1])
  c.circle(r, r, r - 1, PAL.blue[2])
  if (r >= 4) {
    c.circle(r - 1, r - 1, r - 3, PAL.blue[3])
    c.rect(r - Math.round(r * 0.5), r - Math.round(r * 0.55), Math.max(1, Math.round(r / 3)), Math.max(1, Math.round(r / 3)), WHITE)
  } else {
    c.set(r - 1, r - 1, WHITE)
  }
  return c
}
const BUBBLES = [bubble(2), bubble(4), bubble(7)]

/** A burst of water where the spray lands. */
function splash(i) {
  const c = new Canvas(17, 17)
  const m = 8
  const r = 2 + i * 2
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + 0.3
    const x = Math.round(m + Math.cos(a) * r)
    const y = Math.round(m + Math.sin(a) * r)
    c.rect(x, y, i === 2 ? 1 : 2, i === 2 ? 1 : 2, k % 2 ? WHITE : PAL.blue[4])
  }
  if (i === 0) c.rect(m - 1, m - 1, 3, 3, WHITE)
  return c
}
const SPLASHES = [splash(0), splash(1), splash(2)]

/* ------------------------------------------------------------------ */
/* 5. Game over                                                        */
/* ------------------------------------------------------------------ */

/** GAME OVER in mud, running at the bottom edge. */
function buildGameOver() {
  const spec = (text) => text.split('').map((ch) => ({ ch, H: 46, t: 14, gap: 6 }))
  const game = setWord(spec('GAME'))
  const over = setWord(spec('OVER'))
  const gap = 26
  const mask = new Canvas(game.w + gap + over.w, 46 + 22)
  mask.blit(game, 0, 0)
  mask.blit(over, game.w + gap, 0)
  // Drips: from the foot of the letters, a few columns run on down.
  const r = rng(4242)
  for (let x = 2; x < mask.w - 4; x++) {
    if (!mask.solid(x, 45) || !mask.solid(x + 3, 45) || r() > 0.09) continue
    const len = 5 + Math.round(r() * 13)
    const wide = 3 + Math.round(r())
    mask.rect(x, 46, wide, len, INK)
    mask.rect(x + 1, 46 + len, wide - 2, 1, INK)
    x += wide + 3
  }
  const mud = PAL.mud
  const face = new Canvas(mask.w, mask.h)
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.solid(x, y)) continue
      let col = y < 14 ? mud[4] : y < 32 ? mud[3] : mud[2]
      if (!mask.solid(x, y - 1)) col = PAL.wood[7]
      else if (!mask.solid(x + 1, y) || !mask.solid(x, y + 1)) col = mud[1]
      face.set(x, y, col)
    }
  }
  // Lumps: darker spots and a few glints, so it reads as mud and not chocolate.
  for (let i = 0; i < 70; i++) {
    const x = Math.round(r() * (mask.w - 4))
    const y = Math.round(r() * 44)
    if (!mask.solid(x, y) || !mask.solid(x + 2, y + 1) || !mask.solid(x - 1, y - 1)) continue
    if (i % 3) face.rect(x, y, 2, 2, mud[2])
    else face.rect(x, y, 2, 1, PAL.wood[7])
  }
  const out2 = ring(face.pad(4), OUT, 2)
  const logo = new Canvas(out2.w + 3, out2.h + 3)
  const sh = out2.mask(PAL.purple[0])
  for (let d = 1; d <= 3; d++) logo.blit(sh, d, d)
  logo.blit(out2, 0, 0)
  return logo
}

function buildPuddle() {
  const c = new Canvas(132, 16)
  c.ellipse(65, 8, 62, 5, PAL.mud[2])
  c.ellipse(58, 9, 50, 3, PAL.mud[1])
  c.ellipse(20, 6, 14, 3, PAL.mud[2])
  c.ellipse(110, 7, 16, 3, PAL.mud[2])
  for (const [x, y, w] of [[30, 5, 10], [70, 4, 16], [100, 6, 8]]) c.rect(x, y, w, 1, PAL.mud[4])
  return c.outline(OUT)
}

/**
 * The street lamp the game over screen is lit by: a pole, an arm and a hooded head with its
 * lens lit. Anchored at the foot of the pole; the lens's middle is returned with it.
 */
function buildLamp() {
  const c = new Canvas(64, 122)
  const g = PAL.grey
  // Foot, pole, cap.
  c.rect(2, 114, 11, 7, g[2])
  c.rect(2, 114, 11, 1, g[3])
  c.rect(11, 115, 2, 6, g[1])
  c.rect(6, 12, 3, 102, g[2])
  c.rect(6, 12, 1, 102, g[3])
  c.rect(8, 12, 1, 102, g[1])
  c.rect(5, 9, 5, 4, g[2])
  c.rect(5, 9, 5, 1, g[3])
  // The arm, long enough to hang the light over whoever is under it, and a brace.
  c.rect(9, 10, 34, 2, g[2])
  c.rect(9, 10, 34, 1, g[3])
  c.line(9, 24, 21, 12, g[2])
  // The head: a flat hood, the lens under it.
  c.poly([[40, 6], [59, 6], [61, 9], [58, 12], [42, 12], [40, 9]], g[1])
  c.rect(41, 6, 18, 2, g[3])
  c.rect(44, 12, 14, 2, PAL.yellow[2])
  c.rect(47, 12, 8, 1, WHITE)
  c.outline(OUT)
  return { c, ax: 7, lensX: 51 - 7, lensY: 13 - c.h }
}

function fly(up) {
  const c = new Canvas(7, 6)
  c.rect(2, 3, 3, 2, OUT)
  if (up) {
    c.rect(1, 1, 2, 2, WHITE)
    c.rect(4, 1, 2, 2, WHITE)
  } else {
    c.rect(0, 3, 2, 1, WHITE)
    c.rect(5, 3, 2, 1, WHITE)
  }
  return c
}

/* ------------------------------------------------------------------ */
/* 6. The ending                                                       */
/* ------------------------------------------------------------------ */

/** A setting sun, sliced by the horizon haze the way old sunsets were. */
function buildSun() {
  const r = 58
  const S = 2 * r + 1
  const c = new Canvas(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - r
      const dy = y - r
      if (dx * dx + dy * dy > (r + 0.5) * (r + 0.5)) continue
      c.set(x, y, y < S * 0.34 ? PAL.yellow[2] : y < S * 0.58 ? PAL.yellow[1] : PAL.orange[1])
    }
  }
  // Bands of sky cut through the lower half, widening as they go down.
  let y = Math.round(S * 0.5)
  let gap = 2
  while (y < S) {
    c.rect(0, y, S, gap, 0)
    y += gap + Math.max(3, 9 - gap)
    gap++
  }
  return c
}

/** The horizon at dusk, 640 wide and wrapping: mesas, a pumpjack, turbines, mesquite, all in silhouette. */
function buildDusk() {
  const W = 640
  const H = 84
  const c = new Canvas(W, H)
  const far = PAL.purple[2]
  const near = PAL.purple[1]
  const each = (fn) => {
    fn(0)
    fn(-W)
    fn(W)
  }
  for (const [l, r, hh, sh] of [[20, 170, 46, 16], [200, 262, 60, 8], [300, 420, 34, 12], [470, 600, 52, 14], [600, 700, 30, 10]]) {
    each((o) => c.poly([[l + o, H - 1], [l + sh + o, H - hh], [r - sh + o, H - hh], [r + o, H - 1]], far))
  }
  // The near ridge, with things standing on it.
  c.rect(0, H - 14, W, 14, near)
  for (const [l, r, hh] of [[60, 140, 22], [250, 380, 20], [430, 520, 26], [560, 660, 20]]) {
    each((o) => c.poly([[l + o, H - 14], [l + 14 + o, H - hh], [r - 14 + o, H - hh], [r + o, H - 14]], near))
  }
  // Turbines (still: the day's work is done).
  for (const x of [176, 196, 404, 548]) {
    c.rect(x, H - 52, 2, 40, near)
    for (let k = 0; k < 3; k++) {
      const a = ((20 + x + k * 120) * Math.PI) / 180
      c.line(x, H - 52, x + Math.sin(a) * 13, H - 52 - Math.cos(a) * 13, near)
    }
  }
  // Mesquite and prickly pear.
  for (const x of [28, 232, 300, 396, 610]) {
    c.rect(x, H - 22, 2, 9, near)
    c.ellipse(x + 1, H - 25, 8, 4, near)
    c.ellipse(x - 5, H - 21, 4, 2, near)
  }
  for (const x of [118, 470]) {
    c.ellipse(x, H - 18, 3, 5, near)
    c.ellipse(x + 5, H - 21, 2, 4, near)
    c.ellipse(x - 5, H - 19, 2, 3, near)
  }
  return c
}

/** A pumpjack in silhouette; frame 0 head up, frame 1 head down. */
function pumpjack(down) {
  const c = new Canvas(46, 34)
  const col = PAL.purple[1]
  c.poly([[18, 33], [23, 10], [25, 10], [30, 33]], col, { fill: false })
  c.rect(19, 24, 10, 1, col)
  const dy = down ? 5 : -4
  c.line(4, 10 - dy, 42, 10 + dy, col, 2)
  // The horse head at the well end, the counterweight at the other.
  c.rect(40, 8 + dy, 5, 9, col)
  c.rect(42, 16 + dy, 1, 33 - 16 - dy, col)
  c.rect(1, 8 - dy, 6, 7, col)
  c.rect(0, 33, 46, 1, col)
  return c
}

function buildTrophy() {
  const c = new Canvas(54, 62)
  const g = PAL.yellow
  // Handles.
  c.circle(9, 17, 8, g[1], { fill: false })
  c.circle(9, 17, 7, g[1], { fill: false })
  c.circle(44, 17, 8, g[1], { fill: false })
  c.circle(44, 17, 7, g[1], { fill: false })
  // The cup.
  c.poly([[10, 3], [43, 3], [41, 20], [34, 31], [19, 31], [12, 20]], g[1])
  c.rect(10, 3, 34, 3, g[2])
  c.poly([[13, 6], [18, 6], [20, 20], [24, 29], [20, 29], [15, 20]], g[2])
  c.poly([[38, 6], [41, 6], [39, 20], [33, 30], [31, 30], [36, 20]], g[0])
  // Stem and base.
  c.rect(23, 31, 8, 9, g[1])
  c.rect(23, 31, 2, 9, g[2])
  c.rect(29, 31, 2, 9, g[0])
  c.rect(17, 40, 20, 4, g[1])
  c.rect(17, 40, 20, 1, g[2])
  c.rect(11, 44, 32, 14, PAL.wood[1])
  c.rect(11, 44, 32, 2, PAL.wood[2])
  c.rect(39, 46, 4, 12, PAL.wood[0])
  c.rect(16, 48, 22, 7, g[1])
  c.rect(16, 48, 22, 1, g[2])
  // A star on the cup.
  const s = paintBands(capital('M', 9, 3, { w: 11, k: 1 }), [[99, PAL.red[3]]])
  c.blit(s, 21, 10)
  c.rect(21, 21, 11, 2, PAL.blue[2])
  return c.outline(OUT)
}

function buildPodium() {
  const c = new Canvas(58, 22)
  c.rect(1, 1, 56, 20, WHITE)
  c.rect(1, 1, 56, 3, PAL.red[3])
  c.rect(1, 4, 56, 2, PAL.blue[2])
  c.rect(1, 18, 56, 3, PAL.grey[4])
  c.rect(52, 6, 5, 12, PAL.grey[5])
  const one = new Canvas(8, 10)
  one.rect(3, 0, 3, 10, PAL.yellow[1])
  one.rect(1, 2, 2, 2, PAL.yellow[1])
  one.rect(1, 8, 7, 2, PAL.yellow[1])
  c.blit(one.outline(NAVY), 25, 7)
  return c.outline(OUT)
}

/** For the rumour: the back of a wash tunnel at night, a ladder, and a roof somebody could stand on. */
function buildRoof() {
  const W = 176
  const H = 84
  const c = new Canvas(W, H)
  c.rect(8, 30, 160, 54, PAL.grey[2])
  c.rect(8, 30, 160, 2, PAL.grey[3])
  c.rect(4, 24, 168, 6, PAL.red[2])
  c.rect(4, 24, 168, 2, PAL.red[3])
  c.rect(4, 30, 168, 3, PAL.blue[1])
  // The exit arch.
  c.rect(24, 42, 60, 42, PAL.blue[1])
  c.rect(30, 48, 48, 36, PAL.grey[0])
  for (let i = 0; i < 6; i++) c.rect(32 + i * 8, 48, 5, 10 + (i % 2) * 5, i % 2 ? PAL.red[2] : PAL.blue[1])
  c.rect(44, 35, 20, 6, PAL.yellow[1])
  c.text(46, 36, 'MW03', NAVY)
  // A ladder up the wall.
  c.rect(120, 14, 2, 70, PAL.grey[4])
  c.rect(132, 14, 2, 70, PAL.grey[4])
  for (let y = 20; y < 84; y += 7) c.rect(120, y, 14, 1, PAL.grey[4])
  // Roof furniture.
  c.rect(60, 14, 26, 10, PAL.grey[3])
  c.rect(60, 14, 26, 2, PAL.grey[4])
  c.rect(92, 18, 6, 6, PAL.grey[3])
  c.rect(146, 34, 14, 22, PAL.grey[1])
  c.rect(148, 36, 10, 6, PAL.yellow[2])
  return c.outline(OUT)
}

/* ------------------------------------------------------------------ */
/* 7. How to play: small pictures of things other atlases own          */
/* ------------------------------------------------------------------ */

/** A wash crate (the prize block): blue, with a white drop. */
function buildCrate() {
  const c = new Canvas(32, 32)
  c.rect(0, 0, 32, 32, OUT)
  c.rect(1, 1, 30, 30, PAL.blue[2])
  c.rect(1, 1, 30, 2, PAL.blue[3])
  c.rect(1, 1, 2, 30, PAL.blue[3])
  c.rect(1, 29, 30, 2, PAL.blue[1])
  c.rect(29, 1, 2, 30, PAL.blue[1])
  for (const [x, y] of [[4, 4], [26, 4], [4, 26], [26, 26]]) {
    c.rect(x, y, 2, 2, PAL.blue[0])
    c.set(x, y, PAL.blue[4])
  }
  // The drop.
  c.poly([[15, 6], [16, 6], [21, 16], [21, 20], [18, 24], [13, 24], [10, 20], [10, 16]], WHITE)
  c.poly([[15, 6], [16, 6], [21, 16], [21, 20], [18, 24], [13, 24], [10, 20], [10, 16]], PAL.blue[0], { fill: false })
  c.rect(13, 17, 2, 4, PAL.blue[4])
  return c
}

/** A wash token: silver-blue, stamped M. `gold` is one of the three hidden in every wash. */
function buildToken(gold) {
  const r = gold ? 10 : 6
  const S = 2 * r + 1
  const c = new Canvas(S + 2, S + 2)
  const rim = gold ? PAL.yellow[0] : PAL.blue[1]
  const face = gold ? PAL.yellow[1] : PAL.grey[5]
  const hi = gold ? PAL.yellow[2] : WHITE
  c.circle(r + 1, r + 1, r, rim)
  c.circle(r + 1, r + 1, r - 1, face)
  c.circle(r, r, r - 3, hi, { fill: false })
  c.circle(r + 1, r + 1, r - 2, face)
  for (let k = 0; k < r; k++) c.set(2 + k, r - k + 1 > 1 ? Math.max(2, r - 2 - k) : 2, hi)
  const m = paintBands(capital('M', gold ? 9 : 5, gold ? 3 : 2, { w: gold ? 11 : 7, k: 1, b: 2 }), [[99, gold ? PAL.wood[1] : PAL.blue[1]]])
  c.blit(m, r + 1 - Math.floor(m.w / 2), r + 1 - Math.floor(m.h / 2))
  return c.outline(OUT)
}

/** One pip of shine, lit and spent. */
function buildPip(on) {
  const c = new Canvas(15, 15)
  c.circle(7, 7, 6, on ? PAL.blue[2] : PAL.grey[2])
  c.circle(7, 7, 6, on ? PAL.blue[0] : PAL.grey[1], { fill: false })
  if (on) {
    c.rect(7, 3, 1, 9, WHITE)
    c.rect(3, 7, 9, 1, WHITE)
    c.rect(6, 6, 3, 3, WHITE)
    c.set(4, 4, PAL.blue[4])
    c.set(10, 4, PAL.blue[4])
  } else {
    c.rect(5, 7, 5, 1, PAL.grey[3])
  }
  return c.outline(OUT)
}

/* ------------------------------------------------------------------ */
/* Pack                                                                */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('title', { script: 'art-title.mjs', maxWidth: 1024 })
const frames = []
const put = (label, canvas, ax = 0, ay = 0) => {
  frames.push({ label, canvas, ax, ay })
  atlas.add(label, canvas, { ax, ay })
}
const bottom = (label, canvas) => put(label, canvas, Math.round(canvas.w / 2), canvas.h)
const centre = (label, canvas) => put(label, canvas, Math.floor(canvas.w / 2), Math.floor(canvas.h / 2))

put('logo', LOGO.logo, Math.round(LOGO.logo.w / 2), 0)
put('logoGleam', LOGO.gleam, Math.round(LOGO.logo.w / 2), 0)
CLOUDS.forEach((c, i) => put(`cloud${i}`, c))
const FAR = buildFar()
put('far', FAR, 0, FAR.h)
bottom('mast', buildTurbineMast())
const ROTORS = [0, 40, 80].map(buildRotor)
ROTORS.forEach((c, i) => centre(`rotor${i}`, c))
atlas.anim('rotor', ['rotor0', 'rotor1', 'rotor2'])
const WASH = buildWash()
put('wash', WASH, 0, WASH.h)
const VACS = buildVacs()
put('vacs', VACS, 0, VACS.h)
bottom('pylon', buildPylon())
put('lot', buildLot())
bottom('cone', buildCone())
bottom('bush', buildBush())
bottom('pole', buildPole())
SPARKS.forEach((c, i) => centre(`spark${i}`, c))
atlas.anim('spark', ['spark0', 'spark1', 'spark2', 'spark3', 'spark2', 'spark1'])
BUBBLES.forEach((c, i) => centre(`bubble${i}`, c))
SPLASHES.forEach((c, i) => centre(`splash${i}`, c))
atlas.anim('splash', ['splash0', 'splash1', 'splash2'])
const GAMEOVER = buildGameOver()
put('gameOver', GAMEOVER, Math.round(GAMEOVER.w / 2), 0)
bottom('puddle', buildPuddle())
const LAMP = buildLamp()
put('lamp', LAMP.c, LAMP.ax, LAMP.c.h)
centre('fly0', fly(true))
centre('fly1', fly(false))
atlas.anim('fly', ['fly0', 'fly1'])
centre('sun', buildSun())
const DUSK = buildDusk()
put('dusk', DUSK, 0, DUSK.h)
bottom('pumpjack0', pumpjack(false))
bottom('pumpjack1', pumpjack(true))
atlas.anim('pumpjack', ['pumpjack0', 'pumpjack1'])
bottom('trophy', buildTrophy())
bottom('podium', buildPodium())
bottom('roof', buildRoof())
put('crate', buildCrate())
centre('coin', buildToken(false))
centre('token', buildToken(true))
centre('pipOn', buildPip(true))
centre('pipOff', buildPip(false))

atlas.meta({
  logo: { w: LOGO.logo.w, h: LOGO.logo.h },
  logoNote: 'logo and logoGleam are anchored top-centre. logoGleam is the letter faces alone, in white: draw a band through it with source-in for the sweep of light.',
  lamp: { lensX: LAMP.lensX, lensY: LAMP.lensY },
  lampNote: 'lamp is anchored at the foot of its pole; lensX, lensY is the middle of the lit lens from there.',
  carNote: 'No cars here: the screens around the game draw the cars of the game itself, from the cars atlas (scenes/title/cars.ts).',
  anchors: 'Anchored bottom-left: far, wash, vacs, dusk. Bottom-centre: mast, pylon, cone, bush, pole, puddle, pumpjack, trophy, podium, roof. Centre: rotor, spark, bubble, splash, fly, sun, coin, token, pip. Top-left: cloud, lot, crate. Pole foot: lamp. Top-centre: logo, gameOver.',
})

const built = atlas.pack()
const stray = checkPalette(built, [INK])
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write()
console.log(`title atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames; logo ${LOGO.logo.w}x${LOGO.logo.h}`)

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const on = (bg, c, scale = 1) => {
    const o = new Canvas(c.w + 16, c.h + 16, bg)
    o.blit(c, 8, 8)
    return scale > 1 ? o.scale(scale) : o
  }
  const stack = (list) => {
    const w = Math.max(...list.map((c) => c.w))
    const h = list.reduce((n, c) => n + c.h, 0)
    const o = new Canvas(w, h, '#16161d')
    let y = 0
    for (const c of list) {
      o.blit(c, 0, y)
      y += c.h
    }
    return o
  }
  const by = (label) => frames.find((f) => f.label === label)
  const SKY = PAL.blue[3]

  stack([on(PAL.blue[1], LOGO.logo), on(PAL.blue[2], LOGO.logo), on(SKY, LOGO.logo), on(WHITE, LOGO.logo), on(PAL.purple[1], LOGO.logo)]).save(path.join(REVIEW, 'logo_1x.png'))
  on(PAL.blue[1], LOGO.logo, 3).save(path.join(REVIEW, 'logo_3x.png'))
  on(PAL.purple[0], GAMEOVER, 3).save(path.join(REVIEW, 'gameover_3x.png'))
  stack([on(PAL.purple[0], GAMEOVER), on(PAL.mud[0], GAMEOVER), on(NAVY, GAMEOVER)]).save(path.join(REVIEW, 'gameover_1x.png'))

  // The logo's right end, where the swoosh breaks up into streaks, close up.
  on(SKY, LOGO.logo.crop(LOGO.logo.w - 200, 0, 200, LOGO.logo.h), 6).save(path.join(REVIEW, 'logo_end_6x.png'))

  // Scenery as the title lays it out: sky bands, hills, the wash, the lot.
  const scene = new Canvas(640, 200, PAL.blue[4])
  scene.rect(0, 0, 640, 60, PAL.blue[3])
  scene.blit(FAR, 0, 170 - FAR.h)
  scene.blit(by('mast').canvas, 300, 170 - 44 - 30)
  scene.blit(ROTORS[0], 303 - 18, 170 - 44 - 30 - 15)
  scene.blit(WASH, 20, 170 - WASH.h)
  scene.blit(VACS, 400, 170 - VACS.h)
  scene.blit(by('pylon').canvas, 580, 170 - 84)
  for (let x = 0; x < 640; x += 64) scene.blit(by('lot').canvas, x, 170)
  scene.blit(by('pole').canvas, 370, 170 - 98)
  scene.blit(by('cone').canvas, 470, 170 - 17)
  scene.blit(by('bush').canvas, 510, 170 - 20)
  scene.blit(CLOUDS[0], 40, 4)
  scene.blit(CLOUDS[1], 300, 20)
  scene.blit(CLOUDS[2], 500, 8)
  scene.save(path.join(REVIEW, 'lot_1x.png'))
  scene.scale(2).save(path.join(REVIEW, 'lot_2x.png'))

  const dusk = new Canvas(640, 200, PAL.orange[1])
  dusk.rect(0, 0, 640, 50, PAL.purple[2])
  dusk.rect(0, 50, 640, 40, PAL.pink[0])
  dusk.rect(0, 140, 640, 20, PAL.yellow[1])
  dusk.blit(by('sun').canvas, 400, 60)
  dusk.blit(DUSK, 0, 160 - DUSK.h)
  dusk.blit(by('pumpjack0').canvas, 90, 160 - 34 - 12)
  dusk.blit(by('pumpjack1').canvas, 500, 160 - 34 - 12)
  dusk.rect(0, 160, 640, 40, PAL.purple[0])
  dusk.blit(by('podium').canvas, 100, 176 - 22)
  dusk.blit(by('trophy').canvas, 200, 180 - 62)
  dusk.save(path.join(REVIEW, 'dusk_1x.png'))
  dusk.scale(2).save(path.join(REVIEW, 'dusk_2x.png'))

  const small = ['cone', 'bush', 'pole', 'pylon', 'mast', 'rotor0', 'rotor1', 'rotor2', 'spark0', 'spark1', 'spark2', 'spark3', 'bubble0', 'bubble1', 'bubble2', 'splash0', 'splash1', 'splash2', 'fly0', 'fly1', 'puddle', 'lamp', 'pumpjack0', 'pumpjack1', 'trophy', 'podium', 'roof', 'crate', 'coin', 'token', 'pipOn', 'pipOff']
  for (const [tag, bg] of [['sky', SKY], ['navy', NAVY]]) {
    contactSheet([{ label: 'props and icons', frames: small.map(by) }], { bg, scale: 4, wrap: 8, ground: false, file: path.join(REVIEW, `props_${tag}_4x.png`) })
    contactSheet([{ label: '', frames: small.map(by) }], { bg, scale: 1, wrap: 16, ground: false, labels: false, file: path.join(REVIEW, `props_${tag}_1x.png`) })
  }
  out.sheet.save(path.join(REVIEW, 'atlas.png'))
}
