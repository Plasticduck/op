// MW03 TUNNEL VISION: the first wash tunnel. Maxx starts on the lot, pushes through the mitter
// curtain at the tunnel mouth and runs the wash stage by stage, as the back wall names them:
//
//   lot        the pylon, the pay lane and the arch; a blob, then a sedan that drives out through
//              the mitter curtain of the tunnel mouth (both sleep until Maxx sets off, so the
//              start is safe however long he stands there); the door is behind the curtain
//   entry      the arch from inside, the mitter curtain, the foam arch (washed cars leave this way)
//   presoak    belts running against him; a duct plugged with grime holds token 1 (the lesson:
//              aim up, grime washes off); then the long belt with a spawner of compacts and sedans
//   foam       slick foam: first a foam bath sunk a tile under the floor, to slide about in with
//              nothing to lose; then a small pit off a slick run-up with a slick landing, then a
//              wider one (or over the catwalk)
//   soft       brushes on rails: one to jump, the checkpoint, a second mitter curtain that hides
//              token 2 in a notch of the ceiling (two crates are the step up), a brush to run
//              under, a fast one with a catwalk and a blob over it
//   rinse      the first SUV, sent down a long flat road as Maxx comes over the wall into it (a
//              hidden 1UP crate hangs over it); the drain pipe at its end leads down to the token
//              vault, where token 3 waits past three top brushes over a belt running against him
//   wax        a sunken bay of hot wax jets: one alone, then a wave of three; a power crate
//   vent       a tire stack under a ceiling vent plugged with grime, coins pointing up: THE SECRET.
//              Wash the plug, bounce through, and Maxx is on the tunnel roof
//   dry        the climax: a belt, sedans and an SUV, a brush and a jet at once
//   exit       the wash exit arch. Behind the wall past it, in plain sight and out of reach: the
//              EMPLOYEES ONLY door. The roof run ends at a hatch that drops into that room
//
// The roof (rows 0 to 4 over the last stretch of the tunnel) is sealed by the ceiling from wall
// to wall: the vent is the only way up, and the hatch the only way into the back room. EXPECT
// below says so against every mode and every hover. No blower and no blob stands anywhere near
// either.
//
// Under the roof run the ceiling is one tile thick, so the roof's floor is row 5 and its end
// walls stand five tiles over it. An area's top edge is open: a four-tile wall there would let a
// running jump stand Maxx on top of it, out of sight above the screen, with the whole length of
// the ceiling open beyond. The thin ceiling also lets a player inside see a strip of the roof and
// its coins over the climax: the tease that sends him looking for a way up.
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { LEVEL_META } from './meta'
import { PROBLEMS, area, decor, join, piece, sign } from './mw03/build'
import type { Piece, Thing } from './mw03/build'

const meta = LEVEL_META.find((m) => m.id === 'mw03')!

/* ------------------------------------------------------------------ */
/* The lot                                                             */
/* ------------------------------------------------------------------ */

const curtain = decor('curtain', { front: true })

const LOT = piece(
  'lot',
  36,
  [
    '',
    '',
    '                                %%%%',
    '                                %%%%',
    '                                %%%%',
    '                           %%%%%%%%%',
    '           ?H?             %%%%%%%%%',
    '                                %%%%',
    '                    oo          %%%%',
    '  @  A     ooo          b T  s  %%%%',
    '####################################',
    '####################################',
  ],
  [
    [1, 9, decor('bush')],
    [3, 9, decor('grass')],
    [8, 9, decor('sign_mw')],
    [10, 9, decor('grass')],
    [14, 9, decor('flag')],
    [15, 9, decor('light_pole')],
    [18, 9, decor('menu_board')],
    [20, 9, decor('cone')],
    [21, 9, decor('kiosk')],
    [23, 9, decor('cone')],
    [25, 9, decor('arch_tunnel')],
    // The mouth of the tunnel, under its canopy: the way in is the door half behind the mitter
    // curtain, hard against the wall so that walking into the wall stands him at it.
    [28, 9, curtain],
    [30, 9, curtain],
    [31, 9, { kind: 'door', props: { to: 'tunnel:in' } }],
    [29, 4, decor('neon_mw')],
  ],
)

const LOT_LEGEND: Record<string, SpawnSpec> = {
  A: sign('MW03. THE WASH TUNNEL IS OPEN. DIRTY CARS FIRST.'),
  T: { kind: 'sign', props: { text: 'PUSH THROUGH THE CURTAIN.\nPRESS {up} AT THE DOOR.', range: 176 } },
}

