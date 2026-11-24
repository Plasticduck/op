// Dev scene: any level, played with the real world renderer and nothing else on top.
//   dev/maxx.html?scene=viewer&level=dev-render&params={"area":"tunnel","col":20}
// params (all optional):
//   level      a level id (default the sandbox)
//   area       start in this area (default the first)
//   col, row   put Maxx's feet in this tile column (and row). Without col: the area's '@', else
//              column 2. Without row: on the first floor found below the top of that column
//   free       true: a free camera. The world stands still (its animations play on); the stick,
//              the D-pad or the arrows move the camera, hold {jump} to go fast
//   cam        [x, y]: where the camera starts, in world pixels (left and top of the screen)
//   slow       n: slow motion, one simulation tick every n (2 = half speed, 8 to study a frame)
//   hideMaxx   true: leave Maxx out of the picture
//   boxes      true: collision boxes, a label on kinds with no renderer, hidden blocks
//   marks      true: only the labels and the hidden blocks (what scripts/maxx/overview.mjs shows)
//   grid       true: the tile grid over the picture, column numbers every 5 tiles along the top,
//              row numbers down the left, and Maxx's tile in the corner
//   weather    false: no rain or snow
//   shake      false: no screen shake (default: the save's setting)
//   seed       the world's random seed (default 1)
// View (Tab) starts over, and so does a grime or the clock running out. A level id the game does
// not know says so on screen. window.__maxx.world() is the World. The scene object also offers
// `renderer` (stats(), fx(), popup()) and `tools`, which scripts/maxx/overview.mjs and
// scripts/maxx/checks/render.mjs use to make pictures in the page.
import { TILE, VIEW_H, VIEW_W } from '../contract'
import type { AreaDef, GameCtx, LevelDef, Scene, SceneParams } from '../contract'
import { drawText } from '../engine/text'
import type { TextStyle } from '../engine/text'
import { levelById, sandboxLevel } from '../levels'
import { createWorldRenderer } from '../render/world'
import type { WorldRendererDev, WorldRendererOpts } from '../render/world'
import { TILE_FLAGS, T_ONEWAY, T_SOLID, createWorld, stepWorld } from '../sim'
import type { World } from '../sim'

/** Pixels a tick the free camera moves, and with jump held. */
const PAN = 6
const PAN_FAST = 24
const GRID_LINE = '#16161d'
const GRID_TEN = '#f7f4f8'
const GRID_TEXT: TextStyle = { color: '#ffe866', outline: '#1e0d06' }
const GRID_HERE: TextStyle = { color: '#f7f4f8', outline: '#1e0d06', align: 'right' }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Number labels for the grid, made once each: no string is built while drawing.
const LABELS: string[] = []
const label = (n: number): string => (LABELS[n] ??= String(n))
const HERE: string[] = []
const here = (col: number, row: number): string => (HERE[col * 1000 + row] ??= `COL ${col} ROW ${row}`)

/** The tile grid of `w` over the picture, for finding your way in a level. */
function drawGrid(g: CanvasRenderingContext2D, w: World): void {
  const camX = Math.round(w.camera.x)
  const camY = Math.round(w.camera.y)
  const tx0 = Math.max(0, Math.floor(camX / TILE))
  const tx1 = Math.min(w.grid.w, Math.ceil((camX + VIEW_W) / TILE))
  const ty0 = Math.max(0, Math.floor(camY / TILE))
  const ty1 = Math.min(w.grid.h, Math.ceil((camY + VIEW_H) / TILE))
  for (let tx = tx0; tx <= tx1; tx++) {
    g.fillStyle = tx % 10 === 0 ? GRID_TEN : GRID_LINE
    g.fillRect(tx * TILE - camX, 0, 1, VIEW_H)
  }
  for (let ty = ty0; ty <= ty1; ty++) {
    g.fillStyle = ty % 10 === 0 ? GRID_TEN : GRID_LINE
    g.fillRect(0, ty * TILE - camY, VIEW_W, 1)
  }
  for (let tx = tx0; tx < tx1; tx++) if (tx % 5 === 0) drawText(g, label(tx), tx * TILE - camX + 3, 3, GRID_TEXT)
  for (let ty = ty0; ty < ty1; ty++) drawText(g, label(ty), 3, ty * TILE - camY + 12, GRID_TEXT)
  const p = w.player
  const col = Math.floor((p.x + p.w / 2) / TILE)
  const row = Math.floor((p.y + p.h - 1) / TILE)
  if (col >= 0 && row >= 0 && col < 1000) drawText(g, here(col, row), VIEW_W - 4, VIEW_H - 12, GRID_HERE)
}

/** Where Maxx's feet go in an area: the '@', else column `col` on the first floor from the top (or the given row). */
function startIn(def: AreaDef, col: number | null, row: number | null): { x: number; y: number } {
  let tx = col
  let ty = row
  if (tx === null) {
    for (let y = 0; y < def.rows.length && tx === null; y++) {
      const at = def.rows[y].indexOf('@')
      if (at >= 0) {
        tx = at
        ty ??= y
      }
    }
  }
  tx ??= 2
  if (ty === null) {
    // The first cell from the top whose floor holds him: air (or anything not solid) over a solid tile or a catwalk.
    ty = def.rows.length - 2
    for (let y = 1; y < def.rows.length; y++) {
      const below = TILE_FLAGS[def.rows[y].charCodeAt(tx)] ?? 0
      const here = TILE_FLAGS[def.rows[y - 1].charCodeAt(tx)] ?? 0
      if (below & (T_SOLID | T_ONEWAY) && !(here & T_SOLID)) {
        ty = y - 1
        break
      }
    }
  }
  return { x: tx * TILE + TILE / 2, y: (ty + 1) * TILE }
}

