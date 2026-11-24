// art-rivals-b.mjs: generates the 'rivals_b' atlas: secret rivals 3 and 4, SLICK OLLIE (a
// green oil can with a slicked oil pompadour, a pencil moustache and a bow tie) and NIMBUS
// NICK (a storm cloud in sunglasses), with
// everything they throw (game/sim/entities/rival_ollie.ts, rival_nick.ts; drawn by
// game/render/entities/rivals_b.ts).
//
//   node scripts/maxx/art-rivals-b.mjs                  writes rivals_b.png + rivals_b.atlas.ts
//   node scripts/maxx/art-rivals-b.mjs --review <dir>   also writes contact sheets into <dir>:
//       every animation as a strip at 1x and 3x on the backlot's night colours, plain and
//       mirrored (sheet_<group>_<bg>_<scale>[_flip].png), and line-ups of each rival beside
//       Maxx at 1x and 3x (lineup_<rival>_<scale>.png)
//
// Everything is drawn here from shapes and a few hand-placed pixels. All of it faces RIGHT
// (the renderer mirrors it when the entity faces left), lit from the top left, with Maxx's
// own warm outline. Both are invented mascots of invented washes.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const O = PAL.outline
const [G0, G1, G2, G3, G4, G5, G6] = PAL.grey
const WOOD = PAL.wood
const [T0, T1, T2] = PAL.teal
const [Y0, Y1, Y2] = PAL.yellow
const PINK = PAL.pink[0]
const [, R1, R2, R3, R4] = PAL.red
const [B0, B1, B2, B3, B4] = PAL.blue
const [P0, P1, P2, P3] = PAL.purple
const [M0, M1] = PAL.mud
const [I0, I1, I2] = PAL.ice
const [OR0, OR1, OR2] = PAL.orange
const [GR0, GR1, GR2, GR3] = PAL.green
const WHITE = G6

const rad = (d) => (d * Math.PI) / 180

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

/** Hand-placed pixels: one character per pixel from `legend`, '.' leaves what is there. */
function stamp(c, x, y, rows, legend, flip = false) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[flip ? row.length - 1 - i : i]
      if (ch === '.') continue
      if (!(ch in legend)) throw new Error(`stamp: no colour for '${ch}'`)
      c.set(Math.round(x) + i, Math.round(y) + j, legend[ch])
    }
  })
  return c
}

/** Distance from p to the segment a-b, and how far along it (0..1). */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return [Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t]
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

function sparkle(c, x, y, r, col = WHITE) {
  c.rect(x - r, y, 2 * r + 1, 1, col)
  c.rect(x, y - r, 1, 2 * r + 1, col)
}

/** A white glove (r 3) with its own outline. */
function glove(c, x, y) {
  const g = new Canvas(9, 9)
  g.circle(4, 4, 2.6, WHITE)
  g.set(5, 5, G5)
  g.set(4, 6, G5)
  g.set(6, 4, G5)
  g.outline(O)
  c.blit(g, Math.round(x) - 4, Math.round(y) - 4)
}

/* ------------------------------------------------------------------ */
/* SLICK OLLIE                                                         */
/* ------------------------------------------------------------------ */

// A squat green enamel oil can with brass trim and a long brass spout for a nose. His pride is his hair: a slicked pompadour of his own best oil. It is the
// last thing to wash off; beaten, he is a bald, shiny can with one curl left.
// Canvas 88 x 84, his feet's middle (the anchor) at (44, 80): the line between two pixel
// columns, on the ground line. Box 44 x 56; the hair stands above it.
const OW = 88
const OH = 84
const OAX = 44
const OAY = 80
/** Where the spout's tip is, from the anchor (the simulation drips and squirts from here). */
const SPOUT_TIP = [30, -42]

const CAN = { deep: GR0, shade: GR1, mid: GR2, light: GR3 }
const BRASS = { deep: WOOD[2], shade: WOOD[3], mid: WOOD[5], light: WOOD[7], hi: WOOD[8] }
const OIL = { base: G0, gloss: B1, sheen: G2, hi: G4 }
const LOAFER = { sole: G0, base: R1, hi: R2 }

/** The can, in his own space (x forward, y up negative, from his feet). */
const TOP = -50
const BOT = -10

// Oil on him by stage: drips [x, length] running down from his shoulders and ending in a
// bead, splotches [x, y, r], and `base`: below this line the oil has pooled round his
// bottom. He keeps his face clean, the vain thing.
const OIL_COAT = [
  { drips: [[-17, 24], [-12, 31], [-7, 15], [10, 9], [15, 27], [19, 17]], spots: [[-13, -24, 3.2], [14, -19, 2.8], [-4, -18, 2.2], [17, -37, 2.2], [-17, -39, 2]], base: -17, spout: true },
  { drips: [[-15, 16], [-9, 9], [16, 13]], spots: [[-12, -25, 2.4], [14, -19, 1.8]], base: -12, spout: true },
  { drips: [[-14, 6]], spots: [[-12, -22, 1.5]], base: 99, spout: false },
  { drips: [], spots: [], base: 99, spout: false },
]
/** His face: no oil here. */
const FACE = [-8, -49, 13, -27]

/** How he looks at each stage when a pose does not say: smug, then alert, then rattled. */
const MOOD = [
  { eyes: 'smug', tache: 'smirk', hair: 'slick', sweat: false },
  { eyes: 'open', tache: 'smirk', hair: 'strand', sweat: false },
  { eyes: 'worried', tache: 'droop', hair: 'flop', sweat: true },
  { eyes: 'happy', tache: 'grin', hair: 'bald', sweat: false },
]

const EYES = {
  smug: ['.KKKKK.', 'KLLLLLK', 'KKKKKKK', 'KWWWWPK', 'KWWWPPK', 'KwWWPPK', '.KKKKK.'],
  open: ['.KKKKK.', 'KWWWWWK', 'KWWWWWK', 'KWWWPPK', 'KWWWPPK', 'KwWWWWK', '.KKKKK.'],
  worried: ['.KKKKK.', 'KWWWWWK', 'KWWPPWK', 'KWWPPWK', 'KWWWWWK', 'KwWWWWK', '.KKKKK.'],
  wide: ['.KKKKK.', 'KWWWWWK', 'KWWWWWK', 'KWWWPWK', 'KWWWWWK', 'KwWWWWK', '.KKKKK.'],
  down: ['.KKKKK.', 'KLLLLLK', 'KLLLLLK', 'KKKKKKK', 'KWWWWWK', 'KwWPPWK', '.KKKKK.'],
  shut: ['.......', '.......', '.......', 'KKKKKKK', '.K...K.', '.......', '.......'],
  happy: ['.......', '.......', '.KKKKK.', 'K.....K', '.......', '.......', '.......'],
  wink: ['.KKKKK.', 'KWWWWWK', 'KWWWWWK', 'KWWWPPK', 'KWWWPPK', 'KwWWWWK', '.KKKKK.'],
  squeeze: ['.......', 'KK.....', '..KK...', '....KKK', '..KK...', 'KK.....', '.......'],
  spiral: ['.KKKKK.', 'KWWWWWK', 'KWKKKWK', 'KWKWKWK', 'KWKWWWK', 'KwWWWWK', '.KKKKK.'],
}
// A pencil moustache: one thin line under the spout, its ends turned up (smirk) or down.
const TACHE = {
  smirk: ['K............K', 'KKKKKK..KKKKKK', '.KKKKK..KKKKK.'],
  droop: ['.KKKKK..KKKKK.', 'KKKKKK..KKKKKK', 'K............K'],
  o: ['.KKKKK..KKKKK.', 'K............K', '..............'],
  grin: ['K............K', 'KKKKKK..KKKKKK', '.KKKKK..KKKKK.'],
}

function oilBead(c, x, y, r) {
  c.circle(x, y, r, OIL.base)
  c.set(Math.round(x - r * 0.4), Math.round(y - r * 0.4), OIL.hi)
}

/** A red quart of Slick's own oil, upside down (tip 0..1 how far over), its mouth at (mx, my). */
function bottle(c, mx, my, tip) {
  const b = new Canvas(30, 30)
  const ang = rad(150 + tip * 30)
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  const br = raster(30, 30, (px, py) => {
    const dx = px - 15
    const dy = py - 15
    const u = dx * ca + dy * sa
    const v = -dx * sa + dy * ca
    // u along the bottle from its mouth (0) to its base (17).
    if (u >= 5 && u <= 17 && Math.abs(v) <= 4.2) {
      if (u >= 9 && u <= 13) return Math.abs(v) < 3 ? WHITE : G5
      return v < -1.5 ? R4 : R2
    }
    if (u >= 0 && u < 5 && Math.abs(v) <= 1.8 + u * 0.4) return v < 0 ? R3 : R1
    return 0
  })
  b.blit(br, 0, 0)
  b.outline(O)
  // The mouth of the bottle is at (15, 15) of its own canvas.
  c.blit(b, Math.round(mx) - 15, Math.round(my) - 15)
}

/**
 * His hair in its own space: (0, 0) is the top of his can, x forward. Returns the colour at a
 * point, or 0. 'slick' the pompadour, 'strand' one lock come loose, 'flop' fallen over his
 * brow, 'wild' standing on end, 'bald' one curl left on his cap.
 */
