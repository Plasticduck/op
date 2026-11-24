// art-items.mjs: generates the 'items' atlas: everything Maxx picks up, bumps out of a
// crate, walks through, opens, rides or reads.
//
//   node scripts/maxx/art-items.mjs                  writes items.png + items.atlas.ts
//   node scripts/maxx/art-items.mjs --review <dir>   also writes contact sheets into <dir>:
//       every animation as a strip at 4x on the light sky and on the dark tunnel wall,
//       plain and mirrored; the things the renderer builds from parts (checkpoint, arch,
//       doors, gate, lift) put together in each of their states; and one line-up at 1x
//       and 3x with Maxx beside them for scale.
//
// Everything is drawn by code from the master palette. Anchors: a thing that stands or
// floats is anchored at the bottom-centre of its entity's box, so the renderer draws
// every frame at (e.x + e.w / 2, e.y + e.h). The parts of the gate and the lift tile, so
// they are anchored at their top-left. atlas.meta lists sizes and timings.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, hex } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const K = PAL.outline
const NAVY = PAL.navy
const [R0, R1, R2, R3, R4, R5] = PAL.red
const WD = PAL.wood
const [B0, B1, B2, B3, B4] = PAL.blue
const [T0, T1, T2] = PAL.teal
const [GN0, GN1, GN2, GN3] = PAL.green
const [G0, G1, G2, G3, G4, G5, G6] = PAL.grey
const [Y0, Y1, Y2] = PAL.yellow
const [P0, P1, P2] = PAL.purple
const [I0, I1, I2] = PAL.ice
const PINK = PAL.pink[0]
const CREAM = WD[8]

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

/** Is the middle of pixel (x, y) inside the ellipse? Centre and radii are in pixel-edge units: cx = w / 2 centres it on a canvas w wide. */
const inD = (x, y, cx, cy, rx, ry) => {
  const dx = (x + 0.5 - cx) / rx
  const dy = (y + 0.5 - cy) / ry
  return dx * dx + dy * dy <= 1
}

function disc(c, cx, cy, rx, ry, col) {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) if (inD(x, y, cx, cy, rx, ry)) c.set(x, y, col)
  }
  return c
}

/** Colour every pixel the test picks. With `over`, only pixels that are already solid. */
function paint(c, test, col, over = false) {
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if ((!over || c.solid(x, y)) && test(x, y)) c.set(x, y, col)
  return c
}

/** Rows of '#' stamped in one colour. */
function stamp(c, x, y, rows, col, scale = 1) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '#') c.rect(x + i * scale, y + j * scale, scale, scale, col)
  })
  return c
}

/** Horizontal bands of colour: [[rows, colour], ...] from the top of the rectangle down. */
function bands(c, x, y, w, list) {
  let top = y
  for (const [rows, col] of list) {
    c.rect(x, top, w, rows, col)
    top += rows
  }
  return c
}

/** Diagonal warning stripes over a rectangle, leaning like a backslash when dir is 1. */
function hazard(c, x, y, w, h, a, b, period = 8, phase = 0, dir = 1) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (((i - dir * j + phase) % period) + period) % period
      c.set(x + i, y + j, k < period / 2 ? a : b)
    }
  }
  return c
}

/** A filled box with a 1 px outline. */
function plate(c, x, y, w, h, fill, line = K) {
  c.rect(x, y, w, h, line)
  c.rect(x + 1, y + 1, w - 2, h - 2, fill)
  return c
}

/** Knock the four corner pixels out of a rectangle (rounds a 1 px outline). */
function round(c, x, y, w, h) {
  for (const [i, j] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) c.set(x + i, y + j, 0)
  return c
}

/* ------------------------------------------------------------------ */
/* The atlas and a record of every frame for the review sheets         */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('items', { script: 'art-items.mjs' })
/** name -> { canvas, ax, ay } */
const FR = {}

function add(name, canvas, ax, ay) {
  atlas.add(name, canvas, { ax, ay })
  FR[name] = { canvas, ax, ay, label: name }
  return name
}

function addAnim(name, canvases, ax, ay) {
  const names = canvases.map((canvas, i) => add(`${name}${i}`, canvas, ax, ay))
  atlas.anim(name, names)
  return names
}

/* ------------------------------------------------------------------ */
/* coin: a silver-blue wash token stamped MW (17 x 17, six-frame spin) */
/* ------------------------------------------------------------------ */

const M5 = ['#...#', '##.##', '#.#.#', '#...#', '#...#']
const W5 = ['#...#', '#...#', '#.#.#', '##.##', '#...#']
const M3 = ['#.#', '###', '###', '#.#', '#.#']
const W3 = ['#.#', '#.#', '###', '###', '#.#']

/** `half` is half the coin's width as seen (8.5 face on); `lit` is which edge catches the light, -1 left or 1 right. */
function coin(half, lit) {
  const c = new Canvas(17, 17)
  const m = 8.5
  if (half < 3) {
    // edge on: a milled bar
    c.rect(7, 0, 3, 17, K)
    c.rect(6, 1, 5, 15, K)
    c.rect(7, 1, 1, 15, B3)
    c.rect(8, 1, 1, 15, B2)
    c.rect(9, 1, 1, 15, B1)
    for (let y = 2; y < 16; y += 2) c.set(8, y, B1)
    c.set(7, 2, B4)
    c.set(7, 3, B4)
    return c
  }
  disc(c, m, m, half, 8.5, K)
  disc(c, m, m, half - 1, 7.5, B2)
  const faceX = half - 2.5
  const rim = (x, y) => inD(x, y, m, m, half - 1, 7.5) && !inD(x, y, m, m, faceX, 6)
  if (half > 8) {
    paint(c, (x, y) => rim(x, y) && x + y <= 10, B3)
    paint(c, (x, y) => rim(x, y) && x + y >= 22, B1)
  } else {
    paint(c, (x, y) => rim(x, y) && (lit < 0 ? x < m - 1 : x > m), B3)
    paint(c, (x, y) => rim(x, y) && (lit < 0 ? x > m + 1 : x < m - 2), B1)
  }
  if (faceX >= 1) {
    disc(c, m, m, faceX, 6, I2)
    paint(c, (x, y) => inD(x, y, m, m, faceX, 6) && !inD(x, y, m - (half > 8 ? 1 : lit < 0 ? -1 : 1), m - 1, faceX, 6), I1)
  } else {
    c.rect(8, 3, 1, 11, I2)
  }
  if (half > 8) {
    stamp(c, 3, 6, M5, NAVY)
    stamp(c, 9, 6, W5, NAVY)
    // a nick of light on the rim
    c.set(4, 3, B4)
    c.set(3, 4, B4)
  } else if (half > 6) {
    stamp(c, 5, 6, M3, NAVY)
    stamp(c, 9, 6, W3, NAVY)
  } else {
    c.rect(8, 6, 1, 5, NAVY)
  }
  return c
}

addAnim('coin', [coin(8.5, -1), coin(6.5, -1), coin(3.5, -1), coin(2, 0), coin(3.5, 1), coin(6.5, 1)], 9, 18)

/* ------------------------------------------------------------------ */
/* token: a big gold token with a star (23 x 23, six-frame spin)       */
/* ------------------------------------------------------------------ */

const STAR = [
  '.....#.....',
  '.....#.....',
  '....###....',
  '.#########.',
  '###########',
  '.#########.',
  '..#######..',
  '..#######..',
  '.####.####.',
  '.##.....##.',
  '.#.......#.',
]

/** The star squeezed to `width` columns (odd), as rows of '#'. */
function squeeze(rows, width) {
  const full = rows[0].length
  return rows.map((row) => {
    let out = ''
    for (let i = 0; i < width; i++) out += row[Math.min(full - 1, Math.floor(((i + 0.5) * full) / width))]
    return out
  })
}

