// The critters (game/sim/entities/critters.ts): blob, bird and its splat, bugs, tumbleweed.
// Each kind's rules, that none of them can hurt Maxx while he blinks after a hit, that each
// can be dodged or washed by a player who reads it, and that all of it is repeatable.
//   node scripts/maxx/tests/critters.mjs [--only <text>]
import fs from 'node:fs'
import path from 'node:path'
import { suite } from '../lib/testkit.mjs'
import { GAME_DIR } from '../paths.mjs'

const t = await suite('critters')
const { sim, levels, contract } = t
const { TILE, MAXX_W, MAXX_H } = contract
const { stepWorld, createWorld, worldHash, TUNING } = sim
// The rules, as the header of sim/entities/critters.ts states them (times in ticks, sizes in px).
const CRITTERS = {
  blob: { hitGap: 8, popTicks: 18, squashTicks: 22 },
  bird: { amp: 14, tell: 20 },
  bugs: { range: 10, alert: 24, knock: 6, recoil: 50 },
}
const FLOOR_Y = 10 * TILE

const cx = (e) => e.x + e.w / 2
const cy = (e) => e.y + e.h / 2
const feetY = (w) => w.player.y + w.player.h
const sfxSeen = (events, id) => t.has(events, 'sfx', (ev) => ev.id === id)

/** Let Maxx land and everything on screen wake. Returns the input builder to carry on with. */
function settle(w, n = 12) {
  const input = t.makeInput()
  t.until(w, [], () => false, n, input)
  return input
}

/** Step with nothing held, keeping Maxx pinned on the entity: for touch tests. */
function pin(w, e, ticks, input, each) {
  for (let i = 0; i < ticks; i++) {
    if (e.dead) return i
    const p = w.player
    p.x = cx(e) - p.w / 2
    p.y = cy(e) - p.h / 2
    p.vx = 0
    p.vy = 0
    stepWorld(w, input([]))
    w.events.length = 0
    if (each && each(i) === true) return i
  }
  return ticks
}

/**
 * The rule every critter shares: while he blinks after a hit, sitting right on it costs nothing;
 * once the blinking is over the same touch does cost a pip (so the first half proves something).
 */
function blinkSafe(rows, kind, legend) {
  const w = t.flat(rows, { legend })
  const input = settle(w)
  const e = t.find(w, kind)
  t.ok(e, `no ${kind} in the room`)
  w.player.invuln = TUNING.invulnTicks
  let worst = 3
  pin(w, e, TUNING.invulnTicks - 2, input, () => {
    worst = Math.min(worst, w.player.pips)
  })
  t.eq(worst, 3, `${kind}: pips while he blinks on top of it`)
  t.ok(!e.dead, `${kind}: it should still be there`)
  const n = pin(w, e, 60, input, () => w.player.pips < 3)
  t.ok(w.player.pips < 3, `${kind}: once the blinking ended (after ${n} more ticks) it should have cost a pip`)
}

/* ------------------------------------------------------------------ */
/* blob                                                                */
/* ------------------------------------------------------------------ */

t.test('blob: 30 x 28, walks left at 30 px/s, turns at walls and at ledges', () => {
  let w = t.flat(['  @           b'])
  let input = settle(w)
  let blob = t.find(w, 'blob')
  t.eq(blob.w, 30, 'width')
  t.eq(blob.h, 28, 'height')
  t.eq(blob.hp, 3, 'hits it takes')
  t.ok(blob.harmful, 'it is harmful')
  t.eq(blob.state, 'walk', 'state')
  const x0 = blob.x
  t.until(w, [], () => false, 60, input)
  t.near(blob.x - x0, -30, 0.6, 'distance walked in a second')
  t.eq(blob.y + blob.h, FLOOR_Y, 'feet on the floor')

  // A ledge with a wall at one end: it turns at both and never falls.
  w = t.makeWorld(['  @', '', '        b    X', '     ##########', '', t.FLOOR, t.FLOOR])
  input = settle(w)
  blob = t.find(w, 'blob')
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < 900; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    minX = Math.min(minX, blob.x)
    maxX = Math.max(maxX, blob.x + blob.w)
  }
  t.near(minX, 5 * TILE, 3, 'turned at the ledge')
  t.near(maxX, 13 * TILE, 1, 'turned at the wall')
  t.ok(blob.onGround && !blob.dead, 'still on its ledge')

  // props: dir 1 starts it off to the right; edges false lets it walk off.
  w = t.makeWorld(['  @', '', '        1', '     ######', '', t.FLOOR, t.FLOOR], { legend: { 1: { kind: 'blob', props: { dir: 1, edges: false, speed: 60 } } } })
  input = settle(w)
  blob = t.find(w, 'blob')
  t.eq(blob.facing, 1, 'facing with dir 1')
  t.ok(t.until(w, [], () => blob.y + blob.h === FLOOR_Y, 400, input) > 0, 'with edges false it should walk off and land on the floor')
  t.ok(blob.x > 10 * TILE, 'it went off the right-hand end')
})

t.test('blob: three spray hits wash it away (+100), a stage at a time; water in between is wasted', () => {
  const w = t.flat(['  @           b'])
  const input = settle(w)
  const blob = t.find(w, 'blob')
  t.eq(t.spray(w, blob), true, 'the droplet is used up')
  t.eq(blob.hp, 2, 'hp after one hit')
  t.eq(blob.w, 28, 'it narrows with the art: width after one hit')
  t.eq(blob.h, 28, 'and keeps its height')
  t.eq(blob.state, 'hit', 'it reels')
  t.eq(t.spray(w, blob), true, 'a droplet during the reel is still used up')
  t.eq(blob.hp, 2, 'but takes nothing off')
  const x0 = blob.x
  t.until(w, [], () => blob.state === 'walk', 30, input)
  t.eq(blob.stateT, 0, 'back to walking')
  t.eq(blob.x, x0, 'it stood still while it reeled')
  const mid = cx(blob)
  t.eq(w.tick - 12, CRITTERS.blob.hitGap, 'ticks the reel lasts')
  t.spray(w, blob)
  t.eq(blob.hp, 1, 'hp after two hits')
  t.eq(blob.w, 26, 'width after two hits')
  t.eq(cx(blob), mid, 'it narrows about its middle')
  t.until(w, [], () => blob.state === 'walk', 30, input)
  t.ok(blob.harmful, 'still harmful at one hit left')
  const before = w.events.length
  t.spray(w, blob)
  t.eq(blob.state, 'pop', 'washed')
  t.eq(blob.harmful, false, 'harmless once washed')
  t.eq(w.stats.score, 100, 'score')
  t.ok(sfxSeen(w.events.slice(before), 'pop'), "the 'pop' sound")
  t.ok(t.has(w.events, 'popup', (ev) => ev.text === '100'), 'the 100 floats up')
  t.ok(t.has(w.events, 'fx', (ev) => ev.fx === 'bubble'), 'clean bubbles')
  t.eq(t.spray(w, blob), false, 'water goes through what is left')
  const gone = t.until(w, [], () => !t.find(w, 'blob'), 60, input)
  t.eq(gone, CRITTERS.blob.popTicks, 'ticks until it is gone')
  t.eq(w.stats.score, 100, 'scored once')

  // Turbo water counts double: two hits.
  const w2 = t.flat(['  @           b'])
  const in2 = settle(w2)
  const b2 = t.find(w2, 'blob')
  t.spray(w2, b2, 2)
  t.eq(b2.hp, 1, 'hp after one turbo hit')
  t.until(w2, [], () => b2.state === 'walk', 30, in2)
  t.spray(w2, b2, 2)
  t.eq(b2.state, 'pop', 'two turbo hits wash it')
})

