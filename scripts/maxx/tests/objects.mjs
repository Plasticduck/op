// The objects slice: gates and buttons, locked doors, the exit arch and its near pillar, the
// employees' door, prizes popping out of crates, the checkpoint, and the dev room
// (levels/dev/objects.ts) played through where each thing stands.
//   node scripts/maxx/tests/objects.mjs [--only <title part>]
import { suite } from '../lib/testkit.mjs'

const t = await suite('objects')
const { sim, contract, levels, ok, eq, find, all, has, until, steps, place, flat, makeWorld, makeInput, freshSession, FLOOR } = t
const { TILE } = contract
const { createWorld, stepWorld, TUNING, getFlag, setFlag, validateLevel, worldHash } = sim

const sfx = (events, id) => events.some((ev) => ev.type === 'sfx' && ev.id === id)
const count = (events, id) => events.filter((ev) => ev.type === 'sfx' && ev.id === id).length
const feet = (w) => w.player.y + w.player.h
/** Feet x of the middle of tile column tx. */
const col = (tx) => tx * TILE + TILE / 2
const GROUND = 10 * TILE
/** Press a button for one tick, then let it go (a fresh push, not a hold). */
function tap(w, action, input, sink) {
  until(w, [action], () => true, 1, input, sink)
  until(w, [], () => true, 1, input, sink)
}

const OPEN_TICKS = 48
const GATE_TOP = 12
const UNLOCK_TICKS = 30

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

const GATE = { 7: { kind: 'gate', props: { flag: 'g' } } }

t.test('gate: sized from its bottom-left tile by props.w and props.h, 1 x 3 by default', () => {
  const w = flat(['  @      7     8'], { legend: { ...GATE, 8: { kind: 'gate', props: { flag: 'g', w: 2, h: 4 } } } })
  const [a, b] = all(w, 'gate').sort((p, q) => p.x - q.x)
  eq(a.x, 9 * TILE, 'x of the 1 x 3')
  eq(a.w, TILE, 'width of the 1 x 3')
  eq(a.h, 3 * TILE, 'height of the 1 x 3')
  eq(a.y + a.h, GROUND, 'it stands on the floor')
  eq(b.x, 15 * TILE, 'x of the 2 x 4')
  eq(b.w, 2 * TILE, 'width of the 2 x 4')
  eq(b.h, 4 * TILE, 'height of the 2 x 4')
  eq(a.state, 'shut', 'state')
  eq(a.solid, 'full', 'solid')
})

t.test('gate: shut, it is a wall, stops water, and leaning on it buzzes once', () => {
  const w = flat(['  @      7'], { legend: GATE })
  const gate = find(w, 'gate')
  const events = steps(w, ['right'], 150)
  ok(Math.abs(w.player.x + w.player.w - gate.x) <= 1, `he should stand against it, his right edge at ${w.player.x + w.player.w}, the gate at ${gate.x}`)
  eq(count(events, 'locked'), 1, "'locked' buzzes")
  ok(gate.vars.push > 60, `it knows he is leaning on it (${gate.vars.push})`)
  eq(t.spray(w, gate), true, 'water splashes on it')
  eq(gate.state, 'shut', 'still shut')
})

t.test('gate: once its flag is there it rolls up over OPEN_TICKS, then lets him and the water through', () => {
  const w = flat(['  @      7'], { legend: GATE })
  const gate = find(w, 'gate')
  const input = makeInput()
  steps(w, [], 10, input)
  setFlag(w, 'g', 1)
  const events = []
  let last = gate.h
  let shrinking = true
  const took = until(
    w,
    [],
    () => {
      if (gate.h > last) shrinking = false
      last = gate.h
      return gate.state === 'open'
    },
    OPEN_TICKS + 10,
    input,
    events,
  )
  ok(took > 0, 'it never opened')
  ok(Math.abs(took - OPEN_TICKS - 1) <= 1, `it took ${took} ticks`)
  ok(shrinking, 'the curtain went back down while rolling up')
  ok(sfx(events, 'gate'), "no 'gate' sound as it starts")
  ok(sfx(events, 'bump'), "no 'bump' as it reaches the top")
  eq(gate.solid, 'none', 'no longer solid')
  eq(gate.h, GATE_TOP, 'only the drum housing is left')
  eq(gate.y, GROUND - 3 * TILE, 'the top stayed put')
  // Water now flies on under the drum.
  place(w, gate.x - 40, GROUND)
  steps(w, [], 2, input)
  let beyond = 0
  for (let i = 0; i < 40; i++) {
    steps(w, ['spray'], 1, input)
    for (const d of w.droplets) if (d.x > gate.x + gate.w + 4) beyond++
  }
  ok(beyond > 0, 'no water got past the open gate')
  until(w, ['right'], (x) => x.player.x > gate.x + gate.w + 8, 120, input)
  ok(w.player.x > gate.x + gate.w, 'he could not walk through')
  setFlag(w, 'g', 0)
  steps(w, [], 30, input)
  eq(gate.state, 'open', 'open for good, even if the flag drops')
})