function hairAt(kind) {
  const inE = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
  const inC = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  const near = (x, y, pts, r) => {
    for (let i = 0; i + 1 < pts.length; i++) if (segDist(x, y, ...pts[i], ...pts[i + 1])[0] <= r) return true
    return false
  }
  let shape
  // Gloss strands running along the sweep of it, and where the light hits hardest.
  let strands = []
  let hi = []
  if (kind === 'slick' || kind === 'strand') {
    // A pompadour: high over his brow, sloping back to a ducktail at his nape.
    const POMP = [[11, 1], [14, -3], [13, -8], [9, -13], [3, -14], [-2, -12], [-7, -8], [-12, -5], [-15, -1], [-15, 4], [-13, 8], [-11, 4], [-7, 1], [0, 0], [6, 1]]
    strands = [[[11, -8], [7, -11], [2, -11], [-3, -8], [-9, -4], [-13, 0]], [[12, -3], [8, -6], [1, -6], [-5, -3], [-11, 1]]]
    hi = [[3, -12], [4, -12], [5, -12], [2, -11]]
    if (kind === 'slick') shape = (x, y) => inPoly(POMP, x, y)
    else shape = (x, y) => inPoly(POMP, x, y) || near(x, y, [[11, 0], [13, 4], [12, 8], [14, 11]], 0.9)
  } else if (kind === 'flop') {
    // Fallen: the quiff has slumped forward over his brow, locks hanging in his eyes.
    const MOP = [[16, 6], [15, 1], [10, -3], [2, -5], [-6, -4], [-12, -1], [-15, 3], [-13, 7], [-9, 3], [0, 2], [6, 3], [10, 6], [13, 9]]
    strands = [[[13, 1], [6, -2], [-2, -2], [-10, 1]]]
    shape = (x, y) => inPoly(MOP, x, y) || near(x, y, [[3, 2], [4, 9]], 0.9) || near(x, y, [[8, 4], [9, 11]], 0.9) || near(x, y, [[-9, 3], [-11, 8]], 0.9)
  } else if (kind === 'wild') {
    shape = (x, y) => {
      if (inE(x, y, 0, 0, 12.5, 4)) return true
      for (const [sx, h] of [[-9, 7], [-3, 10], [3, 11], [9, 8], [14, 5]]) {
        if (y < 0 && y > -h - 2 && Math.abs(x - sx - (y + h) * 0.08) <= 1.6 * (1 + y / (h + 2))) return true
      }
      return false
    }
  } else if (kind === 'bald') {
    shape = (x, y) => near(x, y, [[0, -3], [1, -7], [4, -8], [5, -5], [3, -4]], 1)
  } else {
    return () => 0
  }
  return (x, y) => {
    if (!shape(x, y)) return 0
    // Light from the top left: a sheen on the upper edge, blue gloss along the strands.
    if (!shape(x - 1.4, y - 1.4)) return OIL.sheen
    for (const [hx, hy] of hi) if (Math.floor(x) === hx && Math.floor(y) === hy) return OIL.hi
    for (const line of strands) if (near(x, y, line, 0.5)) return OIL.gloss
    return OIL.base
  }
}

/**
 * One Ollie frame. All positions are his own (x forward, y up negative, from his feet).
 *   stage 0..2 oily to nearly clean, 3 spotless. Eyes, moustache and hair default to his mood.
 *   rot: the can tips forward (+) or back (-) round his ankles, in degrees.
 *   sx, sy: stretch; lift: off the ground (px); legs: 'stand' | 'step' | 'crouch' | 'tuck' | 'sit' | 'glide'
 *   front, back: hand positions in body space (null: no arm on that side)
 *   eyes: 'smug' | 'open' | 'worried' | 'wide' | 'down' | 'shut' | 'happy' | 'wink' | 'squeeze' | 'spiral'
 *   tache: 'smirk' | 'droop' | 'o' | 'grin'
 *   hair: 'slick' | 'strand' | 'flop' | 'wild' | 'bald' | 'lift' (cap and hair held up in the back
 *         hand, his top open); hairTilt: degrees; comb: a comb in the front hand
 *   spoutRot: degrees the spout swings up (+) or down (-) about its root
 *   puff: cheeks full; bottle: tipping a bottle into his top, 0..1; drop: a drop on the spout 0..3
 */
