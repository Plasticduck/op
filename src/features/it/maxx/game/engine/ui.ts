// The UI drawing kit every scene shares: the palette, panels, meters, a menu,
// and small text helpers. Everything is whole pixels and flat colour.
//
// Menus on a controller: createMenu() reads the shared InputFrame, so the D-pad,
// the left stick, the arrow keys and the touch buttons all drive it. Two things
// to know when wiring one into a scene, because one button can be two actions
// (Start and Enter are pause AND confirm, B is spray AND cancel, Esc is pause
// AND cancel):
//   - call menu.reset() when a menu comes on screen, so the press that opened it
//     is not also taken as its first confirm or cancel;
//   - while a pause menu is up, let the menu's confirm and cancel close it. Do
//     not also treat `pressed.pause` as "resume", or Start on EXIT would do both.
import type { AudioApi, InputFrame, Sprites } from '../contract'
import { GLYPH_H, LINE_H, drawText, measureText, wrapText } from './text'
import type { TextStyle } from './text'

/** The master palette (design bible, section 9). Ramps run dark to light. */
export const PAL = {
  outline: '#1e0d06',
  navy: '#1b2253',
  red: ['#3c0507', '#7f0207', '#ae0512', '#d10713', '#f51924', '#ff6b6b'],
  wood: ['#311107', '#7a4a1a', '#b96e23', '#d57a1d', '#f09c3f', '#f1ae51', '#f5c56e', '#fbdb8a', '#fff1c4'],
  blue: ['#0b2a6b', '#1456b8', '#109ff9', '#5cc8ff', '#b9ecff'],
  teal: ['#0e7c86', '#25c2d0', '#a8f0f0'],
  green: ['#0f3b1e', '#1f7a34', '#49b23c', '#9be04f'],
  grey: ['#16161d', '#2e3038', '#4b4f5c', '#767b8a', '#a9afbd', '#d6dae3', '#f7f4f8'],
  mud: ['#2b1a0e', '#4a2f17', '#6b4522', '#8a5f33', '#b08850'],
  yellow: ['#b8860b', '#f5c518', '#ffe866'],
  purple: ['#1a1033', '#2e1f5e', '#5b3fa0', '#9a7fe0'],
  orange: ['#c2410c', '#f97316', '#fdba74'],
  pink: '#e85aa0',
  ice: ['#dff3ff', '#a8d8f0', '#6fb3dd'],
  white: '#f7f4f8',
  black: '#16161d',
  brandRed: '#d10713',
  brandBlue: '#109ff9',
} as const

type G = CanvasRenderingContext2D

