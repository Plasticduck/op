// art-fx.mjs: generates the 'fx' atlas, the particle frames the world renderer
// (src/features/it/maxx/game/render/particles.ts) animates.
//
//   node scripts/maxx/art-fx.mjs                   writes fx.png + fx.atlas.ts
//   node scripts/maxx/art-fx.mjs --review <dir>    also writes contact sheets into <dir>: every
//       animation as a strip at 1x and 4x, on sky blue, tunnel grey, night navy and foam white
//
// One animation per FxId of sim/types.ts, frames fx/<id>0..N in play order (3 to 6 frames,
// 3 to 15 px, anchored at their middle). The script stops if an FxId has no frames.
// Two more belong to the renderer itself: 'mist' (a droplet that ran out of reach) and
// 'turbo' (the glow on the turbo nozzle, render/maxx.ts).
//
// Small things carry no outline: a 1 px line round a 4 px drop would be all line. They
// get a darker shade on the lower right instead, so they read on a bright sky and on a
// dark tunnel wall alike. Solid objects (chunks, coins, stars, leaves) keep the outline.
import fs from 'node:fs'
import path from 'node:path'
import { Atlas, Canvas, contactSheet } from './pix.mjs'
import { PAL, checkPalette } from './palette.mjs'
import { GAME_DIR } from './paths.mjs'

const reviewAt = process.argv.indexOf('--review')
const REVIEW = reviewAt > 0 ? process.argv[reviewAt + 1] : null

const LEGEND = {
  k: PAL.outline,
  n: PAL.navy,
  W: PAL.grey[6],
  w: PAL.grey[5],
  g: PAL.grey[4],
  G: PAL.grey[3],
  d: PAL.grey[2],
  b: PAL.blue[4],
  c: PAL.blue[3],
  B: PAL.blue[2],
  u: PAL.blue[1],
  y: PAL.yellow[2],
  Y: PAL.yellow[1],
  z: PAL.yellow[0],
  O: PAL.orange[2],
  o: PAL.orange[1],
  R: PAL.red[4],
  r: PAL.red[3],
  q: PAL.mud[0],
  t: PAL.mud[1],
  m: PAL.mud[2],
  M: PAL.mud[3],
  T: PAL.mud[4],
  l: PAL.green[3],
  L: PAL.green[2],
  e: PAL.green[1],
  E: PAL.green[0],
  i: PAL.ice[2],
  I: PAL.ice[1],
}

const art = (rows) => Canvas.fromText(rows, LEGEND)

/** name -> list of canvases, in play order. */
const FX = {}

FX.splash = [
  art(['.bbbb.', 'bWWbbc', 'bWbbcB', 'bbbcBB', 'bbcBBu', '.cBBu.']),
  art(['.bbb.', 'bWbbc', 'bbbcB', 'bbcBB', '.cBu.']),
  art(['.bb.', 'bWbc', 'bbcB', '.cB.']),
  art(['.b.', 'bbB', '.B.']),
]

FX.mist = [
  art(['.b...', '...W.', 'W.b..', '....b', '.W...']),
  art(['W...b', '.....', '..b..', '.....', '.b..W']),
  art(['.....', '.b...', '.....', '...W.', '.....']),
]

FX.sparkle = [
  art(['.y.', 'yWy', '.y.']),
  art(['..y..', '..W..', 'yWWWy', '..W..', '..y..']),
  art(['...y...', '...W...', '..yWy..', 'yWWWWWy', '..yWy..', '...W...', '...y...']),
  art(['....y....', '....y....', '....W....', '...yWy...', 'yyWWWWWyy', '...yWy...', '....W....', '....y....', '....y....']),
  art(['...y...', '...y...', '...W...', 'yyWWWyy', '...W...', '...y...', '...y...']),
  art(['...', '.y.', '...']),
]

FX.shine = [
  art(['..b..', '..W..', 'bWWWb', '..W..', '..b..']),
  art(['....b....', '....W....', '..b.W.b..', '...WWW...', 'bWWWWWWWb', '...WWW...', '..b.W.b..', '....W....', '....b....']),
  art([
    '......b......',
    '......b......',
    '......W......',
    '...b..W..b...',
    '....b.W.b....',
    '.....WWW.....',
    'bbWWWWWWWWWbb',
    '.....WWW.....',
    '....b.W.b....',
    '...b..W..b...',
    '......W......',
    '......b......',
    '......b......',
  ]),
  art([
    '.......b.......',
    '.......b.......',
    '.......W.......',
    '.......W.......',
    '....b..W..b....',
    '.....b.W.b.....',
    '......WWW......',
    'bbWWWWWWWWWWWbb',
    '......WWW......',
    '.....b.W.b.....',
    '....b..W..b....',
    '.......W.......',
    '.......W.......',
    '.......b.......',
    '.......b.......',
  ]),
  art(['....b....', '....b....', '....W....', '....W....', 'bbWWWWWbb', '....W....', '....W....', '....b....', '....b....']),
]

