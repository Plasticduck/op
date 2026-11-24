// How entities get drawn. One function per entity kind, registered by the files in
// render/entities/ (loaded by glob from render/world.ts), the mirror of sim/registry.ts.
//
//   registerRenderer('blob', (g, e, rc) => {
//     const frames = rc.sprites.anim('critters', e.state === 'squashed' ? 'blobFlat' : 'blobWalk')
//     rc.draw(frames[(rc.tick >> 3) % frames.length], e.x + e.w / 2, e.y + e.h, { flipX: e.facing > 0 })
//   })
//
// Options, as a third argument:
//   margin   how far past its box (px) the art reaches, a number or (e) => number: the world
//            renderer skips an entity whose box is more than max(160, margin) px off screen.
//   tick     (e, rc) => void, called once every simulation tick (frozen world included) for
//            each living entity of the kind within that reach of the screen, before it is
//            drawn. The place for rc.fx: an emit here is never doubled by a fast screen nor
//            lost by a slow one. rc.draw does nothing there.
//
// A renderer reads the entity (state, stateT, hp, vars, props) and never writes to it or to
// the world: the simulation must give the same result with or without a screen.
import type { DrawOpts, Sprites } from '../contract'
import type { Entity, FxId, World } from '../sim/types'

export interface RenderCtx {
  readonly sprites: Sprites
  readonly world: World
  /**
   * The camera's top-left in world pixels, whole numbers, shake included. Between two ticks on a
   * fast screen (render/clock.ts) it is moved, for this entity alone, by what is left of the
   * entity's step: place everything from it (or rc.draw, rc.sx, rc.sy), never from world.camera.
   */
  readonly camX: number
  readonly camY: number
  /**
   * Cosmetic clock in ticks. Unlike world.tick it keeps counting while the world is frozen
   * (a pipe trip, the clear walk), so idle animations never stall. Use e.stateT for anything
   * that must line up with what the simulation is doing.
   */
  readonly tick: number
  /** Dev page: draw collision boxes and labels. */
  readonly debug: boolean
  /**
   * Level-design marks are on (debug, or the overview tool): show what a player never sees but a
   * level designer must, like an invisible trigger's reach or a prop whose art is missing.
   */
  readonly marks?: boolean
  /** Draw a frame with its anchor at a world position. */
  draw(name: string, worldX: number, worldY: number, opts?: DrawOpts): void
  /** World to screen, rounded the same way the tiles are. */
  sx(worldX: number): number
  sy(worldY: number): number
  /**
   * Cosmetic particles, as an `fx` event would make them. For things only the picture knows (exhaust
   * puffs, drips off a clean car). Best called from the kind's `tick` hook (see the header). From
   * draw(), which runs once per display frame, only the first draw of each tick emits: time such
   * emits by `tick` (e.g. `tick % 8 === 0`), knowing a slow screen can skip a tick.
   */
  fx(id: FxId, worldX: number, worldY: number, n?: number, dir?: number): void
}

export type EntityRenderer = (g: CanvasRenderingContext2D, e: Entity, rc: RenderCtx) => void
export type EntityTicker = (e: Entity, rc: RenderCtx) => void

export interface RendererOpts {
  /** Pixels past the entity's box its art may reach, or a function of the entity giving that. */
  margin?: number | ((e: Entity) => number)
  /** Once a tick, before drawing: the place for cosmetic particles. */
  tick?: EntityTicker
}

/** Everything registered for one kind (or kind:variant). The same object every lookup. */
export interface RendererEntry {
  draw: EntityRenderer
  margin: number | ((e: Entity) => number)
  tick: EntityTicker | null
}

const renderers = new Map<string, RendererEntry>()
/** kind -> variant -> what getRendererEntry answers, so a lookup builds no 'kind:variant' string every frame. */
const found = new Map<string, Map<string, RendererEntry | null>>()

/** `kind` alone, or 'kind:variant' for one variant only (looked up first). */
export function registerRenderer(kind: string, draw: EntityRenderer, opts: RendererOpts = {}): void {
  renderers.set(kind, { draw, margin: opts.margin ?? 0, tick: opts.tick ?? null })
  found.clear()
}

export function getRendererEntry(e: Entity): RendererEntry | null {
  let byVariant = found.get(e.kind)
  if (!byVariant) found.set(e.kind, (byVariant = new Map()))
  let entry = byVariant.get(e.variant)
  if (entry === undefined) {
    entry = (e.variant ? renderers.get(`${e.kind}:${e.variant}`) : undefined) ?? renderers.get(e.kind) ?? null
    byVariant.set(e.variant, entry)
  }
  return entry
}

export function getRenderer(e: Entity): EntityRenderer | undefined {
  const entry = getRendererEntry(e)
  return entry ? entry.draw : undefined
}

/** How far past its box an entity's art reaches, as its renderer declared (0 if it said nothing). */
export function rendererMargin(entry: RendererEntry, e: Entity): number {
  const m = entry.margin
  return typeof m === 'number' ? m : m(e)
}

export function renderedKinds(): string[] {
  return [...renderers.keys()].sort()
}
