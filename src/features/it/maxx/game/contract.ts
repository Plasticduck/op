// Super Mighty Maxx: the shared contract.
//
// Every module of the game codes against this file, so the pieces (simulation,
// shell, audio, art, scenes, levels) can be built and tested apart. Names and
// shapes here are load-bearing: add to it, never rename or repurpose.
//
// Layout of src/features/it/maxx:
//   SuperMightyMaxxPage.tsx   React host page (the lazy route)
//   game/contract.ts          this file
//   game/sim/                 the simulation. NO DOM, no canvas, no audio: plain data
//                             stepped at 60 Hz, so Node can run it (scripts/maxx)
//   game/engine/              main loop, scenes, input, save, text, sprite loading
//   game/audio/               chip synth, sound effects, songs
//   game/render/              draws a World: backgrounds, tiles, entities, particles, HUD
//   game/scenes/              title, world map, play, game over, ending
//   game/levels/              level data (ASCII rows + legends)
//   game/assets/              generated PNG atlases + their frame maps (*.atlas.ts)
//   scripts/maxx/ (repo root) art generators, simulation checks, screenshots

/* ------------------------------------------------------------------ */
/* Screen and time                                                     */
/* ------------------------------------------------------------------ */

/** One tile, in world pixels. */
export const TILE = 32
/** The game always draws a 640x360 frame; the shell scales it to the screen. */
export const VIEW_W = 640
export const VIEW_H = 360
/** Fixed simulation rate. One "tick" is 1/60 s. All sim timers count ticks. */
export const STEP_HZ = 60
export const DT = 1 / STEP_HZ

export const MAX_PIPS = 3
export const START_LIVES = 3
export const COINS_PER_LIFE = 100

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/**
 * One button can be two actions: Start and Enter are pause AND confirm, A is jump AND confirm,
 * B is spray AND cancel, Esc is pause AND cancel. Menus start on `confirm`, never on `pause`.
 */
export const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'spray', 'confirm', 'cancel', 'pause', 'select'] as const
export type Action = (typeof ACTIONS)[number]
export type ActionState = Record<Action, boolean>
export type InputDevice = 'keyboard' | 'gamepad' | 'touch'

/** One tick of input. The simulation reads only this, so a script can drive it. */
export interface InputFrame {
  /** Down right now. */
  held: ActionState
  /** Went down on this tick. */
  pressed: ActionState
  /** Went up on this tick. */
  released: ActionState
  /** `pressed`, plus auto-repeat while held (for menus): first after 20 ticks, then every 7. */
  repeat: ActionState
  /** Analog horizontal, -1..1. Digital left/right give exactly -1/1. Deadzone already applied; a stick pushed into a corner still reads full. */
  axisX: number
  /** Vertical, -1..1, up is negative. From engine/input.ts it is a switch, 0 or -1/1 (the stick's up and down have their own firmer threshold), the same as held.up / held.down. */
  axisY: number
  /** The device that last produced input (drives which button prompts are shown). */
  device: InputDevice
}

/**
 * Button prompt ids. `pad_*` are Xbox-layout buttons, `key_*` a keyboard key
 * by label (key_Z, key_SPACE, key_ENTER, key_ARROWS ...), `touch_*` on-screen buttons.
 * The full list is in the header of engine/text.ts, which draws them.
 */
export type GlyphId = string

export interface InputApi {
  /** Sample every device. Call exactly once per simulation tick. */
  poll(): InputFrame
  readonly device: InputDevice
  readonly gamepadConnected: boolean
  /** Rumble the active controller. Magnitudes 0..1. No-op without a controller or when switched off. */
  rumble(strong: number, weak: number, ms: number): void
  setRumbleEnabled(on: boolean): void
  /**
   * The prompt to show for an action on the device in use, e.g. jump -> 'pad_a' or 'key_Z'.
   * 'move' is the whole D-pad or arrow cluster. The answer depends only on `device`.
   */
  glyph(action: Action | 'move'): GlyphId
  /** A finger went down on the game somewhere other than a button: touch becomes the device in use. */
  touchUsed(): void
  destroy(): void
}

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

