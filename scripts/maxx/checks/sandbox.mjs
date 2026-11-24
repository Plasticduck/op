// Plays the sandbox level beat by beat in manual mode, checks each beat and photographs it:
// stand, run, spray, jump, every block, wash a car and ride it, a hit, pipe and door, hover,
// lift, spring, pickups, wax, grimed, a clod, a sports car, the secret exit, the goal, the clock,
// a sign, pause. It also checks that every sound the simulation asks for reaches the audio
// module and that every Maxx animation is shown, with frames the atlas has.
//   node scripts/maxx/shot.mjs --q "scene=sandbox&manual=1&fresh=1" --w 1280 --h 830 --script scripts/maxx/checks/sandbox.mjs --out <folder>/end.png
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
  // The pixel tests read the sandbox scene's flat colours (sky, ground, pipe) and every place
  // is a column of the frozen sandbox level; the real renderer draws neither.
  const where = await ev(() => ({ scene: window.__maxx.scene(), level: window.__maxx.world()?.level?.id ?? null }))
  check(where.scene === 'sandbox' && where.level === 'sandbox', 'the sandbox scene on the sandbox level, flat colours (' + JSON.stringify(where) + ')')
  if (problems.length) throw new Error('open it with --q "scene=sandbox&manual=1&fresh=1"')
  const info = () => ev(() => window.__t.info())
  const run = (actions, n, axis) => ev((a, n, axis) => window.__t.run(a, n, axis), actions, n, axis ?? null)
  const place = (col, feetY = 320, face = 1) => ev((c, y, f) => window.__t.place(c, y, f), col, feetY, face)
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
  const pic = async (name, { zoom = true, full = true, w = 176, h = 128, scale = 5 } = {}) => {
    const tag = String(++n).padStart(2, '0') + '-' + name
    if (full) save(tag + '.png', await ev(() => window.__t.native()))
    if (zoom) {
      save(
        tag + '-zoom.png',
        await ev(
          (w, h, s) => {
            const wd = window.__maxx.world()
            const p = wd.player
            return window.__t.zoom(p.x + 11 - Math.round(wd.camera.x), p.y + 20 - Math.round(wd.camera.y), w, h, s)
          },
          w,
          h,
          scale,
        ),
      )
    }
    const i = await info()
    say(`[${tag}]`, i)
    return i
  }

  const css = await ev(() => {
    const c = document.querySelector('canvas')
    return { backing: [c.width, c.height], css: [c.style.width, c.style.height], dpr: devicePixelRatio }
  })
  say('canvas', css)

  /* 1. stand */
  await run(null, 2)
  let i = await pic('stand')
  check(i.state === 'normal' && i.ground && i.y === 268, 'stands on the ground at y 268')
  check(/^maxx\/idle\d$/.test(i.frame ?? ''), 'idle frame (' + i.frame + ')')
  // The row under his feet is ground, the row above it is boot: the anchor sits on the ground line.
  const feet = await ev(() => {
    const w = window.__maxx.world()
    const p = w.player
    const cx = Math.round(p.x) + 11 - Math.round(w.camera.x)
    const fy = Math.round(p.y) + 52 - Math.round(w.camera.y)
    const under = []
    const sole = []
    for (let dx = -30; dx <= 30; dx++) {
      under.push(window.__t.pixel(cx + dx, fy))
      sole.push(window.__t.pixel(cx + dx, fy - 2))
    }
    return { under: [...new Set(under)], soleNotSky: sole.filter((c) => c !== '#5cc8ff' && c !== '#ffe866').length }
  })
  say('feet', feet)
  check(feet.under.every((c) => c === '#7a4a1a' || c === '#1e0d06') && feet.soleNotSky > 8, 'nothing of him is drawn below the ground line, and his boots reach it')
  await run(null, 100)
  await pic('stand-later', { full: false })
  await run(null, 40)
  await pic('stand-blink', { full: false })

  /* 2. run right, spray while running, run left */
  await run('right', 30)
  i = await pic('run-right')
  check(i.vx > 200, 'reaches run speed')
  check(/^maxx\/run\d+$/.test(i.frame ?? ''), 'run frame (' + i.frame + ')')
  await run('right', 3)
  await pic('run-right-b', { full: false })
  await run('right spray', 12)
  i = await pic('spray-run')
  check(i.spraying && i.drops > 0, 'spraying while running makes droplets')
  check(/^maxx\/sprayRun\d+$/.test(i.frame ?? ''), 'sprayRun frame (' + i.frame + ')')
  await run('right up spray', 12)
  i = await pic('spray-up-run')
  check(i.aim === 'up', 'aims up')
  check(/^maxx\/sprayUpRun\d+$/.test(i.frame ?? ''), 'sprayUpRun frame (' + i.frame + ')')
  await run('right', 25)
  await run('left', 2)
  i = await pic('skid', { full: false })
  check(i.vx > 70, 'still sliding right while pushing left')
  check(/^maxx\/skid0$/.test(i.frame ?? ''), 'skid frame (' + i.frame + ')')
  await run('left', 30)
  await pic('run-left')
  await run('left spray', 10)
  await pic('spray-run-left', { full: false })
  await run(null, 30)

  /* nozzle and droplets, standing, both ways */
  await place(4, 320, 1)
  await run(null, 3)
  await run('spray', 1)
  await pic('nozzle-right-first-drop', { full: false, w: 96, h: 80, scale: 8 })
  let d = await ev(() => {
    const w = window.__maxx.world()
    const p = w.player
    return w.droplets.map((d) => ({ dx: +(d.x - (p.x + 11)).toFixed(2), dy: +(d.y - (p.y + 52)).toFixed(2) }))
  })
  say('first droplet from the anchor, facing right', d)
  check(d.length === 1 && d[0].dx === 30 && d[0].dy === -30, 'first droplet is born at MUZZLE.fwd (30, -30)')
  await run('spray', 8)
  await pic('spray-idle-right', { full: false })
  await run(null, 30)
  await run('left', 2)
  await run(null, 20)
  await run('spray', 1)
  await pic('nozzle-left-first-drop', { full: false, w: 96, h: 80, scale: 8 })
  d = await ev(() => {
    const w = window.__maxx.world()
    const p = w.player
    return w.droplets.map((d) => ({ dx: +(d.x - (p.x + 11)).toFixed(2), dy: +(d.y - (p.y + 52)).toFixed(2) }))
  })
  say('first droplet from the anchor, facing left', d)
  check(d.length === 1 && d[0].dx === -30 && d[0].dy === -30, 'first droplet is born at mirrored MUZZLE.fwd (-30, -30)')
  await run('spray up', 9)
  await pic('spray-up-idle-left', { full: false })
  await run(null, 30)
  await run('right', 2)
  await run(null, 20)
  await run('spray up', 1)
  await pic('nozzle-up-right-first-drop', { full: false, w: 96, h: 96, scale: 8 })
  d = await ev(() => {
    const w = window.__maxx.world()
    const p = w.player
    return w.droplets.map((d) => ({ dx: +(d.x - (p.x + 11)).toFixed(2), dy: +(d.y - (p.y + 52)).toFixed(2) }))
  })
  check(d.length === 1 && d[0].dx === 24 && d[0].dy === -54, 'first up droplet is born at MUZZLE.up (24, -54)')
  await run(null, 30)
  say('heard so far', await heard())

  /* 3. jump */
  await place(4, 320, 1)
  await run(null, 3)
  await run('right jump', 10)
  i = await pic('jump-rising')
  check(!i.ground && i.vy < 0, 'rising')
  check(/^maxx\/jump0$/.test(i.frame ?? ''), 'jump frame (' + i.frame + ')')
  await ev(() => window.__t.until('right', (w) => w.player.vy > 60, 120))
  i = await pic('jump-falling')
  check(!i.ground && i.vy > 0, 'falling')
  check(/^maxx\/fall0$/.test(i.frame ?? ''), 'fall frame (' + i.frame + ')')
  await ev(() => window.__t.until('right', (w) => w.player.onGround, 120))
  await run(null, 1)
  i = await pic('jump-landed', { full: false })
  check(i.ground, 'landed')
  say('heard', await heard())
  /* jump with spray, both aims */
  await run('jump spray', 12)
  await pic('spray-jump', { full: false })
  await ev(() => window.__t.until('spray', (w) => w.player.vy > 60, 120))
  await pic('spray-fall', { full: false })
  await ev(() => window.__t.until(null, (w) => w.player.onGround, 120))
  await run('jump spray up', 12)
  await pic('spray-up-jump', { full: false })
  await ev(() => window.__t.until('spray up', (w) => w.player.vy > 60, 120))
  await pic('spray-up-fall', { full: false })
  await ev(() => window.__t.until(null, (w) => w.player.onGround, 200))
  await run(null, 10)
  await heard()

  /* 4. every block type, bumped from below */
  const blocks = [
    [26, 'B'],
    [28, 'C'],
    [30, '?'],
    [32, '!'],
    [34, 'W'],
    [36, 'L'],
    [38, 'H'],
    [40, 'h'],
    [42, 'U'],
    [44, 'X'],
  ]
  for (const [col, ch] of blocks) {
    await place(col + 0.5, 320, 1)
    await run(null, 4)
    const before = await ev((c) => window.__t.tile(c, 6), col)
    const t = await ev(() => window.__t.until('jump', (w) => w.player.hitCeil, 60))
    await run('jump', 2)
    const after = await ev((c) => window.__t.tile(c, 6), col)
    const bumps = await ev(() => window.__maxx.world().bumps.length)
    const name = { '?': 'prize', '!': 'power' }[ch] ?? ch
    await pic('block-' + name, { full: ch === '?' || ch === 'W', w: 128, h: 176, scale: 4 })
    const h = await heard()
    say(`block ${ch} at col ${col}: before '${before}' after '${after}', hit after ${t} ticks, bumps ${bumps}, heard`, h)
    check(before === ch && t > 0, `block ${ch} was there and Maxx hit it`)
    await ev(() => window.__t.until(null, (w) => w.player.onGround, 120))
    if (ch === 'C') {
      // A coin brick pays out more than once.
      await ev(() => window.__t.until('jump', (w) => w.player.hitCeil, 60))
      await ev(() => window.__t.until(null, (w) => w.player.onGround, 120))
      say('block C second bump heard', await heard())
    }
    await run(null, 30)
    if (ch === 'W' || ch === 'L') await pic('block-' + name + '-prize-out', { zoom: true, full: false, w: 176, h: 176, scale: 4 })
  }
  await run(null, 30)
  await pic('blocks-after')
  say('prizes about', await ev(() => window.__t.ents().filter((e) => ['turbo', 'wax', 'oneup', 'bubble'].includes(e.kind))))
  say('heard', await heard())

  /* 5. wash a car */
  await place(57, 320, 1)
  await run(null, 30)
  let cars = await ev(() => window.__t.ents('car'))
  say('cars', cars)
  i = await pic('car-dirty')
  const washT = await ev(() => window.__t.until('spray', (w) => w.entities.some((e) => e.kind === 'car' && e.variant === 'compact' && e.state === 'clean'), 400))
  i = await pic('car-washed')
  check(washT > 0, 'the compact is washed by the spray (' + washT + ' ticks)')
  await run(null, 20)
  let h = await heard()
  say('heard while washing', h)
  check(h['sfx:carClean'] === 1 && h['sfx:honk'] >= 1 && h['sfx:sprayHit'] > 0, 'washing plays sprayHit, carClean and honk')
  await pic('car-washed-later', { zoom: false })

  /* 6. ride it */
  await ev(() =>
    window.__t.until(
      null,
      (w) => {
        const car = w.entities.find((e) => e.kind === 'car' && e.variant === 'compact')
        return !car || car.x < w.player.x + 34
      },
      400,
    ),
  )
  const rideT = await ev(() =>
    window.__t.until(
      'jump',
      (w) => {
        const car = w.entities.find((e) => e.kind === 'car' && e.variant === 'compact')
        return !car || w.player.ridingId === car.id
      },
      200,
    ),
  )
  i = await pic('car-ride')
  const x0 = i.x
  check(rideT > 0 && i.riding !== 0, 'Maxx lands on the washed car and rides it')
  await run(null, 40)
  i = await pic('car-ride-later')
  check(i.riding !== 0 && i.x !== x0, 'the car carries him (' + (i.x - x0).toFixed(1) + ' px in 40 ticks)')
  await run('right', 30)
  await ev(() => window.__t.until(null, (w) => w.player.onGround && w.player.ridingId === 0, 200))
  await heard()

  /* 7. take a hit from the sedan */
  await place(71, 320, 1)
  const hitT = await ev(() => window.__t.until(null, (w) => w.player.state === 'hurt', 600))
  await run(null, 1)
  await ev(() => window.__t.until(null, (w) => (w.tick >> 1) % 2 === 1, 4))
  i = await pic('hurt')
  check(hitT > 0 && i.pips === 2, 'the dirty sedan costs one pip')
  check(/^maxx\/hurt\d$/.test(i.frame ?? ''), 'hurt frame (' + i.frame + ')')
  h = await heard()
  say('heard on the hit', h, 'rumbles', await ev(() => window.__rec.rumble.slice(-2)))
  check(h['sfx:hurt'] === 1, 'hurt sound')
  await run(null, 4)
  await ev(() => window.__t.until(null, (w) => (w.tick >> 1) % 2 === 1, 4))
  await pic('hurt-b', { full: false })
  await run('left', 25)
  i = await pic('blinking', { full: false })
  await run('left', 1)
  await pic('blinking-b', { full: false })
  await run('left', 80)
  await run(null, 20)
  i = await pic('after-hit', { full: false })
  check(i.invuln === 0 && i.state === 'normal', 'back to normal after the blinking')

  /* the bubble heals */
  await place(83.2, 320, 1)
  const healT = await ev(() => window.__t.until('right', (w) => w.player.pips === 3, 120))
  check(healT > 0, 'the bubble gives the pip back')
  say('heard', await heard())

  /* 8. the pipe, there and back */
  await place(181, 256, 1)
  await run(null, 6)
  i = await pic('pipe-on-top')
  check(i.ground && i.y === 204, 'stands on the pipe')
  await run('down', 1)
  i = await info()
  check(i.state === 'warp', 'down on the pipe starts the trip')
  await run('down', 14)
  i = await pic('pipe-going-in', { w: 128, h: 144, scale: 5 })
  // Half way into the pipe: where his boots would be there must be pipe, not Maxx.
  const inPipe = await ev(() => {
    const w = window.__maxx.world()
    const p = w.player
    const cx = Math.round(p.x) + 11 - Math.round(w.camera.x)
    const fy = Math.round(p.y) + 52 - Math.round(w.camera.y)
    const seen = new Set()
    for (let dx = -8; dx <= 8; dx += 2) for (let dy = -10; dy <= -3; dy++) seen.add(window.__t.pixel(cx + dx, fy + dy))
    return [...seen]
  })
  say('pixels where his boots are while in the pipe', inPipe)
  check(inPipe.every((c) => ['#6fb3dd', '#1e0d06', '#f7f4f8', '#ffe866'].includes(c)), 'in the pipe he is drawn behind the pipe tiles')
  let arrived = await ev(() => window.__t.until('down', (w) => w.area.id === 'bonus', 200))
  await run('down', 8)
  i = await pic('pipe-coming-out', { w: 128, h: 144, scale: 5 })
  check(arrived > 0 && i.area === 'bonus', 'arrives in the bonus area')
  await ev(() => window.__t.until('down', (w) => !w.warp, 200))
  await run('down', 30)
  i = await pic('bonus-arrived')
  check(i.area === 'bonus' && i.state === 'normal', 'a held down does not send him straight back')
  h = await heard()
  say('heard through the pipe', h)
  check(h['sfx:pipe'] === 2 && h['music:bonus'] === 1, 'pipe sound both ends and the area song is asked for')
  await run('right', 60)
  await pic('bonus-walk')
  await place(21, 576, 1)
  await run(null, 30)
  await pic('bonus-far-pipe', { zoom: false })
  await run('down', 12)
  await pic('bonus-pipe-going-in', { full: false, w: 128, h: 144, scale: 5 })
  arrived = await ev(() => window.__t.until('down', (w) => w.area.id === 'main', 200))
  await run(null, 10)
  await pic('main-pipe-coming-out', { w: 128, h: 144, scale: 5 })
  await ev(() => window.__t.until(null, (w) => !w.warp, 200))
  await run(null, 5)
  await ev(() => window.__t.until(null, (w) => (w.tick >> 1) % 2 === 1, 4))
  i = await pic('main-back')
  check(arrived > 0 && i.area === 'main' && i.y === 204 && Math.abs(i.x + 11 - 5792) < 1, 'back on top of the main pipe')
  h = await heard()
  check(h['music:sunny'] === 1, 'the level song is asked for again')

  /* the door, there and back */
  await place(186.5, 320, 1)
  await run(null, 40)
  await pic('door-front', { full: false })
  await run('up', 1)
  await run(null, 6)
  await pic('door-going', { full: false })
  arrived = await ev(() => window.__t.until(null, (w) => w.area.id === 'bonus' && !w.warp, 200))
  await run(null, 5)
  i = await pic('door-bonus')
  check(arrived > 0 && i.area === 'bonus', 'the door leads to the bonus area')
  await run('up', 1)
  arrived = await ev(() => window.__t.until(null, (w) => w.area.id === 'main' && !w.warp, 200))
  await run(null, 5)
  i = await pic('door-back')
  check(arrived > 0 && i.area === 'main', 'and back')
  say('heard through the door', await heard())

  /* 9. hover */
  await place(176, 320, 1)
  await run(null, 5)
  await run('jump right', 24)
  await ev(() => window.__t.until('right', (w) => w.player.vy > 0, 60))
  await run('down spray right', 12)
  i = await pic('hover')
  check(i.hovering && i.aim === 'down' && i.vy <= 41, 'hovering on the gun, falling at 40')
  check(/^maxx\/sprayDown\d$/.test(i.frame ?? ''), 'sprayDown frame (' + i.frame + ')')
  d = await ev(() => {
    const w = window.__maxx.world()
    const p = w.player
    const last = w.droplets[w.droplets.length - 1]
    return last ? { dx: +(last.x - (p.x + 11)).toFixed(2), dy: +(last.y - (p.y + 52)).toFixed(2) } : null
  })
  say('newest hover droplet from the anchor', d)
  await run('down spray right', 3)
  await pic('hover-b', { full: false })
  await ev(() => window.__t.until('down spray', (w) => w.player.onGround, 300))
  await run(null, 10)
  say('heard', await heard())

  /* lift and spring */
  let lift = await ev(() => window.__t.ents('lift').sort((a, b) => a.x - b.x)[0])
  await ev((l) => window.__t.place((l.x + l.w / 2) / 32, l.y, 1), lift)
  await run(null, 3)
  i = await info()
  const lx = i.x
  await run(null, 45)
  i = await pic('lift-ride')
  check(i.riding === lift.id && i.x !== lx, 'rides the lift over the sludge (' + (i.x - lx).toFixed(1) + ' px)')
  await place(222, 320, 1)
  await run(null, 60)
  await place(225.5, 250, 1)
  const sp = await ev(() => window.__t.until(null, (w) => w.player.vy < -600, 120))
  await run(null, 20)
  i = await pic('spring')
  h = await heard()
  check(sp > 0 && h['sfx:spring'] === 1, 'the spring throws him')

  /* pickups on the catwalk: turbo, wax, 1UP */
  await place(219, 96, 1)
  const lives0 = (await info()).lives
  await ev(() => window.__t.until('right', (w) => w.player.x > 227 * 32, 200))
  i = await pic('pickups')
  h = await heard()
  say('heard on the catwalk', h)
  check(i.turbo && i.wax > 0 && i.lives === lives0 + 1, 'turbo, wax and a life')
  check(h['sfx:powerup'] === 1 && h['sfx:waxStart'] === 1 && h['sfx:oneUp'] === 1 && h['music:wax'] === 1, 'their sounds, and the wax song is asked for')
  await run('spray', 10)
  await pic('turbo-spray', { full: false })
  await run(null, 30)

  /* token and a pickup car with wax on: washes on touch */
  await place(246, 320, 1)
  await ev(() => window.__t.until('right', (w) => w.entities.some((e) => e.kind === 'car' && e.variant === 'pickup' && e.state === 'clean'), 300))
  await pic('wax-washes-pickup')
  say('heard', await heard())
  await ev(() => window.__t.until(null, (w) => w.player.wax === 0, 700))
  h = await heard()
  check(h['music:sunny'] === 1, 'the level song comes back when the wax runs out')

  /* a checkpoint */
  await place(380.5, 320, 1)
  await ev(() => window.__t.until('right', (w) => w.checkpoint !== null, 100))
  h = await heard()
  check(h['sfx:checkpoint'] === 1, 'checkpoint')
  await pic('checkpoint', { zoom: false })

  /* grimed in the sludge */
  await place(148.5, 320, 1)
  await run(null, 20)
  const livesBefore = (await info()).lives
  const gr = await ev(() => window.__t.until('right', (w) => w.status === 'grimed', 200))
  await run(null, 4)
  i = await pic('grimed-0')
  check(gr > 0 && i.state === 'grimed', 'sludge grimes him')
  check(/^maxx\/grimed0$/.test(i.frame ?? ''), 'grimed starts on its first frame (' + i.frame + ')')
  for (const [k, ticks] of [
    [1, 12],
    [2, 9],
    [3, 9],
    [4, 8],
    [5, 30],
  ]) {
    await run(null, ticks)
    i = await pic('grimed-' + k, { full: k === 5 })
    check(i.frame === 'maxx/grimed' + Math.min(4, k), 'grimed plays once and holds its last frame (' + i.frame + ')')
  }
  h = await heard()
  say('heard on the grime', h, 'rumble', await ev(() => window.__rec.rumble.slice(-1)))
  check(h['jingle:grimed'] === 1, 'grimed jingle')
  await ev(() => window.__t.until(null, (w) => w.status === 'play', 300))
  i = await pic('restarted')
  check(i.lives === livesBefore - 1 && i.pips === 3 && i.x === 69, 'restart: one life fewer, full shine, at the start')
  say('heard at the restart', await heard())

  /* a hit down to grimed by a car: lying on the ground, not in sludge */
  await place(71, 320, 1)
  await ev(() => {
    const w = window.__maxx.world()
    w.player.pips = 1
  })
  await ev(() => window.__t.until(null, (w) => w.status === 'grimed', 600))
  await run(null, 60)
  await pic('grimed-on-ground')
  await ev(() => window.__t.until(null, (w) => w.status === 'play', 300))
  await heard()

  /* a pickup flings mud */
  await place(238, 320, 1)
  const thrown = await ev(() => window.__t.until(null, (w) => w.entities.some((e) => e.kind === 'clod'), 400))
  await run(null, 12)
  await pic('clod', { zoom: false })
  // Step out from under it, so it lands on the road.
  await ev(() => window.__t.until('left', (w) => !w.entities.some((e) => e.kind === 'clod'), 200))
  h = await heard()
  say('heard from the pickup', h)
  check(thrown > 0 && h['sfx:mudThrow'] >= 1 && h['sfx:splat'] >= 1, 'the pickup throws a clod and it splats')

  /* a sports car revs, then comes fast */
  await place(255, 320, 1)
  await ev(() => window.__t.until(null, (w) => w.entities.some((e) => e.kind === 'car' && e.variant === 'sports' && e.active), 100))
  await run(null, 10)
  await pic('sports-rev', { zoom: false })
  // Pretend it is the last dirty car of the level, to see the SPOTLESS banner come through.
  await ev(() => {
    const w = window.__maxx.world()
    w.stats.carsWashed = w.stats.carsTotal - 1
  })
  const sportsT = await ev(() => window.__t.until('spray', (w) => w.entities.some((e) => e.kind === 'car' && e.variant === 'sports' && e.state === 'clean') || w.player.state === 'hurt', 300))
  await run(null, 6)
  i = await pic('sports-washed', { zoom: false })
  const lastEvents = await ev(() => Array.from(window.__maxx.sceneObject().events).slice(-8))
  check(lastEvents.includes('banner SPOTLESS!'), 'the SPOTLESS banner reaches the scene')
  h = await heard()
  say('heard from the sports car', h)
  check(sportsT > 0 && h['sfx:rev'] === 1 && h['sfx:carClean'] === 1, 'the sports car revs, comes, and is washed in time')

  /* the secret: grime blocks, the token, the secret exit */
  await place(160, 320, 1)
  await run(null, 10)
  let g = await ev(() => window.__t.until('spray', () => window.__t.tile(162, 9) === ' ', 300))
  check(g > 0, 'the lower grime block washes away (' + g + ' ticks)')
  await ev(() => window.__t.until('right', (w) => w.player.hitWall === 1 || w.player.x > 164 * 32, 100))
  g = await ev(() => window.__t.until('spray up', () => window.__t.tile(162, 8) === ' ', 300))
  await pic('grime-blocks')
  check(g > 0, 'the upper grime block washes away (' + g + ' ticks)')
  h = await heard()
  check(h['sfx:crumble'] === 2, 'two crumbles')
  await ev(() => window.__t.until('right', (w) => w.stats.tokens.some(Boolean) || w.status !== 'play', 200))
  h = await heard()
  check(h['sfx:token'] === 1, 'the token')
  const sec = await ev(() => window.__t.until('right', (w) => w.status === 'clear', 200))
  await run(null, 30)
  i = await pic('secret-exit')
  h = await heard()
  say('heard at the secret exit', h)
  check(sec > 0 && h['jingle:secret'] === 1, 'secret exit: clear with the secret jingle')
  await ev(() => window.__t.until(null, (w) => w.status === 'play', 300))
  await heard()

  /* 10. the goal */
  await place(390, 320, 1)
  await run(null, 10)
  await pic('goal-approach', { zoom: false })
  const cl = await ev(() => window.__t.until('right', (w) => w.status === 'clear', 300))
  await run(null, 10)
  i = await pic('goal-walk')
  check(cl > 0 && i.status === 'clear', 'the goal clears the level')
  check(/^maxx\/run\d+$/.test(i.frame ?? ''), 'the victory walk is a run (' + i.frame + ')')
  await run(null, 80)
  i = await pic('goal-win-0')
  check(/^maxx\/win\d$/.test(i.frame ?? ''), 'then the win pose (' + i.frame + ')')
  await run(null, 10)
  await pic('goal-win-1', { full: false })
  await run(null, 8)
  await pic('goal-win-2', { full: false })
  h = await heard()
  check(h['jingle:clear'] === 1, 'clear jingle')
  await ev(() => window.__t.until(null, (w) => w.status === 'play', 300))

  /* the clock: the warning at 30 seconds, then time up */
  await place(4.5, 320, 1)
  await ev(() => {
    window.__maxx.world().timeLeft = 30 * 60 + 20
  })
  await run(null, 30)
  h = await heard()
  check(h['sfx:timeWarn'] === 1, 'time warning at 30 seconds')
  const livesT = (await info()).lives
  await ev(() => {
    window.__maxx.world().timeLeft = 20
  })
  await run(null, 60)
  i = await pic('time-up')
  h = await heard()
  check(i.status === 'timeup' && h['jingle:grimed'] === 1, 'time up ends the attempt')
  await ev(() => window.__t.until(null, (w) => w.status === 'play', 300))
  check((await info()).lives === livesT - 1, 'and costs a life')
  await heard()

  /* a sign */
  await place(4.5, 320, 1)
  await run(null, 30)
  await run('right', 6)
  await run(null, 30)
  await pic('sign', { zoom: false })
  say('sign', await ev(() => window.__t.ents('sign')[0]))

  /* pause */
  await heard()
  await ev(() => window.__maxx.tap('pause'))
  const tick0 = (await info()).tick
  await run(null, 30)
  i = await pic('paused', { zoom: false })
  h = await heard()
  say('heard on pause', h)
  check(i.tick === tick0 && h['setPaused:true'] === 1 && h['sfx:pause'] === 1, 'pause stops the world, holds the audio, plays the pause sound')
  await ev(() => window.__maxx.tap('pause'))
  await run(null, 5)
  i = await info()
  h = await heard()
  check(i.tick > tick0 && h['setPaused:false'] === 1 && h['sfx:unpause'] === 1, 'and resumes')

  const all = await ev(() => window.__rec.audio)
  const kinds = [...new Set(all)].sort()
    // Every frame the scene picked exists in the atlas, and every body animation was shown at some point.
  const cover = await ev(async () => {
    const m = window.__maxx
    const seen = Object.keys(window.__rec.frames)
    const atlas = m.ctx.sprites.atlas('maxx')
    const missing = seen.filter((f) => !m.ctx.sprites.has(f))
    const anims = Object.keys(atlas.anims).filter((a) => !a.startsWith('map'))
    const unseen = anims.filter((a) => !atlas.anims[a].some((f) => seen.includes('maxx/' + f)))
    const framesUnseen = anims.flatMap((a) => atlas.anims[a]).filter((f, k, all) => all.indexOf(f) === k && !seen.includes('maxx/' + f))
    return { shown: seen.length, missing, anims: anims.length, unseen, framesUnseen }
  })
  say('frames', cover)
  check(cover.missing.length === 0, 'every frame name the scene asked for is in the atlas')
  check(cover.unseen.length === 0, 'every body animation of the atlas was shown ' + JSON.stringify(cover.unseen))
  say('every audio call the scene made:', kinds.join(' '))
  say('rumble calls:', await ev(() => window.__rec.rumble.length))
  const errors = await ev(() => Array.from(window.__maxx.errors))
  check(errors.length === 0, 'no scene errors ' + JSON.stringify(errors))
  const bad = logs.filter((l) => /^(warn|error|warning)/.test(l))
  check(bad.length === 0, 'no console warnings or errors ' + JSON.stringify(bad))
  say('console:', logs)
  say(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'ALL CHECKS PASSED')
  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(problems.length + ' checks failed')
}
