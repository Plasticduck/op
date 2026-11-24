// art-critters.mjs: generates the 'critters' atlas: the grime blob, the grackle and its
// splat, the bug swarm and the tumbleweed (simulated in game/sim/entities/critters.ts,
// drawn by game/render/entities/critters.ts).
//
//   node scripts/maxx/art-critters.mjs                  writes critters.png + critters.atlas.ts
//   node scripts/maxx/art-critters.mjs --review <dir>   also writes contact sheets into <dir>:
//       each animation as a strip at 1x and 4x, on sky, tunnel wall and night, plain and
//       mirrored, line-ups beside Maxx on the ground at 1x and 3x, and boxes_4x.png (the
//       simulation's collision boxes drawn over the art)
//
// Everything is drawn here from shapes and a few hand-placed pixels; nothing is traced.
// All of it faces RIGHT (the renderer mirrors it when the entity faces left) and is lit
// from the top left, with Maxx's own outline colour.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const O = PAL.outline
const MUD = PAL.mud
const WHITE = PAL.grey[6]
const SUDS = { light: WHITE, mid: PAL.ice[2], shade: PAL.ice[1] }

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

function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Hand-placed pixels: one character per pixel from `legend`, '.' leaves what is there. */
function stamp(c, x, y, rows, legend) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch === '.') continue
      if (ch === '_') c.set(x + i, y + j, 0)
      else if (!(ch in legend)) throw new Error(`stamp: no colour for '${ch}'`)
      else c.set(x + i, y + j, legend[ch])
    }
  })
  return c
}

/** A soap bubble with its own outline, ready to be laid over something. */
function bubble(r, { ring = O } = {}) {
  const size = Math.ceil(r * 2) + 3
  const m = size / 2
  const inside = (x, y) => Math.hypot(x - m, y - m) <= r
  const c = raster(size, size, (x, y) => {
    if (!inside(x, y)) return 0
    if (!inside(x + 1.1, y + 1.1)) return SUDS.shade
    if (!inside(x - 1.1, y - 1.1)) return SUDS.light
    return SUDS.mid
  })
  if (r >= 2.4) c.set(Math.floor(m - r * 0.45), Math.floor(m - r * 0.45), SUDS.light)
  if (ring) c.outline(ring)
  return { canvas: c, m }
}
const putBubble = (c, x, y, r, opts) => {
  const b = bubble(r, opts)
  c.blit(b.canvas, Math.round(x - b.m), Math.round(y - b.m))
}

/** A four-point glint. */
function sparkle(c, x, y, r, col = WHITE) {
  c.rect(x - r, y, 2 * r + 1, 1, col)
  c.rect(x, y - r, 1, 2 * r + 1, col)
}

/* ------------------------------------------------------------------ */
/* Blob: a grumpy heap of road grime                                   */
/* ------------------------------------------------------------------ */

// Canvas 36 x 32, anchored bottom-centre: the outline's lowest row is row 31, the ground is 32.
// It is goo, not a mushroom: a wet, lumpy heap that leans the way it oozes, sits in its own
// puddle, has grit stuck in it, and looks at the world through heavy, unimpressed lids.
const BLOB_W = 36
const BLOB_H = 32
const BCX = BLOB_W / 2
const BG = BLOB_H - 1
const GRIT = { K: O, a: PAL.grey[4], b: PAL.grey[3], c: PAL.grey[2] }

// Per stage (e.hp): the body (without its outline), and the suds that take its place as it is washed.
// Stage 3 fills the 30 x 28 box with its outline; the suds keep the smaller ones about as tall.
const STAGE = {
  3: { bw: 28, bh: 26, suds: [] },
  2: { bw: 25, bh: 21, suds: [[-6, 2, 3.1], [7, 3, 2.6], [1, -1, 3.7]] },
  1: { bw: 22, bh: 16, suds: [[-7, 2, 2.9], [8, 3, 2.5], [4, -1, 3.3], [-2, -2, 3.9], [1, -7, 2.9]] },
}

// Eyes, facing right: the near one big, the far one smaller. d is a heavy lid of goo.
const EYE_LEGEND = { K: O, W: WHITE, d: MUD[3] }
const EYES = {
  // half shut under heavy lids, glaring ahead: grumpy and unimpressed
  grump: {
    near: ['.KKKKK.', 'KdddddK', 'KKKKKKK', 'KWWWKKK', 'KWWWKKK', 'KWWWWWK', '.KKKKK.'],
    far: ['.KKK.', 'KdddK', 'KKKKK', 'KWWKK', 'KWWKK', 'KWWWK', '.KKK.'],
  },
  // the lids all the way down
  shut: {
    near: ['.KKKKK.', 'KdddddK', 'KdddddK', 'KdddddK', 'KdddddK', 'KKKKKKK', '.......'],
    far: ['.KKK.', 'KdddK', 'KdddK', 'KdddK', 'KdddK', 'KKKKK', '.....'],
  },
  // screwed up tight: a hit
  squeeze: {
    near: ['.......', 'KK.....', '..KK...', '....KK.', '..KK...', 'KK.....', '.......'],
    far: ['.....', '...KK', '.KK..', 'K....', '.KK..', '...KK'],
  },
  // wide open, all the grump gone: nearly washed
  wide: {
    near: ['.KKKKK.', 'KWWWWWK', 'KWWWWWK', 'KWWWKWK', 'KWWWKWK', 'KWWWWWK', '.KKKKK.'],
    far: ['.KKK.', 'KWWWK', 'KWWKK', 'KWWKK', 'KWWWK', '.KKK.'],
  },
}
const MOUTHS = {
  // gritted teeth in a lopsided grimace, low at the front
  grit: ['.KKKKKK..', 'KWKWWKWK.', 'KWKWWKWWK', '.KKKKKKKK'],
  o: ['.KK.', 'K00K', 'K00K', '.KK.'],
  wobble: ['.K.K.K', 'K.K.K.'],
}

/**
 * One blob frame.
 *   stage 3..1; dw/dh: squash and stretch in px; lean: how far its top leans the way it goes;
 *   ooze: how far its puddle has crept ahead; eyes 'grump' | 'shut' | 'squeeze' | 'wide';
 *   mouth 'frown' | 'o' | 'wobble'; jig: suds wobble.
 */
