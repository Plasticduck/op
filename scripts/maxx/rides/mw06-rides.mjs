// MW06's rides, scripts/maxx/replays/mw06-rides.json: a hand-scripted player (not the solver)
// washes and rides the cars of ditches 2 and 3 in the real level, and the run is written as a
// replay (maxx-replay-1) that replay.mjs --verify and tests/solve.mjs play back. The solver does
// not plan rides on cars, and these rides are off its route, so nothing else proves them in play.
//
// Attempt 1: from the checkpoint: into the bay of ditch 2, wash the sedan, ride its roof to the
//            garage, take the 1UP, climb out onto the far rim.
// Attempt 2: from the rim of ditch 3 (as from a checkpoint there): into the bay, wash the sports
//            car, ride its roof to the far deck, climb out, run to the goal.
//
// After a change to MW06 or the simulation that stops the stored run replaying, make it again:
//
//   node scripts/maxx/rides/mw06-rides.mjs --out scripts/maxx/replays/mw06-rides.json [--verbose]
//
// It reads the ditches off the level's rows ('k', 'e', 'q', '^', the decks), so it follows them
// if columns move. Exit 0 only if both rides are made without a hit and the second ends in a
// clear; the file is written only then.
import fs from 'node:fs'
import { loadSim } from '../lib/sim-loader.mjs'
import { MARK_EVERY, REPLAY_FORMAT, encodeInput, frameFor, playReplay } from '../lib/solver.mjs'
import { GAME_REL } from '../paths.mjs'

const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt)
const outFile = arg('--out', null)
const verbose = process.argv.includes('--verbose')
const T = 32
const BIT = { left: 1, right: 2, up: 4, down: 8, jump: 16, spray: 32 }

const { sim, session, levels, close } = await loadSim()
const level = levels.levelById('mw06')
const rows = level.areas[0].rows
// The layout, read off the level itself so this follows it when columns move.
const colOf = (row, ch, from = 0) => rows[row].indexOf(ch, from)
const cp = colOf(9, 'k')
const D2 = { bay0: rows[12].indexOf(' ', cp), carCh: 'e' }
D2.spike0 = rows[12].indexOf('^', D2.bay0)
D2.car = colOf(12, 'e')
D2.apron0 = rows[12].indexOf(' ', D2.car)
D2.deck = rows[10].indexOf('#', D2.apron0)
const D3 = {}
D3.spawner = colOf(12, 'q')
D3.bay0 = rows[12].indexOf(' ', D3.spawner)
D3.spike0 = rows[12].indexOf('^', D3.bay0)
D3.apron0 = rows[12].indexOf(' ', D3.spike0)
D3.deck = rows[10].indexOf('#', D3.apron0)
const goalCol = colOf(9, 'G')
console.log('layout', { cp, D2, D3, goalCol })

