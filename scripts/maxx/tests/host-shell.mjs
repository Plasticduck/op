// The shell (engine/game.ts) and the sprite loader (engine/sprites.ts) in Node, on a small
// stand-in DOM: no browser, no server. What it pins:
//   - a sprite sheet that fails is asked for again, a load with one missing is not kept, and
//     the game says so on screen and tries again on confirm, instead of running with no art
//   - every sheet is drawn once behind LOADING (decoded before the first level needs it)
//   - on a 60 Hz screen only a frame with a tick draws, exactly as the tick left it; on a
//     clearly faster one (75, 144 Hz) every frame draws, part of the way between two ticks
//   - focus moving to the app outside the game (the Ctrl-K palette) pauses it
//   - fullscreen asks Keyboard Lock for Esc, and lets go on the way out and on destroy
//   - the whole-number scale the app's usual 1920x1080 box gets
//   node scripts/maxx/tests/host-shell.mjs [--only <text>]
// The scenarios share one page's sprite loader, so they run in order (about 10 s: the
// failing sheet waits out the loader's real retry pauses).
import { suite } from '../lib/testkit.mjs'

/* ---------------- the stand-in DOM ---------------- */

function events(obj) {
  const on = new Map()
  obj.addEventListener = (type, fn) => {
    if (!on.has(type)) on.set(type, new Set())
    on.get(type).add(fn)
  }
  obj.removeEventListener = (type, fn) => on.get(type)?.delete(fn)
  obj.fire = (type, ev = {}) => {
    for (const fn of [...(on.get(type) ?? [])]) fn({ type, ...ev })
  }
  return obj
}

/** A 2D context that takes anything and remembers its drawImage calls. */
function fakeContext(canvas) {
  const target = {
    canvas,
    draws: [],
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    drawImage(...args) {
      target.draws.push(args)
    },
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
  }
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => {
      t[k] = v
      return true
    },
  })
}

const dom = { windowFocus: true, created: [] }

class FakeElement {
  constructor(tag, parent = null) {
    this.tagName = tag.toUpperCase()
    this.parentElement = parent
    this.style = {}
    this.rect = { left: 0, top: 0, width: 0, height: 0 }
    events(this)
  }
  contains(el) {
    for (let e = el; e; e = e.parentElement) if (e === this) return true
    return false
  }
  closest() {
    return null
  }
  /** Focus moves here: focusin bubbles to the document, as in a browser. */
  focus() {
    document.activeElement = this
    document.fire('focusin', { target: this })
  }
  getBoundingClientRect() {
    return this.rect
  }
  get clientLeft() {
    return 0
  }
  get clientTop() {
    return 0
  }
  get offsetWidth() {
    return this.rect.width
  }
  get clientWidth() {
    return this.rect.width
  }
  get offsetHeight() {
    return this.rect.height
  }
  get clientHeight() {
    return this.rect.height
  }
}

class FakeCanvas extends FakeElement {
  constructor(parent = null) {
    super('canvas', parent)
    this.width = 300
    this.height = 150
  }
  getContext() {
    return (this.ctx ??= fakeContext(this))
  }
}

/** Which image URLs fail (any that contains one of these), and how often each was asked for. */
const net = { fail: [], asked: new Map() }

class FakeImage {
  set src(url) {
    this._src = url
    net.asked.set(url, (net.asked.get(url) ?? 0) + 1)
    const bad = net.fail.some((part) => url.includes(part))
    setTimeout(() => {
      if (bad) return this.onerror?.()
      this.naturalWidth = 8
      this.onload?.()
    }, 0)
  }
  get src() {
    return this._src
  }
}

const rafQueue = []
const keyboard = { locks: [], unlocks: 0 }

const document = events({
  visibilityState: 'visible',
  hasFocus: () => dom.windowFocus,
  fullscreenElement: null,
  fullscreenEnabled: true,
  createElement(tag) {
    const el = tag === 'canvas' ? new FakeCanvas() : new FakeElement(tag)
    dom.created.push(el)
    return el
  },
  async exitFullscreen() {
    document.fullscreenElement = null
    document.fire('fullscreenchange')
  },
})
document.documentElement = new FakeElement('html')
document.body = new FakeElement('body', document.documentElement)
document.activeElement = document.body