t.test('blob: the prep gun washes it at arm\'s length and from across the room, before it arrives', () => {
  for (const gap of [1, 2, 3, 5, 8]) {
    const w = t.flat(['  @' + ' '.repeat(gap) + 'b'])
    const input = t.makeInput()
    const n = t.until(w, ['spray'], () => !t.find(w, 'blob') || w.player.pips < 3, 400, input)
    t.ok(n > 0, `${gap} tiles: nothing happened`)
    t.eq(w.player.pips, 3, `${gap} tiles off: pips`)
    t.eq(w.stats.score, 100, `${gap} tiles off: score`)
  }
  // Close enough to touch noses: only a 28 px blob can be washed from here.
  const w = t.flat(['  @           b'])
  const input = settle(w)
  const blob = t.find(w, 'blob')
  blob.x = w.player.x + w.player.w + 4
  blob.px = blob.x
  t.until(w, ['spray'], () => blob.state === 'pop' || w.player.pips < 3, 200, input)
  t.eq(w.player.pips, 3, 'pips with the blob 4 px off his toes')
  t.eq(blob.state, 'pop', 'washed at point-blank range')
})

t.test('blob: one stomp squashes it (+100) and bounces him; any other touch costs a pip', () => {
  let w = t.flat(['  @', '', '', '  b'])
  let input = t.makeInput()
  let blob = t.find(w, 'blob')
  const seen = []
  t.until(w, [], () => blob.state === 'squash' || w.player.pips < 3, 200, input, seen)
  t.eq(blob.state, 'squash', 'state after he lands on it')
  t.eq(w.player.pips, 3, 'a stomp does not hurt')
  t.near(-w.player.vy, TUNING.stompBounce, 40, 'bounce speed')
  t.eq(w.stats.score, 100, 'score')
  t.eq(blob.harmful, false, 'harmless once flat')
  t.ok(sfxSeen(seen, 'stomp'), "the 'stomp' sound")
  const gone = t.until(w, [], () => !t.find(w, 'blob'), 60, input)
  t.eq(gone, CRITTERS.blob.squashTicks, 'ticks the flat blob stays')
  t.eq(w.player.pips, 3, 'landing on the flat blob again costs nothing')

  // Jump held: the high bounce.
  w = t.flat(['  @', '', '', '  b'])
  input = t.makeInput()
  blob = t.find(w, 'blob')
  t.until(w, ['jump'], () => blob.state === 'squash', 200, input)
  t.near(-w.player.vy, TUNING.stompBounceHeld, 40, 'bounce speed with jump held')

  // Walk into it.
  w = t.flat(['  @     b'])
  input = settle(w)
  t.until(w, ['right'], () => w.player.pips < 3, 300, input)
  t.eq(w.player.pips, 2, 'walking into it costs a pip')
  t.ok(w.player.vx < 0, 'knocked back, away from it')
  t.eq(t.find(w, 'blob').state, 'walk', 'the blob carries on')
})

t.test('blob: two that meet head on both turn round, and never walk through each other', () => {
  const w = t.flat(['  @     X  1      b  X'], { legend: { 1: { kind: 'blob', props: { dir: 1 } } } })
  const input = settle(w)
  const [a, b] = t.all(w, 'blob')
  let deepest = 0
  let turns = 0
  let last = a.facing
  for (let i = 0; i < 1500; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    deepest = Math.max(deepest, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    if (a.facing !== last) turns++
    last = a.facing
  }
  t.ok(deepest <= 2, `they overlapped by ${deepest} px`)
  t.ok(turns >= 4 && turns <= 12, `the left one turned ${turns} times in 25 s`)
  t.ok(a.x < b.x, 'they kept their order')
})

t.test('blob: with no room to walk (a one-tile pillar, a one-tile pen, a belt into a wall) it stands and looks about, never spins', () => {
  for (const [rows, label] of [
    [['  @', '', '', '          b', '          #', '', t.FLOOR, t.FLOOR], 'one-tile pillar'],
    [['  @', '', '', '         X X', '         XbX', t.FLOOR, t.FLOOR], 'one-tile pen'],
  ]) {
    const w = t.makeWorld(rows)
    const input = settle(w)
    const blob = t.find(w, 'blob')
    const y0 = blob.y
    let turns = 0
    let last = blob.facing
    for (let i = 0; i < 600; i++) {
      stepWorld(w, input([]))
      w.events.length = 0
      if (blob.facing !== last) turns++
      last = blob.facing
    }
    t.ok(turns >= 4 && turns <= 16, `${label}: it turned ${turns} times in 10 s (it should look about, not spin)`)
    t.eq(blob.y, y0, `${label}: it stays up there`)
    t.ok(!blob.dead && blob.onGround, `${label}: still standing`)
    t.notes.push(`blob: ${label}, ${turns} turns in 10 s`)
  }
  // A belt that carries it (30 px/s walking against 60) into a wall: it treads water there, facing away.
  {
    const w = t.makeWorld(['  @', '', '', '         b   X', '      >>>>>>>##', '', t.FLOOR, t.FLOOR])
    const input = settle(w)
    const blob = t.find(w, 'blob')
    let turns = 0
    let last = blob.facing
    for (let i = 0; i < 600; i++) {
      stepWorld(w, input([]))
      w.events.length = 0
      if (blob.facing !== last) turns++
      last = blob.facing
    }
    t.ok(turns <= 2, `on a belt into a wall it turned ${turns} times`)
    t.near(blob.x + blob.w, 13 * TILE, 1, 'held against the wall')
    t.eq(blob.facing, -1, 'facing away from the wall, walking against the belt')
  }
  // A long ledge is not cramped: it walks the whole of it without stopping.
  const w = t.makeWorld(['  @', '', '', '        b', '     ########', '', t.FLOOR, t.FLOOR])
  const input = settle(w)
  const blob = t.find(w, 'blob')
  let still = 0
  for (let i = 0; i < 900; i++) {
    const x = blob.x
    stepWorld(w, input([]))
    w.events.length = 0
    if (blob.x === x) still++
  }
  t.ok(still <= 4, `on an 8-tile ledge it stood still for ${still} ticks`)
})

t.test('blob: cannot hurt him while he blinks; Mighty Wax washes it on touch', () => {
  blinkSafe(['  @           b'], 'blob')
  const w = t.flat(['  @     b'])
  const input = settle(w)
  w.player.wax = 300
  const blob = t.find(w, 'blob')
  t.until(w, ['right'], () => blob.state !== 'walk', 300, input)
  t.eq(blob.state, 'pop', 'washed by the wax')
  t.eq(w.player.pips, 3, 'pips')
  t.eq(w.stats.score, 100, 'score')
})

/* ------------------------------------------------------------------ */
/* bird and splat                                                      */
/* ------------------------------------------------------------------ */

const BIRD_ROWS = (bird, maxxCol = 2) => [' '.repeat(18) + bird, '', '', '', ' '.repeat(maxxCol) + '@']

t.test('bird: 28 x 20, flies a wave at 70 px/s to and fro over its beat', () => {
  const w = t.flat(BIRD_ROWS('r'))
  const input = settle(w, 2)
  const bird = t.find(w, 'bird')
  t.eq(bird.w, 28, 'width')
  t.eq(bird.h, 20, 'height')
  t.eq(bird.hp, 2, 'hits it takes')
  t.ok(bird.harmful, 'harmful')
  const homeX = bird.spawnX
  const homeY = bird.spawnY
  let top = Infinity
  let bottom = -Infinity
  let left = Infinity
  let right = -Infinity
  let fastest = 0
  let turns = 0
  let facing = bird.facing
  for (let i = 0; i < 1400; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    top = Math.min(top, bird.y)
    bottom = Math.max(bottom, bird.y)
    left = Math.min(left, bird.x)
    right = Math.max(right, bird.x)
    fastest = Math.max(fastest, Math.abs(bird.vx))
    if (bird.facing !== facing) turns++
    facing = bird.facing
  }
  t.near(top, homeY - CRITTERS.bird.amp, 0.2, 'top of the wave')
  t.near(bottom, homeY + CRITTERS.bird.amp, 0.2, 'bottom of the wave')
  t.near(fastest, 70, 0.001, 'top speed')
  t.near(left, homeX - 5 * TILE, 12, 'left end of its beat')
  t.near(right, homeX + 5 * TILE, 12, 'right end of its beat')
  t.ok(turns >= 2, `it turned ${turns} times`)
  t.eq(t.all(w, 'splat').length, 0, 'no splat while Maxx is far off')
  t.eq(bird.state, 'fly', 'state')

  // range 0: straight on, never back. A wall turns any bird.
  const w2 = t.flat(BIRD_ROWS('1'), { legend: { 1: { kind: 'bird', props: { range: 0, dir: 1 } } } })
  const in2 = settle(w2, 2)
  const b2 = t.find(w2, 'bird')
  const x0 = b2.x
  t.until(w2, [], () => false, 300, in2)
  t.ok(b2.x - x0 > 330, `with range 0 it flew ${Math.round(b2.x - x0)} px right in 5 s`)
  const w3 = t.flat(['      %     r     %', '', '', '', '  @'], { legend: { r: { kind: 'bird', props: { range: 30 } } } })
  const in3 = settle(w3, 2)
  const b3 = t.find(w3, 'bird')
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 1500; i++) {
    stepWorld(w3, in3([]))
    w3.events.length = 0
    lo = Math.min(lo, b3.x)
    hi = Math.max(hi, b3.x + b3.w)
  }
  t.ok(lo >= 7 * TILE && hi <= 18 * TILE, `it flew into a wall: ${Math.round(lo)}..${Math.round(hi)}`)
  t.ok(lo < 8 * TILE + 8 && hi > 17 * TILE - 8, `it should use the whole gap: ${Math.round(lo)}..${Math.round(hi)}`)
})

