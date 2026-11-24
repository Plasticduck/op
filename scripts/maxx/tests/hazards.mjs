// Hazards: drip, icicle, brush, jet, blower. Timing and rules of each kind, fairness
// (the tell comes first, a runner gets through), determinism, and a clean run of the dev room.
//   node scripts/maxx/tests/hazards.mjs [--only <text>]
import { suite } from '../lib/testkit.mjs'

const t = await suite('hazards')
const { sim, contract, levels } = t
const { TILE, MAXX_W, MAXX_H } = contract
const { stepWorld, worldHash, TUNING } = sim

const CEIL = '%'.repeat(60)
/** A room with a ceiling in row 4, open rows 5 to 9, the floor in row 10. `under` is row 5 (things that hang), `stand` row 9. */
const room = (under, stand = '  @', opts = {}, mid = ['', '', '']) => t.makeWorld([CEIL, under, ...mid, stand, t.FLOOR, t.FLOOR], opts)
const FLOOR_Y = 10 * TILE
const UNDER_Y = 5 * TILE
const colX = (col) => col * TILE + TILE / 2
/** Run the world to an exact tick (beats read world.tick). */
const toTick = (w, tick, held = [], input = t.makeInput()) => {
  const seen = []
  while (w.tick < tick) {
    stepWorld(w, input(held))
    for (const ev of w.events) seen.push(ev)
    w.events.length = 0
  }
  return seen
}
const settle = (w) => {
  const input = t.makeInput()
  t.until(w, [], (x) => x.player.onGround, 60, input)
  return input
}
const drops = (w) => t.all(w, 'drip_drop')

/* ------------------------------------------------------------------ */
/* drip                                                                */
/* ------------------------------------------------------------------ */

t.test('drip: swells for 30 ticks, lets go on the beat, and the drop splashes on the floor', () => {
  const w = room('          d')
  const drip = t.find(w, 'drip')
  t.eq(drip.x, colX(10) - 6, 'the fitting is centred in its tile')
  t.eq(drip.y, UNDER_Y, 'the fitting sits on the underside of the ceiling')
  const input = t.makeInput()
  const swellAt = []
  let first = 0
  let landed = 0
  const sink = []
  for (let i = 0; i < 260; i++) {
    stepWorld(w, input([]))
    for (const ev of w.events) sink.push(ev)
    w.events.length = 0
    if (drip.state === 'swell') {
      swellAt.push(w.tick)
      t.eq(drip.vars.swell, w.tick - (Math.floor(w.tick / 100) * 100 + 69), 'vars.swell counts the tell')
    } else {
      t.eq(drip.vars.swell, 0, 'vars.swell while idle')
    }
    const d = drops(w)[0]
    if (d && !first) {
      first = w.tick
      t.eq(d.x + d.w / 2, colX(10), 'the drop starts under the fitting')
      t.eq(d.y + d.h, UNDER_Y + 19, 'the drop starts where the swollen one hung')
      t.ok(d.harmful, 'a falling drop hurts')
    }
    if (d && d.state === 'splash' && !landed) {
      landed = w.tick
      t.eq(d.y + d.h, FLOOR_Y, 'it splashed on the floor')
      t.ok(!d.harmful, 'a splash is harmless')
    }
  }
  t.eq(swellAt.filter((k) => k < 100).join(','), Array.from({ length: 30 }, (_, i) => 70 + i).join(','), 'ticks spent swelling before the first drop')
  t.eq(first, 100, 'tick of the first drop')
  t.ok(landed > 120 && landed < 150, `the drop took ${landed - first} ticks to fall five tiles (wanted 20 to 50: time to step aside)`)
  t.ok(t.has(sink, 'fx', (ev) => ev.fx === 'drip'), 'the splash asks for particles')
  t.eq(drops(w).length, 0, 'no drop left between beats (tick 260)')
  toTick(w, 301, [], input)
  t.eq(w.entities.filter((e) => e.kind === 'drip_drop').length, 1, 'one drop per beat: the third is in the air at tick 301')
  t.notes.push(`drip: 30 tick tell, then ${landed - first} ticks of fall over five tiles`)
})

t.test('drip: props.every and props.phase set the beat', () => {
  const w = room('     1    2    3', '  @', {
    legend: { 1: { kind: 'drip', props: { every: 60 } }, 2: { kind: 'drip', props: { phase: 25 } }, 3: { kind: 'drip', props: { every: 10 } } },
  })
  const born = { 5: [], 10: [], 15: [] }
  const known = new Set()
  const input = t.makeInput()
  for (let i = 0; i < 240; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    for (const d of drops(w)) {
      if (known.has(d.id)) continue
      known.add(d.id)
      born[Math.floor(d.x / TILE)].push(w.tick)
    }
  }
  t.eq(born[5].join(','), '60,120,180,240', 'every: 60')
  t.eq(born[10].join(','), '25,125,225', 'phase: 25 is 25 ticks late')
  t.eq(born[15].join(','), '40,80,120,160,200,240', 'a beat shorter than the tell is stretched to 40, so the tell is never lost')
})

t.test('drip: the drop costs a pip, spray pops it, and it lands on the first thing that would hold Maxx', () => {
  // Maxx waits under the leak.
  let w = room('          d')
  let input = settle(w)
  t.place(w, colX(10), FLOOR_Y)
  t.until(w, [], (x) => x.player.pips < 3 || x.tick > 200, 300, input)
  t.eq(w.player.pips, 2, 'pips after standing under a leak for one beat')
  t.ok(w.tick > 100 && w.tick < 150, `hit at tick ${w.tick}`)
  t.ok(!drops(w).some((d) => d.state === 'fall'), 'the drop that hit him is spent')

  // Spray pops a drop in the air.
  w = room('          d')
  toTick(w, 105)
  const d = drops(w)[0]
  t.ok(t.spray(w, d), 'the water is used up')
  t.eq(d.state, 'splash', 'state after spray')
  t.ok(!d.harmful, 'a popped drop is harmless')
  t.eq(t.spray(w, d), false, 'water goes through a splash')
  t.eq(t.spray(w, t.find(w, 'drip')), false, 'water does nothing to the leak itself')

  // A catwalk under the leak catches the drop.
  w = room('          d', '  @', {}, ['', '          =', ''])
  toTick(w, 100)
  t.until(w, [], () => drops(w).some((x) => x.state === 'splash'), 100)
  t.eq(drops(w)[0].y + 10, 7 * TILE, 'the drop splashed on the catwalk')
})

t.test('drip: its box is the lane down to where its drops land, so the stain there is always drawn', () => {
  const pit = '#'.repeat(14) + '   ' + '#'.repeat(43)
  const w = t.makeWorld([CEIL, '     d    d    d', '', '          =', '', '  @', pit, pit])
  const [onFloor, onCatwalk, overPit] = t.all(w, 'drip')
  t.eq(`${onFloor.y},${onFloor.h},${onFloor.vars.dry}`, `${UNDER_Y},${FLOOR_Y - UNDER_Y},0`, 'over the floor: ceiling to floor')
  t.eq(`${onCatwalk.h},${onCatwalk.vars.dry}`, `${7 * TILE - UNDER_Y},0`, 'over a catwalk: ceiling to the catwalk')
  t.eq(`${overPit.y + overPit.h},${overPit.vars.dry}`, `${12 * TILE},1`, 'over a pit: to the bottom of the area, and no stain')
  t.eq(w.entities.filter((e) => e.kind === 'drip' && e.harmful).length, 0, 'the lane itself never hurts')
  // Every drop lands where its drip's lane says.
  toTick(w, 100)
  const landed = new Map()
  t.until(w, [], (x) => {
    for (const d of t.all(x, 'drip_drop')) if (d.state === 'splash' && !landed.has(d.id)) landed.set(d.id, d.y + d.h)
    return landed.size >= 2
  }, 120)
  t.eq([...landed.values()].sort().join(','), [7 * TILE, FLOOR_Y].sort().join(','), 'where the two drops splashed')
})

