// art-mudslinger.mjs: generates the 'mudslinger' atlas: MUDSLINGER, the jacked-up, mud-caked
// pickup that guards the end of MW04, and the pieces of its fight.
//
//   node scripts/maxx/art-mudslinger.mjs                  writes mudslinger.png + mudslinger.atlas.ts
//   node scripts/maxx/art-mudslinger.mjs --review <dir>   also writes contact sheets into <dir>: every
//       state of the fight as a strip (the layers stacked the way the renderer stacks them), the
//       layers on their own, the faces close up on a dirty and a clean truck, the projectiles; at
//       1x and 3x, on the storm sky and the mud floor, plain and mirrored; and a line-up beside Maxx
//
// The truck is drawn facing left, in layers that all share one anchor (the middle of its
// 136 x 88 collision box, on the ground line), so the renderer stacks them and mirrors the stack:
//   wheel<d><i>   a tyre, d = 'm' muddy or 'c' clean, i = 0..5 turning (15 degrees a frame);
//                 anchored at its hub. meta.wheels says where the hubs go.
//   body<s>       cab, hood, bumpers and lift kit; s = dirt stage 3 (caked) .. 0 (clean)
//   bed<s>_<a>    the bed and its load of mud, tipped up a = 0..3 steps about its back corner
//   face_<name>   headlight eyes bulging over the hood and a grille mouth (see FACES);
//                 face_<name>_b is the same face glancing back over its shoulder (open eyes only)
//   bar<n>        the light bar on the roof with n of its 3 lamps lit
//   vein, sweat<i>, honk<i>, dash<i>, beam<i>   extras the renderer adds by state (meta.spots)
//   clod<i>       the flung mud (18 x 18 round its 16 x 16 box, centre anchor), slab<i> the slop
//                 that slides out of the bed (76 x 22 round its 72 x 14 box, centre anchor),
//                 mark<i> the shadow where a clod will land, markw<i> the slop's wide one, and
//                 drop<i> the chevron bobbing over them (all on the surface they mark),
//                 puddle<i>, puddleDry (anchored on the floor's top edge)
//   doorHead, doorSlat, doorFoot   the shutter that drops over the arena's doorway
// Everything is in the master palette.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, rgba } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

/* ------------------------------------------------------------------ */
/* Sizes and colours                                                   */
/* ------------------------------------------------------------------ */

const BW = 136
const BH = 88
/** Room round the box in every working canvas: mud heaped on the roof, the bed tipped high, brows. */
const MX = 24
const MT = 40
const MB = 4
const CW = BW + 2 * MX
const CH = BH + MT + MB
const AX = MX + BW / 2
const AY = MT + BH

const WHEEL_R = 18
/** Hub x of the front and the back wheel in the box, facing left; hubs sit WHEEL_R above the ground. */
const WHEELS = [36, 106]
const WHEEL_Y = BH - WHEEL_R
const ARCH_R = 24

/** The bed: its box before it tips, and the corner it tips about. */
const BED = { x0: 82, x1: 134, y0: 24, y1: 44 }
const PIVOT = { x: 134, y: 44 }
const TIP_DEG = [0, 9, 19, 30]

const O = PAL.outline
const WHITE = PAL.grey[6]
const PAINT = { dark: PAL.blue[0], mid: PAL.blue[1], light: PAL.blue[2], shine: PAL.blue[3], glint: PAL.blue[4] }
const STRIPE = { light: PAL.grey[6], shade: PAL.grey[5] }
const CHROME = { dark: PAL.grey[2], mid: PAL.grey[3], light: PAL.grey[4], shine: PAL.grey[5] }
const RUBBER = { dark: PAL.grey[0], mid: PAL.grey[1], light: PAL.grey[2] }
const GLASS = { dark: PAL.navy, mid: PAL.blue[0], shine: PAL.blue[3] }
const MUD = { deep: PAL.mud[0], dark: PAL.mud[1], base: PAL.mud[2], light: PAL.mud[3], dry: PAL.mud[4] }
const SPRING = { dark: PAL.yellow[0], mid: PAL.yellow[1], light: PAL.yellow[2] }
const LAMP = { off: PAL.orange[0], offDark: PAL.red[1], on: PAL.yellow[2], hot: WHITE, rim: PAL.orange[1] }
const RED = PAL.red

const vPaint = new Set([PAINT.dark, PAINT.mid, PAINT.light, PAINT.shine, PAINT.glint, STRIPE.light, STRIPE.shade].map(rgba))
const vChrome = new Set([CHROME.dark, CHROME.mid, CHROME.light, CHROME.shine].map(rgba))
const vGlass = new Set([GLASS.dark, GLASS.mid, GLASS.shine].map(rgba))
/** How light a surface is under the mud (0 shadow .. 2 lit), so the mud keeps the truck's shape. */
const LIGHT = new Map([
  [PAINT.dark, 0],
  [CHROME.dark, 0],
  [PAINT.mid, 1],
  [STRIPE.shade, 1],
  [CHROME.mid, 1],
  [PAINT.light, 2],
  [PAINT.shine, 2],
  [PAINT.glint, 2],
  [STRIPE.light, 2],
  [CHROME.light, 2],
  [CHROME.shine, 2],
].map(([c, k]) => [rgba(c), k]))
/** Mud by lightness, -1 (in a crease) .. 3 (a dry crust catching the light). */
const MUD_TONE = [MUD.deep, MUD.dark, MUD.base, MUD.light, MUD.dry]

