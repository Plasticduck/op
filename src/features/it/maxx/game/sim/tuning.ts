// Every gameplay number in one place. Units: pixels, pixels per second,
// pixels per second squared, and ticks (1/60 s). `node scripts/maxx/sim.mjs`
// prints what these add up to (jump apex, jump length, stopping distance).

export const TUNING = {
  /* ---- running ---- */
  runSpeed: 215,
  /** Top speed while spraying on the ground. */
  spraySpeed: 150,
  /** Top speed while hovering on the gun. */
  hoverSpeed: 150,
  /** The analog stick scales top speed, never below this share. */
  analogMin: 0.4,
  /** How far the stick must lean up or down to count as up or down (aim, hover, pipes, doors). */
  stickPress: 0.5,
  groundAccel: 1100,
  groundDecel: 1400,
  skidDecel: 2400,
  airAccel: 800,
  airDecel: 450,
  airTurn: 1400,
  /** Slower than this he just turns round; faster, he skids. */
  skidMinSpeed: 70,
  skidSfxSpeed: 150,

  /* ---- jumping ---- */
  jumpSpeed: 635,
  /** Added to the launch at a full run. */
  jumpRunBonus: 40,
  gravRise: 1500,
  /** Rising with the jump button let go: this is what makes short hops (a one-tick tap is 1.5 tiles). */
  gravCut: 5000,
  gravFall: 2300,
  fallCap: 760,
  coyoteTicks: 6,
  jumpBufferTicks: 7,
  /** Clip a block corner by no more than this with his head and he slips past it. */
  cornerNudge: 5,
  /**
   * Meet the lip of a ledge with his feet no more than this far below its top and he is put on it.
   * It is what lets a run (or a spray-run) carry him across a one-tile gap, and forgives a jump a hair short.
   */
  ledgeNudge: 6,
  /** Downward speed after a head bump. */
  bumpRebound: 30,
  landSfxSpeed: 320,

  /* ---- hover ---- */
  hoverFall: 40,
  hoverTicks: 42,

  /* ---- floors ---- */
  slickGrip: 0.35,
  oilGrip: 0.12,
  mudSpeed: 0.5,
  mudJump: 0.8,
  conveyorSpeed: 60,

  /* ---- shine ---- */
  hurtTicks: 24,
  invulnTicks: 90,
  knockX: 150,
  knockY: 250,
  waxTicks: 600,
  /** Grimed: the little hop before he flops. */
  grimeHop: 330,
  /** A spike strip only bites this many pixels up from the floor. */
  spikeHeight: 14,
  /** Sludge has to swallow this much of him. */
  sludgeDepth: 8,

  /* ---- the prep gun ---- */
  /** Droplets per tick (0.5 = one every 2 ticks). */
  sprayRate: 0.5,
  dropletSpeed: 540,
  /** Random spread either side of the aim, in degrees. */
  dropletJitter: 4,
  dropletGravity: 500,
  dropletLife: 20,
  dropletPower: 1,
  /** A droplet hits anything within this many pixels of its centre. */
  dropletRadius: 3,
  /** Share of Maxx's own speed a droplet starts with, so the stream does not lag behind a run. */
  dropletInherit: 0.5,
  maxDroplets: 40,
  turboRate: 1.5,
  turboReach: 1.35,
  turboPower: 2,
  /**
   * What a turbo droplet counts for on a boss or rival (EntityBehavior.boss). With the faster
   * rate that is 2.25 times the plain nozzle, where full power would be 3 and halve every fight.
   */
  turboBossPower: 1.5,
  grimeBlockHits: 6,

  /* ---- blocks ---- */
  coinBrickCoins: 8,
  bumpTicks: 10,
  /** Ticks a prize takes to rise out of its block. */
  popTicks: 18,

  /* ---- bounces ---- */
  stompBounce: 400,
  /**
   * Stomp bounce with the jump button held: 120 px. Off a blob (28 tall) on the floor that is 148,
   * under the 154 a 5-tile wall needs (160 less the ledge forgiveness), so a blob is never a ladder
   * over one. 620 put him on it.
   */
  stompBounceHeld: 600,
  springSpeed: 880,

  /* ---- score ---- */
  coinScore: 20,
  tokenScore: 1000,
  brickScore: 10,
  bubbleScore: 200,
  powerScore: 500,
  /** Cars washed in a row. The last entry repeats. */
  chainScores: [200, 400, 800, 1000],
  chainTicks: 180,
  /** Bonus for washing every car. The tally screen awards it, not the simulation. */
  spotlessBonus: 3000,
  /** The counters stop here. */
  maxScore: 9999999,
  maxLives: 99,

  /* ---- clock ---- */
  /** Seconds left when the 'timeWarn' sound plays. */
  timeWarnAt: [30, 10],

  /* ---- cars ---- */
  /** Size, speed and dirt (hits to wash) of each variant. */
  cars: {
    compact: { w: 72, h: 40, speed: 40, dirt: 10 },
    sedan: { w: 88, h: 40, speed: 55, dirt: 18 },
    suv: { w: 92, h: 52, speed: 60, dirt: 26 },
    pickup: { w: 100, h: 52, speed: 50, dirt: 36 },
    sports: { w: 92, h: 34, speed: 150, dirt: 12 },
    van: { w: 100, h: 60, speed: 45, dirt: 44 },
    monster: { w: 120, h: 92, speed: 35, dirt: 60 },
  } as Record<string, { w: number; h: number; speed: number; dirt: number }>,
  /** A washed car drives off this much faster. */
  cleanSpeedUp: 1.2,
  /** Ticks between washing a car and its happy honk. */
  honkDelay: 16,
  /** A sports car sits revving this long after it wakes. */
  revTicks: 34,
  /** Cars keep this much road between them. */
  carGap: 6,
  clodEvery: 130,
  clodRange: 300,
  /** A clod is thrown to land where Maxx stands after about this many seconds. */
  clodFlight: 0.75,
  clodUp: 380,
  clodMinSpeed: 100,
  clodMaxSpeed: 380,
  clodGravity: 0.5,
  /** A spawner only sends cars while it is within this many pixels of the screen. */
  spawnRange: 448,

  /* ---- other fixtures ---- */
  liftSpeed: 60,
  liftWait: 30,
  itemWalkSpeed: 60,
  oneupWalkSpeed: 80,
  signRange: 56,

  /* ---- entities ---- */
  /** An entity wakes when it comes this close to the edge of the screen. */
  activeMargin: 96,
  /** ... and sleeps (or is removed) this far outside it. */
  sleepMargin: 480,
  /** Anything this far outside the area is removed. */
  areaMargin: 96,
  /** Largest move in one collision sub-step. Keeps fast bodies from tunnelling. */
  maxStep: 8,
  /**
   * On a solid entity with a ground profile (a washed car's roof line), how far a body standing
   * on it is carried up or down with the shape in one tick: up a windscreen at a full run, down
   * the other side. A bigger drop is a fall. Kept under the lowest car top over the road (19 px),
   * so nobody walking by on the road is lifted onto a car.
   */
  groundStep: 16,

  /* ---- camera ---- */
  camLookAhead: 56,
  camLookSpeed: 2,
  /** In tall areas the camera keeps Maxx between these two lines of the screen. */
  camTop: 110,
  camBottom: 262,
  camUpSpeed: 12,
  camDownSpeed: 14,
  /** Fastest the camera slides sideways, in pixels a tick. Play never reaches it; a boss arena locking or letting go does. */
  camMaxSpeed: 12,

  /* ---- warps and the ends of a level ---- */
  pipeOutTicks: 34,
  pipeInTicks: 34,
  doorOutTicks: 18,
  doorInTicks: 12,
  /** Blinking after he comes out of a pipe or door. */
  warpGrace: 30,
  clearWalkTicks: 80,
  /** Stick position of the victory walk (0..1). */
  clearWalkAxis: 0.5,
}

export type Tuning = typeof TUNING
