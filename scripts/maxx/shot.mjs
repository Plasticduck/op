// Screenshots and drives the game's dev page (dev/maxx.html) in headless Chrome, with no
// sign-in. With a dev server of its own, stopped when it is done:
//   node scripts/maxx/serve.mjs --port 5311 -- node scripts/maxx/shot.mjs --port 5311 --out shot.png ...
// in full:
//   node scripts/maxx/shot.mjs --out shot.png [--q "scene=sandbox&manual=1"] [--w 1280] [--h 720]
//     [--dpr 1] [--touch] [--wait 300] [--eval "window.__maxx.step(60)"] [--script steps.mjs]
//     [--native [playfield|screen]] [--zoom 3]
//
// --q       query string for the dev page (see src/features/it/maxx/game/dev/harness.tsx); --url for a whole URL
// --port    the dev server's port (default 5311); --base for another page altogether
// --touch   a touch screen (phone): on-screen buttons show
// --eval    JavaScript run in the page once the game is ready, before the picture
// --script  a module exporting default async ({ page, shot, native, settle, maxx, outDir }) => {}
//           for multi-step checks. shot('name.png') saves a picture next to --out (outDir is
//           that folder); native('name.png', { what, zoom }) saves the game's own 640x360
//           picture (as --native below) whatever the flags; settle(ms) waits; maxx(fn, ...args)
//           runs fn(window.__maxx, ...args) in the page, e.g.
//             await maxx((m) => { m.setManual(true); m.hold('right'); m.step(30); m.release() })
//           Throw from the script to fail the run. scripts/maxx/checks/ holds the ready-made ones.
// --native  every picture (--out and shot()) at the game's own 640x360 pixels, for art review,
//           instead of the browser window:
//             playfield (the default)  the scene's world renderer drawn into a canvas of its own:
//                       the level and nothing on top (no HUD, menu, grid or transition), at the
//                       camera as it is now, even one a script moved without stepping. Only a
//                       scene that exposes `renderer` has one (the viewer); any other gives screen
//             screen    the whole picture as the game last drew it, read back at 1x
// --zoom    with --native: n times larger, hard-edged (default 1)
// --wait    milliseconds to let the page settle before the picture (default 300)
// --verbose print every console message, not only warnings and errors
// --hmr     let the dev server hot-update and reload the page while this runs
//
// The page is cut off from the dev server's update socket, so it keeps the code it loaded
// with: somebody saving a source file mid-run does not restart the game under the script.
// (A module the script imports later is still served as it is on disk at that moment.)
//
// Console errors are printed. The exit code is 1 if the page threw, a scene threw
// (window.__maxx.errors), the game never became ready, or the script failed. It is 2 if
// the game was restarted while this ran (only with --hmr, or if the page navigated): run
// it again.
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true'])
    return acc
  }, []),
)

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p))
if (!CHROME) {
  console.error('Chrome not found. Set CHROME_PATH.')
  process.exit(1)
}

