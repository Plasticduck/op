// Tests of the cars slice (sim/entities/cars.ts): what the renderer is promised in the header of
// that file (states, vars, timing), the pickup's readable throw, the sports car's rev, washed cars,
// the spawner, and the dev room 'dev-cars'. The core suite (sim.mjs) covers sizes, speeds, dirt,
// washing, riding, queueing, clods and the spawner's counting; this does not repeat it.
//
//   node scripts/maxx/tests/cars.mjs [--only text]
import path from 'node:path'
import { suite } from '../lib/testkit.mjs'
import { ASSETS_DIR } from '../paths.mjs'
import { Canvas } from '../pix.mjs'

const t = await suite('cars')
const { sim, levels, contract } = t
const { TUNING } = sim
const { TILE, MAXX_H } = contract

// The car file's own exports, the renderer and its atlas: the very instances the simulation uses.
const { CAR_FX, CAR_TOPS, carTop } = await t.loadModule('sim/entities/cars.ts')
const render = await t.loadModule('render/entities/cars.ts')
const registry = await t.loadModule('render/registry.ts')
const { atlas } = await t.loadModule('assets/cars.atlas.ts')

const carBehavior = sim.getBehavior('car')
const sfx = (events, id) => events.some((e) => e.type === 'sfx' && e.id === id)
const stageOf = (car) => (car.state === 'clean' ? 0 : Math.ceil((3 * car.hp) / car.maxHp))
/** A world with Maxx at rest and the cars awake. */
function room(rows, opts) {
  const w = t.flat(rows, opts)
  t.steps(w, [], 2)
  return w
}
const washNow = (w, car) => t.spray(w, car, 999)

t.test('every variant is an even number of pixels wide, so the art mirrors exactly about its middle', () => {
  for (const [variant, spec] of Object.entries(TUNING.cars)) t.ok(spec.w % 2 === 0, `${variant} is ${spec.w} wide`)
})

t.test('spray startles a car, wets it, and a stage of dirt coming off is marked (vars startle, wet, shed)', () => {
  const w = room(['  @             c'])
  const car = t.find(w, 'car')
  t.eq(car.vars.startle, 0, 'calm before the water')
  t.eq(car.vars.wet, 0, 'dry before the water')
  t.spray(w, car)
  t.ok(car.vars.startle > 0, 'not startled by a droplet')
  t.ok(car.vars.wet > car.vars.startle, 'water runs off for longer than the fright lasts')
  const startle = car.vars.startle
  const wet = car.vars.wet
  t.steps(w, [], 3)
  t.eq(car.vars.startle, startle - 3, 'startle counts down a tick at a time')
  t.eq(car.vars.wet, wet - 3, 'wet counts down a tick at a time')
  t.steps(w, [], startle)
  t.eq(car.vars.startle, 0, 'the fright wears off')
  t.ok(car.vars.wet > 0, 'still dripping after the fright')
  t.steps(w, [], wet)
  t.eq(car.vars.wet, 0, 'dry again')

  // Stages go 3, 2, 1, 0 as the dirt comes off, and each drop of a stage sets shed and throws the variant's own dirt.
  const fresh = room(['  @             c'])
  const c2 = t.find(fresh, 'car')
  const seen = [stageOf(c2)]
  let sheds = 0
  for (let i = 0; i < c2.maxHp; i++) {
    fresh.events.length = 0
    const before = stageOf(c2)
    t.spray(fresh, c2)
    const after = stageOf(c2)
    if (after !== seen[seen.length - 1]) seen.push(after)
    if (after < before && after > 0) {
      t.ok(c2.vars.shed > 0, `no shed when stage ${before} went to ${after}`)
      t.ok(fresh.events.some((e) => e.type === 'fx' && e.fx === 'dust'), 'the compact sheds dust')
      t.ok(sfx(fresh.events, 'pop'), `no 'pop' when stage ${before} let go`)
      sheds++
    } else if (after === before) {
      t.ok(!sfx(fresh.events, 'pop'), 'a pop without a stage letting go')
    }
  }
  t.eq(seen.join(','), '3,2,1,0', 'dirt stages in order')
  t.eq(sheds, 2, 'stages that let go before the wash')
})

t.test('a steady stream soaks a car: only the first drop after a dry spell startles it', () => {
  const w = room(['  @                   1'], { legend: { 1: { kind: 'car', variant: 'van', props: { dirt: 999, speed: 0 } } } })
  const car = t.find(w, 'car')
  t.spray(w, car)
  t.eq(car.vars.startle, CAR_FX.startleTicks, 'the first drop startles it')
  // One drop every 2 ticks, as the prep gun fires: the fright runs out and is not set again.
  let restarted = 0
  for (let i = 0; i < 60; i++) {
    const before = car.vars.startle
    t.steps(w, [], 2)
    t.spray(w, car)
    if (car.vars.startle > before) restarted++
  }
  t.eq(restarted, 0, 'a drop in a steady stream startled it again')
  t.eq(car.vars.startle, 0, 'still startled after 120 ticks of steady spray')
  t.eq(car.vars.wet, CAR_FX.wetTicks, 'wet is topped up by every drop')
  // A pause shorter than calmTicks: still soaking. Longer: the next drop is a fresh fright.
  t.steps(w, [], CAR_FX.calmTicks - 4)
  t.spray(w, car)
  t.eq(car.vars.startle, 0, `startled after only ${CAR_FX.calmTicks - 4} dry ticks`)
  t.steps(w, [], CAR_FX.calmTicks)
  t.spray(w, car)
  t.eq(car.vars.startle, CAR_FX.startleTicks, `not startled after ${CAR_FX.calmTicks} dry ticks`)
})

t.test('washing: flash and bounce clock from 0, a honk at honkDelay, faster, ground on top', () => {
  const w = room(['  @                c'])
  const car = t.find(w, 'car')
  const events = []
  washNow(w, car)
  t.eq(car.state, 'clean', 'state')
  t.eq(car.stateT, 0, 'the wash clock starts at 0 on the wash tick')
  t.eq(car.vars.startle, 0, 'no fright once clean')
  t.ok(car.vars.wet > 0, 'it drips after the wash')
  let honkAt = -1
  for (let i = 1; i <= 60; i++) {
    const seen = t.steps(w, [], 1)
    for (const e of seen) events.push(e)
    if (honkAt < 0 && sfx(seen, 'honk')) honkAt = car.stateT
  }
  t.eq(honkAt, TUNING.honkDelay, 'the honk sounds at stateT = honkDelay')
  t.eq(events.filter((e) => e.type === 'sfx' && e.id === 'honk').length, 1, 'one honk')
  t.near(car.vx, -TUNING.cars.compact.speed * TUNING.cleanSpeedUp, 0.01, 'drives off faster')
  // Water goes straight past a clean car.
  t.eq(t.spray(w, car), false, 'a clean car does not stop water')
})

