// MUDZILLA, the final boss (game/sim/entities/mudzilla.ts), fought in its dev arena
// (game/levels/dev/mudzilla.ts) by scripted players.
//
//   node scripts/maxx/tests/mudzilla.mjs [--only <text>] [--log]
//     --log                        print every hit the players take, and every failed dodge start
//     MZONE="spin 3 1 floor 32"    (env) run one dodge start: attack, phase, end (1 right, -1 left),
//                                  floor or catwalk, x from the arena's left edge [nohover]
//     MZRUN="2 0 1 floor 96"       (env) one start of the run search: phase, run, end, where, x
//     MZWEAK=camps                 (env) only the weak-spot players whose name holds this
//     MZDBG=0-99999                (env) with any of those: the player's every decision in that tick range
//     MZREC=file.json [MZSEED=n]   (env) record the good player's whole fight (buttons tick by tick
//                                  and the truck's state) for replaying it in the viewer or the
//                                  play scene, with that world seed (the play scene's is 0x2f6e2b1)
//
// The players see the world late: every decision is made from a picture of the world as it
// was `react` ticks ago (12 for the good player, 25 for the clumsy ones), carried forward the
// way a person who knows the fight would expect it to go (a wave keeps rolling, a hop lands
// where its shadow is, a slam follows a rear-up, or the hitch for those who go by it).
// Nothing that starts in the last `react` ticks is known to them. From that picture they plan
// a path along the floor that keeps clear of everything that will be there (a search over the
// next 90 ticks, 3 px a tick), jump the waves, climb a catwalk when the tyres spray the floor
// (or hang on the hover), dodge along a catwalk or step off it, wash blobs that come at them,
// and spray the truck whenever they can. Weak-spot players change one habit: they hug a wall,
// camp on the catwalks, only aim up, or never hover.
import { suite } from '../lib/testkit.mjs'

const t = await suite('mudzilla')
const { sim, levels, contract } = t
const { TILE, MAXX_W, MAXX_H } = contract
const { createWorld, stepWorld, worldHash, getBehavior } = sim
const LOG = process.argv.includes('--log')
const DEBUG = process.env.MZDBG ? process.env.MZDBG.split('-').map(Number) : null

// The fight's own numbers, from the very module the simulation runs, so the players know the moves.
const { MZ } = await t.loadModule('sim/entities/mudzilla.ts')
const LEVEL = levels.levelById('dev-mudzilla')
const ATTACKS = ['stomp', 'rain', 'blobs', 'spin', 'hop']
const TELLS = { stomp: 'stompTell', rain: 'rainTell', blobs: 'blobTell', spin: 'spinTell', hop: 'hopTell' }

const cx = (e) => e.x + e.w / 2
/** World x of a point u px from the back of the truck's box (drawn facing right). */
const tyre = (x, facing, u) => (facing > 0 ? x + u : x + 200 - u)
const bossOf = (w) => w.entities.find((e) => e.kind === 'mudzilla' && !e.dead) ?? null

/** A small deterministic random source for the clumsy player. */
function lcg(seed) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
}

/* ------------------------------------------------------------------ */
/* What a player can see: one picture of the fight per tick            */
/* ------------------------------------------------------------------ */

function snapshot(w) {
  const s = { tick: w.tick, boss: null, waves: [], marks: [], globs: [], fans: [], blobs: [] }
  for (const e of w.entities) {
    if (e.dead) continue
    const v = e.vars
    switch (e.kind) {
      case 'mudzilla':
        s.boss = { state: e.state, t: e.stateT, x: e.x, y: e.y, w: e.w, facing: e.facing, phase: v.phase, n: v.n, x0: v.x0, tx: v.tx, side: v.side, homeL: v.homeL, homeR: v.homeR, fin: v.fin }
        break
      case 'mz_wave':
        s.waves.push({ x: e.x, dir: e.facing, speed: v.speed, t: e.stateT, lo: v.lo, hi: v.hi })
        break
      case 'mz_mark':
        s.marks.push({ x: e.x, w: e.w, kind: v.kind, left: v.life - e.stateT, floor: v.floor })
        break
      case 'mz_glob':
        s.globs.push({ t: e.stateT, life: v.life, x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1, apex: v.apex })
        break
      case 'mz_fan':
        s.fans.push({ x: e.x, w: e.w, state: e.state, t: e.stateT, warn: v.warn, on: v.on })
        break
      case 'blob':
        if (v.mz === 1 && (e.state === 'walk' || e.state === 'hit')) s.blobs.push({ x: e.x, y: e.y, w: e.w, h: e.h, dir: e.facing })
        break
    }
  }
  return s
}

/* ------------------------------------------------------------------ */
/* A player                                                            */
/* ------------------------------------------------------------------ */

const CELL = 3
const H = 90
const GAP = 70

/**
 * opts: react (ticks late, 12), pad (px of room kept round danger, 6), lead (ticks before a wave
 * arrives that the jump starts, 3; a function for a sloppy one), catwalks (climb when the tyres
 * spray, true), cue (how he knows a slam is coming: 'timing' the rhythm of the rear-up, 'hitch'
 * the jerk just before each slam, 'wave' only from waves he has seen; 'timing'), hover (may hang
 * on the gun's hover over the tyre spray, true), aimUp (holds up whenever he sprays), mode:
 *   'wash'    goes where it can be washed from (the default)
 *   'left'    hugs the left wall, 'right' the right wall, moving only when he must
 *   'camper'  lives on a catwalk: back up onto one whenever nothing is coming, and off it only
 *             when something up there would hit him
 */