export type SfxId =
  | 'jump' | 'land' | 'skid' | 'bump' | 'brick' | 'coin' | 'token' | 'prize' | 'powerup' | 'heal' | 'oneUp'
  | 'sprayHit' | 'carClean' | 'honk' | 'rev' | 'stomp' | 'pop' | 'splat' | 'mudThrow' | 'hurt' | 'spring'
  | 'pipe' | 'door' | 'checkpoint' | 'timeWarn' | 'tally' | 'tallyEnd' | 'bossHit' | 'bossDown' | 'thunder'
  | 'freeze' | 'crumble' | 'hover' | 'waxStart' | 'menuMove' | 'menuSelect' | 'menuBack' | 'pause' | 'unpause'
  | 'mapMove' | 'mapEnter' | 'locked'
  // Round 3: the grackle's call, a gate's roll-up rattle, a floor button, a barred door coming
  // free, a wash brush or dryer spinning up, hot wax, a dump bed tipping.
  | 'squawk' | 'gate' | 'click' | 'unlock' | 'whir' | 'sizzle' | 'hydraulic'

/** Looping songs. */
export type MusicId =
  | 'title' | 'map' | 'sunny' | 'tunnel' | 'storm' | 'lube' | 'highway' | 'winter' | 'mega'
  | 'boss' | 'rival' | 'wax' | 'bonus' | 'ending'

/** One-shot tunes. They silence the song while they play. */
export type JingleId = 'clear' | 'grimed' | 'gameover' | 'secret' | 'versus' | 'rivalDown' | 'champion'

/**
 * Every method may be called any number of times a tick, and an id with no sound behind it
 * yet is silence, never a throw.
 */
export interface AudioApi {
  /** Call from any user gesture (key, click, tap, button). Resumes the browser's audio. Safe to call often. The shell already does, on every key, tap and controller button. */
  unlock(): void
  /** True while the browser still blocks sound (no user gesture yet; a controller button alone may not count as one). */
  readonly locked: boolean
  sfx(id: SfxId): void
  /** The one sustained effect: the prep gun's spray hiss. */
  spray(on: boolean): void
  /** Start a looping song (no-op if it is already playing, unless restart). null stops the music. */
  music(id: MusicId | null, opts?: { restart?: boolean }): void
  /**
   * Play a one-shot tune. The song is silenced meanwhile and resumes after, unless `thenMusic` says otherwise.
   * onDone is called exactly once (also when another jingle cuts this one off), but not after the scene that asked has been left.
   */
  jingle(id: JingleId, opts?: { onDone?: () => void; thenMusic?: MusicId | null }): void
  /**
   * Cut the jingle that is playing short, at once (a no-op when none is). Its onDone is NOT
   * called, and neither is its thenMusic. The song the jingle silenced stays silent unless
   * `resume` is true: then it carries on where it was. Without resume, nothing plays until the
   * next music() call, which starts its song even when it names the one the jingle silenced.
   * For leaving a scene in the middle of a jingle (quit from a pause during the versus card,
   * game over to the map).
   */
  stopJingle(opts?: { resume?: boolean }): void
  /** Hurry-up: play the current song faster (1 = normal). Call it after music(): starting a song puts the tempo back to 1. */
  setTempoScale(scale: number): void
  /** 0..1 each. */
  setVolumes(music: number, sfx: number): void
  /** Pause screen: holds the music, a jingle and the spray loop. Menu effects still play; game effects are dropped. */
  setPaused(paused: boolean): void
  /** Have these rendered ahead of time, so music() or jingle() starts at once. */
  preload(ids: (MusicId | JingleId)[]): void
  destroy(): void
}

/* ------------------------------------------------------------------ */
/* Sprites and text                                                    */
/* ------------------------------------------------------------------ */

