// art-bg.mjs: generates the ten parallax background atlases 'bg_<theme>'.
//
//   node scripts/maxx/art-bg.mjs                      writes bg_<theme>.png + .atlas.ts for all ten
//   node scripts/maxx/art-bg.mjs --only lot,storm     only those themes
//   node scripts/maxx/art-bg.mjs --review <dir>       also writes, per theme, pictures made the way
//       render/themes.ts draws: the 640x360 composite at three camera positions (<theme>_cam0..2.png,
//       _cam1_2x.png), the camera 300 px up a tall area (<theme>_tall.png), the seams
//       (<theme>_seams.png: the 640 px around the join of every strip; <theme>_seam_<strip>.png: two
//       whole copies side by side), and the composite as a level would show it (<theme>_game.png,
//       _game_2x.png): a floor of the theme's own tiles from tiles.png (a flat brown floor if that
//       is not there yet), a pit, a ledge, the hero (maxx idle0) and, when their atlases exist, a
//       grackle, a blob, coins and a token, the things that must read on it. Then all.png.
//
// What an atlas holds:
//   frames  'far', 'mid', 'near', 'clouds': each optional, each tiles horizontally by its own
//           width, each sits with its bottom edge on the bottom of the 360 px screen. 'clouds' is
//           always a full 360 px tall, so it lands the same whether it is hung from the top or
//           stood on the bottom. Indoors (tunnel, lube, mega, bonus) there is no sky and no
//           clouds: 'far' is the whole 360 px back wall and the sky is one band of ceiling colour.
//           Every indoor 'mid' is taller than the screen (520): its top row (cables, cords, the
//           bonus drapes) carries on 160 px up out of sight, so they still reach the ceiling when
//           a tall area makes the strip sink. Only things that hang from the ceiling may touch
//           that top row; anything else there would become a 160 px wall in a tall area.
//   meta    sky [[yTop, colour], ...]   flat bands behind everything
//           weather 'rain' | 'snow' | 'none'
//           cloudSpeed                  px a second, leftward
//           scroll { far, mid, near }   fraction of the camera's x
//           strips { name: { w, h } }   sizes, for whoever wants them without the frame table
//           added                       colours used here that are not in the master palette
//
// How it is drawn: every strip is painted in screen coordinates on a 360 px tall canvas whose
// x wraps (class Strip), so anything drawn across an edge comes back on the other side and the
// join cannot show. Anything that repeats (pilasters, posts, joints, stripes) repeats at a step
// that divides the strip's width. Then shades closer than the eye can tell apart are folded into
// one (foldShades), and the empty rows at the top are cut off before packing.
//
// Colours: the master palette, plus hazed in-betweens (mix() of a palette colour toward the sky
// or the wall behind it). The palette's ramps step too far for distance: pure palette colours in
// the far and mid strips would stand as strong as the tiles. Every such colour is listed in
// meta.added, sky bands included.
//
// Rules the art keeps to: no outlines, no dithering, flat shades; outdoors the far strip is the
// palest and the near one the strongest, indoors the near one is the darkest; no bright level
// ledges in the play band, nothing small, round and bright below the sky, no car shapes, no
// door Maxx's size near the floor and no exit signs (they pass for a door he can use; a wide
// slatted garage door is fine), nothing that could pass for a platform, a pickup or an enemy;
// the MIGHTY WASH roof signs sit a step into the haze
// so Maxx's own red and blue stay the strongest on screen; the last 64 px (behind the floor, seen
// through pits) are flat and calm. The night themes (mega, backlot) keep the walls behind the
// play well away from the value of the purple tiles and the grackle (PAL.purple[1]).

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, dist, hex, rgba } from './pix.mjs'
import { ALL_COLOURS, PAL, checkPalette } from './palette.mjs'
import { ASSETS_DIR } from './paths.mjs'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : null
}
const REVIEW = arg('--review')
const ONLY = arg('--only')?.split(',') ?? null

const VIEW_W = 640
const VIEW_H = 360
/** Where the top of the floor sits on screen in a standard 12-row area. */
const FLOOR_Y = 296
const TAU = Math.PI * 2

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const mod = (n, m) => ((n % m) + m) % m

/** A colour between a and b (t = 0 gives a). Used to haze a palette colour toward the sky. */
function mix(a, b, t) {
  const p = rgba(a)
  const q = rgba(b)
  const ch = (s) => Math.round(((p >>> s) & 255) * (1 - t) + ((q >>> s) & 255) * t)
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | 255) >>> 0
}

/** Seeded random numbers, so a rerun paints the same picture. */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A wobble that repeats exactly every `period` px: [[cycles, amplitude], ...]. */
function wave(period, seed, parts) {
  const r = rng(seed)
  const ps = parts.map(([k, a]) => [k, a, r() * TAU])
  return (x) => ps.reduce((sum, [k, a, ph]) => sum + a * Math.sin((TAU * k * x) / period + ph), 0)
}

/** A canvas whose x wraps: the strip tiles by construction. Coordinates are screen pixels. */
class Strip extends Canvas {
  constructor(w, h = VIEW_H) {
    super(w, h)
  }

  set(x, y, col) {
    if (y < 0 || y >= this.h) return this
    this.d[y * this.w + mod(Math.round(x), this.w)] = rgba(col)
    return this
  }

  get(x, y) {
    return y < 0 || y >= this.h ? 0 : this.d[y * this.w + mod(Math.round(x), this.w)]
  }

  rect(x, y, w, h, col) {
    const v = rgba(col)
    const n = Math.min(w, this.w)
    x = Math.round(x)
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) {
      for (let i = 0; i < n; i++) this.d[j * this.w + mod(x + i, this.w)] = v
    }
    return this
  }

  /** blit() that wraps. mode: 'over' | 'atop' (only onto painted pixels) | 'behind' (only onto empty ones). */
  stamp(src, dx, dy, { mode = 'over', flipX = false } = {}) {
    for (let j = 0; j < src.h; j++) {
      const y = dy + j
      if (y < 0 || y >= this.h) continue
      for (let i = 0; i < src.w; i++) {
        const v = src.d[j * src.w + (flipX ? src.w - 1 - i : i)]
        if ((v & 0xff) === 0) continue
        const k = y * this.w + mod(dx + i, this.w)
        const under = (this.d[k] & 0xff) > 0
        if ((mode === 'atop' && !under) || (mode === 'behind' && under)) continue
        this.d[k] = v
      }
    }
    return this
  }

  /** Fill every column from top(x) down to the bottom. */
  ground(top, col, bottom = this.h) {
    for (let x = 0; x < this.w; x++) {
      const t = Math.round(top(x))
      this.rect(x, t, 1, bottom - t, col)
    }
    return this
  }

  /** Repaint pixels of one colour inside a box (for shade bands over a finished shape). */
  tint(x, y, w, h, from, to) {
    const f = rgba(from)
    const t = rgba(to)
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) {
      for (let i = 0; i < w; i++) {
        const k = j * this.w + mod(x + i, this.w)
        if (this.d[k] === f) this.d[k] = t
      }
    }
    return this
  }
}

/* ------------------------------------------------------------------ */
/* Sky things                                                          */
/* ------------------------------------------------------------------ */

/**
 * A flat-bottomed cumulus, three tones, lit from the top left.
 * K: { light, body, shade }. Returns a canvas w x h with the base on its last row.
 */
function cumulus(w, h, seed, K) {
  const r = rng(seed)
  const n = Math.max(2, Math.round(w / (h * 0.95)))
  const lobes = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const dome = Math.sin(Math.PI * (0.12 + 0.76 * t))
    const ry = Math.max(3, h * (0.3 + 0.34 * dome) * (0.82 + 0.3 * r()))
    const rx = ry * (1.1 + 0.35 * r())
    lobes.push({ cx: rx + t * (w - 2 * rx), cy: h - 1 - ry * 0.3, rx, ry })
  }
  const paint = (ox, oy, shrink, col) => {
    const c = new Canvas(w, h)
    for (const l of lobes) c.ellipse(Math.round(l.cx + ox), Math.round(l.cy + oy), Math.max(1, l.rx - shrink), Math.max(1, l.ry - shrink), col)
    return c
  }
  const out = paint(0, 0, 0, K.shade)
  out.rect(Math.round(lobes[0].cx), h - Math.max(2, Math.round(h * 0.2)), Math.round(lobes[n - 1].cx - lobes[0].cx), h, K.shade)
  const band = Math.max(1, Math.round(h * 0.12))
  const body = paint(-1, -band, 0, K.body)
  body.rect(0, h - band, w, band, 0)
  out.blit(body, 0, 0, { mode: 'atop' })
  if (K.light && h >= 12) {
    const light = paint(-Math.max(2, Math.round(h * 0.08)), -band - Math.max(2, Math.round(h * 0.1)), Math.max(2, Math.round(h * 0.14)), K.light)
    light.rect(0, Math.round(h * 0.62), w, h, 0)
    out.blit(light, 0, 0, { mode: 'atop' })
  }
  return out
}

/** Put cumulus clouds on a strip: list of [x, baseY, w, h]. */
function clouds(c, list, K, seed = 1) {
  list.forEach(([x, base, w, h], i) => c.stamp(cumulus(w, h, seed * 97 + i * 13, K), x, base - h + 1))
}

/** A long thin evening cloud: `top` above its middle line, the lit `belly` below. */
function streak(c, x, y, w, h, top, belly) {
  for (let i = 0; i < w; i++) {
    const u = (i - (w - 1) / 2) / (w / 2)
    const t = Math.round((h / 2) * Math.sqrt(Math.max(0, 1 - u * u)))
    if (t <= 0) continue
    c.rect(x + i, y - t, 1, t, top)
    c.rect(x + i, y, 1, Math.max(1, Math.round(t * 0.6)), belly)
  }
}

/**
 * A storm front: solid cloud from the top of the screen whose underside hangs in two rows of
 * rounded bellies, the back row paler and rimmed with light, the front row as dark as the mass.
 * Each row is one flat colour, so no slivers are left where they overlap. K: { dark, belly, edge }.
 */
function stormDeck(c, base, K, seed = 1) {
  const r = rng(seed)
  const row = (n, y, ry, cols, shift) => {
    const lobes = []
    for (let i = 0; i < n; i++) {
      const cx = Math.round(((i + 0.5 + shift) * c.w) / n + (r() - 0.5) * (c.w / n) * 0.4)
      lobes.push([cx, Math.round((c.w / n) * (0.58 + 0.22 * r())), Math.round(ry * (0.7 + 0.45 * r()))])
    }
    // colour by colour, so the rim shows only along the bottom of the whole row
    cols.forEach((col, k) => lobes.forEach(([cx, rx, h]) => c.ellipse(cx, y - k * 2, rx, h, col)))
  }
  row(Math.round(c.w / 120), base - 24, 26, [K.edge, K.belly], 0)
  c.rect(0, 0, c.w, base - 38, K.dark)
  row(Math.round(c.w / 150), base - 42, 22, [K.dark], 0.5)
}

/**
 * Curtains of rain hanging from a cloud base: slanted shafts a shade darker than the sky behind
 * them (taken band by band from `sky`), each column of a shaft stopping at its own depth.
 * list: [[x, w, foot], ...].
 */
function rainShafts(c, sky, top, list, toward, t = 0.35) {
  const skyAt = (y) => sky.reduce((col, [yy, cc]) => (y >= yy ? cc : col), sky[0][1])
  for (const [x, w, foot] of list) {
    for (let i = 0; i < w; i++) {
      const end = foot - ((i * 37 + x) % 17)
      for (let y = top; y <= end; y++) c.set(x + i - Math.round((y - top) * 0.32), y, mix(skyAt(y), toward, t))
    }
  }
}

/** Stars: single pixels, a few of them brighter. */
function stars(c, n, yMax, dim, bright, seed = 1) {
  const r = rng(seed)
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * c.w)
    const y = Math.floor(r() * r() * yMax)
    c.set(x, y, i % 5 === 0 ? bright : dim)
  }
}

/* ------------------------------------------------------------------ */
/* Land                                                                */
/* ------------------------------------------------------------------ */

/**
 * A mesa: talus slopes, a cliff band and a flat cap. The left flank is lit, the right one in
 * shade. `tier` (0..1) adds a second, narrower cap. K: { cliff, talus, lit, shade }.
 */
function mesa(c, x, base, w, h, K, seed = 1, { tier = 0.6, steep = 3, rim = 1 } = {}) {
  const rimCol = K.rim ?? K.lit
  const r = rng(seed)
  const th = Math.max(2, Math.round(h * (0.36 + 0.14 * r())))
  const sl = 1.5 + 0.7 * r()
  const sr = 1.2 + 0.6 * r()
  const twl = Math.round(th * sl)
  const twr = Math.round(th * sr)
  const top = new Array(w).fill(0)
  for (let i = 0; i < w; i++) {
    const rr = w - 1 - i
    const hl = i < twl ? i / sl : th + (i - twl + 1) * steep
    const hr = rr < twr ? rr / sr : th + (rr - twr + 1) * steep
    top[i] = Math.min(h, Math.round(Math.min(hl, hr)))
  }
  const capL = top.findIndex((t) => t >= h)
  const capR = w - 1 - [...top].reverse().findIndex((t) => t >= h)
  // a few shallow nicks in the rim
  for (let k = 0; k < Math.floor((capR - capL) / 50); k++) {
    const a = capL + 4 + Math.floor(r() * Math.max(1, capR - capL - 20))
    const len = 6 + Math.floor(r() * 12)
    for (let i = a; i < Math.min(capR - 3, a + len); i++) top[i] = h - 1 - (i > a && i < a + len - 1 && len > 10 ? 1 : 0)
  }
  for (let i = 0; i < w; i++) {
    const t = top[i]
    if (t <= 0) continue
    const X = x + i
    const side = i < capL ? -1 : i > capR ? 1 : 0
    const talusH = Math.min(t, th)
    c.rect(X, base - talusH, 1, talusH, side > 0 ? K.cliff : K.talus)
    if (t > th) {
      c.rect(X, base - t, 1, t - th, side < 0 ? K.lit : side > 0 ? K.shade : K.cliff)
      if (side === 0 || rim > 1) c.rect(X, base - t, 1, Math.min(rim, t - th), rimCol)
    }
  }
  // one bed of darker rock through the cliff
  if (h - th >= 10) {
    const bed = base - th - Math.round((h - th) * 0.45)
    for (let i = capL; i <= capR; i++) c.rect(x + i, bed, 1, h - th > 18 ? 2 : 1, K.shade)
  }
  if (tier > 0 && capR - capL > 40) {
    const span = capR - capL
    const a = capL + Math.round(span * (0.1 + 0.35 * r()))
    const b = Math.min(capR - 8, a + Math.round(span * (0.25 + 0.3 * r())))
    const up = Math.max(3, Math.round(h * 0.24 * tier))
    for (let i = a; i <= b; i++) {
      const hh = Math.min(up, (i - a + 1) * 2, (b - i + 1) * 2)
      c.rect(x + i, base - h - hh, 1, hh + 1, i > b - up / 2 ? K.shade : i < a + up / 2 ? K.lit : K.cliff)
      if (rim > 1 || (i >= a + up / 2 && i <= b - up / 2)) c.rect(x + i, base - h - hh, 1, Math.min(rim, hh), rimCol)
    }
  }
}

