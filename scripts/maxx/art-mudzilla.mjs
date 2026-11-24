// art-mudzilla.mjs: generates the 'mudzilla' atlas: MUDZILLA, the final boss, a monster truck
// so filthy it has become a monster, and everything it throws (simulated in
// game/sim/entities/mudzilla.ts, drawn by game/render/entities/mudzilla.ts).
//
//   node scripts/maxx/art-mudzilla.mjs                  writes mudzilla.png + mudzilla.atlas.ts
//   node scripts/maxx/art-mudzilla.mjs --review <dir>   also writes contact sheets into <dir>:
//       every part as strips at 1x and 3x on the arena's colours (night sky, tunnel purple,
//       navy floor), plain and mirrored, and the whole truck put together pose by pose the
//       way the renderer puts it together
//
// The truck is drawn from shapes in its own space (facing RIGHT, ground at y 150, the sim box
// 200 x 150 from x 0) and every frame is rasterised by asking, for each pixel centre, what
// colour the truck has there after turning it nose-up about the rear axle (a wheelie) or
// shrinking it (the finish). Nothing is resampled, so a turned frame is as crisp as a level one.
//
// A truck on screen is five draws, back to front, all anchored at the box's feet (the ground
// under the middle of the box): chassis<stage>_<pitch>, the rear tyre and the front tyre
// (anchored at their hubs; meta.axles says where), body<stage>_<pitch>, face<stage>_<expr>_<pitch>.
// The finish has whole-truck frames of its own (fin*, small*).

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
const PAINT = { deep: PAL.red[2], dark: PAL.orange[0], mid: PAL.orange[1], light: PAL.orange[2], shine: PAL.wood[8] }
const STRIPE = { dark: PAL.yellow[0], mid: PAL.yellow[1], light: PAL.yellow[2] }
const CHROME = { dark: PAL.grey[2], mid: PAL.grey[3], light: PAL.grey[4], shine: PAL.grey[5] }
const RUBBER = { deep: PAL.grey[0], mid: PAL.grey[1], light: PAL.grey[2] }
const GLASS = { dark: PAL.blue[1], mid: PAL.blue[3], light: PAL.blue[4] }
const TONGUE = { dark: PAL.red[2], mid: PAL.pink[0], light: PAL.red[5] }
const MOUTH = PAL.red[0]
const SWEAT = { mid: PAL.ice[1], light: PAL.ice[2] }

/* ------------------------------------------------------------------ */
/* Little helpers                                                      */
/* ------------------------------------------------------------------ */