function ollie(o = {}) {
  const mood = MOOD[o.stage ?? 0]
  const {
    stage = 0, rot = 0, sx = 1, sy = 1, lift = 0, legs = 'stand', front = [18, -22], back = null,
    eyes = mood.eyes, tache = mood.tache, hair = mood.hair, hairTilt = 0, spoutRot = 0, puff = 0, bottle: pour = -1, drop = 0,
    shine = false, sweat = o.sweat ?? mood.sweat, glug = false, comb = false,
  } = o
  const coat = OIL_COAT[stage]
  const pivotY = -8
  const cos = Math.cos(rad(rot))
  const sin = Math.sin(rad(rot))
  // Body space -> canvas.
  const T = (bx, by) => {
    const dy = by - pivotY
    return [OAX + (bx * cos - dy * sin) * sx, OAY + (bx * sin + dy * cos + pivotY - lift) * sy]
  }
  // Canvas -> body space.
  const L = (px, py) => {
    const ux = (px - OAX) / sx
    const uy = (py - OAY) / sy + lift - pivotY
    return [ux * cos + uy * sin, -ux * sin + uy * cos + pivotY]
  }
  const sr = rad(spoutRot)
  const root = [12, -35]
  const tip0 = [SPOUT_TIP[0] - root[0], SPOUT_TIP[1] - root[1]]
  const tip = [root[0] + tip0[0] * Math.cos(sr) + tip0[1] * Math.sin(sr), root[1] - tip0[0] * Math.sin(sr) + tip0[1] * Math.cos(sr)]

  // Squat: narrow shoulders, wide at the base.
  const halfW = (y) => {
    const t = Math.min(1, Math.max(0, (y - TOP) / (BOT - TOP)))
    let hw = 12 + 9 * (1 - (1 - t) ** 2)
    if (puff > 0 && y < -26 && y > -48) hw += puff * Math.sin(((y + 48) / 22) * Math.PI)
    return hw
  }
  const inBody = (x, y) => y >= TOP && y <= BOT && Math.abs(x) <= halfW(y)
  const inDome = (x, y) => y < TOP && (x / 12) ** 2 + ((y - TOP) / 5) ** 2 <= 1
  const inCap = (x, y) => y < TOP - 3 && y >= TOP - 8 && Math.abs(x + 0.5) <= (y < TOP - 6 ? 2 : 3.5)
  const inSpout = (x, y) => {
    const [d, t] = segDist(x, y, root[0], root[1], tip[0], tip[1])
    return d <= 4 - 2.4 * t
  }
  const inCollar = (x, y) => Math.hypot(x - root[0] + 1, y - root[1]) <= 4.6
  const onFace = (x, y) => x >= FACE[0] && x <= FACE[2] && y >= FACE[1] && y <= FACE[3]
  const oilAt = (x, y) => {
    if (onFace(x, y)) return false
    // The pool round his bottom has a lumpy edge.
    if (y > coat.base + Math.round(Math.sin(x * 0.8) * 1.5)) return true
    for (const [dx, len] of coat.drips) {
      if (Math.abs(x - dx) <= 1.6 && y < TOP + len) return true
      if (Math.hypot(x - dx, y - (TOP + len)) <= 2.3) return true
    }
    for (const [dx, dy, r] of coat.spots) if (Math.hypot(x - dx, y - dy) <= r) return true
    return false
  }
  const oilShade = (x, y) => (!oilAt(x - 1.6, y - 1.6) ? OIL.sheen : y > coat.base && y < coat.base + 2.5 && x < 4 ? OIL.gloss : OIL.base)

  const c = new Canvas(OW, OH)
  /** A hose-like arm with a little bend, from the shoulder to the hand. */
  const limb = (ax, ay, hx, hy, bend) => {
    const mx = (ax + hx) / 2 - (hy - ay) * bend
    const my = (ay + hy) / 2 + (hx - ax) * bend
    c.line(ax, ay, mx, my, CAN.deep, 3)
    c.line(mx, my, hx, hy, CAN.deep, 2)
  }
  if (back) {
    const [ax, ay] = T(-12, -30)
    const [hx, hy] = T(back[0], back[1])
    limb(ax, ay, hx, hy, -0.15)
  }
  // Short legs in oxblood loafers (they tuck up in the air).
  // Sitting, his legs stick out along the ground.
  const legY = legs === 'sit' ? OAY : OAY - lift * sy
  const shoe = (x, y) => stamp(c, x, y, ['..hhh...', '.bbbbbb.', 'bbbbbbbb', 'KKKKKKKKK'], { h: LOAFER.hi, b: LOAFER.base, K: LOAFER.sole })
  const legPair = {
    stand: [[-10, 0], [3, 0]],
    step: [[-13, 0], [6, -2]],
    crouch: [[-13, 0], [6, 0]],
    tuck: [[-11, -6], [2, -8]],
    sit: [[-17, 0], [11, 0]],
    glide: [[-17, 0], [8, 0]],
  }[legs]
  for (const [i, [fx, fy]] of legPair.entries()) {
    const [kx, ky] = T(i === 0 ? -6 : 6, BOT)
    c.line(kx, ky, OAX + fx + 4, legY + fy - 3, CAN.deep, 3)
    shoe(OAX + fx, legY + fy - 4)
  }

  const body = raster(OW, OH, (px, py) => {
    const [x, y] = L(px, py)
    if (inSpout(x, y)) {
      if (coat.spout && x > 22) return oilShade(x, y)
      const [, t] = segDist(x, y, root[0], root[1], tip[0], tip[1])
      return y < root[1] + (tip[1] - root[1]) * t - 1 ? BRASS.light : BRASS.shade
    }
    if (inCollar(x, y)) return x < root[0] - 1 ? BRASS.mid : BRASS.deep
    if (hair !== 'lift' && inCap(x, y)) return x < -1 ? BRASS.light : BRASS.shade
    if (inDome(x, y)) {
      if (oilAt(x, y)) return oilShade(x, y)
      if (x < -5 && y < TOP - 2) return CAN.light
      return x > 6 ? CAN.shade : CAN.mid
    }
    if (inBody(x, y)) {
      const hw = halfW(y)
      // Brass: a band at the shoulder and the rim round his base.
      if (y < TOP + 2.2) return x < -4 ? BRASS.light : x > 7 ? BRASS.shade : BRASS.mid
      if (oilAt(x, y)) return oilShade(x, y)
      if (y > BOT - 3.2) return y > BOT - 1.2 ? BRASS.deep : x < -6 ? BRASS.light : BRASS.mid
      // Slick's label: a cream band round his middle.
      if (y >= -22 && y <= -15) {
        if (y > -15.8 || x > hw - 2) return BRASS.mid
        return x > hw * 0.45 ? BRASS.light : BRASS.hi
      }
      // Green enamel, a long shine down his left side.
      if (x < -hw + 2.2) return CAN.mid
      if (x < -hw * 0.45) return Math.abs(x + hw * 0.62) < 1 && y < -24 ? WHITE : CAN.light
      if (x > hw - 2.4) return CAN.deep
      if (x > hw * 0.4) return CAN.shade
      return CAN.mid
    }
    return 0
  })
  // A teal wave on the label: the mark of Slick's.
  for (const [bx, by] of [[-3, -18], [-2, -19], [-1, -19], [0, -18], [1, -18], [2, -19], [3, -19], [4, -18], [5, -18], [6, -19]]) {
    const [px, py] = T(bx, by)
    const ix = Math.floor(px)
    const iy = Math.floor(py)
    if (body.get(ix, iy) === BRASS.hi || body.get(ix, iy) === BRASS.light) body.set(ix, iy, T0)
  }
  // Beads at the ends of his drips catch the light.
  for (const [dx, len] of coat.drips) {
    const [px, py] = T(dx - 1, TOP + len - 1)
    if (body.solid(Math.floor(px), Math.floor(py))) body.set(Math.floor(px), Math.floor(py), OIL.hi)
  }
  if (shine) {
    for (const [bx, by] of [[-13, -42], [-10, -28], [-7, -52], [8, -24]]) {
      const [px, py] = T(bx, by)
      sparkle(body, Math.floor(px), Math.floor(py), 1)
    }
  }
  // Lifted off for a refill, his cap leaves the top of him open.
  if (hair === 'lift') {
    for (let bx = -3; bx <= 2; bx++) {
      const [px, py] = T(bx, TOP - 4)
      body.set(Math.floor(px), Math.floor(py), G0)
      body.set(Math.floor(px), Math.floor(py) + 1, G0)
    }
  }
  c.blit(body, 0, 0)
  c.outline(O)

  // The hair, with its own outline: on his cap, or held up with the cap in his back hand.
  {
    const h = new Canvas(OW, OH)
    const lifted = hair === 'lift'
    const kind = lifted ? (stage === 0 ? 'slick' : stage === 1 ? 'strand' : 'flop') : hair
    const shade = hairAt(kind)
    const base = lifted ? (back ? [back[0] + 3, back[1] - 4] : [-20, -64]) : [0, TOP - 4]
    const tilt = rad(lifted ? -18 : hairTilt)
    const hc = Math.cos(tilt)
    const hs = Math.sin(tilt)
    const hr = raster(OW, OH, (px, py) => {
      const [bx, by] = L(px, py)
      const dx = bx - base[0]
      const dy = by - base[1]
      const x = dx * hc + dy * hs
      const y = -dx * hs + dy * hc
      // A lifted cap shows under the hair.
      if (lifted && y >= 0 && y <= 3 && Math.abs(x) <= 3.5) return x < 0 ? BRASS.light : BRASS.shade
      return shade(x, y)
    })
    h.blit(hr, 0, 0)
    h.outline(O)
    c.blit(h, 0, 0)
  }

  // The face: eyes above the spout, the pencil moustache under it, the bow tie below that.
  const put = (bx, by, rows, legend, flip = false) => {
    const [px, py] = T(bx, by)
    stamp(c, px, py, rows, legend, flip)
  }
  const EYE = { K: O, W: WHITE, P: G0, L: CAN.shade, w: G5 }
  if (eyes === 'wink') {
    put(-6, -47, EYES.open, EYE)
    put(4, -47, EYES.shut, EYE)
  } else {
    put(-6, -47, EYES[eyes], EYE, eyes === 'squeeze')
    put(4, -47, EYES[eyes], EYE)
  }
  if (eyes === 'worried' || eyes === 'wide') {
    put(-6, -50, ['...KK.', '.KK...'], { K: O })
    put(5, -50, ['.KK...', '...KK.'], { K: O })
  } else if (eyes === 'smug' || eyes === 'wink') {
    put(4, -50, ['.KKKK.'], { K: O })
  }
  put(5, -29, TACHE[tache], { K: O })
  if (tache === 'o') put(9, -26, ['.KKK.', 'KRRRK', 'KRRRK', '.KKK.'], { K: O, R: R1 })
  if (tache === 'grin') put(7, -26, ['KKKKKK', 'KWWWWK', '.KKKK.'], { K: O, W: WHITE })
  put(0, -25, ['KK.........KK', 'KPPK.....KPPK', 'KPWPKKKKKPWPK', 'KPPPPKpKPPPPK', 'KPPPKKKKKPPPK', 'KPPK.....KPPK', 'KK.........KK'], { K: O, P: PINK, p: R3, W: WHITE })
  if (sweat) {
    put(-16, -50, ['.s.', 'sss', 'sWs', '.s.'], { s: I1, W: WHITE })
    put(15, -52, ['s.', 'ss'], { s: I1 })
  }

  if (front) {
    const [ax, ay] = T(14, -30)
    const [hx, hy] = T(front[0], front[1])
    limb(ax, ay, hx, hy, 0.15)
    if (pour >= 0) {
      // The bottle's mouth points down into his open top.
      const [mx, my] = T(0, TOP - 9)
      bottle(c, mx, my, pour)
      if (glug) for (const [gx, gy] of [[0, TOP - 4], [-1, TOP - 1]]) {
        const [px, py] = T(gx, gy)
        oilBead(c, px, py - (pour > 0.5 ? 2 : 0), 1)
      }
    }
    if (comb) {
      // A little pink comb, run back through the quiff.
      const [cx, cy] = T(front[0] + 3, front[1] - 1)
      stamp(c, cx, cy, ['KKKKKKKK', 'KPPPPPPK', 'KPKPKPKK', '.K.K.K..'], { K: O, P: PINK })
    }
    glove(c, hx, hy)
  }
  if (back) {
    const [hx, hy] = T(back[0], back[1])
    glove(c, hx, hy)
  }
  if (drop > 0) {
    const [px, py] = T(tip[0], tip[1])
    const r = [0, 1.2, 1.8, 2.5][drop]
    const d = new Canvas(9, 10)
    d.ellipse(4, 4 + drop * 0.6, r, r + 0.5, OIL.base)
    d.set(3, 3, OIL.hi)
    d.outline(O)
    c.blit(d, Math.round(px) - 4, Math.round(py) - 1)
  }
  return c
}

/**
 * The belly slide: flat out on his front, top first, the spout ahead like a torpedo, his
 * hair streaming back, feet kicking behind. Canvas 96 x 44, anchor (48, 40): the middle of the
 * 64 x 28 slide box's bottom (the box spans x 16..80).
 */
