// Check: what the solver plays in Node, the game plays the same in the browser. A --script for
// scripts/maxx/shot.mjs. It solves the level the page shows (the viewer scene's level= and
// params.seed), in Node, then replays that run on the page one tick at a time and compares the
// world hash with Node's every 300 ticks and at the end, photographing as it goes.
//
//   node scripts/maxx/serve.mjs --port 5382 -- node scripts/maxx/shot.mjs --port 5382 --w 1280 --h 900
//     --q "scene=viewer&level=sandbox&manual=1&fresh=1&params=%7B%22seed%22%3A49734321%7D"
//     --script scripts/maxx/checks/replay.mjs --out <dir>/end.png
//
// (49734321 is the world's default seed, the one solve.mjs and the play scene use.) Pictures
// and a contact sheet land next to --out. Throws, so shot.mjs fails, on any mismatch. The page
// runs with Chrome's own Math untouched: the simulation's trig is its own (sim/mathx.ts), so a
// run proven in Node must play to the bit in the browser as it is.
import { createSolver, formatResult } from '../lib/solver.mjs'
import { loadOne, openGame } from '../level.mjs'
import { playInPage } from '../replay.mjs'

const DEFAULT_SEED = 0x2f6e2b1

export default async function ({ page, outDir }) {
  const url = new URL(page.url())
  const id = url.searchParams.get('level') ?? 'sandbox'
  let seed = null
  try {
    const p = JSON.parse(url.searchParams.get('params') ?? '{}')
    if (typeof p.seed === 'number' && p.seed !== DEFAULT_SEED) seed = p.seed
    else if (typeof p.seed !== 'number') seed = 1
  } catch {
    seed = 1
  }
  if (url.searchParams.get('scene') !== 'viewer') throw new Error('open the viewer scene: --q "scene=viewer&level=<id>&manual=1&fresh=1&params={\\"seed\\":49734321}"')
  let failed = 0
  const check = (ok, what) => {
    console.log((ok ? '  ok    ' : '  FAIL  ') + what)
    if (!ok) failed++
  }
  const game = await openGame()
  try {
    const { level } = await loadOne(game, id)
    const t0 = performance.now()
    const res = createSolver(game.sim, game.contract, level, { seed }).solve()
    for (const l of formatResult(res)) console.log(`  | ${l}`)
    check(res.ok, `the solver finishes ${id} in Node (${res.ticks} ticks, ${((performance.now() - t0) / 1000).toFixed(1)} s)`)
    const native = await page.evaluate(() => ['sin', 'cos', 'hypot'].every((k) => /\[native code\]/.test(String(Math[k]))))
    check(native, "the page's Math.sin, cos and hypot are Chrome's own (nothing patched)")
    // Why that matters: the engines' own trig differs in the last bit now and then.
    const xs = Array.from({ length: 20000 }, (_, i) => (i - 10000) * 0.0137 + i * 1e-7)
    const theirs = await page.evaluate((xs) => xs.map((x) => [Math.sin(x), Math.cos(x)]), xs)
    const differ = xs.filter((x, i) => theirs[i][0] !== Math.sin(x) || theirs[i][1] !== Math.cos(x)).length
    console.log(`  info  Chrome's own Math.sin or cos differs from Node's on ${differ} of ${xs.length} inputs; the simulation uses neither`)
    const report = await playInPage(page, game.sim, level, res.replay, { every: 300, dir: outDir })
    check(report.mismatches.length === 0, `the page plays the ${res.ticks} ticks to the same world hash as Node${report.mismatches.length ? `: ${report.mismatches.slice(0, 3).join('; ')}` : ''}`)
    check(report.frames.length > 1, `${report.frames.length} pictures saved in ${outDir}`)
  } finally {
    await game.close()
  }
  if (failed) throw new Error(`${failed} replay check${failed === 1 ? '' : 's'} failed`)
}
