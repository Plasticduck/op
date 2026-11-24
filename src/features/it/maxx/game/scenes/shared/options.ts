// The options screen, shared by the title and the pause menu. It draws a panel over
// whatever the scene drew (the caller shades the scene first if it wants to).
//
// MUSIC and SOUND 0..10 (left and right, a blip at the new level), RUMBLE (a test rumble
// when it goes on), SCREEN SHAKE, FULLSCREEN (game.toggleFullscreen, showing the real
// state), ERASE SAVE (asks first, NO under the cursor), BACK. Every change goes straight
// into save.data.settings, is committed, and game.applySettings() puts it into effect.
// The pause menu leaves ERASE SAVE out (`createOptions({ erase: false })`): erasing in the
// middle of a level would let that level's clear land in an empty save, cleared on its own.
//
// Things the player could otherwise be stuck on: a volume change while the page is muted
// unmutes it (a controller cannot reach the mute key), and a fullscreen request the browser
// turns down (it wants a key press or a click, and a controller button is neither) says so
// instead of doing nothing. Sound the browser still holds back for the same reason is named too.
import { VIEW_H, VIEW_W } from '../../contract'
import type { GameCtx, InputDevice, InputFrame } from '../../contract'
import { PAL, createMenu, meter, panel } from '../../engine/ui'
import type { Menu, MenuDrawOpts, MenuItem } from '../../engine/ui'
import { say } from '../title/kit'

export interface Overlay {
  /** Call when it is about to appear. */
  open(game: GameCtx): void
  /** One tick while it is up. False once the player has left it. */
  update(game: GameCtx, input: InputFrame): boolean
  /** Drawn over whatever the scene drew. */
  draw(game: GameCtx, g: CanvasRenderingContext2D): void
}

/** What the options screen also tells a check: the note it shows at its foot ('' for the usual hint). */
export interface OptionsOverlay extends Overlay {
  readonly note: 'refused' | 'erased' | 'locked' | 'muted' | ''
  /** 'list' or the ERASE SAVE question. */
  readonly screen: 'list' | 'erase'
}

const W = 440
const H = 262
const X = (VIEW_W - W) >> 1
const LIST: MenuDrawOpts = { scale: 2, rowHeight: 12, width: W - 76, color: PAL.white, selectedColor: PAL.yellow[2], shadow: PAL.outline }
const ASK: MenuDrawOpts = { scale: 2, rowHeight: 13, color: PAL.white, selectedColor: PAL.yellow[2], shadow: PAL.outline }
const VOLUME = { color: PAL.blue[2], hi: PAL.blue[4], segments: 10 }
const ROWS = ['MUSIC', 'SOUND', 'RUMBLE', 'SCREEN SHAKE', 'FULLSCREEN', 'ERASE SAVE', 'BACK'] as const
const ERASE_ROW = 5
const NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
/** A fullscreen request not answered in this many ticks was turned down. */
const FS_WAIT = 40
const NOTE_TICKS = 240

// Until the first key press, click or tap the browser plays nothing, and a controller button may
// not count: a player who hears nothing looks here, and a volume change here is silent too.
const LOCKED: Record<InputDevice, string> = {
  keyboard: 'THE BROWSER WANTS A CLICK OR A KEY FOR SOUND.',
  gamepad: 'THE BROWSER WANTS A CLICK OR A KEY FOR SOUND.',
  touch: 'TAP THE SCREEN FOR SOUND.',
}
const MUTED: Record<InputDevice, string> = {
  keyboard: 'SOUND IS OFF. {key_M} OR A VOLUME CHANGE TURNS IT ON.',
  gamepad: 'SOUND IS OFF. A VOLUME CHANGE TURNS IT BACK ON.',
  touch: 'SOUND IS OFF. A VOLUME CHANGE TURNS IT BACK ON.',
}
const REFUSED: Record<InputDevice, readonly [string, string]> = {
  keyboard: ['THE BROWSER SAID NO TO FULLSCREEN.', 'TRY {key_F}, OR THE BUTTON ABOVE THE GAME.'],
  gamepad: ['THE BROWSER WANTS A KEY OR A CLICK FOR THIS:', 'PRESS {key_F}, OR THE BUTTON ABOVE THE GAME.'],
  touch: ['THE BROWSER SAID NO TO FULLSCREEN.', 'TRY THE BUTTON ABOVE THE GAME.'],
}

/**
 * Music and sound volume, rumble, screen shake, fullscreen, erase save. Writes save.data.settings
 * and applies them. `erase: false` leaves the ERASE SAVE row out.
 */