function inPoly(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Smooth value noise, 0..1, the same everywhere for the same (x, y): mud that sits still on a turning body. */
function hash(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function noise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
const fbm = (x, y) => 0.65 * noise(x, y) + 0.35 * noise(x * 2.1 + 7, y * 2.1 + 3)

/**
 * Rasterise a colour function of truck space. opts: theta (nose-up turn, radians, about
 * pivot), scale (about the feet), win [u0, v0, u1, v1] (the part of truck space to look at).
 * Returns the trimmed canvas and its anchor (the box's feet, truck point (100, 150)).
 */
function render(colour, { theta = 0, pivot = [46, 117], scale = 1, win = [-30, -60, 230, 175], outline = true } = {}) {
  const [px, py] = pivot
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const fwd = (u, v) => {
    const X = px + (u - px) * cos + (v - py) * sin
    const Y = py - (u - px) * sin + (v - py) * cos
    return [100 + (X - 100) * scale, 150 + (Y - 150) * scale]
  }
  const corners = [fwd(win[0], win[1]), fwd(win[2], win[1]), fwd(win[0], win[3]), fwd(win[2], win[3])]
  const x0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 2
  const y0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 2
  const x1 = Math.ceil(Math.max(...corners.map((c) => c[0]))) + 2
  const y1 = Math.ceil(Math.max(...corners.map((c) => c[1]))) + 2
  const c = new Canvas(x1 - x0, y1 - y0)
  for (let j = 0; j < c.h; j++) {
    for (let i = 0; i < c.w; i++) {
      const X = 100 + (x0 + i + 0.5 - 100) / scale
      const Y = 150 + (y0 + j + 0.5 - 150) / scale
      const u = px + (X - px) * cos - (Y - py) * sin
      const v = py + (X - px) * sin + (Y - py) * cos
      const col = colour(u, v)
      if (col) c.set(i, j, col)
    }
  }
  if (outline) c.outline(O)
  const t = c.trim()
  return { canvas: t.canvas, ax: 100 - x0 - t.x, ay: 150 - y0 - t.y }
}

/* ------------------------------------------------------------------ */
/* The truck's shape                                                   */
/* ------------------------------------------------------------------ */

// Truck space: x right (it faces right), y down, the ground at 150, the sim box from x 0 to 200.
// Body shapes are in (u, h): u along the truck, h up from the body's bottom edge.
const REAR_X = 46
const FRONT_X = 156
const WHEELBASE = FRONT_X - REAR_X

/** The monster stands tall on huge tyres; the shrinking finish ends on an ordinary pickup. */
function geom({ R = 33, lift = 25 } = {}) {
  const axleY = 150 - R
  return { R, axleY, bottom: axleY - lift }
}
const BIG = geom()

const SIDE = [
  [6, 0], [3, 7], [3, 42], [70, 42], [70, 66], [76, 74], [128, 74], [134, 68], [147, 47], [184, 44],
  [193, 40], [198, 33], [199, 6], [195, 0],
]
const WINDOW = [[81, 47], [81, 69], [103, 69], [103, 47]]
const WINDOW2 = [[107, 47], [107, 69], [126, 69], [131, 64], [141, 47]]
const STACK = [[63, 36], [63, 88], [66, 92], [71, 92], [71, 36]]

function onSide(u, h) {
  return inPoly(SIDE, u, h)
}

/** Dorsal plates of dried mud along the roof, the bed rail and the hood: [u, base h, height, half width]. */
const SPIKES = [
  [11, 42, 13, 6], [25, 42, 15, 6], [39, 42, 14, 6], [53, 42, 12, 6],
  [83, 74, 16, 6], [96, 74, 20, 7], [110, 74, 19, 7], [123, 73, 14, 6],
  [155, 46, 10, 5], [168, 45, 9, 5],
]
function spikesFor(stage) {
  if (stage === 1) return SPIKES
  if (stage === 2) return SPIKES.filter((_, i) => i % 3 !== 1).map(([u, h, ht, hw]) => [u, h, Math.round(ht * 0.45), hw - 1])
  if (stage === 3) return [[98, 74, 6, 4], [109, 74, 7, 4]]
  return []
}
function inSpike(spikes, u, h) {
  for (const [su, sh, ht, hw] of spikes) {
    if (h < sh - 2 || h > sh + ht) continue
    const k = (h - sh) / ht
    // Swept back: the tip leans toward the tail.
    const mid = su - 4 * k
    if (Math.abs(u - mid) <= hw * (1 - k)) return true
  }
  return false
}

/** Mud hanging off the bottom edge: [u, length]. */
const DRIPS = [[16, 9], [27, 5], [88, 8], [97, 4], [118, 10], [131, 6], [196, 7]]
function inDrip(drips, u, h) {
  for (const [du, len] of drips) {
    if (h > 1 || h < -len) continue
    const k = -h / len
    if (Math.abs(u - du) <= 3 * (1 - k) + 0.5) return true
  }
  return false
}

/** How muddy the paint is at (u, h): 0 clean, 1 mud, 2 crack in the mud. */
function mudAt(stage, u, h) {
  if (stage === 1) {
    // Caked all over, cracked like a dry riverbed, the odd chip of paint showing.
    if (fbm(u / 13 + 30, h / 13) > 0.83) return 0
    return Math.abs(fbm(u / 22 + 4, h / 15) - 0.5) < 0.02 ? 2 : 1
  }
  if (stage === 2) {
    // A tide of mud up the flanks, with clean runs where the water came down through it.
    const tide = 27 + 10 * noise(u / 20, 3)
    const run = noise(u / 3.5, 11)
    const depth = run > 0.58 ? (run - 0.58) * 110 : 0
    if (h < tide) {
      if (h > tide - depth) return 0
      return Math.abs(fbm(u / 16, h / 10) - 0.5) < 0.02 ? 2 : 1
    }
    return fbm(u / 11 + 9, h / 11) > 0.7 ? 1 : 0
  }
  if (stage === 3) return h < 22 && fbm(u / 6 + 2, h / 6) > 0.76 ? 1 : 0
  return 0
}

/** The lightning stripe down its flank, hidden under the mud until it is washed. */
function inStripe(u, h) {
  if (u < 8 || u > 192 || (u > 62 && u < 74)) return false
  const tri = Math.abs(((u / 16) % 2) - 1)
  const mid = 20 + 5 * tri
  return Math.abs(h - mid) <= 2.5
}

/**
 * The body (panels, windows, bumpers, stack, light bar, plates and drips), as a colour of truck
 * space. Holes where the wheel arches are, so the tyres drawn before it show through.
 */
function bodyColour(stage, G = BIG, { foam = false } = {}) {
  const spikes = spikesFor(stage)
  const drips = stage === 1 ? DRIPS : stage === 2 ? DRIPS.filter((_, i) => i % 2 === 0).map(([u, l]) => [u, Math.ceil(l / 2)]) : []
  const archR = G.R + 4
  const inArch = (u, v) => Math.hypot(u - REAR_X, v - G.axleY) < archR || Math.hypot(u - FRONT_X, v - G.axleY) < archR
  const solid = (u, h) => (onSide(u, h) && !inArch(u, G.bottom - h)) || inSpike(spikes, u, h)
  return (u, v) => {
    const h = G.bottom - v
    // Bumpers, chrome, in front of everything.
    const frontBumper = u >= 183 && u <= 202 && h >= -3 && h <= 9
    const rearBumper = u >= 0 && u <= 9 && h >= -3 && h <= 7
    if (frontBumper || rearBumper) {
      if (stage === 1 && fbm(u / 4, h / 4) > 0.45) return h > 4 ? MUD[3] : MUD[2]
      if (h >= 7 || (rearBumper && h >= 5)) return CHROME.shine
      if (h <= -2) return CHROME.dark
      return stage === 2 && fbm(u / 4, h / 3) > 0.62 ? MUD[2] : CHROME.light
    }
    // The exhaust stack behind the cab: the smoke of a backfire comes out of its top.
    if (inPoly(STACK, u, h)) {
      if (h > 88) return CHROME.dark
      if (stage === 1 && h < 60) return fbm(u / 3, h / 5) > 0.4 ? MUD[2] : MUD[1]
      return u < 65 ? CHROME.shine : u > 69 ? CHROME.mid : CHROME.light
    }
    if (inDrip(drips, u, h) && !inArch(u, v)) return h < -2 ? MUD[1] : MUD[2]
    if (inSpike(spikes, u, h) && !onSide(u, h)) {
      const lit = !inSpike(spikes, u - 1.5, h + 1)
      const dark = !inSpike(spikes, u + 1.5, h - 1)
      if (stage === 3) return lit ? MUD[3] : MUD[2]
      return lit ? MUD[4] : dark ? MUD[1] : (u + h) % 7 < 1 ? MUD[1] : MUD[2]
    }
    // The light bar on the roof.
    if (h >= 74 && h <= 79 && u >= 84 && u <= 124) {
      const lamp = (u - 86) % 10
      if (h >= 75 && h <= 78 && lamp >= 1 && lamp <= 5) {
        if (stage === 1 && (u < 96 || u > 114)) return MUD[2]
        return lamp <= 2 && h >= 77 ? STRIPE.light : STRIPE.mid
      }
      return h >= 78 ? CHROME.mid : RUBBER.mid
    }
    if (!onSide(u, h) || inArch(u, v)) return 0
    // A fender flare round each arch.
    const archD = Math.min(Math.hypot(u - REAR_X, v - G.axleY), Math.hypot(u - FRONT_X, v - G.axleY))
    if (archD < archR + 3) return stage === 1 ? MUD[1] : stage === 2 && h < 14 ? MUD[1] : RUBBER.light
    // Windows.
    if (inPoly(WINDOW, u, h) || inPoly(WINDOW2, u, h)) {
      const edge = !inPoly(WINDOW, u, h + 1.5) && !inPoly(WINDOW2, u, h + 1.5)
      if (stage === 1) {
        // Caked over, but for the fan a wiper has cleared.
        const d = Math.hypot(u - 116, h - 47)
        if (d < 17 && h > 48) return d > 15.5 ? MUD[1] : (u - h + 200) % 12 < 2 ? GLASS.mid : GLASS.dark
        return fbm(u / 8, h / 8) > 0.55 ? MUD[3] : MUD[2]
      }
      if (stage === 2 && h < 53 + 5 * noise(u / 6, 1)) return MUD[2]
      if (edge) return GLASS.light
      const glint = (u - h * 0.7 + 200) % 26
      if (glint < 3 || (glint > 5 && glint < 6.5)) return GLASS.light
      return h > 60 ? GLASS.mid : GLASS.dark
    }
    // Panel lines.
    const lit = !solid(u - 2, h + 2)
    const shade = !solid(u + 2, h - 2)
    const seam = (Math.abs(u - 75) < 0.6 && h < 42) || (Math.abs(u - 105) < 0.6 && h < 44 && h > 4) || (Math.abs(h - 42) < 0.6 && u > 4 && u < 70)
    const mud = foam ? 0 : mudAt(stage, u, h)
    if (mud === 2) return MUD[0]
    if (mud === 1) {
      if (lit) return MUD[4]
      if (shade) return MUD[1]
      return fbm(u / 15 + 20, h / 10) > 0.6 ? MUD[3] : MUD[2]
    }
    if (seam) return PAINT.dark
    if (stage !== 1 && inStripe(u, h)) return lit ? STRIPE.light : shade ? STRIPE.dark : STRIPE.mid
    if (lit) return PAINT.light
    if (shade || h < 5) return PAINT.dark
    // A shine along the upper flank: it is a truck under there.
    if (h > 34 && h < 38 && (u < 64 || u > 140)) return PAINT.light
    return PAINT.mid
  }
}

/** The frame, shocks, driveshaft and skid plate: drawn behind the tyres. */
function chassisColour(stage, G = BIG) {
  const b = G.bottom
  const a = G.axleY
  const mud = (u, v) => stage === 1 || (stage === 2 && fbm(u / 5, v / 5) > 0.55)
  return (u, v) => {
    // Coil-over shocks, two an axle, from the frame down to the hub.
    for (const ax of [REAR_X, FRONT_X]) {
      for (const off of [-12, 9]) {
        const x0 = ax + off
        if (u >= x0 && u <= x0 + 4 && v >= b + 2 && v <= a - 2) {
          if (mud(u, v) && stage === 1) return (v | 0) % 4 < 2 ? MUD[1] : MUD[2]
          if ((v | 0) % 4 === 0) return STRIPE.dark
          return u < x0 + 1.5 ? STRIPE.light : STRIPE.mid
        }
      }
    }
    // Frame rail under the body.
    if (u >= 14 && u <= 188 && v >= b - 1 && v <= b + 6) {
      if (mud(u, v)) return v < b + 2 ? MUD[2] : MUD[1]
      return v < b + 1 ? CHROME.mid : RUBBER.light
    }
    // Driveshaft between the axles.
    const t = (u - REAR_X) / WHEELBASE
    if (t > 0 && t < 1) {
      const y = a - 5 - 8 * t
      if (Math.abs(v - y) <= 2) return mud(u, v) ? MUD[1] : Math.abs(v - y) < 1 ? CHROME.light : CHROME.dark
    }
    // Skid plate under the engine.
    if (u >= 128 && u <= 186 && v >= b + 5 && v <= b + 10) return mud(u, v) ? MUD[2] : CHROME.dark
    return 0
  }
}

/* ------------------------------------------------------------------ */
/* Tyres                                                               */
/* ------------------------------------------------------------------ */

const LUGS = 14

/**
 * One tyre, centred on its hub. phase 0..3 turns it a quarter of a lug; blur: spinning flat out.
 * Always black rubber (it must read as a monster truck's tyre at any stage); the mud on it is
 * stuck to the rubber, so it is looked up in the tyre's own turned frame and turns with it.
 */
function tyreColour(stage, phase, blur, R = BIG.R) {
  const step = (Math.PI * 2) / LUGS
  const turn = (phase / 4) * step
  const hub = R * 0.42
  return (x, y) => {
    const r = Math.hypot(x, y)
    if (r > R + 0.5) return 0
    const ang = Math.atan2(y, x)
    // Clockwise is forward for a truck that faces right.
    const a = ang - turn
    const k = (((a / step) % 1) + 1) % 1
    const lug = k < 0.55
    if (!blur && r > R - 3 && !lug) return 0
    const lit = x + y < -R * 0.5
    // Mud on the tyre, in its own frame: caked (stage 1), splashed up the lower half (2), none (3).
    const tx = r * Math.cos(a)
    const ty = r * Math.sin(a)
    const caked = stage === 1 ? fbm(tx / 7 + 3, ty / 7 + 9) > 0.47 : stage === 2 ? y > R * 0.2 && fbm(x / 5 + 3, y / 5) > 0.38 : false
    if (r <= hub) {
      // The wheel: caked with a chip of yellow showing, splashed, or clean yellow and chrome with five bolts.
      if (stage === 1) {
        if (r < 3.2) return MUD[1]
        const chip = fbm(tx / 4 + 11, ty / 4 + 2)
        if (chip > 0.7) return blur ? STRIPE.dark : lit ? STRIPE.mid : STRIPE.dark
        return chip > 0.45 ? MUD[3] : MUD[2]
      }
      const b = ang - (phase / 4) * ((Math.PI * 2) / 5)
      const bk = (((b / ((Math.PI * 2) / 5)) % 1) + 1) % 1
      if (stage === 2 && y > 2 + 3 * noise(x / 4, 5)) return y > hub * 0.6 ? MUD[1] : MUD[2]
      if (r < 3.2) return CHROME.shine
      if (r > hub - 2) return blur ? STRIPE.mid : STRIPE.dark
      if (blur) return r > hub * 0.5 && r < hub * 0.62 ? STRIPE.light : STRIPE.mid
      if (r > hub * 0.45 && r < hub * 0.7 && (bk < 0.16 || bk > 0.92)) return RUBBER.deep
      return lit ? STRIPE.light : STRIPE.mid
    }
    if (r <= hub + 2) return RUBBER.deep
    if (blur) {
      // Spinning flat out: the tread is a smear, with arcs of light (and flung mud) whipping round.
      // Three rings of arcs, each ring turned its own way, so the two frames read as a spin.
      for (const [ring, off, len] of [[R - 3, 0.3, 0.75], [hub + 9, 1.9, 0.6], [hub + 4.5, 3.6, 0.45]]) {
        if (Math.abs(r - ring) > 1.1) continue
        const sweep = (((ang + off + phase * 0.55) % (Math.PI * 2 / 3)) + Math.PI * 2) % (Math.PI * 2 / 3)
        if (sweep < len) return stage === 1 && ring > R - 5 ? MUD[4] : sweep < len * 0.35 ? CHROME.mid : RUBBER.light
      }
      if (r > R - 6) return stage === 1 && fbm(ang * 3 + 7, r / 3) > 0.55 ? MUD[1] : RUBBER.deep
      return lit ? RUBBER.light : RUBBER.mid
    }
    if (r > R - 7) {
      // Tread blocks: lit faces up and to the left.
      if (!lug) return caked && stage === 1 ? MUD[1] : RUBBER.deep
      if (caked) return lit ? MUD[4] : k < 0.15 ? MUD[4] : MUD[3]
      return lit ? CHROME.dark : k < 0.12 ? RUBBER.light : RUBBER.mid
    }
    // Sidewall, with a bulge that catches the light.
    if (caked) return fbm(tx / 4, ty / 4) > 0.55 ? MUD[3] : MUD[2]
    if (r > hub + 6 && r < hub + 8) return lit ? CHROME.dark : RUBBER.light
    return lit ? RUBBER.light : RUBBER.mid
  }
}

function renderTyre(stage, phase, blur, R = BIG.R) {
  const f = tyreColour(stage, phase, blur, R)
  const n = Math.ceil(R) + 3
  const c = new Canvas(2 * n, 2 * n)
  for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) {
    const col = f(i + 0.5 - n, j + 0.5 - n)
    if (col) c.set(i, j, col)
  }
  c.outline(O)
  const t = c.trim()
  return { canvas: t.canvas, ax: n - t.x, ay: n - t.y }
}

/* ------------------------------------------------------------------ */
/* Faces                                                               */
/* ------------------------------------------------------------------ */

// In body space (u, h). Two headlight eyes on the nose, the grille is the mouth.
const EYES = [
  [161, 31],
  [184, 31],
]
const EYE_RX = 9
const EYE_RY = 10

/**
 * The look of each expression. eyes: 'open' | 'shut' | 'squeeze' | 'wide' | 'dizzy' | 'happy' |
 * 'sheep'; look: pupil offset; brow: 'angry' | 'worried' | 'up' | 'none'; mouth: 'grin' |
 * 'grit' | 'roar' | 'sputter' | 'pant0' | 'pant1' | 'wobble' | 'smile' | 'beam' | 'o'.
 */
const EXPR = {
  mean: { eyes: 'open', look: [2, 1], brow: 'angry', mouth: 'grin' },
  blink: { eyes: 'shut', look: [0, 0], brow: 'angry', mouth: 'grin' },
  grit: { eyes: 'open', look: [3, 0], brow: 'angry', mouth: 'grit' },
  roar: { eyes: 'open', look: [2, -1], brow: 'angry', mouth: 'roar' },
  flinch: { eyes: 'squeeze', look: [0, 0], brow: 'up', mouth: 'sputter' },
  pant0: { eyes: 'dizzy', look: [0, 0], brow: 'none', mouth: 'pant0' },
  pant1: { eyes: 'dizzy', look: [0, 0], brow: 'none', mouth: 'pant1' },
  nervous: { eyes: 'wide', look: [-1, 1], brow: 'worried', mouth: 'wobble' },
  dazed: { eyes: 'wide', look: [0, 0], brow: 'up', mouth: 'o' },
  sheep: { eyes: 'sheep', look: [-2, 2], brow: 'worried', mouth: 'smile' },
  happy: { eyes: 'happy', look: [0, 0], brow: 'none', mouth: 'beam' },
}

/** The middle of the eyes, in body space: a bigger face (the little truck's) grows from here. */
const FACE_MID = [172.5, 26]

/**
 * The face, in body space: eyes, brow, mouth, tongue, sweat. 0 where the body shows.
 * opts.eye scales eyes, brows and sweat about FACE_MID; opts.mouth [x, y] scales the mouth back
 * from the front bumper and up from its bottom (the shrunk truck wears a cartoon-sized face).
 */
function faceShape(stage, exprName, { eye = 1, mouth: mouthScale = [1, 1] } = {}) {
  const E = EXPR[exprName]
  // Stage 3 has lost its brow of mud: the anger turns to worry.
  const brow = stage === 3 && E.brow === 'angry' ? 'worried' : E.brow
  const sclera = stage === 1 ? STRIPE.light : stage === 2 ? PAL.wood[8] : WHITE
  const scleraShade = stage === 1 ? STRIPE.mid : stage === 2 ? PAL.wood[7] : CHROME.shine
  const tall = E.eyes === 'wide' ? 1.5 : 0
  const mouth = mouthShape(E.mouth, stage)
  const lid = stage === 1 ? MUD[3] : PAINT.mid
  const lidLit = stage === 1 ? MUD[4] : PAINT.light
  return (u0, h0) => {
    const u = FACE_MID[0] + (u0 - FACE_MID[0]) / eye
    const h = FACE_MID[1] + (h0 - FACE_MID[1]) / eye
    const mu = 199 - (199 - u0) / mouthScale[0]
    const mh = 6 + (h0 - 6) / mouthScale[1]
    // The brow of dried mud (stages 1 and 2), a slab over both eyes that dips in the middle when cross.
    if (brow === 'angry' && stage < 3) {
      const thick = stage === 1 ? 7 : 5
      const mid = (EYES[0][0] + EYES[1][0]) / 2
      const dip = Math.abs(u - mid) < 12 ? 4 * (1 - Math.abs(u - mid) / 12) : 0
      const low = 34 - dip + (stage === 1 ? 0 : 1)
      if (u >= 149 && u <= 197 && h >= low && h <= low + thick && !(stage === 2 && u > 189 && h > low + 2)) {
        if (h > low + thick - 1.5) return MUD[4]
        if (Math.abs(fbm(u / 5, h / 3) - 0.5) < 0.05) return MUD[0]
        return h < low + 1.5 ? MUD[1] : MUD[3]
      }
    }
    // Eyebrows when the mud is gone (or raised in surprise).
    if (brow === 'worried' || (brow === 'up' && stage === 3)) {
      for (const [ex, ey] of EYES) {
        const d = u - ex
        if (Math.abs(d) <= 6) {
          // Inner ends up: worried.
          const inner = ex < 172 ? d : -d
          const y = ey + EYE_RY + 3 + tall + (brow === 'worried' ? inner * 0.35 : 1.5)
          if (Math.abs(h - y) <= 1) return stage === 3 ? PAL.grey[1] : MUD[1]
        }
      }
    }
    if (brow === 'up' && stage < 3) {
      for (const [ex, ey] of EYES) {
        const d = u - ex
        if (Math.abs(d) <= 7 && Math.abs(h - (ey + EYE_RY + 4 - Math.abs(d) * 0.2)) <= 1.6) return h > ey + EYE_RY + 4.5 ? MUD[4] : MUD[2]
      }
    }
    // Eyes.
    for (const [ex, ey] of EYES) {
      const dx = u - ex
      const dy = h - ey
      if (E.eyes === 'squeeze') {
        // Screwed shut inside the headlight: > on the back eye, < on the front one, with a
        // squirt of water from the corner. The bezel stays, so the eyes read on a muddy face too.
        const e = (dx * dx) / (EYE_RX * EYE_RX) + (dy * dy) / (EYE_RY * EYE_RY)
        if (e <= 1) {
          if (e > 0.72) return dy > 0 && dx < 0 ? CHROME.shine : CHROME.mid
          const s = ex < 172 ? 1 : -1
          const k = s * dx
          if (k >= -5.5 && k <= 4.5 && Math.abs(Math.abs(dy) - (4.5 - k) * 0.8) <= 1.15) return O
          return dy > 2 ? lidLit : lid
        }
        continue
      }
      if (E.eyes === 'shut' || E.eyes === 'happy') {
        if (E.eyes === 'shut' && Math.abs(dx) <= EYE_RX && Math.abs(dy + 1) <= 1) return O
        if (E.eyes === 'happy' && Math.abs(dx) <= EYE_RX - 1 && Math.abs(dy - 1 - (6 - (dx * dx) / 8)) <= 1.1) return O
        continue
      }
      const rx = EYE_RX
      const ry = EYE_RY + tall
      const e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
      if (e > 1) continue
      // A chrome bezel: they are headlights.
      if (e > 0.72) return dy > 0 && dx < 0 ? CHROME.shine : CHROME.mid
      // Lids: half shut when dizzy or sheepish.
      if ((E.eyes === 'dizzy' || E.eyes === 'sheep') && dy > (E.eyes === 'dizzy' ? 0 : -1)) return dy < 1.5 && dy > -0.5 ? O : stage === 1 ? MUD[2] : PAINT.mid
      const [lx, ly] = E.look
      const pw = E.eyes === 'wide' ? 2 : 3
      const ph = E.eyes === 'wide' ? 3 : 4
      let pdx = dx - lx
      let pdy = dy - ly
      if (E.eyes === 'dizzy') {
        // One looks up, one looks down.
        pdy = dy - (ex < 172 ? 2 : -3)
        pdx = dx - (ex < 172 ? -2 : 2)
      }
      if (Math.abs(pdx) <= pw && Math.abs(pdy) <= ph) {
        if (pdx === 0 && pdy === 0) return O
        return Math.round(pdx) === -1 && Math.round(pdy) === 2 ? WHITE : O
      }
      return dy < -3 ? scleraShade : sclera
    }
    // Sweat when nervous, sheepish or out of breath.
    if (E.eyes === 'wide' || E.eyes === 'sheep' || E.eyes === 'dizzy') {
      const sx = 147
      const sy = 38
      const dx = u - sx
      const dy = h - sy
      if (dy <= 0 && dy >= -6 && Math.abs(dx) <= 2.2 * (1 - (dy + 6) / 9) + 0.6) return dx < 0 ? SWEAT.light : SWEAT.mid
      if (dy > 0 && dy <= 3 && Math.abs(dx) <= 0.6 * (3 - dy)) return SWEAT.mid
    }
    // Blush when sheepish.
    if (E.eyes === 'sheep') {
      for (const bx of [154, 191]) if (((u - bx) * (u - bx)) / 12 + ((h - 18) * (h - 18)) / 2.2 <= 1) return PAL.pink[0]
    }
    return mouth(mu, mh)
  }
}

/** The grille is a mouth full of teeth. */
function mouthShape(kind, stage) {
  const tooth = stage === 1 ? PAL.wood[8] : WHITE
  const toothShade = stage === 1 ? MUD[4] : CHROME.shine
  const x0 = 149
  const x1 = 199
  // Sharp teeth: a row of triangles hanging from y (pointing down) or standing on it (up).
  const teeth = (u, h, top, dir, size = 4, w = 5) => {
    const k = (((u - x0) % w) + w) % w
    const reach = size * (1 - Math.abs(k - w / 2) / (w / 2))
    const d = dir < 0 ? top - h : h - top
    if (d >= 0 && d <= reach) return d > reach - 1.2 || k < 1 ? toothShade : tooth
    return 0
  }
  return (u, h) => {
    if (u < x0 - 1 || u > x1) return 0
    switch (kind) {
      case 'grin': {
        // Wide, smug, curling up toward the cab.
        const curl = u < 160 ? (160 - u) * 0.5 : 0
        const top = 19
        const bot = 6 + curl
        if (h > top || h < bot || u < x0 + curl * 0.4) return 0
        return teeth(u, h, top, -1, 5) || teeth(u, h, bot, 1, 4) || MOUTH
      }
      case 'grit': {
        // Clenched: a grille of square teeth meeting in the middle.
        if (h > 18 || h < 6) return 0
        if (Math.abs(h - 12) < 0.6) return O
        const k = (u - x0) % 5
        if (k < 1) return O
        return h > 15 ? tooth : h < 9 ? toothShade : tooth
      }
      case 'roar': {
        // Wide open: fangs top and bottom, a tongue at the back.
        const top = 22
        const bot = -2
        if (h > top || h < bot) return 0
        const t = teeth(u, h, top, -1, 6, 6) || teeth(u, h, bot, 1, 5, 6)
        if (t) return t
        if (h < 4 && u > 156 && u < 186) return h < 2 ? TONGUE.dark : TONGUE.mid
        return MOUTH
      }
      case 'sputter': {
        // A round O, spluttering out the water that went in.
        const cx = 176
        const e = ((u - cx) * (u - cx)) / 56 + ((h - 12) * (h - 12)) / 52
        if (e <= 1) {
          if (e > 0.62) return h > 13 ? tooth : toothShade
          return h < 9 && u > cx - 3 ? SWEAT.mid : h < 7 ? SWEAT.light : MOUTH
        }
        // Water blown back out of it, toward the bumper.
        for (const [dx, dy, r] of [[11, 17, 2.1], [13, 10, 2.4], [10, 4, 1.6], [18, 14, 1.6], [19, 6, 1.5], [21, 18, 1.2]]) {
          const d = Math.hypot(u - (cx + dx), h - dy)
          if (d <= r) return d < r * 0.5 ? WHITE : SWEAT.light
        }
        return 0
      }
      case 'pant0':
      case 'pant1': {
        // Mouth hanging open, tongue lolling out over the bumper.
        const top = 18
        const bot = 4
        const len = kind === 'pant0' ? 18 : 23
        const tx = 182
        const tw = 6
        if (h <= 6 && h >= 6 - len && Math.abs(u - tx) <= tw - (h < 6 - len + 3 ? (6 - len + 3 - h) * 1.5 : 0)) {
          if (Math.abs(u - tx) < 0.6 && h < 2) return TONGUE.dark
          return u < tx - 2 ? TONGUE.light : TONGUE.mid
        }
        if (h > top || h < bot) return 0
        return teeth(u, h, top, -1, 4) || MOUTH
      }
      case 'wobble': {
        // A worried zigzag with the teeth showing.
        const y = 11 + 2 * Math.sin((u - x0) / 2.5)
        if (Math.abs(h - y) <= 3) return Math.abs(h - y) > 2 ? O : (u - x0) % 4 < 1 ? toothShade : tooth
        return 0
      }
      case 'smile': {
        // Small and sheepish.
        if (u < 166 || u > 190) return 0
        const y = 12 + ((u - 178) * (u - 178)) / 40
        return Math.abs(h - y) <= 1 ? O : 0
      }
      case 'beam': {
        // Delighted: a big D of a grin.
        if (u < 154) return 0
        const bot = 18 - Math.sqrt(Math.max(0, 1 - ((u - 176) * (u - 176)) / (23 * 23))) * 16
        if (h > 19 || h < bot) return 0
        if (h > 16) return tooth
        if (h < bot + 4 && u > 166 && u < 186) return TONGUE.mid
        return MOUTH
      }
      case 'o': {
        const e = ((u - 177) * (u - 177)) / 25 + ((h - 11) * (h - 11)) / 30
        return e <= 1 ? MOUTH : 0
      }
    }
    return 0
  }
}

/** A face layer in truck space for geometry G. */
function faceColour(stage, expr, G = BIG, faceOpts = undefined) {
  const f = faceShape(stage, expr, faceOpts)
  return (u, v) => f(u, G.bottom - v)
}

/* ------------------------------------------------------------------ */
/* Whole trucks (the finish, and the review)                           */
/* ------------------------------------------------------------------ */

/** Everything at once, front to back, for the frames that are drawn whole. */
function wholeColour(stage, expr, G, { foam = 0, phase = 0, face: faceOpts = undefined } = {}) {
  const face = faceColour(stage, expr, G, faceOpts)
  const body = bodyColour(stage, G)
  const tyre = tyreColour(stage === 0 ? 3 : stage, phase, false, G.R)
  const chassis = chassisColour(stage === 0 ? 3 : stage, G)
  return (u, v) => {
    const fc = face(u, v)
    if (fc) return fc
    // Suds left by the wash: heaped on the roof, the hood and the bed rail, sliding down the flanks.
    if (foam > 0 && body(u, v)) {
      const h = G.bottom - v
      const topEdge = !body(u, v - 4)
      const n = fbm(u / 12 + foam * 3, h / 9)
      if ((topEdge && n > 0.42) || n > 0.8 - foam * 0.02) return n > 0.62 && !body(u - 1, v - 1) ? WHITE : n > 0.7 ? WHITE : PAL.ice[2]
    }
    const b = body(u, v)
    if (b) return b
    const t = tyre(u - REAR_X, v - G.axleY) || tyre(u - FRONT_X, v - G.axleY)
    if (t) return t
    return chassis(u, v)
  }
}

/* ------------------------------------------------------------------ */
/* What it throws                                                      */
/* ------------------------------------------------------------------ */

function raster(w, h, fn) {
  const c = new Canvas(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x + 0.5, y + 0.5)
    if (v) c.set(x, y, v)
  }
  return c
}

