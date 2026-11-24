// The simulation's data model. Plain data only: the renderer reads it, the
// play scene drains `events`, and scripts/maxx can run it in Node.
import type { AreaDef, InputFrame, JingleId, LevelDef, MusicId, Session, SfxId, SpawnSpec } from '../contract'

export type Facing = 1 | -1

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Something that moves and collides. (x, y) is the top-left of its collision box, in world pixels. Speeds are pixels per second. */
export interface Body extends Rect {
  vx: number
  vy: number
  onGround: boolean
  /** Touched a wall this tick: -1 on its left, 1 on its right, 0 none. */
  hitWall: -1 | 0 | 1
  hitCeil: boolean
}

export type PlayerState =
  | 'normal'
  | 'hurt' // knocked back after losing a shine pip
  | 'grimed' // out of shine: the level stops and he flops
  | 'warp' // sliding into a pipe or walking through a door
  | 'clear' // level won, victory walk
export type Aim = 'fwd' | 'up' | 'down'

export interface Player extends Body {
  facing: Facing
  state: PlayerState
  /** Ticks in the current state. */
  stateT: number
  /** Shine left, 0..MAX_PIPS. */
  pips: number
  /** Ticks of blinking after a hit, when nothing can hurt him. */
  invuln: number
  /** Ticks of Mighty Wax left (invincible, washes cars on touch). */
  wax: number
  turbo: boolean
  spraying: boolean
  aim: Aim
  /**
   * Ticks of hover left this airtime. Full (TUNING.hoverTicks) until the hover first holds him up;
   * from then it runs down every tick in the air, held or not. Refilled on landing, by a spring or
   * a stomp, and coming out of a warp.
   */
  hover: number
  hovering: boolean
  /** Distance run, in pixels, for the run cycle (the renderer picks the frame from it). */
  runDist: number
  /** Entity id he stands on (a clean car, a lift), else 0. */
  ridingId: number
  /** Ticks since he left the ground (for coyote time). */
  airT: number
  /**
   * Standing on slick, oil, mud or a conveyor: the tile character, else ''. Just off its edge it is
   * kept for as long as a coyote jump is owed (that jump is off this floor); read it with onGround.
   */
  floor: string
  skidding: boolean
  /** Where his box was at the start of this tick (stomp detection, the renderer's motion checks). */
  px: number
  py: number
  /** Ticks a jump press is still good for (the jump buffer). */
  jumpBuf: number
  /** Coyote time left: above 0 he can still jump although he has run off a ledge. 0 once he jumps or is thrown. */
  coyote: number
  /** Rising from his own jump, as opposed to a spring or a stomp bounce. */
  jumping: boolean
  /** The jump button was let go on the way up, so the hop is being cut short. */
  jumpCut: boolean
  /** Fraction of a droplet the prep gun owes (it fires each time this reaches 1). */
  sprayAcc: number
}

/** One blob of water from the prep gun. */
export interface Droplet {
  x: number
  y: number
  vx: number
  vy: number
  /** Ticks left. */
  life: number
  /** How much dirt one hit removes. */
  power: number
}

export interface Entity extends Body {
  id: number
  kind: string
  variant: string
  facing: Facing
  state: string
  /** Ticks in the current state. */
  stateT: number
  /** Dirt left on a car, health of a boss, hits a blob can take. */
  hp: number
  maxHp: number
  /** Woken up (the camera came near). Sleeping entities are not updated. */
  active: boolean
  /** Removed at the end of the tick. */
  dead: boolean
  /** Touching it costs shine (the behaviour may switch this, e.g. a washed car is harmless). */
  harmful: boolean
  /** What Maxx can do with it as ground: nothing, stand on top, or it is a wall too. */
  solid: 'none' | 'top' | 'full'
  /**
   * The shape of its standable top, when that is not the flat top of its box: one number per
   * pixel column of the box, left to right as the world sees it (so flip it yourself when the
   * entity turns round), how far below e.y the top is in that column. null (the default): the
   * whole box top is ground. A body stands on the highest point under its feet (its box less 4 px
   * each side: Maxx's boots), so where its feet are past the end it is not standing on it at all;
   * walking along it, it steps up or down with it by up to TUNING.groundStep a tick (a bigger
   * drop is a fall). Only the top follows it: a 'full' entity is still its box on the sides and below.
   * Share one array between entities (a module-level constant); never build one per tick.
   */
  ground: readonly number[] | null
  /** Gravity multiplier. 0 floats. */
  gravity: number
  /** Stopped by tiles. */
  collides: boolean
  /** Draw order: below 0 behind Maxx, above 0 in front. */
  z: number
  /** Config from the level (SpawnSpec.props). Never written after spawn. */
  props: Record<string, number | string | boolean>
  /** Scratch numbers for the behaviour. */
  vars: Record<string, number>
  spawnX: number
  spawnY: number
  /** Where its box was at the start of this tick. Riders are carried by the difference. */
  px: number
  py: number
  /**
   * Which of its area's level spawns it came from, counting in reading order; -1 if it was made at runtime.
   * The same on every attempt at the level, so it can name the entity in a flag that outlives a retry.
   */
  slot: number
}

