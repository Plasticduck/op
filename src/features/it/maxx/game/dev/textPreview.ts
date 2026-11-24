// Dev page (dev/maxx-text.html): every character, prompt icon and UI piece on
// one page, so the font can be judged by eye and screenshotted.
//   ?sheet=charset|sentences|prompts|ui   one sheet only
//   ?zoom=3                               CSS pixels per game pixel (default 2)
// The ui sheet is live and runs on the game's real input module: a keyboard, an
// Xbox controller or the touch strip under the status line move the menus, and
// every prompt follows the device last touched. window.__maxxText has hooks for
// check scripts.
import { ACTIONS } from '../contract'
import type { Action, ActionState, AudioApi, GlyphId, InputApi, InputDevice, InputFrame, SfxId, Sprites } from '../contract'
import { createInput } from '../engine/input'
import { FONT_CHARS, GLYPH_IDS, LINE_H, SYMBOL_TOKENS, bindGlyphs, drawText, measureHeight, measureText, textStats, wrapText } from '../engine/text'
import { METER, PAL, PANEL, blink, clockText, counter, createMenu, drawBlinkText, frame, meter, nineSlice, panel, stepRect, textPanel } from '../engine/ui'

type G = CanvasRenderingContext2D

/* ------------------------------------------------------------------ */
/* Input and audio                                                     */
/* ------------------------------------------------------------------ */

// Fixed stand-ins, so the prompts sheet can show every device side by side.
const PAD_GLYPHS: Record<Action, GlyphId> = {
  left: 'pad_dpad', right: 'pad_dpad', up: 'pad_dpad', down: 'pad_dpad',
  jump: 'pad_a', spray: 'pad_x', confirm: 'pad_a', cancel: 'pad_b', pause: 'pad_start', select: 'pad_back',
}
const STICK_GLYPHS: Record<Action, GlyphId> = { ...PAD_GLYPHS, left: 'pad_stick', right: 'pad_stick', up: 'pad_stick', down: 'pad_stick' }
const KEY_GLYPHS: Record<Action, GlyphId> = {
  left: 'key_ARROWS', right: 'key_ARROWS', up: 'key_ARROWS', down: 'key_ARROWS',
  jump: 'key_Z', spray: 'key_X', confirm: 'key_ENTER', cancel: 'key_ESC', pause: 'key_ENTER', select: 'key_TAB',
}
const TOUCH_GLYPHS: Record<Action, GlyphId> = {
  left: 'touch_left', right: 'touch_right', up: 'touch_up', down: 'touch_down',
  jump: 'touch_a', spray: 'touch_b', confirm: 'touch_a', cancel: 'touch_b', pause: 'touch_pause', select: 'touch_pause',
}

function noActions(): ActionState {
  const s = {} as ActionState
  for (const a of ACTIONS) s[a] = false
  return s
}

function emptyFrame(device: InputDevice): InputFrame {
  return { held: noActions(), pressed: noActions(), released: noActions(), repeat: noActions(), axisX: 0, axisY: 0, device }
}

function fakeInput(device: InputDevice, glyphs: Record<Action, GlyphId>): InputApi {
  return {
    poll: () => emptyFrame(device),
    device,
    gamepadConnected: device === 'gamepad',
    rumble() {},
    setRumbleEnabled() {},
    glyph: (a) => (a === 'move' ? '' : glyphs[a]),
    touchUsed() {},
    destroy() {},
  }
}

const PAD = fakeInput('gamepad', PAD_GLYPHS)
const PAD_STICK = fakeInput('gamepad', STICK_GLYPHS)
const KEYS = fakeInput('keyboard', KEY_GLYPHS)
const TOUCH = fakeInput('touch', TOUCH_GLYPHS)

// The real thing: what the game binds to the text module.
const input = createInput()