function makePlayer(w, opts = {}) {
  const react = opts.react ?? 12
  const pad = opts.pad ?? 6
  const lead = opts.lead ?? (() => 3)
  const useCatwalks = opts.catwalks !== false
  const cue = opts.cue ?? 'timing'
  const canHover = opts.hover !== false
  const mode = opts.mode ?? 'wash'
  const comfort = opts.comfort ?? 8
  const boss0 = bossOf(w)
  const V = boss0.vars
  const ax0 = V.ax0
  const ax1 = V.ax1
  const floor = V.floor
  const N = Math.floor((ax1 - MAXX_W - ax0) / CELL) + 1
  const danger = new Uint8Array((H + 1) * N)
  const from = new Int8Array((H + 1) * N)
  let reach = new Uint8Array(N)
  let next = new Uint8Array(N)
  const bx = new Float64Array(H + 1)
  const bh = new Float64Array(H + 1)
  const hist = []
  let jumpHold = 0
  /** The way the wave he is hopping runs, and ticks left of that hop: he lets go of the stick if he is running the same way. */
  let contactDir = 0
  let hopDir = 0
  let hopT = 0
  let climbing = null
  let hovering = false
  let dbgLast = 0
  const stats = { plans: 0, stuck: 0 }

  // The catwalks a jump from the floor reaches.
  const catwalks = []
  const g = w.grid
  for (let ty = Math.floor(floor / TILE) - 4; ty < Math.floor(floor / TILE); ty++) {
    let run = -1
    for (let tx = Math.floor(ax0 / TILE); tx <= Math.floor(ax1 / TILE); tx++) {
      const isCat = g.t[ty * g.w + tx] === 61
      if (isCat && run < 0) run = tx
      if (!isCat && run >= 0) {
        catwalks.push({ x0: run * TILE, x1: tx * TILE, top: ty * TILE })
        run = -1
      }
    }
  }

  function observe() {
    hist.push(snapshot(w))
    if (hist.length > 80) hist.shift()
  }

  /** What the player believes now: the picture from `react` ticks ago, carried forward. */
  function seen() {
    return hist.length > react ? hist[hist.length - 1 - react] : null
  }

  /**
   * The truck's box over the next H ticks (bx, bh: left edge and height of its underside above
   * the floor) and the slams to come, by playing its moves forward from what was seen.
   */
  function predictTruck(b, d) {
    const ix = Math.max(1, Math.min(3, b.phase)) - 1
    let state = b.state
    let tt = b.t
    let x = b.x
    let h = floor - (b.y + 150)
    let x0 = b.x0
    let tx = b.tx
    let n = b.n
    let facing = b.facing
    const slams = []
    // Whether he can know when the coming slam lands: always if he knows the timing; going by the
    // hitch, once he has seen it (or the slam itself); going by the waves, never ahead of them.
    const tellLen = n === 0 ? MZ.stompTell[ix] : MZ.stompAgain[ix]
    let known = cue === 'timing' || (cue === 'hitch' && (state === 'stomp' || (state === 'stompTell' && tt > tellLen - MZ.hitch)))
    const hops = MZ.hops[ix]
    const target = (k) => {
      const a = b.side > 0 ? b.homeR : b.homeL
      const z = b.side > 0 ? b.homeL : b.homeR
      return Math.round(a + ((z - a) * k) / hops)
    }
    for (let k = -d; k <= H; k++) {
      if (k > -d) {
        tt++
        switch (state) {
          case 'stompTell':
            if (tt >= (n === 0 ? MZ.stompTell[ix] : MZ.stompAgain[ix])) {
              state = 'stomp'
              tt = 0
            }
            break
          case 'stomp':
            if (tt === MZ.slam) {
              n++
              if (known) slams.push({ k, fwd: tyre(x, facing, MZ.tyreX.front), back: tyre(x, facing, MZ.tyreX.rear), facing, speed: MZ.waveSpeed[ix] })
            }
            if (tt >= MZ.slam + (n < MZ.stomps[ix] ? MZ.stompGap : MZ.stompRest[ix])) {
              state = n < MZ.stomps[ix] ? 'stompTell' : 'done'
              tt = 0
              // The next slam of the set: someone going by the hitch has not seen it yet.
              if (cue !== 'timing') known = false
            }
            break
          case 'hopTell':
            if (tt >= MZ.hopTell[ix]) {
              state = 'hop'
              tt = 0
              x0 = x
              tx = target(n + 1)
            }
            break
          case 'hop': {
            const kk = Math.min(1, tt / MZ.hopTicks[ix])
            x = x0 + (tx - x0) * kk
            h = 4 * MZ.hopHeight[ix] * kk * (1 - kk)
            if (kk >= 1) {
              x = tx
              h = 0
              n++
              state = 'hopLand'
              tt = 0
            }
            break
          }
          case 'hopLand':
            if (n < hops && tt >= MZ.hopLand[ix]) {
              state = 'hop'
              tt = 0
              x0 = x
              tx = target(n + 1)
            } else if (n >= hops && tt === MZ.hopLand[ix]) facing = -facing
            break
        }
      }
      if (k >= 0) {
        bx[k] = x
        bh[k] = h
      }
    }
    return { slams, facing }
  }

  function block(k, xa, xb) {
    if (k < 0 || k > H) return
    const lo = Math.max(0, Math.ceil((xa - pad - MAXX_W - ax0) / CELL))
    const hi = Math.min(N - 1, Math.floor((xb + pad - ax0) / CELL))
    for (let c = lo; c <= hi; c++) danger[k * N + c] = 1
  }
  const blockSpan = (k0, k1, xa, xb) => {
    for (let k = Math.max(0, k0); k <= Math.min(H, k1); k++) block(k, xa, xb)
  }

  /** Every place on the floor that will be dangerous over the next H ticks. */
  function fillDanger(s, d, px) {
    danger.fill(0)
    const b = s.boss
    if (b && b.state !== 'washed' && b.fin === 0) {
      for (let k = 0; k <= H; k++) if (bh[k] < MAXX_H + 6) block(k, bx[k], bx[k] + 200)
    }
    for (const m of s.marks) {
      if (m.kind !== 0) continue
      const left = m.left - d
      // Off a shadow a little before its clod could reach his head, not at the last tick.
      blockSpan(left - 13 - comfort, left + 2, m.x, m.x + m.w)
    }
    for (const gl of s.globs) {
      for (let k = 0; k <= H; k++) {
        const tt = gl.t + d + k
        if (tt <= gl.life) {
          const kk = tt / gl.life
          const x = gl.x0 + (gl.x1 - gl.x0) * kk
          const y = gl.y0 + (gl.y1 - gl.y0) * kk - 4 * gl.apex * kk * (1 - kk)
          if (y + 20 > floor - MAXX_H - 4 && gl.y1 + 20 >= floor - 2) block(k, x, x + 20)
        } else if (gl.y1 + 20 >= floor - 2) {
          // It lands as a blob and walks at him.
          const dir = px + MAXX_W / 2 < gl.x1 + 10 ? -1 : 1
          const x = gl.x1 - 5 + dir * 0.5 * (tt - gl.life)
          block(k, x, x + 30)
        }
      }
    }
    for (const f of s.fans) {
      const tt = f.t + d
      const on0 = f.state === 'warn' ? f.warn - tt : -tt
      const on1 = on0 + f.on
      blockSpan(on0 - 3, on1 + 3, f.x, f.x + f.w)
    }
    for (const bl of s.blobs) {
      if (bl.y + bl.h < floor - 4) continue
      for (let k = 0; k <= H; k++) {
        let x = bl.x + bl.dir * 0.5 * (d + k)
        if (x < ax0) x = 2 * ax0 - x
        if (x > ax1 - bl.w) x = 2 * (ax1 - bl.w) - x
        block(k, x, x + bl.w)
      }
    }
  }

  /**
   * The search: from where he is, a cell a tick, the safe path that ends nearest `pref`. Returns the
   * planned x `ahead` ticks on. `escape`: if no path stays safe all the way, head for the clear.
   */
  function plan(px, pref, ahead, escape = false) {
    stats.plans++
    const c0 = Math.max(0, Math.min(N - 1, Math.round((px - ax0) / CELL)))
    reach.fill(0)
    reach[c0] = 1
    let last = 0
    for (let k = 1; k <= H; k++) {
      next.fill(0)
      let any = false
      const row = k * N
      for (let c = 0; c < N; c++) {
        if (danger[row + c]) continue
        // Prefer standing still, then moving toward pref.
        if (reach[c]) {
          next[c] = 1
          from[row + c] = 0
        } else if (c > 0 && reach[c - 1]) {
          next[c] = 1
          from[row + c] = 1
        } else if (c < N - 1 && reach[c + 1]) {
          next[c] = 1
          from[row + c] = -1
        } else continue
        any = true
      }
      if (!any) break
      last = k
      const tmp = reach
      reach = next
      next = tmp
    }
    dbgLast = last
    if (last < H) stats.stuck++
    if (last === 0) return px
    // The reachable cell at the last safe tick nearest pref; or, if the search found no way to
    // stay safe for the whole horizon (it plans at 3 px a tick, a little under his real top
    // speed), the one nearest the clear a tick later, where his real legs most likely make it.
    let best = -1
    let bestCost = Infinity
    const row = Math.min(H, last + 1) * N
    for (let c = 0; c < N; c++) {
      if (!reach[c]) continue
      let cost = Math.abs(ax0 + c * CELL - pref)
      if (last < H && escape) {
        let gap = 0
        while (gap < N && (c - gap < 0 || danger[row + c - gap]) && (c + gap >= N || danger[row + c + gap])) gap++
        cost += gap * 1000
      }
      if (cost < bestCost) {
        bestCost = cost
        best = c
      }
    }
    // Walk back to the tick we want.
    let c = best
    for (let k = last; k > ahead; k--) c -= from[k * N + c]
    return ax0 + c * CELL
  }

  /** How many of the next `n` ticks he stays out of danger holding `dir` (his own run physics, roughly). */
  function safeTicks(p, dir, spraying, n) {
    let x = p.x
    let v = p.vx
    const top = spraying ? 150 : 215
    const air = !p.onGround
    for (let i = 1; i <= n; i++) {
      if (dir === 0) v = Math.sign(v) * Math.max(0, Math.abs(v) - (air ? 450 : 1400) / 60)
      else if (v * dir < 0) v += (dir * (air ? 1400 : 2400)) / 60
      else v = Math.max(-top, Math.min(top, v + (dir * (air ? 800 : 1100)) / 60))
      x += v / 60
      const c = Math.round((x - ax0) / CELL)
      if (c < 0 || c >= N || danger[i * N + c]) return i - 1
    }
    return n
  }

  /** The way to push the stick: the one wanted if it is safe, else stopping, else the other way. */
  function steer(p, want, spraying) {
    const order = want === 0 ? [0, -Math.sign(p.vx) || 1, Math.sign(p.vx) || -1] : [want, 0, -want]
    let best = order[0]
    let bestT = -1
    for (const dir of order) {
      const s = safeTicks(p, dir, spraying, 10)
      if (s >= 10) return dir
      if (s > bestT) {
        bestT = s
        best = dir
      }
    }
    return best
  }

  /** Ticks until a wave (seen or still to come from a slam) is under him, or Infinity. */
  function waveContact(s, d, slams, px) {
    let best = Infinity
    const mx0 = px - 2
    const mx1 = px + MAXX_W + 2
    const rolls = []
    for (const wv of s.waves) rolls.push({ k0: -d, c: wv.x + MZ.wave.w / 2, dir: wv.dir, speed: wv.speed, t: wv.t })
    for (const sl of slams) {
      rolls.push({ k0: sl.k, c: sl.fwd, dir: sl.facing, speed: sl.speed, t: 0 })
      rolls.push({ k0: sl.k, c: sl.back, dir: -sl.facing, speed: sl.speed, t: 0 })
    }
    for (const r of rolls) {
      // Played forward tick by tick as the sim moves it: slow out from under the tyre, then full speed.
      let c = r.c
      let tt = r.t
      for (let k = r.k0; k <= Math.min(H, r.k0 + 200); k++) {
        if (k > r.k0) {
          tt++
          c += (r.dir * r.speed * Math.min(1, MZ.waveStart + ((1 - MZ.waveStart) * tt) / MZ.waveRamp)) / 60
        }
        if (c - MZ.wave.w / 2 < ax0 || c + MZ.wave.w / 2 > ax1) break
        if (k < 0) continue
        if (c + MZ.wave.w / 2 > mx0 && c - MZ.wave.w / 2 < mx1) {
          if (k < best) contactDir = r.dir
          best = Math.min(best, k)
          break
        }
      }
    }
    return best
  }

  /**
   * The first tick (0..horizon) at which standing at x on catwalk cw would be hit: by the truck's
   * box, by a clod falling through, or by a glob in flight. Infinity if none.
   */
  function catwalkThreat(s, d, cw, x, horizon) {
    const hs = floor - cw.top
    const x0 = x - pad
    const x1 = x + MAXX_W + pad
    let first = Infinity
    if (s.boss && s.boss.fin === 0) {
      for (let k = 0; k <= Math.min(H, horizon); k++) {
        if (bx[k] < x1 && bx[k] + 200 > x0 && bh[k] < hs + MAXX_H + 4 && bh[k] + 150 > hs) {
          first = k
          break
        }
      }
    }
    const fall = MZ.clod.speed / 60
    for (const m of s.marks) {
      if (m.kind !== 0 || m.x + m.w < x0 || m.x > x1) continue
      const left = m.left - d
      const pass0 = Math.floor(left - (hs + MAXX_H + 4) / fall) - 2
      const pass1 = Math.ceil(left - (hs - MZ.clod.h) / fall) + 2
      if (pass1 >= 0 && pass0 <= horizon) first = Math.min(first, Math.max(0, pass0))
    }
    for (const gl of s.globs) {
      for (let k = 0; k <= horizon; k++) {
        const tt = gl.t + d + k
        if (tt > gl.life) break
        const kk = tt / gl.life
        const gx = gl.x0 + (gl.x1 - gl.x0) * kk
        const gy = gl.y0 + (gl.y1 - gl.y0) * kk - 4 * gl.apex * kk * (1 - kk)
        if (gx + 20 > x0 && gx < x1 && gy + 20 > cw.top - MAXX_H - 4 && gy < cw.top) {
          first = Math.min(first, k)
          break
        }
      }
    }
    return first
  }

  /** The catwalk under (or nearest above) x, or null. */
  const catwalkAt = (x) => catwalks.find((c) => x + MAXX_W > c.x0 && x < c.x1) ?? null

  /** Is the floor at x clear from `k0` to `k1` ticks on (where he lands after stepping off a catwalk)? */
  function floorClear(x, k0, k1) {
    const c = Math.round((x - ax0) / CELL)
    if (c < 0 || c >= N) return false
    for (let k = k0; k <= Math.min(H, k1); k++) if (danger[k * N + c]) return false
    return true
  }

  /** Where to walk to get off catwalk cw: off the end `way` (-1 left) if the floor below is clear, else the other, else stay. */
  function dropOff(cw, way, px) {
    const ends = way < 0 ? [cw.x0 - MAXX_W - 8, cw.x1 + 8] : [cw.x1 + 8, cw.x0 - MAXX_W - 8]
    for (const x of ends) {
      const ticks = Math.abs(x - px) / 3 + 4
      // He runs off the end, so he comes down anywhere up to 50 px further on.
      const on = x > px ? 1 : -1
      let ok = true
      for (let dx = -6; dx <= 50 && ok; dx += 6) ok = floorClear(x + on * dx, Math.floor(ticks), Math.ceil(ticks) + 30)
      if (ok) return x
    }
    return Math.max(cw.x0 + 4, Math.min(cw.x1 - MAXX_W - 4, px))
  }

  /** This tick's buttons. */
  function decide() {
    const p = w.player
    const held = []
    const s = seen()
    const b = s && s.boss
    if (!b || b.state === 'sleep') {
      held.push('right')
      return held
    }
    if (b.state === 'washed' || b.fin) return held
    const d = w.tick - s.tick
    const px = p.x
    const feet = p.y + p.h
    const onCatwalk = p.onGround && feet < floor - 8
    const { slams, facing: endFacing } = predictTruck(b, d)
    // Where to wash it from, once it has done whatever it is doing.
    const tfront = endFacing < 0 ? bx[H] : bx[H] + 200
    let pref = Math.max(ax0, Math.min(ax1 - MAXX_W, endFacing < 0 ? tfront - GAP - MAXX_W : tfront + GAP))
    if (mode === 'left') pref = ax0
    if (mode === 'right') pref = ax1 - MAXX_W
    fillDanger(s, d, px)

    // The tyres are about to spray the floor (or are spraying it): when, and where.
    let fan = null
    for (const f of s.fans) {
      const tt = f.t + d
      const on0 = f.state === 'warn' ? f.warn - tt : -tt
      if (on0 + f.on > -4) fan = { on0, on1: on0 + f.on, x0: f.x, x1: f.x + f.w }
    }
    // Waves on the floor: hold still and hop them, never run into them.
    const waves = s.waves.length > 0 || slams.length > 0 || b.state === 'stompTell' || b.state === 'stomp'

    let target = px
    let spray = true
    const hopping = b.state === 'hopTell' || b.state === 'hop' || b.state === 'hopLand'
    if (onCatwalk) {
      // Up here the waves and the tyre spray pass underneath. A camper stays; anyone else comes
      // down again (off the end nearer where he wants to be, if nothing waits where he lands)
      // unless the floor is the worse place. Either way: if something up here is coming for him,
      // along the catwalk to a spot nothing will reach, or off an end.
      const cw = catwalkAt(px)
      if (cw) {
        const stay = mode === 'camper' || fan || waves
        target = Math.max(cw.x0 + 4, Math.min(cw.x1 - MAXX_W - 4, px))
        if (!stay) {
          const end = dropOff(cw, pref < (cw.x0 + cw.x1) / 2 ? -1 : 1, px)
          // Not across a stretch of catwalk something is about to come down on.
          let open = true
          const lo = Math.max(cw.x0 - MAXX_W, Math.min(px, end))
          const hi = Math.min(cw.x1, Math.max(px, end))
          for (let x = lo; x <= hi && open; x += 6) open = catwalkThreat(s, d, cw, x, Math.abs(x - px) / 3 + 12) === Infinity
          if (open) target = end
        }
        const leaving = Math.abs(target - px) > 10
        const now = leaving ? Infinity : catwalkThreat(s, d, cw, px, 50)
        if (now < Infinity) {
          let best = null
          for (let x = cw.x0 + 2; x <= cw.x1 - MAXX_W - 2; x += 3) {
            const need = Math.abs(x - px) / 3.3 + 3
            if (need >= now || catwalkThreat(s, d, cw, x, 50) < Infinity) continue
            if (best === null || Math.abs(x - px) < Math.abs(best - px)) best = x
          }
          target = best !== null ? best : dropOff(cw, cx({ x: b.x, w: 200 }) > (cw.x0 + cw.x1) / 2 ? -1 : 1, px)
        }
        spray = Math.abs(target - px) < 10
      }
      climbing = null
    } else {
      let want = plan(px, waves ? px : pref, 8, fan !== null)
      const clear = dbgLast === H
      // A camper with nothing coming goes back up onto the catwalk nearest the truck's face.
      const calm = mode === 'camper' && !fan && !waves && !hopping && s.globs.length === 0 && clear && p.onGround
      if (calm && climbing === null) {
        let best = null
        for (const c of catwalks) {
          const mid = Math.max(c.x0 + 6, Math.min(c.x1 - MAXX_W - 6, tfront))
          if (catwalkThreat(s, d, c, mid, 60) < Infinity) continue
          if (!best || Math.abs(mid - tfront) < Math.abs(best - tfront)) best = mid
        }
        if (best !== null) climbing = best
      }
      if (!fan && !(mode === 'camper' && (calm || !p.onGround))) climbing = null
      // No floor path clear of the tyre spray: up onto a catwalk if one is near enough, else
      // jump as it starts and hang on the gun's hover until it stops.
      if (fan && p.onGround && !hovering && climbing === null && !clear) {
        let best = null
        for (const c of useCatwalks ? catwalks : []) {
          const mid = Math.max(c.x0 + 6, Math.min(c.x1 - MAXX_W - 6, px))
          const need = Math.abs(mid - px) / 3.2 + (Math.abs(mid - px) > 4 ? 10 : 0) + 8
          if (need <= fan.on0 - 1 && (!best || need < best.need)) best = { mid, need }
        }
        if (best) climbing = best.mid
      }
      // Too late for a catwalk (or none near): jump as it starts and hang on the hover.
      if (canHover && fan && p.onGround && !hovering && climbing === null && !clear && fan.on0 <= 5 && jumpHold === 0 && px + MAXX_W > fan.x0 - pad && px < fan.x1 + pad) {
        jumpHold = 26
        hovering = true
      }
      // A climb that cannot make it any more: hover instead.
      if (climbing !== null && p.onGround && fan && fan.on0 <= 5 && Math.abs(climbing - px) > 12) climbing = null
      if (climbing !== null) {
        want = climbing
        if (p.onGround && jumpHold === 0 && ((Math.abs(climbing - px) <= 6 && Math.abs(p.vx) < 60) || (fan && Math.abs(climbing - px) <= 12 && fan.on0 <= 6))) jumpHold = 26
      }
      if (hovering) want = px
      // A blob walking at him on his own level: stand and wash it first (nothing else forcing a move).
      if (climbing === null && !hovering && p.onGround) {
        for (const bl of s.blobs) {
          const gap = Math.abs(bl.x + bl.w / 2 - (px + MAXX_W / 2))
          if (Math.abs(bl.y + bl.h - feet) < 12 && gap < 130) want = px
        }
      }
      target = want
      if (Math.abs(target - px) > 10) spray = false
    }
    if (hovering && !p.onGround && p.vy > -80) {
      held.push('down')
      spray = true
    }
    if (hovering && p.onGround && jumpHold === 0) hovering = false

    // Jump the waves.
    if (DEBUG && w.tick >= DEBUG[0] && w.tick <= DEBUG[1]) {
      console.log(`      t ${w.tick} last ${dbgLast} truck0 ${bx[0].toFixed(0)}/${bh[0].toFixed(0)} truck8 ${bx[8].toFixed(0)}/${bh[8].toFixed(0)} x ${px.toFixed(1)} feet ${feet.toFixed(0)} vx ${p.vx.toFixed(0)} ground ${p.onGround} target ${target.toFixed(0)} pref ${pref.toFixed(0)} tc ${waveContact(s, d, slams, px)} slams ${JSON.stringify(slams)} waves ${s.waves.map((q) => Math.round(q.x)).join(',')} boss ${b.state} ${b.t} marks ${s.marks.map((m) => `${Math.round(m.x)}:${m.left - d}:${m.kind}`).join(",")}`)
    }
    if (!onCatwalk && p.onGround && jumpHold === 0) {
      const tc = waveContact(s, d, slams, px)
      if (tc <= lead()) {
        // A wave catching him up from behind is under him for longer: a higher hop, and stop running.
        const chased = Math.sign(p.vx) === contactDir && Math.abs(p.vx) > 40
        jumpHold = chased ? 12 : 5
        hopDir = contactDir
        hopT = 30
      }
    }
    if (jumpHold > 0) {
      held.push('jump')
      jumpHold--
    }

    // Move: hold toward the target, let go in time to stop on it, and never take a step that
    // the next few ticks of his own momentum would carry into danger.
    const dx = target - px
    const stop = (p.vx * p.vx) / 2800 + 1
    let dir = 0
    if (Math.abs(dx) > 1.5) {
      dir = dx > 0 ? 1 : -1
      if (Math.abs(dx) <= stop && Math.sign(p.vx) === dir) dir = 0
    }
    if (!onCatwalk && (climbing === null || (mode === 'camper' && !fan))) dir = steer(p, dir, spray)
    if (hopT > 0) {
      hopT--
      // (Not while the tyre spray is about: then he must keep running to where it cannot reach.)
      if (!p.onGround && dir === hopDir && !fan) dir = 0
    }
    // Standing: face what to wash (a blob coming at him first, then the truck).
    if (dir === 0 && spray) {
      let face = cx({ x: b.x, w: 200 }) < px + MAXX_W / 2 ? -1 : 1
      let near = 150
      for (const bl of s.blobs) {
        const dist = Math.abs(bl.x + bl.w / 2 - (px + MAXX_W / 2))
        const level = Math.abs(bl.y + bl.h - feet) < 12
        if (level && dist < near) {
          near = dist
          face = bl.x + bl.w / 2 < px + MAXX_W / 2 ? -1 : 1
        }
      }
      if (p.facing !== face) dir = face
    }
    if (dir > 0) held.push('right')
    if (dir < 0) held.push('left')
    if (spray) held.push('spray')
    // The up-sprayer aims up at the truck always; blobs on the floor he still washes straight on.
    if (spray && opts.aimUp && !s.blobs.some((bl) => Math.abs(bl.y + bl.h - feet) < 12 && Math.abs(bl.x + bl.w / 2 - (px + MAXX_W / 2)) < 160)) held.push('up')
    return held
  }

  return { observe, decide, stats, catwalks }
}

