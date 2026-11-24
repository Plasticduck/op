// MW01's tokens run, scripts/maxx/replays/mw01-tokens.json: the solver, with the stage ride
// played by rule.
//
// Token 1 sits on the stage over the bay, and only the roof of the bay's compact, washed and
// ridden under the hatch, gets Maxx up there. The solver does not plan rides on cars ("the
// solver cannot ride car roofs yet"), so plain `solve.mjs mw01 --tokens` will not start. Here
// the solver plays as ever, and when Maxx stands on the bay floor with token 1 still out, the
// ride below plays until he is back on the ground with it (createSolver's `ride` option). The
// replay is an ordinary maxx-replay-1 that replay.mjs --verify and tests/solve.mjs check, with
// `ride.ticks` saying which ticks the ride played.
//
// After a change to MW01 or the simulation that stops the stored run replaying, make it again:
//
//   node scripts/maxx/rides/mw01-tokens.mjs --out scripts/maxx/replays/mw01-tokens.json [--verbose]
//
// It reads the stage (hatch, deck, right post, bay floor, token) off the level's rows, so it
// follows the stage if columns move; a stage built another way needs the ride changed.
// Exit 0 when the run takes all three tokens and replays to the same world.
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadOne, openGame } from '../level.mjs'
import { createSolver, formatResult, playReplay } from '../lib/solver.mjs'
import { REPO } from '../paths.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback)
const out = path.resolve(arg('--out', path.join(os.tmpdir(), 'maxx-mw01-tokens.replay.json')))
const verbose = argv.includes('--verbose')

/* ------------------------------------------------------------------ */
/* The stage ride, played by rule                                      */
/* ------------------------------------------------------------------ */

// Wash the bay's compact, get on its roof, ride it under the hatch, jump up through it, walk to
// the token, climb out over the right post. A closed loop on the real world: makeRide(sim,
// world, geom) returns step() -> the input mask for this tick, or null when it is done (back on
// the ground at rest with the token). Masks as the replay format has them.
const L = 1
const R = 2
const J = 16
const S = 32
const TILE = 32

/** Where things are, read off the level's rows: the deck is the first X=..=X run, the right post the X column at its far end. */
function stageGeom(level) {
  const area = level.areas[0]
  const rows = area.rows
  let deckRow = -1
  let hatchL = -1
  let hatchR = -1
  for (let y = 0; y < rows.length && deckRow < 0; y++) {
    const m = rows[y].match(/X(=+)X+/)
    if (m) {
      deckRow = y
      hatchL = m.index + 1
      hatchR = hatchL + m[1].length - 1
    }
  }
  if (deckRow < 0) throw new Error('no stage found')
  const tokenCol = [...rows[deckRow - 1]].findIndex((ch, x) => x > hatchR && area.legend[ch]?.kind === 'token')
  const postR = rows[deckRow].indexOf('X', hatchR + 1)
  let end = postR
  while (rows[deckRow][end + 1] === 'X') end++
  let postRow = deckRow
  while (postRow > 0 && rows[postRow - 1][end] === 'X') postRow--
  // The bay is dug a tile below the lot: its floor is the first ground under the hatch.
  let bayRow = deckRow + 1
  while (bayRow < rows.length && rows[bayRow][hatchL] !== '#') bayRow++
  return { deckRow, hatchL, hatchR, tokenCol, postL: hatchL - 1, postR: end, deckY: deckRow * TILE, postTop: postRow * TILE, bayFloor: bayRow * TILE }
}