let lastSfx = 'NONE'
const sfxLog: SfxId[] = []
const audio: AudioApi = {
  unlock() {},
  locked: false,
  sfx(id) {
    lastSfx = id.toUpperCase()
    sfxLog.push(id)
  },
  spray() {},
  music() {},
  jingle() {},
  stopJingle() {},
  setTempoScale() {},
  setVolumes() {},
  setPaused() {},
  preload() {},
  destroy() {},
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

const W = 640
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const PUNCT = FONT_CHARS.split('').filter((c) => !/[A-Z0-9]/.test(c)).join(' ')
const SYMBOLS = SYMBOL_TOKENS.map((t) => `{${t}}`).join(' ')

function label(g: G, text: string, x: number, y: number, color: string = PAL.yellow[1]): void {
  drawText(g, text, x, y, { color })
}

function charset(g: G): void {
  const half = 300
  const sides = [
    { y: 0, bg: PAL.blue[4], ink: PAL.navy, note: PAL.blue[1] },
    { y: half, bg: PAL.navy, ink: PAL.white, note: PAL.yellow[1] },
  ]
  for (const side of sides) {
    g.fillStyle = side.bg
    g.fillRect(0, side.y, W, half)
    let y = side.y + 8
    for (const scale of [1, 2, 3]) {
      label(g, `SCALE ${scale}`, 8, y, side.note)
      y += 12
      for (const line of [LETTERS, `${DIGITS}  ${PUNCT}`, SYMBOLS]) {
        // The punctuation line is long: at scale 3 it would run off the sheet.
        for (const part of wrapText(line, W - 16, scale)) {
          drawText(g, part, 8, y, { color: side.ink, scale })
          y += LINE_H * scale
        }
      }
      y += 6
    }
  }
}
charset.h = 600

// Characters from outside the font, spelled by code so this file stays plain ASCII:
// a CJK character (no glyph: a box), accented names, curly quotes and a long dash.
const FOREIGN = String.fromCharCode(0x65e5)
const ACCENTED = `Jos${String.fromCharCode(0xe9)} Pe${String.fromCharCode(0xf1)}a, Zo${String.fromCharCode(0xeb)}`
const CURLY = `${String.fromCharCode(0x201c)}CURLY${String.fromCharCode(0x201d)} ${String.fromCharCode(0x2013)} DASH`

const PARAGRAPH =
  'MAXX CARRIES A PREP GUN. HOLD {spray} TO SOAK A DIRTY CAR UNTIL IT SHINES, THEN RIDE ITS ROOF. A CLEAN CAR IS A HAPPY CAR!'

function sentences(g: G): void {
  g.fillStyle = PAL.navy
  g.fillRect(0, 0, W, 250)
  g.fillStyle = PAL.blue[3]
  g.fillRect(0, 250, W, 110)
  g.fillStyle = PAL.wood[5]
  g.fillRect(0, 360, W, 60)

  label(g, 'LOOKALIKES', 8, 6)
  drawText(g, '0O 1I 5S 8B 2Z 6G UV DO Q0 CG 38', 8, 18, { scale: 3 })
  drawText(g, '0O 1I 5S 8B 2Z 6G UV DO Q0 CG 7T 4A 9P 3E 38 KR', 8, 50, { scale: 2 })
  drawText(g, '0O 1I 5S 8B 2Z 6G UV DO Q0 CG 7T 4A 9P 3E 38  O0O0  I1I1  S5S5  B8B8  Z2Z2  3838  1!|I', 8, 72)

  label(g, 'SENTENCES', 8, 90)
  drawText(g, 'SPHINX OF BLACK QUARTZ, JUDGE MY VOW.', 8, 102, { scale: 2 })
  drawText(g, 'THE QUICK BROWN FOX JUMPS OVER A LAZY DOG. 0123456789', 8, 124)
  drawText(g, 'lowercase input draws as capitals: Mighty Wash, est. 2019', 8, 136, { color: PAL.blue[4] })
  drawText(g, 'IT\'S A "WASH"; ISN\'T IT? 100% CLEAN! (MAXX & CO.) #1 @ $5 + TAX = <3', 8, 148, { color: PAL.yellow[2] })
  drawText(g, 'MW01 GRAND OPENING   CARS WASHED 12/14   TIME 3:45   SCORE 0012500   1UP', 8, 160)
  drawText(g, `{heart}{times}03  {coin}{times}47  {drop}{drop}{drop}  {star} SPOTLESS  {check} DONE  {lock} LOCKED  {pointer} NEXT`, 8, 172, { color: PAL.blue[4] })

  label(g, 'SHADOW, OUTLINE, SPACING', 8, 190)
  drawText(g, 'SHADOW', 8, 202, { scale: 2, shadow: PAL.black })
  drawText(g, 'OUTLINE', 120, 202, { scale: 2, outline: PAL.black, color: PAL.yellow[2] })
  drawText(g, 'BOTH', 250, 202, { scale: 2, outline: PAL.red[1], shadow: PAL.black, color: PAL.white })
  drawText(g, 'WIDE', 340, 202, { scale: 2, spacing: 2, color: PAL.teal[2] })
  drawText(g, 'PRESS {jump} OR {pause}', 440, 202, { scale: 2, outline: PAL.black, shadow: PAL.blue[0] })
  drawText(g, 'small with shadow 0123456789 {heart}{coin}{star}', 8, 228, { shadow: PAL.black })
  drawText(g, 'small with outline 0123456789 {heart}{coin}{star}', 320, 228, { outline: PAL.black, color: PAL.yellow[2] })

  // On sky: the banner, alignment about a guide line, and a wrapped paragraph.
  drawText(g, 'GRIMED!', 140, 262, { scale: 4, align: 'center', color: PAL.mud[3], outline: PAL.outline, shadow: PAL.mud[0] })
  drawText(g, 'SPOTLESS! +3000', 140, 308, { scale: 2, align: 'center', color: PAL.white, outline: PAL.blue[0] })
  drawText(g, 'MW03 TUNNEL VISION', 140, 334, { align: 'center', color: PAL.navy })
  g.fillStyle = PAL.red[4]
  g.fillRect(330, 254, 1, 74)
  drawText(g, 'LEFT ON THE LINE\nTWO LINES', 330, 256, { color: PAL.navy })
  drawText(g, 'CENTRED\nON THE LINE {jump}', 330, 281, { color: PAL.navy, align: 'center' })
  drawText(g, 'RIGHT\nAGAINST IT', 330, 306, { color: PAL.blue[0], align: 'right' })
  const boxX = 456
  const boxW = 176
  const lines = wrapText(PARAGRAPH, boxW - 8, 1)
  frame(g, boxX, 256, boxW, lines.length * LINE_H + 8, PAL.blue[1])
  drawText(g, lines.join('\n'), boxX + 4, 261, { color: PAL.navy })

  drawText(g, 'DARK ON WOOD: HOLD {down} + {spray} TO HOVER. 0O 1I 5S 8B 2Z 38', 8, 368, { color: PAL.wood[0] })
  drawText(g, 'WASH {times}3 CHAIN!', 8, 384, { scale: 2, color: PAL.white, outline: PAL.wood[0] })
  drawText(g, `UNKNOWN {token} STAYS AS TYPED. TABS\tAND ${FOREIGN} FALL BACK.`, 250, 382, { color: PAL.wood[0] })
  drawText(g, `NAMES KEEP THEIR LETTERS: ${ACCENTED}. ${CURLY}`, 250, 394, { color: PAL.wood[0] })
}
sentences.h = 420

const DEVICES: [string, InputApi | null][] = [
  ['XBOX PAD (D-PAD)', PAD], ['XBOX PAD (STICK)', PAD_STICK], ['KEYBOARD', KEYS], ['TOUCH', TOUCH], ['NOT BOUND', null],
]
const HOW_TO = '{move} MOVE  {left}{right} RUN  {up} AIM  {down}+{spray} HOVER  {jump} JUMP  {spray} SPRAY  {pause} PAUSE  {select} MAP  {confirm} OK  {cancel} BACK'

function prompts(g: G): void {
  g.fillStyle = PAL.navy
  g.fillRect(0, 0, W, prompts.h)
  label(g, 'EVERY GLYPH ID AT SCALE 1, 2, 3', 8, 6)
  const rows = Math.ceil(GLYPH_IDS.length / 2)
  GLYPH_IDS.forEach((id, i) => {
    const x = 8 + Math.floor(i / rows) * 320
    const y = 24 + (i % rows) * 30
    const token = `{${id}}`
    drawText(g, token, x, y + 9)
    drawText(g, token, x + 32, y + 5, { scale: 2 })
    drawText(g, token, x + 92, y, { scale: 3 })
    drawText(g, id, x + 176, y + 9, { color: PAL.blue[4] })
  })
  let y = 24 + rows * 30 + 6

  const strip = GLYPH_IDS.map((id) => `{${id}}`).join(' ')
  const grounds: [string, string][] = [[PAL.blue[3], PAL.navy], [PAL.wood[5], PAL.wood[0]], [PAL.white, PAL.navy], [PAL.black, PAL.white], [PAL.green[2], PAL.navy]]
  for (const [bg, ink] of grounds) {
    const lines = wrapText(strip + '  ANY KEY: {key_K} {key_J} {key_P} {key_M} {key_F} {key_W}{key_A}{key_S}{key_D} {key_1} {key_F5} {pad_home} {touch_jump}', W - 16, 1)
    g.fillStyle = bg
    g.fillRect(0, y, W, lines.length * 12 + 8)
    drawText(g, lines.join('\n'), 8, y + 5, { color: ink, lineHeight: 12 })
    y += lines.length * 12 + 8
  }

  g.fillStyle = PAL.navy
  g.fillRect(0, y, W, prompts.h - y)
  y += 8
  label(g, 'THE SAME TEXT ON EACH DEVICE', 8, y)
  y += 14
  for (const [name, api] of [...DEVICES, [`THE GAME'S INPUT MODULE, LIVE: ${input.device.toUpperCase()}`, input] as [string, InputApi]]) {
    bindGlyphs(api)
    drawText(g, name, 8, y, { color: PAL.blue[3] })
    y += 12
    for (const line of wrapText(HOW_TO, W - 16, 1)) {
      drawText(g, line, 8, y + 1)
      y += 13
    }
    for (const line of wrapText('HOLD {up} + {spray} TO AIM UP. PRESS {jump} TWICE? NO: HOLD {jump} TO JUMP HIGHER.', W - 16, 2)) {
      drawText(g, line, 8, y + 3, { scale: 2, shadow: PAL.black })
      y += 24
    }
    y += 6
  }
  bindGlyphs(input)
}
prompts.h = 1320

// A stand-in sprite sheet with one 16 px crate frame, so the 9-slice has something to cut.
let crate: HTMLCanvasElement | null = null
const sprites: Sprites = {
  has: (n) => n === 'demo/crate',
  draw() {},
  frame: (n) => (n === 'demo/crate' ? { x: 0, y: 0, w: 16, h: 16 } : null),
  source(n) {
    if (n !== 'demo/crate') return null
    if (!crate) {
      crate = document.createElement('canvas')
      crate.width = crate.height = 16
      const c = crate.getContext('2d')!
      stepRect(c, 0, 0, 16, 16, 2, PAL.outline)
      stepRect(c, 1, 1, 14, 14, 2, PAL.blue[2])
      c.fillStyle = PAL.blue[4]
      c.fillRect(3, 1, 10, 1)
      c.fillStyle = PAL.blue[1]
      c.fillRect(3, 14, 10, 1)
      c.fillStyle = PAL.blue[1]
      for (let i = 4; i < 12; i += 4) c.fillRect(i, 5, 2, 6)
      c.fillStyle = PAL.blue[3]
      c.fillRect(1, 4, 1, 8)
    }
    return { image: crate, frame: { x: 0, y: 0, w: 16, h: 16 } }
  },
  anim: () => [],
  atlas: () => null,
}

const settings = { music: 7, sfx: 9, rumble: true, shake: true }
let message = 'PICK SOMETHING'
const pauseMenu = createMenu({
  audio,
  items: [{ label: 'RESUME' }, { label: 'RESTART LEVEL' }, { label: 'OPTIONS' }, { label: 'EXIT TO MAP' }],
  onConfirm: (_i, item) => { message = `CHOSE ${item.label}` },
  onCancel: () => { message = 'BACK' },
})
const bump = (key: 'music' | 'sfx') => (dir: -1 | 1) => {
  const next = Math.max(0, Math.min(10, settings[key] + dir))
  if (next === settings[key]) return false
  settings[key] = next
}
const optionsMenu = createMenu({
  audio,
  wrap: false,
  items: [
    { label: 'MUSIC', value: () => String(settings.music), onAdjust: bump('music') },
    { label: 'SOUND', value: () => String(settings.sfx), onAdjust: bump('sfx') },
    { label: 'RUMBLE', value: () => (settings.rumble ? 'ON' : 'OFF'), onAdjust: () => { settings.rumble = !settings.rumble } },
    { label: 'SCREEN SHAKE', value: () => (settings.shake ? 'ON' : 'OFF'), onAdjust: () => { settings.shake = !settings.shake } },
    { label: 'CONTINUE', disabled: true },
    { label: 'ERASE SAVE', onSelect: () => { message = 'ERASED (NOT REALLY)' } },
  ],
  onCancel: () => { message = 'BACK FROM OPTIONS' },
})
let focus = 0

function ui(g: G, tick: number): void {
  g.fillStyle = PAL.blue[3]
  g.fillRect(0, 0, W, 360)
  g.fillStyle = PAL.green[2]
  g.fillRect(0, 300, W, 60)

  panel(g, 0, 0, W, 24, 'bar')
  drawText(g, `MAXX {heart}{times}03   {coin}{times}${counter(47, 2)}   SCORE ${counter(tick * 10, 7)}   TIME ${counter(300 - Math.floor(tick / 60) % 300, 3)}   BEST ${clockText(tick, true)}`, 10, 8, { shadow: PAL.black })
  meter(g, 520, 6, 40, 6, 2 / 3, { ...METER.shine, segments: 3 })
  drawText(g, 'SHINE', 566, 5, { color: PANEL.bar.dim })
  drawText(g, input.device.toUpperCase(), 630, 14, { align: 'right', color: PAL.yellow[2] })

  panel(g, 12, 30, 196, 138, 'dialog')
  drawText(g, 'PAUSED', 110, 40, { scale: 2, align: 'center', shadow: PAL.black })
  pauseMenu.draw(g, 110, 68, { align: 'center', shadow: PAL.black, color: focus === 0 ? PAL.white : PANEL.dialog.dim })
  drawText(g, '{confirm} OK   {cancel} BACK', 110, 150, { align: 'center', color: PANEL.dialog.dim })

  panel(g, 218, 30, 206, 138, 'dialog')
  drawText(g, 'OPTIONS', 321, 40, { scale: 2, align: 'center', shadow: PAL.black })
  optionsMenu.draw(g, 230, 62, { width: 182, shadow: PAL.black, color: focus === 1 ? PAL.white : PANEL.dialog.dim })
  drawText(g, '{left}{right} CHANGE   {select} SWAP MENU', 321, 150, { align: 'center', color: PANEL.dialog.dim })

  panel(g, 434, 30, 194, 138, 'paper')
  drawText(g, 'MW01', 531, 46, { scale: 3, align: 'center', color: PAL.brandRed })
  drawText(g, 'GRAND OPENING', 531, 78, { scale: 2, align: 'center', color: PANEL.paper.ink })
  drawText(g, `{heart} {times} 3`, 531, 106, { scale: 2, align: 'center', color: PAL.brandRed })
  drawText(g, `BEST ${counter(12500, 7)}  {star}{star}{star}`, 531, 134, { align: 'center', color: PANEL.paper.dim })
  drawBlinkText(g, 'GET READY!', 531, 148, tick, { align: 'center', color: PAL.blue[1] })

  textPanel(g, 'HOLD {spray} TO SOAK A DIRTY CAR. A CLEAN CAR IS A HAPPY CAR, AND YOU CAN RIDE ITS ROOF!', 110, 176, { style: 'sign', maxWidth: 196 })
  textPanel(g, `${message}\nLAST SOUND: ${lastSfx}`, 321, 176, { style: 'dark', maxWidth: 206 })
  textPanel(g, 'MIGHTY MAXX\nVS\nBUCKET BILL', 531, 176, { style: 'dialog', scale: 2, maxWidth: 194 })

  // Meters, the 9-slice and the blink.
  panel(g, 12, 250, 300, 100, 'dark')
  const wave = (Math.sin(tick / 40) + 1) / 2
  drawText(g, 'SHINE', 24, 262)
  meter(g, 84, 261, 60, 9, Math.round(wave * 3) / 3, { ...METER.shine, segments: 3 })
  drawText(g, 'HOVER', 24, 278)
  meter(g, 84, 278, 60, 6, 1 - wave, METER.water)
  drawText(g, 'WAX', 24, 292)
  meter(g, 84, 293, 60, 4, wave, METER.wax)
  drawText(g, 'MUDZILLA', 24, 310, { color: PAL.red[5] })
  meter(g, 24, 322, 276, 10, wave, { ...METER.boss, segments: 12 })
  drawText(g, 'VOLUME', 160, 262)
  meter(g, 220, 261, 80, 9, settings.music / 10, { ...METER.good, segments: 10 })
  drawText(g, 'EMPTY', 160, 278)
  meter(g, 220, 278, 80, 6, 0, METER.boss)
  drawText(g, 'SLIVER', 160, 292)
  meter(g, 220, 292, 80, 6, 0.004, METER.boss)

  nineSlice(g, sprites, 'demo/crate', 330, 252, 16, 16, 4)
  nineSlice(g, sprites, 'demo/crate', 352, 252, 70, 24, 4)
  nineSlice(g, sprites, 'demo/crate', 330, 282, 92, 62, 4)
  drawText(g, '9-SLICE', 376, 308, { align: 'center', shadow: PAL.blue[0] })
  if (blink(tick)) drawText(g, 'PRESS {pause}', 531, 262, { scale: 2, align: 'center', outline: PAL.black, shadow: PAL.black })
  drawText(g, '{up}{down} MOVE   {left}{right} CHANGE\n{confirm} PICK   {cancel} BACK\n{select} THE OTHER MENU', 531, 292, { align: 'center', color: PAL.navy, lineHeight: 13 })
}
ui.h = 360

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

type Sheet = ((g: G, tick: number) => void) & { h: number }
const SHEETS: Record<string, Sheet> = { charset, sentences, prompts, ui }

/** Draw a string and report where its ink landed, so scripts can check measureText against real pixels. */
function inkBounds(text: string, scale: number, align: 'left' | 'center' | 'right'): { minX: number; maxX: number; minY: number; maxY: number; measured: number } {
  const cv = document.createElement('canvas')
  cv.width = 1200
  cv.height = 200
  const g = cv.getContext('2d', { willReadFrequently: true })!
  drawText(g, text, 600, 40, { scale, align })
  const d = g.getImageData(0, 0, cv.width, cv.height).data
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      if (!d[(y * cv.width + x) * 4 + 3]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX: minX - 600, maxX: maxX - 600, minY: minY - 40, maxY: maxY - 40, measured: measureText(text, scale) }
}

/** Milliseconds per drawText call for a HUD-like line, once warm. */
function bench(calls = 20000): Record<string, number> {
  const cv = document.createElement('canvas')
  cv.width = 640
  cv.height = 360
  const g = cv.getContext('2d')!
  const run = (text: string, opts: Parameters<typeof drawText>[4]) => {
    drawText(g, text, 10, 10, opts)
    const t0 = performance.now()
    for (let i = 0; i < calls; i++) drawText(g, text, 10, 10 + (i % 300), opts)
    return (performance.now() - t0) / calls
  }
  return {
    plain: run('SCORE 0012500  TIME 300', { color: PAL.white }),
    shadowScale2: run('SCORE 0012500  TIME 300', { color: PAL.white, scale: 2, shadow: PAL.black }),
    outlineCentered: run('SCORE 0012500  TIME 300', { color: PAL.yellow[2], outline: PAL.black, align: 'center' }),
    withPrompts: run('PRESS {jump} TO START {heart}{times}3', { color: PAL.white, shadow: PAL.black }),
  }
}

// On-screen buttons, so the touch prompts and the menus can be tried with a finger or a mouse.
// They are spans, not buttons: a focused button would keep the keyboard to itself.
const TOUCH_STRIP: [string, Action[]][] = [
  ['LEFT', ['left']], ['UP', ['up']], ['DOWN', ['down']], ['RIGHT', ['right']],
  ['A', ['jump', 'confirm']], ['B', ['spray', 'cancel']], ['PAUSE', ['pause']],
]

function touchStrip(): HTMLElement {
  const strip = document.createElement('div')
  strip.className = 'touch'
  for (const [name, actions] of TOUCH_STRIP) {
    const b = document.createElement('span')
    b.textContent = name
    const set = (down: boolean) => (e: Event) => {
      e.preventDefault()
      for (const a of actions) input.setTouch(a, down)
    }
    b.addEventListener('pointerdown', set(true))
    b.addEventListener('pointerup', set(false))
    b.addEventListener('pointerleave', set(false))
    b.addEventListener('pointercancel', set(false))
    strip.appendChild(b)
  }
  return strip
}

function start(): void {
  const q = new URLSearchParams(location.search)
  const zoom = Math.max(1, Number(q.get('zoom')) || 2)
  const only = q.get('sheet')
  const root = document.getElementById('root')!
  const status = document.createElement('p')
  root.append(status, touchStrip())
  const views: { sheet: Sheet; g: G }[] = []
  for (const [name, sheet] of Object.entries(SHEETS)) {
    if (only && only !== name) continue
    const cv = document.createElement('canvas')
    cv.id = 'sheet-' + name
    cv.width = W
    cv.height = sheet.h
    cv.style.width = W * zoom + 'px'
    cv.style.height = sheet.h * zoom + 'px'
    const title = document.createElement('h2')
    title.textContent = name
    root.append(title, cv)
    // Tab is select only on a game canvas (engine/input.ts), so the first sheet takes focus.
    if (!views.length) {
      cv.tabIndex = 0
      cv.focus({ preventScroll: true })
    }
    views.push({ sheet, g: cv.getContext('2d')! })
  }

  bindGlyphs(input)
  let tick = 0
  let cost = 0
  let last = performance.now()
  let owed = 0
  // A check script that wants to poll the input itself stops the page doing so.
  let frozen = false
  function loop(): void {
    // Fixed 60 Hz ticks whatever the display's refresh rate, like the game's own loop.
    const now = performance.now()
    owed = Math.min(owed + (now - last) * 0.06, 5)
    last = now
    for (; owed >= 1; owed--) {
      if (frozen) continue
      const frame = input.poll()
      if (frame.pressed.select) {
        focus = 1 - focus
        ;(focus === 0 ? pauseMenu : optionsMenu).reset((focus === 0 ? pauseMenu : optionsMenu).index)
      }
      ;(focus === 0 ? pauseMenu : optionsMenu).update(frame)
      tick++
    }
    const t0 = performance.now()
    if (!frozen) for (const v of views) v.sheet(v.g, tick)
    cost += (performance.now() - t0 - cost) * 0.05
    if (tick % 30 === 0) {
      const pad = input.gamepadConnected ? 'controller connected' : 'no controller seen yet (press a button on it)'
      status.textContent = `device: ${input.device}, ${pad}. drawing every sheet takes ${cost.toFixed(2)} ms a frame. ${JSON.stringify(textStats())}`
    }
    requestAnimationFrame(loop)
  }
  loop()

  Object.assign(window, {
    __maxxText: {
      ready: true,
      inkBounds,
      bench,
      draw: drawText,
      measureText,
      measureHeight,
      wrapText,
      textStats,
      sfxLog,
      input,
      menus: { pause: pauseMenu, options: optionsMenu },
      audio,
      sprites,
      freeze: (on: boolean) => { frozen = on },
      bind: (d: string) => bindGlyphs(d === 'pad' ? PAD : d === 'stick' ? PAD_STICK : d === 'keys' ? KEYS : d === 'touch' ? TOUCH : d === 'live' ? input : null),
      // For checks against another InputApi: bind it, and list the ids this module documents.
      bindApi: (api: InputApi | null) => bindGlyphs(api),
      glyphIds: GLYPH_IDS,
      state: () => ({ tick, focus, pause: pauseMenu.index, options: optionsMenu.index, settings: { ...settings }, message, device: input.device, pad: input.gamepadConnected }),
    },
  })
}

start()
