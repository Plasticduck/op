import type { MusicId, ThemeId } from '../contract'

/** What the map and the level cards need to know about a level before its file is loaded. */
export interface LevelMeta {
  id: string
  site: string
  name: string
  theme: ThemeId
  music: MusicId
  /**
   * Seconds on the clock. Per tile of the level (lint's length) it only tightens from MW01 to
   * MW08: 1.70, 1.51, 1.40, 1.30, 1.30, 1.20, 1.20, 1.15 (Rival Row, four fights, 3.0).
   */
  time: number
}

/** The eight main levels, in map order. Each is named after a Mighty Wash site number. */
export const LEVEL_META: LevelMeta[] = [
  { id: 'mw01', site: 'MW01', name: 'GRAND OPENING', theme: 'lot', music: 'sunny', time: 300 },
  { id: 'mw02', site: 'MW02', name: 'VACUUM ALLEY', theme: 'vacuum', music: 'sunny', time: 300 },
  { id: 'mw03', site: 'MW03', name: 'TUNNEL VISION', theme: 'tunnel', music: 'tunnel', time: 320 },
  { id: 'mw04', site: 'MW04', name: 'MUD SEASON', theme: 'storm', music: 'storm', time: 340 },
  { id: 'mw05', site: 'MW05', name: 'LUBE PIT', theme: 'lube', music: 'lube', time: 300 },
  { id: 'mw06', site: 'MW06', name: 'BUG SEASON BOULEVARD', theme: 'highway', music: 'highway', time: 300 },
  { id: 'mw07', site: 'MW07', name: 'SALT STORM', theme: 'winter', music: 'winter', time: 300 },
  { id: 'mw08', site: 'MW08', name: 'THE MEGA TUNNEL', theme: 'mega', music: 'mega', time: 400 },
]

/** Rival Row, the secret boss rush. */
export const RIVALS_META: LevelMeta = { id: 'rivals', site: '???', name: 'RIVAL ROW', theme: 'backlot', music: 'rival', time: 600 }
