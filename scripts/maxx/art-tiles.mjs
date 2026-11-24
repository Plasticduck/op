// art-tiles.mjs: generates the 'tiles' atlas of Super Mighty Maxx: every tile of the ten
// themes and the decor props the level designers dress a level with.
//
//   node scripts/maxx/art-tiles.mjs                  writes tiles.png + tiles.atlas.ts
//   node scripts/maxx/art-tiles.mjs --review <dir>   also writes, into <dir>:
//       sheet_<theme>_1x.png / _3x.png   every frame of a theme (any = the shared blocks)
//       mock_<theme>.png (+ _2x, _t20)   a 640x360 room built from the tiles by the
//                                        renderer's neighbour rules, over the theme's
//                                        background atlas when it exists, with props and
//                                        the hero (_t20: 20 ticks later, the moving tiles)
//       props_<theme>[_n].png (+ _2x)    every prop of the theme standing on its floor
//       rules_<theme>.png                the awkward cases of the neighbour rules
//       floors_<theme>.png               slick, oily, mud and belt runs on ground, blocks and a
//                                        pipe set into a ledge, lone columns (the '#' rule
//                                        counts all of those as ground)
//       anim_tiles.png, anim_decor.png   every animation as a strip (anim_decor_flip: mirrored)
//   --only lot,mega                      limits the review pictures to those themes
//
// Frame names (the renderer looks up tiles/<theme>_<key>, then tiles/any_<key>):
//   ground_t ground_tl ground_tr ground_m ground_m2 ground_l ground_r   wall wall_t
//   pillar pillar_t   slick_t slick_m oily_t mud_t                      (every theme)
//   brick prize0-3 power0-3 waxblock0-3 lifeblock0-3 used steel catwalk catwalk_l
//   catwalk_r conv0-3 conv_l conv_r grime0-2 sludge_t0-3 sludge_m spikes
//   pipe_tl pipe_tr pipe_l pipe_r                                       (any only)
//   decor_<name> (or decor_<name>0.. with anims['decor_<name>'])        bottom-centre anchor
// atlas.meta.decor lists every prop ({ w, h, themes, front?, ticks?, words?, note });
// atlas.meta.ticks the frame times of the moving tiles, atlas.meta.convTicks the belt's.
// An animated prop's anims entry may repeat frames (the neon flicker): play it as listed.
//
// How a ground set stays seamless: one body texture per theme that wraps on all four
// sides (ground_m; ground_m2 adds a detail well inside the tile), a cap painted over its
// top rows (ground_t), and an outline column added only on a side that is exposed.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet, rgba } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR } from './paths.mjs'

const argAfter = (flag) => {
  const i = process.argv.indexOf(flag)
  return i > 0 ? process.argv[i + 1] : null
}
const REVIEW = argAfter('--review')
const ONLY = argAfter('--only')?.split(',') ?? null

const T = 32
const THEMES = ['lot', 'vacuum', 'tunnel', 'storm', 'lube', 'highway', 'winter', 'mega', 'bonus', 'backlot']

const O = PAL.outline
const NAVY = PAL.navy
const [R0, R1, R2, R3, R4, R5] = PAL.red
const [W0, W1, W2, W3, W4, W5, W6, W7, W8] = PAL.wood
const [B0, B1, B2, B3, B4] = PAL.blue
const [T0, T1, T2] = PAL.teal
const [G0, G1, G2, G3] = PAL.green
const [K0, K1, K2, K3, K4, K5, K6] = PAL.grey
const [M0, M1, M2, M3, M4] = PAL.mud
const [Y0, Y1, Y2] = PAL.yellow
const [P0, P1, P2, P3] = PAL.purple
const [OR0, OR1, OR2] = PAL.orange
const PK = PAL.pink[0]
const [I0, I1, I2] = PAL.ice

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

const tile = (fill = 0) => new Canvas(T, T, fill)
const mod = (n, m = T) => ((n % m) + m) % m

/** A stable 0..1 number for a place, so speckles never move between runs. */
function rnd(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1103515245)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const wset = (c, x, y, col) => c.set(mod(x), mod(y), col)
/** A rect that leaves one side of the tile and comes back in on the other. */
function wrect(c, x, y, w, h, col) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) wset(c, x + i, y + j, col)
}
function wblob(c, cx, cy, rx, ry, col) {
  for (const dy of [-T, 0, T]) for (const dx of [-T, 0, T]) c.ellipse(cx + dx, cy + dy, rx, ry, col)
}
/** n specks `w` wide at hashed places, only on pixels of colour `on` when given. */
function speck(c, col, n, seed, { y0 = 0, y1 = T - 1, w = 1, on = null } = {}) {
  const onV = on ? rgba(on) : 0
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rnd(i, 7, seed) * T)
    const y = y0 + Math.floor(rnd(i, 13, seed) * (y1 - y0 + 1))
    for (let k = 0; k < w; k++) {
      if (on && c.get(mod(x + k), y) !== onV) continue
      c.set(mod(x + k), y, col)
    }
  }
}
/** Full-width rows of flat colour starting at y (null skips a row). */
function bands(c, y, cols, x0 = 0, x1 = c.w - 1) {
  cols.forEach((col, i) => {
    if (col) c.rect(x0, y + i, x1 - x0 + 1, 1, col)
  })
}
/** Diagonal safety tape. Period 8 wraps a 32 px tile. */
function hazard(c, x0, y, w, h, a, b, { period = 8, on = 4, lean = 1 } = {}) {
  for (let j = 0; j < h; j++) for (let x = x0; x < x0 + w; x++) c.set(x, y + j, mod(x + lean * j, period) < on ? a : b)
}
/** Running-bond masonry that wraps: courses `ch` tall, bricks `bw` wide, every other course shifted half a brick. */
function masonry(c, { bw, ch, ox = 0, oy = 0, joint, hi = null, lo = null, fill = null }) {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const row = Math.floor(mod(y - oy) / ch)
      const yy = mod(y - oy) % ch
      const sx = mod(x - ox - (row % 2 ? bw / 2 : 0))
      const xx = sx % bw
      if (yy === ch - 1 || xx === bw - 1) c.set(x, y, joint)
      else if (hi && yy === 0) c.set(x, y, hi)
      else if (lo && yy === ch - 2) c.set(x, y, lo)
      else if (fill) {
        const col = fill(Math.floor(sx / bw), row, xx, yy)
        if (col) c.set(x, y, col)
      }
    }
  }
}
/** A filled box with a 1 px line round it (inside its bounds). */
function ob(c, x, y, w, h, fill, line = O) {
  c.rect(x, y, w, h, line)
  if (w > 2 && h > 2) c.rect(x + 1, y + 1, w - 2, h - 2, fill)
  return c
}
/** ob plus a lit top and left edge and a shaded bottom and right edge. */
function bevel(c, x, y, w, h, { md, lt = null, dk = null, line = O }) {
  ob(c, x, y, w, h, md, line)
  if (dk) {
    c.rect(x + 1, y + h - 2, w - 2, 1, dk)
    c.rect(x + w - 2, y + 1, 1, h - 2, dk)
  }
  if (lt) {
    c.rect(x + 1, y + 1, w - 2, 1, lt)
    c.rect(x + 1, y + 1, 1, h - 2, lt)
  }
  return c
}
/** Hand-pixelled art: rows of characters, legend of colours. */
const art = (rows, legend) => Canvas.fromText(rows, legend)
/** (x, y) turned about (cx, cy) by a radians (screen y runs down, so positive turns clockwise). */
const rot = (x, y, cx, cy, a) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]

/* ------------------------------------------------------------------ */
/* The frame registry                                                  */
/* ------------------------------------------------------------------ */

/** name -> { canvas, ax, ay }. Everything the atlas will hold, kept for the review pictures too. */
const F = new Map()
const ANIMS = {}
const put = (name, canvas, ax = 0, ay = 0) => {
  if (F.has(name)) throw new Error(`frame ${name} made twice`)
  F.set(name, { canvas, ax, ay })
}
const putAnim = (name, frames, ax = 0, ay = 0) => {
  frames.forEach((c, i) => put(`${name}${i}`, c, ax, ay))
  ANIMS[name] = frames.map((_, i) => `${name}${i}`)
}

/* ------------------------------------------------------------------ */
/* Ground, wall and pillar of each theme                               */
/* ------------------------------------------------------------------ */

// body(c, v): the whole tile, wrapping on all sides; v = 1 adds the ground_m2 detail.
// cap(c): the top rows painted over the body. capH: rows the cap covers (the edge
// highlight starts below it). hi / lo: the lit left face and the shaded right face.
const GROUND = {
  lot: {
    capH: 13,
    hi: K5,
    lo: K3,
    body(c, v) {
      c.clear(K4)
      // big foundation blocks; the joints sit off the tile edges so no seam lines up with the grid
      for (const [y, x] of [[9, 6], [25, 22]]) {
        wrect(c, 0, y, T, 1, K3)
        wrect(c, 0, y + 1, T, 1, K5)
        wrect(c, x, y + 1, 1, 15, K3)
        wrect(c, x + 1, y + 2, 1, 14, K5)
      }
      speck(c, K3, 9, 11, { on: K4 })
      speck(c, K5, 7, 12, { on: K4, w: 2 })
      if (v) {
        // a weep hole with a dribble
        ob(c, 13, 14, 7, 5, K1)
        c.rect(14, 15, 5, 1, K0)
        c.rect(15, 19, 2, 4, T1)
        c.set(15, 19, T2)
        c.rect(15, 23, 2, 1, K3)
      }
    },
    cap(c) {
      // white slab, then the Mighty Wash curb: red over blue
      bands(c, 0, [O, K6, K5, K5, K5, K4, R4, R3, R3, R1, B2, B1, K3])
      c.rect(15, 2, 1, 3, K4)
      c.rect(16, 2, 1, 3, K6)
    },
  },
  vacuum: {
    capH: 12,
    hi: W6,
    lo: M3,
    body(c, v) {
      c.clear(M4)
      masonry(c, {
        bw: 16, ch: 8, ox: 3, oy: 5, joint: M3,
        fill: (bx, row, xx, yy) => {
          const r = rnd(bx, row, 21)
          if (r < 0.22) return yy === 0 ? W6 : null
          if (r > 0.86) return M3
          return null
        },
      })
      if (v) {
        // a dark stain soaked into a few pavers
        wblob(c, 15, 17, 6, 4, M2)
        wblob(c, 20, 20, 3, 2, M2)
        c.rect(12, 16, 3, 1, M1)
      }
    },
    cap(c) {
      bands(c, 0, [O, W8, W7, W7, W7, W6, B3, B1, B1, B0, Y1, M2])
      c.rect(23, 2, 1, 3, W6)
      c.rect(24, 2, 1, 3, W8)
    },
  },
  tunnel: {
    capH: 12,
    hi: K4,
    lo: K2,
    body(c, v) {
      c.clear(K3)
      // square floor tiles, wet
      for (const p of [7, 23]) {
        wrect(c, 0, p, T, 1, K2)
        wrect(c, p, 0, 1, T, K2)
      }
      for (const p of [8, 24]) wrect(c, 0, p, T, 1, K4)
      for (const p of [7, 23]) wrect(c, p, 0, 1, T, K2)
      for (const [x, y, n] of [[3, 12, 5], [14, 27, 6], [19, 10, 4], [28, 15, 7], [11, 1, 3]]) wrect(c, x, y, 1, n, K4)
      if (v) {
        // a floor drain
        ob(c, 10, 11, 12, 9, K1, K0)
        for (let x = 12; x < 21; x += 3) c.rect(x, 12, 1, 7, K3)
        c.rect(11, 20, 10, 1, K4)
      }
    },
    cap(c) {
      bands(c, 0, [O, B4, K5, K5, K4, K2])
      hazard(c, 0, 6, T, 5, Y1, K0)
      for (let x = 0; x < T; x++) if (rgba(Y1) === c.get(x, 6)) c.set(x, 6, Y2)
      bands(c, 11, [K1, K2])
      // wet glints
      c.rect(3, 2, 6, 1, K6)
      c.rect(19, 2, 3, 1, K6)
      c.rect(11, 3, 3, 1, K6)
      c.rect(25, 3, 4, 1, B4)
    },
  },
  storm: {
    capH: 9,
    hi: M4,
    lo: M2,
    // packed dirt, a shade lighter than the mud floor ('M'), which is wet and dark
    body(c, v) {
      c.clear(M3)
      for (const [x, y, rx, ry] of [[5, 6, 4, 2], [20, 3, 3, 2], [27, 14, 4, 3], [11, 18, 5, 2], [1, 26, 3, 2], [19, 27, 4, 2]]) wblob(c, x, y, rx, ry, M2)
      for (const [x, y] of [[13, 8], [24, 22], [6, 13], [30, 5], [16, 30]]) {
        wrect(c, x, y, 3, 2, K3)
        wrect(c, x, y, 2, 1, K4)
      }
      speck(c, M4, 14, 31, { on: M3, w: 2 })
      if (v) {
        // somebody lives here
        for (const [x, y] of [[11, 15], [12, 14], [13, 14], [14, 15], [15, 16], [16, 16], [17, 15], [18, 14]]) c.set(x, y, PK)
        c.set(19, 14, R5)
        c.set(10, 16, M0)
      }
    },
    cap(c) {
      for (let x = 0; x < T; x++) {
        const d = 5 + Math.round(1.4 + 1.4 * Math.sin((x / 16) * Math.PI * 2 + 0.6))
        c.set(x, 0, O)
        c.set(x, 1, M4)
        c.rect(x, 2, 1, d - 2, M3)
        c.set(x, d, M2)
      }
      for (const x of [5, 6, 22]) c.set(x, 1, K5)
      c.set(23, 1, K4)
      // a rain puddle
      c.rect(11, 1, 7, 1, T2)
      c.rect(12, 2, 5, 1, T1)
      c.rect(27, 3, 2, 1, M4)
      c.rect(2, 3, 3, 1, M4)
    },
  },
  lube: {
    capH: 11,
    hi: K3,
    lo: K1,
    body(c, v) {
      c.clear(K2)
      // board-formed concrete
      for (const y of [4, 12, 20, 28]) wrect(c, 0, y, T, 1, K1)
      for (const [x, y] of [[9, 8], [25, 8], [9, 24], [25, 24]]) {
        wrect(c, x, y, 2, 2, K1)
        wset(c, x, y, K0)
      }
      speck(c, K3, 12, 41, { on: K2, w: 2 })
      for (const [x, y, n] of [[17, 13, 6], [3, 21, 5], [29, 29, 5]]) wrect(c, x, y, 1, n, K1)
      if (v) {
        // a rusty patch plate
        bevel(c, 11, 13, 11, 9, { md: M2, lt: M3, dk: M1, line: K0 })
        for (const [x, y] of [[13, 15], [19, 15], [13, 19], [19, 19]]) c.set(x, y, M4)
        c.rect(14, 22, 1, 4, M1)
      }
    },
    cap(c) {
      bands(c, 0, [O, K5, K3, K3, K3, K1])
      hazard(c, 0, 6, T, 4, OR1, K0, { on: 5 })
      for (let x = 0; x < T; x++) if (rgba(OR1) === c.get(x, 6)) c.set(x, 6, OR2)
      bands(c, 10, [K0])
      for (const [x, n] of [[5, 5], [19, 8], [27, 3]]) {
        c.rect(x, 2, 2, n + 8, K0)
        c.set(x, 2 + n + 8, K0)
      }
      c.rect(12, 2, 4, 1, K4)
    },
  },
  highway: {
    capH: 11,
    hi: W2,
    lo: W0,
    body(c, v) {
      c.clear(W1)
      // layered red dirt
      for (let x = 0; x < T; x++) {
        const a = Math.round(1.5 * Math.sin((x / 32) * Math.PI * 2))
        const b = Math.round(1.5 * Math.sin((x / 16) * Math.PI * 2 + 1))
        wrect(c, x, 7 + a, 1, 3, W2)
        wset(c, x, 10 + a, W0)
        wrect(c, x, 22 + b, 1, 2, W2)
        wset(c, x, 21 + b, W3)
      }
      for (const [x, y] of [[4, 15], [18, 17], [27, 28], [11, 30], [23, 2]]) {
        wrect(c, x, y, 3, 2, W0)
        wrect(c, x, y, 2, 1, M3)
      }
      speck(c, W4, 8, 51, { on: W1 })
      if (v) {
        // a fossil shell
        c.ellipse(15, 16, 4, 3, W6)
        c.ellipse(15, 16, 4, 3, W0, { fill: false })
        c.rect(14, 15, 3, 1, W0)
        c.set(16, 16, W0)
        c.set(13, 17, W8)
      }
    },
    cap(c) {
      bands(c, 0, [O, K5, K2, K1, K1, K1, K1, K0, M3, M3, W0])
      // the centre line, seen edge on
      c.rect(8, 1, 13, 1, Y1)
      c.rect(8, 2, 13, 1, Y0)
      speck(c, K2, 16, 52, { y0: 3, y1: 6, on: K1 })
      speck(c, K4, 9, 53, { y0: 8, y1: 9, on: M3 })
      speck(c, M1, 7, 54, { y0: 8, y1: 9, on: M3 })
    },
  },
  winter: {
    capH: 10,
    hi: K4,
    lo: K2,
    body(c, v) {
      c.clear(K3)
      // frozen rock, cracked
      const cracks = [[[2, 3], [7, 6], [6, 11], [11, 14]], [[18, 1], [21, 6], [27, 8], [29, 13]], [[14, 17], [19, 21], [18, 27], [23, 31]], [[30, 20], [34, 24], [33, 29]], [[7, 22], [4, 27], [8, 33]]]
      for (const line of cracks) {
        for (const dy of [-T, 0, T]) for (const dx of [-T, 0, T]) c.poly(line.map(([x, y]) => [x + dx, y + dy]), K2, { fill: false, close: false })
      }
      speck(c, I1, 10, 61, { on: K3, w: 2 })
      speck(c, K4, 10, 62, { on: K3, w: 2 })
      if (v) {
        // a chunk of ice in the rock
        c.poly([[12, 13], [17, 10], [22, 14], [20, 20], [14, 21]], I1)
        c.poly([[12, 13], [17, 10], [22, 14], [20, 20], [14, 21]], I0, { fill: false })
        c.line(15, 13, 18, 12, I2)
        c.set(16, 16, I2)
      }
    },
    cap(c) {
      const sag = [0, 0, 1, 2, 2, 3, 3, 2, 1, 1, 0, 0, 0, 1, 1, 2, 3, 3, 3, 2, 2, 1, 0, 0, 1, 2, 2, 1, 1, 0, 0, 0]
      for (let x = 0; x < T; x++) {
        const d = 5 + sag[x]
        c.set(x, 0, O)
        c.rect(x, 1, 1, d - 1, K6)
        c.set(x, d, I2)
        c.set(x, d + 1, I0)
        c.set(x, d + 2, K2)
      }
      c.rect(8, 3, 5, 1, I2)
      c.rect(22, 4, 4, 1, I2)
      c.set(3, 2, I1)
      c.set(17, 2, I1)
      c.set(28, 3, I1)
    },
  },
  mega: {
    capH: 12,
    hi: P2,
    lo: P0,
    body(c, v) {
      c.clear(P1)
      // dark plate, seams and rivets
      wrect(c, 0, 19, T, 1, P0)
      wrect(c, 0, 20, T, 1, P2)
      wrect(c, 12, 20, 1, T, P0)
      wrect(c, 13, 21, 1, T - 2, P2)
      for (const [x, y] of [[15, 23], [9, 16], [15, 16], [28, 23], [28, 16]]) wset(c, x, y, P3)
      for (const [x, y, n] of [[3, 5, 7], [22, 28, 6], [26, 4, 4]]) wrect(c, x, y, n, 1, P2)
      if (v) {
        // a lit vent
        ob(c, 16, 5, 13, 11, P0, P0)
        for (const y of [7, 10, 13]) {
          c.rect(18, y, 9, 1, P3)
          c.rect(18, y + 1, 9, 1, P2)
        }
      }
    },
    cap(c) {
      bands(c, 0, [O, K6, K5, K4, K2, K5, K3, O, P0, P0, P0, P0])
      // chrome sparkle and the neon run: red, blue, red, blue
      c.rect(6, 2, 4, 1, K6)
      c.rect(22, 3, 5, 1, K6)
      c.rect(1, 8, 14, 3, R4)
      c.rect(2, 9, 12, 1, R5)
      c.rect(17, 8, 14, 3, B2)
      c.rect(18, 9, 12, 1, B4)
      for (const x of [1, 14]) c.set(x, 8, R2), c.set(x, 10, R2)
      for (const x of [17, 30]) c.set(x, 8, B1), c.set(x, 10, B1)
    },
  },
  bonus: {
    capH: 11,
    hi: B1,
    lo: P0,
    body(c, v) {
      c.clear(NAVY)
      masonry(c, {
        bw: 16, ch: 8, ox: 5, oy: 3, joint: P0,
        fill: (bx, row, xx, yy) => (yy === 0 && rnd(bx, row, 71) < 0.45 ? B1 : rnd(bx, row, 72) < 0.2 ? B0 : null),
      })
      if (v) {
        // a gold stud
        c.poly([[16, 12], [20, 16], [16, 20], [12, 16]], Y1)
        c.poly([[16, 12], [20, 16], [16, 20], [12, 16]], Y0, { fill: false })
        c.line(13, 16, 16, 13, Y2)
        c.set(16, 16, Y2)
      }
    },
    cap(c) {
      bands(c, 0, [O, Y2, Y1, Y1, Y1, Y0, O, NAVY, NAVY, NAVY, P0])
      for (let x = 0; x < T; x++) {
        if (mod(x - 1, 8) < 5) {
          c.rect(x, 7, 1, 2, Y1)
          c.set(x, 9, Y0)
        }
      }
      c.rect(4, 2, 6, 1, Y2)
      c.rect(20, 3, 4, 1, Y2)
    },
  },
  backlot: {
    capH: 8,
    hi: K2,
    lo: K0,
    body(c, v) {
      c.clear(K1)
      for (const [x, y, rx, ry] of [[6, 5, 4, 2], [22, 9, 5, 2], [12, 20, 4, 3], [28, 25, 3, 2], [2, 29, 3, 1]]) wblob(c, x, y, rx, ry, K0)
      for (const [x, y] of [[15, 6], [3, 14], [24, 17], [9, 27], [30, 2], [19, 30]]) {
        wrect(c, x, y, 3, 2, K2)
        wrect(c, x, y, 2, 1, K3)
      }
      speck(c, P1, 12, 81, { on: K1, w: 2 })
      if (v) {
        // old brick showing through
        for (const [x, y, col] of [[10, 12, R1], [17, 12, R0], [13, 16, R1], [20, 16, R1], [10, 20, R0]]) {
          ob(c, x, y, 7, 4, col, K0)
          c.rect(x + 1, y + 1, 4, 1, R2)
        }
      }
    },
    cap(c) {
      bands(c, 0, [O, K4, K2, K2, K2, K2, K0, P0])
      // cracked old paving with a weed in it
      c.poly([[9, 1], [10, 3], [12, 4], [12, 6]], K0, { fill: false, close: false })
      c.poly([[21, 2], [19, 4], [20, 6]], K0, { fill: false, close: false })
      c.rect(14, 2, 5, 1, K3)
      c.rect(26, 3, 4, 1, K3)
      c.rect(2, 3, 4, 1, K3)
      for (const [x, y, col] of [[24, 1, G2], [25, 1, G1], [26, 1, G2], [25, 2, G1], [24, 2, G0], [4, 1, P2], [5, 1, P2]]) c.set(x, y, col)
    },
  },
}