t.test('gate: shut, no water gets past it', () => {
  const w = flat(['  @  7'], { legend: GATE })
  const gate = find(w, 'gate')
  const input = makeInput()
  let beyond = 0
  for (let i = 0; i < 90; i++) {
    steps(w, ['spray'], 1, input)
    for (const d of w.droplets) if (d.x > gate.x + gate.w) beyond++
  }
  eq(beyond, 0, 'droplets beyond the shut gate')
})

t.test('gate: it is always awake, so a car still awake off screen cannot drive through it', () => {
  // The gate is past the wake margin, the car between it and the sleep margin: both off screen.
  const w = flat(['  @' + ' '.repeat(23) + '7'], { legend: GATE })
  const gate = find(w, 'gate')
  const car = sim.spawn(w, 'car', 32 * TILE, GROUND, { variant: 'sports', props: { dir: -1 } })
  const input = makeInput()
  let through = false
  for (let i = 0; i < 300; i++) {
    steps(w, [], 1, input)
    if (!car.dead && car.x + car.w <= gate.x) through = true
  }
  ok(gate.x > w.camera.x + contract.VIEW_W + TUNING.activeMargin, 'the gate should start beyond the wake margin')
  eq(through, false, 'the car drove through the shut gate')
  eq(gate.state, 'shut', 'still shut')
})

t.test('gate: a car on screen turns back at it, and drives on once it is open', () => {
  const w = flat(['  @          7          '], { legend: GATE })
  const gate = find(w, 'gate')
  const car = sim.spawn(w, 'car', 18 * TILE, GROUND, { variant: 'compact', props: { dir: -1 } })
  const input = makeInput()
  let leftmost = Infinity
  for (let i = 0; i < 240; i++) {
    steps(w, [], 1, input)
    leftmost = Math.min(leftmost, car.x)
  }
  ok(leftmost >= gate.x + gate.w - 1, `the car got into the gate (its left edge reached ${Math.round(leftmost)}, the gate ends at ${gate.x + gate.w})`)
  ok(car.facing === 1, 'it should have turned round')
})

t.test('gate: standing on top of it when it opens, he drops to the floor unhurt', () => {
  const w = flat(['  @  7'], { legend: GATE })
  const gate = find(w, 'gate')
  const input = makeInput()
  place(w, gate.x + gate.w / 2, gate.y)
  steps(w, [], 10, input)
  ok(w.player.onGround && feet(w) === gate.y, 'he should stand on the shut gate')
  setFlag(w, 'g', 1)
  until(w, [], () => gate.state === 'open', OPEN_TICKS + 10, input)
  steps(w, [], 20, input)
  eq(feet(w), GROUND, 'his feet after it opened')
  ok(w.player.onGround && w.player.pips === 3, 'on the floor, unhurt')
})

t.test('gate: Maxx put inside a shut gate (a checkpoint on it) is pushed out unhurt', () => {
  const w = flat(['  @     7'], { legend: GATE, world: { checkpoint: { areaId: 'main', x: 8 * TILE + 16, y: GROUND } } })
  const gate = find(w, 'gate')
  const events = steps(w, [], 60)
  ok(w.player.x + w.player.w <= gate.x + 0.01 || w.player.x >= gate.x + gate.w - 0.01, 'he is still inside the gate')
  eq(w.player.pips, 3, 'pips')
  ok(!sfx(events, 'hurt'), 'he was hurt')
})

