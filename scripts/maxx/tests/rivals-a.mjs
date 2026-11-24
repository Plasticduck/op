// Secret rivals 1 and 2: BUCKET BILL ('bill') and SIR STREAKS ('streaks'), in their dev
// arenas (src/features/it/maxx/game/levels/dev/rivals-a.ts).
//
//   node scripts/maxx/tests/rivals-a.mjs [--only text] [--verbose] [--full]
//
// The scripted players see like people do: a new telegraph or a new projectile only once it
// has been on screen REACT ticks (12 for the good player, 25 for the clumsy one), and from
// then on they read it the way a player who knows the fight does (a crouch that long means
// the dash comes then; a wave that fast reaches me in so many ticks).
//
// --full runs the dodge search over every telegraph of a whole fight (not only the first of
// each kind and dirt stage), from the floor every 8 px and from six moments of a jump every
// 16 px: about four minutes.
import { suite } from '../lib/testkit.mjs'

const t = await suite('rivals-a')
const { sim, levels } = t
const VERBOSE = process.argv.includes('--verbose')
const FULL = process.argv.includes('--full')
const LEVEL = levels.levelById('dev-rivals-a')
const TILE = 32
const FLOOR_Y = 10 * TILE
const FLAG = 'rivalsBeaten'
const RIVALS = {
  bill: { area: 'bill', number: 1, name: 'BUCKET BILL', tagline: 'A BUCKET AND A DREAM.', mine: 'bill_' },
  streaks: { area: 'streaks', number: 2, name: 'SIR STREAKS', tagline: 'NEVER MISSES A SPOT. MOSTLY.', mine: 'streaks_' },
}

/** A fresh attempt in a rival's arena, Maxx at column 3 (where the arena's door drops him). */
function arena(kind, opts = {}) {
  const r = RIVALS[kind]
  return sim.createWorld(LEVEL, {
    session: t.freshSession(),
    checkpoint: { areaId: opts.area ?? r.area, x: (opts.col ?? 3) * TILE + TILE / 2, y: FLOOR_Y },
    flags: opts.flags,
    seed: opts.seed ?? 1,
  })
}

const foeOf = (w, kind) => w.entities.find((e) => e.kind === kind && !e.dead)
const mid = (e) => e.x + e.w / 2
const sign = (v) => (v < 0 ? -1 : 1)

/* ------------------------------------------------------------------ */
/* The scripted players                                                */
/* ------------------------------------------------------------------ */

const JUMP_HOLD = 22
/** Jump when the threat is this many ticks from reaching him. */
const JUMP_LEAD = 8

/**
 * One player: call it every tick with the world, it answers the actions to hold. `react` is how
 * many ticks a telegraph or projectile must have been on screen before he acts on it.
 */
function makePlayer(kind, react, sloppy = 0) {
  let seed = 777
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const mem = { jump: 0, lastJump: false, escape: 0, escapeDir: 0, lead: JUMP_LEAD }
  const policy = kind === 'bill' ? billPolicy : streaksPolicy
  return (w) => {
    const p = w.player
    const foe = foeOf(w, kind)
    const held = []
    if (!foe || p.state !== 'normal') {
      mem.jump = 0
      mem.lastJump = false
      mem.escape = 0
      return held
    }
    const plan = { move: 0, jump: false, spray: false, face: 0, up: false }
    if (mem.escape > 0) {
      // Committed to a jump over him: keep pushing that way until he is clear.
      mem.escape--
      plan.move = mem.escapeDir
      plan.jump = true
      if (p.onGround && mem.escape < 30) mem.escape = 0
    } else policy(w, foe, react, plan, mem)
    // A jump is a fresh press held to the top of the arc.
    let jump = false
    if (mem.jump > 0) {
      mem.jump--
      jump = true
    } else if (plan.jump && p.onGround && !mem.lastJump) {
      mem.jump = JUMP_HOLD
      jump = true
      // A sloppy player times the next jump a little early or late, his way.
      if (sloppy) mem.lead = JUMP_LEAD + Math.round((rnd() * 2 - 1) * sloppy)
    }
    mem.lastJump = jump
    let move = plan.move
    // Turning to spray is a one-tick tap toward him.
    if (move === 0 && plan.spray && plan.face !== 0 && p.facing !== plan.face) move = plan.face
    if (move < 0) held.push('left')
    if (move > 0) held.push('right')
    if (jump) held.push('jump')
    if (plan.spray) held.push('spray')
    if (plan.up) held.push('up')
    return held
  }
}

/** Where his box would be if he walked to put his middle at x, kept off the walls. */
function roomTo(foe, x) {
  return Math.max(foe.vars.ax0 + 11, Math.min(foe.vars.ax1 - 11, x))
}

/** Move so his middle sits at `x` (give or take 4 px): -1, 0 or 1. */
function toward(cx, x) {
  return Math.abs(x - cx) <= 4 ? 0 : x > cx ? 1 : -1
}

/** Step away from a point that is about to be dangerous: outward from `from` unless the wall is too near, then the other way. */
function awayFrom(foe, cx, x, need, prefer) {
  const dir = prefer !== 0 ? prefer : cx >= x ? 1 : -1
  const reach = dir > 0 ? foe.vars.ax1 - 11 - cx : cx - (foe.vars.ax0 + 11)
  if (Math.abs(cx + dir * reach - x) >= need) return dir
  return -dir
}