function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** A fixed scatter of pixels, the same every run. */
const hash = (x, y, k) => (((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 997

/** A canvas addressed in box coordinates: (0, 0) is the top-left of the collision box. */
class Pen {
  constructor(c = new Canvas(CW, CH)) {
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
  /** Every pixel of the working canvas, in box coordinates. */
  each(fn) {
    for (let y = -MT; y < BH + MB; y++) for (let x = -MX; x < BW + MX; x++) fn(x, y)
  }
}

/** A layer as an atlas frame: trimmed to what was drawn, the anchor kept on the box's ground middle. */
function frameOf(pen) {
  const { canvas, x, y } = pen.c.trim()
  return { canvas, ax: AX - x, ay: AY - y }
}

const inPaint = (v) => vPaint.has(v)

/* ------------------------------------------------------------------ */
/* Dirt: one field, so stage 1 sits inside stage 2 inside stage 3      */
/* ------------------------------------------------------------------ */

const splats = (() => {
  const r = mulberry(4404)
  const out = []
  for (let i = 0; i < 70; i++) out.push({ x: -4 + r() * 144, y: 4 + r() * 52, r: 3 + r() * 9, w: 0.5 + r() * 0.8 })
  // Thrown up by the tyres: heavy behind each wheel and along the sills.
  for (const wx of WHEELS) for (let i = 0; i < 8; i++) out.push({ x: wx + 6 + r() * 22, y: 38 + r() * 14, r: 4 + r() * 6, w: 1 })
  return out
})()

function dirtAt(x, y) {
  let f = (y - 18) / 40
  for (const s of splats) {
    const dx = x - s.x
    const dy = y - s.y
    const d = dx * dx + dy * dy
    if (d < s.r * s.r * 4) f += s.w * Math.exp(-d / (s.r * s.r))
  }
  return f
}
/** How much of the paint each stage hides (index = stage). */
const COVER = [0, 0.24, 0.52, 0.9]
/** Thresholds per stage, measured over the side of the body itself: the field is above it where there is mud. */
const DIRT_T = (() => {
  const c = new Pen()
  c.poly(SHELL_PTS(), PAINT.mid)
  const vals = []
  c.each((x, y) => {
    if (c.solid(x, y)) vals.push(dirtAt(x, y))
  })
  vals.sort((a, b) => b - a)
  return COVER.map((k) => (k <= 0 ? Infinity : vals[Math.floor(k * (vals.length - 1))]))
})()

/**
 * Coat every pixel of `pen` that `want(v)` accepts with mud where the field (sampled at
 * local(x, y)) is over the stage's threshold. The mud takes its shade from what it covers, so the
 * truck keeps its shape under it: lit tops, a crease, dark sills. Each patch gets a crust along
 * its top and a dark foot, drips run off it and a few flecks fly round it.
 */
function mudCoat(pen, stage, want, local = (x, y) => [x, y], seed = 1) {
  if (stage <= 0) return
  const T = DIRT_T[stage]
  const hit = new Map()
  pen.each((x, y) => {
    const v = pen.get(x, y)
    if (!want(v)) return
    const [lx, ly] = local(x, y)
    if (dirtAt(lx, ly) > T) hit.set(y * 1000 + x, LIGHT.get(v) ?? 1)
  })
  const has = (x, y) => hit.has(y * 1000 + x)
  for (const [k, light] of hit) {
    const y = Math.floor(k / 1000)
    const x = k - y * 1000
    let tone = light + 1
    if (!has(x, y - 1)) tone = Math.min(4, tone + 1)
    else if (!has(x, y + 1)) tone = Math.max(0, tone - 1)
    // Clumps: a lit lump with its shadow under it, sparse, on the thick of a patch.
    else if (stage >= 2 && has(x, y - 2) && has(x, y + 2) && hash(x, y, seed) < 22) tone = Math.min(4, tone + 1)
    else if (stage >= 2 && has(x, y - 3) && hash(x, y - 1, seed) < 22) tone = Math.max(0, tone - 1)
    pen.set(x, y, MUD_TONE[tone])
  }
  // Drips off the lower edge of each patch, over paint only.
  const r = mulberry(seed * 31 + stage)
  for (const k of hit.keys()) {
    const y = Math.floor(k / 1000)
    const x = k - y * 1000
    if (has(x, y + 1) || r() > 0.16 + stage * 0.05) continue
    const len = 1 + Math.floor(r() * (stage + 2))
    for (let j = 1; j <= len; j++) {
      if (!want(pen.get(x, y + j))) break
      pen.set(x, y + j, j === len ? MUD.dark : MUD.base)
    }
  }
  // Flecks thrown round the patches, mostly low down where the tyres fling them.
  if (stage <= 2) {
    pen.each((x, y) => {
      if (has(x, y) || !inPaint(pen.get(x, y)) || hash(x, y, seed + 7) > (y > 30 ? 60 : 25)) return
      let near = false
      for (let d = 2; d <= 4 && !near; d++) near = has(x - d, y) || has(x + d, y) || has(x, y - d) || has(x, y + d)
      if (near) pen.set(x, y, (LIGHT.get(pen.get(x, y)) ?? 1) >= 2 ? MUD.light : MUD.base)
    })
  }
}

/** Lumps of mud heaped on top of the shape, breaking its outline (stage 3 big, stage 2 small). */
function mudLumps(pen, stage, tops, seed) {
  if (stage < 2) return
  const r = mulberry(seed)
  for (const [x0, x1] of tops) {
    for (let x = x0; x <= x1; x += 4 + Math.floor(r() * 6)) {
      // The highest painted pixel of this column.
      let y = -MT
      while (y < BH && !pen.solid(x, y)) y++
      if (y >= BH) continue
      const rx = stage === 3 ? 3 + Math.floor(r() * 4) : 2 + Math.floor(r() * 2)
      const ry = stage === 3 ? 2 + Math.floor(r() * 2) : 1
      pen.ellipse(x, y, rx, ry, MUD.base)
      pen.ellipse(x - 1, y - ry, Math.max(1, rx - 2), 0, MUD.light)
      if (stage === 3) pen.set(x - 1, y - ry, MUD.dry)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Wheels                                                              */
/* ------------------------------------------------------------------ */

const WHEEL_FRAMES = 6
const WHEEL_STEP = 15

function wheel(muddy, frame) {
  const size = 2 * WHEEL_R + 4
  const c = new Canvas(size, size)
  const cx = size / 2 - 0.5
  const cy = size / 2 - 0.5
  const rot = frame * WHEEL_STEP
  const r = mulberry(muddy ? 9 : 3)
  const mudSpots = []
  for (let i = 0; i < 9; i++) mudSpots.push({ a: r() * 360, d: 6 + r() * 11, s: 2 + r() * 3 })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      // Turning anticlockwise for a truck going left, so the pattern turns that way with the frame.
      const a = (((Math.atan2(dy, dx) * 180) / Math.PI + rot) % 360 + 360) % 360
      const block = a % 30 < 17
      let col = 0
      if (d <= WHEEL_R - 0.5) {
        if (d > WHEEL_R - 4) col = block ? RUBBER.mid : RUBBER.dark
        else if (d > 10.5) {
          col = RUBBER.dark
          // A lit arc on the sidewall, top left.
          if (d > 12 && d < 13.4 && dx + dy < -6) col = RUBBER.light
        } else if (d > 9.5) col = CHROME.dark
        else {
          const spoke = a % 90 < 24
          col = spoke ? CHROME.dark : CHROME.mid
          if (!spoke && d > 6 && d < 8.5 && dx + dy < 0) col = CHROME.light
          if (d < 3.5) col = d < 1.8 ? CHROME.shine : CHROME.dark
        }
      } else if (d <= WHEEL_R + 0.9 && block) col = RUBBER.mid
      if (!col) continue
      c.set(x, y, col)
    }
  }
  if (muddy) {
    for (const s of mudSpots) {
      const a = ((s.a - rot) * Math.PI) / 180
      c.ellipse(Math.round(cx + Math.cos(a) * s.d), Math.round(cy + Math.sin(a) * s.d), s.s, s.s - 1, MUD.base)
    }
    // Caked low on the tyre where it sits in the muck: a ragged line, lit along its top.
    for (let x = 0; x < size; x++) {
      const line = Math.round(cy + 9 + Math.sin(x * 0.9 + frame) * 1.5)
      for (let y = line; y < size; y++) {
        if (!c.solid(x, y)) continue
        c.set(x, y, y === line ? MUD.light : y - cy > 14 ? MUD.dark : MUD.base)
      }
    }
  }
  c.outline(O)
  return { canvas: c, ax: Math.floor(size / 2), ay: Math.floor(size / 2) }
}

/* ------------------------------------------------------------------ */
/* The body: cab, hood, lift kit, bumpers                              */
/* ------------------------------------------------------------------ */

function SHELL_PTS() {
  return [
    [3, 26],
    [6, 25],
    [40, 23],
    [51, 8],
    [54, 6],
    [79, 6],
    [81, 8],
    [81, 44],
    [134, 44],
    [135, 46],
    [135, 52],
    [2, 52],
    [2, 27],
  ]
}
const SHELL = SHELL_PTS()
const WINDOW = [
  [56, 10],
  [77, 10],
  [77, 25],
  [47, 25],
]
const WINDSHIELD = [
  [41, 23],
  [52, 8],
  [55, 8],
  [45, 23],
]

function inArch(x, y, grow = 0) {
  for (const wx of WHEELS) {
    const dx = x - wx + 0.5
    const dy = y - WHEEL_Y + 0.5
    if (dx * dx + dy * dy <= (ARCH_R + grow) * (ARCH_R + grow)) return true
  }
  return false
}

function body(stage) {
  const p = new Pen()
  // The lift kit first, so the body sits over it: frame rail, drive shaft, shocks, springs.
  p.rect(14, 51, 112, 4, RUBBER.mid)
  p.rect(14, 51, 112, 1, RUBBER.light)
  p.line(40, 60, 100, 60, CHROME.dark, 2)
  for (const wx of WHEELS) {
    // Yellow lift springs and a shock, in the arch above the tyre.
    for (let y = 40; y <= 58; y += 3) {
      p.line(wx - 5, y, wx + 3, y + 1, SPRING.mid)
      p.set(wx - 5, y, SPRING.light)
      p.set(wx + 3, y + 1, SPRING.dark)
    }
    p.line(wx + 6, 42, wx + 9, 60, CHROME.mid, 2)
  }
  // The shell, cut away round the wheels.
  p.poly(SHELL, PAINT.mid)
  p.each((x, y) => {
    if (!inPaint(p.get(x, y))) return
    if (inArch(x, y)) p.set(x, y, 0)
  })
  // Shading: lit along every top edge, a crease along the shoulder, dark sills.
  p.each((x, y) => {
    const v = p.get(x, y)
    if (v !== rgba(PAINT.mid)) return
    const above = inPaint(p.get(x, y - 1))
    if (!above) p.set(x, y, y < 10 || x < 42 ? PAINT.shine : PAINT.light)
    else if (!inPaint(p.get(x, y - 2))) p.set(x, y, PAINT.light)
    else if (y >= 47) p.set(x, y, PAINT.dark)
    else if (y === 31 && x > 42) p.set(x, y, PAINT.light)
    else if (y === 32 && x > 42) p.set(x, y, PAINT.dark)
  })
  // Fender flares, black plastic, round both arches.
  p.each((x, y) => {
    if (!inPaint(p.get(x, y))) return
    if (inArch(x, y, 3)) p.set(x, y, inArch(x, y, 1.5) ? RUBBER.mid : RUBBER.light)
  })
  // The racing stripe along the door, and the hood scoop.
  for (let x = 45; x <= 80; x++) {
    for (let y = 35; y <= 38; y++) if (inPaint(p.get(x, y))) p.set(x, y, y === 38 ? STRIPE.shade : STRIPE.light)
  }
  p.poly([[30, 23], [33, 19], [38, 19], [39, 22]], PAINT.dark)
  p.rect(33, 20, 5, 1, PAINT.shine)
  // Glass.
  glass(p, WINDOW)
  glass(p, WINDSHIELD)
  // Door seams, handle, mirror.
  for (let y = 10; y <= 47; y++) {
    if (inPaint(p.get(46 - Math.floor(Math.max(0, 25 - y) * 0.6), y))) p.set(46 - Math.floor(Math.max(0, 25 - y) * 0.6), y, PAINT.dark)
    if (inPaint(p.get(79, y))) p.set(79, y, PAINT.dark)
  }
  p.rect(69, 29, 5, 1, CHROME.shine)
  p.rect(69, 30, 5, 1, O)
  p.rect(43, 17, 4, 4, CHROME.light)
  p.rect(43, 17, 4, 1, CHROME.shine)
  p.rect(46, 21, 1, 2, CHROME.dark)
  // The exhaust stack behind the cab, chrome, with a rain cap.
  p.rect(82, 2, 4, 42, CHROME.mid)
  p.rect(82, 2, 1, 42, CHROME.shine)
  p.rect(85, 2, 1, 42, CHROME.dark)
  p.rect(81, 0, 6, 2, CHROME.dark)
  p.rect(81, 0, 6, 1, CHROME.light)
  // Bumpers: a chunky one at the nose, a step at the tail.
  p.rect(-1, 49, 14, 6, CHROME.mid)
  p.rect(-1, 49, 14, 1, CHROME.shine)
  p.rect(-1, 50, 14, 1, CHROME.light)
  p.rect(-1, 54, 14, 1, CHROME.dark)
  p.rect(2, 52, 2, 1, RUBBER.dark)
  p.rect(128, 46, 9, 5, CHROME.mid)
  p.rect(128, 46, 9, 1, CHROME.shine)
  p.rect(128, 50, 9, 1, CHROME.dark)
  // Tow hook and a clearance lamp.
  p.rect(134, 51, 2, 3, CHROME.dark)
  p.rect(28, 42, 3, 2, LAMP.rim)
  p.rect(28, 42, 3, 1, LAMP.on)
  if (stage === 0) {
    // Clean: glints on the hood, the roof and the stripe.
    for (const [x, y] of [[9, 27], [10, 27], [60, 7], [61, 7], [62, 7], [100, 46], [50, 36], [51, 36]]) if (p.solid(x, y)) p.set(x, y, PAINT.glint)
  }
  mudCoat(p, stage, (v) => inPaint(v) || (stage >= 2 && vChrome.has(v)), undefined, 1)
  if (stage >= 2) windowMud(p, stage)
  p.c.outline(O)
  mudLumps(p, stage, [[6, 38], [56, 78]], 77)
  p.c.outline(O)
  return frameOf(p)
}

/** A window: dark tinted glass, a lighter foot, one streak of shine. */
function glass(p, pts) {
  p.poly(pts, GLASS.dark)
  const ys = pts.map((q) => q[1])
  const y1 = Math.max(...ys)
  p.each((x, y) => {
    if (p.get(x, y) !== rgba(GLASS.dark)) return
    if (y >= y1 - 2) p.set(x, y, GLASS.mid)
    else if ((x + y) % 19 === 3 || (x + y) % 19 === 4) p.set(x, y, GLASS.shine)
  })
  p.poly(pts, O, { fill: false })
}

/** Mud slapped over the side window, with a wiped arc to peer through (stage 3), or a splat (stage 2). */
function windowMud(p, stage) {
  p.each((x, y) => {
    if (!vGlass.has(p.get(x, y))) return
    const dx = x - 64
    const dy = y - 27
    const d = Math.sqrt(dx * dx + dy * dy)
    const wiped = d > 7 && d < 15 && dy < 0
    if (stage === 3 ? !wiped : dirtAt(x, y + 6) > 0.9) p.set(x, y, (x + y) % 9 === 0 ? MUD.light : MUD.base)
  })
}

/* ------------------------------------------------------------------ */
/* The bed, tipped about its back corner                               */
/* ------------------------------------------------------------------ */

/** Height of the heap of mud in the bed at local x (its top's y), or null where there is none. */
function heapTop(x) {
  if (x < BED.x0 + 2 || x > BED.x1 - 3) return null
  const t = (x - BED.x0) / (BED.x1 - BED.x0)
  const hump = Math.sin(t * Math.PI) * 9 + Math.sin(t * 11 + 1) * 2 + Math.sin(t * 23) * 1.2
  return Math.round(BED.y0 - 1 - Math.max(0, hump))
}

function bed(stage, step) {
  const p = new Pen()
  const a = (TIP_DEG[step] * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  // Local (untipped) point of a pixel: turn it back about the pivot.
  const local = (x, y) => {
    const dx = x + 0.5 - PIVOT.x
    const dy = y + 0.5 - PIVOT.y
    return [PIVOT.x + dx * cos + dy * sin, PIVOT.y - dx * sin + dy * cos]
  }
  p.each((x, y) => {
    const [lx, ly] = local(x, y)
    if (lx < BED.x0 || lx >= BED.x1 + 1 || ly >= BED.y1) return
    const fx = Math.floor(lx)
    const fy = Math.floor(ly)
    if (ly >= BED.y0) {
      let col = PAINT.mid
      if (fy <= BED.y0 + 1) col = fy === BED.y0 ? PAINT.shine : PAINT.light
      else if (fy >= 35 && fy <= 38) col = fy === 38 ? STRIPE.shade : STRIPE.light
      else if (fy >= BED.y1 - 3) col = PAINT.dark
      else if (fy === 31) col = PAINT.light
      else if (fy === 32) col = PAINT.dark
      // The tailgate's seam and its lamp.
      if (fx === BED.x1 - 6 && fy > BED.y0 + 1) col = PAINT.dark
      if (fx >= BED.x1 - 3 && fx <= BED.x1 - 1 && fy >= 27 && fy <= 33) col = fy === 27 ? RED[5] : fy === 33 ? RED[2] : RED[4]
      p.set(x, y, col)
      return
    }
    if (stage <= 0) return
    const top = heapTop(fx)
    if (top === null || fy < top) return
    let col = MUD.base
    if (fy === top) col = MUD.light
    else if ((fx * 5 + fy * 3) % 17 === 0) col = MUD.dark
    else if (fy === top + 1 && fx % 6 === 0) col = MUD.dry
    p.set(x, y, col)
  })
  mudCoat(p, stage, (v) => inPaint(v), local, 2)
  p.c.outline(O)
  return frameOf(p)
}

/* ------------------------------------------------------------------ */
/* Faces                                                               */
/* ------------------------------------------------------------------ */

// Headlight eyes that bulge up over the front of the hood, like a frog's: the far one (narrower,
// seen at a slant) at the nose, the near one behind it. inner: the way the other eye lies.
const EYES = [
  { cx: 8, cy: 25, rx: 4, ry: 9, inner: 1, near: false },
  { cx: 21, cy: 25, rx: 7, ry: 10, inner: -1, near: true },
]
const LID = CHROME.light
const LID_LIT = CHROME.shine

// open eyes: lid (share of the eye the top lid covers, at its middle), tilt (how much lower the lid
// sits at the inner corner: above 0 a scowl, below 0 a droop), low (a lower lid pushed up by a grin),
// look [x, y] (pupil offset; x is toward the nose), pw/ph (pupil size on the near eye), glow (lit
// headlights), brow [outer, inner] (how high each end sits over the eye's top; negative cuts into
// it), arch (the brow bows up in the middle).
// closed eyes: 'up' (laughing arcs), 'flat' (a blink), 'squeeze' (> <), 'x' (dizzy).
const FACES = {
  smug: { eyes: { lid: 0.42, tilt: 0.05, low: 0.12, look: [-2, 1], pw: 4, ph: 5, brow: [[3, 4], [1, 0]] }, mouth: 'smirk' },
  glee: { eyes: { lid: 0, tilt: 0, look: [-1, -1], pw: 3, ph: 3, brow: [[4, 6], [4, 6]], arch: 1 }, mouth: 'cackle' },
  angry: { eyes: { lid: 0.3, tilt: 0.55, look: [-2, 1], pw: 4, ph: 4, brow: [[4, -1], [4, -1]] }, mouth: 'grit' },
  glare: { eyes: { lid: 0.3, tilt: 0.55, look: [-2, 1], pw: 4, ph: 4, glow: true, brow: [[4, -1], [4, -1]] }, mouth: 'grit' },
  yell: { eyes: { lid: 0.12, tilt: 0.5, look: [-2, 0], pw: 3, ph: 3, glow: true, brow: [[5, 0], [5, 0]] }, mouth: 'roar' },
  dizzy: { eyes: { closed: 'x' }, mouth: 'wobble' },
  pant: { eyes: { lid: 0.48, tilt: -0.35, look: [-1, 3], pw: 4, ph: 4, brow: [[1, 5], [1, 5]] }, mouth: 'pant' },
  pant2: { eyes: { lid: 0.56, tilt: -0.35, look: [-1, 3], pw: 4, ph: 4, brow: [[1, 5], [1, 5]] }, mouth: 'pant2' },
  squeeze: { eyes: { closed: 'squeeze' }, mouth: 'sputter' },
  joy: { eyes: { closed: 'up' }, mouth: 'laugh' },
  happy: { eyes: { lid: 0, tilt: 0, low: 0.12, look: [-1, 0], pw: 4, ph: 6, shine: true, brow: [[4, 5], [4, 5]], arch: 1 }, mouth: 'smile' },
  blink: { eyes: { closed: 'flat' }, mouth: 'smile' },
  toot: { eyes: { closed: 'up' }, mouth: 'toot' },
}
/** Faces with open eyes also come glancing back over the shoulder (face_<name>_b). */
const LOOKS_BACK = Object.keys(FACES).filter((n) => !FACES[n].eyes.closed)

function inEye(e, x, y, grow = 0) {
  const dx = (x - e.cx) / (e.rx + 0.5 + grow)
  const dy = (y - e.cy) / (e.ry + 0.5 + grow)
  return dx * dx + dy * dy <= 1
}

/** The lid's lower edge (first row of open eye) at column x. */
function lidAt(e, spec, x) {
  const top = e.cy - e.ry
  const span = 2 * e.ry + 1
  const toInner = ((x - e.cx) * e.inner) / (e.rx + 0.5)
  return top + spec.lid * span + spec.tilt * toInner * e.ry * 0.9
}

function drawEye(p, e, spec, back) {
  const x0 = e.cx - e.rx - 2
  const x1 = e.cx + e.rx + 2
  const y0 = e.cy - e.ry - 2
  const y1 = e.cy + e.ry + 2
  // The rim, then a lid-grey bezel the eye sits in.
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inEye(e, x, y, 1) && !inEye(e, x, y)) p.set(x, y, O)
  if (spec.closed) {
    closedEye(p, e, spec.closed)
    return
  }
  const lit = !!spec.glow
  const ball = lit ? LAMP.on : WHITE
  const shade = lit ? SPRING.mid : CHROME.shine
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inEye(e, x, y)) continue
      // Lit from the top left: a crescent of shade low on the far side.
      const shaded = !inEye(e, x - 2, y - 2)
      p.set(x, y, shaded ? shade : ball)
    }
  }
  // The pupil, looking toward the nose (or back over its shoulder), with a glint.
  const pw = e.near ? spec.pw : Math.max(2, spec.pw - 1)
  const ph = spec.ph
  const lx = back ? -spec.look[0] : spec.look[0]
  const px = Math.round(e.cx + lx * (e.near ? 1 : 0.6) - pw / 2 + (e.near ? 0 : 0.5))
  const py = Math.round(e.cy + spec.look[1] - ph / 2 + 0.5)
  for (let y = py; y < py + ph; y++) {
    for (let x = px; x < px + pw; x++) if (inEye(e, x, y)) p.set(x, y, lit ? LAMP.rim : O)
  }
  if (lit) {
    if (inEye(e, px + 1, py + 1)) p.set(px + 1, py + 1, LAMP.off)
  }
  if (spec.shine || !lit) {
    p.set(px, py, WHITE)
    if (spec.shine && pw >= 4) p.set(px + 1, py, WHITE)
  }
  if (lit) {
    // A lamp blazing: rays out of the rim at the nose.
    p.set(e.cx - e.rx - 2, e.cy - 1, LAMP.hot)
    p.set(e.cx - e.rx - 3, e.cy - 1, LAMP.on)
    p.set(e.cx - e.rx - 2, e.cy + 2, LAMP.on)
  }
  // Lids: the top one down to its line (a dark edge under it), the lower one up from a grin.
  for (let x = x0; x <= x1; x++) {
    const edge = Math.round(lidAt(e, spec, x))
    for (let y = y0; y <= y1; y++) {
      if (!inEye(e, x, y)) continue
      if (y < edge - 1 && spec.lid > 0) p.set(x, y, y < e.cy - e.ry + 2 ? LID_LIT : LID)
      else if (y === edge - 1 && (spec.lid > 0 || spec.tilt !== 0)) p.set(x, y, O)
      if (spec.low) {
        const lowEdge = e.cy + e.ry - Math.round(spec.low * (2 * e.ry + 1)) + Math.round(Math.abs(x - e.cx) / 3)
        if (y > lowEdge) p.set(x, y, LID)
        else if (y === lowEdge) p.set(x, y, O)
      }
    }
  }
  // The brow: a thick dark bar over the eye, set by the mood.
  if (spec.brow) brow(p, e, spec.brow[e.near ? 1 : 0], spec.arch ?? 0)
}

function brow(p, e, [outer, inner], arch) {
  const thick = e.near ? 3 : 2
  const top = e.cy - e.ry - 1
  const xo = e.cx - e.inner * (e.rx + 2)
  const xi = e.cx + e.inner * e.rx
  const n = Math.abs(xi - xo)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = xo + e.inner * i
    // One smooth curve, rounded once, so the bar never breaks into steps.
    const bow = arch ? Math.sin(t * Math.PI) * 1.6 * arch : 0
    const yb = Math.round(top - (outer + (inner - outer) * t) - bow)
    // The outer tip tapers.
    for (let k = i === 0 ? 1 : 0; k < thick; k++) p.set(x, yb - k, O)
  }
}

function closedEye(p, e, kind) {
  for (let y = e.cy - e.ry - 1; y <= e.cy + e.ry + 1; y++) {
    for (let x = e.cx - e.rx - 1; x <= e.cx + e.rx + 1; x++) {
      if (!inEye(e, x, y)) continue
      p.set(x, y, kind === 'x' ? WHITE : y < e.cy - e.ry + 3 ? LID_LIT : LID)
    }
  }
  const r = e.rx
  const ink = (x, y) => {
    if (inEye(e, x, y)) p.set(x, y, O)
  }
  if (kind === 'up') {
    // A laughing arc, two pixels thick.
    for (let i = -r + 1; i <= r - 1; i++) {
      const lift = Math.round(Math.sqrt(Math.max(0, (r - 0.5) * (r - 0.5) - i * i)) * 0.9)
      ink(e.cx + i, e.cy + 2 - lift)
      ink(e.cx + i, e.cy + 3 - lift)
    }
  } else if (kind === 'flat') {
    for (let i = -r + 1; i <= r - 1; i++) {
      const sag = Math.abs(i) >= r - 2 ? 0 : 1
      ink(e.cx + i, e.cy + 1 + sag)
      ink(e.cx + i, e.cy + 2 + sag)
    }
  } else if (kind === 'squeeze') {
    // > < : the point toward the other eye.
    const h = Math.min(5, e.ry - 3)
    for (let k = 0; k <= h; k++) {
      const x = e.cx + Math.round(((r - 1) * e.inner * (h - k)) / h) - e.inner * Math.round((r - 1) / 2)
      for (const s of [-1, 1]) {
        ink(x, e.cy + s * k)
        ink(x - e.inner, e.cy + s * k)
      }
    }
  } else if (kind === 'x') {
    const h = Math.min(4, r - 1)
    for (let k = -h; k <= h; k++) {
      ink(e.cx + k, e.cy + k)
      ink(e.cx + k, e.cy - k)
      ink(e.cx + k + 1, e.cy + k)
      ink(e.cx + k + 1, e.cy - k)
    }
  }
}

// The grille is its mouth, between the eyes' feet and the bumper. Its back end is kept clear of the
// front wheel arch.
const MOUTH = { x0: 3, x1: 25, y0: 38, y1: 48 }

function drawMouth(p, kind) {
  const { x0, x1, y0, y1 } = MOUTH
  const w = x1 - x0
  /** Fill the dark between top(x) and bottom(x), rows of chrome teeth along its top (and foot). */
  const open = (top, bottom, teethTop, teethFoot, tongue) => {
    for (let x = x0; x <= x1; x++) {
      const a = top(x)
      const b = bottom(x)
      if (b < a) continue
      for (let y = a; y <= b; y++) p.set(x, y, O)
      const inside = x > x0 && x < x1
      for (let k = 1; k <= teethTop && inside && a + k < b; k++) p.set(x, a + k, (x - x0) % 4 === 0 ? CHROME.mid : k === 1 ? CHROME.shine : CHROME.light)
      for (let k = 1; k <= teethFoot && inside && b - k > a + teethTop; k++) p.set(x, b - k, (x - x0) % 4 === 0 ? CHROME.dark : CHROME.mid)
      if (tongue && inside) {
        const t = tongue(x)
        for (let y = Math.max(a + teethTop + 1, t); y < b - teethFoot; y++) p.set(x, y, y === t ? RED[5] : RED[3])
      }
    }
  }
  const sag = (depth, from = x0, to = x1) => (x) => Math.round(Math.sin(Math.min(1, Math.max(0, (x - from) / (to - from))) * Math.PI) * depth)
  switch (kind) {
    case 'smirk': {
      // Lopsided: a thin line at the nose that hooks up into a toothy grin at the back corner.
      for (let x = x0 + 1; x <= x1; x++) {
        const t = (x - x0) / w
        const mid = y0 + 6 - Math.round(t * t * 5)
        const th = 2 + Math.round(t * 3)
        const top = mid - Math.floor(th / 2)
        for (let y = top; y < top + th; y++) p.set(x, y, O)
        if (th >= 4 && x < x1) for (let y = top + 1; y < top + th - 1; y++) p.set(x, y, (x - x0) % 4 === 0 ? CHROME.mid : y === top + 1 ? CHROME.shine : CHROME.light)
      }
      p.set(x1 + 1, y0, O)
      p.set(x1 + 1, y0 - 1, O)
      break
    }
    case 'cackle':
    case 'laugh': {
      const deep = kind === 'laugh' ? 8 : 7
      open(() => y0 + 1, (x) => y0 + 3 + sag(deep)(x), 2, 0, (x) => y0 + 6 + Math.max(0, 3 - sag(deep)(x)))
      break
    }
    case 'grit': {
      // Gritted teeth: the grille clenched, upper and lower rows.
      for (let x = x0; x <= x1; x++) {
        for (let y = y0 + 1; y <= y0 + 8; y++) p.set(x, y, O)
        if (x === x0 || x === x1) continue
        const gap = (x - x0) % 4 === 0
        p.set(x, y0 + 2, gap ? CHROME.mid : CHROME.shine)
        p.set(x, y0 + 3, gap ? CHROME.mid : CHROME.light)
        p.set(x, y0 + 4, gap ? CHROME.dark : CHROME.light)
        p.set(x, y0 + 6, gap ? CHROME.dark : CHROME.light)
        p.set(x, y0 + 7, gap ? CHROME.dark : CHROME.mid)
      }
      break
    }
    case 'roar': {
      open(() => y0 - 1, (x) => y1 + 1 + Math.round(sag(1)(x)), 2, 2, () => y0 + 5)
      break
    }
    case 'pant':
    case 'pant2': {
      open(() => y0 + 2, (x) => y0 + 6 + sag(2)(x), 1, 0)
      // The tongue lolls out of the low corner, further on the second breath.
      const drop = kind === 'pant2' ? 7 : 4
      const tx = x0 + 3
      for (let y = y0 + 6; y <= y0 + 6 + drop; y++) {
        const end = y === y0 + 6 + drop
        for (let x = tx - 1; x <= tx + 5; x++) {
          const edge = x === tx - 1 || x === tx + 5 || end
          p.set(x, y, edge ? O : x === tx ? RED[5] : x === tx + 2 && y > y0 + 7 ? RED[2] : RED[4])
        }
      }
      break
    }
    case 'sputter':
    case 'wobble': {
      const f = kind === 'sputter' ? 1.2 : 0.75
      for (let x = x0 + 2; x <= x1 - 2; x++) {
        const y = y0 + 5 + Math.round(Math.sin((x - x0) * f) * 1.6)
        p.rect(x, y, 1, 2, O)
      }
      if (kind === 'sputter') {
        // Spluttering water back out.
        p.set(x0 - 2, y0 + 3, PAL.blue[3])
        p.set(x0 - 3, y0 + 5, PAL.blue[3])
        p.set(x0 - 1, y0 + 7, PAL.blue[3])
      }
      break
    }
    case 'smile': {
      // A wide grin of chrome teeth, its corners curled up.
      open(() => y0 + 2, (x) => y0 + 4 + sag(5)(x), 0, 0)
      for (let x = x0 + 2; x <= x1 - 2; x++) {
        const b = y0 + 4 + sag(5)(x)
        for (let y = y0 + 3; y < b - 1; y++) p.set(x, y, (x - x0) % 4 === 0 ? CHROME.light : y === y0 + 3 ? WHITE : CHROME.shine)
      }
      p.set(x0 - 1, y0 + 1, O)
      p.set(x1 + 1, y0 + 1, O)
      break
    }
    case 'toot': {
      p.ellipse(x0 + 9, y0 + 5, 3, 3, O)
      p.ellipse(x0 + 9, y0 + 5, 1, 1, RED[2])
      p.set(x0 + 8, y0 + 4, RED[4])
      break
    }
  }
}

function face(name, back = false) {
  const p = new Pen()
  const spec = FACES[name]
  for (const e of EYES) drawEye(p, e, spec.eyes, back)
  drawMouth(p, spec.mouth)
  return frameOf(p)
}

/* ------------------------------------------------------------------ */
/* Light bar, extras                                                   */
/* ------------------------------------------------------------------ */

function lightBar(n) {
  const p = new Pen()
  p.rect(56, 1, 22, 5, RUBBER.mid)
  p.rect(56, 1, 22, 1, RUBBER.light)
  p.rect(58, 5, 2, 1, RUBBER.dark)
  p.rect(74, 5, 2, 1, RUBBER.dark)
  for (let i = 0; i < 3; i++) {
    const x = 57 + i * 7
    const on = i < n
    p.rect(x, 2, 6, 3, on ? LAMP.on : LAMP.off)
    p.rect(x, 2, 6, 1, on ? LAMP.hot : LAMP.rim)
    p.rect(x, 4, 6, 1, on ? LAMP.rim : LAMP.offDark)
    if (on) {
      // A glare above a lit lamp.
      p.rect(x + 2, -1, 2, 1, LAMP.on)
      p.set(x + 1, -2, LAMP.on)
      p.set(x + 4, -2, LAMP.on)
    }
  }
  p.c.outline(O)
  return frameOf(p)
}

/** An anger mark popping on the hood: four thick red corners round a gap. */
function vein() {
  const c = new Canvas(13, 13)
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = 6 + sx * 2
    const y = 6 + sy * 2
    c.rect(Math.min(x, x + sx * 3), y, 4, 2, RED[4])
    c.rect(x, Math.min(y, y + sy * 3), 2, 4, RED[4])
    c.set(x + sx * 3, y, RED[5])
  }
  c.outline(O)
  return { canvas: c, ax: 6, ay: 6 }
}

