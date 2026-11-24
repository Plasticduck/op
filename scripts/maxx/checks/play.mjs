// Plays the play scene (scenes/play.ts) through every way in and out of a level and
// photographs each step: the level card, the iris, the HUD (99 lives, 11/11 cars), a pip lost,
// pause and each pause item, auto pause (never resuming), pause on the very tick the clock
// runs out, banners, a grime and the retry from the checkpoint with the flags and tokens kept,
// the clock running down, running out of lives to 'gameover', Start on the card's last tick,
// a clear (saved on its tick, the tally after the fanfare) with the exact save it writes,
// SPOTLESS kept through a retry, a secret exit (confirm cutting the walk short) and MW03's
// setting secretFound, EXIT TO MAP, the versus card with the boss drawn by its own renderer and
// the boss bar (dev-mudslinger), quitting from a paused versus card, Rival Row's save rules, mw08
// to the ending, a level that is missing and an unknown level id, the tally waiting for a player
// who left, the Xbox prompts, and that five visits in and out leave no sound running behind them.
// The rules that hang on an id (mw03, rivals, mw08) are tried on dev levels played under those ids
// (standIn in levels/index.ts), and a missing level is a real one hidden (hideLevel there).
//   node scripts/maxx/serve.mjs --port <port> -- node scripts/maxx/shot.mjs --port <port>
//     --q "scene=play&level=sandbox&manual=1&fresh=1" --script scripts/maxx/checks/play.mjs --out <folder>/end.png
// Pictures (1x, and an enlarged crop of what each one is about) and report.txt land in <folder>.
// Exit code 1 if any check fails.
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { install, saver } from './lib.mjs'

const SAVE_KEY = 'smm.save.v1.dev'
const HUD_ROW = [0, 0, 640, 48, 3]
const PIPS = [60, 0, 90, 30, 6]