t.test('Maxx landing on a washed roof: the car looks up (greet) and, long after its wash, honks hello', () => {
  const w = room(['  @           c'])
  const car = t.find(w, 'car')
  washNow(w, car)
  t.steps(w, [], 80)
  t.place(w, car.x + car.w / 2, car.y - 30)
  const events = []
  const n = t.until(w, [], (w) => w.player.ridingId === car.id, 60, undefined, events)
  t.ok(n > 0, 'never landed on the roof')
  // The car updates before Maxx moves, so it sees him on its roof the tick after he lands.
  for (const e of t.steps(w, [], 1)) events.push(e)
  t.ok(car.vars.greet > 0, 'no greet')
  t.ok(sfx(events, 'honk'), 'no hello honk')
  // Only the first landing.
  t.steps(w, [], 45)
  t.eq(car.vars.greet, 0, 'greet wears off')
  w.player.vy = -300
  w.player.onGround = false
  const again = []
  t.until(w, [], (w) => w.player.ridingId === car.id && w.player.onGround, 90, undefined, again)
  t.ok(!sfx(again, 'honk'), 'honked again on a second landing')
})

t.test('the pickup telegraphs: it brakes and winds up for windupTicks, the clod leaves on the last tick from over its bed', () => {
  const w = room(['  @           p'])
  const car = t.find(w, 'car')
  const events = []
  t.until(w, [], (w) => car.state === 'windup', 300, undefined, events)
  t.eq(car.state, 'windup', 'never wound up')
  t.ok(!t.find(w, 'clod'), 'a clod left before the wind-up')
  let ticks = 0
  let clod = null
  while (!clod && ticks < 200) {
    const x = car.x
    t.steps(w, [], 1)
    ticks++
    if (car.state === 'windup' || (car.state === 'fling' && car.stateT === 0)) t.eq(car.x, x, `the pickup moved during the wind-up, tick ${ticks}`)
    clod = t.find(w, 'clod')
  }
  t.ok(clod, 'no clod')
  t.eq(car.state, 'fling', 'state as the clod leaves')
  t.ok(ticks >= 20 && ticks <= 40, `the wind-up took ${ticks} ticks: too short to read or too long`)
  // From over the bed: behind the middle of the box, above the roof.
  const mid = car.x + car.w / 2
  t.ok(clod.x + clod.w / 2 > mid + 10, 'the clod did not leave from over the bed (behind the cab)')
  t.ok(clod.y + clod.h <= car.y, 'the clod left from inside the body')
  t.ok(clod.vx < 0 && clod.vy < 0, 'thrown up and ahead')
  // It stands a moment longer, then drives on, and the next throw comes about clodEvery after the last.
  t.until(w, [], () => car.state === 'drive', 60)
  t.eq(car.state, 'drive', 'back to driving')
  t.steps(w, [], 1)
  t.ok(Math.abs(car.vx) > 0, 'moving again')
  w.player.invuln = 9999
  const next = t.until(w, [], () => car.state === 'windup', 400)
  t.ok(next > 0, 'no second wind-up')
  t.ok(next + 12 >= TUNING.clodEvery - 40, `the second throw came too soon (${next} ticks)`)
})

t.test('a pickup can be washed without a scratch by a player who aims up at its clods (and standing still costs a pip)', () => {
  for (const gap of [10, 16]) {
    const play = (aimUp) => {
      const w = t.flat(['  @' + ' '.repeat(gap) + 'p'])
      const input = t.makeInput()
      const car = t.find(w, 'car')
      let hits = 0
      let throws = 0
      let last = 3
      const seen = new Set()
      for (let i = 0; i < 1200 && car.state !== 'clean' && w.status === 'play'; i++) {
        const clod = t.find(w, 'clod')
        if (clod && !seen.has(clod.id)) seen.add(clod.id) && throws++
        const near = car.x - (w.player.x + w.player.w) < 160
        sim.stepWorld(w, input(aimUp && clod ? ['up', 'spray'] : near ? ['spray'] : []))
        w.events.length = 0
        if (w.player.pips < last) hits++
        last = w.player.pips
      }
      return { washed: car.state === 'clean', hits, throws }
    }
    const good = play(true)
    t.ok(good.washed && good.throws >= 1, `gap ${gap}: ${JSON.stringify(good)}`)
    t.eq(good.hits, 0, `gap ${gap}: hits taken while aiming up at the clods`)
    t.ok(play(false).hits >= 1, `gap ${gap}: the clods never hit a player who ignored them`)
  }
})

t.test('a pickup out of range, or with Maxx behind it, does not throw', () => {
  const far = room(['  @                                 p'])
  far.player.invuln = 9999
  const car = t.find(far, 'car')
  // Hold the truck still far off: it must not wind up while Maxx is more than clodRange away.
  let wound = false
  for (let i = 0; i < 200; i++) {
    car.x = car.spawnX
    t.steps(far, [], 1)
    if (Math.abs(far.player.x - car.x) > TUNING.clodRange + 60 && car.state === 'windup') wound = true
  }
  t.ok(!wound, 'wound up with Maxx out of range')
  const behind = room(['  p      @'])
  behind.player.invuln = 9999
  const b = t.find(behind, 'car')
  let thrown = false
  for (let i = 0; i < 300; i++) {
    t.steps(behind, [], 1)
    if (b.state === 'windup' && b.x + b.w / 2 > behind.player.x) thrown = true
  }
  t.ok(!thrown, 'wound up at Maxx behind it')
})

t.test("the sports car revs in place for revTicks ('rev' on its first tick), then goes at full speed", () => {
  const w = t.flat(['  @                 f'])
  const car = t.find(w, 'car')
  t.eq(car.state, 'rev', 'a sports car starts revving')
  const events = []
  let firstRev = -1
  let x0 = null
  for (let i = 0; i < TUNING.revTicks + 30; i++) {
    const seen = t.steps(w, [], 1)
    for (const e of seen) events.push(e)
    if (car.active && x0 === null) x0 = car.x
    if (firstRev < 0 && sfx(seen, 'rev')) firstRev = car.stateT
    if (car.state === 'rev') t.eq(car.x, x0 ?? car.x, `moved while revving, tick ${i}`)
  }
  t.eq(firstRev, 1, "'rev' on the first tick of the rev")
  t.eq(car.state, 'drive', 'driving after the rev')
  t.near(car.vx, -TUNING.cars.sports.speed, 0.01, 'full speed')
  t.ok(events.some((e) => e.type === 'fx' && e.fx === 'dust'), 'no dust as it sets off')
})