FX.dust = [
  art(['.wWw..', 'wWWWw.', 'wWWwwg', '.wwwg.', '..gg..']),
  art(['..wWWw..', '.wWWWWw.', 'wWWWWwwg', 'wWWwwwwg', '.wwwwwg.', '.gwwgg..', '...gg...']),
  art(['..wW...ww.', '.wWWw.wWwg', 'wWWww..wg.', 'wWw..w....', '.w..wWw.g.', '....wwg...', '.wg..g....']),
  art(['..w.....w.', '.....w....', 'w.........', '....w...g.', '..........', '.w....w...', '....g.....']),
]

FX.smoke = [
  art(['.ggg.', 'gwwgG', 'gwggG', 'gggGG', '.GGG.']),
  art(['..gggg..', '.gwwwgG.', 'gwwwgggG', 'gwwggggG', 'gwgggggG', 'ggggggGG', '.ggggGG.', '..GGGG..']),
  art(['...gggg...', '.ggwwggG..', '.gwwg.ggG.', 'gwwg...ggG', 'gwg.....gG', 'gg......gG', 'gg.....gGG', '.gg...gGG.', '..ggGGGG..', '....GG....']),
  art(['...g..g...', '.g......G.', '..........', 'g........G', '..........', 'g.........', '.........G', '.g......G.', '..........', '...G..G...']),
]

FX.steam = [
  art(['.WW.', 'WWWi', 'WWii', '.WWi', '.Wi.', '..i.']),
  art(['..WW..', '.WWWi.', 'WWW.Wi', 'WW..Wi', '.WW.i.', '..WWi.', '..Wi..', '...i..']),
  art(['...W..', '..W.i.', '.W....', 'W...W.', 'W....i', '.W..i.', '..W...', '...i..', '..i...']),
  art(['...W..', '......', '.W....', '.....i', 'W.....', '....i.', '..W...', '......', '..i...']),
]

// A cinder chunk, tumbling: the same lump in four quarter turns.
const chunk = art(['.kkkk..', 'kwwggk.', 'kwggGGk', 'kggGGGk', '.kGGGdk', '..kddk.', '...kk..'])
FX.debris = [0, 1, 2, 3].map((turns) => chunk.rot90(turns))

FX.mud = [
  art(['..qqq..', '.qMMmq.', 'qMTmmmq', 'qMmmmtq', 'qmmmttq', '.qmttq.', '..qqq..']),
  art(['..qq..', '.qMmq.', 'qMmmtq', 'qmmttq', '.qttq.', '..qq..']),
  art(['.qq.', 'qMmq', 'qmtq', '.qq.']),
  // Where a blob lands and sticks.
  art(['..q..qq.', '.qmqqmmq', 'qmMmmmtq', '.qqqqqq.']),
]

FX.bubble = [
  art(['.bbb.', 'bW..b', 'b...b', 'b...B', '.bBB.']),
  art(['..bbb..', '.bW..b.', 'bW....b', 'b.....b', 'b.....B', '.b...B.', '..bBB..']),
  art(['..bbbbb..', '.bWW...b.', 'bWW.....b', 'bW......b', 'b.......b', 'b.......B', 'b......BB', '.b....BB.', '..bBBBB..']),
  art(['....b....', '.b.....b.', '....W....', '.........', 'b.W...W.b', '.........', '....W....', '.b.....B.', '....B....']),
  art(['....b....', '.........', '.b.....b.', '.........', '.........', '.........', '.b.....B.', '.........', '....B....']),
]

const starBig = ['.....k.....', '....kyk....', '....kyk....', 'kkkkyyykkkk', 'kyyyyyyyyYk', '.kyyyyyYYk.', '..kyyyYYk..', '..kyyYYYk..', '.kyyYkYYYk.', '.kYkk.kkYk.', '.kk.....kk.']
FX.star = [
  art(starBig),
  // The same star catching the light.
  art(['.....k.....', '....kWk....', '....kWk....', 'kkkkWWykkkk', 'kWWWWyyyyYk', '.kWWyyyYYk.', '..kyyyYYk..', '..kyyYYYk..', '.kyyYkYYYk.', '.kYkk.kkYk.', '.kk.....kk.']),
  art(['...k...', '..kyk..', 'kkkykkk', 'kyyyyYk', '.kyyYk.', 'kyYkYYk', 'kkk.kkk']),
  art(['..k..', '.kyk.', 'kyyYk', '.kYk.', '..k..']),
]

