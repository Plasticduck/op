// Self-test of the Super Mighty Maxx simulation.   node scripts/maxx/sim.mjs
// Prints PASS/FAIL per test and the measured feel numbers; exits non-zero on
// any failure. `--only <text>` runs the tests whose name contains the text. `--ledges` adds the
// table of the widest gaps onto ledges up to 4 tiles up or down (about 15 s; NOTES.md section 5).
import fs from 'node:fs'
import path from 'node:path'
import { ACTIONS, freshSession, loadSim, makeInput } from './lib/sim-loader.mjs'
import { ASSETS_DIR, GAME_DIR, REPO } from './paths.mjs'
import { Canvas } from './pix.mjs'

const { sim, levels, contract, run, loadModule, close } = await loadSim()
const { createWorld, stepWorld, validateLevel, worldHash, TUNING } = sim
const saveModule = await loadModule('engine/save.ts')
const { TILE, MAXX_W, MAXX_H, VIEW_W, VIEW_H } = contract

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const results = []
const notes = []

function test(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return
  try {
    fn()
    results.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (err) {
    results.push({ name, ok: false })
    console.log(`FAIL  ${name}\n      ${String(err && err.message ? err.message : err).split('\n').join('\n      ')}`)
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg)
}
function eq(got, want, msg) {
  if (got !== want) throw new Error(`${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
function near(got, want, tol, msg) {
  if (!(Math.abs(got - want) <= tol)) throw new Error(`${msg}: got ${round(got)}, want ${want} +/- ${tol}`)
}
const round = (n) => Math.round(n * 100) / 100
const tiles = (px) => round(px / TILE)

/** A one-area level from rows (bottom rows last). Padded to 12 rows and 24 columns. */
function makeLevel(rows, opts = {}) {
  const width = Math.max(24, ...rows.map((r) => r.length))
  const padded = rows.map((r) => r.padEnd(width))
  while (padded.length < 12) padded.unshift(' '.repeat(width))
  return {
    id: 'test',
    site: 'TEST',
    name: 'Test',
    time: opts.time ?? 300,
    music: 'sunny',
    areas: [{ id: 'main', theme: 'lot', rows: padded, legend: opts.legend }, ...(opts.areas ?? [])],
  }
}

function makeWorld(rows, opts = {}) {
  return createWorld(makeLevel(rows, opts), { session: freshSession(opts.session), ...(opts.world ?? {}) })
}

const FLOOR = '#'.repeat(60)
/** Flat ground with Maxx on it. `above` are rows drawn over the floor (last one is the row he stands in). */
function flat(above = ['  @'], opts = {}) {
  return makeWorld([...above, FLOOR, FLOOR], opts)
}

const char = (w, tx, ty) => sim.tileAt(w, tx, ty)
const find = (w, kind) => w.entities.find((e) => e.kind === kind && !e.dead)
const all = (w, kind) => w.entities.filter((e) => e.kind === kind && !e.dead)
const has = (events, type, pred = () => true) => events.some((ev) => ev.type === type && pred(ev))
const sfx = (events, id) => has(events, 'sfx', (ev) => ev.id === id)
const feet = (w) => w.player.y + w.player.h

/** Step until `pred(world)` holds. Returns the ticks taken, or -1 if `max` ran out. */
function until(w, held, pred, max = 600, input = makeInput(), sink = null) {
  for (let i = 1; i <= max; i++) {
    stepWorld(w, input(held))
    if (sink) for (const ev of w.events) sink.push(ev)
    w.events.length = 0
    if (pred(w)) return i
  }
  return -1
}

/** Let him settle on the ground. */
function settle(w, input = makeInput()) {
  const n = until(w, [], (x) => x.player.onGround, 120, input)
  ok(n >= 0, 'Maxx never landed')
  return input
}

/* ------------------------------------------------------------------ */
/* Measurements                                                        */
/* ------------------------------------------------------------------ */

/**
 * One jump on flat ground. `hold` = ticks the jump button is held; `runUp` =
 * ticks of running right first; `hover` = hold down + spray once falling.
 */
function measureJump({ hold, runUp = 0, hover = false, floorRow = FLOOR }) {
  const w = makeWorld(['  @', floorRow, FLOOR])
  const input = settle(w)
  const move = runUp > 0 ? ['right'] : []
  for (let i = 0; i < runUp; i++) stepWorld(w, input(move))
  const p = w.player
  const x0 = p.x
  const y0 = p.y
  let top = y0
  let air = 0
  let hoverTicks = 0
  for (let i = 0; i < 400; i++) {
    const held = [...move]
    if (i < hold) held.push('jump')
    if (hover && p.vy > 0) held.push('down', 'spray')
    stepWorld(w, input(held))
    w.events.length = 0
    if (p.hovering) hoverTicks++
    if (p.y < top) top = p.y
    if (i > 0 && p.onGround) break
    air++
  }
  return { apex: y0 - top, length: p.x - x0, air, hoverTicks, speed: Math.abs(p.vx) }
}

const m = {}
m.tap = measureJump({ hold: 1 })
m.full = measureJump({ hold: 60 })
m.runFull = measureJump({ hold: 60, runUp: 40 })
m.runTap = measureJump({ hold: 1, runUp: 40 })
m.standing = (() => {
  // From a standstill: jump and push right on the same tick.
  const w = flat()
  const input = settle(w)
  const p = w.player
  const x0 = p.x
  for (let i = 0; i < 400; i++) {
    stepWorld(w, input(['right', 'jump']))
    if (i > 0 && p.onGround) break
  }
  return p.x - x0
})()
m.hover = measureJump({ hold: 60, runUp: 40, hover: true })
m.mud = measureJump({ hold: 60, floorRow: 'M'.repeat(60) })
m.mudRun = measureJump({ hold: 60, runUp: 40, floorRow: 'M'.repeat(60) })
m.toTop = (() => {
  const w = flat()
  const input = settle(w)
  return until(w, ['right'], (x) => x.player.vx >= TUNING.runSpeed, 200, input)
})()
function stopping(floorRow) {
  const w = makeWorld(['  @', floorRow, FLOOR])
  const input = settle(w)
  until(w, ['right'], (x) => x.player.vx >= TUNING.runSpeed, 900, input)
  const x0 = w.player.x
  const ticks = until(w, [], (x) => x.player.vx === 0, 2000, input)
  return { dist: w.player.x - x0, ticks }
}
m.stop = stopping(FLOOR)
m.stopSlick = stopping('I'.repeat(60))
m.stopOil = stopping('O'.repeat(60))
m.skid = (() => {
  const w = flat()
  const input = settle(w)
  until(w, ['right'], (x) => x.player.vx >= TUNING.runSpeed, 200, input)
  const x0 = w.player.x
  const ticks = until(w, ['left'], (x) => x.player.vx <= 0, 200, input)
  return { dist: w.player.x - x0, ticks }
})()
m.reach = (() => {
  // How far the water gets on flat ground, standing still.
  const w = flat()
  const input = settle(w)
  let far = 0
  for (let i = 0; i < 60; i++) {
    stepWorld(w, input(['spray']))
    for (const d of w.droplets) far = Math.max(far, d.x - (w.player.x + w.player.w / 2 + contract.MUZZLE.fwd.x))
  }
  return far
})()

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

test('tap jump is a short hop, full jump is about 4.2 tiles', () => {
  ok(m.tap.apex > TILE * 1.2 && m.tap.apex < TILE * 2.2, `tap apex ${tiles(m.tap.apex)} tiles, want 1.2 to 2.2`)
  near(m.full.apex / TILE, 4.2, 0.15, 'full jump apex in tiles')
  ok(m.full.apex > m.tap.apex * 2, 'holding jump should more than double the height')
})

test('full running jump is about 5.5 tiles long; a 3-tile wall and a 5-tile pit are within reach', () => {
  near(m.runFull.length / TILE, 5.5, 0.2, 'running jump length in tiles')
  ok(m.full.apex > 3 * TILE + 8, `apex ${round(m.full.apex)} px does not clear a 3-tile wall`)
  ok(m.standing > 4 * TILE, `standing jump ${round(m.standing)} px does not clear a 4-tile pit`)
})

test('a 4-tile pit is jumpable from a standstill and a 5-tile pit with a run', () => {
  // Start two tiles back from the edge, jump as he passes it.
  const pit = (gap, runway) => {
    const row = '#'.repeat(runway) + ' '.repeat(gap) + '#'.repeat(30)
    const w = makeWorld([' '.repeat(runway - 2) + '@', row, row])
    const input = settle(w)
    const edge = runway * TILE
    until(w, ['right'], (x) => x.player.x + x.player.w / 2 >= edge - 6, 400, input)
    until(w, ['right', 'jump'], (x) => x.player.onGround || x.status !== 'play', 400, input)
    return w
  }
  let w = pit(4, 3)
  ok(w.status === 'play' && w.player.x > 7 * TILE - MAXX_W, '4-tile pit with a 2-tile run-up was not cleared')
  w = pit(5, 12)
  ok(w.status === 'play' && w.player.x > 17 * TILE - MAXX_W, '5-tile pit with a long run-up was not cleared')
})

test('analog stick scales top speed, never below 40%', () => {
  for (const [axis, share] of [[1, 1], [0.5, 0.5], [0.2, 0.4], [-0.75, 0.75]]) {
    const w = flat(['          @'])
    const input = settle(w)
    for (let i = 0; i < 90; i++) stepWorld(w, input([], { axisX: axis }))
    near(Math.abs(w.player.vx), TUNING.runSpeed * share, 0.01, `top speed at stick ${axis}`)
    eq(w.player.facing, axis > 0 ? 1 : -1, `facing at stick ${axis}`)
  }
})

test('run: reaches top speed, stops short, skids on a turn', () => {
  ok(m.toTop >= 8 && m.toTop <= 16, `${m.toTop} ticks to top speed, want 8 to 16`)
  ok(m.stop.dist > 8 && m.stop.dist < 28, `stopping distance ${round(m.stop.dist)} px, want 8 to 28`)
  const w = flat()
  const input = settle(w)
  until(w, ['right'], (x) => x.player.vx >= TUNING.runSpeed, 200, input)
  const events = []
  stepWorld(w, input(['left']))
  events.push(...w.events)
  ok(w.player.skidding, 'not skidding on the turn-around')
  ok(sfx(events, 'skid'), "no 'skid' sound")
  eq(w.player.facing, -1, 'faces the way the stick points while skidding')
})

test('coyote time: a jump still works a few ticks after running off a ledge', () => {
  const tryJump = (late) => {
    const row = '#'.repeat(10) + ' '.repeat(40)
    const w = makeWorld(['       @', row, ' '.repeat(50), ' '.repeat(50), ' '.repeat(50), FLOOR])
    const input = settle(w)
    until(w, ['right'], (x) => !x.player.onGround, 300, input)
    // The tick above was airborne tick 1.
    for (let i = 1; i < late; i++) stepWorld(w, input(['right']))
    const vyBefore = w.player.vy
    stepWorld(w, input(['right', 'jump']))
    return { jumped: w.player.vy < -300, vyBefore }
  }
  ok(tryJump(1).jumped, 'no jump 1 tick after the ledge')
  ok(tryJump(TUNING.coyoteTicks).jumped, `no jump ${TUNING.coyoteTicks} ticks after the ledge`)
  ok(!tryJump(TUNING.coyoteTicks + 2).jumped, `jumped ${TUNING.coyoteTicks + 2} ticks after the ledge: coyote time too long`)
  notes.push(`coyote: a jump works up to ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => tryJump(n).jumped).pop()} ticks after leaving a ledge`)
})

test('jump buffer: a press just before landing jumps on landing', () => {
  // Fall from a ledge, press jump `early` ticks before the tick a grounded jump could first happen.
  const drop = (early) => {
    const row = '#'.repeat(6) + ' '.repeat(44)
    const mk = () => makeWorld(['    @', row, ' '.repeat(50), ' '.repeat(50), ' '.repeat(50), ' '.repeat(50), FLOOR])
    let w = mk()
    let input = settle(w)
    until(w, ['right'], (x) => !x.player.onGround, 300, input)
    const fallTicks = until(w, [], (x) => x.player.onGround, 300, input)
    w = mk()
    input = settle(w)
    until(w, ['right'], (x) => !x.player.onGround, 300, input)
    let jumped = false
    for (let i = 1; i <= fallTicks + 12; i++) {
      // Landing completes on tick fallTicks, so tick fallTicks + 1 is the first that can jump.
      const press = i === fallTicks + 1 - early
      stepWorld(w, input(press ? ['jump'] : []))
      if (i > fallTicks && w.player.vy < -300) jumped = true
    }
    return jumped
  }
  ok(drop(0), 'a press on the landing tick itself did not jump')
  ok(drop(3), 'a press 3 ticks early did not jump')
  ok(drop(TUNING.jumpBufferTicks), `a press ${TUNING.jumpBufferTicks} ticks early did not jump`)
  ok(!drop(TUNING.jumpBufferTicks + 2), `a press ${TUNING.jumpBufferTicks + 2} ticks early still jumped: buffer too long`)
  notes.push(`jump buffer: a press up to ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((n) => drop(n)).pop()} ticks before landing still jumps`)
})

test('holding jump does not jump again on landing', () => {
  const w = flat()
  const input = settle(w)
  let jumps = 0
  for (let i = 0; i < 200; i++) {
    stepWorld(w, input(['jump']))
    if (sfx(w.events, 'jump')) jumps++
    w.events.length = 0
  }
  eq(jumps, 1, 'jumps while the button stayed down')
})

test('walls stop him flush, and he cannot leave the area sideways', () => {
  const w = makeWorld(['  @      X', '         X', FLOOR, FLOOR])
  const input = settle(w)
  until(w, ['right'], (x) => x.player.hitWall === 1, 300, input)
  eq(w.player.x, 9 * TILE - MAXX_W, 'x against the wall')
  eq(w.player.vx, 0, 'vx against the wall')
  for (let i = 0; i < 30; i++) stepWorld(w, input(['right']))
  eq(w.player.x, 9 * TILE - MAXX_W, 'x after pushing on the wall')
  until(w, ['left'], (x) => x.player.hitWall === -1, 300, input)
  eq(w.player.x, 0, 'x at the left edge of the area')
})

test('ceilings stop a jump and bump', () => {
  const w = makeWorld(['XXXXXXXXXX', '', '', '  @', FLOOR, FLOOR])
  const input = settle(w)
  const ceiling = (12 - 6 + 1) * TILE
  let top = Infinity
  let hit = false
  const events = []
  for (let i = 0; i < 60; i++) {
    stepWorld(w, input(['jump']))
    events.push(...w.events)
    w.events.length = 0
    top = Math.min(top, w.player.y)
    if (w.player.hitCeil) hit = true
  }
  eq(top, ceiling, 'highest point is the underside of the ceiling')
  ok(hit, 'hitCeil never set')
  ok(sfx(events, 'bump'), "no 'bump' sound")
  ok(w.player.onGround, 'did not come back down')
})

test('a clipped block corner lets him slip past; a square hit does not', () => {
  const tryAt = (offset) => {
    const w = makeWorld(['     X', '', '', '', FLOOR, FLOOR])
    w.player.x = 6 * TILE - offset
    w.player.y = 10 * TILE - MAXX_H
    const input = settle(w)
    let top = Infinity
    for (let i = 0; i < 60; i++) {
      stepWorld(w, input(['jump']))
      top = Math.min(top, w.player.y)
    }
    return top
  }
  // Block X is column 5. Maxx's left edge `offset` px inside it.
  ok(tryAt(TUNING.cornerNudge - 1) < 7 * TILE - 20, 'a small overlap should slide past the corner')
  eq(tryAt(TUNING.cornerNudge + 4), 7 * TILE, 'a bigger overlap should bump')
})

test('no tunnelling at top fall speed: floor, catwalk and a thin lift all catch him', () => {
  const tall = (landing, legend) => {
    const rows = []
    for (let i = 0; i < 44; i++) rows.push('')
    rows[0] = '  @'
    rows[40] = landing
    rows[43] = FLOOR
    return makeWorld(rows, { legend })
  }
  for (const [what, landing, legend] of [
    ['one-tile floor', 'XXXXXX', undefined],
    ['catwalk', '======', undefined],
    ['lift', '  1', { 1: { kind: 'lift' } }],
  ]) {
    const w = tall(landing, legend)
    const input = makeInput()
    let fastest = 0
    const n = until(w, [], (x) => ((fastest = Math.max(fastest, x.player.vy)), x.player.onGround), 600, input)
    ok(n > 0, `${what}: never landed`)
    eq(fastest, TUNING.fallCap, `${what}: fall speed reached`)
    eq(feet(w), 40 * TILE, `${what}: feet after landing`)
    for (let i = 0; i < 20; i++) stepWorld(w, input([]))
    eq(feet(w), 40 * TILE, `${what}: feet 20 ticks later`)
  }
})

test('no tunnelling: a very fast body and turbo droplets stop at a one-tile wall', () => {
  const w = makeWorld(['  @       X', '          X', '          X', FLOOR, FLOOR])
  settle(w)
  const body = { x: 2 * TILE, y: 9 * TILE, w: 10, h: 10, vx: 3000, vy: 0, onGround: false, hitWall: 0, hitCeil: false }
  for (let i = 0; i < 10; i++) {
    body.vx = 3000
    sim.moveBody(body, w, { gravity: 0 })
  }
  eq(body.x, 10 * TILE - 10, 'fast body x')
  eq(body.hitWall, 1, 'fast body hitWall')

  w.player.turbo = true
  const input = makeInput()
  let past = 0
  for (let i = 0; i < 120; i++) {
    stepWorld(w, input(['spray']))
    for (const d of w.droplets) if (d.x > 11 * TILE) past++
  }
  eq(past, 0, 'droplets seen beyond the wall')
})

test('catwalk: jump up through it, land on it, stand on it', () => {
  const w = makeWorld(['======', '', '', '  @', FLOOR, FLOOR])
  const input = settle(w)
  const top = 6 * TILE
  let above = false
  for (let i = 0; i < 80; i++) {
    stepWorld(w, input(i < 30 ? ['jump'] : []))
    if (feet(w) < top) above = true
  }
  ok(above, 'never got above the catwalk')
  eq(feet(w), top, 'feet on the catwalk')
  ok(w.player.onGround, 'not standing')
  for (let i = 0; i < 30; i++) stepWorld(w, input(['right']))
  eq(feet(w), top, 'feet after walking along it')
})

test('conveyors carry Maxx and cars at 60 px/s', () => {
  for (const [ch, dir] of [['>', 1], ['<', -1]]) {
    const w = makeWorld(['          @', ch.repeat(60), FLOOR])
    const input = settle(w)
    const x0 = w.player.x
    for (let i = 0; i < 60; i++) stepWorld(w, input([]))
    near(w.player.x - x0, dir * TUNING.conveyorSpeed, 1.01, `Maxx carried by '${ch}' in one second`)
    eq(w.player.floor, ch, 'player.floor')
  }
  // A compact drives left at 40; a belt going right at 60 wins by 20.
  const w = makeWorld(['  @            c', '>'.repeat(60), FLOOR])
  const input = settle(w)
  const car = find(w, 'car')
  const x0 = car.x
  for (let i = 0; i < 60; i++) stepWorld(w, input([]))
  near(car.x - x0, 20, 1.5, 'car on a belt against it')
  // Running against the belt is slower over the ground than with it.
  const withBelt = makeWorld(['          @', '>'.repeat(60), FLOOR])
  const against = makeWorld(['          @', '<'.repeat(60), FLOOR])
  const a = settle(withBelt)
  const b = settle(against)
  const xa = withBelt.player.x
  const xb = against.player.x
  for (let i = 0; i < 60; i++) {
    stepWorld(withBelt, a(['right']))
    stepWorld(against, b(['right']))
  }
  near(withBelt.player.x - xa - (against.player.x - xb), 2 * TUNING.conveyorSpeed, 2.5, 'belt with minus belt against, one second')
})

test('slick and oily floors: slow to stop, slow to start', () => {
  ok(m.stopSlick.dist > m.stop.dist * 2.5, `slick stop ${round(m.stopSlick.dist)} px vs normal ${round(m.stop.dist)} px`)
  ok(m.stopOil.dist > m.stopSlick.dist * 2.5, `oil stop ${round(m.stopOil.dist)} px vs slick ${round(m.stopSlick.dist)} px`)
  const w = makeWorld(['  @', 'I'.repeat(60), FLOOR])
  const input = settle(w)
  const n = until(w, ['right'], (x) => x.player.vx >= TUNING.runSpeed, 400, input)
  ok(n > m.toTop * 2.5, `slick: ${n} ticks to top speed vs ${m.toTop} normally`)
  eq(w.player.floor, 'I', 'player.floor')
})

test('mud: half speed and a weak jump', () => {
  const w = makeWorld(['  @', 'M'.repeat(60), FLOOR])
  const input = settle(w)
  for (let i = 0; i < 120; i++) stepWorld(w, input(['right']))
  near(w.player.vx, TUNING.runSpeed * TUNING.mudSpeed, 0.01, 'top speed in mud')
  eq(w.player.floor, 'M', 'player.floor')
  near(m.mud.apex / m.full.apex, TUNING.mudJump ** 2, 0.03, 'mud jump height as a share of a normal one')
  // Run off the edge of the mud and jump in coyote time: still a mud jump, never a full one.
  for (let late = 1; late <= TUNING.coyoteTicks; late++) {
    const edge = makeWorld(['  @', 'M'.repeat(8), '#'.repeat(8)])
    const input = settle(edge)
    until(edge, ['right'], (x) => !x.player.onGround, 200, input)
    for (let i = 1; i < late; i++) stepWorld(edge, input(['right']))
    stepWorld(edge, input(['right', 'jump']))
    const vy = edge.player.vy
    ok(vy < -400, `${late} ticks off the mud: no coyote jump (vy ${round(vy)})`)
    ok(vy >= -(TUNING.jumpSpeed + TUNING.jumpRunBonus) * TUNING.mudJump - 0.01, `${late} ticks off the mud: a full jump (vy ${round(vy)})`)
  }
})

test('hover: down + spray in the air holds the fall to 40 px/s for 42 ticks, refilled on landing', () => {
  const w = flat()
  const input = settle(w)
  const p = w.player
  until(w, ['jump'], (x) => x.player.vy > 0, 100, input)
  let hovering = 0
  let down = 0
  let started = false
  for (let i = 0; i < 200 && !p.onGround; i++) {
    stepWorld(w, input(['down', 'spray']))
    if (sfx(w.events, 'hover')) started = true
    w.events.length = 0
    if (p.hovering) {
      hovering++
      eq(p.vy, TUNING.hoverFall, 'fall speed while hovering')
      eq(p.aim, 'down', 'aim while hovering')
    }
    for (const d of w.droplets) if (d.vy > 300 && Math.abs(d.vx) < 80) down++
  }
  eq(hovering, TUNING.hoverTicks, 'ticks of hover in one airtime')
  ok(started, "no 'hover' sound")
  ok(down > 10, 'droplets were not fired straight down')
  ok(p.onGround, 'never landed')
  eq(p.hover, TUNING.hoverTicks, 'hover refilled on landing')
  ok(m.hover.length > m.runFull.length + 2 * TILE, `hover adds only ${tiles(m.hover.length - m.runFull.length)} tiles`)
})

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

/** Maxx under one block (column 5, three tiles of air below it). Jumps once. */
function bump(ch, opts = {}) {
  const w = makeWorld([`     ${ch}`, '', '', '     @', FLOOR, FLOOR], opts)
  const input = settle(w)
  const events = []
  const jumpOnce = () => {
    until(w, ['jump'], (x) => !x.player.onGround, 5, input, events)
    until(w, ['jump'], (x) => x.player.onGround, 120, input, events)
    until(w, [], () => true, 1, input, events)
  }
  jumpOnce()
  return { w, events, input, jumpOnce, tile: () => char(w, 5, 6) }
}

test("brick 'B' breaks", () => {
  const { w, events, tile } = bump('B')
  eq(tile(), ' ', 'tile after the bump')
  ok(sfx(events, 'brick'), "no 'brick' sound")
  ok(has(events, 'fx', (e) => e.fx === 'debris'), 'no debris')
  eq(w.stats.score, TUNING.brickScore, 'score')
})

test("coin brick 'C' pays 8 coins, then is used", () => {
  const b = bump('C')
  eq(b.tile(), 'C', 'tile after 1 bump')
  eq(b.w.stats.coins, 1, 'coins after 1 bump')
  for (let i = 0; i < 6; i++) b.jumpOnce()
  eq(b.tile(), 'C', 'tile after 7 bumps')
  b.jumpOnce()
  eq(b.w.stats.coins, TUNING.coinBrickCoins, 'coins after 8 bumps')
  eq(b.tile(), 'U', 'tile after 8 bumps')
  b.jumpOnce()
  eq(b.w.stats.coins, TUNING.coinBrickCoins, 'coins after a 9th bump')
})

test("prize block '?' gives one coin, then is used", () => {
  const b = bump('?')
  eq(b.tile(), 'U', 'tile')
  eq(b.w.stats.coins, 1, 'coins')
  eq(b.w.session.coins, 1, 'session coins')
  ok(sfx(b.events, 'coin'), "no 'coin' sound")
  ok(b.w.bumps.length > 0 || b.events.length > 0, 'no bump recorded')
  b.jumpOnce()
  eq(b.w.stats.coins, 1, 'coins after a second bump')
})

test("power block '!' gives the turbo nozzle at full shine", () => {
  const b = bump('!')
  eq(b.tile(), 'U', 'tile')
  const turbo = find(b.w, 'turbo')
  ok(turbo, 'no turbo entity')
  ok(sfx(b.events, 'prize'), "no 'prize' sound")
  until(b.w, [], () => turbo.state !== 'pop', 60, b.input)
  eq(turbo.y + turbo.h, 6 * TILE, 'the nozzle rests on top of its block')
  // Fetch it: put Maxx on the block.
  b.w.player.x = turbo.x
  b.w.player.y = turbo.y - MAXX_H
  until(b.w, [], (x) => x.player.turbo, 30, b.input, b.events)
  ok(b.w.player.turbo, 'turbo not picked up')
  ok(b.w.session.turbo, 'session.turbo not set')
  ok(sfx(b.events, 'powerup'), "no 'powerup' sound")
})

test("power block '!' gives a bubble when shine is missing, and the bubble heals", () => {
  const b = bump('!', { session: { pips: 2 } })
  const bubble = find(b.w, 'bubble')
  ok(bubble, 'no bubble entity')
  ok(!find(b.w, 'turbo'), 'gave a turbo as well')
  until(b.w, [], () => bubble.state !== 'pop', 60, b.input)
  b.w.player.x = bubble.x
  b.w.player.y = bubble.y - 10
  until(b.w, [], (x) => x.player.pips === 3, 30, b.input, b.events)
  eq(b.w.player.pips, 3, 'pips after the bubble')
  ok(sfx(b.events, 'heal'), "no 'heal' sound")
})

test("wax block 'W': Mighty Wax pops out, slides off, makes him invincible", () => {
  const b = bump('W')
  eq(b.tile(), 'U', 'tile')
  const wax = find(b.w, 'wax')
  ok(wax, 'no wax entity')
  until(b.w, [], () => wax.state === 'walk', 60, b.input)
  const x0 = wax.x
  for (let i = 0; i < 20; i++) stepWorld(b.w, b.input([]))
  ok(wax.x !== x0, 'the can does not slide')
  b.w.player.x = wax.x
  b.w.player.y = wax.y - 20
  until(b.w, [], (x) => x.player.wax > 0, 30, b.input, b.events)
  ok(b.w.player.wax > TUNING.waxTicks - 30, 'wax timer not started')
  ok(sfx(b.events, 'waxStart'), "no 'waxStart' sound")
  ok(has(b.events, 'music', (e) => e.id === 'wax'), 'wax music not started')
  eq(sim.hurtPlayer(b.w), false, 'hurtPlayer during wax')
  const events = []
  until(b.w, [], (x) => x.player.wax === 0, TUNING.waxTicks + 10, b.input, events)
  ok(has(events, 'music', (e) => e.id === 'sunny'), 'level music not restored when wax ran out')
})

test("life block 'L' gives a 1UP", () => {
  const b = bump('L')
  eq(b.tile(), 'U', 'tile')
  const oneup = find(b.w, 'oneup')
  ok(oneup, 'no oneup entity')
  until(b.w, [], () => oneup.state === 'walk', 60, b.input)
  b.w.player.x = oneup.x
  b.w.player.y = oneup.y - 20
  until(b.w, [], (x) => x.session.lives === 4, 30, b.input, b.events)
  eq(b.w.session.lives, 4, 'lives')
  ok(sfx(b.events, 'oneUp'), "no 'oneUp' sound")
  ok(has(b.events, 'popup', (e) => e.text === '1UP'), "no '1UP' popup")
})

test("hidden blocks 'H' and 'h': air until bumped from below", () => {
  // From above and from the side it is not there.
  const w = makeWorld(['  @', '', '  H', '', '', '', FLOOR, FLOOR])
  const input = makeInput()
  until(w, [], (x) => x.player.onGround, 200, input)
  eq(feet(w), 10 * TILE, 'fell straight through the hidden block')
  eq(char(w, 2, 6), 'H', 'still hidden')

  const side = makeWorld(['', ' @   H', FLOOR, FLOOR])
  const sideInput = settle(side)
  for (let i = 0; i < 90; i++) stepWorld(side, sideInput(['right']))
  ok(side.player.x > 7 * TILE, 'walked into a hidden block as if it were solid')
  eq(char(side, 5, 9), 'H', 'still hidden after walking through')

  const b = bump('H')
  eq(b.tile(), 'U', 'H after a bump from below')
  eq(b.w.stats.coins, 1, 'coin from H')
  // Now it is a real block: he can stand on it.
  b.w.player.x = 5 * TILE + 5
  b.w.player.y = 3 * TILE
  until(b.w, [], (x) => x.player.onGround, 60, b.input)
  eq(feet(b.w), 6 * TILE, 'stands on the revealed block')

  const life = bump('h')
  eq(life.tile(), 'U', 'h after a bump from below')
  ok(find(life.w, 'oneup'), 'no 1UP from h')
})

test("used 'U' and steel 'X' blocks only thud", () => {
  for (const ch of ['U', 'X', '#', '%']) {
    const b = bump(ch)
    eq(b.tile(), ch, `'${ch}' after a bump`)
    ok(sfx(b.events, 'bump'), `'${ch}': no 'bump' sound`)
    eq(b.w.stats.coins + b.w.stats.score, 0, `'${ch}' paid out`)
    eq(b.w.entities.length, 0, `'${ch}' spawned something`)
  }
})

test('a coin on top of a bumped block is collected', () => {
  const w = makeWorld(['     o', '     ?', '', '', '     @', FLOOR, FLOOR])
  const input = settle(w)
  until(w, ['jump'], (x) => x.stats.coins > 0, 60, input)
  eq(w.stats.coins, 2, 'coins: one from the block, one knocked off it')
  ok(!find(w, 'coin'), 'the coin is still there')
})

/* ------------------------------------------------------------------ */
/* The prep gun and cars                                               */
/* ------------------------------------------------------------------ */

test('the gun: a droplet every 2 ticks from the muzzle, 45 degrees with up held, capped at 40', () => {
  const w = flat(['          @'])
  const input = settle(w)
  const p = w.player
  stepWorld(w, input(['spray']))
  eq(w.droplets.length, 1, 'a droplet on the first tick of spraying')
  const d = w.droplets[0]
  eq(d.x, p.x + p.w / 2 + contract.MUZZLE.fwd.x, 'muzzle x')
  eq(d.y, p.y + p.h + contract.MUZZLE.fwd.y, 'muzzle y')
  near(Math.hypot(d.vx, d.vy), TUNING.dropletSpeed, 0.01, 'droplet speed')
  ok(p.spraying, 'player.spraying')
  let fired = 1
  let most = 1
  for (let i = 0; i < 99; i++) {
    const before = new Set(w.droplets)
    stepWorld(w, input(['spray']))
    for (const x of w.droplets) if (!before.has(x)) fired++
    most = Math.max(most, w.droplets.length)
  }
  eq(fired, 50, 'droplets in 100 ticks')
  ok(most <= TUNING.maxDroplets, `${most} droplets alive at once`)

  // Facing left mirrors the muzzle.
  w.droplets.length = 0
  stepWorld(w, input(['left']))
  stepWorld(w, input(['left', 'spray']))
  stepWorld(w, input(['left', 'spray']))
  ok(w.droplets.every((x) => x.vx < 0 && x.x < p.x + p.w / 2), 'droplets do not go left when he faces left')

  // Up held: 45 degrees up and forward.
  const up = flat(['          @'])
  const upInput = settle(up)
  stepWorld(up, upInput(['up', 'spray']))
  const u = up.droplets[0]
  eq(up.player.aim, 'up', 'aim with up held')
  near((Math.atan2(-u.vy, u.vx) * 180) / Math.PI, 45, TUNING.dropletJitter + 0.01, 'angle with up held')
  eq(u.y, up.player.y + up.player.h + contract.MUZZLE.up.y, 'up muzzle y')

  // Turbo: half again as often, twice the power, further.
  const t = flat(['          @'], { session: { turbo: true } })
  const tInput = settle(t)
  let turboFired = 0
  for (let i = 0; i < 100; i++) {
    const before = new Set(t.droplets)
    stepWorld(t, tInput(['spray']))
    for (const x of t.droplets) if (!before.has(x)) turboFired++
  }
  eq(turboFired, 75, 'turbo droplets in 100 ticks')
  eq(t.droplets[0].power, TUNING.turboPower, 'turbo droplet power')
  ok(m.reach > 4.5 * TILE && m.reach < 6 * TILE, `reach ${tiles(m.reach)} tiles from the nozzle, want about 5`)
})

test('running while spraying on the ground tops out at 150', () => {
  const w = flat()
  const input = settle(w)
  for (let i = 0; i < 90; i++) stepWorld(w, input(['right', 'spray']))
  near(w.player.vx, TUNING.spraySpeed, 0.01, 'speed while spraying')
})

test('droplets wash a car until it is clean and harmless', () => {
  const w = flat(['  @            c'])
  const input = settle(w)
  const car = find(w, 'car')
  eq(car.variant, 'compact', 'variant')
  eq(car.hp, 10, 'dirt')
  ok(car.harmful, 'a dirty car should be harmful')
  eq(car.solid, 'none', 'a dirty car is not ground')
  eq(w.stats.carsTotal, 1, 'carsTotal')
  const events = []
  let hpSeen = new Set()
  const n = until(w, ['spray'], () => (hpSeen.add(car.hp), car.state === 'clean'), 900, input, events)
  ok(n > 0, 'the car was never washed')
  ok(hpSeen.size >= 9, `dirt came off in ${hpSeen.size} steps, expected about 10`)
  eq(w.player.pips, 3, 'pips: the car should be clean before it reaches him')
  eq(car.harmful, false, 'harmful after washing')
  eq(car.solid, 'top', 'solid after washing')
  eq(w.stats.carsWashed, 1, 'carsWashed')
  eq(w.stats.score, 200, 'score for the first car')
  ok(sfx(events, 'carClean'), "no 'carClean' sound")
  ok(has(events, 'popup', (e) => e.text === '200'), "no '200' popup")
  ok(has(events, 'banner', (e) => e.text === 'SPOTLESS!'), "no 'SPOTLESS!' banner for washing the only car")
  ok(sim.isSpotless(w), 'isSpotless')
  until(w, [], () => false, 40, input, events)
  ok(sfx(events, 'honk'), "no 'honk'")
  // It drives off faster, straight through him, and he is not hurt.
  near(Math.abs(car.vx), 40 * TUNING.cleanSpeedUp, 0.01, 'clean car speed')
  until(w, [], () => car.x + car.w < w.player.x, 600, input)
  eq(w.player.pips, 3, 'pips after a clean car passed')
})

test('riding a washed car: carried exactly, no jitter', () => {
  const w = flat(['  @                    c'])
  const input = settle(w)
  const car = find(w, 'car')
  sim.getBehavior('car').onSpray(car, w, { x: car.x, y: car.y, vx: 0, vy: 0, life: 1, power: 99 })
  eq(car.state, 'clean', 'washed')
  const p = w.player
  p.x = car.x + 30
  p.y = car.y - MAXX_H - 20
  p.vy = 0
  until(w, [], () => p.ridingId === car.id, 60, input)
  eq(p.ridingId, car.id, 'ridingId')
  const offset = p.x - car.x
  const x0 = p.x
  for (let i = 0; i < 120; i++) {
    stepWorld(w, input([]))
    eq(p.y + p.h, car.y, `feet on the roof, tick ${i}`)
    near(p.x - car.x, offset, 1e-9, `offset on the roof, tick ${i}`)
    ok(p.onGround, `onGround, tick ${i}`)
  }
  near(p.x - x0, -40 * TUNING.cleanSpeedUp * 2, 0.5, 'carried distance in 2 seconds')
  // He can walk on the roof and jump off it.
  for (let i = 0; i < 10; i++) stepWorld(w, input(['right']))
  ok(p.x - car.x > offset + 5, 'cannot walk along the roof')
  stepWorld(w, input(['jump']))
  ok(p.vy < -500 && p.ridingId === 0, 'cannot jump off the roof')
})

test('every car variant: size, speed and dirt from the design table', () => {
  const table = { c: ['compact', 72, 40, 40, 10], s: ['sedan', 88, 40, 55, 18], v: ['suv', 92, 52, 60, 26], p: ['pickup', 100, 52, 50, 36], f: ['sports', 92, 34, 150, 12], n: ['van', 100, 60, 45, 44], t: ['monster', 120, 92, 35, 60] }
  for (const [ch, [variant, cw, chh, speed, dirt]] of Object.entries(table)) {
    const w = flat([`  @           ${ch}`])
    const input = makeInput()
    const car = find(w, 'car')
    eq(car.variant, variant, `'${ch}' variant`)
    eq(car.w, cw, `${variant} width`)
    eq(car.h, chh, `${variant} height`)
    eq(car.hp, dirt, `${variant} dirt`)
    eq(car.maxHp, dirt, `${variant} maxHp`)
    const events = []
    until(w, [], () => car.state === 'drive' && car.stateT > 2, 80, input, events)
    near(car.vx, -speed, 0.01, `${variant} speed`)
    eq(car.y + car.h, 10 * TILE, `${variant} stands on the ground`)
    if (variant === 'sports') ok(sfx(events, 'rev'), "sports car: no 'rev' before it sets off")
  }
})

test('cars turn round at walls, fall into pits, and queue behind each other', () => {
  const w = makeWorld(['X', 'X       c         @', FLOOR, FLOOR])
  const input = settle(w)
  const car = find(w, 'car')
  until(w, [], () => car.facing === 1, 900, input)
  eq(car.facing, 1, 'turned at the wall')
  eq(car.x, TILE, 'flush against the wall when it turned')

  const row = '#'.repeat(8) + '   ' + '#'.repeat(40)
  const pit = makeWorld(['  @             c', row, row])
  const pitInput = settle(pit)
  until(pit, [], () => !find(pit, 'car'), 1200, pitInput)
  ok(!find(pit, 'car'), 'a car that fell out of the area was not removed')

  // A sports car (150) catches a van (45) and has to sit behind it.
  const q = flat(['  @        n     f'])
  const qInput = settle(q)
  const [van, sports] = [all(q, 'car').find((c) => c.variant === 'van'), all(q, 'car').find((c) => c.variant === 'sports')]
  for (let i = 0; i < 200; i++) {
    stepWorld(q, qInput([]))
    ok(sports.x >= van.x + van.w, `the sports car drove into the van at tick ${i}`)
    if (q.status !== 'play') break
  }
})

test('a pickup flings clods at Maxx; spray knocks them out of the air', () => {
  const w = flat(['  @          p'])
  const input = settle(w)
  const events = []
  until(w, [], () => find(w, 'clod'), 300, input, events)
  const clod = find(w, 'clod')
  ok(clod, 'no clod thrown')
  ok(sfx(events, 'mudThrow'), "no 'mudThrow' sound")
  ok(clod.vx < 0 && clod.vy < 0, 'the clod is not thrown up and ahead')
  ok(clod.harmful, 'a clod should be harmful')
  eq(sim.getBehavior('clod').onSpray(clod, w, w.droplets[0]), true, 'clod.onSpray')
  ok(clod.dead, 'spray did not destroy the clod')
  // Left alone, a clod hits him.
  until(w, [], () => w.player.pips < 3, 600, input)
  eq(w.player.pips, 2, 'pips after being hit by a clod')
})

test('wash chain: 200, 400, 800, 1000, 1000; it lapses after 180 ticks', () => {
  const w = flat(['  @      c  c  c  c  c  c'])
  const input = settle(w)
  const wash = sim.getBehavior('car').onSpray
  const cars = all(w, 'car')
  const scores = []
  for (let i = 0; i < 5; i++) {
    const before = w.stats.score
    wash(cars[i], w, { x: 0, y: 0, vx: 0, vy: 0, life: 1, power: 99 })
    scores.push(w.stats.score - before)
    stepWorld(w, input([]))
  }
  eq(scores.join(','), '200,400,800,1000,1000', 'chain scores')
  for (let i = 0; i < TUNING.chainTicks + 1; i++) stepWorld(w, input([]))
  eq(w.chain, 0, 'chain after the pause')
  const before = w.stats.score
  wash(cars[5], w, { x: 0, y: 0, vx: 0, vy: 0, life: 1, power: 99 })
  eq(w.stats.score - before, 200, 'score after the chain lapsed')
})

test('spawner: sends its cars on a timer, respects max and count, and they count toward carsTotal', () => {
  const legend = { 1: { kind: 'spawner', props: { variants: 'compact,sedan', every: 60, max: 2, count: 3, delay: 10 } } }
  const w = flat(['  @                 c    1'], { legend })
  eq(w.stats.carsTotal, 4, 'carsTotal = 1 placed + 3 from the spawner')
  const input = settle(w)
  const seen = new Map()
  let most = 0
  for (let i = 0; i < 1500 && w.status === 'play'; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    w.player.invuln = 99
    const mine = all(w, 'car').filter((c) => c.vars.owner !== undefined)
    most = Math.max(most, mine.length)
    for (const c of mine) seen.set(c.id, c.variant)
  }
  eq(seen.size, 3, 'cars sent')
  eq([...seen.values()].join(','), 'compact,sedan,compact', 'variants in turn')
  ok(most <= 2, `${most} of its cars alive at once, max is 2`)
  eq(find(w, 'spawner').state, 'done', 'spawner state when finished')

  // No count: endless, and those cars are bonus cars.
  const endless = flat(['  @                 1'], { legend: { 1: { kind: 'spawner', props: { variant: 'compact', every: 30, delay: 1 } } } })
  eq(endless.stats.carsTotal, 0, 'an endless spawner adds nothing to carsTotal')
  const eInput = settle(endless)
  until(endless, [], () => find(endless, 'car'), 60, eInput)
  const car = find(endless, 'car')
  sim.getBehavior('car').onSpray(car, endless, { x: 0, y: 0, vx: 0, vy: 0, life: 1, power: 99 })
  eq(endless.stats.carsWashed, 0, 'a bonus car does not count as washed')
  eq(endless.stats.score, 200, 'a bonus car still scores')
})

test("grime blocks 'g' wash away after 6 hits", () => {
  const w = makeWorld(['  @   g', '      g', FLOOR, FLOOR])
  const input = settle(w)
  eq(char(w, 6, 9), 'g', 'grime block there')
  for (let i = 0; i < 40; i++) stepWorld(w, input(['right']))
  eq(w.player.x, 6 * TILE - MAXX_W, 'a grime block is a wall')
  const events = []
  let fired = 0
  const n = until(w, ['right', 'spray'], () => ((fired = w.grid.d[9 * w.grid.w + 6] || fired), char(w, 6, 9) === ' '), 200, input, events)
  ok(n > 0, 'the grime block never washed away')
  ok(n >= 10 && n <= 14, `washed away in ${n} ticks, expected about 12 (6 droplets)`)
  ok(sfx(events, 'crumble'), "no 'crumble' sound")
  eq(char(w, 6, 8), 'g', 'the block above is untouched by forward spray')
})

/* ------------------------------------------------------------------ */
/* Shine                                                               */
/* ------------------------------------------------------------------ */

test('a dirty car costs a pip, knocks him back, and he blinks for 90 ticks', () => {
  const w = flat(['  @     c'], { session: { turbo: true } })
  const input = settle(w)
  const p = w.player
  const events = []
  until(w, [], () => p.pips < 3, 600, input, events)
  eq(p.pips, 2, 'pips after the hit')
  eq(p.state, 'hurt', 'state')
  eq(p.invuln, TUNING.invulnTicks, 'invulnerable ticks')
  eq(p.turbo, false, 'the turbo nozzle is lost')
  ok(p.vx < 0 && p.vy < 0, 'knocked up and away from the car')
  ok(sfx(events, 'hurt'), "no 'hurt' sound")
  ok(has(events, 'rumble'), 'no rumble for the controller')
  for (let i = 0; i < TUNING.hurtTicks; i++) stepWorld(w, input(['right']))
  eq(p.state, 'normal', `state ${TUNING.hurtTicks} ticks later`)
  // The car rolls on into him while he still blinks: no damage until the blinking runs out.
  const car = find(w, 'car')
  let touchedBlinking = false
  let hurtBlinking = false
  let blinkLeft = p.invuln
  until(w, [], () => {
    if (p.pips === 2 && p.invuln > 0 && sim.overlaps(p, car)) touchedBlinking = true
    if (p.pips < 2 && blinkLeft > 1) hurtBlinking = true
    if (p.pips === 2) blinkLeft = p.invuln
    return p.pips < 2
  }, 400, input)
  ok(touchedBlinking, 'the car never touched him while he blinked')
  ok(!hurtBlinking, 'hurt while blinking')
  eq(p.pips, 1, 'pips once the blinking ran out')
  eq(w.session.pips, 1, 'session.pips follows')
})

test('at 0 pips he is GRIMED', () => {
  const w = flat(['  @     c'], { session: { pips: 1 } })
  const input = settle(w)
  const events = []
  until(w, [], () => w.status !== 'play', 600, input, events)
  eq(w.status, 'grimed', 'status')
  eq(w.player.state, 'grimed', 'player state')
  eq(w.player.pips, 0, 'pips')
  eq(w.session.pips, 0, 'session pips')
  eq(w.session.lives, 3, 'lives are the play scene\'s to take, not the simulation\'s')
  ok(has(events, 'banner', (e) => e.text === 'GRIMED!'), "no 'GRIMED!' banner")
  ok(has(events, 'jingle', (e) => e.id === 'grimed'), "no 'grimed' jingle")
  const tick = w.tick
  const carX = find(w, 'car').x
  for (let i = 0; i < 60; i++) stepWorld(w, input(['right', 'jump']))
  eq(w.statusT, 60, 'statusT counts on')
  eq(w.tick, tick, 'the level clock stops')
  eq(find(w, 'car').x, carX, 'the world stands still')
  ok(w.player.onGround, 'he flops to the ground')
  // The next attempt starts shiny.
  const again = createWorld(w.level, { session: w.session })
  eq(again.player.pips, 3, 'pips on the retry')
})

test('sludge grimes at once; so does a pit; spikes cost one pip', () => {
  const row = '#'.repeat(8) + '~~~' + '#'.repeat(40)
  const w = makeWorld(['  @', row, FLOOR])
  const input = settle(w)
  until(w, ['right'], () => w.status !== 'play', 300, input)
  eq(w.status, 'grimed', 'sludge: status')
  ok(w.player.x > 8 * TILE - MAXX_W && w.player.x < 11 * TILE, 'sludge: grimed somewhere else')

  const pitRow = '#'.repeat(8) + '   ' + '#'.repeat(40)
  const pit = makeWorld(['  @', pitRow, pitRow])
  const pitInput = settle(pit)
  const events = []
  until(pit, ['right'], () => pit.status !== 'play', 300, pitInput, events)
  eq(pit.status, 'grimed', 'pit: status')
  ok(pit.player.y > 12 * TILE, 'pit: grimed before he fell out')
  ok(has(events, 'banner', (e) => e.text === 'GRIMED!'), "pit: no 'GRIMED!' banner")

  // Even Mighty Wax does not save him from sludge.
  const waxed = makeWorld(['  @', row, FLOOR])
  const waxedInput = settle(waxed)
  sim.giveWax(waxed)
  until(waxed, ['right'], () => waxed.status !== 'play', 300, waxedInput)
  eq(waxed.status, 'grimed', 'sludge with wax: status')

  const spikes = makeWorld(['  @     ^^', FLOOR, FLOOR])
  const sInput = settle(spikes)
  until(spikes, ['right'], () => spikes.player.pips < 3, 300, sInput)
  eq(spikes.player.pips, 2, 'spikes: pips')
  eq(spikes.status, 'play', 'spikes: still playing')
  // Jumping clean over them is safe.
  const over = makeWorld(['  @     ^^', FLOOR, FLOOR])
  const oInput = settle(over)
  until(over, ['right'], (x) => x.player.x > 6.6 * TILE, 300, oInput)
  until(over, ['right', 'jump'], (x) => x.player.onGround, 300, oInput)
  eq(over.player.pips, 3, 'jumped the spikes: pips')
  ok(over.player.x > 10 * TILE, 'jumped the spikes: landed beyond them')
})

test('Mighty Wax washes a dirty car on touch', () => {
  const w = flat(['  @     c'])
  const input = settle(w)
  sim.giveWax(w)
  const car = find(w, 'car')
  until(w, ['right'], () => car.state === 'clean', 300, input)
  eq(car.state, 'clean', 'car state')
  eq(w.player.pips, 3, 'pips')
  eq(w.stats.carsWashed, 1, 'carsWashed')
})

/* ------------------------------------------------------------------ */
/* Entities and the helper API                                         */
/* ------------------------------------------------------------------ */

// A stand-in for the critters other modules add, written the way they will write theirs.
sim.registerEntity('testblob', {
  init(e) {
    sim.setBox(e, 24, 20, sim.propNum(e, 'lift', 0))
    e.hp = 3
    e.harmful = true
    if (e.props.float) e.gravity = 0
  },
  update(e, w) {
    if (e.props.float) return
    if (e.props.still) sim.moveBody(e, w)
    else sim.patrol(e, w, 30, true)
  },
  onSpray(e, w, d) {
    if (sim.damage(e, d.power)) sim.kill(e)
    return true
  },
  onTouch(e, w, side) {
    e.vars.side = side === 'stomp' ? 1 : side === 'below' ? 2 : 3
    if (side !== 'stomp') return false
    sim.kill(e)
    sim.stompBounce(w)
    sim.addScore(w, 100, e.x, e.y)
    return true
  },
})
const BLOB = { 1: { kind: 'testblob' }, 2: { kind: 'testblob', props: { float: true, lift: 96 } }, 3: { kind: 'testblob', props: { still: true } } }

test('entity framework: stomp, side and below touches; stomp bounce; spray; patrol', () => {
  // Stomp: fall onto it.
  let w = flat(['  @', '', '', '  3'], { legend: BLOB })
  let input = makeInput()
  let blob = find(w, 'testblob')
  until(w, [], () => blob.dead || w.player.pips < 3, 200, input)
  eq(blob.vars.side, 1, "side for a fall onto its top ('stomp' = 1)")
  eq(w.player.pips, 3, 'a stomp does not hurt')
  ok(w.player.vy < 0, 'no bounce after the stomp')
  eq(w.stats.score, 100, 'score for the stomp')

  // Holding jump bounces higher.
  const bounce = (held) => {
    const x = flat(['  @', '', '', '  3'], { legend: BLOB })
    const xi = makeInput()
    const n = until(x, held, () => find(x, 'testblob') === undefined, 200, xi)
    ok(n > 0, 'never stomped it')
    return -x.player.vy
  }
  near(bounce([]), TUNING.stompBounce, 40, 'bounce speed')
  near(bounce(['jump']), TUNING.stompBounceHeld, 40, 'bounce speed with jump held')

  // Side: walk into it. It walks left at 30, turns at ledges, and costs a pip.
  w = flat(['  @      1'], { legend: BLOB })
  input = settle(w)
  blob = find(w, 'testblob')
  until(w, ['right'], () => w.player.pips < 3, 300, input)
  eq(blob.vars.side, 3, "side for walking into it ('side' = 3)")
  eq(w.player.pips, 2, 'walking into it costs a pip')
  ok(w.player.vx < 0, 'knocked back away from it')

  // Below: jump up into a floating one.
  w = flat(['  @'], { legend: BLOB })
  input = settle(w)
  const floater = sim.spawn(w, 'testblob', w.player.x + 11, feet(w) - 96, { props: { float: true } })
  ok(floater && floater.active, 'spawn() returns an awake entity')
  until(w, ['jump'], () => w.player.pips < 3, 60, input)
  eq(floater.vars.side, 2, "side for jumping up into it ('below' = 2)")

  // Spray: three hits. (The water leaves 30 px up, so a 20 px critter has to be a few tiles off to be hit.)
  w = flat(['  @     3'], { legend: BLOB })
  input = settle(w)
  blob = find(w, 'testblob')
  const hp = new Set([blob.hp])
  const n = until(w, ['spray'], () => (hp.add(blob.hp), blob.dead), 200, input)
  ok(n > 0, 'spray never destroyed it')
  eq([...hp].join(','), '3,2,1,0', 'hp as the water hits')
  ok(!find(w, 'testblob'), 'a dead entity is removed from the world')

  // Patrol turns at a ledge and at a wall.
  w = makeWorld(['  @', '', '        1    X', '     ##########', '', FLOOR, FLOOR], { legend: BLOB })
  input = settle(w)
  blob = find(w, 'testblob')
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < 900; i++) {
    stepWorld(w, input([]))
    minX = Math.min(minX, blob.x)
    maxX = Math.max(maxX, blob.x + blob.w)
  }
  near(minX, 5 * TILE, 3, 'turned at the ledge')
  near(maxX, 13 * TILE, 1, 'turned at the wall')
  ok(!blob.dead && blob.onGround, 'the walker fell off its platform')
})

test('entities sleep until the camera is near, and unknown kinds are skipped', () => {
  const legend = { 1: { kind: 'testblob' }, 9: { kind: 'no-such-kind' } }
  const row = '#'.repeat(120)
  const w = makeWorld(['  @                                                       1         9', row, row], { legend })
  const input = settle(w)
  const blob = find(w, 'testblob')
  eq(w.entities.length, 1, 'only the known kind was spawned')
  eq(blob.active, false, 'asleep at the far end of the level')
  const x0 = blob.x
  for (let i = 0; i < 30; i++) stepWorld(w, input([]))
  eq(blob.x, x0, 'a sleeping entity does not move')
  until(w, ['right'], () => blob.active, 900, input)
  ok(blob.active, 'never woke')
  ok(blob.x - (w.camera.x + VIEW_W) <= TUNING.activeMargin, 'woke before the camera was near')
  const report = validateLevel(w.level)
  ok(report.warnings.some((s) => s.includes('no-such-kind')), 'validateLevel does not warn about the unknown kind')
})

test('a bonus car that drives past and far behind is removed (a counted one sleeps instead: tests/sim-backtrack.mjs)', () => {
  const row = '#'.repeat(200)
  const w = makeWorld(['                              @     1', row, row], { legend: { 1: { kind: 'car', variant: 'compact', props: { bonus: true } } } })
  const input = settle(w)
  const car = find(w, 'car')
  w.player.y -= 200
  // Hover above while it passes underneath, then run right, away from it.
  for (let i = 0; i < 2000 && !car.dead; i++) {
    w.player.invuln = 99
    stepWorld(w, input(['right']))
  }
  ok(car.dead && !find(w, 'car'), 'the car behind was never removed')
})

test('spring throws him higher than a jump; lift carries him without jitter', () => {
  const w = makeWorld(['  @', '', '', '  y', FLOOR, FLOOR])
  const input = makeInput()
  const events = []
  let top = Infinity
  until(w, [], (x) => ((top = Math.min(top, x.player.y)), x.player.vy > 0 && sfx(events, 'spring')), 300, input, events)
  ok(sfx(events, 'spring'), "no 'spring' sound")
  const rise = 10 * TILE - 22 - MAXX_H - top
  ok(rise > m.full.apex * 1.5, `spring rise ${tiles(rise)} tiles is not much more than a jump (${tiles(m.full.apex)})`)
  notes.push(`spring: throws him ${tiles(rise)} tiles up`)

  for (const [name, props, axis] of [
    ['a sideways lift', { dx: 5, speed: 90, wait: 10 }, 'x'],
    ['a lift going up and down', { dy: -4, speed: 70, wait: 10 }, 'y'],
    ['a fast lift going down', { dy: 5, speed: 240, wait: 5 }, 'y'],
  ]) {
    const lw = makeWorld(['', '', '', '    @', '    1', '', '', '', '', '', FLOOR, FLOOR], { legend: { 1: { kind: 'lift', props } } })
    const li = makeInput()
    const lift = find(lw, 'lift')
    const p = lw.player
    until(lw, [], () => p.ridingId === lift.id, 60, li)
    eq(p.ridingId, lift.id, `${name}: riding`)
    const offset = p.x - lift.x
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < 400; i++) {
      stepWorld(lw, li([]))
      eq(p.y + p.h, lift.y, `${name}: feet on the lift, tick ${i}`)
      near(p.x - lift.x, offset, 1e-9, `${name}: offset on the lift, tick ${i}`)
      lo = Math.min(lo, lift[axis])
      hi = Math.max(hi, lift[axis])
    }
    near(hi - lo, Math.abs((props.dx ?? props.dy) * TILE), 0.001, `${name}: length of its run`)
  }
})

test('signs notice Maxx; tokens fill their slots in reading order', () => {
  const legend = { 1: { kind: 'sign', props: { text: 'HOLD {spray} TO WASH' } } }
  const w = flat(['  @     1      $   $   $'], { legend, world: { tokens: [false, true, false] } })
  const input = settle(w)
  const sign = find(w, 'sign')
  eq(sign.state, 'idle', 'sign far away')
  eq(sign.props.text, 'HOLD {spray} TO WASH', 'sign text')
  until(w, ['right'], () => sign.state === 'near', 200, input)
  eq(sign.state, 'near', 'sign with Maxx beside it')
  const tokens = all(w, 'token')
  eq(tokens.map((t) => t.vars.token).join(','), '0,1,2', 'token slots')
  eq(tokens.map((t) => t.state).join(','), 'idle,owned,idle', 'the token already in the save is marked')
  const events = []
  until(w, ['right'], () => all(w, 'token').length === 0, 600, input, events)
  eq(w.stats.tokens.join(','), 'true,true,true', 'stats.tokens')
  ok(sfx(events, 'token'), "no 'token' sound")
  eq(w.stats.score, 2 * TUNING.tokenScore + TUNING.tokenScore / 10, 'score: two new tokens and one already owned')
  eq(sign.state, 'idle', 'sign once he has left')
})

/* ------------------------------------------------------------------ */
/* Areas, checkpoints, the ends of a level                             */
/* ------------------------------------------------------------------ */

function twoAreas() {
  const legend = {
    1: { kind: 'pipe', props: { to: 'bonus:in', name: 'top' } },
    2: { kind: 'door', props: { to: 'bonus:room' } },
    3: { kind: 'marker', props: { name: 'out' } },
  }
  const bonusRows = ['', '', '', '', '', '', '', '', '   4          5   6  ', '  PP          PP     ', '  PP o o o    PP     ', '#'.repeat(24)]
  const bonus = {
    id: 'bonus',
    theme: 'bonus',
    music: 'bonus',
    rows: bonusRows.map((r) => r.padEnd(24)),
    legend: {
      4: { kind: 'marker', props: { name: 'in' } },
      5: { kind: 'pipe', props: { to: 'main:top' } },
      6: { kind: 'marker', props: { name: 'room' } },
    },
  }
  return makeWorld(['', '      BB', '', '      1', '  @  oPP   o    c   2    3', FLOOR, FLOOR], { legend, areas: [bonus] })
}

test('pipe: down on the pipe warps to the other area and back, and the first area is as he left it', () => {
  const w = twoAreas()
  const input = settle(w)
  const p = w.player
  // Take the first coin, hop onto the pipe (a tap clears its one tile), break a brick over it.
  until(w, ['right'], () => w.stats.coins === 1 && p.hitWall === 1, 200, input)
  eq(w.stats.coins, 1, 'first coin')
  until(w, ['right', 'jump'], () => p.vy < 0, 5, input)
  until(w, ['right'], () => p.onGround, 100, input)
  eq(feet(w), 9 * TILE, 'hopped onto the pipe')
  // Further under the brick: clipping it by a few pixels would only slide him past its corner.
  for (let i = 0; i < 8; i++) stepWorld(w, input(['right']))
  const pipe = find(w, 'pipe')
  eq(pipe.w, 2 * TILE, 'the pipe entity spans the whole pipe')
  stepWorld(w, input([]))
  until(w, ['jump'], () => char(w, 6, 6) + char(w, 7, 6) !== 'BB', 100, input)
  const bricks = char(w, 6, 6) + char(w, 7, 6)
  ok(bricks === ' B' || bricks === 'B ', `one brick should be broken, got '${bricks}'`)
  until(w, [], () => p.onGround, 100, input)
  const car = find(w, 'car')
  const mainEntities = w.entities.length

  const events = []
  until(w, ['down'], () => w.warp !== null, 10, input, events)
  ok(w.warp, 'down on the pipe did not start a warp')
  const tickBefore = w.tick
  const clockBefore = w.timeLeft
  const carX = car.x
  eq(p.state, 'warp', 'player state')
  ok(sfx(events, 'pipe'), "no 'pipe' sound")
  const n = until(w, ['down'], () => w.warp === null, 200, input, events)
  ok(n > 0, 'the warp never finished')
  eq(w.area.id, 'bonus', 'area after the warp')
  ok(has(events, 'area', (e) => e.areaId === 'bonus'), "no 'area' event")
  ok(has(events, 'music', (e) => e.id === 'bonus'), "the area's own music was not requested")
  eq(w.tick, tickBefore, 'world.tick stood still during the warp')
  eq(w.timeLeft, clockBefore, 'the clock stood still during the warp')
  eq(p.state, 'normal', 'player state on arrival')
  eq(p.x + p.w / 2, 3 * TILE, 'arrives on the middle of the far pipe')
  eq(feet(w), 9 * TILE, 'arrives standing on the far pipe')
  eq(w.camera.x, 0, 'camera snapped to the new area')

  // Still holding down: must not go straight back.
  for (let i = 0; i < 20; i++) stepWorld(w, input(['down']))
  eq(w.area.id, 'bonus', 'a held stick sent him straight back down a pipe')

  until(w, ['right'], () => w.stats.coins === 4, 300, input)
  eq(w.stats.coins, 4, 'coins after the bonus room')
  // Up against the far pipe (two tiles tall), then a held jump onto it.
  until(w, ['right'], () => p.hitWall === 1, 300, input)
  until(w, ['right', 'jump'], () => p.x + p.w / 2 > 14 * TILE + 8, 200, input)
  until(w, ['jump'], () => p.onGround, 200, input)
  eq(feet(w), 9 * TILE, 'jumped onto the far pipe')
  events.length = 0
  until(w, ['down'], () => w.warp !== null, 10, input, events)
  until(w, ['down'], () => w.warp === null, 200, input, events)
  eq(w.area.id, 'main', 'back in the first area')
  ok(has(events, 'area', (e) => e.areaId === 'main'), "no 'area' event on the way back")
  ok(has(events, 'music', (e) => e.id === 'sunny'), 'the level music was not requested on the way back')
  eq(p.x + p.w / 2, 7 * TILE, 'comes up out of the pipe he went down')
  eq(char(w, 6, 6) + char(w, 7, 6), bricks, 'the brick is still broken')
  eq(all(w, 'coin').length, 1, 'the coin he took is still gone, the other still there')
  eq(w.entities.length, mainEntities, 'entity count in the first area')
  eq(find(w, 'car'), car, 'the same car object')
  eq(car.x, carX, 'the car did not move while he was away')
  eq(w.areas.bonus.entities.filter((e) => e.kind === 'coin').length, 0, 'the bonus room remembers its coins are gone')
})

test('door: up in front of it warps; markers that are not on a pipe are a plain arrival', () => {
  const w = twoAreas()
  const input = settle(w)
  const p = w.player
  p.x = 20 * TILE + 5
  w.player.invuln = 9999
  const events = []
  until(w, ['up'], () => w.warp !== null, 10, input, events)
  ok(w.warp && w.warp.mode === 'door', 'up at the door did not start a door warp')
  ok(sfx(events, 'door'), "no 'door' sound")
  until(w, ['up'], () => w.warp === null, 100, input, events)
  eq(w.area.id, 'bonus', 'area')
  eq(p.x + p.w / 2, 18 * TILE + TILE / 2, 'x at the marker')
  eq(feet(w), 9 * TILE, 'feet at the marker')
  // Elsewhere, up does nothing.
  const far = twoAreas()
  const farInput = settle(far)
  for (let i = 0; i < 10; i++) stepWorld(far, farInput(['up']))
  eq(far.warp, null, 'up away from any door started a warp')
})

test('checkpoint: touching it sets the retry point; a retry starts there with flags and tokens kept', () => {
  const w = flat(['  @      k       $'])
  const input = settle(w)
  const events = []
  until(w, ['right'], () => w.checkpoint !== null, 300, input, events)
  const flag = find(w, 'checkpoint')
  eq(flag.state, 'on', 'checkpoint state')
  ok(has(events, 'checkpoint'), "no 'checkpoint' event")
  ok(sfx(events, 'checkpoint'), "no 'checkpoint' sound")
  eq(w.checkpoint.areaId, 'main', 'checkpoint area')
  eq(w.checkpoint.x, 9 * TILE + TILE / 2, 'checkpoint x')
  eq(w.checkpoint.y, 10 * TILE, 'checkpoint y')
  until(w, ['right'], () => w.stats.tokens[0], 300, input)
  sim.setFlag(w, 'gate', 2)
  sim.grimePlayer(w)

  const retry = createWorld(w.level, { session: w.session, checkpoint: w.checkpoint, flags: w.flags, tokens: w.stats.tokens })
  eq(retry.player.x + retry.player.w / 2, 9 * TILE + TILE / 2, 'retry x')
  eq(feet(retry), 10 * TILE, 'retry feet')
  eq(retry.status, 'play', 'retry status')
  eq(retry.player.pips, 3, 'retry pips')
  eq(sim.getFlag(retry, 'gate'), 2, 'flag kept')
  eq(sim.getFlag(retry, 'nope'), 0, 'unset flag reads 0')
  eq(retry.stats.tokens[0], true, 'token kept')
  eq(find(retry, 'checkpoint').state, 'on', 'the flag is already up on the retry')
  eq(find(retry, 'token').state, 'owned', 'the token shows as already found')
  eq(retry.timeLeft, 300 * 60, 'a full clock on the retry')
})

test('goal: the level is cleared and he walks off', () => {
  const w = flat(['  @        G'])
  const input = settle(w)
  const events = []
  until(w, ['right'], () => w.status !== 'play', 300, input, events)
  eq(w.status, 'clear', 'status')
  eq(w.exit, 'goal', 'exit')
  eq(w.player.state, 'clear', 'player state')
  ok(has(events, 'jingle', (e) => e.id === 'clear'), "no 'clear' jingle")
  const x0 = w.player.x
  const left = w.timeLeft
  for (let i = 0; i < 60; i++) stepWorld(w, input(['left']))
  ok(w.player.x > x0 + 20, 'no victory walk')
  eq(w.statusT, 60, 'statusT')
  eq(w.timeLeft, left, 'the clock stops')
  eq(w.player.facing, 1, 'input is ignored once the level is won')
})

test('secretExit: cleared by the secret way', () => {
  const w = flat(['  @        1'], { legend: { 1: { kind: 'secretExit' } } })
  const input = settle(w)
  const events = []
  until(w, ['right'], () => w.status !== 'play', 300, input, events)
  eq(w.status, 'clear', 'status')
  eq(w.exit, 'secret', 'exit')
  ok(has(events, 'secret'), "no 'secret' event")
  ok(has(events, 'jingle', (e) => e.id === 'secret'), "no 'secret' jingle")
})

test('clock: it warns, then time runs out', () => {
  const w = flat(['  @'], { time: 31 })
  const input = makeInput()
  const events = []
  eq(w.timeLeft, 31 * 60, 'ticks on the clock')
  until(w, [], () => w.timeLeft === 30 * 60, 100, input, events)
  ok(sfx(events, 'timeWarn'), "no 'timeWarn' at 30 seconds")
  const n = until(w, [], () => w.status !== 'play', 31 * 60, input, events)
  eq(n, 30 * 60, 'ticks from 30 s to time up')
  eq(w.status, 'timeup', 'status')
  eq(w.timeLeft, 0, 'timeLeft')
  eq(w.player.state, 'grimed', 'player state')
  ok(has(events, 'banner', (e) => e.text === 'TIME UP!'), "no 'TIME UP!' banner")
})

test('100 coins make an extra life', () => {
  const w = flat(['  @  o o'], { session: { coins: 98 } })
  const input = settle(w)
  const events = []
  until(w, ['right'], () => w.stats.coins === 2, 300, input, events)
  eq(w.session.coins, 0, 'session coins roll over')
  eq(w.session.lives, 4, 'lives')
  eq(w.stats.coins, 2, 'coins this level')
  ok(sfx(events, 'oneUp'), "no 'oneUp' sound")
  eq(w.session.score, 2 * TUNING.coinScore, 'coin score')
})

test('camera: looks ahead, stays inside the area, follows up and down in a tall area', () => {
  const row = '#'.repeat(80)
  const w = makeWorld(['  @', row, row])
  const input = settle(w)
  eq(w.camera.x, 0, 'camera x at the left edge')
  eq(w.camera.y, 12 * TILE - VIEW_H, 'a 12-row area sits on its bottom edge')
  until(w, ['right'], () => w.player.x > 30 * TILE, 900, input)
  near(w.camera.x + VIEW_W / 2 - (w.player.x + MAXX_W / 2), TUNING.camLookAhead, 0.01, 'look-ahead when running right')
  until(w, ['left'], () => w.camLook === -TUNING.camLookAhead, 200, input)
  until(w, ['right'], () => w.player.x >= 80 * TILE - MAXX_W, 2000, input)
  eq(w.camera.x, 80 * TILE - VIEW_W, 'camera x at the right edge')

  const rows = []
  for (let i = 0; i < 40; i++) rows.push('')
  rows[2] = '  @'
  rows[3] = '####'
  rows[39] = FLOOR
  const tall = makeWorld(rows)
  const tInput = settle(tall)
  eq(tall.camera.y, 0, 'tall area: camera starts at the top with him')
  let seen = true
  until(tall, ['right'], (x) => {
    const sy = x.player.y - x.camera.y
    if (sy < -1 || sy + MAXX_H > VIEW_H + 1) seen = false
    return x.player.onGround && x.player.y > 30 * TILE
  }, 900, tInput)
  ok(seen, 'he left the screen during the fall')
  eq(tall.camera.y, 40 * TILE - VIEW_H, 'tall area: camera at the bottom after the fall')
})

test('controller: the stick alone runs, aims, hovers, enters pipes and doors; hits rumble', () => {
  // No D-pad or keys at all: only axisX / axisY, plus the jump and spray buttons.
  const stick = (x, y, buttons = []) => [buttons, { axisX: x, axisY: y, device: 'gamepad' }]
  const w = twoAreas()
  const input = settle(w)
  const p = w.player
  const step = (x, y, buttons, n = 1) => {
    const [held, extra] = stick(x, y, buttons)
    for (let i = 0; i < n; i++) stepWorld(w, input(held, extra))
  }
  step(0.6, 0, [], 20)
  near(p.vx, TUNING.runSpeed * 0.6, 0.01, 'stick at 60% runs at 60% speed')
  step(0, 0, [], 30)
  // Stick up + spray aims up; stick down + spray in the air hovers.
  step(0, -1, ['spray'], 3)
  eq(p.aim, 'up', 'aim with the stick pushed up')
  ok(w.droplets.some((d) => d.vy < -200), 'no water going up')
  step(0, 0, ['jump'], 30)
  let hovered = 0
  for (let i = 0; i < 80 && !p.onGround; i++) {
    step(0, 1, ['spray'])
    if (p.hovering) hovered++
  }
  eq(hovered, TUNING.hoverTicks, 'hover ticks with the stick pulled down')
  // Stick up in front of the door: through it. Still held on the far side: he stays.
  w.droplets.length = 0
  const door = find(w, 'door')
  p.x = door.x + 3
  step(0, 0, [], 2)
  step(0, -1, [], 2)
  ok(w.warp && w.warp.mode === 'door', 'stick up at the door did not open it')
  step(0, -1, [], 120)
  eq(w.area.id, 'bonus', 'through the door')
  eq(w.warp, null, 'a held stick must not start another warp')
  // Stick down on the pipe in here: back to the first area.
  const pipe = find(w, 'pipe')
  p.x = pipe.x + 20
  p.y = pipe.y + pipe.h - MAXX_H
  step(0, 0, [], 2)
  step(0, 1, [], 3)
  ok(w.warp && w.warp.mode === 'pipe', 'stick down on the pipe did not start a warp')
  step(0, 1, [], 150)
  eq(w.area.id, 'main', 'back down the pipe')
  eq(w.warp, null, 'a held stick sent him straight back down')

  // Rumble: a brick, a washed car, a hit, and being grimed all shake the pad.
  const rumbles = (events) => events.filter((ev) => ev.type === 'rumble')
  const brick = bump('B')
  ok(rumbles(brick.events).length > 0, 'no rumble for a broken brick')
  const cars = flat(['  @     c'], { session: { pips: 2 } })
  const carInput = settle(cars)
  const events = []
  until(cars, [], () => cars.player.pips < 2, 600, carInput, events)
  const hit = rumbles(events)
  ok(hit.length > 0 && hit[0].strong >= 0.5 && hit[0].ms > 0, 'no strong rumble for a hit')
  events.length = 0
  until(cars, [], () => cars.status !== 'play', 900, carInput, events)
  ok(rumbles(events).some((ev) => ev.strong === 1), 'no full rumble for being grimed')
  const wash = flat(['  @            c'])
  const washInput = settle(wash)
  events.length = 0
  until(wash, ['spray'], () => find(wash, 'car').state === 'clean', 900, washInput, events)
  ok(rumbles(events).length > 0, 'no rumble for a washed car')
  ok(events.filter((ev) => ev.type === 'rumble').every((ev) => ev.strong >= 0 && ev.strong <= 1 && ev.weak >= 0 && ev.weak <= 1), 'rumble magnitudes must be 0..1')
})

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

test('validateLevel reports what is wrong with a broken level', () => {
  const bad = {
    id: 'bad',
    site: 'BAD',
    name: 'Bad',
    time: 100,
    music: 'sunny',
    areas: [
      { id: 'a', theme: 'lot', rows: ['    ', '  Q ', '####', '###'], legend: { 1: { kind: 'pipe', props: { to: 'b:nowhere' } }, 2: { kind: 'door', props: { to: 'zzz:x' } } } },
      { id: 'b', theme: 'lot', rows: Array(12).fill('  1 2  q            '), legend: { 1: { kind: 'pipe', props: { to: 'b:nowhere' } }, 2: { kind: 'door', props: { to: 'zzz:x' } }, q: { kind: 'gizmo' } } },
    ],
  }
  const { errors, warnings } = validateLevel(bad)
  const need = (list, text, what) => ok(list.some((s) => s.includes(text)), `${what} not reported (looked for "${text}" in ${JSON.stringify(list)})`)
  need(errors, 'ragged', 'ragged rows')
  need(errors, 'at least 12', 'fewer than 12 rows')
  need(errors, "unknown character 'Q'", 'unknown character')
  need(errors, "no '@'", "missing '@'")
  need(errors, 'no goal or secretExit', 'missing exit')
  need(errors, "marker 'nowhere'", 'warp to a missing marker')
  need(errors, "area 'zzz'", 'warp to a missing area')
  need(warnings, "'gizmo'", 'unregistered kind')
  // It must still load and run.
  const w = createWorld(bad, { session: freshSession() })
  for (let i = 0; i < 30; i++) stepWorld(w, makeInput()([]))

  const good = validateLevel(makeLevel(['  @   $ $ $    G', FLOOR, FLOOR]))
  eq(good.errors.length, 0, `errors for a good level: ${good.errors.join('; ')}`)
  eq(good.warnings.length, 0, `warnings for a good level: ${good.warnings.join('; ')}`)
  // Mudzilla completes its level itself, so it is the way out of MW08: no goal needed.
  const boss = validateLevel(makeLevel(['  @   $ $ $    1', FLOOR, FLOOR], { legend: { 1: { kind: 'mudzilla' } } }))
  eq(boss.errors.length, 0, `a level whose only exit is Mudzilla: ${boss.errors.join('; ')}`)
})

test('the sandbox level is valid, uses every tile and every core kind, and its pipe works', () => {
  const sandbox = levels.sandboxLevel
  const report = validateLevel(sandbox)
  eq(report.errors.length, 0, `sandbox errors: ${report.errors.join('; ')}`)
  // The critter corner holds kinds other modules add; until they do, those are warned about and skipped.
  const real = report.warnings.filter((s) => !s.includes('no registered behaviour'))
  eq(real.length, 0, `sandbox warnings: ${real.join('; ')}`)
  const waiting = report.warnings.filter((s) => !real.includes(s)).map((s) => s.split("'")[1])
  if (waiting.length) notes.push(`sandbox: critter kinds not registered yet (skipped): ${waiting.join(', ')}`)
  ok(sandbox.areas.length >= 2, 'the sandbox needs two areas')
  const text = sandbox.areas.map((a) => a.rows.join('')).join('')
  for (const ch of contract.TILE_CHARS) ok(text.includes(ch), `the sandbox does not use tile '${ch}'`)
  const kinds = new Set()
  const variants = new Set()
  for (const area of sandbox.areas) {
    for (const row of area.rows) {
      for (const ch of row) {
        const spec = (area.legend && area.legend[ch]) || contract.DEFAULT_LEGEND[ch]
        if (!spec || sim.TILE_INFO[ch]) continue
        kinds.add(spec.kind)
        if (spec.kind === 'car') variants.add(spec.variant)
      }
    }
  }
  const core = ['coin', 'token', 'bubble', 'turbo', 'wax', 'oneup', 'checkpoint', 'goal', 'secretExit', 'pipe', 'door', 'marker', 'spring', 'lift', 'sign', 'spawner', 'car']
  for (const kind of core) ok(kinds.has(kind), `the sandbox does not place a '${kind}'`)
  for (const v of Object.keys(TUNING.cars)) ok(variants.has(v), `the sandbox has no '${v}' car`)
  for (const kind of [...core, 'clod']) ok(sim.hasBehavior(kind), `no behaviour registered for '${kind}'`)

  const w = createWorld(sandbox, { session: freshSession() })
  ok(w.stats.carsTotal >= 7, `carsTotal ${w.stats.carsTotal}`)
  const input = settle(w)
  // Every area can be entered and stepped.
  for (const area of sandbox.areas) {
    const marker = w.areas[area.id].spawns.find((sp) => sp.spec.props && sp.spec.props.name)
    if (area.id === w.area.id || !marker) continue
    ok(sim.warpTo(w, `${area.id}:${marker.spec.props.name}`, 'door'), `cannot warp to ${area.id}`)
    until(w, [], () => w.warp === null, 200, input)
    eq(w.area.id, area.id, 'area after warpTo')
    for (let i = 0; i < 120; i++) stepWorld(w, input(['right']))
  }
})

test('every level in levels/index.ts, dev rooms included, loads, validates without errors, and steps in every area', () => {
  const real = [...levels.LEVELS, ...(levels.RIVALS ? [levels.RIVALS] : [])]
  // The dev rooms hold the kinds no shipping level has yet (bosses, rivals): they get the same treatment.
  const list = [...real, ...levels.DEV_LEVELS]
  ok(levels.DEV_LEVELS.length > 0, 'no dev levels were found')
  for (const level of list) {
    const report = validateLevel(level)
    eq(report.errors.length, 0, `${level.id}: ${report.errors.join('; ')}`)
    if (real.includes(level)) for (const warning of report.warnings) notes.push(`level ${level.id} warning: ${warning}`)
    const w = createWorld(level, { session: freshSession() })
    const input = makeInput()
    const walk = (n) => {
      for (let i = 0; i < n; i++) {
        stepWorld(w, input(i % 90 < 60 ? ['right'] : ['right', 'jump', 'spray']))
        w.events.length = 0
        checkWorld(w, i)
        if (w.status !== 'play') break
      }
    }
    walk(300)
    // Every other area, from wherever it can be arrived at.
    for (const area of level.areas) {
      if (w.status !== 'play' || area.id === w.area.id) continue
      const marker = w.areas[area.id].spawns.find((sp) => sp.spec.props && typeof sp.spec.props.name === 'string')
      if (!marker || !sim.warpTo(w, `${area.id}:${marker.spec.props.name}`, 'door')) continue
      until(w, [], () => w.warp === null, 200, input)
      eq(w.area.id, area.id, `${level.id}: the area after warpTo`)
      walk(200)
    }
  }
  notes.push(`levels checked besides the sandbox: ${real.length ? real.map((l) => l.id).join(', ') : 'none yet'}; dev rooms: ${levels.DEV_LEVELS.map((l) => l.id).join(', ')}`)
})

/* ------------------------------------------------------------------ */
/* More of the framework: 'full' solids, riders, the odds and ends     */
/* ------------------------------------------------------------------ */

// A crate other modules might build: solid on every side, optionally sliding.
sim.registerEntity('testcrate', {
  alwaysActive: true,
  init(e) {
    sim.setBox(e, 32, 32, sim.propNum(e, 'lift', 0))
    e.solid = 'full'
    e.gravity = 0
    e.collides = false
  },
  update(e) {
    e.x += sim.propNum(e, 'vx', 0) / 60
  },
})

test("a 'full' solid entity is a wall, a floor and a ceiling, and shoves him when it moves", () => {
  const legend = { 1: { kind: 'testcrate' }, 2: { kind: 'testcrate', props: { lift: 96 } }, 3: { kind: 'testcrate', props: { vx: 60 } } }
  // Wall.
  let w = flat(['  @     1'], { legend })
  let input = settle(w)
  let crate = find(w, 'testcrate')
  for (let i = 0; i < 90; i++) stepWorld(w, input(['right']))
  eq(w.player.x, crate.x - MAXX_W, 'stopped flush against its side')
  eq(w.player.hitWall, 1, 'hitWall')
  // Floor: hop onto it and stand.
  until(w, ['right', 'jump'], () => w.player.vy < 0, 5, input)
  until(w, ['right'], () => w.player.onGround, 100, input)
  eq(feet(w), crate.y, 'stands on top of it')
  eq(w.player.ridingId, crate.id, 'ridingId')
  // Ceiling: no block is bumped, he just stops.
  w = flat(['  @'], { legend })
  input = settle(w)
  crate = sim.spawn(w, 'testcrate', w.player.x + 11, 10 * TILE - 96)
  stepWorld(w, input([]))
  let top = Infinity
  const events = []
  for (let i = 0; i < 50; i++) {
    stepWorld(w, input(['jump']))
    events.push(...w.events)
    w.events.length = 0
    top = Math.min(top, w.player.y)
  }
  eq(top, crate.y + crate.h, 'his head stops at its underside')
  ok(!sfx(events, 'bump'), 'an entity overhead is not a block to bump')
  // Shove: a crate sliding right at 60 px/s pushes him along.
  w = flat(['  3   @'], { legend })
  input = settle(w)
  crate = find(w, 'testcrate')
  const x0 = w.player.x
  for (let i = 0; i < 240; i++) {
    stepWorld(w, input([]))
    ok(w.player.x >= crate.x + crate.w - 1.01, 'the crate slid into him at tick ' + i)
  }
  near(w.player.x - x0, 60 * 4 - (x0 - (crate.spawnX + crate.w)), 2, 'pushed along for the rest of four seconds')
})

test('entities ride lifts and washed cars too', () => {
  const legend = { 1: { kind: 'lift', props: { dx: 6, speed: 90, wait: 5 } }, 3: { kind: 'testblob', props: { still: true } } }
  const w = makeWorld(['  @', '', '', '          3', '          1', '', '', '', FLOOR, FLOOR], { legend })
  const input = makeInput()
  const lift = find(w, 'lift')
  const blob = find(w, 'testblob')
  until(w, [], () => blob.onGround, 60, input)
  const offset = blob.x - lift.x
  for (let i = 0; i < 300; i++) {
    stepWorld(w, input([]))
    near(blob.x - lift.x, offset, 1e-9, 'rider offset on the lift, tick ' + i)
    eq(blob.y + blob.h, lift.y, 'rider on the lift, tick ' + i)
  }
  ok(Math.abs(blob.x - blob.spawnX) > TILE || lift.vars.t > 0, 'the lift never moved')
})

test('a car ahead that Maxx runs away from sleeps and wakes again; it is not removed', () => {
  const row = '#'.repeat(200)
  const w = makeWorld(['                                                  @                 n', row, row])
  const input = settle(w)
  const van = find(w, 'car')
  until(w, ['right'], () => van.active, 300, input)
  ok(van.active, 'the van never woke')
  until(w, ['left'], () => !van.active || van.dead, 900, input)
  ok(!van.dead, 'a car still heading for the screen was removed')
  eq(van.active, false, 'the van should be asleep far off screen')
  const x = van.x
  for (let i = 0; i < 60; i++) stepWorld(w, input([]))
  eq(van.x, x, 'asleep means still')
  until(w, ['right'], () => van.active, 900, input)
  ok(van.active, 'the van did not wake when he came back')
})

test('turbo washes twice as fast', () => {
  const washTicks = (turbo) => {
    const w = flat(['  @     n'], { session: { turbo } })
    const input = settle(w)
    const van = find(w, 'car')
    van.vars.speed = 0
    let first = 0
    for (let i = 1; i < 600; i++) {
      stepWorld(w, input(['spray']))
      if (!first && van.hp < van.maxHp) first = i
      if (van.state === 'clean') return i - first
    }
    return Infinity
  }
  const plain = washTicks(false)
  const turbo = washTicks(true)
  near(plain, 44 * 2, 3, 'ticks to wash a van (44 dirt, a droplet every 2 ticks)')
  near(turbo, 44 / 2 / 0.75, 3, 'ticks to wash a van with the turbo nozzle')
})

test('helper API: tiles, random, sound gate, boss bar, push, spawn, look-ups', () => {
  const w = makeWorld(['  @      X', '    PPP  X', FLOOR, FLOOR])
  const input = settle(w)
  // Tiles.
  eq(sim.tileAt(w, 9, 9), 'X', 'tileAt')
  eq(sim.tileAt(w, -1, 9) + sim.tileAt(w, 9, 99) + sim.tileAt(w, 9999, 0), '   ', 'tileAt outside the area')
  eq(sim.solidAt(w, 9 * TILE + 3, 9 * TILE + 3), true, 'solidAt on a block')
  eq(sim.solidAt(w, 8 * TILE + 3, 9 * TILE + 3), false, 'solidAt in the air')
  eq(sim.solidAt(w, -50, 0), false, 'solidAt outside')
  sim.setTile(w, 8, 9, 'B')
  eq(sim.tileAt(w, 8, 9), 'B', 'setTile')
  sim.setTile(w, 8, 9, 'z')
  eq(sim.tileAt(w, 8, 9), 'B', 'setTile ignores a non-tile character')
  sim.setTile(w, 8, 9, ' ')
  eq(sim.tileInfoAt(w, 9, 9).solid, true, 'tileInfoAt')
  eq(sim.TILE_INFO['='].oneWay && sim.TILE_INFO['<'].conveyor === -1 && sim.TILE_INFO.H.hidden && sim.TILE_INFO.B.breakable && sim.TILE_INFO['~'].hazard === 'sludge', true, 'TILE_INFO')
  eq(Object.keys(sim.TILE_INFO).sort().join(''), [...contract.TILE_CHARS].sort().join(''), 'TILE_INFO covers exactly TILE_CHARS')
  const span = sim.pipeSpan(w, 5, 9)
  eq(span && span.x + ',' + span.w, 4 * TILE + ',' + 3 * TILE, 'pipeSpan')
  eq(sim.pipeSpan(w, 9, 9), null, 'pipeSpan off a pipe')
  eq(sim.areaWidth(w) + 'x' + sim.areaHeight(w), 60 * TILE + 'x' + 12 * TILE, 'area size')
  // Random.
  const a = createWorld(w.level, { session: freshSession(), seed: 42 })
  const b = createWorld(w.level, { session: freshSession(), seed: 42 })
  const seqA = Array.from({ length: 50 }, () => sim.rand(a))
  const seqB = Array.from({ length: 50 }, () => sim.rand(b))
  eq(seqA.join(), seqB.join(), 'rand: same seed, same numbers')
  ok(seqA.every((n) => n >= 0 && n < 1) && new Set(seqA).size === 50, 'rand: 50 different numbers in [0, 1)')
  const r = sim.randRange(a, 5, 6)
  ok(r >= 5 && r < 6, 'randRange')
  const ints = new Set(Array.from({ length: 200 }, () => sim.randInt(a, 1, 3)))
  eq([...ints].sort().join(), '1,2,3', 'randInt')
  // Events.
  w.events.length = 0
  sim.sfxEvery(w, 'splat', 10)
  sim.sfxEvery(w, 'splat', 10)
  eq(w.events.length, 1, 'sfxEvery gates a repeat')
  sim.fx(w, 'splash', 1, 2, 3)
  sim.popup(w, 'CLEAN!', 4, 5)
  sim.banner(w, 'HELLO', 60)
  sim.versus(w, { id: 77 }, 'MUDSLINGER', 'KING OF THE CAR PARK')
  eq(JSON.stringify(w.events.slice(1)), JSON.stringify([{ type: 'fx', fx: 'splash', x: 1, y: 2, n: 3 }, { type: 'popup', text: 'CLEAN!', x: 4, y: 5 }, { type: 'banner', text: 'HELLO', ticks: 60 }, { type: 'versus', id: 77, name: 'MUDSLINGER', tagline: 'KING OF THE CAR PARK' }]), 'event shapes')
  w.events.length = 0
  // Boss bar.
  sim.setBoss(w, 'MUDZILLA', 30, 40)
  eq(JSON.stringify(w.boss), JSON.stringify({ name: 'MUDZILLA', hp: 30, maxHp: 40 }), 'setBoss')
  sim.setBoss(w, 'MUDZILLA', 29, 40)
  eq(w.boss.hp, 29, 'setBoss updates')
  sim.clearBoss(w)
  eq(w.boss, null, 'clearBoss')
  // Entities.
  eq(sim.spawn(w, 'no-such-kind', 100, 100), null, 'spawn of an unknown kind')
  const coin = sim.spawn(w, 'coin', 12 * TILE, 5 * TILE)
  ok(coin && coin.active && w.entities.includes(coin), 'spawn adds an awake entity')
  eq(sim.entityById(w, coin.id), coin, 'entityById')
  eq(sim.countAlive(w, 'coin'), 1, 'countAlive')
  ok(sim.inView(coin, w) && !sim.inView({ x: 5000, y: 0, w: 10, h: 10 }, w), 'inView')
  near(sim.distToPlayer(coin, w), Math.hypot(sim.dxToPlayer(coin, w), sim.dyToPlayer(coin, w)), 1e-9, 'distToPlayer')
  ok(sim.dxToPlayer(coin, w) < 0 && sim.dyToPlayer(coin, w) > 0, 'dxToPlayer / dyToPlayer signs')
  const c = sim.playerCenter(w)
  eq(c.x + ',' + c.y, w.player.x + MAXX_W / 2 + ',' + (w.player.y + MAXX_H / 2), 'playerCenter')
  sim.kill(coin)
  stepWorld(w, input([]))
  eq(sim.entityById(w, coin.id), null, 'a killed entity is gone after the tick')
  // Push (a blower): moves him, stops at a wall.
  const x0 = w.player.x
  sim.pushPlayer(w, 10)
  eq(w.player.x, x0 + 10, 'pushPlayer')
  sim.pushPlayer(w, 900)
  eq(w.player.x, 4 * TILE - MAXX_W, 'pushPlayer stops at a wall')
  // Launch (a geyser): the full height whatever the jump button does.
  sim.launchPlayer(w, 600)
  let top = w.player.y
  until(w, [], (x) => ((top = Math.min(top, x.player.y)), x.player.onGround), 200, input)
  near(10 * TILE - MAXX_H - top, (600 * 600) / (2 * TUNING.gravRise), 2, 'launchPlayer height')
})

test("boss music: the fight's song is the song of the moment; wax running out hands back to it; clearBoss and leaving the area end it", () => {
  const w = twoAreas()
  const input = settle(w)
  const songs = (events) => events.filter((ev) => ev.type === 'music').map((ev) => ev.id).join(',')
  w.events.length = 0
  sim.setBossMusic(w, 'boss')
  eq(songs(w.events), 'boss', 'setBossMusic asks for the song at once')
  eq(sim.areaMusic(w), 'boss', 'areaMusic during the fight')
  w.events.length = 0
  sim.giveWax(w, 30)
  eq(sim.areaMusic(w), 'wax', 'areaMusic while waxed')
  const seen = []
  until(w, [], () => w.player.wax === 0, 60, input, seen)
  eq(songs(seen), 'wax,boss', 'the wax tune, then straight back to the fight (never the level song in between)')
  w.events.length = 0
  sim.clearBoss(w)
  eq(w.bossMusic, null, 'clearBoss ends the fight song')
  eq(w.events.length, 0, 'clearBoss asks for no music itself')
  eq(sim.areaMusic(w), 'sunny', 'areaMusic after the fight')
  // Leaving the area mid-fight ends it too, and the new area's song is asked for.
  sim.setBossMusic(w, 'rival')
  w.events.length = 0
  ok(sim.warpTo(w, 'bonus:room', 'door'), 'cannot go through the door')
  const trip = []
  until(w, [], () => w.warp === null, 200, input, trip)
  eq(w.bossMusic, null, 'the fight song outlived the area')
  eq(songs(trip), 'bonus', 'songs asked for on the way into the next area')
  ok(worldHash(w) !== (sim.setBossMusic(w, 'boss'), worldHash(w)), 'the fight song is not in the world hash')
})

test('completeLevel { walk: false }: no victory walk; stopAt coasts him to rest right there; in the air he drops straight down', () => {
  // Walking by default.
  let w = flat()
  let input = settle(w)
  sim.completeLevel(w, 'goal')
  eq(w.clearWalk, true, 'clearWalk by default')
  const x0 = w.player.x
  for (let i = 0; i < 60; i++) stepWorld(w, input([]))
  ok(w.player.x > x0 + 40, 'no victory walk by default')
  // Coasting to a spot, from a full run, from both sides, on plain ground and on slick.
  for (const [floor, way] of [[FLOOR, 1], [FLOOR, -1], ['I'.repeat(60), 1]]) {
    w = makeWorld(['                     @', floor, FLOOR])
    input = settle(w)
    until(w, [way > 0 ? 'right' : 'left'], (x) => Math.abs(x.player.vx) >= TUNING.runSpeed * 0.99, 300, input)
    const p = w.player
    const stop = p.x + p.w / 2 + way * 46
    sim.completeLevel(w, 'secret', { walk: false, stopAt: stop })
    eq(w.status + ' ' + w.exit + ' ' + w.clearWalk, 'clear secret false', 'state after completeLevel')
    for (let i = 0; i < 200; i++) stepWorld(w, input([way > 0 ? 'right' : 'left', 'jump']))
    eq(p.vx, 0, 'he came to rest')
    near(p.x + p.w / 2, stop, 1.5, `rest point (${floor[0]} floor, heading ${way})`)
  }
  // In the air: straight down.
  w = flat()
  input = settle(w)
  until(w, ['right', 'jump'], (x) => x.player.vy >= 0 && !x.player.onGround, 120, input)
  const ax = w.player.x
  sim.completeLevel(w, 'secret', { walk: false, stopAt: ax + MAXX_W / 2 })
  until(w, ['right'], (x) => x.player.onGround, 120, input)
  eq(w.player.x, ax, 'drifted while dropping into the doorway')
  // No stopAt: he just coasts to a stop, no walk.
  w = flat()
  input = settle(w)
  until(w, ['right'], (x) => x.player.vx >= TUNING.runSpeed, 300, input)
  const x1 = w.player.x
  sim.completeLevel(w, 'goal', { walk: false })
  for (let i = 0; i < 100; i++) stepWorld(w, input([]))
  eq(w.player.vx, 0, 'he coasted to a stop')
  ok(w.player.x - x1 < 2 * m.stop.dist, `he went ${round(w.player.x - x1)} px: more than a stop from a run`)
})

// A boss of the tests' own: it soaks up water and writes down what each droplet was worth to it.
sim.registerEntity('testboss', {
  boss: true,
  init(e) {
    sim.setBox(e, 40, 60)
    e.gravity = 0
    e.collides = false
    e.vars.hits = 0
    e.vars.sum = 0
  },
  update() {},
  onSpray(e, w, d) {
    e.vars.hits++
    e.vars.sum += d.power
    return e.vars.pass !== 1
  },
})

test('turbo water: a boss or rival takes a turbo droplet at TUNING.turboBossPower, everything else at its full power', () => {
  const legend = { 1: { kind: 'testboss' }, 2: { kind: 'testboss' } }
  const w = flat(['  @    1'], { legend, session: { turbo: true } })
  const input = settle(w)
  const boss = find(w, 'testboss')
  for (let i = 0; i < 60; i++) stepWorld(w, input(['spray']))
  ok(boss.vars.hits > 10, `only ${boss.vars.hits} hits`)
  near(boss.vars.sum / boss.vars.hits, TUNING.turboBossPower, 1e-9, 'a turbo droplet on a boss')
  // A droplet the boss lets through keeps its full power for what is behind it.
  const behind = flat(['  @    1'], { legend, session: { turbo: true } })
  const bInput = settle(behind)
  const front = find(behind, 'testboss')
  front.vars.pass = 1
  const car = sim.spawn(behind, 'car', front.x + 60, 10 * TILE, { variant: 'van', props: { speed: 0 } })
  for (let i = 0; i < 60; i++) stepWorld(behind, bInput(['spray']))
  ok(front.vars.hits > 0 && car.hp < car.maxHp, 'the water never reached the car behind')
  ok((car.maxHp - car.hp) % TUNING.turboPower === 0, `the car behind took turbo water at less than full power (${car.maxHp - car.hp} dirt off)`)
  // Plain water is plain on a boss too.
  const plain = flat(['  @    1'], { legend })
  const pInput = settle(plain)
  const pb = find(plain, 'testboss')
  for (let i = 0; i < 60; i++) stepWorld(plain, pInput(['spray']))
  near(pb.vars.sum / pb.vars.hits, TUNING.dropletPower, 1e-9, 'a plain droplet on a boss')
  for (const kind of ['mudslinger', 'mudzilla', 'bill', 'streaks', 'ollie', 'nick']) ok(!sim.hasBehavior(kind) || sim.getBehavior(kind).boss === true, `'${kind}' is not marked as a boss`)
})

// A plinth of the tests' own: a 'full' block whose left half is 16 px lower than its right half.
const STEP_PROFILE = Object.freeze([...Array(32).fill(16), ...Array(32).fill(0)])
sim.registerEntity('testplinth', {
  init(e) {
    sim.setBox(e, 64, 48)
    e.solid = sim.propStr(e, 'solid', 'full')
    e.ground = STEP_PROFILE
    e.gravity = 0
    e.collides = false
  },
  update() {},
})

test('ground profiles: any solid entity can have one; Maxx lands on it, steps up and down it, and is not shoved out of a full one', () => {
  for (const solid of ['full', 'top']) {
    const legend = { 1: { kind: 'testplinth', props: { solid } } }
    const w = flat(['  @         1'], { legend })
    const input = settle(w)
    const s = find(w, 'testplinth')
    // Down onto the low half.
    place(w, s.x + 4, s.y - MAXX_H - 30)
    until(w, [], (x) => x.player.onGround, 60, input)
    eq(feet(w), s.y + 16, `${solid}: landed on the low half`)
    eq(w.player.ridingId, s.id, `${solid}: riding it`)
    for (let i = 0; i < 20; i++) stepWorld(w, input([]))
    eq(feet(w) + ',' + w.player.pips, s.y + 16 + ',3', `${solid}: stood still there, unhurt`)
    // Up the step, along the top, and off the far end.
    until(w, ['right'], (x) => feet(x) === s.y, 60, input)
    eq(feet(w), s.y, `${solid}: stepped up onto the high half`)
    eq(w.player.ridingId, s.id, `${solid}: still riding after the step up`)
    until(w, ['right'], (x) => x.player.onGround && feet(x) === 10 * TILE, 120, input)
    eq(feet(w), 10 * TILE, `${solid}: walked off the far end to the floor`)
    // Back from the floor: a 'full' one is a wall at its box, a 'top' one is walked through.
    for (let i = 0; i < 60; i++) stepWorld(w, input(['left']))
    if (solid === 'full') eq(w.player.x, s.x + s.w, 'full: stopped by its side')
    else ok(w.player.x < s.x + s.w, 'top: walked through it')
  }
})

test('levels: standIn plays a dev room under a real id (a copy, the room untouched) until it is undone', () => {
  const dev = levels.DEV_LEVELS.find((l) => l.id === 'dev-rivals-a') ?? levels.DEV_LEVELS[0]
  const before = levels.levelById('rivals')
  const stand = levels.standIn('rivals', dev.id)
  ok(stand && stand.id === 'rivals' && stand.areas === dev.areas, 'standIn gave no copy under the real id')
  eq(levels.levelById('rivals'), stand, 'levelById serves the stand-in')
  eq(levels.levelById(dev.id), dev, 'the room itself is still there under its own id')
  eq(dev.id.startsWith('dev-'), true, 'the room was renamed')
  eq(createWorld(levels.levelById('rivals'), { session: freshSession() }).level.id, 'rivals', 'a world of it carries the real id')
  eq(levels.standingIn().join(), 'rivals', 'standingIn')
  eq(levels.standIn('mw08', 'dev-no-such-room'), null, 'an unknown room')
  ok(levels.standIn('mw08', levels.sandboxLevel.id).id === 'mw08' && levels.levelById('mw08').areas === levels.sandboxLevel.areas, 'the sandbox as a stand-in')
  levels.standIn('rivals', null)
  levels.standIn('mw08', null)
  eq(levels.levelById('rivals'), before, 'undone')
  eq(levels.standingIn().length, 0, 'nothing left standing in')
})

test("save: the map's memory is on a new game, repaired from whatever was stored, and kept across a reload", () => {
  const { emptySave, repairSave, createSave } = saveModule
  const empty = { roads: [], beaten: 0, champion: false, node: '' }
  eq(JSON.stringify(emptySave().map), JSON.stringify(empty), 'a new game')
  eq(JSON.stringify(repairSave({ v: 1, unlocked: 3, levels: {} }).map), JSON.stringify(empty), 'an old save without one')
  eq(JSON.stringify(repairSave({ map: 'junk' }).map), JSON.stringify(empty), 'junk')
  const fixed = repairSave({ map: { roads: ['r0', 'r1', 'r1', '__proto__', 5, 'x'.repeat(40), 's0'], beaten: 9, champion: 'yes', node: 'constructor()' } })
  eq(JSON.stringify(fixed.map), JSON.stringify({ roads: ['r0', 'r1', 's0'], beaten: 4, champion: false, node: '' }), 'repaired')
  eq(repairSave({ map: { roads: Array.from({ length: 99 }, (_, i) => 'r' + i) } }).map.roads.length, 64, 'too many roads')
  const stored = new Map()
  const storage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) }
  const a = createSave('tester', storage)
  a.data.map.roads.push('r0', 'r1')
  a.data.map.beaten = 2
  a.data.map.node = 'mw02'
  a.commit()
  const b = createSave('tester', storage)
  eq(JSON.stringify(b.data.map), JSON.stringify({ roads: ['r0', 'r1'], beaten: 2, champion: false, node: 'mw02' }), 'after a reload')
  b.data.settings.music = 3
  b.reset()
  eq(JSON.stringify(b.data.map) + b.data.settings.music, JSON.stringify(empty) + 3, 'ERASE: the memory goes, the settings stay')
})

/* ------------------------------------------------------------------ */
/* The sandbox, played                                                 */
/* ------------------------------------------------------------------ */

/**
 * A simple player: run right, spray dirty cars from where it stands, jump
 * walls, gaps and hazards, wait for lifts over what it cannot jump.
 * Returns a function (world) => held actions.
 */
function makeBot() {
  let jumpHold = 0
  return function bot(w) {
    const p = w.player
    const feetY = p.y + p.h
    const right = p.x + p.w
    const cx = p.x + p.w / 2
    const liftAt = (x, y) => w.solids.find((s) => x >= s.x && x <= s.x + s.w && Math.abs(s.y - y) <= 6)
    // Safe to step to x? A drop onto floor is; a drop into sludge, onto spikes or out of the area is not.
    const safe = (x) => {
      if (liftAt(x, feetY)) return true
      const tx = Math.floor(x / TILE)
      for (let ty = Math.floor((feetY - 4) / TILE); ty < w.grid.h; ty++) {
        const t = sim.tileInfoAt(w, tx, ty)
        if (t.hazard !== 'none') return false
        if (t.solid || t.oneWay) return true
      }
      return false
    }
    const held = new Set()
    if (jumpHold > 0) {
      jumpHold--
      held.add('jump')
    }
    const car = w.entities.find((e) => e.kind === 'car' && e.state !== 'clean' && !e.dead && e.active && e.x + e.w > p.x && e.x - right < 235 && Math.abs(e.y + e.h - feetY) < 70)
    if (car && p.onGround) {
      if (car.x - right < 34 && car.h <= 60) {
        jumpHold = 26
        return ['jump', 'right']
      }
      held.add('spray')
      if (p.facing < 0) held.add('right')
      return [...held]
    }
    if (!p.onGround) {
      const lift = w.solids.find((s) => s.kind === 'lift' && Math.abs(s.x + s.w / 2 - cx) < 140 && s.y > p.y)
      if (lift && !safe(cx + 6) && !safe(cx + 40)) {
        const target = lift.x + lift.w / 2
        if (cx < target - 6) held.add('right')
        else if (cx > target + 6) held.add('left')
      } else {
        held.add('right')
      }
      if (p.vy < 0) held.add('jump')
      return [...held]
    }
    const riding = p.ridingId ? sim.entityById(w, p.ridingId) : null
    if (riding && riding.kind === 'lift') {
      let reach = 0
      for (let d = 8; d <= 5 * TILE && !reach; d += 8) {
        const x = riding.x + riding.w + d
        if (safe(x) && !liftAt(x, feetY)) reach = d
      }
      if (reach > 0 && reach <= 3 * TILE) {
        held.add('right')
        if (cx > riding.x + riding.w - 14) {
          held.add('jump')
          jumpHold = 20
        }
      } else {
        const target = riding.x + riding.w / 2
        if (cx < target - 6) held.add('right')
        else if (cx > target + 6) held.add('left')
      }
      return [...held]
    }
    let gapStart = -1
    for (let d = 2; d <= 40 && gapStart < 0; d += 6) if (!safe(right + d)) gapStart = d
    if (gapStart < 0) {
      held.add('right')
      if (p.hitWall === 1) {
        held.add('jump')
        jumpHold = 30
      }
      return [...held]
    }
    let width = 0
    for (let d = gapStart; d <= 12 * TILE; d += 8) {
      if (safe(right + d) && !liftAt(right + d, feetY)) break
      width = d - gapStart + 8
    }
    if (width <= 5 * TILE) {
      held.add('right')
      if (gapStart <= 14) {
        held.add('jump')
        jumpHold = 30
      }
      return [...held]
    }
    // Too wide to jump: walk to the edge, then wait there for a lift coming this way.
    if (gapStart > 20) {
      held.add('right')
      return [...held]
    }
    const lift = w.solids.find((s) => s.kind === 'lift' && s.x > p.x && s.x - right < 2.2 * TILE && Math.abs(s.y - feetY) < 3 * TILE && s.vx <= 0)
    if (lift) {
      held.add('right')
      held.add('jump')
      jumpHold = lift.y < feetY - 8 ? 14 : 6
    }
    return [...held]
  }
}

/** The sandbox without its critter corner, so this run does not depend on kinds other modules add. */
function sandboxWithoutCritters() {
  const sandbox = levels.sandboxLevel
  const [main, ...rest] = sandbox.areas
  return { ...sandbox, areas: [{ ...main, rows: main.rows.map((row) => row.replace(/[brwudizj]/g, ' ')) }, ...rest] }
}

test('a bot plays the sandbox from the start to the goal with real inputs', () => {
  const seen = { checkpoints: 0, hurt: 0, lifts: new Set(), floors: new Set(), clean: 0 }
  const play = (hashes) => {
    const world = createWorld(sandboxWithoutCritters(), { session: freshSession() })
    const input = makeInput()
    const bot = makeBot()
    let n = 0
    for (; n < 12000 && world.status === 'play'; n++) {
      stepWorld(world, input(bot(world)))
      if (!hashes) checkWorld(world, n + 1)
      if (hashes) {
        hashes.push(worldHash(world))
        world.events.length = 0
        continue
      }
      for (const ev of world.events) {
        if (ev.type === 'checkpoint') seen.checkpoints++
        if (ev.type === 'sfx' && ev.id === 'hurt') seen.hurt++
        if (ev.type === 'sfx' && ev.id === 'carClean') seen.clean++
      }
      world.events.length = 0
      if (world.player.ridingId) seen.lifts.add(sim.entityById(world, world.player.ridingId)?.kind)
      if (world.player.floor) seen.floors.add(world.player.floor)
    }
    return { world, n }
  }
  const { world: w, n: ticks } = play(null)
  // The whole level again, twice, hashed every tick: cars, the lift, the spawner, clods, all repeatable.
  const first = []
  const second = []
  play(first)
  play(second)
  eq(first.length, ticks, 'ticks on a replay')
  for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) throw new Error('two identical playthroughs differ at tick ' + (i + 1))
  notes.push('sandbox bot: ' + w.status + ' after ' + ticks + ' ticks (' + round(ticks / 60) + ' s), at column ' + tiles(w.player.x) + ', cars washed ' + w.stats.carsWashed + '/' + w.stats.carsTotal + ', hits taken ' + seen.hurt + ', pips ' + w.player.pips + ', score ' + w.stats.score)
  eq(w.status, 'clear', 'status at the end (he was at column ' + tiles(w.player.x) + ')')
  eq(w.exit, 'goal', 'exit')
  eq(seen.checkpoints, 2, 'checkpoints touched')
  ok(seen.lifts.has('lift'), 'never rode the lift over the sludge')
  eq([...seen.floors].sort().join(''), '<>IMO', 'floors he felt underfoot')
  ok(w.stats.carsWashed >= 7, 'washed only ' + w.stats.carsWashed + ' cars')
  eq(w.stats.carsWashed, seen.clean, 'carsWashed matches the cars heard coming clean')
})

test('the sandbox bonus room: down the pipe, up the lift to the token, back through the door', () => {
  const w = createWorld(levels.sandboxLevel, { session: freshSession() })
  const input = settle(w)
  const p = w.player
  eq(w.stats.carsTotal, 11, 'carsTotal: 7 placed and 4 from the spawner')
  // Onto the pipe in the main area.
  const pipe = find(w, 'pipe')
  p.x = pipe.x + 20
  p.y = pipe.y + pipe.h - MAXX_H
  stepWorld(w, input([]))
  until(w, ['down'], () => w.warp === null && w.area.id === 'bonus', 200, input)
  eq(w.area.id, 'bonus', 'down the pipe')
  eq(w.area.music, 'bonus', "the room's own music")
  stepWorld(w, input([]))
  // Along the floor for the coins, then under the lift and onto it as it comes down.
  until(w, ['right'], () => w.stats.coins === 3, 300, input)
  eq(w.stats.coins, 3, 'coins on the floor')
  const lift = find(w, 'lift')
  until(w, [], () => lift.vars.t === 0 && lift.state === 'wait', 2000, input)
  p.x = lift.x + lift.w / 2 - MAXX_W / 2
  p.y = lift.y - MAXX_H
  p.vx = 0
  let onScreen = true
  const ride = until(w, [], () => {
    if (p.y < w.camera.y || p.y + p.h > w.camera.y + VIEW_H) onScreen = false
    return lift.vars.t === 1
  }, 2000, input)
  ok(ride > 0, 'the lift never reached the top')
  eq(p.ridingId, lift.id, 'still on the lift at the top')
  ok(onScreen, 'the camera lost him on the way up')
  ok(w.camera.y < 150, 'the camera did not follow him up (camera y ' + round(w.camera.y) + ')')
  // Step off left onto the catwalk (the lift stops level with it) and take the token.
  until(w, ['left'], () => w.stats.tokens.some(Boolean), 300, input)
  ok(w.stats.tokens.some(Boolean), 'no token from the catwalk')
  eq(feet(w), 9 * TILE, 'on the catwalk')
  // Walk off, fall to the floor, and take the door home.
  until(w, ['right'], () => p.onGround && feet(w) === 20 * TILE, 600, input)
  const door = find(w, 'door')
  p.x = door.x + 3
  stepWorld(w, input([]))
  until(w, ['up'], () => w.warp === null && w.area.id === 'main', 200, input)
  eq(w.area.id, 'main', 'back through the door')
  const mainDoor = find(w, 'door')
  eq(p.x + p.w / 2, mainDoor.x + mainDoor.w / 2, 'arrives at the door in the main area')
})

/* ------------------------------------------------------------------ */
/* Determinism and speed                                               */
/* ------------------------------------------------------------------ */

/** Is any part of the box inside a solid tile? (It never should be.) */
function insideSolid(w, r) {
  const tx0 = Math.floor((r.x + 0.01) / TILE)
  const tx1 = Math.floor((r.x + r.w - 0.01) / TILE)
  const ty0 = Math.floor((r.y + 0.01) / TILE)
  const ty1 = Math.floor((r.y + r.h - 0.01) / TILE)
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (sim.tileInfoAt(w, tx, ty).solid) return `(${tx}, ${ty}) '${sim.tileAt(w, tx, ty)}'`
  return ''
}

/** Things that must hold on every tick of any run. Throws on the first that does not. */
function checkWorld(w, tick) {
  const p = w.player
  for (const [name, v] of [['x', p.x], ['y', p.y], ['vx', p.vx], ['vy', p.vy], ['camera x', w.camera.x], ['camera y', w.camera.y]]) {
    if (!Number.isFinite(v)) throw new Error(`tick ${tick}: player ${name} is ${v}`)
  }
  if (p.pips < 0 || p.pips > contract.MAX_PIPS) throw new Error(`tick ${tick}: pips ${p.pips}`)
  if (w.droplets.length > TUNING.maxDroplets) throw new Error(`tick ${tick}: ${w.droplets.length} droplets`)
  if (p.x < 0 || p.x + p.w > w.grid.w * TILE) throw new Error(`tick ${tick}: Maxx is outside the area at x=${p.x}`)
  if (w.status === 'play' && !w.warp) {
    const hit = insideSolid(w, p)
    if (hit) throw new Error(`tick ${tick}: Maxx at (${round(p.x)}, ${round(p.y)}) is inside solid tile ${hit}`)
  }
  const maxCam = Math.max(0, w.grid.w * TILE - VIEW_W)
  if (w.camera.x < 0 || w.camera.x > maxCam) throw new Error(`tick ${tick}: camera x ${w.camera.x} outside 0..${maxCam}`)
  for (const e of w.entities) {
    if (!Number.isFinite(e.x + e.y + e.vx + e.vy)) throw new Error(`tick ${tick}: ${e.kind} #${e.id} has a non-number position`)
    if (e.kind === 'car' && e.active) {
      const hit = insideSolid(w, e)
      if (hit) throw new Error(`tick ${tick}: ${e.variant} car at (${round(e.x)}, ${round(e.y)}) is inside solid tile ${hit}`)
    }
  }
}

