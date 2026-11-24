// art-hud.mjs: generates the 'hud' atlas, the small icons the play scene's HUD, banners,
// level card, versus card and tally are built from.
//
//   node scripts/maxx/art-hud.mjs                    writes hud.png + hud.atlas.ts
//   node scripts/maxx/art-hud.mjs --review <dir>     also writes contact sheets into <dir>: every
//       frame at 1x and 4x on the four backgrounds a HUD has to survive (sky, tunnel wall,
//       snow, night), and a mock top row at 1x and 3x
//
// Everything is anchored at its top-left unless the table at the bottom says otherwise.
// The icons are drawn for the top edge of a 640x360 screen seen from a couch: one idea
// each, a warm near-black outline, two or three flat shades, light from the top left.

import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const K = PAL.outline
const LEGEND = {
  K,
  N: PAL.navy,
  w: PAL.grey[6],
  0: PAL.grey[0], 1: PAL.grey[1], 2: PAL.grey[2], 3: PAL.grey[3], 4: PAL.grey[4], 5: PAL.grey[5],
  d: PAL.blue[0], B: PAL.blue[1], b: PAL.blue[2], c: PAL.blue[3], i: PAL.blue[4],
  Q: PAL.red[1], R: PAL.red[2], r: PAL.red[3], q: PAL.red[4], p: PAL.red[5],
  o: PAL.yellow[0], y: PAL.yellow[1], Y: PAL.yellow[2],
  U: PAL.mud[0], M: PAL.mud[1], m: PAL.mud[2], n: PAL.mud[3], u: PAL.mud[4],
  J: PAL.ice[0], j: PAL.ice[1], I: PAL.ice[2],
  T: PAL.teal[0], t: PAL.teal[1], s: PAL.teal[2],
  P: PAL.orange[0], O: PAL.orange[1], h: PAL.orange[2],
  G: PAL.green[2], g: PAL.green[1], e: PAL.green[3], E: PAL.green[0],
  F: PAL.wood[3], f: PAL.wood[5], A: PAL.wood[6], a: PAL.wood[7],
  k: PAL.pink[0],
}
const art = (rows) => {
  const w = Math.max(...rows.map((r) => r.length))
  for (const r of rows) if (r.length !== w) throw new Error(`art-hud: ragged row "${r}" (${r.length}, want ${w})`)
  return Canvas.fromText(rows, LEGEND)
}

/**
 * A round badge lit from the top left: outline, body, a light crescent up left and a shade
 * crescent down right. `size` across; an even size sits on a half-pixel centre.
 */
function orb(size, { rim = K, body, light, shade, ring }) {
  const c = new Canvas(size, size)
  const m = (size - 1) / 2
  const R = size / 2 - 0.5
  c.circle(m, m, R, rim)
  let inner = R - 1
  if (ring) {
    c.circle(m, m, inner, ring)
    inner -= 1
  }
  const inside = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= (r + 0.5) ** 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y, m, m, inner)) continue
      let col = body
      if (shade && !inside(x, y, m - 1.5, m - 1.5, inner)) col = shade
      else if (light && !inside(x, y, m + 1.5, m + 1.5, inner)) col = light
      c.set(x, y, col)
    }
  }
  return c
}

/** A four-point sparkle, `r` pixels from its middle to a tip, drawn into `c` around (cx, cy). */
function sparkle(c, cx, cy, r, core, tip = core) {
  for (let k = -r; k <= r; k++) {
    const col = Math.abs(k) > r - 2 && r > 2 ? tip : core
    c.set(cx + k, cy, col)
    c.set(cx, cy + k, col)
  }
  if (r >= 3) {
    c.rect(cx - 1, cy - 1, 3, 3, core)
  }
  return c
}

/* ------------------------------------------------------------------ */
/* Shine pips: his health. Full is a gleaming blue bead, lost is mud.   */
/* ------------------------------------------------------------------ */