function token(half, lit) {
  const c = new Canvas(23, 23)
  const m = 11.5
  if (half < 3) {
    c.rect(10, 0, 3, 23, K)
    c.rect(9, 1, 5, 21, K)
    c.rect(10, 1, 1, 21, Y2)
    c.rect(11, 1, 1, 21, Y1)
    c.rect(12, 1, 1, 21, Y0)
    for (let y = 2; y < 22; y += 2) c.set(11, y, Y0)
    c.set(10, 2, CREAM)
    c.set(10, 3, CREAM)
    return c
  }
  const face = half - 3.2
  disc(c, m, m, half, 11.5, K)
  disc(c, m, m, half - 1, 10.5, Y1)
  const rim = (x, y) => inD(x, y, m, m, half - 1, 10.5) && !inD(x, y, m, m, Math.max(0.6, face), 8.3)
  if (half > 11) {
    paint(c, (x, y) => rim(x, y) && x + y <= 14, Y2)
    paint(c, (x, y) => rim(x, y) && x + y >= 30, Y0)
  } else {
    paint(c, (x, y) => rim(x, y) && (lit < 0 ? x < m - 2 : x > m + 1), Y2)
    paint(c, (x, y) => rim(x, y) && (lit < 0 ? x > m + 2 : x < m - 3), Y0)
  }
  if (face >= 1) {
    // a groove, then the face
    disc(c, m, m, face + 0.9, 9.2, Y0)
    disc(c, m, m, face, 8.3, Y1)
    paint(c, (x, y) => inD(x, y, m, m, face, 8.3) && !inD(x, y, m + (half > 11 ? 1.5 : lit < 0 ? 1.5 : -1.5), m + 1.5, face, 8.3), Y2)
    const width = half > 11 ? 11 : half > 7 ? 7 : 3
    const rows = squeeze(STAR, width)
    const x0 = 11 - (width - 1) / 2
    stamp(c, x0 + 1, 7, rows, Y0)
    stamp(c, x0, 6, rows, CREAM)
  } else {
    c.rect(11, 4, 1, 15, Y2)
  }
  if (half > 11) {
    c.set(5, 4, CREAM)
    c.set(4, 5, CREAM)
    c.set(6, 3, CREAM)
  }
  return c
}

addAnim('token', [token(11.5, -1), token(8.5, -1), token(4.5, -1), token(2, 0), token(4.5, 1), token(8.5, 1)], 11, 22)

// One already in the save: only its outline is left, white over a blue shadow so it shows on
// the pale lot sky as well as on a dark wall. The renderer draws it faint.
{
  const c = new Canvas(23, 23)
  const m = 11.5
  paint(c, (x, y) => inD(x, y, m, m, 11.5, 11.5) && !inD(x, y, m, m, 10.5, 10.5) && Math.floor(((Math.atan2(y + 0.5 - m, x + 0.5 - m) + Math.PI) * 12) / Math.PI) % 2 === 0, G6)
  const s = new Canvas(13, 13)
  stamp(s, 1, 1, STAR, G6)
  const line = s.clone().outline(G6)
  line.blit(s, 0, 0, { mode: 'erase' })
  c.blit(line, 5, 5)
  const ghost = new Canvas(24, 24)
  ghost.blit(paint(c.clone(), () => true, B1, true), 1, 1)
  ghost.blit(c, 0, 0)
  add('tokenGhost', ghost, 11, 22)
}

/* ------------------------------------------------------------------ */
/* glint: the twinkle laid over anything shiny (9 x 9, centre anchor)  */
/* ------------------------------------------------------------------ */

function glint(n) {
  const c = new Canvas(9, 9)
  const arm = [0, 1, 2, 4, 2][n]
  for (let i = 1; i <= arm; i++) {
    const col = i === arm && arm > 1 ? Y2 : G6
    c.set(4 + i, 4, col)
    c.set(4 - i, 4, col)
    c.set(4, 4 + i, col)
    c.set(4, 4 - i, col)
  }
  c.set(4, 4, G6)
  if (arm >= 4) for (const [i, j] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) c.set(4 + i, 4 + j, G6)
  return c
}
addAnim('glint', [glint(0), glint(1), glint(2), glint(3), glint(4)], 4, 4)

/* ------------------------------------------------------------------ */
/* bubble: heals a pip (23 x 23, wobbles)                              */
/* ------------------------------------------------------------------ */

function bubble(n) {
  const c = new Canvas(23, 23)
  const m = 11.5
  const [rx, ry] = [[10.5, 10.5], [11, 10], [10.5, 10.5], [10, 11]][n]
  disc(c, m, m, rx, ry, NAVY)
  disc(c, m, m, rx - 1, ry - 1, T2)
  // the far wall of the bubble, in shade, with a soapy sheen low down
  paint(c, (x, y) => inD(x, y, m, m, rx - 1, ry - 1) && !inD(x, y, m - 1.6, m - 1.6, rx - 1, ry - 1), T1)
  paint(c, (x, y) => inD(x, y, m, m, rx - 1, ry - 1) && !inD(x, y, m - 0.6, m - 0.6, rx - 1, ry - 1) && x > m + 1 && y > m + 3, PINK)
  // window gleam: a curved bar top left and a dot bottom right
  paint(c, (x, y) => {
    const dx = (x + 0.5 - m) / rx
    const dy = (y + 0.5 - m) / ry
    const d = Math.sqrt(dx * dx + dy * dy)
    const a = Math.atan2(dy, dx)
    return d > 0.52 && d < 0.8 && a > -2.75 && a < -1.75
  }, G6)
  c.rect(15, 15, 2, 2, G6)
  // the shine it gives back: a spark that twinkles
  const arm = [2, 3, 2, 1][n]
  for (let i = 1; i <= arm; i++) {
    const col = i >= 3 ? Y2 : Y1
    c.set(11 + i, 12, col)
    c.set(11 - i, 12, col)
    c.set(11, 12 + i, col)
    c.set(11, 12 - i, col)
  }
  c.set(11, 12, G6)
  if (arm >= 2) for (const [i, j] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) c.set(11 + i, 12 + j, Y2)
  return c
}
addAnim('bubble', [bubble(0), bubble(1), bubble(2), bubble(3)], 11, 21)

/* ------------------------------------------------------------------ */
/* turbo: the turbo nozzle, chunky brass with a blue flash (30 x 20)   */
/* ------------------------------------------------------------------ */

function turbo(n) {
  const c = new Canvas(32, 20)
  // threaded inlet
  plate(c, 0, 6, 4, 8, G4)
  c.rect(1, 7, 2, 1, G6)
  c.rect(1, 9, 2, 1, G2)
  c.rect(1, 11, 2, 1, G2)
  // hex nut
  c.rect(3, 3, 7, 14, K)
  bands(c, 4, 4, 5, [[3, Y2], [6, Y1], [3, Y0]])
  c.set(3, 3, 0)
  c.set(3, 16, 0)
  c.set(4, 4, K)
  c.set(4, 15, K)
  c.rect(4, 7, 5, 1, Y0)
  c.rect(4, 12, 5, 1, WD[1])
  // barrel
  c.rect(9, 1, 12, 18, K)
  round(c, 9, 1, 12, 18)
  bands(c, 10, 2, 10, [[3, Y2], [8, Y1], [4, Y0], [1, WD[1]]])
  c.rect(11, 3, 3, 1, CREAM)
  // the blue band
  bands(c, 14, 2, 4, [[3, B3], [8, B2], [5, B1]])
  c.rect(13, 2, 1, 16, K)
  c.rect(18, 2, 1, 16, K)
  c.rect(14, 3, 2, 1, B4)
  // cone to the tip
  for (let i = 0; i < 6; i++) {
    const x = 21 + i
    const top = 3 + i
    const bottom = 16 - i
    c.rect(x, top, 1, bottom - top + 1, K)
    if (bottom - top >= 2) {
      c.rect(x, top + 1, 1, bottom - top - 1, Y1)
      c.set(x, top + 1, Y2)
      c.set(x, bottom - 1, Y0)
    }
  }
  c.rect(26, 8, 1, 4, K)
  c.rect(25, 9, 1, 2, G0)
  // the flash at the tip
  const cx = 26
  const cy = 9
  const size = [2, 4, 3, 0][n]
  if (size > 0) {
    for (let i = 1; i <= size; i++) {
      const col = i === size && size > 1 ? B2 : i === 1 ? G6 : B4
      c.set(cx + i, cy, col)
      c.set(cx + i, cy + 1, col)
      c.set(cx, cy - i, col)
      c.set(cx + 1, cy - i, col)
      c.set(cx, cy + 1 + i, col)
      c.set(cx + 1, cy + 1 + i, col)
    }
    if (size >= 2) {
      c.set(cx + 2, cy - 2, B3)
      c.set(cx + 2, cy + 3, B3)
    }
    if (size >= 3) {
      c.set(cx + 3, cy - 3, B2)
      c.set(cx + 3, cy + 4, B2)
      c.set(cx - 1, cy - 2, B4)
      c.set(cx - 1, cy + 3, B4)
    }
  }
  return c
}
addAnim('turbo', [turbo(0), turbo(1), turbo(2), turbo(3)], 14, 20)

/* ------------------------------------------------------------------ */
/* wax: a round tin of MIGHTY WAX, gold with a red band (21 x 24)      */
/* ------------------------------------------------------------------ */

