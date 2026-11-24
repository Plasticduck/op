// The tile layer: which frame each tile wears (the neighbour rules), drawn into cached
// chunks so a screen is a few blits, with the tiles that move (prize blocks, conveyors,
// the sludge surface, a block hopping after a bump) drawn live on top.
//
// A frame is looked up as 'tiles/<theme>_<key>', then 'tiles/any_<key>', then a flat colour.
// The rules, where `ground` means '#' or '%' and the outside of the area counts as ground:
//   '#'  here `ground` also takes in every solid tile that sits in a floor: the floors I O M,
//        the belts < >, steel X, grime g, used U, bricks B C, pipes P and the crates ? ! W L
//        (never the hidden H h, which would give themselves away). So a floor under a belt or a
//        special floor wears no cap, and nothing beside them gets an edge.
//        open above: ground_tl (nothing left), ground_tr (nothing right), else ground_t.
//        ground above: ground_l (nothing left), ground_r (nothing right), else ground_m,
//        or ground_m2 where (tx * 7 + ty * 13) % 5 === 0.
//        Nothing on either side: both edges, ground_tl (or ground_l) with the right half of
//        ground_tr (or ground_r) over it; the edge variants differ only in their outer columns.
//   '%'  wall_t unless ground is above, then wall.
//   'B' 'C' brick   '?' prize0..3   '!' power0..3   'W' waxblock0..3   'L' lifeblock0..3
//        (8 ticks a frame)   'U' used   'X' steel   'H' 'h' never drawn.
//   '='  catwalk_l (no catwalk left), catwalk_r (none right), else catwalk; alone: catwalk.
//   '<' '>'  conv0..3 ('>' backwards), with conv_l / conv_r over the ends of each run.
//   'I'  slick_t, or slick_m under anything solid.
//   'O' 'M'  oily_t / mud_t, or the theme's ground_m under ground or under more of itself.
//   'g'  grime0..2 by the hits taken (two hits a stage).
//   '~'  sludge_t0..3 (10 ticks a frame), or sludge_m under more sludge.
//   '^'  spikes.
//   'P'  columns counted from the left end of the run: even = pipe_tl / pipe_l, odd =
//        pipe_tr / pipe_r; the _t pair where there is no pipe above.
//   '|'  pillar_t where there is no pillar above, else pillar.
import { TILE, VIEW_H, VIEW_W } from '../contract'
import type { Sprites } from '../contract'
import { TILE_FLAGS, TUNING, T_SOLID } from '../sim'
import type { TileBump, TileGrid, World } from '../sim/types'
import { themeLook } from './themes'
import type { ThemeLook } from './themes'

/** Tiles in a chunk. One chunk is as wide as the screen, so a view never touches more than four. */
const CHUNK_W = 20
const CHUNK_H = 12
const CHUNK_PX_W = CHUNK_W * TILE
const CHUNK_PX_H = CHUNK_H * TILE
const POOL_MAX = 8
/** Cells a chunk remembers: itself and a one-tile rim. */
const SNAP = (CHUNK_W + 2) * (CHUNK_H + 2)
/** How high a bumped block hops, in pixels. */
const BUMP_HOP = 7
const BLOCK_TICKS = 8
const SLUDGE_TICKS = 10
/** Ticks a conveyor frame shows, unless the tiles atlas says otherwise in meta.ticks.conv: 4 px of belt a frame is 60 px a second. */
const CONV_TICKS = 4

