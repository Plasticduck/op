// MUDSLINGER (sim/entities/mudslinger.ts), fought in its own arena (levels/dev/mudslinger.ts),
// which is built exactly as the end of MW04 must build it.
//
//   node scripts/maxx/tests/mudslinger.mjs [--only <text>] [--trace]
//
// The players here are scripted. Each reads the truck the way a person reads the screen (its
// state, the shadows on the ground) and only ever answers a tell `react` ticks after it starts:
//   good    12-tick reactions: dodges every volley and charge, washes it while it is spent
//   clumsy  25-tick reactions; at a volley he lurches 40-110 px (his seed decides) away from his
//           own shadow without looking at the others, and needs 25 ticks more to notice he is in
//           another; washes from 70 px off
//   statue  stands in the middle and sprays, whatever happens
//   hover   jumps the charge and hovers over it instead of using a catwalk
//   hug     lives against one wall, and leaves it only to dodge and to wash
//   perch   climbs one catwalk and never comes down
//   hopper  the good player, but he jumps whenever his feet touch the ground
//   ground  the good player who never jumps
//   tail    stands right at the truck's tail through every volley, spraying it
// The block between the PILOT marks is plain JavaScript with no imports, so a script that plays
// the fight in the browser (for pictures) can load the very same players into the page.
import { suite } from '../lib/testkit.mjs'

// ---- PILOT BEGIN ----
const P_TILE = 32
const P_MAXX_W = 22
const P_VOLLEY = ['tip', 'fling', 'settle']

function bossOf(w) {
  return w.entities.find((e) => e.kind === 'mudslinger' && !e.dead)
}

/** The arena as the truck sees it: interior walls, floor, and every catwalk inside. */
function geometry(w) {
  const v = bossOf(w).vars
  const g = w.grid
  const cats = []
  for (let ty = 0; ty < v.fy / P_TILE; ty++) {
    let run = -1
    for (let tx = v.x0 / P_TILE; tx <= v.x1 / P_TILE; tx++) {
      const cat = tx < v.x1 / P_TILE && g.t[ty * g.w + tx] === 61 // '='
      if (cat && run < 0) run = tx
      if (!cat && run >= 0) {
        cats.push({ x0: run * P_TILE, x1: tx * P_TILE, top: ty * P_TILE, mid: ((run + tx) * P_TILE) / 2 })
        run = -1
      }
    }
  }
  return { lo: v.x0 + P_TILE, hi: v.x1 - P_TILE, fy: v.fy, cats }
}

const cxOf = (p) => p.x + p.w / 2
const feetOf = (p) => p.y + p.h

/** Which catwalk he stands on, or null. */
function onCat(p, geo) {
  if (!p.onGround) return null
  for (const c of geo.cats) if (Math.abs(feetOf(p) - c.top) < 1 && p.x + p.w > c.x0 && p.x < c.x1) return c
  return null
}

/** -1, 0 or 1: the way to push the stick to stop with his middle at x. */
function steer(p, x, tol = 3) {
  const d = x - cxOf(p)
  if (Math.abs(d) <= tol) return 0
  // Let go in time: he slides about v^2 / (2 * 1400) px once the stick is released.
  if (Math.sign(p.vx) === Math.sign(d) && Math.abs(d) <= (p.vx * p.vx) / 2800 + 1) return 0
  return d > 0 ? 1 : -1
}
const stick = (dir) => (dir > 0 ? ['right'] : dir < 0 ? ['left'] : [])

/** Where the dirty truck can be sprayed from: its back end, and the way out of it into the arena. */
function tailOf(b) {
  return b.facing < 0 ? { x: b.x + b.w, out: 1 } : { x: b.x, out: -1 }
}

/** Held actions that face the truck and spray, standing where he is. */
function sprayAt(p, b) {
  const want = cxOf(p) < b.x + b.w / 2 ? 1 : -1
  return p.facing === want ? ['spray'] : [...stick(want), 'spray']
}

function gapTo(p, b) {
  const cx = cxOf(p)
  return cx < b.x ? b.x - cx - p.w / 2 : cx > b.x + b.w ? cx - b.x - b.w - p.w / 2 : 0
}

/** Floor spots safe from every shadow now on the floor: clear of each lump by `margin`, clear of the truck. */
function safeSpots(w, geo, b, margin) {
  const marks = w.entities.filter((e) => e.kind === 'ms_mark' && !e.dead && Math.abs(e.y + e.h - geo.fy) < 1)
  const spots = []
  for (let x = geo.lo + P_MAXX_W / 2 + 2; x <= geo.hi - P_MAXX_W / 2 - 2; x += 4) {
    if (x + P_MAXX_W / 2 > b.x - 24 && x - P_MAXX_W / 2 < b.x + b.w + 24) continue
    // A lump reaches its own half width (8 for a clod, 36 for the slop) past the middle of its shadow.
    if (marks.some((m) => Math.abs(m.x + m.w / 2 - x) < P_MAXX_W / 2 + (m.w > 40 ? 36 : 8) + margin)) continue
    spots.push(x)
  }
  return spots
}

/** The catwalk nearest to x (to the nearest point a jump from under it reaches). */
function nearestCat(geo, x) {
  let cat = null
  let best = Infinity
  for (const c of geo.cats) {
    const d = Math.abs(x - Math.max(c.x0 + 16, Math.min(c.x1 - 16, x)))
    if (d < best) {
      best = d
      cat = c
    }
  }
  return cat
}

/**
 * A scripted player. opts: react (ticks after a tell before he answers it), clumsy (rougher
 * choices), statue (stand and spray), hover (jump the charge and hover instead of a catwalk),
 * hug (-1 or 1: lives against that wall), perch (index of the catwalk he never leaves),
 * hopper (jumps whenever he lands), ground (never jumps), tail (stands at its tail through volleys).
 */
