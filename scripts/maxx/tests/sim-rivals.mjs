// Rival fixes that cut across the slices: how high a rival's head can throw Maxx, and where a
// beaten Slick Ollie and Nimbus Nick come to rest.
//
//   node scripts/maxx/tests/sim-rivals.mjs [--only text]
//
// Sir Streaks changes the shape of his box between states (standing, a high dash lifted off the
// floor, a low dash or skid, stuck in the wall) with no real motion. Read as a rise, one of those
// re-poses under Maxx's feet used to throw him 2000 px into the sky. Here Maxx is dropped onto his
// head on the tick before each re-pose a fight really makes.
import { suite } from '../lib/testkit.mjs'

const t = await suite('sim-rivals')
const { sim, levels, contract } = t
const { TILE } = contract
const FLOOR_Y = 10 * TILE
const LEVEL_A = levels.levelById('dev-rivals-a')
const LEVEL_B = levels.levelById('dev-rivals-b')
const foeOf = (w, kind) => w.entities.find((e) => e.kind === kind && !e.dead)
const mid = (e) => e.x + e.w / 2

function arena(level, area, col, seed = 1) {
  return sim.createWorld(level, {
    session: t.freshSession(),
    checkpoint: { areaId: area, x: col * TILE + TILE / 2, y: FLOOR_Y },
    seed,
  })
}

/** Random input from a seed, held for a few ticks at a time (it keeps the fight moving about). */
function noise(seed) {
  let s = seed >>> 0
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  let held = []
  let left = 0
  return () => {
    if (left-- <= 0) {
      left = 4 + Math.floor(r() * 24)
      held = ['left', 'right', 'jump', 'spray'].filter(() => r() < 0.35)
    }
    return held
  }
}

/** From the world as it is, Maxx's feet 1 px over the rival's top, falling gently: what becomes of him. */
function dropOnHead(w0, dx) {
  const w = structuredClone(w0)
  const foe = foeOf(w, 'streaks')
  const p = w.player
  p.x = mid(foe) + dx - p.w / 2
  p.y = foe.y - 1 - p.h
  p.px = p.x
  p.py = p.y
  p.vx = 0
  p.vy = 60
  p.onGround = false
  p.jumping = false
  p.state = 'normal'
  p.invuln = 0
  p.pips = 3
  const input = t.makeInput()
  const out = { vy: 0, head: Infinity, hurt: -1, hurtIn: '', floor: -1, late: false, from: foe.state, to: '' }
  // Hands off: the hop is ours to check (never hurt, back on the floor soon) until his next dash,
  // or the end of the dash he changed shape for. Still in the air then, what that dash does to a
  // Maxx who never moves is the next attack's business; only how high he goes is watched on.
  let open = true
  for (let i = 0; i < 120; i++) {
    sim.stepWorld(w, input([]))
    w.events.length = 0
    const now = foeOf(w, 'streaks')
    if (i === 0) out.to = now.state
    else if (open && (out.to === 'dash' ? now.state !== 'dash' : now.state === 'dash')) open = false
    if (!open) out.late = true
    out.vy = Math.min(out.vy, p.vy)
    out.head = Math.min(out.head, p.y - w.camera.y)
    if (p.state === 'hurt' || p.pips < 3) {
      if (open) {
        out.hurt = i
        out.hurtIn = now.state
      }
      break
    }
    if (p.onGround && p.y + p.h >= FLOOR_Y - 0.5) {
      if (open) out.floor = i
      break
    }
  }
  return out
}

t.test("streaks: changing shape under Maxx's feet (high dash, skid to turn, slamming into the wall) hops him off like any head, never into the sky", () => {
  const found = new Map()
  const bad = []
  let worst = 0
  let late = 0
  // Full shine and phase 1 (two dashes a round, so some stop short and skid), from both ends.
  for (const [share, col, seed] of [[1, 3, 1], [1, 9, 2], [0.6, 9, 3], [0.6, 4, 4], [0.6, 12, 5], [0.3, 9, 6]]) {
    const w = arena(LEVEL_A, 'streaks', col, seed)
    const foe = foeOf(w, 'streaks')
    foe.hp = Math.round(foe.maxHp * share)
    const input = t.makeInput()
    const pad = noise(seed * 7919)
    for (let i = 0; i < 60 * 70; i++) {
      w.player.pips = 3
      w.player.invuln = 99
      sim.stepWorld(w, input(pad()))
      w.events.length = 0
      if (w.status !== 'play') break
      if (!['dashTell', 'dash', 'skid', 'stuck'].includes(foe.state)) continue
      // Does the next tick raise his top with no input from Maxx? Then drop Maxx on it now.
      const peek = structuredClone(w)
      sim.stepWorld(peek, t.makeInput()([]))
      const next = foeOf(peek, 'streaks')
      if (next.y > foe.y - 12) continue
      for (const dx of [-8, 0, 8]) {
        const r = dropOnHead(w, dx)
        const key = `${r.from} -> ${r.to}`
        found.set(key, (found.get(key) ?? 0) + 1)
        worst = Math.min(worst, r.vy)
        if (r.late) late++
        if (r.vy < -(260 + 400) || r.head < 0 || r.hurt >= 0 || (!r.late && (r.floor < 0 || r.floor > 60))) {
          bad.push(`${key} (tick ${w.tick}, dx ${dx}): vy ${Math.round(r.vy)}, head ${Math.round(r.head)} px from the top of the picture, hurt at ${r.hurt} (${r.hurtIn}), on the floor at ${r.floor}`)
        }
      }
    }
  }
  const kinds = [...found.keys()]
  const badBy = (k) => bad.filter((b) => b.startsWith(k + ' (')).length
  t.notes.push(`streaks re-poses met (drops gone wrong): ${kinds.map((k) => `${k} x${found.get(k)} (${badBy(k)})`).join(', ')}; the fastest hop off was vy ${Math.round(worst)}; ${late} hands-off drops were still in the air when his next dash came`)
  for (const want of ['dashTell -> dash', 'skid -> turn', 'dash -> stuck']) t.ok(kinds.includes(want), `no ${want} re-pose was met (met: ${kinds.join(', ')})`)
  t.eq(bad.length, 0, `${bad.length} drops went wrong: ${bad.slice(0, 6).join('; ')}`)
})

