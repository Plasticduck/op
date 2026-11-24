// The cards of the play scene: the level card shown before a level opens, the short lives
// card before a retry, and the versus card of a boss or rival fight.
import { VIEW_H, VIEW_W } from '../../contract'
import type { DrawOpts, LevelDef, LevelRecord, Sprites } from '../../contract'
import { drawText, measureText } from '../../engine/text'
import type { TextStyle } from '../../engine/text'
import { PAL, blink, counter, stepRect } from '../../engine/ui'
import { getRenderer } from '../../render/registry'
import type { RenderCtx } from '../../render/registry'
import type { Entity, World } from '../../sim/types'
import { COVER, bounceIn } from './cover'

type G = CanvasRenderingContext2D

const st: TextStyle = {}
const X2: DrawOpts = { scale: 2 }
const X3: DrawOpts = { scale: 3 }

function say(g: G, text: string, x: number, y: number, scale: number, color: string, align: 'left' | 'center' | 'right' = 'center', outline?: string, shadow?: string): void {
  st.scale = scale
  st.color = color
  st.align = align
  st.outline = outline
  st.shadow = shadow
  drawText(g, text, x, y, st)
}

/** The largest scale from `max` down to 1 at which `text` is no wider than `room`. */
export function fitScale(text: string, room: number, max: number): number {
  const w = Math.max(1, measureText(text, 1))
  return Math.max(1, Math.min(max, Math.floor(room / w)))
}

/* ------------------------------------------------------------------ */
/* Level card                                                          */
/* ------------------------------------------------------------------ */

/** How long the level card stays, and the lives card before a retry. Confirm skips either. */
export const CARD_TICKS = 90
export const RETRY_CARD_TICKS = 54
/** Ticks before a card can be skipped: the press that brought the player here must not also skip it. */
export const CARD_MIN_TICKS = 8

const BAND_TOP = 56
const BAND_H = 216
const RUN_TICKS = 4

/** The site number as the sign at a wash's gate: white on brand blue, a white border, round corners. */
function sitePlate(g: G, site: string, cx: number, y: number): void {
  const scale = fitScale(site, 180, 5)
  const w = measureText(site, scale) + 14 * scale
  const h = 12 * scale + 4
  const x = Math.round(cx - w / 2)
  stepRect(g, x, y, w, h, 4, PAL.outline)
  stepRect(g, x + 2, y + 2, w - 4, h - 4, 3, PAL.white)
  stepRect(g, x + 5, y + 5, w - 10, h - 10, 2, PAL.brandBlue)
  g.fillStyle = PAL.blue[3]
  g.fillRect(x + 8, y + 6, w - 16, 2)
  say(g, site, cx, y + Math.round((h - 7 * scale) / 2), scale, PAL.white, 'center', undefined, PAL.blue[0])
}

// The cards' texts, made again only when what they say changes (they are drawn every frame).
let textsName = ''
let textsSite = ''
let textsLives = -1
let textsBest = -1
let nameText = ''
let siteNameText = ''
let livesText = ''
let livesBefore = ''
let bestText = ''
function texts(level: LevelDef, lives: number, best: number): void {
  if (level.name === textsName && level.site === textsSite && lives === textsLives && best === textsBest) return
  textsName = level.name
  textsSite = level.site
  textsLives = lives
  textsBest = best
  nameText = level.name.toUpperCase()
  // Rival Row's site is '???': a mystery plate on the level card, but a blank in a line of text.
  siteNameText = /[A-Z0-9]/i.test(level.site) ? level.site.toUpperCase() + '  ' + nameText : nameText
  livesText = '{times} ' + lives
  livesBefore = '{times} ' + (lives + 1)
  bestText = 'BEST ' + counter(best, 7)
}

function tokenRow(g: G, sprites: Sprites, tokens: readonly boolean[], x: number, y: number): void {
  for (let i = 0; i < 3; i++) sprites.draw(g, tokens[i] ? 'hud/tokenOn' : 'hud/tokenOff', x + i * 36, y, X2)
}

