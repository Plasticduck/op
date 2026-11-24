// The reachability map (scripts/maxx/lib/reach.mjs) and the level command's lint and
// expectations (scripts/maxx/level.mjs), checked against micro-levels whose answers are the
// measured numbers in docs/super-mighty-maxx/NOTES.md, against the sandbox, and the world copier against
// the simulation itself.   node scripts/maxx/tests/reach.mjs [--only text]
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { suite } from '../lib/testkit.mjs'
import { MODE, copyWorld, createReach, describeMacro, parseMode } from '../lib/reach.mjs'
import { checkExpectation, lintLevel, parseExpectation } from '../level.mjs'
import { GAME_DIR, GAME_REL, REPO } from '../paths.mjs'

const LEVEL_CMD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'level.mjs')

const t = await suite('reach')
const { sim, contract, levels } = t
const { TILE } = contract
const { createWorld, stepWorld, worldHash } = sim

const FLOOR = '#'.repeat(40)
const solver = (rows, opts = {}) => createReach(sim, contract, t.makeLevel(rows, opts), { hover: opts.hover, noHover: opts.noHover, noPulse: opts.noPulse })
/** Node key of Maxx standing with his feet in cell (col, row), as a designer writes '@'. */
const spot = (col, row, area = 'main') => `${area}|${col}|${(row + 1) * TILE}`
const reaches = (rows, col, row, mode = 0, opts = {}) => solver(rows, opts).graph(mode).reached.has(spot(col, row))
const pitRows = (gap) => {
  const row = '#'.repeat(14) + ' '.repeat(gap) + '#'.repeat(20)
  return ['  @', row, row]
}
const wallRows = (h) => {
  const rows = []
  for (let i = 0; i < h; i++) rows.push(' '.repeat(12) + 'XX')
  rows[h - 1] = '  @'.padEnd(12) + 'XX'
  return [...rows, FLOOR, FLOOR]
}
/** The edges of a graph that start left of column a and end at or right of column b, on tiles. */
const crossing = (r, g, a, b) =>
  [...g.edges.values()].flat().filter((e) => {
    const f = r.nodes.get(e.from)
    const to = r.nodes.get(e.to)
    return f?.kind === 'tile' && to?.kind === 'tile' && f.col < a && to.col >= b
  })

/* ------------------------------------------------------------------ */
/* The copier                                                          */
/* ------------------------------------------------------------------ */

/** A repeatable busy input script (the same generator as the core suite's). */
function busy(seed, n) {
  let s = seed
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  const out = []
  for (let i = 0; i < n; i++) {
    const held = []
    const r = next()
    if (r < 0.62) held.push('right')
    else if (r < 0.8) held.push('left')
    if (next() < 0.35) held.push('jump')
    if (next() < 0.5) held.push('spray')
    if (next() < 0.12) held.push('down')
    if (next() < 0.12) held.push('up')
    const ticks = 1 + Math.floor(next() * 24)
    for (let k = 0; k < ticks; k++) out.push(held)
  }
  return out
}

/** Paths at which the two worlds share an object the simulation writes to. */
function sharedMutables(a, b) {
  const shared = []
  const SHARE = new Set(['level', 'area', 'def', 'spawns', 'props', 'input'])
  const seen = new WeakSet()
  const walk = (x, y, path, key) => {
    if (x === null || typeof x !== 'object' || y === null || typeof y !== 'object') return
    if (SHARE.has(key) || path.includes('.events[')) return
    if (x === y) {
      if (!Object.isFrozen(x)) shared.push(path)
      return
    }
    if (seen.has(x)) return
    seen.add(x)
    if (ArrayBuffer.isView(x)) return
    for (const k of Object.keys(x)) walk(x[k], y[k], Array.isArray(x) ? `${path}[${k}]` : `${path}.${k}`, k)
  }
  walk(a, b, 'w', '')
  return shared
}

/** Copy a world at tick `at` of a script, step both on to the end, and compare worldHash every tick. */
function copyHolds(w, script, at, label) {
  const input = t.makeInput()
  const frames = script.map((held) => input(held))
  for (let i = 0; i < at; i++) {
    stepWorld(w, frames[i])
    w.events.length = 0
  }
  const c = copyWorld(w)
  const shared = sharedMutables(w, c)
  t.eq(shared.length, 0, `${label}: the copy shares mutable state with the original (${shared.slice(0, 4).join(', ')})`)
  t.eq(worldHash(c), worldHash(w), `${label}: hash right after copying`)
  for (let i = at; i < frames.length; i++) {
    stepWorld(w, frames[i])
    stepWorld(c, frames[i])
    w.events.length = 0
    c.events.length = 0
    const hw = worldHash(w)
    const hc = worldHash(c)
    if (hw !== hc) throw new Error(`${label}: the copy and the original differ at tick ${i + 1} (copied at ${at})`)
  }
  return frames.length - at
}

t.test('copyWorld is exact: a copy and the original stay identical, tick for tick, in every level', () => {
  let ticks = 0
  const list = [levels.sandboxLevel, ...levels.DEV_LEVELS]
  list.forEach((level, i) => {
    for (const at of [0, 37, 400]) {
      const w = createWorld(level, { session: t.freshSession(), seed: 3 + i })
      ticks += copyHolds(w, busy(100 + i * 7 + at, 160), at, `${level.id} copied at ${at}`)
    }
  })
  t.notes.push(`copier: ${ticks} ticks stepped side by side over ${list.length} levels (${list.map((l) => l.id).join(', ')}), worldHash equal on every one`)
  t.ok(ticks > 20000, `only ${ticks} ticks compared`)
})