/** Thin horizontal marks on flat ground: [[x, y, w], ...]. */
function streaks(c, list, col) {
  for (const [x, y, w] of list) c.rect(x, y, w, 1, col)
}

/** A short run of distant power poles with a sagging wire between each pair. K: { pole, wire }. */
function poleLine(c, x0, x1, base, h, gap, K) {
  for (let x = x0; x <= x1; x += gap) {
    c.rect(x, base - h, 1, h, K.pole)
    c.rect(x - 2, base - h + 1, 5, 1, K.pole)
    if (x + gap > x1) break
    for (let i = 1; i < gap; i++) {
      const t = i / gap
      c.set(x + i, base - h + 1 + Math.round(4 * t * (1 - t) * Math.max(2, h / 5)), K.wire)
    }
  }
}

/** A power line right across the strip: poles every `gap` px (gap must divide the width). K: { pole, wire }. */
function powerLine(c, base, h, gap, K, phase = 0, wires = 2) {
  for (let x = phase; x < c.w + phase; x += gap) {
    for (let k = 0; k < wires; k++) {
      for (let i = 0; i < gap; i++) {
        const t = i / gap
        c.set(x + i + (k ? 5 : -5), base - h + 2 + k * 6 + Math.round(4 * t * (1 - t) * 9), K.wire)
      }
    }
  }
  for (let x = phase; x < c.w + phase; x += gap) {
    c.rect(x - 1, base - h, 3, h, K.pole)
    c.rect(x - 8, base - h + 2, 17, 2, K.pole)
    c.rect(x - 6, base - h + 8, 13, 2, K.pole)
    for (const dx of [-8, 7]) c.rect(x + dx, base - h, 2, 2, K.pole)
  }
}

