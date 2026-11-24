// MW02 VACUUM ALLEY. The vacuum bays in late afternoon light: sedans, grackles, tire stacks
// up to the canopies, lifts, and the first long gap that wants the hover. Left to right:
//
//   col   0  OPENING   the pylon sign, three bricks, three crates (the middle one hidden)
//   col  14  SEDAN     the first sedan, alone on a long flat road
//   col  31  GRACKLES  one low over open ground (aim up), then one high over an awning with a
//                      sedan parked under it (the awning is shelter, and a place to aim from)
//   col  55  CANOPY    a sedan pulls out of the vacuum bay; tire stacks up to the canopies and
//                      over the mat room; token 1 hangs off the first canopy's left end; behind
//                      the crust of grime in the mat room's doorway, the pipe to the cellar (token 2)
//   col  90  LIFTS     a pit to jump, the checkpoint, then a pit too wide: the first lift
//   col 118  HOVER     the sign, the long pit and its coin trail; the tire stacks to the high
//                      catwalk are the safe way; token 3 on a steel post a hover away from the
//                      step under the catwalk's far end
//   col 153  CLIMAX    two sedans and a grackle at once, then lift or hover over the last pit
//   col 180  EXIT      one last customer, the FREE AIR machine, the arch
//
// Cars are kept in their stretch by planters (cols 29, 53, 143, 166) and the mat room, and none
// can reach a pit. A planter never stands between a car and the place Maxx first sees it from.
//
// Every pit has sludge in its bottom row. Open, a pit showed the backdrop's brown ground a tile
// under the lip, which reads as the floor of a ditch; MW01 taught that sludge is what kills.
//
// Legend letters that the default legend gives to cars and critters this level never uses
// are scenery here (v vacuum, t trash can, u bush, c cone, f flag, w mesquite, n menu board,
// j yucca, z the OPEN board, r hose reel).
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { LEVEL_META } from './meta'

const meta = LEVEL_META.find((m) => m.id === 'mw02')!

// The sections below are drawn on the usual twelve rows (floor in rows 10 and 11). One open
// row goes on top of them: at 13 rows the area is taller than the screen, so the camera can
// rise 56 px, a little less than the depth of the ground. The top of a tire-stack bounce, Maxx
// on the high catwalk and the hover for token 3 stay in the picture, and the floor line and
// whatever drives on it never leave it.
const SKY = 1
const DRAWN = 12
const ROWS = SKY + DRAWN

/** One stretch of the level, `width` tiles wide: the rows given, over two rows of ground unless a row says otherwise. */
function section(width: number, rows: Record<number, string>): string[] {
  const out: string[] = []
  for (let y = -SKY; y < DRAWN; y++) out.push((rows[y] ?? (y >= DRAWN - 2 ? '#'.repeat(width) : '')).padEnd(width).slice(0, width))
  return out
}

const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })
const decor = (name: string): SpawnSpec => ({ kind: 'decor', props: { sprite: `decor_${name}` } })
const parked = (paint: number): SpawnSpec => ({ kind: 'car', variant: 'sedan', props: { speed: 0, paint } })

const LEGEND: Record<string, SpawnSpec> = {
  A: sign('SEDANS ARE MUDDIER. HOLD {spray} UNTIL THEY SHINE.'),
  E: sign('GRACKLES DROP SPLATS.\nHOLD {up} AND {spray} TO AIM HIGH.'),
  T: sign('TIRE STACKS BOUNCE YOU HIGH. LAND ON TOP, THEN STEER.'),
  N: sign('IN THE AIR,\nHOLD {down} AND {spray} TO HOVER ACROSS.'),
  F: sign('NOT SURE? BOUNCE UP. THE HIGH ROAD IS SAFE.'),
  '1': { kind: 'token', props: { index: 0 } },
  '3': { kind: 'token', props: { index: 2 } },
  Q: { kind: 'pipe', props: { to: 'bonus:in' } },
  q: { kind: 'marker', props: { name: 'out' } },
  '5': { kind: 'lift', props: { dx: 5, speed: 80, wait: 90, w: 4 } },
  '7': { kind: 'lift', props: { dx: 5, speed: 80, wait: 90 } },
  '8': { kind: 'bird', props: { range: 3 } },
  S: parked(1),
  Z: parked(2),
  Y: { kind: 'car', variant: 'sedan', props: { paint: 1 } },
  D: decor('sign_mw'),
  f: decor('flag'),
  l: decor('light_pole'),
  v: decor('vacuum'),
  V: decor('vacuum_arch'),
  m: decor('mat_rack'),
  a: decor('air_machine'),
  t: decor('trash_can'),
  u: decor('bush'),
  c: decor('cone'),
  J: decor('sign_vacuums'),
  w: decor('mesquite'),
  x: decor('grass'),
  K: decor('kiosk'),
  e: decor('bench'),
  n: decor('menu_board'),
  j: decor('yucca'),
  z: decor('sign_open'),
  r: decor('hose_reel'),
}

