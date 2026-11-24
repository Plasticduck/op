// MW08 THE MEGA TUNNEL: the last level. Night, neon, every station of the wash running at once,
// then MUDZILLA. One long area, left to right (COLS below has each stretch's first column; the
// tools print places as `main col,row`):
//
//   START      the arch, a power crate, nothing that hurts
//   BELT       thirty tiles of belt against him; a compact, then a bay sending a sports car, a
//              sedan, an SUV and a sedan down it. Token 1 hangs over the foam arch in plain sight: a jump back from the catwalk
//   BRUSHES    two mitter brushes out of step, then two in step on a belt; a hidden 1UP
//   CHECK1     checkpoint 1
//   FOAM       foam under wax jets: one, a wave of three, a van through a second wave
//   CANAL      sludge crossed on two lifts, a floor jet on the island (token 2 in its column),
//              ceiling jets over lift two
//   MONSTER    the first monster truck, alone in a pen
//   DRYERS     checkpoint 2, then two sludge pits under gusting dryers; a prize crate over the
//              step (not wax: ten seconds of wax would carry him through the crossfire untouched)
//   CROSSFIRE  a low corridor between two car bays: a monster truck and the far bay's cars from
//              the front, the near bay's from behind once the floor button lets its shutter up.
//              Behind the grime at the back of the near bay: a door to the vault and token 3
//   TREADMILL  jets over a belt, and a monster truck riding the belt at him
//   PREP       checkpoint 3, a bubble, the turbo nozzle
//   ARENA      MUDZILLA, built as NOTES.md 9.2 says
//
// Car bays: cars come out of a curtained bay under a deck four tiles up and Maxx goes over the
// deck, so no car leaves its own stretch. Each spawner sits at the back of its bay, so a new car
// appears behind the curtains, never on someone standing at the bay's mouth.
// Gantries (the slabs the jets and brush rails hang from) have a post up to the roof at each
// end, so nobody gets on top of one from a deck.
// Wind and critters, which the level tools leave out: the two dryers blow left over their own
// pits and nothing else, and the two blobs walk decks whose only neighbours are those posts.
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { LEVEL_META } from './meta'

const meta = LEVEL_META.find((m) => m.id === 'mw08')!

const ROWS = 12

/** One stretch of the tunnel, `width` tiles wide: the rows given (by row number), over two rows of ground. */
function part(width: number, rows: Record<number, string>): string[] {
  const out: string[] = []
  for (let y = 0; y < ROWS; y++) out.push((rows[y] ?? (y >= ROWS - 2 ? '#'.repeat(width) : '')).padEnd(width).slice(0, width))
  return out
}

const decor = (sprite: string, more: Record<string, boolean> = {}): SpawnSpec => ({ kind: 'decor', props: { sprite: `decor_${sprite}`, ...more } })
const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })
const jet = (phase: number): SpawnSpec => ({ kind: 'jet', props: { phase } })
const mitter = (start: number): SpawnSpec => ({ kind: 'brush', props: { axis: 'y', range: -3, start } })

const LEGEND: Record<string, SpawnSpec> = {
  // Dressing.
  A: decor('arch_mega'),
  N: decor('neon_mw'),
  a: decor('neon_arrow'),
  q: decor('neon_open'),
  m: decor('lamp_hang'),
  l: decor('pipes_wall'),
  E: decor('chem_tanks'),
  F: decor('panel'),
  Q: decor('foam_arch'),
  x: decor('sign_exit'),
  K: decor('curtain', { front: true }),
  // Signs on the face of a roof slab: drawn in front of the tiles, where nothing ever stands.
  V: decor('neon_mw', { front: true }),
  '[': decor('neon_arrow', { front: true }),
  // Words.
  S: sign('THE MEGA TUNNEL. EVERY STATION IS RUNNING TONIGHT.'),
  Y: sign('MONSTER TRUCK. TOO TALL TO JUMP. WASH IT ALL THE WAY.'),
  R: sign('LAST PREP STATION. MUDZILLA IS INSIDE. SOAK IT WHEN IT IS WORN OUT.'),
  // Hazards.
  '1': jet(50),
  '2': jet(100),
  J: { kind: 'jet', props: { dir: 'up' } },
  '3': mitter(0),
  '4': mitter(1),
  '9': { kind: 'blower', props: { force: -150, w: 4, h: 4, on: 100, off: 80 } },
  '0': { kind: 'blower', props: { force: -150, w: 5, h: 4, on: 100, off: 80, phase: 90 } },
  // Rides.
  '5': { kind: 'lift', props: { dx: 5, speed: 60, wait: 40 } },
  '6': { kind: 'lift', props: { dx: 6, speed: 60, wait: 40 } },
  // Cars.
  // The sports car goes first, while the bay is still far off screen: it revs and shows its warning
  // at the screen edge as a sports car should. The slow ones nose out through the curtain later.
  '7': { kind: 'spawner', props: { variants: 'sports,sedan,suv,sedan', every: 170, max: 2, count: 4 } },
  '8': { kind: 'spawner', props: { variants: 'compact,sedan,suv', every: 200, max: 2, count: 3 } },
  e: { kind: 'spawner', props: { variants: 'sedan,compact', every: 100, max: 2, count: 2, dir: 1 } },
  // The near bay of the crossfire: its shutter, the button that lets it up, and what is behind it.
  T: { kind: 'gate', props: { flag: 'bay', h: 2 } },
  _: { kind: 'button', props: { flag: 'bay' } },
  D: { kind: 'door', props: { to: 'vault:in', name: 'vault' } },
  // Prizes.
  '(': { kind: 'token', props: { index: 0 } },
  ')': { kind: 'token', props: { index: 1 } },
  '+': { kind: 'turbo' },
  // The end.
  Z: { kind: 'mudzilla' },
  '}': { kind: 'door', props: { to: 'exit:in', flag: 'mudzilla', min: 1 } },
}