/** A long, busy, repeatable input script. */
function busyScript(seed, steps) {
  let s = seed
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  const script = []
  for (let i = 0; i < steps; i++) {
    const held = []
    const r = next()
    if (r < 0.62) held.push('right')
    else if (r < 0.8) held.push('left')
    if (next() < 0.35) held.push('jump')
    if (next() < 0.5) held.push('spray')
    if (next() < 0.12) held.push('down')
    if (next() < 0.12) held.push('up')
    script.push([held, 1 + Math.floor(next() * 24), next() < 0.2 ? { axisX: next() * 2 - 1 } : undefined])
  }
  return script
}

test('determinism: the same inputs give the same world, tick for tick', () => {
  const play = (seed) => {
    // Played the way the play scene will: when an attempt ends, a new world from the checkpoint.
    let w = createWorld(levels.sandboxLevel, { session: freshSession(), seed: 7 })
    const hashes = []
    const input = makeInput()
    let attempts = 1
    const areas = new Set()
    for (const [held, count, extra] of busyScript(seed, 400)) {
      for (let i = 0; i < count; i++) {
        stepWorld(w, input(held, extra))
        w.events.length = 0
        hashes.push(worldHash(w))
        checkWorld(w, hashes.length)
        areas.add(w.area.id)
        if (w.status !== 'play' && w.statusT >= 40) {
          w = createWorld(levels.sandboxLevel, { session: w.session, checkpoint: w.checkpoint, flags: w.flags, tokens: w.stats.tokens, seed: 7 + attempts })
          attempts++
        }
      }
    }
    return { hashes, w, attempts, areas }
  }
  const a = play(11)
  const b = play(11)
  ok(a.hashes.length > 2000, `only ${a.hashes.length} ticks were played`)
  eq(a.hashes.length, b.hashes.length, 'ticks played')
  for (let i = 0; i < a.hashes.length; i++) if (a.hashes[i] !== b.hashes[i]) throw new Error(`worlds differ at tick ${i + 1}`)
  const c = play(12)
  ok(c.hashes[c.hashes.length - 1] !== a.hashes[a.hashes.length - 1], 'different inputs gave the same world: the hash is not looking')
  ok(new Set(a.hashes).size > a.hashes.length * 0.95, 'the hash barely changes from tick to tick')
  notes.push(`determinism: ${a.hashes.length} ticks twice over (${a.attempts} attempts, areas ${[...a.areas].join('+')}), final hash ${a.hashes[a.hashes.length - 1]}; Maxx ended at x=${Math.round(a.w.player.x)} in '${a.w.area.id}'`)

  // A different seed changes the random spread of the water, and so the world.
  const w1 = createWorld(levels.sandboxLevel, { session: freshSession(), seed: 1 })
  const w2 = createWorld(levels.sandboxLevel, { session: freshSession(), seed: 2 })
  run(w1, [[['spray'], 30]])
  run(w2, [[['spray'], 30]])
  ok(worldHash(w1) !== worldHash(w2), 'the seed makes no difference')
})