function sweat(i) {
  const c = new Canvas(7, 10)
  c.ellipse(3, 6, 2, 2, PAL.blue[3])
  c.rect(3, 2 + i, 1, 3, PAL.blue[3])
  c.set(2, 5, WHITE)
  c.outline(O)
  return { canvas: c, ax: 3, ay: 9 }
}

/** Honk lines out ahead of the nose. */
function honk(i) {
  const c = new Canvas(14, 20)
  const out = i === 0 ? 0 : 2
  c.line(9 - out, 2, 5 - out, 5, WHITE, 2)
  c.line(11 - out, 10, 4 - out, 10, WHITE, 2)
  c.line(9 - out, 18, 5 - out, 15, WHITE, 2)
  c.outline(O)
  return { canvas: c, ax: 13, ay: 10 }
}

/** Speed lines trailing the tail in a charge. */
function dash(i) {
  const c = new Canvas(40, 40)
  const r = mulberry(50 + i)
  for (let k = 0; k < 5; k++) {
    const y = 4 + k * 8 + Math.floor(r() * 3)
    const len = 12 + Math.floor(r() * 18)
    const x = 2 + Math.floor(r() * (36 - len))
    c.rect(x, y, len, 1, k % 2 ? PAL.grey[5] : WHITE)
  }
  return { canvas: c, ax: 0, ay: 39 }
}

