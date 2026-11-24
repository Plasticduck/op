// art-maxx.mjs: generates the 'maxx' atlas (the hero, Mighty Maxx) from the
// client's run sheet, scripts/maxx/source/maxx-run.png (never edited).
//
//   node scripts/maxx/art-maxx.mjs                    writes maxx.png + maxx.atlas.ts
//   node scripts/maxx/art-maxx.mjs --review <dir>     also writes contact sheets (4x, on
//       sky blue and tunnel grey, facing right and mirrored), a 2x overview, the
//       grime overlays in use and preview.html (plays every animation) into <dir>
//   MAXX_ZOOM=run3,idle0 ... --review <dir>           adds 10x ruler zooms of those frames
//   node scripts/maxx/art-maxx.mjs --dump run3        prints a finished frame as text
//
// How he is made:
//   1-2  the eleven 128 px run frames are mapped to his flat palette and halved,
//        each registered on the whites of his eyes, so head and torso land on
//        the same pixels in every frame
//   3    one hand-finished torso plate (mask, eyes, grin, MW shield) replaces the
//        eleven slightly different downscaled torsos; the other expressions are
//        the same plate with the eyes and mouth swapped (EYES, MOUTH)
//   4    each run frame is split around the plate: cape, tails and legs behind
//        it, the swinging near arm in front of it; the far fist is cut out
//   5-6  the prep gun is hand-pixelled (level) and built on the diagonal lattice
//        (45 degrees); the other aims are quarter turns of those. His far arm, a
//        shade darker than the near one, always holds it, and the whole arm is
//        placed by the nozzle so the tip sits exactly on the contract's MUZZLE
//   7    every other pose is assembled from those parts plus drawn capes and arms
//   8    the small pieces (map sprite, face icon, gun, grime overlays) are hand-pixelled
//   9    everything is packed, measured and checked (nozzle positions, palette)

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, rulerSheet, rgba, lum } from './pix.mjs'
import { GUN, MAXX, PAL, checkPalette } from './palette.mjs'
import { GAME_DIR, REPO } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

/* ------------------------------------------------------------------ */
/* 1. The source sheet, quantised to Maxx's palette                    */
/* ------------------------------------------------------------------ */

const M = Object.fromEntries(Object.entries(MAXX).map(([k, v]) => [k, rgba(v)]))

// Each of the 46 source colours, mapped by hand to one of his flat shades.
const QUANT = {
  '#f51924': M.redLight, '#d5232f': M.redLight, '#d10713': M.red, '#b5262e': M.red, '#ae0512': M.red,
  '#8d0f1e': M.redDark, '#7f0207': M.redDark, '#5c0406': M.redDark, '#3c0507': M.redLine, '#310615': M.redLine,
  '#4f2109': M.woodLine, '#311107': M.woodLine, '#854909': M.woodDark, '#9c5e17': M.woodShade, '#b96e23': M.woodShade,
  '#ba7c29': M.woodShade, '#d57a1d': M.woodMid, '#d68b2e': M.woodMid, '#c89844': M.bristleShade, '#cf915f': M.woodMid,
  '#f09c3f': M.woodLight, '#dab15b': M.bristleShade, '#e7a868': M.woodLight, '#f1ae51': M.woodLight, '#f5c56e': M.bristle,
  '#f5c48b': M.bristle, '#fbdb8a': M.bristleLight, '#fbe2b3': M.bristleLight, '#fbe5d3': M.bristleLight,
  '#091439': M.blueLine, '#0d4f9a': M.blueShade, '#076bc5': M.blueShade, '#0780df': M.blueShade, '#109ff9': M.blue,
  '#cafdfd': M.white, '#f7f4f8': M.white, '#f5f7ec': M.white, '#f0e3eb': M.whiteShade,
  '#1e0d06': M.outline, '#15110c': M.outline, '#0d0f1c': M.outline, '#0f1706': M.outline, '#1c0b16': M.outline,
  '#072a03': M.outline, '#250707': M.outline, '#584a4e': M.outline,
}
const QMAP = new Map(Object.entries(QUANT).map(([k, v]) => [rgba(k), v]))
const LINES = new Set([M.outline, M.redLine, M.woodLine, M.blueLine])
const EYE_WHITES = new Set(['#f7f4f8', '#f0e3eb', '#f5f7ec'].map((c) => rgba(c)))

// The whites of his eyes are the biggest white patch in every frame, and the
// head and torso never change shape through the cycle: the patch's top-left
// corner is the landmark every frame is registered on.
function findEye(c) {
  const seen = new Uint8Array(c.w * c.h)
  let best = null
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (seen[y * c.w + x] || !EYE_WHITES.has(c.get(x, y))) continue
      const stack = [[x, y]]
      const box = { n: 0, x: x, y: y }
      seen[y * c.w + x] = 1
      while (stack.length) {
        const [px, py] = stack.pop()
        box.n++
        box.x = Math.min(box.x, px)
        box.y = Math.min(box.y, py)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const qx = px + dx
          const qy = py + dy
          if (qx < 0 || qy < 0 || qx >= c.w || qy >= c.h || seen[qy * c.w + qx] || !EYE_WHITES.has(c.get(qx, qy))) continue
          seen[qy * c.w + qx] = 1
          stack.push([qx, qy])
        }
      }
      if (!best || box.n > best.n) best = box
    }
  }
  return best
}

function loadSource() {
  const sheet = Canvas.load(path.join(REPO, 'scripts/maxx/source/maxx-run.png'))
  const cells = []
  for (let f = 0; f < 11; f++) {
    const raw = sheet.crop(f * 128, 0, 128, 128)
    const eye = findEye(raw)
    const c = raw.clone().map((v) => {
      if (!v) return 0
      if (!QMAP.has(v)) throw new Error('source colour not mapped: ' + v.toString(16))
      return QMAP.get(v)
    })
    cells.push({ c, eye })
  }
  return cells
}

/* ------------------------------------------------------------------ */
/* 2. Half size, registered in "body space"                            */
/* ------------------------------------------------------------------ */

// Body space: a BW x BH canvas in which the eye landmark always sits at (EX, EY),
// so the rigid head and torso land on the same pixels in every frame and only
// the ground line moves (the run cycle's bob).
const BW = 88
const BH = 76
const EX = 48
const EY = 18
/** The anchor column: the middle of the torso, 3 px behind the eye landmark. */
const AX = EX - 3

// Each output pixel sees a 2x2 block of the source, on a grid phased so the
// landmark falls on a block corner. Half-covered blocks stay solid so thin
// parts survive; a line colour wins when it holds half the block, which keeps
// the 1 px outline whole; otherwise the commonest fill wins.
function halve({ c, eye }) {
  const px = eye.x & 1
  const py = eye.y & 1
  const ox = EX - (eye.x - px) / 2
  const oy = EY - (eye.y - py) / 2
  const o = new Canvas(BW, BH)
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      const sx = 2 * (x - ox) + px
      const sy = 2 * (y - oy) + py
      const ps = [c.get(sx, sy), c.get(sx + 1, sy), c.get(sx, sy + 1), c.get(sx + 1, sy + 1)].filter((p) => p)
      if (ps.length < 2) continue
      const lines = ps.filter((p) => LINES.has(p))
      const pool = lines.length >= 2 ? lines : ps.filter((p) => !LINES.has(p))
      const n = new Map()
      for (const p of pool) n.set(p, (n.get(p) ?? 0) + 1)
      let best = 0
      let bn = 0
      for (const [p, k] of n) {
        if (k > bn || (k === bn && lum(p) < lum(best))) {
          best = p
          bn = k
        }
      }
      o.set(x, y, best)
    }
  }
  // the source's ground is the bottom edge of its 128 px cell
  return { canvas: o, ground: 64 + oy }
}

// A fill pixel with no neighbour of its own colour is noise from the source's
// soft shading: it takes the commonest fill around it.
function despeckle(c) {
  const out = c.clone()
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const v = c.get(x, y)
      if (!v || LINES.has(v)) continue
      const n = new Map()
      let same = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const q = c.get(x + dx, y + dy)
        if (q === v) same += dx && dy ? 0.5 : 1
        else if (q && !LINES.has(q)) n.set(q, (n.get(q) ?? 0) + (dx && dy ? 0.5 : 1))
      }
      if (same >= 1) continue
      let best = 0
      let bn = 1.4
      for (const [q, k] of n) {
        if (k > bn) {
          best = q
          bn = k
        }
      }
      if (best) out.set(x, y, best)
    }
  }
  return out
}

const SRC = loadSource()
const RUN = SRC.map(halve).map((r) => ({ ...r, canvas: despeckle(r.canvas) }))

/* ------------------------------------------------------------------ */
/* 3. The torso plate: head and body with no arms, legs, cape or tails */
/* ------------------------------------------------------------------ */

const LEG = { K: M.outline, r: M.redLine, d: M.redDark, e: M.redShade, R: M.red, L: M.redLight, a: M.blueDark, w: M.woodLine, D: M.woodDark, S: M.woodShade, m: M.woodMid, o: M.woodLight, h: M.bristleShade, b: M.bristle, B: M.bristleLight, n: M.blueLine, u: M.blueShade, U: M.blue, W: M.white, V: M.whiteShade }