test('fuzz: random play started all over the sandbox never breaks an invariant', () => {
  // Start columns on plain ground in the main area, one per section, plus the bonus room.
  const starts = [2, 30, 60, 90, 100, 125, 140, 155, 172, 190, 212, 232, 255, 285, 310, 345, 384].map((col) => ({ areaId: 'main', x: col * TILE + TILE / 2, y: 10 * TILE }))
  starts.push({ areaId: 'bonus', x: 10 * TILE, y: 20 * TILE })
  let ticks = 0
  let ends = 0
  const areas = new Set()
  starts.forEach((checkpoint, i) => {
    for (const seed of [100 + i, 500 + i]) {
      let w = createWorld(levels.sandboxLevel, { session: freshSession(), checkpoint, seed })
      const input = makeInput()
      for (const [held, count, extra] of busyScript(seed, 150)) {
        for (let k = 0; k < count; k++) {
          stepWorld(w, input(held, extra))
          w.events.length = 0
          ticks++
          try {
            checkWorld(w, w.tick)
          } catch (err) {
            throw new Error('start ' + JSON.stringify(checkpoint) + ', seed ' + seed + ': ' + err.message)
          }
          areas.add(w.area.id)
          if (w.status !== 'play' && w.statusT >= 20) {
            ends++
            w = createWorld(levels.sandboxLevel, { session: freshSession(), checkpoint, seed: seed + ends })
          }
        }
      }
    }
  })
  notes.push('fuzz: ' + ticks + ' ticks of random input from ' + starts.length + ' starting points, ' + ends + ' attempts ended (grimed, time or clear), areas seen: ' + [...areas].join('+'))
  ok(ticks > 50000, 'only ' + ticks + ' ticks')
})