function blob({ stage = 3, dw = 0, dh = 0, lean = 0, ooze = 0, eyes = 'grump', mouth = 'grit', jig = 0 }) {
  const S = STAGE[stage]
  const bw = S.bw + dw
  const bh = S.bh + dh
  const top = BG - bh
  const hw = bw / 2
  // A heap: a dome that leans forward, two lumps on its crown, a puddle round its foot,
  // and a drip sliding down its back.
  const dome = bh - 3
  const lumps = [
    [BCX + hw * 0.22 + lean, top + 5.5, hw * 0.42],
    [BCX - hw * 0.4 + lean * 0.5, top + 7, hw * 0.34],
  ]
  const drips = [[BCX - hw + 0.4, BG - bh * 0.3, 1.8]]
  const inside = (x, y) => {
    const v = (BG - y) / dome
    if (y > BG) return false
    if (v >= 0 && v <= 1) {
      const u = (x - BCX - lean * v * v * 1.5) / hw
      if (Math.abs(u) ** 2.3 + v ** 1.7 <= 1) return true
    }
    for (const [lx, ly, r] of lumps) if ((x - lx) ** 2 + (y - ly) ** 2 <= r * r) return true
    for (const [dx, dy, r] of drips) if ((x - dx) ** 2 + (y - dy) ** 2 <= r * r) return true
    // the puddle it sits in, creeping ahead as it goes
    const px = (x - BCX - ooze * 0.6) / (hw + 2 + ooze * 0.5)
    const py = (y - BG + 0.5) / 2.6
    return py <= 0 && px * px + py * py <= 1
  }
  const c = raster(BLOB_W, BLOB_H, (x, y) => {
    if (!inside(x, y)) return 0
    if (!inside(x + 2.4, y + 1.8) || BG - y < 1.6) return MUD[1]
    if (!inside(x - 2.2, y - 2.4)) return MUD[3]
    return MUD[2]
  })
  // The wet shine on its crown: a streak and a glint on each lump.
  for (const [i, [lx, ly, r]] of lumps.entries()) {
    const sx = Math.round(lx - r * 0.55)
    const sy = Math.round(ly - r * 0.55)
    if (r < 3.2) continue
    c.rect(sx, sy, 2, 1, MUD[4])
    c.set(sx - 1, sy + 1, MUD[4])
    if (i === 0) c.set(sx + 1, sy, WHITE)
  }
  // Grit stuck in it (it is road grime): pebbles low down, clear of the face.
  if (stage > 1) {
    stamp(c, Math.round(BCX - hw * 0.62), BG - 7, ['ab', 'bc'], GRIT)
    stamp(c, Math.round(BCX + hw * 0.55 + lean * 0.3), BG - 5, ['a', 'c'], GRIT)
  }
  if (stage === 3) stamp(c, Math.round(BCX - hw * 0.15), BG - 3, ['ab'], GRIT)

  for (const [i, [dx, dy, r]] of S.suds.entries()) putBubble(c, BCX + dx + (i % 2 ? jig : -jig), top + dy + (i % 2 ? 0 : jig), r)
  c.outline(O)

  // The face sits toward the way it faces (it is seen three-quarters on).
  const fx = Math.round(BCX + 2 + lean)
  const ey = Math.round(top + bh * (stage === 1 ? 0.24 : 0.3))
  const set = EYES[eyes]
  const near = set.near
  const far = set.far
  stamp(c, fx + 1, ey, near, EYE_LEGEND)
  stamp(c, fx - 1 - far[0].length, ey + 1, far, EYE_LEGEND)
  if (eyes === 'wide') {
    // brows up in the middle: worried
    c.rect(fx + 2, ey - 2, 2, 1, O)
    c.set(fx + 1, ey - 1, O)
    c.rect(fx - 4, ey - 1, 2, 1, O)
  }
  const m = MOUTHS[mouth]
  // Never so low that the mouth runs into the puddle.
  const my = Math.min(ey + near.length + 1, BG - 3 - m.length)
  const mx = fx + 2 - Math.floor(m[0].length / 2)
  stamp(c, mx, my, m, { K: O, W: WHITE, 0: MUD[0] })
  return c
}

/** Stomped flat: a puddle with its eyes spun. */
function blobFlat(n) {
  const W = 44
  const bw = n === 0 ? 34 : 40
  const bh = n === 0 ? 9 : 5
  const g = BLOB_H - 1
  const inside = (x, y) => {
    const v = (g - y) / bh
    if (v < 0 || v > 1) return false
    const lump = n === 0 ? 0.12 * Math.cos((x - W / 2) * 0.5) : 0
    return Math.pow(Math.abs(x - W / 2) / (bw / 2), 2.2) + Math.pow(v, 1.7) <= 1 + lump
  }
  const c = raster(W, BLOB_H, (x, y) => {
    if (!inside(x, y)) return 0
    if (!inside(x + 2, y + 1.2)) return MUD[1]
    if (!inside(x - 2, y - 1.6)) return MUD[3]
    return MUD[2]
  })
  c.set(W / 2 - 8, g - bh + 2, MUD[4])
  c.rect(W / 2 - 7, g - bh + 1, 2, 1, MUD[4])
  c.outline(O)
  const X = ['K.K', '.K.', 'K.K']
  if (n === 0) {
    stamp(c, W / 2 - 4, g - 6, X, { K: O })
    stamp(c, W / 2 + 3, g - 6, X, { K: O })
    stamp(c, W / 2 - 1, g - 2, ['KK.KK'], { K: O })
  } else {
    c.rect(W / 2 - 4, g - 3, 3, 1, O)
    c.rect(W / 2 + 3, g - 3, 3, 1, O)
  }
  return c
}

