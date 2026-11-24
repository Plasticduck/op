// art-map.mjs: generates the 'map' atlas, the world map of Super Mighty Maxx: a
// hand-drawn West Texas road map, 640 x 320, with everything that stands or moves on it.
//
//   node scripts/maxx/art-map.mjs                    writes map.png + map.atlas.ts
//   node scripts/maxx/art-map.mjs --review <dir>     also writes review pictures into <dir>:
//       ground_1x (the bare ground), shade_2x (the same under a cloud), posed_1x / posed_2x
//       (every road open, every site lit, every prop where the scene puts it), tour_*_4x
//       (the posed map in six enlarged pieces), sheet_*.png (every animation as a strip at
//       1x and 3x to 5x, on the grounds it is seen against, plain and flipped, by night)
//   --force                                          write even when the layout check fails
//
// The layout check: no prop may stand on a road or a site, no site on another, and every
// site's sign plate must find a spot clear of roads, buildings and other plates.
//
// How the map is made:
//   1  LAYOUT: the sites, the roads between them (control points, splined), the river
//      and the railroad. The scene reads the same numbers from atlas.meta.
//   2  the ground is painted: biomes with wobbly inked borders, map marks, the river,
//      mesas, fields, the railroad, bridges, then the roads as faint dirt tracks
//   3  small things that never move are stamped into the ground (kept off the roads)
//   4  light: every pixel is mapped through a table by where it is (day in the west,
//      golden hour, dusk, night in the east; a storm over MW04). Lamps are added after.
//      The same ground one shade darker is 'shade': the scene cuts cloud shadows from it.
//   5  each road is painted again as a paved highway on its own frame: the scene lays
//      those over the ground as roads open, and wipes them in along the path
//   6  sprites: the site buildings in their states, props, animals, cars, weather, icons
//   7  packed, with the layout and the list of standing props in atlas.meta
//
// Everything is deterministic (its own seeded random numbers): a rerun gives the same files.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, rgba, hex } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const W = 640
const H = 320
const K = PAL.outline

/* ------------------------------------------------------------------ */
/* Small maths                                                         */
/* ------------------------------------------------------------------ */

function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise, 0..1, one bump about every `cell` pixels. */
function vnoise(x, y, cell, seed) {
  const fx = x / cell
  const fy = y / cell
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** Catmull-Rom through the points, then walked at even 1 px steps: [{ x, y }] with fractions. */
function spline(pts) {
  const p = pts.map(([x, y]) => ({ x, y }))
  const fine = []
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[Math.min(p.length - 1, i + 2)]
    for (let k = 0; k < 40; k++) {
      const t = k / 40
      const t2 = t * t
      const t3 = t2 * t
      fine.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  fine.push(p[p.length - 1])
  const out = [fine[0]]
  let carry = 0
  for (let i = 1; i < fine.length; i++) {
    const a = fine[i - 1]
    const b = fine[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    let at = 1 - carry
    while (at <= len) {
      out.push({ x: a.x + ((b.x - a.x) * at) / len, y: a.y + ((b.y - a.y) * at) / len })
      at += 1
    }
    carry = (carry + len) % 1
  }
  const last = fine[fine.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 0.3) out.push(last)
  return out
}

/**
 * For a path walked at 1 px steps: how far every pixel near it is from the line (d) and
 * how far along the line its nearest point is (s). Pixels further than `reach` keep d = 99.
 */
function field(points, reach) {
  const d = new Float32Array(W * H).fill(99)
  const s = new Float32Array(W * H)
  const r = Math.ceil(reach)
  points.forEach((p, i) => {
    for (let y = Math.max(0, Math.floor(p.y - r)); y <= Math.min(H - 1, Math.ceil(p.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(p.x - r)); x <= Math.min(W - 1, Math.ceil(p.x + r)); x++) {
        const dd = Math.hypot(x - p.x, y - p.y)
        const k = y * W + x
        if (dd < d[k]) {
          d[k] = dd
          s[k] = i
        }
      }
    }
  })
  return { d, s }
}


/* ------------------------------------------------------------------ */
/* 1. Layout                                                           */
/* ------------------------------------------------------------------ */

/** The railroad: nearly straight, right across the map. */
const trackY = (x) => 170 + 4 * Math.sin(x / 80) - 3 * Math.sin(x / 31 + 1)

/**
 * The highway, HQ to the Mega Tunnel, as one line: stops (where Maxx stands, on the road in
 * front of a building) and the bends between them. Drawn as one curve, so it flows through
 * every stop, then cut into the roads between stops.
 */
const HIGHWAY = [
  ['hq', 62, 268],
  [102, 262],
  ['mw01', 144, 278],
  [184, 294],
  [226, 286],
  ['mw02', 250, 266],
  [286, 264],
  [318, 250],
  ['mw03', 330, 226],
  [334, 198],
  [318, trackY(318)],
  [292, 150],
  [256, 154],
  ['mw04', 222, 148],
  [182, 162],
  [140, 150],
  ['mw05', 98, 122],
  [88, 90],
  [116, 58],
  [180, 44],
  [270, 40],
  [344, 48],
  [402, 50],
  [438, 62],
  ['mw06', 452, 88],
  [484, 108],
  [524, 100],
  ['mw07', 552, 70],
  [598, 82],
  [616, 130],
  [610, trackY(610)],
  [606, 206],
  [596, 232],
  [572, 246],
  ['mw08', 541, 246],
]

/** The hidden roads: out of MW03 to Rival Row, and on from there to MW06. */
const BACK_ROADS = [
  { id: 's0', a: 'mw03', b: 'rivals', via: [[364, 238], [398, 252], [428, 276]] },
  { id: 's1', a: 'rivals', b: 'mw06', via: [[482, 280], [484, 246], [478, 212], [474, trackY(474)], [468, 140], [460, 114]] },
]

const NODES = { rivals: { x: 458, y: 284 } }
const ROADS = []
{
  const line = spline(HIGHWAY.map((p) => (typeof p[0] === 'string' ? [p[1], p[2]] : p)))
  const stops = HIGHWAY.filter((p) => typeof p[0] === 'string')
  let from = 0
  let prev = null
  for (const [id, x, y] of stops) {
    NODES[id] = { x, y }
    let at = from
    let best = Infinity
    for (let i = from; i < line.length; i++) {
      const dd = Math.hypot(line[i].x - x, line[i].y - y)
      if (dd < best) {
        best = dd
        at = i
      }
    }
    if (prev) ROADS.push({ id: `r${ROADS.length}`, a: prev, b: id, secret: false, pts: line.slice(from, at + 1) })
    from = at
    prev = id
  }
  for (const r of BACK_ROADS) ROADS.push({ id: r.id, a: r.a, b: r.b, secret: true, pts: spline([[NODES[r.a].x, NODES[r.a].y], ...r.via, [NODES[r.b].x, NODES[r.b].y]]) })
}

const RIVER = spline([[408, -6], [398, 30], [402, 50], [412, 92], [396, 136], [399, 170], [406, 204], [398, 244], [378, 284], [370, 326]])
const TRACK = spline(Array.from({ length: 41 }, (_, i) => [i * 16.2 - 4, trackY(i * 16.2 - 4)]))

const roadField = ROADS.map((r) => field(r.pts, 12))
const riverField = field(RIVER, 16)
const trackField = field(TRACK, 8)
const riverHalf = (s) => 5 + 1.6 * Math.sin(s / 23) + 1.2 * Math.sin(s / 7.3)

/** Distance from a pixel to the nearest road ('all', 'main' or 'secret'). */
function roadDist(x, y, which = 'all') {
  let best = 99
  if (x < 0 || y < 0 || x >= W || y >= H) return best
  const k = y * W + x
  ROADS.forEach((r, i) => {
    if (which === 'main' && r.secret) return
    if (which === 'secret' && !r.secret) return
    if (roadField[i].d[k] < best) best = roadField[i].d[k]
  })
  return best
}

/** Where each building stands (bottom-centre) and its footprint. */
const SITES = {
  hq: { x: 34, y: 262, w: 54, h: 46 },
  mw01: { x: 144, y: 268, w: 50, h: 40 },
  mw02: { x: 244, y: 256, w: 54, h: 38 },
  mw03: { x: 300, y: 232, w: 56, h: 38 },
  mw04: { x: 222, y: 138, w: 50, h: 38 },
  mw05: { x: 58, y: 130, w: 52, h: 38 },
  mw06: { x: 490, y: 84, w: 52, h: 42 },
  mw07: { x: 552, y: 60, w: 50, h: 40 },
  mw08: { x: 540, y: 234, w: 84, h: 50 },
  rivals: { x: 458, y: 274, w: 72, h: 42 },
}

/* ------------------------------------------------------------------ */
/* Light                                                               */
/* ------------------------------------------------------------------ */

// West to east the day runs out: day, golden hour, dusk, twilight, night. A storm sits over MW04.

function zoneAt(x, y) {
  const sx = (x - SITES.mw04.x) / 66
  const sy = (y - (SITES.mw04.y - 8)) / 44
  const wob = (vnoise(x, y, 22, 71) - 0.5) * 0.5
  if (sx * sx + sy * sy + wob < 1) return 'storm'
  const s = x + 0.42 * y + (vnoise(x, y, 40, 72) - 0.5) * 44 + (vnoise(x, y, 11, 73) - 0.5) * 8
  if (s < 492) return 'day'
  if (s < 548) return 'gold'
  if (s < 612) return 'dusk'
  if (s < 652) return 'twi'
  return 'night'
}

// How each ramp of the palette looks in each light, dark to light like the ramps themselves.
// Golden hour leaves things as they are: only the ground warms up.
const P = PAL
const LIGHT = {
  dusk: {
    wood: [P.wood[0], P.wood[0], P.wood[1], P.wood[2], P.wood[3], P.wood[3], P.wood[4], P.wood[5], P.wood[7]],
    red: [P.red[0], P.red[0], P.red[1], P.red[2], P.red[3], P.red[4]],
    blue: [P.navy, P.blue[0], P.blue[1], P.blue[2], P.blue[3]],
    teal: [P.blue[0], P.teal[0], P.teal[1]],
    green: [P.green[0], P.green[0], P.green[1], P.green[2]],
    grey: [P.grey[0], P.grey[0], P.grey[1], P.grey[2], P.grey[3], P.grey[4], P.orange[2]],
    mud: [P.mud[0], P.mud[0], P.mud[1], P.mud[2], P.mud[3]],
    yellow: [P.yellow[0], P.yellow[1], P.yellow[2]],
    purple: [P.purple[0], P.purple[1], P.purple[2], P.purple[3]],
    orange: [P.orange[0], P.orange[1], P.orange[2]],
    pink: [P.pink[0]],
    ice: [P.blue[1], P.ice[0], P.ice[1]],
  },
  night: {
    wood: [P.purple[0], P.purple[0], P.purple[1], P.purple[1], P.purple[2], P.purple[2], P.purple[2], P.purple[3], P.purple[3]],
    red: [P.purple[0], P.red[0], P.red[0], P.red[1], P.red[2], P.red[3]],
    blue: [P.purple[0], P.blue[0], P.blue[1], P.blue[1], P.blue[2]],
    teal: [P.blue[0], P.teal[0], P.teal[0]],
    green: [P.green[0], P.green[0], P.green[0], P.green[1]],
    grey: [P.grey[0], P.grey[0], P.grey[0], P.grey[1], P.grey[2], P.grey[3], P.grey[4]],
    mud: [P.purple[0], P.purple[0], P.mud[0], P.purple[1], P.purple[1]],
    yellow: [P.wood[1], P.yellow[0], P.yellow[1]],
    purple: [P.purple[0], P.purple[0], P.purple[1], P.purple[2]],
    orange: [P.red[1], P.orange[0], P.orange[1]],
    pink: [P.purple[2]],
    ice: [P.blue[0], P.blue[1], P.ice[0]],
  },
  storm: {
    wood: [P.mud[0], P.mud[1], P.mud[2], P.mud[3], P.mud[4], P.mud[4], P.mud[4], P.wood[6], P.wood[7]],
    red: [P.red[0], P.red[0], P.red[1], P.red[2], P.red[3], P.red[4]],
    blue: [P.blue[0], P.blue[0], P.blue[1], P.blue[2], P.blue[3]],
    teal: [P.teal[0], P.teal[0], P.teal[1]],
    green: [P.green[0], P.green[0], P.green[1], P.green[2]],
    grey: [P.grey[0], P.grey[0], P.grey[1], P.grey[2], P.grey[3], P.grey[4], P.grey[5]],
    mud: [P.mud[0], P.mud[0], P.mud[1], P.mud[2], P.mud[3]],
    yellow: [P.yellow[0], P.yellow[0], P.yellow[1]],
    purple: [P.purple[0], P.purple[0], P.purple[1], P.purple[2]],
    orange: [P.wood[1], P.orange[0], P.orange[1]],
    pink: [P.purple[2]],
    ice: [P.blue[1], P.ice[0], P.ice[1]],
  },
}

const lutCache = new Map()
for (const z of Object.keys(LIGHT)) {
  for (const [ramp, to] of Object.entries(LIGHT[z])) P[ramp].forEach((from, i) => lutCache.set(z + rgba(from), rgba(to[i])))
  lutCache.set(z + rgba(P.outline), rgba(P.outline))
  lutCache.set(z + rgba(P.navy), rgba(z === 'dusk' ? P.navy : P.purple[0]))
}

function tint(col, z) {
  const v = rgba(col)
  if (z === 'day' || z === 'gold' || (v & 0xff) === 0) return v
  const out = lutCache.get((z === 'twi' ? 'night' : z) + v)
  if (out === undefined) throw new Error(`art-map: ${hex(v)} is not a palette colour`)
  return out
}

/** A sprite as it looks standing in a zone. */
function lit(canvas, z) {
  return z === 'day' || z === 'gold' ? canvas : canvas.clone().map((c) => tint(c, z))
}

/* ------------------------------------------------------------------ */
/* 2. The ground                                                       */
/* ------------------------------------------------------------------ */

// The country itself is not put through the light table: each kind has its own colours for
// each light it is seen in ([base, mark, highlight]; the border ink is the mark colour).
const BIOME = {
  plains: { day: [P.wood[6], P.wood[4], P.wood[7]], gold: [P.wood[5], P.wood[3], P.wood[6]], dusk: [P.wood[3], P.wood[2], P.wood[4]], twi: [P.purple[2], P.purple[1], P.purple[3]], night: [P.purple[1], P.purple[0], P.purple[2]], storm: [P.mud[4], P.mud[3], P.wood[5]] },
  pasture: { day: [P.green[2], P.green[1], P.green[3]], gold: [P.green[2], P.green[1], P.green[3]], dusk: [P.green[1], P.green[0], P.green[2]], twi: [P.green[0], P.purple[0], P.green[1]], night: [P.green[0], P.purple[0], P.green[1]], storm: [P.green[1], P.green[0], P.green[2]] },
  dirt: { day: [P.wood[3], P.wood[2], P.wood[4]], gold: [P.wood[2], P.wood[1], P.wood[3]], dusk: [P.wood[1], P.mud[1], P.wood[2]], twi: [P.purple[1], P.purple[0], P.purple[2]], night: [P.navy, P.purple[0], P.purple[1]], storm: [P.wood[2], P.wood[1], P.wood[3]] },
  sand: { day: [P.wood[7], P.wood[6], P.wood[8]], gold: [P.wood[6], P.wood[5], P.wood[7]], dusk: [P.wood[4], P.wood[3], P.wood[6]], twi: [P.purple[2], P.purple[1], P.purple[3]], night: [P.purple[1], P.purple[0], P.purple[2]], storm: [P.wood[6], P.mud[4], P.wood[7]] },
  mud: { day: [P.mud[3], P.mud[2], P.mud[4]], gold: [P.mud[3], P.mud[2], P.mud[4]], dusk: [P.mud[2], P.mud[1], P.mud[3]], twi: [P.mud[1], P.mud[0], P.mud[2]], night: [P.mud[1], P.mud[0], P.mud[2]], storm: [P.mud[2], P.mud[1], P.mud[3]] },
  snow: { day: [P.grey[6], P.ice[1], P.ice[2]], gold: [P.grey[6], P.ice[1], P.ice[2]], dusk: [P.ice[2], P.ice[1], P.grey[6]], twi: [P.ice[1], P.ice[0], P.ice[2]], night: [P.ice[0], P.blue[1], P.ice[1]], storm: [P.ice[2], P.ice[1], P.grey[6]] },
  city: { day: [P.grey[4], P.grey[3], P.grey[5]], gold: [P.grey[4], P.grey[3], P.grey[5]], dusk: [P.grey[3], P.grey[2], P.grey[4]], twi: [P.grey[2], P.grey[1], P.grey[3]], night: [P.grey[1], P.grey[0], P.grey[2]], storm: [P.grey[3], P.grey[2], P.grey[4]] },
  bad: { day: [P.wood[2], P.wood[1], P.wood[3]], gold: [P.wood[2], P.wood[1], P.wood[3]], dusk: [P.wood[1], P.mud[1], P.wood[2]], twi: [P.mud[1], P.purple[0], P.mud[2]], night: [P.purple[0], P.outline, P.purple[1]], storm: [P.wood[1], P.mud[1], P.wood[2]] },
}

const ell = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1

function biomeAt(px, py) {
  const x = px + (vnoise(px, py, 30, 11) - 0.5) * 30 + (vnoise(px, py, 9, 12) - 0.5) * 7
  const y = py + (vnoise(px, py, 30, 13) - 0.5) * 30 + (vnoise(px, py, 9, 14) - 0.5) * 7
  if (ell(x, y, 590, 30, 112, 96)) return 'snow'
  if (ell(x, y, 610, 268, 96, 92)) return 'city'
  if (ell(x, y, 458, 270, 66, 66)) return 'bad'
  if (ell(x, y, 462, 118, 70, 74)) return 'dirt'
  if (Math.abs(x - 402) < 22 && y < 250) return 'dirt'
  if (ell(x, y, 222, 136, 60, 40)) return 'mud'
  if (ell(x, y, 66, 122, 104, 58)) return 'dirt'
  if (ell(x, y, 316, 304, 54, 30)) return 'sand'
  if (y > 198 + 14 * Math.sin(x / 60) && x < 392) return 'pasture'
  return 'plains'
}

const ground = new Canvas(W, H)
const biome = new Array(W * H)
const zone = new Array(W * H)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    biome[y * W + x] = biomeAt(x, y)
    zone[y * W + x] = zoneAt(x, y)
  }
}
const earth = (x, y) => BIOME[biome[y * W + x]][zone[y * W + x]]
const lum3 = (c) => {
  const v = rgba(c)
  return (v >>> 24) * 3 + ((v >>> 16) & 0xff) * 6 + ((v >>> 8) & 0xff)
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const k = y * W + x
    const here = earth(x, y)
    // An inked line where two kinds of country meet.
    const ky = y + 1 < H ? k + W : k
    const kx = x + 1 < W ? k + 1 : k
    const other = biome[ky] !== biome[k] ? earth(x, y + 1) : biome[kx] !== biome[k] ? earth(x + 1, y) : null
    ground.set(x, y, other ? (lum3(here[1]) < lum3(other[1]) ? here[1] : other[1]) : here[0])
  }
}