const PIP = 18
function pipFull() {
  const c = orb(PIP, { body: PAL.blue[2], light: PAL.blue[3], shade: PAL.blue[1] })
  sparkle(c, 7, 7, 4, PAL.grey[6], PAL.blue[4])
  c.set(12, 12, PAL.blue[4])
  c.set(13, 11, PAL.blue[4])
  return c
}
function pipEmpty() {
  const c = orb(PIP, { body: PAL.mud[1], light: PAL.mud[2], shade: PAL.mud[0] })
  // Clods, so it reads as dirt and not as a dark bead.
  c.rect(5, 6, 3, 2, PAL.mud[3])
  c.rect(6, 5, 2, 1, PAL.mud[3])
  c.rect(10, 9, 3, 2, PAL.mud[0])
  c.rect(7, 12, 2, 2, PAL.mud[0])
  c.set(11, 5, PAL.mud[3])
  return c
}
/** The frame a pip shows for an instant as it is lost or won back: all white inside its outline. */
function pipFlash() {
  return orb(PIP, { body: PAL.grey[6] })
}
/** The last pip, when it is all he has: the same bead in alarm red, to alternate with the blue one. */
function pipWarn() {
  const c = orb(PIP, { body: PAL.red[4], light: PAL.red[5], shade: PAL.red[2] })
  sparkle(c, 7, 7, 4, PAL.grey[6], PAL.red[5])
  return c
}

/* ------------------------------------------------------------------ */
/* Counters                                                            */
/* ------------------------------------------------------------------ */

/** A wash token, as the world draws it (items/coin0): a pale face in a brand-blue rim, stamped MW. */
function coin() {
  const c = orb(16, { body: PAL.ice[0], light: PAL.grey[6], shade: PAL.ice[1], ring: PAL.blue[2] })
  const MW = ['B...B.B...B', 'BB.BB.B...B', 'B.B.B.B.B.B', 'B...B.BB.BB', 'B...B.B...B']
  MW.forEach((row, y) => [...row].forEach((ch, x) => ch === 'B' && c.set(3 + x, 6 + y, PAL.navy)))
  return c
}

function starPoints(cx, cy, outer, inner, n = 5, turn = -Math.PI / 2) {
  const pts = []
  for (let k = 0; k < n * 2; k++) {
    const r = k % 2 === 0 ? outer : inner
    const a = turn + (k * Math.PI) / n
    pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)])
  }
  return pts
}

/** One of the level's three gold tokens, found. */
function tokenOn() {
  const c = orb(16, { body: PAL.yellow[1], light: PAL.yellow[2], shade: PAL.yellow[0] })
  c.poly(starPoints(7.5, 7.8, 5, 2.2), PAL.grey[6])
  c.poly(starPoints(7.5, 7.8, 5, 2.2), PAL.yellow[0], { fill: false })
  c.poly(starPoints(7.5, 7.8, 3.4, 1.5), PAL.grey[6])
  return c
}
/** ... and its empty socket. */
function tokenOff() {
  const c = orb(16, { body: PAL.navy, ring: PAL.grey[3], shade: PAL.blue[0] })
  c.poly(starPoints(7.5, 7.8, 4, 1.8), PAL.grey[2], { fill: false })
  return c
}

/** A washed car, for the cars counter. */
const car = art([
  '........KKKKKKKKKK......',
  '......KKciiKciiiicKK....',
  '.....KrKciiKciiiiicKK...',
  '....KrrKcccKccccccKrK...',
  '.KKKrrrrrrrrrrrrrrrrrKK.',
  'KqqqrrrrrrrrrrrrrrrrrrrK',
  'KYYrrrrrrrrrrrrrrrrrrrRK',
  'KRRRKKKKRRRRRRRRKKKKRRRK',
  '.KKK2442KKKKKKKK2442KKK.',
  '...K4224K......K4224K...',
  '....KKKK........KKKK....',
])

