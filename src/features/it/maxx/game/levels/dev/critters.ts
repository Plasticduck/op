// Test room for the critters (sim/entities/critters.ts): each kind alone first, on flat
// ground and around ledges, then in small combinations. Left to right:
//
//   col   0  start
//   col  14  blob: one walking at you; one on a ledge and one penned under it; two in a pen
//   col  80  grackle: one over open ground; one over a pit, with a catwalk for cover
//   col 132  bugs: one swarm in the open; one behind a wall it comes straight through
//   col 182  tumbleweed: one on a long flat; two down a flight of steps; one penned in a court
//   col 264  mixes: blob + grackle; blobs + tumbleweed; bugs over ledges of blobs; grackle,
//            pit and tumbleweed; all four
//   col 420  awkward places: blobs on a one-tile pillar, in a one-tile pen, on a belt, on a lift;
//            grackles under a canopy, over a ledge, over parked cars and a lift; tumbleweeds in a
//            ditch, beside sludge, two in a row, into a wall; a swarm and a pipe; the exit (598)
//
//   dev/maxx.html?scene=viewer&level=dev-critters&params={"col":80}
import type { LevelDef, SpawnSpec } from '../../contract'

const ROWS = 12

/** One stretch of the room, `width` tiles wide: the rows given, over two rows of ground unless a row says otherwise. */
function section(width: number, rows: Record<number, string>): string[] {
  const out: string[] = []
  for (let y = 0; y < ROWS; y++) out.push((rows[y] ?? (y >= ROWS - 2 ? '#'.repeat(width) : '')).padEnd(width).slice(0, width))
  return out
}

const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })

const LEGEND: Record<string, SpawnSpec> = {
  A: sign('CRITTERS AHEAD. {spray} WASHES THEM ALL.'),
  D: sign('GRIME BLOB. STOMP IT OR SPRAY IT.'),
  E: sign('GRACKLE. HOLD {up} AND {spray} TO AIM HIGH.'),
  F: sign('BUG SWARM. KEEP THE WATER ON IT.'),
  J: sign('TUMBLEWEED. WATER SHOVES IT BACK.'),
  '1': { kind: 'blob', props: { dir: 1 } },
  '2': { kind: 'bird', props: { range: 3 } },
  '3': { kind: 'tumbleweed', props: { dir: 1 } },
  '4': { kind: 'car', variant: 'compact', props: { speed: 0, bonus: true } },
  '5': { kind: 'car', variant: 'sedan', props: { speed: 0, clean: true, bonus: true } },
  '6': { kind: 'lift', props: { dy: -2, speed: 40, wait: 40, w: 2 } },
  '0': { kind: 'lift', props: { dy: -2, speed: 50, wait: 30 } },
  '8': { kind: 'marker', props: { name: 'shaken' } },
  '9': { kind: 'pipe', props: { to: 'main:shaken' } },
}

const SECTIONS: string[][] = [
  // 0: start
  section(14, { 9: '  @   A' }),

  // 14: a blob on flat ground, walking at you
  section(22, { 9: ' D              b' }),
  // 36: one that turns at both ends of its ledge, one penned between two blocks under it
  section(24, {
    6: '         b',
    7: '      #######',
    9: '    X     b      X',
  }),
  // 60: two in a pen: they turn when they meet
  section(20, { 5: '         $', 9: '   X  1     b  X' }),

  // 80: a grackle over open ground
  section(26, { 5: '              r', 9: ' k E' }),
  // 106: a grackle over a pit, and a catwalk to shelter under
  section(26, {
    4: '             2',
    7: '      ====',
    9: ' *',
    10: '############   ###########',
    11: '############   ###########',
  }),

  // 132: a swarm in the open
  section(26, { 7: '                 u', 9: ' k F' }),
  // 158: a swarm behind a wall: it comes straight through
  section(24, {
    7: '        %%',
    8: '        %%     u',
    9: '        %%',
  }),

  // 182: a tumbleweed down a long flat
  section(30, { 9: ' k J                      w' }),
  // 212: two down a flight of steps
  section(30, {
    7: '                     w    w',
    8: '              ################',
    9: '        ######################',
  }),
  // 242: one bouncing to and fro in a court
  section(22, {
    6: '          $',
    8: '   X              X',
    9: '   X       3      X',
  }),

  // 264: a blob under a grackle
  section(26, { 5: '             r', 9: ' k *       b     1' }),
  // 290: two blobs and a tumbleweed through them
  section(30, { 9: '      b      1           w' }),
  // 320: a swarm over ledges of blobs
  section(30, {
    4: '                    u',
    6: '          b',
    7: '        #####      b',
    8: '                 #####',
    9: ' k',
  }),
  // 350: a grackle over a pit, a tumbleweed coming at the far lip
  section(30, {
    5: '            2',
    9: ' *                     w',
    10: '##########    ################',
    11: '##########    ################',
  }),
  // 380: all four
  section(40, {
    4: '                  r',
    6: '             u         $',
    7: '                       b',
    8: '                     #####',
    9: ' k     b         1               w',
  }),

  // 420: blobs with nowhere to go: on a one-tile pillar, in a one-tile pen (each stands and
  // looks about), walking against a belt that holds it to a wall, riding a lift
  section(34, {
    5: '                             b',
    7: '     b',
    8: '     #                       6',
    9: ' k        XbX       b   X',
    10: '##############>>>>>>>>>>##########',
    11: '##################################',
  }),
  // 454: grackles in awkward places: under a low canopy, low over a ledge (it holds its drop
  // till it is clear), over a parked dirty car and a clean one, over a lift
  section(40, {
    3: '  %%%%%%%%%%%%',
    4: '       r                 r          r',
    6: '                r',
    7: '              ######',
    8: '                                    0',
    9: ' k                  4    5',
  }),
  // 494: a tumbleweed rolls into a ditch one tile deep and cannot hop out
  section(16, { 9: ' k          w', 10: '####    ########' }),
  // 510: sludge: the blob turns at its edge, the tumbleweed sinks
  section(18, { 9: '   X     b     w', 10: '####~~~###########' }),
  // 528: two in a row: spray the first back into the second
  section(22, { 9: ' k          w   w' }),
  // 550: one rolling the other way, into a wall
  section(14, { 8: '           X', 9: '   3       X' }),
  // 564: a swarm on your tail, and a pipe to leave it behind
  section(34, {
    6: '            u',
    7: '     9                        8',
    8: '     PP                       PP',
    9: ' k   PP                       PP',
  }),

  // 598: the exit
  section(16, { 9: '  k  *     G' }),
]

const rows: string[] = []
for (let y = 0; y < ROWS; y++) rows.push(SECTIONS.map((s) => s[y]).join(''))

const level: LevelDef = {
  id: 'dev-critters',
  site: 'DEV',
  name: 'Critter Room',
  time: 999,
  music: 'sunny',
  areas: [{ id: 'main', theme: 'lot', rows, legend: LEGEND }],
}

export default level