t.test('drip: oil in the lube pit, grimy water elsewhere, props.oil overrides', () => {
  const legend = { 1: { kind: 'drip', props: { oil: true } }, 2: { kind: 'drip', props: { oil: false } } }
  const look = (theme) => {
    const w = room('    d    1    2', '  @', { theme, legend })
    toTick(w, 101)
    return [...t.all(w, 'drip'), ...drops(w)].map((e) => e.vars.oil).join('')
  }
  t.eq(look('tunnel'), '010010', 'tunnel: leak d, 1, 2 then their drops')
  t.eq(look('lube'), '110110', 'lube')
})

/* ------------------------------------------------------------------ */
/* icicle                                                              */
/* ------------------------------------------------------------------ */

t.test('icicle: hangs until Maxx is under it, shakes 20 ticks, falls, shatters, leaves a stub', () => {
  const w = room('               i')
  const ice = t.find(w, 'icicle')
  t.eq(`${ice.w}x${ice.h}`, '16x28', 'size')
  t.eq(ice.y, UNDER_Y, 'it hangs from the ceiling')
  const input = settle(w)
  t.steps(w, [], 200, input)
  t.eq(ice.state, 'hang', 'state with Maxx far away')
  t.ok(!ice.harmful, 'a hanging icicle does not hurt')

  // Walk in from the left: it starts at 40 px, middle to middle.
  const cx = ice.x + ice.w / 2
  t.until(w, ['right'], () => ice.state !== 'hang', 600, input)
  const dx = cx - (w.player.x + MAXX_W / 2)
  t.eq(ice.state, 'shake', 'state when he comes under it')
  // It looks before he moves, so by the end of the tick he is one more step in.
  t.ok(dx <= 40 && dx > 40 - 8, `it began to shake with Maxx ${dx.toFixed(1)} px away (wanted just inside 40)`)
  const shakeTick = w.tick
  t.ok(!ice.harmful, 'a shaking icicle does not hurt yet')
  // He stops right there, to watch.
  t.until(w, [], () => ice.state !== 'shake', 60, input)
  t.eq(ice.state, 'fall', 'state after the shake')
  t.eq(w.tick - shakeTick, 20, 'ticks of shaking')
  t.ok(ice.harmful, 'a falling icicle hurts')
  const fallTick = w.tick
  t.until(w, [], () => ice.state !== 'fall', 120, input)
  t.eq(ice.state, 'shatter', 'state when it lands')
  t.eq(ice.y + ice.h, FLOOR_Y, 'it shattered on the floor')
  t.ok(!ice.harmful, 'shards are harmless')
  const fell = w.tick - fallTick
  t.until(w, [], () => ice.state !== 'shatter', 60, input)
  t.eq(ice.state, 'gone', 'state after the shards')
  t.eq(`${ice.x},${ice.y},${ice.w}x${ice.h}`, `${ice.spawnX},${ice.spawnY},16x6`, 'the stub is back at the ceiling')
  t.steps(w, ['left'], 30, input)
  t.steps(w, ['right'], 200, input)
  t.eq(ice.state, 'gone', 'it does not grow back')
  t.eq(w.player.pips, 3, 'nobody was hurt')
  t.notes.push(`icicle: 20 ticks of shaking, then ${fell} ticks to fall from a five tile ceiling to the floor`)
})

t.test('icicle: a runner is never hit, a dawdler is', () => {
  const row = '          i  i  i  i  i'
  // Full run under five of them.
  let w = room(row)
  let input = settle(w)
  t.steps(w, ['right'], 260, input)
  t.eq(w.player.pips, 3, 'pips after running the row')
  t.eq(t.all(w, 'icicle').map((e) => e.state).join(','), 'gone,gone,gone,gone,gone', 'all five came down behind him')
  // Six side by side are one long danger, but each still falls behind a runner.
  w = room('          iiiiii')
  input = settle(w)
  t.steps(w, ['right'], 260, input)
  t.eq(`${w.player.pips},${t.all(w, 'icicle').filter((e) => e.state === 'gone').length}`, '3,6', 'pips, and icicles down, after running under six in a row')
  // One over a parked dirty car falls through it (a dirty car is not a platform) and leaves it be.
  w = room('          i', '  @       c')
  const car = t.find(w, 'car')
  t.steps(w, [], 3)
  car.x = colX(10) - car.w / 2
  t.spray(w, t.find(w, 'icicle'))
  const hp = car.hp
  t.until(w, [], (x) => t.find(x, 'icicle').state === 'shatter', 100)
  t.eq(`${t.find(w, 'icicle').y + 28},${car.hp}`, `${FLOOR_Y},${hp}`, 'it broke on the floor; the car kept its dirt')

  // Stand under one.
  w = room(row)
  input = settle(w)
  t.place(w, colX(13), FLOOR_Y)
  const n = t.until(w, [], (x) => x.player.pips < 3, 200, input)
  t.ok(n > 20, `hit after ${n} ticks: never before the shake is over`)
  t.eq(w.player.pips, 2, 'standing under it costs a pip')
  t.eq(t.all(w, 'icicle')[1].state, 'shatter', 'it broke on him')

  // Standing under it but stepping away when it shakes is enough.
  w = room(row)
  input = settle(w)
  t.place(w, colX(13), FLOOR_Y)
  const ice = t.all(w, 'icicle')[1]
  t.until(w, [], () => ice.state === 'shake', 10, input)
  t.until(w, ['left'], () => ice.state === 'gone', 200, input)
  t.eq(w.player.pips, 3, 'he stepped aside when it shook')
})

t.test('icicle: one hit of spray drops it at once, and the prep gun can do it from a safe spot', () => {
  let w = room('               i')
  let ice = t.find(w, 'icicle')
  t.steps(w, [], 5)
  t.ok(t.spray(w, ice), 'the water is used up')
  t.eq(ice.state, 'fall', 'state after one hit')
  t.eq(w.stats.score, 50, 'score for clearing it')
  t.eq(t.spray(w, ice), false, 'water goes past a falling icicle')
  t.eq(w.stats.score, 50, 'no second score')

  // For real: a low ceiling, hold up and spray from outside its reach.
  w = t.makeWorld([CEIL, '               i', '', '  @', t.FLOOR, t.FLOOR])
  ice = t.find(w, 'icicle')
  const input = settle(w)
  t.place(w, ice.x + 8 - 72, FLOOR_Y)
  w.player.facing = 1
  const n = t.until(w, ['up', 'spray'], () => ice.state !== 'hang', 60, input)
  t.eq(ice.state, 'fall', 'spray from 72 px away brought it down, with no shake')
  t.ok(n > 0 && n < 30, `it took ${n} ticks of spraying`)
  t.until(w, ['up', 'spray'], () => ice.state === 'gone', 200, input)
  t.eq(w.player.pips, 3, 'he cleared it without a scratch')
})

