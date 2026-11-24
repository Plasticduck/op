// Where the game's source lives, for every script in this folder. One place to change.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/** Folder of the game inside the repo, with forward slashes, relative to REPO. */
export const GAME_REL = 'src/features/it/maxx'
export const GAME_DIR = path.join(REPO, GAME_REL)
export const ASSETS_DIR = path.join(GAME_DIR, 'game', 'assets')
/** The same folder as a Vite root-relative URL (for ssrLoadModule and dev pages). */
export const GAME_URL = '/' + GAME_REL
