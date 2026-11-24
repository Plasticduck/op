// Pixel text: the game's own 8x8 font, inline symbols and button prompts.
//
// drawText(g, 'PRESS {jump} TO START', x, y, { scale: 2, shadow: '#1b2253' })
//
// The font is proportional (most letters are 6 wide plus 1 of spacing; all digits
// are 6 wide so counters do not jitter). Capitals fill rows 0..6 of the 8 px cell,
// row 7 is for tails. Lowercase draws as capitals. Lines advance LINE_H (10) font
// pixels. Everything is multiplied by the whole-number `scale`.
//
// Characters:  A-Z 0-9 . , ! ? ' " : ; - + * / \ | ( ) % & < > = # $ @ _ ^ ~ ` [ ] { }
// Accented Latin letters draw as their plain letter (an accented E as E), curly quotes
// and long dashes as plain ones, anything else as a hollow box.
//
// On a TV: scale 1 is small print. Anything the player must read from the couch
// (prompts, the score, banners) wants scale 2 or more.
//
// Tokens in braces (capitals or not):
//   {heart} {drop} {star} {times} {coin} {check} {lock} {pointer}
//   {arrow_left} {arrow_right} {arrow_up} {arrow_down}
//       symbols, drawn in the text colour like any letter.
//   {jump} {spray} {confirm} {cancel} {pause} {select} {left} {right} {up} {down}
//       the button prompt for that action on the device in use, looked up through
//       the InputApi given to bindGlyphs() every time the text is drawn. A
//       direction asked of a whole D-pad, stick or arrow cluster shows that
//       direction on it. Before bindGlyphs() the directions draw as the plain
//       arrow symbols and the rest as keyboard keys.
//   {move}
//       the whole D-pad, arrow cluster or touch pad for the device in use.
//   {pad_a} {key_Z} {touch_a} ...
//       a prompt by glyph id, whatever the device.
//   An unknown token is drawn as written, braces and all, so a typo shows.
//
// GLYPH IDS: what InputApi.glyph() should return. Prompt icons are 9 font pixels
// tall and sit one pixel above and below the capitals (so text drawn at y = 0
// loses an icon's top row: keep prompts one pixel times scale off the edge).
//   pad_a pad_b pad_x pad_y        face buttons: green A, red B, blue X, yellow Y
//   pad_start pad_back             Menu and View (also pad_menu, pad_view, pad_select)
//   pad_lb pad_rb pad_lt pad_rt    bumpers and triggers
//   pad_dpad                       the D-pad
//   pad_dpad_left pad_dpad_right pad_dpad_up pad_dpad_down     one arm lit
//   pad_stick                      the left stick (also pad_ls)
//   pad_stick_left pad_stick_right pad_stick_up pad_stick_down the stick pushed that way
//   pad_rs                         the right stick
//   key_<LABEL>                    a keycap with any label: key_Z key_X key_K key_J key_P
//                                  key_SPACE key_ENTER key_ESC key_SHIFT key_TAB key_BACKSPACE
//   key_LEFT key_RIGHT key_UP key_DOWN   a keycap with an arrow
//   key_ARROWS                     the four arrow keys as a cluster
//   touch_a touch_b                on-screen buttons
//   touch_left touch_right touch_up touch_down touch_dpad touch_pause
// Spelling is forgiving: any letter case, and KeyboardEvent names (key_ArrowLeft,
// key_Escape, key_KeyZ, key_ ) are understood. Anything else still draws:
// pad_<label> as a dark plate, touch_<label> as a white one, the rest as a keycap.
import { ACTIONS } from '../contract'
import type { Action, GlyphId, InputApi, TextOpts } from '../contract'

/** Height of the font cell, in font pixels. Capitals are 7 tall; row 7 holds tails. */
export const GLYPH_H = 8
/** Default distance from one line's top to the next, in font pixels. */
export const LINE_H = 10

export interface TextStyle extends TextOpts {
  /** Line advance in font pixels, before scale. Default LINE_H. */
  lineHeight?: number
  /** Extra whole font pixels between characters, before scale. Default 0. */
  spacing?: number
}

/* ------------------------------------------------------------------ */
/* The font                                                            */
/* ------------------------------------------------------------------ */

