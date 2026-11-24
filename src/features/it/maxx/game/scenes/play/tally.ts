// The tally after a clear: cars washed of total, SPOTLESS and its bonus, the three gold
// tokens, the clock counted down into the score, the level's best. The numbers are final
// before it starts (the play scene has already paid the bonuses and written the save); this
// only shows them, one row after another. Confirm jumps to the end of the counting, and
// once everything is up, leaves.
import { VIEW_W } from '../../contract'
import type { GameCtx, InputFrame, Sprites } from '../../contract'
import { drawText, measureText } from '../../engine/text'
import type { TextStyle } from '../../engine/text'
import { PAL, blink, clockText, counter, panel } from '../../engine/ui'
import { bounceIn } from './cover'

type G = CanvasRenderingContext2D

export interface TallyData {
  /** The heading's first word: the site ('MW03'), or the level's name where the site is only '???'. */
  site: string
  /** How the level was left. */
  exit: 'goal' | 'secret'
  /** The secret exit opened the hidden road for the first time. */
  roadOpened: boolean
  carsWashed: number
  carsTotal: number
  spotless: boolean
  spotlessBonus: number
  /** As the level ended, new ones included. */
  tokens: readonly boolean[]
  /** Ticks left on the clock, and what each second of them is worth. */
  timeLeft: number
  timeRate: number
  /** The points this visit earned before the two bonuses (every attempt of it). */
  baseScore: number
  /** The best on record before this clear. */
  prevBest: number
  /** The session's score before the two bonuses (what the HUD shows until they are counted in). */
  sessionBefore: number
}

export type TallyStage = 'in' | 'cars' | 'spotless' | 'tokens' | 'time' | 'best' | 'done'

export interface Tally {
  start(data: TallyData): void
  /**
   * One tick. True once the player has seen it all and pressed on, or left it alone for ten
   * seconds. `away`: the player has left the game (the shell paused it), so it waits for them.
   */
  update(game: GameCtx, input: InputFrame | null, away?: boolean): boolean
  draw(g: G, sprites: Sprites): void
  readonly active: boolean
  readonly stage: TallyStage
  /** The level score as shown right now (it climbs while the clock is counted in). */
  readonly shownScore: number
  /** What the session score should read right now: its value before the bonuses plus what has been counted in. */
  readonly sessionShown: number
  /** The level total once everything is counted. */
  readonly total: number
  /** Ticks the HUD clock should show: what was left at the exit, draining as it is counted in. */
  readonly clockShown: number
}

const W = 404
const H = 204
const TOP = 30
const ROW0 = 52
const ROW_H = 23
const st: TextStyle = {}

const IN_TICKS = 16
const ROW_TICKS = 20
const TOKEN_TICKS = 12
/** The clock drains in about this long, however much is left. */
const COUNT_TICKS = 80
const BEST_TICKS = 34
/** Left alone on the finished tally, it moves on by itself after this long. */
const IDLE_TICKS = 600
/** Ticks before a press counts: the jump that carried him through the arch must not skip it. */
const ARM_TICKS = 10

function say(g: G, text: string, x: number, y: number, scale: number, color: string, align: 'left' | 'center' | 'right' = 'left', shadow?: string): void {
  st.scale = scale
  st.color = color
  st.align = align
  st.shadow = shadow
  st.outline = undefined
  drawText(g, text, x, y, st)
}

