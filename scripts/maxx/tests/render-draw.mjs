// What the world renderer and the HUD put on screen, run in Node: the real renderers, the real
// atlases (frames only, no pixels) and a canvas that only listens. Every sprite drawn is logged
// by name and place, and every drawImage and fillRect by where it lands.
//
//   the boss bar's face: each rival his own, the mud bosses the clod
//   frames between two ticks on a screen faster than 60 Hz (render/clock.ts): left alone nothing
//   changes; given part of a tick, the camera, Maxx, entities, droplets, particles and the hover
//   meter all slide back by it together; paused, frozen, teleported or drawn by a tool, nothing
//   slides; and a 75 Hz screen no longer shows the same picture every fifth frame
//
//   node scripts/maxx/tests/render-draw.mjs [--only <text>]
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { suite } from '../lib/testkit.mjs'
import { GAME_DIR } from '../paths.mjs'

const GAME = path.join(GAME_DIR, 'game')

/** Every drawImage and fillRect on a listening context: [what, x, y, fillStyle]. */
const raw = []
// A 2D context that keeps what is set on it and swallows every call; enough for the text
// module's glyph masks and the tile layer's chunks. `listen` logs into raw.
function quietContext(listen = false) {
  const state = { globalAlpha: 1, imageSmoothingEnabled: false, fillStyle: '' }
  const noop = () => {}
  return new Proxy(state, {
    get(s, k) {
      if (k in s) return s[k]
      if (k === 'createImageData' || k === 'getImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
      if (k === 'measureText') return () => ({ width: 0 })
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop: noop })
      if (listen && k === 'drawImage') return (...a) => raw.push(['img', a.length > 5 ? a[5] : a[1], a.length > 5 ? a[6] : a[2], ''])
      if (listen && k === 'fillRect') return (x, y) => raw.push(['rect', x, y, s.fillStyle])
      return noop
    },
    set(s, k, v) {
      s[k] = v
      return true
    },
  })
}
globalThis.document = { createElement: () => ({ width: 0, height: 0, addEventListener() {}, getContext: () => quietContext() }) }

const t = await suite('render-draw')
const { buildSprites } = await t.loadModule('engine/sprites.ts')
const { createWorldRenderer } = await t.loadModule('render/world.ts')
const { createHud } = await t.loadModule('render/hud.ts')
const { getRendererEntry } = await t.loadModule('render/registry.ts')
const { frameClock, LERP_MAX } = await t.loadModule('render/clock.ts')
const { MZ } = await t.loadModule('sim/entities/mudzilla.ts')
const { MAXX_W, MAXX_H, DT } = t.contract
const { TUNING } = t.sim

const atlases = []
for (const f of readdirSync(path.join(GAME, 'assets')).filter((f) => f.endsWith('.atlas.ts'))) atlases.push((await t.loadModule('assets/' + f)).atlas)
const hudAtlas = atlases.find((a) => a.name === 'hud')
const sheet = { width: 1, height: 1 }
const log = []
/** The game's own Sprites over every atlas, logging each draw. `drop`: hud frames to leave out. */
function makeSprites(drop = []) {
  const defs = atlases.map((def) => (def.name === 'hud' && drop.length ? { ...def, frames: Object.fromEntries(Object.entries(def.frames).filter(([n]) => !drop.includes(n))) } : def))
  const s = buildSprites(defs.map((def) => ({ def, image: sheet })))
  const real = s.draw
  s.draw = (g, name, x, y, o) => {
    log.push({ name, x: Math.round(x), y: Math.round(y) })
    real(g, name, x, y, o)
  }
  return s
}
const sprites = makeSprites()
const g = quietContext(true)
const drawn = (pred) => log.filter((d) => pred(d.name))
const lastOf = (pred) => drawn(pred).pop() ?? null
const isMaxx = (n) => n.startsWith('maxx/') && n !== 'maxx/head'
/** Where a body is drawn `back` of the way back to where it was at the tick before. */
const at = (x, px, back) => Math.round(x - (x - px) * back)