function play(name, start, plan) {
  const sess = session()
  const w = sim.createWorld(level, { session: { ...sess }, checkpoint: { areaId: 'main', x: start.col * T + 16, y: 10 * T } })
  const p = w.player
  const masks = []
  const marks = []
  let prev = 0
  let phase = 'walk'
  let last = ''
  let hits = 0
  let rideStart = -1
  let doneAt = -1
  let stall = 0
  const st = { tookLoot: false }
  const cars = () => w.entities.filter((e) => e.kind === 'car' && !e.dead && e.y > 10 * T && e.x > (plan.bay0 - 1) * T && e.x < (plan.deck + 9) * T)
  for (let t = 0; t < 7200; t++) {
    const px = p.x + p.w / 2
    const feet = p.y + p.h
    const list = cars()
    const dirty = list.find((e) => e.state !== 'clean')
    const clean = list.find((e) => e.state === 'clean')
    let held = []
    const standAt = (plan.bay0 + plan.stand) * T
    if (phase === 'walk') {
      held = ['right']
      if (p.onGround && feet > 12.9 * T) phase = 'wash'
    } else if (phase === 'wash') {
      if (px < standAt - 4) held = ['right']
      else if (px > standAt + 4) held = ['left']
      if (dirty) {
        const dx = dirty.x + dirty.w / 2 - px
        if (Math.abs(dx) < 300) {
          held = (dx > 0) === p.facing > 0 ? ['spray'] : [dx > 0 ? 'right' : 'left', 'spray']
          // too close and still dirty: hop it
          if (Math.abs(dx) < 70 && p.onGround) held = ['jump']
        }
      }
      if (!p.onGround && p.vy < 0) held = ['jump']
      if (clean && !dirty) phase = 'wait'
    } else if (phase === 'wait') {
      if (clean) {
        // hop on as it comes by, whichever way it is heading: it turns at the bay wall with him on it
        const v = clean.vx / 60
        const mid = clean.x + clean.w / 2 + v * 16
        if (Math.abs(mid - px) < 26 && p.onGround) {
          held = ['jump']
          phase = 'hop'
        }
      } else phase = 'wash'
    } else if (phase === 'hop') {
      held = p.vy < -150 ? ['jump'] : []
      if (clean) {
        const mid = clean.x + clean.w / 2 + (clean.vx / 60) * 5
        if (px < mid - 5) held.push('right')
        else if (px > mid + 5) held.push('left')
      }
      if (p.onGround && p.ridingId) {
        phase = 'ride'
        if (rideStart < 0) rideStart = t
      } else if (p.onGround) phase = 'wait'
    } else if (phase === 'ride') {
      // stay near the middle of the roof
      if (clean && p.ridingId === clean.id) {
        const mid = clean.x + clean.w / 2
        if (px < mid - 12) held = ['right']
        else if (px > mid + 12) held = ['left']
      }
      if (!p.ridingId && p.onGround) phase = feet > 12.9 * T ? (plan.loot && !st.tookLoot ? 'loot' : 'climb') : 'done'
    } else if (phase === 'loot') {
      // into the garage for the 1UP, then back out
      held = ['right']
      if (px > (plan.deck + 2.4) * T) st.tookLoot = true
      if (st.tookLoot) phase = 'climb'
    } else if (phase === 'climb') {
      const spot = (plan.deck - 1.0) * T
      held = px < spot - 3 ? ['right'] : px > spot + 3 ? ['left'] : []
      if (p.onGround && Math.abs(px - spot) <= 3 && Math.abs(p.vx) < 1) phase = 'up'
    } else if (phase === 'up') {
      held = ['jump']
      if (feet < 10 * T - 2) held.push('right')
      if (p.onGround && feet <= 10 * T + 1 && px > plan.deck * T) phase = plan.toGoal ? 'run' : 'done'
      if (p.onGround && feet > 12.9 * T && ++stall % 50 === 0) held = []
    } else if (phase === 'run') {
      held = ['right']
    } else if (phase === 'done') {
      if (doneAt < 0) doneAt = t
    }
    // A swarm close by: turn the water on it (up if it is overhead) unless he is in the middle of a jump or a climb.
    if (['wash', 'wait', 'ride', 'loot', 'done'].includes(phase)) {
      const bug = w.entities.find((e) => e.kind === 'bugs' && !e.dead && e.state !== 'scatter' && Math.abs(e.x + e.w / 2 - px) < 150 && Math.abs(e.y + e.h / 2 - (feet - 30)) < 150)
      if (bug && !(phase === 'wash' && dirty && Math.abs(dirty.x - px) < 260)) {
        const dx = bug.x + bug.w / 2 - px
        const above = feet - 30 - (bug.y + bug.h / 2) > 40
        held = (dx > 0) === p.facing > 0 ? ['spray'] : [dx > 0 ? 'right' : 'left', 'spray']
        if (above) held.push('up')
      }
    }
    let mask = 0
    for (const a of held) mask |= BIT[a]
    const pips = p.pips
    sim.stepWorld(w, frameFor(prev, mask))
    w.events.length = 0
    prev = mask & 63
    masks.push(mask)
    if (masks.length % MARK_EVERY === 0) marks.push([masks.length, sim.worldHash(w)])
    if (p.pips < pips) {
      hits++
      console.log(String(t).padStart(5), `HIT (pips ${p.pips}) at ${(px / T).toFixed(1)}`)
    }
    if (phase !== last || (verbose && t % 30 === 0)) console.log(String(t).padStart(5), `${name} ${phase.padEnd(5)} maxx ${(px / T).toFixed(1)},${(feet / T).toFixed(2)} ride=${p.ridingId} cars=[${list.map((e) => `${e.variant[0]}@${(e.x / T).toFixed(1)} ${e.state}${e.facing > 0 ? '>' : '<'}`).join(' ')}]`)
    last = phase
    if (w.status !== 'play') {
      console.log(String(t).padStart(5), `${name} status ${w.status} exit ${w.exit}`)
      // a little of the victory walk, so the picture shows it
      for (let k = 0; k < 40; k++) {
        sim.stepWorld(w, frameFor(prev, 0))
        w.events.length = 0
        prev = 0
        masks.push(0)
        if (masks.length % MARK_EVERY === 0) marks.push([masks.length, sim.worldHash(w)])
      }
      break
    }
    if (doneAt >= 0 && t > doneAt + 90) break
  }
  const ok = hits === 0 && rideStart >= 0 && (plan.toGoal ? w.status === 'clear' : doneAt >= 0 && p.y + p.h <= 10 * T + 1)
  console.log(`${ok ? 'OK' : 'FAILED'}: ${name}: ${masks.length} ticks, hits ${hits}, ride began at tick ${rideStart}, status ${w.status}, lives ${w.session.lives}, coins ${w.stats.coins}, cars washed ${w.stats.carsWashed}/${w.stats.carsTotal}`)
  return {
    ok,
    hits,
    w,
    attempt: {
      session: sess,
      checkpoint: { areaId: 'main', x: start.col * T + 16, y: 10 * T },
      flags: null,
      tokens: null,
      ticks: masks.length,
      input: encodeInput(masks),
      marks,
      end: { status: w.status, exit: w.exit, hash: sim.worldHash(w), tick: masks.length },
    },
  }
}

