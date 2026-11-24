// Loads the game's simulation and levels into Node, through Vite's own
// TypeScript transform (so import.meta.glob and friends work as in the
// browser). No port is opened and nothing is watched.
//
//   import { loadSim } from './lib/sim-loader.mjs'
//   const { sim, levels, contract, input, run, loadModule, close } = await loadSim()
//   const world = sim.createWorld(levels.sandboxLevel, { session: freshSession() })
//   run(world, [[['right'], 60], [['right', 'jump'], 20], [[], 30]])
//   const { MZ } = await loadModule('sim/entities/mudzilla.ts')
//   await close()
import { createServer } from 'vite'
import { GAME_REL, GAME_URL, REPO } from '../paths.mjs'

/** A module path for loadModule: '/...' from the repo root, 'src/features/it/maxx/...' likewise, anything else inside the game folder ('sim/...', 'render/...'). */
function moduleUrl(path) {
  if (path.startsWith('/')) return path
  if (path.startsWith(GAME_REL + '/')) return '/' + path
  return `${GAME_URL}/game/${path.replace(/^game\//, '')}`
}

export const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'spray', 'confirm', 'cancel', 'pause', 'select']

/** What a new game starts with (contract Session). */
export function freshSession(over = {}) {
  return { lives: 3, score: 0, coins: 0, pips: 3, turbo: false, ...over }
}

function noActions() {
  const state = {}
  for (const a of ACTIONS) state[a] = false
  return state
}

/**
 * An input builder. Call it once per tick with the actions held on that tick;
 * it works out pressed, released and repeat from the tick before.
 *
 *   const frame = makeInput()
 *   stepWorld(world, frame(['right', 'jump']))
 *   stepWorld(world, frame(['right'], { axisX: 0.5 }))   // analog stick half over
 *
 * axisX/axisY default to what the held directions imply (-1, 0 or 1).
 */
export function makeInput() {
  let prev = noActions()
  const heldFor = {}
  return function frame(heldList = [], extra = {}) {
    const held = noActions()
    for (const a of heldList) {
      if (!(a in held)) throw new Error(`sim-loader: unknown action '${a}'`)
      held[a] = true
    }
    const pressed = noActions()
    const released = noActions()
    const repeat = noActions()
    for (const a of ACTIONS) {
      pressed[a] = held[a] && !prev[a]
      released[a] = !held[a] && prev[a]
      heldFor[a] = held[a] ? (heldFor[a] ?? 0) + 1 : 0
      // The contract's menu repeat: first after 20 ticks, then every 7.
      repeat[a] = pressed[a] || (heldFor[a] > 20 && (heldFor[a] - 21) % 7 === 0)
    }
    prev = held
    return {
      held,
      pressed,
      released,
      repeat,
      axisX: extra.axisX ?? (held.right ? 1 : 0) - (held.left ? 1 : 0),
      axisY: extra.axisY ?? (held.down ? 1 : 0) - (held.up ? 1 : 0),
      device: extra.device ?? 'keyboard',
    }
  }
}

/**
 * Step a world through a script: a list of [heldActions, ticks] pairs, or
 * [heldActions, ticks, { axisX, axisY }] for analog input.
 *
 * opts.input   an input builder to carry on from (default: a fresh one)
 * opts.each    called after every tick as each(world, tickIndex, events);
 *              return true to stop early
 * opts.keepEvents  leave world.events alone (default: drained every tick, as the play scene does)
 *
 * Returns { ticks, events, stopped }: ticks stepped, every event seen, and
 * whether opts.each stopped the run.
 */
export function runScript(stepWorld, world, script, opts = {}) {
  const frame = opts.input ?? makeInput()
  const events = []
  let ticks = 0
  for (const [held, count, extra] of script) {
    for (let i = 0; i < count; i++) {
      stepWorld(world, frame(held, extra))
      ticks++
      const seen = world.events.slice()
      for (const ev of seen) events.push(ev)
      if (!opts.keepEvents) world.events.length = 0
      if (opts.each && opts.each(world, ticks, seen) === true) return { ticks, events, stopped: true }
    }
  }
  return { ticks, events, stopped: false }
}

/**
 * Load the simulation. Returns:
 *   sim       game/sim/index.ts (createWorld, stepWorld, validateLevel, TUNING, the behaviour API ...)
 *   levels    game/levels/index.ts (LEVELS, RIVALS, sandboxLevel, levelById)
 *   contract  game/contract.ts
 *   input     makeInput (a new input builder each call)
 *   run       (world, script, opts) => runScript with this sim's stepWorld
 *   session   freshSession
 *   loadModule (path) => Promise of any other module of the game, through the same Vite server,
 *             so it is the very instance the simulation uses (its registries, its constants):
 *             'sim/entities/mudzilla.ts', 'render/entities/cars.ts', 'levels/dev/cars.ts' (inside
 *             the game folder), or '/src/features/it/maxx/...' from the repo root
 *   close     shut Vite down; call it or Node will not exit
 */
export async function loadSim() {
  const server = await createServer({
    root: REPO,
    configFile: false,
    logLevel: 'error',
    clearScreen: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    const loadModule = (path) => server.ssrLoadModule(moduleUrl(path))
    const contract = await loadModule('contract.ts')
    const sim = await loadModule('sim/index.ts')
    const levels = await loadModule('levels/index.ts')
    return {
      sim,
      levels,
      contract,
      input: makeInput,
      run: (world, script, opts) => runScript(sim.stepWorld, world, script, opts),
      session: freshSession,
      loadModule,
      close: () => server.close(),
    }
  } catch (err) {
    await server.close()
    throw err
  }
}
