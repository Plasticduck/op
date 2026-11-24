// Replays a run that scripts/maxx/solve.mjs recorded: in Node against the current code (a
// level's stored replay is its regression test), or in headless Chrome through the real game,
// photographed every N ticks into a comic strip of contact sheets.
//
//   node scripts/maxx/replay.mjs <file.json> --verify
//   node scripts/maxx/serve.mjs --port <p> -- node scripts/maxx/replay.mjs <file.json> --port <p> --out <dir>
//                               [--every 120] [--scene viewer|play] [--cols 4] [--half]
//
// --verify    Node only: replay every attempt and compare the world hash at the end of each
//             (and every 600 ticks on the way) with what the recording stored. Exit 0 when all
//             match, 1 when the level or the simulation has changed under the replay.
// --port      the dev server's port. The browser mode needs one: run it through
//             scripts/maxx/serve.mjs as above, which starts the server, runs this, and stops it.
// --out       folder for the pictures: <level>-<attempt>-t<tick>.png every --every ticks (and at the end
//             of each attempt), and <level>-sheet-<n>.png, 4 x 5 of them on a page, each with
//             its tick, time, attempt and where Maxx is.
// --scene     viewer (default): the dev viewer scene, the real world renderer and nothing on
//             top; retries from a checkpoint are set up the way solve.mjs made them.
//             play: the real play scene, HUD and all (only for a replay made with the default
//             seed: the play scene has no seed of its own). Its retries are the scene's own.
// --half      contact sheets at half size (the pictures stay full size).
//
// The game is stepped by hand (manual time), one tick per input frame, and the world hash is
// checked in the page against Node's at the same ticks: the browser must play exactly what
// the Node run did. Nothing in the page is patched for that: the simulation takes sin, cos and
// hypot from sim/mathx.ts, plain arithmetic that every engine computes alike. Exit code 0 when
// every hash matched, 1 when one did not, 2 for a bad command line or a level that does not load.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import puppeteer from 'puppeteer-core'
import { loadOne, openGame } from './level.mjs'
import { REPLAY_FORMAT, decodeInput, frameFor, playReplay } from './lib/solver.mjs'
import { GAME_URL, REPO } from './paths.mjs'

const USAGE = `usage:
  node scripts/maxx/replay.mjs <file.json> --verify
  node scripts/maxx/serve.mjs --port <p> -- node scripts/maxx/replay.mjs <file.json> --port <p> --out <dir> [--every 120] [--scene viewer|play] [--half]`

/** createWorld's own seed, which the viewer must be given by name (its default is 1). */
const DEFAULT_SEED = 0x2f6e2b1

function parseArgs(argv) {
  const pos = []
  const flags = {}
  const bare = new Set(['verify', 'half', 'help'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) pos.push(a)
    else if (bare.has(a.slice(2))) flags[a.slice(2)] = true
    else flags[a.slice(2)] = argv[++i]
  }
  return { pos, flags }
}

/* ------------------------------------------------------------------ */
/* Node                                                                */
/* ------------------------------------------------------------------ */

/** Hashes of every attempt at the ticks the browser is checked at: each `every`, the last two, and tick 0. */
function nodeHashes(sim, level, rep, every) {
  const out = []
  for (const at of rep.attempts) {
    const w = sim.createWorld(level, {
      session: { ...at.session },
      checkpoint: at.checkpoint ?? null,
      flags: at.flags ? { ...at.flags } : undefined,
      tokens: at.tokens ? [...at.tokens] : undefined,
      seed: rep.seed ?? undefined,
    })
    const masks = decodeInput(at.input)
    const at0 = sim.worldHash(w)
    const marks = new Map()
    let prev = 0
    for (let i = 0; i < masks.length; i++) {
      sim.stepWorld(w, frameFor(prev, masks[i]))
      w.events.length = 0
      prev = masks[i] & 63
      const t = i + 1
      if (t % every === 0 || t >= masks.length - 1) marks.set(t, sim.worldHash(w))
    }
    out.push({ start: at0, marks, masks, ticks: masks.length, status: w.status })
  }
  return out
}