/** A world, its renderer and HUD, stepped as the play scene steps them, the shell's clock kept as the shell keeps it. */
function rig(rows = ['  @']) {
  const w = t.flat(rows)
  const r = createWorldRenderer(sprites, { shake: false })
  const hud = createHud(sprites)
  r.reset(w)
  hud.reset(w)
  const input = t.makeInput()
  const step = (held = []) => {
    frameClock.tick++
    t.sim.stepWorld(w, input(held))
    for (const ev of w.events) r.event(ev, w)
    w.events.length = 0
    r.update(w)
    hud.update(w)
  }
  /**
   * One display frame `alpha` of a tick past the last: what was drawn, as one string. Drawn a few
   * times and the last kept: the text module draws a line glyph by glyph until it has seen it
   * KEEP_AFTER times (engine/text.ts), and a picture must not differ by that.
   */
  const draw = (alpha = 1) => {
    frameClock.alpha = alpha
    for (let i = 0; i < 4; i++) {
      log.length = 0
      raw.length = 0
      r.draw(g, w)
      hud.draw(g, w)
    }
    frameClock.alpha = 1
    return JSON.stringify([log, raw])
  }
  return { w, r, hud, step, draw }
}

/** Run right until the camera scrolls with him at full speed. */
function running(rows = ['  @']) {
  const k = rig(rows)
  for (let i = 0; i < 120; i++) k.step(['right'])
  t.ok(k.w.player.x - k.w.player.px > 3 && k.w.camera.x > 0, 'he is running and the camera is following')
  return k
}

/* ------------------------------------------------------------------ */
/* The face on the boss bar                                            */
/* ------------------------------------------------------------------ */

// The names the fights hand setBoss(), read from the sim, so a renamed rival shows here.
const nameIn = (file) => readFileSync(path.join(GAME, 'sim', 'entities', file + '.ts'), 'utf8').match(/const NAME = '([^']+)'/)?.[1]
const rivalNames = ['rival_bill', 'rival_streaks', 'rival_ollie', 'rival_nick'].map(nameIn)
const mudslinger = nameIn('mudslinger')

/** The hud frames drawn beside the boss bar once a fight called `name` has its bar up. */
function barFace(name, s = sprites) {
  const w = t.flat(['  @'])
  const hud = createHud(s)
  hud.reset(w)
  w.boss = { name, hp: 10, maxHp: 10 }
  for (let i = 0; i < 12; i++) hud.update(w)
  log.length = 0
  hud.draw(g, w)
  return drawn((n) => n.startsWith('hud/boss')).map((d) => d.name)
}

t.test('each rival has his own face on the boss bar, drawn in the hud atlas', () => {
  t.eq(rivalNames.filter(Boolean).length, 4, `the four rival names (${rivalNames})`)
  const faces = new Set()
  for (const name of rivalNames) {
    const face = barFace(name)
    t.eq(face.length, 1, `one face beside ${name}`)
    t.ok(face[0] !== 'hud/boss', `${name} is not given the mud clod`)
    const f = hudAtlas.frames[face[0].slice(4)]
    t.ok(f && f.w === 16 && f.h === 16, `${face[0]} is a 16x16 frame of the hud atlas`)
    faces.add(face[0])
  }
  t.eq(faces.size, 4, 'four different faces')
})

t.test('the mud bosses, and a fight nobody drew a face for, keep the clod', () => {
  t.ok(!!mudslinger, 'the Mudslinger name was found')
  t.eq(barFace(mudslinger).join(), 'hud/boss', mudslinger)
  t.eq(barFace(MZ.name).join(), 'hud/boss', MZ.name)
  t.eq(barFace('SOMEBODY NEW').join(), 'hud/boss', 'an unknown fight')
  t.eq(barFace(rivalNames[1], makeSprites(['bossStreaks'])).join(), 'hud/boss', 'an atlas without the frame falls back to the clod')
})

t.test('the face changes with the fight, and a reset starts from the clod', () => {
  const w = t.flat(['  @'])
  const hud = createHud(sprites)
  hud.reset(w)
  const face = () => {
    log.length = 0
    hud.draw(g, w)
    return drawn((n) => n.startsWith('hud/boss')).map((d) => d.name).join()
  }
  const fight = (boss) => {
    w.boss = boss
    for (let i = 0; i < 12; i++) hud.update(w)
    return face()
  }
  const first = fight({ name: rivalNames[0], hp: 10, maxHp: 10 })
  t.eq(fight(null), '', 'the bar slides away between fights')
  const second = fight({ name: rivalNames[1], hp: 10, maxHp: 10 })
  t.ok(first && second && first !== second, `Bill's face, then Sir Streaks's (${first}, ${second})`)
  hud.reset(w)
  t.eq(fight({ name: mudslinger, hp: 10, maxHp: 10 }), 'hud/boss', 'after a reset the mud boss has the clod')
})