// One glyph per entry: rows top to bottom with '/' between them, '#' is ink.
// A glyph is as wide as its longest row, and its ink must reach both sides
// (measureText counts the whole width). Single-character names are typed
// characters, longer names are {tokens}.
//
// Drawn for this game on a 6 x 7 grid with 2 px stems. Where the grid leaves a
// choice the font makes its own: a low bar on A, a small upper bowl on B (so it
// is not an 8), a chin on G, legs that kick out and land upright on K and R,
// deep points on M and W, flat tops on 3, 5 and 7, a flag and foot on 1, and a
// zero with a broken slash (so it is not an O).
const FONT: Record<string, string> = {
  ' ': '...',
  A: '..##../.####./##..##/##..##/######/##..##/##..##',
  B: '####../##.##./##.##./#####./##..##/##..##/#####.',
  C: '.####./##..##/##..../##..../##..../##..##/.####.',
  D: '####../##.##./##..##/##..##/##..##/##.##./####..',
  E: '######/##..../##..../#####./##..../##..../######',
  F: '######/##..../##..../#####./##..../##..../##....',
  G: '.####./##..##/##..../##.###/##..##/##..##/.#####',
  H: '##..##/##..##/##..##/######/##..##/##..##/##..##',
  I: '####/.##./.##./.##./.##./.##./####',
  J: '....##/....##/....##/....##/##..##/##..##/.####.',
  K: '##..##/##.##./####../###.../##.##./##..##/##..##',
  L: '##..../##..../##..../##..../##..../##..../######',
  M: '##...##/###.###/#######/##.#.##/##.#.##/##...##/##...##',
  N: '##..##/###.##/###.##/##.###/##.###/##..##/##..##',
  O: '.####./##..##/##..##/##..##/##..##/##..##/.####.',
  P: '#####./##..##/##..##/#####./##..../##..../##....',
  Q: '.####./##..##/##..##/##..##/##..##/##.###/.####./....##',
  R: '#####./##..##/##..##/#####./##.##./##..##/##..##',
  S: '.####./##..##/##..../.####./....##/##..##/.####.',
  T: '######/..##../..##../..##../..##../..##../..##..',
  U: '##..##/##..##/##..##/##..##/##..##/##..##/.####.',
  V: '##..##/##..##/##..##/##..##/.####./.####./..##..',
  W: '##...##/##...##/##.#.##/##.#.##/#######/###.###/##...##',
  X: '##..##/##..##/.####./..##../.####./##..##/##..##',
  Y: '##..##/##..##/.####./..##../..##../..##../..##..',
  Z: '######/....##/...##./..##../.##.../##..../######',
  '0': '.####./##..##/##.###/##..##/###.##/##..##/.####.',
  '1': '..##../.###../####../..##../..##../..##../######',
  '2': '.####./##..##/....##/..###./.##.../##..../######',
  '3': '######/....##/...##./..###./....##/##..##/.####.',
  '4': '...###/..####/.##.##/##..##/######/....##/....##',
  '5': '######/##..../#####./....##/....##/##..##/.####.',
  '6': '..###./.##.../##..../#####./##..##/##..##/.####.',
  '7': '######/....##/...##./..##../..##../..##../..##..',
  '8': '.####./##..##/##..##/.####./##..##/##..##/.####.',
  '9': '.####./##..##/##..##/.#####/....##/...##./.###..',
  '.': '../../../../../##/##',
  ',': '.../.../.../.../.../.##/.##/##.',
  '!': '##/##/##/##/##/../##',
  '?': '.####./##..##/....##/..###./..##../....../..##..',
  "'": '##/##/#.',
  '"': '##.##/##.##/#..#.',
  ':': '../##/##/../##/##',
  ';': '.../.##/.##/.../.##/.##/##.',
  '-': '...../...../...../#####',
  '+': '....../..##../..##../######/..##../..##..',
  '*': '...../#.#.#/.###./#####/.###./#.#.#',
  '/': '....##/...##./...##./..##../.##.../.##.../##....',
  '\\': '##..../.##.../.##.../..##../...##./...##./....##',
  '|': '##/##/##/##/##/##/##/##',
  '^': '..##../.####./##..##',
  '~': '......./......./.###..#/#..###.',
  '`': '##./.##',
  '(': '.##/##./##./##./##./##./.##',
  ')': '##./.##/.##/.##/.##/.##/##.',
  '%': '##...##/##..##./...##../..##.../.##..../##...##/#....##',
  '&': '.###.../##.##../##.##../.###.##/##.###./##..##./.###.##',
  '<': '...##/..##./.##../##.../.##../..##./...##',
  '>': '##.../.##../..##./...##/..##./.##../##...',
  '=': '...../...../#####/...../#####',
  '#': '.##.##./.##.##./#######/.##.##./#######/.##.##./.##.##.',
  $: '..##../.#####/##..../.####./....##/#####./..##..',
  '@': '.#####./##...##/##.####/##.#.##/##.####/##...../.#####.',
  _: '....../....../....../....../....../....../....../######',
  '[': '###/##./##./##./##./##./###',
  ']': '###/.##/.##/.##/.##/.##/###',
  '{': '..##/.##./.##./##../.##./.##./..##',
  '}': '##../.##./.##./..##/.##./.##./##..',
  heart: '.##.##./#######/#######/#######/.#####./..###../...#...',
  drop: '..#../..#../.###./#####/#.###/#####/.###.',
  star: '...#.../..###../#######/.#####./..###../.##.##./.#...#.',
  times: '....../##..##/.####./..##../.####./##..##',
  // A wash token: a ring with a stamped middle. A solid disc read as a bubble, which is another pickup.
  coin: '.#####./##...##/#..#..#/#.###.#/#..#..#/##...##/.#####.',
  check: '......./.....##/....###/##.###./#####../.###.../..#....',
  lock: '..###../.#...#./.#...#./#######/###.###/###.###/#######',
  pointer: '#.../##../###./####/###./##../#...',
  arrow_left: '...#.../..##.../.######/#######/.######/..##.../...#...',
  arrow_right: '...#.../...##../######./#######/######./...##../...#...',
  arrow_up: '...#.../..###../.#####./#######/..###../..###../..###..',
  arrow_down: '..###../..###../..###../#######/.#####./..###../...#...',
  tofu: '#####/#...#/#...#/#...#/#...#/#...#/#####',
}

const NAMES = Object.keys(FONT)
const COUNT = NAMES.length
const GW = new Uint8Array(COUNT)
/** Eight rows per glyph, bit 7 is the left column. */
const GBITS = new Uint8Array(COUNT * GLYPH_H)
const CHAR_GLYPH = new Int16Array(128)
const TOKEN_GLYPH = new Map<string, number>()

for (let i = 0; i < COUNT; i++) {
  const name = NAMES[i]
  const rows = FONT[name].split('/')
  let w = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.length > w) w = row.length
    let bits = 0
    for (let c = 0; c < row.length; c++) if (row.charCodeAt(c) === 35) bits |= 0x80 >> c
    GBITS[i * GLYPH_H + r] = bits
  }
  GW[i] = w
  if (name.length > 1) TOKEN_GLYPH.set(name, i)
}
const TOFU = NAMES.indexOf('tofu')
const SPACE = NAMES.indexOf(' ')
CHAR_GLYPH.fill(TOFU)
for (let i = 0; i < COUNT; i++) if (NAMES[i].length === 1) CHAR_GLYPH[NAMES[i].charCodeAt(0)] = i
for (let c = 97; c <= 122; c++) CHAR_GLYPH[c] = CHAR_GLYPH[c - 32]
CHAR_GLYPH[9] = SPACE
CHAR_GLYPH[13] = SPACE

const NONE = -32768

// Characters beyond ASCII that tend to arrive in pasted copy or in a person's name.
const EXTRA = new Map<number, number>()
{
  const names: Record<number, string> = {
    0xa0: ' ', 0x2018: "'", 0x2019: "'", 0x201c: '"', 0x201d: '"', 0x2013: '-', 0x2014: '-', 0x2212: '-',
    0xa1: '!', 0xbf: '?', 0xd7: 'times', 0x2665: 'heart', 0x2605: 'star', 0x2713: 'check',
    0x2190: 'arrow_left', 0x2192: 'arrow_right', 0x2191: 'arrow_up', 0x2193: 'arrow_down',
  }
  for (const code in names) EXTRA.set(Number(code), NAMES.indexOf(names[code]))
  // U+00C0..U+00DE as plain capitals ('.' has none); the small letters sit 32 above them.
  const plain = 'AAAAAAACEEEEIIIIDNOOOOO.OUUUUY.'
  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === '.') continue
    EXTRA.set(0xc0 + i, CHAR_GLYPH[plain.charCodeAt(i)])
    EXTRA.set(0xe0 + i, CHAR_GLYPH[plain.charCodeAt(i)])
  }
  EXTRA.set(0xdf, CHAR_GLYPH[83])
  EXTRA.set(0xff, CHAR_GLYPH[89])
}

/** A glyph for a character beyond ASCII, or NONE for one that takes no room (the second half of an emoji, a combining accent). */
function glyphOfWide(code: number): number {
  const glyph = EXTRA.get(code)
  if (glyph !== undefined) return glyph
  if ((code >= 0xdc00 && code <= 0xdfff) || (code >= 0x300 && code <= 0x36f) || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0x200b && code <= 0x200d)) return NONE
  return TOFU
}

