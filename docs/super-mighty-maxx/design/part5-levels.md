# Super Mighty Maxx: design bible, part 5 (round 3: the levels)

Everything is built except the levels: the hero, the simulation, every entity kind, the art for
ten themes, the renderer, the play scene, the menus, the world map, the music, two bosses, four
rivals, and tools that prove a level is completable. Round 3 builds the eight levels and Rival
Row. This part is the rulebook for round 3; it wins over parts 1 to 4 where they disagree.

## Read first, in this order

1. `maxx-design.md` (part 1): the game, its feel, its rules. Section 0 binds you.
2. `docs/super-mighty-maxx/NOTES.md`: how everything really
   works now, every entity kind with its legend props, size and how to place it, the tile rules,
   the measured movement numbers. Where it disagrees with parts 1 to 4, it is right.
3. `level-tools-manual.md` (same folder as this file): lint, reach, expect, fuzz, solve,
   replay. How you prove a level and read a failure.
4. `maxx-design-3.md` (part 3): the level design rules and the brief for each level.
5. This file.
6. The worked examples: `src/features/it/maxx/game/levels/sandbox.ts` and the rooms in
   `src/features/it/maxx/game/levels/dev/` (each slice's dev room shows its kinds placed well; the boss and
   rival rooms are the arenas you copy).

## Rules for round 3

- **Your files only**: your level file `src/features/it/maxx/game/levels/<id>.ts` (and any helper module
  `src/features/it/maxx/game/levels/<id>/*.ts` if you want to build rows from pieces), your replays
  `scripts/maxx/replays/<id>-*.json`, and your scratch folder. Everything else is frozen. A
  kind, art or rule you wish existed goes in your report under `wanted`; do not edit another
  file to get it.
- No git commands that change anything. No npm install, no npm run build, no npx tsc -b.
- Dev servers only through `node scripts/maxx/serve.mjs --port <your port> -- <command>`, only
  on your port. Leave nothing running.
- Your file must typecheck (`npx tsc -p scripts/maxx/tsconfig.json`) and lint
  (`npx eslint src/features/it/maxx/game/levels/<id>.ts --quiet`).
- Player-visible text (signs): capitals, short, our own words, no em dashes; prompts like
  `{jump}` `{spray}` `{up}` `{down}` show the right button for the controller or keyboard.

## The level file

```ts
import type { LevelDef } from '../contract'
import { LEVEL_META } from './meta'
const meta = LEVEL_META.find((m) => m.id === 'mw01')!
export const EXPECT: string[] = [ /* the claims expect checks, see the manual */ ]
const level: LevelDef = { id: meta.id, site: meta.site, name: meta.name, time: meta.time, music: meta.music, areas: [ ... ] }
export default level
```

`levels/index.ts` finds `mw01.ts` .. `mw08.ts` and `rivals.ts` by themselves; you do not edit it.
Areas: the first is where the level starts (its '@'). Standard areas are 12 rows with the floor
in the bottom two rows; taller ones scroll. Bonus rooms use theme `bonus` and music `bonus`.
Rival Row uses theme `backlot` and music `rival`. Use the level's theme from `LEVEL_META`
except where the brief says (MW03 starts on the lot; MW05 surfaces at the end).

## What "done" means for a level (all of it, proven by the tools and seen in pictures)

1. `level.mjs lint <id>`: 0 errors, and every warning read and either fixed or explained in
   your report.
2. `level.mjs expect <id>`: every claim in `EXPECT` passes. Your EXPECT states at least: the
   goal is reachable and fair; each of the three tokens is reachable (and in which mode); each
   secret is NOT reachable the ordinary way (for MW03 the roof, under every mode except the one
   that opens it); the level is completable without the hover held or tapped where the brief
   says the hover is optional.
3. `level.mjs fuzz <id>`: no false "unreachable", and no place reached that you claimed was not.
4. `solve.mjs <id>`, `--tokens`, `--spotless`, and `--exit secret` where the level has one, all
   succeed. Save each replay as `scripts/maxx/replays/<id>-goal.json`, `-tokens.json`,
   `-spotless.json`, `-secret.json`, and check `replay.mjs <file> --verify` passes.
   (The solver cannot ride parked car roofs; a token whose only way is a car roof is proven by
   reach `--cars roofs` and a fuzz find instead, and you say so.)
5. Difficulty by numbers, from reach's route report and the solver's summary:

| level | shortest take-off window on the main route | hits the solver takes | pulsed hover on the main route | solver time vs the clock |
| --- | --- | --- | --- | --- |
| mw01 | 10 ticks or more | 0 | never | under 40% |
| mw02 | 9 or more | 0 | never | under 45% |
| mw03 | 8 or more | 0 | never | under 50% |
| mw04 | 7 or more | 0 or 1 | never | under 55% |
| mw05 | 6 or more | 0 or 1 | only if the brief asks | under 55% |
| mw06 | 6 or more | 0 to 2 | allowed | under 60% |
| mw07 | 5 or more | 0 to 2 | allowed | under 60% |
| mw08 | 4 or more | 0 to 3 | allowed | under 65% |
| rivals | 6 or more | 0 to 3 | allowed | under 50% |

   Tokens and secrets may be harder than the main route (that is their point), never tighter
   than 4 ticks.