function ollieSlide(o = {}) {
  const { stage = 0, kick = 0 } = o
  const coat = OIL_COAT[stage]
  const W = 96
  const H = 44
  const c = new Canvas(W, H)
  const cy = 27
  // Feet behind, kicking.
  c.line(22, cy - 2, 10, cy - 8 - kick * 3, CAN.deep, 3)
  c.line(22, cy + 4, 9, cy + 5 + kick * 2, CAN.deep, 3)
  const loafer = ['..bK', '.bbK', 'hbbK', 'hbbK', '.bbK', '..bK']
  stamp(c, 5, cy - 14 - kick * 3, loafer, { h: LOAFER.hi, b: LOAFER.base, K: LOAFER.sole })
  stamp(c, 4, cy + 1 + kick * 2, loafer, { h: LOAFER.hi, b: LOAFER.base, K: LOAFER.sole })
  // u runs along him from his base (0) to his top (38); v across, his back up (-).
  const half = (u) => {
    const t = Math.min(1, Math.max(0, 1 - u / 38))
    return (12 + 9 * (1 - (1 - t) ** 2)) * 0.62
  }
  const oily = (u, v) => {
    const y = -10 - u
    if (u > 24 && v > -3 && v < 6) return false
    if (y > coat.base) return true
    for (const [dx, len] of coat.drips) if (Math.abs(v - dx * 0.6) <= 1.4 && y < TOP + len) return true
    for (const [dx, dy, r] of coat.spots) if (Math.hypot(-10 - u - dy, v - dx * 0.6) <= r) return true
    return false
  }
  const body = raster(W, H, (px, py) => {
    const u = px - 20
    const v = py - cy
    if (u >= 0 && u <= 38 && Math.abs(v) <= half(u)) {
      if (u < 3) return v < 0 ? BRASS.light : BRASS.shade
      if (u > 36) return v < 0 ? BRASS.light : BRASS.shade
      if (oily(u, v)) return v < -5 ? OIL.gloss : OIL.base
      if (u >= 7 && u <= 13) return v < -4 ? BRASS.hi : v > 5 ? BRASS.mid : BRASS.light
      return v < -8 ? CAN.light : v < -2 ? CAN.mid : v > 7 ? CAN.deep : CAN.shade
    }
    // The round of his top, leading the way.
    if (u > 38 && ((u - 38) / 4.5) ** 2 + (v / 7.5) ** 2 <= 1) return v < -2 ? CAN.light : CAN.mid
    return 0
  })
  c.blit(body, 0, 0)
  // The spout straight ahead.
  const sp = raster(W, H, (px, py) => {
    const [d, t] = segDist(px, py, 46, cy + 2, 76, cy)
    if (d > 3.8 - 2.2 * t) return 0
    if (coat.spout && px > 66) return OIL.base
    return py < cy + 1 ? BRASS.light : BRASS.shade
  })
  c.blit(sp, 0, 0)
  c.outline(O)
  // His hair, flattened back by the speed (thinner as it washes out).
  const hairW = stage === 0 ? 1 : stage === 1 ? 0.85 : 0.65
  const hr = raster(W, H, (px, py) => {
    const u = px - 20
    const v = py - cy
    const along = (44 - u) / 26
    if (along < 0 || along > 1) return 0
    const top = -7 - 4 * Math.sin(along * Math.PI * 0.9) * hairW - along * 4
    const bottom = -4 - along * 6
    if (v < top || v > bottom) return 0
    return v < top + 1 ? OIL.sheen : Math.abs(v - (top + bottom) / 2) < 0.6 && along < 0.7 ? OIL.gloss : OIL.base
  })
  hr.outline(O)
  c.blit(hr, 0, 0)
  // Eyes on his top, fixed on the road ahead; the moustache streaming back.
  const eye = ['.KKKKK.', 'KLLLLLK', 'KKKKKKK', 'KWWWWPK', 'KwWWWPK', '.KKKKK.']
  stamp(c, 47, cy - 9, eye, { K: O, W: WHITE, P: G0, L: CAN.shade, w: G5 })
  stamp(c, 54, cy - 10, eye, { K: O, W: WHITE, P: G0, L: CAN.shade, w: G5 })
  stamp(c, 36, cy + 5, ['KKK............', '...KKKKKKKKKKK.', '..............K'], { K: O })
  // An arm out ahead, glove by the spout; speed lines behind.
  c.line(48, cy + 8, 63, cy + 8, CAN.deep, 2)
  glove(c, 64, cy + 8)
  for (const [lx, ly, len] of [[-2, cy - 18, 7], [0, cy - 4, 5], [-1, cy + 10, 6]]) c.rect(lx - kick * 2 + 4, ly, len, 1, I1)
  return c
}

/* ------------------------------------------------------------------ */
/* Ollie's things                                                      */
/* ------------------------------------------------------------------ */

/** An oil glob in flight: 20 x 20, its middle at (10, 10). */
function glob(n) {
  const c = new Canvas(20, 20)
  const wob = [[0, 0], [1, -1], [-1, 1]][n]
  c.ellipse(10, 10, 5.6 + wob[0] * 0.6, 5.6 + wob[1] * 0.6, OIL.base)
  // A pale rim where the light catches it, so a black glob still shows against the night.
  const body = c.clone()
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (body.solid(x, y) && (!body.solid(x - 1, y - 1) || !body.solid(x, y - 1)) && x + y < 21) c.set(x, y, G4)
  c.ellipse(8, 8, 2, 1.6, OIL.gloss)
  c.set(7, 7, OIL.hi)
  c.set(8, 7, WHITE)
  // A trailing string of oil.
  c.rect(14 + n, 11, 2, 2, OIL.base)
  c.outline(O)
  return c
}

/** An oil drop: 12 x 14, its middle at (6, 7). */
function dripDrop(n) {
  const c = new Canvas(12, 14)
  const r = n === 0 ? 2.6 : 2.9
  c.ellipse(6, 8, r, r + 0.4, OIL.base)
  c.rect(5, 3 + n, 2, 3, OIL.base)
  c.set(5, 7, OIL.hi)
  c.outline(O)
  return c
}

/** Where a glob or a drip will land: a dark oval with a pale ring that tightens as it nears. */
function landMark(n, wide = 14) {
  const w = wide + 4
  const c = new Canvas(w, 6)
  const r = wide / 2 - n
  c.ellipse(w / 2 - 0.5, 3, r, 1.6, G1)
  c.ellipse(w / 2 - 0.5, 3, r + 1, 2.2, OR1, { fill: false })
  return c
}

/** A wide shadow for where he lands from a hop (44 wide). */
function bigShadow(n) {
  const c = new Canvas(52, 8)
  c.ellipse(25.5, 4, 20 - n * 2, 2.4, G1)
  c.ellipse(25.5, 4, 21 - n * 2, 3, OR1, { fill: false })
  return c
}

/**
 * A slick of fresh oil lying on one floor tile: 32 x 14, its left edge on the tile's left and
 * row 4 on the floor's top line (anchor (0, 4)). A glossy black pool that stands proud of the
 * floor (so it reads against the fence behind), a bright sheen along its top, a broad rainbow
 * film swirling across it (4 frames), drips over the lip. Tiles side by side join up.
 */
function slick(n) {
  const c = new Canvas(32, 14)
  // The pool: 2 to 4 px above the floor line, lumpy, then down over the floor's face.
  for (let x = 0; x < 32; x++) {
    const up = 2 + ((x * 5 + 3) % 11 < 4 ? 1 : 0) + ((x * 3 + 1) % 13 < 3 ? 1 : 0)
    c.rect(x, 4 - up, 1, up + 5, OIL.base)
  }
  for (const [x, len] of [[3, 3], [11, 5], [18, 2], [26, 4]]) {
    c.rect(x, 9, 2, len, OIL.base)
    c.rect(x - 1 + (len > 3 ? 0 : 1), 9 + len - 1, 3, 2, OIL.base)
  }
  // Its top edge catches the light: a pale sheen, white where it bulges most.
  for (let x = 0; x < 32; x++) {
    let y = 0
    while (y < 14 && !c.solid(x, y)) y++
    c.set(x, y, y <= 1 ? G5 : G3)
  }
  // The film: a broad band of rainbow drifting along it, wrapping round tile to tile.
  const film = [P2, B2, T1, GR2, Y1, OR1, R4]
  for (let x = 0; x < 32; x++) {
    const k = (x + n * 8) % 32
    if (k < 21) {
      c.set(x, 4, film[Math.floor(k / 3)])
      if (k > 1 && k < 20) c.set(x, 5, film[Math.floor((k - 1) / 3)])
    }
  }
  sparkle(c, (n * 9 + 6) % 26 + 3, 2, 1)
  return c
}

/* ------------------------------------------------------------------ */
/* NIMBUS NICK                                                         */
/* ------------------------------------------------------------------ */

// Box per stage (the simulation's NICK_SIZE) and his canvas: the box plus room round it.
const NBOX = [[88, 56], [68, 44], [50, 34], [26, 20]]
const NCAN = [[124, 96], [100, 80], [80, 64], [48, 44]]
// The anchor is the middle of the bottom of his box, 14 px above the canvas's bottom (rain).
const NBELOW = 14

// Cloud colours by stage: storm dark, then paler, then the white puff.
const SKY = [
  { under: P1, deep: G1, shade: G2, mid: G3, light: G4, top: G5 },
  { under: G1, deep: G2, shade: G3, mid: G4, light: G5, top: G6 },
  { under: G2, deep: G3, shade: G4, mid: G5, light: G6, top: G6 },
  { under: G4, deep: G4, shade: G5, mid: G6, light: G6, top: G6 },
  { under: I1, deep: I1, shade: I2, mid: G6, light: G6, top: G6 },
]