function makePilot(geo, opts = {}) {
  const R = opts.react ?? 12
  const clumsy = !!opts.clumsy
  let goal = null
  let plan = ''
  let cat = null
  let hold = 0
  let home = null
  let second = 0
  let wake = 0
  let hopHeld = false
  let lastHeld = []
  // A clumsy player's own wobble: how far he lurches, from a seed, so ten fights are ten different people.
  let rs = (opts.seed ?? 1) * 2654435761
  const wobble = () => {
    rs = (Math.imul(rs ^ (rs >>> 15), 2246822519) + 0x9e3779b9) | 0
    return ((rs >>> 0) % 1000) / 1000
  }
  const think = (w) => {
    const p = w.player
    const b = bossOf(w)
    if (!b || p.state !== 'normal') return []
    const cx = cxOf(p)
    if (home === null) home = opts.hug ? (opts.hug < 0 ? geo.lo + P_MAXX_W / 2 + 6 : geo.hi - P_MAXX_W / 2 - 6) : geo.lo + (geo.hi - geo.lo) * 0.45
    if (opts.statue) {
      if (b.state === 'wait' || Math.abs(cx - home) > 4) return stick(steer(p, home))
      return sprayAt(p, b)
    }
    if (opts.perch !== undefined) return perch(w, p, b, geo.cats[opts.perch])
    const st = b.state
    if (st === 'clean' || st === 'happy') return []

    // The volley: once the shadows are read, a spot clear of all of them.
    if ((st === 'tip' && b.stateT > R) || st === 'fling' || st === 'settle') {
      if (opts.tail) {
        const tail = tailOf(b)
        const dir = steer(p, tail.x + tail.out * (P_MAXX_W / 2 + 6), 2)
        return dir ? stick(dir) : sprayAt(p, b)
      }
      if (plan !== 'volley') {
        plan = 'volley'
        if (clumsy) {
          // First impulse: away from his own shadow, toward the middle, without looking at the others.
          const mid = (geo.lo + geo.hi) / 2
          goal = cx + (cx < mid ? 1 : -1) * (40 + 70 * wobble())
          second = -1
          wake = 0
        } else {
          const spots = safeSpots(w, geo, b, 10)
          let best = null
          let score = Infinity
          for (const x of spots) {
            const reach = Math.max(0, (x < b.x ? b.x - x : x - b.x - b.w) - 150)
            const s = opts.hug ? Math.abs(x - home) : Math.abs(x - cx) + reach
            if (s < score) {
              score = s
              best = x
            }
          }
          goal = best ?? cx
        }
      }
      const c = onCat(p, geo)
      // Off a catwalk by the end away from the truck, never down onto it.
      if (c) {
        const left = Math.abs(c.x0 - (b.x + b.w)) < 40 || Math.abs(c.x0 - b.x) < 40
        return stick(left ? 1 : goal < c.mid ? -1 : 1)
      }
      const dir = steer(p, goal)
      if (dir !== 0) return stick(dir)
      if (clumsy && second < 0 && !safeSpots(w, geo, b, 0).some((x) => Math.abs(x - cx) < 3)) {
        // ... then he notices he is standing in another shadow, and needs as long again to move.
        if (wake === 0) wake = R
        if (--wake === 0) {
          const spots = safeSpots(w, geo, b, 0)
          goal = spots.reduce((a, x) => (Math.abs(x - cx) < Math.abs(a - cx) ? x : a), spots[0] ?? cx)
          second = 1
        }
      }
      return !clumsy && gapTo(p, b) < 170 ? sprayAt(p, b) : []
    }

    // The charge: up onto a catwalk (or over the top on the hover) and wait there.
    if ((st === 'rev' && b.stateT > R) || st === 'charge') {
      if (plan !== 'dodge') {
        plan = 'dodge'
        cat = nearestCat(geo, cx)
        hold = 0
      }
      if (opts.hover) return hoverOver(p, b)
      return climb(p, cat)
    }

    // Spent (or bonked): close in on its back end and wash.
    if (st === 'bonk' || st === 'spent') {
      plan = 'wash'
      const c = onCat(p, geo)
      if (c) {
        // Down off the end nearer the truck, unless that end hangs over it.
        const toward = b.x + b.w / 2 > c.mid ? 1 : -1
        const end = toward > 0 ? c.x1 : c.x0
        return stick(end + 30 > b.x && end - 30 < b.x + b.w ? -toward : toward)
      }
      if (!p.onGround) return []
      const tail = tailOf(b)
      const spot = tail.x + tail.out * ((clumsy ? 70 : 40) + P_MAXX_W / 2)
      const dir = steer(p, spot, 6)
      if (dir !== 0) return stick(dir)
      return sprayAt(p, b)
    }

    // Anything else (the intro, a turn, the tantrum, the moment it gets up): keep clear and spray.
    plan = ''
    const c = onCat(p, geo)
    if (c) return stick(Math.abs(c.x0 - (b.x + b.w)) < 40 || Math.abs(c.x0 - b.x) < 40 ? 1 : -1)
    if (!p.onGround) return []
    if (gapTo(p, b) < 30) return stick(cx < b.x + b.w / 2 ? -1 : 1)
    if (st === 'wait' || st === 'intro' || opts.hug) {
      const dir = steer(p, home, 6)
      if (dir !== 0) return stick(dir)
    }
    return gapTo(p, b) < 170 ? sprayAt(p, b) : []
  }

  function climb(p, c) {
    const on = onCat(p, geo)
    if (on === c) return stick(steer(p, c.mid, 10))
    if (on) return []
    if (!p.onGround) {
      hold--
      return [...stick(steer(p, c.mid, 6)), ...(hold > 0 ? ['jump'] : [])]
    }
    const under = Math.max(c.x0 + 16, Math.min(c.x1 - 16, cxOf(p)))
    if (Math.abs(under - cxOf(p)) > 4) return stick(steer(p, under, 2))
    hold = 24
    return ['jump']
  }

  function hoverOver(p, b) {
    if (p.onGround) {
      // How far the truck's nose still is from him.
      const lead = b.facing < 0 ? b.x - (p.x + p.w) : p.x - (b.x + b.w)
      if (b.state === 'charge' && lead > 0 && lead < 150) {
        hold = 24
        return ['jump']
      }
      return []
    }
    hold--
    if (hold > 0 && p.vy < 0) return ['jump']
    return ['down', 'spray']
  }

  /** Up on one catwalk for good; along it, away from any shadow that lands on it. */
  function perch(w, p, b, c) {
    const on = onCat(p, geo)
    if (on !== c) return climb(p, c)
    const marks = w.entities.filter((e) => e.kind === 'ms_mark' && !e.dead && Math.abs(e.y + e.h - c.top) < 1)
    let best = c.mid
    let score = -Infinity
    for (let x = c.x0 + 6; x <= c.x1 - 6; x += 2) {
      const clear = marks.reduce((m, k) => Math.min(m, Math.abs(k.x + k.w / 2 - x)), 999)
      const s = Math.min(clear, 60) - Math.abs(x - c.mid) * 0.01
      if (s > score) {
        score = s
        best = x
      }
    }
    void b
    return stick(steer(p, best, 2))
  }

  return (w) => {
    let held = think(w)
    const p = w.player
    if (opts.ground) held = held.filter((a) => a !== 'jump')
    // (Through the doorway first: it is too low to hop through.)
    if (opts.hopper && p.state === 'normal' && bossOf(w)?.state !== 'wait') {
      // A nervous thumb on the jump button: a full hop every time his feet touch down. In the air
      // he keeps the stick (and the trigger) where they were on the ground, as people do.
      if (p.onGround) {
        hopHeld = !hopHeld
        lastHeld = held.filter((a) => a !== 'jump')
      } else {
        hopHeld = p.vy < 0
        if (held.length === 0) held = lastHeld
      }
      if (hopHeld && !held.includes('jump')) held = [...held, 'jump']
    }
    return held
  }
}
// ---- PILOT END ----

