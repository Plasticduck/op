// art-rivals-a.mjs: generates the 'rivals_a' atlas: secret rivals 1 and 2, BUCKET BILL and
// SIR STREAKS, and everything they throw (simulated in game/sim/entities/rival_bill.ts and
// rival_streaks.ts, drawn by game/render/entities/rivals_a.ts).
//
//   node scripts/maxx/art-rivals-a.mjs                  writes rivals_a.png + rivals_a.atlas.ts
//   node scripts/maxx/art-rivals-a.mjs --review <dir>   also writes contact sheets into <dir>:
//       every animation as a strip at 1x and 3x on the backlot's night colours, plain and
//       mirrored, and a line-up beside Maxx at 1x and 3x
//
// Everything is drawn from shapes and hand-placed pixels; nothing is traced. Both rivals face
// RIGHT (the renderer mirrors them) and are lit from the top left, outlined in Maxx's own
// warm near-black. Their bodies are sampled from shapes in their own body space, so a squash,
// a stretch or a tip forward is drawn fresh at every angle instead of turning pixels; the
// faces are hand-pixelled stamps laid on top, so they read at 1x in every pose.
//
// Frame names: '<who>_<pose><n>_<stage>' with stage 0 (filthy), 1, 2 (nearly clean), or 's'
// (spotless, the fall only). Animations: '<who>_<pose>_<stage>'. Every anchor is the middle of
// the feet on the ground line (soles on the row above it), as Maxx's.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, rgba } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const O = PAL.outline
const G = PAL.grey
const W = G[6]

/* ------------------------------------------------------------------ */
/* Little tools                                                        */
/* ------------------------------------------------------------------ */

/** A canvas filled by asking `fn` for the colour at each pixel's centre (0 or null = empty). */
function raster(w, h, fn) {
  const c = new Canvas(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x + 0.5, y + 0.5)
      if (v) c.set(x, y, v)
    }
  }
  return c
}

function inPoly(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Distance from a point to a segment. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function polyDist(pts, x, y) {
  let d = Infinity
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
  return d
}

function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Hand-placed pixels: one character per pixel from `legend`; '.' leaves what is there. Anchored at (x, y) top-left. */
function stamp(c, x, y, rows, legend, { flipX = false } = {}) {
  const w = Math.max(...rows.map((r) => r.length))
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch === '.' || ch === ' ') continue
      if (!(ch in legend)) throw new Error(`stamp: no colour for '${ch}'`)
      c.set(flipX ? x + w - 1 - i : x + i, y + j, legend[ch])
    }
  })
  return c
}

const stampW = (rows) => Math.max(...rows.map((r) => r.length))

/** Lay `top` over `base` with its own outline: every part keeps a dark edge where it crosses another. */
function layer(base, top, { outline = true, mode = 'over' } = {}) {
  if (outline) top.outline(O)
  base.blit(top, 0, 0, { mode })
  return base
}

/**
 * Body space to canvas and back. Body space: u to the right (the way he faces), v up, origin
 * at the pivot (ox, oy) on the canvas; squashed by (sx, sy), then tipped `rot` radians
 * clockwise (positive = his top goes forward).
 */
function frameOf({ ox, oy, rot = 0, sx = 1, sy = 1 }) {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return {
    toCanvas(u, v) {
      const a = u * sx
      const b = v * sy
      return [ox + a * c + b * s, oy - (-a * s + b * c)]
    },
    toBody(x, y) {
      const du = x - ox
      const dv = oy - y
      return [(du * c - dv * s) / sx, (du * s + dv * c) / sy]
    },
  }
}

/* ------------------------------------------------------------------ */
/* BUCKET BILL                                                         */
/* ------------------------------------------------------------------ */

const TIN = { spec: W, hi: G[5], mid: G[4], shade: G[3], dark: G[2], line: G[1] }
const SPONGE = { hi: PAL.yellow[2], mid: PAL.yellow[1], shade: PAL.yellow[0], pore: PAL.yellow[0] }
const RUBBER = { hi: PAL.orange[2], mid: PAL.orange[1], shade: PAL.orange[0] }
const SOCK = { hi: W, mid: G[5], stripe: PAL.green[2], stripeDark: PAL.green[1] }
const DIRT = { dark: PAL.mud[1], mid: PAL.mud[2], light: PAL.mud[3], rust: PAL.orange[0] }
const MUDWATER = { deep: PAL.mud[1], mid: PAL.mud[2], light: PAL.mud[3], foam: PAL.mud[4] }
const WAVE = { deep: PAL.mud[2], mid: PAL.mud[3], light: PAL.mud[4], foam: PAL.wood[8], foam2: PAL.wood[7], grime: PAL.mud[1] }

const BILL_W = 112
const BILL_H = 100
const BILL_AX = 56
const BILL_AY = 96
/** Bucket: bottom half-width, top half-width, height of the body below the rim's middle. */
const BUCKET = { hw0: 14.5, hw1: 20, h: 33 }
const LEG = 13

const hwAt = (v) => BUCKET.hw0 + ((BUCKET.hw1 - BUCKET.hw0) * Math.max(0, Math.min(BUCKET.h, v))) / BUCKET.h

// Where the dirt sits on him, in body space, so it stays put from frame to frame.
function dirtSpots(stage) {
  const r = seeded(7)
  const all = []
  for (let i = 0; i < 12; i++) all.push({ u: (r() * 2 - 1) * 17, v: 3 + r() * 27, r: 1.6 + r() * 2.8, rust: i % 5 === 3 })
  const keep = [12, 5, 2][stage] ?? 0
  return all.slice(0, keep)
}

/**
 * The bucket itself (body, ribs, dent, rim, what is inside), dirt and all, in body space.
 * inside: 'full' | 'empty' | 'slosh' | 'low'.
 */
function bucketColour(u, v, stage, inside, shine) {
  // The rim, seen a little from above: a ring round the opening.
  const rimV = BUCKET.h + 2.5
  const ex = u / (BUCKET.hw1 + 1.6)
  const ey = (v - rimV) / 3.4
  const inRim = ex * ex + ey * ey <= 1
  const ix = u / (BUCKET.hw1 - 0.6)
  const iy = (v - rimV - 0.3) / 2.1
  const inMouth = ix * ix + iy * iy <= 1
  if (inMouth) {
    if (inside === 'empty') return v > rimV + 0.6 ? TIN.dark : TIN.line
    if (inside === 'low') return v > rimV + 1.2 ? TIN.dark : MUDWATER.mid
    if (inside === 'slosh') return u < -4 ? MUDWATER.light : u < 8 ? MUDWATER.mid : MUDWATER.foam
    return v > rimV + 1 ? MUDWATER.light : MUDWATER.mid
  }
  if (inRim) return v > rimV + 1.5 ? TIN.mid : u < -8 ? TIN.spec : TIN.hi
  if (v < 0 || v > rimV) return 0
  let hw = hwAt(v)
  // The dent: a bite out of his back, low down.
  const dent = u < 0 && v > 9 && v < 19 ? Math.max(0, 2.3 - Math.abs(v - 14) * 0.45) : 0
  if (u < -hw + dent) return 0
  if (u > hw) return 0
  hw = Math.max(1, hw)
  const s = u / hw
  // Ribs pressed round the bucket: a light line over a dark one.
  for (const rv of [3]) {
    if (v >= rv && v < rv + 1) return s < 0.45 ? TIN.hi : TIN.shade
    if (v >= rv - 1 && v < rv) return s < 0.4 ? TIN.shade : TIN.dark
  }
  // The dent's shadow and its lit edge.
  if (dent > 0 && u < -hw + dent + 2.2) return u < -hw + dent + 1 ? TIN.dark : TIN.shade
  if (dent > 0 && u < -hw + dent + 3.2 && v > 12 && v < 17) return TIN.hi
  // Dirt.
  if (!shine) {
    for (const d of dirtSpots(stage)) {
      const dd = Math.hypot(u - d.u, (v - d.v) * 1.2)
      if (dd <= d.r) return d.rust ? (dd < d.r - 1 ? DIRT.rust : DIRT.mid) : dd < d.r - 1.2 ? DIRT.dark : DIRT.mid
    }
    // The tide mark of old dirty water round his foot.
    const tide = [6.5, 3.5, 0][stage] ?? 0
    if (v < tide + Math.sin(u * 0.9) * 1.2) return v < tide - 2 ? DIRT.dark : DIRT.mid
  }
  if (v < 1.2) return TIN.shade
  if (s < -0.78) return TIN.mid
  if (s > -0.62 && s < -0.5 && v > 3 && v < 31) return TIN.spec
  if (shine && s > -0.3 && s < -0.22 && v > 6 && v < 22) return TIN.spec
  if (s < -0.25) return TIN.hi
  if (s < 0.38) return TIN.mid
  if (s < 0.8) return TIN.shade
  return TIN.dark
}

/** The sponge hat, in its own frame (centre, size), tilted. Pores stay put. */
function spongeColour(u, v, stage) {
  const hw = 12.5
  const hh = 4.8
  const ax = Math.abs(u)
  const ay = Math.abs(v)
  // A soft block: rounded corners.
  if (ax > hw || ay > hh) return 0
  const cx = Math.max(0, ax - (hw - 2.5))
  const cy = Math.max(0, ay - (hh - 2.5))
  if (cx * cx + cy * cy > 6.5) return 0
  const pores = [[-8, 1], [-3, -1.5], [2, 1.5], [7, -0.5], [-6, -2.5], [5, 2.5], [10, 1.5], [-10, -1]]
  for (const [pu, pv] of pores) if (Math.abs(u - pu) < 1 && Math.abs(v - pv) < 0.8) return SPONGE.pore
  if (stage === 0 && Math.hypot(u - 4, v + 1) < 3) return MUDWATER.light
  if (stage <= 1 && Math.hypot(u + 7, v - 1.5) < 2.2) return MUDWATER.foam
  if (v > hh - 1.6) return SPONGE.hi
  if (v < -hh + 1.6 || u > hw - 1.5) return SPONGE.shade
  return SPONGE.mid
}

// Face stamps. K outline/pupil, W white, R mouth, P tongue, T tooth shade, B sweat.
const FACE_LEGEND = { K: O, W, w: G[5], R: PAL.red[0], P: PAL.red[5], p: PAL.red[4], B: PAL.blue[3], b: PAL.blue[4] }

/**
 * An eye as a stamp: an outlined white oval `w` wide and `h` tall, a pupil (px, py, pw, ph),
 * and a lid cut along lid(x) (rows above it show what is behind; the row on it is outline).
 * Bold and plain on purpose: at 1x anything fussier reads as a letter.
 */