t.test('gate and door: the flag set in another area; back there they open with their show', () => {
  const legend = { 7: { kind: 'gate', props: { flag: 'k' } }, 2: { kind: 'door', props: { to: 'b:x', name: 'home', flag: 'k' } }, 1: { kind: 'door', props: { to: 'b:x', name: 'out' } } }
  const B = {
    id: 'b',
    theme: 'lot',
    rows: [...Array(9).fill(' '.repeat(24)), '  x   3   5'.padEnd(24), FLOOR.slice(0, 24), FLOOR.slice(0, 24)],
    legend: { x: { kind: 'marker', props: { name: 'x' } }, 3: { kind: 'button', props: { flag: 'k' } }, 5: { kind: 'door', props: { to: 'main:out' } } },
  }
  const w = makeWorld(['', '', '', '', '', '', '', '', '', '  @ 1  2    7', FLOOR, FLOOR], { legend, areas: [B] })
  const gate = find(w, 'gate')
  const barred = all(w, 'door').find((d) => d.props.flag === 'k')
  const input = makeInput()
  eq(barred.state, 'locked', 'the barred door at the start')
  // Through the plain door, over the button, and back.
  const plain = all(w, 'door').find((d) => !d.props.flag)
  place(w, plain.x + plain.w / 2, GROUND)
  steps(w, [], 3, input)
  tap(w, 'up', input)
  until(w, [], (x) => x.warp === null, 120, input)
  eq(w.area.id, 'b', 'in the other room')
  until(w, ['right'], () => getFlag(w, 'k') > 0, 200, input)
  eq(getFlag(w, 'k'), 1, 'the button')
  const back = find(w, 'door')
  place(w, back.x + back.w / 2, GROUND)
  steps(w, [], 3, input)
  tap(w, 'up', input)
  const events = []
  until(w, [], (x) => x.warp === null, 120, input, events)
  eq(w.area.id, 'main', 'back in the first room')
  steps(w, [], 3, input).forEach((ev) => events.push(ev))
  eq(barred.state, 'unlock', 'the barred door unlocks in front of him')
  eq(gate.state, 'opening', 'the gate rolls up in front of him')
  ok(sfx(events, 'unlock') && sfx(events, 'gate'), 'with their sounds')
})

t.test('gate and door: a retry from a checkpoint with the flag kept finds both open from the first tick', () => {
  const legend = { 7: { kind: 'gate', props: { flag: 'k' } }, 2: { kind: 'door', props: { to: 'b:x', flag: 'k' } }, 3: { kind: 'button', props: { flag: 'k' } } }
  const B = { id: 'b', theme: 'lot', rows: [...Array(9).fill(' '.repeat(24)), '  x'.padEnd(24), FLOOR.slice(0, 24), FLOOR.slice(0, 24)], legend: { x: { kind: 'marker', props: { name: 'x' } } } }
  const rows = ['', '', '', '', '', '', '', '', '', '  @ 3  k   2   7  ', FLOOR, FLOOR]
  const w = makeWorld(rows, { legend, areas: [B] })
  const input = makeInput()
  until(w, ['right'], () => w.checkpoint !== null, 200, input)
  ok(getFlag(w, 'k') === 1, 'the button was pressed on the way')
  // GRIMED, then the retry the play scene would make.
  sim.grimePlayer(w)
  const retry = makeWorld(rows, { legend, areas: [B], world: { checkpoint: w.checkpoint, flags: w.flags } })
  eq(find(retry, 'gate').state, 'open', 'the gate on the retry')
  eq(find(retry, 'gate').solid, 'none', 'and not solid')
  eq(find(retry, 'door').state, 'idle', 'the door on the retry')
  eq(find(retry, 'button').state, 'down', 'the button on the retry')
  const events = steps(retry, ['right'], 120)
  ok(!sfx(events, 'gate') && !sfx(events, 'unlock'), 'no show for things that were open already')
})

t.test('gate: it waits until it is on screen to open, so the player sees it go', () => {
  // Column 21 is just past the right edge of the first screen, close enough to be awake.
  const w = flat(['  @                  7'], { legend: GATE })
  const gate = find(w, 'gate')
  const input = makeInput()
  steps(w, [], 5, input)
  setFlag(w, 'g', 1)
  steps(w, [], 40, input)
  ok(gate.active, 'it should be awake')
  eq(gate.state, 'shut', 'it opened off screen')
  until(w, ['right'], () => gate.state !== 'shut', 120, input)
  eq(gate.state, 'opening', 'it should open once it comes into view')
  ok(gate.x < w.camera.x + contract.VIEW_W, 'and it is on screen')
})