function groundSet(theme) {
  const g = GROUND[theme]
  const m = tile()
  g.body(m, 0)
  const m2 = tile()
  g.body(m2, 1)
  const t = m.clone()
  g.cap(t)
  const edged = (src, side, from) => {
    const c = src.clone()
    const x = side < 0 ? 0 : T - 1
    c.rect(x - side, from, 1, T - from, side < 0 ? g.hi : g.lo)
    c.rect(x, 0, 1, T, O)
    return c
  }
  put(`${theme}_ground_m`, m)
  put(`${theme}_ground_m2`, m2)
  put(`${theme}_ground_t`, t)
  put(`${theme}_ground_tl`, edged(t, -1, g.capH))
  put(`${theme}_ground_tr`, edged(t, 1, g.capH))
  put(`${theme}_ground_l`, edged(m, -1, 0))
  put(`${theme}_ground_r`, edged(m, 1, 0))
}

// A wall has no side variants, so its own edge columns are a soft panel joint: they read
// as a seam inside a block of wall and as its edge where the wall ends.
const WALL = {
  lot: {
    body(c) {
      c.clear(K6)
      for (const y of [7, 15, 23, 31]) c.rect(0, y, T, 1, K5)
      c.rect(0, 0, 1, T, K4)
      c.rect(T - 1, 0, 1, T, K3)
    },
    cap(c) {
      bands(c, 0, [O, K6, K4, R4, R3, R3, R3, R3, R1, K6, B2, B1, K4])
    },
  },
  vacuum: {
    body(c) {
      c.clear(W7)
      for (const [x, y, rx, ry] of [[7, 6, 5, 2], [22, 13, 6, 2], [10, 23, 4, 2], [28, 28, 4, 2]]) wblob(c, x, y, rx, ry, W6)
      speck(c, W8, 12, 22, { on: W7, w: 2 })
      c.rect(0, 0, 1, T, W6)
      c.rect(T - 1, 0, 1, T, M4)
    },
    cap(c) {
      bands(c, 0, [O, K6, B3, B2, B2, B2, B1, B0, Y1, M4])
    },
  },
  tunnel: {
    body(c) {
      // ribbed wall panel
      const rib = [K4, K4, K3, K3, K3, K3, K2, K3]
      for (let x = 0; x < T; x++) c.rect(x, 0, 1, T, rib[x % 8])
      c.rect(0, T - 1, T, 1, K2)
      c.rect(0, 0, T, 1, K4)
      for (const x of [4, 20]) {
        c.rect(x, 3, 2, 2, K1)
        c.set(x, 3, K5)
      }
      c.rect(0, 0, 1, T, K4)
      c.rect(T - 1, 0, 1, T, K2)
    },
    cap(c) {
      bands(c, 0, [O, B4, K5, K4, K2])
      hazard(c, 0, 5, T, 5, Y1, K0)
      for (let x = 0; x < T; x++) if (rgba(Y1) === c.get(x, 5)) c.set(x, 5, Y2)
      bands(c, 10, [K1])
    },
  },
  storm: {
    body(c) {
      // wet planks
      for (let x = 0; x < T; x++) c.rect(x, 0, 1, T, [W2, W1, W1, W1, W1, W1, M1, W0][x % 8])
      for (const [x, y, n] of [[2, 5, 9], [11, 17, 8], [19, 2, 6], [27, 20, 9], [4, 24, 5]]) c.rect(x, y, 1, n, M1)
      for (const [x, y] of [[12, 8], [28, 9], [4, 20], [20, 25]]) {
        c.rect(x, y, 2, 2, W0)
        c.set(x, y, M1)
      }
      c.rect(0, 15, T, 1, W0)
      c.rect(0, 16, T, 1, W2)
    },
    cap(c) {
      bands(c, 0, [O, M4, W3, W2, W2, W1, W0])
      for (const x of [5, 26]) {
        c.rect(x, 3, 2, 2, W0)
        c.set(x, 3, K4)
      }
    },
  },
  lube: {
    body(c) {
      c.clear(K3)
      c.rect(0, 15, T, 1, K2)
      c.rect(0, 16, T, 1, K4)
      for (const [x, y] of [[7, 7], [23, 7], [7, 24], [23, 24]]) {
        c.rect(x, y, 3, 3, K2)
        c.rect(x + 1, y + 1, 1, 1, K1)
      }
      for (const [x, y, n] of [[14, 17, 7], [27, 1, 5], [3, 20, 4]]) c.rect(x, y, 1, n, K2)
      speck(c, K4, 10, 42, { on: K3, w: 2 })
      c.rect(0, 0, 1, T, K4)
      c.rect(T - 1, 0, 1, T, K2)
    },
    cap(c) {
      bands(c, 0, [O, K5, K4, K4, K2])
      hazard(c, 0, 5, T, 4, OR1, K0, { on: 5 })
      for (let x = 0; x < T; x++) if (rgba(OR1) === c.get(x, 5)) c.set(x, 5, OR2)
      bands(c, 9, [K1])
    },
  },
  highway: {
    body(c) {
      // mesa rock
      c.clear(W2)
      for (let x = 0; x < T; x++) {
        const a = Math.round(1.2 * Math.sin((x / 32) * Math.PI * 2 + 2))
        const b = Math.round(1.2 * Math.sin((x / 16) * Math.PI * 2))
        wset(c, x, 5 + a, W1)
        wset(c, x, 6 + a, W4)
        wrect(c, x, 15 + b, 1, 2, W1)
        wset(c, x, 17 + b, W3)
        wset(c, x, 26 + a, W1)
        wset(c, x, 27 + a, W4)
      }
      for (const line of [[[9, 7], [11, 10], [10, 14]], [[22, 18], [24, 21], [23, 25]], [[3, 28], [5, 31], [4, 35]]]) {
        for (const dy of [-T, 0, T]) c.poly(line.map(([x, y]) => [x, y + dy]), W0, { fill: false, close: false })
      }
      c.rect(0, 0, 1, T, W3)
      c.rect(T - 1, 0, 1, T, W1)
    },
    cap(c) {
      bands(c, 0, [O, W7, W5, W4])
      for (let x = 0; x < T; x++) if (rnd(x, 3, 55) < 0.4) c.set(x, 4, W4)
      c.rect(6, 2, 5, 1, W7)
      c.rect(20, 2, 3, 1, W7)
    },
  },
  winter: {
    body(c) {
      // stone blocks with snow packed in the joints
      c.clear(K4)
      masonry(c, { bw: 16, ch: 16, ox: 4, oy: 6, joint: I2, lo: K3, fill: (bx, row, xx) => (xx === 14 ? K3 : null) })
      speck(c, K5, 12, 63, { on: K4, w: 2 })
      speck(c, K3, 8, 64, { on: K4 })
    },
    cap(c) {
      const sag = [0, 1, 1, 2, 2, 1, 0, 0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 1, 1, 2, 2, 1, 1, 0, 0, 1, 2, 2, 1, 0, 0]
      for (let x = 0; x < T; x++) {
        const d = 5 + sag[x]
        c.set(x, 0, O)
        c.rect(x, 1, 1, d - 1, K6)
        c.set(x, d, I2)
        c.set(x, d + 1, I0)
      }
      c.rect(13, 3, 5, 1, I2)
      c.set(5, 2, I1)
      c.set(25, 3, I1)
    },
  },
  mega: {
    body(c) {
      c.clear(NAVY)
      c.rect(0, T - 1, T, 1, P0)
      c.rect(0, 0, T, 1, B0)
      // a neon tube up the middle of every panel
      c.rect(13, 0, 6, T, P0)
      c.rect(14, 0, 4, T, B1)
      c.rect(15, 0, 2, T, B3)
      c.rect(15, 6, 1, 8, B4)
      c.rect(15, 20, 1, 5, B4)
      for (const [x, y] of [[4, 4], [27, 4], [4, 27], [27, 27]]) c.set(x, y, P2)
      c.rect(0, 0, 1, T, B0)
      c.rect(T - 1, 0, 1, T, P0)
    },
    cap(c) {
      bands(c, 0, [O, K6, K5, K4, K2, K5, K3, O, R4, R5, R4, P0])
      c.rect(8, 2, 5, 1, K6)
      c.rect(24, 3, 4, 1, K6)
      for (const x of [0, T - 1]) c.rect(x, 8, 1, 3, R2)
    },
  },
  bonus: {
    body(c) {
      c.clear(B0)
      // quilted vault wall
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (mod(x + y, 16) === 0 || mod(x - y, 16) === 0) c.set(x, y, B1)
      for (const [x, y] of [[0, 0], [16, 0], [8, 8], [24, 8], [0, 16], [16, 16], [8, 24], [24, 24]]) {
        wrect(c, x - 1, y - 1, 3, 3, Y0)
        wrect(c, x - 1, y - 1, 2, 2, Y1)
        wset(c, x - 1, y - 1, Y2)
      }
    },
    cap(c) {
      bands(c, 0, [O, Y2, Y1, Y1, Y0, O, R3, R2, O, Y1, Y0, P0])
      c.rect(5, 2, 7, 1, Y2)
      c.rect(22, 2, 4, 1, Y2)
    },
  },
  backlot: {
    body(c) {
      c.clear(R1)
      masonry(c, {
        bw: 16, ch: 8, ox: 0, oy: 0, joint: P0,
        fill: (bx, row, xx, yy) => {
          const r = rnd(bx, row, 82)
          if (r < 0.25) return R0
          if (r > 0.8 && yy === 0) return R2
          return null
        },
      })
    },
    cap(c) {
      bands(c, 0, [O, K4, K3, K2, K2, K0, P0])
      c.rect(7, 2, 6, 1, K4)
      c.rect(15, 1, 1, 5, K1)
    },
  },
}

// Pillars are scenery, behind Maxx and not solid, so they keep out of the foreground's way:
// a step darker than the theme's ground and walls, and a capital with no outline along its top
// and no light top row (the two marks of something to stand on), so nobody jumps onto one.
const PILLAR = {
  any: { edge: K1, lt: K3, md: K2, dk: K1, capCol: [K2, K2, K1] },
  lot: { edge: K2, lt: K4, md: K3, dk: K2, capCol: [R2, R2, R1], band: R2 },
  vacuum: { edge: B0, lt: B2, md: B1, dk: B0, capCol: [M3, M3, M2] },
  tunnel: { truss: true, edge: K0, lt: K3, md: K2, dk: K1, capCol: [K2, K2, K1] },
  storm: { edge: W0, lt: W1, md: M1, dk: M0, capCol: [M1, M1, M0], grain: M0, w: 10 },
  lube: { edge: K0, lt: K2, md: K1, dk: K0, capCol: [OR0, OR0, K0] },
  highway: { edge: W0, lt: M2, md: M1, dk: M0, capCol: [M2, M1, M0], grain: M0, w: 8 },
  winter: { edge: K1, lt: M2, md: M1, dk: M0, capCol: [I0, I0, K2], grain: M0, w: 10 },
  mega: { edge: P0, lt: P1, md: P0, dk: O, capCol: [K2, K2, K1], neon: [R2, R4] },
  bonus: { edge: P0, lt: B0, md: NAVY, dk: P0, capCol: [Y0, Y0, P0], flute: P0 },
  backlot: { edge: K0, lt: M1, md: M0, dk: O, capCol: [K1, K1, K0], w: 10 },
}

function pillarSet(theme) {
  const p = PILLAR[theme]
  const w = p.w ?? 14
  const x0 = (T - w) / 2
  const body = tile()
  if (p.truss) {
    // two rails and a zig-zag of braces
    for (const x of [x0, x0 + w - 4]) {
      body.rect(x, 0, 4, T, p.edge)
      body.rect(x + 1, 0, 2, T, p.md)
      body.rect(x + 1, 0, 1, T, p.lt)
    }
    for (let y = 0; y < T; y++) {
      const k = y % 16 < 8 ? y % 8 : 7 - (y % 8)
      body.rect(x0 + 4 + Math.round((k * (w - 10)) / 7), y, 2, 1, p.dk)
    }
  } else {
    body.rect(x0, 0, w, T, p.edge)
    body.rect(x0 + 1, 0, w - 2, T, p.md)
    body.rect(x0 + 1, 0, 2, T, p.lt)
    body.rect(x0 + w - 4, 0, 3, T, p.dk)
    if (p.grain) for (const [x, y, n] of [[x0 + 4, 3, 9], [x0 + 5, 19, 8]]) body.rect(x, y, 1, n, p.grain)
    if (p.flute) for (const x of [x0 + 5, x0 + 8]) body.rect(x, 0, 1, T, p.flute)
    if (p.neon) {
      body.rect(x0 + 5, 0, 4, T, p.neon[0])
      body.rect(x0 + 6, 0, 2, T, p.neon[1])
    }
    if (p.band) body.rect(x0 + 1, 14, w - 2, 3, p.band)
  }
  const top = body.clone()
  const cw = w + 6
  const cx = (T - cw) / 2
  top.rect(cx, 0, cw, 6, p.edge)
  top.rect(cx + 1, 0, cw - 2, 2, p.capCol[0])
  top.rect(cx + 1, 2, cw - 2, 2, p.capCol[1])
  top.rect(cx + 1, 4, cw - 2, 1, p.capCol[2])
  top.rect(x0, 6, w, 1, p.edge)
  put(`${theme}_pillar`, body)
  put(`${theme}_pillar_t`, top)
}

/* ------------------------------------------------------------------ */
/* The floors that change how he runs                                  */
/* ------------------------------------------------------------------ */

// Each is a whole slab of its stuff, a tile deep, set into the floor flush with the ground
// beside it: white suds (slick), blue ice (slick in winter), black oil with a rainbow sheen
// (oily), wet brown mud (mud). A slab and not a skin on the theme's ground: the '#' rule
// counts these floors as ground, so the '#' under one wears no cap and the '#' beside one no
// edge, and the slab sits flush in one continuous floor. The slab's own sides carry no
// outline; at the end of a ledge the ground below it draws the edge.

/** Paint a disc that repeats across the tile edges (wrapX) so a run of tiles is one mass. */
function disc(c, cx, cy, r, colAt, { wrapX = true } = {}) {
  for (const ox of wrapX ? [-T, 0, T] : [0]) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const dx = x - cx
        const dy = y - cy
        const d2 = dx * dx + dy * dy
        if (d2 > (r + 0.5) ** 2) continue
        const col = colAt(dx, dy, d2 > (r - 0.5) ** 2)
        if (col) c.set(x + ox, y, col)
      }
    }
  }
}
/** A soap bubble lit from the top left: a white disc, its lower right rim in shade. */
const suds = (c, cx, cy, r, fill = K6, rim = I1) => disc(c, cx, cy, r, (dx, dy, edge) => (edge && dx + dy > -r * 0.3 ? rim : fill))

/** A bank of suds a tile deep: round puffs on top (the lip), packed bubbles below. */
function foamSlab(top, { tints = null } = {}) {
  const c = tile(I2)
  // packed bubbles, big ones first; the gaps between them are the pale blue of the mass
  for (const [x, y, r] of [[4, 14, 5], [15, 19, 6], [26, 13, 5], [8, 26, 4], [21, 28, 4], [30, 24, 3], [13, 8, 4], [24, 4, 3], [2, 4, 3]]) suds(c, x, y, r)
  for (const [x, y] of [[9, 13], [19, 12], [28, 20], [2, 21], [14, 27], [25, 22], [31, 8]]) disc(c, x, y, 1, (dx, dy, edge) => (edge ? B4 : null))
  if (tints) {
    // triple foam: a pink, a blue and a yellow bubble in the white
    ;[[10, 21, 2], [23, 17, 2], [27, 28, 2]].forEach(([x, y, r], i) => suds(c, x, y, r, ...tints[i]))
  }
  // the wet foot of the bank
  c.rect(0, 31, T, 1, I1)
  if (!top) return c
  // puffs along the top, with an outline over them only: the sides run on into the next tile
  const lip = tile()
  for (const [x, y, r] of [[3, 7, 4], [10, 6, 5], [17, 8, 4], [24, 6, 5], [30, 8, 3]]) suds(lip, x, y, r, K6, I1)
  lip.rect(0, 10, T, 3, K6)
  for (const [x, y] of [[6, 5], [21, 4], [27, 6]]) lip.rect(x, y, 2, 1, I2)
  for (let x = 0; x < T; x++) {
    let y = 0
    while (y < T && !lip.solid(x, y)) y++
    c.rect(x, 0, 1, y, 0)
    c.set(x, y - 1, O)
  }
  c.blit(lip, 0, 0, { sx: 0, sy: 0, sw: T, sh: 13 })
  return c
}

/**
 * A slab soaked in black oil: a pool on top with a rainbow-sheen lip and a glossy swirl, and
 * oil running down a dark plate below. Rainbow on black is the one look nobody takes for a
 * hole or for sludge.
 */
function oilSlab() {
  // a bright steel tread plate under the oil, so the black stands out on the darkest floor
  // (the lube pit's) and the slab reads as something solid to stand on
  const c = tile(K3)
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const row = Math.floor(y / 4)
      const u = mod(x - (row % 2) * 4, 8)
      const v = y % 4
      if (u === 1 && v === 1) c.set(x, y, K5)
      else if ((u === 2 && v === 1) || (u === 1 && v === 2)) c.set(x, y, K4)
      else if (u === 2 && v === 2) c.set(x, y, K2)
    }
  }
  // runs of oil down the plate, fat drops at their ends, each with a glint
  for (const [x, n] of [[2, 8], [9, 16], [16, 5], [22, 12], [28, 7]]) {
    wrect(c, x, 9, 3, n, K0)
    wrect(c, x - 1, 9 + n - 2, 5, 3, K0)
    wrect(c, x, 9 + n + 1, 3, 1, K0)
    wset(c, x, 11, K4)
    wset(c, x + 1, 9 + n - 1, K5)
  }
  // the pool on top
  c.rect(0, 1, T, 9, K0)
  // sheen lying on it in loose waves of colour
  for (const [x0, x1, y0, dir, a, b] of [[1, 14, 5, 1, P2, B1], [17, 30, 6, -1, T0, P2]]) {
    for (let x = x0; x <= x1; x++) {
      const y = y0 - dir * Math.round(1.4 * Math.sin(((x - x0) / (x1 - x0)) * Math.PI))
      c.set(x, y, a)
      if (x > x0 + 1 && x < x1 - 1) c.set(x, y + 1, b)
    }
  }
  for (const [x, y] of [[3, 4], [16, 7], [30, 8]]) c.rect(x, y, 2, 1, K4)
  // the top: an outline, then a lip of bright sheen that shows on any background
  c.rect(0, 0, T, 1, O)
  const sheen = [[0, 3, K5], [3, 4, P3], [7, 3, B3], [10, 4, K6], [14, 3, PK], [17, 4, T2], [21, 3, K5], [24, 4, P3], [28, 4, B3]]
  for (const [x, w, col] of sheen) c.rect(x, 1, w, 1, col)
  c.rect(0, 2, T, 1, K1)
  return c
}

/** A slab of wet mud: a lumpy outlined top, a slick of wet on it, clods and grit in the dark below. */
function mudSlab({ wet = false } = {}) {
  const c = tile(M1)
  // clods: dark pockets with a lit upper left, the wet mud's own highlight
  for (const [x, y, rx, ry] of [[6, 14, 4, 3], [19, 12, 5, 3], [29, 19, 4, 3], [12, 23, 5, 3], [24, 27, 4, 2], [3, 29, 3, 2]]) {
    for (const ox of [-T, 0, T]) {
      c.ellipse(x + ox, y, rx, ry, M0)
      c.ellipse(x + ox - 1, y - 1, rx - 1, ry - 1, M1)
    }
    for (const ox of [-T, 0, T]) c.rect(x + ox - rx + 1, y - ry, Math.max(2, rx), 1, M2)
  }
  // grit
  for (const [x, y] of [[15, 17], [26, 9], [8, 28], [31, 25]]) {
    c.rect(x, y, 2, 2, K2)
    c.set(x, y, K3)
  }
  // the top: lumps, an outline over them, a lit lip, then the wet brown surface layer
  const top = [1, 1, 0, 0, 0, 0, 1, 1, 2, 2, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 2, 2, 1, 1, 0, 0, 0, 0, 0, 1, 1]
  const band = [6, 6, 7, 8, 8, 7, 6, 6, 6, 7, 8, 8, 7, 6, 7, 8, 9, 9, 8, 7, 6, 6, 6, 7, 8, 8, 8, 7, 6, 6, 6, 6]
  for (let x = 0; x < T; x++) {
    c.rect(x, 0, 1, top[x], 0)
    c.set(x, top[x], O)
    c.set(x, top[x] + 1, top[x] === 0 ? M4 : M3)
    c.rect(x, top[x] + 2, 1, band[x] - top[x] - 2, M2)
    c.set(x, band[x], M0)
  }
  for (const [x, y, w] of [[3, 3, 3], [12, 4, 4], [26, 3, 3], [18, 5, 2]]) c.rect(x, y, w, 1, M3)
  if (wet) {
    // rain standing in the ruts
    for (const [x, y, w] of [[2, 2, 4], [11, 2, 4], [25, 2, 5]]) {
      c.rect(x, y, w, 1, T2)
      c.rect(x + 1, y + 1, w - 2, 1, T1)
    }
  } else {
    for (const [x, y] of [[4, 2], [13, 3], [27, 2]]) c.rect(x, y, 2, 1, M4)
  }
  return c
}

function iceTile(top) {
  const c = tile(I1)
  // long glints running down to the right, the same in every tile so they line up
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const k = mod(x - y, 32)
      if (k === 4 || k === 5 || k === 11) c.set(x, y, I2)
      else if (k === 20 || k === 27) c.set(x, y, I0)
    }
  }
  for (const [x, y] of [[6, 20], [22, 12], [14, 27], [28, 24], [10, 9]]) wrect(c, x, y, 2, 1, K6)
  if (top) {
    bands(c, 0, [O, K6, K6, I2])
    c.rect(4, 3, 7, 1, K6)
    c.rect(20, 3, 5, 1, K6)
    c.rect(0, 4, T, 1, I1)
  }
  return c
}

