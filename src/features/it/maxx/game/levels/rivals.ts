// RIVAL ROW, the secret world: the alley behind the wash at night, four duels in order, then
// the trophy room. Nine small areas joined by doors, always in on the left and out on the right:
//
//   alley -> BILL -> yard1 -> STREAKS -> yard2 -> OLLIE -> yard3 -> NICK -> trophy
//      \______________^___________________^___________________^   back doors (1, 2, 3 washed)
//
// Each arena is its rival's tested room to the tile (NOTES.md 9.3): 20 x 12, both walls solid,
// Maxx in at column 2, the way on a door in column 17 locked on rivalsBeaten, and nothing else
// but scenery behind the play. A rival already beaten removes itself.
//
// The back doors: every visit starts in the alley, and the save brings back only rivalsBeaten,
// so a returning player (and anyone after a game over) used to walk the whole row again. An
// arcade near the start holds three doors locked on rivalsBeaten 1, 2 and 3, each to the yard
// before the next rival, where his pit stop is. The flag only rises as a rival falls, and no
// door leads back to the alley, so a first visit still meets the four in order: all three are
// barred until then. A champion takes the third and walks through Nick's empty arena.
//
// Before every arena there is a pit stop built against the right wall: a low roof on a post
// over a checkpoint, a bubble and a turbo nozzle, stepping up to a higher roof over the door.
// Under the low roof there are two tiles of headroom, so nothing under it can be jumped, and
// the roof runs to the wall, so nothing gets to the door but through it: whoever goes in to
// fight has the flag and was offered the bubble and the nozzle. (The higher roof is there
// because a door's {up} prompt is drawn behind the tiles: a ceiling two tiles up hides it. The
// lamp hangs from it beside the door: under the low roof its cable poked up through the roof.)
//
// Tokens: 1 on the alley's fire escape (in plain sight, awkward), 2 in the canopy hatch of
// yard3 (behind grime only water aimed up reaches: the lesson Nimbus Nick needs), 3 on a tall
// pedestal in the trophy room (the spring at its foot, and a steer over its edge). Token 1 hangs
// a tile over its landing, where standing on the landing touches it and a jump from the floor,
// its head through the catwalk, stops 25 px short (a landing a row higher kept Maxx's head under
// the HUD as he took it). The hatch is three blocks wide with the token over the middle one: a
// slot one block wide takes a jump from a stand placed to 11 px either way, the whole hatch twice
// that.
//
// No blower anywhere. The only critter is one blob on the alley floor, in the open, asleep
// until the camera leaves the start, and it guards nothing. Nothing solid stands on its left:
// behind a crate, water from the floor could not reach it and a hop over the crate landed on
// it. The crate on its right keeps it out of the first pit stop (where a retry begins).
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { RIVALS_META } from './meta'

const meta = RIVALS_META

const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })
const decor = (name: string): SpawnSpec => ({ kind: 'decor', props: { sprite: `decor_${name}` } })
const token = (index: number): SpawnSpec => ({ kind: 'token', props: { index } })
const arrive: SpawnSpec = { kind: 'marker', props: { name: 'in' } }
/** The way on. `beaten` is how many rivals must be down before it unbars. */
const door = (to: string, beaten = 0): SpawnSpec => ({
  kind: 'door',
  props: beaten > 0 ? { to: `${to}:in`, flag: 'rivalsBeaten', min: beaten } : { to: `${to}:in` },
})

/** Scenery, one character each wherever it is used. */
const DECOR: Record<string, SpawnSpec> = {
  N: decor('neon_mw'),
  E: decor('neon_open'),
  a: decor('neon_arrow'),
  e: decor('stencil_employees'),
  x: decor('sign_exit'),
  l: decor('light_pole'),
  q: decor('trash_can'),
  F: decor('fence'),
  J: decor('dumpster'),
  K: decor('trash_bags'),
  V: decor('cone'),
  Y: decor('power_pole'),
  A: decor('poster_bill'),
  Z: decor('oil_drum'),
  ':': decor('lamp_hang'),
  '5': decor('crest'),
  '6': decor('chandelier'),
  '7': decor('rope_barrier'),
  '8': decor('portrait'),
  '9': decor('plant'),
  '&': decor('vault_door'),
  '+': decor('sign_lube'),
}

/** An area's legend: its own things, plus the scenery its rows use. */
function legendFor(rows: string[], own: Record<string, SpawnSpec>): Record<string, SpawnSpec> {
  const used = new Set(rows.join(''))
  const legend: Record<string, SpawnSpec> = { ...own }
  for (const [ch, spec] of Object.entries(DECOR)) if (used.has(ch) && !(ch in own)) legend[ch] = spec
  return legend
}

function backlot(id: string, rows: string[], own: Record<string, SpawnSpec>): AreaDef {
  return { id, theme: 'backlot', rows, legend: legendFor(rows, own) }
}