t.test('gate: a world that starts with the flag set (a retry) has it open from the first tick', () => {
  const w = flat(['  @      7'], { legend: GATE, world: { flags: { g: 1 } } })
  const gate = find(w, 'gate')
  eq(gate.state, 'open', 'state before any tick')
  eq(gate.solid, 'none', 'solid before any tick')
  const events = steps(w, ['right'], 90)
  ok(!sfx(events, 'gate'), 'no show for a gate that was open already')
  ok(w.player.x > gate.x + gate.w, 'he walks straight through')
})

t.test('gate: props.min, and a gate with no flag never opens', () => {
  const legend = { 7: { kind: 'gate', props: { flag: 'g', min: 2 } }, 8: { kind: 'gate' } }
  const w = flat(['  @   7  8'], { legend })
  const [needs2, none] = [find(w, 'gate'), all(w, 'gate').find((g) => !g.props.flag)]
  const input = makeInput()
  setFlag(w, 'g', 1)
  steps(w, [], 60, input)
  eq(needs2.state, 'shut', 'min 2 with the flag at 1')
  setFlag(w, 'g', 2)
  until(w, [], () => needs2.state === 'open', OPEN_TICKS + 10, input)
  eq(needs2.state, 'open', 'min 2 with the flag at 2')
  eq(none.state, 'shut', 'the gate with no flag')
})

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

t.test('button: stepping on it raises the flag to props.value, once, and never lowers it', () => {
  const legend = { 3: { kind: 'button', props: { flag: 'k', value: 2 } } }
  const w = flat(['  @    3'], { legend })
  const button = find(w, 'button')
  eq(button.w, 24, 'width')
  eq(button.h, 8, 'height')
  eq(button.y + button.h, GROUND, 'it sits on the floor')
  const events = []
  until(w, ['right'], () => button.state === 'down', 120, makeInput(), events)
  eq(getFlag(w, 'k'), 2, 'flag')
  ok(sfx(events, 'click'), "no 'click'")
  const high = flat(['  @    3'], { legend, world: { flags: { k: 5 } } })
  eq(find(high, 'button').state, 'down', 'a button whose flag is already there starts down')
  steps(high, ['right'], 90)
  eq(getFlag(high, 'k'), 5, 'it never lowers a flag')
})

t.test('button: opens a gate across the room', () => {
  const legend = { ...GATE, 3: { kind: 'button', props: { flag: 'g' } } }
  const w = flat(['  @  3        7'], { legend })
  const gate = find(w, 'gate')
  const input = makeInput()
  until(w, ['right'], () => gate.state !== 'shut', 120, input)
  eq(gate.state, 'opening', 'the gate')
  until(w, ['right'], (x) => x.player.x > gate.x + gate.w + 4, 200, input)
  ok(w.player.x > gate.x + gate.w, 'through the gate')
})

/* ------------------------------------------------------------------ */
/* Doors                                                               */
/* ------------------------------------------------------------------ */

const ROOM = { id: 'b', theme: 'lot', rows: [...Array(9).fill(' '.repeat(24)), '  x'.padEnd(24), FLOOR.slice(0, 24), FLOOR.slice(0, 24)], legend: { x: { kind: 'marker', props: { name: 'x' } } } }

function doorWorld(props, flags) {
  return makeWorld(['', '', '', '', '', '', '', '', '', '  @   2', FLOOR, FLOOR], { legend: { 2: { kind: 'door', props: { to: 'b:x', ...props } } }, areas: [ROOM], world: flags ? { flags } : {} })
}

t.test('locked door: up only rattles it, the flag unlocks it with a show, then up goes through', () => {
  const w = doorWorld({ flag: 'key' })
  const door = find(w, 'door')
  eq(door.state, 'locked', 'state at the start')
  const input = makeInput()
  place(w, door.x + door.w / 2, GROUND)
  steps(w, [], 5, input)
  const events = []
  tap(w, 'up', input, events)
  ok(sfx(events, 'locked'), "no 'locked' sound")
  eq(w.warp, null, 'a locked door took him through')
  ok(door.vars.rattle > 0, 'the padlock should rattle')
  setFlag(w, 'key', 1)
  const shown = []
  steps(w, [], 2, input).forEach((ev) => shown.push(ev))
  eq(door.state, 'unlock', 'unlocking')
  ok(sfx(shown, 'unlock'), "no 'unlock' as it unlocks")
  tap(w, 'up', input)
  eq(w.warp, null, 'it worked before it had finished unlocking')
  until(w, [], () => door.state === 'idle', UNLOCK_TICKS + 5, input)
  eq(door.state, 'idle', 'unlocked')
  tap(w, 'up', input)
  ok(w.warp && w.warp.mode === 'door', 'up at the unlocked door did not open it')
  eq(door.state, 'open', 'the door swings open')
  until(w, [], () => w.warp === null, 120, input)
  eq(w.area.id, 'b', 'he is through')
})