/** Every character the font has, for test pages. */
export const FONT_CHARS = NAMES.filter((n) => n.length === 1 && n !== ' ').join('')
/** Every symbol token, without braces. */
export const SYMBOL_TOKENS = NAMES.filter((n) => n.length > 1 && n !== 'tofu')
/** The documented prompt ids, for test pages. key_<LABEL> takes any label. */
export const GLYPH_IDS: readonly GlyphId[] = [
  'pad_a', 'pad_b', 'pad_x', 'pad_y', 'pad_start', 'pad_back', 'pad_lb', 'pad_rb', 'pad_lt', 'pad_rt',
  'pad_dpad', 'pad_dpad_left', 'pad_dpad_right', 'pad_dpad_up', 'pad_dpad_down',
  'pad_stick', 'pad_stick_left', 'pad_stick_right', 'pad_stick_up', 'pad_stick_down', 'pad_rs',
  'key_Z', 'key_X', 'key_SPACE', 'key_ENTER', 'key_ESC', 'key_SHIFT', 'key_TAB', 'key_BACKSPACE',
  'key_LEFT', 'key_RIGHT', 'key_UP', 'key_DOWN', 'key_ARROWS',
  'touch_a', 'touch_b', 'touch_left', 'touch_right', 'touch_up', 'touch_down', 'touch_dpad', 'touch_pause',
]

/* ------------------------------------------------------------------ */
/* Tinted font sheets                                                  */
/* ------------------------------------------------------------------ */

// Each glyph sits in an 11 px cell with its ink at (1, 1): one pixel of room
// all round for the outline and one more down-right for the shadow, so a
// finished glyph (shadow, outline, fill) is a single blit.
const CELL = 11
const COLS = 16
const SHEET_W = COLS * CELL
const SHEET_H = Math.ceil(COUNT / COLS) * CELL
const MAX_SHEETS = 96
/** The palette's white (design bible, section 9). */
const DEFAULT_COLOR = '#f7f4f8'

type Ctx = CanvasRenderingContext2D

let canvasesMade = 0

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  canvasesMade++
  return cv
}

let maskThin: HTMLCanvasElement | null = null
let maskFat: HTMLCanvasElement | null = null
let tintCv: HTMLCanvasElement | null = null
let tintCtx: Ctx | null = null

function buildMasks(): void {
  maskThin = makeCanvas(SHEET_W, SHEET_H)
  maskFat = makeCanvas(SHEET_W, SHEET_H)
  const tc = maskThin.getContext('2d')!
  const fc = maskFat.getContext('2d')!
  const thin = tc.createImageData(SHEET_W, SHEET_H)
  const fat = fc.createImageData(SHEET_W, SHEET_H)
  const put = (img: ImageData, x: number, y: number) => {
    const o = (y * SHEET_W + x) * 4
    img.data[o] = img.data[o + 1] = img.data[o + 2] = img.data[o + 3] = 255
  }
  for (let i = 0; i < COUNT; i++) {
    const ox = (i % COLS) * CELL + 1
    const oy = Math.floor(i / COLS) * CELL + 1
    for (let r = 0; r < GLYPH_H; r++) {
      const bits = GBITS[i * GLYPH_H + r]
      for (let c = 0; c < 8; c++) {
        if (!(bits & (0x80 >> c))) continue
        put(thin, ox + c, oy + r)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(fat, ox + c + dx, oy + r + dy)
      }
    }
  }
  tc.putImageData(thin, 0, 0)
  fc.putImageData(fat, 0, 0)
  tintCv = makeCanvas(SHEET_W, SHEET_H)
  tintCtx = tintCv.getContext('2d')!
}

function tinted(mask: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const t = tintCtx!
  t.globalCompositeOperation = 'copy'
  t.drawImage(mask, 0, 0)
  t.globalCompositeOperation = 'source-in'
  // A colour the browser cannot read leaves fillStyle alone: make that white, not whatever was last.
  t.fillStyle = DEFAULT_COLOR
  t.fillStyle = color
  t.fillRect(0, 0, SHEET_W, SHEET_H)
  return tintCv!
}

interface Sheet {
  cv: HTMLCanvasElement
  g: Ctx
  color: string
  outline: string
  shadow: string
  /** Asked for since the eviction hand last passed. */
  hot: boolean
}

function paintSheet(sh: Sheet): void {
  const c = sh.g
  c.clearRect(0, 0, SHEET_W, SHEET_H)
  if (sh.shadow) c.drawImage(tinted(sh.outline ? maskFat! : maskThin!, sh.shadow), 1, 1)
  if (sh.outline) c.drawImage(tinted(maskFat!, sh.outline), 0, 0)
  c.drawImage(tinted(maskThin!, sh.color), 0, 0)
}

// Looked up colour, then outline, then shadow, so a draw call builds no key string.
const sheetIndex = new Map<string, Map<string, Map<string, Sheet>>>()
const sheetRing: Sheet[] = []
let sheetHand = 0
let lastSheet: Sheet | null = null

function forgetSheet(sh: Sheet): void {
  const byOutline = sheetIndex.get(sh.color)
  const byShadow = byOutline?.get(sh.outline)
  if (!byOutline || !byShadow) return
  byShadow.delete(sh.shadow)
  if (!byShadow.size) byOutline.delete(sh.outline)
  if (!byOutline.size) sheetIndex.delete(sh.color)
}

function sheetFor(color: string, outline: string, shadow: string): HTMLCanvasElement {
  const prev = lastSheet
  if (prev && color === prev.color && outline === prev.outline && shadow === prev.shadow) return prev.cv
  let sh = sheetIndex.get(color)?.get(outline)?.get(shadow)
  if (!sh) {
    if (!maskThin) buildMasks()
    if (sheetRing.length < MAX_SHEETS) {
      const cv = makeCanvas(SHEET_W, SHEET_H)
      sh = { cv, g: cv.getContext('2d')!, color, outline, shadow, hot: false }
      sheetRing.push(sh)
    } else {
      // Colours that change every frame (a fade written as rgb strings) must not pile up
      // canvases: past the cap, the sheet that has gone longest unused is repainted.
      for (;;) {
        sh = sheetRing[sheetHand]
        sheetHand = (sheetHand + 1) % MAX_SHEETS
        if (!sh.hot) break
        sh.hot = false
      }
      forgetSheet(sh)
      sh.color = color
      sh.outline = outline
      sh.shadow = shadow
    }
    let byOutline = sheetIndex.get(color)
    if (!byOutline) sheetIndex.set(color, (byOutline = new Map()))
    let byShadow = byOutline.get(outline)
    if (!byShadow) byOutline.set(outline, (byShadow = new Map()))
    byShadow.set(shadow, sh)
    paintSheet(sh)
  }
  sh.hot = true
  lastSheet = sh
  return sh.cv
}

/* ------------------------------------------------------------------ */
/* Prompt icons                                                        */
/* ------------------------------------------------------------------ */

const INK = '#16161d'
const COAL = '#2e3038'
const STEEL = '#a9afbd'
const SMOKE = '#d6dae3'
const WHITE = '#f7f4f8'
const NAVY = '#1b2253'