function eyeOval(w, h, pupil, lid = null) {
  const rows = []
  for (let y = 0; y < h; y++) {
    let r = ''
    for (let x = 0; x < w; x++) {
      const corner = (y === 0 || y === h - 1) && (x === 0 || x === w - 1)
      const ly = lid ? Math.round(lid(x / (w - 1))) : -1
      if (corner || y < ly) r += '.'
      else if (y === ly || y === 0 || y === h - 1 || x === 0 || x === w - 1) r += 'K'
      else if (pupil && x >= pupil[0] && x < pupil[0] + pupil[2] && y >= pupil[1] && y < pupil[1] + pupil[3]) r += 'K'
      else r += 'W'
    }
    rows.push(r)
  }
  return rows
}
/** Two eyes, far then near: closed shapes drawn by hand, open ones from eyeOval. */
const pair = (far, near) => [far, near]
// Bill's eyes: the far one 7 wide, the near one 8, touching, 10 rows; pupils 2 x 4 like Maxx's.
const EYES = {
  open: pair(eyeOval(7, 10, [3, 3, 2, 4]), eyeOval(8, 10, [4, 3, 2, 4])),
  down: pair(eyeOval(7, 10, [3, 5, 2, 4]), eyeOval(8, 10, [4, 5, 2, 4])),
  wide: pair(eyeOval(7, 10, [3, 4, 2, 2]), eyeOval(8, 10, [3, 4, 2, 2])),
  blink: pair(['.......', '.......', '.......', '.......', '.......', '.......', 'KKKKKKK', '.KKKKK.', '.......', '.......'], ['........', '........', '........', '........', '........', '........', 'KKKKKKKK', '.KKKKKK.', '........', '........']),
  // Lids pressed down toward each other: cross, determined.
  angry: pair(eyeOval(7, 10, [3, 4, 2, 4], (k) => 1 + k * 3.2), eyeOval(8, 10, [3, 4, 2, 4], (k) => 4.2 - k * 3.2)),
  // Lids drawn up toward each other: worried.
  worried: pair(eyeOval(7, 10, [3, 4, 2, 4], (k) => 3.4 - k * 3), eyeOval(8, 10, [4, 4, 2, 4], (k) => 0.4 + k * 3)),
  // Each pupil off its own way: dizzy (the stars do the rest).
  dizzy: pair(eyeOval(7, 10, [1, 1, 2, 3]), eyeOval(8, 10, [5, 6, 2, 3])),
  happy: pair(['.......', '.......', '.......', '..KKK..', '.KK.KK.', 'KK...KK', 'K.....K', '.......', '.......', '.......'], ['........', '........', '........', '..KKKK..', '.KK..KK.', 'KK....KK', 'K......K', '........', '........', '........']),
  // Screwed shut: > <
  shut: pair(['.......', '.......', 'KK.....', '.KKK...', '...KKKK', '...KKKK', '.KKK...', 'KK.....', '.......', '.......'], ['........', '........', '......KK', '....KKK.', 'KKKK....', 'KKKK....', '....KKK.', '......KK', '........', '........']),
}

const MOUTHS = {
  grin: ['KKKKKKKKKKKKKKKK', 'KWWWWWWWWWWWWWWK', 'KwWWWWWWWWWWWWwK', '.KRRRRRRRRRRRRK.', '.KRRRRPPPPRRRRK.', '..KRRPPPPPPRRK..', '...KKKPPPPKKK...', '......KKKK......'],
  unsure: ['.............KK', '............K..', '.KKK.....KKKK..', 'K...KKKKK......'],
  o: ['.KKK.', 'KRRRK', 'KRRRK', 'KRPRK', '.KKK.'],
  bigO: ['..KKKK..', '.KRRRRK.', 'KRRRRRRK', 'KRRRRRRK', 'KRRPPRRK', '.KRPPRK.', '..KKKK..'],
  grit: ['.KKKKKKKKKKKKK.', 'KWWKWWWKWWWKWWK', 'KKKKKKKKKKKKKKK', 'KwwKwwwKwwwKwwK', '.KKKKKKKKKKKKK.'],
  puff: ['.KK........KK.', 'K..KKKKKKKK..K', '.KK........KK.'],
  bleah: ['KKKKKKKKKKKKKK', 'KRRRRRRRRRRRRK', 'KRRRRRRRRRRRRK', '.KRRRRRRRRRRK.', '..KKKPPPPKKK..', '....KPPpPK....', '....KPPPPK....', '.....KPPK.....', '......KK......'],
  wavy: ['.KK..KK..KK..KK.', 'K..KK..KK..KK..K'],
  tongue: ['KKKKKKKKKKK....', '.KRRRRRRRRKK...', '..KKKKPPPPPK...', '......KPPpPK...', '......KPPPPK...', '.......KKKK....'],
  sigh: ['.KK.', 'KRRK', 'KRRK', '.KK.'],
  yell: ['KKKKKKKKKKKKKKKK', 'KWWWWWWWWWWWWWWK', 'KRRRRRRRRRRRRRRK', 'KRRRRRRRRRRRRRRK', '.KRRRRPPPPRRRRK.', '..KRRPPPPPPRRK..', '...KKKKKKKKKK...'],
}

/**
 * A handle shape: the wire's four points over the face (outside the far eye, over it, over the
 * near eye, outside it), body space. It is his brow, so it does most of the acting.
 */
const BROWS = {
  cocky: [[-4, 29.5], [0, 30.6], [8, 28.6], [14, 26.4]],
  neutral: [[-4, 27.6], [0, 28.8], [9, 28.8], [14, 27.6]],
  angry: [[-4, 30.8], [1, 29.6], [5, 26.2], [9, 29.6], [14, 30.8]],
  worried: [[-4, 26], [1, 27.4], [5, 30.8], [9, 27.4], [14, 26]],
  up: [[-4, 29.8], [0, 31.4], [9, 31.4], [14, 29.8]],
  dizzy: [[-4, 31], [1, 30], [6, 27.4], [10, 29.4], [14, 27.6]],
}

/** Expressions: eyes, mouth, brow, and a bead of sweat when he is losing. */
const BILL_FACES = {
  cocky: { eyes: 'open', mouth: 'grin', brow: 'cocky' },
  unsure: { eyes: 'open', mouth: 'unsure', brow: 'worried', sweat: 1 },
  nervous: { eyes: 'worried', mouth: 'grit', brow: 'worried', sweat: 2 },
  blink: { eyes: 'blink', mouth: 'grin', brow: 'cocky' },
  blink1: { eyes: 'blink', mouth: 'unsure', brow: 'worried', sweat: 1 },
  blink2: { eyes: 'blink', mouth: 'grit', brow: 'worried', sweat: 2 },
  taunt: { eyes: 'happy', mouth: 'grin', brow: 'up' },
  determined: { eyes: 'angry', mouth: 'grit', brow: 'angry' },
  whee: { eyes: 'wide', mouth: 'bigO', brow: 'up' },
  oof: { eyes: 'shut', mouth: 'grit', brow: 'angry' },
  dig: { eyes: 'down', mouth: 'tongue', brow: 'neutral' },
  aim: { eyes: 'angry', mouth: 'grin', brow: 'angry' },
  yell: { eyes: 'angry', mouth: 'yell', brow: 'angry' },
  puff: { eyes: 'angry', mouth: 'puff', brow: 'angry' },
  bleah: { eyes: 'shut', mouth: 'bleah', brow: 'up' },
  dizzy: { eyes: 'dizzy', mouth: 'tongue', brow: 'dizzy' },
  washed: { eyes: 'shut', mouth: 'wavy', brow: 'worried' },
  brr: { eyes: 'shut', mouth: 'grit', brow: 'neutral' },
  bonk: { eyes: 'shut', mouth: 'o', brow: 'up' },
  sigh: { eyes: 'happy', mouth: 'sigh', brow: 'neutral', blush: true },
}

const SWEAT = ['.K.', 'KBK', 'KbK', '.K.']

/** Stage 0 cocky, 1 unsure, 2 nervous: the same pose wears a different face as he gets cleaner. */
const byStage = (a, b, c) => (stage) => [a, b, c][stage] ?? a

/**
 * One frame of Bill. Options:
 *   stage   0..2 dirt, or 's' spotless
 *   sx, sy  squash; rot tip forward (degrees); lift (pixels off the ground); dx nudge
 *   face    a BILL_FACES key
 *   inside  'full' | 'empty' | 'slosh' | 'low'
 *   legs    'stand' | 'crouch' | 'dangle' | 'reach' | 'brace' | 'wobble' | 'kick0' | 'kick1' | 'step'
 *   arms    'hips' | 'up' | 'wave' | 'brace' | 'reach' | 'wind' | 'throw' | 'flail' | 'out' | 'limp' | 'shake' | 'hold'
 *   hat     { du, dv, rot, sy }: the sponge off its seat
 *   pour    a stream of dirty water from the lip (its value is the animation step)
 *   upside  the fall: on his head
 */
