// art-cars.mjs: generates the 'cars' atlas: seven cars with faces, their dirt, the pickup's
// mud clod, and the sports car's warning marker.
//
//   node scripts/maxx/art-cars.mjs                    writes cars.png + cars.atlas.ts
//   node scripts/maxx/art-cars.mjs --review <dir>     also writes contact sheets into <dir>:
//       every variant by dirt stage by face, every paint, the overlays as strips, the life of
//       each car as the renderer tells it (story_*), the cars beside Maxx; at 1x and 3x, on
//       sky and on the tunnel wall, plain and mirrored
//   node scripts/maxx/art-cars.mjs --dump <dir> sedan:grump:3[:paint] ...
//       one composed car (variant:face:stage) blown up with pixel rulers, for editing
//
// A car is drawn in layers, all sharing one anchor (the middle of the box on the ground
// line), so the renderer can stack them and mirror the stack:
//   <variant>_p<k>      the clean body in paint k, facing left, wheel wells empty
//   <variant>_dull<k>   the same under road grime (a shade darker, grey glass, dull chrome):
//                       what a filthy car wears, so the wash reveals brighter paint
//   <variant>_d<stage>  its own kind of dirt, stage 3 (caked), 2 (streaky), 1 (nearly clean);
//                       _d<stage>m, where the dirt has words in it, has them back to front
//                       for a car facing right (mirrored, they read)
//   <variant>_<face>    eyes and mouth (see FACES); the lids are the body's own paint
//   <variant>_g<i>      a glint crossing clean paint      <variant>_w<i>  water running off
//   <variant>_flash     the white silhouette of the moment it comes clean
//   wheel<d>c<i> / wheel<d>d<i>   a turning wheel, clean or dirty, by diameter
//   clod<i>, mark<i>, twinkle<i>, fly<i>  the mud ball, the warning marker, a sparkle, a fly
// The art fills its collision box (sizes are read from sim/tuning.ts): the roof's outline is
// row 0 of the box and the tyres stand on its last row.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, rgba, rulerSheet } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR, GAME_DIR } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

/* ------------------------------------------------------------------ */
/* Colours                                                             */
/* ------------------------------------------------------------------ */

const O = PAL.outline
const WHITE = PAL.grey[6]
// Stand-ins for the four shades of paint, swapped for a real ramp per colour.
const PD = '#ff00d0'
const PM = '#ff00d1'
const PL = '#ff00d2'
const PS = '#ff00d3'
const PAINT = new Set([PD, PM, PL, PS].map(rgba))
const vO = rgba(O)
const vPM = rgba(PM)
const vWHITE = rgba(WHITE)

/** dark, mid, light, sparkle */
const PAINTS = {
  red: [PAL.red[1], PAL.red[3], PAL.red[4], PAL.red[5]],
  blue: [PAL.blue[0], PAL.blue[1], PAL.blue[2], PAL.blue[3]],
  green: [PAL.green[0], PAL.green[1], PAL.green[2], PAL.green[3]],
  yellow: [PAL.yellow[0], PAL.yellow[1], PAL.yellow[2], PAL.wood[8]],
  orange: [PAL.orange[0], PAL.orange[1], PAL.orange[2], PAL.wood[8]],
  purple: [PAL.purple[1], PAL.purple[2], PAL.purple[3], PAL.ice[2]],
  teal: [PAL.teal[0], PAL.teal[1], PAL.teal[2], PAL.grey[6]],
  pink: [PAL.red[2], PAL.pink[0], PAL.red[5], PAL.wood[8]],
}

/**
 * The same paints under a coat of road grime: a shade darker all round, so the wash reveals
 * paint brighter than the car arrived in. The dirt overlays go on top of these.
 */
const DULL = {
  red: [PAL.red[0], PAL.red[1], PAL.red[2], PAL.red[3]],
  blue: [PAL.navy, PAL.blue[0], PAL.blue[1], PAL.blue[2]],
  green: [PAL.grey[0], PAL.green[0], PAL.green[1], PAL.green[2]],
  yellow: [PAL.wood[1], PAL.yellow[0], PAL.wood[4], PAL.yellow[1]],
  orange: [PAL.red[1], PAL.orange[0], PAL.wood[3], PAL.orange[1]],
  purple: [PAL.purple[0], PAL.purple[1], PAL.purple[2], PAL.purple[3]],
  teal: [PAL.navy, PAL.teal[0], PAL.grey[3], PAL.teal[1]],
  pink: [PAL.red[1], PAL.red[2], PAL.pink[0], PAL.red[5]],
}

/** From this dirt stage up the car wears the grimy body; nearly clean (stage 1) it shows its own paint again. */
const DULL_FROM = 2

const GLASS = { base: PAL.blue[4], low: PAL.blue[3], shine: WHITE }
const STEEL = { dark: PAL.grey[2], mid: PAL.grey[3], light: PAL.grey[4], shine: PAL.grey[5] }
/** Grimy glass and dull chrome, for the body under the dirt. */
const GRIMY = {
  [GLASS.base]: PAL.grey[4],
  [GLASS.low]: PAL.grey[3],
  [GLASS.shine]: PAL.grey[5],
  [STEEL.shine]: PAL.grey[4],
  [STEEL.light]: PAL.grey[3],
  [PAL.red[5]]: PAL.red[3],
  [PAL.red[4]]: PAL.red[2],
}

/** Each kind of dirt: body, the lit top edge, the shaded bottom edge. */
const MATS = [
  null,
  { name: 'dust', base: PAL.wood[6], light: PAL.wood[7], dark: PAL.mud[4] },
  { name: 'mud', base: PAL.mud[2], light: PAL.mud[3], dark: PAL.mud[1] },
  { name: 'bug', base: PAL.green[3], light: PAL.yellow[2], dark: PAL.green[2] },
  { name: 'bugdot', base: PAL.grey[0], light: PAL.grey[0], dark: PAL.grey[0] },
  { name: 'tar', base: PAL.grey[1], light: PAL.grey[2], dark: PAL.grey[0] },
  { name: 'salt', base: PAL.ice[2], light: PAL.grey[6], dark: PAL.ice[1] },
  // Clods of grit in the dust, so a dusty car reads as dirty and not as two-tone paint.
  { name: 'grit', base: PAL.mud[4], light: PAL.wood[6], dark: PAL.mud[3] },
]
const DUST = 1
const MUD = 2
const BUG = 3
const BUGDOT = 4
const TAR = 5
const SALT = 6
const GRIT = 7

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Room round the box inside every working canvas: honk lines ahead of the nose, things above the roof. */
const MX = 12
const MT = 16

/** A canvas addressed in box coordinates: (0, 0) is the top-left of the collision box. */
class Pen {
  constructor(c) {
    this.c = c
  }
  get(x, y) {
    return this.c.get(x + MX, y + MT)
  }
  solid(x, y) {
    return this.c.solid(x + MX, y + MT)
  }
  set(x, y, col) {
    this.c.set(x + MX, y + MT, col)
    return this
  }
  rect(x, y, w, h, col) {
    this.c.rect(x + MX, y + MT, w, h, col)
    return this
  }
  line(x0, y0, x1, y1, col, thick) {
    this.c.line(x0 + MX, y0 + MT, x1 + MX, y1 + MT, col, thick)
    return this
  }
  poly(pts, col, opts) {
    this.c.poly(pts.map(([x, y]) => [x + MX, y + MT]), col, opts)
    return this
  }
  ellipse(cx, cy, rx, ry, col, opts) {
    this.c.ellipse(cx + MX, cy + MT, rx, ry, col, opts)
    return this
  }
  /** Only where paint is: trim lines, seams. */
  onPaint(x, y, col) {
    if (PAINT.has(this.get(x, y))) this.set(x, y, col)
    return this
  }
}

function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const tuning = fs.readFileSync(path.join(GAME_DIR, 'game', 'sim', 'tuning.ts'), 'utf8')
function boxOf(variant) {
  const m = new RegExp(`\\b${variant}: \\{ w: (\\d+), h: (\\d+)`).exec(tuning)
  if (!m) throw new Error(`art-cars: no size for '${variant}' in sim/tuning.ts`)
  return { w: Number(m[1]), h: Number(m[2]) }
}

/** A window: light glass, a darker foot, one streak of shine, a dark frame. */
function glass(p, pts) {
  p.poly(pts, GLASS.base)
  const ys = pts.map((q) => q[1])
  const xs = pts.map((q) => q[0])
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const base = rgba(GLASS.base)
  const span = Math.max(4, x1 - x0)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (p.get(x, y) !== base) continue
      const k = x - x0 + (y - y0)
      const at = k % Math.max(9, Math.round(span * 0.7))
      if (y >= y1 - 2) p.set(x, y, GLASS.low)
      else if (at === 3 || at === 4) p.set(x, y, GLASS.shine)
    }
  }
  p.poly(pts, O, { fill: false })
}

/** A vertical door seam, on paint only. */
function seam(p, x, y0, y1) {
  for (let y = y0; y <= y1; y++) p.onPaint(x, y, PD)
}

/** The long reflection under the windows. */
function sideLine(p, y, x0, x1) {
  for (let x = x0; x <= x1; x++) if (p.get(x, y) === vPM) p.set(x, y, PL)
}

function handle(p, x, y) {
  p.rect(x, y, 4, 1, STEEL.shine)
  p.rect(x, y + 1, 4, 1, O)
}