function specialFloors(theme) {
  if (theme === 'winter') {
    put(`${theme}_slick_t`, iceTile(true))
    put(`${theme}_slick_m`, iceTile(false))
  } else {
    // the wash tunnels use triple foam: a pink, a blue and a yellow bubble in the white
    const tints = theme === 'tunnel' || theme === 'mega' ? [[PK, R2], [B3, B2], [Y2, Y1]] : null
    put(`${theme}_slick_t`, foamSlab(true, { tints }))
    put(`${theme}_slick_m`, foamSlab(false, { tints }))
  }
  put(`${theme}_oily_t`, oilSlab())
  put(`${theme}_mud_t`, mudSlab({ wet: theme === 'storm' }))
}

/* ------------------------------------------------------------------ */
/* Shared blocks                                                       */
/* ------------------------------------------------------------------ */

/** Loads another generated atlas (frames and sheet) without TypeScript: its file has one object literal. */
function loadAtlas(name) {
  const ts = path.join(ASSETS_DIR, `${name}.atlas.ts`)
  const png = path.join(ASSETS_DIR, `${name}.png`)
  if (!fs.existsSync(ts) || !fs.existsSync(png)) return null
  try {
    const src = fs.readFileSync(ts, 'utf8').replace(/^import .*$/gm, '').replace(/export const atlas: AtlasDef =/, 'return')
    const def = new Function('image', src)('')
    const sheet = Canvas.load(png)
    return { def, sheet, frame: (n) => (def.frames[n] ? { ...def.frames[n], canvas: sheet.crop(def.frames[n].x, def.frames[n].y, def.frames[n].w, def.frames[n].h) } : null) }
  } catch {
    return null
  }
}
const MAXX_ATLAS = loadAtlas('maxx')

const DROP = art(
  [
    '.....ww.....',
    '.....ww.....',
    '....wwww....',
    '....wwww....',
    '...wwwwww...',
    '..wwwwwwww..',
    '..wwwwwwww..',
    '.wwwwwwwwss.',
    '.wwwwwwwwss.',
    'wwwwwwwwwsss',
    'wwwwwwwwwsss',
    'wwLwwwwwssss',
    'wwLLwwwsssss',
    '.wwLLssssss.',
    '.wwsssssss..',
    '..ssssssss..',
    '....ssss....',
  ],
  { w: K6, s: B4, L: B3 },
)
const STAR = art(
  [
    '.......w.......',
    '.......w.......',
    '......www......',
    '......www......',
    '.....wwwww.....',
    'wwwwwwwwwwwwwww',
    '.wwwwwwwwwwwws.',
    '..wwwwwwwwwss..',
    '...wwwwwwwss...',
    '...wwwwwwsss...',
    '..wwwww.sssss..',
    '..wwww...ssss..',
    '.www.......sss.',
    '.w...........s.',
  ],
  { w: K6, s: R5 },
)
// a tin of wax, lid on, with a glint
const TIN = art(
  [
    '...wwwwwwwww...',
    '.wwwwwwwwwwwww.',
    'wwwwwwwwwwwwwww',
    'swwwwwwwwwwwwws',
    'rssswwwwwwwsssr',
    'rrrrsssssssrrrd',
    'rrRrrrrrrrrrrdd',
    'rrRrrrwwwrrrrdd',
    'rrRrrwwwwwrrrdd',
    'rrrrrrwwwrrrrdd',
    'rrrrrrrrrrrrrdd',
    '.rrrrrrrrrrrdd.',
    '...ddddddddd...',
  ],
  { w: K6, s: K5, r: R3, R: R5, d: R1 },
)
// the fallback when the hero atlas is not there to lend its face icon
const MASK = art(
  [
    '...bbbbbbbb...',
    '..bbBBBBBBbb..',
    '.bbBBBBBBBBbb.',
    'rrrrrrrrrrrrrr',
    'rrrwwwrrwwwrrr',
    'rrrwwkrrwwkrrr',
    'rrrrrrrrrrrrrr',
    '.tttttttttttt.',
    '.ttttkkkkkttt.',
    '..ttttwwwttt..',
    '...tttttttt...',
  ],
  { b: W6, B: W7, r: R3, w: K6, k: O, t: W4 },
)

function crate({ dk, md, lt, hi, panel }, emblem, lineCol, f) {
  const c = tile(O)
  c.rect(1, 1, 30, 30, md)
  c.rect(1, 1, 30, 2, lt)
  c.rect(1, 1, 2, 30, lt)
  c.rect(1, 29, 30, 2, dk)
  c.rect(29, 1, 2, 30, dk)
  c.set(1, 1, hi)
  c.set(2, 1, hi)
  c.set(1, 2, hi)
  // the recessed face
  c.rect(5, 5, 22, 22, dk)
  c.rect(6, 6, 21, 21, lt)
  c.rect(6, 6, 20, 20, panel ?? md)
  // corner bolts
  for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27]]) {
    c.rect(x, y, 2, 2, dk)
    c.set(x, y, hi)
  }
  // rounded corners
  for (const [x, y, ix, iy] of [[0, 0, 1, 1], [31, 0, 30, 1], [0, 31, 1, 30], [31, 31, 30, 30]]) {
    c.set(x, y, 0)
    c.set(ix, iy, O)
  }
  // the shimmer: a band of light crossing the crate once per loop
  if (f > 0) {
    const k = 6 + (f - 1) * 17
    const up = new Map([[rgba(dk), md], [rgba(md), lt], [rgba(lt), hi], [rgba(panel ?? md), lt]])
    c.map((v, x, y) => (x + y >= k && x + y < k + 6 && up.has(v) ? up.get(v) : v))
  }
  const e = lineCol ? emblem.pad(1).outline(lineCol) : emblem
  c.blit(e, Math.floor((T - e.w) / 2), Math.floor((T - e.h) / 2))
  if (f === 2) {
    // a glint on the mark as the light passes
    c.rect(21, 7, 1, 5, K6)
    c.rect(19, 9, 5, 1, K6)
  }
  return c
}

function sharedBlocks() {
  // cinder block: two courses, pocked
  const brick = tile(O)
  brick.rect(1, 1, 30, 30, K4)
  brick.rect(1, 1, 30, 1, K5)
  brick.rect(1, 1, 1, 30, K5)
  brick.rect(1, 30, 30, 1, K3)
  brick.rect(30, 1, 1, 30, K3)
  brick.rect(1, 15, 30, 1, K2)
  brick.rect(1, 16, 30, 1, K5)
  brick.rect(1, 14, 30, 1, K3)
  for (const [x, y, h] of [[16, 1, 14], [8, 16, 14], [24, 16, 14]]) {
    brick.rect(x, y, 1, h, K2)
    brick.rect(x + 1, y + 1, 1, h - 2, K5)
    brick.rect(x - 1, y + 1, 1, h - 2, K3)
  }
  for (const [x, y] of [[5, 5], [10, 9], [22, 6], [26, 11], [4, 22], [13, 20], [18, 25], [28, 21], [12, 4], [20, 11]]) brick.set(x, y, K3)
  for (const [x, y] of [[7, 11], [24, 4], [15, 27], [3, 19]]) brick.rect(x, y, 2, 1, K5)
  put('any_brick', brick)

  const head = MAXX_ATLAS?.frame('head')?.canvas ?? MASK
  const kinds = {
    prize: [{ dk: B1, md: B2, lt: B3, hi: B4 }, DROP, B0],
    power: [{ dk: R1, md: R3, lt: R4, hi: R5 }, STAR, R0],
    waxblock: [{ dk: Y0, md: Y1, lt: Y2, hi: W8 }, TIN, W0],
    lifeblock: [{ dk: G1, md: G2, lt: G3, hi: W8, panel: G1 }, head, null],
  }
  for (const [name, [cols, emblem, line]] of Object.entries(kinds)) {
    putAnim(`any_${name}`, [0, 1, 2, 3].map((f) => crate(cols, emblem, line, f)))
  }

  // a spent crate: dull, its mark gone
  const used = tile(O)
  used.rect(1, 1, 30, 30, K3)
  used.rect(1, 1, 30, 2, K4)
  used.rect(1, 1, 2, 30, K4)
  used.rect(1, 29, 30, 2, K2)
  used.rect(29, 1, 2, 30, K2)
  used.rect(5, 5, 22, 22, K2)
  used.rect(6, 6, 21, 21, K4)
  used.rect(6, 6, 20, 20, K3)
  for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27]]) used.rect(x, y, 2, 2, K2)
  used.rect(12, 14, 8, 4, K2)
  used.rect(12, 14, 8, 1, K1)
  for (const [x, y, ix, iy] of [[0, 0, 1, 1], [31, 0, 30, 1], [0, 31, 1, 30], [31, 31, 30, 30]]) {
    used.set(x, y, 0)
    used.set(ix, iy, O)
  }
  put('any_used', used)

  // riveted plate
  const steel = tile(O)
  steel.rect(1, 1, 30, 30, K4)
  steel.rect(1, 1, 30, 2, K6)
  steel.rect(1, 1, 2, 30, K5)
  steel.rect(1, 29, 30, 2, K2)
  steel.rect(29, 1, 2, 30, K3)
  steel.rect(7, 7, 18, 18, K3)
  steel.rect(8, 8, 17, 17, K5)
  steel.rect(8, 8, 16, 16, K4)
  for (const [x, y] of [[4, 4], [26, 4], [4, 26], [26, 26], [15, 4], [15, 26], [4, 15], [26, 15]]) {
    steel.rect(x, y, 2, 2, K2)
    steel.set(x, y, K6)
  }
  steel.line(11, 17, 17, 11, K5)
  steel.line(14, 20, 20, 14, K5)
  steel.line(12, 17, 17, 12, K6)
  put('any_steel', steel)

  // catwalk: a thin grated deck with a yellow edge; only the deck is drawn
  const deck = (side) => {
    const c = tile()
    bands(c, 0, [O, K6, Y1, Y1, Y0, K3, K3, K2, O])
    for (let x = 1; x < T; x += 4) c.rect(x, 5, 2, 2, K1)
    for (const x of [7, 23]) {
      c.rect(x, 9, 3, 2, O)
      c.set(x + 1, 9, K2)
    }
    if (side) {
      const x = side < 0 ? 0 : T - 1
      c.rect(x, 0, 1, 9, O)
      // a gusset under the end
      for (let i = 0; i < 6; i++) {
        const len = 6 - i
        for (let k = 0; k < len; k++) c.set(x - side * k, 9 + i, k === 0 || k === len - 1 ? O : K2)
      }
    }
    return c
  }
  put('any_catwalk', deck(0))
  put('any_catwalk_l', deck(-1))
  put('any_catwalk_r', deck(1))

  // conveyor: the belt's ribs step 4 px a frame to the left, the return run goes the other way
  putAnim('any_conv', [0, 1, 2, 3].map((f) => {
    const c = tile(K2)
    for (let x = 0; x < T; x++) {
      const on = mod(x + f * 4, 16) < 8
      c.set(x, 0, O)
      c.set(x, 1, on ? K5 : K3)
      c.rect(x, 2, 1, 4, on ? K2 : K1)
      c.set(x, 2, on ? K3 : K1)
      c.set(x, 6, O)
      const back = mod(x - f * 4, 16) < 8
      c.set(x, 25, O)
      c.rect(x, 26, 1, 5, back ? K2 : K1)
      c.set(x, 31, O)
    }
    c.rect(0, 7, T, 1, K3)
    c.rect(0, 24, T, 1, K1)
    // rollers that turn with the belt
    for (const cx of [8, 24]) {
      c.circle(cx - 0.5, 15.5, 6, O)
      c.circle(cx - 0.5, 15.5, 5, K3)
      c.circle(cx - 0.5, 15.5, 2, K1)
      const [dx, dy] = [[0, -4], [-3, -3], [-4, 0], [-3, 3]][f]
      c.rect(cx - 1 + dx, 15 + dy, 2, 2, K5)
      c.rect(cx - 1 - dx, 15 - dy, 2, 2, K5)
    }
    c.rect(15, 11, 2, 9, K1)
    return c
  }))
  const endRoller = (side) => {
    const c = tile()
    const x = side < 0 ? 0 : T - 12
    c.rect(x, 0, 12, T, O)
    c.rect(x + 1, 1, 10, 30, K3)
    c.rect(x + 1, 1, 10, 1, K5)
    c.rect(x + 1, 1, 1, 30, side < 0 ? K5 : K3)
    c.rect(x + 10, 1, 1, 30, side < 0 ? K2 : K2)
    c.rect(x + 1, 30, 10, 1, K2)
    c.circle(x + 5.5, 8.5, 4, O)
    c.circle(x + 5.5, 8.5, 3, Y1)
    c.circle(x + 5.5, 8.5, 1, Y0)
    c.set(x + 4, 6, Y2)
    for (const y of [19, 25]) {
      c.rect(x + 4, y, 4, 2, K1)
      c.rect(x + 4, y, 4, 1, K5)
    }
    return c
  }
  put('any_conv_l', endRoller(-1))
  put('any_conv_r', endRoller(1))

  // grime: a crust the prep gun eats away, with what is behind showing through the holes
  const crust = (stage) => {
    const c = tile()
    const top = [3, 2, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 3, 2, 1, 1, 1, 1, 2, 2, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 2, 3]
    const bot = [27, 28, 29, 30, 30, 29, 28, 28, 29, 30, 30, 30, 29, 28, 27, 28, 29, 30, 30, 30, 29, 28, 28, 29, 30, 30, 29, 28, 28, 29, 28, 27]
    for (let x = 1; x < T - 1; x++) {
      c.rect(x, top[x], 1, bot[x] - top[x] + 1, M1)
      c.set(x, top[x], M3)
      c.rect(x, bot[x] - 2, 1, 3, M0)
    }
    for (const [x, y, rx, ry] of [[8, 9, 4, 3], [21, 8, 5, 3], [14, 18, 5, 4], [25, 21, 3, 3], [6, 22, 3, 2]]) {
      c.ellipse(x, y, rx, ry, M2)
      c.rect(x - rx + 2, y - ry + 1, Math.max(2, rx), 1, M3)
    }
    for (const [x, y] of [[11, 13], [18, 5], [27, 14], [4, 15], [20, 26], [10, 27], [16, 12]]) c.rect(x, y, 2, 2, M0)
    for (const [x, y] of [[7, 8], [20, 7], [13, 16]]) c.set(x, y, M4)
    // dusty streaks where it dried, and drips running off the bottom
    for (const [x, y, n] of [[5, 4, 3], [23, 3, 4], [12, 21, 3]]) c.rect(x, y, n, 1, M4)
    if (stage < 2) {
      for (const [x, n] of [[6, 3], [17, 2], [26, 3]]) {
        c.rect(x, bot[x] - 1, 2, n + 1, M1)
        c.set(x, bot[x] - 1, M2)
        c.rect(x - 1 + (n > 2 ? 0 : 1), bot[x] + n - 1, n > 2 ? 3 : 2, 2, M1)
        c.set(x, bot[x] + n - 1, M3)
      }
    }
    // holes washed through it (two pinholes even when fresh: there is nothing solid behind the crust)
    const holes = [
      [[23, 13, 1, 1], [9, 21, 1, 1]],
      [[10, 12, 4, 3], [22, 20, 3, 4], [5, 24, 2, 2], [24, 7, 2, 2]],
      [[9, 11, 7, 6], [22, 19, 6, 7], [6, 24, 5, 4], [24, 7, 5, 4], [15, 24, 4, 4], [15, 3, 4, 3], [3, 8, 2, 4]],
    ][stage]
    for (const [x, y, rx, ry] of holes) c.ellipse(x, y, rx, ry, 0)
    if (stage === 2) {
      c.rect(0, 0, T, 2, 0)
      c.rect(0, 29, T, 3, 0)
    }
    const o = c.outline(O)
    // wet shine where the water has been
    if (stage) for (const [x, y] of [[13, 7], [26, 15], [8, 19], [18, 15], [19, 29]].slice(0, stage * 2 + 1)) if (o.get(x, y) !== rgba(O) && o.solid(x, y)) o.set(x, y, T2)
    return o
  }
  put('any_grime0', crust(0))
  put('any_grime1', crust(1))
  put('any_grime2', crust(2))

  // sludge: poison. Wash runoff gone bad, the pink and blue soaps stewed with grime into a purple
  // goo no floor in the game shares: a glossy magenta skin rolling on top with scum drooling off
  // it, ripples in the depths, and bubbles that rise, swell and pop.
  // The goo is a step brighter than any floor or wall in the game (the mega tunnel's floor is
  // dark purple, the vault's navy, the alley's near black), so a pit of it glows in all ten.
  const goo = (c, f = 0) => {
    c.clear(P2)
    // ripples: little arcs, lit on top
    for (const [x, y] of [[3, 13], [20, 16], [10, 21], [26, 24], [4, 28], [16, 30], [28, 11], [13, 5], [22, 2]]) {
      wset(c, x, y, P3)
      wrect(c, x + 1, y - 1, 3, 1, P3)
      wset(c, x + 4, y, P3)
      wrect(c, x + 1, y, 3, 1, P1)
    }
    for (const [x, y, n] of [[8, 17, 2], [24, 20, 3], [1, 24, 2], [19, 27, 2], [30, 30, 2], [7, 9, 2]]) wrect(c, x, y, n, 1, P1)
    // bubbles on their way up (only in the surface tile, which is the one drawn every frame)
    if (f < 0) return
    for (const [x, y0] of [[7, 30], [23, 26], [15, 34]]) {
      const y = mod(y0 - f * 4, 32)
      if (y < 12) continue
      c.circle(x, y, 1, P3, { fill: false })
      c.set(x - 1, y - 1, K6)
    }
  }
  putAnim('any_sludge_t', [0, 1, 2, 3].map((f) => {
    const c = tile()
    goo(c, f)
    const surf = (x) => 6 + Math.round(1.6 * Math.sin(((x + f * 4) / 16) * Math.PI * 2))
    for (let x = 0; x < T; x++) {
      const y = surf(x)
      c.rect(x, 0, 1, y, 0)
      c.set(x, y, O)
      c.rect(x, y + 1, 1, 2, PK)
      c.set(x, y + 3, P3)
    }
    // scum drooling off the skin, riding the swell
    for (const [x0, n] of [[2, 3], [9, 5], [15, 2], [21, 4], [28, 3]]) {
      const x = mod(x0 - f * 4)
      const y = surf(x) + 4
      c.rect(x, y, 2, n, P3)
      c.set(x, y + n, P3)
      c.set(mod(x + 1), y + n, P1)
    }
    // gloss
    for (const x0 of [4, 12, 20, 27]) {
      const x = mod(x0 - f * 4)
      c.rect(x, surf(x) + 1, x0 % 2 ? 2 : 3, 1, K6)
    }
    // two bubbles, half a loop apart: bulge, swell, swell, pop
    for (const [bx, phase] of [[10, 0], [25, 2]]) {
      const k = (f + phase) % 4
      const y = surf(bx)
      if (k === 0) {
        c.rect(bx - 1, y, 4, 1, O)
        c.rect(bx - 1, y + 1, 4, 1, PK)
        c.set(bx - 2, y + 1, O)
        c.set(bx + 3, y + 1, O)
      } else if (k === 1 || k === 2) {
        const r = k === 1 ? 2 : 4
        const cy = y - r + 2
        c.circle(bx + 0.5, cy, r, O)
        c.circle(bx + 0.5, cy, r - 1, PK)
        if (r > 2) c.circle(bx + 1.5, cy + 1, r - 3, P2)
        c.set(bx - r + 2, cy - r + 2, K6)
        if (r > 2) c.set(bx - r + 3, cy - r + 2, K6)
      } else {
        for (const [dx, dy] of [[-4, -3], [5, -4], [0, -8], [-3, -7], [4, -8], [-1, -2], [2, -2]]) c.set(bx + dx, y + dy, PK)
        for (const [dx, dy] of [[0, -9], [-5, -4], [6, -5]]) c.set(bx + dx, y + dy, O)
      }
    }
    return c
  }))
  const deep = tile()
  goo(deep, -1)
  put('any_sludge_m', deep)

  // spikes: a tyre-shredder strip
  const spikes = tile()
  const teeth = new Canvas(T, T)
  for (let k = 0; k < 4; k++) {
    for (let y = 13; y <= 26; y++) {
      const hw = Math.min(3, Math.floor(((y - 13) * 3.4) / 13))
      for (let x = 3 - hw; x <= 4 + hw; x++) teeth.set(k * 8 + x, y, x <= 3 ? K6 : K4)
    }
    teeth.rect(k * 8 + 3, 15, 1, 6, K5)
    teeth.rect(k * 8 + 6, 23, 1, 3, K3)
    teeth.set(k * 8 + 3, 13, K6)
    teeth.set(k * 8 + 4, 13, K6)
  }
  spikes.blit(teeth.pad(0, 1, 0, 0).outline(O).crop(0, 1, T, T), 0, 0)
  bands(spikes, 27, [O, Y2, Y1, Y1, O])
  hazard(spikes, 0, 28, T, 3, Y1, K0, { on: 5 })
  spikes.rect(0, 28, T, 1, Y2)
  for (let x = 0; x < T; x++) if (mod(x + 1, 8) >= 5) spikes.set(x, 28, K1)
  put('any_spikes', spikes)

  // drain pipe, two tiles wide: body 58 px, rim the full 64
  const shadeAt = (X, [hi, lt, md, sh, dk]) => (X < 3 ? md : X < 8 ? lt : X < 11 ? hi : X < 16 ? lt : X < 40 ? md : X < 52 ? sh : dk)
  // grey steel with a cold blue sheen; the rim band a step darker
  const BODY_COLS = [K6, I1, K4, K3, K2]
  const RIM_COLS = [I1, K4, K3, K2, K1]
  const pipe = new Canvas(64, T)
  for (let X = 4; X < 60; X++) pipe.rect(X, 0, 1, T, shadeAt(X - 4, BODY_COLS))
  pipe.rect(3, 0, 1, T, O)
  pipe.rect(60, 0, 1, T, O)
  const rim = pipe.clone()
  for (let X = 1; X < 63; X++) rim.rect(X, 1, 1, 12, shadeAt(Math.round(((X - 1) * 55) / 61), RIM_COLS))
  rim.rect(0, 0, 64, 1, O)
  rim.rect(0, 13, 64, 1, O)
  rim.rect(0, 0, 1, 14, O)
  rim.rect(63, 0, 1, 14, O)
  rim.rect(1, 1, 62, 1, I2)
  rim.rect(1, 12, 62, 1, K1)
  rim.rect(1, 2, 1, 10, I1)
  for (let X = 4; X < 60; X++) rim.set(X, 14, X < 44 ? K3 : K2)
  for (let X = 4; X < 60; X++) rim.set(X, 15, X < 20 ? I0 : rim.get(X, 15))
  put('any_pipe_tl', rim.crop(0, 0, T, T))
  put('any_pipe_tr', rim.crop(T, 0, T, T))
  put('any_pipe_l', pipe.crop(0, 0, T, T))
  put('any_pipe_r', pipe.crop(T, 0, T, T))
}

