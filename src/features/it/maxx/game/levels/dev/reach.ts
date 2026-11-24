// Test room for the level tools (scripts/maxx/level.mjs, scripts/maxx/lib/reach.mjs): one
// measured fact per section, and the way a level states what must and must not be reachable.
// Left to right (columns):
//
//     0  start
//    14  a wall four tiles high: climbed from a stand
//    30  a pit six tiles wide: the longest plain jump (take off at the lip)
//    50  a pit one tile wide: run straight over it
//    62  a catwalk three tiles up, jumped onto from below
//    78  token 1 behind a grime wall: only once it is washed
//    94  token 2 up a staircase of hidden blocks: only once they are bumped (the tire-stack
//        ledge beyond is 14 tiles away, past any hover's 10)
//   112  token 3 on a ledge seven tiles up, from the tire stack
//   130  a pipe down to a room of coins and back up the same pipe; over it, a shelf one tile
//        above the tire-stack ledge and 10 tiles across: only a hover begun after the top of
//        the jump gets there (NOTES.md section 5)
//   146  a ledge six tiles up, out of everyone's reach
//   160  the checkpoint
//   172  a lift over a pit thirteen tiles wide
//   202  the goal
//
//   node scripts/maxx/level.mjs expect dev-reach      checks EXPECT below
//   node scripts/maxx/level.mjs reach dev-reach       draws the map
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
const ground = (width: number): string => '#'.repeat(width)
const blank = (n: number): string[] => Array.from({ length: n }, () => '')

const START = [...blank(9), '  @   A', ground(14), ground(14)]
const WALL4 = [...blank(6), '      XXXX', '      XXXX', '      XXXX', '      XXXX', ground(16), ground(16)]
const PIT6 = [...blank(9), ' E', '######      ########', '######      ########']
const GAP1 = [...blank(9), '', '#####' + ' ' + '######', '#####' + ' ' + '######']
const CATWALK = [...blank(6), '     o o o', '    ======', '', '', ground(16), ground(16)]
const GRIME = [...blank(6), '    %%%%%%', '    g    %', '    g    %', '    g 7  %', ground(16), ground(16)]
const HIDDEN = [...blank(3), '           8', '         XXXX', '', '      H', '   H', '', '', ground(18), ground(18)]
const SPRING = [...blank(2), '           9', '         XXXX', '', '', '', '', '', '     y', ground(18), ground(18)]
const PIPE = [...blank(3), '     XXXX', ...blank(3), '      1', '      PP', ' D    PP', ground(16), ground(16)]
const LEDGE = [...blank(3), '     XXXX', ...blank(6), ground(14), ground(14)]
const CHECK = [...blank(9), '    k', ground(12), ground(12)]
const LIFT = [...blank(9), '     5', '####             #############', '####             #############']
const EXIT = [...blank(9), '       G', ground(14), ground(14)]

const main: AreaDef = {
  id: 'main',
  theme: 'lot',
  rows: sideBySide([START, WALL4, PIT6, GAP1, CATWALK, GRIME, HIDDEN, SPRING, PIPE, LEDGE, CHECK, LIFT, EXIT]),
  legend: {
    A: sign('REACH LAB. EVERY ANSWER HERE IS MEASURED.'),
    E: sign('SIX TILES: TAKE OFF AT THE LIP.'),
    D: sign('PRESS {down} ON THE PIPE.'),
    '1': { kind: 'pipe', props: { to: 'room:in', name: 'pipe' } },
    '5': { kind: 'lift', props: { dx: 8, speed: 70, wait: 40 } },
    // Tokens are numbered top row first unless props.index says: these are numbered left to right.
    '7': { kind: 'token', props: { index: 0 } },
    '8': { kind: 'token', props: { index: 1 } },
    '9': { kind: 'token', props: { index: 2 } },
  },
}

const room: AreaDef = {
  id: 'room',
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
    '%                 2    %',
    '%                 PP   %',
    '%  4   o o o o    PP   %',
    '########################',
    '########################',
  ],
  legend: {
    '4': { kind: 'marker', props: { name: 'in' } },
    '2': { kind: 'pipe', props: { to: 'main:pipe' } },
  },
}

const level: LevelDef = {
  id: 'dev-reach',
  site: 'DEV',
  name: 'REACH LAB',
  time: 300,
  music: 'sunny',
  areas: [main, room],
}

/**
 * What the reachability tool must find, checked by `node scripts/maxx/level.mjs expect dev-reach`.
 * One line each:  reach|not|fair <targets> [with <modes>] [unless <modes>] [within <n>s]
 */
export const EXPECT: string[] = [
  'fair goal',
  'reach goal within 120s',
  'reach token3, checkpoints, area:room',
  'not token1 unless grime=washed',
  'not token2 unless hidden=on',
  'reach tokens with all',
  'not @151-154,2 with all # the ledge six tiles up',
  'reach @20-21,5 # the top of the four-tile wall',
  'fair goal with hover=off # no jump on the way needs the hover or split-tick timing',
  'reach @135-138,2 # the shelf over the pipe: 10 tiles from the tire stack, with the hover begun late',
  'not @135-138,2 with hover=top # ... which a hover held from the top of the jump falls short of',
]

export default level