function billPolicy(w, foe, react, plan, mem) {
  const p = w.player
  const cx = p.x + p.w / 2
  const v = foe.vars
  const st = foe.state
  const ft = foe.stateT
  const fcx = mid(foe)
  const toFoe = fcx >= cx ? 1 : -1
  plan.face = toFoe
  const danger = st !== 'dizzy' && st !== 'recover' && st !== 'wait' && st !== 'beaten'

  // The wave: jump it as it arrives. Read from the lean-back (sloshTell), or from the wave itself.
  let waveIn = Infinity
  for (const wave of w.entities) {
    // Seen coming since the lean-back that announced it.
    if (wave.kind !== 'bill_wave' || wave.dead || wave.stateT + 20 + 40 < react) continue
    const dir = sign(wave.vx)
    const lead = dir > 0 ? wave.x + wave.w : wave.x
    const near = dir > 0 ? p.x : p.x + p.w
    const gap = (near - lead) * dir
    if (gap > -(wave.w + p.w)) waveIn = Math.min(waveIn, (Math.max(0, gap) / Math.abs(wave.vx)) * 60)
  }
  if (st === 'sloshTell' && ft >= react) {
    const dir = foe.facing
    const lead = fcx + dir * (foe.w / 2 + 34)
    const near = dir > 0 ? p.x : p.x + p.w
    const gap = (near - lead) * dir
    if (gap > -(34 + p.w)) waveIn = Math.min(waveIn, v.tellT - ft + 4 + (Math.max(0, gap) / v.waveV) * 60)
  }
  if (waveIn <= mem.lead) plan.jump = true

  // The hop: get out from under the shadow.
  const hopping = (st === 'hopTell' && ft >= react) || (st === 'hop' && v.tellT + ft >= react) || st === 'land'
  if (hopping) {
    const need = 20 + 11 + 14
    // Away from where he jumps from, never in under the end of his arc.
    if (Math.abs(cx - v.tx) < need) plan.move = awayFrom(foe, cx, v.tx, need, v.tx >= v.x0 ? 1 : -1)
  }

  // Sponges: out from under one's way down, on past its drip mark (the way it flies, never back
  // in under it), or, with a wall in the way, shoot it down with an up-spray.
  for (const s of w.entities) {
    if (s.kind !== 'bill_sponge' || s.dead || s.stateT < react || plan.move !== 0) continue
    if (!underSponge(w, cx, react, s)) continue
    const out = s.vx !== 0 ? sign(s.vx) : cx >= s.vars.tx ? 1 : -1
    const room = out > 0 ? v.ax1 - 11 - cx : cx - (v.ax0 + 11)
    if ((s.vars.tx + out * 34 - cx) * out <= room) plan.move = out
    else {
      const from = mid(s) >= cx ? 1 : -1
      if (p.facing !== from) plan.move = from
      plan.up = true
      plan.spray = true
      plan.face = from
      return
    }
  }

  if (plan.move !== 0 || waveIn < 40) {
    plan.spray = !danger
    return
  }
  const dist = Math.abs(fcx - cx)
  // Backed into a corner with him close: jump over him to the open side while he is on the ground.
  const wallBehind = toFoe > 0 ? cx - v.ax0 : v.ax1 - cx
  const spongeOut = w.entities.some((s) => s.kind === 'bill_sponge' && !s.dead)
  if (danger && wallBehind < 70 && dist < 150 && (st === 'idle' || st === 'land' || (st === 'lob' && !spongeOut)) && !spongeOut && p.onGround) {
    mem.escape = 44
    mem.escapeDir = toFoe
    plan.move = toFoe
    plan.jump = true
    return
  }
  if (st === 'dizzy') {
    // The window: walk up and wash.
    plan.move = dist > 74 ? toward(cx, fcx - toFoe * 66) : 0
    if (plan.move !== 0 && underSponge(w, cx + plan.move * 24, react) && !underSponge(w, cx, react)) plan.move = 0
    plan.spray = true
    return
  }
  if (danger && dist < 20 + 11 + 18) {
    plan.move = awayFrom(foe, cx, fcx, 49, -toFoe)
    return
  }
  // Otherwise keep a little room and chip at him, never walking in under a sponge on its way down.
  if (dist < 110) plan.move = -toFoe
  else if (dist > 220) plan.move = toFoe
  if (plan.move !== 0 && roomTo(foe, cx + plan.move * 20) === cx) plan.move = 0
  if (plan.move !== 0 && underSponge(w, cx + plan.move * 24, react) && !underSponge(w, cx, react)) plan.move = 0
  plan.spray = true
}

/**
 * Is x under the rest of the way down of a sponge he has seen (from where it is to its mark),
 * once it is low enough to matter? `only` asks about one sponge.
 */
function underSponge(w, x, react, only = null) {
  for (const s of w.entities) {
    if (s.kind !== 'bill_sponge' || s.dead || s.stateT < react || (only && s !== only)) continue
    // Still high on its way, it is no danger yet to someone who keeps an eye on it, unless he
    // stands on its mark.
    if (Math.abs(x - s.vars.tx) >= 8 + 11 + 12 && s.vars.n - s.stateT > 30) continue
    const sx = s.x + s.w / 2
    const lo = Math.min(sx, s.vars.tx) - 8 - 11 - 4
    const hi = Math.max(sx, s.vars.tx) + 8 + 11 + 4
    if (x > lo && x < hi) return true
  }
  return false
}

/** The first tick (from now) the blade's box overlaps Maxx's column span, or Infinity. */
function bladeArrives(w, b, home, p) {
  const v = b.vars
  let x = b.x + b.w / 2
  let back = v.back
  let hang = v.hang
  const step = v.speed / 60
  const hand = mid(home) + v.dir * 22
  for (let i = 0; i <= 150; i++) {
    if (x + b.w / 2 > p.x && x - b.w / 2 < p.x + p.w) return i
    if (!back) {
      const nx = x + v.dir * step
      if ((nx - v.turn) * v.dir >= 0) {
        x = v.turn
        back = 1
        hang = 6
      } else x = nx
    } else if (hang > 0) hang--
    else {
      x -= v.dir * step
      if ((x - hand) * v.dir <= 0) return Infinity
    }
  }
  return Infinity
}