/** A grackle on a one-tile beat right over Maxx, who stands under a catwalk so nothing reaches him. */
function underBird(extra = {}) {
  const w = t.flat(['   r', '', '  ===', '', '  @'], { legend: { r: { kind: 'bird', props: { range: 1, ...extra } } } })
  return { w, input: settle(w, 2), bird: t.find(w, 'bird') }
}

t.test('bird: within 160 px it drops a splat every 110 to 150 ticks, after 20 ticks of warning', () => {
  const { w, input, bird } = underBird()
  const drops = []
  let tellRun = 0
  let squawks = 0
  for (let i = 0; i < 1500; i++) {
    const state = bird.state
    stepWorld(w, input([]))
    for (const ev of w.events) if (ev.type === 'sfx' && ev.id === 'squawk') squawks++
    w.events.length = 0
    const now = t.all(w, 'splat').filter((s) => s.state === 'fall' && s.stateT === 0).length
    if (now > 0) {
      drops.push({ tick: w.tick, warned: tellRun })
      t.eq(state, 'tell', 'state on the tick before a drop')
    }
    tellRun = bird.state === 'tell' ? tellRun + 1 : 0
  }
  t.ok(drops.length >= 9, `only ${drops.length} drops in 25 s`)
  for (const d of drops) t.eq(d.warned, CRITTERS.bird.tell, 'ticks of warning before a drop')
  for (let i = 1; i < drops.length; i++) {
    const gap = drops[i].tick - drops[i - 1].tick
    t.ok(gap >= 110 && gap <= 150, `drops ${gap} ticks apart`)
  }
  t.ok(drops[0].tick >= 50, `the first drop came after only ${drops[0].tick} ticks`)
  t.eq(squawks, drops.length, 'one squawk per warning')
  t.eq(w.player.pips, 3, 'under the catwalk nothing reached him')
  t.notes.push(`bird: ${drops.length} drops in 1500 ticks, gaps ${drops.slice(1).map((d, i) => d.tick - drops[i].tick).join(' ')}`)

  // Out of reach sideways: never.
  const far = t.flat(BIRD_ROWS('1'), { legend: { 1: { kind: 'bird', props: { range: 1 } } } })
  const farIn = settle(far, 2)
  let told = false
  for (let i = 0; i < 900; i++) {
    stepWorld(far, farIn([]))
    far.events.length = 0
    if (t.find(far, 'bird').state === 'tell') told = true
  }
  t.ok(!told && t.all(far, 'splat').length === 0, 'it dropped with Maxx 500 px away')
})

t.test('bird: while it warns it hangs still; a hit then spoils the drop', () => {
  const { w, input, bird } = underBird()
  t.ok(t.until(w, [], () => bird.state === 'tell', 400, input) > 0, 'it never warned')
  const y0 = bird.y
  t.until(w, [], () => bird.stateT >= 15, 30, input)
  t.eq(bird.y, y0, 'it holds its height while it warns')
  t.near(bird.vx, 0, 0.001, 'and stops')
  t.spray(w, bird)
  t.eq(bird.state, 'hit', 'state after the hit')
  t.eq(bird.hp, 1, 'hp')
  t.until(w, [], () => false, 40, input)
  t.eq(t.all(w, 'splat').length, 0, 'the drop it was warning of never came')
  t.ok(t.until(w, [], () => t.all(w, 'splat').length > 0, 200, input) > 0, 'it drops again later')
})

t.test('bird: two spray hits and it flees upward, squawking (+200), harmless, then gone', () => {
  const w = t.flat(BIRD_ROWS('r'))
  const input = settle(w, 2)
  const bird = t.find(w, 'bird')
  t.spray(w, bird)
  t.eq(bird.hp, 1, 'hp after one hit')
  t.eq(bird.state, 'hit', 'it flinches')
  t.spray(w, bird)
  t.eq(bird.hp, 1, 'water during the flinch is wasted')
  t.until(w, [], () => bird.state === 'fly', 40, input)
  t.eq(w.stats.score, 0, 'no score yet')
  t.spray(w, bird)
  t.eq(bird.state, 'flee', 'it flees')
  t.eq(bird.harmful, false, 'harmless')
  t.eq(w.stats.score, 200, 'score')
  t.eq(bird.vars.fx, cx(bird), 'where the feathers come loose (x)')
  t.eq(t.spray(w, bird), false, 'water goes past a fleeing bird')
  const y0 = bird.y
  const seen = t.steps(w, [], 20, input)
  t.ok(bird.y < y0 - 20, `it rose only ${Math.round(y0 - bird.y)} px in 20 ticks`)
  t.ok(seen.filter((ev) => ev.type === 'sfx' && ev.id === 'squawk').length >= 1, 'the second squawk')
  // Sitting on it now costs nothing.
  pin(w, bird, 10, input)
  t.eq(w.player.pips, 3, 'touching a fleeing bird')
  const n = t.until(w, [], () => !t.find(w, 'bird'), 200, input)
  t.ok(n > 0, 'it never left')
  t.ok(bird.y + bird.h < w.camera.y, 'it left by the top of the screen')
  t.eq(w.stats.score, 200, 'scored once')
})

t.test('bird: it hurts to touch, from above too; never while he blinks; wax shoos it', () => {
  // Drop onto it from above: a grackle is not a stepping stone.
  let w = t.flat(['  @', '', '  1', '', '', '', ''], { legend: { 1: { kind: 'bird', props: { range: 0, speed: 0, amp: 0 } } } })
  let input = t.makeInput()
  t.until(w, [], () => w.player.pips < 3 || w.player.onGround, 200, input)
  t.eq(w.player.pips, 2, 'landing on it costs a pip')
  t.eq(t.find(w, 'bird').state, 'fly', 'and the bird is none the worse')

  blinkSafe(BIRD_ROWS('r'), 'bird')

  w = t.flat(BIRD_ROWS('r'))
  input = settle(w, 2)
  const bird = t.find(w, 'bird')
  w.player.wax = 300
  pin(w, bird, 3, input)
  t.eq(bird.state, 'flee', 'wax shoos it')
  t.eq(w.stats.score, 200, 'score')
  t.eq(w.player.pips, 3, 'pips')
})