/** Fence posts with sagging wires, for the near strip. K: { post, wire }. */
function fence(c, x0, x1, base, h, gap, K, wires = 2) {
  const r = rng(x0 + h)
  for (let x = x0; x <= x1; x += gap) {
    const tall = h + Math.floor(r() * 3) - 1
    c.rect(x, base - tall, 2, tall, K.post)
    if (x + gap > x1) break
    for (let k = 0; k < wires; k++) {
      const y = base - h + 3 + k * Math.max(4, Math.floor((h - 6) / wires))
      for (let i = 2; i < gap; i++) {
        const t = i / gap
        c.set(x + i, y + Math.round(4 * t * (1 - t) * 2), K.wire)
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Machines and buildings                                              */
/* ------------------------------------------------------------------ */

/** A wind turbine. `ang` turns the rotor (radians). K: { body, shade }. */
function turbine(c, x, base, h, ang, K) {
  const big = h >= 44
  if (big) {
    const half = Math.round(h * 0.5)
    c.rect(x - 2, base - half, 4, half, K.body)
    c.rect(x - 1, base - h, 3, h - half, K.body)
    c.rect(x + 1, base - h, 1, h, K.shade)
    c.rect(x - 3, base - h - 3, 8, 4, K.body)
    c.rect(x - 3, base - h, 8, 1, K.shade)
  } else {
    c.rect(x, base - h, h >= 22 ? 2 : 1, h, K.body)
  }
  const hx = x
  const hy = base - h - (big ? 2 : 0)
  const len = Math.round(h * (big ? 0.46 : 0.5))
  for (let k = 0; k < 3; k++) {
    const a = ang + (k * TAU) / 3
    const tx = hx + Math.sin(a) * len
    const ty = hy - Math.cos(a) * len
    if (big) {
      const px = Math.cos(a) * 1.6
      const py = Math.sin(a) * 1.6
      c.poly([[Math.round(hx + px), Math.round(hy + py)], [Math.round(tx), Math.round(ty)], [Math.round(hx - px), Math.round(hy - py)]], K.body)
    } else {
      c.line(hx, hy, tx, ty, K.body)
    }
  }
  if (big) c.rect(hx - 1, hy - 1, 3, 3, K.shade)
}

/**
 * A pumpjack, horsehead to the right (or left with flip). u is the unit: the machine is about
 * 40u wide and 26u tall. tilt: the walking beam's slope (positive = head down). K: { body, shade }.
 */
function pumpjack(c, x, base, u, tilt, K, flip = false) {
  const tmp = new Canvas(Math.ceil(48 * u), Math.ceil(34 * u))
  const ox = Math.round(22 * u)
  const oy = tmp.h - 1
  const X = (v) => Math.round(ox + v * u)
  const Y = (v) => Math.round(oy - v * u)
  const thick = Math.max(1, Math.round(1.6 * u))
  tmp.rect(X(-20), Y(2), Math.round(38 * u), Math.max(1, Math.round(2 * u)), K.shade)
  tmp.rect(X(-20), Y(8), Math.round(7 * u), Math.round(6 * u), K.body)
  tmp.line(X(-5), Y(2), X(2), Y(22), K.body, thick)
  tmp.line(X(9), Y(2), X(2), Y(22), K.body, thick)
  tmp.line(X(-2), Y(11), X(6), Y(11), K.body, 1)
  const bx0 = -15
  const bx1 = 17
  const by = (v) => 22 - (v - 2) * tilt
  tmp.line(X(bx0), Y(by(bx0)), X(bx1), Y(by(bx1)), K.body, Math.max(2, Math.round(2.4 * u)))
  const hy = by(bx1)
  tmp.poly([[X(bx1 - 1), Y(hy + 5)], [X(bx1 + 4), Y(hy + 4)], [X(bx1 + 5), Y(hy - 6)], [X(bx1 - 1), Y(hy - 3)]], K.body)
  tmp.line(X(bx1 + 4), Y(hy - 6), X(bx1 + 4), Y(2), K.shade, 1)
  tmp.circle(X(-11), Y(9), Math.max(2, Math.round(4.5 * u)), K.shade)
  tmp.line(X(bx0 + 1), Y(by(bx0 + 1)), X(-11), Y(9), K.body, 1)
  c.stamp(tmp, x - (flip ? tmp.w - ox : ox), base - tmp.h + 1, { flipX: flip })
}

/** A water tower on legs. K: { body, shade, band }. */
function waterTower(c, x, base, h, K) {
  const tw = Math.round(h * 0.42)
  const th = Math.round(h * 0.26)
  const top = base - h
  const legTop = top + th + 2
  for (const [a, b] of [[-tw / 2 + 2, -tw / 2 - 4], [tw / 2 - 2, tw / 2 + 4]]) c.line(x + a, legTop, x + b, base, K.shade, 2)
  c.rect(x - 1, legTop, 2, base - legTop, K.shade)
  const m1 = legTop + Math.round((base - legTop) * 0.36)
  const m2 = legTop + Math.round((base - legTop) * 0.7)
  c.line(x - tw / 2 + 1, m1, x + tw / 2 + 2, m2, K.shade)
  c.line(x + tw / 2, m1, x - tw / 2 - 2, m2, K.shade)
  c.ellipse(x, top + th, tw / 2, Math.round(th * 0.35), K.shade)
  c.rect(x - Math.round(tw / 2), top + 6, tw + 1, th - 5, K.body)
  c.rect(x + Math.round(tw / 2) - 4, top + 6, 5, th - 5, K.shade)
  c.rect(x - Math.round(tw / 2), top + 6 + Math.round(th * 0.4), tw + 1, 3, K.band)
  c.poly([[x - Math.round(tw / 2) - 1, top + 6], [x, top], [x + Math.round(tw / 2) + 1, top + 6]], K.cap ?? K.body)
  c.rect(x, top - 3, 1, 3, K.shade)
}

/**
 * A ranch windmill: a lattice tower, a fan wheel of separate blades with light between them
 * (a solid disc reads as a ball on a stick), and the tail vane on its boom. K: { body, shade }.
 */
function windmill(c, x, base, h, K, ang = 0.15) {
  const top = base - h
  const foot = Math.round(h * 0.17)
  c.line(x - foot, base, x - 1, top + 5, K.body)
  c.line(x + foot, base, x + 1, top + 5, K.body)
  for (const f of [0.28, 0.55]) {
    const y = base - Math.round(h * f)
    const half = Math.round(foot * (1 - f)) + 1
    c.rect(x - half, y, half * 2 + 1, 1, K.body)
  }
  c.line(x - foot + 1, base - Math.round(h * 0.02), x + Math.round(foot * 0.72), base - Math.round(h * 0.28), K.body)
  const R = Math.max(6, Math.round(h * 0.21))
  const cy = top + 2
  // the tail first, so the wheel stands in front of its boom
  c.rect(x - R - 6, cy - 1, R + 6, 2, K.body)
  c.poly([[x - R - 5, cy - 2], [x - R - 15, cy - 6], [x - R - 15, cy + 5], [x - R - 5, cy + 2]], K.body)
  const n = R >= 10 ? 12 : 9
  const half = 0.15
  const at = (a, r) => [Math.round(x + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]
  for (let k = 0; k < n; k++) {
    const a = ang + (k * TAU) / n
    c.poly([at(a, R * 0.32), at(a - half, R), at(a + half, R)], K.body)
  }
  c.circle(x, cy, Math.max(1, Math.round(R * 0.22)), K.shade)
}

/**
 * The Mighty Wash: a long tunnel building with a tower over the entrance and the sign on the
 * roof. x is its left end; about 230 px wide and 68 tall.
 * K: { wall, wallShade, trim, stripe, glass, dark, sign, red, blue, post, snow? }.
 */
function mightyWash(c, x, base, K) {
  // the tunnel
  c.rect(x + 34, base - 30, 190, 30, K.wall)
  c.rect(x + 34, base - 8, 190, 8, K.wallShade)
  c.rect(x + 32, base - 34, 194, 4, K.trim)
  c.rect(x + 34, base - 27, 190, 3, K.stripe)
  for (let i = 0; i < 7; i++) c.rect(x + 48 + i * 22, base - 21, 16, 10, K.glass)
  for (let i = 0; i < 7; i++) c.rect(x + 48 + i * 22, base - 21, 16, 3, K.wallShade)
  // rooftop boxes, and the way out at the far end
  c.rect(x + 150, base - 39, 12, 5, K.wallShade)
  c.rect(x + 170, base - 38, 8, 4, K.wallShade)
  c.rect(x + 206, base - 19, 12, 19, K.dark)
  c.rect(x + 207, base - 21, 10, 2, K.dark)
  // the entrance tower
  c.rect(x, base - 46, 36, 46, K.wall)
  c.rect(x + 30, base - 46, 6, 46, K.wallShade)
  c.rect(x - 2, base - 51, 40, 5, K.trim)
  c.rect(x, base - 43, 36, 3, K.stripe)
  c.rect(x + 7, base - 25, 18, 25, K.dark)
  c.rect(x + 9, base - 28, 14, 3, K.dark)
  c.rect(x + 11, base - 30, 10, 2, K.dark)
  c.rect(x + 17, base - 64, 1, 13, K.post)
  c.poly([[x + 18, base - 64], [x + 26, base - 61], [x + 18, base - 58]], K.stripe)
  // the sign: MIGHTY in red over WASH in blue
  const sx = x + 72
  const sy = base - 67
  c.rect(sx + 9, sy + 27, 2, 7, K.post)
  c.rect(sx + 51, sy + 27, 2, 7, K.post)
  c.rect(sx - 1, sy - 1, 64, 29, K.trim)
  c.rect(sx, sy, 62, 27, K.sign)
  c.text(sx + 8, sy + 3, 'MIGHTY', K.red, 2)
  c.text(sx + 16, sy + 15, 'WASH', K.blue, 2)
  if (K.snow) {
    c.rect(x - 2, base - 53, 40, 2, K.snow)
    c.rect(x + 32, base - 36, 194, 2, K.snow)
    c.rect(sx - 1, sy - 3, 64, 2, K.snow)
  }
}

/** A row of vacuum bays under one long canopy. K: { roof, stripe, post, unit, hose }. */
function vacuumBays(c, x, base, bays, K) {
  const bw = 26
  const w = bays * bw
  for (let i = 0; i <= bays; i++) c.rect(x + i * bw - 1, base - 30, 2, 30, K.post)
  for (let i = 0; i < bays; i++) {
    const px = x + i * bw
    c.rect(px + 3, base - 13, 6, 13, K.unit)
    c.rect(px + 3, base - 15, 6, 2, K.post)
    // the hose swings out from the canopy and hangs
    for (let k = 0; k <= 14; k++) c.set(px + 9 + k, base - 30 + Math.round(13 * Math.sin((k / 14) * Math.PI * 0.5)), K.hose)
    c.rect(px + 23, base - 17, 1, 6, K.hose)
  }
  c.rect(x - 5, base - 35, w + 10, 5, K.roof)
  for (let i = 0; i < bays; i += 2) c.rect(x + i * bw, base - 35, bw, 5, K.stripe)
  c.rect(x - 5, base - 36, w + 10, 1, K.post)
}

/** A billboard on two legs. lines: [[text, colour], ...] in the 3x5 font. K: { post, frame, face }. */
function billboard(c, x, base, w, h, legH, K, lines = []) {
  c.rect(x + 6, base - legH, 2, legH, K.post)
  c.rect(x + w - 8, base - legH, 2, legH, K.post)
  c.rect(x, base - legH - h, w, h, K.frame)
  c.rect(x + 1, base - legH - h + 1, w - 2, h - 2, K.face)
  const pitch = Math.floor((h - 3) / Math.max(1, lines.length))
  lines.forEach(([text, col], i) => c.text(x + Math.round((w - (text.length * 4 - 1)) / 2), base - legH - h + 2 + Math.floor((pitch - 5) / 2) + i * pitch, text, col))
}

/** A low row of flat-roofed buildings, a few windows lit. K: { body, lit }. */
function skyline(c, x0, x1, base, K, seed, minH = 8, maxH = 30) {
  const r = rng(seed)
  let x = x0
  while (x < x1) {
    const w = 14 + Math.floor(r() * 34)
    const h = minH + Math.floor(r() * (maxH - minH))
    c.rect(x, base - h, w, h, K.body)
    if (K.lit) {
      for (let wy = base - h + 4; wy < base - 4; wy += 6) {
        for (let wx = x + 3; wx < x + w - 3; wx += 5) if (r() < 0.16) c.rect(wx, wy, 2, 2, K.lit)
      }
    }
    x += w + Math.floor(r() * 5)
  }
}

/* ------------------------------------------------------------------ */
/* Plants                                                              */
/* ------------------------------------------------------------------ */

/** A round desert shrub. K: { body, light, shade }. */
function shrub(c, x, base, w, h, K) {
  const rx = w / 2
  c.ellipse(x, base - h * 0.45, rx, h * 0.55, K.shade)
  c.ellipse(x - 1, base - h * 0.55, rx - 1, h * 0.5, K.body)
  if (K.light) c.ellipse(x - rx * 0.3, base - h * 0.72, rx * 0.5, h * 0.24, K.light)
}

/** A mesquite in leaf: a low, wide, lumpy crown on crooked limbs. K: { trunk, body, light, shade }. */
function mesquite(c, x, base, s, K, seed = 1) {
  const r = rng(seed)
  c.line(x, base, x - s * 0.35, base - s * 0.9, K.trunk, s > 14 ? 2 : 1)
  c.line(x + 1, base, x + s * 0.5, base - s * 0.8, K.trunk, s > 14 ? 2 : 1)
  const lobes = []
  for (let i = 0; i < 5; i++) lobes.push([x + (i - 2) * s * 0.42 + (r() - 0.5) * s * 0.2, base - s * (0.95 + 0.3 * Math.sin((i / 4) * Math.PI)) - r() * s * 0.15, s * (0.5 + 0.15 * r()), s * (0.3 + 0.1 * r())])
  for (const [cx, cy, rx, ry] of lobes) c.ellipse(Math.round(cx + 1), Math.round(cy + 2), rx, ry, K.shade)
  for (const [cx, cy, rx, ry] of lobes) c.ellipse(Math.round(cx), Math.round(cy), rx, ry * 0.9, K.body)
  if (K.light) for (const [cx, cy, rx, ry] of lobes.slice(0, 3)) c.ellipse(Math.round(cx - rx * 0.2), Math.round(cy - ry * 0.4), rx * 0.55, ry * 0.4, K.light)
}

/** A leafless tree or bush: crooked limbs that fork. */
function bareTree(c, x, base, h, col, seed = 1, lean = 0) {
  const r = rng(seed)
  const limb = (px, py, ang, len, thick, depth) => {
    const ex = px + Math.sin(ang) * len
    const ey = py - Math.cos(ang) * len
    c.line(px, py, ex, ey, col, thick)
    if (depth <= 0 || len < 3) return
    const kids = depth > 1 && r() < 0.35 ? 3 : 2
    for (let k = 0; k < kids; k++) limb(ex, ey, ang + (k - (kids - 1) / 2) * (0.75 + 0.3 * r()) + (r() - 0.5) * 0.4, len * (0.6 + 0.2 * r()), Math.max(1, thick - 1), depth - 1)
  }
  limb(x, base, lean + (r() - 0.5) * 0.3, h * 0.36, h > 40 ? 3 : 2, h > 40 ? 4 : 3)
}

/** A yucca: a fan of blades, and now and then a flower stalk. K: { body, light, stalk, bloom }. */
function yucca(c, x, base, s, K, stalk = 0) {
  if (stalk) {
    c.rect(x, base - s - stalk, 1, stalk + 2, K.stalk)
    c.ellipse(x, base - s - stalk - 3, 2, 5, K.bloom)
  }
  for (let k = -4; k <= 4; k++) {
    const a = k * 0.34
    c.line(x, base, x + Math.sin(a) * s, base - Math.cos(a) * s, k < 0 ? K.light : K.body, Math.abs(k) < 3 && s > 9 ? 2 : 1)
  }
}

/** A prickly pear: a pile of pads. K: { body, shade }. */
function pear(c, x, base, s, K) {
  for (const [dx, dy, rx, ry] of [[0, 0.5, 0.55, 0.6], [-0.6, 1.1, 0.4, 0.5], [0.55, 1.2, 0.42, 0.5], [0, 1.7, 0.36, 0.42]]) {
    c.ellipse(Math.round(x + dx * s + 1), Math.round(base - dy * s), rx * s, ry * s, K.shade)
    c.ellipse(Math.round(x + dx * s), Math.round(base - dy * s - 1), rx * s - 1, ry * s - 1, K.body)
  }
}

/** A clump of dry grass or sage: a few short strokes. */
function tuft(c, x, base, s, col, seed = 1) {
  const r = rng(seed)
  for (let k = -3; k <= 3; k++) {
    const a = k * 0.3 + (r() - 0.5) * 0.2
    const len = s * (0.6 + 0.4 * r())
    c.line(x + k, base, x + k + Math.sin(a) * len, base - Math.cos(a) * len, col)
  }
}

/** The band behind the floor: what shows through a pit. Flat, and darker than the ground above it. */
function under(c, col, deep) {
  c.rect(0, FLOOR_Y, c.w, VIEW_H - FLOOR_Y, col)
  if (deep) c.rect(0, FLOOR_Y + 34, c.w, VIEW_H, deep)
}

/* ------------------------------------------------------------------ */
/* Indoors                                                             */
/* ------------------------------------------------------------------ */

/** Diagonal hazard stripes in a box, `step` px each, leaning right. */
function hazard(c, x, y, w, h, a, b, step = 6) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) c.set(x + i, y + j, mod(x + i + y + j, step * 2) < step ? a : b)
}

/** A roof truss right across the strip: two chords and a zigzag web. `bay` must divide the width. */
function truss(c, yTop, yBot, bay, col) {
  c.rect(0, yTop, c.w, 2, col)
  c.rect(0, yBot, c.w, 2, col)
  for (let x = 0; x < c.w; x += bay) {
    c.line(x, yBot, x + bay / 2, yTop + 1, col)
    c.line(x + bay / 2, yTop + 1, x + bay, yBot, col)
  }
}

/** A plate hanging on two wires from the top of the strip, its words centred. K: { wire, frame, face, ink }. */
function hangingSign(c, x, y, w, h, text, K, scale = 1) {
  c.rect(x + 4, 0, 1, y, K.wire)
  c.rect(x + w - 5, 0, 1, y, K.wire)
  c.rect(x, y, w, h, K.frame)
  c.rect(x + 1, y + 1, w - 2, h - 2, K.face)
  const tw = text.length * 4 * scale - scale
  c.text(x + Math.round((w - tw) / 2), y + Math.round((h - 5 * scale) / 2), text, K.ink, scale)
}

/** Copy a box of `view` into `c` at the same place: a window onto whatever `view` holds. */
function windowOnto(c, view, x, y, w, h) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) c.set(x + i, y + j, view.get(x + i, y + j))
}

/**
 * A wash arch: two legs and a round head, lit along its top left. `w` wide, its crown `h` above
 * `base`. K: { body, light, shade, nozzle? }.
 */
function washArch(c, x, base, w, h, thick, K) {
  const rx = Math.floor(w / 2)
  const ry = Math.min(rx, Math.round(h * 0.45))
  const tmp = new Canvas(w + 1, h + 1)
  tmp.ellipse(rx, ry, rx, ry, K.light)
  tmp.rect(0, ry, w + 1, h - ry + 1, K.light)
  const body = new Canvas(w + 1, h + 1)
  body.ellipse(rx + 2, ry + 2, rx, ry, K.body)
  body.rect(2, ry + 2, w + 1, h - ry + 1, K.body)
  tmp.blit(body, 0, 0, { mode: 'atop' })
  // the shade on the far leg
  tmp.rect(w - thick + Math.ceil(thick / 2), ry, Math.floor(thick / 2), h - ry + 1, K.shade)
  // the opening, and a tube of light along its edge if asked
  if (K.trim) {
    tmp.ellipse(rx, ry, rx - thick + 2, ry - thick + 2, K.trim)
    tmp.rect(thick - 2, ry, w - 2 * thick + 5, h - ry + 1, K.trim)
  }
  tmp.ellipse(rx, ry, rx - thick, ry - thick, 0)
  tmp.rect(thick, ry, w - 2 * thick + 1, h - ry + 1, 0)
  if (K.nozzle) {
    for (let k = 1; k < 6; k++) {
      const a = Math.PI * (k / 6)
      tmp.rect(Math.round(rx - Math.cos(a) * (rx - thick)), Math.round(ry - Math.sin(a) * (ry - thick)), 2, 2, K.nozzle)
    }
  }
  c.stamp(tmp, x, base - h)
}

/** A cloth curtain of hanging strips on a rail hung from the top. K: { rail, a, b }. */
function curtain(c, x, w, railY, len, K, seed = 1) {
  const r = rng(seed)
  c.rect(x + 2, 0, 1, railY, K.rail)
  c.rect(x + w - 3, 0, 1, railY, K.rail)
  for (let i = 0; i + 4 <= w; i += 5) {
    const l = len - Math.floor(r() * len * 0.22)
    c.rect(x + i, railY + 2, 4, l, (i / 5) % 2 ? K.a : K.b)
  }
  c.rect(x - 2, railY, w + 3, 3, K.rail)
}

/** A hose hanging in a loop between two hooks on cords from the top: a sagging curve. */
function hoseLoop(c, x0, x1, y, sag, col, thick = 2) {
  c.rect(x0, 0, 1, y, col)
  c.rect(x1, 0, 1, y, col)
  let px = x0
  let py = y
  for (let i = 1; i <= 24; i++) {
    const t = i / 24
    const nx = x0 + (x1 - x0) * t
    const ny = y + 4 * t * (1 - t) * sag
    c.line(px, py, nx, ny, col, thick)
    px = nx
    py = ny
  }
}

/**
 * A shop lamp: a cord from the top, a cone shade, and `pool` rows of light below it, a flat
 * stepped cone that lightens the wall colours it falls on. K: { cord, shade, bulb, tints? [[from, to], ...] }.
 */
function shopLamp(c, x, y, K, pool = 0) {
  for (let j = 0; j < pool; j++) {
    const half = 7 + Math.round(j * 0.55)
    for (const [from, to] of K.tints ?? []) c.tint(x - half, y + 8 + j, half * 2 + 1, 1, from, to)
  }
  c.rect(x, 0, 1, y, K.cord)
  c.poly([[x - 2, y], [x + 2, y], [x + 7, y + 7], [x - 7, y + 7]], K.shade)
  c.rect(x - 3, y + 8, 7, 2, K.bulb)
}

/** Steel shelving with rows of cans. K: { post, shelf, cans: [...] }. */
function shelving(c, x, base, w, h, K, seed = 1) {
  const r = rng(seed)
  const rows = Math.max(2, Math.round(h / 24))
  const pitch = Math.floor(h / rows)
  for (let k = 0; k < rows; k++) {
    const sy = base - h + k * pitch
    // cans standing on the shelf below this one
    let cx = x + 3
    while (cx < x + w - 6) {
      const cw = 4 + Math.floor(r() * 3)
      const ch = Math.min(pitch - 5, 7 + Math.floor(r() * 6))
      if (r() < 0.85) {
        const col = K.cans[Math.floor(r() * K.cans.length)]
        c.rect(cx, sy + pitch - ch, cw, ch, col)
        c.rect(cx + 1, sy + pitch - ch - 1, cw - 2, 1, col)
      }
      cx += cw + 1 + (r() < 0.2 ? 3 : 0)
    }
    c.rect(x, sy + pitch, w, 2, K.shelf)
  }
  c.rect(x, base - h, 2, h + 2, K.post)
  c.rect(x + w - 2, base - h, 2, h + 2, K.post)
  c.rect(x, base - h, w, 2, K.shelf)
}

/** A steel drum standing on the floor. K: { body, light, band }. */
function drum(c, x, base, K, w = 16, h = 22) {
  c.rect(x, base - h, w, h, K.body)
  c.rect(x + 2, base - h, 3, h, K.light)
  c.rect(x, base - h + 5, w, 2, K.band)
  c.rect(x, base - 7, w, 2, K.band)
  c.rect(x + 1, base - h - 1, w - 2, 1, K.body)
}

/** A horizontal pipe with flanges every `gap` px. K: { body, light, flange }. */
function pipeRun(c, x0, x1, y, th, gap, K) {
  c.rect(x0, y, x1 - x0, th, K.body)
  c.rect(x0, y, x1 - x0, 1, K.light)
  for (let x = x0 + gap / 2; x < x1; x += gap) c.rect(Math.round(x), y - 1, 3, th + 2, K.flange)
}

/** A vertical pipe from the top of the strip down to `y1`, with an elbow into the wall. */
function pipeDown(c, x, y1, th, K) {
  c.rect(x, 0, th, y1, K.body)
  c.rect(x, 0, 1, y1, K.light)
  c.rect(x - 1, y1 - 3, th + 2, 3, K.flange)
}

/**
 * Fold every off-palette shade that sits within `limit` (redmean distance; 6 is a step of one
 * or two levels per channel, which nobody can see) of a more used colour into that colour,
 * across all of a theme's strips, so the atlas carries only shades that make a difference.
 */
function foldShades(strips, limit = 6) {
  const count = new Map()
  for (const s of strips) for (const v of s.d) if (v & 0xff) count.set(v, (count.get(v) ?? 0) + 1)
  const pal = new Set(ALL_COLOURS.map((c) => rgba(c)))
  const order = [...count.keys()].sort((a, b) => Number(pal.has(b)) - Number(pal.has(a)) || count.get(b) - count.get(a) || a - b)
  const kept = []
  const to = new Map()
  for (const v of order) {
    const near = pal.has(v) ? undefined : kept.find((k) => dist(k, v) < limit)
    if (near === undefined) kept.push(v)
    else to.set(v, near)
  }
  for (const s of strips) {
    for (let i = 0; i < s.d.length; i++) {
      const t = to.get(s.d[i])
      if (t !== undefined) s.d[i] = t
    }
  }
  return to.size
}

/** Stretch a strip upward by `n` rows that repeat its top row: cables and columns carry on up in a tall area. */
function extendUp(frame, n) {
  if (!n) return frame
  const out = new Canvas(frame.w, frame.h + n)
  out.blit(frame, 0, n)
  for (let y = 0; y < n; y++) for (let x = 0; x < frame.w; x++) out.d[y * frame.w + x] = frame.d[x]
  return out
}

/* ------------------------------------------------------------------ */
/* Themes                                                              */
/* ------------------------------------------------------------------ */

const W = PAL.grey[6]
/** Screen y of the horizon, and of the ground lines of the mid and near strips. */
const HORIZON = 264
const MID_Y = 279
const NEAR_Y = 291

const THEMES = {
  /** MW01: a bright morning on the lot. Big blue sky, cumulus, mesas, turbines, the wash itself. */
  lot() {
    const sky = [[0, '#3eb8fd'], [40, PAL.blue[3]], [104, '#7bd4ff'], [168, '#9ae0ff'], [220, PAL.blue[4]], [248, PAL.ice[2]]]
    const CK = { light: W, body: PAL.ice[2], shade: PAL.blue[4] }
    const MK = { cliff: '#e6c8a0', talus: '#efdcb4', lit: '#f8ecd0', shade: '#c2b2b8' }
    const TK = { body: W, shade: '#c1cedb' }
    const GK = { trunk: PAL.mud[4], body: '#a9c98a', light: '#c3dba0', shade: '#8bb07a' }
    const BK = { body: '#7fae58', light: '#a5cc6c', shade: '#4f7f44' }

    const cl = new Strip(960)
    clouds(cl, [[40, 96, 150, 44], [300, 62, 104, 30], [470, 126, 176, 50], [760, 84, 128, 38]], CK, 3)
    clouds(cl, [[220, 158, 84, 22], [660, 176, 70, 18], [880, 150, 64, 18]], CK, 5)
    clouds(cl, [[110, 204, 50, 9], [400, 210, 62, 10], [560, 200, 40, 8], [810, 208, 54, 9]], { body: W, shade: PAL.ice[2] }, 7)

    const far = new Strip(1280)
    mesa(far, 30, HORIZON, 250, 34, MK, 11)
    mesa(far, 372, HORIZON, 70, 24, MK, 12, { tier: 0 })
    mesa(far, 560, HORIZON, 330, 46, MK, 13, { tier: 0 })
    mesa(far, 985, HORIZON, 120, 28, MK, 14, { tier: 0 })
    mesa(far, 1150, HORIZON, 96, 18, MK, 15, { tier: 0 })
    ;[[620, 0.3], [648, 1.2], [676, 2.0], [706, 0.8], [736, 1.7], [766, 0.1], [798, 1.0]].forEach(([x, a]) => turbine(far, x, HORIZON - 46, 15, a, TK))
    ;[[906, 0.5], [930, 1.6], [956, 0.9]].forEach(([x, a], i) => turbine(far, x, HORIZON, 20 - i * 3, a, TK))
    far.rect(0, HORIZON, 1280, VIEW_H, '#f0e2b6')
    poleLine(far, 296, 560, HORIZON + 3, 9, 37, { pole: MK.shade, wire: '#e3d19f' })
    streaks(far, [[0, 268, 180], [240, 271, 300], [640, 267, 220], [900, 272, 260], [1180, 269, 100]], '#e3d19f')

    const mid = new Strip(1280)
    ;[[70, 96, 0.4], [176, 76, 1.5], [1010, 104, 0.9], [1120, 82, 0.2], [1214, 66, 1.3]].forEach(([x, h, a]) => turbine(mid, x, MID_Y, h, a, TK))
    waterTower(mid, 880, MID_Y + 1, 84, { body: W, shade: TK.shade, band: PAL.red[5] })
    // the sign's letters a step into the haze, so Maxx's own red and blue stay the strongest on screen
    mightyWash(mid, 440, MID_Y + 1, { wall: W, wallShade: PAL.grey[5], trim: PAL.ice[0], stripe: PAL.red[5], glass: PAL.ice[1], dark: PAL.grey[3], sign: W, red: mix(PAL.red[4], PAL.blue[4], 0.3), blue: mix(PAL.blue[2], PAL.blue[4], 0.3), post: PAL.grey[4] })
    pumpjack(mid, 300, MID_Y + 1, 1.1, 0.22, { body: PAL.mud[4], shade: PAL.mud[3] })
    mesquite(mid, 388, MID_Y + 1, 13, GK, 2)
    mesquite(mid, 716, MID_Y + 1, 16, GK, 3)
    mesquite(mid, 950, MID_Y + 1, 11, GK, 4)
    const mg = wave(1280, 21, [[2, 1.5], [5, 1]])
    mid.ground((x) => MID_Y + mg(x), '#edd5a1')
    streaks(mid, [[60, 286, 120], [420, 284, 260], [760, 288, 180], [1040, 285, 140]], '#e0c285')

    const near = new Strip(960)
    ;[[40, 30, 16], [70, 22, 12], [250, 36, 18], [284, 20, 11], [470, 26, 14], [640, 34, 17], [668, 24, 13], [840, 28, 15]].forEach(([x, w, h]) => shrub(near, x, NEAR_Y + 2, w, h, BK))
    const YK = { body: BK.shade, light: BK.body, stalk: PAL.mud[4], bloom: PAL.wood[8] }
    yucca(near, 150, NEAR_Y + 1, 13, YK, 22)
    yucca(near, 560, NEAR_Y + 1, 11, YK)
    yucca(near, 760, NEAR_Y + 1, 14, YK, 26)
    pear(near, 380, NEAR_Y + 1, 9, BK)
    pear(near, 920, NEAR_Y + 1, 8, BK)
    const ng = wave(960, 31, [[3, 1.2], [7, 0.8]])
    near.ground((x) => NEAR_Y + ng(x), '#c89d5b')
    under(near, PAL.mud[3], PAL.mud[2])

    return { sky, weather: 'none', cloudSpeed: 6, strips: { clouds: cl, far, mid, near } }
  },

  /** MW02: the vacuum bays in golden late-afternoon light, the sun low on the left. */
  vacuum() {
    const sky = [[0, PAL.ice[0]], [44, '#8cc5e4'], [100, PAL.ice[1]], [150, '#c8e3e4'], [192, '#e6ead0'], [226, '#f8eabc'], [248, PAL.wood[7]]]
    const CK = { light: W, body: PAL.wood[8], shade: '#f5cf9a' }
    const MK = { cliff: '#d9ab92', talus: '#e6be9a', lit: '#f6d9a6', shade: '#b98f96' }
    const TK = { body: PAL.wood[8], shade: '#e0b98a' }
    const BK = { body: '#8a9a44', light: '#b3b858', shade: '#5f7438' }
    const shadow = '#c2945a'

    const cl = new Strip(960)
    clouds(cl, [[90, 86, 180, 34], [520, 112, 150, 30], [790, 66, 120, 24]], CK, 21)
    clouds(cl, [[330, 152, 96, 16], [700, 172, 76, 12]], CK, 23)
    for (const [x, y, w] of [[150, 208, 96], [470, 216, 130], [840, 206, 74]]) streak(cl, x, y, w, 6, PAL.wood[8], CK.shade)

    const far = new Strip(1280)
    mesa(far, 100, HORIZON, 300, 40, MK, 31)
    mesa(far, 470, HORIZON, 110, 30, MK, 32, { tier: 0 })
    mesa(far, 650, HORIZON, 76, 20, MK, 33, { tier: 0 })
    mesa(far, 800, HORIZON, 270, 36, MK, 34)
    mesa(far, 1130, HORIZON, 120, 26, MK, 35, { tier: 0 })
    ;[[20, 0.2], [44, 1.3], [70, 0.7]].forEach(([x, a], i) => turbine(far, x, HORIZON, 16 + i * 3, a, { body: MK.lit, shade: MK.lit }))
    ;[[590, 1.0], [612, 0.1], [636, 1.8]].forEach(([x, a]) => turbine(far, x, HORIZON, 17, a, { body: MK.lit, shade: MK.lit }))
    far.rect(0, HORIZON, 1280, VIEW_H, '#e8c78c')
    streaks(far, [[40, 269, 240], [360, 267, 160], [600, 271, 280], [960, 268, 200]], '#d9b57a')

    const mid = new Strip(1280)
    ;[[330, 92, 0.6], [416, 72, 1.7], [1096, 100, 0.2], [1184, 78, 1.1]].forEach(([x, h, a]) => turbine(mid, x, MID_Y, h, a, TK))
    waterTower(mid, 150, MID_Y + 1, 80, { body: PAL.wood[8], shade: '#d9a878', band: PAL.red[5] })
    vacuumBays(mid, 500, MID_Y + 1, 7, { roof: '#6f93bd', stripe: PAL.red[5], post: '#b89a7a', unit: '#d9a878', hose: '#9a7c74' })
    mightyWash(mid, 716, MID_Y + 1, { wall: PAL.wood[8], wallShade: '#f0cf96', trim: '#6f93bd', stripe: PAL.red[5], glass: PAL.ice[1], dark: '#9a7c74', sign: PAL.wood[8], red: mix(PAL.red[4], PAL.wood[7], 0.3), blue: mix(PAL.blue[2], PAL.wood[7], 0.3), post: '#b89a7a' })
    pumpjack(mid, 1010, MID_Y + 1, 1.0, -0.2, { body: '#b89a7a', shade: '#9a7c74' }, true)
    const mg = wave(1280, 41, [[2, 1.5], [3, 1]])
    mid.ground((x) => MID_Y + mg(x), '#ddb06a')
    // long shadows, thrown to the right
    for (const [x, len] of [[152, 70], [332, 80], [418, 60], [690, 40], [950, 110], [1012, 36], [1098, 90], [1186, 66]]) {
      mid.rect(x, MID_Y + 4, len, 2, shadow)
      mid.rect(x + 8, MID_Y + 6, len, 1, shadow)
    }

    const near = new Strip(960)
    ;[[60, 34, 17], [96, 22, 12], [300, 28, 15], [520, 36, 18], [552, 22, 12], [760, 30, 16], [900, 24, 13]].forEach(([x, w, h]) => shrub(near, x, NEAR_Y + 2, w, h, BK))
    const YK = { body: BK.shade, light: BK.body, stalk: '#9a7c74', bloom: PAL.wood[8] }
    yucca(near, 200, NEAR_Y + 1, 13, YK, 24)
    yucca(near, 660, NEAR_Y + 1, 12, YK)
    for (const x of [380, 408, 436, 464]) {
      near.rect(x, NEAR_Y - 11, 4, 13, '#9a7c74')
      near.rect(x, NEAR_Y - 9, 4, 2, PAL.wood[8])
    }
    const ng = wave(960, 51, [[3, 1.2], [7, 0.8]])
    near.ground((x) => NEAR_Y + ng(x), '#c2904c')
    under(near, PAL.mud[3], PAL.mud[2])

    return { sky, weather: 'none', cloudSpeed: 4, strips: { clouds: cl, far, mid, near } }
  },

  /** MW04: a storm front over the plains. Dark teal sky, a bright gap at the horizon, rain. */
  storm() {
    const sky = [[0, '#1f3038'], [56, '#2a424b'], [120, '#36545c'], [176, '#46686d'], [222, '#5c807f'], [246, '#82a39b']]
    const MK = { cliff: '#4b6b6e', talus: '#527477', lit: '#5f8584', shade: '#40595f' }
    const SK = { body: '#2f474c', shade: '#263b40' }
    const dark = '#1f2a26'

    const cl = new Strip(960)
    // rain hanging from the deck and drifting with it down to the land; the ragged feet stay
    // below the horizon (264) even when a tall area lets the land sink further than the clouds
    rainShafts(cl, sky, 96, [[180, 96, 336], [330, 34, 330], [560, 140, 340], [840, 64, 334]], '#22363f')
    stormDeck(cl, 124, { dark: '#18262e', belly: '#22363f', edge: '#2e4a53' }, 4)

    const far = new Strip(1280)
    mesa(far, 60, HORIZON, 280, 38, MK, 41)
    mesa(far, 420, HORIZON, 90, 26, MK, 42, { tier: 0 })
    mesa(far, 720, HORIZON, 330, 44, MK, 43)
    mesa(far, 1140, HORIZON, 100, 22, MK, 44, { tier: 0 })
    far.rect(0, HORIZON, 1280, VIEW_H, '#4c6658')
    streaks(far, [[20, 268, 200], [300, 271, 260], [700, 267, 180], [960, 270, 240]], '#435c50')

    const mid = new Strip(1280)
    ;[[120, 90, 0.5], [226, 70, 1.4], [860, 98, 0.1], [958, 76, 1.9], [1046, 60, 0.8]].forEach(([x, h, a]) => turbine(mid, x, MID_Y, h, a, SK))
    powerLine(mid, MID_Y + 1, 46, 160, { pole: SK.shade, wire: SK.shade }, 40)
    windmill(mid, 560, MID_Y + 1, 54, SK)
    pumpjack(mid, 400, MID_Y + 1, 1.1, 0.24, SK)
    pumpjack(mid, 720, MID_Y + 1, 0.9, -0.2, SK, true)
    const mg = wave(1280, 61, [[2, 1.5], [5, 1]])
    mid.ground((x) => MID_Y + mg(x), '#34463d')
    streaks(mid, [[80, 285, 160], [460, 287, 220], [820, 284, 140], [1080, 286, 120]], '#2c3c35')

    const near = new Strip(960)
    fence(near, 0, 960, NEAR_Y + 2, 24, 48, { post: dark, wire: '#2a3832' })
    ;[[130, 20, 5], [420, 26, 6], [700, 18, 7], [880, 22, 8]].forEach(([x, h, s]) => bareTree(near, x, NEAR_Y + 2, h, dark, s))
    ;[[250, 9, 1], [560, 8, 2], [800, 10, 3]].forEach(([x, s, k]) => tuft(near, x, NEAR_Y + 2, s, dark, k))
    const ng = wave(960, 71, [[3, 1.5], [8, 1]])
    near.ground((x) => NEAR_Y + ng(x), '#3f3324')
    // puddles catch the light of the gap
    for (const [x, w] of [[60, 44], [330, 30], [610, 56], [840, 26]]) {
      near.rect(x, NEAR_Y + 3, w, 2, '#82a39b')
      near.rect(x + 3, NEAR_Y + 2, w - 6, 1, '#82a39b')
    }
    under(near, PAL.mud[0])

    return { sky, weather: 'rain', cloudSpeed: 14, strips: { clouds: cl, far, mid, near } }
  },

  /** MW06: the highway at sunset. Purple down to orange, the sun on the horizon, pumpjacks. */
  highway() {
    const sky = [[0, PAL.purple[1]], [40, '#3f2878'], [88, PAL.purple[2]], [140, '#7f489f'], [184, '#a8528f'], [216, '#cf6078'], [238, '#ee8452'], [252, PAL.orange[2]]]
    const MK = { cliff: '#6b3f93', talus: '#77489a', lit: '#8f58ac', shade: '#57347f' }
    const SK = { body: '#3d2670', shade: '#33205f' }
    const dark = '#221642'

    const cl = new Strip(960)
    for (const [x, y, w, h, top, belly] of [
      [60, 66, 190, 8, '#3f2878', '#7f489f'], [400, 48, 130, 6, PAL.purple[1], '#7f489f'], [620, 104, 230, 10, '#3f2878', '#cf6078'],
      [860, 132, 110, 6, PAL.purple[2], '#cf6078'], [200, 152, 150, 7, PAL.purple[2], '#cf6078'], [480, 178, 120, 6, '#7f489f', '#ee8452'],
      [760, 198, 160, 6, '#7f489f', '#ee8452'], [90, 210, 96, 5, '#a8528f', PAL.orange[2]],
    ]) streak(cl, x, y, w, h, top, belly)

    const far = new Strip(1280)
    far.circle(928, HORIZON + 4, 30, PAL.yellow[2])
    far.rect(880, HORIZON - 8, 100, 3, PAL.orange[2])
    far.rect(890, HORIZON - 16, 80, 2, PAL.orange[2])
    mesa(far, 0, HORIZON, 220, 44, MK, 51)
    mesa(far, 300, HORIZON, 80, 34, MK, 52, { tier: 0, steep: 4 })
    mesa(far, 430, HORIZON, 60, 24, MK, 53, { tier: 0, steep: 4 })
    mesa(far, 550, HORIZON, 280, 52, MK, 54)
    mesa(far, 1020, HORIZON, 150, 30, MK, 55, { tier: 0 })
    mesa(far, 1196, HORIZON, 70, 20, MK, 56, { tier: 0 })
    far.rect(0, HORIZON, 1280, VIEW_H, '#4f2f78')
    streaks(far, [[60, 268, 220], [380, 270, 200], [700, 267, 260], [1040, 271, 180]], '#5d3888')

    const mid = new Strip(1280)
    pumpjack(mid, 140, MID_Y + 1, 1.3, 0.25, SK)
    pumpjack(mid, 520, MID_Y + 1, 1.0, -0.2, SK, true)
    pumpjack(mid, 1000, MID_Y + 1, 1.2, 0.02, SK)
    windmill(mid, 680, MID_Y + 1, 58, SK)
    turbine(mid, 1140, MID_Y, 78, 0.5, SK)
    turbine(mid, 1226, MID_Y, 60, 1.4, SK)
    billboard(mid, 286, MID_Y + 1, 66, 26, 22, { post: SK.body, frame: SK.shade, face: MK.shade }, [['MIGHTY WASH', '#ee8452'], ['NEXT EXIT', '#cf6078']])
    billboard(mid, 800, MID_Y + 1, 58, 22, 30, { post: SK.body, frame: SK.shade, face: MK.shade }, [['HAPPY CARS', '#cf6078'], ['AHEAD', '#ee8452']])
    const mg = wave(1280, 81, [[2, 1.5], [5, 1]])
    mid.ground((x) => MID_Y + mg(x), '#38226a')
    streaks(mid, [[80, 285, 160], [460, 287, 220], [820, 284, 140], [1080, 286, 120]], '#2f1c5c')

    const near = new Strip(960)
    fence(near, 0, 960, NEAR_Y + 2, 22, 60, { post: dark, wire: '#2c1d52' })
    const YK = { body: dark, light: dark, stalk: dark, bloom: dark }
    yucca(near, 210, NEAR_Y + 2, 14, YK, 24)
    yucca(near, 650, NEAR_Y + 2, 12, YK, 20)
    yucca(near, 860, NEAR_Y + 2, 13, YK)
    ;[[90, 10, 1], [330, 9, 2], [470, 11, 3], [760, 9, 4]].forEach(([x, s, k]) => tuft(near, x, NEAR_Y + 2, s, dark, k))
    const ng = wave(960, 91, [[3, 1.2], [7, 0.8]])
    near.ground((x) => NEAR_Y + ng(x), '#281a4c')
    under(near, PAL.purple[0])

    return { sky, weather: 'none', cloudSpeed: 4, strips: { clouds: cl, far, mid, near } }
  },

  /** MW07: a pale winter day. Snow on the mesas and the plain, the wash snowed in, bare mesquite, snowfall. */
  winter() {
    const sky = [[0, '#8fb0cd'], [60, '#a3c0d8'], [130, '#b9d0e2'], [196, '#cfdfea'], [240, '#e1ebf1']]
    const MK = { cliff: '#a7b6cc', talus: '#c6d3e2', lit: '#c6d3e2', rim: W, shade: '#8e9fb9' }
    const TK = { body: W, shade: '#a7b6cc' }
    const wood = '#8d8a99'
    const dark = '#6c6878'

    const cl = new Strip(960)
    clouds(cl, [[20, 62, 240, 26], [330, 44, 200, 22], [600, 80, 260, 28], [860, 40, 140, 18]], { body: '#b9d0e2', shade: '#a3c0d8', light: '#cfdfea' }, 31)
    clouds(cl, [[180, 126, 180, 18], [520, 142, 150, 16], [780, 120, 130, 14]], { body: '#cfdfea', shade: '#b9d0e2' }, 33)
    clouds(cl, [[60, 186, 120, 10], [420, 196, 150, 10], [700, 182, 100, 9]], { body: '#e1ebf1', shade: '#cfdfea' }, 35)

    const far = new Strip(1280)
    mesa(far, 40, HORIZON, 240, 36, MK, 61, { rim: 3 })
    mesa(far, 330, HORIZON, 100, 24, MK, 62, { tier: 0, rim: 3 })
    mesa(far, 520, HORIZON, 300, 42, MK, 63, { rim: 3 })
    mesa(far, 900, HORIZON, 90, 28, MK, 64, { tier: 0, rim: 3 })
    mesa(far, 1040, HORIZON, 200, 32, MK, 65, { tier: 0, rim: 3 })
    ;[[836, 0.4], [858, 1.5], [880, 0.9]].forEach(([x, a], i) => turbine(far, x, HORIZON, 15 + i * 2, a, { body: '#c6d3e2', shade: '#c6d3e2' }))
    far.rect(0, HORIZON, 1280, VIEW_H, '#e6edf3')
    streaks(far, [[30, 268, 220], [320, 271, 240], [680, 267, 200], [980, 270, 260]], '#cfdbe8')

    const mid = new Strip(1280)
    ;[[420, 96, 0.3], [520, 74, 1.6], [1160, 88, 1.0], [1244, 64, 0.5]].forEach(([x, h, a]) => turbine(mid, x, MID_Y, h, a, TK))
    waterTower(mid, 200, MID_Y + 1, 80, { body: '#dfe7ef', shade: '#a7b6cc', band: '#c9929e', cap: W })
    windmill(mid, 730, MID_Y + 1, 54, { body: wood, shade: '#a7b6cc' })
    // the wash, snowed in, its sign hazed by the falling snow
    const haze = '#cfdfea'
    mightyWash(mid, 868, MID_Y + 1, { wall: '#dfe7ef', wallShade: '#c6d3e2', trim: '#a7b6cc', stripe: '#c9929e', glass: PAL.ice[1], dark: '#8e9fb9', sign: W, red: mix(PAL.red[4], haze, 0.3), blue: mix(PAL.blue[2], haze, 0.3), post: '#a7b6cc', snow: W })
    ;[[90, 46, 1], [300, 34, 2], [640, 52, 3], [826, 30, 4], [1120, 44, 5]].forEach(([x, h, s]) => bareTree(mid, x, MID_Y + 2, h, wood, s))
    const mg = wave(1280, 101, [[2, 2], [5, 1.2]])
    mid.ground((x) => MID_Y + mg(x), W)
    streaks(mid, [[60, 285, 140], [380, 287, 200], [760, 284, 160], [1060, 286, 130]], PAL.grey[5])

    const near = new Strip(960)
    fence(near, 500, 788, NEAR_Y + 2, 22, 48, { post: dark, wire: wood })
    for (let x = 500; x <= 788; x += 48) near.rect(x - 1, NEAR_Y - 21, 4, 2, W)
    ;[[70, 24, 11], [240, 18, 12], [400, 26, 13], [860, 22, 14]].forEach(([x, h, s]) => bareTree(near, x, NEAR_Y + 3, h, dark, s))
    const ng = wave(960, 111, [[2, 3], [5, 2], [9, 1]])
    near.ground((x) => NEAR_Y - 1 + ng(x), W)
    near.ground((x) => NEAR_Y + 3 + ng(x + 40) * 0.6, PAL.ice[1])
    under(near, '#9fb3cb', '#8a9fba')

    return { sky, weather: 'snow', cloudSpeed: 5, strips: { clouds: cl, far, mid, near } }
  },

  /** Rival Row: the alley behind the wash at night. Stars, a moon, back walls, chain-link, a dumpster. */
  backlot() {
    // The buildings stand darker than the purple of the tiles and the grackle, the low sky lighter.
    const sky = [[0, '#120d2b'], [64, PAL.purple[0]], [140, '#221848'], [204, '#33276b'], [244, '#433381']]
    const wall = '#1f1844'
    const wallDark = '#19133a'
    const wallLight = '#2c2359'
    const warm = '#a8905a'

    const cl = new Strip(960)
    stars(cl, 120, 236, PAL.purple[2], PAL.purple[3], 9)
    streak(cl, 560, 86, 200, 7, '#221848', PAL.purple[1])
    streak(cl, 120, 132, 150, 6, '#221848', PAL.purple[1])
    cl.circle(700, 62, 15, PAL.wood[8])
    cl.circle(707, 57, 13, 0)
    streak(cl, 650, 78, 120, 5, '#221848', PAL.purple[1])

    const far = new Strip(1280)
    const TOWN = 268
    skyline(far, 0, 1270, TOWN, { body: '#2a1e58', lit: warm }, 77, 8, 30)
    waterTower(far, 420, TOWN, 58, { body: '#2a1e58', shade: '#2a1e58', band: '#33266a' })
    far.rect(960, TOWN - 86, 1, 86, '#2a1e58')
    far.line(960, TOWN - 70, 944, TOWN - 20, '#2a1e58')
    far.line(960, TOWN - 70, 976, TOWN - 20, '#2a1e58')
    far.set(960, TOWN - 87, PAL.red[3])
    far.set(960, TOWN - 50, PAL.red[2])
    far.rect(0, TOWN, 1280, VIEW_H, '#221848')

    const mid = new Strip(1280)
    const B = MID_Y + 6
    // the back of the wash: the dryers' exhaust and a meter box under a lamp, posters, the roof
    // sign. (Its rear door was here: a door Maxx's size in the backdrop of Rival Row, the level
    // of doors, would pass for one he can use.)
    mid.rect(40, 172, 320, B - 172, wall)
    mid.rect(38, 170, 324, 3, wallLight)
    mid.rect(40, B - 20, 320, 20, wallDark)
    mid.poly([[86, 222], [124, 222], [136, B], [74, B]], wallLight)
    mid.rect(86, 228, 38, 26, wallDark)
    for (let y = 231; y < 252; y += 4) mid.rect(89, y, 32, 2, '#140f30')
    mid.rect(96, 262, 18, 14, wallDark)
    mid.rect(103, 276, 4, B - 276, wallDark)
    // the lamp over the door: a dim housing, no bright bulb (a small bright blob at this
    // height passes for a coin)
    mid.rect(99, 215, 12, 3, '#140f30')
    mid.rect(102, 218, 6, 1, '#7a6848')
    mid.rect(330, 176, 3, B - 176, wallDark)
    mid.rect(60, 160, 26, 12, wallDark)
    mid.rect(64, 163, 18, 2, wall)
    mid.rect(300, 156, 6, 16, wallDark)
    // four rival posters: a bucket, a squeegee, an oil can, a cloud
    const paper = '#4a3f86'
    const ink = wall
    for (let i = 0; i < 4; i++) mid.rect(160 + i * 26, 210 + (i % 2) * 3, 20, 26, paper)
    mid.poly([[165, 220], [175, 220], [173, 230], [167, 230]], ink)
    mid.rect(164, 218, 12, 2, ink)
    mid.rect(190, 220, 12, 3, ink)
    mid.rect(195, 223, 2, 10, ink)
    mid.rect(216, 224, 10, 9, ink)
    mid.rect(218, 220, 3, 4, ink)
    mid.rect(221, 218, 6, 2, ink)
    mid.ellipse(248, 224, 6, 4, ink)
    mid.ellipse(243, 227, 3, 3, ink)
    mid.rect(246, 231, 1, 3, ink)
    mid.rect(250, 232, 1, 3, ink)
    // the neon on the roof
    const nx = 150
    mid.rect(nx - 6, 126, 74, 34, '#140f30')
    mid.rect(nx + 4, 160, 3, 12, '#140f30')
    mid.rect(nx + 54, 160, 3, 12, '#140f30')
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) mid.text(nx + 8 + dx, 131 + dy, 'WASH', '#4a1f52', 3)
    mid.text(nx + 8, 131, 'WASH', '#c2334f', 3)
    mid.rect(nx, 151, 62, 4, '#263a7a')
    mid.rect(nx + 1, 152, 60, 2, '#3f8fd8')
    // a brick building with a ladder
    mid.rect(430, 196, 270, B - 196, '#221a4b')
    mid.rect(428, 194, 274, 3, wallLight)
    mid.rect(430, B - 16, 270, 16, wallDark)
    const br = rng(5)
    for (let i = 0; i < 26; i++) mid.rect(440 + Math.floor(br() * 240), 204 + Math.floor(br() * 9) * 8, 10, 3, wallLight)
    mid.rect(470, 214, 34, 26, wallDark)
    mid.rect(486, 214, 2, 26, '#221a4b')
    mid.rect(470, 226, 34, 2, '#221a4b')
    mid.rect(640, 180, 2, B - 196, wallDark)
    mid.rect(654, 180, 2, B - 196, wallDark)
    for (let y = 186; y < B - 20; y += 8) mid.rect(640, y, 16, 1, wallDark)
    mid.rect(560, 180, 30, 16, wallDark)
    mid.rect(566, 174, 18, 6, wallDark)
    // a warehouse with a roll-up door and an old painted ad
    mid.rect(780, 150, 400, B - 150, '#1d1640')
    mid.rect(778, 148, 404, 3, wallLight)
    mid.rect(780, B - 22, 400, 22, wallDark)
    mid.rect(830, 206, 76, B - 206, wallDark)
    for (let y = 212; y < B; y += 7) mid.rect(832, y, 72, 1, '#1d1640')
    // one window still lit: dim and cut in four by its frame, so it reads as a window, not a prize
    for (let i = 0; i < 6; i++) mid.rect(950 + i * 34, 170, 16, 10, i === 3 ? '#7a6848' : wallDark)
    mid.rect(950 + 3 * 34 + 7, 170, 2, 10, wallDark)
    mid.rect(950 + 3 * 34, 174, 16, 1, wallDark)
    mid.text(960, 206, 'STREAK CITY', wallLight, 2)
    mid.text(990, 222, 'EXPRESS', wallLight, 2)
    mid.rect(1120, 132, 40, 18, wallDark)
    mid.rect(1150, 120, 4, 12, wallDark)
    mid.rect(0, B, 1280, VIEW_H, '#140f30')

    const near = new Strip(960)
    const link = '#30275f'
    const TOP = 214
    for (let y = TOP + 2; y < NEAR_Y + 4; y++) {
      for (let x = 48; x < 720; x++) if (mod(x + y, 12) === 0 || mod(x - y, 12) === 0) near.set(x, y, link)
    }
    near.rect(48, TOP, 673, 2, '#3a3070')
    for (let x = 48; x <= 720; x += 96) near.rect(x - 1, TOP - 4, 3, NEAR_Y + 4 - TOP + 4, '#3a3070')
    // a dumpster beyond the end of the fence: a box under a sloping lid, ribs, small wheels
    near.rect(778, NEAR_Y - 26, 70, 28, '#251d50')
    near.poly([[774, NEAR_Y - 27], [852, NEAR_Y - 27], [852, NEAR_Y - 33], [780, NEAR_Y - 36]], link)
    for (const x of [790, 812, 834]) near.rect(x, NEAR_Y - 24, 3, 22, '#19133a')
    near.rect(784, NEAR_Y + 2, 6, 3, '#140f30')
    near.rect(838, NEAR_Y + 2, 6, 3, '#140f30')
    ;[[100, 9, 1], [300, 8, 2], [520, 10, 3], [800, 9, 4], [900, 7, 5]].forEach(([x, s, k]) => tuft(near, x, NEAR_Y + 3, s, '#120d2b', k))
    const ng = wave(960, 121, [[3, 1], [7, 0.6]])
    near.ground((x) => NEAR_Y + 2 + ng(x), '#140f30')
    under(near, '#120d2b')

    return { sky, weather: 'none', cloudSpeed: 0.5, strips: { clouds: cl, far, mid, near } }
  },

  /**
   * MW03: inside the wash tunnel. A blue-grey hall under a roof truss: pilasters with striped
   * guards, high windows onto the morning, the wash steps on hanging plates; red and blue
   * arches, mitter curtains and hoses in the middle distance; drums and reels by the floor.
   */
  tunnel() {
    const ceil = '#232a37'
    const wall = '#36414f'
    const wallLight = '#414d5d'
    const wallDark = '#2e3744'
    const seam = '#323c4a'
    const sky = [[0, ceil]]

    // the morning outside, seen through the windows
    const view = new Strip(960)
    view.rect(0, 0, 960, VIEW_H, '#8fbcd4')
    view.rect(0, 128, 960, VIEW_H, '#a3c9da')
    clouds(view, [[70, 104, 64, 14], [330, 96, 84, 16], [600, 108, 54, 12], [810, 100, 70, 15]], { body: '#c0dbe6', shade: '#a3c9da' }, 9)
    for (const [x, w, h] of [[0, 300, 10], [380, 140, 6], [560, 260, 13], [860, 160, 8]]) mesa(view, x, 160, w, h, { cliff: '#a8a69d', talus: '#b3ae9f', lit: '#bbb5a3', shade: '#9c9c97' }, x + 3, { tier: 0 })
    view.rect(0, 160, 960, VIEW_H, '#b9b29c')

    const far = new Strip(960)
    far.rect(0, 0, 960, VIEW_H, wall)
    far.rect(0, 0, 960, 38, ceil)
    truss(far, 8, 34, 40, wallDark)
    // the lower wall: panels with seams
    far.rect(0, 206, 960, VIEW_H, wallDark)
    for (let x = 6; x < 960; x += 24) far.rect(x, 208, 1, VIEW_H, seam)
    const bays = ['win', 'win', 'logo', 'win', 'vent', 'win', 'win', 'plain']
    bays.forEach((kind, i) => {
      const bx = i * 120 + 16
      if (kind === 'win') {
        far.rect(bx + 22, 66, 66, 108, wallDark)
        windowOnto(far, view, bx + 24, 68, 62, 104)
        far.rect(bx + 54, 68, 2, 104, wall)
        far.rect(bx + 24, 104, 62, 2, wall)
        far.rect(bx + 20, 174, 70, 3, wallLight)
        // the spray gets everywhere: wet streaks run down from the sill
        for (let k = 0; k < 4; k++) far.rect(bx + 27 + k * 15 + ((i * 5 + k * 3) % 6), 177, 2, 8 + ((k * 13 + i * 7) % 24), '#323d4b')
      } else if (kind === 'vent') {
        far.rect(bx + 30, 92, 50, 44, wallDark)
        for (let y = 95; y < 134; y += 5) far.rect(bx + 32, y, 46, 2, seam)
      } else if (kind === 'logo') {
        far.text(bx + 7, 96, 'MIGHTY', '#6e4350', 2)
        far.text(bx + 23, 112, 'WASH', '#3d5878', 2)
      }
    })
    for (let i = 0; i < 8; i++) {
      const px = i * 120
      far.rect(px, 38, 16, VIEW_H, wallLight)
      far.rect(px + 13, 38, 3, VIEW_H, wallDark)
      far.rect(px - 2, 38, 20, 6, wallLight)
      far.rect(px - 2, 44, 20, 1, wallDark)
      hazard(far, px, 254, 16, 40, '#6f6a45', wallDark, 4)
    }
    const SK = { wire: wallDark, frame: wallDark, face: '#2a3240', ink: '#7d8ba0' }
    for (const [x, w, text] of [[44, 40, 'PRESOAK'], [180, 52, 'TRIPLE FOAM'], [404, 48, 'SOFT TOUCH'], [530, 28, 'RINSE'], [644, 22, 'WAX'], [756, 44, 'SPOT FREE'], [900, 24, 'DRY']]) {
      hangingSign(far, x, 44, Math.max(w, text.length * 4 + 7), 11, text, SK)
    }

    const mid = new Strip(1280)
    const red = { body: '#5e2e3c', light: '#6f3747', shade: '#4d2633', nozzle: '#232a37' }
    const blue = { body: '#2a4266', light: '#324e78', shade: '#223654', nozzle: '#232a37' }
    washArch(mid, 70, FLOOR_Y + 8, 150, 236, 12, red)
    washArch(mid, 520, FLOOR_Y + 8, 160, 224, 12, blue)
    washArch(mid, 860, FLOOR_Y + 8, 140, 240, 12, red)
    washArch(mid, 1110, FLOOR_Y + 8, 130, 212, 10, blue)
    const CK = { rail: '#262e3a', a: '#34435a', b: '#2d3a4f' }
    curtain(mid, 280, 90, 24, 108, CK, 3)
    curtain(mid, 730, 80, 30, 96, CK, 4)
    curtain(mid, 1040, 46, 20, 84, CK, 5)
    hoseLoop(mid, 400, 470, 18, 70, '#262e3a')
    hoseLoop(mid, 1000, 1030, 12, 50, '#262e3a')
    // pump skid and a tank on the floor
    mid.rect(420, 256, 44, 44, '#2a333f')
    mid.rect(420, 256, 44, 2, '#323c4a')
    mid.rect(426, 264, 14, 10, '#232a37')
    mid.rect(250, 238, 22, 62, '#2a333f')
    mid.ellipse(260, 240, 10, 5, '#2a333f')
    mid.rect(253, 240, 3, 58, '#323c4a')

    const near = new Strip(960)
    const dark = '#1c222b'
    const DK = { body: dark, light: '#252c37', band: '#161a21' }
    drum(near, 96, FLOOR_Y + 2, DK)
    drum(near, 114, FLOOR_Y + 2, DK)
    drum(near, 105, FLOOR_Y - 21, DK, 16, 20)
    // a hose reel on its stand, the hose run out across the floor to a gun
    near.poly([[412, 298], [420, 262], [432, 262], [440, 298]], dark)
    near.circle(426, 260, 13, dark)
    near.circle(426, 260, 8, '#252c37')
    near.circle(426, 260, 3, dark)
    near.line(437, 268, 470, 294, '#252c37', 2)
    near.rect(470, 292, 30, 2, '#252c37')
    near.rect(500, 288, 6, 6, dark)
    // a control pedestal and two striped bollards
    near.rect(690, 252, 18, 46, dark)
    near.rect(686, 248, 26, 8, dark)
    for (const x of [580, 868]) {
      near.rect(x, 270, 8, 28, dark)
      hazard(near, x, 272, 8, 8, '#4a4630', dark, 3)
    }
    under(near, '#1b2029')

    return { sky, weather: 'none', cloudSpeed: 0, tall: { mid: 160 }, strips: { far, mid, near } }
  },

  /**
   * MW05: the lube shop pit, underground. Warm concrete block under a duct and two pipes, shop
   * lamps throwing pools of light on shelves of oil, a pegboard of tools, a high window onto the
   * street, a bank of hose reels over a waste-oil tank; a lift, an engine hoist and hanging lamps
   * in the middle distance; drums by the floor.
   */
  lube() {
    const ceil = '#1f1915'
    const wall = '#3a3029'
    const joint = '#342b25'
    const wallDark = '#2e2620'
    const sky = [[0, ceil]]
    const tints = [[wall, '#4a3d33'], [joint, '#43372f'], [wallDark, '#3a3029']]

    const far = new Strip(960)
    far.rect(0, 0, 960, VIEW_H, wall)
    far.rect(0, 238, 960, VIEW_H, wallDark)
    // concrete block, every other course offset by half a block
    for (let k = 0, y = 36; y < VIEW_H; k++, y += 16) {
      far.rect(0, y, 960, 1, joint)
      for (let x = k % 2 ? 16 : 0; x < 960; x += 32) far.rect(x, y + 1, 1, 15, joint)
    }
    far.rect(0, 0, 960, 36, ceil)
    // the duct along the ceiling and its hangers
    far.rect(0, 10, 960, 18, '#2b241f')
    far.rect(0, 10, 960, 2, '#342b25')
    for (let x = 30; x < 960; x += 64) far.rect(x, 10, 2, 18, '#241e1a')
    const PK = { body: '#4a3d34', light: '#57493f', flange: '#2e2620' }
    pipeRun(far, 0, 960, 42, 6, 96, PK)
    pipeRun(far, 0, 960, 54, 4, 120, PK)
    // shelves of oil, each under a lamp; the cans pulled toward the wall, so a whole shelf
    // reads as one calm block and not as a field of small bright things
    const cans = ['#6a3a32', '#3c4a63', '#76663a', '#40573c', '#744a2c'].map((col) => mix(col, wall, 0.5))
    shelving(far, 36, FLOOR_Y, 112, 150, { post: '#2a231e', shelf: '#4d4036', cans }, 7)
    shelving(far, 560, FLOOR_Y, 140, 136, { post: '#2a231e', shelf: '#4d4036', cans }, 8)
    // a pegboard of tools
    far.rect(206, 116, 104, 80, '#43372d')
    far.rect(206, 116, 104, 2, '#4d4036')
    const tool = '#2e2620'
    for (let i = 0; i < 5; i++) far.rect(216 + i * 8, 126 + i * 2, 3, 30 - i * 3, tool)
    far.line(266, 126, 266, 160, tool, 3)
    far.rect(260, 124, 13, 6, tool)
    far.circle(292, 140, 9, tool)
    far.circle(292, 140, 5, '#43372d')
    far.rect(216, 172, 34, 3, tool)
    far.rect(256, 168, 46, 16, tool)
    // the shop's name painted on the block
    far.text(336, 98, 'LUBE PIT', '#6c5236', 2)
    far.text(340, 116, 'OIL FILTER LUBE', '#5a4632', 1)
    // a high window onto the street: daylight, a kerb, bars
    far.rect(456, 62, 70, 32, wallDark)
    far.rect(459, 65, 64, 26, '#7f949c')
    far.rect(459, 83, 64, 8, '#6a6d68')
    for (let x = 466; x < 523; x += 10) far.rect(x, 65, 2, 26, wallDark)
    // a bank of hose reels on the wall, each named, the hoses hanging in loops to their guns,
    // and a waste-oil tank under them. (No door back here: a door in the backdrop would pass
    // for one Maxx could go through.)
    far.rect(756, 150, 112, 6, '#2a221d')
    far.rect(756, 150, 112, 1, '#43372d')
    ;['OIL', 'ATF', 'GEAR', 'AIR'].forEach((name, i) => {
      const rx = 770 + i * 28
      far.rect(rx - 9, 136, 19, 9, '#2a221d')
      far.text(rx - name.length * 2 + 1, 138, name, '#6c5236')
      far.rect(rx - 1, 156, 3, 4, '#2a221d')
      far.circle(rx, 168, 9, '#2e2620')
      far.circle(rx, 168, 7, '#4a3d33')
      far.circle(rx, 168, 2, '#2e2620')
      const drop = 30 + ((i * 13) % 22)
      far.rect(rx + 8, 168, 2, drop, '#26201b')
      far.line(rx + 9, 168 + drop, rx + 3, 168 + drop + 8, '#26201b', 2)
      far.rect(rx + 1, 168 + drop + 7, 4, 6, '#2a221d')
    })
    far.rect(762, 262, 92, 32, '#3a2f27')
    far.rect(762, 262, 92, 2, '#43372f')
    far.rect(770, 294, 6, 4, '#2a221d')
    far.rect(840, 294, 6, 4, '#2a221d')
    far.text(790, 274, 'WASTE OIL', '#4d4036')
    // a fuse box and a dropped pipe to a valve
    far.rect(884, 140, 30, 42, '#433a33')
    far.rect(886, 142, 26, 38, '#3d342d')
    far.poly([[900, 148], [895, 162], [901, 162], [897, 174], [906, 158], [900, 158], [904, 148]], '#76663a')
    pipeDown(far, 170, 220, 5, PK)
    far.rect(164, 220, 18, 12, '#2e2620')
    for (const x of [512, 724]) {
      far.rect(x, 260, 10, 38, wallDark)
      hazard(far, x, 262, 10, 30, '#6e5a2c', '#26201b', 4)
    }
    // lamps last, so their pools light whatever is under them
    const LK = { cord: '#26201b', shade: '#26201b', bulb: '#b69a62', tints }
    for (const [x, y, pool] of [[92, 66, 70], [392, 50, 40], [630, 70, 60], [900, 58, 40]]) shopLamp(far, x, y, LK, pool)

    const mid = new Strip(1280)
    const post = { body: '#5a3c26', light: '#68462c', shade: '#4a311f' }
    // a two-post lift, no car on it
    for (const x of [200, 336]) {
      mid.rect(x, 140, 16, 160, post.body)
      mid.rect(x, 140, 3, 160, post.light)
      mid.rect(x + 12, 140, 4, 160, post.shade)
      mid.rect(x - 2, 136, 20, 6, post.shade)
      mid.rect(x + 3, 230, 10, 14, '#3a2a1e')
      hazard(mid, x + 3, 266, 10, 30, '#6e5a2c', '#2a2019', 3)
    }
    mid.rect(216, 288, 50, 5, '#3a2a1e')
    mid.rect(286, 288, 50, 5, '#3a2a1e')
    // an engine hoist
    const hoist = '#2c241f'
    mid.rect(560, 290, 96, 6, hoist)
    mid.rect(566, 286, 8, 4, hoist)
    mid.rect(640, 286, 8, 4, hoist)
    mid.rect(586, 196, 8, 94, hoist)
    mid.line(590, 204, 676, 160, hoist, 5)
    mid.line(592, 262, 620, 222, hoist, 3)
    mid.rect(675, 160, 1, 44, hoist)
    mid.rect(672, 204, 7, 3, hoist)
    mid.rect(672, 207, 2, 5, hoist)
    // an oil drain on a stand
    mid.poly([[980, 214], [1016, 214], [1003, 230], [993, 230]], '#2c241f')
    mid.rect(996, 230, 4, 60, '#2c241f')
    mid.rect(982, 288, 32, 4, '#2c241f')
    // air hoses on reels, and lamps hanging lower than the wall's
    hoseLoop(mid, 760, 830, 22, 90, '#4f4026')
    hoseLoop(mid, 1160, 1190, 14, 64, '#4f4026')
    const ML = { cord: '#241d18', shade: '#241d18', bulb: '#b69a62' }
    for (const [x, y] of [[470, 92], [880, 80], [1100, 98]]) shopLamp(mid, x, y, ML)
    // a rolling cart
    mid.rect(1210, 252, 44, 38, '#2c241f')
    mid.rect(1212, 262, 40, 1, '#3a2f27')
    mid.rect(1212, 274, 40, 1, '#3a2f27')
    mid.rect(1212, 290, 4, 6, '#2c241f')
    mid.rect(1248, 290, 4, 6, '#2c241f')

    const near = new Strip(960)
    const dark = '#1a1512'
    const DK = { body: dark, light: '#241d19', band: '#13100d' }
    drum(near, 52, FLOOR_Y + 2, DK)
    drum(near, 70, FLOOR_Y + 2, DK)
    near.poly([[56, FLOOR_Y - 27], [68, FLOOR_Y - 27], [64, FLOOR_Y - 21], [60, FLOOR_Y - 21]], dark)
    // a floor jack, its handle leaning back, and a creeper on its wheels
    near.poly([[420, 298], [420, 284], [470, 290], [474, 298]], dark)
    near.line(424, 286, 396, 254, dark, 3)
    near.rect(464, 282, 8, 6, dark)
    near.rect(560, 288, 56, 4, dark)
    for (const x of [562, 610]) near.rect(x, 292, 4, 4, dark)
    drum(near, 760, FLOOR_Y + 2, DK)
    near.rect(820, 278, 26, 4, dark)
    near.rect(826, 282, 3, 16, dark)
    near.rect(838, 282, 3, 16, dark)
    under(near, '#16110e')

    return { sky, weather: 'none', cloudSpeed: 0, tall: { mid: 160 }, strips: { far, mid, near } }
  },

  /**
   * MW08: the mega tunnel at night. A vast navy and purple hall: ribbed columns with neon
   * tubes, tall arched windows onto the stars and the town, a neon MIGHTY WASH; chrome arches
   * edged in neon and light rigs in the middle distance; dark consoles by the floor.
   */
  mega() {
    // The walls sit well below the purple of the tiles and the grackle, and the windows, lit by
    // the town's glow, well above them: both always read against it.
    const ceil = '#0e0b20'
    const wall = '#18142f'
    const wallLight = '#201b3e'
    const wallDark = '#130f27'
    const sky = [[0, ceil]]
    const neon = { red: '#b0344f', redGlow: '#3e1838', blue: '#4074c0', blueGlow: '#1c2556' }

    // the night outside, glowing over the town
    const night = '#252c6a'
    const view = new Strip(1280)
    view.rect(0, 0, 1280, VIEW_H, night)
    view.rect(0, 140, 1280, VIEW_H, '#2c357a')
    view.rect(0, 186, 1280, VIEW_H, '#343f86')
    stars(view, 150, 180, '#4a55a0', '#9aa0dc', 17)
    view.circle(404, 100, 12, '#d6d0e2')
    view.circle(410, 96, 11, night)
    skyline(view, 0, 1270, 214, { body: '#151838', lit: '#7a6844' }, 13, 4, 18)
    view.rect(0, 214, 1280, VIEW_H, '#151838')
    for (const x of [140, 170, 860, 900, 1180]) {
      view.rect(x, 186, 1, 28, '#1f2350')
      view.set(x, 185, '#a83050')
    }

    const far = new Strip(1280)
    far.rect(0, 0, 1280, VIEW_H, wall)
    far.rect(0, 236, 1280, VIEW_H, wallDark)
    for (let x = 16; x < 1280; x += 32) far.rect(x, 240, 1, VIEW_H, '#17132f')
    far.rect(0, 0, 1280, 40, ceil)
    for (let b = 0; b < 8; b++) {
      const bx = b * 160
      // the roof rib over each bay
      const rib = new Canvas(161, 60)
      rib.ellipse(80, 58, 80, 44, wallDark, { fill: false })
      rib.ellipse(80, 58, 79, 43, wallDark, { fill: false })
      rib.rect(0, 40, 161, 20, 0)
      far.stamp(rib, bx, 0)
      if (b === 3) {
        // the neon sign in place of a window
        far.rect(bx + 26, 98, 108, 52, wallDark)
        far.rect(bx + 28, 100, 104, 48, ceil)
        for (const [text, x, y, col, glow] of [['MIGHTY', bx + 33, 106, neon.red, neon.redGlow], ['WASH', bx + 49, 128, neon.blue, neon.blueGlow]]) {
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) far.text(x + dx, y + dy, text, glow, 2)
          far.text(x, y, text, col, 2)
        }
        far.rect(bx + 50, 40, 1, 58, wallDark)
        far.rect(bx + 110, 40, 1, 58, wallDark)
        continue
      }
      // a tall arched window
      const wx = bx + 40
      const win = new Canvas(81, 170)
      win.ellipse(40, 40, 40, 40, wallDark)
      win.rect(0, 40, 81, 130, wallDark)
      far.stamp(win, wx, 52)
      const glass = new Canvas(77, 166)
      glass.ellipse(38, 38, 37, 37, '#ffffff')
      glass.rect(1, 38, 75, 126, '#ffffff')
      for (let j = 0; j < glass.h; j++) for (let i = 0; i < glass.w; i++) if (glass.solid(i, j)) far.set(wx + 2 + i, 54 + j, view.get(wx + 2 + i, 54 + j))
      far.rect(wx + 39, 54, 2, 166, wallDark)
      far.rect(wx + 2, 130, 77, 2, wallDark)
      far.rect(wx + 2, 176, 77, 2, wallDark)
      far.rect(wx - 3, 220, 87, 3, wallLight)
    }
    for (let b = 0; b < 8; b++) {
      const cx = b * 160
      far.rect(cx - 12, 40, 24, VIEW_H, wallLight)
      far.rect(cx + 7, 40, 5, VIEW_H, wallDark)
      far.rect(cx - 15, 40, 30, 6, wallLight)
      far.rect(cx - 15, 46, 30, 1, wallDark)
      const [col, glow] = b % 2 ? [neon.blue, neon.blueGlow] : [neon.red, neon.redGlow]
      far.rect(cx - 4, 64, 4, 176, glow)
      far.rect(cx - 3, 66, 2, 172, col)
    }

    const mid = new Strip(1280)
    const chrome = { body: '#3f416c', light: '#55588a', shade: '#33355a' }
    washArch(mid, 60, FLOOR_Y + 8, 220, 286, 14, { ...chrome, trim: '#7a2a4a' })
    washArch(mid, 560, FLOOR_Y + 8, 200, 270, 14, { ...chrome, trim: '#2e4f8e' })
    washArch(mid, 960, FLOOR_Y + 8, 210, 280, 14, { ...chrome, trim: '#7a2a4a' })
    // light rigs: a short bar on two cables with cans pointing down
    for (const [x, y] of [[350, 46], [800, 60], [1210, 40]]) {
      mid.rect(x + 6, 0, 1, y, '#2a2550')
      mid.rect(x + 54, 0, 1, y, '#2a2550')
      mid.rect(x, y, 61, 5, '#2a2550')
      for (let k = 0; k < 3; k++) {
        mid.rect(x + 8 + k * 18, y + 5, 8, 7, '#2a2550')
        mid.rect(x + 9 + k * 18, y + 12, 6, 2, '#6a6890')
      }
    }
    hoseLoop(mid, 300, 380, 24, 84, '#231f48', 3)
    hoseLoop(mid, 780, 830, 16, 60, '#231f48', 3)
    // pump housings on the floor
    mid.rect(420, 238, 70, 60, '#1e1a40')
    mid.ellipse(455, 240, 35, 8, '#1e1a40')
    mid.rect(426, 252, 58, 1, '#2a2550')
    mid.rect(1220, 250, 40, 48, '#1e1a40')

    const near = new Strip(960)
    const dark = '#0a0818'
    // a control desk with a sloping face and two lit strips
    near.poly([[100, 298], [100, 272], [112, 262], [156, 262], [156, 298]], dark)
    near.rect(114, 266, 22, 2, '#5a1f3e')
    near.rect(114, 271, 14, 2, '#22356a')
    for (const x of [380, 640, 860]) {
      near.rect(x, 268, 10, 30, dark)
      near.rect(x, 266, 10, 3, '#2a3e78')
    }
    near.rect(520, 284, 70, 14, dark)
    near.rect(530, 276, 20, 8, dark)
    under(near, '#08061a')

    return { sky, weather: 'none', cloudSpeed: 0, tall: { mid: 160 }, strips: { far, mid, near } }
  },

  /**
   * Token rooms: a cosy vault. Navy walls under a gold cornice, the great round vault door,
   * walls of deposit boxes, a plaque with the shield; velvet drapes in the middle distance; a
   * rope on brass posts by the floor.
   */
  bonus() {
    const ceil = '#11153a'
    const wall = PAL.navy
    const wallLight = '#222a62'
    const wallDark = '#151a45'
    const gold = '#7d6630'
    const goldLight = '#98803f'
    const sky = [[0, ceil]]

    const far = new Strip(960)
    far.rect(0, 0, 960, VIEW_H, wall)
    far.rect(0, 0, 960, 34, ceil)
    far.rect(0, 34, 960, 3, goldLight)
    far.rect(0, 37, 960, 2, gold)
    for (let x = 2; x < 960; x += 8) far.rect(x, 39, 4, 3, gold)
    // walls of deposit boxes
    const boxes = (x0, x1, y0, y1) => {
      for (let y = y0; y + 12 <= y1; y += 14) {
        for (let x = x0; x + 18 <= x1; x += 20) {
          far.rect(x, y, 18, 12, wallLight)
          far.rect(x + 17, y, 1, 12, wallDark)
          far.rect(x, y + 11, 18, 1, wallDark)
          far.rect(x + 7, y + 5, 4, 1, gold)
        }
      }
    }
    boxes(70, 250, 84, 236)
    boxes(710, 890, 84, 236)
    // the vault door
    const vx = 480
    const vy = 168
    far.rect(vx - 92, vy - 92, 184, 186, wallDark)
    far.circle(vx, vy, 80, '#262d63')
    far.circle(vx, vy, 74, '#353d75')
    far.circle(vx, vy, 66, '#2c346b')
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU
      far.rect(Math.round(vx + Math.cos(a) * 70) - 1, Math.round(vy + Math.sin(a) * 70) - 1, 3, 3, '#454e88')
    }
    far.rect(vx + 72, vy - 40, 14, 18, '#262d63')
    far.rect(vx + 72, vy + 22, 14, 18, '#262d63')
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.3
      far.line(vx, vy, vx + Math.cos(a) * 30, vy + Math.sin(a) * 30, gold, 2)
      far.rect(Math.round(vx + Math.cos(a) * 31) - 2, Math.round(vy + Math.sin(a) * 31) - 2, 4, 4, gold)
    }
    far.circle(vx, vy, 22, gold, { fill: false })
    far.circle(vx, vy, 21, gold, { fill: false })
    far.circle(vx, vy, 6, goldLight)
    // a plaque with the shield, and the name of the place
    for (const px of [310, 650]) {
      far.rect(px - 22, 96, 44, 52, gold)
      far.rect(px - 20, 98, 40, 48, wallDark)
      far.poly([[px - 13, 104], [px + 13, 104], [px + 13, 124], [px, 140], [px - 13, 124]], '#2c346b')
      far.text(px - 5, 110, 'M', '#7a3a4a')
      far.text(px - 1, 122, 'W', '#3d5c95')
    }
    far.text(394, 52, 'TOKEN VAULT', goldLight, 2)
    // pilasters with gold capitals, and panels low on the wall
    for (const x of [30, 270, 360, 590, 680, 920]) {
      far.rect(x, 42, 22, VIEW_H, wallLight)
      far.rect(x + 18, 42, 4, VIEW_H, wallDark)
      far.rect(x - 3, 42, 28, 5, gold)
      far.rect(x - 3, 47, 28, 1, goldLight)
      far.rect(x + 9, 60, 2, 220, wallDark)
      far.rect(x - 3, 284, 28, 4, gold)
    }
    // raised wainscot panels, lit along the top: a thin gold frame here read as a row of
    // empty boxes right where the blobs walk
    for (const [x0, x1] of [[60, 262], [400, 582], [720, 912]]) {
      for (let x = x0; x + 40 <= x1; x += 46) {
        far.rect(x, 252, 40, 26, wallDark)
        far.rect(x, 252, 39, 25, wallLight)
        far.rect(x + 1, 253, 38, 24, '#1e2559')
      }
    }

    const mid = new Strip(960)
    const DK = { a: '#4a1c38', b: '#3f1830', fold: '#33132a', tie: gold }
    /** A velvet drape from the top to the floor, gathered to a tie-back on the wall side (the left, or the right if flipped). */
    const drape = (x, w, tieY, flip) => {
      const foot = FLOOR_Y + 4
      const tmp = new Canvas(w + 1, foot + 1)
      tmp.poly([[0, 0], [w, 0], [Math.round(w * 0.5), tieY], [Math.round(w * 0.82), foot], [0, foot]], DK.b)
      const folds = new Canvas(w + 1, foot + 1)
      for (let i = 3; i < w; i += 6) {
        for (let y = 0; y <= foot; y++) {
          // the folds pinch in toward the tie and spread again below it
          const k = y < tieY ? 1 - (0.5 * y) / tieY : 0.5 + (0.32 * (y - tieY)) / (foot - tieY)
          folds.rect(Math.round(i * k), y, 2, 1, DK.fold)
        }
      }
      tmp.blit(folds, 0, 0, { mode: 'atop' })
      tmp.rect(0, tieY - 2, Math.round(w * 0.5) + 3, 4, DK.tie)
      // gathered over the rod; above it the folds run on up to the ceiling
      tmp.rect(0, 4, w + 1, 6, DK.a)
      mid.stamp(tmp, flip ? x - tmp.w : x, 0, { flipX: flip })
    }
    drape(0, 40, 150, false)
    drape(400, 34, 140, true)
    drape(560, 34, 140, false)
    drape(960, 40, 150, true)
    // a swag between the drapes, hung from a brass rod a little under the ceiling. Only the
    // drapes touch the top row, so in a tall vault (the strip carried on up) they still reach
    // the ceiling while the rod and the swag hang on the wall.
    for (const [x0, x1] of [[40, 366], [594, 920]]) {
      mid.rect(x0, 4, x1 - x0 + 1, 2, gold)
      for (let x = x0; x <= x1; x++) {
        const t = (x - x0) / (x1 - x0)
        const s = Math.round(4 * t * (1 - t) * 22)
        mid.rect(x, 6, 1, 4 + s, DK.a)
        mid.rect(x, 10 + s, 1, 2, DK.fold)
      }
    }

    // six posts, so the rope keeps its 120 px swing across the join
    const near = new Strip(720)
    const brass = '#5e4c26'
    const rope = '#4a1a2e'
    for (let x = 40; x < 720; x += 120) {
      near.rect(x, 266, 4, 32, brass)
      near.rect(x - 1, 263, 6, 4, brass)
      near.rect(x - 4, 294, 12, 4, brass)
      for (let i = 4; i < 120; i++) {
        const t = i / 120
        near.rect(x + i, 268 + Math.round(4 * t * (1 - t) * 10), 1, 2, rope)
      }
    }
    under(near, '#0e1130')

    return { sky, weather: 'none', cloudSpeed: 0, tall: { mid: 160 }, strips: { far, mid, near } }
  },
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_SCROLL = { far: 0.15, mid: 0.35, near: 0.6 }
const ORDER = ['clouds', 'far', 'mid', 'near']
const built = {}

