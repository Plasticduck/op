// Dev room for the hazards slice (sim/entities/hazards.ts): each trap alone first, with
// room to stand and watch it, then in rows and waves. Left to right:
//
//   start     a sign
//   drips     grimy water, oil, then four in a wave (phase 0, 25, 50, 75)
//   icicles   one alone, then five over a walkway
//   brushes   one on a floor rail, one on an upright rail, then a fast one of each axis
//   jets      one from the ceiling, one from the floor, then three out of phase (a wave)
//   blowers   a strong one against the run up to a step, a weak one across a pit, then
//             gusts over the far side of a pit
//   exit      a tail wind over a pit, a checkpoint and the goal
//
//   dev/maxx.html?scene=viewer&level=dev-hazards&manual=1&params={"col":40,"row":9}
// Columns: drips 14, icicles 50, brushes 86, jets 134, blowers 174, exit 234. Pass "row":9:
// without it the viewer stands Maxx on the first floor from the top, the roof of the ceiling.
// scripts/maxx/tests/hazards.mjs has a careful player (it looks before it leaps) clear it
// start to goal without losing a pip. A second area, 'lab', holds the awkward cases (below).
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
const drip = (phase: number): SpawnSpec => ({ kind: 'drip', props: { phase } })
const jet = (phase: number): SpawnSpec => ({ kind: 'jet', props: { phase } })

const LEGEND: Record<string, SpawnSpec> = {
  A: sign('HAZARD LAB. EVERY TRAP SHOWS A TELL FIRST.'),
  E: sign('A LEAK SWELLS, THEN DRIPS. GO UNDER IT IN BETWEEN.'),
  F: sign('NEVER STOP UNDER AN ICICLE. HOLD {up} AND {spray} TO KNOCK ONE DOWN.'),
  K: sign('BRUSHES RIDE THEIR RAILS. JUMP ONE, RUN UNDER THE OTHER.'),
  N: sign('A WAX JET SPUTTERS BEFORE IT FIRES.'),
  Q: sign('A DRYER ONLY PUSHES. LEAN INTO IT.'),
  R: sign('WIND SHORTENS A JUMP.'),
  S: sign('WAIT FOR THE GUST TO DIE, THEN JUMP.'),
  D: { kind: 'drip', props: { oil: true } },
  '1': drip(0),
  '2': drip(25),
  '3': drip(50),
  '4': drip(75),
  z: { kind: 'brush', props: { range: 4 } },
  Z: { kind: 'brush', props: { axis: 'y', range: -3 } },
  x: { kind: 'brush', props: { range: 5, speed: 90 } },
  V: { kind: 'brush', props: { axis: 'y', range: -3, wait: 30, start: 0.5 } },
  J: { kind: 'jet', props: { dir: 'up' } },
  '5': jet(0),
  '6': jet(50),
  '7': jet(100),
  '8': { kind: 'blower', props: { force: -150, w: 8, h: 3 } },
  '9': { kind: 'blower', props: { force: -60, w: 6, h: 5 } },
  '0': { kind: 'blower', props: { force: -180, w: 5, h: 5, on: 80, off: 100 } },
  T: { kind: 'blower', props: { force: 100, w: 8, h: 4 } },
  Y: sign('A TAIL WIND CARRIES A JUMP.'),
}

const START = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '  @    A',
  '##############',
  '##############',
]

const DRIPS = [
  '',
  '',
  '',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '      d        D        1 2 3 4',
  '',
  '',
  '                           $',
  ' E',
  '####################################',
  '####################################',
]

const ICICLES = [
  '',
  '',
  '',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '       i           i  i  i  i  i',
  '',
  '',
  '',
  ' F                         $',
  '####################################',
  '####################################',
]

const BRUSHES = [
  '',
  '',
  '',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '',
  '',
  '                                  $',
  '',
  ' K     z            Z           x         V',
  '################################################',
  '################################################',
]

const JETS = [
  '',
  '',
  '',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '       j                   5  6  7',
  '',
  '',
  '',
  ' N              J',
  '########################################',
  '########################################',
]