const base = args.base ?? `http://localhost:${args.port ?? 5311}/dev/maxx.html`
const url = args.url ?? (args.q ? `${base}?${args.q}` : base)
const out = path.resolve(args.out ?? 'maxx.png')
const width = Number(args.w ?? 1280)
const height = Number(args.h ?? 720)
const touch = args.touch === 'true'
const nativeWhat = args.native === undefined ? null : args.native === 'true' ? 'playfield' : args.native
const zoom = Number(args.zoom ?? 1)
if ((nativeWhat && nativeWhat !== 'playfield' && nativeWhat !== 'screen') || !Number.isInteger(zoom) || zoom < 1) {
  console.error('--native takes playfield or screen, --zoom a whole number from 1')
  process.exit(1)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // Without the autoplay switch the audio code never runs: nothing counts as a user gesture here.
  args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--mute-audio', `--window-size=${width},${height}`],
})
let failed = false
let restarted = false
try {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: Number(args.dpr ?? 1), isMobile: touch, hasTouch: touch })
  // A headless page does not count as focused, and the game pauses its sound when unfocused.
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  page.on('console', (m) => {
    const t = m.type()
    if (t === 'error' || t === 'warn' || args.verbose) console.log(`[page ${t}] ${m.text()}`)
  })
  page.on('pageerror', (e) => {
    failed = true
    console.log(`[page threw] ${e.message}`)
  })
  page.on('requestfailed', (r) => console.log(`[request failed] ${r.url()} ${r.failure()?.errorText ?? ''}`))
  if (!args.hmr) {
    // A socket that never opens: the dev server's client waits on it for ever and does nothing.
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
  }

  const loaded = await page.goto(url, { waitUntil: 'load', timeout: 60000 }).then(
    () => true,
    (e) => {
      failed = true
      console.log(`[shot] could not open ${url} (is the dev server running on that port?): ${e?.message ?? e}`)
      return false
    },
  )
  if (loaded && !args.noready) {
    await page.waitForFunction('window.__maxx && window.__maxx.ready === true', { timeout: Number(args.timeout ?? 30000) }).catch(() => {
      failed = true
      console.log('[shot] the page never set window.__maxx.ready (is debug=0 in the query?)')
    })
  }
  // Remember which game this run started with, to notice a restart.
  const started = await page.evaluate('!!(window.__maxxRun = window.__maxx && window.__maxx.handle)').catch(() => false)
  const settle = (ms) => new Promise((r) => setTimeout(r, ms))
  /** The game's own 640x360 picture saved to p (see --native); returns what it drew, or throws. */
  const saveNative = async (p, what = 'playfield', k = 1) => {
    const got = await page.evaluate(
      (what, k) => {
        const m = window.__maxx
        const s = m && m.sceneObject()
        const w = m && m.world()
        const one = document.createElement('canvas')
        one.width = 640
        one.height = 360
        const g = one.getContext('2d')
        g.imageSmoothingEnabled = false
        let used = 'screen'
        if (what === 'playfield' && w && s && s.renderer && typeof s.renderer.draw === 'function') {
          // draw() only reads the world and may run any number of times a tick (render/world.ts).
          s.renderer.draw(g, w)
          used = 'playfield'
        } else {
          // The backing store is a whole multiple of 640x360 filled without smoothing: one pixel in k is exact.
          const c = document.querySelector('canvas')
          if (!c) return null
          g.drawImage(c, 0, 0, c.width, c.height, 0, 0, 640, 360)
        }
        let pic = one
        if (k > 1) {
          pic = document.createElement('canvas')
          pic.width = 640 * k
          pic.height = 360 * k
          const z = pic.getContext('2d')
          z.imageSmoothingEnabled = false
          z.drawImage(one, 0, 0, pic.width, pic.height)
        }
        return { url: pic.toDataURL('image/png'), used }
      },
      what,
      k,
    )
    if (!got) throw new Error('no game canvas on the page')
    writeFileSync(p, Buffer.from(got.url.split(',')[1], 'base64'))
    console.log(`[shot] ${p} (${640 * k}x${360 * k}, ${got.used}${got.used !== what ? ': the scene has no renderer of its own' : ''})`)
    return p
  }
  const shot = async (file) => {
    const p = path.resolve(path.dirname(out), file)
    if (nativeWhat) return saveNative(p, nativeWhat, zoom)
    await page.screenshot({ path: p })
    console.log(`[shot] ${p}`)
    return p
  }
  const native = (file, o = {}) => saveNative(path.resolve(path.dirname(out), file), o.what ?? nativeWhat ?? 'playfield', o.zoom ?? zoom)
  const maxx = (fn, ...rest) => page.evaluate(`(${fn.toString()})(window.__maxx, ...${JSON.stringify(rest)})`)

  if (args.eval) {
    await page.evaluate(args.eval).then(
      (v) => console.log('[eval]', JSON.stringify(v)),
      (e) => {
        failed = true
        console.log(`[eval failed] ${e?.message ?? e}`)
      },
    )
  }
  await settle(Number(args.wait ?? 300))
  if (args.script && loaded) {
    try {
      const mod = await import(pathToFileURL(path.resolve(args.script)).href)
      await mod.default({ page, shot, native, settle, maxx, outDir: path.dirname(out) })
    } catch (e) {
      failed = true
      console.log(`[script failed] ${e?.stack ?? e}`)
    }
  }
  // A page that is reloading cannot be photographed: that is a restart, reported below.
  await (nativeWhat ? saveNative(out, nativeWhat, zoom) : page.screenshot({ path: out }).then(() => console.log(`[shot] ${out}`))).catch((e) => console.log(`[shot] no picture: ${e?.message ?? e}`))

  restarted = started && !(await page.evaluate('!!window.__maxx && window.__maxxRun === window.__maxx.handle').catch(() => false))
  if (restarted) console.log('[shot] the game was restarted while this ran (the page reloaded or was hot-updated): run it again')
  const errors = await page.evaluate('window.__maxx ? Array.from(window.__maxx.errors) : []').catch(() => [])
  for (const e of errors) {
    failed = true
    console.log(`[scene threw] ${e}`)
  }
} finally {
  await browser.close()
}
process.exit(restarted ? 2 : failed ? 1 : 0)
