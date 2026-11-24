# Level tools: the manual

Six commands tell you whether a level is correct, fair and finishable before anyone has played it. All of them use the real game simulation, not a model of it.

| Command | What it answers |
| --- | --- |
| `level.mjs lint` | Is the level well formed? Rows, starts, warps, signs, arrival points, the clock, the shipping rules, whether the game opens it. |
| `level.mjs reach` | Where can Maxx get to, and how? A map of every place he can stand, what each secret needs, and the fairest route to the goal. Terrain only. |
| `level.mjs expect` | Are your claims true? "The roof is unreachable unless the grime is washed." |
| `level.mjs fuzz` | Does random play agree with the map? A second opinion. |
| `solve.mjs` | Can a careful player actually finish it, with every car, critter, hazard and boss in it? |
| `replay.mjs` | Does it still play the same after changes? And what does the run look like (pictures)? |

All commands run from the repo root. The short form of this manual is section 2.10 of `docs/super-mighty-maxx/NOTES.md`.

## Contents

1. Commands at a glance
2. The routine for every level, and what "proven" means
3. Coordinates
4. Numbers to design by
5. lint
6. reach
7. expect
8. fuzz
9. solve
10. replay
11. Worked example: from an empty file to a proven level
12. Reading any failure
13. Honest limits, tool by tool
14. Cost
15. For tool writers

---

## 1. Commands at a glance

```
node scripts/maxx/level.mjs list
node scripts/maxx/level.mjs lint   <level | all> [--strict]
node scripts/maxx/level.mjs reach  <level> [--area id] [modes] [--hover off|top|held|all] [--cols 40-120] [--width 100]
                                   [--no-map] [--json file] [--png file] [--scale 8]
node scripts/maxx/level.mjs expect <level> [--reach "..."] [--not "..."] [--fair "..."] [--file f] [modes]
                                   [--hover off|top|held|all] [--verbose]
node scripts/maxx/level.mjs fuzz   <level> [modes] [--ticks 2e6] [--seed n] [--hover off] [--json file]
node scripts/maxx/solve.mjs        <level> [--exit goal|secret] [--tokens] [--spotless] [--seed n] [--out file.json]
                                   [--budget seconds] [--allow-tight] [--verbose] [--debug]
node scripts/maxx/replay.mjs       <file.json> --verify
node scripts/maxx/serve.mjs --port <p> -- node scripts/maxx/replay.mjs <file.json> --port <p> --out <dir>
                                   [--every 120] [--scene viewer|play] [--half] [--cols 4]
```

`--no-hover` and `--held-hover` still work: they are the old names of `--hover off` and `--hover held`.

### Naming the level

`<level>` is one of:

- a level id: `sandbox`, `dev-reach`, `mw01`, and so on;
- the path of a level's `.ts` file. This can be anywhere, even outside the repo, so a draft can be checked before it is placed.

The tools find levels the way the game does (`src/features/it/maxx/game/levels/index.ts`):

- `levels/mw01.ts` .. `mw08.ts` and `rivals.ts`, each by its **default export**;
- the test rooms in `levels/dev/*.ts`, each by its default export;
- the sandbox (`levels/sandbox.ts`, a named export).

A new `mw01.ts` is found without touching any other file. `list` shows every level found, its file and how many `EXPECT` lines it has; a level the game would not open by its id says `NOT OPENED BY THE GAME` (lint says why), and two files defining one id are named.

### Modes (reach, expect and fuzz)

| Flag | Meaning |
| --- | --- |
| `--grime kept\|washed` | Grime blocks stay as walls, or are washed away. |
| `--gates closed\|open` | Gates and locked doors stay shut, or every flag in the level is set. |
| `--cars none\|roofs` | No car roofs, or a washed car parked at every car spawn and spawner. |
| `--hidden off\|on` | Hidden blocks are not there, or are already bumped. |
| `--mode all` | Everything open. |

### Hover settings (reach and expect; fuzz takes off or all)

| Flag | Which hovers the map tries |
| --- | --- |
| `--hover all` (default) | Every hover a player can do: held from the top of the jump, held but begun late, tapped. |
| `--hover held` | Held from the top or begun late, never tapped. The same places as `all`: tapping never reaches more (section 4). |
| `--hover top` | Held from the top of the jump only: what level 2 teaches. |
| `--hover off` | No hover at all. |

### Exit codes

| Tool | 0 | 1 | 2 |
| --- | --- | --- | --- |
| list | every file loads, no id twice | two files define one id | a bad command line |
| lint, reach, expect, fuzz | clean | lint errors, failed expectations, or something random play reached that the map says it cannot | bad command line, or a level that does not load |
| solve | finished as asked | not finished (the report says where and why) | bad command line |
| replay | every hash matched | a mismatch | bad command line or file |

## 2. The routine for every level

1. `lint mwNN`. Fix every ERROR and read every warn. Try `--strict` on a test room you mean to ship.
2. `reach mwNN --png mwNN.png`. Every token and exit must be reachable, and nothing reachable that should not be. The route must have no TOO TIGHT (nor PIXEL-EXACT) and no unexpected NEEDS HOVER or NEEDS LATE HOVER. Look at the PNG.
3. `expect mwNN`. Write your claims as `export const EXPECT: string[]` in the level file, and keep them passing.
4. `fuzz mwNN` once the level is nearly done. It should say OK.
5. Solve it four ways. Each must exit 0:
   - `solve mwNN --out scripts/maxx/replays/mwNN-goal.json`
   - `solve mwNN --tokens --out scripts/maxx/replays/mwNN-tokens.json`
   - `solve mwNN --spotless --out scripts/maxx/replays/mwNN-spotless.json`
   - `solve mwNN --exit secret --out scripts/maxx/replays/mwNN-secret.json`, if the level has a secret exit.

   Read "where it struggled". Hits, long waits, heavy searches and "used the hover begun late" are places a person will struggle too.
6. Watch it:

   ```
   node scripts/maxx/serve.mjs --port <your port> -- node scripts/maxx/replay.mjs scripts/maxx/replays/mwNN-goal.json --port <your port> --out <dir>
   ```

   Then open the contact sheets. Never start Vite yourself; serve.mjs starts the server and stops it.