function bill(opt) {
  const stage = opt.stage === 's' ? 2 : opt.stage
  const shine = opt.stage === 's'
  const rot = ((opt.rot ?? 0) * Math.PI) / 180
  const sx = opt.sx ?? 1
  const sy = opt.sy ?? 1
  const legs = opt.legs ?? 'stand'
  const legLen = { stand: LEG, crouch: 7, brace: 9, dangle: LEG + 2, reach: LEG, wobble: LEG, step: LEG }[legs] ?? LEG
  const upside = !!opt.upside
  const ground = BILL_AY - (opt.lift ?? 0)
  // The pivot is the middle of the bucket's foot, or of its rim when he is on his head.
  const ox = BILL_AX + (opt.dx ?? 0)
  const oy = ground - (upside ? 0 : legLen)
  const fr = frameOf({ ox, oy, rot, sx, sy })
  // On his head: body space turned over, so (u, v) still names the same spot on the bucket.
  const flip = (u, v) => (upside ? [-u, BUCKET.h + 5.5 - v] : [u, v])
  const at = (u, v) => fr.toCanvas(...flip(u, v))
  const c = new Canvas(BILL_W, BILL_H)

  const limb = (pts, thick, col, colHi) =>
    raster(BILL_W, BILL_H, (x, y) => {
      const d = polyDist(pts, x, y)
      if (d > thick / 2) return 0
      return colHi && d < thick / 2 - 1.2 ? colHi : col
    })

  // Legs (tube socks with a green stripe) and fat rubber boots.
  const feet = {
    stand: [-8, 8],
    step: [-11, 11],
    crouch: [-13, 13],
    brace: [-13, 14],
    dangle: [-6, 7],
    reach: [-12, 12],
    wobble: [-4, 11],
  }[legs]
  const drawLeg = (side, far) => {
    const [hx, hy] = at(side * 7, 1)
    let fx
    let fy
    if (upside) {
      // Legs up in a V, pedalling: one stretched, one tucked, then the other way round.
      const out = (legs === 'kick1') === side > 0
      fx = hx + side * (out ? 9 : 4)
      fy = hy - (out ? 17 : 13)
    } else if (legs === 'dangle' || legs === 'reach') {
      fx = hx + (legs === 'reach' ? side * 4 : side)
      fy = hy + legLen
    } else {
      fx = ox + feet[side < 0 ? 0 : 1]
      fy = ground - 3
    }
    const leg = limb([[hx, hy], [fx, fy]], 5, far ? SOCK.mid : SOCK.hi)
    const my = hy + (fy - hy) * 0.55
    leg.map((col, x, y) => (col && Math.abs(y + 0.5 - my) < 1.1 ? (far ? SOCK.stripeDark : SOCK.stripe) : col))
    layer(c, leg)
    const boot = raster(BILL_W, BILL_H, (x, y) => {
      if (upside) {
        // Sole to the sky (a dark band with a tread), toe pointing out.
        const bx = (x - (fx + side * 2)) * side
        const by = y - (fy - 2.5)
        const e = (bx / 6) ** 2 + (by / 3.6) ** 2
        if (e > 1 || by < -2.6) return 0
        if (by < -1.2) return Math.floor(bx + 9) % 3 === 0 ? RUBBER.shade : PAL.orange[0]
        return by < 1 && bx < 2 ? (far ? RUBBER.mid : RUBBER.hi) : far ? RUBBER.shade : RUBBER.mid
      }
      const bx = x - (fx + 2.5)
      const by = y - (fy + 0.5)
      const e = (bx / 6.4) ** 2 + (by / 3.6) ** 2
      if (e > 1 || by > 2.6) return 0
      if (by > 1.4) return RUBBER.shade
      return by < -1 && bx < 2.5 ? (far ? RUBBER.mid : RUBBER.hi) : far ? RUBBER.shade : RUBBER.mid
    })
    layer(c, boot)
  }

  // Arms: long orange rubber gloves from the shoulders, mittens at the end.
  const hands = {
    hips: [[-24, 7], [24, 7]],
    up: [[-27, 34], [27, 36]],
    wave: [[-27, 30], [30, 40]],
    brace: [[-22, 0], [23, 0]],
    reach: [[-6, 36], [24, 7]],
    wind: [[-25, 11], [12, 47]],
    throw: [[-27, 10], [34, 24]],
    flail: [[-30, 27], [29, 31]],
    out: [[-31, 20], [30, 5]],
    limp: [[-22, 1], [22, 1]],
    shake: [[-28, 29], [28, 29]],
    hold: [[-21, 32], [21, 32]],
  }[opt.arms ?? 'hips']
  const drawArm = (side, far) => {
    const [sxp, syp] = at(side * 18, 16)
    const h = hands[side < 0 ? 0 : 1]
    const [hx, hy] = at(h[0], h[1])
    const deep = opt.arms === 'reach' && side < 0
    // An elbow bowed outward a touch, so the arm is a curve, not a stick.
    const wind = opt.arms === 'wind' && side > 0
    const [mx, my] = deep ? at(-27, 30) : wind ? at(26, 33) : [(sxp + hx) / 2 + side * 2.5, (syp + hy) / 2 + 1.5]
    layer(c, limb([[sxp, syp], [mx, my], [hx, hy]], 4, far ? RUBBER.shade : RUBBER.mid))
    if (deep) return
    const mitt = raster(BILL_W, BILL_H, (x, y) => {
      const d = Math.hypot(x - hx, y - hy)
      if (d > 3.3) return 0
      return x < hx && y < hy ? (far ? RUBBER.mid : RUBBER.hi) : far ? RUBBER.shade : RUBBER.mid
    })
    layer(c, mitt)
    if (opt.holding && side > 0) layer(c, raster(BILL_W, BILL_H, (x, y) => spongeColour((x - hx) * 1.7, (hy - 4 - y) * 1.7, stage)))
  }

  drawLeg(-1, true)
  // Digging in himself, the far arm comes up his side and over the rim: it goes in front.
  if (opt.arms !== 'reach') drawArm(-1, true)

  const body = raster(BILL_W, BILL_H, (x, y) => {
    const [u, v] = flip(...fr.toBody(x, y))
    return bucketColour(u, v, stage, opt.inside ?? 'full', shine)
  })
  layer(c, body)
  drawLeg(1, false)
  if (opt.arms === 'reach') drawArm(-1, true)

  // The face, stamped upright wherever it lands: eyes, mouth, then the handle as brows.
  const face = BILL_FACES[opt.face ?? 'cocky']
  const fdy = opt.faceDy ?? 0
  let [ex, ey] = at(5, 21)
  let [mx, my] = at(5, 8.5)
  if (upside) {
    // Upside down the face stays the right way up: a cartoon has its priorities.
    ;[ex, ey] = at(5, 12)
    ;[mx, my] = [ex, ey + 11]
  }
  const eyeLeft = Math.round(ex - 7.5)
  const eyeTop = Math.round(ey - 5 + fdy)
  const er = EYES[face.eyes]
  stamp(c, eyeLeft, eyeTop, er[0], FACE_LEGEND)
  stamp(c, eyeLeft + 7, eyeTop, er[1], FACE_LEGEND)
  const mouth = MOUTHS[face.mouth]
  stamp(c, Math.round(mx - stampW(mouth) / 2 + 0.5), Math.round(my - mouth.length / 2 + fdy), mouth, FACE_LEGEND)
  if (face.blush) {
    // Pink with happiness.
    c.rect(eyeLeft - 1, eyeTop + 7, 3, 2, PAL.pink[0])
    c.rect(eyeLeft + 13, eyeTop + 7, 3, 2, PAL.pink[0])
  }

  // The handle: a wire flopped forward over his face, riveted to both sides of the rim.
  const lugs = [at(-20, 28), at(20, 28)]
  let browPts
  if (upside) {
    // On his head it hangs loose, lying on the floor behind him.
    const [bx] = at(-20, 28)
    browPts = [lugs[0], [bx - 6, ground - 3], [bx + 10, ground - 2], lugs[1]]
  } else {
    browPts = [lugs[0], ...BROWS[face.brow].map(([u, v]) => at(u, v)), lugs[1]].map(([x, y]) => [x, y + fdy])
  }
  // Thin wire out to the rivets; over the eyes a fat bar of bright wire in a dark outline, so
  // the brow reads at 1x on the tin: that part is his brow.
  const wire = raster(BILL_W, BILL_H, (x, y) => {
    const u = flip(...fr.toBody(x, y))[0]
    const d = polyDist(browPts, x, y)
    if (upside || u < -4.5 || u > 14.5) return d <= 0.75 ? O : 0
    if (d > 2.05) return 0
    return d > 1.05 ? O : G[5]
  })
  wire.map((col, x, y) => (col === rgba(G[5]) && wire.get(x, y - 1) === rgba(O) ? W : col))
  c.blit(wire, 0, 0)
  for (const [lx, ly] of lugs) layer(c, raster(BILL_W, BILL_H, (x, y) => (Math.hypot(x - lx, y - ly) <= 1.9 ? (x < lx && y < ly ? G[5] : G[3]) : 0)))
  if (face.sweat && !upside) {
    const [sx0, sy0] = at(-14, 31)
    stamp(c, Math.round(sx0), Math.round(sy0), SWEAT, FACE_LEGEND)
    if (face.sweat > 1) {
      const [sx1, sy1] = at(19, 22)
      stamp(c, Math.round(sx1), Math.round(sy1), SWEAT, FACE_LEGEND)
    }
  }

  // The sponge hat, cocked on the back of the rim (on the floor beside him after the fall).
  if (!opt.noHat) {
    const hat = opt.hat ?? {}
    let hf
    if (upside) hf = frameOf({ ox: ox + (hat.du ?? 22), oy: ground - 5.5, rot: ((hat.rot ?? 8) * Math.PI) / 180 })
    else {
      const [hx, hy] = at(-3 + (hat.du ?? 0), BUCKET.h + 8 + (hat.dv ?? 0))
      hf = frameOf({ ox: hx, oy: hy, rot: ((hat.rot ?? -10) * Math.PI) / 180 + rot, sy: hat.sy ?? 1 })
    }
    layer(c, raster(BILL_W, BILL_H, (x, y) => spongeColour(...hf.toBody(x, y), stage)))
  }

  drawArm(1, false)

  if (opt.pour) {
    // Dirty water spilling over the front lip in a fat, wobbling rope down to a splash.
    const [lx, ly] = at(BUCKET.hw1 + 0.5, BUCKET.h + 2.5)
    const floorY = ground - 1
    const ph = opt.pour
    const stream = raster(BILL_W, BILL_H, (x, y) => {
      if (y < ly - 1 || y > floorY) return 0
      const t = Math.max(0, (y - ly) / Math.max(1, floorY - ly))
      // Thrown out of the lip, then falling: out fast at first, then straight down.
      const cx = lx + 3 + Math.sqrt(t) * 12 + Math.sin(y * 0.45 + ph * 2) * 1.2
      const half = 3.2 + t * 2.6
      const d = x - cx
      // The splash where it hits the floor.
      if (y > floorY - 4) {
        const sd = Math.abs(x - (cx + 2))
        if (sd < 11 - (floorY - y)) return y > floorY - 1.5 ? MUDWATER.mid : sd > 4 ? MUDWATER.foam : MUDWATER.light
      }
      if (Math.abs(d) > half) return 0
      if (d < -half + 1.3) return MUDWATER.foam
      return Math.floor(y * 0.5 + ph * 2) % 3 === 0 ? MUDWATER.light : MUDWATER.mid
    })
    // A few flying drops.
    const drops = [[lx + 9, ly + 4], [lx + 15, ly + 12], [lx + 5, ly + 16]]
    for (let i = 0; i < drops.length; i++) {
      const [dx, dy] = drops[(i + ph) % drops.length]
      stream.rect(Math.round(dx + i * 2), Math.round(dy + i), 2, 2, i % 2 ? MUDWATER.foam : MUDWATER.light)
    }
    layer(c, stream)
  }
  return { canvas: c, ax: BILL_AX, ay: BILL_AY }
}