t.test('icicle: a floor in between hides Maxx, touching it before it falls is harmless, and it breaks on a catwalk', () => {
  // He walks under a solid shelf that the icicle hangs over.
  let w = room('          i', '  @', {}, ['', '       XXXXXXX', ''])
  let ice = t.find(w, 'icicle')
  let input = settle(w)
  t.steps(w, ['right'], 100, input)
  t.ok(w.player.x > ice.x + 60, 'he walked past under the shelf')
  t.eq(ice.state, 'hang', 'it never saw him')

  // A low ceiling: he jumps up into it.
  w = t.makeWorld([CEIL, '      i', '', '  @', t.FLOOR, t.FLOOR])
  ice = t.find(w, 'icicle')
  input = settle(w)
  t.place(w, ice.x + 8, FLOOR_Y)
  const p = w.player
  const touching = () => p.y < ice.y + ice.h && p.x < ice.x + ice.w && p.x + p.w > ice.x
  const n = t.until(w, ['jump'], () => touching(), 19, input)
  t.ok(n > 0, 'he never reached it')
  t.eq(ice.state, 'shake', 'state when his head meets it')
  t.eq(p.pips, 3, 'touching a shaking icicle does not hurt')

  // Over a catwalk it shatters on the catwalk.
  w = room('          i', '  @', {}, ['', '        =====', ''])
  ice = t.find(w, 'icicle')
  t.steps(w, [], 3)
  t.spray(w, ice)
  t.until(w, [], () => ice.state === 'shatter', 100)
  t.eq(ice.y + ice.h, 7 * TILE, 'it broke on the catwalk')
})

t.test('icicle: one that falls down a pit is lost, but its stub stays on the ceiling', () => {
  const pit = '#'.repeat(9) + '   ' + '#'.repeat(48)
  const w = t.makeWorld([CEIL, '          i', '', '', '', '  @', pit, pit])
  const ice = t.find(w, 'icicle')
  t.steps(w, [], 3)
  t.spray(w, ice)
  t.until(w, [], () => ice.state === 'gone' || ice.dead, 200)
  t.ok(!ice.dead && w.entities.includes(ice), 'it was taken out of the world')
  t.eq(`${ice.state},${ice.x},${ice.y},${ice.h},${ice.harmful}`, `gone,${ice.spawnX},${ice.spawnY},6,false`, 'the stub')
  t.steps(w, [], 100)
  t.eq(ice.state, 'gone', 'and it stays')
})

/* ------------------------------------------------------------------ */
/* brush                                                               */
/* ------------------------------------------------------------------ */

t.test('brush: a rail that runs into a wall, a floor or a ceiling ends there', () => {
  const legend = {
    1: { kind: 'brush', props: { range: 6 } },
    2: { kind: 'brush', props: { axis: 'y', range: -8 } },
    3: { kind: 'brush', props: { range: -6 } },
    4: { kind: 'brush', props: { axis: 'y', range: 4, h: 32 } },
  }
  // A wall two tiles right of brush 1 and one left of brush 3; brush 4 hangs from row 6 and runs down to the floor.
  const w = room('', '  @   1   %    2     % 3', { legend }, ['', '                         4', '          %          %'])
  // In reading order brush 4 (row 7) comes first: pick them by their props.
  const brushes = t.all(w, 'brush')
  const [a, b, c, d] = [6, -8, -6, 4].map((r) => brushes.find((e) => e.props.range === r))
  const solid = (e) => {
    for (let x = Math.floor(e.x / TILE); x <= Math.floor((e.x + e.w - 1) / TILE); x++) for (let y = Math.floor(e.y / TILE); y <= Math.floor((e.y + e.h - 1) / TILE); y++) if (sim.TILE_INFO[String.fromCharCode(w.grid.t[y * w.grid.w + x])]?.solid) return true
    return false
  }
  const ext = { a: [Infinity, -Infinity], b: [Infinity, -Infinity], c: [Infinity, -Infinity], d: [Infinity, -Infinity] }
  for (let i = 0; i < 900; i++) {
    w.player.invuln = 999
    stepWorld(w, t.makeInput()([]))
    w.events.length = 0
    for (const [k, e, v] of [['a', a, a.x + a.w], ['b', b, b.y], ['c', c, c.x], ['d', d, d.y + d.h]]) ext[k] = [Math.min(ext[k][0], v), Math.max(ext[k][1], v)]
    for (const e of [a, b, c, d]) t.ok(!solid(e), `brush ${e.id} is inside a solid tile at tick ${w.tick}`)
  }
  t.eq(ext.a[1], 10 * TILE, 'x, to the right: it stops flush with the wall')
  t.eq(a.vars.run, 10 * TILE - (a.spawnX + a.w), 'vars.run is the rail it really has')
  t.eq(ext.b[0], 5 * TILE + 18, 'y, up: it stops with room for its trolley under the ceiling')
  t.eq(ext.c[0], 22 * TILE, 'x, to the left: it stops flush with the wall')
  t.eq(ext.d[1], FLOOR_Y, 'y, down: it stops on the floor')
  t.eq(`${a.harmful},${b.harmful}`, 'true,true', 'it still hurts')
})

t.test('brush: its rail is an entity of its own, behind Maxx, whose box holds the whole rail', () => {
  const legend = { 1: { kind: 'brush', props: { range: 10 } }, 2: { kind: 'brush', props: { axis: 'y', range: -2 } } }
  // Under a ceiling: an x rail hangs from rods, a y rail has a short rod over its top.
  const w = t.makeWorld([CEIL, '', '', '', '', '  @  1               2', t.FLOOR, t.FLOOR], { legend })
  const [a, b] = t.all(w, 'brush')
  const rails = t.all(w, 'brush_rail')
  t.eq(rails.length, 2, 'one rail per brush')
  const ra = rails.find((r) => r.id === a.vars.rail)
  const rb = rails.find((r) => r.id === b.vars.rail)
  t.ok(ra && rb, 'vars.rail names it')
  t.eq(`${ra.z},${ra.harmful},${ra.solid}`, '0,false,none', 'scenery, behind Maxx')
  const mid = a.spawnX + a.w / 2
  t.eq(`${ra.vars.axis},${ra.vars.x0},${ra.vars.x1},${ra.vars.y0}`, `0,${mid - 16},${mid + 10 * TILE + 16},${a.spawnY - 12}`, 'an x rail: its ends and its line')
  t.eq(`${ra.vars.h0},${ra.vars.h1}`, `${5 * TILE},${5 * TILE}`, 'held up by rods to the ceiling')
  t.ok(ra.x <= ra.vars.x0 - 4 && ra.x + ra.w >= ra.vars.x1 + 4 && ra.y <= ra.vars.h0 && ra.y + ra.h >= ra.vars.y0 + 3, 'its box holds the rail, its stops and its rods')
  t.eq(`${rb.vars.axis},${rb.vars.y0},${rb.vars.y1},${rb.vars.h0}`, `1,${b.spawnY - 2 * TILE - 12 - 16},${FLOOR_Y},${5 * TILE}`, 'a y rail from the floor up past the trolley, and a rod to the ceiling')
  const open = t.flat(['  @  1    2'], { legend })
  const legs = t.all(open, 'brush_rail')
  t.eq(`${legs[0].vars.h0},${legs[0].vars.h1},${legs[1].vars.h0}`, `${FLOOR_Y},${FLOOR_Y},-1`, 'with no ceiling: an x rail stands on legs, a y rail on the floor')
  t.steps(w, [], 400)
  t.ok(!ra.dead && !rb.dead, 'rails stay')
})