t.test('a car placed clean is a ride: harmless, ground, never counted, no points and no honk', () => {
  const legend = { 1: { kind: 'car', variant: 'van', props: { clean: true } } }
  const w = room(['  @          1     c'], { legend })
  t.eq(w.stats.carsTotal, 1, 'only the dirty car counts')
  const van = t.find(w, 'car', 'van')
  t.eq(van.state, 'clean', 'state')
  t.eq(van.harmful, false, 'harmful')
  t.eq(van.solid, 'top', 'solid')
  t.ok(van.stateT >= 100, 'it should look long washed: no bounce, no honk')
  const seen = t.steps(w, [], 60)
  t.ok(!sfx(seen, 'honk') && !sfx(seen, 'carClean'), 'a car placed clean honked or cleaned')
  t.eq(w.stats.score, 0, 'points for a car nobody washed')
})

t.test('props: speed 0 parks a car; dirt overrides the table; bonus cars score but do not count', () => {
  const legend = {
    1: { kind: 'car', variant: 'suv', props: { speed: 0 } },
    2: { kind: 'car', variant: 'sedan', props: { dirt: 3, bonus: true } },
  }
  const w = room(['  @        2         1'], { legend })
  t.eq(w.stats.carsTotal, 1, 'carsTotal leaves the bonus car out')
  const suv = t.find(w, 'car', 'suv')
  const x = suv.x
  t.steps(w, [], 60)
  t.eq(suv.x, x, 'a parked car moved')
  const sedan = t.find(w, 'car', 'sedan')
  t.eq(sedan.maxHp, 3, 'dirt prop')
  for (let i = 0; i < 3; i++) t.spray(w, sedan)
  t.eq(sedan.state, 'clean', 'three droplets wash a dirt-3 car')
  t.eq(w.stats.carsWashed, 0, 'a bonus car counted as washed')
  t.ok(w.stats.score >= 200, 'a bonus car still scores')
})

t.test('Mighty Wax washes a car on touch, any side, and it is credited once', () => {
  const w = room(['  @    s'])
  w.player.wax = 300
  const car = t.find(w, 'car')
  t.until(w, ['right'], () => car.state === 'clean', 200)
  t.eq(car.state, 'clean', 'state')
  t.eq(w.stats.carsWashed, 1, 'carsWashed')
  t.eq(w.player.pips, 3, 'pips')
})

t.test('a car that drives into sludge sinks', () => {
  const row = '#'.repeat(10) + '~~~~' + '#'.repeat(40)
  const w = t.makeWorld(['  @                  c', row, row])
  const events = []
  t.until(w, [], () => !t.find(w, 'car'), 900, undefined, events)
  t.ok(!t.find(w, 'car'), 'the car is still there')
  t.ok(sfx(events, 'splat'), 'no splat')
})

t.test('clods: knocked out of the air by water, burst on the ground, and taken away off screen', () => {
  const w = room(['  @'])
  const clod = sim.shoot(w, 'clod', 400, 200, -100, -50)
  t.eq(clod.z, 1, 'a clod is drawn in front')
  t.eq(clod.w, 12, 'clod size')
  t.until(w, [], () => clod.dead, 200)
  t.ok(clod.dead, 'never landed')
  const far = sim.shoot(w, 'clod', 2000, 100, 900, -10)
  t.until(w, [], () => far.dead || !w.entities.includes(far), 120)
  t.ok(far.dead || !w.entities.includes(far), 'a clod far off screen is kept')
})

t.test('spawner: waits while its spot is taken, and its cars carry who they are', () => {
  const legend = { 1: { kind: 'spawner', props: { variant: 'sedan', every: 20, max: 5, count: 3, delay: 10 } } }
  const w = t.flat(['  @                  1'], { legend })
  // Park a van on the spot before the first car is due: nothing may come out on top of it.
  const sp = t.find(w, 'spawner')
  const van = sim.spawn(w, 'car', sp.x, sp.y, { variant: 'van', props: { speed: 0, bonus: true } })
  w.player.invuln = 9999
  t.steps(w, [], 60)
  t.eq(t.all(w, 'car').filter((c) => c.vars.owner === sp.id).length, 0, 'a car was sent onto a parked van')
  van.dead = true
  t.steps(w, [], 1)
  t.until(w, [], () => t.all(w, 'car').some((c) => c.vars.owner === sp.id), 30)
  const mine = t.all(w, 'car').filter((c) => c.vars.owner === sp.id)
  t.eq(mine.length, 1, 'one car out once the spot was clear')
  t.eq(mine[0].vars.from, sp.slot, 'vars.from is the spawner slot')
  t.eq(mine[0].vars.n, 0, 'vars.n counts from 0')
  t.eq(mine[0].facing, sp.facing, 'it drives the way the spawner faces')
})

t.test("spawner: 'random' picks are the same on every run", () => {
  const legend = { 1: { kind: 'spawner', props: { variants: 'compact,sedan,suv,van', random: true, every: 30, max: 9, count: 6, delay: 1 } } }
  const picks = []
  for (let run = 0; run < 2; run++) {
    const w = room(['  @                  1'], { legend })
    w.player.invuln = 99999
    const seen = new Map()
    for (let i = 0; i < 400; i++) {
      t.steps(w, [], 1)
      // Each car is noted and cleared away at once, so the spot is always free.
      for (const c of t.all(w, 'car')) {
        if (!seen.has(c.vars.n)) seen.set(c.vars.n, c.variant)
        c.dead = true
      }
    }
    picks.push([...seen.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join(','))
  }
  t.eq(picks[0], picks[1], 'random picks differ between two runs')
  t.ok(picks[0].split(',').length === 6, `sent ${picks[0]}`)
})

t.test('spawner: odd props (max 0, blank and spaced lists, unknown names, every 0) still send every counted car', () => {
  const cases = [
    { props: { variant: 'sedan', max: 0, count: 3, every: 20, delay: 1 }, want: 'sedan,sedan,sedan' },
    { props: { variants: ' compact , ,van,', count: 4, every: 20, delay: 1 }, want: 'compact,van,compact,van' },
    { props: { variants: '', count: 2, every: 20, delay: 1 }, want: 'compact,compact' },
    { props: { variants: 'bus,suv', count: 2, every: 0, delay: 0 }, want: 'compact,suv' },
  ]
  for (const c of cases) {
    const w = t.flat(['  @                  1'], { legend: { 1: { kind: 'spawner', props: c.props } } })
    w.player.invuln = 99999
    t.eq(w.stats.carsTotal, c.props.count, `carsTotal for ${JSON.stringify(c.props)}`)
    const seen = new Map()
    for (let i = 0; i < 900 && seen.size < c.props.count; i++) {
      t.steps(w, [], 1)
      w.player.invuln = 99999
      for (const car of t.all(w, 'car')) {
        if (seen.has(car.vars.n)) continue
        seen.set(car.vars.n, car.variant)
        // Wash it at once, as a player keeping up would: a washed car never holds the spawner up.
        t.spray(w, car, 999)
      }
    }
    const got = [...seen.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join(',')
    t.eq(got, c.want, `cars sent for ${JSON.stringify(c.props)}`)
    t.eq(w.stats.carsWashed, c.props.count, `washed for ${JSON.stringify(c.props)}`)
    t.ok(sim.isSpotless(w), `not SPOTLESS with ${JSON.stringify(c.props)}`)
  }
})

t.test('spawner: never puts a car on top of another, even when a queue backs up onto its spot', () => {
  // A belt runs at the spawner and a parked van blocks the road: the queue grows back to the spot.
  const legend = {
    1: { kind: 'spawner', props: { variants: 'compact,sedan,suv', every: 10, max: 9, count: 8, delay: 1 } },
    2: { kind: 'car', variant: 'van', props: { speed: 0, bonus: true } },
  }
  const belt = '#'.repeat(6) + '>'.repeat(20) + '#'.repeat(34)
  const w = t.makeWorld(['  @    2                     1', belt, '#'.repeat(60)], { legend })
  w.player.invuln = 99999
  let worst = 0
  for (let i = 0; i < 1500; i++) {
    t.steps(w, [], 1)
    w.player.invuln = 99999
    const cars = t.all(w, 'car')
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) {
        const p = cars[a]
        const q = cars[b]
        if (p.y >= q.y + q.h || q.y >= p.y + p.h) continue
        worst = Math.max(worst, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x))
      }
    }
  }
  t.ok(worst <= 2, `two cars overlapped by ${worst.toFixed(1)} px`)
  const sent = t.all(w, 'car').filter((c) => c.vars.owner !== undefined).length
  t.ok(sent >= 2, `only ${sent} cars came out before the queue backed up`)
})