/* ------------------------------------------------------------------ */
/* The tunnel: 14 rows. Ceiling rows 4-5 (row 5 alone under the roof   */
/* run), floor rows 12-13, so the feet row is 11 inside and 4 on the   */
/* roof. In play the screen shows rows 2.75 to 14 from the floor: row  */
/* 3 peeks out under the HUD, so nothing goes in it; row 2 is hidden   */
/* and row 4 of the roof run shows over the ceiling.                   */
/* ------------------------------------------------------------------ */

const ROWS = 14
const CEILING = [4, 5]
const FLOOR = [12, 13]

/** A stretch of tunnel: ceiling and floor right across unless a row is given. Solid rows must be given whole. */
function tun(name: string, width: number, over: Record<number, string>, things: Thing[] = []): Piece {
  const rows: string[] = []
  for (let y = 0; y < ROWS; y++) {
    const solid = CEILING.includes(y) ? '%' : FLOOR.includes(y) ? '#' : ''
    const row = over[y]
    if (row === undefined) {
      rows.push(solid.repeat(width))
    } else {
      if (solid !== '' && row.length !== width) PROBLEMS.push(`${name}: solid row ${y} must be ${width} wide, it is ${row.length}`)
      rows.push(row)
    }
  }
  return piece(name, width, rows, things)
}

const token = (index: number): SpawnSpec => ({ kind: 'token', props: { index } })
const lamp = decor('lamp_hang')
const skylight = decor('window')

const ENTRY = tun(
  'entry',
  14,
  {
    6: '     %%%%%',
    7: '     %%%%%',
  },
  [
    [1, 11, decor('arch_tunnel')],
    [2, 11, { kind: 'marker', props: { name: 'in' } }],
    [4, 11, decor('cone')],
    [6, 10, curtain],
    [8, 10, curtain],
    [12, 11, decor('foam_arch')],
  ],
)

const PRESOAK = tun(
  'presoak',
  32,
  {
    6: '            %  %',
    7: '            %gg%',
    8: '                      oooo',
    9: '                      ====',
    10: '    ooo',
    11: ' A       K                    S',
    12: '###<<<<<########<<<<<<<<<<<<<<<<',
  },
  [
    [13, 6, token(0)],
    [11, 11, decor('hose_reel')],
    [14, 11, decor('chem_tanks')],
  ],
)

// The first foam is a bath sunk one tile under the floor, beneath the foam arch: run in, let go
// and slide, and the worst a late brake costs is a hop out. Only then does foam come before a
// drop that kills, and after it a wider one with the catwalk over it.
const FOAM = tun(
  'foam',
  37,
  {
    8: '                              ooo',
    9: '                  oo        ========',
    10: '             ooooo  o',
    11: ' D   oooo',
    12: '###        ##IIIII  IIII###IIII   ###',
    13: '###IIIIIIII##IIIII  IIII###IIII   ###',
  },
  [
    [7, 12, decor('foam_arch')],
    [25, 11, decor('chem_tanks')],
    [25, 8, lamp],
  ],
)

// Token 2 is hidden: a notch in the ceiling behind the second mitter curtain. The two crates
// under the cloth are the step up to it (their coins show under the fringe).
const SOFT = tun(
  'soft',
  34,
  {
    5: '%%%%%%%%%%%%%%%%%  %%%%%%%%%%%%%%%',
    7: '                          ooooo',
    8: '                 oo         b',
    9: '                 ??       =====',
    11: ' E      1     k       2   3      F',
  },
  [
    [16, 7, curtain],
    [18, 7, curtain],
    [17, 5, token(1)],
    [3, 11, decor('panel')],
  ],
)

// A hidden 1UP crate over the middle of the coins: a jump over the shuttling SUV may bump it.
const RINSE = tun(
  'rinse',
  18,
  {
    7: '       h       oo',
    8: '               oo',
    9: '*',
    10: 'X     ooo      PP',
    11: 'X            V PP',
  },
  [
    [15, 9, { kind: 'pipe', props: { to: 'reclaim:in', name: 'drain' } }],
    [5, 11, decor('pipes_wall')],
    [9, 11, decor('hose_reel')],
  ],
)

// The roof's west wall stands on the last column of the bay piece: five tiles over the roof's
// floor, and a running jump lifts his feet four and three quarters.
const WAX = tun(
  'wax',
  17,
  {
    0: '               %',
    1: '               %',
    2: '               %',
    3: '               %',
    4: '%%%%%%%%%%%%%%%% ',
    6: '    4   5  6  7',
    // Low enough to climb from the bay floor: what comes out of a power crate sits on top of it.
    10: '      !',
    12: '#N    o  oo oo  #',
  },
  [],
)