7. Keep the replays in `scripts/maxx/replays/`. `node scripts/maxx/tests/solve.mjs` (and so `test.mjs`) plays every file there: when the level or the simulation changes under one, that test fails, and the fix is to solve again, read the new report and replace the file.

### What "proven" means

A level is proven when, at its current rows:

1. `lint` has no ERROR, and every warn has been read;
2. `expect` passes, and its EXPECT holds at least `reach tokens with all`, a `fair goal` (with `hover=off` for MW01 and MW02, `hover=top` where only the taught hover is wanted), and a `not ... unless ...` for every secret and every place that must stay out of reach;
3. `fuzz` says OK;
4. `solve` exits 0 the four ways above, with no hit or STUCK that nobody has looked at;
5. those runs are kept in `scripts/maxx/replays/` and replay (the solve test does that);
6. someone has looked at the contact sheets of the browser replay.

## 3. Coordinates

Every place is written `area col,row`. Columns and rows count from 0, at the left and the top.

- **A standing place.** `row` is the row Maxx's feet are in: where you would write `@`. Standing on a floor in row 10 is row 9. `col` is the column of his middle. At the lip of a ledge his middle can be over the first column of the pit.
- **A thing in the level** (a car, a sign, a block). The column and row are those of its own character in your rows.

## 4. Numbers to design by

These are measured in the real simulation, and the map finds every one of them (tests/reach.mjs pins them).

| Thing | Fact |
| --- | --- |
| Walls | 3 and 4 tiles are climbed. 5 is a barrier, by 2 px. |
| Mud | A 3-tile wall out of mud is climbed only with a running jump, by 1.5 px thanks to the ledge nudge. Never from a stand. A 4-tile wall from mud: never. |
| Pits without the hover | 6 tiles is the most. 7 never. |
| Pits, hover held from the top of the jump | 9 crossed, 10 not. |
| Pits, the hover begun late | 10 crossed (8 of 23 take-off ticks), 11 never. |
| Tapping the hover | Never gets further than holding it (it used to glide 18 tiles; the simulation changed). |
| Gaps | A one-tile gap is run across. Only a slow, half-stick walk drops in. |
| Catwalks | One 4 tiles up is jumped onto from below. There is no dropping through a catwalk. |
| Run-ups | Belts, slick floor and oily floor do not lengthen a jump: once he is in the air the floor is gone. |