/** The headlights' beam while it revs: rays out of the eyes ahead of the nose. */
function beam(i) {
  const c = new Canvas(30, 24)
  // Three rays fanning out of the lamps, in dashes that march outward frame by frame.
  for (const end of [2, 12, 22]) {
    for (let x = 0; x <= 27; x++) {
      if ((x + i * 4) % 8 >= 5) continue
      const y = Math.round(12 + ((end - 12) * (27 - x)) / 27)
      c.rect(x, y, 1, 2, x > 18 ? LAMP.hot : LAMP.on)
    }
  }
  return { canvas: c, ax: 30, ay: 12 }
}

/* ------------------------------------------------------------------ */
/* Clods, shadows, puddles, the shutter                                */
/* ------------------------------------------------------------------ */

function clod(i) {
  const c = new Canvas(18, 18)
  const r = mulberry(11)
  const lumps = []
  for (let k = 0; k < 6; k++) lumps.push({ a: r() * Math.PI * 2, d: 3 + r() * 3, s: 2 + r() * 2 })
  c.circle(8.5, 8.5, 6, MUD.base)
  const turn = (i * Math.PI) / 2
  for (const l of lumps) c.circle(Math.round(8.5 + Math.cos(l.a + turn) * l.d), Math.round(8.5 + Math.sin(l.a + turn) * l.d), Math.round(l.s), MUD.base)
  // Lit top left, dark low right, a few pebbles turning with it.
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 18; x++) {
      if (!c.solid(x, y)) continue
      const k = x + y
      if (k < 11 && !c.solid(x - 1, y - 1)) c.set(x, y, MUD.light)
      else if (k > 22) c.set(x, y, MUD.dark)
    }
  }
  for (let k = 0; k < 3; k++) {
    const a = turn + k * 2.1
    c.set(Math.round(8.5 + Math.cos(a) * 3), Math.round(8.5 + Math.sin(a) * 3), k === 0 ? MUD.dry : MUD.deep)
  }
  c.set(6, 5, MUD.dry)
  c.outline(O)
  return { canvas: c, ax: 9, ay: 9 }
}

