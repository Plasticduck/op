// MW05 LUBE PIT: under the lube shop. Three areas:
//
//   pit      (lube, 22 rows) the shop floor up top (feet row 7), the pit under it (feet row 18)
//   cellar   (bonus) the stash behind the grime wall of the service tunnel
//   street   (highway, dusk) the short walk from the drain pipe to the exit arch
//
// The pit, left to right (columns):
//
//     0  FRONT SHOP    the start, the first oil slick
//    18  BAY ONE       a drip, a sedan in a bay; in the rock under it the alcove of token 1
//                      (it opens on shaft one) and the service tunnel to the grime wall and
//                      the cellar pipe (token 2)
//    42  SHAFT ONE     the lift down (or just drop); across the hole a loft with a hidden 1UP
//                      and the grime door of the attic
//    53  THE SUMP      bridges over used oil, drips, a ferry; over it the attic (coins, a chute)
//    87  WAX LINE      up two steps to the deck, three jets in a wave, the checkpoint
//   105  LOWER BAYS    an SUV on an oil slick; a sedan that rolls off the rack above bay three
//   147  HOT SHAFT     two lifts, a jump over a pool of used oil, an oily terrace with a jet;
//                      token 3 in the alcove at the top left (a hover from the top lift)
//   162  TOP BAY       an SUV, oil, two drips; the drain pipe out
//
// No critters and no blowers anywhere (the level tools see neither), so what the map says
// about the secrets holds in play. A car turns round at a one-tile step, so every bay (a tile
// or two below the floor around it) keeps its car. The camera shows three tiles under his
// feet at least: every long drop here lands on plain floor, sludge lies only one tile under
// the bridges, and the pool of the hot shaft is seen from the deck before the lift carries
// him beside it.
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { LEVEL_META } from './meta'

const meta = LEVEL_META.find((m) => m.id === 'mw05')!

/** Lay sections side by side; short rows are padded to their section's width. */
function sideBySide(sections: string[][]): string[] {
  const rows: string[] = sections[0].map(() => '')
  for (const section of sections) {
    const width = Math.max(...section.map((row) => row.length))
    for (let y = 0; y < rows.length; y++) rows[y] += (section[y] ?? '').padEnd(width)
  }
  return rows
}

const G = (n: number): string => '#'.repeat(n)
const W = (n: number): string => '%'.repeat(n)
const times = (n: number, row: string): string[] => Array.from({ length: n }, () => row)

type Props = Record<string, number | string | boolean>
const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })
const decor = (name: string, flip = false): SpawnSpec => ({ kind: 'decor', props: { sprite: `decor_${name}`, flip } })
const lift = (props: Props): SpawnSpec => ({ kind: 'lift', props })
const token = (index: number): SpawnSpec => ({ kind: 'token', props: { index } })
const jet = (props: Props): SpawnSpec => ({ kind: 'jet', props })

const PIT_LEGEND: Record<string, SpawnSpec> = {
  A: sign('THE LUBE PIT. MIND THE OIL.'),
  T: token(0),
  Y: token(2),
  // Shaft one: down ten rows to the pit and back.
  '1': lift({ dy: 10, speed: 80, wait: 50 }),
  // The sump's ferry.
  '2': lift({ dx: 4, speed: 80, wait: 50 }),
  // The hot shaft: 4 from the deck to the oily terrace, 3 from the terrace to the shop floor.
  '4': lift({ dy: -4, speed: 80, wait: 80 }),
  '3': lift({ dy: -4, speed: 80, wait: 80 }),
  // The cars down here wear used oil over their road dirt and come off the lifts in a hurry:
  // each takes longer to wash than one of its kind upstairs (an SUV as long as a pickup) and
  // drives a little faster, so a bay with oil underfoot asks more of him than MW04's road did.
  s: { kind: 'car', variant: 'sedan', props: { dirt: 26, speed: 70 } },
  v: { kind: 'car', variant: 'suv', props: { dirt: 36, speed: 75 } },
  '6': { kind: 'pipe', props: { name: 'nook', to: 'cellar:in' } },
  '7': { kind: 'pipe', props: { to: 'street:up' } },
  D: { kind: 'drip', props: { phase: 50 } },
  // The wax line runs at him: the far jet fires first, so a dash that starts as the near one stops gets through.
  J: jet({ phase: 100 }),
  K: jet({ phase: 50 }),
  // Under the rack of bay three.
  V: jet({ len: 5 }),
  // On the oily terrace of the hot shaft: short bursts, so one stop of the lift always has a gap.
  '&': jet({ dir: 'up', len: 3, off: 90, on: 40, phase: 40 }),
  l: decor('lamp_hang'),
  N: decor('neon_open'),
  S: decor('sign_lube'),
  F: decor('window'),
  E: decor('sign_exit'),
  e: decor('oil_shelf'),
  a: decor('tool_rack'),
  m: decor('tool_chest'),
  q: decor('lift_post'),
  x: decor('cone'),
  p: decor('pipes_wall'),
  '0': decor('oil_drum'),
  '5': decor('oil_cans'),
  '8': decor('floor_jack'),
  '9': decor('hose_reel'),
  ';': decor('tire_pile'),
  '+': decor('stencil_employees'),
}

