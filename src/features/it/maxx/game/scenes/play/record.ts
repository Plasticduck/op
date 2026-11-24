// What a visit to a level writes to the save. The rules, in one place:
//
// - A clear (either exit): record(level).cleared; bestScore (highest), bestTicks (fastest,
//   0 = none yet), tokens (OR-ed in), spotless (once true, stays). `unlocked` rises to the
//   level after this one (main levels only, 1..8). `hiScore` follows the session score.
//   The secret exit of MW03 or MW06 (the hidden road to Rival Row) also sets `secretFound`;
//   any other level's secret exit (a test room, the sandbox) is a clear and nothing more.
//   Clearing the last main level sets `finished`.
// - Rival Row (level id 'rivals'): `rivalsBeaten` follows world.flags.rivalsBeaten as it
//   rises, committed at once so a beaten rival stays beaten; `champion` at 4.
// - Leaving any other way (EXIT TO MAP, game over) writes nothing but `hiScore`.
import type { LevelRecord, SaveApi } from '../../contract'
import { MAIN_LEVELS, RIVALS } from '../../engine/save'
import { LEVEL_META, RIVALS_META } from '../../levels/meta'

export const RIVALS_ID = RIVALS_META.id
/** Clearing this one finishes the game: the first time, the play scene goes to 'ending' instead of the map. */
export const LAST_LEVEL_ID = LEVEL_META[LEVEL_META.length - 1].id
/** The levels whose secret exit is the hidden road to Rival Row (design part 1, section 6). */
const HIDDEN_ROAD_FROM: ReadonlySet<string> = new Set(['mw03', 'mw06'])

/** Does this level's secret exit lead to Rival Row? */
export function findsHiddenRoad(levelId: string): boolean {
  return HIDDEN_ROAD_FROM.has(levelId)
}

export interface ClearFacts {
  levelId: string
  exit: 'goal' | 'secret'
  /** The points the visit earned (every attempt of it), both bonuses included. */
  score: number
  /** Ticks played in this visit, the attempts that ended in grime included. */
  ticks: number
  tokens: readonly boolean[]
  spotless: boolean
  sessionScore: number
}

export interface ClearNews {
  /** The best on record before this clear. */
  prevBest: number
  newBest: boolean
  /** This clear opened the hidden road (the secret exit of MW03 or MW06, for the first time). */
  roadOpened: boolean
}

/** The level's record if the save has one. Unlike save.record() it never makes one. */
export function recordOf(save: SaveApi, levelId: string): LevelRecord | null {
  return Object.prototype.hasOwnProperty.call(save.data.levels, levelId) ? save.data.levels[levelId] : null
}

export function writeClear(save: SaveApi, f: ClearFacts): ClearNews {
  const data = save.data
  const rec = save.record(f.levelId)
  const prevBest = rec.bestScore
  rec.cleared = true
  if (f.score > rec.bestScore) rec.bestScore = Math.floor(f.score)
  if (f.ticks > 0 && (rec.bestTicks === 0 || f.ticks < rec.bestTicks)) rec.bestTicks = Math.floor(f.ticks)
  for (let i = 0; i < 3; i++) if (f.tokens[i]) rec.tokens[i] = true
  if (f.spotless) rec.spotless = true

  const main = LEVEL_META.findIndex((m) => m.id === f.levelId)
  if (main >= 0) data.unlocked = Math.max(data.unlocked, Math.min(MAIN_LEVELS, main + 2))
  const road = f.exit === 'secret' && findsHiddenRoad(f.levelId)
  const roadOpened = road && !data.secretFound
  if (road) data.secretFound = true
  if (f.levelId === LAST_LEVEL_ID) data.finished = true
  if (f.sessionScore > data.hiScore) data.hiScore = Math.floor(f.sessionScore)
  save.commit()
  return { prevBest, newBest: f.score > prevBest, roadOpened }
}

/** The high score outside a clear: a score reached is kept even if the level was not finished. */
export function noteScore(save: SaveApi, sessionScore: number): void {
  if (!(sessionScore > save.data.hiScore)) return
  save.data.hiScore = Math.floor(sessionScore)
  save.commit()
}

/** Rival Row: copy the count of beaten rivals up into the save when it has risen. */
export function noteRivals(save: SaveApi, beaten: number): void {
  const n = Math.min(RIVALS, Math.floor(beaten))
  if (!(n > save.data.rivalsBeaten)) return
  save.data.rivalsBeaten = n
  if (n >= RIVALS) save.data.champion = true
  save.commit()
}