/** A falling clod: a lump of mud with a highlight and streaks above it. 26 x 30, anchored at its feet. */
function clod(frame) {
  const c = raster(26, 30, (x, y) => {
    const cx = 13
    const cy = 19
    const wob = frame ? 0.6 : -0.6
    const r = 9.5 + 1.6 * Math.sin(Math.atan2(y - cy, x - cx) * 5 + wob * 2) * 0.5
    const d = Math.hypot(x - cx, y - cy)
    if (d <= r) {
      if (Math.hypot(x - cx + 4, y - cy + 4) < 3.2) return MUD[4]
      if (Math.hypot(x - cx + 2.5, y - cy + 2.5) < r - 3.5 && !(Math.hypot(x - cx - 2, y - cy - 2) < r - 4)) return MUD[3]
      if (Math.hypot(x - cx + 2.2, y - cy + 2.2) > r) return MUD[3]
      return d > r - 2.4 && x + y > cx + cy ? MUD[1] : MUD[2]
    }
    // Two drops of mud trailing above it.
    for (const [dx, dy, rr] of [[-3, -14, 2.2], [3, -19 + (frame ? 1 : 0), 1.6]]) {
      if (Math.hypot(x - cx - dx, y - cy - dy) <= rr) return MUD[3]
    }
    return 0
  })
  c.outline(O)
  return c
}

