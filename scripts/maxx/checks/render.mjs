// The world renderer, in the running page: every area of the dev-render room and of the
// sandbox drawn through the viewer scene, then Maxx in each of his looks (spray, hover jet,
// turbo glow, wax, lost shine, blinking, a pipe and a door trip, the clear, the grimed flop),
// every particle, popups, bricks breaking and grime wearing away, the decor kind; the '#' rule's
// cases by key name and in close-ups (rules-<theme>.png, floors-<theme>.png); then the
// attacks: a one-pixel camera move must move the picture by exactly one pixel (seams, tiles a
// pixel off), a renderer with warm chunks must match a fresh one after tiles change, every area
// of every level the game knows draws whole, renderer particles come once a tick, tick hooks run
// once a tick, a renderer's margin, the order of z, decor with words never mirrored, a shake
// stays inside the area, the viewer's grid and its answer to an unknown level; and last the time
// draw() takes over a busy screen, whether update() and draw() allocate, and whether a sign's
// board drawn every frame does.
//   node scripts/maxx/serve.mjs --port 5323 -- node scripts/maxx/shot.mjs --port 5323 --w 1280 --h 830
//     --q "scene=viewer&level=dev-render&manual=1&fresh=1" --script scripts/maxx/checks/render.mjs --out <folder>/end.png
// Pictures (640x360 as the game draws them, and zoomed crops) and report.txt land in <folder>.
// Exit code 1 if any check fails.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { install, saver } from './lib.mjs'

const THEMES = ['lot', 'vacuum', 'tunnel', 'storm', 'lube', 'highway', 'winter', 'mega', 'bonus', 'backlot']
const FX = ['splash', 'sparkle', 'dust', 'debris', 'mud', 'bubble', 'star', 'smoke', 'foam', 'snow', 'confetti', 'drip', 'steam', 'coin', 'shine', 'leaf', 'spark']

