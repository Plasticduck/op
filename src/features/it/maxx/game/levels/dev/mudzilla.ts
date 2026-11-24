// Dev room for MUDZILLA (sim/entities/mudzilla.ts): its arena, built exactly as the end of
// MW08 should build it, with a short way in.
//
//   columns 0-13   the way in: start, then a checkpoint eleven tiles before the doorway (far
//                  enough that its CHECKPOINT! banner is gone before the versus card comes up)
//   column 14      the left wall, from the top of the area down to a doorway two tiles high
//                  (Mudzilla drops a steel shutter into it when the fight starts)
//   columns 15-36  the arena floor, 22 tiles of plain ground: no pits, no blocks, no slopes;
//                  catwalks three tiles up over arena columns 7-9 and 12-14 (absolute 22-24
//                  and 27-29); a power block over arena column 11 (absolute 26), its underside
//                  five tiles up (clear of a head on the catwalks, a full jump from the floor);
//                  Mudzilla's character on the floor row in arena column 18 (absolute 33):
//                  it parks itself against the right wall
//   column 37      the right wall, the whole height of the area, and the area's last column:
//                  when the camera is let go after the fight there is nothing beyond it to show
//   open sky above the arena: its mud comes down from above the screen.
//   area 'exit'    a goal nobody can reach (no pipe or door leads there): the validator wants
//                  an exit, and Mudzilla completes the level itself.
//
//   dev/maxx.html?scene=viewer&level=dev-mudzilla
//   dev/maxx.html?scene=play&params={"level":"dev-mudzilla"}
// scripts/maxx/tests/mudzilla.mjs fights it here.
import type { LevelDef } from '../../contract'

const level: LevelDef = {
  id: 'dev-mudzilla',
  site: 'DEV',
  name: 'MUDZILLA ARENA',
  time: 300,
  music: 'mega',
  areas: [
    {
      id: 'main',
      theme: 'mega',
      rows: [
        '              %                      %',
        '              %                      %',
        '              %                      %',
        '              %                      %',
        '              %           !          %',
        '              %                      %',
        '              %                      %',
        '              %       ===  ===       %',
        '                                     %',
        ' @ k                             Z   %',
        '######################################',
        '######################################',
      ],
      legend: {
        Z: { kind: 'mudzilla' },
      },
    },
    {
      id: 'exit',
      theme: 'mega',
      rows: [
        '                    ',
        '                    ',
        '                    ',
        '                    ',
        '                    ',
        '                    ',
        '                    ',
        '                    ',
        '                    ',
        '         G          ',
        '####################',
        '####################',
      ],
    },
  ],
}

export default level
