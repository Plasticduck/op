// MW04 MUD SEASON: a week of rain has turned the back lot of the wash into a swamp.
// Mud slows the run and saps the jump, sludge fills the low spots, pickups fling clods,
// and at the end of the yard MUDSLINGER is waiting. Left to right (first column of each):
//
//     0  THE LOT      the safe start: crates (a hidden 1UP over them), a sedan and a compact
//    27  MUD          the first mud and a blob in it, a dry ledge out, token 1 over the mud
//                     (jump back for it from the ledge), then the first sludge pit, jumped
//                     from mud
//    57  THE ROAD     the first pickup, alone on a flat road between two berms (coins up high
//                     for whoever rides its washed roof)
//    76  UNDER FIRE   a wider pit from mud, then a long mud crossing with a parked pickup
//                     lobbing clods at it (its range starts three tiles past the pit, so a
//                     hit there does not knock Maxx back into the sludge)
//   103  THE PLAZA    high and dry: a bubble; a drain on a tower five tiles up, and one
//                     hidden block under a lone coin: the storm cellar, token 2
//   117  THE YARD     a grime wall to wash through, a pack of blobs behind it, a grime window
//                     to aim up at, then an SUV penned between the window and a berm; the
//                     checkpoint stands on the berm (143), just past the middle
//   145  THE LAKES    a lift walked onto from the berm, a mud island, a lift that stops short
//                     of it (a mud jump onto it), then a dock level with the lift
//   171  THE HILL     tumbleweeds bouncing down the steps into a ditch at its foot; a ledge
//                     with a cave under it (grime)
//   195  THE TRENCH   mud a tile deep, a pickup and a sedan behind it (no car can be jumped
//                     from mud: they must be washed); a plank tower with coins (a hover from
//                     the ledge); the last grime door, a step up out
//   220  THE BAY      a pen of mud behind the door: a trough, then a bench with the power
//                     crate, a bubble and the checkpoint; token 3 on a shelf over the trough,
//                     a running jump from the very lip of the bench. Then the arena exactly as
//                     levels/dev/mudslinger.ts builds it (229-248)
//   249  THE EXIT     the gate rolls up on flag 'mudslinger'; a short walk to the arch
//
// Sludge kills at once and a hit throws Maxx two tiles, so nothing that hits is allowed
// within reach of a sludge lip: no blob shares a floor with a pit (a stomp bounce or a knock
// would carry him in), the pits lie past where a jump off a ledge or berm comes down, and
// the tumbleweeds end in a ditch two tiles deep, short of the lake, and a curb at the brow
// keeps them out of the trench.
//
// What the level tools cannot see is kept away from the secrets: there is no blower in the
// level; the yard's blobs cannot climb onto the plaza and the first blob stays west of the
// ledge at 39; no blob or tumbleweed gets into the trench, and nothing that moves gets into
// the bay (a stomp or a washed roof there would lift Maxx to the shelf); the one car near the
// drain tower is parked ten tiles short of it.
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { LEVEL_META } from './meta'

const meta = LEVEL_META.find((m) => m.id === 'mw04')!

const ROWS = 12

/** One stretch of the level, `width` tiles wide: the rows given, over two rows of ground unless a row says otherwise. */
function section(width: number, rows: Record<number, string>): string[] {
  const out: string[] = []
  for (let y = 0; y < ROWS; y++) out.push((rows[y] ?? (y >= ROWS - 2 ? '#'.repeat(width) : '')).padEnd(width).slice(0, width))
  return out
}

const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })
const decor = (name: string): SpawnSpec => ({ kind: 'decor', props: { sprite: `decor_${name}` } })

const LEGEND: Record<string, SpawnSpec> = {
  A: sign('RAIN ALL WEEK AT MW04. THE BACK LOT IS ALL MUD.'),
  D: sign('MUD IS SLOW AND SAPS YOUR JUMP. LEAP FROM DRY GROUND.'),
  E: sign('PICKUPS FLING MUD. HOLD {up} AND {spray} TO WASH IT FROM THE AIR.'),
  F: sign('GRIME WASHES OFF. HOLD {spray}.\nHOLD {up} TO AIM HIGH.'),
  J: sign('IT REVS, THEN IT CHARGES.\nGET UP ON A CATWALK.'),
  S: { kind: 'mudslinger' },
  '1': { kind: 'gate', props: { flag: 'mudslinger', min: 1, h: 2 } },
  // The first lift docks at both shores; the second stops two tiles short of the mud island
  // and waits there a good second, because the jump onto it is a mud jump.
  '2': { kind: 'lift', props: { dx: 4, speed: 80, wait: 50 } },
  '3': { kind: 'lift', props: { dx: 3, speed: 80, wait: 70 } },
  '4': { kind: 'pipe', props: { to: 'cellar:in', name: 'drain' } },
  '5': { kind: 'token', props: { index: 0 } },
  '7': { kind: 'token', props: { index: 2 } },
  '8': { kind: 'blob', props: { dir: 1 } },
  // A pickup that stays where it is parked and throws from there.
  '9': { kind: 'car', variant: 'pickup', props: { speed: 0 } },
  Q: { kind: 'oneup' },
  Z: decor('sign_mw'),
  l: decor('light_pole'),
  m: decor('mesquite'),
  e: decor('rocks'),
  q: decor('sandbags'),
  x: decor('cone'),
  K: decor('power_pole'),
  V: decor('fence'),
  R: decor('trash_can'),
  '+': decor('windsock'),
  Y: decor('flag'),
  N: decor('menu_board'),
}