function wax(n) {
  const c = new Canvas(21, 24)
  const m = 10.5
  /** How far a line round the tin sags at column x: it is a cylinder seen from a little above. */
  const sag = (x, k = 3) => Math.round(k * Math.sqrt(Math.max(0, 1 - ((x + 0.5 - m) / 10.5) ** 2)))
  const side = (x, hi, mid, lo) => (x === 2 || x === 3 ? hi : x >= 16 ? lo : mid)
  for (let x = 0; x < 21; x++) {
    const s = sag(x)
    const edge = x === 0 || x === 20
    for (let y = 4; y <= 20 + s; y++) c.set(x, y, edge || y === 20 + s ? K : side(x, Y2, Y1, Y0))
    if (edge) continue
    // the lid's lip, then the red band between two white lines
    const lip = 4 + sag(x, 4)
    c.set(x, lip + 1, side(x, CREAM, Y2, Y1))
    c.set(x, lip + 2, side(x, Y1, Y0, WD[1]))
    c.set(x, 10 + s, G6)
    for (let y = 11; y < 18; y++) c.set(x, y + s, side(x, R4, R3, R2))
    c.set(x, 18 + s, x >= 16 ? G5 : G6)
  }
  // WAX, bent round the tin
  const word = new Canvas(11, 5)
  word.text(0, 0, 'WAX', G6)
  for (let i = 0; i < 11; i++) for (let j = 0; j < 5; j++) if (word.solid(i, j)) c.set(5 + i, 12 + j + sag(5 + i), G6)
  // lid
  disc(c, m, 4.5, 10.5, 4.5, K)
  disc(c, m, 4.5, 9.5, 3.5, Y2)
  paint(c, (x, y) => inD(x, y, m, 4.5, 9.5, 3.5) && !inD(x, y, m - 1.5, 3.6, 9.5, 3.5), Y1)
  paint(c, (x, y) => inD(x, y, m, 4.5, 6.5, 2.2) && !inD(x, y, m, 4.5, 5.3, 1.3), Y0)
  c.rect(4, 3, 3, 1, CREAM)
  // a gleam that crosses the tin
  if (n > 0) {
    const gx = [0, 2, 8, 14][n]
    for (let y = 9; y < 23; y++) {
      for (let k = 0; k < 3; k++) {
        const x = gx + k + Math.floor((23 - y) / 4)
        if (x <= 0 || x >= 20 || y >= 20 + sag(x)) continue
        const under = hex(c.get(x, y))
        if (under === Y0 || under === Y1 || under === Y2) c.set(x, y, k === 1 ? G6 : CREAM)
        else if (under === R2 || under === R3 || under === R4) c.set(x, y, R5)
      }
    }
  }
  return c
}
addAnim('wax', [wax(0), wax(1), wax(2), wax(3)], 11, 24)

/* ------------------------------------------------------------------ */
/* oneup: Maxx's masked face (22 x 22), eyes open and blinking         */
/* ------------------------------------------------------------------ */

const FACE = { K, B: WD[7], b: WD[6], h: '#c89844', o: WD[5], S: WD[2], r: R0, L: R4, R: R3, d: R1, W: G6, V: '#f0e3eb' }
const ONEUP = [
  '........KKKKKKKK......',
  '.....KKKBBbBBbooKK....',
  '....KBBbBBbBBboooooK..',
  '...KBbBBbBBbhhooooooK.',
  '..KBBbBBbBbhhSoooooooK',
  '..KbBbBbbhhSSrrrrrrrrK',
  '..KBbbhhhSSrrLLLLLLLLr',
  '.KKhhhSrrrrLLLLKKKLKKr',
  'rrrrrrrLLLLLLKWWWKWWWK',
  'rLLRrrLLLLLLKWWWWWKWWW',
  'rLRRdrLLLLLLKWWWKKWKKW',
  '.rRddrLLLLLLKWWWKKWKKW',
  'rrRRdrrLLLRRKWWWKKWKKV',
  'rLRdrrddRRRRKVWWWWWWVV',
  'rRdr.KrdddddRKVVVKKVVK',
  '.rr..KbSrrrrrrKKKrrKKr',
  '.....KbSooooooooooooK.',
  '.....KbSooKKKKKKKKKoK.',
  '.....KbSSoooKWWWWWKoK.',
  '......KhSSooooKKKKooK.',
  '.......KKSSoooooooKK..',
  '.........KKKKKKKKK....',
]
// lids down: the sockets fill with his own colours, a dark line where they meet
const ONEUP_BLINK = [
  ...ONEUP.slice(0, 8),
  'rrrrrrrLLLLLLKbbbKbbbK',
  'rLLRrrLLLLLLKbbbbbKbbb',
  'rLRRdrLLLLLLKbbbbbbbbb',
  '.rRddrLLLLLLKbbbbbbbbb',
  'rrRRdrrLLLRRKKKKKKKKKK',
  'rLRdrrddRRRRKooooooooo',
  'rRdr.KrdddddRKoooKKooK',
  ...ONEUP.slice(15),
]
addAnim('oneup', [Canvas.fromText(ONEUP, FACE), Canvas.fromText(ONEUP_BLINK, FACE)], 11, 22)

/* ------------------------------------------------------------------ */
/* checkpoint: a wash station post and its flag                        */
/* ------------------------------------------------------------------ */

function cpPost(on) {
  const c = new Canvas(24, 60)
  // pole
  c.rect(10, 6, 4, 44, K)
  c.rect(11, 6, 1, 44, G5)
  c.rect(12, 6, 1, 44, G3)
  // pedestal: a little wash station box with the brand stripe
  c.poly([[5, 48], [18, 48], [21, 59], [2, 59]], K)
  c.poly([[6, 49], [17, 49], [20, 58], [3, 58]], G4)
  c.rect(6, 49, 12, 1, G6)
  for (let y = 50; y < 59; y++) c.set(Math.round(17 + ((y - 49) * 3) / 9), y, G3)
  c.rect(4, 53, 16, 2, B2)
  c.rect(4, 55, 16, 1, R3)
  // lamp on top
  disc(c, 12, 4, 4, 4, K)
  disc(c, 12, 4, 3, 3, on ? Y1 : G4)
  c.set(10, 2, on ? CREAM : G6)
  c.set(11, 2, on ? CREAM : G6)
  c.set(10, 3, on ? CREAM : G6)
  if (on) {
    c.set(13, 5, Y0)
    c.set(12, 6, Y0)
  } else {
    c.set(13, 5, G3)
    c.set(12, 6, G3)
  }
  return c
}
add('cpPost0', cpPost(false), 12, 60)
add('cpPost1', cpPost(true), 12, 60)

// Flags are anchored where their top corner meets the pole.
{
  // limp and grey: it hangs down the pole
  const c = new Canvas(9, 19)
  const shape = [[0, 0], [5, 0], [6, 3], [5, 8], [7, 13], [6, 17], [3, 18], [1, 15], [0, 15]]
  c.poly(shape, G4)
  paint(c, (x, y) => (x === 3 && y > 2 && y < 15) || (x === 4 && y > 8 && y < 16), G3, true)
  paint(c, (x, y) => x === 1 && y > 0 && y < 14, G5, true)
  const o = c.pad(1).outline(K)
  add('cpFlagLimp', o, 1, 1)
}

const DROP = ['..#..', '..#..', '.###.', '.###.', '#####', '#####', '.###.']

function cpFlag(n) {
  const c = new Canvas(24, 20)
  for (let x = 0; x < 21; x++) {
    const phase = (x / 14) * Math.PI * 2 - (n * Math.PI) / 2
    const amp = x / 7
    const dy = Math.round(Math.sin(phase) * amp)
    const slope = Math.cos(phase)
    const taper = x > 17 ? x - 17 : 0
    for (let y = 0; y < 12 - taper; y++) {
      const col = slope > 0.55 ? B3 : slope < -0.55 ? B1 : B2
      c.set(1 + x, 4 + dy + y + Math.floor(taper / 2), col)
    }
    // a white drop on the cloth, riding the wave
    if (x >= 6 && x <= 10) for (let j = 0; j < 7; j++) if (DROP[j][x - 6] === '#') c.set(1 + x, 4 + dy + 2 + j, G6)
    if (x >= 1 && x <= 19 && taper === 0) c.set(1 + x, 4 + dy + 10, slope > 0.55 ? B2 : B1)
  }
  c.outline(K)
  return c
}
addAnim('cpFlag', [cpFlag(0), cpFlag(1), cpFlag(2), cpFlag(3)], 1, 4)

/* ------------------------------------------------------------------ */
/* sign: a wooden sign post (28 x 36)                                  */
/* ------------------------------------------------------------------ */