t.test('copyWorld is exact in the middle of a pipe trip, with water in the air, and the copy is independent', () => {
  const w = createWorld(levels.sandboxLevel, { session: t.freshSession() })
  const input = t.makeInput()
  t.until(w, [], (x) => x.player.onGround, 120, input)
  const pipe = t.find(w, 'pipe')
  t.place(w, pipe.x + 20, pipe.y + pipe.h)
  w.camera.x = Math.max(0, pipe.x - 300)
  stepWorld(w, input([]))
  t.until(w, ['down', 'spray'], (x) => x.warp !== null && x.warp.t > 5, 120, input)
  t.ok(w.warp, 'the pipe trip did not start')
  const script = [...Array(80).fill(['down']), ...busy(9, 120)]
  const n = copyHolds(w, script, 0, 'mid-warp')
  t.ok(n > 1000, 'too short')
  // Independence: stepping only the copy leaves the original as it was.
  const c = copyWorld(w)
  const before = worldHash(w)
  const other = t.makeInput()
  for (const held of busy(77, 80)) {
    stepWorld(c, other(held))
    c.events.length = 0
  }
  t.eq(worldHash(w), before, 'the original changed when only the copy was stepped')
  t.ok(worldHash(c) !== before, 'the copy did not move at all')
})

/* ------------------------------------------------------------------ */
/* Micro-levels with known answers (NOTES.md)                          */
/* ------------------------------------------------------------------ */

t.test('walls: 3 and 4 tiles are climbed, 5 is a barrier', () => {
  t.ok(reaches(wallRows(3), 12, 6), 'top of a 3-tile wall not reached')
  t.ok(reaches(wallRows(4), 12, 5), 'top of a 4-tile wall not reached')
  t.ok(!reaches(wallRows(5), 12, 4), 'top of a 5-tile wall reached')
  t.ok(!reaches(wallRows(5), 12, 4, MODE.GRIME | MODE.GATES | MODE.CARS | MODE.HIDDEN), 'a 5-tile wall climbed with every mode open')
})

t.test('pits: 6 is jumped, 7 is not; with the hover held from the top 9, begun late 10, never 11; tapping it adds nothing', () => {
  const crosses = (gap, hover) => reaches(pitRows(gap), 14 + gap + 2, 9, 0, { hover })
  t.ok(crosses(5, 'off'), '5-tile pit not crossed')
  t.ok(crosses(6, 'off'), '6-tile pit not crossed')
  t.ok(!crosses(7, 'off'), '7-tile pit crossed without the hover')
  t.ok(crosses(7, 'top'), '7-tile pit not crossed with the hover')
  t.ok(crosses(9, 'top'), '9-tile pit not crossed with the hover held from the top')
  t.ok(!crosses(10, 'top'), '10-tile pit crossed with the hover held from the top')
  // A hold begun after the top goes further: he keeps his full run until it starts (NOTES.md section 5).
  t.ok(crosses(10, 'held'), '10-tile pit not crossed with the hover begun late')
  t.ok(!crosses(11, 'all'), '11-tile pit crossed with some hover')
  // Once begun, the hover runs down every tick pressed or not (sim/player.ts), so tapping it buys nothing (it used to glide 18 tiles).
  t.eq(crosses(10, 'all'), crosses(10, 'held'), '10-tile pit: every hover, tapping too, against the held ones')
  // The take-off window matches the core suite's measurement (sim.mjs: 8 ticks for a 6-tile pit).
  const r = solver(pitRows(6))
  const g = r.graph(0)
  const route = r.routeTo(g, spot(22, 9))
  const jump = route.steps.find((e) => r.nodes.get(e.from).col < 14 && r.nodes.get(e.to).col >= 20)
  const w = r.windowOf(g, jump)
  t.ok(w && !w.needsHover, 'the 6-tile pit route should not need the hover')
  t.ok(w.works >= 6 && w.works <= 10, `6-tile pit window ${w.works} ticks, the core suite measures 8`)
  const r7 = solver(pitRows(7))
  const g7 = r7.graph(0)
  const jump7 = r7.routeTo(g7, spot(23, 9)).steps.find((e) => r7.nodes.get(e.from).col < 14 && r7.nodes.get(e.to).col >= 21)
  t.ok(r7.windowOf(g7, jump7).needsHover, 'the 7-tile pit route is not flagged as needing the hover')
  t.notes.push(`pits: 6 tiles crossed by ${describeMacro(jump.macro)}, window ${w.works}/${w.tried}; 7 tiles needs ${describeMacro(jump7.macro)}`)
})

/** A running take-off onto a ledge `up` tiles higher (lower if negative) across `gap` open tiles: the layout of sim.mjs's pitWindow. */
function ledgeLevel(gap, up) {
  const runway = 14
  const take = 6 + Math.max(0, up)
  const rows = []
  for (let r = 0; r <= Math.max(take, take - up) + 2; r++) rows.push((r >= take ? '#' : ' ').repeat(runway) + ' '.repeat(gap) + (r >= take - up ? '#' : ' ').repeat(30))
  rows[take - 1] = '  @' + rows[take - 1].slice(3)
  const level = t.makeLevel(rows)
  return { level, landY: level.areas[0].rows.findIndex((r) => r.endsWith('#')) * TILE, far: runway + gap }
}
const ledgeCrossed = (gap, up, hover) => {
  const { level, landY, far } = ledgeLevel(gap, up)
  const r = createReach(sim, contract, level, { hover })
  // On the far ledge, or at its lip (his middle over the last column of the gap).
  return [...r.graph(0).reached].some((k) => {
    const n = r.nodes.get(k)
    return n.kind === 'tile' && n.feetY === landY && n.col >= far - 1
  })
}

