// The first input unlocks the sound: Chrome's normal autoplay rule is in force and nothing but
// one real key press counts as a gesture. The page is read through the DevTools protocol with
// userGesture off, because puppeteer's own evaluate counts as a gesture (which is why this is
// not a --script for shot.mjs: by the time one runs, the page has already been "touched").
//   node scripts/maxx/checks/unlock.mjs [--port 5311] [--out <folder>]
// Exit code 1 if a check fails. Not covered: a controller button as the very first input
// (headless Chrome has no controller).
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const port = opt('--port') ?? 5311
const out = opt('--out')

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(
  (p) => p && existsSync(p),
)
if (!CHROME) {
  console.error('Chrome not found. Set CHROME_PATH.')
  process.exit(1)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--autoplay-policy=document-user-activation-required', '--mute-audio', '--window-size=1280,830'],
})
let failed = 0
const check = (ok, what) => {
  console.log((ok ? '  ok    ' : '  FAIL  ') + what)
  if (!ok) failed++
}
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 830 })
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  const logs = []
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
  // As shot.mjs does: the dev server's update socket never opens, so a source file saved by
  // someone else mid-run does not reload the page under the check. A script added this way is
  // not a user gesture.
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    const Quiet = function (url, protocols) {
      const kind = Array.isArray(protocols) ? protocols[0] : protocols
      if (kind !== 'vite-hmr' && kind !== 'vite-ping') return new Real(url, protocols)
      return Object.assign(new EventTarget(), { url: String(url), readyState: 0, send() {}, close() {} })
    }
    Quiet.prototype = Real.prototype
    Object.assign(Quiet, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    window.WebSocket = Quiet
  })
  const quiet = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, userGesture: false, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const state = () =>
    quiet(
      `(() => { const m = window.__maxx; if (!m || !m.ready) return null; const d = m.ctx.audio.debug(); return { active: navigator.userActivation.hasBeenActive, locked: m.ctx.audio.locked, state: d.state, want: d.want, song: d.song && d.song.id, statusLocked: m.status().audioLocked, scene: m.scene() } })()`,
    )

  await page.goto(`http://localhost:${port}/dev/maxx.html?scene=title&fresh=1`, { waitUntil: 'load' })
  let s = null
  for (let i = 0; i < 100 && !s; i++) {
    await sleep(100)
    s = await state()
  }
  if (!s) throw new Error('the game never became ready (is the dev server running on port ' + port + '?)')
  await sleep(1500)
  s = await state()
  if (!s) throw new Error('the game was no longer ready 1.5 s after it first was: the page reloaded or the game restarted')
  console.log('before any input', JSON.stringify(s))
  check(s.active === false, 'the page has had no gesture')
  check(s.locked === true && s.state === 'none', 'no AudioContext exists and the game reports sound locked')
  check(s.want === 'title' && s.statusLocked === true, 'the title song is waiting, and the page status says locked')
  if (out) {
    mkdirSync(out, { recursive: true })
    await page.screenshot({ path: path.join(out, 'title-locked.png') })
  }

  // One real key press. K is jump only, so the title screen stays where it is.
  await page.keyboard.press('KeyK')
  let ran = false
  let ms = 0
  const t0 = Date.now()
  for (let i = 0; i < 60 && !ran; i++) {
    await sleep(50)
    s = await state()
    ran = s.state === 'running' && s.song === 'title'
    ms = Date.now() - t0
  }
  console.log('after one key press', JSON.stringify(s), ms + ' ms')
  check(s.active === true && s.state === 'running' && s.locked === false, 'one key press: AudioContext running, sound unlocked')
  check(s.song === 'title' && s.scene === 'title', 'the waiting title song started (within ' + ms + ' ms)')
  await sleep(300)
  s = await state()
  check(s.statusLocked === false, 'the page status follows')
  const bad = logs.filter((l) => /^(warn|error|warning|pageerror)/.test(l))
  check(bad.length === 0, 'no console warnings or errors ' + JSON.stringify(bad))
} catch (e) {
  failed++
  console.log('[unlock failed] ' + (e?.message ?? e))
} finally {
  await browser.close()
}
console.log(failed ? failed + ' FAILED' : 'ALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