/** A glob of grime in flight: a blob balled up, eyes squeezed, about to land and walk. 26 x 26. */
function glob(frame) {
  const c = raster(26, 26, (x, y) => {
    const cx = 13
    const cy = 13
    const sq = frame ? 1.15 : 0.88
    const dx = (x - cx) / sq
    const dy = (y - cy) * sq
    const d = Math.hypot(dx, dy)
    if (d > 9.5) return 0
    if (Math.hypot(dx + 3.5, dy + 3.5) < 2.6) return MUD[4]
    if (Math.hypot(dx + 2.5, dy + 2.5) > 9.5) return MUD[3]
    return d > 7.5 && dx + dy > 0 ? MUD[1] : MUD[2]
  })
  // Eyes shut tight, '> <'.
  const eyes = frame ? [[9, 12], [15, 12]] : [[9, 11], [15, 11]]
  for (const [ex, ey] of eyes) {
    c.set(ex, ey, O)
    c.set(ex + 1, ey + 1, O)
    c.set(ex, ey + 2, O)
  }
  c.outline(O)
  return c
}

/**
 * The shockwave of a slam: a breaking wave of mud rolling along the floor, its crest curling
 * forward over a hollow, a cap of pale froth and grit flung ahead. 44 x 30, faces right, anchored
 * at its feet; the hurting part (30 x 20 in the sim) is the solid body from x 8 to 38 up to y 10.
 * Pale on top so it reads against the dark tunnel floor at a glance.
 */