t.test('ledges 4 up to 4 down: the widest gaps are those of sim.mjs --ledges, plain, held from the top, and the most any hover gives', () => {
  // NOTES.md section 5's table, which sim.mjs measures from one run-up at 23 take-off ticks. The map
  // also moves the run-up by pixels (the lip sweep), which finds one more: held from the top onto a
  // ledge 4 down, 11 from one pixel-exact run-up (the table has 10). A brute force of run-ups in
  // quarter pixels, every take-off tick and every hover start found nothing past the last column.
  const ups = [4, 3, 2, 1, 0, -1, -2, -3, -4]
  const want = { off: [5, 5, 6, 6, 6, 7, 7, 7, 7], top: [7, 8, 9, 9, 9, 10, 10, 10, 11], all: [7, 8, 9, 10, 10, 11, 11, 11, 12] }
  const said = []
  for (const hover of ['off', 'top', 'all']) {
    ups.forEach((up, i) => {
      const gap = want[hover][i]
      t.ok(ledgeCrossed(gap, up, hover), `hover ${hover}, ${up} up: a gap of ${gap} not crossed`)
      t.ok(!ledgeCrossed(gap + 1, up, hover), `hover ${hover}, ${up} up: a gap of ${gap + 1} crossed`)
    })
    said.push(`${hover} ${want[hover].join('/')}`)
  }
  t.notes.push(`ledges 4 up .. 4 down, widest gap: ${said.join('; ')}`)
})

t.test('tapping the hover finds nothing a held one does not: the map with and without the pulsed macros is the same', () => {
  const rooms = [
    ['the 10-tile pit', t.makeLevel(pitRows(10))],
    ['the 12-tile gap onto a ledge 4 down', ledgeLevel(12, -4).level],
    ['the 10-tile gap onto a ledge 1 up', ledgeLevel(10, 1).level],
    ['dev-reach', levels.DEV_LEVELS.find((l) => l.id === 'dev-reach')],
  ]
  for (const [name, level] of rooms) {
    const all = createReach(sim, contract, level, { hover: 'all' })
    const held = createReach(sim, contract, level, { hover: 'held' })
    for (const mode of [0, MODE.GRIME | MODE.HIDDEN]) {
      const ga = all.graph(mode)
      const gh = held.graph(mode)
      const extra = [...ga.reached].filter((k) => !gh.reached.has(k))
      t.eq(extra.length, 0, `${name}, mode ${mode}: places reached only by tapping the hover: ${extra.slice(0, 4).join(' ')}`)
      t.eq([...ga.touched.keys()].filter((id) => !gh.touched.has(id)).length, 0, `${name}, mode ${mode}: things touched only by tapping the hover`)
      // So no route takes a tapped move (and none says NEEDS PULSED HOVER): the cheapest way to every place is held.
      const tapped = [...all.costs(ga).via.values()].filter((e) => e.pulse)
      t.eq(tapped.length, 0, `${name}, mode ${mode}: routes that tap the hover: ${tapped.slice(0, 3).map((e) => `${e.macro.id} from ${e.from}`).join(', ')}`)
    }
  }
})

t.test('a late hover carried on from its plain flight is the same as one played from the start', () => {
  const rows = ['', '', '', '      ====          XXX', '', '', '', '  @         y', '#'.repeat(12) + ' '.repeat(10) + '#'.repeat(6) + '   ' + '####', '#'.repeat(12) + ' '.repeat(10) + '#'.repeat(6) + '   ' + '####']
  const sig = (r) => {
    const g = r.graph(0)
    const out = new Map()
    for (const e of [...g.edges.values()].flat()) out.set(`${e.from}|${e.macro.id}|${e.tau}|${e.offset ?? ''}`, `${e.to}|${e.ticks}|${e.res.fallT}|${e.res.touched}|${e.res.bumped}|${e.res.rel}|${e.res.box}|${e.hover}`)
    return out
  }
  const shared = createReach(sim, contract, t.makeLevel(rows))
  const fresh = createReach(sim, contract, t.makeLevel(rows), { share: false })
  const a = sig(shared)
  const b = sig(fresh)
  t.eq(a.size, b.size, 'edges')
  const differ = [...b].filter(([k, v]) => a.get(k) !== v)
  t.eq(differ.length, 0, `edges that differ: ${differ.slice(0, 3).map(([k]) => k).join(', ')}`)
  t.ok(shared.stats.ticks < fresh.stats.ticks, `sharing simulated ${shared.stats.ticks} ticks, playing from the start ${fresh.stats.ticks}`)
  t.notes.push(`late hovers carried on from the plain flight: ${a.size} edges the same, ${Math.round((100 * shared.stats.ticks) / fresh.stats.ticks)}% of the ticks`)
})

t.test('a catwalk is reached by jumping up through it; one too high is not', () => {
  t.ok(reaches(['', '        ====', '', '  @', FLOOR, FLOOR], 9, 6), 'catwalk 3 tiles up not reached')
  t.ok(!reaches(['        ====', '', '', '', '', '  @', FLOOR, FLOOR], 9, 3), 'catwalk 6 tiles up reached')
})

t.test('a one-tile gap is run across, no jump needed; a slow walk drops in', () => {
  const row = '#'.repeat(12) + ' ' + '#'.repeat(27)
  const r = solver(['  @', row, row])
  const g = r.graph(0)
  t.ok(g.reached.has(spot(16, 9)), 'the far side of a one-tile gap not reached')
  const over = crossing(r, g, 12, 13)
  t.ok(over.some((e) => e.macro.ground === 'run' || e.macro.ground === 'step'), `nothing but jumps cross it: ${[...new Set(over.map((e) => e.macro.id))].join(' ')}`)
  const node = r.nodes.get(spot(11, 9))
  const walk = r.play(0, node, r.macroById('walk-right'), 0, undefined)
  t.ok(walk.dead, 'a half-stick walk off the lip did not fall in')
})

t.test('a spring throws him onto a ledge no jump reaches', () => {
  // The ledge's top is row 4 (makeLevel pads the rows to 12 from the top): feet in row 3, six tiles up.
  const rows = ['', '', '              XXXX', '', '', '', '', '  @       y', FLOOR, FLOOR]
  t.ok(reaches(rows, 15, 3), 'the ledge over the spring not reached')
  t.ok(!reaches(rows.map((r) => r.replace('y', ' ')), 15, 3), 'the ledge reached without the spring')
})

