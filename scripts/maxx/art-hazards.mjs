// art-hazards.mjs: generates the 'hazards' atlas: drip, icicle, wash brush, hot wax jet,
// dryer blower (kinds of game/sim/entities/hazards.ts, drawn by game/render/entities/hazards.ts).
//
//   node scripts/maxx/art-hazards.mjs                  writes hazards.png + hazards.atlas.ts
//   node scripts/maxx/art-hazards.mjs --review <dir>   also writes contact sheets into <dir>:
//       sheet_<kind>_<bg>.png, every animation as a strip at 4x on five backgrounds (sky,
//       tunnel, night, snow, concrete), sheet_<kind>_tunnel_flip.png mirrored,
//       sheet_all_1x.png everything at 1x, and scenes_<bg>_*.png, each hazard put together
//       the way the renderer does it, beside Maxx, at 1x and 3x
//
// Everything is drawn here, by rule or pixel by pixel; there is no source image. The wax
// column is stacked by the renderer, so it is checked at the end to tile; the brush is stacked
// from tiers, which are checked to cover its whole hit box.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, rgba } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const O = PAL.outline
const [G0, G1, G2, G3, G4, G5, G6] = PAL.grey
const [, R1, , R3, R4] = PAL.red
const [B0, B1, B2, B3] = PAL.blue
const [I0, I1, I2] = PAL.ice
const [, , M2, M3, M4] = PAL.mud
const W6 = PAL.wood[6]
const [, P1, P2, P3] = PAL.purple
const [OR0, OR1, OR2] = PAL.orange
const [Y0, Y1, Y2] = PAL.yellow

const atlas = new Atlas('hazards', { script: 'art-hazards.mjs' })
/** name -> [{ label, canvas, ax, ay }], kept for the review sheets. */
const shown = {}
function addAnim(name, canvases, ax, ay) {
  const frames = canvases.map((canvas, i) => ({ label: `${name}${i}`, canvas, ax, ay }))
  atlas.addAnim(name, canvases, { ax, ay })
  shown[name] = frames
  return frames
}
function addOne(name, canvas, ax, ay) {
  atlas.add(name, canvas, { ax, ay })
  shown[name] = [{ label: name, canvas, ax, ay }]
  return canvas
}
const mod = (a, n) => ((a % n) + n) % n
/** Hand-pixelled art. Every row must be the same length: a short row is a typo, not a margin. */
function text(rows, legend) {
  for (const row of rows) if (row.length !== rows[0].length) throw new Error(`art row "${row}" is ${row.length} wide, the first row is ${rows[0].length}`)
  return Canvas.fromText(rows, legend)
}

/* ------------------------------------------------------------------ */
/* drip: a leaking pipe stub under the ceiling, and its drop           */
/* ------------------------------------------------------------------ */

// A plate bolted to the ceiling line (its top row), a pipe with a rusted-through coupling, and
// the open end. The drop grows from its mouth, 8 px down.
const LEAK = text(
  [
    '.OOOOOOOOOOOOOOOOOOOOOO.',
    'O5b444444444444443333b2O',
    'OOOOOOOOOOOOOOOOOOOOOOOO',
    '......O5544433322O......',
    '.....OaaAAaaaaaaaaO.....',
    '......O5544r33322O......',
    '.....OO544rr33322OO.....',
    '.....OOOOOOOOOOOOOO.....',
  ],
  { O, 5: G5, 4: G4, 3: G3, 2: G2, b: G1, r: OR0, a: OR0, A: OR2 },
)
const LEAK_MOUTH = 8

// Grimy water is a dirty tan, oil a dark purple sheen; both light enough to show on a dark
// tunnel wall, and both keep a white glint.
const DROP_LOOK = {
  water: { O, h: W6, m: M4, d: M3, w: G6 },
  oil: { O, h: P3, m: P2, d: P1, w: G6 },
}

// The tell: four sizes of the drop hanging at the mouth (top row = the mouth).
const SWELL = [
  ['...OOOO...', '..OhmmdO..', '...OOOO...'],
  ['..OOOOOO..', '.OhhmmmdO.', '.OhmmmmdO.', '.OmmmmddO.', '..OOOOOO..'],
  ['...OOOO...', '..OhmmdO..', '.OhhmmmdO.', '.OhwhmmdO.', '.OhhmmmdO.', '.OhmmmddO.', '.OmmmdddO.', '..OOOOOO..'],
  ['...OOOO...', '...OhmO...', '..OhhmdO..', '.OhhmmmdO.', '.OhwwmmdO.', 'OhhwhmmmdO', 'OhhhmmmmdO', 'OhhmmmmddO', 'OhmmmmdddO', '.OmmmdddO.', '..OOOOOO..'],
]
// In its 10 x 14 box: a teardrop as it lets go, then stretched by its speed.
const DROP = [
  ['....OO....', '....OO....', '...OhmO...', '...OhmO...', '..OhhmdO..', '..OhmmdO..', '.OhhmmmdO.', '.OhwwmmdO.', 'OhhwhmmmdO', 'OhhhmmmmdO', 'OhhmmmmddO', 'OhmmmmdddO', '.OmmmdddO.', '..OOOOOO..'],
  ['....OO....', '....OO....', '....OO....', '...OhmO...', '...OhmO...', '..OhhmdO..', '..OhmmdO..', '..OhwmdO..', '.OhhwmmdO.', '.OhhmmmdO.', '.OhmmmddO.', '.OhmmmddO.', '.OmmmdddO.', '..OOOOOO..'],
]
// On the surface it landed on (bottom row = that surface): flattens, crowns, scatters.
const SPLASH = [
  [
    '............................',
    '............................',
    '............................',
    '............................',
    '............................',
    '............................',
    '............................',
    '.........OOOOOOOOOO.........',
    '.......OOhhhmmmmmddOO.......',
    '......OhhhmmmmmmmmmddO......',
    '.....OhhmmmmmmmmmmmmddO.....',
    '.....OOOOOOOOOOOOOOOOOO.....',
  ],
  [
    '............................',
    '............................',
    '...OO..................OO...',
    '..OhmO................OmdO..',
    '..OhmO....O......O....OmdO..',
    '...OO....OhO....OmO....OO...',
    '........OhmO....OmdO........',
    '.........OO......OO.........',
    '.....OO....OOOOOO....OO.....',
    '....OhmOOOOhmmmmdOOOOmdO....',
    '....OhhmmmmmmmmmmmmmmddO....',
    '.....OOOOOOOOOOOOOOOOOO.....',
  ],
  [
    '.OO......................OO.',
    'OhmO....................OmdO',
    '.OO......................OO.',
    '............................',
    '.....OO..............OO.....',
    '....OhmO............OmdO....',
    '.....OO..............OO.....',
    '............................',
    '............................',
    '..........OOOOOOOO..........',
    '.......OOOhmmmmmmdOOO.......',
    '.......OOOOOOOOOOOOOO.......',
  ],
]