/** A frame inside an atlas image. (ax, ay) is the anchor inside the frame, default 0,0 (top-left). */
export interface SpriteFrame {
  x: number
  y: number
  w: number
  h: number
  ax?: number
  ay?: number
}

/**
 * One generated sprite sheet. Each lives in game/assets/<name>.atlas.ts as
 * `export const atlas: AtlasDef` and is found by glob, so adding a file is enough.
 * Frames are addressed as '<atlas name>/<frame name>', e.g. 'maxx/run3'.
 */
export interface AtlasDef {
  name: string
  /** URL of the PNG (import url from './x.png'). */
  image: string
  frames: Record<string, SpriteFrame>
  /** Named animations: frame names in order (without the atlas prefix). */
  anims?: Record<string, string[]>
  /** Free-form extra data a generator wants to ship with its art (anchors, sizes). */
  meta?: Record<string, unknown>
}

export interface DrawOpts {
  /** Mirror the frame around its anchor. */
  flipX?: boolean
  alpha?: number
  /** Whole-number scale. Default 1. */
  scale?: number
}

export interface Sprites {
  has(name: string): boolean
  /** Draw frame `name` with its anchor at (x, y). Coordinates are rounded to whole pixels. Unknown names draw nothing. */
  draw(g: CanvasRenderingContext2D, name: string, x: number, y: number, opts?: DrawOpts): void
  frame(name: string): SpriteFrame | null
  /** The atlas image and frame, for custom drawing (tiling, tinting, clipping). */
  source(name: string): { image: CanvasImageSource; frame: SpriteFrame } | null
  /** The frames of an animation as full names ready for draw() ('maxx/run0', ...). Empty if there is none. */
  anim(atlas: string, anim: string): string[]
  atlas(name: string): AtlasDef | null
}

export interface TextOpts {
  /** CSS color. Default white. */
  color?: string
  /** Whole-number scale of the 8x8 font. Default 1. */
  scale?: number
  align?: 'left' | 'center' | 'right'
  /** 1px drop shadow color (scaled). */
  shadow?: string
  /** 1px outline color (scaled). */
  outline?: string
  /** Line pitch in font pixels before scale. Default 10. */
  lineHeight?: number
  /** Extra pixels between characters, before scale. Default 0. */
  spacing?: number
}

/* ------------------------------------------------------------------ */
/* Save data                                                           */
/* ------------------------------------------------------------------ */

export interface LevelRecord {
  cleared: boolean
  bestScore: number
  /** Fastest clear, in ticks. 0 = none yet. */
  bestTicks: number
  /** The three gold tokens. */
  tokens: [boolean, boolean, boolean]
  /** Cleared with every car washed. */
  spotless: boolean
}

export interface SaveSettings {
  /** 0..10 */
  music: number
  /** 0..10 */
  sfx: number
  rumble: boolean
  shake: boolean
}

export interface SaveData {
  v: 1
  /** Keyed by LevelDef.id. */
  levels: Record<string, LevelRecord>
  /** How many of the eight main levels are open (1..8). */
  unlocked: number
  /** The hidden road to Rival Row has been found. */
  secretFound: boolean
  /** Rivals beaten so far, in order (0..4). */
  rivalsBeaten: number
  /** All four rivals beaten. */
  champion: boolean
  /** The game has been finished at least once. */
  finished: boolean
  hiScore: number
  settings: SaveSettings
  /** What the world map has already shown, so each of its flourishes plays once, across reloads. */
  map: MapMemory
}

/**
 * The world map's memory (scenes/map/progress.ts reads and writes it). An old save that had
 * none, or a new game, has empty `roads`: the map has never been looked at with this save.
 * (The road from HQ to MW01 is always paved, so once the map has looked, `roads` is never empty.)
 */
export interface MapMemory {
  /** Ids of the roads already drawn in (the map layout's road ids). */
  roads: string[]
  /** Rivals already shown unmasked (0..4). */
  beaten: number
  /** The champion's crown has been shown. */
  champion: boolean
  /** The site Maxx last stood at on the map ('' for none yet). */
  node: string
}