t.test('queueing under odd setups (fuzz): no car passes through another, none jitters in place, all stay in the room', () => {
  const variants = Object.keys(TUNING.cars)
  let rngState = 12345
  const rnd = () => ((rngState = (Math.imul(rngState, 1103515245) + 12345) >>> 0) / 4294967296)
  const legend = {}
  // a..g: each variant driving left; A..G: driving right; 1..7: washed (a ride), either way.
  variants.forEach((v, i) => {
    legend[String.fromCharCode(97 + i)] = { kind: 'car', variant: v }
    legend[String.fromCharCode(65 + i)] = { kind: 'car', variant: v, props: { dir: 1 } }
    legend[String(i + 1)] = { kind: 'car', variant: v, props: { clean: true, dir: i % 2 ? 1 : -1 } }
  })
  let flips = 0
  let worstOverlap = 0
  let worstFlips = 0
  for (let room = 0; room < 40; room++) {
    const width = 22
    const row = Array.from({ length: width }, () => ' ')
    row[0] = 'X'
    row[width - 1] = 'X'
    // Maxx, out of harm's way (he cannot be hurt here), in a corner.
    row[1] = '@'
    const placed = []
    let x = 4
    while (x < width - 3) {
      const k = Math.floor(rnd() * variants.length)
      const span = Math.ceil(TUNING.cars[variants[k]].w / TILE) + 1
      if (x + span > width - 1) break
      const kind = rnd()
      row[x + Math.floor(span / 2)] = kind < 0.4 ? String.fromCharCode(97 + k) : kind < 0.8 ? String.fromCharCode(65 + k) : String(k + 1)
      placed.push(k)
      x += span + Math.floor(rnd() * 3)
    }
    const floor = Array.from({ length: width }, (_, i) => (i > 2 && i < width - 2 && rnd() < 0.5 ? (rnd() < 0.5 ? '<' : '>') : '#'))
    const wall = 'X' + ' '.repeat(width - 2) + 'X'
    const rows = [wall, wall, row.join(''), floor.join(''), '#'.repeat(width)]
    const w = t.makeWorld(rows, { legend })
    w.player.invuln = 99999
    const cars = t.all(w, 'car')
    const last = new Map(cars.map((c) => [c.id, { facing: c.facing, flips: [] }]))
    for (let i = 0; i < 900; i++) {
      t.steps(w, [], 1)
      w.player.invuln = 99999
      const live = t.all(w, 'car')
      t.eq(live.length, cars.length, `room ${room}: a car left the room by tick ${i} (${rows.join('|')})`)
      for (const c of live) {
        t.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `room ${room}: a car's position went bad`)
        t.ok(c.x >= TILE - 0.5 && c.x + c.w <= (width - 1) * TILE + 0.5, `room ${room}: a ${c.variant} is inside a wall at tick ${i} (x ${c.x.toFixed(1)}) (${rows.join('|')})`)
        const rec = last.get(c.id)
        if (rec.facing !== c.facing) {
          rec.facing = c.facing
          rec.flips.push(i)
          flips++
        }
        while (rec.flips.length && rec.flips[0] < i - 60) rec.flips.shift()
        worstFlips = Math.max(worstFlips, rec.flips.length)
      }
      if (i < 30) continue
      for (let a = 0; a < live.length; a++) {
        for (let b = a + 1; b < live.length; b++) {
          const p = live[a]
          const q = live[b]
          if (p.y >= q.y + q.h || q.y >= p.y + p.h) continue
          worstOverlap = Math.max(worstOverlap, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x))
        }
      }
    }
  }
  t.notes.push(`queue fuzz: 40 rooms, ${flips} turns, worst overlap ${worstOverlap.toFixed(1)} px, most turns by one car in a second ${worstFlips}`)
  t.ok(worstOverlap <= 3, `two cars overlapped by ${worstOverlap.toFixed(1)} px`)
  t.ok(worstFlips <= 8, `a car turned ${worstFlips} times in one second: it is jittering in place`)
})

/* ------------------------------------------------------------------ */
/* The dev room                                                        */
/* ------------------------------------------------------------------ */

const devCars = levels.levelById('dev-cars')

t.test('dev-cars: valid, every variant in it, the spawner and the ride counted right', () => {
  t.ok(devCars, 'no level dev-cars')
  const report = sim.validateLevel(devCars)
  t.eq(report.errors.length, 0, 'errors: ' + report.errors.join('; '))
  const w = sim.createWorld(devCars, { session: t.freshSession() })
  const variants = new Set()
  for (const area of Object.values(w.areas)) for (const s of area.spawns) if (s.spec.kind === 'car') variants.add(s.spec.variant)
  for (const v of Object.keys(TUNING.cars)) t.ok(variants.has(v), `no ${v} in the room`)
  const placed = Object.values(w.areas)
    .flatMap((a) => a.spawns)
    .filter((s) => s.spec.kind === 'car' && s.spec.props?.clean !== true).length
  t.eq(w.stats.carsTotal, placed + 4, 'carsTotal: the placed dirty cars and four from the spawner')
  if (report.warnings.length) t.notes.push('dev-cars warnings: ' + report.warnings.join('; '))
})