t.test('lifts: one carries him over a pit no jump crosses, another up to a high ledge', () => {
  const row = '#'.repeat(10) + ' '.repeat(13) + '#'.repeat(17)
  const legend = { 5: { kind: 'lift', props: { dx: 8, speed: 70, wait: 40 } } }
  const across = ['  @         5', row, row]
  t.ok(reaches(across, 26, 9, 0, { legend, noHover: true }), 'the far side of the lift pit not reached')
  t.ok(!reaches(['  @', row, row], 26, 9, 0, { noHover: true }), 'the far side of a 13-tile pit reached without a lift')
  const up = { 6: { kind: 'lift', props: { dy: -6, speed: 60, wait: 40 } } }
  const r = solver(['', '', '', '        XXXX', '', '', '', '', '', '  @   6', FLOOR, FLOOR], { legend: up })
  const g = r.graph(0)
  t.ok(g.reached.has(spot(9, 2)), 'the ledge at the top of the lift not reached')
  t.ok([...g.reached].some((k) => k.includes('|m')), 'no node on the lift itself')
  const route = r.routeTo(g, spot(9, 2))
  t.ok(route.steps.some((e) => r.nodes.get(e.to)?.kind === 'mover'), 'the route to the ledge does not ride the lift')
})

t.test('a pipe to a second area and a pipe back to the far side of a wall', () => {
  const main = ['%', '%', '%', '%', '%', '%', '%', '1', 'PP', '  @       PP        %    m'].map((r, i) => (i < 9 ? r.padStart(i === 7 ? 11 : i === 8 ? 12 : 21) : r))
  main[7] = '          1         %'
  main[8] = '          PP        %'
  const room = ['%%%%%%%%%%%%%%%%%%%%%%%%', ...Array(6).fill('%                      %'), '%               2      %', '%               PP     %', '%  4    $       PP     %', '#'.repeat(24), '#'.repeat(24)]
  const level = t.makeLevel([...main, FLOOR, FLOOR], {
    legend: { 1: { kind: 'pipe', props: { to: 'room:in' } }, m: { kind: 'marker', props: { name: 'far' } } },
    areas: [{ id: 'room', theme: 'bonus', rows: room, legend: { 4: { kind: 'marker', props: { name: 'in' } }, 2: { kind: 'pipe', props: { to: 'main:far' } } } }],
  })
  const r = createReach(sim, contract, level)
  const g = r.graph(0)
  t.ok(g.reached.has(spot(8, 9, 'room')), 'the room was not reached')
  const token = r.targets.find((x) => x.kind === 'token')
  t.ok(g.touched.has(token.id), 'the token in the room was not reached')
  t.ok(g.reached.has(spot(30, 9)), 'the far side of the wall was not reached through the room')
  const route = r.routeTo(g, spot(30, 9))
  t.eq(route.steps.filter((e) => e.macro.id === 'pipe').length, 2, 'pipes on the route to the far side')
})

t.test('a grime wall: the token behind it only with grime washed', () => {
  const rows = ['', '', '', '', '', '              %%%%%%', '              g    %', '              g    %', '  @           g $  %', FLOOR, FLOOR]
  const r = solver(rows)
  const token = r.targets.find((x) => x.kind === 'token')
  t.ok(!r.graph(0).touched.has(token.id), 'the token behind the grime reached with grime kept')
  t.ok(r.graph(MODE.GRIME).touched.has(token.id), 'the token not reached with grime washed')
  t.ok(r.stats.reused > 0, 'the second mode reused nothing from the first')
})

t.test('a hidden block staircase only counts once the blocks are bumped (hidden=on)', () => {
  const rows = ['', '', '', '', '             XXXX', '           H', '', '        H', '', '  @', FLOOR, FLOOR]
  const r = solver(rows)
  t.ok(!r.graph(0).reached.has(spot(14, 3)), 'the ledge reached up hidden blocks that were never bumped')
  t.ok(r.graph(MODE.HIDDEN).reached.has(spot(14, 3)), 'the ledge not reached up the bumped hidden blocks')
  // And bumping one works in either mode: the block is found.
  t.ok([...r.graph(0).bumped.keys()].some((k) => k.startsWith('main@8,7')), 'the low hidden block was never bumped')
})

t.test('a gate holds him back until it is open; a washed car roof is a step up', () => {
  const legend = { 1: { kind: 'gate', props: { flag: 'boss', h: 7 } } }
  const gate = ['  @            1      G', FLOOR, FLOOR]
  const rg = solver(gate, { legend })
  t.ok(!rg.graph(0).exits.some((e) => e.exit === 'goal'), 'the goal reached through a shut gate')
  t.ok(rg.graph(MODE.GATES).exits.some((e) => e.exit === 'goal'), 'the goal not reached with gates open')
  const roof = ['', '', '', '              XXXX', '', '', '', '', '', '  @       t', FLOOR, FLOOR]
  const rr = solver(roof)
  t.ok(!rr.graph(0).reached.has(spot(15, 2)), 'the high ledge reached without a car')
  t.ok(rr.graph(MODE.CARS).reached.has(spot(15, 2)), 'the high ledge not reached from the monster truck roof')
})

t.test('a brick stays broken: the way up through a brick ceiling is found, and the move says so', () => {
  const ceiling = 'X'.repeat(10) + 'B' + 'X'.repeat(29)
  const r = solver(['', '', '', '', ceiling, '', '  @', FLOOR, FLOOR])
  const g = r.graph(0)
  // makeLevel pads to 12 rows: the ceiling is row 7, so on top of it his feet are in row 6.
  t.ok(g.reached.has(spot(14, 6)), 'the top of the brick ceiling not reached')
  t.ok(g.broken.includes('main@10,7'), `the brick was not broken on the map (${g.broken.join(' ')})`)
  const route = r.routeTo(g, spot(14, 6))
  t.ok(route.steps.some((e) => r.needsBricks(e).includes('main@10,7')), 'no move on the route says it needs the brick broken')
  const solid = solver(['', '', '', '', 'X'.repeat(40), '', '  @', FLOOR, FLOOR])
  t.ok(!solid.graph(0).reached.has(spot(14, 6)), 'the top of a steel ceiling reached')
})

