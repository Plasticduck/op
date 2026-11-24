// The title screen: the logo over a living Mighty Wash lot, PRESS START, then the menu
// CONTINUE (only with progress) / NEW GAME (asks before erasing progress) / HOW TO PLAY /
// OPTIONS, and SANDBOX on the dev page. Song 'title'.
//
// Left on PRESS START for a while, it plays a short attract loop (the story, over the lot)
// and comes back by itself or on any press. Menus start on 'confirm' only: Start gives it
// too, and the shell's own pause press (leaving the tab) must not start the game.
//
// For checks: the scene object exposes `state` ('press' | 'menu' | 'ask' | 'options' |
// 'howto' | 'attract' | 'leaving'), `index` (the row under the cursor), `labels` (the
// menu's rows), `note` (the options screen's note) and `carStage` (the car on the lot).
import { VIEW_H, VIEW_W } from '../contract'
import type { GameCtx, InputDevice, Scene } from '../contract'
import { PAL, counter, createMenu, panel } from '../engine/ui'
import type { Menu, MenuDrawOpts, MenuItem } from '../engine/ui'
import { createHowTo } from './shared/howto'
import { createOptions } from './shared/options'
import type { OptionsOverlay } from './shared/options'
import { FOR_SOUND, anyPress, dim, hasProgress, say } from './title/kit'
import { createLot } from './title/lot'
import { createLogo } from './title/logo'

type State = 'press' | 'menu' | 'ask' | 'options' | 'howto' | 'attract' | 'leaving'

/** What checks read off the scene object. */
export interface TitleScene extends Scene {
  readonly state: State
  readonly index: number
  readonly labels: readonly string[]
  /** The note at the foot of the options ('refused', 'erased', 'locked', 'muted' or ''). */
  readonly note: string
  /** The dirt stage of the car on the lot, -1 for none. */
  readonly carStage: number
}

const START_IS: Record<InputDevice, string> = {
  gamepad: '{pad_start} OR {pad_a} ON THE CONTROLLER',
  keyboard: '{key_ENTER} OR {key_SPACE} ON THE KEYBOARD',
  touch: 'TAP {touch_a} TO START',
}
const STORY = [
  'WEST TEXAS. HOT WIND, RED DIRT,',
  'AND A THOUSAND FILTHY CARS.',
  'MUD. BUGS. ROAD SALT.',
  'GRUMPY, EVERY ONE OF THEM.',
  'ONLY ONE BRUSH CAN WASH THEM ALL...',
]

const LOGO_Y = 10
/** Idle on PRESS START this long, and the attract loop starts. */
const ATTRACT_AFTER = 20 * 60
const ATTRACT_TICKS = 13 * 60
const LINE_EVERY = 80
const MENU_W = 236
const MENU_TOP = 146
const MENU_LOOK: MenuDrawOpts = { scale: 2, rowHeight: 12, align: 'center', color: PAL.white, selectedColor: PAL.yellow[2], shadow: PAL.outline }
const ASK_LOOK: MenuDrawOpts = { scale: 2, rowHeight: 13, color: PAL.white, selectedColor: PAL.yellow[2], shadow: PAL.outline }