/**
 * Places to start an attempt at in a level, spread over all its areas: the feet of a Maxx
 * standing on the lowest floor of a column, with room for him above it. At most `most`.
 */
function startsOf(level, most) {
  const w = createWorld(level, { session: freshSession() })
  const spots = []
  for (const area of level.areas) {
    const g = w.areas[area.id].grid
    const flags = (tx, ty) => (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h ? 0 : sim.TILE_FLAGS[g.t[ty * g.w + tx]])
    const stand = sim.T_SOLID | sim.T_ONEWAY
    const open = (tx, ty) => !(flags(tx, ty) & (sim.T_SOLID | sim.T_HAZARD)) && !(flags(tx + 1, ty) & sim.T_SOLID)
    for (let tx = 1; tx < g.w - 2; tx += 3) {
      for (let ty = g.h - 1; ty >= 2; ty--) {
        if (!(flags(tx, ty) & stand) || !open(tx, ty - 1) || !open(tx, ty - 2)) continue
        spots.push({ areaId: area.id, x: tx * TILE + TILE / 2, y: ty * TILE })
        break
      }
    }
  }
  if (spots.length <= most) return spots
  // Evenly through the list, so every area gets its share.
  return Array.from({ length: most }, (_, i) => spots[Math.floor((i * spots.length) / most)])
}