FX.foam = [
  art(['..WW.WW..', '.WWWWWWW.', 'WWWWWWWWb', 'WWWWWWWbb', '.WWWWWbbc', 'WWWbWbbc.', '.bbbcbc..', '..cc.c...']),
  art(['.WW.W..', 'WWWWWW.', 'WWWWWbb', '.WWWbbc', 'WWbbbc.', '.bcc...']),
  art(['.WW..', 'WWWWb', 'WWWbb', '.Wbbc', '..bc.']),
  art(['.W.', 'WWb', '.b.']),
]

FX.snow = [
  art(['.WWW.', 'WWWWi', 'WWWiI', 'WWiII', '.iII.']),
  art(['.WW.', 'WWWi', 'WWiI', '.iI.']),
  art(['.W.', 'WWi', '.I.']),
  art(['Wi', 'i.']),
]

// Three colours, each flat on and edge on: a particle keeps its colour and flutters between its two.
const flat = (a, b) => Canvas.fromText(['aaaa', 'aaab', 'bbbb'], { a, b })
const edge = (a, b) => Canvas.fromText(['ab', 'ab', 'ab', 'bb'], { a, b })
FX.confetti = [
  flat(PAL.red[4], PAL.red[2]),
  edge(PAL.red[4], PAL.red[2]),
  flat(PAL.blue[3], PAL.blue[1]),
  edge(PAL.blue[3], PAL.blue[1]),
  flat(PAL.yellow[2], PAL.yellow[0]),
  edge(PAL.yellow[2], PAL.yellow[0]),
]

FX.drip = [
  art(['.b.', '.b.', 'bWb', 'bbB', '.B.']),
  art(['.b.', '.b.', '.b.', 'bWb', 'bbB', 'bbB', '.B.']),
  // It lands: a little crown, then nothing.
  art(['b.....b', '.b.W.b.', '..bbb..', '.bbBBb.']),
  art(['b...W...b', '.b.....b.', '...bBb...']),
  art(['b.......b', '....b....']),
]

/** One turn of the silver-blue wash token: face on, turning, edge on, and back. */
function coinFrame(half, lit) {
  const c = new Canvas(12, 12)
  if (half < 1) {
    c.rect(5, 0, 2, 12, PAL.navy)
    c.rect(5, 1, 1, 10, PAL.grey[5])
    c.rect(6, 1, 1, 10, PAL.grey[3])
    return c
  }
  c.ellipse(5.5, 5.5, half + 1, 6, PAL.navy)
  c.ellipse(5.5, 5.5, half, 5, PAL.grey[4])
  // Light from the top left: the lit side of the rim follows the turn.
  const inner = new Canvas(12, 12)
  inner.ellipse(5.5 + (lit ? -0.5 : 0.5), 5, Math.max(0.5, half - 1), 4, PAL.grey[6])
  c.blit(inner, 0, 0, { mode: 'atop' })
  if (half >= 4.5) {
    // The stamp: a blue M.
    for (const [x, y] of [[3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [4, 4], [5, 5], [6, 5], [7, 4], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7]]) c.set(x, y, PAL.blue[2])
  } else if (half >= 2.5) {
    c.rect(5, 3, 1, 5, PAL.blue[2])
    c.rect(6, 4, 1, 2, PAL.blue[2])
  }
  return c
}
FX.coin = [coinFrame(4.5, true), coinFrame(3, true), coinFrame(1.5, true), coinFrame(0, true), coinFrame(1.5, false), coinFrame(3, false)]

const leafSide = art(['.EEEE..', 'ELLllE.', '.ELLLlE', '..EEEE.'])
const leafTilt = art(['...EE.', '..ElLE', '.ELlE.', 'ELLE..', 'ELE...', '.E....'])
const leafUp = art(['.EE.', 'ElLE', 'ElLE', 'ELLE', 'ELLE', '.ELE', '..E.'])
FX.leaf = [leafSide, leafTilt, leafUp, leafTilt.flipX()]

FX.spark = [art(['..y..', '.yWy.', 'yWWWy', '.yWy.', '..y..']), art(['.y.', 'yWy', '.y.']), art(['yo', 'or']), art(['o'])]