// His puffs, as fractions of his box (x from the middle, y from the bottom, r of the height).
const PUFFS = [
  [0, -0.58, 0.42],
  [-0.3, -0.42, 0.33],
  [0.3, -0.44, 0.34],
  [-0.14, -0.8, 0.27],
  [0.17, -0.82, 0.25],
  [-0.46, -0.24, 0.24],
  [0.47, -0.25, 0.25],
  [0, -0.25, 0.3],
]

/**
 * One Nick frame.
 *   stage 0..3 (3 the puff), sky: colour set (default = stage; 4 for the clean beaten cloud)
 *   swell: bigger by this share, sq: squash (< 1 flatter), wob: frame of the puff wobble
 *   face: 'smug' | 'angry' | 'strain' | 'puffed' | 'blow' | 'pant' | 'hit' | 'scared' | 'happy' | 'wring'
 *   arm: 'none' | 'up' (bolt held high) | 'throw' | 'point' | 'out'
 *   rain: drops falling from his underside (frame), sweat: a drop flying off, front: cheek bulge
 */
function nick(o = {}) {
  const { stage = 0, swell = 0, sq = 1, wob = 0, face = 'smug', arm: armPose = 'none', rain = -1, sweat = false, front = 0 } = o
  const sky = SKY[o.sky ?? stage]
  const [bw, bh] = NBOX[stage]
  const [W, H] = NCAN[stage]
  const ax = W / 2
  const ay = H - NBELOW
  const k = 1 + swell
  const wobble = [[0, 0], [0.04, -0.03], [0, 0.03], [-0.04, 0]][wob % 4]
  const puffs = PUFFS.map(([x, y, r], i) => [ax + x * bw * k, ay + y * bh * k * sq, r * bh * k * (1 + (i % 2 ? wobble[0] : wobble[1]))])
  // Arms are little puffs grown out of his side, part of him.
  const ar = Math.max(2.5, bh * 0.12)
  const sideX = ax + bw * 0.46 * k
  const sideY = ay - bh * 0.4
  let boltAt = null
  if (armPose === 'up') {
    puffs.push([sideX - ar * 0.6, sideY - bh * 0.16, ar * 1.15], [sideX - ar * 0.3, sideY - bh * 0.38, ar], [sideX - ar * 0.1, sideY - bh * 0.56, ar * 0.85])
    boltAt = [sideX - ar * 0.1, sideY - bh * 0.56 - ar * 0.6]
  } else if (armPose === 'throw') {
    puffs.push([sideX + ar * 0.9, sideY + bh * 0.06, ar], [sideX + ar * 2, sideY + bh * 0.2, ar * 0.85])
  } else if (armPose === 'point') {
    puffs.push([sideX + ar * 1.1, sideY - bh * 0.1, ar], [sideX + ar * 2.3, sideY - bh * 0.16, ar * 0.7])
  } else if (armPose === 'out') {
    puffs.push([sideX + ar, sideY, ar], [ax - (sideX - ax) - ar, sideY, ar])
  }
  if (front > 0) puffs.push([ax + bw * 0.4 * k, ay - bh * 0.48, bh * 0.2 * front])
  const inside = (x, y) => {
    if (y > ay + 1) return false
    for (const [px, py, r] of puffs) if ((x - px) ** 2 + (y - py) ** 2 <= r * r) return true
    return false
  }
  const c = raster(W, H, (x, y) => {
    if (!inside(x, y)) return 0
    // A flat dark belly, light from the top left.
    if (y > ay - 3) return sky.under
    const up = !inside(x - 2.4, y - 2.8)
    const dn = !inside(x + 2, y + 3.2)
    if (up && !inside(x - 1.2, y - 5)) return sky.top
    if (up) return sky.light
    if (dn) return y > ay - 8 ? sky.deep : sky.shade
    return y > ay - bh * 0.3 ? sky.shade : sky.mid
  })
  for (const [px, py, r] of puffs.slice(0, 3)) {
    if (r < 9) continue
    c.line(px - r * 0.55, py + r * 0.2, px - r * 0.15, py + r * 0.4, sky.shade)
  }
  c.outline(O)
  if (boltAt) {
    const b = Canvas.fromText(['...YY', '..YY.', '.YYYY', '...Y.', '..Y..', '.Y...', 'Y....'], { Y: Y2 })
    const bb = new Canvas(b.w + 2, b.h + 2)
    bb.blit(b, 1, 1)
    bb.outline(O)
    c.blit(bb, Math.round(boltAt[0]) - 3, Math.round(boltAt[1]) - 8)
    if (wob % 2 === 0) sparkle(c, Math.round(boltAt[0]) + 5, Math.round(boltAt[1]) - 9, 1, Y2)
    else sparkle(c, Math.round(boltAt[0]) - 4, Math.round(boltAt[1]) - 5, 1, Y2)
  }

  // His face, a little toward the front (right), sized to him.
  const fx = Math.round(ax + bw * 0.08)
  const fy = Math.round(ay - bh * (stage === 2 ? 0.68 : 0.56) * sq)
  const lw = Math.max(5, Math.round(bw * 0.17))
  const lh = Math.max(4, Math.round(bh * 0.17))
  const gap = Math.max(2, Math.round(bw * 0.045))

  const lens = (x, y, w, h) => {
    const l = new Canvas(w + 2, h + 2)
    l.rect(1, 1, w, h, G0)
    l.set(1, h, 0)
    l.set(w, h, 0)
    // The gloss that says sunglasses.
    l.set(2, 2, WHITE)
    if (w > 6) {
      l.set(3, 2, B3)
      l.set(2, 3, B3)
    }
    if (h > 5) l.set(w - 1, h - 2, B1)
    l.outline(O)
    c.blit(l, Math.round(x) - 1, Math.round(y) - 1)
  }
  /** The shades: dy lower than his eyes, tilt px lower at the front end, `nose` = sliding off. */
  const shades = (dy, tilt) => {
    const x0 = fx - lw - Math.floor(gap / 2)
    const y0 = fy - Math.floor(lh / 2) + dy
    lens(x0, y0, lw, lh)
    lens(x0 + lw + gap, y0 + tilt, lw, lh)
    c.line(x0 - 1, y0, x0 + 2 * lw + gap, y0 + tilt, O, 1)
    c.rect(x0 + lw, y0 + Math.round(tilt / 2), gap, 2, O)
    // The arm of the frames back toward his ear.
    c.line(x0 - 1, y0 + 1, x0 - Math.round(bw * 0.12), y0 - 1, O, 1)
  }
  const eyes = (dy, kind) => {
    const ew = Math.max(4, Math.round(lw * 0.7))
    const eh = Math.max(4, Math.round(lh * 1.1))
    for (const ex of [fx - Math.floor(gap / 2) - Math.round(lw * 0.85), fx + Math.ceil(gap / 2) + Math.round(lw * 0.15)]) {
      const e = new Canvas(ew + 2, eh + 2)
      if (kind === 'shut') {
        e.rect(1, Math.floor(eh / 2), ew, 1, O)
      } else if (kind === 'happy') {
        e.line(1, eh - 1, Math.floor(ew / 2), Math.floor(eh / 2), O)
        e.line(Math.floor(ew / 2) + 1, Math.floor(eh / 2), ew, eh - 1, O)
      } else if (kind === 'x') {
        e.line(1, 1, ew, eh, O)
        e.line(ew, 1, 1, eh, O)
      } else {
        e.ellipse(ew / 2 + 0.5, eh / 2 + 0.5, ew / 2 - 0.5, eh / 2 - 0.5, WHITE)
        e.outline(O)
        const px = kind === 'up' ? Math.round(ew / 2) : Math.round(ew / 2) + 1
        const py = kind === 'up' ? 2 : Math.round(eh / 2) + 1
        e.rect(px, py, eh > 5 ? 2 : 1, eh > 5 ? 2 : 1, G0)
      }
      c.blit(e, Math.round(ex), fy + dy - Math.floor(eh / 2))
    }
  }
  const brows = (dy, kind) => {
    const bwid = Math.max(3, Math.round(lw * 0.6))
    const by = fy - Math.floor(lh / 2) - 3 + dy
    const l0 = fx - Math.floor(gap / 2) - Math.round(lw * 0.8)
    const r0 = fx + Math.ceil(gap / 2) + Math.round(lw * 0.2)
    if (kind === 'angry') {
      c.line(l0, by - 2, l0 + bwid, by, O, 2)
      c.line(r0, by, r0 + bwid, by - 2, O, 2)
    } else if (kind === 'worried') {
      c.line(l0, by, l0 + bwid, by - 2, O, 1)
      c.line(r0, by - 2, r0 + bwid, by, O, 1)
    } else if (kind === 'smug') {
      c.line(r0, by - 1, r0 + bwid, by - 3, O, 2)
    }
  }
  const mw = Math.max(5, Math.round(bw * 0.26))
  const slipBy = stage === 0 ? 0 : stage === 1 ? Math.round(lh * 0.55) : Math.round(lh * 1.2)
  let my = fy + Math.max(Math.round(lh * 0.9), slipBy + lh) + 2
  const mouth = (kind) => {
    const x0 = fx - Math.floor(mw / 2)
    if (kind === 'smirk') {
      // A cocky grin, up at the front corner, teeth showing.
      const m = new Canvas(mw + 2, 7)
      const h = Math.min(4, Math.max(2, Math.round(bh * 0.06)))
      for (let i = 0; i < mw; i++) {
        const lift = Math.round((i / (mw - 1)) ** 2 * 3)
        m.rect(i + 1, 4 - lift, 1, h - (i < 2 ? 1 : 0), i > 1 && i < mw - 1 ? WHITE : O)
      }
      m.outline(O)
      c.blit(m, x0, my - 3)
    } else if (kind === 'grit') {
      const m = new Canvas(mw + 2, 6)
      m.rect(1, 1, mw, 3, WHITE)
      for (let i = 2; i < mw; i += 3) m.rect(i + 1, 1, 1, 3, G4)
      m.outline(O)
      c.blit(m, x0, my - 1)
    } else if (kind === 'flat') {
      c.line(x0 + 2, my + 1, x0 + mw - 2, my, O, 1)
    } else if (kind === 'wavy') {
      for (let i = 0; i < mw - 2; i++) c.set(x0 + 2 + i, my + ((i >> 1) & 1), O)
    } else if (kind === 'o' || kind === 'blow') {
      const r = Math.max(1.5, bh * 0.07)
      const m = new Canvas(Math.ceil(r * 2) + 4, Math.ceil(r * 2) + 4)
      m.circle(m.w / 2 - 0.5, m.h / 2 - 0.5, r, R1)
      m.outline(O)
      c.blit(m, Math.round(fx + (kind === 'blow' ? lw * 0.6 : 0) - m.w / 2), my - 1)
    } else if (kind === 'pant') {
      const m = new Canvas(mw + 2, 9)
      m.rect(2, 1, mw - 2, 4, R1)
      m.rect(Math.floor(mw / 2), 3, 3, 4, PINK)
      m.outline(O)
      c.blit(m, x0, my - 1)
    } else if (kind === 'smile') {
      for (let i = 0; i < mw - 2; i++) c.set(x0 + 2 + i, my + (i === 0 || i === mw - 3 ? 0 : 1), O)
    }
  }

  if (stage === 3) {
    // The puff: the shades are gone. Big scared eyes.
    if (face === 'hit') eyes(-1, 'x')
    else if (face === 'happy') eyes(-1, 'happy')
    else eyes(-1, 'up')
    if (face === 'happy') {
      mouth('smile')
      c.set(fx - lw - 2, my - 1, PINK)
      c.set(fx + lw + 2, my - 1, PINK)
    } else {
      mouth('o')
    }
    if (sweat) stamp(c, fx + lw + 3, fy - 6, ['.s', 'ss', 's.'], { s: I1 })
  } else if (face === 'hit') {
    // Knocked: the shades jump crooked, his mouth pops open.
    if (stage > 0) eyes(-3, 'x')
    brows(stage > 0 ? -3 : -2, 'worried')
    shades(slipBy - 2, 3)
    mouth('o')
  } else if (face === 'pant') {
    // Out of breath: shades knocked crooked, tongue out under them.
    if (stage > 0) eyes(-3, 'shut')
    shades(slipBy + 1, Math.round(lh * 0.6))
    my += Math.round(lh * 0.5)
    mouth('pant')
    if (sweat) stamp(c, fx + lw + 4, fy - lh - 3, ['.s', 'ss', 's.'], { s: I1 })
  } else if (face === 'happy') {
    eyes(-1, 'happy')
    mouth('smile')
  } else {
    // The shades by stage: on, slipping, down his nose with worried eyes over them.
    const slip = slipBy
    if (stage >= 1) eyes(stage === 1 ? -2 : -3, 'up')
    if (face === 'angry' || face === 'strain' || face === 'puffed') brows(stage >= 1 ? -2 : 0, 'angry')
    else if (stage >= 1) brows(-3, 'worried')
    else brows(0, 'smug')
    shades(slip, stage === 1 ? 1 : 0)
    const m = { smug: stage === 0 ? 'smirk' : stage === 1 ? 'flat' : 'wavy', angry: 'grit', strain: 'grit', puffed: 'flat', blow: 'blow', wring: 'wavy' }[face] ?? 'flat'
    mouth(m)
    if (face === 'puffed') {
      c.set(fx + lw + 3, my - 2, sky.top)
      c.set(fx - lw - 3, my - 2, sky.top)
    }
    if (sweat || (stage === 2 && face === 'smug')) stamp(c, fx + lw + 4, fy - lh - 3, ['.s', 'ss', 's.'], { s: I1 })
  }
  // Rain from his underside, two frames.
  if (rain >= 0) {
    for (let i = 0; i < 7; i++) {
      const x = Math.round(ax - bw * 0.4 + (i * bw * 0.8) / 6 + ((i * 5 + rain * 3) % 4) - 2)
      const y = ay + 2 + ((i * 7 + rain * 5) % 9)
      c.rect(x, y, 1, 3, M1)
      c.set(x, y + 3, G3)
    }
  }
  return { canvas: c, ax, ay }
}