function tailLight(p, x, y, h) {
  p.rect(x, y, 2, h, PAL.red[4])
  p.rect(x, y, 2, 1, PAL.red[5])
  p.rect(x, y + h - 1, 2, 1, PAL.red[2])
  p.rect(x - 1, y, 1, h, O)
}

function chrome(p, x, y, w, h) {
  p.rect(x, y, w, h, STEEL.light)
  p.rect(x, y, w, 1, STEEL.shine)
  p.rect(x, y + h - 1, w, 1, STEEL.mid)
  p.rect(x - 1, y, 1, h, O)
  p.rect(x, y - 1, w, 1, O)
}

function steelBar(p, x, y, w, h) {
  p.rect(x, y, w, h, STEEL.mid)
  if (w >= h) {
    p.rect(x, y, w, 1, STEEL.light)
    if (h > 2) p.rect(x, y + h - 1, w, 1, STEEL.dark)
  } else {
    p.rect(x, y, 1, h, STEEL.light)
    if (w > 2) p.rect(x + w - 1, y, 1, h, STEEL.dark)
  }
}

/** The dark of the wheel wells: a disc a little bigger than the wheel, cut into the body only. */
function arches(p, V) {
  const r = V.wheelD / 2 + 2
  const cy = V.h - V.wheelD / 2 - 0.5
  for (const cx of V.wheels) {
    for (let y = Math.floor(cy - r); y <= V.h; y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++) {
        const dx = x - (cx - 0.5)
        const dy = y - cy
        if (dx * dx + dy * dy <= r * r && p.solid(x, y)) p.set(x, y, O)
      }
    }
  }
}

/**
 * Far eye first, then the near one: two tall ovals that share one line of outline. `grow` pops
 * them bigger (delight, fright): the near one moves back and both rise, so the bottoms stay put.
 */
function eyesOf(V, grow = 0) {
  const { x, y, rn, rf, ry } = V.eye
  const nx = x + grow
  return [
    { cx: nx - rn - rf - 2 - 2 * grow, cy: y - grow, rx: rf + grow, ry: ry + grow, near: false },
    { cx: nx, cy: y - grow, rx: rn + grow, ry: ry + grow, near: true },
  ]
}

/* ------------------------------------------------------------------ */
/* The seven bodies                                                    */
/* ------------------------------------------------------------------ */

const VARIANTS = {
  compact: {
    paints: ['red', 'blue', 'green', 'purple'],
    wheelD: 16,
    wheels: [23, 56],
    bottom: 33,
    shadeY: 27,
    eye: { x: 13, y: 17, rn: 4, rf: 3, ry: 5 },
    mouth: { x0: 2, x1: 13, y0: 24, y1: 33 },
    // A boxy little hatchback: an upright windscreen and a short tail, so the roof runs most of its length.
    paint: [[[1, 33], [1, 23], [2, 21], [4, 19], [19, 17], [24, 3], [26, 1], [64, 1], [66, 2], [69, 10], [70, 14], [70, 33]]],
    detail(p) {
      glass(p, [[22, 15], [26, 4], [42, 4], [42, 15]])
      glass(p, [[45, 4], [63, 4], [66, 10], [66, 15], [45, 15]])
      sideLine(p, 19, 18, 68)
      seam(p, 43, 16, 31)
      handle(p, 37, 21)
      tailLight(p, 69, 19, 5)
      chrome(p, 67, 30, 4, 4)
    },
    dirt: 'dust',
  },
  sedan: {
    paints: ['blue', 'yellow', 'teal', 'red'],
    wheelD: 16,
    wheels: [24, 67],
    bottom: 33,
    shadeY: 27,
    eye: { x: 13, y: 17, rn: 4, rf: 3, ry: 5 },
    mouth: { x0: 2, x1: 13, y0: 24, y1: 33 },
    // A long, upright cabin: as much flat roof as a sedan can carry, for Maxx to ride.
    paint: [[[1, 33], [1, 22], [2, 20], [4, 18], [22, 16], [28, 2], [30, 1], [61, 1], [63, 2], [70, 14], [72, 15], [84, 15], [86, 17], [86, 33]]],
    detail(p) {
      glass(p, [[25, 14], [30, 4], [44, 4], [44, 14]])
      glass(p, [[47, 4], [61, 4], [67, 13], [67, 14], [47, 14]])
      sideLine(p, 19, 18, 84)
      seam(p, 45, 16, 31)
      seam(p, 70, 16, 24)
      handle(p, 38, 21)
      handle(p, 58, 21)
      for (let x = 30; x <= 62; x++) p.onPaint(x, 25, STEEL.shine)
      tailLight(p, 85, 19, 4)
      chrome(p, 82, 30, 5, 4)
    },
    dirt: 'mud',
  },
  suv: {
    paints: ['purple', 'red', 'blue', 'teal'],
    wheelD: 20,
    wheels: [25, 69],
    bottom: 44,
    shadeY: 37,
    eye: { x: 13, y: 23, rn: 4, rf: 3, ry: 6 },
    mouth: { x0: 2, x1: 13, y0: 31, y1: 43 },
    paint: [[[1, 44], [1, 29], [2, 27], [4, 25], [20, 23], [27, 5], [29, 4], [88, 4], [90, 6], [90, 44]]],
    detail(p) {
      // Roof rails: the top of the box.
      steelBar(p, 32, 1, 55, 2)
      for (const x of [32, 58, 85]) p.rect(x, 3, 2, 1, STEEL.dark)
      glass(p, [[24, 21], [30, 8], [43, 8], [43, 21]])
      glass(p, [[46, 8], [63, 8], [63, 21], [46, 21]])
      glass(p, [[66, 8], [84, 8], [87, 11], [87, 21], [66, 21]])
      sideLine(p, 25, 19, 88)
      seam(p, 44, 22, 42)
      seam(p, 64, 22, 34)
      handle(p, 38, 27)
      handle(p, 58, 27)
      tailLight(p, 89, 24, 7)
      chrome(p, 86, 41, 5, 4)
    },
    dirt: 'bugs',
  },
  pickup: {
    paints: ['red', 'yellow', 'blue', 'green'],
    wheelD: 20,
    wheels: [25, 78],
    bottom: 44,
    shadeY: 37,
    eye: { x: 13, y: 23, rn: 4, rf: 3, ry: 6 },
    mouth: { x0: 2, x1: 13, y0: 31, y1: 43 },
    paint: [[[1, 44], [1, 29], [2, 27], [4, 25], [22, 23], [29, 3], [31, 1], [52, 1], [54, 3], [54, 24], [96, 24], [98, 26], [98, 44]]],
    /** The open bed under the rack: where the mud pile shows. */
    bed: { x0: 56, x1: 93, y0: 5, y1: 23 },
    detail(p) {
      // A ladder rack over the bed, level with the cab roof: the whole top is one line to stand on.
      steelBar(p, 53, 1, 45, 3)
      steelBar(p, 95, 4, 3, 20)
      steelBar(p, 74, 4, 2, 20)
      glass(p, [[26, 21], [32, 5], [50, 5], [50, 21]])
      sideLine(p, 26, 19, 96)
      seam(p, 52, 22, 42)
      seam(p, 92, 26, 42)
      for (let x = 56; x <= 90; x++) p.onPaint(x, 31, PD)
      handle(p, 45, 27)
      tailLight(p, 97, 27, 6)
      chrome(p, 94, 41, 5, 4)
    },
    dirt: 'mud',
  },
  sports: {
    paints: ['yellow', 'red', 'orange', 'teal'],
    wheelD: 16,
    wheels: [24, 72],
    bottom: 28,
    shadeY: 23,
    eye: { x: 13, y: 13, rn: 4, rf: 3, ry: 4 },
    mouth: { x0: 2, x1: 13, y0: 19, y1: 28 },
    paint: [
      [[1, 28], [1, 22], [3, 19], [30, 14], [36, 13], [45, 2], [47, 1], [59, 1], [62, 2], [73, 10], [75, 11], [88, 11], [90, 13], [90, 28]],
      [[77, 1], [90, 1], [90, 3], [77, 3]],
      [[82, 4], [84, 4], [84, 10], [82, 10]],
    ],
    detail(p) {
      glass(p, [[39, 12], [46, 4], [58, 4], [61, 5], [68, 11], [68, 12]])
      sideLine(p, 16, 30, 88)
      seam(p, 55, 5, 26)
      // A side scoop and a stripe: it is the fast one.
      p.rect(60, 17, 7, 3, O)
      p.rect(61, 18, 5, 1, PD)
      for (let x = 20; x <= 88; x++) p.onPaint(x, 21, WHITE)
      tailLight(p, 89, 14, 4)
      p.rect(86, 25, 4, 2, STEEL.mid)
    },
    dirt: 'tar',
  },
  van: {
    paints: ['blue', 'purple', 'green', 'orange'],
    wheelD: 20,
    wheels: [25, 77],
    bottom: 52,
    shadeY: 44,
    eye: { x: 13, y: 27, rn: 4, rf: 3, ry: 6 },
    mouth: { x0: 2, x1: 14, y0: 35, y1: 48 },
    paint: [[[1, 52], [1, 33], [2, 31], [4, 29], [14, 27], [21, 3], [23, 1], [96, 1], [98, 3], [98, 52]]],
    detail(p) {
      glass(p, [[19, 25], [25, 6], [37, 6], [37, 25]])
      glass(p, [[43, 8], [60, 8], [60, 22], [43, 22]])
      sideLine(p, 29, 16, 96)
      seam(p, 40, 4, 50)
      seam(p, 63, 4, 50)
      seam(p, 86, 4, 50)
      for (let x = 41; x <= 92; x++) p.onPaint(x, 26, PD)
      for (let x = 17; x <= 96; x++) for (let y = 34; y <= 36; y++) p.onPaint(x, y, PL)
      handle(p, 56, 30)
      tailLight(p, 97, 30, 9)
      chrome(p, 93, 49, 6, 4)
    },
    dirt: 'salt',
  },
  monster: {
    paints: ['purple', 'green', 'blue', 'teal'],
    wheelD: 44,
    wheels: [27, 93],
    bottom: 38,
    shadeY: 31,
    eye: { x: 19, y: 17, rn: 5, rf: 4, ry: 7 },
    mouth: { x0: 5, x1: 26, y0: 26, y1: 37 },
    paint: [[[3, 38], [3, 23], [4, 21], [6, 19], [28, 17], [36, 3], [38, 1], [62, 1], [64, 3], [64, 17], [114, 17], [116, 19], [116, 38]]],
    bed: { x0: 66, x1: 105, y0: 5, y1: 16 },
    detail(p) {
      // Roll bar over the bed, level with the roof.
      steelBar(p, 63, 1, 46, 3)
      p.poly([[107, 1], [110, 1], [115, 16], [112, 16]], STEEL.mid)
      steelBar(p, 86, 4, 3, 13)
      glass(p, [[33, 15], [39, 5], [60, 5], [60, 15]])
      sideLine(p, 20, 26, 114)
      seam(p, 62, 16, 36)
      seam(p, 108, 19, 36)
      // Flames down the side.
      p.poly([[32, 24], [46, 22], [53, 25], [62, 21], [59, 26], [72, 25], [62, 30], [50, 28], [42, 31], [32, 30]], PAL.orange[1])
      p.poly([[33, 26], [45, 24], [52, 27], [58, 25], [50, 27], [42, 29], [33, 28]], PAL.yellow[1])
      tailLight(p, 115, 20, 6)
      // The frame, the springs and the links down to the axles: they ride with the body.
      p.rect(12, 40, 97, 4, PAL.grey[1])
      p.rect(12, 40, 97, 1, PAL.grey[2])
      for (const cx of [27, 93]) {
        for (const dx of [-13, 9]) {
          for (let y = 44; y <= 51; y++) p.rect(cx + dx, y, 4, 1, y % 2 ? PAL.yellow[0] : PAL.yellow[1])
        }
      }
      p.line(57, 44, 48, 58, PAL.grey[2], 2)
      p.line(63, 44, 72, 58, PAL.grey[2], 2)
      chrome(p, 2, 39, 12, 4)
      chrome(p, 107, 39, 12, 4)
    },
    dirt: 'all',
  },
}