t.test('a button opens its gate on the map; one behind its own gate does not', () => {
  const legend = { 1: { kind: 'gate', props: { flag: 'open', h: 9 } }, b: { kind: 'button', props: { flag: 'open' } } }
  const front = solver(['  @    b        1      G', FLOOR, FLOOR], { legend })
  const g = front.graph(0)
  t.ok(g.exits.some((e) => e.exit === 'goal'), 'the goal behind a gate whose button is in reach was not reached')
  t.eq(g.flagsSet.open, 1, 'flag set on the map by the button')
  const route = front.routeTo(g, 'goal')
  t.ok(route.steps.some((e) => front.needsFlags(e).some((f) => f.flag === 'open')), 'no move on the route says it needs the button pressed')
  const behind = solver(['  @             1   b  G', FLOOR, FLOOR], { legend })
  t.ok(!behind.graph(0).exits.some((e) => e.exit === 'goal'), 'the goal reached through a gate whose button is behind it')
  t.ok(behind.graph(MODE.GATES).exits.some((e) => e.exit === 'goal'), 'the goal not reached with gates open')
})

t.test('a washed car that drives away for good is no platform; one shuttling between walls is', () => {
  const legend = { c: { kind: 'car', variant: 'compact', props: { clean: true, dir: 1 } } }
  // A ledge five tiles up, next to where the car starts: only from its roof, and it drives off at once.
  const away = solver(['', '', '', '', '     XXXX', '', '', '', '  @      c', FLOOR, FLOOR], { legend })
  const ga = away.graph(0)
  t.ok(away.movers('main').gone.size === 1, 'the car that drives off was not marked gone')
  t.ok(![...ga.reached].some((k) => k.startsWith('main|') && Number(k.split('|')[2]) < 200), 'a place up on the ledge was reached from a car that has left')
  const ex = away.explore(0, { ticks: 300000 })
  t.ok(![...ex.places.keys()].some((k) => Number(k.split('|')[2]) < 200), 'random play reached the ledge: the test is wrong')
})

t.test('grime kept is kept: spraying at a grime wall in the probe washes nothing', () => {
  const rows = ['', '', '', '', '', '              %%%%%%', '              g    %', '              g    %', '  @           g $  %', FLOOR, FLOOR]
  const r = solver(rows)
  const ex = r.explore(0, { ticks: 400000 })
  const token = r.targets.find((x) => x.kind === 'token')
  t.ok(!ex.touched.has(token.id), 'random play sprayed its way through the grime in grime-kept mode')
  // Inside the room, on its floor (its roof is a fair climb).
  t.ok(![...ex.places.keys()].some((k) => Number(k.split('|')[1]) >= 15 && Number(k.split('|')[1]) <= 17 && k.endsWith('|320')), 'random play stood behind the grime wall')
})

t.test('random play agrees with the map on adversarial rooms (no place it reaches that the map says it cannot)', () => {
  const W = 40
  const blankRows = (n) => Array.from({ length: n }, () => '')
  const rooms = {
    'mud wall 3 (a running jump at mud speed clears it by 1.5 px)': [...blankRows(7), ' '.repeat(20) + 'XX', ' '.repeat(20) + 'XX', '  @'.padEnd(20) + 'XX', '#'.repeat(10) + 'M'.repeat(10) + '#'.repeat(20), FLOOR],
    'overhang (drop off and steer back under)': ['', '', '', '', '', '  @', '###############', '          X', '          X', '          X $', '          X####       ######', '~'.repeat(W)],
    'ceiling over a 5-tile pit': ['', '', '', '', '', '', '%'.repeat(W), '', '', '  @', '#'.repeat(12) + '     ' + '#'.repeat(23), '#'.repeat(12) + '     ' + '#'.repeat(23)],
    'catwalks above and below': ['', '', '                          XXXXX', '', '', '      =====          ======     ', '', '', '', '  @', FLOOR, FLOOR],
    'slick run-up to a 6-tile pit': ['', '', '', '', '', '', '', '', '', '  @', '##' + 'I'.repeat(10) + '      ' + '#'.repeat(22), FLOOR],
  }
  const said = []
  for (const [name, rows] of Object.entries(rooms)) {
    const r = solver(rows.map((x) => x.padEnd(W)), { noHover: true })
    const g = r.graph(0)
    const ex = r.explore(0, { ticks: 250000, noHover: true })
    const tiles = new Set(g.reached)
    const extra = [...ex.places.keys()].filter((k) => {
      if (tiles.has(k)) return false
      const [a, c, y] = k.split('|')
      // The lip of a ledge (his middle over the air beside it) is the same floor as the next column.
      return !tiles.has(`${a}|${Number(c) - 1}|${y}`) && !tiles.has(`${a}|${Number(c) + 1}|${y}`)
    })
    t.eq(extra.length, 0, `${name}: random play stood where the map says he cannot: ${extra.slice(0, 5).join(' ')}`)
    const touched = [...ex.touched.keys()].filter((id) => !g.touched.has(id))
    t.eq(touched.length, 0, `${name}: random play touched what the map says he cannot`)
    said.push(`${name}: map ${g.reached.size}, random ${ex.places.size}`)
  }
  t.notes.push(`random play vs the map: ${said.join('; ')}`)
})

/* ------------------------------------------------------------------ */
/* The sandbox                                                         */
/* ------------------------------------------------------------------ */