/** The same whole-number scale drawText settles on, so layout and text agree. */
function whole(scale: number | undefined): number {
  return scale! >= 1 ? Math.round(scale!) : 1
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

// Every shape snaps to whole pixels: a rectangle at x = 10.5 would come out as two half-lit columns.

/** Fill a rectangle whose corners are cut in `n` one-pixel steps (0 = square). */
export function stepRect(g: G, x: number, y: number, w: number, h: number, n: number, color: string): void {
  x = Math.round(x)
  y = Math.round(y)
  w = Math.round(w)
  h = Math.round(h)
  n = Math.round(n)
  if (w <= 0 || h <= 0) return
  g.fillStyle = color
  if (n <= 0 || w <= 2 * n || h <= 2 * n) {
    g.fillRect(x, y, w, h)
    return
  }
  g.fillRect(x, y + n, w, h - 2 * n)
  for (let i = 0; i < n; i++) {
    const cut = n - i
    g.fillRect(x + cut, y + i, w - 2 * cut, 1)
    g.fillRect(x + cut, y + h - 1 - i, w - 2 * cut, 1)
  }
}

/** A rectangle outline `t` pixels thick, drawn inside (x, y, w, h). */
export function frame(g: G, x: number, y: number, w: number, h: number, color: string, t = 1): void {
  x = Math.round(x)
  y = Math.round(y)
  w = Math.round(w)
  h = Math.round(h)
  t = Math.max(1, Math.round(t))
  if (w <= 0 || h <= 0) return
  g.fillStyle = color
  if (w <= 2 * t || h <= 2 * t) {
    g.fillRect(x, y, w, h)
    return
  }
  g.fillRect(x, y, w, t)
  g.fillRect(x, y + h - t, w, t)
  g.fillRect(x, y + t, t, h - 2 * t)
  g.fillRect(x + w - t, y + t, t, h - 2 * t)
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

export type PanelStyle =
  | 'dialog' // navy box, white and blue border, stepped corners: menus, cards, messages
  | 'dark' // flat near-black box: reads as a shade laid over the scene
  | 'sign' // wooden planks: tutorial signs
  | 'bar' // navy strip with a blue rule: the status bar
  | 'paper' // white card with a navy edge: level cards, tallies

/** What suits each style: padding from the panel's edge to its text, and the text colour. */
export const PANEL: Record<PanelStyle, { pad: number; ink: string; dim: string }> = {
  dialog: { pad: 9, ink: PAL.white, dim: PAL.blue[3] },
  dark: { pad: 7, ink: PAL.white, dim: PAL.grey[4] },
  sign: { pad: 8, ink: PAL.wood[0], dim: PAL.wood[1] },
  bar: { pad: 5, ink: PAL.white, dim: PAL.blue[3] },
  paper: { pad: 9, ink: PAL.navy, dim: PAL.grey[3] },
}

export function panel(g: G, x: number, y: number, w: number, h: number, style: PanelStyle = 'dialog'): void {
  x = Math.round(x)
  y = Math.round(y)
  w = Math.round(w)
  h = Math.round(h)
  if (style === 'dialog') {
    stepRect(g, x, y, w, h, 3, PAL.black)
    stepRect(g, x + 1, y + 1, w - 2, h - 2, 3, PAL.white)
    stepRect(g, x + 3, y + 3, w - 6, h - 6, 3, PAL.brandBlue)
    stepRect(g, x + 4, y + 4, w - 8, h - 8, 3, PAL.navy)
  } else if (style === 'dark') {
    stepRect(g, x, y, w, h, 2, PAL.black)
    stepRect(g, x + 2, y + 2, w - 4, h - 4, 2, PAL.grey[2])
    stepRect(g, x + 3, y + 3, w - 6, h - 6, 2, PAL.black)
  } else if (style === 'paper') {
    stepRect(g, x, y, w, h, 3, PAL.navy)
    stepRect(g, x + 2, y + 2, w - 4, h - 4, 3, PAL.white)
    stepRect(g, x + 4, y + 4, w - 8, h - 8, 3, PAL.blue[3])
    stepRect(g, x + 5, y + 5, w - 10, h - 10, 3, PAL.white)
  } else if (style === 'bar') {
    g.fillStyle = PAL.black
    g.fillRect(x, y, w, h)
    g.fillStyle = PAL.navy
    g.fillRect(x, y + 1, w, h - 2)
    g.fillStyle = PAL.brandBlue
    g.fillRect(x, y + 1, w, 1)
    g.fillRect(x, y + h - 2, w, 1)
  } else {
    sign(g, x, y, w, h)
  }
}

function sign(g: G, x: number, y: number, w: number, h: number): void {
  const wood = PAL.wood
  stepRect(g, x, y, w, h, 2, wood[0])
  stepRect(g, x + 1, y + 1, w - 2, h - 2, 2, wood[4])
  g.fillStyle = wood[7]
  g.fillRect(x + 3, y + 1, w - 6, 1)
  g.fillStyle = wood[2]
  g.fillRect(x + 3, y + h - 3, w - 6, 2)
  // Planks about 13 px tall, with a few short grain marks that depend only on position.
  const planks = Math.max(1, Math.round((h - 4) / 13))
  for (let p = 0; p < planks; p++) {
    const top = y + 2 + Math.round((p * (h - 4)) / planks)
    if (p > 0) {
      // A quiet seam: text is drawn straight over it.
      g.fillStyle = wood[3]
      g.fillRect(x + 1, top - 1, w - 2, 1)
    }
    g.fillStyle = wood[5]
    for (let k = 0; k < 3; k++) {
      const gx = x + 8 + ((p * 37 + k * 53) % Math.max(1, w - 24))
      const gy = top + 3 + ((p * 5 + k * 4) % 7)
      if (gy < y + h - 4) g.fillRect(gx, gy, 6 + ((p + k) % 3) * 2, 1)
    }
  }
  if (w >= 24 && h >= 16) {
    nail(g, x + 4, y + 4)
    nail(g, x + w - 6, y + 4)
    nail(g, x + 4, y + h - 7)
    nail(g, x + w - 6, y + h - 7)
  }
}

function nail(g: G, x: number, y: number): void {
  g.fillStyle = PAL.wood[0]
  g.fillRect(x, y, 2, 2)
  g.fillStyle = PAL.wood[8]
  g.fillRect(x, y, 1, 1)
}

export interface TextPanelOpts {
  style?: PanelStyle
  scale?: number
  /** Widest the panel may get, in pixels. Longer text wraps. Default 280. */
  maxWidth?: number
  align?: 'left' | 'center'
  /** Which edge of the panel sits at y. Default 'top'. */
  anchor?: 'top' | 'middle' | 'bottom'
  /** Overrides the style's text colour. */
  color?: string
}

const NO_PANEL_OPTS: TextPanelOpts = {}
const st: TextStyle = {}
/**
 * The width of the widest line of each wrapped layout. wrapText hands back the same array for
 * the same text, width, scale and device, and a new one when any of them changes (a prompt is
 * wider on a pad), so the array itself is the key: a panel shown every frame measures once.
 */
const widest = new WeakMap<readonly string[], number>()

/**
 * A panel sized to its text, centred on cx. Text wraps at maxWidth and may hold
 * {prompt} tokens. Returns the panel's height. Allocates nothing once a text has been shown.
 */
export function textPanel(g: G, text: string, cx: number, y: number, o: TextPanelOpts = NO_PANEL_OPTS): number {
  const style = o.style ?? 'dialog'
  const s = whole(o.scale)
  const pad = PANEL[style].pad
  const lines = wrapText(text, (o.maxWidth ?? 280) - 2 * pad, s)
  let tw = widest.get(lines)
  if (tw === undefined) {
    tw = 0
    for (let i = 0; i < lines.length; i++) tw = Math.max(tw, measureText(lines[i], s))
    widest.set(lines, tw)
  }
  const w = tw + 2 * pad
  const h = ((lines.length - 1) * LINE_H + GLYPH_H - 1) * s + 2 * pad
  const left = Math.round(cx - w / 2)
  const top = Math.round(o.anchor === 'bottom' ? y - h : o.anchor === 'middle' ? y - h / 2 : y)
  panel(g, left, top, w, h, style)
  st.scale = s
  st.color = o.color ?? PANEL[style].ink
  st.shadow = st.outline = undefined
  st.align = o.align ?? 'center'
  const tx = st.align === 'center' ? left + (w >> 1) : left + pad
  for (let i = 0; i < lines.length; i++) drawText(g, lines[i], tx, top + pad + i * LINE_H * s, st)
  return h
}

/* ------------------------------------------------------------------ */
/* Meters                                                              */
/* ------------------------------------------------------------------ */

export interface MeterOpts {
  /** The filled part. */
  color?: string
  /** A lighter line along the top of the fill. */
  hi?: string
  /** The empty part. */
  back?: string
  /** The 1 px frame. */
  frame?: string
  /** Split into this many cells; the fill snaps to whole cells. */
  segments?: number
}

/** Ready-made colours: meter(g, x, y, w, h, v, METER.boss). */
export const METER = {
  shine: { color: PAL.blue[2], hi: PAL.blue[4] },
  water: { color: PAL.teal[1], hi: PAL.teal[2] },
  boss: { color: PAL.red[3], hi: PAL.red[5] },
  wax: { color: PAL.yellow[1], hi: PAL.yellow[2] },
  good: { color: PAL.green[2], hi: PAL.green[3] },
} satisfies Record<string, MeterOpts>

const NO_METER_OPTS: MeterOpts = {}

/** A framed bar filled to `value` (0..1). The frame is inside (x, y, w, h). */
export function meter(g: G, x: number, y: number, w: number, h: number, value: number, o: MeterOpts = NO_METER_OPTS): void {
  x = Math.round(x)
  y = Math.round(y)
  w = Math.round(w)
  h = Math.round(h)
  if (w < 3 || h < 3) return
  const v = value > 0 ? (value < 1 ? value : 1) : 0
  const iw = w - 2
  const ih = h - 2
  const seg = Math.max(0, Math.round(o.segments ?? 0))
  stepRect(g, x, y, w, h, 1, o.frame ?? PAL.black)
  g.fillStyle = o.back ?? PAL.grey[1]
  g.fillRect(x + 1, y + 1, iw, ih)
  // Cell k ends at edge(k) - 1, where its dividing line sits (the last cell's falls on the frame),
  // which leaves every cell the same width, give or take a pixel.
  const cells = Math.round(v * seg)
  let fw = seg > 0 ? (cells > 0 ? Math.round((cells * (iw + 1)) / seg) - 1 : 0) : Math.round(iw * v)
  // A sliver of health must still show.
  if (v > 0 && fw < 1) fw = 1
  if (fw > 0) {
    g.fillStyle = o.color ?? PAL.brandBlue
    g.fillRect(x + 1, y + 1, fw, ih)
    // A custom colour without its own highlight stays flat rather than borrowing the blue one.
    const hi = o.hi ?? (o.color ? '' : PAL.blue[4])
    if (hi && ih >= 3) {
      g.fillStyle = hi
      g.fillRect(x + 1, y + 1, fw, 1)
    }
  }
  if (seg > 1) {
    g.fillStyle = o.frame ?? PAL.black
    for (let i = 1; i < seg; i++) g.fillRect(x + Math.round((i * (iw + 1)) / seg), y + 1, 1, ih)
  }
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

export interface MenuItem {
  label: string
  /** Shown at the right edge of the menu (an option's current setting). */
  value?: string | (() => string)
  /** Greyed out; the cursor skips it. */
  disabled?: boolean
  /** Left or right on this row (dir is -1 or 1). Return false when nothing changed, to keep it silent. */
  onAdjust?: (dir: -1 | 1) => boolean | void
  /** Confirm on this row. */
  onSelect?: () => void
}

export interface MenuConfig {
  items: MenuItem[]
  /** Plays menuMove, menuSelect and menuBack. */
  audio?: AudioApi
  /** Up from the first row lands on the last, and the other way round. Default true. */
  wrap?: boolean
  /** The row the cursor starts on. */
  index?: number
  /** Confirm on a row that has no onSelect or onAdjust of its own. */
  onConfirm?: (index: number, item: MenuItem) => void
  onCancel?: () => void
}

export interface MenuDrawOpts {
  scale?: number
  /** Row advance in font pixels, before scale. Default 14. */
  rowHeight?: number
  /** 'left' (default): cursor at x, labels to its right. 'center': labels centred on x. */
  align?: 'left' | 'center'
  /** Left-aligned menus only: the menu's width in pixels. Values sit against its right edge. */
  width?: number
  color?: string
  selectedColor?: string
  disabledColor?: string
  shadow?: string
  outline?: string
}

export interface Menu {
  items: MenuItem[]
  index: number
  /** Ticks since it was made or reset. Drives the cursor's bob. */
  t: number
  /**
   * One tick: move on `repeat` (so a held stick or D-pad walks the list), confirm
   * and cancel on `pressed`. A confirm or cancel that was already down when the
   * menu appeared is ignored until it has been let go: on a controller Start is
   * both pause and confirm, so the press that opens a pause menu would otherwise
   * pick its first row.
   */
  update(input: InputFrame): void
  /** Call when the menu comes back on screen: cursor to `index` (default 0, or the first row that is not disabled), held buttons ignored again. */
  reset(index?: number): void
  draw(g: CanvasRenderingContext2D, x: number, y: number, opts?: MenuDrawOpts): void
  /** Pixel height of the list as draw() lays it out. */
  height(opts?: MenuDrawOpts): number
}

const NO_MENU_OPTS: MenuDrawOpts = {}
const BOB = [0, 1, 2, 1]
/** Room for the cursor left of a label, in font pixels. */
const CURSOR_W = 10

export function createMenu(cfg: MenuConfig): Menu {
  const wrap = cfg.wrap ?? true
  const audio = cfg.audio
  // Each stays false until its button has been seen up.
  let confirmArmed = false
  let cancelArmed = false

  function step(dir: number): void {
    const items = menu.items
    const n = items.length
    let i = menu.index
    for (let k = 0; k < n; k++) {
      i += dir
      if (i < 0 || i >= n) {
        if (!wrap) return
        i = (i + n) % n
      }
      if (!items[i].disabled) break
    }
    if (i === menu.index || items[i].disabled) return
    menu.index = i
    audio?.sfx('menuMove')
  }

  /** Keep the cursor on a real row, and off a disabled one when there is a choice. */
  function settle(): void {
    const items = menu.items
    const i = Math.round(menu.index)
    menu.index = i > 0 ? Math.max(0, Math.min(i, items.length - 1)) : 0
    if (items[menu.index]?.disabled) {
      const first = items.findIndex((it) => !it.disabled)
      if (first >= 0) menu.index = first
    }
  }

  const menu: Menu = {
    items: cfg.items,
    index: cfg.index ?? 0,
    t: 0,

    update(input) {
      menu.t++
      const wasConfirm = confirmArmed
      const wasCancel = cancelArmed
      if (!input.held.confirm) confirmArmed = true
      if (!input.held.cancel) cancelArmed = true
      const items = menu.items
      if (!items.length) return
      // `index` is public: whatever was put there, the cursor ends up on a real row.
      if (!(menu.index >= 0 && menu.index < items.length) || menu.index % 1 !== 0) settle()
      if (input.repeat.up) step(-1)
      else if (input.repeat.down) step(1)
      const item = items[menu.index]
      // Up and down win. The stick's left and right switch on at a lighter push than its up and
      // down, so a push a little off straight down also reads as right, and would change every
      // setting the cursor passed. Moving the cursor changes nothing, so it can safely go first.
      const turn = input.held.up || input.held.down ? 0 : input.repeat.left ? -1 : input.repeat.right ? 1 : 0
      if (turn && item.onAdjust && !item.disabled && item.onAdjust(turn) !== false) audio?.sfx('menuMove')
      if (input.pressed.confirm && wasConfirm) {
        if (item.disabled) {
          audio?.sfx('locked')
        } else if (item.onSelect) {
          audio?.sfx('menuSelect')
          item.onSelect()
        } else if (item.onAdjust) {
          // Confirm on a setting steps it forward. At its limit nothing happens, so nothing sounds.
          if (item.onAdjust(1) !== false) audio?.sfx('menuSelect')
        } else {
          audio?.sfx('menuSelect')
          cfg.onConfirm?.(menu.index, item)
        }
      } else if (input.pressed.cancel && wasCancel && cfg.onCancel) {
        audio?.sfx('menuBack')
        cfg.onCancel()
      }
    },

    reset(index = 0) {
      menu.index = index
      menu.t = 0
      confirmArmed = cancelArmed = false
      settle()
    },

    draw(g, x, y, o = NO_MENU_OPTS) {
      const s = whole(o.scale)
      const rowH = Math.round((o.rowHeight ?? 14) * s)
      const center = o.align === 'center'
      const bob = BOB[(menu.t >> 3) & 3] * s
      x = Math.round(x)
      y = Math.round(y)
      st.scale = s
      st.shadow = o.shadow
      st.outline = o.outline
      for (let i = 0; i < menu.items.length; i++) {
        const item = menu.items[i]
        const sel = i === menu.index
        const ty = y + i * rowH
        st.color = item.disabled ? (o.disabledColor ?? PAL.grey[3]) : sel ? (o.selectedColor ?? PAL.yellow[2]) : (o.color ?? PAL.white)
        if (center) {
          st.align = 'center'
          drawText(g, item.label, x, ty, st)
          if (sel) {
            st.align = 'right'
            drawText(g, '{pointer}', x - (measureText(item.label, s) >> 1) - 3 * s - bob, ty, st)
          }
          continue
        }
        st.align = 'left'
        if (sel) drawText(g, '{pointer}', x + bob, ty, st)
        drawText(g, item.label, x + CURSOR_W * s, ty, st)
        if (item.value === undefined || !o.width) continue
        const value = String(typeof item.value === 'function' ? item.value() : item.value)
        // The value keeps its place whether or not the arrows show, so rows do not shift as the cursor moves.
        const right = x + Math.round(o.width)
        const valueRight = right - 12 * s
        st.align = 'right'
        drawText(g, value, valueRight, ty, st)
        if (sel && item.onAdjust && !item.disabled) {
          drawText(g, '{arrow_right}', right, ty, st)
          drawText(g, '{arrow_left}', valueRight - measureText(value, s) - 5 * s, ty, st)
        }
      }
    },

    height(o = NO_MENU_OPTS) {
      const s = whole(o.scale)
      return menu.items.length ? (menu.items.length - 1) * Math.round((o.rowHeight ?? 14) * s) + GLYPH_H * s : 0
    },
  }

  settle()
  return menu
}

/* ------------------------------------------------------------------ */
/* Small text helpers                                                  */
/* ------------------------------------------------------------------ */

/** True for the first `on` share of every `period` ticks: PRESS START, low-time warnings. */
export function blink(tick: number, period = 48, on = 0.6): boolean {
  return tick % period < period * on
}

/** drawText that is only there while blink() says so. */
export function drawBlinkText(g: G, text: string, x: number, y: number, tick: number, opts?: TextStyle, period?: number): void {
  if (blink(tick, period)) drawText(g, text, x, y, opts)
}

const counterValue: number[] = []
const counterText: string[] = []

/**
 * A counter with leading zeros: counter(1250, 6) is '001250'. Clamps at all
 * nines, and treats anything below zero as zero. The last result per width is
 * remembered, so a HUD calling this every frame makes no garbage while the
 * number stands still.
 */
export function counter(value: number, digits: number): string {
  let n = Math.floor(value)
  if (!(n > 0)) n = 0
  const max = 10 ** digits - 1
  if (n > max) n = max
  if (counterValue[digits] === n) return counterText[digits]
  const text = String(n).padStart(digits, '0')
  counterValue[digits] = n
  counterText[digits] = text
  return text
}

/** Ticks as a clock: clockText(5025) is '1:23', with hundredths '1:23.75'. */
export function clockText(ticks: number, hundredths = false): string {
  const t = Math.max(0, Math.floor(ticks))
  const sec = Math.floor(t / 60)
  const base = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')
  return hundredths ? base + '.' + String(Math.floor(((t % 60) * 100) / 60)).padStart(2, '0') : base
}

/* ------------------------------------------------------------------ */
/* 9-slice                                                             */
/* ------------------------------------------------------------------ */

export interface Insets {
  l: number
  t: number
  r: number
  b: number
}

function side(inset: number, most: number): number {
  return Math.max(0, Math.min(Math.round(inset), most))
}

function tile(g: G, image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
  if (sw <= 0 || sh <= 0) return
  for (let oy = 0; oy < dh; oy += sh) {
    const ph = Math.min(sh, dh - oy)
    for (let ox = 0; ox < dw; ox += sw) {
      const pw = Math.min(sw, dw - ox)
      g.drawImage(image, sx, sy, pw, ph, dx + ox, dy + oy, pw, ph)
    }
  }
}

/**
 * Stretch a sprite frame over (x, y, w, h) as a 9-slice: the corners keep their
 * size, the edges and the middle repeat (so pixel patterns stay crisp). `inset`
 * is the border thickness inside the frame, one number or one per side.
 */
export function nineSlice(g: G, sprites: Sprites, name: string, x: number, y: number, w: number, h: number, inset: number | Insets): void {
  const src = sprites.source(name)
  if (!src) return
  const f = src.frame
  const img = src.image
  x = Math.round(x)
  y = Math.round(y)
  w = Math.round(w)
  h = Math.round(h)
  if (w <= 0 || h <= 0) return
  const l = side(typeof inset === 'number' ? inset : inset.l, w >> 1)
  const r = side(typeof inset === 'number' ? inset : inset.r, w - l)
  const t = side(typeof inset === 'number' ? inset : inset.t, h >> 1)
  const b = side(typeof inset === 'number' ? inset : inset.b, h - t)
  const mw = f.w - l - r
  const mh = f.h - t - b
  const iw = w - l - r
  const ih = h - t - b
  tile(g, img, f.x + l, f.y + t, mw, mh, x + l, y + t, iw, ih)
  tile(g, img, f.x + l, f.y, mw, t, x + l, y, iw, t)
  tile(g, img, f.x + l, f.y + f.h - b, mw, b, x + l, y + h - b, iw, b)
  tile(g, img, f.x, f.y + t, l, mh, x, y + t, l, ih)
  tile(g, img, f.x + f.w - r, f.y + t, r, mh, x + w - r, y + t, r, ih)
  tile(g, img, f.x, f.y, l, t, x, y, l, t)
  tile(g, img, f.x + f.w - r, f.y, r, t, x + w - r, y, r, t)
  tile(g, img, f.x, f.y + f.h - b, l, b, x, y + h - b, l, b)
  tile(g, img, f.x + f.w - r, f.y + f.h - b, r, b, x + w - r, y + h - b, r, b)
}