/** Hand-pixelled correction: '.' keeps what is there, '_' erases, letters are LEG colours. */
function patch(c, x, y, rows) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch === '.') continue
      if (ch !== '_' && !(ch in LEG)) throw new Error('patch: unknown colour ' + ch)
      c.set(x + i, y + j, ch === '_' ? 0 : LEG[ch])
    }
  })
  return c
}

// Eyes sit at body space (47, 17), 10 wide: the two lobes of his eyes, pupils
// well forward with a glint in each. Mouths sit at (44, 30), 11 wide.
const EYES = {
  normal: ['ooKKKooKKo', 'oKWWWKKWWK', 'KWWWWWKWWW', 'KWWWWKWWKW', 'KWWWKKWKKW', 'KWWWKKWKKW', 'KWWWKKWKKV', 'KWWWWWWWWV', 'KVWWWVKWVV', 'RKVVVKKVVK', 'RdKKKddKKd'],
  // lids down: the outline of the eyes stays, so they still read as his eyes
  blink: ['ooKKKooKKo', 'oKbbbKKbbK', 'KbbbbbKbbb', 'Kbbbbbbbbb', 'Kbbbbbbbbb', 'Kbbbbbbbbb', 'KKKKKKoKKK', 'Kooooooooo', 'KoooooKooo', 'RKoooKKooK', 'RdKKKddKKd'],
  // squeezed shut in two happy arcs
  happy: ['ooKKKooKKo', 'oKbbbKKbbK', 'KbbbbbKbbb', 'Kbbbbbbbbb', 'KbKKKbbbKb', 'KKbbbKbKbK', 'Kbbbbbbbbb', 'Kooooooooo', 'KoooooKooo', 'RKoooKKooK', 'RdKKKddKKd'],
  // screwed up: > <
  hurt: ['ooKKKooKKo', 'oKbbbKKbbK', 'KbbbbbKbbb', 'KbKbbbbbbK', 'KbbKbbbbKb', 'KbbbKbbKbb', 'KbbKbbbbKb', 'KoKooooooK', 'KoooooKooo', 'RKoooKKooK', 'RdKKKddKKd'],
  // wide: the pupils shrunk to dots in the middle of the whites
  shock: ['ooKKKooKKo', 'oKWWWKKWWK', 'KWWWWWKWWW', 'KWWWWWWWWW', 'KWWKKWWKKW', 'KWWKKWWKKW', 'KWWWWWWWWV', 'KWWWWWWWWV', 'KVWWWVKWVV', 'RKVVVKKVVK', 'RdKKKddKKd'],
  // seeing stars: crosses that turn from one frame to the next
  dizzyA: ['ooKKKooKKo', 'oKWWWKKWWK', 'KWWWWWKWWW', 'KWKKKWWKKK', 'KKWWWKWKWK', 'KKWKWKWKKK', 'KKWWWKWWWW', 'KWKKKWWWWV', 'KVWWWVKWVV', 'RKVVVKKVVK', 'RdKKKddKKd'],
  dizzyB: ['ooKKKooKKo', 'oKWWWKKWWK', 'KWWWWWKWWW', 'KKWWWKWWWW', 'KWKWKWWKWK', 'KWWKWWWWKW', 'KWKWKWWKWK', 'KKWWWKWWWV', 'KVWWWVKWVV', 'RKVVVKKVVK', 'RdKKKddKKd'],
}
const MOUTH = {
  // his grin: a wedge of teeth under a lip line that runs on toward the cheek
  normal: ['oKKKKKooooo', 'oKWWWWKKKKK', 'ooKWWWWVKoo', 'oooKKKKKooo'],
  happy: ['oKKKKKKKKKo', 'oKWWWWWWWKo', 'ooKdddddKoo', 'oooKKKKKooo'],
  // gritted teeth
  hurt: ['ooooooooooo', 'oKKKKKKKKKo', 'oKWKWWKWWKo', 'oKKKKKKKKKo'],
  shock: ['oooKKKKKooo', 'ooKdddddKoo', 'ooKdddddKoo', 'oooKKKKKooo'],
  dizzy: ['ooooooooooo', 'oKKooKKooKo', 'oooKKooKKoo', 'ooooooooooo'],
  // out cold, tongue lolling
  out: ['ooooooooooo', 'oKKKKKKKKoo', 'ooKLLLKoooo', 'oooKLRKoooo'],
}

// Columns of the torso in each body-space row, read off run frame 0 (where the
// chest is clear of the swinging arm).
const TORSO_SPAN = {
  4: [41, 46], 5: [39, 49], 6: [36, 50], 7: [35, 51], 8: [34, 52], 9: [33, 54], 10: [32, 55], 11: [32, 56],
  12: [31, 57], 13: [31, 57], 14: [30, 58], 15: [30, 58], 16: [30, 58], 17: [29, 58], 18: [32, 58], 19: [32, 58],
  20: [33, 58], 21: [33, 58], 22: [33, 58], 23: [33, 58], 24: [33, 58], 25: [33, 58], 26: [33, 58], 27: [33, 57],
  28: [32, 57], 29: [32, 57], 30: [32, 57], 31: [32, 56], 32: [32, 56], 33: [32, 56], 34: [32, 56], 35: [32, 56],
  36: [32, 56], 37: [32, 56], 38: [32, 56], 39: [32, 56], 40: [32, 56], 41: [32, 56], 42: [32, 56], 43: [32, 55],
  44: [32, 55], 45: [33, 55], 46: [33, 54], 47: [34, 54], 48: [35, 53], 49: [36, 52], 50: [38, 48], 51: [41, 46],
}

function buildTorso() {
  const src = RUN[0].canvas
  const t = new Canvas(BW, BH)
  for (const [row, [x0, x1]] of Object.entries(TORSO_SPAN)) {
    for (let x = x0; x <= x1; x++) t.set(x, Number(row), src.get(x, Number(row)))
  }
  // back of the head and neck, where frame 0 has the knot, the cape and the sleeve
  patch(t, 29, 17, ['_K', '__K'])
  patch(t, 30, 18, [
    '............',
    '............',
    '...K........',
    '............',
    '...r........',
    '...r........',
    '............',
    '....rrrrrrr.',
    '...KbbbbDSS.',
    '..KhhhhhDSSSom',
    '..KBBBBDSSSoomoo',
    '..KbbbbDSSSooomo',
    '..KhhhDSSSo.....',
    '..KBBBDSSSoo....',
    '..KbbbDSSSo.....',
    '..KhhhDSSSo.....',
    '..KBBBDSSSo.....',
    '..KbbbDSSSo.....',
    '..KhhhDSSS......',
  ])
  // the mask: a strap round the back of the head that flares into the goggle
  // shape at the front, lit along its top and dark on its lower and front rims
  patch(t, 33, 14, [
    '............rr',
    '...........rLL',
    '..........rLLL',
    '.........rLLLL',
    '........rLLLLL',
    '.....rrrLLLLLL',
    '...rrLLLLLLLLL',
    'rrrLLLLLLLLLLL',
    'rLLLRRRRLLLLLL',
    'rRRRRRRRRLLLLL',
    'rdddRRRRRRLLLL',
    'Krrrrrrrdddddd',
  ])
  patch(t, 46, 13, [
    'rrrrrrrrrrrK_',
    'LLLLLLLLLLRr_',
    'LRbbbbbRbbbRr',
    'RobbbbbobbbRr',
    '...........dr',
    '...........dr',
    '...........dr',
    '...........dr',
    '...........dr',
    '...........dr',
    '...........dr',
    '...........dr',
    '...........dr',
    '...........r_',
    '...........r_',
    'rddddddddddr_',
    'rrrrrrrrrrrK_',
  ])
  patch(t, 41, 26, ['rrrRRR', '...rrr', '.....r'])
  patch(t, 47, 17, EYES.normal)
  patch(t, 44, 30, MOUTH.normal)
  // the MW shield: red M over blue W on a white field, a row clear of his grin
  patch(t, 45, 34, [
    'ooooooooo',
    'oWWWWWWWo',
    'WLLWWWLLW',
    'WLLLWLLLW',
    'WLLLLLLLW',
    'WLLWLWLLW',
    'WLLWWWLLW',
    'WWWWWWWWW',
    'WUUWWWUUW',
    'WUUWUWUUW',
    'WUUUUUUUW',
    'oWUUWUUWo',
    'ooWWWWWoo',
  ])
  // the front edge, where frame 0 has the far arm
  for (let y = 31; y <= 40; y++) t.set(56, y, M.outline)
  // close the bottom edge where the legs were
  patch(t, 36, 49, ['.K', '..K'])
  return t
}

const TORSO = buildTorso()

/* ------------------------------------------------------------------ */
/* 4. Each run frame split into layers around the torso plate          */
/* ------------------------------------------------------------------ */

const RED = new Set([M.redLine, M.redDark, M.red, M.redLight])
const BLUE = new Set([M.blueLine, M.blueShade, M.blue])
const isLimb = (v) => RED.has(v) || BLUE.has(v)
const isFill = (v) => v !== 0 && !LINES.has(v)
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const N8 = [...N4, [1, 1], [-1, -1], [1, -1], [-1, 1]]

