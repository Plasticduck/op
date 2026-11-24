// Dev room for the objects slice: every pickup, prize, fixture, door, gate, spring, lift and
// sign, each in every state, in one short walk. Main area (the lot, light sky), left to right:
//
//   start     a sign
//   coins     a row on the floor (they spin as a wave), an arc over a step
//   crates    ? with a coin resting on it, ! (the turbo nozzle at full shine), W (wax, walks
//             off), L (1UP, walks off), spikes that cost a shine, then ! again (a bubble)
//   shelf     every pickup at rest on a catwalk: bubble, turbo, wax, 1UP, a token, and a
//             token already owned (a faint outline)
//   flag      a checkpoint, and a tire spring up to a ledge of coins
//   lifts     a 3-wide one that runs sideways, a 2-wide one that climbs to a ledge
//   gates     a button on three steel blocks opens a 1 x 3 gate under a wall (the only way
//             on) and a 2 x 2 one
//   doors     a plain door, a barred door (flag 'key') and the button past it that unlocks
//             it; both lead to the back room
//   exit      the wash exit arch
//
// The back room (the tunnel, dark wall) has the doors back, coins, the third token on a
// ledge reached by a one-tile lift, a checkpoint, a spring, a gate that is open from the
// start (its flag was set in the yard) and the EMPLOYEES ONLY door.
//
//   dev/maxx.html?scene=viewer&level=dev-objects&manual=1&params={"col":40}
// scripts/maxx/tests/objects.mjs walks it.
import type { AreaDef, LevelDef, SpawnSpec } from '../../contract'

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

const LEGEND: Record<string, SpawnSpec> = {
  A: sign('OBJECT ROOM. WALK RIGHT AND TOUCH EVERYTHING.'),
  D: sign('WASH TOKENS. 100 OF THEM IS AN EXTRA LIFE.'),
  E: sign('JUMP UP INTO THE CRATES. {jump}'),
  F: sign('SPIKES COST A SHINE. THE NEXT CRATE GIVES IT BACK AS A BUBBLE.'),
  K: sign('EVERY PRIZE AT REST. JUMP UP THROUGH THE SHELF.'),
  N: sign('THE WASH STATION FLAG IS A CHECKPOINT. TIRES ARE BOUNCY.'),
  R: sign('LIFTS RIDE THEIR RAILS.'),
  S: sign('THE BUTTON ON THE BLOCK OPENS THE GATES.'),
  J: sign('PRESS {up} AT A DOOR. THE BARRED ONE NEEDS THE BUTTON PAST IT.'),
  T: { kind: 'turbo' },
  Y: { kind: 'wax' },
  Q: { kind: 'oneup' },
  '9': { kind: 'token', props: { owned: true } },
  '1': { kind: 'door', props: { to: 'back:in', name: 'out' } },
  '2': { kind: 'door', props: { to: 'back:in2', name: 'out2', flag: 'key' } },
  '3': { kind: 'button', props: { flag: 'key' } },
  '4': { kind: 'button', props: { flag: 'gates' } },
  '5': { kind: 'lift', props: { dx: 5, speed: 60, wait: 40 } },
  '6': { kind: 'lift', props: { dy: -4, speed: 60, wait: 50, w: 2 } },
  '7': { kind: 'gate', props: { flag: 'gates' } },
  '8': { kind: 'gate', props: { flag: 'gates', w: 2, h: 2 } },
}

const FLOOR = (n: number): string => '#'.repeat(n)

const START = ['', '', '', '', '', '', '', '', '', '  @   A', FLOOR(10), FLOOR(10)]

const COINS = [
  '',
  '',
  '',
  '',
  '',
  '            oooo',
  '          o      o',
  '         o        o',
  '             XX',
  ' D  oooooo   XX',
  FLOOR(21),
  FLOOR(21),
]

const CRATES = [
  '',
  '',
  '',
  '',
  '',
  '     o',
  '     ?   !   W   L       !',
  '',
  '',
  ' E                 F ^^',
  FLOOR(28),
  FLOOR(28),
]

const SHELF = [
  '',
  '',
  '',
  '',
  '',
  '',
  '    *  T  Y  Q  $  9',
  '   ==================',
  '',
  ' K',
  FLOOR(22),
  FLOOR(22),
]

const FLAG = [
  '',
  '',
  '              ooo',
  '             =====',
  '',
  '',
  '',
  '',
  '',
  ' N    k        y',
  FLOOR(20),
  FLOOR(20),
]

const LIFTS = [
  '',
  '',
  '',
  '                      ooo',
  '                     =====',
  '',
  '',
  '',
  '       5           6',
  ' R',
  FLOOR(28),
  FLOOR(28),
]

const GATES = [
  '            %%',
  '            %%',
  '            %%',
  '            %%',
  '            %%',
  '            %%',
  '            %%',
  '',
  '      4',
  ' S   XXX     7    8  ooo',
  FLOOR(25),
  FLOOR(25),
]

const DOORS = ['', '', '', '', '', '', '', '', '', ' J    1      2       3', FLOOR(24), FLOOR(24)]

const EXIT = ['', '', '', '', '', '', '', '', '', '      G', FLOOR(22), FLOOR(22)]

const main: AreaDef = {
  id: 'main',
  theme: 'lot',
  rows: sideBySide([START, COINS, CRATES, SHELF, FLAG, LIFTS, GATES, DOORS, EXIT]),
  legend: LEGEND,
}

const BACK_W = 44
/** A row of the back room between its two walls; `inner` starts at column 1. */
const room = (inner: string): string => ('%' + inner).padEnd(BACK_W - 1) + '%'

const back: AreaDef = {
  id: 'back',
  theme: 'tunnel',
  music: 'tunnel',
  rows: [
    '%'.repeat(BACK_W),
    room(''),
    room(''),
    room(''),
    room('               ooooo          $'),
    room('              =======        ==='),
    room(''),
    room('       oooooo'),
    room('                           6'),
    room('  1  2   Z   k    y              7    V'),
    FLOOR(BACK_W),
    FLOOR(BACK_W),
  ],
  legend: {
    '1': { kind: 'door', props: { to: 'main:out', name: 'in' } },
    '2': { kind: 'door', props: { to: 'main:out2', name: 'in2' } },
    '6': { kind: 'lift', props: { dy: -3, speed: 50, wait: 40, w: 1 } },
    '7': { kind: 'gate', props: { flag: 'gates' } },
    Z: sign('THE BACK ROOM: THE SAME THINGS ON THE DARK TUNNEL WALL.'),
    V: { kind: 'secretExit' },
  },
}

const level: LevelDef = {
  id: 'dev-objects',
  site: 'DEV',
  name: 'Object Room',
  time: 999,
  music: 'sunny',
  areas: [main, back],
}

export default level