// Map marks: a few clear strokes per patch of country, on a jittered grid, never noise.
// 1 = the mark colour, 2 = the highlight.
const MARKS = {
  plains: [
    { p: 0.5, px: [[0, 0, 1], [1, 1, 1], [2, 0, 1]] },
    { p: 0.2, px: [[0, 0, 2], [1, 0, 2], [2, 0, 2]] },
    { p: 0.12, px: [[0, 0, 1], [1, 1, 1], [2, 0, 1], [4, 1, 1], [5, 0, 1]] },
  ],
  pasture: [
    { p: 0.5, px: [[0, 1, 1], [1, 0, 1], [2, 1, 1]] },
    { p: 0.25, px: [[0, 0, 2], [1, 0, 2]] },
    { p: 0.1, px: [[0, 0, 2], [1, 1, 1], [-1, 1, 1]] },
  ],
  dirt: [
    { p: 0.35, px: [[0, 0, 1], [1, 0, 1]] },
    { p: 0.25, px: [[0, 0, 2], [1, 0, 2], [2, 0, 2]] },
    { p: 0.15, px: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, -1, 2]] },
  ],
  sand: [
    { p: 0.55, px: [[0, 1, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1], [4, 1, 1]] },
    { p: 0.2, px: [[0, 0, 2], [1, 0, 2], [2, 0, 2]] },
  ],
  mud: [
    { p: 0.4, px: [[0, 0, 1], [1, 0, 1], [2, 0, 1], [1, 1, 1]] },
    { p: 0.25, px: [[0, 0, 2], [1, 0, 2], [2, 0, 2], [3, 0, 2], [0, 1, 1], [1, 1, 1], [2, 1, 1], [3, 1, 1], [4, 1, 1]] },
    { p: 0.15, px: [[0, 0, 2], [1, 0, 2]] },
  ],
  snow: [
    { p: 0.45, px: [[0, 1, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1], [4, 1, 1]] },
    { p: 0.2, px: [[0, 0, 2], [1, 0, 2], [2, 0, 2], [3, 0, 2]] },
  ],
  city: [
    { p: 0.3, px: [[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1]] },
    { p: 0.2, px: [[0, 0, 2], [1, 0, 2]] },
  ],
  bad: [
    { p: 0.4, px: [[0, 0, 1], [1, 1, 1], [2, 1, 1], [3, 2, 1]] },
    { p: 0.25, px: [[0, 0, 2], [1, 0, 2], [2, 0, 2]] },
  ],
}

{
  const rnd = seeded(101)
  for (let gy = 4; gy < H; gy += 11) {
    for (let gx = 4; gx < W; gx += 13) {
      const x = gx + Math.floor(rnd() * 9) - 4
      const y = gy + Math.floor(rnd() * 7) - 3
      const roll = rnd()
      if (x < 2 || y < 2 || x >= W - 7 || y >= H - 3) continue
      const k = y * W + x
      let acc = 0
      for (const m of MARKS[biome[k]]) {
        acc += m.p
        if (roll >= acc) continue
        // Only where the whole mark sits on one country in one light.
        const same = m.px.every(([dx, dy]) => biome[k + dy * W + dx] === biome[k] && zone[k + dy * W + dx] === zone[k] && hex(ground.get(x + dx, y + dy)) === earth(x, y)[0])
        if (same) for (const [dx, dy, c] of m.px) ground.set(x + dx, y + dy, earth(x, y)[c])
        break
      }
    }
  }
}

// Everything from here on is painted in daylight colours on `feat` and put through the
// light table at the end.
const feat = new Canvas(W, H)

/* The river: dark banks, blue water. */
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const k = y * W + x
    const d = riverField.d[k]
    const half = riverHalf(riverField.s[k])
    if (d > half + 1.2) continue
    feat.set(x, y, d > half ? P.blue[0] : d > half - 1.3 ? P.blue[1] : P.blue[2])
  }
}

/* Mesas: a flat top and a cliff down its south side. */
function paintMesa(cx, cy, rx, ry, h, seed) {
  const top = (x, y) => {
    const a = Math.atan2((y - cy) / ry, (x - cx) / rx)
    const r = 1 + 0.1 * Math.sin(a * 3 + seed) + 0.06 * Math.sin(a * 7 + seed * 2.3)
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < r * r
  }
  const drop = (x, y) => {
    for (let k = 1; k <= h; k++) if (top(x, y - k)) return k
    return 0
  }
  const body = new Canvas(W, H)
  for (let y = Math.floor(cy - ry * 1.3); y <= cy + ry * 1.3 + h + 1; y++) {
    for (let x = Math.floor(cx - rx * 1.3); x <= cx + rx * 1.3; x++) {
      if (top(x, y)) {
        const rim = !top(x, y + 1)
        const shade = !top(x, y - 2) || !top(x - 2, y)
        body.set(x, y, rim ? P.wood[7] : shade ? P.wood[5] : P.wood[4])
        continue
      }
      const k = drop(x, y)
      if (!k) continue
      // Strata: a lit band under the rim, then red rock scored by gullies.
      const gully = hash2(Math.floor(x / 2), 0, seed) < 0.3
      body.set(x, y, k <= 2 ? P.orange[1] : gully ? P.red[1] : k >= h - 1 ? P.red[1] : P.orange[0])
    }
  }
  body.outline(K)
  feat.blit(body)
  // A few marks on top, so it reads as land and not as a lid.
  const rnd = seeded(seed * 77)
  for (let i = 0; i < Math.round((rx * ry) / 50); i++) {
    const x = Math.round(cx + (rnd() - 0.5) * rx * 1.3)
    const y = Math.round(cy + (rnd() - 0.5) * ry * 1.1)
    if (top(x - 2, y - 2) && top(x + 4, y + 3) && top(x - 2, y + 3) && top(x + 4, y - 2)) {
      feat.set(x, y, P.wood[3])
      feat.set(x + 1, y + 1, P.wood[3])
      feat.set(x + 2, y, P.wood[3])
    }
  }
}
const MESAS = [
  [430, 136, 21, 12, 12, 3],
  [530, 136, 25, 12, 13, 5],
  [24, 34, 20, 9, 9, 8],
]
for (const m of MESAS) paintMesa(...m)

/* Round fields under centre-pivot sprinklers. */
const PIVOTS = [
  { x: 150, y: 88, rx: 21, ry: 10 },
  { x: 300, y: 104, rx: 19, ry: 9 },
  { x: 258, y: 72, rx: 17, ry: 8 },
]
for (const f of PIVOTS) {
  feat.ellipse(f.x, f.y, f.rx + 1, f.ry + 1, P.green[0])
  feat.ellipse(f.x, f.y, f.rx, f.ry, P.green[2])
  feat.ellipse(f.x, f.y, f.rx * 0.7, f.ry * 0.7, P.green[1], { fill: false })
  feat.ellipse(f.x, f.y, f.rx * 0.38, f.ry * 0.38, P.green[1], { fill: false })
  feat.ellipse(f.x - 3, f.y - 2, f.rx * 0.5, f.ry * 0.35, P.green[3], { fill: false })
  feat.ellipse(f.x, f.y, f.rx * 0.7, f.ry * 0.7, P.green[1], { fill: false })
}

/* The railroad: ties under two rails. */
function paintTrack(c, only = null) {
  for (const p of TRACK) {
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (x < 0 || x >= W) continue
    if (only && !only(x, y)) continue
    const tie = x % 4 === 0
    if (tie) for (let dy = -3; dy <= 3; dy++) c.set(x, y + dy, P.mud[1])
    else for (let dy = -1; dy <= 1; dy++) c.set(x, y + dy, P.mud[3])
    c.set(x, y - 2, P.grey[1])
    c.set(x, y + 2, P.grey[1])
  }
}

/* Bridges. The highway's is concrete; the railroad's is a timber trestle. */
function paintBridge(c, f, { reach, half, deck, rail, plank }) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x
      if (riverField.d[k] > riverHalf(riverField.s[k]) + reach || f.d[k] > half + 1) continue
      if (f.d[k] > half) c.set(x, y, K)
      else if (f.d[k] > half - 1.2) c.set(x, y, rail)
      else c.set(x, y, Math.floor(f.s[k] / 3) % 2 ? deck : plank)
    }
  }
}

/* Roads. A locked road is a pencilled trail; an open one is a two-lane highway. */
const ASPHALT = P.grey[2]
const ROAD_EDGE = P.grey[0]
const ROAD_HALF = 4.4

function paintTrail(c, i) {
  const f = roadField[i]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x
      if (f.d[k] <= 1.6 && Math.floor(f.s[k] / 5) % 2 === 0) c.set(x, y, P.mud[2])
    }
  }
}

/** True where another road's surface lies: this road's edge line must not cut across it. */
function onOtherRoad(k, i) {
  // A highway ignores the hidden roads: they may never open.
  for (let j = 0; j < ROADS.length; j++) if (j !== i && (ROADS[i].secret || !ROADS[j].secret) && roadField[j].d[k] <= ROAD_HALF) return true
  return false
}

function paintHighway(c, i) {
  const f = roadField[i]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x
      const d = f.d[k]
      if (d > ROAD_HALF + 1) continue
      if (d > ROAD_HALF) {
        if (!onOtherRoad(k, i)) c.set(x, y, ROAD_EDGE)
      } else if (d < 0.75 && Math.floor(f.s[k] / 4) % 2 === 0) c.set(x, y, P.yellow[1])
      else c.set(x, y, ASPHALT)
      // Rails run on across the road at a crossing.
      if (d <= ROAD_HALF && trackField.d[k] < 3 && Math.abs(Math.abs(y - trackY(x)) - 2) < 0.6) c.set(x, y, P.grey[4])
    }
  }
}

/** The hidden road is a dirt one: two ruts and a crown. Where it meets the river, a ford of flat stones. */
function paintDirtRoad(c, i) {
  const f = roadField[i]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x
      const d = f.d[k]
      if (d > 4.3) continue
      const wet = riverField.d[k] < riverHalf(riverField.s[k]) - 0.5
      if (wet) {
        const stone = Math.floor(f.s[k] / 3) % 2 === 0 && d < 3
        c.set(x, y, stone ? (d < 2 ? P.grey[5] : P.grey[3]) : P.blue[3])
      } else if (d > 3.3) {
        if (!onOtherRoad(k, i)) c.set(x, y, P.mud[1])
      } else if (d > 1.2 && d < 2.4 && Math.floor(f.s[k] / 7) % 3 !== 0) c.set(x, y, P.wood[5])
      else c.set(x, y, P.wood[7])
      if (d <= 3.3 && trackField.d[k] < 3 && Math.abs(Math.abs(y - trackY(x)) - 2) < 0.6) c.set(x, y, P.grey[1])
    }
  }
}

paintTrack(feat)
paintBridge(feat, trackField, { reach: 4, half: 4, deck: P.wood[1], rail: P.wood[2], plank: P.mud[1] })
paintTrack(feat, (x, y) => riverField.d[y * W + x] < 12)
const R5 = ROADS.findIndex((r) => r.a === 'mw05')
paintBridge(feat, roadField[R5], { reach: 5, half: 6.6, deck: P.grey[4], rail: P.grey[5], plank: P.grey[4] })
ROADS.forEach((r, i) => {
  if (!r.secret) paintTrail(feat, i)
})

/* ------------------------------------------------------------------ */
/* 6. Sprites: toolkit                                                 */
/* ------------------------------------------------------------------ */