function makeRide(sim, w, g, log = () => {}) {
  const p = w.player
  let phase = 'wash'
  let t = 0
  let phaseT = 0
  let hold = 0
  const car = () => w.entities.find((e) => e.kind === 'car' && !e.dead && Math.abs(e.x - g.hatchL * TILE) < 16 * TILE && e.y > g.deckY)
  const cx = () => p.x + p.w / 2
  const go = (next) => {
    log(`  ride t+${t} ${phase} -> ${next}  maxx ${(cx() / TILE).toFixed(2)},${((p.y + p.h) / TILE).toFixed(2)}`)
    phase = next
    phaseT = 0
  }
  const hatchX0 = g.hatchL * TILE
  const hatchX1 = (g.hatchR + 1) * TILE
  return function step() {
    t++
    phaseT++
    if (t > 60 * 90) throw new Error(`ride: stuck in phase ${phase}`)
    const c = car()
    const onDeck = p.onGround && Math.abs(p.y + p.h - g.deckY) < 1
    if (phase === 'wash') {
      if (!c) throw new Error('ride: no car in the bay')
      if (c.state === 'clean') {
        go('mount')
        return 0
      }
      // face it, keep three tiles off, spray
      const d = c.x + c.w / 2 - cx()
      const dir = d > 0 ? R : L
      const near = Math.abs(d) < 3 * TILE
      const away = d > 0 ? L : R
      if (p.facing !== (d > 0 ? 1 : -1)) return dir
      return (near ? away : 0) | S
    }
    if (phase === 'mount') {
      if (!c) throw new Error('ride: the car is gone')
      if (p.onGround && p.ridingId === c.id) {
        go('ride')
        return 0
      }
      const roof = c.x + c.w / 2 + (c.facing > 0 ? -6 : 6)
      const d = roof - cx()
      if (!p.onGround) return hold-- > 0 ? J | (Math.abs(d) > 4 ? (d > 0 ? R : L) : 0) : Math.abs(d) > 4 ? (d > 0 ? R : L) : 0
      if (Math.abs(d) < 14) {
        hold = 9
        return J
      }
      return d > 0 ? R : L
    }
    if (phase === 'ride') {
      if (!c) throw new Error('ride: the car is gone')
      if (!(p.onGround && p.ridingId === c.id)) {
        if (p.onGround) go('mount')
        return 0
      }
      // keep to the flat of the roof
      const roof = c.x + c.w / 2 + (c.facing > 0 ? -6 : 6)
      const d = roof - cx()
      if (p.x >= hatchX0 + 3 && p.x + p.w <= hatchX1 - 3 && Math.abs(d) < 12) {
        go('up')
        hold = 40
        return J
      }
      return Math.abs(d) > 6 ? (d > 0 ? R : L) : 0
    }
    if (phase === 'up') {
      if (onDeck) {
        go('token')
        return 0
      }
      if (p.onGround && phaseT > 3) {
        // came down on the roof or the floor again: try again
        go(p.ridingId === (c?.id ?? -1) ? 'ride' : 'mount')
        return 0
      }
      return hold-- > 0 ? J : 0
    }
    if (phase === 'token') {
      if (w.stats.tokens[0]) {
        go('out')
        return 0
      }
      return R
    }
    if (phase === 'out') {
      // over the right post (two tiles over the deck) in one jump, or onto it and off its far side
      const postTop = g.postTop
      const onPost = p.onGround && Math.abs(p.y + p.h - postTop) < 1
      if (onPost) {
        go('down')
        return R
      }
      if (p.onGround && p.y + p.h > g.deckY + 8) return Math.abs(p.vx) < 1 && phaseT > 5 ? null : 0
      if (!p.onGround) return hold-- > 0 ? J | R : R
      // stand a tile and a half before the post, then jump at it
      const want = g.postR * TILE - 30
      if (cx() < want - 4) return R
      if (cx() > want + 4) return L
      hold = 16
      return J | R
    }
    if (phase === 'down') {
      if (p.onGround && p.y + p.h > g.deckY + TILE && Math.abs(p.vx) < 1 && phaseT > 5) return null
      const postTop = g.postTop
      const onPost = p.onGround && Math.abs(p.y + p.h - postTop) < 1
      return onPost ? R : 0
    }
    return null
  }
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

const game = await openGame()
let code = 1
try {
  const entry = await loadOne(game, 'mw01')
  const level = entry.level
  const g = stageGeom(level)
  const rides = []
  const pipeCol = level.areas[0].rows[g.deckRow + 3].indexOf('P')
  const ride = (w, tick) => {
    const p = w.player
    if (w.area.id !== 'main' || !p.onGround) return null
    const x = p.x + p.w / 2
    // Only from the bay floor, between the step down and the pipe.
    if (Math.abs(p.y + p.h - g.bayFloor) > 1 || x < (g.postL - 2) * TILE || x > pipeCol * TILE) return null
    const step = makeRide(game.sim, w, g, verbose ? console.log : () => {})
    const rec = { from: tick, to: null }
    rides.push(rec)
    let t = tick
    return {
      why: 'the stage ride: wash the compact, ride its roof, up through the hatch (scripts/maxx/rides/mw01-tokens.mjs)',
      done: false,
      input() {
        const m = step()
        if (m === null) rec.to = t
        t++
        return m
      },
      after() {},
    }
  }
  const solver = createSolver(game.sim, game.contract, level, {
    exit: 'goal',
    tokens: true,
    seed: null,
    budget: 900,
    log: verbose ? (l) => console.log(l) : null,
    ride,
  })
  const res = solver.solve()
  res.replay.file = entry.file ? path.relative(REPO, entry.file).split(path.sep).join('/') : null
  res.replay.ride = { ticks: rides.map((r) => [r.from, r.to]), note: 'between these ticks the input is the stage ride of scripts/maxx/rides/mw01-tokens.mjs (the solver does not plan car roofs); every other tick is the solver' }
  const check = playReplay(game.sim, level, res.replay)
  for (const l of formatResult(res)) console.log(l)
  for (const r of rides) console.log(`  ride         ticks ${r.from} to ${r.to} (${r.to === null ? 'never finished' : `${((r.to - r.from) / 60).toFixed(1)} s`}) played by the stage ride`)
  writeFileSync(out, JSON.stringify(res.replay, null, 1) + '\n')
  console.log(`  replay       ${out} (${res.replay.attempts.length} attempt${res.replay.attempts.length === 1 ? '' : 's'}; ${check.ok ? `replays to the same world, hash ${check.hash}` : 'DOES NOT REPLAY to the same world'})`)
  code = check.ok && res.ok && res.tokens.every(Boolean) ? 0 : 1
} finally {
  await game.close()
}
process.exitCode = code