// The far fist pumps in front of him in these frames: [x from, first row, last row].
// It is cut out, because that hand holds the prep gun instead.
const FAR_FIST = {
  0: [57, 27, 42], 1: [57, 32, 43], 2: [56, 36, 45], 3: [54, 40, 47], 7: [55, 40, 46], 8: [54, 37, 47], 9: [56, 33, 43], 10: [56, 30, 41],
}

// Where the near arm swings across the chest it hides part of the shield:
// '#' marks the shield pixels (x 45..53, y 34..46) still in view.
const SHIELD_X = 45
const SHIELD_Y = 34
const SHIELD_SEEN = {
  3: ['#########', '#########', '#####...#', '######..#', '........#', '........#', '........#', '........#', '.......##', '####..###', '#########', '#########', '#########'],
  4: ['.####....', '.........', '.........', '.........', '.........', '.........', '.....####', '#########', '#########', '#########', '#########', '#########', '#########'],
  5: ['.........', '.........', '.........', '.........', '.........', '........#', '#######.#', '#########', '#########', '#########', '#########', '#########', '#########'],
  6: ['.#####...', '.........', '.........', '.........', '.........', '.........', '.........', '##..#####', '#########', '#########', '#########', '#########', '#########'],
  7: ['#########', '#########', '#########', '#########', '#####...#', '####....#', '........#', '........#', '........#', '.......##', '.......##', '#.....###', '#########'],
  8: ['#########', '#########', '#########', '#########', '#########', '#########', '#########', '...######', '...######', '...######', '...######', '...######', '..#######'],
}

/** Head and mask: always the plate's own pixels. */
const inFace = (x, y) => y <= 18 || (y <= 25 && x >= 33) || (y <= 29 && x >= 39)

/**
 * behind: what the source frame shows around the torso (cape, mask tails,
 * legs, a glove past the body's edge). over: what it shows in front of it
 * (the near arm, the cape over the shoulder, a raised thigh).
 */
function layersOf(f) {
  const src = RUN[f].canvas.clone()
  const cut = FAR_FIST[f]
  if (cut) src.rect(cut[0], cut[1], BW - cut[0], cut[2] - cut[1] + 1, 0)
  const seen = SHIELD_SEEN[f]
  const mask = new Uint8Array(BW * BH)
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      if (!TORSO.solid(x, y) || inFace(x, y)) continue
      const v = src.get(x, y)
      const sx = x - SHIELD_X
      const sy = y - SHIELD_Y
      if (sx >= 0 && sx < 9 && sy >= 0 && sy < 13) {
        if (seen && seen[sy][sx] === '.' && v) mask[y * BW + x] = 1
      } else if (isLimb(v)) mask[y * BW + x] = 1
    }
  }
  // a limb's dark outline belongs to the limb
  const lines = []
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      if (mask[y * BW + x] || !TORSO.solid(x, y) || inFace(x, y)) continue
      const v = src.get(x, y)
      if (v !== M.outline && v !== M.woodLine) continue
      if (N4.some(([dx, dy]) => mask[(y + dy) * BW + x + dx] && isFill(src.get(x + dx, y + dy)) && isLimb(src.get(x + dx, y + dy)))) lines.push(y * BW + x)
    }
  }
  for (const k of lines) mask[k] = 1
  const behind = new Canvas(BW, BH)
  const over = new Canvas(BW, BH)
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      const v = src.get(x, y)
      if (!v) continue
      if (TORSO.solid(x, y)) {
        if (!mask[y * BW + x]) continue
        // where a limb's fill meets the body with no line between, give it one
        const bare = isFill(v) && isLimb(v) && N4.some(([dx, dy]) => TORSO.solid(x + dx, y + dy) && !mask[(y + dy) * BW + x + dx] && !inFace(x + dx, y + dy))
        over.set(x, y, bare ? (RED.has(v) ? M.redLine : M.blueLine) : v)
        continue
      }
      // outside the plate: scraps of the source torso (its edge sits a pixel
      // out in some frames) are dropped
      if (isLimb(v)) behind.set(x, y, v)
      else if (LINES.has(v) && N8.some(([dx, dy]) => !TORSO.solid(x + dx, y + dy) && isLimb(src.get(x + dx, y + dy)))) behind.set(x, y, v)
    }
  }
  return { behind, over }
}

/* ------------------------------------------------------------------ */
/* 5. The stage: body space with headroom, where every pose is built   */
/* ------------------------------------------------------------------ */

// From here on all coordinates are stage coordinates: body space moved down
// by TOP rows, so a raised fist has somewhere to go.
const TOP = 12
const SW = BW
const SH = BH + TOP
const lift = (c) => c.pad(0, TOP, 0, 0)
const blank = () => new Canvas(SW, SH)
const stack = (...layers) => {
  const c = blank()
  for (const l of layers) if (l) c.blit(l, 0, 0)
  return c
}
const pick = (c, test) => {
  const o = blank()
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (c.get(x, y) && test(x, y, c.get(x, y))) o.set(x, y, c.get(x, y))
  return o
}
const shift = (c, dx, dy) => blank().blit(c, dx, dy)
const inRect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1

const PLATE = lift(TORSO)
const F = RUN.map((r, f) => {
  const l = layersOf(f)
  return { behind: lift(l.behind), over: lift(l.over), ground: r.ground + TOP }
})
// Half-size rounding leaves a flat, planted sole one pixel off the ground in
// some frames: there the body comes down to meet it. A toe or a heel a pixel
// up, and the airborne frame, are the cycle's own bounce and stay as drawn.
for (const fr of F) {
  const legs = stack(fr.behind, fr.over)
  const b = legs.bounds()
  const low = b.y + b.h - 1
  let x0 = SW
  let x1 = -1
  for (let x = 0; x < SW; x++) {
    if (!legs.solid(x, low) && !legs.solid(x, low - 1)) continue
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
  }
  if (fr.ground - 1 - low === 1 && x1 - x0 + 1 >= 10) fr.ground -= 1
}

// Parts of a run frame, for building other poses.
const LEG_ROW = 47 + TOP
/** The cape over the near shoulder: red, high on the back of the plate. */
const isCapeOver = (x, y, v) => RED.has(v) && y >= 26 + TOP && y <= 38 + TOP && x <= 41
const capeOver = (f) => pick(F[f].over, isCapeOver)
/** The near arm as the source drew it in frame f (inside the plate's outline). */
const armOver = (f) => pick(F[f].over, (x, y, v) => y < LEG_ROW && !isCapeOver(x, y, v))
/** Cape and mask tails of frame f (clean in frames 2..8, where the near arm is not in front of them). */
const capeOf = (f) => stack(pick(F[f].behind, (x, y) => x <= 33 && (y < LEG_ROW || (y <= LEG_ROW + 1 && x <= 25))), capeOver(f))
/** Just the knot and tails of the mask. */
const tailsOf = (f, x0 = 23, y1 = 28 + TOP) => pick(F[f].behind, inRect(x0, 16 + TOP, 33, y1))
/** Legs of frame f inside a rectangle (thigh tops that overlap the plate included). */
const legsOf = (f, x0, y0, x1, y1) => stack(pick(F[f].behind, (x, y) => y >= LEG_ROW && inRect(x0, y0, x1, y1)(x, y)), pick(F[f].over, (x, y) => y >= LEG_ROW && inRect(x0, y0, x1, y1)(x, y)))

/* ------------------------------------------------------------------ */
/* 6. Drawn parts: limbs, the prep gun, capes, faces, mud              */
/* ------------------------------------------------------------------ */

const G = Object.fromEntries(Object.entries(GUN).map(([k, v]) => [k, rgba(v)]))
const MUD = PAL.mud.map((c) => rgba(c))

/** Fill the pixels whose centres pass `test(x, y)` (it returns a colour or 0), on a fresh stage layer. */
function raster(test) {
  const c = blank()
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const v = test(x + 0.5, y + 0.5)
      if (v) c.set(x, y, v)
    }
  }
  return c
}

const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax
  const vy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)))
  return Math.hypot(px - ax - t * vx, py - ay - t * vy)
}

/** A round tube through the points, lit from the top-left, outlined. */
function tube(pts, r, light, dark, line) {
  const d = (x, y) => {
    let best = Infinity
    for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
    return best
  }
  return raster((x, y) => (d(x, y) > r ? 0 : d(x + 0.9, y + 0.9) > r ? dark : light)).outline(line)
}

const sleeve = (pts, r = 2.6) => tube(pts, r, M.blue, M.blueShade, M.blueLine)

/** A gloved fist: a ball lit from the top-left. */
function fist(cx, cy, r = 3.9) {
  return raster((x, y) => {
    if (Math.hypot(x - cx, y - cy) > r) return 0
    const lowRight = Math.hypot(x - cx + 1.3, y - cy + 1.3)
    return lowRight > r + 0.9 ? M.redDark : lowRight > r - 0.2 ? M.red : M.redLight
  }).outline(M.redLine)
}

/**
 * An arm with nothing in its hand, the way the client drew them: a blue sleeve
 * to the elbow, then the long red glove, ending in a fist.
 * pts: shoulder, (elbow,) hand. `glove` is the share of the arm the glove covers.
 */