// One letter per colour, for the hand-pixelled pieces.
const LG = {
  K: P.outline, N: P.navy,
  0: P.grey[0], 1: P.grey[1], 2: P.grey[2], 3: P.grey[3], 4: P.grey[4], 5: P.grey[5], 6: P.grey[6],
  r: P.red[1], s: P.red[2], R: P.red[3], S: P.red[4], p: P.red[5],
  n: P.blue[0], b: P.blue[1], B: P.blue[2], c: P.blue[3], C: P.blue[4],
  q: P.teal[0], t: P.teal[1], T: P.teal[2],
  h: P.green[0], g: P.green[1], G: P.green[2], H: P.green[3],
  w: P.wood[0], a: P.wood[1], A: P.wood[2], d: P.wood[3], D: P.wood[4], e: P.wood[5], E: P.wood[6], f: P.wood[7], F: P.wood[8],
  k: P.mud[0], m: P.mud[1], M: P.mud[2], u: P.mud[3], U: P.mud[4],
  o: P.yellow[0], y: P.yellow[1], Y: P.yellow[2],
  x: P.purple[0], v: P.purple[1], V: P.purple[2], l: P.purple[3],
  j: P.orange[0], O: P.orange[1], J: P.orange[2],
  z: P.ice[0], i: P.ice[1], I: P.ice[2],
  X: P.pink[0],
}
const art = (rows) => Canvas.fromText(rows, LG)

/** A filled box with a 1 px line round it. */
function obox(c, x, y, w, h, fill, line = K) {
  c.rect(x, y, w, h, line)
  if (w > 2 && h > 2) c.rect(x + 1, y + 1, w - 2, h - 2, fill)
  return c
}

/** Every colour to a grey of the same weight: a site that is still locked. */
const GREYS = [P.grey[0], P.grey[1], P.grey[2], P.grey[3], P.grey[4]]
function dimmed(canvas, dark = false) {
  const ramp = dark ? [P.grey[0], P.grey[0], P.grey[1], P.grey[1], P.grey[2]] : GREYS
  return canvas.clone().map((c) => {
    if ((c & 0xff) === 0 || c === rgba(K)) return c
    const l = ((c >>> 24) * 0.3 + ((c >>> 16) & 0xff) * 0.59 + ((c >>> 8) & 0xff) * 0.11) / 255
    return ramp[Math.min(4, Math.floor(l * 5.2))]
  })
}

/** The Mighty Wash shield: red M over blue W. */
const SHIELD = art([
  '.KKKKKKK.',
  'KRRRRRRRK',
  'KR6RRR6RK',
  'KR66R66RK',
  'KR6R6R6RK',
  'KB6B6B6BK',
  'KB66B66BK',
  'KB6BBB6BK',
  '.KBBBBBK.',
  '..KKKKK..',
])

/** A tunnel mouth: dark, with the wash's hanging cloth strips swaying inside. */
function mouth(c, x, y, w, h, f, { round = 0 } = {}) {
  obox(c, x, y, w, h, P.grey[0])
  for (let i = 0; i < round; i++) {
    c.rect(x, y + i, round - i, 1, 0)
    c.rect(x + w - round + i, y + i, round - i, 1, 0)
    c.set(x + round - i, y + i, K)
    c.set(x + w - 1 - round + i, y + i, K)
  }
  for (let i = 0; x + 2 + i * 2 < x + w - 2; i++) {
    const len = Math.max(2, Math.round(h * 0.45) + ((i + f) % 2) - (i % 3 === 0 ? 1 : 0))
    c.rect(x + 2 + i * 2, y + 1 + (i < round || i * 2 + 4 > w - round ? round - 1 : 0), 1, len, i % 2 ? P.red[3] : P.blue[2])
  }
}

/** A window pane with a glint. `lit` = a lamp is on inside (drawn later, not here). */
function pane(c, x, y, w, h, glass = P.blue[3]) {
  obox(c, x, y, w, h, glass)
  c.rect(x + 1, y + 1, Math.max(1, Math.floor((w - 2) / 2)), 1, P.blue[4])
}

/* ------------------------------------------------------------------ */
/* The buildings. Each returns its frames in daylight colours, plus    */
/* `glow(c, f)`: the lamps, painted after the light table.             */
/* ------------------------------------------------------------------ */

const BUILD = {}

// MW01 Grand Opening: the bright new wash, balloons on the roof and bunting across the front.
BUILD.mw01 = {
  w: 50, h: 40, sign: [0, -29], tube: [-31, 0], ticks: 24,
  draw(c, f) {
    obox(c, 2, 13, 46, 27, P.grey[6])
    obox(c, 0, 10, 50, 5, P.grey[5])
    c.rect(1, 11, 48, 1, P.grey[6])
    c.rect(3, 15, 44, 3, P.blue[2])
    c.rect(3, 18, 44, 2, P.red[3])
    c.rect(3, 36, 44, 3, P.grey[5])
    mouth(c, 5, 23, 17, 17, f)
    pane(c, 25, 25, 11, 8)
    obox(c, 39, 26, 7, 14, P.blue[1])
    c.set(44, 33, P.yellow[1])
    // bunting across the front
    for (let i = 0; i < 11; i++) {
      const x = 4 + i * 4
      const col = [P.red[4], P.yellow[1], P.blue[2]][i % 3]
      c.rect(x, 21, 3, 1, col)
      c.set(x + 1, 22, col)
    }
    // balloons at the corners, bobbing
    const bal = (x, y, col, hi) => {
      c.ellipse(x, y, 2, 2.6, K)
      c.ellipse(x, y, 1, 1.6, col)
      c.set(x - 1, y - 1, hi)
      c.line(x, y + 3, x, y + 5, K)
    }
    bal(4, 4 + f, P.red[4], P.red[5])
    bal(46, 3 + (1 - f), P.blue[2], P.blue[4])
    bal(42, 5 + f, P.yellow[1], P.yellow[2])
  },
}

// MW02 Vacuum Alley: a striped canopy over a row of vacuums.
BUILD.mw02 = {
  w: 54, h: 38, sign: [4, -28], tube: [-33, 0], ticks: 30,
  draw(c, f) {
    // booth
    obox(c, 0, 16, 15, 22, P.grey[6])
    c.rect(1, 17, 13, 2, P.blue[2])
    pane(c, 3, 21, 9, 6)
    c.rect(1, 34, 13, 3, P.grey[5])
    // canopy posts and roof
    for (const x of [17, 51]) obox(c, x, 14, 3, 24, P.grey[4])
    obox(c, 13, 9, 41, 7, P.grey[6])
    for (let i = 0; i < 7; i++) c.rect(14 + i * 6, 10, 3, 5, P.red[3])
    c.rect(14, 14, 39, 1, P.grey[4])
    // three vacuums: a canister, a red dome, a hose that swings
    for (let i = 0; i < 3; i++) {
      const x = 23 + i * 10
      obox(c, x, 24, 6, 14, P.grey[4])
      c.rect(x + 1, 25, 1, 12, P.grey[6])
      obox(c, x, 21, 6, 4, P.red[3])
      c.set(x + 1, 22, P.red[5])
      c.rect(x + 2, 29, 2, 3, P.yellow[1])
      const sway = (i + f) % 2
      c.line(x + 6, 26, x + 8, 27 + sway, K)
      c.line(x + 8, 27 + sway, x + 8, 33, K)
      c.set(x + 7, 34, K)
    }
    c.rect(16, 37, 38, 1, P.grey[3])
  },
}

// MW03 Tunnel Vision: the long tunnel, brushes spinning in the windows.
BUILD.mw03 = {
  w: 56, h: 38, sign: [10, -29], tube: [-34, 0], ticks: 12,
  draw(c, f) {
    obox(c, 1, 14, 54, 24, P.grey[5])
    // barrel roof
    for (let x = 1; x < 55; x++) {
      const t = (x - 28) / 27
      const top = 9 + Math.round(5 * t * t)
      c.rect(x, top, 1, 15 - top, P.blue[1])
      c.set(x, top, K)
      if (x % 6 === 3) c.rect(x, top + 1, 1, 14 - top, P.blue[0])
    }
    c.rect(1, 14, 54, 1, K)
    c.rect(2, 15, 52, 2, P.red[3])
    c.rect(2, 35, 52, 2, P.grey[4])
    mouth(c, 4, 19, 19, 19, f, { round: 3 })
    // hazard stripes at the mouth
    for (let i = 0; i < 9; i++) c.rect(5 + i * 2, 36, 1, 1, i % 2 ? P.yellow[1] : P.grey[0])
    // portholes, a brush turning in each
    for (let i = 0; i < 3; i++) {
      const x = 30 + i * 9
      c.circle(x, 26, 4, K)
      c.circle(x, 26, 3, P.blue[4])
      const a = ((i * 2 + f) % 4) * (Math.PI / 4)
      for (const s of [-1, 1]) c.line(x, 26, x + Math.round(Math.cos(a) * 2.4 * s), 26 + Math.round(Math.sin(a) * 2.4 * s), P.blue[2])
      c.line(x, 26, x + Math.round(Math.cos(a + Math.PI / 2) * 2.4), 26 + Math.round(Math.sin(a + Math.PI / 2) * 2.4), P.red[3])
      c.line(x, 26, x - Math.round(Math.cos(a + Math.PI / 2) * 2.4), 26 - Math.round(Math.sin(a + Math.PI / 2) * 2.4), P.red[3])
      c.set(x, 26, P.grey[6])
    }
  },
}

// MW04 Mud Season: mud up the walls, puddles in the yard, the lights on at midday.
BUILD.mw04 = {
  w: 50, h: 38, sign: [0, -27], tube: [31, 0], ticks: 16,
  draw(c, f) {
    obox(c, 3, 14, 44, 24, P.grey[6])
    // shed roof, higher on the left
    c.poly([[1, 15], [1, 11], [48, 13], [48, 15]], K)
    c.poly([[2, 14], [2, 12], [47, 14]], P.blue[1])
    c.rect(4, 16, 42, 2, P.red[3])
    mouth(c, 6, 22, 16, 16, f)
    pane(c, 26, 23, 8, 7, P.yellow[2])
    pane(c, 37, 23, 8, 7, P.yellow[2])
    // mud: splashed up from the ground
    const mud = [[4, 31, 3], [7, 34, 4], [23, 33, 3], [27, 35, 5], [33, 32, 2], [36, 34, 4], [42, 33, 3], [44, 30, 2], [24, 29, 1], [40, 29, 1]]
    for (const [x, y, r] of mud) c.ellipse(x, y + 2, r, r - 0.5, P.mud[2])
    for (const [x, y] of [[30, 27], [45, 26], [5, 27], [35, 20], [12, 19]]) c.set(x, y, P.mud[2])
    c.rect(4, 36, 42, 1, P.mud[1])
    // puddles, rings spreading where the rain lands
    for (const [x, w, k] of [[1, 9, 0], [36, 12, 1]]) {
      c.rect(x, 37, w, 1, P.teal[0])
      c.rect(x + 1, 37, w - 2, 1, (f + k) % 2 ? P.teal[1] : P.teal[0])
      c.set(x + 2 + ((f + k) % 2) * 3, 37, P.teal[2])
    }
  },
}

// MW05 Lube Pit: a block garage, one bay open with a car up on the lift.
BUILD.mw05 = {
  w: 52, h: 38, sign: [-6, -27], tube: [-32, 0], ticks: 40,
  draw(c, f) {
    obox(c, 1, 12, 42, 26, P.grey[4])
    for (let y = 16; y < 36; y += 4) c.rect(2, y, 40, 1, P.grey[3])
    // stepped parapet with an orange band
    obox(c, 0, 10, 44, 4, P.grey[3])
    c.rect(1, 11, 42, 2, P.orange[1])
    for (let x = 3; x < 42; x += 6) c.rect(x, 11, 3, 2, P.grey[0])
    // closed bay
    obox(c, 4, 19, 16, 19, P.grey[6])
    for (let y = 22; y < 37; y += 3) c.rect(5, y, 14, 1, P.grey[4])
    // open bay: the pit, a car on the lift going up and down
    obox(c, 23, 19, 17, 19, P.grey[0])
    c.rect(24, 34, 15, 3, P.grey[1])
    const y = 26 - f * 2
    c.rect(31, y + 5, 1, 34 - y - 5, P.grey[4])
    c.rect(26, y + 4, 11, 1, P.yellow[1])
    c.rect(27, y + 1, 9, 3, P.red[3])
    c.rect(29, y - 1, 5, 2, P.red[4])
    c.rect(30, y, 3, 1, P.blue[4])
    c.set(27, y + 2, P.yellow[2])
    // the oil-drop sign
    obox(c, 9, 14, 6, 6, P.yellow[1])
    c.set(11, 15, P.grey[0])
    c.rect(11, 16, 2, 2, P.grey[0])
    c.rect(10, 17, 4, 1, P.grey[0])
    // drums round the side
    const drum = (x, yy, col, hi) => {
      obox(c, x, yy, 5, 7, col)
      c.rect(x + 1, yy + 2, 3, 1, hi)
      c.rect(x + 1, yy + 4, 3, 1, hi)
    }
    drum(44, 31, P.blue[1], P.blue[3])
    drum(47, 31, P.teal[0], P.teal[1])
    drum(45, 25, P.red[2], P.red[4])
    // hazard stripes along the base
    for (let x = 2; x < 42; x += 2) if (c.get(x, 37) === rgba(P.grey[4])) c.set(x, 37, x % 4 ? P.orange[1] : P.grey[0])
  },
}

// MW06 Bug Season Boulevard: a roadside wash under a billboard, bugs round the lamp.
BUILD.mw06 = {
  w: 52, h: 42, sign: [9, -29], tube: [34, 0], ticks: 10,
  draw(c, f) {
    // billboard on two legs
    for (const x of [4, 17]) obox(c, x, 18, 3, 24, P.wood[1])
    c.line(6, 30, 17, 24, P.wood[1])
    obox(c, 0, 2, 24, 17, P.blue[3])
    c.rect(1, 14, 22, 4, P.wood[6])
    // a bug on the billboard, and a red line through it
    c.ellipse(10, 9, 4, 3, P.green[1])
    c.ellipse(10, 9, 3, 2, P.green[2])
    c.set(8, 8, P.grey[6])
    c.set(11, 8, P.grey[6])
    c.line(6, 6, 4, 4, K)
    c.line(14, 6, 16, 4, K)
    c.line(6, 12, 4, 13, K)
    c.line(14, 12, 16, 13, K)
    c.circle(10, 9, 6, P.red[3], { fill: false })
    c.line(6, 13, 14, 5, P.red[3])
    c.text(15, 13, '', K)
    // the wash
    obox(c, 22, 16, 30, 26, P.grey[6])
    obox(c, 20, 13, 32, 5, P.orange[1])
    c.rect(21, 14, 30, 1, P.orange[2])
    c.rect(23, 18, 28, 2, P.blue[2])
    mouth(c, 25, 25, 15, 17, f)
    pane(c, 42, 26, 8, 7)
    c.rect(23, 39, 2, 2, P.grey[5])
    c.rect(40, 39, 11, 2, P.grey[5])
    // a lamp on the corner, and the swarm round it
    obox(c, 49, 4, 3, 10, P.grey[3])
    obox(c, 45, 3, 7, 4, P.yellow[2])
    const bugs = [[[42, 9], [47, 10], [44, 1], [50, 9], [43, 5]], [[43, 8], [46, 11], [45, 0], [51, 8], [42, 3]], [[44, 9], [48, 10], [43, 1], [50, 11], [41, 6]]]
    for (const [x, y] of bugs[f % 3]) c.set(x, y, K)
  },
  frames: 3,
}

