// The world map's flat parts: the sign plate and badges over each site, the status bar, notes.
import type { GameCtx, LevelRecord, Sprites } from '../../contract'
import { drawText, measureText } from '../../engine/text'
import type { TextStyle } from '../../engine/text'
import { PAL, counter, panel, stepRect } from '../../engine/ui'
import type { SiteState } from './progress'

type G = CanvasRenderingContext2D

export const MAP_H = 320
export const BAR_Y = 320
export const BAR_H = 40

const style: TextStyle = {}
function txt(g: G, s: string, x: number, y: number, color: string, scale = 1, align: 'left' | 'center' | 'right' = 'left', shadow?: string): void {
  style.color = color
  style.scale = scale
  style.align = align
  style.shadow = shadow
  style.outline = undefined
  drawText(g, s, x, y, style)
}

/** The sign plate: 'MW03' on navy, or greyed while the site is locked. Returns its width. */
export function drawPlate(g: G, sign: string, cx: number, cy: number, locked: boolean, selected: boolean, t: number): number {
  const w = measureText(sign) + 8
  const x = Math.round(cx - w / 2)
  const y = Math.round(cy - 6)
  const ring = selected ? (Math.floor(t / 16) % 2 ? PAL.yellow[2] : PAL.white) : locked ? PAL.grey[1] : PAL.white
  stepRect(g, x - 1, y - 1, w + 2, 14, 2, PAL.outline)
  stepRect(g, x, y, w, 12, 2, ring)
  stepRect(g, x + 1, y + 1, w - 2, 10, 1, locked ? PAL.grey[2] : PAL.navy)
  if (!locked) {
    g.fillStyle = PAL.brandRed
    g.fillRect(x + 2, y + 9, w - 4, 1)
  }
  txt(g, sign, x + 4, y + 2, locked ? PAL.grey[4] : PAL.white)
  return w
}

export interface Badge {
  sign: string
  state: SiteState
  /** Shown as lit (a road being drawn to it keeps it dark until it lights). */
  lit: boolean
  rec: LevelRecord | null
  /** Main levels and Rival Row show their three tokens. */
  tokens: boolean
  selected: boolean
  /** Ticks left of a shake (Maxx pushed at its locked road). */
  shake: number
  champion: boolean
  /** The crown on its way down onto the plate: pixels still to fall. */
  crownLift: number
}

/** Plate, padlock, flag, star and token pips round a site's label point. */
export function drawBadge(sprites: Sprites, g: G, b: Badge, cx: number, cy: number, t: number, flagFrames: readonly string[], starFrame: string): void {
  const locked = !b.lit || b.state === 'locked'
  const dx = b.shake > 0 ? (b.shake % 4 < 2 ? -1 : 1) : 0
  const w = drawPlate(g, b.sign, cx + dx, cy, locked, b.selected, t)
  const left = Math.round(cx - w / 2) + dx
  const right = left + w
  if (locked) {
    sprites.draw(g, 'map/lock', left - 5, cy + 5)
    return
  }
  if (b.state === 'cleared' || b.state === 'spotless') sprites.draw(g, flagFrames[Math.floor(t / 8) % flagFrames.length], right + 1, cy + 6)
  if (b.state === 'spotless') sprites.draw(g, starFrame, left - 7, cy)
  if (b.champion) sprites.draw(g, 'map/crown', cx, cy - 7 - Math.round(b.crownLift))
  if (b.tokens) {
    for (let i = 0; i < 3; i++) sprites.draw(g, b.rec?.tokens[i] ? 'map/pipOn' : 'map/pipOff', cx - 6 + i * 6, cy + 10)
  }
}

/** What the status bar says. Strings are rebuilt only when something changes. */
export interface BarInfo {
  sign: string
  name: string
  /** Left, second row: BEST 012340 and the like. */
  line: string
  tokens: readonly boolean[] | null
  spotless: boolean
  /** Shown after the tokens in place of SPOTLESS: COMING SOON, RIVALS 2/4 ... */
  extra: string
  lives: string
  score: string
  gold: string
  prompt: string
}

export function drawBar(g: G, game: GameCtx, b: BarInfo, t: number): void {
  panel(g, 0, BAR_Y, 640, BAR_H, 'bar')
  // Left: the site under Maxx.
  const pw = drawPlate(g, b.sign, 8 + (measureText(b.sign) + 8) / 2, BAR_Y + 12, false, false, t)
  txt(g, b.name, 16 + pw, BAR_Y + 6, PAL.white, 2, 'left', PAL.outline)
  let x = 8
  if (b.line) {
    txt(g, b.line, x, BAR_Y + 26, PAL.blue[3])
    x += measureText(b.line) + 8
  }
  if (b.tokens) {
    for (let i = 0; i < 3; i++) game.sprites.draw(g, b.tokens[i] ? 'map/token' : 'map/tokenOff', x + 4 + i * 10, BAR_Y + 29)
    x += 36
  }
  if (b.spotless) {
    game.sprites.draw(g, 'map/star0', x + 7, BAR_Y + 29)
    txt(g, 'SPOTLESS', x + 16, BAR_Y + 26, PAL.yellow[2])
    x += 16 + measureText('SPOTLESS') + 8
  }
  if (b.extra) txt(g, b.extra, x, BAR_Y + 26, PAL.yellow[2])

  // Right: lives, score, gold tokens; the buttons.
  const R = 632
  const gw = measureText(b.gold)
  txt(g, b.gold, R, BAR_Y + 8, PAL.white, 1, 'right')
  game.sprites.draw(g, 'map/token', R - gw - 8, BAR_Y + 11)
  const sw = measureText(b.score)
  const sx = R - gw - 20
  txt(g, b.score, sx, BAR_Y + 8, PAL.white, 1, 'right')
  txt(g, 'SCORE', sx - sw - 6, BAR_Y + 8, PAL.blue[3], 1, 'right')
  const lx = sx - sw - 6 - measureText('SCORE') - 14
  txt(g, b.lives, lx, BAR_Y + 8, PAL.white, 1, 'right')
  game.sprites.draw(g, 'maxx/head', lx - measureText(b.lives) - 19, BAR_Y + 4)
  txt(g, b.prompt, R, BAR_Y + 26, PAL.white, 1, 'right')
}

export function scoreText(n: number): string {
  return counter(Math.max(0, Math.floor(n)), 7)
}

/** A short note in a dark box, its bottom at y, kept on the map. */
export function drawNote(g: G, text: string, cx: number, y: number): void {
  const w = measureText(text) + 14
  const x = Math.round(Math.max(4, Math.min(636 - w, cx - w / 2)))
  const top = Math.round(Math.max(4, y - 18))
  panel(g, x, top, w, 18, 'dark')
  txt(g, text, x + 7, top + 5, PAL.white)
}

/** The big line across the top: NOW OPEN, A HIDDEN ROAD. */
export function drawBanner(g: G, text: string, t: number): void {
  const w = measureText(text, 2) + 28
  const x = Math.round(320 - w / 2)
  panel(g, x, 6, w, 32, 'dialog')
  txt(g, text, 320, 15, Math.floor(t / 10) % 2 ? PAL.yellow[2] : PAL.white, 2, 'center', PAL.outline)
}