t.test('brush: rides its rail to and fro at props.speed, resting at each end, on either axis', () => {
  const legend = {
    1: { kind: 'brush' },
    2: { kind: 'brush', props: { axis: 'y', range: -2, speed: 120, wait: 0, h: 96 } },
    3: { kind: 'brush', props: { range: -2, start: 0.5 } },
  }
  const w = t.flat(['  @     1         2         3'], { legend })
  const [a, b, c] = t.all(w, 'brush')
  t.eq(`${a.w}x${a.h}`, '28x64', 'default size')
  t.eq(a.y + a.h, FLOOR_Y, 'it stands on the floor of its tile')
  t.eq(`${b.w}x${b.h}`, '28x96', 'props.h')
  t.ok(a.harmful && b.harmful, 'it hurts')
  const input = t.makeInput()
  const seen = { ax: [Infinity, -Infinity], by: [Infinity, -Infinity], cx: [Infinity, -Infinity] }
  let rest = 0
  let turns = 0
  for (let i = 0; i < 700; i++) {
    w.player.invuln = 999
    const x = a.x
    const dir = a.vars.dir
    stepWorld(w, input([]))
    w.events.length = 0
    // The step that reaches an end may be a short one.
    if (a.x === x) rest++
    else if (a.vars.wait === 0) t.near(Math.abs(a.x - x), 1, 1e-6, 'pixels a tick at speed 60')
    else t.ok(Math.abs(a.x - x) <= 1 + 1e-6, 'the last step onto an end is no longer than the others')
    if (a.vars.dir !== dir) turns++
    seen.ax = [Math.min(seen.ax[0], a.x), Math.max(seen.ax[1], a.x)]
    seen.by = [Math.min(seen.by[0], b.y), Math.max(seen.by[1], b.y)]
    seen.cx = [Math.min(seen.cx[0], c.x), Math.max(seen.cx[1], c.x)]
    t.eq(a.y, a.spawnY, 'an x brush never leaves its line')
    t.eq(b.x, b.spawnX, 'a y brush never leaves its line')
    if (i === 0) t.near(c.x, c.spawnX - TILE, 1.01, 'props.start 0.5 begins half way along')
  }
  t.eq(seen.ax[0], a.spawnX, 'x brush: left end is where it was placed')
  t.near(seen.ax[1], a.spawnX + 3 * TILE, 1e-6, 'x brush: right end, default range 3 tiles')
  t.near(seen.by[0], b.spawnY - 2 * TILE, 1e-6, 'y brush: range -2 goes up two tiles')
  t.eq(seen.by[1], b.spawnY, 'y brush: bottom end is where it was placed')
  t.near(seen.cx[0], c.spawnX - 2 * TILE, 1e-6, 'range -2 on x goes left')
  t.ok(turns >= 5, `it turned ${turns} times in 700 ticks`)
  t.near(rest, turns * 20, 21, 'ticks at rest: 20 at each end')
})

t.test('brush: it hurts, water does nothing to it, and it soaks the water up', () => {
  const w = t.flat(['  @     1      c'], { legend: { 1: { kind: 'brush', props: { range: 0 } } } })
  const brush = t.find(w, 'brush')
  const car = t.find(w, 'car')
  car.vars.speed = 0
  const input = settle(w)
  const dirt = car.hp
  const seen = t.steps(w, ['spray'], 120, input)
  t.eq(brush.hp, 1, 'hp after two seconds of spray')
  t.ok(!brush.dead && brush.harmful, 'still there, still dangerous')
  t.eq(car.hp, dirt, 'the car behind the brush stayed dirty: the brush took the water')
  t.ok(t.has(seen, 'fx', (ev) => ev.fx === 'foam'), 'foam flies off it')
  t.eq(w.stats.score, 0, 'no score for spraying it')
  t.until(w, ['right'], (x) => x.player.pips < 3, 200, input)
  t.eq(w.player.pips, 2, 'walking into it costs a pip')
  t.ok(w.player.vx < 0, 'knocked back away from it')
})

t.test('brush: keeps time off screen, so a pair stays in step', () => {
  const far = ' '.repeat(50)
  const legend = { 1: { kind: 'brush', props: { range: 4 } } }
  const w = t.flat([`  @     1${far}1`], { legend })
  const [near, distant] = t.all(w, 'brush')
  t.steps(w, [], 333)
  t.ok(distant.x - w.camera.x > 1200, 'the second one is far off screen')
  t.eq(distant.vars.t, near.vars.t, 'place on the rail')
  t.eq(distant.vars.dir, near.vars.dir, 'direction')
})

t.test('brush: a default one can be jumped, and one that lifts can be run under', () => {
  // Over a brush that stands still in the middle of the floor.
  let w = t.flat(['  @        1'], { legend: { 1: { kind: 'brush', props: { range: 0 } } } })
  let brush = t.find(w, 'brush')
  let input = settle(w)
  t.until(w, ['right'], (x) => x.player.x + MAXX_W > brush.x - 40, 300, input)
  t.until(w, ['right', 'jump'], (x) => x.player.onGround && x.player.x > brush.x + brush.w, 120, input)
  t.eq(w.player.pips, 3, 'a full running jump clears a 64 px brush')

  // Under one that rides up three tiles: wait for the gap, then run.
  w = t.flat(['  @        1'], { legend: { 1: { kind: 'brush', props: { axis: 'y', range: -3 } } } })
  brush = t.find(w, 'brush')
  input = settle(w)
  t.until(w, ['right'], (x) => x.player.x + MAXX_W > brush.x - 30, 300, input)
  t.until(w, [], () => brush.vars.dir > 0 && FLOOR_Y - (brush.y + brush.h) > MAXX_H + 8, 400, input)
  t.until(w, ['right'], (x) => x.player.x > brush.x + brush.w + 8, 120, input)
  t.eq(w.player.pips, 3, 'he ran under it while it was up')
})

/* ------------------------------------------------------------------ */
/* jet                                                                 */
/* ------------------------------------------------------------------ */

t.test('jet: off 80, sputter 20, on 50, and it only hurts while on', () => {
  const w = room('          j')
  const jet = t.find(w, 'jet')
  const input = t.makeInput()
  const seq = []
  for (let i = 0; i < 300; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    const last = seq[seq.length - 1]
    if (!last || last.state !== jet.state) seq.push({ state: jet.state, from: w.tick, n: 1 })
    else last.n++
    t.eq(jet.harmful, jet.state === 'on', `harmful at tick ${w.tick} (${jet.state})`)
    if (jet.state === 'sputter') t.eq(jet.stateT, w.tick % 150 - 79, 'stateT counts the tell')
    if (jet.state !== 'on') t.eq(`${jet.h},${jet.vars.len}`, '0,0', 'no column unless on')
  }
  t.eq(seq.map((s) => `${s.state}@${s.from}x${s.n}`).join(' '), 'off@1x79 sputter@80x20 on@100x50 off@150x80 sputter@230x20 on@250x50 off@300x1', 'the beat')
})

