// The world map, through the real scene in manual time: every save state it has to show, the
// flourishes, walking every road both ways with rough pushes, the controller, prompts, sounds,
// and the bad moments (odd saves and params, held pushes, presses mid-walk and mid-iris, twenty
// trips into a level and back), and last what the map has shown surviving a page reload (it
// reloads the page itself).
//   node scripts/maxx/serve.mjs --port <port> -- node scripts/maxx/shot.mjs --port <port> --w 1280 --h 830
//     --q "scene=map&manual=1&fresh=1" --script scripts/maxx/checks/map.mjs --out <folder>/end.png
// Pictures land in <folder> (1x, plus 3x and 4x crops, and strips of the flourishes); report.txt
// says what was checked. Exit code 1 if any check fails.
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { install, saver } from './lib.mjs'
import { Canvas } from '../pix.mjs'

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
  await install(maxx)
  const ev = (fn, ...args) => page.evaluate(fn, ...args)
  const step = (n = 1) => ev((n) => window.__t.run(null, n), n)
  const hold = (dirs, n) => ev((d, n) => window.__t.run(d, n), dirs, n)
  const release = () => ev(() => window.__maxx.release())
  const state = () => ev(() => (window.__maxx.scene() === 'map' ? window.__maxx.sceneObject().state() : null))
  const scene = () => ev(() => window.__maxx.scene())
  const audio = () => ev(() => window.__rec.audio.splice(0))
  const meta = await ev(() => window.__maxx.ctx.sprites.atlas('map').meta)
  let n = 0
  const native = async () => ev(() => window.__t.native())
  const name = (s) => String(++n).padStart(2, '0') + '-' + s + '.png'
  const pic = async (s) => save(name(s), await native())
  const zoom = async (s, cx, cy, w, h, k) => save(name(s), await ev((a) => window.__t.zoom(...a), [cx, cy, w, h, k]))
  const pngjs = (await import('pngjs')).default
  const PNGread = (dataUrl) => pngjs.PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'))
  const strip = async (s, frames, cols = 4, crop = null) => {
    const imgs = frames.map((d) => Canvas.fromPNG(PNGread(d)))
    const c0 = crop ? imgs.map((c) => c.crop(...crop)) : imgs
    const w = c0[0].w
    const h = c0[0].h
    const rows = Math.ceil(c0.length / cols)
    const sheet = new Canvas(cols * (w + 2) + 2, rows * (h + 2) + 2, '#16161d')
    c0.forEach((c, i) => sheet.blit(c, 2 + (i % cols) * (w + 2), 2 + Math.floor(i / cols) * (h + 2)))
    const file = path.join(OUT, name(s))
    sheet.save(file)
    console.log('[saved] ' + file)
  }

  /**
   * Rewrite the save in place, then run fn(d, rec). The map's memory of what it has shown
   * (save.data.map) is carried over, as a clear made in a level would leave it; forget() wipes it.
   */
  const setSave = (fn) =>
    ev((src) => {
      const s = window.__maxx.ctx.save
      const seen = JSON.parse(JSON.stringify(s.data.map ?? null))
      s.reset()
      if (seen) s.data.map = seen
      new Function('d', 'rec', src)(s.data, (id) => s.record(id))
      s.commit()
    }, `const clearAll = ${clearAll.toString()};
(${fn.toString()})(d, rec)`)
  const forget = () => ev(async () => (await window.__t.mod('scenes/map/progress.ts')).forgetSeen(window.__maxx.ctx.save))
  const open = async (params = {}, fg = false) => {
    if (fg) await forget()
    await ev((p) => window.__maxx.go('map', p), params)
    await step(1)
  }
  /** Step until the map stands idle (flourishes over, walk ended), at most `max` ticks. */
  const settle = async (max = 1500) => {
    let st = await state()
    for (let i = 0; i < max / 5 && st && st.phase !== 'idle'; i++) {
      await step(5)
      st = await state()
    }
    return st
  }
  const clearAll = (d, rec, upTo, opts = {}) => {
    const ids = ['mw01', 'mw02', 'mw03', 'mw04', 'mw05', 'mw06', 'mw07', 'mw08']
    for (let i = 0; i < upTo; i++) {
      const r = rec(ids[i])
      r.cleared = true
      r.bestScore = 12000 + i * 3150
      r.tokens = opts.allTokens ? [true, true, true] : [i % 2 === 0, true, i % 3 === 0]
      r.spotless = opts.spotless ?? i % 3 === 1
    }
    d.unlocked = Math.min(8, upTo + 1)
  }
  // The stand-in level: the sandbox played under a site's id (standIn in levels/index.ts), to
  // test going in and out. A real level of that id is used as it is.
  const standIn = (id, on) =>
    ev(
      async (id, on) => {
        const m = await window.__t.mod('levels/index.ts')
        if (!on) m.standIn(id, null)
        else if (!m.LEVELS.some((l) => l.id === id)) m.standIn(id, { ...m.sandboxLevel, site: id.toUpperCase(), name: 'STAND-IN' })
        const l = m.levelById(id)
        return l ? (l.areas === m.sandboxLevel.areas ? 'stand-in' : 'real') : 'none'
      },
      id,
      on,
    )
  // A site whose level is missing: every level is built now, so a real one is hidden for that
  // (hideLevel in levels/index.ts makes levelById answer null). True when it took.
  const hide = (id, on) =>
    ev(
      async (id, on) => {
        const m = await window.__t.mod('levels/index.ts')
        m.hideLevel(id, on)
        return on ? m.levelById(id) === null : m.levelById(id)?.id === id && !m.hiddenLevels().includes(id)
      },
      id,
      on,
    )

  // Which way to push from a node to walk a road: the road's own first stretch, snapped to the
  // nearest of the eight stick and D-pad directions (a rough push, not an exact one).
  const ends = (id) =>
    meta.roads.flatMap((r) => {
      const out = []
      const pts = r.pts
      const k = Math.min(pts.length / 2 - 1, 9)
      if (r.a === id) out.push({ road: r.id, to: r.b, dx: pts[k * 2] - pts[0], dy: pts[k * 2 + 1] - pts[1] })
      const L = pts.length / 2 - 1
      if (r.b === id) out.push({ road: r.id, to: r.a, dx: pts[(L - k) * 2] - pts[L * 2], dy: pts[(L - k) * 2 + 1] - pts[L * 2 + 1] })
      return out
    })
  const snap = (dx, dy) => {
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
    const dirs = { 0: 'right', 1: 'right down', 2: 'down', 3: 'left down', 4: 'left', '-4': 'left', '-3': 'left up', '-2': 'up', '-1': 'right up' }
    return dirs[a]
  }
  // How far a point is from a road's line (its points are 2 px apart).
  const offRoad = (roadId, x, y) => {
    const r = meta.roads.find((q) => q.id === roadId)
    let best = 99
    for (let i = 0; i < r.pts.length; i += 2) best = Math.min(best, Math.hypot(r.pts[i] - x, r.pts[i + 1] - y))
    return best
  }
  /** Push one way for two ticks, let go, and follow the walk, measuring how far Maxx strays from the road. */
  const walk = async (to, dirs, maxTicks = 300) => {
    const before = await state()
    await hold(dirs, 2)
    let st = await state()
    const set = st.phase === 'walk'
    const roadId = st.road
    await release()
    let t = 0
    let stray = 0
    while (st.phase === 'walk' && t < maxTicks) {
      if (st.road) stray = Math.max(stray, offRoad(st.road, st.maxx[0], st.maxx[1]))
      await step(3)
      t += 3
      st = await state()
    }
    await step(14)
    st = await state()
    return { ok: set && st.node === to, from: before.node, at: st.node, road: roadId, ticks: t, stray: +stray.toFixed(2) }
  }

  /* 1. A fresh save (MW01's level hidden, for the site with no level at the end of this part) */
  check(await hide('mw01', true), "MW01's level hidden for this part (levels/index.ts hideLevel)")
  await audio()
  await open({})
  await step(60)
  let st = await state()
  check((await scene()) === 'map', 'the dev page opens the map scene')
  check(st.node === 'hq' && st.phase === 'idle', 'a fresh save starts at HQ, standing (' + st.node + ', ' + st.phase + ')')
  check(st.roads.join() === 'r0' && st.lit.includes('mw01') && !st.lit.includes('mw02'), 'only the road to MW01 is paved and only MW01 is lit')
  check(!st.lit.includes('rivals'), 'Rival Row is not lit')
  check(st.bar.prompt === '{move} WALK  {cancel} TITLE' && st.bar.name === 'MIGHTY WASH HQ', `the bar at HQ: ${st.bar.name}, ${st.bar.prompt}`)
  const a1 = await audio()
  check(a1.includes('music:map'), 'the map song is asked for')
  await pic('fresh')
  await zoom('fresh-hq-4x', 110, 270, 160, 90, 4)

  // left from HQ is toward nothing: he stays
  await hold('left', 3)
  await release()
  await step(2)
  st = await state()
  check(st.node === 'hq' && st.phase === 'idle', 'a push toward nothing does nothing (left at HQ)')

  // a rough push walks; the bends are followed
  const e0 = ends('hq')[0]
  await hold(snap(e0.dx, e0.dy), 2)
  st = await state()
  check(st.phase === 'walk' && st.target === 'mw01' && st.bar.sign === 'MW01', `while he walks the bar already shows where he is going (${st.bar.sign})`)
  await release()
  st = await settle()
  check(st.node === 'mw01', `HQ to MW01 with a push '${snap(e0.dx, e0.dy)}' (${st.node})`)
  check((await audio()).includes('sfx:mapMove'), 'walking plays mapMove')
  await pic('fresh-at-mw01')

  // pushing on toward MW02 is refused: MW01 is not cleared
  await hold('right', 3)
  await release()
  await step(2)
  st = await state()
  check(st.node === 'mw01' && st.phase === 'idle' && st.note === 'CLEAR MW01 FIRST', `he cannot pass an uncleared site (${st.note})`)
  check((await audio()).includes('sfx:locked'), 'the shut road plays locked')
  await step(6)
  await zoom('locked-push-3x', 170, 270, 200, 100, 3)

  // confirm: no level behind the site
  await hold('confirm', 1)
  await release()
  await step(3)
  st = await state()
  check(st.note === 'COMING SOON' && (await scene()) === 'map', 'confirm on a site with no level: COMING SOON, stays on the map')
  check((await audio()).includes('sfx:locked'), 'and plays locked')
  check(st.bar.extra.includes('COMING SOON') && !st.bar.prompt.includes('PLAY'), `the bar says COMING SOON and offers no PLAY (${st.bar.prompt})`)
  await pic('coming-soon')
  check(await hide('mw01', false), "MW01's level is back")

  /* 2. The unlock flourish, frame by frame */
  await setSave((d, rec) => {
    rec('mw01').cleared = true
    rec('mw01').bestScore = 8400
    rec('mw01').tokens = [true, false, true]
    d.unlocked = 2
  })
  await open({ from: 'mw01', exit: 'goal' })
  st = await state()
  check(st.phase === 'show' && st.pending === 1 && st.node === 'mw01', `back from a clear of MW01: one road to draw in (${st.phase}, ${st.pending})`)
  check(!st.lit.includes('mw02'), 'MW02 stays dark until its road arrives')
  const fl = []
  for (let i = 0; i < 16; i++) {
    await step(7)
    fl.push(await native())
    if (i === 9) await pic('unlock-flourish-mid')
  }
  await strip('unlock-flourish-frames', fl, 4, [100, 200, 260, 120])
  st = await settle()
  check(st.phase === 'idle' && st.roads.includes('r1') && st.lit.includes('mw02'), 'after the flourish the road is paved and MW02 is lit')
  check((await audio()).includes('sfx:powerup'), 'the site lights with a sound')
  await pic('after-unlock')
  const e1 = ends('mw01').find((e) => e.to === 'mw02')
  const w1 = await walk('mw02', snap(e1.dx, e1.dy))
  check(w1.ok, 'MW01 to MW02 on the new road')
  const w1b = await walk('mw01', 'left')
  check(w1b.ok, 'and back with a plain left')

  // confirm hurries a flourish
  await setSave((d, rec) => {
    rec('mw01').cleared = true
    rec('mw02').cleared = true
    d.unlocked = 3
  })
  await open({ from: 'mw02', exit: 'goal' })
  await step(40)
  await hold('confirm', 1)
  await release()
  await step(1)
  st = await state()
  check(st.phase === 'idle' && st.roads.includes('r2') && st.lit.includes('mw03'), 'confirm finishes a flourish at once')
  check((await scene()) === 'map', 'and does not also enter the level')

  // a replay of a cleared level, first look of a sitting: the old road is not announced again
  await setSave((d, rec) => clearAll(d, rec, 3))
  await open({ from: 'mw01', exit: 'goal' }, true)
  st = await state()
  check(st.phase === 'idle' && st.pending === 0, `first look after replaying MW01 (already cleared on): nothing to announce (${st.pending})`)

  /* 3. The secret reveal: out of MW03 by the secret exit */
  await setSave((d, rec) => {
    for (const id of ['mw01', 'mw02', 'mw03']) rec(id).cleared = true
    rec('mw03').tokens = [true, true, false]
    d.unlocked = 3
  })
  await open({ from: 'mw03', exit: 'quit' }, true)
  await setSave((d, rec) => {
    for (const id of ['mw01', 'mw02', 'mw03']) rec(id).cleared = true
    rec('mw03').tokens = [true, true, false]
    d.unlocked = 4
    d.secretFound = true
  })
  await open({ from: 'mw03', exit: 'secret' })
  st = await state()
  check(st.phase === 'show' && st.pending === 2, `secret exit from MW03: the road to MW04 and the hidden road (${st.pending})`)
  const sec = []
  let sawJingle = false
  let sawBanner = ''
  for (let i = 0; i < 60; i++) {
    await step(8)
    st = await state()
    if (st.banner && st.banner.includes('HIDDEN')) sawBanner = st.banner
    if (st.drawing === 's0' && sec.length < 12 && i % 2 === 0) {
      sec.push(await native())
      if (sec.length === 4) await pic('secret-reveal-mid')
    }
    if ((await audio()).includes('jingle:secret')) sawJingle = true
    if (st.phase === 'idle') break
  }
  check(sawJingle, 'the hidden road comes with the secret jingle')
  check(sawBanner === 'A HIDDEN ROAD!', 'and a banner (' + sawBanner + ')')
  check(st.roads.includes('s0') && !st.roads.includes('s1') && st.lit.includes('rivals'), 'MW03 to Rival Row is open; the leg on to MW06 waits for MW06')
  if (sec.length) await strip('secret-reveal-frames', sec, 4, [300, 180, 220, 130])
  await pic('secret-revealed')
  const es = ends('mw03').find((e) => e.to === 'rivals')
  const w2 = await walk('rivals', snap(es.dx, es.dy))
  check(w2.ok, `MW03 to Rival Row with '${snap(es.dx, es.dy)}' (${JSON.stringify(w2)})`)
  await zoom('rival-row-none-beaten-4x', 458, 262, 140, 80, 4)

  // skipping the reveal still plays the fanfare
  await setSave((d, rec) => clearAll(d, rec, 3))
  await open({ from: 'mw03', exit: 'quit' }, true)
  await setSave((d, rec) => {
    clearAll(d, rec, 3)
    d.secretFound = true
  })
  await audio()
  await open({ from: 'mw03', exit: 'secret' })
  // Back from a clear the map takes no confirm until 30 quiet ticks (ARRIVE_CALM); the flourish
  // is still in its opening wait at 40.
  await step(40)
  await hold('confirm', 1)
  await release()
  st = await state()
  check(st.phase === 'idle' && st.lit.includes('rivals') && (await audio()).includes('jingle:secret'), 'confirm early in the flourish: the hidden road is there, and the jingle still plays')

  /* 3b. Found from MW06 instead: the hidden road draws from MW06 back toward MW03 */
  await setSave((d, rec) => clearAll(d, rec, 6))
  await open({ from: 'mw06', exit: 'quit' }, true)
  await step(5)
  await setSave((d, rec) => {
    clearAll(d, rec, 6)
    d.secretFound = true
  })
  await open({ from: 'mw06', exit: 'secret' })
  st = await state()
  check(st.phase === 'show' && st.pending === 2 && st.lit.includes('mw03') && !st.lit.includes('rivals'), `secret exit from MW06: two legs to draw, MW03 stays lit, Rival Row dark (${st.pending})`)
  const order = []
  let mw03Dark = false
  for (let i = 0; i < 90 && st.phase === 'show'; i++) {
    await step(6)
    st = await state()
    if (st.drawing && order[order.length - 1] !== st.drawing) order.push(st.drawing)
    if (!st.lit.includes('mw03')) mw03Dark = true
  }
  check(order.join() === 's1,s0', 'it draws from MW06 to Rival Row, then on to MW03 (' + order.join() + ')')
  check(!mw03Dark && st.lit.includes('rivals') && st.phase === 'idle', 'MW03 never went dark; Rival Row lit at the end')

  /* 4. Rival Row: rivals unmasked as they are beaten, then the crown */
  await setSave((d, rec) => {
    clearAll(d, rec, 6)
    d.secretFound = true
  })
  await open({ from: 'rivals', exit: 'quit' }, true)
  st = await settle()
  check(st.node === 'rivals' && st.beatenShown === 0, 'back from Rival Row with none beaten: Maxx stands there, four shadows')
  await setSave((d, rec) => {
    clearAll(d, rec, 6)
    d.secretFound = true
    d.rivalsBeaten = 2
  })
  await audio()
  await open({ from: 'rivals', exit: 'quit' })
  st = await state()
  check(st.phase === 'show' && st.pending === 2 && st.beatenShown === 0, `two rivals beaten since: two to unmask (${st.pending})`)
  const rv = []
  const rvBanners = new Set()
  for (let i = 0; i < 40 && st.phase === 'show'; i++) {
    await step(5)
    st = await state()
    if (st.banner) rvBanners.add(st.banner)
    if (i % 2 === 0 && rv.length < 12) rv.push(await ev(() => window.__t.zoom(458, 262, 100, 56, 2)))
  }
  st = await settle()
  check(st.beatenShown === 2 && [...rvBanners].join() === 'RIVALS BEATEN 1/4,RIVALS BEATEN 2/4', `unmasked one by one (${[...rvBanners].join(', ')})`)
  check((await audio()).includes('sfx:powerup'), 'each with a sound')
  await strip('rivals-unmasked-frames', rv, 4)
  check(st.roads.includes('s1'), 'with MW06 open the hidden road runs on to MW06 too')
  check(st.bar.extra.startsWith('RIVALS 2/4'), `the bar counts them (${st.bar.extra})`)
  await pic('rival-row-2-beaten')
  await zoom('rival-row-2-beaten-4x', 458, 262, 140, 80, 4)
  await zoom('bar-rivals-3x', 320, 340, 640, 40, 3)
  const ws1 = await walk('mw06', snap(ends('rivals').find((e) => e.to === 'mw06').dx, ends('rivals').find((e) => e.to === 'mw06').dy))
  check(ws1.ok, 'Rival Row to MW06 on the second leg')
  await walk('rivals', snap(ends('mw06').find((e) => e.to === 'rivals').dx, ends('mw06').find((e) => e.to === 'rivals').dy))
  await setSave((d, rec) => {
    clearAll(d, rec, 6)
    rec('rivals').cleared = true
    d.secretFound = true
    d.rivalsBeaten = 4
    d.champion = true
  })
  await open({ from: 'rivals', exit: 'goal' })
  st = await state()
  check(st.pending === 3 && !st.crown, `the last two, then the crown (${st.pending})`)
  const cr = []
  let sawChamp = false
  for (let i = 0; i < 60 && st.phase === 'show'; i++) {
    await step(4)
    st = await state()
    if (st.banner === 'CHAMPION OF RIVAL ROW!') sawChamp = true
    if (st.showing === 'crown' && cr.length < 8) cr.push(await ev(() => window.__t.zoom(466, 286, 100, 56, 2)))
  }
  st = await settle()
  check(sawChamp && st.crown && st.beatenShown === 4, 'CHAMPION OF RIVAL ROW! and the crown drops onto the sign')
  check(st.bar.extra.startsWith('CHAMPION'), `the bar says so (${st.bar.extra})`)
  if (cr.length) await strip('crown-drop-frames', cr, 4)
  await step(60)
  await zoom('rival-row-champion-4x', 458, 268, 140, 80, 4)
  await pic('rival-row-champion')
  // and nothing again on the next visit
  await open({ from: 'rivals', exit: 'quit' })
  st = await state()
  check(st.phase === 'idle' && st.crown && st.beatenShown === 4, 'the next visit shows it all at once')

  /* 5. Half way, complete, spotless everywhere */
  await setSave((d, rec) => clearAll(d, rec, 4))
  await open({}, true)
  await step(90)
  st = await state()
  check(st.node === 'mw05' && st.lit.includes('mw05') && !st.lit.includes('mw06'), `half way: Maxx waits at the frontier, MW05 (${st.node})`)
  await pic('half-way')

  await setSave((d, rec) => {
    clearAll(d, rec, 8)
    d.secretFound = true
    d.finished = true
    d.rivalsBeaten = 4
    d.champion = true
    rec('rivals').cleared = true
  })
  await open({}, true)
  await step(90)
  st = await state()
  check(st.roads.length === meta.roads.length && st.lit.length === Object.keys(meta.sites).length, 'complete: every road paved, every site lit')
  await pic('complete')
  const fw = []
  for (let i = 0; i < 8; i++) {
    await step(9)
    fw.push(await ev(() => window.__t.zoom(540, 170, 160, 110, 2)))
  }
  await strip('finished-fireworks', fw, 4)

  await setSave((d, rec) => {
    clearAll(d, rec, 8, { spotless: true, allTokens: true })
    d.secretFound = true
    d.finished = true
  })
  await open({}, true)
  await step(90)
  await pic('spotless-everywhere')
  await zoom('spotless-badges-2x', 200, 160, 400, 320, 2)

  /* 6. Every save state: what is lit is what can be reached, and Maxx stands somewhere he can walk from */
  const thumbs = []
  for (let u = 1; u <= 8; u++) {
    for (const secret of [false, true]) {
      for (const beaten of secret && u >= 4 ? [0, 2, 4] : [0]) {
        await ev((a) => {
          const s = window.__maxx.ctx.save
          s.reset()
          const ids = ['mw01', 'mw02', 'mw03', 'mw04', 'mw05', 'mw06', 'mw07', 'mw08']
          for (let i = 0; i < a.u - 1; i++) s.record(ids[i]).cleared = true
          s.data.unlocked = a.u
          s.data.secretFound = a.secret
          s.data.rivalsBeaten = a.beaten
          s.data.champion = a.beaten === 4
          s.commit()
        }, { u, secret, beaten })
        await open({}, true)
        st = await settle()
        // The hidden road starts at MW03: Rival Row can be reached once MW03 is open.
        const reachable = secret && u >= 3
        const okLit = st.lit.includes('mw0' + u) && !st.lit.includes('mw0' + (u + 1)) && st.lit.includes('rivals') === reachable
        check(st.phase === 'idle' && okLit && st.lit.includes(st.node) && st.beatenShown === (reachable ? beaten : st.beatenShown), `unlocked ${u}${secret ? ', secret found' : ''}${beaten ? `, ${beaten} beaten` : ''}: stands at ${st.node}, lit ${st.lit.length}, roads ${st.roads.length}`)
        if (!beaten && (!secret || u === 4 || u === 8)) thumbs.push(await native())
      }
    }
  }
  await strip('every-unlock-state', thumbs, 4)

  // Saves no build writes, but a hand edit could: nothing may strand Maxx.
  await ev(() => {
    const s = window.__maxx.ctx.save
    s.reset()
    s.record('mw03').cleared = true
    s.data.unlocked = 1
    s.commit()
  })
  await open({}, true)
  st = await settle()
  check(st.node === 'mw01' && !st.lit.includes('mw03'), `MW03 cleared but no way there: shown locked, Maxx at the furthest site he can reach (${st.node})`)
  await ev(() => {
    const s = window.__maxx.ctx.save
    s.reset()
    s.data.secretFound = true
    s.commit()
  })
  await open({}, true)
  st = await settle()
  check(st.node === 'hq' && !st.lit.includes('rivals'), 'secret found on a fresh save: Rival Row stays dark until a road can reach it')

  /* 7. Back from every level by every exit, as the play scene leaves the save */
  for (let k = 0; k < 8; k++) {
    const id = 'mw0' + (k + 1)
    for (const exit of ['goal', 'secret', 'quit']) {
      const before = { u: k + 1, secret: false }
      const after = { u: exit === 'quit' ? k + 1 : Math.min(8, k + 2), secret: exit === 'secret', cleared: exit === 'quit' ? k : k + 1 }
      const put = (a) =>
        ev((a) => {
          const s = window.__maxx.ctx.save
          s.reset()
          const ids = ['mw01', 'mw02', 'mw03', 'mw04', 'mw05', 'mw06', 'mw07', 'mw08']
          for (let i = 0; i < a.cleared; i++) s.record(ids[i]).cleared = true
          s.data.unlocked = a.u
          s.data.secretFound = a.secret
          s.commit()
        }, a)
      await put({ ...before, cleared: k })
      await open({ from: id, exit: 'quit' }, true)
      await put(after)
      await open({ from: id, exit })
      const first = await state()
      st = await settle()
      // The road on to the next site, unless this is the last; with 'secret' the hidden road's legs
      // whose far ends are open now (MW03 open from k = 1 on, MW06 from k = 4 on).
      const wantNew = exit === 'quit' ? 0 : (k < 7 ? 1 : 0) + (exit === 'secret' ? (k >= 1 ? 1 : 0) + (k >= 4 ? 1 : 0) : 0)
      check(st.phase === 'idle' && st.node === id && first.pending === wantNew, `from ${id} by '${exit}': ${first.pending} flourish(es), stands at ${st.node}`)
    }
  }
  say('errors so far: ' + JSON.stringify(await ev(() => Array.from(window.__maxx.errors))))

  // Params that name nothing the map knows
  await setSave((d, rec) => clearAll(d, rec, 3))
  for (const p of [{ from: 'zzz', exit: 'goal' }, { from: 'constructor', exit: 'goal' }, { from: '__proto__', exit: 'secret' }, { from: 'sandbox', exit: 'secret' }, { from: 'dev-cars', exit: 'goal' }, { from: 42, exit: null }, { from: 'mw07', exit: 'goal' }, { from: 'mw02', exit: 'banana' }]) {
    await open(p, true)
    st = await settle()
    check(st.phase === 'idle' && st.pending === 0 && ['mw04', 'mw02'].includes(st.node), `params ${JSON.stringify(p)}: idle at ${st.node}, nothing announced`)
  }

  /* 8. Every road, both ways, with a rough push snapped to eight directions; Maxx keeps to the line */
  await setSave((d, rec) => {
    clearAll(d, rec, 8)
    d.secretFound = true
  })
  await open({ from: 'hq', exit: 'quit' }, true)
  await step(5)
  const route = ['hq', 'mw01', 'mw02', 'mw03', 'mw04', 'mw05', 'mw06', 'mw07', 'mw08']
  const walkShots = []
  let worst = 0
  for (let i = 0; i + 1 < route.length; i++) {
    const e = ends(route[i]).find((x) => x.to === route[i + 1])
    const dirs = snap(e.dx, e.dy)
    await hold(dirs, 2)
    await release()
    let s = await state()
    for (let k = 0; k < 200 && s.phase === 'walk'; k++) {
      worst = Math.max(worst, offRoad(s.road, s.maxx[0], s.maxx[1]))
      await step(2)
      s = await state()
      if (k === 10) walkShots.push(await native())
    }
    await step(14)
    s = await state()
    check(s.node === route[i + 1], `${route[i]} -> ${route[i + 1]} pushing '${dirs}' (at ${s.node})`)
  }
  for (let i = route.length - 1; i > 0; i--) {
    const e = ends(route[i]).find((x) => x.to === route[i - 1])
    const w = await walk(route[i - 1], snap(e.dx, e.dy))
    worst = Math.max(worst, w.stray)
    check(w.ok, `${route[i]} -> ${route[i - 1]} pushing '${snap(e.dx, e.dy)}' (${w.at})`)
  }
  await open({ from: 'mw03', exit: 'quit' })
  await step(3)
  for (const [a, b] of [['mw03', 'rivals'], ['rivals', 'mw06'], ['mw06', 'rivals'], ['rivals', 'mw03']]) {
    const e = ends(a).find((x) => x.to === b)
    const w = await walk(b, snap(e.dx, e.dy))
    worst = Math.max(worst, w.stray)
    check(w.ok, `${a} -> ${b} pushing '${snap(e.dx, e.dy)}' (${w.at})`)
  }
  check(worst < 1.5, `his feet never leave the road's line by more than ${worst.toFixed(2)} px`)
  await strip('walking-each-road', walkShots, 4)
  // A bend, frame by frame, at 3x: MW04 -> MW05 swings round under the storm.
  await open({ from: 'mw03', exit: 'quit' })
  await step(3)
  const bend = []
  await hold('up', 2)
  await release()
  for (let k = 0; k < 16; k++) {
    await step(3)
    bend.push(await ev(() => window.__t.zoom(300, 190, 120, 90, 2)))
  }
  await settle()
  await strip('a-bend-frame-by-frame', bend, 8)

  // Where each push goes from the junctions and the ends, all eight ways.
  const table = []
  for (const id of ['hq', 'mw03', 'mw05', 'mw06', 'rivals', 'mw08']) {
    const row = [id]
    for (const d of ['up', 'down', 'left', 'right', 'right up', 'right down', 'left up', 'left down']) {
      await open({ from: id, exit: 'quit' })
      await step(3)
      await hold(d, 2)
      await release()
      const s = await settle()
      row.push(`${d}:${s.node}`)
    }
    table.push(row.join('  '))
  }
  say('where each push goes:')
  for (const r of table) say('    ' + r)

  // Held, he walks on from site to site, and never straight back the way he came.
  const heldRun = async (from, d, ticks) => {
    await open({ from, exit: 'quit' })
    await step(3)
    const seen = [from]
    await ev((d) => window.__maxx.hold(d), d)
    for (let i = 0; i < ticks / 5; i++) {
      await ev(() => window.__maxx.step(5))
      const s = await state()
      if (s.phase === 'idle' && seen[seen.length - 1] !== s.node) seen.push(s.node)
    }
    await release()
    return seen
  }
  for (const [from, d] of [['hq', 'right'], ['mw06', 'up'], ['mw05', 'up'], ['mw08', 'up'], ['mw03', 'right']]) {
    const seen = await heldRun(from, d, 1200)
    const bounced = seen.some((x, i) => i >= 2 && seen[i - 2] === x)
    check(!bounced && seen.length > 1, `holding ${d} from ${from}: ${seen.join(' > ')}`)
  }

  /* 9. Going in: confirm, confirm late in a walk, cancel during the iris, and twenty trips */
  say('MW01 level: ' + (await standIn('mw01', true)))
  await setSave((d, rec) => clearAll(d, rec, 0))
  await open({ from: 'mw01', exit: 'quit' }, true)
  await step(3)
  st = await state()
  check(st.bar.prompt.includes('PLAY'), `a site with a level offers PLAY (${st.bar.prompt})`)
  await audio()
  await hold('confirm', 1)
  await release()
  check((await audio()).includes('sfx:mapEnter'), 'confirm on a site with a level: mapEnter')
  await step(5)
  await hold('cancel', 1)
  await release()
  await hold('confirm', 1)
  await release()
  await step(40)
  check((await scene()) === 'play', 'and the play scene starts; cancel and confirm during the iris change nothing (' + (await scene()) + ')')
  // the way back opens on Maxx
  await ev(() => window.__maxx.go('map', { from: 'mw01', exit: 'quit' }, 'iris'))
  const irisShots = []
  for (let i = 0; i < 40; i++) {
    await step(1)
    if ((await scene()) === 'map' && irisShots.length < 8 && i % 2 === 0) irisShots.push(await native())
  }
  await strip('iris-opens-on-maxx', irisShots, 4)
  // confirm early in a walk is dropped, late in a walk is kept for the arrival
  await open({ from: 'hq', exit: 'quit' })
  await step(3)
  await hold('right', 2)
  await release()
  await step(3)
  await hold('confirm', 1)
  await release()
  st = await settle()
  check(st.node === 'mw01' && (await scene()) === 'map', 'confirm early in a walk is dropped')
  await open({ from: 'hq', exit: 'quit' })
  await step(3)
  await hold('right', 2)
  await release()
  st = await state()
  for (let i = 0; i < 100 && st.phase === 'walk'; i++) {
    await step(1)
    st = await state()
    if (st.phase === 'walk' && offRoad(st.road, st.maxx[0], st.maxx[1]) < 2 && Math.hypot(st.maxx[0] - meta.nodes.mw01[0], st.maxx[1] - meta.nodes.mw01[1]) < 12) break
  }
  await hold('confirm', 1)
  await release()
  await step(30)
  check((await scene()) === 'play', 'confirm in the last moments of a walk enters on arrival (' + (await scene()) + ')')

  await open({ from: 'mw01', exit: 'quit' })
  await step(2)
  await audio()
  const heap0 = await ev(() => performance.memory?.usedJSHeapSize ?? 0)
  for (let i = 0; i < 20; i++) {
    await settle()
    await hold('confirm', 1)
    await release()
    await step(50)
    await ev(() => window.__maxx.go('map', { from: 'mw01', exit: 'quit' }, 'fade'))
    await step(50)
  }
  st = await settle()
  const dbg = await ev(() => {
    const d = window.__maxx.ctx.audio.debug?.()
    return d ? { want: d.want, song: d.song, jingle: d.jingle } : null
  })
  const heap1 = await ev(() => performance.memory?.usedJSHeapSize ?? 0)
  const trips = await audio()
  const count = (x) => trips.filter((a) => a === x).length
  check((await scene()) === 'map' && st.phase === 'idle' && st.node === 'mw01', 'twenty trips into the level and back: on the map, standing at MW01')
  check(count('sfx:mapEnter') === 20 && count('music:map') >= 20 && (!dbg || (dbg.want === 'map' && !dbg.jingle)), `one mapEnter a trip, the map song back each time, nothing left playing (${count('sfx:mapEnter')} mapEnter, audio ${JSON.stringify(dbg)})`)
  say(`heap ${(heap0 / 1e6).toFixed(1)} MB -> ${(heap1 / 1e6).toFixed(1)} MB over twenty trips (no forced GC)`)
  check((await standIn('mw01', false)) !== 'stand-in', 'the MW01 stand-in is undone')
  await open({ from: 'mw01', exit: 'quit' })
  await step(3)

  /* 10. Cancel goes back to the title */
  await hold('cancel', 1)
  await release()
  await step(40)
  check((await scene()) === 'title', 'cancel goes back to the title (' + (await scene()) + ')')
  check((await audio()).includes('sfx:menuBack'), 'with menuBack')

  /* 11. The controller: D-pad, stick, A and B, and its prompts */
  await setSave((d, rec) => clearAll(d, rec, 3))
  await open({ from: 'mw02', exit: 'quit' }, true)
  await step(3)
  await zoom('bar-keyboard-3x', 320, 340, 640, 40, 3)
  await ev(() => {
    const pad = {
      id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    }
    window.__pad = pad
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] })
    window.__btn = (i, down) => {
      pad.buttons[i] = { pressed: !!down, touched: !!down, value: down ? 1 : 0 }
      pad.timestamp++
    }
    window.__stick = (x, y) => {
      pad.axes[0] = x
      pad.axes[1] = y
      pad.timestamp++
    }
  })
  const btn = (i, down) => ev((i, d) => window.__btn(i, d), i, down)
  const stick = (x, y) => ev((x, y) => window.__stick(x, y), x, y)
  const A = 0
  const B = 1
  const RIGHT = 15
  await btn(RIGHT, true)
  await step(2)
  await btn(RIGHT, false)
  st = await settle()
  check(st.node === 'mw03', `D-pad right on the controller walks MW02 -> MW03 (${st.node})`)
  const dev = await ev(() => window.__maxx.ctx.input.device)
  check(dev === 'gamepad', 'the controller is the device in use')
  await zoom('bar-controller-3x', 320, 340, 640, 40, 3)
  await pic('controller-prompts')
  // the stick, pushed down-left (toward MW02, which is down and to the left of MW03)
  await stick(-0.75, 0.66)
  await step(3)
  await stick(0, 0)
  // (pushed during his hop on arrival: kept, and walked once the hop is done)
  await step(12)
  st = await settle()
  check(st.node === 'mw02', `the stick down-left walks MW03 -> MW02 (${st.node})`)
  // a lazy diagonal: the stick crosses the side threshold a tick before the down one
  await stick(0.9, 0.2)
  await step(1)
  await stick(0.75, 0.66)
  await step(3)
  await stick(0, 0)
  await step(12)
  st = await settle()
  check(st.node === 'mw01' || st.node === 'mw03', `a stick rolled from right to down-right still walks (${st.node})`)
  // MW02's level hidden: A answers COMING SOON and stays on the map, so B is seen there too.
  check(await hide('mw02', true), "MW02's level hidden for the A and B presses")
  await open({ from: 'mw02', exit: 'quit' })
  await step(3)
  await btn(A, true)
  await step(1)
  await btn(A, false)
  await step(2)
  st = await state()
  check(st.note === 'COMING SOON', 'A is confirm on the map')
  await btn(B, true)
  await step(1)
  await btn(B, false)
  await step(30)
  check((await scene()) === 'title', 'B is cancel on the map')
  check(await hide('mw02', false), "MW02's level is back")
  await ev(() => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [null, null, null, null] })
  })

  /* 12. The scenery, enlarged, with time running so everything is somewhere in its cycle */
  await setSave((d, rec) => {
    clearAll(d, rec, 7)
    d.secretFound = true
    d.rivalsBeaten = 1
  })
  await open({ from: 'mw04', exit: 'quit' }, true)
  await step(420)
  await pic('scenery')
  for (const [s, x, y, w, h] of [
    ['tour-west-texas-town', 140, 210, 200, 110],
    ['tour-hq-ranch', 80, 280, 170, 80],
    ['tour-mw04-storm', 220, 110, 200, 110],
    ['tour-mw05-oil', 70, 130, 160, 90],
    ['tour-wind-farm', 250, 50, 240, 100],
    ['tour-river-bridge', 420, 60, 140, 90],
    ['tour-mw07-snow', 560, 60, 160, 120],
    ['tour-mw08-night', 560, 260, 160, 110],
    ['tour-rival-row', 450, 260, 160, 100],
    ['tour-sandhills', 320, 300, 160, 70],
  ]) {
    await zoom(s + '-4x', x, y, w, h, 4)
  }
  const tr = []
  for (let i = 0; i < 12; i++) {
    await step(60)
    tr.push(await ev(() => window.__t.zoom(320, 170, 640, 60, 2)))
  }
  await strip('train-and-crossings', tr, 2)
  // Thunder under the storm: not every strike, it is a long rumble.
  await audio()
  await step(1800)
  const th = (await audio()).filter((a) => a === 'sfx:thunder').length
  check(th >= 2 && th <= 5, `thunder while standing at MW04 for 30 s: ${th} times`)
  const ms = await ev(() => {
    const m = window.__maxx
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 360
    const g = c.getContext('2d')
    const s = m.sceneObject()
    const t0 = performance.now()
    for (let i = 0; i < 200; i++) s.render(m.ctx, g)
    return (performance.now() - t0) / 200
  })
  say(`render: ${ms.toFixed(2)} ms a frame (headless, software canvas)`)

  /* 13. What the map has shown is in the save (save.data.map): it survives a reload */
  await setSave((d, rec) => clearAll(d, rec, 2))
  await open({ from: 'mw02', exit: 'quit' }, true)
  st = await settle()
  check(st.phase === 'idle' && st.node === 'mw02' && !st.lit.includes('mw04'), 'MW02 cleared: the map has looked, MW04 is dark')
  // MW03 cleared since, and the page reloaded before the map was seen again (CONTINUE: no from, no exit).
  await setSave((d, rec) => clearAll(d, rec, 3))
  const errors = await ev(() => Array.from(window.__maxx.errors))
  const reload = async () => {
    const url = new URL(page.url())
    url.searchParams.delete('fresh')
    await page.goto(url.toString(), { waitUntil: 'load' })
    await page.waitForFunction('window.__maxx && window.__maxx.ready === true', { timeout: 30000 })
    // The check's own reload: shot.mjs is to watch this game now.
    await ev(() => {
      window.__maxxRun = window.__maxx.handle
    })
    await install(maxx)
    await step(1)
  }
  await reload()
  st = await state()
  check((await scene()) === 'map' && st.phase === 'show' && st.pending === 1 && st.node === 'mw02', `after a reload the road MW03's clear opened still has its flourish (${st.phase}, ${st.pending}), Maxx where he left the map (${st.node})`)
  st = await settle()
  check(st.phase === 'idle' && st.lit.includes('mw04'), 'and MW04 lights')
  await reload()
  st = await state()
  check(st.phase === 'idle' && st.pending === 0 && st.lit.includes('mw04'), `reloaded again: nothing announced twice (${st.pending})`)
  await pic('after-reload')

  errors.push(...(await ev(() => Array.from(window.__maxx.errors))))
  check(errors.length === 0, 'no scene threw (' + errors.join(' | ') + ')')
  say(problems.length ? `${problems.length} FAILED` : 'all map checks passed')
  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(problems.join('; '))
}