t.test('locked door: min 2 stays barred at 1; a world with the flag already there starts unlocked', () => {
  const w = doorWorld({ flag: 'key', min: 2 }, { key: 1 })
  eq(find(w, 'door').state, 'locked', 'min 2, flag 1')
  const open = doorWorld({ flag: 'key', min: 2 }, { key: 2 })
  eq(find(open, 'door').state, 'idle', 'min 2, flag 2')
  const plain = doorWorld({})
  eq(find(plain, 'door').state, 'idle', 'a door with no flag')
})

t.test('locked door: off screen it waits, so the unlocking is seen', () => {
  const w = makeWorld(['', '', '', '', '', '', '', '', '', '  @                   2', FLOOR, FLOOR], { legend: { 2: { kind: 'door', props: { to: 'b:x', flag: 'key' } } }, areas: [ROOM] })
  const door = find(w, 'door')
  const input = makeInput()
  setFlag(w, 'key', 1)
  steps(w, [], 30, input)
  eq(door.state, 'locked', 'it unlocked off screen')
  until(w, ['right'], () => door.state !== 'locked', 120, input)
  eq(door.state, 'unlock', 'it should unlock in view')
})

/* ------------------------------------------------------------------ */
/* Exits                                                               */
/* ------------------------------------------------------------------ */

t.test('goal: the arch makes its near pillar (z 1) over its own box (z -1); he must step between the pillars', () => {
  const w = flat(['  @          G'])
  const goal = find(w, 'goal')
  const front = find(w, 'goalFront')
  ok(front, 'no goalFront')
  eq(goal.z, -1, 'the arch is behind Maxx')
  eq(front.z, 1, 'the near pillar is in front of him')
  eq(`${front.x},${front.y},${front.w},${front.h}`, `${goal.x},${goal.y},${goal.w},${goal.h}`, 'the same box')
  eq(goal.w, 96, 'three tiles wide')
  eq(goal.h, 160, 'five tiles tall')
  eq(goal.vars.front, front.id, 'the arch knows its pillar')
  const input = makeInput()
  // Touching the arch's far post is not enough.
  until(w, ['right'], (x) => x.player.x + x.player.w > goal.x + 4, 200, input)
  eq(w.status, 'play', 'brushing the post ended the level')
  until(w, ['right'], (x) => x.status !== 'play', 120, input)
  eq(w.status, 'clear', 'status')
  eq(w.exit, 'goal', 'exit')
  eq(goal.state, 'open', 'arch state')
  eq(front.state, 'open', 'pillar state')
  ok(Math.abs(w.player.x + w.player.w / 2 - (goal.x + goal.w / 2)) <= 20, 'he was between the pillars')
})

t.test('secretExit: he steps in, it opens, the level ends as a secret, and he stops in the doorway', () => {
  for (const [row, label] of [
    ['  @        V', 'running in from the left'],
    ['  V        @', 'running in from the right'],
  ]) {
    const w = flat([row], { legend: { V: { kind: 'secretExit' } } })
    const door = find(w, 'secretExit')
    const front = find(w, 'secretFront')
    eq(door.w, 32, 'width')
    eq(door.h, 64, 'height')
    eq(door.z, -1, 'the door is behind Maxx')
    ok(front && front.z === 1, 'its leaf is in front of him')
    eq(door.vars.front, front.id, 'the door knows its leaf')
    const events = []
    const way = row.indexOf('@') < row.indexOf('V') ? 'right' : 'left'
    until(w, [way], (x) => x.status !== 'play', 300, makeInput(), events)
    eq(w.exit, 'secret', `${label}: exit`)
    eq(door.state, 'open', `${label}: state`)
    eq(front.state, 'open', `${label}: leaf state`)
    ok(has(events, 'secret'), `${label}: no 'secret' event`)
    steps(w, [], 90)
    const off = w.player.x + w.player.w / 2 - (door.x + door.w / 2)
    ok(Math.abs(off) <= 5, `${label}: he should stop in the doorway, ${Math.round(off)} px off its middle`)
  }
})

