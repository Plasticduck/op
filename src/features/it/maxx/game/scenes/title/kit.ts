// Small helpers shared by the title, options, how to play, game over and ending screens.
import { VIEW_H, VIEW_W } from '../../contract'
import type { InputDevice, InputFrame, SaveApi, SaveData } from '../../contract'
import { drawText } from '../../engine/text'
import type { TextStyle } from '../../engine/text'
import { PAL } from '../../engine/ui'
import { LEVEL_META } from '../../levels/meta'

type G = CanvasRenderingContext2D

const st: TextStyle = {}

/**
 * Browsers hold sound back until a key press, click or tap, and a controller button may not
 * count. Said wherever a controller player could be left in silence (audio.locked).
 */
export const FOR_SOUND: Record<InputDevice, string> = {
  gamepad: 'CLICK OR PRESS ANY KEY ONCE FOR SOUND',
  keyboard: 'PRESS ANY KEY FOR SOUND',
  touch: 'TAP THE SCREEN FOR SOUND',
}

/** drawText through one reused style object, so a screen drawing every frame makes no garbage. */
export function say(
  g: G,
  text: string,
  x: number,
  y: number,
  scale = 1,
  color: string = PAL.white,
  align: 'left' | 'center' | 'right' = 'center',
  shadow?: string,
  outline?: string,
  lineHeight?: number,
): void {
  st.scale = scale
  st.color = color
  st.align = align
  st.shadow = shadow
  st.outline = outline
  st.lineHeight = lineHeight
  st.spacing = undefined
  drawText(g, text, x, y, st)
}

/** A shade over everything drawn so far, so a panel on top reads. */
export function dim(g: G, alpha = 0.55): void {
  const before = g.globalAlpha
  g.globalAlpha = alpha
  g.fillStyle = PAL.black
  g.fillRect(0, 0, VIEW_W, VIEW_H)
  g.globalAlpha = before
}

/** Anything worth keeping: a cleared level, an opened level, the secret, a rival, a score. */
export function hasProgress(data: SaveData): boolean {
  if (data.unlocked > 1 || data.secretFound || data.rivalsBeaten > 0 || data.champion || data.finished || data.hiScore > 0) return true
  for (const id in data.levels) {
    const r = data.levels[id]
    if (r.cleared || r.bestScore > 0 || r.tokens[0] || r.tokens[1] || r.tokens[2]) return true
  }
  return false
}

export interface FinalNumbers {
  cleared: number
  spotless: number
  tokens: number
  hiScore: number
}

/** The eight main levels only: 24 gold tokens is three in each. */
export function finalNumbers(save: SaveApi): FinalNumbers {
  const out: FinalNumbers = { cleared: 0, spotless: 0, tokens: 0, hiScore: save.data.hiScore }
  for (const m of LEVEL_META) {
    if (!Object.prototype.hasOwnProperty.call(save.data.levels, m.id)) continue
    const r = save.data.levels[m.id]
    if (r.cleared) out.cleared++
    if (r.spotless) out.spotless++
    for (let i = 0; i < 3; i++) if (r.tokens[i]) out.tokens++
  }
  return out
}

/** Any button a player would press to get on with it. */
export function anyPress(input: InputFrame): boolean {
  const p = input.pressed
  return p.confirm || p.cancel || p.jump || p.spray || p.pause || p.left || p.right || p.up || p.down
}

/** Repeatable noise for cosmetics, so a screenshot of a given tick is always the same picture. */
export function noise(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 0..1 eased, overshooting a little and settling: things that drop in. */
export function bounce(t: number): number {
  if (t >= 1) return 1
  if (t <= 0) return 0
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
  return n * (t -= 2.625 / d) * t + 0.984375
}

/** Which frame of an animation with these tick lengths is up `t` ticks in; past the end it holds the last. */
export function onceFrame(t: number, ticks: readonly number[]): number {
  let i = 0
  let acc = 0
  while (i < ticks.length && t >= acc + ticks[i]) acc += ticks[i++]
  return i
}