// Washed: it goes up in suds, and the suds fly apart. 48 x 44, the blob's middle at (24, 30).
function blobPop(n) {
  const W = 48
  const H = 44
  const mx = 24
  const my = 30
  const c = new Canvas(W, H)
  if (n === 0) {
    for (const [dx, dy, r] of [[-7, 4, 4.6], [7, 5, 4.2], [-3, -5, 5], [6, -4, 4.4], [0, 2, 5.6], [-9, -2, 3.4], [10, 0, 3]]) putBubble(c, mx + dx, my + dy, r)
    // its eyes, wide with surprise, left hanging in the foam for a moment
    stamp(c, mx + 1, my - 4, EYES.wide.near, EYE_LEGEND)
    stamp(c, mx - 5, my - 3, EYES.wide.far, EYE_LEGEND)
    return c
  }
  const ring = [null, { count: 8, r: 11, size: 3.4 }, { count: 8, r: 16, size: 2.5 }, { count: 6, r: 20, size: 1.6 }][n]
  for (let i = 0; i < ring.count; i++) {
    const a = (i / ring.count) * Math.PI * 2 + n * 0.35
    putBubble(c, mx + Math.cos(a) * ring.r, my + Math.sin(a) * ring.r * 0.8 - n * 1.5, ring.size + (i % 3 === 0 ? 0.5 : 0))
  }
  if (n === 1) sparkle(c, mx, my, 3)
  if (n === 2) {
    sparkle(c, mx - 4, my - 3, 2)
    sparkle(c, mx + 6, my + 3, 1)
  }
  if (n === 3) {
    sparkle(c, mx + 2, my - 6, 1)
    sparkle(c, mx - 7, my + 2, 1)
  }
  return c
}

/* ------------------------------------------------------------------ */
/* Grackle                                                             */
/* ------------------------------------------------------------------ */

const PURPLE = PAL.purple
// rim: reflected light along the underside; iris: the blue-green gloss of the neck. Both are
// there so the bird reads where its purple meets a sky band or a wall of the same depth
// (highway's top band is exactly its body colour; mega's and the backlot's walls are close).
const BIRD = { body: PURPLE[1], shade: PURPLE[0], sheen: PURPLE[2], glint: PURPLE[3], rim: PURPLE[2], iris: PAL.teal[0], wing: PAL.blue[0], wingLight: PAL.blue[1], beak: PAL.grey[1], beakLight: PAL.grey[2], eye: PAL.yellow[2], eyeShade: PAL.yellow[1], mouth: PAL.red[3], leg: PAL.grey[2] }
const BIRD_W = 48
const BIRD_H = 42
const BMX = 24
const BMY = 23

const WINGS = {
  up: [[5, -2], [-5, -3], [-11, -16], [-5, -14], [1, -10]],
  mid: [[5, -1], [-3, -4], [-13, -3], [-11, 1], [-4, 3], [3, 3]],
  down: [[5, 0], [-5, 0], [-10, 13], [-5, 12], [1, 8]],
}

/**
 * One grackle frame, built in its own space (x forward, y down, the middle of its body at 0,0)
 * and then pitched: pitch > 0 lifts its head.
 *   wing 'up' | 'mid' | 'down', beak 'shut' | 'open', eye 'glare' | 'wide' | 'shut' | 'panic',
 *   legs 'tucked' | 'down', ruffled: after its first hit.
 */
