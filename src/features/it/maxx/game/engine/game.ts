// The shell: the fixed 60 Hz loop, scene switching, fitting the 640x360 frame to the
// screen, and pausing when the player leaves.
import { MAX_PIPS, START_LIVES, STEP_HZ, VIEW_H, VIEW_W } from '../contract'
import type { AudioApi, GameCtx, InputDevice, InputFrame, Scene, SceneId, SceneParams, Session, Sprites, Transition } from '../contract'
import { createAudio } from '../audio'
import type { MaxxAudio } from '../audio'
import { SCENES } from '../scenes'
import { frameClock } from '../render/clock'
import { installDebug, uninstallDebug } from './debug'
import { createInput } from './input'
import type { ShellInput } from './input'
import { createSave } from './save'
import { emptySprites, loadSprites, missingSheets, warmSheets } from './sprites'
import { bindGlyphs, drawText, wrapText } from './text'

export interface GameOpts {
  /** Whose save to load. */
  userId: string
  /** Dev page: overlays, cheats, and window.__maxx. */
  debug?: boolean
  startScene?: SceneId
  startParams?: SceneParams
  /** The loop does not advance by itself: only step() moves time (tests, screenshots). */
  manual?: boolean
  /** What goes fullscreen. Default: the canvas. */
  fullscreenTarget?: HTMLElement | null
  /** Tests: a stand-in for the audio module. */
  audio?: AudioApi
  onStatus?: (status: GameStatus) => void
}

/** What the page around the canvas shows. A new object every time something changes. */
export interface GameStatus {
  ready: boolean
  scene: SceneId | null
  device: InputDevice
  gamepadConnected: boolean
  padName: string
  muted: boolean
  fullscreen: boolean
  canFullscreen: boolean
  /** The browser is still waiting for a key press or click before it plays sound. */
  audioLocked: boolean
}

/** The contract's GameCtx plus what this shell adds. Scenes receive this object. */
export interface ShellCtx extends GameCtx {
  readonly input: ShellInput
}

export interface GameHandle {
  readonly ctx: ShellCtx
  /** Sprites are loaded and the first frame is on screen. */
  readonly ready: boolean
  readonly whenReady: Promise<void>
  readonly status: GameStatus
  /** Everything a scene has thrown, newest last. */
  readonly errors: readonly string[]
  readonly sceneId: SceneId | null
  scene(): Scene | null
  /** Run n ticks now and draw. */
  step(n?: number): void
  readonly manual: boolean
  setManual(on: boolean): void
  setMuted(on: boolean): void
  /** Call from a click or tap so the browser lets sound start. */
  unlockAudio(): void
  subscribe(fn: (status: GameStatus) => void): () => void
  /** Stops everything. Safe to call twice. */
  destroy(): void
}

const STEP_MS = 1000 / STEP_HZ
// A screen clearly faster than the simulation gets frames between ticks, drawn part of the way
// from one tick to the next (render/clock.ts). At 60 Hz every frame has its own tick: left off.
const BETWEEN_HZ = 65
// The screen's rate is the median of this many frame gaps, so one slow frame does not flip it.
const RATE_SAMPLES = 15
// A frame that arrives a hair early still gets its tick, so a 60 Hz screen runs one tick per frame.
const STEP_SLOP_MS = 0.5
const MAX_STEPS = 5
// A scene's enter() may send the game straight on. This many in one tick, then the rest waits a tick.
const MAX_HOPS = 4
// Longer than this between frames was a stall or a hidden tab, not time to catch up on.
const STALL_MS = 200
const FADE_TICKS = 12
const IRIS_TICKS = 22
const MAX_SUPERSAMPLE = 8
// Give up a little size for a whole-number scale, where every game pixel is the same size.
// 0.875 and not 0.9: the game in the app on a 1920x1080 screen at 100% fits x2.25 to x2.28
// (taskbar, sidebar open or collapsed), which then shows a sharp 2x instead of a soft picture.
const WHOLE_SCALE_MIN = 0.875
const MUTE_KEY = 'smm.muted'
// Without controller input for this long, the screen may sleep again.
const WAKE_IDLE_TICKS = 2 * 60 * STEP_HZ