export function createTitleScene(): TitleScene {
  const lot = createLot()
  const logo = createLogo()
  // Made as an Overlay; it also reports the note at its foot, for checks.
  const options = createOptions() as OptionsOverlay
  const howto = createHowTo()
  let state: State = 'press'
  let stateT = 0
  let idle = 0
  let menu: Menu | null = null
  let ask: Menu | null = null
  let labels: string[] = []
  let hiText = ''

  function setState(next: State): void {
    state = next
    stateT = 0
  }

  /**
   * `fresh`: a new run (three lives, no score). CONTINUE keeps a run that still has lives: the map's
   * cancel (B, which is also spray on a controller) brings a player here in the middle of one.
   */
  function leave(game: GameCtx, scene: 'map' | 'sandbox', fresh: boolean): void {
    setState('leaving')
    if (fresh) game.resetSession()
    game.go(scene, {}, 'fade')
  }

  /** The rows depend on the save (CONTINUE) and the page (SANDBOX): rebuilt whenever the menu comes up. */
  function buildMenu(game: GameCtx, at?: string): void {
    const items: MenuItem[] = []
    if (hasProgress(game.save.data)) items.push({ label: 'CONTINUE', onSelect: () => leave(game, 'map', !(game.session.lives > 0)) })
    items.push({
      label: 'NEW GAME',
      onSelect: () => {
        if (!hasProgress(game.save.data)) return leave(game, 'map', true)
        setState('ask')
        ask!.reset(0)
      },
    })
    items.push({ label: 'HOW TO PLAY', onSelect: () => openOverlay(game, 'howto') })
    items.push({ label: 'OPTIONS', onSelect: () => openOverlay(game, 'options') })
    if (game.debug) items.push({ label: 'SANDBOX', onSelect: () => leave(game, 'sandbox', true) })
    labels = items.map((i) => i.label)
    menu!.items = items
    menu!.reset(Math.max(0, at ? labels.indexOf(at) : 0))
    const hi = game.save.data.hiScore
    hiText = hi > 0 ? 'HI SCORE ' + counter(hi, 7) : ''
  }

  function openOverlay(game: GameCtx, which: 'options' | 'howto'): void {
    setState(which)
    ;(which === 'options' ? options : howto).open(game)
  }

  function openMenu(game: GameCtx, at?: string): void {
    logo.land()
    buildMenu(game, at)
    setState('menu')
  }

  const scene: TitleScene = {
    get state() {
      return state
    },
    get index() {
      return state === 'ask' ? ask?.index ?? 0 : menu?.index ?? 0
    },
    get labels() {
      return labels
    },
    get note() {
      return options.note
    },
    get carStage() {
      return lot.carStage
    },
    enter(game) {
      game.audio.music('title')
      game.audio.preload(['map'])
      menu = createMenu({ audio: game.audio, items: [], onCancel: () => setState('press') })
      ask = createMenu({
        audio: game.audio,
        wrap: false,
        items: [
          { label: 'NO', onSelect: () => openMenu(game, 'NEW GAME') },
          {
            label: 'YES',
            onSelect: () => {
              game.save.reset()
              leave(game, 'map', true)
            },
          },
        ],
        onCancel: () => openMenu(game, 'NEW GAME'),
      })
      buildMenu(game)
      logo.drop()
      setState('press')
    },
    update(game, input) {
      stateT++
      lot.update()
      logo.update()
      if (state === 'leaving') return

      if (state === 'options' || state === 'howto') {
        const ov = state === 'options' ? options : howto
        if (!ov.update(game, input)) openMenu(game, state === 'options' ? 'OPTIONS' : 'HOW TO PLAY')
        return
      }
      if (state === 'menu') {
        // Another tab of the game may have saved progress, or erased it, since the menu came up.
        if (hasProgress(game.save.data) !== (labels[0] === 'CONTINUE')) buildMenu(game, labels[menu!.index])
        menu!.update(input)
        return
      }
      if (state === 'ask') {
        ask!.update(input)
        return
      }
      if (state === 'attract') {
        if (anyPress(input) || stateT >= ATTRACT_TICKS) {
          logo.drop()
          idle = 0
          setState('press')
        }
        return
      }
      // PRESS START.
      if (input.pressed.confirm) {
        game.audio.sfx('menuSelect')
        idle = 0
        openMenu(game)
        return
      }
      if (anyPress(input)) {
        // Any other button: the logo stops falling, and the clock to the attract loop starts over.
        logo.land()
        idle = 0
      } else if (++idle >= ATTRACT_AFTER && logo.landed) {
        setState('attract')
      }
    },
    render(game, g) {
      lot.draw(g, game.sprites)

      const cx = VIEW_W >> 1
      const lift = state === 'attract' ? Math.min(160, stateT * 8) : 0
      logo.draw(g, game.sprites, cx, LOGO_Y, lift)
      const device = game.input.device

      if (state === 'attract') {
        const shown = Math.min(STORY.length, 1 + Math.floor(stateT / LINE_EVERY))
        panel(g, 70, 28, VIEW_W - 140, 156, 'dark')
        for (let i = 0; i < shown; i++) say(g, STORY[i], cx, 46 + i * 20, 2, i === STORY.length - 1 ? PAL.yellow[2] : PAL.white, 'center', PAL.outline)
        if (stateT >= STORY.length * LINE_EVERY + 30) say(g, 'MIGHTY MAXX!', cx, 146, 3, PAL.red[4], 'center', PAL.navy, PAL.navy)
      } else if (state === 'press') {
        if (logo.landed) {
          if (stateT % 50 < 32) say(g, 'PRESS START', cx, 150, 2, PAL.yellow[2], 'center', PAL.navy, PAL.navy)
          say(g, START_IS[device], cx, 174, 1, PAL.white, 'center', undefined, PAL.navy)
        }
      } else if (state === 'menu' || state === 'ask' || state === 'leaving') {
        const rows = menu!.items.length
        const h = 36 + (rows - 1) * 24 + 16
        if (state === 'ask') {
          panel(g, cx - 160, MENU_TOP, 320, 118, 'dialog')
          say(g, 'START A NEW GAME?', cx, MENU_TOP + 16, 2, PAL.white, 'center', PAL.outline)
          say(g, 'YOUR SAVED PROGRESS WILL BE ERASED.', cx, MENU_TOP + 40, 1, PAL.orange[2])
          ask!.draw(g, cx - 34, MENU_TOP + 60, ASK_LOOK)
        } else {
          panel(g, cx - (MENU_W >> 1), MENU_TOP, MENU_W, h, 'dialog')
          menu!.draw(g, cx + 8, MENU_TOP + 18, MENU_LOOK)
        }
      }

      if (state === 'options' || state === 'howto') {
        dim(g)
        ;(state === 'options' ? options : howto).draw(game, g)
        return
      }

      // The foot of the screen: the high score, and how to get sound going.
      if (hiText && state !== 'attract') say(g, hiText, VIEW_W - 12, VIEW_H - 14, 1, PAL.navy, 'right')
      if (game.audio.locked) say(g, FOR_SOUND[device], cx, VIEW_H - 14, 1, PAL.white, 'center', undefined, PAL.navy)
      else if (state === 'menu') say(g, '{confirm} CHOOSE    {cancel} BACK', cx, VIEW_H - 14, 1, PAL.navy)
    },
  }
  return scene
}
