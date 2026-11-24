// The solver (lib/solver.mjs) and its replays: the sandbox three ways, small rooms with one
// obstacle each, a level nobody can finish, replays that replay, the same run twice, and every
// replay kept in scripts/maxx/replays.
//   node scripts/maxx/tests/solve.mjs [--only <part of a title>]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { suite } from '../lib/testkit.mjs'
import { createReach } from '../lib/reach.mjs'
import { REPLAY_FORMAT, createSolver, decodeInput, formatResult, playReplay } from '../lib/solver.mjs'

const t = await suite('solve')
const { sim, contract, levels, ok, eq } = t

const FLOOR = (n) => '#'.repeat(n)
const runs = []

/** Solve a level; every run's replay is checked to replay to the same world. */
function solve(level, opts = {}) {
  const res = createSolver(sim, contract, level, opts).solve()
  const rep = playReplay(sim, level, res.replay)
  runs.push({ level, res, rep })
  if (!rep.ok) throw new Error(`${level.id}: the replay does not replay to the same world`)
  return res
}
/** The report, for a failing assertion's message. */
const why = (res) => '\n        ' + formatResult(res).join('\n        ')

/* ------------------------------------------------------------------ */
/* The sandbox                                                         */
/* ------------------------------------------------------------------ */

const sandbox = levels.sandboxLevel
let sandboxReach = null
const reach = () => (sandboxReach ??= createReach(sim, contract, sandbox))

t.test('the sandbox, to the goal, with every car and critter in it, untouched', () => {
  const res = solve(sandbox, { reach: reach() })
  ok(res.ok, `not solved${why(res)}`)
  eq(res.exit, 'goal', 'exit')
  eq(res.hits, 0, `hits taken${why(res)}`)
  ok(res.ticks < sandbox.time * 60 * 0.2, `took ${res.ticks} ticks`)
  t.notes.push(`sandbox goal: ${res.ticks} ticks (${(res.ticks / 60).toFixed(1)} s of play), ${res.carsWashed}/${res.carsTotal} cars, ${res.stats.decisions} decisions, ${res.seconds.toFixed(1)} s`)
})

t.test('the sandbox with --tokens: all three, through the grime wall, the lifts and the bonus room', () => {
  const res = solve(sandbox, { reach: reach(), tokens: true })
  ok(res.ok, `not solved${why(res)}`)
  eq(res.tokens.join(), 'true,true,true', 'tokens')
  eq(res.exit, 'goal', 'exit')
  t.notes.push(`sandbox tokens: ${res.ticks} ticks, hits ${res.hits}, ${res.seconds.toFixed(1)} s`)
})

t.test('the sandbox by the secret exit, behind grime it washes away', () => {
  const res = solve(sandbox, { reach: reach(), exit: 'secret' })
  ok(res.ok, `not solved${why(res)}`)
  eq(res.exit, 'secret', 'exit')
  eq(res.hits, 0, 'hits taken')
  t.notes.push(`sandbox secret: ${res.ticks} ticks, ${res.seconds.toFixed(1)} s`)
})

t.test('solving is deterministic: the same seed gives the same replay, input for input', () => {
  const a = createSolver(sim, contract, sandbox, { reach: reach(), seed: 7 }).solve()
  const b = createSolver(sim, contract, sandbox, { reach: reach(), seed: 7 }).solve()
  ok(a.ok && b.ok, 'both runs finish')
  eq(JSON.stringify(b.replay.attempts), JSON.stringify(a.replay.attempts), 'the two replays')
  eq(a.replay.seed, 7, 'the replay keeps its seed')
  ok(playReplay(sim, sandbox, a.replay).ok, 'and it replays')
})

/* ------------------------------------------------------------------ */
/* One obstacle each                                                   */
/* ------------------------------------------------------------------ */

/**
 * A one-area level: `above` are the rows over a floor two rows deep (blank sky is added on top
 * up to 12 rows). opts.floor: the floor's top row (a gap in it is a bottomless pit, unless
 * opts.base gives the row under it).
 */
function room(id, above, opts = {}) {
  const width = Math.max(...above.map((r) => r.length), opts.width ?? 0, (opts.floor ?? '').length)
  const floor = (opts.floor ?? FLOOR(width)).padEnd(width, '#')
  const base = (opts.base ?? floor).padEnd(width, '#')
  return t.makeLevel([...above.map((r) => r.padEnd(width)), floor, base], { id, legend: opts.legend, areas: opts.areas, time: opts.time ?? 300 })
}

t.test('a car on flat ground: washed (or jumped) without a hit, and washed for SPOTLESS', () => {
  const level = room('t-car', ['  @              c                    G   '])
  const res = solve(level)
  ok(res.ok && res.hits === 0, `goal${why(res)}`)
  const sp = solve(level, { spotless: true })
  ok(sp.ok, `spotless${why(sp)}`)
  eq(sp.carsWashed, 1, 'cars washed')
  eq(sp.hits, 0, 'hits')
})