function bird({ wing = 'mid', beak = 'shut', eye = 'glare', pitch = 0, legs = 'tucked', ruffled = false, tail = 0 }) {
  const a = (-pitch * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  /** Screen pixel centre -> the bird's own space. */
  const L = (x, y) => {
    const dx = x - BMX
    const dy = y - BMY
    return [dx * cos + dy * sin, -dx * sin + dy * cos]
  }
  /** The bird's own space -> screen. */
  const T = (lx, ly) => [BMX + lx * cos - ly * sin, BMY + lx * sin + ly * cos]
  const spin = (pts, deg, [hx, hy]) => {
    const r = (deg * Math.PI) / 180
    return pts.map(([x, y]) => [hx + (x - hx) * Math.cos(r) - (y - hy) * Math.sin(r), hy + (x - hx) * Math.sin(r) + (y - hy) * Math.cos(r)])
  }

  // The long keel tail a grackle is known by, deepening toward its end; a ragged one once ruffled.
  const tailPts = spin(ruffled ? [[-6, -2], [-19, -5], [-21, -3], [-17, -1], [-20, 2], [-17, 5], [-6, 2]] : [[-6, -2], [-15, -3], [-22, -5.5], [-23.5, -3], [-22, 2], [-19, 4.5], [-14, 2.5], [-6, 2]], tail, [-6, 0])
  const hinge = [11, -3.4]
  const open = beak === 'open'
  const upper = spin([[10.5, -6.2], [19, -3.6], [10.5, -3]], open ? -16 : 0, hinge)
  const lower = spin([[10.5, -3.6], [16.5, -2.6], [10.5, -1.2]], open ? 22 : 0, hinge)
  const gape = [[10.5, -4.6], [14.5, -3.4], [10.5, -2]]
  const tufts = ruffled ? [[[4, -7], [1.5, -11.5], [6.5, -8]], [[-3, -5], [-6, -8.5], [-0.5, -5.4]], [[7, -8], [6.5, -11], [9, -8]]] : []

  const inBody = (x, y) => (x / 8.6) ** 2 + (y / 5.6) ** 2 <= 1
  const inNeck = (x, y) => ((x - 5) / 4.2) ** 2 + ((y + 2.2) / 4.2) ** 2 <= 1
  const inHead = (x, y) => Math.hypot(x - 8, y + 4.2) <= 4.4
  const inTorso = (x, y) => inBody(x, y) || inNeck(x, y) || inHead(x, y) || tufts.some((p) => inPoly(p, x, y))
  const legAt = (x, y) => {
    if (legs === 'down') return (Math.abs(x + 1.5) < 0.6 || Math.abs(x - 2) < 0.6) && y > 4 && y < 9.5
    return (Math.abs(x + 1) < 1.1 || Math.abs(x - 2.5) < 1.1) && y > 4.5 && y < 6.6
  }

  const c = raster(BIRD_W, BIRD_H, (x, y) => {
    const [lx, ly] = L(x, y)
    if (inPoly(upper, lx, ly)) return ly < -4.6 + (lx - 10.5) * 0.12 ? BIRD.beakLight : BIRD.beak
    if (inPoly(lower, lx, ly)) return BIRD.beak
    if (open && inPoly(gape, lx, ly)) return BIRD.mouth
    if (inTorso(lx, ly)) {
      const [ax, ay] = L(x - 1.6, y - 1.6)
      const [bx, by] = L(x + 1.2, y + 1.8)
      // A bright rim of gloss along the head and back, so it still shows on a night sky.
      const [rx, ry] = L(x, y - 1)
      if (!inTorso(rx, ry) && lx > -5) return BIRD.glint
      // Under it, the blue-green sheen of the nape and shoulders.
      const [nx, ny] = L(x - 1, y - 3.2)
      if (lx > -4 && lx < 7 && ly < -0.5 && !inTorso(nx, ny)) return BIRD.iris
      if (!inTorso(ax, ay)) return BIRD.sheen
      // The underside catches light too: its edge never sinks into a dark wall.
      const [dx, dy] = L(x, y + 1)
      if (!inTorso(dx, dy) && !inPoly(tailPts, dx, dy) && !legAt(dx, dy)) return BIRD.rim
      if (!inTorso(bx, by) || (ly > 2.4 && inBody(lx, ly))) return BIRD.shade
      return BIRD.body
    }
    if (inPoly(tailPts, lx, ly)) {
      const [ax, ay] = L(x - 1, y - 1.4)
      const [rx, ry] = L(x, y - 1)
      if (!inPoly(tailPts, rx, ry)) return BIRD.sheen
      const [dx, dy] = L(x, y + 1)
      if (!inPoly(tailPts, dx, dy) && !inTorso(dx, dy)) return BIRD.rim
      return inPoly(tailPts, ax, ay) ? BIRD.shade : BIRD.body
    }
    if (legAt(lx, ly)) return BIRD.leg
    return 0
  })
  // the gloss a grackle is known by: head and shoulder
  for (const [lx, ly] of [[7, -6.6], [8, -6.6], [1, -3.6], [2.2, -3.8]]) {
    const [x, y] = T(lx, ly)
    if (c.solid(Math.floor(x), Math.floor(y))) c.set(Math.floor(x), Math.floor(y), BIRD.glint)
  }
  c.outline(O)

  // The near wing lies over the body, with an outline of its own.
  const wp = WINGS[wing]
  const w = raster(BIRD_W, BIRD_H, (x, y) => {
    const [lx, ly] = L(x, y)
    if (!inPoly(wp, lx, ly)) return 0
    const [ax, ay] = L(x - 1.5, y - 1.2)
    return inPoly(wp, ax, ay) ? BIRD.wing : BIRD.wingLight
  })
  // two feather lines, fanning from the shoulder to the trailing edge
  const root = T(wp[0][0] - 1, wp[0][1])
  for (const k of [0.45, 0.75]) {
    const tip = wp[2]
    const end = wp[3] ?? wp[2]
    const [qx, qy] = T(tip[0] + (end[0] - tip[0]) * k, tip[1] + (end[1] - tip[1]) * k)
    const mark = new Canvas(BIRD_W, BIRD_H).line(root[0] + (qx - root[0]) * 0.45, root[1] + (qy - root[1]) * 0.45, qx, qy, PAL.navy)
    w.blit(mark, 0, 0, { mode: 'atop' })
  }
  w.outline(O)
  c.blit(w, 0, 0)

  // The eye: pale yellow, the mark of a grackle, under a brow that slants down at the beak.
  const [ex, ey] = T(8.6, -4.8).map(Math.floor)
  if (eye === 'glare') {
    stamp(c, ex - 1, ey - 2, ['KK.', 'YYK', 'YPY', 'yYy'], { K: O, Y: BIRD.eye, y: BIRD.eyeShade, P: O })
  } else if (eye === 'wide') {
    stamp(c, ex - 2, ey - 2, ['.YY.', 'YYYY', 'YYPY', '.yy.'], { Y: BIRD.eye, y: BIRD.eyeShade, P: O })
  } else if (eye === 'panic') {
    stamp(c, ex - 2, ey - 2, ['.WW.', 'WWWW', 'WWPW', '.WW.'], { W: WHITE, P: O })
  } else {
    stamp(c, ex - 1, ey - 1, ['K..', '.K.', 'K..'], { K: BIRD.eye })
  }
  return c
}

const FEATHER_LEGEND = { K: O, p: BIRD.body, P: BIRD.sheen, s: BIRD.shade }
const FEATHERS = [
  ['.KKKKKK..', 'KpPPPPpK.', '.KsspPPPK', '..KKKKKK.'],
  ['...KK.', '..KPpK', '.KPPsK', 'KpPsK.', 'KPsK..', '.KK...'],
  ['.KK.', 'KPpK', 'KPsK', 'KPsK', 'KPsK', 'KpsK', '.KK.'],
].map((rows) => Canvas.fromText(rows, FEATHER_LEGEND))

/* ---- the splat ---- */

// A fat white drop with a nasty dark-green middle, its tail flicking, two streaks above it
// to say it is falling: unmistakably a dropping, and it shows on a pale sky.
const DROP = { W: WHITE, w: PAL.grey[5], g: PAL.grey[4], K: O, d: PAL.green[0], h: PAL.green[1] }
const DROP_BODY = ['.KWWWWWwK.', 'KWWWWWWWwK', 'KWWWWWWwwK', 'KWdhWWwwgK', '.KwddwwgK.', '..KKKKKK..']
const SPLAT_FALL = [
  ['.K.....K..', '.K.....K..', '..........', '....KK....', '...KWWK...', '..KWWWWK..', ...DROP_BODY],
  ['..K.....K.', '..K.....K.', '..........', '.....KK...', '....KWWK..', '..KWWWWK..', ...DROP_BODY],
].map((rows) => Canvas.fromText(rows, DROP))
const SPLAT_LAND = [
  [
    '....K........K.....K....',
    '...KWK......KWK...KWK...',
    '....K...KK...K.....K....',
    '.KK...KKWWKKKKKK....KK..',
    'KWWKKKWWWddWWWwwKKKKWwK.',
    'KWWWWWWdhdWWWWWwwwwwwgK.',
    '.KKwwwwwwwwwwwwggggKKK..',
    '...KKKKKKKKKKKKKKKK.....',
  ],
  [
    '........................',
    '........................',
    '........................',
    '......KKKKKKKKKK........',
    '..KKKKWWWddWWWwwKKKK....',
    '.KWWWWWdhdWWWWwwwwwgK...',
    'KWWwwwwwwwwwwwwwgggggK..',
    '.KKKKKKKKKKKKKKKKKKKK...',
  ],
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '......KKKKKKKKKK........',
    '....KKWWWwwwwwggKK......',
    '.....KKKKKKKKKKKK.......',
  ],
].map((rows) => Canvas.fromText(rows, DROP))