t.test('sandbox: the goal, the three tokens and the secret exit, and which mode each needs', () => {
  const t0 = performance.now()
  const r = createReach(sim, contract, levels.sandboxLevel)
  const g = r.graph(0)
  const ms = performance.now() - t0
  const goal = r.routeTo(g, 'goal')
  t.ok(goal, 'the goal is not reachable')
  t.ok(!r.routeTo(g, 'secret'), 'the secret exit reachable with its grime wall kept')
  const gw = r.graph(MODE.GRIME)
  const secret = r.routeTo(gw, 'secret')
  t.ok(secret, 'the secret exit not reachable with grime washed')
  const tokens = r.targets.filter((x) => x.kind === 'token').sort((a, b) => a.token - b.token)
  t.eq(tokens.length, 3, 'tokens in the sandbox')
  const how = (route) => [...new Set(route.steps.map((e) => (e.macro.id === 'pipe' ? 'a pipe' : e.macro.id === 'door' ? 'a door' : r.nodes.get(e.to)?.kind === 'mover' ? 'a lift' : null)).filter(Boolean))].join(' and ') || 'running and jumping'
  const said = []
  for (const tk of tokens) {
    const base = r.routeTo(g, tk.id)
    const washed = r.routeTo(gw, tk.id)
    t.ok(washed, `token ${tk.token + 1} (${tk.area} ${tk.tx},${tk.ty}) not reachable even with grime washed`)
    said.push(`token ${tk.token + 1} at ${tk.area} ${tk.tx},${tk.ty}: ${base ? `${base.ticks} ticks by ${how(base)}` : `needs grime washed (${washed.ticks} ticks)`}`)
  }
  t.ok(r.routeTo(g, tokens[0].id), 'token 1 (over the lifts) not reachable with grime kept')
  t.ok(!r.routeTo(g, tokens[1].id), 'token 2 (behind the grime) reachable with grime kept')
  t.ok(r.routeTo(g, tokens[2].id), 'token 3 (the bonus room) not reachable with grime kept')
  t.ok(r.routeTo(g, tokens[2].id).steps.some((e) => e.macro.id === 'pipe' || e.macro.id === 'door'), 'token 3 reached without going through the pipe or door')
  t.notes.push(`sandbox: ${g.reached.size} standing places in ${Math.round(ms)} ms; goal ${goal.ticks} ticks by ${how(goal)}; secret exit needs grime washed (${secret.ticks} ticks); ${said.join('; ')}`)
})

/* ------------------------------------------------------------------ */
/* Expectations and lint                                               */
/* ------------------------------------------------------------------ */

t.test('expectations: parsing, and checks that pass and fail for the right reasons', () => {
  const ex = parseExpectation('not @16-17,9 unless grime=washed  # behind the grime')
  t.eq(ex.verb, 'not', 'verb')
  t.eq(ex.unless, MODE.GRIME, 'unless mode')
  t.eq(parseExpectation('reach tokens with all').mode, 15, "'all'")
  t.eq(parseExpectation('reach goal with hover=off').hover, 'off', 'hover=off')
  t.eq(parseExpectation('not @12,3 with grime=washed, hover=top').hover, 'top', 'hover=top')
  t.eq(parseExpectation('not @12,3 with grime=washed, hover=top').mode, MODE.GRIME, 'hover=top beside a world mode')
  t.eq(parseExpectation('reach goal').hover, null, 'no hover named')
  t.eq(parseExpectation('reach goal within 90s').within, 5400, 'within')
  t.eq(parseMode('gates=open,cars=roofs'), MODE.GATES | MODE.CARS, 'parseMode')
  let threw = false
  try {
    parseExpectation('reach the moon')
  } catch {
    threw = true
  }
  t.ok(threw, 'an unknown target was accepted')
  const rows = ['', '', '', '', '', '              %%%%%%', '              g    %', '              g    %', '  @           g $  %     G', FLOOR, FLOOR]
  const r = solver(rows)
  const check = (line) => checkExpectation(() => r, parseExpectation(line))
  const pass = (line) => t.ok(check(line).every((x) => x.ok), `should pass: ${line}: ${check(line).map((x) => x.text).join('; ')}`)
  const fail = (line) => t.ok(!check(line).every((x) => x.ok), `should fail: ${line}`)
  pass('reach goal')
  pass('fair goal')
  pass('not token1 unless grime=washed')
  pass('not @15-18,9 unless grime=washed')
  pass('reach token1 with grime=washed')
  pass('reach goal within 60s')
  fail('reach token1')
  fail('not goal')
  fail('reach goal within 1s')
  const why = check('reach token1')[0].text
  t.ok(/needs grime washed/.test(why), `the failure does not say what it needs: ${why}`)
})

