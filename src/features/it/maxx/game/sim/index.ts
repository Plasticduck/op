// The simulation: the game's rules as plain data stepped at 60 Hz. No DOM, no
// canvas, no audio, no clock, no Math.random, and trig from ./mathx rather than
// the engine's, so Node runs it to the bit as the browser does
// (node scripts/maxx/sim.mjs).
//
//   const world = createWorld(level, { session })
//   every tick:  stepWorld(world, input.poll())   then read world, handle world.events and
//                empty the array (it only ever grows otherwise)
//
// What the rest of the game needs to know:
// - world.status leaves 'play' for 'clear' (world.exit says how), 'grimed' or
//   'timeup'; world.statusT then counts ticks. The simulation does not take a
//   life or award the SPOTLESS bonus (TUNING.spotlessBonus): the play scene does.
// - A retry is a new world: createWorld(level, { session, checkpoint:
//   world.checkpoint, flags: world.flags, tokens: world.stats.tokens }).
//   A checkpoint's x, y is where the middle of Maxx's feet goes. The flags
//   also remember which cars were already washed, so stats.carsWashed carries
//   on from where it was (the cars come back dirty, but SPOTLESS does not ask
//   for them twice). A fresh visit from the map passes no flags.
// - world.session is the shell's own object, updated in place (score, coins,
//   lives from coins and 1UPs, pips, turbo). Pips at 0 after a grime; the next
//   createWorld starts him at full shine. Score stops at TUNING.maxScore and
//   lives at TUNING.maxLives.
// - Entity behaviours live in sim/entities/*.ts and are written with ./api.
//   Import the simulation from this file, so that folder is loaded.

// Every file in entities/ registers its kinds as it loads. (This cannot live in
// registry.ts: the entity files import the registry, so they would run first.)
import.meta.glob('./entities/*.ts', { eager: true })

export type * from './types'
export { buildArea, createWorld, enterArea, stepWorld } from './world'
// For the level tools: where a tile's spawn stands, and how warps name their far end.
export { findMarker, parseTarget, tileFeetX, tileFeetY, validateLevel } from './level'
export type { LevelReport } from './level'
export { cos, hypot, sin } from './mathx'
export { TUNING } from './tuning'
export type { Tuning } from './tuning'
export { TILE_INFO, TILE_BY_CODE, TILE_FLAGS, T_SOLID, T_ONEWAY, T_HIDDEN, T_HAZARD, T_FLOOR, T_WASHABLE, isTileChar } from './tiles'
export type { BumpKind, TileInfo } from './tiles'
export { getBehavior, hasBehavior, registeredKinds } from './registry'
export { worldHash } from './hash'
export * from './api'
