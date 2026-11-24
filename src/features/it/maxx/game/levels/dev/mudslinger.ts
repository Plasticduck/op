// Dev room for MUDSLINGER (sim/entities/mudslinger.ts): its arena, built exactly as the end
// of MW04 should build it, with a short way in and a short way out.
//
//   columns 0-7    the way in: the start, a checkpoint just before the arena
//   columns 8-27   the arena, one screen: a wall each side (columns 8 and 27) down to a
//                  doorway two tiles high, a flat floor, catwalks three tiles up over arena
//                  columns 5-7 and 12-14, the truck's character in arena column 16 (column 24)
//   column 27      the gate ('1', h 2) fills the right doorway and opens on flag 'mudslinger'
//   columns 28-35  the way out to the exit arch
//
//   dev/maxx.html?scene=viewer&level=dev-mudslinger
// scripts/maxx/tests/mudslinger.mjs fights it here.
import type { LevelDef } from '../../contract'

const level: LevelDef = {
  id: 'dev-mudslinger',
  site: 'DEV',
  name: 'MUDSLINGER ARENA',
  time: 400,
  music: 'storm',
  areas: [
    {
      id: 'main',
      theme: 'storm',
      rows: [
        '        %                  %        ',
        '        %                  %        ',
        '        %                  %        ',
        '        %                  %        ',
        '        %                  %        ',
        '        %                  %        ',
        '        %                  %        ',
        '        %    ===    ===    %        ',
        '                                    ',
        '  @  k                  S  1    G   ',
        '####################################',
        '####################################',
      ],
      legend: {
        S: { kind: 'mudslinger' },
        '1': { kind: 'gate', props: { flag: 'mudslinger', min: 1, h: 2 } },
      },
    },
  ],
}

export default level