function wave(frame) {
  const W = 44
  const G = 29
  const k = frame / 3
  const crestX = 31 + Math.round(Math.sin(k * Math.PI * 2))
  const crestH = 21 + Math.round(Math.cos(k * Math.PI * 2))
  /** Height of the wave's back slope at x: a low tail rising to the crest. */
  const slope = (x) => {
    if (x < 4) return 0
    const t = Math.min(1, (x - 4) / (crestX - 4))
    return 3 + (crestH - 3) * (t * t * (3 - 2 * t))
  }
  const c = raster(W, G + 1, (x, y) => {
    const h = G - y
    if (h < 0) return 0
    // The lip: the top of the crest thrown forward over the hollow, curling down at its tip.
    const lipX0 = crestX - 4
    const lipX1 = crestX + 8 + frame
    const lipTop = crestH + 1 - Math.max(0, x - crestX) * 0.35
    const lipBot = crestH - 5 - Math.max(0, x - crestX) * 1.1
    if (x >= lipX0 && x <= lipX1 && h <= lipTop && h >= lipBot) return h > lipTop - 2.5 ? PAL.wood[8] : h > lipTop - 4.5 ? PAL.wood[7] : MUD[4]
    // The face under the lip: steep, with a dark hollow in it.
    if (x > crestX && x <= crestX + 6) {
      const face = crestH - 6 - (x - crestX) * 2.6
      if (h > face) return 0
      if (h > 4 && x > crestX + 1 && h > face - 6) return MUD[0]
      return h < 3 ? MUD[1] : MUD[2]
    }
    if (x > crestX + 6) return 0
    const top = slope(x)
    if (h > top) return 0
    // Froth along the top of the back slope, pale and broken.
    if (h > top - 2 && x > 10) return (x + frame * 3) % 7 < 2 ? MUD[4] : PAL.wood[7]
    if (h > top - 4 && x > 14) return MUD[4]
    if (h < 3) return MUD[1]
    // Streaks sweeping up toward the crest.
    const streak = (x * 0.55 - h + frame * 4) % 9
    if (streak > -0.5 && streak < 1 && x > 6) return MUD[3]
    return x < crestX - 10 ? MUD[2] : MUD[3]
  })
  // Grit and clumps flung ahead of the crest, and a spit of froth over it.
  const bits = [
    [[39, 14, 3], [42, 7, 2], [37, 3, 2]],
    [[40, 11, 3], [43, 4, 2], [38, 1, 2]],
    [[41, 15, 2], [41, 6, 3], [36, 2, 2]],
  ][frame % 3]
  for (const [x, y, s] of bits) c.rect(x - 1, y, s, s, s > 2 ? MUD[3] : PAL.wood[7])
  const out = new Canvas(W + 2, G + 3)
  out.blit(c, 1, 1)
  out.outline(O)
  return out
}