function clock(ringCol, hand) {
  const c = new Canvas(15, 17)
  // The button on top makes it a stopwatch, which is what the level clock is.
  c.rect(5, 0, 5, 3, K)
  c.rect(6, 1, 3, 1, PAL.grey[4])
  c.circle(7, 9, 7, K)
  c.circle(7, 9, 6, ringCol)
  c.circle(7, 9, 4.5, PAL.grey[6])
  for (let y = 0; y < 17; y++) for (let x = 0; x < 15; x++) if (c.get(x, y) === c.get(7, 9) && (x - 5.5) ** 2 + (y - 7.5) ** 2 > 5 ** 2) c.set(x, y, PAL.grey[5])
  c.rect(7, 5, 1, 5, hand)
  c.rect(7, 9, 4, 1, hand)
  return c
}

/** The turbo nozzle: the brass tip of his lance throwing three hard jets. */
const turbo = art([
  '.......KKKKK..KKKK..',
  '......KYYYyoKKwwwwK.',
  '......KYyyyoK.KKKK..',
  'KKKKKKKYyyyoK.......',
  'K554444KyyyoKKKKKKK.',
  'K443333KyyyoKwwwwwwK',
  'KKKKKKKKyyyoKKKKKKK.',
  '......KYyyyoK.......',
  '......KYyyyoK.KKKK..',
  '......KyyyooKKwwwwK.',
  '.......KKKKK..KKKK..',
])

/** A tin of Mighty Wax, for the wax timer. */
const wax = art([
  '.KKKKKKKKKK.',
  'KpqqqqqqqqRK',
  'KqqqqqqqqrRK',
  'KRRRRRRRRRRK',
  '.KKKKKKKKKK.',
  '.KYyyyyyyoK.',
  '.KYNyyyNyoK.',
  '.KYNyyyNyoK.',
  '.KYNyNyNyoK.',
  '.KYNNyNNyoK.',
  '.KYNyyyNyoK.',
  '.KYyyyyyyoK.',
  '.KooooooooK.',
  '..KKKKKKKK..',
])

/** A drop of water, for the hover meter. */
const drop = art([
  '....K....',
  '...KsK...',
  '...KsK...',
  '..KstsK..',
  '..KwttK..',
  '.KwstttK.',
  '.KwttttK.',
  'KsttttTTK',
  'KtttttTTK',
  '.KtttTTK.',
  '..KKKKK..',
])

/** The face on the boss bar: a glowering clod. */
const boss = art([
  '.....KKKKKK.....',
  '...KKnnnnnnKK...',
  '..KnuunnnnnnmK..',
  '.KnuunnnnnnnnmK.',
  '.KKKnnnnnnnKKKK.',
  'KnwwKKnnnKKwwnmK',
  'KnwKwwKnKwwKwnmK',
  'KnwKwwnnnwwKwnmK',
  'KnnwwnnnnnwwnnmK',
  'KnnnnnnnnnnnnmmK',
  'KnnKKKKKKKKKnnmK',
  'KnKwKwwKwwKwKnmK',
  'KnnKKKKKKKKKnmmK',
  '.KmnnnnnnnnmmMK.',
  '..KKmmmmmmMMKK..',
  '....KKKKKKKK....',
])

// The clod suits both mud bosses; each rival gets his own head on the bar, so the name over
// the bar and the face beside it agree. Drawn from their sprites (art-rivals-a/b), face on.

/** BUCKET BILL: the tin bucket under his sponge hat, wide eyes, a grin, the tide of dirt round his foot. */
const bossBill = art([
  '....KKKKKKKKK...',
  '...KYYYYYYYYyK..',
  '..KYyoyyyyoyyoK.',
  'KKKKKKKKKKKKKKKK',
  'Kw5555555554433K',
  'KKKKKKKKKKKKKKKK',
  '.K54KKK44KKK33K.',
  '.K54wwK44wwK33K.',
  '.K54wwK44wwK32K.',
  '.K54www44www32K.',
  '.K544444444432K.',
  '..K4K444444K3K..',
  '..K44KwwwwK43K..',
  '..K444KppK443K..',
  '..Kmmm4KK4mmMK..',
  '...KKKKKKKKKK...',
])