/* ------------------------------------------------------------------ */
/* Bugs                                                                */
/* ------------------------------------------------------------------ */

const BUG = { K: O, k: PAL.grey[0], y: PAL.yellow[1], Y: PAL.yellow[2], w: PAL.ice[2], b: PAL.ice[1], W: WHITE, r: PAL.red[4] }
// The one that leads the swarm: big enough to have a face.
const BUG_BODY = [
  '..KKKKKKKK...',
  '.KykykkkkkK..',
  'KKykykkWWrkK.',
  'KYykykkWKrkK.',
  'KKykykkkkkK..',
  '.KykykkKKK...',
  '..KKKKK......',
]
const BUG_BODY_HIT = [
  '..KKKKKKKK...',
  '.KykykkkkkK..',
  'KKykykkKkKkK.',
  'KYykykkkKkkK.',
  'KKykykkKkKK..',
  '.KykykkKKK...',
  '..KKKKK......',
]
const BUG_WINGS = [
  ['...KK..KK....', '..KwwKKwwK...', '..KwbKKwbK...', '...KwbKwbK...'],
  ['.............', '.............', '.KKKKKKKKK...', 'KwwwwbbbbbK..'],
]
function bugBig(wings, hit = false) {
  const c = new Canvas(13, 11)
  stamp(c, 0, 0, BUG_WINGS[wings], BUG)
  stamp(c, 0, 4, hit ? BUG_BODY_HIT : BUG_BODY, BUG)
  return c
}
// The rank and file: bright little yellow-jackets, so the swarm shows on sky and in the dark alike.
const BUG_SMALL = [
  ['..WW..', '.KKKK.', 'KYKYyK', 'KYKyyK', '.KKKK.'],
  ['......', 'WKKKKW', 'KYKYyK', 'KYKyyK', '.KKKK.'],
].map((rows) => Canvas.fromText(rows, BUG))
// Gnats fill the cloud in between: a dark speck with flickering white wings, so the swarm
// reads as one buzzing mass rather than a few dots.
const GNAT = [
  ['W..W', '.KK.', '.KK.'],
  ['....', 'WKKW', '.KK.'],
].map((rows) => Canvas.fromText(rows, BUG))
const BANG = Canvas.fromText(['.KKK.', 'KYYYK', 'KYYyK', 'KYYyK', 'KYYyK', 'KYyyK', '.KyK.', '.KKK.', 'KYYyK', 'KYyyK', '.KKK.'], BUG)

/* ------------------------------------------------------------------ */
/* Tumbleweed                                                          */
/* ------------------------------------------------------------------ */

// Canvas 36 x 36, the ball's middle at (18, 18), its feet at row 33: a 30 px ball and its stray ends.
const WEED = 36
const WM = WEED / 2
const STRAW = { back: MUD[2], shade: MUD[3], mid: MUD[4], light: PAL.wood[6], tip: PAL.wood[7], gap: MUD[1], deep: MUD[0] }

// The tangle: stems that are arcs of circles, in the ball's own space, front ones first.
const STEMS = (() => {
  const rnd = seeded(77)
  const stems = [{ cx: 0, cy: 0, r: 13.4, front: true, from: 0, span: 5.6 }]
  for (let i = 0; i < 15; i++) {
    const a = rnd() * Math.PI * 2
    const d = 3 + rnd() * 8.5
    stems.push({ cx: Math.cos(a) * d, cy: Math.sin(a) * d, r: 6.5 + rnd() * 7, front: i < 7, from: rnd() * Math.PI * 2, span: 2.4 + rnd() * 3.2 })
  }
  return stems
})()
// Loose ends that stick out of the ball: [angle, length].
const SPIKES = [[0.3, 2.2], [1.2, 1.6], [2.1, 2.4], [2.9, 1.5], [3.8, 2.2], [4.6, 1.7], [5.5, 2.3]]

