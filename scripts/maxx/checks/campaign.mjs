// Check: the whole game, start to finish, through the real scenes from a fresh save. A --script
// for scripts/maxx/shot.mjs on the title (user 'campaign'):
//
//   node scripts/maxx/serve.mjs --port <port> -- node scripts/maxx/shot.mjs --port <port> --w 1280 --h 830
//     --q "scene=title&manual=1&fresh=1&user=campaign" --script scripts/maxx/checks/campaign.mjs --out <folder>/end.png
//
// PRESS START, NEW GAME, then on the map Maxx walks to each site in turn and confirm plays it:
// MW01, MW02, MW03 out by its secret exit, Rival Row along the hidden road that opens, back to
// MW04 and on to MW08, and the ending. Each level is played by its stored solver run
// (scripts/maxx/replays/<id>-goal.json, mw03-secret.json) fed tick by tick to the real play
// scene, card, iris, versus cards and all, with the world hash compared with Node's every 600
// ticks (replay.mjs playInPage). After each: the world the play scene built matches the solver's
// at tick 0, the save on the tick of the clear (cleared, best score and time, tokens, spotless,
// unlocked, secretFound, the rivals, finished), the tally's stages, the way out, and the map
// drawing in exactly the roads that clear opened, lighting the next site. Rival Row's clear makes
// him champion; MW08's leads to the ending (champion card, 8 of 8) and back to a title that
// offers CONTINUE.
//
// The solver records every run from a fresh session (3 lives, no score, no coins, full shine,
// no turbo nozzle); the play scene builds its world from the session the last level left, and
// the world hash covers it. So before each confirm the session is put back to what the run was
// recorded with, and what the previous level had left is printed beside it. A stored run that no
// longer plays in Node (its level changed under it) fails here and is solved again in Node, so
// the rest of the campaign is still played; if that fails too, Rival Row (off the main road) is
// left out and the rest goes on, and a main level stops the campaign there.
//
// Pictures (key moments 1x, each level's run every 600 ticks in <folder>/<level>/, a contact sheet
// per level and one of the campaign) and report.txt land in <folder>. Exit code 1 if any check fails.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { install, saver } from './lib.mjs'
import { loadOne, openGame } from '../level.mjs'
import { createSolver, decodeInput, formatResult, frameFor, playReplay, REPLAY_FORMAT } from '../lib/solver.mjs'
import { Canvas } from '../pix.mjs'
import { playInPage } from '../replay.mjs'

const REPLAYS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'replays')
const SAVE_KEY = 'smm.save.v1.campaign'
/** Ticks between world hash comparisons, and between pictures of a level being played. */
const EVERY = 600

/**
 * The campaign in the order a player meets it. `opens`: the roads (by their two ends) the map
 * draws in on the way back, and `banners` what it says as it does; null for the last level,
 * which leads to the ending instead.
 */
const CAMPAIGN = [
  { id: 'mw01', run: 'mw01-goal', opens: [['mw01', 'mw02']], banners: ['NOW OPEN: MW02'] },
  { id: 'mw02', run: 'mw02-goal', opens: [['mw02', 'mw03']], banners: ['NOW OPEN: MW03'] },
  { id: 'mw03', run: 'mw03-secret', opens: [['mw03', 'mw04'], ['mw03', 'rivals']], banners: ['NOW OPEN: MW04', 'A HIDDEN ROAD!'] },
  { id: 'rivals', run: 'rivals-goal', opens: [], banners: ['RIVALS BEATEN 1/4', 'RIVALS BEATEN 2/4', 'RIVALS BEATEN 3/4', 'RIVALS BEATEN 4/4', 'CHAMPION OF RIVAL ROW!'] },
  { id: 'mw04', run: 'mw04-goal', opens: [['mw04', 'mw05']], banners: ['NOW OPEN: MW05'] },
  { id: 'mw05', run: 'mw05-goal', opens: [['mw05', 'mw06'], ['rivals', 'mw06']], banners: ['NOW OPEN: MW06', 'THE HIDDEN ROAD GOES ON!'] },
  { id: 'mw06', run: 'mw06-goal', opens: [['mw06', 'mw07']], banners: ['NOW OPEN: MW07'] },
  { id: 'mw07', run: 'mw07-goal', opens: [['mw07', 'mw08']], banners: ['NOW OPEN: MW08'] },
  { id: 'mw08', run: 'mw08-goal', opens: null, banners: null },
]
const MAIN = ['mw01', 'mw02', 'mw03', 'mw04', 'mw05', 'mw06', 'mw07', 'mw08']