const START = part(20, {
  2: '             N',
  6: '             ?!?',
  9: '  @   A   S   F   E',
})

const BELT = part(40, {
  2: '     (',
  3: '                 m         m',
  5: '                                    F b',
  6: '       ooo                   ooo  %%%%%%',
  7: '       ===                   ===  %%%%%%',
  8: '             o o o o o                %%',
  9: '    Q               c              K7K%%',
  10: '##<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<########',
})

const BRUSHES = part(28, {
  0: '   %                    %',
  1: '   %                    %',
  2: '   %%%%%%%%%%%%%%%%%%%%%%',
  3: '   %%%%%%%%%%%%%%%%%%%%%%',
  4: '   |                    |',
  5: '   |     h              |',
  6: '   |                    |',
  7: '   |    ooo             |',
  8: '   |              oo    |',
  9: ' E |   3   4     3  3   | F',
  10: '##############<<<<<<<<<<####',
})

const CHECK1 = part(10, {
  3: ' m',
  5: '    q',
  9: '  k  *  Q',
})

// Under each nozzle the floor is a plain drain tile, not foam: whoever slides to a stop under a
// jet has the grip to get out again before it fires.
const FOAM = part(28, {
  0: ' %                        %',
  1: ' %                        %',
  2: ' %%%%%%%%%%%%%%%%%%%%%%%%%%',
  3: ' %%%%%%%%%%%%%%%%%%%%%%%%%%',
  4: ' |   j   j  1  2   2  1   |',
  5: ' |                        |',
  6: ' |                        |',
  7: ' |                        |',
  8: ' |     o  o  o   o  o     |',
  9: ' |                    n   |',
  10: '###II#III#II#II#III#II#I####',
})

const CANAL = part(34, {
  0: '                  %         %',
  1: '                  %         %',
  2: '                  %%%%%%%%%%%',
  3: '        m         %%%%%%%%%%%',
  4: '                  |   j  1  |',
  5: '               )  |         |',
  6: '                  |         | !',
  7: '     o o o o      |         |',
  8: '                  |         |',
  9: ' l   5         J  | 6       |   Y',
  10: '###~~~~~~~~~~#####~~~~~~~~~~~#####',
  11: '###~~~~~~~~~~#####~~~~~~~~~~~#####',
})

// One tile of kerb at each end turns the truck round and is no perch to jump it from; nothing
// else in the pen is either, so the first monster truck has to be washed.
const MONSTER = part(24, {
  3: '        m       m',
  9: '##             t   ## E',
})

const DRYERS = part(28, {
  4: '                          ?',
  6: '         oo        ooo',
  7: '        o  o      o   o',
  8: '                          ##',
  9: ' k * F      9          0  ##',
  10: '########    ######     #####',
  11: '########~~~~######~~~~~#####',
})

// The pen is a low corridor: nobody jumps a car under a roof three tiles up, so whatever comes
// down it gets washed. A monster truck fills it, with the far bay's cars queued behind; the
// button at the foot of the way in lets the near bay's shutter up right behind him (he hears it
// and sees it), and its two come from behind. The way in is a shaft two tiles wide, too narrow
// to drop past the truck, and the gantry of the next stretch hangs low over the far deck, so
// neither deck is a place to jump a truck from.
const CROSSFIRE = part(44, {
  0: '              %                  %       %',
  1: '              %                  %       %',
  2: '              %%%%%%%%%%%%%%%%%%%%       %%%',
  3: '              %%%%%%%%%%%%%%%%%%%%       %%%',
  4: '              %%%%%%%%%%%%%%%%%%%%',
  5: '              %%%%%%%%%%V%%%%%%%%%     b',
  6: '%%%%%%%%%%%%  %%%%%%%%%%%%%%%%%%%%    %%%%%%',
  7: '%%%%%%%%%%%%         a      a     === %%%%%%',
  8: '%  g o o o        o o o o o o             %%',
  9: '% Dg e     T  _               t        K8K%%',
})

