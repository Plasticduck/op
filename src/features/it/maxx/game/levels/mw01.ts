// MW01 GRAND OPENING: the first level. Opening day at a brand new Mighty Wash, and everything
// a player needs is taught once, by a sign, with room to try it. Left to right:
//
//   start     Maxx beside the GRAND OPENING banner: run, jump, a planter one tile high
//   planter   a raised bed two tiles up (hold the button), the wash crates on it
//   gaps      a shallow ditch nobody can be lost in, then the first real pit (2 tiles), marked
//             with cones and full of sludge
//   lane      the first dusty compact, alone, on a long flat lane, the sign just before it
//   blob      one grime blob on flat ground: stomp it or spray it; a second on a catwalk
//             over the path; then a star crate
//   flag      the checkpoint, just past the middle
//   stage     a wash bay two steps down, a compact shuttling in it between the wall and a
//             drain pipe, under the GRAND OPENING stage: a steel deck five tiles over the bay
//             floor that nobody can jump to. Wash the car, ride its roof, jump up through the
//             grated hatch: token 1
//   pipe      the drain pipe at the end of the bay, coins dropping into it: the vault below
//             holds token 2
//   pit       a bubble, then the second pit (3 tiles)
//   last cars a compact and the level's one muddy sedan, penned in a lane between two vacuum
//             islands taller than they are
//   stairs    a token high on a ledge and a diagonal of coins under it: jumping for the low
//             coin knocks a hidden crate out of the air. Two of them make a stair: token 3
//   exit      a second ditch, four wide steel steps, a jump down through a coin arc, the arch
//
// Proved by scripts/maxx/level.mjs (lint, reach, expect, fuzz) and scripts/maxx/solve.mjs;
// the replays are scripts/maxx/replays/mw01-*.json. The solver cannot ride a car roof, so in
// mw01-tokens.json the ticks named in its `ride` field (wash the compact, ride it, up through
// the hatch) were played by a script; every other tick is the solver.
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { LEVEL_META } from './meta'

const meta = LEVEL_META.find((m) => m.id === 'mw01')!

const ROWS = 12

/** A prop of scenery: [column in its beat, row, name in the tiles atlas, mirrored]. */
type Prop = [col: number, row: number, name: string, flip?: boolean]

/** One stretch of the level: `w` tiles wide, the rows given, over two rows of ground unless a row says otherwise. */
interface Beat {
  w: number
  rows: Record<number, string>
  props?: Prop[]
}

const sign = (text: string, range = 88): SpawnSpec => ({ kind: 'sign', props: { text, range } })
const ground = (n: number): string => '#'.repeat(n)

const LEGEND: Record<string, SpawnSpec> = {
  A: sign('WELCOME TO MIGHTY WASH!\n{move} TO RUN. {jump} TO JUMP.', 64),
  D: sign('HOLD {jump} LONGER TO JUMP HIGHER.', 48),
  E: sign('JUMP UP UNDER A WASH CRATE\nTO BUMP IT.', 56),
  F: sign('A DIRTY CAR! HOLD {spray} TO WASH IT.'),
  J: sign('GRIME BLOB. STOMP ON IT OR SPRAY IT.'),
  // Read from the lot only: down in the bay its board would hang over the stage.
  N: sign('A CLEAN CAR IS A STEP. WASH IT AND RIDE ITS ROOF UP.'),
  // Beside the pipe, not in the bay, so its board comes up for whoever stands on the pipe
  // and never over the car ride.
  K: sign('STAND ON THE PIPE. PRESS {down}.', 72),
  '1': { kind: 'pipe', props: { to: 'vault:in', name: 'pipe' } },
  // The bay's compact sets off to the right, away from whoever drops in, and comes back.
  V: { kind: 'car', variant: 'compact', props: { dir: 1 } },
  // Tokens are numbered in the order a player meets them: the stage, the vault, the hidden stair.
  '7': { kind: 'token', props: { index: 0 } },
  '9': { kind: 'token', props: { index: 2 } },
  // The last two cars set off from the far end of their lane together, once Maxx is at the near
  // island, so he meets them head on with room to wash them, not as he climbs over it. Placed
  // cars there would start a screen earlier; one spawner would send the sedan a few seconds
  // after the compact, onto whoever had run on that far.
  '6': { kind: 'spawner', props: { variant: 'compact', count: 1, range: 64, delay: 0 } },
  '8': { kind: 'spawner', props: { variant: 'sedan', count: 1, range: 96, delay: 0 } },
}

/** Legend characters handed to scenery, one per prop name (and mirror), in the order they are first used. */
const PROP_CHARS = 'QRSTYZaelmqx02345&()+,-./:;[]_{}'

const START: Beat = {
  w: 13,
  rows: {
    7: '        oo',
    8: '       o  o',
    9: '  @A    ## D',
  },
  props: [
    [0, 9, 'balloons'],
    [5, 9, 'banner_grand'],
    [8, 8, 'bush'],
    [10, 9, 'flag'],
    [12, 9, 'flag'],
  ],
}