const NAMES: string[] = []
const key = (name: string): number => NAMES.push(name) - 1
const four = (name: string): number => {
  const first = key(name + '0')
  for (let i = 1; i < 4; i++) key(name + i)
  return first
}
const K_GROUND_T = key('ground_t')
const K_GROUND_TL = key('ground_tl')
const K_GROUND_TR = key('ground_tr')
const K_GROUND_M = key('ground_m')
const K_GROUND_M2 = key('ground_m2')
const K_GROUND_L = key('ground_l')
const K_GROUND_R = key('ground_r')
const K_WALL = key('wall')
const K_WALL_T = key('wall_t')
const K_BRICK = key('brick')
const K_PRIZE = four('prize')
const K_POWER = four('power')
const K_WAX = four('waxblock')
const K_LIFE = four('lifeblock')
const K_USED = key('used')
const K_STEEL = key('steel')
const K_CATWALK = key('catwalk')
const K_CATWALK_L = key('catwalk_l')
const K_CATWALK_R = key('catwalk_r')
const K_CONV = four('conv')
const K_CONV_L = key('conv_l')
const K_CONV_R = key('conv_r')
const K_SLICK_T = key('slick_t')
const K_SLICK_M = key('slick_m')
const K_OILY_T = key('oily_t')
const K_MUD_T = key('mud_t')
const K_GRIME = key('grime0')
key('grime1')
key('grime2')
const K_SLUDGE_T = four('sludge_t')
const K_SLUDGE_M = key('sludge_m')
const K_SPIKES = key('spikes')
const K_PIPE_TL = key('pipe_tl')
const K_PIPE_TR = key('pipe_tr')
const K_PIPE_L = key('pipe_l')
const K_PIPE_R = key('pipe_r')
const K_PILLAR = key('pillar')
const K_PILLAR_T = key('pillar_t')
const KEY_COUNT = NAMES.length
/** A one-wide column of '#', open above or not: drawn from two frames each (see put()). */
const K_LONE_T = KEY_COUNT
const K_LONE_M = KEY_COUNT + 1
const LONE_NAMES = ['ground_tl+tr', 'ground_l+r']

/** Every frame key the tile layer asks the 'tiles' atlas for (without the theme prefix). */
export const TILE_KEYS: readonly string[] = NAMES

const code = (ch: string): number => ch.charCodeAt(0)
const AIR = 32
/** What a look outside the area gives: not a tile, and never equal to one. */
const OUT = 0
const C_GROUND = code('#')
const C_WALL = code('%')
const C_BRICK = code('B')
const C_COINS = code('C')
const C_PRIZE = code('?')
const C_POWER = code('!')
const C_WAX = code('W')
const C_LIFE = code('L')
const C_HIDDEN = code('H')
const C_HIDDEN_LIFE = code('h')
const C_USED = code('U')
const C_STEEL = code('X')
const C_CATWALK = code('=')
const C_CONV_L = code('<')
const C_CONV_R = code('>')
const C_SLICK = code('I')
const C_OILY = code('O')
const C_MUD = code('M')
const C_GRIME = code('g')
const C_SLUDGE = code('~')
const C_SPIKES = code('^')
const C_PIPE = code('P')
const C_PILLAR = code('|')

function at(grid: TileGrid, tx: number, ty: number): number {
  return tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h ? OUT : grid.t[ty * grid.w + tx]
}

const isGround = (c: number): boolean => c === C_GROUND || c === C_WALL || c === OUT

/** What counts as ground beside and above a '#' (see the header): a table by tile character. */
const FLOOR_LIKE = new Uint8Array(256)
for (const ch of '#%IOM<>XgUBCP?!WL') FLOOR_LIKE[code(ch)] = 1
FLOOR_LIKE[OUT] = 1