t.test('jet: the column shoots from the nozzle to the first solid tile, at most props.len tiles, down or up', () => {
  const legend = { 1: { kind: 'jet', props: { len: 2 } }, 2: { kind: 'jet', props: { dir: 'up' } }, 3: { kind: 'jet', props: { dir: 'up', len: 3 } } }
  const w = room('     j    1', '  @            2    3', { legend }, ['', '     X', ''])
  const [down, short, up, upShort] = t.all(w, 'jet')
  const mouth = UNDER_Y + 12
  t.eq(`${down.vars.mx},${down.vars.my},${down.vars.up}`, `${colX(5)},${mouth},0`, 'a ceiling nozzle: its mouth is 12 px under the ceiling')
  t.eq(`${up.vars.mx},${up.vars.my},${up.vars.up}`, `${colX(15)},${FLOOR_Y - 12},1`, 'a floor nozzle: its mouth is 12 px over the floor')
  toTick(w, 100)
  t.eq(`${down.state},${down.y},${down.h}`, `on,${mouth},24`, 'first tick on: 24 px of column')
  t.eq(`${up.y},${up.h}`, `${FLOOR_Y - 12 - 24},24`, 'an up jet grows upward from its mouth')
  toTick(w, 101)
  t.eq(down.h, 48, 'second tick: 48 px')
  toTick(w, 120)
  t.eq(`${down.x},${down.w}`, `${colX(5) - 7},14`, 'the column is 14 px wide, centred on the nozzle')
  t.eq(`${down.y + down.h},${down.vars.full},${down.vars.capped}`, `${7 * TILE},${7 * TILE - mouth},0`, 'stopped by the block in row 7')
  t.eq(`${short.h},${short.vars.capped}`, `${2 * TILE - 12},1`, 'len 2 ends two tiles under the ceiling, in mid-air')
  t.eq(`${up.y},${up.vars.capped}`, `${UNDER_Y},0`, 'the up jet reaches the ceiling')
  t.eq(`${upShort.y},${upShort.vars.capped}`, `${FLOOR_Y - 3 * TILE},1`, 'up with len 3 ends three tiles over the floor')
  toTick(w, 150)
  t.eq(`${down.state},${down.h}`, 'off,0', 'the column is gone the tick it shuts off')
})

t.test('jet: standing in it is safe through off and sputter, and costs a pip the moment it fires', () => {
  const w = room('          j')
  const input = settle(w)
  t.place(w, colX(10), FLOOR_Y)
  toTick(w, 99, [], input)
  t.eq(w.player.pips, 3, 'pips at the end of the tell')
  const seen = toTick(w, 112, [], input)
  t.eq(w.player.pips, 2, 'pips once the column reached him')
  t.ok(t.has(seen, 'sfx', (ev) => ev.id === 'sizzle'), 'the jet is heard when it fires')
  // The column takes a few ticks to come down five tiles: the floor gets a little longer than the ceiling.
  const hitTick = w.tick - (w.player.stateT - 1)
  t.ok(hitTick >= 104 && hitTick <= 106, `the column reached his head at tick ${hitTick}`)
})

t.test('jet: props.phase makes a wave, and the tell is seen and heard', () => {
  const legend = { 1: { kind: 'jet', props: { phase: 50 } }, 2: { kind: 'jet', props: { phase: 100 } }, 3: { kind: 'jet', props: { off: 30, on: 10, phase: 7 } } }
  const w = room('     j  1  2        3', '  @', { legend })
  const [a, b, c, d] = t.all(w, 'jet')
  const input = t.makeInput()
  const on = { a: [], b: [], c: [], d: [] }
  const sink = []
  for (let i = 0; i < 460; i++) {
    stepWorld(w, input([]))
    for (const ev of w.events) sink.push({ ...ev, tick: w.tick })
    w.events.length = 0
    if (w.tick > 150) t.eq([a, b, c].filter((j) => j.state === 'on').length, 1, `jets of the wave on at tick ${w.tick}`)
    for (const [k, j] of Object.entries({ a, b, c, d })) if (j.state === 'on' && j.stateT === 1) on[k].push(w.tick)
  }
  t.eq(on.a.join(','), '100,250,400', 'phase 0 fires')
  t.eq(on.b.join(','), '150,300,450', 'phase 50 fires 50 ticks later')
  t.eq(on.c.join(','), '50,200,350', 'phase 100 fires 100 ticks later (50 before)')
  t.eq(on.d.slice(0, 3).join(','), '57,117,177', 'off 30, on 10, phase 7')
  const pops = sink.filter((ev) => ev.type === 'sfx' && ev.id === 'sizzle').map((ev) => ev.tick)
  t.ok(pops.includes(80) && pops.includes(88) && pops.includes(96), `the sputter is heard (pops at ${pops.slice(0, 8).join(',')})`)
})

t.test('jet: down onto a catwalk, a lift or a clean car roof it stops there; up, it passes through a catwalk', () => {
  const legend = { L: { kind: 'lift', props: { dx: 0, dy: 0, w: 3 } }, J: { kind: 'jet', props: { dir: 'up' } } }
  const w = room('   j    j    j', ' @                J', { legend }, ['', '  ===           ===', '        L'])
  const [cat, lift, car, up] = t.all(w, 'jet')
  const c = sim.spawn(w, 'car', colX(13), FLOOR_Y, { variant: 'compact' })
  t.spray(w, c, 999)
  t.eq(`${c.state},${c.solid}`, 'clean,top', 'the car is washed')
  const input = settle(w)
  // Maxx waits under the catwalk, in line with the jet over it.
  t.place(w, colX(3), FLOOR_Y)
  const mouth = UNDER_Y + 12
  while (w.tick < 125) {
    c.x = colX(13) - c.w / 2
    c.y = FLOOR_Y - c.h
    stepWorld(w, input([]))
    w.events.length = 0
  }
  t.eq(`${cat.state},${cat.vars.stop},${cat.vars.len},${cat.vars.end}`, `on,${7 * TILE - mouth},${7 * TILE - mouth},1`, 'down onto the catwalk')
  t.eq(`${lift.vars.stop},${lift.vars.end}`, `${8 * TILE - mouth},1`, 'down onto the lift')
  t.eq(`${car.vars.stop},${car.vars.end}`, `${FLOOR_Y - c.h - mouth},1`, 'down onto the clean car roof')
  t.eq(`${car.vars.full},${car.vars.capped}`, `${FLOOR_Y - mouth},0`, 'the tiles alone would take it to the floor (the cold wax is drawn there)')
  t.eq(`${up.vars.stop},${up.y}`, `${FLOOR_Y - 12 - UNDER_Y},${UNDER_Y}`, 'up: through the catwalk, to the ceiling')
  t.eq(w.player.pips, 3, 'under the catwalk he was kept dry')
  // On the catwalk, under the same jet, he is in the column.
  t.place(w, colX(3), 7 * TILE)
  toTick(w, 130, [], input)
  t.eq(w.player.pips, 2, 'standing on the catwalk under it costs a pip')
})

