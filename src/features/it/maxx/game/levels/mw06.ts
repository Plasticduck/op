// MW06 BUG SEASON BOULEVARD: the sunset highway. Speed: sports cars that rev before they
// come, bug swarms, grackles, tire stacks, and three ditches of road spikes that only a
// washed car's roof crosses on the low road. Left to right (columns):
//
//     0  the on-ramp: the first swarm, crates, the first bug-splattered SUV
//    36  THE FAST LANE: a pit that swallows what gets past him, the rev sign, crates with
//        token 1 over them, a sports car alone, then an SUV with a sports car stuck behind it
//    69  a tire stack over a five-tile wall (no way back: ditch 1's car is only woken past it,
//        so it can never drive off behind the camera for good)
//    79  DITCH 1: a clean SUV shuttles over the spikes. Ride it (a car is always there)
//    98  THE OVERPASS: a tire stack up to the deck and its grackles. The road under the deck
//        is a dead end with a trail of coins, a wall of grime and, behind it, a storm drain:
//        the pipe down to the drain room (token 2 and the EMPLOYEES ONLY door)
//   136  the checkpoint
//   140  DITCH 2: wash the sedan in the bay, ride it over the spikes to the garage and its
//        1UP. The other way: the tire stack and the gantries above
//   165  a wax crate, a pit, rush hour (an SUV with two sports cars stuck behind it) and the
//        sky pad of token 3: a tire stack, then eight tiles of hover
//   197  DITCH 3: sports cars come out from under the near rim every eight seconds and run the
//        low road one way. Wash one in the bay and ride it; or take the gantries, a grackle
//        and a swarm
//   238  the exit
//
// Proof: `node scripts/maxx/level.mjs expect mw06`, the replays in scripts/maxx/replays/mw06-*,
// and the note over EXPECT below on what the tools cannot see (rides on cars washed in play).
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { LEVEL_META } from './meta'
import { sheet } from './mw06/grid'

const meta = LEVEL_META.find((m) => m.id === 'mw06')!

const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })
const decor = (name: string, flip = false): SpawnSpec => ({ kind: 'decor', props: { sprite: `decor_${name}`, flip } })

/* ------------------------------------------------------------------ */
/* The boulevard                                                       */
/* ------------------------------------------------------------------ */

const W = 250
const H = 14
/** The road's top row, and the floor of the low road three tiles down. */
const ROAD = 10
const LOW = 13
/** The row things stand in on the low road. */
const DITCH = LOW - 1

const g = sheet(W, H)
g.fill(0, W - 1, ROAD, H - 1, '#')

// The on-ramp.
g.put(2, 9, '@')
g.put(6, 9, 'A')
g.dots(8, 'o', [10, 11, 12])
g.put(15, 6, '?!?')
g.dots(8, 'o', [20, 21, 22])
// The first swarm of the game, in view from the start between the pylon sign and the crates,
// with open road all round. It wakes at the sign and is met before the SUV wakes (at 33 it met
// him beside the SUV and the pit; at 20, just as the SUV woke; at 12 it hid in the pylon sign).
g.put(13, 7, 'Z')
g.put(28, 9, 'v')

// The fast lane. Cars that get past him go into the pit.
g.fill(36, 39, ROAD, H - 1, ' ')
g.dots(6, 'o', [37, 38])
g.put(41, 9, 'D')
g.put(46, 6, '?C?')
// Row 3, not 2: seen from the road, row 2 sits under the HUD's token tray and reads as part of it.
g.put(47, 3, '7')
g.dots(9, 'o', [50, 51, 52, 53])
g.dots(8, 'o', [59, 60, 61])
g.put(56, 9, 'f')
g.put(62, 9, 'v')
g.put(67, 9, 'f')
g.put(69, 9, 'yy')
g.dots(7, 'o', [69])
g.dots(5, 'o', [69])
g.dots(3, 'o', [70, 71])
g.fill(72, 73, 5, 9, '%')

