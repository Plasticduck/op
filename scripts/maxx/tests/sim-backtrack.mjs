// Going back for something: a counted car Maxx left behind is still there when he returns, and on
// a retry walking back over an earlier checkpoint never moves the next retry back to it.
//
//   node scripts/maxx/tests/sim-backtrack.mjs [--only text]
import { suite } from '../lib/testkit.mjs'

const t = await suite('sim-backtrack')
const { sim, contract } = t
const { TILE } = contract
const LONG = '#'.repeat(200)
const carAt = (w, slot) => w.entities.find((e) => e.kind === 'car' && e.slot === slot)

/** Run Maxx one way (shine kept full) until the camera's left edge gets to `camX`. */
function runTo(w, dir, camX, input) {
  const p = w.player
  const done = (ww) => (dir > 0 ? ww.camera.x >= camX : ww.camera.x <= camX)
  const n = t.until(
    w,
    [dir > 0 ? 'right' : 'left'],
    (ww) => {
      p.invuln = 99
      p.pips = 3
      return done(ww)
    },
    60 * 60,
    input,
  )
  t.ok(n > 0, `Maxx never got the camera to ${camX}`)
}

t.test('a counted car left far behind, parked or driving away, sleeps and is still there when Maxx comes back; bonus and washed cars are still removed', () => {
  // Slots in reading order: 1 the parked sedan, 2 a counted compact, 3 a bonus sedan, 4 a washed suv (all driving left).
  const legend = {
    1: { kind: 'car', variant: 'sedan', props: { speed: 0 } },
    2: { kind: 'car', variant: 'compact' },
    3: { kind: 'car', variant: 'sedan', props: { bonus: true } },
    4: { kind: 'car', variant: 'suv', props: { clean: true } },
  }
  const w = t.makeWorld(['', '', '   @     1        2   3   4', LONG, LONG], { legend })
  const slots = {}
  for (const e of w.entities) if (e.kind === 'car') slots[e.props.speed === 0 ? 'parked' : e.props.bonus ? 'bonus' : e.props.clean ? 'clean' : 'driving'] = e.slot
  t.eq(w.stats.carsTotal, 2, 'two counted cars')
  const input = t.makeInput()
  // Lifted over them while they pass underneath, then off to the right, far beyond the sleep margin.
  w.player.y -= 200
  runTo(w, 1, 60 * TILE, input)
  const parked = carAt(w, slots.parked)
  const driving = carAt(w, slots.driving)
  t.ok(parked && !parked.dead && w.entities.includes(parked), 'the parked counted car (facing left, left behind) was removed')
  t.ok(driving && !driving.dead && w.entities.includes(driving), 'the counted car driving away was removed')
  t.eq(parked.active, false, 'the parked car is asleep far behind')
  t.eq(driving.active, false, 'the car driving away is asleep far behind')
  t.ok(!carAt(w, slots.bonus), 'a bonus car that drove past and far behind is removed')
  t.ok(!carAt(w, slots.clean), 'a washed car that drove past and far behind is removed')
  // Back for them.
  runTo(w, -1, driving.x - 64, input)
  t.until(w, [], () => driving.active, 30, input)
  t.ok(driving.active && !driving.dead, 'the counted car is there and awake when he comes back')
  runTo(w, -1, parked.x - 64, input)
  t.until(w, [], () => parked.active, 30, input)
  t.ok(parked.active && !parked.dead && parked.state === 'drive', 'the parked car is there and awake when he comes back')
  // Both can still be washed, and that is SPOTLESS.
  t.spray(w, parked, 999)
  t.spray(w, driving, 999)
  t.ok(sim.isSpotless(w), 'every counted car washed is SPOTLESS')
})

