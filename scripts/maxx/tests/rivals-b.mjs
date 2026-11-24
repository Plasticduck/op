// Secret rivals 3 and 4: SLICK OLLIE and NIMBUS NICK (sim/entities/rival_ollie.ts,
// rival_nick.ts), fought in their dev arenas (levels/dev/rivals-b.ts).
//
//   node scripts/maxx/tests/rivals-b.mjs [--only <text>] [--trace] [--record <dir>]
//
//   --trace          the rival's states over each fight, and the 30 ticks before any hit
//   --record <dir>   the good players' inputs, tick by tick, as <dir>/ollie.json and nick.json:
//                    replayed in the viewer (the sim is deterministic) they make the same fight
//   RIVALS_DEBUG=a-b each player's reasoning for ticks a to b
//
// The scripted players read the rival's state the way a person reads a telegraph: a new
// state, or a new projectile, is only noticed REACT ticks after it appears (12 for the good
// player, 25 for the clumsy one). Beyond that they know what anyone who has seen the fight a
// few times knows: how long a wind-up lasts, how fast a slide goes, where a mark is. They
// plan tick by tick (wait a moment, then walk somewhere) against everything they have seen.
import fs from 'node:fs'
import path from 'node:path'
import { suite } from '../lib/testkit.mjs'

const t = await suite('rivals-b')
const { sim, levels, contract } = t
const { TILE } = contract
const { createWorld, stepWorld, worldHash } = sim
const TRACE = process.argv.includes('--trace')
const RECORD = process.argv.includes('--record') ? process.argv[process.argv.indexOf('--record') + 1] : null
const DEBUG = process.env.RIVALS_DEBUG ? process.env.RIVALS_DEBUG.split('-').map(Number) : null

const LEVEL = levels.levelById('dev-rivals-b')
if (!LEVEL) throw new Error('levels/dev/rivals-b.ts (dev-rivals-b) did not load')

const FLOOR = 10 * TILE
const AX0 = TILE
const AX1 = 19 * TILE
const CAT_Y = 7 * TILE
const CATWALKS = { ollie: [[7 * TILE, 13 * TILE]], nick: [[3 * TILE, 7 * TILE], [13 * TILE, 17 * TILE]] }
const START_X = 3 * TILE + TILE / 2
const HALF = 11
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const find = (w, kind) => w.entities.find((e) => e.kind === kind && !e.dead)
const all = (w, kind) => w.entities.filter((e) => e.kind === kind && !e.dead)
const pcx = (w) => w.player.x + w.player.w / 2
const secs = (ticks) => Math.round((ticks / 60) * 10) / 10

function arenaWorld(area, opts = {}) {
  return createWorld(LEVEL, {
    session: t.freshSession(),
    checkpoint: { areaId: area, x: opts.x ?? START_X, y: opts.y ?? FLOOR },
    flags: opts.flags,
    seed: opts.seed ?? 1,
  })
}

/** What the player has noticed: each entity's state, REACT ticks late. */
function makeEyes(react) {
  const recs = new Map()
  return {
    see(w) {
      for (const e of w.entities) {
        if (e.dead) continue
        let r = recs.get(e.id)
        if (!r) recs.set(e.id, (r = { actual: e.state, since: w.tick, known: null, at: 0 }))
        if (r.actual !== e.state) {
          r.actual = e.state
          r.since = w.tick
        }
        if (w.tick - r.since >= react && r.known !== r.actual) {
          r.known = r.actual
          r.at = w.tick
        }
      }
    },
    state: (e) => recs.get(e.id)?.known ?? null,
    seen: (e) => (recs.get(e.id)?.known ?? null) !== null,
  }
}

/** The jump button: a press held for `ticks`, never re-pressed without a release. */
function makePad() {
  let left = 0
  let cool = 0
  return {
    jump(ticks) {
      if (left <= 0 && cool <= 0) left = ticks
    },
    get busy() {
      return left > 0
    },
    out(held) {
      if (left > 0) {
        held.push('jump')
        if (--left === 0) cool = 2
      } else if (cool > 0) cool--
      return held
    },
  }
}

/** How many of a droplet's 20 ticks are inside `box`, fired from feet (fx, fy) facing f. */
function streamHits(fx, fy, f, aim, box) {
  const up = aim === 'up'
  let x = fx + f * (up ? 24 : 30)
  let y = fy + (up ? -54 : -30)
  let vx = (up ? Math.SQRT1_2 : 1) * 540 * f
  let vy = up ? -Math.SQRT1_2 * 540 : 0
  let n = 0
  for (let i = 0; i < 20; i++) {
    vy += 500 / 60
    x += vx / 60
    y += vy / 60
    if (y > FLOOR || x < AX0 || x > AX1) break
    if (x >= box.x - 3 && x <= box.x + box.w + 3 && y >= box.y - 3 && y <= box.y + box.h + 3) n++
  }
  return n
}

/** Walk toward x: a direction, or null when there (with room to brake). */
function walk(p, x, tol = 3) {
  const cx = p.x + p.w / 2
  const d = x - cx
  if (Math.abs(d) <= tol) return null
  // Coasting will get him there: let go.
  if (Math.sign(p.vx) === Math.sign(d) && (p.vx * p.vx) / 2800 > Math.abs(d)) return null
  return d > 0 ? 'right' : 'left'
}

const oily = (w, x) => sim.tileAt(w, Math.floor(x / TILE), 10) === 'O'

/** Where something lobbed by Ollie will be, tick by tick, until it lands: [x, y, w, h] boxes. */
function flightPath(g, grav) {
  const out = []
  let x = g.x
  let y = g.y
  let vy = g.vy
  const left = Math.max(1, g.vars.n - g.stateT + 1)
  for (let k = 0; k < left; k++) {
    vy += grav / 60
    x += g.vx / 60
    y += vy / 60
    if (y + g.h >= g.vars.fy || k === left - 1) {
      out.push([g.vars.tx - g.w / 2, g.vars.fy - g.h, g.w, g.h])
      break
    }
    out.push([x, y, g.w, g.h])
  }
  return out
}

/**
 * Walk from where Maxx is to x on the floor (as fast as he runs, from the speed he has, on
 * `grip`), then stand there: is he clear of every zone and every flight for `look` ticks?
 */
function walkIsSafe(p, x, zones, flying, look, margin, grip, wait = 0) {
  return firstHit(p, x, zones, flying, look, margin, grip, wait) > look
}

/**
 * The tick of the first touch on that plan (wait, then walk to x and stand), or look + 1.
 * With `jump`, he jumps at once (a full jump) and steers toward x in the air: on oil, where
 * walking is hopeless, that is the way out (his air control does not care about the floor).
 */
function firstHit(p, x, zones, flying, look, margin, grip, wait = 0, jump = false) {
  let px = p.x + p.w / 2
  let vx = p.vx
  let feet = p.onGround ? p.y + p.h : FLOOR
  const ground = feet
  let vy = jump && p.onGround ? -635 : 0
  let air = vy < 0
  for (let k = 0; k <= look; k++) {
    if (air) {
      vy = Math.min(760, vy + (vy < 0 ? 1500 : 2300) / 60)
      feet += vy / 60
      if (feet >= ground) {
        feet = ground
        air = false
        vy = 0
      }
    }
    const d = k < wait ? 0 : x - px
    const target = Math.abs(d) < 3 ? 0 : Math.sign(d) * 215
    const rate = air ? 800 : (target === 0 ? 1400 : Math.sign(vx) !== Math.sign(target) && vx !== 0 ? 2400 : 1100) * grip
    vx = vx < target ? Math.min(target, vx + rate / 60) : Math.max(target, vx - rate / 60)
    if (!air && Math.abs(d) < 3) vx = Math.abs(vx) < 30 ? 0 : vx
    px = clamp(px + vx / 60, AX0 + HALF, AX1 - HALF)
    const top = feet - 52
    // Standing threats are things on the floor: he is clear of them once his feet are above them.
    if (feet > FLOOR - 60) for (const [a, b, r] of zones) if (px > a - r && px < b + r) return k
    for (const path of flying) {
      const box = path[k]
      if (!box) continue
      if (px + HALF + margin > box[0] && px - HALF - margin < box[0] + box[2] && top - margin < box[1] + box[3] && feet > box[1]) return k
    }
  }
  return look + 1
}

const WAITS = [0, 4, 8, 12, 16, 20, 26, 32]

/**
 * The best way to be safe for `look` ticks: wait a moment and/or walk to a spot, or (with
 * `jumps`, when no walk will do) jump now and steer to a spot. Cheapest safe plan by `cost(x)`
 * plus a little for waiting; if none is safe, the one hit latest. Returns { x, wait, jump, safe }.
 */