function sign(lit) {
  const c = new Canvas(28, 36)
  // post
  c.rect(11, 15, 6, 21, K)
  c.rect(12, 15, 2, 20, WD[3])
  c.rect(14, 15, 2, 20, WD[2])
  c.rect(12, 20, 4, 2, WD[1])
  // a tuft either side of the post
  c.rect(9, 33, 2, 3, GN1)
  c.rect(8, 34, 1, 2, GN2)
  c.rect(17, 34, 2, 2, GN1)
  c.rect(19, 35, 1, 1, GN2)
  // board
  c.rect(1, 1, 26, 18, K)
  round(c, 1, 1, 26, 18)
  c.rect(2, 2, 24, 16, lit ? WD[7] : WD[6])
  c.rect(2, 2, 24, 1, lit ? CREAM : WD[7])
  c.rect(2, 15, 24, 3, WD[4])
  c.rect(2, 17, 24, 1, WD[2])
  c.rect(2, 9, 24, 1, WD[5])
  // a painted water drop, the brand's, and words beside it
  stamp(c, 4, 4, DROP, B2)
  stamp(c, 4, 4, ['', '', '...#.', '...#.', '...##', '...##', '..##.'], B1)
  stamp(c, 4, 4, ['', '', '', '.#...', '.#...'], lit ? G6 : B4)
  for (const [x, w] of [[11, 5], [17, 6]]) c.rect(x, 5, w, 2, WD[0])
  for (const [x, w] of [[11, 3], [15, 8]]) c.rect(x, 11, w, 2, WD[0])
  // nails
  for (const [x, y] of [[3, 3], [24, 3], [3, 14], [24, 14]]) c.set(x, y, WD[1])
  return c
}
add('sign0', sign(false), 14, 36)
add('sign1', sign(true), 14, 36)

/* ------------------------------------------------------------------ */
/* spring: a stack of two tires (34 x 34): rest, squashed, sprung      */
/* ------------------------------------------------------------------ */

/**
 * A tire lying flat, seen a little from above: a round-ended band of tread with the ellipse of
 * its top face over it. Only the top tire of the stack shows its face (and the hole in it); the
 * top one is painted with a yellow stripe, as playground tires are, so it reads as a thing to use.
 * `top` is the first row of the tire, `ry` the half-height of its face.
 */
function tire(c, cx, top, w, h, ry, face) {
  const rx = w / 2
  const r = h / 2
  // The tread band: a slab with round ends, bulging like rubber.
  const band = (px, py, grow) => {
    const x = px + 0.5
    const y = py + 0.5
    const ax = Math.max(cx - rx + r, Math.min(cx + rx - r, x))
    const dx = (x - ax) / (r + grow)
    const dy = (y - (top + r)) / (r + grow)
    return dx * dx + dy * dy <= 1
  }
  // Its top face, seen a little from above, over the top of the band.
  const fx0 = rx - 1.5
  const onFace = (px, py, grow = 0) => face && inD(px, py, cx, top + ry, fx0 + grow, ry + grow)
  const inside = (px, py, grow) => band(px, py, grow) || onFace(px, py, grow)
  const x0 = Math.floor(cx - rx) - 1
  const x1 = Math.ceil(cx + rx) + 1
  for (let py = top - 1; py <= top + h + 1; py++) {
    for (let px = x0; px <= x1; px++) {
      if (!inside(px, py, 0)) continue
      if (!inside(px, py, -1)) {
        c.set(px, py, K)
        continue
      }
      const row = py - top
      // lit along the top of the round and on the left, in shade low down and on the right
      let col = row <= 2 ? G3 : row >= h - 3 ? G1 : G2
      if (px - (cx - rx) < 3 && row > 2 && row < h - 3) col = G3
      if (cx + rx - px < 4 && row > 1) col = G1
      c.set(px, py, col)
    }
  }
  // tread blocks across the round, a nick of light on each
  for (let px = Math.round(cx - rx) + 5; px < cx + rx - 4; px += 4) {
    for (let py = top + 3; py < top + h - 3; py++) if (band(px, py, -1) && !onFace(px, py, 1)) c.set(px, py, G0)
    if (band(px + 1, top + 3, -1) && !onFace(px + 1, top + 3, 1)) c.set(px + 1, top + 3, G4)
  }
  if (!face) return
  // a yellow stripe painted round it, the way playground tires are
  const sy = top + Math.max(ry * 2 + 1, Math.round(h * 0.62))
  for (let px = x0; px <= x1; px++) {
    if (!band(px, sy, -1) || onFace(px, sy, 1)) continue
    c.set(px, sy, px - (cx - rx) < 4 ? Y2 : cx + rx - px < 5 ? Y0 : Y1)
  }
  // the top face: rubber lit from the top left, a dark lip where it meets the band, the hole
  paint(c, (px, py) => onFace(px, py, -1), G3)
  paint(c, (px, py) => onFace(px, py, -1) && !onFace(px - 1, py + 1, -1), G4)
  paint(c, (px, py) => onFace(px, py) && !onFace(px, py, -1) && py + 0.5 > top + ry, K)
  const hx = Math.max(3, rx * 0.4)
  const hy = Math.max(1, ry * 0.55)
  paint(c, (px, py) => inD(px, py, cx, top + ry, hx, hy), K)
  paint(c, (px, py) => inD(px, py, cx, top + ry, hx, hy) && !inD(px, py, cx, top + ry - 1, hx, hy), G1)
}

function spring(n) {
  const c = new Canvas(36, 34)
  const cx = 18
  // [width, bottom tire h, top tire h, face ry, top tire's first row, coil rows]
  const [w, hb, ht, ry, t0, coil] = [
    [28, 13, 14, 3, 9, 0],
    [32, 9, 10, 2, 17, 0],
    [26, 14, 14, 3, 1, 7],
    [30, 12, 13, 3, 11, 0],
  ][n]
  const yb = 34 - hb
  if (coil > 0) {
    // sprung: the coil that was hiding between the tires
    for (let y = t0 + ht - 3; y < yb + 3; y++) {
      c.rect(cx - 6, y, 12, 1, K)
      if ((y - t0) % 3 !== 0) c.rect(cx - 5, y, 10, 1, (y - t0) % 3 === 1 ? G5 : G3)
    }
  }
  tire(c, cx, yb, w, hb, ry, false)
  tire(c, cx, t0, w - (n === 2 ? 2 : 0), ht, ry, true)
  return c
}
// The middle of the top face is where his feet go: on the box top, 22 px up, at rest.
addAnim('spring', [spring(0), spring(1), spring(2), spring(3)], 18, 34)

/* ------------------------------------------------------------------ */
/* lift: a steel deck with warning stripes, in 32 px lengths           */
/* ------------------------------------------------------------------ */

function lift(kind) {
  // kind: 'L' left end, 'M' middle, 'R' right end, '1' both ends
  const c = new Canvas(32, 20)
  const left = kind === 'L' || kind === '1'
  const right = kind === 'R' || kind === '1'
  c.rect(0, 0, 32, 12, K)
  c.rect(0, 1, 32, 2, G5)
  for (let x = 2; x < 32; x += 6) c.rect(x, 1, 2, 1, G6)
  c.rect(0, 3, 32, 1, G3)
  hazard(c, 0, 4, 32, 6, Y1, G0, 8)
  // the top row of the stripes catches the light
  for (let x = 0; x < 32; x++) c.set(x, 4, x % 8 < 4 ? Y2 : G2)
  c.rect(0, 10, 32, 1, G2)
  if (left) {
    c.rect(0, 0, 1, 12, K)
    c.set(0, 0, 0)
    c.set(0, 11, 0)
    c.set(1, 1, K)
    c.set(1, 10, K)
  }
  if (right) {
    c.rect(31, 0, 1, 12, K)
    c.set(31, 0, 0)
    c.set(31, 11, 0)
    c.set(30, 1, K)
    c.set(30, 10, K)
  }
  // underneath: a beam, and a gusset at each end
  c.rect(left ? 3 : 0, 12, 32 - (left ? 3 : 0) - (right ? 3 : 0), 3, K)
  c.rect(left ? 4 : 0, 12, 32 - (left ? 4 : 0) - (right ? 4 : 0), 2, G2)
  c.rect(left ? 4 : 0, 12, 32 - (left ? 4 : 0) - (right ? 4 : 0), 1, G3)
  const gusset = (x0, dir) => {
    for (let i = 0; i < 6; i++) {
      c.rect(x0 + dir * i, 14, 1, 6 - i, K)
      if (i > 0 && i < 5) c.rect(x0 + dir * i, 14, 1, 4 - i, G3)
    }
  }
  if (left) gusset(4, 1)
  if (right) gusset(27, -1)
  if (kind === '1') c.blit(liftTruck(), 12, 12)
  return c
}