/** SIR STREAKS: the helmet, its squeegee crest, and his face in the opening with that moustache. */
const bossStreaks = art([
  '..KKKKKKKKKKKK..',
  '..K2111111111K..',
  '..KYYYYYyyyyoK..',
  '...KKKKYoKKKK...',
  '.....KKYoKK.....',
  '...KKw55444KK...',
  '..Kw555444433K..',
  '.Kw52222222233K.',
  '.K52AMMAAMMA23K.',
  '.K52AwKAAwKA23K.',
  '.K42AAAafAAA23K.',
  '.K42MAAafAAM23K.',
  '.K42AMMMMMMA23K.',
  '.K42fAAKKAAf22K.',
  '..K3222222223K..',
  '...KKKKKKKKKK...',
])

/** SLICK OLLIE: the green can, the oiled pompadour over a brass band, the spout nose, the bow tie. */
const bossOllie = art([
  '...KKKKKKKK.....',
  '..K002BBBB0KK...',
  '.K0002BcBB000K..',
  '.K0000000000000K',
  '..KaaaaaaaaAK0K.',
  '..KeGGGGGGggK...',
  '..KeKKKGKKKgK...',
  '..KewwKGwwKgK...',
  '..KeGGGGGGgKKKK.',
  '..KeGGGGGaaaaa4K',
  '..KeGGGGFFFFFKK.',
  '..KeGKKKKGggK...',
  '..KeGGGGGGggK...',
  '..KekkKRKkkgK...',
  '..KEkkKKKkkEK...',
  '...KKKKKKKKK....',
])

/** NIMBUS NICK: a puffed cloud lit from the top left, dark underneath, sunglasses, one brow up, a smirk. */
function bossNick() {
  const c = new Canvas(16, 16)
  const puffs = [[5.4, 5.4, 3.3], [10.2, 4.6, 3.7], [3.4, 9.2, 2.9], [12.6, 9, 2.9], [8, 9.2, 5]]
  const inCloud = (x, y) => y <= 13.6 && puffs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const px = x + 0.5
      const py = y + 0.5
      if (!inCloud(px, py)) continue
      let col = PAL.grey[4]
      if (!inCloud(px - 1.2, py - 1.2)) col = PAL.grey[5]
      if (!inCloud(px - 0.6, py - 1.6) && !inCloud(px - 1.6, py - 0.6)) col = PAL.grey[6]
      if (py > 10.5) col = PAL.grey[3]
      if (py > 12.5) col = PAL.grey[2]
      if (!inCloud(px, py + 1)) col = PAL.purple[1]
      c.set(x, y, col)
    }
  }
  c.outline(K)
  c.blit(art(['KKKKKKKKKK', 'Kc0K..Kc0K', 'K00K..K00K', '.KK....KK.']), 3, 5)
  c.blit(art(['KKKK']), 9, 4)
  c.blit(art(['......K', '.KwwwwK', '..KKKK.']), 5, 10)
  return c
}

/** A wash station flag, for the checkpoint notice. */
const flag = art([
  '.KKK..........',
  'K5w4K.........',
  '.K4KKKKKKK....',
  '.K4KcbbbbbKK..',
  '.K4KcbbwbbbbKK',
  '.K4KcbwwwbbbBK',
  '.K4KcbwwwbBBK.',
  '.K4KcbbbBBK...',
  '.K4KKKKKKK....',
  '.K4K..........',
  '.K4K..........',
  '.K4K..........',
  '.K3K..........',
  'KK3KK.........',
  'K432K.........',
  'KKKKK.........',
])