/** The frame key for the tile at (tx, ty), or -1 for nothing. Animated tiles answer with their first frame. */
function keyFor(grid: TileGrid, tx: number, ty: number, c: number): number {
  switch (c) {
    case C_GROUND: {
      const left = FLOOR_LIKE[at(grid, tx - 1, ty)] === 1
      const right = FLOOR_LIKE[at(grid, tx + 1, ty)] === 1
      if (FLOOR_LIKE[at(grid, tx, ty - 1)] !== 1) return left ? (right ? K_GROUND_T : K_GROUND_TR) : right ? K_GROUND_TL : K_LONE_T
      if (!left) return right ? K_GROUND_L : K_LONE_M
      if (!right) return K_GROUND_R
      return (tx * 7 + ty * 13) % 5 === 0 ? K_GROUND_M2 : K_GROUND_M
    }
    case C_WALL:
      return isGround(at(grid, tx, ty - 1)) ? K_WALL : K_WALL_T
    case C_BRICK:
    case C_COINS:
      return K_BRICK
    case C_PRIZE:
      return K_PRIZE
    case C_POWER:
      return K_POWER
    case C_WAX:
      return K_WAX
    case C_LIFE:
      return K_LIFE
    case C_USED:
      return K_USED
    case C_STEEL:
      return K_STEEL
    case C_CATWALK: {
      const l = at(grid, tx - 1, ty)
      const r = at(grid, tx + 1, ty)
      const left = l === C_CATWALK || l === OUT
      const right = r === C_CATWALK || r === OUT
      return !left && right ? K_CATWALK_L : left && !right ? K_CATWALK_R : K_CATWALK
    }
    case C_CONV_L:
    case C_CONV_R:
      return K_CONV
    case C_SLICK: {
      const up = at(grid, tx, ty - 1)
      return up === OUT || (TILE_FLAGS[up] & T_SOLID) !== 0 ? K_SLICK_M : K_SLICK_T
    }
    case C_OILY:
    case C_MUD: {
      const up = at(grid, tx, ty - 1)
      if (isGround(up) || up === c) return K_GROUND_M
      return c === C_OILY ? K_OILY_T : K_MUD_T
    }
    case C_GRIME:
      return K_GRIME + Math.min(2, grid.d[ty * grid.w + tx] >> 1)
    case C_SLUDGE: {
      const up = at(grid, tx, ty - 1)
      return up === C_SLUDGE || up === OUT ? K_SLUDGE_M : K_SLUDGE_T
    }
    case C_SPIKES:
      return K_SPIKES
    case C_PIPE: {
      let left = tx
      while (at(grid, left - 1, ty) === C_PIPE) left--
      const up = at(grid, tx, ty - 1)
      const rim = up !== C_PIPE && up !== OUT
      if (((tx - left) & 1) === 0) return rim ? K_PIPE_TL : K_PIPE_L
      return rim ? K_PIPE_TR : K_PIPE_R
    }
    case C_PILLAR: {
      const up = at(grid, tx, ty - 1)
      return up === C_PILLAR || up === OUT ? K_PILLAR : K_PILLAR_T
    }
    default:
      return -1
  }
}

/** The key's name for a tile, for tools and tests ('' for a tile that is not drawn). */
export function tileKeyName(grid: TileGrid, tx: number, ty: number): string {
  const k = keyFor(grid, tx, ty, at(grid, tx, ty))
  return k < 0 ? '' : k >= KEY_COUNT ? LONE_NAMES[k - KEY_COUNT] : NAMES[k]
}

/** Drawn every frame instead of once into its chunk. */
function moves(c: number, k: number): boolean {
  return c === C_PRIZE || c === C_POWER || c === C_WAX || c === C_LIFE || c === C_CONV_L || c === C_CONV_R || k === K_SLUDGE_T
}

function bumpAt(bumps: TileBump[], tx: number, ty: number): TileBump | null {
  for (let i = 0; i < bumps.length; i++) if (bumps[i].tx === tx && bumps[i].ty === ty) return bumps[i]
  return null
}

/* ------------------------------------------------------------------ */
/* The frames of one theme                                             */
/* ------------------------------------------------------------------ */

interface TileSet {
  theme: string
  look: ThemeLook
  /** Per key: the sheet it is on (null = no art, a flat stand-in is drawn), its rectangle and its anchor. */
  img: (CanvasImageSource | null)[]
  sx: Int16Array
  sy: Int16Array
  sw: Int16Array
  sh: Int16Array
  ax: Int16Array
  ay: Int16Array
  convTicks: number
  /** How many keys found art. */
  found: number
}