function streaksPolicy(w, foe, react, plan, mem) {
  const p = w.player
  const cx = p.x + p.w / 2
  const v = foe.vars
  const st = foe.state
  const ft = foe.stateT
  const fcx = v.cx
  const toFoe = fcx >= cx ? 1 : -1
  plan.face = toFoe
  const danger = st !== 'stuck' && st !== 'recover' && st !== 'wait' && st !== 'beaten' && st !== 'intro'

  let jumpIn = Infinity
  let stayDown = false
  for (const b of w.entities) {
    // Seen coming since the wind-up that announced it.
    if (b.kind !== 'streaks_blade' || b.dead || b.stateT + 26 < react) continue
    jumpIn = Math.min(jumpIn, bladeArrives(w, b, foe, p))
  }
  if (st === 'throwTell' && ft >= react) {
    // The blade leaves his hand at the end of the wind-up, skimming the floor his way.
    const dir = foe.facing
    const lead = fcx + dir * (30 + 14)
    const near = dir > 0 ? p.x : p.x + p.w
    const gap = (near - lead) * dir
    if (gap > -(28 + p.w)) jumpIn = Math.min(jumpIn, v.tellT - ft + 1 + (Math.max(0, gap) / v.bladeV) * 60)
  }
  if (st === 'dashTell' && ft >= react) {
    if (v.high === 1) stayDown = true
    else {
      const dir = foe.facing
      const front = fcx + dir * 28
      const near = dir > 0 ? p.x : p.x + p.w
      const gap = (near - front) * dir
      if (gap > -50) jumpIn = Math.min(jumpIn, v.tellT - ft + (Math.max(0, gap) / v.speed) * 60)
    }
  }
  if (st === 'dash') {
    if (v.high === 1) stayDown = true
    else {
      const dir = foe.facing
      const front = fcx + dir * 28
      const near = dir > 0 ? p.x : p.x + p.w
      const gap = (near - front) * dir
      if (gap > -(56 + p.w)) jumpIn = Math.min(jumpIn, (Math.max(0, gap) / v.speed) * 60)
    }
  }
  if (jumpIn <= mem.lead && !stayDown) plan.jump = true

  const dist = Math.abs(fcx - cx)
  if (jumpIn < 40 || stayDown) {
    plan.spray = !danger
    // Keep clear of him while he is about to come through, but never walk into his lane.
    return
  }
  if (st === 'stuck') {
    plan.move = dist > 76 ? toward(cx, fcx - toFoe * 68) : 0
    plan.spray = true
    return
  }
  const half = foe.w / 2
  if (danger && dist < half + 11 + 18) {
    plan.move = awayFrom(foe, cx, fcx, half + 11 + 18, -toFoe)
    return
  }
  if (dist < 170) plan.move = -toFoe
  else if (dist > 300) plan.move = toFoe
  if (plan.move !== 0 && roomTo(foe, cx + plan.move * 20) === cx) plan.move = 0
  plan.spray = true
}

/* ------------------------------------------------------------------ */
/* Running a fight                                                     */
/* ------------------------------------------------------------------ */

/**
 * Play a whole fight with a player function. Returns what happened. `refill` keeps his shine
 * topped up so a clumsy player's hits can be counted over a whole fight.
 */
function fight(kind, player, opts = {}) {
  const w = opts.world ?? arena(kind, opts)
  const input = t.makeInput()
  const max = opts.max ?? 60 * 240
  const out = { w, hits: 0, ticks: 0, start: -1, end: -1, grimedAt: -1, versus: [], jingles: [], hashes: [], log: [], hitBy: [] }
  let last = ''
  for (let i = 1; i <= max; i++) {
    const before = w.player.pips
    if (opts.each) opts.each(w, i)
    const held = player(w)
    sim.stepWorld(w, input(held))
    out.ticks = i
    for (const ev of w.events) {
      if (ev.type === 'versus') {
        out.versus.push(ev)
        if (out.start < 0) out.start = i
      }
      if (ev.type === 'jingle') out.jingles.push(ev.id)
      if (ev.type === 'sfx' && ev.id === 'hurt') {
        out.hits++
        const foe = foeOf(w, kind)
        out.hitBy.push(foe ? foe.state + (w.entities.some((o) => o.kind.startsWith(RIVALS[kind].mine) && o.kind !== 'streaks_slick' && !o.dead) ? '+shot' : '') : '?')
      }
    }
    if (w.player.pips < before && w.status === 'grimed') out.hits++
    w.events.length = 0
    if (opts.hash) out.hashes.push(sim.worldHash(w))
    const foe = foeOf(w, kind)
    if (VERBOSE && foe && (foe.state !== last || (process.env.TRACE && Math.abs(i - Number(process.env.TRACE)) < 40))) {
      out.log.push(`${i} ${foe.state} ${foe.stateT} hp ${foe.hp} x ${Math.round(foe.x)} y ${Math.round(foe.y)} p ${Math.round(w.player.x)},${Math.round(w.player.y)} pips ${w.player.pips} held ${held.join('+')}`)
      last = foe.state
    }
    if (w.status === 'grimed' && out.grimedAt < 0) out.grimedAt = i
    if (w.status !== 'play') break
    if (opts.refill) w.player.pips = 3
    if (foe && foe.state === 'beaten' && out.end < 0) out.end = i
    if (out.end > 0 && i > out.end + (opts.after ?? 0)) break
  }
  if (VERBOSE) console.log(out.log.join('\n'))
  return out
}

const secs = (ticks) => Math.round((ticks / 60) * 10) / 10

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

const lengths = {}