for (const [theme, make] of Object.entries(THEMES)) {
  if (ONLY && !ONLY.includes(theme)) continue
  const t = make()
  const folded = foldShades(ORDER.map((n) => t.strips[n]).filter(Boolean))
  const atlas = new Atlas(`bg_${theme}`, { script: 'art-bg.mjs', maxWidth: 4096 })
  const strips = {}
  const sizes = {}
  for (const name of ORDER) {
    const s = t.strips[name]
    if (!s) continue
    const b = s.bounds()
    if (!b) throw new Error(`${theme}/${name} is empty`)
    // clouds keep the whole screen height; the others lose the empty rows above them, and a
    // strip whose top row runs off the screen (cables, columns) may carry on up for tall areas
    const top = name === 'clouds' ? 0 : b.y
    const frame = extendUp(s.crop(0, top, s.w, VIEW_H - top), top === 0 ? (t.tall?.[name] ?? 0) : 0)
    strips[name] = frame
    sizes[name] = { w: frame.w, h: frame.h }
    atlas.add(name, frame)
  }
  atlas.maxWidth = Math.max(...Object.values(sizes).map((s) => s.w)) + 2
  const sheet = atlas.pack()
  const added = checkPalette(sheet).map((b) => b.colour)
  for (const [, col] of t.sky) if (checkPalette(new Canvas(1, 1, col)).length) added.push(hex(col))
  const uniq = [...new Set(added)].sort()
  if (uniq.some((c) => c.includes('alpha'))) throw new Error(`${theme}: half-transparent pixels`)
  t.scroll = { ...DEFAULT_SCROLL, ...t.scroll }
  atlas.meta({
    sky: t.sky.map(([y, col]) => [y, hex(col)]),
    weather: t.weather,
    cloudSpeed: t.cloudSpeed ?? 0,
    scroll: t.scroll,
    strips: sizes,
    added: uniq,
  })
  const out = atlas.write({ dir: ASSETS_DIR })
  const kb = (fs.statSync(out.png).size / 1024).toFixed(1)
  console.log(`bg_${theme}: sheet ${out.sheet.w}x${out.sheet.h}, ${kb} KB, ${sheet.colours().size} colours (${folded} folded), ${uniq.length} outside the palette; ` + Object.entries(sizes).map(([k, v]) => `${k} ${v.w}x${v.h}`).join(', '))
  built[theme] = { ...t, frames: strips, added: uniq }
}