t.test('lint: the design checks find what they should, with places', () => {
  const game = { sim, contract, meta: [] }
  const lint = (level, opts) => lintLevel(game, { level }, opts).out
  const has = (out, sev, re) => out.some((m) => m.sev === sev && re.test(m.text))
  const bad = t.makeLevel(
    [
      '      X              X',
      '      W   o          L',
      '  @  c   A   B',
      '#'.repeat(30) + ' ' + '#'.repeat(29),
      '#'.repeat(30) + ' ' + '#'.repeat(29),
    ],
    { id: 'mw01', legend: { A: { kind: 'sign', props: { text: 'Press {jmp} — now' } }, Z: { kind: 'coin' }, B: { kind: 'blorp' } }, time: 5 },
  )
  const out = lint(bad)
  t.ok(has(out, 'error', /its prize would come out inside it/), "a 'W' under a solid was not flagged")
  t.ok(has(out, 'error', /tiles from the start/), 'a car next to the start was not flagged')
  t.ok(has(out, 'error', /long dash/), 'an em dash in a sign was not flagged')
  t.ok(has(out, 'error', /\{jmp\} is not a prompt/), 'an unknown prompt was not flagged')
  t.ok(has(out, 'warn', /lower case/), 'lower case in a sign was not flagged')
  t.ok(has(out, 'warn', /pit one tile wide/), 'a one-tile pit was not flagged')
  t.ok(has(out, 'warn', /legend 'Z'/), 'an unused legend character was not flagged')
  t.ok(has(out, 'warn', /'blorp' is not registered/), 'an unregistered kind was not named')
  t.ok(has(out, 'error', /0 tokens/), 'a shipping level without three tokens was not flagged')
  t.ok(has(out, 'error', /clock/), 'a 5-second clock was not flagged')
  t.ok(out.find((m) => /pit one tile wide/.test(m.text)).where === 'main 30,10', 'the one-tile pit is not placed by column and row')
  const floating = t.makeLevel(['', '', '  @     s', '', '', FLOOR, FLOOR], { id: 'dev-x' })
  t.ok(has(lint(floating), 'error', /nothing under its wheels/), 'a car in the air was not flagged')
  const cut = t.makeLevel(['  @  1    G', FLOOR, FLOOR], {
    id: 'dev-y',
    legend: { 1: { kind: 'door', props: { to: 'nowhere:in' } } },
    areas: [{ id: 'island', theme: 'bonus', rows: t.makeLevel(['  m', FLOOR, FLOOR]).areas[0].rows, legend: { m: { kind: 'marker', props: { name: 'in' } } } }],
  })
  const cutOut = lint(cut, { strict: true })
  t.ok(has(cutOut, 'error', /cannot be entered/), 'an area nothing leads to was not flagged')
  t.ok(has(lint(cut), 'warn', /cannot be entered/), 'in a test room an area nothing leads to is not a warning (a bench for the viewer)')
  t.ok(has(cutOut, 'error', /there is no area 'nowhere'/), 'a door to a missing area was not flagged')
  // Where Maxx appears: inside a wall, over a pit, high up.
  const arrivals = t.makeLevel(['  @    1', '#'.repeat(10) + '   ' + '#'.repeat(27), '#'.repeat(10) + '   ' + '#'.repeat(27)], {
    id: 'dev-z',
    legend: { 1: { kind: 'pipe', props: { to: 'room:in' } } },
    areas: [
      {
        id: 'room',
        theme: 'bonus',
        rows: [
          '%'.repeat(24),
          '%                      %',
          '%                      %',
          '%                      %',
          '%                      %',
          '%  m                   %',
          '%                      %',
          '%      %%%             %',
          '%      %n%  q  k       %',
          '%                      %',
          '#'.repeat(10) + '    ' + '#'.repeat(10),
          '#'.repeat(10) + '    ' + '#'.repeat(10),
        ],
        legend: { m: { kind: 'marker', props: { name: 'high' } }, n: { kind: 'marker', props: { name: 'in' } }, q: { kind: 'marker', props: { name: 'pit' } } },
      },
    ],
  })
  const arr = lint(arrivals)
  t.ok(arr.some((m) => m.sev === 'error' && m.where === 'room 8,8' && /inside the solid/.test(m.text)), `a marker under a wall is not an error with its place: ${arr.map((m) => `${m.where} ${m.text}`).join(' | ')}`)
  t.ok(arr.some((m) => m.sev === 'error' && m.where === 'room 12,8' && /nothing under it/.test(m.text)), 'a marker over a pit is not an error')
  t.ok(has(arr, 'warn', /marker 'high': the ground is 4 tiles below/), 'a marker high in the air was not flagged')
  // Mudzilla completes MW08 itself, so a level that ends in its fight has an exit (as validateLevel counts it).
  const arena = t.makeLevel(['  @                 Z', FLOOR, FLOOR], { id: 'dev-mz', legend: { Z: { kind: 'mudzilla' } } })
  t.ok(!has(lint(arena), 'error', /cannot be finished/), `a level ending in a mudzilla fight was said to have no exit: ${lint(arena).map((m) => m.text).join(' | ')}`)
  t.ok(has(lint(t.makeLevel(['  @', FLOOR, FLOOR], { id: 'dev-none' })), 'error', /cannot be finished/), 'a level with no exit at all was not flagged')
  // A prop with words never mirrors: flipping it does nothing (tiles atlas meta.decor[name].words).
  const decor = t.makeLevel(['  @  D   E   F', FLOOR, FLOOR], {
    id: 'dev-decor',
    legend: { D: { kind: 'decor', props: { sprite: 'decor_sign_vacuums', flip: true } }, E: { kind: 'decor', props: { sprite: 'decor_cone', flip: true } }, F: { kind: 'decor', props: { sprite: 'decor_sign_mw' } } },
  })
  const dout = lint(decor)
  t.ok(dout.some((m) => m.sev === 'warn' && m.where === 'main 5,9' && /has words.*flip does nothing.*sign_vacuums_left/.test(m.text)), `a flipped sign with words was not flagged: ${dout.map((m) => `${m.where} ${m.text}`).join(' | ')}`)
  t.ok(!dout.some((m) => /has words/.test(m.text) && m.where !== 'main 5,9'), 'a prop without words, or one not flipped, was flagged')
  // A level the game does not open by its id (levels/index.ts takes levels/mw01.ts .. mw08.ts and rivals.ts by their default export).
  const lone = t.makeLevel(['  @        G', FLOOR, FLOOR], { id: 'mw05', time: 200 })
  const inLevels = lintLevel(game, { level: lone, file: path.join(GAME_DIR, 'game', 'levels', 'mw5.ts'), served: false }).out
  t.ok(has(inLevels, 'error', /the game does not open this level by its id: .*levels\/mw05\.ts/), `a level file the game does not load was not an error: ${inLevels.map((m) => m.text).join(' | ')}`)
  const draft = lintLevel(game, { level: lone, file: path.join(REPO, '..', 'draft-mw05.ts'), served: false }).out
  t.ok(has(draft, 'warn', /the game does not open this level/) && !has(draft, 'error', /the game does not open/), 'a draft outside the levels folder is not just a warning')
  t.ok(!has(lintLevel(game, { level: lone, served: true }).out, 'error', /does not open/), 'a level the game opens was flagged')
  // The sandbox and every dev room load and lint without errors.
  for (const level of [levels.sandboxLevel, ...levels.DEV_LEVELS]) {
    const errs = lint(level).filter((m) => m.sev === 'error')
    t.notes.push(`lint ${level.id}: ${errs.length} errors${errs.length ? ': ' + errs.map((m) => `${m.where} ${m.text}`).join('; ') : ''}`)
  }
})