// Labels inside icons use this 5 px tall alphabet.
const TINY: Record<string, string> = {
  A: '.#./#.#/###/#.#/#.#',
  B: '##./#.#/##./#.#/##.',
  C: '.##/#../#../#../.##',
  D: '##./#.#/#.#/#.#/##.',
  E: '###/#../##./#../###',
  F: '###/#../##./#../#..',
  G: '.##/#../#.#/#.#/.##',
  H: '#.#/#.#/###/#.#/#.#',
  I: '###/.#./.#./.#./###',
  J: '..#/..#/..#/#.#/.#.',
  K: '#.#/#.#/##./#.#/#.#',
  L: '#../#../#../#../###',
  M: '#...#/##.##/#.#.#/#...#/#...#',
  N: '#..#/##.#/#.##/#..#/#..#',
  O: '.#./#.#/#.#/#.#/.#.',
  P: '##./#.#/##./#../#..',
  Q: '.#./#.#/#.#/.#./..#',
  R: '##./#.#/##./#.#/#.#',
  S: '.##/#../.#./..#/##.',
  T: '###/.#./.#./.#./.#.',
  U: '#.#/#.#/#.#/#.#/###',
  V: '#.#/#.#/#.#/#.#/.#.',
  W: '#...#/#...#/#.#.#/##.##/#...#',
  X: '#.#/#.#/.#./#.#/#.#',
  Y: '#.#/#.#/.#./.#./.#.',
  Z: '####/..#./.#../#.../####',
  '0': '###/#.#/#.#/#.#/###',
  '1': '.#./##./.#./.#./###',
  '2': '##./..#/.#./#../###',
  '3': '##./..#/.#./..#/##.',
  '4': '#.#/#.#/###/..#/..#',
  '5': '###/#../##./..#/##.',
  '6': '.##/#../###/#.#/###',
  '7': '###/..#/.#./.#./.#.',
  '8': '###/#.#/###/#.#/###',
  '9': '###/#.#/###/..#/##.',
  '+': '.../.#./###/.#./...',
  '-': '.../.../###/.../...',
  '.': '././././#',
  _: '.../.../.../.../###',
  '/': '..#/..#/.#./#../#..',
  '?': '##./..#/.#./.../.#.',
  ' ': '../../../../..',
}

function tinyRows(ch: string): string[] {
  return (TINY[ch] ?? TINY['?']).split('/')
}

function tinyWidth(label: string): number {
  let w = 0
  for (const ch of label) w += tinyRows(ch)[0].length + 1
  return w > 0 ? w - 1 : 0
}

function dot(c: Ctx, x: number, y: number, color: string): void {
  c.fillStyle = color
  c.fillRect(x, y, 1, 1)
}

/** Paint rows of palette characters. Characters missing from `pal` stay clear. */
function art(c: Ctx, rows: readonly string[], pal: Record<string, string>, ox = 0, oy = 0): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]
    for (let x = 0; x < row.length; x++) {
      const color = pal[row[x]]
      if (color) dot(c, ox + x, oy + y, color)
    }
  }
}

function tiny(c: Ctx, label: string, x: number, y: number, color: string): void {
  const pal = { '#': color }
  for (const ch of label) {
    const rows = tinyRows(ch)
    art(c, rows, pal, x, y)
    x += rows[0].length + 1
  }
}

/**
 * A rimmed plate. `ins[y]` is how far row y is cut in on each side, which
 * makes the shape: a keycap, a pill, a bumper, a trigger.
 */
function plate(c: Ctx, w: number, ins: readonly number[], rim: string, body: string, lip?: string): void {
  const h = ins.length
  const inside = (x: number, y: number) => y >= 0 && y < h && x >= ins[y] && x < w - ins[y]
  const edge = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!inside(x + dx, y + dy)) return true
    return false
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue
      dot(c, x, y, edge(x, y) ? rim : lip && edge(x, y + 1) ? lip : body)
    }
  }
}

interface Icon {
  w: number
  h: number
  paint: (c: Ctx) => void
  art: HTMLCanvasElement | null
  /** Flat-colour copies for shadows and outlines, by colour. */
  thin: Map<string, HTMLCanvasElement> | null
  fat: Map<string, HTMLCanvasElement> | null
}

function icon(w: number, paint: (c: Ctx) => void): Icon {
  return { w, h: 9, paint, art: null, thin: null, fat: null }
}

const DIRS = ['left', 'right', 'up', 'down'] as const
// Bare triangles: with a shaft, an arrow this small reads as a plus sign.
const ARROW5: readonly string[][] = [
  ['...#.', '..##.', '.###.', '..##.', '...#.'],
  ['.#...', '.##..', '.###.', '.##..', '.#...'],
  ['.....', '..#..', '.###.', '#####', '.....'],
  ['.....', '#####', '.###.', '..#..', '.....'],
]

const DISC = ['..ooooo..', '.ohhbbbo.', 'obbbbbbbo', 'obbbbbbbo', 'obbbbbbbo', 'obbbbbbbo', 'obbbbbbdo', '.obbbddo.', '..ooooo..']