/* ------------------------------------------------------------------ */
/* Review (only with --review <dir>)                                   */
/* ------------------------------------------------------------------ */

/** The frame table of a generated atlas module, read as text. */
function readFrames(name) {
  const ts = path.join(ASSETS_DIR, `${name}.atlas.ts`)
  const png = path.join(ASSETS_DIR, `${name}.png`)
  if (!fs.existsSync(ts) || !fs.existsSync(png)) return null
  const frames = {}
  const re = /^\s*'?([\w$]+)'?: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+)(?:, ax: (-?\d+), ay: (-?\d+))? \},$/gm
  for (const m of fs.readFileSync(ts, 'utf8').matchAll(re)) frames[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5], ax: +(m[6] ?? 0), ay: +(m[7] ?? 0) }
  const sheet = Canvas.load(png)
  return { frames, get: (f) => (frames[f] ? { canvas: sheet.crop(frames[f].x, frames[f].y, frames[f].w, frames[f].h), ...frames[f] } : null) }
}

function paintSky(out, sky) {
  sky.forEach(([y, col], i) => out.rect(0, y, out.w, (sky[i + 1]?.[0] ?? out.h) - y, col))
}

function paintStrip(out, frame, offset, down = 0) {
  if (!frame) return
  const y = out.h - frame.h + down
  for (let x = -mod(Math.round(offset), frame.w); x < out.w; x += frame.w) out.blit(frame, x, y)
}