/** The carriage that rides the rail, hung under the middle of the deck (8 x 8). */
function liftTruck() {
  const c = new Canvas(8, 8)
  plate(c, 0, 0, 8, 7, G3)
  c.rect(1, 1, 6, 1, G5)
  disc(c, 4, 4, 2, 2, K)
  c.set(3, 3, G5)
  c.rect(2, 7, 4, 1, K)
  return c
}
add('liftL', lift('L'), 0, 0)
add('liftM', lift('M'), 0, 0)
add('liftR', lift('R'), 0, 0)
add('lift1', lift('1'), 0, 0)
// Anchored at the middle of its top edge: drawn at the middle of the deck's underside.
add('liftTruck', liftTruck(), 4, 0)

// The rail it rides: a dot every few pixels, and a bolt at each end of the run.
{
  const dot = new Canvas(4, 4)
  dot.rect(1, 1, 3, 3, K)
  dot.rect(0, 0, 3, 3, K)
  dot.rect(1, 1, 2, 2, G4)
  dot.set(1, 1, G6)
  add('railDot', dot, 2, 2)
  const end = new Canvas(9, 9)
  disc(end, 4.5, 4.5, 4.5, 4.5, K)
  disc(end, 4.5, 4.5, 3.5, 3.5, G3)
  disc(end, 4, 4, 2.5, 2.5, G5)
  end.rect(3, 4, 3, 1, G2)
  add('railEnd', end, 4, 4)
}

/* ------------------------------------------------------------------ */
/* door: a plain shop door (36 x 62), and the bars that lock it        */
/* ------------------------------------------------------------------ */

/** open: 0 shut, 1 ajar, 2 open. */
function door(open) {
  const c = new Canvas(36, 62)
  // frame
  c.rect(1, 1, 34, 61, K)
  c.rect(2, 2, 32, 60, G5)
  c.rect(2, 2, 32, 1, G6)
  c.rect(2, 2, 1, 60, G6)
  c.rect(32, 3, 2, 59, G4)
  c.rect(4, 4, 28, 58, K)
  // inside the shop
  c.rect(5, 5, 26, 57, P0)
  c.rect(5, 50, 26, 12, P1)
  for (let i = 0; i < 12; i++) c.rect(5, 50 + i, Math.max(0, 14 - i * 2), 1, P0)
  if (open === 2) {
    c.rect(17, 30, 9, 20, Y1)
    c.rect(18, 31, 7, 19, Y2)
    c.rect(17, 50, 12, 2, WD[4])
  }
  const w = [26, 17, 6][open]
  // the leaf, hinged on the left
  c.rect(5, 5, w, 57, B1)
  c.rect(5, 5, 1, 57, B2)
  c.rect(5, 5, w, 1, B2)
  if (open > 0) {
    c.rect(5 + w - 1, 5, 1, 57, B0)
    c.rect(5 + w, 5, 1, 57, K)
  }
  if (open < 2) {
    const pw = w - 8
    // window
    c.rect(8, 9, pw + 2, 23, K)
    c.rect(9, 10, pw, 21, I1)
    for (let i = 0; i < 21; i++) {
      const x = 9 + pw - 4 - i
      if (x >= 9) c.rect(x, 10 + i, Math.min(3, 9 + pw - x), 1, I2)
      const x2 = 9 + pw - 9 - i
      if (x2 >= 9 && i < 14) c.set(x2, 10 + i, I2)
    }
    c.rect(9, 29, pw, 2, I0)
    // lower panel
    c.rect(8, 37, pw + 2, 20, B0)
    c.rect(9, 38, pw, 18, B1)
    c.rect(9, 38, pw, 1, B2)
    c.rect(9, 38, 1, 18, B2)
    // knob
    c.rect(5 + w - 6, 33, 4, 4, K)
    c.rect(5 + w - 5, 34, 2, 2, Y1)
    c.set(5 + w - 5, 34, Y2)
  }
  // step
  c.rect(0, 60, 36, 2, K)
  c.rect(1, 60, 34, 1, G4)
  return c
}
addAnim('door', [door(0), door(1), door(2)], 18, 62)

function bar(c, x, y, w) {
  if (w < 3) return
  c.rect(x, y, w, 5, K)
  c.rect(x + 1, y + 1, w - 2, 1, G6)
  c.rect(x + 1, y + 2, w - 2, 1, G4)
  c.rect(x + 1, y + 3, w - 2, 1, G3)
}

/** The bars across a locked door. `back` is how far each half has slid away, in pixels. */
function doorLock(back) {
  const c = new Canvas(36, 62)
  for (const y of [17, 42]) {
    if (back === 0) bar(c, 0, y, 36)
    else {
      bar(c, 0, y, 18 - back)
      bar(c, 18 + back, y, 18 - back)
    }
    // the brackets that hold them
    plate(c, 0, y - 2, 5, 9, G2)
    plate(c, 31, y - 2, 5, 9, G2)
    c.set(2, y, G5)
    c.set(33, y, G5)
    c.set(2, y + 4, G0)
    c.set(33, y + 4, G0)
  }
  return c
}
addAnim('doorLock', [doorLock(0), doorLock(4), doorLock(10), doorLock(16)], 18, 62)

{
  const c = new Canvas(12, 15)
  // shackle
  c.rect(2, 0, 8, 8, K)
  c.rect(3, 1, 6, 7, G5)
  c.rect(4, 2, 4, 6, K)
  c.rect(5, 3, 2, 5, 0)
  c.set(2, 0, 0)
  c.set(9, 0, 0)
  c.set(3, 1, G6)
  // body
  c.rect(0, 6, 12, 9, K)
  c.rect(1, 7, 10, 7, Y1)
  c.rect(1, 7, 10, 1, Y2)
  c.rect(1, 7, 1, 7, Y2)
  c.rect(1, 13, 10, 1, Y0)
  c.rect(10, 8, 1, 6, Y0)
  c.rect(5, 9, 2, 2, K)
  c.rect(5, 11, 2, 2, K)
  c.set(5, 12, Y1)
  c.set(6, 12, Y1)
  c.rect(5, 11, 2, 1, K)
  add('padlock', c, 6, 7)
}

/**
 * The lamp on top of a door that can be barred: 0 dim red, 1 red, 2 green. It sits on the frame,
 * above Maxx's head, so it still tells whether the door is locked while he stands in front of it.
 */
function doorLamp(kind) {
  const c = new Canvas(12, 11)
  c.blit(secretLamp(kind), 2, 0)
  plate(c, 0, 6, 12, 3, G4)
  c.rect(1, 7, 10, 1, G5)
  // a short neck down to the frame, so the lit dome clears his bristles
  c.rect(4, 9, 4, 2, K)
  c.rect(5, 9, 2, 2, G3)
  return c
}

/* ------------------------------------------------------------------ */
/* secretExit: a steel door stencilled EMPLOYEES ONLY (52 x 76)        */
/* ------------------------------------------------------------------ */

function secret(open) {
  const c = new Canvas(52, 76)
  // frame
  c.rect(2, 9, 48, 67, K)
  c.rect(3, 10, 46, 66, G2)
  c.rect(3, 10, 46, 1, G3)
  c.rect(3, 10, 1, 66, G3)
  c.rect(5, 12, 42, 64, K)
  // behind it: a dim way down, and a light a long way in
  c.rect(6, 13, 40, 63, P0)
  c.poly([[6, 75], [46, 75], [36, 56], [22, 56]], P1)
  c.rect(22, 34, 14, 22, P1)
  c.rect(25, 38, 8, 18, Y1)
  c.rect(26, 39, 6, 17, Y2)
  c.rect(27, 44, 4, 8, CREAM)
  const w = [40, 27, 8][open]
  // the leaf
  c.rect(6, 13, w, 63, G3)
  c.rect(6, 13, w, 1, G5)
  c.rect(6, 13, 1, 63, G5)
  c.rect(6 + w - 2, 14, 2, 62, G2)
  if (open > 0) c.rect(6 + w, 13, 1, 63, K)
  if (open === 0) {
    hazard(c, 7, 15, 38, 4, Y1, G0, 8)
    c.rect(7, 19, 38, 1, G2)
    c.text(9, 23, 'EMPLOYEES', Y1)
    c.text(19, 30, 'ONLY', Y1)
    // a seam, a kick plate, rivets and the handle
    c.rect(7, 38, 38, 1, G2)
    c.rect(7, 39, 38, 1, G4)
    c.rect(7, 66, 38, 8, G2)
    c.rect(7, 66, 38, 1, G4)
    for (const [x, y] of [[9, 41], [43, 41], [9, 63], [43, 63], [9, 68], [43, 68], [9, 72], [43, 72]]) c.set(x, y, G5)
    c.rect(38, 44, 5, 14, K)
    c.rect(39, 45, 3, 12, G5)
    c.rect(41, 45, 1, 12, G4)
    c.rect(39, 45, 3, 1, G6)
  } else if (open === 1) {
    hazard(c, 7, 15, w - 3, 4, Y1, G0, 8)
    c.rect(7, 38, w - 3, 1, G2)
    c.rect(7, 66, w - 3, 8, G2)
    c.rect(9, 23, 16, 1, Y1)
    c.rect(9, 25, 16, 1, Y1)
    c.rect(13, 30, 9, 1, Y1)
  } else {
    c.rect(7, 15, w - 3, 4, Y0)
    c.rect(7, 66, w - 3, 8, G2)
  }
  // threshold
  c.rect(0, 74, 52, 2, K)
  c.rect(1, 74, 50, 1, G4)
  // lamp housing over the door (the bulb is a frame of its own)
  c.rect(21, 5, 10, 5, K)
  c.rect(22, 6, 8, 3, G3)
  c.rect(22, 6, 8, 1, G5)
  return c
}
addAnim('secret', [secret(0), secret(1), secret(2)], 26, 76)

