// Screenshots the 3D tunnel preview page (dev/tunnel3d.html) in headless Chrome, so the
// scene can be checked without signing in. Start the dev server first:
//   npx vite --port 5199 --strictPort
// then:
//   node scripts/tunnel3d-shot.mjs --out shot.png [--q "kind=wrap&cam=iso"] [--w 1440] [--h 810]
//     [--dpr 1] [--wait 600] [--eval "window.__t3d.scene.setTime(3)"] [--script steps.mjs] [--dark]
//
// --q       query string for the preview page (or --url for a whole URL)
// --eval    JavaScript run in the page once the scene is ready, before the picture
// --script  a module exporting default async ({ page, shot }) => {} for multi-step checks
//           (move the mouse, drag, take several pictures with shot('name.png'))
// Page console errors are printed, and the exit code is 1 if the page threw.
import { existsSync } from 'node:fs'
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

const base = args.base ?? 'http://localhost:5199/dev/tunnel3d.html'
const url = args.url ?? (args.q ? `${base}?${args.q}` : base)
const out = path.resolve(args.out ?? 'tunnel3d.png')
const width = Number(args.w ?? 1440)
const height = Number(args.h ?? 810)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', `--window-size=${width},${height}`],
})
let failed = false
try {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: Number(args.dpr ?? 1) })
  if (args.dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  if (args.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  page.on('console', (m) => {
    const t = m.type()
    if (t === 'error' || t === 'warn' || args.verbose) console.log(`[page ${t}] ${m.text()}`)
  })
  page.on('pageerror', (e) => { failed = true; console.log(`[page threw] ${e.message}`) })
  page.on('requestfailed', (r) => console.log(`[request failed] ${r.url()} ${r.failure()?.errorText ?? ''}`))

  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  if (!args.noready) {
    await page.waitForFunction('window.__t3d && window.__t3d.ready === true', { timeout: Number(args.timeout ?? 45000) })
      .catch(() => { failed = true; console.log('[shot] the page never set window.__t3d.ready') })
  }
  const settle = (ms) => new Promise((r) => setTimeout(r, ms))
  const shot = async (file) => {
    const p = path.resolve(path.dirname(out), file)
    await page.screenshot({ path: p })
    console.log(`[shot] ${p}`)
    return p
  }
  if (args.eval) console.log('[eval]', JSON.stringify(await page.evaluate(args.eval)))
  await settle(Number(args.wait ?? 600))
  if (args.script) {
    const mod = await import(pathToFileURL(path.resolve(args.script)).href)
    await mod.default({ page, shot, settle })
  }
  await page.screenshot({ path: out })
  console.log(`[shot] ${out}`)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