export type TouchSide = 'stomp' | 'side' | 'below'

/**
 * How one kind of entity behaves. Files under sim/entities register theirs
 * with registerEntity(kind, behavior); the folder is loaded by glob.
 */
export interface EntityBehavior {
  /** Set size, flags and starting state. (x, y) arrives as the bottom-centre of the spawn tile; init must place the box. */
  init(e: Entity, w: World): void
  /** One tick, only while active. */
  update(e: Entity, w: World): void
  /** A droplet hit it. Return true to use the droplet up. */
  onSpray?(e: Entity, w: World, d: Droplet): boolean
  /** Maxx overlaps it. 'stomp' = he came down onto its top. Called before the generic harmful check; return true if handled (no generic damage). */
  onTouch?(e: Entity, w: World, side: TouchSide): boolean
  /** Keep updating even far off screen (bosses, spawners, lifts). */
  alwaysActive?: boolean
  /** Counts toward the level's "cars washed" total. */
  countsAsCar?: boolean
  /**
   * A boss or rival. The turbo nozzle's water counts TUNING.turboBossPower a droplet on it, not
   * its full power: the nozzle already fires half as often again, and both together would halve
   * every fight. (Applied where droplets hit, before onSpray sees d.power.)
   */
  boss?: boolean
  /**
   * What happens once it is left far from the camera (TUNING.sleepMargin outside the view).
   * 'sleep' (the default): it stops updating until the camera comes back.
   * 'remove': it is taken out for good (projectiles, anything that must not pile up).
   * 'removeBehind': removed only when it is also heading away from the view (a car that
   * drove past Maxx), otherwise it sleeps.
   */
  offscreen?: 'sleep' | 'remove' | 'removeBehind'
  /** Never removed by 'removeBehind' while this holds: it sleeps instead (a car still needed for SPOTLESS). */
  keep?(e: Entity): boolean
  /** The block it stands on was bumped from below. */
  onBump?(e: Entity, w: World): void
  /** How many countsAsCar entities one of these will add over its life (spawners). Feeds LevelStats.carsTotal. */
  carCount?(spec: SpawnSpec): number
}

/** Cosmetic effects the renderer turns into particles. */
export type FxId =
  | 'splash' | 'sparkle' | 'dust' | 'debris' | 'mud' | 'bubble' | 'star' | 'smoke' | 'foam' | 'snow'
  | 'confetti' | 'drip' | 'steam' | 'coin' | 'shine' | 'leaf' | 'spark'

export type GameEvent =
  | { type: 'sfx'; id: SfxId }
  | { type: 'music'; id: MusicId | null }
  | { type: 'jingle'; id: JingleId }
  | { type: 'fx'; fx: FxId; x: number; y: number; n?: number; dir?: number }
  /** Small floating text in the world: '100', '1UP', 'CLEAN!'. */
  | { type: 'popup'; text: string; x: number; y: number }
  /** Big text across the screen: 'GRIMED!', 'SPOTLESS!'. */
  | { type: 'banner'; text: string; ticks: number }
  | { type: 'rumble'; strong: number; weak: number; ms: number }
  | { type: 'shake'; ticks: number; mag: number }
  /** A boss or rival appears: the play scene shows a card. `id` is the entity's (draw the portrait from it). */
  | { type: 'versus'; id: number; name: string; tagline: string }
  /** Maxx went through a pipe or door; the play scene covers the cut. */
  | { type: 'area'; areaId: string }
  | { type: 'checkpoint' }
  | { type: 'secret' }

export interface TileGrid {
  /** Size in tiles. */
  w: number
  h: number
  /** Tile characters as char codes, row-major: t[y * w + x]. Blank and entity cells hold 32 (space). */
  t: Uint8Array
  /** One counter per tile, same indexing: hits a grime block has taken, coins a coin brick has given. */
  d: Uint8Array
}

export interface LevelStats {
  carsTotal: number
  carsWashed: number
  tokens: [boolean, boolean, boolean]
  coins: number
  /** Points earned in this level. */
  score: number
}

export type WorldStatus =
  | 'play'
  | 'grimed' // Maxx is out; the play scene takes the life, then restarts from the checkpoint or ends the game
  | 'clear' // exit reached; see `exit`
  | 'timeup'

