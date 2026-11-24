// How To Play, shared by the title and the pause menu: four short pages, each a little
// animated picture over a few lines big enough to read from across the room. Left and right
// turn the pages, confirm goes on (and closes on the last page), cancel closes. Button
// prompts follow the device in use.
//
// The pictures use the game's own art where it exists (Maxx, the cars, the HUD's shine pips,
// the items' tokens and bubble, the tiles' wash crate), so what is taught here is what the
// player meets; the title atlas stands in for any of it that is missing.
import { VIEW_W } from '../../contract'
import type { InputDevice, Sprites } from '../../contract'
import { LINE_H, wrapText } from '../../engine/text'
import { PAL, panel } from '../../engine/ui'
import { BOUNCE_LIFT, BOUNCE_SY, drawCar, pose } from '../title/cars'
import type { CarFace } from '../title/cars'
import { onceFrame, say } from '../title/kit'
import type { Overlay } from './options'

type G = CanvasRenderingContext2D

const X = 18
const Y = 8
const W = VIEW_W - 2 * X
const H = 344
/** The picture: a strip of sky over a strip of ground that carries the captions. */
const SX = X + 16
const SY = Y + 38
const SW = W - 32
const SH = 124
const FEET = SY + SH - 22
const TEXT_TOP = SY + SH + 12
const TEXT_W = W - 40
const PITCH = 20
const PAGES = 4
const TITLES = ['THE CONTROLS', 'WASH THE CARS', 'KEEP YOUR SHINE', 'TRICKS AND SECRETS']

const DEVICE_NAME: Record<InputDevice, string> = {
  gamepad: 'ON THE CONTROLLER',
  keyboard: 'ON THE KEYBOARD',
  touch: 'ON THE TOUCH SCREEN',
}
// What else works, beyond the one prompt a line can show.
const DEVICE_EXTRA: Record<InputDevice, string> = {
  gamepad: 'THE LEFT STICK RUNS TOO. {pad_b} {pad_rb} AND {pad_rt} SPRAY AS WELL AS {pad_x}.',
  keyboard: '{key_A} {key_D} RUN, {key_SPACE} {key_K} JUMP, {key_J} {key_SHIFT} SPRAY, {key_P} {key_ESC} PAUSE. {key_F} FULLSCREEN.',
  touch: 'THE PAD ON THE LEFT RUNS, THE BIG BUTTONS JUMP AND SPRAY.',
}

/**
 * Each page's lines, set by hand so they break where the sense does (wrapText still guards
 * the width, should a prompt on some device come out wider).
 */
const PAGE_TEXT: readonly string[] = [
  'HOLD {jump} LONGER TO JUMP HIGHER.\n{up} AIMS UP AND OPENS DOORS.\n{down} GOES DOWN PIPES. {pause} PAUSES.',
  'DIRTY CARS DRIVE AT YOU. HOLD {spray}\nAND WASH THEM BEFORE THEY GET YOU.\nA WASHED CAR IS A FRIEND: RIDE IT!\nWASH THEM ALL FOR A SPOTLESS BONUS.',
  'YOU HAVE THREE PIPS OF SHINE.\nANYTHING DIRTY OR SHARP TAKES ONE.\nLOSE THE LAST AND YOU ARE GRIMED:\nTHAT COSTS A LIFE. SO DOES SLUDGE.\nSOAP BUBBLES GIVE SHINE BACK.',
  'IN THE AIR, HOLD {down} AND {spray} TO HOVER.\n{up} AIMS UP. HIT CRATES FROM BELOW.\n100 WASH TOKENS GIVE AN EXTRA LIFE.\nEVERY WASH HIDES THREE GOLD TOKENS\nAND MORE SECRETS. LOOK EVERYWHERE!',
]
/** Where the words may go: from under the picture to the page dots. */
const TEXT_BOTTOM = Y + H - 38
/** The captions on the ground strip of each picture: [x from the strip's left, text]. */
const CAPTIONS: readonly (readonly (readonly [number, string])[])[] = [
  [[96, '{move} RUN'], [SW >> 1, '{jump} JUMP'], [SW - 120, '{spray} SPRAY']],
  [[150, 'WASH THEM'], [SW - 110, 'RIDE THEM']],
  [[86, 'SHINE'], [SW >> 1, ''], [SW - 96, 'BUBBLES HEAL']],
  [[64, 'HOVER'], [196, 'AIM UP'], [338, 'CRATES'], [SW - 70, 'TOKENS']],
]

interface Anims {
  run: string[]
  idle: string[]
  jump: string[]
  fall: string[]
  sprayIdle: string[]
  sprayUpIdle: string[]
  sprayDown: string[]
  hurt: string[]
  grimed: string[]
  coin: string[]
  token: string[]
  bubble: string[]
  crate: string[]
  pip: string
  pipOff: string
}