// The stain the drops leave where they land, so the spot to avoid shows before a drop does.
// Bottom row = the surface.
const PUDDLE = ['.........OOOOOOOO.........', '....OOOOOhhwmmmmdOOOOO....', '.OOOhhhmmmmmmmmmmmmmddOOO.', 'OhhhmmmmmmmmwwmmmmmmmmdddO']

for (const [look, legend] of Object.entries(DROP_LOOK)) {
  const tag = look === 'oil' ? 'Oil' : ''
  addAnim(`swell${tag}`, SWELL.map((rows) => text(rows, legend)), 5, 0)
  addAnim(`drop${tag}`, DROP.map((rows) => text(rows, legend)), 5, 14)
  addAnim(`splash${tag}`, SPLASH.map((rows) => text(rows, legend)), 14, 12)
  addOne(`puddle${tag}`, text(PUDDLE, legend), 13, 4)
}
addOne('leak', LEAK, 12, 0)

/* ------------------------------------------------------------------ */
/* icicle: 16 x 28 under the ceiling                                   */
/* ------------------------------------------------------------------ */

/** Shade every run of filled pixels in every row: light on the left third, shadow on the right. */
function shadeRuns(c, light, mid, dark, glint = null) {
  for (let y = 0; y < c.h; y++) {
    let x = 0
    while (x < c.w) {
      if (!c.solid(x, y)) {
        x++
        continue
      }
      let x1 = x
      while (c.solid(x1 + 1, y)) x1++
      const n = x1 - x + 1
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n
        c.set(x + i, y, n >= 3 && u < 0.36 ? light : u < 0.7 || n < 3 ? mid : dark)
      }
      if (glint && n >= 6) c.set(x + 1, y, glint)
      x = x1 + 1
    }
  }
  return c
}

// Drawn with a 1 px margin for the outline, so the frame is 18 x 30 and the box starts at (1, 1).
function icicle(cracked) {
  const c = new Canvas(18, 30)
  c.poly([[4, 1], [16, 1], [11, 28], [10, 28]], I1)
  c.poly([[1, 1], [6, 1], [4, 13], [3, 13]], I1)
  shadeRuns(c, I2, I1, I0, G6)
  // The glint is a streak, not a stripe: break it up.
  for (const y of [1, 2, 9, 10, 15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28]) for (let x = 0; x < 18; x++) if (c.get(x, y) === rgba(G6)) c.set(x, y, I2)
  if (cracked) for (const [x, y] of [[5, 5], [6, 4], [7, 5], [8, 6], [9, 5], [10, 4], [11, 5], [12, 6], [13, 5], [14, 4]]) if (c.solid(x, y)) c.set(x, y, O)
  return c.outline(O)
}

function icicleStub() {
  const c = new Canvas(18, 9)
  c.poly([[1, 1], [16, 1], [15, 3], [13, 2], [11, 6], [9, 3], [7, 5], [5, 2], [3, 4], [2, 2]], I1)
  shadeRuns(c, I2, I1, I0)
  return c.outline(O)
}

// Shards thrown up and out from where it landed. Bottom row = the surface.
function icicleShatter(f) {
  const c = new Canvas(44, 24)
  const ground = 22
  const shards = [
    [-2, -6, -2.2, -3.2, 6],
    [2, -8, 1.8, -3.8, 5],
    [-5, -3, -3.6, -1.6, 5],
    [5, -3, 3.4, -1.9, 4],
    [0, -12, -0.5, -4.4, 4],
    [-1, -2, -1.2, -0.6, 3],
    [3, -5, 2.6, -2.8, 3],
    [-3, -9, -2.8, -4.0, 3],
  ]
  const t = f + 0.5
  for (const [x0, y0, vx, vy, size] of shards) {
    const s = Math.max(1, size - Math.floor(f / 2))
    const x = Math.round(22 + x0 + vx * t * 1.6)
    const y = Math.min(ground - 1, Math.round(ground + y0 + vy * t + 0.9 * t * t))
    if (f >= 3 && size <= 3) continue
    c.poly([[x, y - s], [x + s, y], [x - Math.ceil(s / 2), y]], I1)
  }
  if (f === 0) c.poly([[17, ground - 1], [20, ground - 9], [23, ground - 4], [26, ground - 7], [27, ground - 1]], I1)
  shadeRuns(c, I2, I1, I0)
  c.outline(O)
  // Sparks of light off the break.
  const sparks = [[], [[9, 6], [34, 8]], [[5, 10], [38, 5], [22, 2]], [[3, 14], [40, 11], [20, 6], [30, 3]]][f]
  for (const [x, y] of sparks) c.set(x, y, G6)
  return c
}