// The raised bed is two tiles up: a tap will not do it.
const PLANTER: Beat = {
  w: 15,
  rows: {
    3: '    o',
    4: '    ?  C?B',
    7: ' E',
    8: ground(15),
    9: ground(15),
  },
  props: [
    [3, 7, 'grass'],
    [11, 7, 'sign_mw'],
    [14, 7, 'tube_man'],
  ],
}

// From here to the stage the lot is one step higher than where the level began. The ditch
// comes first: the same jump as the pit, and falling short of it costs nothing. The pit is
// the level's first way to lose a life, so it says so: cones on both lips, sludge below.
const GAPS: Beat = {
  w: 14,
  rows: {
    5: '   oo    oo',
    6: '  o  o  o  o',
    9: '###  ####  ###',
    10: '#########~~###',
    11: '#########~~###',
  },
  props: [
    [0, 8, 'trash_can'],
    [6, 8, 'light_pole'],
    [8, 8, 'cone'],
    [11, 8, 'cone'],
    [13, 8, 'grass'],
  ],
}

const LANE: Beat = {
  w: 20,
  rows: {
    8: ' F               c',
    9: ground(20),
  },
  props: [
    [4, 8, 'menu_board'],
    [7, 8, 'kiosk'],
    [9, 8, 'sign_open'],
    [11, 8, 'cone'],
    [14, 8, 'cone'],
    [19, 8, 'light_pole'],
  ],
}

// The first blob walks on flat ground, with room to stand off and spray it. (A planter to meet
// it from was tried: water from its top flies over the blob, and whoever hops it lands on the blob.)
const BLOB: Beat = {
  w: 21,
  rows: {
    4: '           o o o',
    5: '             b     !',
    6: '           =====',
    8: ' J      b',
    9: ground(21),
  },
  props: [
    [4, 8, 'mesquite'],
    [10, 8, 'grass'],
    [17, 8, 'cactus'],
    [20, 8, 'bush'],
  ],
}

// The checkpoint is column 88 of 176, just past the middle, three tiles before the bay.
const FLAG: Beat = {
  w: 9,
  rows: {
    7: '    *',
    8: '     kN',
    9: ground(9),
  },
  props: [
    [0, 8, 'vacuum'],
    [2, 8, 'vacuum'],
    [8, 8, 'balloons'],
  ],
}

// The bay is two tiles under the lot, so the wall that turns the compact round is taller than
// the car: nobody standing on the lot's edge is touched by it. The deck is five tiles over the
// bay floor: two pixels more than any jump from the ground. The posts stand three tiles higher
// still, six over the lot and over the pipe, so nothing comes in over the side, and the token
// sits over the solid half of the deck, where a head poked up through the hatch from the floor
// cannot touch it. The wall on the left and the drain pipe on the right turn the compact
// round, so once it is washed it is a ride that never leaves.
const STAGE: Beat = {
  w: 12,
  rows: {
    2: ' o     o',
    3: ' X     X',
    4: ' X     X',
    5: ' Xoo  7X  oo',
    6: ' X===XXX  oo',
    7: ' |     |  oo',
    8: ' |     |  1',
    9: ' |     |  PP',
    10: ' |  V  |  PP',
  },
  props: [
    [4, 4, 'banner_grand'],
    [9, 10, 'cone'],
  ],
}

// A bubble mends a pip lost to the bay's car before the jump. The coins on the far bank lead on,
// away from the lip, to a landing four tiles long that no car can reach.
const PIT_TWO: Beat = {
  w: 11,
  rows: {
    6: '      ooo',
    7: '     o   o',
    8: ' *',
    9: 'K',
    10: '######   ##',
    11: '######~~~##',
  },
  props: [
    [2, 9, 'light_pole'],
    [3, 9, 'bush'],
    [5, 9, 'cone'],
    [9, 9, 'cone'],
  ],
}

// The climax: a compact and the level's one muddy sedan in a lane between two vacuum islands.
// The islands are two tiles high, taller than a car, so the cars turn round at them and stay in
// the lane: a washed one never carries its rider into the pit, a dirty one never knocks anyone
// into it, a car jumped over never follows on to the hidden stair, and none is lost for SPOTLESS.
// The lane is 13 tiles on purpose: at 14 or more the cheapest route in `level.mjs reach` walks
// up to the far island and reports a jump from a stand against it (8/13, every miss inside it).
const LAST_CARS: Beat = {
  w: 22,
  rows: {
    6: '  o o             o o',
    7: 'o',
    8: '  ###             ###',
    9: '  ###  oooo  6  8 ###',
  },
  props: [
    [0, 9, 'flag'],
    [3, 7, 'vacuum'],
    [6, 9, 'air_machine'],
    [14, 9, 'cone'],
    [19, 7, 'vacuum'],
    [21, 9, 'flag'],
  ],
}

