// Every song in audio/songs, compiled and checked once at load. Adding a
// file to that folder adds a song.
import { compileSong } from './format'
import type { Song, SongDef } from './format'

const files = import.meta.glob<{ default?: SongDef }>('./songs/*.ts', { eager: true })

export const SONGS: Record<string, Song> = {}

/** Whatever the checks found, as "song: problem" lines. Empty when all is well. */
export const SONG_PROBLEMS: string[] = []

for (const [path, mod] of Object.entries(files)) {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.ts$/, '')
  const def = mod.default
  if (!def || typeof def !== 'object' || !def.parts) {
    SONG_PROBLEMS.push(`${name}: the file has no default export made with defineSong()`)
    continue
  }
  const song = compileSong(def)
  if (def.id !== name) song.problems.push(`the id "${def.id}" does not match the file name "${name}"`)
  if (SONGS[def.id]) song.problems.push(`there are two songs with the id "${def.id}"`)
  else SONGS[def.id] = song
  for (const p of song.problems) SONG_PROBLEMS.push(`${name}: ${p}`)
}

if (import.meta.env.DEV && SONG_PROBLEMS.length) {
  console.warn(`[maxx audio] ${SONG_PROBLEMS.length} problem(s) in audio/songs:\n  ` + SONG_PROBLEMS.join('\n  '))
}
