// Test arenas for secret rivals 1 and 2 (sim/entities/rival_bill.ts, rival_streaks.ts),
// built the way the real ones should be: each a closed room of its own, exactly one screen.
//
//   20 columns by 12 rows. Columns 0 and 19 are wall from top to bottom, rows 10 and 11
//   are plain ground, and the 18 columns between are open air: no platforms, no blocks,
//   no other enemies, no special floor.
//   Maxx arrives at column 2 or 3 (the start, or a marker a door leads to).
//   Bucket Bill stands in column 14, Sir Streaks in column 15 (feet on row 9).
//   The way on is a door in column 17 that opens on the flag rivalsBeaten.
//
// Area 'pair' has both in one area, one after the other (39 columns: Bill's arena 0..19, Sir
// Streaks's 19..38, the wall between them shared, Bill's door leading to a marker in the second).
//
//   dev/maxx.html?scene=viewer&level=dev-rivals-a                              Bucket Bill
//   dev/maxx.html?scene=viewer&level=dev-rivals-a&params={"area":"streaks","col":3}   Sir Streaks
//   dev/maxx.html?scene=viewer&level=dev-rivals-a&params={"area":"pair","col":3}      both
import type { AreaDef, LevelDef } from '../../contract'

const OPEN = '%                  %'
const GROUND = '####################'

function arena(row9: string): string[] {
  return [OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, row9, GROUND, GROUND]
}

const bill: AreaDef = {
  id: 'bill',
  theme: 'backlot',
  rows: arena('%  @          1  D %'),
  legend: {
    '1': { kind: 'bill' },
    D: { kind: 'door', props: { to: 'streaks:in', flag: 'rivalsBeaten', min: 1 } },
  },
}

const streaks: AreaDef = {
  id: 'streaks',
  theme: 'backlot',
  rows: arena('% m            2 D %'),
  legend: {
    '2': { kind: 'streaks' },
    m: { kind: 'marker', props: { name: 'in' } },
    D: { kind: 'door', props: { to: 'out:in', flag: 'rivalsBeaten', min: 2 } },
  },
}

// Both in one area, one after the other: two arenas side by side sharing a wall (column 19), the
// way from the first to the second a door to a marker in the same area. Sir Streaks's walls must
// be solid where he dashes into them, so no walk-through gap between the two.
const PAIR_OPEN = '%                  %                  %'
const PAIR_GROUND = '#'.repeat(39)
const pair: AreaDef = {
  id: 'pair',
  theme: 'backlot',
  rows: [
    ...Array.from({ length: 9 }, () => PAIR_OPEN),
    '%             1  D % m            2 E %',
    PAIR_GROUND,
    PAIR_GROUND,
  ],
  legend: {
    '1': { kind: 'bill' },
    '2': { kind: 'streaks' },
    m: { kind: 'marker', props: { name: 'in2' } },
    D: { kind: 'door', props: { to: 'in2', flag: 'rivalsBeaten', min: 1 } },
    E: { kind: 'door', props: { to: 'out:in', flag: 'rivalsBeaten', min: 2 } },
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
  id: 'dev-rivals-a',
  site: 'DEV',
  name: 'RIVALS A',
  time: 900,
  music: 'rival',
  areas: [bill, streaks, out, pair],
}

export default level