FX.turbo = [
  art(['..o..', '.oyo.', 'oyWyo', '.oyo.', '..o..']),
  art(['...o...', '..oyo..', '.oyWyo.', 'oyWWWyo', '.oyWyo.', '..oyo..', '...o...']),
  art(['....o....', '....y....', '..o.y.o..', '...oyo...', 'oyyyWyyyo', '...oyo...', '..o.y.o..', '....y....', '....o....']),
  art(['...o...', '...y...', '..oyo..', 'oyyWyyo', '..oyo..', '...y...', '...o...']),
]


/* ------------------------------------------------------------------ */
/* Checks, then the atlas                                              */
/* ------------------------------------------------------------------ */

const types = fs.readFileSync(path.join(GAME_DIR, 'game', 'sim', 'types.ts'), 'utf8')
const union = /export type FxId =([^]*?)\n\n/.exec(types)
if (!union) throw new Error('art-fx: could not find FxId in sim/types.ts')
const FX_IDS = [...union[1].matchAll(/'(\w+)'/g)].map((m) => m[1])
const EXTRAS = ['mist', 'turbo']
for (const id of FX_IDS) if (!FX[id]) throw new Error(`art-fx: FxId '${id}' has no frames`)
for (const id of Object.keys(FX)) if (!FX_IDS.includes(id) && !EXTRAS.includes(id)) throw new Error(`art-fx: '${id}' is neither an FxId nor a listed extra`)

const atlas = new Atlas('fx', { script: 'art-fx.mjs' })
const sizes = {}
for (const [id, frames] of Object.entries(FX)) {
  if (!EXTRAS.includes(id) && (frames.length < 3 || frames.length > 6)) throw new Error(`art-fx: '${id}' has ${frames.length} frames, wants 3 to 6`)
  let w = 0
  let h = 0
  for (const c of frames) {
    if (c.w > 16 || c.h > 16) throw new Error(`art-fx: a frame of '${id}' is ${c.w}x${c.h}, over 16 px`)
    w = Math.max(w, c.w)
    h = Math.max(h, c.h)
  }
  sizes[id] = { frames: frames.length, w, h }
  atlas.addAnim(
    id,
    frames.map((canvas) => ({ canvas, ax: canvas.w >> 1, ay: canvas.h >> 1 })),
  )
}
atlas.meta({
  ids: FX_IDS,
  extras: EXTRAS,
  sizes,
  note: 'Frames fx/<id>0..N in play order, anchored at their middle. confetti is three colours, two frames each (flat on, edge on). coin is one full turn. The last two frames of drip are its landing, the last of mud is a blob stuck where it fell. How each one moves is in render/particles.ts.',
})

const all = new Canvas(16 * 6 + 8, 17 * Object.keys(FX).length + 1)
Object.values(FX).forEach((frames, row) => frames.forEach((c, i) => all.blit(c, 1 + i * 17, 1 + row * 17)))
const stray = checkPalette(all)
if (stray.length) throw new Error('art-fx: colours outside the palette: ' + stray.map((s) => s.colour).join(', '))

const out = atlas.write()
console.log(`fx atlas: ${Object.keys(FX).length} animations, ${[...atlas.frames.keys()].length} frames, sheet ${out.sheet.w}x${out.sheet.h}`)
console.log('  ' + path.relative(process.cwd(), out.png))
console.log('  ' + path.relative(process.cwd(), out.ts))

if (REVIEW) {
  fs.mkdirSync(REVIEW, { recursive: true })
  const rows = Object.entries(FX).map(([id, frames]) => ({ label: id, frames: frames.map((canvas, i) => ({ canvas, ax: canvas.w >> 1, ay: canvas.h >> 1, label: String(i) })) }))
  const grounds = { sky: PAL.blue[3], tunnel: PAL.grey[1], night: PAL.purple[0], foam: PAL.grey[6], mud: PAL.mud[2] }
  for (const [tag, bg] of Object.entries(grounds)) {
    contactSheet(rows, { bg, scale: 4, ground: false, wrap: 6, file: path.join(REVIEW, `fx_${tag}_4x.png`) })
    contactSheet(rows, { bg, scale: 1, ground: false, labels: false, wrap: 6, file: path.join(REVIEW, `fx_${tag}_1x.png`) })
  }
  contactSheet(rows, { bg: PAL.blue[3], scale: 4, ground: false, wrap: 6, flipX: true, file: path.join(REVIEW, 'fx_sky_4x_flipped.png') })
  console.log('  review sheets in ' + REVIEW)
}