/* ------------------------------------------------------------------ */
/* Fights                                                              */
/* ------------------------------------------------------------------ */

/** A world in the dev arena with Maxx at the start. */
function arena(seed = 1, flags) {
  const w = createWorld(LEVEL, { session: t.freshSession(), seed, ...(flags ? { flags } : {}) })
  return { w, boss: bossOf(w) }
}

/**
 * Play the whole level with a player. opts: as makePlayer, plus god (keep his shine topped up so
 * every hit can be counted to the end), limit (ticks). Returns what happened.
 */
function fight(opts = {}) {
  const { w } = arena(opts.seed ?? 1)
  const player = makePlayer(w, opts)
  const input = t.makeInput()
  const r = { hits: 0, start: -1, washed: -1, clear: -1, ticks: 0, phases: [], status: '', hash: '', w, player, events: [], timeAtWashed: -1, timeAtClear: -1 }
  let prevPhase = 1
  const limit = opts.limit ?? 60 * 60 * 8
  player.observe()
  if (opts.record) {
    r.inputs = []
    r.log = []
  }
  while (w.status === 'play' && r.ticks < limit) {
    const pips = w.player.pips
    const held = opts.still ? stillPlayer(w) : player.decide()
    if (opts.record) r.inputs.push(held.join(' '))
    stepWorld(w, input(held))
    if (opts.events) for (const ev of w.events) r.events.push(ev)
    w.events.length = 0
    r.ticks++
    if (w.player.pips < pips || w.status === 'grimed') {
      r.hits++
      if (LOG) {
        const b = bossOf(w)
        const near = w.entities.filter((e) => !e.dead && (e.kind.startsWith('mz_') || e.kind === 'blob') && e.kind !== 'mz_shutter' && Math.abs(cx(e) - w.player.x) < 120)
        console.log(
          `    hit at ${r.ticks}: boss ${b?.state} ${b?.stateT} x ${Math.round(b?.x)} phase ${b?.vars.phase}, maxx x ${Math.round(w.player.x)} y ${Math.round(w.player.y + w.player.h)} vx ${Math.round(w.player.vx)} ground ${w.player.onGround}; near: ${near.map((e) => `${e.kind} ${e.state} x ${Math.round(e.x)} y ${Math.round(e.y)} w ${e.w}`).join(', ')}`,
        )
      }
      if (opts.god && w.status === 'play') w.player.pips = 3
    }
    player.observe()
    const b = bossOf(w)
    if (opts.record) r.log.push(`${b ? `${b.state} ${b.stateT} ${b.vars.phase} ${Math.round(b.hp)}` : '-'} ${w.player.x.toFixed(3)} ${w.player.y.toFixed(3)} ${w.entities.length}`)
    if (b && r.start < 0 && b.state !== 'sleep') r.start = r.ticks
    if (b && r.washed < 0 && b.state === 'washed') {
      r.washed = r.ticks
      r.timeAtWashed = w.timeLeft
    }
    if (b && b.vars.phase !== prevPhase) {
      r.phases.push(r.ticks)
      prevPhase = b.vars.phase
    }
  }
  if (w.status === 'clear') {
    r.clear = r.ticks
    r.timeAtClear = w.timeLeft
  }
  r.status = w.status
  r.hash = worldHash(w)
  return r
}