/** Random play in a level from a start, retried from the checkpoint as the play scene does. Calls each(w, n) after every tick. */
function fuzzLevel(level, checkpoint, seed, steps, each) {
  let w = createWorld(level, { session: freshSession(), checkpoint, seed })
  const input = makeInput()
  let n = 0
  let ends = 0
  for (const [held, count, extra] of busyScript(seed, steps)) {
    for (let k = 0; k < count; k++) {
      stepWorld(w, input(held, extra))
      w.events.length = 0
      n++
      each(w, n)
      if (w.status !== 'play' && w.statusT >= 20) {
        ends++
        w = createWorld(level, { session: w.session, checkpoint: w.checkpoint ?? checkpoint, flags: w.flags, tokens: w.stats.tokens, seed: seed + ends })
      }
    }
  }
  return { ticks: n, ends }
}

test('fuzz: random play started all over every dev room (bosses, rivals, critters, hazards) never breaks an invariant', () => {
  let ticks = 0
  let ends = 0
  const kinds = new Set()
  const lines = []
  for (const level of levels.DEV_LEVELS) {
    const starts = startsOf(level, 10)
    ok(starts.length > 0, `${level.id}: nowhere to start`)
    let mine = 0
    starts.forEach((checkpoint, i) => {
      for (const seed of [300 + i, 700 + i]) {
        const r = fuzzLevel(level, checkpoint, seed, 50, (w, n) => {
          try {
            checkWorld(w, n)
          } catch (err) {
            throw new Error(`${level.id}, start ${JSON.stringify(checkpoint)}, seed ${seed}: ${err.message}`)
          }
          if (n % 30 === 0) for (const e of w.solids.concat(w.actives)) kinds.add(e.kind)
        })
        mine += r.ticks
        ends += r.ends
      }
    })
    ticks += mine
    lines.push(`${level.id} ${mine}`)
  }
  notes.push(`dev-room fuzz: ${ticks} ticks (${lines.join(', ')}), ${ends} attempts ended; kinds seen awake: ${kinds.size}`)
  for (const kind of ['mudslinger', 'mudzilla', 'bill', 'streaks', 'ollie', 'nick', 'bird', 'drip', 'brush', 'jet', 'gate']) ok(!sim.hasBehavior(kind) || kinds.has(kind), `the fuzz never woke a '${kind}'`)
})

test('determinism: every dev room, the same inputs give the same world, tick for tick', () => {
  const lines = []
  for (const level of levels.DEV_LEVELS) {
    // From the level's own start, and from two places further in (an arena is usually there).
    const starts = [null, ...startsOf(level, 3).slice(1)]
    let n = 0
    starts.forEach((checkpoint, i) => {
      const play = () => {
        const hashes = []
        fuzzLevel(level, checkpoint, 41 + i, 60, (w) => hashes.push(worldHash(w)))
        return hashes
      }
      const a = play()
      const b = play()
      eq(a.length, b.length, `${level.id}: ticks played`)
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) throw new Error(`${level.id}, start ${JSON.stringify(checkpoint)}: the worlds differ at tick ${k + 1}`)
      n += a.length
    })
    lines.push(`${level.id} ${n}`)
  }
  notes.push(`dev-room determinism: ${lines.join(', ')} ticks, twice each`)
})

test('speed: a busy world steps well inside a 60 Hz frame', () => {
  const row = '#'.repeat(400)
  const stuff = '  @ ' + 'c o 1 o s o 1 '.repeat(28)
  const w = makeWorld([stuff, row, row], { legend: BLOB, time: 9999 })
  const input = makeInput()
  for (const e of w.entities) e.active = true
  const n = w.entities.length
  const t0 = performance.now()
  const ticks = 3000
  for (let i = 0; i < ticks; i++) {
    w.player.invuln = 99
    stepWorld(w, input(i % 50 < 40 ? ['right', 'spray'] : ['right', 'jump', 'spray']))
    w.events.length = 0
  }
  const ms = (performance.now() - t0) / ticks
  notes.push(`speed: ${round(ms * 1000)} microseconds per tick along a level with ${n} entities placed (a 60 Hz frame is 16667)`)
  ok(ms < 2, `${round(ms)} ms per tick`)

  // The worst case: everything awake on one screen, the gun running.
  const crowd = flat(['  @'], { legend: BLOB, time: 9999 })
  const crowdInput = settle(crowd)
  for (let i = 0; i < 300; i++) {
    const kind = i % 10 === 0 ? 'car' : i % 3 === 0 ? 'coin' : 'testblob'
    sim.spawn(crowd, kind, 140 + (i % 50) * 9, 10 * TILE - (i % 7) * 30, { variant: 'compact', props: { dirt: 9999 } })
  }
  let awake = 0
  const t1 = performance.now()
  for (let i = 0; i < 600; i++) {
    crowd.player.invuln = 99
    stepWorld(crowd, crowdInput(['spray']))
    crowd.events.length = 0
    awake = Math.max(awake, crowd.solids.length + crowd.actives.length)
  }
  const crowdMs = (performance.now() - t1) / 600
  notes.push(`speed: ${round(crowdMs * 1000)} microseconds per tick with ${awake} entities awake on one screen`)
  ok(awake >= 250, `only ${awake} entities were awake`)
  ok(crowdMs < 4, `${round(crowdMs)} ms per tick with a crowd`)
})

/* ------------------------------------------------------------------ */
/* Second pair of eyes: the review's adversarial tests                 */
/* ------------------------------------------------------------------ */

const WASH = { x: 0, y: 0, vx: 0, vy: 0, life: 1, power: 9999 }
const washNow = (w, car) => sim.getBehavior('car').onSpray(car, w, WASH)
const jumpsIn = (events) => events.filter((ev) => ev.type === 'sfx' && ev.id === 'jump').length
/** Put Maxx's box at a spot, at rest. */
function place(w, x, y) {
  const p = w.player
  p.x = x
  p.y = y
  p.vx = 0
  p.vy = 0
}
/** Step once, with every tick's invariants checked. Returns the tick's events. */
function stepChecked(w, frame, what) {
  stepWorld(w, frame)
  const events = w.events.slice()
  w.events.length = 0
  if (w.status === 'play' && !w.warp) {
    const hit = insideSolid(w, w.player)
    if (hit) throw new Error(`${what}: Maxx at (${round(w.player.x)}, ${round(w.player.y)}) is inside solid tile ${hit}`)
  }
  return events
}

/**
 * How many take-off ticks (out of 23 tried around the edge) get a running jump across a pit `gap`
 * tiles wide. hover: false; true, held from the top of the jump; a function of the tick since the
 * take-off, a pattern of presses; 'best', held from whichever tick works.
 */
function pitWindow(gap, { hover = false, up = 0 } = {}) {
  const runway = 14
  const row = '#'.repeat(runway) + ' '.repeat(gap) + '#'.repeat(30)
  // up: the far side is a cliff whose top is that many tiles above the take-off (below if negative).
  const rows = ['  @', row, row]
  if (up !== 0) {
    rows.length = 0
    const take = 6 + Math.max(0, up)
    for (let r = 0; r <= Math.max(take, take - up) + 2; r++) rows.push((r >= take ? '#' : ' ').repeat(runway) + ' '.repeat(gap) + (r >= take - up ? '#' : ' ').repeat(30))
    rows[take - 1] = '  @' + rows[take - 1].slice(3)
  }
  const mk = () => makeWorld(rows)
  // makeLevel pads short areas with rows on top.
  const landY = (Math.max(0, 12 - rows.length) + rows.findIndex((r) => r.endsWith('#'))) * TILE
  const probe = mk()
  const leaves = until(probe, ['right'], (x) => !x.player.onGround && x.tick > 20, 600, settle(probe))
  const across = (w, input, on) => {
    const p = w.player
    for (let i = 0; i < 300 && w.status === 'play'; i++) {
      const held = ['right', 'jump']
      if (on(i, p)) held.push('down', 'spray')
      stepWorld(w, input(held))
      w.events.length = 0
      if (p.onGround && p.x > (runway + gap) * TILE - MAXX_W && (up === 0 || feet(w) === landY)) return true
    }
    return false
  }
  let works = 0
  for (let late = -12; late <= 10; late++) {
    const w = mk()
    const input = settle(w)
    for (let t = 0; t < leaves - 1 + late; t++) stepWorld(w, input(['right']))
    let made = false
    if (hover === 'best') {
      for (let s = 0; s <= 75 && !made; s++) {
        const again = makeInput()
        again(['right'])
        made = across(structuredClone(w), again, (i) => i >= s)
      }
    } else {
      made = across(w, input, typeof hover === 'function' ? hover : hover ? (_i, p) => p.vy > 0 : () => false)
    }
    if (made) works++
  }
  return works
}

test('review, feel: tap 1.5 tiles; pits of 4 and 5 are roomy, 6 is the limit, 7 needs the hover, 10 needs it begun late, 11 is too far, tapping it never helps', () => {
  near(m.tap.apex / TILE, 1.5, 0.12, 'tap jump apex in tiles')
  const plain = [4, 5, 6, 7].map((gap) => pitWindow(gap))
  const hover = [8, 9, 10].map((gap) => pitWindow(gap, { hover: true }))
  // Level 2 teaches the hover on a long pit: pressed too early (from the take-off) it must work as well.
  const early = pitWindow(8, { hover: () => true })
  const best = [10, 11].map((gap) => pitWindow(gap, { hover: 'best' }))
  // The old exploit: down + spray one tick in three.
  const tapped = [9, 10].map((gap) => pitWindow(gap, { hover: (i) => i % 3 === 0 }))
  notes.push(
    `pits, running jump: take-off ticks that clear 4/5/6/7 tiles = ${plain.join('/')}; hover held from the top 8/9/10 tiles = ${hover.join('/')} (8 held from the take-off: ${early}); ` +
      `held from the best tick 10/11 tiles = ${best.join('/')}; tapped one tick in three 9/10 tiles = ${tapped.join('/')} (23 tried each)`,
  )
  ok(plain[0] >= 15, `a 4-tile pit has a take-off window of only ${plain[0]} ticks`)
  ok(plain[1] >= 10, `a 5-tile pit has a take-off window of only ${plain[1]} ticks`)
  ok(plain[2] >= 1, 'a 6-tile pit should be just possible')
  eq(plain[3], 0, 'take-off ticks that clear a 7-tile pit without the hover')
  ok(hover[0] >= 15, `an 8-tile pit with the hover held from the top has a window of only ${hover[0]} ticks (roomy is 15)`)
  ok(early >= 15, `an 8-tile pit with the hover held from the take-off has a window of only ${early} ticks (roomy is 15)`)
  eq(hover[2], 0, 'take-off ticks that clear a 10-tile pit with the hover held from the top')
  ok(best[0] >= 1, 'a 10-tile pit should be just possible with the hover begun late')
  eq(best[1], 0, 'take-off ticks that clear an 11-tile pit with the hover begun on any tick')
  ok(tapped[0] <= hover[1], `tapping the hover clears a 9-tile pit from ${tapped[0]} take-off ticks, holding it from ${hover[1]}`)
  eq(tapped[1], 0, 'take-off ticks that clear a 10-tile pit with the hover tapped')
})

// The widest gap a running jump crosses onto a ledge 4 tiles up to 4 down (NOTES.md section 5). About 15 s, so only on asking.
if (process.argv.includes('--ledges')) {
  test('ledges: the widest gap onto a ledge up to 4 tiles up or down, plain, hover held from the top, hover held from the best tick', () => {
    for (let up = 4; up >= -4; up--) {
      const widest = {}
      for (const mode of ['plain', 'top', 'best']) {
        const hover = mode === 'plain' ? false : mode === 'top' ? true : 'best'
        let gap = 4
        let last = 0
        for (let n; (n = pitWindow(gap, { hover, up })) > 0; gap++) last = n
        widest[mode] = `${gap - 1} (${last} of 23)`
      }
      notes.push(`ledges: ${up > 0 ? `${up} up` : up < 0 ? `${-up} down` : 'level'}: plain ${widest.plain}, hover from the top ${widest.top}, from the best tick ${widest.best}`)
    }
  })
}

test('review, feel: walls of 3 and 4 tiles are climbed from a standing start, 5 is a barrier', () => {
  const climb = (h) => {
    const rows = []
    for (let i = 0; i < h; i++) rows.push(' '.repeat(12) + 'XX')
    rows[h - 1] = ' '.repeat(10) + '@ XX'
    const w = makeWorld([...rows, FLOOR, FLOOR])
    const input = settle(w)
    until(w, ['right'], (x) => x.player.hitWall === 1, 60, input)
    let top = false
    for (let i = 0; i < 90; i++) {
      stepChecked(w, input(['right', 'jump']), `wall of ${h}`)
      if (w.player.onGround && feet(w) <= (10 - h) * TILE) top = true
    }
    return top
  }
  ok(climb(3), 'a 3-tile wall was not climbed')
  ok(climb(4), 'a 4-tile wall was not climbed')
  ok(!climb(5), 'a 5-tile wall was climbed: level designers count on it as a barrier')
  // Five tiles with a full run-up, taking off anywhere: the running jump is higher, but still short.
  let highest = Infinity
  for (let jumpAt = 0; jumpAt <= 260; jumpAt += 5) {
    const rows = []
    for (let i = 0; i < 5; i++) rows.push(' '.repeat(30) + 'XXXX')
    rows[4] = '  @'.padEnd(30) + 'XXXX'
    const w = makeWorld([...rows, FLOOR, FLOOR])
    const input = settle(w)
    until(w, ['right'], (x) => x.player.x + MAXX_W >= 30 * TILE - jumpAt, 600, input)
    for (let i = 0; i < 100; i++) {
      stepWorld(w, input(['right', 'jump']))
      highest = Math.min(highest, feet(w))
      ok(!(w.player.onGround && feet(w) <= 5 * TILE), `a 5-tile wall was climbed with a run-up, taking off ${jumpAt} px away`)
    }
  }
  notes.push(`walls: a running jump gets his feet ${round(10 * TILE - highest)} px up; a 5-tile wall is ${5 * TILE} px and the ledge forgiveness is ${TUNING.ledgeNudge} px`)
  ok(10 * TILE - highest + TUNING.ledgeNudge < 5 * TILE, 'the running jump plus ledge forgiveness reaches the top of a 5-tile wall')
})

/** A wall `h` tiles tall at columns 20-21 on flat ground, Maxx at column 2 (or 12 with a blob standing flush against the wall). */
function wallWorld(h, blob = false) {
  const rows = []
  for (let i = 0; i < h; i++) rows.push(' '.repeat(20) + 'XX')
  rows[h - 1] = (blob ? '            @      3' : '  @'.padEnd(20)) + 'XX'
  return makeWorld([...rows, FLOOR, FLOOR], { legend: { 3: { kind: 'blob', props: { speed: 0 } } } })
}
const onWall = (w, h) => w.player.onGround && feet(w) <= (10 - h) * TILE

test('review, hits: a hit in mid-air never lifts him (no second jump over a 5-tile wall); on the ground he still hops', () => {
  // A running jump with something behind him hitting him on any tick: never higher than the jump alone.
  const jumpTop = (hitAt) => {
    const w = flat()
    const input = settle(w)
    until(w, ['right'], (x) => x.player.vx >= TUNING.runSpeed, 60, input)
    let top = Infinity
    for (let t = 0; t < 120; t++) {
      if (t === hitAt) sim.hurtPlayer(w, { fromX: w.player.x + w.player.w / 2 - 10 })
      stepChecked(w, input(['right', 'jump']), `hit on tick ${hitAt}`)
      top = Math.min(top, feet(w))
      if (w.player.onGround && t > 0) break
    }
    return 10 * TILE - top
  }
  const plain = jumpTop(-1)
  for (let k = 0; k < 60; k++) ok(jumpTop(k) <= plain + 0.01, `a hit on tick ${k} of a running jump lifted his feet to ${round(jumpTop(k))} px (the jump alone: ${round(plain)})`)
  // A 5-tile wall: a run, a jump d px before it, a hit from behind on any tick of the jump.
  let tries = 0
  for (let d = 0; d <= 240; d += 8) {
    for (let k = 0; k < 50; k += 2) {
      const w = wallWorld(5)
      const input = settle(w)
      const p = w.player
      until(w, ['right'], () => p.x + p.w >= 20 * TILE - d, 400, input)
      for (let t = 0; t < 150 && w.status === 'play'; t++) {
        if (t === k) sim.hurtPlayer(w, { fromX: p.x + p.w / 2 - 10 })
        stepWorld(w, input(['right', 'jump']))
        ok(!onWall(w, 5), `a jump ${d} px from a 5-tile wall and a hit from behind on tick ${k} put him on top of it`)
      }
      tries++
    }
  }
  notes.push(`hits: ${tries} jumps at a 5-tile wall with a hit from behind on every other tick, none got on top; a hit never lifts him above the jump's own ${round(plain)} px`)
  // On the ground the hit still throws him up and back.
  const g = flat(['  @  1'], { legend: BLOB })
  const gi = settle(g)
  until(g, ['right'], () => g.player.pips < 3, 200, gi)
  ok(g.player.vy < -TUNING.knockY + 50 && g.player.vx < 0, `a hit on the ground: vx ${round(g.player.vx)}, vy ${round(g.player.vy)}`)
})

test('review, stomps: a held stomp bounce off a blob lifts his feet 148 px at most, so a blob by a 5-tile wall is no ladder (by a 4-tile one it is)', () => {
  const climb = (h) => {
    let highest = 0
    for (const hover of [false, true]) {
      for (let j = 0; j < 70; j++) {
        const w = wallWorld(h, true)
        const input = settle(w)
        const p = w.player
        let bounced = false
        for (let t = 0; t < 200 && w.status === 'play'; t++) {
          const held = ['right']
          if (t >= j) held.push('jump')
          if (hover && p.vy > 0 && !bounced) held.push('down', 'spray')
          stepWorld(w, input(held))
          w.events.length = 0
          if (!bounced && find(w, 'blob')?.state === 'squash') bounced = true
          if (bounced) highest = Math.max(highest, 10 * TILE - feet(w))
          if (onWall(w, h)) return { climbed: true, highest }
          if (bounced && p.onGround) break
        }
      }
    }
    return { climbed: false, highest }
  }
  ok(climb(4).climbed, 'a blob flush against a 4-tile wall should be a step up it')
  const five = climb(5)
  ok(!five.climbed, 'a held stomp bounce off a blob put him on top of a 5-tile wall')
  ok(five.highest > 100 && five.highest <= 28 + TUNING.stompBounceHeld ** 2 / (2 * TUNING.gravRise) + 0.01, `a held bounce off a blob took his feet ${round(five.highest)} px up`)
  ok(five.highest < 5 * TILE - TUNING.ledgeNudge - 4, `the bounce off a blob (${round(five.highest)} px) is within 4 px of a 5-tile wall's ledge forgiveness`)
  notes.push(`stomps: a held bounce off a blob on the floor took his feet ${round(five.highest)} px up (a 5-tile wall needs ${5 * TILE - TUNING.ledgeNudge})`)
})

test('review, riders: jumping off a lift or a washed car, he takes none of its speed; arriving on mud, his first jump is a mud jump', () => {
  // The take-off tick carries him with what he stands on; from then on the flight is the ground's to the pixel.
  const launch = (legend) => {
    const w = makeWorld(['', '', '', '', '', '', '    @    1', FLOOR, FLOOR], { legend })
    const input = makeInput()
    for (let i = 0; i < 40; i++) stepWorld(w, input([]))
    const thing = w.entities.find((e) => e.kind === 'lift' || e.kind === 'car')
    const p = w.player
    if (thing) {
      p.x = thing.x + 4
      p.y = thing.y - p.h - 2
      until(w, [], () => p.ridingId === thing.id, 20, input)
      eq(p.ridingId, thing.id, `riding the ${thing.kind}`)
    }
    for (let i = 0; i < 12; i++) stepWorld(w, input(['right']))
    stepWorld(w, input(['right', 'jump']))
    const path = []
    for (let i = 0; i < 20; i++) {
      const x = p.x
      const y = p.y
      stepWorld(w, input(['right', 'jump']))
      path.push(`${round(p.x - x)},${round(p.y - y)}`)
    }
    return { vx: p.vx, path: path.join(' ') }
  }
  const ground = launch({})
  for (const [name, legend] of [
    ['a lift rising fast', { 1: { kind: 'lift', props: { dy: -6, speed: 240, wait: 0, w: 6 } } }],
    ['a lift running his way', { 1: { kind: 'lift', props: { dx: 20, speed: 240, wait: 0, w: 6 } } }],
    ['a washed van driving his way', { 1: { kind: 'car', variant: 'van', props: { dir: 1, clean: true, speed: 150 } } }],
  ]) {
    eq(launch(legend).path, ground.path, `${name}: his flight, tick by tick, against a jump off the ground`)
  }
  // A door whose arrival marker stands on mud: a jump on the first tick there is already a mud jump.
  const rows = ['  @  1      2', '#'.repeat(10) + 'MMMMMM' + '#'.repeat(10), FLOOR]
  const w = makeWorld(rows, { legend: { 1: { kind: 'door', props: { to: 'main:m' } }, 2: { kind: 'marker', props: { name: 'm' } } } })
  const input = settle(w)
  const p = w.player
  p.x = 5 * TILE + TILE / 2 - p.w / 2
  settle(w, input)
  stepWorld(w, input(['up']))
  until(w, [], () => w.warp === null, 200, input)
  stepWorld(w, input(['jump']))
  near(p.vy, -TUNING.jumpSpeed * TUNING.mudJump + TUNING.gravRise / 60, 0.01, 'launch speed of a jump on the first tick after arriving on mud')
})

test('review, seams: a run (or a spray-run) crosses a one-tile gap, a slow walk drops in, two tiles must be jumped', () => {
  const cross = (gap, held, extra) => {
    const row = '#'.repeat(20) + ' '.repeat(gap) + '#'.repeat(30)
    const w = makeWorld(['  @', row, row])
    const input = settle(w)
    let snag = false
    for (let i = 0; i < 900 && w.status === 'play' && w.player.x < 24 * TILE; i++) {
      stepChecked(w, input(held, extra), `gap of ${gap}`)
      if (w.player.hitWall !== 0) snag = true
    }
    return { over: w.status === 'play' && w.player.x >= 24 * TILE, snag, feet: feet(w), vx: w.player.vx }
  }
  const run = cross(1, ['right'])
  ok(run.over && !run.snag, 'a full run did not carry him over a one-tile gap')
  eq(run.feet, 10 * TILE, 'feet after the gap')
  eq(run.vx, TUNING.runSpeed, 'speed after the gap: the lip must not slow him')
  ok(cross(1, ['right', 'spray']).over, 'a spray-run did not carry him over a one-tile gap')
  ok(!cross(1, [], { axisX: 0.5 }).over, 'a half-speed walk crossed a one-tile gap')
  ok(!cross(2, ['right']).over, 'a run crossed a two-tile gap without a jump')
})

test('review, seams: floors, walls and ceilings built of many tiles never snag him', () => {
  // A floor of every plain solid, run end to end both ways.
  const mixed = '#%XUPBC?!WLg'.repeat(5)
  const w = makeWorld(['  @', mixed, FLOOR])
  const input = settle(w)
  for (const dir of ['right', 'left']) {
    for (let i = 0; i < 600; i++) {
      stepChecked(w, input([dir]), 'mixed floor')
      const edge = w.player.x <= 0 || w.player.x >= 60 * TILE - MAXX_W
      ok(w.player.onGround && feet(w) === 10 * TILE, `left the floor at x=${round(w.player.x)} running ${dir}`)
      ok(edge || w.player.hitWall === 0, `snagged on a floor seam at x=${round(w.player.x)} running ${dir}`)
    }
  }
  // Sliding down a tall wall while pushing into it: one smooth fall, no ledge found between tiles.
  const rows = []
  for (let i = 0; i < 30; i++) rows.push('     ' + '#%XUPBC?!W'[i % 10])
  rows[0] = '   @ ' + rows[0].slice(5)
  const tall = makeWorld([...rows, FLOOR, FLOOR])
  const tInput = makeInput()
  let landedAt = -1
  for (let i = 0; i < 200 && landedAt < 0; i++) {
    const y = tall.player.y
    stepChecked(tall, tInput(['right']), 'tall wall')
    if (tall.player.onGround) landedAt = feet(tall)
    else ok(tall.player.y > y || i < 2, `stopped falling beside the wall at y=${round(y)}`)
  }
  eq(landedAt, 30 * TILE, 'where he landed after sliding down the wall')
  eq(tall.player.x, 5 * TILE - MAXX_W, 'flush against the wall all the way down')
  // A two-tile-high corridor: hopping along under the ceiling keeps moving.
  const hall = makeWorld([mixed, '', '  @', mixed, FLOOR])
  const hInput = settle(hall)
  for (let i = 0; i < 400; i++) stepChecked(hall, hInput(i % 9 < 5 ? ['right', 'jump'] : ['right']), 'low corridor')
  ok(hall.player.x > 40 * TILE, `only reached x=${round(hall.player.x)} hopping along a low corridor`)
  // Balanced on one pixel of a corner: he stays put.
  const corner = makeWorld(['', '   X', '', FLOOR, FLOOR])
  place(corner, 4 * TILE - 1, 8 * TILE - MAXX_H)
  const cInput = makeInput()
  for (let i = 0; i < 60; i++) stepChecked(corner, cInput([]), 'corner')
  eq(feet(corner), 8 * TILE, 'feet after a second on one pixel of a corner')
})

test('review, seams: a jump a hair short of a ledge is forgiven, but not into a low ceiling and not from far below', () => {
  // Falling beside a ledge, pushing into it, feet `below` px under its top.
  const tryLedge = (below, rows = ['', '      XX', '      XX', FLOOR, FLOOR]) => {
    const w = makeWorld(rows)
    place(w, 6 * TILE - MAXX_W - 1, 8 * TILE - MAXX_H + below)
    const input = makeInput()
    for (let i = 0; i < 4; i++) stepChecked(w, input(['right']), `ledge ${below} px up`)
    return w.player.onGround && feet(w) === 8 * TILE
  }
  ok(tryLedge(3), 'feet 3 px below the lip: should be put on the ledge')
  ok(!tryLedge(TUNING.ledgeNudge + 6), 'feet well below the lip: should fall')
  ok(!tryLedge(3, ['      X', '', '      XX', '      XX', FLOOR, FLOOR]), 'no room to stand on the ledge: should not be lifted into the ceiling')
})

