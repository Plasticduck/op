// Keyboard, Xbox controller and touch buttons, merged into one InputFrame per tick.
import { ACTIONS } from '../contract'
import type { Action, ActionState, GlyphId, InputApi, InputDevice, InputFrame } from '../contract'

/** Keys that are not game actions. The shell acts on them inside the key event, because fullscreen needs the gesture. */
export type SystemKey = 'fullscreen' | 'mute'

export interface InputOpts {
  onSystemKey?: (key: SystemKey) => void
  /** A real key, pad button or touch went down. The shell unlocks audio on it. */
  onGesture?: (device: InputDevice) => void
  /** The controller being played with went away. */
  onPadLost?: () => void
  /** device, gamepadConnected or padName changed (for the page's header). */
  onStatus?: () => void
}

/** What the shell, the page and the tests use on top of the contract's InputApi. */
export interface ShellInput extends InputApi {
  /** On-screen buttons. One call per action a button stands for. */
  setTouch(action: Action, down: boolean): void
  /** A finger went down on the game somewhere other than a button: touch is the device in use. */
  touchUsed(): void
  /** A press lasting one tick that no device made (the shell's auto pause). Survives clear(), and reads as pressed even if the action was already held. */
  inject(action: Action): void
  /** Scripted input for tests: held until release(). axis overrides the analog values. */
  hold(actions: readonly Action[], axis?: { x?: number; y?: number }): void
  release(): void
  /** What a script is holding right now. */
  readonly scripted: readonly Action[]
  /** Let go of every key and touch button (the window lost focus). */
  clear(): void
  /** The frame the last poll() returned. */
  readonly last: InputFrame
  /** Short name of the controller in use, '' without one. */
  readonly padName: string
  readonly rumbleEnabled: boolean
  /** Also takes 'move' for the whole D-pad / arrow cluster. */
  glyph(action: Action | 'move'): GlyphId
}

/** Menus: a held direction repeats after this many ticks, then at this interval. */
export const REPEAT_DELAY = 20
export const REPEAT_EVERY = 7

export const STICK_DEADZONE = 0.3
/** A stick direction switches on above deadzone + this and off below deadzone - this. */
export const STICK_HYSTERESIS = 0.05
/** Up and down need a firmer push, so running does not aim the gun or start a hover by accident. */
export const STICK_Y_ON = 0.5
export const STICK_Y_OFF = 0.4
// A stick pushed fully into a corner reads about 0.71 on each axis. That must still be
// full speed, or running while aiming up would be slower on the stick than on the D-pad.
const STICK_FULL = 0.7
export const TRIGGER_ON = 0.45
export const TRIGGER_OFF = 0.3

const KEYS: Record<string, readonly Action[]> = {
  ArrowLeft: ['left'],
  KeyA: ['left'],
  ArrowRight: ['right'],
  KeyD: ['right'],
  ArrowUp: ['up'],
  KeyW: ['up'],
  ArrowDown: ['down'],
  KeyS: ['down'],
  KeyZ: ['jump', 'confirm'],
  Space: ['jump', 'confirm'],
  KeyK: ['jump'],
  KeyX: ['spray'],
  KeyJ: ['spray'],
  ShiftLeft: ['spray'],
  ShiftRight: ['spray'],
  Enter: ['pause', 'confirm'],
  NumpadEnter: ['pause', 'confirm'],
  Escape: ['pause', 'cancel'],
  KeyP: ['pause'],
  Backspace: ['cancel'],
  Tab: ['select'],
}

const SYSTEM_KEYS: Record<string, SystemKey> = { KeyF: 'fullscreen', KeyM: 'mute' }

// Standard mapping (what Chrome and Edge give an Xbox controller).
const PAD_BUTTONS: ReadonlyArray<readonly [number, readonly Action[]]> = [
  [0, ['jump', 'confirm']], // A
  [1, ['spray', 'cancel']], // B
  [2, ['spray']], // X
  [5, ['spray']], // RB
  [8, ['select']], // View
  [9, ['pause', 'confirm']], // Menu
  [12, ['up']],
  [13, ['down']],
  [14, ['left']],
  [15, ['right']],
]
const PAD_RT = 7
// A pad with no mapping that looks like a raw Xbox driver (8 axes, D-pad on the last two,
// View and Menu on 6 and 7, triggers on axes). Its triggers are left alone: they read 0
// until first pulled, which would look half pressed.
const RAW_BUTTONS: ReadonlyArray<readonly [number, readonly Action[]]> = [
  [0, ['jump', 'confirm']],
  [1, ['spray', 'cancel']],
  [2, ['spray']],
  [5, ['spray']],
  [6, ['select']],
  [7, ['pause', 'confirm']],
]