const t = await suite('mudslinger')
const { sim, levels, contract } = t
const { TILE } = contract
const LEVEL = levels.levelById('dev-mudslinger')
const MAXX_W = contract.MAXX_W
const TRACE = process.argv.includes('--trace')
const sum = (a) => a.reduce((s, x) => s + x, 0)
const mean = (a) => sum(a) / a.length

function arena(opts = {}) {
  return sim.createWorld(opts.level ?? LEVEL, { session: t.freshSession(opts.session), seed: opts.seed ?? 1, flags: opts.flags, checkpoint: opts.checkpoint })
}

const MIRROR = (() => {
  const area = LEVEL.areas[0]
  return {
    ...LEVEL,
    id: 'dev-mudslinger-mirror',
    areas: [{ ...area, rows: area.rows.map((r) => [...r].reverse().join('')), legend: { ...area.legend, S: { kind: 'mudslinger', props: { dir: 1 } } } }],
  }
})()

/**
 * Play a fight to its end. Returns hits taken (and in which of its states the truck was at each),
 * the fight's length and what was heard. `refill` puts his shine back after each hit to count them.
 */
function fight(w, pilot, { maxTicks = 60 * 300, refill = false, each = null } = {}) {
  const input = t.makeInput()
  let hits = 0
  const by = {}
  const cause = { truck: 0, lump: 0 }
  let start = -1
  let end = -1
  let pips = w.player.pips
  const events = []
  for (let i = 0; i < maxTicks; i++) {
    const before = bossOf(w)?.state
    sim.stepWorld(w, input(pilot(w)))
    for (const ev of w.events) events.push({ tick: w.tick, ...ev })
    w.events.length = 0
    if (w.player.pips < pips) {
      hits += pips - w.player.pips
      const k = P_VOLLEY.includes(before) ? 'volley' : before === 'rev' || before === 'charge' ? 'charge' : before
      by[k] = (by[k] ?? 0) + 1
      // What hit him: the truck itself if his box is in it, else a lump of mud.
      const tb = bossOf(w)
      const p0 = w.player
      const inTruck = tb && p0.x < tb.x + tb.w + 4 && p0.x + p0.w > tb.x - 4 && p0.y < tb.y + tb.h + 4 && p0.y + p0.h > tb.y - 4
      cause[inTruck ? 'truck' : 'lump']++
      if (TRACE) {
        const b = bossOf(w)
        const p = w.player
        const near = w.entities.filter((e) => e.kind === 'ms_clod' && !e.dead).map((e) => `${Math.round(e.x)},${Math.round(e.y)}`)
        console.log(`  hit at ${w.tick}: truck ${b?.state} t${b?.stateT} x${Math.round(b?.x)} facing ${b?.facing}; Maxx ${Math.round(p.x)},${Math.round(p.y)} vx ${Math.round(p.vx)} ground ${p.onGround}; clods ${near.join(' ')}`)
      }
    }
    if (refill && w.status === 'play' && w.player.pips < 3) w.player.pips = 3
    pips = w.player.pips
    const b = bossOf(w)
    if (b && start < 0 && b.state !== 'wait') start = w.tick
    if (b && end < 0 && b.state === 'clean') end = w.tick
    if (each && each(w, b) === true) break
    if (w.status !== 'play') break
    if (end >= 0 && w.tick > end + 220) break
  }
  return { hits, by, cause, start, end, seconds: end > 0 ? (end - start) / 60 : Infinity, events, grimed: w.status === 'grimed' }
}

const byText = (by) => Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'

/** Put Maxx's feet at (x, feetY), standing, fresh: no blinking, full shine. */
function put(w, x, feetY) {
  const p = w.player
  p.x = x - p.w / 2
  p.y = feetY - p.h
  p.px = p.x
  p.py = p.y
  p.vx = 0
  p.vy = 0
  p.state = 'normal'
  p.stateT = 0
  p.invuln = 0
  p.pips = 3
  p.onGround = true
  p.airT = 0
  p.coyote = 0
  p.jumping = false
  p.jumpCut = false
  p.jumpBuf = 0
  p.hover = sim.TUNING.hoverTicks
  p.ridingId = 0
  p.spraying = false
  p.hovering = false
}

/* ------------------------------------------------------------------ */
/* The good fight, once, shared by several tests                       */
/* ------------------------------------------------------------------ */

const snaps = new Map()
const good = (() => {
  const w = arena()
  const geo = geometry(w)
  const pilot = makePilot(geo)
  const states = []
  let checkpointAt = null
  const drift = []
  let clodTicks = 0
  const r = fight(w, pilot, {
    each(world, b) {
      if (!b) return false
      if (states[states.length - 1] !== b.state) states.push(b.state)
      if ((b.state === 'tip' || b.state === 'rev') && b.stateT === 0) {
        const key = `${b.state} ${b.vars.phase ? 'angry' : 'calm'} at the ${b.vars.side > 0 ? 'right' : 'left'} wall`
        if (!snaps.has(key)) snaps.set(key, structuredClone(world))
      }
      // A moment in the angry half to come back to as if he had just been grimed.
      if (!checkpointAt && b.vars.phase === 1 && b.state === 'charge') checkpointAt = structuredClone(world)
      // Lower than the top of Maxx's head on a catwalk, a clod is plumb over the bed or over its shadow.
      for (const c of world.entities) {
        if (c.kind !== 'ms_clod' || c.dead || c.vars.slop) continue
        clodTicks++
        if (c.y + c.h <= geo.fy - 3 * TILE - 52) continue
        const from = Math.abs(c.x - c.vars.sx)
        const to = Math.abs(c.x - (c.vars.sx + c.vars.dx))
        if (Math.min(from, to) > 0.5) drift.push(`${Math.round(c.x)},${Math.round(c.y)} t${c.vars.t}/${c.vars.T}`)
      }
      return false
    },
  })
  return { ...r, w, geo, states, checkpointAt, drift, clodTicks }
})()

