# Super Mighty Maxx: notes for level designers and engineers

Facts about what exists after the final pass: the whole game, eight sites, Rival Row and both
bosses, every level proven (section 2.10). Each module's own header has the detail; this is the
map, the numbers and the traps. `game/...` means `src/features/it/maxx/game/...`, and commands run from the
repo root (`op/`). The design bible is `docs/super-mighty-maxx/design/part1-bible.md` (section 0 is binding);
the levels' design and their difficulty table are in `design/part5-levels.md`. Where a number here
disagrees with the bible, this file is right.

## Contents

1. [What is in the folder](#1-what-is-in-the-folder)
2. [Tools](#2-tools)
3. [Conventions](#3-conventions)
4. [What changed in the later rounds](#4-what-changed-in-the-later-rounds)
5. [Movement numbers (measured, pinned by the suite)](#5-movement-numbers-measured-pinned-by-the-suite)
6. [Building a level](#6-building-a-level)
7. [Tiles and how they are drawn](#7-tiles-and-how-they-are-drawn)
8. [Entity kinds, one by one](#8-entity-kinds-one-by-one)
9. [Bosses and rivals: the arena recipes](#9-bosses-and-rivals-the-arena-recipes)
10. [Scene flow and the save](#10-scene-flow-and-the-save)
11. [Drawing: renderers, Maxx, particles, HUD](#11-drawing-renderers-maxx-particles-hud)
12. [Sound and music](#12-sound-and-music)
13. [Controller, keyboard, touch](#13-controller-keyboard-touch)
14. [Debug API](#14-debug-api)
15. [Traps](#15-traps)
16. [Not verified by anyone yet](#16-not-verified-by-anyone-yet)

---

## 1. What is in the folder

| Path | What |
| --- | --- |
| `game/contract.ts` | The shared contract: input, audio, sprites, save, scenes, levels, tile characters, `DEFAULT_LEGEND`, `MUZZLE`, Maxx's box. Add to it, never rename. |
| `game/sim/` | The simulation (no DOM, runs in Node). `api.ts` is the helper API and, in its header, the guide to writing an entity kind. `tuning.ts` holds every gameplay number. |
| `game/sim/entities/` | One file per family of kinds, loaded by glob. Each header is the reference for its kinds (props, sizes, states for the renderer). |
| `game/levels/` | `mw01.ts` .. `mw08.ts` and `rivals.ts` (one level each, the default export; `mw03/` and `mw06/` hold their builders), `index.ts` (`LEVELS`, `RIVALS`, `DEV_LEVELS`, `levelById`, `standIn`, `hideLevel`), `meta.ts` (names, themes, songs, clocks of the nine levels), `sandbox.ts` (frozen), `dev/*.ts` (test rooms). |
| `game/render/` | The world renderer (`world.ts`), tiles, backdrops (`themes.ts`), weather, particles, Maxx (`maxx.ts`), HUD, `clock.ts` (drawing between ticks, section 11.2), and `entities/*.ts` (one renderer file per slice). |
| `game/scenes/` | `title`, `map`, `play`, `gameover`, `ending`, plus the dev scenes `sandbox` and `viewer`. Sub-folders hold their parts (`play/`, `map/`, `title/`, `shared/`). |
| `game/engine/` | Shell (`game.ts`), input, save, text, UI kit, sprites, debug API. |
| `game/audio/` | Synth, effects (`sfx.ts`), the song format (`format.ts`) and `songs/*.ts`. |
| `game/assets/` | Generated atlases (`<name>.png` + `<name>.atlas.ts`). Never hand-edit. |
| `game/dev/` | The dev page harness and the text preview page. |
| `scripts/maxx/` | Art generators (`art-*.mjs`), tests, checks, screenshots, the audio tool, the level tools, the stored replays (`replays/`) and the two hand-scripted rides that make some of them (`rides/`). |

Atlases: `maxx`, `fx`, `hud`, `items`, `tiles`, `bg_<theme>` (ten), `cars`, `critters`, `hazards`,
`mudslinger`, `mudzilla`, `rivals_a`, `rivals_b`, `title`, `map`. Each comes from
`scripts/maxx/art-<name>.mjs` (backdrops from `art-bg.mjs`); every generator has `--review <dir>`
for contact sheets.

All eight levels and Rival Row are built: `LEVELS` holds MW01..MW08 in map order and `RIVALS` is
Rival Row. A site whose level is missing still works (the map says COMING SOON); the checks test
that by hiding a level for a moment (`hideLevel`, section 6.6).

| Id | Name | Clock | Main area (tiles) | Other areas | Counted cars | What it brings |
| --- | --- | --- | --- | --- | --- | --- |
| mw01 | GRAND OPENING | 300 s | main 176 x 12 (lot) | vault | 4 | everything taught once by a sign; token 1 only from a washed car's roof |
| mw02 | VACUUM ALLEY | 300 s | main 199 x 13 (vacuum) | bonus | 6 | sedans, grackles, tire-stack springs, lifts, the hover taught |
| mw03 | TUNNEL VISION | 320 s | lot 36 + tunnel 202 x 14 | reclaim | 9 | belts, foam, brushes, wax jets; the roof and EMPLOYEES ONLY door to Rival Row |
| mw04 | MUD SEASON | 340 s | main 262 x 12 (storm) | cellar | 7 | mud, sludge, pickups' clods; MUDSLINGER |
| mw05 | LUBE PIT | 300 s | pit 193 x 22 (lube) | cellar, street | 5 | oil, drips, a tall pit under the shop |
| mw06 | BUG SEASON BOULEVARD | 300 s | main 250 x 14 (highway) | drain | 7 | sports cars, swarms, spike ditches ridden on washed roofs; the second way to Rival Row |
| mw07 | SALT STORM | 300 s | main 251 x 16 (winter) | vault | 6 | ice, icicles, dryers gusting; token 3 is a ride on a gust |
| mw08 | THE MEGA TUNNEL | 400 s | main 329 x 12 (mega) | vault, exit | 14 | every station at once; MUDZILLA |
| rivals | RIVAL ROW | 600 s | alley 60 x 15 (backlot) | four arenas, three yards, trophy | 0 | the four rival duels; back doors for a returning player |

The header of each level file is its map, beat by beat, and its `EXPECT` lines say what must stay
true about it. Songs, sites and themes are in `levels/meta.ts`.

## 2. Tools

### 2.1 The everyday commands

| What | Command |
| --- | --- |
| Typecheck (game only) | `npx tsc -p scripts/maxx/tsconfig.json` |
| Lint | `npx eslint src/features/it/maxx scripts/maxx --quiet` |
| Every Node test | `node scripts/maxx/test.mjs [--skip-core] [--only <file name part>]` (about 4 minutes) |
| The core suite alone | `node scripts/maxx/sim.mjs [--only <text>] [--ledges]` (109 tests, about 10 s; `--ledges` adds the ledge table of section 5, about 15 s more) |
| One file's tests | `node scripts/maxx/tests/<file>.mjs [--only <text>]` |
| Every integration check | `node scripts/maxx/check.mjs --serve <port> [--out <dir>] [--only a,b] [--skip a,b] [--list]` (about 2 minutes) |
| Lint a level (or every one) | `node scripts/maxx/level.mjs lint <level\|all> [--strict]` (section 2.10) |
| Where Maxx can get to | `node scripts/maxx/level.mjs reach <level> [modes] [--hover off\|top\|held\|all] [--png x.png]` |
| Check a level's claims | `node scripts/maxx/level.mjs expect <level>` (its `EXPECT` lines) |
| Random play against the map | `node scripts/maxx/level.mjs fuzz <level>` |
| Play a level to the end | `node scripts/maxx/solve.mjs <level> [--tokens] [--spotless] [--exit secret] [--flags rivalsBeaten=0] [--out run.json]` |
| Remake a hand-scripted ride | `node scripts/maxx/rides/mw01-tokens.mjs --out ...` and `rides/mw06-rides.mjs --out ...` (section 2.10) |
| Replay a run | `node scripts/maxx/replay.mjs run.json --verify` (Node), or in Chrome through serve.mjs (section 2.10) |
| Every song and effect, by numbers | `node scripts/maxx/audio-render.mjs --brief` |
| A dev server | `node scripts/maxx/serve.mjs --port <port>` (never `npx vite`) |

`test.mjs` runs `sim.mjs` and then every file in `scripts/maxx/tests/` (a new file there joins by
itself). Today, 506 tests in all:

| File | Tests | What it pins |
| --- | --- | --- |
| `sim.mjs` | 109 | the core: movement (section 5), tiles, the hover search, determinism, every dev room |
| `cars` 37, `critters` 34, `hazards` 32, `objects` 32 | 135 | each slice's kinds |
| `mudslinger` 22, `mudzilla` 19, `rivals-a` 31, `rivals-b` 22 | 94 | the fights, by scripted players |
| `sim-backtrack` | 4 | a counted dirty car left behind sleeps instead of going; a retry never moves back to an earlier checkpoint |
| `sim-rivals` | 3 | a rival changing shape under Maxx's feet throws him no higher than a hop; beaten rivals rest clear of the walls |
| `mw07-gust` | 3 | MW07's token 3: a plain running jump off lift K, carried by the norther, takes it (the level tools leave wind out); in still air none does |
| `reach` | 25 | the level tools' map and lint |
| `levels-lint` | 22 | the level lint over every level: a shipping level with no error and no warning |
| `solve` | 22 + 33 | the solver's own cases, then every stored replay in `scripts/maxx/replays/` |
| `render-draw` | 10 | the boss bar's faces; drawing between ticks (section 11.2) |
| `audio-songs` | 6 | every loop's loudness within 2 LU of the median, melodies under E6 but for touches, the spray level |
| `host-shell` | 8 | the shell in Node on a stand-in DOM: art that will not load, the warm-up, frame pacing at 60, 75 and 144 Hz, focus leaving, Keyboard Lock, the whole-number scale |
| `input-tab` | 4 | Tab is select only on the game canvas |
| `scenes-flow` | 17 | the real title, map and play scenes on a stand-in shell (section 10.1) |
| `scenes-save` | 9 | the save following other tabs; menus where up and down win over left and right |
| `kit` | 2 | the test kit itself |

Each file's header has its own flags (`rivals-a.mjs --full`, `rivals-b.mjs --trace` and `--record
<dir>`, `mudzilla.mjs --log` and its `MZ*` variables).

### 2.2 serve.mjs: the only way to run a dev server

```
node scripts/maxx/serve.mjs --port <port>                         serve until stopped
node scripts/maxx/serve.mjs --port <port> -- <command ...>        serve, run the command, stop,
                                                                  exit with the command's code
```

It runs the repo's own Vite config with a dependency cache of its own per port
(`node_modules/.vite-maxx/<port>`), so servers in this checkout never invalidate each other. Use
the port your task gives you, and leave nothing running.

### 2.3 check.mjs: the integration checks

`node scripts/maxx/check.mjs --serve <port>` starts its own server through serve.mjs, runs every
check in `scripts/maxx/checks/` in headless Chrome, prints each one's time and stops the server.
With `--port <p>` instead of `--serve` it uses a server already running there (default 5311).
Pictures, `report.txt` and the check's whole output (`log.txt`) go to `<out>/<check>/`, with
`<out>/summary.txt` beside them (default `<out>` is a folder in the system temp directory). Exit 1
if any check fails. If shot.mjs exits 2 (the page reloaded under it) that check gets one more go.

| Check | What it does | Checks |
| --- | --- | --- |
| `sandbox` | plays the sandbox scene beat by beat and photographs each beat | 87 |
| `pad` | a stand-in Xbox pad through input, simulation, scene, rumble, prompts, then Start through the title menu to the map | 42 |
| `seams` | prompt ids against the text module, animation names against the atlas, anchors, nozzle, the SfxId list in the contract against `audio/sfx.ts` | 16 |
| `audio` | real time: the title song, effects from simulation events, pause, mute, a jingle | 28 |
| `unlock` | the first key press unlocks sound under Chrome's normal autoplay rule | 7 |
| `play` | the play scene: card, HUD, pause, retry, clear and tally, versus card, save rules, stand-ins for `rivals`, `mw08`, `mw03`, a hidden level going back to the map | 142 |
| `title` | title, options, how to play, game over, the ending (reloads the page itself, user `titlecheck`) | 122 |
| `map` | the world map: every save state, flourishes (also across a reload), every road both ways, the pad, COMING SOON (a level hidden for the moment) | 158 |
| `render` | the world renderer through the viewer on `dev-render`: every area of every level (Rival Row included), tile rules, seams, chunks, z order, margins, tick hooks, allocation | 192 |
| `replay` | the level tools: the solver plays the sandbox in Node, then the page replays that run with nothing patched and its world hash is compared every 300 ticks | 4 |
| `campaign` | the whole game from a fresh save through the real scenes: PRESS START, NEW GAME, the map walked site by site, every level played from its stored goal run (MW03 by its secret exit, then Rival Row along the hidden road), the save, tally, way out and map checked after each, MW08 into the ending and back to a title offering CONTINUE (user `campaign`, about 25 to 55 s) | 166 |

The campaign plays each level from the start its stored run was made with (3 lives, no score, no
turbo), not from what the level before left: score, coins and the turbo nozzle carry over in the
real game and are in the world hash. A stored run that no longer replays fails the check, and the
check solves that level again in Node to go on. Its pictures and a contact sheet per level, and one
for the whole campaign (`campaign-sheet.png`), are in `<out>/campaign/`.

Each check is also a shot.mjs script you can run alone; the exact query string is in `CHECKS` at
the top of `check.mjs`, for example:

```
node scripts/maxx/serve.mjs --port <p> -- node scripts/maxx/shot.mjs --port <p> --w 1280 --h 830 \
  --q "scene=play&level=sandbox&manual=1&fresh=1" --script scripts/maxx/checks/play.mjs --out <dir>/end.png
```

`checks/lib.mjs` has the helpers for writing another (section 14).

### 2.4 shot.mjs: pictures and scripted runs

```
node scripts/maxx/shot.mjs --port <p> --out x.png [--q "<dev page query>"] [--w 1280] [--h 720]
  [--dpr 1] [--touch] [--wait 300] [--eval "<js>"] [--script steps.mjs]
  [--native [playfield|screen]] [--zoom n] [--verbose] [--hmr]
```

- `--script` is a module exporting `default async ({ page, shot, native, settle, maxx, outDir })`.
  `shot('a.png')` saves the browser window, `native('a.png', { what, zoom })` saves the game's own
  640x360 picture, `maxx(fn, ...args)` runs `fn(window.__maxx, ...args)` in the page. Throw to fail.
- `--native playfield` draws the scene's world renderer into a canvas of its own: the level with no
  HUD, menu or transition, at the camera as it is now. The viewer and the play scene expose a
  renderer; any other scene falls back to `screen`, the whole picture read back at exactly 1x.
  `--zoom n` enlarges hard-edged.
- The page is cut off from the dev server's update socket, so someone saving a file mid-run does
  not restart the game under the script (`--hmr` turns that back on).
- Exit code 1 if the page threw, a scene threw, the game never became ready or the script failed;
  2 if the game was restarted while it ran (run it again).

### 2.5 The dev page and its query

`http://localhost:<port>/dev/maxx.html?<query>` (no sign-in, debug mode on):

| Parameter | Meaning |
| --- | --- |
| `scene=` | `title`, `map`, `play`, `gameover`, `ending`, `sandbox` (default), `viewer` |
| `level=<id>` | passed as `params.level` |
| `params=<json>` | more scene params, e.g. `params={"area":"tunnel","col":20}` |
| `manual=1` | time stands still until a script calls `window.__maxx.step(n)` |
| `fresh=1` | forget that user's save first |
| `user=<id>` | whose save (localStorage `smm.save.v1.<id>`, default `dev`) |
| `debug=0` | as players get it (no overlays, and no `window.__maxx`) |
| `strict=1` | inside React StrictMode |
| `frame=<w>x<h>` | the game in a box of that size |

Text and UI preview: `/dev/maxx-text.html?sheet=charset|sentences|prompts|ui&zoom=3`.

### 2.6 The viewer: any level with the real renderer and nothing on top

`dev/maxx.html?scene=viewer&level=<id>&manual=1&params={...}`. All params optional:

| Param | Meaning |
| --- | --- |
| `area` | start in this area (default the first) |
| `col`, `row` | Maxx's feet in this tile column (and row). Without `col`: the area's `@`, else column 2. Without `row`: the first floor below the top of that column (pass `row` where that would be a roof) |
| `free: true` | a still world; stick, D-pad or arrows pan the camera, hold jump to pan fast |
| `cam: [x, y]` | where the camera starts, in world pixels |
| `slow: n` | one simulation tick every n |
| `hideMaxx`, `boxes`, `marks` | leave Maxx out; collision boxes and labels; only labels and hidden blocks |
| `grid: true` | tile grid, column numbers every 5, row numbers, `COL n ROW m` in the corner |
| `weather: false`, `shake: false`, `seed` | no rain or snow; no shake; the world's random seed (1) |

View (Tab) starts over, and so does a grime or time running out. An unknown level id says so on
screen. The scene object offers `renderer` and `tools`.

### 2.7 overview.mjs: a whole area as one picture

```
node scripts/maxx/serve.mjs --port <p> -- node scripts/maxx/overview.mjs --port <p> --level <id> \
  [--area <id>|all] --out x.png [--scale n] [--grid] [--start] [--plain]
```

The real renderer, entities at their spawn points, the backdrop nailed to the area, no weather and
no particles. `--grid` numbers columns every 10 and rows; `--start` draws Maxx at his start;
`--plain` hides hidden-block outlines and the labelled boxes of invisible kinds. `--area all`
writes `<out>-<area>.png` per area. Wider than 16384 px is cut into bands. Exit 1 on an unknown
level or area.

### 2.8 audio-render.mjs

| Command | What |
| --- | --- |
| `node scripts/maxx/audio-render.mjs [--out <dir>] [--only id,id] [--rate 48000] [--brief] [--roll]` | Render every song, jingle and effect with the game's synth. Report: length, peak, RMS, DC, clipping, limiter work, loop seam, voice loudness, a bar-by-bar harmony report (`--brief` keeps only the flags). `--out` writes WAVs, `--roll` prints piano rolls. Exit 1 on clipping, silence, a loader complaint or a clicking seam. |
| `... --compare [--only id,id] [--with draft.ts,...] [--near]` | Renders nothing; compares how songs are written: phrase heads against about 95 well-known tunes and against every other song, drum and bass bars shared across songs, parallel octaves or fifths between the two pulses, p2 above p1. `LOOK` lines want an ear. Never fails the run. `--with` compares a draft song file in place of the game's song of its id; `--near` adds weaker likenesses. |
| `... --browser [--port <p>]` | Drives the real AudioApi in headless Chrome (every effect, song and jingle, pause, stopJingle, tempo, destroy). It serves the repo itself on that port. |

A song declares deliberate quotes in `quotes: [...]` (format.ts) so `--compare` lists them as meant.

### 2.9 Art generators

`node scripts/maxx/art-<name>.mjs [--review <dir>]`, deterministic (a rerun is byte-identical).
Extras: `art-maxx.mjs --dump run3`, `art-cars.mjs --dump <dir> sedan:brr:3`, `art-bg.mjs --only lot,storm`,
`art-tiles.mjs --review <dir> [--only lot,mega]`, `art-map.mjs --force`. Toolkit: `pix.mjs`
(`Atlas`), `palette.mjs` (the master palette, `checkPalette`), paths from `paths.mjs`.

### 2.10 Level tools: lint, reach, expect, fuzz, solve, replay

They tell you whether a level is well formed, where Maxx can get to, whether your claims about it
are true, and whether a careful player finishes it, before anyone has played it. All of them run
the real simulation. The headers of `scripts/maxx/level.mjs`, `lib/reach.mjs` and
`lib/solver.mjs` have the detail.

```
node scripts/maxx/level.mjs list
node scripts/maxx/level.mjs lint   <level | all> [--strict]
node scripts/maxx/level.mjs reach  <level> [--area id] [modes] [--hover off|top|held|all] [--cols 40-120]
                                   [--width 100] [--no-map] [--json file] [--png file] [--scale 8]
node scripts/maxx/level.mjs expect <level> [--reach "..."] [--not "..."] [--fair "..."] [--file f] [modes] [--hover ...] [--verbose]
node scripts/maxx/level.mjs fuzz   <level> [modes] [--ticks 2e6] [--seed n] [--hover off]
node scripts/maxx/solve.mjs        <level> [--exit goal|secret] [--tokens] [--spotless] [--seed n] [--out run.json]
                                   [--flags name=n,...] [--budget s] [--allow-tight] [--verbose] [--debug]
node scripts/maxx/replay.mjs       run.json --verify
node scripts/maxx/serve.mjs --port <p> -- node scripts/maxx/replay.mjs run.json --port <p> --out <dir>
                                   [--every 120] [--scene viewer|play] [--half] [--cols 4]
```

Exit codes: 0 clean (or solved, or every hash matched); 1 a lint error, a failed expectation, a fuzz
find, not solved, or a replay that differs; 2 a bad command line or a level that does not load.

**Which level.** `<level>` is an id or the path of a level's `.ts` file (anywhere, so a draft can be
checked before it is placed). The tools find levels as the game does (`levels/index.ts`):
`levels/mw01.ts` .. `mw08.ts` and `rivals.ts` by their default export, the test rooms in
`levels/dev/`, and the sandbox. `list` shows each with its file and its `EXPECT` count; lint says
ERROR for a file in `levels/` the game would not open by its id (a wrong file name, a named
export instead of the default, an id `levels/meta.ts` does not list), and `list`/`lint all` name
two files that define one id.

**Coordinates.** Every place is `area col,row`, counted from 0 at the left and the top. A standing
place's row is the row his feet are in, where you would write `@` (on a floor in row 10 he stands in
row 9); its column is the column of his middle, so at the lip of a ledge it is the first column of
the pit. A thing in the level (a car, a sign, a block) is at its own character.

**Modes** (reach, expect, fuzz): what a secret depends on. The default is the fresh player.

| Flag | Meaning |
| --- | --- |
| `--grime kept\|washed` | grime blocks are walls, or gone |
| `--gates closed\|open` | open: every `props.flag` in the level is set when the world is made (for flags a boss or rival sets) |
| `--cars none\|roofs` | roofs: a washed car parked at every car spawn and spawner, for car-roof steps |
| `--hidden off\|on` | on: hidden blocks already bumped (stood on); off: they can be bumped but not climbed |
| `--mode all` | everything open |
| `--hover all` (default) | every hover a player can do: held from the top of the jump, begun late, tapped |
| `--hover held` | held from the top or begun late, never tapped (the same places: tapping never reaches more) |
| `--hover top` | held from the top of the jump only, as level 2 teaches |
| `--hover off` | no hover at all |

Bricks broken from below and buttons pressed are followed in every mode: the map is made again
with them gone and set until nothing new happens, and a move that needs one says so (`[first: the
brick at main 10,7 broken]`).

**How the map is made.** From every place Maxx can stand at rest, 96 input macros are
played on a copy of the level with everything harmful removed: steps, runs, a half-stick walk,
jumps from a stand and running jumps at several holds, a run to the lip with the jump pressed
there or on the last tick of coyote time, air moves (up then sideways, turn back, let go at the
top), down on pipes and up at doors, each with no hover, the hover held from the top, held from
6, 12, 18 and 24 ticks after the top, and tapped. From one place a lip, a sweep also moves the
run-up by 0 to 3 px with the hover begun every other tick from the top to 26 after it: the very
longest jumps need that (one exact run-up, one exact hover start). Lifts and other solids that
move on their own are tried at 6 moments of their cycle. With all of it the map finds exactly the
widest gaps in the table of section 5 (pinned in `tests/reach.mjs`), plus one: held from the top
onto a ledge 4 down, 11 from one pixel-exact run-up.

**EXPECT: write the claims next to the rows.** A level module may `export const EXPECT: string[]`;
`expect <level>` with no other lines checks them. One line each:

```
reach|not|fair <targets> [with <modes>] [unless <modes>] [within <n>s]      # comment
targets: goal secret tokens token1..3 checkpoints checkpoint<n> coins blocks area:<id>
         [area]@cols[,rows]  e.g. @120-140,2  tunnel@57,4  bonus@3-20 (rows are feet rows)
modes:   grime=washed gates=open cars=roofs hidden=on all hover=off|top|held
```

- `reach`: every target reachable (a range of places: one of them). `not`: none is.
- `fair`: reachable with no jump on the cheapest fair route under 4 take-off ticks, none
  pixel-exact, and none that needs the hover.
- `not X unless M`: not reachable in the base mode, and reachable once M is added.
- `within 90s`: the cheapest fair route takes no longer (rest to rest, so a flowing player is
  quicker).
- `--hover top` (or `held`, `off`) on the command line applies to every line that names no hover.

```ts
export const EXPECT: string[] = [
  'fair goal with hover=off               # MW01: nobody needs the hover',
  'reach tokens with all                  # every token can be had somehow',
  'not @120-140,2 unless grime=washed     # MW03: the tunnel roof only through the washed vent',
  'not secret unless grime=washed         # ... and the EMPLOYEES ONLY door only from the roof',
]
```

A `not` line is checked against every hover, tapping included, so it holds for the best player.
Still leave a tile to spare: what is pixel-exact for the map is a lucky jump for a person.
`levels/dev/reach.ts` is the worked example (11 lines, among them a shelf only the late hover
reaches: `reach @135-138,2` and `not @135-138,2 with hover=top`).

**reach output.** The map of each area (`.` reachable, `:` only with more modes, `x` a top never
reached, `+` the route), the summary (goal, secret exit and each token: reached, or the fewest
modes it needs, or UNREACHABLE; every pickup, block, gate, door and pipe), then the cheapest fair
route to the goal (and the secret exit) in moves, each with its tick cost and, for a jump, its
take-off window (`window 8/17`: presses that still land on the same floor). Flags on a move:

| Flag | Meaning |
| --- | --- |
| `TOO TIGHT` | the take-off works on fewer than 4 ticks; a route takes one only when there is no other way |
| `(PIXEL-EXACT ...)` | found only by the lip sweep: one run-up to the pixel and one hover start; counts as too tight |
| `NEEDS HOVER` | no move from that place gets there without the hover |
| `NEEDS LATE HOVER` | only a hover begun after the top of the jump does it (nobody is taught that) |
| `NEEDS PULSED HOVER` | only tapping it; should never show (routes take no tapped move while a held one exists): tell the tools owner |
| `[first: ...]` | a brick to break or a button to press first |

`--png` draws it (green reachable, orange only with a mode, red never; white the route); `--json`
writes the whole graph.

**fuzz** plays millions of random held inputs on the same world and reports anything it stood on
that the map says is out of reach. `OK` is what you want; a find beside spikes or sludge is a
pixel-exact landing; anything else, tell the tools owner (`--json` keeps the input).

**solve** plays the level to the end with everything in it, like a careful person on a
controller: it follows the map's cheapest fair way (never a too-tight or pixel-exact jump unless
`--allow-tight`), tries each move on a copy of the world first (waits, backing off, spraying what
is in the way, a jump with the gun on), knows only what has been on screen for 10 ticks, earns
what the map assumed (washes grime, bumps hidden blocks, breaks bricks, presses buttons), fights
anything that sets `world.boss` with a short look-ahead, and retries from checkpoints with 3 lives.
The report: time against the clock, hits, cars, tokens, "where it struggled" (every hit, every long
wait or search, every death, every late or tapped hover), moves it would not use, and a STUCK block
when it fails (`why`, and every try with what hit it). It writes the run as a replay
(`maxx-replay-1`: per attempt the input, one mask a tick, and world hashes every 600 ticks),
checked to replay before it is written.

`--flags` starts the world with flags, as the play scene starts a visit; they travel in the replay
(the world hash records them). Rival Row is always solved with `--flags rivalsBeaten=0` (a first
visit) or the count a returning player has (`rivals-resume1.json`, `-resume2`, `-resume3` are
`rivalsBeaten=1`, `2`, `3`, and each walks through the back door that count opens): without it the
run does not match the play scene. A locked door or gate whose flag no boss or rival in its own
area can raise (Rival Row's back doors on a visit that has not beaten their rivals) is left alone
for another way, and listed under "moves it would not use" as `barred, and nothing in its area
raises '<flag>'`.

The solver does not plan rides on cars. Two stored runs need one, and are made by scripts in
`scripts/maxx/rides/`: `mw01-tokens.mjs` (the solver, with MW01's stage ride played by rule through
createSolver's `ride` option: token 1 is only on the stage, reached from the bay car's roof) and
`mw06-rides.mjs` (a hand-scripted player who washes and rides the cars of MW06's ditches 2 and 3,
not the solver). Each reads its stage off the level's rows; after a change that stops its replay
verifying, run it with `--out scripts/maxx/replays/<name>.json` and read what it prints.

**replay** `--verify` plays a replay against the current code (a stored replay is a regression
test). In Chrome (through serve.mjs) it steps the real game one tick per input frame, compares the
world hash with Node's every `--every` ticks and saves pictures and captioned contact sheets
(`--scene play` shows the play scene, HUD and all, for a replay made with the default seed). Nothing
in the page is patched: the simulation's sin, cos and hypot come from `sim/mathx.ts`, so Node and
Chrome compute the same bits. The `replay` check of check.mjs proves it on the sandbox.

**A proven level** is one that, at its current rows:

1. `lint <level>` has no ERROR, and every warn has been read;
2. `expect <level>` passes, with EXPECT holding at least: `reach tokens with all`, a `fair goal`
   (with `hover=off` for MW01 and MW02, `hover=top` where only the taught hover is wanted), and a
   `not ... unless ...` for every secret and every place that must stay out of reach;
3. `fuzz <level>` says OK;
4. `solve` exits 0 four ways (the goal, `--tokens`, `--spotless`, and `--exit secret` if it has
   one), with no hit or STUCK nobody has looked at, inside its row of the difficulty table in
   `design/part5-levels.md` (shortest take-off window on the main route, hits, pulsed hover, share
   of the clock);
5. those four runs are kept in `scripts/maxx/replays/` (`solve.mjs <level> ... --out
   scripts/maxx/replays/<level>-<goal|tokens|spotless|secret>.json`), where `tests/solve.mjs`
   replays every one: a later change to the level or the simulation shows there, and the fix is to
   solve again, read the new report and replace the file. Rival Row's runs take `--flags
   rivalsBeaten=0` (and `rivals-resume<n>.json` `rivalsBeaten=<n>`, n 1 to 3); `mw01-tokens.json` and
   `mw06-rides.json` come from `scripts/maxx/rides/`, not from solve.mjs;
6. someone has watched the contact sheets of the browser replay.

All nine pass today: lint 0 errors and 0 warnings, every EXPECT line (MW01 12, MW02 12, MW03 18,
MW04 15, MW05 13, MW06 14, MW07 13, MW08 12, Rival Row 15), fuzz OK fresh and with grime washed,
gates open and hidden blocks on, every solve inside its row of the table, and all 33 stored runs
replay. Two solves take hits the table allows (MW08 goal 2, tokens 1), and MW07's tokens run shows
"used the hover begun late" for token 3: the tools leave wind out, and in play a gust carries a
plain jump there (the level's header says how; `tests/mw07-gust.mjs` plays it in the simulation,
wind and all: a run along lift K and a full jump, no hover, on a window of 57 ticks per trip, and
none of them in still air).

**Reading failures.**

| Tool | Says | Means |
| --- | --- | --- |
| lint | `ERROR ... would appear inside the solid` | a start, checkpoint, marker or arrival with a wall in Maxx's two tiles |
| lint | `ERROR the game does not open this level by its id` | the file name, the default export or `levels/meta.ts` is wrong (the map would say COMING SOON) |
| lint | `warn sign breaks badly on gamepad, ...` | wrapped as that device shows it (the game's own `wrapText`, its button pictures), a word is alone on the last line, a button ends a line apart from its verb, or a pair of buttons (`{up} AND {spray}`) is parted: set the break by hand with `\n` |
| reach | `UNREACHABLE, even with everything open` | no macro from any reachable place gets there; look at `reach --mode all` for `x` marks |
| reach | `needs grime washed` (or another mode) | reachable once that is done; write the `not ... unless ...` if that is the intent |
| expect | `X IS reachable ... by <move> from <place>` | your `not` is false: that move from that place gets there; block it or change the claim |
| expect | `... is NOT reachable ...; it needs <modes>` | your `reach` is false in that mode |
| fuzz | `RANDOM PLAY REACHED n THINGS ...` | read each place; beside spikes or sludge it is a lucky landing |
| solve | `STUCK at <place>` with `why` | a careful player could not get on: a hazard with no gap, a car with no room, a jump only luck makes |
| solve | `(unreachable)` | the map has no way to that target: run reach |
| solve | `STUCK ... waits for flag 'x' >= n, and nothing the solver can reach or wash sets it` | a gate or door with a boss or rival in its area that never fell: look at the fight |
| replay | `DIFFERS` / `MISMATCH` | the level or the simulation changed since the run was made; solve again |

**Limits.** reach is terrain only: enemies, hazards, cars and wind are left out, so "reachable"
says nothing about surviving the way (solve does). Leaving hazards out hides no way up or
across: a hit in mid-air never lifts Maxx (section 5). Nor do blobs where they walk: a stomp off
one lifts him less than a running jump from its floor. But a blob that can fall into a pit
(`edges: false`) or ride a lift over one is a step in mid-air (a stomp is a fresh bounce and a
fresh hover), and wind stretches jumps: a blower blowing across a pit adds 5 tiles or more to a
hover's jump (zones add up). Check a `not` claim near either against section 5. "Reachable" is proof (a real input sequence);
"unreachable" means none of the macros found a way, cross-checked by fuzz and, for jump length, by
the table of section 5, but not a proof: a trick outside the macro set (a mid-air wiggle, a flight
off a spring or stomp steered in some new way, a hover begun at an odd tick from a take-off the
sweep does not try) is not found. The sweep runs only at the first moment of any lifts near.
Flags set by bosses and rivals are not followed (use `--gates open`); a car washed and ridden while
it drives is not followed (`--cars roofs` parks them). Route times are rest to rest. solve knows a
boss's next random choice before its tell, remembers perfectly, and misses a car that never comes
within 12 tiles; "solved" is proof, "stuck" is strong evidence.

**Cost** (this machine): reach on the sandbox about 15 s for the fresh player, a 280 x 14 area
about 30 s, each further mode a fraction of that; solve a few seconds after its map, a boss room
10 to 25 s; fuzz 5 to 12 s; `replay --verify` about a second; a browser replay about a minute for
6000 ticks. `node scripts/maxx/tests/reach.mjs` and `tests/solve.mjs` are the tools' own tests.

For tool writers: `createReach(sim, contract, level, { hover, late, share, fine })` returns
`graph(mode)`, `routeTo`, `windowOf`, `play`, `explore` and more; `MACROS`, `LATE`, `FINE`,
`wantsHover(macro, player, fall)` and `FALL` (the ticks since the top that place a late hover),
`copyWorld` (exact, proved tick for tick), `buildWorld` (every area built with `sim.buildArea`).
`createSolver(sim, contract, level, { exit, tokens, spotless, seed, flags, ride, ... }).solve()`
(its header lists every option), `formatResult`, `playReplay` in `lib/solver.mjs`; `openGame`,
`findLevels`, `loadOne`, `lintLevel`, `parseExpectation`, `checkExpectation`, `fuzzLevel` in
`level.mjs`; `playInPage`, `replayQuery` in `replay.mjs`.

## 3. Conventions

- **Player-visible text:** capitals only (the font has none other), short, no em dashes.
  Prompts are written `{jump} {spray} {confirm} {cancel} {pause} {select} {left} {right} {up} {down} {move}`.
- **Originality** (bible section 0) covers looks, names, tunes and layouts. `audio-render --compare`
  checks tunes against a list encoded from memory.
- **Units:** world pixels, tile 32, screen 640x360. A body's `(x, y)` is the top-left of its box.
  Speeds px/s, accelerations px/s². One tick is 1/60 s and every simulation timer and `*T` field
  counts ticks; `LevelDef.time` and `clockText()` speak seconds, `world.timeLeft` is ticks.
- **Spawn point:** `(x, y)` in `init` is the bottom-centre of the spawn tile; `setBox` places the box.
  `World.checkpoint (x, y)` is the middle of Maxx's feet.
- **Screen position** of a world point: `Math.round(v) - Math.round(camera)`. Draw on whole pixels.
- **Determinism:** `game/sim/**` and `game/levels/**` use no `window`, `document`, canvas, audio,
  `Math.random`, `Date.now`, `performance.now` or timers. Random numbers come from `rand(w)` and
  friends; `sin`, `cos` and `hypot` from `sim/mathx.ts` (engines round Math's differently), and no
  other engine Math function or `**` (`sim.mjs` fails on any in `sim/**` or `levels/**`). `sim.mjs`
  fuzzes and hash-checks the sandbox and every dev room, so a kind that is not deterministic fails it.
- **The simulation never takes a life and never adds the SPOTLESS bonus:** the play scene does both.
- **`world.tick` stands still** during a pipe or door trip and once `world.status` leaves `'play'`:
  time those with `player.stateT` / `world.statusT`.
- **Renderers read, never write:** an entity renderer reads the entity and the world and changes
  neither. Whatever it needs must be in the entity's data (states and vars listed in the sim file's
  header).
- **No per-frame allocation** in a draw path: no new arrays, objects, canvases, strings or Map keys.
  Pass whole numbers (`Math.round(x) | 0`) to the canvas and to functions: a fraction handed to a
  function is boxed, which is an allocation every frame. Build name strings once, at load.
- **Projectiles** are kinds of their own with `offscreen: 'remove'`, named with the slice's prefix
  (`ms_`, `mz_`, `bill_`, `streaks_`, `ollie_`, `nick_`).
- **Bosses and rivals** open the way on by setting a flag, never by touching another entity.
- **Art:** 1 px warm near-black outline (`#1e0d06`), two or three flat shades a material, light from
  the top left, master palette only (backdrops add hazed in-betweens, listed in `meta.added`).
  Everything alive has a face; things that hurt read as dangerous, things that help as friendly.

## 4. What changed in the later rounds

### 4.1 The final pass (reviews, fixes, level polish)

Simulation (the stored replays were made again after these; every outcome stayed the same):
- A counted dirty car far behind the camera now sleeps where it was left instead of being removed
  (`EntityBehavior.keep`), so a player who goes back still finds it to wash. Bonus and washed cars
  are still removed. A spawner counts only awake cars when it decides to send the next.
- On a retry, every checkpoint flag at or before the retry point in its area starts up, so walking
  back over one never moves the retry back.
- A rival changing shape under Maxx's feet (Sir Streaks' dash) throws him no higher than an
  ordinary hop. Beaten, every rival comes to rest clear of the walls and behind Maxx (section 9.3).

Levels:
- MW03's skill token is a timed run under three brushes on a belt in the `reclaim` vault (no
  hover), and the first foam is a safe bath sunk a tile; the tunnel is 10 tiles longer.
- MW04's skill token is a precise jump off mud onto a plank shelf in THE BAY before Mudslinger.
- MW07's skill token is a ride on a weather gust (a `blower` with `machine: false`) from lift K to
  the gantry; lift K and everything after it moved 3 tiles right.
- Rival Row has three back doors in the alley (to the pit stops before Nick, Ollie and Streaks,
  locked on `rivalsBeaten` 3, 2, 1, deepest first), and its skill token sits on a pedestal reached
  from a spring.
- Signs with a bad line break have hand-set breaks (`\n`, MW03's and MW04's grime signs among
  them), and MW06 calls the hover HOVER.
- The test rooms and the sandbox walk are loaded only in dev builds (section 6.5).

Shell, scenes, input, sound, drawing:
- On a screen faster than 60 Hz the shell draws frames between ticks (section 11.2); at 60 Hz a
  frame with no tick draws nothing.
- The shell retries a sprite sheet that fails, warms every sheet behind LOADING, pauses when focus
  moves to the app outside the game, and locks Esc in fullscreen (sections 13, 14).
- The save follows the game's other tabs; the map ignores confirm for a moment after a clear;
  CONTINUE keeps a session with lives; MW08 goes to the ending only on its first clear (section 10).
- The boss bar shows each rival's own face (section 11.5). `lube` plays 2.8 dB louder (`gainDb`) and
  the spray is quieter (section 12).
- `window.__maxx` (engine/debug.ts) and the sandbox and viewer scenes exist only in dev builds.

Tools:
- `check.mjs` runs eleven checks; `campaign` is new (section 2.3). `hideLevel` lets a check see a
  site with no level (section 6.6). The render check draws every area of Rival Row too.
- `solve.mjs --flags`, the solver leaves barred doors nobody near can open, createSolver's `ride`
  option, and `scripts/maxx/rides/` for the two hand-scripted runs (section 2.10).
- The level lint warns on a sign that breaks badly (a pair of buttons parted across lines too), and
  `tests/levels-lint.mjs` runs the lint over every level in `test.mjs`.
- Rival Row's returning runs are stored from 1, 2 and 3 rivals beaten (`rivals-resume<n>.json`),
  each through its own back door, and `tests/mw07-gust.mjs` plays MW07's gust ride with wind.

### 4.2 The integration round before it

Contract and core:
- `SfxId` gained `squawk`, `gate`, `click`, `unlock`, `whir`, `sizzle`, `hydraulic` (49 effects in all).
- `AudioApi.stopJingle(opts?: { resume?: boolean })`; the shell stops any jingle on every scene switch.
- `SaveData.map: MapMemory = { roads, beaten, champion, node }`: what the map has shown, kept across reloads.
- The `versus` event carries the entity `id`; `versus(w, e, name, tagline)` takes the entity.
- `Entity.ground` (a standable top that is not flat), `solidTop(s, x, width)`, `TUNING.groundStep` (16).
  Washed cars use it (`CAR_TOPS` in `sim/entities/cars.ts`): Maxx stands on the drawn roof, hood and trunk.
- `EntityBehavior.boss` and `TUNING.turboBossPower` (1.5): a turbo droplet counts 1.5 on any boss or rival.
- `setBossMusic(w, id)` and `World.bossMusic`: `areaMusic()` returns wax, then the fight's song, then
  the area's, then the level's. `clearBoss` and leaving the area end it.
- `completeLevel(w, exit, { walk: false, stopAt })`: an exit with no victory walk (the EMPLOYEES ONLY door).
- `validateLevel` counts a `mudzilla` spawn as an exit.
- `standIn(realId, devIdOrLevel | null)` and `standingIn()` in `levels/index.ts` (section 6.6).
- `loadModule(path)` on `loadSim()` and on every testkit `t`.

Rendering:
- The `'#'` tile rule counts floors, belts and blocks as ground (section 7.2); a lone column of `#` has both edges.
- `drawTileAs(g, sprites, world, tx, ty, ch, camX, camY)` exported from `render/tiles.ts`.
- `registerRenderer(kind, draw, { margin, tick })` (section 11.1); entities draw by z inside each layer.
- New particle `spatter` (water hitting an entity, thrown back toward the shooter).
- Decor ignores `flip` on props with words. Clouds sink with the sky bands in tall areas.
- The grackle has a light rim and a teal nape. `scenes/title/cars.ts` draws the game's own car frames.

Scenes and tools:
- The play scene exposes `renderer`; the versus card draws the event's entity and measures its
  painted size for its scale; hurry turns off when the clock rises above a minute again;
  `secretFound` is set only by the secret exits of MW03 and MW06 (`findsHiddenRoad`); the pause
  menu's OPTIONS has no ERASE SAVE (`createOptions({ erase: false })`).
- `check.mjs --serve` starts its own server for the checks (eleven of them now); shot.mjs has `--native` and `--zoom`; audio-render has `--compare`.

## 5. Movement numbers (measured, pinned by the suite)

Pits and gaps count the open tiles between the last tile of the take-off ledge and the first of
the landing one. "n of 23" is how many of 23 take-off ticks around the lip make it: 1 or 2 is a
frame-perfect trick, 15 or more is roomy. `node scripts/maxx/sim.mjs` prints these numbers;
`--ledges` adds the table below (about 15 s).

| Move | Number |
| --- | --- |
| Run | 215 px/s top speed, 12 ticks from a stand; 150 while spraying on the ground; 150 while a hover runs (see below) |
| Tap jump | 1.5 tiles high (47 px) |
| Full jump | 4.2 tiles high standing (134 px), 4.75 running (152 px); jump speed 635 (+40 at a full run), cut gravity 5000 (the bible's 640 and 4200 are superseded) |
| Running jump | 5.5 tiles long on the flat (176 px of travel); a running tap hop 2.5 |
| Walls | 3 and 4 tiles are climbed from a standing start; 5 is a barrier: the highest running jump puts his feet 152 px up, a 5-tile wall is 160 and the lip forgives 6, so he is 2 px short. The hover never lifts him, a hit in mid-air never does, and a stomp bounce off a blob reaches 148 px: nothing on foot gets over 5. Only a spring (power 0.75 or more), a lift or a washed car's roof does |
| Pits, plain running jump | 4 and 5 roomy (19 and 17 of 23), 6 the limit (8 of 23), 7 impossible |
| Pits, hover held from the top | down + spray held from the top of the jump: 8 roomy (18 of 23), 9 at most (10 of 23), 10 impossible |
| Pits, the most any hover gives | the hold begun late, about 14 ticks after the top: 10 at most (8 of 23), 11 impossible. Tapping, mashing or pulsing it never does better than a hold (below) |
| Gaps | a one-tile gap is run across; two must be jumped |
| Spring | power 1 throws his feet 8.1 tiles over its top (8.8 over the floor it stands on); the height goes with the square of `power` (0.75: 5.2 tiles over the floor, over a 5-tile wall; 1.25: 13.3). It gives the hover back. Run and jump onto one on a pit's lip and it carries him 8 tiles plain, 11 with the hover held from the top, 12 at most (table below) |
| Stomp bounce | off a blob: 400 px/s, or 600 with jump held, which lifts his feet 120 px over the blob's top, 148 over the floor it walks on (under a 5-tile wall). It gives the hover back. A blob on its floor is never a better step than the floor: off one on a pit's lip he crosses a tile less than with a running jump. A blob falling or carried through the air is a step in mid-air (it works on one falling under him) |
| A hit | knocks him away from what hit him at 150 px/s, 24 ticks without control, then 90 of blinking. On the ground he hops 21 px; in the air it never lifts him (a rise is cut to 250 px/s, a fall goes on), so a hit is never a second jump, and it does not give the hover back. Searched in `sim.mjs`: a hit from behind on any tick of a running jump, with the hover held from any tick, gets him no further, and none puts him on a 5-tile wall |
| Riding | a lift or a washed car carries him; jumping off one he takes none of its speed (only its move on the take-off tick, 1 to 4 px): the jump is the ground's |
| Mud | half speed (107.5 px/s) and launch speed x0.8: a full jump 2.7 tiles high standing (86 px), 2.9 running; a 2-tile wall is climbed from mud, 3 is a barrier. A running jump off mud is 4 tiles long (in the air he speeds back up to a full run). Pits from a mud run-up: 4 roomy, 5 the limit (4 of 23), 6 impossible; with the hover held from the top 8 (4 of 23); the most 9 (1 of 23: the hover begun late off the last coyote tick, from most run-ups), 10 impossible. A coyote jump just off the edge of mud is a mud jump, and so is the first jump after arriving on mud through a door or pipe |
| Spray | a droplet every 2 ticks, 540 px/s, 20 ticks of life, at most 40 alive; forward water leaves 30 px above the floor and drops about 28 px by the end of its reach (about 210 px); `up` aims 45 degrees |
| Turbo nozzle | fires 1.5 times as often, reaches 1.35 times as far, a droplet counts 2 (1.5 on bosses and rivals) |
| Floors | slick grip 0.35, oil 0.12; mud above; belts carry at 60 px/s. None of them lengthens a jump: off slick, oil or a belt running his way a running jump is the plain one (the belt adds 1 px) |
| Wind | a blower pushes him `force` / 60 px a tick inside its zone, on the ground and in the air. Against him 60 shortens a running jump to about 4 tiles; with him it lengthens every jump, the hover's most of all (table below). The level tools leave wind out |
| Shine | 3 pips; a hit blinks him 90 ticks; Mighty Wax lasts 600 ticks |

Running full jump onto a ledge higher or lower than the take-off (the far side a cliff face): the
widest gap crossed, and from how many take-off ticks.

| Landing ledge | Plain | Hover held from the top | The most any hover gives |
| --- | --- | --- | --- |
| 4 tiles up | 5 (5 of 23) | 7 (8 of 23) | 7 (9 of 23) |
| 3 up | 5 (9) | 8 (9) | 8 (12) |
| 2 up | 6 (3) | 9 (3) | 9 (9) |
| 1 up | 6 (6) | 9 (7) | 10 (4) |
| level | 6 (8) | 9 (10) | 10 (8) |
| 1 down | 7 (1) | 10 (2) | 11 (2) |
| 2 down | 7 (4) | 10 (5) | 11 (5) |
| 3 down | 7 (7) | 10 (8) | 11 (8) |
| 4 down | 7 (9) | 10 (11)* | 12 (1) |

\*11 from one run-up exact to the pixel, off the last coyote tick (the level tools' lip sweep finds it).

To promise a place cannot be reached, use the last column and leave a tile to spare.

**The most anything gets him.** Every way of leaving a ledge that was tried, as the widest gap
crossed onto a ledge that many tiles up (+) or down (-): plain / hover held from the top / the
most any hover gives. Every run-up timing, coyote tick and (for a spring or blob on the lip) run-up
onto it was tried, landings counted with the 6 px ledge forgiveness, so these are upper bounds (the
running jump's row is the table above to the tile; the spring's level, 8 up and 4 down cells and
the mud row's level cell were also played out on real pits). Measured for this table, not pinned:
the suite pins the running jump's row, the walls, the stomp, hits and the hover search. `-` is
never.

| Leaving by | +8 | +4 | +2 | level | -2 | -4 |
| --- | --- | --- | --- | --- | --- | --- |
| running jump | - | 5/7/7 | 6/9/9 | 6/9/10 | 7/10/11 | 7/11*/12 |
| standing jump at the lip | - | 2/3/3 | 3/6/7 | 4/7/8 | 5/8/9 | 5/8/9 |
| run-up on slick, oil or a belt his way | - | 5/7/7 | 6/9/9 | 6/9/10 | 7/10/11 | 7/11*/12 |
| run-up on mud | - | - (3 up: 3/3/3) | 4/6/7 | 5/8/9 | 5/9/9 | 6/9/10 |
| a blob on the lip, bounce held | - | 4/6/6 | 5/8/8 | 5/8/9 | 6/9/10 | 6/9/10 |
| a spring of power 0.75 on the lip | - | 4/7/8 | 5/8/9 | 6/9/10 | 6/9/10 | 7/10/11 |
| a spring of power 1 on the lip | 5/8/8 | 7/10/11 | 7/10/11 | 8/11/12 | 8/11/12 | 9/12/13 |
| a spring of power 1.25 on the lip | 8/11/12 | 9/12/13 | 9/12/13 | 10/13/14 | 11/14/15 | 11/14/15 |
| tailwind 120, zone 4 x 3 from the lip | - | 6/8/8 | 7/10/10 | 7/11/11 | 8/11/12 | 9/12/13 |
| tailwind 60, zone 12 x 6 | - | 6/9/9 | 7/12/12 | 8/12/13 | 9/13/14 | 9/14/15 |
| tailwind 120, zone 12 x 6 | - | 7/12/12 | 9/14/14 | 10/14/15 | 11/15/15 | 11/15/16 |
| tailwind 180, zone 12 x 6 | - | 9/13/13 | 10/15/15 | 11/15/16 | 12/16/16 | 13/16/17 |

How high his feet get over the floor he leaves:

| Way up | Feet |
| --- | --- |
| full jump, standing / running | 134 px (4.2 tiles) / 152 px (4.75) |
| stomp bounce off a blob on that floor, jump held | 148 px (4.6) |
| a hit in mid-air | never above the jump it interrupts |
| the hover, however pressed | never up |
| from mud, standing / running | 86 px (2.7) / 92 px (2.9) |
| spring, power p | 258 p² px over its top, which is 22 px up: 167 px at 0.75 (5.2 tiles), 280 at 1 (8.75), 425 at 1.25 (13.3) |
| a lift, a washed car | wherever it carries him, then a jump from there: a washed car's roof is 34 (sports) to 92 px (monster) up |

Lifts and washed cars hand on none of their speed, and no floor lengthens a jump, so those rows
are the running jump's. Only springs and wind carry him past the running jump's numbers. The
level tools play springs (they keep every solid that does not hurt) but leave wind out, so check a
`not` claim near a blower blowing across a pit by these numbers.

**A floor critter must be at least 28 px tall** to be washed by forward spray up close.

**The hover.** Down + spray in the air holds the fall to 40 px/s and the drift to 150 px/s. Its 42
ticks are a stretch of time, not a count of presses: from the first tick it holds him up, it runs
down every tick of that airtime, pressed or not, and the 150 px/s drift holds all that while. So
no way of pressing it goes further or higher than holding it: `sim.mjs` searches every pattern of
presses up to 8 ticks long in every phase, 400 random ones, and 150 random sequences that also let
go of the stick or push it half over or back, let go of jump, hold up, and press down or spray
alone, from fourteen take-offs (a running jump, a running hop, a run off the edge and a standing
jump, both ways; a jump on the last coyote tick; running jumps off mud, oil and a belt; a running
jump onto a spring and onto a blob), plus a hit from behind on every other tick of a running
jump with the hover held from any tick, onto ledges from 4 tiles up to 4 down, against holding it
from the best tick, and fails at 4 px (today the best of 16,000 flights gets 0 px past it). It
comes back only on landing, on a spring, on a stomp bounce and out of a warp. Level 2
teaches holding it from the top of the jump; beginning the hold later goes further (he keeps his
full run until it starts, and the hover throws away the fall speed he built up), which is why the
last column is wider. The level tools' pulsed-hover macros now find nothing a hold does not.

## 6. Building a level

### 6.1 A level file

`game/levels/<id>.ts` exports a `LevelDef` and is listed in `LEVELS` (or set as `RIVALS`) in
`game/levels/index.ts`. Ids are `mw01`..`mw08` and `rivals`; names, sites, themes, songs and clocks
are in `levels/meta.ts` (the map and the cards read those before the level loads).

```ts
export const mw01: LevelDef = { id: 'mw01', site: 'MW01', name: 'GRAND OPENING', time: 300, music: 'sunny',
  areas: [{ id: 'main', theme: 'lot', rows: [ /* 12 or more rows, all the same length */ ], legend: { ... } }] }
```

- `areas[0]` holds the `@` start. An area is at least 12 rows; a taller one scrolls up and down.
- A character is a tile (`TILE_CHARS`), an entity from the area's `legend` or `DEFAULT_LEGEND`, or blank.
  An entity character marks the tile its feet stand in.
- `DEFAULT_LEGEND`: `@` start, `o` coin, `$` token, `*` bubble, `k` checkpoint, `G` goal, `y` spring,
  cars `c s v p f n t`, critters `b r u w`, hazards `d i z j`. Everything else (turbo, wax, oneup,
  door, secretExit, lift, sign, pipe, marker, gate, button, blower, spawner, decor, bosses, rivals)
  goes in the area's `legend` under a digit or a free letter: `'1': { kind: 'gate', props: { flag: 'mudslinger', h: 2 } }`.
- `AreaDef.music` overrides the level's song in that area (a token room uses `'bonus'`).
- Exactly 3 tokens per level; at least one exit (`goal`, `secretExit`, or a `mudzilla`).

### 6.2 validateLevel

`validateLevel(level)` (sim) runs in the suite for every level. Errors: no areas, no `@` in the
first area, rows of different lengths, fewer than 12 rows, an unknown character, a bad legend key,
a duplicate area id, a warp to a missing area or marker, no exit. Warnings: an area narrower than the
screen, not exactly 3 tokens, a start/marker/door/checkpoint under a solid tile, a pipe character not
over a `P`, an unknown car variant, a marker with no name, a warp with no `to`, a kind with no behaviour.
It cannot see the atlases, so it does not know decor names. The level tools add a deeper lint.

### 6.3 The screen and the HUD

- The HUD covers the top ~30 px: keep anything the player must see below it. A boss's bar sits at
  y 318..349: build boss arenas with the bottom 40 px as floor.
- The play band of the backdrops (screen y about 100 to 296) is kept calm: no doors, no bright
  ledges, no car shapes. Any door the player sees is a real one.

### 6.4 Placement rules that hold everywhere

- Do not stack a solid on a prize block.
- Where Maxx starts, arrives or retries, the cell above must be open (he is two tiles tall).
- A checkpoint stands on flat ground with the tile above open; on a retry the level restarts there
  with flags and tokens kept and washed cars still credited. Every flag at or before the retry
  point in its area starts up, so walking back over one never moves the retry back; keep a level's
  checkpoints in one area left to right (a later area's flags start down).
- A goal needs its column and one either side clear for 5 rows, and at least 6 flat tiles after it
  (the victory walk carries him 4 to 5 tiles and stops at a drop).
- `stats.carsTotal` counts every car a counted spawner will send.
- An entity sleeps until the camera is within 96 px of it (`TUNING.activeMargin`) and sleeps again
  480 px outside the view; a sleeping solid is not solid.

### 6.5 Dev rooms

A `LevelDef` default-exported from `game/levels/dev/<name>.ts` with an id starting `dev-` is found by
glob, opened by `levelById`, the viewer and the play scene, and left out of the production bundle.
Do not edit `levels/sandbox.ts` (the tests and checks depend on its layout).

`levels/index.ts` loads the rooms and the sandbox with a lazy glob and an `await` behind
`import.meta.env.DEV`: an eager glob becomes static imports hoisted above that test, which kept
every room's row building in the bundle as dead code. In a production build `DEV_LEVELS` is empty
and `sandboxLevel` an empty stand-in `levelById` never serves. A room may import only types (the
module waits on it at load), and a level in `levels/` must not import `levels/index.ts`.

| Room | What is in it |
| --- | --- |
| `sandbox` | every tile and core kind in one walk, plus a tall bonus room (frozen) |
| `dev-render` | one area per theme with every tile neighbour case and some decor; `winter` is 20 rows tall, `bonus` narrower than the screen; the `'#'` rule cases up high at columns 47 to 64 |
| `dev-objects` | every pickup, prize, fixture, door, gate, spring, lift and sign; area `back` has the EMPLOYEES ONLY door |
| `dev-cars` | each variant alone (cols 16..214), pairs (252..362), belt and spawner (400), a ditch ride (446), a showroom of washed cars (486), exit (534) |
| `dev-critters` | blobs 14, grackles 80, swarms 132, tumbleweeds 182, combinations 264, awkward cases 420..597 (add `"row":9` for 454..493), exit 598 |
| `dev-hazards` | `main` (pass `"row":9`): drips 14, icicles 50, brushes 86, jets 134, blowers 174; `lab`: the awkward cases (viewer only) |
| `dev-mudslinger` | MW04's boss arena |
| `dev-mudzilla` | MW08's boss arena (`exit` is an unreachable goal area) |
| `dev-rivals-a` | `bill`, `streaks`, `out` (the goal), `pair` (both in one area) |
| `dev-rivals-b` | `ollie`, `nick` (pass `"row":9`), `out` |
| `dev-reach` | the level tools' room |

### 6.6 Playing a dev room under a real id: standIn and hideLevel

The rules that hang on an id (Rival Row's `rivalsBeaten`, the ending after `mw08`, the hidden road
from `mw03`/`mw06`, the save key, the map's PLAY) can be tried in a short test room standing in for
the real level (the play check does this for `rivals`, `mw08` and `mw03`):

```js
const mod = await window.__t.mod('levels/index.ts')        // in the page (dev builds only)
mod.standIn('mw01', 'sandbox')                              // a dev id, 'sandbox', or a LevelDef
mod.standIn('mw01', { ...mod.sandboxLevel, site: 'MW01', name: 'GRAND OPENING' })
mod.standIn('mw01', null)                                   // undo
```

`levelById` then serves a copy carrying the real id (areas shared, the dev level untouched).
`standingIn()` lists what is standing in. It does nothing in a production build. In Node, the same
calls work on `levels` from `loadSim()`.

Now that every level exists, the checks see what the game does with a site whose level is missing
(the map's COMING SOON, the play scene's way straight back to the map) by hiding one for a moment:
`mod.hideLevel('mw05')` makes `levelById('mw05')` null (it wins over a standIn),
`mod.hideLevel('mw05', false)` undoes it, `hiddenLevels()` lists them. Dev builds and Node only.

## 7. Tiles and how they are drawn

### 7.1 Tile characters

| Char | Tile | Behaviour |
| --- | --- | --- |
| ` ` | air | |
| `#` | ground | the theme's main solid |
| `%` | wall | the theme's second solid (building wall, tunnel wall) |
| `B` | brick | breaks when bumped from below |
| `C` | coin brick | up to 8 coins, then `U` |
| `?` | prize block | one coin |
| `!` | power block | a bubble when Maxx is missing shine, else the turbo nozzle |
| `W` | wax block | Mighty Wax (walks away from him) |
| `L` | life block | a 1UP (walks away) |
| `H` `h` | hidden coin / life block | not solid and not drawn until bumped from below |
| `U` | used block | |
| `X` | steel | solid, never breaks |
| `=` | catwalk | stand on it, jump up through it |
| `<` `>` | conveyor | carries bodies left / right at 60 px/s |
| `I` | slick | low grip (foam, ice) |
| `O` | oily | almost no grip |
| `M` | mud | half speed, weak jump |
| `g` | grime block | solid until washed (6 hits); hides secrets |
| `~` | sludge | not solid, grimes Maxx at once (fills pits) |
| `^` | spikes | not solid, cost one pip |
| `P` | pipe | solid, drawn as a pipe with a rim where there is no pipe above |
| `\|` | pillar | background only, not solid |

Falling out of the bottom of an area grimes him, like sludge.

### 7.2 Which frame each tile wears (render/tiles.ts)

`ground` means `#` or `%`, and the outside of the area counts as ground.

- **`#`**: for the cap and side tests, ground also includes every solid tile that sits in a floor:
  `I O M < > X g U B C P ? ! W L` (never the hidden `H h`, which would give themselves away).
  Open above: `ground_tl` (nothing left), `ground_tr` (nothing right), else `ground_t`. Ground above:
  `ground_l`, `ground_r`, else `ground_m` (or `ground_m2` on a fixed pattern). Nothing on either
  side: both edges (a lone column is outlined both sides).
  - So a `#` under a belt, a special floor, a block, a crate or a pipe shows the ground body with no
    cap, and a `#` beside one has no edge. A block sitting directly on a floor looks set into it.
  - A `#` under spikes or under a one-deep sludge pit still wears its cap (the pit has a floor).
- **`%`**: `wall_t` unless ground is above, then `wall` (it counts only `#` and `%`).
- **Blocks:** `B C` brick, `?` prize0..3, `!` power0..3, `W` waxblock0..3, `L` lifeblock0..3 (8 ticks a frame), `U` used, `X` steel.
- **`=`**: `catwalk_l` / `catwalk_r` at the ends of a run, else `catwalk`.
- **`<` `>`**: `conv0..3` (`>` plays backwards) at 4 ticks a frame (60 px/s), `conv_l` / `conv_r` over the ends of each run.
- **`I`**: `slick_t`, or `slick_m` under anything solid. Slick may be any depth.
- **`O` `M`**: `oily_t` / `mud_t`, or the theme's `ground_m` under ground or under more of itself.
- **`g`**: grime0..2 by hits taken. **`~`**: `sludge_t0..3` (10 ticks a frame), `sludge_m` under more sludge. **`^`**: spikes.
- **`P`**: pipe_tl/pipe_tr (or `_l`/`_r` below the top), columns counted from the left of the run.
- **`|`**: `pillar_t` where no pillar is above, else `pillar`. Pillars are a step darker than the
  ground and read as background posts; they look right free-standing or holding up a block or catwalk.

Frames are `tiles/<theme>_<key>`, then `tiles/any_<key>`, then a flat colour. Every theme has
all 56 keys. Tiles are cached in 20x12 chunks rebuilt exactly when a tile in them (or their rim)
changes.

### 7.3 What the floors look like

- slick `I`: a bank of soap bubbles (pink, blue and yellow foam in tunnel and mega; an ice block in winter).
- oily `O`: a black pool with a rainbow lip on a bright steel tread plate.
- mud `M`: wet dark mud with clods (rain puddles in storm).
- sludge `~`: glowing purple goo with a pink skin, the brightest thing in any pit.
- grime `g`: a brown crust with drips; holes at stage 1, a thin frame at stage 2.
- spikes `^`: silver teeth on a yellow and black base.

### 7.4 Themes and backdrops

Themes: `lot` (MW01), `vacuum` (MW02), `tunnel` (MW03), `storm` (MW04, rain), `lube` (MW05),
`highway` (MW06), `winter` (MW07, snow), `mega` (MW08), `bonus` (token rooms), `backlot` (Rival Row).
Each `bg_<theme>` has `far`, `mid`, `near` (and `clouds` outdoors); in a tall area the strips sink
with the climb and the sky or ceiling colour fills above them. Highway's top sky band is the
grackle's body colour (the bird reads by its rims there).

## 8. Entity kinds, one by one

Sizes are box w x h in px. Props are optional unless marked. "Pip" is one point of shine.
The full reference for each is the header of its sim file.

### 8.1 Pickups (`sim/entities/pickups.ts`)

| Kind | Char | Box | Props | Notes |
| --- | --- | --- | --- | --- |
| `coin` | `o` | 18x20 | | floats mid-tile; a coin resting on a crate is collected when the crate is bumped; rows spin as a wave, so use rows and arcs to lead the eye |
| `token` | `$` | 22x22 | `index` 0..2, `owned` (test rooms) | exactly 3 a level, filled in reading order; one already saved shows as a faint outline and still pays 1000 |
| `bubble` | `*` | 20x20 | | heals one pip; waits if shine is full |
| `turbo` | legend | 22x20 | | the turbo nozzle; falls to the floor if placed in the air |
| `wax` | legend | 20x24 | | Mighty Wax; sits still when placed, slides away out of a `W` crate |
| `oneup` | legend | 22x22 | | as wax, from an `L` crate |

A prize from a crate rises out of it behind the tiles (state `pop`, z -1), then comes out in front.

### 8.2 Fixtures and ways through (`fixtures.ts`, `warps.ts`, `gates.ts`)

- **`checkpoint`** (`k`, 24x56, z -1): flat ground, tile above open; put it a little past the middle
  of a level and a few tiles before any arena (at least 10 before Mudzilla's: its banner would sit on
  the versus card).
- **`goal`** (`G`, 96x160, z -1): the exit arch, centred on its tile. He must step within 20 px of its
  middle. It makes its own `goalFront` (never place one). Room rules in 6.4.
- **`secretExit`** (legend, 32x64): the EMPLOYEES ONLY door. He goes in within 16 px of its middle
  on the ground (4 px in the air) and stops in the doorway (no victory walk). Flat floor. It makes
  its own `secretFront`. Only the secret exits of `mw03` and `mw06` open the hidden road to Rival Row;
  any other is a plain clear that says SECRET EXIT!.
- **`sign`** (legend, 24x32, z 0): `text` (capitals, no em dashes, prompts allowed), `range` (56 px
  sideways). The board shows within `range` sideways and 72 px up or down, and stays through a full jump.
  Text is drawn at scale 1 and wrapped to 224 px: keep it short. A `\n` in the text breaks the line
  there; set one wherever the wrap would leave a word alone on the last line, part a button from
  its verb (`'WELCOME TO MIGHTY WASH!\n{move} TO RUN. {jump} TO JUMP.'`) or part a pair of buttons
  (`{up} AND` at a line's end, `{spray}` starting the next). The lint warns on all three, measured
  with every device's button pictures.
- **`door`** (legend, 28x56, z -1): `to: 'area:marker'`, `name` (also an arrival point), `flag` +
  `min` (1) to lock it. Up at the door goes through. Locked: bars, padlock, a red lamp on the frame
  and a `{lock}` prompt; up rattles it. Once the flag reaches `min` and the door is on screen it
  unlocks (30 ticks, sfx `unlock`); a world that starts with the flag set starts unlocked. The cell
  above must be open.
- **`pipe`** (legend): its character goes in the air cell just above the top row of `P` tiles; it
  covers the pipe's width; down on the pipe goes through. `to`, `name` as for doors.
- **`marker`** (legend): `name` (required). Where a warp arrives; on a pipe's top row Maxx rises out of it.
- **`gate`** (legend): `flag`, `min` (1), `w` (1 tile), `h` (3 tiles). Its character is the
  **bottom-left** tile; it fills `w` right and `h` up. A solid wall for Maxx, cars and critters until
  the flag reaches `min` and it is on screen, then it rolls up in 48 ticks (sfx `gate`) and stays open
  (open from the start on a retry with the flag set). With no flag it never opens; leaning on it
  rattles it. It is always awake, so cars from off screen are stopped too. **Open, only its 12 px drum
  is left and it is not solid:** never let Maxx stand on a gate that opens. **A 3-tall gate in open air
  can be jumped:** put a wall or ceiling over it, or make it 5 tall.
- **`button`** (legend, 24x8): `flag`, `value` (1). Stepping on it raises the flag (never lowers it); sfx `click`.

### 8.3 Rides (`movers.ts`)

- **`spring`** (`y`, 28x22, solid top): `power` (1 = about 8 tiles; 0.75 already clears a 5-tile
  wall). He must land on it from above; its sides are not walls. It gives the hover back, so one on
  a pit's lip carries a running jump up to 12 tiles at power 1 (section 5). Keep `tire_pile` decor
  away from springs (they look alike).
- **`lift`** (legend): `dx`, `dy` (tiles), `speed` (60), `wait` (30 ticks at each end), `w` (3 tiles).
  Its character is the middle tile (the left of the two middles for an even width); its top is that
  tile's top. Its rail is drawn behind it. Standing still on a lift in a blower's wind, he is blown off.

### 8.4 Cars, the spawner and the clod (`cars.ts`)

| Variant | Char | Box | Speed | Dirt (hits) | Spray time* | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| compact | `c` | 72x40 | 40 | 10 | 20 ticks | "WASH" in the dust; the first car |
| sedan | `s` | 88x40 | 55 | 18 | 36 | |
| suv | `v` | 92x52 | 60 | 26 | 52 | |
| pickup | `p` | 100x52 | 50 | 36 | 72 | throws clods |
| sports | `f` | 92x34 | 150 | 12 | 24 | revs 34 ticks, warning sign at the screen edge |
| van | `n` | 100x60 | 45 | 44 | 88 | slow and tough |
| monster | `t` | 120x92 | 35 | 60 | 120 | too tall to jump: it must be washed |

\*Continuous hits with the normal nozzle. Turbo halves it.

- **Danger:** touching a dirty car anywhere, roof included, costs a pip. Washed: harmless, 1.2x
  faster, and Maxx stands on its drawn outline (hood, roof and trunk at their real heights; he steps
  up the windscreen and down onto the hood). Water passes through clean cars. A chain of washes
  scores 200, 400, 800, then 1000 each.
- **Props:** `dir` (1 or 'right'), `dirt`, `speed` (0 parks it), `bonus` (not counted for SPOTLESS),
  `clean` (starts washed: a ride, never counted), `paint` 0..3.
- **Behaviour:** gravity, turn at walls, queue behind each other (never moved into another, belts
  included), fall into pits, sink in sludge (taking a rider with them); far behind the camera a
  bonus or washed car is removed, while a counted dirty car sleeps where it is left (still there to
  wash when Maxx goes back: `EntityBehavior.keep`). A washed car passing under a low wall scrapes
  Maxx off.
- **Pickup:** ahead of Maxx within 300 px it brakes, winds up 26 ticks and lobs a `clod` (12x12)
  at where he stands, one per 130 ticks. Aiming up washes the clods out of the air. Clods burst on
  any tile, so no low ceiling over a pickup's road.
- **Sports car:** wakes 96 px outside the view, revs, then comes at 150 px/s. Give it 10 to 12 tiles
  of flat road in front of Maxx early on.
- **Placing:** early on, give a car its spray time plus about a second of flat road. Two-block walls
  keep a car in its own stretch. The van, pickup, compact and suv are the best rides.
- **`spawner`** (legend, invisible): `variant` or `variants: 'compact,sedan'` (in turn; `random: true`
  picks), `every` (240), `max` dirty ones about at once (3, at least 1), `count` (0 or missing =
  endless bonus cars), `dir`, `delay` (30), `range` (448 px of the screen). It waits while a car
  stands on its spot; it starts once Maxx is about 13 tiles away. Put it at the far end of a belt
  running at Maxx.

### 8.5 Critters (`critters.ts`)

- **`blob`** (`b`, 30x28, easy): walks 30 px/s, turns at walls and ledges and at another blob.
  Three spray hits or one stomp (+100); any other touch costs a pip; wax washes it on touch. It
  narrows 2 px a hit (30, 28, 26 wide), always 28 tall. No room to walk: it stands and looks about.
  Belts carry it (off a belt's downstream end, backwards). Never walks into sludge unless
  `edges: false`. Props `dir`, `speed`, `edges`. Place the first blob of a level on flat ground with
  room to spray; one on a short ledge above the path is a nice stomp target. A stomp with jump held
  lifts his feet 148 px over the blob's floor: a blob by a 4-tile wall is a step up it, by a 5-tile
  wall it is not. One that walks off into a pit (`edges: false`) is a step in mid-air while it
  falls (section 15).
- **`bird`** (`r`, the grackle, 28x20, medium): flies a wave 14 px either side of its row at 70 px/s,
  to and fro over `range` tiles (5; 0 = straight on, removed when it leaves the area). Turns only at a
  wall across its own row. While Maxx is below within 160 px sideways it drops a `splat` every 110 to
  150 ticks, after a 20-tick warning (stops, rears up, shivers, squawk, a spot on the floor). It never
  warns while there is no room under it. Two hits and it flees (+200). It hurts to touch, from above
  too. Props `dir`, `range`, `amp` (14), `speed` (70). Place it about 4 tiles above the floor (the up
  aim reaches it from the ground about 5 tiles away). Avoid early: a grackle right over a gap he must
  jump, or over a long pit with no room to step aside.
- **`splat`** (runtime only, 10x12): falls at up to 290 px/s, costs a pip, bursts on the first floor,
  catwalk, lift or car roof (rides along); sinks in sludge; water washes it out of the air. Catwalks
  are shelter. Never place one.
- **`bugs`** (`u`, a swarm, 36x36, medium): hangs until Maxx is within `range` tiles (10), bunches
  24 ticks with a "!", then drifts at him at 40 px/s through walls. Six hits (+200); a sting costs a
  pip and it backs off 50 ticks; it gives up at 1.75 x range. Props `range`, `speed`. One swarm a
  screen, at head height or a little above; open sky reads best. Not with a tumbleweed in early levels.
- **`tumbleweed`** (`w`, 30x30, medium): rolls at 90 px/s in hops, bounces off walls, rolls off
  ledges, sinks in sludge; every drop of water shoves it back; five hits (+100). Hurts, cannot be
  stomped; wax breaks it. Props `dir`, `speed`. It wakes only when the camera is within 96 px. Give
  Maxx 4 or more tiles of runway in front of it.

Draw order: blob and tumbleweed z 0; bird, splat and bugs z 1.

### 8.6 Hazards (`hazards.ts`, atlas `hazards`)

- **`drip`** (`d`): character in the open tile just under a ceiling. Every `every` ticks (100, at
  least 40) a drop swells 30 ticks, then falls and splashes on the first floor, catwalk, lift or clean
  car roof. The drop (`drip_drop`, 8x10) costs a pip; spray pops it. `phase` delays it (0/25/50/75 make
  a wave), `oil` true/false (default oil in `lube`). A stain marks where drops land. Leave room to
  stand either side; prefer ceilings 3 tiles up or more (in a 2-high corridor the drop is born at his head).
- **`icicle`** (`i`, 16x28): character under a ceiling. Maxx within 40 px sideways below it, at most
  8 tiles down with nothing solid between: it shakes 20 ticks, falls and shatters. Hurts only while
  falling. One spray hit drops it (+50). A stub stays for good. A full-speed runner is never hit.
  Space them 3 tiles apart to leave places to stop. Never over a slow clean-car ride.
- **`brush`** (`z`, 28 wide, `h` px tall (64, at least 32)): on a rail. `axis` 'x' or 'y', `range`
  tiles (3, negative = left or up), `speed` (60), `wait` (20), `start` 0..1. Always hurts; soaks
  water (shields what is behind it). The rail ends at a wall (a 'y' rail 18 px under a ceiling). A
  full running jump clears a 64 px brush on the floor. Never shut a corridor under 3 tiles high with
  one; keep at least 2 tiles of resting gap between two. It makes its own `brush_rail`: never place one.
- **`jet`** (`j`): a hot wax nozzle under a ceiling firing down, or `dir: 'up'` on the floor. Off
  `off` (80), sputter 20 (the tell, sfx `sizzle`), on `on` (50). The 14 px column reaches up to `len`
  tiles (6). A down jet stops on tiles, catwalks, lifts and clean car roofs; an up jet only on solid
  tiles. Hurts only while on. Three jets 3 tiles apart with phases 0/50/100 make a wave. A catwalk under
  a down jet makes a dry spot beneath it.
- **`blower`** (legend only): the machine; its wind zone is `w` (4) x `h` (3) tiles downwind on the
  same floor line. `force` px/s (-120, negative blows left), `on` + `off` for gusts (the last 20 calm
  ticks spin up), `phase`, `machine: false` for weather wind. Never hurts; pushes Maxx on the ground and
  in the air (never out of the area or a locked arena) and bends the water. 60 shortens jumps (5.5 to
  about 4 tiles against it), 120 is a slog, 180 a crawl; zones add up. Blowing his way it stretches
  jumps: a 120 zone 12 x 6 tiles over a pit carries a running jump 10 tiles plain and 14 with the
  hover held from the top (section 5), and the level tools leave wind out. It is scenery, not solid:
  stand it against a wall. Guarding a pit, keep the zone 5 tiles or less so the machine is on screen
  from the take-off edge.

Beats (drip, jet, gusts) read `world.tick`, so a row keeps its wave however the camera arrives.

### 8.7 Decor (`sim/entities/decor.ts`, art in `tiles`)

`{ kind: 'decor', props: { sprite: 'decor_<name>', front: false, flip: false } }`. The prop stands
on the floor of its tile, centred on it (a prop in a mid-air cell hangs there: windows, neon, lamps).
Never harmful, never solid, water flies through.

- `front: false` (default): z -1, behind the tiles and everything that moves. `front: true`: z 1, in
  front of Maxx (only the curtain is meant for it). There is no "in front of the tiles, behind Maxx".
- `flip` mirrors it, **except props with words, which never mirror** (use `sign_vacuums_left`).
- Runs: `fence`, `guardrail`, `rope_barrier` are 64 wide: one every 2 tiles joins up.
- Wall and ceiling things go in an air tile: `lamp_hang`, `chandelier`, `curtain`, `window`,
  `window_night`, `sign_exit`, `neon_*`, `portrait`, `crest`, `poster_bill`, `stencil_employees`.
- Do not put `bench`, `guardrail`, `sandbags` or `billboard` where a step would make sense (they look
  standable). Keep `tube_man` (it has a face) away from the first enemy a new player meets.
- An unknown name draws nothing in play and a pink post in debug and overview pictures.

All 73 props (w x h; themes; * animated; W words; F front):

| Group | Props |
| --- | --- |
| Lot and vacuum | cone 16x20 (all outdoor, tunnel, lube); light_pole 40x157; sign_mw 104x132 W; kiosk 36x59; flag* 28x93 W; bush 44x23; mesquite 84x71; vacuum 48x84; vacuum_arch 112x110; trash_can 24x28; bench 52x22; sign_vacuums and sign_vacuums_left 68x64 W; air_machine 34x56 W; menu_board 88x104 W; balloons* 40x83; banner_grand 104x64 W; tube_man* 56x97; sign_open 36x37 W; mat_rack 56x50; grass 32x15; cactus 36x39; yucca 36x56; dumpster 80x50 |
| Tunnels | arch_tunnel 96x159 W; arch_mega 96x159 W; curtain* 64x96 F; foam_arch* 96x122; window 52x42; window_night 52x42; sign_exit 38x23 W; pipes_wall 44x98; chem_tanks 72x40; hose_reel 36x37; panel* 34x57; lamp_hang 24x95 |
| Lube | tool_rack 68x68; tool_chest 38x57; oil_shelf 68x76; oil_drum 26x40 W; oil_cans 30x24; sign_lube 72x52 W; lift_post 32x117 (two, 4 tiles apart, either side of a parked car); floor_jack 48x22; tire_pile 48x35 |
| Storm, highway, winter | pumpjack* 100x63; turbine* 100x198 (skylines and high ledges); rocks 46x17; dry_grass 32x15; billboard 160x134 W (on a skyline); sign_highway 72x92 W; guardrail 64x20; fence 64x62; power_pole 56x172; sandbags 56x17; windsock* 56x76; mesquite_bare 84x67; snowman 36x56; salt_pile 76x34; snowdrift 52x13 |
| Bonus | vault_door 100x99; drape 72x116 (frames a doorway); portrait 48x56 W; crest 52x55 W; chandelier 60x61; rope_barrier 64x31; plant 36x43 |
| Neon and backlot | neon_mw* 132x53 W; neon_open* 64x30 W; neon_arrow* 56x32; trash_bags 48x29; poster_bill 40x49 W; stencil_employees 64x23 W |

`atlas.meta.decor` in `assets/tiles.atlas.ts` lists each with its themes and timing.

## 9. Bosses and rivals: the arena recipes

Every fight follows one loop: a clear telegraph, an attack that can always be dodged by a player who
read it, then a window where water counts. Each can be beaten without a hit (tested by scripted
players). A boss or rival calls `versus` (the play scene's card), `setBoss` every tick (the bar),
`lockCamera` to its arena, and on the fall sets its flag. Turbo water counts 1.5 on all of them.
In each arena: nothing else (no enemies, hazards, pickups unless listed, front decor, special floors).

### 9.1 MUDSLINGER, end of MW04 (copy `levels/dev/mudslinger.ts`)

- Kind `mudslinger`, 136x88, dirt 80, theme `storm`. Arena 20 columns (one screen), counted from its
  left wall (column 0): columns 0 and 19 are walls one tile thick from the top of the area down to a
  **doorway 2 tiles high** at floor level.
- Flat plain `#` floor right across. Catwalks `=` 3 tiles each on row floor-3, arena columns **5-7 and
  12-14**. Open sky above (clods rise 232 px): no roof lower than that.
- The truck's character on the row above the floor in **arena column 16**.
- Maxx comes in by the left doorway; the level's gate in the right doorway:
  `{ kind: 'gate', props: { flag: 'mudslinger', min: 1, h: 2 } }`. A checkpoint a few tiles before the left doorway.
- No `!` or `W` crate inside (one just before the arena is fine). `props.dir: 1` mirrors the whole fight
  (truck in arena column 3, gate in the left doorway).
- Props: `dirt`, `arenaX`, `arenaW`, `music` ('boss'; 'none' keeps the level's song), `dir`.
- Washed: flag `mudslinger` = 1 at once (the gate opens), +5000, SQUEAKY CLEAN!; it stays parked as
  a solid 'top' platform, stood on along its drawn outline (`TRUCK_TOP`: the bed rim 23 px below the
  box top, the light bar at it, the eyes 14 px below), not a flat box top. On a retry with the flag
  set it is gone.

### 9.2 MUDZILLA, end of MW08 (copy the arena of `levels/mw08.ts`; `levels/dev/mudzilla.ts` is the test room)

- Kind `mudzilla`, 200x150, dirt 150, theme `mega`, 12 rows, floor rows 10 and 11. L = the left wall's column.
- Left wall column L: `%` rows 0..7, rows 8-9 open (a doorway 2 tiles high, which a steel shutter fills).
- Floor columns L+1..L+22: exactly 22 tiles of plain `#`, nothing on it but the barred EXIT door
  at L+22 (below).
- Catwalks on row 7 over L+8..L+10 and L+13..L+15. Optional `!` on row 4 over L+12 (no lower).
- Right wall column L+23: `%` rows 0..9, and **the area's last column**.
- `Z: { kind: 'mudzilla' }` on row 9 in the right third of the floor (the dev arena uses L+19).
- A checkpoint at least 10 tiles before the doorway; nothing harmful in the last screen before it.
- Props: `arena` (22), `dirt`, `music`, `clock` (seconds the clock is topped up to at the start, 300).
- It completes the level itself (`completeLevel 'goal'`) after a 6.3 s finish, on the tick it sets
  its flag `mudzilla`. `validateLevel` and the level lint count a mudzilla spawn as an exit, but
  reach, expect and solve head for a goal: with none they stand at the start. So MW08 (copy its
  arena from `levels/mw08.ts`, not from the dev room) keeps a barred EXIT door at L+22
  (`{ kind: 'door', props: { to: 'exit:in', flag: 'mudzilla', min: 1 } }`) into a small `exit`
  area with a goal that play never reaches, and its EXPECT says `not goal unless gates=open`. The
  dev arena's `exit` area, which nothing leads to, would be a lint ERROR in a shipping level.

### 9.3 Rival Row (`rivals`, theme `backlot`)

Four duels in order, each in a closed one-screen arena; a rival whose number is already covered by
the flag `rivalsBeaten` removes itself, so a returning player walks straight through. Each fall raises
`rivalsBeaten` to that rival's number (never lowers it). The play scene copies the flag into the save
as it rises and sets `champion` at 4.

Every arena: 20 columns x 12 rows; columns L and L+19 are `%` walls (at least 6 tiles high from the
floor); rows 10-11 plain `#` across all 20 columns (only `#` goes slick or oily); Maxx arrives at
column L+2 or L+3 (the start, or a marker a door leads to); the way on is a door in column L+17:
`{ kind: 'door', props: { to: '<area>:<marker>', flag: 'rivalsBeaten', min: N } }` (a gate works too).
A rival placed elsewhere than its column needs `props.left = L`. A checkpoint before each arena is kind.

| # | Rival | Kind, box, hp | Arena insides | Its column | Door min |
| --- | --- | --- | --- | --- | --- |
| 1 | BUCKET BILL | `bill`, 40x50, 210 | nothing (6 clear tiles of air over the floor); a doorway gap in the left wall is fine | L+14 | 1 |
| 2 | SIR STREAKS | `streaks`, 30x68, 260 | nothing; **both walls solid, no doorway gap** (he dashes into them) | L+15 | 2 |
| 3 | SLICK OLLIE | `ollie`, 44x56, 540 | one catwalk on row 7, columns L+7..L+12 | L+14, row 9 | 3 |
| 4 | NIMBUS NICK | `nick`, 88x56 at first, 310 | catwalks on row 7, columns L+3..L+6 and L+13..L+16; rows 0..6 open | L+10, **on the floor row** (row 9) | 4, into the trophy room |

- Bill and Streaks may share one area (dev area `pair`): two arenas side by side sharing a full-height
  wall column, the first door leading to a marker inside the second. Never a walk-through gap.
- Nick's tagline (`WHY PAY? WAIT FOR RAIN. LOOK UP!`) is the hint the fight needs: only water aimed up
  reaches him. A sign before his arena saying so would help too.
- Nick ends with the `champion` jingle; the others with `rivalDown`.
- Beaten, every rival comes to rest with his middle at least 4 tiles from both walls, behind Maxx and
  the door (z -1): Bill hops there, Streaks glides, Ollie slides sitting, Nick drifts before his
  rainbow shows.
- A rival changing shape under Maxx's feet (Streaks re-posing for a dash, a skid, a wall slam)
  gives him an ordinary hop off the head (the rise is capped), never a throw out of the picture.
- Rival Row's alley has three back doors on its first screen, deepest first: to the pit stops
  before Nick, Ollie and Streaks (`yard3`, `yard2`, `yard1`), locked on `rivalsBeaten` 3, 2 and 1.
  A first visit finds all three barred; a returning player's first open door is the right one. No
  door leads back to the alley, so nobody skips a rival. The overview pictures show them barred
  (overview.mjs makes the world with no flags).

## 10. Scene flow and the save

### 10.1 Scenes

```
title --(CONTINUE / NEW GAME)--> map --(confirm on a site with a level)--> play { level }
play  --> map { from, exit: 'goal' | 'secret' | 'quit' }      a clear, or EXIT TO MAP
      --> ending { from: 'mw08', exit }                       the first clear of mw08 (a replay of
                                                              it goes back to the map)
      --> gameover { from }                                   on the last life
gameover --> map (CONTINUE, fresh lives, progress kept) | title (QUIT)
ending --> title
```

- `title`: PRESS START, then CONTINUE (only with progress) / NEW GAME (asks before erasing) / HOW TO
  PLAY / OPTIONS (/ SANDBOX on the dev page). Menus start on confirm, never on the shell's pause.
  CONTINUE keeps the session (lives, score, coins, turbo) while it has lives, and starts a fresh one
  only at 0; NEW GAME and SANDBOX always start fresh. A menu that is open when another tab writes
  progress is rebuilt (CONTINUE appears, the cursor stays on its row). Left 20 s on PRESS START it
  plays the attract story. State for checks: `state`, `index`, `labels`, `note`, `carStage`.
- `map`: Maxx walks the roads; confirm on a site plays its level (COMING SOON without one), cancel
  goes to the title. At HQ the bar says `{move} WALK  {cancel} TITLE`, and confirm there points to
  the first open site not yet cleared. Back from a clear (exit `goal` or `secret`), confirm and
  cancel are ignored until 30 quiet ticks with no transition (a press starts the count over; never
  longer than 120), so a player mashing through the tally does not walk straight back in. Flourishes
  (a road drawing in, NOW OPEN, the hidden road with the `secret` jingle, rivals unmasked, the crown)
  play once each, across reloads. Rival Row's bar and badge show its three token pips (the totals
  stay out of 24, the eight main levels'). `state()` (its `bar` has `tokens`), `forget()`.
- `play`: `go('play', { level })`; `card: false` skips the level card; dev only: `area`, `col`, `row`,
  `boxes: true`, `readout: false`. An unknown id goes straight back to the map. Phases `card` (90
  ticks, confirm skips after 8), `open` (20), `run`, `close` (22), `tally`, `leave`. `state()` returns
  `{ level, phase, phaseT, retryCard, paused, screen, menuIndex, banner, versus, versusScale, tally, hurry, visitTicks }`;
  the scene object also has `world` and `renderer`.
- Pause menu: RESUME, RESTART LEVEL, HOW TO PLAY, OPTIONS (no ERASE SAVE in a level), EXIT TO MAP.
  RESTART and EXIT ask first and put the session back as it was on entering (lives only go down).
  On Rival Row the exit question says RIVALS YOU BEAT STAY BEATEN. (elsewhere THIS VISIT WILL NOT BE
  SAVED.). On a controller, Menu inside HOW TO PLAY or OPTIONS closes it and resumes. Spray held
  through a pause does not spray on resume until it is let go. The retry card and the pause panel
  name Rival Row RIVAL ROW (its site plate is `???`).
- While the browser holds sound back, the title, the map (a note over Maxx for 200 ticks), the pause
  menu's foot line and OPTIONS (note `locked`) say how to let it start (`FOR_SOUND` in
  `scenes/title/kit.ts`).
- After a grime: the flop (170 ticks; on the last life until the `grimed` jingle ends), then the lives
  card (54 ticks, FROM THE CHECKPOINT when it starts there). After a clear: CLEAR!, the victory walk
  until the fanfare ends (confirm from tick 96 skips), then the tally; confirm or 600 ticks leaves.
- Hurry: under 60 s left the song plays at 1.25x with HURRY UP!; it turns off if the clock rises again.
- The versus card (170 ticks, confirm skips after 30, Start pauses) draws the fighter with its own
  renderer at 2x or 3x by its measured painted size: no portrait art is needed.
- `gameover` (`{ from }`): its jingle, then CONTINUE / QUIT side by side after 86 ticks.
- `ending`: sets `finished`, plays `ending`; thanks, numbers, credits (hold confirm to speed them),
  the champion or rumour card, THE END. About 70 s left alone.
- Shared overlays (`scenes/shared/options.ts`, `howto.ts`) draw a panel only; the caller shades the
  scene first. The How To Play text is `PAGE_TEXT` in `howto.ts`: change it there if a rule changes.

### 10.2 The save (`engine/save.ts`, `scenes/play/record.ts`)

Kept in localStorage `smm.save.v1.<user>`; `repairSave` fixes any old or bad save. The play scene is
the only scene that writes progress, on the tick of the clear (closing the page during the fanfare
keeps it):

- `levels[id]`: `cleared`; `bestScore` (the visit's points plus both bonuses, highest kept);
  `bestTicks` (fastest; every attempt of the visit counts); `tokens` (OR-ed in); `spotless` (sticky).
- `unlocked` rises to the next main level (1..8); either exit counts.
- `secretFound`: only the secret exits of `mw03` and `mw06`.
- `finished`: clearing `mw08`. `hiScore`: on every clear and every way out.
- Rival Row: a fresh visit starts with `flags: { rivalsBeaten: save.data.rivalsBeaten }`; the scene
  copies a higher `world.flags.rivalsBeaten` up and commits at once; `champion` at 4.
- A fresh visit to any other level passes no flags. A retry passes
  `checkpoint: world.checkpoint, flags: world.flags, tokens: world.stats.tokens`.
- `map` (`MapMemory`): what the map has shown (`roads`, `beaten`, `champion`) and where Maxx last
  stood (`node`). Empty `roads` means the map has never looked at this save. `save.reset()` clears it
  (and keeps the settings). A check that rewrites the save between visits must keep `d.map`.
- `settings`: music and sound 0..10, rumble, screen shake. Mute lives apart, in localStorage `smm.muted`.
- The save follows the game's other tabs: on `storage` (its key, or a full clear), window `focus`
  and `visibilitychange` it compares the stored text with what this tab last read or wrote, and
  takes a newer one into `save.data` in place (repaired; broken JSON ignored; a removed key gives an
  empty save that keeps this tab's settings). `createSave` returns a `SaveHandle` (the `SaveApi`
  plus `onChange`, which the shell points at `applySettings()`, and `dispose()`, called on destroy).
  A map left open in a background tab still draws what it had until entered again; its next write
  carries the other tab's progress.

## 11. Drawing: renderers, Maxx, particles, HUD

### 11.1 Entity renderers (`render/registry.ts`)

```ts
registerRenderer('kind', (g, e, rc) => { ... }, { margin?, tick? })   // or 'kind:variant'
```

Put them in `game/render/entities/<slice>.ts` (loaded by glob). `rc` gives `sprites`, `world`,
`camX`, `camY`, `tick` (a cosmetic clock that keeps running while the world is frozen), `debug`,
`marks`, `draw(frame, worldX, worldY, opts)`, `sx`, `sy`, `fx(id, x, y, n, dir)`.

- Anchor sprites at the entity's feet: `(e.x + e.w / 2, e.y + e.h)`.
- Place everything through `rc.draw`, `rc.sx`, `rc.sy` or from `rc.camX` / `rc.camY`, never from
  `world.camera`: between ticks (section 11.2) the renderer moves `rc.camX` / `rc.camY` for one
  entity alone while its renderer runs, which is how that entity slides without any renderer
  knowing.
- `margin`: px past the box the art reaches (a number or `(e) => number`); an entity is skipped when
  its box is more than max(160, margin) px off screen.
- `tick(e, rc)`: once per simulation tick for each live entity near the screen. **Emit cosmetic
  particles there**: an `rc.fx` in draw() fires only on the first draw of each tick, so a slow screen
  can skip it. The versus card does not call tick hooks.
- A renderer that throws is switched off and reported once (`stats().problems`).
- Draw order: z < 0 behind the tiles, z 0 behind Maxx, z > 0 in front; inside each layer lowest z
  first, decor first at equal z, then spawn order. A prize popping (z -1) rises behind the tiles; while
  `world.warp.mode === 'pipe'` Maxx is drawn behind the tiles.
- `drawTileAs(...)` (render/tiles.ts) draws a tile as if it held another character, by the rules.
- The play scene's versus card calls your renderer at 2x or 3x with `rc.fx` a no-op and `rc.tick`
  the card's clock: what you draw in the level is what the card shows.

### 11.2 The world renderer (`render/world.ts`)

```ts
const r = createWorldRenderer(sprites, { shake, debug, marks, hideMaxx, pinned, weather })
// every tick: for (const ev of world.events) r.event(ev, world); r.update(world)
// every frame: r.draw(g, world)        // r.reset(world) for a new world
```

`update()` is the clock (particles age, `rc.tick` moves); `draw()` may run any number of times and
allocates nothing. `r.fx(...)` and `r.popup(...)` for scenes; `stats()` for checks.

**Drawing between ticks.** The simulation ticks at 60 Hz whatever the screen does. On a screen
clearly faster (the shell measures the median of 15 frame gaps; above 65 Hz), every frame is drawn,
part of the way from the last tick to the one before (`render/clock.ts`). `frameClock` is written
only by the shell: `frameClock.tick` every shell tick, `frameClock.alpha` (the part of a tick gone,
0..1) just before a frame's draw and back to 1 after it, so a tool or check drawing between frames,
and every `step()` and manual run, sees exact ticks. The renderer slides the camera, Maxx, awake
entities, droplets, particles and popups back by the same fraction, and only when it was updated in
the latest shell tick and its world stepped: paused, behind a versus card, on a pipe or door trip or
with the level over, the picture is the last tick's. A move over `LERP_MAX` (24 px) in one tick (a
respawn, a camera snap) is drawn where it is. At 60 Hz it stays off and every frame is exactly a
tick: a frame with no tick draws nothing. The HUD's hover meter slides with Maxx. Every scene's
`render()` may run one to three times a tick there, so a render must not change state.

### 11.3 Maxx (`render/maxx.ts`, atlas `maxx`)

`createMaxxPainter(sprites)` draws his whole in-level look (blink, dirt, wax ring, turbo glow, hover
jet, pipe, door fade, clear, flop). For other scenes: `maxxAnim(player)`, `timedFrame`, `maxxGrime`,
`drawMaxxFrame`. Draw at `(round(p.x) - camX + MAXX_W / 2, round(p.y) - camY + MAXX_H)`, flipped when
`p.facing < 0`.

- Every body frame is one cell, 77x68, anchor (42, 67): read `atlas.meta.cell`, do not hard-code.
- Animations: `run`, `sprayRun`, `sprayUpRun` (11 frames each, shared indices, step by
  `floor(player.runDist / meta.runStride)`, 7 px a frame); `idle` (`idle0, idle1, idle0, idle2` at
  44, 44, 44, 6); `jump`, `fall`, `skid`; `hurt` (2 at 4, 4); `grimed` (5 at 14, 9, 9, 7, hold the
  last); `win` (`win0, win1, win2, win1` at 10, 8, 8, 8); `sprayIdle`, `sprayUpIdle` (2 at 30, 30);
  `sprayJump`, `sprayFall`, `sprayUpJump`, `sprayUpFall`; `sprayDown` (hover, 2 at 5, 5);
  `mapWalk` (4), `mapIdle` (2) at 32x30 with anchor (16, 29). Also `head`, `gun`, `grime1`, `grime2`.
- Do not show Fall on `!onGround` alone: running over a one-tile gap leaves the ground about 3 ticks.
- Water leaves at `MUZZLE[aim]` from the anchor, mirrored when he faces left. A droplet is a point:
  draw it with an even size centred on `round(x), round(y)`.

### 11.4 Particles (`render/particles.ts`, atlas `fx`)

From the simulation `fx(w, id, x, y, n, dir)`; from a renderer `rc.fx` (in a tick hook); from a scene
`renderer.fx`. Ids: splash, sparkle, dust, debris, mud, bubble, star, smoke, foam, snow, confetti,
drip, steam, coin, shine, leaf, spark (plus `spatter`, renderer only). At most 48 a call and 400
alive. Popups: numbers yellow (4+ characters flash), `1UP` green, words blue; 12 at most.

### 11.5 HUD (`render/hud.ts`)

`createHud(sprites)`: `reset`, `update`, `draw`, `showScore`, `showClock`; `HURRY_TICKS` (3600). The
top row holds lives, the three pips in a tray, turbo, coins, a 7-digit score, cars (hidden when
`carsTotal` is 0), tokens and the clock. Below it: the wax bar, the hover meter over his head while
hovering, and the boss bar at y 318..349. Keep the level's important things out of the top ~30 px.

The boss bar shows the fighter's face: `hud/boss` (the mud clod) for MUDSLINGER and MUDZILLA, and
`hud/bossBill`, `bossStreaks`, `bossOllie`, `bossNick` for the rivals, picked by the name given to
`setBoss()` through `BOSS_ICON` in `render/hud.ts` (an unknown name or a missing frame keeps the
clod; `reset()` puts it back). A new fighter keeps the clod until a face is drawn in
`scripts/maxx/art-hud.mjs` and listed there.

Scores show 7 digits everywhere (HUD, tally, map, title, game over, ending), because the score runs
to `TUNING.maxScore` (9999999) and `counter(n, digits)` (engine/ui.ts) clamps at the width it is given.

### 11.6 Cars outside a level (`scenes/title/cars.ts`)

`drawCar(g, sprites, kind, x, feet, pose)` draws the game's own cars (title lot, How To Play, the
ending parade) with dull dirty bodies, mirrored dirt, the 14 faces and whole-pixel squash.
`pose()` makes the pose; set `rows` and `cols` for exact squash (the old `sy` still works).

## 12. Sound and music

### 12.1 From a scene

- `music(id)` at the start of a level (`areaMusic(world)`); the simulation asks for music on wax, on
  an area change and when a fight starts. `setTempoScale` after `music()`: a new song resets it to 1.
- `jingle(id, { onDone, thenMusic })`: the song is silenced meanwhile; `onDone` comes exactly once,
  never after the scene has been left. `stopJingle()` cuts one short (no `onDone`, no `thenMusic`);
  without `resume` nothing plays until the next `music()`, which starts even the same song; with
  `resume` the music carries on. **The shell stops any jingle on every scene switch.**
- `setPaused(true)` holds song, jingle and spray; menu effects still play.
- Tell the spray loop only on a change (`audio.spray(on)`) and switch it off in `exit()`.
- `ctx.audio.debug()` and `ctx.audio.meter('music'|'sfx'|'out')` show the sound.

### 12.2 Songs (`game/audio/songs/<id>.ts`, found by glob; the file name is the id)

| Id | Where |
| --- | --- |
| title | the title |
| map | the world map |
| sunny | MW01, MW02 |
| tunnel / storm / lube / highway / winter / mega | MW03 / MW04 / MW05 / MW06 / MW07 / MW08 (`levels/meta.ts`) |
| boss | MUDSLINGER and MUDZILLA (their `music` prop) |
| rival | all of Rival Row |
| bonus | token rooms (`AreaDef.music: 'bonus'`) |
| wax | Mighty Wax: 192 bpm, exactly one 10 s loop |
| ending | the ending |

Jingles: `clear`, `grimed`, `gameover`, `secret`, `versus`, `rivalDown`, `champion`. Switching songs
starts the new one from the top (a song's place is kept only across a jingle or a pause). Format:
header of `game/audio/format.ts`; check a song with `audio-render.mjs --only <id> --roll` and
`--compare --only <id>`. A song may declare `quotes` of other songs it quotes on purpose.

A song quiet by design is lifted where it plays with `gainDb` (format.ts, -6 to 6 dB; `lube` has
+2.8, and audio-render prints the level it plays at). `tests/audio-songs.mjs` holds every loop within
2 LU of the median loop, each melody under E6 except for touches, and the spray loop 8 LU under the
median song at the default settings (`SPRAY_LEVEL` 0.24 in `audio/index.ts`, K-weighted loudness,
not RMS).

### 12.3 Effects (`game/audio/sfx.ts`, 49)

The contract's `SfxId` list and `sfx.ts` must match exactly (the `seams` check names any missing or
extra). Emit from the simulation with `sfx(w, id)` or `sfxEvery(w, id, gap)`. New this round:
`squawk` (grackle), `gate` (a gate or shutter rolling up), `click` (floor button), `unlock` (a barred
door coming free), `whir` (blower gust, brush turning at a rail end; one sweep, not a loop),
`sizzle` (jet sputter and firing), `hydraulic` (Mudslinger's bed).

## 13. Controller, keyboard, touch

- Xbox (standard mapping): A jump + confirm, B spray + cancel, X / RB / RT spray, View select, Menu
  pause + confirm, D-pad and left stick move. Keys and thresholds: `game/engine/input.ts`.
- One button can be two actions. Menus start on `confirm`, never on `pause`. A pause menu closes on
  its own confirm or cancel; call `menu.reset()` when a menu appears.
- The shell injects a `pause` press when the player leaves (tab hidden, window unfocused, controller
  gone, Esc out of fullscreen, or focus moves to the app outside the game: the Ctrl-K palette,
  Shift+Tab to the sidebar); `(game as ShellCtx).autoPause` is true on that tick: pause on it, never
  resume. The sound stays held until focus is back on the canvas or a controller button is pressed.
- In fullscreen the shell asks Keyboard Lock for Esc (Chrome, Edge), so a tapped Esc reaches the game
  as pause and cancel; holding Esc leaves fullscreen. The lock is let go when fullscreen ends, when
  the request is refused, and on destroy.
- Tab is select only while the game canvas has focus (the canvas takes it on mount, on a pointer down
  on the stage, after the header buttons and on fullscreen). From anywhere else Tab moves focus as
  usual, and Shift+Tab always leaves the game. Test: `tests/input-tab.mjs`.
- Menus (`createMenu` in `engine/ui.ts`): up and down win, so a stick pushed on a diagonal walks the
  list and never changes a setting on the way.
- `axisX` is analog (full from 0.7, dead zone 0.3). `axisY` from the stick is 0 or -1/1. A lean up
  or down still counts toward run speed, so on a pad any run with up or down held is a full run.
  Use `held` / `repeat` for menus, not the axes.
- Prompts follow the device in use; the shell has called `bindGlyphs`.
- Rumble: forward `rumble` events to `game.input.rumble(strong, weak, ms)`; it fires only while the
  controller is in use and `settings.rumble` is on (`applySettings()` after a change).
- Sound unlocks on the first key, click or tap (`audio.locked` says whether it still waits); a tap
  counts when the finger lifts (`MaxxGame.tsx` unlocks on pointerup too). The header's sound button
  says "Click for sound" ("Tap for sound" on touch) while the browser holds sound back, and the click
  that unlocks never mutes.

## 14. Debug API

`window.__maxx` (dev page, debug on, dev builds only: a production build leaves `engine/debug.ts`
out): `ready`, `errors`, `ctx` (the ShellCtx), `handle`, `scene()`,
`sceneObject()`, `go(id, params?, transition = 'cut')`, `world()` (a scene exposes it as `world`),
`setManual(on)`, `step(n)`, `hold('right jump', { x?, y? })`, `release()`, `tap(actions, ticks)`,
`frame()` (the last InputFrame), `status()`. `window.__maxxHost.unmount()` / `.mount()` take the React
tree down and back up.

`checks/lib.mjs` `install(maxx)` adds `window.__t`: `mod('engine/text.ts')` (a game module as the
page has it), `place(col, feetY, face)` (teleport Maxx and the camera), `run(actions, n)`,
`until(actions, fn, max)`, `info()`, `tile(tx, ty)`, `ents(kind)`, `zoom(...)`, `native()`,
`pixel(x, y)`, and `window.__rec` (audio calls, rumble, frames drawn). A stand-in Xbox pad is a
replaced `navigator.getGamepads()`; `checks/pad.mjs` shows how.

**Loading the art.** `engine/sprites.ts` asks for a sheet that fails or times out twice more
(after 1 s, then 3 s) and keeps loaded images by URL, so a retry asks only for what is missing; a
load with a sheet missing is not kept for the page (`missingSheets(sprites)` names them). The shell
then shows its own text screen, THE PICTURES DID NOT LOAD / IF THIS KEEPS HAPPENING, RELOAD THE
PAGE / PRESS {confirm} TO TRY AGAIN, with `ready` true and `scene()` null; confirm loads again and
fades to the start scene once nothing is missing. `warmSheets(g)` draws one pixel of every sheet
behind LOADING, so the first level does not stall decoding them.

In Node: `loadSim()` from `scripts/maxx/lib/sim-loader.mjs` gives `sim`, `levels`, `contract`,
`input` (an input builder), `run`, `session`, `loadModule(path)` and `close()`. Tests use
`suite(name)` from `lib/testkit.mjs` (`t.flat(rows)`, `t.until`, `t.find`, `t.loadModule` and more:
see its header and `tests/kit.mjs`).

## 15. Traps

- **Holding the hover late goes further than holding it from the top** (10-tile pits, not 9;
  section 5). Tapping it no longer helps at all (it used to glide 18 tiles): closed, and searched
  for in `sim.mjs`.
- **Two things the level tools leave out carry Maxx further** (check a `not` claim near one by
  hand, against section 5): a blower blowing across a pit stretches every jump (a 120 zone 12 x 6
  tiles: 15 tiles with the hover), and a blob that can fall into a pit (`edges: false`) or ride a
  lift over one is a step in mid-air (stomped, it is a fresh bounce and a fresh hover). Hits and
  blobs on their floor no longer stretch anything: a hit in mid-air used to lift him 21 px (over a
  5-tile wall, across 11-tile pits) and a held stomp off a blob reached a 5-tile wall's top; both
  closed, and tested in `sim.mjs`.
- **A sleeping solid is not solid.** An entity off screen sleeps; a test that moves Maxx by hand must
  move the camera too (`__t.place()` does). Gates are always awake for this reason.
- **Dirty cars hurt on the roof too**; only washed cars are rides. A Mudslinger that is still dirty
  hurts the same way.
- **A gate's open drum is not solid** (the mudslinger tests rely on that): no standing on gates.
- **Brushes shut low corridors for good**; icicles over a slow clean-car ride always hit.
- **A blob on a belt with an open end** is carried off it backwards.
- **Mudzilla's right wall must be the area's last column**, or the camera slides onto whatever lies
  beyond when it is let go.
- **`shot.mjs` runs script in the page, which Chrome counts as a gesture:** sound is always unlocked
  there. The locked case needs `checks/unlock.mjs`.
- **After a source edit the dev server serves changed modules under `?t=` URLs.** A bare
  `import('/src/features/it/maxx/...')` from a page script is then a second copy (empty registries, unbound
  text). Go through `window.__maxx` or `window.__t.mod(...)`.
- **A check that reloads the page** must set `window.__maxxRun = window.__maxx.handle` afterwards and
  call `install(maxx)` again (as `title.mjs` and `map.mjs` do), or shot.mjs reports a restart.
- **The save's map memory:** `save.reset()` clears it; a script that rewrites the save must keep `d.map`.
- **A stand-in shares its areas with the dev level:** never mutate a stand-in's rows.
- **Decor names are checked only by the level lint** (against the tiles atlas; `validateLevel` has
  no atlas): a wrong name shows as a pink post in the viewer and overview, and as nothing in play.
  `tests/levels-lint.mjs` runs the lint over every level in `test.mjs`, so a shipping level with one
  fails there; a draft outside `levels/` needs `level.mjs lint <file>` by hand.
- **A sign's line breaks depend on the device:** the button pictures differ in width, so a line that
  fits on the keyboard can wrap on a pad. The lint measures every device; set breaks with `\n`.
- **Rival Row's world hash records its starting flags:** a run solved without `--flags
  rivalsBeaten=0` does not replay in the play scene.
- **`levels/index.ts` awaits at load** (the dev rooms and the sandbox, section 6.5): a module it
  loads that imported `levels/index.ts` back would wait on itself.
- **A scene's `render()` may run several times a tick** on a fast screen (section 11.2): keep state
  changes in `update()`, and position from `rc.camX` / `rc.camY`, never `world.camera`.
- **`rc.fx` from draw()** fires only on the first draw of a tick: use the renderer's `tick` hook.
- **Boss card portraits are the renderer's real paint:** a hat or squeegee raised high makes the
  fighter smaller on the card (Sir Streaks is 2x for that reason).
- **Moving the folder again** means changing `dev/maxx.html`, `dev/maxx-text.html`, `GAME_REL` in
  `scripts/maxx/paths.mjs` and the `include` of `scripts/maxx/tsconfig.json` together. The game
  was built in a staging folder (`maxx-wip/`) and moved here when it shipped. The route
  `/app/super-mighty-maxx` is lazy-loaded (its chunk, about 660 kB raw and 225 kB gzipped with the
  art's PNGs beside it, loads with this page alone), full-bleed (`AppShell.FULL_BLEED_PATTERNS`), for
  owner, manager and technician, inside React StrictMode, which mounts the game twice: the shell
  and the sprite loader allow that. The stored replays name their level file
  (`src/features/it/maxx/game/levels/...`); where that file is gone, replay.mjs and tests/solve.mjs
  open the level by its id, so they still play after a move.

## 16. Not verified by anyone yet

- A physical Xbox controller (everything about the pad was checked against a stand-in
  `navigator.getGamepads()`): rumble firing, the stick thresholds, hot-plugging, whether a button
  alone unlocks sound or allows fullscreen.
- Nobody has listened to any song or effect. Open listening questions: the rival song's high melody
  (mean B5) over a 10-minute level, the seven new effects' levels, the spray now 8 LU under the music
  (by numbers; it may sound too quiet), lube's bars 14 to 17 after the octave fix (`--compare --near`
  lists a weak likeness to Korobeiniki there), winter 1.3 LU under the median, a skipped versus card
  cutting its jingle mid-phrase, MW03's vault with three brushes whirring over the bonus song, and
  the likenesses `audio-render --compare` lists (mega bar 7 and the title's bar 3 against
  Greensleeves, rivalDown's arpeggio against the "Charge!" call, the champion jingle against highway
  part C).
- Every fight's fairness and length come from scripted players, not people. So do the new skill
  tokens: MW03's brush run (the pair lets a dash through on 21 of 108 ticks), MW04's mud jump (5 of
  17 take-off ticks, a late press), MW07's gust ride (57 ticks of the lift's 360, `tests/mw07-gust.mjs`)
  and Rival Row's spring.
- Drawing between ticks on a real 75, 144 or 165 Hz monitor (proved only with a stand-in
  requestAnimationFrame, in Node and in headless Chrome).
- A tapped Esc in real Chrome or Edge fullscreen (headless keys skip the browser's own handling).
- A level entered with what the level before left: the stored runs and the campaign check all start
  fresh, and with the turbo nozzle carried into MW04 (from Rival Row) or MW08 (from MW07) the same
  inputs play differently. Try those two fights with a carried turbo.
- Frame rate on an office PC or a phone; Firefox, Safari and a real phone; the game inside the
  signed-in app shell.
