// A whole area of a level as one picture, drawn by the game's own world renderer in headless
// Chrome: every column and row, entities where they spawn, so a level can be looked at all at
// once. It needs the game's dev server; serve.mjs starts one, runs this and stops it:
//
//   node scripts/maxx/serve.mjs --port 5323 -- node scripts/maxx/overview.mjs --port 5323 --level dev-render --area tunnel --out tunnel.png
//
//   --port <p>     the dev server's port (required)
//   --level <id>   a level id: sandbox, a dev-* room, mw01..mw08, rivals
//   --area <id>    the area (default the level's first); --area all: one picture per area,
//                  named <out>-<area>.png
//   --out <file>   the PNG to write
//   --scale <n>    whole-number zoom (default 1)
//   --grid         a tile grid, with column numbers every 10 tiles along the top and row
//                  numbers down the left
//   --start        draw Maxx where he starts (the '@', or column 2 of another area)
//   --plain        as a player sees it: without the outlines of hidden blocks ('H' blue,
//                  'h' green) and without the labelled boxes of things that draw nothing
//                  (spawners, markers, pipe mouths)
//
// The backdrop is nailed to the area (no parallax) so the screens join up, and there is no
// weather. An area wider than 16384 picture pixels is cut into several bands, one under the
// other, each band starting where the last ended. Exit code 1 on any error in the page.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import pngjs from 'pngjs'
import puppeteer from 'puppeteer-core'

const { PNG } = pngjs
const argv = process.argv.slice(2)
const opt = (name, fallback) => (argv.includes(name) && argv[argv.indexOf(name) + 1] && !argv[argv.indexOf(name) + 1].startsWith('--') ? argv[argv.indexOf(name) + 1] : fallback)
const flag = (name) => argv.includes(name)