// Under the roof run the ceiling is one tile thick, so the plug is the whole of it, and the coin
// sitting on top of it shows from below.
const VENT = tun(
  'vent',
  9,
  {
    4: 'ooo o ooo',
    5: '%%%ggg%%%',
    6: '    o',
    7: '    o',
    8: '    o',
    9: '    o',
    11: '    y',
  },
  [
    [1, 11, decor('panel')],
    [7, 11, decor('tool_chest')],
  ],
)

const DRY = tun(
  'dry',
  19,
  {
    2: '     ooo    ooo    ',
    4: 'ooooo X oooo X oooo',
    6: '            8',
    10: '    oo   oo   oo',
    11: ' J     9        R',
    12: '###<<<<<<<<<<<<<<##',
  },
  [
    [5, 1, skylight],
    [11, 1, skylight],
    [17, 1, skylight],
  ],
)

const EXIT = tun(
  'exit',
  22,
  {
    0: '                    %%',
    1: '                    %%',
    2: '    ooooo           %%',
    3: '                    %%',
    4: '   o     o oooo     %%',
    5: '%%%%%%%%%%%%%%%%  %%%%',
    6: '              % o   %%',
    7: '              %  o  %%',
    8: '              % o   %%',
    9: '              %     %%',
    10: '              %     %%',
    11: '      G       %Q    %%',
  },
  [
    [5, 1, skylight],
    [11, 1, skylight],
    [16, 2, decor('stencil_employees')],
    [3, 7, decor('sign_exit')],
    [18, 11, { kind: 'secretExit' }],
  ],
)

const TUNNEL = join([ENTRY, PRESOAK, FOAM, SOFT, RINSE, WAX, VENT, DRY, EXIT])

const TUNNEL_LEGEND: Record<string, SpawnSpec> = {
  A: sign('PRESOAK. THE BELT RUNS AGAINST YOU. KEEP MOVING.'),
  K: sign('GRIME WASHES OFF. AIM UP WITH\n{up} AND {spray}. JUMP TO REACH HIGHER.'),
  D: sign('TRIPLE FOAM. FOAM IS SLICK. SLOW DOWN BEFORE THE DROP.'),
  E: sign('SOFT TOUCH. THE BRUSHES ARE NOT. JUMP ONE, RUN UNDER ONE.'),
  F: sign('RINSE. A BIG ONE IS COMING. AN SUV TAKES MORE WATER.'),
  N: sign('HOT WAX. A NOZZLE SPUTTERS BEFORE IT FIRES.'),
  J: sign('DRY. THE LAST STRETCH. EVERYTHING AT ONCE.'),
  S: { kind: 'spawner', props: { variants: 'compact,sedan', every: 170, max: 2, count: 4, delay: 20, range: 160 } },
  R: { kind: 'spawner', props: { variants: 'sedan,suv,sedan', every: 200, max: 1, count: 3, delay: 20, range: 96 } },
  // The first SUV sets off as Maxx comes over the wall (its spawner is then 48 px off screen),
  // not while he is still among the brushes.
  V: { kind: 'spawner', props: { variant: 'suv', max: 1, count: 1, delay: 10, range: 48 } },
  '1': { kind: 'brush', props: { range: 4 } },
  '2': { kind: 'brush', props: { axis: 'y', range: -3 } },
  '3': { kind: 'brush', props: { range: 5, speed: 80 } },
  '4': { kind: 'jet', props: { len: 7 } },
  '5': { kind: 'jet', props: { len: 7, phase: 0 } },
  '6': { kind: 'jet', props: { len: 7, phase: 50 } },
  '7': { kind: 'jet', props: { len: 7, phase: 100 } },
  '8': { kind: 'jet', props: { phase: 40 } },
  '9': { kind: 'brush', props: { axis: 'y', range: -3, start: 0.5 } },
  Q: { kind: 'oneup' },
  // Through the washed plug this hangs his feet over two and a half tiles above the roof: time to
  // steer onto it either way, his head barely under the HUD at the top, and his feet still more
  // than two tiles under the top of either end wall.
  y: { kind: 'spring', props: { power: 1.05 } },
}

/* ------------------------------------------------------------------ */
/* The reclaim room, down the drain                                    */
/* ------------------------------------------------------------------ */

