// What each tile character (contract TILE_CHARS) is, for the simulation and
// the renderer alike. Look a tile up by character in TILE_INFO, or by char
// code in TILE_BY_CODE / TILE_FLAGS when it has to be quick.
import { TILE_CHARS } from '../contract'
import { TUNING } from './tuning'

/** What a head bump from below does to a tile. */
export type BumpKind =
  | 'none' // not something a head can reach (air, catwalk, sludge)
  | 'thud' // solid, nothing happens
  | 'break' // brick: shatters
  | 'coins' // coin brick: a coin per bump, then used
  | 'coin' // prize block or hidden coin block: one coin, then used
  | 'power' // a bubble when Maxx is missing shine, else the turbo nozzle
  | 'wax' // Mighty Wax
  | 'life' // an extra life

export interface TileInfo {
  ch: string
  name: string
  /** Blocks movement from every side. */
  solid: boolean
  /** Catwalk: stand on it, pass up through it. */
  oneWay: boolean
  /** Not solid and not drawn until bumped from below. */
  hidden: boolean
  bump: BumpKind
  /** Something comes out of it (or it changes) when bumped. */
  bumpable: boolean
  /** Shatters when bumped. */
  breakable: boolean
  /** Acceleration and braking multiplier for whoever stands on it (1 = normal). */
  grip: number
  /** Top speed multiplier. */
  speed: number
  /** Jump launch multiplier. */
  jump: number
  /** Carries what stands on it: -1 left, 1 right, 0 no. */
  conveyor: -1 | 0 | 1
  hazard: 'none' | 'sludge' | 'spike'
  /** The prep gun wears it away. */
  washable: boolean
  /** Scenery behind the action (pillars). */
  background: boolean
}

function tile(ch: string, name: string, over: Partial<TileInfo> = {}): TileInfo {
  const info: TileInfo = {
    ch,
    name,
    solid: false,
    oneWay: false,
    hidden: false,
    bump: 'none',
    bumpable: false,
    breakable: false,
    grip: 1,
    speed: 1,
    jump: 1,
    conveyor: 0,
    hazard: 'none',
    washable: false,
    background: false,
    ...over,
  }
  if (info.solid && info.bump === 'none') info.bump = 'thud'
  info.bumpable = info.bump !== 'none' && info.bump !== 'thud'
  info.breakable = info.bump === 'break'
  return info
}

const solid = { solid: true }

export const TILE_INFO: Record<string, TileInfo> = {
  ' ': tile(' ', 'air'),
  '#': tile('#', 'ground', solid),
  '%': tile('%', 'wall', solid),
  B: tile('B', 'brick', { solid: true, bump: 'break' }),
  C: tile('C', 'coin brick', { solid: true, bump: 'coins' }),
  '?': tile('?', 'prize block', { solid: true, bump: 'coin' }),
  '!': tile('!', 'power block', { solid: true, bump: 'power' }),
  W: tile('W', 'wax block', { solid: true, bump: 'wax' }),
  L: tile('L', 'life block', { solid: true, bump: 'life' }),
  H: tile('H', 'hidden coin block', { hidden: true, bump: 'coin' }),
  h: tile('h', 'hidden life block', { hidden: true, bump: 'life' }),
  U: tile('U', 'used block', solid),
  X: tile('X', 'steel block', solid),
  '=': tile('=', 'catwalk', { oneWay: true }),
  '<': tile('<', 'conveyor left', { solid: true, conveyor: -1 }),
  '>': tile('>', 'conveyor right', { solid: true, conveyor: 1 }),
  I: tile('I', 'slick floor', { solid: true, grip: TUNING.slickGrip }),
  O: tile('O', 'oily floor', { solid: true, grip: TUNING.oilGrip }),
  M: tile('M', 'mud floor', { solid: true, speed: TUNING.mudSpeed, jump: TUNING.mudJump }),
  g: tile('g', 'grime block', { solid: true, washable: true }),
  '~': tile('~', 'sludge', { hazard: 'sludge' }),
  '^': tile('^', 'spike strip', { hazard: 'spike' }),
  P: tile('P', 'pipe', solid),
  '|': tile('|', 'pillar', { background: true }),
}

export const T_SOLID = 1
export const T_ONEWAY = 2
export const T_HIDDEN = 4
export const T_HAZARD = 8
/** Slick, oil, mud or conveyor: a floor Maxx feels (Player.floor). */
export const T_FLOOR = 16
export const T_WASHABLE = 32

/** TileInfo by char code. Undefined for anything that is not a tile. */
export const TILE_BY_CODE: (TileInfo | undefined)[] = []
/** T_* bits by char code. */
export const TILE_FLAGS = new Uint8Array(128)

for (const ch of TILE_CHARS) {
  const info = TILE_INFO[ch]
  const code = ch.charCodeAt(0)
  TILE_BY_CODE[code] = info
  TILE_FLAGS[code] =
    (info.solid ? T_SOLID : 0) |
    (info.oneWay ? T_ONEWAY : 0) |
    (info.hidden ? T_HIDDEN : 0) |
    (info.hazard !== 'none' ? T_HAZARD : 0) |
    (info.grip !== 1 || info.speed !== 1 || info.jump !== 1 || info.conveyor !== 0 ? T_FLOOR : 0) |
    (info.washable ? T_WASHABLE : 0)
}

export const AIR = 32

export function isTileChar(ch: string): boolean {
  return ch.length === 1 && TILE_INFO[ch] !== undefined
}