/**
 * The level card: the site, the level's name, Maxx and his lives, the three token slots as
 * the save has them, and the best score once there is one. `t` counts ticks since it came up.
 */
export function drawLevelCard(g: G, sprites: Sprites, level: LevelDef, record: LevelRecord | null, lives: number, t: number): void {
  g.fillStyle = COVER
  g.fillRect(0, 0, VIEW_W, VIEW_H)
  // A band of brand navy across the dark, ruled in blue, like the stripe along a wash tunnel wall.
  g.fillStyle = PAL.navy
  g.fillRect(0, BAND_TOP, VIEW_W, BAND_H)
  g.fillStyle = PAL.brandBlue
  g.fillRect(0, BAND_TOP, VIEW_W, 3)
  g.fillRect(0, BAND_TOP + BAND_H - 3, VIEW_W, 3)
  g.fillStyle = PAL.brandRed
  g.fillRect(0, BAND_TOP + 5, VIEW_W, 2)
  g.fillRect(0, BAND_TOP + BAND_H - 7, VIEW_W, 2)

  // Maxx runs on the spot on the band's lower rule, twice his size.
  const run = sprites.anim('maxx', 'run')
  const floor = BAND_TOP + BAND_H - 12
  g.fillStyle = PAL.blue[0]
  g.fillRect(52, floor, 136, 5)
  if (run.length) sprites.draw(g, run[Math.floor(t / RUN_TICKS) % run.length], 112, floor, X2)

  const cx = 408
  texts(level, lives, record ? record.bestScore : 0)
  // The plate drops in; everything else is there from the start, so a skipped card was still read.
  const drop = Math.round((1 - bounceIn(Math.min(1, t / 14))) * -70)
  sitePlate(g, level.site, cx, BAND_TOP + 22 + drop)
  say(g, nameText, cx, BAND_TOP + 100, fitScale(nameText, 410, 3), PAL.yellow[2], 'center', undefined, PAL.outline)

  const rowY = BAND_TOP + 140
  const livesW = measureText(livesText, 3)
  const rowW = 32 + 8 + livesW + 36 + 104
  const x0 = Math.round(cx - rowW / 2)
  sprites.draw(g, 'maxx/head', x0, rowY, X2)
  say(g, livesText, x0 + 40, rowY + 5, 3, PAL.white, 'left')
  tokenRow(g, sprites, record ? record.tokens : NO_TOKENS, x0 + 40 + livesW + 36, rowY)

  if (record && record.bestScore > 0) {
    say(g, bestText, cx, rowY + 46, 2, PAL.blue[3], 'center')
    if (record.spotless) sprites.draw(g, 'hud/star', cx + (measureText(bestText, 2) >> 1) + 14, rowY + 53)
  }
  if (blink(t, 30, 0.7)) say(g, 'GET READY!', VIEW_W / 2, BAND_TOP + BAND_H + 26, 2, PAL.white, 'center')
}
const NO_TOKENS: readonly boolean[] = [false, false, false]

/**
 * The card before a retry: his head and the lives he has left, the count dropping by one as it
 * shows, and where he will start (the checkpoint flag, when there is one).
 */