const GRIMED_TICKS = [14, 9, 9, 7]
const BUMP = [0, 2, 4, 5, 5, 4, 2, 1]
const SPARK = ['title/spark0', 'title/spark1', 'title/spark2', 'title/spark3', 'title/spark2', 'title/spark1']

/** The controls for the device in use and the rules, a few short pages. */
export function createHowTo(): Overlay {
  let page = 0
  let t = 0
  let open = true
  let confirmArmed = false
  let cancelArmed = false
  let a: Anims | null = null
  let animsOf: Sprites | null = null
  const car = pose()

  function anims(sp: Sprites): Anims {
    if (a && animsOf === sp && a.run.length) return a
    animsOf = sp
    const get = (n: string) => sp.anim('maxx', n)
    const or = (list: string[], fallback: string) => (list.length ? list : [fallback])
    a = {
      run: get('run'), idle: get('idle'), jump: get('jump'), fall: get('fall'), sprayIdle: get('sprayIdle'),
      sprayUpIdle: get('sprayUpIdle'), sprayDown: get('sprayDown'), hurt: get('hurt'), grimed: get('grimed'),
      coin: or(sp.anim('items', 'coin'), 'title/coin'),
      token: or(sp.anim('items', 'token'), 'title/token'),
      bubble: or(sp.anim('items', 'bubble'), 'title/bubble2'),
      crate: sp.has('tiles/any_prize0') ? ['tiles/any_prize0', 'tiles/any_prize1', 'tiles/any_prize2', 'tiles/any_prize3'] : ['title/crate'],
      pip: sp.has('hud/pip') ? 'hud/pip' : 'title/pipOn',
      pipOff: sp.has('hud/pipEmpty') ? 'hud/pipEmpty' : 'title/pipOff',
    }
    return a
  }

  function frameOf(list: string[], i: number): string {
    return list.length ? list[((i % list.length) + list.length) % list.length] : ''
  }

  function drop(g: G, x: number, y: number): void {
    g.fillStyle = PAL.blue[3]
    g.fillRect(x - 3, y, 2, 2)
    g.fillStyle = PAL.white
    g.fillRect(x - 1, y - 1, 2, 2)
  }

  /** The HUD's pips are drawn from their top-left, the stand-ins from their middle. */
  function pipAt(g: G, sp: Sprites, name: string, cx: number, cy: number): void {
    const f = sp.frame(name)
    if (!f) return
    sp.draw(g, name, cx - (f.w >> 1) + (f.ax ?? 0), cy - (f.h >> 1) + (f.ay ?? 0))
  }

  function stage(g: G): void {
    g.fillStyle = PAL.blue[3]
    g.fillRect(SX, SY, SW, SH)
    g.fillStyle = PAL.blue[4]
    g.fillRect(SX, FEET - 24, SW, 24)
    g.fillStyle = PAL.grey[5]
    g.fillRect(SX, FEET, SW, SY + SH - FEET)
    g.fillStyle = PAL.white
    g.fillRect(SX, FEET, SW, 2)
  }

  function captions(g: G): void {
    const list = CAPTIONS[page]
    for (let i = 0; i < list.length; i++) {
      let text = list[i][1]
      // The middle of the shine page says what is happening to him.
      if (page === 2 && i === 1) text = t % 330 >= 180 ? 'GRIMED!' : 'OUCH!'
      say(g, text, SX + list[i][0], FEET + 5, 2, page === 2 && i === 1 && t % 330 >= 180 ? PAL.red[3] : PAL.navy)
    }
  }

  function controls(g: G, sp: Sprites, m: Anims): void {
    // Running: the walk scrolls under him.
    const rx = SX + 96
    g.fillStyle = PAL.grey[4]
    for (let k = 0; k < 5; k++) g.fillRect(rx - 60 + ((((k * 28 - t * 3) % 140) + 140) % 140), FEET + 3, 6, 1)
    sp.draw(g, frameOf(m.run, Math.floor((t * 3) / 7)), rx, FEET)

    // Jumping: up, over, down, a breath, again.
    const jx = SX + (SW >> 1)
    const k = t % 70
    const air = k < 44
    const h = air ? Math.round(Math.sin((k / 44) * Math.PI) * 34) : 0
    sp.draw(g, air ? (k < 22 ? frameOf(m.jump, 0) : frameOf(m.fall, 0)) : frameOf(m.idle, 0), jx, FEET - h)

    // Spraying.
    const sx = SX + SW - 120
    sp.draw(g, frameOf(m.sprayIdle, t >> 4), sx, FEET)
    for (let i = 0; i < 6; i++) drop(g, sx + 32 + ((t * 7 + i * 19) % 90), FEET - 30 + ((i * 3) % 4))
  }

  function cars(g: G, sp: Sprites, m: Anims): void {
    // Washing: filthy, then less so, then clean and delighted.
    const k = t % 220
    const cleanAt = 132
    const mx = SX + 60
    const cx = SX + 244
    const clean = k >= cleanAt
    const c = k - cleanAt
    car.stage = clean ? 0 : 3 - Math.floor(k / 44)
    car.paint = 1
    car.roll = 0
    car.flip = false
    car.sy = clean && c < BOUNCE_SY.length ? BOUNCE_SY[c] : 1
    car.lift = car.wheelLift = clean && c < BOUNCE_LIFT.length ? BOUNCE_LIFT[c] : 0
    car.wet = !clean || c < 40 ? t >> 2 : -1
    car.glint = clean && c >= 3 ? (c - 3) >> 1 : -1
    car.flash = clean && c < 3
    let face: CarFace = car.stage >= 3 ? 'grump' : car.stage === 2 ? 'sad' : 'meh'
    if (!clean && k % 44 < 8 && k >= 44) face = 'scrunch'
    else if (!clean && (t >> 3) % 4 === 0) face = 'wide'
    if (clean) face = c < 16 ? 'joy' : c < 40 ? 'honk' : 'happy'
    car.face = face
    if (clean) {
      sp.draw(g, frameOf(m.idle, 0), mx, FEET)
      for (let i = 0; i < 3; i++) {
        const f = (k + i * 7) % 24
        if (f < 22) sp.draw(g, SPARK[Math.min(5, f >> 2)], cx - 30 + i * 28, FEET - 22 - ((i * 13) % 20) - car.lift)
      }
    } else {
      sp.draw(g, frameOf(m.sprayIdle, t >> 4), mx, FEET)
      for (let i = 0; i < 6; i++) {
        const x = mx + 32 + ((t * 7 + i * 23) % 140)
        if (x < cx - 40) drop(g, x, FEET - 30 + (i % 3))
      }
      if (t % 6 < 3) sp.draw(g, 'title/splash1', cx - 40, FEET - 28)
    }
    drawCar(g, sp, 'sedan', cx, FEET, car)

    // Riding: Maxx on the roof of a clean car, both pleased about it.
    const rx = SX + SW - 110
    car.stage = 0
    car.paint = 3
    car.roll = t * 0.6
    car.sy = 1
    car.lift = car.wheelLift = 0
    car.wet = -1
    car.glint = -1
    car.flash = false
    car.face = (t >> 5) % 6 === 0 ? 'joy' : 'up'
    drawCar(g, sp, 'compact', rx, FEET, car)
    sp.draw(g, frameOf(m.idle, onceFrame(t % 138, [44, 44, 44, 6])), rx - 6, FEET - 40)
  }

  function shine(g: G, sp: Sprites, m: Anims): void {
    const k = t % 330
    const pips = k < 60 ? 3 : k < 120 ? 2 : k < 180 ? 1 : 0
    const px = SX + 86
    for (let i = 0; i < 3; i++) pipAt(g, sp, i < pips ? m.pip : m.pipOff, px - 26 + i * 26, FEET - 40)

    const mx = SX + (SW >> 1)
    let frame: string
    if (pips === 0) {
      // The grimed animation, once, holding its last frame.
      frame = frameOf(m.grimed, Math.min(onceFrame(k - 180, GRIMED_TICKS), m.grimed.length - 1))
    } else {
      const sinceHit = (k - 60) % 60
      const hurt = k >= 60 && sinceHit < 16
      frame = hurt ? frameOf(m.hurt, sinceHit >> 2) : frameOf(m.idle, 0)
      // Blinking while he recovers.
      if (k >= 60 && sinceHit >= 16 && sinceHit < 44 && (t >> 2) & 1) frame = ''
    }
    if (frame) sp.draw(g, frame, mx, FEET)

    const bx = SX + SW - 96
    const by = FEET - 34 + Math.round(Math.sin(t / 14) * 4)
    sp.draw(g, frameOf(m.bubble, t >> 3), bx - 26, by + 11)
    say(g, '+', bx, by - 6, 2, PAL.navy)
    pipAt(g, sp, m.pip, bx + 28, by)
  }

  function tricks(g: G, sp: Sprites, m: Anims): void {
    // Hover: the spray straight down holds him up.
    const hx = SX + 64
    const hy = FEET - 30 + ((t >> 3) & 1)
    sp.draw(g, frameOf(m.sprayDown, t >> 2), hx, hy)
    for (let i = 0; i < 4; i++) drop(g, hx + 7 + (i % 2), hy - 2 + ((t * 5 + i * 9) % 30))

    // Aiming up.
    const ux = SX + 196
    sp.draw(g, frameOf(m.sprayUpIdle, t >> 4), ux, FEET)
    for (let i = 0; i < 5; i++) {
      const d = (t * 5 + i * 17) % 70
      drop(g, ux + 25 + Math.round(d * 0.7), FEET - 55 - Math.round(d * 0.7))
    }

    // A crate bumped from below gives up a token.
    const bx = SX + 338
    const k = t % 80
    const bump = k < 8 ? -BUMP[k] : 0
    const crateTop = FEET - 96
    if (k < 26) sp.draw(g, frameOf(m.coin, t >> 2), bx, crateTop - Math.round(Math.sin((k / 26) * Math.PI) * 14))
    sp.draw(g, frameOf(m.crate, t >> 3), bx - 16, crateTop + bump)
    const jump = k < 12 ? Math.round(Math.sin((k / 12) * Math.PI) * 6) : 0
    sp.draw(g, k < 12 ? frameOf(m.jump, 0) : frameOf(m.idle, 0), bx - 2, FEET - jump)

    // Tokens: the wash token and a gold one.
    const tx = SX + SW - 70
    const f = Math.round(Math.sin(t / 12) * 2)
    sp.draw(g, frameOf(m.coin, Math.floor(t / 5)), tx - 22, FEET - 26 + f)
    sp.draw(g, frameOf(m.token, Math.floor(t / 9)), tx + 16, FEET - 26 - f)
    if ((t >> 2) % 12 < 6) sp.draw(g, SPARK[(t >> 2) % 6], tx + 26, FEET - 46 - f)
  }

  return {
    open() {
      page = 0
      t = 0
      open = true
      confirmArmed = cancelArmed = false
    },
    update(game, input) {
      t++
      // The press that opened this must be let go before it can act here.
      const wasConfirm = confirmArmed
      const wasCancel = cancelArmed
      if (!input.held.confirm) confirmArmed = true
      if (!input.held.cancel) cancelArmed = true
      if (input.repeat.left && page > 0) {
        page--
        t = 0
        game.audio.sfx('menuMove')
      } else if (input.repeat.right && page < PAGES - 1) {
        page++
        t = 0
        game.audio.sfx('menuMove')
      } else if (input.pressed.confirm && wasConfirm) {
        if (page < PAGES - 1) {
          page++
          t = 0
          game.audio.sfx('menuSelect')
        } else {
          game.audio.sfx('menuBack')
          open = false
        }
      } else if (input.pressed.cancel && wasCancel) {
        game.audio.sfx('menuBack')
        open = false
      }
      return open
    },
    draw(game, g) {
      const sp = game.sprites
      const m = anims(sp)
      panel(g, X, Y, W, H, 'dialog')
      const cx = VIEW_W >> 1
      say(g, 'HOW TO PLAY', X + 16, Y + 12, 2, PAL.yellow[2], 'left', PAL.outline)
      say(g, TITLES[page], X + W - 16, Y + 12, 2, PAL.white, 'right', PAL.outline)

      stage(g)
      g.save()
      g.beginPath()
      g.rect(SX, SY, SW, SH)
      g.clip()
      if (page === 0) controls(g, sp, m)
      else if (page === 1) cars(g, sp, m)
      else if (page === 2) shine(g, sp, m)
      else tricks(g, sp, m)
      captions(g)
      g.restore()

      // The words, at a size to read from the couch, in the middle of the room under the picture.
      const lines = wrapText(PAGE_TEXT[page], TEXT_W, 2)
      const extra = page === 0 ? 2 * LINE_H + 12 : 0
      let y = TEXT_TOP + Math.max(0, (TEXT_BOTTOM - TEXT_TOP - (lines.length * PITCH - 4) - extra) >> 1)
      for (let i = 0; i < lines.length; i++) {
        say(g, lines[i], cx, y, 2, PAL.white, 'center', PAL.outline)
        y += PITCH
      }
      if (page === 0) {
        const device = game.input.device
        say(g, DEVICE_NAME[device], cx, y + 6, 1, PAL.yellow[2])
        say(g, DEVICE_EXTRA[device], cx, y + 6 + LINE_H + 4, 1, PAL.blue[3])
      }

      // Which page, as dots.
      for (let i = 0; i < PAGES; i++) {
        g.fillStyle = i === page ? PAL.yellow[2] : PAL.blue[1]
        g.fillRect(cx - 30 + i * 16, Y + H - 32, 8, 8)
      }
      say(g, '{left}{right} TURN THE PAGE    {confirm} NEXT    {cancel} BACK', cx, Y + H - 18, 1, PAL.blue[3])
    },
  }
}