function verify(game, level, rep) {
  const res = playReplay(game.sim, level, rep)
  console.log(`REPLAY ${rep.level} (${rep.attempts.length} attempt${rep.attempts.length === 1 ? '' : 's'}, seed ${rep.seed ?? 'default'}, ${optionWords(rep)})`)
  res.attempts.forEach((a, i) => {
    const ok = a.want === null || a.want === a.hash
    const where = a.diverged ? `; first differs at the mark of tick ${a.diverged[0]}` : ''
    console.log(`  attempt ${i + 1}: ${a.ticks} ticks, ended ${a.status}${a.exit ? ` by the ${a.exit}` : ''}, hash ${a.hash} ${ok ? 'MATCHES' : `DIFFERS (recorded ${a.want})${where}`}`)
  })
  if (rep.result) console.log(`  recorded: ${rep.result.ok ? 'solved' : 'not solved'}, ${rep.result.ticks} ticks, hits ${rep.result.hits}, cars ${rep.result.carsWashed}/${rep.result.carsTotal}, tokens ${rep.result.tokens.map((t, i) => (t ? i + 1 : '-')).join(' ')}, score ${rep.result.score}`)
  console.log(res.ok ? '  OK: the replay plays to the same world with the current code' : '  FAILED: the level or the simulation has changed since this replay was made')
  return res.ok ? 0 : 1
}
const optionWords = (rep) => `exit ${rep.options?.exit ?? 'goal'}${rep.options?.tokens ? ', tokens' : ''}${rep.options?.spotless ? ', spotless' : ''}`

/* ------------------------------------------------------------------ */
/* Contact sheets                                                      */
/* ------------------------------------------------------------------ */

// A 3 x 5 pixel font for the captions, drawn twice size.
const GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', ',': '000000000010100', '.': '000000000000010', ':': '000010000010000', '-': '000000111000000',
  '/': '001001010100100', '!': '010010010000010', '+': '000010111010000',
}
function drawText(img, text, x, y, rgb, scale = 2) {
  let cx = x
  for (const ch of String(text).toUpperCase()) {
    const g = GLYPHS[ch]
    if (g) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (g[r * 3 + c] !== '1') continue
          fill(img, cx + c * scale, y + r * scale, scale, scale, rgb)
        }
      }
    }
    cx += 4 * scale
  }
}
function fill(img, x, y, w, h, [r, g, b]) {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx++) {
      const i = (yy * img.width + xx) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = 255
    }
  }
}
/** Paste a picture, at full size or at half (each 2 x 2 block averaged). */
function paste(img, src, x0, y0, half) {
  const k = half ? 2 : 1
  const w = Math.floor(src.width / k)
  const h = Math.floor(src.height / k)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = ((y0 + y) * img.width + x0 + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        let s = 0
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += src.data[((y * k + dy) * src.width + x * k + dx) * 4 + ch]
        img.data[o + ch] = Math.round(s / (k * k))
      }
      img.data[o + 3] = 255
    }
  }
}
function writeSheets(frames, dir, id, cols, half) {
  const per = cols * 5
  const files = []
  for (let n = 0; n * per < frames.length; n++) {
    const page = frames.slice(n * per, (n + 1) * per)
    const first = PNG.sync.read(readFileSync(page[0].file))
    const fw = half ? Math.floor(first.width / 2) : first.width
    const fh = half ? Math.floor(first.height / 2) : first.height
    const cap = 16
    const gap = 6
    const rows = Math.ceil(page.length / cols)
    const img = new PNG({ width: cols * (fw + gap) + gap, height: 22 + rows * (fh + cap + gap) + gap })
    fill(img, 0, 0, img.width, img.height, [22, 22, 29])
    drawText(img, `${id} ${n + 1}/${Math.ceil(frames.length / per)}`, gap, 6, [255, 232, 102])
    page.forEach((f, i) => {
      const x = gap + (i % cols) * (fw + gap)
      const y = 22 + Math.floor(i / cols) * (fh + cap + gap)
      const src = PNG.sync.read(readFileSync(f.file))
      const tone = f.hit ? [255, 107, 107] : f.end ? [155, 224, 79] : [247, 244, 248]
      drawText(img, f.caption, x, y + 2, tone)
      paste(img, src, x, y + cap, half)
    })
    const file = path.join(dir, `${id}-sheet-${n + 1}.png`)
    writeFileSync(file, PNG.sync.write(img))
    files.push(file)
  }
  return files
}

/* ------------------------------------------------------------------ */
/* The browser                                                         */
/* ------------------------------------------------------------------ */

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => p && existsSync(p))