export function createTally(): Tally {
  let d: TallyData | null = null
  let stage: TallyStage = 'in'
  let t = 0
  let age = 0
  let rows = 0
  let carsShown = 0
  let tokensShown = 0
  let secsLeft = 0
  let secsTotal = 0
  let bonusShown = 0
  let spotShown = false
  let bestShown = false
  let title = ''
  // Row texts, remade only when their numbers move (draw() runs every display frame).
  let carsText = ''
  let carsAt = -1
  let spotText = ''
  let timeText = ''
  let timeAt = -1
  let bonusText = ''
  let bonusAt = -1
  let scoreText = ''
  let scoreAt = -1
  let prevText = ''

  const next = (s: TallyStage) => {
    stage = s
    t = 0
  }
  const total = () => (d ? d.baseScore + (d.spotless ? d.spotlessBonus : 0) + secsTotal * d.timeRate : 0)
  const shown = () => (d ? d.baseScore + (spotShown ? d.spotlessBonus : 0) + bonusShown : 0)

  /** Everything counted, at once. */
  function finish(game: GameCtx): void {
    if (!d) return
    const counting = stage !== 'best' && stage !== 'done'
    rows = 6
    carsShown = d.carsWashed
    tokensShown = 3
    spotShown = d.spotless
    secsLeft = 0
    bonusShown = secsTotal * d.timeRate
    bestShown = true
    if (counting) game.audio.sfx('tallyEnd')
    next('done')
  }

  return {
    get active() {
      return d !== null
    },
    get stage() {
      return stage
    },
    get shownScore() {
      return shown()
    },
    get sessionShown() {
      return d ? d.sessionBefore + (spotShown ? d.spotlessBonus : 0) + bonusShown : 0
    },
    get total() {
      return total()
    },
    get clockShown() {
      return d ? Math.min(Math.max(0, d.timeLeft), secsLeft * 60) : 0
    },
    start(data) {
      d = data
      stage = 'in'
      t = age = rows = carsShown = tokensShown = bonusShown = 0
      spotShown = bestShown = false
      secsTotal = secsLeft = Math.ceil(Math.max(0, data.timeLeft) / 60)
      title = data.site.toUpperCase() + (data.exit === 'secret' ? ' SECRET EXIT!' : ' CLEAR!')
      carsAt = timeAt = bonusAt = scoreAt = -1
      spotText = '+' + data.spotlessBonus
      prevText = counter(data.prevBest, 7)
    },
    update(game, input, away = false) {
      if (!d) return false
      t++
      age++
      const press = input !== null && age > ARM_TICKS && input.pressed.confirm
      if (press && stage !== 'done') {
        finish(game)
        return false
      }
      const audio = game.audio
      switch (stage) {
        case 'in':
          if (t >= IN_TICKS) next('cars')
          break
        case 'cars':
          if (t === 1) {
            rows = 1
            audio.sfx('menuMove')
          }
          // No cars in this level: the row says so and moves on.
          if (carsShown < d.carsWashed && t % 3 === 0) {
            carsShown++
            audio.sfx('tally')
          }
          if (carsShown >= d.carsWashed && t >= ROW_TICKS) next(d.spotless ? 'spotless' : 'tokens')
          break
        case 'spotless':
          if (t === 1) {
            rows = 2
            spotShown = true
            audio.sfx('powerup')
            game.input.rumble(0.3, 0.6, 160)
          }
          if (t >= ROW_TICKS + 14) next('tokens')
          break
        case 'tokens':
          if (t === 1) {
            rows = 3
            audio.sfx('menuMove')
          }
          if (tokensShown < 3 && t % TOKEN_TICKS === 0) {
            if (d.tokens[tokensShown]) audio.sfx('token')
            tokensShown++
          }
          if (tokensShown >= 3 && t >= 3 * TOKEN_TICKS + 10) next('time')
          break
        case 'time': {
          if (t === 1) rows = 5
          if (t < 12) break
          if (secsLeft > 0) {
            const step = Math.min(secsLeft, Math.max(1, Math.ceil(secsTotal / COUNT_TICKS)))
            secsLeft -= step
            bonusShown += step * d.timeRate
            if (t % 3 === 0) audio.sfx('tally')
            if (secsLeft === 0) {
              audio.sfx('tallyEnd')
              t = 100
            }
          } else if (t < 100) {
            // Nothing on the clock to count.
            t = 100
          }
          if (t >= 100 + 24) next('best')
          break
        }
        case 'best':
          if (t === 1) {
            rows = 6
            bestShown = true
            if (total() > d.prevBest) {
              audio.sfx('oneUp')
              game.input.rumble(0.4, 0.7, 220)
            } else {
              audio.sfx('menuMove')
            }
          }
          if (t >= BEST_TICKS) next('done')
          break
        case 'done':
          if (press || (t >= IDLE_TICKS && !away)) {
            d = null
            return true
          }
          break
      }
      return false
    },
    draw(g, sprites) {
      if (!d) return
      const x = (VIEW_W - W) >> 1
      const y = TOP + Math.round((1 - bounceIn(Math.min(1, age / IN_TICKS))) * -(TOP + H))
      const cx = VIEW_W >> 1
      const left = x + 30
      const right = x + W - 30
      panel(g, x, y, W, H, 'dialog')
      say(g, title, cx, y + 15, measureText(title, 3) > W - 40 ? 2 : 3, d.exit === 'secret' ? PAL.purple[3] : PAL.yellow[2], 'center', PAL.outline)
      g.fillStyle = PAL.brandBlue
      g.fillRect(x + 16, y + 43, W - 32, 1)

      if (carsAt !== carsShown) {
        carsAt = carsShown
        carsText = d.carsTotal > 0 ? carsShown + '/' + d.carsTotal : 'NONE HERE'
      }
      if (timeAt !== secsLeft) {
        timeAt = secsLeft
        timeText = 'TIME ' + clockText(secsLeft * 60)
      }
      if (bonusAt !== bonusShown) {
        bonusAt = bonusShown
        bonusText = '+' + bonusShown
      }

      let ry = y + ROW0
      if (rows >= 1) {
        sprites.draw(g, 'hud/car', left, ry + 2)
        say(g, 'CARS WASHED', left + 30, ry, 2, PAL.white)
        say(g, carsText, right, ry, 2, d.carsTotal > 0 && carsShown >= d.carsTotal ? PAL.yellow[2] : PAL.white, 'right')
      }
      ry += ROW_H
      if (rows >= 2 && spotShown) {
        // Stamped on with a thump.
        sprites.draw(g, 'hud/star', left + 12, ry + 7)
        const hot = stage === 'spotless' && t < 10 && (t & 2) === 0
        say(g, 'SPOTLESS!', left + 30, ry, 2, hot ? PAL.white : PAL.blue[3])
        say(g, spotText, right, ry, 2, PAL.yellow[2], 'right')
      } else if (rows >= 3 && !d.spotless && d.carsTotal > 0) {
        say(g, 'WASH THEM ALL FOR SPOTLESS', left + 30, ry + 4, 1, PAL.blue[3])
      }
      ry += ROW_H
      if (rows >= 3) {
        say(g, 'GOLD TOKENS', left + 30, ry, 2, PAL.white)
        sprites.draw(g, 'hud/tokenOn', left + 4, ry - 1)
        for (let i = 0; i < 3; i++) {
          const on = i < tokensShown && d.tokens[i]
          const pop = on && stage === 'tokens' && i === tokensShown - 1 && t % TOKEN_TICKS < 5 ? -3 : 0
          sprites.draw(g, on ? 'hud/tokenOn' : 'hud/tokenOff', right - 52 + i * 18, ry - 1 + pop)
        }
      }
      ry += ROW_H
      if (rows >= 5) {
        sprites.draw(g, 'hud/clock', left + 4, ry - 3)
        say(g, timeText, left + 30, ry, 2, PAL.white)
        say(g, bonusText, right, ry, 2, PAL.yellow[2], 'right')
        ry += ROW_H
        g.fillStyle = PAL.blue[1]
        g.fillRect(left, ry - 5, W - 60, 1)
        say(g, 'SCORE', left + 30, ry, 2, PAL.white)
        // Its own copy: counter() remembers one value per width, and the HUD's score is 7 digits too.
        const sc = shown()
        if (scoreAt !== sc) {
          scoreAt = sc
          scoreText = counter(sc, 7)
        }
        say(g, scoreText, right, ry, 2, stage === 'time' && secsLeft > 0 ? PAL.yellow[2] : PAL.white, 'right')
      } else {
        ry += ROW_H
      }
      ry += ROW_H
      if (rows >= 6 && bestShown) {
        const beaten = total() > d.prevBest
        if (beaten) {
          if (stage !== 'done' || blink(t, 40, 0.75)) {
            sprites.draw(g, 'hud/star', left + 12, ry + 7)
            say(g, 'NEW BEST!', left + 30, ry, 2, PAL.yellow[2])
          }
        } else {
          say(g, 'BEST', left + 30, ry, 2, PAL.blue[3])
          say(g, prevText, right, ry, 2, PAL.blue[3], 'right')
        }
      }

      if (d.roadOpened && rows >= 1) {
        // Under the panel, where the road will be: the secret's own flourish.
        const by = y + H + 8
        const bob = Math.round(Math.sin(age * 0.14) * 2)
        sprites.draw(g, 'hud/starBig', cx - 172, by + 12 + bob)
        sprites.draw(g, 'hud/starBig', cx + 172, by + 12 - bob)
        st.scale = 2
        st.color = (age >> 3) & 1 ? PAL.yellow[2] : PAL.white
        st.align = 'center'
        st.shadow = PAL.purple[0]
        st.outline = PAL.purple[1]
        drawText(g, 'A SECRET ROAD OPENS', cx, by + 5, st)
      }
      if (stage === 'done' && blink(t, 40, 0.7)) say(g, '{confirm} CONTINUE', right + 8, y + H - 18, 1, PAL.white, 'right')
    },
  }
}