/* ------------------------------------------------------------------ */
/* Build the tiles                                                     */
/* ------------------------------------------------------------------ */

for (const theme of THEMES) {
  groundSet(theme)
  const wall = tile()
  WALL[theme].body(wall)
  const wallT = wall.clone()
  WALL[theme].cap(wallT)
  put(`${theme}_wall`, wall)
  put(`${theme}_wall_t`, wallT)
  pillarSet(theme)
  specialFloors(theme)
}
// the any_ ground is the lot's, so a tile character draws in a theme nobody has heard of
for (const key of ['ground_t', 'ground_tl', 'ground_tr', 'ground_m', 'ground_m2', 'ground_l', 'ground_r', 'wall', 'wall_t']) put(`any_${key}`, F.get(`lot_${key}`).canvas)
pillarSet('any')
specialFloors('any')
sharedBlocks()

/* ------------------------------------------------------------------ */
/* Decor props                                                         */
/* ------------------------------------------------------------------ */

/** name -> { w, h, themes, front?, ticks?, note } for atlas.meta.decor. */
const DECOR = {}

// Scenery only: nothing here has a light lip like a floor, a flat crate top, a spike or a drip,
// so nobody tries to stand on a prop or jumps one in fear. Every word on them is our own.

/** A 5x7 capital font of our own for the words on signs. */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
}
function sayW(s, { scale = 1, bold = false } = {}) {
  let w = 0
  for (const ch of s) w += (GLYPHS[ch][0].length + (bold ? 1 : 0) + 1) * scale
  return w - scale
}
/** Words in the 5x7 font with their top-left at (x, y); bold doubles every stroke sideways. */
function say(c, x, y, s, col, { scale = 1, bold = false } = {}) {
  let cx = x
  for (const ch of s) {
    const g = GLYPHS[ch]
    if (!g) throw new Error(`no glyph for "${ch}"`)
    for (let j = 0; j < 7; j++) for (let i = 0; i < g[0].length; i++) if (g[j][i] === '#') c.rect(cx + i * scale, y + j * scale, scale * (bold ? 2 : 1), scale, col)
    cx += (g[0].length + (bold ? 1 : 0) + 1) * scale
  }
  return cx - x - scale
}
const sayAt = (c, cx, y, s, col, o = {}) => say(c, cx - Math.floor(sayW(s, o) / 2), y, s, col, o)
/** Centred words with a 1 px shadow down and to the right. */
const sayShadow = (c, cx, y, s, col, shadow, o = {}) => {
  sayAt(c, cx + 1, y + 1, s, shadow, o)
  sayAt(c, cx, y, s, col, o)
}
/** Small 3x5 words, centred. */
const tiny = (c, cx, y, s, col) => c.text(cx - Math.floor((s.length * 4 - 1) / 2), y, s, col)
/**
 * Neon words: a light core with a 1 px glow round it. Letters listed in `dead` are an unlit
 * dark tube instead (the flicker frames).
 */
function neon(c, cx, y, s, core, glow, deadCol, { scale = 2, dead = [] } = {}) {
  const w = sayW(s, { scale })
  const live = new Canvas(w + 2, 7 * scale + 2)
  const off = new Canvas(w + 2, 7 * scale + 2)
  let x = 1
  ;[...s].forEach((ch, i) => {
    x += say(dead.includes(i) ? off : live, x, 1, ch, dead.includes(i) ? deadCol : core, { scale }) + scale
  })
  live.outline(glow)
  const x0 = cx - Math.floor(w / 2) - 1
  c.blit(off, x0, y - 1)
  c.blit(live, x0, y - 1)
}

/** A round thing shaded across its width: lit columns on the left, dark on the right. */
function shadeCols(c, x, y, w, h, lt, md, dk, { l = 2, r = 2 } = {}) {
  c.rect(x, y, w, h, md)
  c.rect(x, y, l, h, lt)
  c.rect(x + w - r, y, r, h, dk)
}
/** Recolour pixels of the listed colours where test(x, y) holds. */
function tint(c, pairs, test = () => true) {
  const m = new Map(pairs.map(([a, b]) => [rgba(a), rgba(b)]))
  c.map((v, x, y) => (m.has(v) && test(x, y) ? m.get(v) : v))
}
const DROP_S = art(['..ww..', '..ww..', '.wwww.', '.wwww.', 'wwwwws', 'wwwwss', '.wwss.', '..ss..'], { w: K6, s: K5 })
const STAR5 = art(['..y..', '.yyy.', 'yyyyy', '.yyy.', '.y.y.'], { y: Y1 })

/** Every empty row at the top and bottom cut away, so the lowest pixel row is the one standing on the floor. */
function fit(frames) {
  let y0 = Infinity
  let y1 = -1
  for (const c of frames) {
    const b = c.bounds()
    if (!b) continue
    y0 = Math.min(y0, b.y)
    y1 = Math.max(y1, b.y + b.h - 1)
  }
  return frames.map((c) => c.crop(0, y0, c.w, y1 - y0 + 1))
}
// Props that carry words or letters: flipped they read backwards, so the meta says so.
const WORDS = new Set(['sign_mw', 'sign_vacuums', 'sign_vacuums_left', 'air_machine', 'menu_board', 'banner_grand', 'sign_open', 'arch_tunnel', 'arch_mega', 'sign_exit', 'oil_drum', 'sign_lube', 'billboard', 'sign_highway', 'portrait', 'crest', 'neon_mw', 'neon_open', 'poster_bill', 'stencil_employees', 'flag'])
const entry = (name, w, h, themes, note, front, ticks) => ({
  w,
  h,
  themes,
  ...(front ? { front } : {}),
  ...(ticks ? { ticks } : {}),
  ...(WORDS.has(name) ? { words: true } : {}),
  note: WORDS.has(name) ? `${note} Has words: never flip it.` : note,
})
function addProp(name, c, themes, note, { front = false } = {}) {
  ;[c] = fit([c])
  if (c.w % 2) throw new Error(`prop ${name} is ${c.w} wide: make it even so it centres on its tile`)
  put(`decor_${name}`, c, c.w / 2, c.h)
  DECOR[name] = entry(name, c.w, c.h, themes, note, front, 0)
}
/** frames: canvases; order: frame indices to play (may repeat), default each once. */
function addPropAnim(name, frames, themes, note, ticks, { front = false, order = null } = {}) {
  frames = fit(frames)
  const { w, h } = frames[0]
  if (w % 2) throw new Error(`prop ${name} is ${w} wide: make it even so it centres on its tile`)
  putAnim(`decor_${name}`, frames, w / 2, h)
  if (order) ANIMS[`decor_${name}`] = order.map((i) => `decor_${name}${i}`)
  DECOR[name] = entry(name, w, h, themes, note, front, ticks)
}
const rep = (i, n) => Array(n).fill(i)

/* ---- the lot and the vacuum bays ---- */

{
  const c = new Canvas(16, 22)
  c.rect(1, 17, 14, 3, K1)
  c.rect(1, 17, 14, 1, K2)
  for (let y = 2; y <= 16; y++) {
    const hw = 1 + Math.round(((y - 2) * 4.6) / 14)
    c.rect(8 - hw, y, hw * 2, 1, OR1)
    c.set(8 - hw, y, OR2)
    c.set(7 + hw, y, OR0)
  }
  tint(c, [[OR1, K6], [OR2, K6], [OR0, K4]], (x, y) => y === 7 || y === 8 || y === 12 || y === 13)
  c.outline(O)
  addProp('cone', c, ['lot', 'vacuum', 'tunnel', 'storm', 'lube', 'highway', 'winter', 'backlot'], 'Traffic cone, half a tile tall. Line a lane with a few.')
}

{
  const c = new Canvas(40, 166)
  c.rect(13, 155, 14, 9, K4)
  c.rect(13, 155, 14, 1, K5)
  c.rect(13, 155, 1, 9, K5)
  c.rect(26, 156, 1, 8, K3)
  shadeCols(c, 18, 12, 4, 143, K4, K3, K2, { l: 1, r: 1 })
  c.rect(17, 9, 6, 4, K3)
  c.rect(17, 9, 6, 1, K4)
  c.rect(22, 13, 6, 3, K3)
  c.rect(22, 13, 6, 1, K4)
  c.rect(26, 9, 12, 7, K2)
  c.rect(26, 9, 12, 1, K3)
  c.rect(28, 16, 8, 2, Y2)
  c.rect(30, 16, 4, 1, W8)
  // Mighty Wash banners, red and blue, on a bracket
  c.rect(7, 40, 26, 2, K2)
  for (const [x, col, lt, dk] of [[8, R3, R4, R1], [24, B2, B3, B1]]) {
    c.rect(x, 42, 8, 30, col)
    c.rect(x, 42, 1, 30, lt)
    c.rect(x + 7, 42, 1, 30, dk)
    c.rect(x + 3, 70, 2, 2, 0)
    c.blit(DROP_S, x + 1, 47)
    c.rect(x + 1, 58, 6, 1, K6)
    c.rect(x + 1, 61, 6, 1, K6)
  }
  c.outline(O)
  addProp('light_pole', c, ['lot', 'vacuum', 'storm', 'highway', 'winter', 'backlot'], 'Lot light, 5 tiles tall, with red and blue Mighty Wash banners. Space them 8 to 12 tiles apart.')
}

{
  const c = new Canvas(104, 134)
  // posts straight into the ground on small footings: no planter box to mistake for a step
  for (const x of [32, 64]) {
    shadeCols(c, x, 64, 8, 62, K4, K3, K2)
    c.rect(x - 2, 126, 12, 6, K3)
    c.rect(x - 2, 126, 12, 1, K4)
    c.rect(x + 1, 80, 2, 30, K5)
  }
  // (no planting at its feet: it stands in the snow and the mud too; place a bush beside it)
  c.rect(2, 20, 100, 46, NAVY)
  c.rect(4, 22, 96, 42, K6)
  c.rect(4, 22, 96, 3, R3)
  c.rect(4, 61, 96, 3, B2)
  for (const [x, y] of [[2, 20], [101, 20], [2, 65], [101, 65]]) c.set(x, y, 0)
  sayShadow(c, 52, 28, 'MIGHTY', R3, R1, { scale: 2, bold: true })
  sayShadow(c, 52, 45, 'WASH', B1, B0, { scale: 2, bold: true })
  // the drop badge sits up on top, so the board never reads as a ledge
  c.circle(52, 13, 11, NAVY)
  c.circle(52, 13, 9, B2)
  c.circle(50, 11, 5, B3)
  c.circle(52, 13, 9, B2, { fill: false })
  c.blit(DROP, 46, 5)
  c.outline(O)
  addProp('sign_mw', c, ['lot', 'vacuum', 'storm', 'highway', 'winter'], 'The MIGHTY WASH pylon sign, 3 tiles wide and 4 tall. One near the start of a level.')
}

{
  const c = new Canvas(36, 64)
  c.rect(4, 57, 28, 5, K2)
  c.rect(4, 57, 28, 1, K3)
  shadeCols(c, 7, 16, 22, 41, K6, K5, K4)
  c.rect(5, 5, 26, 12, R3)
  c.rect(5, 5, 26, 2, R4)
  c.rect(5, 5, 2, 12, R4)
  c.rect(5, 15, 26, 2, R1)
  c.set(5, 5, 0)
  c.set(30, 5, 0)
  c.blit(DROP_S, 15, 7)
  c.rect(10, 20, 16, 12, NAVY)
  c.rect(11, 21, 14, 10, B1)
  c.rect(12, 23, 8, 1, B3)
  c.rect(12, 26, 5, 1, B3)
  c.rect(12, 28, 9, 1, B3)
  c.set(23, 22, B4)
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) c.rect(11 + i * 3, 35 + j * 3, 2, 2, K3)
  c.rect(21, 35, 4, 2, G2)
  c.rect(21, 39, 4, 2, R3)
  c.rect(21, 43, 4, 1, K0)
  c.rect(11, 48, 14, 2, K1)
  c.rect(11, 48, 14, 1, K0)
  c.outline(O)
  addProp('kiosk', c, ['lot', 'vacuum', 'winter'], 'Pay station at the tunnel entrance, 2 tiles tall.')
}

{
  const frames = [0, 1, 2, 3].map((f) => {
    const c = new Canvas(28, 96)
    c.rect(2, 90, 7, 4, K2)
    c.rect(2, 90, 7, 1, K3)
    c.rect(4, 3, 2, 88, K3)
    c.rect(4, 3, 1, 88, K4)
    const mid = []
    for (let y = 5; y <= 76; y++) {
      const t = (y - 5) / 71
      const wdt = Math.round(5 + 10 * Math.sqrt(Math.min(1, (y - 5) / 8)) - 6 * t * t)
      const wave = Math.round(1.6 * Math.sin(y / 9 - (f * Math.PI) / 2) * t)
      const x1 = 6 + wdt + wave
      c.rect(6, y, x1 - 5, 1, R3)
      c.rect(6, y, 2, 1, B2)
      c.set(8, y, R4)
      c.set(x1, y, R1)
      mid[y] = Math.round((9 + x1) / 2)
    }
    c.blit(DROP_S, mid[16] - 3, 12)
    ;['W', 'A', 'S', 'H'].forEach((ch, i) => c.text(mid[31 + i * 7] - 1, 29 + i * 7, ch, K6))
    c.outline(O)
    return c
  })
  addPropAnim('flag', frames, ['lot', 'vacuum', 'highway'], 'Feather flag that ripples, about 3 tiles tall. Plant a row of them along the entrance.', 10)
}

{
  const c = new Canvas(44, 26)
  c.ellipse(22, 17, 20, 6, G1)
  for (const [x, y, rx, ry] of [[11, 14, 8, 7], [23, 10, 10, 8], [34, 14, 8, 7]]) c.ellipse(x, y, rx, ry, G1)
  for (const [x, y, rx, ry] of [[10, 13, 7, 6], [22, 9, 9, 7], [33, 13, 7, 6]]) c.ellipse(x, y, rx, ry, G2)
  for (const [x, y, rx, ry] of [[8, 10, 3, 2], [19, 5, 4, 2], [31, 9, 3, 2]]) c.ellipse(x, y, rx, ry, G3)
  for (const [x, y] of [[15, 17], [27, 18], [6, 18], [36, 17], [21, 14], [29, 12], [12, 12]]) c.rect(x, y, 2, 1, G1)
  for (const [x, y] of [[13, 8], [26, 11], [37, 10], [17, 15]]) c.set(x, y, Y2)
  c.rect(0, 23, 44, 3, 0)
  c.outline(O)
  addProp('bush', c, ['lot', 'vacuum'], 'Low round shrub from the planters, under a tile tall.')
}

/** A mesquite: a low twisted trunk under a wide feathery crown, or bare with snow on the boughs. */
function mesquite(bare) {
  const c = new Canvas(84, 82)
  const limbs = [
    [[[42, 80], [41, 66], [38, 54], [30, 42], [20, 34]], 5],
    [[[39, 56], [48, 46], [58, 36], [67, 31]], 4],
    [[[40, 52], [42, 40], [40, 28]], 3],
    [[[30, 42], [24, 28], [18, 22]], 2],
    [[[58, 36], [61, 25], [66, 20]], 2],
    [[[20, 34], [10, 30], [5, 24]], 2],
    [[[67, 31], [76, 30], [80, 24]], 2],
    [[[40, 28], [34, 18]], 1],
    [[[40, 28], [47, 17]], 1],
    // a second stem from the foot, and boughs weeping down at both ends
    [[[39, 80], [35, 70], [29, 60], [22, 52]], 3],
    [[[22, 52], [14, 50], [10, 47]], 1],
    [[[20, 34], [9, 39], [7, 44]], 1],
    [[[67, 31], [75, 37], [72, 45]], 1],
  ]
  for (const [pts, th] of limbs) for (let i = 0; i + 1 < pts.length; i++) c.line(...pts[i], ...pts[i + 1], M2, th)
  const bark = rgba(M2)
  c.map((v, x, y) => (v === bark && !c.solid(x - 1, y) ? rgba(M3) : v === bark && !c.solid(x + 1, y) ? rgba(M1) : v))
  if (bare) {
    // snow along the tops of the boughs
    const snow = []
    for (let y = 1; y < c.h; y++) for (let x = 0; x < c.w; x++) if (c.solid(x, y) && !c.solid(x, y - 1) && y < 70) snow.push([x, y - 1])
    for (const [x, y] of snow) c.set(x, y, K6)
  } else {
    // loose feathery clumps with sky between them, the outer ones drooping low: a mesquite
    // sprawls and weeps, where an umbrella crown would make it an acacia
    const clumps = [[16, 31, 9, 5], [31, 21, 10, 5], [49, 17, 11, 5], [66, 26, 10, 5], [41, 33, 8, 4], [58, 36, 7, 4], [24, 40, 6, 3], [76, 38, 6, 4], [7, 40, 6, 4], [70, 46, 4, 3], [12, 49, 4, 3]]
    for (const [x, y, rx, ry] of clumps) c.ellipse(x, y, rx, ry, G1)
    for (const [x, y, rx, ry] of clumps) c.ellipse(x - 1, y - 2, rx - 2, ry - 2, G2)
    for (const [x, y, rx] of clumps) c.rect(x - rx + 3, y - 4, Math.max(2, rx - 5), 1, G3)
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(rnd(i, 1, 33) * 84)
      const y = Math.floor(rnd(i, 2, 33) * 52)
      if (c.get(x, y) === rgba(G2)) c.rect(x, y, 2, 1, G1)
    }
  }
  c.outline(O)
  return c
}
addProp('mesquite', mesquite(false), ['lot', 'vacuum', 'storm', 'highway'], 'West Texas mesquite tree, 2.5 tiles tall and wide.')
addProp('mesquite_bare', mesquite(true), ['winter'], 'Bare mesquite with snow along its boughs, 2.5 tiles tall.')

{
  const c = new Canvas(48, 88)
  c.rect(12, 82, 24, 4, K3)
  c.rect(12, 82, 24, 1, K4)
  shadeCols(c, 16, 24, 16, 58, K6, K5, K4)
  c.rect(16, 38, 16, 3, B2)
  c.rect(16, 38, 16, 1, B3)
  c.rect(14, 12, 20, 13, R3)
  c.rect(14, 12, 20, 2, R4)
  c.rect(14, 12, 2, 13, R4)
  c.rect(14, 23, 20, 2, R1)
  c.blit(DROP_S, 21, 14)
  c.rect(19, 45, 10, 13, K2)
  c.rect(20, 46, 8, 1, K3)
  c.rect(22, 49, 4, 1, K0)
  c.rect(22, 53, 4, 2, Y1)
  c.rect(23, 4, 3, 9, K3)
  c.rect(23, 4, 20, 3, K3)
  c.rect(23, 4, 20, 1, K4)
  const hose = [[42, 7], [43, 22], [43, 40], [40, 54], [35, 60], [32, 56], [33, 48]]
  for (let i = 0; i + 1 < hose.length; i++) c.line(...hose[i], ...hose[i + 1], K1, 3)
  for (let i = 0; i + 1 < hose.length; i++) c.line(hose[i][0] - 1, hose[i][1], hose[i + 1][0] - 1, hose[i + 1][1], K2)
  c.rect(31, 42, 4, 7, K3)
  c.rect(31, 42, 1, 7, K4)
  c.outline(O)
  addProp('vacuum', c, ['vacuum', 'lot'], 'Self-serve vacuum post with its hose on a boom, under 3 tiles tall. One every 3 or 4 tiles makes a row of bays.')
}

{
  const c = new Canvas(112, 116)
  for (const x of [4, 96]) {
    c.rect(x, 108, 12, 6, K3)
    c.rect(x, 108, 12, 1, K4)
  }
  for (const x of [6, 98]) shadeCols(c, x, 30, 8, 78, B2, B1, B0)
  for (let x = 6; x <= 105; x++) {
    const u = (x - 55.5) / 49.5
    const top = Math.round(34 - Math.sqrt(Math.max(0, 1 - u * u)) * 28)
    c.rect(x, top, 1, 7, B1)
    c.rect(x, top, 1, 2, B2)
    c.set(x, top + 6, B0)
  }
  c.rect(36, 13, 1, 3, K2)
  c.rect(75, 13, 1, 3, K2)
  c.rect(30, 15, 52, 14, R3)
  c.rect(30, 15, 52, 1, R4)
  c.rect(30, 28, 52, 1, R1)
  sayAt(c, 56, 18, 'VACUUMS', K6)
  for (const [x, s] of [[24, 1], [87, -1]]) {
    const pts = [[x, 18], [x + s, 40], [x - 2 * s, 58], [x, 70]]
    for (let i = 0; i + 1 < pts.length; i++) c.line(...pts[i], ...pts[i + 1], K1, 3)
    for (let i = 0; i + 1 < pts.length; i++) c.line(pts[i][0] - 1, pts[i][1], pts[i + 1][0] - 1, pts[i + 1][1], K2)
    c.rect(x - 2, 70, 4, 9, K3)
    c.rect(x - 2, 70, 1, 9, K4)
    c.rect(x - 1, 79, 2, 2, K2)
  }
  c.outline(O)
  addProp('vacuum_arch', c, ['vacuum'], 'Blue vacuum arch with a VACUUMS sign and two hanging hoses, 3.5 tiles wide and tall. Park a car under it.')
}

{
  const c = new Canvas(24, 30)
  shadeCols(c, 3, 8, 18, 20, B2, B1, B0, { l: 3, r: 2 })
  for (const y of [11, 24]) c.rect(3, y, 18, 1, B0)
  c.rect(3, 15, 18, 6, K6)
  c.rect(3, 20, 18, 1, K5)
  for (const [x, y] of [[11, 16], [11, 17], [10, 18], [11, 18], [12, 18], [10, 19], [11, 19], [12, 19]]) c.set(x, y, B2)
  c.rect(2, 5, 20, 3, K3)
  c.rect(2, 5, 20, 1, K4)
  c.rect(4, 3, 16, 2, K3)
  c.rect(4, 3, 16, 1, K4)
  c.rect(10, 2, 4, 1, K2)
  c.outline(O)
  addProp('trash_can', c, ['lot', 'vacuum', 'highway', 'backlot'], 'Blue trash can with a domed lid, under a tile tall.')
}