// MW07 Salt Storm: snowed in, icicles off the eaves, a snowman and the salt pile.
BUILD.mw07 = {
  w: 50, h: 40, sign: [-2, -31], tube: [32, 0], ticks: 30,
  draw(c, f) {
    obox(c, 6, 18, 34, 22, P.red[2])
    for (let y = 22; y < 38; y += 4) c.rect(7, y, 32, 1, P.red[1])
    // roof under snow
    c.poly([[3, 19], [8, 10], [38, 10], [43, 19]], K)
    c.poly([[5, 18], [9, 11], [37, 11], [41, 18]], P.grey[6])
    c.rect(9, 11, 28, 1, P.ice[2])
    c.poly([[6, 18], [8, 15], [38, 15], [40, 18]], P.ice[1])
    c.rect(5, 18, 37, 1, P.grey[6])
    // icicles
    for (const [x, len] of [[7, 3], [11, 2], [14, 4], [20, 2], [25, 3], [30, 2], [34, 4], [38, 2]]) {
      c.rect(x, 19, 1, len, P.ice[1])
      c.set(x, 19 + len, P.ice[0])
    }
    mouth(c, 9, 25, 14, 15, f)
    pane(c, 27, 25, 9, 7, P.yellow[2])
    // chimney and its smoke
    obox(c, 30, 4, 5, 8, P.red[1])
    c.rect(30, 4, 5, 2, P.grey[6])
    c.rect(29, 3, 7, 1, K)
    c.set(33 + f, 1, P.grey[5])
    c.set(32 - f, 0, P.grey[5])
    // snowman
    c.circle(2.5, 36.5, 2, K)
    c.circle(2.5, 36.5, 1.4, P.grey[6])
    c.circle(2.5, 32.5, 1.6, K)
    c.circle(2.5, 32.5, 1, P.grey[6])
    c.set(3, 32, P.orange[1])
    c.set(1, 30, K)
    c.rect(1, 29, 3, 1, K)
    // the salt pile and a shovel stuck in it
    c.poly([[40, 39], [45, 31], [50, 39]], K)
    c.poly([[42, 39], [45, 33], [48, 39]], P.grey[6])
    c.line(46, 35, 48, 38, P.ice[1])
    c.line(47, 25, 45, 32, P.wood[1])
    c.rect(46, 23, 3, 3, P.grey[3])
  },
}

// MW08 The Mega Tunnel: a great arch ringed in neon, a marquee of chasing bulbs.
BUILD.mw08 = {
  w: 84, h: 50, sign: [0, -47], tube: [-48, 0], ticks: 8, frames: 4,
  draw(c) {
    obox(c, 2, 16, 80, 34, P.grey[3])
    obox(c, 0, 12, 84, 6, P.grey[4])
    c.rect(1, 13, 82, 1, P.grey[5])
    // wings: tall dark windows
    for (const x0 of [5, 62]) for (let i = 0; i < 3; i++) obox(c, x0 + i * 6, 24, 5, 12, P.grey[1])
    // chrome columns either side of the arch
    for (const x of [24, 56]) {
      obox(c, x, 18, 5, 32, P.grey[5])
      c.rect(x + 1, 19, 1, 30, P.grey[6])
      c.rect(x + 3, 19, 1, 30, P.grey[4])
    }
    // the arch, stepped in like the throat of the tunnel
    const arch = (inset, col) => {
      const x0 = 29 + inset
      const w = 26 - inset * 2
      const top = 21 + inset
      c.rect(x0, top + 3, w, 50 - top - 3, col)
      c.rect(x0 + 1, top + 1, w - 2, 2, col)
      c.rect(x0 + 3, top, w - 6, 1, col)
    }
    arch(0, K)
    arch(1, P.grey[1])
    arch(4, K)
    arch(5, P.grey[0])
    c.rect(34, 47, 16, 3, P.grey[1])
    // marquee
    obox(c, 22, 2, 40, 12, P.grey[1])
    c.text(27, 5, 'MEGA', P.grey[5], 1)
    c.text(45, 5, 'WASH', P.grey[5], 1)
  },
  glow(c, f) {
    // neon round the arch: red outside, blue inside, one of them buzzing
    const ring = (inset, col) => {
      const x0 = 29 + inset
      const w = 26 - inset * 2
      const top = 21 + inset
      c.rect(x0, top + 3, 1, 50 - top - 3, col)
      c.rect(x0 + w - 1, top + 3, 1, 50 - top - 3, col)
      c.rect(x0 + 1, top + 1, 2, 1, col)
      c.rect(x0 + w - 3, top + 1, 2, 1, col)
      c.set(x0 + 1, top + 2, col)
      c.set(x0 + w - 2, top + 2, col)
      c.rect(x0 + 3, top, w - 6, 1, col)
    }
    ring(2, f === 3 ? P.red[1] : P.red[4])
    ring(6, P.blue[2])
    ring(8, f % 2 ? P.blue[1] : P.blue[3])
    // marquee letters and a chase of bulbs round it
    c.text(27, 5, 'MEGA', P.red[4], 1)
    c.text(45, 5, 'WASH', P.blue[3], 1)
    let n = 0
    const bulb = (x, y) => c.set(x, y, n++ % 4 === f ? P.grey[6] : n % 2 ? P.yellow[1] : P.yellow[0])
    for (let x = 23; x <= 60; x += 2) bulb(x, 3)
    for (let y = 5; y <= 11; y += 2) bulb(60, y)
    for (let x = 60; x >= 23; x -= 2) bulb(x, 12)
    for (let y = 11; y >= 5; y -= 2) bulb(23, y)
    // lit windows in the wings
    for (const x0 of [5, 62]) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) if ((i + k + (x0 > 30 ? 1 : 0)) % 3 !== 0) c.rect(x0 + i * 6 + 1, 25 + k * 4, 3, 2, (i * 3 + k + f) % 7 === 0 ? P.yellow[0] : P.yellow[2])
    // roofline tubes
    for (let x = 2; x < 82; x += 1) if (x < 21 || x > 62) c.set(x, 11, x % 8 < 5 ? P.blue[2] : P.red[4])
  },
}

// Mighty Wash HQ: two floors of blue glass, the shield on the roof, the flag out front.
BUILD.hq = {
  w: 54, h: 46, sign: [0, 0], tube: [0, 0], ticks: 14,
  draw(c, f) {
    obox(c, 2, 14, 40, 32, P.grey[6])
    obox(c, 0, 11, 44, 5, P.red[3])
    c.rect(1, 12, 42, 1, P.red[4])
    for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) if (!(row === 1 && i === 1)) pane(c, 5 + i * 9, 19 + row * 12, 7, 8)
    obox(c, 13, 30, 9, 16, P.blue[1])
    c.rect(17, 31, 1, 14, K)
    c.set(15, 38, P.yellow[1])
    c.set(19, 38, P.yellow[1])
    c.rect(3, 42, 9, 3, P.grey[5])
    c.rect(23, 42, 18, 3, P.grey[5])
    // the shield, big, on the roof
    c.blit(SHIELD.scale(1), 17, 1)
    obox(c, 27, 4, 11, 8, P.blue[1])
    c.text(29, 6, 'HQ', P.grey[6])
    // the flag: a blue hoist with a white star, white over red
    obox(c, 46, 6, 2, 40, P.grey[4])
    c.set(46, 5, P.yellow[1])
    const wave = f ? [0, 0, 1, 1] : [0, 1, 1, 0]
    for (let i = 0; i < 4; i++) {
      const x = 48 + i * 2 - (i === 3 ? 0 : 0)
      if (x > 53) break
      const y = 7 + wave[i]
      c.rect(x, y, 2, 3, i === 0 ? P.blue[1] : P.grey[6])
      c.rect(x, y + 3, 2, 3, i === 0 ? P.blue[1] : P.red[3])
      c.rect(x, y - 1, 2, 1, K)
      c.rect(x, y + 6, 2, 1, K)
    }
    c.set(48, 9 + wave[0], P.grey[6])
  },
}

// Rival Row: a fenced back lot, a dumpster, a lamp that cannot make up its mind.
BUILD.rivals = {
  w: 72, h: 42, sign: [-22, -31], tube: [0, 0], ticks: 9, frames: 4,
  draw(c) {
    // cracked asphalt
    c.ellipse(36, 35, 35, 6, K)
    c.ellipse(36, 35, 34, 5, P.grey[2])
    c.line(20, 33, 26, 36, P.grey[1])
    c.line(26, 36, 30, 35, P.grey[1])
    c.line(46, 37, 52, 34, P.grey[1])
    // chain link fence
    for (let x = 4; x < 68; x++) {
      for (let y = 14; y < 31; y++) if ((x + y) % 4 === 0 || (x - y + 40) % 4 === 0) c.set(x, y, P.grey[3])
    }
    c.rect(3, 13, 66, 1, P.grey[4])
    for (const x of [3, 24, 46, 68]) obox(c, x, 11, 3, 22, P.grey[4])
    // a board on the fence
    obox(c, 5, 15, 17, 13, P.wood[2])
    c.text(6, 16, 'KEEP', P.wood[0])
    c.text(8, 22, 'OUT', P.red[1])
    // dumpster
    obox(c, 50, 22, 17, 12, P.green[1])
    c.rect(51, 23, 15, 2, P.green[2])
    c.rect(53, 27, 1, 6, P.green[0])
    c.rect(63, 27, 1, 6, P.green[0])
    c.poly([[49, 22], [51, 19], [67, 19], [68, 22]], K)
    c.poly([[51, 21], [52, 20], [66, 20], [67, 21]], P.green[0])
    // lamp post
    obox(c, 30, 3, 3, 30, P.grey[2])
    obox(c, 27, 1, 9, 4, P.grey[1])
    // oil drum, for the fire
    obox(c, 37, 25, 7, 9, P.grey[3])
    c.rect(38, 28, 5, 1, P.grey[1])
    c.rect(38, 31, 5, 1, P.grey[1])
  },
  glow(c, f) {
    // the lamp flickers: on, on, dim, on
    c.rect(28, 4, 7, 1, f === 2 ? P.yellow[0] : P.yellow[2])
    if (f !== 2) {
      c.set(27, 5, P.yellow[1])
      c.set(35, 5, P.yellow[1])
    }
    // fire in the drum
    const flame = [[[39, 23], [40, 21], [41, 23], [42, 24]], [[39, 24], [40, 22], [41, 21], [42, 23]], [[38, 24], [40, 23], [41, 22], [42, 24]], [[39, 22], [40, 23], [41, 21], [41, 24]]][f]
    for (const [x, y] of flame) {
      c.rect(x, y, 1, 25 - y, P.orange[1])
      c.set(x, y, P.yellow[1])
    }
    c.rect(39, 24, 3, 1, P.yellow[2])
  },
}

/** A site's frames, as they stand in their own light: { open: [...], off } with anchors. */
function buildSite(id) {
  const b = BUILD[id]
  const z = zoneAt(SITES[id].x, SITES[id].y - 10)
  const n = b.frames ?? 2
  const open = []
  for (let f = 0; f < n; f++) {
    const day = new Canvas(b.w, b.h)
    b.draw(day, f)
    const c = lit(day, z).clone()
    b.glow?.(c, f)
    open.push(c)
  }
  const plain = new Canvas(b.w, b.h)
  b.draw(plain, 0)
  return { open, off: dimmed(plain, z === 'night' || z === 'twi'), zone: z }
}


/* ------------------------------------------------------------------ */
/* 6b. Props: what stands around the sites. Each kind is a function   */
/* (f) -> canvas in daylight colours; `frames` is how many it has.     */
/* ------------------------------------------------------------------ */

const rad = (deg) => (deg * Math.PI) / 180
const swapRamp = (from, to) => Object.fromEntries(from.map((c, i) => [c, to[i]]))

const KIND = {}

// A wind turbine on the caprock: three blades repeat every 120 degrees, so four frames at 30 loop.
KIND.turbine = {
  w: 23, h: 37, frames: 4, ticks: 7,
  draw(c, f) {
    const hx = 11
    const hy = 11
    for (let y = hy + 2; y <= 35; y++) {
      c.set(hx, y, P.grey[6])
      c.set(hx + 1, y, P.grey[4])
      if (y > 27) c.set(hx - 1, y, P.grey[6])
    }
    c.rect(hx - 1, hy - 1, 4, 3, P.grey[5])
    c.rect(hx - 1, hy - 1, 3, 1, P.grey[6])
    for (let k = 0; k < 3; k++) {
      const a = rad(f * 30 + k * 120 - 90)
      c.line(hx + Math.cos(a) * 2, hy + Math.sin(a) * 2, hx + Math.cos(a) * 10, hy + Math.sin(a) * 10, P.grey[6])
    }
    c.outline(K)
    c.set(hx, hy, P.red[3])
  },
}

// A pumpjack nodding over its well: the beam rocks, the crank turns, the horsehead dips.
KIND.pumpjack = {
  w: 27, h: 19, frames: 6, ticks: 9,
  draw(c, f) {
    const t = (f / 6) * Math.PI * 2
    const tilt = rad(13) * Math.sin(t)
    const px = 14
    const py = 6
    // skid and post
    c.rect(2, 16, 23, 2, P.grey[2])
    c.rect(2, 16, 23, 1, P.grey[3])
    c.line(11, 15, px, py + 1, P.grey[3])
    c.line(17, 15, px, py + 1, P.grey[2])
    c.line(12, 12, 16, 12, P.grey[2])
    // crank and counterweight, round the gearbox
    const gx = 20
    const gy = 12
    const cx = gx + Math.round(Math.cos(t) * 3)
    const cy = gy + Math.round(Math.sin(t) * 3)
    c.rect(gx - 1, gy, 3, 4, P.grey[2])
    c.circle(cx, cy, 1.5, P.grey[1])
    // beam
    const ex = (d) => px + Math.cos(tilt) * d
    const ey = (d) => py + Math.sin(tilt) * d
    c.line(ex(-10), ey(-10), ex(7), ey(7), P.yellow[1], 2)
    c.line(ex(-10), ey(-10) - 1, ex(7), ey(7) - 1, P.yellow[2])
    // pitman arm from the crank to the tail of the beam
    c.line(ex(7), ey(7), cx, cy, P.grey[3])
    // horsehead
    const hx = Math.round(ex(-11))
    const hy = Math.round(ey(-11))
    c.rect(hx - 1, hy - 1, 2, 5, P.yellow[1])
    c.set(hx - 2, hy, P.yellow[1])
    c.set(hx - 2, hy + 1, P.yellow[0])
    c.rect(hx, hy, 1, 4, P.yellow[0])
    // the polished rod down to the wellhead
    c.line(hx - 1, hy + 4, hx - 1, 14, P.grey[5])
    c.rect(hx - 2, 14, 3, 2, P.grey[3])
    c.outline(K)
  },
}

// An old water-pumping windmill: lattice tower, a wheel of blades, the tail vane.
KIND.windmill = {
  w: 19, h: 31, frames: 3, ticks: 8,
  draw(c, f) {
    c.line(5, 29, 8, 9, P.grey[4])
    c.line(12, 29, 9, 9, P.grey[3])
    for (const y of [14, 20, 25]) {
      const l = 5 + Math.round(((29 - y) / 20) * 3)
      const r = 12 - Math.round(((29 - y) / 20) * 3)
      c.line(l, y, r, y, P.grey[3])
    }
    c.line(6, 25, 10, 20, P.grey[3])
    c.line(7, 20, 10, 14, P.grey[3])
    // tail vane
    c.line(9, 6, 16, 6, P.grey[4])
    c.rect(15, 3, 2, 6, P.grey[5])
    // wheel
    for (let k = 0; k < 8; k++) {
      const a = rad(k * 45 + f * 15)
      c.line(8 + Math.cos(a) * 2, 6 + Math.sin(a) * 2, 8 + Math.cos(a) * 5, 6 + Math.sin(a) * 5, k % 2 ? P.grey[5] : P.grey[6])
    }
    c.outline(K)
    c.set(8, 6, P.grey[3])
  },
}