/**
 * The slop: the load of the bed sliding out as one wet slab (its box is 72 x 14), lumpy on top,
 * sagging and dripping at both ends; the second frame wobbles. Centre anchor.
 */
function slab(i) {
  const W = 76
  const H = 22
  const c = new Canvas(W, H)
  const wob = i ? 1 : 0
  const top = (x) => 4 + Math.round(Math.sin(x * 0.37 + i) * 1.2 + Math.sin(x * 0.13) * 1.5) + (x < 8 || x > W - 9 ? Math.round(Math.abs(x < 8 ? 8 - x : x - (W - 9)) * 0.7) : 0)
  const bottom = (x) => 16 + wob - (x < 6 || x > W - 7 ? Math.round(Math.abs(x < 6 ? 6 - x : x - (W - 7)) * 0.6) : 0)
  for (let x = 1; x < W - 1; x++) {
    const a = top(x)
    const b = bottom(x)
    for (let y = a; y <= b; y++) {
      let col = MUD.base
      if (y === a) col = MUD.light
      else if (y === a + 1 && (x * 7) % 11 === 0) col = MUD.dry
      else if (y >= b - 1) col = MUD.dark
      c.set(x, y, col)
    }
  }
  // Clumps riding on it, lit on top.
  for (const [x, r] of [[14, 3], [33, 4], [52, 3], [64, 2]]) {
    c.ellipse(x, top(x), r, 2, MUD.base)
    c.ellipse(x - 1, top(x) - 1, Math.max(1, r - 2), 0, MUD.light)
  }
  // Drips hanging off its belly.
  for (const [x, len] of [[9, 3 + wob], [24, 2], [41, 4 - wob], [58, 3], [68, 2 + wob]]) for (let y = bottom(x) + 1; y <= bottom(x) + len; y++) c.set(x, y, y === bottom(x) + len ? MUD.dark : MUD.base)
  c.outline(O)
  return { canvas: c, ax: W / 2, ay: 11 }
}