/** A gold star: SPOTLESS, a new best. */
function star(size = 15) {
  const c = new Canvas(size, size)
  const m = (size - 1) / 2
  const pts = starPoints(m, m + 0.6, m - 1, (m - 1) * 0.45)
  c.poly(pts, PAL.yellow[1])
  // Light on the upper left half, shade along the lower right arms.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!c.solid(x, y)) continue
      if (x + y < size - 4) c.set(x, y, PAL.yellow[2])
      else if (x + y > size + 4) c.set(x, y, PAL.yellow[0])
    }
  }
  c.outline(K)
  return c
}

/** Sparkles for SPOTLESS and for a pip coming back: three sizes of the same glint, to play 0 1 2 1 0. */
function spark(r) {
  const size = 2 * r + 3
  const c = new Canvas(size, size)
  sparkle(c, r + 1, r + 1, r, PAL.grey[6], r > 2 ? PAL.blue[4] : PAL.grey[6])
  c.outline(PAL.blue[1])
  return c
}

/* ------------------------------------------------------------------ */
/* Banner and card dressing                                            */
/* ------------------------------------------------------------------ */

/** A mud splat: a body of overlapping blobs with flung drops round it. */
function splat(w, h, blobs) {
  const c = new Canvas(w, h)
  for (const [x, y, rx, ry = rx] of blobs) c.ellipse(x, y, rx, ry, PAL.mud[1])
  // Light catches the upper left of each blob.
  for (const [x, y, rx, ry = rx] of blobs) {
    if (rx < 4) continue
    c.ellipse(x - rx * 0.3, y - ry * 0.35, Math.max(1, rx * 0.35), Math.max(1, ry * 0.25), PAL.mud[2])
  }
  for (const [x, y, rx] of blobs) if (rx >= 7) c.rect(Math.round(x - rx * 0.45), Math.round(y - rx * 0.5), 2, 1, PAL.mud[3])
  c.outline(K)
  return c
}
const splatBig = splat(64, 44, [
  [30, 22, 15, 12], [18, 19, 9, 8], [42, 24, 10, 8], [28, 31, 9, 6], [36, 13, 8, 6], [12, 28, 5, 4], [50, 17, 5, 4],
  [6, 14, 2], [57, 31, 3], [22, 5, 2], [47, 37, 3, 2], [58, 10, 2], [8, 37, 2], [36, 40, 2],
])
const splatSmall = splat(36, 28, [[17, 14, 9, 7], [10, 12, 5], [25, 16, 5, 4], [18, 21, 5, 3], [4, 20, 2], [30, 7, 2], [27, 24, 2], [9, 4, 1]])
const splatDot = splat(14, 12, [[6, 6, 4, 3], [10, 4, 2], [3, 9, 1]])

/** The burst behind VS on the versus card. Anchored at its middle. */
function burst() {
  const size = 96
  const c = new Canvas(size, size)
  const m = (size - 1) / 2
  const spikes = (outer, inner, col) => {
    const pts = []
    const n = 12
    for (let k = 0; k < n * 2; k++) {
      // Uneven spikes: a hand-cut comic burst, not a gear.
      const long = [1, 0.84, 0.96, 0.8, 1, 0.88][(k >> 1) % 6]
      const r = k % 2 === 0 ? outer * long : inner
      const a = -Math.PI / 2 + 0.13 + (k * Math.PI) / n
      pts.push([Math.round(m + Math.cos(a) * r), Math.round(m + Math.sin(a) * r)])
    }
    c.poly(pts, col)
  }
  spikes(46, 31, K)
  spikes(43, 29, PAL.orange[1])
  spikes(38, 26, PAL.yellow[1])
  spikes(30, 21, PAL.yellow[2])
  return c
}

/** A lightning bolt, for the versus card's seam. Anchored at its middle. */
const bolt = (() => {
  const c = new Canvas(20, 34)
  c.poly([[11, 1], [3, 17], [9, 17], [5, 32], [16, 13], [10, 13], [15, 1]], PAL.yellow[1])
  c.poly([[11, 2], [5, 16], [9, 16]], PAL.yellow[2])
  c.outline(K)
  return c
})()