// Ditch 1: the clean SUV is always there.
g.put(75, 9, 'K')
g.fill(79, 92, ROAD, DITCH, ' ')
g.fill(79, 92, DITCH, DITCH, '^')
g.put(91, DITCH, 'S')
g.dots(ROAD, 'o', [81, 83, 85, 87, 89, 91])

// The overpass, the dead end under it and the storm drain.
g.put(101, 9, 'yy')
g.dots(6, 'o', [101])
g.dots(4, 'o', [102])
g.fill(104, 125, 5, 5, '#')
g.fill(113, 116, 5, 5, ' ')
g.put(114, 9, 'yy')
g.fill(107, 107, 6, 9, '|')
g.fill(118, 118, 6, 9, '|')
g.fill(122, 125, 6, 7, '%')
g.fill(122, 123, 8, 9, 'g')
g.put(124, 9, '1')
g.put(124, ROAD, 'PP')
g.fill(126, 131, 5, 9, '%')
g.fill(132, 133, 7, 9, '%')
g.dots(9, 'o', [105, 109, 111, 117, 120])
// A 1UP nobody can see, between two coins worth a hop.
g.put(109, 7, 'oho')
g.dots(4, 'o', [106, 107, 108, 118, 119, 120, 129, 130, 131])
// Grackles two tiles over the deck fly a shallow wave (row 2 with the usual wave grazes his head
// as he stands there). The first keeps to the deck's left half, off the gap and the tire stack's
// throw under it.
g.put(107, 2, '3')
g.put(128, 2, '4')

// The checkpoint.
g.put(136, 9, 'k')
g.put(138, 6, '!')

// Ditch 2: wash the sedan, ride it to the garage. The gantries are the other way.
g.put(140, 9, 'J')
g.put(142, 9, 'yy')
g.fill(145, 162, ROAD, DITCH, ' ')
g.fill(163, 166, ROAD + 1, DITCH, ' ')
g.fill(150, 160, DITCH, DITCH, '^')
g.put(156, DITCH, 'e')
g.dots(ROAD + 1, 'o', [151, 153, 155, 157, 159])
g.put(146, 5, '===')
g.put(151, 6, '===')
g.put(157, 6, '===')
g.put(155, 3, 'u')
g.put(163, DITCH, 'ool')
g.put(168, 6, '?W?')
g.put(173, 9, 'X')

// Rush hour, and the sky pad.
g.fill(174, 177, ROAD, H - 1, ' ')
g.dots(6, 'o', [175, 176])
g.dots(9, 'o', [181, 182, 183])
g.put(188, 9, 'v')
g.put(192, 9, 'f')
g.put(196, 9, 'f')
g.put(183, 6, 'u')
// Steel, not a gantry: a jump from the road must not put his head through it and into the token.
g.put(186, 4, 'XX')
g.put(186, 3, '9')
g.put(196, 4, '===')
g.put(194, 9, 'Y')
g.dots(3, 'o', [189, 194])
g.dots(2, 'o', [190, 191, 192, 193])

// Ditch 3: the fast ones come out from under the near rim, one after another, and run the low
// road one way: into the pit under the far deck. Stand off the lane on the gantry step, drop
// into the bay behind one, wash the next as it comes and ride it.
g.put(198, 9, 'N')
g.put(199, 9, 'yy')
g.fill(197, 201, ROAD + 1, DITCH, ' ')
g.put(197, DITCH, '^^q^^')
g.fill(202, 228, ROAD, DITCH, ' ')
g.put(202, ROAD + 1, '===')
g.fill(210, 225, DITCH, DITCH, '^')
// A coin a tile at roof height: the fast ride rings them all.
g.fill(210, 225, ROAD + 1, ROAD + 1, 'o')
g.fill(229, 235, ROAD + 1, DITCH, ' ')
g.put(229, DITCH, '^^^')
g.fill(232, 235, LOW, LOW, ' ')
g.put(203, 5, '===')
g.put(210, 6, '==')
g.put(216, 5, '==')
g.put(222, 6, '==')
g.dots(4, 'o', [204, 216, 217])
g.dots(5, 'o', [210, 211, 222, 223])
g.put(214, 2, '2')
g.put(220, 3, 'u')

