# Super Mighty Maxx: design bible, part 2 (content)

Read part 1 first (`maxx-design.md`, same folder; its section 0 rules are binding), then
`docs/super-mighty-maxx/NOTES.md` (how the foundation works: tools, debug API, conventions), then
`src/features/it/maxx/game/contract.ts` and `src/features/it/maxx/game/sim/types.ts`.

This part specifies everything built on top of the foundation. Each task owns a vertical slice:
its simulation behaviour, its art (a generator script + atlas) and its renderer, so nobody
waits on anybody. Where two slices meet, the meeting point is written down here. Follow the
names in this document exactly.

## A. Names that slices share

### A1. Atlases and who makes them

| atlas | made by | contents |
| --- | --- | --- |
| `maxx` | (done) | the hero |
| `tiles` | world art | every tile, per theme, plus decor props |
| `bg_<theme>` | world art | parallax strips for one theme |
| `fx` | objects | particle frames |
| `items` | objects | coins, tokens, power-ups, checkpoint, goal, doors, springs, lifts, signs |
| `cars` | cars | all car art |
| `critters` | hazards | blob, bird, bugs, tumbleweed, drips, icicles, brushes, jets, blowers |
| `bosses` | bosses | Mudslinger, Mudzilla |
| `rivals` | rivals | the four rival mascots and their projectiles |
| `hud` | play scene | HUD icons and frames |
| `title` | title scenes | the logo and title art |
| `map` | world map | map tiles, sites, props |

One generator script per atlas: `scripts/maxx/art-<atlas>.mjs`, built with `scripts/maxx/pix.mjs`
and `scripts/maxx/palette.mjs`. Every artist: view your output (contact sheets in your scratch
folder, Read tool) and iterate until it looks good at 1x and 3x. Match the hero's style: warm
near-black 1 px outline, flat shades, light from the top-left, bold shapes.

### A2. Tile frames (atlas `tiles`)

The renderer looks up `tiles/<theme>_<key>` and falls back to `tiles/any_<key>`, then to a flat
colour. All tile frames are 32x32 unless noted. Keys:

| tile | keys |
| --- | --- |
| `#` ground | `ground_t` (air above), `ground_tl`, `ground_tr` (air above and beside), `ground_m` (covered), `ground_m2` (variation), `ground_l`, `ground_r` (side exposed) |
| `%` wall | `wall`, `wall_t` (air above) |
| `B` `C` | `brick` |
| `?` | `prize0`..`prize3` (shimmer loop) |
| `!` | `power0`..`power3` |
| `W` | `waxblock0`..`waxblock3` |
| `L` | `lifeblock0`..`lifeblock3` |
| `U` | `used` |
| `X` | `steel` |
| `=` | `catwalk`, `catwalk_l`, `catwalk_r` |
| `<` `>` | `conv0`..`conv3` (belt moving left; play backwards for `>`), `conv_l`, `conv_r` end rollers |
| `I` | `slick_t`, `slick_m` |
| `O` | `oily_t` |
| `M` | `mud_t` |
| `g` | `grime0`..`grime2` (fresh, half washed, nearly gone) |
| `~` | `sludge_t0`..`sludge_t3` (surface), `sludge_m` |
| `^` | `spikes` |
| `P` | `pipe_tl`, `pipe_tr` (rim), `pipe_l`, `pipe_r` (body); pipes are two tiles wide |
| `\|` | `pillar`, `pillar_t` |

Shared blocks (brick, crates, used, steel, catwalk, conveyor, grime, sludge, spikes, pipe) are
drawn once as `any_*`. Each theme supplies at least ground, wall, pillar, and its own `slick_*`
where it matters (foam in the tunnels, ice in winter). Themes: lot, vacuum, tunnel, storm, lube,
highway, winter, mega, bonus, backlot (see contract `ThemeId`).

Decor: frames named `tiles/decor_<name>` (any size, anchored bottom-centre), placed in levels
with `{ kind: 'decor', props: { sprite: 'decor_cone', front: false } }`. The world-art task
supplies a generous set per theme (cones, vacuum stations, light poles, pay kiosk, MIGHTY WASH
signs, flags, bushes, mesquite, tunnel arches 3 tiles wide and 5 tall, mitter curtains
(4 frames, drawn in front of Maxx), foam applicators, windows, oil drums, tool racks, tire
piles, billboards, pumpjacks, wind turbines, snowmen, salt piles, neon signs, fences, dumpsters)
and lists them in `atlas.meta.decor` with sizes so level designers can pick from the list.

