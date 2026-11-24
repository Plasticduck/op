// MW07 SALT STORM: the lot under ice, in a West Texas blue norther. Slick floors nearly
// everywhere, salt-crusted vans, icicles under the covered bays, dryers gusting against the
// run, lifts, narrow icy platforms. The hover is a safety net, never needed on the way to
// the exit. Left to right (columns of the main area, 16 rows, the lot's floor in rows 14-15):
//
//     0  START     salted ground, the pylon sign, a snowman (a hidden 1UP over his head)
//    14  RINK      the first ice: crates over it, a blob to slide into, a trough, a short pit
//    34  SALT LOT  the first van, alone on salted ground
//    50  SHELF     narrow ice platforms over a pit; token 1 on a pillar down in the wide gap
//    74  TROUGH    a van shuttling on ice between the shelf and a snowbank
//    86  BAYS      the covered vacuum bays: icicles alone, in a row and over a landing,
//                  then a van penned under the low roof. A hidden block by the mesquite is
//                  the only way onto that roof: coins, and the roof drain down to the vault
//                  (token 2). The vault's way out is the pipe stub in front of the van pen
//   125  CHECK     the checkpoint
//   134  DRYERS    gusts against the run: a van in the wind, a pit, an ice platform
//   171  LIFTS     a lift under a steel gantry, a lift up the cliff (a grime wall hides a
//                  1UP in its foot). Token 3 is on top of the gantry, ten tiles back from
//                  the top of the second lift: too far for the hover as level 2 teaches it,
//                  so the player rides a gust of the norther back to it
//   201  STORM     the climax: ice steps down over a pit, then the exit bay, where the
//                  tunnel's dryers blow down an icy dock and a pen of two vans, all of it
//                  under icicles
//   240  EXIT      the steel stair and the wash exit arch
//
// The vault is a bonus room under the bays' roof. Blowers and blobs are kept away from the
// roof (the level's secret), and from every place EXPECT calls out of reach, on purpose: the
// level tools cannot see wind or critters. For the same reason token 3's only claim is that it
// can be reached: the tools find it in still air with a hover begun late, and nothing more, but
// in play the norther carries a plain running jump there (scripts/maxx/tests/mw07-gust.mjs plays
// it, wind and all). Every van but the first is penned by
// walls it cannot climb, so SPOTLESS never hangs on one pass.
//
// The roof ends in a tower nobody climbs. It used to end in a drop onto the checkpoint's
// step, and a running jump off it sailed over the flag: the secret cost the checkpoint.
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { LEVEL_META } from './meta'

const meta = LEVEL_META.find((m) => m.id === 'mw07')!

const ROWS = 16

/** One stretch of the main area, `width` tiles wide: only the rows that hold something are given. */
function sec(width: number, rows: Record<number, string>): string[] {
  const out: string[] = []
  for (let y = 0; y < ROWS; y++) out.push((rows[y] ?? '').padEnd(width).slice(0, width))
  return out
}

function sideBySide(sections: string[][]): string[] {
  const rows: string[] = Array.from({ length: ROWS }, () => '')
  for (const section of sections) for (let y = 0; y < ROWS; y++) rows[y] += section[y]
  return rows
}

const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })
const decor = (name: string, flip = false): SpawnSpec => ({ kind: 'decor', props: { sprite: `decor_${name}`, flip } })
const gust = (force: number, w: number, h: number, on: number, off: number, phase = 0): SpawnSpec => ({
  kind: 'blower',
  props: { force, w, h, on, off, phase },
})