/** Run along the room washing whatever comes. Returns the held actions for this tick. */
function makeWasher() {
  let jumpHold = 0
  return function washer(w) {
    const p = w.player
    const right = p.x + p.w
    const feet = p.y + p.h
    if (jumpHold > 0) {
      jumpHold--
      return ['right', 'jump']
    }
    const car = w.entities.find((e) => e.kind === 'car' && e.state !== 'clean' && !e.dead && e.active && e.x + e.w > p.x - 40 && e.x - right < 200 && Math.abs(e.y + e.h - feet) < 80)
    if (car) {
      const behind = car.x + car.w / 2 < p.x
      return behind ? ['left', 'spray'] : p.facing < 0 ? ['right', 'spray'] : ['spray']
    }
    if (p.onGround && p.hitWall === 1) {
      jumpHold = 20
      return ['right', 'jump']
    }
    const tx = Math.floor((right + 4) / TILE)
    const ty = Math.floor((feet - 4) / TILE)
    if (p.onGround && sim.solidAt(w, (tx + 0.5) * TILE, (ty + 0.5) * TILE)) {
      jumpHold = 20
      return ['right', 'jump']
    }
    return ['right']
  }
}

t.test('dev-cars: each car alone can be washed before it reaches Maxx (a simple bot, sections 1 to 7)', () => {
  const w = sim.createWorld(devCars, { session: t.freshSession() })
  const bot = makeWasher()
  const input = t.makeInput()
  let hits = 0
  let lastPips = w.player.pips
  const stopX = 252 * TILE
  for (let i = 0; i < 60 * 120 && w.status === 'play' && w.player.x < stopX; i++) {
    sim.stepWorld(w, input(bot(w)))
    w.events.length = 0
    if (w.player.pips < lastPips) hits++
    lastPips = w.player.pips
    // Clods are the pickup's business: they are tested above; here they only make noise.
    if (w.player.invuln <= 0 && w.player.pips < 3) w.player.pips = 3
  }
  t.ok(w.player.x >= stopX, `the bot stopped at column ${Math.floor(w.player.x / TILE)}`)
  t.eq(w.stats.carsWashed, 7, 'cars washed in the seven solo stretches')
  t.notes.push(`dev-cars bot: seven solo cars washed by tick ${w.tick}, ${hits} hits taken`)
  t.ok(hits <= 2, `${hits} hits taken: a solo car should be washable without a scratch`)
})

t.test('dev-cars: deterministic (the whole room twice, hashed every tick)', () => {
  const run = () => {
    const w = sim.createWorld(devCars, { session: t.freshSession(), seed: 7 })
    const bot = makeWasher()
    const input = t.makeInput()
    const hashes = []
    for (let i = 0; i < 4000 && w.status === 'play'; i++) {
      sim.stepWorld(w, input(bot(w)))
      w.events.length = 0
      w.player.invuln = 999
      if (i % 50 === 0) hashes.push(sim.worldHash(w))
    }
    return hashes.join(',')
  }
  t.eq(run(), run(), 'two runs of the same input differ')
})

/* ------------------------------------------------------------------ */
/* The art and the renderer                                            */
/* ------------------------------------------------------------------ */

const meta = atlas.meta
const frames = atlas.frames

t.test('art: every body fills its box exactly (roof outline on the box top, full width, anchor at the middle of the ground line), grimy ones too', () => {
  for (const [v, spec] of Object.entries(TUNING.cars)) {
    const m = meta.variants[v]
    t.ok(m, `no meta for ${v}`)
    t.eq(m.w, spec.w, `${v} art width`)
    t.eq(m.h, spec.h, `${v} art height`)
    for (let k = 0; k < m.paints.length; k++) {
      for (const name of [`${v}_p${k}`, `${v}_dull${k}`]) {
        const f = frames[name]
        t.ok(f, `no frame ${name}`)
        t.eq(f.ay, spec.h, `${name}: the roof outline is not the top row of the box`)
        t.eq(f.w, spec.w, `${name}: the body is not the box's width`)
        t.eq(f.ax, spec.w / 2, `${name}: anchor not at the middle`)
      }
    }
  }
})

t.test('art: every variant has every face the renderer asks for, its dirt, wet, glint, flash, squash lines inside the box, and its wheels', () => {
  for (const [v, spec] of Object.entries(TUNING.cars)) {
    const m = meta.variants[v]
    for (const face of render.CAR_FACES) t.ok(frames[`${v}_${face}`], `no face ${v}_${face}`)
    for (const s of [1, 2, 3]) t.ok(frames[`${v}_d${s}`], `no dirt ${v}_d${s}`)
    for (let i = 0; i < m.wet; i++) t.ok(frames[`${v}_w${i}`], `no ${v}_w${i}`)
    for (let i = 0; i < m.glint; i++) t.ok(frames[`${v}_g${i}`], `no ${v}_g${i}`)
    t.ok(frames[`${v}_flash`], `no ${v}_flash`)
    t.ok(m.squash && Math.abs(m.squash.x) < spec.w / 2 - 8 && m.squash.y < -4 && m.squash.y > -spec.h + 4, `${v}: squash lines ${JSON.stringify(m.squash)} not well inside the box`)
    const spin = meta.wheels[String(m.wheel)]
    for (const kind of ['c', 'd']) for (let i = 0; i < spin.frames; i++) t.ok(frames[`wheel${m.wheel}${kind}${i}`], `no wheel${m.wheel}${kind}${i}`)
  }
  for (const a of ['clod', 'mark', 'twinkle', 'fly']) t.ok(atlas.anims[a]?.length >= 2, `no animation ${a}`)
})

/** A stand-in for Sprites over the real atlas, and a 2D context that writes down what is asked of it. */
function harness() {
  const log = { scales: [], translates: [], images: [], draws: [], sources: [], fx: 0 }
  const sources = new Map(Object.entries(frames).map(([n, f]) => [`cars/${n}`, { image: 'cars', frame: f }]))
  const anims = new Map(Object.entries(atlas.anims).map(([n, fs]) => [`cars/${n}`, fs.map((f) => `cars/${f}`)]))
  const sprites = {
    has: (n) => sources.has(n),
    frame: (n) => sources.get(n)?.frame ?? null,
    source: (n) => (log.sources.push(n), sources.get(n) ?? null),
    atlas: (n) => (n === 'cars' ? atlas : null),
    anim: (a, n) => anims.get(`${a}/${n}`) ?? [],
    draw() {},
  }
  const g = {
    save() {},
    restore() {},
    translate: (x, y) => log.translates.push([x, y]),
    scale: (x, y) => log.scales.push([x, y]),
    drawImage: (...a) => log.images.push(a),
    fillRect() {},
    fillStyle: '',
  }
  const rc = (w, tick) => ({
    sprites,
    world: w,
    camX: Math.round(w.camera.x),
    camY: Math.round(w.camera.y),
    tick,
    debug: false,
    draw: (name, x, y, opts) => log.draws.push({ name, x, y, flip: !!opts?.flipX }),
    sx: (x) => Math.round(x) - Math.round(w.camera.x),
    sy: (y) => Math.round(y) - Math.round(w.camera.y),
    fx: () => log.fx++,
  })
  const reset = () => {
    log.scales.length = log.translates.length = log.images.length = log.draws.length = log.sources.length = 0
  }
  return { g, rc, log, reset }
}