/**
 * The picture the renderer makes (render/themes.ts): sky, clouds, far, mid, near. `climb` is how
 * far the camera has gone up from the bottom of a tall area: each strip sinks by its own share.
 */
function compose(t, camX, seconds = 0, climb = 0) {
  const out = new Canvas(VIEW_W, VIEW_H)
  paintSky(out, t.sky.map(([y, col], i) => [i ? y + Math.round(climb * 0.08) : 0, col]))
  paintStrip(out, t.frames.clouds, Math.floor(camX * 0.06 + seconds * (t.cloudSpeed ?? 0)), Math.round(climb * 0.06))
  for (const name of ['far', 'mid', 'near']) paintStrip(out, t.frames[name], Math.floor(camX * t.scroll[name]), Math.round(climb * t.scroll[name]))
  return out
}

/** A floor, a pit, a ledge and the hero, to judge the picture as a backdrop. */
function stage(theme, pic, tiles, hero) {
  const cols = VIEW_W / 32
  const solid = (tx, ty) => ty >= 0 && !(tx >= 13 && tx <= 15) // a three-tile pit
  const tile = (key) => tiles?.get(`${theme}_${key}`) ?? tiles?.get(`any_${key}`) ?? null
  for (let tx = 0; tx < cols; tx++) {
    for (let ty = 0; ty < 2; ty++) {
      if (!solid(tx, ty)) continue
      const x = tx * 32
      const y = FLOOR_Y + ty * 32
      const l = solid(tx - 1, ty)
      const r = solid(tx + 1, ty)
      const key = ty === 0 ? (!l ? 'ground_tl' : !r ? 'ground_tr' : 'ground_t') : !l ? 'ground_l' : !r ? 'ground_r' : (tx * 7 + ty * 13) % 5 === 0 ? 'ground_m2' : 'ground_m'
      const f = tile(key)
      if (f) pic.blit(f.canvas, x, y)
      else {
        pic.rect(x, y, 32, 32, PAL.wood[1])
        if (ty === 0) pic.rect(x, y, 32, 4, PAL.wood[2])
      }
    }
  }
  // a short ledge in the air, of whatever the tile artist calls a catwalk and a brick
  for (let i = 0; i < 4; i++) {
    const f = tile(i === 0 ? 'catwalk_l' : i === 3 ? 'catwalk_r' : 'catwalk')
    if (f) pic.blit(f.canvas, 448 + i * 32, 200)
    else pic.rect(448 + i * 32, 200, 32, 8, PAL.wood[2])
  }
  for (let i = 0; i < 3; i++) {
    const f = tile(i === 1 ? 'prize0' : 'brick')
    if (f) pic.blit(f.canvas, 96 + i * 32, 168)
    else pic.rect(96 + i * 32, 168, 32, 32, i === 1 ? PAL.blue[1] : PAL.grey[4])
  }
  if (hero) {
    pic.blit(hero.canvas, 240 - hero.ax, FLOOR_Y - hero.ay)
    pic.blit(hero.canvas, 496 - hero.ax, 200 - hero.ay, { flipX: true })
  }
  // whatever else must read on it, if those atlases are there yet: a grackle, a blob, coins over the pit, a token
  const put = (f, x, y, flipX = false) => f && pic.blit(f.canvas, x - (flipX ? f.w - f.ax : f.ax), y - f.ay, { flipX })
  put(cast.bird, 344, 120)
  put(cast.bird, 600, 250, true)
  put(cast.blob, 352, FLOOR_Y)
  for (let i = 0; i < 4; i++) put(cast.coin, 420 + i * 24, 262 - Math.round(16 * Math.sin(((i + 0.5) / 4) * Math.PI)))
  put(cast.token, 60, 140)
  return pic
}