const LEGEND: Record<string, SpawnSpec> = {
  A: sign('BLACK ICE. YOU SLIDE,\nSO BRAKE EARLY.'),
  D: sign('DO NOT STOP UNDER AN ICICLE.\nHOLD {up} AND {spray} TO DROP IT FIRST.'),
  E: sign('THE DRYERS GUST. JUMP IN THE LULL AND LEAN INTO THE WIND.'),
  '7': { kind: 'token', props: { index: 0 } },
  '9': { kind: 'token', props: { index: 2 } },
  '0': { kind: 'oneup' },
  N: { kind: 'turbo' },
  // The van that never got dry: parked at the far end of the exit bay, out of reach of the dock.
  F: { kind: 'car', variant: 'van', props: { speed: 0 } },
  '1': { kind: 'pipe', props: { to: 'vault:in' } },
  '8': { kind: 'marker', props: { name: 'bays' } },
  J: { kind: 'lift', props: { dx: 4, speed: 90, wait: 60, w: 3 } },
  K: { kind: 'lift', props: { dy: -5, speed: 80, wait: 60, w: 2 } },
  // The dryers: force, zone width and height in tiles, ticks of wind, ticks of calm, phase.
  Q: gust(-120, 6, 3, 80, 100),
  R: gust(-150, 7, 4, 80, 100, 30),
  // S blows over the whole 4-wide platform between its two pits, so its gusts are short: a
  // player who stops there to time the next jump is pushed back 2 tiles by a gust, not
  // straight into the pit behind him.
  S: gust(-90, 11, 4, 45, 110, 60),
  // The tunnel's own dryers stand on the exit stair and blow the whole bay: the pen and the dock.
  T: gust(-90, 20, 3, 70, 110),
  // The norther itself, high over the dock, gusting back toward the gantry: token 3's ride.
  // Weather, not a dryer, because the machine would have to stand in lift K's shaft. The wind
  // stops a tile short of the lift, so a rider standing at its edge is never blown off, and its
  // floor line is half a tile above the head of the highest jump off the dock or lift J.
  // Phase 155: on a run from the start or a retry lift K reaches the top in calm air, the gust
  // spins up 15 ticks later and blows from 35, and the lift leaves at 60 (its 360-tick trip is
  // two gusts). A plain jump must meet the gust's first 40 ticks or so; with the hover, any of
  // it will do. A visit to the vault stops the lift meanwhile, so after one any gust may meet
  // the lift; the cliff's lip, with the hover, is the way that waits for no lift.
  '/': { kind: 'blower', props: { force: -210, w: 9, h: 6, on: 80, off: 100, phase: 155, machine: false } },
  ';': sign('UP TOP, A GUST CAN CARRY YOU\nBACK TO THE GANTRY.'),
  a: decor('snowman'),
  e: decor('salt_pile'),
  m: decor('mesquite_bare'),
  q: decor('snowdrift'),
  x: decor('light_pole'),
  l: decor('power_pole'),
  Y: decor('sign_mw'),
  V: decor('kiosk'),
  Z: decor('cone'),
  '2': decor('arch_tunnel'),
  '3': decor('sign_exit'),
  '4': decor('mat_rack'),
  '5': decor('vacuum'),
  '6': decor('vacuum_arch'),
  '+': decor('pumpjack'),
  '&': decor('windsock', true),
}

// 0: salted ground, so the first steps have grip.
const START = sec(14, {
  10: '         h    ',
  13: ' m@  Y   a q x',
  14: '##############',
  15: '##############',
})

// 14: the first ice. Braking too late at its end costs nothing the first time: the first dip
// is a trough one tile deep with ice in it, hopped out of. The second, past the island, is the
// real pit. (Both were pits; the opening beat then held the level's two tightest jumps.)
const RINK = sec(20, {
  10: '     ?!?            ',
  11: '                  o ',
  12: '            oo   o o',
  13: 'A  ooooo  b    q    ',
  14: '#IIIIIIIIIII  III   ',
  15: '############II###   ',
})

// 34: the first van, alone, on salt.
const SALT_LOT = sec(16, {
  10: '   ?C?          ',
  13: ' e  Z  Z  l   n ',
  14: '################',
  15: '################',
})

// 50: an ice shelf, then platforms; token 1 stands on a pillar down in the wide gap.
const SHELF = sec(24, {
  10: '        o      ooo      ',
  11: '     b o o    o   o     ',
  12: '   IIII   IIII     III  ',
  13: '  I####   ####  7  ###  ',
  14: 'II#####   ####  I  ###II',
  15: '#######   ####  #  #####',
})

// 74: the trough: a van shuttles between the shelf's last block and a snowbank.
const TROUGH = sec(12, {
  12: '          * ',
  13: '  e    n  ##',
  14: 'IIIIIIIIII##',
  15: '############',
})

// 86: the covered bays. The hidden block at column 5 is the only way onto the roof, and the
// roof drain (the pipe through the slab) the only way off it but back. The tower is 6 tiles
// over the roof, one more than anything on foot climbs. The pipe stub under the roof is where
// the vault lets out: an arrival only, in front of the van pen and before the checkpoint.
const BAYS = sec(39, {
  1: '                                    %%%',
  2: '                                    %%%',
  3: '                                    %%%',
  4: '                                    %%%',
  5: '                                oo  %%%',
  6: '      o oooooo  a      oooooo   1   %%%',
  7: '       %%%%%%%%%%%%%%%%%%%%%%%%%PP%%%%%',
  8: '       %%%%%%%%%%%%%%%%%%%%%%%%%PP%%%%%',
  9: '     o %%%%%%%%%%%%%%%%%%%%%%%%%PP%%%%%',
  10: '     H |  i   i  i |i   i             |',
  11: '       |           |                  |',
  12: '       |      o  o |o     8           |',
  13: ' D m   |   5   4   |      PP    6 n   |',
  14: '#######IIIIIIIIIIIIIII  II##IIIIIIIIIII',
  15: '######################  ###############',
})

// 125: a step up out of the bays, so the penned van stays penned. The flag stands where a
// hop out of the pen lands.
const CHECK = sec(9, {
  12: '  k V * E',
  13: '#########',
  14: '#########',
  15: '#########',
})

// 134: three dryers. Q gusts down a rink at a van, R across a pit, S over an ice platform.
const DRYERS = sec(37, {
  11: ' o                   o      o      o ',
  12: 'o o             %%  o o    o o    o o',
  13: '    & oooo Q n  %%       R           ',
  14: '   IIIIIIIIIIIII##II   IIII   IIII   ',
  15: '   #################   ####   ####   ',
})

