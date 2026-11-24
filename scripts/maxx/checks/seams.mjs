// The seams between modules, measured in the running page:
//   glyph ids input.ts hands out vs what text.ts draws, on each device;
//   the animation names the sandbox scene asks for vs maxx.atlas.ts;
//   anchors, feet and the nozzle through the engine's own Sprites.draw, both facings;
//   the contract's SfxIds vs the effects in audio/sfx.ts.
//   node scripts/maxx/shot.mjs --q "scene=sandbox&manual=1&fresh=1" --w 1280 --h 830 --script scripts/maxx/checks/seams.mjs --out <folder>/end.png
// Pictures and report.txt land in <folder>. Exit code 1 if any check fails. All of them: node scripts/maxx/check.mjs
import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { GAME_DIR } from '../paths.mjs'
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

  /* ---------------- glyphs ---------------- */
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
    window.__plugged = false
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => (window.__plugged ? [pad, null, null, null] : [null, null, null, null]) })
  })
  const glyphCheck = () =>
    ev(async () => {
      const T = await window.__t.mod('engine/text.ts')
      const input = window.__maxx.ctx.input
      const actions = ['move', 'left', 'right', 'up', 'down', 'jump', 'spray', 'confirm', 'cancel', 'pause', 'select']
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 24
      const g = c.getContext('2d', { willReadFrequently: true })
      const ink = (text) => {
        g.clearRect(0, 0, 64, 24)
        T.drawText(g, text, 4, 6, { color: '#f7f4f8' })
        const d = g.getImageData(0, 0, 64, 24).data
        let n = 0
        let h = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3]) {
            n++
            h = (h * 31 + d[i] * 7 + d[i + 1] * 3 + d[i + 2] + i) >>> 0
          }
        }
        return { n, h }
      }
      const unknownPad = ink('{pad_zzzz}')
      const out = { device: input.device, rows: [], bad: [] }
      for (const a of actions) {
        const id = input.glyph(a)
        const known = T.GLYPH_IDS.includes(id)
        const byAction = ink('{' + a + '}')
        const byId = ink('{' + id + '}')
        const w = T.measureText('{' + a + '}')
        out.rows.push(a + '=' + id)
        if (!known) out.bad.push(a + ': ' + id + ' is not in text.ts GLYPH_IDS')
        if (byAction.n < 10 || byAction.h !== byId.h) out.bad.push(a + ': {' + a + '} does not draw the same as {' + id + '}')
        if (byAction.h === unknownPad.h) out.bad.push(a + ': draws as the unknown-glyph plate')
        if (!(w >= 7 && w <= 40)) out.bad.push(a + ': odd width ' + w)
      }
      return out
    })
  await ev(() => window.__t.run(null, 3))
  let gl = await glyphCheck()
  say('glyphs', gl.device, gl.rows.join(' '))
  check(gl.device === 'keyboard' && gl.bad.length === 0, 'keyboard: every prompt id is one text.ts knows and draws ' + JSON.stringify(gl.bad))
  await ev(() => {
    window.__plugged = true
    window.__pad.buttons[3] = { pressed: true, touched: true, value: 1 }
  })
  await ev(() => window.__t.run(null, 2))
  await ev(() => {
    window.__pad.buttons[3] = { pressed: false, touched: false, value: 0 }
  })
  await ev(() => window.__t.run(null, 2))
  gl = await glyphCheck()
  say('glyphs', gl.device, gl.rows.join(' '))
  check(gl.device === 'gamepad' && gl.bad.length === 0, 'gamepad (after pressing Y, a button with no action): every prompt id is known and draws ' + JSON.stringify(gl.bad))
  await ev(() => {
    window.__maxx.ctx.input.setTouch('cancel', true)
  })
  await ev(() => window.__t.run(null, 1))
  await ev(() => {
    window.__maxx.ctx.input.setTouch('cancel', false)
  })
  await ev(() => window.__t.run(null, 1))
  gl = await glyphCheck()
  say('glyphs', gl.device, gl.rows.join(' '))
  check(gl.device === 'touch' && gl.bad.length === 0, 'touch: every prompt id is known and draws ' + JSON.stringify(gl.bad))
  // A strip of every prompt on every device, to look at.
  save(
    'glyph-strip.png',
    await ev(async () => {
      const T = await window.__t.mod('engine/text.ts')
      const c = document.createElement('canvas')
      c.width = 520
      c.height = 150
      const g = c.getContext('2d')
      g.fillStyle = '#1b2253'
      g.fillRect(0, 0, c.width, c.height)
      const rows = {
        KEYBOARD: 'key_ARROWS key_LEFT key_RIGHT key_UP key_DOWN key_Z key_X key_ENTER key_ESC key_TAB',
        GAMEPAD: 'pad_dpad pad_dpad_left pad_dpad_right pad_dpad_up pad_dpad_down pad_a pad_x pad_b pad_start pad_back',
        TOUCH: 'touch_dpad touch_left touch_right touch_up touch_down touch_a touch_b touch_pause',
      }
      let y = 8
      for (const [name, ids] of Object.entries(rows)) {
        T.drawText(g, name, 6, y + 4, { color: '#ffe866', scale: 1 })
        T.drawText(g, ids.split(' ').map((i) => '{' + i + '}').join('  '), 80, y, { color: '#f7f4f8', scale: 2 })
        y += 28
      }
      T.drawText(g, 'IN A SENTENCE: {jump} JUMPS  {spray} SPRAYS  {pause} PAUSES  {move} MOVES', 6, y + 6, { color: '#f7f4f8' })
      T.drawText(g, 'HOLD {down} + {spray} IN THE AIR TO HOVER. PRESS {up} AT A DOOR.', 6, y + 24, { color: '#b9ecff' })
      const out = document.createElement('canvas')
      out.width = c.width * 3
      out.height = c.height * 3
      const o = out.getContext('2d')
      o.imageSmoothingEnabled = false
      o.drawImage(c, 0, 0, out.width, out.height)
      return out.toDataURL('image/png')
    }),
  )

  /* ---------------- animation names, anchors, feet, nozzle ---------------- */
  const art = await ev(async () => {
    const C = await window.__t.mod('contract.ts')
    const sprites = window.__maxx.ctx.sprites
    const atlas = sprites.atlas('maxx')
    const bad = []
    // Every name the sandbox scene's maxxAnim() can return.
    const asked = ['idle', 'run', 'jump', 'fall', 'skid', 'hurt', 'grimed', 'win', 'sprayRun', 'sprayIdle', 'sprayJump', 'sprayFall', 'sprayUpRun', 'sprayUpIdle', 'sprayUpJump', 'sprayUpFall', 'sprayDown']
    for (const a of asked) {
      const frames = sprites.anim('maxx', a)
      if (!frames.length) bad.push('no animation ' + a)
      for (const f of frames) if (!sprites.has(f)) bad.push('animation ' + a + ' names a missing frame ' + f)
    }
    const cell = atlas.meta.cell
    const body = asked.flatMap((a) => atlas.anims[a] ?? []).filter((f, i, all) => all.indexOf(f) === i)
    for (const f of [...body, 'grime1', 'grime2']) {
      const fr = atlas.frames[f]
      if (!fr) bad.push('missing frame ' + f)
      else if (fr.w !== cell.w || fr.h !== cell.h || fr.ax !== cell.ax || fr.ay !== cell.ay) bad.push(f + ' is not the uniform cell')
    }
    for (const [a, t] of Object.entries(atlas.meta.ticks)) if ((atlas.anims[a] ?? []).length !== t.length) bad.push('meta.ticks.' + a + ' has ' + t.length + ' entries for ' + (atlas.anims[a] ?? []).length + ' frames')
    if (atlas.meta.runStride !== 7) bad.push('runStride is ' + atlas.meta.runStride)

    // Draw through the engine, both ways, and measure.
    const W = 200
    const AX = 100
    const AY = 120
    const c = document.createElement('canvas')
    c.width = W
    c.height = 160
    const g = c.getContext('2d', { willReadFrequently: true })
    const TIP = new Set(['245,197,24', '255,232,102', '184,134,11'])
    const scan = (frame, flipX) => {
      g.clearRect(0, 0, W, 160)
      sprites.draw(g, frame, AX, AY, { flipX })
      const d = g.getImageData(0, 0, W, 160).data
      let lowest = -1
      const tip = []
      let minX = W
      let maxX = -1
      for (let y = 0; y < 160; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          if (!d[i + 3]) continue
          if (y > lowest) lowest = y
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (TIP.has(d[i] + ',' + d[i + 1] + ',' + d[i + 2])) tip.push([x, y])
        }
      }
      return { lowest, tip, minX, maxX }
    }
    const muzzleOf = (tip, aim, flipX) => {
      if (!tip.length) return null
      // Mirror a flipped picture back, so one rule measures both.
      const pts = tip.map(([x, y]) => [flipX ? 2 * AX - 1 - x : x, y])
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      if (aim === 'fwd') return { x: Math.max(...xs) + 1 - AX, y: (Math.min(...ys) + Math.max(...ys) + 1) / 2 - AY }
      if (aim === 'down') return { x: (Math.min(...xs) + Math.max(...xs) + 1) / 2 - AX, y: Math.max(...ys) + 1 - AY }
      const lead = Math.max(...pts.map((p) => p[0] - p[1]))
      const front = pts.filter((p) => p[0] - p[1] === lead)
      return { x: front.reduce((s, p) => s + p[0] + 1, 0) / front.length - AX, y: front.reduce((s, p) => s + p[1], 0) / front.length - AY }
    }
    let nozzles = 0
    const aims = { fwd: ['sprayRun', 'sprayIdle', 'sprayJump', 'sprayFall'], up: ['sprayUpRun', 'sprayUpIdle', 'sprayUpJump', 'sprayUpFall'], down: ['sprayDown'] }
    for (const [aim, anims] of Object.entries(aims)) {
      for (const a of anims) {
        for (const f of sprites.anim('maxx', a)) {
          for (const flipX of [false, true]) {
            const m = muzzleOf(scan(f, flipX).tip, aim, flipX)
            nozzles++
            if (!m || m.x !== C.MUZZLE[aim].x || m.y !== C.MUZZLE[aim].y) bad.push(f + (flipX ? ' flipped' : '') + ': nozzle at ' + JSON.stringify(m) + ', contract ' + JSON.stringify(C.MUZZLE[aim]))
          }
        }
      }
    }
    // Feet: the lowest pixel of each frame against meta.feet (0 = soles on the last row above the ground line).
    const feet = {}
    for (const a of ['idle', 'run', 'skid', 'jump', 'fall', 'hurt', 'win', 'grimed', 'sprayIdle', 'sprayRun', 'sprayUpIdle', 'sprayDown']) {
      const frames = sprites.anim('maxx', a)
      feet[a] = frames.map((f) => AY - 1 - scan(f, false).lowest)
      const want = atlas.meta.feet[a === 'sprayRun' ? 'run' : a]
      if (want && JSON.stringify(want) !== JSON.stringify(feet[a])) bad.push('feet of ' + a + ' are ' + JSON.stringify(feet[a]) + ', meta says ' + JSON.stringify(want))
      if (!want && (a === 'idle' || a === 'skid' || a.endsWith('Idle')) && feet[a].some((v) => v !== 0)) bad.push(a + ' does not stand on the ground line: ' + JSON.stringify(feet[a]))
    }
    // Flipping mirrors about the anchor line exactly.
    const r = scan('maxx/idle0', false)
    const l = scan('maxx/idle0', true)
    const mirror = r.minX - AX === AX - 1 - l.maxX && r.maxX - AX === AX - 1 - l.minX
    return { bad, nozzles, feet, mirror, bodyFrames: body.length, extent: { right: [r.minX - AX, r.maxX - AX], left: [l.minX - AX, l.maxX - AX] } }
  })
  say('art', { nozzles: art.nozzles, bodyFrames: art.bodyFrames, feet: art.feet, extent: art.extent })
  check(art.bad.length === 0, 'animations asked for exist, frames are the uniform cell, timings fit, ' + art.nozzles + ' nozzle measurements equal MUZZLE in both facings, feet match meta.feet ' + JSON.stringify(art.bad))
  check(art.mirror, 'flipX mirrors the frame exactly about the anchor line')

  /* ---------------- sound ids ---------------- */
  const sound = await ev(async () => {
    const S = await window.__t.mod('audio/sfx.ts')
    const L = await window.__t.mod('audio/library.ts')
    const lv = await window.__t.mod('levels/index.ts')
    const songs = Object.keys(L.SONGS)
    const wanted = new Set(['title', 'wax'])
    for (const level of [lv.sandboxLevel, ...lv.LEVELS, ...(lv.RIVALS ? [lv.RIVALS] : [])]) {
      wanted.add(level.music)
      for (const a of level.areas) if (a.music) wanted.add(a.music)
    }
    return { sfx: [...S.SFX_IDS], songs, problems: L.SONG_PROBLEMS, missing: [...wanted].filter((id) => !songs.includes(id)) }
  })
  // SfxId is a type only, so the contract's list is read from its source.
  const union = readFileSync(path.join(GAME_DIR, 'game', 'contract.ts'), 'utf8').match(/export type SfxId =([\s\S]*?)\r?\n\s*\r?\n/)
  const contractSfx = union ? [...union[1].replace(/\/\/.*$/gm, '').matchAll(/'(\w+)'/g)].map((m) => m[1]) : []
  const noSound = contractSfx.filter((id) => !sound.sfx.includes(id))
  const notInContract = sound.sfx.filter((id) => !contractSfx.includes(id))
  say('sound', { ...sound, sfx: sound.sfx.length, contractSfx: contractSfx.length })
  check(contractSfx.length >= 42 && noSound.length === 0 && notInContract.length === 0, `audio/sfx.ts has an effect for each of the contract's ${contractSfx.length} SfxIds and no other (${sound.sfx.length} effects; missing ${JSON.stringify(noSound)}, extra ${JSON.stringify(notInContract)})`)
  check(sound.problems.length === 0, 'the songs load with no problems ' + JSON.stringify(sound.problems))
  for (const j of ['clear', 'grimed', 'gameover', 'secret', 'versus', 'rivalDown', 'champion']) check(sound.songs.includes(j), 'jingle ' + j + ' exists')
  say('songs asked for by the title, the sandbox level and wax that are not written yet (silence for now):', sound.missing)

  const errors = await ev(() => Array.from(window.__maxx.errors))
  check(errors.length === 0, 'no scene errors ' + JSON.stringify(errors))
  const bad = logs.filter((l) => /^(warn|error|warning)/.test(l))
  check(bad.length === 0, 'no console warnings or errors ' + JSON.stringify(bad))
  say(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'ALL CHECKS PASSED')
  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(problems.length + ' checks failed')
}