const a = play('ditch2', { col: cp }, { bay0: D2.bay0, stand: 3.3, deck: D2.deck, loot: true, toGoal: false })
const b = play('ditch3', { col: D3.bay0 - 4 }, { bay0: D3.bay0, stand: 6.3, deck: D3.deck, loot: false, toGoal: true })
const rep = {
  format: REPLAY_FORMAT,
  level: level.id,
  file: `${GAME_REL}/game/levels/mw06.ts`,
  seed: null,
  note: 'Not a solver run: a hand-scripted player rides the washed cars of ditches 2 and 3 (scripts/maxx/rides/mw06-rides.mjs). Attempt 1 starts at the checkpoint, attempt 2 at the rim of ditch 3.',
  options: { exit: 'goal', tokens: false, spotless: false, allowTight: false },
  attempts: [a.attempt, b.attempt],
  result: { ok: a.ok && b.ok, status: b.w.status, exit: b.w.exit, hash: sim.worldHash(b.w), ticks: a.attempt.ticks + b.attempt.ticks, hits: a.hits + b.hits, livesLost: 0, carsWashed: b.w.stats.carsWashed, carsTotal: b.w.stats.carsTotal, tokens: [false, false, false], score: b.w.stats.score },
}
const back = playReplay(sim, level, rep)
console.log(`replays to the same world: ${back.ok}`)
if (outFile && a.ok && b.ok && back.ok) {
  fs.writeFileSync(outFile, JSON.stringify(rep, null, 1))
  console.log('wrote', outFile)
}
await close()
process.exit(a.ok && b.ok && back.ok ? 0 : 1)