/** Somebody who walks in, stops in front of it, faces it and holds spray for ever. */
function stillPlayer(w) {
  const b = bossOf(w)
  if (!b || b.state === 'sleep') return ['right']
  const spot = b.vars.homeR - GAP - MAXX_W
  if (w.player.x < spot - 2) return ['right', 'spray']
  if (w.player.facing < 0) return ['right', 'spray']
  return ['spray']
}
const secs = (ticks) => Math.round((ticks / 60) * 10) / 10

/* ------------------------------------------------------------------ */
/* The tests                                                           */
/* ------------------------------------------------------------------ */

t.test('the arena: it finds its walls, sleeps until Maxx is in, shows itself, then locks the camera on the arena, shuts the door and calls the fight', () => {
  const { w, boss } = arena()
  t.ok(boss, 'no mudzilla in the dev arena')
  const v = boss.vars
  t.eq(boss.w, 200, 'width')
  t.eq(boss.h, 150, 'height')
  t.eq(boss.hp, 150, 'dirt')
  t.eq(v.ax1, 37 * TILE, 'the right wall face')
  t.eq(v.ax0, 15 * TILE, 'the arena left edge')
  t.eq(boss.x, v.ax1 - 12 - 200, 'parked against the right wall')
  t.eq(boss.y + boss.h, 10 * TILE, 'on the floor')
  const seen = []
  const input = t.makeInput()
  // Walk in: nothing happens until his middle is 80 px inside.
  t.until(w, ['right'], (w) => w.player.x + MAXX_W / 2 >= v.ax0 + 60, 600, input, seen)
  t.eq(boss.state, 'sleep', 'state while he is in the doorway')
  t.eq(w.camBounds, null, 'camera while he is in the doorway')
  t.until(w, ['right'], () => boss.state !== 'sleep', 120, input, seen)
  t.eq(boss.state, 'wake', 'state once he is in')
  t.eq(seen.filter((ev) => ev.type === 'versus').length, 1, 'versus cards')
  t.ok(t.has(seen, 'versus', (ev) => ev.name === 'MUDZILLA' && ev.tagline === 'DIRTIEST TRUCK IN WEST TEXAS'), 'versus card')
  t.ok(t.has(seen, 'music', (ev) => ev.id === 'boss'), 'boss music')
  t.ok(t.has(seen, 'sfx', (ev) => ev.id === 'door'), 'the shutter clangs')
  t.ok(w.boss && w.boss.name === 'MUDZILLA' && w.boss.hp === 150, 'boss bar')
  const shutter = t.find(w, 'mz_shutter')
  t.ok(shutter && shutter.solid === 'full' && shutter.x === 14 * TILE && shutter.h === 2 * TILE, 'a solid shutter in the doorway')
  // For the wake the camera holds the whole truck and Maxx.
  t.until(w, [], () => boss.stateT >= 30, 60, input, seen)
  const c = w.camera.x
  t.ok(c <= boss.x && c + 640 >= boss.x + boss.w, `the whole truck on screen for the wake (camera ${c}, truck ${boss.x}..${boss.x + boss.w})`)
  t.ok(c <= w.player.x && c + 640 >= w.player.x + MAXX_W, `Maxx on screen for the wake (camera ${c}, Maxx ${w.player.x})`)
  t.ok(t.has(seen, 'sfx', (ev) => ev.id === 'thunder') || boss.stateT < MZ.wakeRoar, 'it roars as it wakes')
  // Then the arena: the floor and a wall column each side, and he cannot leave it.
  t.until(w, ['left'], () => boss.state === 'idle', 200, input, seen)
  t.eq(w.camBounds.x0, 14 * TILE, 'camera lock left (the left wall)')
  t.eq(w.camBounds.x1, 38 * TILE, 'camera lock right (the right wall)')
  t.until(w, ['left'], () => false, 120, input, seen)
  t.ok(w.player.x >= v.ax0 - 1, `he walked out to ${w.player.x}`)
  t.ok(t.has(seen, 'sfx', (ev) => ev.id === 'thunder'), 'it roared as it woke')
})

