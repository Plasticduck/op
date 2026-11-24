// Draws a World: the playfield only, no HUD.
//
// Back to front: sky bands, clouds and parallax strips (render/themes.ts), far weather,
// entities with z < 0, Maxx if he is in a pipe (or sinking in sludge), the tiles
// (render/tiles.ts), entities with z == 0, Maxx (render/maxx.ts), entities with z > 0,
// droplets, particles (render/particles.ts), near weather, the wings of a narrow area, popups.
// Within each of the three entity layers: lowest z first, decor first among equal z (so
// scenery never stands in front of the arch or a coin beside it), then in spawn order.
//
// A scene makes one with createWorldRenderer(sprites, opts) and then, every tick:
//   for each event of world.events: renderer.event(ev, world)     (fx, popup, shake, area)
//   renderer.update(world)
// and every display frame: renderer.draw(g, world). Call reset(world) for a new world.
// Nothing in the draw path allocates. update() is the clock: particles age, and the
// renderers' rc.tick moves, only there; draw() may run any number of times between.
// On a screen faster than 60 Hz the shell may ask for frames between two ticks (render/clock.ts):
// then the camera, Maxx, every awake entity, the droplets and the particles are each drawn a
// part of the way back to where they were at the tick before, all by the same amount. An entity
// renderer needs nothing for it: rc.camX and rc.camY are moved for that entity alone.
import { DT, TILE, VIEW_H, VIEW_W } from '../contract'
import type { DrawOpts, Sprites } from '../contract'
import { drawText } from '../engine/text'
import type { TextStyle } from '../engine/text'
import { TILE_FLAGS, TUNING, T_SOLID } from '../sim'
import type { Droplet, Entity, FxId, GameEvent, World } from '../sim/types'
import { BACK, CAM_X, CAM_Y, LERP_MAX, createLerp, lerpFrame, lerpReset, lerpTrack } from './clock'
import { createMaxxPainter, maxxInSludge } from './maxx'
import { createParticles } from './particles'
import type { ParticleId } from './particles'
import { getRendererEntry, rendererMargin } from './registry'
import type { RenderCtx, RendererEntry } from './registry'
import { drawBackdrop, resolveBackdrop } from './themes'
import type { Backdrop } from './themes'
import { createTileLayer } from './tiles'
import { drawWeather } from './weather'

// Every file in entities/ registers its renderers as it loads.
import.meta.glob('./entities/*.ts', { eager: true })

export interface WorldRenderer {
  /** A new world, or Maxx arrived in another area: drop particles and cached tiles. */
  reset(world: World): void
  /** Once per simulation tick, paused or not frozen: particles, popups and the cosmetic clock. */
  update(world: World): void
  /** Hand every GameEvent here. It uses fx, popup and shake and ignores the rest. */
  event(ev: GameEvent, world: World): void
  /** Draw the whole 640x360 playfield for world.camera. */
  draw(g: CanvasRenderingContext2D, world: World): void
}

export interface WorldRendererOpts {
  /** Screen shake allowed (the player's setting). Default true. */
  shake?: boolean
  /** Collision boxes, labels for kinds with no renderer, hidden blocks outlined. */
  debug?: boolean
  /** What a level designer needs and a player must not see: hidden blocks outlined, and a box and a label for kinds with no renderer (spawners, markers, pipes). No collision boxes. */
  marks?: boolean
  /** Leave Maxx out of the picture (tools). */
  hideMaxx?: boolean
  /** Nail the backdrop to the world: no parallax, no drifting clouds, no weather. For pictures stitched from several camera positions. */
  pinned?: boolean
  /** Rain and snow. Default true. */
  weather?: boolean
}

/** Numbers for tools and checks. The same object every call. */
export interface WorldRendererStats {
  /** The cosmetic clock. */
  tick: number
  particles: number
  popups: number
  /** Tile chunks built since the renderer was made, and chunks held. */
  chunkBuilds: number
  chunks: number
  /** How many tile frame keys of the current theme have art, and whether its backdrop atlas is there. */
  tileArt: number
  backdropArt: boolean
  /** The Maxx frame last chosen. */
  maxxFrame: string
  /** Where the last draw put the camera's top-left, shake included. */
  camX: number
  camY: number
  /** Entity kinds whose renderer threw (each is reported once and drawn as a box from then on). */
  problems: string[]
}