t.test('two cars, a compact and a sedan behind it: both washed for SPOTLESS', () => {
  const level = room('t-cars', ['  @            c         s                       G   '])
  const res = solve(level, { spotless: true })
  ok(res.ok, `not solved${why(res)}`)
  eq(res.carsWashed, 2, 'cars washed')
  eq(res.hits, 0, 'hits')
})

t.test('a sedan riding a belt that runs at Maxx', () => {
  const level = room('t-belt', ['  @                    s                     G   '], { floor: '##########' + '<'.repeat(28) + '##########', base: FLOOR(48) })
  const res = solve(level, { spotless: true })
  ok(res.ok, `not solved${why(res)}`)
  eq(res.carsWashed, 1, 'cars washed')
  eq(res.hits, 0, 'hits')
})

t.test('a timed hazard: it waits for the hot wax jet in a low corridor to go off', () => {
  const kind = sim.hasBehavior('jet') ? 'jet' : null
  ok(kind, "no harmful timed kind ('jet') is registered")
  const level = room('t-jet', [
    '',
    '',
    '',
    '',
    '',
    '',
    '      ' + '%'.repeat(24),
    '                 j',
    '  @                                 G   ',
  ])
  const res = solve(level)
  ok(res.ok, `not solved${why(res)}`)
  eq(res.hits, 0, `hits${why(res)}`)
})

t.test('a moving lift across a pit 13 tiles wide', () => {
  const level = room('t-lift', ['  @                         G    '], { floor: '###### 5' + ' '.repeat(11) + '#'.repeat(15), legend: { 5: { kind: 'lift', props: { dx: 9, speed: 70, wait: 40 } } } })
  const res = solve(level)
  ok(res.ok, `not solved${why(res)}`)
  eq(res.hits, 0, 'hits')
})

t.test('a spring up to a plateau 6 tiles high that no jump reaches', () => {
  const level = t.makeLevel(
    [
      '',
      '',
      '',
      '',
      '                       G   ',
      '              #############',
      '              #############',
      '              #############',
      '              #############',
      '              #############',
      '  @       y   #############',
      FLOOR(27),
      FLOOR(27),
    ],
    { id: 't-spring' },
  )
  const res = solve(level)
  ok(res.ok, `not solved${why(res)}`)
  eq(res.hits, 0, 'hits')
})

t.test('a pipe detour for a token: down the pipe, the token, back up by the other pipe', () => {
  const room2 = {
    id: 'room',
    theme: 'bonus',
    rows: [
      ...Array(7).fill('%                      %'),
      '%  4               5   %',
      '%  PP              PP  %',
      '%  PP     $        PP  %',
      FLOOR(24),
      FLOOR(24),
    ],
    legend: { 4: { kind: 'marker', props: { name: 'in' } }, 5: { kind: 'pipe', props: { to: 'main:back' } } },
  }
  const level = room('t-pipe', ['', '', '', '', '', '', '      1', '      PP', '  @   PP      m                   G   '], {
    legend: { 1: { kind: 'pipe', props: { to: 'room:in' } }, m: { kind: 'marker', props: { name: 'back' } } },
    areas: [room2],
  })
  const plain = solve(level)
  ok(plain.ok && !plain.tokens[0], `without --tokens it walks past${why(plain)}`)
  const res = solve(level, { tokens: true })
  ok(res.ok, `not solved${why(res)}`)
  eq(res.tokens[0], true, 'the token')
  eq(res.exit, 'goal', 'exit')
})

t.test('a grime wall 6 tiles high: it washes a way through', () => {
  const level = room('t-grime', ['', '', '', '', '', '           g', '           g', '           g', '           g', '           g', '  @        g              G   '])
  const res = solve(level)
  ok(res.ok, `not solved${why(res)}`)
  eq(res.hits, 0, 'hits')
})

t.test('a gate that opens on a flag set by washing something (a test kind, a valve)', () => {
  if (!sim.hasBehavior('test_valve')) {
    sim.registerEntity('test_valve', {
      init(e) {
        sim.setBox(e, 24, 40)
        e.hp = 8
        e.maxHp = 8
        e.state = 'shut'
      },
      update() {},
      onSpray(e, w, d) {
        if (e.state === 'shut' && sim.damage(e, d.power)) {
          e.state = 'open'
          sim.setFlag(w, String(e.props.flag), 1)
        }
        return true
      },
    })
  }
  // The gate's character marks its bottom-left tile; it fills three tiles up, under a wall to the top.
  const level = room('t-valve', [...Array(7).fill('              %'), '', '', '  @     V     D     G   '], {
    legend: { V: { kind: 'test_valve', props: { flag: 'valve' } }, D: { kind: 'gate', props: { flag: 'valve', h: 3 } } },
  })
  const res = solve(level)
  ok(res.ok, `not solved${why(res)}`)
  eq(res.hits, 0, 'hits')
})