t.test('every kind it makes is removed off screen, and touching it costs one pip, never a grime', () => {
  for (const k of ['mz_mark', 'mz_clod', 'mz_glob', 'mz_wave', 'mz_fan']) t.eq(getBehavior(k)?.offscreen, 'remove', `${k} offscreen`)
  t.ok(getBehavior('mudzilla')?.alwaysActive, 'mudzilla is always active')
  const { w, boss } = arena()
  t.place(w, boss.vars.ax0 + 200, boss.vars.floor)
  const input = t.makeInput()
  t.until(w, [], () => boss.state === 'idle', 400, input)
  t.place(w, boss.x + 30, boss.vars.floor)
  t.steps(w, [], 1, input)
  t.eq(w.player.pips, 2, 'pips after touching it')
  t.eq(w.status, 'play', 'still playing')
})

t.test('phases: at 66% and 33% it roars (thunder, shake), turns cleaner and cannot be washed past the line mid-roar', () => {
  const { w, boss } = arena()
  t.place(w, boss.vars.ax0 + 200, boss.vars.floor)
  const input = t.makeInput()
  t.until(w, [], () => boss.state === 'idle', 400, input)
  w.player.invuln = 1e6
  boss.vars.force = 0
  t.until(w, [], () => boss.state === 'winded', 600, input)
  for (let i = 0; i < 1000 && boss.vars.roar === 0; i++) t.spray(w, boss)
  t.eq(boss.hp, 100, 'dirt stops at the line')
  for (let i = 0; i < 50; i++) t.spray(w, boss)
  t.eq(boss.hp, 100, 'dirt while the roar is owed')
  const seen = []
  t.until(w, [], () => boss.state === 'roar', 60, input, seen)
  t.until(w, [], () => boss.state !== 'roar', 200, input, seen)
  t.eq(boss.vars.phase, 2, 'phase after the first roar')
  t.ok(t.has(seen, 'sfx', (ev) => ev.id === 'thunder') && t.has(seen, 'shake'), 'thunder and shake')
})

