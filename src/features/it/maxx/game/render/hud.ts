// The HUD of a level: one compact row along the top edge, drawn over the world.
//
//   left    Maxx's head and lives, the three shine pips in their tray, the turbo nozzle when he has it
//   middle  wash tokens (coins), the score
//   right   cars washed of total, the three gold token slots, the clock
//   below   a wax timer while he is waxed (second row, left); a small water meter over his
//           head while he hovers; the boss's face, name and bar along the bottom edge, where
//           the floor of an arena is
//
// Every group has a fixed slot, wide enough for its longest value (99 lives, 7 digits of
// score, 99/99 cars, 10:00 on the clock), so nothing shifts or collides as numbers grow.
// Only the shine pips sit in a dark tray: they are his health and must read at a glance on a
// blue sky. Everything else carries its own outline (icons) or a navy one (text), so the row
// reads on sky, tunnel wall and snow alike and hides no more of the level than its own ink.
//
//   const hud = createHud(game.sprites)
//   hud.reset(world)            a new world: numbers snap, animations stop
//   hud.update(world)           once a tick while the level is on screen
//   hud.draw(g, world)          after the world renderer
//
// It reads the World and never writes to it. The art is the 'hud' atlas
// (scripts/maxx/art-hud.mjs) plus 'maxx/head'.
import { MAXX_W, MAX_PIPS, VIEW_H, VIEW_W } from '../contract'
import type { Sprites } from '../contract'
import { drawText, measureText } from '../engine/text'
import type { TextStyle } from '../engine/text'
import { PAL, clockText, counter, stepRect } from '../engine/ui'
import { TUNING } from '../sim'
import type { World } from '../sim/types'
import { BACK, CAM_X, CAM_Y, LERP_MAX, createLerp, lerpFrame, lerpReset, lerpTrack } from './clock'

type G = CanvasRenderingContext2D

export interface Hud {
  /** A new world (or the same one seen afresh): every number snaps to its value and animations stop. */
  reset(world: World): void
  /** One tick. Call it while the level is on screen, frozen or not; not while paused. */
  update(world: World): void
  draw(g: G, world: World): void
  /**
   * Show this score instead of the session's, which the tally has already been paid into
   * while its counters are still running. null: back to the session's own.
   */
  showScore(value: number | null): void
  /** Show this many ticks on the clock instead of world.timeLeft (the tally drains it). null: the world's own. */
  showClock(ticks: number | null): void
}

/** Top of the row's icons, and of its scale 2 text. */
const ROW = 5
const TEXT_Y = 8
const INK = PAL.white
const EDGE = PAL.navy
const GOLD = PAL.yellow[2]
const ALARM = PAL.red[5]

// Slots, left to right. Widths at scale 2: '{times}99' 40, '00' 26, '0000000' 96, '00/00' 68, '10:00' 60.
const HEAD_X = 8
const LIVES_X = 27
/** The tray round the pips: 3 px of rim, then the beads 20 apart. */
const TRAY_X = 76
const TRAY_Y = 2
const TRAY_W = 64
const TRAY_H = 24
const PIPS_X = TRAY_X + 3
const PIP_STEP = 20
const PIP_SIZE = 18
const TURBO_X = 147
const COIN_X = 180
const COIN_TEXT_X = 199
const SCORE_X = 243
const CAR_X = 357
const CARS_X = 386
const TOKENS_X = 476
const TOKEN_STEP = 18
const CLOCK_RIGHT = 632
const WAX_Y = 30
const BOSS_W = 300
const BOSS_Y = 318

/** Under a minute the clock is in alarm, and the play scene hurries the music. */
export const HURRY_TICKS = 60 * 60
const LAST_TICKS = 10 * 60

const LOST_TICKS = 26
const WON_TICKS = 18
const SHAKE_TICKS = 22
const HOP_TICKS = 12
const HOVER_LINGER = 20
const BOSS_SLIDE = 10
const BOSS_HOLD = 24