function secretLamp(kind) {
  // 0 dark, 1 red, 2 green
  const c = new Canvas(8, 7)
  const [fill, hi, low] = [[R1, R2, R0], [R4, R5, R3], [GN3, G6, GN2]][kind]
  c.rect(1, 0, 6, 7, K)
  c.rect(0, 2, 8, 5, K)
  c.rect(2, 1, 4, 6, fill)
  c.rect(1, 3, 6, 4, fill)
  c.set(2, 2, hi)
  c.set(3, 1, hi)
  c.rect(5, 4, 2, 3, low)
  return c
}
// Anchored so that drawing at the door's own anchor puts the bulb on its housing.
addAnim('secretLamp', [secretLamp(0), secretLamp(1), secretLamp(2)], 4, 76)
// Anchored the same way on the shop door: drawn at the door's feet it sits on top of the frame.
addAnim('doorLamp', [doorLamp(0), doorLamp(1), doorLamp(2)], 6, 71)

/* ------------------------------------------------------------------ */
/* gate: a striped roll-up shutter, in 32 px widths                    */
/* ------------------------------------------------------------------ */

{
  // two slats, yellow then charcoal: the curtain is this tile repeated down its height
  const s = new Canvas(32, 16)
  bands(s, 0, 0, 32, [[1, Y2], [4, Y1], [2, Y0], [1, K], [1, G3], [4, G2], [2, G1], [1, K]])
  add('gateSlats', s, 0, 0)

  const foot = new Canvas(32, 8)
  bands(foot, 0, 0, 32, [[1, K], [1, G6], [2, G4], [2, G3], [2, K]])
  foot.rect(11, 3, 10, 2, K)
  foot.rect(12, 3, 8, 1, G2)
  hazard(foot, 0, 6, 32, 1, G0, G0)
  add('gateFoot', foot, 0, 0)

  for (const on of [0, 1]) {
    const top = new Canvas(32, 12)
    bands(top, 0, 0, 32, [[1, K], [2, G4], [6, G3], [2, G2], [1, K]])
    top.rect(0, 1, 32, 1, G5)
    for (const x of [4, 27]) {
      top.set(x, 4, G5)
      top.set(x, 8, G1)
    }
    // the lamp: red while shut, green once it is open
    top.rect(13, 3, 6, 6, K)
    top.rect(14, 4, 4, 4, on ? GN3 : R4)
    top.set(14, 4, on ? G6 : R5)
    top.rect(16, 6, 2, 2, on ? GN2 : R3)
    add(`gateTop${on}`, top, 0, 0)
  }

  // the guide rail down each side, 3 px wide, repeated every 8
  const rail = new Canvas(3, 8)
  rail.rect(0, 0, 3, 8, K)
  rail.rect(1, 0, 1, 8, G3)
  rail.set(1, 3, G5)
  add('gateRail', rail, 0, 0)
}

// The floor button that sets a flag.
function button(down) {
  const c = new Canvas(24, 12)
  plate(c, 0, 8, 24, 4, Y1)
  hazard(c, 1, 9, 22, 2, Y1, G0, 6)
  for (let x = 1; x < 23; x++) c.set(x, 9, (x - 1) % 6 < 3 ? Y2 : G1)
  if (down) {
    c.rect(4, 6, 16, 3, K)
    c.rect(5, 7, 14, 1, R2)
    c.rect(5, 7, 6, 1, R3)
  } else {
    c.rect(5, 2, 14, 7, K)
    c.rect(4, 4, 16, 5, K)
    c.rect(6, 3, 12, 5, R3)
    c.rect(5, 5, 14, 3, R3)
    c.rect(7, 3, 6, 1, R5)
    c.rect(6, 4, 2, 1, R5)
    c.rect(6, 4, 10, 1, R4)
    c.rect(7, 3, 6, 1, R5)
    c.rect(14, 6, 5, 2, R2)
  }
  return c
}
add('button0', button(false), 12, 12)
add('button1', button(true), 12, 12)

/* ------------------------------------------------------------------ */
/* goal: the wash exit arch, 96 x 160 (drawn on 104 x 168)             */
/* ------------------------------------------------------------------ */

