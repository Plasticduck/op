// Every scene the shell can switch to. To add or replace one: write its file, list it here.
import type { Scene, SceneId } from '../contract'
import { createEndingScene } from './ending'
import { createGameOverScene } from './gameover'
import { createMapScene } from './map'
import { createPlayScene } from './play'
import { createSandboxScene } from './sandbox'
import { createTitleScene } from './title'
import { createViewerScene } from './viewer'

/**
 * A fresh scene object every time the shell enters one. The dev scenes are listed only in a dev
 * build: players can never reach them (SANDBOX is on the dev page's title alone), so the build
 * leaves them out of the game's chunk. The shell answers a missing one as an unknown scene.
 */
export const SCENES: Partial<Record<SceneId, () => Scene>> = {
  title: createTitleScene,
  map: createMapScene,
  play: createPlayScene,
  gameover: createGameOverScene,
  ending: createEndingScene,
  ...(import.meta.env.DEV ? { sandbox: createSandboxScene, viewer: createViewerScene } : {}),
}