/**
 * The shadow of a falling clod: a dark pool ringed in warning orange that grows as the clod
 * comes; frame 4 is the full ring in yellow, for the blink before it lands. Its middle row is the
 * surface it lies on, so half of it sits on the floor's edge and half stands against the air.
 * wide: the slop's, 84 across instead of 40.
 */
function mark(i, wide = false) {
  const half = wide ? 42 : 20
  const c = new Canvas(2 * half + 6, 10)
  const rx = Math.round(half * [0.55, 0.7, 0.85, 1, 1][i])
  const cx = half + 2.5
  c.ellipse(cx, 5, rx + 1, 4, i === 4 ? PAL.yellow[2] : PAL.orange[1])
  c.ellipse(cx, 5, rx, 3, MUD.deep)
  c.ellipse(cx, 5, Math.max(3, rx - 7), 1, MUD.dark)
  c.outline(O)
  return { canvas: c, ax: half + 3, ay: 5 }
}

/** A warning chevron over a shadow, bobbing: something is coming down right here. */
function drop(i) {
  const c = new Canvas(13, 11)
  c.poly([[1, 1 + i], [6, 6 + i], [11, 1 + i], [11, 3 + i], [6, 8 + i], [1, 3 + i]], PAL.orange[1])
  c.line(2, 1 + i, 6, 5 + i, PAL.yellow[2])
  c.outline(O)
  return { canvas: c, ax: 6, ay: 10 }
}