addOne('icicle', icicle(false), 9, 1)
addOne('icicleCrack', icicle(true), 9, 1)
addOne('icicleStub', icicleStub(), 9, 1)
addAnim('shatter', [0, 1, 2, 3].map(icicleShatter), 22, 23)

/* ------------------------------------------------------------------ */
/* brush: a spinning wash brush, any height, on a rail                 */
/* ------------------------------------------------------------------ */

// A soft-touch wash brush seen from the side: tiers of foam strips round a shaft, each tier
// flaring out where its strips fling wide, the next tucked in under it. The strips turn
// past (two red, one blue, round and round), so the spin reads at a glance.
const BRUSH_W = 38
/** Rows of strips in one tier; the renderer stacks tiers this far apart. */
const TIER = 8
/** Strips round the brush, and their colours in turn (0 red, 1 blue). */
const STRIPS = 9
const STRIP_PAT = [0, 0, 1]
const STRIP_LOOK = [
  [R1, R3, R4],
  [B0, B1, B2],
]
/** Half the width of a tier at each of its rows, top to bottom: tucked in, then flung out. */
const FLARE = [14, 14, 15, 15, 16, 16, 17, 17]

/** One pixel of a tier at row k: spin frame f, and t (0 or 1) which of the two staggered tiers. */
function tierPixel(x, k, f, t) {
  // The flung-out ends flap as they come round.
  const hw = FLARE[k] + (k >= 5 ? [0, 1, 0, -1][mod(f + t, 4)] : 0)
  const u = (x + 0.5 - BRUSH_W / 2) / hw
  if (u < -1 || u > 1) return null
  if (k === 0 && Math.abs(u) > 0.92) return null
  // Where on the turning drum this column is, in strips; each tier a little behind the one above.
  const a = (Math.asin(u) / (2 * Math.PI)) * STRIPS + f / 4 + t * 0.37
  const strip = Math.floor(a)
  const within = a - strip
  // Every strip ends in its own rounded tip at the bottom of the tier.
  if (k === TIER - 1 && (within < 0.18 || within > 0.82)) return null
  // Lit from the left, and a crease where one strip lies on the next.
  let tone = u < -0.45 ? 2 : u < 0.4 ? 1 : 0
  if (within < 0.16) tone = Math.max(0, tone - 1)
  return STRIP_LOOK[STRIP_PAT[mod(strip, STRIP_PAT.length)]][tone]
}

/**
 * One tier, 38 x 8. The tiers are drawn as one stack and outlined together (so between two
 * tiers only the gaps between the tips are dark, not a hard line), then the middle one is cut
 * out: tier t with the other kind above and below it, exactly as the renderer stacks them.
 */
function brushTier(f, t) {
  const c = new Canvas(BRUSH_W, TIER * 3)
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < TIER; k++) {
      for (let x = 0; x < BRUSH_W; x++) {
        const v = tierPixel(x, k, f, i === 1 ? t : 1 - t)
        if (v) c.set(x, i * TIER + k, v)
      }
    }
  }
  return c.outline(O).crop(0, TIER, BRUSH_W, TIER)
}

// The hubs where the shaft goes in: a steel cap over the first tier (the shaft from the
// trolley meets it), and under the last one the line its tips hang over and a smaller hub.
const HUB_TOP = text(
  [
    '....OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO....',
    '....O5555544444444444444443333322O....',
    '....O5444433333333333333332222222O....',
    '....OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO....',
  ],
  { O, 5: G5, 4: G4, 3: G3, 2: G2 },
)
const HUB_BOT = text(
  [
    '.OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.',
    '.............O5444333222O.............',
    '..............OOOOOOOOOO..............',
  ],
  { O, 5: G5, 4: G4, 3: G3, 2: G2 },
)
/** The first tier starts this far under the box top (the cap's lower half lies over it), the last ends this far over its bottom. */
const TIERS_FROM = 2
const TIERS_TO = 3

// The rail: an I-beam with hazard stripes, so the brush's whole path shows. Tiles every 16 px.
function rail(upright) {
  const c = new Canvas(16, 7)
  for (let x = 0; x < 16; x++) {
    c.set(x, 0, O)
    c.set(x, 1, G5)
    for (let y = 2; y <= 4; y++) c.set(x, y, mod(x + y, 8) < 4 ? Y1 : G1)
    c.set(x, 5, G2)
    c.set(x, 6, O)
  }
  if (!upright) return c
  // Stood on end, lit from the left.
  const v = new Canvas(7, 16)
  for (let y = 0; y < 16; y++) {
    v.set(0, y, O)
    v.set(1, y, G5)
    for (let x = 2; x <= 4; x++) v.set(x, y, mod(x + y, 8) < 4 ? Y1 : G1)
    v.set(5, y, G2)
    v.set(6, y, O)
  }
  return v
}
const RAIL_STOP = text(
  ['.OOOOOO.', 'O455443O', 'O4R55R3O', 'O4RRRR3O', 'O4RrrR3O', 'O4RrrR3O', 'O4RRRR3O', 'O4rRRr3O', 'O433332O', '.OOOOOO.'],
  { O, 5: G5, 4: G4, 3: G3, 2: G2, R: R3, r: R1 },
)
// The trolley that grips the rail and carries the brush. Its lamp blinks.
const carriage = (lamp, glow) =>
  text(
    [
      '..OOOO..........OOOO..',
      '.O5443O........O5443O.',
      '.O4332O.OOOOOO.O4332O.',
      'OOOOOOOOOLLLLOOOOOOOOO',
      'O54444444LGGL44444432O',
      'O43333333LLLL33333322O',
      'O43333333333333333322O',
      'O32222222222222222222O',
      '.OOOOOOOOOOOOOOOOOOOO.',
    ],
    { O, 5: G5, 4: G4, 3: G3, 2: G2, L: lamp, G: glow },
  )