/** Each of Bill's poses: the options, per stage where they differ. */
const BILL_POSES = {
  idle: [
    { face: byStage('cocky', 'unsure', 'nervous') },
    { face: byStage('cocky', 'unsure', 'nervous'), sy: 0.96, sx: 1.03, hat: { dv: -0.5 } },
    { face: byStage('blink', 'blink1', 'blink2') },
  ],
  taunt: [
    { face: 'taunt', arms: 'wave', sy: 1.03, sx: 0.98, hat: { dv: 1, rot: -16 } },
    { face: 'taunt', arms: 'up', sy: 0.97, sx: 1.02, hat: { dv: 0, rot: -4 }, legs: 'step' },
  ],
  hopTell: [
    { face: 'determined', legs: 'crouch', arms: 'brace', sy: 0.86, sx: 1.08 },
    { face: 'determined', legs: 'crouch', arms: 'brace', sy: 0.8, sx: 1.13, dx: 1 },
  ],
  hop: [
    { face: 'whee', legs: 'dangle', arms: 'up', sy: 1.08, sx: 0.94, hat: { dv: 4, rot: -18 } },
    { face: 'whee', legs: 'reach', arms: 'flail', sy: 1.02, sx: 0.98, hat: { dv: 6, rot: -4 } },
  ],
  land: [
    { face: 'oof', legs: 'crouch', arms: 'out', sy: 0.78, sx: 1.16, hat: { dv: -1, rot: -6 } },
    { face: byStage('cocky', 'unsure', 'nervous'), legs: 'brace', arms: 'hips', sy: 0.93, sx: 1.04 },
  ],
  lobTell: [
    { face: 'dig', arms: 'reach', rot: -5, inside: 'full' },
    { face: 'dig', arms: 'reach', rot: -8, inside: 'slosh', dx: -1 },
  ],
  lob: [
    { face: 'aim', arms: 'wind', rot: -8, holding: true, legs: 'step' },
    { face: 'yell', arms: 'throw', rot: 7, legs: 'step' },
  ],
  sloshTell: [
    { face: 'puff', arms: 'hold', rot: -12, inside: 'slosh', legs: 'brace' },
    { face: 'puff', arms: 'hold', rot: -17, inside: 'full', legs: 'brace', dx: -1 },
  ],
  slosh: [
    { face: 'bleah', arms: 'out', rot: 34, inside: 'low', legs: 'step', pour: 1, hat: { dv: 2, rot: -30 } },
    { face: 'bleah', arms: 'out', rot: 38, inside: 'empty', legs: 'step', pour: 2, hat: { dv: 3, rot: -36 } },
  ],
  dizzy: [
    { face: 'dizzy', arms: 'limp', legs: 'wobble', rot: -7, inside: 'empty', hat: { dv: -1, rot: -24 } },
    { face: 'dizzy', arms: 'limp', legs: 'wobble', rot: 0, inside: 'empty', hat: { dv: -1, rot: -16 } },
    { face: 'dizzy', arms: 'limp', legs: 'wobble', rot: 7, inside: 'empty', hat: { dv: -1, rot: -8 } },
    { face: 'dizzy', arms: 'limp', legs: 'wobble', rot: 0, inside: 'empty', hat: { dv: -1, rot: -16 } },
  ],
  washed: [
    { face: 'washed', arms: 'flail', legs: 'stand', rot: -4, sy: 0.95, sx: 1.04, inside: 'empty', hat: { dv: 0, rot: -20 } },
    { face: 'washed', arms: 'shake', legs: 'stand', rot: 4, sy: 0.97, sx: 1.02, inside: 'empty', hat: { dv: 1, rot: -12 } },
  ],
  recover: [
    { face: 'brr', arms: 'shake', rot: -4, inside: 'low', hat: { dv: 1, rot: -4 } },
    { face: 'brr', arms: 'shake', rot: 4, inside: 'full', hat: { dv: 2, rot: -14 } },
  ],
  flinch: [{ face: 'washed', arms: 'flail', sy: 0.95, sx: 1.04, rot: -3 }],
  bonk: [{ face: 'bonk', sy: 0.88, sx: 1.07, hat: { dv: -3, rot: 0, sy: 0.6 }, arms: 'out' }],
}

/** The fall: on his head, legs kicking, spotless, sighing happily. */
const BILL_BEATEN = [
  { face: 'sigh', upside: true, legs: 'kick0', arms: 'out', inside: 'empty', hat: { du: 24, rot: 8 } },
  { face: 'sigh', upside: true, legs: 'kick1', arms: 'out', inside: 'empty', hat: { du: 24, rot: 8 } },
]

/* ------------------------------------------------------------------ */
/* SIR STREAKS                                                         */
/* ------------------------------------------------------------------ */

const STEEL = { spec: W, hi: G[5], mid: G[4], shade: G[3], dark: G[2] }
const TABARD = { hi: PAL.teal[2], mid: PAL.teal[1], shade: PAL.teal[0] }
const GOLD = { hi: PAL.yellow[2], mid: PAL.yellow[1], shade: PAL.yellow[0] }
const SKIN = { hi: PAL.wood[7], mid: PAL.wood[6], shade: PAL.wood[5], dark: PAL.wood[3] }
const RUBBER_BLADE = { mid: G[1], hi: G[2] }
const BOTTLE = { hi: PAL.blue[4], mid: PAL.blue[3], shade: PAL.blue[2], cap: G[6], capShade: G[4] }
const GRIME = { dark: PAL.mud[1], mid: PAL.mud[2], light: PAL.mud[3] }

const SK_W = 132
const SK_H = 120
const SK_AX = 66
const SK_AY = 116

/** Where the grime streaks sit on his armour, in each part's own space, so they stay put. */
function smears(seed, n, box) {
  const r = seeded(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    const u = box[0] + r() * (box[2] - box[0])
    const v = box[1] + r() * (box[3] - box[1])
    out.push({ u, v, len: 3 + r() * 5, thick: r() < 0.4 ? 1.2 : 0.8 })
  }
  return out
}
const SMEAR_N = [9, 4, 1]
const TORSO_SMEARS = [0, 1, 2].map((st) => smears(31, SMEAR_N[st] + 2, [-7, -6, 10, 22]))
/**
 * On the helmet the grime is what a lazy squeegee leaves: long level arcs round the dome, not
 * strands (strands read as hair).
 */
const HEAD_ARCS = [
  [
    { v: 18.5, u0: -12, u1: -2 },
    { v: 11.5, u0: -13, u1: -5 },
  ],
  [{ v: 16, u0: -12, u1: -4 }],
  [],
]
function onArc(list, u, v) {
  for (const a of list) {
    if (u < a.u0 || u > a.u1) continue
    // Sagging a little in the middle, thicker where the blade pressed.
    const k = (u - a.u0) / (a.u1 - a.u0)
    const dv = v - (a.v - Math.sin(k * Math.PI) * 1.2)
    if (Math.abs(dv) < 0.5 + Math.sin(k * Math.PI) * 0.35) return GRIME.mid
  }
  return 0
}

/** A grime streak: a short slanted stroke, the way a squeegee leaves one. */
function onSmear(list, u, v) {
  for (const s of list) {
    const du = u - s.u
    const dv = v - s.v
    // Along a line sloping down to the back.
    const along = du * 0.8 + dv * 0.6
    const across = -du * 0.6 + dv * 0.8
    if (along >= 0 && along <= s.len && Math.abs(across) <= s.thick) return Math.abs(across) < 0.5 ? GRIME.dark : GRIME.mid
  }
  return 0
}

/** Two-bone reach: the elbow or knee for a joint from a to b with bone lengths l1, l2, bending to `bend` (+1 forward). */
function joint(ax, ay, bx, by, l1, l2, bend) {
  const dx = bx - ax
  const dy = by - ay
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy)))
  const a = Math.atan2(dy, dx)
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
  const ang = a - bend * Math.acos(Math.max(-1, Math.min(1, cosA)))
  return [ax + l1 * Math.cos(ang), ay + l1 * Math.sin(ang)]
}

/** The torso's outline, torso space: u forward, v up the spine from the hips. Puffed-out chest. */
function torsoSpan(v) {
  if (v < -8 || v > 25) return null
  let front
  let back
  if (v < 0) {
    front = 8 + -v * 0.3
    back = -8 - -v * 0.3
  } else if (v < 5) {
    front = 7.5
    back = -7.5
  } else if (v < 15) {
    front = 7.5 + (v - 5) * 0.48
    back = -7.5 - (v - 5) * 0.08
  } else {
    front = 12.3 - (v - 15) * 0.42
    back = -8.3 + (v - 15) * 0.05
  }
  if (v > 22) {
    const k = (v - 22) / 3
    front -= k * k * 4
    back += k * k * 4
  }
  return [back, front]
}

function torsoColour(u, v, stage, shine) {
  const span = torsoSpan(v)
  if (!span || u < span[0] || u > span[1]) return 0
  const s = (u - span[0]) / (span[1] - span[0])
  if (!shine) {
    const g = onSmear(TORSO_SMEARS[stage], u, v)
    if (g) return g
  }
  // The belt and its buckle.
  if (v >= 0.5 && v < 3) return u > 3 && u < 7 ? (v < 1.5 ? GOLD.hi : GOLD.mid) : v < 1.5 ? PAL.mud[2] : PAL.mud[1]
  // The tabard, with the house emblem: a gold squeegee standing on its blade.
  if (v < 17) {
    if (v >= 7 && v < 9 && u >= -2.5 && u < 7.5) return v < 8 ? RUBBER_BLADE.mid : u < 0 ? GOLD.mid : GOLD.shade
    if (v >= 9 && v < 10.5 && u >= -2 && u < 7) return u < 1 ? GOLD.hi : GOLD.mid
    if (v >= 10.5 && v < 15.5 && u >= 1.5 && u < 3.5) return u < 2.5 ? GOLD.hi : GOLD.mid
    if (v < -6.5) return TABARD.shade
    if (s < 0.18) return TABARD.hi
    if (s > 0.8) return TABARD.shade
    return TABARD.mid
  }
  // The breastplate and gorget above it.
  if (v < 18) return STEEL.dark
  if (shine && s > 0.25 && s < 0.35) return STEEL.spec
  if (s < 0.3) return STEEL.hi
  if (s > 0.78) return STEEL.shade
  return STEEL.mid
}

/** The helmet with his face in it, head space: u forward, v up from the neck. */
const HELM = { cx: -0.5, cy: 12.5, r: 13.5, top: 20.5 }

function helmetColour(u, v, stage, shine, open) {
  const { cx, cy, r } = HELM
  const d = Math.hypot(u - cx, v - cy)
  // The neck guard flaring out at the back.
  const guard = u < -3 && u > -14 && v > 0 && v < 10 && u > -14 + v * 0.3
  if (d > r && !guard) return 0
  // The opening the face looks out of: a big one, the face is the point of him.
  if (open && u > -1.5 && v > 1.5 && v < HELM.top && d < r - 0.2) {
    if (u < -0.4 || v > HELM.top - 1) return STEEL.dark
    return v < 4 ? SKIN.shade : u < 2.5 ? SKIN.mid : SKIN.hi
  }
  if (!shine) {
    const g = onArc(HEAD_ARCS[stage], u, v)
    if (g) return g
  }
  // A ridge over the top, a rivet or two, light from the top left.
  if (Math.abs(u - cx + 1) < 0.8 && v > cy + 2) return STEEL.hi
  if (Math.hypot(u + 6, v - 7) < 1) return STEEL.spec
  const lx = (u - cx) / r
  const ly = (v - cy) / r
  if (lx < -0.35 && ly > 0.1) return shine ? STEEL.spec : STEEL.hi
  if (lx + -ly * 0.5 > 0.45) return STEEL.shade
  if (v < 2) return STEEL.shade
  return STEEL.mid
}