for (const [name, V] of Object.entries(VARIANTS)) {
  Object.assign(V, { name }, boxOf(name))
  V.cw = V.w + 2 * MX
  V.ch = V.h + MT
  V.ax = MX + V.w / 2
  V.ay = MT + V.h
}

/** Light from the top left: a bright top edge, a dark sill, a shaded tail. */
function shadePaint(c, V) {
  const sill = MT + V.shadeY
  for (let x = 0; x < c.w; x++) {
    let y = 0
    while (y < c.h && c.get(x, y) !== vPM) y++
    for (let k = 0; k < 2; k++) if (y + k < sill && c.get(x, y + k) === vPM) c.set(x, y + k, PL)
  }
  for (let y = sill; y < c.h; y++) for (let x = 0; x < c.w; x++) if (c.get(x, y) === vPM) c.set(x, y, PD)
  for (let y = 0; y < c.h; y++) {
    let x = c.w - 1
    while (x >= 0 && !PAINT.has(c.get(x, y))) x--
    for (let k = 0; k < 2; k++) if (c.get(x - k, y) === vPM) c.set(x - k, y, PD)
  }
}

/** A spark of the brightest paint where the light first strikes the roof, and on the tail's top corner. */
function sparkle(c) {
  const top = []
  for (let x = 0; x < c.w; x++) {
    let y = 0
    while (y < c.h && !PAINT.has(c.get(x, y))) y++
    top.push(y)
  }
  const roof = Math.min(...top)
  const x0 = top.indexOf(roof)
  for (let k = 0; k < 4; k++) if (top[x0 + k] === roof) c.set(x0 + k, roof, PS)
  if (PAINT.has(c.get(x0, roof + 1))) c.set(x0, roof + 1, PS)
}

function buildBody(V) {
  const c = new Canvas(V.cw, V.ch)
  const p = new Pen(c)
  for (const poly of V.paint) p.poly(poly, PM)
  for (const e of eyesOf(V)) p.ellipse(e.cx, e.cy, e.rx, e.ry, PM)
  shadePaint(c, V)
  sparkle(c)
  V.detail(p)
  arches(p, V)
  c.outline(O)
  const b = c.bounds()
  if (b.x !== MX || b.y !== MT || b.w !== V.w || b.h > V.h) throw new Error(`${V.name}: the body is ${b.w}x${b.h} at ${b.x - MX},${b.y - MT}, its box is ${V.w}x${V.h}`)
  return c
}

/* ------------------------------------------------------------------ */
/* Faces                                                               */
/* ------------------------------------------------------------------ */

/// lid: rows of eyelid from the top; slant: above 0 the brows meet in a V (cross), below 0 they
// tip up in the middle (sad); pupil offset and size for the near eye. Every mouth is open and
// dark inside, or edged in white teeth, so it still reads at 1x on the darkest paint.
const FACES = {
  grump: { eyes: { lid: 4, slant: 1.8, px: -1, py: 2, pw: 3, ph: 3 }, mouth: 'grump' },
  sad: { eyes: { lid: 3, slant: -2, px: -1, py: 2, pw: 3, ph: 4 }, mouth: 'sad', tear: true },
  meh: { eyes: { lid: 4, slant: 0, px: -1, py: 2, pw: 3, ph: 3 }, mouth: 'flat' },
  shut: { eyes: { closed: 'droop' }, mouth: 'pout' },
  wide: { eyes: { lid: 0, slant: 0, px: 0, py: 0, pw: 2, ph: 2, tiny: true }, mouth: 'oh', grow: 1 },
  scrunch: { eyes: { closed: 'squeeze' }, mouth: 'wavy' },
  angry: { eyes: { lid: 4, slant: 2.6, px: -1, py: 2, pw: 3, ph: 3 }, mouth: 'grit' },
  yell: { eyes: { lid: 3, slant: 2.6, px: -1, py: 1, pw: 3, ph: 3 }, mouth: 'yell' },
  // Delight: smiling eyes (the cheeks push their bottoms up) looking up ahead, and a wide grin.
  happy: { eyes: { lid: 0, slant: 0, px: 0, py: -1, pw: 4, ph: 5, shine: true, cheek: 1 }, mouth: 'grin', blush: true, grow: 1 },
  joy: { eyes: { closed: 'up' }, mouth: 'laugh', blush: true, grow: 1 },
  up: { eyes: { lid: 0, slant: 0, px: 1, py: -2, pw: 3, ph: 4, shine: true, cheek: 1 }, mouth: 'smile', blush: true, grow: 1 },
  honk: { eyes: { closed: 'up' }, mouth: 'toot', blush: true, grow: 1 },
  // Nearly clean and still being washed: it has started to enjoy it.
  bliss: { eyes: { closed: 'content' }, mouth: 'content', blush: true },
  // Filthy and under the spray: worried eyes and chattering teeth (the water is cold).
  brr: { eyes: { lid: 3, slant: -1.6, px: -1, py: 1, pw: 2, ph: 3 }, mouth: 'chatter' },
}
const FACE_NAMES = Object.keys(FACES)

