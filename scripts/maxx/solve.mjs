// Plays a level to the end in the real simulation, with every car, critter, hazard and boss in
// it, the way a careful player on a controller would, and writes the run as a replay.
//
//   node scripts/maxx/solve.mjs <level> [--exit goal|secret] [--tokens] [--spotless] [--seed n]
//                               [--flags name=n,...] [--out file.json] [--budget seconds] [--allow-tight]
//                               [--verbose] [--debug]
//
//   <level>        a level id (sandbox, dev-cars, mw01 ...) or the path of a level's .ts file
//   --exit         leave by the goal (default) or the secret exit
//   --tokens       also take the three gold tokens, in whatever order is cheapest
//   --spotless     wash every car the level counts
//   --seed n       the world's random seed (default: the game's own, as the play scene uses)
//   --flags f      world flags to start with, as the play scene starts a visit: Rival Row is
//                  --flags rivalsBeaten=0 (or the count a returning player has). They travel in the
//                  replay, whose world hash records them, so its stored runs need it to match the
//                  play scene
//   --out f        where the replay goes (default: <temp>/maxx-<level>-<options>.replay.json)
//   --budget s     give up after this many seconds of thinking (default 900)
//   --allow-tight  may use a jump the reachability map measures at under 4 take-off ticks, or a
//                  pixel-exact one (found only by its lip sweep)
//   --verbose      every decision as it is made
//   --debug        and, where the first try failed, every try and how it ended
//
// Exit code: 0 the level was finished as asked; 1 it was not (the report says where and why);
// 2 a bad command line or a level that does not load. How it plays: lib/solver.mjs.
// Watch a replay: scripts/maxx/replay.mjs.
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadOne, openGame } from './level.mjs'
import { createSolver, formatResult, playReplay } from './lib/solver.mjs'
import { REPO } from './paths.mjs'

const USAGE = 'usage: node scripts/maxx/solve.mjs <level> [--exit goal|secret] [--tokens] [--spotless] [--seed n] [--flags name=n,...] [--out file.json] [--budget seconds] [--allow-tight] [--verbose] [--debug]'

/** 'rivalsBeaten=2,foo=1' -> { rivalsBeaten: 2, foo: 1 }, or null when it does not read. */
function parseFlags(text) {
  const out = {}
  for (const part of String(text).split(',')) {
    const m = /^\s*([A-Za-z_][\w:.]*)\s*=\s*(-?\d+)\s*$/.exec(part)
    if (!m) return null
    out[m[1]] = Number(m[2])
  }
  return out
}

function parseArgs(argv) {
  const pos = []
  const flags = {}
  const bare = new Set(['tokens', 'spotless', 'allow-tight', 'verbose', 'debug', 'help'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      pos.push(a)
      continue
    }
    const name = a.slice(2)
    if (bare.has(name)) flags[name] = true
    else flags[name] = argv[++i]
  }
  return { pos, flags }
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2))
  const which = pos[0]
  if (!which || flags.help) {
    console.error(USAGE)
    return 2
  }
  if (flags.exit !== undefined && flags.exit !== 'goal' && flags.exit !== 'secret') {
    console.error(`--exit takes goal or secret\n${USAGE}`)
    return 2
  }
  const seed = flags.seed === undefined ? null : Number(flags.seed)
  if (seed !== null && !Number.isInteger(seed)) {
    console.error(`--seed takes a whole number\n${USAGE}`)
    return 2
  }
  const startFlags = flags.flags === undefined ? null : parseFlags(flags.flags)
  if (flags.flags !== undefined && !startFlags) {
    console.error(`--flags takes name=number pairs, e.g. rivalsBeaten=0\n${USAGE}`)
    return 2
  }
  const budget = flags.budget === undefined ? 900 : Number(flags.budget)
  if (!(budget > 0)) {
    console.error(`--budget takes seconds\n${USAGE}`)
    return 2
  }
  const game = await openGame()
  try {
    let entry
    try {
      entry = await loadOne(game, which)
    } catch (err) {
      console.error(err.message)
      return 2
    }
    const level = entry.level
    const solver = createSolver(game.sim, game.contract, level, {
      exit: flags.exit ?? 'goal',
      tokens: !!flags.tokens,
      spotless: !!flags.spotless,
      seed,
      flags: startFlags,
      budget,
      allowTight: !!flags['allow-tight'],
      log: flags.verbose || flags.debug ? (l) => console.log(l) : null,
      debug: !!flags.debug,
    })
    const res = solver.solve()
    res.replay.file = entry.file ? path.relative(REPO, entry.file).split(path.sep).join('/') : null
    const check = playReplay(game.sim, level, res.replay)
    for (const l of formatResult(res)) console.log(l)
    if (startFlags) console.log(`  started with flags ${JSON.stringify(startFlags)}`)
    const tag = [flags.exit ?? 'goal', flags.tokens ? 'tokens' : '', flags.spotless ? 'spotless' : '', seed !== null ? `seed${seed}` : '', startFlags ? Object.entries(startFlags).map(([k, v]) => `${k}${v}`).join('-') : ''].filter(Boolean).join('-')
    const out = path.resolve(flags.out ?? path.join(os.tmpdir(), `maxx-${level.id}-${tag}.replay.json`))
    writeFileSync(out, JSON.stringify(res.replay, null, 1) + '\n')
    console.log(`  replay       ${out} (${res.replay.attempts.length} attempt${res.replay.attempts.length === 1 ? '' : 's'}; ${check.ok ? `replays to the same world, hash ${check.hash}` : 'DOES NOT REPLAY to the same world: a bug in the solver or the simulation'})`)
    if (!check.ok) return 1
    return res.ok ? 0 : 1
  } finally {
    await game.close()
  }
}

process.exitCode = await main().catch((err) => {
  console.error(err && err.stack ? err.stack : err)
  return 2
})