function planDodge(p, zones, flying, look, margin, grip, cost, waits = WAITS, jumps = false) {
  let best = null
  let bc = Infinity
  let late = null
  let lateHit = -1
  for (const wait of waits) {
    for (let x = AX0 + 12; x <= AX1 - 12; x += 4) {
      const c = cost(x) + wait * 1.5
      if (c >= bc && lateHit > look) continue
      const hit = firstHit(p, x, zones, flying, look, margin, grip, wait)
      if (hit > look) {
        if (c < bc) {
          bc = c
          best = { x, wait, jump: false, safe: true }
        }
      } else if (!best && hit > lateHit) {
        lateHit = hit
        late = { x, wait, jump: false, safe: false }
      }
    }
    if (best && wait >= 8) break
  }
  if (!best && jumps && p.onGround) {
    for (let x = AX0 + 12; x <= AX1 - 12; x += 4) {
      const c = cost(x)
      if (c >= bc) continue
      const hit = firstHit(p, x, zones, flying, look, margin, grip, 0, true)
      if (hit > look) {
        bc = c
        best = { x, wait: 0, jump: true, safe: true }
      } else if (hit > lateHit) {
        lateHit = hit
        late = { x, wait: 0, jump: true, safe: false }
      }
    }
  }
  return best ?? late ?? { x: p.x + p.w / 2, wait: 0, jump: false, safe: false }
}

/* ------------------------------------------------------------------ */
/* The players for Slick Ollie                                         */
/* ------------------------------------------------------------------ */

const SLIDE_SPEED = [380, 420, 460]

/**
 * opts.react: ticks before a new state or projectile is noticed. opts.clumsy: rougher
 * margins, jumps a slide by sight instead of by its rhythm, never minds the oil.
 * opts.still: walks in, then just stands and sprays.
 */
function ollieBot({ react = 12, clumsy = false, still = false } = {}) {
  const eyes = makeEyes(react)
  const pad = makePad()
  const memo = { dodge: null, at: 0 }
  return (w) => {
    eyes.see(w)
    const p = w.player
    const cx = p.x + p.w / 2
    const held = []
    const o = find(w, 'ollie')
    if (!o || o.state === 'beaten') return held
    if (o.state === 'wait' || still) {
      if (cx < 200) held.push('right')
      else if (still) held.push('spray')
      return held
    }
    const s = eyes.state(o) ?? 'intro'
    const v = o.vars
    const ocx = o.x + o.w / 2
    const side = cx < ocx ? -1 : 1
    const up = o.y + o.h < FLOOR - 4
    const open = s === 'refill' || s === 'burp' || s === 'stagger'

    let want = ocx + side * (open ? 70 : up ? 92 : 160)
    if (Math.abs(clamp(want, AX0 + 14, AX1 - 14) - ocx) < 60 && !open) want = ocx + side * 60
    want = clamp(want, AX0 + 14, AX1 - 14)
    // Missing shine: fetch the bubble he dropped.
    const bub = find(w, 'bubble')
    if (bub && p.pips < 3) want = clamp(bub.x + bub.w / 2, AX0 + 14, AX1 - 14)
    // Up on the catwalk with him down on the floor: off the end, down to where he can be washed.
    const [cat0, cat1] = CATWALKS.ollie[0]
    if (!up && p.onGround && Math.abs(p.y + p.h - CAT_Y) < 1 && want > cat0 - 14 && want < cat1 + 14) want = want - cat0 < cat1 - want ? cat0 - 18 : cat1 + 18
    let aim = up ? 'up' : 'fwd'
    let spray = true

    // Standing threats (x from a to b, plus r), and things in flight, tick by tick.
    const zones = []
    const m = clumsy ? 3 : 10
    if (s === 'dripTell' && v.aimY >= FLOOR - 1) zones.push([v.aimX, v.aimX, 5 + HALF + m])
    if (s === 'dropTell' || s === 'drop') zones.push([v.landX, v.landX, 22 + HALF + (clumsy ? 6 : 24)])
    if (!open && !up && o.harmful) zones.push([ocx, ocx, o.w / 2 + HALF + 6])
    // Globs come out of the spout: not the place to stand while he squirts.
    if (s === 'squirtTell' || s === 'squirt' || s === 'glide') zones.push([ocx + o.facing * 30, ocx + o.facing * 30, 8 + HALF + (clumsy ? 2 : 14)])
    const flying = []
    for (const kind of ['ollie_glob', 'ollie_drip']) {
      for (const g of all(w, kind)) {
        if (!eyes.seen(g)) continue
        flying.push(flightPath(g, kind === 'ollie_glob' ? 900 : 1100))
      }
    }
    // His own body, hopping up or dropping down, is a thing in flight too.
    if (o.state === 'hopTell' || o.state === 'hop' || o.state === 'dropTell' || o.state === 'drop') {
      const hop = o.state === 'hopTell' || o.state === 'hop'
      const T = hop ? 40 : 34
      const arc = hop ? 52 : 30
      const tell = o.state === 'hopTell' ? 36 - o.stateT : o.state === 'dropTell' ? 32 - o.stateT : 0
      const sx = o.state === 'hop' || o.state === 'drop' ? v.sx : ocx
      const sy = o.state === 'hop' || o.state === 'drop' ? v.sy : o.y + o.h
      const done = o.state === 'hop' || o.state === 'drop' ? o.stateT : 0
      const path = []
      for (let k = 0; k <= 70; k++) {
        const u = Math.min(1, Math.max(0, (k - tell + done + 1) / T))
        const bx = sx + (v.landX - sx) * u
        const by = sy + (v.landY - sy) * u - 4 * arc * u * (1 - u)
        path.push([bx - o.w / 2 - 2, by - o.h - 2, o.w + 4, o.h + 4])
      }
      flying.push(path)
    }
    const grip = p.floor === 'O' ? 0.12 : 1
    const safeWalk = (x, look) => walkIsSafe(p, x, zones, flying, look, clumsy ? 0 : 2, grip)
    // Where the globs in the air will leave oil: two tiles round each landing.
    const wet = new Set()
    for (const g of all(w, 'ollie_glob')) {
      if (!eyes.seen(g)) continue
      const tx = g.vars.tx
      const first = Math.floor(tx / TILE) - (tx % TILE < TILE / 2 ? 1 : 0)
      wet.add(first).add(first + 1)
    }
    const slick = (x) => oily(w, x) || (!clumsy && (wet.has(Math.floor((x - HALF) / TILE)) || wet.has(Math.floor((x + HALF) / TILE))))

    let goal = want
    const danger = !safeWalk(cx, 60)
    if (danger || !safeWalk(want, 60)) {
      const from = danger ? cx : want
      // A person sticks to the way out they picked while it still works (on oil above all,
      // where changing your mind costs the most).
      const keep = !clumsy && memo.dodge !== null && w.tick - memo.at < 40 && (!p.onGround || safeWalk(memo.dodge, 60))
      const plan = keep
        ? { x: memo.dodge, wait: 0 }
        : clumsy
          ? planDodge(p, zones, flying, 60, 0, grip, (x) => Math.abs(x - from), [0])
          : planDodge(p, zones, flying, 60, 2, grip, (x) => Math.abs(x - from) + (x < AX0 + 40 || x > AX1 - 40 ? 30 : 0) + (slick(x) ? 60 : 0), WAITS, true)
      goal = plan.wait > 0 ? cx : plan.x
      if (plan.jump) pad.jump(34)
      if (!keep) {
        memo.dodge = plan.wait > 0 ? null : plan.x
        memo.at = w.tick
      }
      if (danger) spray = false
    } else if (!clumsy && slick(goal)) {
      for (let k = 4; k < 120; k += 4) {
        const x = goal + (goal < ocx ? -k : k)
        if (x > AX0 + 12 && x < AX1 - 12 && !slick(x) && safeWalk(x, 60)) {
          goal = x
          break
        }
      }
    }

    // A slide on its way: hold still and jump it as it arrives.
    if ((s === 'slideTell' || s === 'slide') && (o.state === 'slideTell' || o.state === 'slide')) {
      const speed = SLIDE_SPEED[v.stage] / 60
      const sliding = o.state === 'slide'
      const front = sliding ? (v.dir > 0 ? o.x + o.w : o.x) : v.dir > 0 ? o.x + 64 : o.x + o.w - 64
      const gap = v.dir > 0 ? p.x - front : front - (p.x + p.w)
      const length = sliding ? o.w : 64
      if (gap > -length - p.w) {
        goal = cx
        const contact = (sliding ? 0 : v.tell - o.stateT) + Math.max(0, gap) / speed
        const go = clumsy ? gap < 70 && sliding : contact <= 6
        if (p.onGround && go) pad.jump(clumsy ? 14 : 34)
        // Near the wall he is sliding to, the jump must carry Maxx over him to open floor.
        const toWall = v.dir > 0 ? AX1 - cx : cx - AX0
        if (!clumsy && !p.onGround && toWall < 120) goal = cx - v.dir * 140
      }
    }

    const dir = walk(p, goal)
    if (DEBUG && w.tick >= DEBUG[0] && w.tick <= DEBUG[1]) console.log(`  bot ${w.tick} s=${s} cx=${Math.round(cx)} want=${Math.round(want)} goal=${Math.round(goal)} danger=${danger} fly=${flying.map((f) => f.length + '@' + Math.round(f[f.length - 1][0])).join(',')} zones=${JSON.stringify(zones.map((z) => z.map(Math.round)))}`)
    if (dir) held.push(dir)
    else if (!pad.busy && p.onGround && Math.abs(p.vx) < 30 && p.facing !== (ocx > cx ? 1 : -1)) held.push(ocx > cx ? 'right' : 'left')
    // A player holds the spray down whenever nothing needs dodging.
    if (spray && (!dir || !danger)) held.push('spray')
    else if (spray && clumsy) held.push('spray')
    if (aim === 'up' && held.includes('spray')) held.push('up')
    return pad.out(held)
  }
}