t.test('a phase line crossed mid-attack: the attack plays out, then it roars, and the new phase starts its pattern from the top', () => {
  const { w, boss } = arena()
  const v = boss.vars
  t.place(w, v.ax0 + 200, v.floor)
  const input = t.makeInput()
  t.until(w, [], () => boss.state === 'idle', 400, input)
  w.player.invuln = 1e6
  boss.hp = 100.1
  v.force = 0
  t.until(w, [], () => boss.state === 'stompTell', 200, input)
  // Chip it over the line in the middle of the rear-up.
  t.steps(w, [], 10, input)
  for (let i = 0; i < 20; i++) t.spray(w, boss)
  t.eq(boss.hp, 100, 'dirt at the line')
  t.eq(v.roar, 1, 'roar owed')
  const states = []
  for (let i = 0; i < 600 && boss.state !== 'roar'; i++) {
    t.steps(w, [], 1, input)
    if (states[states.length - 1] !== boss.state) states.push(boss.state)
  }
  t.eq(states.join(' '), 'stompTell stomp winded roar', 'states from the chip to the roar')
  t.eq(v.phase, 1, 'body until the roar')
  v.force = -1
  t.until(w, [], () => boss.state !== 'roar', 200, input)
  t.eq(v.phase, 2, 'phase after the roar')
  t.eq(v.run, 0, 'run')
  t.eq(v.step, 0, 'step')
  t.until(w, [], () => boss.state !== 'idle', 200, input)
  t.eq(boss.state, 'stompTell', 'the first attack of phase 2')
})

t.test('Maxx hurt in the middle of a tell: one pip, the blink covers the slam, and the fight goes on', () => {
  const { w, boss, input } = atTell('stomp', 1, 1, { x: 0, y: 0 })
  const v = boss.vars
  t.place(w, boss.x - 60, v.floor)
  t.steps(w, [], 6, input)
  sim.hurtPlayer(w, { fromX: boss.x })
  t.eq(w.player.pips, 2, 'pips after the hit')
  t.until(w, [], () => boss.state === 'winded', 400, input)
  t.eq(w.player.pips, 2, 'pips after the slams (he was blinking)')
  t.eq(w.status, 'play', 'still playing')
})

t.test('Mighty Wax: nothing in the fight touches him while it lasts, and when it runs out the fight song comes back', () => {
  const { w, boss } = arena()
  const v = boss.vars
  const input = t.makeInput()
  t.until(w, ['right'], () => boss.state !== 'sleep', 400, input)
  t.until(w, [], () => boss.state === 'idle', 200, input)
  sim.giveWax(w, 400)
  const seen = []
  // Stand in front of it and take everything it does for the length of the wax.
  t.place(w, boss.x - 40, v.floor)
  let lost = 0
  for (let i = 0; i < 398; i++) {
    const pips = w.player.pips
    stepWorld(w, input(['spray']))
    for (const ev of w.events) seen.push(ev)
    w.events.length = 0
    if (w.player.pips < pips) lost++
  }
  t.eq(lost, 0, 'pips lost while waxed')
  t.until(w, [], () => w.player.wax === 0, 10, input, seen)
  const after = []
  t.steps(w, [], 3, input).forEach((ev) => after.push(ev))
  const songs = [...seen, ...after].filter((ev) => ev.type === 'music').map((ev) => ev.id)
  t.eq(songs[songs.length - 1], 'boss', `songs asked for: ${songs.join(', ')}`)
})

t.test('the turbo nozzle washes half as hard again a drop, as on every boss (and the nozzle fires half as often again)', () => {
  const { w, boss } = arena()
  const input = t.makeInput()
  t.place(w, boss.vars.ax0 + 200, boss.vars.floor)
  t.until(w, [], () => boss.state === 'idle', 400, input)
  w.player.invuln = 1e6
  boss.vars.force = 4
  t.until(w, [], () => boss.state === 'winded', 600, input)
  t.ok(getBehavior('mudzilla').boss, 'not marked as a boss (EntityBehavior.boss)')
  const h0 = boss.hp
  t.spray(w, boss, 1)
  const plain = h0 - boss.hp
  const h1 = boss.hp
  // What a turbo droplet is worth on a boss once it hits (the core caps it there: TUNING.turboBossPower).
  t.spray(w, boss, sim.TUNING.turboBossPower)
  const turbo = h1 - boss.hp
  t.near(plain, MZ.washWinded, 1e-9, 'a plain drop while winded')
  t.near(turbo / plain, sim.TUNING.turboBossPower, 1e-9, 'a turbo drop against a plain one')
})

/** Put the fight into an attack's telegraph: the phase, the side it starts from, Maxx at x (feet y). */
function atTell(attack, phase, side, place) {
  return atStart(phase, side, place, ATTACKS.indexOf(attack), TELLS[attack])
}

/** The same for a whole run of attacks (run index into that phase's pattern): it starts as the first tell does. */
function atRun(phase, run, side, place) {
  return atStart(phase, side, place, -1, null, run)
}

function atStart(phase, side, place, force, tell, run = 0) {
  const { w, boss } = arena(5)
  const player = makePlayer(w, place.opts)
  const input = t.makeInput()
  const v = boss.vars
  t.place(w, v.ax0 + 300, v.floor)
  player.observe()
  for (let i = 0; i < 400 && boss.state !== 'idle'; i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    player.observe()
  }
  v.phase = phase
  boss.hp = Math.round((boss.maxHp * (4 - phase)) / 3) - 5
  if (side < 0) {
    boss.x = v.homeL
    v.side = -1
    boss.facing = 1
  }
  v.force = force
  v.run = run
  v.step = 0
  v.wait = 0
  for (let i = 0; i < 100 && (tell ? boss.state !== tell : boss.state === 'idle'); i++) {
    stepWorld(w, input([]))
    w.events.length = 0
    player.observe()
  }
  if (tell) t.eq(boss.state, tell, 'into the telegraph')
  w.player.x = place.x
  w.player.y = place.y - MAXX_H
  w.player.vx = 0
  w.player.vy = 0
  w.player.onGround = true
  w.player.facing = cx(boss) < place.x ? -1 : 1
  w.player.invuln = 0
  return { w, boss, player, input }
}

/** Every place Maxx could stand when a telegraph starts: along the floor (not inside the truck) and on each catwalk. */
function standingPlaces(w, boss, step = 16) {
  const v = boss.vars
  const out = []
  for (let x = v.ax0; x <= v.ax1 - MAXX_W; x += step) {
    if (x + MAXX_W > boss.x - 4 && x < boss.x + boss.w + 4) continue
    out.push({ x, y: v.floor, where: `floor ${x - v.ax0}` })
  }
  for (const c of makePlayer(w).catwalks) {
    for (const f of [0.1, 0.5, 0.9]) out.push({ x: Math.round(c.x0 + (c.x1 - c.x0 - MAXX_W) * f), y: c.top, where: `catwalk ${c.x0 - v.ax0}` })
  }
  return out
}

/** Play on from a start until the truck has been winded and is getting its breath back. '' if he came through untouched. */
function playOut(start, limit = 900) {
  const { w, boss, player, input } = start
  for (let i = 0; i < limit; i++) {
    const pips = w.player.pips
    stepWorld(w, input(player.decide()))
    w.events.length = 0
    player.observe()
    if (w.player.pips < pips) return `hit while it was ${boss.state} ${boss.stateT}, maxx at ${Math.round(w.player.x - boss.vars.ax0)}, ${Math.round(boss.vars.floor - w.player.y - w.player.h)} up`
    if (boss.state === 'recover') return ''
  }
  return `never got through (it is ${boss.state})`
}

/** One attack from one place, through the winded spell after it (so blobs it made have their go too). */
function dodgeOnce(attack, phase, side, place, opts) {
  return playOut(atTell(attack, phase, side, { ...place, opts }))
}

if (process.env.MZREC) {
  // The good player's buttons, tick by tick, and what the truck was doing, for replaying the fight in the viewer.
  const r = fight({ react: 12, record: true, seed: process.env.MZSEED ? Number(process.env.MZSEED) : 1 })
  const fs = await import('node:fs')
  fs.writeFileSync(process.env.MZREC, JSON.stringify({ inputs: r.inputs, start: r.start, washed: r.washed, clear: r.clear, hits: r.hits, phases: r.phases, log: r.log }))
  console.log(`recorded ${r.inputs.length} ticks, ${r.hits} hits, to ${process.env.MZREC}`)
  await t.finish()
  process.exit(0)
}