function arm(pts, { r = 2.6, glove = 0.5, fistR = 3.9 } = {}) {
  const lens = []
  let total = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    lens.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]))
    total += lens[i]
  }
  // the point where the glove starts, and the path on either side of it
  let left = total * (1 - glove)
  const upper = [pts[0]]
  let lower = null
  for (let i = 0; i + 1 < pts.length; i++) {
    if (lower) lower.push(pts[i + 1])
    else if (left > lens[i]) {
      left -= lens[i]
      upper.push(pts[i + 1])
    } else {
      const t = left / (lens[i] || 1)
      const cut = [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]
      upper.push(cut)
      lower = [cut, pts[i + 1]]
    }
  }
  const [hx, hy] = pts[pts.length - 1]
  // the glove is a little wider than the sleeve it is pulled over
  return stack(sleeve(upper, r), tube(lower, r + 0.4, M.redLight, M.red, M.redLine), fist(hx, hy, fistR))
}

/* The prep gun: a pressure-washer trigger gun on a steel lance with a brass
 * nozzle, fed by a hose. A wand is its pixels plus three points in them:
 * `muzzle`, the middle of the nozzle's open face (where the water leaves),
 * `grip`, where the fist that holds it goes, and `hose`, where the hose leaves
 * the handle. Nothing is ever drawn in front of the muzzle. */
const GLEG = { J: G.outline, g: G.body, l: G.light, s: G.shine, x: G.dark, p: G.grip, q: G.gripDark, Y: G.tip, y: G.tipLight, z: G.tipDark }
/** The gun aimed level, to the right. `lance` is the length of the bare lance. */
function wandLevel(lance = 7) {
  const bar = (ch) => ch.repeat(lance)
  const gap = '.'.repeat(lance)
  const rows = [
    `.JJJJ.${gap}....`,
    `JslllJ${gap}.JJJ`,
    `JgggggJ${bar('J')}yyy`,
    `Jgggxx${bar('l')}JYYY`,
    `JxxxxJ${bar('J')}JYYY`,
    `.JpqJ.${gap}Jzzz`,
    `.JpqJ.${gap}.JJJ`,
    `.JpqJ.${gap}....`,
    `..JJ..${gap}....`,
  ]
  return { canvas: Canvas.fromText(rows, GLEG), muzzle: [lance + 10, 4], grip: [3, 6.5], hose: [3, 9] }
}
const WAND_LEVEL = wandLevel()

/**
 * The same gun aimed 45 degrees up. It is built on the diagonal lattice, so the
 * lance is an even staircase: U counts half-diagonals back from the nozzle's
 * face, V across the gun (positive is its underside).
 */
function wandDiagonal() {
  const S = 24
  const LX = S - 3
  const LY = 2
  const A = LX - LY
  const C = LX + LY
  const fill = new Canvas(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const U = A - (x - y)
      const V = x + y - C
      let v = 0
      if (U < 0) continue
      if (U <= 4 && Math.abs(V) <= 2) v = V < 0 ? G.tipLight : V === 2 ? G.tipDark : G.tip
      else if (U === 5 && Math.abs(V) <= 3) v = G.outline
      else if (U >= 6 && U <= 16 && (V === 0 || V === 1)) v = V === 0 ? G.light : G.dark
      else if (U >= 17 && U <= 24 && V >= -3 && V <= 1) v = V <= -2 ? G.light : V >= 1 ? G.dark : G.body
      else if (U >= 19 && U <= 22 && V >= 2 && V <= 8) v = U <= 20 ? G.gripDark : G.grip
      if (v) fill.set(x, y, v)
    }
  }
  const c = fill.clone().outline(G.outline)
  c.map((v, x, y) => (fill.solid(x, y) || A - (x - y) >= 0 ? v : 0))
  const at = (U, V) => [(A - U + C + V) / 2 + 0.5, (C + V - A + U) / 2 + 0.5]
  return { canvas: c, muzzle: [LX + 1, LY], grip: at(20.5, 5), hose: at(20.5, 9) }
}

/** A wand turned clockwise by quarter turns, its points carried along. */
function turned(w, turns) {
  let { canvas, muzzle, grip, hose: hosePt } = w
  for (let i = 0; i < turns; i++) {
    const h = canvas.h
    const t = ([x, y]) => [h - y, x]
    muzzle = t(muzzle)
    grip = t(grip)
    hosePt = t(hosePt)
    canvas = canvas.rot90(1)
  }
  return { canvas, muzzle, grip, hose: hosePt }
}

const WAND_UP = wandDiagonal()
const WAND = { fwd: WAND_LEVEL, up: WAND_UP, carry: turned(WAND_UP, 1), down: turned(WAND_LEVEL, 1) }

/** The hose: from the gun's handle, sagging, to (hx, hy). */
function hose([x0, y0], [hx, hy]) {
  const c = blank()
  const cx = (x0 + hx) / 2 + 1
  const cy = Math.max(y0, hy) + 4
  let px = x0
  let py = y0
  for (let i = 1; i <= 12; i++) {
    const t = i / 12
    const x = (1 - t) * (1 - t) * x0 + 2 * t * (1 - t) * cx + t * t * hx
    const y = (1 - t) * (1 - t) * y0 + 2 * t * (1 - t) * cy + t * t * hy
    c.line(Math.floor(px), Math.floor(py), Math.floor(x), Math.floor(y), G.hose)
    px = x
    py = y
  }
  // a dark edge on its lower right, so it shows on a light sky and a dark wall alike
  const shade = []
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (c.solid(x, y)) shade.push([x + 1, y], [x, y + 1])
  for (const [x, y] of shade) if (!c.solid(x, y)) c.set(x, y, G.outline)
  return c
}

// His far arm is a shade darker than the near one, so the near glove reads
// when it swings across in front of the fist on the gun.
const FAR_TINT = new Map([[M.redLight, M.red], [M.red, M.redShade], [M.blue, M.blueShade], [M.blueShade, M.blueDark]])

/**
 * One arm holding the gun, its muzzle at stage point `at`: hose, arm from the
 * shoulder, gun, fist on the grip. far: his far arm (a plain sleeve, darker);
 * otherwise the near arm, gloved to the elbow.
 */
function gunArm({ wand, at, shoulder, elbow, hoseTo, far = false }) {
  const ox = at[0] - wand.muzzle[0]
  const oy = at[1] - wand.muzzle[1]
  if (!Number.isInteger(ox) || !Number.isInteger(oy)) throw new Error('gunArm: the muzzle must land on whole pixels')
  const hand = [ox + wand.grip[0], oy + wand.grip[1]]
  const path = elbow ? [shoulder, elbow, hand] : [shoulder, hand]
  const limb = far ? sleeve(path) : arm(path, { fistR: 3.6 })
  const grip = fist(hand[0], hand[1], 3.6)
  if (far) for (const c of [limb, grip]) c.swap(FAR_TINT)
  // the fist goes on last, over the grip
  return stack(hoseTo && hose([ox + wand.hose[0], oy + wand.hose[1]], hoseTo), limb, blank().blit(wand.canvas, ox, oy), grip)
}

/** The contract's MUZZLE, read from the contract itself so the art cannot drift from it. */
function readMuzzle() {
  const text = fs.readFileSync(path.join(GAME_DIR, 'game', 'contract.ts'), 'utf8')
  const block = /export const MUZZLE = \{([\s\S]*?)\} as const/.exec(text)
  if (!block) throw new Error('MUZZLE not found in contract.ts')
  const out = {}
  for (const m of block[1].matchAll(/(\w+):\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+)\s*\}/g)) out[m[1]] = { x: Number(m[2]), y: Number(m[3]) }
  if (!out.fwd || !out.up || !out.down) throw new Error('MUZZLE in contract.ts has changed shape')
  return out
}
const MUZZLE = readMuzzle()

// His far arm comes out from behind the body and always holds the gun: low
// and ready while he runs, levelled or raised when he sprays. The whole arm is
// placed by the muzzle, so the nozzle sits on MUZZLE whatever the body does.
const FAR_SHOULDER = [53, 37 + TOP]
const FAR_HIP = [54, 50 + TOP]
const NEAR_SHOULDER = [37, 34 + TOP]
/**
 * Muzzle point of the carried gun, from the anchor (not part of the contract):
 * chosen so the fist stays where it is when he levels the gun to spray.
 */
const CARRY = {
  x: Math.round(MUZZLE.fwd.x - WAND.fwd.muzzle[0] + WAND.fwd.grip[0] + WAND.carry.muzzle[0] - WAND.carry.grip[0]),
  y: Math.round(MUZZLE.fwd.y - WAND.fwd.muzzle[1] + WAND.fwd.grip[1] + WAND.carry.muzzle[1] - WAND.carry.grip[1]),
}

function farArm(aim, ground) {
  const p = aim === 'carry' ? CARRY : MUZZLE[aim]
  return gunArm({ wand: WAND[aim], at: [AX + p.x, ground + p.y], shoulder: FAR_SHOULDER, hoseTo: FAR_HIP, far: true })
}

/** A cape from polygons: the whole shape, then its shaded underside. */
function cape(shape, shade) {
  const c = blank().poly(shape, M.redLight)
  if (shade) {
    const s = blank().poly(shade, M.redDark)
    const rim = s.clone().outline(M.red)
    c.blit(rim, 0, 0, { mode: 'atop' })
  }
  // the outline goes on the inside, so the shape stays the size it was drawn
  const edge = []
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (c.solid(x, y) && N4.some(([dx, dy]) => !c.solid(x + dx, y + dy))) edge.push([x, y])
  for (const [x, y] of edge) c.set(x, y, M.redLine)
  return c
}

