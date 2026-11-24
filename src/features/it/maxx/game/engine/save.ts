// Progress and settings, in localStorage, one record per signed-in user.
import type { LevelRecord, MapMemory, SaveApi, SaveData, SaveSettings } from '../contract'

export const SAVE_KEY_PREFIX = 'smm.save.v1.'
export const MAIN_LEVELS = 8
export const RIVALS = 4
/** More road ids than the map will ever have: a bigger list was not written by the game. */
const MAX_MAP_ROADS = 64
/** Level, site and road ids. Anything else (a stray "__proto__", a long string) is not one. */
const ID = /^[a-z][a-z0-9_-]{0,31}$/i

type Bag = Record<string, unknown>

/** The slice of Storage the save needs (tests pass their own). */
export interface SaveStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Where the page hears that another tab may have written the save (the window; tests pass their own). */
export interface SaveEvents {
  addEventListener(type: string, fn: (e: Event) => void): void
  removeEventListener(type: string, fn: (e: Event) => void): void
}

/** The save as the shell holds it: the contract's SaveApi, kept in step with the game's other tabs. */
export interface SaveHandle extends SaveApi {
  /** Called after another tab's save has been taken in: its settings may differ from these. */
  onChange: (() => void) | null
  /** Stop listening for other tabs. */
  dispose(): void
}

// 'storage' comes as soon as another tab writes; a tab the browser had frozen may only catch up
// when it is looked at again. visibilitychange bubbles from the document up to the window.
const HEARD = ['storage', 'focus', 'visibilitychange'] as const

const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function defaultSettings(): SaveSettings {
  return { music: 7, sfx: 8, rumble: true, shake: true }
}

export function emptyRecord(): LevelRecord {
  return { cleared: false, bestScore: 0, bestTicks: 0, tokens: [false, false, false], spotless: false }
}

export function emptyMapMemory(): MapMemory {
  return { roads: [], beaten: 0, champion: false, node: '' }
}

export function emptySave(settings: SaveSettings = defaultSettings()): SaveData {
  return { v: 1, levels: {}, unlocked: 1, secretFound: false, rivalsBeaten: 0, champion: false, finished: false, hiScore: 0, settings, map: emptyMapMemory() }
}

/** An old save has no map memory: the map then takes its first look, as on a new game. */
function repairMapMemory(raw: unknown): MapMemory {
  const out = emptyMapMemory()
  if (!isBag(raw)) return out
  if (Array.isArray(raw.roads)) {
    for (const id of raw.roads) {
      if (out.roads.length >= MAX_MAP_ROADS) break
      if (typeof id === 'string' && ID.test(id) && !out.roads.includes(id)) out.roads.push(id)
    }
  }
  out.beaten = int(raw.beaten, 0, RIVALS, 0)
  out.champion = bool(raw.champion, false)
  out.node = typeof raw.node === 'string' && ID.test(raw.node) ? raw.node : ''
  return out
}

function repairRecord(raw: unknown): LevelRecord | null {
  if (!isBag(raw)) return null
  const t = Array.isArray(raw.tokens) ? raw.tokens : []
  return {
    cleared: bool(raw.cleared, false),
    bestScore: int(raw.bestScore, 0, Number.MAX_SAFE_INTEGER, 0),
    bestTicks: int(raw.bestTicks, 0, Number.MAX_SAFE_INTEGER, 0),
    tokens: [t[0] === true, t[1] === true, t[2] === true],
    spotless: bool(raw.spotless, false),
  }
}

/** Whatever was stored, as a well-formed SaveData. Anything unreadable falls back to its default. */
export function repairSave(raw: unknown): SaveData {
  const out = emptySave()
  if (!isBag(raw)) return out
  if (isBag(raw.levels)) {
    for (const [id, rec] of Object.entries(raw.levels)) {
      // Level ids only: a stray "__proto__" must not become a key.
      if (!ID.test(id)) continue
      const fixed = repairRecord(rec)
      if (fixed) out.levels[id] = fixed
    }
  }
  out.unlocked = int(raw.unlocked, 1, MAIN_LEVELS, 1)
  out.secretFound = bool(raw.secretFound, false)
  out.rivalsBeaten = int(raw.rivalsBeaten, 0, RIVALS, 0)
  out.champion = bool(raw.champion, false)
  out.finished = bool(raw.finished, false)
  out.hiScore = int(raw.hiScore, 0, Number.MAX_SAFE_INTEGER, 0)
  // An early shape kept the settings at the top level.
  const s = isBag(raw.settings) ? raw.settings : raw
  out.settings = {
    music: int(s.music, 0, 10, 7),
    sfx: int(s.sfx, 0, 10, 8),
    rumble: bool(s.rumble, true),
    shake: bool(s.shake, true),
  }
  out.map = repairMapMemory(raw.map)
  return out
}

function browserStorage(): SaveStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Storage switched off for this site.
    return null
  }
}

function browserEvents(storage: SaveStorage | null): SaveEvents | null {
  // Only the page's own localStorage is shared with its other tabs, and only it says when they write.
  return storage && typeof window !== 'undefined' && storage === browserStorage() ? window : null
}

export function createSave(userId: string, storage: SaveStorage | null = browserStorage(), events: SaveEvents | null = browserEvents(storage)): SaveHandle {
  const key = SAVE_KEY_PREFIX + (userId || 'guest')
  let data = emptySave()
  // The text this tab last read or wrote. Anything else under the key came from another tab.
  let known: string | null = null
  try {
    const text = storage?.getItem(key) ?? null
    known = text
    if (text) data = repairSave(JSON.parse(text))
  } catch {
    // Unreadable (private mode, bad JSON): start fresh, keep playing.
  }

  const commit = () => {
    try {
      const text = JSON.stringify(data)
      storage?.setItem(key, text)
      known = text
    } catch {
      // Quota or private mode: progress lasts until the page closes.
    }
  }

  // Every commit writes the whole save, and the map commits on every walk. A second tab of the
  // game still holding an older copy would write it back over the newer one and wipe every clear
  // made since. So a tab takes in what another one wrote. In place: scenes read save.data afresh.
  const catchUp = () => {
    let text: string | null
    try {
      text = storage ? storage.getItem(key) : known
    } catch {
      return
    }
    if (text === known) return
    let next: SaveData
    try {
      next = text ? repairSave(JSON.parse(text)) : emptySave(data.settings)
    } catch {
      // Not readable: keep this tab's copy, which the next commit puts back.
      return
    }
    known = text
    Object.assign(data, next)
    handle.onChange?.()
  }
  const heard = (e: Event) => {
    // A storage event names the key it changed, or none when the whole storage was cleared.
    if (e.type === 'storage') {
      const changed = (e as StorageEvent).key
      if (changed !== null && changed !== key) return
    }
    catchUp()
  }
  for (const type of HEARD) events?.addEventListener(type, heard)

  const handle: SaveHandle = {
    data,
    commit,
    reset() {
      // In place: scenes hold on to `data`.
      Object.assign(data, emptySave(data.settings))
      commit()
    },
    record(levelId) {
      // Its own entries only: an id like 'constructor' would otherwise find Object's.
      if (!Object.prototype.hasOwnProperty.call(data.levels, levelId)) data.levels[levelId] = emptyRecord()
      return data.levels[levelId]
    },
    onChange: null,
    dispose() {
      for (const type of HEARD) events?.removeEventListener(type, heard)
    },
  }
  return handle
}