test('review, blocks: a head bump from any spot under any block never leaves him inside it', () => {
  let ticks = 0
  for (const ch of 'BC?!WLHhUXg') {
    for (let off = -21; off <= 31; off += 2) {
      for (const hold of [3, 60]) {
        const w = makeWorld([`    ${ch === 'H' ? 'H' : ' '}${ch}${ch === 'h' ? 'H' : ' '}`, '', '', '', FLOOR, FLOOR])
        place(w, 5 * TILE + off, 10 * TILE - MAXX_H)
        const input = makeInput()
        for (let i = 0; i < 70; i++) {
          stepChecked(w, input(i > 1 && i < 2 + hold ? ['jump'] : []), `'${ch}' at offset ${off}`)
          ticks++
        }
        ok(w.player.onGround, `'${ch}' at offset ${off}: he never came back down`)
      }
    }
  }
  ok(ticks > 40000, 'not enough bumps tried')
  // Walking through a hidden block and jumping from inside it must not seal him in.
  for (let off = -22; off <= 32; off += 2) {
    const w = makeWorld(['     H', '', FLOOR, FLOOR])
    place(w, 5 * TILE + off, 10 * TILE - MAXX_H)
    const input = makeInput()
    for (let i = 0; i < 80; i++) stepChecked(w, input(i > 1 && i < 30 ? ['jump'] : []), `inside a hidden block, offset ${off}`)
  }
})

test('review, catwalks: only ever landed on from above; seams, ends and lifts through them behave', () => {
  // Rising through it never counts as standing, whatever the height.
  for (const [up, hold, lands] of [[1, 1, true], [2, 1, false], [3, 60, true], [4, 60, true], [5, 60, false]]) {
    // The catwalk's top is `up` tiles above the floor he stands on (at 1, it runs through his shins).
    const rows = Array(up).fill('')
    rows[0] = '======'
    rows[up - 1] = rows[up - 1].padEnd(12) + '@'
    const w = makeWorld([...rows, FLOOR, FLOOR])
    place(w, 2 * TILE + 5, 10 * TILE - MAXX_H)
    const input = settle(w)
    const top = (10 - up) * TILE
    for (let i = 0; i < 100; i++) {
      const y = w.player.y
      stepChecked(w, input(i < hold ? ['jump'] : []), `catwalk ${up} up`)
      ok(!(w.player.onGround && w.player.y < y), `catwalk ${up} tiles up: landed while moving up`)
      if (w.player.onGround) ok(feet(w) === top || feet(w) === 10 * TILE, `catwalk ${up} tiles up: standing at ${feet(w)}`)
    }
    eq(feet(w), lands ? top : 10 * TILE, `catwalk ${up} tiles up, jump held ${hold}: where he ends`)
  }
  // Two catwalk runs with a block between: one level walkway, no seam to trip on.
  const w = makeWorld(['', '  @', ' ====XX====', '', '', FLOOR, FLOOR])
  const input = settle(w)
  eq(feet(w), 7 * TILE, 'starts on the catwalk')
  let fellOff = false
  for (let i = 0; i < 400; i++) {
    stepChecked(w, input(i < 60 ? ['right'] : i < 110 ? ['left'] : ['right']), 'catwalk seams')
    if (w.player.x >= 11 * TILE) fellOff = true
    if (!fellOff) {
      eq(feet(w), 7 * TILE, `feet on the walkway at x=${round(w.player.x)}`)
      eq(w.player.hitWall, 0, `hitWall on the walkway at x=${round(w.player.x)}`)
    }
  }
  // ... and off its far end he falls to the floor.
  ok(w.player.onGround && feet(w) === 10 * TILE, 'did not fall off the end of the catwalk')
  // A lift sinking through a catwalk leaves its rider on the catwalk; a rising one takes him up through it.
  for (const [dy, endFeet] of [[6, 7 * TILE], [-6, 3 * TILE]]) {
    // The catwalk is row 7. The lift starts in row 3 and sinks to row 9, or the other way about.
    const startRow = dy > 0 ? 3 : 9
    const rows = Array(12).fill('')
    rows[10] = FLOOR
    rows[11] = FLOOR
    rows[7] = ' ========'
    rows[startRow - 1] = '    @'
    rows[startRow] = '    1'
    const lw = makeWorld(rows, { legend: { 1: { kind: 'lift', props: { dy, speed: 60, wait: 600 } } } })
    const li = makeInput()
    const lift = find(lw, 'lift')
    for (let i = 0; i < 300; i++) stepChecked(lw, li([]), 'lift through a catwalk')
    eq(lift.vars.t, 1, 'the lift finished its run')
    eq(feet(lw), endFeet, dy > 0 ? 'rider left standing on the catwalk' : 'rider carried up through the catwalk')
    eq(lw.player.ridingId, dy > 0 ? 0 : lift.id, 'ridingId at the end')
  }
})

// A crate that can move both ways, for squeezing things.
sim.registerEntity('testcrusher', {
  alwaysActive: true,
  init(e) {
    sim.setBox(e, 32, 32, sim.propNum(e, 'lift', 0))
    e.solid = 'full'
    e.gravity = 0
    e.collides = false
  },
  update(e) {
    e.x += sim.propNum(e, 'vx', 0) / 60
    e.y += sim.propNum(e, 'vy', 0) / 60
  },
})

test('review, riders: a lift under a ceiling, a car off a ledge, a car under a low wall, a car into sludge', () => {
  // The lift rises into a ceiling: its rider is never pressed into the tiles, and drops through the lift.
  let w = makeWorld(['', '', '  XXXXXXX', '', '', '', '', '', '    @', '    1', FLOOR, FLOOR], { legend: { 1: { kind: 'lift', props: { dy: -6, speed: 120, wait: 10 } } } })
  let input = makeInput()
  let top = Infinity
  for (let i = 0; i < 400; i++) {
    stepChecked(w, input([]), 'lift under a ceiling')
    top = Math.min(top, w.player.y)
  }
  near(top, 3 * TILE, 0.001, 'his head stopped at the underside of the ceiling')
  eq(w.player.pips, 3, 'a platform that only holds him up does not hurt')
  ok(w.player.onGround, 'he ended standing somewhere')

  // A washed car drives off a ledge: he rides it all the way down.
  const ledge = ' '.repeat(10) + '#'.repeat(40)
  w = makeWorld(['                 @     c', ledge, '', '', '', FLOOR, FLOOR])
  input = settle(w)
  let car = find(w, 'car')
  washNow(w, car)
  place(w, car.x + 30, car.y - MAXX_H - 4)
  until(w, [], () => w.player.ridingId === car.id, 60, input)
  let fell = false
  for (let i = 0; i < 700; i++) {
    stepChecked(w, input([]), 'car off a ledge')
    eq(w.player.ridingId, car.id, `still riding at tick ${i}`)
    near(feet(w), car.y, 0.001, `feet on the roof at tick ${i}`)
    if (car.y + car.h > 7 * TILE) fell = true
  }
  ok(fell, 'the car never drove off the ledge')
  eq(car.y + car.h, 10 * TILE, 'the car landed on the lower road')

  // A washed car passes under a low wall: he is scraped off, not carried into it.
  w = makeWorld(['       XX', '', '  @                    c', FLOOR, FLOOR])
  input = settle(w)
  car = find(w, 'car')
  washNow(w, car)
  place(w, car.x + 30, car.y - MAXX_H - 4)
  until(w, [], () => w.player.ridingId === car.id, 60, input)
  for (let i = 0; i < 900 && !car.dead; i++) stepChecked(w, input([]), 'car under a low wall')
  eq(w.player.x, 9 * TILE, 'he was held at the face of the wall')
  eq(feet(w), 10 * TILE, 'and dropped to the road when the car left')

  // A washed car parked on a sideways lift goes where the lift goes, and so does Maxx on its roof.
  // (The car is in the row above the lift, so it comes first in the level's entity list.)
  const ferry = { 1: { kind: 'lift', props: { dx: 5, speed: 90, wait: 10, w: 5 } }, 2: { kind: 'car', variant: 'compact', props: { speed: 0 } } }
  w = makeWorld(['', '', '          2', '          1', '', '', '', '  @', FLOOR, FLOOR], { legend: ferry })
  input = makeInput()
  const lift = find(w, 'lift')
  car = find(w, 'car')
  washNow(w, car)
  place(w, car.x + 30, car.y - MAXX_H - 4)
  until(w, [], () => w.player.ridingId === car.id && car.onGround, 60, input)
  const onLift = car.x - lift.x
  const onRoof = w.player.x - car.x
  for (let i = 0; i < 400; i++) {
    stepChecked(w, input([]), 'car on a lift')
    near(car.x - lift.x, onLift, 1e-9, `the car's place on the lift at tick ${i}`)
    eq(car.y + car.h, lift.y, `the car's wheels on the lift at tick ${i}`)
    near(w.player.x - car.x, onRoof, 1e-9, `his place on the roof at tick ${i}`)
    near(feet(w), car.y, 0.001, `his feet on the roof at tick ${i}`)
  }
  ok(lift.vars.ends === undefined && Math.abs(car.x - car.spawnX) > 1, 'the lift never moved')

  // A washed car sinks in sludge: so does its rider.
  const pit = '#'.repeat(8) + '~~~~~~' + '#'.repeat(30)
  w = makeWorld(['  @                    c', pit, FLOOR])
  input = settle(w)
  car = find(w, 'car')
  washNow(w, car)
  place(w, car.x + 30, car.y - MAXX_H - 4)
  until(w, [], () => w.status !== 'play', 900, input)
  eq(w.status, 'grimed', 'status after riding a car into sludge')
})

test("review, riders: a 'full' entity cannot push him into or through a wall; being squeezed costs a pip", () => {
  // Sideways into a wall.
  let w = flat(['  1   @  X'], { legend: { 1: { kind: 'testcrusher', props: { vx: 60 } } } })
  let input = settle(w)
  const pips = []
  for (let i = 0; i < 400; i++) {
    stepChecked(w, input([]), 'crate against a wall')
    if (pips[pips.length - 1] !== w.player.pips) pips.push(w.player.pips)
  }
  eq(pips.join(','), '3,2', 'pips: one lost to the squeeze, no more while he blinks')
  eq(w.status, 'play', 'status')
  // The same with him pushing back against the crate all the way: being stopped by it must not back him into the wall.
  for (const start of [0, 0.5, 3.3]) {
    for (const hop of [false, true]) {
      w = flat(['  @ X          1'], { legend: { 1: { kind: 'testcrusher', props: { vx: -70 } } } })
      input = makeInput()
      place(w, 5 * TILE + start, 10 * TILE - MAXX_H)
      for (let i = 0; i < 400; i++) stepChecked(w, input(hop && i % 7 === 6 ? ['right', 'jump'] : ['right']), `pushing against a crate, ${start} px from the wall`)
      // With hops he gets up onto the crate and rides it clear; without, he is caught.
      eq(w.player.pips, hop ? 3 : 2, `pips after ${hop ? 'hopping onto' : 'pushing against'} the crate`)
    }
  }
  // Down onto his head.
  w = flat(['  1'], { legend: { 1: { kind: 'testcrusher', props: { vy: 60, lift: 160 } } } })
  input = makeInput()
  place(w, 2 * TILE + 5, 10 * TILE - MAXX_H)
  for (let i = 0; i < 300; i++) {
    stepChecked(w, input([]), 'crate onto his head')
    ok(feet(w) <= 10 * TILE + 0.001, `pressed ${round(feet(w) - 10 * TILE)} px into the floor at tick ${i}`)
  }
  eq(w.player.pips, 2, 'pips after the crate came down on him')
})

test('review, conveyors: jumps on a belt, a belt into a wall, a belt off an edge', () => {
  // A jump straight up on a belt: carried on the ground, not in the air.
  const w = makeWorld(['          @', '>'.repeat(60), FLOOR])
  const input = settle(w)
  const p = w.player
  let x = p.x
  for (let i = 0; i < 30; i++) stepWorld(w, input([]))
  near(p.x - x, 30, 0.01, 'carried for half a second')
  x = p.x
  stepWorld(w, input(['jump']))
  const carriedOnTakeoff = p.x - x
  const air = until(w, ['jump'], () => p.onGround, 200, input)
  near(p.x - x, carriedOnTakeoff + 1, 1.01, `drift during a ${air}-tick jump straight up (the belt has no hold on him in the air)`)
  eq(p.floor, '>', 'back on the belt')
  // Jump height is the same on a belt, and a held jump still does not repeat.
  const events = []
  let top = p.y
  for (let i = 0; i < 120; i++) {
    stepWorld(w, input(['jump']))
    events.push(...w.events)
    w.events.length = 0
    top = Math.min(top, p.y)
  }
  eq(jumpsIn(events), 0, 'jumps while the button stayed down')
  // Against the belt he still makes headway, even spraying.
  const against = makeWorld([' '.repeat(40) + '@', '>'.repeat(60), FLOOR])
  const aInput = settle(against)
  const ax = against.player.x
  for (let i = 0; i < 60; i++) stepWorld(against, aInput(['left', 'spray']))
  near(ax - against.player.x, TUNING.spraySpeed - TUNING.conveyorSpeed, 12, 'ground covered against the belt in a second while spraying')
  // A belt carries him flush to a wall and holds him there.
  const wall = makeWorld(['  @    X', '>>>>>>>>##', FLOOR])
  const wInput = settle(wall)
  for (let i = 0; i < 300; i++) stepChecked(wall, wInput([]), 'belt into a wall')
  eq(wall.player.x, 7 * TILE - MAXX_W, 'carried flush to the wall')
  // A belt carries him off its end; coyote time still lets him jump from there.
  const edge = makeWorld(['  @', '>>>>>>' + ' '.repeat(40), ' '.repeat(46), ' '.repeat(46), FLOOR])
  const eInput = settle(edge)
  until(edge, [], (x2) => !x2.player.onGround, 400, eInput)
  for (let i = 0; i < 3; i++) stepWorld(edge, eInput([]))
  stepWorld(edge, eInput(['jump']))
  ok(edge.player.vy < -300, 'no coyote jump after a belt carried him off its end')
})

test('review, hover: from its first tick it lasts 42 ticks of air however it is pressed, slow drift and all; it never lifts him and nothing but ground refills it', () => {
  const patterns = {
    held: () => true,
    'every other tick': (i) => i % 2 === 0,
    'one tick in three': (i) => i % 3 === 0,
    'three on, three off': (i) => i % 6 < 3,
    'spray tapped, down held': (i) => i % 4 !== 3,
  }
  for (const [name, on] of Object.entries(patterns)) {
    // A long drop from the top of a 60-row shaft.
    const rows = []
    for (let i = 0; i < 60; i++) rows.push('')
    rows[1] = '  @'
    rows[2] = '####'
    rows[59] = FLOOR
    const w = makeWorld(rows)
    const input = settle(w)
    const p = w.player
    until(w, ['right'], () => !p.onGround, 200, input)
    let hovered = 0
    let left = p.hover
    let air = 0
    let first = -1
    let empty = -1
    for (; air < 900 && !p.onGround; air++) {
      const y = p.y
      const held = on(air) ? ['down', 'spray', 'right'] : air % 3 === 0 ? ['right', 'jump'] : ['right']
      stepChecked(w, input(held), 'hover')
      if (p.hovering) {
        hovered++
        if (first < 0) first = air
        ok(p.y > y, `${name}: he rose while hovering`)
      }
      if (p.onGround) break
      ok(p.hover <= left, `${name}: the hover refilled in mid-air (tick ${air})`)
      // Once begun it runs down every tick, pressed or not, and holds him to the hover's drift.
      if (first >= 0 && left > 0) eq(p.hover, left - 1, `${name}: hover left on tick ${air}`)
      if (first >= 0 && p.hover > 0 && air >= first + 10) ok(p.vx <= TUNING.hoverSpeed, `${name}: ${round(p.vx)} px/s sideways on tick ${air} of a hover`)
      if (first >= 0 && empty < 0 && p.hover === 0) empty = air
      left = p.hover
    }
    eq(empty - first, TUNING.hoverTicks - 1, `${name}: ticks from the first of the hover to its last`)
    ok(hovered <= TUNING.hoverTicks, `${name}: hovered ${hovered} ticks`)
    if (name === 'held') eq(hovered, TUNING.hoverTicks, 'held: ticks hovered in one airtime')
    else ok(hovered < TUNING.hoverTicks, `${name}: hovered all ${hovered} ticks`)
    ok(p.onGround && air < 400, `${name}: he was in the air for ${air} ticks`)
    eq(p.hover, TUNING.hoverTicks, `${name}: refilled on landing`)
  }
  // A full jump with all of its hover is a finite hop.
  ok(m.hover.air < 46 + TUNING.hoverTicks + 30, `a jump with hover lasts ${m.hover.air} ticks`)
})

/* ---- The hover search: the proof behind "nothing goes further than holding the hover" ---- */

/**
 * Heights (tiles above the take-off floor; below is negative) where the search reads how far he got.
 * 5 is a tripwire: from the ground nothing but a spring may bring his feet down through it.
 */
const HOVER_LEVELS = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
const HOVER_FRAMES = new Map()
/**
 * One input frame of a flight, built once, nothing pressed anew: the stick (1 the way he flies, 0.5
 * half over, 0 let go, -1 back), jump held or not, down and spray each held or not, up held or not.
 */
function hoverFrame(dir, jump, down, spray = down, stick = 1, up = false) {
  const key = `${dir} ${stick} ${+jump}${+down}${+spray}${+up}`
  let f = HOVER_FRAMES.get(key)
  if (!f) {
    const held = {}
    const none = {}
    for (const a of ACTIONS) {
      held[a] = false
      none[a] = false
    }
    if (stick === 1 || stick === -1) held[stick * dir > 0 ? 'right' : 'left'] = true
    held.jump = jump
    held.down = down
    held.spray = spray
    held.up = up
    f = { held, pressed: none, released: none, repeat: none, axisX: stick * dir, axisY: (down ? 1 : 0) - (up ? 1 : 0), device: 'keyboard' }
    HOVER_FRAMES.set(key, f)
  }
  return f
}

/**
 * A take-off from the lip of a runway over open air, as a world to copy from the tick after.
 * kind: 'run' a full running jump at the lip, 'hop' a running tap jump, 'off' running off the edge,
 * 'stand' a full standing jump with his toes at the lip and the stick pushed, 'coyote' a full jump
 * on the last tick of coyote time; 'mud', 'oil', 'belt' a running jump at the lip of a runway of
 * that floor (the belt running his way); 'spring' a running jump onto a spring on the lip, 'stomp'
 * onto a blob standing there, jump held (the snapshot is the tick it threw him).
 */
function hoverTakeoff(kind, dir) {
  const floor = { mud: 'M', oil: 'O', belt: dir > 0 ? '>' : '<' }[kind] ?? '#'
  const len = floor === '#' ? 10 : 24
  const width = len + 30
  const thing = kind === 'spring' ? 'y' : kind === 'stomp' ? '3' : ' '
  const rows = []
  for (let i = 0; i < 7; i++) rows.push('')
  rows.push(dir > 0 ? '  @'.padEnd(len - 1) + thing : (thing + '@'.padStart(len - 2)).padStart(width))
  rows.push(dir > 0 ? floor.repeat(len).padEnd(width) : floor.repeat(len).padStart(width))
  for (let i = 0; i < 8; i++) rows.push(' '.repeat(width))
  const level = makeLevel(rows, { legend: { 3: { kind: 'blob', props: { speed: 0 } } } })
  const way = dir > 0 ? 'right' : 'left'
  const lipX = dir > 0 ? len * TILE : (width - len) * TILE
  // The runway's top (the rows are more than 12, so none are added above).
  const feet0 = 8 * TILE
  if (kind === 'spring' || kind === 'stomp') {
    // The first jump tick of the run-up that lands on it, jump held to the launch.
    for (let j = 0; j < 200; j++) {
      const w = createWorld(level, { session: freshSession() })
      const input = settle(w)
      const p = w.player
      for (let t = 0; t < 200 && w.status === 'play' && feet(w) <= feet0; t++) {
        stepWorld(w, input(t >= j ? [way, 'jump'] : [way]))
        w.events.length = 0
        const launched = kind === 'spring' ? p.vy < -TUNING.springSpeed + 60 : all(w, 'blob').length === 0 || find(w, 'blob').state === 'squash'
        if (launched) return { snap: structuredClone(w), feet0, x0: p.x, dir, jump: true }
      }
    }
    throw new Error(`${kind}: no run-up lands on it`)
  }
  const probe = createWorld(level, { session: freshSession() })
  const leaves = until(probe, [way], (x) => !x.player.onGround, 900, settle(probe))
  const w = createWorld(level, { session: freshSession() })
  const input = settle(w)
  if (kind === 'stand') {
    w.player.x = dir > 0 ? lipX - MAXX_W : lipX
    settle(w, input)
  } else {
    for (let t = 0; t < leaves - 1 + (kind === 'coyote' ? TUNING.coyoteTicks : 0); t++) stepWorld(w, input([way]))
  }
  const x0 = w.player.x
  stepWorld(w, input(kind === 'off' ? [way] : [way, 'jump']))
  w.events.length = 0
  ok(kind === 'off' || w.player.vy < 0, `${kind} ${way}: no take-off`)
  return { snap: structuredClone(w), feet0, x0, dir, jump: kind !== 'hop' && kind !== 'off' }
}

/**
 * Fly from a take-off, `on(t)` saying whether the hover is held on each tick (the stick and jump
 * held throughout), or `frame(t)` giving the whole input: how far along he is (px) as his feet go
 * down through each of HOVER_LEVELS. hitAt: on that tick something behind him hits him first.
 */
function hoverFlight(T, on, { frame = null, hitAt = -1 } = {}) {
  const w = structuredClone(T.snap)
  const p = w.player
  const out = HOVER_LEVELS.map(() => -Infinity)
  const bottom = T.feet0 + 4 * TILE
  let prev = feet(w)
  for (let t = 0; t < 400; t++) {
    if (t === hitAt) sim.hurtPlayer(w, { fromX: p.x + p.w / 2 - T.dir * 10 })
    stepWorld(w, frame ? frame(t) : hoverFrame(T.dir, T.jump, on(t)))
    w.events.length = 0
    const now = feet(w)
    for (let k = 0; k < HOVER_LEVELS.length; k++) {
      const y = T.feet0 - HOVER_LEVELS[k] * TILE
      if (prev < y && now >= y) out[k] = (p.x - T.x0) * T.dir
    }
    prev = now
    if (now > bottom || p.onGround || w.status !== 'play') break
  }
  return out
}

/** The hover search's numbers, for the pit test and the report. */
const hoverBest = {}

test('hover search: no input beats holding it (every press pattern up to 8 ticks long in every phase, random stick, jump, up, down and spray, a hit from behind) from runs, hops, coyote, mud, oil, a belt, a spring and a stomp', () => {
  let runs = 0
  let worst = { by: -Infinity }
  const takeoffs = []
  for (const kind of ['run', 'hop', 'off', 'stand']) for (const dir of [1, -1]) takeoffs.push([kind, dir])
  for (const kind of ['coyote', 'mud', 'oil', 'belt', 'spring', 'stomp']) takeoffs.push([kind, 1])
  for (const [kind, dir] of takeoffs) {
    const T = hoverTakeoff(kind, dir)
    // The longest a plain flight lasts before his feet are 4 tiles down: the last tick a hover can begin and count.
    let flight = 0
    for (const w = structuredClone(T.snap); flight < 400 && feet(w) <= T.feet0 + 4 * TILE && !w.player.onGround; flight++) stepWorld(w, hoverFrame(dir, T.jump, false))
    // Holding it, begun on any tick: the best of these is what holding the hover can do.
    const best = HOVER_LEVELS.map(() => -Infinity)
    const startAt = HOVER_LEVELS.map(() => 0)
    for (let s = 0; s <= flight; s++) {
      const d = hoverFlight(T, (t) => t >= s)
      runs++
      for (let k = 0; k < d.length; k++) {
        if (d[k] > best[k]) {
          best[k] = d[k]
          startAt[k] = s
        }
      }
    }
    const check = (what, on, opts) => {
      const d = hoverFlight(T, on, opts)
      runs++
      for (let k = 0; k < d.length; k++) {
        const by = d[k] === best[k] ? 0 : d[k] - best[k]
        if (by > worst.by) worst = { by, what, kind, dir, level: HOVER_LEVELS[k] }
      }
    }
    for (let period = 1; period <= 8; period++) {
      // Every mask of this length: its rotations are the phases.
      for (let mask = 1; mask < 1 << period; mask++) check(`the ${period}-tick pattern ${mask.toString(2).padStart(period, '0')}`, (t) => ((mask >> t % period) & 1) === 1)
    }
    let s = 0x2545f491 + kind.charCodeAt(0) * 31 + kind.length * 7 + dir
    const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
    for (let i = 0; i < 400; i++) {
      const delay = Math.floor(next() * flight)
      const share = 0.1 + 0.85 * next()
      const seq = []
      for (let t = 0; t < 400; t++) seq.push(t >= delay && next() < share)
      check(`random sequence ${i} (from tick ${delay}, ${Math.round(share * 100)}% pressed)`, (t) => seq[t])
    }
    // The rest of the controller: the stick let go, half over or back, jump let go (never pressed
    // again where that would be a new jump: a hop, a run off the edge), up, down or spray alone.
    for (let i = 0; i < 150; i++) {
      const seq = []
      let st = { stick: 1, jump: T.jump, down: false, spray: false, up: false }
      const change = 0.05 + 0.35 * next()
      const from = Math.floor(next() * flight)
      for (let t = 0; t < 400; t++) {
        if (t >= from && next() < change) {
          const x = next()
          st = { ...st }
          if (x < 0.25) st.down = !st.down
          else if (x < 0.5) st.spray = !st.spray
          else if (x < 0.7) st.spray = st.down = !st.down
          else if (x < 0.82) st.stick = [1, 0.5, 0, -1][Math.floor(next() * 4)]
          else if (x < 0.92) st.jump = T.jump && !st.jump
          else st.up = !st.up
        }
        seq.push(hoverFrame(dir, st.jump, st.down, st.spray, st.stick, st.up))
      }
      check(`random controller ${i} (from tick ${from})`, null, { frame: (t) => seq[t] })
    }
    // A hit from behind on any tick, the hover held from any tick: a player can go looking for a hit.
    if (kind === 'run' && dir > 0) {
      for (let at = 0; at <= flight; at += 2) for (let h = 0; h <= flight + 30; h += 4) check(`a hit on tick ${at}, the hover from ${h}`, (t) => t >= h, { hitAt: at })
    }
    hoverBest[`${kind}${dir}`] = { plain: hoverFlight(T, () => false), top: hoverFlight(T, () => true), best, startAt }
  }
  const run = hoverBest['run1']
  const left = hoverBest['run-1']
  const k0 = HOVER_LEVELS.indexOf(0)
  notes.push(
    `hover search: ${runs} flights; the most any input got past holding it: ${round(worst.by)} px (${worst.what}, ${worst.kind}); ` +
      `running jump onto flat ground: plain ${tiles(run.plain[k0])}, held from the top ${tiles(run.top[k0])}, held from the best tick (${run.startAt[k0]} after take-off) ${tiles(run.best[k0])} tiles`,
  )
  ok(worst.by <= 4, `${worst.what} (${worst.kind}, ${worst.dir > 0 ? 'right' : 'left'}, onto ${worst.level} tiles) goes ${round(worst.by)} px further than holding the hover`)
  // Held from the top is the taught hover; it must not have moved (the core feel test pins it too).
  near(run.top[k0], m.hover.length, 0.01, 'running jump with the hover held from the top, px')
  near(run.best[k0] / TILE, 9.39, 0.05, 'running jump with the hover held from the best tick, tiles')
  for (let k = 0; k < HOVER_LEVELS.length; k++) {
    if (HOVER_LEVELS[k] > 4) {
      for (const [key, b] of Object.entries(hoverBest)) ok(key.startsWith('spring') || b.best[k] === -Infinity, `${key}: his feet got 5 tiles above the take-off`)
      continue
    }
    ok(Number.isFinite(run.best[k]), `a running jump with the hover never got down to ${HOVER_LEVELS[k]} tiles`)
    near(left.best[k], run.best[k], 0.01, `the best hover onto ${HOVER_LEVELS[k]} tiles, left against right`)
  }
})

test('review, jumps: one press is one jump, whenever it comes around a ledge', () => {
  // Run off a ledge over a long drop; press jump on two different ticks after leaving the ground.
  const rows = []
  for (let i = 0; i < 44; i++) rows.push('')
  rows[2] = '       @'
  rows[3] = '#'.repeat(10)
  rows[43] = FLOOR
  const level = makeLevel(rows)
  for (let t1 = 0; t1 <= 12; t1++) {
    for (let t2 = t1 + 1; t2 <= t1 + 10; t2++) {
      const w = createWorld(level, { session: freshSession() })
      const input = settle(w)
      until(w, ['right'], () => !w.player.onGround, 300, input)
      const events = []
      for (let i = 0; i < 40; i++) {
        stepWorld(w, input(i === t1 || i === t2 ? ['right', 'jump'] : ['right']))
        events.push(...w.events)
        w.events.length = 0
      }
      const jumps = jumpsIn(events)
      // The `until` above was his first tick off the ground, so i = t is t + 1 ticks after it:
      // coyote time covers the first press if that is no more than coyoteTicks, and nothing covers the second.
      const want = t1 + 1 <= TUNING.coyoteTicks ? 1 : 0
      eq(jumps, want, `jumps for presses ${t1 + 1} and ${t2 + 1} ticks after he left the ledge`)
    }
  }
  // On the flat: mashing jump every other tick gives one jump per landing, never one in mid-air.
  const w = flat()
  const input = settle(w)
  let airborneJumps = 0
  for (let i = 0; i < 600; i++) {
    const grounded = w.player.onGround
    stepWorld(w, input(i % 2 ? ['jump'] : []))
    if (jumpsIn(w.events) > 0 && !grounded && w.player.coyote === 0 && w.player.airT > 1) airborneJumps++
    w.events.length = 0
  }
  eq(airborneJumps, 0, 'jumps started in mid-air while mashing')
})

/* ---- entities coming and going mid-loop ---- */