/* ------------------------------------------------------------------ */
/* The players for Nimbus Nick                                         */
/* ------------------------------------------------------------------ */

const NICK_HIGH = [222, 192, 170, 34]
const NICK_SAG = [44, 40, 34, 0]

/** The catwalk span over x (shrunk by `inset` at each end), or null. */
function catwalkAt(x, inset = 0) {
  for (const [a, b] of CATWALKS.nick) if (x >= a + inset && x < b - inset) return [a, b]
  return null
}

/**
 * Everything of Nick's the player has noticed, as a test: is a Maxx with his feet at
 * (x, fy) hit at tick k from now? Shelter under a catwalk is judged a few pixels in from
 * its ends, to be sure.
 */
function nickHazards(w, eyes, margin) {
  const rains = []
  for (const r of all(w, 'nick_rain')) {
    if (!eyes.seen(r) || r.state === 'stop') continue
    const v = r.vars
    const start = r.state === 'tell' ? v.tell - r.stateT : 0
    const end = r.state === 'tell' ? start + v.fall : v.fall - r.stateT
    rains.push({ v, start, end, moving: r.state === 'tell' ? -start : 0 })
  }
  const bolts = []
  for (const b of all(w, 'nick_bolt')) {
    if (!eyes.seen(b) || b.state === 'scorch') continue
    const v = b.vars
    const at = b.state === 'mark' ? v.mark - b.stateT : 0
    bolts.push({ x: v.x, sy: v.sy, from: at - 1, to: at + 11 - (b.state === 'strike' ? b.stateT : 0) })
  }
  return (x, fy, k) => {
    const head = fy - 52
    for (const r of rains) {
      if (k < r.start || k > r.end + 1) continue
      if (fy > CAT_Y && catwalkAt(x, 3)) continue
      const nx = r.v.nx + (r.v.vx / 60) * Math.max(0, k + r.moving)
      if (x > Math.max(r.v.ax0, nx) + 3 - margin && x < Math.min(r.v.ax1, nx + r.v.cw) - 3 + margin) return true
    }
    for (const b of bolts) {
      if (k < b.from || k > b.to) continue
      if (head < b.sy && Math.abs(x - b.x) < 8 + HALF + margin) return true
    }
    return false
  }
}

/**
 * Tick of the first hit on a plan along the surface he stands on: wait `wait` ticks, then
 * run to x and stand. The wind, if it blows, is part of the plan. look + 1 if none.
 */
function nickFirstHit(p, x, wait, look, hit, fy, wind) {
  let px = p.x + p.w / 2
  let vx = p.vx
  for (let k = 0; k <= look; k++) {
    const d = k < wait ? 0 : x - px
    const target = Math.abs(d) < 2 ? 0 : Math.sign(d) * 215
    const rate = target === 0 ? 1400 : Math.sign(vx) !== Math.sign(target) && vx !== 0 ? 2400 : 1100
    vx = vx < target ? Math.min(target, vx + rate / 60) : Math.max(target, vx - rate / 60)
    if (Math.abs(d) < 2 && Math.abs(vx) < 30) vx = 0
    px += vx / 60 + (wind ? wind(k) : 0)
    px = clamp(px, AX0 + HALF, AX1 - HALF)
    if (hit(px, fy, k)) return k
  }
  return look + 1
}

