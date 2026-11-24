# Super Mighty Maxx: design bible, part 4 (round 2: how the content gets built)

The foundation is finished and tested: simulation core, shell with Xbox controller input,
the hero's art, the chip synth, the pixel font and UI kit. Round 2 builds everything on top
of it, many people at once. This part is the rulebook for round 2 and it wins over parts 1
and 2 wherever they disagree.

## Read first, in this order

1. `maxx-design.md` (part 1, same folder as this file). Its section 0 rules are binding.
2. `docs/super-mighty-maxx/NOTES.md`: how the foundation
   really works (tools, conventions, measured jump numbers, traps). Where NOTES.md and
   part 1 disagree on a number, NOTES.md is right.
3. `src/features/it/maxx/game/contract.ts` and `src/features/it/maxx/game/sim/types.ts`.
4. This file, then the section of `maxx-design-2.md` (part 2) for your slice.
5. If you write simulation code: the header of `src/features/it/maxx/game/sim/api.ts` (the guide to
   writing an entity kind, with recipes) and one existing file in `src/features/it/maxx/game/sim/entities/`.
6. If you draw: `scripts/maxx/pix.mjs` and `scripts/maxx/palette.mjs` (the toolkit the hero
   was drawn with), `scripts/maxx/art-maxx.mjs` as the worked example, and look at the hero
   himself: `src/features/it/maxx/game/assets/maxx.png`. Everything must sit beside him and look like
   the same game.

## What changed since parts 1 and 2 were written

- The contract's `GameCtx` now has `autoPause`, `fps`, `irisAt(x, y)`, `muted`, `setMuted`,
  `applySettings()`. `InputApi.glyph` takes `'move'` too. `AudioApi.preload(ids)` exists.
  `TextOpts` has `lineHeight` and `spacing`. Scenes need no casts.
- A scene is entered with `game.go(scene, params, transition)`. The level to play is
  `params.level` (a level id), not `levelId`.
- There is a dev scene `viewer`: any level played with the real world renderer and nothing
  on top. `dev/maxx.html?scene=viewer&level=<id>&manual=1&params={"col":40}`. Use it to see
  your work in the game.
- Test rooms: put a `LevelDef` in `src/features/it/maxx/game/levels/dev/<name>.ts` as the default export,
  with an id starting `dev-`. It is found by glob; `levelById('dev-...')` and the viewer open
  it. Dev levels are left out of the production bundle. Do not edit `levels/sandbox.ts`.
- Entity drawing is a registry (below). The world renderer in `render/world.ts` is a stand-in
  at the start of the round (flat colours, boxes for kinds with no renderer) and is being
  replaced during it; `render/registry.ts` does not change.
- Sign text is drawn in the world by the sign's own renderer (the objects slice), not by the
  HUD. Floating score popups are drawn by the world renderer. Banners, the versus card and
  the boss bar belong to the play scene's HUD.

## Rules for round 2

- **Stay inside the files your task lists.** Everything else is frozen for you, including
  `game/contract.ts`, `game/sim/*.ts` (the core: api, world, player, physics, tuning, types),
  `game/engine/**`, `game/scenes/index.ts`, `game/levels/index.ts`, `game/levels/sandbox.ts`,
  `game/render/registry.ts`, `scripts/maxx/pix.mjs`, `scripts/maxx/palette.mjs`,
  `scripts/maxx/sim.mjs`, `scripts/maxx/lib/**`, `NOTES.md`. If you need something changed
  in a frozen file, work around it inside your own files and put the request in your report
  under `wanted`. A helper you need for drawing goes in your own script.
- Other people are editing other files in this checkout while you work. A typecheck or lint
  error in a file you do not own is their work in progress: leave it, carry on, mention it.
  Your own files must be clean when you finish: `npx tsc -p scripts/maxx/tsconfig.json` and
  `npx eslint <your files> --quiet`.
- No git commands that change anything. No `npm install`. No `npm run build`, no `npx tsc -b`.
- **Dev server: never `npx vite`.** Use the wrapper, which gives your port its own cache and
  stops the server when your command ends:
  `node scripts/maxx/serve.mjs --port <your port> -- node scripts/maxx/shot.mjs --port <your port> --q "scene=viewer&level=dev-x&manual=1&fresh=1" --out <scratch>/x.png [--script steps.mjs]`
  Use only the port your task gives you. Never leave a server or a Chrome running.
  `shot.mjs` is documented in its header; `window.__maxx` (NOTES.md) drives the game:
  `setManual`, `step(n)`, `hold('right spray')`, `release()`, `world()`.
- **Look at what you make.** Screenshots and contact sheets go in your scratch folder; open
  them with the Read tool, at 1x and enlarged, and keep improving until you would be proud
  to ship it. A thing nobody looked at is not done.
- Simulation tests go in `scripts/maxx/tests/<your slice>.mjs`, written with
  `scripts/maxx/lib/testkit.mjs` (see its header and `tests/kit.mjs`). Run yours with
  `node scripts/maxx/tests/<slice>.mjs`. `node scripts/maxx/sim.mjs` is the core suite: it
  also runs every registered kind through fuzzing and a determinism check in the sandbox's
  critter corner, so a kind that throws or uses `Math.random` fails it. Keep it passing for
  your kinds.
- Player-visible text: capitals (the font has no lower case), short, no em dashes.
- Originality (part 1, section 0) applies to everything: looks, names, tunes, layouts.

## The render registry (`src/features/it/maxx/game/render/registry.ts`)

```ts
registerRenderer(kind, (g, e, rc) => { ... })      // or 'kind:variant' for one variant
```