/** What createWorldRenderer hands back: the renderer, plus a few things for tools and for scenes that want their own effects. */
export interface WorldRendererDev extends WorldRenderer {
  stats(): WorldRendererStats
  /** Particles, exactly as an `fx` event makes them. */
  fx(id: FxId, x: number, y: number, n?: number, dir?: number): void
  popup(text: string, x: number, y: number): void
}

/** Entities this far outside the screen are not drawn, unless their renderer says its art reaches further (its margin). */
const CULL = 160
const DECOR = 'decor'
const TRACKED = 64
const BAR = '#16161d'
/** Droplet streak lengths in pixels, and its colours by pass: rim, tail, middle, head. */
const STREAK = 9
const STREAK_TURBO = 12
const DROP_COLORS = ['#1456b8', '#109ff9', '#b9ecff', '#f7f4f8']
const LABEL: TextStyle = { align: 'center', color: '#f7f4f8', outline: '#1e0d06' }

/**
 * A camera coordinate moved by a shake offset, kept between 0 and `max` (the farthest the camera
 * goes in an area wider or taller than the screen), but never pulled back from where the camera
 * already is (a tool may look past the edge on purpose). No limit when the area is the smaller one.
 */
function shaken(cam: number, by: number, max: number): number {
  if (max < 0) return cam + by
  return Math.max(Math.min(cam, 0), Math.min(Math.max(cam, max), cam + by))
}