sim.registerEntity('testchaos', {
  init(e) {
    sim.setBox(e, 24, 24)
  },
  update(e, w) {
    if (e.stateT % 3 === 0) sim.spawn(w, 'testchaos2', e.x + 12, e.y)
    if (e.stateT % 7 === 0) for (const o of w.entities) if (o.kind === 'testchaos2' && sim.chance(w, 0.5)) sim.kill(o)
    if (e.stateT === 40) sim.kill(e)
    sim.moveBody(e, w)
  },
  onTouch(e, w) {
    sim.spawn(w, 'testchaos', e.x, e.y)
    sim.kill(e)
    return true
  },
  onSpray(e, w) {
    sim.shoot(w, 'testchaos2', e.x, e.y, 50, -200)
    sim.kill(e)
    return true
  },
  onBump(e, w) {
    sim.spawn(w, 'testchaos2', e.x, e.y)
    sim.kill(e)
  },
})
sim.registerEntity('testchaos2', {
  offscreen: 'remove',
  init(e) {
    sim.setBox(e, 10, 10)
    e.solid = 'top'
  },
  update(e, w) {
    e.vx = e.id % 2 ? 80 : -80
    sim.moveBody(e, w)
    if (e.stateT > 50) sim.kill(e)
    if (e.stateT === 10 && sim.countAlive(w, 'testchaos') < 20) sim.spawn(w, 'testchaos', e.x, e.y)
  },
  onTouch(e, w) {
    for (const o of w.entities) if (o.kind === 'testchaos2') sim.kill(o)
    return true
  },
})

test('review, entities: spawning and killing from update, onTouch, onSpray and onBump never corrupts the list', () => {
  const w = makeWorld(['', '  1  ?1  1 1   1    1  c', '     ?', '', '  @', FLOOR, FLOOR], { legend: { 1: { kind: 'testchaos' } } })
  const input = makeInput()
  let most = 0
  let made = 0
  let lastId = w.nextId
  for (let i = 0; i < 4000; i++) {
    w.player.invuln = 99
    stepChecked(w, input(i % 40 < 28 ? ['right', 'spray'] : i % 40 < 34 ? ['left', 'jump', 'spray'] : ['jump', 'up', 'spray']), 'chaos')
    most = Math.max(most, w.entities.length)
    made += w.nextId - lastId
    lastId = w.nextId
    const ids = new Set()
    for (const e of w.entities) {
      ok(!e.dead, `a dead ${e.kind} was left in the list at tick ${i}`)
      ok(!ids.has(e.id), `entity #${e.id} is in the list twice at tick ${i}`)
      ids.add(e.id)
      ok(Number.isFinite(e.x + e.y + e.vx + e.vy), `${e.kind} #${e.id} has a non-number position at tick ${i}`)
    }
    for (const e of [...w.solids, ...w.actives]) ok(e.dead || ids.has(e.id), `an awake ${e.kind} is not in the entity list at tick ${i}`)
  }
  ok(made > 200, `only ${made} entities were made`)
  ok(most < 200, `${most} entities alive at once: something is not being removed`)
  // An entity that kills itself in init never shows up (a boss that stays beaten after a retry).
  sim.registerEntity('testboss', {
    alwaysActive: true,
    init(e, w2) {
      sim.setBox(e, 64, 64)
      if (sim.getFlag(w2, 'testboss')) sim.kill(e)
    },
    update(e, w2) {
      e.vars.updates = (e.vars.updates ?? 0) + 1
      sim.setBoss(w2, 'TEST BOSS', e.hp, e.maxHp)
    },
  })
  const first = flat(['  @      1'], { legend: { 1: { kind: 'testboss' } } })
  stepWorld(first, makeInput()([]))
  ok(find(first, 'testboss') && first.boss, 'the boss is there the first time')
  sim.setFlag(first, 'testboss')
  const again = createWorld(first.level, { session: first.session, flags: first.flags })
  stepWorld(again, makeInput()([]))
  eq(again.entities.length, 0, 'entities after a retry with the boss beaten')
  eq(again.boss, null, 'the beaten boss never ran')
})

/* ---- warps, retries, the clock, the counters ---- */

/** Everything about an area that should hold still while Maxx is somewhere else. */
function areaSnapshot(area) {
  return JSON.stringify([
    Array.from(area.grid.t),
    Array.from(area.grid.d),
    area.entities.map((e) => [e.id, e.kind, e.variant, e.state, e.stateT, e.x, e.y, e.vx, e.vy, e.hp, e.facing, e.active, e.dead, e.harmful, e.solid, e.vars]),
  ])
}

test('review, warps: not while hurt, no stale jump on the far side, no water carried over, the area left behind holds still', () => {
  const onPipe = (w) => {
    place(w, 6 * TILE + 20, 9 * TILE - MAXX_H)
    w.player.invuln = 99999
  }
  // Hurt on the pipe with down held: no trip until he has recovered.
  let w = twoAreas()
  let input = makeInput()
  onPipe(w)
  stepWorld(w, input([]))
  w.player.state = 'hurt'
  w.player.stateT = 0
  let started = -1
  for (let i = 1; i <= 40 && started < 0; i++) {
    stepWorld(w, input(['down']))
    if (w.warp) started = i
    else if (w.player.state === 'hurt') eq(w.warp, null, 'a warp began while he was hurt')
  }
  ok(started >= TUNING.hurtTicks, `the warp began ${started} ticks into a ${TUNING.hurtTicks}-tick hurt`)
  // ... and the same at a door.
  w = twoAreas()
  input = settle(w)
  place(w, find(w, 'door').x + 3, 10 * TILE - MAXX_H)
  stepWorld(w, input([]))
  w.player.state = 'hurt'
  w.player.stateT = 0
  stepWorld(w, input(['up']))
  eq(w.warp, null, 'a door opened for him while he was hurt')

  // Jump pressed just before he lands on the pipe with down held: it must not fire in the next area.
  const drop = () => {
    const x = twoAreas()
    place(x, 6 * TILE + 20, 9 * TILE - MAXX_H - 40)
    x.player.onGround = false
    return x
  }
  w = drop()
  const lands = until(w, ['down'], () => w.player.onGround, 100)
  for (const early of [1, 3, 6]) {
    w = drop()
    input = makeInput()
    const events = []
    for (let i = 1; i <= 160; i++) {
      stepWorld(w, input(i === lands + 1 - early ? ['down', 'jump'] : ['down']))
      events.push(...w.events)
      w.events.length = 0
    }
    eq(w.area.id, 'bonus', `jump pressed ${early} ticks before landing: went down the pipe`)
    eq(jumpsIn(events), 0, `jump pressed ${early} ticks before landing: jumps`)
    ok(w.player.onGround, 'standing on the far pipe')
  }

  // Spraying into the pipe: the water stays behind, and the gun is off for the trip.
  w = twoAreas()
  input = makeInput()
  onPipe(w)
  for (let i = 0; i < 12; i++) stepWorld(w, input(['spray']))
  ok(w.droplets.length > 3, 'water in the air before the trip')
  until(w, ['spray', 'down'], () => w.warp !== null, 10, input)
  const atStart = areaSnapshot(w.areas.main)
  const clock = [w.tick, w.timeLeft, w.chainT]
  eq(w.player.spraying, false, 'spraying during the trip')
  until(w, ['spray', 'down'], () => w.area.id === 'bonus', 100, input)
  eq(w.droplets.length, 0, 'droplets on arrival')
  eq(areaSnapshot(w.areas.main), atStart, 'the first area changed while he slid into the pipe')
  until(w, ['spray', 'down'], () => w.warp === null, 100, input)
  eq(w.droplets.length, 0, 'droplets when the trip ends')
  eq([w.tick, w.timeLeft, w.chainT].join(), clock.join(), 'tick, clock and chain timer across the trip')
  // Five seconds of running about and spraying in the bonus room; the first area must not move.
  for (let i = 0; i < 300; i++) stepWorld(w, input(i % 50 < 30 ? ['right', 'spray'] : ['left', 'jump', 'spray']))
  eq(areaSnapshot(w.areas.main), atStart, 'the first area changed while he was in the bonus room')
  ok(sim.warpTo(w, 'main:out', 'door') || (stepWorld(w, input([])), sim.warpTo(w, 'main:out', 'door')), 'could not warp back')
  until(w, [], () => w.area.id === 'main', 100, input)
  eq(areaSnapshot(w.areas.main), atStart, 'the first area was not as he left it')
  until(w, [], () => w.warp === null, 100, input)
  eq(w.player.x + MAXX_W / 2, 25 * TILE + TILE / 2, "arrived at the 'out' marker")

  // A door to a marker in the same area: a plain hop, same entities, camera cut to the far end.
  const legend = { 1: { kind: 'door', props: { to: 'far' } }, 2: { kind: 'marker', props: { name: 'far' } } }
  const row = '#'.repeat(120)
  w = makeWorld(['  @ 1   c' + ' '.repeat(91) + '2  o', row, row], { legend })
  input = settle(w)
  const ents = w.entities
  place(w, find(w, 'door').x + 3, 10 * TILE - MAXX_H)
  stepWorld(w, input([]))
  until(w, ['up'], () => w.warp !== null, 5, input)
  until(w, [], () => w.warp === null, 100, input)
  eq(w.player.x + MAXX_W / 2, 100 * TILE + TILE / 2, 'x at the far marker')
  ok(w.entities === ents && w.area.id === 'main', 'same area, same entities')
  ok(Math.abs(w.camera.x + VIEW_W / 2 - w.player.x) < VIEW_W / 2, 'the camera did not come with him')
})

test('review, retry: flags and tokens carry over, and so does credit for cars already washed (once each)', () => {
  const legend = { 1: { kind: 'spawner', props: { variant: 'compact', every: 30, max: 3, count: 2, delay: 1 } } }
  const level = makeLevel(['  @    c      k      c        1      $', FLOOR, FLOOR], { legend })
  let w = createWorld(level, { session: freshSession() })
  let input = makeInput()
  const safe = (x) => (x.player.invuln = 99999)
  safe(w)
  eq(w.stats.carsTotal, 4, 'carsTotal: two placed, two from the spawner')
  washNow(w, all(w, 'car')[0])
  eq(w.stats.carsWashed, 1, 'washed the first placed car')
  const flag = find(w, 'checkpoint')
  place(w, flag.x, 10 * TILE - MAXX_H)
  stepWorld(w, input([]))
  ok(w.checkpoint, 'checkpoint taken')
  until(w, [], () => all(w, 'car').some((c) => c.vars.n === 0), 200, input)
  washNow(w, all(w, 'car').find((c) => c.vars.n === 0))
  eq(w.stats.carsWashed, 2, "washed the spawner's first car")
  place(w, find(w, 'token').x, 10 * TILE - MAXX_H)
  // Two ticks: the camera has to get there and wake the token first.
  until(w, [], () => w.stats.tokens[0], 5, input)
  sim.setFlag(w, 'gate', 7)
  const scoreBefore = w.session.score
  sim.grimePlayer(w)

  const retry = createWorld(level, { session: w.session, checkpoint: w.checkpoint, flags: w.flags, tokens: w.stats.tokens })
  input = makeInput()
  safe(retry)
  ok(retry.flags !== w.flags, 'the retry shares its flags object with the old world')
  eq(sim.getFlag(retry, 'gate'), 7, 'flag kept')
  eq(retry.stats.tokens.join(), 'true,false,false', 'token kept')
  eq(find(retry, 'token').state, 'owned', 'the token shows as owned')
  eq(retry.stats.carsWashed, 2, 'carsWashed on the retry')
  eq(retry.stats.carsTotal, 4, 'carsTotal on the retry')
  eq(retry.session.score, scoreBefore, 'the score carries over')
  eq(retry.stats.score, 0, "this attempt's own score starts again")
  const cars = all(retry, 'car')
  eq(cars.length, 2, 'both placed cars are back')
  ok(cars.every((c) => c.state !== 'clean' && c.harmful), 'they come back dirty')
  const events = []
  washNow(retry, cars[0])
  eq(retry.stats.carsWashed, 2, 'washing the same car again is not counted twice')
  eq(retry.stats.score, 200, 'but it still scores')
  washNow(retry, cars[1])
  eq(retry.stats.carsWashed, 3, 'the car he had not washed before counts')
  until(retry, [], () => all(retry, 'car').some((c) => c.vars.n === 0), 200, input, events)
  washNow(retry, all(retry, 'car').find((c) => c.vars.n === 0))
  eq(retry.stats.carsWashed, 3, "the spawner's first car was credited last time")
  ok(!sim.isSpotless(retry), 'not spotless yet')
  until(retry, [], () => all(retry, 'car').some((c) => c.vars.n === 1), 200, input, events)
  washNow(retry, all(retry, 'car').find((c) => c.vars.n === 1))
  events.push(...retry.events)
  eq(retry.stats.carsWashed, 4, "the spawner's second car counts")
  ok(sim.isSpotless(retry), 'SPOTLESS can be finished on a retry')
  ok(has(events, 'banner', (e) => e.text === 'SPOTLESS!'), "no 'SPOTLESS!' banner")
  // A fresh visit starts from nothing.
  eq(createWorld(level, { session: freshSession() }).stats.carsWashed, 0, 'carsWashed without flags')
})

test('review, clock: both warnings, it stops dead at zero, odd level times are survivable', () => {
  const w = flat(['  @'], { time: 31 })
  const input = makeInput()
  const events = []
  until(w, [], () => w.status !== 'play', 31 * 60 + 5, input, events)
  eq(events.filter((ev) => ev.type === 'sfx' && ev.id === 'timeWarn').length, 2, "'timeWarn' sounds (30 s and 10 s)")
  eq(w.status, 'timeup', 'status')
  for (let i = 0; i < 100; i++) stepWorld(w, input(['right', 'jump']))
  eq(w.timeLeft, 0, 'timeLeft stays at 0')
  eq(w.statusT, 100, 'statusT counts on')
  eq(w.tick, 31 * 60, 'world.tick stopped with the clock')
  for (const time of [NaN, 0, -5, undefined, Infinity]) {
    const level = makeLevel(['  @', FLOOR, FLOOR])
    level.time = time
    const x = createWorld(level, { session: freshSession() })
    ok(Number.isFinite(x.timeLeft) && x.timeLeft > 0 === (time !== Infinity) || time === Infinity, `time ${time}: timeLeft ${x.timeLeft}`)
    if (time !== Infinity) ok(x.timeLeft > 60, `time ${time}: the clock starts at ${x.timeLeft} ticks`)
  }
  const short = makeLevel(['  @', FLOOR, FLOOR], { time: 0.5 })
  const s = createWorld(short, { session: freshSession() })
  eq(until(s, ['jump'], () => s.status !== 'play', 100), 30, 'ticks until a half-second clock runs out, mid-jump')
  eq(s.status, 'timeup', 'status')
})

test('review, counters: score, coins and lives cannot overflow or turn into NaN', () => {
  const w = flat(['  @'], { session: { lives: TUNING.maxLives - 1, coins: 99, score: TUNING.maxScore - 15 } })
  for (let i = 0; i < 5; i++) sim.addCoins(w, 100)
  eq(w.session.lives, TUNING.maxLives, 'lives stop at the cap')
  eq(w.session.coins, 99, 'coins after five hundred more')
  eq(w.session.score, TUNING.maxScore, 'score stops at the cap')
  sim.addScore(w, 1e12)
  eq(w.session.score, TUNING.maxScore, 'score after a huge award')
  for (const n of [NaN, -5, 0, 0.4, Infinity * 0]) sim.addCoins(w, n)
  eq(w.session.coins, 99, 'coins after nonsense amounts')
  eq(w.stats.coins, 500, 'coins this level')
  for (const n of [NaN, Infinity, -Infinity]) sim.addScore(w, n)
  eq(w.session.score, TUNING.maxScore, 'score after nonsense amounts')
  sim.addScore(w, -1e12)
  eq(w.session.score, 0, 'score cannot go below zero')
  for (let i = 0; i < 5; i++) sim.giveLife(w)
  eq(w.session.lives, TUNING.maxLives, 'lives after more 1UPs')
  // A session in any state is made sane.
  const level = makeLevel(['  @', FLOOR, FLOOR])
  const odd = createWorld(level, { session: { lives: NaN, score: -5, coins: 250, pips: 7.5, turbo: 'yes' } })
  eq(JSON.stringify(odd.session), JSON.stringify({ lives: contract.START_LIVES, score: 0, coins: 99, pips: 3, turbo: false }), 'a nonsense session')
  const empty = createWorld(level, { session: {} })
  sim.addCoins(empty, 1)
  eq(JSON.stringify(empty.session), JSON.stringify({ pips: 3, lives: contract.START_LIVES, score: TUNING.coinScore, coins: 1, turbo: false }), 'an empty session')
  eq(empty.player.pips, 3, 'pips')
})

test('review, clear: riding a car through the exit, wax running out and a drop beyond the arch', () => {
  // The world stops on a clear: whatever he rides must stop carrying him.
  let w = flat(['  @                    c'])
  let input = settle(w)
  const car = find(w, 'car')
  washNow(w, car)
  place(w, car.x + 30, car.y - MAXX_H - 4)
  until(w, [], () => w.player.ridingId === car.id, 60, input)
  sim.completeLevel(w, 'goal')
  const x0 = w.player.x
  const carX = car.x
  for (let i = 0; i < 60; i++) stepWorld(w, input(['left']))
  eq(car.x, carX, 'the car stands still')
  eq(w.player.x, x0, 'and he stands still on its roof')
  eq(feet(w), car.y, 'feet on the roof')
  // Wax that runs out during the victory walk must not start the level song over the jingle.
  w = flat(['  @        G'])
  input = settle(w)
  sim.giveWax(w, 20)
  w.events.length = 0
  sim.completeLevel(w, 'goal')
  const events = []
  until(w, [], () => false, 60, input, events)
  eq(w.player.wax, 0, 'wax ran out')
  eq(events.filter((ev) => ev.type === 'music').length, 0, 'music requests during the clear')
  // The victory walk stops at a drop.
  const row = '#'.repeat(16) + ' '.repeat(10) + '#'.repeat(30)
  w = makeWorld(['  @        G', row, row])
  input = settle(w)
  until(w, ['right'], () => w.status !== 'play', 300, input)
  eq(w.status, 'clear', 'cleared')
  for (let i = 0; i < 300; i++) stepWorld(w, input([]))
  ok(w.player.onGround && feet(w) === 10 * TILE, 'he walked off the edge after the arch')
  ok(w.player.x + MAXX_W <= 16 * TILE + 1, `he stopped at x=${round(w.player.x)}, past the edge`)
  ok(w.player.x > 13 * TILE, 'he did not walk at all')
})

test('review, spawner: it waits for room instead of stacking cars, and a washed car does not hold up the next', () => {
  let w = flat(['  @     X          1'], { legend: { 1: { kind: 'spawner', props: { variant: 'van', every: 30, max: 6, delay: 1 } } } })
  let input = makeInput()
  let worst = 0
  for (let i = 0; i < 1200; i++) {
    w.player.invuln = 99999
    place(w, 2 * TILE, 10 * TILE - MAXX_H)
    stepWorld(w, input([]))
    const cars = all(w, 'car')
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) worst = Math.max(worst, Math.min(cars[a].x + cars[a].w, cars[b].x + cars[b].w) - Math.max(cars[a].x, cars[b].x))
    }
  }
  ok(all(w, 'car').length >= 3, 'the spawner stopped sending')
  ok(worst <= 0.5, `two cars overlapped by ${round(worst)} px`)
  // max 1: the next car comes once the last is washed, though the washed one is still driving off.
  w = flat(['  @                1'], { legend: { 1: { kind: 'spawner', props: { variant: 'compact', every: 20, max: 1, delay: 1 } } } })
  input = makeInput()
  let most = 0
  let mostDirty = 0
  for (let i = 0; i < 400; i++) {
    w.player.invuln = 99999
    stepWorld(w, input([]))
    const cars = all(w, 'car')
    mostDirty = Math.max(mostDirty, cars.filter((c) => c.state !== 'clean').length)
    if (i > 200) for (const c of cars) if (c.state !== 'clean' && c.stateT > 30) washNow(w, c)
    most = Math.max(most, cars.length)
  }
  eq(mostDirty, 1, 'dirty cars about at once with max 1')
  ok(most >= 3, `only ${most} cars about at once: a washed car is holding up the spawner`)
})

test('review, controller: a diagonal stick is still a full run, and a broken axis is ignored', () => {
  const speedAt = (x, y, ticks = 30) => {
    const w = flat()
    const input = settle(w)
    for (let i = 0; i < ticks; i++) stepWorld(w, input([], { axisX: x, axisY: y, device: 'gamepad' }))
    return w
  }
  // What engine/input.ts reports for a stick pushed up and to the right: about 0.63 to 0.75 on each axis.
  let w = speedAt(0.63, -0.63)
  ok(w.player.vx > TUNING.runSpeed * 0.85, `run-and-aim-up on the stick only reaches ${round((w.player.vx / TUNING.runSpeed) * 100)}% of top speed`)
  eq(w.player.aim, 'up', 'aim on the diagonal')
  eq(speedAt(0.74, -0.74).player.vx, TUNING.runSpeed, 'speed with a firm diagonal')
  near(speedAt(0.5, 0).player.vx, TUNING.runSpeed * 0.5, 0.01, 'a half push sideways is still half speed')
  near(speedAt(-0.1, 0).player.vx, -TUNING.runSpeed * TUNING.analogMin, 0.01, 'a light push is the minimum speed')
  eq(speedAt(5, 0).player.vx, TUNING.runSpeed, 'an axis beyond 1 is clamped')
  for (const bad of [NaN, undefined]) {
    w = speedAt(bad, bad, 10)
    ok(w.player.vx === 0 && Number.isFinite(w.player.x), `axis ${bad}: vx ${w.player.vx}, x ${w.player.x}`)
    eq(w.player.aim, 'fwd', `axis ${bad}: aim`)
  }
  // Down and across in the air with spray: hovering, and drifting at close to the hover speed.
  w = flat()
  const input = settle(w)
  until(w, ['jump'], () => w.player.vy > 0, 100, input)
  let hovered = 0
  for (let i = 0; i < 30; i++) {
    stepWorld(w, input(['spray'], { axisX: 0.66, axisY: 0.66, device: 'gamepad' }))
    if (w.player.hovering) hovered++
  }
  ok(hovered >= 25, 'no hover with the stick down and across')
  ok(w.player.vx > TUNING.hoverSpeed * 0.85, `hover drift on a diagonal stick is ${round(w.player.vx)} px/s`)
})

/* ---- the helper API, used the way the kinds still to come will use it ---- */

sim.registerEntity('testbrush', {
  alwaysActive: true,
  init(e) {
    sim.setBox(e, 28, 28, 40)
    e.gravity = 0
    e.collides = false
    e.harmful = true
    if (e.props.half) e.vars.t = 0.5
  },
  update(e) {
    if (sim.shuttle(e, sim.propNum(e, 'dx', 0) * TILE, sim.propNum(e, 'dy', 0) * TILE, 120, sim.propNum(e, 'wait', 10))) e.vars.ends = (e.vars.ends ?? 0) + 1
  },
})
const WEED = { bounceY: 0.8, bounceX: 1 }
sim.registerEntity('testweed', {
  init(e) {
    sim.setBox(e, 20, 20, sim.propNum(e, 'lift', 0))
    e.vx = 60
  },
  update(e, w) {
    const vy = e.vy
    sim.moveBody(e, w, WEED)
    if (vy > 0 && e.vy < 0) e.vars.bounces = (e.vars.bounces ?? 0) + 1
    if (e.hitWall !== 0) e.vars.walls = (e.vars.walls ?? 0) + 1
  },
})
sim.registerEntity('testbird', {
  init(e) {
    sim.setBox(e, 20, 14, 100)
    e.gravity = 0
    e.collides = false
  },
  update(e, w) {
    e.vx = -90
    e.vy = Math.sin(e.stateT * 0.1) * 60
    sim.moveBody(e, w)
    if (sim.every(e, 60, 10)) e.vars.beats = (e.vars.beats ?? 0) + 1
  },
})
sim.registerEntity('testwind', {
  init(e) {
    sim.setBox(e, 96, 64)
    e.gravity = 0
    e.collides = false
  },
  update() {},
  onTouch(e, w) {
    sim.pushPlayer(w, e.facing * 1.5)
    return true
  },
})
sim.registerEntity('testtarget', {
  init(e) {
    sim.setBox(e, 24, sim.propNum(e, 'h', 20))
    e.vars.hits = 0
  },
  update() {},
  onSpray(e) {
    e.vars.hits++
    return true
  },
})

test('review, API: shuttle, every, shoot, bounces, fliers, wind, and how tall a critter must be to be washed', () => {
  // A brush on a rail (shuttle): to and fro, resting at each end, never off its rail.
  let w = flat(['  @      1    2'], { legend: { 1: { kind: 'testbrush', props: { dx: 3 } }, 2: { kind: 'testbrush', props: { dy: -2, half: true, wait: 0 } } } })
  let input = makeInput()
  const [brush, half] = all(w, 'testbrush')
  let lo = Infinity
  let hi = -Infinity
  let rested = 0
  for (let i = 0; i < 400; i++) {
    w.player.invuln = 99999
    const x = brush.x
    stepWorld(w, input([]))
    if (i === 0) near(half.y, half.spawnY - TILE, 2.01, 'a rail rider can start part-way along (vars.t = 0.5)')
    lo = Math.min(lo, brush.x)
    hi = Math.max(hi, brush.x)
    if (brush.x === x) rested++
    else near(Math.abs(brush.x - x), 2, 1e-9, 'rail speed in pixels a tick')
    near(brush.vx, (brush.x - x) * 60, 1e-6, 'vx reports how it moved')
  }
  eq(lo, brush.spawnX, 'left end of the rail')
  near(hi, brush.spawnX + 3 * TILE, 1e-9, 'right end of the rail')
  ok(brush.vars.ends >= 6, `reached an end ${brush.vars.ends} times in 400 ticks`)
  near(rested, brush.vars.ends * 10, 12, 'ticks at rest: 10 at each end')
  ok(half.vars.ends >= 8 && half.y <= half.spawnY && half.y >= half.spawnY - 2 * TILE, 'the upright rail rider stayed on its rail')

  // every(): a beat from stateT, with a phase.
  w = makeWorld(['', '', '', '                    X', '', '', '  @                 X      1', FLOOR, FLOOR], { legend: { 1: { kind: 'testbird' } } })
  input = makeInput()
  const bird = find(w, 'testbird')
  bird.active = true
  const x0 = bird.x
  for (let i = 0; i < 200; i++) {
    w.player.invuln = 99999
    stepWorld(w, input([]))
  }
  eq(bird.vars.beats, 4, 'every(e, 60, 10) in 200 ticks (10, 70, 130, 190)')
  // A flier with collides off goes straight through walls.
  near(x0 - bird.x, 90 * (200 / 60), 0.01, 'the flier covered its ground, wall or no wall')
  ok(bird.x + bird.w < 20 * TILE, 'it is past the wall')

  // shoot(): a projectile with its velocity and facing set.
  const clod = sim.shoot(w, 'clod', 300, 200, -120, -200)
  ok(clod && clod.active && clod.vx === -120 && clod.vy === -200 && clod.facing === -1, 'shoot() sets velocity and facing')
  eq(sim.shoot(w, 'no-such-kind', 0, 0, 1, 1), null, 'shoot() of an unknown kind')
  until(w, [], () => clod.dead, 300, input)
  ok(clod.dead, 'the clod never landed')

  // A bouncer: moveBody with bounceY and bounceX.
  w = makeWorld(['  @       X', '          X', '          X', '          X', FLOOR, FLOOR], { legend: { 1: { kind: 'testweed', props: { lift: 96 } } } })
  input = settle(w)
  const weed = sim.spawn(w, 'testweed', 6 * TILE, 10 * TILE, { props: { lift: 96 } })
  for (let i = 0; i < 400; i++) {
    w.player.invuln = 99999
    stepWorld(w, input([]))
    ok(!insideSolid(w, weed), `the bouncer is inside a tile at tick ${i}`)
  }
  ok(weed.vars.bounces >= 3, `it bounced ${weed.vars.bounces} times off the floor`)
  ok(weed.vars.walls >= 1 && weed.vx < 0, 'it did not bounce back off the wall')
  ok(weed.onGround && weed.vy === 0, 'it never came to rest on the floor')

  // Wind: the entity's box is the zone, onTouch pushes.
  w = flat(['X @       1'], { legend: { 1: { kind: 'testwind' } } })
  input = settle(w)
  const wind = find(w, 'testwind')
  place(w, wind.x + 60, 10 * TILE - MAXX_H)
  for (let i = 0; i < 20; i++) stepChecked(w, input([]), 'wind')
  near(w.player.x, wind.x + 60 - 30, 0.01, 'standing in the wind for 20 ticks at 1.5 px a tick')
  const before = w.player.x
  for (let i = 0; i < 20; i++) stepChecked(w, input(['right']), 'wind')
  ok(w.player.x > before + 20, 'he cannot make headway against the wind at a run')
  for (let i = 0; i < 300; i++) stepChecked(w, input([]), 'wind')
  ok(w.player.x + MAXX_W <= wind.x + 0.001, 'the wind did not blow him out of its zone')
  // ... and against a wall it holds him there, not in it.
  wind.x = TILE
  place(w, TILE + 40, 10 * TILE - MAXX_H)
  for (let i = 0; i < 60; i++) stepChecked(w, input([]), 'wind against a wall')
  eq(w.player.x, TILE, 'blown flush against the wall')

  // The nozzle is 30 px up: close in, forward spray clears a 20 px critter and washes a 28 px one.
  const hits = (h, col) => {
    const x = flat([`  @${' '.repeat(col - 3)}1`], { legend: { 1: { kind: 'testtarget', props: { h } } } })
    const xi = settle(x)
    for (let i = 0; i < 60; i++) stepWorld(x, xi(['spray']))
    return find(x, 'testtarget').vars.hits
  }
  eq(hits(20, 4), 0, 'hits on a 20 px critter a tile and a half away')
  ok(hits(28, 4) >= 20, `only ${hits(28, 4)} hits on a 28 px critter a tile and a half away`)
  ok(hits(20, 7) >= 10, `only ${hits(20, 7)} hits on a 20 px critter four tiles away`)
})