t.test('bird: aiming up from the ground reaches a grackle four tiles up', () => {
  // The sandbox arrangement: its row is four tiles above the floor.
  const w = t.flat(['       1', '', '', '', '  @'], { legend: { 1: { kind: 'bird', props: { range: 0, speed: 0 } } } })
  const input = settle(w)
  const bird = t.find(w, 'bird')
  const n = t.until(w, ['up', 'spray'], () => bird.state === 'flee', 300, input)
  t.ok(n > 0, `up-spray from ${Math.round(cx(bird) - (w.player.x + MAXX_W / 2))} px off never shooed it`)
  t.notes.push(`bird: shooed from the ground in ${n} ticks of up-spray, standing ${Math.round(cx(bird) - (w.player.x + MAXX_W / 2))} px to its left`)
})

/** Is any corner of the box (inset 1 px) in a solid tile? */
const inTile = (w, e) => [[e.x + 1, e.y + 1], [e.x + e.w - 1, e.y + 1], [e.x + 1, e.y + e.h - 1], [e.x + e.w - 1, e.y + e.h - 1]].some(([x, y]) => sim.solidAt(w, x, y))

t.test('bird: its wave flattens against a ceiling or a ledge and never takes it into the tiles', () => {
  for (const [rows, label] of [
    [['%%%%%%%%%%%%%%%%%%%%%%%%%%', '          r', '', '', '', '  @'], 'a ceiling right over its row'],
    [['', '', '          r', '            ####', '', '', '  @'], 'a ledge right under its row'],
    [['', '%%%%%%', '          r', '              ####', '', '', '  @'], 'a ceiling behind, a ledge ahead'],
  ]) {
    const w = t.flat(rows)
    const input = settle(w, 2)
    const bird = t.find(w, 'bird')
    let bad = 0
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < 1500; i++) {
      stepWorld(w, input([]))
      w.events.length = 0
      if (inTile(w, bird)) bad++
      lo = Math.min(lo, bird.x)
      hi = Math.max(hi, bird.x)
    }
    t.eq(bad, 0, `${label}: ticks with the bird in a tile`)
    t.ok(hi - lo > 6 * TILE, `${label}: it should still fly its beat (${Math.round(hi - lo)} px)`)
  }
})

t.test('bird: over a ledge it holds its drop, and every splat starts in the clear', () => {
  // Low over a ledge with Maxx below: the space under it is tile, so it never warns of a drop that could not fall.
  let w = t.flat(['', '', '', '', '         1', '      ######', '', '', '  @'], { legend: { 1: { kind: 'bird', props: { range: 2, amp: 0 } } } })
  let input = settle(w)
  let tells = 0
  for (let i = 0; i < 1500; i++) {
    w.player.x = 9 * TILE
    stepWorld(w, input([]))
    w.events.length = 0
    if (t.find(w, 'bird').state === 'tell') tells++
  }
  t.eq(tells, 0, 'ticks spent warning over a ledge')
  t.eq(t.all(w, 'splat').length, 0, 'splats')
  // Its wave takes it up off a ledge now and then: then it drops, and the splat starts clear of the ledge and lands on it.
  w = t.flat(['', '', '', '', '         1', '      ######', '', '', '  @'], { legend: { 1: { kind: 'bird', props: { range: 2 } } } })
  input = settle(w)
  const ledgeTop = t.find(w, 'bird').spawnY + t.find(w, 'bird').h
  let drops = 0
  let landedOnLedge = 0
  for (let i = 0; i < 2000; i++) {
    w.player.x = 9 * TILE
    stepWorld(w, input([]))
    w.events.length = 0
    for (const s of t.all(w, 'splat')) {
      if (s.state === 'fall' && s.stateT === 0) {
        drops++
        t.ok(!inTile(w, s), `a splat began inside a tile at tick ${w.tick}`)
      }
      if (s.state === 'land' && s.stateT === 0 && s.y + s.h === ledgeTop) landedOnLedge++
    }
  }
  t.ok(drops >= 3 && landedOnLedge === drops, `${drops} drops, ${landedOnLedge} landed on the ledge`)
})

t.test('splat: falls at 290 px/s at most, costs a pip, bursts on the floor or a catwalk, washes out of the air', () => {
  t.eq(sim.getBehavior('splat').offscreen, 'remove', 'offscreen')
  // On his head.
  let w = t.flat(['  @'])
  let input = settle(w)
  let splat = sim.shoot(w, 'splat', w.player.x + MAXX_W / 2, feetY(w) - 200, 0, 30)
  t.eq(splat.w, 10, 'width')
  t.eq(splat.h, 12, 'height')
  let fastest = 0
  t.until(w, [], () => ((fastest = Math.max(fastest, splat.vy)), w.player.pips < 3), 200, input)
  t.eq(w.player.pips, 2, 'a splat on the head costs a pip')
  t.ok(fastest <= 290, `it fell at ${fastest} px/s`)
  t.ok(!t.find(w, 'splat'), 'it is used up')

  // On the floor.
  w = t.flat(['  @'])
  input = settle(w)
  splat = sim.shoot(w, 'splat', 300, FLOOR_Y - 250, 0, 30)
  const seen = []
  t.ok(t.until(w, [], () => splat.state === 'land', 300, input, seen) > 0, 'it never landed')
  t.eq(splat.y + splat.h, FLOOR_Y, 'on the floor')
  t.eq(splat.harmful, false, 'harmless once it has landed')
  t.near(fastest, 290, 0.001, 'terminal speed')
  t.ok(sfxSeen(seen, 'splat'), "the 'splat' sound")
  pin(w, splat, 5, input)
  t.eq(w.player.pips, 3, 'standing in the puddle')
  t.ok(t.until(w, [], () => !t.find(w, 'splat'), 80, input) > 0, 'the puddle goes')

  // On a catwalk: shelter.
  w = t.flat(['  @     ===', '', ''])
  input = settle(w)
  splat = sim.shoot(w, 'splat', 9 * TILE + 16, 60, 0, 30)
  t.until(w, [], () => splat.state === 'land', 300, input)
  t.eq(splat.y + splat.h, 7 * TILE, 'it bursts on the catwalk')

  // Water.
  w = t.flat(['  @'])
  input = settle(w)
  splat = sim.shoot(w, 'splat', 300, 60, 0, 30)
  t.eq(t.spray(w, splat), true, 'the droplet is used up')
  t.until(w, [], () => false, 1, input)
  t.ok(!t.find(w, 'splat'), 'washed out of the air')

  // Blinking: it falls on through him.
  w = t.flat(['  @'])
  input = settle(w)
  w.player.invuln = 80
  splat = sim.shoot(w, 'splat', w.player.x + MAXX_W / 2, feetY(w) - 120, 0, 30)
  t.until(w, [], () => splat.state === 'land', 200, input)
  t.eq(w.player.pips, 3, 'a splat while he blinks')
})