// Down the drain: the token vault, a wash in small. A belt runs against him under a steel housing
// three tiles high, too low to jump in, and top brushes drop out of slots in it to the belt and
// lift back: he passes one only while it is up, and if he stops on the belt it carries him back
// under the one behind him. One slow brush alone, a rest on plain floor, then two quicker ones
// lifting in turn, and token 3 past them. A hit throws him back the way he came; the pipe past
// the token goes back up. From the pipe he arrives by the whole run is in view, token and all.
const reclaim: AreaDef = {
  id: 'reclaim',
  theme: 'bonus',
  music: 'bonus',
  rows: [
    '%%%%%%%%%%%%%%%%%%%%%%',
    '%                    %',
    '%                    %',
    '%     XXXXXXXXXX     %',
    '%     X XXXX X X     %',
    '%     X XXXX X X     %',
    '%     X XXXX X Xooo  %',
    '%1                 2 %',
    '%PP      oo        PP%',
    '%PPS   4    5 6  7 PP%',
    '######<<<##<<<<<######',
    '######################',
  ],
  legend: {
    // He rises out of this pipe, and down on it goes back up to the tunnel; so does the far one.
    '1': { kind: 'pipe', props: { name: 'in', to: 'tunnel:drain' } },
    '2': { kind: 'pipe', props: { to: 'tunnel:drain' } },
    // Alone and slow: a dash from the first pad gets under it on 51 of its 148 ticks.
    '4': { kind: 'brush', props: { axis: 'y', range: -3, speed: 90, wait: 10 } },
    // The pair lifts in turn, the near one a little ahead, so a dash from the second pad has to
    // leave as the near one rises: 21 ticks of its 108 work. Brushes keep time from the moment
    // the room is first entered, so the pair stays in step however long he waits.
    '5': { kind: 'brush', props: { axis: 'y', range: -3, speed: 120, wait: 6, start: 0.3 } },
    '6': { kind: 'brush', props: { axis: 'y', range: -3, speed: 120, wait: 6 } },
    '7': token(2),
    S: sign('WAIT FOR THE BRUSH TO LIFT, THEN RUN. THE BELT PUSHES BACK.'),
  },
}

const level: LevelDef = {
  id: meta.id,
  site: meta.site,
  name: meta.name,
  time: meta.time,
  music: meta.music,
  areas: [area('lot', 'lot', join([LOT]), LOT_LEGEND), area('tunnel', 'tunnel', TUNNEL, TUNNEL_LEGEND), reclaim],
}

const ROOF = `tunnel@0-${TUNNEL.width - 1},0-4`
const BACK_ROOM = `tunnel@${TUNNEL.at.exit + 15}-${TUNNEL.at.exit + 19},11`
const PAST_THE_ROOF_WALL = `tunnel@0-${TUNNEL.at.wax + 14},0-4`

/** What `node scripts/maxx/level.mjs expect mw03` checks. */
export const EXPECT: string[] = [
  'fair goal with hover=off                              # the way to the arch needs no hover and no roof',
  'reach goal within 160s',
  'reach checkpoints',
  `not ${ROOF} unless grime=washed     # the roof: only through the washed vent, against every hover`,
  `not ${ROOF} with cars=roofs,hidden=on,gates=open   # ... not off a car roof, not off a bumped block`,
  `not ${PAST_THE_ROOF_WALL} with all   # the roof ends at its wall, five tiles over the roof's floor`,
  `not ${BACK_ROOM} unless grime=washed  # the room behind the exit: only down the roof hatch`,
  `not ${BACK_ROOM} with cars=roofs,hidden=on,gates=open`,
  'not secret unless grime=washed                        # the EMPLOYEES ONLY door is in that room',
  'not secret with cars=roofs,hidden=on,gates=open',
  'fair secret with grime=washed,hover=off               # once the plug is washed: no hover, no tight jump',
  'not token1 unless grime=washed                        # the plugged duct',
  'fair token1, token2 with grime=washed,hover=off       # the duct, and behind the curtain up off the crates',
  'fair token3 with hover=off                            # the vault asks for no jump: its test is the brushes, which reach leaves out',
  'reach area:reclaim with hover=off                     # the drain pipe itself is a walk',
  'not reclaim@0-21,0-2 with all                         # nothing gets him onto the brush housing',
  'reach tokens with grime=washed',
  'reach coins, blocks with grime=washed                 # nothing is left where nobody can get it',
]

/** Mistakes made while laying the pieces out (see build.ts); empty in a level that is right. */
export const BUILD_PROBLEMS: string[] = PROBLEMS

export default level