/** The squeegee crest: a gold holder and its black rubber blade, head space. sq squashes it. */
function crestColour(u, v, sq = 1) {
  const base = HELM.cy + HELM.r - 0.5
  const stem = 4 * sq
  if (u >= -1.5 && u <= 1.5 && v >= base && v < base + stem) return u < 0 ? GOLD.hi : GOLD.mid
  const h0 = base + stem
  const h1 = h0 + 3.4 * sq
  const b1 = h1 + 2.4 * sq
  // The holder tapers to its ends, like a real squeegee's.
  const half = 12.5 - Math.max(0, v - h0) * 0.4
  if (v >= h0 && v < h1 && u >= -half && u <= half + 1) return v > h1 - 1.2 ? GOLD.hi : u > half - 2 ? GOLD.shade : GOLD.mid
  if (v >= h1 && v < b1 && u >= -12 && u <= 13.5) return v > b1 - 1 ? RUBBER_BLADE.hi : RUBBER_BLADE.mid
  return 0
}

// Face stamps over the helmet's opening, top-left at head space (1, 13). K outline, W white,
// L lid (skin shade), M moustache, m its light, R mouth, P tongue, h nose light, n nose, B b sweat.
const SK_LEGEND = { K: O, W, L: SKIN.shade, M: PAL.mud[1], m: PAL.mud[2], R: PAL.red[0], P: PAL.red[5], h: SKIN.hi, n: SKIN.mid, s: SKIN.shade, B: PAL.blue[3], b: PAL.blue[4] }
// His eyes, far then near, 6 x 6 each and touching; above them his brows (dark like the
// moustache), 4 rows, each a 2-row bar given as [outer end, inner end] row, 0 high to 2 low.
const SK_EYES = {
  open: pair(eyeOval(6, 6, [2, 1, 2, 3]), eyeOval(6, 6, [2, 1, 2, 3])),
  // Lids half down, pupils low: looking down that nose at you.
  proud: pair(eyeOval(6, 6, [3, 3, 2, 2], () => 1), eyeOval(6, 6, [3, 3, 2, 2], () => 1)),
  wide: pair(eyeOval(6, 6, [2, 2, 2, 2]), eyeOval(6, 6, [2, 2, 2, 2])),
  angry: pair(eyeOval(6, 6, [2, 3, 2, 2], (k) => 0.6 + k * 2), eyeOval(6, 6, [2, 3, 2, 2], (k) => 2.6 - k * 2)),
  dizzy: pair(eyeOval(6, 6, [1, 1, 2, 2]), eyeOval(6, 6, [3, 3, 2, 2])),
  shut: pair(['......', '......', '......', 'KKKKKK', '.KKKK.', '......'], ['......', '......', '......', 'KKKKKK', '.KKKK.', '......']),
  happy: pair(['......', '.KKKK.', 'KK..KK', 'K....K', '......', '......'], ['......', '.KKKK.', 'KK..KK', 'K....K', '......', '......']),
  squeeze: pair(['KK....', '.KKK..', '...KKK', '.KKK..', 'KK....', '......'], ['....KK', '..KKK.', 'KKK...', '..KKK.', '....KK', '......']),
}
const SK_BROWS = {
  high: [[0, 0], [0, 0]],
  smug: [[1, 1], [0, 0]],
  cross: [[0, 2], [2, 0]],
  annoyed: [[0, 1], [1, 0]],
  worried: [[2, 0], [0, 2]],
  wobbly: [[1, 0], [0, 1]],
}
/** Brows over a pair of eyes: one stamp, 12 wide and 10 tall. */
function skEyeStamp(eyes, brows) {
  const rows = []
  for (let r = 0; r < 4; r++) {
    let s = ''
    for (let x = 0; x < 12; x++) {
      const side = x < 6 ? 0 : 1
      // Outer end first: the far brow's outer end is on the left, the near one's on the right.
      const k = side === 0 ? x / 5 : 1 - (x - 6) / 5
      const [outer, inner] = SK_BROWS[brows][side]
      const y = Math.round(outer + (inner - outer) * k)
      s += r >= y && r < y + 2 ? 'M' : '.'
    }
    rows.push(s)
  }
  for (let r = 0; r < 6; r++) rows.push(SK_EYES[eyes][0][r] + SK_EYES[eyes][1][r])
  return rows
}
// The long proud nose, always the same.
const SK_NOSE = ['K.......', 'KhK.....', 'KhhK....', 'KhhhKK..', 'KnhhhhK.', 'KnnnnnhK', '.KKKKKK.']
const SK_MOUSTACHE = {
  // Waxed and curled up at both ends.
  up: ['MM..............MM', 'MMM............MMM', '.MMMMMmmmmmmMMMMM.', '..MMMMMMMMMMMMMM..', '....MMMM..MMMM....'],
  // Curls fallen.
  down: ['....MMMMmmMMMM....', '..MMMMMMMMMMMMMM..', '.MMMMM......MMMMM.', 'MMM............MMM', 'MM..............MM'],
  // Bristling.
  bristle: ['M.M............M.M', '.MMMMMmmmmmmMMMMM.', 'MMMMMMMMMMMMMMMMMM', '.M.M.M......M.M.M.', '..................'],
  flat: ['..................', '.MMMMMmmmmmmMMMMM.', 'MMMMMMMMMMMMMMMMMM', '.MMM..........MMM.', '..................'],
}
const SK_MOUTH = {
  none: [],
  smile: ['K.....K', '.KKKKK.'],
  o: ['.KKK.', 'KRRRK', 'KRPRK', '.KKK.'],
  yell: ['KKKKKKK', 'KRRRRRK', '.KRPPK.', '..KKK..'],
  grit: ['KKKKKKK', 'KWKWKWK', 'KKKKKKK'],
  wavy: ['K.K.K.K', '.K.K.K.'],
  frown: ['.KKKKK.', 'K.....K'],
}
const SK_FACES = {
  proud: { eyes: 'proud', brows: 'high', tache: 'up', mouth: 'smile' },
  indignant: { eyes: 'open', brows: 'annoyed', tache: 'flat', mouth: 'frown', sweat: 1 },
  panicky: { eyes: 'wide', brows: 'worried', tache: 'down', mouth: 'grit', sweat: 2 },
  blink: { eyes: 'shut', brows: 'high', tache: 'up', mouth: 'smile' },
  blink1: { eyes: 'shut', brows: 'annoyed', tache: 'flat', mouth: 'frown', sweat: 1 },
  blink2: { eyes: 'shut', brows: 'worried', tache: 'down', mouth: 'grit', sweat: 2 },
  salute: { eyes: 'happy', brows: 'high', tache: 'up', mouth: 'smile' },
  aim: { eyes: 'angry', brows: 'cross', tache: 'bristle', mouth: 'grit' },
  yell: { eyes: 'angry', brows: 'cross', tache: 'bristle', mouth: 'yell' },
  charge: { eyes: 'angry', brows: 'cross', tache: 'bristle', mouth: 'grit' },
  whoa: { eyes: 'wide', brows: 'high', tache: 'down', mouth: 'o' },
  dizzy: { eyes: 'dizzy', brows: 'wobbly', tache: 'down', mouth: 'wavy' },
  washed: { eyes: 'squeeze', brows: 'worried', tache: 'down', mouth: 'wavy' },
  smug: { eyes: 'proud', brows: 'smug', tache: 'up', mouth: 'smile' },
  bow: { eyes: 'happy', brows: 'high', tache: 'up', mouth: 'smile' },
  bonk: { eyes: 'squeeze', brows: 'cross', tache: 'bristle', mouth: 'o' },
}

/** The wiper blade, as drawn in his hand: a metal spine over a black rubber edge, centre (x, y), angle a. */
function bladeColour(x, y, cx, cy, a, len = 22) {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const du = (x - cx) * c + (y - cy) * s
  const dv = -(x - cx) * s + (y - cy) * c
  if (Math.abs(du) > len / 2) return 0
  if (dv >= 0.4 && dv < 2.2) return RUBBER_BLADE.mid
  // The frame's little arch over the rubber.
  const arch = -1.6 - Math.max(0, 2.2 - Math.abs(du) * 0.35)
  if (dv >= arch && dv < 0.4) return dv < arch + 1 ? GOLD.hi : GOLD.mid
  return 0
}

/**
 * One frame of Sir Streaks. A pose (canvas coordinates from the anchor, y up negative):
 *   pelvis [x, y]; lean (degrees from upright, + forward); head (degrees, + chin down)
 *   feet [[x, y, toe], [x, y, toe]] far then near; toe tilts the foot (degrees, + toe down)
 *   hands [[x, y], [x, y]] far (the shield) then near; blade: angle of a wiper blade in the near hand
 *   shield: tilt of the bottle (degrees); face: a SK_FACES key; crest: squash 0..1
 *   knees: +1 bend forward (default), -1 back
 */