/** Lean a pose: rows above the pivot slide by `slope` px per row (positive = forward). */
function lean(c, pivot, slope) {
  const o = blank()
  for (let y = 0; y < SH; y++) {
    const dx = Math.round((pivot - y) * slope)
    for (let x = 0; x < SW; x++) if (c.get(x, y)) o.set(x + dx, y, c.get(x, y))
  }
  return o
}

// Faces: the plate with the eyes and the mouth redrawn.
const face = (eyes, mouth) => {
  const c = PLATE.clone()
  patch(c, 47, 17 + TOP, EYES[eyes])
  patch(c, 44, 30 + TOP, MOUTH[mouth])
  return c
}
const FACE = {
  normal: PLATE,
  blink: face('blink', 'normal'),
  happy: face('happy', 'happy'),
  hurt: face('hurt', 'hurt'),
  shock: face('shock', 'shock'),
  grit: face('normal', 'hurt'),
  dizzyA: face('dizzyA', 'dizzy'),
  dizzyB: face('dizzyB', 'dizzy'),
  out: face('dizzyB', 'out'),
}

/** A lump of mud: a few overlapping blobs, lit from the top-left. rnd is a seeded generator. */
function mudSplat(cx, cy, r, rnd, drips = 1) {
  const blobs = [[cx, cy, r]]
  for (let i = 0; i < 4; i++) blobs.push([cx + (rnd() - 0.5) * r * 2.2, cy + (rnd() - 0.5) * r * 1.6, r * (0.35 + rnd() * 0.4)])
  const inside = (x, y) => blobs.some(([bx, by, br]) => Math.hypot(x - bx, y - by) <= br)
  const c = raster((x, y) => {
    if (!inside(x, y)) return 0
    // wet mud: a dark rim all round, a thin shine along the top-left
    if (!inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1)) return MUD[0]
    if (!inside(x + 1.5, y + 1.5)) return MUD[1]
    return inside(x - 1.5, y - 1.5) ? MUD[2] : MUD[3]
  })
  for (let i = 0; i < drips; i++) {
    const dx = Math.round(cx + (rnd() - 0.5) * r * 1.4)
    const len = 2 + Math.floor(rnd() * 4)
    c.rect(dx, Math.round(cy), 1, Math.round(r) + len, MUD[1])
    c.set(dx, Math.round(cy) + Math.round(r) + len, MUD[0])
  }
  return c
}

function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* 7. The poses                                                        */
/* ------------------------------------------------------------------ */

// Every body colour that may touch the open air must be a line colour.
const SEAL = new Map([
  [M.redDark, M.redLine], [M.redShade, M.redLine], [M.red, M.redLine], [M.redLight, M.redLine],
  [M.blueDark, M.blueLine], [M.blueShade, M.blueLine], [M.blue, M.blueLine],
  [M.woodDark, M.outline], [M.woodShade, M.outline], [M.woodMid, M.outline], [M.woodLight, M.outline],
  [M.bristleShade, M.outline], [M.bristle, M.outline], [M.bristleLight, M.outline], [M.white, M.outline], [M.whiteShade, M.outline],
  [M.woodLine, M.outline],
])

/** Last pass on a finished pose: fill pinholes between layers, close the outline, drop specks. */
function seal(src) {
  const c = src.clone()
  // pinholes: empty pixels shut in on all four sides take a neighbour's colour
  for (let y = 1; y < c.h - 1; y++) {
    for (let x = 1; x < c.w - 1; x++) {
      if (c.get(x, y) || !N4.every(([dx, dy]) => c.solid(x + dx, y + dy))) continue
      const fills = N4.map(([dx, dy]) => c.get(x + dx, y + dy)).filter((v) => !LINES.has(v))
      c.set(x, y, fills[0] ?? c.get(x - 1, y))
    }
  }
  const o = c.clone()
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const v = c.get(x, y)
      if (!v) continue
      if (!N8.some(([dx, dy]) => c.solid(x + dx, y + dy))) o.set(x, y, 0)
      else if (SEAL.has(v) && N4.some(([dx, dy]) => !c.solid(x + dx, y + dy))) o.set(x, y, SEAL.get(v))
    }
  }
  return o
}

/** A pose: its pixels on the stage and the stage row of the ground under his feet. */
const pose = (canvas, ground) => ({ canvas: seal(canvas), ground })

/** A finished pose with the gun arm added behind it. */
function withGun(layers, ground, aim) {
  const c = stack(...layers)
  if (aim) c.blit(farArm(aim, ground), 0, 0, { mode: 'behind' })
  return pose(c, ground)
}

// run: the source cycle, his far hand carrying the gun low
const runLayers = (f) => [F[f].behind, PLATE, F[f].over]
const RUN_ANIM = (aim) => F.map((fr, f) => withGun(runLayers(f), fr.ground, aim))

// standing legs: the planted leg of run frame 1, twice
// (its thigh is run up a few rows so it always reaches in behind the body)
const STAND_LEG = (() => {
  const leg = legsOf(1, 44, 50 + TOP, 58, 65 + TOP)
  const b = leg.bounds()
  for (let y = b.y - 1; y >= b.y - 4; y--) for (let x = b.x; x < b.x + b.w; x++) leg.set(x, y, leg.get(x, b.y + 1) || leg.get(x, b.y))
  return leg
})()
const STAND_GROUND = F[1].ground
const standLegs = (spread = 0) => stack(shift(STAND_LEG, 1 + spread, -1), shift(STAND_LEG, -8 - spread, 0))

// capes drawn for the poses the run cycle has no cape for
const CAPE_HANG = [
  cape([[36, 40], [31, 40], [28, 45], [26, 53], [24, 61], [23, 67], [26, 66], [28, 68], [31, 66], [34, 68], [36, 65]], [[33, 45], [30, 54], [29, 64], [34, 65], [35, 47]]),
  cape([[36, 40], [31, 40], [28, 45], [25, 53], [23, 61], [22, 66], [25, 66], [27, 68], [30, 66], [33, 68], [36, 65]], [[33, 45], [30, 54], [28, 64], [34, 65], [35, 47]]),
]
const CAPE_UP = [
  cape([[37, 46], [31, 48], [22, 47], [13, 43], [6, 36], [11, 37], [9, 29], [16, 34], [20, 29], [26, 37], [33, 40], [37, 42]], [[34, 46], [27, 46], [19, 44], [12, 39], [17, 40], [25, 42], [33, 43]]),
  cape([[37, 46], [31, 48], [22, 48], [12, 45], [4, 39], [10, 39], [7, 31], [14, 35], [18, 29], [25, 37], [33, 40], [37, 42]], [[34, 46], [27, 47], [18, 46], [10, 41], [16, 41], [25, 43], [33, 43]]),
]
/** Trailing down behind him as he rises. */
const CAPE_DOWN = cape([[37, 42], [31, 41], [23, 43], [15, 48], [8, 56], [13, 55], [11, 63], [17, 58], [21, 64], [26, 55], [32, 50], [37, 47]], [[35, 46], [29, 49], [24, 54], [21, 60], [18, 56], [23, 50], [30, 46]])

const TAILS = tailsOf(2)
const ARM_SIDE = stack(armOver(2), pick(F[2].behind, inRect(29, 37 + TOP, 31, 46 + TOP)))
const ARM_CROSS = stack(armOver(5), pick(F[5].behind, inRect(57, 28 + TOP, 70, 40 + TOP)))
/** The near arm thrown up, the fist against the pale bristles of his head where a red glove shows. */
const armUp = (reach = 0) => arm([NEAR_SHOULDER, [35, 38 - reach], [34 + reach, 27 - 2 * reach]], { glove: 0.55 })
/** The near arm flung out behind him. */
const armOut = (drop = 0) => arm([NEAR_SHOULDER, [31, 47 + drop], [25, 44 + 3 * drop]])

// idle: breathing stand, then a blink
function idle(aim, n) {
  const breath = n === 1 ? 1 : 0
  const upper = stack(n === 2 ? FACE.blink : PLATE, ARM_SIDE, capeOver(2))
  const c = stack(CAPE_HANG[breath], shift(TAILS, 0, breath), standLegs(), shift(upper, 0, breath))
  c.blit(farArm(aim, STAND_GROUND), 0, 0, { mode: 'behind' })
  return pose(c, STAND_GROUND)
}

// jump: knees tucked, near fist driving forward, cape trailing below him
const JUMP_LEGS = legsOf(3, 28, 47 + TOP, 56, 68 + TOP)
const jump = (aim) => withGun([CAPE_DOWN, TAILS, JUMP_LEGS, PLATE, ARM_CROSS], F[3].ground, aim)

// fall: legs loose, near arm thrown up, cape lifting
const FALL_LEGS = legsOf(4, 20, 47 + TOP, 60, 68 + TOP)
const fall = (aim) => withGun([CAPE_UP[0], shift(TAILS, 0, -1), FALL_LEGS, PLATE, armUp()], F[4].ground, aim)