export function drawRetryCard(g: G, sprites: Sprites, level: LevelDef, lives: number, t: number, fromCheckpoint: boolean): void {
  g.fillStyle = COVER
  g.fillRect(0, 0, VIEW_W, VIEW_H)
  const cy = VIEW_H / 2
  texts(level, lives, textsBest < 0 ? 0 : textsBest)
  say(g, siteNameText, VIEW_W / 2, cy - 72, fitScale(siteNameText, 560, 2), PAL.blue[3], 'center')
  // The old number for a moment, then the new one lands.
  const swapped = t >= 18
  const shown = swapped ? livesText : livesBefore
  const w = 48 + 14 + measureText(shown, 4)
  const x = Math.round((VIEW_W - w) / 2)
  sprites.draw(g, 'maxx/head', x, cy - 36, X3)
  const hopY = swapped ? Math.round((1 - bounceIn(Math.min(1, (t - 18) / 10))) * -18) : 0
  say(g, shown, x + 62, cy - 26 + hopY, 4, swapped && t < 30 ? PAL.red[5] : PAL.white, 'left')
  say(g, lives === 1 ? 'LAST ONE. MAKE IT SHINE!' : 'TRY AGAIN!', VIEW_W / 2, cy + 32, 2, PAL.yellow[2], 'center')
  if (fromCheckpoint) {
    const fw = measureText(CHECKPOINT_TEXT, 1)
    const fx = Math.round((VIEW_W - fw - 18) / 2)
    sprites.draw(g, 'hud/flag', fx, cy + 54)
    say(g, CHECKPOINT_TEXT, fx + 18, cy + 60, 1, PAL.blue[3], 'left')
  }
}
const CHECKPOINT_TEXT = 'FROM THE CHECKPOINT'

/* ------------------------------------------------------------------ */
/* Versus card                                                         */
/* ------------------------------------------------------------------ */

/** How long the versus card holds the level, wipe in and out included. */
export const VERSUS_TICKS = 170
const WIPE_TICKS = 12
/** Ticks before a button can cut it short. */
const VERSUS_MIN_TICKS = 30
const STEP = 4
/** The seam leans right toward the bottom: Maxx's half is wide below, the rival's above, where its name is. */
const SLANT = 0.3
/** Top of the two rows of names, at their largest scale. */
const NAME_Y = 26
const NAME_ROW = 46
const VS_X = VIEW_W / 2
const VS_Y = 196
const FEET_Y = 306

/**
 * The room the rival's picture has on the red half: it is drawn as large as fits, up to 3x. Its
 * top may tuck a few pixels in behind the bottom of a two-line name, which is drawn over it (Slick
 * Ollie's cap at 3x); a face never reaches that high.
 */
const PORTRAIT_W = 286
const PORTRAIT_H = 210
/**
 * Where it stands: its front (the face, toward Maxx) just clear of the VS burst, and a small one
 * in the middle of the free room. A big one runs off the right edge rather than hide its face.
 */
const PORTRAIT_FRONT = 428
const PORTRAIT_MID = 528

// The rival's picture is the entity itself, drawn by its own renderer (render/entities/) at
// 2x or 3x round its feet: whatever it looks like in the level, it looks like here, and no
// separate portrait art is needed. This is the RenderCtx that renderer gets.
const pr = { g: null as G | null, sprites: null as Sprites | null, world: null as World | null, camX: 0, camY: 0, tick: 0 }
const portraitCtx: RenderCtx = {
  get sprites() {
    return pr.sprites as Sprites
  },
  get world() {
    return pr.world as World
  },
  get camX() {
    return pr.camX
  },
  get camY() {
    return pr.camY
  },
  get tick() {
    return pr.tick
  },
  debug: false,
  marks: false,
  draw(name, wx, wy, o) {
    if (pr.g && pr.sprites) pr.sprites.draw(pr.g, name, Math.round(wx) - pr.camX, Math.round(wy) - pr.camY, o)
  },
  sx: (wx) => Math.round(wx) - pr.camX,
  sy: (wy) => Math.round(wy) - pr.camY,
  // Particles would land in the level's own picture, not on the card.
  fx() {},
}
/** Kinds whose renderer threw when drawn on the card: left out from then on. */
const portraitBroken = new Set<string>()

/** How far the renderer's paint reaches from the feet at 1x, facing as on the card: behind, ahead toward Maxx, and up. */
interface Reach {
  left: number
  right: number
  up: number
}
const PROBE_W = 480
const PROBE_H = 360
const PROBE_FEET = 320
let probe: CanvasRenderingContext2D | null = null