// The exit.
g.dots(9, 'o', [232, 233, 234])
g.put(238, 9, '*')
g.put(243, 9, 'G')

// Scenery, behind everything: only where nothing else stands.
g.dress('Q', [[10, 9]])
g.dress('a', [[4, 9], [247, 9]])
g.dress('T', [[24, 9], [60, 9], [96, 9], [140, 9], [182, 9]])
g.dress('_', [[18, 9], [20, 9], [22, 9], [42, 9], [44, 9], [52, 9], [54, 9], [178, 9], [180, 9], [184, 9]])
g.dress(',', [[1, 9], [13, 9], [31, 9], [48, 9], [65, 9], [78, 9], [94, 9], [99, 9], [112, 9], [135, 9], [164, 9], [190, 9], [231, 9], [245, 9]])
g.dress('.', [[8, 9], [35, 9], [58, 9], [103, 9], [121, 9], [171, 9], [194, 9], [235, 9]])
g.dress(':', [[12, 9], [43, 9], [97, 9], [139, 9], [185, 9]])
g.dress(';', [[26, 9], [76, 9], [134, 9], [230, 9]])
g.dress('m', [[45, 9], [166, 9]])
g.dress('F', [[128, 4]])
g.dress('R', [[73, 4]])
g.dress('x', [[77, 9], [95, 9], [144, 9]])
g.dress('E', [[236, 9]])
g.dress("'", [[240, 9], [246, 9]])
g.dress('&', [[248, 9]])

const main: AreaDef = {
  id: 'main',
  theme: meta.theme,
  rows: g.rows(),
  legend: {
    A: sign('BUG SEASON. EVERYTHING ON THIS ROAD NEEDS A WASH.'),
    D: sign('HEAR A REV? A FAST ONE IS COMING. SPRAY EARLY.'),
    K: sign('RIDE A CLEAN CAR OVER THE SPIKES.'),
    J: sign('NO CLEAN CAR? WASH ONE, THEN RIDE ITS ROOF.'),
    N: sign('FAST ONES COME OUT BELOW. FACE THEM, WASH ONE, HANG ON.'),
    Y: sign('UP THERE: IN THE AIR,\nHOLD {down} AND {spray} TO HOVER ACROSS.'),
    // Bug season: the road's cars are caked in it. An SUV takes nearly what a pickup does, a
    // sports car a third more than a clean-road one.
    v: { kind: 'car', variant: 'suv', props: { dirt: 34 } },
    f: { kind: 'car', variant: 'sports', props: { dirt: 16 } },
    Z: { kind: 'bugs', props: { range: 6 } },
    // Ditch 1: washed already, so it shuttles between the ditch walls for good.
    S: { kind: 'car', variant: 'suv', props: { clean: true } },
    // Ditch 2: one sedan, shut in between the bay wall and the back of the garage. A ride, not a SPOTLESS car.
    e: { kind: 'car', variant: 'sedan', props: { bonus: true, speed: 70 } },
    // Ditch 3: a sports car every eight seconds, all one way, so no two ever meet head on and a
    // missed one is soon followed. They are rides, not SPOTLESS cars (an endless spawner's never
    // are). The short range keeps it quiet until its tunnel is nearly on screen (no rev from
    // nowhere during rush hour), and stops it once he has ridden off.
    q: { kind: 'spawner', props: { variant: 'sports', every: 480, max: 2, delay: 30, dir: 1, range: 96 } },
    '1': { kind: 'pipe', props: { to: 'drain:in', name: 'drain' } },
    // The grackle over ditch 3 keeps to the gantries: its beat stops short of the bay.
    '2': { kind: 'bird', props: { range: 3, amp: 10 } },
    '3': { kind: 'bird', props: { range: 2, amp: 10 } },
    '4': { kind: 'bird', props: { amp: 10 } },
    '7': { kind: 'token', props: { index: 0 } },
    '9': { kind: 'token', props: { index: 2 } },
    l: { kind: 'oneup' },
    Q: decor('sign_mw'),
    a: decor('light_pole'),
    T: decor('power_pole'),
    _: decor('guardrail'),
    ',': decor('dry_grass'),
    '.': decor('rocks'),
    ':': decor('cactus'),
    ';': decor('yucca'),
    m: decor('mesquite'),
    F: decor('billboard'),
    R: decor('windsock'),
    x: decor('cone'),
    E: decor('sign_highway'),
    "'": decor('flag'),
    '&': decor('tube_man'),
  },
}