/** Launch Chrome on the dev page for a replay and play it there. Returns playInPage()'s report, with contact sheets. */
async function browse(game, level, rep, flags) {
  const port = Number(flags.port)
  const sceneName = flags.scene ?? 'viewer'
  const dir = path.resolve(flags.out)
  mkdirSync(dir, { recursive: true })
  if (!CHROME) throw new Error('Chrome not found. Set CHROME_PATH.')
  if (sceneName === 'play' && rep.seed !== null && rep.seed !== undefined) throw new Error(`--scene play needs a replay made with the default seed (this one has seed ${rep.seed}): the play scene has no seed of its own`)
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--mute-audio', '--window-size=1280,900'] })
  let report
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
    const cdp = await page.createCDPSession()
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    // Cut off the dev server's update socket, as shot.mjs does: a source saved mid-run must not reload the page.
    await page.evaluateOnNewDocument(() => {
      const Real = window.WebSocket
      const Quiet = function (u, protocols) {
        const kind = Array.isArray(protocols) ? protocols[0] : protocols
        if (kind !== 'vite-hmr' && kind !== 'vite-ping') return new Real(u, protocols)
        return Object.assign(new EventTarget(), { url: String(u), readyState: 0, send() {}, close() {} })
      }
      Quiet.prototype = Real.prototype
      window.WebSocket = Quiet
    })
    const url = `http://localhost:${port}/dev/maxx.html?${replayQuery(level.id, rep, sceneName)}`
    await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch((e) => {
      throw new Error(`could not open ${url} (is the dev server running on port ${port}? see the usage): ${e.message}`)
    })
    await page.waitForFunction('window.__maxx && window.__maxx.ready === true', { timeout: 60000 })
    report = await playInPage(page, game.sim, level, rep, { every: Number(flags.every ?? 120), scene: sceneName, dir })
    if (errors.length) report.errors = errors
  } finally {
    await browser.close()
  }
  report.sheets = writeSheets(report.frames, dir, level.id, Number(flags.cols ?? 4), !!flags.half)
  return report
}

/** The dev page query that opens a replay's level in a scene. */
export function replayQuery(levelId, rep, sceneName = 'viewer') {
  const params = sceneName === 'viewer' ? { seed: rep.seed ?? DEFAULT_SEED } : { card: false, readout: false }
  return `scene=${sceneName}&level=${encodeURIComponent(levelId)}&manual=1&fresh=1&params=${encodeURIComponent(JSON.stringify(params))}`
}

/**
 * Play a replay on a dev page that is open (and ready) on replayQuery(): one tick per input
 * frame, the world hash checked against Node's every `every` ticks and at each attempt's end,
 * a picture into opts.dir every `every` ticks. Returns { mismatches: [text], frames: [{ file,
 * caption, hit, end }] }. opts: every (120), scene ('viewer' | 'play'), dir, pictures (true).
 */
