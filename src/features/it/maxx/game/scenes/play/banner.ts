// Banners: the big words the level shouts. GRIMED!, SPOTLESS!, TIME UP!, CLEAR!, and the smaller
// notices (CHECKPOINT!, HURRY UP!, A SECRET ROAD OPENS). Each letter drops in and bounces
// on its own, a beat after the one before; on the way out they hop off one by one.
//
// A text the table below knows gets its own colours, size, place and dressing (mud splats,
// sparkles, a flag); anything else a boss or a level sends is big and yellow.
import { VIEW_H, VIEW_W } from '../../contract'
import type { DrawOpts, Sprites } from '../../contract'
import { drawText, measureText } from '../../engine/text'
import type { TextStyle } from '../../engine/text'
import { PAL } from '../../engine/ui'

type G = CanvasRenderingContext2D
type Dress = '' | 'mud' | 'shine' | 'alarm' | 'flag' | 'stars'

interface Look {
  color: string
  outline: string
  shadow: string
  /** The largest scale it may take; it shrinks to fit the screen. */
  max: number
  /** Screen y of the middle of the letters. */
  y: number
  dress: Dress
}

const BIG_Y = 122
const NOTICE_Y = 70
const DEFAULT: Look = { color: PAL.yellow[2], outline: PAL.outline, shadow: PAL.navy, max: 5, y: BIG_Y, dress: '' }
const LOOKS: Record<string, Look> = {
  'GRIMED!': { color: PAL.mud[4], outline: PAL.outline, shadow: PAL.mud[1], max: 7, y: BIG_Y, dress: 'mud' },
  'SPOTLESS!': { color: PAL.white, outline: PAL.blue[1], shadow: PAL.navy, max: 6, y: BIG_Y, dress: 'shine' },
  'CLEAR!': { color: PAL.yellow[2], outline: PAL.outline, shadow: PAL.red[2], max: 7, y: BIG_Y, dress: 'stars' },
  'TIME UP!': { color: PAL.red[4], outline: PAL.outline, shadow: PAL.red[0], max: 7, y: BIG_Y, dress: 'alarm' },
  'HURRY UP!': { color: PAL.yellow[2], outline: PAL.outline, shadow: PAL.red[1], max: 3, y: NOTICE_Y, dress: 'alarm' },
  'CHECKPOINT!': { color: PAL.white, outline: PAL.blue[1], shadow: PAL.navy, max: 3, y: NOTICE_Y, dress: 'flag' },
  'A SECRET ROAD OPENS': { color: PAL.yellow[2], outline: PAL.purple[1], shadow: PAL.purple[0], max: 3, y: 92, dress: 'stars' },
  'SECRET EXIT!': { color: PAL.yellow[2], outline: PAL.purple[1], shadow: PAL.purple[0], max: 4, y: 92, dress: 'stars' },
}

/** Widest a banner may be. */
const MAX_W = 580
const DROP_TICKS = 16
const STAGGER = 2
const OUT_TICKS = 18
const X2: DrawOpts = { scale: 2 }
const FLIP: DrawOpts = { flipX: true }
const SPARK = ['hud/spark0', 'hud/spark1', 'hud/spark2', 'hud/spark1', 'hud/spark0']
// Where sparkles sit round a SPOTLESS!, as shares of the text's width and height from its middle.
const GLINT_X = [-0.52, -0.3, 0.08, 0.36, 0.54, -0.1]
const GLINT_Y = [-0.7, 0.9, -1.0, 0.8, -0.5, 1.0]

const st: TextStyle = {}

/** 0 to 1, landing like something dropped: one big bounce and a small one. */
function dropBounce(k: number): number {
  if (k <= 0) return 0
  if (k >= 1) return 1
  if (k < 0.5) return 4 * k * k
  if (k < 0.8) {
    const u = (k - 0.65) / 0.15
    return 1 - 0.16 * (1 - u * u)
  }
  const u = (k - 0.9) / 0.1
  return 1 - 0.05 * (1 - u * u)
}

export interface Banner {
  /** Put a text up for `ticks` in all (its bounce in and out included). Replaces whatever is up. */
  show(text: string, ticks?: number): void
  clear(): void
  /** One tick. */
  update(): void
  draw(g: G): void
  /** What is up now, '' for nothing. */
  readonly text: string
}