t.test('a penned counted car is kept whichever way it is driving when the camera leaves', () => {
  for (const dir of [-1, 1]) {
    const legend = { 1: { kind: 'car', variant: 'van', props: { dir } } }
    // A pen of 2-block walls (columns 40 and 53), 12 tiles across, well right of the start.
    const wall = ' '.repeat(40) + '#' + ' '.repeat(12) + '#'
    const w = t.makeWorld(['  @', wall, ' '.repeat(40) + '#      1     #', LONG, LONG], { legend })
    const van = t.find(w, 'car')
    const input = t.makeInput()
    const p = w.player
    const stay = (n) => {
      for (let i = 0; i < n; i++) {
        p.invuln = 99
        p.pips = 3
        t.steps(w, [], 1, input)
      }
    }
    // Watch it shuttle a while from beside the pen, take the camera 45 tiles away and bring it back,
    // at several points of its trip.
    const by = 37 * TILE + TILE / 2
    for (let k = 0; k < 6; k++) {
      t.place(w, by, 10 * TILE)
      stay(37 + k * 23)
      const heading = van.facing
      t.place(w, by + 45 * TILE, 10 * TILE)
      stay(30)
      t.ok(!van.dead && w.entities.includes(van), `dir ${dir}, round ${k}: the penned van (driving ${heading < 0 ? 'left' : 'right'}) was removed`)
      t.eq(van.active, false, `dir ${dir}, round ${k}: asleep while the camera is away`)
      t.place(w, by, 10 * TILE)
      stay(2)
      t.ok(van.active && van.x >= 41 * TILE && van.x + van.w <= 53 * TILE, `dir ${dir}, round ${k}: back in view in its pen`)
    }
  }
})

t.test('a counted spawner car asleep far off screen does not hold up the next one', () => {
  // Max one dirty car about: the first drives off right, away from Maxx, and falls asleep out there.
  const legend = { 1: { kind: 'spawner', props: { variant: 'sedan', dir: 1, every: 30, max: 1, count: 3, delay: 1 } } }
  const w = t.makeWorld(['', '', '  @         1', LONG, LONG], { legend })
  const input = t.makeInput()
  const sp = t.find(w, 'spawner')
  const mine = () => w.entities.filter((e) => e.kind === 'car' && e.vars.owner === sp.id && !e.dead)
  t.until(w, [], () => mine().length === 1, 60, input)
  const first = mine()[0]
  t.ok(first, 'the first car was sent')
  const n = t.until(w, [], () => sp.vars.sent === 2, 60 * 40, input)
  t.ok(n > 0, 'the second car never came')
  t.ok(!first.dead, 'the first was removed')
  t.eq(first.active, false, 'by then the first is asleep far off screen')
})

/** Two checkpoints on a flat floor, at columns 10 and 30; Maxx starts at column 2. */
const CP_ROWS = ['', '', '  @       k                   k', LONG, LONG]
const cpCol = (cp) => Math.floor(cp.x / TILE)

t.test('on a retry, walking back over an earlier checkpoint never moves the next retry back to it', () => {
  const w = t.makeWorld(CP_ROWS)
  const input = t.makeInput()
  const sink = []
  t.until(w, ['right'], (ww) => ww.checkpoint && cpCol(ww.checkpoint) === 30, 60 * 10, input, sink)
  t.eq(sink.filter((ev) => ev.type === 'checkpoint').length, 2, 'both flags taken on the way')
  const level = w.level
  // A retry from the second flag: both are up, and walking back over the first changes nothing.
  const late = sim.createWorld(level, { session: t.freshSession(), checkpoint: w.checkpoint, flags: { ...w.flags } })
  const flags = t.all(late, 'checkpoint').sort((a, b) => a.x - b.x)
  t.eq(flags.map((f) => f.state).join(','), 'on,on', 'flags on a retry from the second')
  const seen = []
  t.until(late, ['left'], (ww) => ww.player.x + ww.player.w < 8 * TILE, 60 * 10, t.makeInput(), seen)
  t.eq(seen.filter((ev) => ev.type === 'checkpoint').length, 0, 'walking back over the first flag took it again')
  t.eq(cpCol(late.checkpoint), 30, 'the next retry moved back')
  // A retry from the first: the second is still to come, and taking it moves the retry on.
  const early = sim.createWorld(level, { session: t.freshSession(), checkpoint: { areaId: 'main', x: flags[0].x + flags[0].w / 2, y: flags[0].y + flags[0].h }, flags: {} })
  t.eq(t.all(early, 'checkpoint').sort((a, b) => a.x - b.x).map((f) => f.state).join(','), 'on,idle', 'flags on a retry from the first')
  t.until(early, ['right'], (ww) => cpCol(ww.checkpoint) === 30, 60 * 10, t.makeInput())
  t.eq(cpCol(early.checkpoint), 30, 'the second flag moves the retry on')
})

await t.finish()
