// The sandbox: a playground, not a level of the game. Two areas joined by a
// pipe and a door, with every tile character and every core entity kind in
// it, so the simulation's tests and anyone building a module have one place
// where everything can be tried. Left to right in the main area:
//
//   start     run, jump, a one-tile step, a catwalk, a 3-tile wall
//   crates    every block: B C ? ! W L H h U X
//   cars      compact, sedan, suv; a bubble; a checkpoint
//   floors    slick, spikes, oil, mud, both conveyors, a sludge pit
//   secret    grime blocks hiding a token and the secret exit
//   pipe      the pipe and the door to the bonus room
//   lifts     a lift over sludge, a lift up to the turbo, wax and 1UP, a spring
//   traffic   pickup, sports, van, monster truck
//   tunnel    a spawner sending four cars
//   critters  one of each critter in the default legend (other modules' kinds)
//   exit      a checkpoint, a bubble, the goal
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'

/** Lay sections side by side. Each has 12 rows; short rows are padded to the section's width. */
function sideBySide(sections: string[][]): string[] {
  const rows: string[] = sections[0].map(() => '')
  for (const section of sections) {
    const width = Math.max(...section.map((row) => row.length))
    for (let y = 0; y < rows.length; y++) rows[y] += (section[y] ?? '').padEnd(width)
  }
  return rows
}

const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })

const MAIN_LEGEND: Record<string, SpawnSpec> = {
  A: sign('RUN WITH THE STICK. {jump} JUMPS, HOLD IT TO GO HIGHER.'),
  D: sign('JUMP UP INTO THE WASH CRATES.'),
  E: sign('HOLD {spray} TO WASH A DIRTY CAR. A CLEAN CAR IS A RIDE.'),
  F: sign('FOAM, SPIKES, OIL, MUD, CONVEYORS, THEN SLUDGE.'),
  K: sign('GRIME BLOCKS WASH AWAY.'),
  J: sign('STAND ON A PIPE AND PRESS DOWN. PRESS UP AT A DOOR.'),
  N: sign('IN THE AIR, HOLD DOWN AND {spray} TO HOVER.'),
  T: { kind: 'turbo' },
  Y: { kind: 'wax' },
  Q: { kind: 'oneup' },
  '1': { kind: 'pipe', props: { to: 'bonus:in', name: 'pipe' } },
  '2': { kind: 'secretExit' },
  '3': { kind: 'door', props: { to: 'bonus:door', name: 'door' } },
  '5': { kind: 'lift', props: { dx: 4, speed: 70, wait: 40 } },
  '6': { kind: 'lift', props: { dy: -5, speed: 60, wait: 50 } },
  '7': { kind: 'spawner', props: { variants: 'compact,sedan', every: 200, max: 2, count: 4 } },
}

const START = [
  '',
  '',
  '',
  '',
  '              ooo',
  '',
  '             =====',
  '                    %%',
  '         o o        %%',
  '  @  A          ##  %%',
  '########################',
  '########################',
]

const CRATES = [
  '',
  '',
  '',
  '',
  '',
  '      o',
  '  B C ? ! W L H h U X   BCB',
  '',
  '',
  ' D',
  '##############################',
  '##############################',
]

const CARS = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ' E        c            s      *     v      k',
  '############################################',
  '############################################',
]

const FLOORS = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ' F       ^^',
  'IIIIIIII####OOOOOOOO##MMMMMMMM##<<<<<<<<##>>>>>>>>##~~~#####',
  '############################################################',
]

const SECRET = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '    %%%%%%%',
  '    g $   %',
  ' K  g   2 %',
  '################',
  '################',
]

const PIPE = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '      1',
  '      PP       |',
  ' J    PP    3  |',
  '####################',
  '####################',
]

const LIFTS = [
  '',
  '',
  '                          T  Y  Q',
  '                        ==========',
  '',
  '                                   $',
  '                                  ===',
  '',
  '                      6',
  ' N       5                     y',
  '######~~~~~~~~~~######    ##################',
  '############################################',
]

const TRAFFIC = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '        p               f               n               t',
  '################################################################',
  '################################################################',
]

const TUNNEL = [
  '',
  '',
  '',
  '',
  '   %%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '   |                          |',
  '   |                          |',
  '',
  '',
  '                            7',
  '####################################',
  '####################################',
]

const CRITTERS = [
  '',
  '',
  '',
  '',
  '                  XXXXXXXXXX',
  '    r              d  i  j',
  '          u',
  '',
  '',
  '  b        w            z',
  '########################################',
  '########################################',
]

const EXIT = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '   k    *          G',
  '########################',
  '########################',
]

const main: AreaDef = {
  id: 'main',
  theme: 'lot',
  rows: sideBySide([START, CRATES, CARS, FLOORS, SECRET, PIPE, LIFTS, TRAFFIC, TUNNEL, CRITTERS, EXIT]),
  legend: MAIN_LEGEND,
}

// A tall room, so the camera has to follow up and down.
const bonus: AreaDef = {
  id: 'bonus',
  theme: 'bonus',
  music: 'bonus',
  rows: [
    '%%%%%%%%%%%%%%%%%%%%%%%%',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%      o $ o           %',
    '%     ========         %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%  4                5  %',
    '%  PP   ooo    8    PP %',
    '%  PP        9      PP %',
    '########################',
    '########################',
  ],
  legend: {
    '4': { kind: 'marker', props: { name: 'in' } },
    '5': { kind: 'pipe', props: { to: 'main:pipe' } },
    '8': { kind: 'lift', props: { dy: -9, speed: 80, wait: 60 } },
    '9': { kind: 'door', props: { to: 'main:door', name: 'door' } },
  },
}

export const sandboxLevel: LevelDef = {
  id: 'sandbox',
  site: 'TEST',
  name: 'Sandbox',
  time: 999,
  music: 'sunny',
  areas: [main, bonus],
}
