// Game over: the 'gameover' jingle, GAME OVER in mud dropping in, and Maxx caked in mud under
// a street lamp in the rain, wobbling and then keeling over into a puddle while the flies
// come. Then CONTINUE (the map, a fresh set of lives) or QUIT (the title), side by side.
// Progress on the map is kept either way, and the screen says so.
//
// Params: { from?: level id } (the play scene passes it; the screen names the wash).
// For checks the scene object exposes `index` (0 CONTINUE, 1 QUIT) and `ready` (the choice is up).
import { VIEW_H, VIEW_W } from '../contract'
import type { GameCtx, Scene } from '../contract'
import { measureText } from '../engine/text'
import { PAL, counter, createMenu } from '../engine/ui'
import type { Menu } from '../engine/ui'
import { LEVEL_META, RIVALS_META } from '../levels/meta'
import { anyPress, bounce, noise, onceFrame, say } from './title/kit'

export interface GameOverScene extends Scene {
  readonly index: number
  readonly ready: boolean
}

const DROP_TICKS = 40
/** Maxx wobbles in his mud this long, then goes down. */
const STAND_TICKS = 56
const GRIMED_TICKS = [14, 9, 9, 7]
const MENU_AT = 86
const GROUND = 250
const CX = VIEW_W >> 1
/** Maxx's feet, in the middle of the lamp's pool of light. */
const MAXX_FEET = GROUND + 15
/** The lamp's foot; its lens hangs over Maxx (the atlas meta says where). */
const LAMP_X = CX - 44
const LAMP_FOOT = GROUND + 2
const RAIN = 120
/** How wide the lamp's light is at the ground, and the top of the drizzle it lights. */
const LIGHT_HALF = 70
const CHOICE_Y = 300
const CHOICE_DX = 84
const FLY = ['title/fly0', 'title/fly1']
const BOB = [0, 1, 2, 1]