if (process.env.MZONE) {
  // One start, traced: MZONE="spin 3 1 floor 32" (attack, phase, side 1 = right end, where, x from
  // the arena's left edge); a fifth word 'nohover' takes the hover away.
  const [attack, phase, side, where, x, extra] = process.env.MZONE.split(' ')
  const probe = arena(5).boss
  const place = where === 'floor' ? { x: probe.vars.ax0 + Number(x), y: probe.vars.floor } : { x: probe.vars.ax0 + Number(x), y: probe.vars.floor - 96 }
  console.log('MZONE:', dodgeOnce(attack, Number(phase), Number(side), place, extra === 'nohover' ? { hover: false } : undefined) || 'untouched')
}
if (process.env.MZRUN) {
  // One whole run, traced: MZRUN="2 0 1 floor 96" (phase, run, side, where, x from the arena's left edge).
  const [phase, run, side, where, x] = process.env.MZRUN.split(' ')
  const probe = arena(5).boss
  const place = where === 'floor' ? { x: probe.vars.ax0 + Number(x), y: probe.vars.floor } : { x: probe.vars.ax0 + Number(x), y: probe.vars.floor - 96 }
  const start = atRun(Number(phase), Number(run), Number(side), place)
  console.log(`MZRUN: starts at world tick ${start.w.tick}:`, playOut(start, 1600) || 'untouched')
}

t.test('every attack, in every phase and from either end, can be dodged from anywhere it can find him when its telegraph starts', () => {
  const fails = []
  let runs = 0
  for (const attack of ATTACKS) {
    for (const phase of [1, 2, 3]) {
      for (const side of [1, -1]) {
        const probe = atTell(attack, phase, side, { x: 0, y: 0 })
        for (const place of standingPlaces(probe.w, probe.boss)) {
          runs++
          const r = dodgeOnce(attack, phase, side, place)
          if (r) fails.push(`${attack} p${phase} ${side > 0 ? 'R' : 'L'} from ${place.where}: ${r}`)
        }
      }
    }
  }
  if (LOG) for (const f of fails) console.log(`    ${f}`)
  t.notes.push(`dodge search: ${runs} starts (5 attacks x 3 phases x 2 ends x every 16 px of floor and 3 spots a catwalk), ${fails.length} hit`)
  t.ok(fails.length === 0, `hit in ${fails.length} of ${runs}:\n        ${fails.slice(0, 30).join('\n        ')}`)
})

t.test('and without the hover too: nothing needs it', () => {
  const fails = []
  let runs = 0
  for (const attack of ATTACKS) {
    for (const phase of [1, 2, 3]) {
      for (const side of [1, -1]) {
        const probe = atTell(attack, phase, side, { x: 0, y: 0 })
        for (const place of standingPlaces(probe.w, probe.boss, 32)) {
          runs++
          const r = dodgeOnce(attack, phase, side, place, { hover: false })
          if (r) fails.push(`${attack} p${phase} ${side > 0 ? 'R' : 'L'} from ${place.where}: ${r}`)
        }
      }
    }
  }
  if (LOG) for (const f of fails) console.log(`    ${f}`)
  t.notes.push(`dodge search without the hover: ${runs} starts (every 32 px of floor and 3 spots a catwalk), ${fails.length} hit`)
  t.ok(fails.length === 0, `hit in ${fails.length} of ${runs}:\n        ${fails.slice(0, 30).join('\n        ')}`)
})

t.test('whole runs of attacks, leftovers and all (waves still rolling into the next tell, blobs about during a hop), from anywhere', () => {
  const fails = []
  let runs = 0
  for (const phase of [1, 2, 3]) {
    const count = phase === 1 ? 3 : phase === 2 ? 2 : 3
    for (let run = 0; run < count; run++) {
      for (const side of [1, -1]) {
        const probe = atRun(phase, run, side, { x: 0, y: 0 })
        for (const place of standingPlaces(probe.w, probe.boss, 32)) {
          runs++
          const r = playOut(atRun(phase, run, side, place), 1600)
          if (r) fails.push(`run ${run} p${phase} ${side > 0 ? 'R' : 'L'} from ${place.where}: ${r}`)
        }
      }
    }
  }
  if (LOG) for (const f of fails) console.log(`    ${f}`)
  t.notes.push(`run search: ${runs} starts (every run of every phase, from either end, every 32 px of floor and 3 spots a catwalk), ${fails.length} hit`)
  t.ok(fails.length === 0, `hit in ${fails.length} of ${runs}:\n        ${fails.slice(0, 30).join('\n        ')}`)
})

let good = null
t.test('a good player (12 tick reactions) washes it without taking a hit, and the fight ends the level exactly once', () => {
  good = fight({ react: 12, events: true })
  const r = good
  t.notes.push(`good player: fight ${secs(r.washed - r.start)} s from the wake to the last drop, ${secs(r.clear - r.start)} s to the level clear; phase changes at ${r.phases.map((x) => secs(x - r.start)).join(' s, ')} s; ${r.hits} hits; plans ${r.player.stats.plans}, of them cornered ${r.player.stats.stuck}`)
  t.eq(r.status, 'clear', 'level status')
  t.eq(r.hits, 0, 'hits taken')
  t.eq(r.w.exit, 'goal', 'exit')
  t.eq(r.w.flags.mudzilla, 1, 'flag')
  t.eq(r.w.camBounds, null, 'camera lock after')
  t.eq(r.w.boss, null, 'boss bar after')
  const ev = r.events
  t.eq(ev.filter((e) => e.type === 'jingle' && e.id === 'clear').length, 1, 'clear jingles')
  t.eq(ev.filter((e) => e.type === 'versus').length, 1, 'versus cards')
  t.eq(ev.filter((e) => e.type === 'sfx' && e.id === 'bossDown').length, 1, 'bossDown sounds')
  t.ok(ev.some((e) => e.type === 'sfx' && e.id === 'honk'), 'a honk at the end')
  t.ok(ev.some((e) => e.type === 'banner' && e.text === 'SQUEAKY CLEAN!'), 'the banner')
  t.ok(ev.some((e) => e.type === 'fx' && e.fx === 'confetti'), 'confetti')
  // The finish is long and the clock stands still for it; then nothing more happens.
  t.ok(r.clear - r.washed >= MZ.fin.doneAt - 2, `finish ${r.clear - r.washed} ticks`)
  t.eq(r.timeAtWashed, r.timeAtClear, 'clock during the finish')
  const after = r.w.tick
  for (let i = 0; i < 120; i++) stepWorld(r.w, t.makeInput()([]))
  t.eq(r.w.tick, after, 'the world after the clear')
  t.eq(r.w.status, 'clear', 'status two seconds after')
  const len = (r.washed - r.start) / 60
  t.ok(len >= 110 && len <= 180, `fight length ${len.toFixed(1)} s (want two to three minutes)`)
})

t.test('it is the same fight every time: two runs of the good player match tick for tick', () => {
  const a = good ?? fight({ react: 12 })
  const b = fight({ react: 12 })
  t.eq(b.ticks, a.ticks, 'ticks')
  t.eq(b.hash, a.hash, 'final world hash')
})

t.test('standing still and spraying gets you hurt', () => {
  const r = fight({ still: true, god: true, limit: 60 * 60 * 3 })
  t.notes.push(`standing still: ${r.hits} hits in ${secs(r.ticks)} s with shine topped up; ${r.status === 'clear' ? 'it still washed it' : 'not washed'}`)
  const real = fight({ still: true, limit: 60 * 60 * 3 })
  t.notes.push(`standing still, for real: ${real.status} after ${secs(real.ticks - real.start)} s of fight`)
  t.ok(r.hits >= 3, `hits ${r.hits}`)
  t.eq(real.status, 'grimed', 'he should be grimed')
})