/** Outline a tile that repeats sideways, wrapping round, so neighbours join without a seam. */
function wrapOutline(c) {
  const wide = new Canvas(c.w + 2, c.h)
  wide.blit(c, 1, 0)
  wide.blit(c, 1 - c.w, 0)
  wide.blit(c, 1 + c.w, 0)
  wide.outline(O)
  const o = new Canvas(c.w, c.h)
  o.blit(wide, -1, 0)
  return o
}

/**
 * The tyre spray: one 32 px stretch of a jet of mud flung low and forward, tiled along the fan
 * (the renderer scrolls it the way the mud flies). 32 x 34; the hurting part is the bottom 30.
 * A churned bank along the floor, a thick rope of mud above it, clumps and streaks flying in it,
 * and a ragged top edge of flung clods: a wall of mud you would not walk into.
 */
function spray(frame) {
  const c = new Canvas(32, 34)
  const base = 33
  for (let x = 0; x < 32; x++) {
    // The rope of mud: a wavy band riding over the bank, darker underneath.
    const wob = 3 * Math.sin(((x + frame * 11) / 32) * Math.PI * 2) + 1.5 * Math.sin(((x * 3 + frame * 7) / 32) * Math.PI * 2)
    const top = Math.round(12 + wob)
    const bot = Math.round(22 + wob * 0.5)
    for (let y = top; y <= bot; y++) c.set(x, y, y <= top + 1 ? MUD[4] : y >= bot - 1 ? MUD[1] : MUD[3])
    // The churned bank on the floor.
    const bank = 6 + Math.round(2 * Math.sin(((x * 2 + frame * 9) / 32) * Math.PI * 2))
    for (let y = base - bank; y <= base; y++) c.set(x, y, y === base - bank ? MUD[4] : y > base - 2 ? MUD[1] : MUD[2])
  }
  // Clods flung in the jet, each trailing a streak behind it (the mud flies to the right).
  for (let i = 0; i < 9; i++) {
    const x = (i * 13 + frame * 11) % 32
    const y = 4 + ((i * 7 + frame * 5) % 24)
    const size = i % 3 === 0 ? 3 : 2
    c.rect(x, y, size, size, i % 2 ? MUD[4] : MUD[3])
    for (let k = 1; k <= 3 + (i % 3); k++) c.set((x - k + 32) % 32, y + (size >> 1), k < 3 ? MUD[3] : MUD[2])
  }
  return wrapOutline(c)
}

/**
 * The warning before the spray: chevrons painted along the floor it will hit, pointing the way the
 * mud will fly. Orange and yellow like the landing shadows: everything that marks where it hurts
 * wears those two colours. 32 x 12, points right; frame 1 is the lit one (the renderer blinks them).
 */