t.test('the arena is what the header says: one screen, walls with a doorway, two catwalks three tiles up', () => {
  const w = arena()
  const b = bossOf(w)
  const geo = geometry(w)
  t.eq(b.vars.x1 - b.vars.x0, 20 * TILE, 'arena width')
  t.eq(geo.cats.length, 2, 'catwalks')
  for (const c of geo.cats) t.eq(geo.fy - c.top, 3 * TILE, 'catwalk height')
  t.eq(geo.cats[0].x0 - b.vars.x0, 5 * TILE, 'first catwalk from arena column 5')
  t.eq(geo.cats[1].x0 - b.vars.x0, 12 * TILE, 'second catwalk from arena column 12')
  t.eq(b.w, 136, 'truck width')
  t.eq(b.h, 88, 'truck height')
  t.eq(b.hp, 80, 'dirt')
  t.ok(b.x + b.w === geo.hi, 'it starts backed up against the right wall')
  t.eq(b.state, 'wait', 'it waits for Maxx')
  const gate = t.find(w, 'gate')
  t.ok(gate && gate.x === b.vars.x1 - TILE && gate.y + gate.h === geo.fy && gate.h === 2 * TILE, 'the gate fills the right doorway')
})

t.test('the fight starts once Maxx is in: versus card, camera locked, doorways shut, boss bar every tick', () => {
  const w = arena()
  const input = t.makeInput()
  const seen = []
  let bars = 0
  let fightTicks = 0
  for (let i = 0; i < 400; i++) {
    sim.stepWorld(w, input(['right']))
    seen.push(...w.events)
    w.events.length = 0
    const b = bossOf(w)
    if (b.state !== 'wait') {
      fightTicks++
      if (w.boss && w.boss.name === 'MUDSLINGER' && w.boss.hp === b.hp) bars++
    }
  }
  const vs = seen.filter((e) => e.type === 'versus')
  t.eq(vs.length, 1, 'versus events')
  t.eq(vs[0].name, 'MUDSLINGER', 'versus name')
  t.ok(/^[A-Z !]+$/.test(vs[0].tagline), `tagline is capitals: ${vs[0].tagline}`)
  t.ok(w.camBounds && w.camBounds.x0 === bossOf(w).vars.x0 && w.camBounds.x1 === bossOf(w).vars.x1, 'camera locked to the arena')
  // The way in gets the truck's own shutter; the way out already has the level's gate in it.
  const doors = t.all(w, 'ms_door')
  t.eq(doors.length, 1, 'shutters')
  t.eq(doors[0].x, bossOf(w).vars.x0, 'the shutter is in the left doorway')
  const gate = t.find(w, 'gate')
  t.ok(gate && gate.state === 'shut' && gate.x === bossOf(w).vars.x1 - TILE, 'the gate stands shut in the right doorway')
  t.ok(fightTicks > 0 && bars === fightTicks, `boss bar set on ${bars} of ${fightTicks} fight ticks`)
  t.ok(seen.some((e) => e.type === 'music' && e.id === 'boss'), 'boss music')
  t.ok(sim.getBehavior('mudslinger').alwaysActive, 'alwaysActive')
  for (const k of ['ms_clod', 'ms_mark', 'ms_puddle']) t.eq(sim.getBehavior(k).offscreen, 'remove', `${k} offscreen`)
})

t.test('the fight can start while he is in the air: the shutter drops behind him and nothing touches him', () => {
  let airborne = 0
  // He jumps as his front clears the inside of the wall by `at` px (any sooner and the wall over
  // the doorway stops his head), running or from a standstill, and steers on in the air.
  for (const run of [true, false]) {
    for (const at of [0, 4, 8, 12, 16, 20, 24]) {
      const w = arena()
      const input = t.makeInput()
      const b = bossOf(w)
      let jumped = false
      let air = false
      for (let i = 0; i < 600 && b.state === 'wait'; i++) {
        const p = w.player
        const past = p.x + p.w - (b.vars.x0 + TILE)
        let held = ['right']
        if (!jumped && past >= at) {
          if (!run && Math.abs(p.vx) > 1) held = []
          else {
            jumped = true
            held = ['right', 'jump']
          }
        } else if (jumped) held = ['right', 'jump']
        sim.stepWorld(w, input(held))
        w.events.length = 0
        if (b.state !== 'wait') air = !w.player.onGround
      }
      t.ok(b.state === 'intro', `the fight started (jump ${at} px in, ${run ? 'running' : 'standing'})`)
      if (air) airborne++
      const p = w.player
      const door = t.find(w, 'ms_door')
      t.ok(door && p.x >= door.x + door.w, `he is clear of the shutter (x ${p.x.toFixed(1)}, shutter to ${door?.x + door?.w})`)
      t.until(w, ['right'], (x) => x.player.onGround, 120)
      t.eq(w.player.pips, 3, 'not hurt')
      t.eq(w.player.state, 'normal', 'standing')
      t.ok(w.player.x >= door.x + door.w, 'and inside')
    }
  }
  t.notes.push(`fight started with Maxx in the air in ${airborne} of 14 tries, never trapped or hurt`)
  t.ok(airborne >= 6, 'most of these started in the air')
})

t.test('a good player (12-tick reactions) washes it without taking a hit, in 60 to 90 seconds', () => {
  const g = good
  t.notes.push(`good player: washed in ${g.seconds.toFixed(1)} s of fight (${g.end - g.start} ticks), hits taken ${g.hits}`)
  t.notes.push(`good player: states ${g.states.join(' > ')}`)
  t.ok(g.end > 0, `never washed (boss ${bossOf(g.w)?.state}, dirt ${bossOf(g.w)?.hp.toFixed(1)})`)
  t.eq(g.hits, 0, 'hits taken')
  t.ok(g.seconds >= 60 && g.seconds <= 90, `fight length ${g.seconds.toFixed(1)} s`)
})

t.test('a clod only ever moves sideways above the head of a Maxx standing on a catwalk', () => {
  t.ok(good.clodTicks > 500, `clods seen in flight: ${good.clodTicks} clod-ticks`)
  t.ok(good.drift.length === 0, `low and off its line: ${good.drift.slice(0, 6).join('; ')}`)
})

t.test('washed: flag set, bar cleared, jingle, doors open, camera free, the way out is open', () => {
  const g = good
  const w = g.w
  const b = bossOf(w)
  t.eq(w.flags.mudslinger, 1, 'flag mudslinger')
  t.eq(w.boss, null, 'boss bar cleared')
  t.eq(w.camBounds, null, 'camera unlocked')
  t.eq(b.state, 'happy', 'parked happy')
  t.eq(b.harmful, false, 'harmless')
  t.eq(b.solid, 'top', 'its roof is ground')
  t.ok(g.events.some((e) => e.type === 'jingle' && e.id === 'rivalDown'), 'jingle')
  t.ok(g.events.some((e) => e.type === 'sfx' && e.id === 'bossDown'), 'bossDown')
  t.ok(g.events.some((e) => e.type === 'music' && e.id === 'storm' && e.tick >= g.end), 'the level song comes back')
  t.ok(g.events.filter((e) => e.type === 'sfx' && e.id === 'honk' && e.tick > g.end).length >= 2, 'it honks when clean')
  t.eq(t.all(w, 'ms_door').length, 0, 'doors gone')
  t.eq(t.all(w, 'ms_clod').length + t.all(w, 'ms_mark').length, 0, 'nothing left flying')
  const gate = t.find(w, 'gate')
  t.ok(gate && gate.solid === 'none', `the gate in the way out opened (${gate?.state})`)
  // Walk out to the exit arch.
  const steps = t.until(w, ['right'], (x) => x.status === 'clear', 900)
  t.ok(steps > 0, `never reached the exit (Maxx at ${Math.round(w.player.x)})`)
})

