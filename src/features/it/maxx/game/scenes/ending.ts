// The ending, after MW08: a parade of washed, happy cars (the game's own, every kind down to
// a monster truck) across a West Texas sunset, Maxx in his win pose on a podium,
// CONGRATULATIONS and a thank-you from Mighty Wash, the final numbers from the save, the
// credits rising from behind the mesas, then one last card: a rumour about the roof
// of MW03 while the secret is still hidden, or the champion's trophy once every rival is
// beaten (neither otherwise). THE END, and back to the title. Song 'ending'.
//
// save.finished is set (and committed) on the way in. Confirm moves each part along; each
// part also moves on by itself.
//
// For checks the scene object exposes `phase` ('thanks' | 'numbers' | 'credits' | 'card' |
// 'end') and `card` ('rumour' | 'champion' | '').
import { VIEW_H, VIEW_W } from '../contract'
import type { GameCtx, Scene } from '../contract'
import { PAL, counter, panel } from '../engine/ui'
import { BOB_LIFT, CAR_KINDS, carBox, drawCar, pose } from './title/cars'
import { bounce, dim, finalNumbers, noise, say } from './title/kit'

type Phase = 'thanks' | 'numbers' | 'credits' | 'card' | 'end'
type Card = 'rumour' | 'champion' | ''

export interface EndingScene extends Scene {
  readonly phase: Phase
  readonly card: Card
}

const HORIZON = 236
const ROAD_TOP = 246
const CAR_FEET = 292
const WALK_TOP = 304
const PODIUM_X = 120
const PODIUM_FOOT = 340
const MAXX_FEET = PODIUM_FOOT - 21
const PARADE_GAP = 150
const PARADE_SPEED = 1.1
/** Least time in a part before confirm moves it on, so one press never skips two. */
const MIN_T = 40

const THANKS = [
  'EVERY CAR IN WEST TEXAS IS CLEAN,',
  'AND EVERY ONE OF THEM IS SMILING.',
  'THANK YOU FOR PLAYING!',
  'FROM ALL OF US AT MIGHTY WASH',
]
const THANKS_EVERY = 70
const THANKS_TICKS = 640
const ROWS_EVERY = 46
const NUMBERS_TICKS = 520
const CARD_TICKS = 720
const END_TICKS = 1200
const CREDIT_SPEED = 0.55
const CREDIT_PITCH = 16

// Sky bands, top first: [bottom row, colour].
const SUNSET: ReadonlyArray<readonly [number, string]> = [
  [44, PAL.purple[1]], [84, PAL.purple[2]], [118, PAL.pink], [150, PAL.orange[1]], [184, PAL.orange[2]], [HORIZON, PAL.yellow[1]],
]
const DUSK: ReadonlyArray<readonly [number, string]> = [
  [44, PAL.purple[0]], [84, PAL.purple[1]], [118, PAL.purple[2]], [150, PAL.pink], [184, PAL.orange[1]], [HORIZON, PAL.orange[0]],
]
const NIGHT: ReadonlyArray<readonly [number, string]> = [[96, PAL.purple[0]], [170, PAL.purple[1]], [HORIZON, PAL.purple[2]]]
const CONFETTI = [PAL.red[3], PAL.brandBlue, PAL.yellow[2], PAL.white, PAL.green[3], PAL.pink]
const WIN_TICKS = [10, 8, 8, 8]
const SPARK = ['title/spark0', 'title/spark1', 'title/spark2', 'title/spark3', 'title/spark2', 'title/spark1']
const PUMP = ['title/pumpjack0', 'title/pumpjack1']
/** The parade's running order; the monster truck closes each round of it. */
const PARADE = [CAR_KINDS[0], CAR_KINDS[1], CAR_KINDS[3], CAR_KINDS[5], CAR_KINDS[2], CAR_KINDS[4], CAR_KINDS[1], CAR_KINDS[6]]
/** Each one's paint (an index into its kind's paints in the cars atlas), moved on by one every round. */
const PARADE_PAINT = [1, 1, 0, 1, 2, 2, 2, 1]
const HONK_TICKS = 20