Onto a ledge higher or lower than the take-off, the widest gap the map crosses (the same as NOTES.md section 5's table, which `node scripts/maxx/sim.mjs --ledges` measures):

| Landing ledge | No hover | Held from the top | The most any hover gives |
| --- | --- | --- | --- |
| 4 tiles up | 5 | 7 | 7 |
| 3 up | 5 | 8 | 8 |
| 2 up | 6 | 9 | 9 |
| 1 up | 6 | 9 | 10 |
| level | 6 | 9 | 10 |
| 1, 2, 3 down | 7 | 10 | 11 |
| 4 down | 7 | 11 (one pixel-exact run-up; the table's 23 take-offs give 10) | 12 |

**The hover begun late.** The hover's 42 ticks are a stretch of airtime that runs down from its first tick whether {down} + {spray} stays held or not. So tapping it is never better than holding it. But a hold begun some ticks after the top of the jump goes further than one begun at the top: he keeps his full run until it starts, and the hover throws away the fall speed he has built up. Nobody is taught that, so:

- A pit or gap meant as a barrier must beat the last column of the table, with a tile to spare.
- A secret meant to be reachable one way only must hold against that last column from anywhere near it.
- The map tries the late hover everywhere, so `not` claims hold against it. To check a claim for a player who only knows the taught hover, write `with hover=top`; route flags say NEEDS LATE HOVER where only the late hover does it.

## 5. lint

`node scripts/maxx/level.mjs lint mw03`, or `lint all` for every level found.

It runs `validateLevel` first (lines marked `validator`, minus what the checks below say again with a place), then these checks.

- ERROR means it breaks play or a hard rule.
- `warn` means look at it.
- "ship" means the severity depends on the level: ERROR in a shipping level, warn in a test room.

| Check | Severity |
| --- | --- |
| Every row of an area the same length | ERROR |
| Exactly one `@`, in the first area | ERROR |
| An exit exists: a goal, a secretExit, or a `mudzilla` (it completes MW08 itself). This checks presence only; `reach` proves you can get there. | ERROR |
| The game opens the level by its id: a main level from `levels/<id>.ts` as the default export, for an id `levels/meta.ts` lists; a test room as the default export of a file in `levels/dev/` | ERROR for a file in `levels/`; warn for a draft elsewhere |
| Two files define the same level id (`lint all`) | ERROR |
| Exactly three tokens in the level | ship |
| Token `props.index` is 0, 1 or 2, and not used twice | ERROR |
| A level over 120 tiles has a checkpoint. Length is the sum of the widths of all areas except `bonus` themed ones. | ship |
| Every legend character is used | warn |
| A character used but not defined | the validator's ERROR |
| Every kind is registered (`kind 'x' is not registered (yet)`) | warn |
| Every pipe and door `to` names an area, and a marker, pipe or door there with that `props.name` | ERROR |
| A marker no pipe or door leads to | warn |
| A pipe not 2 tiles wide | warn |
| Every area can be entered from the first through pipes and doors | ship |
| No area is a dead end (no way out and no exit) | ship |
| Where Maxx appears (the `@`, a checkpoint, a marker, a named pipe or door): all of his 2-tile body is in the open | ERROR |
| ... and something is under him | ERROR when nothing is (he falls out, or into sludge) |
| ... and the ground is less than 3 tiles below | warn when it is further (he drops as he appears) |
| Decor `props.sprite` exists in the tiles atlas | warn |
| Decor with words (`meta.decor[name].words` in the tiles atlas) and `flip: true`: words never mirror, so the flip does nothing | warn (it names the `_left` prop when there is one) |
| Sign text: a long dash, a character the font lacks, an unknown `{prompt}` | ERROR |
| Sign text: lower case, a fixed `{pad_a}`-style button, over 70 characters | warn |
| Something spawned inside a solid tile, or whose box sticks into one | ERROR if it moves or must be picked up; warn for fixed things |
| A car or car spawner within 10 tiles of the start | ship |
| A car with nothing under its wheels | ERROR |
| `!` `W` `L` `h` with a solid tile right on top (the prize comes out inside it) | ERROR |
| `?` `C` `H` with a solid tile right on top | warn |
| A one-tile pit with nothing to land on: it traps nobody | warn |
| The clock under 1.5 times a flat-out run | ERROR |
| The clock under 1 s a tile | ship |
| The clock over 3 s a tile (shipping levels only), or different from `levels/meta.ts` | warn |
| The level name in lower case (shipping levels only) | warn |

Shipping levels are `mw01`..`mw08` and `rivals`. In any other id (a test room) the shipping rules are warnings. In particular an area nothing leads to is fine in a test room: a bench for the viewer. `--strict` applies the shipping rules to a test room.

```
LINT dev-hazards "Hazard Lab" (2 areas, test room: the rules of a shipping level are warnings)
  warn   lab              area 'lab' cannot be entered: no pipe or door from the first area's side of the level leads there
  dev-hazards: 0 errors, 1 warning
```

## 6. reach: the terrain map

`node scripts/maxx/level.mjs reach mw03 [--area tunnel] [--grime washed] [--hover top] ...`

### What it does

From every place Maxx can stand at rest, it plays about 90 input macros on a copy of the level and records where he comes to rest. The macros (each both ways where it has a direction):

- step, run, a 45-tick run, a half-stick walk;
- jumps from a stand held 1, 8 and 40 ticks;
- running jumps;
- a run to the lip (or the wall) with the jump pressed there, or on the last tick of coyote time (the furthest take-off there is);
- each jump with no hover, the hover held from the top, the hover begun 6, 12, 18 and 24 ticks after the top, and the hover tapped;
- running off a ledge with each of those hovers;
- air moves: straight up then sideways, turn back at the top, let go at the top;
- down on a pipe, up at a door.

**The lip sweep.** The very longest jumps (11 tiles onto a ledge 1 down, 12 onto one 4 down) work only from the last coyote tick, with the hover begun within a tick or two of one moment, and from a run-up whose start is right to the pixel. So from one place a lip (where a run to it takes 16 to 26 ticks, or the far end of a shorter floor) the map also tries run-ups moved 0 to 3 px back, with the hover begun every other tick from the top to 26 ticks after it. What only the sweep finds is marked PIXEL-EXACT and counts as too tight.

A late hover's flight is its plain flight up to the tick the hover starts, so the plain run hands over a copy of the world at that tick and the late one carries on from there (exactly the same result, about a fifth fewer ticks; a test proves it).

Every answer "reachable" is a real input sequence played in the real simulation.

### What the copy keeps

- **Removed:** everything harmful (cars, critters, hazards, bosses, rivals), and everything not solid except pipes, doors and the exits.
- **Springs stay.** Lifts and anything else solid that moves on its own, such as a washed car shuttling between walls, are timed and tried at 6 moments of their cycle.
- **A platform that moves off for good** (a washed car driving out of the level) is left out.
- **Water washes nothing.** Grime is a mode instead.

### What play changes for good

Play changes some things permanently, and the map follows:

- A brick (`B`) bumped from below is gone.
- A button touched sets its flag: its gates open and its locked doors unlock.

After the first pass, reach maps everything again in a world with those bricks gone and those flags set, until nothing new happens. A move found that way says so on the route as `[first: the brick at main 10,7 broken]` or `[first: flag 'gates' for the gate at main 142,9 (the button at main 135,8 sets it) set]`.

Gates opened by a boss or rival (a flag set in play) are not known to the map: use `--gates open` for those.

### Modes: what a secret depends on

| Flag | Meaning |
| --- | --- |
| `--grime kept\|washed` | Grime blocks are walls, or gone. |
| `--gates closed\|open` | Open: every `props.flag` in the level is set when the world is made, so gates are open and locked doors unlocked. Use it for flags a boss or rival sets. |
| `--cars none\|roofs` | Roofs: a washed car parked at every car spawn and spawner, to find car-roof steps. |
| `--hidden off\|on` | On: hidden blocks already bumped, so you can stand on them. Off: you can bump one, but not climb on it. |
| `--mode all` | Everything open. |
| `--hover off\|top\|held\|all` | Which hovers it tries (section 1). |

The default is the fresh player: grime kept, gates closed, cars none, hidden off, every hover. Bricks and buttons are followed in every mode.

### Output, top to bottom

**1. Header.** The mode and hover setting, standing places reached, how many with everything open, the number of macro runs, and the time.

**2. A map for each area.** Your rows, with marks in blank cells only. A ruler of column numbers sits on top and row numbers on the left. `--cols 120-200` shows a window, `--width` sets the band width, `--no-map` skips the map.

| Mark | Meaning |
| --- | --- |
| `.` | Reachable in this mode. |
| `:` | Reachable only with more modes. |
| `x` | A top he could stand on but never reaches. Everything past the goal is `x`: touching the arch ends the level. |
| `+` | A stop on the cheapest route to the goal. |

**3. Summary.**

- `goal` and `secret exit`: one of
  - `REACHED   cheapest N ticks = S s (clock T s)`;
  - `needs grime washed` (the fewest extra modes that make it reachable);
  - `UNREACHABLE, even with everything open`.
- `token N`: its place, then `reached, N ticks`, or what it needs.
  - N is the token's slot: `props.index` + 1, else reading order, top row first.
  - `touched only on a jump that ends in a grime` means the jump that grabs it kills him.
- Coins, bubbles, other pickups, buttons, checkpoints: `n of m reached`, with the misses and their places, marked `(needs a mode)` or `(only by dying)`.
- `blocks`: bumpable and hidden blocks actually bumped from below. A `?` with no room under it shows as never bumped.
- `gate` and locked `door` lines: the flag each waits for and what sets it.
  - A button: whether Maxx can reach it.
  - Otherwise: `set by <kind>`, or `set in play (a boss or rival when beaten ...)`.
- `pipe` and `door` lines: one of
  - `works, comes out at <place>`;
  - `needs a mode to use`;
  - `never used (not reached, or locked)`;
  - `leads nowhere (an arrival point only)`.

**4. The route to the goal**, and to the secret exit when that is reachable in this mode. It is given in moves. Plain runs along one floor are merged.

- Each move has its tick cost. A lift wait shows as `(+n waiting for the platform to come round)`.
- Every jump has `window works/tried`:
  - For a running or lip jump, the press is moved from 8 ticks earlier to 8 later; the window counts consecutive presses that land on the same floor (its lips included).
  - For a jump from a stand, the start is moved in 4 px steps (about a tick of running).
  - Jumps off a moving platform show `(off a moving platform)`.
- The flags on a move:
  - `TOO TIGHT`: under 4.
  - `(PIXEL-EXACT: ...)`: found only by the lip sweep (one run-up to the pixel and one hover start); it also says TOO TIGHT.
  - `NEEDS HOVER`: no move from that place gets there without the hover.
  - `NEEDS LATE HOVER`: only a hover begun after the top of the jump does it.
  - `NEEDS PULSED HOVER`: only tapping it. This should never show (see below); if it does, tell the tools owner.
  - `[first: ...]`: a brick to break or a button to press before the move.
- The route is the cheapest **fair** one. It takes a tight or pixel-exact jump only when there is no other way, a hover only when nothing else gets there within about 10 s, a late hover within about 20 s, and a tapped one only when the map has no held way at all. Tapping never reaches a place a held hover does not (tests/reach.mjs compares the map with and without it), so no route taps. Whatever is flagged on the route is something your level really asks of the player.
- The closing lines name the hardest jump, the too-tight list (pixel-exact ones included) and the needs-the-hover list. A late hover is marked `(begun late: {down} + {spray} held from n ticks after the top of the jump)`.
- Times are rest to rest, so a player who never stops is a good third quicker.

**5. Files.**

- `--json file` writes the graph: nodes, edges (macro, ticks, cost, phase, hover, late, pulse), targets with reached / reached-with-everything-open, blocks, and the route. Several MB for a 216-column level.
- `--png file [--scale 8]` draws the map:
  - tiles in colours;
  - a green bar: reachable; orange: only with a mode; red: never;
  - a white square: a route stop;
  - a white outline: a lift that was ridden (grey if it never was);
  - goal green, secret exit pink, tokens gold, coins grey, checkpoints blue.

```
SUMMARY
  goal         REACHED   cheapest 2238 ticks = 37.3 s (clock 300 s)
  token 1      main 84,9      needs grime washed
  token 2      main 105,3     needs hidden on
  token 3      main 123,2     reached, 1198 ticks = 20.0 s
  ...
     12  main 173,9         run right and jump at the lip (full) -> main on the lift at col 183  89 ticks (+217 waiting for the platform to come round)  window 10/17
    hardest jump: move 2, jump right from a stand (full), let go at the top from main 19,9: works on 8 of 13 4 px steps of where he stands
    too tight (under 4, or pixel-exact): none
    needs the hover: none
```

## 7. expect: write down what must be true

One expectation a line:

```
reach|not|fair <targets> [with <modes>] [unless <modes>] [within <n>s]      # comment
```

### Verbs

- `reach` passes if every target named is reachable. For a range of places: at least one place in it.
- `not` passes if none is reachable.
- `fair` means reachable, with no jump on the cheapest fair route under 4 ticks, none pixel-exact, and none that needs the hover (held, late or tapped).

### Targets (comma separated)

- `goal`, `secret`
- `tokens` (all three), `token1`, `token2`, `token3`
- `checkpoints`, `checkpoint2`
- `coins`, `blocks`
- `area:<id>` (anywhere in that area)
- places: `[area]@cols[,rows]`, such as `@120-140,2`, `tunnel@57,4`, `bonus@3-20`. The area is optional and means the first area. Rows are optional and mean any row. Rows are feet rows.

### with, unless, within

- `with` takes `grime=washed`, `gates=open`, `cars=roofs`, `hidden=on`, `all`, and one hover: `hover=off` (none), `hover=top` (held from the top only), `hover=held` (never tapped), joined with commas. With no hover named, every hover counts.
- `unless M` goes only with `not`: not reachable in the base mode, **and** reachable once M is added.
- `within 90s` (or `ticks`): the cheapest fair route takes no longer.

### Where expectations come from

- The command line, each flag repeatable, `;` separating several: `--reach "goal,tokens"`, `--not "@120-140,2 unless grime=washed"`, `--fair goal`.
- A file: `--file path.txt`.
- **With none of those: `export const EXPECT: string[]` in the level's own module.** That is the convention: keep the claims next to the rows.

`--hover off|top|held` on the command line applies to every line that names no hover of its own.

```ts
export const EXPECT: string[] = [
  'fair goal with hover=off            # level 1: nobody needs the hover',
  'reach goal within 150s',
  'reach tokens with all               # every token can be had somehow',
  'not token2 unless grime=washed      # the grime-wall token',
  'not @120-140,2 unless grime=washed  # MW03: the tunnel roof only through the vent, against every hover',
  'not secret unless grime=washed      # ... and the EMPLOYEES ONLY door only from the roof',
  'reach secret with grime=washed',
]
```

`levels/dev/reach.ts` has 11 lines, among them a shelf one tile above the tire-stack ledge and 10 tiles across:

```ts
  'reach @135-138,2 # the shelf over the pipe: 10 tiles from the tire stack, with the hover begun late',
  'not @135-138,2 with hover=top # ... which a hover held from the top of the jump falls short of',
```

### Output

`PASS` or `FAIL` per line, with why. A fail says what happened:

- `token 2 IS reachable with grime kept, ... by run right and jump at the lip (full) + hover begun 12 ticks after the top from main 122,2`
- `... is NOT reachable ...; it needs grime washed`

A `fair` fail names the move and its window, `is pixel-exact`, or `needs the hover begun late`. Lines with many targets list only their failures; `--verbose` lists all.

## 8. fuzz: a second opinion on the map

`node scripts/maxx/level.mjs fuzz mw03 [--ticks 2e6] [modes] [--hover off]`

It plays millions of random held inputs (directions, the half stick, jumps of every length, the hover any old way, up and down) on the same world the map uses, checked against the map with every hover. It keeps a saved world for every new little square of the level and goes on from the least tried. Then it compares what it reached with the map.

- `OK: random play reached nothing the map says is out of reach`: what you want.
- `RANDOM PLAY REACHED n THINGS THE MAP SAYS IT CANNOT`: each with its place.
  - `(beside spikes or sludge: a pixel-exact landing)` marks a spot only a lucky landing stands on. Real, but usually leading nowhere.
  - Anything else: tell the tools owner. `--json` writes the input that got there.
- `n more only after bumping hidden blocks`: random play keeps a bumped hidden block, and the map counts that as `hidden=on`. Expected.
- `the map has n places random play never stood on`: normal. Random input rarely lands a precise jump.
- If random play keeps 150,000 saved worlds, it says `(the most it keeps)` and plays on only from those.

Random play cannot press buttons (the map's copy has none), so a gate opened by a button is the map's alone.

## 9. solve: a careful player plays it for real

`node scripts/maxx/solve.mjs mw03 [--exit secret] [--tokens] [--spotless]`

It plays the level to the end in the real simulation, with everything in it, the way a careful, competent person on a controller would. It is not a speedrun. The run is written as a replay.

### Options

| Option | Meaning |
| --- | --- |
| `--exit goal\|secret` | Leave by the goal (the default) or the secret exit. Leaving by the other one is a failure. |
| `--tokens` | Also take every token, in the cheapest order, through pipes and doors. |
| `--spotless` | Wash every car the level counts: placed cars, and what counted spawners send. |
| `--seed n` | The world's random seed. Default: the game's own, the one the play scene uses. |
| `--out f` | Where the replay goes. Default `<temp>/maxx-<level>-<options>.replay.json`, printed at the end. Keep a proven level's in `scripts/maxx/replays/`. |
| `--budget s` | Seconds of thinking before it gives up (default 900). |
| `--allow-tight` | May use a jump the map measures under 4 take-off ticks, or a pixel-exact one. Without it, never. |
| `--verbose` | Every decision: `t <tick> <place> <what>`. |
| `--debug` | Also: each try where the first failed, the plan of each decision, what it had not yet seen, and when something surprised it. |

### How it plays (what you can rely on)

**Route.** It takes reach's map (every hover) and works out the cheapest fair way from every place to its current target. Too-tight and pixel-exact jumps are banned; the late hover is taken only when nothing taught gets there within about 10 s more; a tapped hover, never while a held one does.

**Trying moves.** Before each move it tries the move on a copy of the world, in several versions, and takes the soonest one that gets it nearer unhurt:

- now, and after waits of 6 to 180 ticks;
- at the right moment of a lift's cycle;
- after spraying forward or up at a threat;
- after backing off;
- as a jump with the gun on;
- by another way on.

Standing still a moment after the move must be safe. With a threat coming, a simple answer must keep him unhurt for 1.5 s. If nothing works, it searches short sequences (4 deep), and while it waits it holds off what is coming.

**What it knows.**

- A thing counts as known 10 ticks after it comes on screen: reaction time. Nothing it never saw is in its look-ahead.
- It looks again when something new becomes known.
- It looks again when something known and dangerous nearby is not where it expected (a car turned round).
- In the air it can still steer: keep going, let go, turn back, hover.
- Things foreseen from a telegraph it saw are known at once.
- What it saw is remembered on a retry.

**What the map planned with, earned in play.**

- It washes grime on a move's path.
- It bumps hidden blocks from below, climbing a staircase from the bottom.
- It breaks bricks the map broke.
- It presses buttons.
- It sprays things near a shut gate that might set its flag.
- It walks up to a boss so the fight starts.
- If the map cannot reach the goal at all, it goes as near as the map goes: in the goal's area, else the places farthest into the level. Then it waits 10 s for a boss to end the level.

**Fights.** While `world.boss` is set, every decision is a small beam three moves deep:

- the moves: spray at it, spray up, wait, step, jumps, dashes, and the map's jumps from where he stands;
- each line must be survivable a second past its end;
- the score: no hit first, then dirt washed off the boss, then room either side.

**Hits.** A hit is a hurt, even if a bubble on the same tick healed the pip.

**Lives.** A GRIMED or TIME UP costs a life and it retries from the checkpoint, as the play scene does (3 lives).

### The report

```
SOLVED t-late "Test"  (exit goal)
  time         337 ticks = 5.6 s played (clock 300 s, 294.4 s left at the end; 2% of the clock)
  hits taken   0
  cars washed  0 of 0
  tokens       - - -
  score        0
  ended        clear by the goal
  where it struggled (1):
    main 7,9         tick     63  used the hover begun late (held from 12 ticks after the top of the jump), which nobody is taught: go
  search       3 decisions, 3 look-aheads, 0.00M ticks simulated, 0.3 s
  replay       C:\...\maxx-t-late-goal.replay.json (1 attempt; replays to the same world, hash ...)
```

| Line | Meaning |
| --- | --- |
| `time` | Ticks of play over all attempts, against the clock. It plays rest to rest before jumps, so a flowing player is 1.3 to 1.5 times quicker. |
| `hits taken` | Hits, and lives lost (retried from the checkpoint). |
| `cars washed n of m` | Without `--spotless` it washes what is in its way and jumps or avoids the rest. |
| `where it struggled` | Every hit and what from. Every stretch of over 8 s of play without getting nearer. Every decision of over 2 s of search or 200k look-ahead ticks. Every GRIMED or TIME UP. Every use of the hover begun late (or tapped). These are places a person will struggle too. |
| `moves it would not use` | Jumps the map measured too tight or pixel-exact, and moves it gave up on after they kept failing (with what hurt it). |
| `note` | The modes it planned with, or `the map has no way to the goal: the level was finished in play` (a boss ended it). |
| `map` | A target the map cannot reach at all, with the nearest place Maxx can stand. |
| `replay` | The file, and whether it replays to the same world (checked before it is written). |

### When it fails: the STUCK block is your bug report

```
  STUCK at main 14,9
    going for   the goal
    why         every way on was tried in play and failed: hit by jet (main 17,9) (on 33 moves)
    what it tried:
      go: hit by jet (main 17,9) at main 16,9
      ...
```

| Kind | Meaning | What to do |
| --- | --- | --- |
| `STUCK at <place>` | No progress for 60 s of play. `why` names the cause: what kept hitting it, or that the map has no way on. `what it tried` lists each try and what hit it. | Look at that place: a hazard with no gap, a car with no room to wash it, a jump only a lucky player makes. |
| `(unreachable)` | The map cannot reach a target in any mode, or needs car roofs (it cannot plan rides on parked car roofs). Or it went as near as it could and nothing happened for 10 s. | Run `reach`. |
| `(out of lives)` | 3 lives lost. The struggle lines give each GRIMED and its cause. | Fix the place it died. |
| `(budget)` | Ran out of thinking time. | Rerun with a bigger `--budget`; tell the tools owner. |
| `(wrong exit)` | It reached the other exit by accident. | Keep the exits off each other's way. |
| `(not spotless)` | Lists `not washed:` cars by where they start. | Give the player room and time. |
| `(tokens)` | A token was not taken. | Check where that token is. |

Blame names: the harmful thing touching him, with its place (`jet (main 17,9)`, `sedan car (main 375,9)`); `sludge at ...`; `spike strip at ...`; `a fall out of the bottom of the area`; `the clock ran out`.

## 10. replay

### Node: the regression test

`node scripts/maxx/replay.mjs <file.json> --verify` plays every attempt with the current code. It compares the world hash at the end of each attempt, and every 600 ticks on the way, with what was recorded.

```
REPLAY dev-reach (1 attempt, seed default, exit goal, tokens)
  attempt 1: 3526 ticks, ended clear by the goal, hash 7caa8284 MATCHES
  recorded: solved, 3526 ticks, hits 0, cars 0/0, tokens 1 2 3, score 3020
  OK: the replay plays to the same world with the current code
```

`DIFFERS ... first differs at the mark of tick 1800` means the level or the simulation changed since the replay was made. Solve again, read the new report, and replace the replay if it is still right.

Every replay in `scripts/maxx/replays/` is played by `node scripts/maxx/tests/solve.mjs` (and so by `test.mjs`), one test each.

### Browser: pictures and contact sheets

```
node scripts/maxx/serve.mjs --port <p> -- node scripts/maxx/replay.mjs <file.json> --port <p> --out <dir> [--every 120] [--scene viewer|play] [--half] [--cols 4]
```

- **What it does.** It opens the dev page in headless Chrome and steps the game one tick per recorded frame, through the real input path. It checks the world hash against Node's every `--every` ticks and at each attempt's end.
- **Pictures.** It saves a 640 x 360 picture at those ticks, plus one 40 ticks after the end. They are named `<dir>/<level>-<attempt>-t<tick>.png`.
- **Contact sheets.** `<dir>/<level>-sheet-<n>.png`: 4 x 5 pictures a page. Each picture has a caption:
  - `TRY n`, when there was a retry;
  - `T <tick> <seconds>S <area> <col>,<row>`;
  - `HIT` in red, if he took a hit since the last picture;
  - the end state in green (`CLEAR`, `GRIMED`);
  - `AFTER` on the very last picture.
- **Scenes.**
  - `--scene viewer` (the default): the real world renderer and nothing on top.
  - `--scene play`: the real play scene with HUD, banners and its own retries. It needs a replay made with the default seed.
- **Exit 0** means every hash matched.
- **Nothing in the page is patched.** The simulation takes sin, cos and hypot from `sim/mathx.ts` (plain arithmetic, the same bits in every engine), and `sim.mjs` fails on any engine Math function in the simulation or the levels. Chrome's own `Math.sin` and `Math.cos` still differ from Node's in the last bit now and then (on 1324 of 20,000 inputs in the check below), which no longer matters.
- **If the page differs:** run `--verify` first. If that passes, something in the simulation computes differently in the two engines. Tell the simulation owner.

### As an integration check

`node scripts/maxx/check.mjs --serve <p>` runs it with the others (about 20 s). Alone:

```
node scripts/maxx/serve.mjs --port <p> -- node scripts/maxx/shot.mjs --port <p> --w 1280 --h 900 --q "scene=viewer&level=sandbox&manual=1&fresh=1&params=%7B%22seed%22%3A49734321%7D" --script scripts/maxx/checks/replay.mjs --out <dir>/end.png
```

It solves the page's level in Node, checks that the page's Math is Chrome's own, plays the run in the page, compares hashes every 300 ticks and saves pictures. 49734321 is the default seed.

### The replay file (`maxx-replay-1`)

```json
{
  "format": "maxx-replay-1",
  "level": "sandbox",
  "file": "src/features/it/maxx/game/levels/sandbox.ts",
  "seed": null,
  "options": { "exit": "goal", "tokens": true, "spotless": false, "allowTight": false },
  "attempts": [
    {
      "session": {...}, "checkpoint": null, "flags": null, "tokens": null, "ticks": 6857,
      "input": "2*60 18 2*30 ...", "marks": [[600, "a1b2c3d4"], ...],
      "end": { "status": "clear", "exit": "goal", "hash": "...", "tick": 6857 }
    }
  ],
  "result": { "ok": true, "hits": 0, ... }
}
```

- **Input.** One mask a tick, run-length coded (`mask*count`): left 1, right 2, up 4, down 8, jump 16, spray 32, half stick 64.
- **Each attempt** is `createWorld(level, { session, checkpoint, flags, tokens, seed })`.

## 11. Worked example: from an empty file to a proven level

**The file.** A file `example.ts` (it can live anywhere) exports a LevelDef as its default (`id: 'dev-example'`, `time: 200`) with two areas:

- **`main`** (70 x 12): the start, a sign, a 3-tile pit, a compact car, a `?` block, two hidden blocks under token 1 at row 2, a grime-walled room with token 2, a pipe down to `room`, a checkpoint, the goal.
- **`room`** (24 x 12): a marker `in`, token 3, a pipe back to `main:pipe`.

The tokens have `props.index` 0, 1 and 2. It also exports:

```ts
export const EXPECT: string[] = [
  'fair goal with hover=off      # nobody needs the hover here',
  'reach goal within 60s',
  'not token2 unless grime=washed # the token behind the grime wall',
  'reach token3                  # down the pipe',
  'reach tokens with all',
]
```

**Step 1: lint.** `node scripts/maxx/level.mjs lint example.ts --strict`

```
LINT dev-example "EXAMPLE" (2 areas)
  warn   dev-example      the game does not open this level by its id: levels/index.ts loads a test room as the default export of a file in levels/dev/ (this one is in ..\example.ts)
  dev-example: 0 errors, 1 warning
```

(A draft outside the levels folder gets that warning until it is moved into `levels/dev/` or, for a real level, saved as `levels/mwNN.ts`. A first draft had only two tokens: `warn dev-example 2 tokens in the level; a level hides exactly three`. Adding the third fixed it.)

**Step 2: reach.** `node scripts/maxx/level.mjs reach example.ts`

```
AREA main  70 x 12, 70 standing places reached
    5                           ?       :        +.....
    9 ..@...A+.....   .+..c...........+PP..++....g::::%..  ...+.......Gxxxxx
SUMMARY
  goal         REACHED   cheapest 635 ticks = 10.6 s (clock 200 s)
  token 1      main 37,2      reached, 375 ticks = 6.3 s
  token 2      main 46,7      needs grime washed
  token 3      room 10,9      reached, 435 ticks = 7.3 s
  pipe         main 33,8      -> room:in: works, comes out at room 3,9
  pipe         room 18,8      -> main:pipe: works, comes out at main 34,8
  ROUTE to the goal: 8 moves, 635 ticks = 10.6 s
      2  main 7,9    run right and jump at the lip (8 ticks held) -> main 17,9  100 ticks  window 14/17
      4  main 32,9   jump right from a stand (full) -> main 37,9  58 ticks  window 8/13
    hardest jump: move 4, jump right from a stand (full) from main 32,9: works on 8 of 13 4 px steps
    too tight (under 4, or pixel-exact): none
    needs the hover: none
```

The `:` marks behind the `g` are the grime room: reachable only with grime washed, as intended.

But token 1 says "reached" even with hidden blocks off. The hidden blocks were meant to be the only way up. The designer checks:

```
node scripts/maxx/level.mjs expect example.ts --not "token1 unless hidden=on"
  FAIL  not token1 unless hidden=on
          token 1 IS reachable with grime kept, gates closed, cars none, hidden off by running jump right after 12 ticks of run (full) from main 34,8
```

The pipe top at 34,8 is a step that reaches it. Move the token, or the pipe, until that claim passes. That is exactly the sort of thing the tools are for.

**Step 3: expect.** `node scripts/maxx/level.mjs expect example.ts`

```
EXPECT dev-example: 5 expectations from EXPECT in ...example.ts
  PASS  fair goal with hover=off
  PASS  reach goal within 60s
  PASS  not token2 unless grime=washed
          token 2: not with grime kept, ...; reachable with grime washed by hop right from a stand (tap) from main 46,9
  PASS  reach token3
  PASS  reach tokens with all
  dev-example: 5 passed, 0 failed
```

**Step 4: solve.** `node scripts/maxx/solve.mjs example.ts --tokens --out example-tokens.replay.json`

```
SOLVED dev-example "EXAMPLE"  (exit goal, tokens)
  time         1312 ticks = 21.9 s played (clock 200 s, 180.0 s left at the end; 11% of the clock)
  hits taken   0
  cars washed  0 of 1
  tokens       1 2 3
  note         planned with grime washed; the solver earns those in play
```

It washed the grime wall itself to get token 2. Run `--spotless` as well, to prove the car can be washed.

**Step 5: keep and watch.**

- Once the level is in its place, solve again with `--out scripts/maxx/replays/<level>-<goal|tokens|spotless|secret>.json`; `node scripts/maxx/tests/solve.mjs` replays them from then on.
- `node scripts/maxx/replay.mjs <file> --verify` gives `OK`.
- Then the browser command (section 10). Look at the contact sheets.

(The outputs in this example are from an earlier version of the tools; the numbers in yours will differ a little.)

## 12. Reading any failure

| Tool | Message | What it means |
| --- | --- | --- |
| lint | `ERROR ... would appear inside the solid` | A marker, checkpoint or start with a wall within Maxx's two tiles of height. He would be stuck. |
| lint | `ERROR the game does not open this level by its id` | The file is not `levels/<id>.ts` with the LevelDef as its default export, or `levels/meta.ts` does not list the id. The map would show COMING SOON. |
| lint | `decor '...' has words, which are never mirrored: its flip does nothing` | Use the `_left` prop it names, or drop the flip. |
| reach | `UNREACHABLE, even with everything open` | No macro from any reachable place gets there. Look at `reach --mode all` for `x` marks around it. |
| reach | `needs grime washed` (or another mode) | Reachable once that is done. Write the matching `not ... unless ...` line if that is the intent. |
| reach | `NEEDS HOVER` | Only the hover gets there. Fine from level 2 on; never on the way to the goal in level 1. |
| reach | `NEEDS LATE HOVER` | Only a hover begun after the top of the jump. A skill nobody is taught: fine for an optional token late in the game, never on the way to the goal. |
| reach | `NEEDS PULSED HOVER` | Should never show: tapping never beats holding. Tell the tools owner. |
| reach | `TOO TIGHT` | The take-off window is under 4 ticks. Make the jump easier, or provide another way. |
| reach | `(PIXEL-EXACT ...)` | Only one run-up to the pixel and one hover start do it. To a person it is luck: widen or narrow the gap by a tile. |
| expect | `X IS reachable ... by <move> from <place>` | Your `not` is false. That move from that place gets there. Block it, or change the claim (`with hover=top` if only a late hover does it and that is acceptable). |
| fuzz | anything other than OK | Read the place. A pixel-exact landing beside a hazard is usually harmless; anything else, tell the tools owner. |
| solve | a STUCK block | Section 9. Start with `why` and `what it tried`. |
| solve | `hits taken` above 0 | The struggle lines say where and from what. A careful player got hit there. |
| replay | `DIFFERS` | Something changed. Re-solve and compare the reports. |

## 13. Honest limits, tool by tool

### reach

- **Terrain only.** Enemies, hazards, cars and wind are left out. "Reachable" says nothing about surviving the way there; solve does. A blower that lengthens or shortens a jump is not counted either way.
- **"Reachable" is proof**: a real replayed input sequence. **"Unreachable"** means none of the macros found a way. That is strong evidence, cross-checked by fuzz and, for how far he jumps, against the measured table (section 4; a brute force of run-ups in quarter pixels, every take-off tick and every hover start found nothing past its last column). It is not a proof.
  - Not tried: a mid-air wiggle (the stick in the air only holds, lets go, or turns back at the top); a flight off a spring or a stomp steered in a way no macro steers; the lip sweep's run-ups and hover starts from other take-offs than the last coyote tick; the sweep at other moments of a lift's cycle than the first.
  - Fuzz has found two kinds of thing the macros miss: pixel-exact landings between hazards, and the hidden-block staircase, which is counted as `hidden=on` on purpose.
  - So leave a tile to spare on any claim that depends on how far he jumps.
- **Flags from bosses and rivals** are not followed: use `--gates open`. Flags from things touched (buttons) are.
- **Car roofs.** Parked at spawns only (`--cars roofs`). A car washed in play and ridden while it drives is not followed. Cars placed with `clean: true` that shuttle on their own are ridden like lifts.
- **Several lifts in one area.** Their phases relative to each other are approximate.
- **Lift waits** are an estimate.
- **Route times** are rest to rest.
- **Brick and button passes.** A route may mix the before and after worlds. For example, standing on a brick it later breaks is not ruled out.

### fuzz

- It is random. It finds what is easy to stumble into. Precise jumps and late hovers it rarely finds.
- It cannot press buttons.
- It counts bumped hidden blocks as staying.

### solve

- **Solved is proof** (a replay). **Stuck** is a careful player failing: strong evidence for a designer to look at, not a proof of impossibility.
- **In fights it knows the boss's next random choice** before the telegraph shows it. Fights are a little easier for it than for a person.
- **Memory.** It tracks things exactly after they leave the screen, which is perfect memory.
- **It cannot plan rides on parked car roofs.**
- **SPOTLESS.** It washes cars that come near, chases ones driving away, and waits by counted spawners. A car that never comes within 12 tiles is missed.
- **Flag setters** more than 10 tiles from their gate, or a flag set by a sequence of actions, are not found. The STUCK block names the flag.
- **Pace.** It plays rest to rest; times are 1.3 to 1.5 times a flowing player's.

### replay (browser)

- Exact as long as the simulation computes the same in every engine: it uses `sim/mathx.ts` for trig and no engine Math function, which `sim.mjs` checks.

## 14. Cost (this machine)

| Run | Time |
| --- | --- |
| reach on the sandbox (402 columns, the fresh player) | about 15 s; each further mode a fraction of that |
| reach on dev-reach | 5 s |
| reach on a 280 x 14 three-storey level with a lift and a spring | about 30 s for the fresh player |
| reach with `--hover top` | about half of that (no late or tapped hovers) |
| solve, a level of that size, after reach | under 3 s |
| solve, boss and rival rooms | 6 to 25 s |
| fuzz | 2 to 3 million ticks in 5 to 12 s, plus the map |
| replay --verify | about a second |
| browser replay | about a minute for 6000 ticks at `--every 240`; the check's 6052 ticks at 300 take about 20 s with the solve |

The late hovers and the lip sweep made the map about twice as dear as a map with the hover held from the top only.

## 15. For tool writers

### lib/reach.mjs

`createReach(sim, contract, level, { hover, late, share, fine, bucket, phases, moverRange })` returns an object with:

- `graph(mode)`: `{ reached, edges, exits, touched, bumped, fatal, broken, flagsSet }`. An edge is `{ from, to, macro, tau, offset, ticks, cost, hover, late, pulse, fine, mode, res }`;
- `routeTo(g, what)`, `costs(g)` (`{ dist, via }` from the start) and `windowOf(g, edge)`: `{ tried, works, unit, needsHover, needsLate, needsPulse, fine }`;
- `needsBricks(edge)` and `needsFlags(edge)`;
- `play(mode, node, macro, tau, offset, variant, share)`, `place`, `base`, `movers` (with `gone`), `spots`;
- `explore(mode, { ticks, seed, cell, maxCells, noHover })` and `replayInput(mode, masks)`;
- `hover`, `macros` (the set it plays), `macroById(id)`.

Options: `hover` 'all' | 'held' | 'top' | 'off' (the old `noHover` and `noPulse` are 'off' and 'held'); `late` the late hover's starts (default `LATE`, 6 12 18 24 ticks after the top); `share: false` plays every late hover from the start (for the test that proves sharing exact); `fine: false` leaves out the lip sweep.

Also exported: `MACROS`, `LATE`, `FINE` (the sweep: hover starts, pixel shifts, the run-up band), `PULSE_VY` (80), `wantsHover(macro, p, fall)`, `FALL.next(fall, p)` (the ticks since the top of the jump; a late hover holds once it passes the macro's number), `HOVER_NAMES`, `copyWorld` (exact, proved tick for tick), `buildWorld(sim, level, worldOpts)` (every area built with `sim.buildArea`), `modeName`, `modeDelta`, `parseMode`.

A macro is `{ id, d, ground, hold, air, hover, coyote?, onlyIfAirborne?, onlyIfLip?, onlyIfFalls?, fine? }`; the header of reach.mjs explains each. The solver drives the same macros through its own segment (`macroSeg` in solver.mjs), which must stay the mirror of `play()`: any change to how a macro presses, steers or hovers goes in both.

### lib/solver.mjs

- `createSolver(sim, contract, level, opts).solve()`;
- `formatResult`, `playReplay`;
- `frameFor`, `encodeInput`, `decodeInput`, `maskActions`, `REPLAY_FORMAT`, `MARK_EVERY`.

(`fdlibmTrig` is gone: the simulation has its own trig now.)

### level.mjs

`openGame`, `findLevels` (with `clashes`), `loadOne` (an entry is `{ level, mod, file, served }`), `lintLevel`, `parseExpectation` (`hover`: null, 'off', 'top', 'held' or 'all'), `checkExpectation(solver, ex)` (`solver(hover)` returns a createReach), `neededModes`, `fuzzLevel`.

### replay.mjs

`playInPage`, `replayQuery`. (`useNodeTrig` is gone.)

### Tests

- `node scripts/maxx/tests/reach.mjs`: 25 tests, about 100 s. Among them: the ledge table (every cell, plain, held from the top, and the most), tapping finds no place a hold does not and no route taps, sharing a late hover's flight is exact.
- `node scripts/maxx/tests/solve.mjs`: 21 tests, about 30 s, plus one for every replay in `scripts/maxx/replays/`.