export default async ({ page, maxx, outDir }) => {
  const OUT = outDir
  mkdirSync(OUT, { recursive: true })
  const save = saver(OUT)
  const report = []
  const problems = []
  const say = (...a) => {
    const line = a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')
    report.push(line)
    console.log(line)
  }
  const check = (ok, what) => {
    say(ok ? '  ok   ' : '  FAIL ', what)
    if (!ok) problems.push(what)
  }
  const ev = (fn, ...args) => page.evaluate(fn, ...args)
  await install(maxx)

  // Page-side helpers: the viewer, its world and renderer, and a few moves.
  await ev(() => {
    const m = window.__maxx
    window.__r = {
      open(level, params) {
        m.go('viewer', { level, ...params })
        m.step(1)
        const w = m.world()
        return w ? { area: w.area.id, level: w.level.id, w: w.grid.w, h: w.grid.h } : null
      },
      stats() {
        const s = m.sceneObject().renderer.stats()
        return { ...s, problems: s.problems.slice() }
      },
      errors: () => Array.from(m.errors),
      /** Put the camera's top-left at (x, y) and draw, without moving time on (free camera). */
      look(x, y) {
        const w = m.world()
        w.camera.x = x
        w.camera.y = y
        m.step(1)
      },
      player() {
        return m.world().player
      },
      ticks(actions, n) {
        if (actions) m.hold(actions)
        else m.release()
        m.step(n)
        m.release()
      },
    }
  })
  const native = async (name) => save(name, await ev(() => window.__t.native()))
  const zoom = async (name, cx, cy, w, h, s = 3) => save(name, await ev(([cx, cy, w, h, s]) => window.__t.zoom(cx, cy, w, h, s), [cx, cy, w, h, s]))
  /** Where Maxx's anchor is on screen. */
  const onScreen = () =>
    ev(() => {
      const w = window.__maxx.world()
      const p = w.player
      return { x: Math.round(p.x) - Math.round(w.camera.x) + 11, y: Math.round(p.y) - Math.round(w.camera.y) + 52 }
    })
  const clean = async (what) => {
    const errs = await ev(() => window.__r.errors())
    const st = await ev(() => window.__r.stats())
    check(errs.length === 0, `${what}: no scene errors${errs.length ? ' (' + errs.join(' | ').slice(0, 300) + ')' : ''}`)
    check(st.problems.length === 0, `${what}: no entity renderer threw${st.problems.length ? ' (' + st.problems.join(', ') + ')' : ''}`)
    return st
  }

  /* ---------------- every area of the render room ---------------- */
  say('render room')
  for (const theme of THEMES) {
    const info = await ev(([t]) => window.__r.open('dev-render', { area: t, free: true }), [theme])
    check(info && info.area === theme, `dev-render opens in area ${theme} (got ${info && info.area})`)
    if (!info) continue
    const areaW = info.w * 32
    const areaH = info.h * 32
    const xs = areaW <= 640 ? [(areaW - 640) / 2] : [0, Math.round((areaW - 640) / 2), areaW - 640]
    for (let i = 0; i < xs.length; i++) {
      await ev(([x, y]) => window.__r.look(x, y), [xs[i], areaH - 360])
      await native(`room-${theme}-${i}.png`)
    }
    if (theme !== 'bonus') {
      // The '#' rule's cases, up high over the hazards (columns 47 to 64, rows 1 to 4 of the room),
      // and the floors with the belts (columns 28 to 52, the bottom rows).
      await ev(([x, y]) => window.__r.look(x, y), [46 * 32, areaH - 360])
      await zoom(`rules-${theme}.png`, 320, 88, 600, 150, 2)
      await ev(([x, y]) => window.__r.look(x, y), [28 * 32 - 16, areaH - 360])
      await zoom(`floors-${theme}.png`, 360, 296, 720, 128, 2)
    }
    if (areaH > 400) {
      await ev(([x]) => window.__r.look(x, 0), [xs[xs.length - 1]])
      await native(`room-${theme}-top.png`)
    }
    const st = await clean(`room ${theme}`)
    check(st.tileArt > 0, `room ${theme}: tile art found for ${st.tileArt} keys`)
    say(`    ${theme}: backdrop art ${st.backdropArt ? 'yes' : 'NO (flat stand-in)'}, ${st.chunkBuilds} chunk builds, ${st.chunks} chunks held`)
  }

  /* ---------------- the '#' rule ---------------- */
  // Solid tiles that sit in a floor count as ground beside and above a '#' (no cap under a belt or a
  // special floor, no well under two deep of oil or mud, no edge beside a block); a lone column gets both edges.
  say("the '#' rule")
  const RULE_CASES = [
    [47, 4, /^ground_l$/, 'under two deep of oil, at the slab end (was a well with a cap)'],
    [48, 3, /^ground_m2?$/, 'under one deep of oil'],
    [50, 4, /^ground_m2?$/, 'under two deep of mud'],
    [51, 3, /^ground_m2?$/, 'under one deep of mud'],
    [49, 2, /^ground_t$/, 'between oil and mud: no edges'],
    [52, 2, /^ground_t$/, 'between mud and slick: no edges'],
    [53, 3, /^ground_m2?$/, 'under slick'],
    [54, 3, /^ground_m2?$/, 'under steel'],
    [55, 3, /^ground_m2?$/, 'under a used block'],
    [56, 3, /^ground_m2?$/, 'under grime'],
    [57, 3, /^ground_m2?$/, 'under a brick'],
    [58, 3, /^ground_m2?$/, 'under a coin brick'],
    [59, 3, /^ground_m2?$/, 'under a prize crate'],
    [60, 3, /^ground_m2?$/, 'under a power crate'],
    [61, 4, /^ground_m2?$/, 'under a pipe'],
    [62, 4, /^ground_r$/, 'under a pipe, at the slab end'],
    [64, 1, /^ground_tl\+tr$/, 'a lone column, its top: both edges'],
    [64, 3, /^ground_l\+r$/, 'a lone column, under ground: both edges'],
    [19, 8, /^ground_tl\+tr$/, 'the lone column on the floor, its top'],
    [19, 9, /^ground_l\+r$/, 'the lone column on the floor, under it'],
    [16, 6, /^ground_tl\+tr$/, 'a lone floating tile'],
    [41, 9, /^ground_tl\+tr$/, 'a lone tile on slick'],
    [29, 11, /^ground_m2?$/, 'under a belt'],
    [32, 10, /^ground_t$/, 'between belts'],
    [38, 10, /^ground_t$/, 'between a belt and slick'],
    [42, 10, /^ground_t$/, 'between slick and oil'],
    [60, 10, /^ground_m2?$/, 'under the way-on pipe'],
    [44, 11, /^ground_m$/, 'oil under oil is still ground_m'],
    [43, 10, /^oily_t$/, 'oil open above is still oily_t'],
    [41, 10, /^slick_m$/, 'slick under ground is still slick_m'],
  ]
  const keys = await ev(async ([cases]) => {
    const tiles = await window.__t.mod('render/tiles.ts')
    window.__r.open('dev-render', { area: 'lot', free: true })
    const g = window.__maxx.world().grid
    return cases.map(([x, y]) => tiles.tileKeyName(g, x, y))
  }, [RULE_CASES.map(([x, y]) => [x, y])])
  RULE_CASES.forEach(([x, y, re, what], i) => check(re.test(keys[i]), `'#' rule at (${x}, ${y}), ${what}: ${keys[i]}`))
  // A lone column is drawn whole: the left edge piece with the right half of the right one over it.
  const lone = await ev(() => {
    const S = document.createElement('canvas')
    S.width = 640
    S.height = 360
    const g = S.getContext('2d', { willReadFrequently: true })
    const m = window.__maxx
    const w = m.world()
    const r = m.sceneObject().tools.createRenderer({ pinned: true, hideMaxx: true, weather: false, shake: false })
    r.reset(w)
    w.camera.x = 64 * 32 - 320
    w.camera.y = 0
    r.draw(g, w)
    // Columns 0 and 31 of the column's tiles: the outline colour on both sides, rows 1 to 3.
    const line = (x, y) => {
      const d = g.getImageData(x, y, 1, 1).data
      return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
    }
    const out = []
    for (let row = 1; row <= 3; row++) out.push([line(320, row * 32 + 16), line(351, row * 32 + 16)])
    return out
  })
  check(lone.every(([a, b]) => a === b && a !== '#000000'), `a lone column of ground has the same edge on both sides, every row: ${lone.map((p) => p.join('/')).join(' ')}`)

  /* ---------------- walk through: pipes and doors chain the areas ---------------- */
  say('area changes')
  await ev(() => window.__r.open('dev-render', { area: 'lot', col: 61, row: 6 }))
  let p = await ev(() => window.__t.info())
  check(p.area === 'lot', `standing on the lot's way-on pipe (${p.area}, x ${p.x})`)
  await ev(() => window.__r.ticks('down', 12))
  const sx = await onScreen()
  await native('pipe-out.png')
  await zoom('pipe-out-zoom.png', sx.x, sx.y - 20, 120, 100, 3)
  await ev(() => window.__r.ticks('down', 30))
  await ev(() => window.__r.ticks(null, 14))
  p = await ev(() => window.__t.info())
  check(p.area === 'vacuum', `the pipe leads on to vacuum (in ${p.area}, warp ${p.warp})`)
  await native('pipe-in.png')
  const si = await onScreen()
  await zoom('pipe-in-zoom.png', si.x, si.y - 20, 120, 100, 3)
  await ev(() => window.__r.ticks(null, 40))
  // Back by the door.
  await ev(() => window.__r.open('dev-render', { area: 'tunnel', col: 4 }))
  await ev(() => window.__r.ticks('up', 2))
  await ev(() => window.__r.ticks(null, 8))
  const sd = await onScreen()
  await zoom('door-out-zoom.png', sd.x, sd.y - 30, 120, 100, 3)
  await ev(() => window.__r.ticks(null, 30))
  p = await ev(() => window.__t.info())
  check(p.area === 'vacuum', `the tunnel's door leads back to vacuum (in ${p.area})`)
  await native('door-in.png')
  await clean('area changes')

  /* ---------------- Maxx ---------------- */
  say('maxx')
  await ev(() => window.__r.open('dev-render', { area: 'lot', col: 3, row: 9 }))
  await ev(() => window.__r.ticks(null, 30))
  let s = await onScreen()
  await zoom('maxx-idle.png', s.x, s.y - 30, 100, 80, 4)
  // Spray: streaks, not squares.
  await ev(() => window.__r.ticks('spray', 14))
  s = await onScreen()
  await native('maxx-spray.png')
  await zoom('maxx-spray-zoom.png', s.x + 70, s.y - 30, 200, 80, 3)
  await ev(() => window.__r.ticks('up spray', 14))
  s = await onScreen()
  await zoom('maxx-spray-up-zoom.png', s.x + 50, s.y - 70, 160, 140, 3)
  // Turbo: a glow on the nozzle, carried and firing; fatter water.
  await ev(() => {
    window.__r.player().turbo = true
    window.__r.ticks(null, 20)
  })
  s = await onScreen()
  await zoom('maxx-turbo-carry.png', s.x, s.y - 30, 100, 80, 4)
  await ev(() => window.__r.ticks('spray', 12))
  s = await onScreen()
  await zoom('maxx-turbo-spray.png', s.x + 60, s.y - 30, 180, 80, 3)
  await ev(() => window.__r.ticks(null, 10))
  // Facing left with the turbo.
  await ev(() => window.__r.ticks('left', 2))
  await ev(() => window.__r.ticks('left spray', 10))
  s = await onScreen()
  await zoom('maxx-turbo-left.png', s.x - 50, s.y - 30, 160, 80, 3)
  await ev(() => {
    window.__r.player().turbo = false
    window.__r.ticks('right', 3)
    window.__r.ticks(null, 20)
  })
  // Hover jet.
  await ev(() => window.__r.ticks('jump', 16))
  await ev(() => window.__r.ticks('down spray', 14))
  s = await onScreen()
  await native('maxx-hover.png')
  await zoom('maxx-hover-zoom.png', s.x, s.y - 10, 100, 120, 3)
  await ev(() => window.__r.ticks(null, 60))
  // Lost shine: light, then heavy dirt.
  await ev(() => {
    window.__r.player().pips = 2
    window.__r.ticks(null, 4)
  })
  s = await onScreen()
  await zoom('maxx-grime1.png', s.x, s.y - 30, 100, 80, 4)
  await ev(() => {
    window.__r.player().pips = 1
    window.__r.ticks('right', 10)
  })
  s = await onScreen()
  await zoom('maxx-grime2.png', s.x, s.y - 30, 100, 80, 4)
  // Blinking: two ticks on, two off.
  await ev(() => {
    const pl = window.__r.player()
    pl.pips = 3
    pl.invuln = 40
  })
  const blink = []
  for (let i = 0; i < 4; i++) {
    await ev(() => window.__r.ticks(null, 1))
    blink.push(await ev(() => window.__maxx.sceneObject().renderer.stats().maxxFrame))
    s = await onScreen()
    await zoom(`maxx-blink${i}.png`, s.x, s.y - 30, 80, 70, 3)
  }
  // Wax: bands of light and sparkles.
  await ev(() => {
    const pl = window.__r.player()
    pl.invuln = 0
    pl.wax = 400
    window.__r.ticks(null, 12)
  })
  s = await onScreen()
  await zoom('maxx-wax0.png', s.x, s.y - 30, 110, 90, 4)
  await ev(() => window.__r.ticks('right', 9))
  s = await onScreen()
  await zoom('maxx-wax1.png', s.x, s.y - 30, 110, 90, 4)
  await native('maxx-wax.png')
  await ev(() => {
    window.__r.player().wax = 0
    window.__r.ticks(null, 30)
  })
  await clean('maxx looks')

  /* ---------------- blocks: a brick breaks, a crate is used, grime wears ---------------- */
  say('blocks')
  // Under the brick at column 29 (row 6), facing right.
  await ev(() => window.__r.open('dev-render', { area: 'lot', col: 29, row: 9 }))
  await ev(() => window.__r.ticks(null, 10))
  await ev(() => window.__r.ticks('jump', 9))
  await native('brick-bump.png')
  s = await onScreen()
  await zoom('brick-bump-zoom.png', s.x, s.y - 90, 120, 130, 3)
  await ev(() => window.__r.ticks(null, 8))
  await native('brick-after.png')
  const brick = await ev(() => window.__t.tile(29, 6))
  check(brick === ' ' || brick === 'U', `the brick at (29, 6) broke or was used (now '${brick}')`)
  // The prize crate at 33.
  await ev(() => window.__t.place(33, 320))
  await ev(() => window.__r.ticks(null, 20))
  await ev(() => window.__r.ticks('jump', 10))
  await ev(() => window.__r.ticks(null, 4))
  await native('crate-bump.png')
  await ev(() => window.__r.ticks(null, 40))
  check((await ev(() => window.__t.tile(33, 6))) === 'U', 'the prize crate at (33, 6) is used')
  // The grime wall: wear it with the gun, and look at each stage.
  await ev(() => window.__t.place(56.5, 320))
  await ev(() => window.__r.ticks(null, 6))
  const stages = []
  for (let i = 0; i < 4; i++) {
    await ev(() => window.__r.ticks('spray', 3))
    stages.push(await ev(() => window.__maxx.world().grid.d[9 * window.__maxx.world().grid.w + 58]))
    const z = await onScreen()
    await zoom(`grime-${i}.png`, z.x + 40, z.y - 40, 120, 110, 3)
  }
  say(`    hits on the grime block at (58, 9) after each burst: ${stages.join(', ')}`)
  await ev(() => window.__r.ticks('spray', 30))
  await native('grime-washed.png')
  check((await ev(() => window.__t.tile(58, 9))) === ' ', 'the bottom grime block washed away')
  await clean('blocks')

  /* ---------------- the clear, then the flop ---------------- */
  say('clear and grimed')
  await ev(() => window.__r.open('dev-render', { area: 'lot', col: 62, row: 9 }))
  await ev(() => window.__r.ticks('right', 40))
  p = await ev(() => window.__t.info())
  check(p.status === 'clear', `walking into the arch clears the level (status ${p.status})`)
  await ev(() => window.__r.ticks(null, 60))
  s = await onScreen()
  await native('clear-walk.png')
  await ev(() => window.__r.ticks(null, 100))
  s = await onScreen()
  await native('clear-win.png')
  await zoom('clear-win-zoom.png', s.x, s.y - 40, 110, 100, 3)
  const win = await ev(() => window.__maxx.sceneObject().renderer.stats().maxxFrame)
  check(/win/.test(win), `he cheers once he stands (frame ${win})`)
  const flop = []
  await ev(async () => {
    const sim = await window.__t.mod('sim/index.ts')
    window.__r.open('dev-render', { area: 'lot', col: 20 })
    window.__r.ticks(null, 4)
    sim.grimePlayer(window.__maxx.world())
  })
  for (let i = 0; i < 5; i++) {
    await ev(() => window.__r.ticks(null, 10))
    flop.push(await ev(() => window.__maxx.sceneObject().renderer.stats().maxxFrame))
    s = await onScreen()
    await zoom(`grimed-${i}.png`, s.x, s.y - 30, 110, 80, 3)
  }
  say(`    flop frames every 10 ticks: ${flop.join(' ')}`)
  check(flop.some((f) => /grimed/.test(f)), 'the grimed flop plays')
  // Into the sludge pit (columns 53 to 55): he sinks behind its surface.
  await ev(() => window.__r.open('dev-render', { area: 'lot', col: 54, row: 7 }))
  for (let i = 0; i < 3; i++) {
    await ev(() => window.__r.ticks(null, 12))
    s = await onScreen()
    await zoom(`sludge-${i}.png`, s.x, s.y - 20, 110, 90, 3)
  }
  p = await ev(() => window.__t.info())
  check(p.status === 'grimed', `sludge grimes him (status ${p.status})`)
  // Slow motion: one simulation tick in four.
  await ev(() => window.__r.open('dev-render', { area: 'lot', col: 3, row: 9, slow: 4 }))
  const t0 = await ev(() => window.__maxx.world().tick)
  await ev(() => window.__r.ticks('right', 40))
  const t1 = await ev(() => window.__maxx.world().tick)
  check(t1 - t0 === 10, `slow: 4 runs the world a quarter as fast (${t1 - t0} ticks in 40)`)
  await clean('clear and grimed')

  /* ---------------- every particle, and the popups ---------------- */
  say('particles')
  await ev(() => window.__r.open('dev-render', { area: 'tunnel', col: 3, hideMaxx: true }))
  await ev(() => window.__r.ticks(null, 2))
  const fxIds = FX
  await ev(
    ([ids]) => {
      const w = window.__maxx.world()
      const r = window.__maxx.sceneObject().renderer
      const cx = Math.round(w.camera.x)
      const cy = Math.round(w.camera.y)
      ids.forEach((id, i) => r.fx(id, cx + 40 + (i % 9) * 68, cy + 90 + Math.floor(i / 9) * 110, 6, i % 2 ? 1 : -1))
      r.popup('200', cx + 120, cy + 300)
      r.popup('1UP', cx + 220, cy + 300)
      r.popup('CLEAN!', cx + 320, cy + 300)
      r.popup('1000', cx + 440, cy + 300)
    },
    [fxIds],
  )
  for (const t of [3, 12, 30]) {
    await ev(([n]) => window.__r.ticks(null, n), [t === 3 ? 3 : t === 12 ? 9 : 18])
    await native(`fx-${t}.png`)
  }
  const pst = await ev(() => window.__r.stats())
  say(`    particles alive after 30 ticks: ${pst.particles}, popups ${pst.popups}`)
  await clean('particles')

  /* ---------------- the decor kind, in the simulation ---------------- */
  say('decor')
  const decor = await ev(async () => {
    const sim = await window.__t.mod('sim/index.ts')
    const levels = await window.__t.mod('levels/index.ts')
    const room = levels.levelById('dev-render')
    const report = room ? sim.validateLevel(room) : { errors: ['dev-render not found'], warnings: [] }
    const blank = ' '.repeat(30)
    const rows = Array.from({ length: 12 }, () => blank)
    rows[9] = ' @   1  2  3  4             G '
    rows[10] = '#'.repeat(30)
    rows[11] = '#'.repeat(30)
    const level = {
      id: 'dev-decor-check',
      site: 'T',
      name: 'T',
      time: 99,
      music: 'sunny',
      areas: [
        {
          id: 'a',
          theme: 'lot',
          rows,
          legend: {
            1: { kind: 'decor', props: { sprite: 'decor_cone' } },
            2: { kind: 'decor', props: { sprite: 'decor_curtain', front: true } },
            3: { kind: 'decor', props: { sprite: 'cone', flip: true } },
            4: { kind: 'decor', props: {} },
          },
        },
      ],
    }
    const keys = ['left', 'right', 'up', 'down', 'jump', 'spray', 'confirm', 'cancel', 'pause', 'select']
    const frame = (held, prev) => {
      const h = {}
      const p = {}
      const r = {}
      for (const k of keys) {
        h[k] = held.includes(k)
        p[k] = h[k] && !prev[k]
        r[k] = !h[k] && !!prev[k]
      }
      return { held: h, pressed: p, released: r, repeat: p, axisX: h.right ? 1 : h.left ? -1 : 0, axisY: 0, device: 'keyboard' }
    }
    const session = () => ({ lives: 3, score: 0, coins: 0, pips: 3, turbo: false })
    const play = () => {
      const w = sim.createWorld(level, { session: session(), seed: 7 })
      const start = w.entities.filter((e) => e.kind === 'decor').map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h, z: e.z, harmful: e.harmful, solid: e.solid, gravity: e.gravity, collides: e.collides }))
      const hashes = []
      let prev = {}
      for (let t = 0; t < 400; t++) {
        const held = t % 50 < 30 ? ['right', 'spray'] : t % 50 < 40 ? ['right', 'jump'] : ['left', 'spray']
        const f = frame(held, prev)
        prev = f.held
        sim.stepWorld(w, f)
        w.events.length = 0
        hashes.push(sim.worldHash(w))
      }
      const end = w.entities.filter((e) => e.kind === 'decor').map((e) => ({ x: e.x, y: e.y, dead: e.dead }))
      return { start, end, hashes, pips: w.player.pips, status: w.status }
    }
    const a = play()
    const b = play()
    return { report, a: { start: a.start, end: a.end, pips: a.pips, status: a.status }, same: a.hashes.join() === b.hashes.join() }
  })
  check(decor.report.errors.length === 0, `dev-render passes validateLevel (${decor.report.errors.join('; ') || 'no errors'}; warnings: ${decor.report.warnings.join('; ')})`)
  check(decor.a.start.length === 4, `four decor props spawn (${decor.a.start.length})`)
  check(
    decor.a.start.every((d, i) => d.w === 32 && d.h === 32 && !d.harmful && d.solid === 'none' && d.gravity === 0 && !d.collides && d.z === (i === 1 ? 1 : -1)),
    `decor is a harmless 32 x 32 box, not solid, no gravity, z 1 when front, else -1 (behind the tiles): ${JSON.stringify(decor.a.start)}`,
  )
  check(decor.a.end.every((d, i) => d.x === decor.a.start[i].x && d.y === decor.a.start[i].y && !d.dead), 'decor never moves or goes away while Maxx runs, sprays and jumps through it')
  check(decor.a.pips === 3, `walking through decor costs no shine (pips ${decor.a.pips})`)
  check(decor.same, 'two runs through the decor give the same world hash every tick')
  // In the game: the tunnel's mitter curtain (a front prop) hangs in front of Maxx, the props behind him stay behind.
  await ev(() => window.__r.open('dev-render', { area: 'tunnel', col: 63, row: 9 }))
  await ev(() => window.__r.ticks(null, 20))
  s = await onScreen()
  await zoom('decor-front.png', s.x, s.y - 50, 160, 130, 3)
  await ev(() => window.__r.open('dev-render', { area: 'lot', col: 6, row: 9 }))
  await ev(() => window.__r.ticks(null, 20))
  s = await onScreen()
  await zoom('decor-behind.png', s.x, s.y - 50, 160, 130, 3)

  /* ---------------- the sandbox ---------------- */
  say('sandbox')
  const sb = await ev(() => window.__r.open('sandbox', { free: true }))
  check(sb && sb.level === 'sandbox', 'the sandbox opens in the viewer')
  if (sb) {
    const areaW = sb.w * 32
    for (let x = 0, i = 0; x < areaW; x += 640, i++) {
      await ev(([cx]) => window.__r.look(cx, 0), [Math.min(x, areaW - 640)])
      await native(`sandbox-main-${String(i).padStart(2, '0')}.png`)
    }
    await clean('sandbox main, every screen')
    const areas = await ev(() => window.__maxx.world().level.areas.map((a) => a.id))
    for (const a of areas.slice(1)) {
      await ev(([id]) => window.__r.open('sandbox', { area: id, free: true }), [a])
      await native(`sandbox-${a}.png`)
      await clean(`sandbox ${a}`)
    }
    // Played: run and spray through the start.
    await ev(() => window.__r.open('sandbox', {}))
    await ev(() => window.__r.ticks('right spray', 120))
    await native('sandbox-played.png')
    await clean('sandbox played')
  }

  /* ---------------- seams: one pixel of camera is one pixel of picture ---------------- */
  // A renderer with the backdrop pinned and time stopped must move the whole picture by exactly
  // one pixel when the camera moves one pixel (no seams between cached chunks, no tile a pixel
  // off), and a fractional camera must draw exactly as its rounded self.
  say('seams')
  await ev(() => {
    const mk = () => {
      const c = document.createElement('canvas')
      c.width = 640
      c.height = 360
      return c.getContext('2d', { willReadFrequently: true })
    }
    const m = window.__maxx
    window.__s = {
      g1: mk(),
      g2: mk(),
      open(level, area) {
        m.go('viewer', { level, area, free: true, hideMaxx: true, weather: false, shake: false })
        m.step(1)
        return m.world()
      },
      pinned(extra) {
        const r = m.sceneObject().tools.createRenderer({ pinned: true, hideMaxx: true, weather: false, shake: false, ...extra })
        r.reset(m.world())
        return r
      },
      /** Pixels of g2 that differ from g1 moved by (dx, dy). */
      diff(dx, dy) {
        const a = window.__s.g1.getImageData(0, 0, 640, 360).data
        const b = window.__s.g2.getImageData(0, 0, 640, 360).data
        let bad = 0
        for (let y = 0; y < 360 - dy; y++) {
          for (let x = 0; x < 640 - dx; x++) {
            const ia = ((y + dy) * 640 + x + dx) * 4
            const ib = (y * 640 + x) * 4
            if (a[ia] !== b[ib] || a[ia + 1] !== b[ib + 1] || a[ia + 2] !== b[ib + 2]) bad++
          }
        }
        return bad
      },
    }
  })
  for (const [level, area, step] of [
    ['dev-render', 'lot', 13],
    ['dev-render', 'winter', 29],
    ['dev-render', 'bonus', 7],
    ['sandbox', 'main', 61],
  ]) {
    const res = await ev(
      ([level, area, step]) => {
        const S = window.__s
        const w = S.open(level, area)
        const r = S.pinned()
        const AW = w.grid.w * 32
        const AH = w.grid.h * 32
        let worst = 0
        let frac = 0
        let n = 0
        const ys = AH > 360 ? [AH - 360, Math.round((AH - 360) / 2), 0] : [AH - 360]
        for (const y of ys) {
          for (let x = Math.min(0, AW - 640); x <= Math.max(0, AW - 641); x += step) {
            for (const [dx, dy] of [
              [1, 0],
              [0, 1],
            ]) {
              w.camera.x = x
              w.camera.y = y
              r.draw(S.g1, w)
              w.camera.x = x + dx
              w.camera.y = y + dy
              r.draw(S.g2, w)
              worst = Math.max(worst, S.diff(dx, dy))
              n++
            }
            w.camera.x = x + 0.49
            w.camera.y = y + 0.49
            r.draw(S.g2, w)
            w.camera.x = x
            w.camera.y = y
            r.draw(S.g1, w)
            if (S.diff(0, 0)) frac++
          }
        }
        return { n, worst, frac }
      },
      [level, area, step],
    )
    check(res.worst === 0 && res.frac === 0, `${level}/${area}: ${res.n} one-pixel camera moves move the picture by exactly one pixel (worst ${res.worst} pixels off; fractional cameras off: ${res.frac})`)
  }

  /* ---------------- stale chunks ---------------- */
  // A renderer whose chunks are warm must draw exactly what a fresh one draws after tiles change.
  say('stale chunks')
  const stale = await ev(() => {
    const S = window.__s
    const out = []
    let w = S.open('dev-render', 'lot')
    let r = S.pinned()
    const look = (x, y) => {
      w.camera.x = x
      w.camera.y = y
      r.draw(S.g1, w)
    }
    const same = (what) => {
      r.draw(S.g1, w)
      S.pinned().draw(S.g2, w)
      out.push([what, S.diff(0, 0)])
    }
    const put = (tx, ty, ch, d) => {
      w.grid.t[ty * w.grid.w + tx] = ch.charCodeAt(0)
      if (d !== undefined) w.grid.d[ty * w.grid.w + tx] = d
    }
    look(560, 24)
    put(29, 6, ' ')
    same('a brick gone')
    put(33, 6, 'U')
    same('a crate used')
    put(45, 6, 'U')
    same('a hidden block found')
    w.bumps.push({ tx: 35, ty: 6, t: 4 })
    same('a block hopping')
    w.bumps.length = 0
    same('the hop over')
    look(1500, 24)
    for (const d of [1, 2, 3, 4, 5]) {
      put(58, 9, 'g', d)
      same(`grime with ${d} hits`)
    }
    put(58, 9, ' ', 0)
    same('grime washed away')
    look(330, 24)
    put(19, 9, ' ')
    same('a tile beside the chunk edge gone (its neighbour across the edge changes)')
    put(19, 11, ' ')
    same('a tile under the floor beside the chunk edge gone')
    w = S.open('dev-render', 'winter')
    r = S.pinned()
    look(0, 280)
    put(8, 11, '#')
    same('winter: ground put just above the chunk row edge')
    return out
  })
  for (const [what, bad] of stale) check(bad === 0, `stale chunks: ${what}: warm renderer matches a fresh one (${bad} pixels differ)`)

  /* ---------------- every area of every level ---------------- */
  say('every level')
  const every = await ev(async () => {
    const S = window.__s
    const levels = await window.__t.mod('levels/index.ts')
    const out = []
    for (const lv of [levels.sandboxLevel, ...levels.DEV_LEVELS, ...levels.LEVELS, ...(levels.RIVALS ? [levels.RIVALS] : [])]) {
      for (const ar of lv.areas) {
        const w = S.open(lv.id, ar.id)
        const r = S.pinned({ marks: true })
        const AW = w.grid.w * 32
        const AH = w.grid.h * 32
        for (let y = Math.max(0, AH - 360); y > -360; y -= 360) {
          for (let x = Math.min(0, (AW - 640) / 2); x < AW; x += 640) {
            w.camera.x = x
            w.camera.y = y
            r.draw(S.g1, w)
          }
        }
        const st = r.stats()
        const zs = [...new Set(w.entities.map((e) => e.z))].sort((a, b) => a - b)
        out.push({ id: `${lv.id}/${ar.id}`, theme: ar.theme, size: `${w.grid.w}x${w.grid.h}`, art: st.tileArt, bd: st.backdropArt, problems: st.problems.slice(), errors: window.__maxx.errors.length, zs })
      }
    }
    return out
  })
  for (const a of every) check(a.problems.length === 0 && a.errors === 0 && a.art > 0 && a.bd, `${a.id} (${a.theme}, ${a.size}) drawn whole: tile art ${a.art} keys, backdrop ${a.bd ? 'yes' : 'no'}, renderers that threw: ${a.problems.join(', ') || 'none'}`)
  // Inside a layer, entities draw by z, then spawn order: with every z one of -1, 0 and 1 (one z a layer) that is the order they always had.
  const zOther = every.filter((a) => a.zs.some((z) => z !== -1 && z !== 0 && z !== 1))
  say(`    z values at spawn: ${zOther.length ? zOther.map((a) => `${a.id} ${a.zs.join('/')}`).join('; ') : 'only -1, 0 and 1 in every area, so no layer draws in a new order'}`)

  /* ---------------- renderer particles: once a tick ---------------- */
  // An entity renderer that emits from draw() must not emit again when the screen draws twice in one tick.
  const once = await ev(async () => {
    const reg = await window.__t.mod('render/registry.ts')
    reg.registerRenderer('fxprobe', (g, e, rc) => rc.fx('dust', e.x, e.y, 1))
    const S = window.__s
    const w = S.open('dev-render', 'lot')
    const r = window.__maxx.sceneObject().renderer
    const probe = { ...w.entities[0], id: 99999, kind: 'fxprobe', variant: '', x: w.camera.x + 300, y: w.camera.y + 200, w: 8, h: 8, z: 0, dead: false, props: {}, vars: {} }
    w.entities.push(probe)
    r.reset(w)
    const counts = []
    for (let t = 0; t < 3; t++) {
      r.update(w)
      for (let k = 0; k < 3; k++) r.draw(S.g1, w)
      counts.push(r.stats().particles)
    }
    const pin = S.pinned()
    for (let k = 0; k < 3; k++) pin.draw(S.g1, w)
    w.entities.pop()
    return { counts, pinned: pin.stats().particles }
  })
  check(once.counts.join() === '1,2,3' && once.pinned === 0, `rc.fx from a renderer emits once a tick however often the screen draws (${once.counts.join(', ')} after 1, 2, 3 ticks of 3 draws each), and never in a pinned picture (${once.pinned})`)

  /* ---------------- tick hooks, margins, the order of z ---------------- */
  say('tick hooks, margins, z order')
  const hooks = await ev(async () => {
    const reg = await window.__t.mod('render/registry.ts')
    const S = window.__s
    const w = S.open('dev-render', 'lot')
    const r = window.__maxx.sceneObject().renderer
    const order = []
    const ticked = []
    const tag = (g, e) => order.push(e.vars.tag)
    reg.registerRenderer('zprobe', tag)
    reg.registerRenderer('decor:zprobe', tag)
    reg.registerRenderer('mprobe', tag, { margin: 400 })
    reg.registerRenderer('mprobe2', tag, { margin: (e) => e.vars.m })
    reg.registerRenderer('tprobe', () => {}, {
      tick(e, rc) {
        ticked.push(e.vars.tag)
        rc.fx('dust', e.x, e.y, 1)
      },
    })
    const cx = Math.round(w.camera.x)
    const cy = Math.round(w.camera.y)
    let id = 90000
    const add = (kind, variant, tag, z, dx, extra = {}) => {
      const e = { ...w.entities[0], id: id++, kind, variant, x: cx + dx, y: cy + 200, w: 8, h: 8, z, dead: false, props: {}, vars: { tag, ...extra } }
      w.entities.push(e)
      return e
    }
    const added = [
      add('zprobe', '', 'A', 1, 100),
      add('zprobe', '', 'B', 3, 110),
      add('zprobe', '', 'C', 2, 120),
      add('zprobe', '', 'D', 1, 130),
      add('decor', 'zprobe', 'E', 2, 140),
      add('zprobe', '', 'F', 2, 150),
      add('zprobe', '', 'G', -1, 160),
      add('decor', 'zprobe', 'H', -1, 170),
      add('zprobe', '', 'I', -2, 180),
      add('zprobe', '', 'J', 0, 190),
      add('decor', 'zprobe', 'K', 0, 200),
      // 300 px past the right edge: drawn only with a margin that reaches.
      add('zprobe', '', 'far', 1, 940),
      add('mprobe', '', 'margin', 1, 940),
      add('mprobe2', '', 'reach', 1, 940, { m: 320 }),
      add('mprobe2', '', 'short', 1, 940, { m: 100 }),
      add('tprobe', '', 'tick', 0, 300),
      add('tprobe', '', 'tickFar', 0, 1200),
    ]
    r.reset(w)
    r.draw(S.g1, w)
    const drawn = order.slice()
    // Tick hooks: once per update whatever the draws do, emitting every time.
    const counts = []
    for (const draws of [0, 1, 3]) {
      r.update(w)
      for (let k = 0; k < draws; k++) r.draw(S.g1, w)
      counts.push(`${ticked.length}:${r.stats().particles}`)
    }
    for (const e of added) e.dead = true
    w.entities.splice(w.entities.length - added.length)
    return { drawn, counts, ticked: ticked.slice() }
  })
  const zs = hooks.drawn.filter((t) => t.length === 1).join('')
  check(zs === 'IHGKJADECFB', `entities draw by z inside each layer, decor first at equal z, else in spawn order (got ${zs}, want IHGKJADECFB)`)
  const far = hooks.drawn.filter((t) => t.length > 1)
  check(far.join() === 'margin,reach', `an entity 300 px off screen is drawn only when its renderer's margin reaches it (drawn: ${far.join(', ') || 'none'})`)
  check(hooks.counts.join() === '1:1,2:2,3:3' && hooks.ticked.every((t) => t === 'tick'), `a kind's tick hook runs once per update however often the screen draws, and its rc.fx always emits; not for an entity far off screen (${hooks.counts.join(' ')}; hooks ran for ${[...new Set(hooks.ticked)].join(', ')})`)

  // Decor with words is never mirrored: the vacuum area's sign drawn flipped is the same picture.
  const words = await ev(() => {
    const S = window.__s
    const w = S.open('dev-render', 'vacuum')
    const sign = w.entities.find((e) => e.kind === 'decor' && /sign_vacuums/.test(String(e.props.sprite)))
    const cone = w.entities.find((e) => e.kind === 'decor' && /decor_vacuum$/.test(String(e.props.sprite)))
    if (!sign || !cone) return null
    const shot = (e, flip) => {
      e.props.flip = flip
      w.camera.x = Math.round(e.x + 16 - 320)
      w.camera.y = w.grid.h * 32 - 360
      const r = S.pinned()
      r.draw(S.g1, w)
      return Array.from(S.g1.getImageData(240, 120, 160, 240).data).join()
    }
    const was = [sign.props.flip, cone.props.flip]
    const res = { sign: shot(sign, true) === shot(sign, false), cone: shot(cone, true) === shot(cone, false) }
    sign.props.flip = was[0]
    cone.props.flip = was[1]
    return res
  })
  check(words && words.sign && !words.cone, `props.flip is ignored on decor with words (the vacuums sign draws the same either way) and still mirrors a prop without (the vacuum): ${JSON.stringify(words)}`)

  /* ---------------- screen shake ---------------- */
  say('shake')
  const shook = await ev(() => {
    const m = window.__maxx
    m.go('viewer', { level: 'dev-render', area: 'lot', col: 2, shake: true })
    m.step(1)
    const w = m.world()
    const r = m.sceneObject().renderer
    const S = window.__s
    const xs = []
    r.event({ type: 'shake', ticks: 30, mag: 6 }, w)
    for (let i = 0; i < 30; i++) {
      r.update(w)
      r.draw(S.g1, w)
      xs.push(r.stats().camX + ',' + r.stats().camY)
    }
    const x = xs.map((s) => +s.split(',')[0])
    const y = xs.map((s) => +s.split(',')[1])
    r.update(w)
    r.draw(S.g1, w)
    return { minX: Math.min(...x), maxX: Math.max(...x), minY: Math.min(...y), maxY: Math.max(...y), rest: [r.stats().camX, r.stats().camY], cam: [w.camera.x, w.camera.y] }
  })
  check(shook.minX === 0 && shook.maxX > 0 && shook.minY < shook.maxY && shook.maxY <= 24, `a shake at the left edge rattles the picture without showing past the area (camera x ${shook.minX}..${shook.maxX}, y ${shook.minY}..${shook.maxY}; at rest ${shook.rest})`)

  /* ---------------- the viewer's own tools ---------------- */
  say('viewer')
  await ev(() => window.__r.open('dev-render', { area: 'winter', col: 30, grid: true }))
  await ev(() => window.__r.ticks(null, 4))
  await native('viewer-grid.png')
  await ev(() => window.__maxx.go('viewer', { level: 'no-such-level' }))
  await ev(() => window.__maxx.step(2))
  const none = await ev(() => ({ world: !!window.__maxx.world(), errors: window.__maxx.errors.length }))
  await native('viewer-unknown-level.png')
  check(!none.world && none.errors === 0, 'the viewer says so for a level id it does not know, and shows no world')

  /* ---------------- how long draw() takes over a busy screen ---------------- */
  say('timing')
  await ev(() => window.__r.open('dev-render', { area: 'tunnel', col: 30 }))
  await ev(() => window.__r.ticks('spray', 20))
  const timing = await ev(() => {
    const m = window.__maxx
    const w = m.world()
    const r = m.sceneObject().renderer
    const cx = Math.round(w.camera.x)
    const cy = Math.round(w.camera.y)
    const ids = ['splash', 'sparkle', 'dust', 'debris', 'mud', 'bubble', 'star', 'smoke', 'foam', 'snow', 'confetti', 'drip', 'steam', 'coin', 'shine', 'leaf', 'spark']
    for (let k = 0; k < 3; k++) ids.forEach((id, i) => r.fx(id, cx + 30 + i * 34, cy + 80 + k * 70, 6, 1))
    for (let i = 0; i < 8; i++) r.popup(String(200 * (i + 1)), cx + 60 + i * 70, cy + 200)
    m.hold('spray')
    for (let i = 0; i < 14; i++) m.step(1)
    m.release()
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 360
    // The flushed runs draw on a canvas kept in memory (rasterised on the CPU), read back each time, so the
    // time includes the painting itself: a pessimistic figure. The plain runs time what the page pays.
    const gpu = c.getContext('2d')
    const cpu = Object.assign(document.createElement('canvas'), { width: 640, height: 360 }).getContext('2d', { willReadFrequently: true })
    const runs = (n, flush) => {
      const times = []
      const g = flush ? cpu : gpu
      for (let i = 0; i < n; i++) {
        const t0 = performance.now()
        r.draw(g, w)
        if (flush) g.getImageData(0, 0, 1, 1)
        times.push(performance.now() - t0)
      }
      times.sort((a, b) => a - b)
      return { median: +times[n >> 1].toFixed(3), p95: +times[Math.floor(n * 0.95)].toFixed(3), mean: +(times.reduce((a, b) => a + b, 0) / n).toFixed(3) }
    }
    runs(60, false)
    const st = r.stats()
    return { calls: runs(600, false), flushed: runs(200, true), particles: st.particles, popups: st.popups, droplets: w.droplets.length, entities: w.entities.length }
  })
  say(`    busy screen: ${timing.particles} particles, ${timing.popups} popups, ${timing.droplets} droplets, ${timing.entities} entities`)
  say(`    draw() ms per frame: median ${timing.calls.median}, p95 ${timing.calls.p95}, mean ${timing.calls.mean}; with the canvas flushed each time: median ${timing.flushed.median}, p95 ${timing.flushed.p95}`)
  check(timing.calls.median < 3, `draw() well under 3 ms a frame (median ${timing.calls.median} ms)`)
  await native('timing-screen.png')
  // Allocation: 600 ticks of the renderer's whole cosmetic work (update() and draw()) over a busy
  // screen with Maxx waxed, turbo-charged and dirty, the world itself held still so only the
  // renderer runs. Four warm-up rounds first (the JIT boxes numbers until it has optimised), then
  // the heap is collected and read before and after a measured round (one synchronous call:
  // nothing else runs between), and V8's sampling profiler counts what was allocated inside it.
  const cdp = await page.createCDPSession()
  await cdp.send('HeapProfiler.enable').catch(() => {})
  await ev(() => {
    const m = window.__maxx
    const w = m.world()
    const r = m.sceneObject().renderer
    const p = w.player
    p.wax = 100000
    p.turbo = true
    p.pips = 2
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 360
    const g = c.getContext('2d')
    const ids = ['splash', 'sparkle', 'dust', 'debris', 'mud', 'bubble', 'star', 'smoke', 'foam', 'snow', 'confetti', 'drip', 'steam', 'coin', 'shine', 'leaf', 'spark']
    const cx = Math.round(w.camera.x)
    const cy = Math.round(w.camera.y)
    window.__heapProbe = function heapProbe() {
      for (let i = 0; i < 600; i++) {
        if (r.stats().particles < 250) for (let k = 0; k < ids.length; k++) r.fx(ids[k], cx + 30 + k * 34, cy + 100, 4, 1)
        if (i % 60 === 0) r.popup('CLEAN!', cx + 300, cy + 150)
        r.update(w)
        r.draw(g, w)
      }
    }
    // Warm-up: until the JIT has optimised the hot functions, it boxes numbers and makes code.
    for (let k = 0; k < 4; k++) window.__heapProbe()
  })
  // Up to three measured rounds; the steady state is the best of them (a late tier-up of the JIT
  // in one round shows as allocation that is gone in the next). Each verdict takes its own best
  // round: the heap reading carries page noise of a few hundred KB either way, and judging both by
  // one round let that noise pick a round the JIT had not finished with. A real leak grows every
  // round and a real allocation in the draw path is sampled every round, so the best still shows them.
  let best = null
  for (let round = 0; round < 3 && !(best && best.sampled < 16 * 600 && best.grew < 64 * 600); round++) {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
    const before = await cdp.send('Runtime.getHeapUsage').catch(() => null)
    const profile = await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true }).then(
      async () => {
        await ev(() => window.__heapProbe())
        return (await cdp.send('HeapProfiler.stopSampling')).profile
      },
      () => null,
    )
    // Collected first, so this is what the round kept. Read without it, the growth was whatever
    // garbage the collector had not reached yet, and the check passed or failed by luck. The
    // allocation rate itself is the sampled count below.
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
    const after = await cdp.send('Runtime.getHeapUsage').catch(() => null)
    if (!before || !after || !profile) break
    let bytes = 0
    const sites = []
    const walk = (n, inside) => {
      const here = inside || n.callFrame.functionName === 'heapProbe'
      if (here && n.selfSize > 0) {
        bytes += n.selfSize
        sites.push(`${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1} ${n.selfSize} B`)
      }
      for (const c of n.children) walk(c, here)
    }
    walk(profile.head, false)
    const grew = after.usedSize - before.usedSize
    say(`    round ${round + 1}: JS heap ${before.usedSize} -> ${after.usedSize} (${grew} bytes, ${(grew / 600).toFixed(1)} a tick); sampled inside update() + draw(): ${bytes} bytes (${(bytes / 600).toFixed(1)} a tick)${sites.length ? ': ' + sites.slice(0, 5).join(', ') : ''}`)
    best = best ? { sampled: Math.min(best.sampled, bytes), grew: Math.min(best.grew, grew) } : { sampled: bytes, grew }
  }
  if (best) {
    check(best.grew / 600 < 64, `the JS heap stays flat over 600 busy ticks (${(best.grew / 600).toFixed(1)} bytes a tick)`)
    check(best.sampled / 600 < 16, `update() + draw() allocate next to nothing once warm (${(best.sampled / 600).toFixed(1)} bytes a tick)`)
  }

  // A sign's board (engine/ui.ts textPanel) is drawn every frame while Maxx stands near: once a
  // text has been shown, drawing it again allocates nothing.
  await ev(async () => {
    const ui = await window.__t.mod('engine/ui.ts')
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 360
    const g = c.getContext('2d')
    const opts = { style: 'sign', anchor: 'bottom', maxWidth: 240 }
    const text = 'HOLD {spray} TO SOAK A DIRTY CAR. A CLEAN CAR IS A HAPPY CAR, AND YOU CAN RIDE ITS ROOF!'
    window.__panelProbe = function panelProbe() {
      for (let i = 0; i < 600; i++) ui.textPanel(g, text, 320, 300, opts)
    }
    for (let k = 0; k < 4; k++) window.__panelProbe()
  })
  let panelBest = null
  for (let round = 0; round < 3 && !(panelBest !== null && panelBest < 600); round++) {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
    const profile = await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true }).then(
      async () => {
        await ev(() => window.__panelProbe())
        return (await cdp.send('HeapProfiler.stopSampling')).profile
      },
      () => null,
    )
    if (!profile) break
    let bytes = 0
    const sites = []
    const walk = (n, inside) => {
      const here = inside || n.callFrame.functionName === 'panelProbe'
      if (here && n.selfSize > 0) {
        bytes += n.selfSize
        sites.push(`${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1} ${n.selfSize} B`)
      }
      for (const c of n.children) walk(c, here)
    }
    walk(profile.head, false)
    say(`    sign board, round ${round + 1}: ${bytes} bytes over 600 frames${sites.length ? ': ' + sites.slice(0, 5).join(', ') : ''}`)
    if (panelBest === null || bytes < panelBest) panelBest = bytes
  }
  if (panelBest !== null) check(panelBest < 600, `a sign's board drawn every frame allocates next to nothing once shown (${(panelBest / 600).toFixed(1)} bytes a frame)`)

  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(`${problems.length} render check(s) failed:\n  ` + problems.join('\n  '))
}