export function createBanner(sprites: Sprites): Banner {
  let text = ''
  let look = DEFAULT
  let scale = 1
  let left = 0
  let width = 0
  let t = 0
  let life = 0
  const chars: string[] = []
  const xs: number[] = []

  function letterY(i: number): number {
    const top = look.y - 4 * scale
    const inT = t - i * STAGGER
    if (inT < 0) return -VIEW_H
    const outT = t - (life - OUT_TICKS) - i
    if (outT > 0) {
      // A little hop, then off the bottom.
      const u = outT / 10
      return top + Math.round(u * u * 220 - u * 70)
    }
    if (inT < DROP_TICKS) return Math.round((top + 9 * scale) * dropBounce(inT / DROP_TICKS)) - 9 * scale
    return top + (scale >= 4 ? Math.round(Math.sin((t + i * 6) * 0.11) * 2) : 0)
  }

  function clear(): void {
    text = ''
    chars.length = 0
  }

  function drawDress(g: G): void {
    const cx = left + (width >> 1)
    const settled = t - chars.length * STAGGER - DROP_TICKS
    const leaving = t > life - OUT_TICKS
    if (look.dress === 'mud') {
      if (leaving) return
      if (t > 8) sprites.draw(g, 'hud/splatBig', left + Math.round(width * 0.2), look.y + 2 * scale)
      if (t > 14) sprites.draw(g, 'hud/splatBig', left + Math.round(width * 0.78), look.y - scale, FLIP)
      if (t > 11) sprites.draw(g, 'hud/splatSmall', cx, look.y + 4 * scale)
      if (t > 18) sprites.draw(g, 'hud/splatDot', left - 14, look.y - 3 * scale)
      if (t > 20) sprites.draw(g, 'hud/splatDot', left + width + 12, look.y + 3 * scale, FLIP)
    } else if (look.dress === 'shine' && settled > 0 && !leaving) {
      const hw = width / 2
      const hh = 4 * scale
      for (let k = 0; k < GLINT_X.length; k++) {
        const ft = (t + k * 9) % 46
        if (ft >= 20) continue
        sprites.draw(g, SPARK[Math.floor(ft / 4)], cx + Math.round(GLINT_X[k] * hw * 1.1), look.y + Math.round(GLINT_Y[k] * hh * 1.5))
      }
    } else if (look.dress === 'stars' && !leaving && t > 6) {
      const bob = Math.round(Math.sin(t * 0.14) * 3)
      sprites.draw(g, 'hud/starBig', left - 22, look.y + bob)
      sprites.draw(g, 'hud/starBig', left + width + 22, look.y - bob)
    } else if (look.dress === 'flag' && !leaving && t > 4) {
      sprites.draw(g, 'hud/flag', left - 22, look.y - 9)
    } else if (look.dress === 'alarm' && !leaving && t > 4) {
      const jig = (t >> 1) & 1
      if (scale >= 4) {
        sprites.draw(g, 'hud/clockHot', left - 44 + jig, look.y - 18, X2)
        sprites.draw(g, 'hud/clockHot', left + width + 14 - jig, look.y - 18, X2)
      } else {
        sprites.draw(g, 'hud/clockHot', left - 22 + jig, look.y - 9)
        sprites.draw(g, 'hud/clockHot', left + width + 7 - jig, look.y - 9)
      }
    }
  }

  return {
    get text() {
      return text
    },
    show(next, ticks = 120) {
      text = String(next).toUpperCase()
      look = LOOKS[text] ?? DEFAULT
      const w1 = Math.max(1, measureText(text, 1))
      scale = Math.max(1, Math.min(look.max, Math.floor(MAX_W / w1)))
      width = w1 * scale
      left = (VIEW_W - width) >> 1
      chars.length = 0
      xs.length = 0
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') continue
        chars.push(text[i])
        xs.push(i === 0 ? 0 : (measureText(text.slice(0, i), 1) + 1) * scale)
      }
      t = 0
      // Long enough for every letter to land and be read before it leaves again.
      life = Math.max(Math.round(ticks), chars.length * STAGGER + DROP_TICKS + OUT_TICKS + 20)
    },
    clear,
    update() {
      if (text && ++t >= life + chars.length + 14) clear()
    },
    draw(g) {
      if (!text) return
      drawDress(g)
      st.scale = scale
      st.align = 'left'
      st.outline = look.outline
      st.shadow = look.shadow
      // A gleam runs along SPOTLESS! once the letters have landed.
      const gleam = look.dress === 'shine' ? Math.floor((t - chars.length * STAGGER - DROP_TICKS) / 3) % (chars.length + 10) : -1
      for (let i = 0; i < chars.length; i++) {
        const y = letterY(i)
        if (y > VIEW_H || y < -8 * scale) continue
        st.color = i === gleam || i === gleam - 1 ? PAL.blue[3] : look.color
        drawText(g, chars[i], left + xs[i], y, st)
      }
      if (look.dress === 'mud' && t > 30 && t <= life - OUT_TICKS) {
        // The word drips.
        g.fillStyle = look.color
        const base = look.y + 3 * scale
        for (let i = 0; i < chars.length - 1; i += 2) {
          const len = Math.min(scale * (2 + (i % 3)), (t - 30 - i * 3) >> 2)
          if (len > 0) g.fillRect(left + xs[i] + scale, base, scale, len)
        }
      }
    },
  }
}
