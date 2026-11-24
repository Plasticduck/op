// The pause menu: RESUME, RESTART LEVEL, HOW TO PLAY, OPTIONS, EXIT TO MAP.
//
// One button can be two actions (Start and Enter are pause and confirm, Esc is pause and
// cancel), so while this is up the menu's own confirm and cancel close it and a 'pause'
// press is never read as "resume" by itself here: the play scene resumes only on a pause
// press that is neither (the P key, a touch pause button), and never on the shell's own.
// One exception: inside HOW TO PLAY or OPTIONS, the controller's Menu resumes the level.
// RESTART LEVEL and EXIT TO MAP ask first, with NO under the cursor.
import { VIEW_H, VIEW_W } from '../../contract'
import type { GameCtx, InputFrame, LevelDef } from '../../contract'
import { drawText, measureText } from '../../engine/text'
import type { TextStyle } from '../../engine/text'
import { PAL, createMenu, panel } from '../../engine/ui'
import type { Menu, MenuDrawOpts } from '../../engine/ui'
import { createHowTo } from '../shared/howto'
import { createOptions } from '../shared/options'
import type { Overlay } from '../shared/options'
import { FOR_SOUND } from '../title/kit'
import { bounceIn, drawDim } from './cover'
import { RIVALS_ID } from './record'

type G = CanvasRenderingContext2D

export type PauseScreen = 'menu' | 'howto' | 'options' | 'restart' | 'exit'
/** What the player chose, on the tick they chose it. */
export type PauseChoice = 'resume' | 'restart' | 'exit'

export const PAUSE_ITEMS = ['RESUME', 'RESTART LEVEL', 'HOW TO PLAY', 'OPTIONS', 'EXIT TO MAP'] as const

export interface PauseMenu {
  /** Call as it comes up: cursor to RESUME, the buttons already down ignored. */
  open(game: GameCtx): void
  /** One tick. Null while the player is still in it. */
  update(game: GameCtx, input: InputFrame): PauseChoice | null
  draw(game: GameCtx, g: G, level: LevelDef): void
  /** Which part of it is showing. */
  readonly screen: PauseScreen
  /** The row under the cursor of whichever list is showing. */
  readonly index: number
}

const st: TextStyle = {}
const MENU_LOOK: MenuDrawOpts = { scale: 2, rowHeight: 13, color: PAL.white, selectedColor: PAL.yellow[2], shadow: PAL.outline }
const ASK_LOOK: MenuDrawOpts = { scale: 2, rowHeight: 13, color: PAL.white, selectedColor: PAL.yellow[2], shadow: PAL.outline }
const W = 300
const H = 238

function say(g: G, text: string, x: number, y: number, scale: number, color: string, shadow?: string): void {
  st.scale = scale
  st.color = color
  st.align = 'center'
  st.shadow = shadow
  st.outline = undefined
  drawText(g, text, x, y, st)
}