for (const kind of ['bill', 'streaks']) {
  const r = RIVALS[kind]

  t.test(`${kind}: the arena level is valid and he waits until Maxx walks in`, () => {
    const report = sim.validateLevel(LEVEL)
    t.eq(report.errors.length, 0, `level errors: ${report.errors.join('; ')}`)
    const w = arena(kind, { col: 1 })
    t.steps(w, [], 120)
    const foe = foeOf(w, kind)
    t.ok(foe, 'he is there')
    t.eq(foe.state, 'wait', 'state with Maxx in the doorway column')
    t.ok(!w.boss && !w.camBounds, 'no fight yet')
    const seen = t.steps(w, ['right'], 40)
    t.ok(t.has(seen, 'versus', (ev) => ev.name === r.name && ev.tagline === r.tagline), 'versus card with his name and tagline')
    t.ok(w.camBounds && w.camBounds.x0 === 0 && w.camBounds.x1 === 640, `camera locked to the arena: ${JSON.stringify(w.camBounds)}`)
    t.ok(w.boss && w.boss.name === r.name && w.boss.hp === foe.maxHp, 'boss bar')
    t.ok(sim.getBehavior(kind).alwaysActive, 'alwaysActive')
  })

  t.test(`${kind}: a good player (reacting 12 ticks after each telegraph) washes him without taking a hit`, () => {
    const run = fight(kind, makePlayer(kind, 12), { after: 30 })
    const foe = run.w.entities.find((e) => e.kind === kind)
    t.ok(run.end > 0, `not beaten in ${secs(run.ticks)} s (hp left ${foe && foe.hp}, hits ${run.hits})`)
    t.eq(run.hits, 0, 'hits taken')
    t.eq(run.versus.length, 1, 'versus cards')
    t.ok(run.jingles.includes('rivalDown'), 'the rivalDown jingle')
    t.eq(sim.getFlag(run.w, FLAG), r.number, `flag ${FLAG}`)
    t.ok(run.w.camBounds === null, 'camera let go')
    t.ok(run.w.boss === null, 'boss bar cleared')
    t.eq(t.all(run.w, r.mine + 'sponge').length + t.all(run.w, r.mine + 'blade').length + t.all(run.w, r.mine + 'wave').length, 0, 'nothing of his left flying')
    lengths[kind] = secs(run.end - run.start)
    t.notes.push(`${kind}: good player (12-tick reactions) beats him in ${lengths[kind]} s from the versus card, 0 hits`)
  })

  t.test(`${kind}: the fight is deterministic`, () => {
    const a = fight(kind, makePlayer(kind, 12), { hash: true, max: 3000 })
    const b = fight(kind, makePlayer(kind, 12), { hash: true, max: 3000 })
    t.eq(a.hashes.length, b.hashes.length, 'ticks')
    for (let i = 0; i < a.hashes.length; i++) if (a.hashes[i] !== b.hashes[i]) throw new Error(`runs differ at tick ${i + 1}`)
    const c = fight(kind, makePlayer(kind, 12), { hash: true, max: 3000, seed: 99 })
    t.ok(c.hashes.length > 0, 'another seed runs')
  })

  t.test(`${kind}: standing still and spraying gets Maxx hurt`, () => {
    const run = fight(kind, () => ['spray'], { refill: true, max: 60 * 120 })
    t.ok(run.hits >= 3, `only ${run.hits} hits in ${secs(run.ticks)} s`)
    const plain = fight(kind, () => ['spray'], { max: 60 * 120 })
    t.notes.push(`${kind}: standing still and spraying: ${run.hits} hits over ${secs(run.ticks)} s (shine topped up); on 3 pips he is grimed after ${secs(plain.grimedAt)} s`)
  })

  t.test(`${kind}: a clumsy player (25-tick reactions) can still win`, () => {
    const run = fight(kind, makePlayer(kind, 25), { refill: true, after: 10 })
    t.ok(run.end > 0, `not beaten in ${secs(run.ticks)} s`)
    const plain = fight(kind, makePlayer(kind, 25), { after: 10 })
    const sloppy = fight(kind, makePlayer(kind, 25, 8), { refill: true, after: 10 })
    t.ok(sloppy.end > 0, 'a sloppy player cannot win even with his shine topped up')
    t.notes.push(`${kind}: sloppy player (25-tick reactions, jumps up to 8 ticks early or late): ${sloppy.hits} hits over the whole fight (${secs(sloppy.end - sloppy.start)} s; foe was in ${sloppy.hitBy.join(', ')})`)
    t.notes.push(`${kind}: clumsy player (25-tick reactions): ${run.hits} hits over the whole fight (${secs(run.end - run.start)} s; foe was in ${run.hitBy.join(', ')}); on 3 pips: ${plain.end > 0 ? 'wins with ' + plain.w.player.pips + ' pips left' : 'grimed after ' + secs(plain.grimedAt) + ' s'}`)
  })

  t.test(`${kind}: once beaten he stays beaten: a retry with the flag finds him gone and the way open`, () => {
    const w = arena(kind, { flags: { [FLAG]: r.number } })
    const seen = t.steps(w, ['right'], 200)
    t.ok(!foeOf(w, kind), 'he removed himself')
    t.ok(!t.has(seen, 'versus'), 'no versus card')
    t.ok(!w.boss && !w.camBounds, 'no bar, no lock')
    const door = t.find(w, 'door')
    t.ok(door && door.state !== 'locked', `the door on is open (${door && door.state})`)
    // A lower flag does not count: rival 2 still fights after only rival 1 is beaten.
    if (r.number > 1) {
      const w2 = arena(kind, { flags: { [FLAG]: r.number - 1 } })
      t.steps(w2, ['right'], 60)
      t.ok(foeOf(w2, kind), 'still there with a lower flag')
    }
  })

  t.test(`${kind}: his projectiles are kinds of their own that leave when off screen`, () => {
    const kinds = sim.registeredKinds().filter((k) => k.startsWith(r.mine))
    t.ok(kinds.length >= 2, `kinds: ${kinds.join(', ')}`)
    for (const k of kinds) {
      const b = sim.getBehavior(k)
      if (k === 'streaks_slick') t.ok(b.alwaysActive, 'the slick must always dry')
      else t.eq(b.offscreen, 'remove', `${k} offscreen`)
    }
  })

  t.test(`${kind}: coming down on his head bounces Maxx off, unhurt`, () => {
    const w = arena(kind)
    let held = ['right']
    const input = t.makeInput()
    for (let i = 0; i < 400; i++) {
      sim.stepWorld(w, input(held))
      w.events.length = 0
      held = []
      const foe = foeOf(w, kind)
      if (foe.state === (kind === 'bill' ? 'idle' : 'pace')) break
    }
    const foe = foeOf(w, kind)
    const p = w.player
    p.x = mid(foe) - p.w / 2
    p.y = foe.y - p.h - 30
    p.vy = 300
    p.onGround = false
    const pips = p.pips
    let bounced = false
    for (let i = 0; i < 20; i++) {
      sim.stepWorld(w, input([]))
      w.events.length = 0
      if (p.vy < -200) bounced = true
    }
    t.ok(bounced, 'he bounced')
    t.eq(p.pips, pips, 'pips')
  })
}