function streaks(pose) {
  const stage = pose.stage === 's' ? 2 : pose.stage
  const shine = pose.stage === 's'
  const c = new Canvas(SK_W, SK_H)
  const P = (x, y) => [SK_AX + x, SK_AY + y]
  const [px, py] = P(...pose.pelvis)
  const lean = ((pose.lean ?? 0) * Math.PI) / 180
  const torso = frameOf({ ox: px, oy: py, rot: lean })
  const [nx, ny] = torso.toCanvas(0.5, 25)
  const head = frameOf({ ox: nx, oy: ny, rot: (((pose.head ?? 0) + (pose.lean ?? 0) * 0.35) * Math.PI) / 180 })

  const limb = (pts, thick, col, hi) =>
    raster(SK_W, SK_H, (x, y) => {
      const d = polyDist(pts, x, y)
      if (d > thick / 2) return 0
      return hi && d < thick / 2 - 1.3 ? hi : col
    })

  const legs = (side) => {
    const far = side === 0
    const [fx, fy, toe = 0] = pose.feet[side]
    const [ax, ay] = P(fx, fy)
    const [hx, hy] = torso.toCanvas(far ? -2 : 2, -1)
    const [kx, ky] = joint(hx, hy, ax, ay - 2, 13, 13, pose.knees ?? 1)
    layer(c, limb([[hx, hy], [kx, ky], [ax, ay - 2]], 5, far ? STEEL.shade : STEEL.mid, far ? STEEL.mid : STEEL.hi))
    // A knee cop.
    layer(c, raster(SK_W, SK_H, (x, y) => (Math.hypot(x - kx, y - ky) <= 2.6 ? (x < kx && y < ky ? STEEL.hi : far ? STEEL.shade : STEEL.mid) : 0)))
    // A pointed sabaton: toe forward.
    const t = (toe * Math.PI) / 180
    const foot = frameOf({ ox: ax, oy: ay, rot: t })
    layer(c, raster(SK_W, SK_H, (x, y) => {
      const [u, v] = foot.toBody(x, y)
      if (v < 0 || v > 4.5 || u < -4.5) return 0
      const tip = 10 - v * 1.4
      if (u > tip) return 0
      return v > 3 ? (far ? STEEL.mid : STEEL.hi) : far ? STEEL.shade : STEEL.mid
    }))
  }

  const arm = (side) => {
    const far = side === 0
    const [sx, sy] = torso.toCanvas(far ? -1 : 0, 21)
    const [hx, hy] = P(...pose.hands[side])
    const [ex, ey] = joint(sx, sy, hx, hy, 11, 11, far ? (pose.farElbow ?? -1) : (pose.elbow ?? -1))
    layer(c, limb([[sx, sy], [ex, ey], [hx, hy]], 4, far ? STEEL.shade : STEEL.mid, far ? STEEL.mid : STEEL.hi))
    // A gauntlet.
    layer(c, raster(SK_W, SK_H, (x, y) => (Math.hypot(x - hx, y - hy) <= 2.7 ? (x < hx && y < hy ? STEEL.hi : STEEL.shade) : 0)))
    if (!far) {
      // The pauldron over his shoulder.
      layer(c, raster(SK_W, SK_H, (x, y) => {
        const [u, v] = torso.toBody(x, y)
        const d = Math.hypot(u + 0.5, (v - 21) * 1.15)
        if (d > 5.2 || v < 18.5) return 0
        return v > 22.5 ? STEEL.hi : u > 2 ? STEEL.shade : STEEL.mid
      }))
      if (pose.blade !== undefined) {
        const a = (pose.blade * Math.PI) / 180
        layer(c, raster(SK_W, SK_H, (x, y) => bladeColour(x, y, hx + Math.cos(a) * 8, hy + Math.sin(a) * 8, a)))
      }
    }
  }

  const shield = () => {
    const [hx, hy] = P(...pose.hands[0])
    const sf = frameOf({ ox: hx + 2, oy: hy + 6, rot: ((pose.shield ?? 0) * Math.PI) / 180, sx: 0.75, sy: 0.72 })
    layer(c, raster(SK_W, SK_H, (x, y) => {
      const [u, v] = sf.toBody(x, y)
      // The bottle: a rounded body, a neck, then the trigger sprayer on top.
      if (v >= 0 && v < 17 && Math.abs(u) <= 6.5) {
        const cu = Math.max(0, Math.abs(u) - 4.5)
        const cv = Math.max(0, 2 - v)
        if (cu * cu + cv * cv > 5) return 0
        // The label: white with a teal streak.
        if (v > 5 && v < 11) return v > 7.5 && v < 9 && u > -3 && u < 4 ? TABARD.mid : u < -3 ? G[5] : W
        if (u < -3.5) return BOTTLE.hi
        if (u > 3.5) return BOTTLE.shade
        return v > 15 ? BOTTLE.hi : BOTTLE.mid
      }
      if (v >= 17 && v < 19.5 && Math.abs(u) <= 3) return BOTTLE.cap
      if (v >= 19.5 && v < 24.5 && u >= -4 && u <= 5) return v > 23 ? BOTTLE.cap : BOTTLE.capShade
      // The nozzle forward and the trigger under it.
      if (v >= 21.5 && v < 24 && u > 5 && u <= 8.5) return BOTTLE.capShade
      if (v >= 16.5 && v < 21 && u >= 3.5 && u < 5.5 + (21 - v) * 0.3) return v < 18 ? TABARD.shade : TABARD.mid
      return 0
    }))
  }

  const drawHead = () => {
    const sq = pose.crest ?? 1
    layer(c, raster(SK_W, SK_H, (x, y) => crestColour(...head.toBody(x, y), sq)))
    layer(c, raster(SK_W, SK_H, (x, y) => helmetColour(...head.toBody(x, y), stage, shine, true)))
    const face = SK_FACES[pose.face ?? 'proud']
    // The top-left corner of the face's opening; the stamps are laid out from there.
    const [fx, fy] = head.toCanvas(-0.5, HELM.top)
    const ox = Math.round(fx)
    const oy = Math.round(fy)
    stamp(c, ox, oy, skEyeStamp(face.eyes, face.brows), SK_LEGEND)
    const mouth = SK_MOUTH[face.mouth]
    if (mouth.length) stamp(c, ox + 5, oy + 17, mouth, SK_LEGEND)
    stamp(c, ox - 2, oy + 13, SK_MOUSTACHE[face.tache], SK_LEGEND)
    stamp(c, ox + 9, oy + 9, SK_NOSE, SK_LEGEND)
    if (face.sweat) {
      const [wx, wy] = head.toCanvas(-6, 15)
      stamp(c, Math.round(wx), Math.round(wy), SWEAT, FACE_LEGEND)
      if (face.sweat > 1) {
        const [vx, vy] = head.toCanvas(-9, 9)
        stamp(c, Math.round(vx), Math.round(vy), SWEAT, FACE_LEGEND)
      }
    }
  }

  legs(0)
  arm(0)
  layer(c, raster(SK_W, SK_H, (x, y) => torsoColour(...torso.toBody(x, y), stage, shine)))
  legs(1)
  // Winding up or reaching high, the throwing arm goes behind his head, not across his face.
  if (pose.armBehind) arm(1)
  if (pose.headBehind) {
    shield()
    drawHead()
  } else {
    drawHead()
    shield()
  }
  if (!pose.armBehind) arm(1)
  return { canvas: c, ax: SK_AX, ay: SK_AY }
}

const skByStage = (a, b, c) => (stage) => [a, b, c][stage] ?? a

/** Sir Streaks's poses. Stand is the 30 x 68 box; dashes are 56 wide (see the sim). */
const SK_POSES = {
  stand: [
    { pelvis: [0, -28], lean: -4, head: -10, feet: [[-4, 0], [5, 0]], hands: [[9, -36], [4, -27]], elbow: -1, face: skByStage('proud', 'indignant', 'panicky') },
    { pelvis: [0, -27], lean: -3, head: -8, feet: [[-4, 0], [5, 0]], hands: [[9, -35], [4, -26]], elbow: -1, face: skByStage('proud', 'indignant', 'panicky') },
    { pelvis: [0, -28], lean: -4, head: -10, feet: [[-4, 0], [5, 0]], hands: [[9, -36], [4, -27]], elbow: -1, face: skByStage('blink', 'blink1', 'blink2') },
  ],
  // The strut: knees high, chest out.
  pace: [
    { pelvis: [0, -28], lean: -6, head: -12, feet: [[-7, 0], [8, 0]], hands: [[10, -36], [4, -27]], face: skByStage('proud', 'indignant', 'panicky') },
    { pelvis: [0, -29], lean: -6, head: -12, feet: [[-1, 0], [6, -7, 20]], hands: [[10, -37], [4, -28]], face: skByStage('proud', 'indignant', 'panicky') },
    { pelvis: [0, -28], lean: -6, head: -12, feet: [[8, 0], [-7, 0]], hands: [[10, -36], [4, -27]], face: skByStage('proud', 'indignant', 'panicky') },
    { pelvis: [0, -29], lean: -6, head: -12, feet: [[6, -7, 20], [-1, 0]], hands: [[10, -37], [4, -28]], face: skByStage('proud', 'indignant', 'panicky') },
  ],
  // The salute: a wiper blade raised like a sword.
  salute: [
    { pelvis: [0, -28], lean: -6, head: -14, feet: [[-5, 0], [6, 0]], hands: [[9, -36], [9, -62]], elbow: 1, blade: -80, face: 'salute' },
    { pelvis: [0, -28], lean: -4, head: -10, feet: [[-5, 0], [6, 0]], hands: [[9, -36], [13, -58]], elbow: 1, blade: -60, face: 'proud' },
  ],
  throwTell: [
    { pelvis: [-2, -27], lean: -12, head: -4, feet: [[-10, 0], [10, 0]], hands: [[12, -34], [-12, -62]], elbow: 1, blade: -30, face: 'aim', armBehind: true },
    { pelvis: [-3, -26], lean: -17, head: -2, feet: [[-11, 0], [10, 0]], hands: [[13, -33], [-16, -60]], elbow: 1, blade: -10, face: 'aim', armBehind: true },
  ],
  throw: [
    { pelvis: [3, -26], lean: 18, head: 6, feet: [[-12, 0], [14, 0]], hands: [[14, -30], [26, -42]], elbow: 1, face: 'yell' },
    { pelvis: [2, -27], lean: 10, head: 0, feet: [[-10, 0], [12, 0]], hands: [[13, -32], [22, -38]], elbow: 1, face: 'smug' },
  ],
  catch: [{ pelvis: [0, -28], lean: -6, head: -12, feet: [[-5, 0], [6, 0]], hands: [[9, -36], [14, -56]], elbow: 1, blade: -10, face: 'smug' }],
  // Crouched like a sprinter on the blocks: LOW. Jump him.
  lowTell: [
    { pelvis: [-8, -16], lean: 62, head: -30, feet: [[-17, 0, 10], [7, 0]], hands: [[16, -18], [-16, -26]], elbow: 1, face: 'charge', knees: 1 },
    { pelvis: [-9, -14], lean: 68, head: -32, feet: [[-18, 0, 15], [7, 0]], hands: [[17, -16], [-18, -24]], elbow: 1, face: 'charge', knees: 1 },
  ],
  // Up on his toes, arms high, about to leap: HIGH. Stay down.
  highTell: [
    { pelvis: [0, -30], lean: -8, head: -18, feet: [[-3, -4, 40], [4, -5, 45]], hands: [[12, -64], [14, -76]], elbow: 1, farElbow: 1, face: 'charge', armBehind: true },
    { pelvis: [0, -31], lean: -10, head: -20, feet: [[-3, -5, 50], [4, -6, 55]], hands: [[13, -66], [15, -79]], elbow: 1, farElbow: 1, face: 'charge', armBehind: true },
  ],
  // The low dash: flat out along the floor, crest first, wiping it.
  lowDash: [
    { pelvis: [-12, -12], lean: 86, head: 0, feet: [[-30, -6, -80], [-28, -2, -85]], hands: [[22, -9], [-10, -6]], elbow: 1, face: 'charge', knees: -1 },
    { pelvis: [-12, -13], lean: 84, head: 4, feet: [[-31, -4, -85], [-27, -5, -80]], hands: [[22, -10], [-12, -8]], elbow: 1, face: 'charge', knees: -1 },
  ],
  // The high dash: flying flat out at head height, like a lance.
  highDash: [
    { pelvis: [-12, -22], lean: 88, head: -6, feet: [[-31, -19, -85], [-29, -24, -80]], hands: [[22, -18], [-8, -14]], elbow: 1, face: 'charge', knees: -1 },
    { pelvis: [-12, -21], lean: 86, head: -4, feet: [[-31, -23, -80], [-29, -18, -85]], hands: [[22, -19], [-10, -15]], elbow: 1, face: 'charge', knees: -1 },
  ],
  skid: [{ pelvis: [-4, -22], lean: -26, head: -6, feet: [[12, 0, -20], [3, 0]], hands: [[-8, -50], [-14, -48]], elbow: 1, farElbow: 1, face: 'whoa' }],
  // Stuck: crest in the wall ahead (the box's front edge), legs scrabbling.
  stuck: [
    { pelvis: [-6, -22], lean: 52, head: 28, feet: [[-11, 0, 10], [-2, -3, 30]], hands: [[-4, -30], [-15, -38]], elbow: 1, face: 'dizzy', headBehind: true },
    { pelvis: [-6, -21], lean: 54, head: 30, feet: [[-13, -2, 25], [0, 0]], hands: [[-3, -31], [-16, -34]], elbow: 1, face: 'dizzy', headBehind: true },
  ],
  stuckHit: [
    { pelvis: [-6, -22], lean: 52, head: 28, feet: [[-11, 0, 10], [-2, -3, 30]], hands: [[-8, -42], [-14, -44]], elbow: 1, face: 'washed', headBehind: true },
    { pelvis: [-5, -21], lean: 50, head: 26, feet: [[-12, -1, 20], [-1, 0]], hands: [[-6, -44], [-17, -40]], elbow: 1, face: 'washed', headBehind: true },
  ],
  recover: [
    { pelvis: [-2, -27], lean: -10, head: 8, feet: [[-7, 0], [6, 0]], hands: [[9, -34], [0, -60]], elbow: 1, face: 'dizzy' },
    { pelvis: [-1, -28], lean: -4, head: -2, feet: [[-5, 0], [6, 0]], hands: [[9, -35], [2, -58]], elbow: 1, face: 'whoa' },
  ],
  flinch: [{ pelvis: [-1, -27], lean: -10, head: 6, feet: [[-5, 0], [6, 0]], hands: [[8, -40], [-6, -44]], elbow: 1, face: 'washed' }],
  bonk: [{ pelvis: [0, -26], lean: 0, head: 10, feet: [[-6, 0], [7, 0]], hands: [[10, -34], [-8, -36]], elbow: 1, face: 'bonk', crest: 0.45 }],
}