// skid: heels dug in ahead of him, body thrown back, teeth gritted
function skid() {
  const g = STAND_GROUND
  const upper = stack(capeOf(8), FACE.grit, capeOver(8), ARM_CROSS)
  upper.blit(farArm('carry', g), 0, 0, { mode: 'behind' })
  const legs = lean(stack(shift(STAND_LEG, 1, -1), shift(STAND_LEG, -6, 0)), g, -0.3)
  return pose(shift(stack(legs, shift(upper, -4, 1)), 3, 0), g)
}

// hurt: knocked back off his feet, eyes screwed shut
function hurt(n) {
  const g = F[9].ground
  const legs = legsOf(9, 26, 47 + TOP, 58, 68 + TOP)
  const upper = stack(capeOf(7), FACE.hurt, capeOver(7), armUp(n))
  upper.blit(farArm('carry', g), 0, 0, { mode: 'behind' })
  return pose(stack(shift(legs, 1 + n, -1), shift(upper, -2 - n, -1 - n)), g)
}

// win: a crouch, then a fist pump with the gun in the air, then a hop
function win(n) {
  const g = STAND_GROUND
  if (n === 0) {
    const upper = stack(PLATE, ARM_SIDE, capeOver(2))
    const c = stack(CAPE_HANG[0], shift(TAILS, 0, 2), standLegs(1), shift(upper, 0, 2))
    c.blit(farArm('carry', g + 2), 0, 0, { mode: 'behind' })
    return pose(c, g)
  }
  const up = n === 2 ? 4 : 0
  const c = stack(CAPE_HANG[n - 1], TAILS, standLegs(n === 2 ? 0 : 1), FACE.happy, armUp(1))
  c.blit(farArm('up', g), 0, 0, { mode: 'behind' })
  return pose(shift(c, 0, -up), g)
}

// sprayDown: riding the jet like a pogo stick. His near arm reaches down past
// the shield to hold the gun under him, legs kicking either side of the lance
function sprayDown(n) {
  const g = STAND_GROUND + 1
  const legs = legsOf(n ? 0 : 5, 18, 47 + TOP, 70, 68 + TOP)
  const body = stack(CAPE_UP[n], shift(TAILS, 0, -1), legs, PLATE)
  const at = [AX + MUZZLE.down.x, g + MUZZLE.down.y]
  body.blit(gunArm({ wand: WAND.down, at, shoulder: NEAR_SHOULDER, elbow: [36, 55] }), 0, 0)
  return pose(body, g)
}

// grimed: splattered and wide-eyed, a dizzy stagger, then his feet go from
// under him and he lands flat on his back in a puddle
function grimed(n) {
  const g = STAND_GROUND
  const rnd = seeded(77)
  const mud = blank()
  for (const [x, y, r] of [[37, 21, 4.5], [53, 53, 3.6], [40, 58, 4.6], [35, 36, 3], [33, 47, 3.2], [48, 73, 3], [27, 58, 3.4], [61, 66, 2.6], [41, 44, 2.4]]) mud.blit(mudSplat(x, y, r, rnd, 2), 0, 0)
  const muddy = (c) => c.blit(mud, 0, 0, { mode: 'atop' })
  if (n <= 2) {
    // 0 the splat, 1 staggering back, 2 staggering forward
    const face = [FACE.shock, FACE.dizzyA, FACE.dizzyB][n]
    const near = [armOut(), armUp(), armOut(1)][n]
    const sway = [0, -2, 2][n]
    const upper = stack(shift(CAPE_HANG[n === 1 ? 1 : 0], 0, 0), TAILS, face, near)
    upper.blit(farArm('carry', g), 0, 0, { mode: 'behind' })
    const legs = n === 1 ? stack(shift(STAND_LEG, 3, -1), shift(STAND_LEG, -6, 0)) : n === 2 ? stack(shift(STAND_LEG, -1, -1), shift(STAND_LEG, -11, 0)) : standLegs(1)
    return pose(muddy(stack(legs, shift(upper, sway, 0))), g)
  }
  // 3 feet in the air, 4 flat out: the figure built standing, limbs spread,
  // then turned onto his back (head to the left, face to the sky)
  const flat = n === 4
  const legs = flat ? standLegs(1) : stack(shift(STAND_LEG, 4, -3), shift(STAND_LEG, -8, 0))
  const stand = muddy(stack(CAPE_HANG[0], TAILS, legs, flat ? FACE.out : FACE.dizzyA, flat ? armOut(1) : armUp()))
  const t = seal(stand).trim().canvas.rot90(-1)
  const c = blank()
  const x0 = AX - Math.round(t.w / 2) - 2
  if (flat) {
    // the puddle he lands in
    const rx = Math.round(t.w / 2) + 3
    c.ellipse(x0 + t.w / 2, g - 2, rx, 2, MUD[2])
    c.rect(x0 + Math.round(t.w / 2) - rx + 3, g - 3, 2 * rx - 6, 1, MUD[3])
    c.outline(MUD[0])
    c.rect(0, g, SW, SH - g, 0)
  }
  c.blit(t, x0, g - t.h - (flat ? 1 : 9))
  return { canvas: c, ground: g }
}

/* ------------------------------------------------------------------ */
/* 8. Small pieces: map sprite, face icon, gun, grime overlays         */
/* ------------------------------------------------------------------ */

const SLEG = { ...LEG, g: G.body, l: G.light, x: G.dark, Y: G.tip, J: G.outline, H: G.hose }
const small = (rows) => Canvas.fromText(rows, SLEG)

// The world-map Maxx, 28 px tall, drawn by hand: the 64 px figure does not survive another halving.
const MAP_BODY = [
  '..........KKKKK.........',
  '........KKBBbBoKK.......',
  '.......KBBbBBboooK......',
  '......KBbBBbhSooooK.....',
  '......KBBbhhSooooooK....',
  '......KhhhSSrrrrrrrrK...',
  '....rrKSSrrLLLLLLLLdr...',
  '...rLLrrrLLLLWWWLWWdr...',
  '....rLLLLLLLWWWKWKWdr...',
  '...rLrrRRRRLWWWKWKWdr...',
  '....r.KbrrddRWWWdWVdr...',
  '......KbSorrrrrrrrrrK...',
  '......KbSooKWWWKKKoK....',
  '......KbSooWWWWWWWoK....',
  '......KbSooWLWWWLWoK....',
  '......KbSooWLLWLLWoK....',
  '......KbSooWLWLWLWoK....',
  '......KbSooWUWUWUWoK....',
  '......KbSooWUWUWUWoK....',
  '......KbSooWWUWUWWoK....',
  '.......KSSooWWWWWoK.....',
  '.......KKSoooooooKK.....',
  '.........KKKKKKKK.......',
]
const MAP_CAPE = [
  ['.....r', '....rL', '...rLL', '..rLLd', '.rLLdd', '.rLddr', 'rLLdr.', 'rrrr..'],
  ['.....r', '....rL', '..rrLL', '.rLLLd', 'rLLLdd', 'rrLddr', '.rrdr.', '...r..'],
]
// near arm: swung back, hanging, swung forward (rows 12..17 of the body grid, from column 3)
const MAP_ARM = [
  ['...nUn....', '..nUUn....', '.nUUn.....', 'rLLr......', 'rLLr......', '.rr.......'],
  ['....nUn...', '....nUn...', '....nUn...', '...rLLr...', '...rLLr...', '....rr....'],
  ['....nUn...', '....nUUn..', '.....nUUr.', '......rLLr', '......rLLr', '.......rr.'],
]
const MAP_GUN = ['.rr.......', 'reeJJJJJJ.', 'reRllllJYY', '.rrJJJJJYY']
// legs: rows 22..27 of the body grid, from column 4 (the first row sits behind the body)
const MAP_LEGS = [
  ['....nUUn..nUUn....', '....nUUn..nUUn....', '...rLLr....rLLr...', '..rLLr.....rLLrr..', '.rLLLr.....rLLLLr.', '.rrrrr.....rrrrrr.'],
  ['.....nUUnnUUn.....', '.....nUUnnUUn.....', '.....rLLrrLLr.....', '.....rLLrrLLrr....', '.....rLLLrLLLLr...', '.....rrrrrrrrrr...'],
  ['.....nUUn.nUUn....', '.....nUUn.nUUn....', '....rLLr...rLLr...', '...rLLr....rLLrr..', '..rLLLr....rLLLLr.', '..rrrrr....rrrrrr.'],
]

/** legs 0 stride, 1 together, 2 short stride; arm 0 back, 1 down, 2 forward; up: the body lifted a pixel mid-step. */
function mapFrame(legs, armPose, capePose, up = 0, blink = false) {
  const c = new Canvas(32, 30)
  const y0 = 1 - up
  c.blit(small(MAP_CAPE[capePose]), 3, y0 + 11)
  c.blit(small(MAP_LEGS[legs]), 7, 23)
  c.blit(small(MAP_GUN), 22, y0 + 14)
  const body = small(MAP_BODY)
  if (blink) patch(body, 12, 7, ['LbbbLbb', 'bbbbbbb', 'KKKKbKK', 'RooodoV'])
  c.blit(body, 3, y0)
  c.blit(small(MAP_ARM[armPose]), 6, y0 + 12)
  return c
}