const window = events({ devicePixelRatio: 1, matchMedia: () => ({ matches: false }) })

const set = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
set('window', window)
set('document', document)
set('Element', FakeElement)
set('Image', FakeImage)
set('requestAnimationFrame', (fn) => rafQueue.push(fn))
set('cancelAnimationFrame', () => {})
set('navigator', {
  getGamepads: () => [],
  userActivation: { hasBeenActive: true },
  keyboard: {
    lock: async (keys) => void keyboard.locks.push(keys),
    unlock: () => void keyboard.unlocks++,
  },
})
const store = new Map()
set('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
})

/** Runs every queued animation frame at time `now` (ms). */
function frameAt(now) {
  for (const fn of rafQueue.splice(0)) fn(now)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- the game, with a scene of the test's own ---------------- */

const t = await suite('host')
const sprites = await t.loadModule('engine/sprites.ts')
const { createGame } = await t.loadModule('engine/game.ts')
const { SCENES } = await t.loadModule('scenes/index.ts')
const { frameClock } = await t.loadModule('render/clock.ts')

const seen = { updates: 0, frames: [], autoPause: [], alphas: [] }
SCENES.hosttest = () => ({
  update(game, f) {
    seen.updates++
    seen.frames.push(f)
    seen.autoPause.push(game.autoPause)
  },
  render() {
    seen.alphas.push(frameClock.alpha)
  },
})

function audioStub() {
  const a = { paused: [], locked: false }
  return Object.assign(a, {
    unlock() {},
    sfx() {},
    spray() {},
    music() {},
    jingle() {},
    stopJingle() {},
    setTempoScale() {},
    setVolumes() {},
    setPaused: (p) => void a.paused.push(p),
    preload() {},
    destroy() {},
  })
}

/** The game's root (what goes fullscreen) holding a stage of this size, the canvas inside it. */
function mount(opts = {}, box = { width: 1280, height: 720 }) {
  const root = new FakeElement('div', document.body)
  const stage = new FakeElement('div', root)
  stage.rect = { left: 0, top: 0, ...box }
  const canvas = new FakeCanvas(stage)
  const audio = audioStub()
  const before = dom.created.length
  const game = createGame(canvas, { userId: 'hosttest', startScene: 'hosttest', fullscreenTarget: root, audio, ...opts })
  // The shell's own 640x360 picture is the first canvas it makes.
  const buffer = dom.created[before]
  return { game, root, stage, canvas, audio, buffer }
}
/** drawImage calls that draw one pixel of a sheet at 0,0 (the warm-up). */
const warmCalls = (buffer) => buffer.ctx.draws.filter((a) => a[0] instanceof FakeImage && a.slice(1).join() === '0,0,1,1,0,0,1,1')
const sheetCount = () => [...net.asked.keys()].length

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].toLowerCase() : null
const failures = new Map()
/** Runs an async scenario now; its test reports what it threw. */
async function scenario(title, fn) {
  if (only && !title.toLowerCase().includes(only)) return
  try {
    await fn()
    failures.set(title, null)
  } catch (err) {
    failures.set(title, err)
  }
  t.test(title, () => {
    if (failures.get(title)) throw failures.get(title)
  })
}
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

/* ---------------- sprite sheets ---------------- */

const MAXX_PNG = '/maxx.png'