function drawEye(f, e, s) {
  const m = new Canvas(f.w, f.h)
  new Pen(m).ellipse(e.cx, e.cy, e.rx, e.ry, WHITE)
  const ring = m.clone().outline(O)
  for (let i = 0; i < f.d.length; i++) if (ring.d[i] === vO) f.d[i] = vO
  const p = new Pen(f)
  const inside = (x, y) => m.solid(x + MX, y + MT)

  if (s.closed === 'up') {
    // A laughing eye: the cheek pushes up from below, leaving a white arch with a dark rim.
    for (let x = e.cx - e.rx; x <= e.cx + e.rx; x++) {
      const u = (x - e.cx) / (e.rx + 0.5)
      const y = e.cy - 1 + Math.round(3.2 * u * u)
      for (let yy = e.cy - e.ry; yy < y; yy++) if (inside(x, yy)) p.set(x, yy, WHITE)
      if (inside(x, y)) p.set(x, y, O)
      if (inside(x, y + 1)) p.set(x, y + 1, O)
    }
    return
  }
  if (s.closed) {
    for (let x = e.cx - e.rx; x <= e.cx + e.rx; x++) {
      const u = (x - e.cx) / e.rx
      if (s.closed === 'squeeze') {
        // Squeezed shut: > on the far eye, < on the near one, two pixels thick.
        const d = e.near ? x - (e.cx - e.rx) : e.cx + e.rx - x
        const dy = Math.round(d * 0.7)
        for (const yy of [e.cy - dy, e.cy - dy + 1, e.cy + dy, e.cy + dy - 1]) if (inside(x, yy)) p.set(x, yy, O)
        continue
      }
      // Shut and drooping at the ends (a tired, dirty car), or a contented curve (a car enjoying its wash).
      const y = s.closed === 'content' ? e.cy + 2 - Math.round(2.2 * u * u) : e.cy + Math.round(1.8 * u * u)
      if (inside(x, y)) p.set(x, y, O)
      if (inside(x, y + 1)) p.set(x, y + 1, O)
    }
    return
  }

  for (let x = e.cx - e.rx; x <= e.cx + e.rx; x++) {
    const u = (x - e.cx) / e.rx
    const drop = s.lid + (e.near ? -s.slant * u : s.slant * u)
    const top = e.cy - e.ry + Math.round(Math.max(0, drop))
    // Smiling eyes: the cheek pushes the bottom of the eye up into a curve.
    const cheek = s.cheek ? Math.round(s.cheek * (1 - u * u)) : 0
    const bot = e.cy + e.ry - cheek
    for (let y = top; y <= bot; y++) if (inside(x, y)) p.set(x, y, WHITE)
    if (cheek > 0 && inside(x, bot + 1)) p.set(x, bot + 1, O)
    // The lid's edge is two pixels thick where it hangs low: a brow that reads at 1x.
    if (drop >= 0.5 && inside(x, top)) p.set(x, top, O)
    if (drop >= 2.5 && inside(x, top + 1)) p.set(x, top + 1, O)
  }
  const pw = e.near ? s.pw : Math.max(2, s.pw - 1)
  const ph = e.near || !s.shine ? s.ph : Math.max(2, s.ph - 1)
  const px = e.cx + Math.round((s.px * e.rx) / 3) - Math.floor(pw / 2)
  const py = e.cy + s.py - Math.floor(ph / 2)
  for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) if (p.get(x, y) === vWHITE) p.set(x, y, O)
  if (s.shine) {
    // Big round pupils with a catch light: the eyes of a car that is thrilled.
    if (pw >= 4) for (const [cx, cy] of [[px, py], [px + pw - 1, py], [px, py + ph - 1], [px + pw - 1, py + ph - 1]]) if (p.get(cx, cy) === vO) p.set(cx, cy, WHITE)
    if (p.get(px + 1, py + 1) === vO) p.set(px + 1, py + 1, WHITE)
  } else if (!s.tiny && p.get(px, py) === vO) p.set(px, py, WHITE)
}

const MOUTH = { dark: PAL.red[1], tongue: PAL.red[5] }

/**
 * A mouth along a curve across x0..x1: k above 0 pulls the corners down (a frown), below 0
 * up (a smile). `open` is how far it opens in the middle (0 = a closed line two pixels thick):
 * a smile opens downward from the curve, a frown upward. Teeth line the lip on the curve's
 * side; a tongue sits in the middle of the far side.
 */
function curvedMouth(f, x0, x1, ymid, k, open, { teeth = 0, tongue = false } = {}) {
  const t = new Canvas(f.w, f.h)
  const p = new Pen(t)
  const xm = (x0 + x1) / 2
  const half = (x1 - x0) / 2
  for (let x = x0; x <= x1; x++) {
    const u = (x - xm) / half
    const c = ymid + Math.round(k * u * u)
    const o = Math.round(open * (1 - u * u * u * u))
    if (o <= 0) {
      p.rect(x, c, 1, 2, O)
      continue
    }
    const top = k > 0 ? c - o : c
    const bot = k > 0 ? c : c + o
    for (let y = top; y <= bot; y++) {
      const fromLip = k > 0 ? bot - y : y - top
      let col = fromLip < teeth ? WHITE : MOUTH.dark
      if (tongue && Math.abs(u) < 0.45 && (k > 0 ? y - top : bot - y) < 2 && o >= teeth + 3) col = MOUTH.tongue
      p.set(x, y, col)
    }
  }
  t.outline(O)
  f.blit(t, 0, 0)
}

function drawMouth(f, V, kind) {
  const p = new Pen(f)
  const { x0, x1, y0, y1 } = V.mouth
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const ym = y0 + Math.floor(h / 2)
  const big = h >= 11
  const narrow = Math.max(4, Math.round(w * 0.3))
  if (kind === 'grump') curvedMouth(f, x0 + 1, x1 - 1, y1 - 4, 3, big ? 4 : 3, { teeth: 1 })
  else if (kind === 'sad') curvedMouth(f, x0 + 2, x1 - 2, y1 - 4, 3, big ? 5 : 4, { tongue: true })
  else if (kind === 'pout') curvedMouth(f, x0 + 3, x1 - 3, ym + 1, 2, 0)
  else if (kind === 'flat') {
    p.rect(x0 + 2, ym, w - 5, 2, O)
    p.rect(x1 - 3, ym + 1, 2, 2, O)
  } else if (kind === 'smile') curvedMouth(f, x0 + 1, x1 - 1, y0 + 3, -2, big ? 4 : 3, { teeth: 2 })
  else if (kind === 'wavy') {
    for (let x = x0 + 1; x <= x1 - 1; x++) p.rect(x, ym + ((x - x0) % 4 < 2 ? 0 : 1), 1, 2, O)
  } else if (kind === 'oh') {
    const r = Math.min(big ? 4 : 3, Math.floor(h / 2) - 1)
    const cx = x0 + 1 + narrow / 2
    const t = new Canvas(f.w, f.h)
    new Pen(t).ellipse(cx, ym, narrow / 2, r, MOUTH.dark)
    new Pen(t).rect(Math.round(cx) - 1, ym + r - 1, 2, 1, MOUTH.tongue)
    t.outline(O)
    f.blit(t, 0, 0)
  } else if (kind === 'grit') {
    const t = Math.max(4, Math.min(5, h - 3))
    p.rect(x0, ym - 2, w, t + 2, O)
    p.rect(x0 + 1, ym - 1, w - 2, t, WHITE)
    for (let x = x0 + 4; x < x1 - 1; x += 3) p.rect(x, ym - 1, 1, t, O)
    p.rect(x0 + 1, ym - 1 + Math.floor(t / 2), w - 2, 1, O)
  } else if (kind === 'chatter') {
    // A row of teeth with a wavy line between top and bottom: teeth chattering.
    const t = Math.max(4, Math.min(5, h - 4))
    const xa = x0 + 1
    const wa = w - 2
    p.rect(xa, ym - 2, wa, t + 2, O)
    p.rect(xa + 1, ym - 1, wa - 2, t, WHITE)
    for (let x = xa + 1; x < xa + wa - 1; x++) p.set(x, ym - 1 + Math.floor(t / 2) + ((x - xa) % 4 < 2 ? 0 : -1), O)
    for (let x = xa + 3; x < xa + wa - 2; x += 3) p.set(x, ym - 1, O)
  } else if (kind === 'yell') curvedMouth(f, x0 + 1, x1 - 1, y1 - 1, 1, Math.min(h - 3, big ? 8 : 6), { teeth: 1, tongue: true })
  // Delight: a wide grin whose corners turn up, teeth along the top, a round open bowl.
  else if (kind === 'grin') curvedMouth(f, x0, x1, y0 + 3, -2, Math.min(h - 5, big ? 8 : 6), { teeth: 2, tongue: true })
  else if (kind === 'content') curvedMouth(f, x0 + 2, x1 - 1, ym - 1, -2, big ? 3 : 2)
  else if (kind === 'laugh') curvedMouth(f, x0, x1, y0 + 2, -1, Math.min(h - 3, big ? 9 : 7), { teeth: 2, tongue: true })
  else if (kind === 'toot') {
    const r = Math.min(3, Math.floor(h / 2) - 1)
    const t = new Canvas(f.w, f.h)
    new Pen(t).ellipse(x0 + 4, ym, 2, r, MOUTH.dark)
    t.outline(O)
    f.blit(t, 0, 0)
    // The honk itself, ahead of the nose.
    const nx = Math.min(x0, V.eye.x - V.eye.rn - 2 * V.eye.rf - 3) - 3
    for (const [dx, dy, len] of [[0, -5, 4], [-1, 0, 5], [0, 5, 4]]) {
      for (let k = 0; k < len; k++) p.rect(nx + dx - k, ym + dy + Math.sign(dy) * Math.floor(k / 2), 1, 2, PAL.yellow[1])
    }
  }
}

function buildFace(V, name) {
  const spec = FACES[name]
  const f = new Canvas(V.cw, V.ch)
  const grow = spec.grow ?? 0
  for (const e of eyesOf(V, grow)) drawEye(f, e, spec.eyes)
  drawMouth(f, V, spec.mouth)
  const p = new Pen(f)
  if (spec.blush) p.rect(V.eye.x + V.eye.rn + 2 + 2 * grow, V.eye.y + V.eye.ry - 1, 3, 2, PAL.pink[0])
  if (spec.tear) {
    // A tear down the cheek behind the near eye.
    const tx = V.eye.x + V.eye.rn + 1
    const ty = V.eye.y + 1
    p.rect(tx, ty, 1, 2, PAL.teal[2])
    p.rect(tx, ty + 2, 2, 2, PAL.teal[1])
    p.set(tx, ty + 2, PAL.teal[2])
    p.rect(tx - 1, ty + 2, 1, 2, O)
    p.rect(tx + 2, ty + 2, 1, 2, O)
    p.rect(tx, ty + 4, 2, 1, O)
  }
  return f
}

/* ------------------------------------------------------------------ */
/* Dirt                                                                */
/* ------------------------------------------------------------------ */

// Each pixel of dirt has a kind and a grip (0..1). A stage shows the pixels whose grip is at
// least its threshold, so every stage is a subset of the one before: dirt only ever comes off.
const STAGE_GRIP = [9, 0.72, 0.38, 0]