### A3. Backgrounds (atlases `bg_<theme>`)

Per theme up to three horizontally tileable strips, 640 px wide, anchored to the bottom of the
screen: `far` (scroll 0.15), `mid` (0.35), `near` (0.6). `atlas.meta.sky` = list of
`[yTop, cssColor]` flat bands. `atlas.meta.weather` = `'rain' | 'snow' | 'none'`. West Texas
flavour: flat horizon, mesas, wind turbines, pumpjacks, big skies, a Mighty Wash building.

### A4. Particles (atlas `fx`)

For each `FxId` in sim/types.ts, frames `fx/<id>0`..`fx/<id>N` (small, 4 to 16 px, 3 to 6
frames). The world renderer animates them and falls back to squares when a frame is missing.

### A5. World renderer (`game/render/world.ts`, made by the world-code task)

```ts
export interface WorldRenderer {
  /** A new world or a new area started. */
  reset(world: World): void
  /** Once per simulation tick: particles and other cosmetics. */
  update(world: World): void
  /** Every GameEvent goes here; it uses fx and shake and ignores the rest. */
  event(ev: GameEvent, world: World): void
  /** Draw the playfield for world.camera (no HUD). */
  draw(g: CanvasRenderingContext2D, world: World): void
}
export function createWorldRenderer(sprites: Sprites, opts?: { shake?: boolean }): WorldRenderer
```

Entity drawing is a registry, like behaviours: `registerRenderer(kind, draw)` from
`game/render/registry.ts`, with every file in `game/render/entities/` loaded by glob.
`draw(g, e, rc)` gets a render context with `sprites`, `world`, `tick`, and camera-relative
helpers. An entity with no renderer draws as a labelled box in debug and nothing otherwise.

### A6. Level metadata (`game/levels/meta.ts`, already written)

`LEVEL_META` lists the eight levels (id, site, name, theme, music, time). The map and the
level files both read it.

## B. Slices

### B1. World art (tiles, decor, backgrounds)

Scripts `art-tiles.mjs`, `art-bg.mjs`. Everything in A2 and A3 for all ten themes. Mood:

- lot: bright morning. Clean concrete, red and blue Mighty Wash trim, puffy clouds.
- vacuum: golden late afternoon, long shadows, vacuum arches.
- tunnel: inside a wash tunnel: blue-grey walls, yellow safety stripes, wet floor, windows,
  red and blue arches. Slick = white foam.
- storm: dark teal-grey sky, brown mud ground, rain.
- lube: underground concrete, orange hazard stripes, pipes, shelves of oil cans, warm lamps.
- highway: sunset bands (orange to purple), dark asphalt, mesas, pumpjacks, billboards.
- winter: pale sky, snow-capped ground, ice, bare mesquite, salt piles, snowfall.
- mega: the giant tunnel at night: deep navy and purple, neon red and blue, chrome.
- bonus: a cosy token vault: gold trim on navy.
- backlot: the alley behind the wash at night: chain-link, dumpsters, rival posters.

### B2. World renderer (code)

`render/world.ts`, `render/registry.ts`, `render/particles.ts`, `render/themes.ts`,
`render/player.ts`. Sky bands, parallax strips, weather, cached tile chunks with animated tiles
drawn live, the neighbour-aware ground/pipe/catwalk variants in A2, entities by `z`, droplets
(blue-white streaks), Maxx (animation choice from his state; blink while invulnerable; mud
overlay from `maxx/grime1|2` composited source-atop when shine is lost; sparkle while waxed; a
water jet while hovering; turbo nozzle glow), particles from `fx` events, camera shake (respect
the setting). No per-frame canvas allocation. A registered `decor` renderer and a no-op `decor`
behaviour.

### B3. Objects and effects

Art (`items`, `fx`) and renderers for the kinds the core already simulates: coin (spinning MW
wash token), token (big gold token), bubble, turbo (the nozzle), wax (a tin of Mighty Wax),
oneup (Maxx's face), prize items popping from blocks, checkpoint (wash station flag: grey, then
raised and blue), goal (the exit arch: 3 tiles wide, 5 tall, traffic light red then green,
THANK YOU sign), secretExit (a steel door marked EMPLOYEES ONLY), door, spring (tire stack that
squashes), lift (steel platform with hazard stripes), sign (wooden sign; its text is drawn by
the HUD), spawner (invisible), marker (invisible).