// prettier-ignore
const LOT = section(27, {
  //  012345678901234567890123456
  2: '             h',
  5: '            ooo',
  6: '            ?C?',
  9: '  @ A  Z  l    qx l  s x c',
})

// The first sludge pit is jumped from mud, with a mud run-up. It lies nine tiles past the
// ledge: the longest leap off the ledge comes down two and a half tiles short of it.
// prettier-ignore
const MUD = section(30, {
  //  012345678901234567890123456789
  4: '         5',
  5: '          o',
  6: '           o             o',
  7: '             e          o o',
  8: '            ###',
  9: 'D  ooo  b   ###  m  ooo',
  10: '##MMMMMMMMMM#######MMMMM~~####',
})

// prettier-ignore
const ROAD = section(19, {
  //  0123456789012345678
  2: '      ooo',
  9: '## E K V V x  p  ##',
})

// Three tiles of dry ground and five of mud before the pit: a jump off the road's berm lands
// well short of it. The parked pickup's range starts three tiles past the pit.
// prettier-ignore
const FIRE = section(27, {
  //  012345678901234567890123456
  6: '         o',
  7: '        o o',
  9: ' x          e ooo+     9  R',
  10: '###MMMMM~~~MMMMMMMMMM######',
})

// The tower stands eight tiles from the yard's wall: from its deck the top of that wall (and
// the open sky above the area) is a tile out of the hover's reach.
// prettier-ignore
const PLAZA = section(14, {
  //  01234567890123
  2: '      oo',
  3: '      4',
  4: '     %PP%',
  5: '  o  |  |',
  6: '  H  |  |',
  7: '     |  |',
  8: '     |  | Y*Fl',
  9: '##############',
})

// prettier-ignore
const YARD = section(28, {
  //  0123456789012345678901234567
  0: '   %%        %%',
  1: '   %%        %%',
  2: '   %%        %%',
  3: '   %%        %%',
  4: '   %%        %%',
  5: '   %%        %%',
  6: '   %%    !   gg',
  7: '   gg        gg',
  8: '   gg        %%           k',
  9: '   ggRb 8 b  %%  xo o v ####',
})

// The shores and the mud island all stand a tile up, level with the lifts' tops: Maxx walks
// from the checkpoint's berm onto the first lift, off it onto the island, and off the second
// lift onto the dock. The one jump is from the island's mud onto the second lift.
// prettier-ignore
const LAKES = section(26, {
  //  01234567890123456789012345
  7: '     ooo          ooo',
  8: ' +                      K',
  9: '### 2     MMMMM   3    ###',
  10: '###~~~~~~~#####~~~~~~~~###',
})

// The tumbleweeds wake as Maxx reaches the dock and bounce down the steps into the ditch at the
// foot of the hill, two tiles deep: there they stay, below both rims (a tumbleweed is 30 px
// and hops 28), so none ever reaches the lake's lip or hits him on the dock. He jumps the ditch.
// A one-tile curb at the brow turns back any he sprays uphill, so none rolls on into the trench.
// prettier-ignore
const HILL = section(24, {
  //  012345678901234567890123
  6: '              w w w#',
  7: '        oooK########  *',
  8: '   ooo #################',
  9: '   ################# oog',
  10: '   #################Qoog',
})

// The pickup wakes only once Maxx is past the lip of the ledge. The sedan follows it: water
// cannot reach it until the pickup is clean. The plank tower is a perch for coins, a hover from
// the ledge, and its deck catches the pickup's low clods over the middle of the lane (the climax
// was tuned with it there).
// prettier-ignore
const TRENCH = section(25, {
  //  0123456789012345678901234
  0: '                       %%',
  1: '                       %%',
  2: '    o                  %%',
  3: '  o   o                %%',
  4: ' o     o               %%',
  5: '                       %%',
  6: '        ooo            %%',
  7: '        %%%            %%',
  8: '        | |            gg',
  9: '        | |            gg',
  10: '        | | oo   p   s ##',
  11: 'MMMMMMMMMMMMMMMMMMMMMMM##',
})