t.test('mirrored (dir 1, entrance on the right): the same fight the other way round, won without a hit', () => {
  const w = arena({ level: MIRROR, seed: 3 })
  const b = bossOf(w)
  const geo = geometry(w)
  t.eq(b.x, geo.lo, 'it starts against the left wall')
  t.eq(b.vars.x0, 8 * TILE, 'the same arena')
  const input = t.makeInput()
  t.until(w, ['left'], (x) => bossOf(x).state !== 'wait', 400, input)
  t.eq(t.all(w, 'ms_door').length, 1, 'the shutter drops in the right doorway')
  t.ok(t.all(w, 'ms_door')[0].x === b.vars.x1 - TILE, 'right doorway')
  const r = fight(w, makePilot(geo))
  t.notes.push(`mirrored arena: good player washed it in ${r.seconds.toFixed(1)} s, hits ${r.hits}`)
  t.ok(r.end > 0, 'washed')
  t.eq(r.hits, 0, 'hits')
  t.eq(w.flags.mudslinger, 1, 'flag')
})

t.test('a retry with the flag set finds it gone and walks straight through', () => {
  const w = arena({ flags: { mudslinger: 1 } })
  t.eq(t.all(w, 'mudslinger').length, 0, 'no truck')
  let locked = false
  const steps = t.until(w, ['right'], (x) => {
    if (x.camBounds) locked = true
    return x.status === 'clear'
  }, 900)
  t.ok(steps > 0, 'reached the exit')
  t.ok(!locked, 'no camera lock')
  t.eq(t.all(w, 'ms_door').length, 0, 'no doors')
})

t.test('grimed mid-fight, the retry from the checkpoint before the arena starts the fight afresh', () => {
  const old = good.checkpointAt
  t.ok(old && old.checkpoint, 'the good fight passed the checkpoint and reached the angry half')
  t.ok(old.checkpoint.x < bossOf(old).vars.x0, 'the checkpoint is outside the arena')
  // What the play scene does after GRIMED: a new world from the checkpoint, with the flags.
  const w = arena({ checkpoint: old.checkpoint, flags: old.flags })
  const b = bossOf(w)
  t.ok(b && b.state === 'wait' && b.hp === b.maxHp && b.vars.phase === 0, 'the truck is back, dirty, calm and waiting')
  t.eq(w.boss, null, 'no boss bar until he walks in')
  t.eq(w.camBounds, null, 'the camera is free')
  t.eq(t.all(w, 'ms_door').length + t.all(w, 'ms_clod').length + t.all(w, 'ms_mark').length + t.all(w, 'ms_puddle').length, 0, 'none of the last fight is left')
  t.ok(w.player.x + w.player.w < b.vars.x0, 'Maxx starts outside the arena')
  const seen = []
  t.until(w, ['right'], (x) => bossOf(x).state !== 'wait', 400, t.makeInput(), seen)
  t.ok(seen.some((e) => e.type === 'versus') && seen.some((e) => e.type === 'music' && e.id === 'boss'), 'versus card and boss music again')
  t.ok(w.camBounds && t.all(w, 'ms_door').length === 1 && w.boss, 'locked, shut in, boss bar up')
  const r = fight(w, makePilot(geometry(w)))
  t.ok(r.end > 0 && r.hits === 0, `and it can be won again (${r.hits} hits)`)
})

t.test('every attack is dodgeable from every spot in the arena, answering 12 ticks after its tell starts', () => {
  t.ok(snaps.size === 8, `tells seen: ${[...snaps.keys()].join(', ')}`)
  const report = []
  for (const [key, snap] of snaps) {
    const r = search(snap, key.startsWith('tip'), null)
    report.push(`${key}: ${r.spots} spots, ${r.tries} tries, ${r.fails.length} with no way out`)
    t.ok(r.fails.length === 0, `${key}: no escape from ${r.fails.join(' ')}`)
  }
  t.notes.push(`dodge search: ${report.join('; ')}`)
})

t.test('and with a slow player\'s 25-tick reactions, from every spot there is still a way out', () => {
  const report = []
  for (const [key, snap] of snaps) {
    const r = search(snap, key.startsWith('tip'), null, 25)
    report.push(`${key}: ${r.fails.length} of ${r.spots} without one`)
    t.ok(r.fails.length === 0, `${key}: at 25 ticks no escape from ${r.fails.join(' ')}`)
  }
  t.notes.push(`dodge search at 25 ticks: ${report.join('; ')}`)
})

t.test('hit just as a tell starts, he can still dodge the attack once he has his feet back', () => {
  const report = []
  for (const [key, snap] of snaps) {
    // Knocked either way, from every spot: he gets control back after the hurt, plus 12 ticks.
    let fails = 0
    let spots = 0
    for (const side of [-1, 1]) {
      const r = search(snap, key.startsWith('tip'), side)
      fails += r.fails.length
      spots += r.spots
    }
    report.push(`${key}: ${spots} cases, ${fails} lost a second pip`)
    t.ok(fails === 0, `${key}: ${fails} cases where a second hit could not be avoided`)
  }
  t.notes.push(`hurt at the tell: ${report.join('; ')}`)
})

/** Try every spot in the arena at a tell's first tick. knock: null, or -1 / 1 to be hit there first. */
function search(snap, volley, knock, react = 12) {
  const geo = geometry(snap)
  const b0 = bossOf(snap)
  const spots = []
  for (let x = geo.lo + MAXX_W / 2; x <= geo.hi - MAXX_W / 2; x += 8) {
    if (x + MAXX_W / 2 > b0.x - 2 && x - MAXX_W / 2 < b0.x + b0.w + 2) continue
    spots.push({ x, y: geo.fy })
  }
  for (const c of geo.cats) for (let x = c.x0; x <= c.x1; x += 8) spots.push({ x, y: c.top })
  const fails = []
  let tries = 0
  for (const at of spots) {
    const ways = volley ? volleyWays(geo, at) : chargeWays(geo)
    let saved = false
    for (const way of ways) {
      tries++
      if (survives(snap, at, way, volley, knock, react)) {
        saved = true
        break
      }
    }
    if (!saved) fails.push(`${at.x},${at.y}`)
  }
  return { spots: spots.length, tries, fails }
}