### B4. Cars

Art (`cars`), renderer, and polish of the car behaviour the core ships (you take over
`sim/entities/car.ts` and the spawner). Each variant: body, turning wheels, three dirt overlay
stages, faces (grumpy, startled when sprayed, happy), a washed sparkle, several paint colours by
palette swap (picked from the entity id), a squash-and-bounce when washed, a honk, exhaust
puffs. The pickup telegraphs its mud throw. The sports car shows a warning marker at the screen
edge before it arrives. Cars must read as characters: dirty = sad and grumpy, washed = delighted.

### B5. Critters and hazards

Simulation + art (`critters`) + renderers:

- `blob` 28x22. Walks 30 px/s, turns at walls and at ledges. 3 spray hits or one stomp (+100).
- `bird` 28x20, a grackle. Flies a sine wave at 70 px/s; drops a `splat` every 110 to 150 ticks
  when within 160 px of Maxx horizontally. 2 spray hits shoo it away (+200).
- `bugs` 36x36 swarm. Drifts at Maxx at 40 px/s, ignores tiles. 6 hits to scatter (+200).
- `tumbleweed` 30x30. Rolls and bounces at 90 px/s. Spray pushes it back; 5 hits break it (+100).
- `drip`. A ceiling drip: swells for 30 ticks, falls, splashes. `props.every` (100), `props.phase`.
- `icicle` 16x28. Shakes for 20 ticks when Maxx is under it (within 40 px), then falls. A spray
  hit drops it early.
- `brush` 28 wide, `props.h` tall (64). A spinning wash brush on a rail: `props.axis` x or y,
  `props.range` tiles, `props.speed`. Hurts. Spray does nothing.
- `jet`. A hot wax jet: off `props.off` (80), sputter 20, on `props.on` (50); a column down (or
  `props.dir` up) to the first solid tile, at most `props.len` tiles. Hurts while on.
- `blower`. A wind zone `props.w` x `props.h` tiles pushing with `props.force` (negative = left).
- `splat`, projectiles as needed.

### B6. Bosses

Simulation + art (`bosses`) + renderers. Each sets the HUD bar with setBoss and emits `versus`.

- `mudslinger` (level 4). A jacked-up pickup, 140x96, dirt 80. Flings volleys of 3 clods at
  varying ranges; then revs (telegraph) and charges across the arena; then sits spent for
  2 seconds (wash it). Below half dirt: faster, 5 clods. Washed: happy truck, the exit opens.
- `mudzilla` (level 8). A giant monster truck, 200x150, dirt 150, three phases (at 66% and 33%
  a roar and a faster pattern, with cleaner body art each phase). Wheelie stomp with a ground
  shockwave to jump; mud rain with ground shadows; spawns blobs; big bounces you run under.
  Washed: a huge grin, confetti, then the level completes.

### B7. Rivals: Rival Row (the secret)

Simulation + art (`rivals`) + renderers + the level file `levels/rivals.ts`. Four invented rival
mascots, fought in order, each in a one-screen arena. `world.flags.rivalsBeaten` counts them;
the entry area's doors open by that flag so a returning player resumes at the next rival. Each
fight starts with a `versus` event and ends with jingle `rivalDown`. After the fourth: a trophy
room with the goal; jingle `champion`.

1. BUCKET BILL of Bucket Bros. Driveway Wash. A dented tin bucket with a sponge hat. Sloshes a
   low dirty wave along the floor (jump it), lobs wet sponges in arcs (spray them away), hops
   at Maxx. After a slosh he is empty and dizzy for 90 ticks: wash him.
2. SIR STREAKS of Streak City Express. A tall squeegee knight. Dashes across the arena low or
   high (his stance tells which), leaving a slick streak on the floor; throws returning wiper
   blades. Stunned for 100 ticks when he hits the wall.
3. SLICK OLLIE of Slick's Lube-N-Splash. An oil can in a bow tie. Squirts oil globs that leave
   oily floor for 6 seconds, belly-slides along it, drips from platforms. Open while he refills.
