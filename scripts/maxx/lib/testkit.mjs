// A small test harness for simulation tests that live outside sim.mjs, one file per
// feature in scripts/maxx/tests/. Each file is a script of its own:
//
//   import { suite } from '../lib/testkit.mjs'
//   const t = await suite('blob')
//   t.test('a blob turns at a ledge', () => {
//     const w = t.flat(['  @   b'])            // rows above a 60-tile floor; '@' is Maxx
//     t.until(w, [], (w) => t.find(w, 'blob').facing === 1, 600)
//   })
//   await t.finish()                            // prints the tally, exits 1 on a failure
//
// Besides the helpers below, t carries sim, levels, contract and loadModule(path): any other
// module of the game through the same Vite server, the very instance the simulation uses
// (`const { MZ } = await t.loadModule('sim/entities/mudzilla.ts')`; paths inside the game
// folder, or '/src/features/it/maxx/...' from the repo root). No second server is needed.
//
// Run one with `node scripts/maxx/tests/blob.mjs`, all of them (and sim.mjs) with
// `node scripts/maxx/test.mjs`.
import { freshSession, loadSim, makeInput } from './sim-loader.mjs'

export async function suite(name) {
  const loaded = await loadSim()
  const { sim, contract } = loaded
  const { createWorld, stepWorld } = sim
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].toLowerCase() : null
  const results = []
  const notes = []

  function test(title, fn) {
    if (only && !title.toLowerCase().includes(only)) return
    try {
      fn()
      results.push({ title, ok: true })
      console.log(`PASS  ${name}: ${title}`)
    } catch (err) {
      results.push({ title, ok: false })
      console.log(`FAIL  ${name}: ${title}\n      ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 6).join('\n      ')}`)
    }
  }
  const ok = (cond, msg) => {
    if (!cond) throw new Error(msg)
  }
  const eq = (got, want, msg) => {
    if (got !== want) throw new Error(`${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
  const near = (got, want, tol, msg) => {
    if (!(Math.abs(got - want) <= tol)) throw new Error(`${msg}: got ${Math.round(got * 100) / 100}, want ${want} +/- ${tol}`)
  }

  /** A one-area level from rows (bottom rows last), padded to 12 rows and 24 columns. opts: id, time, legend, theme, areas. */
  function makeLevel(rows, opts = {}) {
    const width = Math.max(24, ...rows.map((r) => r.length))
    const padded = rows.map((r) => r.padEnd(width))
    while (padded.length < 12) padded.unshift(' '.repeat(width))
    return {
      id: opts.id ?? 'test',
      site: 'TEST',
      name: 'Test',
      time: opts.time ?? 300,
      music: 'sunny',
      areas: [{ id: 'main', theme: opts.theme ?? 'lot', rows: padded, legend: opts.legend }, ...(opts.areas ?? [])],
    }
  }
  /** opts as makeLevel, plus session (partial Session) and world (extra WorldOpts). */
  const makeWorld = (rows, opts = {}) => createWorld(makeLevel(rows, opts), { session: freshSession(opts.session), ...(opts.world ?? {}) })
  const FLOOR = '#'.repeat(60)
  /** Flat ground 60 tiles long. `above` are the rows over the floor; the last one is the row things stand in. */
  const flat = (above = ['  @'], opts = {}) => makeWorld([...above, FLOOR, FLOOR], opts)

  const find = (w, kind, variant) => w.entities.find((e) => e.kind === kind && !e.dead && (variant === undefined || e.variant === variant))
  const all = (w, kind) => w.entities.filter((e) => e.kind === kind && !e.dead)
  const has = (events, type, pred = () => true) => events.some((ev) => ev.type === type && pred(ev))

  /**
   * Step until pred(world) holds. `held` is the list of actions held. Returns the ticks taken,
   * or -1 when `max` ran out. Events are drained every tick; pass `sink` (an array) to keep them.
   */
  function until(w, held, pred, max = 600, input = makeInput(), sink = null) {
    for (let i = 1; i <= max; i++) {
      stepWorld(w, input(held))
      if (sink) for (const ev of w.events) sink.push(ev)
      w.events.length = 0
      if (pred(w)) return i
    }
    return -1
  }
  /** Step n ticks with these actions held; returns every event seen. */
  function steps(w, held, n, input = makeInput()) {
    const seen = []
    until(w, held, () => false, n, input, seen)
    return seen
  }
  /** Put Maxx's feet at a world position, at rest, and bring the camera along (sleeping things are not solid). */
  function place(w, feetX, feetY) {
    const p = w.player
    p.x = feetX - p.w / 2
    p.y = feetY - p.h
    p.vx = 0
    p.vy = 0
    w.camera.x = Math.max(0, Math.min(w.grid.w * contract.TILE - contract.VIEW_W, feetX - contract.VIEW_W / 2))
  }
  /** One droplet of spray straight onto an entity, through its behaviour. Returns what onSpray answered. */
  function spray(w, e, power = 1) {
    const b = sim.getBehavior(e.kind)
    return b && b.onSpray ? b.onSpray(e, w, { x: e.x + e.w / 2, y: e.y + e.h / 2, vx: 540, vy: 0, life: 10, power }) : false
  }

  async function finish() {
    await loaded.close()
    for (const n of notes) console.log(`  ${n}`)
    const failed = results.filter((r) => !r.ok)
    console.log(`${name}: ${results.length - failed.length} passed, ${failed.length} failed`)
    if (failed.length) process.exit(1)
  }

  return { ...loaded, name, test, ok, eq, near, makeLevel, makeWorld, flat, FLOOR, find, all, has, until, steps, place, spray, makeInput, freshSession, notes, finish }
}