// The jets come first and the truck wakes while he is among them: it rides the belt at him at
// close to a run, and the belt drags him back under the jets while he washes it. The roof over
// the belt is four tiles up: a truck coming that fast could be jumped under a higher one.
const TREADMILL = part(32, {
  0: '                            %',
  1: '                            %',
  2: '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  3: '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  4: '   %%%%%[%%%%%%%V%%%%%%%[%%%|',
  5: '   %%%%%%%%%%%%%%%%%%%%%%%%%|',
  6: '       j   1   2            |',
  7: '                            |',
  8: '         o   o              |',
  9: ' F                       t  | E',
  10: '###<<<<<<<<<<<<<<<<<<<<<<<<#####',
})

const PREP = part(17, {
  3: '   m         m',
  5: '        q',
  9: 'l k   R * +   A',
})

// NOTES.md 9.2 to the tile: the left wall with its doorway, 22 tiles of plain floor, the two
// catwalks, the power crate, the right wall as the area's last column. The barred door behind
// Mudzilla is the level's exit on paper (the tools want a goal to walk to): Mudzilla ends the
// level itself on the tick it sets the flag that would unbar it.
const ARENA = part(24, {
  0: '%                      %',
  1: '%                      %',
  2: '%                      %',
  3: '%                      %',
  4: '%           !          %',
  5: '%                      %',
  6: '%                      %',
  7: '%       ===  ===      x%',
  8: '                       %',
  9: '                   Z  }%',
})

const PARTS: [string, string[]][] = [
  ['START', START],
  ['BELT', BELT],
  ['BRUSHES', BRUSHES],
  ['CHECK1', CHECK1],
  ['FOAM', FOAM],
  ['CANAL', CANAL],
  ['MONSTER', MONSTER],
  ['DRYERS', DRYERS],
  ['CROSSFIRE', CROSSFIRE],
  ['TREADMILL', TREADMILL],
  ['PREP', PREP],
  ['ARENA', ARENA],
]

/** The first column of each stretch, for whoever reads a tool's `main col,row`. */
export const COLS: Record<string, number> = {}
{
  let x = 0
  for (const [name, rows] of PARTS) {
    COLS[name] = x
    x += rows[0].length
  }
}

const main: AreaDef = {
  id: 'main',
  theme: 'mega',
  rows: Array.from({ length: ROWS }, (_, y) => PARTS.map(([, rows]) => rows[y]).join('')),
  legend: LEGEND,
}

// The vault behind the near bay of the crossfire: coins, a 1UP crate and the third token.
const vault: AreaDef = {
  id: 'vault',
  theme: 'bonus',
  music: 'bonus',
  rows: [
    '%%%%%%%%%%%%%%%%%%%%%%',
    '%                    %',
    '%                    %',
    '%     A        A     %',
    '%                    %',
    '%          $         %',
    '%   N  L  ===    E   %',
    '%                    %',
    '%    ooooo   ooooo   %',
    '% 1 F  R       R   V %',
    '######################',
    '######################',
  ],
  legend: {
    '1': { kind: 'door', props: { to: 'main:vault', name: 'in' } },
    $: { kind: 'token', props: { index: 2 } },
    A: decor('chandelier'),
    N: decor('portrait'),
    E: decor('crest'),
    F: decor('plant'),
    R: decor('rope_barrier'),
    V: decor('vault_door'),
  },
}

// Past the barred door: the way out. Nobody walks here (Mudzilla ends the level), but the door
// has to lead somewhere, and this is where it would.
const exit: AreaDef = {
  id: 'exit',
  theme: 'mega',
  rows: [
    '                    ',
    '                    ',
    '      N             ',
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '  1      G          ',
    '####################',
    '####################',
  ],
  legend: {
    '1': { kind: 'marker', props: { name: 'in' } },
    N: decor('neon_mw'),
  },
}

const A0 = COLS.ARENA
const X0 = COLS.CROSSFIRE
/** The top of a gantry: feet row 1, between its two posts. */
const top = (part: string, from: number, to: number): string => `main@${COLS[part] + from}-${COLS[part] + to},1`

export const EXPECT: string[] = [
  `fair main@${A0 + 3}-${A0 + 22},9 with hover=off   # all the way onto Mudzilla's floor: no hover, no tight jump`,
  'not goal unless gates=open                    # the barred door behind Mudzilla: only its flag unbars it',
  'fair goal with gates=open, hover=off          # ... and then the way out is a walk',
  'reach checkpoints',
  'fair token1, token2 with hover=off            # over the belt; in the floor jet on the island',
  'not token3 unless grime=washed                # the vault token: behind the grime at the back of the near bay',
  'not area:vault unless grime=washed',
  'fair token3 with grime=washed, hover=off',
  'reach tokens with all',
  'reach coins, blocks with grime=washed         # every coin and crate, the vault\'s among them',
  `not ${top('BRUSHES', 4, 23)}, ${top('FOAM', 2, 25)}, ${top('CANAL', 19, 27)} with all   # nobody walks on top of a gantry`,
  `not ${top('CROSSFIRE', 15, 32)}, main@${X0 + 42}-${X0 + 71},1 with all                  # ... or over the crossfire and the treadmill`,
]

const level: LevelDef = {
  id: meta.id,
  site: meta.site,
  name: meta.name,
  time: meta.time,
  music: meta.music,
  areas: [main, vault, exit],
}

export default level