/** The little clean cloud he ends as. */
function nickBeaten(n) {
  return nick({ stage: 3, sky: 4, face: 'happy', wob: n })
}

/** A small clean rainbow: 44 x 24, its foot's middle at (22, 24). */
function rainbow(n) {
  const c = new Canvas(44, 26)
  const bands = [R3, OR1, Y1, GR2, B2, P2]
  for (let y = 0; y < 26; y++) {
    for (let x = 0; x < 44; x++) {
      const d = Math.hypot(x + 0.5 - 22, y + 0.5 - 25)
      const i = Math.floor(19 - d)
      if (i >= 0 && i < 6 && y < 25) c.set(x, y, bands[i])
    }
  }
  if (n === 1) {
    sparkle(c, 8, 6, 1)
    sparkle(c, 36, 9, 1)
  }
  return c
}

/* ---- rain, lightning and wind ---- */

/** A dirty raindrop streak: 2 x 10, brown with a pale head (it reads on the night sky). */
function rainDrop(n) {
  const c = new Canvas(2, 10)
  c.rect(0, 0, 1, 7, n === 0 ? PAL.mud[3] : PAL.mud[2])
  c.rect(1, 2, 1, 7, PAL.mud[3])
  c.rect(0, 7, 2, 2, PAL.mud[4])
  c.set(1, 9, PAL.mud[4])
  return c
}
/** The faint show of where rain will fall: 2 x 4 dotted. */
function rainHint() {
  const c = new Canvas(2, 6)
  c.set(0, 0, G3)
  c.set(0, 3, G2)
  return c
}
/** The little dark cloud each column of rain hangs from: 40 x 16, middle at (20, 10). */
function rainCloud(n, faint) {
  const c = raster(40, 16, (x, y) => {
    const blobs = [[12, 10, 6], [20, 7, 7], [28, 10, 6], [20, 11, 5]]
    for (const [bx, by, r] of blobs) if ((x - bx) ** 2 + (y - by - (n && bx === 20 ? 1 : 0)) ** 2 <= r * r) return faint ? P1 : y < 7 ? G3 : G2
    return 0
  })
  if (!faint) c.outline(O)
  return c
}
/** A splash where rain meets the floor: 12 x 6, bottom middle (6, 6). */
function rainSplash(n) {
  const c = new Canvas(12, 6)
  if (n === 0) {
    c.set(3, 3, M1)
    c.set(8, 2, M1)
    c.rect(4, 5, 4, 1, PAL.mud[2])
  } else {
    c.set(2, 2, M1)
    c.set(9, 1, M1)
    c.set(5, 3, G3)
    c.rect(3, 5, 6, 1, PAL.mud[2])
  }
  return c
}
/** The lightning mark on the ground: 40 x 12, centred at (20, 9) on the surface. It tightens (n 0..2). */
function boltMark(n) {
  const c = new Canvas(40, 12)
  const r = 17 - n * 3
  c.ellipse(19.5, 9, r, 2.6, Y1)
  c.ellipse(19.5, 9, r - 3, 1.6, Y2)
  c.ellipse(19.5, 9, r, 2.6, OR1, { fill: false })
  c.rect(17, 7, 6, 3, WHITE)
  // Sparks jumping round it.
  const sp = [[5, 4], [33, 3], [20, 1], [11, 2], [28, 5], [2, 6]]
  for (let i = 0; i < 3; i++) {
    const [x, y] = sp[(i * 2 + n) % sp.length]
    sparkle(c, x, y, 1, Y2)
  }
  return c
}
/** A piece of the bolt: 24 x 32, tiled down the strike. */
function boltSeg(n) {
  const c = new Canvas(24, 32)
  const pts = n === 0 ? [[12, 0], [7, 9], [15, 14], [8, 24], [12, 32]] : [[12, 0], [16, 8], [9, 15], [16, 23], [12, 32]]
  for (let i = 0; i + 1 < pts.length; i++) c.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], Y2, 3)
  for (let i = 0; i + 1 < pts.length; i++) c.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], WHITE, 1)
  const halo = c.clone()
  c.outline(B3)
  c.blit(halo, 0, 0)
  return c
}
/** The strike's foot: a burst on the ground, 32 x 14, bottom middle (16, 14). */
function boltHit(n) {
  const c = new Canvas(32, 14)
  const rays = n === 0 ? [[-12, -2], [-8, -9], [0, -12], [8, -9], [12, -2]] : [[-13, -4], [-6, -11], [6, -11], [13, -4]]
  for (const [dx, dy] of rays) c.line(16, 13, 16 + dx, 13 + dy, Y2, 1)
  c.ellipse(15.5, 12, 5, 2, WHITE)
  return c
}
/** Scorch left behind: 26 x 4. */
function scorch() {
  const c = new Canvas(26, 4)
  c.ellipse(12.5, 2, 11, 1.5, G0)
  c.set(6, 1, G2)
  c.set(18, 2, G2)
  return c
}
/** A wind streak, len long, blowing right: bright while it blows, dashed and pale before. */
function gustStreak(len, faint) {
  const c = new Canvas(len + 2, 3)
  if (faint) {
    for (let x = 0; x < len; x += 5) c.rect(x, 1, 3, 1, x > len - 8 ? I2 : I0)
    c.set(len - 1, 0, I2)
    c.set(len - 1, 2, I2)
  } else {
    c.rect(0, 1, len, 1, I2)
    c.rect(len - 6, 0, 5, 1, WHITE)
    c.rect(len - 3, 1, 3, 1, WHITE)
  }
  return c
}