t.test('losing a third with Maxx missing shine sends a soap bubble up on the far side; at full shine it does not', () => {
  for (const kind of ['bill', 'streaks']) {
    for (const pips of [2, 3]) {
      const w = arena(kind)
      t.steps(w, ['right'], 30)
      const foe = foeOf(w, kind)
      t.until(w, [], () => foe.state !== 'wait' && foe.state !== 'intro', 200)
      w.player.pips = pips
      const before = t.all(w, 'bubble').length
      let n = 0
      while (foe.hp * 3 > foe.maxHp * 2 && n++ < 2000) t.spray(w, foe)
      const got = t.all(w, 'bubble')
      if (pips === 3) t.eq(got.length, before, `${kind}: bubbles at full shine`)
      else {
        t.eq(got.length, before + 1, `${kind}: bubbles with a pip missing`)
        const b = got[got.length - 1]
        const far = Math.abs(b.x + b.w / 2 - mid(foe)) > 200
        t.ok(far, `${kind}: the bubble is far from him (${Math.round(b.x)} vs ${Math.round(foe.x)})`)
        t.ok(b.y + b.h > FLOOR_Y - 52 && b.y < FLOOR_Y, `${kind}: Maxx walking under it picks it up (box ${Math.round(b.y)}..${Math.round(b.y + b.h)})`)
      }
    }
  }
})

t.test('streaks: a low dash leaves a slick streak that dries back to the floor it was', () => {
  const w = arena('streaks')
  const before = Array.from(w.grid.t)
  const player = makePlayer('streaks', 12)
  const input = t.makeInput()
  let slick = false
  let dried = false
  for (let i = 0; i < 4000 && !dried; i++) {
    sim.stepWorld(w, input(player(w)))
    w.events.length = 0
    const n = Array.from(w.grid.t).filter((c) => c === 'I'.charCodeAt(0)).length
    if (n > 0) slick = true
    if (slick && n === 0 && !t.find(w, 'streaks_slick')) dried = true
  }
  t.ok(slick, 'the floor went slick')
  t.ok(dried, 'and dried')
  const after = Array.from(w.grid.t)
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) throw new Error(`tile ${i % w.grid.w},${Math.floor(i / w.grid.w)} is ${String.fromCharCode(after[i])}, was ${String.fromCharCode(before[i])}`)
})

/* ------------------------------------------------------------------ */
/* Every attack, from every place on the floor                         */
/* ------------------------------------------------------------------ */

const ATTACKS = {
  bill: {
    hopTell: { name: 'hop', over: (s) => s !== 'hopTell' && s !== 'hop' && s !== 'land' },
    lobTell: { name: 'lob', over: (s, w) => !['lobTell', 'hopTell', 'hop', 'land', 'lob'].includes(s) && !t.find(w, 'bill_sponge') },
    sloshTell: { name: 'slosh', over: (s, w) => (s === 'dizzy' || s === 'recover' || s === 'idle') && !t.find(w, 'bill_wave') },
  },
  streaks: {
    throwTell: { name: 'blade', over: (s, w) => s !== 'throwTell' && s !== 'throw' && !t.find(w, 'streaks_blade') },
    dashTell: { name: 'dash', over: (s, w, seen) => seen.left && (s === 'stuck' || s === 'dashTell' || s === 'pace') },
  },
}

/**
 * Snapshots of the world on the tick each telegraph starts: one per attack and dirt stage, or
 * with `all` every one of a whole fight.
 */
function telegraphs(kind, all = false) {
  const w = arena(kind)
  const player = makePlayer(kind, 12)
  const input = t.makeInput()
  const shots = []
  const got = new Set()
  for (let i = 0; i < 60 * 200; i++) {
    sim.stepWorld(w, input(player(w)))
    w.events.length = 0
    const foe = foeOf(w, kind)
    if (!foe || foe.state === 'beaten') break
    if (foe.stateT !== 0 || !ATTACKS[kind][foe.state]) continue
    const phase = foe.hp * 3 > foe.maxHp * 2 ? 0 : foe.hp * 3 > foe.maxHp ? 1 : 2
    const key = `${foe.state}:${phase}:${foe.vars.left ?? 0}${all ? '@' + i : ''}`
    if (got.has(key)) continue
    got.add(key)
    shots.push({ key, state: foe.state, phase, world: structuredClone(w) })
  }
  return shots
}

/**
 * Where Maxx can be when a telegraph starts: on the floor, or at some moment of a jump (h px up,
 * vy px/s; rising ones are holding jump).
 */
const AIR_STATES = [
  { h: 30, vy: -500 },
  { h: 90, vy: -250 },
  { h: 130, vy: 0 },
  { h: 90, vy: 300 },
  { h: 30, vy: 500 },
]

/**
 * From a telegraph snapshot, put Maxx at `x` (on the floor, or in the air as `air` says) and play
 * on until the attack is over. `program` null: the good player; else a fixed plan. For the first
 * 12 ticks he does nothing new (on the floor he sprays; rising, he keeps holding jump). True if
 * he came through unhurt; null if he would start inside something.
 */
function tryDodge(kind, shot, x, program, tweak, air = null) {
  const w = structuredClone(shot.world)
  const foe = foeOf(w, kind)
  const p = w.player
  p.x = x - p.w / 2
  p.y = FLOOR_Y - p.h - (air ? air.h : 0)
  p.vx = 0
  p.vy = air ? air.vy : 0
  p.onGround = !air
  p.airT = air ? 10 : 0
  p.coyote = 0
  p.jumping = !!air && air.vy < 0
  p.jumpCut = false
  p.hover = 42
  p.state = 'normal'
  p.invuln = 0
  p.pips = 3
  p.facing = mid(foe) >= x ? 1 : -1
  p.px = p.x
  p.py = p.y
  const near = (o) => o.x < p.x + p.w + 2 && o.x + o.w + 2 > p.x && o.y < p.y + p.h + 2 && o.y + o.h + 2 > p.y
  if (near(foe)) return null
  for (const o of w.entities) if (!o.dead && o.harmful && near(o)) return null
  const input = t.makeInput()
  const player = makePlayer(kind, 12)
  const end = ATTACKS[kind][shot.state].over
  const seen = { left: false }
  for (let i = 0; i < 400; i++) {
    let held
    if (i < 12) held = air ? (air.vy < 0 ? ['jump'] : []) : ['spray']
    else if (program) held = program(i - 12, w)
    else held = player(w)
    sim.stepWorld(w, input(held))
    w.events.length = 0
    if (i === 0 && tweak) tweak(foe)
    if (p.pips < 3 || p.state === 'hurt') return false
    if (foe.state !== shot.state) seen.left = true
    if (end(foe.state, w, seen)) return true
  }
  return true
}