const SECTIONS: string[][] = [
  // 0 OPENING: bricks and crates to bump, clear of the road the first sedan comes down. The
  // gap between the two crates is a hidden one.
  section(14, {
    5: '          o',
    6: '     BCB ?H?',
    9: ' @D   K   f fl',
  }),

  // 14 SEDAN: the first one, alone on a long flat road. The planter past it is the end of its run.
  section(17, {
    7: '               u',
    8: '               ##',
    9: 'A e v ooo m  s ##',
  }),

  // 31 GRACKLES: the first flies low enough to spray from the ground. The second is out of
  // reach from the floor, and above a full jump up through the awning: its splats fall on the
  // way in and burst on the awning over the parked sedan; from the awning's top the up aim finds it.
  section(24, {
    2: '               8',
    5: '        8',
    6: '  !',
    7: '             ======== u',
    8: '             |      | ##',
    9: 'E   l  t   J |  v S |t##',
  }),

  // 55 CANOPY: a sedan pulls out of the first bay. The tire stacks between the canopies are the
  // only way over the mat room; token 1 hangs off the first canopy's left end, a walk back along
  // it. The mat room's doorway is crusted shut over the pipe to the cellar; its mat rack shows
  // through the open front.
  section(35, {
    2: '        1',
    3: '         o       o',
    4: '           o o       o o',
    5: '          ====== o ======%%%%%%',
    6: '          |    |   |     %    %',
    7: '          |    | oo|     %  Q %q',
    8: '          |    |   |     g  PP%PP',
    9: ' l *   x  |v s |Tyy|v t ogmoPP%PP r',
  }),

  // 90 LIFTS: a pit to jump, then one nobody can. The checkpoint stands just before the first
  // lift of the game (the middle of the level): a step off it into the sludge costs the few
  // seconds back to the flag, not the walk from the start. A missed hover sends him back over
  // the lift, and the high road is there for anyone not sure of it.
  section(28, {
    6: '      ooo',
    8: '                 o o o o',
    9: 'l  n c   c k  c         c',
    10: '######   ###### 5       ####',
    11: '######~~~######~~~~~~~~~####',
  }),

  // 118 HOVER: the coin trail is the flight of a hover held from the top of the jump. The pit
  // is seven wide, one past any plain jump: a hover pressed at any moment in the air crosses it,
  // even from a tile short of the lip (at eight it landed on the far lip's last pixels). The
  // catwalk is the safe way. The step hung off its far end is where token 3 is tried from:
  // low enough to be jumped onto from the floor (another go costs nothing) and for the whole
  // hover to stay on screen. The token sits on a steel post so that nothing takes it from
  // below. The planter keeps the climax's sedans out of the pit.
  section(35, {
    2: '  oo                            3',
    3: '  ===================          XXX',
    4: '  |         oooo    |           |',
    5: '  |        o    o   |           |',
    6: '  |              o  |===        |',
    7: '  |       o         |           |',
    8: '  |                 |    #      |',
    9: ' N| yy F c       c  |    #  jw  |',
    10: '##########       ##################',
    11: '##########~~~~~~~##################',
  }),

  // 153 CLIMAX: two sedans and a grackle together, then the last pit: wait for the lift or
  // hover it. The low planter ends the sedans' run short of the pit.
  section(27, {
    4: '                     oooo',
    5: '      8             o    o',
    6: '   h                      o',
    7: '  ooo              o',
    8: '             u',
    9: '*l  v  s m Y #   c',
    10: '################### 7      ',
    11: '###################~~~~~~~~',
  }),

  // 180 EXIT: the last sedan is parked far enough from the pit to be washed from solid ground.
  section(19, {
    9: 'cz    VZ a  G  f fl',
  }),
]

const rows: string[] = []
for (let y = 0; y < ROWS; y++) rows.push(SECTIONS.map((s) => s[y]).join(''))

const main: AreaDef = { id: 'main', theme: meta.theme, rows, legend: LEGEND }

// The mat room's cellar: coins, and token 2 over the tire stacks at the end of a shelf, a tile
// past a plain jump from the pipe. Nothing hangs right of the token on its row: that is where
// the backdrop's TOKEN VAULT lettering slides as the camera moves.
const bonus: AreaDef = {
  id: 'bonus',
  theme: 'bonus',
  music: 'bonus',
  rows: [
    '%%%%%%%%%%%%%%%%%%%%%%%%',
    '%                      %',
    '%   c  oooo2       c   %',
    '%      ======          %',
    '%                      %',
    '%     o    oo    o     %',
    '%    o o   oo   o o    %',
    '%  4       oo       5  %',
    '%  PP  ooo    ooo   PP %',
    '%  PPp     yy     p PP %',
    '########################',
    '########################',
  ],
  legend: {
    '2': { kind: 'token', props: { index: 1 } },
    '4': { kind: 'marker', props: { name: 'in' } },
    '5': { kind: 'pipe', props: { to: 'main:out' } },
    c: decor('chandelier'),
    p: decor('plant'),
  },
}

/** Checked by `node scripts/maxx/level.mjs expect mw02`. */
export const EXPECT: string[] = [
  'fair goal with hover=off             # the tire stacks and the high catwalk: nobody needs the hover',
  'reach goal within 135s               # the cheapest fair route, rest to rest, inside 45% of the clock',
  'reach checkpoints',
  'reach token1 with hover=off          # a hop off the left end of the first canopy',
  'not token2 unless grime=washed       # down the pipe behind the crusted doorway',
  'not area:bonus unless grime=washed   # ... which is the only way into the cellar',
  'not token3 with hover=off            # on the steel post: seven tiles of air and three tiles up from the step',
  'reach token3 with hover=top          # ... which the hover this level teaches crosses',
  'reach tokens with all',
  'reach blocks                         # every crate and brick, the hidden two included, can be bumped',
  'reach coins with grime=washed        # no coin is bait: every one can be had (the cellar ones once the door is washed)',
  'not token3 with hover=off,cars=roofs # ... and no washed sedan is a step to it (a roof is 26 px short of the post)',
]

const level: LevelDef = { id: meta.id, site: meta.site, name: meta.name, time: meta.time, music: meta.music, areas: [main, bonus] }

export default level