// 0: the front of the shop. Nothing here bites: the oil is for sliding on.
const FRONT = [
  W(18),
  W(18),
  '%',
  '%     F',
  '%  l      N    l',
  '%',
  '%            ooo',
  '% @ A S  e  x   x',
  '#############OOO##',
  ...times(13, G(18)),
]

// 18: bay one, a tile below the shop floor. In the rock under it: the alcove of token 1,
// opening on shaft one (rows 11-13), and the service tunnel (rows 16-18) that runs left from
// the foot of the shaft to the grime wall and the cellar pipe.
const BAY_ONE = [
  W(24),
  W(24),
  ' d',
  '            ooo',
  '        l   ?!?       l',
  '',
  '',
  '  a m   ooo          9 x',
  '#######       q s q#####',
  ...times(2, G(24)),
  '####################',
  '#################### Too',
  '####################',
  G(24),
  '######    ##############',
  '######    gg +',
  '###### 6  gg   o o o',
  '###### PP gg         p #',
  ...times(3, G(24)),
]

// 42: shaft one. The lift fills the left three columns of the hole.
const SHAFT_ONE = [
  W(11),
  W(11),
  '          %',
  '          %',
  '       h  %',
  '  oo   o  %',
  ' o  o     g',
  '        5 g',
  ' 1   ######',
  '     ######',
  '          %',
  '   oo     %',
  '          %',
  '   oo',
  '',
  '   oo',
  '',
  '   oo',
  '       0 ;',
  ...times(3, G(11)),
]

// 53: the sump, under a hanging mass (rows 8-12). Over the mass, the attic and its chute.
const SUMP = [
  ...times(4, W(34)),
  '%',
  '%',
  'g    o o o o o o o o o o o o',
  'g 0 o o o o o o o o o o o o o ;',
  G(32) + '  ',
  G(32) + 'o ',
  W(32) + '  ',
  W(32) + ' o',
  W(32) + '  ',
  '          d        D',
  '                                o',
  '  l   o      ooo              l',
  '     o o    o   o      oooo',
  '',
  ' x',
  '###==   ====     ==== 2     ===###',
  ...times(2, '###' + '~'.repeat(28) + '###'),
]

// 87: up two steps to the deck: the wax line, then the checkpoint.
const WAX_LINE = [
  ...times(10, W(18)),
  ...times(3, W(14)),
  '    j   J   K   C!',
  '',
  '      o   o',
  '  x            k',
  ' #################',
  ...times(4, G(18)),
]

// 105: the lower bays, two tiles under the deck. The sedan on the rack wakes as he climbs out
// of bay two and rolls off its left end into bay three. In the rock over the far end: the
// alcove of token 3 (rows 5-7) and its chute back down.
const LOWER_BAYS = [
  ...times(5, W(42)),
  ...times(2, W(39)),
  W(39) + ' oY',
  W(39) + 'o%%',
  W(39) + ' %%',
  '  %%%%',
  '  %%%%',
  '  %%%%   l                       s ooo',
  '   d              W             XXXXXX',
  '                                  V',
  '',
  '',
  '#     oooo       ###                   ###',
  '#8         q v q ###    a             ;###',
  G(6) + 'OOOO' + G(32),
  ...times(2, G(42)),
]