// The face for the lives counter, 16 x 16.
const HEAD = small([
  '.....KKKKKK.....',
  '...KKBBbBBoKK...',
  '..KBBbBBbooooK..',
  '.KBbBBbhSoooooK.',
  '.KbBhhSrrrrrrrrK',
  'KhhSSrrLLLLLLLdr',
  'rrSrrLLLWWWLWWdr',
  'rLrLLLLWWWKWKWdr',
  '.rLLRRLWWWKWKWdr',
  'rLrrdddRWWWdWVdr',
  '.r.KbrrrrrrrrrrK',
  '...KbSoKKKKKKooK',
  '...KbSooKWWWVKoK',
  '...KbSoooKKKKooK',
  '....KSoooooooKK.',
  '.....KKKKKKKK...',
])

/** The gun on its own, for pickups and menus. */
function gunAlone() {
  const c = new Canvas(19, 14)
  c.blit(WAND_LEVEL.canvas, 1, 0)
  c.blit(small(['.J', 'JH', 'JH.', '.JH', '..J']), 3, 9, { mode: 'behind' })
  return c.trim().canvas
}

/* ------------------------------------------------------------------ */
/* 9. The atlas                                                        */
/* ------------------------------------------------------------------ */

const anims = {
  run: RUN_ANIM('carry'),
  idle: [idle('carry', 0), idle('carry', 1), idle('carry', 2)],
  jump: [jump('carry')],
  fall: [fall('carry')],
  skid: [skid()],
  hurt: [hurt(0), hurt(1)],
  grimed: [grimed(0), grimed(1), grimed(2), grimed(3), grimed(4)],
  win: [win(0), win(1), win(2)],
  sprayRun: RUN_ANIM('fwd'),
  sprayIdle: [idle('fwd', 0), idle('fwd', 1)],
  sprayJump: [jump('fwd')],
  sprayFall: [fall('fwd')],
  sprayUpRun: RUN_ANIM('up'),
  sprayUpIdle: [idle('up', 0), idle('up', 1)],
  sprayUpJump: [jump('up')],
  sprayUpFall: [fall('up')],
  sprayDown: [sprayDown(0), sprayDown(1)],
}
/** Play orders that are not simply frame 0, 1, 2 ... */
const ORDER = { idle: [0, 1, 0, 2], win: [0, 1, 2, 1] }

// One cell for every body frame, so the renderer and the grime overlays can
// treat them alike: find the room the poses need around the anchor.
const ext = { l: 0, r: 0, u: 0, d: 0 }
for (const frames of Object.values(anims)) {
  for (const p of frames) {
    const b = p.canvas.bounds()
    ext.l = Math.max(ext.l, AX - b.x)
    ext.r = Math.max(ext.r, b.x + b.w - AX)
    ext.u = Math.max(ext.u, p.ground - b.y)
    ext.d = Math.max(ext.d, b.y + b.h - p.ground)
  }
}
const CELL = { w: ext.l + ext.r + 2, h: ext.u + ext.d + 2, ax: ext.l + 1, ay: ext.u + 1 }
const cellOf = (p) => p.canvas.crop(AX - CELL.ax, p.ground - CELL.ay, CELL.w, CELL.h)

/**
 * Mud for the renderer to lay over any body frame with source-atop: `onBody`
 * splats where the torso always is, `around` more where limbs and cape pass.
 * The eyes and the gun hand are left clean so both stay readable, and no splat
 * lands square on the MW shield (their edges may lap over it).
 */
function grimeOverlay(seed, onBody, around) {
  const rnd = seeded(seed)
  const c = blank()
  const g = STAND_GROUND
  const eyes = (x, y, r) => x > AX - 1 - r && x < AX + 15 + r && y > g - 52 - r && y < g - 37 + r
  const shield = (x, y, r) => x > AX - 2 - r / 2 && x < AX + 10 + r / 2 && y > g - 35 - r / 2 && y < g - 17 + r / 2
  const clear = (x, y, r) => eyes(x, y, r) || shield(x, y, r) || x > AX + 15 - r
  const place = (n, x0, x1, y0, y1) => {
    for (let placed = 0; placed < n; ) {
      const x = x0 + rnd() * (x1 - x0)
      const y = y0 + rnd() * (y1 - y0)
      const r = 2.4 + rnd() * 2.8
      if (clear(x, y, r)) continue
      c.blit(mudSplat(x, y, r, rnd, rnd() < 0.5 ? 1 : 0), 0, 0)
      placed++
    }
  }
  place(onBody, AX - 13, AX + 12, g - 62, g - 16)
  place(around, AX - 36, AX + 14, g - 44, g - 2)
  return cellOf({ canvas: c, ground: g })
}

const atlas = new Atlas('maxx', { script: 'art-maxx.mjs' })
/** name -> [{ label, canvas, ax, ay }], kept for the review sheets. */
const shown = {}
for (const [name, frames] of Object.entries(anims)) {
  const cells = frames.map((p, i) => ({ label: `${name}${i}`, canvas: cellOf(p), ax: CELL.ax, ay: CELL.ay }))
  for (const c of cells) atlas.add(c.label, c.canvas, { ax: c.ax, ay: c.ay })
  const order = ORDER[name] ?? cells.map((_, i) => i)
  atlas.anim(name, order.map((i) => cells[i].label))
  shown[name] = order.map((i) => cells[i])
}

const MAP_ANCHOR = { ax: 16, ay: 29 }
const mapWalk = [mapFrame(0, 0, 0, 0), mapFrame(1, 1, 1, 1), mapFrame(2, 2, 0, 0), mapFrame(1, 1, 1, 1)]
const mapIdle = [mapFrame(1, 1, 1, 0), mapFrame(1, 1, 1, 0, true)]
shown.mapWalk = mapWalk.map((canvas, i) => ({ label: `mapWalk${i}`, canvas, ...MAP_ANCHOR }))
shown.mapIdle = mapIdle.map((canvas, i) => ({ label: `mapIdle${i}`, canvas, ...MAP_ANCHOR }))
for (const name of ['mapWalk', 'mapIdle']) {
  for (const c of shown[name]) atlas.add(c.label, c.canvas, { ax: c.ax, ay: c.ay })
  atlas.anim(name, shown[name].map((c) => c.label))
}

const GUN_ALONE = gunAlone()
const singles = [
  { label: 'head', canvas: HEAD, ax: 0, ay: 0 },
  { label: 'gun', canvas: GUN_ALONE, ax: Math.floor(GUN_ALONE.w / 2), ay: Math.floor(GUN_ALONE.h / 2) },
  { label: 'grime1', canvas: grimeOverlay(11, 4, 3), ax: CELL.ax, ay: CELL.ay },
  { label: 'grime2', canvas: grimeOverlay(23, 9, 7), ax: CELL.ax, ay: CELL.ay },
]
for (const c of singles) atlas.add(c.label, c.canvas, { ax: c.ax, ay: c.ay })

// Where the nozzle really is in the finished frames, measured from the pixels.
const TIP = new Set([G.tip, G.tipLight, G.tipDark])
function muzzleOf(cell, aim) {
  let pts = []
  for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) if (TIP.has(cell.get(x, y))) pts.push([x, y])
  if (!pts.length) return null
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  if (aim === 'fwd') return { x: Math.max(...xs) + 1 - CELL.ax, y: (Math.min(...ys) + Math.max(...ys) + 1) / 2 - CELL.ay }
  if (aim === 'down') return { x: (Math.min(...xs) + Math.max(...xs) + 1) / 2 - CELL.ax, y: Math.max(...ys) + 1 - CELL.ay }
  // up: the nozzle's front face runs across the 45 degree aim; its pixels all
  // lead by the same amount, and the muzzle is the middle of their leading corners
  const lead = Math.max(...pts.map((p) => p[0] - p[1]))
  pts = pts.filter((p) => p[0] - p[1] === lead)
  return { x: pts.reduce((s, p) => s + p[0] + 1, 0) / pts.length - CELL.ax, y: pts.reduce((s, p) => s + p[1], 0) / pts.length - CELL.ay }
}
const achieved = {}
for (const [aim, names] of Object.entries({ fwd: ['sprayRun', 'sprayIdle', 'sprayJump', 'sprayFall'], up: ['sprayUpRun', 'sprayUpIdle', 'sprayUpJump', 'sprayUpFall'], down: ['sprayDown'] })) {
  for (const name of names) {
    for (const c of shown[name]) {
      const m = muzzleOf(c.canvas, aim)
      if (!m || m.x !== MUZZLE[aim].x || m.y !== MUZZLE[aim].y) throw new Error(`${c.label}: nozzle at ${JSON.stringify(m)}, contract says ${JSON.stringify(MUZZLE[aim])}`)
      achieved[aim] = m
    }
  }
}