t.test('the command: list finds the level files, expect reads EXPECT from the level module (levels/dev/reach.ts) and exits 0; a false claim exits 1', () => {
  const cli = (...args) => spawnSync(process.execPath, [LEVEL_CMD, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const list = cli('list')
  t.eq(list.status, 0, `list exit code: ${list.stdout}${list.stderr}`)
  // The game folder from paths.mjs, so this holds wherever the game lives.
  const devReach = new RegExp(`^dev-reach .*EXPECT lines\\s+${[...GAME_REL.split('/'), 'game', 'levels', 'dev'].join('[\\\\/]')}[\\\\/]reach\\.ts`, 'm')
  t.ok(devReach.test(list.stdout), `list does not show dev-reach's file and EXPECT: ${list.stdout}`)
  t.ok(!/NOT OPENED BY THE GAME/.test(list.stdout), `list says the game does not open a level it does: ${list.stdout}`)
  // Every claim in the room holds against every hover, tapping included.
  const plain = cli('expect', 'dev-reach')
  t.ok(/EXPECT in .*reach\.ts/.test(plain.stdout), 'the expectations did not come from the level module')
  const fails = plain.stdout.split('\n').filter((l) => /^\s+(FAIL|NO )/.test(l))
  t.eq(plain.status, 0, `expect dev-reach exit code (${fails.join(' | ')}${plain.stderr})`)
  t.ok(/: (\d+) passed, 0 failed/.test(plain.stdout), 'expect dev-reach did not pass every line')
  // --hover top for every line that names none: the shelf over the pipe needs the hover begun late, so that one line fails.
  const top = cli('expect', 'dev-reach', '--hover', 'top')
  const topFails = top.stdout.split('\n').filter((l) => /^\s+FAIL/.test(l))
  t.eq(top.status, 1, 'expect dev-reach --hover top exit code')
  t.ok(topFails.length === 1 && /FAIL\s+reach @135-138,2\s+\(the hover held from the top of the jump only\)/.test(topFails[0]), `with --hover top, not just the late-hover shelf failed: ${topFails.join(' | ')}`)
  t.eq(cli('expect', 'dev-reach', '--hover', 'sideways').status, 2, 'exit code for a bad --hover')
  const bad = cli('expect', 'dev-reach', '--reach', '@151-154,2')
  t.eq(bad.status, 1, 'exit code for an unreachable place claimed reachable')
  const lint = cli('lint', 'dev-reach')
  t.eq(lint.status, 0, 'lint dev-reach exit code')
})

/* ------------------------------------------------------------------ */
/* Speed                                                               */
/* ------------------------------------------------------------------ */

t.test('speed: a 280 by 14 area is mapped by a bounded search', () => {
  // Busier than a real level: three storeys of catwalks and ledges over pits, steps, blocks, a lift and a spring.
  const H = 14
  const sections = [
    ['', '', '  =====', '', '', ' o o o', '=====    ====', '', '', '      ===', '', '', '##############', '##############'],
    ['', '', '      ====', '', '', '   =======', '', '', '  ====', '', '', '', '#####    #####', '#####    #####'],
    ['', '', '', ' ====', '', '', '      XXXX', '', '        XX', '        XX', '     XX XX', '     XX XX', '##############', '##############'],
    ['', '', '   =====', '', '', '  B?B   =====', '', '', ' =====', '', '', '', '###   ########', '###   ########'],
    ['', '', '', '', '========', '', '', '', '', '   %%%%', '   %  %', '        y', '##############', '##############'],
    ['', '', ' ====', '', '', '', '   =====', '', '', '', '', '   5', '##          ##', '##          ##'],
  ]
  const rows = []
  for (let y = 0; y < H; y++) {
    let line = ''
    for (let i = 0; i < 20; i++) line += (sections[i % sections.length][y] ?? '').padEnd(14).slice(0, 14)
    rows.push(line)
  }
  rows[11] = '  @' + rows[11].slice(3, 270) + 'G' + rows[11].slice(271)
  const legend = { 5: { kind: 'lift', props: { dx: 6, speed: 70, wait: 30 } } }
  const level = { id: 'speed', site: 'T', name: 'SPEED', time: 400, music: 'sunny', areas: [{ id: 'main', theme: 'lot', rows, legend }] }
  t.eq(rows[0].length, 280, 'width')
  const t0 = performance.now()
  const r = createReach(sim, contract, level)
  const g = r.graph(0)
  const ms = performance.now() - t0
  t.ok(r.routeTo(g, 'goal'), 'the goal of the speed level is not reachable')
  t.notes.push(`speed: 280 x 14 area, ${g.reached.size} standing places, ${r.stats.runs} macro runs (${(r.stats.ticks / 1e6).toFixed(2)}M ticks) in ${(ms / 1000).toFixed(1)} s`)
  // The tick count is the real guard: it is deterministic, and a search that explodes shows there first
  // (11.78M when written). Wall time is only a backstop, because Windows may run this on an
  // efficiency core at half the speed (52 to 78 s seen on an i7-14700F, 30 s on a performance core).
  t.ok(r.stats.ticks < 14e6, `${(r.stats.ticks / 1e6).toFixed(2)}M ticks for a 280 x 14 area`)
  t.ok(ms < 120000, `${Math.round(ms)} ms for a 280 x 14 area`)
})

await t.finish()