/** Volley answers: stay, or walk to any floor spot (nearest first). */
function volleyWays(geo, at) {
  const ways = [{ kind: 'stay' }]
  const xs = []
  for (let x = geo.lo + MAXX_W / 2; x <= geo.hi - MAXX_W / 2; x += 8) xs.push(x)
  xs.sort((a, b) => Math.abs(a - at.x) - Math.abs(b - at.x))
  for (const x of xs) ways.push({ kind: 'walk', x })
  return ways
}

/** Charge answers: stay, climb either catwalk, or jump it on the hover from several distances. */
function chargeWays(geo) {
  const ways = [{ kind: 'stay' }]
  for (const c of geo.cats) ways.push({ kind: 'climb', c })
  for (let lead = 20; lead <= 260; lead += 20) for (const dir of [0, 1, -1]) ways.push({ kind: 'leap', lead, dir })
  return ways
}

/**
 * From the snapshot at a tell's first tick, Maxx at `at`, then `way` once he can move and 12
 * ticks have passed: no (further) hit until the attack is over.
 */
function survives(snap, at, way, volley, knock, react = 12) {
  const w = structuredClone(snap)
  const geo = geometry(w)
  put(w, at.x, at.y)
  let pips = 3
  if (knock) {
    // Hit by something on that side of him, the way any hit comes.
    sim.hurtPlayer(w, { fromX: at.x - knock * 10 })
    pips = w.player.pips
  }
  const input = t.makeInput()
  let hold = 0
  let jumped = false
  let free = -1
  for (let i = 1; i <= 700; i++) {
    const p = w.player
    const b = bossOf(w)
    if (free < 0 && p.state === 'normal') free = i
    let held = []
    if (free >= 0 && i >= free + react) {
      if (way.kind === 'walk') held = stick(steer(p, way.x))
      else if (way.kind === 'climb') {
        const on = onCat(p, geo)
        if (on === way.c) held = []
        else if (!p.onGround) {
          hold--
          held = [...stick(steer(p, way.c.mid, 6)), ...(hold > 0 ? ['jump'] : [])]
        } else {
          const under = Math.max(way.c.x0 + 16, Math.min(way.c.x1 - 16, cxOf(p)))
          if (Math.abs(under - cxOf(p)) > 4 || on) held = stick(on ? (way.c.mid < cxOf(p) ? -1 : 1) : steer(p, under, 2))
          else {
            hold = 24
            held = ['jump']
          }
        }
      } else if (way.kind === 'leap') {
        const lead = b.facing < 0 ? p.x - (b.x + b.w) : b.x - (p.x + p.w)
        if (!jumped && p.onGround && b.state === 'charge' && lead < way.lead) {
          jumped = true
          hold = 26
          held = ['jump', ...stick(way.dir * -b.facing)]
        } else if (jumped && !p.onGround) {
          hold--
          held = hold > 0 && p.vy < 0 ? ['jump', ...stick(way.dir * -b.facing)] : ['down', 'spray', ...stick(way.dir * -b.facing)]
        }
      }
    }
    sim.stepWorld(w, input(held))
    w.events.length = 0
    if (w.player.pips < pips || (!knock && w.player.state === 'hurt')) return false
    const nb = bossOf(w)
    if (volley && !P_VOLLEY.includes(nb.state)) return true
    if (!volley && nb.state === 'spent' && nb.stateT > 30) return true
  }
  return false
}

t.test('scripted players that lean on the edges of the arena: walls, catwalks, hopping, never jumping, the tail', () => {
  const lines = []
  const play = (label, opts, extra = {}) => {
    const w = arena({ level: extra.level, seed: extra.seed ?? 1 })
    const r = fight(w, makePilot(geometry(w), opts), { refill: true, maxTicks: extra.maxTicks ?? 60 * 200 })
    lines.push(`${label}: ${r.end > 0 ? `washed in ${r.seconds.toFixed(1)} s` : `not washed in ${(extra.maxTicks ?? 12000) / 60} s (dirt ${bossOf(w).hp.toFixed(1)})`}, hits ${r.hits} (${byText(r.by)}; ${r.cause.truck} touching the truck, ${r.cause.lump} by mud)`)
    return { ...r, w }
  }
  for (const [label, level] of [['', LEVEL], [' (mirrored)', MIRROR]]) {
    for (const hug of [-1, 1]) {
      const r = play(`hugs the ${hug < 0 ? 'left' : 'right'} wall${label}`, { hug }, { level })
      t.ok(r.end > 0 && r.hits === 0, `the ${hug < 0 ? 'left' : 'right'}-wall hugger${label}: ${r.hits} hits, washed ${r.end > 0}`)
    }
  }
  for (const perch of [0, 1]) {
    const r = play(`stays on catwalk ${perch + 1}`, { perch }, { maxTicks: 60 * 90 })
    t.eq(r.hits, 0, `perched on catwalk ${perch + 1}: hits`)
    t.ok(bossOf(r.w).hp > 70, 'a perch is safe but it washes nothing')
  }
  // Hopping all the time is no trap, only slow and careless: in the air his spray goes over the
  // truck, and his hops carry him into it when he closes in to wash.
  const hop = play('jumps whenever he lands', { hopper: true }, { maxTicks: 60 * 120 })
  t.eq(hop.cause.lump, 0, 'hopping never walks him under the mud')
  const ground = play('never jumps', { ground: true })
  t.eq(ground.cause.lump, 0, 'the mud never needs a jump')
  t.ok(ground.cause.truck >= 1 && !ground.by.volley, 'but the charge does')
  const tail = play('hides at its tail through the volleys', { tail: true })
  t.ok(tail.cause.lump >= 4, `its tail is no hiding place (hit by the slop ${tail.cause.lump} times)`)
  t.notes.push(...lines.map((l) => `edge player: ${l}`))
})