6. Pictures: the overview of every area (`scripts/maxx/overview.mjs`), a replay contact sheet
   of the goal run in the play scene (`replay.mjs ... --scene play`), and close-ups of every
   beat you designed. You looked at all of them and fixed what was ugly, confusing, bare or
   cluttered. A level is a place: dress it with decor so it reads as that Mighty Wash site, and
   keep the play readable (decor never looks like a platform or an enemy).

## Craft

- Part 3's rules: a safe opening that teaches, three or four beats that each introduce one idea
  and twist it, a checkpoint just past the middle (two in mw08), a climax that combines the
  level's ideas, the exit. Rest spots between beats. Coins lead the eye.
- Cars are the heart of the game: every level has them (Rival Row excepted), and the first time
  a car type appears it has flat room and time to be washed. Count `stats.carsTotal` and make
  SPOTLESS a fair goal in every level.
- Three gold tokens: one in plain sight but awkward, one hidden, one that takes skill. Give each
  token `props.index` 0, 1, 2 in the order a player would usually find them.
- Generous secrets: hidden blocks, pipes to bonus rooms, grime walls, ways above the ceiling.
- Use what exists, and use each kind as its slice's notes say (NOTES.md). Do not stack hazards
  into an unreadable mess; a hazard that kills from off screen is a bug.
- Never design at the measured limits on the main route (see the take-off windows above).
- Difficulty rises from level to level, never in a spike inside a level.

## The secret (the client asked for it specifically)

Rival Row is a hidden area like the classic secret worlds: found by curiosity, never by accident.

What the tools cannot see, so you must design around it near every secret and every "cannot
reach" claim: reach and the solver ignore critters and wind. A tailwind blower stretches a jump
by five tiles or more, and a blob walking off a ledge or riding a lift can be stomped in mid-air
for a fresh bounce. Keep blowers and blobs away from any place that guards a secret, and say in
your report that you did. NOTES.md section 5 has the full table of what each thing adds.
- **MW03** (part 3): late in the tunnel, a ceiling vent plugged with grime blocks, a tire-stack
  spring that seems to have no purpose under it, a short trail of coins pointing up. Washing the
  grime with an upward spray and bouncing up puts Maxx on the tunnel roof. He runs the roof to
  the right, past the normal exit, to a steel door marked EMPLOYEES ONLY (`secretExit`). The roof
  must be unreachable any other way (prove it), and the normal route must not need it.
- **MW06**: a wall of grime blocks hides a pipe to a token room that also holds an EMPLOYEES
  ONLY door (`secretExit`), the second way in for players who missed the roof.
- Either secret exit clears the level and opens the hidden road on the map (the play scene sets
  `secretFound` for these two levels only).

## Rival Row (`rivals.ts`, level id `rivals`)

The alley behind the wash at night, theme `backlot`, music `rival`, a long clock (600 s). Four
duels in order, then a trophy room. The play scene starts a fresh visit with
`flags: { rivalsBeaten: <save> }`, so a returning player resumes at the next rival.
- An entry alley with a short walk and a sign or poster that sets the mood (rival posters,
  dumpsters, chain-link, neon). Then four arenas, each built exactly as its rival's slice
  describes (see the rivals sections of NOTES.md, and `levels/dev/rivals-a.ts`,
  `levels/dev/rivals-b.ts`), joined so the player meets them in order: Bucket Bill (1),
  Sir Streaks (2), Slick Ollie (3), Nimbus Nick (4). The way from one arena to the next is a
  door or gate locked on `rivalsBeaten` (min 1, 2, 3, 4), so a returning player whose flag is 2
  walks through the first two arenas (their rivals remove themselves) to Ollie.
- A checkpoint before each arena.
- A small hint before Nimbus Nick that he must be sprayed from below with {up} (a sign or a
  poster), because a player who never aims up cannot finish him.
- After Nick: a trophy room (theme `bonus` or a dressed backlot room) with coins, a 1UP and the
  goal. Beating Nick plays `champion`; the play scene sets `champion` in the save.
- No cars here, and no tokens are required to be anywhere special, but the level still has three
  tokens (lint requires it): put them in the alley and the trophy room as rewards.

## What to hand back

Your final message is a report (the task gives its exact shape): what the level is (beats, its
secrets, its tokens and where they are), the numbers (lint, expect, fuzz, the four solves with
their times, hits and struggles, the shortest take-off windows), the pictures you looked at, what
is still weak, and anything you wanted that did not exist.