/* ------------------------------------------------------------------ */
/* The atlas                                                           */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('rivals_b', { script: 'art-rivals-b.mjs' })
/** name -> [{ label, canvas, ax, ay }], for the review sheets. */
const shown = {}
function anim(name, frames, ax, ay) {
  const list = frames.map((f, i) => (f instanceof Canvas ? { canvas: f, ax, ay, label: `${name}${i}` } : { canvas: f.canvas, ax: f.ax, ay: f.ay, label: `${name}${i}` }))
  atlas.addAnim(name, list.map((f) => ({ canvas: f.canvas, ax: f.ax, ay: f.ay })))
  shown[name] = list
}

// Ollie, per stage of oil (o0 oily .. o2 nearly clean, o3 spotless).
const OLLIE_POSES = {
  idle: [{}, { drop: 1 }, { drop: 2 }, { eyes: 'shut', drop: 3 }],
  hit: [{ eyes: 'squeeze', tache: 'o', rot: -6, front: [22, -36], hairTilt: -6 }],
  // The intro: a comb back through the quiff, then a little bow and a wink.
  bow: [{ rot: -4, front: [-2, -58], comb: true, back: [-22, -20], eyes: 'smug' }, { rot: 16, front: [6, -14], back: [-24, -22], eyes: 'wink', tache: 'grin' }],
  squirtTell: [{ rot: -10, puff: 2, spoutRot: 14, eyes: 'squeeze', tache: 'droop', front: [-4, -18] }, { rot: -13, puff: 3, spoutRot: 18, eyes: 'squeeze', tache: 'droop', front: [-6, -18] }],
  squirt: [{ rot: 4, spoutRot: 12, front: [24, -30] }, { rot: 1, spoutRot: 8, front: [22, -26] }],
  glide: [{ rot: -8, legs: 'glide', front: [-12, -20], back: [-20, -24] }, { rot: -6, legs: 'step', front: [-10, -22], back: [-18, -22] }],
  windup: [{ rot: -6, legs: 'step', front: [-14, -42] }, { rot: 6, legs: 'crouch', sy: 0.96, front: [-28, -22], eyes: 'down' }, { rot: 16, legs: 'crouch', sy: 0.92, front: [-32, -12], eyes: 'down', tache: 'grin' }],
  dizzy: [{ rot: -4, eyes: 'spiral', tache: 'droop', hairTilt: -18, front: [18, -18] }, { rot: 4, eyes: 'spiral', tache: 'droop', hairTilt: 12, front: [16, -20] }],
  crouch: [{ legs: 'crouch', sy: 0.86, sx: 1.06, front: [16, -18] }],
  air: [{ legs: 'tuck', sy: 1.06, sx: 0.96, lift: 10, eyes: 'open', front: [18, -42], back: [-18, -44] }],
  land: [{ legs: 'crouch', sy: 0.84, sx: 1.08, eyes: 'shut', front: [20, -16] }],
  shuffle: [{ legs: 'step', rot: 2, front: [18, -22] }, { legs: 'stand', rot: -2, front: [16, -24] }],
  lean: [{ rot: 12, spoutRot: -34, eyes: 'down', front: [20, -40], drop: 2 }, { rot: 14, spoutRot: -38, eyes: 'down', front: [22, -42], drop: 3 }],
  // The refill: cap and hair off in one hand (it is all one piece), the bottle in the other.
  refill: [
    { hair: 'lift', back: [-22, -58], front: [8, -64], bottle: 0, eyes: 'shut', tache: 'o', rot: -6 },
    { hair: 'lift', back: [-23, -60], front: [7, -66], bottle: 0.5, eyes: 'shut', tache: 'o', rot: -8, puff: 1, glug: true },
    { hair: 'lift', back: [-22, -58], front: [6, -65], bottle: 1, eyes: 'happy', tache: 'o', rot: -7, puff: 2, glug: true },
  ],
  burp: [{ rot: -10, puff: 3, eyes: 'shut', tache: 'o', front: [20, -20] }],
  stagger: [
    { rot: -12, eyes: 'wide', tache: 'o', hair: 'wild', front: [26, -46], back: [-26, -44], legs: 'step', sweat: true },
    { rot: 10, eyes: 'squeeze', tache: 'droop', hair: 'wild', hairTilt: 8, front: [24, -20], back: [-24, -48], legs: 'step', sweat: true },
  ],
}
for (let stage = 0; stage < 3; stage++) {
  for (const [pose, frames] of Object.entries(OLLIE_POSES)) anim(`o${stage}${pose}`, frames.map((f) => ollie({ stage, ...f })), OAX, OAY)
  anim(`o${stage}slide`, [0, 1].map((kick) => ollieSlide({ stage, kick })), 48, 40)
}
// Beaten: spotless and bald. He feels for his hair, aghast; then he sees his shine.
anim('o3beaten', [{ eyes: 'wide', tache: 'o', legs: 'sit', lift: -6, rot: -4, front: [2, -60], shine: true }, { eyes: 'happy', tache: 'grin', legs: 'sit', lift: -6, rot: 2, front: [20, -24], shine: true }].map((f) => ollie({ stage: 3, ...f })), OAX, OAY)
anim('o3idle', [ollie({ stage: 3, shine: true })], OAX, OAY)
anim('glob', [0, 1, 2].map(glob), 10, 10)
anim('drip', [0, 1].map(dripDrop), 6, 7)
anim('dripSwell', [1, 2, 3].map((n) => {
  const c = new Canvas(9, 10)
  const r = [0, 1.2, 1.8, 2.5][n]
  c.ellipse(4, 4 + n * 0.6, r, r + 0.5, OIL.base)
  c.set(3, 3, OIL.hi)
  c.outline(O)
  return c
}), 4, 1)
anim('globMark', [0, 1, 2].map((n) => landMark(n)), 9, 3)
anim('dripMark', [0, 1].map((n) => landMark(n, 10)), 7, 3)
anim('landShadow', [0, 1].map(bigShadow), 26, 4)
anim('slick', [0, 1, 2, 3].map(slick), 0, 4)

// Nick, per stage (n0 big and smug .. n2 small and worried, n3 the puff).
const NICK_POSES = {
  float: [0, 1, 2, 3].map((wob) => ({ wob })),
  hit: [{ face: 'hit', sq: 0.94, wob: 1 }],
  rainTell: [{ swell: 0.06, face: 'angry', wob: 1 }, { swell: 0.09, face: 'angry', wob: 3 }],
  rain: [{ swell: 0.04, face: 'strain', rain: 0, wob: 0 }, { swell: 0.04, face: 'strain', rain: 1, wob: 2 }],
  boltTell: [{ face: 'angry', arm: 'up', wob: 0 }, { face: 'angry', arm: 'up', wob: 1 }],
  bolt: [{ face: 'smug', arm: 'throw', wob: 2 }, { face: 'smug', arm: 'point', wob: 3 }],
  gustTell: [{ face: 'puffed', front: 0.8, swell: 0.03, wob: 0 }, { face: 'puffed', front: 1, swell: 0.05, wob: 1 }],
  gust: [{ face: 'blow', wob: 2, front: 0.4 }, { face: 'blow', wob: 3, front: 0.2 }],
  pant: [{ face: 'pant', sq: 0.86, wob: 0, sweat: true }, { face: 'pant', sq: 0.9, wob: 2, sweat: false }],
  wring: [{ face: 'wring', sq: 1.08, swell: -0.08, rain: 0, wob: 1 }, { face: 'wring', sq: 0.92, swell: 0.02, rain: 1, wob: 3 }],
}
for (let stage = 0; stage < 3; stage++) {
  for (const [pose, frames] of Object.entries(NICK_POSES)) anim(`n${stage}${pose}`, frames.map((f) => nick({ stage, ...f })))
}
anim('n3puff', [0, 1, 2, 3].map((wob) => nick({ stage: 3, wob, sweat: wob % 2 === 0 })))
anim('n3hit', [nick({ stage: 3, face: 'hit' })])
anim('n3beaten', [0, 1].map(nickBeaten))
anim('rainbow', [0, 1].map(rainbow), 22, 25)
anim('rainDrop', [0, 1].map(rainDrop), 1, 9)
anim('rainHint', [rainHint()], 0, 0)
anim('rainCloud', [0, 1].map((n) => rainCloud(n, false)), 20, 10)
anim('rainCloudFaint', [0, 1].map((n) => rainCloud(n, true)), 20, 10)
anim('rainSplash', [0, 1].map(rainSplash), 6, 6)
anim('boltMark', [0, 1, 2].map(boltMark), 20, 9)
anim('boltSeg', [0, 1].map(boltSeg), 12, 0)
anim('boltHit', [0, 1].map(boltHit), 16, 14)
anim('scorch', [scorch()], 13, 3)
anim('gust', [40, 28, 18].map((len) => gustStreak(len, false)), 0, 1)
anim('gustFaint', [40, 28, 18].map((len) => gustStreak(len, true)), 0, 1)