t.test('splat: a player who moves when the grackle rears up is never hit', () => {
  // Out in the open under a grackle that barely moves: the worst case, it is always overhead.
  const w = t.flat(['          r', '', '', '', '  @'], { legend: { r: { kind: 'bird', props: { range: 1 } } } })
  const input = settle(w)
  const bird = t.find(w, 'bird')
  const p = w.player
  const home = bird.spawnX + bird.w / 2
  let landed = 0
  let warnToHead = Infinity
  let warnedAt = 0
  for (let i = 0; i < 3000; i++) {
    const mid = p.x + p.w / 2
    // What he can see: the bird rearing up, or a splat still in the air.
    let threat = bird.state === 'tell' ? cx(bird) : null
    for (const s of t.all(w, 'splat')) if (s.state === 'fall') threat = cx(s)
    let held = []
    if (threat !== null) {
      if (Math.abs(mid - threat) < 48) held = [mid >= threat ? 'right' : 'left']
    } else if (Math.abs(mid - home) > 6) {
      held = [mid < home ? 'right' : 'left']
    }
    if (bird.state === 'tell' && bird.stateT === 1) warnedAt = w.tick
    stepWorld(w, input(held))
    w.events.length = 0
    for (const s of t.all(w, 'splat')) {
      if (s.state === 'land' && s.stateT === 0) landed++
      if (s.state === 'fall' && s.y + s.h >= p.y && s.y + s.h < p.y + 6) warnToHead = Math.min(warnToHead, w.tick - warnedAt)
    }
  }
  t.ok(landed >= 15, `only ${landed} splats landed in 50 s`)
  t.eq(p.pips, 3, 'pips after ' + landed + ' splats')
  t.ok(warnToHead >= 40, `from the squawk to head height took only ${warnToHead} ticks`)
  t.notes.push(`splat: ${landed} dodged in a row; from the squawk to head height ${warnToHead} ticks (a grackle four tiles up)`)
})

t.test('splat: lands on a lift and rides it, on a car roof (dirty or washed) and rides it, slides off a corner, sinks in sludge', () => {
  // A lift going up and one going down.
  for (const dy of [-3, 3]) {
    const w = t.makeWorld(['  @', '', '', '', '', '          L', '', '', '', t.FLOOR, t.FLOOR], { legend: { L: { kind: 'lift', props: { dy, w: 3 } } } })
    const input = settle(w, 30)
    const lift = t.find(w, 'lift')
    const s = sim.shoot(w, 'splat', cx(lift), 20, 0, 30)
    let worst = -1
    t.ok(t.until(w, [], () => s.state === 'land', 300, input) > 0, `lift dy ${dy}: it never landed`)
    for (let i = 0; i < 30; i++) {
      stepWorld(w, input([]))
      w.events.length = 0
      worst = Math.max(worst, Math.abs(s.y + s.h - lift.y))
    }
    t.ok(worst <= 1, `lift dy ${dy}: it came ${worst} px off the moving lift`)
  }
  // Parked cars, dirty and washed: it lands on the roof, and stays on it as the car drives off.
  for (const props of [{ speed: 0 }, { clean: true, speed: 0 }, {}]) {
    const w = t.flat(['  @            1'], { legend: { 1: { kind: 'car', variant: 'compact', props } } })
    const input = settle(w)
    const car = t.find(w, 'car')
    const s = sim.shoot(w, 'splat', cx(car), car.y - 60, 0, 30)
    t.until(w, [], () => s.state === 'land' || s.dead, 200, input)
    t.eq(s.y + s.h, car.y, `${JSON.stringify(props)}: on the roof`)
    const offset = cx(s) - car.x
    t.until(w, [], () => false, 20, input)
    t.near(cx(s) - car.x, offset, 0.01, `${JSON.stringify(props)}: carried with the car`)
    t.eq(s.y + s.h, car.y, `${JSON.stringify(props)}: still on the roof`)
  }
  // The very corner of a ledge: it slides off and lands on the floor below, not on thin air.
  {
    const w = t.flat(['  @', '', '', '', '      ###', '', ''])
    const input = settle(w)
    // Its box overlaps the ledge's right end by 3 px.
    const s = sim.shoot(w, 'splat', 9 * TILE + 2, 2 * TILE, 0, 30)
    t.until(w, [], () => s.state === 'land', 300, input)
    t.eq(s.y + s.h, FLOOR_Y, 'it landed on the floor below the corner')
    t.ok(s.x >= 9 * TILE, 'clear of the ledge')
  }
  // Sludge: into it with a plop, not onto the floor of the pit under it.
  {
    const w = t.makeWorld(['  @', '', '', '', '', '', '', '#######~~~~###########', t.FLOOR])
    const input = settle(w)
    const s = sim.shoot(w, 'splat', 8 * TILE + 16, 20, 0, 30)
    let landed = false
    const seen = []
    t.until(w, [], () => ((landed = landed || s.state === 'land'), s.dead), 300, input, seen)
    t.ok(s.dead && !landed, 'it went into the sludge without landing')
    t.ok(t.has(seen, 'fx', (ev) => ev.fx === 'mud'), 'a plop of mud')
  }
})

t.test('the grackle and the splat in the dev room: canopy, ledge, cars and a lift, played through without a stuck splat', () => {
  const level = levels.levelById('dev-critters')
  const w = createWorld(level, { session: t.freshSession(), checkpoint: { areaId: 'main', x: 470 * TILE + 16, y: FLOOR_Y } })
  const input = t.makeInput()
  let drops = 0
  for (let i = 0; i < 2400; i++) {
    // Pace to and fro under the grackles.
    const p = w.player
    stepWorld(w, input(Math.floor(i / 200) % 2 ? ['left'] : ['right']))
    w.events.length = 0
    p.invuln = 10
    for (const s of t.all(w, 'splat')) {
      if (s.state === 'fall' && s.stateT === 0) drops++
      if (s.state === 'land') t.ok(!inTile(w, s), `a splat lies inside a tile at ${Math.round(s.x)},${Math.round(s.y)}`)
    }
    for (const b of t.all(w, 'bird')) t.ok(!inTile(w, b), `a grackle flew into a tile at ${Math.round(b.x)},${Math.round(b.y)}`)
  }
  t.ok(drops >= 6, `only ${drops} drops`)
})

/* ------------------------------------------------------------------ */
/* bugs                                                                */
/* ------------------------------------------------------------------ */

t.test('bugs: 36 x 36, hangs still until Maxx is within range, bunches up 24 ticks, then drifts at him at 40 px/s', () => {
  const w = t.flat(['  @               u', ''])
  const input = settle(w, 2)
  const bugs = t.find(w, 'bugs')
  t.eq(bugs.w, 36, 'width')
  t.eq(bugs.h, 36, 'height')
  t.eq(bugs.hp, 6, 'hits it takes')
  const x0 = bugs.x
  const y0 = bugs.y
  t.until(w, [], () => false, 200, input)
  t.eq(bugs.state, 'idle', 'state with Maxx 16 tiles off')
  t.ok(bugs.x === x0 && bugs.y === y0, 'it hangs where it was put')
  // He walks up.
  t.ok(t.until(w, ['right'], () => bugs.state === 'alert', 300, input) > 0, 'it never noticed him')
  const far = Math.hypot(cx(bugs) - (w.player.x + MAXX_W / 2), cy(bugs) - (w.player.y + MAXX_H / 2))
  // He runs 3.6 px a tick and the swarm looks before he moves.
  t.near(far, CRITTERS.bugs.range * TILE, 8, 'distance at which it notices')
  const alertTicks = t.until(w, [], () => bugs.state !== 'alert', 100, input)
  t.eq(alertTicks, CRITTERS.bugs.alert, 'ticks bunched up')
  t.eq(bugs.state, 'chase', 'then it comes')
  t.ok(bugs.x === x0 && bugs.y === y0, 'it has not moved yet')
  let fastest = 0
  let closing = true
  let last = Infinity
  for (let i = 0; i < 240; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    fastest = Math.max(fastest, Math.hypot(bugs.vx, bugs.vy))
    const d = Math.hypot(cx(bugs) - (w.player.x + MAXX_W / 2), cy(bugs) - (w.player.y + MAXX_H / 2))
    if (d > last + 0.001) closing = false
    last = d
  }
  t.near(fastest, 40, 0.001, 'top speed')
  t.ok(closing, 'it should close on him steadily')
  t.near(far - last, 40 * 4, 16, 'ground made up in four seconds')
})