atlas.meta({
  cell: CELL,
  anchor: 'Every body frame is one cell with the same anchor: the middle of his feet on the ground line. ay is the first row of ground, his soles are on row ay - 1. Draw at (player.x + MAXX_W / 2, player.y + MAXX_H).',
  muzzle: achieved,
  muzzleNote: 'Nozzle tip measured in the finished frames, from the anchor, facing right. fwd: middle of the nozzle front face. up: leading corner of the nozzle. down: middle of the nozzle bottom face.',
  carry: { x: CARRY.x, y: CARRY.y },
  bob: { min: Math.min(...F.map((f) => f.ground)) - TOP - 18, max: Math.max(...F.map((f) => f.ground)) - TOP - 18 },
  bobNote: 'Height of his eye line above the ground through the run cycle, in px: the only movement of the body between run frames.',
  map: { ...MAP_ANCHOR, tall: 28 },
  head: { w: HEAD.w, h: HEAD.h },
  grime: 'grime1 (light) and grime2 (heavy) are cell-sized with the cell anchor: draw the body frame, then the overlay with source-atop.',
  icons: 'head is anchored at its top-left, gun at its middle.',
  // measured on the source cycle: the planted foot slides back about 7 px a frame
  runCyclePx: 78,
  runStride: 7,
  runNote: 'One loop of the 11 run frames covers about 78 px of ground (runStride: 7 px of running per frame) if the feet are not to skate. run, sprayRun and sprayUpRun share frame indices, so keep the index when the gun comes up mid-stride.',
  feet: Object.fromEntries(['run', 'jump', 'fall', 'hurt', 'win', 'grimed', 'sprayDown'].map((n) => [n, shown[n].map((c) => CELL.ay - 1 - (c.canvas.bounds().y + c.canvas.bounds().h - 1))])),
  feetNote: 'Rows of air under his lowest pixel in each frame of an animation (in play order). 0 = standing on the ground line. In run the planted frames are 0; the 1s are a toe or heel about to land and the 3 is the airborne frame.',
  // how long each frame wants to be shown: the renderer is free to do otherwise
  ticks: { idle: [44, 44, 44, 6], hurt: [4, 4], grimed: [14, 9, 9, 7, 0], win: [10, 8, 8, 8], sprayIdle: [30, 30], sprayUpIdle: [30, 30], sprayDown: [5, 5], mapWalk: [8, 8, 8, 8], mapIdle: [90, 6] },
  ticksNote: 'Suggested ticks (1/60 s) for each frame of an animation, in its play order; 0 = hold that frame. Animations not listed are a single frame or advance with distance (the three runs).',
})

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))

const out = atlas.write()
console.log(`maxx atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames, cell ${CELL.w}x${CELL.h} anchor ${CELL.ax},${CELL.ay}`)
console.log('nozzle', JSON.stringify(achieved))

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const groups = {
    run: ['run'],
    sprayRun: ['sprayRun'],
    sprayUpRun: ['sprayUpRun'],
    poses: ['idle', 'jump', 'fall', 'skid', 'hurt', 'win'],
    spray: ['sprayIdle', 'sprayJump', 'sprayFall', 'sprayUpIdle', 'sprayUpJump', 'sprayUpFall', 'sprayDown'],
    grimed: ['grimed'],
    small: ['mapWalk', 'mapIdle'],
  }
  const rows = (names) => names.map((n) => ({ label: n, frames: shown[n] }))
  for (const [bgName, bg] of Object.entries({ sky: '#6cc4ff', tunnel: '#2e3038' })) {
    for (const flipX of [false, true]) {
      const tag = `${bgName}${flipX ? '_flip' : ''}`
      for (const [g, names] of Object.entries(groups)) contactSheet(rows(names), { bg, flipX, scale: 4, wrap: 4, file: path.join(REVIEW, `sheet_${g}_${tag}.png`) })
      contactSheet([{ label: 'singles', frames: singles }], { bg, flipX, scale: 4, wrap: 4, file: path.join(REVIEW, `sheet_singles_${tag}.png`) })
    }
  }
  // the same at 1x and 2x, as the game will show him
  contactSheet(rows(['run', 'idle', 'jump', 'fall', 'skid', 'hurt', 'win', 'sprayRun', 'sprayUpRun', 'sprayDown', 'grimed', 'mapWalk', 'mapIdle']), { scale: 2, wrap: 11, labels: false, file: path.join(REVIEW, 'sheet_all_2x.png') })
  // grime overlays as the renderer will use them
  const dirty = ['run0', 'run5', 'idle0', 'sprayRun3', 'jump0'].flatMap((n) => {
    const c = Object.values(shown).flat().find((x) => x.label === n)
    return ['grime1', 'grime2'].map((gname) => ({ label: `${n}+${gname}`, canvas: c.canvas.clone().blit(singles.find((s) => s.label === gname).canvas, 0, 0, { mode: 'atop' }), ax: c.ax, ay: c.ay }))
  })
  contactSheet(dirty, { scale: 4, wrap: 4, file: path.join(REVIEW, 'sheet_dirty.png') })
  for (const n of (process.env.MAXX_ZOOM ?? '').split(',').filter(Boolean)) {
    const c = [...Object.values(shown).flat(), ...singles].find((x) => x.label === n)
    if (c) rulerSheet(c.canvas, { scale: 10, file: path.join(REVIEW, `zoom_${n}.png`) })
  }
  rulerSheet(PLATE, { scale: 10, file: path.join(REVIEW, 'zoom_plate.png') })
  contactSheet(Object.entries(WAND).map(([k, w]) => ({ label: k, canvas: w.canvas })), { scale: 8, ground: false, file: path.join(REVIEW, 'wands.png') })
  contactSheet(Object.entries(FACE).map(([k, c]) => ({ label: k, canvas: c.crop(26, 14, 36, 52) })), { scale: 6, wrap: 5, ground: false, file: path.join(REVIEW, 'faces.png') })
  writePreview(path.join(REVIEW, 'preview.html'), out.sheet)
  // specks: any separate island of fewer than 12 pixels is suspect
  for (const c of [...Object.values(shown).flat(), ...singles]) {
    if (c.label.startsWith('grime')) continue
    const seen = new Set()
    for (let y = 0; y < c.canvas.h; y++) {
      for (let x = 0; x < c.canvas.w; x++) {
        if (!c.canvas.solid(x, y) || seen.has(y * 1000 + x)) continue
        const todo = [[x, y]]
        const island = []
        seen.add(y * 1000 + x)
        while (todo.length) {
          const [px, py] = todo.pop()
          island.push([px, py])
          for (const [dx, dy] of N8) {
            const k = (py + dy) * 1000 + px + dx
            if (c.canvas.solid(px + dx, py + dy) && !seen.has(k)) {
              seen.add(k)
              todo.push([px + dx, py + dy])
            }
          }
        }
        if (island.length < 12) console.log(`speck in ${c.label}: ${island.length} px at ${island[0]}`)
      }
    }
  }
}

/** A page that plays every animation from the finished sheet, with a frame stepper. */
function writePreview(file, sheet) {
  const png = fs.readFileSync(out.png).toString('base64')
  const data = { frames: Object.fromEntries([...atlas.frames].map(([k, f]) => [k, { x: f.slot.x, y: f.slot.y, w: f.canvas.w, h: f.canvas.h, ax: f.ax, ay: f.ay }])), anims: atlas.anims }
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>maxx atlas preview</title>
<style>body{background:#2e3038;color:#f7f4f8;font:12px monospace}canvas{image-rendering:pixelated;background:#6cc4ff;margin:4px}div{display:inline-block;text-align:center}</style>
<p>sheet ${sheet.w}x${sheet.h}. fps <input id="fps" type="number" value="12" style="width:4em"> <button id="pause">pause</button> <button id="step">step</button> <label><input id="flip" type="checkbox"> flip</label></p>
<div id="root"></div><img id="img" src="data:image/png;base64,${png}" style="display:none">
<script>
const D=${JSON.stringify(data)},S=4,img=document.getElementById('img'),root=document.getElementById('root');let t=0,paused=false
const views=Object.entries(D.anims).map(([name,frames])=>{const f=D.frames[frames[0]],d=document.createElement('div'),c=document.createElement('canvas');c.width=f.w*S;c.height=f.h*S;d.append(c,document.createElement('br'),name);root.append(d);return{name,frames,c}})
function draw(){for(const v of views){const g=v.c.getContext('2d'),f=D.frames[v.frames[t%v.frames.length]];g.imageSmoothingEnabled=false;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,v.c.width,v.c.height);if(document.getElementById('flip').checked){g.translate(v.c.width,0);g.scale(-1,1)}g.drawImage(img,f.x,f.y,f.w,f.h,0,0,f.w*S,f.h*S)}}
function tick(){if(!paused){t++;draw()}setTimeout(tick,1000/(+document.getElementById('fps').value||12))}
document.getElementById('pause').onclick=()=>{paused=!paused};document.getElementById('step').onclick=()=>{t++;draw()};img.onload=()=>{draw();tick()}
</script>`)
}

// --dump <frame>: print a finished frame as text, for picking pixels to fix
if (process.argv.includes('--dump')) {
  const n = process.argv[process.argv.indexOf('--dump') + 1]
  const c = [...Object.values(shown).flat(), ...singles].find((x) => x.label === n)
  const legend = new Map([...Object.entries({ ...LEG, ...GLEG }).map(([k, v]) => [v, k]), ...MUD.map((v, i) => [v, String(i)])])
  if (c) {
    let head = '   '
    for (let x = 0; x < c.canvas.w; x++) head += x % 10
    console.log(head)
    for (let y = 0; y < c.canvas.h; y++) {
      let s = String(y).padStart(2) + ' '
      for (let x = 0; x < c.canvas.w; x++) s += c.canvas.get(x, y) ? (legend.get(c.canvas.get(x, y)) ?? '?') : '.'
      console.log(s)
    }
  }
}