function buildDirt(V, body, mirror = false) {
  const w = V.cw
  const h = V.ch
  const mat = new Uint8Array(w * h)
  const grip = new Float32Array(w * h)
  const rng = mulberry(V.name.length * 7919 + V.w * 31 + V.h)
  const R = (a, b) => a + (b - a) * rng()
  const RI = (a, b) => Math.floor(R(a, b + 1))

  // Where dirt may sit: on the body, off the outline, the wells and the face.
  const face = new Canvas(w, h)
  const fp = new Pen(face)
  for (const e of eyesOf(V)) fp.ellipse(e.cx, e.cy, e.rx + 1, e.ry + 1, WHITE)
  fp.rect(V.mouth.x0 - 1, V.mouth.y0 - 1, V.mouth.x1 - V.mouth.x0 + 3, V.mouth.y1 - V.mouth.y0 + 3, WHITE)
  const bed = V.bed
  const inBed = (x, y) => !!bed && x >= bed.x0 && x <= bed.x1 && y >= bed.y0 && y <= bed.y1 && !body.solid(x + MX, y + MT)
  const allow = (x, y) => {
    if (inBed(x, y)) return true
    const v = body.get(x + MX, y + MT)
    return v !== 0 && v !== vO && !face.solid(x + MX, y + MT)
  }
  const put = (x, y, m, g) => {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= V.w || y >= V.h || !allow(x, y)) return
    const i = (y + MT) * w + x + MX
    mat[i] = m
    grip[i] = Math.max(0.02, Math.min(0.99, g))
  }
  /** First and last row of body in a column. */
  const column = (x) => {
    let top = -1
    let bot = -1
    for (let y = 0; y < V.h; y++) {
      const v = body.get(x + MX, y + MT)
      if (v === 0) continue
      if (top < 0) top = y
      if (y <= V.bottom) bot = y
    }
    return { top, bot }
  }

  /** A lumpy blob. */
  const blob = (cx, cy, rx, ry, m, g) => {
    const parts = [[cx, cy, rx, ry], [cx + R(-rx, rx) * 0.6, cy + R(-ry, ry) * 0.5, rx * 0.7, ry * 0.7]]
    for (const [bx, by, brx, bry] of parts) {
      for (let y = Math.floor(by - bry); y <= Math.ceil(by + bry); y++) {
        for (let x = Math.floor(bx - brx); x <= Math.ceil(bx + brx); x++) {
          const dx = (x - bx) / (brx + 0.4)
          const dy = (y - by) / (bry + 0.4)
          if (dx * dx + dy * dy <= 1) put(x, y, m, g)
        }
      }
    }
  }

  /**
   * A coat over the lower body, from a ragged top edge down to the sill. Stage 2 keeps the
   * lower part, cut by channels where the water ran through; stage 1 keeps patches along the sill.
   */
  const film = (m, { from, x0 = 0, x1 = V.w - 1, rag = 1, step = 1, every = 9 }) => {
    let top = from
    let channel = RI(3, every)
    let cut = 0
    let patch = RI(2, 6)
    let keep = rng() < 0.5
    for (let x = x0; x <= x1; x++) {
      if ((x - x0) % step === 0) top = Math.max(from - 3 * rag, Math.min(from + 3 * rag, top + RI(-rag, rag)))
      if (--channel <= 0) {
        cut = RI(2, 4)
        channel = RI(5, every + 4)
      }
      const washed = cut-- > 0
      if (--patch <= 0) {
        keep = !keep
        patch = keep ? RI(4, 9) : RI(3, 6)
      }
      const col = column(x)
      if (col.bot < 0) continue
      const span = Math.max(1, col.bot - top)
      for (let y = Math.max(top, col.top); y <= col.bot; y++) {
        const depth = (y - top) / span
        let g = 0.2 + 0.5 * depth
        if (washed) g = depth > 0.82 ? 0.45 : 0.1 + 0.2 * depth
        else if (depth > 0.72 && keep) g = 0.8
        put(x, y, m, g + R(-0.03, 0.03))
      }
    }
  }

  /** Dust lying on whatever faces up: roof, hood, trunk. */
  const cap = (m, g0) => {
    let run = 0
    let deep = 0
    for (let x = 1; x < V.w - 1; x++) {
      if (--run <= 0) {
        deep = RI(0, 3)
        run = RI(3, 8)
      }
      const col = column(x)
      for (let k = 0; k < deep; k++) put(x, col.top + 1 + k, m, g0 + R(-0.15, 0.25) - k * 0.05)
    }
  }

  const splatter = (m, n, { low = 0.5, big = 4 } = {}) => {
    for (let i = 0; i < n; i++) {
      const x = R(2, V.w - 3)
      const col = column(Math.round(x))
      if (col.bot < 0) continue
      const t = Math.pow(rng(), low)
      const y = col.top + (col.bot - col.top) * t
      const r = R(1.2, big) * (0.5 + 0.5 * t)
      const g = R(0.05, 0.95)
      blob(x, y, r, r * R(0.6, 0.9), m, g)
      // A run below it.
      if (m === MUD && rng() < 0.5) for (let k = 0, n2 = RI(2, 5); k < n2; k++) put(x, y + r + k, m, g)
      // Fine spatter round it: the first thing to go.
      for (let k = 0; k < 3; k++) put(x + R(-r - 3, r + 3), y + R(-r - 3, r + 2), m, R(0.05, 0.36))
    }
  }

  const bugs = (n, reach) => {
    for (let i = 0; i < n; i++) {
      const front = rng() < 0.75
      const x = front ? 2 - Math.log(1 - rng() * 0.98) * reach : R(2, V.w - 4)
      if (x > V.w - 4) continue
      const col = column(Math.round(x))
      if (col.bot < 0) continue
      const y = R(col.top + 1, col.bot - 1)
      const g = Math.min(0.97, R(0.05, 0.8) + (front ? 0.15 : 0))
      const r = R(1, 2.4)
      blob(x, y, r, r * 0.8, BUG, g)
      // Blown back along the body.
      for (let k = 1, n2 = RI(2, 6); k <= n2; k++) put(x + r + k, y, BUG, g)
      put(x, y, BUGDOT, g)
      if (r > 1.6) put(x + 1, y, BUGDOT, g)
    }
  }

  const streaks = (m, n) => {
    for (let i = 0; i < n; i++) {
      const x = R(14, V.w - 12)
      const col = column(Math.round(x))
      if (col.bot < 0) continue
      const y = col.top + (col.bot - col.top) * (0.35 + 0.65 * rng())
      const len = RI(6, 20)
      const thick = RI(1, 3)
      const g = R(0.05, 0.95)
      for (let k = 0; k < len; k++) {
        const t = Math.max(1, Math.round(thick * (1 - k / len)))
        for (let j = 0; j < t; j++) put(x + k, y + j - Math.floor(t / 2), m, g)
      }
    }
  }

  /** What is heaped in a truck bed: shrinks as it is washed. */
  const pile = (m) => {
    if (!bed) return
    const xm = (bed.x0 + bed.x1) / 2 - 3
    const half = (bed.x1 - bed.x0) / 2
    const tall = bed.y1 - bed.y0 - 1
    for (let x = bed.x0; x <= bed.x1; x++) {
      const u = (x - xm) / half
      const top = bed.y1 - Math.round(tall * Math.max(0, 1 - u * u) * (0.85 + 0.15 * Math.sin(x * 1.3)))
      for (let y = top; y <= bed.y1; y++) put(x, y, m, 0.15 + 0.8 * ((y - top) / Math.max(1, bed.y1 - top)) * ((y - bed.y0) / (bed.y1 - bed.y0)))
    }
  }

  /** Grit in the dust: small lumps, a few of them hanging on to the end. */
  const grit = (n) => {
    for (let i = 0; i < n; i++) {
      const x = R(4, V.w - 5)
      const col = column(Math.round(x))
      if (col.bot < 0) continue
      const y = R(Math.max(col.top + 1, V.shadeY - 10), col.bot - 1)
      const g = R(0.1, 0.9)
      put(x, y, GRIT, g)
      put(x + 1, y, GRIT, g)
      if (rng() < 0.6) put(x, y + 1, GRIT, g)
      if (rng() < 0.4) put(x + 1, y + 1, GRIT, g)
    }
  }

  /**
   * Words a finger wrote in the dirt: the paint shows through them while the coat is whole
   * (stage 3). For a car facing right the renderer mirrors every layer, so the mirror-ready
   * dirt (`mirror`) carries the letters back to front, and they read the right way round.
   */
  const scrawl = (text, x0, y0, m) => {
    const t = new Canvas(V.w, V.h)
    const wide = t.text(x0, y0, text, WHITE)
    for (let y = y0 - 1; y <= y0 + 5; y++) for (let x = x0 - 2; x <= x0 + wide; x++) if (!mat[(y + MT) * w + x + MX] || grip[(y + MT) * w + x + MX] > 0.3) put(x, y, m, 0.3)
    let right = x0
    for (let y = 0; y < V.h; y++) for (let x = 0; x < V.w; x++) if (t.solid(x, y)) right = Math.max(right, x)
    for (let y = 0; y < V.h; y++) {
      for (let x = 0; x < V.w; x++) {
        if (!t.solid(x, y)) continue
        const xx = mirror ? x0 + right - x : x
        mat[(y + MT) * w + xx + MX] = 0
      }
    }
  }

  const belt = V.shadeY - 8
  if (V.dirt === 'dust') {
    film(DUST, { from: belt - 1, rag: 1, step: 2, every: 10 })
    cap(DUST, 0.45)
    splatter(DUST, 9, { low: 1.6, big: 3.5 })
    grit(26)
    scrawl('WASH', 32, 22, DUST)
  } else if (V.dirt === 'mud') {
    // Caked up the doors when it arrives; the top of the coat is the first to go.
    film(MUD, { from: V.shadeY - 7, rag: 2, step: 2, every: 8 })
    splatter(MUD, V.w > 90 ? 38 : 32, { low: 0.55, big: 4.5 })
    pile(MUD)
  } else if (V.dirt === 'bugs') {
    bugs(70, 22)
    film(DUST, { from: V.shadeY + 2, rag: 1, step: 3, every: 12 })
  } else if (V.dirt === 'tar') {
    film(TAR, { from: V.shadeY + 1, rag: 1, step: 3, every: 9 })
    streaks(TAR, 30)
    splatter(TAR, 8, { low: 0.6, big: 3 })
  } else if (V.dirt === 'salt') {
    film(SALT, { from: belt + 2, rag: 3, step: 3, every: 9 })
    for (let i = 0; i < 26; i++) {
      const x = RI(14, V.w - 4)
      const y = RI(4, belt + 2)
      const g = R(0.05, 0.7)
      put(x, y, SALT, g)
      put(x + 1, y, SALT, g)
      put(x, y + 1, SALT, g)
      put(x + 1, y + 1, SALT, g)
    }
    scrawl('WASH ME', 36, 41, SALT)
  } else {
    // The monster truck wears all of it.
    cap(DUST, 0.5)
    film(MUD, { from: V.shadeY - 3, rag: 2, step: 2, every: 9 })
    splatter(MUD, 26, { low: 0.5, big: 5 })
    bugs(26, 14)
    for (let i = 0; i < 9; i++) blob(R(70, V.w - 8), R(20, V.bottom - 2), R(2, 5), R(1.5, 3), SALT, R(0.1, 0.9))
    splatter(DUST, 6, { low: 1.4, big: 4 })
    pile(MUD)
  }
  return { mat, grip }
}