// The ids engine/text.ts draws (its header lists them all). Exported for the level lint, which
// wraps every sign as each device would show it.
export const GLYPHS: Record<InputDevice, Record<Action | 'move', GlyphId>> = {
  gamepad: {
    move: 'pad_dpad',
    left: 'pad_dpad_left',
    right: 'pad_dpad_right',
    up: 'pad_dpad_up',
    down: 'pad_dpad_down',
    jump: 'pad_a',
    spray: 'pad_x',
    confirm: 'pad_a',
    cancel: 'pad_b',
    pause: 'pad_start',
    select: 'pad_back',
  },
  keyboard: {
    move: 'key_ARROWS',
    left: 'key_LEFT',
    right: 'key_RIGHT',
    up: 'key_UP',
    down: 'key_DOWN',
    jump: 'key_Z',
    spray: 'key_X',
    confirm: 'key_ENTER',
    cancel: 'key_ESC',
    pause: 'key_ENTER',
    select: 'key_TAB',
  },
  touch: {
    move: 'touch_dpad',
    left: 'touch_left',
    right: 'touch_right',
    up: 'touch_up',
    down: 'touch_down',
    jump: 'touch_a',
    spray: 'touch_b',
    confirm: 'touch_a',
    cancel: 'touch_b',
    pause: 'touch_pause',
    select: 'touch_pause',
  },
}

// Keys pressed while one of these has focus, or focus is inside an open dialog, belong there, not to the game.
const OWN_KEYS =
  'input, textarea, select, button, a[href], summary, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], ' +
  '[role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="textbox"], [role="combobox"], [role="slider"], [role="switch"], ' +
  'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]'

function blank(): ActionState {
  return { left: false, right: false, up: false, down: false, jump: false, spray: false, confirm: false, cancel: false, pause: false, select: false }
}

function ownsKeys(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  return target.closest(OWN_KEYS) !== null
}

// The game's canvas is the only one on its page that takes focus.
function onGame(target: EventTarget | null): boolean {
  return typeof HTMLCanvasElement !== 'undefined' && target instanceof HTMLCanvasElement
}

interface PadMem {
  id: string
  /**
   * False for a device without the standard layout until it has been seen at rest. Whatever
   * such a device holds when it shows up is how it sits (a wheel, a throttle), not a press.
   */
  live: boolean
  /** How many of its buttons are down, mapped to an action or not. */
  downCount: number
  /** Buttons and D-pad: digital. */
  buttons: ActionState
  /** Buttons, D-pad and stick directions, to spot what went down. */
  all: ActionState
  /** Stick directions, and its values: x analog, y all or nothing (0 while the direction is off). */
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  trigger: boolean
  x: number
  y: number
}

function newPadMem(id: string, live: boolean): PadMem {
  return { id, live, downCount: 0, buttons: blank(), all: blank(), left: false, right: false, up: false, down: false, trigger: false, x: 0, y: 0 }
}

function padLabel(id: string): string {
  const name = id
    .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '')
    .replace(/\s*\(.*$/, '')
    .trim()
  return name || 'Controller'
}

const num = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const axis = (v: number | undefined): number => Math.max(-1, Math.min(1, num(v)))
const clamp01 = (v: number): number => (v > 1 ? 1 : v > 0 ? v : 0)

// Chrome puts a hat switch on one axis: eight positions from -1 (up) clockwise in steps of 2/7, off the scale at rest.
function hat(v: number, out: ActionState): void {
  const n = Math.round((v + 1) * 3.5)
  if (n < 0 || n > 7 || Math.abs(v - (n / 3.5 - 1)) > 0.05) return
  if (n === 7 || n <= 1) out.up = true
  if (n >= 1 && n <= 3) out.right = true
  if (n >= 3 && n <= 5) out.down = true
  if (n >= 5) out.left = true
}