/* ------------------------------------------------------------------ */
/* Pack                                                                */
/* ------------------------------------------------------------------ */

const mid = (c) => ({ ax: Math.floor(c.w / 2), ay: Math.floor(c.h / 2) })
const FRAMES = {
  pip: { canvas: pipFull() },
  pipEmpty: { canvas: pipEmpty() },
  pipFlash: { canvas: pipFlash() },
  pipWarn: { canvas: pipWarn() },
  coin: { canvas: coin() },
  car: { canvas: car },
  tokenOn: { canvas: tokenOn() },
  tokenOff: { canvas: tokenOff() },
  clock: { canvas: clock(PAL.blue[1], PAL.navy) },
  clockHot: { canvas: clock(PAL.red[3], PAL.red[2]) },
  turbo: { canvas: turbo },
  wax: { canvas: wax },
  drop: { canvas: drop },
  boss: { canvas: boss },
  bossBill: { canvas: bossBill },
  bossStreaks: { canvas: bossStreaks },
  bossOllie: { canvas: bossOllie },
  bossNick: { canvas: bossNick() },
  flag: { canvas: flag },
  star: { canvas: star(15), ...mid(star(15)) },
  starBig: { canvas: star(25), ...mid(star(25)) },
  spark0: { canvas: spark(1), ...mid(spark(1)) },
  spark1: { canvas: spark(3), ...mid(spark(3)) },
  spark2: { canvas: spark(5), ...mid(spark(5)) },
  splatBig: { canvas: splatBig, ...mid(splatBig) },
  splatSmall: { canvas: splatSmall, ...mid(splatSmall) },
  splatDot: { canvas: splatDot, ...mid(splatDot) },
  burst: { canvas: burst(), ...mid(burst()) },
  bolt: { canvas: bolt, ...mid(bolt) },
}

const atlas = new Atlas('hud', { script: 'art-hud.mjs' })
for (const [name, f] of Object.entries(FRAMES)) atlas.add(name, f.canvas, { ax: f.ax ?? 0, ay: f.ay ?? 0 })
atlas.anim('spark', ['spark0', 'spark1', 'spark2', 'spark1', 'spark0'])
atlas.meta({
  sizes: Object.fromEntries(Object.entries(FRAMES).map(([name, f]) => [name, { w: f.canvas.w, h: f.canvas.h }])),
  ticks: { spark: [3, 3, 4, 3, 3] },
  anchors: 'Top-left, except star, starBig, spark*, splat*, burst and bolt, which are anchored at their middle.',
  use: 'pip / pipEmpty / pipFlash / pipWarn: shine. coin, car, tokenOn / tokenOff, clock / clockHot: the counters. turbo, wax, drop: power-ups in force. boss (the mud bosses), bossBill / bossStreaks / bossOllie / bossNick (the rivals): the face on the boss bar. flag, star, starBig, spark, splat*: banners and the tally. burst, bolt: the versus card.',
})

const stray = checkPalette(atlas.pack())
if (stray.length) throw new Error('colours outside the palette: ' + JSON.stringify(stray))
const out = atlas.write()
console.log(`hud atlas: ${out.sheet.w}x${out.sheet.h}, ${atlas.frames.size} frames`)