/* ------------------------------------------------------------------ */
/* Frames between two ticks                                            */
/* ------------------------------------------------------------------ */

t.test('left alone (alpha 1), the picture is the last tick exactly', () => {
  const k = running()
  const { w } = k
  const p = w.player
  const plain = k.draw(1)
  const m = lastOf(isMaxx)
  t.eq(m.x, Math.round(p.x) - Math.round(w.camera.x) + MAXX_W / 2, 'Maxx where his box is')
  t.eq(m.y, Math.round(p.y) - Math.round(w.camera.y) + MAXX_H, 'Maxx at his feet')
  t.eq(k.r.stats().camX, Math.round(w.camera.x), 'the camera where the simulation put it')
  frameClock.tick += 1000
  t.eq(k.draw(1), plain, 'the same picture whatever the shell tick')
  frameClock.tick -= 1000
})

t.test('between ticks the camera, Maxx and every awake entity slide back by the same part of a tick', () => {
  // Blobs far ahead, walking: on screen and awake by the time the camera has come along.
  const k = running(['  @                       b    b'])
  const { w } = k
  const p = w.player
  const camWas = w.camera.x
  k.step(['right'])
  const cam = w.camera.x
  const blobs = w.entities.filter((e) => e.kind === 'blob' && e.active && !e.dead)
  t.ok(blobs.some((e) => e.x !== e.px), `a blob is walking on screen (${blobs.length} awake)`)
  // What each blob's renderer is shown: its box's left edge on screen through rc.camX.
  const entry = getRendererEntry(blobs[0])
  const real = entry.draw
  const seen = new Map()
  entry.draw = (gg, e, rc) => {
    seen.set(e, Math.round(e.x) - rc.camX)
    real(gg, e, rc)
  }
  try {
    for (const a of [0, 0.3, 0.5, 0.9]) {
      const back = 1 - a
      seen.clear()
      k.draw(a)
      const camX = at(cam, camWas, back)
      t.eq(k.r.stats().camX, camX, `alpha ${a}: the camera`)
      const m = lastOf(isMaxx)
      t.eq(m.x, at(p.x, p.px, back) - camX + MAXX_W / 2, `alpha ${a}: Maxx across`)
      t.eq(m.y, at(p.y, p.py, back) - Math.round(w.camera.y) + MAXX_H, `alpha ${a}: Maxx down`)
      for (const e of blobs) t.eq(seen.get(e), at(e.x, e.px, back) - camX, `alpha ${a}: blob ${e.id} by its own step`)
    }
  } finally {
    entry.draw = real
  }
})

t.test('the hover meter stays over his head between ticks', () => {
  const k = rig()
  for (let i = 0; i < 20; i++) k.step()
  for (let i = 0; i < 8; i++) k.step(['jump', 'right'])
  let hovering = false
  for (let i = 0; i < 60 && !hovering; i++) {
    k.step(['down', 'spray', 'right'])
    hovering = k.w.player.hovering
  }
  t.ok(hovering, 'he hovers')
  k.step(['down', 'spray', 'right'])
  const gaps = []
  for (const a of [1, 0.1, 0.5, 0.8]) {
    k.draw(a)
    gaps.push(lastOf((n) => n === 'hud/drop').x - lastOf(isMaxx).x)
  }
  t.eq(new Set(gaps).size, 1, `the meter keeps its place over him (${gaps})`)
})

t.test('droplets slide along their flight, and one just fired stays on the nozzle', () => {
  const k = running()
  const { w } = k
  // One droplet every other tick: stop on a tick that fired one.
  const isFresh = (d) => d.life === TUNING.dropletLife
  for (let i = 0; i < 24 && (i < 20 || !w.droplets.some(isFresh)); i++) k.step(['spray', 'right'])
  const p = w.player
  const fresh = w.droplets.find(isFresh)
  const old = w.droplets.find((d) => d.life < TUNING.dropletLife - 3)
  t.ok(fresh && old, 'droplets old and new')
  // The head of each droplet is the last pass, in white, starting on the point itself.
  const heads = () => raw.filter((r) => r[0] === 'rect' && r[3] === '#f7f4f8')
  for (const a of [0.25, 0.75]) {
    const back = 1 - a
    k.draw(a)
    const camX = k.r.stats().camX
    const camY = k.r.stats().camY
    const wantOld = [at(old.x, old.x - old.vx * DT, back) - camX - 1, at(old.y, old.y - old.vy * DT, back) - camY - 1]
    t.ok(heads().some(([, x, y]) => x === wantOld[0] && y === wantOld[1]), `alpha ${a}: an older droplet back along its flight, at ${wantOld}`)
    const slid = Math.round(p.x) - at(p.x, p.px, back)
    const wantNew = [Math.round(fresh.x) - camX - slid - 1, Math.round(fresh.y) - camY - 1]
    t.ok(heads().some(([, x, y]) => x === wantNew[0] && y === wantNew[1]), `alpha ${a}: one just fired stays at the nozzle he is drawn with, at ${wantNew}`)
  }
})