// The letters on round buttons are 5 px wide with true diagonals: these are the
// prompts read from the couch, and at 3 px wide an X or an A is a blob.
const FACE: Record<string, readonly string[]> = {
  A: ['..#..', '.#.#.', '#...#', '#####', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  L: ['.#...', '.#...', '.#...', '.#...', '.####'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
}

/** A round button with a letter or, for a number, that direction's arrow. */
function disc(rim: string, body: string, hi: string, lo: string, mark: string | number, ink: string): Icon {
  return icon(9, (c) => {
    art(c, DISC, { o: rim, b: body, h: hi, d: lo })
    if (typeof mark === 'number') art(c, ARROW5[mark], { '#': ink }, 2, 2)
    else if (FACE[mark]) art(c, FACE[mark], { '#': ink }, 2, 2)
    else tiny(c, mark, (9 - tinyWidth(mark)) >> 1, 2, ink)
  })
}

const KEYCAP = [1, 0, 0, 0, 0, 0, 0, 0, 1]
const PILL = [2, 1, 0, 0, 0, 0, 0, 1, 2]
const BUMPER = [2, 1, 0, 0, 0, 0, 0, 0, 1]
const TRIGGER = [1, 0, 0, 0, 0, 0, 1, 2, 3]

function keycap(label: string): Icon {
  const tw = tinyWidth(label)
  const w = Math.max(9, tw + 6)
  return icon(w, (c) => {
    plate(c, w, KEYCAP, INK, WHITE, STEEL)
    tiny(c, label, (w - tw) >> 1, 2, NAVY)
  })
}

function arrowKey(dir: number): Icon {
  return icon(9, (c) => {
    plate(c, 9, KEYCAP, INK, WHITE, STEEL)
    art(c, ARROW5[dir], { '#': NAVY }, 2, 2)
  })
}

/** A dark controller part with a light rim and a white label. */
function darkPlate(label: string, shape: readonly number[]): Icon {
  const tw = tinyWidth(label)
  const w = Math.max(11, tw + 6)
  return icon(w, (c) => {
    plate(c, w, shape, STEEL, COAL)
    tiny(c, label, (w - tw) >> 1, 2, WHITE)
  })
}

function lightPlate(label: string): Icon {
  const tw = tinyWidth(label)
  const w = Math.max(11, tw + 6)
  return icon(w, (c) => {
    plate(c, w, PILL, INK, WHITE, STEEL)
    tiny(c, label, (w - tw) >> 1, 2, NAVY)
  })
}

const MENU_MARK = ['#####', '.....', '#####', '.....', '#####']
const VIEW_MARK = ['..#####', '..#...#', '#####.#', '#...###', '#####..']

function pill(mark: readonly string[]): Icon {
  return icon(13, (c) => {
    plate(c, 13, PILL, STEEL, COAL)
    art(c, mark, { '#': WHITE }, (13 - mark[0].length) >> 1, 2)
  })
}

// l r u d are the four arms, p the hub, k the dish behind the cross.
const DPAD = ['..ooooo..', '.okuuuko.', 'okkuuukko', 'ollppprro', 'ollppprro', 'ollppprro', 'okkdddkko', '.okdddko.', '..ooooo..']
const DPAD_LIT = '#f97316'

/** The D-pad, with one arm lit for a direction (0..3) or none (-1). */
function dpad(dir: number): Icon {
  return icon(9, (c) => {
    const pal: Record<string, string> = { o: INK, k: COAL, p: SMOKE, l: SMOKE, r: SMOKE, u: SMOKE, d: SMOKE }
    if (dir >= 0) pal['lrud'[dir]] = DPAD_LIT
    art(c, DPAD, pal)
    dot(c, 4, 4, STEEL)
  })
}

/** A thumbstick: a dark cap with its letter or, for a number, the way to push it. */
function stick(mark: string | number): Icon {
  return disc(STEEL, COAL, COAL, COAL, mark, WHITE)
}

const ARROW_KEYS = [
  '....ooooo....',
  '....offfo....',
  '....offfo....',
  '....olllo....',
  'ooooooooooooo',
  'offfofffofffo',
  'offfofffofffo',
  'olllolllolllo',
  'ooooooooooooo',
]

function arrowCluster(): Icon {
  return icon(13, (c) => art(c, ARROW_KEYS, { o: INK, f: WHITE, l: STEEL }))
}

const PAUSE_MARK = ['##.##', '##.##', '##.##', '##.##', '##.##']

function padIcon(name: string): Icon {
  switch (name) {
    case 'a': return disc('#0f3b1e', '#1f7a34', '#49b23c', '#1f7a34', 'A', WHITE)
    case 'b': return disc('#3c0507', '#d10713', '#ff6b6b', '#d10713', 'B', WHITE)
    case 'x': return disc('#0b2a6b', '#1456b8', '#109ff9', '#1456b8', 'X', WHITE)
    case 'y': return disc('#311107', '#f5c518', '#ffe866', '#f5c518', 'Y', '#311107')
    case 'start': return pill(MENU_MARK)
    case 'back': return pill(VIEW_MARK)
    case 'lb': case 'rb': return darkPlate(name.toUpperCase(), BUMPER)
    case 'lt': case 'rt': return darkPlate(name.toUpperCase(), TRIGGER)
    case 'dpad': return dpad(-1)
    case 'stick': return stick('L')
    case 'rs': return stick('R')
  }
  for (let d = 0; d < 4; d++) {
    if (name === 'dpad_' + DIRS[d]) return dpad(d)
    if (name === 'stick_' + DIRS[d]) return stick(d)
  }
  return darkPlate(name.toUpperCase(), PILL)
}

function touchIcon(name: string): Icon {
  const d = (DIRS as readonly string[]).indexOf(name)
  if (d >= 0) return disc(INK, WHITE, WHITE, STEEL, d, NAVY)
  if (name === 'dpad') return dpad(-1)
  if (name === 'pause') {
    return icon(9, (c) => {
      art(c, DISC, { o: INK, b: WHITE, h: WHITE, d: STEEL })
      art(c, PAUSE_MARK, { '#': NAVY }, 2, 2)
    })
  }
  if (name.length === 1) return disc(INK, WHITE, WHITE, STEEL, name.toUpperCase(), NAVY)
  return lightPlate(name.toUpperCase())
}

function keyIcon(label: string): Icon {
  if (label === 'ARROWS') return arrowCluster()
  const d = (DIRS as readonly string[]).indexOf(label.toLowerCase())
  return d >= 0 ? arrowKey(d) : keycap(label)
}

const KEY_ALIAS: Record<string, string> = {
  ARROWLEFT: 'LEFT', ARROWRIGHT: 'RIGHT', ARROWUP: 'UP', ARROWDOWN: 'DOWN', ESCAPE: 'ESC', RETURN: 'ENTER',
  ' ': 'SPACE', SPACEBAR: 'SPACE', BACKSPACE: 'BKSP', CONTROL: 'CTRL', DELETE: 'DEL',
  SHIFTLEFT: 'SHIFT', SHIFTRIGHT: 'SHIFT',
}
const PAD_ALIAS: Record<string, string> = {
  menu: 'start', view: 'back', select: 'back', ls: 'stick', lstick: 'stick', rstick: 'rs',
  left: 'dpad_left', right: 'dpad_right', up: 'dpad_up', down: 'dpad_down',
}

/** One spelling per glyph: 'pad_<lower>', 'touch_<lower>', 'key_<UPPER>'. */
function normalizeId(raw: string): string {
  const cut = raw.indexOf('_')
  const kind = cut < 0 ? '' : raw.slice(0, cut).toLowerCase()
  const rest = raw.slice(cut + 1)
  if (kind === 'pad') {
    const name = rest.toLowerCase()
    return 'pad_' + (PAD_ALIAS[name] ?? name)
  }
  if (kind === 'touch') return 'touch_' + rest.toLowerCase()
  let label = (kind === 'key' ? rest : raw).toUpperCase()
  label = KEY_ALIAS[label] ?? label
  if (/^KEY[A-Z]$/.test(label) || /^DIGIT\d$/.test(label)) label = label.slice(-1)
  return 'key_' + label
}

function makeIcon(id: string): Icon {
  if (id.startsWith('pad_')) return padIcon(id.slice(4))
  if (id.startsWith('touch_')) return touchIcon(id.slice(6))
  return keyIcon(id.slice(4))
}

/** A whole D-pad, stick or arrow cluster asked for one direction becomes that direction's glyph. */
function directional(id: string, dir: number): string {
  if (id === 'pad_dpad' || id === 'pad_stick') return id + '_' + DIRS[dir]
  if (id === 'key_ARROWS') return 'key_' + DIRS[dir].toUpperCase()
  if (id === 'touch_dpad') return 'touch_' + DIRS[dir]
  return id
}

function renderIcon(ic: Icon): HTMLCanvasElement {
  const cv = makeCanvas(ic.w, ic.h)
  ic.paint(cv.getContext('2d')!)
  return cv
}

const MAX_SILHOUETTES = 8

function silhouette(ic: Icon, color: string, fat: boolean): HTMLCanvasElement {
  const map = fat ? (ic.fat ??= new Map()) : (ic.thin ??= new Map())
  let cv = map.get(color)
  if (!cv) {
    const grow = fat ? 2 : 0
    if (map.size >= MAX_SILHOUETTES) {
      // Full: the oldest one is repainted, so a colour that keeps changing makes no new canvases.
      const oldest: string = map.keys().next().value!
      cv = map.get(oldest)!
      map.delete(oldest)
    } else {
      cv = makeCanvas(ic.w + grow, ic.h + grow)
    }
    const c = cv.getContext('2d')!
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, cv.width, cv.height)
    for (let dy = 0; dy <= grow; dy++) for (let dx = 0; dx <= grow; dx++) c.drawImage(ic.art!, dx, dy)
    c.globalCompositeOperation = 'source-in'
    c.fillStyle = DEFAULT_COLOR
    c.fillStyle = color
    c.fillRect(0, 0, cv.width, cv.height)
    map.set(color, cv)
  }
  return cv
}

function drawIcon(g: Ctx, ic: Icon, x: number, y: number, s: number, outline: string, shadow: string): void {
  if (!ic.art) ic.art = renderIcon(ic)
  const w = ic.w
  const h = ic.h
  // Centred on the capitals: a 9 px icon pokes one pixel above and one below.
  const top = y + ((7 - h) >> 1) * s
  if (shadow) {
    if (outline) g.drawImage(silhouette(ic, shadow, true), x, top, (w + 2) * s, (h + 2) * s)
    else g.drawImage(silhouette(ic, shadow, false), x + s, top + s, w * s, h * s)
  }
  if (outline) g.drawImage(silhouette(ic, outline, true), x - s, top - s, (w + 2) * s, (h + 2) * s)
  g.drawImage(ic.art, x, top, w * s, h * s)
}

/* ------------------------------------------------------------------ */
/* Reading a string                                                    */
/* ------------------------------------------------------------------ */

// A string becomes a run of codes: a glyph index (>= 0), NL, an action whose
// prompt is looked up at draw time (ACT - action index), or an icon (ICON - slot).
const NL = -1
const ACT = -2
const ICON = -100
// The game uses a few dozen icons. The cap only matters if ids are being made up without end.
const MAX_ICONS = 512
const MAX_PARSED = 400

const ACTION_INDEX = new Map<string, number>()
const ACTION_DIR = new Int8Array(ACTIONS.length).fill(-1)
ACTIONS.forEach((a, i) => {
  ACTION_INDEX.set(a, i)
  ACTION_DIR[i] = (DIRS as readonly string[]).indexOf(a)
})
// {move} asks for the whole D-pad or arrow cluster. It is not one of the
// contract's actions, so it gets the index after the last of them.
const MOVE = ACTIONS.length
ACTION_INDEX.set('move', MOVE)
const MOVE_GLYPH: Record<string, GlyphId> = { gamepad: 'pad_dpad', keyboard: 'key_ARROWS', touch: 'touch_dpad' }
const ARROW_GLYPH = DIRS.map((d) => TOKEN_GLYPH.get('arrow_' + d)!)
/** What an action shows before bindGlyphs(): the keyboard's keys. */
const UNBOUND: Record<string, GlyphId> = {
  jump: 'key_Z', spray: 'key_X', confirm: 'key_ENTER', cancel: 'key_ESC', pause: 'key_ENTER', select: 'key_TAB',
}

const icons: Icon[] = []
const iconSlot = new Map<string, number>()
/** Raw id (as the input module spells it) to icon code. */
const idCode = new Map<string, number>()
const dirCode = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>(), new Map<string, number>()]