function flecks(frame) {
  const c = new Canvas(32, 12)
  const fill = frame ? PAL.yellow[2] : PAL.orange[1]
  const edge = frame ? PAL.orange[1] : PAL.orange[0]
  for (const x0 of [4, 20]) {
    for (let k = 0; k <= 4; k++) {
      // A > of two strokes, 3 px thick, 10 px tall.
      c.rect(x0 + k, 1 + k, 4, 1, k === 0 ? edge : fill)
      c.rect(x0 + k, 10 - k, 4, 1, fill)
    }
  }
  return wrapOutline(c)
}

/** The steel shutter it drops into the arena's doorway: 32 x 64, slats and a hazard stripe. */
function shutter() {
  const c = new Canvas(32, 64)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 32; x++) {
      let col = (y % 8) < 1 ? CHROME.dark : (y % 8) < 2 ? CHROME.shine : (y % 8) > 6 ? CHROME.mid : CHROME.light
      if (x < 2 || x > 29) col = RUBBER.light
      if (y >= 52 && y < 60) col = ((x + y) >> 2) % 2 ? STRIPE.mid : RUBBER.deep
      if (y >= 60) col = y > 62 ? RUBBER.deep : RUBBER.mid
      c.set(x, y, col)
    }
  }
  // A handle.
  c.rect(12, 46, 8, 3, RUBBER.deep)
  c.rect(13, 46, 6, 1, CHROME.shine)
  return c
}

/* ------------------------------------------------------------------ */
/* The atlas                                                           */
/* ------------------------------------------------------------------ */

/** Front axle lift of each pitch frame, px (negative: nose down). */
const PITCH = [-8, 0, 12, 26, 44]
const FACES = ['mean', 'blink', 'grit', 'roar', 'flinch', 'pant0', 'pant1', 'nervous']
const thetaOf = (lift) => Math.asin(lift / WHEELBASE)
const BODY_WIN = [-6, -40, 210, 112]
const CHASSIS_WIN = [8, 80, 196, 122]
const FACE_WIN = [140, 30, 206, 132]

const atlas = new Atlas('mudzilla', { script: 'art-mudzilla.mjs' })
/** name -> frames [{ label, canvas, ax, ay }] for the review sheets. */
const shown = {}
function add(name, f) {
  atlas.add(name, f.canvas, { ax: f.ax, ay: f.ay })
  return f
}
function anim(name, frames) {
  atlas.addAnim(name, frames.map((f) => ({ canvas: f.canvas, ax: f.ax, ay: f.ay })))
  shown[name] = frames.map((f, i) => ({ ...f, label: `${name}${i}` }))
}

const axles = []
for (let p = 0; p < PITCH.length; p++) {
  const th = thetaOf(PITCH[p])
  // Where the front hub goes when the nose is up, relative to the feet.
  const fx = REAR_X + WHEELBASE * Math.cos(th)
  const fy = BIG.axleY - WHEELBASE * Math.sin(th)
  axles.push({ rear: [REAR_X - 100, BIG.axleY - 150], front: [Math.round(fx - 100), Math.round(fy - 150)] })
}

const parts = {}
for (const stage of [1, 2, 3]) {
  for (let p = 0; p < PITCH.length; p++) {
    const theta = thetaOf(PITCH[p])
    parts[`chassis${stage}_${p}`] = add(`chassis${stage}_${p}`, render(chassisColour(stage), { theta, win: CHASSIS_WIN }))
    parts[`body${stage}_${p}`] = add(`body${stage}_${p}`, render(bodyColour(stage), { theta, win: BODY_WIN }))
    for (const expr of FACES) {
      parts[`face${stage}_${expr}_${p}`] = add(`face${stage}_${expr}_${p}`, render(faceColour(stage, expr), { theta, win: FACE_WIN }))
    }
  }
  const tyres = [0, 1, 2, 3].map((phase) => renderTyre(stage, phase, false))
  anim(`tyre${stage}`, tyres)
  anim(`tyre${stage}Blur`, [renderTyre(stage, 0, true), renderTyre(stage, 2, true)])
}
for (const stage of [1, 2, 3]) {
  shown[`body${stage}`] = PITCH.map((_, p) => ({ ...parts[`body${stage}_${p}`], label: `p${p}` }))
  shown[`chassis${stage}`] = PITCH.map((_, p) => ({ ...parts[`chassis${stage}_${p}`], label: `p${p}` }))
  for (const expr of FACES) shown[`face${stage}_${expr}`] = PITCH.map((_, p) => ({ ...parts[`face${stage}_${expr}_${p}`], label: `p${p}` }))
}

// The finish: dazed and dripping, three steps of shrinking (mud and lift falling away), then a
// plain pickup that is sheepish, then delighted (two frames for the honk).
const SMALL = { scale: 0.62, R: 30, lift: 10 }
const shrinkG = (k) => geom({ R: 33 - 3 * (k / 4), lift: 25 - 15 * (k / 4) })
const shrinkScale = (k) => 1 - (1 - SMALL.scale) * (k / 4)
anim('finDazed', [0, 1].map((i) => render(wholeColour(3, 'dazed', BIG, { foam: 1 + i, phase: i }), {})))
// The face keeps its size while the truck shrinks under it, so the little truck ends up wearing a
// cartoon-sized face it can be read by at 1x.
const faceGrow = (k) => ({ eye: 1 / shrinkScale(k) ** 0.75, mouth: [1 / shrinkScale(k) ** 0.35, 1 / shrinkScale(k) ** 0.3] })
anim('finShrink', [1, 2, 3].map((k) => render(wholeColour(k < 2 ? 3 : 0, 'dazed', shrinkG(k), { foam: 3 - k + 1, face: faceGrow(k) }), { scale: shrinkScale(k), pivot: [REAR_X, shrinkG(k).axleY] })))
const smallG = shrinkG(4)
anim('smallSheep', [render(wholeColour(0, 'sheep', smallG, { face: faceGrow(4) }), { scale: SMALL.scale, pivot: [REAR_X, smallG.axleY] })])
anim('smallHappy', [0, 1].map((i) => render(wholeColour(0, 'happy', smallG, { phase: i * 2, face: faceGrow(4) }), { scale: SMALL.scale, pivot: [REAR_X, smallG.axleY], theta: i ? thetaOf(4) : 0 })))

const anchorFoot = (c, ax, ay) => ({ canvas: c, ax, ay })
anim('clod', [0, 1].map((f) => anchorFoot(clod(f), 13, 30)))
anim('glob', [0, 1].map((f) => anchorFoot(glob(f), 13, 23)))
anim('wave', [0, 1, 2].map((f) => anchorFoot(wave(f), 24, 31)))
anim('spray', [0, 1, 2].map((f) => anchorFoot(spray(f), 0, 34)))
anim('flecks', [0, 1].map((f) => anchorFoot(flecks(f), 0, 12)))
anim('shutter', [anchorFoot(shutter(), 0, 0)])