/* ------------------------------------------------------------------ */
/* Review sheets (only with --review <dir>)                            */
/* ------------------------------------------------------------------ */

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const BACKS = { sky: '#5cc8ff', tunnel: '#2e3038', snow: '#dff3ff', night: '#1a1033' }
  const small = ['pip', 'pipEmpty', 'pipFlash', 'pipWarn', 'coin', 'car', 'tokenOn', 'tokenOff', 'clock', 'clockHot', 'turbo', 'wax', 'drop', 'boss', 'bossBill', 'bossStreaks', 'bossOllie', 'bossNick', 'flag', 'star', 'starBig', 'spark0', 'spark1', 'spark2']
  const big = ['splatBig', 'splatSmall', 'splatDot', 'burst', 'bolt']
  const frames = (names) => names.map((n) => ({ label: n, canvas: FRAMES[n].canvas, ax: 0, ay: 0 }))
  for (const [tag, bg] of Object.entries(BACKS)) {
    contactSheet(frames(small), { bg, scale: 4, wrap: 10, ground: false, file: path.join(REVIEW, `hud_icons_${tag}_4x.png`) })
    contactSheet(frames(small), { bg, scale: 1, wrap: 20, ground: false, labels: false, file: path.join(REVIEW, `hud_icons_${tag}_1x.png`) })
    contactSheet(frames(big), { bg, scale: 2, wrap: 5, ground: false, file: path.join(REVIEW, `hud_big_${tag}_2x.png`) })
  }
  // The same icons mirrored: nothing in the HUD is flipped in play, but a lopsided icon shows here.
  contactSheet(frames(small), { bg: BACKS.sky, scale: 4, wrap: 10, ground: false, flipX: true, file: path.join(REVIEW, 'hud_icons_sky_4x_flip.png') })

  // A mock of the top row with the icons in the slots render/hud.ts gives them (text left out:
  // the game's font is not drawn here), to judge sizes against each other and Maxx's head.
  const head = Canvas.load(path.join(path.dirname(out.png), 'maxx.png')).crop(868, 277, 16, 16)
  for (const [tag, bg] of Object.entries(BACKS)) {
    const row = new Canvas(640, 48, bg)
    row.blit(head, 8, 6)
    // The pip tray, as hud.ts draws it (engine/ui stepRect): outline, navy, a blue rim along the top.
    const stepRect = (x, y, w, h, n, col) => {
      row.rect(x, y + n, w, h - 2 * n, col)
      for (let i = 0; i < n; i++) {
        row.rect(x + n - i, y + i, w - 2 * (n - i), 1, col)
        row.rect(x + n - i, y + h - 1 - i, w - 2 * (n - i), 1, col)
      }
    }
    stepRect(76, 2, 64, 24, 3, K)
    stepRect(77, 3, 62, 22, 2, PAL.navy)
    row.rect(79, 3, 58, 1, PAL.blue[1])
    row.blit(FRAMES.pip.canvas, 79, 5)
    row.blit(FRAMES.pip.canvas, 99, 5)
    row.blit(FRAMES.pipEmpty.canvas, 119, 5)
    row.blit(FRAMES.turbo.canvas, 147, 9)
    row.blit(FRAMES.coin.canvas, 180, 6)
    row.blit(FRAMES.car.canvas, 357, 9)
    row.blit(FRAMES.tokenOn.canvas, 476, 6)
    row.blit(FRAMES.tokenOn.canvas, 494, 6)
    row.blit(FRAMES.tokenOff.canvas, 512, 6)
    row.blit(FRAMES.clock.canvas, 552, 5)
    row.blit(FRAMES.wax.canvas, 10, 30)
    row.blit(FRAMES.drop.canvas, 40, 33)
    row.blit(FRAMES.boss.canvas, 60, 30)
    row.blit(FRAMES.flag.canvas, 84, 30)
    row.blit(FRAMES.star.canvas, 104, 31)
    row.blit(FRAMES.clockHot.canvas, 126, 30)
    for (const [i, n] of ['bossBill', 'bossStreaks', 'bossOllie', 'bossNick'].entries()) row.blit(FRAMES[n].canvas, 150 + i * 20, 30)
    row.save(path.join(REVIEW, `hud_row_${tag}_1x.png`))
    row.scale(3).save(path.join(REVIEW, `hud_row_${tag}_3x.png`))
  }
  console.log(`review sheets in ${REVIEW}`)
}