function slotCode(id: string): number {
  let slot = iconSlot.get(id)
  if (slot === undefined) {
    // Past the cap everything new is slot 0, the blank key.
    if (icons.length >= MAX_ICONS) return ICON
    slot = icons.length
    icons.push(makeIcon(id))
    iconSlot.set(id, slot)
  }
  return ICON - slot
}
slotCode('key_?')

function codeOfId(raw: string, dir: number): number {
  const cache = dir < 0 ? idCode : dirCode[dir]
  let code = cache.get(raw)
  if (code === undefined) {
    const id = normalizeId(raw)
    code = slotCode(dir < 0 ? id : directional(id, dir))
    if (cache.size >= MAX_ICONS) cache.clear()
    cache.set(raw, code)
  }
  return code
}

let bound: InputApi | null = null
// What the caches remember instead of the InputApi itself, so a game that has been
// closed is not kept alive by a remembered line. 0 is "nothing bound".
let boundId = 0
let nextInputId = 1
const inputIds = new WeakMap<InputApi, number>()

/** Tell the text module where to look up button prompts. Pass null when the game shuts down. */
export function bindGlyphs(input: InputApi | null): void {
  bound = input
  boundId = 0
  if (input) {
    boundId = inputIds.get(input) ?? 0
    if (!boundId) inputIds.set(input, (boundId = nextInputId++))
  }
}

/** An action code to what it draws right now: a glyph index or an icon code. */
function resolveAction(a: number): number {
  if (a === MOVE) {
    // An InputApi that only knows the contract's actions answers nothing here: fall back on its device.
    const id: unknown = bound ? bound.glyph('move' as Action) || MOVE_GLYPH[bound.device] : MOVE_GLYPH.keyboard
    return codeOfId(typeof id === 'string' && id ? id : MOVE_GLYPH.keyboard, -1)
  }
  const dir = ACTION_DIR[a]
  const id: unknown = bound ? bound.glyph(ACTIONS[a]) : dir < 0 ? UNBOUND[ACTIONS[a]] : ''
  // No answer (or not a string, from a stand-in that does not know the action): a plain arrow, or a blank key.
  if (typeof id !== 'string' || !id) return dir < 0 ? codeOfId('key_?', -1) : ARROW_GLYPH[dir]
  return codeOfId(id, dir)
}

function tokenCode(name: string): number {
  // Copy is written in capitals, so {JUMP} must work as well as {jump}.
  const key = name.toLowerCase()
  const a = ACTION_INDEX.get(key)
  if (a !== undefined) return ACT - a
  const glyph = TOKEN_GLYPH.get(key)
  if (glyph !== undefined) return glyph
  return /^(pad|key|touch)_./i.test(name) ? codeOfId(name, -1) : NONE
}

const parsed = new Map<string, Int16Array>()

function parse(text: string): Int16Array {
  let codes = parsed.get(text)
  if (codes) return codes
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 10) {
      out.push(NL)
      continue
    }
    if (ch === 123) {
      const close = text.indexOf('}', i + 1)
      const code = close > i + 1 ? tokenCode(text.slice(i + 1, close)) : NONE
      if (code !== NONE) {
        out.push(code)
        i = close
        continue
      }
    }
    const glyph = ch < 128 ? CHAR_GLYPH[ch] : glyphOfWide(ch)
    if (glyph !== NONE) out.push(glyph)
  }
  codes = Int16Array.from(out)
  if (parsed.size >= MAX_PARSED) parsed.clear()
  parsed.set(text, codes)
  return codes
}

let scratch = new Int16Array(256)
let codes: Int16Array = scratch

/** Fill `codes` for a string and return how many there are. Plain strings (no tokens) allocate nothing. */
function scan(text: string): number {
  if (text.indexOf('{') >= 0) {
    codes = parse(text)
    return codes.length
  }
  const n = text.length
  if (scratch.length < n) scratch = new Int16Array(n * 2)
  let m = 0
  for (let i = 0; i < n; i++) {
    const ch = text.charCodeAt(i)
    if (ch < 128) {
      scratch[m++] = ch === 10 ? NL : CHAR_GLYPH[ch]
    } else {
      const glyph = glyphOfWide(ch)
      if (glyph !== NONE) scratch[m++] = glyph
    }
  }
  codes = scratch
  return m
}