/* ------------------------------------------------------------------ */
/* The drain room                                                      */
/* ------------------------------------------------------------------ */

const drain: AreaDef = {
  id: 'drain',
  theme: 'bonus',
  music: 'bonus',
  rows: [
    '%%%%%%%%%%%%%%%%%%%%%%%%',
    '%                      %',
    '%                      %',
    '%            8         %',
    '%           ===        %',
    '%                      %',
    '%     ooo        + V + %',
    '%  5  ooo XXX    XXXXXX%',
    '%  PP ooo XXX    XXXXXX%',
    '%  PP     XXX    XXXXXX%',
    '%%%%%%%%%%%%%%%%%%%%%%%%',
    '%%%%%%%%%%%%%%%%%%%%%%%%',
  ],
  legend: {
    '5': { kind: 'pipe', props: { to: 'main:drain', name: 'in' } },
    '8': { kind: 'token', props: { index: 1 } },
    V: { kind: 'secretExit' },
    '+': decor('plant'),
  },
}

/**
 * What must be true of this level: `node scripts/maxx/level.mjs expect mw06`.
 *
 * What the tools cannot see is a car washed in play and ridden while it drives, so the proven
 * way to the goal never needs one. Ditch 1 is crossed on a car that is always there (placed
 * clean, shut in between the ditch walls, and woken only past the five-tile wall, so it can
 * never be left behind the camera for good). Ditches 2 and 3 have the gantries. The rides are
 * proven apart: by the map with a washed car parked where ditch 2's sedan starts (cars=roofs
 * below), by `fuzz --cars roofs`, and by scripts/maxx/replays/mw06-rides.json, a hand-scripted
 * player who washes and rides the sedan of ditch 2 and a sports car of ditch 3 in the real level.
 * Nothing near the drain or the sky pad stretches a jump: the level has no blower and no blob.
 */
export const EXPECT: string[] = [
  'fair goal with hover=off               # ditch 1 on the clean SUV, ditches 2 and 3 by the gantries: no hover, no car washed in play',
  'reach goal within 90s',
  'reach checkpoints',
  'fair token1 with hover=off             # over the fast lane, from the top of the crates',
  'not token2 unless grime=washed         # the drain room, behind the wall of grime under the overpass',
  'not secret unless grime=washed         # the EMPLOYEES ONLY door is in the drain room and nowhere else',
  'not area:drain unless grime=washed     # and nothing but the washed drain leads there',
  'not area:drain with cars=roofs,hidden=on # no car roof and no hidden block gets round the grime wall',
  'not secret with cars=roofs,hidden=on',
  'fair secret with grime=washed',
  'reach token3 with hover=top            # the sky pad: a tire stack, then eight tiles of the hover as level 2 teaches it',
  'not token3 with hover=off              # ... and no jump gets there without it',
  'reach tokens with all',
  'not @155-156,11 unless cars=roofs      # ditch 2: low over its spikes, between the gantries, the only place to stand is the roof of the car',
]

const level: LevelDef = { id: meta.id, site: meta.site, name: meta.name, time: meta.time, music: meta.music, areas: [main, drain] }

export default level