function renderDirt(V, maps, stage) {
  const c = new Canvas(V.cw, V.ch)
  const need = STAGE_GRIP[stage]
  const at = (x, y) => (x < 0 || y < 0 || x >= c.w || y >= c.h ? 0 : maps.grip[y * c.w + x] >= need ? maps.mat[y * c.w + x] : 0)
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const m = at(x, y)
      if (!m) continue
      const M = MATS[m]
      const above = at(x, y - 1) !== 0
      const below = at(x, y + 1) !== 0
      c.set(x, y, above === below ? M.base : below ? M.light : M.dark)
    }
  }
  // What stands clear of the body (the heap in a truck bed) needs its own outline.
  if (V.bed) {
    const p = new Pen(c)
    const b = V.bed
    for (let y = b.y0 - 1; y <= b.y1; y++) {
      for (let x = b.x0 - 1; x <= b.x1 + 1; x++) {
        if (p.solid(x, y) || V.body.solid(x + MX, y + MT)) continue
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const xx = x + dx
          const yy = y + dy
          return xx >= b.x0 && xx <= b.x1 && yy >= b.y0 && yy <= b.y1 && p.solid(xx, yy) && p.get(xx, yy) !== vO
        })
        if (near) p.set(x, y, O)
      }
    }
  }
  return c
}

/* ------------------------------------------------------------------ */
/* Glint, water, wheels, small things                                  */
/* ------------------------------------------------------------------ */

const GLINT_STEP = 10

/** A bright bar leaning across the paint and glass, at one place on its way from nose to tail. */
function buildGlint(V, i) {
  const c = new Canvas(V.cw, V.ch)
  const lit = new Set([...PAINT, rgba(GLASS.base), rgba(GLASS.low), rgba(GLASS.shine)])
  const at = -8 + i * GLINT_STEP
  for (let y = 0; y < V.h; y++) {
    for (let x = 0; x < V.w; x++) {
      if (!lit.has(V.body.get(x + MX, y + MT))) continue
      const k = x + Math.floor(y / 2) - at
      if ((k >= 0 && k < 4) || k === 6) c.set(x + MX, y + MT, WHITE)
    }
  }
  return c
}
const glintFrames = (V) => Math.ceil((V.w + V.h / 2 + 16) / GLINT_STEP)

const WET_FRAMES = 4
const WET_FALL = 3

/** Where the face lives (every face, grown ones too): water and dirt keep off it. */
function faceArea(V) {
  const c = new Canvas(V.cw, V.ch)
  const p = new Pen(c)
  for (const e of eyesOf(V, 1)) p.ellipse(e.cx, e.cy, e.rx + 1, e.ry + 1, WHITE)
  for (const e of eyesOf(V)) p.ellipse(e.cx, e.cy, e.rx + 1, e.ry + 1, WHITE)
  p.rect(V.mouth.x0 - 1, V.mouth.y0 - 1, V.mouth.x1 - V.mouth.x0 + 3, V.mouth.y1 - V.mouth.y0 + 3, WHITE)
  return c
}

/** Water running down the body: short bright runs, each stepping down from frame to frame. */
function buildWet(V, i) {
  const c = new Canvas(V.cw, V.ch)
  const rng = mulberry(V.w * 131 + V.h)
  const cycle = WET_FRAMES * WET_FALL
  const face = faceArea(V)
  // A run every few columns: enough to read as water sheeting off, sparse enough that the dirt and the paint still show.
  for (let x = 2; x < V.w - 2; x += 3 + Math.floor(rng() * 3)) {
    let top = -1
    let bot = -1
    for (let y = 0; y <= V.bottom; y++) {
      const v = V.body.get(x + MX, y + MT)
      if (v === 0 || v === vO) continue
      if (top < 0) top = y
      bot = y
    }
    const phase = Math.floor(rng() * cycle)
    const len = 3 + Math.floor(rng() * 3)
    if (top < 0 || bot - top < 6) continue
    for (let head = top - cycle + ((phase + i * WET_FALL) % cycle); head <= bot + len; head += cycle) {
      for (let k = 0; k < len; k++) {
        const y = head - k
        if (y < top || y > bot) continue
        const v = V.body.get(x + MX, y + MT)
        if (v === 0 || v === vO || face.solid(x + MX, y + MT)) continue
        c.set(x + MX, y + MT, k === 0 ? WHITE : k < 3 ? PAL.blue[4] : PAL.blue[3])
      }
    }
  }
  return c
}

const WHEELS = {
  16: { frames: 4, turn: Math.PI },
  20: { frames: 4, turn: Math.PI },
  44: { frames: 6, turn: Math.PI / 2 },
}

/** One wheel, turned by `angle`: a tyre, a hub and a bar across it (lugs and four spokes on the big one). */
function buildWheel(d, angle, dirty) {
  const c = new Canvas(d, d)
  const mid = (d - 1) / 2
  const R0 = d / 2
  const big = d >= 40
  const hubR = big ? 10.5 : d * 0.28
  const hub = dirty ? { base: PAL.mud[3], light: PAL.mud[4], dark: PAL.mud[1] } : { base: PAL.grey[4], light: PAL.grey[5], dark: PAL.grey[2] }
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const dx = x - mid
      const dy = y - mid
      const r = Math.hypot(dx, dy)
      const a = Math.atan2(dy, dx) - angle
      let edge = R0
      if (big) {
        // Twelve lugs.
        const lug = (((a / (Math.PI / 6)) % 1) + 1) % 1
        edge = lug < 0.5 ? R0 : R0 - 2.2
      }
      if (r > edge) continue
      let col
      if (r > edge - 1.15) col = O
      else if (r > hubR + 1) {
        // Rubber light enough to stand off a dark tunnel wall: a lit rim up and to the left, a
        // shaded one down and to the right, and mud flung round a dirty one.
        col = PAL.grey[2]
        if (r > edge - (big ? 5 : 3) && r < edge - (big ? 3 : 2) && dx + dy < -R0 * 0.5) col = PAL.grey[3]
        if (r > edge - (big ? 4 : 2.6) && dx + dy > R0 * 0.35) col = PAL.grey[1]
        if (big && r < hubR + 4) col = PAL.grey[1]
        if (dirty && ((Math.floor((a + 20) / 0.7) % 3 === 0 && r > edge - 4) || (big && Math.floor((a + 20) / 0.5) % 4 === 1 && r < edge - 6 && r > hubR + 5))) col = PAL.mud[2]
      } else if (r > hubR) col = O
      else {
        col = dx + dy < -hubR * 0.6 ? hub.light : hub.base
        const along = Math.abs(r * Math.sin(a))
        const across = Math.abs(r * Math.cos(a))
        const bar = along <= (big ? 1.6 : 0.95) || (big && across <= 1.6)
        if (bar) col = hub.dark
        if (r < (big ? 3 : 1.3)) col = big ? hub.light : O
        if (big && r < 1.4) col = O
      }
      c.set(x, y, col)
    }
  }
  return c
}

/** The pickup's mud ball, tumbling. */
function buildClod(i) {
  const base = Canvas.fromText(
    [
      '...oooo.....',
      '..ollmmoo...',
      '.ollmmmmmo..',
      'olmmmmmmmmo.',
      'ommmmmmddmo.',
      'ommmdmmmmdo.',
      'ommmmmmmddo.',
      '.ommmmmdddo.',
      '.oomddddoo..',
      '...ooooo....',
    ],
    { o: O, m: PAL.mud[2], l: PAL.mud[3], d: PAL.mud[1] },
  )
  const sq = new Canvas(12, 12)
  sq.blit(base, 0, 1)
  return sq.rot90(i)
}