t.test('jet: the column never runs past the edge of the area', () => {
  const pit = '#'.repeat(4) + ' '.repeat(16) + '#'.repeat(40)
  const legend = { 1: { kind: 'jet', props: { len: 30 } } }
  const w = t.makeWorld([CEIL, '     j    1', '', '', '', '  @', pit, pit], { legend })
  const [short, long] = t.all(w, 'jet')
  toTick(w, 130)
  t.eq(`${short.vars.full},${short.vars.capped}`, `${6 * TILE - 12},1`, 'len 6 over a pit: it ends in mid-air')
  t.eq(`${long.vars.full},${long.vars.capped},${long.y + long.h}`, `${12 * TILE - (UNDER_Y + 12)},1,${12 * TILE}`, 'len 30: cut off at the bottom of the area')
})

/* ------------------------------------------------------------------ */
/* blower                                                              */
/* ------------------------------------------------------------------ */

const BLOW = (props) => ({ 1: { kind: 'blower', props } })

t.test('blower: its box is the wind zone, in front of the machine, standing on the machine floor', () => {
  let w = t.flat(['  @            1'], { legend: BLOW({}) })
  let b = t.find(w, 'blower')
  t.eq(`${b.x},${b.y},${b.w}x${b.h}`, `${11 * TILE},${FLOOR_Y - 3 * TILE},${4 * TILE}x${3 * TILE}`, 'default: 4 x 3 tiles to the left of the machine in column 15')
  t.eq(`${b.vars.force},${b.facing}`, '-120,-1', 'default force blows left')
  t.ok(!b.harmful, 'it never hurts')
  w = t.flat(['  @            1'], { legend: BLOW({ force: 90, w: 6, h: 2 }) })
  b = t.find(w, 'blower')
  t.eq(`${b.x},${b.y},${b.w}x${b.h}`, `${16 * TILE},${FLOOR_Y - 2 * TILE},${6 * TILE}x${2 * TILE}`, 'a positive force puts the zone to the right')
  t.eq(b.facing, 1, 'facing')
})

t.test('blower: pushes Maxx by its force, on the ground and in the air, never into a wall, never hurts', () => {
  const w = t.flat(['            X             1'], { legend: BLOW({ w: 16, h: 6 }) })
  const b = t.find(w, 'blower')
  const input = settle(w)
  // Standing: 120 px/s is 2 px a tick.
  t.place(w, b.x + 400, FLOOR_Y)
  let x0 = w.player.x
  t.steps(w, [], 30, input)
  t.near(w.player.x, x0 - 60, 0.01, 'x after 30 ticks standing in a 120 wind')
  // In the air too.
  t.place(w, b.x + 400, FLOOR_Y - 120)
  x0 = w.player.x
  t.steps(w, [], 10, input)
  t.ok(!w.player.onGround, 'still falling')
  t.near(w.player.x, x0 - 20, 0.01, 'x after 10 ticks falling through it')
  // Left alone he is blown against the wall and held there, not in it.
  t.steps(w, [], 600, input)
  t.eq(w.player.x, 13 * TILE, 'blown flush against the wall')
  t.eq(w.player.pips, 3, 'ten seconds of wind and not a scratch')
  // Above the zone there is no wind.
  t.place(w, b.x + 300, b.y - 4)
  w.player.vy = 0
  x0 = w.player.x
  t.steps(w, [], 1, input)
  t.eq(w.player.x, x0, 'no push with his feet above the zone')
})

t.test('blower: a strong one cuts a full run to a crawl, a weak one only shortens a jump', () => {
  // Headway over two seconds at a full run, in px/s.
  const headway = (force) => {
    const w = t.flat(['  @                                           1'], { legend: BLOW({ force, w: 40, h: 6 }) })
    const input = settle(w)
    t.steps(w, ['right'], 60, input)
    const x0 = w.player.x
    t.steps(w, ['right'], 120, input)
    return (w.player.x - x0) / 2
  }
  const calm = headway(0)
  const weak = headway(-60)
  const strong = headway(-180)
  t.near(calm, TUNING.runSpeed, 1, 'run speed with no wind')
  t.near(weak, TUNING.runSpeed - 60, 1, 'against a weak blower')
  t.near(strong, TUNING.runSpeed - 180, 1, 'against a strong blower: a crawl')
  t.ok(strong > 20 && strong < 50, `strong headway ${strong.toFixed(0)} px/s is still forward`)

  // A full running jump, measured take-off to landing.
  const jump = (force) => {
    // The machine stands upwind: on the far right for a headwind, behind him for a tailwind.
    const w = t.flat([force > 0 ? '1 @' : '  @                                           1'], { legend: BLOW({ force, w: 40, h: 8 }) })
    const input = settle(w)
    t.steps(w, ['right'], 60, input)
    const x0 = w.player.x
    t.steps(w, ['right', 'jump'], 2, input)
    t.until(w, ['right', 'jump'], (x) => x.player.onGround, 120, input)
    return (w.player.x - x0) / TILE
  }
  const j0 = jump(0)
  const j60 = jump(-60)
  const j180 = jump(-180)
  const tail = jump(60)
  t.near(j0, 5.6, 0.3, 'running jump with no wind, in tiles')
  t.ok(j60 < j0 - 1 && j60 > 3.5, `a weak headwind shortens it to ${j60.toFixed(2)} tiles`)
  t.ok(j180 < 1.5 && j180 > 0, `a strong headwind leaves ${j180.toFixed(2)} tiles`)
  t.ok(tail > j0 + 1, `a weak tailwind stretches it to ${tail.toFixed(2)} tiles`)
  t.notes.push(`blower: run headway ${calm.toFixed(0)} / ${weak.toFixed(0)} / ${strong.toFixed(0)} px/s at force 0 / -60 / -180; running jump ${j0.toFixed(2)} / ${j60.toFixed(2)} / ${j180.toFixed(2)} tiles, ${tail.toFixed(2)} with a 60 tailwind`)
})

t.test('blower: bends the prep gun water', () => {
  // How far the water gets, sprayed level from a standstill, in px from his middle.
  const reach = (force) => {
    const w = t.flat(['  @                1'], { legend: BLOW({ force, w: 16, h: 6 }) })
    const b = t.find(w, 'blower')
    const input = settle(w)
    t.place(w, b.x + 3 * TILE, FLOOR_Y)
    // Hold him still: this measures the water, not him.
    const x = w.player.x
    let far = 0
    for (let i = 0; i < 60; i++) {
      w.player.x = x
      stepWorld(w, input(['spray']))
      w.events.length = 0
      for (const d of w.droplets) far = Math.max(far, d.x - (x + MAXX_W / 2))
    }
    return far
  }
  const calm = reach(0)
  const head = reach(-180)
  const weak = reach(-60)
  const tail = reach(180)
  t.ok(calm > 4.5 * TILE, `reach with no wind ${calm.toFixed(0)} px`)
  t.ok(head < calm - 40 && head > 2.5 * TILE, `a strong headwind cuts it to ${head.toFixed(0)} px`)
  t.ok(weak < calm - 8 && weak > head, `a weak one to ${weak.toFixed(0)} px`)
  t.ok(tail > calm + 40, `a tailwind carries it to ${tail.toFixed(0)} px`)
  t.notes.push(`blower: water reaches ${calm.toFixed(0)} px in calm air, ${weak.toFixed(0)} into force -60, ${head.toFixed(0)} into -180, ${tail.toFixed(0)} with +180 behind it`)
})