// A thin hanger from the rail's end up to the ceiling. Tiles every 16 px.
const ROD = text(Array(16).fill('O42O'), { O, 4: G4, 2: G2 })

// Anchored top centre.
addAnim('brushTierA', [0, 1, 2, 3].map((f) => brushTier(f, 0)), BRUSH_W / 2, 0)
addAnim('brushTierB', [0, 1, 2, 3].map((f) => brushTier(f, 1)), BRUSH_W / 2, 0)
addOne('brushTop', HUB_TOP, BRUSH_W / 2, 0)
addOne('brushBot', HUB_BOT, BRUSH_W / 2, HUB_BOT.h)
addOne('rail', rail(false), 0, 3)
addOne('railV', rail(true), 3, 0)
addOne('railStop', RAIL_STOP, 4, 5)
addAnim('carriage', [carriage(Y0, Y1), carriage(Y1, Y2)], 11, 6)
addOne('rod', ROD, 2, 0)

/* ------------------------------------------------------------------ */
/* jet: a hot wax nozzle and its column                                */
/* ------------------------------------------------------------------ */

// Hangs from the ceiling line; the mouth is its bottom row, 12 px down (JET_NOZZLE in the sim).
const nozzle = (ring, glow) =>
  text(
    [
      'OOOOOOOOOOOOOOOOOOOO',
      'O555444444444443332O',
      'OOOOOOOOOOOOOOOOOOOO',
      '..O55444444443332O..',
      '..O54444444433322O..',
      '..O54433333333222O..',
      '..OOOOOOOOOOOOOOOO..',
      '...OYYKKYYKKYYKKO...',
      '...OOOOOOOOOOOOOO...',
      '....O5444433322O....',
      '....O5443333222O....',
      '....OORRGGGGRROO....',
    ],
    { O, 5: G5, 4: G4, 3: G3, 2: G2, Y: Y1, K: G1, R: ring, G: glow },
  )
const NOZZLE_H = 12