t.test('a clumsy player (25 tick reactions, sloppy hops, no room kept) can still win', () => {
  // Every one sees everything 25 ticks late, keeps no room round danger and hops a wave anything
  // from 0 to 8 ticks before it arrives (0 is too late). They differ in how they know a slam is
  // coming: A knows the rhythm of the rear-up, C waits for the hitch just before each slam, B only
  // jumps waves he has already seen (measured, not required).
  const clumsy = (seed, cue) => {
    const rnd = lcg(seed * 977)
    return { react: 25, pad: 0, lead: () => Math.floor(rnd() * 9), cue }
  }
  const tally = (cue) => {
    const lines = []
    let wins = 0
    let hits = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const god = fight({ ...clumsy(seed, cue), god: true })
      const real = fight(clumsy(seed, cue))
      hits += god.hits
      if (real.status === 'clear') wins++
      lines.push(`${god.hits}`)
      if (seed === 1) lines.push(`(fight ${secs(god.washed - god.start)} s; for real ${real.status === 'clear' ? `won with ${3 - real.hits} of 3 pips` : `${real.status} after ${secs(real.ticks - real.start)} s`})`)
    }
    return { wins, avg: (hits / 6).toFixed(1), lines }
  }
  const a = tally('timing')
  const c = tally('hitch')
  const b = tally('wave')
  t.notes.push(`clumsy player A (late, sloppy, knows the rhythm): ${a.avg} hits a fight on average, won ${a.wins} of 6; hits by seed ${a.lines.join(' ')}`)
  t.notes.push(`clumsy player C (late, sloppy, goes by the hitch): ${c.avg} hits a fight on average, won ${c.wins} of 6; hits by seed ${c.lines.join(' ')}`)
  t.notes.push(`clumsy player B (late, sloppy, only jumps waves he has seen): ${b.avg} hits a fight on average, won ${b.wins} of 6; hits by seed ${b.lines.join(' ')}`)
  t.ok(a.wins >= 5, `clumsy player A won only ${a.wins} of 6`)
  t.ok(c.wins >= 5, `clumsy player C won only ${c.wins} of 6`)
})

t.test('players who attack the weak spots: corner huggers, a catwalk camper, one who only sprays up', () => {
  // Shine topped up, so every hit over a whole fight (or three minutes) is counted.
  const lines = []
  const out = {}
  for (const [name, opts] of [
    ['hugs the left wall', { mode: 'left' }],
    ['hugs the right wall', { mode: 'right' }],
    ['camps on the catwalks', { mode: 'camper' }],
    ['only ever sprays up', { aimUp: true }],
    ['never hovers', { hover: false }],
  ].filter(([name]) => !process.env.MZWEAK || name.includes(process.env.MZWEAK))) {
    const r = fight({ react: 12, god: true, limit: 60 * 60 * 3, ...opts })
    out[name] = r
    lines.push(`${name}: ${r.hits} hits, ${r.status === 'clear' ? `washed it in ${secs(r.washed - r.start)} s` : `${Math.round(bossOf(r.w)?.hp ?? 0)} dirt left after ${secs(r.ticks - r.start)} s`}`)
  }
  t.notes.push(`weak-spot players (12 tick reactions, shine topped up): ${lines.join('; ')}`)
  for (const name of ['hugs the left wall', 'hugs the right wall', 'only ever sprays up', 'never hovers']) t.eq(out[name].hits, 0, `${name}: hits`)
  t.eq(out['only ever sprays up'].status, 'clear', 'the up-sprayer washes it')
  t.eq(out['never hovers'].status, 'clear', 'the one who never hovers washes it')
})

t.test('everything it throws costs one pip at a time, and water washes clods and globs out of the air', () => {
  for (const [kind, setup] of [
    ['mz_clod', (e, v) => (e.vars.floor = v.floor)],
    ['mz_glob', (e) => (e.vars.x1 = e.x)],
    ['mz_wave', () => {}],
    ['mz_fan', (e) => (e.vars.warn = 0)],
  ]) {
    const { w, boss } = arena()
    const v = boss.vars
    const input = t.makeInput()
    t.place(w, v.ax0 + 200, v.floor)
    t.steps(w, [], 3, input)
    const e = sim.spawn(w, kind, v.ax0 + 211, v.floor - (kind === 'mz_clod' || kind === 'mz_glob' ? 30 : 0))
    setup(e, v)
    for (let i = 0; i < 6 && w.player.pips === 3; i++) t.steps(w, [], 1, input)
    t.eq(w.player.pips, 2, `${kind}: pips after it hit him`)
    t.eq(w.status, 'play', `${kind}: still playing`)
  }
  const { w, boss } = arena()
  t.steps(w, [], 2)
  for (const kind of ['mz_clod', 'mz_glob']) {
    const e = sim.spawn(w, kind, boss.vars.ax0 + 300, 100)
    t.ok(t.spray(w, e) === true && e.dead, `${kind} washed away`)
  }
})

t.test('random play in the arena never breaks anything and is the same twice', () => {
  const run = () => {
    const { w } = arena(9)
    let s = 12345
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
    const input = t.makeInput()
    const ACTS = ['left', 'right', 'jump', 'spray', 'up', 'down']
    let held = ['right']
    let attempts = 0
    const hashes = []
    for (let i = 0; i < 9000; i++) {
      if (i % 9 === 0) held = i < 200 ? ['right'] : ACTS.filter(() => r() < 0.35)
      stepWorld(w, input(held))
      w.events.length = 0
      // Shine topped up so the fight goes on: only the fight is on trial here.
      if (w.status === 'play' && w.player.pips < 3) w.player.pips = 3
      for (const e of w.entities) {
        if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.hp)) throw new Error(`${e.kind} has a bad number at tick ${i}`)
      }
      if (w.status !== 'play') attempts++
      if (i % 500 === 0) hashes.push(worldHash(w))
    }
    return { hashes, attempts, boss: bossOf(w) }
  }
  const a = run()
  const b = run()
  t.eq(b.hashes.join(), a.hashes.join(), 'hashes of two runs')
  t.notes.push(`random play: 9000 ticks twice, identical; it ended ${a.boss ? `${a.boss.state}, ${Math.round(a.boss.hp)} dirt left` : 'washed'}`)
})

t.test('a retry from the checkpoint before the door, mid-fight: everything starts again from the top', () => {
  // Grimed half way through phase 2: the play scene retries with the checkpoint and the flags.
  const { w, boss } = arena()
  const input = t.makeInput()
  t.until(w, ['right'], () => boss.state !== 'sleep', 600, input)
  t.ok(w.checkpoint && w.checkpoint.x === 3 * TILE + TILE / 2, `the checkpoint before the door: ${JSON.stringify(w.checkpoint)}`)
  boss.vars.phase = 2
  boss.hp = 80
  t.until(w, [], () => w.status !== 'play', 3000, input)
  t.eq(w.status, 'grimed', 'he was grimed standing there')
  const again = createWorld(LEVEL, { session: t.freshSession(), seed: 1, checkpoint: w.checkpoint, flags: w.flags, tokens: w.stats.tokens })
  const b2 = bossOf(again)
  t.ok(b2, 'mudzilla is back')
  t.eq(b2.state, 'sleep', 'asleep')
  t.eq(b2.hp, 150, 'all its dirt')
  t.eq(b2.vars.phase, 1, 'the caked body')
  t.eq(again.camBounds, null, 'no camera lock')
  t.eq(again.boss, null, 'no boss bar')
  t.eq(t.all(again, 'mz_shutter').length, 0, 'no shutter')
  t.ok(Math.abs(again.player.x + MAXX_W / 2 - w.checkpoint.x) < 1, 'Maxx at the checkpoint')
  const seen = []
  t.until(again, ['right'], () => b2.state !== 'sleep', 600, t.makeInput(), seen)
  t.ok(t.has(seen, 'versus') && t.has(seen, 'music', (ev) => ev.id === 'boss'), 'the card and the song again')
  t.eq(t.all(again, 'mz_shutter').length, 1, 'the shutter again')
  t.ok(again.boss && again.boss.hp === 150, 'the boss bar again, full')
})

t.test('a retry after it was washed finds it gone', () => {
  const { w } = arena(1, { mudzilla: 1 })
  t.eq(bossOf(w), null, 'mudzilla with the flag set')
  const input = t.makeInput()
  t.until(w, ['right'], () => false, 500, input)
  t.eq(w.camBounds, null, 'no camera lock')
  t.eq(w.boss, null, 'no boss bar')
  t.eq(t.all(w, 'mz_shutter').length, 0, 'no shutter')
})

await t.finish()