// The bay between the grime door and the arena: a trough a tile deep, then a bench of mud up to
// the arena's doorway, with the bubble, the checkpoint and the hint before the fight, and the
// power crate a row higher than usual so the hint's board never hides it (its top is five tiles
// under the top of the arena wall, too far for any jump). Token 3 sits on a shelf on the inside
// of the grime wall, three tiles over the bench and three across the trough from its lip: the
// highest and the longest jump mud allows at once, so it takes a full run along the bench and a
// jump at the very edge. A dry floor, a car roof or the hill would make it easy, so the two walls
// keep all three out, and the trough floor under the shelf is four tiles down. A miss lands in
// the trough, a hop below the bench.
// prettier-ignore
const BAY = section(9, {
  //  012345678
  5: '      !',
  6: ' 7o',
  7: '%% o',
  8: '    o',
  9: '     *k J',
  10: '     MMMM',
  11: 'MMMMM####',
})

// The arena, column for column as levels/dev/mudslinger.ts builds it (NOTES.md 9.1).
// prettier-ignore
const ARENA = section(20, {
  //  01234567890123456789
  0: '%                  %',
  1: '%                  %',
  2: '%                  %',
  3: '%                  %',
  4: '%                  %',
  5: '%                  %',
  6: '%                  %',
  7: '%    ===    ===    %',
  9: '                S  1',
})

// prettier-ignore
const EXIT = section(13, {
  //  0123456789012
  9: ' l oo G  N l',
})

const SECTIONS = [LOT, MUD, ROAD, FIRE, PLAZA, YARD, LAKES, HILL, TRENCH, BAY, ARENA, EXIT]

const main: AreaDef = {
  id: 'main',
  theme: meta.theme,
  rows: Array.from({ length: ROWS }, (_, y) => SECTIONS.map((s) => s[y]).join('')),
  legend: LEGEND,
}

// The storm cellar under the plaza: down the drain, a climb to token 2, back up the same drain.
const cellar: AreaDef = {
  id: 'cellar',
  theme: 'bonus',
  music: 'bonus',
  // prettier-ignore
  rows: [
    '%%%%%%%%%%%%%%%%%%%%%%%%',
    '%                      %',
    '%                      %',
    '%                  6   %',
    '%          ooo    ==== %',
    '%                      %',
    '%     ooo  =====       %',
    '%1                   2 %',
    '%PP ======   oooo    PP%',
    '%PP  ooooo           PP%',
    '########################',
    '########################',
  ],
  legend: {
    '1': { kind: 'marker', props: { name: 'in' } },
    '2': { kind: 'pipe', props: { to: 'main:drain' } },
    '6': { kind: 'token', props: { index: 1 } },
  },
}

/** What must be true of this level: `node scripts/maxx/level.mjs expect mw04`. */
export const EXPECT: string[] = [
  'fair goal with grime=washed, gates=open, hover=off   # the whole road: grime washed, MUDSLINGER washed, never the hover, no tight jump',
  'reach goal with grime=washed, gates=open within 60s',
  'not goal with grime=washed unless gates=open         # the arena gate holds until MUDSLINGER is washed',
  'not @122-143 unless grime=washed                     # the yard and everything after it: only through the grime wall',
  'not @122-143 with hidden=on, cars=roofs unless grime=washed   # ... even from the drain tower or a parked roof',
  'reach checkpoints with grime=washed',
  'reach token1                                         # in plain sight over the first mud: a jump back from the dry ledge',
  'not token2 with grime=washed, gates=open, cars=roofs unless hidden=on   # the storm cellar: only up the hidden block',
  'not area:cellar with grime=washed, gates=open, cars=roofs unless hidden=on',
  'not @108-111,3 with grime=washed, gates=open, cars=roofs unless hidden=on   # the drain tower itself',
  'not @120-121 with gates=open, cars=roofs, hidden=on  # nobody stands on top of the yard wall, above the screen: not even from the tower',
  'fair token3 with grime=washed, hover=off             # the shelf in the bay: a running jump at the very lip of the bench, never the hover (5 of 17 take-off ticks)',
  'reach @191-193,10 with grime=washed                  # the cave under the ledge, once its grime is washed',
  'reach tokens with all',
  'reach coins with all                                 # the row-2 coins over the road: from the washed road pickup',
]

const level: LevelDef = {
  id: meta.id,
  site: meta.site,
  name: meta.name,
  time: meta.time,
  music: meta.music,
  areas: [main, cellar],
}

export default level