t.test('bugs: comes through a wall, stings once, backs off, comes again; gives up when he is far away', () => {
  const w = t.flat(['       %', '       %', '  @    %   u'])
  const input = settle(w, 2)
  const bugs = t.find(w, 'bugs')
  const n = t.until(w, [], () => w.player.pips < 3, 900, input)
  t.ok(n > 0, 'it never reached him through the wall')
  t.eq(w.player.pips, 2, 'the sting costs a pip')
  t.eq(bugs.state, 'recoil', 'then it backs off')
  let d0 = Math.hypot(cx(bugs) - (w.player.x + MAXX_W / 2), cy(bugs) - (w.player.y + MAXX_H / 2))
  t.until(w, [], () => bugs.state !== 'recoil', 100, input)
  const d1 = Math.hypot(cx(bugs) - (w.player.x + MAXX_W / 2), cy(bugs) - (w.player.y + MAXX_H / 2))
  t.ok(d1 > d0 + 20, `it backed off only ${Math.round(d1 - d0)} px`)
  t.eq(bugs.state, 'chase', 'and comes again')
  const again = t.until(w, [], () => w.player.pips < 2, 900, input)
  t.ok(again > 0, 'it should sting again if he never moves')
  t.ok(again + CRITTERS.bugs.recoil > TUNING.invulnTicks + 30, `the second sting came ${again + CRITTERS.bugs.recoil} ticks after the first`)

  // Far away (but not so far that it is put to sleep): once it has finished backing off, it stops.
  t.place(w, cx(bugs) + 600, FLOOR_Y)
  t.ok(t.until(w, [], () => bugs.state === 'idle', 80, input) > 0, 'it should give up at 1.75 x its range, not stay ' + bugs.state)
  t.until(w, [], () => false, 40, input)
  d0 = bugs.x
  t.until(w, [], () => false, 60, input)
  t.eq(bugs.state, 'idle', 'it stays put')
  t.eq(bugs.x, d0, 'having drifted to a stop')
  t.eq(Math.hypot(bugs.vx, bugs.vy), 0, 'speed')
})

t.test('bugs: frozen while he is in a pipe; a pipe that takes him far enough away shakes them off', () => {
  const level = levels.levelById('dev-critters')
  const w = createWorld(level, { session: t.freshSession(), checkpoint: { areaId: 'main', x: 567 * TILE + 16, y: FLOOR_Y } })
  const input = t.makeInput()
  t.until(w, [], () => false, 4, input)
  const bugs = t.all(w, 'bugs').sort((a, b) => Math.abs(a.x - w.player.x) - Math.abs(b.x - w.player.x))[0]
  t.ok(bugs && bugs.active, 'the swarm of the pipe room is awake')
  t.ok(t.until(w, [], () => bugs.state === 'chase' && Math.abs(cx(bugs) - (w.player.x + MAXX_W / 2)) < 100, 600, input) > 0, 'it came for him')
  // Onto the pipe (blinking, so the swarm on his tail cannot knock him off it) and down.
  w.player.invuln = 120
  t.place(w, 570 * TILE, 8 * TILE)
  t.until(w, [], () => w.player.onGround, 30, input)
  t.ok(t.until(w, ['down'], () => w.warp !== null, 20, input) > 0, 'into the pipe')
  const x0 = bugs.x
  const y0 = bugs.y
  let moved = false
  t.until(w, [], () => ((moved = moved || bugs.x !== x0 || bugs.y !== y0), w.warp === null), 300, input)
  t.ok(!moved, 'the swarm stood still during the trip')
  t.ok(w.player.x > 590 * TILE, 'he came out of the far pipe')
  // Left far behind it gives up, or (as here, 25 tiles back) falls asleep with the screen gone.
  t.ok(t.until(w, [], () => bugs.state === 'idle' || !bugs.active, 120, input) > 0, `it is still after him (state ${bugs.state})`)
  t.until(w, [], () => false, 300, input)
  t.eq(w.player.pips, 3, 'pips')
})

t.test('bugs: six spray hits scatter it (+200); each one thins it, stops it and knocks it back', () => {
  const w = t.flat(['  @      u'])
  const input = settle(w, 30)
  const bugs = t.find(w, 'bugs')
  t.eq(bugs.state, 'chase', 'it is coming')
  for (let hit = 1; hit <= 5; hit++) {
    const mx = cx(bugs)
    const my = cy(bugs)
    t.eq(t.spray(w, bugs), true, 'the droplet is used up')
    t.eq(bugs.hp, 6 - hit, 'hp')
    t.eq(bugs.w, 36 - 2 * hit, 'its box thins: width')
    t.eq(bugs.h, 36 - 2 * hit, 'height')
    t.eq(cx(bugs), mx + CRITTERS.bugs.knock, 'knocked back along the water, about its middle')
    t.eq(cy(bugs), my, 'middle y')
    t.eq(Math.hypot(bugs.vx, bugs.vy), 0, 'stopped dead')
    t.spray(w, bugs)
    t.eq(bugs.hp, 6 - hit, 'water straight after is wasted')
    t.until(w, [], () => bugs.vars.stun === 0, 20, input)
    t.ok(bugs.harmful, 'still harmful')
  }
  t.spray(w, bugs)
  t.eq(bugs.state, 'scatter', 'scattered')
  t.eq(bugs.harmful, false, 'harmless')
  t.eq(w.stats.score, 200, 'score')
  t.ok(sfxSeen(w.events, 'pop'), "the 'pop' sound")
  pin(w, bugs, 5, input)
  t.eq(w.player.pips, 3, 'walking through the scattering bugs')
  t.ok(t.until(w, [], () => !t.find(w, 'bugs'), 60, input) > 0, 'gone')

  // Sprayed from beyond its range: it wakes and comes.
  const w2 = t.flat(['  @               u', ''])
  settle(w2, 2)
  const b2 = t.find(w2, 'bugs')
  t.eq(b2.state, 'idle', 'state out of range')
  t.spray(w2, b2)
  t.eq(b2.state, 'chase', 'state after a hit from out of range')
})

t.test('bugs: a steady stream from the gun scatters it before it arrives; never hurts while he blinks; wax scatters it', () => {
  for (const rows of [['  @        u'], ['           u', '', '  @'], ['  @    %   u']]) {
    const w = t.flat(rows)
    const input = t.makeInput()
    const p = w.player
    // He stands his ground, and aims up when it is above the gun.
    let ticks = 0
    for (; ticks < 900 && t.find(w, 'bugs') && p.pips === 3; ticks++) {
      const b = t.find(w, 'bugs')
      const held = ['spray']
      if (cy(b) < p.y + p.h - 50 && Math.abs(cx(b) - (p.x + p.w / 2)) < 170) held.push('up')
      stepWorld(w, input(held))
      w.events.length = 0
    }
    t.eq(p.pips, 3, `pips, room ${JSON.stringify(rows)}`)
    t.eq(w.stats.score, 200, `score, room ${JSON.stringify(rows)}`)
  }
  blinkSafe(['  @               u', ''], 'bugs')
  const w = t.flat(['  @               u', ''])
  const input = settle(w, 2)
  const bugs = t.find(w, 'bugs')
  w.player.wax = 300
  pin(w, bugs, 3, input)
  t.eq(bugs.state, 'scatter', 'wax scatters it')
  t.eq(w.player.pips, 3, 'pips')
})

/* ------------------------------------------------------------------ */
/* tumbleweed                                                          */
/* ------------------------------------------------------------------ */