{
  const c = new Canvas(52, 24)
  for (const x of [6, 43]) {
    c.rect(x, 15, 3, 7, K2)
    c.rect(x, 2, 2, 12, K2)
  }
  c.rect(2, 12, 48, 3, W3)
  c.rect(2, 12, 48, 1, W5)
  c.rect(2, 14, 48, 1, W2)
  for (const y of [3, 7]) {
    c.rect(4, y, 44, 3, W3)
    c.rect(4, y, 44, 1, W5)
    c.rect(4, y + 2, 44, 1, W2)
  }
  c.outline(O)
  addProp('bench', c, ['lot', 'vacuum'], 'Wooden bench, 1.5 tiles wide.')
}

for (const left of [false, true]) {
  const c = new Canvas(68, 66)
  for (const x of [14, 50]) shadeCols(c, x, 28, 4, 36, K4, K3, K2, { l: 1, r: 1 })
  c.rect(2, 2, 64, 28, NAVY)
  c.rect(4, 4, 60, 24, B1)
  c.rect(4, 4, 60, 1, B2)
  sayAt(c, 34, 7, 'VACUUMS', K6, { bold: true })
  // the arrow alone is mirrored for the left-hand sign, never the word
  const arrow = new Canvas(68, 66)
  arrow.rect(18, 19, 24, 3, Y1)
  for (let i = 0; i < 5; i++) arrow.rect(42 + i, 16 + i, 1, 9 - 2 * i, Y1)
  c.blit(left ? arrow.flipX() : arrow, 0, 0)
  c.outline(O)
  if (left) addProp('sign_vacuums_left', c, ['vacuum', 'lot'], 'The VACUUMS sign with its arrow pointing left.')
  else addProp('sign_vacuums', c, ['vacuum', 'lot'], 'VACUUMS sign with an arrow pointing right, 2 tiles wide and tall. For one pointing left use sign_vacuums_left.')
}

{
  const c = new Canvas(34, 64)
  c.rect(5, 58, 22, 4, K2)
  c.rect(5, 58, 22, 1, K3)
  shadeCols(c, 6, 12, 20, 46, R4, R3, R1)
  c.rect(5, 8, 22, 5, K3)
  c.rect(5, 8, 22, 1, K4)
  c.rect(7, 16, 18, 15, K6)
  c.rect(7, 30, 18, 1, K5)
  tiny(c, 16, 18, 'FREE', R3)
  tiny(c, 16, 24, 'AIR', B1)
  c.circle(16, 39, 3, K6)
  c.circle(16, 39, 3, K2, { fill: false })
  c.line(16, 39, 17, 37, K0)
  c.rect(26, 33, 3, 2, K2)
  c.ellipse(29, 44, 2, 8, Y1, { fill: false })
  c.ellipse(28, 45, 2, 7, Y0, { fill: false })
  c.line(29, 52, 28, 55, Y1)
  c.outline(O)
  addProp('air_machine', c, ['vacuum', 'lot', 'highway'], 'FREE AIR tyre pump with a coiled yellow hose, 2 tiles tall.')
}

{
  const c = new Canvas(88, 106)
  for (const x of [20, 64]) shadeCols(c, x, 64, 5, 40, K4, K3, K2, { l: 1, r: 1 })
  c.rect(2, 2, 84, 64, NAVY)
  c.rect(4, 4, 80, 60, K6)
  c.rect(4, 4, 80, 13, R3)
  c.rect(4, 4, 80, 1, R4)
  tiny(c, 44, 8, 'MIGHTY WASH', K6)
  ;[[W2, W4, 1], [K3, K5, 2], [Y0, Y1, 3]].forEach(([dk, md, n], i) => {
    const y = 21 + i * 14
    c.rect(8, y, 11, 11, dk)
    c.rect(9, y + 1, 9, 9, md)
    c.rect(9, y + 1, 9, 1, K6)
    c.blit(DROP_S, 10, y + 2, { swap: { [K5]: dk } })
    for (let s = 0; s < n; s++) c.blit(STAR5, 23 + s * 7, y + 3)
    c.rect(46, y + 2, 32, 2, K3)
    c.rect(46, y + 6, 22, 2, K4)
    if (i < 2) c.rect(6, y + 12, 76, 1, K5)
  })
  c.outline(O)
  addProp('menu_board', c, ['lot', 'vacuum'], 'Wash menu: three packages, one to three stars. 3 tiles tall.')
}

{
  const frames = [0, 1].map((f) => {
    const c = new Canvas(40, 86)
    const bob = f ? -1 : 0
    c.rect(16, 79, 8, 5, K2)
    c.rect(16, 79, 8, 1, K3)
    const list = [[10, 18, R2, R3, R5], [22, 11, B1, B2, B4], [31, 21, Y0, Y1, Y2], [16, 30, K5, K6, K6], [28, 34, R2, R3, R5]]
    list.forEach(([x, y], i) => c.line(x + (f && i % 2 ? 1 : 0), y + 8 + bob, 20, 79, K4))
    list.forEach(([x, y, dk, md, hl], i) => {
      const xx = x + (f && i % 2 ? 1 : 0)
      const yy = y + bob
      c.ellipse(xx, yy, 6, 7, dk)
      c.ellipse(xx - 1, yy - 1, 5, 6, md)
      c.rect(xx - 3, yy - 4, 2, 2, hl)
      c.rect(xx - 1, yy + 7, 3, 1, dk)
    })
    c.outline(O)
    return c
  })
  addPropAnim('balloons', frames, ['lot'], 'Grand Opening balloons tied to a weight, they bob. Under 3 tiles tall.', 24)
}

{
  const c = new Canvas(104, 66)
  for (const x of [2, 99]) {
    shadeCols(c, x, 4, 3, 60, K4, K3, K2, { l: 1, r: 1 })
    c.rect(x, 2, 3, 2, K4)
  }
  const sag = (x) => Math.round(7 + 5 * Math.sin(((x - 5) / 94) * Math.PI))
  for (let x = 5; x < 99; x++) c.set(x, sag(x), K2)
  for (let i = 0; i < 11; i++) {
    const x = 9 + i * 8
    c.poly([[x, sag(x) + 1], [x + 5, sag(x + 5) + 1], [x + 2, sag(x) + 6]], [R3, B2, Y1][i % 3])
  }
  c.rect(8, 18, 88, 32, R3)
  c.rect(8, 18, 88, 3, B2)
  c.rect(8, 47, 88, 3, B2)
  c.rect(8, 21, 88, 1, R4)
  for (const y of [19, 48]) {
    c.rect(5, y, 3, 1, K2)
    c.rect(96, y, 3, 1, K2)
  }
  for (const [x, y] of [[10, 23], [93, 23], [10, 44], [93, 44]]) c.set(x, y, K5)
  sayShadow(c, 52, 25, 'GRAND', K6, R1, { bold: true })
  sayShadow(c, 52, 36, 'OPENING', K6, R1, { bold: true })
  for (const x of [16, 83]) c.blit(STAR5, x, 32, { swap: { [Y1]: Y2 } })
  c.outline(O)
  addProp('banner_grand', c, ['lot'], 'GRAND OPENING banner between two poles, 3 tiles wide, 2 tall.')
}

{
  const frames = [0, 1, 2, 3].map((f) => {
    const c = new Canvas(56, 106)
    const sway = [-6, -1, 5, 1][f]
    const xAt = (y) => 28 + sway * Math.pow((94 - y) / 76, 1.6)
    const sx = Math.round(xAt(44))
    for (const deg of [[-150, -112, -170, -128][f], [-35, -72, -12, -55][f]]) {
      const r = (deg * Math.PI) / 180
      const ex = Math.round(sx + Math.cos(r) * 20)
      const ey = Math.round(44 + Math.sin(r) * 20)
      c.line(sx, 44, ex, ey, B1, 5)
      c.line(sx, 43, ex, ey - 1, B2, 3)
      c.line(sx - 1, 42, ex - 1, ey - 2, B3)
    }
    for (let y = 20; y <= 94; y++) {
      const x = Math.round(xAt(y))
      c.rect(x - 5, y, 10, 1, R3)
      c.rect(x - 5, y, 2, 1, R4)
      c.rect(x + 3, y, 2, 1, R1)
    }
    const hx = Math.round(xAt(20))
    c.ellipse(hx - 0.5, 19, 4.5, 4, R3)
    for (let i = -2; i <= 2; i++) c.line(hx + i * 2, 16, hx + i * 3, 9 + Math.abs(i) * 2, B2)
    c.rect(hx - 4, 21, 3, 4, K6)
    c.rect(hx + 1, 21, 3, 4, K6)
    c.set(hx - 3 + (sway > 0 ? 1 : 0), 23, O)
    c.set(hx + 2 + (sway > 0 ? 1 : 0), 23, O)
    c.rect(hx - 3, 27, 6, 3, O)
    c.rect(hx - 2, 29, 4, 1, R5)
    c.rect(16, 94, 24, 10, K2)
    c.rect(16, 94, 24, 1, K3)
    for (let x = 18; x < 38; x += 3) c.rect(x, 96, 1, 6, K1)
    c.outline(O)
    return c
  })
  addPropAnim('tube_man', frames, ['lot', 'highway'], 'Inflatable tube man waving his arms over a fan, 3 tiles tall. Pure fun.', 8)
}

{
  const c = new Canvas(36, 38)
  c.poly([[9, 2], [26, 2], [33, 35], [2, 35]], R3)
  c.poly([[11, 5], [24, 5], [29, 31], [6, 31]], K6)
  // low on the board, where it is wide enough for the word
  tiny(c, 18, 15, 'OPEN', R3)
  c.rect(11, 25, 9, 2, B2)
  c.poly([[20, 22], [23, 25], [20, 28]], B2)
  c.rect(10, 1, 16, 2, K2)
  c.outline(O)
  addProp('sign_open', c, ['lot', 'vacuum', 'lube'], 'Sandwich board saying OPEN, a tile tall.')
}

{
  const c = new Canvas(56, 56)
  for (const x of [4, 49]) {
    c.rect(x, 8, 3, 46, K3)
    c.rect(x, 8, 1, 46, K4)
    c.rect(x - 2, 52, 7, 2, K2)
  }
  c.rect(2, 6, 52, 4, K3)
  c.rect(2, 6, 52, 1, K4)
  for (const [x, len, col, rib] of [[13, 26, K1, K2], [24, 30, B0, B1], [35, 24, K1, K2], [44, 28, K2, K3]]) {
    c.rect(x - 1, 10, 3, 3, K2)
    c.rect(x - 4, 13, 9, len, col)
    for (let y = 16; y < 12 + len; y += 3) c.rect(x - 3, y, 7, 1, rib)
  }
  c.outline(O)
  addProp('mat_rack', c, ['vacuum'], 'Floor-mat clip rack with four mats hanging, under 2 tiles tall. Put one between vacuums.')
}

{
  const grass = (cols, line) => {
    const c = new Canvas(32, 15)
    ;[[4, 7, -1], [7, 10, 0], [10, 6, 1], [13, 11, -1], [16, 8, 0], [19, 12, 1], [22, 7, -1], [25, 10, 1], [28, 6, 0]].forEach(([x, len, lean], i) => {
      c.line(x, 13, x + lean * 2, 13 - len, cols[i % 3])
      c.line(x + 1, 13, x + 1 + lean * 2, 14 - len, cols[(i + 1) % 3])
    })
    c.outline(line)
    return c
  }
  addProp('grass', grass([G1, G2, G3], G0), ['lot', 'vacuum'], 'Tuft of green grass, half a tile. Scatter along the floor.')
  addProp('dry_grass', grass([W2, W4, W6], W0), ['highway', 'storm'], 'Tuft of dry desert grass, half a tile.')
}

/* ---- the wash tunnels ---- */

/** The tunnel entrance arch, 3 tiles wide and 5 tall: a header with our name over two pillars. */
function arch({ left, right, border, face, stripeA, stripeB, words }) {
  const c = new Canvas(96, 162)
  for (const x of [1, 78]) {
    c.rect(x, 150, 17, 10, K4)
    c.rect(x, 150, 17, 1, K5)
  }
  shadeCols(c, 2, 30, 14, 120, ...left)
  shadeCols(c, 80, 30, 14, 120, ...right)
  const top = (x) => {
    const r = 7
    const d = x < 1 + r ? 1 + r - x : x > 94 - r ? x - (94 - r) : 0
    return 3 + (d ? Math.round(r - Math.sqrt(Math.max(0, r * r - d * d))) : 0)
  }
  const bottom = (x) => {
    const u = (x - 47.5) / 31.5
    return x < 16 || x > 79 ? 34 : 34 + Math.round((1 - Math.sqrt(Math.max(0, 1 - u * u))) * 12)
  }
  for (let x = 1; x <= 94; x++) {
    c.rect(x, top(x), 1, bottom(x) - top(x) + 1, border)
    if (x >= 3 && x <= 92) {
      c.rect(x, top(x) + 2, 1, bottom(x) - top(x) - 3, face)
      c.rect(x, top(x) + 2, 1, 2, stripeA)
      c.rect(x, bottom(x) - 3, 1, 2, stripeB)
    }
  }
  words(c)
  for (let y = 40; y < 146; y += 13) {
    c.rect(7, y, 4, 3, Y1)
    c.rect(8, y, 2, 1, Y2)
    c.rect(85, y, 4, 3, Y1)
    c.rect(86, y, 2, 1, Y2)
  }
  c.outline(O)
  return c
}
addProp(
  'arch_tunnel',
  arch({
    left: [R4, R3, R1],
    right: [B3, B2, B1],
    border: NAVY,
    face: K6,
    stripeA: R3,
    stripeB: B2,
    words: (c) => {
      say(c, 13, 15, 'MIGHTY', R3, { bold: true })
      say(c, 56, 15, 'WASH', B1, { bold: true })
    },
  }),
  ['tunnel', 'lot', 'vacuum'],
  'Tunnel entrance arch, red and blue, MIGHTY WASH on the header: 3 tiles wide, 5 tall, centred on its tile. Walk-through: nothing on it is solid.',
)
addProp(
  'arch_mega',
  arch({
    left: [K6, K4, K2],
    right: [K6, K4, K2],
    border: K3,
    face: P0,
    stripeA: R4,
    stripeB: B3,
    words: (c) => {
      neon(c, 32, 15, 'MIGHTY', R5, R3, R1, { scale: 1 })
      neon(c, 69, 15, 'WASH', B4, B2, B0, { scale: 1 })
      for (const x of [5, 89]) {
        c.rect(x, 36, 2, 112, x < 50 ? R4 : B3)
        c.rect(x, 36, 1, 112, x < 50 ? R5 : B4)
      }
    },
  }),
  ['mega'],
  'The Mega Tunnel arch: chrome pillars with neon tubes, neon MIGHTY WASH. 3 tiles wide, 5 tall.',
)

{
  const frames = [0, 1, 2, 3].map((f) => {
    // soft cloth strips, each split into two tails at the bottom, swaying from a rail; no dark
    // outline on the cloth, so Maxx still shows through the gaps behind it
    const c = new Canvas(64, 98)
    for (let i = 0; i < 7; i++) {
      const [lt, md, dk] = i % 2 ? [B4, B3, B2] : [R5, R4, R3]
      const sway = 3 * Math.sin((f * Math.PI) / 2 + i * 1.3)
      const end = 96 - [0, 5, 2, 7, 1, 4, 3][i]
      for (let y = 6; y < end; y++) {
        const k = (y - 6) / 90
        const x = 3 + i * 9 + Math.round(sway * k * k)
        c.rect(x, y, 6, 1, md)
        c.set(x, y, lt)
        c.set(x + 5, y, dk)
        if (y > end - 26) c.set(x + 3, y, dk)
        if (y > 8 && y % 22 === i % 5) c.rect(x + 1, y, 4, 1, dk)
      }
      c.set(3 + i * 9 + Math.round(sway) + 3, end - 1, 0)
    }
    const rail = new Canvas(64, 98)
    rail.rect(1, 1, 62, 5, K2)
    rail.rect(1, 1, 62, 1, K3)
    rail.rect(1, 5, 62, 1, K1)
    for (const x of [8, 31, 54]) rail.rect(x, 2, 2, 2, K4)
    rail.outline(O)
    c.blit(rail, 0, 0)
    return c
  })
  addPropAnim('curtain', frames, ['tunnel', 'mega'], 'Mitter curtain: cloth strips on a rail that sway, 2 tiles wide, 3 tall. Drawn in front of Maxx (front: true). Hangs from the ceiling: place it so the rail meets the roof.', 8, { front: true })
}

{
  const frames = [0, 1, 2, 3].map((f) => {
    const c = new Canvas(96, 130)
    for (const x of [3, 87]) {
      shadeCols(c, x, 20, 6, 104, K4, K3, K2, { l: 1, r: 1 })
      c.rect(x - 2, 122, 10, 5, K2)
      c.rect(x - 2, 122, 10, 1, K3)
    }
    // triple foam: a soft rope of suds pours from each nozzle and breaks into bubbles that drift down
    const cols = [[K6, K5], [PK, R2], [B3, B2], [Y2, Y1], [PK, R2], [B3, B2]]
    const foam = new Canvas(96, 130)
    for (let n = 0; n < 6; n++) {
      const nx = 16 + n * 13
      const [md, dk] = cols[n]
      const end = 58 + ((n * 7) % 12)
      for (let y = 24; y < end; y++) {
        const t = (y - 24) / (end - 24)
        const x = nx + Math.round(Math.sin(y / 6 + f * (Math.PI / 2) + n) * 1.5 * t)
        const hw = Math.round(3 - 1.5 * t)
        foam.rect(x - hw, y, hw * 2 + 1, 1, md)
        foam.set(x + hw, y, dk)
        if ((y + f * 4 + n * 3) % 16 < 3) foam.set(x - hw + 1, y, K6)
      }
      // the drips: 16 px apart, falling 4 px a frame, each stream on its own beat
      for (let j = 0; j < 3; j++) {
        const y = end + 4 + ((j * 16 + f * 4 + n * 5) % 48)
        const r = y < end + 20 ? 2 : 1
        const x = nx + ((j + n) % 2 ? 1 : -1)
        foam.circle(x, y, r, md)
        if (r > 1) foam.set(x - 1, y - 1, K6)
      }
    }
    foam.outline(O)
    c.blit(foam, 0, 0)
    c.rect(3, 14, 90, 8, K3)
    c.rect(3, 14, 90, 2, K4)
    c.rect(3, 21, 90, 1, K2)
    for (let n = 0; n < 6; n++) c.rect(15 + n * 13, 22, 3, 3, K2)
    for (const [x, r] of [[12, 4], [23, 5], [35, 4], [48, 5], [61, 4], [74, 5], [85, 4]]) {
      c.circle(x, 12, r, K6)
      c.set(x + r - 1, 13, B4)
    }
    c.outline(O)
    return c
  })
  addPropAnim('foam_arch', frames, ['tunnel', 'mega'], 'Foam applicator arch raining pink, blue and yellow suds, 3 tiles wide, 4 tall. Harmless and behind Maxx.', 6)
}

function windowProp(night) {
  const c = new Canvas(52, 44)
  c.rect(2, 2, 48, 40, K3)
  c.rect(2, 2, 48, 1, K4)
  c.rect(2, 2, 1, 40, K4)
  c.rect(2, 41, 48, 1, K2)
  c.rect(49, 2, 1, 40, K2)
  c.rect(5, 5, 42, 34, night ? P1 : B3)
  if (night) {
    c.rect(5, 30, 42, 9, P0)
    for (const [x, y] of [[9, 9], [20, 14], [33, 8], [42, 16], [13, 25], [38, 26]]) c.set(x, y, K6)
    c.ellipse(40, 11, 3, 3, Y2)
    c.ellipse(41, 10, 3, 3, P1)
  } else {
    c.rect(5, 30, 42, 9, B4)
  }
  for (const [x0, y0] of [[7, 19], [28, 19], [7, 37], [28, 37]]) {
    for (let i = 0; i < 9; i++) {
      c.set(x0 + i, y0 - i, night ? P2 : K6)
      c.set(x0 + i + 3, y0 - i, night ? P2 : B4)
    }
  }
  c.rect(25, 5, 2, 34, K3)
  c.rect(5, 21, 42, 2, K3)
  c.outline(O)
  return c
}
addProp('window', windowProp(false), ['tunnel', 'lube'], 'Steel-framed window onto daylight, 1.5 tiles wide. Hang it on the wall: place it in the air where its bottom edge should be.')
addProp('window_night', windowProp(true), ['mega', 'backlot'], 'Window onto the night with stars and a moon, 1.5 tiles wide.')

{
  const c = new Canvas(38, 24)
  c.rect(16, 1, 6, 3, K2)
  c.rect(2, 4, 34, 18, K1)
  c.rect(3, 5, 32, 16, K0)
  sayAt(c, 19, 9, 'EXIT', R4, { bold: true })
  tint(c, [[R4, R5]], (x, y) => y === 9)
  c.outline(O)
  addProp('sign_exit', c, ['tunnel', 'lube', 'mega', 'backlot', 'bonus'], 'Lit EXIT sign, a tile wide. Hang it over a doorway: place it in the air.')
}

{
  const c = new Canvas(44, 100)
  shadeCols(c, 4, 0, 8, 97, K5, K4, K3)
  shadeCols(c, 16, 0, 6, 97, R4, R3, R1, { l: 1, r: 1 })
  shadeCols(c, 27, 0, 10, 97, I1, I0, B1)
  for (const y of [8, 46, 84]) {
    c.rect(3, y, 10, 3, K2)
    c.rect(15, y, 8, 3, K2)
    c.rect(26, y, 12, 3, K2)
    c.rect(3, y, 10, 1, K3)
    c.rect(26, y, 12, 1, K3)
  }
  c.rect(18, 26, 6, 2, K2)
  c.circle(22, 31, 5, R3, { fill: false })
  c.line(18, 31, 26, 31, R3)
  c.line(22, 27, 22, 35, R3)
  c.circle(22, 31, 1, K4)
  c.circle(8, 62, 4, K6)
  c.circle(8, 62, 4, K2, { fill: false })
  c.line(8, 62, 10, 60, K0)
  c.rect(30, 66, 5, 8, Y1)
  c.rect(31, 67, 3, 1, K0)
  c.outline(O)
  addProp('pipes_wall', c, ['tunnel', 'lube', 'mega'], 'Three pipes up a wall with flanges, a red valve wheel and a gauge, 3 tiles tall. They run off the top of the frame into the ceiling.')
}

{
  const c = new Canvas(72, 46)
  const jug = (x, [lt, md, dk]) => {
    shadeCols(c, x, 12, 20, 32, lt, md, dk, { l: 3, r: 3 })
    c.set(x, 12, 0)
    c.set(x + 19, 12, 0)
    c.rect(x + 2, 10, 16, 2, md)
    c.rect(x + 2, 10, 2, 2, lt)
    c.rect(x + 7, 6, 6, 4, K1)
    c.rect(x + 7, 6, 6, 1, K2)
    c.rect(x + 3, 21, 14, 12, K6)
    c.rect(x + 3, 32, 14, 1, K5)
    c.blit(DROP_S, x + 7, 23, { swap: { [K6]: md, [K5]: dk } })
  }
  jug(2, [B3, B2, B1])
  jug(26, [R5, PK, R2])
  jug(50, [Y2, Y1, Y0])
  c.outline(O)
  addProp('chem_tanks', c, ['tunnel', 'lube', 'mega'], 'Three drums of triple-foam soap, blue, pink and yellow, 2 tiles wide, a tile and a half tall.')
}