const FLOW_W = 16
const FLOW_H = 16
const BULGE = [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
const CORE = [3, 3, 3, 4, 4, 4, 3, 3, 2, 2, 2, 3, 3, 2, 2, 3]

/** One pixel of the wax column at height `y` in its flow (the pattern slides along it frame by frame). */
function wax(x, y, f) {
  const k = mod(y - 4 * f, 16)
  const l = BULGE[k]
  const r = FLOW_W - 1 - BULGE[mod(k + 8, 16)]
  if (x < l || x > r) return 0
  if (x === l || x === r) return OR0
  const c = Math.abs(x - 7.5)
  const core = CORE[k]
  if (c < core - 2) return k === 5 || k === 13 ? G6 : Y2
  if (c < core) return Y1
  // Darker clots sliding down the cooler outside of the column.
  if ((x === l + 2 && (k === 2 || k === 3)) || (x === r - 2 && (k === 10 || k === 11))) return OR0
  return x >= r - 2 ? OR0 : x <= l + 1 ? OR2 : OR1
}

function flow(f) {
  const c = new Canvas(FLOW_W, FLOW_H)
  for (let y = 0; y < FLOW_H; y++) for (let x = 0; x < FLOW_W; x++) c.set(x, y, wax(x, y, f))
  return c
}

/** The rounded front of the column while it is still shooting out (and where a short one ends in the air). */
function flowHead(f) {
  const c = new Canvas(FLOW_W, 10)
  const inset = [0, 0, 0, 0, 1, 1, 2, 3, 5]
  for (let y = 0; y < 9; y++) {
    for (let x = inset[y]; x < FLOW_W - inset[y]; x++) {
      const v = wax(x, y, f)
      if (!v) continue
      const edge = x === inset[y] || x === FLOW_W - 1 - inset[y] || y === 8
      c.set(x, y, edge ? OR0 : v)
    }
  }
  // Two drops running ahead of it.
  c.set(f % 2 ? 5 : 10, 9, OR0)
  return c
}

// Where the column meets a surface (bottom row = the surface): it piles up and spits to both sides.
const WAX = { o: OR0, a: OR1, l: OR2, y: Y1, h: Y2, w: G6 }
function waxSplash(f) {
  const c = new Canvas(48, 18)
  const ground = 17
  const cx = 23.5
  const rx = 11 + 2 * f
  const ry = 6 - f
  for (let y = 0; y <= ground; y++) {
    for (let x = 0; x < 48; x++) {
      const d = Math.hypot((x - cx) / rx, (y - ground - 0.5) / ry)
      if (d <= 1) c.set(x, y, d > 0.8 ? OR0 : d > 0.55 ? OR1 : d > 0.3 ? Y1 : Y2)
    }
  }
  // Blobs thrown out on both sides, higher and wider frame by frame.
  const t = f + 1
  for (const [vx, vy, r] of [[4.2, 5.2, 2], [6.4, 3.4, 1], [2.6, 6.6, 1]]) {
    const dx = 9 + vx * t
    const y = Math.round(ground - 2 - (vy * t - 1.1 * t * t))
    for (const side of [-1, 1]) {
      const x = cx + side * dx
      c.circle(x, y, r, OR0)
      if (r > 1) c.circle(x, y, r - 1, Y1)
      else c.rect(Math.floor(x), y, 2, 1, OR1)
    }
  }
  return c
}
// The tell: the nozzle spits. From the mouth (top row) down.
const WAX_SPURT = [
  ['....oooo....', '...oayyao...', '....oaao....', '.....oo.....', '............', '............', '............', '............', '............', '............', '............', '............'],
  ['...oooooo...', '..oayhhyao..', '..oayhhyao..', '...oayyao...', '...oayyao...', '....oaao....', '.....oo.....', '............', '............', '............', '............', '............'],
  ['....oooo....', '....oaao....', '.....oo.....', '............', '.....oo.....', '....oyyo....', '...oayhao...', '...oayyao...', '....oaao....', '.....oo.....', '............', '..o......o..'],
]

// Cold wax left on the surface the column hits, so its landing spot shows while it is off.
// Bottom row = the surface.
const WAX_STAIN = text(
  ['......OOOOOOOO......', '...OOOayyaaaaaOOO...', '.OOaayyaaaaaaaammOO.', 'OaaaaaaaammaaaaaamaO'],
  { O, a: OR0, y: Y0, m: M2 },
)

const flipAll = (list) => list.map((c) => c.flipY())
const flows = [0, 1, 2, 3].map(flow)
const heads = [0, 1, 2, 3].map(flowHead)
const splashes = [0, 1, 2].map(waxSplash)
const spurts = WAX_SPURT.map((rows) => text(rows, WAX))

addOne('nozzle', nozzle(G1, G0), 10, 0)
addOne('nozzleHot', nozzle(OR1, Y2), 10, 0)
addOne('nozzleUp', nozzle(G1, G0).flipY(), 10, NOZZLE_H)
addOne('nozzleUpHot', nozzle(OR1, Y2).flipY(), 10, NOZZLE_H)
// Down: the pattern runs downward frame by frame. Up: the same frames turned over.
addAnim('flow', flows, 8, 0)
addAnim('flowUp', flipAll(flows), 8, 0)
addAnim('flowHead', heads, 8, 0)
addAnim('flowHeadUp', flipAll(heads), 8, 10)
addAnim('waxSplash', splashes, 24, 18)
addAnim('waxSplashUp', flipAll(splashes), 24, 0)
addAnim('spurt', spurts, 6, 0)
addAnim('spurtUp', flipAll(spurts), 6, 12)
addOne('waxStain', WAX_STAIN, 10, 4)
addOne('waxStainUp', WAX_STAIN.flipY(), 10, 0)

/* ------------------------------------------------------------------ */
/* blower: a dryer, one unit per tile of height, and the air it moves  */
/* ------------------------------------------------------------------ */

// One 32 x 32 unit, blowing left: a scroll housing with its fan showing, and a horn to the mouth.
function blowerUnit(f) {
  const c = new Canvas(32, 32)
  const cx = 20.5
  const cy = 15.5
  // The horn, wide at the mouth.
  c.poly([[13, 8], [4, 4], [4, 27], [13, 23]], B1)
  c.poly([[13, 8], [4, 4], [4, 7], [13, 10]], B2)
  c.poly([[13, 21], [4, 24], [4, 27], [13, 23]], B0)
  // Dark inside the mouth, then the hazard lip.
  for (let y = 4; y <= 27; y++) {
    c.set(4, y, G0)
    for (let x = 1; x <= 3; x++) c.set(x, y, mod(x + y, 6) < 3 ? Y1 : G1)
  }
  // The housing.
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy)
      if (d > 10.6) continue
      c.set(x, y, dx + dy < -7.5 ? B2 : dx + dy > 8.5 ? B0 : B1)
    }
  }
  // The fan's opening: a steel ring, dark inside, three blades and a yellow hub.
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d <= 7.2) c.set(x, y, d > 6.1 ? (x - cx + (y - cy) < 0 ? G5 : G3) : G0)
    }
  }
  // Four blades, a quarter turn apart: three frames carry one into the next.
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy)
      if (d > 5.6 || d < 0.8) continue
      const a = mod((Math.atan2(dy, dx) * 180) / Math.PI - f * 30, 90)
      if (a < 44) c.set(x, y, a < 12 ? G6 : G4)
    }
  }
  c.rect(20, 15, 2, 2, Y1)
  // Two rivets on the housing.
  c.set(27, 8, G5)
  c.set(27, 23, B0)
  return c.outline(O)
}
/** The post the units are bolted to. Tiles every 16 px. */
const POST = text(Array(16).fill('O5443322O'), { O, 5: G5, 4: G4, 3: G3, 2: G2 })
const FOOT = text(
  ['.....OOOOOOOOOOOOOO.....', '..OOO54444444433332OOO..', '.O55444444443333333222O.', 'OOOOOOOOOOOOOOOOOOOOOOOO'],
  { O, 5: G5, 4: G4, 3: G3, 2: G2 },
)

// Air: white streaks with a cool shadow line, so they show on a dark wall and on a pale sky alike.
// Drawn moving left (head on the left); the renderer mirrors them for a wind to the right.
/** A streak `len` px long: a thick head, a long body, a tail breaking up into dashes. */
function gustStreak(len) {
  const c = new Canvas(len, 3)
  const body = Math.round(len * 0.62)
  const head = Math.round(len * 0.3)
  for (let x = 2; x < head; x++) c.set(x, 0, G6)
  for (let x = 0; x < body; x++) c.set(x, 1, G6)
  for (let x = 1; x < Math.round(body * 0.85); x++) c.set(x, 2, B3)
  let x = body + 2
  for (const dash of [5, 3, 2, 1]) {
    for (let k = 0; k < dash && x < len; k++, x++) c.set(x, 1, G6)
    x += 2
  }
  return c
}