t.test('blower: never pushes him past the edge of the area, or out of a locked arena', () => {
  // A dryer near the left edge of the area, blowing off it.
  let w = t.flat(['  @  1'], { legend: BLOW({ force: -180, w: 6, h: 3 }) })
  let input = t.makeInput()
  let lowest = Infinity
  t.until(w, [], (x) => {
    lowest = Math.min(lowest, x.player.x)
    return false
  }, 200, input)
  t.eq(lowest, 0, 'the furthest left he ever was, at the end of a tick')
  // An arena whose left wall the wind blows at.
  w = t.flat(['  @                 1'], { legend: BLOW({ force: -180, w: 12, h: 3 }) })
  input = settle(w)
  t.place(w, 12 * TILE, FLOOR_Y)
  sim.lockCamera(w, 10 * TILE, 10 * TILE + 640)
  lowest = Infinity
  t.until(w, [], (x) => {
    lowest = Math.min(lowest, x.player.x)
    return false
  }, 120, input)
  t.eq(lowest, 10 * TILE, 'held at the arena wall')
})

t.test('blower: zones that overlap add up, and one blows him off a lift he stands still on', () => {
  const leg = { 1: { kind: 'blower', props: { force: -120, w: 12, h: 3 } }, 2: { kind: 'blower', props: { force: -120, w: 16, h: 3 } } }
  let w = t.flat(['  @                1   2'], { legend: leg })
  let input = settle(w)
  t.place(w, 15 * TILE, FLOOR_Y)
  t.steps(w, ['right'], 30, input)
  const x0 = w.player.x
  t.steps(w, ['right'], 60, input)
  t.near(w.player.x - x0, TUNING.runSpeed - 240, 2, 'px gained in a second running into two 120s')
  // A lift standing in a dryer's wind.
  const leg2 = { L: { kind: 'lift', props: { dx: 0, dy: 0, w: 3 } }, 1: { kind: 'blower', props: { force: -60, w: 17, h: 8 } } }
  w = t.makeWorld(['', '', '', '', '', '     L             1', '', '', '  @', t.FLOOR, t.FLOOR], { legend: leg2 })
  const lift = t.find(w, 'lift')
  input = t.makeInput()
  t.steps(w, [], 3, input)
  t.place(w, lift.x + lift.w - 16, lift.y)
  t.steps(w, [], 2, input)
  t.eq(w.player.ridingId, lift.id, 'on the lift')
  const n = t.until(w, [], (x) => x.player.ridingId !== lift.id, 200, input)
  t.ok(n > 0 && n < 100, `blown off the lift after ${n} ticks`)
  t.eq(w.player.pips, 3, 'and not hurt')
})

t.test('blower: gusts blow for props.on, rest for props.off, and spin up for the last 20 ticks', () => {
  const w = t.flat(['  @                1'], { legend: BLOW({ on: 60, off: 90, phase: 10, w: 10, h: 4 }) })
  const b = t.find(w, 'blower')
  const input = settle(w)
  toTick(w, 9, [], input)
  const seq = []
  let pushed = 0
  for (let i = 0; i < 300; i++) {
    t.place(w, b.x + 100, FLOOR_Y)
    const x0 = w.player.x
    stepWorld(w, input([]))
    w.events.length = 0
    const last = seq[seq.length - 1]
    if (!last || last.state !== b.state) seq.push({ state: b.state, from: w.tick, n: 1 })
    else last.n++
    const moved = w.player.x - x0
    t.near(moved, b.state === 'blow' ? -2 : 0, 1e-9, `push at tick ${w.tick} (${b.state})`)
    if (moved) pushed++
    if (b.state === 'rev') t.eq(b.stateT, ((w.tick - 10) % 150) - 129, 'stateT counts the spin-up')
  }
  t.eq(seq.map((s) => `${s.state}@${s.from}x${s.n}`).join(' '), 'blow@10x60 calm@70x70 rev@140x20 blow@160x60 calm@220x70 rev@290x20', 'the gusts')
  t.eq(pushed, 120, 'ticks he was pushed')
})

/* ------------------------------------------------------------------ */
/* All of them together                                                */
/* ------------------------------------------------------------------ */

t.test('every kind is registered, and the sandbox critter corner runs them', () => {
  for (const kind of ['drip', 'drip_drop', 'icicle', 'brush', 'jet', 'blower']) t.ok(sim.hasBehavior(kind), `${kind} is not registered`)
  const w = sim.createWorld(levels.sandboxLevel, { session: t.freshSession(), checkpoint: { areaId: 'main', x: 362 * TILE, y: 10 * TILE } })
  t.steps(w, [], 400)
  const kinds = new Set(w.entities.map((e) => e.kind))
  for (const kind of ['drip', 'icicle', 'brush', 'jet']) t.ok(kinds.has(kind), `no ${kind} in the sandbox corner`)
  t.ok(t.find(w, 'jet').vars.full > 100, 'the sandbox jet reaches the floor')
})

function hazardLevel() {
  const legend = {
    1: { kind: 'drip', props: { every: 70 } },
    2: { kind: 'drip', props: { oil: true, phase: 30 } },
    3: { kind: 'jet', props: { phase: 40 } },
    4: { kind: 'jet', props: { dir: 'up', off: 40, on: 30 } },
    5: { kind: 'brush', props: { range: 4, speed: 90 } },
    6: { kind: 'brush', props: { axis: 'y', range: -3 } },
    7: { kind: 'blower', props: { force: -150, w: 6, h: 4 } },
    8: { kind: 'blower', props: { force: 100, w: 5, h: 5, on: 50, off: 60 } },
  }
  return t.makeLevel([CEIL, '      1 2  i i i   3   j        i   1', '', '', '', '  @       5       6     4     7 8        c', t.FLOOR, t.FLOOR], { legend })
}

/** A busy, repeatable player: runs right mostly, jumps, sprays, aims, turns back now and then. */
function busy(seed) {
  let s = seed >>> 0
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
  let held = []
  let left = 0
  return () => {
    if (left-- <= 0) {
      left = 4 + Math.floor(next() * 30)
      held = []
      const r = next()
      if (r < 0.62) held.push('right')
      else if (r < 0.8) held.push('left')
      if (next() < 0.35) held.push('jump')
      if (next() < 0.5) held.push('spray')
      const a = next()
      if (a < 0.2) held.push('up')
      else if (a < 0.3) held.push('down')
    }
    return held
  }
}