/**
 * Simple fixed plans for when the scripted player fails somewhere: walk a while, jump at some
 * moment, perhaps jump again later; spraying up the whole time (it shoots sponges down).
 */
function* programs() {
  const at = [-1, 0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 50, 60, 70, 80]
  for (const spray of [false, true])
  for (const dir of [0, -1, 1]) {
    for (const walk of [0, 10, 20, 30, 45, 60, 90]) {
      for (const jumpAt of at) {
        for (const again of [-1, 50, 60, 70, 80, 95, 110, 130, 150]) {
          if (again >= 0 && (jumpAt < 0 || again < jumpAt + 46)) continue
          yield (i) => {
            const held = spray ? ['spray', 'up'] : []
            if (i < walk && dir !== 0) held.push(dir < 0 ? 'left' : 'right')
            if (jumpAt >= 0 && i >= jumpAt && i < jumpAt + JUMP_HOLD) held.push('jump')
            if (again >= 0 && i >= again && i < again + JUMP_HOLD) held.push('jump')
            return held
          }
        }
      }
    }
  }
}

for (const kind of ['bill', 'streaks']) {
  t.test(`${kind}: every attack can be dodged from every place, on the floor or in the air, where its telegraph starts (12-tick reaction)`, () => {
    const shots = telegraphs(kind, FULL)
    const want = Object.keys(ATTACKS[kind]).length * 3
    t.ok(shots.length >= want, `telegraphs seen: ${shots.map((s) => s.key).join(' ')}`)
    const foe0 = foeOf(shots[0].world, kind)
    const x0 = foe0.vars.ax0 + 11
    const x1 = foe0.vars.ax1 - 11
    const bad = []
    let tried = 0
    let byBot = 0
    let bySearch = 0
    const starts = [{ air: null, step: 8 }, ...(FULL ? AIR_STATES : [AIR_STATES[0], AIR_STATES[3]]).map((air) => ({ air, step: FULL ? 16 : 24 }))]
    for (const shot of shots) {
      const tweaks = kind === 'streaks' && shot.state === 'dashTell' ? [(f) => (f.vars.high = 0), (f) => (f.vars.short === 1 ? null : (f.vars.high = 1))] : [null]
      for (const tweak of tweaks) {
        for (const { air, step } of starts) {
          for (let x = x0; x <= x1; x += step) {
            const ok = tryDodge(kind, shot, x, null, tweak, air)
            if (ok === null) continue
            tried++
            if (ok) {
              byBot++
              continue
            }
            let found = false
            for (const prog of programs()) {
              if (tryDodge(kind, shot, x, prog, tweak, air)) {
                found = true
                break
              }
            }
            if (found) bySearch++
            else bad.push(`${shot.key}${tweak ? (tweak === tweaks[0] ? ' low' : ' high') : ''} at x ${x}${air ? ` in the air (${air.h} px up, vy ${air.vy})` : ''}`)
          }
        }
      }
    }
    t.notes.push(
      `${kind}: ${shots.length} telegraphs${FULL ? ' (every one of a whole fight)' : ''} x places on the floor and in the air: ${tried} starts, ${byBot} dodged by the scripted player, ${bySearch} more by a searched plan, ${bad.length} with no dodge`,
    )
    t.ok(bad.length === 0, `no dodge from: ${bad.slice(0, 12).join('; ')}${bad.length > 12 ? ' ...' : ''}`)
  })
}

/* ------------------------------------------------------------------ */
/* The edges of the fights                                             */
/* ------------------------------------------------------------------ */

/** Step until pred(foe, w) holds, with the good player at the controls. Returns the ticks taken, or -1. */
function playUntil(w, kind, pred, max = 60 * 120, player = makePlayer(kind, 12), input = t.makeInput()) {
  for (let i = 1; i <= max; i++) {
    sim.stepWorld(w, input(player(w)))
    w.events.length = 0
    const foe = foeOf(w, kind)
    if (foe && pred(foe, w)) return i
    if (w.status !== 'play') return -1
  }
  return -1
}

const slickCount = (grid) => {
  let n = 0
  for (let i = 0; i < grid.t.length; i++) if (grid.t[i] === 73) n++
  return n
}

function sameTiles(a, b, what) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) throw new Error(`${what}: tile ${i % 20},${Math.floor(i / 20)} is '${String.fromCharCode(b[i])}', was '${String.fromCharCode(a[i])}'`)
  }
}

t.test('streaks: the slick goes back to the exact floor when the fight ends while it is wet, when Maxx leaves the area and comes back, and on a retry', () => {
  // The fight ends while the floor is wet.
  const w = arena('streaks')
  const before = Array.from(w.grid.t)
  t.ok(playUntil(w, 'streaks', (f, ww) => f.state === 'stuck' && slickCount(ww.grid) > 0) > 0, 'a low dash left a slick and he is stuck')
  const foe = foeOf(w, 'streaks')
  for (let y = 0; y < w.grid.h; y++) {
    for (let x = 0; x < w.grid.w; x++) {
      if (w.grid.t[y * w.grid.w + x] === 73) t.ok(y === 10 && before[y * w.grid.w + x] === 35, `only floor ground goes slick (tile ${x},${y})`)
    }
  }
  foe.hp = 1
  t.spray(w, foe)
  t.eq(foe.state, 'beaten', 'washed while the floor is wet')
  t.ok(slickCount(w.grid) > 0, 'and the floor still is')
  const retry = sim.createWorld(LEVEL, { session: t.freshSession(), checkpoint: w.checkpoint, flags: { ...w.flags } })
  t.eq(slickCount(retry.grid), 0, 'a retry starts with a dry floor')
  // He walks out through the door while it is wet, waits in the next area, and comes back.
  const input = t.makeInput()
  t.until(w, ['right'], (ww) => ww.player.x + 11 >= 17 * TILE + 10, 300, input)
  t.until(w, ['up'], (ww) => ww.area.id === 'out', 120, input)
  t.steps(w, [], 400, input)
  t.ok(slickCount(w.areas.streaks.grid) > 0, 'an area left behind stands still, wet floor and all')
  t.until(w, [], (ww) => sim.warpTo(ww, 'streaks:in'), 30, input)
  t.until(w, [], (ww) => ww.area.id === 'streaks' && !ww.warp, 120, input)
  t.steps(w, [], 360, input)
  t.eq(slickCount(w.grid), 0, 'back in the arena it dries')
  t.ok(!t.find(w, 'streaks_slick'), 'and the streak is gone')
  sameTiles(before, Array.from(w.grid.t), 'after drying')
})