atlas.meta({
  facing: 'Everything faces right. Mirror it (flipX) when entity.facing is -1.',
  ollie: {
    anchor: 'o<stage><pose> frames are anchored at the middle of his feet: draw at (e.x + e.w / 2, e.y + e.h). <stage> is vars.stage (0 oily, 1, 2); o3 is spotless (beaten). The slide frames are anchored at the middle of the bottom of the 64 x 28 slide box.',
    spoutTip: SPOUT_TIP,
    poses: Object.keys(OLLIE_POSES).concat(['slide']),
    ticks: { idle: [40, 30, 30, 8], shuffle: [10, 10], glide: [6, 6], dizzy: [8, 8], slide: [4, 4], refill: [14, 14, 14], stagger: [6, 6], bow: [20, 40], lean: [8, 8], squirtTell: [8, 8], squirt: [6, 12], beaten: [40, 40] },
  },
  nick: {
    anchor: 'n<stage><pose> frames are anchored at the middle of the bottom of his box: draw at (e.x + e.w / 2, e.y + e.h). n3 is the puff; n3beaten the little clean cloud he ends as (draw the rainbow under him).',
    box: NBOX,
    poses: Object.keys(NICK_POSES),
    ticks: { float: [10, 10, 10, 10], rainTell: [4, 4], rain: [5, 5], boltTell: [5, 5], bolt: [8, 8], gustTell: [6, 6], gust: [4, 4], pant: [12, 12], wring: [6, 6], puff: [6, 6, 6, 6], beaten: [30, 30] },
  },
  props: 'glob (middle-anchored) and globMark (on the floor, middle); drip, dripSwell (top at the spout tip), dripMark; landShadow (floor, middle); slick (32 wide: its anchor at the left end of the floor line of an oily tile; draw one per tile). rainCloud / rainCloudFaint (middle) top each rain column, rainDrop streaks (tip anchored) fill it, rainHint dots show it faintly, rainSplash on the floor; boltMark (middle, on the surface), boltSeg tiled down the strike (top middle), boltHit at its foot, scorch after; gust and gustFaint streaks blowing right (left end anchored); rainbow (foot middle).',
})

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write()
console.log(`rivals_b atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames`)

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const rows = (names) => names.filter((n) => shown[n]).map((n) => ({ label: n, frames: shown[n] }))
  const groups = {
    ollie0: Object.keys(OLLIE_POSES).map((p) => `o0${p}`).concat(['o0slide']),
    ollie1: Object.keys(OLLIE_POSES).map((p) => `o1${p}`).concat(['o1slide']),
    ollie2: Object.keys(OLLIE_POSES).map((p) => `o2${p}`).concat(['o2slide', 'o3idle', 'o3beaten']),
    ollieprops: ['glob', 'drip', 'dripSwell', 'globMark', 'dripMark', 'landShadow', 'slick'],
    nick0: Object.keys(NICK_POSES).map((p) => `n0${p}`),
    nick1: Object.keys(NICK_POSES).map((p) => `n1${p}`),
    nick2: Object.keys(NICK_POSES).map((p) => `n2${p}`).concat(['n3puff', 'n3hit', 'n3beaten', 'rainbow']),
    nickprops: ['rainDrop', 'rainHint', 'rainCloud', 'rainCloudFaint', 'rainSplash', 'boltMark', 'boltSeg', 'boltHit', 'scorch', 'gust', 'gustFaint'],
  }
  // The backlot at night: its sky bands and its wall.
  const BACKS = { night: '#1a1033', dusk: '#3f2d78', wall: G1 }
  for (const [g, names] of Object.entries(groups)) {
    for (const [bgName, bg] of Object.entries(BACKS)) {
      contactSheet(rows(names), { bg, scale: 3, wrap: 6, file: path.join(REVIEW, `sheet_${g}_${bgName}_3x.png`) })
    }
    contactSheet(rows(names), { bg: BACKS.night, scale: 3, wrap: 6, flipX: true, file: path.join(REVIEW, `sheet_${g}_night_3x_flip.png`) })
    contactSheet(rows(names), { bg: BACKS.night, scale: 1, wrap: 6, labels: false, file: path.join(REVIEW, `sheet_${g}_night_1x.png`) })
    contactSheet(rows(names), { bg: BACKS.dusk, scale: 1, wrap: 6, labels: false, flipX: true, file: path.join(REVIEW, `sheet_${g}_dusk_1x_flip.png`) })
  }

  // Line-ups beside Maxx, on the backlot's ground, as the game will show them.
  const maxxTs = fs.readFileSync(path.join(ASSETS_DIR, 'maxx.atlas.ts'), 'utf8')
  const m = /idle0: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+) \}/.exec(maxxTs)
  const sheet = Canvas.load(path.join(ASSETS_DIR, 'maxx.png'))
  const hero = m ? { canvas: sheet.crop(+m[1], +m[2], +m[3], +m[4]), ax: +m[5], ay: +m[6] } : null
  const put = (scene, f, x, y, flip = false) => scene.blit(f.canvas, flip ? x - (f.canvas.w - f.ax) : x - f.ax, y - f.ay, { flipX: flip })
  const F = (name, i = 0) => shown[name][i]
  {
    const scene = new Canvas(640, 150, BACKS.night)
    const gy = 128
    scene.rect(0, gy, 640, 22, G2)
    if (hero) put(scene, hero, 30, gy)
    const line = [['o0idle', 0], ['o0squirtTell', 1], ['o0windup', 2], ['o1lean', 0], ['o1refill', 1], ['o2stagger', 0], ['o2dizzy', 0], ['o3beaten', 0]]
    line.forEach(([n, i], k) => put(scene, F(n, i), 100 + k * 64, gy, k % 2 === 1))
    put(scene, F('o0slide', 0), 600, gy, true)
    scene.save(path.join(REVIEW, 'lineup_ollie_1x.png'))
    scene.scale(3).save(path.join(REVIEW, 'lineup_ollie_3x.png'))
  }
  {
    const scene = new Canvas(640, 200, BACKS.night)
    const gy = 178
    scene.rect(0, gy, 640, 22, G2)
    if (hero) put(scene, hero, 30, gy)
    put(scene, F('n0float', 0), 120, 90)
    put(scene, F('n0rain', 0), 240, 90)
    put(scene, F('n1boltTell', 0), 350, 110)
    put(scene, F('n1pant', 0), 440, 120)
    put(scene, F('n2gust', 0), 520, 130, true)
    put(scene, F('n3puff', 0), 590, gy - 20)
    put(scene, F('rainbow', 1), 600, gy - 30)
    put(scene, F('n3beaten', 0), 600, gy - 44)
    scene.save(path.join(REVIEW, 'lineup_nick_1x.png'))
    scene.scale(3).save(path.join(REVIEW, 'lineup_nick_3x.png'))
  }
  // Close-ups of the faces that carry each fight, at 4x.
  for (const [file, names] of [
    ['portrait_ollie', [['o0idle', 0], ['o1idle', 0], ['o2idle', 0], ['o3beaten', 0], ['o3beaten', 1], ['o0bow', 0], ['o0bow', 1], ['o1refill', 1], ['o2stagger', 0], ['o0windup', 2], ['o1dizzy', 0], ['o0squirtTell', 1]]],
    ['portrait_nick', [['n0float', 0], ['n0rainTell', 0], ['n0boltTell', 0], ['n0gustTell', 1], ['n0pant', 0], ['n1float', 0], ['n1pant', 0], ['n2float', 0], ['n2pant', 0], ['n2wring', 0], ['n3puff', 0], ['n3beaten', 0]]],
  ]) {
    contactSheet(names.map(([n, i]) => ({ ...shown[n][i], label: `${n}${i}` })), { bg: BACKS.night, scale: 4, wrap: 6, file: path.join(REVIEW, `${file}_4x.png`) })
  }
  console.log(`review sheets in ${REVIEW}`)
}