/** Reads one controller into mem. Returns true if something on it went down on this read (any button, mapped or not). */
function readPad(p: Gamepad, m: PadMem): boolean {
  const now = blank()
  const down = (i: number): boolean => {
    const b = p.buttons[i]
    return !!b && (b.pressed || b.value > 0.5)
  }
  const standard = p.mapping === 'standard'
  const raw = !standard && p.axes.length >= 8 && p.buttons.length <= 11
  for (const [i, actions] of raw ? RAW_BUTTONS : PAD_BUTTONS) {
    if (down(i)) for (const a of actions) now[a] = true
  }
  if (!raw) {
    const rt = p.buttons[PAD_RT]
    const v = rt ? Math.max(num(rt.value), rt.pressed && !rt.value ? 1 : 0) : 0
    m.trigger = v >= (m.trigger ? TRIGGER_OFF : TRIGGER_ON)
    if (m.trigger) now.spray = true
  }
  if (!standard) {
    if (raw || p.buttons.length < 16) {
      const dx = num(p.axes[6])
      const dy = num(p.axes[7])
      if (p.axes.length >= 8 && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        if (dx < -0.5) now.left = true
        if (dx > 0.5) now.right = true
        if (dy < -0.5) now.up = true
        if (dy > 0.5) now.down = true
      }
    }
    if (!raw && p.axes.length >= 10) hat(num(p.axes[9]), now)
  }

  const x = axis(p.axes[0])
  const y = axis(p.axes[1])
  const xOn = STICK_DEADZONE + STICK_HYSTERESIS
  const xOff = STICK_DEADZONE - STICK_HYSTERESIS
  m.right = x > (m.right ? xOff : xOn)
  m.left = x < -(m.left ? xOff : xOn)
  m.down = y > (m.down ? STICK_Y_OFF : STICK_Y_ON)
  m.up = y < -(m.up ? STICK_Y_OFF : STICK_Y_ON)
  // The analog value only counts while its direction is on, so the two never disagree.
  const scaled = (v: number) => Math.max(0.01, clamp01((Math.abs(v) - STICK_DEADZONE) / (STICK_FULL - STICK_DEADZONE)))
  m.x = m.right ? scaled(x) : m.left ? -scaled(x) : 0
  // Up and down are switches. An analog value here would cross whatever threshold a
  // reader puts on it a second time, later than the direction itself and without its hysteresis.
  m.y = m.down ? 1 : m.up ? -1 : 0
  m.buttons = now

  const all = { ...now }
  if (m.left) all.left = true
  if (m.right) all.right = true
  if (m.up) all.up = true
  if (m.down) all.down = true
  if (!m.live) {
    if (ACTIONS.some((a) => all[a])) {
      Object.assign(m, newPadMem(m.id, false))
      return false
    }
    m.live = true
  }
  let downCount = 0
  for (const b of p.buttons) if (b && (b.pressed || b.value > 0.5)) downCount++
  let touched = downCount > m.downCount
  m.downCount = downCount
  for (const a of ACTIONS) if (all[a] && !m.all[a]) touched = true
  m.all = all
  return touched
}