t.test('a back door locked on a rival further on: it leaves the door for the long way, and the starting flags travel in the replay', () => {
  // Rival Row in small: a shortcut door locked on 'beaten', and the long way through an arena
  // whose fighter (a test kind with boss: true, washed out by water) raises it.
  if (!sim.hasBehavior('test_rival')) {
    sim.registerEntity('test_rival', {
      init(e) {
        sim.setBox(e, 28, 48)
        e.hp = 8
        e.maxHp = 8
        e.state = 'up'
      },
      update() {},
      onSpray(e, w, d) {
        if (e.state === 'up' && sim.damage(e, d.power)) {
          e.state = 'down'
          sim.setFlag(w, 'beaten', 1)
        }
        return true
      },
      boss: true,
    })
  }
  const W = 30
  const area = (id, above) => ({ id, theme: 'backlot', rows: [...Array(12 - above.length - 2).fill(''), ...above].map((r) => r.padEnd(W)).concat([FLOOR(W), FLOOR(W)]) })
  const arena = { ...area('arena', ['  m        R        E']), legend: { m: { kind: 'marker', props: { name: 'in' } }, R: { kind: 'test_rival' }, E: { kind: 'door', props: { to: 'end:in', flag: 'beaten', min: 1 } } } }
  const end = { ...area('end', ['  m           G']), legend: { m: { kind: 'marker', props: { name: 'in' } } } }
  const level = room('t-backdoor', ['  @     K              A'], {
    width: W,
    legend: { K: { kind: 'door', props: { to: 'end:in', flag: 'beaten', min: 1 } }, A: { kind: 'door', props: { to: 'arena:in' } } },
    areas: [arena, end],
  })
  const res = solve(level, { flags: { beaten: 0 } })
  ok(res.ok && res.hits === 0, `first visit${why(res)}`)
  ok((res.bans ?? []).some((b) => /barred, and nothing in its area raises 'beaten'/.test(b)), `the barred back door is not among the moves it would not use${why(res)}`)
  eq(JSON.stringify(res.replay.attempts[0].flags), JSON.stringify({ beaten: 0 }), 'the first attempt starts with the flags it was given')
  // A returning player whose rival is beaten takes the back door straight away.
  const back = solve(level, { flags: { beaten: 1 } })
  ok(back.ok && !(back.bans ?? []).length, `returning${why(back)}`)
  ok(back.ticks < res.ticks, `the back door is not the quicker way: ${back.ticks} ticks against ${res.ticks}`)
})

t.test('a level nobody can finish: a pit 20 tiles wide (no hover crosses more than 10), reported at its edge', () => {
  const level = room('t-pit', ['  @                                   G   '], { floor: '##########                    ############' })
  const res = solve(level, { budget: 120 })
  ok(!res.ok, 'it says it solved it')
  eq(res.failure?.kind, 'unreachable', `failure kind${why(res)}`)
  const text = formatResult(res).join('\n')
  ok(/the goal at main 38,9 cannot be reached/.test(text), `names the goal's place${why(res)}`)
  // At the lip his middle is over the pit's first column.
  ok(/nearest Maxx can stand is main 10,9/.test(text), `names the lip of the pit${why(res)}`)
  ok(/STUCK at main 10,9 \(unreachable\)/.test(text), `stuck at the lip${why(res)}`)
})

t.test('a corridor a jet never stops firing into: the map says yes, play says no, and the report blames the jet', () => {
  const wall = '      ' + '%'.repeat(24)
  const level = room('t-sealed', [...Array(8).fill(wall), '                 J', '  @                                 G   '], { legend: { J: { kind: 'jet', props: { off: 0, on: 100000 } } } })
  const res = solve(level, { budget: 120 })
  ok(!res.ok, 'it says it solved it')
  const text = formatResult(res).join('\n')
  ok(/STUCK at main 1[3-6],9/.test(text), `stuck in front of the corridor${why(res)}`)
  ok(/every way on was tried in play and failed: hit by jet \(main 17,9\)/.test(text), `blames the jet${why(res)}`)
})

t.test('a brick ceiling: it breaks the brick from below, then goes up through the hole', () => {
  const level = room('t-brick', ['', '', '', '', '', '', '                  G', 'X'.repeat(10) + 'B' + 'X'.repeat(29), '', '  @'])
  const res = solve(level)
  ok(res.ok, `not solved${why(res)}`)
  eq(res.hits, 0, 'hits')
})