/** Width of one item in font pixels, without the gap that follows it. */
function widthOf(code: number): number {
  if (code < 0 && code > ICON) code = resolveAction(ACT - code)
  return code >= 0 ? GW[code] : icons[ICON - code].w
}

/* ------------------------------------------------------------------ */
/* Drawing and measuring                                               */
/* ------------------------------------------------------------------ */

const NO_OPTS: TextStyle = {}

const MAX_SCALE = 48

function wholeScale(scale: number | undefined): number {
  return scale! >= 1 ? Math.min(MAX_SCALE, Math.round(scale!)) : 1
}

/** Draw codes[from..to) as one line starting at (px, py), one blit per glyph. */
function drawRun(g: Ctx, src: Int16Array, from: number, to: number, px: number, py: number, s: number, sheet: HTMLCanvasElement, outline: string, shadow: string, gap: number): void {
  for (let j = from; j < to; j++) {
    let code = src[j]
    if (code < 0 && code > ICON) code = resolveAction(ACT - code)
    if (code >= 0) {
      const w = GW[code]
      if (code !== SPACE) {
        g.drawImage(sheet, (code % COLS) * CELL, ((code / COLS) | 0) * CELL, w + 3, CELL, px - s, py - s, (w + 3) * s, CELL * s)
      }
      px += (w + gap) * s
    } else {
      const ic = icons[ICON - code]
      drawIcon(g, ic, px, py, s, outline, shadow)
      px += (ic.w + gap) * s
    }
  }
}

// A line that keeps being drawn (a label, a menu row, the score while it stands
// still) is kept whole in one atlas, outline and shadow included, so drawing it
// again is one blit however long it is. A glyph blit costs a few microseconds,
// so thousands of drawText calls a frame only fit if most of them are one blit.
// Not kept: text drawn fewer than three times (a counter that never stands
// still would only churn the atlas). Text with '\n' in it is kept line by line.
// A line holding {action} prompts is kept for the InputApi and device it was
// drawn with, on the contract's word that a prompt depends on nothing else.
const ATLAS_W = 1024
/** A strip holds one line at scale 1: two rows above the capitals (an outlined icon) to the shadow under a tail. */
const STRIP_H = 12
const ATLAS_ROWS = 48
const KEEP_AFTER = 3
/** Strips kept per text: its colour, outline and shadow combinations, times the devices seen. */
const MAX_STYLES = 8
const NEVER = -1

interface Strip {
  color: string
  outline: string
  shadow: string
  gap: number
  x: number
  y: number
  /** Width of the line in font pixels, as measureText counts it. */
  w: number
  /** Holds {action} prompts: only good for this InputApi (by id) on this device. */
  live: boolean
  input: number
  device: string
}

let atlas: HTMLCanvasElement | null = null
let atlasCtx: Ctx | null = null
let atlasRow = 0
let atlasX = 0
const kept = new Map<string, Strip[]>()
/** How often a text that is not kept yet has been drawn, or NEVER for one that cannot be kept. */
const sightings = new Map<string, number>()
/** Text with line breaks that has been seen often enough, cut into its lines (each kept on its own). */
const broken = new Map<string, string[]>()

function forgetLines(): void {
  atlasCtx?.clearRect(0, 0, ATLAS_W, STRIP_H * ATLAS_ROWS)
  kept.clear()
  atlasRow = atlasX = 0
}

/** Put a line in the atlas if it has earned its place. Returns its strip, or null to draw it glyph by glyph. */
function keepLine(text: string, strips: Strip[] | undefined, color: string, outline: string, shadow: string, gap: number): Strip | null {
  if (strips) {
    if (strips.length >= MAX_STYLES) {
      // Prompts drawn for an InputApi that is no longer bound will not be asked for again.
      for (let k = strips.length - 1; k >= 0; k--) if (strips[k].live && strips[k].input !== boundId) strips.splice(k, 1)
      if (strips.length >= MAX_STYLES) return null
    }
  } else {
    const seen = sightings.get(text)
    if (seen === NEVER) return null
    if (seen === undefined || seen + 1 < KEEP_AFTER) {
      if (seen === undefined && sightings.size >= 512) sightings.clear()
      sightings.set(text, (seen ?? 0) + 1)
      return null
    }
  }
  const n = scan(text)
  const src = codes
  let w = -gap
  let live = false
  for (let i = 0; i < n; i++) {
    let code = src[i]
    if (code === NL) {
      if (broken.size >= 256) broken.clear()
      broken.set(text, text.split('\n'))
      sightings.delete(text)
      return null
    }
    if (code < 0 && code > ICON) {
      code = resolveAction(ACT - code)
      live = true
    }
    w += (code >= 0 ? GW[code] : icons[ICON - code].w) + gap
  }
  // Negative spacing can push glyphs out of the strip's left edge; one glyph is one blit either way.
  if (n < 2 || gap < 1 || !(w >= 1) || w + 3 > ATLAS_W) {
    if (!strips) sightings.set(text, NEVER)
    return null
  }
  if (!atlas) {
    atlas = makeCanvas(ATLAS_W, STRIP_H * ATLAS_ROWS)
    // Read-back hint: it keeps the atlas in ordinary memory, where a graphics driver reset cannot blank it.
    atlasCtx = atlas.getContext('2d', { willReadFrequently: true })!
    atlasCtx.imageSmoothingEnabled = false
    atlas.addEventListener('contextrestored', forgetLines)
  }
  if (atlasX + w + 3 > ATLAS_W) {
    atlasRow++
    atlasX = 0
  }
  if (atlasRow >= ATLAS_ROWS) {
    // Full: start over. Whatever is still on screen earns its strip back within a few frames.
    forgetLines()
    strips = undefined
  }
  const strip: Strip = { color, outline, shadow, gap, x: atlasX, y: atlasRow * STRIP_H, w, live, input: boundId, device: bound ? bound.device : '' }
  atlasX += w + 3
  drawRun(atlasCtx!, src, 0, n, strip.x + 1, strip.y + 2, 1, sheetFor(color, outline, shadow), outline, shadow, gap)
  if (strips) {
    strips.push(strip)
  } else {
    kept.set(text, [strip])
    sightings.delete(text)
  }
  return strip
}