// The text module looks prompts up through one input at a time: the newest game's.
let glyphOwner: object | null = null

type Target = { id: SceneId; params: SceneParams }
type Cover = { kind: 'fade' | 'iris'; phase: 'out' | 'in'; t: number; len: number; to: Target }
type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean }
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => void }
type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void }

const keyboardLock = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard

// In fullscreen Chrome and Edge spend a tapped Esc on leaving it, so every {cancel} prompt (drawn
// as ESC) would throw a keyboard player out instead. Locked, a tap reaches the game and holding
// Esc still leaves (the browser says so). The lock only works while the page is fullscreen.
function lockEsc(): void {
  try {
    void keyboardLock()?.lock?.(['Escape'])?.catch(() => {})
  } catch {
    // No Keyboard Lock (Firefox, Safari): Esc leaves fullscreen and onFullscreen pauses.
  }
}
// Also on the way out: a lock left behind would make the app's other fullscreen views need a held Esc.
function unlockEsc(): void {
  try {
    keyboardLock()?.unlock?.()
  } catch {
    // Nothing was locked.
  }
}

function idleFrame(device: InputDevice): InputFrame {
  const none = () => ({ left: false, right: false, up: false, down: false, jump: false, spray: false, confirm: false, cancel: false, pause: false, select: false })
  return { held: none(), pressed: none(), released: none(), repeat: none(), axisX: 0, axisY: 0, device }
}