t.test('tumbleweed: 30 x 30, rolls at 90 px/s in two small hops and a big one', () => {
  const w = t.flat(['  @               w'])
  const input = settle(w, 2)
  const weed = t.find(w, 'tumbleweed')
  t.eq(weed.w, 30, 'width')
  t.eq(weed.h, 30, 'height')
  t.eq(weed.hp, 5, 'hits it takes')
  t.ok(weed.harmful, 'harmful')
  t.eq(sim.getBehavior('tumbleweed').offscreen, 'removeBehind', 'offscreen')
  t.until(w, [], () => weed.onGround, 20, input)
  const x0 = weed.x
  const roll0 = weed.vars.roll
  const t0 = w.tick
  const peaks = []
  let peak = 0
  let landings = 0
  let cycle = 0
  while (landings < 6 && w.tick - t0 < 600) {
    stepWorld(w, input([]))
    w.events.length = 0
    peak = Math.max(peak, FLOOR_Y - (weed.y + weed.h))
    if (weed.onGround) {
      peaks.push(Math.round(peak))
      peak = 0
      landings++
      if (landings === 3) cycle = w.tick - t0
    }
  }
  t.eq(peaks.length, 6, 'hops')
  t.eq(peaks.slice(0, 3).join(','), peaks.slice(3).join(','), 'the hops repeat')
  const sorted = peaks.slice(0, 3).sort((a, b) => a - b)
  t.ok(sorted[0] >= 7 && sorted[1] <= 11, `small hops ${sorted[0]} and ${sorted[1]} px`)
  t.ok(sorted[2] >= 27 && sorted[2] <= 32, `big hop ${sorted[2]} px`)
  const ticks = w.tick - t0
  t.near((x0 - weed.x) / ticks, 90 / 60, 0.001, 'px a tick along the ground')
  t.near(weed.vars.roll - roll0, weed.x - x0, 0.001, 'vars.roll follows the distance rolled')
  t.eq(weed.facing, -1, 'facing')
  t.notes.push(`tumbleweed: hops ${peaks.slice(0, 3).join(', ')} px high, one cycle of three is ${cycle} ticks and ${Math.round((cycle * 90) / 60)} px`)
})

t.test('tumbleweed: bounces back off walls, rolls off ledges, sinks in sludge', () => {
  let w = t.flat(['  @   X          w      X'])
  let input = settle(w, 2)
  let weed = t.find(w, 'tumbleweed')
  let lo = Infinity
  let hi = -Infinity
  let turns = 0
  let facing = weed.facing
  for (let i = 0; i < 1500; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    lo = Math.min(lo, weed.x)
    hi = Math.max(hi, weed.x + weed.w)
    if (weed.facing !== facing) turns++
    facing = weed.facing
  }
  t.eq(lo, 7 * TILE, 'left wall')
  t.eq(hi, 24 * TILE, 'right wall')
  t.ok(turns >= 3, `it turned ${turns} times`)

  w = t.makeWorld(['  @', '', '               w', '          ########', '', t.FLOOR, t.FLOOR])
  input = settle(w, 2)
  weed = t.find(w, 'tumbleweed')
  t.ok(t.until(w, [], () => weed.x < 9 * TILE && weed.y + weed.h >= FLOOR_Y - 31 && weed.onGround, 400, input) > 0, 'it should roll off the ledge and land on the floor')
  t.eq(weed.facing, -1, 'still rolling the same way')

  w = t.makeWorld(['  @              w', '########~~~~' + '#'.repeat(40), t.FLOOR])
  input = settle(w, 2)
  weed = t.find(w, 'tumbleweed')
  t.ok(t.until(w, [], () => !t.find(w, 'tumbleweed'), 600, input) > 0, 'it should sink in the sludge')
  t.ok(weed.x > 7 * TILE, 'in the pit, not past it')
  t.eq(w.stats.score, 0, 'no points for that')
})

t.test('tumbleweed: two that meet bounce apart; one the water drives back into another hands the shove on', () => {
  // Head on.
  let w = t.flat(['  @     X   3       w     X'], { legend: { 3: { kind: 'tumbleweed', props: { dir: 1 } } } })
  let input = settle(w, 2)
  let [a, b] = t.all(w, 'tumbleweed').sort((p, q) => p.x - q.x)
  let deepest = 0
  let meets = 0
  let lastA = a.facing
  for (let i = 0; i < 1200; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    deepest = Math.max(deepest, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    if (a.facing !== lastA && a.facing === -1 && a.x + a.w > b.x - 8) meets++
    lastA = a.facing
  }
  t.ok(meets >= 2, `they met and turned only ${meets} times in 20 s`)
  t.ok(deepest <= 8, `they overlapped by ${Math.round(deepest)} px`)
  t.ok(a.x < b.x, 'they kept their order')
  // The front one sprayed back into the one behind it.
  w = t.flat(['  @          w     w'])
  input = settle(w, 5)
  ;[a, b] = t.all(w, 'tumbleweed').sort((p, q) => p.x - q.x)
  a.hp = 999
  let overlap = 0
  const bx = b.x
  for (let i = 0; i < 160; i++) {
    if (i % 2 === 0) t.spray(w, a)
    stepWorld(w, input([]))
    w.events.length = 0
    if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 8) overlap++
  }
  t.eq(overlap, 0, 'ticks they sat inside each other')
  t.ok(b.x > bx + 20, `the one behind was shoved back too (${Math.round(b.x - bx)} px)`)
})

t.test('tumbleweed: water shoves it back, five hits break it into twigs (+100)', () => {
  // Shoved: droplets every other tick, as the gun sends them.
  const free = t.flat(['  @               w'])
  const wet = t.flat(['  @               w'])
  const inA = settle(free, 20)
  const inB = settle(wet, 20)
  const a = t.find(free, 'tumbleweed')
  const b = t.find(wet, 'tumbleweed')
  b.hp = 99 // only the shove is under test here
  t.eq(a.x, b.x, 'same start')
  const start = b.x
  let wentRight = false
  for (let i = 0; i < 40; i++) {
    if (i % 2 === 0) t.spray(wet, b)
    stepWorld(free, inA([]))
    stepWorld(wet, inB([]))
    free.events.length = 0
    wet.events.length = 0
    if (i > 10 && b.x > b.px) wentRight = true
  }
  t.ok(b.x > a.x + 60, `the stream held it back only ${Math.round(b.x - a.x)} px in 40 ticks`)
  t.ok(wentRight && b.x > start, `a steady stream should walk it backwards (it went ${Math.round(b.x - start)} px)`)
  t.eq(b.facing, -1, 'it still faces the way it means to roll')
  const pushed = b.x
  const moved = [Math.round(b.x - start), Math.round(a.x - start)]
  t.until(wet, [], () => false, 50, inB)
  t.ok(b.x < pushed - 40, 'with the water off it rolls on again')
  t.notes.push(`tumbleweed: 40 ticks of water moved it ${moved[0]} px (unsprayed it rolled ${moved[1]} px)`)

  // Broken.
  const w = t.flat(['  @               w'])
  const input = settle(w, 20)
  const weed = t.find(w, 'tumbleweed')
  for (let hit = 1; hit <= 4; hit++) {
    t.spray(w, weed)
    t.eq(weed.hp, 5 - hit, 'hp')
    t.spray(w, weed)
    t.eq(weed.hp, 5 - hit, 'water straight after is wasted')
    t.until(w, [], () => weed.vars.stun === 0, 20, input)
    t.eq(weed.state, 'roll', 'still rolling')
  }
  t.spray(w, weed)
  t.eq(weed.state, 'break', 'broken')
  t.eq(weed.harmful, false, 'harmless')
  t.eq(w.stats.score, 100, 'score')
  t.ok(sfxSeen(w.events, 'crumble'), "the 'crumble' sound")
  t.eq(t.spray(w, weed), false, 'water goes through the twigs')
  pin(w, weed, 5, input)
  t.eq(w.player.pips, 3, 'walking through the twigs')
  t.ok(t.until(w, [], () => !t.find(w, 'tumbleweed'), 60, input) > 0, 'gone')
})

