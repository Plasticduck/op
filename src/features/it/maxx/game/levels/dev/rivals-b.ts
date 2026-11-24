// Test arenas for secret rivals 3 and 4 (sim/entities/rival_ollie.ts, rival_nick.ts), built
// exactly the way the real ones should be: each a closed room of its own, one screen.
//
//   Both: 20 columns by 12 rows. Columns 0 and 19 are wall from top to bottom, rows 10 and
//   11 plain ground ('#', nothing special: no oil, slick, mud or conveyor), and nothing else
//   but the catwalks below: no blocks, no other enemies, no hazards, no decor in front.
//   Maxx arrives at column 2 or 3 (the start, or a marker a door leads to).
//   The way on is a door in column 17 that opens on the flag rivalsBeaten.
//
//   SLICK OLLIE  one catwalk ('=') in row 7, columns 7 to 12 (six tiles, three above the
//                floor). Ollie stands in column 14, feet on row 9.
//   NIMBUS NICK  two catwalks in row 7, columns 3 to 6 and 13 to 16 (four tiles each).
//                Nick's character goes in column 10, row 9 (on the floor: he measures his
//                heights from it and floats up from there). Rows 0 to 6 stay open: he flies
//                there.
//
//   dev/maxx.html?scene=viewer&level=dev-rivals-b                                Slick Ollie
//   dev/maxx.html?scene=viewer&level=dev-rivals-b&params={"area":"nick","col":3,"row":9}  Nimbus Nick
import type { AreaDef, LevelDef } from '../../contract'

const OPEN = '%                  %'
const GROUND = '####################'

function arena(row7: string, row9: string): string[] {
  return [OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, row7, OPEN, row9, GROUND, GROUND]
}

const ollie: AreaDef = {
  id: 'ollie',
  theme: 'backlot',
  rows: arena('%      ======      %', '%  @          3  D %'),
  legend: {
    '3': { kind: 'ollie' },
    D: { kind: 'door', props: { to: 'nick:in', flag: 'rivalsBeaten', min: 3 } },
  },
}

const nick: AreaDef = {
  id: 'nick',
  theme: 'backlot',
  rows: arena('%  ====      ====  %', '% m       4      D %'),
  legend: {
    '4': { kind: 'nick' },
    m: { kind: 'marker', props: { name: 'in' } },
    D: { kind: 'door', props: { to: 'out:in', flag: 'rivalsBeaten', min: 4 } },
  },
}

const out: AreaDef = {
  id: 'out',
  theme: 'backlot',
  rows: [
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%                      %',
    '%  m              G    %',
    '########################',
    '########################',
  ],
  legend: { m: { kind: 'marker', props: { name: 'in' } } },
}

const level: LevelDef = {
  id: 'dev-rivals-b',
  site: 'DEV',
  name: 'RIVALS B',
  time: 900,
  music: 'rival',
  areas: [ollie, nick, out],
}

export default level