/** A warning sign for the edge of the screen: something fast is coming from that side (it points right). */
function buildMark(lit) {
  const fill = lit ? PAL.yellow[1] : PAL.red[3]
  const edge = lit ? PAL.yellow[2] : PAL.red[5]
  const shade = lit ? PAL.yellow[0] : PAL.red[1]
  const ink = lit ? O : WHITE
  const c = new Canvas(MARK.w, MARK.h)
  c.poly([[2, 4], [3, 3], [19, 3], [29, 13], [29, 14], [19, 24], [3, 24], [2, 23]], fill)
  c.line(3, 4, 19, 4, edge)
  c.line(3, 4, 3, 23, edge)
  c.line(4, 23, 19, 23, shade)
  c.line(20, 22, 28, 14, shade)
  // A fat '!' and a chevron in the point: something is coming, from that side.
  c.rect(9, 7, 4, 10, ink)
  c.rect(9, 19, 4, 3, ink)
  for (const dy of [0, 1]) {
    c.line(20, 8 + dy, 24, 12 + dy, ink)
    c.line(20, 19 - dy, 24, 15 - dy, ink)
  }
  c.outline(O)
  return c
}
/** The warning sign's size and anchor (its middle); it points right. */
const MARK = { w: 32, h: 28, ax: 16, ay: 14 }

/** A four-point sparkle at four sizes. */
function buildTwinkle(i) {
  const c = new Canvas(9, 9)
  const arm = [0, 1, 2, 4][i]
  c.set(4, 4, WHITE)
  for (let k = 1; k <= arm; k++) {
    const col = k === arm && arm > 1 ? PAL.yellow[2] : WHITE
    c.set(4 - k, 4, col)
    c.set(4 + k, 4, col)
    c.set(4, 4 - k, col)
    c.set(4, 4 + k, col)
  }
  if (arm >= 2) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) c.set(4 + dx, 4 + dy, arm >= 4 ? WHITE : PAL.yellow[2])
  return c
}

/** A fly buzzing round the filthiest cars, wings up and down. */
function buildFly(i) {
  const rows = i === 0 ? ['w..w', '.oo.', '.oo.'] : ['....', 'woow', '.oo.']
  return Canvas.fromText(rows, { o: O, w: WHITE })
}

/* ------------------------------------------------------------------ */
/* Build everything                                                    */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('cars', { script: 'art-cars.mjs' })

/** Add a working canvas as a frame, cut down to its pixels, the anchor moved to match. */
function addLayer(name, canvas, V) {
  const t = canvas.trim()
  atlas.add(name, t.canvas, { ax: V.ax - t.x, ay: V.ay - t.y })
}

const swapFor = (paint) => {
  const ramp = PAINTS[paint]
  return { [PD]: ramp[0], [PM]: ramp[1], [PL]: ramp[2], [PS]: ramp[3] }
}
const dullFor = (paint) => {
  const ramp = DULL[paint]
  return { ...GRIMY, [PD]: ramp[0], [PM]: ramp[1], [PL]: ramp[2], [PS]: ramp[2] }
}

for (const V of Object.values(VARIANTS)) {
  V.body = buildBody(V)
  V.bodies = V.paints.map((paint) => V.body.clone().swap(swapFor(paint)))
  V.bodies.forEach((c, k) => addLayer(`${V.name}_p${k}`, c, V))
  V.dulls = V.paints.map((paint) => V.body.clone().swap(dullFor(paint)))
  V.dulls.forEach((c, k) => addLayer(`${V.name}_dull${k}`, c, V))
  const maps = buildDirt(V, V.body)
  V.dirts = [null, renderDirt(V, maps, 1), renderDirt(V, maps, 2), renderDirt(V, maps, 3)]
  for (let s = 1; s <= 3; s++) addLayer(`${V.name}_d${s}`, V.dirts[s], V)
  // Dirt with words in it gets a mirror-ready copy (letters back to front) for cars facing right.
  const mirrored = buildDirt(V, V.body, true)
  V.dirtsM = [null, renderDirt(V, mirrored, 1), renderDirt(V, mirrored, 2), renderDirt(V, mirrored, 3)]
  V.mirrorDirt = V.dirtsM.some((c, s) => c && c.d.some((v, i) => v !== V.dirts[s].d[i]))
  if (V.mirrorDirt) for (let s = 1; s <= 3; s++) addLayer(`${V.name}_d${s}m`, V.dirtsM[s], V)
  else V.dirtsM = V.dirts
  V.faces = Object.fromEntries(FACE_NAMES.map((f) => [f, buildFace(V, f)]))
  for (const f of FACE_NAMES) addLayer(`${V.name}_${f}`, V.faces[f], V)
  V.glints = Array.from({ length: glintFrames(V) }, (_, i) => buildGlint(V, i))
  V.glints.forEach((c, i) => addLayer(`${V.name}_g${i}`, c, V))
  atlas.anim(`${V.name}_glint`, V.glints.map((_, i) => `${V.name}_g${i}`))
  V.wets = Array.from({ length: WET_FRAMES }, (_, i) => buildWet(V, i))
  V.wets.forEach((c, i) => addLayer(`${V.name}_w${i}`, c, V))
  atlas.anim(`${V.name}_wet`, V.wets.map((_, i) => `${V.name}_w${i}`))
  // The flash of the moment it comes clean: the whole silhouette in white.
  addLayer(`${V.name}_flash`, V.body.mask(WHITE), V)
}

/**
 * Where the renderer squashes and stretches a car whole pixels at a time: rows are added or taken
 * out at one row of the box and columns at one column, so the art never smears. The row runs
 * through the middle of the mouth (a stretch opens it, a squash shuts it a little) and over the
 * wheel arches (the body rides up and down on its springs); the column is the one nearest the
 * middle that differs least from its neighbour, so a doubled column hardly shows.
 */
function squashLines(V) {
  const y = V.mouth.y0 + Math.floor((V.mouth.y1 - V.mouth.y0 + 1) / 2)
  let best = -1
  let bestScore = Infinity
  for (let x = Math.round(V.w * 0.35); x <= Math.round(V.w * 0.65); x++) {
    let score = 0
    for (let yy = 0; yy < V.h; yy++) if (V.body.get(x + MX, yy + MT) !== V.body.get(x - 1 + MX, yy + MT)) score++
    score += Math.abs(x - V.w / 2) * 0.05
    if (score < bestScore) {
      bestScore = score
      best = x
    }
  }
  return { x: best - V.w / 2, y: y - V.h }
}

const wheelArt = {}
for (const [d, spec] of Object.entries(WHEELS)) {
  const size = Number(d)
  wheelArt[d] = { c: [], d: [] }
  for (const kind of ['c', 'd']) {
    const names = []
    for (let i = 0; i < spec.frames; i++) {
      const c = buildWheel(size, (i * spec.turn) / spec.frames, kind === 'd')
      wheelArt[d][kind].push(c)
      atlas.add(`wheel${d}${kind}${i}`, c, { ax: size / 2, ay: size })
      names.push(`wheel${d}${kind}${i}`)
    }
    atlas.anim(`wheel${d}${kind}`, names)
  }
}

const clods = [0, 1, 2, 3].map(buildClod)
atlas.addAnim('clod', clods, { ax: 6, ay: 6 })
const marks = [buildMark(true), buildMark(false)]
atlas.addAnim('mark', marks, { ax: MARK.ax, ay: MARK.ay })
const twinkles = [0, 1, 2, 3].map(buildTwinkle)
atlas.addAnim('twinkle', twinkles, { ax: 4, ay: 4 })
const flies = [0, 1].map(buildFly)
atlas.addAnim('fly', flies, { ax: 2, ay: 1 })

atlas.meta({
  anchor: 'Every layer of a car carries the same anchor: the middle of its box on the ground line. Draw them all at (e.x + e.w / 2, e.y + e.h); the art faces left, so flipX when e.facing > 0. Wheels are anchored at the middle of their tread on the ground and are drawn unflipped at the mirrored place.',
  layers: 'body _p<k> (or _dull<k> from dirt stage dullFrom up), then dirt _d<stage> (stage = ceil(3 * hp / maxHp), none at 0; _d<stage>m when the car faces right and its variant has mirrorDirt), water _w<i>, glint _g<i>, the face, the white _flash of the wash, then the wheels.',
  variants: Object.fromEntries(
    Object.values(VARIANTS).map((V) => [
      V.name,
      {
        w: V.w,
        h: V.h,
        paints: V.paints,
        wheel: V.wheelD,
        // Wheel centres, in pixels from the middle of the box, facing left.
        wheelX: V.wheels.map((x) => x - V.w / 2),
        // Where the tailpipe is, from the anchor, facing left (x toward the tail, y up is negative).
        exhaust: { x: V.w / 2 - 2, y: -(V.h - V.bottom) - 2 },
        glint: V.glints.length,
        wet: WET_FRAMES,
        // The open bed, from the anchor (pickup and monster): where a wind-up can show.
        bed: V.bed ? { x: (V.bed.x0 + V.bed.x1) / 2 - V.w / 2, floor: V.bed.y1 - V.h } : null,
        // The row and column (from the anchor) where whole pixels are added or taken out to squash and stretch it.
        squash: squashLines(V),
        // Its dirt has words in it: a car facing right draws _d<stage>m (letters back to front) so they read once mirrored.
        mirrorDirt: !!V.mirrorDirt,
        // The middle of the near eye, from the anchor: flies and the like keep to the face.
        eye: { x: V.eye.x - V.w / 2, y: V.eye.y - V.h },
      },
    ]),
  ),
  dirtyBody: `<variant>_dull<k>: the body in paint k under road grime (darker paint, grey glass, dull chrome). Dirt stages ${DULL_FROM} and up wear it; stage 1 and a clean car wear _p<k>.`,
  dullFrom: DULL_FROM,
  wheels: Object.fromEntries(Object.entries(WHEELS).map(([d, s]) => [d, { frames: s.frames, stride: Math.round(((Number(d) * s.turn) / 2 / s.frames) * 100) / 100 }])),
  wheelNote: 'frame = floor(e.x / stride) mod frames, whichever way the car faces: the wheels then turn with the road.',
  faces: FACE_NAMES,
  dirt: Object.fromEntries(Object.values(VARIANTS).map((V) => [V.name, V.dirt])),
  ticks: { glint: 2, wet: 3, clod: 4, mark: 5, fly: 2 },
})

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write({ dir: ASSETS_DIR })
console.log(`cars atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames, ${fs.statSync(out.png).size} bytes`)

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