/** The fall: polished to a shine, bowing deeply, very pleased with himself all the same. */
const SK_BEATEN = [
  { pelvis: [0, -26], lean: -4, head: -8, feet: [[-4, 0], [5, 0]], hands: [[9, -36], [6, -42]], elbow: 1, face: 'bow' },
  { pelvis: [-1, -25], lean: 34, head: 26, feet: [[-6, 0], [6, 0]], hands: [[6, -28], [-12, -34]], elbow: 1, face: 'bow' },
  { pelvis: [-2, -24], lean: 50, head: 34, feet: [[-7, 0], [6, 0]], hands: [[6, -24], [-14, -30]], elbow: 1, face: 'bow' },
]

/* ------------------------------------------------------------------ */
/* What they throw, and the marks that warn of it                      */
/* ------------------------------------------------------------------ */

/** A wet, filthy sponge tumbling through the air (16 x 12 box), turned `a` radians. Anchor: its middle. */
function flyingSponge(a, drip) {
  const c = new Canvas(24, 24)
  const fr = frameOf({ ox: 12, oy: 12, rot: a })
  layer(c, raster(24, 24, (x, y) => {
    const [u, v] = fr.toBody(x, y)
    const col = spongeColour(u * 1.55, v * 0.85, 0)
    // Soaked: a band of muddy water along its underside.
    if (col && v < -3) return MUDWATER.mid
    return col
  }))
  // Drops shaken off it.
  const drops = [[3, 17], [20, 5], [5, 4], [19, 19]]
  for (let i = 0; i < 2; i++) {
    const [x, y] = drops[(drip + i) % drops.length]
    c.rect(x, y, 2, 2, i ? MUDWATER.light : MUDWATER.mid)
  }
  return { canvas: c, ax: 12, ay: 12 }
}

/** The low wave of dirty water Bill pours along the floor (34 x 22 box), rolling right. Anchor: bottom middle. */
function wave(n) {
  const w = 44
  const h = 30
  const c = new Canvas(w, h)
  const base = h - 2
  const ph = (n * Math.PI * 2) / 3
  layer(c, raster(w, h, (x, y) => {
    const u = x - w / 2
    const yy = base - y
    if (yy < 0) return 0
    // From a thin tail at the back up to a tall front, whose lip curls over a hollow barrel.
    const t = (u + 19) / 34
    if (t < 0) return 0
    const crest = 19 + Math.sin(ph) * 0.8
    let top
    if (t <= 0.72) top = 2 + (crest - 2) * (t / 0.72) ** 1.8 + Math.sin(u * 0.8 + ph) * 0.8
    else if (t <= 1.12) top = crest - ((t - 0.72) / 0.4) ** 2 * 7
    else return 0
    if (yy > top) return 0
    // The lip: a thick band hanging over the front, a cap of dirty cream foam on its rim. Mid
    // browns and a pale crest, so it stands out on the dark alley floor.
    const lip = t > 0.72 && yy > top - 5
    const barrel = t > 0.84 && !lip
    if (barrel) return yy < 3 + (t - 0.84) * 4 ? WAVE.light : t > 1.04 ? 0 : WAVE.deep
    if (yy > top - 2.2) return WAVE.foam
    if (yy > top - 3.6) return WAVE.foam2
    if (lip || yy > top - 5) return WAVE.light
    // Streaks of foam along its face, and grime churned up in it.
    if (Math.abs(yy - top * 0.55 - Math.sin(u * 0.5 + ph) * 1.2) < 0.6 && t > 0.2) return WAVE.foam2
    if ((Math.floor(u * 0.45 + ph * 2) + Math.floor(yy * 0.35)) % 6 === 0 && yy < top - 5) return WAVE.grime
    return yy < 3 ? WAVE.deep : WAVE.mid
  }))
  // Spray thrown off the lip.
  const spray = [[36 + n, 4], [39 - n, 9], [33 + n * 2, 1]]
  for (const [x, y] of spray) c.rect(x, y, 2, 2, WAVE.foam2)
  return { canvas: c, ax: w / 2, ay: base }
}

/**
 * The wiper blade in flight (28 x 10 box), spinning end over end about its long axis, with speed
 * lines trailing behind it (it flies right; the renderer mirrors it the way it is going). Anchor: its middle.
 */
function flyingBlade(n) {
  const c = new Canvas(44, 16)
  const len = [28, 20, 7, 20][n]
  const flip = n === 3
  const blade = raster(44, 16, (x, y) => {
    const u = x - 22
    const v = (y - 8) * (flip ? -1 : 1)
    if (Math.abs(u) > len / 2) return 0
    // Yellow over black, the colours of a warning: it reads as sharp at a glance.
    if (len <= 7) return Math.abs(v) < 4.5 ? (v < -1.5 ? GOLD.hi : v < 1.5 ? GOLD.mid : RUBBER_BLADE.mid) : 0
    // The clip in its middle, steel.
    if (Math.abs(u) < 2.5 && v >= -4.5 && v < -1) return v < -3 ? STEEL.spec : STEEL.mid
    if (v >= 1 && v < 4) return v < 2 ? RUBBER_BLADE.hi : RUBBER_BLADE.mid
    const arch = -1.2 - Math.max(0, 2.6 - Math.abs(u) * 0.22)
    if (v >= arch && v < 1) return v < arch + 1.2 ? GOLD.hi : GOLD.mid
    return 0
  })
  layer(c, blade)
  // Whoosh: three dashes behind it.
  const lines = [[-3, 6], [1, 9], [5, 5]]
  lines.forEach(([dy, l], i) => c.rect(22 - len / 2 - 3 - l - ((i + n) % 2) * 2, 8 + dy, l, 1, i === 1 ? W : PAL.ice[2]))
  return { canvas: c, ax: 22, ay: 8 }
}

/**
 * Marks on the floor where something is about to land: a ring in a warning colour with its own
 * dark outline, lying flat (an ellipse), so it reads on the dark backlot floor.
 */
function ringMark(rx, ry, col, hi) {
  const w = Math.ceil(rx * 2) + 4
  const h = Math.ceil(ry * 2) + 4
  const c = raster(w, h, (x, y) => {
    const e = ((x - w / 2) / rx) ** 2 + ((y - h / 2) / ry) ** 2
    if (e > 1) return 0
    const inner = ((x - w / 2) / Math.max(1, rx - 2.2)) ** 2 + ((y - h / 2) / Math.max(0.6, ry - 1.4)) ** 2
    if (inner < 1) return 0
    return y < h / 2 ? hi : col
  })
  c.outline(O)
  return { canvas: c, ax: Math.floor(w / 2), ay: Math.floor(h / 2) }
}

/**
 * The wet streak a low dash leaves, laid over the top of a floor tile (32 wide, anchored at the
 * tile's top-left): a glossy film of water on the kerb, in level squeegee bands, dripping over its
 * edge. part: 0..2 middles, 'l' and 'r' the ends, where it thins out.
 */
function slickStrip(part) {
  const c = new Canvas(32, 10)
  const r = seeded(91 + (typeof part === 'number' ? part : part === 'l' ? 7 : 8))
  const drips = [Math.floor(r() * 30) + 1, Math.floor(r() * 30) + 1]
  const dashes = [0, 1, 2, 3].map(() => [Math.floor(r() * 26), 3 + Math.floor(r() * 6), 2 + Math.floor(r() * 3)])
  for (let x = 0; x < 32; x++) {
    // How far in from a thinning end: the film narrows to nothing over 8 pixels.
    const inner = part === 'l' ? x : part === 'r' ? 31 - x : 99
    const top = 1 + Math.max(0, Math.round((8 - inner) * 0.45))
    const bottom = 6 - Math.max(0, Math.round((8 - inner) * 0.3))
    for (let y = top; y <= bottom; y++) {
      let col = y === top ? PAL.teal[2] : y === top + 1 ? PAL.teal[1] : PAL.teal[0]
      for (const [dx, dl, dy] of dashes) if (y === dy + 1 && x >= dx && x < dx + dl && y > top + 1) col = PAL.teal[1]
      c.set(x, y, col)
    }
    if (inner > 4 && (x + (typeof part === 'number' ? part * 5 : 3)) % 11 === 0) c.set(x, top, W)
  }
  for (const d of drips) {
    if ((part === 'l' && d < 8) || (part === 'r' && d > 23)) continue
    c.set(d, 7, PAL.teal[1])
    c.set(d, 8, PAL.teal[0])
  }
  return { canvas: c, ax: 0, ay: 0 }
}

const CHEVRON = ['KK....', 'KYK...', 'KYYK..', '.KYYK.', '..KYyK', '.KYyK.', 'KYyK..', 'KyK...', 'KK....']
const STAR = ['...K...', '..KYK..', 'KKKYKKK', 'KYYYYyK', '.KYyyK.', 'KYK.KyK', 'KK...KK']
const GLINT = [
  ['.....', '..W..', '.WWW.', '..W..', '.....'],
  ['..W..', '..W..', 'WWWWW', '..W..', '..W..'],
  ['.....', '.....', '..W..', '.....', '.....'],
]
const MARK_LEGEND = { K: O, Y: PAL.yellow[2], y: PAL.yellow[1], W, w: PAL.ice[2] }