function nickBot({ react = 12, clumsy = false, still = false } = {}) {
  const eyes = makeEyes(react)
  const pad = makePad()
  return (w) => {
    eyes.see(w)
    const p = w.player
    const cx = p.x + p.w / 2
    const fy = p.y + p.h
    const held = []
    const n = find(w, 'nick')
    if (!n || n.state === 'beaten') return held
    if (n.state === 'wait' || still) {
      if (cx < 200) held.push('right')
      else if (still) held.push('spray', 'up')
      return held
    }
    const s = eyes.state(n) ?? 'intro'
    const v = n.vars
    const stage = v.stage
    const margin = clumsy ? 0 : 3
    const look = clumsy ? 50 : 40
    const onCat = p.onGround && Math.abs(fy - CAT_Y) < 1
    const surfY = onCat ? CAT_Y : FLOOR
    const open = (s === 'pant' && n.state === 'pant') || s === 'puff'
    const pantLeft = n.state === 'pant' ? v.tell - n.stateT : 0

    // The wind, as he will feel it.
    const gust = find(w, 'nick_gust')
    const gustOn = gust && eyes.seen(gust)
    let wind = null
    if (gustOn) {
      const g = gust.vars
      const startIn = gust.state === 'tell' ? g.tell - gust.stateT : 0
      const endIn = gust.state === 'tell' ? startIn + g.blow : g.blow - gust.stateT
      wind = (k) => (k >= startIn && k <= endIn ? g.dir * g.push : 0)
    }

    // Where washing him works: his box as it will be in the pant, every spot to stand on,
    // and (while he is harmless) jumping under him.
    const box = { x: n.x, y: n.y, w: n.w, h: n.h }
    if (n.state === 'pant') box.y = v.floor - NICK_HIGH[stage] + NICK_SAG[stage] - n.h / 2
    const ncx = n.x + n.w / 2
    let best = null
    let bestScore = -Infinity
    for (let x = AX0 + 14; x <= AX1 - 14; x += 4) {
      for (const sy of clumsy ? [FLOOR] : [FLOOR, CAT_Y]) {
        if (sy === CAT_Y && !catwalkAt(x, 8)) continue
        const f = ncx >= x ? 1 : -1
        let hits = Math.max(streamHits(x, sy, f, 'up', box), streamHits(x, sy, f, 'fwd', box))
        let jumping = false
        if (hits < 4 && sy === FLOOR && open && !clumsy && pantLeft > 50) {
          const jh = Math.round(streamHits(x, sy - 110, f, 'up', box) * 0.6)
          if (jh > hits) {
            hits = jh
            jumping = true
          }
        }
        if (hits < 3) continue
        // Never where he could be touched while he is dangerous.
        if (!open && x > box.x - HALF - 4 && x < box.x + box.w + HALF + 4 && sy - 52 - 10 < box.y + box.h) continue
        const change = sy !== surfY ? 60 : 0
        const score = Math.min(hits, 10) * 12 - Math.abs(x - cx) * 0.2 - change - (jumping ? 20 : 0)
        if (score > bestScore) {
          bestScore = score
          best = { x, y: sy, jumping }
        }
      }
    }
    let goal = best ? best.x : clamp(ncx + (cx < ncx ? -100 : 100), AX0 + 14, AX1 - 14)
    let goalY = best ? best.y : FLOOR
    let jumpSpray = !!(best && best.jumping)
    // Up on the catwalks only to wash him in a pant.
    if (!open && goalY === CAT_Y) goalY = FLOOR
    // Missing shine: fetch the bubble he dropped.
    const bub = find(w, 'bubble')
    if (bub && p.pips < 3) {
      goal = clamp(bub.x + bub.w / 2, AX0 + 14, AX1 - 14)
      goalY = FLOOR
      jumpSpray = false
    }
    let spray = true

    // Dodging comes first, tick by tick along the surface he stands on.
    const hazard = nickHazards(w, eyes, margin)
    // A good player keeps a few pixels between himself and the edge of the rain where he can.
    const wide = nickHazards(w, eyes, margin + 8)
    const roomy = clumsy ? hazard : (x, fy, k) => hazard(x, fy, k) || (k >= 8 && wide(x, fy, k))
    const hits = (x, wait, h = hazard) => nickFirstHit(p, x, wait, look, h, surfY, wind)
    const span = onCat ? catwalkAt(cx) ?? catwalkAt(cx - 10) ?? catwalkAt(cx + 10) : null
    const lo = span ? span[0] + 6 : AX0 + 12
    const hi = span ? span[1] - 6 : AX1 - 12
    const inDanger = hits(cx, 0) <= look
    const marks = all(w, 'nick_bolt').filter((b) => b.state === 'mark' && eyes.seen(b)).map((b) => b.vars.x)
    // Changing level, the way there must be clear too: along the catwalk to its end, or to the spot under it.
    let via = clamp(goal, lo, hi)
    if (goalY !== surfY && onCat && span) via = goal < (span[0] + span[1]) / 2 ? span[0] - 14 : span[1] + 14
    const goalBad = hits(via, 0, roomy) <= look || (goalY !== surfY && inDanger)
    if (inDanger || goalBad) {
      let pick = null
      let pc = Infinity
      let late = null
      let lateHit = -1
      let lateCost = Infinity
      for (const hz of clumsy ? [hazard] : [roomy, hazard]) {
        for (const wait of clumsy ? [0] : [0, 6, 12, 20]) {
          for (let x = lo; x <= hi; x += 3) {
            let room = 0
            if (!clumsy) for (const mx of marks) room += 2.5 * Math.max(0, 70 - Math.abs(x - mx))
            const c = Math.abs(x - (inDanger ? cx : goal)) + wait * 2 + (x < AX0 + 36 || x > AX1 - 36 ? 20 : 0) + room
            if (c >= pc) continue
            const h = hits(x, wait, hz)
            if (h > look) {
              pc = c
              pick = { x, wait }
            } else if (!pick && (h > lateHit || (h === lateHit && c < lateCost))) {
              lateHit = h
              lateCost = c
              late = { x, wait }
            }
          }
          if (pick) break
        }
        if (pick) break
      }
      if (DEBUG && w.tick >= DEBUG[0] && w.tick <= DEBUG[1]) console.log('   plan', JSON.stringify(pick), JSON.stringify(late), [250, 270, 280, 300, 340].map((x) => x + ':' + hits(x, 0) + '/' + hits(x, 0, roomy)).join(' '))
      const plan = pick ?? late
      if (plan) {
        goal = plan.wait > 0 ? cx : plan.x
        goalY = surfY
        jumpSpray = false
        if (inDanger) spray = false
      }
      // Stuck on a catwalk with nowhere dry: off the end.
      if (!pick && onCat && span) {
        goal = cx < (span[0] + span[1]) / 2 ? span[0] - 20 : span[1] + 20
        goalY = FLOOR
      }
    }

    // The wind: lean into it near the wall it blows toward, and do not spray there.
    if (gustOn && gust.state === 'blow') {
      const g = gust.vars
      const toWall = g.dir > 0 ? AX1 - cx : cx - AX0
      // Unless walking into the wind would walk into a lightning mark.
      if (toWall < 240 && hits(cx - g.dir * 60, 0) > look) {
        goal = cx - g.dir * 60
        goalY = surfY
        spray = false
        jumpSpray = false
      }
    }

    // Changing level: walk off a catwalk's end, or jump up from under one.
    let dir = null
    if (goalY === CAT_Y && !onCat) {
      const c = catwalkAt(goal) ?? catwalkAt(goal - 8) ?? catwalkAt(goal + 8)
      const target = c ? clamp(goal, c[0] + 12, c[1] - 12) : goal
      const under = c && cx > c[0] + 10 && cx < c[1] - 10
      if (under && p.onGround && Math.abs(target - cx) < 40) {
        const apexHead = FLOOR - 52 - 134
        const inWay = cx > box.x - HALF - 6 && cx < box.x + box.w + HALF + 6 && box.y + box.h > apexHead && box.y < FLOOR - 52
        if ((!inWay || (open && pantLeft > 45)) && hits(cx, 0) > look) pad.jump(30)
      }
      dir = walk(p, target, 2)
    } else if (goalY === FLOOR && onCat) {
      const c = span ?? [cx - 1, cx + 1]
      dir = walk(p, goal < (c[0] + c[1]) / 2 ? c[0] - 20 : c[1] + 20, 1)
    } else {
      dir = walk(p, goal, 1)
    }
    if (jumpSpray && p.onGround && !dir && hits(cx, 0) > look) pad.jump(40)
    if (DEBUG && w.tick >= DEBUG[0] && w.tick <= DEBUG[1]) console.log(`  nick ${w.tick} s=${s} cx=${Math.round(cx)} fy=${Math.round(fy)} onCat=${onCat} goal=${Math.round(goal)},${goalY} best=${best ? [best.x, best.y, best.jumping].join(',') : '-'} box=${[box.x, box.y, box.w, box.h].map(Math.round)} dir=${dir} jump=${pad.busy} danger=${inDanger}`)
    if (dir) held.push(dir)
    else if (!pad.busy && p.onGround && Math.abs(p.vx) < 30 && p.facing !== (ncx > cx ? 1 : -1) && hits(cx + (ncx > cx ? 6 : -6), 0) > look) held.push(ncx > cx ? 'right' : 'left')
    const calm = !w.entities.some((x) => !x.dead && x.kind.startsWith('nick_'))
    if (spray && (!dir || clumsy || !p.onGround || calm)) {
      held.push('spray')
      const f = p.facing
      if (streamHits(cx, fy, f, 'up', n) >= streamHits(cx, fy, f, 'fwd', n) || !p.onGround) held.push('up')
    }
    return pad.out(held)
  }
}

/* ------------------------------------------------------------------ */
/* Running a fight                                                     */
/* ------------------------------------------------------------------ */

/**
 * Play the arena with a scripted player until the rival is beaten or `max` ticks pass.
 * opts.god keeps his shine topped up so every hit is counted and none ends the fight.
 */
function fight(area, kind, bot, opts = {}) {
  const w = opts.world ?? arenaWorld(area, opts)
  const input = t.makeInput()
  const max = opts.max ?? 60 * 240
  const out = { w, hits: 0, hitAt: [], began: -1, ended: -1, events: [], states: [], grimed: false, bossTicks: 0, versus: 0 }
  let last = ''
  const film = []
  for (let i = 0; i < max; i++) {
    if (opts.god) w.player.pips = 3
    const before = w.player.pips
    const held = bot(w)
    if (opts.record) opts.record.push(held.join(' '))
    if (opts.record) (out.trail ??= []).push(Math.round(w.player.x * 100) / 100)
    if (TRACE) {
      const p = w.player
      film.push(`${w.tick} P(${Math.round(pcx(w))},${Math.round(p.y + p.h)} vx${Math.round(p.vx)} ${p.onGround ? 'g' : 'a'}) [${held.join(' ')}] ` + w.entities.filter((e) => !e.dead && e.kind.startsWith(kind)).map((e) => `${e.kind}:${e.state}(${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.w)}x${Math.round(e.h)}${e.harmful ? ' H' : ''}${e.vars.tx !== undefined && e.kind !== kind ? ' tx' + Math.round(e.vars.tx) : ''})`).join(' '))
      if (film.length > 40) film.shift()
    }
    stepWorld(w, input(held))
    const e = find(w, kind) ?? w.entities.find((x) => x.kind === kind)
    for (const ev of w.events) {
      if (opts.keep) out.events.push({ tick: w.tick, ...ev })
      if (ev.type === 'versus') out.versus++
    }
    w.events.length = 0
    if (w.player.pips < before || w.status === 'grimed') {
      out.hits++
      out.hitAt.push(`${w.tick}:${e ? e.state : '?'}@${Math.round(pcx(w))}`)
      if (TRACE && out.hits <= 3) console.log(`--- hit at ${w.tick}\n${film.slice(-30).join('\n')}`)
    }
    if (w.status === 'grimed') {
      out.grimed = true
      break
    }
    if (opts.each) opts.each(w, e)
    if (opts.hashes && w.tick % 30 === 0) opts.hashes.push(worldHash(w))
    if (!e) break
    if (e.state !== last) {
      if (TRACE || opts.record) out.states.push(`${w.tick} ${e.state} hp${e.hp} st${e.vars.stage}`)
      last = e.state
    }
    if (out.began < 0 && e.state === 'intro') out.began = w.tick
    if (w.boss) out.bossTicks++
    if (e.state === 'beaten') {
      out.ended = w.tick
      for (let k = 0; k < 120; k++) {
        stepWorld(w, input([]))
        if (opts.each) opts.each(w, e)
        for (const ev of w.events) if (opts.keep) out.events.push({ tick: w.tick, ...ev })
        w.events.length = 0
      }
      break
    }
  }
  out.rival = find(w, kind) ?? null
  out.length = out.ended > 0 ? out.ended - out.began : -1
  if (opts.record && RECORD) {
    fs.mkdirSync(RECORD, { recursive: true })
    fs.writeFileSync(path.join(RECORD, area + '.json'), JSON.stringify({ area, inputs: opts.record, states: out.states, trail: out.trail }))
  }
  if (TRACE) console.log(`[${area}] ${out.states.join(' | ')}\n  hits: ${out.hitAt.join(', ')}`)
  return out
}

/* ------------------------------------------------------------------ */
/* Helpers for the tests                                               */
/* ------------------------------------------------------------------ */

const floorRow = (w) => {
  let oil = 0
  for (let tx = 1; tx < 19; tx++) if (sim.tileAt(w, tx, 10) === 'O') oil++
  return oil
}