// Six ways a lost pip's shards fly, as whole pixels per step.
const SHARD_X = [3, 2, -2, -3, -2, 2]
const SHARD_Y = [0, -3, -3, 0, 2, 2]
const SPARK = ['hud/spark0', 'hud/spark1', 'hud/spark2', 'hud/spark1', 'hud/spark0']

/**
 * The face beside the boss bar, by the name the fight gives setBoss(). The mud clod suits
 * MUDSLINGER and MUDZILLA; beside a knight or a cloud it would name the wrong fighter.
 * A fight not listed here keeps the clod.
 */
const BOSS_ICON: Record<string, string> = {
  'BUCKET BILL': 'hud/bossBill',
  'SIR STREAKS': 'hud/bossStreaks',
  'SLICK OLLIE': 'hud/bossOllie',
  'NIMBUS NICK': 'hud/bossNick',
}
const BOSS_ICON_MUD = 'hud/boss'

const st: TextStyle = {}

function text(g: G, s: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right' = 'left', scale = 2): void {
  st.color = color
  st.outline = EDGE
  st.shadow = undefined
  st.scale = scale
  st.align = align
  drawText(g, s, x, y, st)
}

/** A hop that rises and lands: 0 at both ends of `len`, `high` pixels up in the middle. */
function hop(t: number, len: number, high: number): number {
  return t > 0 && t < len ? -Math.round(Math.sin((t / len) * Math.PI) * high) : 0
}