/** The ball turned by `turn` radians. `keep` of the stems are left (it loses them as it is hit). */
function weed(turn, keep) {
  const cos = Math.cos(-turn)
  const sin = Math.sin(-turn)
  const stems = STEMS.filter((_, i) => i === 0 || i <= keep)
  const spikes = SPIKES.filter((_, i) => i < Math.ceil((keep / 15) * SPIKES.length))
  const onStem = (s, x, y, thick) => {
    const dx = x - s.cx
    const dy = y - s.cy
    if (Math.abs(Math.hypot(dx, dy) - s.r) > thick) return false
    const ang = (((Math.atan2(dy, dx) - s.from) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    return ang <= s.span
  }
  const c = raster(WEED, WEED, (px, py) => {
    const dx = px - WM
    const dy = py - WM
    const x = dx * cos - dy * sin
    const y = dx * sin + dy * cos
    const r = Math.hypot(x, y)
    // where the light falls does not turn with the ball
    const lit = (dx + dy) / 15
    const pick = (front) => (!front ? (lit < -0.2 ? STRAW.shade : STRAW.back) : lit < -0.85 ? STRAW.tip : lit < -0.15 ? STRAW.light : lit < 0.75 ? STRAW.mid : STRAW.shade)
    if (r > 14.6) {
      const ang = ((Math.atan2(y, x) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      for (const [sa, len] of spikes) if (Math.abs(ang - sa) < 0.07 && r < 14.6 + len) return pick(true)
      return 0
    }
    let near = false
    for (const s of stems) {
      if (onStem(s, x, y, 0.62)) return pick(s.front)
      if (!near && onStem(s, x, y, 1.9)) near = true
    }
    // between the stems it is dark, and where there are none you see through it
    if (near || r < 6) return r < 7 ? STRAW.deep : STRAW.gap
    return 0
  })
  return c.outline(O)
}

const EYES_LEGEND = { K: O, d: MUD[0], W: WHITE, Y: PAL.yellow[2] }
// Two eyes in the dark of the tangle. They do not turn with it.
const WEED_EYES = {
  open: ['.dddddddddddd.', 'dKKdddddddKKdd', 'dWWKKdddKKWWdd', 'dWWKWdddWWKWdd', 'dWWKWdddWWKWdd', '.dddddddddddd.'],
  shut: ['.dddddddddddd.', 'dddddddddddddd', 'dKKddddddddKKd', 'dddKKKddKKKddd', 'dddddddddddddd', '.dddddddddddd.'],
  hit: ['.dddddddddddd.', 'dWddddddddddWd', 'ddWWddddddWWdd', 'ddWWddddddWWdd', 'dWddddddddddWd', '.dddddddddddd.'],
  dizzy: ['..............', '.KKKK....KKKK.', 'KWWWWK..KWWWWK', 'KWKKWK..KWKKWK', 'KWWWWK..KWWWWK', '.KKKK....KKKK.'],
  dizzy2: ['..............', '.KKKK....KKKK.', 'KWWWWK..KWWWWK', 'KWWKWK..KKWWWK', 'KWKWWK..KWWKWK', '.KKKK....KKKK.'],
}
const TWIG_LEGEND = { K: O, a: STRAW.mid, b: STRAW.light, c: STRAW.shade }
const TWIGS = [
  ['.KKKKKK...', 'KbbbbaaKK.', '.KKKKKaaaK', '......KKK.'],
  ['...KK.', '..KbK.', '.KbaK.', 'KbaKK.', 'KaKaaK', '.K.KK.'],
  ['.KK....', 'KbbK...', '.KbaKK.', '..KaacK', '...KKK.'],
  ['KK..', 'KbK.', 'KbK.', '.KaK', '.KaK', '..KK'],
].map((rows) => Canvas.fromText(rows, TWIG_LEGEND))

/* ------------------------------------------------------------------ */
/* The atlas                                                           */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('critters', { script: 'art-critters.mjs' })
/** name -> [{ label, canvas, ax, ay }], for the review sheets. */
const shown = {}
function anim(name, canvases, ax, ay) {
  const frames = canvases.map((canvas, i) => ({ label: `${name}${i}`, canvas, ax, ay }))
  atlas.addAnim(name, frames.map((f) => ({ canvas: f.canvas, ax, ay })))
  shown[name] = frames
  return frames
}

const BLOB_ANCHOR = [BCX, BLOB_H]
// The ooze: the puddle creeps ahead, the heap stretches up and leans after it, then sags and catches up.
const WALK = [
  { dw: 0, dh: 0, lean: 0, ooze: 0 },
  { dw: 0, dh: 0, lean: 0, ooze: 2 },
  { dw: -2, dh: 1, lean: 1, ooze: 3 },
  { dw: 2, dh: -2, lean: 1, ooze: 1 },
]
for (const stage of [3, 2, 1]) {
  // Nearly washed, it has stopped sulking: wide eyes and a wobbly 'oh no'.
  const mouth = stage === 1 ? 'wobble' : 'grit'
  const eyes = stage === 1 ? 'wide' : 'grump'
  anim(`blob${stage}Walk`, WALK.map((f, i) => blob({ stage, ...f, mouth, eyes, jig: i & 1 })), ...BLOB_ANCHOR)
  anim(`blob${stage}Blink`, WALK.map((f, i) => blob({ stage, ...f, mouth, jig: i & 1, eyes: 'shut' })), ...BLOB_ANCHOR)
}
// Indexed by stage - 1.
anim('blobHit', [1, 2, 3].map((stage) => blob({ stage, dw: 3, dh: -3, eyes: 'squeeze', mouth: 'o' })), ...BLOB_ANCHOR)
anim('blobSquash', [blobFlat(0), blobFlat(1)], 22, BLOB_H)
anim('blobPop', [0, 1, 2, 3].map(blobPop), 24, 44)

const BIRD_ANCHOR = [BMX, BMY + 10]
const FLAP = ['up', 'mid', 'down', 'mid']
anim('birdFly', FLAP.map((wing) => bird({ wing })), ...BIRD_ANCHOR)
anim('birdFlyHurt', FLAP.map((wing) => bird({ wing, ruffled: true })), ...BIRD_ANCHOR)
anim('birdTell', ['up', 'down'].map((wing) => bird({ wing, pitch: 16, beak: 'open', eye: 'wide', legs: 'down', tail: 14 })), ...BIRD_ANCHOR)
anim('birdTellHurt', ['up', 'down'].map((wing) => bird({ wing, pitch: 16, beak: 'open', eye: 'wide', legs: 'down', tail: 14, ruffled: true })), ...BIRD_ANCHOR)
anim('birdHit', ['mid', 'up'].map((wing) => bird({ wing, pitch: -8, beak: 'open', eye: 'shut', ruffled: true, legs: 'down' })), ...BIRD_ANCHOR)
anim('birdFlee', ['up', 'down'].map((wing) => bird({ wing, pitch: 34, beak: 'open', eye: 'panic', ruffled: true, legs: 'down' })), ...BIRD_ANCHOR)
anim('feather', FEATHERS.map((canvas) => canvas), 4, 3)

anim('splatFall', SPLAT_FALL, 5, 12)
anim('splatLand', SPLAT_LAND, 12, 8)

anim('bugBig', [bugBig(0), bugBig(1)], 6, 7)
anim('bugBigHit', [bugBig(0, true), bugBig(1, true)], 6, 7)
anim('bugSmall', BUG_SMALL, 3, 3)
anim('gnat', GNAT, 2, 1)
anim('bang', [BANG], 2, 11)

const TURNS = 8
const WEED_ANCHOR = [WM, WM + 15]
for (const [name, keep] of [['weedA', 15], ['weedB', 10], ['weedC', 6]]) {
  anim(name, Array.from({ length: TURNS }, (_, i) => weed((i / TURNS) * Math.PI * 2, keep)), ...WEED_ANCHOR)
}
anim('weedEyes', [WEED_EYES.open, WEED_EYES.shut].map((rows) => Canvas.fromText(rows, EYES_LEGEND)), 7, 3)
anim('weedEyesHit', [Canvas.fromText(WEED_EYES.hit, EYES_LEGEND)], 7, 3)
anim('weedEyesDizzy', [WEED_EYES.dizzy, WEED_EYES.dizzy2].map((rows) => Canvas.fromText(rows, EYES_LEGEND)), 7, 3)
anim('twig', TWIGS, 4, 3)

atlas.meta({
  facing: 'Everything faces right. Mirror it (flipX) when entity.facing is -1.',
  anchor: 'Blob, bird, splat and tumbleweed frames are anchored at the feet of the entity box: draw at (e.x + e.w / 2, e.y + e.h). Bugs, gnats, bang, feathers, twigs and the tumbleweed eyes are anchored at their own middle (bang: its foot).',
  blob: { box: [30, 28], boxByStage: { 3: [30, 28], 2: [28, 28], 1: [26, 28] }, walkPx: 4, note: 'blob<hp>Walk and blob<hp>Blink share frame indices: step one frame per 4 px walked. blobHit is indexed by hp - 1. blobSquash: 2 frames, blobPop: 4 frames, played once.' },
  bird: { box: [28, 20], note: 'birdFly: one flap is the 4 frames. birdFlyHurt, birdTellHurt: the same with ruffled feathers, for hp 1. birdTell, birdHit, birdFlee: 2 frames each.' },
  weed: { box: [30, 30], turns: TURNS, turnPx: Math.round(((Math.PI * 30) / TURNS) * 100) / 100, note: 'weedA (whole), weedB, weedC (after hits): 8 frames, each an eighth of a turn clockwise; one frame per turnPx rolled. Draw weedEyes over its middle; they do not turn.' },
  ticks: { blobSquash: [6, 16], blobPop: [4, 4, 5, 5], birdFly: [4, 4, 4, 4], birdTell: [3, 3], birdFlee: [3, 3], splatFall: [5, 5], splatLand: [5, 20, 15], bugBig: [2, 2], bugSmall: [2, 2], gnat: [2, 2] },
})

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write()
console.log(`critters atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames`)

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const groups = {
    blob: ['blob3Walk', 'blob3Blink', 'blob2Walk', 'blob2Blink', 'blob1Walk', 'blob1Blink', 'blobHit', 'blobSquash', 'blobPop'],
    bird: ['birdFly', 'birdFlyHurt', 'birdTell', 'birdTellHurt', 'birdHit', 'birdFlee', 'feather', 'splatFall', 'splatLand'],
    bugs: ['bugBig', 'bugBigHit', 'bugSmall', 'gnat', 'bang'],
    weed: ['weedA', 'weedB', 'weedC', 'weedEyes', 'weedEyesHit', 'weedEyesDizzy', 'twig'],
  }
  const BACKS = { sky: '#5cc8ff', tunnel: '#2e3038', night: '#1a1033' }
  const rows = (names) => names.map((n) => ({ label: n, frames: shown[n] }))
  for (const [g, names] of Object.entries(groups)) {
    for (const [bgName, bg] of Object.entries(BACKS)) {
      contactSheet(rows(names), { bg, scale: 4, wrap: 8, file: path.join(REVIEW, `${g}_${bgName}_4x.png`) })
    }
    contactSheet(rows(names), { bg: BACKS.sky, scale: 4, wrap: 8, flipX: true, file: path.join(REVIEW, `${g}_sky_flip_4x.png`) })
    contactSheet(rows(names), { bg: BACKS.sky, scale: 1, wrap: 8, labels: false, file: path.join(REVIEW, `${g}_sky_1x.png`) })
    contactSheet(rows(names), { bg: BACKS.tunnel, scale: 1, wrap: 8, labels: false, file: path.join(REVIEW, `${g}_tunnel_1x.png`) })
  }

  // Line-ups beside Maxx, standing on the ground, as the game will show them.
  const maxxTs = fs.readFileSync(path.join(ASSETS_DIR, 'maxx.atlas.ts'), 'utf8')
  const m = /idle0: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+) \}/.exec(maxxTs)
  const maxxSheet = Canvas.load(path.join(ASSETS_DIR, 'maxx.png'))
  const hero = m ? { canvas: maxxSheet.crop(+m[1], +m[2], +m[3], +m[4]), ax: +m[5], ay: +m[6] } : null
  const put = (scene, f, x, y, flip = false) => scene.blit(f.canvas, flip ? x - (f.canvas.w - f.ax) : x - f.ax, y - f.ay, { flipX: flip })
  const F = (name, i = 0) => shown[name][i]
  for (const [bgName, bg, ground] of [['sky', BACKS.sky, '#7a4a1a'], ['tunnel', BACKS.tunnel, '#4b4f5c'], ['night', BACKS.night, '#2e1f5e']]) {
    const scene = new Canvas(640, 200, bg)
    const gy = 168
    scene.rect(0, gy, 640, 32, ground)
    if (hero) put(scene, hero, 40, gy)
    // blobs: the three stages walking, flinching, flat, and popping
    put(scene, F('blob3Walk', 0), 100, gy, true)
    put(scene, F('blob2Walk', 1), 140, gy, true)
    put(scene, F('blob1Walk', 3), 178, gy, true)
    put(scene, F('blobHit', 2), 216, gy, true)
    put(scene, F('blobSquash', 0), 258, gy)
    put(scene, F('blobPop', 1), 304, gy)
    // tumbleweeds, with their eyes
    const eyes = F('weedEyes', 0)
    for (const [i, [name, turn]] of [['weedA', 0], ['weedA', 3], ['weedB', 5], ['weedC', 6]].entries()) {
      const x = 360 + i * 40
      put(scene, F(name, turn), x, gy - (i === 1 ? 14 : 0), true)
      put(scene, eyes, x - 1, gy - 15 - (i === 1 ? 14 : 0), true)
    }
    for (let i = 0; i < 4; i++) put(scene, F('twig', i), 530 + i * 14, gy - 20 - ((i * 7) % 16))
    // grackles overhead
    put(scene, F('birdFly', 0), 90, 60, true)
    put(scene, F('birdFly', 1), 140, 64, true)
    put(scene, F('birdFly', 2), 190, 60, true)
    put(scene, F('birdTell', 0), 250, 62, true)
    put(scene, F('splatFall', 0), 250, 92)
    put(scene, F('splatLand', 1), 250, gy)
    put(scene, F('birdHit', 0), 310, 62, true)
    put(scene, F('birdFlee', 0), 366, 50)
    put(scene, F('birdFlyHurt', 1), 420, 62)
    for (let i = 0; i < 3; i++) put(scene, F('feather', i), 340 + i * 12, 86 + i * 5)
    // a swarm
    const rnd = seeded(5)
    put(scene, F('bugBig', 0), 520, 110, true)
    for (let i = 0; i < 11; i++) put(scene, F('bugSmall', i & 1), 520 + Math.round((rnd() - 0.5) * 30), 110 + Math.round((rnd() - 0.5) * 30), true)
    put(scene, F('bang', 0), 520, 86)
    put(scene, F('bugBig', 1), 590, 110)
    scene.save(path.join(REVIEW, `lineup_${bgName}_1x.png`))
    scene.scale(3).save(path.join(REVIEW, `lineup_${bgName}_3x.png`))
  }

  // Collision boxes over the art (the simulation's sizes, at the anchor), to see that what
  // hurts is what shows: boxes_4x.png. Red: the box; the art is drawn on sky.
  const BOX = { blob: [30, 28], bird: [28, 20], splat: [10, 12], weed: [30, 30] }
  const boxed = [
    ['blob3Walk', 0, BOX.blob], ['blob3Walk', 2, BOX.blob], ['blob2Walk', 0, [28, 28]], ['blob1Walk', 0, [26, 28]], ['blobHit', 1, [28, 28]],
    ['birdFly', 0, BOX.bird], ['birdFly', 2, BOX.bird], ['birdTell', 0, BOX.bird], ['birdHit', 0, BOX.bird],
    ['splatFall', 0, BOX.splat], ['weedA', 0, BOX.weed], ['weedA', 3, BOX.weed], ['weedC', 5, BOX.weed],
  ]
  const cell = 56
  const sheet = new Canvas(boxed.length * cell, cell, BACKS.sky)
  boxed.forEach(([name, i, [bw, bh]], k) => {
    const f = F(name, i)
    const ax = k * cell + cell / 2
    const ay = cell - 6
    put(sheet, f, ax, ay)
    sheet.box(ax - bw / 2, ay - bh, bw, bh, PAL.red[4])
  })
  sheet.scale(4).save(path.join(REVIEW, 'boxes_4x.png'))

  // The grackle where it flies in every theme: over each sky band (the top one is under the HUD
  // but still sky), over the strips, and against the theme's ground and wall tiles. A screen per
  // theme in grackle_on_<theme>.png, and grackle_close_<theme>_3x.png: the top-left corner (the
  // top band) and the wall, side by side.
  const loadAtlas = (name) => {
    const ts = path.join(ASSETS_DIR, `${name}.atlas.ts`)
    const png = path.join(ASSETS_DIR, `${name}.png`)
    if (!fs.existsSync(ts) || !fs.existsSync(png)) return null
    const src = fs.readFileSync(ts, 'utf8').replace(/^import .*$/gm, '').replace(/export const atlas: AtlasDef =/, 'return')
    const def = new Function('image', src)('')
    const sheet = Canvas.load(png)
    return { def, frame: (n) => (def.frames[n] ? sheet.crop(def.frames[n].x, def.frames[n].y, def.frames[n].w, def.frames[n].h) : null) }
  }
  const tiles = loadAtlas('tiles')
  const THEMES = ['lot', 'vacuum', 'tunnel', 'storm', 'lube', 'highway', 'winter', 'mega', 'bonus', 'backlot']
  const BAND_H = 200
  THEMES.forEach((theme) => {
    const bg = loadAtlas(`bg_${theme}`)
    const view = new Canvas(640, 360)
    const sky = bg?.def.meta?.sky ?? [[0, '#5cc8ff']]
    sky.forEach(([y, col], k) => view.rect(0, y, 640, (sky[k + 1]?.[0] ?? 360) - y, col))
    for (const layer of ['clouds', 'far', 'mid', 'near']) {
      const f = bg?.frame(layer)
      if (f) for (let x = 0; x < 640; x += f.w) view.blit(f, x, 360 - f.h)
    }
    // A wall of the theme's own wall and ground tiles on the right, the floor along the bottom.
    const tile = (key) => tiles?.frame(`${theme}_${key}`) ?? tiles?.frame(`any_${key}`) ?? null
    const wallT = tile('wall_t')
    const wall = tile('wall')
    const ground = tile('ground_m')
    for (let x = 448; x < 640; x += 32) {
      for (let y = 168; y < 360; y += 32) {
        const f = y === 168 ? wallT : x < 544 ? wall : ground
        if (f) view.blit(f, x, y)
      }
    }
    // The top band (y 0 to 40), the bands below, then against the wall and the ground.
    const birds = [
      ['birdFly', 0, 40, 34], ['birdFly', 1, 96, 30], ['birdTell', 0, 150, 34], ['birdFly', 2, 210, 70],
      ['birdFly', 1, 270, 120], ['birdFlyHurt', 2, 330, 160], ['birdHit', 0, 390, 110],
      ['birdFly', 0, 480, 210], ['birdTell', 1, 520, 250], ['birdFly', 2, 590, 300],
    ]
    for (const [name, k, x, y] of birds) put(view, F(name, k), x, y, k % 2 === 1)
    view.save(path.join(REVIEW, `grackle_on_${theme}.png`))
    const close = new Canvas(224, BAND_H, '#000000')
    close.blit(view.crop(10, 0, 110, BAND_H), 0, 0)
    close.blit(view.crop(458, 160, 110, BAND_H), 114, 0)
    close.scale(3).save(path.join(REVIEW, `grackle_close_${theme}_3x.png`))
  })
  console.log(`review sheets in ${REVIEW}`)
}