t.test('a clumsy player (25-tick reactions) gets hit, but not often; standing still and spraying does not work', () => {
  // Ten fights (the seed moves where the clods land), shine refilled after each hit to count them.
  const runs = []
  for (let seed = 1; seed <= 10; seed++) {
    const w = arena({ seed })
    const r = fight(w, makePilot(geometry(w), { react: 25, clumsy: true, seed }), { refill: true })
    t.ok(r.end > 0, `seed ${seed}: the clumsy player never washed it`)
    runs.push(r)
  }
  const hits = runs.map((r) => r.hits)
  const secs = runs.map((r) => r.seconds)
  const won = hits.filter((h) => h < 3).length
  const by = {}
  for (const r of runs) for (const [k, n] of Object.entries(r.by)) by[k] = (by[k] ?? 0) + n
  t.notes.push(`clumsy player, 10 fights: hits ${hits.join(' ')} (mean ${mean(hits).toFixed(2)}; ${byText(by)}), fight ${Math.min(...secs).toFixed(0)} to ${Math.max(...secs).toFixed(0)} s (mean ${mean(secs).toFixed(1)}); with 3 pips ${won} of 10 would have won, so ${(100 * (1 - (1 - won / 10) ** 3)).toFixed(0)}% win within three tries`)
  t.ok(mean(hits) <= 2.5, `clumsy mean hits ${mean(hits)}`)
  t.ok(won >= 6, 'most clumsy fights are won on three pips')
  t.ok(Math.max(...secs) <= 100, 'and none drags past 100 s')
  const s = arena()
  const st = fight(s, makePilot(geometry(s), { statue: true }), { refill: true, maxTicks: 60 * 120 })
  t.notes.push(`statue (stands in the middle spraying): ${st.hits} hits (${byText(st.by)}) in ${st.end > 0 ? `${st.seconds.toFixed(1)} s, washed` : '120 s, not washed'}`)
  t.ok(st.hits >= 6, `standing still should be punished: ${st.hits} hits`)
  const s2 = arena()
  const st2 = fight(s2, makePilot(geometry(s2), { statue: true }))
  t.ok(st2.grimed, 'standing still with three pips ends in GRIMED')
})

t.test('a player who jumps the charge on the hover also gets through untouched', () => {
  const w = arena()
  const r = fight(w, makePilot(geometry(w), { hover: true }), { refill: true })
  t.notes.push(`hover player: ${r.end > 0 ? `washed it in ${r.seconds.toFixed(1)} s` : 'never washed it'}, hits ${r.hits}`)
  t.ok(r.end > 0, 'washed')
  t.eq(r.hits, 0, 'hits')
})

t.test('the second half: angry below half dirt, five clods and the slop, puddles that slow and then dry up', () => {
  const g = good
  const angry = g.events.filter((e) => e.type === 'sfx' && e.id === 'thunder')
  t.eq(angry.length, 1, 'one tantrum')
  const w = structuredClone(snaps.get('tip angry at the right wall') ?? snaps.get('tip angry at the left wall'))
  const input = t.makeInput()
  sim.stepWorld(w, input([]))
  const marks = t.all(w, 'ms_mark')
  // Wherever he stands, the angry volley is four or five clods (as many as fit) and the slop,
  // and no two shadows on the floor overlap.
  const counts = { calm: [], angry: [] }
  for (const [key, snap] of snaps) {
    if (!key.startsWith('tip')) continue
    const g0 = geometry(snap)
    for (let x = g0.lo + 12; x <= g0.hi - 12; x += 16) {
      const s = structuredClone(snap)
      const bb = bossOf(s)
      if (x + 11 > bb.x - 2 && x - 11 < bb.x + bb.w + 2) continue
      put(s, x, g0.fy)
      sim.stepWorld(s, t.makeInput()([]))
      const n = t.all(s, 'ms_mark').length - 1
      counts[bb.vars.phase ? 'angry' : 'calm'].push(n)
      if (bb.vars.phase) t.ok(n >= 4 && n <= 5, `${key}, Maxx at ${x}: ${n} clods`)
      else t.eq(n, 3, `${key}, Maxx at ${x}: clods`)
      const floor = t.all(s, 'ms_mark').filter((m) => m.y + m.h === g0.fy).map((m) => [m.x, m.x + m.w]).sort((a, b) => a[0] - b[0])
      for (let i = 1; i < floor.length; i++) t.ok(floor[i][0] >= floor[i - 1][1], `${key}, Maxx at ${x}: shadows overlap on the floor: ${JSON.stringify(floor)}`)
    }
  }
  const five = counts.angry.filter((n) => n === 5).length
  t.notes.push(`volley size: calm always 3 clods and the slop; angry 5 clods in ${five} of ${counts.angry.length} layouts, else 4, and the slop`)
  const fy = bossOf(w).vars.fy
  const onFloor = marks.filter((m) => m.y + m.h === fy).length
  // Out of the way, so every lump lands.
  put(w, safeSpots(w, geometry(w), bossOf(w), 10)[0], fy)
  let puddles = 0
  for (let i = 0; i < 200; i++) {
    sim.stepWorld(w, input([]))
    w.events.length = 0
    puddles = Math.max(puddles, t.all(w, 'ms_puddle').length)
  }
  t.eq(puddles, onFloor, 'a puddle where each lump hit the floor (none on a catwalk)')
  t.ok(puddles >= 1, 'puddles')
  // In a puddle he runs at about half speed and still jumps as high.
  const pw = structuredClone(w)
  const pud = t.find(pw, 'ms_puddle')
  put(pw, pud.x + pud.w / 2, pud.y + pud.h)
  const inp = t.makeInput()
  let top = 0
  for (let i = 0; i < 12; i++) {
    sim.stepWorld(pw, inp(['right']))
    pw.events.length = 0
    if (pw.player.onGround && pw.player.x < pud.x + pud.w) top = Math.max(top, pw.player.vx)
  }
  t.ok(top <= 100, `speed in a puddle ${top}`)
  let life = 0
  t.until(w, [], (x) => {
    life++
    return t.all(x, 'ms_puddle').length === 0
  }, 400)
  t.ok(life <= 300, `puddles dry within 5 s (${life} ticks)`)
})

t.test('no spot on the floor is safe from a volley without moving, except under the far catwalk', () => {
  let umbrella = 0
  let spots = 0
  for (const [key, snap] of snaps) {
    if (!key.startsWith('tip')) continue
    const geo = geometry(snap)
    const b0 = bossOf(snap)
    const tail = tailOf(b0)
    for (let x = geo.lo + MAXX_W / 2; x <= geo.hi - MAXX_W / 2; x += 4) {
      if (x + MAXX_W / 2 > b0.x - 1 && x - MAXX_W / 2 < b0.x + b0.w + 1) continue
      const w = structuredClone(snap)
      put(w, x, geo.fy)
      sim.stepWorld(w, t.makeInput()([]))
      spots++
      // His middle is in danger where a lump's box would meet his: within half of each width.
      const hit = t.all(w, 'ms_mark').some((m) => m.y + m.h === geo.fy && Math.abs(m.x + m.w / 2 - x) < (m.w > 40 ? 36 : 8) + MAXX_W / 2)
      if (hit) continue
      const under = geo.cats.find((c) => x > c.x0 && x < c.x1)
      const near = Math.abs(x - tail.x) < 200
      t.ok(under && !near, `${key}: standing still at ${x} is safe${under ? ' under the catwalk by the truck' : ''}`)
      umbrella++
    }
    const w = structuredClone(snap)
    put(w, tail.x + tail.out * 30, geo.fy)
    sim.stepWorld(w, t.makeInput()([]))
    t.ok(t.all(w, 'ms_mark').some((m) => m.w > 40 && m.y + m.h === geo.fy), `${key}: the slop's wide shadow behind the tail`)
  }
  t.notes.push(`volley shadows: of ${spots} floor spots at the tell's start, ${umbrella} were safe to stand still on, all under the catwalk away from the truck (its own clod lands on the catwalk), over 200 px from the truck`)
})