const STAIR: Beat = {
  w: 10,
  rows: {
    2: '        9',
    3: '       XXX',
    4: '     o',
    5: '     H',
    6: '  o',
    7: '  H',
    8: '*',
  },
  props: [
    [0, 9, 'bush'],
    [8, 9, 'mesquite'],
  ],
}

// A ditch like the first one, then four wide steel steps and the jump down to the arch. The
// ditch keeps the steps clear of the token ledge (two tiles nearer, and the third step would be
// a way onto it) and makes the first step a running jump. Over the top step, for whoever jumps
// up there for the fun of it, a hidden crate with a 1UP.
const EXIT: Beat = {
  w: 29,
  rows: {
    2: '               h',
    4: '                 o',
    5: '            o     o',
    6: '         o    XXX  o',
    7: ' oo  o     XXXXXX',
    8: 'o  o    XXXXXXXXX',
    9: '    XXXXXXXXXXXXX     G',
    10: '    #########################',
  },
  props: [
    [20, 9, 'balloons'],
    [24, 9, 'balloons'],
    [26, 9, 'tube_man'],
    [28, 9, 'flag'],
  ],
}

const BEATS: Beat[] = [START, PLANTER, GAPS, LANE, BLOB, FLAG, STAGE, PIT_TWO, LAST_CARS, STAIR, EXIT]

/** The beats side by side, and their scenery set down in blank tiles under legend characters of its own. */
function build(beats: Beat[], legend: Record<string, SpawnSpec>): { rows: string[]; legend: Record<string, SpawnSpec> } {
  const grid: string[][] = Array.from({ length: ROWS }, () => [])
  const out: Record<string, SpawnSpec> = { ...legend }
  const chars = new Map<string, string>()
  let next = 0
  let x0 = 0
  for (const beat of beats) {
    for (let y = 0; y < ROWS; y++) {
      const row = (beat.rows[y] ?? (y >= ROWS - 2 ? ground(beat.w) : '')).padEnd(beat.w).slice(0, beat.w)
      grid[y].push(...row)
    }
    for (const [col, row, name, flip] of beat.props ?? []) {
      const key = flip ? `${name}|flip` : name
      let ch = chars.get(key)
      if (!ch) {
        ch = PROP_CHARS[next++]
        if (!ch) continue
        chars.set(key, ch)
        out[ch] = { kind: 'decor', props: { sprite: `decor_${name}`, flip: !!flip } }
      }
      // Scenery never takes a tile something else stands in.
      if (grid[row][x0 + col] === ' ') grid[row][x0 + col] = ch
    }
    x0 += beat.w
  }
  return { rows: grid.map((r) => r.join('')), legend: out }
}

const main: AreaDef = { id: 'main', theme: meta.theme, ...build(BEATS, LEGEND) }

// The vault under the lot: the company's initials in wash tokens, and gold on the shelf over
// the way out. The shelf is three tiles over the pipe, not four: this is the generous token,
// and a jump let go a little early still gets there.
const vault: AreaDef = {
  id: 'vault',
  theme: 'bonus',
  music: 'bonus',
  rows: [
    '%%%%%%%%%%%%%%%%%%%%',
    '%                  %',
    '%    a      a      %',
    '%        e         %',
    '%               8  %',
    '%   o   o o   o====%',
    '%   oo oo o o o oo %',
    '%3  o o o oo oo 4  %',
    '%PP o   o o   o PP %',
    '%PPl          l PP %',
    '####################',
    '####################',
  ],
  legend: {
    '3': { kind: 'marker', props: { name: 'in' } },
    '4': { kind: 'pipe', props: { to: 'main:pipe' } },
    '8': { kind: 'token', props: { index: 1 } },
    a: { kind: 'decor', props: { sprite: 'decor_chandelier' } },
    e: { kind: 'decor', props: { sprite: 'decor_crest' } },
    l: { kind: 'decor', props: { sprite: 'decor_plant' } },
  },
}

/**
 * What must be true of this level, checked by `node scripts/maxx/level.mjs expect mw01`.
 * Token numbers are props.index + 1; columns and rows are those of the rows above.
 */
export const EXPECT: string[] = [
  'fair goal with hover=off                    # nobody needs the hover in level 1',
  'reach goal within 60s',
  'reach checkpoints, area:vault, blocks',
  'not token1 unless cars=roofs                # the stage: only from the roof of a washed compact',
  'not @93-99,1-5 unless cars=roofs            # ... its deck and its post tops too, against every hover',
  'fair token1 with cars=roofs, hover=off      # and from that roof a plain jump does it',
  'fair token2 with hover=off                  # the vault under the drain pipe: no trick needed',
  'not token3 unless hidden=on                 # the hidden-block staircase',
  'not @144-146,2 unless hidden=on             # ... and the ledge it leads to',
  'fair token3 with hidden=on, hover=off',
  'not token3 with cars=roofs                  # no car roof stands in for the hidden crates',
  'reach tokens, coins with all',
]

const level: LevelDef = { id: meta.id, site: meta.site, name: meta.name, time: meta.time, music: meta.music, areas: [main, vault] }

export default level