/** Washes one car of each variant with the real prep gun, calling `each(w, car, tick)` every tick from its approach to long after. */
function washLife(variant, each) {
  const letter = { compact: 'c', sedan: 's', suv: 'v', pickup: 'p', sports: 'f', van: 'n', monster: 't' }[variant]
  const w = room(['  @               ' + letter])
  w.player.invuln = 99999
  const input = t.makeInput()
  const car = t.find(w, 'car')
  let washedAt = -1
  for (let i = 0; i < 900; i++) {
    const near = car.x - (w.player.x + w.player.w) < 150
    sim.stepWorld(w, input(near && car.state !== 'clean' ? ['spray'] : []))
    w.events.length = 0
    w.player.invuln = 99999
    if (car.state === 'clean' && washedAt < 0) washedAt = i
    each(w, car, i)
    if (washedAt >= 0 && i - washedAt > 120) break
  }
  return washedAt
}

t.test('renderer: a car is bent by whole pixels only (no fractional scale), every piece of art drawn at its own size or one row or column repeated', () => {
  const draw = registry.getRenderer({ kind: 'car', variant: 'sedan' })
  t.ok(draw, 'no renderer for car')
  const h = harness()
  let pieces = 0
  for (const variant of Object.keys(TUNING.cars)) {
    const washed = washLife(variant, (w, car, i) => {
      h.reset()
      draw(h.g, car, h.rc(w, i))
      for (const [x, y] of h.log.scales) t.ok(Math.abs(x) === 1 && y === 1, `${variant}: scaled by ${x}, ${y} at tick ${i}`)
      for (const [x, y] of h.log.translates) t.ok(Number.isInteger(x) && Number.isInteger(y), `${variant}: moved by ${x}, ${y} at tick ${i}`)
      for (const a of h.log.images) {
        const [, , , sw, sh, dx, dy, dw, dh] = a
        pieces++
        t.ok(Number.isInteger(dx) && Number.isInteger(dy), `${variant}: art put down at ${dx}, ${dy}`)
        t.ok((dw === sw || sw === 1) && (dh === sh || sh === 1), `${variant}: art stretched from ${sw}x${sh} to ${dw}x${dh} at tick ${i}`)
      }
    })
    t.ok(washed > 0, `${variant} was never washed`)
  }
  t.notes.push(`renderer: ${pieces} pieces of car art drawn over seven washes, all at whole pixels`)
})

t.test('renderer: the face tells the wash: grump, wide (the first cold drop), brr, bliss (nearly clean), joy, honk, happy', () => {
  for (const variant of ['sedan', 'van', 'monster']) {
    const seen = []
    washLife(variant, (w, car, i) => {
      const f = render.faceOf(car, i)
      if (f === 'shut') return
      if (seen[seen.length - 1] !== f) seen.push(f)
    })
    const story = ['grump', 'wide', 'brr', 'bliss', 'joy', 'honk', 'happy']
    let at = 0
    for (const f of seen) if (f === story[at]) at++
    t.eq(at, story.length, `${variant}: faces ${seen.join(' > ')} do not tell ${story.join(' > ')}`)
  }
})

t.test('renderer: a car Maxx stands on is drawn exactly on its box, both ways round: no lift, no squash, no nudge', () => {
  const draw = registry.getRenderer({ kind: 'car', variant: 'sedan' })
  const h = harness()
  for (const dir of [-1, 1]) {
    const legend = { 1: { kind: 'car', variant: 'monster', props: { clean: true, dir } } }
    const w = room(['  @          1'], { legend })
    const car = t.find(w, 'car')
    // Washed a moment ago, so the bounce would be playing if he were not on it.
    car.stateT = 5
    t.place(w, car.x + car.w / 2, car.y - 4)
    t.until(w, [], (w) => w.player.ridingId === car.id && w.player.onGround, 60)
    t.eq(w.player.ridingId, car.id, 'never got onto the roof')
    for (let i = 0; i < 40; i++) {
      t.steps(w, [], 1)
      h.reset()
      draw(h.g, car, h.rc(w, i))
      const [x, y] = h.log.translates[0]
      t.eq(y, Math.round(car.y + car.h) - Math.round(w.camera.y), `dir ${dir}: the body was lifted under Maxx at tick ${i}`)
      t.eq(x, Math.round(car.x + car.w / 2) - Math.round(w.camera.x), `dir ${dir}: the body was nudged under Maxx at tick ${i}`)
      for (const a of h.log.images) t.ok(a[3] === a[7] && a[4] === a[8] && a.length === 9, `dir ${dir}: the body was bent under Maxx`)
      t.eq(h.log.scales.length, dir > 0 ? 1 : 0, 'mirrored only when it faces right')
    }
  }
})

t.test('renderer: the same spawn wears the same paint on every visit and retry; a level shows several paints', () => {
  const paints = (w) => t.all(w, 'car').map((c) => `${c.slot}:${render.paintOf(c, meta.variants[c.variant].paints.length)}`).join(',')
  const devCarsLevel = levels.levelById('dev-cars')
  const a = sim.createWorld(devCarsLevel, { session: t.freshSession() })
  const b = sim.createWorld(devCarsLevel, { session: t.freshSession(), seed: 99, checkpoint: { areaId: 'main', x: 200 * TILE, y: 10 * TILE } })
  t.eq(paints(a), paints(b), 'paints differ between two visits')
  const distinct = new Set(t.all(a, 'car').map((c) => render.paintOf(c, 4)))
  t.ok(distinct.size >= 3, `only ${distinct.size} paints among ${t.all(a, 'car').length} cars`)
  // A spawner's cars: by the spawner's slot and the car's number, so its third car is always the same colour.
  const fake = (from, n) => ({ props: {}, slot: -1, id: 900 + n, vars: { from, n } })
  t.eq(render.paintOf(fake(5, 2), 4), render.paintOf({ ...fake(5, 2), id: 7 }, 4), 'a spawner car took its paint from its id')
  t.eq(render.paintOf({ props: { paint: 6 }, slot: 0, id: 1, vars: {} }, 4), 2, 'props.paint wraps round the paints')
})