/* ------------------------------------------------------------------ */
/* The atlas                                                           */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('rivals_a', { script: 'art-rivals-a.mjs' })
/** anim name -> [{ label, canvas, ax, ay }], for the review sheets. */
const shown = {}

/** Trim a frame to what is drawn, keeping its anchor. */
function tight({ canvas, ax, ay }) {
  const t = canvas.pad(1).trim()
  return { canvas: t.canvas, ax: ax + 1 - t.x, ay: ay + 1 - t.y }
}

/** Frames '<who>_<pose><n>_<stage>' and the animation '<who>_<pose>_<stage>' over them (stage '' for none). */
function anim(who, pose, stage, frames) {
  const list = frames.map(tight)
  const tail = stage === '' ? '' : `_${stage}`
  const names = list.map((fr, i) => {
    const n = `${who}_${pose}${i}${tail}`
    atlas.add(n, fr.canvas, { ax: fr.ax, ay: fr.ay })
    return n
  })
  const name = `${who}_${pose}${tail}`
  atlas.anim(name, names)
  shown[name] = list.map((fr, i) => ({ ...fr, label: String(i) }))
}

for (const [pose, frames] of Object.entries(BILL_POSES)) {
  for (const stage of [0, 1, 2]) {
    anim('bill', pose, stage, frames.map((f) => bill({ ...f, stage, face: typeof f.face === 'function' ? f.face(stage) : f.face })))
  }
}
anim('bill', 'beaten', 's', BILL_BEATEN.map((f) => bill({ ...f, stage: 's' })))

for (const [pose, frames] of Object.entries(SK_POSES)) {
  for (const stage of [0, 1, 2]) {
    anim('streaks', pose, stage, frames.map((f) => streaks({ ...f, stage, face: typeof f.face === 'function' ? f.face(stage) : f.face })))
  }
}
anim('streaks', 'beaten', 's', SK_BEATEN.map((f) => streaks({ ...f, stage: 's' })))

const fromStamp = (rows, legend) => {
  const c = new Canvas(stampW(rows), rows.length)
  stamp(c, 0, 0, rows, legend)
  return { canvas: c, ax: Math.floor(c.w / 2), ay: Math.floor(c.h / 2) }
}
anim('bill', 'sponge', '', [0, 1, 2, 3].map((i) => flyingSponge((i * Math.PI) / 4, i)))
anim('bill', 'wave', '', [0, 1, 2].map(wave))
anim('streaks', 'blade', '', [0, 1, 2, 3].map(flyingBlade))
anim('mark', 'shadow', '', [ringMark(21, 4, RUBBER.mid, RUBBER.hi), ringMark(16, 3.5, RUBBER.mid, RUBBER.hi), ringMark(11, 3, RUBBER.shade, RUBBER.mid)])
anim('mark', 'drip', '', [ringMark(8, 2.6, SPONGE.mid, SPONGE.hi), ringMark(6, 2.2, SPONGE.shade, SPONGE.mid)])
anim('mark', 'chevron', '', [fromStamp(CHEVRON, MARK_LEGEND)])
anim('mark', 'star', '', [fromStamp(STAR, MARK_LEGEND)])
anim('mark', 'glint', '', GLINT.map((g) => fromStamp(g, MARK_LEGEND)))
anim('mark', 'sweat', '', [fromStamp(SWEAT, FACE_LEGEND)])
anim('mark', 'slick', '', [slickStrip(0), slickStrip(1), slickStrip(2), slickStrip('l'), slickStrip('r')])

/* ------------------------------------------------------------------ */
/* Write, check, review                                                */
/* ------------------------------------------------------------------ */

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error(`colours outside the palette: ${JSON.stringify(stray)}`)
atlas.meta({
  note: "Frames '<who>_<pose><n>_<stage>', animations '<who>_<pose>_<stage>': stage 0 filthy, 1, 2 nearly clean; 's' spotless (the fall only). Everything faces right: mirror it when the entity faces left. Rivals are anchored at the middle of their feet (draw at e.x + e.w / 2, e.y + e.h); thrown things at their middle; marks at their middle, drawn on the floor line. Drawn by render/entities/rivals_a.ts.",
  bill: {
    box: [40, 50],
    poses: Object.keys(BILL_POSES).concat('beaten'),
    states: 'wait/idle: idle (blink = frame 2); intro: taunt; hopTell, hop (0 rising, 1 falling), land, lobTell, lob (0 holding the next sponge, 1 just thrown), sloshTell, slosh, dizzy (washed while water hits him), recover; flinch and bonk over idle; beaten_s: on his head',
  },
  streaks: {
    box: { stand: [30, 68], lowDash: [56, 36], highDash: [56, 44, 'lifted 64'], stuck: [34, 64] },
    poses: Object.keys(SK_POSES).concat('beaten'),
    states: 'wait: stand; pace; intro: salute; throwTell, throw, catch; dashTell: lowTell or highTell by vars.high; dash: lowDash or highDash; skid; turn: stand; stuck (stuckHit while water hits him); recover; flinch and bonk over stand and pace; beaten_s: 0 upright, 1 bowing, 2 the full bow',
  },
  thrown: { bill_sponge: [16, 12], bill_wave: [34, 22], streaks_blade: [28, 10] },
  marks: { mark_shadow: 'landing ring, 3 sizes (0 biggest)', mark_drip: 'sponge landing ring', mark_chevron: 'dash warning', mark_star: 'dizzy star', mark_glint: 'slick floor and spotless sparkle', mark_sweat: 'flung sweat', mark_slick: 'wet film over a floor tile, anchored at its top-left: 0..2 middles, 3 left end, 4 right end' },
})
const out = atlas.write()
console.log(`rivals_a: ${atlas.frames.size} frames, sheet ${out.sheet.w}x${out.sheet.h} -> ${path.relative(process.cwd(), out.png)}`)

/**
 * Animations flowed left to right in lines, each a strip of its frames on one ground line with
 * its name above: a whole character on one page. rows: [{ label, frames: [{ canvas, ax, ay }] }].
 */
function gridSheet(rows, { bg, scale = 3, flipX = false, maxW = 600, file }) {
  const ink = '#f7f4f8'
  const blocks = rows.map((r) => {
    const frames = r.frames.map((f) => (flipX ? { canvas: f.canvas.flipX(), ax: f.canvas.w - f.ax, ay: f.ay } : f))
    let left = 0
    let right = 0
    let top = 0
    let bottom = 0
    for (const f of frames) {
      left = Math.max(left, f.ax)
      right = Math.max(right, f.canvas.w - f.ax)
      top = Math.max(top, f.ay)
      bottom = Math.max(bottom, f.canvas.h - f.ay)
    }
    const cw = left + right
    const w = Math.max(frames.length * (cw + 2), r.label.length * 4 + 2)
    return { label: r.label, frames, left, top, bottom, cw, w }
  })
  const lines = []
  let line = []
  let lw = 0
  for (const b of blocks) {
    if (line.length && lw + b.w + 6 > maxW) {
      lines.push(line)
      line = []
      lw = 0
    }
    line.push(b)
    lw += b.w + 6
  }
  if (line.length) lines.push(line)
  let h = 2
  const tops = lines.map((ln) => {
    const top = Math.max(...ln.map((b) => b.top))
    const bottom = Math.max(...ln.map((b) => b.bottom))
    const y = h
    h += 8 + top + bottom + 4
    return { y, top }
  })
  const sheet = new Canvas(maxW + 8, h, bg)
  lines.forEach((ln, i) => {
    let x = 2
    const { y, top } = tops[i]
    const ground = y + 8 + top
    for (const b of ln) {
      sheet.text(x, y + 1, b.label, ink)
      sheet.rect(x, ground, b.w - 2, 1, '#4b4f5c')
      b.frames.forEach((f, k) => sheet.blit(f.canvas, x + k * (b.cw + 2) + b.left - f.ax, ground - f.ay))
      x += b.w + 6
    }
  })
  const out = scale > 1 ? sheet.scale(scale) : sheet
  if (file) out.save(file)
  return out
}

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  // One page per rival and dirt stage (the spotless fall goes with stage 2), and the extras.
  const groups = {}
  for (const [name, frames] of Object.entries(shown)) {
    const parts = name.split('_')
    const st = parts[parts.length - 1]
    const key = `${parts[0]}-${st === 's' ? '2' : /^\d$/.test(st) ? st : 'x'}`
    ;(groups[key] ??= []).push({ label: name.toUpperCase(), frames })
  }
  for (const [key, rows] of Object.entries(groups)) {
    gridSheet(rows, { bg: '#1a1033', scale: 3, file: path.join(REVIEW, `${key}-night-3x.png`) })
    gridSheet(rows, { bg: '#2e1f5e', scale: 3, flipX: true, file: path.join(REVIEW, `${key}-fence-3x-flip.png`) })
    gridSheet(rows, { bg: '#1a1033', scale: 1, file: path.join(REVIEW, `${key}-night-1x.png`) })
    gridSheet(rows, { bg: '#4b4f5c', scale: 1, flipX: true, file: path.join(REVIEW, `${key}-floor-1x-flip.png`) })
    // The plain strips, one animation to a row, at 1x.
    contactSheet(rows, { bg: '#1a1033', scale: 1, wrap: 16, file: path.join(REVIEW, `${key}-strips-1x.png`) })
  }
  // Beside Maxx, on the arena floor, at 1x and 3x.
  const maxxPng = Canvas.load(path.join(ASSETS_DIR, 'maxx.png'))
  const m = fs.readFileSync(path.join(ASSETS_DIR, 'maxx.atlas.ts'), 'utf8').match(/idle0: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+) \}/)
  const [mx, my, mw, mh, max, may] = m.slice(1).map(Number)
  const maxx = maxxPng.crop(mx, my, mw, mh)
  const lineup = [{ canvas: maxx, ax: max, ay: may }]
  for (const name of ['bill_idle_0', 'bill_hopTell_1', 'bill_dizzy_1', 'bill_beaten_s', 'streaks_stand_0', 'streaks_lowTell_0', 'streaks_highTell_1', 'streaks_stuck_2', 'streaks_beaten_s']) {
    const fr = shown[name]
    if (fr) lineup.push(fr[fr.length - 1])
  }
  const W2 = 24 + lineup.reduce((s, f) => s + f.canvas.w + 16, 0)
  const scene = new Canvas(W2, 120, '#1a1033')
  scene.rect(0, 0, W2, 50, '#120d2b')
  scene.rect(0, 96, W2, 24, '#4b4f5c')
  scene.rect(0, 96, W2, 2, '#767b8a')
  let x = 12
  for (const f of lineup) {
    scene.blit(f.canvas, x, 96 - f.ay)
    x += f.canvas.w + 16
  }
  scene.save(path.join(REVIEW, 'lineup-1x.png'))
  scene.scale(3).save(path.join(REVIEW, 'lineup-3x.png'))
  console.log(`review sheets in ${REVIEW}`)
}