/** Mud left on the floor: a glossy brown pool with a lip, a sheen sliding on it; then dry and cracked. */
function puddle(i) {
  const c = new Canvas(48, 10)
  c.ellipse(23.5, 5, 22, 4, MUD.deep)
  c.ellipse(23.5, 5, 21, 3, i < 2 ? MUD.dark : MUD.base)
  if (i < 2) {
    c.ellipse(23.5, 4, 18, 1, MUD.base)
    c.rect(9 + i * 7, 4, 9, 1, PAL.teal[0])
    c.rect(11 + i * 7, 3, 4, 1, PAL.teal[1])
    c.rect(30 - i * 5, 6, 6, 1, PAL.teal[0])
    c.set(37 - i * 3, 3, MUD.light)
    c.set(38 - i * 3, 3, MUD.light)
  } else {
    c.ellipse(23.5, 4, 18, 1, MUD.light)
    for (const x of [10, 19, 27, 34]) c.rect(x, 4, 1, 2, MUD.dark)
    c.set(15, 3, MUD.dark)
    c.set(31, 6, MUD.dark)
  }
  c.outline(O)
  return { canvas: c, ax: 24, ay: 5 }
}

function doorPiece(kind) {
  if (kind === 'head') {
    const c = new Canvas(34, 12)
    c.rect(1, 1, 32, 10, CHROME.dark)
    c.rect(1, 1, 32, 2, CHROME.mid)
    c.rect(1, 1, 32, 1, CHROME.light)
    c.rect(1, 9, 32, 2, RUBBER.mid)
    for (const x of [4, 29]) c.rect(x, 4, 2, 2, CHROME.shine)
    c.outline(O)
    return { canvas: c, ax: 17, ay: 1 }
  }
  if (kind === 'slat') {
    const c = new Canvas(32, 8)
    c.rect(0, 0, 32, 8, CHROME.mid)
    c.rect(0, 0, 32, 1, CHROME.shine)
    c.rect(0, 1, 32, 2, CHROME.light)
    c.rect(0, 6, 32, 1, CHROME.dark)
    c.rect(0, 7, 32, 1, RUBBER.mid)
    c.rect(0, 0, 1, 8, O)
    c.rect(31, 0, 1, 8, O)
    return { canvas: c, ax: 16, ay: 0 }
  }
  const c = new Canvas(32, 8)
  // The foot of the shutter: hazard stripes, the warning colours of the tunnel.
  for (let y = 0; y < 7; y++) for (let x = 0; x < 32; x++) c.set(x, y, Math.floor((x + y) / 4) % 2 ? RUBBER.dark : PAL.yellow[1])
  c.rect(0, 0, 32, 1, O)
  c.rect(0, 7, 32, 1, O)
  c.rect(0, 0, 1, 8, O)
  c.rect(31, 0, 1, 8, O)
  return { canvas: c, ax: 16, ay: 8 }
}

/* ------------------------------------------------------------------ */
/* The atlas                                                           */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('mudslinger', { script: 'art-mudslinger.mjs' })
const parts = new Map()
function put(name, f) {
  const bad = checkPalette(f.canvas)
  if (bad.length) throw new Error(`art-mudslinger: ${name} has colours outside the palette: ${JSON.stringify(bad)}`)
  atlas.add(name, f.canvas, { ax: f.ax, ay: f.ay })
  parts.set(name, f)
}

for (let s = 0; s <= 3; s++) put(`body${s}`, body(s))
for (let s = 0; s <= 3; s++) for (let a = 0; a < TIP_DEG.length; a++) put(`bed${s}_${a}`, bed(s, a))
for (const d of ['m', 'c']) for (let i = 0; i < WHEEL_FRAMES; i++) put(`wheel${d}${i}`, wheel(d === 'm', i))
for (const name of Object.keys(FACES)) put(`face_${name}`, face(name))
for (const name of LOOKS_BACK) put(`face_${name}_b`, face(name, true))
for (let n = 0; n <= 3; n++) put(`bar${n}`, lightBar(n))
put('vein', vein())
for (let i = 0; i < 2; i++) put(`sweat${i}`, sweat(i))
for (let i = 0; i < 2; i++) put(`honk${i}`, honk(i))
for (let i = 0; i < 3; i++) put(`dash${i}`, dash(i))
for (let i = 0; i < 2; i++) put(`beam${i}`, beam(i))
for (let i = 0; i < 4; i++) put(`clod${i}`, clod(i))
for (let i = 0; i < 2; i++) put(`slab${i}`, slab(i))
for (let i = 0; i < 5; i++) put(`mark${i}`, mark(i))
for (let i = 0; i < 5; i++) put(`markw${i}`, mark(i, true))
for (let i = 0; i < 2; i++) put(`drop${i}`, drop(i))
for (let i = 0; i < 2; i++) put(`puddle${i}`, puddle(i))
put('puddleDry', puddle(2))
put('doorHead', doorPiece('head'))
put('doorSlat', doorPiece('slat'))
put('doorFoot', doorPiece('foot'))

/** Box points (facing left) the extras are drawn at: the renderer reads these. */
const SPOTS = { beam: [3, 25], honk: [0, 43], vein: [34, 9], sweat: [3, 11], stack: [84, 0], tail: [138, 50] }

/** One whole truck the way the renderer stacks it. o: stage, tip, face, bar, wheel, dy (bob), hop, extras. */
function truck(o) {
  const c = new Canvas(CW + 40, CH + 20)
  const ox = 20
  const oy = 10
  const at = (name, x, y) => {
    const f = parts.get(name)
    c.blit(f.canvas, ox + x - f.ax, oy + y - f.ay)
  }
  const dy = (o.dy ?? 0) - (o.hop ?? 0)
  const w = o.stage > 0 ? 'm' : 'c'
  for (const wx of WHEELS) at(`wheel${w}${o.wheel ?? 0}`, MX + wx, MT + WHEEL_Y - (o.hop ?? 0))
  at(`body${o.stage}`, AX, AY + dy)
  at(`bed${o.stage}_${o.tip ?? 0}`, AX, AY + dy)
  at(`face_${o.face}`, AX, AY + dy)
  at(`bar${o.bar ?? 0}`, AX, AY + dy)
  for (const [name, spot, ddx = 0, ddy = 0] of o.extras ?? []) {
    const [bx, by] = SPOTS[spot]
    at(name, MX + bx + ddx, MT + by + dy + ddy)
  }
  return { canvas: c, ax: ox + AX, ay: oy + AY, label: o.label ?? '' }
}


atlas.anim('wheelMud', [...Array(WHEEL_FRAMES).keys()].map((i) => `wheelm${i}`))
atlas.anim('wheelClean', [...Array(WHEEL_FRAMES).keys()].map((i) => `wheelc${i}`))
atlas.anim('clod', ['clod0', 'clod1', 'clod2', 'clod3'])
atlas.anim('slab', ['slab0', 'slab1'])
atlas.anim('markWide', ['markw0', 'markw1', 'markw2', 'markw3', 'markw4'])
atlas.anim('mark', ['mark0', 'mark1', 'mark2', 'mark3', 'mark4'])
atlas.anim('puddle', ['puddle0', 'puddle1'])
atlas.anim('drop', ['drop0', 'drop1'])
atlas.anim('honk', ['honk0', 'honk1'])
atlas.anim('sweat', ['sweat0', 'sweat1'])
atlas.anim('dash', ['dash0', 'dash1', 'dash2'])
atlas.anim('beam', ['beam0', 'beam1'])
atlas.meta({
  box: { w: BW, h: BH },
  /** Hub x of the front and back wheel in the box (facing left) and their height above the ground. */
  wheels: WHEELS,
  wheelR: WHEEL_R,
  /** Degrees a wheel frame turns, and the pixels of road that is. */
  wheelStep: WHEEL_STEP,
  wheelStepPx: Math.round(((2 * Math.PI * WHEEL_R * WHEEL_STEP) / 360) * 100) / 100,
  tipDeg: TIP_DEG,
  faces: Object.keys(FACES),
  /** Faces that also come as face_<name>_b, glancing back toward the tail. */
  looksBack: LOOKS_BACK,
  spots: SPOTS,
})
const out = atlas.write()
console.log(`wrote ${path.relative(process.cwd(), out.png)} (${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames) and ${path.relative(process.cwd(), out.ts)}`)

/* ------------------------------------------------------------------ */
/* Review sheets                                                       */
/* ------------------------------------------------------------------ */

if (REVIEW) review()