export interface SaveApi {
  /** Live object. Mutate it, then call commit(). */
  readonly data: SaveData
  commit(): void
  /** Wipe progress (keeps settings). */
  reset(): void
  record(levelId: string): LevelRecord
}

/* ------------------------------------------------------------------ */
/* Scenes and the shell                                                */
/* ------------------------------------------------------------------ */

/** 'sandbox' and 'viewer' are dev scenes: the engine test room, and any level drawn by the real world renderer with no HUD. */
export type SceneId = 'title' | 'map' | 'play' | 'gameover' | 'ending' | 'sandbox' | 'viewer'
export type SceneParams = Record<string, unknown>
export type Transition = 'cut' | 'fade' | 'iris'

/** What carries from level to level within one sitting. Not saved. */
export interface Session {
  lives: number
  score: number
  coins: number
  pips: number
  turbo: boolean
}

export interface GameCtx {
  readonly audio: AudioApi
  readonly input: InputApi
  readonly sprites: Sprites
  readonly save: SaveApi
  readonly session: Session
  /** Ticks since the game started. */
  readonly tick: number
  /** Dev page only: extra overlays and cheats. */
  readonly debug: boolean
  /** Switch scene. The switch happens between ticks, behind the transition. */
  go(scene: SceneId, params?: SceneParams, transition?: Transition): void
  /** True while a scene transition is covering the screen (scenes should ignore input). */
  readonly transitioning: boolean
  toggleFullscreen(): void
  readonly fullscreen: boolean
  /** Fresh session values (lives, score, pips). */
  resetSession(): void
  /**
   * True during the one tick whose 'pause' press was made by the shell (tab hidden, window
   * unfocused, controller gone, fullscreen left with Esc) and not by the player. Pause on it;
   * a scene that is already paused must ignore it instead of toggling back.
   */
  readonly autoPause: boolean
  /** Display frames per second, measured. */
  readonly fps: number
  /** Where the next iris closes and opens, in screen pixels. Back to the middle after each transition. */
  irisAt(x: number, y: number): void
  readonly muted: boolean
  setMuted(on: boolean): void
  /** Put save.data.settings into effect (volumes, rumble). Call after changing them. */
  applySettings(): void
}

/**
 * go() from enter() with 'cut' is followed in the same tick (the scene in between is never
 * updated or drawn); go() from exit() is ignored. The play scene, not the simulation, takes a
 * life on 'grimed' or 'timeup' and awards TUNING.spotlessBonus.
 */
export interface Scene {
  enter?(game: GameCtx, params: SceneParams): void
  /** One fixed 60 Hz tick. */
  update(game: GameCtx, input: InputFrame): void
  /** Draw the whole 640x360 frame. Called once per display frame, after update. */
  render(game: GameCtx, g: CanvasRenderingContext2D): void
  exit?(game: GameCtx): void
}

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

export type ThemeId =
  | 'lot' // sunny wash lot, outdoors
  | 'vacuum' // vacuum bays, outdoors, late afternoon
  | 'tunnel' // inside the wash tunnel
  | 'storm' // rain and mud, outdoors
  | 'lube' // the lube shop pit, underground
  | 'highway' // sunset highway
  | 'winter' // snow and road salt
  | 'mega' // the mega tunnel at night
  | 'bonus' // token rooms
  | 'backlot' // Rival Row arenas

/** What a legend character spawns. */
export interface SpawnSpec {
  kind: string
  variant?: string
  props?: Record<string, number | string | boolean>
}

/**
 * One connected room. `rows` is the map, top row first, one character per tile,
 * all rows the same length, at least 12 rows. A character is a tile (TILE_CHARS),
 * an entity from the area's `legend` or DEFAULT_LEGEND, or blank. An entity
 * character marks the tile its feet stand in (bottom-centre of that tile).
 */
export interface AreaDef {
  id: string
  theme: ThemeId
  /** Overrides the level's song while in this area. */
  music?: MusicId
  rows: string[]
  /** Area-specific characters. Checked before DEFAULT_LEGEND. */
  legend?: Record<string, SpawnSpec>
}