await scenario('a sheet that will not load: asked for three times, then the game says so instead of running without it', async () => {
  net.fail = [MAXX_PNG]
  const { game, buffer } = mount({ manual: true })
  await game.whenReady
  const maxxUrl = [...net.asked.keys()].find((u) => u.includes(MAXX_PNG))
  ok(net.asked.get(maxxUrl) === 3, `maxx.png asked for ${net.asked.get(maxxUrl)} times, want 3`)
  ok(game.ready, 'not ready: the message screen could not take the button')
  ok(game.sceneId === null && game.scene(), `went on to ${game.sceneId} with a sheet missing`)
  ok(!game.ctx.sprites.has('maxx/idle0'), 'Maxx is there after all')
  ok(warmCalls(buffer).length === 0, 'warmed sheets before showing the message')
  game.step(5)
  ok(game.sceneId === null, 'left the message by itself')

  // The connection is back: confirm tries again, and only the missing sheet is asked for.
  net.fail = []
  const before = new Map(net.asked)
  game.ctx.input.inject('confirm')
  game.step(1)
  for (let i = 0; i < 50 && game.ctx.transitioning === false; i++) await sleep(10)
  ok(game.ctx.transitioning, 'confirm did not bring the art back')
  const again = [...net.asked.keys()].filter((u) => net.asked.get(u) !== before.get(u))
  ok(again.length === 1 && again[0] === maxxUrl, `asked again for ${again.join(', ')}`)
  game.step(30)
  ok(game.sceneId === 'hosttest', `after the art came back: ${game.sceneId}`)
  ok(game.ctx.sprites.has('maxx/idle0'), 'still no Maxx')
  ok(warmCalls(buffer).length === sheetCount(), `warmed ${warmCalls(buffer).length} of ${sheetCount()} sheets`)
  game.destroy()
})

await scenario('a full load is kept for the page: a remount asks for nothing', async () => {
  const asked = () => [...net.asked.values()].reduce((a, b) => a + b, 0)
  const before = asked()
  const full = sprites.loadSprites()
  ok(full === sprites.loadSprites(), 'a full load is not kept')
  ok(sprites.missingSheets(await full).length === 0, 'the kept load has a sheet missing')
  ok(asked() === before, 'asked for sheets again')
})

await scenario('a game that starts with every sheet draws each one once before its first scene', async () => {
  const { game, buffer } = mount({ manual: true })
  await game.whenReady
  ok(game.sceneId === 'hosttest', `started in ${game.sceneId}`)
  ok(warmCalls(buffer).length === sheetCount(), `warmed ${warmCalls(buffer).length} of ${sheetCount()} sheets`)
  game.destroy()
})

/* ---------------- the loop ---------------- */

const live = mount()
await live.game.whenReady
const presents = () => live.canvas.ctx.draws.filter((a) => a[0] === live.buffer).length

let clock = 1000
const runFrames = (n, hz = 60) => {
  for (let i = 0; i < n; i++) frameAt((clock += 1000 / hz))
}
/** A second at `hz` after half a second to settle: ticks run, pictures presented, the alpha each scene render saw. */
function second(hz) {
  runFrames(hz >> 1, hz)
  const t0 = seen.updates
  const d0 = presents()
  const a0 = seen.alphas.length
  runFrames(hz, hz)
  return { ticks: seen.updates - t0, draws: presents() - d0, alphas: seen.alphas.slice(a0) }
}

await scenario('on a 60 Hz screen only a frame with a tick draws, and draws the tick as it is', async () => {
  frameAt(clock)
  for (const hz of [60, 59.94]) {
    const r = second(hz)
    ok(r.ticks >= 59 && r.ticks <= 61, `${hz} Hz: ${r.ticks} ticks in a second`)
    ok(r.draws === r.ticks, `${hz} Hz: ${r.draws} draws for ${r.ticks} ticks`)
    ok(r.alphas.every((a) => a === 1), `${hz} Hz: drawn between ticks (alpha ${r.alphas.find((a) => a !== 1)})`)
  }
})

await scenario('on a 75 or 144 Hz screen every frame draws, part of the way from one tick to the next', async () => {
  for (const hz of [75, 144]) {
    const r = second(hz)
    ok(r.ticks >= 59 && r.ticks <= 61, `${hz} Hz: ${r.ticks} ticks in a second`)
    ok(r.draws === hz, `${hz} Hz: ${r.draws} draws in ${hz} frames`)
    ok(r.alphas.every((a) => a >= 0 && a <= 1), `${hz} Hz: alpha out of range`)
    ok(r.alphas.some((a) => a > 0.05 && a < 0.95), `${hz} Hz: never drawn between ticks`)
    ok(frameClock.alpha === 1 && frameClock.tick === live.game.ctx.tick, `${hz} Hz: the clock was left at alpha ${frameClock.alpha}, tick ${frameClock.tick}`)
  }
  // And off again when the screen slows to 60 (the window moved to another monitor).
  const back = second(60)
  ok(back.draws === back.ticks && back.alphas.every((a) => a === 1), `back at 60 Hz: ${back.draws} draws for ${back.ticks} ticks`)
})