function resolveTiles(sprites: Sprites, theme: string): TileSet {
  const set: TileSet = {
    theme,
    look: themeLook(theme),
    img: [],
    sx: new Int16Array(KEY_COUNT),
    sy: new Int16Array(KEY_COUNT),
    sw: new Int16Array(KEY_COUNT),
    sh: new Int16Array(KEY_COUNT),
    ax: new Int16Array(KEY_COUNT),
    ay: new Int16Array(KEY_COUNT),
    convTicks: CONV_TICKS,
    found: 0,
  }
  for (let k = 0; k < KEY_COUNT; k++) {
    const src = sprites.source(`tiles/${theme}_${NAMES[k]}`) ?? sprites.source(`tiles/any_${NAMES[k]}`)
    set.img.push(src ? src.image : null)
    if (!src) continue
    set.found++
    set.sx[k] = src.frame.x
    set.sy[k] = src.frame.y
    set.sw[k] = src.frame.w
    set.sh[k] = src.frame.h
    set.ax[k] = src.frame.ax ?? 0
    set.ay[k] = src.frame.ay ?? 0
  }
  // The belt's speed on screen depends on how far the art moves it a frame, so the artist says.
  const meta = sprites.atlas('tiles')?.meta
  const ticks = (meta?.ticks ?? {}) as Record<string, unknown>
  const conv = typeof ticks.conv === 'number' ? ticks.conv : meta?.convTicks
  if (typeof conv === 'number' && conv >= 1) set.convTicks = Math.round(conv)
  return set
}

const FLAT: Record<number, string> = {
  [K_BRICK]: '#a9afbd',
  [K_PRIZE]: '#1456b8',
  [K_POWER]: '#d10713',
  [K_WAX]: '#f5c518',
  [K_LIFE]: '#49b23c',
  [K_USED]: '#767b8a',
  [K_STEEL]: '#4b4f5c',
  [K_SLICK_T]: '#b9ecff',
  [K_SLICK_M]: '#5cc8ff',
  [K_GRIME]: '#6b4522',
  [K_SLUDGE_M]: '#2b1a0e',
}
const LINE = '#1e0d06'

