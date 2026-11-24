// The decor kind (sim/entities/decor.ts): a prop from the tiles atlas standing on the floor
// of its tile, centred on it, behind the tiles (z -1) or, with props.front, in front of Maxx
// (z 1). props.sprite names it ('decor_cone'; 'cone' and 'tiles/decor_cone' work too):
// the animation 'decor_<name>' if the atlas has one (atlas.meta.decor.<name>.ticks a frame,
// default 8), else the frame 'tiles/decor_<name>'. props.flip mirrors it, except a prop the
// atlas says has words on it (meta.decor.<name>.words): mirrored words would read backwards.
// A row of the same animated prop does not move in step: each starts at its own place in the loop.
// A name with no art draws nothing, or (debug, and in scripts/maxx/overview.mjs pictures) a
// pink post with the name over it.
import type { DrawOpts, SpriteFrame, Sprites } from '../../contract'
import { drawText } from '../../engine/text'
import type { TextStyle } from '../../engine/text'
import type { Entity } from '../../sim/types'
import { registerRenderer } from '../registry'
import type { RenderCtx } from '../registry'

const DEFAULT_TICKS = 8
const FLIP: DrawOpts = { flipX: true }
const MISSING: TextStyle = { align: 'center', color: '#ff6b6b', outline: '#1e0d06' }

interface Prop {
  /** Full frame names, ready for draw(). Empty when the atlas has no such prop (yet). */
  frames: string[]
  ticks: number
  /** The frame was drawn with no anchor: put its bottom centre on the spot ourselves. */
  topLeft: boolean
  w: number
  h: number
  /** It has words on it: never mirrored. */
  words: boolean
  /** What debug shows where a prop has no art. */
  label: string
}

/** The biggest props (a turbine, a light pole) stand this far above the tile they are placed in. */
const REACH = 360

let cachedFor: Sprites | null = null
const props = new Map<string, Prop>()
// Each entity's prop, found once: a lookup by its name every frame can cost an allocation (a
// name built with a template is a rope that the map flattens to compare).
let byEntity = new WeakMap<Entity, Prop>()

function lookUp(sprites: Sprites, sprite: string): Prop {
  let p = props.get(sprite)
  if (p) return p
  // 'decor_cone', 'cone' and 'tiles/decor_cone' all name the same prop.
  const bare = sprite.startsWith('tiles/') ? sprite.slice(6) : sprite
  const name = bare.startsWith('decor_') ? bare : `decor_${bare}`
  let frames = sprites.anim('tiles', name).filter((f) => sprites.has(f))
  if (!frames.length && sprites.has(`tiles/${name}`)) frames = [`tiles/${name}`]
  const meta = sprites.atlas('tiles')?.meta?.decor as Record<string, { ticks?: unknown; words?: unknown } | undefined> | undefined
  const info = meta?.[name.slice(6)]
  const t = info?.ticks
  const f: SpriteFrame | null = frames.length ? sprites.frame(frames[0]) : null
  p = {
    frames,
    ticks: typeof t === 'number' && t >= 1 ? Math.round(t) : DEFAULT_TICKS,
    topLeft: !!f && !f.ax && !f.ay,
    w: f ? f.w : 0,
    h: f ? f.h : 0,
    words: info?.words === true,
    label: name.toUpperCase(),
  }
  props.set(sprite, p)
  return p
}

function drawDecor(g: CanvasRenderingContext2D, e: Entity, rc: RenderCtx): void {
  if (cachedFor !== rc.sprites) {
    // Another game (or a reload of the atlases) has its own frames.
    props.clear()
    byEntity = new WeakMap()
    cachedFor = rc.sprites
  }
  const sprite = e.props.sprite
  let p = byEntity.get(e) ?? null
  if (!p && typeof sprite === 'string' && sprite) byEntity.set(e, (p = lookUp(rc.sprites, sprite)))
  if (!p || !p.frames.length) {
    if (!rc.debug && !rc.marks) return
    const x = rc.sx(e.x + e.w / 2)
    const y = rc.sy(e.y + e.h)
    g.fillStyle = '#e85aa0'
    g.fillRect(x - 1, y - 24, 2, 24)
    g.fillRect(x - 6, y - 26, 12, 4)
    drawText(g, p ? p.label : 'DECOR: NO SPRITE', x, y - 38, MISSING)
    return
  }
  const n = p.frames.length
  const frame = n === 1 ? p.frames[0] : p.frames[(((rc.tick + Math.max(0, e.slot) * 23) / p.ticks) | 0) % n]
  const flip = e.props.flip === true && !p.words
  // Whole pixels: decor never moves, and a whole number goes to the canvas without being boxed.
  const cx = Math.round(e.x + e.w / 2) | 0
  const floor = Math.round(e.y + e.h) | 0
  if (p.topLeft) {
    // No anchor in the art: the frame's top-left is the anchor, so place that corner instead.
    const half = p.w >> 1
    rc.draw(frame, flip ? cx + half : cx - half, floor - p.h, flip ? FLIP : undefined)
  } else {
    rc.draw(frame, cx, floor, flip ? FLIP : undefined)
  }
}

registerRenderer('decor', drawDecor, { margin: REACH })