Put yours in `src/features/it/maxx/game/render/entities/<slice>.ts` (loaded by glob). `rc` (RenderCtx)
gives `sprites`, `world`, `camX`, `camY`, `tick` (a cosmetic clock that keeps running while
the world is frozen), `debug`, `draw(frame, worldX, worldY, opts)`, `sx(worldX)`,
`sy(worldY)` and `fx(id, worldX, worldY, n, dir)` for cosmetic particles. A renderer reads
the entity (`state`, `stateT`, `hp`, `maxHp`, `facing`, `vars`, `props`) and never writes to
it or the world. Anchor sprites at the entity's feet: `(e.x + e.w / 2, e.y + e.h)`.
Draw order is `Entity.z`: below 0 behind the tiles and Maxx, 0 behind Maxx, above 0 in front.
No per-frame allocation (no new arrays, objects, canvases or strings built every frame in a
hot path); the game must hold 60 frames a second on an office PC.

Whatever a renderer needs to know must be in the entity's data, so the simulation author
and the artist of a slice (the same person) decide the states together and write them in
the header of the sim file.

## Art for a slice

One generator `scripts/maxx/art-<atlas>.mjs` writes `game/assets/<atlas>.png` and
`<atlas>.atlas.ts` (paths from `scripts/maxx/paths.mjs`). Never hand-edit the outputs. Give
the script a `--review <dir>` mode that writes contact sheets (each animation as a strip, at
1x and 3x or 4x, on the backgrounds it will be seen against, plain and flipped). Animations
go in `anims`; frame timing and sizes other people need go in `meta`. Stay in the master
palette (part 1, section 9); add a colour only when really needed and say so.

Style, from the hero: a 1 px warm near-black outline (`#1e0d06`) round characters and
objects, two or three flat shades per material, light from the top left, bold readable
silhouettes, no dithering noise, no gradients, no anti-aliasing. Things that hurt must read
as dangerous at a glance and things that help as friendly. Give everything alive a face.

## Sound

Use the `SfxId`s in the contract (42 exist; the list is closed for this round). Emit them
from the simulation with `sfx(w, id)` or `sfxEvery(w, id, gap)`.

## Scene flow (for the scene slices)

- `title` -> `map` (CONTINUE or NEW GAME) -> `play` with `{ level }` -> back to `map` with
  `{ from: <level id>, exit: 'goal' | 'secret' | 'quit' }`, or to `gameover`, or after
  clearing `mw08` to `ending`. `gameover` -> `map` (fresh lives; progress kept) or `title`.
- Save rules (the play scene writes them): on a clear, `record(level)`: `cleared`,
  `bestScore`, `bestTicks`, `tokens` (OR-ed in), `spotless`; `unlocked` rises to the next
  level (1..8); `hiScore`; a secret exit also sets `secretFound` and counts as a clear;
  clearing `mw08` sets `finished`.
- Rival Row is level id `rivals`. A fresh visit starts it with
  `flags: { rivalsBeaten: save.data.rivalsBeaten }`; while it is played the scene copies
  `world.flags.rivalsBeaten` up into `save.data.rivalsBeaten` whenever it rises (commit at
  once, so a beaten rival stays beaten), and sets `champion` at 4.
- Every other fresh visit passes no flags. A retry after a grime passes
  `checkpoint: world.checkpoint, flags: world.flags, tokens: world.stats.tokens`.
- The simulation never takes a life and never adds the SPOTLESS bonus: the play scene does.
- `LEVELS` in `levels/index.ts` is still empty: the eight levels are built in round 3. Until
  then play and map must work with `sandbox` and any `dev-*` level, and must not crash on a
  level id that has no LevelDef yet (the map says COMING SOON and plays `locked`).
- Options and How To Play are shared between the title and the pause menu:
  `scenes/shared/options.ts` and `scenes/shared/howto.ts` (the title slice owns both; their
  exported interface is fixed by the stubs already there).

## Protocols between slices

- **Gates and locked doors** (objects slice): a `gate` kind, a solid barrier that opens for
  good once `getFlag(w, props.flag) >= props.min` (default min 1); and the `door` kind takes
  the same two props and stays locked (and shows it) until then. Bosses and rivals open the
  way on by setting a flag, never by touching another entity.
- **Bosses**: kind `mudslinger` sets flag `mudslinger` to 1 when washed. Kind `mudzilla`
  completes the level itself (`completeLevel(w, 'goal')`) after its celebration.
- **Rivals**: kinds `bill`, `streaks`, `ollie`, `nick`, in that order 1 to 4. When one is
  beaten it raises the flag `rivalsBeaten` to its number (never lowers it). In `init`, a
  rival whose number is already covered by the flag removes itself, so a returning player
  walks straight through. Each fight: `versus(w, NAME, TAGLINE)`, `setBoss` every tick,
  `lockCamera` to its one-screen arena, and on the fall `jingle(w, 'rivalDown')`,
  `clearBoss`, `unlockCamera`. The last one uses jingle `champion` instead.
- Every boss and rival follows the same honest loop: a clear telegraph, an attack that can
  be dodged every time by a player who read the telegraph, then a window where spray
  counts. It can be beaten without taking a hit, and a test proves that with a scripted
  player.
- **Projectiles** are entity kinds of their own with `offscreen: 'remove'`. Name them with
  your slice's prefix.

## What to hand back

Your final message is a report for the lead engineer, as plain data (the task says the
exact shape): what exists, the files, what other people need to know (for level designers:
every kind you made, its legend props, its size, how dangerous it is, how to place it well,
what it must not be combined with), how you verified it and what you saw, what is still weak,
and what you want changed in files you do not own.