{
  const c = new Canvas(36, 40)
  c.rect(8, 35, 20, 3, K2)
  c.rect(16, 18, 4, 17, K2)
  c.rect(16, 18, 1, 17, K3)
  c.circle(18, 15, 12, K3)
  c.circle(18, 15, 11, R1)
  for (const r of [10, 8, 6]) c.circle(18, 15, r, R3, { fill: false })
  c.circle(18, 15, 3, K4)
  c.set(17, 14, K6)
  c.rect(30, 14, 4, 3, K2)
  c.line(7, 22, 4, 32, R3, 2)
  c.rect(3, 32, 3, 3, K3)
  c.outline(O)
  addProp('hose_reel', c, ['tunnel', 'vacuum', 'lube'], 'Red hose on a reel stand, a tile tall.')
}

{
  const frames = [0, 1].map((f) => {
    const c = new Canvas(34, 52)
    for (const x of [6, 25]) c.rect(x, 44, 3, 6, K2)
    c.rect(2, 2, 30, 42, K4)
    c.rect(2, 2, 30, 1, K5)
    c.rect(2, 2, 1, 42, K5)
    c.rect(2, 43, 30, 1, K3)
    c.rect(31, 2, 1, 42, K3)
    c.rect(16, 4, 1, 38, K3)
    c.rect(18, 22, 1, 6, K2)
    ;(f ? [R1, G3, Y0] : [R4, G1, Y2]).forEach((col, i) => c.rect(5 + i * 4, 6, 2, 2, col))
    c.rect(5, 11, 9, 6, K1)
    c.rect(6, 13, f ? 7 : 4, 1, G3)
    c.rect(6, 15, f ? 3 : 6, 1, G3)
    c.rect(20, 30, 9, 8, Y1)
    c.line(25, 31, 23, 34, K0)
    c.line(23, 34, 26, 34, K0)
    c.line(26, 34, 24, 37, K0)
    // a beacon on the roof that blinks with the lamps (and keeps the top from looking like a step)
    const t = c.pad(0, 7, 0, 0)
    t.rect(12, 7, 10, 2, K2)
    t.ellipse(16.5, 5, 3.5, 3, f ? OR0 : OR1)
    t.rect(14, 3, 2, 1, f ? OR1 : OR2)
    t.outline(O)
    return t
  })
  addPropAnim('panel', frames, ['tunnel', 'mega', 'lube'], 'Control cabinet with blinking lamps and a beacon on top, a tile and a half tall.', 30)
}

{
  const c = new Canvas(24, 96)
  c.rect(11, 0, 2, 80, K1)
  for (let y = 80; y <= 89; y++) {
    const hw = 3 + Math.round((y - 80) * 0.75)
    c.rect(12 - hw, y, hw * 2, 1, G1)
    c.set(12 - hw, y, G2)
    c.set(12 - hw + 1, y, G2)
  }
  c.rect(5, 89, 14, 1, G0)
  c.ellipse(11.5, 91, 3, 2, Y2)
  c.rect(10, 90, 2, 1, W8)
  c.outline(O)
  addProp('lamp_hang', c, ['lube', 'tunnel', 'backlot', 'mega'], 'Warm work lamp on a long cable, 3 tiles of cable. Place it in the air in the tile where the lamp should hang: the cable runs up to the ceiling.')
}

/* ---- the lube pit ---- */

{
  const c = new Canvas(68, 70)
  for (const x of [6, 59]) {
    c.rect(x, 46, 3, 22, K2)
    c.rect(x - 2, 66, 7, 2, K2)
  }
  c.rect(2, 2, 64, 46, W1)
  c.rect(3, 3, 62, 44, W5)
  c.rect(3, 3, 62, 1, W6)
  for (let y = 6; y < 46; y += 5) for (let x = 6; x < 64; x += 5) c.set(x, y, W3)
  // wrench
  c.rect(10, 13, 3, 23, K4)
  c.rect(10, 13, 1, 23, K5)
  c.rect(8, 8, 7, 6, K4)
  c.rect(10, 8, 3, 3, W5)
  // hammer
  c.rect(23, 15, 3, 23, W2)
  c.rect(23, 15, 1, 23, W3)
  c.rect(18, 9, 13, 6, K2)
  c.rect(18, 9, 13, 1, K3)
  // screwdrivers
  for (const [x, col] of [[36, R3], [42, B2], [48, Y1]]) {
    c.rect(x, 10, 4, 9, col)
    c.rect(x, 10, 1, 9, K6)
    c.rect(x + 1, 19, 2, 13, K4)
  }
  // a coil of wire
  c.circle(58, 14, 4, Y1)
  c.circle(58, 14, 2, Y0, { fill: false })
  c.set(58, 14, W5)
  // a saw
  c.rect(10, 39, 34, 4, K5)
  for (let x = 10; x < 44; x += 2) c.set(x, 42, K3)
  c.rect(44, 37, 7, 7, W3)
  c.rect(46, 39, 3, 3, W5)
  c.outline(O)
  addProp('tool_rack', c, ['lube', 'tunnel'], 'Pegboard of tools on legs, 2 tiles wide and tall.')
}

{
  const c = new Canvas(38, 48)
  shadeCols(c, 3, 9, 32, 32, R4, R3, R1)
  c.rect(2, 4, 34, 5, R2)
  c.rect(2, 4, 34, 1, R4)
  c.rect(2, 8, 34, 1, R1)
  for (let i = 0; i < 5; i++) {
    const y = 10 + i * 6
    c.rect(3, y + 5, 32, 1, R1)
    c.rect(12, y + 2, 14, 1, K5)
    c.rect(12, y + 3, 14, 1, K3)
  }
  c.rect(3, 41, 32, 2, K2)
  for (const x of [8, 29]) {
    c.circle(x, 44, 2, K1)
    c.set(x, 44, K3)
  }
  // a toolbox and a wrench left on top, so the lid never reads as a step
  const t = c.pad(0, 10, 0, 0)
  t.rect(7, 7, 18, 7, B1)
  t.rect(7, 7, 18, 1, B2)
  t.rect(7, 7, 1, 7, B2)
  t.rect(15, 9, 2, 2, K5)
  t.rect(13, 3, 6, 1, K3)
  t.rect(13, 3, 1, 4, K3)
  t.rect(18, 3, 1, 4, K3)
  t.rect(29, 5, 2, 9, K4)
  t.rect(28, 2, 4, 3, K4)
  t.set(29, 2, 0)
  t.set(30, 2, 0)
  t.outline(O)
  addProp('tool_chest', t, ['lube', 'tunnel'], 'Red rolling tool chest with a toolbox on top, under 2 tiles tall.')
}

{
  const c = new Canvas(68, 80)
  const lit = { [Y1]: Y2, [B2]: B3, [R3]: R4, [G2]: G3, [OR1]: OR2, [K5]: K6 }
  const cols = Object.keys(lit)
  for (const sy of [26, 50, 74]) {
    let x = 6
    while (x < 58) {
      const wide = rnd(x, sy, 3) < 0.25
      const w = wide ? 9 : 6
      const h = wide ? 12 : 10 + Math.floor(rnd(x, sy, 4) * 3)
      const col = cols[Math.floor(rnd(x, sy, 5) * cols.length)]
      c.rect(x, sy - h, w, h, col)
      c.rect(x, sy - h, 1, h, lit[col])
      c.rect(x, sy - h + 4, w, 3, K6)
      c.rect(x + Math.floor(w / 2) - 1, sy - h - 2, 2, 2, K1)
      x += w + 1
    }
    c.rect(2, sy, 64, 3, K4)
    c.rect(2, sy, 64, 1, K5)
    c.rect(2, sy + 2, 64, 1, K2)
  }
  for (const x of [2, 63]) {
    c.rect(x, 4, 3, 74, K3)
    c.rect(x, 4, 1, 74, K4)
  }
  c.outline(O)
  addProp('oil_shelf', c, ['lube'], 'Steel shelf of oil bottles, 2 tiles wide, 2.5 tall.')
}

{
  const c = new Canvas(26, 34)
  shadeCols(c, 3, 5, 20, 27, R3, R2, R1, { l: 3, r: 3 })
  c.rect(3, 5, 1, 27, R4)
  for (const y of [10, 25]) {
    c.rect(3, y, 20, 1, R1)
    c.rect(3, y + 1, 20, 1, R4)
  }
  c.rect(3, 14, 20, 8, K6)
  c.rect(3, 21, 20, 1, K5)
  tiny(c, 13, 16, 'LUBE', R1)
  c.rect(2, 2, 22, 3, K3)
  c.rect(2, 2, 22, 1, K4)
  c.rect(6, 1, 4, 1, K3)
  c.rect(2, 31, 22, 1, K2)
  c.rect(18, 5, 2, 3, K0)
  c.set(18, 8, K0)
  // a funnel stuck in the bung: a drum top is the classic platform, this one is not
  const t = c.pad(0, 8, 0, 0)
  t.poly([[3, 2], [14, 2], [10, 7], [7, 7]], K3)
  t.rect(3, 2, 12, 1, K4)
  t.rect(4, 3, 3, 1, K4)
  t.rect(8, 7, 2, 3, K2)
  t.outline(O)
  addProp('oil_drum', t, ['lube', 'storm', 'backlot'], 'Red LUBE oil drum, a tile tall.')
}

{
  const c = new Canvas(30, 24)
  const can = (x, y, md, lt) => {
    c.rect(x, y + 2, 8, 10, md)
    c.rect(x, y + 2, 2, 10, lt)
    c.rect(x + 2, y, 4, 2, K1)
    c.rect(x, y + 5, 8, 3, K6)
  }
  can(6, 1, G2, G3)
  can(15, 1, OR1, OR2)
  can(2, 11, Y1, Y2)
  can(11, 11, B2, B3)
  can(20, 11, R3, R4)
  c.outline(O)
  addProp('oil_cans', c, ['lube'], 'Little pyramid of quart oil bottles, under a tile.')
}

{
  const c = new Canvas(72, 54)
  for (const x of [14, 54]) shadeCols(c, x, 32, 4, 20, K4, K3, K2, { l: 1, r: 1 })
  c.rect(2, 2, 68, 32, K1)
  c.rect(4, 4, 64, 28, K0)
  for (let x = 5; x < 68; x += 6) {
    c.rect(x, 2, 2, 2, Y2)
    c.rect(x, 32, 2, 2, Y2)
  }
  for (let y = 8; y < 32; y += 6) {
    c.rect(2, y, 2, 2, Y2)
    c.rect(68, y, 2, 2, Y2)
  }
  sayShadow(c, 36, 10, 'LUBE', OR1, OR0, { scale: 2, bold: true })
  tint(c, [[OR1, OR2]], (x, y) => y === 10 || y === 11)
  c.outline(O)
  addProp('sign_lube', c, ['lube'], 'LUBE marquee sign with bulbs on short legs, 2 tiles wide, 1.5 tall.')
}

{
  const c = new Canvas(32, 120)
  c.rect(3, 113, 26, 5, K2)
  hazard(c, 4, 114, 24, 3, Y1, K0)
  shadeCols(c, 10, 6, 12, 107, K4, K3, K2)
  c.rect(15, 10, 2, 96, K2)
  c.rect(8, 3, 16, 4, K2)
  c.rect(8, 3, 16, 1, K3)
  c.rect(8, 92, 16, 12, Y1)
  c.rect(8, 92, 16, 1, Y2)
  c.rect(8, 92, 1, 12, Y2)
  c.rect(8, 103, 16, 1, Y0)
  c.rect(22, 107, 9, 4, Y1)
  c.rect(22, 107, 9, 1, Y2)
  c.rect(4, 56, 6, 10, K2)
  c.rect(5, 58, 2, 2, G3)
  c.rect(5, 62, 2, 2, R4)
  c.outline(O)
  addProp('lift_post', c, ['lube'], 'Car lift column with its yellow arm lowered, under 4 tiles tall. Use two, 4 tiles apart, either side of a parked car.')
}

{
  const c = new Canvas(48, 22)
  c.line(30, 13, 44, 4, K3, 2)
  c.rect(43, 1, 4, 4, K1)
  c.poly([[4, 12], [32, 10], [32, 17], [4, 17]], R3)
  c.rect(4, 12, 28, 1, R4)
  c.rect(5, 7, 8, 3, K3)
  c.rect(8, 10, 3, 2, K2)
  for (const x of [8, 28]) {
    c.circle(x, 18, 2, K1)
    c.set(x, 18, K3)
  }
  c.outline(O)
  addProp('floor_jack', c, ['lube'], 'Red floor jack, low on the floor.')
}

/* ---- storm, highway and winter ---- */

{
  const c = new Canvas(48, 36)
  const tire = (cx, cy) => {
    c.circle(cx, cy, 10, K1)
    c.circle(cx, cy, 8, K2, { fill: false })
    for (let k = 0; k < 14; k++) {
      const a = (k * Math.PI * 2) / 14
      c.set(Math.round(cx + Math.cos(a) * 10), Math.round(cy + Math.sin(a) * 10), K0)
    }
    for (let k = 0; k < 5; k++) {
      const a = Math.PI + 0.3 + k * 0.25
      c.set(Math.round(cx + Math.cos(a) * 7), Math.round(cy + Math.sin(a) * 7), K3)
    }
    c.circle(cx, cy, 4, 0)
  }
  tire(12, 24)
  tire(35, 24)
  tire(23, 12)
  c.outline(O)
  addProp('tire_pile', c, ['lube', 'storm', 'highway', 'backlot'], 'Old tyres leaned in a heap, a tile tall. Keep it away from tyre-stack springs so nobody mistakes one for the other.')
}

{
  const frames = [0, 1, 2, 3].map((f) => {
    const c = new Canvas(100, 78)
    const a = [0.2, 0, -0.2, 0][f]
    const th = (f * Math.PI) / 2
    c.rect(4, 70, 90, 5, K2)
    c.rect(4, 70, 90, 1, K3)
    c.rect(8, 60, 10, 10, K2)
    c.rect(10, 56, 6, 4, K3)
    c.rect(5, 62, 3, 3, R3)
    c.line(44, 70, 52, 28, K2, 3)
    c.line(62, 70, 54, 28, K2, 3)
    c.line(47, 56, 59, 56, K2, 2)
    c.rect(74, 50, 16, 20, K1)
    c.rect(74, 50, 16, 1, K2)
    const [cx, cy] = [82, 54]
    const px = Math.round(cx + Math.cos(th) * 11)
    const py = Math.round(cy + Math.sin(th) * 11)
    const wx = Math.round(cx - Math.cos(th) * 7)
    const wy = Math.round(cy - Math.sin(th) * 7)
    c.circle(wx, wy, 7, Y0)
    c.circle(wx, wy, 6, Y1)
    c.set(wx - 2, wy - 3, Y2)
    c.line(cx, cy, px, py, Y0, 3)
    const L = rot(13, 28, 53, 28, a)
    const R = rot(85, 28, 53, 28, a)
    c.line(Math.round(R[0]), Math.round(R[1]), px, py, K2, 2)
    c.line(Math.round(L[0]), Math.round(L[1]), Math.round(R[0]), Math.round(R[1]), K3, 4)
    c.line(Math.round(L[0]), Math.round(L[1]) - 1, Math.round(R[0]), Math.round(R[1]) - 1, K4)
    const d = [-Math.cos(a), -Math.sin(a)]
    const n = [-Math.sin(a), Math.cos(a)]
    const at = ([u, v]) => [L[0] + u * d[0] + v * n[0], L[1] + u * d[1] + v * n[1]]
    c.poly([[0, -4], [6, -5], [9, -1], [9, 6], [6, 12], [2, 14], [-1, 10]].map(at), R3)
    c.poly([[3, -4], [6, -4], [8, -1], [8, 4], [6, 4]].map(at), R4)
    const tip = at([1, 14])
    c.line(Math.round(tip[0]), Math.round(tip[1]), 13, 56, K4)
    c.circle(53, 28, 2, K1)
    c.outline(O)
    return c
  })
  addPropAnim('pumpjack', frames, ['highway', 'storm', 'winter'], 'Nodding pumpjack, 3 tiles wide, 2 tall. Its beam rocks and its crank turns.', 12)
}

{
  const frames = [0, 1, 2, 3].map((f) => {
    const c = new Canvas(100, 200)
    for (let y = 48; y <= 196; y++) {
      const hw = 2 + Math.round(((y - 48) * 3) / 148)
      c.rect(50 - hw, y, hw * 2, 1, K6)
      c.set(50 + hw - 1, y, K4)
      c.set(50 + hw - 2, y, K5)
    }
    c.rect(43, 194, 14, 4, K4)
    c.rect(43, 194, 14, 1, K5)
    c.rect(44, 41, 12, 9, K5)
    c.rect(44, 41, 12, 1, K6)
    for (let k = 0; k < 3; k++) {
      const ang = -Math.PI / 2 + (f * Math.PI) / 6 + (k * 2 * Math.PI) / 3
      const d = [Math.cos(ang), Math.sin(ang)]
      const n = [-d[1], d[0]]
      const at = (r, s) => [50 + d[0] * r + n[0] * s, 46 + d[1] * r + n[1] * s]
      c.poly([at(3, -2), at(14, -3), at(44, -0.5), at(44, 0.5), at(14, 2), at(3, 2)], K6)
      c.line(...at(8, 1.6).map(Math.round), ...at(40, 0.4).map(Math.round), K4)
    }
    c.circle(50, 46, 3, K5)
    c.set(49, 45, K6)
    c.outline(O)
    return c
  })
  addPropAnim('turbine', frames, ['highway', 'winter', 'storm', 'lot'], 'Wind turbine with turning blades, 6 tiles tall, 3 wide. Best far from the action, on a high ledge or a skyline.', 8)
}

{
  // faceted stones: a lit top, a mid face and a shaded side, so they never read as loaves
  const c = new Canvas(46, 20)
  const rock = (body, top, side) => {
    c.poly(body, M3)
    c.poly(top, M4)
    c.poly(side, M2)
  }
  rock([[2, 18], [4, 10], [9, 5], [17, 4], [22, 8], [24, 18]], [[4, 10], [9, 5], [17, 4], [13, 9], [6, 11]], [[17, 4], [22, 8], [24, 18], [19, 18], [18, 9]])
  rock([[23, 18], [25, 12], [30, 9], [36, 10], [38, 18]], [[25, 12], [30, 9], [36, 10], [31, 12]], [[36, 10], [38, 18], [34, 18], [33, 12]])
  rock([[38, 18], [39, 15], [42, 14], [44, 18]], [[39, 15], [42, 14], [41, 15]], [[42, 14], [44, 18], [42, 18]])
  c.line(10, 12, 12, 16, M1)
  c.line(29, 13, 30, 16, M1)
  for (const [x, y] of [[7, 14], [15, 13], [27, 15]]) c.set(x, y, M4)
  c.outline(O)
  addProp('rocks', c, ['highway', 'storm'], 'A few sandstone rocks, low on the floor.')
}

{
  const c = new Canvas(36, 40)
  for (const [x, y, rx, ry] of [[17, 10, 5, 6], [9, 19, 6, 8], [27, 17, 6, 7], [18, 29, 8, 9]]) {
    c.ellipse(x, y, rx, ry, G1)
    c.ellipse(x - 1, y - 1, rx - 1, ry - 1, G2)
    c.ellipse(x - 2, y - 3, Math.max(1, rx - 4), Math.max(1, ry - 5), G3)
    for (let i = 0; i < 4; i++) c.set(x - rx + 3 + ((i * 5) % (rx * 2 - 4)), y - ry + 3 + ((i * 7) % (ry * 2 - 4)), W8)
  }
  for (const [x, y] of [[15, 2], [5, 10], [29, 9]]) {
    c.rect(x, y, 3, 2, Y2)
    c.set(x + 1, y + 1, OR1)
  }
  for (const [x, y] of [[33, 13], [20, 3]]) c.rect(x, y, 2, 3, PK)
  c.outline(O)
  addProp('cactus', c, ['highway', 'lot', 'vacuum'], 'Prickly pear in flower (no spines drawn: it is scenery), a tile tall.')
}

{
  const c = new Canvas(36, 58)
  c.rect(17, 6, 2, 40, W1)
  for (const [x, y] of [[14, 6], [20, 8], [13, 12], [21, 14], [14, 18], [20, 21], [16, 2], [19, 25]]) {
    c.rect(x, y, 3, 3, W8)
    c.set(x + 2, y + 2, W6)
  }
  for (const [a, len] of [[-160, 14], [-140, 17], [-120, 18], [-100, 16], [-80, 16], [-60, 18], [-40, 17], [-20, 14], [-110, 12], [-70, 12]]) {
    const r = (a * Math.PI) / 180
    c.line(18, 54, Math.round(18 + Math.cos(r) * len), Math.round(54 + Math.sin(r) * len), G1, 2)
    c.line(18, 54, Math.round(18 + Math.cos(r) * (len - 2)), Math.round(54 + Math.sin(r) * (len - 2)), G2)
  }
  c.outline(O)
  addProp('yucca', c, ['highway', 'vacuum'], 'Yucca with a tall stalk of cream flowers, under 2 tiles tall.')
}

{
  const c = new Canvas(160, 136)
  for (const x of [36, 118]) {
    shadeCols(c, x, 86, 6, 46, K3, K2, K1, { l: 1, r: 1 })
    c.rect(x - 2, 130, 10, 4, K2)
  }
  for (const x of [40, 120]) {
    c.rect(x, 4, 2, 8, K2)
    c.rect(x - 4, 2, 10, 3, K2)
    c.rect(x - 3, 5, 8, 1, Y2)
  }
  c.rect(2, 12, 156, 76, K2)
  c.rect(4, 14, 152, 72, K3)
  c.rect(6, 16, 148, 68, B2)
  c.rect(6, 16, 148, 2, B3)
  c.rect(6, 70, 148, 14, B1)
  for (let x = 10; x < 150; x += 16) c.rect(x, 77, 8, 2, K6)
  // a clean, happy car
  c.poly([[14, 66], [15, 57], [26, 55], [34, 46], [52, 46], [60, 55], [68, 57], [69, 67], [14, 67]], R3)
  c.rect(16, 57, 50, 2, R4)
  c.line(34, 47, 52, 47, R4)
  c.poly([[31, 54], [37, 48], [44, 48], [44, 54]], B4)
  c.poly([[46, 48], [52, 48], [57, 54], [46, 54]], B4)
  c.rect(14, 64, 56, 2, R1)
  c.rect(64, 58, 4, 3, Y2)
  c.rect(15, 59, 3, 2, R5)
  c.line(60, 62, 65, 62, O)
  c.set(59, 61, O)
  c.set(66, 61, O)
  for (const x of [25, 58]) {
    c.circle(x, 67, 5, K1)
    c.circle(x, 67, 2, K4)
  }
  for (const [x, y] of [[40, 36], [72, 44], [20, 46]]) {
    c.rect(x - 3, y, 7, 1, K6)
    c.rect(x, y - 3, 1, 7, K6)
    c.rect(x - 1, y - 1, 3, 3, K6)
  }
  sayShadow(c, 112, 26, 'MIGHTY', K6, NAVY, { scale: 2, bold: true })
  sayShadow(c, 112, 46, 'WASH', Y2, NAVY, { scale: 2, bold: true })
  c.outline(O)
  addProp('billboard', c, ['highway'], 'MIGHTY WASH billboard with a happy clean car, 5 tiles wide, 4 tall. On a skyline, not over the play.')
}