// 171: the breather between the dryers and the climax. A lift under a steel gantry, a lift up
// the cliff. No icicle hangs over the lift: a rider cannot step out from under one, and the
// knock of a hit throws him off into the pit.
// Token 3 sits on the gantry, ten open tiles back from lift K's top: a hover held from the top
// of the jump falls short, a gust of the norther carries even a plain running jump. The
// gantry's far end stands on a leg over the dock: a rider who falls short meets its face and
// drops to the dock, never under the gantry into lift J's pit. The coins mark the ride, and the
// windsock on the cliff points the way it blows. The sign stands a tile back from lift K, so
// its board is gone before anyone rides up through it.
const LIFTS = sec(30, {
  3: '                  o o         ',
  4: '                o     o       ',
  5: '              o               ',
  6: '                       /      ',
  7: '      9                   &ooN',
  8: '      XXXXXXXX            IIII',
  9: '      XXXXXXXX            ####',
  10: '             X            ####',
  11: '             X            ####',
  12: '             |            g  #',
  13: ' S q    o o o|  a  + ;  K go0#',
  14: '###### J     IIIIIIIIIIIII####',
  15: '######       #################',
})

// 201: the climax. Ice steps down over a pit, then the exit bay: the dock and the van pen
// under one roof, icicles over both, the tunnel's dryers (on the exit stair) blowing down it.
// One van drives and comes to the dock; the other is parked by the stair, further than water
// reaches from the dock, with the pen's icicles over the place to wash it from.
const STORM = sec(39, {
  6: '                    %%%%%%%%%%%%%%%%%% ',
  7: '                    %%%%%%%%%%%%%%%%%% ',
  8: '  o                 %%%%%%%%%%%%%%%%%% ',
  9: ' o o                |i  i  i  i  i   | ',
  10: '   III o            |              3 | ',
  11: '   ###o o   o       |o  o            | ',
  12: '   ###   IIo o      |  b             | ',
  13: '   ###   ##   q*2 IIIIIIII oo  n   F | ',
  14: '   ###   ##   ############IIIIIIIIIIIII',
  15: '   ###   ##   #########################',
})

// 240: three tiles shorter than it was (two coins on the walk to the arch), to give the
// gantry's dock room and keep the level's length, and so its clock per tile, what it was.
const EXIT = sec(11, {
  11: '  x G  m a ',
  12: 'oT#########',
  13: 'XX#########',
  14: '###########',
  15: '###########',
})

const main: AreaDef = {
  id: 'main',
  theme: 'winter',
  rows: sideBySide([START, RINK, SALT_LOT, SHELF, TROUGH, BAYS, CHECK, DRYERS, LIFTS, STORM, EXIT]),
  legend: LEGEND,
}

// Under the bays' roof: the way in is the roof drain, the way out the pipe up into the bays.
const vault: AreaDef = {
  id: 'vault',
  theme: 'bonus',
  music: 'bonus',
  rows: [
    '%%%%%%%%%%%%%%%%%%%%%%',
    '%         c          %',
    '%                    %',
    '%  2      o          %',
    '% ===    o8o    ooo  %',
    '%         o          %',
    '%  ooo   ===   ===   %',
    '%                3   %',
    '%  ==  *   oooo  PP  %',
    '%p        r r    PP p%',
    '######################',
    '######################',
  ],
  legend: {
    '2': { kind: 'marker', props: { name: 'in' } },
    '3': { kind: 'pipe', props: { to: 'main:bays' } },
    '8': { kind: 'token', props: { index: 1 } },
    c: decor('chandelier'),
    p: decor('plant'),
    r: decor('rope_barrier'),
  },
}

/** What must be true of this level: `node scripts/maxx/level.mjs expect mw07`. */
export const EXPECT: string[] = [
  'fair goal with hover=off                               # the hover is a safety net: the way out never needs it',
  'reach goal within 80s',
  'reach checkpoints',
  'reach tokens with all',
  'fair token1 with hover=off                             # token 1: in plain sight on the pillar down in the wide gap',
  'not token2 unless hidden=on                            # token 2: the vault, down the drain on the bays roof',
  'not area:vault unless hidden=on',
  'not @93-121,6 unless hidden=on                         # the bays roof: only by the hidden block beside the mesquite',
  'not @93-121,6 with grime=washed,gates=open,cars=roofs  # ... not off a washed van either',
  'not @122-124,0 with all                                # the tower at the end of the roof: nobody leaves the roof past the flag',
  'reach token3 with hover=held                           # token 3: in still air only a hover begun late off lift K reaches the gantry; in play a gust carries a plain jump',
  'not @198-199,13 unless grime=washed                    # the 1UP in the foot of the cliff, behind the salt crust',
  'not @221-238,5 with all                                # nobody walks over the roof of the exit bay',
]

const level: LevelDef = { id: meta.id, site: meta.site, name: meta.name, time: meta.time, music: meta.music, areas: [main, vault] }

export default level