/** Cattle, side on, facing left. Hereford, Angus and one Texas Longhorn. */
function cow(breed, pose) {
  const col = {
    hereford: { b: P.red[1], hi: P.red[2], sh: P.red[0], face: P.grey[6], fsh: P.grey[5] },
    angus: { b: P.grey[1], hi: P.grey[2], sh: P.grey[0], face: P.grey[1], fsh: P.grey[0] },
    longhorn: { b: P.wood[3], hi: P.wood[4], sh: P.wood[2], face: P.wood[3], fsh: P.wood[2] },
  }[breed]
  const c = new Canvas(21, 14)
  const ox = 2
  const oy = 2
  const R = (x, y, w, h, k) => c.rect(ox + x, oy + y, w, h, k)
  // legs first, body over them
  R(5, 7, 1, 3, col.sh)
  R(7, 7, 1, 3, col.b)
  R(12, 7, 1, 3, col.sh)
  R(14, 7, 1, 3, col.b)
  R(5, 2, 11, 6, col.b)
  R(6, 2, 9, 1, col.hi)
  R(5, 7, 11, 1, col.sh)
  if (breed === 'hereford') {
    R(6, 7, 3, 1, P.grey[6])
    R(5, 2, 1, 2, P.grey[6])
  }
  if (breed === 'longhorn') {
    R(8, 3, 3, 3, P.grey[6])
    R(13, 2, 2, 2, P.grey[6])
  }
  // tail
  const swish = pose === 'tail'
  c.line(ox + 16, oy + 2, ox + (swish ? 18 : 16), oy + 6, col.b)
  c.set(ox + (swish ? 18 : 16), oy + 7, col.sh)
  // head: up, or down in the grass
  const down = pose === 'graze'
  const hy = down ? 4 : 1
  R(3, down ? 3 : 2, 2, 3, col.b)
  R(0, hy, 4, 4, col.face)
  R(0, hy + 3, 2, 1, pose === 'chew1' ? P.red[5] : col.fsh)
  if (pose === 'chew1') R(0, hy + 4, 2, 1, col.fsh)
  if (breed === 'longhorn') {
    c.line(ox - 1, oy + hy - 1, ox + 5, oy + hy - 1, P.wood[8])
    c.set(ox - 2, oy + hy - 2, P.wood[8])
    c.set(ox + 6, oy + hy - 2, P.wood[8])
  } else {
    c.set(ox + 1, oy + hy - 1, P.wood[8])
    c.set(ox + 3, oy + hy - 1, P.wood[8])
  }
  c.outline(K)
  c.set(ox + 1, oy + hy + 1, pose === 'blink' ? col.fsh : K)
  return c
}
const COW_POSES = ['stand', 'chew1', 'stand', 'blink', 'graze', 'tail']
// One loop of a cow's life: stand, chew, blink, graze, flick the tail. Ticks per step.
const COW_SEQ = [
  [0, 70], [1, 9], [2, 9], [1, 9], [2, 9], [1, 9], [0, 40], [3, 6], [0, 60], [4, 120], [0, 20], [5, 10], [0, 8], [5, 10], [0, 50], [3, 6], [0, 14], [3, 6],
]

KIND.mesquite = {
  w: 21, h: 16, frames: 1,
  draw(c) {
    c.line(10, 15, 10, 10, P.mud[1])
    c.line(10, 11, 6, 8, P.mud[1])
    c.line(10, 10, 14, 7, P.mud[1])
    c.line(11, 15, 11, 12, P.mud[2])
    for (const [x, y, rx, ry] of [[5, 6, 4, 3], [10, 4, 5, 3], [15, 6, 4, 3], [9, 8, 3, 1]]) c.ellipse(x, y, rx, ry, P.green[1])
    for (const [x, y, rx] of [[4, 4, 2], [9, 2, 3], [14, 4, 2]]) c.ellipse(x, y, rx, 1, P.green[2])
    for (const [x, y] of [[3, 4], [8, 2], [10, 2], [13, 4], [6, 6]]) c.set(x, y, P.green[3])
    for (const [x, y] of [[7, 7], [12, 8], [16, 7], [2, 7]]) c.set(x, y, 0)
    c.outline(K)
  },
}
KIND.mesquiteS = {
  w: 15, h: 12, frames: 1,
  draw(c) {
    c.line(7, 11, 7, 7, P.mud[1])
    c.line(7, 8, 4, 6, P.mud[1])
    for (const [x, y, rx, ry] of [[4, 4, 3, 2], [8, 3, 3, 2], [11, 5, 2, 2]]) c.ellipse(x, y, rx, ry, P.green[1])
    for (const [x, y] of [[3, 3], [4, 3], [7, 2], [8, 2], [11, 4]]) c.set(x, y, P.green[2])
    c.set(9, 2, P.green[3])
    c.outline(K)
  },
}

KIND.cactus = {
  w: 12, h: 11, frames: 1,
  draw(c) {
    c.ellipse(4, 6, 2.5, 3, P.green[2])
    c.ellipse(7.5, 5, 2, 2.5, P.green[2])
    c.ellipse(5, 2.5, 1.5, 1.5, P.green[2])
    c.rect(5, 4, 1, 4, P.green[1])
    c.rect(9, 4, 1, 3, P.green[1])
    c.set(3, 5, P.green[3])
    c.set(7, 4, P.green[3])
    for (const [x, y] of [[2, 7], [6, 6], [8, 3], [4, 2]]) c.set(x, y, P.yellow[2])
    c.outline(K)
  },
}
KIND.cactusF = {
  w: 12, h: 12, frames: 1,
  draw(c) {
    c.ellipse(5, 7, 2.5, 3, P.green[2])
    c.ellipse(8, 5.5, 2, 2.5, P.green[2])
    c.rect(6, 5, 1, 4, P.green[1])
    c.set(4, 6, P.green[3])
    c.set(8, 4, P.green[3])
    for (const [x, y] of [[3, 8], [7, 8]]) c.set(x, y, P.yellow[2])
    c.rect(7, 2, 2, 2, P.pink[0])
    c.rect(4, 3, 2, 2, P.pink[0])
    c.set(7, 2, P.red[5])
    c.outline(K)
  },
}
KIND.yucca = {
  w: 11, h: 15, frames: 1,
  draw(c) {
    c.line(5, 9, 5, 2, P.wood[1])
    for (const [x, y] of [[4, 1], [6, 2], [4, 3], [6, 4], [5, 1]]) c.set(x, y, P.wood[8])
    for (const [x, y, k] of [[1, 10, P.green[1]], [2, 9, P.green[2]], [4, 8, P.green[2]], [6, 8, P.green[2]], [8, 9, P.green[1]], [9, 11, P.green[1]], [3, 11, P.green[2]]]) c.line(5, 13, x, y, k)
    c.outline(K)
  },
}

// The water tower of Suds, Texas.
KIND.watertower = {
  w: 24, h: 36, frames: 2, ticks: 40,
  draw(c) {
    for (const [x0, x1] of [[4, 6], [19, 17]]) c.line(x0, 34, x1, 16, P.grey[3])
    c.line(9, 34, 10, 16, P.grey[4])
    c.line(14, 34, 13, 16, P.grey[4])
    c.line(5, 30, 18, 22, P.grey[2])
    c.line(5, 22, 18, 30, P.grey[2])
    c.rect(5, 26, 14, 1, P.grey[3])
    c.ellipse(11.5, 10, 8, 6, P.grey[5])
    c.rect(4, 8, 16, 7, P.grey[5])
    c.rect(4, 8, 2, 7, P.grey[6])
    c.rect(18, 8, 2, 7, P.grey[4])
    c.ellipse(11.5, 4, 5, 2, P.grey[4])
    c.rect(11, 1, 1, 2, P.grey[3])
    c.text(4, 9, 'SUDS', P.blue[1])
    c.outline(K)
  },
  glow(c, f) {
    c.set(11, 0, f ? P.red[1] : P.red[4])
  },
}

KIND.elevator = {
  w: 22, h: 36, frames: 1,
  draw(c) {
    c.rect(2, 12, 15, 23, P.grey[5])
    for (const x of [2, 7, 12]) {
      c.rect(x, 12, 1, 23, P.grey[6])
      c.rect(x + 4, 12, 1, 23, P.grey[4])
    }
    c.rect(6, 2, 8, 11, P.grey[4])
    c.rect(6, 2, 8, 1, P.grey[5])
    c.rect(8, 5, 2, 2, P.grey[1])
    c.line(14, 6, 19, 30, P.grey[3])
    c.rect(17, 30, 3, 5, P.grey[3])
    c.text(4, 20, 'CO', P.red[2])
    c.text(4, 26, 'OP', P.red[2])
    c.outline(K)
  },
}

function townBuilding(w, h, draw, opts = {}) {
  return { w, h, frames: opts.frames ?? 1, ticks: opts.ticks, draw, glow: opts.glow }
}

KIND.cafe = townBuilding(22, 18, (c) => {
  obox(c, 1, 8, 20, 9, P.wood[6])
  c.rect(2, 9, 18, 1, P.wood[7])
  c.rect(1, 8, 20, 1, K)
  pane(c, 3, 11, 6, 4)
  obox(c, 12, 11, 4, 6, P.red[2])
  c.rect(17, 11, 3, 3, P.blue[3])
  // the big sign on its poles
  c.rect(6, 5, 1, 3, P.grey[3])
  c.rect(15, 5, 1, 3, P.grey[3])
  obox(c, 4, 0, 14, 7, P.grey[6])
  c.text(5, 1, 'EAT', P.red[3])
  c.outline(K)
}, { glow: (c) => c.rect(4, 12, 4, 2, P.yellow[2]) })

KIND.feed = townBuilding(24, 17, (c) => {
  obox(c, 1, 1, 22, 15, P.red[2])
  c.rect(2, 2, 20, 1, P.red[3])
  c.text(4, 3, 'FEED', P.grey[6])
  obox(c, 8, 9, 8, 7, P.wood[1])
  c.line(9, 10, 14, 15, P.wood[2])
  c.line(14, 10, 9, 15, P.wood[2])
  c.rect(17, 11, 4, 5, P.wood[7])
  c.rect(17, 11, 4, 1, P.wood[8])
  c.outline(K)
})

// A barbecue joint, the smoker going.
KIND.bbq = townBuilding(24, 22, (c, f) => {
  obox(c, 1, 9, 17, 12, P.wood[2])
  for (let y = 11; y < 20; y += 2) c.rect(2, y, 15, 1, P.wood[1])
  c.rect(1, 8, 17, 2, P.grey[2])
  obox(c, 4, 1, 12, 7, P.grey[1])
  c.text(5, 2, 'BBQ', P.orange[1])
  c.rect(6, 7, 1, 2, P.grey[3])
  c.rect(13, 7, 1, 2, P.grey[3])
  obox(c, 7, 13, 4, 8, P.wood[0])
  // the smoker: a black barrel with a stack
  obox(c, 18, 15, 6, 5, P.grey[1])
  c.rect(19, 16, 4, 1, P.grey[2])
  c.rect(21, 11, 2, 4, P.grey[1])
  const puffs = [[[21, 8], [23, 5], [22, 2]], [[22, 9], [21, 6], [23, 3]], [[21, 9], [22, 6], [21, 3]]][f]
  for (const [x, y] of puffs) c.rect(x, y, 2, 2, P.grey[5])
  c.outline(K)
}, { frames: 3, ticks: 14, glow: (c) => c.rect(5, 2, 10, 5, 0) })

KIND.church = townBuilding(16, 25, (c) => {
  obox(c, 2, 13, 12, 11, P.grey[6])
  c.poly([[1, 14], [8, 8], [14, 14]], K)
  c.poly([[3, 13], [8, 9], [12, 13]], P.red[2])
  obox(c, 6, 3, 5, 7, P.grey[6])
  c.poly([[6, 3], [8, 0], [10, 3]], P.red[2])
  c.set(8, 5, P.grey[3])
  obox(c, 6, 18, 4, 6, P.wood[1])
  pane(c, 3, 16, 3, 3)
  pane(c, 10, 16, 3, 3)
  c.outline(K)
}, { glow: (c) => { c.set(4, 17, P.yellow[2]); c.set(11, 17, P.yellow[2]) } })

function house(wall, roof, shade) {
  return townBuilding(14, 12, (c) => {
    obox(c, 1, 5, 12, 6, wall)
    c.poly([[0, 6], [3, 1], [10, 1], [13, 6]], K)
    c.poly([[1, 5], [4, 2], [9, 2], [12, 5]], roof)
    c.rect(4, 2, 6, 1, shade)
    pane(c, 3, 7, 3, 3)
    obox(c, 8, 7, 3, 4, P.wood[1])
    c.outline(K)
  }, { glow: (c) => c.set(4, 8, P.yellow[2]) })
}
KIND.house1 = house(P.grey[6], P.blue[1], P.blue[2])
KIND.house2 = house(P.wood[7], P.red[2], P.red[3])
KIND.house3 = house(P.teal[2], P.grey[2], P.grey[3])

// The high school stadium: home side, visitors, and the Friday lights.
KIND.stadium = {
  w: 48, h: 30, frames: 2, ticks: 24,
  draw(c, f) {
    obox(c, 3, 10, 42, 14, P.green[2])
    for (let x = 8; x < 42; x += 5) c.rect(x, 11, 1, 12, P.green[3])
    c.rect(4, 11, 3, 12, P.red[2])
    c.rect(41, 11, 3, 12, P.blue[1])
    // bleachers, the crowd in dots
    for (const [y, h] of [[5, 5], [24, 4]]) {
      obox(c, 6, y, 36, h, P.grey[4])
      for (let x = 7; x < 41; x++) if ((x + f + y) % 3 === 0) c.set(x, y + 1 + ((x + f) % 2), [P.red[3], P.blue[2], P.yellow[1], P.grey[6]][x % 4])
    }
    for (const x of [1, 46]) for (const y of [2, 21]) {
      c.rect(x, y + 1, 1, 7, P.grey[3])
      obox(c, x - 1, y - 2, 3, 3, P.grey[5])
    }
    c.outline(K)
  },
  glow(c) {
    for (const x of [1, 46]) for (const y of [2, 21]) c.set(x, y - 1, P.yellow[2])
  },
}

// A railroad crossing: crossbuck, two lamps. 0 dark, 1 and 2 the lamps taking turns.
KIND.xing = {
  w: 11, h: 16, frames: 3,
  draw(c, f) {
    c.line(5, 4, 5, 15, P.grey[5])
    c.line(2, 1, 8, 5, P.grey[6])
    c.line(2, 5, 8, 1, P.grey[6])
    c.rect(2, 7, 7, 1, P.grey[1])
    c.rect(2, 8, 2, 2, f === 1 ? P.red[4] : P.red[1])
    c.rect(7, 8, 2, 2, f === 2 ? P.red[4] : P.red[1])
    c.outline(K)
    if (f === 1) c.set(2, 8, P.red[5])
    if (f === 2) c.set(7, 8, P.red[5])
  },
}

KIND.flare = {
  w: 9, h: 16, frames: 4, ticks: 5,
  draw(c, f) {
    c.rect(4, 7, 1, 8, P.grey[3])
    c.rect(3, 14, 3, 1, P.grey[2])
    const h = [5, 6, 4, 6][f]
    const sway = [0, 1, 0, -1][f]
    c.rect(3 + sway, 7 - h, 3, h, P.orange[1])
    c.rect(4 + sway, 7 - h - 1, 1, 1, P.yellow[1])
    c.rect(4, 5 - (f % 2), 1, 2, P.yellow[2])
    c.outline(K)
  },
}