/* ------------------------------------------------------------------ */
/* The alley                                                           */
/* ------------------------------------------------------------------ */

// Fifteen rows, three of them sky over the twelve that show from the floor: a 12-row area holds
// its camera still, and a full jump off the second catwalk would carry Maxx off the top of the
// screen behind the HUD. Here the camera climbs with him.
//
// The back doors (1, 2, 3: the rivals washed that open each) stand under a brick arcade on the
// first screen, the deepest first: the first one a returning player finds unbarred is the one
// he wants, whether or not he read the sign that names them. The arcade's slab is a tile above
// the doors, as over the porch doors: a lower one hides their {up} prompt. The sign stands four
// tiles from the first one so the two boards never show at once.
const ALLEY = [
  //         1         2         3         4         5
  //12345678901234567890123456789012345678901234567890123456789
  '%                                                          %',
  '%                                                          %',
  '%                                                          %',
  '%                                                          %',
  '%                                                          %',
  '%     N                                 ooo $              %',
  '%                                      o                   %',
  '%                                  ooo     ===             %',
  '% x          ooo                  =====    | |           E %',
  '%  e      %%%%%%%%%%  H       oo  |   |    | |    ooo  %%%%%',
  '%         |        |  o      ==== |   |    | |   %%%%%%%   %',
  '%         |        |    A    |  | |   | A  | |   |      :  %',
  '% @  S   Q|3  2  1 |  J K l  |  | | q | b  | |X R|kF*FT  DA%',
  '############################################################',
  '############################################################',
]

const alley = backlot('alley', ALLEY, {
  S: sign('RIVAL ROW. FOUR CUT-RATE WASHES. ONE CLEAN HERO.'),
  Q: sign('BACK DOORS: NICK, OLLIE, STREAKS.\nEACH RIVAL WASHED OPENS ONE.'),
  R: sign('BUCKET BROS DRIVEWAY WASH. ONE SLOSH AND WE ARE EMPTY.'),
  $: token(0),
  T: { kind: 'turbo' },
  D: door('bill'),
  '1': door('yard1', 1),
  '2': door('yard2', 2),
  '3': door('yard3', 3),
})

/* ------------------------------------------------------------------ */
/* The four arenas                                                     */
/* ------------------------------------------------------------------ */

const BILL = [
  //         1
  //1234567890123456789
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%    A  A          %',
  '%                  %',
  '%qm           1  D %',
  '####################',
  '####################',
]

const STREAKS = [
  //         1
  //1234567890123456789
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%Vm            2 DV%',
  '####################',
  '####################',
]

const OLLIE = [
  //         1
  //1234567890123456789
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%      ======      %',
  '%                  %',
  '%Zm           3  DZ%',
  '####################',
  '####################',
]

const NICK = [
  //         1
  //1234567890123456789
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%                  %',
  '%  ====      ====  %',
  '%                  %',
  '%Ym       4      D %',
  '####################',
  '####################',
]

const bill = backlot('bill', BILL, { m: arrive, '1': { kind: 'bill' }, D: door('yard1', 1) })
const streaks = backlot('streaks', STREAKS, { m: arrive, '2': { kind: 'streaks' }, D: door('yard2', 2) })
const ollie = backlot('ollie', OLLIE, { m: arrive, '3': { kind: 'ollie' }, D: door('yard3', 3) })
const nick = backlot('nick', NICK, { m: arrive, '4': { kind: 'nick' }, D: door('trophy', 4) })

/* ------------------------------------------------------------------ */
/* The yards between them: a pit stop each                             */
/* ------------------------------------------------------------------ */

const YARD1 = [
  //         1         2
  //12345678901234567890123
  '%                      %',
  '%                      %',
  '%                      %',
  '%                      %',
  '%                      %',
  '% ooo             oo E %',
  '% ?C?        a a  %%%%%%',
  '%           %%%%%%%    %',
  '%           |       :  %',
  '% mF FVVV R |k * T   D %',
  '########################',
  '########################',
]

const YARD2 = [
  //         1         2
  //12345678901234567890123
  '%                      %',
  '%                      %',
  '%                      %',
  '%                      %',
  '%                      %',
  '%                    E %',
  '%     h      ooo  %%%%%%',
  '%     o     %%%%%%%    %',
  '%     o     |       :  %',
  '% mZZ   + R |k * T K DZ%',
  '########################',
  '########################',
]

const YARD3 = [
  //         1         2
  //1234567890123456789012345
  '%                        %',
  '%                        %',
  '%                        %',
  '%%%%%%%                  %',
  '%%%%%%%                  %',
  '%%o$o%%                E %',
  '%%ggg%%         ooo  %%%%%',
  '%              %%%%%%%   %',
  '%              |      :  %',
  '% m      S Y R |k * T  D %',
  '##########################',
  '##########################',
]

