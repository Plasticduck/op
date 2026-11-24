// An Xbox pad through the whole stack, in manual mode: a stand-in navigator.getGamepads()
// (standard mapping) -> engine/input.ts -> the simulation -> the sandbox scene -> rumble and
// prompts, then Start through the title's menu to the map. The places it stands Maxx (the sign,
// the pipe, the bonus room's door, the sedan) are the sandbox level's, which is frozen.
//   node scripts/maxx/shot.mjs --q "scene=sandbox&manual=1&fresh=1" --w 1280 --h 830 --script scripts/maxx/checks/pad.mjs --out <folder>/end.png
// Pictures and report.txt land in <folder>. Exit code 1 if any check fails. All of them: node scripts/maxx/check.mjs
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
  await install(maxx)
  const ev = (fn, ...args) => page.evaluate(fn, ...args)
  const where = await ev(() => ({ scene: window.__maxx.scene(), level: window.__maxx.world()?.level?.id ?? null }))
  check(where.scene === 'sandbox' && where.level === 'sandbox', 'the sandbox scene on the sandbox level (' + JSON.stringify(where) + ')')
  if (problems.length) throw new Error('open it with --q "scene=sandbox&manual=1&fresh=1"')
  const info = () => ev(() => ({ ...window.__t.info(), device: window.__maxx.ctx.input.device, pad: window.__maxx.ctx.input.padName, connected: window.__maxx.ctx.input.gamepadConnected }))
  const step = (n = 1) => ev((n) => window.__t.run(null, n), n)
  let n = 0
  const pic = async (name) => {
    const tag = String(++n).padStart(2, '0') + '-' + name
    save(tag + '.png', await ev(() => window.__t.native()))
  }

  // The pad: what Chrome hands over for an Xbox controller.
  await ev(() => {
    const pad = {
      id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: {
        type: 'dual-rumble',
        playEffect(type, params) {
          window.__rumbled.push({ type, ...params })
          return Promise.resolve('complete')
        },
        reset: () => Promise.resolve('complete'),
      },
    }
    window.__rumbled = []
    window.__pad = pad
    window.__plugged = false
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => (window.__plugged ? [pad, null, null, null] : [null, null, null, null]) })
    window.__btn = (i, down, value) => {
      pad.buttons[i] = { pressed: !!down, touched: !!down, value: value ?? (down ? 1 : 0) }
      pad.timestamp++
    }
    window.__stick = (x, y) => {
      pad.axes[0] = x
      pad.axes[1] = y
      pad.timestamp++
    }
    window.__clearPad = () => {
      for (let i = 0; i < 17; i++) pad.buttons[i] = { pressed: false, touched: false, value: 0 }
      pad.axes[0] = pad.axes[1] = 0
    }
  })
  const btn = (i, down, value) => ev((i, d, v) => window.__btn(i, d, v), i, down, value ?? null)
  const stick = (x, y) => ev((x, y) => window.__stick(x, y), x, y)
  const A = 0, B = 1, X = 2, RB = 5, RT = 7, VIEW = 8, MENU = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15

  /* before any pad: keyboard prompts */
  await step(40)
  let i = await info()
  check(i.device === 'keyboard' && !i.connected, 'starts on the keyboard with no controller')
  const glyphs = () => ev(() => Object.fromEntries(['move', 'left', 'right', 'up', 'down', 'jump', 'spray', 'confirm', 'cancel', 'pause', 'select'].map((a) => [a, window.__maxx.ctx.input.glyph(a)])))
  say('keyboard glyphs', await glyphs())
  await ev(() => window.__t.place(4.5, 320, 1))
  await step(30)
  await pic('sign-keyboard')

  /* plug in, press A */
  await ev(() => {
    window.__plugged = true
  })
  await step(2)
  i = await info()
  check(i.device === 'keyboard', 'a pad that is only plugged in does not take over the prompts')
  await btn(A, true)
  await step(1)
  i = await info()
  check(i.device === 'gamepad' && i.connected && /xbox/i.test(i.pad), 'A makes the controller the device in use (' + i.pad + ')')
  check(!i.ground && i.vy < 0, 'and A jumps')
  const padGlyphs = await glyphs()
  say('gamepad glyphs', padGlyphs)
  check(padGlyphs.jump === 'pad_a' && padGlyphs.spray === 'pad_x' && padGlyphs.pause === 'pad_start' && padGlyphs.move === 'pad_dpad', 'prompts are Xbox glyphs')
  await step(10)
  await btn(A, false)
  await ev(() => window.__t.until(null, (w) => w.player.onGround, 200))
  await step(20)
  await pic('sign-gamepad')
  const status = await ev(() => window.__maxx.status())
  check(status.device === 'gamepad' && status.gamepadConnected && status.padName !== '', 'the page status says a controller is connected')

  /* the stick: analog run */
  await ev(() => window.__t.place(6, 320, 1))
  await stick(1, 0)
  await step(30)
  i = await info()
  check(Math.round(i.vx) === 215, 'stick fully right: full run speed (' + i.vx + ')')
  await stick(0.5, 0)
  await step(40)
  i = await info()
  check(i.vx > 100 && i.vx < 115, 'stick half way: about half speed (' + i.vx + ')')
  await stick(0.2, 0)
  await step(40)
  i = await info()
  check(i.vx === 0, 'inside the dead zone: stands (' + i.vx + ')')
  await stick(-1, 0)
  await step(30)
  i = await info()
  check(Math.round(i.vx) === -215 && i.facing === -1, 'stick left: runs left')
  await stick(0, 0)
  await step(30)

  /* the stick: run and aim up on the diagonal, with X */
  await ev(() => window.__t.place(6, 320, 1))
  await stick(0.71, -0.71)
  await btn(X, true)
  await step(30)
  i = await info()
  const frame = await ev(() => window.__maxx.frame())
  say('diagonal frame', { axisX: frame.axisX, axisY: frame.axisY, up: frame.held.up, right: frame.held.right })
  check(i.aim === 'up' && i.spraying && Math.round(i.vx) === 150, 'stick up and right with X: sprays up at the full spray-run speed (' + i.vx + ')')
  await pic('stick-diagonal-spray-up')
  await btn(X, false)
  await step(20)
  i = await info()
  check(Math.round(i.vx) === 215, 'the same diagonal without spray is a full run (' + i.vx + ')')
  await stick(0, 0)
  await step(30)

  /* every spray button */
  for (const [name, b, value] of [
    ['X', X],
    ['B', B],
    ['RB', RB],
    ['RT pulled 0.6', RT, 0.6],
  ]) {
    await btn(b, true, value)
    await step(4)
    i = await info()
    check(i.spraying, name + ' sprays')
    await btn(b, false)
    await step(4)
    i = await info()
    check(!i.spraying, name + ' released stops')
  }
  await btn(RT, true, 0.2)
  await step(3)
  i = await info()
  check(!i.spraying, 'RT barely touched (0.2) does not spray')
  await btn(RT, false)

  /* D-pad */
  await ev(() => window.__t.place(6, 320, 1))
  await btn(RIGHT, true)
  await step(30)
  i = await info()
  check(Math.round(i.vx) === 215, 'D-pad right runs')
  await btn(RIGHT, false)
  await btn(LEFT, true)
  await step(30)
  i = await info()
  check(Math.round(i.vx) === -215, 'D-pad left runs')
  await btn(LEFT, false)
  await btn(UP, true)
  await btn(X, true)
  await step(20)
  i = await info()
  check(i.aim === 'up' && i.spraying, 'D-pad up with X aims up')
  await btn(UP, false)
  await btn(X, false)
  await step(20)

  /* hover: A to jump, then stick down with X */
  await ev(() => window.__t.place(8, 320, 1))
  await step(2)
  await btn(A, true)
  await step(24)
  await ev(() => window.__t.until(null, (w) => w.player.vy > 0, 60))
  await btn(A, false)
  await stick(0, 1)
  await btn(X, true)
  await step(10)
  i = await info()
  check(i.hovering && i.aim === 'down', 'stick down with X in the air hovers')
  await pic('hover-on-stick')
  await stick(0, 0)
  await btn(X, false)
  await ev(() => window.__t.until(null, (w) => w.player.onGround, 300))

  /* a pipe on the stick, and no bounce straight back */
  await ev(() => window.__t.place(181, 256, 1))
  await step(6)
  await stick(0, 1)
  await step(1)
  i = await info()
  check(i.state === 'warp', 'stick down on the pipe goes in')
  await ev(() => window.__t.until(null, (w) => w.area.id === 'bonus' && !w.warp, 300))
  await step(40)
  i = await info()
  check(i.area === 'bonus' && i.state === 'normal', 'still holding down: he stays in the bonus room')
  await stick(0, 0)
  await step(5)
  /* a door on the stick: a push, not a hold */
  await ev(() => window.__t.place(13.5, 640, 1))
  await step(40)
  await stick(0, -1)
  await step(1)
  i = await info()
  check(i.state === 'warp', 'stick up at the door goes through')
  await ev(() => window.__t.until(null, (w) => w.area.id === 'main' && !w.warp, 300))
  await step(60)
  i = await info()
  check(i.area === 'main' && i.state === 'normal', 'still holding up: he does not walk straight back')
  await stick(0, 0)
  await step(5)

  /* rumble reaches the pad */
  const r0 = await ev(() => window.__rumbled.length)
  await ev(() => window.__t.place(71, 320, 1))
  await ev(() => window.__t.until(null, (w) => w.player.state === 'hurt', 600))
  const rumbles = await ev((k) => window.__rumbled.slice(k), r0)
  say('rumble effects sent to the pad', rumbles)
  check(rumbles.some((r) => r.type === 'dual-rumble' && r.strongMagnitude === 0.7 && r.weakMagnitude === 0.5 && r.duration === 180), 'a hit plays dual-rumble 0.7 / 0.5 for 180 ms on the pad')
  await step(100)
  /* rumble switched off in the settings */
  await ev(() => {
    const m = window.__maxx
    m.ctx.save.data.settings.rumble = false
    m.ctx.applySettings()
  })
  const r1 = await ev(() => window.__rumbled.length)
  await ev(() => window.__t.place(71, 320, 1))
  await ev(() => {
    const w = window.__maxx.world()
    w.player.invuln = 0
  })
  await ev(() => window.__t.until(null, (w) => w.player.state === 'hurt' || w.status !== 'play', 600))
  check((await ev(() => window.__rumbled.length)) === r1, 'with rumble off in the settings nothing is sent')
  await ev(() => {
    const m = window.__maxx
    m.ctx.save.data.settings.rumble = true
    m.ctx.applySettings()
  })
  await step(100)

  /* Menu pauses and resumes, View starts over */
  // A fresh attempt first: the sedan may have grimed him by now, and a grimed world stands still anyway.
  await btn(VIEW, true)
  await step(1)
  await btn(VIEW, false)
  await step(5)
  await ev(() => window.__t.place(4.5, 320, 1))
  await step(30)
  const t0 = (await info()).tick
  await btn(MENU, true)
  await step(1)
  await btn(MENU, false)
  await step(20)
  i = await info()
  check(i.status === 'play' && (i.tick === t0 || i.tick === t0 + 1), 'Menu pauses')
  const tp = i.tick
  await pic('paused-gamepad')
  await btn(MENU, true)
  await step(1)
  await btn(MENU, false)
  await step(10)
  i = await info()
  check(i.tick > tp, 'Menu again resumes')
  await ev(() => window.__t.place(30, 320, 1))
  await step(5)
  await btn(VIEW, true)
  await step(1)
  await btn(VIEW, false)
  await step(2)
  i = await info()
  check(i.x === 69 && i.tick <= 3, 'View starts the sandbox over')

  /* keyboard takes the prompts back, the pad takes them again */
  await page.keyboard.press('ArrowRight')
  await step(1)
  i = await info()
  check(i.device === 'keyboard', 'a key press switches prompts to the keyboard')
  await btn(B, true)
  await step(1)
  await btn(B, false)
  await step(1)
  i = await info()
  check(i.device === 'gamepad', 'a pad button switches them back')

  /* the title screen on the pad: Start opens the menu, Start again picks its first row */
  const title = () => ev(() => ({ scene: window.__maxx.scene(), state: window.__maxx.sceneObject()?.state, labels: window.__maxx.sceneObject()?.labels, index: window.__maxx.sceneObject()?.index }))
  await ev(() => window.__maxx.go('title'))
  await step(3)
  await pic('title-gamepad')
  await btn(MENU, true)
  await step(1)
  await btn(MENU, false)
  await step(10)
  const t1 = await title()
  check(t1.scene === 'title' && t1.state === 'menu' && t1.index === 0, 'Menu on PRESS START opens the title menu (' + t1.state + ', ' + JSON.stringify(t1.labels) + ')')
  await pic('title-menu-gamepad')
  await btn(MENU, true)
  await step(1)
  await btn(MENU, false)
  await step(30)
  const scene = await ev(() => window.__maxx.scene())
  check(scene === 'map', 'Menu again picks ' + (t1.labels?.[0] ?? '?') + ' and starts the game (scene ' + scene + ')')
  await pic('map-gamepad')

  /* unplugged */
  await ev(() => {
    window.__plugged = false
  })
  await step(2)
  i = await ev(() => ({ device: window.__maxx.ctx.input.device, connected: window.__maxx.ctx.input.gamepadConnected }))
  check(i.device === 'keyboard' && !i.connected, 'unplugged: prompts fall back to the keyboard')

  const errors = await ev(() => Array.from(window.__maxx.errors))
  check(errors.length === 0, 'no scene errors ' + JSON.stringify(errors))
  const bad = logs.filter((l) => /^(warn|error|warning)/.test(l))
  check(bad.length === 0, 'no console warnings or errors ' + JSON.stringify(bad))
  say(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'ALL CHECKS PASSED')
  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(problems.length + ' checks failed')
}