KIND.tanks = {
  w: 22, h: 14, frames: 1,
  draw(c) {
    for (const x of [1, 7, 13]) {
      c.rect(x, 3, 6, 9, P.wood[7])
      c.rect(x, 3, 1, 9, P.wood[8])
      c.rect(x + 4, 3, 2, 9, P.wood[6])
      c.rect(x, 2, 6, 1, P.wood[6])
    }
    c.line(1, 1, 19, 1, P.grey[3])
    c.rect(19, 1, 2, 11, P.grey[3])
    c.outline(K)
  },
}

KIND.signWash = {
  w: 44, h: 22, frames: 1,
  draw(c) {
    c.rect(9, 14, 1, 7, P.grey[4])
    c.rect(33, 14, 1, 7, P.grey[4])
    obox(c, 1, 1, 42, 14, P.green[1])
    c.box(2, 2, 40, 12, P.grey[6])
    c.text(5, 3, 'NEXT WASH', P.grey[6])
    c.text(14, 9, '2 MI', P.grey[6])
    c.outline(K)
  },
}
KIND.signSuds = {
  w: 30, h: 20, frames: 1,
  draw(c) {
    c.rect(7, 13, 1, 6, P.grey[4])
    c.rect(22, 13, 1, 6, P.grey[4])
    obox(c, 1, 1, 28, 13, P.green[1])
    c.text(7, 2, 'SUDS', P.grey[6])
    c.text(3, 8, 'POP 12', P.grey[6])
    c.outline(K)
  },
}
// Jackalope crossing: the yellow diamond.
KIND.signJack = {
  w: 15, h: 20, frames: 1,
  draw(c) {
    c.rect(7, 12, 1, 7, P.grey[4])
    c.poly([[7, 0], [14, 7], [7, 14], [0, 7]], K)
    c.poly([[7, 1], [13, 7], [7, 13], [1, 7]], P.yellow[1])
    c.poly([[7, 2], [12, 7]], P.yellow[2], { fill: false, close: false })
    const j = art(['K.K.', 'K.K.', '.KK.', 'KKKK', 'KKKK', 'K..K'])
    c.blit(j, 5, 4)
    c.set(4, 7, K)
    c.outline(K)
  },
}

/* Things that move about. */

KIND.cloud = {
  w: 44, h: 20, frames: 1,
  draw(c) {
    for (const [x, y, r] of [[9, 12, 6], [17, 8, 7], [27, 8, 8], [35, 12, 6]]) c.circle(x, y, r, P.grey[6])
    c.rect(4, 12, 36, 6, P.grey[6])
    c.rect(5, 16, 34, 2, P.ice[2])
    for (const [x, y] of [[36, 14], [33, 15], [12, 15]]) c.rect(x, y, 3, 1, P.ice[2])
    for (const [x, y] of [[12, 7], [15, 4], [16, 3], [23, 3], [26, 2]]) c.set(x, y, P.grey[6])
    c.outline(K)
  },
}
KIND.cloudS = {
  w: 30, h: 15, frames: 1,
  draw(c) {
    for (const [x, y, r] of [[8, 9, 5], [15, 6, 5], [22, 9, 5]]) c.circle(x, y, r, P.grey[6])
    c.rect(4, 9, 22, 4, P.grey[6])
    c.rect(5, 12, 20, 1, P.ice[2])
    c.outline(K)
  },
}

// The storm cell that lives over MW04. Frame 2 is lit by lightning.
// A thunderhead: towers of cloud with their tops in the sun, a flat dark belly, and the
// lightning lighting it from inside on frame 2. Frame 1 is the same cloud a little rolled over.
KIND.storm = {
  w: 80, h: 36, frames: 3,
  draw(c, f) {
    const flash = f === 2
    const roll = f === 1 ? 1 : 0
    // [x, y, r]: the towers back to front; the middle one is the tallest
    const towers = [[12, 22, 8], [24, 15, 10], [40, 14, 12], [56, 15, 10], [68, 21, 8], [32, 22, 9], [50, 22, 9]]
    const body = flash ? P.grey[4] : P.grey[2]
    const lit = flash ? P.grey[6] : P.grey[4]
    const top = flash ? P.grey[5] : P.grey[3]
    const belly = flash ? P.grey[3] : P.purple[1]
    // Each pixel is shaded by the frontmost tower it belongs to: lit toward the top left of
    // that tower's round, so every bump of the cloud has its own sunny cap.
    for (let py = 0; py < 31; py++) {
      for (let px = 0; px < 80; px++) {
        let col = py >= 22 && py < 30 && px >= 4 && px < 76 ? body : 0
        for (const [x0, y, r] of towers) {
          const x = x0 + (x0 % 2 ? roll : -roll)
          const dx = px - x
          const dy = py - y
          // (less a little, so no lone pixel pokes out of the top of a round)
          if (dx * dx + dy * dy > r * r - r * 0.7) continue
          const k = -(dx * 0.45 + dy * 0.9) / r
          col = k > 0.62 ? lit : k > 0.18 ? top : body
        }
        if (col) c.set(px, py, col)
      }
    }
    // the belly, ragged where the rain hangs from it
    c.rect(5, 27, 70, 4, belly)
    for (let x = 6; x < 74; x += 5) c.rect(x + ((x + roll) % 3), 31, 2, 1, belly)
    c.outline(K)
  },
}
KIND.bolt = {
  w: 12, h: 30, frames: 2,
  draw(c, f) {
    const pts = f ? [[6, 0], [3, 9], [7, 11], [2, 20], [5, 21], [3, 28]] : [[5, 0], [8, 8], [4, 11], [8, 19], [5, 21], [7, 28]]
    for (let i = 0; i < pts.length - 1; i++) c.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], P.grey[6], 2)
    c.outline(P.yellow[1])
  },
}

KIND.buzzard = {
  w: 11, h: 6, frames: 2, ticks: 18,
  draw(c, f) {
    if (f) {
      c.line(0, 1, 4, 3, P.grey[0])
      c.line(10, 1, 6, 3, P.grey[0])
    } else {
      c.line(0, 3, 4, 3, P.grey[0])
      c.line(10, 3, 6, 3, P.grey[0])
    }
    c.rect(4, 2, 3, 2, P.grey[0])
    c.set(5, 1, P.red[2])
  },
}

KIND.devil = {
  w: 15, h: 22, frames: 4, ticks: 4,
  draw(c, f) {
    for (let y = 1; y < 21; y++) {
      const half = 1 + Math.round((20 - y) * 0.3)
      const mid = 7 + Math.round(Math.sin(y / 3 + f * 0.6) * 1.5)
      for (let x = mid - half; x <= mid + half; x++) {
        const band = (x - mid + y + f * 2) % 4
        if (band === 0) c.set(x, y, P.wood[8])
        else if (band === 2) c.set(x, y, P.wood[6])
      }
    }
  },
}

KIND.weed = {
  w: 10, h: 10, frames: 4, ticks: 5,
  draw(c, f) {
    c.circle(4.5, 4.5, 3.5, P.mud[3], { fill: false })
    for (let k = 0; k < 3; k++) {
      const a = rad(f * 30 + k * 60)
      c.line(4.5 + Math.cos(a) * 3.4, 4.5 + Math.sin(a) * 3.4, 4.5 - Math.cos(a) * 3.4, 4.5 - Math.sin(a) * 3.4, k ? P.mud[4] : P.mud[3])
    }
    c.outline(K)
  },
}

KIND.dillo = {
  w: 13, h: 8, frames: 2, ticks: 8,
  draw(c, f) {
    c.ellipse(6, 3, 4, 2.5, P.mud[4])
    for (const x of [4, 6, 8]) c.rect(x, 1, 1, 4, P.mud[3])
    c.line(2, 4, 0, 5, P.mud[4])
    c.line(10, 4, 12, 5, P.mud[3])
    c.set(1, 3, P.mud[4])
    c.set(f ? 3 : 4, 6, P.mud[3])
    c.set(f ? 8 : 9, 6, P.mud[3])
    c.outline(K)
  },
}

KIND.roadrunner = {
  w: 14, h: 11, frames: 2, ticks: 3,
  draw(c, f) {
    c.ellipse(6, 5, 3, 2, P.mud[3])
    c.set(5, 4, P.grey[6])
    c.set(7, 5, P.grey[6])
    c.line(9, 4, 12, 1, P.mud[2])
    c.rect(2, 3, 2, 2, P.mud[3])
    c.set(1, 4, P.grey[2])
    c.set(0, 4, P.grey[2])
    c.set(3, 2, P.blue[2])
    c.set(2, 2, P.mud[2])
    if (f) {
      c.line(5, 7, 3, 9, P.blue[1])
      c.line(7, 7, 9, 9, P.blue[1])
    } else {
      c.line(6, 7, 5, 9, P.blue[1])
      c.line(6, 7, 7, 9, P.blue[1])
    }
    c.outline(K)
  },
}

// A long freight: locomotive and three kinds of car.
KIND.loco = {
  w: 28, h: 13, frames: 2, ticks: 6,
  draw(c, f) {
    obox(c, 1, 3, 26, 6, P.red[3])
    c.rect(2, 4, 24, 1, P.red[4])
    c.rect(2, 7, 24, 1, P.grey[5])
    obox(c, 19, 1, 8, 5, P.red[3])
    pane(c, 21, 2, 4, 3)
    c.rect(26, 5, 1, 2, P.yellow[2])
    for (const x of [4, 9, 17, 22]) {
      c.rect(x, 9, 3, 2, P.grey[1])
      c.set(x + (f ? 0 : 2), 10, P.grey[4])
    }
    c.outline(K)
  },
}
KIND.hopper = {
  w: 24, h: 12, frames: 2, ticks: 6,
  draw(c, f) {
    c.poly([[1, 2], [22, 2], [22, 7], [17, 9], [6, 9], [1, 7]], P.grey[4])
    c.rect(1, 2, 22, 1, P.grey[5])
    for (const x of [6, 11, 16]) c.rect(x, 3, 1, 5, P.grey[3])
    for (const x of [3, 17]) {
      c.rect(x, 9, 3, 2, P.grey[1])
      c.set(x + (f ? 0 : 2), 10, P.grey[4])
    }
    c.outline(K)
  },
}
KIND.tanker = {
  w: 24, h: 12, frames: 2, ticks: 6,
  draw(c, f) {
    c.ellipse(11.5, 5, 10.5, 3.5, P.grey[1])
    c.rect(3, 3, 18, 1, P.grey[2])
    c.rect(10, 1, 3, 2, P.grey[2])
    c.rect(2, 8, 20, 1, P.grey[0])
    for (const x of [3, 17]) {
      c.rect(x, 9, 3, 2, P.grey[0])
      c.set(x + (f ? 0 : 2), 10, P.grey[4])
    }
    c.outline(K)
  },
}
KIND.boxcar = {
  w: 24, h: 12, frames: 2, ticks: 6,
  draw(c, f) {
    obox(c, 1, 1, 22, 8, P.wood[1])
    c.rect(2, 2, 20, 1, P.wood[2])
    obox(c, 9, 2, 6, 7, P.wood[2])
    c.rect(10, 3, 1, 5, P.wood[1])
    c.text(3, 3, 'MW', P.grey[6])
    for (const x of [3, 17]) {
      c.rect(x, 9, 3, 2, P.grey[1])
      c.set(x + (f ? 0 : 2), 10, P.grey[4])
    }
    c.outline(K)
  },
}

/** A little washed car, side on, facing right. */
const CAR_COLOURS = {
  red: [P.red[2], P.red[3], P.red[4]],
  blue: [P.blue[1], P.blue[2], P.blue[3]],
  green: [P.green[1], P.green[2], P.green[3]],
  yellow: [P.yellow[0], P.yellow[1], P.yellow[2]],
  purple: [P.purple[1], P.purple[2], P.purple[3]],
  teal: [P.teal[0], P.teal[1], P.teal[2]],
  white: [P.grey[4], P.grey[5], P.grey[6]],
}
function miniCar(colour, f) {
  const [sh, b, hi] = CAR_COLOURS[colour]
  const c = new Canvas(15, 10)
  const y = f ? 1 : 0
  c.rect(1, 4 + y, 13, 3, b)
  c.rect(2, 4 + y, 11, 1, hi)
  c.rect(1, 6 + y, 13, 1, sh)
  c.rect(4, 2 + y, 6, 2, b)
  c.rect(5, 2 + y, 4, 2, P.blue[4])
  c.set(7, 2 + y, b)
  c.rect(3, 7, 2, 2, P.grey[1])
  c.rect(10, 7, 2, 2, P.grey[1])
  c.outline(K)
  c.set(13, 5 + y, P.yellow[2])
  c.set(1, 5 + y, P.red[4])
  c.set(6, 1 + y, P.grey[6])
  return c
}

/* Icons for the site badges. */

const ICON = {}
ICON.lock = art([
  '..KKKKK..',
  '.K44444K.',
  '.K4KKK4K.',
  '.K4K.K4K.',
  'KKKKKKKKK',
  'KYyyyyyyK',
  'KyyyKyyoK',
  'KyyyKyyoK',
  'KyyyyyyoK',
  'KoooooooK',
  'KKKKKKKKK',
])
function flagFrame(f) {
  const c = new Canvas(13, 16)
  c.rect(1, 1, 1, 14, P.grey[5])
  c.rect(1, 0, 1, 1, P.yellow[1])
  for (let i = 0; i < 9; i++) {
    const dy = Math.round(Math.sin((i - f * 2.2) / 2.2) * 1)
    c.rect(2 + i, 1 + dy, 1, 3, P.red[3])
    c.rect(2 + i, 4 + dy, 1, 3, P.blue[2])
    if (i > 2 && i < 7) c.set(2 + i, 4 + dy, P.grey[6])
  }
  c.outline(K)
  return c
}
function starFrame(f) {
  const c = new Canvas(15, 15)
  const pts = []
  for (let k = 0; k < 10; k++) {
    const a = rad(-90 + k * 36)
    const r = k % 2 ? 2.8 : 6.2
    pts.push([7 + Math.cos(a) * r, 7.5 + Math.sin(a) * r])
  }
  c.poly(pts.map(([x, y]) => [Math.round(x), Math.round(y)]), P.yellow[1])
  c.set(5, 5, P.yellow[2])
  c.set(6, 4, P.yellow[2])
  c.set(5, 6, P.yellow[2])
  c.rect(8, 9, 2, 1, P.yellow[0])
  c.set(10, 11, P.yellow[0])
  c.outline(K)
  if (f) {
    c.set(7, 3, P.grey[6])
    c.set(4, 6, P.grey[6])
  }
  return c
}
function tokenIcon(on) {
  const c = new Canvas(9, 9)
  c.circle(4, 4, 4, K)
  c.circle(4, 4, 3, on ? P.yellow[1] : P.grey[2])
  c.rect(2, 2, 2, 1, on ? P.yellow[2] : P.grey[3])
  c.set(2, 3, on ? P.yellow[2] : P.grey[3])
  c.rect(4, 3, 1, 3, on ? P.yellow[0] : P.grey[1])
  c.set(6, 6, on ? P.yellow[0] : P.grey[1])
  return c
}
ICON.token = tokenIcon(true)
ICON.tokenOff = tokenIcon(false)
ICON.pipOn = art(['.KKK.', 'KYyyK', 'KyyoK', 'KyooK', '.KKK.'])
ICON.pipOff = art(['.KKK.', 'K112K', 'K111K', 'K111K', '.KKK.'])
ICON.arrow = art([
  '..KKKKKKK..',
  '..KYYYYYK..',
  '..KyyyyyK..',
  '..KyyyyyK..',
  'KKKyyyyyKKK',
  'KYyyyyyyyoK',
  '.KyyyyyyoK.',
  '..KyyyyoK..',
  '...KyyoK...',
  '....KoK....',
  '.....K.....',
])
function sparkFrame(f) {
  const c = new Canvas(9, 9)
  const r = [1, 3, 4, 2][f]
  c.rect(4, 4 - r, 1, r * 2 + 1, f === 3 ? P.blue[4] : P.grey[6])
  c.rect(4 - r, 4, r * 2 + 1, 1, f === 3 ? P.blue[4] : P.grey[6])
  if (f === 2) for (const [x, y] of [[2, 2], [6, 2], [2, 6], [6, 6]]) c.set(x, y, P.blue[4])
  c.set(4, 4, P.yellow[2])
  return c
}
ICON.crown = art([
  'K...K...K.',
  'KY.KYK.KYK',
  'KyKyyyKyyK',
  'KyyySyyyyK',
  'KyyyyyyyoK',
  'KYYYYYYYYK',
  'KooooooooK',
  'KKKKKKKKKK',
])