/** A rival in the dev arenas washed on the spot where he stands: what he does next, tick by tick. */
function beatAt(kind, area, setUp) {
  const w = arena(LEVEL_B, area, 9)
  const input = t.makeInput()
  t.until(w, [], (ww) => foeOf(ww, kind)?.state === 'intro', 200, input)
  t.steps(w, [], 100, input)
  const foe = foeOf(w, kind)
  setUp(foe)
  foe.hp = 1
  foe.vars.soak = 0
  const p = w.player
  p.invuln = 999
  t.spray(w, foe, 2)
  t.eq(foe.state, 'beaten', `${kind} washed out`)
  const trail = []
  for (let i = 0; i < 150; i++) {
    sim.stepWorld(w, input([]))
    w.events.length = 0
    trail.push(mid(foe))
  }
  return { w, foe, trail }
}

function restsClear(kind, r, label) {
  const { w, foe, trail } = r
  const v = foe.vars
  const cx = mid(foe)
  t.ok(cx >= v.ax0 + 4 * TILE - 1 && cx <= v.ax1 - 4 * TILE + 1, `${label}: his middle ${Math.round(cx)} is 4 tiles from both walls (${v.ax0}..${v.ax1})`)
  const door = foeOf(w, 'door')
  t.ok(foe.x + foe.w + 12 < door.x || foe.x > door.x + door.w + 12, `${label}: box ${Math.round(foe.x)}..${Math.round(foe.x + foe.w)} is in front of the door ${door.x}..${door.x + door.w}`)
  t.ok(foe.z < 0, `${label}: drawn behind Maxx and the door (z ${foe.z})`)
  t.eq(trail[trail.length - 1], trail[trail.length - 31], `${label}: he has come to rest`)
  return trail.findIndex((x) => x === trail[trail.length - 1])
}

t.test('ollie: beaten against either wall, he slides out clear of the walls and the door, behind Maxx, feet on the floor', () => {
  for (const side of [-1, 1]) {
    const r = beatAt('ollie', 'ollie', (o) => {
      o.vars.stage = 2
      o.state = 'refill'
      o.stateT = 30
      o.facing = side
      o.x = side > 0 ? o.vars.ax1 - o.w : o.vars.ax0
      o.y = o.vars.floor - o.h
    })
    restsClear('ollie', r, `ollie at the ${side > 0 ? 'right' : 'left'} wall`)
    t.near(r.foe.y + r.foe.h, FLOOR_Y, 0.5, 'feet on the floor')
    t.eq(r.foe.w, 44, 'sitting, standing box')
  }
  // Beaten in the open he stays where he is.
  const r = beatAt('ollie', 'ollie', (o) => {
    o.vars.stage = 2
    o.state = 'burp'
    o.stateT = 5
    o.x = 300 - o.w / 2
  })
  t.eq(r.trail[0], 300, 'beaten mid-floor, he does not move')
})

t.test('nick: rained out in a corner, he drifts clear of the walls and the door before his rainbow shows, behind Maxx', () => {
  for (const side of [-1, 1]) {
    const r = beatAt('nick', 'nick', (n) => {
      n.vars.stage = 3
      n.state = 'puff'
      n.stateT = 10
      n.vars.cx = side > 0 ? n.vars.ax1 - 16 : n.vars.ax0 + 16
      n.vars.cy = n.vars.floor - 34
    })
    const at = restsClear('nick', r, `nick at the ${side > 0 ? 'right' : 'left'} wall`)
    // The rainbow fades in after 40 ticks, standing where he is: it must not slide in.
    t.ok(at >= 0 && at < 40, `${side > 0 ? 'right' : 'left'}: he got there at tick ${at}, before the rainbow shows`)
  }
})

await t.finish()