t.test('streaks: a blade is never out while he dashes or is stuck, and goes with him when he is beaten', () => {
  const w = arena('streaks')
  const bad = playUntil(w, 'streaks', (f, ww) => ['dashTell', 'dash', 'skid', 'stuck', 'recover'].includes(f.state) && !!t.find(ww, 'streaks_blade'), 60 * 90)
  t.eq(bad, -1, 'a blade out during a dash or the window')
  const w2 = arena('streaks')
  t.ok(playUntil(w2, 'streaks', (f, ww) => f.state === 'throw' && !!t.find(ww, 'streaks_blade')) > 0, 'a blade is out')
  const foe = foeOf(w2, 'streaks')
  foe.hp = 1
  foe.vars.soak = 0.99
  t.spray(w2, foe)
  t.eq(foe.state, 'beaten', 'chipped clean while the blade was out')
  t.steps(w2, [], 2)
  t.ok(!t.find(w2, 'streaks_blade'), 'his blade went with him')
  t.steps(w2, ['right'], 200)
  t.eq(w2.player.pips, 3, 'nothing of his hurts Maxx after the fall')
})

for (const kind of ['bill', 'streaks']) {
  t.test(`${kind}: once washed he comes to rest in plain view, on the floor, clear of both walls and of the door`, () => {
    const run = fight(kind, makePlayer(kind, 12), { after: 150 })
    const foe = run.w.entities.find((e) => e.kind === kind)
    t.eq(foe.state, 'beaten', 'state')
    t.ok(foe.vars.arrive > 0, 'he got where he was going')
    const cx = mid(foe)
    t.ok(cx >= foe.vars.ax0 + 4 * TILE - 1 && cx <= foe.vars.ax1 - 4 * TILE + 1, `his middle ${Math.round(cx)} is 4 tiles from both walls`)
    t.near(foe.y + foe.h, FLOOR_Y, 0.5, 'feet on the floor')
    const door = t.find(run.w, 'door')
    t.ok(foe.x + foe.w + 12 < door.x || foe.x > door.x + door.w + 12, 'not in front of the door')
    t.ok(foe.z < 0, 'drawn behind Maxx (and behind the door, which comes later in the area)')
  })
}

t.test('a rival rising into Maxx, or Maxx coming down on one, hops him off sideways: never hurt, back on the floor in time', () => {
  const cases = [
    ['bill', 'idle', null],
    ['bill', 'hopTell', null],
    ['bill', 'lobTell', null],
    ['streaks', 'pace', null],
    ['streaks', 'dashTell', (f) => (f.vars.high = 1)],
  ]
  for (const [kind, state, tweak] of cases) {
    for (const dx of [-12, 0, 12]) {
      const w = arena(kind)
      t.ok(playUntil(w, kind, (f) => f.state === state && f.stateT === 1) > 0, `${kind} reached ${state}`)
      const foe = foeOf(w, kind)
      if (tweak) tweak(foe)
      const p = w.player
      p.x = mid(foe) + dx - p.w / 2
      p.y = foe.y - p.h - 40
      p.vx = 0
      p.vy = 300
      p.onGround = false
      p.invuln = 0
      p.state = 'normal'
      const input = t.makeInput()
      let floorAt = -1
      // Hands off until he is down, and a little after (the next attack is his own business).
      for (let i = 0; i < 90 && (floorAt < 0 || i < floorAt + 8); i++) {
        sim.stepWorld(w, input([]))
        w.events.length = 0
        if (p.state === 'hurt' || p.pips < 3) throw new Error(`${kind} in ${state}, Maxx dropped on his head ${dx} px off middle: hurt at tick ${i}`)
        if (floorAt < 0 && p.onGround) floorAt = i
      }
      t.ok(floorAt >= 0 && floorAt <= 50, `${kind} in ${state}: back on the floor at tick ${floorAt}`)
    }
  }
})