/** A player that just walks in and then stands, spraying (up, for Nick). */
const stillBot = (kind) => (kind === 'ollie' ? ollieBot({ still: true }) : nickBot({ still: true }))

/** Pure random input, from a seed (a fuzzer, not a player). */
function noise(seed) {
  let s = seed >>> 0
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  let held = []
  let left = 0
  return () => {
    if (left-- <= 0) {
      left = 2 + Math.floor(r() * 30)
      held = ['left', 'right', 'up', 'down', 'jump', 'spray'].filter(() => r() < 0.35)
    }
    return held
  }
}

function badNumbers(w) {
  for (const e of w.entities) for (const k of ['x', 'y', 'w', 'h', 'vx', 'vy', 'hp']) if (!Number.isFinite(e[k])) return `${e.kind}.${k} = ${e[k]}`
  for (const e of w.entities) for (const [k, v] of Object.entries(e.vars)) if (!Number.isFinite(v)) return `${e.kind}.vars.${k} = ${v}`
  const p = w.player
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'player position'
  return null
}

/* ------------------------------------------------------------------ */
/* Slick Ollie                                                         */
/* ------------------------------------------------------------------ */

t.test('ollie: a good player (12 tick reactions) beats him without taking a hit', () => {
  let maxOil = 0
  const r = fight('ollie', 'ollie', ollieBot(), { god: true, record: [], each: (w) => (maxOil = Math.max(maxOil, floorRow(w))) })
  t.ok(r.ended > 0, `not beaten in 4 minutes (hp ${r.rival ? r.rival.hp : '?'}, state ${r.rival ? r.rival.state : '?'})`)
  t.eq(r.hits, 0, `hits taken (${r.hitAt.join(', ')})`)
  const s = secs(r.length)
  t.ok(s >= 75 && s <= 100, `the fight took ${s} s (wanted 75 to 100)`)
  t.ok(maxOil <= 8, `at most 8 of the 18 floor tiles are ever oily (saw ${maxOil})`)
  t.eq(floorRow(r.w), 0, 'two seconds after he is beaten the floor is dry')
  t.notes.push(`ollie: good player wins in ${s} s with no hits; at most ${maxOil} of 18 floor tiles oily at once`)
})

t.test('ollie: the good player also wins clean starting from the other end of the arena', () => {
  const r = fight('ollie', 'ollie', ollieBot(), { god: true, x: 17 * TILE + 16 })
  t.ok(r.ended > 0, 'not beaten')
  t.eq(r.hits, 0, `hits taken (${r.hitAt.join(', ')})`)
  t.notes.push(`ollie: from column 17, ${secs(r.length)} s, no hits`)
})

const OLLIE_ATTACK = { squirt: 1, slide: 2, hop: 3 }
const OLLIE_IDLE = [40, 34, 28]

/** A world at the tick an Ollie attack's telegraph starts: Ollie at stage `stage`, middle at ox; Maxx's feet at (px, py). */
function ollieMoment(stage, attack, ox, px, py) {
  const w = arenaWorld('ollie', { x: px, y: py })
  const o = find(w, 'ollie')
  o.vars.stage = stage
  o.hp = Math.round(o.maxHp * [1, 0.66, 0.33][stage])
  o.x = ox - o.w / 2
  o.state = 'idle'
  o.stateT = OLLIE_IDLE[stage] - 1
  o.vars.force = OLLIE_ATTACK[attack]
  return w
}

const NICK_ATTACK = { rain: 1, bolt: 2, gust: 3 }
const NICK_IDLE = [44, 36, 30]

function nickMoment(stage, attack, nx, px, py, seed = 1) {
  const w = arenaWorld('nick', { x: px, y: py, seed })
  const n = find(w, 'nick')
  n.vars.stage = stage
  n.hp = Math.round(n.maxHp * [0.99, 0.71, 0.44][stage])
  n.vars.cx = nx
  n.vars.cy = n.vars.floor - NICK_HIGH[stage]
  n.state = 'float'
  n.stateT = NICK_IDLE[stage] - 1
  n.vars.force = NICK_ATTACK[attack]
  return w
}

/**
 * From the moment a telegraph starts, does `bot` (or, failing it, one of a set of simple
 * escapes that start 12 ticks late) get through the whole attack without a touch?
 * Returns 'bot', 'escape' or null. The attack is over once the rival is back to `rest` and
 * nothing it threw is left.
 */
function survives(make, kind, rest, bot) {
  const run = (player) => {
    const w = make()
    const input = t.makeInput()
    let left = false
    for (let i = 0; i < 1100; i++) {
      w.player.pips = 3
      stepWorld(w, input(player(w, i)))
      w.events.length = 0
      if (w.player.pips < 3) return false
      const e = find(w, kind)
      if (e.state !== rest) left = true
      const busy = w.entities.some((x) => !x.dead && x.kind.startsWith(kind + '_') && x.kind !== 'ollie_puddle')
      if (left && e.state === rest && !busy) return true
    }
    return false
  }
  const b = bot()
  if (run((w) => b(w))) return 'bot'
  for (const dir of [-1, 1, 0]) {
    for (const go of [12, 24, 40, 70, 999]) {
      for (const jumpAt of [-1, 12, 18, 26, 34, 44]) {
        const ok = run((w, i) => {
          const held = []
          if (i >= 12 && i < 12 + go && dir) held.push(dir > 0 ? 'right' : 'left')
          if (jumpAt >= 0 && i >= jumpAt && i < jumpAt + 30) held.push('jump')
          return held
        })
        if (ok) return 'escape'
      }
    }
  }
  return null
}

function spots(catwalks) {
  const out = []
  for (let x = AX0 + 14; x <= AX1 - 14; x += 36) out.push([x, FLOOR])
  for (const [a, b] of catwalks) for (let x = a + 12; x <= b - 12; x += 36) out.push([x, CAT_Y])
  return out
}

t.test('ollie: every attack can be dodged from every spot in the arena, at every stage, wherever he stands (12 tick reactions)', () => {
  let tried = 0
  let byBot = 0
  const failed = []
  for (let stage = 0; stage < 3; stage++) {
    for (const attack of Object.keys(OLLIE_ATTACK)) {
      for (const ox of [100, 320, 540]) {
        for (const [px, py] of spots(CATWALKS.ollie)) {
          // Not standing in him (that is already a hit).
          if (py === FLOOR && Math.abs(px - ox) < 22 + HALF + 2) continue
          tried++
          const how = survives(() => ollieMoment(stage, attack, ox, px, py), 'ollie', 'idle', () => ollieBot())
          if (how === 'bot') byBot++
          else if (!how) failed.push(`${attack} stage ${stage}, Ollie at ${ox}, Maxx at ${px},${py}`)
        }
      }
    }
  }
  t.eq(failed.length, 0, `no way through: ${failed.slice(0, 8).join('; ')}`)
  t.notes.push(`ollie: dodge search: ${tried} telegraph moments (3 attacks x 3 stages x 3 places he stands x every 36 px of floor and catwalk); the scripted player got through ${byBot}, a simple late escape the other ${tried - byBot}`)
})

t.test('ollie: tells are long enough to read (slide wind-up 40+ ticks, glob flight 50+, drip 26 + fall, hop and drop shadows 32+)', () => {
  const w = ollieMoment(2, 'slide', 540, 112, FLOOR)
  const o = find(w, 'ollie')
  const seen = {}
  const input = t.makeInput()
  for (let i = 0; i < 300; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    seen[o.state] = (seen[o.state] ?? 0) + 1
    if (o.state === 'slide') break
  }
  t.ok(seen.slideTell >= 40, `slide wind-up ${seen.slideTell} ticks`)
  // Globs: flight 50 at the fastest stage.
  const w2 = ollieMoment(2, 'squirt', 540, 112, FLOOR)
  t.until(w2, [], (x) => all(x, 'ollie_glob').length > 0, 200)
  t.ok(all(w2, 'ollie_glob')[0].vars.n >= 50, 'a glob flies 50 ticks or more')
})