/** Set while composing cars for a mirrored sheet: they take the mirror-ready dirt, as the renderer does for a car facing right. */
let composeMirror = false

/** A car as the renderer stacks it. */
function compose(V, { paint = 0, stage = 0, face = 'happy', glint = -1, wet = -1, wheel = 0 } = {}) {
  const c = (stage >= DULL_FROM ? V.dulls : V.bodies)[paint].clone()
  if (stage > 0) c.blit((composeMirror ? V.dirtsM : V.dirts)[stage], 0, 0)
  if (wet >= 0) c.blit(V.wets[wet], 0, 0)
  if (glint >= 0) c.blit(V.glints[glint], 0, 0)
  c.blit(V.faces[face], 0, 0)
  const art = wheelArt[V.wheelD][stage >= 2 ? 'd' : 'c'][wheel % WHEELS[V.wheelD].frames]
  for (const cx of V.wheels) c.blit(art, MX + cx - V.wheelD / 2, MT + V.h - V.wheelD)
  return { canvas: c, ax: V.ax, ay: V.ay }
}

const STAGE_FACE = ['happy', 'meh', 'sad', 'grump']

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  // The lot's sky, and the wall of the wash tunnel (art-bg.mjs).
  const BGS = { sky: '#5cc8ff', tunnel: '#36414f' }
  const all = Object.values(VARIANTS)
  // `rows` may be a function: it is called again for the mirrored sheets, with the mirror-ready dirt.
  const save = (name, rows, opts) => {
    for (const [bgName, bg] of Object.entries(BGS)) {
      for (const flipX of [false, true]) {
        composeMirror = flipX
        const list = typeof rows === 'function' ? rows() : rows
        composeMirror = false
        for (const scale of [1, 3]) {
          contactSheet(list, { bg, flipX, scale, labels: scale > 1, ...opts, file: path.join(REVIEW, `${name}_${scale}x_${bgName}${flipX ? '_flip' : ''}.png`) })
        }
      }
    }
  }

  // Every variant, every stage, with the face that stage wears.
  save('stages', () => all.map((V) => ({ label: V.name, frames: [3, 2, 1, 0].map((stage) => ({ ...compose(V, { stage, face: STAGE_FACE[stage] }), label: `stage ${stage}` })) })), { wrap: 4 })
  // Every variant by dirt stage by face.
  for (const V of all) {
    save(
      `faces_${V.name}`,
      () => [3, 2, 1, 0].map((stage) => ({ label: `${V.name} stage ${stage}`, frames: FACE_NAMES.map((face) => ({ ...compose(V, { stage, face }), label: face })) })),
      { wrap: FACE_NAMES.length },
    )
  }
  // Every paint, dirty and clean.
  save('paints', () => all.map((V) => ({ label: V.name, frames: V.paints.flatMap((name, paint) => [{ ...compose(V, { paint, stage: 0, face: 'happy' }), label: name }, { ...compose(V, { paint, stage: 3, face: 'grump' }), label: `${name} dirty` }]) })), { wrap: 8 })
  // The overlays in motion.
  for (const V of all) {
    save(`fx_${V.name}`, () => [
      { label: `${V.name} glint`, frames: V.glints.map((_, glint) => ({ ...compose(V, { glint, face: 'happy' }), label: `g${glint}` })) },
      { label: `${V.name} wet`, frames: V.wets.map((_, wet) => ({ ...compose(V, { wet, stage: 2, face: wet % 2 ? 'scrunch' : 'wide' }), label: `w${wet}` })) },
      { label: `${V.name} wheels`, frames: Array.from({ length: WHEELS[V.wheelD].frames }, (_, wheel) => ({ ...compose(V, { wheel, face: 'happy' }), label: `turn ${wheel}` })) },
    ], { wrap: 20 })
  }
  // The life of each car as the renderer tells it: arriving filthy, startled, washed through its
  // stages, the flash, the joy, the honk, then clean and happy with the glint going over.
  const story = [
    ['grump', 3, {}],
    ['wide', 3, { wet: 0 }],
    ['brr', 3, { wet: 1 }],
    ['sad', 2, {}],
    ['brr', 2, { wet: 2 }],
    ['meh', 1, {}],
    ['bliss', 1, { wet: 3 }],
    ['joy', 0, {}],
    ['honk', 0, {}],
    ['happy', 0, { glint: 4 }],
    ['up', 0, {}],
  ]
  save('story', () => all.map((V, i) => ({ label: V.name, frames: story.map(([face, stage, o]) => ({ ...compose(V, { paint: (i + 1) % V.paints.length, stage, face, ...o }), label: `${face} ${stage}` })) })), { wrap: 11 })
  save('small', [
    { label: 'fly', frames: flies.map((canvas, i) => ({ canvas, ax: 2, ay: 1, label: `fly${i}` })) },
    { label: 'clod', frames: clods.map((canvas, i) => ({ canvas, ax: 6, ay: 6, label: `clod${i}` })) },
    { label: 'mark', frames: marks.map((canvas, i) => ({ canvas, ax: MARK.ax, ay: MARK.ay, label: `mark${i}` })) },
    { label: 'twinkle', frames: twinkles.map((canvas, i) => ({ canvas, ax: 4, ay: 4, label: `twinkle${i}` })) },
    ...Object.entries(wheelArt).flatMap(([d, art]) => ['c', 'd'].map((k) => ({ label: `wheel${d}${k}`, frames: art[k].map((canvas, i) => ({ canvas, ax: Number(d) / 2, ay: Number(d), label: `${i}` })) }))),
  ], { ground: false, wrap: 8 })

  // The whole cast on one road with Maxx, as the game will show them.
  const maxxSrc = fs.readFileSync(path.join(ASSETS_DIR, 'maxx.atlas.ts'), 'utf8')
  const m = /idle0: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+) \}/.exec(maxxSrc)
  const maxx = m ? { canvas: Canvas.load(path.join(ASSETS_DIR, 'maxx.png')).crop(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])), ax: Number(m[5]), ay: Number(m[6]) } : null
  for (const [bgName, bg] of Object.entries(BGS)) {
    for (const dirty of [true, false]) {
      const road = new Canvas(640, 2 * 130, bg)
      let x = 40
      let y = 120
      all.forEach((V, i) => {
        if (i === 4) {
          x = 40
          y = 250
        }
        const car = compose(V, { paint: i % V.paints.length, stage: dirty ? 3 : 0, face: dirty ? 'grump' : 'happy' })
        if (maxx && i % 4 === 0) {
          road.blit(maxx.canvas, x - maxx.ax, y - maxx.ay)
          x += 36
        }
        road.blit(car.canvas, x - MX, y - car.ay)
        // Maxx riding the clean ones: his feet on the top of the box.
        if (maxx && !dirty) road.blit(maxx.canvas.flipX(), x + V.w / 2 - (maxx.canvas.w - maxx.ax), y - V.h - maxx.ay)
        x += V.w + 26
      })
      road.rect(0, 120, 640, 10, PAL.grey[3])
      road.rect(0, 250, 640, 10, PAL.grey[3])
      road.save(path.join(REVIEW, `lineup_${dirty ? 'dirty' : 'clean'}_1x_${bgName}.png`))
      road.scale(3).save(path.join(REVIEW, `lineup_${dirty ? 'dirty' : 'clean'}_3x_${bgName}.png`))
    }
  }
  console.log(`review sheets in ${REVIEW}`)
}

// --dump <dir> variant:face:stage[:paint] ...   one composed car blown up with pixel rulers, for editing.
const dumpAt = process.argv.indexOf('--dump')
if (dumpAt > 0) {
  const dir = process.argv[dumpAt + 1]
  for (const spec of process.argv.slice(dumpAt + 2)) {
    if (spec.startsWith('--')) break
    const [name, face = 'happy', stage = '0', paint = '0'] = spec.split(':')
    const V = VARIANTS[name]
    if (!V) throw new Error(`--dump: no variant '${name}'`)
    const car = compose(V, { face, stage: Number(stage), paint: Number(paint) })
    // Cut to the box, so the rulers read in box pixels.
    rulerSheet(car.canvas.crop(MX, MT, V.w, V.h), { file: path.join(dir, `dump_${name}_${face}_${stage}.png`), scale: 8 })
  }
}