t.test('renderer: wheels turn the way the car rolls (a frame on per stride), and a revving sports car spins them on the spot', () => {
  const draw = registry.getRenderer({ kind: 'car', variant: 'sedan' })
  const h = harness()
  const wheelOf = (w, car, tick) => {
    h.reset()
    draw(h.g, car, h.rc(w, tick))
    return h.log.draws.find((d) => d.name.startsWith('cars/wheel'))?.name
  }
  const w = t.flat(['  @                  f'])
  const car = t.find(w, 'car')
  t.steps(w, [], 3)
  t.eq(car.state, 'rev', 'not revving')
  const spun = new Set()
  for (let i = 0; i < 12; i++) spun.add(wheelOf(w, car, i))
  t.ok(spun.size >= 2, 'the wheels of a revving sports car stand still')
  // Rolling left a whole stride steps the frame back by one (anticlockwise on screen); rolling right, on by one.
  const stride = meta.wheels['16'].stride
  const n = meta.wheels['16'].frames
  const idx = (name) => Number(name.slice(-1))
  const s = room(['  @                  s'])
  const sedan = t.find(s, 'car')
  sedan.x = 40 * TILE
  const i0 = idx(wheelOf(s, sedan, 0))
  sedan.x -= stride
  t.eq(idx(wheelOf(s, sedan, 0)), (i0 + n - 1) % n, 'rolling left a stride')
  sedan.x += 2 * stride
  t.eq(idx(wheelOf(s, sedan, 0)), (i0 + 1) % n, 'rolling right a stride')
})

t.test('renderer: a sports car still off screen puts a warning on the edge it is coming from, pointing in; none once it is in view', () => {
  const draw = registry.getRenderer({ kind: 'car', variant: 'sports' })
  const h = harness()
  const marks = (w, car, tick) => {
    h.reset()
    draw(h.g, car, h.rc(w, tick))
    return h.log.draws.filter((d) => d.name.startsWith('cars/mark'))
  }
  for (const dir of [-1, 1]) {
    const legend = { 1: { kind: 'car', variant: 'sports', props: { dir } } }
    const w = t.flat([dir < 0 ? '                    @               1' : '  1           @'], { legend })
    const car = t.find(w, 'car')
    t.until(w, [], () => car.active, 30)
    t.ok(car.active, `dir ${dir}: never woke`)
    const camX = Math.round(w.camera.x)
    const m = marks(w, car, 0)
    t.eq(m.length, 1, `dir ${dir}: warnings shown while it revs off screen`)
    const edge = m[0].x - camX
    if (dir < 0) t.ok(edge > contract.VIEW_W - 40 && !m[0].flip, `dir ${dir}: the warning is at x ${edge}, flipped ${m[0].flip}`)
    else t.ok(edge < 40 && m[0].flip, `dir ${dir}: the warning is at x ${edge}, flipped ${m[0].flip}`)
    t.until(w, [], () => car.x > w.camera.x + 40 && car.x + car.w < w.camera.x + contract.VIEW_W - 40, 300)
    t.eq(marks(w, car, 1).length, 0, `dir ${dir}: a warning while the car is in view`)
  }
})

t.test('renderer: words in the dirt read the right way round on a car facing right (mirror-ready dirt), and filthy cars wear the grimy body', () => {
  const draw = registry.getRenderer({ kind: 'car', variant: 'compact' })
  const h = harness()
  for (const v of ['compact', 'van']) t.ok(meta.variants[v].mirrorDirt && frames[`${v}_d3m`], `${v}: no mirror-ready dirt`)
  for (const dir of [-1, 1]) {
    const legend = { 1: { kind: 'car', variant: 'compact', props: { dir, speed: 0 } } }
    const w = room(['  @          1'], { legend })
    const car = t.find(w, 'car')
    h.reset()
    draw(h.g, car, h.rc(w, 0))
    const want = dir > 0 ? 'cars/compact_d3m' : 'cars/compact_d3'
    t.ok(h.log.sources.includes(want), `dir ${dir}: drew ${h.log.sources.filter((n) => n.includes('_d')).join(', ')}, not ${want}`)
    t.ok(h.log.sources.some((n) => n.startsWith('cars/compact_dull')), `dir ${dir}: a filthy car in its clean paint`)
    for (let i = 0; i < 999 && car.state !== 'clean'; i++) t.spray(w, car)
    t.steps(w, [], 30)
    h.reset()
    draw(h.g, car, h.rc(w, 0))
    t.ok(h.log.sources.some((n) => n.startsWith('cars/compact_p')) && !h.log.sources.some((n) => n.includes('dull')), `dir ${dir}: a washed car not in its bright paint`)
  }
})

/* ------------------------------------------------------------------ */
/* Standing on a washed car: its roof line, not its box                */
/* ------------------------------------------------------------------ */

const { MAXX_W } = contract
const VARIANTS = Object.keys(TUNING.cars)
const round = (n) => Math.round(n * 100) / 100
const feetOf = (w) => w.player.y + w.player.h

/** The roof line the way the car faces now, read from CAR_TOPS (checked against the art below): column 0 is its box's left edge. */
const lineOf = (car) => (car.facing > 0 ? carTop(car.variant).reverse() : carTop(car.variant))
/** Where the drawn outline holds up something spanning world x0 .. x1: its highest point there (null: not over the car). */
function artTop(car, x0, x1) {
  const line = lineOf(car)
  let best = Infinity
  const c1 = Math.min(car.w - 1, Math.ceil(x1 - car.x - 1e-3) - 1)
  for (let c = Math.max(0, Math.floor(x0 - car.x + 1e-3)); c <= c1; c++) best = Math.min(best, line[c])
  return best === Infinity ? null : car.y + best
}
/** A washed car, parked (or driving at `speed`), facing `dir`, to the right of Maxx; everything awake. */
function washedCar(variant, dir, speed = 0) {
  const legend = { 1: { kind: 'car', variant, props: { clean: true, speed, dir } } }
  const w = room(['  @                 1'], { legend })
  return { w, car: t.find(w, 'car') }
}
/** Drop Maxx with his box's left edge at world x from just above the car, and let him land. */
function dropOn(w, car, x, above = 40) {
  t.place(w, x + MAXX_W / 2, car.y - above)
  t.until(w, [], (w) => w.player.onGround, 90)
}
/** Where the outline holds up his boots (the middle 14 px of his box), or null when they are not over the car. */
const underBoots = (car, p) => artTop(car, p.x + 4, p.x + p.w - 4)
/** Riding, his boots are on the outline under them; otherwise he is over it, never sunk into the body. */
function onLine(w, car, what) {
  const p = w.player
  const top = underBoots(car, p)
  if (top === null || feetOf(w) === car.y + car.h) return
  if (p.onGround && p.ridingId === car.id) t.near(feetOf(w), top, 1e-6, `${what}: riding, but not on the outline under him`)
  else t.ok(feetOf(w) <= top + 1e-6, `${what}: ${round(feetOf(w) - top)} px down into the body`)
}