test('review, API: a boss arena lock holds the camera and Maxx, slides rather than jumps, and ends with the area', () => {
  const row = '#'.repeat(80)
  const w = makeWorld(['  @', row, row])
  const input = settle(w)
  const p = w.player
  place(w, 40 * TILE, 10 * TILE - MAXX_H)
  stepWorld(w, input([]))
  ok(Math.abs(w.camera.x + VIEW_W / 2 - p.x) < 100, 'a move of more than a screen is a camera cut')
  const x0 = 31 * TILE
  const x1 = 53 * TILE
  sim.lockCamera(w, x0, x1)
  let fastest = 0
  const track = (held, n) => {
    for (let i = 0; i < n; i++) {
      const cx = w.camera.x
      stepWorld(w, input(held))
      fastest = Math.max(fastest, Math.abs(w.camera.x - cx))
      if (w.camBounds && i > 30) ok(w.camera.x >= x0 && w.camera.x <= x1 - VIEW_W, `camera at ${round(w.camera.x)}, outside the locked arena`)
    }
  }
  track(['left'], 240)
  eq(p.x, x0, 'held at the left edge of the arena')
  eq(p.hitWall, -1, 'hitWall at the arena edge')
  eq(w.camera.x, x0, 'camera at the left edge of the arena')
  track(['right'], 400)
  eq(p.x, x1 - MAXX_W, 'held at the right edge of the arena')
  eq(w.camera.x, x1 - VIEW_W, 'camera at the right edge of the arena')
  sim.unlockCamera(w)
  track(['right'], 100)
  ok(p.x > x1 + 100, 'free to leave once unlocked')
  near(w.camera.x + VIEW_W / 2 - (p.x + MAXX_W / 2), TUNING.camLookAhead, 0.01, 'camera following again')
  ok(fastest <= TUNING.camMaxSpeed + 1e-9, `the camera moved ${round(fastest)} px in one tick`)
  // Locked while he is still outside: he is not dragged in, he can only walk in.
  place(w, 10 * TILE, 10 * TILE - MAXX_H)
  stepWorld(w, input([]))
  sim.lockCamera(w, x0, x1)
  stepWorld(w, input([]))
  eq(p.x, 10 * TILE, 'not moved by the lock')
  for (let i = 0; i < 20; i++) stepWorld(w, input(['left']))
  eq(p.x, 10 * TILE, 'cannot walk further out')
  until(w, ['right'], () => p.x > x0 + 40, 900, input)
  until(w, ['left'], () => p.hitWall === -1, 200, input)
  eq(p.x, x0, 'once inside he is held in')
  // The lock belongs to the area.
  const two = twoAreas()
  const tInput = settle(two)
  sim.lockCamera(two, 0, VIEW_W)
  ok(sim.warpTo(two, 'bonus:room', 'door'), 'warpTo')
  until(two, [], () => two.warp === null, 100, tInput)
  eq(two.camBounds, null, 'the lock after leaving the area')
})

test('review, levels: validateLevel warns about a start or marker under a block, a pipe with no pipe, an unknown car', () => {
  const legend = { 1: { kind: 'marker', props: { name: 'm' } }, 2: { kind: 'pipe', props: { to: 'm' } }, q: { kind: 'car', variant: 'limo' } }
  const { warnings } = validateLevel(makeLevel(['  X    X', '  @    1   2   q   G', FLOOR, FLOOR], { legend }))
  const need = (text, what) => ok(warnings.some((s) => s.includes(text)), `${what} not warned about (in ${JSON.stringify(warnings)})`)
  need('start at column 2', 'a start under a block')
  need('marker at column 7', 'a marker under a block')
  need("just above a 'P' tile", 'a pipe with no pipe under it')
  need("'limo'", 'an unknown car variant')
  eq(warnings.filter((s) => s.includes('stand inside')).length, 2, 'stand-inside warnings')
})

/* ---- the long random run ---- */

/** The first number anywhere in the world's state that is not finite, as a path; '' if all are. */
function badNumber(w) {
  const check = (obj, path) => {
    for (const key of Object.keys(obj)) {
      const v = obj[key]
      if (typeof v === 'number' && !Number.isFinite(v)) return `${path}.${key} = ${v}`
    }
    return ''
  }
  let bad = check(w, 'world') || check(w.player, 'player') || check(w.camera, 'camera') || check(w.stats, 'stats') || check(w.session, 'session') || check(w.flags, 'flags')
  if (!bad && w.checkpoint) bad = check(w.checkpoint, 'checkpoint')
  if (!bad && w.warp) bad = check(w.warp, 'warp')
  for (let i = 0; !bad && i < w.droplets.length; i++) bad = check(w.droplets[i], 'droplet')
  for (const id of Object.keys(w.areas)) {
    for (const e of w.areas[id].entities ?? []) {
      if (!bad) bad = check(e, `${e.kind} #${e.id}`) || check(e.vars, `${e.kind} #${e.id}.vars`)
    }
  }
  return bad
}

/**
 * Random input with both stick axes, played the way the play scene will play
 * it (a new world from the checkpoint when an attempt ends), with every
 * invariant checked on every tick. Returns the hash of every tick.
 */
function longFuzz(level, seed, ticks, checkpoint = null) {
  let s = seed >>> 0
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  let w = createWorld(level, { session: freshSession(), seed, checkpoint })
  const input = makeInput()
  const hashes = []
  const out = { hashes, attempts: 1, ends: {}, areas: new Set(), maxJumps: 0, maxHover: 0, furthest: 0 }
  let held = []
  let extra
  let holdFor = 0
  let airJumps = 0
  let hoverUsed = 0
  for (let t = 1; t <= ticks; t++) {
    if (holdFor-- <= 0) {
      held = []
      const r = next()
      if (r < 0.55) held.push('right')
      else if (r < 0.8) held.push('left')
      if (next() < 0.4) held.push('jump')
      if (next() < 0.5) held.push('spray')
      if (next() < 0.15) held.push('down')
      if (next() < 0.12) held.push('up')
      extra = next() < 0.3 ? { axisX: next() * 2 - 1, axisY: next() < 0.5 ? next() * 2 - 1 : 0, device: 'gamepad' } : undefined
      holdFor = Math.floor(next() * 20)
    }
    const p = w.player
    stepWorld(w, input(held, extra))
    const at = `seed ${seed}, tick ${t} (attempt ${out.attempts}, world tick ${w.tick})`
    const jumped = jumpsIn(w.events)
    airJumps += jumped
    if (p.hovering) hoverUsed++
    out.maxJumps = Math.max(out.maxJumps, airJumps)
    out.maxHover = Math.max(out.maxHover, hoverUsed)
    // Only the ground and a pipe start a new airtime for jumping; a spring also refills the hover.
    if (p.onGround || w.warp) airJumps = jumped
    if (p.onGround || w.warp || w.events.some((ev) => ev.type === 'sfx' && ev.id === 'spring')) hoverUsed = 0
    w.events.length = 0
    hashes.push(worldHash(w))
    out.areas.add(w.area.id)
    if (w.area.id === 'main') out.furthest = Math.max(out.furthest, p.x)

    const bad = badNumber(w)
    if (bad) throw new Error(`${at}: ${bad}`)
    if (airJumps > 1) throw new Error(`${at}: a second jump in one airtime`)
    if (hoverUsed > TUNING.hoverTicks) throw new Error(`${at}: ${hoverUsed} ticks of hover in one airtime`)
    const areaW = w.grid.w * TILE
    const areaH = w.grid.h * TILE
    if (p.x < 0 || p.x + p.w > areaW) throw new Error(`${at}: Maxx is outside the area at x=${p.x}`)
    if (p.y < -30 * TILE) throw new Error(`${at}: Maxx is far above the area at y=${p.y}`)
    if (w.status === 'play' && !w.warp) {
      if (p.y > areaH + 8) throw new Error(`${at}: Maxx fell out of the area (y=${p.y}) and was not grimed`)
      const hit = insideSolid(w, p)
      if (hit) throw new Error(`${at}: Maxx at (${round(p.x)}, ${round(p.y)}) is inside solid tile ${hit}`)
    }
    if (!(p.pips >= 0 && p.pips <= contract.MAX_PIPS)) throw new Error(`${at}: pips ${p.pips}`)
    if (w.droplets.length > TUNING.maxDroplets) throw new Error(`${at}: ${w.droplets.length} droplets`)
    if (!(w.session.coins >= 0 && w.session.coins < contract.COINS_PER_LIFE)) throw new Error(`${at}: ${w.session.coins} coins`)
    if (w.stats.carsWashed > w.stats.carsTotal) throw new Error(`${at}: ${w.stats.carsWashed} cars washed of ${w.stats.carsTotal}`)
    if (w.timeLeft < 0) throw new Error(`${at}: timeLeft ${w.timeLeft}`)
    for (const e of w.entities) {
      if (e.dead) throw new Error(`${at}: a dead ${e.kind} is still in the list`)
      if (e.kind === 'car' && e.active) {
        const hit = insideSolid(w, e)
        if (hit) throw new Error(`${at}: ${e.variant} car at (${round(e.x)}, ${round(e.y)}) is inside solid tile ${hit}`)
      }
    }
    if (w.status !== 'play' && w.statusT >= 30) {
      out.ends[w.status] = (out.ends[w.status] ?? 0) + 1
      w = createWorld(level, { session: w.session, checkpoint: w.checkpoint ?? checkpoint, flags: w.flags, tokens: w.stats.tokens, seed: seed + out.attempts })
      out.attempts++
      airJumps = 0
      hoverUsed = 0
    }
  }
  return out
}

test('review, fuzz: 20,000 ticks of random stick and buttons on the sandbox, every invariant every tick, twice the same', () => {
  // Without the critter corner, so the airtime checks only meet the core kinds.
  const level = sandboxWithoutCritters()
  const a = longFuzz(level, 20261118, 20000)
  const b = longFuzz(level, 20261118, 20000)
  eq(a.hashes.length, 20000, 'ticks played')
  for (let i = 0; i < a.hashes.length; i++) if (a.hashes[i] !== b.hashes[i]) throw new Error(`the two runs differ at tick ${i + 1}`)
  ok(a.attempts >= 3, `only ${a.attempts} attempts in 20,000 ticks`)
  eq(a.maxJumps, 1, 'most jumps in one airtime')
  // More ground: the same from the middle and the far end of the level, and from the bonus room.
  let more = 0
  const starts = [{ areaId: 'main', x: 150 * TILE + 16, y: 10 * TILE }, { areaId: 'main', x: 232 * TILE + 16, y: 10 * TILE }, { areaId: 'main', x: 310 * TILE + 16, y: 10 * TILE }, { areaId: 'bonus', x: 10 * TILE, y: 20 * TILE }]
  const areas = new Set(a.areas)
  starts.forEach((checkpoint, i) => {
    const run = longFuzz(level, 77 + i, 5000, checkpoint)
    more += run.hashes.length
    for (const id of run.areas) areas.add(id)
  })
  notes.push(`review fuzz: 20000 ticks twice over (identical), ${a.attempts} attempts ${JSON.stringify(a.ends)}, reached column ${Math.round(a.furthest / TILE)}, most hover in one airtime ${a.maxHover} ticks; plus ${more} ticks from ${starts.length} other starts; areas ${[...areas].join('+')}; final hash ${a.hashes[a.hashes.length - 1]}`)
  // The whole sandbox, critters and all (whatever is registered), for the invariants that do not depend on them.
  const full = createWorld(levels.sandboxLevel, { session: freshSession(), seed: 5, checkpoint: { areaId: 'main', x: 340 * TILE, y: 10 * TILE } })
  const input = makeInput()
  for (const [held, count, extra] of busyScript(5, 200)) {
    for (let k = 0; k < count; k++) {
      stepWorld(full, input(held, extra))
      full.events.length = 0
      const bad = badNumber(full)
      ok(!bad, `critter corner: ${bad}`)
    }
  }
})

// A 'full' block shuttling on a rail: the thing most likely to press him into the scenery.
sim.registerEntity('testpiston', {
  alwaysActive: true,
  init(e) {
    sim.setBox(e, 32, 32)
    e.solid = 'full'
    e.gravity = 0
    e.collides = false
  },
  update(e) {
    sim.shuttle(e, sim.propNum(e, 'dx', 0) * TILE, sim.propNum(e, 'dy', 0) * TILE, 70, 20)
  },
})

/** A level nobody would design: ragged ground of every floor tile, blocks, catwalks and low ceilings at random, lifts and pistons. */
function randomTerrain(seed) {
  let s = seed >>> 0
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  const W = 70
  const H = 18
  const g = []
  for (let y = 0; y < H; y++) g.push(Array(W).fill(' '))
  let ground = 14
  for (let x = 0; x < W; x++) {
    if (x > 4 && r() < 0.3) ground += r() < 0.5 ? -1 : 1
    ground = Math.max(9, Math.min(16, ground))
    const pit = x > 5 && r() < 0.08
    const floor = '######%%<>IOMXg'[Math.floor(r() * 15)]
    for (let y = ground; y < H; y++) g[y][x] = pit ? (y > ground + 1 ? '~' : ' ') : y === ground ? floor : '#'
    if (pit && r() < 0.5) for (let y = ground; y < H; y++) g[y][x] = ' '
    for (let y = 2; y < ground - 1; y++) {
      const q = r()
      if (q < 0.035) g[y][x] = 'BC?!WLHhUXg='[Math.floor(r() * 12)]
      else if (q < 0.06) g[y][x] = '='
      else if (q < 0.07) g[y][x] = '^'
    }
    if (r() < 0.06 && ground - 3 > 1) g[ground - 3][x] = 'X'
    if (r() < 0.04 && ground - 2 > 1) g[ground - 2][x] = 'X'
  }
  for (let i = 0; i < 16; i++) {
    const x = 6 + Math.floor(r() * (W - 10))
    const y = 3 + Math.floor(r() * 9)
    if (g[y][x] === ' ') g[y][x] = '12345ycsy'[Math.floor(r() * 9)]
  }
  // A clear start on solid ground.
  for (let y = 0; y < 14; y++) for (let x = 0; x < 5; x++) g[y][x] = ' '
  for (let y = 14; y < H; y++) for (let x = 0; x < 5; x++) g[y][x] = '#'
  g[13][2] = '@'
  const legend = {
    1: { kind: 'lift', props: { dx: 3, speed: 80, wait: 10 } },
    2: { kind: 'lift', props: { dy: -4, speed: 90, wait: 10 } },
    3: { kind: 'testpiston', props: { dx: 3 } },
    4: { kind: 'testpiston', props: { dy: 3 } },
    5: { kind: 'lift', props: { dy: 5, speed: 140, wait: 5, w: 2 } },
  }
  return makeLevel(g.map((row) => row.join('')), { legend, time: 9999 })
}

test('review, fuzz: random terrain with lifts and pistons never traps him in a tile or loses him', () => {
  let ticks = 0
  let ends = 0
  for (let seed = 40; seed < 70; seed++) {
    const level = randomTerrain(seed)
    let s = (seed * 7919) >>> 0
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
    let w = createWorld(level, { session: freshSession(), seed })
    const input = makeInput()
    let held = []
    let extra
    let holdFor = 0
    for (let t = 1; t <= 2500; t++) {
      if (holdFor-- <= 0) {
        held = []
        const q = r()
        if (q < 0.6) held.push('right')
        else if (q < 0.85) held.push('left')
        if (r() < 0.45) held.push('jump')
        if (r() < 0.4) held.push('spray')
        if (r() < 0.15) held.push('down')
        if (r() < 0.1) held.push('up')
        extra = r() < 0.25 ? { axisX: r() * 2 - 1, axisY: r() < 0.5 ? r() * 2 - 1 : 0 } : undefined
        holdFor = Math.floor(r() * 25)
      }
      const p = w.player
      const where = `terrain ${seed}, tick ${t}`
      stepChecked(w, input(held, extra), where)
      ticks++
      const bad = badNumber(w)
      ok(!bad, `${where}: ${bad}`)
      ok(p.x >= 0 && p.x + p.w <= w.grid.w * TILE, `${where}: Maxx is outside the area at x=${p.x}`)
      ok(w.status !== 'play' || p.y <= w.grid.h * TILE + 8, `${where}: Maxx fell out of the area and was not grimed`)
      if (w.status !== 'play' && w.statusT > 20) {
        ends++
        w = createWorld(level, { session: freshSession(), seed: seed + t })
        // Most retries start somewhere else on solid ground, so the whole map gets walked.
        const tx = 3 + Math.floor(r() * 60)
        for (let ty = 3; ty < w.grid.h; ty++) {
          if (sim.tileInfoAt(w, tx, ty).solid && !sim.tileInfoAt(w, tx, ty - 1).solid && !sim.tileInfoAt(w, tx, ty - 2).solid) {
            place(w, tx * TILE + 5, ty * TILE - MAXX_H)
            break
          }
        }
      }
    }
  }
  notes.push(`review fuzz, random terrain: 30 maps, ${ticks} ticks, ${ends} attempts ended`)
  ok(ends > 30, `only ${ends} attempts ended: the maps are not being explored`)
})

/* ------------------------------------------------------------------ */
/* Arithmetic that is the same in every engine                         */
/* ------------------------------------------------------------------ */

/** Engine-rounded Math functions (and **), which sim/** and levels/** must not call. */
const ENGINE_MATH = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|random)\b|\*\*/

test("mathx: sin and cos are Math's to 1e-12 from -1e9 to 1e9 (fdlibm's own bits in its range), hypot is the square root; no sim or level file calls the engine's own", () => {
  const { sin, cos, hypot } = sim
  let s = 0x9e3779b9
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  const xs = [0, 1e-300, 5e-324, 1e-8, Math.PI, Math.PI / 4, 0.7853981633974483, 0.7853981633974484, 2.356194490192345, 823549, 823550, 1e6, 1e9]
  for (let n = 1; n <= 300; n++) xs.push((n * Math.PI) / 2, (n * Math.PI) / 2 + 1e-12 * n, (n * Math.PI) / 4)
  for (let i = 0; i < 100000; i++) xs.push(10 ** (next() * 18 - 9))
  // What the game feeds them: a droplet's angle, a bubble's bob and a grackle's wave over an hour of ticks.
  for (let t = 0; t < 216000; t += 7) xs.push(t * 0.09, (t * 2 * Math.PI) / 96, ((next() * 2 - 1) * 4 * Math.PI) / 180)
  let medium = 0
  let same = 0
  for (const v of xs) {
    for (const x of [v, -v]) {
      const a = sin(x)
      const c = cos(x)
      if (!(Math.abs(a - Math.sin(x)) <= 1e-12 && Math.abs(c - Math.cos(x)) <= 1e-12)) throw new Error(`sin, cos of ${x}: ${a}, ${c}; Math says ${Math.sin(x)}, ${Math.cos(x)}`)
      if (Math.abs(x) < 823549) {
        medium++
        if (Object.is(a, Math.sin(x)) && Object.is(c, Math.cos(x))) same++
      }
    }
  }
  ok(Object.is(sin(-0), -0) && Object.is(sin(0), 0) && cos(0) === 1, 'sin and cos at zero')
  ok(Number.isNaN(sin(NaN)) && Number.isNaN(cos(Infinity)) && Number.isNaN(sin(-Infinity)), 'sin and cos of NaN and infinity')
  eq(hypot(3, 4), 5, 'hypot(3, 4)')
  eq(hypot(-1e-3, 0), 1e-3, 'hypot(-0.001, 0)')
  notes.push(`mathx: ${xs.length * 2} arguments within 1e-12 of Math.sin and Math.cos; ${same} of ${medium} in fdlibm's range bit for bit what this Node gives`)

  const files = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(file)
      else if (ent.name.endsWith('.ts')) files.push(file)
    }
  }
  walk(path.join(GAME_DIR, 'game', 'sim'))
  walk(path.join(GAME_DIR, 'game', 'levels'))
  ok(files.length >= 25, `only ${files.length} sim and level files found`)
  // Comments may name them (keeping their lines, so a finding says where it is).
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/\/\/.*$/gm, '')
  ok(ENGINE_MATH.test(code('const a = Math.sin(t)')) && ENGINE_MATH.test(code('x ** 2')) && ENGINE_MATH.test(code('Math.hypot(a, b)')), 'the scan misses a call')
  ok(!ENGINE_MATH.test(code('/** sin, not Math.sin */ const a = sin(t) // not Math.cos')), 'the scan sees a comment')
  const found = []
  for (const file of files) {
    code(fs.readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((l, i) => {
        if (ENGINE_MATH.test(l)) found.push(`${path.relative(REPO, file)}:${i + 1}: ${l.trim()}`)
      })
  }
  eq(found.join('\n'), '', "engine-rounded Math in the simulation or the levels (use sim/mathx.ts)")
})

/* ------------------------------------------------------------------ */
/* The washed Mudslinger, and what the level tools get                 */
/* ------------------------------------------------------------------ */

const truckSim = await loadModule('sim/entities/mudslinger.ts')
const truckAtlas = (await loadModule('assets/mudslinger.atlas.ts')).atlas

test("Mudslinger washed: TRUCK_TOP is the parked truck as drawn, and Maxx stands on it there, bed, cab, light bar and hood, whichever way it faces", () => {
  const png = Canvas.load(path.join(ASSETS_DIR, 'mudslinger.png'))
  const box = truckAtlas.meta.box
  const cols = truckSim.truckTop()
  eq(cols.length, box.w, 'columns in TRUCK_TOP')
  // Each frame's first solid pixel per box column at or below `from` (box y), as drawn parked: anchored at the middle of the box's bottom.
  const outline = (name, from = -Infinity) => {
    const f = truckAtlas.frames[name]
    const top = new Array(box.w).fill(Infinity)
    for (let i = 0; i < f.w; i++) {
      const bx = i - f.ax + box.w / 2
      if (bx < 0 || bx >= box.w) continue
      for (let r = 0; r < f.h; r++) {
        const by = r - f.ay + box.h
        if (by >= from && png.solid(f.x + i, f.y + r)) {
          top[bx] = by
          break
        }
      }
    }
    return top
  }
  // Parked it shows the clean body, the bed down, the light bar dark and a face; the blink is the
  // face without the eyebrows, so its outline is the eyes.
  const want = new Array(box.w).fill(Infinity)
  for (const name of ['body0', 'bed0_0', 'bar0', 'face_blink']) outline(name).forEach((v, i) => (want[i] = Math.min(want[i], v)))
  eq(cols.join(' '), want.map((v) => Math.max(0, v)).join(' '), 'TRUCK_TOP against the art (the stack held to the box top)')
  // Every face it parks with has those eyes, under eyebrows that float clear of them.
  const eyes = outline('face_blink').join(' ')
  for (const name of ['face_happy', 'face_happy_b']) eq(outline(name, 12).join(' '), eyes, `${name}: the eyes under its eyebrows`)

  for (const dir of [-1, 1]) {
    const w = flat([`  @${' '.repeat(13)}M`], { legend: { M: { kind: 'mudslinger', props: dir > 0 ? { dir: 1 } : {} } } })
    const truck = find(w, 'mudslinger')
    // Washed a moment ago: one tick and it parks.
    truck.hp = 0
    truck.harmful = false
    truck.state = 'clean'
    truck.stateT = 149
    truck.vars.dur = 150
    stepWorld(w, makeInput()([]))
    eq(truck.state, 'happy', 'parked')
    eq(truck.facing, dir, 'facing')
    const line = dir > 0 ? cols.slice().reverse() : cols
    const p = w.player
    // Dropped from above with the middle of his feet over box column bx as the art faces left.
    const dropAt = (bx) => {
      const mid = truck.x + (dir > 0 ? box.w - bx : bx)
      p.x = mid - p.w / 2
      p.y = truck.y - 40 - p.h
      p.vx = 0
      p.vy = 0
      p.onGround = false
      const n = until(w, [], (x) => x.player.onGround, 120)
      ok(n > 0, `never landed over column ${bx}`)
      return feet(w) - truck.y
    }
    for (let bx = -14; bx <= box.w + 14; bx += 2) {
      const mid = truck.x + (dir > 0 ? box.w - bx : bx)
      const c0 = Math.max(0, Math.floor(mid - p.w / 2 + 4 - truck.x))
      const c1 = Math.min(box.w - 1, Math.ceil(mid + p.w / 2 - 4 - truck.x) - 1)
      let high = Infinity
      for (let c = c0; c <= c1; c++) high = Math.min(high, line[c])
      const got = dropAt(bx)
      if (high === Infinity) eq(got, truck.h, `beside it (column ${bx}): on the floor`)
      else {
        eq(got, high, `over column ${bx} (facing ${dir})`)
        eq(p.ridingId, truck.id, `over column ${bx}: standing on the truck`)
      }
    }
    eq(dropAt(112), 23, 'on the bed, its rim 23 px under the box top')
    eq(dropAt(66), 0, 'on the light bar')
    eq(dropAt(21), 14, 'on its eyes')
  }
})

test('for the level tools: tileFeetX, tileFeetY, parseTarget, findMarker, and buildArea builds any area as entering it would, without going there', () => {
  eq(sim.tileFeetX(3), 3 * TILE + TILE / 2, 'tileFeetX')
  eq(sim.tileFeetY(5), 6 * TILE, 'tileFeetY')
  eq(JSON.stringify(sim.parseTarget('bonus:out', 'main')), '{"area":"bonus","marker":"out"}', 'parseTarget with an area')
  eq(JSON.stringify(sim.parseTarget('out', 'main')), '{"area":"main","marker":"out"}', 'parseTarget without one')
  const level = levels.sandboxLevel
  const ids = Object.keys(createWorld(level, { session: freshSession() }).areas)
  ok(ids.length >= 2, 'the sandbox has more than one area')
  const built = createWorld(level, { session: freshSession() })
  const first = built.area.id
  for (const id of ids) {
    const list = sim.buildArea(built, id)
    ok(list === built.areas[id].entities, `${id}: buildArea returns the area's own list`)
    ok(sim.buildArea(built, id) === list, `${id}: built once and kept`)
  }
  eq(built.area.id, first, 'still in the first area')
  ok(built.entities === built.areas[first].entities && built.grid === built.areas[first].grid, 'the current area is untouched')
  const shape = (list) => list.map((e) => `${e.kind}:${e.variant}:${e.slot}:${e.x},${e.y},${e.w}x${e.h}`).join(' ')
  const walked = createWorld(level, { session: freshSession() })
  for (const id of ids) {
    sim.enterArea(walked, id)
    eq(shape(walked.entities), shape(built.areas[id].entities), `${id}: the same entities as going there`)
  }
  // Every warp in the sandbox names an arrival point findMarker finds.
  let warps = 0
  for (const id of ids) {
    for (const e of built.areas[id].entities) {
      if (typeof e.props.to !== 'string') continue
      const target = sim.parseTarget(e.props.to, id)
      const sp = sim.findMarker(built.areas[target.area], target.marker)
      ok(sp, `${id}: ${e.kind} to '${e.props.to}' arrives nowhere`)
      warps++
    }
  }
  ok(warps >= 1, 'no warps in the sandbox')
})

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

await close()

const line = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`)
console.log('\nMeasured (pixels, tiles of 32 px, ticks of 1/60 s)')
line('tap jump apex', `${round(m.tap.apex)} px = ${tiles(m.tap.apex)} tiles  (${m.tap.air} ticks in the air)`)
line('full jump apex', `${round(m.full.apex)} px = ${tiles(m.full.apex)} tiles  (${m.full.air} ticks in the air)`)
line('running jump apex', `${round(m.runFull.apex)} px = ${tiles(m.runFull.apex)} tiles`)
line('running jump length (full)', `${round(m.runFull.length)} px = ${tiles(m.runFull.length)} tiles  (${m.runFull.air} ticks)`)
line('running jump length (tap)', `${round(m.runTap.length)} px = ${tiles(m.runTap.length)} tiles`)
line('standing jump length', `${round(m.standing)} px = ${tiles(m.standing)} tiles`)
line('running jump with hover', `${round(m.hover.length)} px = ${tiles(m.hover.length)} tiles`)
line('hover gain', `${round(m.hover.length - m.runFull.length)} px = ${tiles(m.hover.length - m.runFull.length)} tiles  (${m.hover.hoverTicks} ticks of hover)`)
if (hoverBest.run1) {
  const k0 = HOVER_LEVELS.indexOf(0)
  const late = hoverBest.run1
  line('running jump, hover begun late', `${round(late.best[k0])} px = ${tiles(late.best[k0])} tiles  (the most any hover gives: held from ${late.startAt[k0]} ticks after take-off)`)
}
line('running jump length from mud', `${round(m.mudRun.length)} px = ${tiles(m.mudRun.length)} tiles  (apex ${tiles(m.mudRun.apex)} tiles)`)
line('ticks to top speed', `${m.toTop}  (${TUNING.runSpeed} px/s)`)
line('stopping distance', `${round(m.stop.dist)} px in ${m.stop.ticks} ticks`)
line('skid (full reverse) distance', `${round(m.skid.dist)} px in ${m.skid.ticks} ticks`)
line('stopping distance on slick / oil', `${round(m.stopSlick.dist)} px / ${round(m.stopOil.dist)} px`)
line('jump apex in mud', `${round(m.mud.apex)} px = ${tiles(m.mud.apex)} tiles`)
line('prep gun reach from the nozzle', `${round(m.reach)} px = ${tiles(m.reach)} tiles  (the nozzle is ${contract.MUZZLE.fwd.x} px ahead of his middle)`)
for (const note of notes) console.log(`  ${note}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.name}`)
  process.exit(1)
}
