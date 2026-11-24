// Test room for the cars (sim/entities/cars.ts). Each variant alone on flat ground with room
// to wash it, then pairs, a spawner feeding a conveyor, a washed car to ride over a ditch of
// spikes, and a showroom of washed cars parked to stand on. Low walls (two blocks) keep each
// car in its own stretch. Left to right:
//
//   col   0  start                     col 252  pairs: compact and sedan
//   col  16  compact                   col 284  suv ahead, pickup behind it
//   col  46  sedan                     col 320  a van, a sports car racing up behind it
//   col  76  suv                       col 362  a sedan from behind (it faces right), a monster ahead
//   col 106  pickup (clods)            col 400  a spawner feeding a belt that runs at Maxx
//   col 140  sports car (revs and      col 446  a washed car shuttling along a ditch of spikes:
//            shows its warning first)           ride it across
//   col 182  van                       col 486  the showroom: one of each, washed and parked
//   col 214  monster truck             col 534  the exit
//
//   dev/maxx.html?scene=viewer&level=dev-cars&manual=1&params={"col":16}
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
  A: sign('DIRTY CARS AHEAD. HOLD {spray} TO WASH THEM.'),
  Q: sign('PICKUPS THROW MUD. SPRAY IT OUT OF THE AIR.'),
  D: sign('LISTEN FOR THE REV. WATCH THE EDGE.'),
  E: sign('MONSTER TRUCK. TOO TALL TO JUMP. WASH IT.'),
  F: sign('THE BELT BRINGS THEM IN FAST. KEEP SPRAYING.'),
  J: sign('RIDE A CLEAN CAR ACROSS.'),
  // A sedan that faces right: it drives away from Maxx and he washes it from behind.
  '1': { kind: 'car', variant: 'sedan', props: { dir: 1 } },
  // The conveyor's spawner: four cars, two at a time.
  '2': { kind: 'spawner', props: { variants: 'compact,sedan', every: 150, max: 2, count: 4, delay: 20 } },
  // A washed car to ride: it never counts toward SPOTLESS.
  '3': { kind: 'car', variant: 'sedan', props: { clean: true, dir: 1 } },
  // The showroom: one of each, washed and parked, to stand on and to look at.
  V: sign('WASHED CARS ARE GROUND. HOP ON.'),
  '4': { kind: 'car', variant: 'compact', props: { clean: true, speed: 0 } },
  '5': { kind: 'car', variant: 'sedan', props: { clean: true, speed: 0 } },
  '6': { kind: 'car', variant: 'suv', props: { clean: true, speed: 0 } },
  '7': { kind: 'car', variant: 'pickup', props: { clean: true, speed: 0 } },
  '8': { kind: 'car', variant: 'sports', props: { clean: true, speed: 0 } },
  '9': { kind: 'car', variant: 'van', props: { clean: true, speed: 0 } },
  Z: { kind: 'car', variant: 'monster', props: { clean: true, speed: 0 } },
}

const SECTIONS: string[][] = [
  // 0: start
  section(16, { 9: '  @    A' }),

  // 16: one of each, alone, with a long run of road to wash it on
  section(30, { 8: 'X', 9: 'X                       c' }),
  // 46
  section(30, { 8: 'X', 9: 'X                       s' }),
  // 76
  section(30, { 8: 'X', 9: 'X  k                     v' }),
  // 106: the pickup winds up and throws
  section(34, { 8: 'X', 9: 'X Q                         p' }),
  // 140: the sports car: it wakes off screen, revs, then comes fast
  section(42, { 8: 'X', 9: 'X D  *                                  f' }),
  // 182
  section(32, { 8: 'X', 9: 'X  k                        n' }),
  // 214: the monster truck
  section(38, { 8: 'X', 9: 'X E  *                            t' }),

  // 252: pairs. A compact and a sedan close behind it.
  section(32, { 8: 'X', 9: 'X  k               c   s' }),
  // 284: an suv ahead, a pickup flinging over it
  section(36, { 8: 'X', 9: 'X  *               v        p' }),
  // 320: a slow van, a sports car stuck behind it
  section(42, { 8: 'X', 9: 'X  k                   n           f' }),
  // 362: a sedan that drives away (wash it from behind), a monster truck coming the other way
  section(38, { 8: 'X', 9: 'X   1    *                       t' }),

  // 400: a spawner at the far end of a belt running at Maxx: it brings its cars in fast
  section(46, {
    8: 'X',
    9: 'X F  k                                     2',
    10: '##########<<<<<<<<<<<<<<<<<<<<<<<<<<##########',
  }),

  // 446: a ditch three deep with spikes along its floor, a washed sedan shuttling along it:
  // drop onto its roof from the left rim, ride, jump out onto the right rim
  section(40, {
    7: '      ####                    ####',
    8: 'X    #####                    #####',
    9: 'X J ######^^3^^^^^^^^^^^^^^^^^######  *',
  }),

  // 486: the showroom: one of each, washed and parked (their happy idle, their roofs to stand on)
  section(48, { 9: '  V  4     5     6     7      8     9      Z' }),

  // 534: the exit
  section(18, { 9: '  k     G' }),
]

const rows: string[] = []
for (let y = 0; y < ROWS; y++) rows.push(SECTIONS.map((s) => s[y]).join(''))

const level: LevelDef = {
  id: 'dev-cars',
  site: 'DEV',
  name: 'Car Room',
  time: 999,
  music: 'sunny',
  areas: [{ id: 'main', theme: 'lot', rows, legend: LEGEND }],
}

export default level
