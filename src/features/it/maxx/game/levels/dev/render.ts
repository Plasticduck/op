// Dev room for the world renderer and the people drawing tiles and backgrounds: one area per
// theme, each the same compact room with every tile character in every neighbour case the
// renderer knows (render/tiles.ts), and some of the theme's decor. Look at one with
//   dev/maxx.html?scene=viewer&level=dev-render&params={"area":"tunnel"}
//   dev/maxx.html?scene=viewer&level=dev-render&params={"area":"storm","free":true}
// or the whole of it at once with scripts/maxx/overview.mjs --level dev-render --area tunnel.
//
// Left to right in the standard room (68 x 12):
//   start     a door (back to the area before), a lone catwalk, coins over the pit
//   stairs    three steps up to a plateau, then a pit two tiles wide
//   walls     ground beside, under and on top of a wall; a lone column of ground; a catwalk pair
//   pillars   a pillar three high and a lone one; a run of four pipe tiles (two pipes); a long catwalk
//   floors    belts left, right and a lone one; slick, oily and mud, each two deep (and slick
//             under ground); every block over them: B C ? ! W L U X, then the hidden H h
//   slab      a floating slab two thick, decor on it
//   hazards   spikes, a sludge pit two deep, a grime wall three high
//   way on    a pipe three tall to the next area (down on it), more decor, the exit arch
//   up high   (over the hazards) a slab with the '#' rule's cases on top: oily and mud two
//             deep and one deep over ground, then slick, steel, used, grime, brick, coin
//             brick, two crates and a pipe set into it; beside it a lone column three tall
//             (kept clear of the exit arch's sign)
// 'winter' is the same room under eight more rows (an area taller than the screen), and
// 'bonus' is a vault 18 tiles wide (narrower than the screen) with all of it squeezed in.
// The pipes chain the areas in the order below and the doors run back the other way, so
// walking through tries every area change.
import type { AreaDef, LevelDef, MusicId, SpawnSpec, ThemeId } from '../../contract'

const ROOM = [
  '                                                                    ',
  '                                 4                              #   ',
  '                               ######          OO#MM#IXUgBC?!PP #   ',
  '                               ######          O##M##########PP #   ',
  '              ==                               ################     ',
  '                     ====                                           ',
  '   =       oo   #            B C ? ! W L U X H h            5       ',
  '         ##    %%    |                                    g PP      ',
  '        ###    %%  # |                                    g PP      ',
  '2 @ 1 8####   #%% 3# | |PPPP0            #      9  ^^     g PP 6 G  ',
  '###########  ################<<<#>>>#<#III#OOO#MMM###~~~############',
  '###########  ##########################III#OOO#MMM###~~~############',
]

/** Eight rows over the room: a high slick ledge on a wall, catwalks up to it, a hanging block of ground, a tall pillar. */
const HIGH = [
  '                                                                    ',
  '                                            7                       ',
  '                                        IIIIIIIII   |               ',
  '                                        %%%%%%%%%   |               ',
  '                                  ===   %%%%%%%%%   |               ',
  '            ##                                      |               ',
  '            ##              ====                    |               ',
  '            ##                                      |               ',
]

const VAULT = [
  '                  ',
  '              4   ',
  '             #### ',
  '             #### ',
  ' =  ==   ===      ',
  '                  ',
  '                  ',
  '   BC?!WLUXHh     ',
  '%                 ',
  '%    #   |      5 ',
  '%    ##  |   g  PP',
  '%2@ 1 ^  |  3g  PP',
  '#<<#>>#IOM#~~#  ##',
  '#######IOM#~~#  ##',
]

/**
 * Props for each theme, by the legend digits in the rooms: 2 at the start, 8 by the door, 3 by
 * the lone column, 0 before the belts, 9 over the mud, 4 on the slab, 6 by the pipe (mirrored),
 * 7 on the high ledge (winter). Names are the keys of atlas.meta.decor in the tiles atlas; a
 * [name, front, flip] entry says whether it is drawn in front of Maxx and mirrored. A prop with
 * words on it is never mirrored (the renderer would refuse anyway): a sign that points left has
 * its own frame.
 */