// 8 blows against the run up to a step, with the machine at its foot; 9 blows across a pit;
// 0 gusts over the landing side of a pit, close enough that its spin-up shows from the edge.
const BLOWERS = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '               %%',
  ' Q            8%%  R              9       S            0',
  '##############################   ##############   ##########',
  '##############################~~~##############~~~##########',
]

// A tail wind over a pit: T blows right, from its machine at the take-off edge.
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
  ' Y  T            k        G',
  '#####     ###################',
  '#####~~~~~###################',
]

const main: AreaDef = {
  id: 'main',
  theme: 'tunnel',
  rows: sideBySide([START, DRIPS, ICICLES, BRUSHES, JETS, BLOWERS, EXIT]),
  legend: LEGEND,
}

// The second area, 'lab', is a bench of awkward cases, for looking at, not for playing through
// (nothing leads there: open it with the viewer's "area":"lab"). Columns: a dryer whose wind
// runs off the area's left edge 0, two dryers overlapping 17, a lift in the wind 44, jets over
// a pit, a catwalk and a lift 72, a drip over a catwalk and icicles side by side and over a pit
// 112, brushes whose rails run into a wall and a ceiling 139, a long rail on legs 181.
const LAB_LEGEND: Record<string, SpawnSpec> = {
  A: sign('THE WIND RUNS OFF THE EDGE. IT NEVER PUSHES YOU OUT.'),
  Q: sign('TWO DRYERS ADD UP.'),
  R: sign('A JET STOPS ON A CATWALK OR A LIFT, AS YOU WOULD.'),
  D: sign('A RAIL ENDS AT A WALL.'),
  '1': { kind: 'blower', props: { force: -150, w: 8, h: 3 } },
  '2': { kind: 'blower', props: { force: -100, w: 12, h: 3 } },
  '3': { kind: 'blower', props: { force: -100, w: 16, h: 3 } },
  '4': { kind: 'blower', props: { force: -80, w: 20, h: 6 } },
  N: { kind: 'lift', props: { dx: 5, speed: 50, w: 3 } },
  T: { kind: 'lift', props: { dx: 6, speed: 60, w: 3 } },
  '5': { kind: 'jet', props: { phase: 20 } },
  '6': { kind: 'jet', props: { len: 20, phase: 40 } },
  '7': { kind: 'jet', props: { off: 30, on: 90 } },
  J: { kind: 'jet', props: { dir: 'up', off: 30, on: 90 } },
  E: { kind: 'brush', props: { range: 6 } },
  F: { kind: 'brush', props: { axis: 'y', range: -8 } },
  K: { kind: 'brush', props: { range: 10, speed: 90 } },
}

const LAB_WIND = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '  A   1          Q           2     3',
  '############################################',
  '############################################',
]

const LAB_LIFT = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '       N',
  '',
  '                          4',
  '###              ###########',
  '###~~~~~~~~~~~~~~###########',
]

const LAB_JETS = [
  '',
  '',
  '',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '    5     6        7           7',
  '',
  '                ======     T',
  '',
  ' R                   J',
  '##         ##############         ######',
  '##~~~~~~~~~##############~~~~~~~~~######',
]

const LAB_ICE = [
  '',
  '',
  '',
  '%%%%%%%%%%%%%%%%%%%%%%%%',
  '%%%%%%%%%%%%%%%%%%%%%%%%',
  '    d      ii      i',
  '',
  '  =====',
  '',
  '',
  '###################   #####',
  '###################~~~#####',
]

const LAB_BRUSHES = [
  '',
  '',
  '',
  '%%%%%%%%%%%%%%%%%%%%',
  '%%%%%%%%%%%%%%%%%%%%',
  '',
  '',
  '      %',
  '      %',
  ' D E  %      F',
  '##########################################',
  '##########################################',
]

const LAB_RAIL = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '  K',
  '##############################',
  '##############################',
]

const lab: AreaDef = {
  id: 'lab',
  theme: 'tunnel',
  rows: sideBySide([LAB_WIND, LAB_LIFT, LAB_JETS, LAB_ICE, LAB_BRUSHES, LAB_RAIL]),
  legend: LAB_LEGEND,
}

const level: LevelDef = {
  id: 'dev-hazards',
  site: 'DEV',
  name: 'Hazard Lab',
  time: 999,
  music: 'tunnel',
  areas: [main, lab],
}

export default level