export function createOptions(opts: { erase?: boolean } = {}): Overlay {
  const canErase = opts.erase !== false
  // One list row (24 px) shorter without ERASE SAVE.
  const h = canErase ? H : H - 24
  const y = (VIEW_H - h) >> 1
  let game: GameCtx | null = null
  let list: Menu | null = null
  let ask: Menu | null = null
  let screen: 'list' | 'erase' = 'list'
  let open = true
  /** Ticks left on the "SAVE ERASED" note. */
  let erasedT = 0
  /** The fullscreen state asked for and not seen yet, and how long ago. */
  let fsWant: boolean | null = null
  let fsT = 0
  /** Ticks left on the note that the browser turned fullscreen down. */
  let refusedT = 0

  const settings = () => game!.save.data.settings
  const apply = () => {
    game!.save.commit()
    game!.applySettings()
  }
  const onOff = (on: boolean) => (on ? 'ON' : 'OFF')

  function volume(key: 'music' | 'sfx', dir: -1 | 1): boolean {
    const s = settings()
    const v = Math.max(0, Math.min(10, s[key] + dir))
    if (v === s[key]) return false
    s[key] = v
    apply()
    if (game!.muted) game!.setMuted(false)
    // The menu's own blip follows this, already at the new level.
    return true
  }

  function setRumble(on: boolean): boolean {
    const s = settings()
    if (s.rumble === on) return false
    s.rumble = on
    apply()
    if (on) game!.input.rumble(0.55, 0.35, 220)
    return true
  }

  function setShake(on: boolean): boolean {
    const s = settings()
    if (s.shake === on) return false
    s.shake = on
    apply()
    return true
  }

  function setFullscreen(on: boolean): boolean {
    if (game!.fullscreen === on || fsWant !== null) return false
    fsWant = on
    fsT = 0
    refusedT = 0
    game!.toggleFullscreen()
    return true
  }

  function build(g: GameCtx): void {
    const items: MenuItem[] = [
      { label: ROWS[0], value: () => NUMBERS[settings().music], onAdjust: (d) => volume('music', d) },
      { label: ROWS[1], value: () => NUMBERS[settings().sfx], onAdjust: (d) => volume('sfx', d) },
      { label: ROWS[2], value: () => onOff(settings().rumble), onAdjust: (d) => setRumble(d > 0), onSelect: () => void setRumble(!settings().rumble) },
      { label: ROWS[3], value: () => onOff(settings().shake), onAdjust: (d) => setShake(d > 0), onSelect: () => void setShake(!settings().shake) },
      { label: ROWS[4], value: () => onOff(game!.fullscreen), onAdjust: (d) => setFullscreen(d > 0), onSelect: () => void setFullscreen(!game!.fullscreen) },
    ]
    if (canErase) items.push({ label: ROWS[5], onSelect: () => showErase() })
    items.push({ label: ROWS[6], onSelect: () => void (open = false) })
    list = createMenu({ audio: g.audio, wrap: true, items, onCancel: () => void (open = false) })
    ask = createMenu({
      audio: g.audio,
      wrap: false,
      items: [
        { label: 'NO', onSelect: () => backToList() },
        { label: 'YES, ERASE', onSelect: () => erase() },
      ],
      onCancel: () => backToList(),
    })
  }

  function showErase(): void {
    screen = 'erase'
    ask!.reset(0)
  }

  function backToList(): void {
    screen = 'list'
    list!.reset(ERASE_ROW)
  }

  function erase(): void {
    // Progress only: reset() keeps the settings.
    game!.save.reset()
    erasedT = 150
    refusedT = 0
    backToList()
  }

  const overlay: OptionsOverlay = {
    get note() {
      return refusedT > 0 ? 'refused' : erasedT > 0 ? 'erased' : game?.audio.locked ? 'locked' : game?.muted ? 'muted' : ''
    },
    get screen() {
      return screen
    },
    open(g) {
      game = g
      if (!list) build(g)
      screen = 'list'
      open = true
      erasedT = refusedT = 0
      fsWant = null
      list!.reset(0)
    },
    update(g, input) {
      game = g
      if (!list) build(g)
      if (erasedT > 0) erasedT--
      if (refusedT > 0) refusedT--
      if (fsWant !== null) {
        if (g.fullscreen === fsWant) fsWant = null
        else if (++fsT >= FS_WAIT) {
          fsWant = null
          refusedT = NOTE_TICKS
        }
      }
      if (screen === 'list') list!.update(input)
      else ask!.update(input)
      return open
    },
    draw(g, c) {
      game = g
      if (!list) return
      panel(c, X, y, W, h, 'dialog')
      const cx = VIEW_W >> 1
      say(c, 'OPTIONS', cx, y + 14, 3, PAL.yellow[2], 'center', PAL.outline)
      c.fillStyle = PAL.brandBlue
      c.fillRect(X + 16, y + 44, W - 32, 1)

      if (screen === 'erase') {
        say(c, 'ERASE YOUR SAVE?', cx, y + 66, 2, PAL.white, 'center', PAL.outline)
        say(c, 'EVERY CLEARED WASH, TOKEN AND SCORE GOES.', cx, y + 94, 1, PAL.blue[3])
        say(c, 'YOUR SETTINGS STAY. THIS CANNOT BE UNDONE.', cx, y + 106, 1, PAL.blue[3])
        ask!.draw(c, cx - 64, y + 134, ASK)
        say(c, '{confirm} CHOOSE    {cancel} BACK', cx, y + h - 22, 1, PAL.blue[3])
        return
      }

      const lx = X + 30
      const ly = y + 56
      list!.draw(c, lx, ly, LIST)
      // Volume bars between the labels and the numbers.
      const s = g.save.data.settings
      for (let i = 0; i < 2; i++) {
        const v = i === 0 ? s.music : s.sfx
        // Clear of the arrows round a two-digit 10.
        meter(c, X + 204, ly + i * 24 + 2, 108, 12, v / 10, VOLUME)
      }
      const device = g.input.device
      if (refusedT > 0) {
        say(c, REFUSED[device][0], cx, y + h - 30, 1, PAL.orange[2])
        say(c, REFUSED[device][1], cx, y + h - 17, 1, PAL.orange[2])
      } else if (erasedT > 0) say(c, 'SAVE ERASED. A FRESH START!', cx, y + h - 22, 1, PAL.yellow[2])
      else if (g.audio.locked) say(c, LOCKED[device], cx, y + h - 22, 1, PAL.orange[2])
      else if (g.muted) say(c, MUTED[device], cx, y + h - 22, 1, PAL.orange[2])
      else say(c, '{up}{down} CHOOSE   {left}{right} CHANGE   {cancel} BACK', cx, y + h - 22, 1, PAL.blue[3])
    },
  }
  return overlay
}