export function createEndingScene(): EndingScene {
  let phase: Phase = 'thanks'
  let card: Card = ''
  let t = 0
  let phaseT = 0
  let credits: string[] = []
  let creditY = 0
  let numberRows: Array<readonly [string, string]> = []
  let win: string[] = []
  let gone = false
  let nextHonk = 150
  /** The car honking now (its number in the parade), and for how much longer. */
  let honkCar = -1
  let honkT = 0
  const car = pose()
  const r = noise(2026)
  const confetti: number[] = []
  for (let i = 0; i < 56; i++) confetti.push(r() * VIEW_W, -r() * VIEW_H, 0.5 + r() * 0.7, Math.floor(r() * CONFETTI.length), r() * 6.28)
  const stars: number[] = []
  for (let i = 0; i < 40; i++) stars.push(Math.floor(r() * VIEW_W), Math.floor(r() * 150), Math.floor(r() * 64))

  function go(next: Phase): void {
    phase = next
    phaseT = 0
  }

  function nextAfterCredits(): void {
    go(card ? 'card' : 'end')
  }

  function finish(game: GameCtx): void {
    gone = true
    game.go('title', {}, 'fade')
  }

  function sky(): ReadonlyArray<readonly [number, string]> {
    if (phase === 'thanks' || phase === 'numbers') return SUNSET
    if (phase === 'credits' && creditY > -credits.length * CREDIT_PITCH * 0.45) return DUSK
    return NIGHT
  }

  function drawSky(game: GameCtx, g: CanvasRenderingContext2D): void {
    const sp = game.sprites
    const bands = sky()
    let top = 0
    for (let i = 0; i < bands.length; i++) {
      g.fillStyle = bands[i][1]
      g.fillRect(0, top, VIEW_W, bands[i][0] - top)
      top = bands[i][0]
    }
    if (bands === NIGHT) {
      for (let i = 0; i < stars.length; i += 3) {
        g.fillStyle = (t + stars[i + 2]) % 64 < 8 ? PAL.yellow[2] : PAL.white
        g.fillRect(stars[i], stars[i + 1], 1, 1)
      }
    } else {
      // The sun goes down as the evening goes on.
      const sunY = Math.round((bands === SUNSET ? 168 : 214) + Math.min(30, t / 60))
      sp.draw(g, 'title/sun', 452, sunY)
    }
  }

  /** The credits rise from behind the land, so the sky is drawn, then they are, then this. */
  function drawLand(game: GameCtx, g: CanvasRenderingContext2D): void {
    const sp = game.sprites
    sp.draw(g, 'title/dusk', 0, HORIZON)
    sp.draw(g, PUMP[(t >> 5) & 1], 92, HORIZON - 12)
    sp.draw(g, PUMP[((t >> 5) + 1) & 1], 560, HORIZON - 12)

    // The road and its parade.
    g.fillStyle = PAL.purple[1]
    g.fillRect(0, HORIZON, VIEW_W, ROAD_TOP - HORIZON)
    g.fillStyle = PAL.grey[1]
    g.fillRect(0, ROAD_TOP, VIEW_W, WALK_TOP - ROAD_TOP)
    g.fillStyle = PAL.grey[0]
    g.fillRect(0, ROAD_TOP, VIEW_W, 1)
    g.fillStyle = PAL.yellow[0]
    for (let x = 8; x < VIEW_W; x += 64) g.fillRect(x, ROAD_TOP + 26, 28, 2)

    const travelled = t * PARADE_SPEED
    const first = Math.floor((travelled - VIEW_W - 120) / PARADE_GAP)
    for (let n = first; n < first + 7; n++) {
      if (n < 0) continue
      const x = Math.round(VIEW_W + 80 + n * PARADE_GAP - travelled)
      if (x < -80 || x > VIEW_W + 80) continue
      const kind = PARADE[n % PARADE.length]
      const { w, h } = carBox(sp, kind)
      const k = (t + n * 7) % BOB_LIFT.length
      car.paint = PARADE_PAINT[n % PARADE.length] + Math.floor(n / PARADE.length)
      car.roll = travelled
      car.lift = BOB_LIFT[k]
      // Every car in it is delighted; now and then one honks, or beams, or catches the light.
      car.face = n === honkCar && honkT > 0 ? 'honk' : (t + n * 37) % 170 < 8 ? 'joy' : 'happy'
      const gi = ((t + n * 41) % 200) >> 1
      car.glint = gi < 20 ? gi : -1
      drawCar(g, sp, kind, x, CAR_FEET, car)
      // A sparkle riding along on each.
      const s = (t + n * 9) % 30
      if (s < 24) sp.draw(g, SPARK[s >> 2], x - (w >> 2) + ((n * 13) % (w >> 1)), CAR_FEET - h + 6 - car.lift)
    }

    // The walk, the podium, Maxx.
    g.fillStyle = PAL.purple[0]
    g.fillRect(0, WALK_TOP, VIEW_W, VIEW_H - WALK_TOP)
    g.fillStyle = PAL.purple[2]
    g.fillRect(0, WALK_TOP, VIEW_W, 2)
    sp.draw(g, 'title/podium', PODIUM_X, PODIUM_FOOT)
    if (win.length) {
      let k = t % 34
      let i = 0
      while (k >= WIN_TICKS[i]) k -= WIN_TICKS[i++]
      sp.draw(g, win[i], PODIUM_X, MAXX_FEET)
    }
  }

  function drawConfetti(g: CanvasRenderingContext2D): void {
    for (let i = 0; i < confetti.length; i += 5) {
      const x = Math.round(confetti[i] + Math.sin(confetti[i + 4] + t / 13) * 6)
      const y = Math.round(confetti[i + 1])
      g.fillStyle = CONFETTI[confetti[i + 3]]
      if ((t + i) % 16 < 8) g.fillRect(x, y, 2, 2)
      else g.fillRect(x, y, 3, 1)
    }
  }

  const scene: EndingScene = {
    get phase() {
      return phase
    },
    get card() {
      return card
    },
    enter(game) {
      const data = game.save.data
      data.finished = true
      game.save.commit()
      game.audio.music('ending')
      card = data.champion ? 'champion' : !data.secretFound ? 'rumour' : ''
      const n = finalNumbers(game.save)
      numberRows = [
        ['LEVELS CLEARED', n.cleared + ' / 8'],
        ['SPOTLESS LEVELS', n.spotless + ' / 8'],
        ['GOLD TOKENS', n.tokens + ' / 24'],
        ['HIGH SCORE', counter(n.hiScore, 7)],
      ]
      credits = [
        'SUPER MIGHTY MAXX',
        '',
        'STARRING',
        'MIGHTY MAXX',
        '',
        'WITH',
        'THE CARS OF WEST TEXAS',
        'COMPACTS, SEDANS, SUVS, PICKUPS,',
        'SPORTS CARS, VANS AND MONSTER TRUCKS',
        '',
        'AND THE MUD',
        'MUDSLINGER    MUDZILLA',
        'GRACKLES, BUGS, BLOBS AND TUMBLEWEEDS',
        '',
        'THE RIVALS',
        data.secretFound ? 'BUCKET BILL    SIR STREAKS' : '? ? ?',
        data.secretFound ? 'SLICK OLLIE    NIMBUS NICK' : 'STILL HIDING SOMEWHERE',
        '',
        'SPECIAL THANKS',
        'EVERY ATTENDANT WHO EVER PREPPED A CAR',
        'AND EVERY DRIVER WHO CAME BACK SHINY',
        '',
        '',
        'A MIGHTY WASH PRODUCTION',
      ]
      creditY = HORIZON
      go('thanks')
    },
    update(game, input) {
      t++
      phaseT++
      if (!win.length) win = game.sprites.anim('maxx', 'win')
      if (gone) return
      const press = input.pressed.confirm && phaseT >= MIN_T

      for (let i = 0; i < confetti.length; i += 5) {
        confetti[i + 1] += confetti[i + 2]
        if (confetti[i + 1] > VIEW_H && (phase === 'thanks' || phase === 'numbers')) confetti[i + 1] -= VIEW_H + 20
      }
      // Now and then a car in the parade honks as it passes the podium.
      if (honkT > 0) honkT--
      if (--nextHonk <= 0) {
        nextHonk = 260 + Math.floor(r() * 200)
        if (phase !== 'end') {
          game.audio.sfx('honk')
          // The car nearest the podium honks it.
          honkCar = Math.round((t * PARADE_SPEED - VIEW_W - 80 + PODIUM_X + 60) / PARADE_GAP)
          honkT = HONK_TICKS
        }
      }

      if (phase === 'thanks') {
        // The first press shows every line at once, the next one moves on.
        const all = 30 + (THANKS.length - 1) * THANKS_EVERY
        if (phaseT >= THANKS_TICKS) go('numbers')
        else if (press) {
          if (phaseT < all) phaseT = all
          else go('numbers')
        }
      } else if (phase === 'numbers') {
        if (phaseT % ROWS_EVERY === 0 && phaseT / ROWS_EVERY <= numberRows.length) game.audio.sfx(phaseT / ROWS_EVERY === numberRows.length ? 'tallyEnd' : 'tally')
        if (phaseT >= NUMBERS_TICKS || (press && phaseT > ROWS_EVERY * numberRows.length)) go('credits')
        else if (press) phaseT = ROWS_EVERY * numberRows.length
      } else if (phase === 'credits') {
        creditY -= input.held.confirm || input.held.jump ? CREDIT_SPEED * 5 : CREDIT_SPEED
        if (creditY < -credits.length * CREDIT_PITCH - 10) nextAfterCredits()
      } else if (phase === 'card') {
        if (phaseT >= CARD_TICKS || press) go('end')
      } else if (phaseT >= END_TICKS || press) {
        game.audio.sfx('menuSelect')
        finish(game)
      }
    },
    render(game, g) {
      const cx = VIEW_W >> 1
      drawSky(game, g)
      if (phase === 'credits') {
        // Behind the land: they rise out from behind the mesas.
        for (let i = 0; i < credits.length; i++) {
          const y = Math.round(creditY + i * CREDIT_PITCH)
          if (y < -16 || y > HORIZON) continue
          const line = credits[i]
          const head = i === 0 || line === 'STARRING' || line === 'WITH' || line === 'AND THE MUD' || line === 'THE RIVALS' || line === 'SPECIAL THANKS'
          const big = i === 0 || i === credits.length - 1
          say(g, line, cx + 60, y, big ? 2 : 1, head ? PAL.yellow[2] : PAL.white, 'center', PAL.navy, PAL.navy)
        }
      }
      drawLand(game, g)

      if (phase === 'thanks') {
        drawConfetti(g)
        const drop = Math.round((1 - bounce(Math.min(1, phaseT / 40))) * -80)
        say(g, 'CONGRATULATIONS!', cx, 22 + drop, 4, PAL.yellow[2], 'center', PAL.red[1], PAL.navy)
        const shown = Math.min(THANKS.length, Math.floor((phaseT - 30) / THANKS_EVERY) + 1)
        for (let i = 0; i < shown; i++) say(g, THANKS[i], cx, 70 + i * 22 + (i >= 2 ? 14 : 0), 2, i === 2 ? PAL.yellow[2] : PAL.white, 'center', PAL.navy, PAL.navy)
      } else if (phase === 'numbers') {
        drawConfetti(g)
        const w = 340
        const h = 166
        const x = cx - (w >> 1)
        panel(g, x, 30, w, h, 'paper')
        say(g, 'YOUR WASH RECORD', cx, 46, 2, PAL.navy)
        const shown = Math.min(numberRows.length, Math.floor(phaseT / ROWS_EVERY))
        for (let i = 0; i < shown; i++) {
          say(g, numberRows[i][0], x + 26, 80 + i * 24, 1, PAL.grey[2], 'left')
          say(g, numberRows[i][1], x + w - 26, 76 + i * 24, 2, i === 3 ? PAL.red[3] : PAL.navy, 'right')
        }
      } else if (phase === 'card') {
        dim(g, 0.5)
        if (card === 'rumour') {
          panel(g, 120, 36, 400, 228, 'dark')
          say(g, 'ONE MORE THING...', cx, 52, 2, PAL.yellow[2], 'center', PAL.outline)
          game.sprites.draw(g, 'title/roof', cx, 178)
          // Somebody up there: a little figure on the roof, by the ladder.
          if ((phaseT >> 4) & 1) say(g, '?', cx + 46, 104, 2, PAL.white, 'center', PAL.outline)
          say(g, 'THEY SAY SOMEONE CLIMBED ONTO', cx, 196, 2, PAL.white, 'center', PAL.outline)
          say(g, 'THE ROOF AT MW03.', cx, 218, 2, PAL.white, 'center', PAL.outline)
          say(g, 'WHAT COULD BE UP THERE?', cx, 244, 1, PAL.purple[3])
        } else {
          panel(g, 120, 36, 400, 228, 'dialog')
          say(g, 'CHAMPION OF RIVAL ROW', cx, 52, 2, PAL.yellow[2], 'center', PAL.outline)
          game.sprites.draw(g, 'title/podium', cx, 178)
          game.sprites.draw(g, 'title/trophy', cx, 158)
          const k = phaseT % 36
          if (k < 24) game.sprites.draw(g, SPARK[k >> 2], cx + 22, 108)
          if ((phaseT + 18) % 36 < 24) game.sprites.draw(g, SPARK[((phaseT + 18) % 36) >> 2], cx - 24, 128)
          say(g, 'ALL FOUR RIVALS, WASHED.', cx, 196, 2, PAL.white, 'center', PAL.outline)
          say(g, 'NOBODY CLEANS LIKE MIGHTY MAXX.', cx, 222, 1, PAL.blue[3])
          say(g, 'THE BEST WASH IN TOWN IS MIGHTY WASH!', cx, 238, 1, PAL.blue[3])
        }
        say(g, '{confirm} NEXT', 506, 250, 1, PAL.grey[4], 'right')
      } else if (phase === 'end') {
        say(g, 'THE END', cx, 70, 5, PAL.yellow[2], 'center', PAL.red[1], PAL.navy)
        say(g, 'A MIGHTY WASH PRODUCTION', cx, 128, 1, PAL.white, 'center', undefined, PAL.navy)
        if (phaseT > 60 && phaseT % 50 < 32) say(g, 'PRESS START', cx, 160, 2, PAL.white, 'center', PAL.navy, PAL.navy)
      }
    },
  }
  return scene
}