/** A tile with no art yet: flat colours, shaped enough to tell what it is. */
function standIn(g: CanvasRenderingContext2D, look: ThemeLook, k: number, x: number, y: number): void {
  const T = TILE
  if (k >= K_GROUND_T && k <= K_GROUND_R) {
    g.fillStyle = look.ground
    g.fillRect(x, y, T, T)
    if (k <= K_GROUND_TR) {
      g.fillStyle = look.groundTop
      g.fillRect(x, y, T, 5)
    }
    g.fillStyle = LINE
    if (k === K_GROUND_TL || k === K_GROUND_L) g.fillRect(x, y, 1, T)
    if (k === K_GROUND_TR || k === K_GROUND_R) g.fillRect(x + T - 1, y, 1, T)
    if (k === K_GROUND_M2) g.fillRect(x + 12, y + 14, 6, 2)
    return
  }
  if (k === K_WALL || k === K_WALL_T) {
    g.fillStyle = look.wall
    g.fillRect(x, y, T, T)
    g.fillStyle = k === K_WALL_T ? look.wallTop : LINE
    g.fillRect(x, y, T, k === K_WALL_T ? 4 : 1)
    return
  }
  if (k >= K_CATWALK && k <= K_CATWALK_R) {
    g.fillStyle = '#767b8a'
    g.fillRect(x, y, T, 8)
    g.fillStyle = LINE
    g.fillRect(x, y + 7, T, 1)
    if (k === K_CATWALK_L) g.fillRect(x, y, 1, 8)
    if (k === K_CATWALK_R) g.fillRect(x + T - 1, y, 1, 8)
    return
  }
  if (k >= K_CONV && k < K_CONV + 4) {
    g.fillStyle = '#2e3038'
    g.fillRect(x, y, T, T)
    g.fillStyle = '#f5c518'
    const shift = (k - K_CONV) * 2
    for (let i = 0; i < 4; i++) g.fillRect(x + ((i * 8 + 8 - shift) % T), y, 3, 4)
    return
  }
  if (k === K_CONV_L || k === K_CONV_R) {
    g.fillStyle = '#a9afbd'
    g.fillRect(k === K_CONV_L ? x : x + T - 6, y, 6, 10)
    return
  }
  if (k === K_OILY_T || k === K_MUD_T) {
    g.fillStyle = look.ground
    g.fillRect(x, y, T, T)
    g.fillStyle = k === K_OILY_T ? '#16161d' : '#4a2f17'
    g.fillRect(x, y, T, 8)
    return
  }
  if (k >= K_SLUDGE_T && k < K_SLUDGE_T + 4) {
    g.fillStyle = '#2b1a0e'
    g.fillRect(x, y + 6, T, T - 6)
    g.fillStyle = '#6b4522'
    g.fillRect(x + (k - K_SLUDGE_T) * 8, y + 6, 8, 2)
    return
  }
  if (k === K_SPIKES) {
    g.fillStyle = '#d6dae3'
    for (let i = 0; i < 4; i++) {
      g.fillRect(x + i * 8 + 3, y + T - 12, 2, 4)
      g.fillRect(x + i * 8 + 2, y + T - 8, 4, 4)
      g.fillRect(x + i * 8 + 1, y + T - 4, 6, 4)
    }
    return
  }
  if (k >= K_PIPE_TL && k <= K_PIPE_R) {
    const rim = k === K_PIPE_TL || k === K_PIPE_TR
    const left = k === K_PIPE_TL || k === K_PIPE_L
    g.fillStyle = '#6fb3dd'
    g.fillRect(rim ? x : left ? x + 3 : x, y, rim ? T : T - 3, T)
    g.fillStyle = '#a8d8f0'
    if (left) g.fillRect(x + (rim ? 4 : 7), y, 5, T)
    g.fillStyle = LINE
    if (rim) g.fillRect(x, y + 13, T, 1)
    g.fillRect(left ? (rim ? x : x + 3) : x + T - 1, y, 1, T)
    return
  }
  if (k === K_PILLAR || k === K_PILLAR_T) {
    g.fillStyle = look.pillar
    g.fillRect(x + 10, y, 12, T)
    if (k === K_PILLAR_T) g.fillRect(x + 6, y, 20, 5)
    return
  }
  const base = k >= K_GRIME && k < K_GRIME + 3 ? K_GRIME : k >= K_PRIZE && k < K_USED ? K_PRIZE + (((k - K_PRIZE) >> 2) << 2) : k
  const stage = k - base
  g.fillStyle = FLAT[base] ?? '#e85aa0'
  if (base === K_GRIME) g.fillRect(x + stage * 3, y + stage * 3, T - stage * 6, T - stage * 6)
  else g.fillRect(x, y, T, T)
  g.fillStyle = LINE
  g.fillRect(x, y + T - 1, T, 1)
  g.fillRect(x + T - 1, y, 1, T)
  if (base >= K_PRIZE && base < K_USED) {
    // The shimmer of a crate, as a mark that walks.
    g.fillStyle = '#f7f4f8'
    g.fillRect(x + 8 + stage * 4, y + 12, 4, 8)
  }
}

const HALF = TILE >> 1

function put(g: CanvasRenderingContext2D, set: TileSet, k: number, x: number, y: number): void {
  if (k >= KEY_COUNT) {
    // A one-wide column: the left edge piece, then the right half of the right edge piece over it.
    const r = k === K_LONE_T ? K_GROUND_TR : K_GROUND_R
    put(g, set, k === K_LONE_T ? K_GROUND_TL : K_GROUND_L, x, y)
    const src = set.img[r]
    if (src) g.drawImage(src, set.sx[r] + HALF, set.sy[r], set.sw[r] - HALF, set.sh[r], x + HALF - set.ax[r], y - set.ay[r], set.sw[r] - HALF, set.sh[r])
    else {
      g.fillStyle = LINE
      g.fillRect(x + TILE - 1, y, 1, TILE)
    }
    return
  }
  const img = set.img[k]
  if (img) g.drawImage(img, set.sx[k], set.sy[k], set.sw[k], set.sh[k], x - set.ax[k], y - set.ay[k], set.sw[k], set.sh[k])
  else standIn(g, set.look, k, x, y)
}