function freshSession(): Session {
  return { lives: START_LIVES, score: 0, coins: 0, pips: MAX_PIPS, turbo: false }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The audio module as scenes see it. The shell and the scene both pause and both set
 * volumes; this keeps their wishes apart, and keeps a throw in the sound code out of the game.
 */
function gateAudio(real: AudioApi) {
  // What the audio module offers beyond the contract. A test stand-in may have none of it.
  const extra = real as Partial<MaxxAudio>
  let scenePaused = false
  let shellPaused = false
  let muted = false
  let music = 0.7
  let sfx = 0.8
  let sceneNo = 0
  let warned = false
  const safe = (fn: () => void) => {
    try {
      fn()
    } catch (err) {
      if (!warned) console.warn('[maxx] audio', err)
      warned = true
    }
  }
  const applyPause = () => safe(() => real.setPaused(scenePaused || shellPaused))
  const applyVolumes = () => safe(() => real.setVolumes(muted ? 0 : music, muted ? 0 : sfx))
  // A stand-in written before stopJingle existed simply has none.
  const stopJingle = (o?: { resume?: boolean }) => safe(() => (real as Partial<AudioApi>).stopJingle?.(o))
  const api: AudioApi & Pick<MaxxAudio, 'preload'> & Partial<Pick<MaxxAudio, 'debug' | 'meter'>> = {
    preload: (ids) => safe(() => extra.preload?.(ids)),
    debug: extra.debug ? () => extra.debug!() : undefined,
    meter: extra.meter ? (at) => extra.meter!(at) : undefined,
    unlock: () => safe(() => real.unlock()),
    get locked() {
      try {
        return real.locked
      } catch {
        return false
      }
    },
    sfx: (id) => {
      if (!shellPaused) safe(() => real.sfx(id))
    },
    spray: (on) => safe(() => real.spray(on)),
    music: (id, o) => safe(() => real.music(id, o)),
    jingle(id, o) {
      const done = o?.onDone
      const asked = sceneNo
      // The tune may outlast the scene that asked for it. Its callback must not: it would act for a scene that is gone.
      safe(() => real.jingle(id, done ? { ...o, onDone: () => void (asked === sceneNo && done()) } : o))
    },
    stopJingle,
    setTempoScale: (scale) => safe(() => real.setTempoScale(scale)),
    setVolumes(m, s) {
      music = m
      sfx = s
      applyVolumes()
    },
    setPaused(paused) {
      scenePaused = paused
      applyPause()
    },
    // The shell owns the audio; a scene cannot take it down.
    destroy() {},
  }
  return {
    api,
    get muted() {
      return muted
    },
    setMuted(on: boolean) {
      muted = on
      applyVolumes()
    },
    setShellPaused(on: boolean) {
      shellPaused = on
      applyPause()
    },
    /** A new scene starts from a clean slate, whatever the last one left switched on. */
    sceneChanged() {
      sceneNo++
      scenePaused = false
      // A jingle of the scene just left (the new sceneNo has cut off its onDone) would play on
      // over the next one and hold back its song. Stopped before the unpause, so a jingle a
      // pause menu was holding never sounds again.
      stopJingle()
      applyPause()
      safe(() => real.spray(false))
      safe(() => real.setTempoScale(1))
    },
    destroy: () => safe(() => real.destroy()),
  }
}

export function createGame(canvas: HTMLCanvasElement, opts: GameOpts): GameHandle {
  const debug = !!opts.debug
  const buffer = document.createElement('canvas')
  buffer.width = VIEW_W
  buffer.height = VIEW_H
  const g = buffer.getContext('2d', { alpha: false })
  const screen = canvas.getContext('2d', { alpha: false })
  if (!g || !screen) throw new Error('Super Mighty Maxx needs a 2D canvas')
  g.imageSmoothingEnabled = false

  const errors: string[] = []
  const listeners = new Set<(s: GameStatus) => void>()
  let destroyed = false
  let ready = false
  let manual = !!opts.manual
  let tickNo = 0
  let scene: Scene | null = null
  let sceneId: SceneId | null = null
  // Entered but not updated yet: the contract promises render comes after update.
  let sceneFresh = true
  let cut: Target | null = null
  let cover: Cover | null = null
  // Which half of a switch is running: the old scene's exit(), or the new one's enter().
  let switching: '' | 'leaving' | 'entering' = ''
  let iris = { x: VIEW_W / 2, y: VIEW_H / 2 }
  let autoPause = false
  let wantPause = false
  let away = document.visibilityState !== 'visible' || !document.hasFocus()
  let exitingFullscreen = false
  let wasFullscreen = false
  let raf = 0
  let lastTime = -1
  let acc = 0
  const gaps = new Float64Array(RATE_SAMPLES)
  const gapsSorted = new Float64Array(RATE_SAMPLES)
  let gapN = 0
  let between = false
  let fps = 0
  let fpsFrames = 0
  let fpsSince = 0
  let loaded: Sprites = emptySprites()

  const gate = gateAudio(opts.audio ?? createAudio())
  const save = createSave(opts.userId)
  const session = freshSession()

  const fsTarget = (): FullscreenEl => opts.fullscreenTarget ?? canvas
  const fsElement = (): Element | null => {
    const d = document as FullscreenDoc
    return d.fullscreenElement ?? d.webkitFullscreenElement ?? null
  }
  const isFullscreen = (): boolean => fsElement() === fsTarget()
  const canFullscreen = (): boolean => {
    const d = document as FullscreenDoc
    const el = fsTarget()
    return !!(d.fullscreenEnabled ?? d.webkitFullscreenEnabled) && !!(el.requestFullscreen ?? el.webkitRequestFullscreen)
  }
  const toggleFullscreen = () => {
    if (destroyed) return
    const d = document as FullscreenDoc
    try {
      if (fsElement()) {
        exitingFullscreen = true
        const done: unknown = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()
        if (done instanceof Promise) done.catch(() => {})
      } else {
        const el = fsTarget()
        // Asked for first, so the first Esc in fullscreen already reaches the game.
        lockEsc()
        const done: unknown = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.()
        // Refused without a key press or click behind it (whether a controller button counts is up to the browser).
        if (done instanceof Promise) done.catch(() => unlockEsc())
      }
    } catch {
      exitingFullscreen = false
    }
  }

  // The operating system does not count a controller as activity, so the screen would dim
  // in the middle of a level. Hold it awake while the controller is being played.
  let wake: WakeLockSentinel | null = null
  let wakeBusy = false
  let wakeRefused = false
  let padUsedAt = 0
  const keepAwake = () => {
    padUsedAt = tickNo
    const locks = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock
    if (wake || wakeBusy || wakeRefused || destroyed || !locks || document.visibilityState !== 'visible') return
    wakeBusy = true
    locks.request('screen').then(
      (lock) => {
        wakeBusy = false
        if (destroyed) return void lock.release().catch(() => {})
        wake = lock
        // The browser lets go by itself when the tab is hidden; the next button press asks again.
        lock.addEventListener('release', () => {
          if (wake === lock) wake = null
        })
      },
      () => {
        wakeBusy = false
        wakeRefused = true
      },
    )
  }
  const letSleep = () => {
    const lock = wake
    wake = null
    lock?.release().catch(() => {})
  }

  const setMuted = (on: boolean) => {
    gate.setMuted(on)
    try {
      localStorage.setItem(MUTE_KEY, on ? '1' : '0')
    } catch {
      // Not remembered, that is all.
    }
    publish()
  }

  // The title says PRESS ANY KEY FOR SOUND and M is a key: the press that unlocks the sound must not
  // also mute it (and save the mute). onGesture runs just before onSystemKey for the same key.
  let pressUnlocked = false
  const input = createInput({
    onSystemKey: (key) => {
      if (key === 'fullscreen') toggleFullscreen()
      else if (!pressUnlocked) setMuted(!gate.muted)
    },
    onGesture: (device) => {
      pressUnlocked = gate.api.locked
      gate.api.unlock()
      if (device === 'gamepad') keepAwake()
      // Played from a window that is visible but not focused: that is still playing.
      if (away) comeBack()
    },
    // Flat battery, or switched off: the same as walking away, until any button is pressed again.
    onPadLost: () => leave(),
    onStatus: () => publish(),
  })

  const sprites: Sprites = {
    has: (name) => loaded.has(name),
    draw: (ctx2d, name, x, y, o) => loaded.draw(ctx2d, name, x, y, o),
    frame: (name) => loaded.frame(name),
    source: (name) => loaded.source(name),
    anim: (atlas, anim) => loaded.anim(atlas, anim),
    atlas: (name) => loaded.atlas(name),
  }

  const coverLevel = (): number => (cover ? (cover.phase === 'out' ? cover.t / cover.len : 1 - cover.t / cover.len) : 0)

  const ctx: ShellCtx = {
    audio: gate.api,
    input,
    sprites,
    save,
    session,
    debug,
    get tick() {
      return tickNo
    },
    get transitioning() {
      return cut !== null || cover !== null
    },
    get fullscreen() {
      return isFullscreen()
    },
    get autoPause() {
      return autoPause
    },
    get fps() {
      return fps
    },
    get muted() {
      return gate.muted
    },
    setMuted,
    applySettings() {
      const st = save.data.settings
      gate.api.setVolumes(st.music / 10, st.sfx / 10)
      input.setRumbleEnabled(st.rumble)
    },
    toggleFullscreen,
    irisAt(x, y) {
      iris = { x: Math.round(x), y: Math.round(y) }
    },
    resetSession() {
      Object.assign(session, freshSession())
    },
    go(id, params = {}, transition: Transition = 'fade') {
      // A scene on its way out has no say in where the game goes next.
      if (destroyed || switching === 'leaving') return
      const to: Target = { id, params }
      if (transition === 'cut') {
        cut = to
        // From enter(), behind a cover: the cover stays shut and opens on the scene after this one.
        if (switching !== 'entering') cover = null
        return
      }
      const len = transition === 'iris' ? IRIS_TICKS : FADE_TICKS
      // Asked for while the screen is still partly covered: carry on from there.
      const from = Math.round(coverLevel() * len)
      cut = null
      cover = { kind: transition, phase: 'out', t: from, len, to }
    },
  }

  let status: GameStatus = snapshot()
  function snapshot(): GameStatus {
    return {
      ready,
      scene: sceneId,
      device: input.device,
      gamepadConnected: input.gamepadConnected,
      padName: input.padName,
      muted: gate.muted,
      fullscreen: isFullscreen(),
      canFullscreen: canFullscreen(),
      audioLocked: gate.api.locked,
    }
  }
  function publish() {
    if (destroyed) return
    const next = snapshot()
    const keys = Object.keys(next) as Array<keyof GameStatus>
    if (keys.every((k) => next[k] === status[k])) return
    status = next
    opts.onStatus?.(next)
    for (const fn of listeners) fn(next)
  }

  /* ---------------- scenes ---------------- */

  const crashScene = (message: string): Scene => ({
    update(game, f) {
      if (f.pressed.confirm) game.go('title', {}, 'cut')
    },
    render(_game, c) {
      c.fillStyle = '#16161d'
      c.fillRect(0, 0, VIEW_W, VIEW_H)
      try {
        drawText(c, 'SOMETHING BROKE', VIEW_W / 2, 96, { scale: 3, align: 'center', color: '#ff6b6b' })
        if (debug) drawText(c, wrapText(message, VIEW_W - 64).slice(0, 10).join('\n'), 32, 150, { color: '#d6dae3' })
        drawText(c, 'PRESS {confirm} TO GO BACK TO THE TITLE', VIEW_W / 2, 300, { align: 'center', color: '#ffe866' })
      } catch {
        // This screen must not be the next thing to break: a blank one still takes the button.
      }
    },
  })

  const startAt: Target = { id: opts.startScene ?? 'title', params: opts.startParams ?? {} }

  // A sprite sheet did not arrive (a dropped connection, or a deploy took the old files away).
  // Without it the game would run with things missing and no word why. Text needs no sheet.
  const missingArtScene = (): Scene => {
    let trying = false
    const self: Scene = {
      update(_game, f) {
        if (trying || !f.pressed.confirm) return
        trying = true
        loadSprites().then(
          (all) => {
            trying = false
            if (destroyed || scene !== self || missingSheets(all).length) return
            loaded = all
            warmSheets(g)
            ctx.go(startAt.id, startAt.params, 'fade')
          },
          () => {
            trying = false
          },
        )
      },
      render(_game, c) {
        c.fillStyle = '#16161d'
        c.fillRect(0, 0, VIEW_W, VIEW_H)
        try {
          drawText(c, 'THE PICTURES DID NOT LOAD', VIEW_W / 2, 110, { scale: 2, align: 'center', color: '#ff6b6b' })
          drawText(c, 'IF THIS KEEPS HAPPENING, RELOAD THE PAGE', VIEW_W / 2, 170, { align: 'center', color: '#d6dae3' })
          drawText(c, trying ? 'LOADING' : 'PRESS {confirm} TO TRY AGAIN', VIEW_W / 2, 300, { align: 'center', color: '#ffe866' })
        } catch {
          // A blank screen still takes the button.
        }
      },
    }
    return self
  }

  function fail(err: unknown, where: string) {
    const message = `${where}: ${err instanceof Error ? err.message : String(err)}`
    errors.push(message)
    if (errors.length > 20) errors.shift()
    console.error(`[maxx] ${where}`, err)
    const old = scene
    scene = null
    cut = null
    leaveScene(old, () => {})
    gate.sceneChanged()
    scene = crashScene(message)
    sceneFresh = true
  }

  function leaveScene(old: Scene | null, onError: (err: unknown) => void) {
    if (!old) return
    switching = 'leaving'
    try {
      old.exit?.(ctx)
    } catch (err) {
      onError(err)
    }
    switching = ''
  }

  function switchTo(to: Target) {
    const old = scene
    scene = null
    leaveScene(old, (err) => console.error(`[maxx] ${sceneId} exit`, err))
    gate.sceneChanged()
    sceneId = to.id
    try {
      const make = Object.prototype.hasOwnProperty.call(SCENES, to.id) ? SCENES[to.id] : null
      if (!make) throw new Error(`there is no scene called "${to.id}"`)
      const next = make()
      switching = 'entering'
      next.enter?.(ctx, to.params)
      switching = ''
      // enter() took the whole game down (the page was closed from inside it).
      if (destroyed) return leaveScene(next, () => {})
      scene = next
      sceneFresh = true
    } catch (err) {
      switching = ''
      fail(err, `${to.id} enter`)
    }
  }

  // enter() may cut straight on to another scene: follow it now, so the one in between is never drawn.
  function followCuts() {
    for (let hops = 0; cut && hops < MAX_HOPS && !destroyed; hops++) {
      const to = cut
      cut = null
      switchTo(to)
    }
  }

  function tick() {
    if (destroyed) return
    tickNo++
    frameClock.tick = tickNo
    if (cut) {
      followCuts()
    } else if (cover && cover.phase === 'out' && cover.t >= cover.len) {
      const c = cover
      switchTo(c.to)
      followCuts()
      // enter() may have started another transition already.
      if (cover === c) {
        c.phase = 'in'
        c.t = 0
      }
    }
    const covered = cut !== null || cover !== null
    autoPause = false
    if (wantPause && !covered) {
      wantPause = false
      autoPause = true
      input.inject('pause')
    }
    const real = input.poll()
    // Behind a transition scenes get no input, so nothing is picked twice.
    const frame = covered ? idleFrame(real.device) : real
    const s = scene
    if (s) {
      try {
        s.update(ctx, frame)
        if (scene === s) sceneFresh = false
      } catch (err) {
        fail(err, `${sceneId} update`)
      }
    }
    autoPause = false
    if (wake && tickNo - padUsedAt > WAKE_IDLE_TICKS) letSleep()
    if (cover) {
      cover.t++
      if (cover.phase === 'in' && cover.t >= cover.len) {
        cover = null
        iris = { x: VIEW_W / 2, y: VIEW_H / 2 }
      }
    }
    publish()
  }

  /* ---------------- drawing ---------------- */

  function drawCover() {
    if (!cover || !g) return
    const k = coverLevel()
    if (k <= 0) return
    g.fillStyle = '#000'
    if (cover.kind === 'fade') {
      // Four steps, like a palette fade.
      g.globalAlpha = Math.min(1, Math.ceil(k * 4) / 4)
      g.fillRect(0, 0, VIEW_W, VIEW_H)
      g.globalAlpha = 1
      return
    }
    const far = Math.hypot(Math.max(iris.x, VIEW_W - iris.x), Math.max(iris.y, VIEW_H - iris.y))
    const r = Math.round((1 - k) * far)
    if (r <= 0) {
      g.fillRect(0, 0, VIEW_W, VIEW_H)
      return
    }
    // Row by row, so the hole has hard pixel edges.
    const top = Math.max(0, iris.y - r)
    const bottom = Math.min(VIEW_H, iris.y + r)
    if (top > 0) g.fillRect(0, 0, VIEW_W, top)
    if (bottom < VIEW_H) g.fillRect(0, bottom, VIEW_W, VIEW_H - bottom)
    for (let y = top; y < bottom; y++) {
      const dy = y + 0.5 - iris.y
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)))
      if (iris.x - half > 0) g.fillRect(0, y, iris.x - half, 1)
      if (iris.x + half < VIEW_W) g.fillRect(iris.x + half, y, VIEW_W - iris.x - half, 1)
    }
  }

  function present() {
    if (!screen) return
    screen.drawImage(buffer, 0, 0, canvas.width, canvas.height)
  }

  function draw() {
    if (!g) return
    const s = scene
    if (s && !sceneFresh) {
      g.save()
      try {
        s.render(ctx, g)
      } catch (err) {
        fail(err, `${sceneId} render`)
      }
      g.restore()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.globalAlpha = 1
      drawCover()
    } else if (!s) {
      g.fillStyle = '#16161d'
      g.fillRect(0, 0, VIEW_W, VIEW_H)
      try {
        drawText(g, 'LOADING', VIEW_W / 2, VIEW_H / 2 - 8, { scale: 2, align: 'center', color: '#a9afbd' })
      } catch {
        // The plain background will do.
      }
    }
    present()
  }

  /**
   * Sizes the canvas to the largest 16:9 box that fits its parent. The backing store is a
   * whole multiple of 640x360 at least as large as the box in device pixels, filled without
   * smoothing; the browser then scales that down, so game pixels stay even at any size.
   */
  function layout() {
    const box = canvas.parentElement
    if (!box || destroyed) return
    const rect = box.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    // The inside of the box, from its rectangle: clientWidth is a whole number of CSS pixels,
    // and neither a full screen at 110% zoom or 175% display scaling nor a box under a
    // 42.5px header is one.
    const x0 = rect.left + box.clientLeft
    const y0 = rect.top + box.clientTop
    const x1 = x0 + rect.width - (box.offsetWidth - box.clientWidth)
    const y1 = y0 + rect.height - (box.offsetHeight - box.clientHeight)
    // The whole device pixels inside it. Layout works in 64ths of a CSS pixel, so an edge
    // that is really on pixel 1920 can read 1919.98: hence the slack.
    const slack = 0.1
    const devX = Math.ceil(x0 * dpr - slack)
    const devY = Math.ceil(y0 * dpr - slack)
    const boxW = Math.floor(x1 * dpr + slack) - devX
    const boxH = Math.floor(y1 * dpr + slack) - devY
    if (boxW <= 0 || boxH <= 0) return
    const fit = Math.min(boxW / VIEW_W, boxH / VIEW_H)
    const whole = Math.floor(fit + 1e-6)
    const scale = whole >= 1 && whole / fit >= WHOLE_SCALE_MIN ? whole : fit
    const devW = Math.max(1, Math.floor(VIEW_W * scale + 1e-6))
    const devH = Math.max(1, Math.floor(VIEW_H * scale + 1e-6))
    const k = Math.max(1, Math.min(MAX_SUPERSAMPLE, Math.ceil(scale - 1e-6)))
    if (canvas.width !== VIEW_W * k || canvas.height !== VIEW_H * k) {
      canvas.width = VIEW_W * k
      canvas.height = VIEW_H * k
    }
    if (screen) screen.imageSmoothingEnabled = false
    canvas.style.position = 'absolute'
    // Past the largest backing store (a 6K screen) the browser scales up: keep that hard-edged too.
    canvas.style.imageRendering = k < scale ? 'pixelated' : ''
    canvas.style.width = `${devW / dpr}px`
    canvas.style.height = `${devH / dpr}px`
    // Centred, and on whole device pixels: half a pixel off would blur every edge.
    canvas.style.left = `${(devX + Math.floor((boxW - devW) / 2)) / dpr - x0}px`
    canvas.style.top = `${(devY + Math.floor((boxH - devH) / 2)) / dpr - y0}px`
    present()
  }

  /* ---------------- the loop ---------------- */

  function frame(now: number) {
    if (destroyed) return
    raf = requestAnimationFrame(frame)
    // Stepped by hand: step() draws, and a resize re-presents the last frame by itself.
    if (!ready || manual) return
    let dt = lastTime < 0 ? STEP_MS : now - lastTime
    if (lastTime >= 0 && dt > 0 && dt < 100) {
      gaps[gapN % RATE_SAMPLES] = dt
      if (++gapN % RATE_SAMPLES === 0) {
        gapsSorted.set(gaps)
        gapsSorted.sort()
        between = 1000 / gapsSorted[RATE_SAMPLES >> 1] > BETWEEN_HZ
      }
    }
    lastTime = now
    if (dt < 0 || dt > STALL_MS) dt = STEP_MS
    acc += dt
    let n = 0
    while (acc >= STEP_MS - STEP_SLOP_MS && n < MAX_STEPS) {
      tick()
      acc -= STEP_MS
      n++
    }
    // A scene closed the game from inside its update.
    if (destroyed) return
    // Could not keep up: slow down rather than spiral.
    if (acc > STEP_MS) acc = 0
    // A frame with no tick (a screen above 60 Hz) would show the picture already there; drawn
    // between the last two ticks instead (render/clock.ts), every frame moves. On a 60 Hz screen
    // only frames with a tick draw. A resize presents by itself (layout).
    if (n > 0 || between) {
      if (between) frameClock.alpha = Math.min(1, Math.max(0, acc / STEP_MS))
      draw()
      frameClock.alpha = 1
      fpsFrames++
    }
    if (now - fpsSince >= 500) {
      fps = Math.round((fpsFrames * 1000) / (now - fpsSince))
      fpsFrames = 0
      fpsSince = now
    }
  }

  /* ---------------- leaving and coming back ---------------- */

  function leave() {
    if (destroyed || away) return
    away = true
    gate.setShellPaused(true)
    if (ready && !manual) wantPause = true
  }
  function comeBack() {
    if (destroyed || !away || document.visibilityState !== 'visible') return
    away = false
    gate.setShellPaused(false)
    // No catching up on the time spent away.
    lastTime = -1
    acc = 0
  }
  // Focus on something of the app's outside the game (the Ctrl-K palette, the sidebar after
  // Shift+Tab): the keys go there, so the window keeps its focus but the player has left.
  const outsideGame = (el: unknown): boolean =>
    typeof Element !== 'undefined' && el instanceof Element && el !== document.body && el !== document.documentElement && !fsTarget().contains(el)
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') leave()
    else if (document.hasFocus() && !outsideGame(document.activeElement)) comeBack()
  }
  const onBlur = () => leave()
  const onFocus = () => {
    if (!outsideGame(document.activeElement)) comeBack()
  }
  // A key typed there never reaches the game, so it cannot bring the game back; a controller
  // button (onGesture) or focus back on the canvas does. The pause menu stays up either way.
  const onFocusIn = (e: FocusEvent) => {
    if (outsideGame(e.target)) leave()
    else if (e.target === canvas && document.hasFocus()) comeBack()
  }
  const onResize = () => layout()
  const onFullscreen = () => {
    if (destroyed) return
    const on = isFullscreen()
    // A held Esc (a tapped one without Keyboard Lock) leaves fullscreen unseen by the game: treat it as a pause.
    if (wasFullscreen && !on && !exitingFullscreen && ready && !manual) wantPause = true
    if (!on) unlockEsc()
    if (!fsElement()) exitingFullscreen = false
    wasFullscreen = on
    layout()
    publish()
    if (on) canvas.focus({ preventScroll: true })
  }

  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('fullscreenchange', onFullscreen)
  document.addEventListener('webkitfullscreenchange', onFullscreen)
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  window.addEventListener('resize', onResize)
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => layout())
  if (canvas.parentElement) observer?.observe(canvas.parentElement)

  gate.setMuted(readMuted())
  // A volume or rumble change made in another tab takes effect here at once.
  save.onChange = () => ctx.applySettings()
  ctx.applySettings()
  gate.setShellPaused(away)
  layout()
  draw()
  raf = requestAnimationFrame(frame)

  const whenReady = loadSprites()
    .catch((err) => {
      console.warn('[maxx] sprites', err)
      return emptySprites()
    })
    .then((all) => {
      if (destroyed) return
      loaded = all
      bindGlyphs(input)
      glyphOwner = input
      if (missingSheets(all).length) {
        gate.sceneChanged()
        scene = missingArtScene()
        sceneFresh = true
      } else {
        // Decoded now, behind LOADING, rather than in the first frame of each level that shows them.
        warmSheets(g)
        switchTo(startAt)
      }
      // One tick, so there is a frame to show even when time is being stepped by hand.
      tick()
      layout()
      draw()
      ready = true
      publish()
    })

  const handle: GameHandle = {
    ctx,
    whenReady,
    get ready() {
      return ready
    },
    get status() {
      return status
    },
    get errors() {
      return errors
    },
    get sceneId() {
      return sceneId
    },
    scene: () => scene,
    get manual() {
      return manual
    },
    step(n = 1) {
      if (destroyed || !ready) return
      for (let i = Math.max(0, Math.floor(n)); i > 0; i--) tick()
      draw()
    },
    setManual(on) {
      manual = on
      lastTime = -1
      acc = 0
    },
    setMuted,
    unlockAudio() {
      gate.api.unlock()
      publish()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(raf)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('webkitfullscreenchange', onFullscreen)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('resize', onResize)
      save.dispose()
      const old = scene
      scene = null
      try {
        old?.exit?.(ctx)
      } catch {
        // Going away regardless.
      }
      if (glyphOwner === input) {
        glyphOwner = null
        bindGlyphs(null)
      }
      input.destroy()
      gate.destroy()
      letSleep()
      // Unmounted while fullscreen: the browser drops fullscreen after onFullscreen is gone.
      unlockEsc()
      listeners.clear()
      if (import.meta.env.DEV && debug) uninstallDebug(handle)
    },
  }
  // window.__maxx is a dev page tool: the test leaves engine/debug.ts out of a production build.
  if (import.meta.env.DEV && debug) installDebug(handle)
  return handle
}
