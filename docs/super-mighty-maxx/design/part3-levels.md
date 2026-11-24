# Super Mighty Maxx: design bible, part 3 (levels)

Read parts 1 and 2 first, then `docs/super-mighty-maxx/NOTES.md`.

## Rules of level design here

- A level is a `LevelDef` in `src/features/it/maxx/game/levels/<id>.ts` (`mw01.ts` .. `mw08.ts`), built from
  `LEVEL_META` in `levels/meta.ts`. Rows are strings, one character per tile; keep every row of
  an area exactly the same length. Standard areas are 12 rows tall with the floor in the bottom
  two rows; taller areas scroll vertically.
- One screen is 20 tiles wide and 11.25 tall. Maxx is 2 tiles tall. Rely on: a wall 3 tiles
  high is climbable, a 4-tile pit is jumpable, a full jump rises about 4 tiles. Check the real
  numbers in NOTES.md and with the tools; never design at the limit except for optional tokens.
- Shape: a safe opening that teaches, three or four beats that each introduce one idea and then
  twist it, a checkpoint just past the middle, a climax that combines the level's ideas, the
  exit. Rest spots between beats. Coins lead the eye: arcs over jumps, trails toward secrets.
- Cars must be washable: when a car first appears the player needs flat room and time to wash
  it (see the dirt and speed table in part 1). Early levels: always. Later levels may crowd the
  player with two cars, a car plus a hazard, a conveyor dragging Maxx toward the car.
- Three gold tokens per level: one in plain sight but awkward, one hidden (hidden block, grime
  block wall, pipe room), one that takes skill (riding a washed car roof, a hover, a spring).
- Secrets in the spirit of the classics: hidden blocks, pipes down to token rooms, walls of
  grime that wash away, ways above the ceiling. Reward curiosity generously.
- Use `sign` entities for teaching in levels 1 to 3. Text is short, capitals, no em dashes,
  may use `{jump}` `{spray}` `{up}` `{down}` prompts.
- Dress the level with `decor` props so it reads as a place (see `tiles` atlas meta for names).
- Difficulty rises level by level: more dirt per car, faster cars, less room, more hazards at
  once, slipperier floors, longer levels. Level 1 should be finishable by someone who has never
  held a controller. Level 8 should take a good player several tries.
- Every level must pass the validator, be proven completable by the reachability and bot tools,
  and be looked at as a picture (the overview tool) before it is called done.

## The levels

### MW01 GRAND OPENING (lot, about 160 tiles)
Teaches everything basic. Signs for moving and jumping, bumping a crate, spraying the first
dusty compact (alone, on flat ground, with lots of room), stomping or spraying a blob, using a
washed car as a step (a compact arrives beside a high ledge with a token on it). Small pits (2
then 3 tiles). A power crate. A hidden-block staircase to a token. A pipe with a coin trail down
to a token room. Ends with a stair of steel blocks to the exit arch.

### MW02 VACUUM ALLEY (vacuum, about 180 tiles)
Sedans. Grackles that drop splats (sign: hold up to aim high). Tire-stack springs up to
catwalks. Lifts over wider pits. The hover is taught over a long pit with a coin trail (sign:
in the air hold down and spray), with a safer high route beside it. A pipe room.

### MW03 TUNNEL VISION (starts on the lot, then the tunnel; about 200 tiles, 14 rows)
The first wash tunnel: a ceiling overhead, conveyor floors running against Maxx, a spawner
feeding compacts and sedans down the belt, brushes travelling on rails, hot wax jets, foam
slicks, the first SUVs. **The big secret is here.** Late in the tunnel the ceiling has a vent
plugged with grime blocks, above a tire-stack spring that seems to have no purpose and a short
trail of coins pointing up. Wash the grime with an upward spray, bounce up through the vent,
and Maxx is on the tunnel roof. Run the roof to the right, over and past the normal exit, to a
steel door marked EMPLOYEES ONLY: the `secretExit`. That opens the hidden road to Rival Row.
The roof must be impossible to reach any other way, and the normal route must not need it.

### MW04 MUD SEASON (storm, about 210 tiles)
Mud floors that slow the run and weaken the jump, sludge pits, pickups flinging clods,
tumbleweeds, blobs in groups, walls of grime blocks that must be washed through. Lifts over
sludge. Ends in an arena with the mini-boss MUDSLINGER (two catwalks to dodge its charge), then
the exit.

### MW05 LUBE PIT (lube, about 200 tiles, taller and more vertical)
Underground. Oily floors, drips, hot jets, lifts in shafts, catwalks over pits of used oil
(sludge), sedans and SUVs parked over the service bays that wake up as Maxx passes. Token
routes go up and down. Leaves by a pipe to the exit on the surface.

### MW06 BUG SEASON BOULEVARD (highway, about 230 tiles)
Speed. Sports cars with a rev warning, SUVs, bug swarms, grackles. Long ditches crossed only by
riding the roofs of washed cars that a spawner sends along the low road. Springs. **A second
way to Rival Row**: a wall of grime blocks hides a pipe to a token room that also holds an
EMPLOYEES ONLY door, for players who missed the roof of MW03.

### MW07 SALT STORM (winter, about 230 tiles)
Ice. Slick floors nearly everywhere, salt-crusted vans that take a long wash, icicles, blowers
gusting against the run, narrow icy platforms over pits, lifts. Precise jumping with the hover
as the safety net.

### MW08 THE MEGA TUNNEL (mega, about 280 tiles plus the arena)
Everything at once, at night, under neon: fast conveyors, paired brushes, jets, blowers, foam,
sludge, lifts, spawners sending mixed traffic from both directions, monster trucks that must be
fully washed while dodging. Two checkpoints. Then the arena and MUDZILLA. Then the exit.
