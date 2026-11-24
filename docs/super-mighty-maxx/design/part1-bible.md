# Super Mighty Maxx: design bible

A side-scrolling 8-bit style platformer built into the Operator web app (React 19 + Vite + TS),
under the IT menu at `/app/super-mighty-maxx`. The hero is Mighty Maxx, the mascot of Mighty Wash,
a West Texas / New Mexico car wash chain: a scrub brush (wooden handle body, bristles on top and
down his back) in a red mask, red cape, red gloves and boots, blue sleeves and leggings, with an
"MW" shield on his chest (red M over blue W). He carries a prep gun (the pressure-washer wand an
attendant uses to pre-soak cars at a tunnel entrance) and washes dirty cars that drive at him.
A washed car turns shiny and happy. If a dirty car reaches Maxx he gets GRIMED.

It will mostly be played with an Xbox controller on a desktop browser (Chrome/Edge), also keyboard,
and it should not be dead on a phone (simple touch buttons).

**While the game was being built its code lived in a staging folder `maxx-wip/` at the repo root**
(outside `src/`, so half-built files never broke anyone else's build). When it was finished the
folder moved as-is to `src/features/it/maxx/`. So:

- Inside the game use **relative imports only**. The `@/` alias is only for importing the
  surrounding app (e.g. `@/lib/auth` from the React page).
- Node scripts in `scripts/maxx/` must take every game path from `scripts/maxx/paths.mjs`
  (`GAME_DIR`, `ASSETS_DIR`, `GAME_URL`), never hard-code the folder.
- Wherever this document says `game/...` it means `src/features/it/maxx/game/...`.

Read these two files first, they are the contract:

- `src/features/it/maxx/game/contract.ts` (screen, input, audio, sprites, save, scenes, levels, tile legend)
- `src/features/it/maxx/game/sim/types.ts` (World, Player, Entity, events)

## 0. Rules for everyone working on this

- **Stay inside your own files.** Each task lists the files it owns. Do not edit files owned by
  someone else, and never edit `game/contract.ts`. If the contract is missing something, define it
  in your own module and say so in your report ("contract additions wanted").
- **Do not run git commands that change anything** (no commit, add, stash, checkout, reset, restore,
  clean, pull, push). Other people are working in this checkout right now. `git status`/`git diff` are fine.
- **No new npm dependencies.** Everything is hand-rolled: Canvas 2D, Web Audio, Gamepad API.
  `pngjs` (dev dependency) is there for Node-side PNG writing, `puppeteer-core` + installed Chrome
  (`C:/Program Files/Google/Chrome/Application/chrome.exe`) for headless screenshots.
- **TypeScript rules** (tsconfig.app.json): `erasableSyntaxOnly` (no `enum`, no `namespace`, no
  constructor parameter properties), `verbatimModuleSyntax` (use `import type` for types),
  `noUnusedLocals`, `noUnusedParameters`. Import with the `@/` alias or relative paths, no file
  extensions.
- **Check your work with:**
  - `npx tsc -p scripts/maxx/tsconfig.json` (typechecks only the game, about 4 s)
  - `npx eslint src/features/it/maxx --quiet` (or just your own files)
  Your own files must be clean before you finish. Errors in files you do not own are someone
  else's work in progress: leave them, mention them in your report. Do NOT run `npm run build`
  or `npx tsc -b` (slow, and they cover the whole app).
- **The simulation (`game/sim/**`, `game/levels/**`) must stay DOM-free**: no `window`, `document`,
  canvas, Audio, `Math.random`, `Date.now`, `performance.now`. It is run in Node.
- **House rules of this repo:** no em dashes in any text a player sees; comments explain why, not
  what, and are sparse; keep the bundle lean.
- **Originality.** This is an original game in the platformer genre. Do not copy any existing
  game's characters, sprites, tiles, level layouts, fonts, sound effects, melodies or names
  (nothing from Nintendo/Mario or anyone else). Genre mechanics are fine (run, jump, blocks you
  bump, pipes you enter, an overworld map with level nodes). Our look is our own: prize blocks are
  blue wash crates with a white water drop (not yellow question-mark blocks), bricks are cinder
  blocks, pipes are grey-blue drain pipes, coins are silver-blue wash tokens stamped MW, the level
  ends at a wash exit arch with a traffic light. Rival mascots are invented, and must not resemble
  any real company's mascot or name.
- Dev servers: if you start Vite, use the port given in your task with `--strictPort`, and stop it
  before you finish.
- Temp files go in your task's scratch folder (given in the task), not in the repo.

## 1. Feel

Bright, funny, generous. NES-era presentation: flat colors, dark outlines, chunky readable
shapes, chiptune music (2 pulse + triangle + noise), big silly "GRIMED!" when you lose. It
should feel tight to control: instant response, variable jump height, coyote time, jump
buffering. Aimed at car wash staff on a break: easy to start, hard at the end.

Screen: 640x360 logical pixels, 32 px tiles (20 x 11.25 tiles on screen). Maxx is about two tiles
tall. Art is 1:1 pixel art at that resolution. No anti-aliasing, no gradients, no blur, no alpha
blending except whole-sprite fades.

## 2. Controls

| Action | Xbox pad | Keyboard |
| --- | --- | --- |
| Move | left stick or D-pad | arrows or A/D |
| Aim up / enter door | up | up or W |
| Enter pipe / hover aim | down | down or S |
| Jump (hold = higher) | A | Z, Space or K |
| Spray | X, B, RB or RT | X, J or Shift |
| Pause | Menu (Start) | Enter, Esc or P |
| Confirm / back in menus | A or Start / B | Enter, Z, Space / Esc, Backspace |
| Fullscreen | (button on the page) | F |
| Mute | | M |

`select` = View/Back button, Tab. Menus use `repeat` for held directions.

## 3. Maxx

Collision box 22 x 52. His sprite is about 62 px tall (the supplied 128 px run frames at half
size); every frame carries its own anchor at the middle of his feet. Starting numbers (pixels and seconds; the simulation owner tunes them and reports the
measured jump height and length):

- Run: top speed 215, 150 while spraying on the ground. Ground accel 1100, release decel 1400,
  turn-around (skid) decel 2400, air accel 800. The analog stick scales top speed (min 40%).
- Jump: launch speed 635 (+40 at full run). Gravity 1500 while rising with jump held, 5000 while
  rising with jump released (short hops), 2300 falling, fall speed cap 760. Coyote time 6 ticks,
  jump buffer 7 ticks. Measured: tap 1.5 tiles high, full jump 4.2 tiles high (4.75 running),
  full running jump 5.5 tiles long. Level designers may rely on: walls of 3 and 4 tiles are
  climbable from a standing start, 5 is a barrier; pits of 4 and 5 tiles are roomy, 6 is the
  limit, 7 cannot be jumped without the hover. (Measured numbers and the ledge table: `NOTES.md`
  section 5.)
- Hover: in the air, hold down + spray: the gun fires straight down, his fall speed is held to
  40 px/s and his drift to 150 px/s. It lasts 42 ticks from the first tick it holds him up,
  running down every tick of that airtime whether held or not, so tapping it never beats holding
  it. It comes back on landing, a spring, a stomp bounce and a warp. Held from the top of a
  running jump: 8.6 tiles long, pits of 9 at most; held from the best tick: 9.4 tiles, pits of 10
  at most, 11 never. Droplets fired down still wash things.
- Floors: slick 'I' accel/decel x0.35; oily 'O' x0.12; mud 'M' top speed x0.5 and launch speed
  x0.8 (a coyote jump off its edge too): from mud a full jump is 2.7 tiles high, a 3-tile wall
  is a barrier and a 5-tile pit the limit; conveyors '<' '>' carry whatever stands on them at
  60 px/s. A spring (power 1) throws him 8 tiles up.
- Head bumps: jumping up into 'B','C','?','!','W','L','H','h' triggers the block (see contract).
  Prize items pop out of the top of the block.
- Shine: 3 pips. A hit costs one pip, knocks him back (state 'hurt' 24 ticks), 90 ticks of
  blinking invulnerability, and takes the turbo nozzle away. At 0 pips he is GRIMED: world.status
  = 'grimed', banner 'GRIMED!', jingle 'grimed'. Sludge '~', falling out of the bottom of the
  area, and the clock running out grime him at once whatever his shine.
- Lives: 3 to start. 100 coins = 1 life. Out of lives = game over (progress on the map is kept).
- Mighty Wax (from 'W' blocks): 600 ticks invincible; touching a dirty car washes it instantly.
- Turbo nozzle (from '!' blocks at full shine): droplets fly 35% further, hit twice as hard,
  fire 1.5x as often. Lost on a hit.

### The prep gun

Hold spray. Every 2 ticks a droplet leaves the nozzle (contract `MUZZLE`, mirrored when facing
left): speed 540 px/s along the aim with a few degrees of jitter, gravity 500, life 20 ticks
(about 5 tiles of reach), power 1. Aim is forward by default, 45 degrees up-forward while up is
held, straight down in the air while down is held (hover). At most 40 droplets alive.
A droplet dies with a little splash on a solid tile. It wears down grime blocks 'g' (6 hits each).
An entity with `onSpray` can take it.

## 4. Cars (the heart of the game)

Cars drive at Maxx (usually leftward). Each has dirt (`hp`). Spray takes dirt off. The body shows
three dirt stages and a grumpy face (headlight eyes, grille mouth) while dirty. At 0 dirt it is
WASHED: flash, sparkles, happy face, bright paint, a honk, points, and from then on it is
harmless, drives off a little faster, and its roof is a platform Maxx can ride (`solid: 'top'`).
Touching a dirty car anywhere (roof included) costs a pip.

| variant | size (w x h) | speed | dirt | notes |
| --- | --- | --- | --- | --- |
| compact | 72 x 40 | 40 | 10 | dusty hatchback, the first car you meet |
| sedan | 88 x 40 | 55 | 18 | muddy |
| suv | 92 x 52 | 60 | 26 | bug-splattered |
| pickup | 100 x 52 | 50 | 36 | flings mud clods ahead in an arc every 130 ticks when Maxx is within 300 px |
| sports | 92 x 34 | 150 | 12 | fast; revs ('rev' sfx) a moment before it appears |
| van | 100 x 60 | 45 | 44 | salt-crusted, slow, tough |
| monster | 120 x 92 | 35 | 60 | monster truck, too tall to jump |

Cars obey gravity, turn around at walls, and a bonus or washed car is removed once far behind the
camera (a counted dirty car waits where it was left). Washing cars quickly in a row builds a
chain: 200, 400, 800, then 1000 each (chain resets after 180 ticks).
A level counts its cars; washing all of them is SPOTLESS (bonus 3000 and a mark on the map).
`spawner` entities feed cars into tunnel sections on a timer.

## 5. Other things in the world (entity kinds)

Hazards and critters: `blob` (small walking grime blob; stomp it or spray it, 3 hits),
`bird` (grackle; flies a wave and drops splats; spray shoos it), `bugs` (a drifting swarm; spray
breaks it up, 6 hits), `tumbleweed` (bounces along the ground; spray pushes it back), `drip`
(ceiling drip on a timer), `icicle` (falls when Maxx walks under), `brush` (spinning wash brush
moving on a rail; hurts), `jet` (hot wax jet on a timer from the ceiling or floor), `blower`
(dryer: a wind zone that pushes), `clod` (mud projectile), `splat` (bird dropping projectile).

Helpful things: `coin`, `token` (3 gold tokens hidden per level), `bubble` (heals a pip),
`turbo`, `wax`, `oneup`, `checkpoint` (wash station flag), `spring` (tire stack), `lift` (moving
platform), `pipe` + `marker` (warps between areas), `door`, `sign` (tutorial text), `goal`
(exit arch), `secretExit`.

Bosses: `mudslinger` (end of level 4), `mudzilla` (end of level 8).
Rivals (the secret): four invented rival mascots fought one after another in Rival Row.

## 6. The eight levels (each named after a Mighty Wash site number)

1. MW01 Grand Opening: sunny lot. Teaches run, jump, spray, blocks. Compacts, a few blobs.
2. MW02 Vacuum Alley: vacuum bays, late afternoon. Sedans, birds, springs, a pipe to a token room.
3. MW03 Tunnel Vision: first wash tunnel, conveyor floors against you, brushes, a car spawner.
   The secret: a way onto the tunnel roof, then over the exit to a hidden door (Rival Row).
4. MW04 Mud Season: rain, mud floors, pickups flinging clods, sludge pits. Mini-boss Mudslinger.
5. MW05 Lube Pit: underground lube shop. Oily floors, drips, lifts, darkness-flavoured art.
6. MW06 Bug Season Boulevard: sunset highway. Sports cars, SUVs, bug swarms, riding clean car
   roofs across gaps. A second hidden way to Rival Row behind grime blocks.
7. MW07 Salt Storm: snow and ice floors, vans, icicles, wind.
8. MW08 The Mega Tunnel: night, long, everything at once, fast conveyors, blowers, monster
   trucks, then the final boss MUDZILLA, a giant monster truck.

## 7. Flow

Title screen (logo, Maxx running, START / OPTIONS / HOW TO PLAY) -> world map (a West Texas
road map: highway between eight car wash sites, wind turbines, pumpjacks, mesquite, a hidden
side road to Rival Row) -> level card -> play -> tally -> map. Pause menu in play. Game over ->
map. After level 8: ending.

## 8. Sound

NES-era chiptune made live with Web Audio: two pulse voices (duty 12.5/25/50%), one triangle
bass, one noise drum voice. All melodies are original. See `SfxId`, `MusicId`, `JingleId` in the
contract for the full list.

## 9. Art

Master palette (use these; add a color only when really needed and say so):

- outline: `#1e0d06` (warm near-black, Maxx's own outline), navy `#1b2253`
- red: `#3c0507 #7f0207 #ae0512 #d10713 #f51924 #ff6b6b`
- wood/tan: `#311107 #7a4a1a #b96e23 #d57a1d #f09c3f #f1ae51 #f5c56e #fbdb8a #fff1c4`
- brand blue: `#0b2a6b #1456b8 #109ff9 #5cc8ff #b9ecff`
- water/teal: `#0e7c86 #25c2d0 #a8f0f0`
- green: `#0f3b1e #1f7a34 #49b23c #9be04f`
- grey: `#16161d #2e3038 #4b4f5c #767b8a #a9afbd #d6dae3 #f7f4f8`
- mud: `#2b1a0e #4a2f17 #6b4522 #8a5f33 #b08850`
- yellow: `#b8860b #f5c518 #ffe866`
- purple/night: `#1a1033 #2e1f5e #5b3fa0 #9a7fe0`
- orange: `#c2410c #f97316 #fdba74`
- pink: `#e85aa0`
- ice: `#dff3ff #a8d8f0 #6fb3dd`

Style: 1 px dark outline on characters and objects (warm near-black, not pure black), light from
the top-left, two or three flat shades per material, no dithering noise, strong silhouettes.
Mighty Wash brand: red `#d10713`, blue `#109ff9`, navy outline, white.

Art is generated by Node scripts in `scripts/maxx/` that write PNG atlases into
`game/assets/` (`ASSETS_DIR` from `scripts/maxx/paths.mjs`) together with a `<name>.atlas.ts`
frame map (contract `AtlasDef`). The scripts are the source of truth: never hand-edit a
generated file. `Sprites.draw(g, name, x, y)` puts the frame's anchor (ax, ay) at (x, y);
`flipX` mirrors the frame around its anchor.