export function createInput(opts: InputOpts = {}): ShellInput {
  const win: Window | null = typeof window === 'undefined' ? null : window
  const keys = new Set<string>()
  const touch = blank()
  // Went down since the last poll: a tap shorter than one tick still counts.
  let latch = blank()
  let injected = blank()
  let script: Action[] = []
  let scriptAxis: { x?: number; y?: number } = {}
  let prev = blank()
  const heldFor: Record<Action, number> = { left: 0, right: 0, up: 0, down: 0, jump: 0, spray: 0, confirm: 0, cancel: 0, pause: 0, select: 0 }

  // What the prompts show before any input, and again when the controller in use goes away.
  const home: InputDevice = win?.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'keyboard'
  let device: InputDevice = home
  const pads = new Map<number, PadMem>()
  let padRefs: Array<Gamepad | null> = []
  let active = -1
  let connected = false
  let padName = ''
  let rumbleOn = true
  let destroyed = false
  let last: InputFrame = { held: blank(), pressed: blank(), released: blank(), repeat: blank(), axisX: 0, axisY: 0, device }
  let told = ''

  const tellStatus = () => {
    const sig = `${device}|${connected}|${padName}`
    if (sig === told) return
    told = sig
    opts.onStatus?.()
  }
  const used = (d: InputDevice) => {
    device = d
    opts.onGesture?.(d)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    // Inside a shadow root the event's target is the host element, not the field being typed in.
    const target = typeof e.composedPath === 'function' ? (e.composedPath()[0] ?? e.target) : e.target
    if (ownsKeys(target)) return
    // Shift+Tab stays the browser's: it is the way out of the game for someone on the keyboard.
    if (e.code === 'Tab' && e.shiftKey) return
    // Tab is held only while the game has focus. From the page around it (the body after a click
    // on the app's top bar) it moves through the page as it does everywhere else in the app.
    if (e.code === 'Tab' && !onGame(target)) return
    const sys = SYSTEM_KEYS[e.code]
    if (sys) {
      e.preventDefault()
      if (!e.repeat) {
        used('keyboard')
        opts.onSystemKey?.(sys)
        tellStatus()
      }
      return
    }
    const actions = KEYS[e.code]
    if (!actions) return
    e.preventDefault()
    if (e.repeat || keys.has(e.code)) return
    keys.add(e.code)
    for (const a of actions) latch[a] = true
    used('keyboard')
    tellStatus()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code)
    // With both Shift keys down, only one of them sends its release.
    if (!e.shiftKey) {
      keys.delete('ShiftLeft')
      keys.delete('ShiftRight')
    }
    // macOS swallows the release of anything let go while Command is down.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') keys.clear()
  }

  const clear = () => {
    keys.clear()
    for (const a of ACTIONS) {
      touch[a] = false
      latch[a] = false
    }
  }
  const onBlur = () => clear()
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') clear()
  }

  const getPads = (): Array<Gamepad | null> => {
    try {
      const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null
      return list ? Array.from(list) : []
    } catch {
      return []
    }
  }

  /** Reads every controller. Returns the state of the one in use, or null. */
  const scanPads = (): PadMem | null => {
    padRefs = getPads()
    let any = false
    let touchedNow = -1
    for (let i = 0; i < padRefs.length; i++) {
      const p = padRefs[i]
      if (!p || !p.connected) continue
      any = true
      let m = pads.get(p.index)
      if (!m || m.id !== p.id) {
        m = newPadMem(p.id, p.mapping === 'standard')
        pads.set(p.index, m)
      }
      if (readPad(p, m)) touchedNow = p.index
    }
    for (const index of pads.keys()) {
      const p = padRefs.find((g) => g && g.index === index)
      if (!p || !p.connected) pads.delete(index)
    }
    connected = any
    if (touchedNow >= 0) {
      active = touchedNow
      used('gamepad')
    }
    if (active >= 0 && !pads.has(active)) {
      const wasPlaying = device === 'gamepad'
      active = pads.size ? (pads.keys().next().value ?? -1) : -1
      if (wasPlaying) {
        // Prompts for a controller that is no longer there help nobody.
        if (active < 0) device = home
        opts.onPadLost?.()
      }
    }
    if (active < 0 && pads.size) active = pads.keys().next().value ?? -1
    const m = active >= 0 ? (pads.get(active) ?? null) : null
    padName = m ? padLabel(m.id) : ''
    return m
  }

  const activePad = (): Gamepad | null => padRefs.find((g) => g && g.index === active) ?? null

  const stopRumble = () => {
    try {
      const act = activePad()?.vibrationActuator as (GamepadHapticActuator & { reset?: () => Promise<unknown> }) | null | undefined
      void act?.reset?.()?.catch(() => {})
    } catch {
      /* no rumble on this controller */
    }
  }

  // Chrome only lists a controller once a button on it has been pressed; the event is how the header hears of it.
  const onPadEvent = () => {
    if (destroyed) return
    const before = connected
    padRefs = getPads()
    connected = padRefs.some((g) => g && g.connected)
    if (!connected && before) scanPads()
    tellStatus()
  }

  if (win) {
    win.addEventListener('keydown', onKeyDown)
    win.addEventListener('keyup', onKeyUp)
    win.addEventListener('blur', onBlur)
    win.addEventListener('gamepadconnected', onPadEvent)
    win.addEventListener('gamepaddisconnected', onPadEvent)
    document.addEventListener('visibilitychange', onVisibility)
  }

  const api: ShellInput = {
    poll(): InputFrame {
      const pad = destroyed ? null : scanPads()
      // Everything but the stick is digital, and decides the axis outright.
      const hard = blank()
      for (const code of keys) for (const a of KEYS[code] ?? []) hard[a] = true
      for (const a of ACTIONS) {
        if (latch[a] || injected[a] || touch[a] || pad?.buttons[a]) hard[a] = true
      }
      for (const a of script) hard[a] = true
      const held = { ...hard }
      // The stick only fills an axis nothing digital is using, so held and the axis never disagree.
      if (pad && !hard.left && !hard.right) {
        held.left = pad.left
        held.right = pad.right
      }
      if (pad && !hard.up && !hard.down) {
        held.up = pad.up
        held.down = pad.down
      }
      const forced = injected
      latch = blank()
      injected = blank()

      const pressed = blank()
      const released = blank()
      const repeat = blank()
      for (const a of ACTIONS) {
        if (held[a]) {
          if (!prev[a] || forced[a]) {
            pressed[a] = true
            repeat[a] = true
            heldFor[a] = 0
          } else {
            heldFor[a]++
            if (heldFor[a] >= REPEAT_DELAY && (heldFor[a] - REPEAT_DELAY) % REPEAT_EVERY === 0) repeat[a] = true
          }
        } else if (prev[a]) {
          released[a] = true
        }
      }
      prev = held

      let axisX = hard.left !== hard.right ? (hard.right ? 1 : -1) : hard.left ? 0 : (pad?.x ?? 0)
      let axisY = hard.up !== hard.down ? (hard.down ? 1 : -1) : hard.up ? 0 : (pad?.y ?? 0)
      if (scriptAxis.x !== undefined) axisX = Math.max(-1, Math.min(1, scriptAxis.x))
      if (scriptAxis.y !== undefined) axisY = Math.max(-1, Math.min(1, scriptAxis.y))
      tellStatus()
      last = { held, pressed, released, repeat, axisX, axisY, device }
      return last
    },
    get device() {
      return device
    },
    get gamepadConnected() {
      return connected
    },
    get padName() {
      return padName
    },
    get rumbleEnabled() {
      return rumbleOn
    },
    get last() {
      return last
    },
    get scripted() {
      return script
    },
    rumble(strong, weak, ms) {
      // A controller lying on the desk while the keyboard is played should stay quiet.
      if (!rumbleOn || destroyed || device !== 'gamepad') return
      try {
        const act = activePad()?.vibrationActuator as GamepadHapticActuator | null | undefined
        if (!act || typeof act.playEffect !== 'function') return
        const done = act.playEffect('dual-rumble', {
          startDelay: 0,
          duration: Math.max(0, Math.min(5000, Math.round(num(ms)))),
          strongMagnitude: clamp01(num(strong)),
          weakMagnitude: clamp01(num(weak)),
        })
        void done?.catch?.(() => {})
      } catch {
        /* no rumble on this controller */
      }
    },
    setRumbleEnabled(on) {
      rumbleOn = !!on
      if (!rumbleOn) stopRumble()
    },
    glyph(action) {
      return GLYPHS[device][action] ?? ''
    },
    setTouch(action, down) {
      if (destroyed) return
      if (down && !touch[action]) {
        latch[action] = true
        used('touch')
        tellStatus()
      }
      touch[action] = down
    },
    touchUsed() {
      if (destroyed) return
      used('touch')
      tellStatus()
    },
    inject(action) {
      injected[action] = true
    },
    hold(actions, axis) {
      script = actions.filter((a) => (ACTIONS as readonly string[]).includes(a))
      scriptAxis = axis ?? {}
    },
    release() {
      script = []
      scriptAxis = {}
    },
    clear,
    destroy() {
      if (destroyed) return
      stopRumble()
      destroyed = true
      clear()
      if (win) {
        win.removeEventListener('keydown', onKeyDown)
        win.removeEventListener('keyup', onKeyUp)
        win.removeEventListener('blur', onBlur)
        win.removeEventListener('gamepadconnected', onPadEvent)
        win.removeEventListener('gamepaddisconnected', onPadEvent)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
  }

  return api
}