// 147: the hot shaft. Lift 4 leaves level with the deck; walking off the deck under it as it
// rises drops him in the dry pocket behind the kerb, not in the oil. Then a jump over the pool
// of used oil to the oily terrace (five tiles over the kerb: no way up but the lift), and lift 3
// to the shop floor. The steel post at the end of token 3's ledge (row 7) keeps a player who
// walks away from the token from stepping off into the pool, eleven rows down and off screen;
// the way home is the chute at 144. Row 1 is open so the hover jump to it never scrapes the roof.
const HOT_SHAFT = [
  W(15),
  '%',
  '%',
  '%',
  '%      l',
  '',
  '     o o o',
  'o  X',
  '%XXX',
  '%            o',
  '',
  '             o',
  '           & 3',
  '       OO######',
  '  o    ########',
  '       ########',
  'x o    ########',
  '# 4    ########',
  '#  #   ########',
  ...times(3, '####~~~########'),
]

// 162: the top bay and the way out.
const TOP_BAY = [
  W(31),
  W(31),
  '        %%%    %%%            %',
  '        %%%    %%%      F E   %',
  '  l     %%%  l %%%   l        %',
  '         d      D         7   %',
  '                          PP  %',
  ' e   m     oooo         x PP  %',
  '######          q v q #########',
  G(11) + 'OOOO' + G(16),
  ...times(12, G(31)),
]

const pit: AreaDef = {
  id: 'pit',
  theme: 'lube',
  rows: sideBySide([FRONT, BAY_ONE, SHAFT_ONE, SUMP, WAX_LINE, LOWER_BAYS, HOT_SHAFT, TOP_BAY]),
  legend: PIT_LEGEND,
}

const cellar: AreaDef = {
  id: 'cellar',
  theme: 'bonus',
  music: 'bonus',
  rows: [
    '%%%%%%%%%%%%%%%%%%%%%%%%',
    '%                      %',
    '%     c          c     %',
    '%         ooooo        %',
    '%        o     o       %',
    '%   r       T      r   %',
    '%         =====        %',
    '%  6   oo       oo     %',
    '%  PP ====     ====    %',
    '%  PP  p  ooooo   p v  %',
    G(24),
    G(24),
  ],
  legend: {
    T: token(1),
    '6': { kind: 'pipe', props: { name: 'in', to: 'pit:nook' } },
    c: decor('chandelier'),
    r: decor('portrait'),
    p: decor('plant'),
    v: decor('vault_door'),
  },
}

const street: AreaDef = {
  id: 'street',
  theme: 'highway',
  rows: sideBySide([
    [
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '     8',
      '     PP      o o o o',
      ' ,Z  PP y   E   m  , c  s  Y  G   t ,',
      G(38),
      G(38),
    ],
  ]),
  legend: {
    '8': { kind: 'marker', props: { name: 'up' } },
    s: { kind: 'car', variant: 'sedan', props: { dirt: 26, speed: 70 } },
    Z: decor('sign_mw'),
    E: decor('sign_highway'),
    Y: decor('light_pole'),
    m: decor('mesquite'),
    y: decor('yucca'),
    c: decor('cactus'),
    t: decor('tube_man'),
    ',': decor('dry_grass'),
  },
}

/** What must stay true of this level: `node scripts/maxx/level.mjs expect mw05`. */
export const EXPECT: string[] = [
  'fair goal with hover=off              # the way out never asks for the hover',
  'reach goal within 170s',
  'reach checkpoints',
  'fair token1 with hover=off            # the alcove beside the first lift: a step off the lift as it passes',
  'not token2 unless grime=washed        # the cellar, behind the grime wall of the service tunnel',
  'reach token2 with grime=washed,hover=off',
  'not area:cellar unless grime=washed',
  'not @54-84,7 unless grime=washed      # the attic over the sump, behind the loft grime',
  'not @54-84,7, area:cellar with hidden=on,cars=roofs  # ... and no bumped crate or car roof gets round a grime wall',
  'reach token3 with hover=top           # the alcove over the hot shaft: the hover as level 2 taught it',
  'not token3 with all,hover=off         # ... and never without it, even off a parked car roof or a bumped crate',
  'reach tokens with all',
  'reach coins with grime=washed         # every coin can be had',
]

const level: LevelDef = { id: meta.id, site: meta.site, name: meta.name, time: meta.time, music: meta.music, areas: [pit, cellar, street] }

export default level