const yard1 = backlot('yard1', YARD1, {
  m: arrive,
  R: sign('STREAK CITY EXPRESS. WE STOP FOR NOTHING. EXCEPT WALLS.'),
  T: { kind: 'turbo' },
  D: door('streaks'),
})

const yard2 = backlot('yard2', YARD2, {
  m: arrive,
  R: sign("SLICK'S LUBE-N-SPLASH. REFILLS WHILE YOU WAIT."),
  T: { kind: 'turbo' },
  D: door('ollie'),
})

const yard3 = backlot('yard3', YARD3, {
  m: arrive,
  S: sign('CLOGGED GUTTER.\nHOLD {up} AND {spray} TO WASH OVERHEAD.'),
  R: sign('FREE RAIN WASH CO. NICK FLOATS.\nHOLD {up} AND {spray} UNDER HIM.'),
  $: token(1),
  T: { kind: 'turbo' },
  D: door('nick'),
})

/* ------------------------------------------------------------------ */
/* The trophy room                                                     */
/* ------------------------------------------------------------------ */

// The skill token stands on a pedestal seven tiles over the floor, under the MW crest: too high
// for any jump, and fifteen tiles from the podium, the next highest place (there is no balcony:
// from one the hover reached a pedestal eight tiles off). Only the spring at its foot throws him
// that high. It stands two tiles short of the pedestal, so a bounce held toward it too soon, at
// a run, knocks his head on its underside: he must rise beside it and steer over the edge, and
// the coins over the spring show that line. A token floating higher, with no pedestal, hid under
// the HUD while he stood on the floor; on a pedestal a row higher it would too.
const TROPHY = [
  //         1         2         3         4         5
  //123456789012345678901234567890123456789012345678901
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '%                                                  %',
  '%               6                                  %',
  '%                       o                          %',
  '%                         5                        %',
  '%          8              $                        %',
  '%                      o ###                N      %',
  '%                         |  o   o o   o           %',
  '%                      o  |  oo oo o   o           %',
  '%                         |  o o o o o o           %',
  '%       Q              o  |  o   o oo oo           %',
  '%       ##    oooooo      |  o   o o   o           %',
  '% m 9 ###### 9  &   9  y  |  7 7 7 7 7 7 S  G     9%',
  '####################################################',
  '####################################################',
]

const trophy: AreaDef = {
  id: 'trophy',
  theme: 'bonus',
  music: 'bonus',
  rows: TROPHY,
  legend: legendFor(TROPHY, {
    m: arrive,
    S: sign('RIVAL ROW IS SPOTLESS.\nTAKE A BOW, CHAMP.'),
    $: token(2),
    Q: { kind: 'oneup' },
  }),
}

/**
 * What must be true of the map (node scripts/maxx/level.mjs expect rivals). The arena doors and
 * the back doors wait for rivalsBeaten, which only a beaten rival raises: `gates=open` stands for
 * all four down, so it opens every back door too. That each back door opens at its own count is
 * not something expect can say; the stored runs from rivalsBeaten 1, 2 and 3
 * (scripts/maxx/replays/rivals-resume<n>.json) each walk through the one their count opens.
 */
export const EXPECT: string[] = [
  'not goal unless gates=open                       # the exit arch is behind all four rivals',
  'fair goal with gates=open, hover=off within 30s  # with them down: the third back door, Nick\'s empty arena, the trophy room',
  'not area:yard1 unless gates=open                 # nothing past Bill without beating him: his door and the first back door are barred',
  'not area:yard2 unless gates=open                 # nor past Streaks',
  'not area:yard3 unless gates=open                 # nor past Ollie',
  'not area:trophy unless gates=open                # nor the trophy room',
  'fair area:yard3 with gates=open, hover=off within 6s  # a back door: the pit stop before Nick is seconds from the start',
  'reach checkpoints with gates=open                # a flag before every arena',
  'reach token1                                     # the fire escape, before any rival',
  'fair token1 with hover=off                       # awkward, never tight',
  'not token2 with gates=open unless grime=washed   # the canopy hatch: only washing the grime opens it (and only water aimed up reaches it)',
  'fair token3 with gates=open, hover=off           # the tall pedestal: the spring, then steer over its edge; no hover, no tight take-off',
  'reach tokens with all',
  'reach coins with all                             # no coin is out of reach for good',
  'reach blocks with gates=open                     # every crate can be bumped: the hidden one over the dumpster and the hidden 1UP of yard2 too',
]

const level: LevelDef = {
  id: meta.id,
  site: meta.site,
  name: meta.name,
  time: meta.time,
  music: meta.music,
  areas: [alley, bill, yard1, streaks, yard2, ollie, yard3, nick, trophy],
}

export default level
