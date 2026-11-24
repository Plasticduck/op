import type { LevelDef } from '../contract'
import { LEVEL_META, RIVALS_META } from './meta'

// Each level is a file of its own (mw01.ts .. mw08.ts, rivals.ts) exporting its LevelDef as the
// default, found here by name, so a level designer never edits this file.
const levelFiles = import.meta.glob<{ default: LevelDef }>(['./mw0[1-8].ts', './rivals.ts'], { eager: true })
const byId = new Map<string, LevelDef>()
for (const mod of Object.values(levelFiles)) {
  const def = mod.default
  if (def && typeof def.id === 'string') byId.set(def.id, def)
}

/** The eight main levels that exist, in map order. */
export const LEVELS: LevelDef[] = LEVEL_META.map((m) => byId.get(m.id)).filter((l): l is LevelDef => !!l)

/** Rival Row, the secret boss rush. */
export const RIVALS: LevelDef | null = byId.get(RIVALS_META.id) ?? null

/**
 * Test rooms, one file each in levels/dev/ (`export default` a LevelDef whose id starts
 * 'dev-'). Dev builds and the Node tools only: the production bundle leaves them out. The glob
 * is lazy and awaited behind the DEV test because an eager one becomes static imports hoisted
 * above the test, which would keep each room's top-level row building in the bundle as dead
 * code. The rooms import only types, so the await cannot wait on this module.
 */
const devFiles: Record<string, { default: LevelDef }> = import.meta.env.DEV
  ? Object.fromEntries(
      await Promise.all(
        Object.entries(import.meta.glob<{ default: LevelDef }>('./dev/*.ts')).map(async ([k, load]) => [k, await load()] as const),
      ),
    )
  : {}
export const DEV_LEVELS: LevelDef[] = Object.values(devFiles)
  .map((m) => m.default)
  .filter((l): l is LevelDef => !!l && typeof l.id === 'string')

/**
 * The sandbox walk (levels/sandbox.ts), like the test rooms: dev builds and the Node tools only,
 * loaded behind the DEV test for the same reason. In a production build sandboxLevel is an empty
 * stand-in that levelById never serves.
 */
const sandboxFile = import.meta.env.DEV ? await import('./sandbox') : null
export const sandboxLevel: LevelDef = sandboxFile?.sandboxLevel ?? { id: 'sandbox', site: '', name: '', time: 0, music: 'sunny', areas: [] }

/** Real ids played by a test room for now (standIn). Always empty in a production build. */
const standIns = new Map<string, LevelDef>()

/**
 * Dev builds and Node only: play a test room under a real level id, so the rules that hang on
 * the id can be checked before that level exists (Rival Row's rivalsBeaten, the ending after
 * 'mw08', the save key). Until it is undone, levelById(id) answers a copy of the dev level
 * carrying `id` (its areas shared, the dev level itself untouched), ahead of any real level.
 *
 *   standIn('rivals', 'dev-rivals-a')    // a dev level's id, the sandbox's, or a LevelDef
 *   standIn('rivals', null)              // undo it
 *
 * Returns the LevelDef now served under `id`, or null (undone, an unknown dev id, or a production
 * build, where it does nothing). In the page reach it with
 * `(await window.__t.mod('levels/index.ts')).standIn(...)`, the module instance the game uses.
 */
export function standIn(id: string, level: string | LevelDef | null): LevelDef | null {
  if (!import.meta.env.DEV) return null
  if (level === null) {
    standIns.delete(id)
    return null
  }
  const from = typeof level === 'string' ? (level === sandboxLevel.id ? sandboxLevel : DEV_LEVELS.find((l) => l.id === level)) : level
  if (!from) return null
  const copy: LevelDef = { ...from, id }
  standIns.set(id, copy)
  return copy
}

/** The ids standing in right now, for a check that wants to tidy up after itself. */
export function standingIn(): string[] {
  return [...standIns.keys()]
}

/** Real ids made to look unbuilt for now (hideLevel). Always empty in a production build. */
const hidden = new Set<string>()

/**
 * Dev builds and Node only: levelById(id) answers null until it is undone, as if that level had
 * not been built, so the checks can still see what the game does with a site whose level is
 * missing (the map's COMING SOON, the play scene's way straight back to the map) now that every
 * level exists. It wins over a standIn of the same id.
 *
 *   hideLevel('mw01')          // levelById('mw01') is null
 *   hideLevel('mw01', false)   // undo it
 *
 * Returns whether `id` is hidden now: always false in a production build, where it does nothing.
 */
export function hideLevel(id: string, hide = true): boolean {
  if (!import.meta.env.DEV) return false
  if (hide) hidden.add(id)
  else hidden.delete(id)
  return hidden.has(id)
}

/** The ids hidden right now, for a check that wants to tidy up after itself. */
export function hiddenLevels(): string[] {
  return [...hidden]
}

export function levelById(id: string): LevelDef | null {
  if (hidden.has(id)) return null
  const stand = standIns.get(id)
  if (stand) return stand
  if (sandboxFile && id === sandboxLevel.id) return sandboxLevel
  if (RIVALS && (RIVALS as LevelDef).id === id) return RIVALS
  return LEVELS.find((l) => l.id === id) ?? DEV_LEVELS.find((l) => l.id === id) ?? null
}