{
  const c = new Canvas(72, 94)
  for (const x of [14, 54]) shadeCols(c, x, 44, 4, 48, K4, K3, K2, { l: 1, r: 1 })
  c.rect(2, 2, 68, 44, G1)
  c.box(4, 4, 64, 40, K6)
  for (const [x, y] of [[2, 2], [69, 2], [2, 45], [69, 45]]) c.set(x, y, 0)
  sayAt(c, 36, 8, 'EXIT', K6, { scale: 2, bold: true })
  sayAt(c, 36, 25, 'MIGHTY', K6)
  sayAt(c, 36, 34, 'WASH', K6)
  c.outline(O)
  addProp('sign_highway', c, ['highway'], 'Green highway EXIT sign for MIGHTY WASH, 2 tiles wide, 3 tall.')
}

{
  const c = new Canvas(64, 26)
  const posts = new Canvas(64, 26)
  for (const x of [12, 44]) {
    posts.rect(x, 10, 5, 14, K2)
    posts.rect(x, 10, 1, 14, K3)
  }
  posts.outline(O)
  c.blit(posts, 0, 0)
  bands(c, 5, [O, K5, K4, K3, K4, K5, K4, K3, K2, O])
  for (const x of [14, 46]) {
    c.set(x, 9, K1)
    c.rect(x - 1, 11, 3, 1, Y1)
  }
  addProp('guardrail', c, ['highway', 'winter', 'storm'], 'Steel guard rail, 2 tiles wide and under a tile tall. Place one every 2 tiles and they join into one rail.')
}

{
  const c = new Canvas(64, 64)
  for (let y = 9; y < 61; y++) {
    for (let x = 4; x < 60; x++) {
      const a = mod(x + y, 8) === 0
      const b = mod(x - y, 8) === 0
      if (a || b) c.set(x, y, a && b ? K5 : a ? K4 : K3)
    }
  }
  const frame = new Canvas(64, 64)
  for (const x of [1, 60]) {
    frame.rect(x, 3, 3, 60, K3)
    frame.rect(x, 3, 1, 60, K4)
  }
  frame.rect(4, 7, 56, 2, K4)
  frame.rect(4, 8, 56, 1, K3)
  frame.rect(4, 61, 56, 1, K3)
  frame.outline(O)
  c.blit(frame, 0, 0)
  addProp('fence', c, ['backlot', 'highway', 'storm', 'winter'], 'Chain-link fence panel, 2 tiles wide and tall, see-through. Place one every 2 tiles and they join into one fence.')
}

{
  const c = new Canvas(56, 180)
  shadeCols(c, 26, 8, 6, 170, M3, M2, M1, { l: 1, r: 1 })
  for (const [y, n] of [[30, 18], [90, 24], [140, 14]]) c.rect(28, y, 1, n, M1)
  c.rect(4, 18, 48, 4, W1)
  c.rect(4, 18, 48, 1, W2)
  c.rect(12, 36, 32, 3, W1)
  c.rect(12, 36, 32, 1, W2)
  for (const x of [7, 18, 37, 48]) {
    c.rect(x - 1, 12, 3, 6, T1)
    c.rect(x - 1, 12, 1, 6, T2)
    c.rect(x - 2, 14, 5, 1, T0)
  }
  c.rect(33, 44, 10, 16, K3)
  c.rect(33, 44, 2, 16, K4)
  c.rect(32, 43, 12, 2, K2)
  c.rect(36, 40, 2, 3, T1)
  for (let y = 70; y < 160; y += 10) c.rect(y % 20 ? 24 : 32, y, 2, 2, K3)
  c.outline(O)
  addProp('power_pole', c, ['storm', 'highway', 'winter', 'backlot'], 'Wooden power pole with insulators and a transformer, 5.5 tiles tall.')
}

{
  const c = new Canvas(56, 26)
  // burlap sacks laid like bricks: squarish, sagging at the middle, a stitched seam along each
  // and the tied neck folded under at one end, each sack outlined on its own
  const bag = (x, y) => {
    const b = new Canvas(56, 26)
    b.rect(x + 1, y, 14, 7, M3)
    b.rect(x, y + 1, 16, 5, M3)
    b.rect(x + 1, y + 1, 13, 1, M4)
    b.rect(x + 1, y + 2, 2, 3, M4)
    b.rect(x + 1, y + 5, 14, 1, M2)
    for (let i = 3; i < 13; i += 2) b.set(x + i, y + 3, M2)
    // the neck: pinched and folded down
    b.rect(x + 14, y + 2, 2, 3, M2)
    b.set(x + 16, y + 2, M2)
    b.set(x + 16, y + 4, M2)
    b.set(x + 15, y + 1, M4)
    b.outline(O)
    c.blit(b, 0, 0)
  }
  for (const x of [2, 19, 36]) bag(x, 17)
  for (const x of [10, 27]) bag(x, 9)
  addProp('sandbags', c, ['storm'], 'Low wall of sandbags against the flood, under a tile tall.')
}

{
  const frames = [0, 1, 2, 3].map((f) => {
    const c = new Canvas(56, 80)
    c.rect(2, 74, 11, 4, K2)
    c.rect(2, 74, 11, 1, K3)
    c.rect(6, 4, 3, 71, K3)
    c.rect(6, 4, 1, 71, K4)
    c.rect(8, 6, 3, 13, K2)
    for (let x = 11; x <= 50; x++) {
      const t = (x - 11) / 39
      const cy = 12 + Math.round([2, 4, 3, 1][f] * t * t + Math.sin(x / 5 - (f * Math.PI) / 2) * 1.5 * t)
      const hh = Math.round(6 - 3.5 * t)
      const white = Math.floor(t * 4.999) % 2
      c.rect(x, cy - hh, 1, hh * 2 + 1, white ? K6 : OR1)
      c.set(x, cy - hh, white ? K6 : OR2)
      c.set(x, cy + hh, white ? K5 : OR0)
    }
    c.outline(O)
    return c
  })
  addPropAnim('windsock', frames, ['storm', 'highway'], 'Orange and white windsock flapping in the gale, 2.5 tiles tall. The pole is at its left; flip it to blow left.', 8)
}

{
  const c = new Canvas(36, 56)
  c.line(11, 26, 3, 18, M2, 2)
  c.line(5, 20, 3, 15, M2)
  c.line(25, 26, 33, 19, M2, 2)
  c.line(31, 21, 34, 17, M2)
  for (const [cx, cy, r] of [[18, 43, 11], [18, 26, 8], [18, 12, 6]]) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > (r + 0.5) ** 2) continue
        const k = (x + y) / (r * 1.4)
        c.set(cx + x, cy + y, k > 0.55 ? I0 : k > 0.2 ? I1 : K6)
      }
    }
  }
  c.set(16, 10, O)
  c.set(20, 10, O)
  c.rect(18, 12, 4, 1, OR1)
  c.set(21, 12, OR0)
  for (const [x, y] of [[15, 14], [16, 15], [17, 15], [18, 15], [19, 15], [20, 14]]) c.set(x, y, O)
  for (const y of [24, 28, 32]) c.set(18, y, O)
  c.rect(12, 17, 13, 3, R3)
  c.rect(12, 17, 13, 1, R4)
  c.rect(15, 17, 2, 3, B2)
  c.rect(20, 17, 2, 3, B2)
  c.rect(21, 19, 3, 8, R3)
  c.rect(21, 25, 3, 1, B2)
  c.ellipse(18, 6, 6, 3, B1)
  c.rect(12, 6, 13, 3, 0)
  c.rect(12, 5, 13, 2, B2)
  c.circle(18, 2, 1, K6)
  c.outline(O)
  addProp('snowman', c, ['winter'], 'Snowman in a Mighty Wash scarf and beanie, under 2 tiles tall.')
}

{
  const c = new Canvas(76, 36)
  for (let x = 2; x < 74; x++) {
    const u = (x - 38) / 36
    const top = Math.round(33 - Math.sqrt(Math.max(0, 1 - u * u)) * 24 + Math.sin(x * 0.9))
    c.rect(x, top, 1, 34 - top, K5)
    for (let y = top; y < 34; y++) if (x - 38 + (y - top) * 0.8 > 14) c.set(x, y, K4)
    c.set(x, top, K6)
  }
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rnd(i, 3, 61) * 76)
    const y = Math.floor(rnd(i, 4, 61) * 36)
    const v = c.get(x, y)
    if (v === rgba(K5)) c.set(x, y, i % 3 ? K6 : K4)
    else if (v === rgba(K4)) c.set(x, y, K3)
  }
  c.line(56, 3, 50, 18, W1, 2)
  c.poly([[46, 17], [53, 17], [52, 22], [47, 22]], K3)
  c.outline(O)
  addProp('salt_pile', c, ['winter'], 'Heap of road salt with a shovel stuck in it, 2 tiles wide, a tile tall.')
}

{
  const c = new Canvas(52, 16)
  for (let x = 2; x < 50; x++) {
    const u = (x - 26) / 24
    const top = Math.round(13 - Math.sqrt(Math.max(0, 1 - u * u)) * 9 - (x > 18 && x < 30 ? 1 : 0))
    c.rect(x, top, 1, 14 - top, K6)
    if (x > 30) c.rect(x, top + 2, 1, 12 - top, I2)
    c.set(x, 13, I1)
  }
  c.outline(O)
  addProp('snowdrift', c, ['winter'], 'Low drift of snow, under half a tile.')
}

/* ---- the token vault ---- */

{
  const c = new Canvas(100, 100)
  c.circle(50, 50, 48, Y0)
  c.circle(50, 50, 47, Y1)
  c.circle(50, 50, 44, Y0)
  c.circle(50, 50, 43, K3)
  c.circle(50, 50, 41, K4)
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const dx = x - 50
    const dy = y - 50
    const r2 = dx * dx + dy * dy
    if (r2 <= 41.5 ** 2 && dx + dy < -36) c.set(x, y, K5)
    if (r2 > 44.5 ** 2 && r2 <= 47.5 ** 2 && dx + dy < -20) c.set(x, y, Y2)
  }
  c.circle(50, 50, 30, K3, { fill: false })
  c.circle(50, 50, 29, K5, { fill: false })
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6
    const x = Math.round(50 + Math.cos(a) * 36)
    const y = Math.round(50 + Math.sin(a) * 36)
    c.rect(x - 1, y - 1, 3, 3, K2)
    c.set(x - 1, y - 1, K6)
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    const x = Math.round(50 + Math.cos(a) * 18)
    const y = Math.round(50 + Math.sin(a) * 18)
    c.line(50, 50, x, y, K2, 3)
    c.circle(x, y, 3, Y1)
    c.set(x - 1, y - 1, Y2)
  }
  c.circle(50, 50, 7, Y1)
  c.circle(50, 50, 5, Y0, { fill: false })
  c.set(48, 47, Y2)
  c.rect(92, 36, 6, 28, K2)
  c.rect(92, 36, 1, 28, K3)
  c.outline(O)
  addProp('vault_door', c, ['bonus'], 'Round steel vault door with a gold rim and a wheel, 3 tiles across, standing on the floor.')
}

{
  const c = new Canvas(72, 118)
  for (let y = 7; y <= 115; y++) {
    const w = y < 70 ? Math.round(20 - ((y - 7) * 10) / 63) : Math.round(10 + ((y - 70) * 9) / 45)
    for (let i = 0; i < w; i++) {
      const fold = (i + (y < 70 ? 0 : 2)) % 5
      const col = fold === 0 ? R1 : fold === 1 ? R3 : R2
      c.set(1 + i, y, col)
      c.set(70 - i, y, fold === 1 ? R2 : col)
    }
  }
  for (let x = 1; x <= 70; x++) {
    const b = 12 + Math.round(5 * Math.abs(Math.sin(((x - 1) / 70) * 3 * Math.PI)))
    c.rect(x, 6, 1, b - 6, R2)
    c.set(x, 7, R3)
    c.set(x, b, R1)
  }
  c.rect(0, 2, 72, 4, Y1)
  c.rect(0, 2, 72, 1, Y2)
  c.rect(0, 5, 72, 1, Y0)
  for (const x of [5, 66]) {
    c.rect(x - 4, 68, 9, 3, Y1)
    c.rect(x - 4, 68, 9, 1, Y2)
    c.rect(x, 71, 2, 6, Y2)
    c.rect(x - 1, 76, 4, 2, Y1)
  }
  c.outline(O)
  addProp('drape', c, ['bonus'], 'Red velvet drapes on a gold rod framing a doorway, 2 tiles wide, 3.5 tall. Open in the middle.')
}

{
  const c = new Canvas(48, 58)
  c.rect(2, 2, 44, 54, Y0)
  c.rect(3, 3, 42, 52, Y1)
  c.rect(3, 3, 42, 1, Y2)
  c.rect(3, 3, 1, 52, Y2)
  c.rect(6, 6, 36, 46, Y0)
  c.rect(7, 7, 34, 44, B1)
  c.rect(7, 35, 34, 16, B0)
  const head = MAXX_ATLAS?.frame('head')?.canvas ?? MASK
  const big = head.scale(2)
  c.blit(big, 24 - Math.floor(big.w / 2), 39 - big.h)
  c.rect(14, 42, 20, 7, Y1)
  c.rect(14, 42, 20, 1, Y2)
  tiny(c, 24, 43, 'MAXX', Y0)
  c.outline(O)
  addProp('portrait', c, ['bonus'], 'Gold-framed portrait of Maxx, a tile and a half wide, nearly 2 tall. Hang it: place it in the air.')
}

{
  const c = new Canvas(52, 58)
  c.poly([[3, 3], [48, 3], [48, 30], [26, 55], [25, 55], [3, 30]], Y0)
  c.poly([[5, 5], [46, 5], [46, 29], [26, 52], [25, 52], [5, 29]], Y1)
  c.line(5, 5, 46, 5, Y2)
  c.line(5, 5, 5, 29, Y2)
  c.poly([[8, 8], [43, 8], [43, 28], [26, 48], [25, 48], [8, 28]], K6)
  // not bold: at this size the bold strokes fill in the middle of the M and W and they read as H
  sayAt(c, 26, 10, 'M', R3, { scale: 2 })
  sayAt(c, 26, 27, 'W', B1, { scale: 2 })
  c.outline(O)
  addProp('crest', c, ['bonus'], 'Gold shield with the red M over blue W from Maxx\'s chest, 1.5 tiles wide, under 2 tall.')
}

{
  const c = new Canvas(60, 70)
  for (let y = 0; y < 30; y += 2) c.rect(29, y, 2, 2, y % 4 ? Y0 : Y1)
  c.rect(28, 30, 4, 18, Y1)
  c.rect(28, 30, 1, 18, Y2)
  for (const x of [6, 18, 42, 54]) {
    let [lx, ly] = [30, 48]
    for (let t = 0.1; t <= 1.001; t += 0.1) {
      const px = Math.round(30 + (x - 30) * t)
      const py = Math.round(48 + 6 * Math.sin(t * Math.PI) - 8 * t)
      c.line(lx, ly, px, py, Y1, 2)
      ;[lx, ly] = [px, py]
    }
    c.rect(x - 2, 39, 5, 2, Y0)
    c.rect(x - 1, 32, 3, 7, K6)
    c.rect(x, 29, 1, 3, Y2)
    c.set(x, 31, OR1)
    c.rect(x, 46, 1, 3, I2)
  }
  c.ellipse(30, 50, 9, 4, Y1)
  c.ellipse(29, 49, 6, 2, Y2)
  c.rect(30, 54, 1, 5, I2)
  c.rect(29, 58, 3, 2, K6)
  c.outline(O)
  addProp('chandelier', c, ['bonus'], 'Gold chandelier with candles and crystals on a chain, 2 tiles tall. Place it in the air where it should hang.')
}

{
  const c = new Canvas(64, 34)
  for (const x of [6, 58]) {
    c.ellipse(x, 31, 5, 1, Y0)
    c.rect(x - 1, 8, 3, 23, Y1)
    c.rect(x - 1, 8, 1, 23, Y2)
    c.circle(x, 6, 2, Y1)
    c.set(x - 1, 5, Y2)
  }
  for (let x = 9; x <= 55; x++) {
    const y = Math.round(11 + 9 * Math.sin(((x - 9) / 46) * Math.PI))
    c.rect(x, y, 1, 3, R2)
    c.set(x, y, R3)
  }
  c.outline(O)
  addProp('rope_barrier', c, ['bonus'], 'Brass posts with a red velvet rope, 2 tiles wide, a tile tall. One every 2 tiles makes a line.')
}

{
  const c = new Canvas(36, 58)
  c.poly([[9, 42], [26, 42], [24, 55], [11, 55]], Y1)
  c.rect(8, 40, 20, 3, Y1)
  c.rect(8, 40, 20, 1, Y2)
  c.rect(23, 43, 2, 12, Y0)
  c.line(18, 40, 17, 22, W1, 2)
  for (const a of [-170, -140, -110, -70, -40, -10]) {
    const r = (a * Math.PI) / 180
    let [lx, ly] = [17, 22]
    for (let t = 0.2; t <= 1.001; t += 0.2) {
      const px = Math.round(17 + Math.cos(r) * t * 15)
      const py = Math.round(22 + Math.sin(r) * t * 15 + t * t * 8)
      c.line(lx, ly, px, py, G2, 2)
      c.line(lx, ly - 1, px, py - 1, G3)
      ;[lx, ly] = [px, py]
    }
  }
  c.outline(O)
  addProp('plant', c, ['bonus'], 'Potted palm in a gold pot, under 2 tiles tall.')
}

/* ---- neon, and the alley behind the wash ---- */

{
  const frames = [[], [6, 7, 8, 9], [2]].map((dead) => {
    const c = new Canvas(132, 54)
    for (const x of [22, 106]) c.rect(x, 1, 4, 6, K2)
    c.rect(2, 6, 128, 46, K1)
    c.rect(4, 8, 124, 42, K0)
    neon(c, 66, 13, 'MIGHTY', R5, R3, R1, { dead: dead.filter((i) => i < 6) })
    neon(c, 66, 33, 'WASH', B4, B2, B0, { dead: dead.filter((i) => i >= 6).map((i) => i - 6) })
    c.outline(O)
    return c
  })
  addPropAnim('neon_mw', frames, ['mega', 'backlot', 'bonus'], 'Neon MIGHTY WASH sign that flickers now and then, 4 tiles wide, 1.5 tall. Hang it high: place it in the air.', 6, {
    order: [...rep(0, 14), 1, 0, 1, ...rep(0, 10), 2, 0, ...rep(0, 3)],
  })
}

{
  const frames = [false, true].map((off) => {
    const c = new Canvas(64, 32)
    c.rect(2, 2, 60, 28, K1)
    c.rect(3, 3, 58, 26, K0)
    c.box(5, 5, 54, 22, off ? B0 : B3)
    if (!off) c.box(4, 4, 56, 24, B1)
    neon(c, 32, 9, 'OPEN', R5, R3, R1, { dead: off ? [0, 1, 2, 3] : [] })
    c.outline(O)
    return c
  })
  addPropAnim('neon_open', frames, ['backlot', 'lube', 'mega'], 'Neon OPEN sign that buzzes off and on, 2 tiles wide, a tile tall. Place it in the air on a wall.', 6, {
    order: [...rep(0, 12), 1, 0, 1, ...rep(0, 5)],
  })
}

{
  const frames = [0, 1, 2, 3].map((f) => {
    const c = new Canvas(56, 34)
    c.rect(2, 2, 52, 30, K1)
    c.rect(3, 3, 50, 28, K0)
    for (let k = 0; k < 3; k++) {
      const lit = f === 3 || f === k
      const t = new Canvas(56, 34)
      const x = 10 + k * 13
      t.line(x, 9, x + 8, 17, lit ? Y2 : OR0, 2)
      t.line(x + 8, 17, x, 25, lit ? Y2 : OR0, 2)
      if (lit) t.outline(OR1)
      c.blit(t, 0, 0)
    }
    c.outline(O)
    return c
  })
  addPropAnim('neon_arrow', frames, ['mega', 'backlot'], 'Neon chevrons chasing to the right, 2 tiles wide, a tile tall. Flip it to point left.', 8)
}

{
  const c = new Canvas(80, 50)
  c.ellipse(40, 8, 7, 4, K2)
  c.rect(37, 6, 3, 2, K3)
  for (const x of [12, 67]) {
    c.circle(x, 45, 3, K1)
    c.set(x, 45, K3)
  }
  c.rect(4, 15, 72, 28, G1)
  c.rect(4, 15, 72, 2, G2)
  c.rect(4, 15, 2, 28, G2)
  c.rect(4, 41, 72, 2, G0)
  c.rect(74, 15, 2, 28, G0)
  for (const x of [18, 40, 62]) {
    c.rect(x, 18, 2, 22, G0)
    c.rect(x + 2, 18, 1, 22, G2)
  }
  c.rect(2, 26, 76, 4, G0)
  c.rect(2, 26, 76, 1, G1)
  // the lid sags at the front and is propped up at the back by a bag: never a flat top
  c.poly([[3, 14], [76, 14], [76, 4], [3, 10]], K1)
  c.line(3, 10, 76, 4, K2)
  c.line(3, 11, 76, 5, K2)
  c.ellipse(64, 4, 6, 4, K2)
  c.set(62, 2, K3)
  c.rect(48, 32, 12, 6, K6)
  c.rect(48, 32, 12, 1, K5)
  c.blit(DROP_S, 51, 31, { swap: { [K6]: B2, [K5]: B1 } })
  c.outline(O)
  addProp('dumpster', c, ['backlot', 'lot'], 'Green dumpster with its lid propped on a bag, 2.5 tiles wide, 1.5 tall.')
}