t.test('ollie: beaten, he sets the flag to 3, plays rivalDown, frees the camera and the bar, and the door opens; a retry finds him gone', () => {
  let locked = null
  let barMissing = 0
  const r = fight('ollie', 'ollie', ollieBot(), {
    god: true,
    keep: true,
    each: (w, e) => {
      if (e && e.state !== 'wait' && e.state !== 'beaten') {
        if (!w.boss || w.boss.name !== 'SLICK OLLIE' || Math.abs(w.boss.hp - e.hp) > 6) barMissing++
        if (!locked && w.camBounds) locked = { ...w.camBounds }
      }
    },
  })
  t.ok(r.ended > 0, 'not beaten')
  const vs = r.events.filter((ev) => ev.type === 'versus')
  t.eq(vs.length, 1, 'one versus card')
  t.eq(vs[0].name, 'SLICK OLLIE', 'versus name')
  t.ok(/SMOOTH OPERATOR/.test(vs[0].tagline), `tagline ${vs[0].tagline}`)
  t.eq(barMissing, 0, 'the bar is set every tick of the fight')
  t.ok(locked && locked.x0 === 0 && locked.x1 === 640, `camera locked to the arena (${JSON.stringify(locked)})`)
  t.eq(r.w.flags.rivalsBeaten, 3, 'rivalsBeaten')
  t.ok(r.events.some((ev) => ev.type === 'jingle' && ev.id === 'rivalDown'), 'jingle rivalDown')
  t.eq(r.w.boss, null, 'bar cleared')
  t.eq(r.w.camBounds, null, 'camera free')
  const door = find(r.w, 'door')
  t.ok(door && door.state !== 'locked', `the way on opens (door ${door && door.state})`)
  // A retry with the flag set: he is gone. One below it: he is there.
  for (const [flag, there] of [[3, false], [4, false], [2, true]]) {
    const w = arenaWorld('ollie', { flags: { rivalsBeaten: flag } })
    t.steps(w, [], 2)
    t.eq(!!find(w, 'ollie'), there, `with rivalsBeaten ${flag}`)
  }
})

/* ------------------------------------------------------------------ */
/* Nimbus Nick                                                         */
/* ------------------------------------------------------------------ */

t.test('nick: a good player (12 tick reactions) beats him without taking a hit', () => {
  const r = fight('nick', 'nick', nickBot(), { god: true, record: [] })
  t.ok(r.ended > 0, `not beaten in 4 minutes (hp ${r.rival ? r.rival.hp : '?'}, state ${r.rival ? r.rival.state : '?'})`)
  t.eq(r.hits, 0, `hits taken (${r.hitAt.join(', ')})`)
  const s = secs(r.length)
  t.ok(s >= 75 && s <= 100, `the fight took ${s} s (wanted 75 to 100)`)
  t.notes.push(`nick: good player wins in ${s} s with no hits`)
})

t.test('nick: the good player also wins clean with other seeds (the rain sweeps other ways)', () => {
  const lengths = []
  for (const seed of [2, 3]) {
    const r = fight('nick', 'nick', nickBot(), { god: true, seed })
    t.ok(r.ended > 0, `seed ${seed}: not beaten`)
    t.eq(r.hits, 0, `seed ${seed}: hits taken (${r.hitAt.join(', ')})`)
    lengths.push(secs(r.length))
  }
  t.notes.push(`nick: seeds 2 and 3: ${lengths.join(' s, ')} s, no hits`)
})

/** A slow player's fights: shine topped up (to count every hit), and with the real three pips and mercy bubbles. */
function slowFights(kind, runs) {
  const out = { hits: [], wins: 0, secs: [], lost: [] }
  for (const opts of runs) {
    const bot = () => (kind === 'ollie' ? ollieBot({ react: 25, clumsy: true }) : nickBot({ react: 25, clumsy: true }))
    const god = fight(kind, kind, bot(), { god: true, ...opts })
    const real = fight(kind, kind, bot(), opts)
    out.hits.push(god.hits)
    out.secs.push(secs(god.length))
    if (real.ended > 0) out.wins++
    else out.lost.push(`stage ${real.rival.vars.stage}, ${Math.round((100 * real.rival.hp) / real.rival.maxHp)}% left`)
  }
  return out
}
const mean = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10
const SLOW = {}

t.test('ollie: standing still and spraying gets you hurt; a slow, clumsy player (25 tick reactions) still wins', () => {
  const still = fight('ollie', 'ollie', stillBot('ollie'), { god: true, max: 60 * 60 })
  t.ok(still.hits >= 3, `standing still for a minute should cost shine (hits ${still.hits})`)
  // Ollie draws no random numbers: the runs differ by where Maxx comes in.
  const slow = (SLOW.ollie = slowFights('ollie', [{ x: START_X }, { x: 10 * TILE }, { x: 17 * TILE + 16 }, { x: 6 * TILE }]))
  t.ok(slow.wins >= 3, `the slow player should usually win with real shine (won ${slow.wins} of 4: ${slow.lost.join('; ')})`)
  t.notes.push(`ollie: standing still and spraying: ${still.hits} hits in 60 s; slow clumsy player (25 tick reactions, rough dodging), 4 starts: ${slow.hits.join(', ')} hits (mean ${mean(slow.hits)}) over ${slow.secs.join(', ')} s; with real shine he won ${slow.wins} of 4`)
})

t.test('nick: standing still and spraying up gets you hurt; a slow, clumsy player (25 tick reactions) can win, and takes more hits than against Ollie', () => {
  const still = fight('nick', 'nick', stillBot('nick'), { god: true, max: 60 * 60 })
  t.ok(still.hits >= 3, `standing still for a minute should cost shine (hits ${still.hits})`)
  const slow = (SLOW.nick = slowFights('nick', [1, 2, 3, 4, 5, 6].map((seed) => ({ seed }))))
  t.ok(slow.wins >= 2, `the slow player should be able to win with real shine (won ${slow.wins} of 6: ${slow.lost.join('; ')})`)
  if (SLOW.ollie) t.ok(mean(slow.hits) > mean(SLOW.ollie.hits), `Nick should cost a slow player more hits than Ollie (${mean(slow.hits)} against ${mean(SLOW.ollie.hits)})`)
  t.notes.push(`nick: standing still and spraying up: ${still.hits} hits in 60 s; slow clumsy player (25 tick reactions, floor only), seeds 1 to 6: ${slow.hits.join(', ')} hits (mean ${mean(slow.hits)}) over ${slow.secs.join(', ')} s; with real shine he won ${slow.wins} of 6${slow.lost.length ? ' (grimed: ' + slow.lost.join('; ') + ')' : ''}`)
})

t.test('nick: every attack can be dodged from every spot in the arena, at every stage, wherever he floats (12 tick reactions)', () => {
  let tried = 0
  let byBot = 0
  const failed = []
  for (let stage = 0; stage < 3; stage++) {
    for (const attack of Object.keys(NICK_ATTACK)) {
      for (const nx of [100, 320, 540]) {
        for (const seed of attack === 'rain' ? [1, 2] : [1]) {
          for (const [px, py] of spots(CATWALKS.nick)) {
            tried++
            const how = survives(() => nickMoment(stage, attack, nx, px, py, seed), 'nick', 'float', () => nickBot())
            if (how === 'bot') byBot++
            else if (!how) failed.push(`${attack} stage ${stage} seed ${seed}, Nick at ${nx}, Maxx at ${px},${py}`)
          }
        }
      }
    }
  }
  t.eq(failed.length, 0, `no way through: ${failed.slice(0, 8).join('; ')}`)
  t.notes.push(`nick: dodge search: ${tried} telegraph moments (3 attacks x 3 stages x 3 places he floats, rain with two seeds, x every 36 px of floor and catwalk); the scripted player got through ${byBot}, a simple late escape the other ${tried - byBot}`)
})

t.test('nick: the rain always leaves room: at every tick of every wave a gap of 2 tiles or more is dry', () => {
  let narrowest = Infinity
  for (let stage = 0; stage < 3; stage++) {
    for (const seed of [1, 2, 3, 4]) {
      const w = nickMoment(stage, 'rain', 320, 112, FLOOR, seed)
      const input = t.makeInput()
      for (let i = 0; i < 700; i++) {
        w.player.pips = 3
        w.player.invuln = 99
        stepWorld(w, input([]))
        w.events.length = 0
        const falling = all(w, 'nick_rain').filter((r) => r.state === 'fall')
        if (!falling.length) continue
        // The widest dry stretch of floor.
        let best = 0
        let run = 0
        for (let x = AX0; x < AX1; x++) {
          const wet = falling.some((r) => x >= r.x + 3 && x <= r.x + r.w - 3)
          run = wet ? 0 : run + 1
          best = Math.max(best, run)
        }
        narrowest = Math.min(narrowest, best)
      }
    }
  }
  t.ok(narrowest >= 64, `the widest dry gap was once only ${narrowest} px`)
  t.notes.push(`nick: the widest dry stretch under the rain is never under ${narrowest} px`)
})

t.test('nick: lightning marks its spot for most of a second, gusts show their streaks first, rain shows faintly first', () => {
  const w = nickMoment(2, 'bolt', 320, 112, FLOOR)
  const input = t.makeInput()
  const sink = []
  let markAt = -1
  let strikeAt = -1
  for (let i = 0; i < 300 && strikeAt < 0; i++) {
    w.player.invuln = 99
    stepWorld(w, input([]))
    for (const ev of w.events) sink.push(ev)
    w.events.length = 0
    const b = all(w, 'nick_bolt')[0]
    if (b && markAt < 0) markAt = w.tick
    if (b && b.state === 'strike' && strikeAt < 0) strikeAt = w.tick
  }
  t.ok(strikeAt - markAt >= 42, `the mark shows ${strikeAt - markAt} ticks before the strike`)
  t.ok(sink.some((ev) => ev.type === 'sfx' && ev.id === 'thunder'), 'thunder')
  const g = nickMoment(2, 'gust', 320, 112, FLOOR)
  t.until(g, [], (x) => all(x, 'nick_gust').some((e) => e.state === 'blow'), 200)
  t.ok(g.tick >= 46, `the gust blows ${g.tick} ticks after its tell starts`)
  const r = nickMoment(2, 'rain', 320, 112, FLOOR)
  t.until(r, [], (x) => all(x, 'nick_rain').some((e) => e.state === 'fall'), 200)
  t.ok(r.tick >= 46, `the rain falls ${r.tick} ticks after it shows`)
})