export interface ViewerTools {
  /** Another renderer for the same sprites, e.g. pinned for stitched pictures of a whole area. */
  createRenderer(opts?: WorldRendererOpts): WorldRendererDev
  drawText: typeof drawText
}

export function createViewerScene(): Scene & { readonly world: World | null; readonly renderer: WorldRendererDev | null; readonly tools: ViewerTools | null } {
  let level: LevelDef = sandboxLevel
  let params: SceneParams = {}
  let world: World | null = null
  let renderer: WorldRendererDev | null = null
  let tools: ViewerTools | null = null
  let problem = ''
  let hiss = false
  let free = false
  let grid = false
  let slow = 1
  let beat = 0

  function start(game: GameCtx) {
    try {
      game.resetSession()
      const want = typeof params.area === 'string' ? params.area : level.areas[0].id
      const def = level.areas.find((a) => a.id === want) ?? level.areas[0]
      const col = num(params.col)
      const row = num(params.row)
      // Anywhere but the '@' of the first area is a checkpoint: the middle of his feet.
      const at = col === null && row === null && def === level.areas[0] ? null : { areaId: def.id, ...startIn(def, col, row) }
      world = createWorld(level, { session: game.session, checkpoint: at, seed: num(params.seed) ?? 1 })
      if (!renderer) {
        const opts: WorldRendererOpts = {
          shake: params.shake === false ? false : game.save.data.settings.shake,
          debug: params.boxes === true,
          marks: params.marks === true,
          hideMaxx: params.hideMaxx === true,
          weather: params.weather !== false,
        }
        renderer = createWorldRenderer(game.sprites, opts)
        tools = { createRenderer: (o) => createWorldRenderer(game.sprites, o), drawText }
      }
      renderer.reset(world)
      free = params.free === true
      grid = params.grid === true
      slow = Math.max(1, Math.round(num(params.slow) ?? 1))
      beat = 0
      const cam = params.cam
      if (Array.isArray(cam) && typeof cam[0] === 'number' && typeof cam[1] === 'number') {
        world.camera.x = cam[0]
        world.camera.y = cam[1]
      }
      game.audio.music(world.area.music ?? level.music)
      problem = ''
    } catch (err) {
      world = null
      problem = err instanceof Error ? err.message : String(err)
    }
  }

  function pan(w: World, dx: number, dy: number) {
    const c = w.camera
    const maxX = w.grid.w * TILE - VIEW_W
    const maxY = w.grid.h * TILE - VIEW_H
    c.x = maxX <= 0 ? maxX / 2 : Math.max(0, Math.min(maxX, c.x + dx))
    c.y = maxY <= 0 ? maxY : Math.max(0, Math.min(maxY, c.y + dy))
  }

  return {
    get world() {
      return world
    },
    get renderer() {
      return renderer
    },
    get tools() {
      return tools
    },
    enter(game, p) {
      params = p
      renderer = null
      const found = typeof p.level === 'string' ? levelById(p.level) : sandboxLevel
      if (!found) {
        // Better to say so than to show the sandbox under someone's level id.
        world = null
        problem = `no level '${String(p.level)}'`
        return
      }
      level = found
      start(game)
    },
    update(game, input) {
      if (!world && !renderer) return
      if (input.pressed.select) return start(game)
      if (!world || !renderer) return
      if (free) {
        const speed = input.held.jump ? PAN_FAST : PAN
        pan(world, input.axisX * speed, ((input.held.down ? 1 : 0) - (input.held.up ? 1 : 0)) * speed)
        renderer.update(world)
        return
      }
      if (++beat < slow) return
      beat = 0
      stepWorld(world, input)
      for (const ev of world.events) {
        if (ev.type === 'sfx') game.audio.sfx(ev.id)
        else if (ev.type === 'music') game.audio.music(ev.id)
        else if (ev.type === 'jingle') game.audio.jingle(ev.id)
        else if (ev.type === 'rumble') game.input.rumble(ev.strong, ev.weak, ev.ms)
        renderer.event(ev, world)
      }
      world.events.length = 0
      renderer.update(world)
      const spraying = world.player.spraying && world.status === 'play'
      if (spraying !== hiss) game.audio.spray((hiss = spraying))
      if (world.status !== 'play' && world.status !== 'clear' && world.statusT > 90) start(game)
    },
    render(_game, g) {
      if (world && renderer) {
        renderer.draw(g, world)
        if (grid) drawGrid(g, world)
        return
      }
      g.fillStyle = '#16161d'
      g.fillRect(0, 0, VIEW_W, VIEW_H)
      drawText(g, 'VIEWER: ' + (problem || 'NO WORLD').toUpperCase().slice(0, 70), 8, 8, { color: '#ff6b6b' })
    },
    exit(game) {
      if (hiss) game.audio.spray((hiss = false))
    },
  }
}