t.test('tumbleweed: the gun breaks it before it arrives; a running jump clears it at any point of its hop', () => {
  for (const gap of [4, 7, 10, 14, 17]) {
    const w = t.flat(['  @' + ' '.repeat(gap) + 'w'])
    const input = t.makeInput()
    t.until(w, ['spray'], () => !t.find(w, 'tumbleweed') || w.player.pips < 3, 600, input)
    t.eq(w.player.pips, 3, `${gap} tiles off: pips`)
    t.eq(w.stats.score, 100, `${gap} tiles off: score`)
  }
  // Run at it and jump when it is close: tried against every part of its hop cycle.
  let tried = 0
  for (let offset = 0; offset < 100; offset += 4) {
    const w = t.flat(['  @               w'])
    const input = settle(w, 2)
    const weed = t.find(w, 'tumbleweed')
    weed.x += offset
    weed.px = weed.x
    const p = w.player
    let jumping = 0
    for (let i = 0; i < 400 && weed.x + weed.w > p.x - 40; i++) {
      const gapNow = weed.x - (p.x + p.w)
      if (jumping === 0 && p.onGround && gapNow < 70 && gapNow > 0) jumping = 22
      const held = ['right']
      if (jumping > 0) {
        held.push('jump')
        jumping--
      }
      stepWorld(w, input(held))
      w.events.length = 0
    }
    t.eq(p.pips, 3, `start offset ${offset} px: pips`)
    tried++
  }
  t.notes.push(`tumbleweed: a running jump cleared it from ${tried} different points of its hop cycle`)
})

t.test('tumbleweed: it hurts to touch, never while he blinks; wax breaks it', () => {
  let w = t.flat(['  @          w'])
  let input = settle(w, 2)
  t.until(w, [], () => w.player.pips < 3, 400, input)
  t.eq(w.player.pips, 2, 'rolling into him costs a pip')
  t.ok(w.player.vx < 0, 'knocked the way it was rolling')

  blinkSafe(['  @               w'], 'tumbleweed')

  w = t.flat(['  @          w'])
  input = settle(w, 2)
  w.player.wax = 400
  const weed = t.find(w, 'tumbleweed')
  t.until(w, [], () => weed.state === 'break', 400, input)
  t.eq(weed.state, 'break', 'wax breaks it')
  t.eq(w.player.pips, 3, 'pips')
  t.eq(w.stats.score, 100, 'score')
})

/* ------------------------------------------------------------------ */
/* All together                                                        */
/* ------------------------------------------------------------------ */

/** A long, busy, repeatable input script (the same recipe as sim.mjs). */
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

t.test('the dev room dev-critters is a sound level with every critter in it', () => {
  const level = levels.levelById('dev-critters')
  t.ok(level, 'levelById finds it')
  const report = sim.validateLevel(level)
  t.eq(report.errors.join('; '), '', 'validateLevel errors')
  const mine = report.warnings.filter((s) => !s.includes('no registered behaviour'))
  t.eq(mine.join('; '), '', 'validateLevel warnings')
  const w = createWorld(level, { session: t.freshSession() })
  for (const kind of ['blob', 'bird', 'bugs', 'tumbleweed']) t.ok(t.all(w, kind).length >= 4, `only ${t.all(w, kind).length} of '${kind}' in the room`)
  for (const kind of ['blob', 'bird', 'splat', 'bugs', 'tumbleweed']) t.ok(sim.hasBehavior(kind), `no behaviour registered for '${kind}'`)
})

t.test('determinism: the dev room and the sandbox corner, random input, twice the same tick for tick', () => {
  const play = (level, seed, starts) => {
    const hashes = []
    const seen = new Set()
    for (const col of starts) {
      const checkpoint = { areaId: 'main', x: col * TILE + TILE / 2, y: FLOOR_Y }
      let w = createWorld(level, { session: t.freshSession(), checkpoint, seed })
      const input = t.makeInput()
      let attempts = 1
      for (const [held, count, extra] of busyScript(seed + col, 110)) {
        for (let i = 0; i < count; i++) {
          stepWorld(w, input(held, extra))
          w.events.length = 0
          hashes.push(worldHash(w))
          for (const e of w.entities) {
            if (!Number.isFinite(e.x + e.y + e.vx + e.vy + e.w + e.h)) throw new Error(`${e.kind} #${e.id} has a non-number in it at tick ${w.tick}`)
            if (e.active) seen.add(`${e.kind}:${e.state}`)
          }
          if (w.status !== 'play' && w.statusT >= 30) {
            w = createWorld(level, { session: t.freshSession(), checkpoint, seed: seed + attempts })
            attempts++
          }
        }
      }
    }
    return { hashes, seen }
  }
  const room = levels.levelById('dev-critters')
  // Three starts among the swarms (126, 136, 140): random play has to wash one away, and with only
  // one there a change to how Maxx moves could leave that to luck.
  const starts = [2, 16, 40, 62, 84, 110, 126, 136, 140, 160, 186, 214, 246, 268, 294, 322, 352, 384, 422, 458, 496, 512, 530, 552, 567]
  const a = play(room, 21, starts)
  const b = play(room, 21, starts)
  t.eq(a.hashes.length, b.hashes.length, 'ticks played')
  for (let i = 0; i < a.hashes.length; i++) if (a.hashes[i] !== b.hashes[i]) throw new Error(`the dev room differs at tick ${i + 1}`)
  const c = play(levels.sandboxLevel, 5, [338, 345, 352])
  const d = play(levels.sandboxLevel, 5, [338, 345, 352])
  for (let i = 0; i < c.hashes.length; i++) if (c.hashes[i] !== d.hashes[i]) throw new Error(`the sandbox corner differs at tick ${i + 1}`)
  // The run has to have met the critters doing things, or it proves little.
  const want = ['blob:walk', 'blob:hit', 'blob:pop', 'bird:fly', 'bird:tell', 'splat:fall', 'splat:land', 'bugs:chase', 'bugs:scatter', 'tumbleweed:roll', 'tumbleweed:break']
  const missing = want.filter((s) => !a.seen.has(s))
  t.eq(missing.join(', '), '', 'states the random run never saw')
  t.notes.push(`determinism: ${a.hashes.length} ticks of the dev room and ${c.hashes.length} of the sandbox corner, twice each; states seen: ${[...a.seen].sort().join(' ')}`)
})

t.test('seams: every frame the renderer asks for is in the critters atlas, and it draws every kind', () => {
  const atlasSrc = fs.readFileSync(path.join(GAME_DIR, 'game', 'assets', 'critters.atlas.ts'), 'utf8')
  const frames = new Set([...atlasSrc.matchAll(/^\s{4}(\w+): \{ x:/gm)].map((m) => m[1]))
  t.ok(frames.size > 50, `only ${frames.size} frames read from critters.atlas.ts`)
  const src = fs.readFileSync(path.join(GAME_DIR, 'game', 'render', 'entities', 'critters.ts'), 'utf8')
  const wanted = []
  for (const m of src.matchAll(/names\('(\w+)', (\d+)\)/g)) for (let i = 0; i < Number(m[2]); i++) wanted.push(`${m[1]}${i}`)
  for (const m of src.matchAll(/`\$\{A\}(\w+)`/g)) wanted.push(m[1])
  t.ok(wanted.length > 60, `only ${wanted.length} frame names found in the renderer`)
  const missing = wanted.filter((n) => !frames.has(n))
  t.eq(missing.join(', '), '', 'frames the renderer names that the atlas lacks')
  for (const kind of ['blob', 'bird', 'splat', 'bugs', 'tumbleweed']) t.ok(src.includes(`registerRenderer('${kind}'`), `no renderer for '${kind}'`)
  t.notes.push(`seams: ${wanted.length} frame names in the renderer, all in the atlas (${frames.size} frames)`)
})

t.test('the simulation file uses no clock, no DOM and no Math.random', () => {
  const src = fs.readFileSync(path.join(GAME_DIR, 'game', 'sim', 'entities', 'critters.ts'), 'utf8')
  for (const bad of ['Math.random', 'Date.now', 'performance.now', 'window.', 'document.', 'setTimeout', 'setInterval']) t.ok(!src.includes(bad), `critters.ts mentions ${bad}`)
})

await t.finish()