t.test('nick: beaten, he sets the flag to 4, plays champion (not rivalDown), frees the camera and the bar; a retry finds him gone', () => {
  let barMissing = 0
  let locked = null
  const stages = new Set()
  const r = fight('nick', 'nick', nickBot(), {
    god: true,
    keep: true,
    each: (w, e) => {
      if (e && e.state !== 'wait' && e.state !== 'beaten') {
        stages.add(e.vars.stage)
        if (!w.boss || w.boss.name !== 'NIMBUS NICK' || Math.abs(w.boss.hp - e.hp) > 6) barMissing++
        if (!locked && w.camBounds) locked = { ...w.camBounds }
      }
    },
  })
  t.ok(r.ended > 0, 'not beaten')
  const vs = r.events.filter((ev) => ev.type === 'versus')
  t.eq(vs.length, 1, 'one versus card')
  t.eq(vs[0].name, 'NIMBUS NICK', 'versus name')
  t.ok(/WAIT FOR RAIN/.test(vs[0].tagline), `tagline ${vs[0].tagline}`)
  t.eq(barMissing, 0, 'the bar is set every tick of the fight')
  t.ok(locked && locked.x0 === 0 && locked.x1 === 640, `camera locked (${JSON.stringify(locked)})`)
  t.eq([...stages].sort().join(','), '0,1,2,3', 'he went through all three stages and the puff')
  t.eq(r.w.flags.rivalsBeaten, 4, 'rivalsBeaten')
  t.ok(r.events.some((ev) => ev.type === 'jingle' && ev.id === 'champion'), 'jingle champion')
  t.ok(!r.events.some((ev) => ev.type === 'jingle' && ev.id === 'rivalDown'), 'not rivalDown')
  t.eq(r.w.boss, null, 'bar cleared')
  t.eq(r.w.camBounds, null, 'camera free')
  t.eq(all(r.w, 'nick_rain').length + all(r.w, 'nick_bolt').length + all(r.w, 'nick_gust').length, 0, 'his weather goes with him')
  for (const [flag, there] of [[4, false], [3, true]]) {
    const w = arenaWorld('nick', { flags: { rivalsBeaten: flag } })
    t.steps(w, [], 2)
    t.eq(!!find(w, 'nick'), there, `with rivalsBeaten ${flag}`)
  }
})

/* ------------------------------------------------------------------ */
/* Both                                                                */
/* ------------------------------------------------------------------ */

t.test('both: a fight played twice is the same fight, tick for tick', () => {
  for (const [area, bot] of [['ollie', ollieBot], ['nick', nickBot]]) {
    const a = []
    const b = []
    fight(area, area, bot(), { god: true, hashes: a, max: 60 * 40 })
    fight(area, area, bot(), { god: true, hashes: b, max: 60 * 40 })
    t.ok(a.length > 50, `${area}: hashes taken`)
    t.eq(a.join(','), b.join(','), `${area}: the two runs differ`)
  }
})

t.test('both: random input for two minutes in each arena, at every stage: nothing breaks, the floor always has dry ground, and it repeats exactly', () => {
  for (const area of ['ollie', 'nick']) {
    const runOnce = () => {
      const w = arenaWorld(area, { seed: 7 })
      const input = t.makeInput()
      const r = noise(area === 'ollie' ? 11 : 13)
      let oil = 0
      for (let i = 0; i < 60 * 120; i++) {
        w.player.pips = 3
        const e = find(w, area)
        // Every 40 seconds, the next stage.
        if (e && i % 2400 === 2399 && e.vars.stage < 2) {
          e.hp = Math.min(e.hp, Math.round(e.maxHp * [0.66, 0.33][e.vars.stage]) + 2)
        }
        stepWorld(w, input(r()))
        w.events.length = 0
        const bad = badNumbers(w)
        if (bad) throw new Error(`${area} tick ${w.tick}: ${bad}`)
        oil = Math.max(oil, floorRow(w))
        if (w.status !== 'play') throw new Error(`${area}: status ${w.status} at ${w.tick}`)
      }
      return { hash: worldHash(w), oil }
    }
    const a = runOnce()
    const b = runOnce()
    t.eq(a.hash, b.hash, `${area}: repeat`)
    t.ok(a.oil <= 8, `${area}: oily tiles ${a.oil}`)
  }
})

/* ------------------------------------------------------------------ */
/* The oil, edge by edge                                               */
/* ------------------------------------------------------------------ */

/** Drop a glob straight down onto the floor at x (as Ollie's do, it lands exactly there). */
function dropGlob(w, x) {
  const g = sim.spawn(w, 'ollie_glob', x, FLOOR - 60)
  Object.assign(g.vars, { tx: x, fy: FLOOR, n: 20, ax0: AX0, ax1: AX1 })
  g.vx = 0
  g.vy = 0
  return g
}

const row = (w, ty = 10) => Array.from({ length: 20 }, (_, tx) => sim.tileAt(w, tx, ty)).join('')

t.test('ollie: a slick turns two floor tiles oily for 6 seconds, then puts back exactly what was there', () => {
  // Ollie himself is not there (beaten before), so nothing else spills.
  const w = arenaWorld('ollie', { x: 17 * TILE, flags: { rivalsBeaten: 3 } })
  const before = Uint8Array.from(w.grid.t)
  dropGlob(w, 200)
  const input = t.makeInput()
  let oiledAt = -1
  let dryAt = -1
  for (let i = 0; i < 500; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    const oily = row(w).split('').filter((c) => c === 'O').length
    if (oily > 0 && oiledAt < 0) {
      oiledAt = w.tick
      t.eq(row(w), '#####OO#############', 'the two tiles round the landing')
    }
    if (oiledAt > 0 && oily === 0 && dryAt < 0) dryAt = w.tick
  }
  t.ok(oiledAt > 0, 'it spilled')
  t.eq(dryAt - oiledAt, 360, 'ticks the slick lasts')
  t.ok(before.every((c, i) => w.grid.t[i] === c), 'the whole grid is as it was')
})

t.test('ollie: the floor is never all oil, and after the fight (or a grime and a retry) it is exactly as built', () => {
  let worstDry = Infinity
  const r = fight('ollie', 'ollie', ollieBot({ react: 25, clumsy: true }), {
    god: true,
    each: (w) => {
      // The longest run of dry floor, in tiles.
      let run = 0
      let best = 0
      for (let tx = 1; tx < 19; tx++) {
        run = sim.tileAt(w, tx, 10) === 'O' ? 0 : run + 1
        best = Math.max(best, run)
      }
      worstDry = Math.min(worstDry, best)
    },
  })
  t.ok(worstDry >= 4, `there is always a dry stretch of 4 tiles or more (worst ${worstDry})`)
  const g0 = arenaWorld('ollie').grid.t
  t.ok(g0.every((c, i) => r.w.grid.t[i] === c), 'after the fall and two seconds the grid is as it was built')
  // A grime with oil down, then the retry the play scene makes: a new world with the flags.
  const w = arenaWorld('ollie')
  const input = t.makeInput()
  const still = stillBot('ollie')
  let oilSeen = false
  for (let i = 0; i < 60 * 90 && w.status === 'play'; i++) {
    stepWorld(w, input(still(w)))
    w.events.length = 0
    if (floorRow(w) > 0) oilSeen = true
  }
  t.eq(w.status, 'grimed', 'standing still, he is grimed in the end')
  t.ok(oilSeen, 'oil was down during it')
  const retry = createWorld(LEVEL, { session: t.freshSession(), checkpoint: w.checkpoint ?? { areaId: 'ollie', x: START_X, y: FLOOR }, flags: w.flags })
  t.eq(row(retry), '####################', 'the retry floor')
  t.eq(find(retry, 'ollie').state, 'wait', 'and Ollie is back, waiting')
})