export function createPauseMenu(game: GameCtx): PauseMenu {
  let screen: PauseScreen = 'menu'
  let choice: PauseChoice | null = null
  let t = 0
  let overlay: Overlay | null = null
  let howto: Overlay | null = null
  let options: Overlay | null = null
  let whereOf: LevelDef | null = null
  let where = ''

  const show = (next: PauseScreen) => {
    screen = next
    if (next === 'restart' || next === 'exit') ask.reset(0)
    if (next === 'howto') overlay = howto ??= createHowTo()
    else if (next === 'options') overlay = options ??= createOptions({ erase: false })
    else overlay = null
    overlay?.open(game)
  }
  const back = (row: number) => {
    screen = 'menu'
    overlay = null
    menu.reset(row)
  }

  const menu: Menu = createMenu({
    audio: game.audio,
    items: [
      { label: PAUSE_ITEMS[0], onSelect: () => void (choice = 'resume') },
      { label: PAUSE_ITEMS[1], onSelect: () => show('restart') },
      { label: PAUSE_ITEMS[2], onSelect: () => show('howto') },
      { label: PAUSE_ITEMS[3], onSelect: () => show('options') },
      { label: PAUSE_ITEMS[4], onSelect: () => show('exit') },
    ],
    onCancel: () => void (choice = 'resume'),
  })

  // The question under RESTART LEVEL and EXIT TO MAP. NO first: a second press of the same button backs out.
  const ask: Menu = createMenu({
    audio: game.audio,
    wrap: false,
    items: [
      { label: 'NO', onSelect: () => back(screen === 'exit' ? 4 : 1) },
      { label: 'YES', onSelect: () => void (choice = screen === 'exit' ? 'exit' : 'restart') },
    ],
    onCancel: () => back(screen === 'exit' ? 4 : 1),
  })

  return {
    get screen() {
      return screen
    },
    get index() {
      return screen === 'menu' ? menu.index : screen === 'restart' || screen === 'exit' ? ask.index : 0
    },
    open() {
      screen = 'menu'
      overlay = null
      choice = null
      t = 0
      menu.reset(0)
    },
    update(g2, input) {
      t++
      choice = null
      if (overlay) {
        // Menu is pause and confirm. Pressed to get back into the level, as it does on RESUME, its
        // confirm would otherwise step the row under the cursor (MUSIC up one) and leave it paused.
        // Not Enter: it is the keyboard's own confirm.
        if (input.device === 'gamepad' && input.pressed.pause && input.pressed.confirm && !g2.autoPause) {
          screen = 'menu'
          overlay = null
          return 'resume'
        }
        if (!overlay.update(g2, input)) back(screen === 'howto' ? 2 : 3)
        return null
      }
      if (screen === 'menu') menu.update(input)
      else ask.update(input)
      return choice
    },
    draw(g2, g, level) {
      drawDim(g, 0.6)
      if (overlay) {
        overlay.draw(g2, g)
        return
      }
      const x = (VIEW_W - W) >> 1
      // It drops in with a bounce, then sits still.
      const y = ((VIEW_H - H) >> 1) + Math.round((1 - bounceIn(Math.min(1, t / 10))) * -40)
      const cx = VIEW_W >> 1
      panel(g, x, y, W, H, 'dialog')
      say(g, 'PAUSED', cx, y + 16, 4, PAL.yellow[2], PAL.outline)
      if (level !== whereOf) {
        whereOf = level
        // Rival Row's site is '???', a mystery plate on its card but a blank in a line of text.
        const named = /[A-Z0-9]/i.test(level.site)
        where = named ? level.site.toUpperCase() + '  ' + level.name.toUpperCase() : level.name.toUpperCase()
        // A name too long for the panel gives way to the site alone.
        if (named && measureText(where, 1) > W - 28) where = level.site.toUpperCase()
      }
      say(g, where, cx, y + 54, 1, PAL.blue[3])
      g.fillStyle = PAL.brandBlue
      g.fillRect(x + 16, y + 68, W - 32, 1)

      if (screen === 'menu') {
        menu.draw(g, x + 46, y + 82, MENU_LOOK)
        // A player on a controller may not have pressed a key or clicked yet: the level is silent.
        if (g2.audio.locked) say(g, FOR_SOUND[g2.input.device], cx, y + H - 21, 1, PAL.orange[2])
        else say(g, '{confirm} CHOOSE    {cancel} RESUME', cx, y + H - 21, 1, PAL.blue[3])
        return
      }
      const exit = screen === 'exit'
      say(g, exit ? 'EXIT TO THE MAP?' : 'RESTART THE LEVEL?', cx, y + 84, 2, PAL.white, PAL.outline)
      // A rival beaten is saved the moment he falls (record.ts), so Rival Row keeps something.
      const lost = level.id === RIVALS_ID ? 'RIVALS YOU BEAT STAY BEATEN.' : 'THIS VISIT WILL NOT BE SAVED.'
      say(g, exit ? lost : 'BACK TO THE START OF THE LEVEL.', cx, y + 108, 1, PAL.blue[3])
      ask.draw(g, cx - 34, y + 132, ASK_LOOK)
      say(g, '{confirm} CHOOSE    {cancel} BACK', cx, y + H - 21, 1, PAL.blue[3])
    },
  }
}