4. NIMBUS NICK of the Free Rain Wash Co. A smug storm cloud in sunglasses who says rain is a
   free car wash. Floats overhead (aim up). Sweeping rain columns with gaps, lightning with a
   ground marker first, gusts that shove. Spray him enough and he shrinks and sinks: finish him.

They are comic villains: silly, expressive, never crude. None may resemble a real company's
mascot.

### B8. Play scene and HUD

`scenes/play.ts`, `render/hud.ts`, `scripts/maxx/art-hud.mjs`. Params `{ levelId }`.

- Level card (site, name, Maxx head x lives) for 90 ticks, then iris in.
- Each tick: step the world with the input frame, pass every event to the world renderer and
  handle sfx, music, jingle, popup, banner, rumble, shake, versus (a card: MIGHTY MAXX VS name,
  tagline), area (cover the cut), checkpoint, secret. Spray loop from `player.spraying`.
- Music: the area's or level's song; `wax` while waxed; hurry-up tempo under 60 seconds.
- HUD: lives, three shine pips, coins, score, cars washed / total, three token slots, clock,
  turbo and wax indicators, boss bar, popups, banners, and the text of any `sign` in state
  `near` in a panel (it may contain `{jump}` style prompts).
- Pause: RESUME, RESTART LEVEL, OPTIONS, EXIT TO MAP.
- Grimed or time up: after the jingle, lose a life; with lives left restart from the
  checkpoint (flags kept), else go to `gameover`.
- Clear: tally (time bonus counting down, cars washed, SPOTLESS +3000, tokens), write the save
  (record, `unlocked`, `hiScore`; `secretFound` on a secret exit; `rivalsBeaten` as it rises;
  `champion`), then `map` with `{ from, exit }`; level 8 goes to `ending`.

### B9. Title, options, how to play, game over, ending

`scenes/title.ts`, `scenes/gameover.ts`, `scenes/ending.ts`, `scenes/shared/options.ts`,
`scripts/maxx/art-title.mjs`. The logo SUPER MIGHTY MAXX in the spirit of the Mighty Wash
wordmark (see public/mighty-wash-logo.png): chunky italic capitals, red MIGHTY, blue MAXX,
navy outline, a blue swoosh. Maxx runs in place over a scrolling lot with happy cars and
bubbles. PRESS START, then CONTINUE / NEW GAME / HOW TO PLAY / OPTIONS. Options: music, sound,
rumble, screen shake, fullscreen, erase save (confirm). How to play: the controls for the
device in use and the rules in three short pages. Game over: CONTINUE (map, fresh lives) or
QUIT. Ending: a parade of washed cars, Maxx's win pose, credits, final numbers, and if the
secret is still hidden a rumour pointing at the roof of MW03.

### B10. World map

`scenes/map.ts`, `scripts/maxx/art-map.mjs`. A West Texas road map filling 640x320 above a 40 px
status bar: a highway winding from Mighty Wash HQ through eight sites to the Mega Tunnel, with
animated wind turbines, pumpjacks, mesquite, prickly pear, cattle, a river and a bridge. Sites
show locked, open, cleared (flag) and spotless (gold star). A hidden side road to Rival Row
appears, with a flourish, when `save.secretFound`. Maxx (`maxx/mapWalk`) walks node to node
along the road. A panel shows the site, name, best score and tokens. Confirm enters the level.

### B11. Music

The remaining songs, in the format documented in `game/audio`. Each quotes or answers the
title theme's motif somewhere, so the score feels like one work.

| id | key, tempo | mood |
| --- | --- | --- |
| map | C, 120 | easy road-trip bounce |
| tunnel | E minor, 150 | mechanical drive, conveyor rhythm, heroic lead |
| storm | D minor, 132 | tense, rolling |
| lube | A minor, 104 | sparse, slinky, bass-led |
| bonus | F, 160 | 8 bars of glee |
| wax | C, 190 | frantic invincibility loop |
| highway | A, 168 | sunset road race, galloping bass |
| winter | F, 126 | light, bell-like, lilting |
| mega | C minor, 160 | the last level: urgent, the title motif in minor |
| boss | G minor, 176 | short, tense |
| rival | B minor, 150 | swaggering showdown |
| ending | C, 110 | warm reprise of the title theme |