t.test('ollie: Maxx on a tile as it turns oily slides, but can always jump off it or walk off it', () => {
  // A glob lands just beside him: its slick takes the tile he stands on.
  const w = arenaWorld('ollie', { x: 181 })
  dropGlob(w, 204)
  t.until(w, [], (x) => x.player.floor === 'O', 120)
  t.eq(w.player.floor, 'O', 'he is standing on oil')
  const x0 = pcx(w)
  t.until(w, ['left'], () => false, 40)
  t.ok(Math.abs(pcx(w) - x0) >= 8, `walking, he still gets somewhere (${Math.round(Math.abs(pcx(w) - x0))} px in 40 ticks)`)
  const w2 = arenaWorld('ollie', { x: 181 })
  dropGlob(w2, 204)
  t.until(w2, [], (x) => x.player.floor === 'O', 120)
  t.steps(w2, ['jump', 'left'], 30)
  t.ok(w2.player.y + w2.player.h < FLOOR - 60, 'a jump from the oil is a full jump')
  t.until(w2, ['left'], (x) => x.player.onGround, 120)
  t.ok(x0 - pcx(w2) > 60, `and he steers out over the oil (${Math.round(x0 - pcx(w2))} px)`)
})

/* ------------------------------------------------------------------ */
/* Lightning with the rain and the wind                                */
/* ------------------------------------------------------------------ */

/** The widest stretch of floor (Maxx's middle) where nothing of Nick's hurts now: no falling rain over him (or a catwalk over him), no strike. */
function safeRun(w) {
  const rains = all(w, 'nick_rain').filter((r) => r.state === 'fall' && r.w >= 8)
  const strikes = all(w, 'nick_bolt').filter((b) => b.state === 'strike')
  let best = 0
  let run = 0
  for (let x = AX0 + 11; x <= AX1 - 11; x++) {
    const sheltered = CATWALKS.nick.some(([a, b]) => x >= a && x < b)
    const wet = !sheltered && rains.some((r) => x >= r.x + 3 && x <= r.x + r.w - 3)
    const struck = strikes.some((b) => Math.abs(x - b.vars.x) < 19)
    run = wet || struck ? 0 : run + 1
    best = Math.max(best, run)
  }
  return best
}

t.test('nick: lightning in the rain or in the wind always leaves dry ground beside it', () => {
  let combos = 0
  let worst = Infinity
  const check = (w) => {
    if (!all(w, 'nick_bolt').some((b) => b.state === 'strike')) return
    if (!all(w, 'nick_rain').some((r) => r.state === 'fall')) return
    combos++
    worst = Math.min(worst, safeRun(w))
  }
  for (const seed of [1, 2, 3, 4, 5]) fight('nick', 'nick', nickBot(), { god: true, seed, each: check })
  for (const seed of [1, 2, 3]) fight('nick', 'nick', nickBot({ react: 25, clumsy: true }), { god: true, seed, each: check })
  t.ok(combos > 20, `strikes while rain falls were seen (${combos} ticks)`)
  t.ok(worst >= 36, `with a strike and rain at once, the widest safe stretch of floor was once only ${worst} px`)
  t.notes.push(`nick: ${combos} ticks of lightning striking while rain fell (rain waves and gust curtains, 8 fights); the widest safe stretch of floor then was never under ${worst} px`)
})

/* ------------------------------------------------------------------ */
/* Hurt in the middle of a tell, wax, turbo                            */
/* ------------------------------------------------------------------ */

t.test('both: knocked back by a hit just as a telegraph starts, Maxx still gets through the rest of that attack', () => {
  const failed = []
  let tried = 0
  for (const [kind, moment, attacks, catwalks] of [
    ['ollie', ollieMoment, Object.keys(OLLIE_ATTACK), CATWALKS.ollie],
    ['nick', nickMoment, Object.keys(NICK_ATTACK), CATWALKS.nick],
  ]) {
    for (let stage = 0; stage < 3; stage++) {
      for (const attack of attacks) {
        for (const at of [100, 540]) {
          for (const [px, py] of spots(catwalks).filter((_, i) => i % 2 === 0)) {
            if (kind === 'ollie' && py === FLOOR && Math.abs(px - at) < 22 + HALF + 2) continue
            tried++
            const make = () => {
              const w = moment(stage, attack, at, px, py)
              sim.hurtPlayer(w, { fromX: px + 10, force: true })
              return w
            }
            const bot = kind === 'ollie' ? ollieBot : nickBot
            if (!survives(make, kind, kind === 'ollie' ? 'idle' : 'float', () => bot())) failed.push(`${kind} ${attack} stage ${stage}, rival at ${at}, Maxx at ${px},${py}`)
          }
        }
      }
    }
  }
  t.eq(failed.length, 0, `hit again: ${failed.slice(0, 6).join('; ')}`)
  t.notes.push(`both: ${tried} telegraph moments with Maxx knocked back at its start (24 ticks without control, then 66 more of blinking): all got through the rest of the attack`)
})

t.test('both: under Mighty Wax nothing of theirs costs shine; with the turbo nozzle the fight is quicker and still clean', () => {
  for (const kind of ['ollie', 'nick']) {
    const w = arenaWorld(kind)
    const still = stillBot(kind)
    const input = t.makeInput()
    let lost = 0
    for (let i = 0; i < 60 * 40; i++) {
      w.player.wax = 300
      const before = w.player.pips
      stepWorld(w, input(still(w)))
      w.events.length = 0
      if (w.player.pips < before) lost++
    }
    t.eq(lost, 0, `${kind}: shine lost under wax`)
    const plain = fight(kind, kind, kind === 'ollie' ? ollieBot() : nickBot(), { god: true })
    const turbo = fight(kind, kind, kind === 'ollie' ? ollieBot() : nickBot(), { god: true, each: (x) => (x.player.turbo = true) })
    t.ok(turbo.ended > 0, `${kind}: won with turbo`)
    t.ok(turbo.length <= plain.length + 600, `${kind}: turbo is not much slower (${secs(turbo.length)} s against ${secs(plain.length)} s)`)
    t.notes.push(`${kind}: with the turbo nozzle all fight the good player wins in ${secs(turbo.length)} s (${turbo.hits} hits); without it ${secs(plain.length)} s`)
  }
})

/* ------------------------------------------------------------------ */
/* Players who try to cheese it                                        */
/* ------------------------------------------------------------------ */

/**
 * A camper: gets to one spot and stays there, facing the rival and spraying (up when the rival
 * is above him), and hops when Ollie slides at him. 'corner' is the far left of the floor;
 * 'catwalk' is up on the first catwalk.
 */
function camperBot(kind, where) {
  return (w) => {
    const p = w.player
    const cx = pcx(w)
    const held = []
    const r = find(w, kind)
    if (!r || r.state === 'beaten') return held
    const cat = CATWALKS[kind][0]
    const spot = where === 'corner' ? AX0 + 12 : (cat[0] + cat[1]) / 2
    const onCat = p.onGround && Math.abs(p.y + p.h - CAT_Y) < 1
    if (where === 'catwalk' && !onCat) {
      const d = walk(p, spot, 4)
      if (d) held.push(d)
      else if (p.onGround) held.push('jump')
      return held
    }
    const d = walk(p, spot, 4)
    if (d) return [d]
    const rx = r.x + r.w / 2
    if (p.facing !== (rx > cx ? 1 : -1)) held.push(rx > cx ? 'right' : 'left')
    held.push('spray')
    if (r.y + r.h < p.y) held.push('up')
    if (kind === 'ollie' && r.state === 'slide' && Math.abs(rx - cx) < 90 && p.onGround) held.push('jump')
    return held
  }
}

t.test('both: campers in a corner or on a catwalk, and players who only spray, get hurt; a player who never aims up can still win Nick; nothing breaks', () => {
  const lines = []
  const run = (label, kind, bot) => {
    const r = fight(kind, kind, bot, { god: true, max: 60 * 120 })
    const ticks = r.ended > 0 ? r.length : r.w.tick
    lines.push(`${label}: ${r.hits} hits in ${Math.round(ticks / 60)} s, ${r.ended > 0 ? 'won' : 'not won (' + Math.round((100 * r.rival.hp) / r.rival.maxHp) + '% left)'}`)
    return r
  }
  const campers = [
    run('ollie corner camper', 'ollie', camperBot('ollie', 'corner')),
    run('ollie catwalk camper', 'ollie', camperBot('ollie', 'catwalk')),
    run('ollie only sprays', 'ollie', stillBot('ollie')),
    run('nick corner camper', 'nick', camperBot('nick', 'corner')),
    run('nick catwalk camper', 'nick', camperBot('nick', 'catwalk')),
    run('nick only sprays up', 'nick', stillBot('nick')),
  ]
  const noUp = run('nick, a good player who never aims up', 'nick', (() => {
    const b = nickBot()
    return (w) => b(w).filter((a) => a !== 'up')
  })())
  for (const r of campers) t.ok(r.hits >= 2, `camping should cost shine: ${lines.join('; ')}`)
  t.ok(campers.every((r) => r.ended < 0 || r.hits >= 4), `no camper wins cheaply: ${lines.join('; ')}`)
  t.ok(noUp.w.status === 'play', 'ran')
  t.notes.push('adversaries (shine topped up, 2 minutes at most): ' + lines.join('; '))
})

await t.finish()