t.test('bill: a sponge never leaves his hand into Maxx', () => {
  for (const seed of [1, 2, 3]) {
    const w = arena('bill', { seed })
    const input = t.makeInput()
    let rnd = seed * 7919
    const r = () => ((rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 4294967296)
    let held = []
    const seen = new Set()
    for (let i = 0; i < 8000; i++) {
      if (i % 7 === 0) held = ['left', 'right', 'jump', 'spray', 'up', 'down'].filter(() => r() < 0.4)
      w.player.pips = 3
      sim.stepWorld(w, input(held))
      w.events.length = 0
      for (const s of w.entities) {
        if (s.kind !== 'bill_sponge' || s.dead || seen.has(s.id)) continue
        seen.add(s.id)
        const p = w.player
        if (s.x < p.x + p.w && s.x + s.w > p.x && s.y < p.y + p.h && s.y + s.h > p.y) throw new Error(`seed ${seed}: a sponge appeared inside Maxx at tick ${i}`)
      }
    }
    t.ok(seen.size > 5, `seed ${seed}: sponges thrown (${seen.size})`)
  }
})

t.test('hurt as a telegraph starts, the good player still comes through the rest of that attack', () => {
  for (const kind of ['bill', 'streaks']) {
    const shots = telegraphs(kind)
    const bad = []
    for (const shot of shots) {
      for (const dx of [-160, -96, 96, 160]) {
        const w = structuredClone(shot.world)
        const foe = foeOf(w, kind)
        const x = Math.max(foe.vars.ax0 + 11, Math.min(foe.vars.ax1 - 11, mid(foe) + dx))
        const p = w.player
        p.x = x - p.w / 2
        p.y = FLOOR_Y - p.h
        p.vx = p.vy = 0
        p.onGround = true
        p.state = 'normal'
        p.invuln = 0
        p.pips = 3
        sim.hurtPlayer(w, { fromX: mid(foe), force: true })
        const input = t.makeInput()
        const player = makePlayer(kind, 12)
        const seen = { left: false }
        for (let i = 0; i < 400; i++) {
          sim.stepWorld(w, input(player(w)))
          w.events.length = 0
          if (p.pips < 2) {
            bad.push(`${shot.key} from ${dx}`)
            break
          }
          if (foe.state !== shot.state) seen.left = true
          if (ATTACKS[kind][shot.state].over(foe.state, w, seen)) break
        }
      }
    }
    t.ok(bad.length === 0, `${kind}: hit again during: ${bad.join('; ')}`)
  }
})

t.test('rivalsBeaten already 0 to 4 when an area loads: each rival is there only while his number is not covered, and the doors agree', () => {
  for (const flag of [0, 1, 2, 3, 4]) {
    for (const [area, kinds] of [
      ['bill', ['bill']],
      ['streaks', ['streaks']],
      ['pair', ['bill', 'streaks']],
    ]) {
      const w = arena(kinds[0], { area, flags: flag ? { [FLAG]: flag } : undefined })
      t.steps(w, ['right'], 30)
      for (const kind of kinds) t.eq(!!foeOf(w, kind), flag < RIVALS[kind].number, `flag ${flag}, area ${area}: ${kind} there`)
      for (const door of t.all(w, 'door')) {
        t.eq(door.state === 'locked', flag < door.props.min, `flag ${flag}, area ${area}: door to ${door.props.to} locked`)
      }
    }
  }
})

t.test('both rivals in one area, one after the other (area pair): the good player beats both without a hit', () => {
  const w = arena('bill', { area: 'pair' })
  const players = { bill: makePlayer('bill', 12), streaks: makePlayer('streaks', 12) }
  const input = t.makeInput()
  const locks = []
  let hits = 0
  let lastUp = false
  for (let i = 0; i < 60 * 240 && w.status === 'play'; i++) {
    const bill = foeOf(w, 'bill')
    const sk = foeOf(w, 'streaks')
    let held
    if (bill.state !== 'beaten') held = players.bill(w)
    else if (sk.state === 'wait' && w.player.x < 19 * TILE) {
      // Over to Bill's door, then up through it, a fresh press each time.
      const cx = w.player.x + w.player.w / 2
      const doorX = 17 * TILE + TILE / 2
      held = Math.abs(cx - doorX) > 4 ? [cx < doorX ? 'right' : 'left'] : lastUp ? [] : ['up']
    } else held = players.streaks(w)
    lastUp = held.includes('up')
    sim.stepWorld(w, input(held))
    for (const ev of w.events) if (ev.type === 'sfx' && ev.id === 'hurt') hits++
    w.events.length = 0
    const key = w.camBounds ? `${w.camBounds.x0}..${w.camBounds.x1}` : 'free'
    if (locks[locks.length - 1] !== key) locks.push(key)
    if (sk.state === 'beaten' && sk.stateT > 60) break
  }
  t.eq(foeOf(w, 'bill').state, 'beaten', 'Bill')
  t.eq(foeOf(w, 'streaks').state, 'beaten', 'Sir Streaks')
  t.eq(hits, 0, 'hits')
  t.eq(sim.getFlag(w, FLAG), 2, 'flag')
  t.eq(locks.join(' '), 'free 0..640 free 608..1248 free', 'the camera locks to each arena in turn')
})

t.test('wax and turbo: waxed he can stand in a rival unhurt, and the turbo nozzle only shortens the fight', () => {
  for (const kind of ['bill', 'streaks']) {
    const waxed = fight(kind, () => ['spray'], {
      max: 60 * 60,
      each: (w) => {
        w.player.wax = 600
      },
    })
    t.eq(waxed.hits, 0, `${kind}: hits on wax`)
    const turbo = fight(kind, makePlayer(kind, 12), {
      after: 10,
      each: (w) => {
        w.player.turbo = true
      },
    })
    t.ok(turbo.end > 0 && turbo.hits === 0, `${kind}: the good player on turbo wins unhurt`)
    t.notes.push(`${kind}: with the turbo nozzle all fight the good player wins in ${secs(turbo.end - turbo.start)} s`)
  }
})

t.test('random play in both arenas never breaks anything and is deterministic', () => {
  for (const kind of ['bill', 'streaks']) {
    const runs = [0, 1].map(() => {
      const w = arena(kind)
      const input = t.makeInput()
      let seed = 1234
      const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
      const acts = ['left', 'right', 'jump', 'spray', 'up', 'down']
      let held = []
      const hashes = []
      for (let i = 0; i < 6000; i++) {
        if (i % 9 === 0) held = acts.filter(() => rnd() < 0.35)
        w.player.pips = 3
        sim.stepWorld(w, input(held))
        w.events.length = 0
        hashes.push(sim.worldHash(w))
        for (const e of w.entities) {
          if (!Number.isFinite(e.x + e.y + e.vx + e.vy + e.hp)) throw new Error(`${e.kind} has a bad number at tick ${i}`)
          if (e.kind === kind && (e.x < 0 || e.x + e.w > 640 || e.y + e.h > FLOOR_Y + 0.5)) throw new Error(`${kind} left the arena at tick ${i}: ${e.x},${e.y}`)
        }
        if (w.status !== 'play') break
      }
      return hashes
    })
    t.eq(runs[0].length, runs[1].length, `${kind} ticks`)
    for (let i = 0; i < runs[0].length; i++) if (runs[0][i] !== runs[1][i]) throw new Error(`${kind}: random runs differ at tick ${i}`)
  }
})

await t.finish()