export function createGameOverScene(): GameOverScene {
  let t = 0
  let menu: Menu | null = null
  let gone = false
  let where = ''
  let scoreText = ''
  let hiText = ''
  let grimed: string[] = []
  let lensX = LAMP_X + 44
  let lensY = LAMP_FOOT - 109
  const rain: number[] = []
  const r = noise(404)
  for (let i = 0; i < RAIN; i++) rain.push(Math.floor(r() * VIEW_W), Math.floor(r() * VIEW_H), 3 + Math.floor(r() * 3))

  function choose(game: GameCtx, to: 'map' | 'title'): void {
    gone = true
    game.resetSession()
    game.go(to, {}, 'fade')
  }

  /** Left and right walk the two choices (up and down do too, through the menu itself). */
  function across(d: -1 | 1): boolean {
    const m = menu!
    const i = Math.max(0, Math.min(1, m.index + d))
    if (i === m.index) return false
    m.index = i
    return true
  }

  function maxxFrame(): string {
    if (!grimed.length) return ''
    const e = t - STAND_TICKS
    if (e < 0) return grimed[0]
    return grimed[Math.min(onceFrame(e, GRIMED_TICKS), grimed.length - 1)]
  }

  /** Is (x, y) inside the lamp's cone of light? */
  function lit(x: number, y: number): boolean {
    if (y < lensY + 2 || y > MAXX_FEET + 6) return false
    const half = 4 + ((y - lensY) / (MAXX_FEET - lensY)) * LIGHT_HALF
    return Math.abs(x - lensX) < half
  }

  function drawNight(game: GameCtx, g: CanvasRenderingContext2D): void {
    const sp = game.sprites
    // A dark lot after closing: only the one lamp is still on.
    g.fillStyle = PAL.purple[0]
    g.fillRect(0, 0, VIEW_W, GROUND)
    g.fillStyle = PAL.grey[0]
    g.fillRect(0, GROUND, VIEW_W, VIEW_H - GROUND)
    g.fillStyle = PAL.purple[1]
    g.fillRect(0, GROUND, VIEW_W, 1)

    // Its cone of light, in flat steps: the air it lights, then the wet ground.
    for (let y = lensY + 2; y <= MAXX_FEET + 6; y++) {
      const half = Math.round(3 + ((y - lensY) / (MAXX_FEET - lensY)) * LIGHT_HALF)
      g.fillStyle = y < GROUND ? PAL.purple[1] : PAL.grey[1]
      g.fillRect(lensX - half, y, half * 2, 1)
    }
    // The pool of light on the ground, brightest under the lamp.
    g.fillStyle = PAL.grey[2]
    for (let dy = -6; dy <= 6; dy++) {
      const half = Math.round(58 * Math.sqrt(1 - (dy * dy) / 42.25))
      g.fillRect(lensX - half, MAXX_FEET - 1 + dy, half * 2, 1)
    }
    sp.draw(g, 'title/lamp', LAMP_X, LAMP_FOOT)
    // A glow round the lit lens that flickers now and then.
    if ((t >> 3) % 23) {
      g.fillStyle = PAL.purple[2]
      g.fillRect(lensX - 9, lensY + 2, 18, 2)
      g.fillStyle = PAL.purple[3]
      g.fillRect(lensX - 5, lensY + 2, 10, 1)
    }

    // Drizzle: dim in the dark, bright where the lamp catches it.
    for (let i = 0; i < rain.length; i += 3) {
      const y = (rain[i + 1] + t * rain[i + 2]) % (VIEW_H + 20)
      const x = (rain[i] - (y >> 3) + VIEW_W) % VIEW_W
      if (y > MAXX_FEET + 8) continue
      g.fillStyle = lit(x, y) ? PAL.blue[4] : PAL.blue[0]
      g.fillRect(x, y - 10, 1, 4)
    }
  }

  const scene: GameOverScene = {
    get index() {
      return menu?.index ?? 0
    },
    get ready() {
      return t >= MENU_AT
    },
    enter(game, params) {
      game.audio.music(null)
      game.audio.jingle('gameover', { thenMusic: null })
      const from = typeof params.from === 'string' ? params.from : ''
      const meta = from === RIVALS_META.id ? RIVALS_META : LEVEL_META.find((m) => m.id === from)
      where = meta ? 'GRIMED AT ' + (meta === RIVALS_META ? meta.name : meta.site + ' ' + meta.name) : ''
      // Seven digits, as on the HUD: the score runs to TUNING.maxScore, 9999999.
      scoreText = 'SCORE ' + counter(game.session.score, 7)
      hiText = 'HI SCORE ' + counter(Math.max(game.save.data.hiScore, game.session.score), 7)
      const lamp = game.sprites.atlas('title')?.meta?.lamp as { lensX?: number; lensY?: number } | undefined
      if (lamp && typeof lamp.lensX === 'number' && typeof lamp.lensY === 'number') {
        lensX = LAMP_X + lamp.lensX
        lensY = LAMP_FOOT + lamp.lensY
      }
      menu = createMenu({
        audio: game.audio,
        items: [
          { label: 'CONTINUE', onSelect: () => choose(game, 'map'), onAdjust: across },
          { label: 'QUIT', onSelect: () => choose(game, 'title'), onAdjust: across },
        ],
      })
    },
    update(_game, input) {
      t++
      if (gone) return
      if (t < MENU_AT) {
        // A press hurries it along to the choice, it does not make one.
        if (t > 10 && anyPress(input)) t = MENU_AT - 1
        return
      }
      if (t === MENU_AT) menu!.reset(0)
      menu!.update(input)
    },
    render(game, g) {
      if (!grimed.length) grimed = game.sprites.anim('maxx', 'grimed')
      drawNight(game, g)

      // Maxx in his puddle under the lamp, flies once he is down.
      game.sprites.draw(g, 'title/puddle', lensX, MAXX_FEET + 6)
      const wob = t < STAND_TICKS ? Math.round(Math.sin(t / 5) * 1.5) : 0
      const f = maxxFrame()
      if (f) game.sprites.draw(g, f, lensX + wob, MAXX_FEET)
      if (t > STAND_TICKS + 40) {
        for (let k = 0; k < 3; k++) {
          const a = t / (8 + k) + k * 2.1
          game.sprites.draw(g, FLY[(t >> 1) & 1], Math.round(lensX + 6 + Math.cos(a) * (16 + k * 6)), Math.round(MAXX_FEET - 30 - k * 4 + Math.sin(a * 1.7) * 6))
        }
      }

      const drop = Math.round((1 - bounce(Math.min(1, t / DROP_TICKS))) * -140)
      game.sprites.draw(g, 'title/gameOver', CX, 12 + drop)
      if (t < DROP_TICKS) return
      say(g, scoreText, CX - 12, 104, 1, PAL.white, 'right')
      say(g, hiText, CX + 12, 104, 1, PAL.yellow[2], 'left')
      if (where) say(g, where, CX, 118, 1, PAL.purple[3])

      if (t < MENU_AT) return
      const m = menu!
      say(g, 'YOUR PROGRESS ON THE MAP IS KEPT.', CX, 280, 1, PAL.blue[4])
      const bob = BOB[(m.t >> 3) & 3] * 2
      for (let i = 0; i < 2; i++) {
        const x = CX + (i ? CHOICE_DX : -CHOICE_DX)
        const sel = i === m.index
        const label = m.items[i].label
        say(g, label, x, CHOICE_Y, 2, sel ? PAL.yellow[2] : PAL.white, 'center', PAL.outline)
        if (sel) say(g, '{pointer}', x - (measureText(label, 2) >> 1) - 6 - bob, CHOICE_Y, 2, PAL.yellow[2], 'right', PAL.outline)
      }
      say(g, m.index === 0 ? 'BACK TO THE MAP WITH A FRESH SET OF LIVES.' : 'BACK TO THE TITLE SCREEN.', CX, 326, 1, PAL.purple[3])
      say(g, '{left}{right} CHOOSE    {confirm} OK', CX, VIEW_H - 16, 1, PAL.grey[4])
    },
  }
  return scene
}