export function createWorldRenderer(sprites: Sprites, opts: WorldRendererOpts = {}): WorldRendererDev {
  const tiles = createTileLayer(sprites)
  const particles = createParticles(sprites)
  const maxx = createMaxxPainter(sprites)
  const debug = !!opts.debug
  const marks = debug || !!opts.marks
  const pinned = !!opts.pinned
  const weatherOn = opts.weather !== false && !pinned

  let tick = 0
  let shakeT = 0
  let shakeFor = 1
  let shakeMag = 0
  let camX = 0
  let camY = 0
  let world: World | null = null
  let backdrop: Backdrop | null = null
  let g0: CanvasRenderingContext2D | null = null
  const lerp = createLerp()
  // Maxx's slide this frame in whole pixels, for the droplets just fired from his nozzle.
  let maxxDx = 0
  let maxxDy = 0

  // The droplets of the tick before, to see which are gone and where they were going.
  const seen: (Droplet | null)[] = new Array<Droplet | null>(TRACKED).fill(null)
  const seenX = new Float32Array(TRACKED)
  const seenY = new Float32Array(TRACKED)
  const seenVx = new Float32Array(TRACKED)
  const seenLife = new Int16Array(TRACKED)
  let seenN = 0

  const broken = new Set<string>()
  const labels = new Map<string, string>()
  const stats: WorldRendererStats = { tick: 0, particles: 0, popups: 0, chunkBuilds: 0, chunks: 0, tileArt: 0, backdropArt: false, maxxFrame: '', camX: 0, camY: 0, problems: [] }

  const emit = (id: ParticleId, x: number, y: number, n?: number, dir?: number): void => particles.emit(id, x, y, n, dir)
  // Entity renderers may puff smoke and drips from draw(), which runs once per display frame: on
  // a 144 Hz screen that is two or three times a tick. Only the first draw of a tick may emit, and
  // a pinned picture (a tool's still) never does. A kind's tick hook always may (unless pinned).
  let fxOpen = false
  let fxTick = -1
  const drawFx = (id: FxId, x: number, y: number, n?: number, dir?: number): void => {
    if (fxOpen) particles.emit(id, x, y, n, dir)
  }

  const rc: RenderCtx = {
    sprites,
    get world() {
      return world as World
    },
    get camX() {
      return camX
    },
    get camY() {
      return camY
    },
    get tick() {
      return tick
    },
    debug,
    marks,
    draw(name: string, wx: number, wy: number, o?: DrawOpts) {
      if (g0) sprites.draw(g0, name, Math.round(wx) - camX, Math.round(wy) - camY, o)
    },
    sx: (wx) => Math.round(wx) - camX,
    sy: (wy) => Math.round(wy) - camY,
    fx: drawFx,
  }

  function label(e: Entity): string {
    const k = e.variant ? `${e.kind}:${e.variant}` : e.kind
    let text = labels.get(k)
    if (text === undefined) {
      text = (e.variant ? `${e.kind} ${e.variant}` : e.kind).toUpperCase()
      labels.set(k, text)
    }
    return text
  }

  /** Whether an entity's box comes within `far` px (at least CULL, more if its renderer says so) of a camera at (cx, cy). */
  function near(e: Entity, entry: RendererEntry | null, cx: number, cy: number): boolean {
    const far = entry ? Math.max(CULL, rendererMargin(entry, e)) : CULL
    const x = Math.round(e.x) - cx
    const y = Math.round(e.y) - cy
    return !(x > VIEW_W + far || y > VIEW_H + far || x + e.w < -far || y + e.h < -far)
  }

  function drawEntity(g: CanvasRenderingContext2D, e: Entity): void {
    const entry = getRendererEntry(e)
    if (!near(e, entry, camX, camY)) return
    // Between two ticks: the camera this entity's renderer sees is moved by what is left of its
    // own step, so it lands part of the way back without the renderer knowing. Only an awake
    // entity has stepped this tick; a sleeping one's px is from whenever it last moved.
    let sx = 0
    let sy = 0
    const back = lerp[BACK]
    if (back > 0 && e.active) {
      const dx = e.x - e.px
      const dy = e.y - e.py
      if (dx <= LERP_MAX && dx >= -LERP_MAX && dy <= LERP_MAX && dy >= -LERP_MAX) {
        sx = Math.round(e.x) - Math.round(e.x - dx * back)
        sy = Math.round(e.y) - Math.round(e.y - dy * back)
      }
    }
    camX += sx
    camY += sy
    const x = Math.round(e.x) - camX
    const y = Math.round(e.y) - camY
    const draw = entry && !broken.has(e.kind) ? entry.draw : undefined
    if (draw) {
      try {
        draw(g, e, rc)
      } catch (err) {
        // One bad renderer must not take the whole picture down: say so once, then box it.
        broken.add(e.kind)
        stats.problems.push(e.kind)
        console.error(`[maxx] the renderer of '${e.kind}' threw and is switched off:`, err)
      }
      if (g.globalAlpha !== 1) g.globalAlpha = 1
    }
    camX -= sx
    camY -= sy
    if (!marks || (draw && !debug)) return
    g.strokeStyle = e.harmful ? '#f51924' : e.solid !== 'none' ? '#109ff9' : '#49b23c'
    g.lineWidth = 1
    g.strokeRect(x + 0.5, y + 0.5, Math.max(1, e.w - 1), Math.max(1, e.h - 1))
    if (!draw) drawText(g, label(e), x + e.w / 2, y - 10, LABEL)
  }

  // The drawing order of one layer, as indices into world.entities (grown, never shrunk).
  let order = new Int32Array(256)

  /**
   * One layer of entities: -1 behind the tiles, 0 in front of them and behind Maxx, 1 in front of
   * Maxx. Inside it, lowest z first; at equal z decor first, so a lamp post never stands in front
   * of the arch or the coin beside it; then spawn order. An insertion sort: the entities come in
   * spawn order and mostly share a z, so each one usually goes straight on the end.
   */
  function drawEntities(g: CanvasRenderingContext2D, w: World, layer: number): void {
    const ents = w.entities
    if (order.length < ents.length) order = new Int32Array(ents.length * 2)
    let n = 0
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]
      if (e.dead || (layer < 0 ? e.z >= 0 : layer > 0 ? e.z <= 0 : e.z !== 0)) continue
      const z = e.z
      const decor = e.kind === DECOR
      let j = n++
      while (j > 0) {
        const o = ents[order[j - 1]]
        if (!(z < o.z || (z === o.z && decor && o.kind !== DECOR))) break
        order[j] = order[j - 1]
        j--
      }
      order[j] = i
    }
    for (let k = 0; k < n; k++) drawEntity(g, ents[order[k]])
  }

  /** The kinds' tick hooks, for every living entity near the screen. */
  function tickEntities(w: World): void {
    const ents = w.entities
    const cx = Math.round(w.camera.x)
    const cy = Math.round(w.camera.y)
    fxOpen = !pinned
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]
      if (e.dead) continue
      const entry = getRendererEntry(e)
      if (!entry || !entry.tick || broken.has(e.kind) || !near(e, entry, cx, cy)) continue
      try {
        entry.tick(e, rc)
      } catch (err) {
        broken.add(e.kind)
        stats.problems.push(e.kind)
        console.error(`[maxx] the tick hook of '${e.kind}' threw and its renderer is switched off:`, err)
      }
    }
    fxOpen = false
  }

  /**
   * Each droplet is a short streak back along the way it flies: a white head, a pale middle and
   * a blue tail, with a dark blue rim on the lower right so water reads on a pale sky too.
   * A turbo droplet is thicker and longer. A droplet just fired has not moved yet: it is all
   * head, so no tail pokes back into the nozzle. One pass per colour over all of them.
   */
  function drawDroplets(g: CanvasRenderingContext2D, w: World): void {
    const ds = w.droplets
    if (!ds.length) return
    const back = lerp[BACK]
    for (let pass = 0; pass < 4; pass++) {
      g.fillStyle = DROP_COLORS[pass]
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i]
        const big = d.power >= TUNING.turboPower
        const size = big ? 3 : 2
        const head = big ? 3 : 2
        const len = d.life < TUNING.dropletLife ? (big ? STREAK_TURBO : STREAK) : head
        // Steps from the head this pass paints: the rim under all of it, then tail, middle, head.
        const from = pass === 0 || pass === 3 ? 0 : pass === 2 ? head : head * 2
        const to = pass === 0 ? len : pass === 3 ? head : pass === 2 ? head * 2 : len
        if (from >= to) continue
        const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy) || 1
        let ux = d.vx / speed
        let uy = d.vy / speed
        // One whole pixel along the longer axis a step, so a slanted streak has no holes.
        const k = 1 / Math.max(Math.abs(ux), Math.abs(uy))
        ux *= k
        uy *= k
        // An even size centred on the point, so the stream sits the same off the nozzle both ways.
        let hx = Math.round(d.x) - camX - 1
        let hy = Math.round(d.y) - camY - 1
        if (back > 0) {
          // Between ticks: back along its own flight (the sim moves it by its velocity after
          // gravity), or, just fired and not yet moved, with the nozzle it left.
          if (d.life < TUNING.dropletLife) {
            hx = Math.round(d.x - d.vx * DT * back) - camX - 1
            hy = Math.round(d.y - d.vy * DT * back) - camY - 1
          } else {
            hx -= maxxDx
            hy -= maxxDy
          }
        }
        const rim = pass === 0 ? 1 : 0
        for (let s = from; s < Math.min(to, len); s++) g.fillRect((hx - Math.round(ux * s)) | 0, (hy - Math.round(uy * s)) | 0, size + rim, size + rim)
      }
    }
  }

  function solidAt(w: World, x: number, y: number): boolean {
    const gr = w.grid
    const tx = Math.floor(x / TILE)
    const ty = Math.floor(y / TILE)
    return tx >= 0 && ty >= 0 && tx < gr.w && ty < gr.h && (TILE_FLAGS[gr.t[ty * gr.w + tx]] & T_SOLID) !== 0
  }

  /** A droplet that is gone leaves a splash where it struck, or a wisp where it ran out. */
  function trackDroplets(w: World): void {
    const ds = w.droplets
    // When the level stops or he steps through a door the water is simply cleared away: no splashes for that.
    if (w.status !== 'play' || w.warp) seenN = 0
    for (let i = 0; i < seenN; i++) {
      const d = seen[i]
      let alive = false
      for (let j = 0; j < ds.length; j++) {
        if (ds[j] === d) {
          alive = true
          break
        }
      }
      if (alive) continue
      // Whole pixels: a fraction handed on to emit() would be boxed, an allocation.
      const x = seenX[i] | 0
      const y = seenY[i] | 0
      if (seenLife[i] <= 0) particles.emit('mist', x, y, 1)
      else if (!solidAt(w, x, y)) {
        // Water on a wall already has the simulation's own splash; this is water on a car, a critter
        // or a boss, right where its face is: small drops thrown back toward the shooter, off the face.
        const back = seenVx[i] > 0 ? -1 : 1
        particles.emit('spatter', x + back * 3, y, 2, back)
      }
    }
    seenN = Math.min(TRACKED, ds.length)
    for (let i = 0; i < seenN; i++) {
      const d = ds[i]
      seen[i] = d
      // Where it will be a tick on, which is where it will have hit something.
      seenX[i] = d.x + d.vx * DT
      seenY[i] = d.y + d.vy * DT
      seenVx[i] = d.vx
      seenLife[i] = d.life
    }
    for (let i = seenN; i < TRACKED && seen[i]; i++) seen[i] = null
  }

  function reset(w: World): void {
    world = w
    backdrop = resolveBackdrop(sprites, w.area.theme)
    tiles.reset(w)
    particles.reset()
    maxx.reset()
    lerpReset(lerp, w)
    shakeT = 0
    fxTick = -1
    seenN = 0
    for (let i = 0; i < TRACKED; i++) seen[i] = null
  }

  return {
    reset,
    update(w) {
      if (w !== world) reset(w)
      lerpTrack(lerp, w)
      tick++
      if (shakeT > 0) shakeT--
      trackDroplets(w)
      maxx.update(w, tick, emit)
      tickEntities(w)
      particles.update(w)
    },
    event(ev, w) {
      if (w !== world) reset(w)
      if (ev.type === 'fx') particles.emit(ev.fx, ev.x, ev.y, ev.n ?? 1, ev.dir ?? 0)
      else if (ev.type === 'popup') particles.popup(ev.text, ev.x, ev.y)
      else if (ev.type === 'shake') {
        if (opts.shake !== false && ev.ticks > 0 && (shakeT <= 0 || ev.mag >= shakeMag)) {
          shakeT = shakeFor = Math.round(ev.ticks)
          shakeMag = ev.mag
        }
      } else if (ev.type === 'area') reset(w)
    },
    draw(g, w) {
      // A world or an area nobody announced: start clean rather than draw the old one's leftovers.
      if (w !== world || !backdrop || backdrop.theme !== w.area.theme) reset(w)
      const bd = backdrop as Backdrop
      g0 = g
      fxOpen = !pinned && fxTick !== tick
      fxTick = tick
      const areaW = w.grid.w * TILE
      const areaH = w.grid.h * TILE
      lerpFrame(lerp, w)
      camX = Math.round(lerp[CAM_X])
      camY = Math.round(lerp[CAM_Y])
      // A deterministic rattle that dies away, so a screenshot taken twice matches.
      const r = shakeT > 0 ? Math.round((shakeMag * shakeT) / shakeFor) : 0
      if (r) {
        // It never shows past an edge of the area the camera itself keeps off (a narrow area shakes whole, wings and all).
        camX = shaken(camX, ((tick * 7) % (2 * r + 1)) - r, areaW - VIEW_W)
        camY = shaken(camY, ((tick * 13) % (2 * r + 1)) - r, areaH - VIEW_H)
      }

      drawBackdrop(g, bd, camX, camY, areaH, tick, pinned)
      if (weatherOn) drawWeather(g, bd.weather, false, camX, camY, tick)

      // Maxx between ticks: drawn by a camera moved by what is left of his step, as entities are.
      const p = w.player
      const back = lerp[BACK]
      maxxDx = maxxDy = 0
      if (back > 0) {
        const dx = p.x - p.px
        const dy = p.y - p.py
        if (dx <= LERP_MAX && dx >= -LERP_MAX && dy <= LERP_MAX && dy >= -LERP_MAX) {
          maxxDx = Math.round(p.x) - Math.round(p.x - dx * back)
          maxxDy = Math.round(p.y) - Math.round(p.y - dy * back)
        }
      }

      const behind = !opts.hideMaxx && (w.warp?.mode === 'pipe' || (w.player.state === 'grimed' && maxxInSludge(w)))
      drawEntities(g, w, -1)
      if (behind) maxx.draw(g, w, camX + maxxDx, camY + maxxDy, tick, debug)
      tiles.draw(g, w, camX, camY, tick)
      if (marks) tiles.drawHidden(g, w, camX, camY)
      drawEntities(g, w, 0)
      if (!behind && !opts.hideMaxx) maxx.draw(g, w, camX + maxxDx, camY + maxxDy, tick, debug)
      drawEntities(g, w, 1)
      drawDroplets(g, w)
      particles.draw(g, camX, camY, lerp)
      if (weatherOn) drawWeather(g, bd.weather, true, camX, camY, tick)

      // An area narrower than the screen sits between two dark wings.
      if (areaW < VIEW_W) {
        g.fillStyle = BAR
        const right = Math.max(0, areaW - camX)
        if (camX < 0) g.fillRect(0, 0, Math.min(VIEW_W, -camX), VIEW_H)
        if (right < VIEW_W) g.fillRect(right, 0, VIEW_W - right, VIEW_H)
      }
      particles.drawPopups(g, camX, camY, lerp)
      g0 = null
      fxOpen = false
    },
    stats() {
      stats.tick = tick
      stats.particles = particles.count
      stats.popups = particles.popups
      stats.chunkBuilds = tiles.builds
      stats.chunks = tiles.chunks
      stats.tileArt = tiles.found
      stats.backdropArt = !!backdrop && backdrop.art
      stats.maxxFrame = maxx.frame
      stats.camX = camX
      stats.camY = camY
      return stats
    },
    fx: emit,
    popup: (text, x, y) => particles.popup(text, x, y),
  }
}