t.test('a pit 9 tiles wide: only the hover crosses it, and the replay holds it', () => {
  const level = room('t-hover', ['  @                              G   '], { floor: '############         ################' })
  const res = solve(level)
  ok(res.ok, `not solved${why(res)}`)
  // Held: down + spray on through a long run of ticks in the one flight.
  const masks = decodeInput(res.replay.attempts[0].input)
  let run = 0
  let longest = 0
  for (const mask of masks) longest = Math.max(longest, (run = (mask & 40) === 40 ? run + 1 : 0))
  ok(longest >= 20, `the hover held for ${longest} ticks at most`)
})

t.test('a pit 10 tiles wide: only a hover begun after the top of the jump crosses it, and the report says so', () => {
  const level = room('t-late', ['  @                                G   '], { floor: '############          ################' })
  const res = solve(level)
  ok(res.ok, `not solved${why(res)}`)
  eq(res.hits, 0, 'hits')
  ok(res.struggles.some((s) => /hover begun late/.test(s.what)), `the report does not name the late hover${why(res)}`)
  // Held all the way once begun: down + spray on through one long run of ticks.
  const masks = decodeInput(res.replay.attempts[0].input)
  let run = 0
  let longest = 0
  for (const mask of masks) longest = Math.max(longest, (run = (mask & 40) === 40 ? run + 1 : 0))
  ok(longest >= 20, `the hover held for ${longest} ticks at most`)
})

t.test('a pit 14 tiles wide: tapping the hover used to glide over it; nothing does now, reported at its edge', () => {
  const level = room('t-glide', ['  @                                     G   '], { floor: '############              ##################' })
  const res = solve(level, { budget: 120 })
  ok(!res.ok, 'it says it solved it')
  eq(res.failure?.kind, 'unreachable', `failure kind${why(res)}`)
})

t.test('an exit in an area nothing leads to: it goes as far into the level as the map goes, and says so', () => {
  const exit = { id: 'exit', theme: 'bonus', rows: t.makeLevel(['    G', FLOOR(24), FLOOR(24)]).areas[0].rows }
  const level = room('t-far', ['  @                             '], { areas: [exit] })
  const res = solve(level, { budget: 120 })
  ok(!res.ok, 'it says it solved it')
  const text = formatResult(res).join('\n')
  ok(/STUCK at main (2[5-9]|3[01]),9/.test(text), `it did not go to the far end of the level${why(res)}`)
  ok(/as near the goal as the map goes/.test(text), `the report does not say what it went for${why(res)}`)
})

t.test('every replay made above replays to the same world', () => {
  ok(runs.length >= 10, `only ${runs.length} runs`)
  for (const { level, rep } of runs) ok(rep.ok, `${level.id} does not replay`)
})

// A proven level keeps its solver runs in scripts/maxx/replays (NOTES.md 2.10): each must still
// play to the world it recorded, so a change to the level or the simulation under it shows here.
const REPLAYS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'replays')
const stored = existsSync(REPLAYS) ? readdirSync(REPLAYS).filter((f) => f.endsWith('.json')).sort() : []
for (const f of stored) {
  const rep = JSON.parse(readFileSync(path.join(REPLAYS, f), 'utf8'))
  let level = levels.levelById(rep.level)
  if (rep.file && existsSync(path.join(REPLAYS, '..', '..', '..', rep.file))) {
    const mod = await t.loadModule('/' + rep.file)
    level = [mod.default, ...Object.values(mod)].find((v) => v && v.id === rep.level) ?? level
  }
  t.test(`the stored replay ${f} still plays to the world it recorded`, () => {
    eq(rep.format, REPLAY_FORMAT, 'format')
    ok(level, `no level '${rep.level}'${rep.file ? ` in ${rep.file}` : ''}`)
    const res = playReplay(sim, level, rep)
    const where = res.attempts.map((a, i) => (a.want && a.want !== a.hash ? `attempt ${i + 1} ends ${a.hash}, recorded ${a.want}${a.diverged ? `, first differs at tick ${a.diverged[0]}` : ''}` : null)).filter(Boolean)
    // How this kind of run is made again (NOTES.md 2.10): a hand-scripted ride, or solve.mjs with the flags it started with.
    const flags0 = rep.attempts?.[0]?.flags
    const how =
      rep.ride || rep.note
        ? `make it again with scripts/maxx/rides/${f.replace(/\.json$/, '.mjs')} --out scripts/maxx/replays/${f}`
        : `re-solve the level (solve.mjs ${rep.level}${flags0 ? ` --flags ${Object.entries(flags0).map(([k, v]) => `${k}=${v}`).join(',')}` : ''} ... --out scripts/maxx/replays/${f})`
    ok(res.ok, `${f} no longer replays (${where.join('; ')}): ${how}, read the new report and replace the file`)
  })
}

await t.finish()