/** What a world says about where and how a level starts: enough to name the difference when the hashes part. */
const startFacts = (w) => ({
  area: w.area.id,
  x: w.player.x,
  y: w.player.y,
  session: { ...w.session },
  flags: { ...w.flags },
  tokens: [...w.stats.tokens],
  seed: w.seed,
  timeLeft: w.timeLeft,
  checkpoint: w.checkpoint,
})
const differences = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k} ${JSON.stringify(b[k])}, the solver's ${JSON.stringify(a[k])}`)

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
    return ok
  }
  const logs = []
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))

  await install(maxx)
  const ev = (fn, ...args) => page.evaluate(fn, ...args)
  const step = (n = 1) => ev((n) => window.__t.run(null, n), n)
  const hold = (actions, n) => ev((a, n) => window.__t.run(a, n), actions, n)
  const release = () => ev(() => window.__maxx.release())
  const tap = async (actions) => {
    await hold(actions, 1)
    await release()
    await step(1)
  }
  const scene = () => ev(() => window.__maxx.scene())
  const mapState = () => ev(() => (window.__maxx.scene() === 'map' ? window.__maxx.sceneObject().state() : null))
  const playState = () => ev(() => (window.__maxx.scene() === 'play' ? window.__maxx.sceneObject().state() : null))
  const saved = () => ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY)
  const session = () => ev(() => ({ ...window.__maxx.ctx.session }))
  const audio = () => ev(() => window.__rec.audio.splice(0))
  const lastGo = () => ev(() => window.__rec.go[window.__rec.go.length - 1] ?? null)
  let n = 0
  /** The game's own 640x360 picture, numbered in the order taken; returns the file. */
  const pic = async (name) => save(String(++n).padStart(2, '0') + '-' + name + '.png', await ev(() => window.__t.native()))

  await ev(() => {
    const m = window.__maxx
    const rec = window.__rec
    rec.go = []
    const go = m.ctx.go
    m.ctx.go = (id, params, tr) => {
      rec.go.push([id, params ?? {}, tr ?? 'fade'])
      // The debug readout is a dev page overlay, not part of the game: pictures as a player sees them.
      return go(id, id === 'play' ? { ...params, readout: false } : params, tr)
    }
    // Step until src (over s, the scene's state, and m) is true; ticks taken, or -1.
    window.__until = (src, max) => {
      const fn = new Function('s', 'm', 'return (' + src + ')')
      for (let i = 0; i < max; i++) {
        m.step(1)
        const so = m.sceneObject()
        const st = so && typeof so.state === 'function' ? so.state() : null
        if (fn(st, m)) return i + 1
      }
      return -1
    }
  })
  const until = (src, max = 600) => ev((s, m) => window.__until(s, m), src, max)

  const meta = await ev(() => window.__maxx.ctx.sprites.atlas('map').meta)
  const signs = await ev(async () => {
    const mod = await window.__t.mod('levels/meta.ts')
    return Object.fromEntries([...mod.LEVEL_META, mod.RIVALS_META].map((m) => [m.id, m.site]))
  })
  const timeRate = await ev(async () => (await window.__t.mod('scenes/play.ts')).TIME_BONUS_PER_SECOND)
  const roadOf = (a, b) => meta.roads.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))

  // Which way to push from a site to walk a road: its first stretch, snapped to one of the eight
  // directions a stick or D-pad gives (as checks/map.mjs walks every road).
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
    return { 0: 'right', 1: 'right down', 2: 'down', 3: 'left down', 4: 'left', '-4': 'left', '-3': 'left up', '-2': 'up', '-1': 'right up' }[a]
  }
  /** The sites to walk through to get from one to another along the roads the map shows. */
  const route = (paved, from, to) => {
    const prev = new Map([[from, null]])
    const queue = [from]
    while (queue.length) {
      const at = queue.shift()
      if (at === to) break
      for (const e of ends(at)) {
        if (!paved.includes(e.road) || prev.has(e.to)) continue
        prev.set(e.to, at)
        queue.push(e.to)
      }
    }
    if (!prev.has(to)) return null
    const out = []
    for (let at = to; at !== from; at = prev.get(at)) out.unshift(at)
    return out
  }
  /** Walk Maxx to a site, a road at a time, with a rough push and letting go, as a player does. */
  const walkTo = async (target) => {
    let st = await mapState()
    const way = route(st.roads, st.node, target)
    if (!way) return `no paved way from ${st.node} to ${target} (${st.roads.join(' ')})`
    for (const next of way) {
      const e = ends(st.node).find((x) => x.to === next && st.roads.includes(x.road))
      if (!e) return `no paved road from ${st.node} to ${next}`
      const dirs = snap(e.dx, e.dy)
      await hold(dirs, 2)
      await release()
      await until("s && s.phase !== 'walk'", 1200)
      // His hop on arrival: a push during it would wait for it anyway.
      await step(14)
      st = await mapState()
      if (st.node !== next) return `pushing '${dirs}' onto ${e.road} toward ${next} left him at ${st.node}`
    }
    return ''
  }
  /** Contact sheet: pictures at half size, `cols` across, each with its caption. */
  const sheet = (file, items, cols = 4) => {
    const fw = 320
    const fh = 180
    const cap = 14
    const gap = 6
    const rows = Math.ceil(items.length / cols)
    const out = new Canvas(gap + cols * (fw + gap), gap + rows * (fh + cap + gap), '#16161d')
    items.forEach((it, i) => {
      const x = gap + (i % cols) * (fw + gap)
      const y = gap + Math.floor(i / cols) * (fh + cap + gap)
      out.text(x, y + 2, it.caption, it.bad ? '#ff6b6b' : '#f7f4f8', 2)
      const src = Canvas.load(it.file)
      const kx = src.w / fw
      const ky = src.h / fh
      const half = new Canvas(fw, fh)
      for (let yy = 0; yy < fh; yy++) for (let xx = 0; xx < fw; xx++) half.d[yy * fw + xx] = src.d[Math.floor(yy * ky) * src.w + Math.floor(xx * kx)]
      out.blit(half, x, y + cap)
    })
    out.save(path.join(OUT, file))
    console.log('[saved] ' + path.join(OUT, file))
  }

  // Node: the same game from disk, now, while the page has just loaded it.
  const game = await openGame()
  const story = []
  try {
    const runs = {}
    for (const c of CAMPAIGN) {
      const { level } = await loadOne(game, c.id)
      const rep = JSON.parse(readFileSync(path.join(REPLAYS, c.run + '.json'), 'utf8'))
      if (rep.format !== REPLAY_FORMAT || rep.level !== c.id) throw new Error(`${c.run}.json is not a replay of ${c.id}`)
      runs[c.id] = { level, rep }
    }

    /* ---------------- the title: NEW GAME on a fresh save ---------------- */
    say('== the title, NEW GAME ==')
    await step(72)
    let t = await ev(() => ({ state: window.__maxx.sceneObject().state }))
    check((await scene()) === 'title' && t.state === 'press', 'the dev page opens on the title, PRESS START')
    story.push({ file: await pic('title'), caption: 'TITLE' })
    await tap('confirm')
    t = await ev(() => ({ state: window.__maxx.sceneObject().state, labels: [...window.__maxx.sceneObject().labels] }))
    check(t.state === 'menu' && t.labels[0] === 'NEW GAME' && !t.labels.includes('CONTINUE'), `a fresh save: the menu starts at NEW GAME, no CONTINUE (${t.labels.join(', ')})`)
    await tap('confirm')
    await until("m.scene() === 'map'", 120)
    await step(40)
    let st = await mapState()
    const ses0 = await session()
    if (!check(st && st.node === 'hq' && st.phase === 'idle', `NEW GAME: the map, Maxx at HQ (${st?.node}, ${st?.phase})`)) throw new Error(`NEW GAME did not reach the map (${await scene()})`)
    check(st.roads.join() === roadOf('hq', 'mw01').id && st.lit.includes('mw01') && !st.lit.includes('mw02'), 'only the road to MW01 is paved, only MW01 lit')
    check(ses0.lives === 3 && ses0.score === 0 && ses0.coins === 0, 'a fresh session: 3 lives, no score, no coins ' + JSON.stringify(ses0))
    story.push({ file: await pic('map-new-game'), caption: 'NEW GAME' })

    /* ---------------- each level, in the order a player meets them ---------------- */
    const want = { unlocked: 1, secretFound: false, rivalsBeaten: 0, champion: false, finished: false, hiScore: 0 }
    let stopped = ''
    const skipped = new Set()
    for (const c of CAMPAIGN) {
      const sign = signs[c.id] ?? c.id.toUpperCase()
      const tag = c.id === 'rivals' ? 'RIVAL ROW' : sign
      say(`== ${tag}: ${c.run}.json ==`)
      let { level, rep } = runs[c.id]

      // Node first: the stored run against today's code, and what it ends with. Each attempt's
      // world is kept: the save's best time is the whole visit, the attempts grimed included.
      let last = null
      const attempts = new Set()
      const each = (w) => {
        last = w
        attempts.add(w)
      }
      let res = playReplay(game.sim, level, rep, { each })
      if (!check(res.ok, `${c.run}.json plays to its recorded end in Node${res.ok ? '' : ` (it does not: ${level.id} or the simulation changed since it was made; node scripts/maxx/replay.mjs scripts/maxx/replays/${c.run}.json --verify)`}`)) {
        const t0 = performance.now()
        // Started as the stored run was (Rival Row: { rivalsBeaten: 0 }, as the play scene starts a first visit).
        const solved = createSolver(game.sim, game.contract, level, { exit: rep.options?.exit ?? 'goal', flags: rep.attempts?.[0]?.flags ?? undefined }).solve()
        for (const l of formatResult(solved)) console.log(`  | ${l}`)
        if (!check(solved.ok, `solved again in Node instead, to go on with the campaign (${((performance.now() - t0) / 1000).toFixed(1)} s)`)) {
          // Rival Row is off the main road: the rest can still be played without it.
          if (c.id === 'rivals') {
            skipped.add(c.id)
            say('  info  Rival Row left out: the campaign goes on to MW04 without it')
            continue
          }
          stopped = `${c.id}: no run that finishes it`
          break
        }
        rep = solved.replay
        attempts.clear()
        res = playReplay(game.sim, level, rep, { each })
      }
      const end = {
        tick: last.tick,
        visitTicks: [...attempts].reduce((sum, w) => sum + w.tick, 0),
        status: last.status,
        exit: last.exit,
        timeLeft: last.timeLeft,
        cars: [last.stats.carsWashed, last.stats.carsTotal],
        tokens: [...last.stats.tokens],
        spotless: game.sim.isSpotless(last),
        score: last.session.score,
      }
      const at = rep.attempts[0]
      const exit = rep.options?.exit ?? 'goal'
      check(end.status === 'clear' && end.exit === exit, `in Node it ends: ${end.status} by the ${end.exit}, ${end.tick} ticks, cars ${end.cars.join('/')}, score ${end.score}`)
      const w0 = game.sim.createWorld(level, { session: { ...at.session }, checkpoint: at.checkpoint ?? null, flags: at.flags ? { ...at.flags } : undefined, tokens: at.tokens ? [...at.tokens] : undefined, seed: rep.seed ?? undefined })
      const nodeStart = { hash: game.sim.worldHash(w0), facts: startFacts(w0) }

      // The map: walk there, and it offers PLAY.
      const before = await mapState()
      const why = await walkTo(c.id)
      st = await mapState()
      if (!check(!why && st.node === c.id && st.phase === 'idle', `walked ${before.node} to ${c.id} on the map${why ? ': ' + why : ''}`)) {
        stopped = `${c.id}: could not walk there`
        break
      }
      check(st.bar.prompt.includes('PLAY') && st.bar.sign === sign, `the bar at ${tag}: ${st.bar.sign}, ${st.bar.prompt}${st.bar.extra ? ', ' + st.bar.extra : ''}`)
      const roadsBefore = st.roads
      const litBefore = st.lit

      // The session the run was recorded with, in place of what the last level left.
      const left = await session()
      await ev((s) => Object.assign(window.__maxx.ctx.session, s), at.session)
      const differs = Object.keys(at.session).filter((k) => left[k] !== at.session[k])
      say(`  info  the session ${CAMPAIGN.indexOf(c) ? 'the last level left' : 'NEW GAME made'}: ${JSON.stringify(left)}; the run was recorded from ${JSON.stringify(at.session)}${differs.length ? ` (${differs.join(', ')} put back)` : ' (the same)'}`)
      if (differs.some((k) => k === 'turbo' || k === 'pips')) {
        // What the carried session would have done to the same input (a player's own input differs anyway).
        const w = game.sim.createWorld(level, { session: { ...left }, checkpoint: at.checkpoint ?? null, flags: at.flags ? { ...at.flags } : undefined, tokens: at.tokens ? [...at.tokens] : undefined, seed: rep.seed ?? undefined })
        const masks = decodeInput(at.input)
        let prev = 0
        for (let i = 0; i < masks.length && w.status === 'play'; i++) {
          game.sim.stepWorld(w, frameFor(prev, masks[i]))
          w.events.length = 0
          prev = masks[i] & 63
        }
        const p = w.player
        const where = `${w.area.id} ${Math.floor((p.x + p.w / 2) / 32)},${Math.floor((p.y + p.h - 1) / 32)}`
        const outcome = w.status === 'clear' ? `still clears by the ${w.exit} at tick ${w.tick} (the run's ${end.tick})` : w.status === 'play' ? `the input runs out with him at ${where}, no exit reached` : `${w.status.toUpperCase()} at tick ${w.tick}, ${where}`
        say(`  info  the same input from the carried session (${differs.filter((k) => k === 'turbo' || k === 'pips').map((k) => `${k} ${left[k]}`).join(', ')}): ${outcome}`)
      }

      // In: confirm, the iris, the play scene's own level card.
      await audio()
      await tap('confirm')
      const heard = await audio()
      check(heard.includes('sfx:mapEnter'), 'confirm on the site: mapEnter')
      const into = await until("m.scene() === 'play' && !!m.world()", 200)
      const go1 = await lastGo()
      if (!check(into > 0 && go1[0] === 'play' && go1[1].level === c.id, `and the play scene opens ${c.id} (${JSON.stringify(go1)})`)) {
        stopped = `${c.id}: the play scene did not open it`
        break
      }
      const pageStart = await ev(async () => {
        const sim = await window.__t.mod('sim/index.ts')
        const w = window.__maxx.world()
        return { hash: sim.worldHash(w), facts: { area: w.area.id, x: w.player.x, y: w.player.y, session: { ...w.session }, flags: { ...w.flags }, tokens: [...w.stats.tokens], seed: w.seed, timeLeft: w.timeLeft, checkpoint: w.checkpoint } }
      })
      const startDiff = differences(nodeStart.facts, pageStart.facts)
      check(pageStart.hash === nodeStart.hash, `the play scene builds the world the solver started from (hash ${pageStart.hash}${pageStart.hash === nodeStart.hash ? '' : `, the solver's ${nodeStart.hash}; ${startDiff.join('; ') || 'nothing in the start facts differs'}`})`)
      await until("s && s.phase === 'card' && s.phaseT >= 45", 200)
      const card = await pic(`${c.id}-card`)

      // The stored run, a tick per input frame, through the real scene.
      const dir = path.join(OUT, c.id)
      mkdirSync(dir, { recursive: true })
      const t0 = performance.now()
      const played = await playInPage(page, game.sim, level, rep, { every: EVERY, scene: 'play', dir })
      const frames = rep.attempts.reduce((sum, a) => sum + decodeInput(a.input).length, 0)
      const tries = rep.attempts.length > 1 ? `, ${rep.attempts.length} attempts` : ''
      if (!check(played.mismatches.length === 0, `the play scene plays the run's ${frames} input frames${tries} to the solver's world hash, checked every ${EVERY} and at the end (${((performance.now() - t0) / 1000).toFixed(1)} s)${played.mismatches.length ? ': ' + played.mismatches.slice(0, 3).join('; ') : ''}`)) {
        sheet(`${c.id}-sheet.png`, played.frames.map((f) => ({ file: f.file, caption: f.caption, bad: f.hit })))
        stopped = `${c.id}: the play scene parted from the solver's run`
        break
      }

      // The clear is paid and saved on its tick (the run's last), before the walk and the tally.
      const levelScore = end.score - at.session.score + Math.ceil(end.timeLeft / 60) * timeRate + (end.spotless ? game.sim.TUNING.spotlessBonus : 0)
      const sesNow = await session()
      check(sesNow.score === at.session.score + levelScore, `the session is paid the clock${end.spotless ? ' and SPOTLESS' : ''}: ${sesNow.score} (${end.score} + ${Math.ceil(end.timeLeft / 60)} s x ${timeRate}${end.spotless ? ' + ' + game.sim.TUNING.spotlessBonus : ''})`)
      const sv = await saved()
      const rec = sv?.levels?.[c.id]
      const mainAt = MAIN.indexOf(c.id)
      if (mainAt >= 0) want.unlocked = Math.max(want.unlocked, Math.min(8, mainAt + 2))
      if (exit === 'secret' && (c.id === 'mw03' || c.id === 'mw06')) want.secretFound = true
      if (c.id === 'rivals') {
        want.rivalsBeaten = 4
        want.champion = true
      }
      if (c.id === 'mw08') want.finished = true
      want.hiScore = Math.max(want.hiScore, sesNow.score)
      check(
        !!rec && rec.cleared === true && rec.bestScore === levelScore && rec.bestTicks === end.visitTicks && JSON.stringify(rec.tokens) === JSON.stringify(end.tokens) && rec.spotless === end.spotless,
        `saved on the clear: ${c.id} ${JSON.stringify(rec)} (want best ${levelScore}, ${end.visitTicks} ticks, tokens ${end.tokens.map((x) => (x ? 'Y' : '-')).join('')}, spotless ${end.spotless})`,
      )
      const got = { unlocked: sv.unlocked, secretFound: sv.secretFound, rivalsBeaten: sv.rivalsBeaten, champion: sv.champion, finished: sv.finished, hiScore: sv.hiScore }
      check(JSON.stringify(got) === JSON.stringify(want), `and the rest of the save ${JSON.stringify(got)}${JSON.stringify(got) === JSON.stringify(want) ? '' : ', want ' + JSON.stringify(want)}`)

      // The tally, row by row, then out.
      const toTally = await until("s && s.phase === 'tally'", 900)
      const stages = await ev(() => {
        const m = window.__maxx
        const seen = []
        for (let i = 0; i < 1200; i++) {
          const s = m.sceneObject().state()
          if (seen[seen.length - 1] !== s.tally) seen.push(s.tally)
          if (s.tally === 'done') break
          m.step(1)
        }
        return seen
      })
      const wantStages = ['in', 'cars', ...(end.spotless ? ['spotless'] : []), 'tokens', 'time', 'best', 'done']
      check(toTally > 0 && JSON.stringify(stages) === JSON.stringify(wantStages), `the tally after the fanfare, row by row: ${stages.join(' > ')}`)
      await step(30)
      const tally = await pic(`${c.id}-tally`)
      await tap('confirm')
      const out = await until("m.scene() !== 'play'", 200)
      const go2 = await lastGo()
      const next = c.opens === null ? 'ending' : 'map'
      check(out > 0 && go2[0] === next && go2[1].from === c.id && go2[1].exit === exit && (await scene()) === next, `confirm on the finished tally: '${next}' (${JSON.stringify(go2)})`)
      story.push({ file: card, caption: `${tag} CARD` }, { file: played.frames[Math.floor(played.frames.length / 2)]?.file ?? card, caption: `${tag} PLAYING` }, { file: tally, caption: `${tag} ${exit === 'secret' ? 'SECRET EXIT' : 'CLEAR'}` })

      if (c.opens === null) {
        sheet(`${c.id}-sheet.png`, [{ file: card, caption: 'CARD' }, ...played.frames.map((f) => ({ file: f.file, caption: f.caption, bad: f.hit })), { file: tally, caption: 'TALLY' }])
        break
      }

      // Back on the map: exactly the roads this clear opened draw in, with their banners.
      st = await mapState()
      const wantRoads = c.opens.map(([a, b]) => roadOf(a, b).id)
      const wantEvents = c.banners.length
      check(st.phase === (wantEvents ? 'show' : 'idle') && st.pending === wantEvents && st.node === c.id, `the map, Maxx at ${tag}: ${st.pending} flourish(es) to show (${st.phase})`)
      await audio()
      const banners = []
      let jingle = false
      for (let i = 0; i < 400 && st.phase === 'show'; i++) {
        await step(4)
        st = await mapState()
        if (st.banner && banners[banners.length - 1] !== st.banner) banners.push(st.banner)
        if ((await audio()).includes('jingle:secret')) jingle = true
        if (i === 12) story.push({ file: await pic(`${c.id}-map-flourish`), caption: `${tag} MAP` })
      }
      await step(20)
      st = await mapState()
      const fresh = st.roads.filter((r) => !roadsBefore.includes(r))
      check(st.phase === 'idle' && JSON.stringify(banners) === JSON.stringify(c.banners), `it says ${banners.join(', ') || 'nothing'}`)
      check(JSON.stringify([...fresh].sort()) === JSON.stringify([...wantRoads].sort()), `the roads drawn in: ${fresh.join(' ') || 'none'} (want ${wantRoads.join(' ') || 'none'})`)
      const newLit = st.lit.filter((s) => !litBefore.includes(s))
      const wantLit = [...new Set(c.opens.flat())].filter((s) => !litBefore.includes(s))
      check(JSON.stringify(newLit.sort()) === JSON.stringify(wantLit.sort()), `lit now: ${newLit.join(' ') || 'nothing new'}`)
      if (c.id === 'mw03') check(jingle && st.lit.includes('rivals'), 'the hidden road came with the secret jingle, and Rival Row is lit')
      if (c.id === 'rivals') check(st.crown && st.beatenShown === 4 && st.bar.extra.startsWith('CHAMPION'), `four rivals unmasked and the crown on the sign; the bar says ${st.bar.extra}`)
      const mapPic = await pic(`${c.id}-map-after`)
      sheet(`${c.id}-sheet.png`, [{ file: card, caption: 'CARD' }, ...played.frames.map((f) => ({ file: f.file, caption: f.caption, bad: f.hit })), { file: tally, caption: 'TALLY' }, { file: mapPic, caption: 'MAP' }])
    }

    /* ---------------- the ending ---------------- */
    if (!stopped) {
      say('== the ending ==')
      check((await scene()) === 'ending', `after MW08: the ending (${await scene()})`)
      const nums = await ev(async () => (await window.__t.mod('scenes/title/kit.ts')).finalNumbers(window.__maxx.ctx.save))
      check(nums.cleared === 8, `its numbers: ${JSON.stringify(nums)}`)
      const phases = []
      let card = ''
      for (let i = 0; i < 80 && (await scene()) === 'ending'; i++) {
        const e = await ev(() => ({ phase: window.__maxx.sceneObject().phase, card: window.__maxx.sceneObject().card }))
        if (phases[phases.length - 1] !== e.phase) {
          phases.push(e.phase)
          // Long enough into each part for the picture to show it: every thanks line, all four numbers, credits up.
          await step({ thanks: 300, numbers: 200, credits: 240, card: 120 }[e.phase] ?? 60)
          story.push({ file: await pic(`ending-${e.phase}`), caption: `ENDING ${e.phase.toUpperCase()}` })
          if (e.phase === 'card') card = e.card
        }
        // Each part moves on with a press; the credits only scroll, faster with confirm held.
        if (e.phase === 'credits') {
          await hold('confirm', 60)
          await release()
        } else {
          await step(45)
          await tap('confirm')
          // That press leaves for the title under a fade: one more would land on PRESS START.
          if (e.phase === 'end') break
        }
      }
      // Without Rival Row played there is no trophy, and with the hidden road found no rumour either.
      const champ = !skipped.has('rivals')
      check(JSON.stringify(phases) === JSON.stringify(['thanks', 'numbers', 'credits', ...(champ ? ['card'] : []), 'end']), `its parts: ${phases.join(' > ')}`)
      check(card === (champ ? 'champion' : ''), champ ? `the last card is the champion's trophy (${card || 'none'})` : `no last card: the secret was found, Rival Row not played (${card || 'none'})`)
      check((await until("m.scene() === 'title'", 200)) > 0, `THE END, confirm: back to the title (${await scene()})`)
      await step(72)
      t = await ev(() => ({ state: window.__maxx.sceneObject().state }))
      check(t.state === 'press', `on PRESS START (${t.state})`)
      await tap('confirm')
      t = await ev(() => ({ state: window.__maxx.sceneObject().state, labels: [...(window.__maxx.sceneObject().labels ?? [])] }))
      check(t.state === 'menu' && t.labels[0] === 'CONTINUE', `and its menu offers CONTINUE first (${t.state}: ${t.labels.join(', ')})`)
      story.push({ file: await pic('title-after'), caption: 'THE END' })
      const sv = await saved()
      if (champ) check(sv.finished && sv.champion && MAIN.every((id) => sv.levels[id]?.cleared) && sv.levels.rivals?.cleared, 'the save: every level cleared, Rival Row too, champion, finished')
      else check(sv.finished && !sv.champion && MAIN.every((id) => sv.levels[id]?.cleared), 'the save: every main level cleared, finished (Rival Row left out)')
    } else {
      check(false, `the campaign stopped at ${stopped}`)
    }
  } finally {
    await game.close()
  }

  if (story.length) sheet('campaign-sheet.png', story, 3)
  const errors = await ev(() => Array.from(window.__maxx.errors))
  check(errors.length === 0, 'no scene threw ' + JSON.stringify(errors))
  const bad = logs.filter((l) => /^(warn|error|warning)/.test(l))
  check(bad.length === 0, 'no console warnings or errors ' + JSON.stringify(bad.slice(0, 5)))
  say(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'ALL CHECKS PASSED')
  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(problems.length + ' checks failed')
}