export async function playInPage(page, sim, level, rep, opts = {}) {
  const every = Math.max(1, Number(opts.every ?? 120))
  const sceneName = opts.scene ?? 'viewer'
  const dir = opts.dir
  const pictures = opts.pictures !== false && !!dir
  const node = nodeHashes(sim, level, rep, every)
  const report = { mismatches: [], frames: [] }
  const setup = await page.evaluate(async (GAME) => {
    const m = window.__maxx
    m.setManual(true)
    const live = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => n.includes(GAME + '/game/sim/index.ts'))
    window.__rp = { sim: await import(live ?? GAME + '/game/sim/index.ts') }
    const w = m.world()
    return w ? { tick: w.tick, hash: window.__rp.sim.worldHash(w) } : { problem: 'the scene has no world (is the level known to levelById?)' }
  }, GAME_URL)
  if (setup.problem) throw new Error(setup.problem)

  // The game's own canvas only (the dev page puts a title bar and the controls round it), at 640 x 360.
  const rect = await page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
    const r = c.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  })
  const clip = { ...rect, scale: 640 / rect.width }
  let lastAttempt = 0
  let lastTick = 0
  const shoot = async (info) => {
    lastTick = info.tick
    if (!pictures) return
    lastAttempt = info.attempt
    const file = path.join(dir, `${level.id}-${info.attempt + 1}-t${String(info.tick).padStart(6, '0')}.png`)
    await page.screenshot({ path: file, clip })
    const secs = (info.tick / 60).toFixed(1)
    report.frames.push({ file, hit: info.hit, end: info.end, caption: `${rep.attempts.length > 1 ? `TRY ${info.attempt + 1} ` : ''}T ${info.tick} ${secs}S ${info.area} ${info.col},${info.row}${info.hit ? ' HIT' : ''}${info.end ? ` ${info.end}` : ''}` })
  }

  for (let a = 0; a < rep.attempts.length; a++) {
    const at = rep.attempts[a]
    const nh = node[a]
    // Each attempt's input, once.
    await page.evaluate((masks) => (window.__rp.masks = masks), nh.masks)
    if (sceneName === 'viewer') {
      // Every attempt is built here the way solve.mjs built it, into the viewer's own world object
      // (the page steps its first world once to draw the first frame, so even attempt 1 is rebuilt).
      // One idle step first, on the old world, so the buttons start released as they do in Node.
      {
        const h = await page.evaluate((at, seed) => {
          const m = window.__maxx
          m.release()
          m.step(1)
          const W = m.world()
          const s = m.ctx.session
          Object.assign(s, at.session)
          const nw = window.__rp.sim.createWorld(W.level, { session: s, checkpoint: at.checkpoint ?? null, flags: at.flags ? { ...at.flags } : undefined, tokens: at.tokens ? [...at.tokens] : undefined, seed })
          for (const k of Object.keys(W)) if (!(k in nw)) delete W[k]
          Object.assign(W, nw)
          m.sceneObject().renderer?.reset(W)
          // Draw it without a tick, so the first picture is this world.
          m.step(0)
          return window.__rp.sim.worldHash(W)
        }, at, rep.seed ?? DEFAULT_SEED)
        if (h !== nh.start) report.mismatches.push(`attempt ${a + 1} starts as ${h}, Node's as ${nh.start} (a different level, seed or session)`)
      }
    }
    const info0 = await page.evaluate((play) => {
      const m = window.__maxx
      // The play scene opens on an iris before the level runs: the first picture is of the level.
      if (play) {
        m.release()
        for (let k = 0; k < 600 && m.sceneObject().state().phase !== 'run'; k++) m.step(1)
      }
      const w = m.world()
      const p = w.player
      return { area: w.area.id, col: Math.floor((p.x + p.w / 2) / 32), row: Math.floor((p.y + p.h - 1) / 32) }
    }, sceneName === 'play')
    await shoot({ attempt: a, tick: 0, ...info0 })
    for (let i = 0; i < nh.ticks; ) {
      const n = Math.min(every - (i % every), nh.ticks - i)
      const res = await page.evaluate(
        (from, n, play, checks) => {
          const m = window.__maxx
          const rp = window.__rp
          const masks = rp.masks
          const names = ['left', 'right', 'up', 'down', 'jump', 'spray']
          const hold = (mask) => {
            const list = names.filter((_, b) => mask & (1 << b))
            const dx = (mask & 2 ? 1 : 0) - (mask & 1 ? 1 : 0)
            m.hold(list, mask & 64 && dx ? { x: dx * 0.5 } : undefined)
          }
          let hit = false
          let done = 0
          const out = { hashes: [], stalled: false }
          let guard = 0
          while (done < n) {
            let w = m.world()
            if (play) {
              // The play scene holds the world on its cards: keep holding the last frame's buttons until it steps again.
              const st = m.sceneObject().state()
              const steps = st.phase === 'run' && !st.paused && st.versus === ''
              if (!steps || !w) {
                if (rp.lastMask !== undefined) hold(rp.lastMask)
                else m.release()
                m.step(1)
                if (++guard > 3000) return { ...out, stalled: true }
                continue
              }
            }
            const pips = w.player.pips
            const hurt = w.player.state === 'hurt'
            hold(masks[from + done])
            m.step(1)
            rp.lastMask = masks[from + done]
            w = m.world()
            done++
            // The play scene may leave the level (a boss that ends it) as the last tick steps.
            if (!w) break
            // A pip lost, or a hurt that a bubble healed on the same tick.
            if ((w.player.pips < pips || (!hurt && w.player.state === 'hurt')) && w.status !== 'timeup') hit = true
            const p = w.player
            rp.last = { status: w.status, tick: w.tick, area: w.area.id, col: Math.floor((p.x + p.w / 2) / 32), row: Math.floor((p.y + p.h - 1) / 32) }
            if (checks.includes(from + done)) out.hashes.push([from + done, rp.sim.worldHash(w)])
          }
          return { ...out, hit, ...rp.last }
        },
        i,
        n,
        sceneName === 'play',
        [...nh.marks.keys()].filter((t) => t > i && t <= i + n),
      )
      if (res.stalled) throw new Error('the play scene never let the level run (a card or the pause menu held it)')
      for (const [t, h] of res.hashes) {
        const want = nh.marks.get(t)
        const last = t === nh.ticks
        // On the tick of a clear the play scene pays the time bonus into the score, after the world stepped: check the tick before.
        if (sceneName === 'play' && last && res.status === 'clear') continue
        if (h !== want) report.mismatches.push(`attempt ${a + 1}, tick ${t}: the page has ${h}, Node ${want}`)
      }
      i += n
      await shoot({ attempt: a, tick: i, area: res.area, col: res.col, row: res.row, hit: res.hit, end: i === nh.ticks ? (at.end?.status ?? res.status).toUpperCase() : null })
      if (report.mismatches.length) break
    }
    if (report.mismatches.length) break
    if (sceneName === 'play' && a + 1 < rep.attempts.length) {
      // Let the scene take the life and build the next attempt's world.
      const ok = await page.evaluate(() => {
        const m = window.__maxx
        const before = m.world()
        m.release()
        window.__rp.lastMask = undefined
        for (let k = 0; k < 2000; k++) {
          m.step(1)
          const st = m.sceneObject().state()
          if (m.world() !== before && st.phase === 'run') return true
        }
        return false
      })
      if (!ok) throw new Error('the play scene did not start the next attempt')
    }
  }
  // A last picture a moment after the end: the victory walk or the flop.
  await page.evaluate(() => {
    window.__maxx.release()
    window.__maxx.step(40)
  })
  const last = report.frames[report.frames.length - 1]
  if (pictures && last) {
    const file = path.join(dir, `${level.id}-${lastAttempt + 1}-t${String(lastTick + 40).padStart(6, '0')}.png`)
    await page.screenshot({ path: file, clip })
    const after = lastTick + 40
    report.frames.push({ file, end: true, caption: last.caption.replace(/T \d+ [\d.]+S /, `T ${after} ${(after / 60).toFixed(1)}S `).replace(/ (CLEAR|GRIMED|TIMEUP|PLAY)$/, ' AFTER') })
  }
  return report
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2))
  const file = pos[0]
  if (!file || flags.help || (!flags.verify && (!flags.port || !flags.out)) || (flags.scene && !['viewer', 'play'].includes(flags.scene))) {
    console.error(USAGE)
    return 2
  }
  let rep
  try {
    rep = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`cannot read ${file}: ${err.message}`)
    return 2
  }
  if (rep.format !== REPLAY_FORMAT || !Array.isArray(rep.attempts)) {
    console.error(`${file} is not a replay (format ${REPLAY_FORMAT})`)
    return 2
  }
  const game = await openGame()
  try {
    let entry
    try {
      entry = await loadOne(game, rep.file && existsSync(path.join(REPO, rep.file)) ? path.join(REPO, rep.file) : rep.level)
    } catch (err) {
      console.error(err.message)
      return 2
    }
    if (flags.verify) return verify(game, entry.level, rep)
    const res = await browse(game, entry.level, rep, flags)
    console.log(`REPLAY ${rep.level} in the browser (${flags.scene ?? 'viewer'} scene): ${res.frames.length} pictures, ${res.sheets.length} contact sheet${res.sheets.length === 1 ? '' : 's'}`)
    for (const s of res.sheets) console.log(`  ${s}`)
    for (const e of res.errors ?? []) console.log(`  page error: ${e}`)
    if (res.mismatches.length) {
      for (const m of res.mismatches) console.log(`  MISMATCH ${m}`)
      console.log('  FAILED: the browser did not play what Node played')
      console.log('  (Run --verify first: if it fails, the level or the simulation changed since the replay was made. If it')
      console.log("  passes, something in the simulation computes differently in the two engines: an engine Math function")
      console.log("  (sim.mjs's scan should have caught it) or an order that depends on the engine. Tell the simulation owner.")
      console.log('  The pictures up to the mismatch are saved; a smaller --every shows where it parts.)')
      return 1
    }
    console.log('  OK: every world hash checked in the page matched Node')
    return 0
  } finally {
    await game.close()
  }
}

// Run as a command, not when a check imports playInPage from here.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main().catch((err) => {
    console.error(err && err.stack ? err.stack : err)
    return 2
  })
}