const PROPS: Record<ThemeId, Record<string, string | [string, boolean, boolean?]>> = {
  lot: { 2: 'cone', 8: 'flag', 3: 'bush', 0: 'tube_man', 9: 'trash_can', 4: 'balloons', 6: 'light_pole' },
  vacuum: { 2: 'vacuum', 8: 'cone', 3: 'bench', 0: 'air_machine', 9: 'trash_can', 4: 'flag', 6: ['sign_vacuums_left', false, false] },
  tunnel: { 2: 'arch_tunnel', 8: 'cone', 3: 'hose_reel', 0: 'sign_exit', 9: 'chem_tanks', 4: 'panel', 6: ['curtain', true] },
  storm: { 2: 'cone', 8: 'sandbags', 3: 'dry_grass', 0: 'tire_pile', 9: 'oil_drum', 4: 'windsock', 6: 'power_pole' },
  lube: { 2: 'oil_drum', 8: 'oil_cans', 3: 'tool_chest', 0: 'sign_open', 9: 'floor_jack', 4: 'neon_open', 6: 'lift_post' },
  highway: { 2: 'cone', 8: 'cactus', 3: 'rocks', 0: 'yucca', 9: 'guardrail', 4: 'billboard', 6: 'pumpjack' },
  winter: { 2: 'snowman', 8: 'cone', 3: 'salt_pile', 0: 'mesquite_bare', 9: 'guardrail', 4: 'snowdrift', 6: 'light_pole', 7: 'snowman' },
  mega: { 2: 'arch_mega', 8: 'sign_exit', 3: 'chem_tanks', 0: 'neon_arrow', 9: 'panel', 4: 'neon_mw', 6: ['curtain', true] },
  bonus: { 2: 'plant', 3: 'rope_barrier', 4: 'crest' },
  backlot: { 2: 'dumpster', 8: 'trash_bags', 3: 'poster_bill', 0: 'fence', 9: 'oil_drum', 4: 'neon_arrow', 6: 'power_pole' },
}

const ORDER: ThemeId[] = ['lot', 'vacuum', 'tunnel', 'storm', 'lube', 'highway', 'winter', 'mega', 'bonus', 'backlot']
const SONG: Record<ThemeId, MusicId> = { lot: 'sunny', vacuum: 'sunny', tunnel: 'tunnel', storm: 'storm', lube: 'lube', highway: 'highway', winter: 'winter', mega: 'mega', bonus: 'bonus', backlot: 'rival' }

function area(theme: ThemeId, i: number): AreaDef {
  const next = ORDER[(i + 1) % ORDER.length]
  const prev = ORDER[(i + ORDER.length - 1) % ORDER.length]
  const legend: Record<string, SpawnSpec> = {
    '1': { kind: 'door', props: { name: 'door', to: `${prev}:door` } },
    '5': { kind: 'pipe', props: { name: 'pipe', to: `${next}:pipe` } },
  }
  for (const [ch, prop] of Object.entries(PROPS[theme])) {
    const [sprite, front, flip] = typeof prop === 'string' ? [prop, false, undefined] : prop
    legend[ch] = { kind: 'decor', props: { sprite: `decor_${sprite}`, front, flip: flip ?? ch === '6' } }
  }
  // Only the first area keeps its '@'; the viewer finds a start in the others by itself.
  const strip = (rows: string[]): string[] => (i === 0 ? rows : rows.map((r) => r.replace('@', ' ')))
  const rows = theme === 'winter' ? [...HIGH, ...ROOM] : theme === 'bonus' ? VAULT : ROOM
  return { id: theme, theme, music: SONG[theme], rows: strip(rows), legend }
}

const level: LevelDef = {
  id: 'dev-render',
  site: 'DEV',
  name: 'RENDER ROOM',
  time: 999,
  music: 'sunny',
  areas: ORDER.map(area),
}

export default level