t.test('secretExit: jumped into from anywhere, he still ends up in the doorway', () => {
  let inAir = 0
  for (let start = 30; start <= 200; start += 10) {
    for (const way of ['right', 'left']) {
      const w = flat([way === 'right' ? '  @            V' : '  V            @'], { legend: { V: { kind: 'secretExit' } } })
      const door = find(w, 'secretExit')
      const mid = door.x + door.w / 2
      const input = makeInput()
      until(w, [way], (x) => Math.abs(x.player.x + x.player.w / 2 - mid) <= start, 400, input)
      until(w, [way, 'jump'], (x) => x.status !== 'play', 200, input)
      if (w.status !== 'clear') continue
      if (!w.player.onGround) inAir++
      steps(w, [], 120, input)
      const off = w.player.x + w.player.w / 2 - mid
      ok(Math.abs(off) <= 5, `${way} from ${start} px: he stopped ${Math.round(off)} px off the middle of the door`)
    }
  }
  ok(inAir >= 2, `no jump went in through the air (${inAir})`)
})

/* ------------------------------------------------------------------ */
/* Pickups, the checkpoint                                             */
/* ------------------------------------------------------------------ */

t.test('prizes: each rises out of its crate behind the tiles (z -1), then comes out in front (z 0)', () => {
  for (const [ch, kind, after] of [
    ['W', 'wax', 'walk'],
    ['L', 'oneup', 'walk'],
    ['!', 'turbo', 'idle'],
  ]) {
    const w = makeWorld(['', '', '', '', '', '', `     ${ch}`, '', '', '     @', FLOOR, FLOOR])
    const input = makeInput()
    steps(w, [], 5, input)
    until(w, ['jump'], (x) => !!find(x, kind), 40, input)
    const prize = find(w, kind)
    ok(prize, `no ${kind} came out`)
    eq(prize.state, 'pop', `${kind} state`)
    eq(prize.z, -1, `${kind} z while popping`)
    eq(prize.y + prize.h, 7 * TILE, `${kind} starts inside the crate`)
    until(w, [], () => prize.state !== 'pop', TUNING.popTicks + 5, input)
    eq(prize.state, after, `${kind} state after`)
    eq(prize.z, 0, `${kind} z after`)
    eq(prize.vars.popped, 1, `${kind} vars.popped`)
    eq(prize.y + prize.h, 6 * TILE, `${kind} sits on the crate`)
  }
})

t.test('the power crate gives a bubble when Maxx is missing shine, and it floats up off the crate', () => {
  const w = makeWorld(['', '', '', '', '', '', '     !', '', '', '     @', FLOOR, FLOOR], { session: { pips: 2 } })
  const input = makeInput()
  steps(w, [], 5, input)
  until(w, ['jump'], (x) => !!find(x, 'bubble'), 40, input)
  const bubble = find(w, 'bubble')
  ok(bubble, 'no bubble')
  until(w, [], () => bubble.state !== 'pop', TUNING.popTicks + 5, input)
  steps(w, [], 60, input)
  ok(bubble.y + bubble.h < 6 * TILE - 10, 'it should float above the crate')
})

t.test('checkpoint: taken on this attempt it is fresh (the flag runs up); on a retry it is up from the start', () => {
  const w = flat(['  @    k'])
  const flag = find(w, 'checkpoint')
  eq(flag.state, 'idle', 'state at the start')
  eq(flag.z, -1, 'z')
  until(w, ['right'], () => flag.state === 'on', 120)
  eq(flag.vars.fresh, 1, 'fresh')
  const retry = flat(['  @    k'], { world: { checkpoint: w.checkpoint, flags: w.flags } })
  const again = find(retry, 'checkpoint')
  eq(again.state, 'on', 'state on the retry')
  ok(again.vars.fresh !== 1, 'not fresh on the retry')
})

t.test('token: one already in the save, or with props.owned, stays in the world as owned', () => {
  const w = flat(['  @  $  $'], { world: { tokens: [true, false, false] } })
  const states = all(w, 'token')
    .sort((a, b) => a.x - b.x)
    .map((e) => e.state)
  eq(states.join(','), 'owned,idle', 'states')
  const own = flat(['  @  9'], { legend: { 9: { kind: 'token', props: { owned: true } } } })
  eq(find(own, 'token').state, 'owned', 'props.owned')
})