t.test('art: CAR_TOPS is each body as drawn, column by column, for every paint and the grimy bodies', () => {
  const png = Canvas.load(path.join(ASSETS_DIR, 'cars.png'))
  for (const [v, spec] of Object.entries(TUNING.cars)) {
    t.ok(CAR_TOPS[v], `no roof line for ${v}`)
    const want = carTop(v).join(' ')
    t.eq(carTop(v).length, spec.w, `${v}: columns in CAR_TOPS`)
    for (let k = 0; k < meta.variants[v].paints.length; k++) {
      for (const name of [`${v}_p${k}`, `${v}_dull${k}`]) {
        const f = frames[name]
        const got = []
        for (let i = 0; i < f.w; i++) {
          let r = 0
          while (r < f.h && !png.solid(f.x + i, f.y + r)) r++
          got.push(r + spec.h - f.ay)
        }
        t.eq(got.join(' '), want, `${name}: the outline as drawn against CAR_TOPS.${v}`)
      }
    }
  }
})

t.test('washed cars: the roof line faces the way the car does, and turns round with it', () => {
  for (const dir of [-1, 1]) {
    const { car } = washedCar('sedan', dir)
    t.eq(car.ground.join(' '), lineOf(car).join(' '), `dir ${dir}: the ground profile is not the art's outline that way round`)
  }
  // A dirty car carries it too (a splat lands on its hood), and it flips at a wall.
  const w = t.flat(['X', 'X       s         @'])
  const car = t.find(w, 'car')
  t.eq(car.ground.join(' '), carTop('sedan').join(' '), 'dirty, nose first, driving left')
  t.until(w, [], () => car.facing === 1, 900)
  t.eq(car.facing, 1, 'never turned at the wall')
  t.eq(car.ground.join(' '), carTop('sedan').reverse().join(' '), 'turned round: the line is mirrored')
})

t.test('washed cars: coming down anywhere on one, Maxx lands with his boots on its outline (roof, hood or trunk), never on the air over it', () => {
  const lines = []
  for (const variant of VARIANTS) {
    let spots = 0
    let deep = 0
    for (const dir of [-1, 1]) {
      const probe = washedCar(variant, dir).car
      for (let k = -MAXX_W + 1; k < probe.w; k += 3) {
        const { w, car } = washedCar(variant, dir)
        dropOn(w, car, car.x + k)
        const p = w.player
        const where = `${variant} dir ${dir}, box ${k} px in`
        const boots = underBoots(car, p)
        if (boots === null) {
          // Only his box's edge over the car: he comes down past it to the road, as past any edge.
          t.ok(p.ridingId !== car.id && feetOf(w) === car.y + car.h, `${where}: stood on the car with his boots off it`)
          continue
        }
        spots++
        t.eq(p.ridingId, car.id, `${where}: did not land on the car`)
        t.near(feetOf(w), boots, 1e-6, `${where}: boots against the outline under them`)
        deep = Math.max(deep, feetOf(w) - car.y)
      }
    }
    lines.push(`${variant} ${spots} (down to ${deep} px)`)
  }
  t.notes.push('washed cars, landing spots tried with his boots over the car, every one on the outline: ' + lines.join(', '))
})

t.test('washed cars: walking off the roof he steps down to the hood or the trunk with it, then off the end onto the road', () => {
  for (const variant of VARIANTS) {
    for (const dir of [-1, 1]) {
      for (const way of [-1, 1]) {
        const what = `${variant} dir ${dir} walking ${way < 0 ? 'left' : 'right'}`
        const { w, car } = washedCar(variant, dir)
        const line = lineOf(car)
        // Start on the middle of the roof.
        const first = line.indexOf(0)
        let last = first
        while (line[last + 1] === 0) last++
        dropOn(w, car, car.x + (first + last) / 2 - MAXX_W / 2)
        t.eq(feetOf(w), car.y, `${what}: did not start on the roof`)
        const input = t.makeInput()
        let deepest = 0
        let road = false
        for (let i = 0; i < 240 && !road; i++) {
          sim.stepWorld(w, input([way < 0 ? 'left' : 'right']))
          w.events.length = 0
          onLine(w, car, `${what}, tick ${i}`)
          if (w.player.ridingId === car.id) deepest = Math.max(deepest, feetOf(w) - car.y)
          road = w.player.onGround && feetOf(w) === car.y + car.h
        }
        t.ok(road, `${what}: never came off the end onto the road`)
        // The 18 columns at the end he left by are the hood (or the trunk): he got down onto them.
        const end = way < 0 ? line.slice(0, 18) : line.slice(-18)
        t.ok(deepest >= Math.min(...end), `${what}: rode no lower than ${deepest} px under the roof, the end is ${Math.min(...end)} down`)
      }
    }
  }
})

t.test('washed cars: from the hood he runs up the windscreen onto the roof without a stumble', () => {
  for (const variant of VARIANTS) {
    for (const dir of [-1, 1]) {
      const what = `${variant} dir ${dir}`
      const { w, car } = washedCar(variant, dir)
      // Nose end: the left one when it faces left.
      const nose = car.facing < 0
      dropOn(w, car, nose ? car.x + 1 : car.x + car.w - MAXX_W - 1)
      t.eq(w.player.ridingId, car.id, `${what}: not on the hood`)
      t.ok(feetOf(w) - car.y >= 8, `${what}: landed ${feetOf(w) - car.y} px under the roof, not on the hood`)
      const input = t.makeInput()
      let n = 0
      for (; n < 120 && feetOf(w) !== car.y; n++) {
        sim.stepWorld(w, input([nose ? 'right' : 'left']))
        w.events.length = 0
        onLine(w, car, `${what}, tick ${n}`)
        t.ok(w.player.ridingId === car.id && w.player.onGround, `${what}: lost his footing on the way up, tick ${n}`)
      }
      t.eq(feetOf(w), car.y, `${what}: never reached the roof`)
    }
  }
})

t.test('washed cars: riding on the hood of a driving car is exact, tick for tick, both ways round', () => {
  for (const variant of VARIANTS) {
    for (const dir of [-1, 1]) {
      const what = `${variant} dir ${dir}`
      const { w, car } = washedCar(variant, dir, 40)
      const nose = car.facing < 0
      // From just above, so the car has not driven out from under the spot before he lands.
      dropOn(w, car, nose ? car.x - 6 : car.x + car.w - MAXX_W + 6, 2)
      const p = w.player
      t.eq(p.ridingId, car.id, `${what}: not riding`)
      const depth = feetOf(w) - car.y
      t.ok(depth >= 8, `${what}: ${depth} px under the roof, not on the hood`)
      const offset = p.x - car.x
      const x0 = car.x
      for (let i = 0; i < 90; i++) {
        t.steps(w, [], 1)
        t.eq(p.ridingId, car.id, `${what}: riding, tick ${i}`)
        t.near(p.x - car.x, offset, 1e-9, `${what}: his place on the hood, tick ${i}`)
        t.near(feetOf(w) - car.y, depth, 1e-9, `${what}: his feet on the hood, tick ${i}`)
      }
      t.ok(Math.abs(car.x - x0) > 60, `${what}: the car did not drive`)
    }
  }
})

await t.finish()
