// window.__maxx: how scripts (scripts/maxx/shot.mjs, tests, the console) drive the game.
// Only installed in debug mode, which only the dev page asks for.
import { ACTIONS } from '../contract'
import type { Action, InputFrame, Scene, SceneId, SceneParams, Transition } from '../contract'
import type { GameHandle, GameStatus, ShellCtx } from './game'

export interface MaxxDebug {
  /** True once sprites are loaded and the first frame is drawn. */
  readonly ready: boolean
  readonly ctx: ShellCtx
  readonly handle: GameHandle
  /** What scenes have thrown. Empty when all is well. */
  readonly errors: readonly string[]
  /** The id of the scene on screen. */
  scene(): SceneId | null
  /** The scene object itself. */
  sceneObject(): Scene | null
  /** Switch scene. A cut unless a transition is named, so one step() later the new scene is up. */
  go(scene: SceneId, params?: SceneParams, transition?: Transition): void
  /** The World of the scene on screen, if it has one (a scene exposes it as `world`). */
  world(): unknown
  /** Run n ticks now and draw. Use with manual mode for repeatable results. */
  step(n?: number): void
  /** Hold these actions down until release(). 'left jump' or ['left', 'jump']. */
  hold(actions: string | readonly string[], axis?: { x?: number; y?: number }): void
  release(): void
  /** Manual mode only: hold, step, release, step once more. */
  tap(actions: string | readonly string[], ticks?: number): void
  setManual(on: boolean): void
  /** The input frame of the last tick. */
  frame(): InputFrame
  status(): GameStatus
}

type Host = { __maxx?: MaxxDebug }

function parseActions(actions: string | readonly string[]): Action[] {
  const list = typeof actions === 'string' ? actions.split(/[\s,+]+/) : actions
  return list.filter((a): a is Action => (ACTIONS as readonly string[]).includes(a))
}

export function installDebug(handle: GameHandle): void {
  const input = handle.ctx.input
  const api: MaxxDebug = {
    get ready() {
      return handle.ready
    },
    ctx: handle.ctx,
    handle,
    get errors() {
      return handle.errors
    },
    scene: () => handle.sceneId,
    sceneObject: () => handle.scene(),
    go: (scene, params = {}, transition = 'cut') => handle.ctx.go(scene, params, transition),
    world() {
      const s = handle.scene() as (Scene & { world?: unknown; getWorld?: () => unknown }) | null
      if (!s) return null
      return typeof s.getWorld === 'function' ? s.getWorld() : (s.world ?? null)
    },
    step: (n = 1) => handle.step(n),
    hold: (actions, axis) => input.hold(parseActions(actions), axis),
    release: () => input.release(),
    tap(actions, ticks = 1) {
      input.hold(parseActions(actions))
      handle.step(ticks)
      input.release()
      handle.step(1)
    },
    setManual: (on) => handle.setManual(on),
    frame: () => input.last,
    status: () => handle.status,
  }
  ;(window as unknown as Host).__maxx = api
}

export function uninstallDebug(handle: GameHandle): void {
  const host = window as unknown as Host
  // A newer game (React StrictMode mounts twice) may have taken the slot already.
  if (host.__maxx?.handle === handle) delete host.__maxx
}