await scenario('focus moving to the app outside the game pauses it, and back on the canvas brings the sound back', async () => {
  runFrames(2)
  const palette = new FakeElement('input', document.body)
  const header = new FakeElement('button', live.root)
  palette.focus()
  ok(live.audio.paused.at(-1) === true, 'the sound was not held')
  const from = seen.frames.length
  runFrames(2)
  const paused = seen.frames.slice(from).findIndex((f) => f.pressed.pause)
  ok(paused >= 0 && seen.autoPause[from + paused], 'no pause was pressed for the player')
  // The window coming back (alt-tab) with the palette still open is still away; so is focus
  // on the game's own header buttons, which take the keys too.
  window.fire('focus')
  ok(live.audio.paused.at(-1) === true, 'came back while focus was still outside')
  header.focus()
  ok(live.audio.paused.at(-1) === true, 'came back on a header button')
  live.canvas.focus()
  ok(live.audio.paused.at(-1) === false, 'the canvas got focus back and the sound stayed held')
})

/* ---------------- fullscreen ---------------- */

await scenario('fullscreen locks Esc for the game, and lets go when it ends, is refused, or the game goes', async () => {
  const { game, root } = live
  root.requestFullscreen = async () => {
    document.fullscreenElement = root
    document.fire('fullscreenchange')
  }
  // Games destroyed above have let go already.
  keyboard.unlocks = 0
  game.ctx.toggleFullscreen()
  await sleep(0)
  ok(game.ctx.fullscreen, 'did not go fullscreen')
  ok(keyboard.locks.length === 1 && keyboard.locks[0].join() === 'Escape', `locked ${JSON.stringify(keyboard.locks)}`)
  ok(keyboard.unlocks === 0, 'let go too soon')
  // Held Esc: the browser leaves fullscreen by itself.
  await document.exitFullscreen()
  ok(keyboard.unlocks === 1, 'kept the lock after fullscreen ended')
  const from = seen.frames.length
  runFrames(2)
  ok(seen.frames.slice(from).some((f) => f.pressed.pause), 'leaving fullscreen by Esc did not pause')

  root.requestFullscreen = async () => {
    throw new Error('no gesture')
  }
  game.ctx.toggleFullscreen()
  await sleep(0)
  ok(keyboard.locks.length === 2 && keyboard.unlocks === 2, `refused: ${keyboard.locks.length} locks, ${keyboard.unlocks} unlocks`)
  game.destroy()
  ok(keyboard.unlocks === 3, 'destroy did not let go')
})

/* ---------------- fitting the picture ---------------- */

await scenario('the app on a 1920x1080 screen (a box that fits x2.25 to x2.28) shows a sharp 2x', async () => {
  // Sidebar open (box 1664 wide), and collapsed with a Windows 10 taskbar (1856 by 820).
  for (const box of [
    { width: 1664, height: 809 },
    { width: 1856, height: 820 },
  ]) {
    const m = mount({ manual: true }, box)
    ok(m.canvas.style.width === '1280px' && m.canvas.width === 1280, `${box.width}x${box.height} box: ${m.canvas.style.width}, store ${m.canvas.width}`)
    m.game.destroy()
  }
  // Further from a whole number the picture keeps its size (x2.3 would lose 13%).
  const at23 = mount({ manual: true }, { width: 1664, height: 828 })
  ok(at23.canvas.style.width === '1472px' && at23.canvas.width === 1920, `x2.3 box: ${at23.canvas.style.width}, store ${at23.canvas.width}`)
  at23.game.destroy()
})

await t.finish()