atlas.meta({
  facing: 'Everything faces right. Draw with flipX when entity.facing is -1: frames are anchored so a flip mirrors about the box.',
  anchor: 'chassis*, body*, face*, fin*, small*: the feet of the box (e.x + e.w / 2, e.y + e.h). tyre*: the hub. clod, glob, wave: their feet. spray, flecks: bottom-left, tile them along the fan box. shutter: top-left of its box.',
  order: 'chassis<stage>_<pitch>, tyre (rear), tyre (front), body<stage>_<pitch>, face<stage>_<expr>_<pitch>',
  pitch: PITCH,
  pitchNote: 'Front axle lift in px of each pitch frame (index 0..4). Pick the nearest to vars.pitch.',
  axles,
  axlesNote: 'Hub of the rear and front tyre, per pitch frame, relative to the feet, facing right (negate x when flipped).',
  faces: FACES,
  tyreTurnPx: Math.round(((Math.PI * 2 * BIG.R) / LUGS / 4) * 100) / 100,
  tyreNote: 'tyre<stage>: 4 frames, each a quarter of a tread lug further round; one frame per tyreTurnPx of vars.spin. tyre<stage>Blur: spinning flat out, 2 frames.',
  bodyDrop: 'vars.sink moves body, face and chassis down (the springs squash); the tyres stay.',
  finish: 'finDazed (2 frames, alternate every 8 ticks), finShrink (3: vars.size 1..3), smallSheep (vars.size 4, until happy), smallHappy (2: the honk bounce).',
  small: { w: Math.round(200 * SMALL.scale), h: Math.round((150 - (smallG.bottom - 78)) * SMALL.scale) },
  ticks: { clod: [4, 4], glob: [5, 5], wave: [4, 4, 4], spray: [3, 3, 3], flecks: [5, 5] },
})

const built = atlas.pack()
const stray = checkPalette(built)
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write()
console.log(`mudzilla atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames`)

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

/** The truck put together exactly as the renderer does it. */
function assemble(stage, p, expr, { sink = 0, turn = 0, blur = false } = {}) {
  const W = 300
  const Hh = 260
  const fx = 150
  const fy = 220
  const c = new Canvas(W, Hh)
  const put = (f, x, y) => c.blit(f.canvas, x - f.ax, y - f.ay)
  put(parts[`chassis${stage}_${p}`], fx, fy + sink)
  const tyre = shown[blur ? `tyre${stage}Blur` : `tyre${stage}`][turn % (blur ? 2 : 4)]
  put(tyre, fx + axles[p].rear[0], fy + axles[p].rear[1])
  put(tyre, fx + axles[p].front[0], fy + axles[p].front[1])
  put(parts[`body${stage}_${p}`], fx, fy + sink)
  put(parts[`face${stage}_${expr}_${p}`], fx, fy + sink)
  const t = c.trim()
  return { canvas: t.canvas, ax: fx - t.x, ay: fy - t.y }
}

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const BACKS = { night: '#1a1033', tunnel: '#2e1f5e', floor: '#1b2253' }
  const sheet = (name, rows, opts = {}) => {
    for (const [bg, col] of Object.entries(BACKS)) {
      contactSheet(rows, { bg: col, scale: 3, wrap: 6, file: path.join(REVIEW, `${name}_${bg}_3x.png`), ...opts })
      contactSheet(rows, { bg: col, scale: 1, wrap: 6, labels: false, file: path.join(REVIEW, `${name}_${bg}_1x.png`), ...opts })
    }
    contactSheet(rows, { bg: BACKS.tunnel, scale: 3, wrap: 6, flipX: true, file: path.join(REVIEW, `${name}_tunnel_flip_3x.png`), ...opts })
    contactSheet(rows, { bg: BACKS.tunnel, scale: 1, wrap: 6, flipX: true, labels: false, file: path.join(REVIEW, `${name}_tunnel_flip_1x.png`), ...opts })
  }
  // Every state of the fight, assembled: [label, stage, pitch, expr, sink, blur].
  const POSES = [
    ['sleep', 1, 1, 'blink', 5],
    ['idle', 1, 1, 'mean', 0],
    ['stompTell', 1, 3, 'grit', 0],
    ['hitch', 1, 4, 'roar', 0],
    ['slam', 1, 0, 'roar', 4],
    ['rainTell', 1, 0, 'grit', 5, true],
    ['rain', 1, 2, 'roar', 0],
    ['blobTell', 1, 1, 'grit', 4],
    ['spinTell', 1, 0, 'grit', 6, true],
    ['hopTell', 1, 1, 'grit', 15],
    ['hop up', 1, 2, 'roar', -8],
    ['sprayed', 1, 1, 'flinch', 0],
    ['winded', 1, 1, 'pant0', 7],
    ['winded', 1, 1, 'pant1', 7],
    ['roar', 1, 3, 'roar', 0],
  ]
  for (const stage of [1, 2, 3]) {
    const rows = [{ label: `stage ${stage}: every state`, frames: POSES.map(([label, , p, expr, sink, blur]) => ({ ...assemble(stage, p, stage === 3 && expr === 'mean' ? 'nervous' : expr, { sink, blur }), label })) }]
    sheet(`poses_stage${stage}`, rows, { wrap: 7 })
  }
  sheet('parts_bodies', [1, 2, 3].flatMap((s) => [{ label: `body${s}`, frames: shown[`body${s}`] }, { label: `chassis${s}`, frames: shown[`chassis${s}`] }]), { wrap: 5 })
  sheet('parts_faces', [1, 2, 3].flatMap((s) => FACES.map((e) => ({ label: `face${s} ${e}`, frames: shown[`face${s}_${e}`] }))), { wrap: 5 })
  sheet('parts_tyres', [1, 2, 3].flatMap((s) => [{ label: `tyre${s}`, frames: shown[`tyre${s}`] }, { label: `tyre${s}Blur`, frames: shown[`tyre${s}Blur`] }]), { wrap: 4 })
  sheet('finish', ['finDazed', 'finShrink', 'smallSheep', 'smallHappy'].map((n) => ({ label: n, frames: shown[n] })), { wrap: 4 })
  sheet('throws', ['clod', 'glob', 'wave', 'spray', 'flecks', 'shutter'].map((n) => ({ label: n, frames: shown[n] })), { wrap: 4 })

  // Beside Maxx, on the arena floor, at 1x and 3x.
  const maxxTs = fs.readFileSync(path.join(ASSETS_DIR, 'maxx.atlas.ts'), 'utf8')
  const m = /idle0: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (\d+), ay: (\d+) \}/.exec(maxxTs)
  const maxxSheet = Canvas.load(path.join(ASSETS_DIR, 'maxx.png'))
  const hero = m ? { canvas: maxxSheet.crop(+m[1], +m[2], +m[3], +m[4]), ax: +m[5], ay: +m[6] } : null
  for (const [bgName, bg] of Object.entries(BACKS)) {
    const scene = new Canvas(640, 260, bg)
    const gy = 228
    scene.rect(0, gy, 640, 32, '#1b2253')
    scene.rect(0, gy, 640, 3, '#5b3fa0')
    const put = (f, x, y, flip = false) => scene.blit(f.canvas, flip ? x - (f.canvas.w - f.ax) : x - f.ax, y - f.ay, { flipX: flip })
    if (hero) put(hero, 60, gy)
    put(assemble(1, 1, 'mean'), 250, gy, true)
    put(assemble(2, 3, 'grit'), 470, gy, true)
    put(shown.clod[0], 120, 120)
    put(shown.glob[1], 150, 150)
    put(shown.wave[1], 140, gy)
    put(shown.smallHappy[0], 590, gy, true)
    scene.save(path.join(REVIEW, `lineup_${bgName}_1x.png`))
    scene.scale(3).save(path.join(REVIEW, `lineup_${bgName}_3x.png`))
  }
  console.log(`review sheets in ${REVIEW}`)
}