export default async ({ page, maxx, outDir }) => {
  const OUT = outDir
  mkdirSync(OUT, { recursive: true })
  const save = saver(OUT)
  const logs = []
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
  const report = []
  const say = (...a) => {
    const line = a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')
    report.push(line)
    console.log(line)
  }
  const problems = []
  const check = (ok, what) => {
    say(ok ? '  ok   ' : '  FAIL ', what)
    if (!ok) problems.push(what)
  }

  await install(maxx)
  const ev = (fn, ...args) => page.evaluate(fn, ...args)

  // More recorders: tempo, preload, every scene switch, the audio as each scene leaves, and a
  // stand-in for the shell's autoPause flag (the real one is only set outside manual mode).
  await ev(() => {
    const m = window.__maxx
    const rec = window.__rec
    const a = m.ctx.audio
    for (const k of ['setTempoScale', 'preload']) {
      const f = a[k].bind(a)
      a[k] = (...args) => {
        rec.audio.push(k + ':' + (Array.isArray(args[0]) ? args[0].join(',') : String(args[0])))
        return f(...args)
      }
    }
    rec.go = []
    const go = m.ctx.go
    m.ctx.go = (id, params, tr) => {
      rec.go.push([id, params ?? {}, tr ?? 'fade'])
      return go(id, params, tr)
    }
    window.__auto = false
    const real = Object.getOwnPropertyDescriptor(m.ctx, 'autoPause').get
    Object.defineProperty(m.ctx, 'autoPause', { configurable: true, get: () => window.__auto || real.call(m.ctx) })
    rec.exits = []
    window.__watchExit = () => {
      const s = m.sceneObject()
      if (!s || s.__watched) return
      s.__watched = true
      const ex = s.exit
      s.exit = (g) => {
        if (ex) ex.call(s, g)
        const d = m.ctx.audio.debug ? m.ctx.audio.debug() : {}
        rec.exits.push({ scene: m.scene(), want: d.want ?? null, song: d.song ? d.song.id : null, jingle: d.jingle ?? null, spray: !!d.spray, paused: !!d.paused })
      }
    }
    // Until fn(state, world) holds, holding `actions`; ticks taken, or -1.
    window.__until = (actions, src, max) => {
      const fn = new Function('s', 'w', 'm', 'return (' + src + ')')
      if (actions) m.hold(actions)
      else m.release()
      for (let i = 0; i < max; i++) {
        m.step(1)
        const so = m.sceneObject()
        if (fn(so && so.state ? so.state() : null, m.world(), m)) return i + 1
      }
      return -1
    }
  })

  const S = () => ev(() => (window.__maxx.sceneObject()?.state ? window.__maxx.sceneObject().state() : null))
  const scene = () => ev(() => window.__maxx.scene())
  const info = () => ev(() => window.__t.info())
  const run = (actions, n) => ev((a, n) => window.__t.run(a, n), actions, n)
  const tap = async (actions) => {
    await run(actions, 1)
    await run(null, 1)
  }
  const until = (actions, src, max = 600) => ev((a, s, m) => window.__until(a, s, m), actions, src, max)
  const place = (col, feetY = 320, face = 1) => ev((c, y, f) => window.__t.place(c, y, f), col, feetY, face)
  const W = (fn, ...args) => ev(`(${fn.toString()})(window.__maxx.world(), window.__maxx, ...${JSON.stringify(args)})`)
  const saved = () => ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY)
  const lastGo = () => ev(() => window.__rec.go[window.__rec.go.length - 1] ?? null)
  const lastExit = () => ev(() => window.__rec.exits[window.__rec.exits.length - 1] ?? null)
  const go = async (params) => {
    await ev((p) => window.__maxx.go('play', p), params)
    await run(null, 1)
    await ev(() => window.__watchExit())
  }
  /** Play a dev level under a real level id (null undoes it); true when that id now answers with it. */
  const standIn = (id, devId) =>
    ev(
      async (id, devId) => {
        const mod = await window.__t.mod('levels/index.ts')
        const l = mod.standIn(id, devId)
        return devId === null ? !mod.standingIn().includes(id) : !!l && mod.levelById(id) === l && mod.levelById(devId)?.id === devId
      },
      id,
      devId,
    )
  let mark = 0
  const heard = async () => {
    const all = await ev(() => window.__rec.audio)
    const fresh = all.slice(mark)
    mark = all.length
    const count = {}
    for (const a of fresh) count[a] = (count[a] ?? 0) + 1
    return count
  }
  let n = 0
  /** The picture at 1x, and an enlarged crop [x, y, w, h, scale] of the part it is about. */
  const pic = async (name, crop = null) => {
    const tag = String(++n).padStart(2, '0') + '-' + name
    save(tag + '.png', await ev(() => window.__t.native()))
    if (crop) {
      const [x, y, w, h, k] = crop
      save(tag + '-zoom.png', await ev((x, y, w, h, k) => window.__t.zoom(x + w / 2, y + h / 2, w, h, k), x, y, w, h, k))
    }
    return S()
  }
  /** Where Maxx is on screen, as a crop round him. */
  const aroundMaxx = (w = 200, h = 140, k = 3) =>
    W(
      (wd, m, w, h, k) => {
        const p = wd.player
        return [Math.round(p.x) - Math.round(wd.camera.x) + 11 - w / 2, Math.round(p.y) - Math.round(wd.camera.y) + 26 - h / 2, w, h, k]
      },
      w,
      h,
      k,
    )
  /** Past the card and the iris, into the level. */
  const skipIn = async () => {
    await run(null, 10)
    await tap('confirm')
    return until(null, "s && s.phase === 'run'", 60)
  }

  /* ------------------------------------------------------------------ */
  say('== entering, the level card ==')
  await go({ level: 'sandbox', readout: false })
  let s = await S()
  let h = await heard()
  say('state', s, 'heard', h)
  check(s.phase === 'card' && s.level === 'sandbox' && !s.retryCard, 'enters on the level card')
  check(h['music:null'] >= 1 && !Object.keys(h).some((k) => k.startsWith('music:') && k !== 'music:null'), 'the card is quiet')
  const preload = Object.keys(h).filter((k) => k.startsWith('preload:')).pop()
  say('preload', preload)
  check(!!preload && ['sunny', 'bonus', 'clear', 'grimed', 'wax', 'secret'].every((id) => preload.slice(8).split(',').includes(id)), 'preloads the level songs and the jingles it will need')
  await run(null, 29)
  s = await pic('card', [200, 60, 440, 210, 2])
  const cardLen = 30 + (await until(null, "s.phase !== 'card'", 200))
  s = await S()
  check(s.phase === 'open' && cardLen >= 88 && cardLen <= 92, 'the card stays about 90 ticks (' + cardLen + '), then the iris opens')

  /* ------------------------------------------------------------------ */
  say('== the iris ==')
  h = await heard()
  check(h['music:sunny'] === 1, 'the level song starts as the level opens')
  await run(null, 5)
  const maxxAt = await W((wd) => [Math.round(wd.player.x) - Math.round(wd.camera.x) + 11, Math.round(wd.player.y) - Math.round(wd.camera.y) + 26])
  s = await pic('iris-small', [0, 0, 640, 360, 2])
  let px = await ev((a) => [window.__t.pixel(a[0], a[1]), window.__t.pixel(630, 8), window.__t.pixel(630, 350)], maxxAt)
  say('iris pixels: on Maxx, top right, bottom right', px)
  check(px[0] !== '#000000' && px[1] === '#000000' && px[2] === '#000000', 'the iris opens on Maxx (he shows, the far corners are black)')
  await run(null, 8)
  await pic('iris-wide')
  await until(null, "s.phase === 'run'", 30)
  const tick0 = (await info()).tick
  await run(null, 5)
  check((await info()).tick === tick0 + 5, 'the world is held until the iris is open, then runs')

  /* ------------------------------------------------------------------ */
  say('== the HUD ==')
  await run('right', 95)
  await run(null, 20)
  let i = await info()
  s = await pic('hud', HUD_ROW)
  check(i.coins === 2 && i.score === 40, 'two coins picked up on the way (' + i.coins + ' coins, ' + i.score + ' points)')
  await W((wd) => {
    wd.player.turbo = true
    wd.player.wax = 400
  })
  await run(null, 2)
  await pic('hud-turbo-wax', [0, 0, 260, 48, 4])
  await W((wd) => {
    wd.player.turbo = false
    wd.player.wax = 0
  })
  // A jump, then down and spray in the air: the hover meter.
  await place(4, 320, 1)
  await run(null, 10)
  await until('jump', 'w.player.vy > 0', 60)
  await run('down spray', 10)
  i = await info()
  await pic('hover-meter', await aroundMaxx(160, 140, 4))
  check(i.hovering, 'hovering, with the meter over his head')
  await run(null, 60)
  i = await info()
  await pic('hover-meter-gone', await aroundMaxx(160, 140, 3))
  check(i.ground && !i.hovering, 'down again: the meter has gone')
  // The widest numbers the row has to hold: 99 lives (the simulation's cap) against the pips.
  const livesNow = (await info()).lives
  await W((wd) => {
    wd.session.lives = 99
  })
  await run(null, 2)
  await pic('hud-99-lives', [0, 0, 260, 32, 4])
  await W((wd, m, n) => {
    wd.session.lives = n
  }, livesNow)
  await run(null, 2)

  /* ------------------------------------------------------------------ */
  say('== a pip lost ==')
  await heard()
  await place(71, 320, 1)
  const hitT = await until(null, 'w.player.pips < 3', 600)
  check(hitT > 0, 'a car takes a pip (' + hitT + ' ticks)')
  await run(null, 1)
  await pic('pip-lost-flash', PIPS)
  await run(null, 5)
  await pic('pip-lost-shards', PIPS)
  await run(null, 8)
  await pic('pip-lost-later', HUD_ROW)
  const rumble = await ev(() => window.__rec.rumble.slice(-3))
  h = await heard()
  say('heard', h, 'rumble', rumble)
  check(h['sfx:hurt'] === 1 && rumble.includes('0.7,0.5,180'), 'the hurt sound plays and the rumble reaches the controller')
  await place(4, 320, 1)
  await run(null, 100)

  /* ------------------------------------------------------------------ */
  say('== pause and each pause item ==')
  await run('spray', 6)
  h = await heard()
  check(h['spray:true'] === 1, 'the spray hiss starts with the spray')
  const tickP = (await info()).tick
  await run('spray pause', 1)
  await run('spray', 20)
  s = await S()
  h = await heard()
  say('paused', s, h)
  check(s.paused && s.screen === 'menu' && s.menuIndex === 0, 'pause opens the menu on RESUME')
  check((await info()).tick === tickP, 'the world stands still while paused')
  check(h['setPaused:true'] === 1 && h['sfx:pause'] === 1 && h['spray:false'] === 1 && !h['spray:true'], 'audio held, the pause sound, the hiss off and not back while spray is held')
  await pic('pause-menu', [160, 60, 320, 240, 2])
  await tap('down')
  await tap('confirm')
  s = await pic('pause-restart-ask', [160, 60, 320, 240, 2])
  check(s.screen === 'restart' && s.menuIndex === 0, 'RESTART LEVEL asks first, with NO under the cursor')
  await tap('cancel')
  s = await S()
  check(s.screen === 'menu' && s.menuIndex === 1, 'cancel backs out to the menu on RESTART LEVEL')
  await tap('down')
  await tap('confirm')
  await run(null, 2)
  s = await pic('pause-howto', [0, 0, 640, 360, 2])
  check(s.screen === 'howto', 'HOW TO PLAY opens')
  for (let k = 0; k < 10 && (await S()).screen !== 'menu'; k++) await tap('cancel')
  s = await S()
  check(s.screen === 'menu' && s.menuIndex === 2, 'and closes back onto HOW TO PLAY')
  await tap('down')
  await tap('confirm')
  await run(null, 2)
  s = await pic('pause-options', [0, 0, 640, 360, 2])
  check(s.screen === 'options', 'OPTIONS opens')
  for (let k = 0; k < 10 && (await S()).screen !== 'menu'; k++) await tap('cancel')
  s = await S()
  check(s.screen === 'menu' && s.menuIndex === 3, 'and closes back onto OPTIONS')
  await tap('down')
  await tap('confirm')
  s = await pic('pause-exit-ask', [160, 60, 320, 240, 2])
  check(s.screen === 'exit' && s.menuIndex === 0, 'EXIT TO MAP asks first, with NO under the cursor')
  await tap('confirm')
  s = await S()
  check(s.screen === 'menu' && s.menuIndex === 4 && s.paused, 'NO keeps the level')
  await tap('down')
  s = await S()
  check(s.menuIndex === 0, 'the list wraps round to RESUME')
  await heard()
  await tap('confirm')
  await run(null, 3)
  s = await S()
  h = await heard()
  check(!s.paused && (await info()).tick > tickP && h['setPaused:false'] === 1 && h['sfx:unpause'] === 1, 'RESUME carries on, audio back')
  // Start is pause and confirm at once: it pauses, and on RESUME it resumes, never both on one press.
  await tap('pause confirm')
  s = await S()
  check(s.paused && s.screen === 'menu', 'Start pauses (its confirm is not also taken by the menu)')
  await tap('pause confirm')
  s = await S()
  check(!s.paused, 'Start on RESUME resumes')
  // P alone (a pause press that is not confirm or cancel) toggles; Esc (pause and cancel) resumes.
  await tap('pause')
  await tap('pause')
  s = await S()
  check(!s.paused, 'P pauses and P resumes')
  await tap('pause cancel')
  check((await S()).paused, 'Esc pauses')
  await tap('pause cancel')
  check(!(await S()).paused, 'Esc resumes')

  /* ------------------------------------------------------------------ */
  say('== auto pause: pauses, never resumes ==')
  const auto = async () => {
    await ev(() => {
      window.__auto = true
      window.__maxx.ctx.input.inject('pause')
      window.__maxx.step(1)
      window.__auto = false
    })
    return S()
  }
  s = await auto()
  check(s.paused, "the shell's pause press pauses the level")
  await run(null, 5)
  s = await auto()
  await run(null, 5)
  s = await S()
  check(s.paused && s.screen === 'menu', 'a second one while paused does not resume it')
  await pic('auto-paused')
  await tap('pause')
  check(!(await S()).paused, 'the player resumes')
  // The real thing, in real time: the window loses focus.
  await ev(() => window.__maxx.setManual(false))
  await ev(() => window.dispatchEvent(new Event('blur')))
  await new Promise((r) => setTimeout(r, 500))
  const blur1 = await S()
  await ev(() => window.dispatchEvent(new Event('focus')))
  await new Promise((r) => setTimeout(r, 400))
  const back1 = await S()
  await ev(() => window.dispatchEvent(new Event('blur')))
  await new Promise((r) => setTimeout(r, 400))
  await ev(() => window.dispatchEvent(new Event('focus')))
  await new Promise((r) => setTimeout(r, 400))
  const blur2 = await S()
  await ev(() => window.__maxx.setManual(true))
  say('window blur', blur1.paused, 'focus', back1.paused, 'blur while paused', blur2.paused)
  check(blur1.paused && back1.paused && blur2.paused && blur2.screen === 'menu', 'window blur pauses; focus does not resume; another blur while paused does not resume')
  await tap('pause')
  check(!(await S()).paused, 'resumed by the player')

  /* ------------------------------------------------------------------ */
  say('== pause on the very tick the clock runs out ==')
  const livesTU = (await info()).lives
  const timeWas = await W((wd) => wd.timeLeft)
  await W((wd) => {
    wd.timeLeft = 1
  })
  await run('pause', 1)
  s = await S()
  i = await info()
  check(s.paused && i.status === 'play', 'the pause comes first: the level stops with the clock on its last tick')
  await run(null, 30)
  check((await info()).status === 'play' && (await info()).lives === livesTU, 'nothing runs out behind the pause menu')
  await W((wd, m, t) => {
    wd.timeLeft = t
  }, timeWas)
  await tap('pause')
  await run(null, 2)
  check(!(await S()).paused && (await info()).status === 'play', 'and the level carries on after it')

  /* ------------------------------------------------------------------ */
  say('== a grime, then the retry from the checkpoint with the flags kept ==')
  await heard()
  const car = await W((wd) => {
    const c = wd.entities
      .filter((e) => e.kind === 'car' && (e.variant === 'compact' || e.variant === 'sedan') && e.hp > 0 && e.state !== 'clean' && !e.dead)
      .sort((a, b) => a.x - b.x)[0]
    return c ? { x: c.x, id: c.id, variant: c.variant } : null
  })
  say('a dirty car', car)
  await place(car.x / 32 - 3.5, 320, 1)
  const washT = await until('spray', `w.entities.some((e) => e.id === ${car.id} && (e.state === 'clean' || e.hp <= 0)) || w.player.state === 'hurt'`, 300)
  await run(null, 30)
  let f = await W((wd) => ({ washed: wd.stats.carsWashed, flags: Object.keys(wd.flags) }))
  say('washed', washT, f)
  check(f.washed === 1 && f.flags.some((k) => k.startsWith('washed:')), 'a car washed, credited in a washed: flag')
  await W((wd) => {
    wd.flags.testFlag = 7
    // As if the third gold token had been picked up on this attempt.
    wd.stats.tokens[2] = true
  })
  await place(94, 320, 1)
  await until('right', 'w.checkpoint !== null', 120)
  await run(null, 6)
  s = await pic('checkpoint-banner', [140, 40, 360, 80, 3])
  check(s.banner === 'CHECKPOINT!', 'the checkpoint notice')
  await run(null, 24)
  await pic('checkpoint-banner-landed', [140, 40, 360, 80, 3])
  const cp = await W((wd) => wd.checkpoint)
  const before = await info()
  const oldId = await W((wd) => (window.__oldWorld = wd) && wd.tick)
  await place(148.5, 320, 1)
  await run(null, 20)
  const gr = await until('right', "w.status === 'grimed'", 200)
  check(gr > 0, 'the sludge grimes him')
  await run(null, 6)
  s = await pic('grimed-banner-in', [40, 60, 560, 160, 2])
  check(s.banner === 'GRIMED!', 'GRIMED! comes up')
  await run(null, 40)
  await pic('grimed-banner', [40, 60, 560, 160, 2])
  h = await heard()
  check(h['jingle:grimed'] === 1 && h['spray:false'] === 1, 'the grimed jingle, and the hiss stops')
  check((await info()).lives === before.lives, 'no life is taken while he flops')
  const toClose = await until(null, "s.phase === 'close'", 200)
  i = await info()
  say('life taken after', 46 + toClose, 'ticks of the flop')
  check(i.lives === before.lives - 1, 'then one life is taken (' + before.lives + ' -> ' + i.lives + ')')
  await run(null, 12)
  await pic('retry-iris-closing')
  await until(null, "s.phase === 'card'", 40)
  s = await S()
  check(s.retryCard, 'a lives card before the retry')
  await run(null, 4)
  await pic('retry-card-old-number', [160, 80, 320, 200, 2])
  await run(null, 24)
  await pic('retry-card-new-number', [160, 80, 320, 200, 2])
  await until(null, "s.phase === 'run'", 120)
  f = await W((wd) => ({ same: wd === window.__oldWorld, cp: wd.checkpoint, feet: wd.player.x + 11, y: wd.player.y + 52, area: wd.area.id, flags: wd.flags, washed: wd.stats.carsWashed, pips: wd.player.pips, status: wd.status, tokens: wd.stats.tokens }))
  i = await info()
  say('retry world', f, 'old checkpoint', cp)
  check(!f.same && f.status === 'play', 'a new world')
  check(f.area === cp.areaId && Math.abs(f.feet - cp.x) < 0.01 && Math.abs(f.y - cp.y) < 0.01, 'he starts at the checkpoint')
  check(f.flags.testFlag === 7 && Object.keys(f.flags).some((k) => k.startsWith('washed:')) && f.washed === 1, 'the flags are kept (a level flag, and the washed car still counts)')
  check(f.tokens[2] === true, 'a gold token found before the grime is still found')
  check(f.pips === 3 && i.lives === before.lives - 1, 'full shine, one life fewer')
  h = await heard()
  check(h['music:sunny'] === 1, 'the level song comes back')
  await pic('retry-in-play', HUD_ROW)
  void oldId

  /* ------------------------------------------------------------------ */
  say('== the clock: hurry up, then time up ==')
  await W((wd) => {
    wd.timeLeft = 61 * 60 + 5
  })
  await run(null, 30)
  check(!(await S()).hurry, 'no hurry above a minute')
  await run(null, 40)
  s = await S()
  h = await heard()
  say('heard', h)
  check(s.hurry && h['sfx:timeWarn'] === 1 && h['setTempoScale:1.25'] === 1 && s.banner === 'HURRY UP!', 'under a minute: the warning, the faster song, HURRY UP!')
  await run(null, 20)
  await pic('hurry-up', [0, 0, 640, 120, 2])
  await until(null, 'Math.floor(m.ctx.tick / 16) % 2 === 1', 40)
  await pic('clock-lit', [480, 0, 160, 32, 5])
  await run(null, 16)
  await pic('clock-dark', [480, 0, 160, 32, 5])
  const livesT = (await info()).lives
  await W((wd) => {
    wd.timeLeft = 30
  })
  await until(null, "w.status === 'timeup'", 60)
  await run(null, 30)
  s = await pic('time-up', [40, 60, 560, 160, 2])
  h = await heard()
  check(s.banner === 'TIME UP!' && h['jingle:grimed'] === 1, 'TIME UP! and the jingle')
  await until(null, "s.phase === 'card'", 400)
  await until(null, "s.phase === 'run'", 200)
  s = await S()
  i = await info()
  h = await heard()
  say('after time up', i.lives, h)
  check(i.lives === livesT - 1 && !s.hurry && h['music:sunny'] === 1, 'time up costs a life; the retry starts at the normal tempo')

  /* ------------------------------------------------------------------ */
  say('== out of lives: game over ==')
  await W((wd) => {
    wd.session.lives = 1
  })
  await place(148.5, 320, 1)
  await run(null, 20)
  await until('right', "w.status === 'grimed'", 200)
  await until(null, "s.phase === 'leave'", 500)
  const flop = await W((wd) => wd.statusT)
  const grimedLen = await ev(async () => {
    const lib = await window.__t.mod('audio/library.ts')
    const fmt = await window.__t.mod('audio/format.ts')
    return Math.ceil(fmt.songSeconds(lib.SONGS.grimed) * 60)
  })
  check(flop >= grimedLen, 'on the last life the grimed jingle (' + grimedLen + ' ticks) plays out before GAME OVER (' + flop + ')')
  const toOver = await until(null, "m.scene() === 'gameover'", 500)
  const g1 = await lastGo()
  const ex1 = await lastExit()
  say('game over after', toOver, 'go', g1, 'audio as it left', ex1)
  check(toOver > 0 && g1[0] === 'gameover' && g1[1].from === 'sandbox', "the last life lost goes to 'gameover' with { from }")
  check(ex1 && ex1.want === null && !ex1.spray && !ex1.paused, 'no song, no hiss, nothing held as it leaves')
  await run(null, 30)
  await pic('gameover')

  /* ------------------------------------------------------------------ */
  say('== card skip, a fresh visit, EXIT TO MAP ==')
  await go({ level: 'sandbox', readout: false })
  i = await info()
  f = await W((wd) => Object.keys(wd.flags).length)
  check(i.lives === 3 && i.score === 0, 'out of lives, a new visit starts with a fresh session')
  check(f === 0, 'a fresh visit passes no flags')
  await run(null, 2)
  await tap('confirm')
  check((await S()).phase === 'card', 'a confirm in the first few ticks does not skip the card')
  await run(null, 8)
  await tap('confirm')
  s = await S()
  check(s.phase === 'open' && s.phaseT <= 2, 'confirm skips the card')
  await until(null, "s.phase === 'run'", 30)
  // Start (pause and confirm at once) on the card's very last tick: the card ends, and nothing is left half paused.
  await ev(() => window.__maxx.go('play', { level: 'sandbox', readout: false }))
  await run(null, 1)
  await until(null, 's.phase === "card" && s.phaseT >= 89', 120)
  await run('pause confirm', 1)
  await run(null, 30)
  s = await S()
  check(s.phase === 'run' && !s.paused, 'Start on the last tick of the card: the level opens, not paused (' + s.phase + ')')
  const entryScore = (await info()).score
  await run('right', 95)
  i = await info()
  check(i.score > entryScore, 'some points earned (' + i.score + ')')
  const before2 = await saved()
  await tap('pause')
  await tap('up')
  check((await S()).menuIndex === 4, 'up from RESUME lands on EXIT TO MAP')
  await tap('confirm')
  await tap('down')
  await pic('exit-yes', [160, 60, 320, 240, 2])
  await tap('confirm')
  const g2 = await lastGo()
  i = await info()
  say('exit', g2, i.score)
  check(g2[0] === 'map' && g2[1].from === 'sandbox' && g2[1].exit === 'quit', "EXIT TO MAP goes to 'map' with { from, exit: 'quit' }")
  check(i.score === entryScore, 'and the visit is undone: its points are gone')
  await until(null, "m.scene() === 'map'", 120)
  const ex2 = await lastExit()
  check(ex2 && ex2.want === null && !ex2.spray && !ex2.paused, 'no song, no hiss, nothing held as it leaves (' + JSON.stringify(ex2) + ')')
  // The map, on screen by now, keeps its own memory in save.data.map (where Maxx stands, what it has shown).
  const notMap = (d) => JSON.stringify({ ...d, map: undefined })
  const after2 = await saved()
  check(notMap(after2) === notMap(before2), 'nothing written to the save but the map memory (' + JSON.stringify(before2?.map) + ' -> ' + JSON.stringify(after2?.map) + ')')

  /* ------------------------------------------------------------------ */
  say('== a clear: the tally and the save ==')
  await go({ level: 'sandbox', readout: false })
  await skipIn()
  const e3 = (await info()).score
  await run('right', 95)
  const save0 = await saved()
  say('save before', save0)
  await W((wd) => {
    wd.stats.tokens[1] = true
    wd.stats.carsWashed = wd.stats.carsTotal
  })
  await place(390, 320, 1)
  // Tick by tick into the arch, keeping the score of the tick before the clear.
  const scoreWalk = await ev(() => {
    const m = window.__maxx
    m.hold('right')
    for (let k = 0; k < 300; k++) {
      const before = m.world().session.score
      m.step(1)
      if (m.world().status === 'clear') return before
    }
    return -1
  })
  const atClear = await W((wd) => ({ timeLeft: wd.timeLeft, tick: wd.tick, score: wd.session.score, total: wd.stats.carsTotal }))
  const bonus = Math.ceil(atClear.timeLeft / 60) * 20 + 3000
  let sv = await saved()
  say('on the clear tick', atClear, 'record', sv.levels.sandbox ?? null)
  check(!!sv.levels.sandbox && sv.levels.sandbox.cleared && atClear.score === scoreWalk + bonus, 'the clear is paid and saved on its own tick (a page closed during the fanfare keeps it)')
  await run(null, 30)
  h = await heard()
  check(h['jingle:clear'] === 1, 'the clear jingle')
  check((await S()).banner === 'CLEAR!', 'CLEAR! comes up over the fanfare')
  await pic('clear-banner', [80, 60, 480, 130, 2])
  await pic('clear-walk', await aroundMaxx())
  await run(null, 100)
  await pic('clear-win', await aroundMaxx())
  check((await S()).phase === 'run', 'no tally yet: the fanfare is still playing')
  await pic('hud-cars-full', [340, 0, 300, 32, 4])
  const fanfare = await ev(async () => {
    const lib = await window.__t.mod('audio/library.ts')
    const fmt = await window.__t.mod('audio/format.ts')
    return Math.ceil(fmt.songSeconds(lib.SONGS.clear) * 60)
  })
  const toTally = await until(null, "s.phase === 'tally'", 300)
  const tallyAt = await W((wd) => wd.statusT)
  say('the clear fanfare lasts', fanfare, 'ticks; the tally came at', tallyAt)
  check(tallyAt >= fanfare && tallyAt <= fanfare + 12, 'the tally comes down once the fanfare has played (' + tallyAt + ' ticks after the clear)')
  const scoreAfter = await W((wd) => wd.session.score)
  const want = {
    cleared: true,
    bestScore: atClear.score - e3,
    bestTicks: atClear.tick,
    tokens: [false, true, false],
    spotless: true,
  }
  sv = await saved()
  const live = await ev(() => JSON.parse(JSON.stringify(window.__maxx.ctx.save.data)))
  say('clear', atClear, 'tally after', 130 + toTally, 'score', e3, '->', scoreWalk, '->', scoreAfter, 'save', sv)
  check(scoreAfter === scoreWalk + bonus, 'the time bonus (' + (bonus - 3000) + ') and SPOTLESS (3000) are paid into the score, once')
  check(JSON.stringify(sv.levels.sandbox) === JSON.stringify(want), 'the record written exactly: ' + JSON.stringify(want))
  check(sv.unlocked === 1 && sv.secretFound === false && sv.finished === false && sv.rivalsBeaten === 0 && sv.champion === false, 'unlocked, secretFound, finished, rivals untouched (the sandbox is not one of the eight)')
  check(sv.hiScore === scoreAfter, 'hiScore is the session score with the bonuses (' + sv.hiScore + ')')
  check(JSON.stringify(live) === JSON.stringify(sv), 'what is in localStorage is what the game holds')
  const counts = {}
  for (const st of ['cars', 'spotless', 'tokens', 'time', 'best', 'done']) {
    const t = await until(null, `s.tally === '${st}'`, 400)
    await run(null, st === 'time' ? 30 : st === 'done' ? 4 : 12)
    s = await pic('tally-' + st, st === 'time' || st === 'done' ? [0, 0, 640, 260, 2] : null)
    counts[st] = t
  }
  h = await heard()
  say('tally stages', counts, 'heard', h)
  check(Object.values(counts).every((t) => t >= 0), 'the tally goes through cars, SPOTLESS, tokens, time, best')
  check(h['sfx:tally'] > 5 && h['sfx:tallyEnd'] >= 1, "the clock counts in with 'tally' ticks and ends on 'tallyEnd'")
  await run(null, 30)
  await tap('confirm')
  const g3 = await lastGo()
  check(g3[0] === 'map' && g3[1].from === 'sandbox' && g3[1].exit === 'goal' && g3[2] === 'iris', "then 'map' with { from, exit: 'goal' } through an iris")
  await until(null, "m.scene() === 'map'", 120)
  const ex3 = await lastExit()
  check(ex3 && ex3.want === null && !ex3.spray && !ex3.paused, 'no song, no hiss, nothing held as it leaves (' + JSON.stringify(ex3) + ')')

  /* ------------------------------------------------------------------ */
  say('== the secret exit ==')
  await go({ level: 'sandbox', readout: false })
  await run(null, 40)
  await pic('card-with-record', [200, 60, 440, 210, 2])
  f = await W((wd) => wd.stats.tokens.slice())
  check(f[1] === true && f[0] === false, 'the tokens already owned come in from the save')
  await skipIn()
  await place(160, 320, 1)
  await run(null, 10)
  await until('spray', "String.fromCharCode(w.grid.t[9 * w.grid.w + 162]) === ' '", 300)
  await until('right', 'w.player.hitWall === 1 || w.player.x > 164 * 32', 100)
  await until('spray up', "String.fromCharCode(w.grid.t[8 * w.grid.w + 162]) === ' '", 300)
  await heard()
  const sec = await until('right', "w.status === 'clear'", 300)
  const atSecret = await W((wd) => ({ exit: wd.exit, tokens: wd.stats.tokens.slice() }))
  await run(null, 20)
  s = await pic('secret-banner', [0, 40, 640, 120, 2])
  h = await heard()
  say('secret', sec, atSecret, s.banner, h)
  // The hidden road to Rival Row leaves from MW03 and MW06 only: anywhere else it is just an exit.
  check(sec > 0 && atSecret.exit === 'secret' && h['jingle:secret'] === 1 && s.banner === 'SECRET EXIT!', 'the secret exit: its jingle and SECRET EXIT! (' + s.banner + ')')
  // Confirm once the walk is done brings the tally without waiting out the fanfare.
  await until(null, 'w.statusT >= 100', 200)
  await run('confirm', 1)
  s = await S()
  const skipAt = await W((wd) => wd.statusT)
  check(s.phase === 'tally' && skipAt < fanfare, 'confirm after the walk brings the tally at once (' + skipAt + ' ticks after the exit)')
  await run(null, 1)
  sv = await saved()
  say('save after the secret exit', sv)
  check(sv.levels.sandbox.cleared === true && sv.secretFound === false, 'it counts as a clear and opens no road: secretFound stays false (MW03 below)')
  check(sv.levels.sandbox.tokens.every((t, k) => t === (want.tokens[k] || atSecret.tokens[k])), 'tokens OR-ed in (' + JSON.stringify(sv.levels.sandbox.tokens) + ')')
  check(sv.levels.sandbox.spotless === true && sv.levels.sandbox.bestScore >= want.bestScore, 'SPOTLESS and the best score are kept from before')
  await until(null, "s.tally === 'cars'", 100)
  await run(null, 6)
  await pic('secret-tally', [0, 0, 640, 360, 2])
  await heard()
  await tap('confirm')
  s = await S()
  h = await heard()
  check(s.tally === 'done' && h['sfx:tallyEnd'] === 1, 'confirm speeds the tally to its end')
  await run(null, 20)
  await pic('secret-tally-done', [0, 0, 640, 360, 2])
  await tap('confirm')
  const g4 = await lastGo()
  check(g4[0] === 'map' && g4[1].exit === 'secret', "then 'map' with exit: 'secret'")
  await until(null, "m.scene() === 'map'", 120)

  /* ------------------------------------------------------------------ */
  say("== the hidden road: MW03's secret exit sets secretFound ==")
  const asMw03 = await standIn('mw03', 'sandbox')
  check(asMw03, "a stand-in MW03 (the sandbox played under the id 'mw03')")
  if (asMw03) {
    await ev(() => {
      const save = window.__maxx.ctx.save
      save.data.secretFound = false
      save.commit()
    })
    await go({ level: 'mw03', readout: false })
    await skipIn()
    await place(160, 320, 1)
    await run(null, 10)
    await until('spray', "String.fromCharCode(w.grid.t[9 * w.grid.w + 162]) === ' '", 300)
    await until('right', 'w.player.hitWall === 1 || w.player.x > 164 * 32', 100)
    await until('spray up', "String.fromCharCode(w.grid.t[8 * w.grid.w + 162]) === ' '", 300)
    const sec3 = await until('right', "w.status === 'clear'", 300)
    await run(null, 20)
    s = await S()
    check(sec3 > 0 && s.banner === 'A SECRET ROAD OPENS', 'its secret exit: A SECRET ROAD OPENS (' + s.banner + ')')
    await until(null, 'w.statusT >= 100', 200)
    await run('confirm', 1)
    await run(null, 1)
    sv = await saved()
    say('save after the MW03 secret exit', { secretFound: sv.secretFound, unlocked: sv.unlocked, mw03: sv.levels.mw03 })
    check(sv.secretFound === true && sv.levels.mw03?.cleared === true && sv.unlocked === 4, 'secretFound set, MW03 cleared, unlocked rises to 4')
    await until(null, "s.tally === 'cars'", 100)
    await run(null, 6)
    await tap('confirm')
    await run(null, 20)
    await tap('confirm')
    const g7 = await lastGo()
    check(g7 && g7[0] === 'map' && g7[1].from === 'mw03' && g7[1].exit === 'secret', "then 'map' with { from: 'mw03', exit: 'secret' } (" + JSON.stringify(g7) + ')')
    await until(null, "m.scene() === 'map'", 120)
    check(await standIn('mw03', null), 'the MW03 stand-in is undone')
  }

  /* ------------------------------------------------------------------ */
  say('== SPOTLESS and a token kept through a retry ==')
  await go({ level: 'sandbox', readout: false })
  await skipIn()
  const tokensBefore = (await saved()).levels.sandbox.tokens
  const total = await W((wd) => {
    // Every car washed (the flags are what a retry keeps), and the first token found, on this attempt.
    for (let k = 0; k < wd.stats.carsTotal; k++) wd.flags['washed:main:check' + k] = 1
    wd.stats.carsWashed = wd.stats.carsTotal
    wd.stats.tokens[0] = true
    return wd.stats.carsTotal
  })
  await place(148.5, 320, 1)
  await run(null, 20)
  check((await until('right', "w.status === 'grimed'", 200)) > 0, 'grimed in the sludge')
  // The flop is still the 'run' phase: wait for the lives card, then the new attempt.
  await until(null, "s.phase === 'card'", 400)
  await until(null, "s.phase === 'run'", 200)
  f = await W((wd) => ({ washed: wd.stats.carsWashed, total: wd.stats.carsTotal, tokens: wd.stats.tokens.slice() }))
  say('after the retry', f, 'saved tokens before', tokensBefore)
  check(f.washed === total && f.total === total && f.tokens[0] === true, 'after the retry every car still counts as washed, and the token is still found')
  await place(390, 320, 1)
  await until('right', "w.status === 'clear'", 300)
  await until(null, "s.phase === 'tally'", 400)
  check((await until(null, "s.tally === 'spotless'", 200)) > 0, 'the tally pays SPOTLESS')
  sv = await saved()
  check(sv.levels.sandbox.tokens[0] === true && sv.levels.sandbox.tokens[1] === tokensBefore[1] && sv.levels.sandbox.spotless, 'the token found before the grime is saved with the clear (' + JSON.stringify(sv.levels.sandbox.tokens) + ')')
  await tap('confirm')
  await run(null, 2)
  await tap('confirm')
  await until(null, "m.scene() === 'map'", 120)

  /* ------------------------------------------------------------------ */
  say('== a boss: the versus card and the boss bar (dev-mudslinger) ==')
  await go({ level: 'dev-mudslinger', col: 6, readout: false })
  h = await heard()
  // The last one: the scene left before (the map) may preload its own.
  const pre2 = Object.keys(h).filter((k) => k.startsWith('preload:')).pop() ?? ''
  check(['storm', 'versus', 'boss', 'rivalDown'].every((id) => pre2.slice(8).split(',').includes(id)), 'a boss level preloads the versus jingle and the fight song (' + pre2 + ')')
  await skipIn()
  const vs = await until('right', "s.versus !== ''", 400)
  check(vs > 0, 'walking into the arena brings the versus card (' + vs + ' ticks)')
  const tickV = (await info()).tick
  for (const [name, k] of [['wipe', 3], ['slam', 10], ['vs', 20], ['tagline', 40], ['out', 88]]) {
    await run(null, k)
    await pic('versus-' + name, [0, 0, 640, 360, 2])
    if (name === 'tagline') {
      // The truck itself, drawn by its own renderer at 2x on the red half: its tyres and body, not the red behind them.
      const px = await ev(() => [window.__t.pixel(500, 272), window.__t.pixel(560, 214), window.__t.pixel(600, 240)])
      say('red half where the boss stands', px)
      check(px.filter((c) => !['#ae0512', '#3c0507', '#d10713'].includes(c)).length >= 2, 'the boss is drawn on its half of the card, by its own renderer (' + px.join(' ') + ')')
    }
  }
  s = await S()
  i = await info()
  check(i.tick === tickV && s.versus !== '', 'the fight is held while the card is up')
  h = await heard()
  check(h['jingle:versus'] === 1, 'the versus jingle, once')
  await until(null, "s.versus === ''", 100)
  await run(null, 30)
  await pic('boss-bar', [160, 300, 320, 60, 3])
  const boss = await W((wd) => wd.boss)
  check(!!boss && boss.name.length > 0, 'world.boss is set: the bar shows ' + JSON.stringify(boss))
  await W((wd) => {
    const b = wd.entities.find((e) => e.kind === 'mudslinger')
    if (b) b.hp = Math.max(1, b.hp - 30)
  })
  await run(null, 4)
  await pic('boss-bar-hit', [160, 300, 320, 60, 3])
  // Banners bosses and rivals send, which the banner table does not know: big, yellow, fitted to the screen.
  for (const text of ['SQUEAKY CLEAN!', 'SLICK OLLIE IS SPOTLESS!']) {
    await W((wd, m, text) => wd.events.push({ type: 'banner', text, ticks: 150 }), text)
    await run(null, 60)
    s = await pic('banner-' + text.split(' ')[0].toLowerCase(), [0, 60, 640, 130, 2])
    check(s.banner === text, 'a banner from the simulation comes up: ' + text)
  }

  /* ------------------------------------------------------------------ */
  say('== EXIT TO MAP from a paused versus card ==')
  await go({ level: 'dev-mudslinger', col: 6, readout: false })
  await skipIn()
  await until('right', "s.versus !== ''", 400)
  await run(null, 20)
  await tap('pause')
  s = await S()
  check(s.paused && s.versus !== '', 'Start pauses the versus card (it does not skip it)')
  await pic('versus-paused')
  await tap('up')
  await tap('confirm')
  await tap('down')
  await tap('confirm')
  await until(null, "m.scene() === 'map'", 200)
  const ex4 = await lastExit()
  const onMap = await ev(() => {
    const d = window.__maxx.ctx.audio.debug()
    return { want: d.want, jingle: d.jingle, paused: d.paused, spray: d.spray }
  })
  say('as the play scene left', ex4, 'on the map', onMap)
  check(ex4 && ex4.want === null && !ex4.spray && !ex4.paused && onMap.want === 'map' && !onMap.paused, "the level's song is gone and the map's is wanted; nothing held")
  check(!onMap.jingle, 'the versus jingle the pause was holding is cut, not played on over the map (' + JSON.stringify(onMap.jingle) + ')')

  /* ------------------------------------------------------------------ */
  say('== a pipe: the cut is covered, the area song comes in at the hurried tempo ==')
  await go({ level: 'sandbox', readout: false })
  await skipIn()
  await W((wd) => {
    wd.timeLeft = 59 * 60
  })
  await run(null, 2)
  check((await S()).hurry, 'hurrying')
  await place(181, 256, 1)
  await run(null, 6)
  await heard()
  const markA = await ev(() => window.__rec.audio.length)
  await until('down', "w.warp && w.warp.phase === 'out' && w.warp.ticks - w.warp.t <= 4", 80)
  await pic('pipe-shade-going')
  await until('down', "w.area.id === 'bonus'", 200)
  await run('down', 2)
  s = await pic('pipe-shade-arriving')
  const after = await ev((k) => window.__rec.audio.slice(k), markA)
  const mi = after.indexOf('music:bonus')
  say('heard through the pipe', after)
  check(mi >= 0 && after.indexOf('setTempoScale:1.25', mi) > mi, 'the bonus room song, then the hurry tempo put back on it')
  await until('down', '!w.warp', 200)
  await run(null, 20)
  await pic('bonus-room', HUD_ROW)

  /* ------------------------------------------------------------------ */
  say("== Rival Row: the save's rivalsBeaten in, and out as it rises ==")
  const asRivals = await standIn('rivals', 'dev-rivals-a')
  check(asRivals, "a stand-in Rival Row (dev-rivals-a played under the id 'rivals', levels/index.ts standIn)")
  if (asRivals) {
    await ev(() => {
      window.__maxx.ctx.save.data.rivalsBeaten = 1
      window.__maxx.ctx.save.commit()
    })
    await go({ level: 'rivals', readout: false })
    f = await W((wd) => ({ ...wd.flags }))
    check(f.rivalsBeaten === 1 && Object.keys(f).length === 1, 'a fresh visit starts with flags { rivalsBeaten: save.data.rivalsBeaten } (' + JSON.stringify(f) + ')')
    await skipIn()
    await W((wd) => {
      wd.flags.rivalsBeaten = 2
    })
    await run(null, 1)
    sv = await saved()
    check(sv.rivalsBeaten === 2 && sv.champion === false, 'a rival beaten is in the save at once')
    await W((wd) => {
      wd.flags.rivalsBeaten = 4
    })
    await run(null, 1)
    sv = await saved()
    check(sv.rivalsBeaten === 4 && sv.champion === true, 'the fourth makes him champion')
    await W((wd) => {
      wd.flags.rivalsBeaten = 3
    })
    await run(null, 1)
    check((await saved()).rivalsBeaten === 4, 'and it never goes down')
    check(await standIn('rivals', null), 'the Rival Row stand-in is undone')
  }

  /* ------------------------------------------------------------------ */
  say("== the last level: a clear of 'mw08' goes to the ending ==")
  const asLast = await standIn('mw08', 'dev-rivals-a')
  check(asLast, "a stand-in MW08 (dev-rivals-a played under the id 'mw08')")
  if (asLast) {
    await go({ level: 'mw08', area: 'out', col: 5, readout: false })
    await skipIn()
    const cl8 = await until('right', "w.status === 'clear'", 400)
    await until(null, "s.phase === 'tally'", 300)
    sv = await saved()
    say('save after mw08', sv)
    check(cl8 > 0 && sv.levels.mw08 && sv.levels.mw08.cleared === true, 'mw08 cleared')
    check(sv.unlocked === 8 && sv.finished === true, 'unlocked rises to 8 and finished is set')
    await run(null, 20)
    await tap('confirm')
    await run(null, 4)
    await tap('confirm')
    const g6 = await lastGo()
    check(g6[0] === 'ending' && g6[1].from === 'mw08' && g6[1].exit === 'goal', "then 'ending' instead of the map (" + JSON.stringify(g6) + ')')
    await until(null, "m.scene() === 'ending'", 120)
    await run(null, 40)
    await pic('ending')
    check(await standIn('mw08', null), 'the MW08 stand-in is undone')
  }

  /* ------------------------------------------------------------------ */
  say('== a level that is missing, an unknown id, auto pause on the card, the debug readout ==')
  // Every level is built now: MW05 is hidden for this (hideLevel), so levelById('mw05') is null
  // while its site, name and song are still in levels/meta.ts, as for a level not built yet.
  const hidden = await ev(async () => {
    const mod = await window.__t.mod('levels/index.ts')
    return mod.hideLevel('mw05') && mod.levelById('mw05') === null
  })
  check(hidden, "MW05 hidden for this (levels/index.ts hideLevel): levelById('mw05') is null")
  await ev(() => window.__maxx.go('play', { level: 'mw05' }))
  await run(null, 2)
  const g5 = await lastGo()
  check((await scene()) === 'map' && g5[0] === 'map' && g5[1].from === 'mw05' && g5[1].exit === 'quit', "an id with no LevelDef goes back to 'map' (" + JSON.stringify(g5) + ')')
  const shown = await ev(async () => {
    const mod = await window.__t.mod('levels/index.ts')
    return !mod.hideLevel('mw05', false) && mod.levelById('mw05')?.id === 'mw05' && mod.hiddenLevels().length === 0
  })
  check(shown, 'and MW05 is back once that is undone')
  // An id nothing in the game names, not even levels/meta.ts.
  await ev(() => window.__maxx.go('play', { level: 'mw99' }))
  await run(null, 2)
  const g99 = await lastGo()
  check((await scene()) === 'map' && g99[0] === 'map' && g99[1].from === 'mw99' && g99[1].exit === 'quit', "an id no level or site has goes back to 'map' too (" + JSON.stringify(g99) + ')')
  await go({ level: 'sandbox' })
  await run(null, 20)
  await auto()
  s = await S()
  check(s.phase === 'card' && !s.paused, 'the shell pausing during the card does not stop the card')
  await until(null, "s.phase === 'run'", 120)
  await run(null, 1)
  s = await S()
  check(s.paused, '... and the level comes up paused')
  await tap('pause')
  await run(null, 20)
  await pic('debug-readout', [380, 20, 260, 20, 4])
  // The shell pausing during the card, then the player back with a button: nothing to pause for them.
  await go({ level: 'sandbox', readout: false })
  await run(null, 20)
  await auto()
  await run(null, 10)
  await tap('right')
  await until(null, "s.phase === 'run'", 120)
  await run(null, 2)
  check(!(await S()).paused, 'a player back before the level opens (a button pressed) gets it unpaused')

  /* ------------------------------------------------------------------ */
  say('== the tally waits for a player who has gone away ==')
  await place(396.5, 320, 1)
  await until('right', "w.status === 'clear'", 300)
  await until(null, "s.phase === 'tally'", 400)
  await auto()
  const leftAlone = await until(null, "m.scene() !== 'play' || s.phase === 'leave'", 900)
  check(leftAlone < 0 && (await S()).tally === 'done', 'left alone after the shell paused, the finished tally stays up')
  await tap('confirm')
  await run(null, 2)
  await tap('confirm')
  check((await S()).phase === 'leave', 'and the player moves it on when back')
  await until(null, "m.scene() === 'map'", 120)

  /* ------------------------------------------------------------------ */
  say('== an Xbox controller: the prompts in the pause menu and the tally ==')
  await ev(() => {
    const pad = {
      id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: { type: 'dual-rumble', playEffect: () => Promise.resolve('complete'), reset: () => Promise.resolve('complete') },
    }
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] })
    window.__btn = (b, down) => {
      pad.buttons[b] = { pressed: !!down, touched: !!down, value: down ? 1 : 0 }
      pad.timestamp++
    }
  })
  const button = async (b) => {
    await ev((b) => window.__btn(b, true), b)
    await run(null, 1)
    await ev((b) => window.__btn(b, false), b)
    await run(null, 1)
  }
  const PAD_A = 0
  const PAD_MENU = 9
  await go({ level: 'sandbox', readout: false })
  await run(null, 12)
  await button(PAD_A)
  check((await S()).phase === 'open', 'A skips the card')
  await until(null, "s.phase === 'run'", 60)
  await button(PAD_MENU)
  s = await S()
  const device = await ev(() => window.__maxx.ctx.input.device)
  check(device === 'gamepad' && s.paused && s.menuIndex === 0, 'Menu pauses, on RESUME (the controller is the device in use)')
  await pic('pad-pause-menu', [160, 60, 320, 240, 2])
  await button(PAD_MENU)
  check(!(await S()).paused, 'Menu on RESUME resumes')
  await place(396.5, 320, 1)
  await until('right', "w.status === 'clear'", 300)
  await ev(() => window.__maxx.release())
  await until(null, "s.tally === 'done'", 900)
  await run(null, 10)
  await pic('pad-tally-done', [100, 20, 440, 240, 2])
  await button(PAD_A)
  await until(null, "m.scene() === 'map'", 120)

  /* ------------------------------------------------------------------ */
  say('== five visits in and out: nothing left running ==')
  const audioNow = () =>
    ev(() => {
      const d = window.__maxx.ctx.audio.debug()
      return { want: d.want, paused: d.paused, spray: d.spray, voices: d.voices, queued: d.queued, clips: d.clips.length }
    })
  const a0 = await audioNow()
  for (let k = 0; k < 5; k++) {
    await go({ level: k % 2 ? 'dev-mudslinger' : 'sandbox', readout: false, col: k % 2 ? 6 : undefined })
    await skipIn()
    await run('right spray', 30)
    if (k % 2) {
      await tap('pause')
      await tap('up')
      await tap('confirm')
      await tap('down')
      await tap('confirm')
    } else {
      // Left by somebody else (the debug API here), in the middle of spraying.
      await ev(() => window.__maxx.go('map', {}, 'fade'))
    }
    await until(null, "m.scene() === 'map'", 200)
    await run(null, 5)
  }
  const a1 = await audioNow()
  const exits = await ev(() => window.__rec.exits.slice(-5))
  say('audio before', a0, 'after', a1, 'as each visit left', exits)
  check(exits.length === 5 && exits.every((x) => x.want === null && !x.spray && !x.paused), 'each visit leaves with no song, no hiss, nothing held')
  check(a1.want === 'map' && !a1.spray && !a1.paused && a1.voices <= 10 && a1.clips <= a0.clips + 2, 'on the map: its own song, no hiss, nothing held, no pile of voices or songs')

  /* ------------------------------------------------------------------ */
  const errors = await ev(() => Array.from(window.__maxx.errors))
  check(errors.length === 0, 'no scene errors ' + JSON.stringify(errors))
  const bad = logs.filter((l) => /^(warn|error|warning)/.test(l))
  check(bad.length === 0, 'no console warnings or errors ' + JSON.stringify(bad))
  say('every scene switch:', await ev(() => window.__rec.go))
  say(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'ALL CHECKS PASSED')
  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(problems.length + ' checks failed')
}