/**
 * The entity drawn once on a scratch canvas and its paint measured. Its box says little about
 * its picture: Sir Streaks' box is 68 px tall and his squeegee reaches 91, Nimbus Nick's puffs
 * spill well past his box. Null without a renderer or a document (Node).
 */
function measure(sprites: Sprites, world: World, e: Entity): Reach | null {
  if (!probe) {
    if (typeof document === 'undefined') return null
    const c = document.createElement('canvas')
    c.width = PROBE_W
    c.height = PROBE_H
    probe = c.getContext('2d', { willReadFrequently: true })
    if (!probe) return null
  }
  probe.clearRect(0, 0, PROBE_W, PROBE_H)
  const mid = PROBE_W >> 1
  if (!drawPortrait(probe, sprites, world, e, mid, PROBE_FEET, 1, 0)) return null
  let px: Uint8ClampedArray
  try {
    px = probe.getImageData(0, 0, PROBE_W, PROBE_H).data
  } catch {
    // Art from another origin cannot be read back: the box will have to do.
    return null
  }
  let x0 = PROBE_W
  let x1 = -1
  let y0 = PROBE_H
  for (let y = 0; y < PROBE_H; y++) {
    const row = y * PROBE_W * 4
    for (let x = 0; x < PROBE_W; x++) {
      if (px[row + x * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
    }
  }
  if (x1 < 0) return null
  return { left: mid - x0, right: x1 + 1 - mid, up: Math.max(1, PROBE_FEET - y0) }
}

/** The scale the entity is drawn at on the card: as large as its picture fits, up to 3x, and never under 2x (a giant is meant to look too big for the card). */
function portraitScale(r: Reach): number {
  return Math.max(2, Math.min(3, Math.floor(Math.min(PORTRAIT_W / Math.max(1, r.left + r.right), PORTRAIT_H / r.up))))
}

/** Draws `e` facing left with its feet at (x, y), `scale` times its size. False if it has no renderer. */
function drawPortrait(g: G, sprites: Sprites, world: World, e: Entity, x: number, y: number, scale: number, tick: number): boolean {
  const paint = portraitBroken.has(e.kind) ? undefined : getRenderer(e)
  if (!paint) return false
  pr.g = g
  pr.sprites = sprites
  pr.world = world
  pr.camX = Math.round(e.x + e.w / 2)
  pr.camY = Math.round(e.y + e.h)
  pr.tick = tick
  g.save()
  g.translate(Math.round(x), Math.round(y))
  // It faces Maxx across the seam, whichever way it faces in the level.
  g.scale(e.facing > 0 ? -scale : scale, scale)
  try {
    paint(g, e, portraitCtx)
  } catch (err) {
    portraitBroken.add(e.kind)
    console.error(`[maxx] the renderer of '${e.kind}' threw on the versus card:`, err)
  }
  g.restore()
  pr.g = null
  pr.world = null
  return true
}

export interface Versus {
  /**
   * A boss or rival appears. `who` is the entity, drawn on the card by its own renderer, and
   * `world` the world it lives in; null for none (the red half then has only its speed lines).
   */
  start(name: string, tagline: string, who?: Entity | null, world?: World | null): void
  stop(): void
  /** One tick; `skip` ends it early. True on the tick the two halves slam together (flash, rumble). */
  update(skip: boolean): boolean
  draw(g: G, sprites: Sprites): void
  /** Up, and holding the level. */
  readonly active: boolean
  readonly name: string
  /** The player cut this card short (it is wiping out early). */
  readonly skipped: boolean
  /** The opponent's scale on the card, 0 before it is first drawn or with no opponent (for checks). */
  readonly scale: number
}

export function createVersus(): Versus {
  let active = false
  let t = 0
  let name = ''
  let tagline = ''
  let line1 = ''
  let line2 = ''
  let nameScale = 3
  let tagScale = 2
  let skipped = false
  let who: Entity | null = null
  let whoWorld: World | null = null
  let whoScale = 0
  let whoReach: Reach = { left: 0, right: 0, up: 0 }

  /** Where the seam crosses row y, before the halves are pulled apart. */
  const seamAt = (y: number) => Math.round((VIEW_W / 2 - (VIEW_H / 2 - y) * SLANT) / STEP) * STEP

  /** How far apart the halves are: 1 off screen, 0 shut. */
  function gap(): number {
    if (t < WIPE_TICKS) {
      const k = 1 - t / WIPE_TICKS
      return k * k
    }
    const out = t - (VERSUS_TICKS - WIPE_TICKS)
    if (out > 0) {
      const k = Math.min(1, out / WIPE_TICKS)
      return k * k
    }
    return 0
  }

  return {
    get active() {
      return active
    },
    get name() {
      return name
    },
    get skipped() {
      return skipped
    },
    get scale() {
      return whoScale
    },
    start(title, what, e = null, w = null) {
      active = true
      t = 0
      skipped = false
      name = String(title).toUpperCase()
      tagline = String(what).toUpperCase()
      who = e && w ? e : null
      whoWorld = who ? w : null
      // Measured on the first draw, which has the sprites.
      whoScale = 0
      // A two-word name stacks like MIGHTY over MAXX, so it can be larger.
      const mid = name.length / 2
      let cut = -1
      for (let i = 0; i < name.length; i++) if (name[i] === ' ' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i
      line1 = cut < 0 ? name : name.slice(0, cut)
      line2 = cut < 0 ? '' : name.slice(cut + 1)
      // The red half is about 300 px wide at the height of the names.
      nameScale = Math.min(fitScale(line1, 290, 5), line2 ? fitScale(line2, 290, 5) : 5)
      tagScale = fitScale(tagline, 600, 2)
    },
    stop() {
      active = false
      who = whoWorld = null
    },
    update(skip) {
      if (!active) return false
      t++
      if (skip && t > VERSUS_MIN_TICKS && t < VERSUS_TICKS - WIPE_TICKS) {
        t = VERSUS_TICKS - WIPE_TICKS
        skipped = true
      }
      if (t >= VERSUS_TICKS) {
        active = false
        who = whoWorld = null
      }
      return t === WIPE_TICKS
    },
    draw(g, sprites) {
      if (!active) return
      const open = gap()
      const shift = Math.round(open * (VIEW_W / 2 + 80))
      const shut = open === 0
      const since = t - WIPE_TICKS
      // Two halves with a slanted seam, in steps: blue for Maxx from the left, red for the rival from the right.
      for (let y = 0; y < VIEW_H; y += STEP) {
        const seam = seamAt(y)
        const l = seam - shift
        const r = seam + shift
        if (l > 0) {
          g.fillStyle = PAL.blue[1]
          g.fillRect(0, y, l, STEP)
          g.fillStyle = PAL.blue[0]
          g.fillRect(l - 8, y, 8, STEP)
        }
        if (r < VIEW_W) {
          g.fillStyle = PAL.red[2]
          g.fillRect(r, y, VIEW_W - r, STEP)
          g.fillStyle = PAL.red[0]
          g.fillRect(r, y, 8, STEP)
        }
      }
      // Speed lines on each half, moving with it.
      g.fillStyle = PAL.blue[2]
      for (let k = 0; k < 5; k++) g.fillRect(-shift + ((k * 97 + t * 9) % 300) - 40, 34 + k * 61, 70, 3)
      g.fillStyle = PAL.red[3]
      for (let k = 0; k < 5; k++) g.fillRect(VIEW_W + shift - ((k * 113 + t * 9) % 300) - 30, 52 + k * 61, 70, 3)

      // The two pictures stand on the lower half: Maxx on the left, the rival on the right, each on its own shadow.
      const lx = -shift
      const rx = VIEW_W + shift
      g.fillStyle = PAL.blue[0]
      g.fillRect(lx + 92, FEET_Y - 3, 120, 6)
      const pose = sprites.anim('maxx', 'sprayIdle')
      if (pose.length) sprites.draw(g, pose[(t >> 4) % pose.length], lx + 150, FEET_Y, X3)
      if (who && whoWorld) {
        if (!whoScale) {
          const r = measure(sprites, whoWorld, who)
          if (r) whoReach = r
          else {
            whoReach.left = whoReach.right = who.w / 2
            whoReach.up = who.h
          }
          whoScale = portraitScale(whoReach)
        }
        const s = whoScale
        // The picture centred in its room, but its front never over the VS burst.
        const px = rx - VIEW_W + Math.round(Math.max(PORTRAIT_MID + ((whoReach.left - whoReach.right) * s) / 2, PORTRAIT_FRONT + whoReach.left * s))
        const half = (who.w * s) >> 1
        g.fillStyle = PAL.red[0]
        g.fillRect(px - half - 6, FEET_Y - 3, 2 * half + 12, 6)
        drawPortrait(g, sprites, whoWorld, who, px, FEET_Y, s, t)
      }

      if (shut) {
        // The seam cracks with lightning and VS lands on it.
        for (let y = 20; y < VIEW_H - 40; y += 64) sprites.draw(g, 'hud/bolt', seamAt(y + 17) + ((y >> 6) & 1 ? 3 : -3), y + 17)
        const pop = bounceIn(Math.min(1, since / 10))
        const by = Math.round(VS_Y - (1 - pop) * 50)
        sprites.draw(g, 'hud/burst', VS_X, by, since < 6 ? undefined : X2)
        if (since >= 6) say(g, 'VS', VS_X + 2, by - 28, 8, PAL.red[3], 'center', PAL.white, PAL.outline)
      }

      // The names read across the top: MIGHTY MAXX on the left, the rival's on the right.
      say(g, 'MIGHTY', lx + 24, NAME_Y, 5, PAL.white, 'left', PAL.navy, PAL.blue[0])
      say(g, 'MAXX', lx + 24, NAME_Y + NAME_ROW, 5, PAL.yellow[2], 'left', PAL.navy, PAL.blue[0])
      const shake = shut && since < 10 ? ((since >> 1) & 1 ? 2 : -2) : 0
      const rowGap = Math.round((NAME_ROW * nameScale) / 5)
      const blockH = (line2 ? rowGap : 0) + 7 * nameScale
      const ny = Math.round(NAME_Y + (NAME_ROW + 35 - blockH) / 2)
      say(g, line1, rx - 24 + shake, ny, nameScale, PAL.white, 'right', PAL.outline, PAL.red[0])
      if (line2) say(g, line2, rx - 24 + shake, ny + rowGap, nameScale, PAL.white, 'right', PAL.outline, PAL.red[0])

      if (shut) {
        // What the rival stands for, on a strip along the bottom.
        if (tagline && since > 14) {
          const h = 12 * tagScale + 8
          const slide = Math.round((1 - bounceIn(Math.min(1, (since - 14) / 12))) * 60)
          g.fillStyle = PAL.outline
          g.fillRect(0, VIEW_H - h - 14 + slide, VIEW_W, h)
          g.fillStyle = PAL.yellow[1]
          g.fillRect(0, VIEW_H - h - 14 + slide, VIEW_W, 2)
          g.fillRect(0, VIEW_H - 16 + slide, VIEW_W, 2)
          say(g, tagline, VIEW_W / 2, VIEW_H - h - 14 + slide + Math.round((h - 7 * tagScale) / 2), tagScale, PAL.yellow[2], 'center')
        }
        if (since < 3) {
          g.fillStyle = PAL.white
          g.fillRect(0, 0, VIEW_W, VIEW_H)
        }
      }
    },
  }
}
