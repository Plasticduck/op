// Sound in the real page, in real time: unlock on the first key, the title song, effects
// from simulation events, the spray loop, pause holding the music, leaving the window.
//   node scripts/maxx/shot.mjs --q "scene=title&fresh=1" --w 1280 --h 830 --script scripts/maxx/checks/audio.mjs --out <folder>/end.png
// Pictures and report.txt land in <folder>. Exit code 1 if any check fails. All of them: node scripts/maxx/check.mjs
// Runs in real time (no manual=1) and takes about 25 seconds.
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { install } from './lib.mjs'


export default async ({ page, settle, shot, maxx, outDir }) => {
  const OUT = outDir
  mkdirSync(OUT, { recursive: true })
  await install(maxx, { manual: false })
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
  const dbg = () =>
    ev(() => {
      const a = window.__maxx.ctx.audio
      const d = a.debug()
      return { state: d.state, rate: d.sampleRate, want: d.want, song: d.song, jingle: d.jingle, paused: d.paused, spray: d.spray, voices: d.voices, sfxReady: d.sfxReady, clips: d.clips, queued: d.queued, worst: +d.worstSliceMs.toFixed(1), locked: a.locked }
    })
  /** The loudest the bus gets over `ms` milliseconds. */
  const loudest = (at, ms) =>
    ev(
      (at, ms) =>
        new Promise((resolve) => {
          const a = window.__maxx.ctx.audio
          let rms = 0
          let peak = 0
          const t0 = performance.now()
          const tick = () => {
            const m = a.meter(at)
            rms = Math.max(rms, m.rms)
            peak = Math.max(peak, m.peak)
            if (performance.now() - t0 < ms) requestAnimationFrame(tick)
            else resolve({ rms: +rms.toFixed(4), peak: +peak.toFixed(4) })
          }
          tick()
        }),
      at,
      ms,
    )

  /* before any input */
  await settle(400)
  let d = await dbg()
  say('before any input', d)
  // shot.mjs has already run script in the page, which Chrome counts as a gesture: the true first-input case is checks/unlock.mjs.
  check(d.want === 'title', 'the title song is already asked for')

  /* the first key press unlocks (K is jump only, so the title stays up) */
  await page.keyboard.press('KeyK')
  await settle(1200)
  d = await dbg()
  say('after the first key', d)
  check(d.state === 'running' && !d.locked, 'AudioContext running after the first key press')
  check(d.song && d.song.id === 'title', 'the title song is playing')
  // How many there should be against the contract is checks/seams.mjs's business.
  const ids = await ev(async () => (await window.__t.mod('audio/sfx.ts')).SFX_IDS.slice())
  check(ids.length >= 42 && d.sfxReady === ids.length, 'all ' + ids.length + ' effects are rendered (' + d.sfxReady + ')')
  let m = await loudest('music', 600)
  say('title music level', m)
  check(m.rms > 0.01, 'the title song is sounding on the music bus')
  const p0 = d.song ? d.song.pos : 0
  await settle(1000)
  d = await dbg()
  check(d.song && d.song.pos > p0 + 0.8, 'and its position moves on (' + p0.toFixed(2) + ' -> ' + (d.song ? d.song.pos.toFixed(2) : '?') + ')')
  const status = await ev(() => window.__maxx.status())
  check(status.audioLocked === false && status.scene === 'title', 'the page status agrees: sound unlocked')
  await shot('01-title.png')

  /* into the sandbox: the level song, and effects from simulation events */
  await ev(() => window.__maxx.go('sandbox'))
  await settle(1500)
  d = await dbg()
  say('in the sandbox', d)
  check(d.song && d.song.id === 'sunny', 'the level song took over')
  const calls = await ev(() => {
    const a = window.__maxx.ctx.audio
    const rec = (window.__calls = [])
    const f = a.sfx.bind(a)
    a.sfx = (id) => {
      rec.push(id)
      return f(id)
    }
    return true
  })
  check(calls, 'recording sfx calls')
  // Run right and jump with real keys: jump, land and two coins come from the simulation.
  await page.keyboard.down('ArrowRight')
  await settle(1500)
  await page.keyboard.down('KeyZ')
  const sfxLevel = loudest('sfx', 900)
  await settle(250)
  await page.keyboard.up('KeyZ')
  m = await sfxLevel
  await settle(900)
  await page.keyboard.up('ArrowRight')
  const heard = await ev(() => window.__calls.slice())
  say('effects asked for by the scene', heard, 'loudest on the effects bus', m)
  check(heard.includes('jump') && heard.includes('coin') && heard.includes('land'), 'jump, coin and land came from simulation events')
  check(m.peak > 0.005, 'and they sounded on the effects bus')

  /* the spray loop */
  await page.keyboard.down('KeyX')
  await settle(400)
  d = await dbg()
  m = await loudest('sfx', 300)
  check(d.spray === true && m.rms > 0.005, 'holding spray runs the hiss (' + m.rms + ')')
  await page.keyboard.up('KeyX')
  await settle(400)
  d = await dbg()
  check(d.spray === false, 'letting go stops it')

  /* pause holds the music */
  await settle(300)
  d = await dbg()
  const before = d.song.pos
  const tPause = Date.now()
  await page.keyboard.press('KeyP')
  await settle(500)
  d = await dbg()
  m = await loudest('music', 400)
  await settle(1600)
  const d2 = await dbg()
  say('paused', { before, paused: d2.paused, song: d2.song, music: m })
  check(d.paused === true && d2.paused === true, 'pausing the game pauses the audio')
  check(m.rms < 0.002, 'and the music bus is silent (' + m.rms + ')')
  await shot('02-paused.png')
  const pausedFor = (Date.now() - tPause) / 1000
  await page.keyboard.press('KeyP')
  await settle(700)
  d = await dbg()
  m = await loudest('music', 400)
  say('unpaused', { before, now: d.song && d.song.pos, pausedFor })
  // Had the song run on behind the pause it would be more than pausedFor seconds further along.
  check(d.paused === false && d.song && d.song.pos > before + 0.3 && d.song.pos < before + 1.6 && pausedFor > 2.4, 'unpausing carries on from where it stopped (' + before.toFixed(2) + ' -> ' + (d.song ? d.song.pos.toFixed(2) : '?') + ' after ' + pausedFor.toFixed(1) + ' s paused)')
  check(m.rms > 0.01, 'and the music is back')

  /* leaving the window: the shell pauses the game and the sound */
  await ev(() => window.dispatchEvent(new Event('blur')))
  await settle(500)
  d = await dbg()
  const paused1 = await ev(() => {
    const w = window.__maxx.world()
    const t = w.tick
    return new Promise((r) => setTimeout(() => r(window.__maxx.world().tick === t), 300))
  })
  check(d.paused === true && paused1, 'window blur: audio held and the game paused itself')
  await ev(() => window.dispatchEvent(new Event('focus')))
  await settle(400)
  d = await dbg()
  check(d.paused === true, 'coming back does not unpause a paused game (the player does)')
  await page.keyboard.press('KeyP')
  await settle(500)
  d = await dbg()
  check(d.paused === false, 'P resumes')

  /* mute */
  await page.keyboard.press('KeyM')
  await settle(400)
  m = await loudest('out', 400)
  const muted = await ev(() => window.__maxx.status().muted)
  check(muted && m.rms < 0.002, 'M mutes (' + m.rms + ')')
  await page.keyboard.press('KeyM')
  await settle(400)
  m = await loudest('out', 400)
  check(!(await ev(() => window.__maxx.status().muted)) && m.rms > 0.005, 'M again brings the sound back (' + m.rms + ')')

  /* every effect id plays */
  const silent = []
  for (const id of ids) {
    await ev((id) => window.__maxx.ctx.audio.sfx(id), id)
    const v = await ev(() => window.__maxx.ctx.audio.debug().voices)
    if (v < 1) silent.push(id)
    await settle(60)
  }
  say('effect ids', ids.length, 'that started no voice:', silent)
  check(silent.length === 0, 'each of the ' + ids.length + ' effect ids starts a voice')

  /* a jingle silences the song and gives it back */
  await settle(800)
  const done = ev(
    () =>
      new Promise((resolve) => {
        const t0 = performance.now()
        window.__maxx.ctx.audio.jingle('clear', { onDone: () => resolve(Math.round(performance.now() - t0)) })
      }),
  )
  await settle(700)
  d = await dbg()
  check(d.jingle === 'clear', 'the clear jingle is playing')
  const ms = await done
  await settle(500)
  d = await dbg()
  m = await loudest('music', 300)
  check(ms > 4000 && ms < 5200 && d.jingle === null && d.song && d.song.id === 'sunny' && m.rms > 0.01, 'its onDone comes after ' + ms + ' ms and the level song is back')

  d = await dbg()
  say('at the end', d)
  check(d.worst < 12, 'longest render slice ' + d.worst + ' ms')
  const errors = await ev(() => Array.from(window.__maxx.errors))
  check(errors.length === 0, 'no scene errors ' + JSON.stringify(errors))
  const bad = logs.filter((l) => /^(warn|error|warning)/.test(l))
  check(bad.length === 0, 'no console warnings or errors ' + JSON.stringify(bad))
  say('console:', logs)
  say(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'ALL CHECKS PASSED')
  writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n')
  if (problems.length) throw new Error(problems.length + ' checks failed')
}