{
  const c = new Canvas(48, 30)
  for (const [x, y, rx, ry] of [[12, 20, 10, 8], [34, 21, 11, 7], [22, 11, 9, 8]]) {
    c.ellipse(x, y, rx, ry, K1)
    c.ellipse(x - 3, y - 3, Math.max(1, rx - 6), Math.max(1, ry - 5), K2)
    c.set(x - 4, y - 4, K3)
    c.rect(x - 1, y - ry - 2, 3, 3, K1)
    c.set(x - 2, y - ry - 3, K1)
    c.set(x + 2, y - ry - 3, K1)
  }
  c.rect(0, 28, 48, 2, 0)
  c.outline(O)
  addProp('trash_bags', c, ['backlot'], 'Heap of black trash bags, a tile tall.')
}

{
  const c = new Canvas(40, 52)
  c.rect(3, 3, 34, 46, W8)
  c.poly([[24, 49], [37, 36], [37, 49]], 0)
  for (let x = 3; x < 24; x++) if (rnd(x, 1, 91) < 0.45) c.set(x, 48, 0)
  for (let y = 3; y < 20; y++) if (rnd(y, 2, 92) < 0.35) c.set(3, y, 0)
  // a scowling bucket in a sponge hat: Bucket Bill of Bucket Bros.
  c.ellipse(20, 17, 9, 6, K2, { fill: false })
  c.poly([[11, 17], [29, 17], [27, 34], [13, 34]], K4)
  c.rect(11, 17, 19, 2, K5)
  c.rect(13, 31, 15, 1, K3)
  c.rect(12, 11, 16, 6, Y1)
  c.rect(12, 11, 16, 1, Y2)
  for (const [x, y] of [[15, 13], [21, 12], [25, 15], [18, 15]]) c.set(x, y, Y0)
  c.rect(15, 21, 3, 3, K6)
  c.rect(22, 21, 3, 3, K6)
  c.set(16, 22, O)
  c.set(23, 22, O)
  c.line(14, 19, 18, 21, O)
  c.line(26, 19, 22, 21, O)
  c.line(17, 28, 23, 28, O)
  c.set(16, 29, O)
  c.set(24, 29, O)
  // the name clear of the torn corner: the rival is meant to be read
  tiny(c, 19, 36, 'BUCKET', R3)
  tiny(c, 19, 42, 'BROS', R3)
  c.rect(5, 2, 6, 3, K5)
  c.rect(29, 2, 6, 3, K5)
  c.outline(O)
  addProp('poster_bill', c, ['backlot'], 'A rival\'s torn poster: Bucket Bill of Bucket Bros. Place it in the air on a wall.')
}

{
  const c = new Canvas(64, 26)
  sayAt(c, 32, 2, 'EMPLOYEES', Y1)
  sayAt(c, 32, 11, 'ONLY', Y1)
  for (const row of [5, 14]) {
    const cut = []
    for (let x = 0; x < 64; x++) if (c.solid(x, row - 1) && c.solid(x, row) && c.solid(x, row + 1)) cut.push(x)
    for (const x of cut) c.set(x, row, 0)
  }
  for (const [x, y, n] of [[10, 9, 2], [30, 9, 3], [46, 18, 3]]) if (c.solid(x, y - 1)) c.rect(x, y, 1, n, Y1)
  hazard(c, 6, 22, 52, 3, Y1, K0)
  addProp('stencil_employees', c, ['backlot', 'tunnel', 'lube'], 'EMPLOYEES ONLY sprayed on a wall through a stencil, 2 tiles wide. Paint, no outline: place it in the air on a wall or by a door.')
}

/* ------------------------------------------------------------------ */
/* Pack and write                                                      */
/* ------------------------------------------------------------------ */

const atlas = new Atlas('tiles', { script: 'art-tiles.mjs' })
for (const [name, f] of F) atlas.add(name, f.canvas, { ax: f.ax, ay: f.ay })
for (const [name, frames] of Object.entries(ANIMS)) atlas.anim(name, frames)

const TICKS = { prize: 8, power: 8, waxblock: 8, lifeblock: 8, conv: 4, sludge_t: 10 }
atlas.meta({
  tile: T,
  themes: THEMES,
  lookup: 'tiles/<theme>_<key>, then tiles/any_<key>. Every theme has its own ground (7), wall, wall_t, pillar, pillar_t, slick_t, slick_m, oily_t, mud_t; the blocks, catwalk, conveyor, grime, sludge, spikes and pipe exist only as any_ (any_ also holds the lot ground set and wall, a plain grey pillar and the floors, so an unknown theme still draws every tile).',
  ticks: TICKS,
  ticksNote: 'Ticks per frame of the looping tiles. conv: the belt art steps 4 px a frame, so 4 ticks a frame is the 60 px a second the simulation carries things at; play the frames backwards for a belt running right.',
  convTicks: TICKS.conv,
  sludgeSurface: 6,
  sludgeNote: 'The sludge surface in sludge_t rolls between rows 4 and 8: the pit is filled to about 6 px below the lip of the floor beside it.',
  floorsNote: 'slick_t, oily_t and mud_t are each a whole 32 px slab of their stuff (suds, an oil-soaked tread plate, wet mud; ice in winter) with its lip on top and no outline on its sides, made to sit flush between ground tiles. slick_m is the suds or ice without the lip. A covered oily or mud tile is the theme ground_m, as the rule says.',
  decor: DECOR,
  decorNote: "Props: frame tiles/decor_<name>, or for an animated prop the animation anims['decor_<name>'] (it may repeat frames: play its entries in order, meta.decor[name].ticks ticks each). Anchor bottom-centre: draw at the bottom-centre of the tile the prop stands in. front = meant to be drawn in front of Maxx.",
})

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write()
console.log(`tiles atlas: ${out.sheet.w}x${out.sheet.h}, ${F.size} frames, ${Object.keys(DECOR).length} props`)

/* ------------------------------------------------------------------ */
/* Review pictures (only with --review <dir>)                          */
/* ------------------------------------------------------------------ */

const SOLID = new Set('#%BC?!WLUX<>IOMgP')
// a plausible sky for a theme whose background atlas is not drawn yet
const SKY = {
  lot: [[0, B3], [210, B4]],
  vacuum: [[0, W4], [150, W6], [250, W7]],
  tunnel: [[0, K1], [120, K2]],
  storm: [[0, K2], [140, T0], [260, K3]],
  lube: [[0, K0], [150, M0]],
  highway: [[0, P1], [90, P2], [170, OR0], [230, OR1], [290, OR2]],
  winter: [[0, I1], [200, I2]],
  mega: [[0, P0], [160, P1]],
  bonus: [[0, P0], [180, NAVY]],
  backlot: [[0, P0], [140, P1], [280, NAVY]],
}

// For the '#' rule only: the solid tiles that sit in a floor count as ground beside and above it,
// as in render/tiles.ts (never the hidden H h).
const FLOOR_LIKE = new Set('#%IOM<>XgUBCP?!WL')
/** A one-wide column's tile: the left edge piece with the right half of the right one over it. */
const LONE = new Map()
function lone(theme, left, right) {
  const k = `${theme} ${left}`
  if (!LONE.has(k)) {
    const pick = (key) => F.get(`${theme}_${key}`) ?? F.get(`any_${key}`)
    const c = new Canvas(T, T)
    c.blit(pick(left).canvas, 0, 0)
    c.blit(pick(right).canvas, T / 2, 0, { sx: T / 2, sw: T / 2 })
    LONE.set(k, { canvas: c })
  }
  return LONE.get(k)
}

/**
 * The frame the renderer would pick for one tile, by the neighbour rules of render/tiles.ts:
 * outside the area counts as ground, as catwalk and as more of the same sludge, pillar or pipe;
 * a '#' counts every solid floor tile as ground. `grime` gives the hits a 'g' has taken.
 */
function frameFor(theme, rows, tx, ty, tick, grime = 0) {
  const w = rows[0].length
  const at = (x, y) => (y < 0 || y >= rows.length || x < 0 || x >= w ? null : rows[y][x])
  const ground = (x, y) => {
    const ch = at(x, y)
    return ch === null || ch === '#' || ch === '%'
  }
  const groundish = (x, y) => at(x, y) === null || FLOOR_LIKE.has(at(x, y))
  const same = (x, y, c) => {
    const ch = at(x, y)
    return ch === null || ch === c
  }
  const pick = (key) => F.get(`${theme}_${key}`) ?? F.get(`any_${key}`) ?? null
  const ch = at(tx, ty)
  const loop = (key, per) => pick(`${key}${Math.floor(tick / per) % 4}`)
  switch (ch) {
    case '#': {
      const l = groundish(tx - 1, ty)
      const r = groundish(tx + 1, ty)
      if (!groundish(tx, ty - 1)) return !l && !r ? lone(theme, 'ground_tl', 'ground_tr') : pick(!l ? 'ground_tl' : !r ? 'ground_tr' : 'ground_t')
      if (!l && !r) return lone(theme, 'ground_l', 'ground_r')
      return pick(!l ? 'ground_l' : !r ? 'ground_r' : (tx * 7 + ty * 13) % 5 === 0 ? 'ground_m2' : 'ground_m')
    }
    case '%':
      return pick(ground(tx, ty - 1) ? 'wall' : 'wall_t')
    case 'B':
    case 'C':
      return pick('brick')
    case '?':
      return loop('prize', 8)
    case '!':
      return loop('power', 8)
    case 'W':
      return loop('waxblock', 8)
    case 'L':
      return loop('lifeblock', 8)
    case 'U':
      return pick('used')
    case 'X':
      return pick('steel')
    case '=': {
      const l = same(tx - 1, ty, '=')
      const r = same(tx + 1, ty, '=')
      return pick(!l && r ? 'catwalk_l' : l && !r ? 'catwalk_r' : 'catwalk')
    }
    case '<':
      return loop('conv', TICKS.conv)
    case '>':
      return pick(`conv${3 - (Math.floor(tick / TICKS.conv) % 4)}`)
    case 'I':
      return pick(at(tx, ty - 1) === null || SOLID.has(at(tx, ty - 1)) ? 'slick_m' : 'slick_t')
    case 'O':
      return pick(ground(tx, ty - 1) || at(tx, ty - 1) === 'O' ? 'ground_m' : 'oily_t')
    case 'M':
      return pick(ground(tx, ty - 1) || at(tx, ty - 1) === 'M' ? 'ground_m' : 'mud_t')
    case 'g':
      return pick(`grime${Math.min(2, grime >> 1)}`)
    case '~':
      return same(tx, ty - 1, '~') ? pick('sludge_m') : loop('sludge_t', 10)
    case '^':
      return pick('spikes')
    case 'P': {
      let x0 = tx
      while (at(x0 - 1, ty) === 'P') x0--
      const half = (tx - x0) % 2 === 0 ? 'l' : 'r'
      return pick(same(tx, ty - 1, 'P') ? `pipe_${half}` : `pipe_t${half}`)
    }
    case '|':
      return pick(same(tx, ty - 1, '|') ? 'pillar' : 'pillar_t')
    default:
      return null
  }
}

function paintSky(c, theme, bg) {
  const sky = bg?.def.meta?.sky ?? SKY[theme]
  sky.forEach(([y, col], i) => c.rect(0, y, c.w, (sky[i + 1]?.[0] ?? c.h) - y, col))
  if (!bg) return
  // as render/themes.ts draws them: every strip, clouds too, sits on the bottom of the screen
  for (const layer of ['clouds', 'far', 'mid', 'near']) {
    const f = bg.frame(layer)
    if (!f) continue
    for (let x = 0; x < c.w; x += f.w) c.blit(f.canvas, x, c.h - f.h)
  }
}

const TILE_KEYS = new Set('#%BC?!WLUX=<>IOMg~^P|')

/**
 * A room as the game draws it: sky, background strips, tiles, props (z 0, after the tiles),
 * the hero, props in front. `rows` may be taller than the screen; the bottom 360 px are shown.
 * props: [{ name, tx, ty, front?, flip?, f? }] standing on the bottom of the tile they are in.
 * grime(tx, ty) gives the hits a 'g' has taken.
 */
function room(theme, rows, props = [], { hero = null, tick = 0, grime = () => 0 } = {}) {
  const w = rows[0].length * T
  const h = rows.length * T
  const c = new Canvas(w, h)
  const view = new Canvas(640, 360)
  paintSky(view, theme, loadAtlas(`bg_${theme}`))
  for (let x = 0; x < w; x += 640) c.blit(view, x, h - 360)
  const prop = (p) => {
    const f = F.get(`decor_${p.name}`) ?? F.get(`decor_${p.name}${p.f ?? 0}`)
    if (!f) throw new Error(`mock room: no prop ${p.name}`)
    c.blit(f.canvas, p.tx * T + 16 - (p.flip ? f.canvas.w - f.ax : f.ax), p.ty * T + T - f.ay, { flipX: !!p.flip })
  }
  for (let ty = 0; ty < rows.length; ty++) {
    for (let tx = 0; tx < rows[0].length; tx++) {
      const f = frameFor(theme, rows, tx, ty, tick, grime(tx, ty))
      if (f) c.blit(f.canvas, tx * T, ty * T)
      else if (TILE_KEYS.has(rows[ty][tx])) throw new Error(`mock room: no frame for '${rows[ty][tx]}' in ${theme}`)
      // the conveyor's end rollers go over the first and last belt tile of a run
      const ch = rows[ty][tx]
      if (ch === '<' || ch === '>') {
        if (rows[ty][tx - 1] !== ch) c.blit(F.get('any_conv_l').canvas, tx * T, ty * T)
        if (rows[ty][tx + 1] !== ch) c.blit(F.get('any_conv_r').canvas, tx * T, ty * T)
      }
    }
  }
  for (const p of props) if (!p.front) prop(p)
  if (hero && MAXX_ATLAS) {
    const f = MAXX_ATLAS.frame(hero.frame ?? 'idle0')
    c.blit(f.canvas, hero.tx * T + 16 - f.ax, hero.ty * T + T - f.ay, { flipX: !!hero.flip })
  }
  for (const p of props) if (p.front) prop(p)
  return c.crop(0, h - 360, w, 360)
}

// Everything the brief asks a mock room to show: a floor with a pit of sludge, a raised step,
// a wall, a floating row of blocks (spikes on the steel one), a catwalk, a conveyor, a pipe, a
// free pillar and one holding up a block, the three special floors side by side, props and
// the hero.
const MOCK_ROWS = [
  '                    ',
  '                    ',
  '          ^         ',
  '    B?!WLUXg   ===  ',
  '         |          ',
  '         |        %%',
  '    |    |        %%',
  '    |    ##  PP   %%',
  '    |    ##  PP   %%',
  '###IIOOMM##~~##<<<%%',
  '###########~~#######',
  '###########~~#######',
]
// Per theme, [prop, tx, ty = 8, front?]: a few of its props where they would really stand.
const MOCK_PROPS = {
  lot: [['sign_mw', 6], ['cone', 8], ['bush', 0], ['balloons', 10, 6]],
  vacuum: [['vacuum', 6], ['trash_can', 8], ['bench', 0], ['flag', 10, 6]],
  tunnel: [['window', 7, 5], ['chem_tanks', 6], ['sign_exit', 10, 4], ['curtain', 16, 8, true]],
  storm: [['power_pole', 6], ['sandbags', 8], ['tire_pile', 0], ['windsock', 10, 6]],
  lube: [['oil_shelf', 6], ['oil_drum', 8], ['tool_chest', 0], ['lamp_hang', 10, 3]],
  highway: [['billboard', 6], ['rocks', 8], ['cactus', 0], ['yucca', 10, 6]],
  winter: [['mesquite_bare', 6], ['snowman', 8], ['salt_pile', 0], ['cone', 10, 6]],
  mega: [['neon_mw', 7, 5], ['panel', 6], ['neon_arrow', 10, 5], ['curtain', 16, 8, true]],
  bonus: [['vault_door', 6], ['rope_barrier', 8], ['portrait', 10, 5], ['chandelier', 3, 3]],
  backlot: [['fence', 6], ['fence', 8], ['dumpster', 0], ['trash_bags', 7], ['poster_bill', 10, 6]],
}
// The awkward cases of the neighbour rules: lone tiles and columns, blocks two and three wide,
// walls against ground, catwalks of one, two and three, pipes two and four wide and an odd one,
// slick under slick, oily under oily, mud under mud, grime at its three stages, a deep pit.
const RULES_ROWS = [
  '                    ',
  ' #  ##  ###  I  M O ',
  '        ###  I  M O ',
  ' #  ##  ###  #      ',
  ' #  ##       =  ggg ',
  '       #  == % %%ggg',
  ' PP    #     % %%   ',
  ' PP  ###  ===%##### ',
  ' PPPP###     ######P',
  '#########~~~########',
  '#########~~~########',
  '#########~~~########',
]

// Runs of each special floor and of belt on ground, each floor two deep at the start of its
// run, and a slick tile on its own at a ledge; above them, blocks and a pipe set into a ledge
// and a lone column (the '#' rule counts them all as ground).
const FLOOR_ROWS = [
  ...Array(5).fill(' '.repeat(20)),
  '   #   XUgBC?!PP  # ',
  '   #  ##########  # ',
  '   #              # ',
  '                    ',
  '#III#OOO#MMM#<<<##I ',
  '#I###O####M######   ',
  '#################   ',
]

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const themes = THEMES.filter((t) => !ONLY || ONLY.includes(t))
  const fr = (name) => ({ label: name.replace(/^(any|decor)_/, '').replace(/^[a-z]+_(?=ground|wall|pillar|slick|oily|mud)/, ''), canvas: F.get(name).canvas })
  const propsOf = (theme) => Object.entries(DECOR).filter(([, d]) => d.themes.includes(theme)).map(([name]) => name)
  const first = (name) => (F.has(`decor_${name}`) ? `decor_${name}` : `decor_${name}0`)

  for (const theme of [...themes, ...(ONLY && !ONLY.includes('any') ? [] : ['any'])]) {
    const bg = theme === 'any' ? B3 : SKY[theme][Math.min(1, SKY[theme].length - 1)][1]
    const mine = [...F.keys()].filter((n) => n.startsWith(`${theme}_`))
    const rows = []
    if (theme === 'any') {
      const g = (re) => mine.filter((n) => re.test(n)).map(fr)
      rows.push({ label: 'blocks', frames: g(/_(brick|used|steel|prize|power|waxblock|lifeblock)/) })
      rows.push({ label: 'catwalk conveyor pipe spikes', frames: g(/_(catwalk|conv|pipe|spikes)/) })
      rows.push({ label: 'grime sludge', frames: g(/_(grime|sludge)/) })
      rows.push({ label: 'any ground wall pillar floors', frames: g(/_(ground|wall|pillar|slick|oily|mud)/) })
    } else {
      rows.push({ label: `${theme} ground`, frames: mine.filter((n) => n.includes('_ground_')).map(fr) })
      rows.push({ label: 'wall pillar floors', frames: mine.filter((n) => !n.includes('_ground_')).map(fr) })
      const props = propsOf(theme).map((n) => ({ label: n, canvas: F.get(first(n)).canvas }))
      for (const [label, test] of [['props small', (c) => c.h <= 48], ['props tall', (c) => c.h > 48 && c.h <= 100], ['props huge', (c) => c.h > 100]]) {
        const list = props.filter((p) => test(p.canvas))
        if (list.length) rows.push({ label, frames: list })
      }
    }
    for (const scale of [1, 3]) contactSheet(rows, { bg, scale, ground: false, wrap: scale === 1 ? 16 : 9, file: path.join(REVIEW, `sheet_${theme}_${scale}x.png`) })
  }

  for (const theme of themes) {
    const props = (MOCK_PROPS[theme] ?? []).map(([name, tx, ty = 8, front = false]) => ({ name, tx, ty, front }))
    const mock = room(theme, MOCK_ROWS, props, { hero: { tx: 1, ty: 8 } })
    mock.save(path.join(REVIEW, `mock_${theme}.png`))
    mock.scale(2).save(path.join(REVIEW, `mock_${theme}_2x.png`))
    // a later tick, so the moving tiles show another frame
    room(theme, MOCK_ROWS, props, { hero: { tx: 1, ty: 8 }, tick: 20 }).save(path.join(REVIEW, `mock_${theme}_t20.png`))
    room(theme, RULES_ROWS, [], { hero: { tx: 8, ty: 8 }, grime: (tx) => (tx - 16) * 2 }).scale(2).save(path.join(REVIEW, `rules_${theme}.png`))
    // the floors that change how he runs, and blocks set into a ledge, with the ground round them
    room(theme, FLOOR_ROWS, [], { hero: { tx: 6, ty: 8 } }).crop(0, 360 - 256, 640, 256).scale(2).save(path.join(REVIEW, `floors_${theme}.png`))

    // every prop of the theme standing on its floor, on as many screens as it takes
    const list = propsOf(theme)
    const floor = ['####################', '####################']
    let x = 8
    let page = []
    const pages = [page]
    for (const n of list) {
      const cw = F.get(first(n)).canvas.w
      if (x + cw + 8 > 600) {
        page = []
        pages.push(page)
        x = 8
      }
      page.push({ name: n, px: x + Math.floor(cw / 2) })
      x += cw + 10
    }
    pages.forEach((pg, i) => {
      const rows = [...Array(10).fill(' '.repeat(20)), ...floor]
      const c = room(theme, rows, [], { hero: null })
      for (const p of pg) {
        const f = F.get(first(p.name))
        c.blit(f.canvas, p.px - f.ax, 360 - 64 - f.ay)
      }
      if (MAXX_ATLAS) {
        const f = MAXX_ATLAS.frame('idle0')
        c.blit(f.canvas, 616 - f.ax, 360 - 64 - f.ay)
      }
      c.save(path.join(REVIEW, `props_${theme}${i ? `_${i + 1}` : ''}.png`))
      c.scale(2).save(path.join(REVIEW, `props_${theme}${i ? `_${i + 1}` : ''}_2x.png`))
    })
  }

  // every animation as a strip (each distinct frame once, in the order the animation first shows it)
  const strips = (re) => Object.entries(ANIMS).filter(([n]) => re.test(n)).map(([n, names]) => ({ label: n, frames: [...new Set(names)].map((x) => ({ canvas: F.get(x).canvas })) }))
  contactSheet(strips(/^any_/), { bg: B3, scale: 3, ground: false, file: path.join(REVIEW, 'anim_tiles.png') })
  const decorStrips = strips(/^decor_/)
  if (decorStrips.length) {
    contactSheet(decorStrips, { bg: K2, scale: 2, ground: false, wrap: 4, file: path.join(REVIEW, 'anim_decor.png') })
    contactSheet(decorStrips, { bg: B3, scale: 2, ground: false, wrap: 4, flipX: true, file: path.join(REVIEW, 'anim_decor_flip.png') })
  }
  console.log(`review pictures in ${REVIEW}`)
}