/*
 * Rival Row's four, small, after the rivals slice's own art (rivals_a, rivals_b): Bucket Bill
 * in his sponge hat, Sir Streaks under his squeegee, Slick Ollie the oil can in a top hat and
 * bow tie, Nimbus Nick the cloud in shades. Drawn as they look once beaten: washed clean,
 * eyes shut and smiling. Until then the lot shows only their shapes, a shadow with a rim of
 * light and two eyes glowing where the '@'s are (frame 1 blinks).
 */
const RIVAL_ART = [
  [
    '....KKKKK....',
    '..KKYYYyyKK..',
    '.KYyyoyyyoyK.',
    '.KyyyyyoyyyK.',
    'KKKKKKKKKKKKK',
    'K66666666655K',
    '.K6@@555@@4K.',
    '.K555555544K.',
    'OK55K555K44KO',
    'OK555KKK544KO',
    '..K5555544K..',
    '..K5555544K..',
    '..KKKKKKKKK..',
    '...KG...GK...',
    '..KOOK.KOOK..',
    '..KKKK.KKKK..',
  ],
  [
    'KKKKKKKKKKK',
    'KYYYYYYYYoK',
    'K000000000K',
    'KKKKK1KKKKK',
    '....K1K....',
    '...KKKKK...',
    '..K56665K..',
    '..K5KKK4K..',
    '..KE@E@EK..',
    '..K5EEE4K..',
    '...KKKKK...',
    '..KTTTTTK..',
    '.K5TtCtT4K.',
    '.K5TTTTT4K.',
    '.KKKqqqKKK.',
    '...K5K4K...',
    '...K5K4K...',
    '..KK5K4KK..',
    '..KKKKKKK..',
  ],
  [
    '...KKKKK......',
    '...K101K......',
    '...K101K......',
    '...KXXXK......',
    '.KKKKKKKKK....',
    '..KFEEEdK.....',
    '..KE@E@dK.....',
    '..KEEEJJOKK...',
    '..KEEEEdKJOOK.',
    '..KEXKXdK.KKK.',
    '..KEEEEdK.....',
    '..KeEEddK.....',
    '..KTTTTTK.....',
    '...KK.KK......',
    '..KKK.KKK.....',
  ],
  [
    '......KKKK........',
    '...KKK6666KKK.....',
    '..K66666666665K...',
    '.K66665666666655K.',
    'K6KKKKK6KKKKK6555K',
    'K6K0@0KKK0@0K5555K',
    'K66K00K6K00K65555K',
    'K666KK666KK665554K',
    'K6666666KKK65554K.',
    '.K444444444444KK..',
    '..KKKKKKKKKKKK....',
  ],
]
/** Nimbus Nick floats: his feet are this far over the lot. */
const RIVAL_FLOAT = [0, 0, 0, 7]

function rivalBeaten(i) {
  return Canvas.fromText(RIVAL_ART[i], { ...LG, '@': K })
}
function rivalShadow(i, blink) {
  const EYE = '#00ff00'
  const c = Canvas.fromText(RIVAL_ART[i], { ...LG, '@': EYE })
  const solid = (x, y) => x >= 0 && y >= 0 && x < c.w && y < c.h && c.solid(x, y)
  const out = new Canvas(c.w, c.h)
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (!solid(x, y)) continue
      const v = c.get(x, y)
      const edge = !solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)
      if (v === rgba(EYE)) out.set(x, y, blink ? P.purple[1] : P.yellow[2])
      else if (edge && v === rgba(K)) out.set(x, y, K)
      else if (!solid(x - 1, y - 1) || !solid(x, y - 2)) out.set(x, y, P.purple[3])
      else out.set(x, y, P.purple[1])
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 6c. Where everything stands                                         */
/* ------------------------------------------------------------------ */

// [kind, x, y (bottom-centre), { flip, phase }]. Checked below: nothing may stand on a road or a site.
const PROPS = [
  // the wind farm along the caprock, and three more out on the plains
  ['turbine', 152, 32], ['turbine', 190, 29, { phase: 9 }], ['turbine', 228, 30, { phase: 3 }], ['turbine', 266, 28, { phase: 14 }], ['turbine', 304, 31, { phase: 6 }], ['turbine', 342, 34, { phase: 11 }],
  ['turbine', 352, 98, { phase: 5 }], ['turbine', 378, 128, { phase: 12 }], ['turbine', 344, 140, { phase: 1 }],
  // the oil patch: west of MW05 and down by the river
  ['pumpjack', 16, 162], ['pumpjack', 64, 80, { phase: 20, flip: true }], ['flare', 40, 76, { phase: 2 }], ['tanks', 88, 190],
  ['pumpjack', 428, 208, { phase: 30 }], ['pumpjack', 452, 194, { phase: 12, flip: true }], ['flare', 420, 186, { phase: 7 }],
  // Suds, Texas
  ['elevator', 84, 194], ['cafe', 112, 195], ['feed', 138, 195], ['bbq', 164, 196], ['church', 190, 196],
  ['house1', 104, 214], ['house2', 124, 213], ['house3', 146, 214], ['house1', 168, 213, { flip: true }],
  ['watertower', 212, 210], ['stadium', 36, 208], ['signSuds', 236, 210],
  // ranch country (the windmill stands low, clear of the HQ sign)
  ['windmill', 22, 319], ['cowH', 72, 314, { phase: 0 }], ['cowA', 104, 318, { phase: 160, flip: true }], ['cowL', 84, 240, { phase: 300 }], ['cowH', 200, 318, { phase: 90, flip: true }], ['cowA', 330, 296, { phase: 40 }],
  ['signWash', 194, 278], ['signJack', 280, 300],
  // brush
  ['mesquite', 132, 128], ['mesquiteS', 116, 108], ['mesquite', 378, 196], ['mesquiteS', 270, 316], ['mesquite', 210, 72, { flip: true }],
  ['mesquite', 326, 76], ['mesquite', 248, 316, { flip: true }], ['mesquiteS', 420, 300], ['mesquite', 506, 312],
  ['mesquiteS', 376, 76], ['mesquite', 128, 32, { flip: true }],
  ['cactus', 168, 110], ['cactusF', 182, 122], ['cactus', 290, 130], ['cactus', 416, 98], ['cactusF', 428, 224], ['cactus', 508, 262],
  ['cactus', 310, 312], ['cactusF', 62, 182], ['cactus', 10, 108], ['cactus', 366, 160], ['yucca', 300, 318], ['yucca', 394, 300], ['yucca', 494, 160],
  // winter: bare trees
  ['bare', 596, 30], ['bare', 626, 50, { flip: true }], ['bare', 446, 22], ['bare', 628, 104],
  // the city round the Mega Tunnel
  ['office2', 622, 276], ['office', 600, 286, { flip: true }], ['house2', 528, 306], ['office', 556, 314], ['house1', 584, 310], ['office2', 614, 316],
]

KIND.bare = {
  w: 19, h: 17, frames: 1,
  draw(c) {
    c.line(9, 16, 9, 9, P.mud[1])
    c.line(9, 10, 4, 5, P.mud[1])
    c.line(9, 9, 14, 4, P.mud[1])
    c.line(9, 9, 9, 3, P.mud[2])
    c.line(5, 6, 3, 2, P.mud[2])
    c.line(13, 5, 16, 3, P.mud[2])
    for (const [x, y] of [[3, 2], [9, 3], [16, 3], [4, 5], [14, 4]]) c.set(x, y - 1, P.grey[6])
    c.outline(K)
  },
}
// A city block: lit windows at night.
function office(w, h, wall, hi) {
  return {
    w, h, frames: 1,
    draw(c) {
      obox(c, 1, 2, w - 2, h - 3, wall)
      c.rect(2, 3, 1, h - 5, hi)
      c.rect(1, 1, w - 2, 2, K)
      for (let y = 5; y < h - 4; y += 4) for (let x = 4; x < w - 3; x += 4) c.rect(x, y, 2, 2, P.grey[1])
      obox(c, Math.floor(w / 2) - 2, h - 5, 4, 4, P.grey[1])
      c.outline(K)
    },
    glow(c) {
      let n = 0
      for (let y = 5; y < h - 4; y += 4) for (let x = 4; x < w - 3; x += 4) if ((n++ * 7 + w) % 5 > 1) c.rect(x, y, 2, 2, n % 4 ? P.yellow[2] : P.yellow[1])
    },
  }
}
KIND.office = office(16, 26, P.grey[3], P.grey[4])
KIND.office2 = office(20, 20, P.blue[1], P.blue[2])

KIND.cowH = { cow: 'hereford' }
KIND.cowA = { cow: 'angus' }
KIND.cowL = { cow: 'longhorn' }

/* ------------------------------------------------------------------ */
/* 2b. More ground: the stock tank, the cotton, caliche pads, Suds's  */
/* streets, dunes, a fence. Painted before light, like the rest.       */
/* ------------------------------------------------------------------ */

const clearOfRoads = (x, y, gap) => roadDist(x, y) > ROAD_HALF + gap

// The stock tank by the windmill.
feat.ellipse(44, 309, 9, 4, P.grey[3])
feat.ellipse(44, 309, 8, 3, P.blue[2])
feat.rect(39, 307, 5, 1, P.blue[3])
feat.ellipse(44, 309, 9, 4, K, { fill: false })

// A cotton field: rows of white bolls on brown.
for (let y = 60; y <= 84; y += 3) {
  for (let x = 6; x <= 46; x++) {
    if (!clearOfRoads(x, y, 3)) continue
    feat.set(x, y, P.mud[2])
    if ((x * 7 + y * 3) % 5 === 0) feat.set(x, y - 1, P.grey[6])
  }
}

// Caliche pads under the pumpjacks and tanks: pale ground scraped flat.
for (const [kind, x, y] of PROPS) {
  if (kind !== 'pumpjack' && kind !== 'tanks' && kind !== 'flare') continue
  const w = kind === 'flare' ? 8 : KIND[kind].w + 4
  const top = y - 6
  for (let yy = top; yy < y + 3; yy++) {
    for (let xx = x - w / 2; xx < x + w / 2; xx++) {
      if (!clearOfRoads(Math.round(xx), yy, 1)) continue
      const edge = yy === top || yy === y + 2 || xx < x - w / 2 + 1 || xx >= x + w / 2 - 1
      feat.set(Math.round(xx), yy, edge ? P.wood[5] : P.wood[7])
    }
  }
}

// Suds's main street and its cross street, caliche.
for (let x = 70; x <= 206; x++) for (let y = 197; y <= 199; y++) feat.set(x, y, y === 198 ? P.wood[7] : P.wood[6])
for (let y = 199; y <= 216; y++) for (let x = 134; x <= 136; x++) feat.set(x, y, x === 135 ? P.wood[7] : P.wood[6])

// The Monahans-ish sandhills: dune crests.
for (const [cx, cy, r] of [[300, 294, 9], [326, 306, 11], [354, 296, 8], [282, 310, 7], [344, 316, 7]]) {
  for (let a = -70; a <= 70; a += 3) {
    const x = Math.round(cx + Math.sin(rad(a)) * r)
    const y = Math.round(cy - Math.cos(rad(a)) * r * 0.45)
    if (clearOfRoads(x, y, 2)) {
      feat.set(x, y, P.wood[8])
      feat.set(x, y + 1, P.wood[5])
    }
  }
}

// Barbed wire round the home pasture: posts and a line.
for (let x = 2; x < 120; x++) {
  const y = 292 + Math.round(Math.sin(x / 19) * 2)
  if (!clearOfRoads(x, y, 2)) continue
  feat.set(x, y, P.mud[2])
  if (x % 7 === 0) feat.set(x, y - 1, P.mud[1])
}

/* ------------------------------------------------------------------ */
/* 4. Light, and the finished ground                                   */
/* ------------------------------------------------------------------ */

const groundLit = ground.clone()
groundLit.blit(feat.clone().map((c, x, y) => tint(c, zone[y * W + x])))

// The same ground under a cloud: every colour one step down its ramp.
const DARKER = new Map()
for (const ramp of Object.values(P)) {
  if (!Array.isArray(ramp)) continue
  ramp.forEach((c, i) => DARKER.set(rgba(c), rgba(i > 0 ? ramp[i - 1] : c)))
}
DARKER.set(rgba(P.navy), rgba(P.purple[0]))
DARKER.set(rgba(K), rgba(K))
const shade = groundLit.clone().map((c) => DARKER.get(c) ?? c)

/* ------------------------------------------------------------------ */
/* 5. The roads, each on its own frame                                 */
/* ------------------------------------------------------------------ */

const ROAD_PAD = 7
const roadFrames = ROADS.map((r, i) => {
  const c = new Canvas(W, H)
  if (r.secret) paintDirtRoad(c, i)
  else paintHighway(c, i)
  c.map((v, x, y) => tint(v, zone[y * W + x]))
  const b = c.bounds()
  const x0 = Math.max(0, b.x - ROAD_PAD)
  const y0 = Math.max(0, b.y - ROAD_PAD)
  const x1 = Math.min(W, b.x + b.w + ROAD_PAD)
  const y1 = Math.min(H, b.y + b.h + ROAD_PAD)
  return { canvas: c.crop(x0, y0, x1 - x0, y1 - y0), box: [x0, y0, x1 - x0, y1 - y0] }
})

/* Where roads cross the railroad. */
const CROSSINGS = []
ROADS.forEach((r) => {
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1]
    const b = r.pts[i]
    const da = a.y - trackY(a.x)
    const db = b.y - trackY(b.x)
    if (da === 0 || Math.sign(da) !== Math.sign(db)) {
      CROSSINGS.push({ road: r.id, x: Math.round(b.x), y: Math.round(trackY(b.x)) })
      break
    }
  }
})
for (const x of CROSSINGS) PROPS.push(['xing', x.x - 9, x.y - 3, { crossing: true }])

/* ------------------------------------------------------------------ */
/* 6d. Lit variants and the checks                                     */
/* ------------------------------------------------------------------ */

// Things are seen in four lights; the dusk and twilight sides share the night table's look for sprites.
const LOOK = { day: 'day', gold: 'day', dusk: 'dusk', twi: 'night', night: 'night', storm: 'storm' }
const SUFFIX = { day: '', dusk: '_dusk', night: '_night', storm: '_storm' }
const lookAt = (x, y) => LOOK[zoneAt(x, y)]
const litAs = (canvas, look) => (look === 'day' ? canvas : lit(canvas, look === 'night' ? 'night' : look))

const problems = []
const siteBox = (id) => {
  const s = SITES[id]
  const b = BUILD[id]
  return [s.x - Math.floor(b.w / 2), s.y - b.h, b.w, b.h]
}
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

