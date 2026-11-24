// The scenes around the game: the title (keyboard, controller, touch), every path through
// its menu, options changing and persisting across a reload, erase save, How To Play on
// both devices, game over both ways, and the ending in its three variants (plain, rumour,
// champion) from prepared saves. Then the attacks: Start or confirm held on PRESS START, a
// direction held, the title's car wash finishing its cars, volumes at 0 and 10, a muted
// page, fullscreen turned down by the browser, Options and How To Play opened from the
// pause menu of a running level (closing back to it, no input leaking either way), the
// ending from an empty save left to run by itself, leaving game over and the ending
// mid-tune, and twenty rounds in and out of every scene. Manual time throughout; a
// stand-in Xbox pad for the controller part (as checks/pad.mjs does).
//   node scripts/maxx/serve.mjs --port 5352 -- node scripts/maxx/shot.mjs --port 5352 --w 1280 --h 830
//     --q "scene=title&manual=1&fresh=1&user=titlecheck" --script scripts/maxx/checks/title.mjs --out <folder>/end.png
// Pictures (1x, 640x360) and report.txt land in <folder>. Exit code 1 if any check fails.
// The map is somebody else's scene: this only checks that the title gets there.
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { install, saver } from './lib.mjs'

export default async ({ page, maxx, outDir }) => {
  const OUT = outDir
  mkdirSync(OUT, { recursive: true })
  const save = saver(OUT)
  const logs = []
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
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
  const step = (n = 1) => ev((n) => window.__t.run(null, n), n)
  /** Hold these actions down for n ticks, then let go for one. */
  const holdFor = async (actions, n) => {
    await ev((a, n) => window.__t.run(a, n), actions, n)
    await step(1)
  }
  const tap = async (actions, wait = 2) => {
    await ev((a) => window.__maxx.tap(a), actions)
    await step(wait)
  }
  let n = 0
  const pic = async (name) => save(String(++n).padStart(2, '0') + '-' + name + '.png', await ev(() => window.__t.native()))
  const scene = () => ev(() => window.__maxx.scene())
  const so = () =>
    ev(() => {
      const s = window.__maxx.sceneObject()
      return s ? { state: s.state, index: s.index, labels: s.labels ? Array.from(s.labels) : undefined, phase: s.phase, card: s.card, ready: s.ready, note: s.note, carStage: s.carStage } : null
    })
  const data = () => ev(() => JSON.parse(JSON.stringify(window.__maxx.ctx.save.data)))
  const session = () => ev(() => ({ ...window.__maxx.ctx.session }))
  const audio = () => ev(() => window.__rec.audio.slice())
  const clearRec = () => ev(() => {
    window.__rec.audio.length = 0
    window.__rec.rumble.length = 0
    window.__calls.length = 0
  })
  /** Put things in the save as if they had been played, and commit. */
  const prepare = (patch, levels) =>
    ev(
      (patch, levels) => {
        const sv = window.__maxx.ctx.save
        sv.reset()
        Object.assign(sv.data, patch)
        for (const [id, rec] of Object.entries(levels ?? {})) Object.assign(sv.record(id), rec)
        sv.commit()
      },
      patch,
      levels,
    )
  const goTitle = async () => {
    await ev(() => window.__maxx.go('title'))
    await step(70)
  }
  /** Walk the title menu's cursor to a row by its label, with taps of up and down. */
  const toRow = async (label) => {
    for (let k = 0; k < 8; k++) {
      const s = await so()
      const at = s.labels.indexOf(label)
      if (at < 0 || s.index === at) return at >= 0
      await tap(at > s.index ? 'down' : 'up')
    }
    return false
  }
  /** Wrap the shell's settings hooks, so a check sees what applySettings and the options did. */
  const hooks = () =>
    ev(() => {
      const c = window.__maxx.ctx
      window.__calls = []
      const wrap = (obj, key, tag) => {
        const f = obj[key].bind(obj)
        obj[key] = (...a) => {
          window.__calls.push(tag + ':' + a.join(','))
          return f(...a)
        }
      }
      wrap(c.audio, 'setVolumes', 'volumes')
      wrap(c.input, 'setRumbleEnabled', 'rumbleOn')
      wrap(c, 'toggleFullscreen', 'fullscreen')
    })
  const calls = () => ev(() => window.__calls.slice())

  await install(maxx)
  await hooks()

  /* ---------------- the title on the keyboard ---------------- */
  await step(12)
  await pic('title-logo-dropping')
  await step(60)
  let s = await so()
  check((await scene()) === 'title' && s.state === 'press', 'the title starts on PRESS START')
  check((await ev(() => window.__maxx.ctx.audio.debug?.().want)) === 'title', 'the title song is asked for')
  check((await ev(() => window.__maxx.ctx.input.device)) === 'keyboard', 'keyboard prompts before any controller')
  await step(40)
  await pic('title-keyboard')

  // Left alone, the attract loop: the story over the lot, then the logo again.
  await step(20 * 60)
  s = await so()
  check(s.state === 'attract', 'idle for 20 s on PRESS START: the attract loop (' + s.state + ')')
  await step(6 * 60)
  await pic('title-attract')
  await tap('left')
  check((await so()).state === 'press', 'any button brings PRESS START back')
  await step(60)

  await tap('jump')
  s = await so()
  check(s.state === 'press', 'a button that is not confirm leaves PRESS START up')
  await tap('confirm')
  s = await so()
  check(s.state === 'menu', 'confirm opens the menu')
  check(JSON.stringify(s.labels) === JSON.stringify(['NEW GAME', 'HOW TO PLAY', 'OPTIONS', 'SANDBOX']), 'fresh save: no CONTINUE; SANDBOX on the dev page ' + JSON.stringify(s.labels))
  await step(20)
  await pic('menu-fresh-save')
  await tap('down')
  await tap('down')
  await tap('down')
  await tap('down')
  s = await so()
  check(s.index === 0, 'the cursor wraps round the menu (' + s.index + ')')
  await tap('cancel')
  s = await so()
  check(s.state === 'press', 'cancel goes back to PRESS START')

  /* ---------------- NEW GAME with nothing saved: straight to the map ---------------- */
  await ev(() => {
    window.__maxx.ctx.session.lives = 1
    window.__maxx.ctx.session.score = 999
  })
  await tap('confirm')
  await tap('confirm')
  check((await so()).state === 'leaving', 'NEW GAME on a fresh save does not ask')
  await step(40)
  check((await scene()) === 'map', 'and it goes to the map (' + (await scene()) + ')')
  let ses = await session()
  check(ses.lives === 3 && ses.score === 0, 'with a fresh session ' + JSON.stringify(ses))

  /* ---------------- progress: CONTINUE first, and it keeps the save ---------------- */
  await prepare({ unlocked: 3, hiScore: 15400 }, { mw01: { cleared: true, bestScore: 8000 }, mw02: { cleared: true, bestScore: 7400 } })
  await goTitle()
  await tap('confirm')
  s = await so()
  check(s.labels[0] === 'CONTINUE' && s.index === 0, 'with progress, CONTINUE is first and under the cursor ' + JSON.stringify(s.labels))
  await step(20)
  await pic('menu-with-progress')
  await tap('confirm')
  await step(40)
  let d = await data()
  check((await scene()) === 'map' && d.unlocked === 3 && d.levels.mw01?.cleared === true, 'CONTINUE goes to the map and keeps the progress')

  /* ---------------- NEW GAME with progress: asks first ---------------- */
  await goTitle()
  await tap('confirm')
  check(await toRow('NEW GAME'), 'cursor on NEW GAME')
  await tap('confirm')
  s = await so()
  check(s.state === 'ask' && s.index === 0, 'NEW GAME with progress asks, NO under the cursor')
  await step(10)
  await pic('new-game-asks')
  await tap('confirm')
  s = await so()
  d = await data()
  check(s.state === 'menu' && s.labels[s.index] === 'NEW GAME' && d.unlocked === 3, 'NO goes back to the menu and erases nothing')
  await tap('confirm')
  await tap('cancel')
  s = await so()
  check(s.state === 'menu' && (await data()).unlocked === 3, 'cancel on the question is NO too')
  await tap('confirm')
  await tap('down')
  await tap('confirm')
  d = await data()
  check(d.unlocked === 1 && d.hiScore === 0 && Object.keys(d.levels).length === 0, 'YES erases the progress')
  check(d.settings.music === 7 && d.settings.sfx === 8, 'and keeps the settings ' + JSON.stringify(d.settings))
  await step(40)
  check((await scene()) === 'map', 'then it goes to the map')

  /* ---------------- SANDBOX (dev page only) ---------------- */
  await goTitle()
  await tap('confirm')
  check(await toRow('SANDBOX'), 'cursor on SANDBOX')
  await tap('confirm')
  await step(40)
  check((await scene()) === 'sandbox', 'SANDBOX opens the sandbox (' + (await scene()) + ')')

  /* ---------------- OPTIONS ---------------- */
  await goTitle()
  await tap('confirm')
  check(await toRow('OPTIONS'), 'cursor on OPTIONS')
  await clearRec()
  await tap('confirm')
  s = await so()
  check(s.state === 'options', 'OPTIONS opens the options')
  await step(10)
  await pic('options')
  await tap('right')
  await tap('right')
  d = await data()
  let c = await calls()
  check(d.settings.music === 9, 'right twice on MUSIC: 9 (' + d.settings.music + ')')
  check(c.includes('volumes:0.9,0.8'), 'and the music volume is applied at once ' + JSON.stringify(c))
  check((await audio()).filter((a) => a === 'sfx:menuMove').length >= 2, 'a blip on each change')
  await tap('right')
  await tap('right')
  await tap('right')
  check((await data()).settings.music === 10, 'MUSIC stops at 10')
  await tap('left')
  await tap('down')
  for (let k = 0; k < 3; k++) await tap('left')
  d = await data()
  check(d.settings.music === 9 && d.settings.sfx === 5, 'SOUND down three: 5 (' + d.settings.sfx + ')')
  await tap('down')
  await clearRec()
  await tap('left')
  c = await calls()
  check((await data()).settings.rumble === false && c.includes('rumbleOn:false'), 'RUMBLE off, applied ' + JSON.stringify(c))
  await tap('confirm')
  const rumbled = await ev(() => window.__rec.rumble.slice())
  check((await data()).settings.rumble === true && rumbled.length === 1, 'RUMBLE on again, with a test rumble ' + JSON.stringify(rumbled))
  await tap('down')
  await tap('confirm')
  check((await data()).settings.shake === false, 'SCREEN SHAKE off')
  await tap('down')
  await clearRec()
  await tap('confirm')
  check((await calls()).includes('fullscreen:'), 'FULLSCREEN asks the shell to toggle fullscreen')
  await step(20)
  const fs = await ev(() => window.__maxx.ctx.fullscreen)
  say('fullscreen after the toggle (headless Chrome may refuse):', fs)
  if (fs) {
    await tap('confirm')
    await step(20)
  }
  await tap('up')
  await step(10)
  await pic('options-changed')
  const stored = await ev(() => JSON.parse(localStorage.getItem('smm.save.v1.' + (new URLSearchParams(location.search).get('user') || 'dev'))).settings)
  check(JSON.stringify(stored) === JSON.stringify({ music: 9, sfx: 5, rumble: true, shake: false }), 'the settings are in localStorage ' + JSON.stringify(stored))
  await tap('cancel')
  s = await so()
  check(s.state === 'menu' && s.labels[s.index] === 'OPTIONS', 'cancel leaves the options, cursor back on OPTIONS')

  /* ---------------- the settings survive a reload ---------------- */
  const url = new URL(page.url())
  url.searchParams.delete('fresh')
  await page.goto(url.toString(), { waitUntil: 'load' })
  await page.waitForFunction('window.__maxx && window.__maxx.ready === true', { timeout: 30000 })
  // This reload is the check's own doing: tell shot.mjs this is the game to watch now.
  await ev(() => {
    window.__maxxRun = window.__maxx.handle
  })
  await install(maxx)
  await hooks()
  d = await data()
  check(JSON.stringify(d.settings) === JSON.stringify({ music: 9, sfx: 5, rumble: true, shake: false }), 'after a reload the settings are still there ' + JSON.stringify(d.settings))
  await ev(() => window.__maxx.ctx.applySettings())
  check((await calls()).includes('volumes:0.9,0.5'), 'and applySettings uses them')
  await step(70)
  await tap('confirm')
  await toRow('OPTIONS')
  await tap('confirm')
  await step(10)
  await pic('options-after-reload')

  /* ---------------- ERASE SAVE ---------------- */
  await prepare({ unlocked: 5, hiScore: 30000, secretFound: true }, { mw01: { cleared: true, tokens: [true, true, false] } })
  for (let k = 0; k < 5; k++) await tap('down')
  await tap('confirm')
  await step(10)
  await pic('erase-asks')
  await tap('confirm')
  check((await data()).unlocked === 5, 'NO on ERASE SAVE keeps the save')
  await tap('confirm')
  await tap('down')
  await tap('confirm')
  d = await data()
  check(d.unlocked === 1 && !d.secretFound && d.hiScore === 0 && Object.keys(d.levels).length === 0, 'YES erases it')
  check(d.settings.music === 9 && d.settings.shake === false, 'settings survive the erase')
  await step(10)
  await pic('erased')
  await tap('cancel')
  s = await so()
  check(s.state === 'menu' && !s.labels.includes('CONTINUE'), 'back on the menu, CONTINUE is gone ' + JSON.stringify(s.labels))

  /* ---------------- HOW TO PLAY on the keyboard ---------------- */
  check(await toRow('HOW TO PLAY'), 'cursor on HOW TO PLAY')
  await tap('confirm')
  check((await so()).state === 'howto', 'HOW TO PLAY opens')
  for (let p = 1; p <= 4; p++) {
    await step(p === 1 ? 50 : 90)
    await pic('howto-keyboard-' + p)
    if (p < 4) await tap('right')
  }
  await tap('right')
  await tap('left')
  await tap('left')
  await tap('confirm')
  await tap('confirm')
  check((await so()).state === 'howto', 'left turns back, confirm turns on')
  await tap('confirm')
  s = await so()
  check(s.state === 'menu' && s.labels[s.index] === 'HOW TO PLAY', 'confirm on the last page closes it')

  /* ---------------- the controller ---------------- */
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
  const A = 0, B = 1, MENU = 9, DOWN = 13, LEFT = 14, RIGHT = 15
  const press = async (i, wait = 2) => {
    await ev((i) => window.__btn(i, true), i)
    await step(1)
    await ev((i) => window.__btn(i, false), i)
    await step(wait)
  }
  await goTitle()
  await press(LEFT)
  check((await ev(() => window.__maxx.ctx.input.device)) === 'gamepad', 'a D-pad press makes the controller the device in use')
  check((await so()).state === 'press', 'and does not open the menu')
  await step(30)
  await pic('title-gamepad')
  // Start held down: it opens the menu and must not also pick its first row.
  await ev(() => window.__btn(9, true))
  await step(30)
  await ev(() => window.__btn(9, false))
  await step(2)
  s = await so()
  check(s.state === 'menu' && (await scene()) === 'title', 'Menu (Start) held opens the menu and picks nothing (' + s.state + ')')
  // The stick held down walks the list with repeat: a step at once, the next one 20 ticks later.
  await ev(() => window.__stick(0, 1))
  await step(24)
  await ev(() => window.__stick(0, 0))
  await step(2)
  s = await so()
  check(s.index === 2, 'the stick held down walks the menu with repeat (' + s.index + ')')
  await press(B)
  check((await so()).state === 'press', 'B goes back')
  await press(A)
  check(await toRowPad('HOW TO PLAY'), 'D-pad to HOW TO PLAY')
  await press(A)
  check((await so()).state === 'howto', 'A opens HOW TO PLAY')
  for (let p = 1; p <= 4; p++) {
    await step(p === 1 ? 50 : 90)
    await pic('howto-gamepad-' + p)
    if (p < 4) await press(RIGHT)
  }
  await press(B)
  s = await so()
  check(s.state === 'menu', 'B closes HOW TO PLAY')
  await toRowPad('OPTIONS')
  await press(A)
  await step(10)
  await pic('options-gamepad')
  await press(B)

  async function toRowPad(label) {
    for (let k = 0; k < 8; k++) {
      const st = await so()
      const at = st.labels.indexOf(label)
      if (at < 0 || st.index === at) return at >= 0
      await press(at > st.index ? DOWN : 12)
    }
    return false
  }

  /* ---------------- touch ---------------- */
  await goTitle()
  await ev(() => window.__maxx.ctx.input.touchUsed())
  await step(30)
  check((await ev(() => window.__maxx.ctx.input.device)) === 'touch', 'a finger on the game makes touch the device')
  await pic('title-touch')

  /* ---------------- game over, both ways ---------------- */
  await prepare({ unlocked: 4, hiScore: 12000 }, { mw01: { cleared: true }, mw02: { cleared: true }, mw03: { cleared: true } })
  await ev(() => {
    const ses = window.__maxx.ctx.session
    ses.lives = 0
    ses.score = 4321
  })
  await clearRec()
  await ev(() => window.__maxx.go('gameover', { from: 'mw04' }))
  await step(24)
  check((await audio()).includes('jingle:gameover'), "the 'gameover' jingle plays")
  await pic('gameover-drop')
  await step(110)
  s = await so()
  check(s.ready && s.index === 0, 'the choice is up, CONTINUE first')
  await pic('gameover-continue')
  await tap('confirm')
  await step(40)
  ses = await session()
  d = await data()
  check((await scene()) === 'map' && ses.lives === 3 && ses.score === 0, 'CONTINUE: the map with a fresh session ' + JSON.stringify(ses))
  check(d.unlocked === 4 && d.levels.mw03?.cleared === true, 'progress kept')
  await ev(() => window.__maxx.go('gameover', { from: 'mw02' }))
  await step(16)
  await tap('confirm')
  s = await so()
  check(s.ready && s.index === 0 && (await scene()) === 'gameover', 'an early press only hurries it to the choice')
  await step(10)
  await tap('right')
  check((await so()).index === 1, 'right moves to QUIT')
  await tap('left')
  check((await so()).index === 0, 'left back to CONTINUE')
  await tap('down')
  await step(20)
  await pic('gameover-quit')
  await tap('confirm')
  await step(40)
  check((await scene()) === 'title', 'QUIT goes to the title')
  check((await data()).unlocked === 4, 'progress still kept')

  /* ---------------- the ending, three ways ---------------- */
  const allClear = {}
  for (let i = 1; i <= 8; i++) allClear['mw0' + i] = { cleared: true, spotless: i % 3 === 0, tokens: [true, i % 2 === 0, i < 4] }
  const variants = [
    ['plain', { unlocked: 8, hiScore: 187650, secretFound: true, rivalsBeaten: 2 }, ''],
    ['rumour', { unlocked: 8, hiScore: 98200, secretFound: false }, 'rumour'],
    ['champion', { unlocked: 8, hiScore: 254300, secretFound: true, rivalsBeaten: 4, champion: true }, 'champion'],
  ]
  for (const [name, patch, card] of variants) {
    await prepare(patch, allClear)
    await clearRec()
    await ev(() => window.__maxx.go('ending'))
    await step(2)
    d = await data()
    s = await so()
    check(d.finished === true, name + ': save.finished is set on the way in')
    check(s.phase === 'thanks' && s.card === card, name + ': starts on the thank-you, last card ' + JSON.stringify(s.card))
    check((await audio()).includes('music:ending'), name + ": the 'ending' song is asked for")
    if (name === 'plain') {
      await step(120)
      await pic('ending-congratulations')
      await step(300)
      await pic('ending-thanks')
    }
    await step(45)
    await tap('confirm')
    if ((await so()).phase === 'thanks') {
      await step(45)
      await tap('confirm')
    }
    check((await so()).phase === 'numbers', name + ': confirm moves on to the numbers')
    await step(240)
    if (name === 'plain') await pic('ending-numbers')
    await step(10)
    await tap('confirm')
    check((await so()).phase === 'credits', name + ': then the credits')
    if (name === 'plain') {
      await step(300)
      await pic('ending-credits')
      await step(500)
      await pic('ending-credits-night')
    }
    // Confirm held speeds the credits up.
    for (let k = 0; k < 40 && (await so()).phase === 'credits'; k++) await ev(() => window.__t.run('confirm', 30))
    await ev(() => window.__maxx.release())
    await step(2)
    s = await so()
    check(s.phase === (card ? 'card' : 'end'), name + ': after the credits, ' + (card ? 'the ' + card + ' card' : 'THE END') + ' (' + s.phase + ')')
    if (card) {
      await step(60)
      await pic('ending-card-' + card)
      await step(10)
      await tap('confirm')
      check((await so()).phase === 'end', name + ': then THE END')
    }
    await step(80)
    if (name !== 'rumour') await pic('ending-the-end-' + name)
    await tap('confirm')
    await step(40)
    check((await scene()) === 'title', name + ': and back to the title')
  }

  /* ---------------- attacks: the keyboard again ---------------- */
  await ev(() => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [null, null, null, null] })
  })
  await page.keyboard.press('ArrowLeft')
  await step(2)
  await prepare({}, {})
  await goTitle()
  // Confirm held on PRESS START: the menu, nothing picked, however long it is held.
  await holdFor('confirm', 45)
  await step(1)
  s = await so()
  check(s.state === 'menu' && s.index === 0 && (await scene()) === 'title', 'confirm held on PRESS START: the menu, nothing picked (' + s.state + ')')
  // A direction held: the cursor walks with repeat (a step at once, then after 20 ticks, then every 7).
  await clearRec()
  await holdFor('down', 60)
  await step(1)
  const moves = (await audio()).filter((a) => a === 'sfx:menuMove').length
  check(moves >= 6 && moves <= 8, 'down held 60 ticks walks the menu ' + moves + ' rows (6 to 8 expected)')
  s = await so()
  check(s.state === 'menu', 'and the menu is still up')

  // The art these screens borrow from other slices is there under the names they use.
  const borrowed = ['cars/sedan_p0', 'cars/sedan_d3', 'cars/sedan_happy', 'cars/sedan_wide', 'cars/monster_p0', 'cars/wheel16c0', 'cars/wheel44d0', 'items/coin0', 'items/token0', 'items/bubble0', 'hud/pip', 'hud/pipEmpty', 'tiles/any_prize0']
  const missing = await ev((names) => names.filter((n) => !window.__maxx.ctx.sprites.has(n)), borrowed)
  check(missing.length === 0, 'the cars, items, HUD and tile frames these screens draw exist ' + JSON.stringify(missing))

  // The title's car wash really washes: a car comes up filthy and leaves clean.
  const stages = new Set()
  for (let k = 0; k < 60; k++) {
    await step(10)
    stages.add((await so()).carStage)
  }
  check(stages.has(3) && stages.has(0), 'a car on the title lot goes from filthy to clean ' + JSON.stringify([...stages]))

  /* ---------------- options at the edges ---------------- */
  await tap('cancel')
  await tap('confirm')
  await toRow('OPTIONS')
  await tap('confirm')
  check((await so()).state === 'options', 'OPTIONS again')
  // MUSIC down to 0, held: it stops there, and a press past the end is silent.
  await holdFor('left', 120)
  await step(1)
  d = await data()
  check(d.settings.music === 0, 'MUSIC held left: 0 (' + d.settings.music + ')')
  check((await calls()).some((c) => c.startsWith('volumes:0,')), 'music volume 0 is applied')
  await clearRec()
  await tap('left')
  check((await data()).settings.music === 0 && !(await audio()).includes('sfx:menuMove'), 'left at 0: nothing changes and nothing sounds')
  // SOUND up to 10.
  await tap('down')
  await holdFor('right', 120)
  await step(1)
  d = await data()
  check(d.settings.sfx === 10, 'SOUND held right: 10 (' + d.settings.sfx + ')')
  check((await calls()).some((c) => c.endsWith(',1')), 'sound volume 1.0 is applied')
  await clearRec()
  await tap('right')
  check((await data()).settings.sfx === 10 && !(await audio()).includes('sfx:menuMove'), 'right at 10: nothing changes and nothing sounds')
  await step(10)
  await pic('options-edges')
  // Muted on the page: the screen says so, and a volume change turns sound back on (a controller cannot reach M).
  await ev(() => window.__maxx.ctx.setMuted(true))
  await step(2)
  check((await so()).note === 'muted', 'muted: the options say so')
  await step(10)
  await pic('options-muted')
  await tap('left')
  check((await ev(() => window.__maxx.ctx.muted)) === false, 'a volume change unmutes')
  await tap('up')
  await tap('right')
  await tap('right')
  await tap('down')
  await tap('left')
  await tap('left')

  // Fullscreen turned down by the browser: the value stays OFF and the screen says why.
  await ev(() => {
    window.__realFs = HTMLElement.prototype.requestFullscreen
    HTMLElement.prototype.requestFullscreen = function () {
      return Promise.reject(new Error('turned down'))
    }
  })
  for (let k = 0; k < 3; k++) await tap('down')
  await tap('confirm')
  await step(60)
  check((await ev(() => window.__maxx.ctx.fullscreen)) === false && (await so()).note === 'refused', 'fullscreen refused: still OFF, and a note says why (' + (await so()).note + ')')
  await pic('options-fullscreen-refused')
  await ev(() => {
    HTMLElement.prototype.requestFullscreen = window.__realFs
  })
  await tap('cancel')
  check((await so()).state === 'menu', 'cancel leaves the options')

  /* ---------------- options and how to play from the pause menu ---------------- */
  const play = () => ev(() => window.__maxx.sceneObject().state())
  await ev(() => window.__maxx.go('play', { level: 'sandbox' }))
  let ps = null
  for (let k = 0; k < 40; k++) {
    await step(10)
    if ((await scene()) === 'play') {
      ps = await play()
      if (ps.phase === 'run') break
    }
  }
  check(ps && ps.phase === 'run', 'the sandbox level is running (' + (ps && ps.phase) + ')')
  await tap('pause')
  ps = await play()
  check(ps.paused && ps.screen === 'menu', 'paused')
  for (let k = 0; k < 3; k++) await tap('down')
  await tap('confirm')
  ps = await play()
  check(ps.paused && ps.screen === 'options', 'OPTIONS from the pause menu')
  const musicWas = (await data()).settings.music
  await tap('right')
  check((await data()).settings.music === Math.min(10, musicWas + 1), 'MUSIC changes there too')
  await step(10)
  await pic('pause-options')
  // The P key (pause alone) inside the options does not resume the game under them.
  await tap('pause')
  ps = await play()
  check(ps.paused && ps.screen === 'options', 'pause alone inside the options changes nothing')
  // Esc is cancel and pause at once: it closes the options, and must not resume as well.
  await tap(['cancel', 'pause'])
  await step(5)
  ps = await play()
  check(ps.paused && ps.screen === 'menu' && ps.menuIndex === 3, 'Esc closes the options back to the pause menu, on OPTIONS, still paused')
  // How To Play from the pause menu: confirm through every page closes it back to the menu.
  await tap('up')
  await tap('confirm')
  ps = await play()
  check(ps.screen === 'howto', 'HOW TO PLAY from the pause menu')
  await step(30)
  await pic('pause-howto')
  for (let k = 0; k < 4; k++) await tap('confirm')
  ps = await play()
  check(ps.paused && ps.screen === 'menu' && ps.menuIndex === 2, 'confirm through its pages closes it back to the pause menu, still paused')
  await tap('cancel')
  ps = await play()
  check(!ps.paused, 'cancel on the pause menu resumes')

  /* ---------------- the ending with an empty save ---------------- */
  await prepare({}, {})
  await ev(() => window.__maxx.go('ending'))
  await step(2)
  s = await so()
  check(s.phase === 'thanks' && s.card === 'rumour', 'empty save: the ending starts, with the rumour card to come')
  // Every part moves on by itself.
  for (let k = 0; k < 60 && (await scene()) === 'ending'; k++) await step(100)
  check((await scene()) === 'title' && (await data()).finished === true, 'left alone, the ending runs to the end and back to the title')

  /* ---------------- leaving in the middle of a tune ---------------- */
  await ev(() => window.__maxx.go('gameover', { from: 'rivals' }))
  await step(14)
  await tap('confirm')
  await step(2)
  await tap('confirm')
  await step(40)
  const snd = await ev(() => window.__maxx.ctx.audio.debug?.() ?? null)
  check((await scene()) === 'map', 'game over left at once: on the map')
  // The shell cuts a jingle whose scene has been left, so the map's own song is not held back.
  check(!!snd && !snd.jingle && snd.want === 'map', 'the game over jingle stops at the switch and the map song is wanted (jingle ' + JSON.stringify(snd && snd.jingle) + ', want ' + JSON.stringify(snd && snd.want) + ')')
  await ev(() => window.__maxx.go('ending'))
  await step(100)
  await ev(() => window.__maxx.go('title', {}, 'fade'))
  await step(40)
  check((await ev(() => window.__maxx.ctx.audio.debug?.().want)) === 'title', 'the ending left early: the title song is wanted')

  /* ---------------- in and out twenty times ---------------- */
  const tstats = () => ev(() => window.__t.mod('engine/text.ts').then((m) => m.textStats()))
  const heap = () => ev(() => (performance.memory ? performance.memory.usedJSHeapSize : 0))
  const t0 = await tstats()
  const h0 = await heap()
  for (let k = 0; k < 20; k++) {
    await goTitle()
    await tap('confirm')
    await toRow('OPTIONS')
    await tap('confirm')
    await step(5)
    await tap('cancel')
    await toRow('HOW TO PLAY')
    await tap('confirm')
    await step(5)
    await tap('cancel')
    await ev(() => window.__maxx.go('gameover', { from: 'mw01' }))
    await step(100)
    await tap('right')
    await tap('confirm')
    await step(30)
    await ev(() => window.__maxx.go('ending'))
    await step(60)
  }
  await goTitle()
  const t1 = await tstats()
  const h1 = await heap()
  say('  text caches before ' + JSON.stringify(t0) + ' after ' + JSON.stringify(t1) + '; JS heap ' + Math.round(h0 / 1e6) + ' MB -> ' + Math.round(h1 / 1e6) + ' MB')
  check(t1.canvases === t0.canvases, 'twenty rounds through every scene make no new text canvases')
  check((await ev(() => document.querySelectorAll('canvas').length)) === 1, 'and leave one canvas on the page')

  const errors = await ev(() => Array.from(window.__maxx.errors))
  check(errors.length === 0, 'no scene errors ' + JSON.stringify(errors))
  // Song files with format problems belong to the music slice: reported, not failed here.
  const songs = logs.filter((l) => l.includes('problem(s) in audio/songs'))
  if (songs.length) say('note: the audio module warned about song files (not this check):', songs[0].split('\n').slice(0, 3).join(' / '))
  const bad = logs.filter((l) => /^(warn|error|warning)/.test(l) && !songs.includes(l))
  check(bad.length === 0, 'no console warnings or errors ' + JSON.stringify(bad.slice(0, 5)))
  say(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'ALL CHECKS PASSED')
  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(problems.length + ' checks failed')
}