t.test('sign: near while Maxx stands by it, idle once he walks on', () => {
  const w = flat(['  @A'], { legend: { A: { kind: 'sign', props: { text: 'HELLO {jump}' } } } })
  const sign = find(w, 'sign')
  const input = makeInput()
  steps(w, [], 3, input)
  eq(sign.state, 'near', 'near at the start')
  until(w, ['right'], () => sign.state === 'idle', 200, input)
  eq(sign.state, 'idle', 'idle once he is past')
})

t.test('sign: a full jump beside it does not blink its board out; from above it does not come up', () => {
  const w = flat(['  @A'], { legend: { A: { kind: 'sign', props: { text: 'HELLO' } } } })
  const sign = find(w, 'sign')
  const input = makeInput()
  steps(w, [], 3, input)
  eq(sign.state, 'near', 'near at the start')
  let lowest = Infinity
  let lost = false
  for (let i = 0; i < 70; i++) {
    steps(w, ['jump'], 1, input)
    lowest = Math.min(lowest, feet(w))
    if (sign.state !== 'near') lost = true
  }
  ok(GROUND - lowest > 120, `that was not a full jump (${GROUND - lowest} px)`)
  eq(lost, false, 'the board went away during the jump')
  // A sign under a ledge: Maxx up on the ledge does not bring it up.
  const high = flat(['   ====', '', '', '', '  A'], { legend: { A: { kind: 'sign', props: { text: 'HELLO' } } } })
  place(high, 4 * TILE, 5 * TILE)
  steps(high, [], 10, makeInput())
  eq(find(high, 'sign').state, 'idle', 'the sign under the ledge')
})

t.test('spring: boing for 14 ticks after it throws him', () => {
  const w = flat(['  @     y'])
  const spring = find(w, 'spring')
  const input = makeInput()
  // Dropped on to it from above: its sides are not walls.
  place(w, spring.x + spring.w / 2, spring.y - 60)
  until(w, [], () => spring.state === 'boing', 120, input)
  eq(spring.state, 'boing', 'state')
  ok(w.player.vy < 0, 'he is going up')
  until(w, [], () => spring.state === 'idle', 30, input)
  eq(spring.state, 'idle', 'back to idle')
})

/* ------------------------------------------------------------------ */
/* The dev room                                                        */
/* ------------------------------------------------------------------ */

const room = levels.levelById('dev-objects')

t.test('the object room is valid and places every object kind', () => {
  ok(room, "levelById('dev-objects') found nothing")
  const report = validateLevel(room)
  eq(report.errors.length, 0, `errors: ${report.errors.join('; ')}`)
  eq(report.warnings.length, 0, `warnings: ${report.warnings.join('; ')}`)
  const w = createWorld(room, { session: freshSession() })
  const kinds = new Set()
  for (const area of Object.values(w.areas)) for (const sp of area.spawns) kinds.add(sp.spec.kind)
  for (const kind of ['coin', 'token', 'bubble', 'turbo', 'wax', 'oneup', 'checkpoint', 'goal', 'secretExit', 'door', 'spring', 'lift', 'sign', 'gate', 'button']) {
    ok(kinds.has(kind), `the room has no '${kind}'`)
  }
  eq(all(w, 'token').filter((e) => e.state === 'owned').length, 1, 'one token shows as owned')
})

/** Where the first spawn of a kind (and props) sits in an area: its tile. */
function spot(w, areaId, pred) {
  const sp = w.areas[areaId].spawns.find((s) => pred(s.spec))
  if (!sp) throw new Error('nothing like that in ' + areaId)
  return sp
}