t.test('determinism: the same inputs give the same world, tick for tick, with every hazard at work', () => {
  const play = (seed) => {
    const w = sim.createWorld(hazardLevel(), { session: t.freshSession({ lives: 9 }), seed: 99 })
    const input = t.makeInput()
    const pick = busy(seed)
    const hashes = []
    const seen = new Set()
    for (let i = 0; i < 3000; i++) {
      // Keep him going so the whole room is played, not just the first hit.
      if (w.status !== 'play') break
      if (i % 200 === 0) w.player.pips = 3
      const pips = w.player.pips
      stepWorld(w, input(pick()))
      w.events.length = 0
      hashes.push(worldHash(w))
      for (const e of w.entities) seen.add(`${e.kind}:${e.state}`)
      // Harm only in the states whose picture is the danger.
      for (const e of w.entities) {
        const want = { drip: false, brush_rail: false, blower: false, brush: true, drip_drop: e.state === 'fall', icicle: e.state === 'fall', jet: e.state === 'on' }[e.kind]
        if (want !== undefined && e.harmful !== want) throw new Error(`${e.kind} in state ${e.state} has harmful ${e.harmful} at tick ${w.tick}`)
        if (e.kind === 'jet' && (e.state === 'on') !== e.h > 0 && e.vars.stop > 0) throw new Error(`jet column ${e.h} px in state ${e.state} at tick ${w.tick}`)
      }
      // A lost pip always has something you could see touching him (give or take the push of a dryer later in the same tick).
      const p = w.player
      const m = 4
      if (p.pips < pips && w.status === 'play') {
        const by = w.entities.find((e) => ['drip_drop', 'icicle', 'jet', 'brush', 'car', 'clod'].includes(e.kind) && e.x <= p.x + p.w + m && e.x + e.w >= p.x - m && e.y <= p.y + p.h && e.y + e.h >= p.y)
        if (!by) throw new Error(`Maxx lost a pip at tick ${w.tick} with nothing touching him`)
      }
      for (const e of w.entities) for (const k of ['x', 'y', 'w', 'h', 'vx', 'vy']) if (!Number.isFinite(e[k])) throw new Error(`${e.kind}.${k} is ${e[k]} at tick ${w.tick}`)
      if (!Number.isFinite(w.player.x) || !Number.isFinite(w.player.y)) throw new Error(`Maxx is at ${w.player.x}, ${w.player.y}`)
    }
    return { hashes, seen }
  }
  const a = play(7)
  const b = play(7)
  t.eq(a.hashes.length, b.hashes.length, 'ticks played')
  for (let i = 0; i < a.hashes.length; i++) if (a.hashes[i] !== b.hashes[i]) throw new Error(`the two runs differ at tick ${i + 1}`)
  const c = play(8)
  t.ok(c.hashes[c.hashes.length - 1] !== a.hashes[a.hashes.length - 1], 'other inputs give another world')
  for (const want of ['drip:swell', 'drip_drop:fall', 'drip_drop:splash', 'icicle:shake', 'icicle:fall', 'icicle:gone', 'jet:sputter', 'jet:on', 'brush:spin', 'blower:blow', 'blower:rev']) {
    t.ok(a.seen.has(want) || c.seen.has(want), `the run never saw ${want}`)
  }
  t.notes.push(`determinism: ${a.hashes.length} ticks twice over, identical; final hash ${a.hashes[a.hashes.length - 1]}`)
})

/* ------------------------------------------------------------------ */
/* The dev room, played by a careful player                            */
/* ------------------------------------------------------------------ */

/**
 * A player who never takes a risk: before each move it tries the move on a copy of the world
 * and then stands still there for STAND ticks (longer than any hazard's beat), and only makes
 * the move if nothing hurt him. It prefers the move that gets furthest. If it reaches the goal
 * without a scratch, every trap in the room has a safe way through that can be waited for.
 */
const STAND = 240
const MOVES = [
  { name: 'jump+run48', plan: [[['right', 'jump'], 'land'], [['right'], 48]] },
  { name: 'jump+run24', plan: [[['right', 'jump'], 'land'], [['right'], 24]] },
  { name: 'jump+run8', plan: [[['right', 'jump'], 'land'], [['right'], 8]] },
  { name: 'run48', plan: [[['right'], 48]] },
  { name: 'jump', plan: [[['right', 'jump'], 'land']] },
  { name: 'run24', plan: [[['right'], 24]] },
  { name: 'run8', plan: [[['right'], 8]] },
  { name: 'wait', plan: [[[], 10]] },
  { name: 'back', plan: [[['left'], 10]] },
]

/** Play a plan on a world; then, if `stand`, stand still that long. False if he was hurt or lost. */
function tryPlan(w, prevHeld, plan, stand) {
  const input = t.makeInput()
  input(prevHeld)
  const pips = w.player.pips
  let held = prevHeld
  const tick = (h) => {
    held = h
    stepWorld(w, input(h))
    w.events.length = 0
    return w.player.pips >= pips && (w.status === 'play' || w.status === 'clear')
  }
  for (const [h, n] of plan) {
    if (n === 'land') {
      let left = false
      for (let i = 0; i < 100 && !(left && w.player.onGround); i++) {
        if (!tick(h)) return false
        if (!w.player.onGround) left = true
        if (w.status === 'clear') return { held }
      }
    } else {
      for (let i = 0; i < n; i++) {
        if (!tick(h)) return false
        if (w.status === 'clear') return { held }
      }
    }
  }
  for (let i = 0; i < stand && w.status === 'play'; i++) if (!tick([])) return false
  return { held }
}

/** The careful player on a level, from its start. Returns how it ended, or throws where it got stuck. */
function carefulRun(level) {
  let w = sim.createWorld(level, { session: t.freshSession(), seed: 4 })
  let held = []
  const used = {}
  let best = w.player.x
  let stuck = 0
  while (w.status === 'play' && w.tick < 20000) {
    let chosen = null
    for (const move of MOVES) {
      if (!tryPlan(structuredClone(w), held, move.plan, STAND)) continue
      // The move itself, without the standing still after it.
      const real = structuredClone(w)
      const done = tryPlan(real, held, move.plan, 0)
      if (!done) continue
      if (move.name !== 'wait' && move.name !== 'back' && real.player.x <= w.player.x + 1 && real.status !== 'clear') continue
      chosen = { move, world: real, held: done.held }
      break
    }
    if (!chosen) throw new Error(`no safe move at column ${(w.player.x / TILE).toFixed(1)}, tick ${w.tick}`)
    used[chosen.move.name] = (used[chosen.move.name] ?? 0) + 1
    w = chosen.world
    held = chosen.held
    if (w.player.x > best + 1) {
      best = w.player.x
      stuck = 0
    } else if ((stuck += 1) > 120) {
      throw new Error(`no progress for 120 moves at column ${(w.player.x / TILE).toFixed(1)}`)
    }
  }
  return { w, used }
}

t.test('dev-hazards: a careful player gets from the start to the goal without losing a pip', () => {
  const level = levels.levelById('dev-hazards')
  t.ok(level, 'levelById does not find dev-hazards')
  t.eq(JSON.stringify(sim.validateLevel(level)), '{"errors":[],"warnings":[]}', 'validateLevel')
  const { w, used } = carefulRun(level)
  t.eq(w.status, 'clear', `status after ${w.tick} ticks, at column ${(w.player.x / TILE).toFixed(1)}`)
  t.eq(w.player.pips, 3, 'pips at the goal')
  t.notes.push(`dev-hazards: the careful player reached the goal in ${w.tick} ticks (${(w.tick / 60).toFixed(0)} s) at full shine; moves ${JSON.stringify(used)}`)
  // And it is not fooled: a corridor two tiles high, shut by a brush that never moves, stops it.
  const shut = t.makeLevel([CEIL, '', '', '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', '', '  @      1        G', t.FLOOR, t.FLOOR], { legend: { 1: { kind: 'brush', props: { range: 0 } } } })
  let stopped = ''
  try {
    carefulRun(shut)
  } catch (err) {
    stopped = String(err.message)
  }
  t.ok(stopped.startsWith('no '), `the careful player got past a brush nobody can get past (${stopped || 'it reached the goal'})`)
})

await t.finish()