t.test('spray counts a little at any time and double while it is spent', () => {
  const w = arena()
  const b = bossOf(w)
  t.until(w, ['right'], (x) => bossOf(x).state === 'intro', 300)
  const before = b.hp
  t.spray(w, b)
  const any = before - b.hp
  b.state = 'spent'
  const mid = b.hp
  t.spray(w, b)
  const spent = mid - b.hp
  t.near(spent, 2 * any, 1e-9, 'spent counts double')
  t.ok(any > 0, 'any time counts')
  const stage = (e) => (e.hp <= 0 ? 0 : Math.ceil((3 * e.hp) / e.maxHp))
  t.eq(stage(b), 3, 'stage at the start')
  const stages = new Set()
  fight(arena(), makePilot(geometry(arena())), {
    each(world, bb) {
      if (bb) stages.add(stage(bb))
    },
  })
  t.ok([3, 2, 1, 0].every((s) => stages.has(s)), `all three paint stages and clean seen (${[...stages].join(' ')})`)
})

t.test('Mighty Wax: it scrubs as fast as spraying, he cannot be hurt, and the fight song comes back after', () => {
  const w = arena()
  t.until(w, ['right'], (x) => bossOf(x).state === 'intro', 300)
  const b = bossOf(w)
  put(w, b.x - 4, b.y + b.h)
  const input = t.makeInput()
  sim.stepWorld(w, input([]))
  t.eq(w.player.pips, 2, 'without wax a touch costs one pip')
  t.eq(w.status, 'play', 'still playing')
  const w2 = arena()
  t.until(w2, ['right'], (x) => bossOf(x).state === 'intro', 300)
  const b2 = bossOf(w2)
  put(w2, b2.x + 20, b2.y + b2.h)
  w2.player.wax = 300
  const hp = b2.hp
  const sprayOne = (() => {
    const x = arena()
    t.until(x, ['right'], (y) => bossOf(y).state === 'intro', 300)
    const bx = bossOf(x)
    const h = bx.hp
    t.spray(x, bx)
    return h - bx.hp
  })()
  sim.stepWorld(w2, t.makeInput()([]))
  t.near(hp - b2.hp, sprayOne / 2, 1e-9, 'a tick of wax is half a droplet, as fast as the gun')
  t.eq(w2.player.pips, 3, 'no pip lost with wax')
  // He brings 600 ticks of wax into the fight and stands in it spraying: strong, not a win on the spot.
  const w3 = arena()
  const seen = []
  t.until(w3, ['right'], (x) => bossOf(x).state === 'intro', 300, t.makeInput(), seen)
  w3.player.wax = 600
  const b3 = bossOf(w3)
  let hits = 0
  let pips = 3
  const inp3 = t.makeInput()
  for (let i = 0; i < 605; i++) {
    const p = w3.player
    const waxed = p.wax > 1
    const into = steer(p, b3.x + b3.w / 2, 8)
    sim.stepWorld(w3, inp3(into ? stick(into) : sprayAt(p, b3)))
    seen.push(...w3.events)
    w3.events.length = 0
    if (waxed && p.pips < pips) hits++
    pips = p.pips
  }
  t.notes.push(`wax: 600 ticks of wax spent inside the truck spraying took ${(80 - b3.hp).toFixed(1)} of its 80 dirt`)
  t.ok(b3.hp > 30, `wax alone does not win the fight (dirt left ${b3.hp.toFixed(1)})`)
  t.eq(hits, 0, 'no hits while waxed')
  const last = seen.filter((e) => e.type === 'music').map((e) => e.id)
  t.eq(last[last.length - 1], 'boss', `the boss song is back once the wax is gone (${last.join(' ')})`)
})

t.test('the turbo nozzle washes it faster, as a reward should, but not in a blink', () => {
  const w = arena({ session: { turbo: true } })
  w.player.turbo = true
  const r = fight(w, makePilot(geometry(w)), { refill: false })
  t.notes.push(`turbo nozzle: the good player washed it in ${r.seconds.toFixed(1)} s, hits ${r.hits}`)
  t.ok(r.end > 0 && r.hits === 0, 'washed without a hit')
  t.ok(r.seconds >= 25, `turbo fight ${r.seconds.toFixed(1)} s`)
})

t.test('the same fight twice is the same fight, tick for tick', () => {
  const run = () => {
    const w = arena()
    const pilot = makePilot(geometry(w))
    const input = t.makeInput()
    const hashes = []
    for (let i = 0; i < 60 * 100; i++) {
      sim.stepWorld(w, input(pilot(w)))
      w.events.length = 0
      hashes.push(sim.worldHash(w))
    }
    return hashes
  }
  const a = run()
  const b = run()
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`the runs differ at tick ${i + 1}`)
})

t.test('fuzz: random stick and buttons in the arena, never a bad number, the same twice', () => {
  const ACTS = ['left', 'right', 'up', 'down', 'jump', 'spray']
  const run = (seed) => {
    let r = seed >>> 0
    const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296)
    const w = arena({ seed })
    const input = t.makeInput()
    const hashes = []
    let held = []
    for (let i = 0; i < 9000; i++) {
      if (i % 12 === 0) held = ACTS.filter(() => rnd() < 0.35)
      // Into the arena first, so the fight is on.
      sim.stepWorld(w, input(i < 120 ? ['right'] : held))
      w.events.length = 0
      for (const e of w.entities) {
        if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.hp)) throw new Error(`${e.kind} has a bad number at tick ${i}`)
      }
      if (w.status !== 'play') {
        put(w, 10 * TILE, bossOf(w)?.vars.fy ?? 320)
        w.status = 'play'
      }
      hashes.push(sim.worldHash(w))
    }
    return hashes
  }
  for (const seed of [11, 12, 13]) {
    const a = run(seed)
    const b = run(seed)
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`seed ${seed}: runs differ at tick ${i + 1}`)
  }
})

await t.finish()