function walkRoom() {
  const w = createWorld(room, { session: freshSession(), seed: 7 })
  const input = makeInput()
  const events = []
  const hashes = []
  const go = (held, pred, max) => until(w, held, (x) => (hashes.push(worldHash(x)), pred(x)), max, input, events)

  // The gate: hop on to the block with the button, then walk through.
  const button = spot(w, 'main', (s) => s.kind === 'button' && s.props.flag === 'gates')
  const blockTop = (button.ty + 1) * TILE
  place(w, col(button.tx - 2) - 6, GROUND)
  go([], () => false, 5)
  // Up first, then steer on to the middle of the blocks, where the button is.
  go(['jump'], (x) => feet(x) < blockTop - 8, 30)
  for (let i = 0; i < 60 && !(w.player.onGround && feet(w) === blockTop); i++) {
    const dx = col(button.tx) - (w.player.x + w.player.w / 2)
    go(dx > 4 ? ['right', 'jump'] : dx < -4 ? ['left', 'jump'] : ['jump'], () => true, 1)
  }
  go([], () => getFlag(w, 'gates') > 0, 10)
  ok(getFlag(w, 'gates') === 1, 'the button by the gate was not pressed')
  const gate = find(w, 'gate')
  go(['right'], (x) => x.player.x > gate.x + gate.w + 4, 300)
  ok(w.player.x > gate.x + gate.w, 'the gate did not let him through')
  eq(gate.state, 'open', 'the gate')

  // The barred door: it rattles, the button past it unlocks it, then it takes him through.
  const barred = all(w, 'door').find((d) => d.props.flag === 'key')
  place(w, barred.x + barred.w / 2, GROUND)
  go([], () => false, 5)
  const before = events.length
  tap(w, 'up', input, events)
  ok(sfx(events.slice(before), 'locked'), 'the barred door did not say locked')
  go(['right'], () => getFlag(w, 'key') > 0, 200)
  ok(getFlag(w, 'key') === 1, 'the button past the door was not pressed')
  go(['left'], (x) => x.player.x + x.player.w / 2 <= barred.x + barred.w / 2, 200)
  go([], () => barred.state === 'idle', 80)
  eq(barred.state, 'idle', 'the barred door did not unlock')
  tap(w, 'up', input, events)
  go([], (x) => x.warp === null, 120)
  eq(w.area.id, 'back', 'the barred door goes to the back room')
  eq(find(w, 'gate').state, 'open', 'the back room gate should be open from the start')

  // The back room ends at the employees' door.
  go(['right'], (x) => x.status !== 'play', 900)
  eq(w.status, 'clear', 'the back room run')
  eq(w.exit, 'secret', 'out by the secret door')
  return { w, hashes }
}

t.test('the object room: the gate button, the barred door and its button, the back room, the employees door', () => {
  const a = walkRoom()
  const b = walkRoom()
  eq(a.hashes.length, b.hashes.length, 'two runs took the same ticks')
  for (let i = 0; i < a.hashes.length; i++) if (a.hashes[i] !== b.hashes[i]) throw new Error(`the two runs differ at tick ${i + 1}`)
  t.notes.push(`object room: walked in ${a.hashes.length} ticks, twice the same`)
})

t.test('the object room: the arch at the end of the yard', () => {
  const w = createWorld(room, { session: freshSession() })
  const goal = find(w, 'goal')
  place(w, goal.x - 3 * TILE, GROUND)
  until(w, ['right'], (x) => x.status !== 'play', 300)
  eq(w.exit, 'goal', 'exit')
  // The victory walk carries him on behind the near pillar; nothing stops him.
  steps(w, [], 60)
  ok(w.player.x > goal.x + goal.w / 2, 'he walks on through the arch')
})

t.test('the object room: every crate pays out (two power crates: the nozzle at full shine, a bubble after the spikes)', () => {
  const w = createWorld(room, { session: freshSession() })
  const input = makeInput()
  const grid = w.grid
  const crates = []
  for (let ty = 0; ty < grid.h; ty++) {
    for (let tx = 0; tx < grid.w; tx++) {
      const ch = String.fromCharCode(grid.t[ty * grid.w + tx])
      if ('?!WL'.includes(ch)) crates.push({ tx, ty, ch })
    }
  }
  eq(crates.map((c) => c.ch).join(''), '?!WL!', 'the crates in order')
  const out = []
  for (const c of crates) {
    if (c === crates[4]) {
      // Over the spikes first, so he is missing a pip.
      place(w, col(c.tx - 4), GROUND)
      until(w, ['right'], (x) => x.player.pips < 3, 120, input)
      eq(w.player.pips, 2, 'the spikes took a pip')
      until(w, [], (x) => x.player.state === 'normal' && x.player.onGround, 120, input)
    }
    place(w, col(c.tx), GROUND)
    steps(w, [], 3, input)
    const before = w.entities.length
    until(w, ['jump'], (x) => String.fromCharCode(x.grid.t[c.ty * x.grid.w + c.tx]) === 'U', 40, input)
    steps(w, [], 2, input)
    const made = w.entities.slice(before).map((e) => e.kind)
    out.push(c.ch === '?' ? 'coin' : made.join('+'))
    until(w, [], (x) => x.player.onGround, 120, input)
  }
  eq(out.join(','), 'coin,turbo,wax,oneup,bubble', 'what came out')
})

await t.finish()