// The frames of the themes drawTileAs() has been asked for, kept per sprite set.
let asFor: Sprites | null = null
const asSets = new Map<string, TileSet>()

/**
 * Draw the tile at (tx, ty) as if it held `ch`, by the neighbour rules and with the frames of
 * the world's theme, at screen position (tx * 32 - camX, ty * 32 - camY). For a renderer that
 * shows tiles the simulation has changed as what they were: a floor a rival has made slick or
 * oily is drawn as the floor ('#') under its film. Animated tiles show their first frame.
 */
export function drawTileAs(g: CanvasRenderingContext2D, sprites: Sprites, world: World, tx: number, ty: number, ch: string, camX: number, camY: number): void {
  const theme = world.area.theme
  if (asFor !== sprites) {
    asSets.clear()
    asFor = sprites
  }
  let set = asSets.get(theme)
  if (!set) {
    set = resolveTiles(sprites, theme)
    // Not loaded yet: ask again next time rather than remember the stand-ins.
    if (set.found) asSets.set(theme, set)
  }
  const k = keyFor(world.grid, tx, ty, ch.charCodeAt(0))
  if (k >= 0) put(g, set, k, (tx * TILE - camX) | 0, (ty * TILE - camY) | 0)
}

/* ------------------------------------------------------------------ */
/* Chunks                                                              */
/* ------------------------------------------------------------------ */

interface Chunk {
  canvas: HTMLCanvasElement
  g: CanvasRenderingContext2D
  cx: number
  cy: number
  /** False until built for (cx, cy) of the current area. */
  valid: boolean
  /** Its tiles and a one-tile rim as they were when it was built (grime as its stage), and the blocks hopping in it: a change means a rebuild. */
  snap: Uint8Array
  hops: number
  /** The frame it was last shown on, for picking the one to recycle. */
  stamp: number
  /** Tiles left out of the picture because they move, as index ly * CHUNK_W + lx. */
  live: Int16Array
  n: number
}

export interface TileLayer {
  /** A new area: forget every chunk and look the theme's frames up again. */
  reset(world: World): void
  /** Chunks, then the moving tiles. `tick` is the renderer's cosmetic clock. */
  draw(g: CanvasRenderingContext2D, world: World, camX: number, camY: number, tick: number): void
  /** Outlines where the hidden blocks are (debug and the overview tool). */
  drawHidden(g: CanvasRenderingContext2D, world: World, camX: number, camY: number): void
  /** Chunks built since the layer was made, chunks held, and how many frame keys of this theme have art. */
  readonly builds: number
  readonly chunks: number
  readonly found: number
}