// The entity's box is 96 x 160. The art overhangs it: 4 px each side for the footings and
// 16 px above for the crown.
const GOAL = { w: 104, h: 176, ax: 52, ay: 176 }
/** Rows of the canvas: top of the sign board, top of the pillars (the board's last row), the ground. */
const BOARD_TOP = 20
const PILLAR_TOP = 58
const GROUND = GOAL.h - 8
/** Sign letters on a 7 px tall grid, drawn doubled. */
const SIGN_FONT = {
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  H: ['#..#', '#..#', '#..#', '####', '#..#', '#..#', '#..#'],
  A: ['.##.', '#..#', '#..#', '####', '#..#', '#..#', '#..#'],
  N: ['#..#', '##.#', '##.#', '#.##', '#.##', '#..#', '#..#'],
  K: ['#..#', '#.#.', '##..', '##..', '#.#.', '#..#', '#..#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  O: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  U: ['#..#', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
}

function signText(c, x, y, text, col, scale = 2) {
  let cx = x
  for (const ch of text) {
    const g = SIGN_FONT[ch]
    stamp(c, cx, y, g, col, scale)
    cx += (g[0].length + 1) * scale
  }
  return cx - scale - x
}

/** One pillar: red with a blue band and a striped guard at the foot. `far` is the one in the shade. */
function pillar(c, x, w, far) {
  const [hi, mid, lo] = far ? [R3, R2, R1] : [R4, R3, R2]
  const [bh, bm, bl] = far ? [B2, B1, B0] : [B3, B2, B1]
  const top = PILLAR_TOP
  const lit = far ? 1 : 3
  const dark = far ? 3 : 5
  c.rect(x, top, w, GROUND - top, K)
  c.rect(x + 1, top, w - 2, GROUND - top, mid)
  c.rect(x + 1, top, lit, GROUND - top, hi)
  c.rect(x + w - 1 - dark, top, dark, GROUND - top, lo)
  // blue band between two white lines
  const by = top + 16
  c.rect(x + 1, by - 2, w - 2, 16, G6)
  c.rect(x + w - 1 - dark, by - 2, dark, 16, G5)
  c.rect(x + 1, by, w - 2, 12, bm)
  c.rect(x + 1, by, lit, 12, bh)
  c.rect(x + w - 1 - dark, by, dark, 12, bl)
  // bumper guard
  const gy = GROUND - 22
  c.rect(x, gy, w, 1, K)
  hazard(c, x + 1, gy + 1, w - 2, 20, far ? Y0 : Y1, far ? G0 : G1, 10)
  if (!far) {
    for (let j = 0; j < 20; j++) for (let i = 0; i < 2; i++) c.set(x + 1 + i, gy + 1 + j, (((i - j) % 10) + 10) % 10 < 5 ? Y2 : G2)
  }
  c.rect(x, GROUND - 1, w, 1, K)
  // footing
  c.rect(x - 3, GROUND, w + 6, 8, K)
  c.rect(x - 2, GROUND + 1, w + 4, 6, far ? G3 : G4)
  c.rect(x - 2, GROUND + 1, w + 4, 1, far ? G4 : G6)
  c.rect(x - 2, GROUND + 5, w + 4, 2, far ? G2 : G3)
}

const FAR = { x: 8, w: 16 }
const NEAR = { x: 80, w: 20 }

function goalLegs(only = null) {
  const c = new Canvas(GOAL.w, GOAL.h)
  if (only !== 'near') {
    // the underside of the header, in shadow between the pillars
    const x = FAR.x + FAR.w
    c.rect(x, PILLAR_TOP, NEAR.x - x, 5, K)
    c.rect(x, PILLAR_TOP, NEAR.x - x, 3, G1)
    c.rect(x, PILLAR_TOP + 3, NEAR.x - x, 1, G2)
    pillar(c, FAR.x, FAR.w, true)
  }
  if (only !== 'far') pillar(c, NEAR.x, NEAR.w, false)
  return c
}

/** The MW shield, as on Maxx's chest: red M over blue W. */
function shield() {
  const c = new Canvas(13, 16)
  c.poly([[0, 0], [12, 0], [12, 10], [6, 15], [0, 10]], K)
  c.poly([[1, 1], [11, 1], [11, 9], [6, 14], [1, 9]], G6)
  stamp(c, 4, 2, M5, R3)
  stamp(c, 4, 8, ['#...#', '#.#.#', '##.##', '.#.#.'], B2)
  return c
}

/**
 * The header: the THANK YOU sign in a frame of bulbs.
 * phase 0 / 1: every other bulb lit; 2: all lit and the words in gold (he is through).
 */
function goalHead(phase) {
  const c = new Canvas(GOAL.w, PILLAR_TOP + 1)
  const t = BOARD_TOP
  // crown and shield
  disc(c, 52, t + 2, 21, 13, K)
  disc(c, 52, t + 2, 20, 12, R3)
  paint(c, (x, y) => inD(x, y, 52, t + 2, 20, 12) && !inD(x, y, 53.5, t + 3.5, 20, 12), R4)
  c.blit(shield(), 46, 3)
  // board
  c.rect(0, t, 104, 39, K)
  round(c, 0, t, 104, 39)
  c.rect(1, t + 1, 102, 37, R3)
  c.rect(1, t + 1, 102, 1, R4)
  c.rect(1, t + 1, 1, 37, R4)
  c.rect(1, t + 36, 102, 2, R2)
  c.rect(101, t + 2, 2, 36, R2)
  c.rect(6, t + 6, 92, 27, K)
  c.rect(7, t + 7, 90, 25, B1)
  c.rect(7, t + 7, 90, 2, B0)
  c.rect(7, t + 30, 90, 2, B2)
  // words
  const ink = phase === 2 ? Y2 : G6
  const width = signText(new Canvas(120, 14), 0, 0, 'THANK YOU', ink)
  const tx = Math.round(52 - width / 2)
  signText(c, tx + 1, t + 14, 'THANK YOU', B0)
  signText(c, tx, t + 13, 'THANK YOU', ink)
  // bulbs round the frame, every other one lit
  const bulbs = []
  for (let x = 5; x <= 97; x += 8) bulbs.push([x, t + 3], [x, t + 34])
  for (let y = t + 11; y <= t + 27; y += 8) bulbs.push([2, y], [100, y])
  for (const [x, y] of bulbs) {
    const lit = phase === 2 || Math.round((x + y) / 8) % 2 === phase
    c.rect(x, y, 2, 2, lit ? Y2 : Y0)
    if (lit) c.set(x, y, G6)
    else c.set(x + 1, y + 1, WD[1])
  }
  return c
}

/** The traffic light that hangs in the arch. lamp: 0 red, 1 green, 2 both dark. */
function goalLight(lamp) {
  const c = new Canvas(18, 38)
  // hanger
  c.rect(7, 0, 4, 6, K)
  c.rect(8, 0, 2, 5, G3)
  // housing
  c.rect(1, 5, 16, 32, K)
  round(c, 1, 5, 16, 32)
  c.rect(2, 6, 14, 30, G1)
  c.rect(2, 6, 2, 30, G2)
  c.rect(14, 7, 2, 29, G0)
  /** lit: [glint, face, shade]; dark: [face, glint]. */
  const lens = (cy, on, lit, dark) => {
    disc(c, 9, cy, 5.5, 5.5, K)
    disc(c, 9, cy, 4.5, 4.5, on ? lit[1] : dark[0])
    if (on) {
      paint(c, (x, y) => inD(x, y, 9, cy, 4.5, 4.5) && !inD(x, y, 8, cy - 1, 4.5, 4.5), lit[2])
      c.set(7, cy - 3, lit[0])
      c.set(6, cy - 2, lit[0])
      c.set(7, cy - 2, lit[0])
    } else {
      c.set(7, cy - 3, dark[1])
      c.set(6, cy - 2, dark[1])
    }
    // visor
    c.rect(3, cy - 7, 12, 2, K)
    c.rect(4, cy - 6, 10, 1, G3)
  }
  lens(14, lamp === 0, [G6, R4, R3], [R0, R1])
  lens(28, lamp === 1, [G6, GN3, GN2], [GN0, GN1])
  return c
}

add('goalLegs', goalLegs(), GOAL.ax, GOAL.ay)
{
  // the near pillar on its own, for the piece drawn in front of Maxx
  const near = goalLegs('near')
  const b = near.bounds()
  add('goalNear', near.crop(b.x, b.y, b.w, b.h), GOAL.ax - b.x, GOAL.ay - b.y)
}
addAnim('goalHead', [goalHead(0), goalHead(1), goalHead(2)], GOAL.ax, GOAL.ay)
// It hangs from the underside of the header, in the middle of the opening.
addAnim('goalLight', [goalLight(0), goalLight(1), goalLight(2)], 9, GOAL.ay - (PILLAR_TOP + 4))

/* ------------------------------------------------------------------ */
/* Meta, checks, write                                                 */
/* ------------------------------------------------------------------ */

atlas.meta({
  anchor: 'Standing and floating things: bottom-centre of the entity box, draw at (e.x + e.w / 2, e.y + e.h). doorLamp*, secretLamp*: the same point as their door. gate*, lift* (one per 32 px of deck): top-left. liftTruck: middle of its top edge, under the middle of the deck. glint, railDot, railEnd, padlock: their middle. cpFlag*: where the cloth meets the pole.',
  ticks: { coin: 5, token: 9, bubble: 9, turbo: 5, glint: 3, cpFlag: 7, goalHead: 14 },
  ticksNote: 'Ticks (1/60 s) each frame of a looping animation is shown for.',
  box: { coin: [18, 20], token: [22, 22], bubble: [20, 20], turbo: [22, 20], wax: [20, 24], oneup: [22, 22], checkpoint: [24, 56], goal: [96, 160], secretExit: [32, 64], door: [28, 56], sign: [24, 32], spring: [28, 22], button: [24, 8] },
  boxNote: 'Collision box (w, h) of the entity each sprite is drawn for. Art may overhang it.',
  checkpoint: { flagX: 2, flagLow: 30, flagHigh: 51 },
  checkpointNote: 'Where the flag meets the pole, from the post anchor: flagX to the right, and above the ground line flagLow (limp, waiting) or flagHigh (raised).',
  goal: { w: 96, h: 160, opening: [FAR.x + FAR.w - GOAL.ax, NEAR.x - GOAL.ax], clear: GROUND - PILLAR_TOP - 5 },
  goalNote: 'opening: x of the inner faces of the two pillars, from the middle of the arch. clear: height of the opening under the header.',
  gate: { top: 12, foot: 8, slats: 16, rail: 3 },
  lift: { deck: 12, under: 8 },
  spring: 'spring0 rest, spring1 squashed, spring2 sprung, spring3 settling. The middle of the top face is the box top at rest.',
  doorLamp: 'doorLamp0 dim red, doorLamp1 red, doorLamp2 green: over a door that has a flag (barred until it is reached).',
})

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write({ dir: ASSETS_DIR })
console.log(`items atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames`)

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

/** Put frames together the way the renderer does: [[name, x, y], ...] with (x, y) each frame's anchor. */
function compose(w, h, parts, ax, ay, label) {
  const c = new Canvas(w, h)
  for (const [name, x, y, opts] of parts) {
    const f = FR[name]
    if (!f) throw new Error('compose: no frame ' + name)
    c.blit(f.canvas, x - f.ax, y - f.ay, opts ?? {})
  }
  return { canvas: c, ax, ay, label }
}

function gatePicture(tilesW, tilesH, open, label) {
  // open: 0 shut .. 1 rolled right up
  const w = tilesW * 32
  const full = tilesH * 32
  const h = Math.max(12, Math.round(full - open * (full - 12)))
  const c = new Canvas(w, full)
  const slats = FR.gateSlats.canvas
  const shift = (full - h) % 16
  for (let x = 0; x < w; x += 32) {
    for (let y = 12; y < h - 8; y++) for (let i = 0; i < 32; i++) c.set(x + i, y, slats.get(i, (y - 12 + shift) % 16))
    if (h > 20) c.blit(FR.gateFoot.canvas, x, h - 8)
    c.blit(FR[open >= 1 ? 'gateTop1' : 'gateTop0'].canvas, x, 0)
  }
  for (let y = 12; y < full; y += 8) {
    c.blit(FR.gateRail.canvas, 0, y)
    c.blit(FR.gateRail.canvas, w - 3, y)
  }
  c.rect(0, 0, 1, 12, K)
  c.rect(w - 1, 0, 1, 12, K)
  return { canvas: c, ax: w / 2, ay: full, label }
}

function liftPicture(tiles, label) {
  const c = new Canvas(tiles * 32, 20)
  for (let i = 0; i < tiles; i++) c.blit(FR[tiles === 1 ? 'lift1' : i === 0 ? 'liftL' : i === tiles - 1 ? 'liftR' : 'liftM'].canvas, i * 32, 0)
  if (tiles > 1) c.blit(FR.liftTruck.canvas, tiles * 16 - FR.liftTruck.ax, 12)
  return { canvas: c, ax: tiles * 16, ay: 12, label }
}

function goalPicture(open, phase, label) {
  return compose(GOAL.w, GOAL.h, [['goalLegs', GOAL.ax, GOAL.ay], [`goalHead${open ? 2 : phase}`, GOAL.ax, GOAL.ay], [`goalLight${open ? 1 : 0}`, GOAL.ax, GOAL.ay]], GOAL.ax, GOAL.ay, label)
}

function checkpointPicture(state, n, label) {
  const parts = [[state === 'idle' ? 'cpPost0' : 'cpPost1', 14, 62]]
  if (state === 'idle') parts.push(['cpFlagLimp', 16, 62 - 30])
  else parts.push([`cpFlag${n}`, 16, 62 - (state === 'rise' ? 40 : 51)])
  return compose(40, 62, parts, 14, 62, label)
}

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const strip = (label, names) => ({ label, frames: names.map((n) => FR[n]) })
  const anim = (name) => strip(name, atlas.anims[name])

  const pickups = [anim('coin'), anim('token'), strip('tokenGhost glint', ['tokenGhost', ...atlas.anims.glint]), anim('bubble'), anim('turbo'), anim('wax'), anim('oneup')]
  const fixtures = [
    { label: 'checkpoint: idle, rising, on x4', frames: [checkpointPicture('idle', 0, 'idle'), checkpointPicture('rise', 0, 'rise'), ...[0, 1, 2, 3].map((n) => checkpointPicture('on', n, 'on' + n))] },
    strip('sign', ['sign0', 'sign1']),
    anim('spring'),
    { label: 'lift 1, 2, 3 wide', frames: [liftPicture(1, '1'), liftPicture(2, '2'), liftPicture(3, '3')] },
    strip('rail', ['railDot', 'railEnd']),
    strip('button', ['button0', 'button1']),
  ]
  const doors = [
    anim('door'),
    {
      label: 'door locked, unlocking',
      frames: [0, 1, 2, 3].map((n) => compose(36, 72, [['door0', 18, 72], [`doorLock${n}`, 18, 72], [`doorLamp${n === 0 ? 1 : n === 1 ? 0 : 2}`, 18, 72], ...(n === 0 ? [['padlock', 18, 72 - 30]] : [])], 18, 72, 'lock' + n)),
    },
    strip('padlock, lamp', ['padlock', 'doorLamp0', 'doorLamp1', 'doorLamp2']),
    {
      label: 'secretExit: idle (lamp dark, lamp red), ajar, open',
      frames: [
        compose(52, 76, [['secret0', 26, 76], ['secretLamp0', 26, 76]], 26, 76, 'idle'),
        compose(52, 76, [['secret0', 26, 76], ['secretLamp1', 26, 76]], 26, 76, 'blink'),
        compose(52, 76, [['secret1', 26, 76], ['secretLamp2', 26, 76]], 26, 76, 'ajar'),
        compose(52, 76, [['secret2', 26, 76], ['secretLamp2', 26, 76]], 26, 76, 'open'),
      ],
    },
    { label: 'gate 1x3: shut, opening, open; 2x2 shut', frames: [gatePicture(1, 3, 0, 'shut'), gatePicture(1, 3, 0.35, 'opening'), gatePicture(1, 3, 0.7, 'opening'), gatePicture(1, 3, 1, 'open'), gatePicture(2, 2, 0, '2x2')] },
  ]
  const goal = [{ label: 'goal: idle (bulbs a, b), open', frames: [goalPicture(false, 0, 'idle a'), goalPicture(false, 1, 'idle b'), goalPicture(true, 0, 'open')] }, strip('parts', ['goalNear', 'goalLight0', 'goalLight1', 'goalLight2'])]

  const BACKS = { sky: '#5cc8ff', tunnel: '#2e3038' }
  for (const [bgName, bg] of Object.entries(BACKS)) {
    for (const flipX of [false, true]) {
      const tag = `${bgName}${flipX ? '_flip' : ''}`
      contactSheet(pickups, { bg, flipX, scale: 4, wrap: 8, file: path.join(REVIEW, `pickups_${tag}.png`) })
      contactSheet(fixtures, { bg, flipX, scale: 4, wrap: 8, file: path.join(REVIEW, `fixtures_${tag}.png`) })
      contactSheet(doors, { bg, flipX, scale: 3, wrap: 8, file: path.join(REVIEW, `doors_${tag}.png`) })
      contactSheet(goal, { bg, flipX, scale: 3, wrap: 4, file: path.join(REVIEW, `goal_${tag}.png`) })
    }
    // everything at the size it is played at
    contactSheet([...pickups, ...fixtures, ...doors, ...goal], { bg, scale: 1, wrap: 8, labels: false, file: path.join(REVIEW, `all_1x_${bgName}.png`) })
  }

  // A line-up on the ground with Maxx, for scale and for how it all sits together.
  const maxxPng = path.join(ASSETS_DIR, 'maxx.png')
  const maxxTs = path.join(ASSETS_DIR, 'maxx.atlas.ts')
  let hero = null
  if (fs.existsSync(maxxPng) && fs.existsSync(maxxTs)) {
    const m = /idle0: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+) \}/.exec(fs.readFileSync(maxxTs, 'utf8'))
    if (m) {
      const [x, y, w, h, ax, ay] = m.slice(1).map(Number)
      hero = { canvas: Canvas.load(maxxPng).crop(x, y, w, h), ax, ay }
    }
  }
  for (const [bgName, bg] of Object.entries(BACKS)) {
    const W = 640
    const H = 224
    const ground = 192
    const scene = new Canvas(W, H, bg)
    scene.rect(0, ground, W, H - ground, bgName === 'sky' ? WD[1] : G2)
    scene.rect(0, ground, W, 2, bgName === 'sky' ? GN2 : G3)
    const put = (f, x, y = ground) => scene.blit(f.canvas, x - f.ax, y - f.ay)
    const items = [
      [FR.sign0, 20],
      [FR.coin0, 48, ground - 7],
      [FR.coin1, 70, ground - 7],
      [FR.token0, 96, ground - 5],
      [FR.bubble0, 124, ground - 6],
      [FR.turbo1, 152],
      [FR.wax0, 180],
      [FR.oneup0, 206],
      [checkpointPicture('idle', 0), 246],
      [checkpointPicture('on', 1), 280],
      [FR.spring0, 330],
      [FR.button0, 362],
      [gatePicture(1, 3, 0), 392],
      [compose(36, 72, [['door0', 18, 72], ['doorLock0', 18, 72], ['doorLamp1', 18, 72], ['padlock', 18, 42]], 18, 72), 432],
      [FR.door0, 472],
      [compose(52, 76, [['secret0', 26, 76], ['secretLamp1', 26, 76]], 26, 76), 518],
      [goalPicture(false, 0), 590],
    ]
    for (const [f, x, y] of items) put(f, x, y)
    put(liftPicture(3), 330, 96)
    if (hero) put(hero, 300)
    if (hero) put(hero, 588)
    put(FR.goalNear, 590)
    scene.save(path.join(REVIEW, `lineup_1x_${bgName}.png`))
    scene.scale(3).save(path.join(REVIEW, `lineup_3x_${bgName}.png`))
  }
  console.log(`review sheets in ${REVIEW}`)
}