const cast = {}

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const tiles = readFrames('tiles')
  const hero = readFrames('maxx')?.get('idle0') ?? null
  const critters = readFrames('critters')
  const items = readFrames('items')
  Object.assign(cast, { bird: critters?.get('birdFly0'), blob: critters?.get('blob3Walk0'), coin: items?.get('coin0'), token: items?.get('token0') })
  console.log(tiles ? `review: floor from tiles.png (${Object.keys(tiles.frames).length} frames)` : 'review: tiles.png is not there yet, flat brown floor')
  const games = []
  for (const [theme, t] of Object.entries(built)) {
    const cams = [0, 1730, 3940]
    cams.forEach((cam, i) => compose(t, cam, i * 37).save(path.join(REVIEW, `${theme}_cam${i}.png`)))
    compose(t, cams[1], 37).scale(2).save(path.join(REVIEW, `${theme}_cam1_2x.png`))
    // the camera 300 px up a tall area: what fills in above the strips
    compose(t, cams[1], 37, 300).save(path.join(REVIEW, `${theme}_tall.png`))

    // seams: the 640 px around the join of each strip, stacked, on the sky
    const names = ORDER.filter((n) => t.frames[n])
    const sheet = new Canvas(VIEW_W, names.length * (VIEW_H + 12))
    names.forEach((n, i) => {
      const f = t.frames[n]
      const pic = new Canvas(VIEW_W, VIEW_H)
      paintSky(pic, t.sky)
      paintStrip(pic, f, f.w - VIEW_W / 2)
      sheet.blit(pic, 0, i * (VIEW_H + 12) + 12)
      sheet.rect(0, i * (VIEW_H + 12), VIEW_W, 12, PAL.grey[0])
      sheet.text(4, i * (VIEW_H + 12) + 3, `${theme} ${n} ${f.w}x${f.h}  seam at the tick`, W)
      sheet.rect(VIEW_W / 2, i * (VIEW_H + 12) + 8, 1, 4, PAL.yellow[1])
      const two = new Canvas(f.w * 2, VIEW_H)
      paintSky(two, t.sky)
      paintStrip(two, f, 0)
      two.save(path.join(REVIEW, `${theme}_seam_${n}.png`))
    })
    sheet.save(path.join(REVIEW, `${theme}_seams.png`))

    const game = stage(theme, compose(t, cams[1], 37), tiles, hero)
    game.save(path.join(REVIEW, `${theme}_game.png`))
    game.scale(2).save(path.join(REVIEW, `${theme}_game_2x.png`))
    games.push({ theme, game })
  }
  const all = new Canvas(2 * VIEW_W + 4, Math.ceil(games.length / 2) * (VIEW_H + 4), PAL.grey[0])
  games.forEach(({ game }, i) => all.blit(game, (i % 2) * (VIEW_W + 4), Math.floor(i / 2) * (VIEW_H + 4)))
  all.save(path.join(REVIEW, 'all.png'))
  console.log(`review sheets in ${REVIEW}`)
}