addAnim('blower', [0, 1, 2].map(blowerUnit), 16, 32)
addOne('blowerPost', POST, 4, 0)
addOne('blowerFoot', FOOT, 12, 4)
const gusts = [64, 40, 22].map(gustStreak)
addAnim('gust', gusts, 0, 1)
// The same blowing right, head on the right; still anchored on the left end.
addAnim('gustR', gusts.map((c) => c.flipX()), 0, 1)

/* ------------------------------------------------------------------ */
/* Checks, meta, output                                                */
/* ------------------------------------------------------------------ */

// The wax column is stacked by the renderer: each piece must be exactly as tall as it steps.
for (const { canvas, label } of [...shown.flow, ...shown.flowUp]) {
  if (canvas.h !== FLOW_H) throw new Error(`${label}: ${canvas.h} tall, the renderer steps ${FLOW_H}`)
}
// A tier must cover the brush's hit box (28 wide) on every row of strips, so it never hurts where nothing is drawn.
for (const { canvas, label } of [...shown.brushTierA, ...shown.brushTierB]) {
  for (let y = 0; y < TIER; y++) {
    for (let x = BRUSH_W / 2 - 14; x < BRUSH_W / 2 + 14; x++) if (!canvas.solid(x, y)) throw new Error(`${label}: a hole at ${x},${y} inside the hit box`)
  }
}

atlas.meta({
  note: 'Hazards. Sizes are frame sizes; every anchor is where the frame meets the thing it hangs from, stands on or leaves.',
  leak: { mouth: LEAK_MOUTH, note: 'anchor: top centre, on the ceiling line. The drop grows from `mouth` px below it: draw swell* there.' },
  swell: { ticks: [6, 8, 8, 8], note: 'swell0..3 / swellOil0..3 over the 30 tick tell, anchored top centre at the mouth.' },
  drop: { frame: [10, 14], box: [8, 10], note: 'drop* / dropOil*: 10 x 14, anchor = bottom centre of the 8 x 10 hit box. 0 at rest, 1 falling fast. splash* (3 frames, 8 ticks): anchor = bottom centre, on the surface. puddle / puddleOil: the stain where drops land, anchor bottom centre on the surface.' },
  icicle: { box: [16, 28], frame: [18, 30], note: 'icicle, icicleCrack (shown in the second half of the shake), icicleStub (what stays): anchor = top centre of the box, on the ceiling line. shatter0..3 over 12 ticks: anchor = bottom centre, on the surface.' },
  brush: {
    hit: 28,
    w: BRUSH_W,
    tier: TIER,
    from: TIERS_FROM,
    to: TIERS_TO,
    note: 'Tiers of strips fill the box from `from` px under its top to `to` px over its bottom: brushTierA<f> and brushTierB<f> taking turns (A first), one every `tier` px (anchor top centre), the last one moved up so it ends exactly there. Draw them bottom tier first. Then brushTop (anchor top centre, on the box top) and brushBot (anchor bottom centre, on the box bottom). f advances every 2 ticks.',
  },
  rail: { tile: 16, thick: 7, note: 'rail tiles along x (anchor: left, middle of its thickness), railV along y (anchor: middle, top). railStop: anchor centre. carriage0/1 (lamp off / on): anchor = middle of the rail it grips (the renderer puts it RAIL_GAP = 12 px above the brush top, with rod as the shaft between). rod tiles along y.' },
  jet: {
    nozzle: NOZZLE_H,
    hit: 14,
    w: FLOW_W,
    tile: FLOW_H,
    head: 10,
    note: 'nozzle / nozzleHot: anchor top centre on the ceiling line, mouth `nozzle` px down. nozzleUp*: anchor bottom centre on the floor line. flow<f> tiles along the column from the mouth (anchor top centre); flowUp<f> for an up jet, tiled upward. flowHead* / flowHeadUp*: the front of the column (anchor: the end it joins the column). waxSplash* / waxSplashUp*: anchor = centre, on the surface it hits. spurt* / spurtUp*: the sputter, anchored at the mouth. waxStain (anchor bottom centre on the floor) / waxStainUp (top centre on the ceiling): cold wax where the column lands.',
  },
  blower: { unit: 32, note: 'blower0..2: one unit per tile of zone height, blowing left (mirror for right), anchor bottom centre. blowerPost tiles along y behind them (anchor top centre), blowerFoot on the floor (anchor bottom centre). gust0..2 (long, medium, short): moving left, head first; gustR0..2 the same moving right. Anchor: left end, middle row.' },
  ticks: { spin: 2, flow: 3, fan: 2, swell: 30, splash: 8, shatter: 12, shake: 20, sputter: 20 },
  colours: 'All from the master palette. Grimy water is the mud ramp, oil the purple ramp, hot wax orange and yellow, the brush mostly red with blue strips (it hurts), the dryer blue (it does not).',
})

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write()
console.log(`hazards atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames -> ${path.relative(process.cwd(), path.join(ASSETS_DIR, 'hazards.png'))}`)

/* ------------------------------------------------------------------ */
/* Putting them together (the renderer does the same; the review uses these) */
/* ------------------------------------------------------------------ */

const fr = (name) => atlas.frames.get(name) ?? (() => { throw new Error('no frame ' + name) })()
/** Draw a frame with its anchor at (x, y). */
function put(c, name, x, y, { flipX = false } = {}) {
  const f = fr(name)
  const src = flipX ? f.canvas.flipX() : f.canvas
  c.blit(src, x - (flipX ? f.canvas.w - f.ax : f.ax), y - f.ay)
}