function review() {
  fs.mkdirSync(REVIEW, { recursive: true })
  const rows = []
  const row = (label, frames) => rows.push({ label, frames: frames.map(truck) })
  row('WAIT AND INTRO: SMUG, HONK', [
    { stage: 3, face: 'smug', label: 'wait' },
    { stage: 3, face: 'smug_b', dy: 1, label: 'idle, eyeing maxx' },
    { stage: 3, face: 'glee', dy: -1, wheel: 2, label: 'rev taunt' },
    { stage: 3, face: 'toot', extras: [['honk0', 'honk']], label: 'honk' },
  ])
  row('TURN (HOP) AND TIP: THE VOLLEY TELL', [
    { stage: 3, face: 'smug', hop: 6, label: 'hop' },
    { stage: 3, face: 'glee_b', tip: 1, label: 'tip 1' },
    { stage: 3, face: 'glee_b', tip: 2, label: 'tip 2' },
    { stage: 3, face: 'glee_b', tip: 3, label: 'tip 3' },
    { stage: 3, face: 'glee_b', tip: 3, dy: 1, label: 'fling' },
    { stage: 3, face: 'smug_b', tip: 1, label: 'settle' },
  ])
  row('REV: THE CHARGE TELL (LAMPS COUNT DOWN)', [
    { stage: 3, face: 'angry', bar: 1, wheel: 0, dy: 1, label: 'rev 1' },
    { stage: 3, face: 'glare', bar: 2, wheel: 2, extras: [['beam0', 'beam']], label: 'rev 2' },
    { stage: 3, face: 'glare', bar: 3, wheel: 4, dy: 1, extras: [['beam1', 'beam']], label: 'rev 3' },
    { stage: 3, face: 'yell', wheel: 1, extras: [['dash0', 'tail']], label: 'charge' },
    { stage: 3, face: 'yell', wheel: 3, extras: [['dash1', 'tail']], label: 'charge' },
  ])
  row('BONK, SPENT, RECOVER, SPRAYED', [
    { stage: 3, face: 'dizzy', dy: 2, label: 'bonk' },
    { stage: 3, face: 'pant_b', label: 'spent' },
    { stage: 3, face: 'pant2_b', dy: 1, extras: [['sweat0', 'sweat']], label: 'spent' },
    { stage: 3, face: 'squeeze', label: 'sprayed' },
    { stage: 3, face: 'angry_b', dy: -1, label: 'recover' },
  ])
  row('CLEANER: STAGE 3 2 1, ANGRY HALF', [
    { stage: 3, face: 'angry', label: 'stage 3' },
    { stage: 2, face: 'angry', label: 'stage 2' },
    { stage: 2, face: 'yell', bar: 3, extras: [['vein', 'vein']], label: 'rage' },
    { stage: 1, face: 'glare', extras: [['vein', 'vein']], label: 'stage 1' },
    { stage: 1, face: 'pant_b', extras: [['vein', 'vein'], ['sweat1', 'sweat']], label: 'spent 1' },
  ])
  row('WASHED: CLEAN, HONK, HAPPY', [
    { stage: 0, face: 'joy', label: 'clean' },
    { stage: 0, face: 'toot', extras: [['honk1', 'honk']], label: 'honk' },
    { stage: 0, face: 'happy', label: 'happy' },
    { stage: 0, face: 'happy_b', label: 'happy, at maxx' },
    { stage: 0, face: 'blink', label: 'blink' },
  ])
  // The storm level's sky bands behind the truck, and its mud floor.
  const BGS = { sky: '#46686d', haze: '#82a39b', mud: '#6b4522', dark: '#1f3038' }
  for (const [bgName, bg] of Object.entries(BGS)) {
    for (const flipX of [false, true]) {
      for (const scale of [1, 3]) {
        if (scale === 1 && bgName === 'dark') continue
        contactSheet(rows, { bg, scale, flipX, labels: scale > 1, wrap: 6, file: path.join(REVIEW, `states_${scale}x_${bgName}${flipX ? '_flip' : ''}.png`) })
      }
    }
  }
  // Faces close up, on the caked truck and on the clean one.
  const faceRows = []
  for (const stage of [3, 1, 0]) {
    const names = [...Object.keys(FACES), ...LOOKS_BACK.map((n) => `${n}_b`)]
    faceRows.push({
      label: `FACES ON STAGE ${stage}`,
      frames: names.map((n) => {
        const t = truck({ stage, face: n })
        return { canvas: t.canvas.crop(t.ax - 74, t.ay - 104, 64, 70), ax: 32, ay: 69, label: n }
      }),
    })
  }
  for (const bg of ['#82a39b', '#46686d']) contactSheet(faceRows, { bg, scale: 4, wrap: 7, file: path.join(REVIEW, `faces_4x_${bg.slice(1)}.png`) })
  // The layers on their own.
  const lay = (label, names) => ({ label, frames: names.map((n) => ({ ...parts.get(n), label: n })) })
  const layers = [
    lay('BODY 3 2 1 0', ['body3', 'body2', 'body1', 'body0']),
    lay('BED STAGE 3 BY TIP', ['bed3_0', 'bed3_1', 'bed3_2', 'bed3_3']),
    lay('BED CLEAN BY TIP', ['bed0_0', 'bed0_1', 'bed0_2', 'bed0_3']),
  ]
  for (const bg of ['#46686d', '#6b4522']) contactSheet(layers, { bg, scale: 2, wrap: 4, file: path.join(REVIEW, `layers_2x_${bg.slice(1)}.png`) })
  const small = [
    lay('WHEELS', [...Array(WHEEL_FRAMES).keys()].map((i) => `wheelm${i}`).concat([...Array(WHEEL_FRAMES).keys()].map((i) => `wheelc${i}`))),
    lay('BAR AND EXTRAS', ['bar0', 'bar1', 'bar2', 'bar3', 'vein', 'sweat0', 'sweat1', 'honk0', 'honk1', 'beam0', 'beam1']),
    lay('CLOD SLOP MARK PUDDLE', ['clod0', 'clod1', 'clod2', 'clod3', 'slab0', 'slab1', 'mark0', 'mark1', 'mark2', 'mark3', 'mark4', 'markw0', 'markw2', 'markw4', 'drop0', 'drop1', 'puddle0', 'puddle1', 'puddleDry']),
    lay('SHUTTER', ['doorHead', 'doorSlat', 'doorFoot', 'dash0']),
  ]
  for (const bg of ['#46686d', '#6b4522', '#2e3038']) {
    for (const flipX of [false, true]) contactSheet(small, { bg, scale: 4, flipX, wrap: 16, file: path.join(REVIEW, `parts_4x_${bg.slice(1)}${flipX ? '_flip' : ''}.png`) })
  }
  // Beside Maxx, on the arena floor, a catwalk three tiles up.
  const maxxSheet = Canvas.load(path.join(ASSETS_DIR, 'maxx.png'))
  const maxxTs = fs.readFileSync(path.join(ASSETS_DIR, 'maxx.atlas.ts'), 'utf8')
  const m = /idle0: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+) \}/.exec(maxxTs)
  const scene = new Canvas(420, 200, '#82a39b')
  scene.rect(0, 0, 420, 90, '#46686d')
  scene.rect(0, 160, 420, 40, '#6b4522')
  scene.rect(0, 160, 420, 2, '#8a5f33')
  scene.rect(250, 64, 96, 6, PAL.grey[3])
  scene.rect(250, 64, 96, 1, PAL.grey[4])
  const t = truck({ stage: 3, face: 'smug' })
  scene.blit(t.canvas, 300 - t.ax + 60, 160 - t.ay)
  const t2 = truck({ stage: 0, face: 'happy' })
  scene.blit(t2.canvas.flipX(), 110 - (t2.canvas.w - t2.ax), 160 - t2.ay)
  if (m) {
    const [, x, y, w, h, ax, ay] = m.map(Number)
    const mx = maxxSheet.crop(x, y, w, h)
    scene.blit(mx, 215 - ax, 160 - ay)
    scene.blit(mx, 290 - ax, 64 - ay)
  }
  scene.save(path.join(REVIEW, 'lineup_1x.png'))
  scene.scale(3).save(path.join(REVIEW, 'lineup_3x.png'))
  console.log(`review sheets in ${REVIEW}`)
}