/** One text at (x0, py): a single blit if it is kept, else glyph by glyph (which also copes with line breaks). */
function drawPlaced(g: Ctx, text: string, strips: Strip[] | undefined, x0: number, py: number, s: number, color: string, outline: string, shadow: string, gap: number, align: string | undefined, lineH: number): void {
  let strip: Strip | null = null
  if (strips) {
    for (let k = 0; k < strips.length; k++) {
      const st = strips[k]
      if (st.color !== color || st.outline !== outline || st.shadow !== shadow || st.gap !== gap) continue
      if (st.live && (st.input !== boundId || st.device !== (bound ? bound.device : ''))) continue
      strip = st
      break
    }
  }
  if (!strip) strip = keepLine(text, strips, color, outline, shadow, gap)
  if (strip) {
    const w = strip.w * s
    const px = align === 'center' ? x0 - (w >> 1) : align === 'right' ? x0 - w : x0
    g.drawImage(atlas!, strip.x, strip.y, strip.w + 3, STRIP_H, px - s, py - 2 * s, w + 3 * s, STRIP_H * s)
    return
  }
  const n = scan(text)
  const src = codes
  const sheet = sheetFor(color, outline, shadow)
  let i = 0
  while (i < n) {
    let end = i
    while (end < n && src[end] !== NL) end++
    let px = x0
    if (align === 'center' || align === 'right') {
      let w = 0
      for (let j = i; j < end; j++) w += widthOf(src[j]) + gap
      if (end > i) w -= gap
      px = align === 'center' ? x0 - ((w * s) >> 1) : x0 - w * s
    }
    drawRun(g, src, i, end, px, py, s, sheet, outline, shadow, gap)
    i = end + 1
    py += lineH
  }
}

/**
 * Draw pixel text with its top-left at (x, y) (or centred / right-aligned on x).
 * `{action}` tokens such as {jump} or {spray} become the button prompt for the
 * device in use once bindGlyphs() has been called. '\n' starts a new line.
 */
export function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, opts: TextStyle = NO_OPTS): void {
  if (!text) return
  const s = wholeScale(opts.scale)
  const color = opts.color || DEFAULT_COLOR
  const outline = opts.outline || ''
  const shadow = opts.shadow || ''
  const align = opts.align
  // Whole pixels only, like everything else here.
  const gap = 1 + (opts.spacing! | 0)
  const lineH = Math.round((opts.lineHeight ?? LINE_H) * s)
  const x0 = Math.round(x)
  const y0 = Math.round(y)
  const smooth = g.imageSmoothingEnabled
  if (smooth) g.imageSmoothingEnabled = false
  const strips = kept.get(text)
  const parts = strips ? undefined : broken.get(text)
  if (parts) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part) drawPlaced(g, part, kept.get(part), x0, y0 + i * lineH, s, color, outline, shadow, gap, align, lineH)
    }
  } else {
    drawPlaced(g, text, strips, x0, y0, s, color, outline, shadow, gap, align, lineH)
  }
  if (smooth) g.imageSmoothingEnabled = true
}

/** Width in pixels of the widest line, exactly as drawText lays it out (shadow and outline not counted). */
export function measureText(text: string, scale = 1, spacing = 0): number {
  if (!text) return 0
  const n = scan(text)
  const src = codes
  const gap = 1 + (spacing | 0)
  let best = 0
  let w = 0
  for (let i = 0; i <= n; i++) {
    if (i === n || src[i] === NL) {
      if (w - gap > best) best = w - gap
      w = 0
    } else {
      w += widthOf(src[i]) + gap
    }
  }
  return best * wholeScale(scale)
}

/** Height in pixels of a block of text: its lines at `lineHeight`, the last one a full glyph cell. */
export function measureHeight(text: string, scale = 1, lineHeight = LINE_H): number {
  let lines = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++
  const s = wholeScale(scale)
  return (lines - 1) * Math.round(lineHeight * s) + GLYPH_H * s
}

/** A word cut into pieces that may not be split further: single characters and whole {tokens}. */
function units(word: string): string[] {
  const out: string[] = []
  for (let i = 0; i < word.length; i++) {
    const close = word[i] === '{' ? word.indexOf('}', i + 1) : -1
    if (close > i + 1 && tokenCode(word.slice(i + 1, close)) !== NONE) {
      out.push(word.slice(i, close + 1))
      i = close
    } else {
      out.push(word[i])
    }
  }
  return out
}

interface Wrapped {
  maxWidth: number
  scale: number
  spacing: number
  input: number
  device: string
  lines: string[]
}
/** A few layouts per text: the same words are sometimes wrapped at two widths in one frame. */
const wrapped = new Map<string, Wrapped[]>()

/**
 * Break text into lines no wider than maxWidth pixels at the given scale.
 * Breaks at spaces, keeps '\n', never splits a {token}; a single word wider
 * than the line is cut. Spaces inside a line are kept as typed, spaces at a
 * line's ends are dropped. Join the result with '\n' for drawText, or draw the
 * lines one by one. Results are remembered (and follow the device in use, since
 * prompts differ in width), so calling this every frame is fine: do not modify
 * the array it returns.
 */
export function wrapText(text: string, maxWidth: number, scale = 1, spacing = 0): string[] {
  const device = bound ? bound.device : ''
  let hits = wrapped.get(text)
  if (hits) {
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]
      if (h.maxWidth === maxWidth && h.scale === scale && h.spacing === spacing && h.input === boundId && h.device === device) return h.lines
    }
  }
  const limit = Math.max(1, Math.floor(maxWidth / wholeScale(scale)))
  const gap = 1 + (spacing | 0)
  const spaceW = GW[SPACE] + gap
  const lines: string[] = []
  for (const para of text.split('\n')) {
    const n = para.length
    let line = ''
    let lineW = 0
    let i = 0
    while (i < n) {
      const start = i
      let from = i
      while (from < n && para.charCodeAt(from) === 32) from++
      let to = from
      while (to < n && para.charCodeAt(to) !== 32) {
        // {key_ } has a space inside it and is still one piece.
        const close = para.charCodeAt(to) === 123 ? para.indexOf('}', to + 1) : -1
        if (close > to + 1 && tokenCode(para.slice(to + 1, close)) !== NONE) to = close
        to++
      }
      if (to === from) break
      const word = para.slice(from, to)
      const w = measureText(word, 1, spacing)
      i = to
      // What the spaces before the word and the word itself add to a line that already has something on it.
      const add = gap + (from - start) * spaceW + w
      if (line && lineW + add <= limit) {
        line += para.slice(start, to)
        lineW += add
        continue
      }
      if (line) lines.push(line)
      line = word
      lineW = w
      if (w <= limit) continue
      line = ''
      lineW = 0
      for (const u of units(word)) {
        const uw = measureText(u, 1, spacing)
        if (line && lineW + gap + uw > limit) {
          lines.push(line)
          line = ''
          lineW = 0
        }
        lineW += (line ? gap : 0) + uw
        line += u
      }
    }
    lines.push(line)
  }
  if (!hits) {
    if (wrapped.size >= 64) wrapped.clear()
    wrapped.set(text, (hits = []))
  }
  if (hits.length >= 4) hits.shift()
  hits.push({ maxWidth, scale, spacing, input: boundId, device, lines })
  return lines
}

/** Cache sizes, for the debug overlay and the dev page's checks. `canvases` counts every canvas this module ever made. */
export function textStats(): { sheets: number; sheetCap: number; lines: number; atlasRows: number; icons: number; parsed: number; wrapped: number; canvases: number } {
  return {
    sheets: sheetRing.length, sheetCap: MAX_SHEETS, lines: kept.size, atlasRows: atlasRow + (atlasX > 0 ? 1 : 0),
    icons: icons.length, parsed: parsed.size, wrapped: wrapped.size, canvases: canvasesMade,
  }
}