/** A brush whose box is (cx - 14, top, 28, h), spin frame f: as the renderer does it. */
function drawBrush(c, cx, top, h, f) {
  const y0 = top + TIERS_FROM
  const y1 = top + h - TIERS_TO
  const n = Math.max(1, Math.ceil((y1 - y0) / TIER))
  for (let i = n - 1; i >= 0; i--) put(c, `brushTier${i % 2 ? 'B' : 'A'}${f}`, cx, Math.min(y0 + i * TIER, y1 - TIER))
  put(c, 'brushTop', cx, top)
  put(c, 'brushBot', cx, top + h)
}

/** A rail along x from x0 to x1 at height y, with its stops. */
function drawRailX(c, x0, x1, y) {
  for (let x = x0; x < x1; x += 16) c.blit(fr('rail').canvas, x, y - 3, { sw: Math.min(16, x1 - x) })
  put(c, 'railStop', x0, y)
  put(c, 'railStop', x1, y)
}
function drawRailY(c, x, y0, y1) {
  for (let y = y0; y < y1; y += 16) c.blit(fr('railV').canvas, x - 3, y, { sh: Math.min(16, y1 - y) })
  put(c, 'railStop', x, y0)
  put(c, 'railStop', x, y1)
}

/** A jet from a mouth at (cx, my), `len` px of column, flow frame f. splash: it reached a surface. */
function drawJet(c, cx, my, len, f, { up = false, splash = true, hot = true } = {}) {
  const dir = up ? -1 : 1
  const tag = up ? 'Up' : ''
  if (len > 0) {
    const body = splash ? len : Math.max(0, len - 10)
    for (let d = 0; d < body; d += FLOW_H) {
      const n = Math.min(FLOW_H, body - d)
      const tile = fr(`flow${tag}${f}`).canvas
      if (up) c.blit(tile, cx - 8, my - d - n, { sy: FLOW_H - n, sh: n })
      else c.blit(tile, cx - 8, my + d, { sh: n })
    }
    if (splash) put(c, `waxSplash${tag}${f % 3}`, cx, my + dir * len)
    else put(c, `flowHead${tag}${f}`, cx, my + dir * body)
  }
  put(c, `nozzle${tag}${hot ? 'Hot' : ''}`, cx, up ? my + NOZZLE_H : my - NOZZLE_H)
}

