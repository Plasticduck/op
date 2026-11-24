// MW07's skill token is a ride on a gust of the norther (levels/mw07.ts, LIFTS). The level tools
// leave wind out, so they can only say a late hover reaches it in still air, and the stored tokens
// run takes it that way. This plays the real simulation, wind and all: from the stored goal run,
// as Maxx first stands on lift K, every take-off over one whole trip of the lift, a run along it
// and a full jump with left held and never the hover. The lift and the gust keep the world's
// time, so any run that has not been down to the vault meets them as a player from the start or
// a retry does; a goal run made again by way of the vault would need another run to start from.
//
//   node scripts/maxx/tests/mw07-gust.mjs [--only text]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { suite } from '../lib/testkit.mjs'
import { copyWorld } from '../lib/reach.mjs'
import { frameFor, playReplay } from '../lib/solver.mjs'

const t = await suite('mw07-gust')
const { sim, levels, contract } = t
const { TILE } = contract
const L = 1
const J = 16
/** Lift K's trip, up, a wait at the top, down and a wait at the foot (props dy -5, speed 80, wait 60). */
const TRIP = 360
/** Ticks along the lift before the jump: from his place on it, 20 to 30 runs off its far edge. */
const RUNUPS = [20, 22, 24, 26, 28, 30]

const level = levels.LEVELS.find((l) => l.id === 'mw07')
const rep = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'replays', 'mw07-goal.json'), 'utf8'))
let onLift = null
let liftId = 0
playReplay(sim, level, rep, {
  each: (w) => {
    if (onLift) return
    const p = w.player
    const lift = p.ridingId ? w.entities.find((e) => e.id === p.ridingId) : null
    // Lift K climbs the cliff at column 195; lift J, under the gantry, runs sideways west of it.
    if (lift?.kind === 'lift' && lift.x > 190 * TILE && p.onGround) {
      onLift = copyWorld(w)
      liftId = lift.id
    }
  },
})

/** Every (wait, run-up) that takes token 3, over one trip of the lift. `still`: the norther stopped. */
function tries(still) {
  const wins = []
  const ride = copyWorld(onLift)
  let prev = 0
  for (let wait = 0; wait < TRIP; wait++) {
    if (wait > 0) {
      sim.stepWorld(ride, frameFor(prev, 0))
      ride.events.length = 0
      prev = 0
    }
    if (!(ride.player.ridingId === liftId && ride.player.onGround)) continue
    for (const runup of RUNUPS) {
      const w = copyWorld(ride)
      if (still) for (const e of w.entities) if (e.kind === 'blower' && e.props?.machine === false) e.vars.force = 0
      let pv = 0
      const step = (mask) => {
        sim.stepWorld(w, frameFor(pv, mask))
        w.events.length = 0
        pv = mask
      }
      for (let i = 0; i < runup; i++) step(L)
      for (let i = 0; i < 22; i++) step(L | J)
      for (let i = 0; i < 160 && w.status === 'play' && !w.stats.tokens[2]; i++) {
        step(L)
        // Down on the dock: short of the gantry.
        if (w.player.onGround && w.player.y > 9 * TILE) break
      }
      if (w.stats.tokens[2]) wins.push([wait, runup])
    }
  }
  return wins
}

t.test('the stored goal run stands on lift K (the place these tries start from)', () => {
  t.ok(onLift, 'mw07-goal.json never stands on lift K: the tries below have nowhere to start')
})

t.test('a plain running jump off lift K, carried by the gust, takes token 3, with half a second or more to choose from', () => {
  t.ok(onLift, 'no start')
  const wins = tries(false)
  t.ok(wins.length > 0, 'no plain jump off lift K takes token 3: the gust ride the level is built round does not work')
  // The longest run of waits in a row that work, any run-up: how long the player has to go.
  const waits = [...new Set(wins.map(([w]) => w))].sort((a, b) => a - b)
  let best = 0
  for (let i = 0, run = 0; i < waits.length; i++) {
    run = i > 0 && waits[i] === waits[i - 1] + 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  t.ok(best >= 30, `the gust ride works on only ${best} ticks in a row of the lift's trip (waits ${waits.join(' ')})`)
  t.notes.push(`gust ride: ${wins.length} of the tries take token 3; the longest window is ${best} ticks of the lift's ${TRIP}`)
})

t.test('in still air the same jumps all fall short: the gust is what carries them', () => {
  t.ok(onLift, 'no start')
  const wins = tries(true)
  t.ok(wins.length === 0, `${wins.length} plain jumps take token 3 with the norther stopped (first: wait ${wins[0]?.[0]}, run-up ${wins[0]?.[1]}): the token is not the gust's`)
})

await t.finish()