const port = opt('--port')
const levelId = opt('--level')
const out = opt('--out')
const areaArg = opt('--area', '')
const scale = Math.max(1, Math.round(Number(opt('--scale', '1')) || 1))
if (!port || !levelId || !out) {
  console.error('usage: node scripts/maxx/overview.mjs --port <p> --level <id> [--area <id>|all] --out <file.png> [--scale 1] [--grid] [--start] [--plain]')
  process.exit(2)
}
/** Widest band of picture, in picture pixels: under every browser's and image viewer's limits. */
const MAX_W = 16384
const GAP = 8

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(
  (p) => p && existsSync(p),
)
if (!CHROME) {
  console.error('Chrome not found. Set CHROME_PATH.')
  process.exit(1)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--mute-audio', '--window-size=800,600'] })
let failed = false
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 800, height: 600 })
  page.on('pageerror', (e) => {
    failed = true
    console.log(`[page threw] ${e.message}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[page error] ${m.text()}`)
  })
  // Keep the code the page loaded with, whoever saves a file meanwhile (see shot.mjs).
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

  const open = async (area) => {
    const params = { hideMaxx: !flag('--start'), weather: false, shake: false }
    if (area) params.area = area
    const url = `http://localhost:${port}/dev/maxx.html?scene=viewer&manual=1&fresh=1&level=${encodeURIComponent(levelId)}&params=${encodeURIComponent(JSON.stringify(params))}`
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
    await page.waitForFunction('window.__maxx && window.__maxx.ready === true', { timeout: 30000 })
  }

  await open(areaArg && areaArg !== 'all' ? areaArg : '')
  const info = await page.evaluate(() => {
    const w = window.__maxx.world()
    return w ? { level: w.level.id, areas: w.level.areas.map((a) => a.id), area: w.area.id } : null
  })
  if (!info || info.level !== levelId) throw new Error(`level '${levelId}' did not open${info ? ` (the viewer opened '${info.level}')` : ''}. Is it a level id the game knows (sandbox, dev-*, a level listed in levels/index.ts)?`)
  const areas = areaArg === 'all' ? info.areas : [areaArg || info.areas[0]]
  for (const a of areas) if (!info.areas.includes(a)) throw new Error(`level '${levelId}' has no area '${a}' (it has ${info.areas.join(', ')})`)

  for (const area of areas) {
    if (area !== info.area || areas.length > 1) await open(area)
    const picture = await page.evaluate(
      (o) => {
        const v = window.__maxx.sceneObject()
        const w = window.__maxx.world()
        if (!v || !v.tools || !w) throw new Error('the viewer scene has no world or tools')
        if (w.area.id !== o.area) throw new Error(`the viewer is in area '${w.area.id}', not '${o.area}'`)
        const T = 32
        const VW = 640
        const VH = 360
        const r = v.tools.createRenderer({ pinned: true, weather: false, shake: false, hideMaxx: !o.start, marks: !o.plain })
        r.reset(w)
        const AW = w.grid.w * T
        const AH = w.grid.h * T
        const s = o.scale
        const bands = Math.ceil((AW * s) / o.maxW)
        const bandCols = Math.ceil(w.grid.w / bands)
        const small = document.createElement('canvas')
        small.width = VW
        small.height = VH
        const sg = small.getContext('2d')
        sg.imageSmoothingEnabled = false
        const cam = { x: w.camera.x, y: w.camera.y }
        const parts = []
        for (let b = 0; b < bands; b++) {
          const x0 = b * bandCols * T
          const x1 = Math.min(AW, (b + 1) * bandCols * T)
          const c = document.createElement('canvas')
          c.width = (x1 - x0) * s
          c.height = AH * s
          const g = c.getContext('2d')
          g.imageSmoothingEnabled = false
          // Screens from the bottom up, so the last row of screens lines up with the floor.
          for (let cy = AH - VH; cy > -VH; cy -= VH) {
            for (let cx = x0; cx < x1; cx += VW) {
              w.camera.x = cx
              w.camera.y = cy
              r.draw(sg, w)
              g.drawImage(small, 0, 0, VW, VH, (cx - x0) * s, cy * s, VW * s, VH * s)
            }
          }
          if (o.grid) {
            g.fillStyle = 'rgba(22,22,29,0.35)'
            for (let tx = Math.ceil(x0 / T); tx * T < x1; tx++) g.fillRect((tx * T - x0) * s, 0, tx % 10 === 0 ? 2 : 1, AH * s)
            for (let ty = 0; ty <= w.grid.h; ty++) g.fillRect(0, ty * T * s, (x1 - x0) * s, ty % 10 === 0 ? 2 : 1)
            const label = { color: '#f7f4f8', outline: '#1e0d06', scale: s }
            for (let tx = Math.ceil(x0 / T); tx * T < x1; tx++) if (tx % 10 === 0) v.tools.drawText(g, String(tx), (tx * T - x0) * s + 4 * s, 3 * s, label)
            for (let ty = 0; ty < w.grid.h; ty++) v.tools.drawText(g, String(ty), 3 * s, (ty * T + 12) * s, label)
          }
          parts.push(c.toDataURL('image/png'))
        }
        w.camera.x = cam.x
        w.camera.y = cam.y
        return { parts, w: w.grid.w, h: w.grid.h, problems: r.stats().problems.slice() }
      },
      { area, scale, maxW: MAX_W, grid: flag('--grid'), start: flag('--start'), plain: flag('--plain') },
    )
    const errors = await page.evaluate('window.__maxx ? Array.from(window.__maxx.errors) : []')
    for (const e of errors) {
      failed = true
      console.log(`[scene threw] ${e}`)
    }
    for (const kind of picture.problems) console.log(`[renderer] the renderer of '${kind}' threw while drawing`)

    const pngs = picture.parts.map((d) => PNG.sync.read(Buffer.from(d.split(',')[1], 'base64')))
    let png = pngs[0]
    if (pngs.length > 1) {
      // Bands one under another, with a dark gap between.
      const W = Math.max(...pngs.map((p) => p.width))
      const H = pngs.reduce((n, p) => n + p.height, 0) + GAP * (pngs.length - 1)
      png = new PNG({ width: W, height: H })
      for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = 22
        png.data[i + 1] = 22
        png.data[i + 2] = 29
        png.data[i + 3] = 255
      }
      let y = 0
      for (const p of pngs) {
        PNG.bitblt(p, png, 0, 0, p.width, p.height, 0, y)
        y += p.height + GAP
      }
    }
    const file = areas.length > 1 ? out.replace(/(\.png)?$/i, `-${area}.png`) : out
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
    writeFileSync(file, PNG.sync.write(png))
    console.log(`[overview] ${levelId} ${area}: ${picture.w} x ${picture.h} tiles, ${png.width} x ${png.height} px${pngs.length > 1 ? ` in ${pngs.length} bands` : ''} -> ${path.resolve(file)}`)
  }
} catch (e) {
  failed = true
  console.log(`[overview failed] ${e?.message ?? e}`)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