export interface World {
  level: LevelDef
  area: AreaDef
  grid: TileGrid
  player: Player
  entities: Entity[]
  droplets: Droplet[]
  camera: { x: number; y: number }
  /** Ticks simulated in this attempt. */
  tick: number
  /** Ticks left on the clock. */
  timeLeft: number
  status: WorldStatus
  /** How the level was cleared. */
  exit: 'goal' | 'secret' | null
  /** After a clear: Maxx does his victory walk (false: he was stopped, see completeLevel's `walk`). */
  clearWalk: boolean
  /** Ticks since status left 'play' (the play scene waits on this for its cut). */
  statusT: number
  /** Appended during a tick. The play scene handles them and empties the array every tick. */
  events: GameEvent[]
  stats: LevelStats
  /** Lives, score, coins, pips, turbo. Shared with the shell, mutated in place. */
  session: Session
  /** Where a retry starts: (x, y) is the middle of Maxx's feet, in that area's pixels. */
  checkpoint: { areaId: string; x: number; y: number } | null
  /** The boss on screen, for the HUD bar. */
  boss: { name: string; hp: number; maxHp: number } | null
  /**
   * The song of the fight in progress (setBossMusic), or null. While it is set, areaMusic() names
   * it instead of the area's song, so Mighty Wax running out hands back to the fight, not the level.
   * clearBoss() ends it, and so does leaving the area.
   */
  bossMusic: MusicId | null
  /**
   * Level scripting flags (a boss beaten, a gate open). Kept across areas and retries from a checkpoint.
   * Names starting 'washed:' are the simulation's own: one per car already counted toward SPOTLESS.
   */
  flags: Record<string, number>
  /** Deterministic random state. Use rand(w), never Math.random, inside the simulation. */
  seed: number
  nextId: number
  /** The input of the tick being simulated, for behaviours that read buttons (pipes, doors). */
  input: InputFrame
  /** The stick's vertical position on the tick before, so a push up or down can be told from a hold. */
  lastAxisY: number
  /** Every area of the level. An area Maxx has left keeps its tiles and entities here. Keyed by AreaDef.id. */
  areas: Record<string, AreaState>
  /** A trip through a pipe or door. Everything else is frozen while this is set. */
  warp: Warp | null
  /** Set when a trip ends, cleared once up and down are let go: stops a held stick sending him straight back. */
  warpLock: boolean
  /** Blocks that were just bumped, for the renderer's little hop. */
  bumps: TileBump[]
  /** Cars washed in a row (0 = no chain going) and the ticks left before the chain lapses. */
  chain: number
  chainT: number
  /** The camera's eased look-ahead, in pixels (positive = looking right). */
  camLook: number
  /** A boss arena: the camera and Maxx are held between these two world x positions. See lockCamera(). */
  camBounds: { x0: number; x1: number } | null
  /** Rate limiter for sound effects: the tick each id last played on. See sfxEvery(). */
  sfxAt: Record<string, number>
  /** Rebuilt every tick: the awake entities Maxx can stand on, and the other awake ones. */
  solids: Entity[]
  actives: Entity[]
}

/** One legend character found in an area's rows. */
export interface AreaSpawn {
  spec: SpawnSpec
  /** The tile the character sits in. */
  tx: number
  ty: number
  /** Tokens only: which of the level's three this one is (0..2), else -1. */
  token: number
}

export interface AreaState {
  def: AreaDef
  grid: TileGrid
  spawns: AreaSpawn[]
  /** Null until Maxx first enters the area. */
  entities: Entity[] | null
}

export interface Warp {
  mode: 'pipe' | 'door'
  /** 'out': going in on the near side. 'in': coming out on the far side. */
  phase: 'out' | 'in'
  /** Ticks into the phase, and its length. */
  t: number
  ticks: number
  toArea: string
  toMarker: string
  /** Maxx's box position when the phase began. */
  fromX: number
  fromY: number
  /** Where his box's x slides to during the phase (the middle of the pipe). */
  toX: number
}

export interface TileBump {
  tx: number
  ty: number
  /** Ticks since the bump. The entry is dropped at TUNING.bumpTicks. */
  t: number
}

/** Options for moveBody(). Pass a module-level constant, not a fresh object every tick. */
export interface MoveOpts {
  /** Gravity multiplier. Default: the entity's own `gravity` (1 for a bare Body). */
  gravity?: number
  /** Stopped by tiles. Default: the entity's own `collides` (true for a bare Body). */
  collide?: boolean
  /** Lands on and is carried by solid entities (lifts, washed cars); 'full' ones are walls. Default true. */
  solids?: boolean
  /** Catwalks hold it up. Default true. */
  oneWay?: boolean
  /** Conveyors carry it. Default true. */
  conveyor?: boolean
  /** Fall speed cap in px/s. Default TUNING.fallCap. */
  maxFall?: number
  /** Share of its speed kept when it bounces off a wall (0 = stops dead, the default). */
  bounceX?: number
  /** Share of its speed kept when it bounces off the floor (0 = lands, the default). */
  bounceY?: number
}

export interface HurtOpts {
  /** World x of whatever hit him: he is knocked away from it. Default: knocked backwards. */
  fromX?: number
  /** Ignore the blinking after a hit and Mighty Wax. */
  force?: boolean
}

export interface WorldOpts {
  session: Session
  /** Start here instead of the level's '@'. */
  checkpoint?: { areaId: string; x: number; y: number } | null
  /**
   * Flags carried over from the previous attempt (they also remember which cars were already washed).
   * A retry passes world.flags, or SPOTLESS credit is lost; a fresh visit from the map passes none.
   */
  flags?: Record<string, number>
  /** Tokens already owned (from the save), so they show as collected. */
  tokens?: [boolean, boolean, boolean]
  seed?: number
}

export type { AreaDef, InputFrame, LevelDef, SpawnSpec }