function kindSize(kind) {
  if (KIND[kind]?.cow) return { w: 21, h: 14 }
  return KIND[kind]
}
for (const [kind, x, y, o] of PROPS) {
  const k = kindSize(kind)
  if (!k) {
    problems.push(`prop ${kind} has no art`)
    continue
  }
  const box = [x - Math.floor(k.w / 2) + 1, y - k.h + 1, k.w - 2, k.h - 2]
  if (box[0] < 0 || box[0] + box[2] > W || box[1] + box[3] > H) problems.push(`${kind} at ${x},${y} is off the map`)
  for (const id of Object.keys(SITES)) if (overlaps(box, siteBox(id))) problems.push(`${kind} at ${x},${y} stands on ${id}`)
  if (o?.crossing) continue
  for (let yy = box[1]; yy < box[1] + box[3]; yy++) {
    for (let xx = box[0]; xx < box[0] + box[2]; xx++) {
      if (roadDist(xx, yy) <= ROAD_HALF + 1) {
        problems.push(`${kind} at ${x},${y} stands on a road (${xx},${yy})`)
        yy = 1e9
        break
      }
    }
  }
}
for (const id of Object.keys(SITES)) for (const id2 of Object.keys(SITES)) if (id < id2 && overlaps(siteBox(id), siteBox(id2))) problems.push(`${id} overlaps ${id2}`)

/* ------------------------------------------------------------------ */
/* 7. Packing                                                          */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('map', { script: 'art-map.mjs' })
const TIMING = {}
const round2 = (v) => Math.round(v)

atlas.add('ground', groundLit)
atlas.add('shade', shade)
roadFrames.forEach((f, i) => atlas.add(`road_${ROADS[i].id}`, f.canvas))

// Sites: lit frames, and the dim locked one.
const SITE_META = {}
// Each site's sign plate (with its lock, flag, star and token pips round it) goes near the node,
// below it if it can: never on a road, a building or another plate, and over as few props as may be.
const LABELS = {}
{
  const TRY = []
  for (const r of [22, 26, 30, 36, 42, 50, 58]) for (let a = 0; a < 360; a += 15) TRY.push([Math.round(Math.sin(rad(a)) * r * 1.3), Math.round(Math.cos(rad(a)) * r)])
  const propBoxes = PROPS.map(([kind, x, y]) => {
    const k = kindSize(kind)
    return [x - Math.floor(k.w / 2), y - k.h, k.w, k.h]
  })
  // Spots picked by eye, taken when they are free of roads, buildings and other signs.
  const PREFER = { hq: [28, 278], mw03: [370, 208], mw05: [58, 146], mw06: [490, 28], mw08: [541, 266] }
  const placed = []
  for (const id of Object.keys(BUILD)) {
    const n = NODES[id]
    let best = null
    let bestCost = Infinity
    const tries = PREFER[id] ? [[PREFER[id][0] - n.x, PREFER[id][1] - n.y, true], ...TRY] : TRY
    for (const [dx, dy, pick] of tries) {
      const x = n.x + dx
      const y = n.y + dy
      const box = [x - 28, y - 8, 59, 22]
      if (box[0] < 0 || box[0] + box[2] > W || box[1] < 0 || box[1] + box[3] > H - 2) continue
      if (Object.keys(SITES).some((s) => overlaps(box, siteBox(s)))) continue
      if (placed.some((p) => overlaps(box, p))) continue
      let onRoad = false
      for (let yy = box[1]; yy < box[1] + box[3] && !onRoad; yy++) for (let xx = box[0] + 4; xx < box[0] + box[2] - 4; xx++) if (roadDist(xx, yy) <= ROAD_HALF + 1) onRoad = true
      if (onRoad) continue
      const cost = pick ? -1 : propBoxes.filter((b) => overlaps(box, b)).length * 10 + Math.hypot(dx, dy) / 4 + (dy < 0 ? 3 : 0)
      if (cost < bestCost) {
        bestCost = cost
        best = [x, y, box]
      }
    }
    if (!best) {
      problems.push(`no room for the ${id} sign`)
      continue
    }
    LABELS[id] = [best[0], best[1]]
    placed.push(best[2])
    if (bestCost >= 10) console.log(`art-map: the ${id} sign covers ${Math.floor(bestCost / 10)} prop(s)`)
  }
}
for (const id of Object.keys(BUILD)) {
  const s = buildSite(id)
  const b = BUILD[id]
  const ax = Math.floor(b.w / 2)
  atlas.addAnim(`site_${id}`, s.open.map((c) => ({ canvas: c, ax, ay: b.h })))
  atlas.add(`site_${id}_off`, s.off, { ax, ay: b.h })
  TIMING[`site_${id}`] = s.open.map(() => b.ticks ?? 20)
  SITE_META[id] = { at: [SITES[id].x, SITES[id].y], node: [NODES[id].x, NODES[id].y], label: LABELS[id], look: LOOK[s.zone] }
}

/** All frames of one kind as seen in one light. Returns the anim name. */
const made = new Set()
function addKind(kind, look) {
  const name = kind + SUFFIX[look]
  if (made.has(name)) return name
  made.add(name)
  const k = KIND[kind]
  if (k.cow) {
    const frames = COW_POSES.map((pose) => litAs(cow(k.cow, pose), look))
    frames.forEach((c, i) => atlas.add(`${name}${i}`, c, { ax: 10, ay: 13 }))
    atlas.anim(name, COW_SEQ.map(([f]) => `${name}${f}`))
    TIMING[name] = COW_SEQ.map(([, t]) => t)
    return name
  }
  const n = k.frames ?? 1
  const frames = []
  for (let f = 0; f < n; f++) {
    const day = new Canvas(k.w, k.h)
    k.draw(day, f)
    const c = litAs(day, look).clone()
    if (k.glow && look !== 'day' && look !== 'storm') k.glow(c, f)
    frames.push({ canvas: c, ax: Math.floor(k.w / 2), ay: k.h - 1 })
  }
  atlas.addAnim(name, frames)
  TIMING[name] = frames.map(() => k.ticks ?? 30)
  return name
}

const PROP_META = []
for (const [kind, x, y, o] of PROPS) {
  const look = lookAt(x, y - 2)
  const anim = addKind(kind, look)
  PROP_META.push([anim, x, y, o?.phase ?? 0, o?.flip ? 1 : 0])
}

// Movers, in every light they pass through.
const LOOKS = ['day', 'dusk', 'night', 'storm']
const CARS = Object.keys(CAR_COLOURS)
for (const look of LOOKS) {
  for (const colour of CARS) {
    atlas.addAnim(`car_${colour}${SUFFIX[look]}`, [0, 1].map((f) => ({ canvas: litAs(miniCar(colour, f), look), ax: 7, ay: 9 })))
    TIMING[`car_${colour}${SUFFIX[look]}`] = [6, 6]
  }
  for (const kind of ['loco', 'hopper', 'tanker', 'boxcar']) addKind(kind, look)
}
for (const kind of ['cloud', 'cloudS', 'storm', 'bolt', 'buzzard', 'devil', 'weed', 'dillo', 'roadrunner']) addKind(kind, 'day')
addKind('dillo', 'dusk')
addKind('roadrunner', 'dusk')

// Badges and their bits.
atlas.add('lock', ICON.lock, { ax: 4, ay: 10 })
atlas.addAnim('flag', [0, 1, 2].map((f) => ({ canvas: flagFrame(f), ax: 1, ay: 15 })))
TIMING.flag = [8, 8, 8]
atlas.addAnim('star', [0, 1].map((f) => ({ canvas: starFrame(f), ax: 7, ay: 7 })))
TIMING.star = [50, 8]
atlas.add('pipOn', ICON.pipOn, { ax: 2, ay: 2 })
atlas.add('pipOff', ICON.pipOff, { ax: 2, ay: 2 })
atlas.add('token', ICON.token, { ax: 4, ay: 4 })
atlas.add('tokenOff', ICON.tokenOff, { ax: 4, ay: 4 })
atlas.add('arrow', ICON.arrow, { ax: 5, ay: 10 })
atlas.addAnim('spark', [0, 1, 2, 3].map((f) => ({ canvas: sparkFrame(f), ax: 4, ay: 4 })))
TIMING.spark = [4, 4, 4, 4]
atlas.add('crown', ICON.crown, { ax: 5, ay: 7 })
for (let i = 0; i < 4; i++) {
  const ax = Math.floor(RIVAL_ART[i][0].length / 2)
  const ay = RIVAL_ART[i].length - 1 + RIVAL_FLOAT[i]
  atlas.addAnim(`rival${i}`, [false, true].map((blink) => ({ canvas: rivalShadow(i, blink), ax, ay })))
  TIMING[`rival${i}`] = [110 + i * 17, 7]
  atlas.add(`rival${i}_down`, rivalBeaten(i), { ax, ay })
}

// Cloud shapes as spans, so the scene can lay their shadows on the ground (from 'shade').
function spans(kind) {
  const k = KIND[kind]
  const c = new Canvas(k.w, k.h)
  k.draw(c, 0)
  const out = []
  for (let y = 0; y < c.h; y++) {
    let x = 0
    while (x < c.w) {
      while (x < c.w && !c.solid(x, y)) x++
      const x0 = x
      while (x < c.w && c.solid(x, y)) x++
      if (x > x0) out.push(y - (k.h - 1), x0 - Math.floor(k.w / 2), x - x0)
    }
  }
  return out
}

const flat = (pts, step) => {
  const out = []
  for (let i = 0; i < pts.length; i += step) out.push(round2(pts[i].x), round2(pts[i].y))
  const last = pts[pts.length - 1]
  if ((pts.length - 1) % step) out.push(round2(last.x), round2(last.y))
  return out
}

atlas.meta({
  map: { w: W, h: H },
  order: ['hq', ...Object.keys(BUILD).filter((id) => /^mw0\d$/.test(id))],
  nodes: Object.fromEntries(Object.entries(NODES).map(([id, n]) => [id, [n.x, n.y]])),
  roads: ROADS.map((r, i) => ({ id: r.id, a: r.a, b: r.b, secret: r.secret, box: roadFrames[i].box, pts: flat(r.pts, 2) })),
  sites: SITE_META,
  props: PROP_META,
  timing: TIMING,
  cars: CARS,
  river: flat(RIVER, 4),
  track: flat(TRACK, 4),
  crossings: CROSSINGS.map((c) => [c.x, c.y]),
  zones: { k: 0.42, dusk: 548, night: 612, storm: [SITES.mw04.x, SITES.mw04.y - 8, 66, 44] },
  shadows: { cloud: spans('cloud'), cloudS: spans('cloudS'), storm: spans('storm') },
  snow: [590, 30, 112, 96],
  // On the lot, in front of its fence, two either side of where Maxx stands: feet from the site's anchor.
  rivalSpots: [[-32, -4], [-20, -6], [20, -6], [33, -4]],
})

if (problems.length) {
  for (const p of problems) console.log('art-map: ' + p)
  if (!process.argv.includes('--force')) {
    console.log('art-map: fix the layout (or pass --force to write anyway)')
    process.exit(1)
  }
}

for (const [name, f] of atlas.frames) {
  const bad = checkPalette(f.canvas)
  if (bad.length) throw new Error(`art-map: ${name} has colours outside the palette: ${JSON.stringify(bad.slice(0, 4))}`)
}

const written = atlas.write()
console.log(`art-map: ${atlas.frames.size} frames, sheet ${written.sheet.w}x${written.sheet.h}, ${(fs.statSync(written.png).size / 1024).toFixed(1)} kB`)

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const fr = (name) => {
    const f = atlas.frames.get(name)
    return { canvas: f.canvas, ax: f.ax, ay: f.ay, label: name }
  }
  const animRow = (name) => ({ label: name, frames: [...new Set(atlas.anims[name])].map(fr) })

  // The map as the scene shows it: every road open, every site lit, every prop on its first frame.
  const posed = (allOpen, t = 0) => {
    const c = groundLit.clone()
    ROADS.forEach((r, i) => {
      if (allOpen || !r.secret) c.blit(roadFrames[i].canvas, roadFrames[i].box[0], roadFrames[i].box[1])
    })
    const items = []
    for (const [anim, x, y, ph, flip] of PROP_META) items.push({ name: atlas.anims[anim][Math.floor((t + ph) / 7) % atlas.anims[anim].length], x, y, flip })
    for (const id of Object.keys(BUILD)) items.push({ name: atlas.anims[`site_${id}`][0], x: SITES[id].x, y: SITES[id].y })
    items.sort((a, b) => a.y - b.y)
    for (const it of items) {
      const f = atlas.frames.get(it.name)
      c.blit(it.flip ? f.canvas.flipX() : f.canvas, it.x - (it.flip ? f.canvas.w - f.ax : f.ax), it.y - f.ay)
    }
    return c
  }
  const p = posed(true)
  p.save(path.join(REVIEW, 'posed_1x.png'))
  p.scale(2).save(path.join(REVIEW, 'posed_2x.png'))
  groundLit.save(path.join(REVIEW, 'ground_1x.png'))
  shade.scale(2).save(path.join(REVIEW, 'shade_2x.png'))
  for (const [name, x, y, w, h] of [['nw', 0, 0, 220, 130], ['ne', 420, 0, 220, 130], ['sw', 0, 170, 220, 150], ['mid', 200, 150, 220, 170], ['se', 420, 170, 220, 150], ['top', 200, 0, 220, 150]]) {
    p.crop(x, y, w, h).scale(4).save(path.join(REVIEW, `tour_${name}_4x.png`))
  }

  const siteRows = Object.keys(BUILD).map((id) => ({ label: id, frames: [...atlas.anims[`site_${id}`].map(fr), fr(`site_${id}_off`)] }))
  contactSheet(siteRows, { bg: '#c89844', scale: 3, file: path.join(REVIEW, 'sheet_sites_3x.png') })
  const kinds = Object.keys(atlas.anims).filter((n) => !n.startsWith('site_') && !n.startsWith('car_') && !n.includes('_'))
  contactSheet(kinds.map(animRow), { bg: '#f5c56e', scale: 4, wrap: 8, file: path.join(REVIEW, 'sheet_props_4x.png') })
  contactSheet(kinds.map(animRow), { bg: '#f5c56e', scale: 1, wrap: 8, labels: false, file: path.join(REVIEW, 'sheet_props_1x.png') })
  contactSheet(siteRows, { bg: '#49b23c', scale: 1, labels: false, file: path.join(REVIEW, 'sheet_sites_1x.png') })
  contactSheet(kinds.map(animRow), { bg: '#2e1f5e', scale: 4, wrap: 8, flipX: true, file: path.join(REVIEW, 'sheet_props_flip_night_4x.png') })
  const lit4 = Object.keys(atlas.anims).filter((n) => /_(dusk|night|storm)$/.test(n) && !n.startsWith('car_'))
  contactSheet(lit4.map(animRow), { bg: '#5b3fa0', scale: 3, wrap: 8, file: path.join(REVIEW, 'sheet_lit_3x.png') })
  contactSheet(Object.keys(atlas.anims).filter((n) => n.startsWith('car_')).map(animRow), { bg: '#4b4f5c', scale: 4, wrap: 8, file: path.join(REVIEW, 'sheet_cars_4x.png') })
  const icons = ['lock', 'pipOn', 'pipOff', 'arrow', 'crown', 'rival0_down', 'rival1_down', 'rival2_down', 'rival3_down'].map(fr)
  contactSheet([{ label: 'icons', frames: icons }, animRow('flag'), animRow('star'), animRow('spark'), animRow('rival0'), animRow('rival1'), animRow('rival2'), animRow('rival3')], { bg: '#6b4522', scale: 5, file: path.join(REVIEW, 'sheet_icons_5x.png') })
  console.log(`art-map: review pictures in ${REVIEW}`)
}