export interface LevelDef {
  /** Stable id, used as the save key: 'mw01'..'mw08', 'rivals'. */
  id: string
  /** The sign on the map: 'MW01'. */
  site: string
  name: string
  /** Seconds on the clock. */
  time: number
  music: MusicId
  /** areas[0] is where the level starts (at its '@'). */
  areas: AreaDef[]
}

/**
 * Tile characters. Everything else in a row is an entity or blank.
 *   ' '  air
 *   '#'  ground (the theme's main solid)
 *   '%'  wall (the theme's second solid: building wall, tunnel wall)
 *   'B'  brick: breaks when bumped from below
 *   'C'  coin brick: looks like a brick, gives up to 8 coins, then turns into 'U'
 *   '?'  prize block: a coin
 *   '!'  power block: a bubble when Maxx is missing shine, else the turbo nozzle
 *   'W'  wax block: Mighty Wax (brief invincibility)
 *   'L'  life block: an extra life
 *   'H'  hidden coin block: not solid and not drawn until bumped from below
 *   'h'  hidden life block
 *   'U'  used block
 *   'X'  steel block: solid, never breaks
 *   '='  catwalk: stand on it, jump up through it
 *   '<'  conveyor carrying things left      '>'  conveyor carrying things right
 *   'I'  slick floor (foam, ice): low grip
 *   'O'  oily floor: almost no grip
 *   'M'  mud floor: slow running, weak jump
 *   'g'  grime block: solid until the prep gun washes it away (hides secrets)
 *   '~'  sludge: not solid, grimes Maxx at once (fills pits)
 *   '^'  spike strip: not solid, costs one shine
 *   'P'  pipe (solid; drawn as a pipe, with a rim where there is no pipe above)
 *   '|'  pillar: background only, not solid
 */
export const TILE_CHARS = ' #%BC?!WLHhUX=<>IOMg~^P|'

/**
 * Entity characters every level can use. Kinds are implemented under game/sim/entities.
 * Levels add their own (digits and unused letters) through AreaDef.legend.
 */
export const DEFAULT_LEGEND: Record<string, SpawnSpec> = {
  '@': { kind: 'start' },
  o: { kind: 'coin' },
  $: { kind: 'token' },
  '*': { kind: 'bubble' },
  k: { kind: 'checkpoint' },
  G: { kind: 'goal' },
  c: { kind: 'car', variant: 'compact' },
  s: { kind: 'car', variant: 'sedan' },
  v: { kind: 'car', variant: 'suv' },
  p: { kind: 'car', variant: 'pickup' },
  f: { kind: 'car', variant: 'sports' },
  n: { kind: 'car', variant: 'van' },
  t: { kind: 'car', variant: 'monster' },
  b: { kind: 'blob' },
  r: { kind: 'bird' },
  u: { kind: 'bugs' },
  w: { kind: 'tumbleweed' },
  d: { kind: 'drip' },
  i: { kind: 'icicle' },
  z: { kind: 'brush' },
  j: { kind: 'jet' },
  y: { kind: 'spring' },
}

/**
 * Where the prep gun's water leaves the nozzle, measured from the middle of
 * Maxx's feet when he faces right (x forward, y up is negative). The art puts
 * the nozzle tip here; the simulation spawns water here. Each is a point on the
 * edge of the nozzle's open face (its middle; the leading corner for `up`), and
 * the anchor is the line between two pixel columns, so a flipped draw mirrors it exactly.
 */
export const MUZZLE = {
  fwd: { x: 30, y: -30 },
  up: { x: 24, y: -54 },
  down: { x: 6, y: -4 },
} as const

/**
 * Maxx's collision box. His sprite frames ('maxx/...') each carry their own
 * anchor: the middle of his feet on the ground line. Draw them at
 * (player.x + MAXX_W / 2, player.y + MAXX_H).
 */
export const MAXX_W = 22
export const MAXX_H = 52