export function createTileLayer(sprites: Sprites): TileLayer {
  const pool: Chunk[] = []
  // The chunks on screen this frame. A count over a fixed array: emptying an array with length = 0 lets go of its storage, so the next push would allocate.
  const shown: (Chunk | null)[] = [null, null, null, null, null, null, null, null, null]
  let shownN = 0
  let set: TileSet | null = null
  let grid: TileGrid | null = null
  let frameNo = 0
  let builds = 0

  function reset(world: World): void {
    grid = world.grid
    set = resolveTiles(sprites, world.area.theme)
    for (let i = 0; i < pool.length; i++) pool[i].valid = false
  }

  function chunkFor(cx: number, cy: number): Chunk {
    let oldest: Chunk | null = null
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]
      if (c.valid && c.cx === cx && c.cy === cy) return c
      if (!oldest || (!c.valid && oldest.valid) || (c.valid === oldest.valid && c.stamp < oldest.stamp)) oldest = c
    }
    let c = oldest
    if (!c || (c.valid && pool.length < POOL_MAX)) {
      const canvas = document.createElement('canvas')
      canvas.width = CHUNK_PX_W
      canvas.height = CHUNK_PX_H
      const cg = canvas.getContext('2d')
      if (!cg) throw new Error('tile layer: no 2D canvas')
      cg.imageSmoothingEnabled = false
      c = { canvas, g: cg, cx, cy, valid: false, snap: new Uint8Array(SNAP), hops: 0, stamp: 0, live: new Int16Array(CHUNK_W * CHUNK_H), n: 0 }
      pool.push(c)
    }
    c.cx = cx
    c.cy = cy
    c.valid = false
    return c
  }

  /**
   * Whether anything the chunk's picture depends on changed since it was built: its tiles and a
   * one-tile rim (a neighbour changes a tile's frame), grime stages, and which of its blocks are
   * hopping. Remembers what it saw. An exact byte compare, cheap enough for every chunk on screen
   * every frame, with nothing but small whole numbers in it.
   */
  function changed(c: Chunk, gr: TileGrid, bumps: TileBump[]): boolean {
    const x0 = Math.max(0, c.cx * CHUNK_W - 1)
    const x1 = Math.min(gr.w - 1, (c.cx + 1) * CHUNK_W)
    const y0 = Math.max(0, c.cy * CHUNK_H - 1)
    const y1 = Math.min(gr.h - 1, (c.cy + 1) * CHUNK_H)
    const t = gr.t
    const d = gr.d
    const snap = c.snap
    let diff = false
    let k = 0
    for (let ty = y0; ty <= y1; ty++) {
      const row = ty * gr.w
      for (let tx = x0; tx <= x1; tx++) {
        let v = t[row + tx]
        // Tile characters are below 128: a grime block is stored as 128 + its stage instead.
        if (v === C_GRIME) v = 128 + Math.min(2, d[row + tx] >> 1)
        if (snap[k] !== v) {
          snap[k] = v
          diff = true
        }
        k++
      }
    }
    let hops = 0
    for (let i = 0; i < bumps.length; i++) {
      const lx = bumps[i].tx - c.cx * CHUNK_W
      const ly = bumps[i].ty - c.cy * CHUNK_H
      if (lx >= 0 && ly >= 0 && lx < CHUNK_W && ly < CHUNK_H) hops = (hops * 241 + ly * CHUNK_W + lx + 1) & 0xfffff
    }
    if (hops !== c.hops) {
      c.hops = hops
      diff = true
    }
    return diff
  }

  function build(c: Chunk, gr: TileGrid, ts: TileSet, bumps: TileBump[]): void {
    const cg = c.g
    cg.clearRect(0, 0, CHUNK_PX_W, CHUNK_PX_H)
    c.n = 0
    const tx0 = c.cx * CHUNK_W
    const ty0 = c.cy * CHUNK_H
    for (let ly = 0; ly < CHUNK_H; ly++) {
      const ty = ty0 + ly
      if (ty >= gr.h) break
      for (let lx = 0; lx < CHUNK_W; lx++) {
        const tx = tx0 + lx
        if (tx >= gr.w) break
        const ch = gr.t[ty * gr.w + tx]
        if (ch === AIR) continue
        const k = keyFor(gr, tx, ty, ch)
        if (k < 0) continue
        if (moves(ch, k) || bumpAt(bumps, tx, ty)) c.live[c.n++] = ly * CHUNK_W + lx
        else put(cg, ts, k, lx * TILE, ly * TILE)
      }
    }
    c.valid = true
    builds++
  }

  function drawLive(g: CanvasRenderingContext2D, c: Chunk, gr: TileGrid, ts: TileSet, bumps: TileBump[], camX: number, camY: number, tick: number): void {
    const block = ((tick / BLOCK_TICKS) | 0) & 3
    const belt = ((tick / ts.convTicks) | 0) & 3
    const ooze = ((tick / SLUDGE_TICKS) | 0) & 3
    for (let i = 0; i < c.n; i++) {
      const li = c.live[i]
      const tx = c.cx * CHUNK_W + (li % CHUNK_W)
      const ty = c.cy * CHUNK_H + ((li / CHUNK_W) | 0)
      const x = tx * TILE - camX
      let y = ty * TILE - camY
      if (x <= -TILE || x >= VIEW_W || y <= -TILE || y >= VIEW_H + BUMP_HOP) continue
      const ch = gr.t[ty * gr.w + tx]
      const bump = bumps.length ? bumpAt(bumps, tx, ty) : null
      if (bump) y -= Math.round(Math.sin((bump.t / TUNING.bumpTicks) * Math.PI) * BUMP_HOP)
      switch (ch) {
        case C_PRIZE:
          put(g, ts, K_PRIZE + block, x, y)
          break
        case C_POWER:
          put(g, ts, K_POWER + block, x, y)
          break
        case C_WAX:
          put(g, ts, K_WAX + block, x, y)
          break
        case C_LIFE:
          put(g, ts, K_LIFE + block, x, y)
          break
        case C_CONV_L:
        case C_CONV_R:
          put(g, ts, K_CONV + (ch === C_CONV_L ? belt : 3 - belt), x, y)
          if (at(gr, tx - 1, ty) !== ch) put(g, ts, K_CONV_L, x, y)
          if (at(gr, tx + 1, ty) !== ch) put(g, ts, K_CONV_R, x, y)
          break
        default: {
          const k = keyFor(gr, tx, ty, ch)
          if (k >= 0) put(g, ts, k === K_SLUDGE_T ? K_SLUDGE_T + ooze : k, x, y)
        }
      }
    }
  }

  return {
    reset,
    draw(g, world, camX, camY, tick) {
      // An area change nobody announced still shows the right tiles.
      if (world.grid !== grid || !set || set.theme !== world.area.theme) reset(world)
      const gr = world.grid
      const ts = set as TileSet
      const bumps = world.bumps
      frameNo++
      shownN = 0
      const cx0 = Math.max(0, Math.floor(camX / CHUNK_PX_W))
      const cx1 = Math.min(Math.floor((gr.w - 1) / CHUNK_W), Math.floor((camX + VIEW_W - 1) / CHUNK_PX_W))
      const cy0 = Math.max(0, Math.floor(camY / CHUNK_PX_H))
      const cy1 = Math.min(Math.floor((gr.h - 1) / CHUNK_H), Math.floor((camY + VIEW_H - 1) / CHUNK_PX_H))
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = chunkFor(cx, cy)
          if (changed(c, gr, bumps) || !c.valid) build(c, gr, ts, bumps)
          c.stamp = frameNo
          g.drawImage(c.canvas, cx * CHUNK_PX_W - camX, cy * CHUNK_PX_H - camY)
          if (shownN < shown.length) shown[shownN++] = c
        }
      }
      for (let i = 0; i < shownN; i++) {
        const c = shown[i] as Chunk
        if (c.n > 0) drawLive(g, c, gr, ts, bumps, camX, camY, tick)
      }
    },
    drawHidden(g, world, camX, camY) {
      const gr = world.grid
      const tx0 = Math.max(0, Math.floor(camX / TILE))
      const tx1 = Math.min(gr.w - 1, Math.floor((camX + VIEW_W) / TILE))
      const ty0 = Math.max(0, Math.floor(camY / TILE))
      const ty1 = Math.min(gr.h - 1, Math.floor((camY + VIEW_H) / TILE))
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const ch = gr.t[ty * gr.w + tx]
          if (ch !== C_HIDDEN && ch !== C_HIDDEN_LIFE) continue
          const x = tx * TILE - camX
          const y = ty * TILE - camY
          g.fillStyle = ch === C_HIDDEN ? '#109ff9' : '#49b23c'
          for (let i = 0; i < TILE; i += 8) {
            g.fillRect(x + i, y, 4, 2)
            g.fillRect(x + i + 4, y + TILE - 2, 4, 2)
            g.fillRect(x, y + i + 4, 2, 4)
            g.fillRect(x + TILE - 2, y + i, 2, 4)
          }
          g.fillRect(x + 13, y + 13, 6, 6)
        }
      }
    },
    get builds() {
      return builds
    },
    get chunks() {
      return pool.length
    },
    get found() {
      return set ? set.found : 0
    },
  }
}