export function createHud(sprites: Sprites): Hud {
  let tick = 0
  let pips = MAX_PIPS
  const lostT = new Int16Array(MAX_PIPS)
  const wonT = new Int16Array(MAX_PIPS)
  let shakeT = 0

  let lives = -1
  let livesText = ''
  let livesT = 0

  let coins = -1
  let coinT = 0
  let score = 0
  let scoreShown = 0
  let scoreOver: number | null = null

  let washed = -1
  let carsTotal = -1
  let carsText = ''
  let carsT = 0

  const tokens = [false, false, false]
  const tokenT = new Int16Array(3)

  let clockSec = -1
  let clockStr = ''
  let clockW = 0
  let clockOver: number | null = null

  let hoverShow = 0
  // The hover meter rides over his head, so between two ticks it slides with him as the world
  // renderer draws him (render/clock.ts).
  const lerp = createLerp()

  let bossName = ''
  let bossIcon = BOSS_ICON_MUD
  let bossT = 0
  let bossFrac = 1
  let bossGhost = 1
  let bossHold = 0
  let bossFlash = 0

  function seeLives(n: number): void {
    lives = n
    livesText = '{times}' + n
  }
  function seeCars(w: World): void {
    washed = w.stats.carsWashed
    carsTotal = w.stats.carsTotal
    carsText = washed + '/' + carsTotal
  }
  function seeClock(w: World): void {
    const sec = Math.floor(Math.max(0, clockOver ?? w.timeLeft) / 60)
    if (sec === clockSec) return
    clockSec = sec
    clockStr = clockText(sec * 60)
    clockW = measureText(clockStr, 2)
  }

  function drawPips(g: G): void {
    const dx = shakeT > 0 ? ((shakeT >> 1) & 1 ? 1 : -1) * Math.ceil(shakeT / 8) : 0
    // The tray: dark, lit along its top edge, and it shakes with the pips when one is lost.
    const tx = TRAY_X + dx
    stepRect(g, tx, TRAY_Y, TRAY_W, TRAY_H, 3, PAL.outline)
    stepRect(g, tx + 1, TRAY_Y + 1, TRAY_W - 2, TRAY_H - 2, 2, pips === 1 && (tick >> 3) & 1 ? PAL.red[0] : PAL.navy)
    g.fillStyle = PAL.blue[1]
    g.fillRect(tx + 3, TRAY_Y + 1, TRAY_W - 6, 1)
    for (let i = 0; i < MAX_PIPS; i++) {
      const x = PIPS_X + i * PIP_STEP + dx
      const lt = lostT[i]
      const wt = wonT[i]
      const y = ROW + hop(wt, WON_TICKS, 5)
      let frame = i < pips ? 'hud/pip' : 'hud/pipEmpty'
      // The last one left throbs red: he is one hit from GRIMED.
      if (pips === 1 && i === 0 && (tick >> 3) & 1) frame = 'hud/pipWarn'
      if ((lt > 0 && lt <= 6 && (lt & 1) === 1) || (wt > 0 && wt <= 4)) frame = 'hud/pipFlash'
      sprites.draw(g, frame, x, y)
      if (lt > 4) {
        const d = lt - 4
        const size = lt < 16 ? 3 : 2
        const cx = x + PIP_SIZE / 2
        const cy = ROW + PIP_SIZE / 2
        for (let k = 0; k < 6; k++) {
          g.fillStyle = k & 1 ? PAL.blue[4] : PAL.white
          // Flung out, then pulled down a little.
          g.fillRect(cx + SHARD_X[k] * d - 1, cy + SHARD_Y[k] * d + ((d * d) >> 4) - 1, size, size)
        }
      }
      if (wt > 2) sprites.draw(g, SPARK[Math.min(SPARK.length - 1, Math.floor(((wt - 2) * SPARK.length) / (WON_TICKS - 2)))], x + 5, y + 5)
    }
  }

  function drawBoss(g: G): void {
    if (bossT <= 0) return
    const x = (VIEW_W - BOSS_W) >> 1
    const y = BOSS_Y + (BOSS_SLIDE - bossT) * 5
    sprites.draw(g, bossIcon, x, y - 2)
    text(g, bossName, x + 21, y, INK)
    const by = y + 19
    const h = 12
    g.fillStyle = PAL.outline
    g.fillRect(x - 2, by - 2, BOSS_W + 4, h + 4)
    g.fillStyle = bossFlash > 0 ? GOLD : INK
    g.fillRect(x - 1, by - 1, BOSS_W + 2, h + 2)
    g.fillStyle = PAL.grey[0]
    g.fillRect(x, by, BOSS_W, h)
    const full = BOSS_W - 2
    // What the last hits took lingers in yellow for a moment, so each one can be seen to count.
    const ghost = Math.round(full * bossGhost)
    let fill = Math.round(full * bossFrac)
    if (bossFrac > 0 && fill < 1) fill = 1
    if (ghost > fill) {
      g.fillStyle = GOLD
      g.fillRect(x + 1 + fill, by + 1, ghost - fill, h - 2)
    }
    if (fill > 0) {
      g.fillStyle = PAL.red[3]
      g.fillRect(x + 1, by + 1, fill, h - 2)
      g.fillStyle = PAL.red[5]
      g.fillRect(x + 1, by + 1, fill, 2)
      g.fillStyle = PAL.red[1]
      g.fillRect(x + 1, by + h - 3, fill, 2)
    }
  }

  return {
    reset(w) {
      pips = w.player.pips
      lostT.fill(0)
      wonT.fill(0)
      shakeT = 0
      seeLives(w.session.lives)
      livesT = 0
      coins = w.session.coins
      coinT = 0
      score = scoreShown = w.session.score
      scoreOver = null
      clockOver = null
      seeCars(w)
      carsT = 0
      for (let i = 0; i < 3; i++) tokens[i] = w.stats.tokens[i]
      tokenT.fill(0)
      clockSec = -1
      seeClock(w)
      hoverShow = 0
      lerpReset(lerp, w)
      bossT = 0
      bossName = ''
      bossIcon = BOSS_ICON_MUD
      bossFrac = bossGhost = 1
      bossHold = bossFlash = 0
    },

    update(w) {
      tick++
      lerpTrack(lerp, w)
      const p = w.player
      if (p.pips < pips) {
        for (let i = Math.max(0, p.pips); i < pips; i++) {
          lostT[i] = 1
          wonT[i] = 0
        }
        shakeT = SHAKE_TICKS
      } else if (p.pips > pips) {
        for (let i = pips; i < p.pips && i < MAX_PIPS; i++) {
          wonT[i] = 1
          lostT[i] = 0
        }
      }
      pips = p.pips
      for (let i = 0; i < MAX_PIPS; i++) {
        if (lostT[i] > 0 && ++lostT[i] > LOST_TICKS) lostT[i] = 0
        if (wonT[i] > 0 && ++wonT[i] > WON_TICKS) wonT[i] = 0
      }
      if (shakeT > 0) shakeT--

      const s = w.session
      if (s.lives !== lives) {
        if (s.lives > lives) livesT = 1
        seeLives(s.lives)
      }
      if (livesT > 0 && ++livesT > 2 * HOP_TICKS) livesT = 0
      if (s.coins !== coins) {
        coins = s.coins
        coinT = 1
      }
      if (coinT > 0 && ++coinT > HOP_TICKS) coinT = 0

      score = scoreOver ?? s.score
      if (scoreShown < score) scoreShown += Math.max(1, Math.ceil((score - scoreShown) / 6))
      if (scoreShown > score) scoreShown = score

      if (w.stats.carsWashed !== washed || w.stats.carsTotal !== carsTotal) {
        if (w.stats.carsWashed > washed) carsT = 1
        seeCars(w)
      }
      if (carsT > 0 && ++carsT > HOP_TICKS) carsT = 0
      for (let i = 0; i < 3; i++) {
        if (w.stats.tokens[i] && !tokens[i]) tokenT[i] = 1
        tokens[i] = w.stats.tokens[i]
        if (tokenT[i] > 0 && ++tokenT[i] > WON_TICKS) tokenT[i] = 0
      }
      seeClock(w)

      if (p.hovering && w.status === 'play') hoverShow = HOVER_LINGER
      else if (hoverShow > 0) hoverShow = p.onGround ? 0 : hoverShow - 1

      const b = w.boss
      if (b) {
        if (bossT === 0 || b.name !== bossName) {
          bossName = b.name.toUpperCase()
          const icon = BOSS_ICON[bossName]
          bossIcon = icon && sprites.has(icon) ? icon : BOSS_ICON_MUD
          bossGhost = 1
        }
        const frac = b.maxHp > 0 ? Math.max(0, Math.min(1, b.hp / b.maxHp)) : 0
        if (frac < bossFrac) {
          bossHold = BOSS_HOLD
          bossFlash = 4
        }
        bossFrac = frac
        if (bossT < BOSS_SLIDE) bossT++
      } else if (bossT > 0) {
        bossT--
      }
      if (bossFlash > 0) bossFlash--
      if (bossHold > 0) bossHold--
      else if (bossGhost > bossFrac) bossGhost = Math.max(bossFrac, bossGhost - 0.012)
      if (bossGhost < bossFrac) bossGhost = bossFrac
    },

    showScore(value) {
      scoreOver = value
    },

    showClock(ticks) {
      clockOver = ticks
    },

    draw(g, w) {
      const p = w.player

      /* left: lives, shine, turbo */
      sprites.draw(g, 'maxx/head', HEAD_X, ROW + 1 + hop(livesT, HOP_TICKS, 4))
      text(g, livesText, LIVES_X, TEXT_Y, livesT > 0 && (livesT >> 2) & 1 ? GOLD : INK)
      drawPips(g)
      if (p.turbo) sprites.draw(g, 'hud/turbo', TURBO_X, ROW + 4)

      /* middle: coins, score */
      sprites.draw(g, 'hud/coin', COIN_X, ROW + 1 + hop(coinT, HOP_TICKS, 3))
      text(g, counter(coins, 2), COIN_TEXT_X, TEXT_Y, INK)
      text(g, counter(scoreShown, 7), SCORE_X, TEXT_Y, scoreShown < score ? GOLD : INK)

      /* right: cars, tokens, clock */
      if (carsTotal > 0) {
        const done = washed >= carsTotal
        sprites.draw(g, 'hud/car', CAR_X, ROW + 4 + hop(carsT, HOP_TICKS, 4))
        text(g, carsText, CARS_X, TEXT_Y, done ? GOLD : INK)
      }
      for (let i = 0; i < 3; i++) {
        const tt = tokenT[i]
        const tx = TOKENS_X + i * TOKEN_STEP
        const ty = ROW + 1 + hop(tt, WON_TICKS, 6)
        sprites.draw(g, tokens[i] ? 'hud/tokenOn' : 'hud/tokenOff', tx, ty)
        if (tt > 2) sprites.draw(g, SPARK[Math.min(SPARK.length - 1, Math.floor(((tt - 2) * SPARK.length) / (WON_TICKS - 2)))], tx + 8, ty + 8)
      }
      const playing = w.status === 'play'
      const hot = w.timeLeft < HURRY_TICKS && playing
      const last = w.timeLeft < LAST_TICKS && playing
      // Out of time it stays red, at 0:00.
      const lit = (hot && (tick >> (last ? 2 : 4)) & 1) || w.status === 'timeup'
      text(g, clockStr, CLOCK_RIGHT, TEXT_Y, lit ? ALARM : INK, 'right')
      sprites.draw(g, lit ? 'hud/clockHot' : 'hud/clock', CLOCK_RIGHT - clockW - 20 + (last && (tick >> 1) & 1 ? 1 : 0), ROW)

      /* second row: wax */
      if (p.wax > 0) {
        // The last two seconds blink: time to stop running into things.
        const ending = p.wax < 120 && (tick >> 2) & 1
        sprites.draw(g, 'hud/wax', HEAD_X + 2, WAX_Y)
        const bx = HEAD_X + 18
        const bw = 84
        g.fillStyle = PAL.outline
        g.fillRect(bx - 1, WAX_Y + 2, bw + 2, 10)
        g.fillStyle = PAL.grey[1]
        g.fillRect(bx, WAX_Y + 3, bw, 8)
        const fill = Math.max(1, Math.round((bw * p.wax) / TUNING.waxTicks))
        g.fillStyle = ending ? PAL.white : PAL.yellow[1]
        g.fillRect(bx, WAX_Y + 3, Math.min(bw, fill), 8)
        g.fillStyle = ending ? PAL.white : PAL.yellow[2]
        g.fillRect(bx, WAX_Y + 3, Math.min(bw, fill), 2)
      }

      /* over his head: hover water */
      if (hoverShow > 0) {
        const bw = 30
        lerpFrame(lerp, w)
        const back = lerp[BACK]
        let mx = Math.round(p.x)
        let my = Math.round(p.y)
        const dx = p.x - p.px
        const dy = p.y - p.py
        if (back > 0 && dx <= LERP_MAX && dx >= -LERP_MAX && dy <= LERP_MAX && dy >= -LERP_MAX) {
          mx = Math.round(p.x - dx * back)
          my = Math.round(p.y - dy * back)
        }
        const cx = mx - Math.round(lerp[CAM_X]) + MAXX_W / 2
        const bx = Math.max(16, Math.min(VIEW_W - bw - 4, cx - (bw >> 1) + 5))
        const by = Math.max(WAX_Y + 2, Math.min(VIEW_H - 12, my - Math.round(lerp[CAM_Y]) - 24))
        g.fillStyle = PAL.outline
        g.fillRect(bx - 1, by - 1, bw + 2, 7)
        g.fillStyle = PAL.grey[1]
        g.fillRect(bx, by, bw, 5)
        const fill = Math.round((bw * Math.max(0, p.hover)) / TUNING.hoverTicks)
        if (fill > 0) {
          g.fillStyle = PAL.teal[1]
          g.fillRect(bx, by, fill, 5)
          g.fillStyle = PAL.teal[2]
          g.fillRect(bx, by, fill, 1)
        }
        sprites.draw(g, 'hud/drop', bx - 11, by - 3)
      }

      drawBoss(g)
    },
  }
}