t.test('particles and popups move on between updates, even with the world held still', () => {
  const k = rig()
  for (let i = 0; i < 10; i++) k.step()
  k.r.fx('debris', 200, 200, 3, 1)
  k.r.popup('500', 300, 200)
  for (let i = 0; i < 2; i++) {
    frameClock.tick++
    k.r.update(k.w)
    k.hud.update(k.w)
  }
  const now = k.draw(1)
  t.ok(k.draw(0.2) !== now, 'between updates the chunks and the popup are drawn on their way')
  frameClock.tick++
  t.eq(k.draw(0.2), now, 'a shell tick with no update (paused): where they are')
  frameClock.tick--
})

t.test('nothing slides when paused, frozen, teleported or drawn by a tool', () => {
  const k = running()
  const { w } = k
  k.step(['right'])
  const tick = k.draw(1)
  t.ok(k.draw(0.5) !== tick, 'it slides in the shell tick of the update')
  frameClock.tick++
  t.eq(k.draw(0.5), tick, 'paused (a shell tick with no update): the last tick as it is')
  frameClock.tick--
  w.tick++
  const tool = k.draw(0.5)
  w.tick--
  t.eq(tool, tick, 'a world stepped by hand since the update: as it is')
  // Updated, but the world did not step (a versus card, the clear walk, a pipe trip).
  frameClock.tick++
  k.r.update(w)
  k.hud.update(w)
  t.eq(k.draw(0.5), k.draw(1), 'a world that did not step in the update: nothing slides')
  // A body put somewhere (more than LERP_MAX in one tick) is drawn where it is.
  k.step(['right'])
  const p = w.player
  p.px = p.x - LERP_MAX - 8
  k.draw(1)
  const whole = lastOf(isMaxx).x + k.r.stats().camX
  k.draw(0.3)
  t.eq(lastOf(isMaxx).x + k.r.stats().camX, whole, 'a teleport is not slid across')
})

t.test('a 75 Hz screen: the picture moves on every display frame instead of stopping every fifth', () => {
  const STEP = 1000 / 60
  // The shell's loop as it is (a 0.5 ms slop, at most 5 ticks a frame), on 75 Hz frames.
  const frames = (between) => {
    const k = running()
    let acc = 0
    const cams = []
    const xs = []
    for (let f = 0; f < 45; f++) {
      acc += 1000 / 75
      let n = 0
      while (acc >= STEP - 0.5 && n < 5) {
        k.step(['right'])
        acc -= STEP
        n++
      }
      // Drawing only on ticks, a frame with none shows the picture already there.
      if (!between && n === 0) {
        cams.push(cams[cams.length - 1])
        xs.push(xs[xs.length - 1])
        continue
      }
      k.draw(between ? Math.min(1, Math.max(0, acc / STEP)) : 1)
      cams.push(k.r.stats().camX)
      xs.push(lastOf(isMaxx).x + k.r.stats().camX)
    }
    const d = (v) => v.slice(1).map((x, i) => x - v[i])
    return { cam: d(cams), maxx: d(xs) }
  }
  const before = frames(false)
  const after = frames(true)
  t.ok(before.cam.filter((v) => v === 0).length >= 8, `drawn only on ticks, the scroll stops every fifth frame (${before.cam})`)
  t.eq(after.cam.filter((v) => v === 0).length, 0, `drawn between ticks, the scroll never stops (${after.cam})`)
  t.eq(after.maxx.filter((v) => v === 0).length, 0, `nor does Maxx (${after.maxx})`)
  t.ok(Math.max(...after.cam) - Math.min(...after.cam) <= 1, `and every frame's step is about the same (${after.cam})`)
})

await t.finish()