/** A dryer of `units` tiles standing on `floor`, its machine tile centred on cx, blowing left unless `right`. */
function drawBlower(c, cx, floor, units, f, right = false) {
  const top = floor - units * 32
  for (let y = top + 6; y < floor; y += 16) c.blit(fr('blowerPost').canvas, cx + (right ? -11 : 3), y, { sh: Math.min(16, floor - y) })
  put(c, 'blowerFoot', cx + (right ? -7 : 7), floor)
  for (let k = 0; k < units; k++) put(c, `blower${f}`, cx, floor - k * 32, { flipX: right })
}

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const BGS = { sky: '#5cc8ff', tunnel: '#2e3038', night: '#1a1033', snow: '#dff3ff', concrete: '#767b8a' }
  const groups = {
    drip: ['leak', 'swell', 'drop', 'splash', 'puddle', 'swellOil', 'dropOil', 'splashOil', 'puddleOil'],
    icicle: ['icicle', 'icicleCrack', 'icicleStub', 'shatter'],
    brush: ['brushTop', 'brushTierA', 'brushTierB', 'brushBot', 'rail', 'railV', 'railStop', 'carriage', 'rod'],
    jet: ['nozzle', 'nozzleHot', 'nozzleUp', 'nozzleUpHot', 'flow', 'flowUp', 'flowHead', 'flowHeadUp', 'waxSplash', 'waxSplashUp', 'spurt', 'spurtUp', 'waxStain', 'waxStainUp'],
    blower: ['blower', 'blowerPost', 'blowerFoot', 'gust', 'gustR'],
  }
  const rows = (names) => names.map((n) => ({ label: n, frames: shown[n] }))
  for (const [bgName, bg] of Object.entries(BGS)) {
    for (const [g, names] of Object.entries(groups)) {
      contactSheet(rows(names), { bg, scale: 4, wrap: 8, ground: false, file: path.join(REVIEW, `sheet_${g}_${bgName}.png`) })
    }
  }
  for (const [g, names] of Object.entries(groups)) contactSheet(rows(names), { bg: BGS.tunnel, scale: 4, wrap: 8, ground: false, flipX: true, file: path.join(REVIEW, `sheet_${g}_tunnel_flip.png`) })
  contactSheet(rows(Object.values(groups).flat()), { bg: BGS.sky, scale: 1, wrap: 12, labels: false, ground: false, file: path.join(REVIEW, 'sheet_all_1x.png') })

  // Maxx, for scale and for style: his idle frame out of his own atlas.
  let maxx = null
  try {
    const src = fs.readFileSync(path.join(ASSETS_DIR, 'maxx.atlas.ts'), 'utf8')
    const m = /idle0: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+) \}/.exec(src)
    if (m) {
      const [x, y, w, h, ax, ay] = m.slice(1).map(Number)
      maxx = { canvas: Canvas.load(path.join(ASSETS_DIR, 'maxx.png')).crop(x, y, w, h), ax, ay }
    }
  } catch {
    // No hero atlas: the scenes go without him.
  }

  // Each hazard assembled as in the game, in a little room: a ceiling, a floor, Maxx.
  for (const [bgName, bg] of Object.entries(BGS)) {
    const W = 640
    const H = 232
    const ceil = 24
    const floor = 200
    const dark = bgName === 'tunnel' || bgName === 'night'
    const stone = dark ? G2 : G3
    const scenes = [0, 1, 2, 3].map((f) => {
      const c = new Canvas(W, H, bg)
      c.rect(0, 0, W, ceil, stone)
      c.rect(0, ceil - 1, W, 1, O)
      c.rect(0, floor, W, H - floor, stone)
      c.rect(0, floor, W, 1, O)
      const maxxAt = (x) => maxx && c.blit(maxx.canvas, x - maxx.ax, floor - maxx.ay)

      // Drips: the tell in four steps, a falling drop, a splash; water then oil.
      let x = 20
      for (const tag of ['', 'Oil']) {
        for (let k = 0; k < 4; k++) {
          put(c, 'leak', x, ceil)
          put(c, `swell${tag}${k}`, x, ceil + LEAK_MOUTH)
          x += 24
        }
        put(c, 'leak', x, ceil)
        put(c, `drop${tag}${f % 2}`, x, ceil + 60 + f * 22)
        put(c, `splash${tag}${f % 3}`, x + 4, floor)
        x += 34
      }
      maxxAt(x - 4)

      // Icicles: hanging, cracked and shifted (the shake), falling with its stub left, shattering.
      x = 260
      put(c, 'icicle', x, ceil)
      put(c, 'icicleCrack', x + 26 + (f % 2 ? 1 : -1), ceil)
      put(c, 'icicleStub', x + 52, ceil)
      put(c, 'icicle', x + 52, ceil + 40 + f * 18)
      put(c, 'icicleStub', x + 84, ceil)
      put(c, `shatter${f}`, x + 84, floor)

      // Brushes: one on a floor-level run under its rail, one tall one on an upright rail.
      x = 400
      const btop = floor - 64
      drawRailX(c, x - 20, x + 80, btop - 12)
      for (const rx of [x - 20, x + 80]) for (let y = ceil; y < btop - 15; y += 16) c.blit(fr('rod').canvas, rx - 2, y, { sh: Math.min(16, btop - 15 - y) })
      c.blit(fr('rod').canvas, x + 8 + f * 6, btop - 12, { sh: 12 })
      put(c, `carriage${f % 2}`, x + 10 + f * 6, btop - 12)
      drawBrush(c, x + 10 + f * 6, btop, 64, f)
      maxxAt(x + 62)
      const vx = 520
      drawRailY(c, vx, ceil + 8, floor - 2)
      const vtop = ceil + 30 + f * 10
      c.blit(fr('rod').canvas, vx - 2, vtop - 12, { sh: 12 })
      put(c, `carriage${f % 2}`, vx, vtop - 12)
      drawBrush(c, vx, vtop, 96, f)

      // Blower, blowing left at Maxx, with its air.
      const bx = 620
      drawBlower(c, bx, floor, 3, f % 3)
      for (let lane = 0; lane < 6; lane++) {
        const gy = floor - 88 + lane * 15
        const gx = bx - 30 - mod(lane * 37 + f * 9, 60)
        put(c, `gust${lane % 3}`, gx - 44, gy)
      }
      return c
    })
    const jets = [0, 1, 2, 3].map((f) => {
      const c = new Canvas(W, H, bg)
      c.rect(0, 0, W, ceil, stone)
      c.rect(0, ceil - 1, W, 1, O)
      c.rect(0, floor, W, H - floor, stone)
      c.rect(0, floor, W, 1, O)
      if (maxx) c.blit(maxx.canvas, 40 - maxx.ax, floor - maxx.ay)
      // Off, the sputter, shooting out, full, a short one that ends in the air; then the same from the floor.
      put(c, 'nozzle', 90, ceil)
      put(c, 'nozzleHot', 130, ceil)
      put(c, `spurt${f % 3}`, 130, ceil + NOZZLE_H)
      drawJet(c, 170, ceil + NOZZLE_H, 40 + f * 30, f, { splash: false })
      drawJet(c, 210, ceil + NOZZLE_H, floor - ceil - NOZZLE_H, f)
      drawJet(c, 260, ceil + NOZZLE_H, 84, f, { splash: false })
      put(c, 'nozzleUp', 320, floor)
      put(c, 'nozzleUpHot', 360, floor)
      put(c, `spurtUp${f % 3}`, 360, floor - NOZZLE_H)
      drawJet(c, 400, floor - NOZZLE_H, 40 + f * 30, f, { up: true, splash: false })
      drawJet(c, 440, floor - NOZZLE_H, floor - ceil - NOZZLE_H, f, { up: true })
      drawJet(c, 490, floor - NOZZLE_H, 84, f, { up: true, splash: false })
      // A blower to the right, as a tail wind.
      drawBlower(c, 560, floor, 2, f % 3, true)
      put(c, 'gust0', 592, floor - 40, { flipX: true })
      put(c, 'gust1', 600, floor - 20, { flipX: true })
      return c
    })
    const sheet = new Canvas(W, (H + 4) * 8, bg)
    scenes.forEach((c, i) => sheet.blit(c, 0, i * (H + 4)))
    jets.forEach((c, i) => sheet.blit(c, 0, (4 + i) * (H + 4)))
    sheet.save(path.join(REVIEW, `scenes_${bgName}_1x.png`))
    // 3x of the first frame of each, cut into pieces the reviewer can read.
    const big = new Canvas(W, H * 2 + 4, bg)
    big.blit(scenes[1], 0, 0)
    big.blit(jets[1], 0, H + 4)
    big.crop(0, 0, 330, H * 2 + 4).scale(3).save(path.join(REVIEW, `scenes_${bgName}_3x_left.png`))
    big.crop(310, 0, 330, H * 2 + 4).scale(3).save(path.join(REVIEW, `scenes_${bgName}_3x_right.png`))
  }
  console.log(`review sheets in ${REVIEW}`)
}
