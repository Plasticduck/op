// The play scene: one visit to a level, from its card to its tally.
//
//   game.go('play', { level: 'mw01' })
//
// card -> open -> run -> ( close -> card -> open -> run )* -> tally -> map / ending / gameover
//
//   card   the level card (about 90 ticks; confirm skips it), or the short lives card of a retry
//   open   the level appears through an iris on Maxx; the world is held until it is open
//   run    the level is played: stepWorld, every event to the world renderer and the speakers,
//          the HUD on top. The pause menu and the versus card hold it. It also covers the
//          end of an attempt: the flop after GRIMED! or TIME UP!, the victory walk
//   close  an iris shuts on Maxx; a life is gone and the next world starts from the checkpoint
//   tally  the bonuses are counted in over the level; the save is already written
//
// The simulation never takes a life and never pays the SPOTLESS bonus: this scene does both,
// and it is the only thing that writes progress to the save (scenes/play/record.ts has the rules).
// A clear is paid and saved on the tick it happens, so closing the page during the fanfare
// keeps it. The tally comes down once the fanfare ('clear' or 'secret') has finished, so its
// counting is heard on its own; confirm after the walk brings it sooner.
//
// Params: `level` (a level id; an id with no level behind it goes straight back to the map),
// `card: false` (no level card). On the dev page only: `area`, `col`, `row` start Maxx
// there, `boxes: true` shows collision boxes, `readout: false` hides the fps line.
// Leaves with go('map', { from, exit: 'goal' | 'secret' | 'quit' }), go('ending', the same)
// after the last level's first clear (a replay of it goes back to the map), or go('gameover', { from }).
//
// For scripts: the scene object has `world` (the World, or null), `renderer` (its world
// renderer, or null) and `state()` (a snapshot of where the scene is: phase, pause screen,
// banner, tally stage ...).
import { ACTIONS, MAXX_H, MAXX_W, STEP_HZ, TILE, VIEW_H, VIEW_W } from '../contract'
import type { ActionState, GameCtx, InputFrame, JingleId, LevelDef, MusicId, Scene, SceneId, SceneParams, Session, Transition } from '../contract'
import { songSeconds } from '../audio/format'
import { SONGS } from '../audio/library'
import { drawText } from '../engine/text'
import type { TextStyle } from '../engine/text'
import { PAL } from '../engine/ui'
import { levelById } from '../levels'
import { HURRY_TICKS, createHud } from '../render/hud'
import type { Hud } from '../render/hud'
import { createWorldRenderer } from '../render/world'
import type { WorldRenderer } from '../render/world'
import { TUNING, areaMusic, createWorld, entityById, isSpotless, stepWorld } from '../sim'
import type { World, WorldOpts } from '../sim'
import { createBanner } from './play/banner'
import type { Banner } from './play/banner'
import { CARD_MIN_TICKS, CARD_TICKS, RETRY_CARD_TICKS, createVersus, drawLevelCard, drawRetryCard } from './play/cards'
import { COVER, drawIris, drawShade, irisFar } from './play/cover'
import { createPauseMenu } from './play/pause'
import type { PauseMenu, PauseScreen } from './play/pause'
import { LAST_LEVEL_ID, RIVALS_ID, findsHiddenRoad, noteRivals, noteScore, recordOf, writeClear } from './play/record'
import { createTally } from './play/tally'
import type { TallyData, TallyStage } from './play/tally'

export type PlayPhase = 'card' | 'open' | 'run' | 'close' | 'tally' | 'leave'

/** Where the scene is, for the debug API and the check scripts. A fresh object on every call. */
export interface PlayState {
  level: string
  phase: PlayPhase
  /** Ticks in this phase. */
  phaseT: number
  /** The card showing is the lives card of a retry. */
  retryCard: boolean
  paused: boolean
  /** Which part of the pause menu is up, '' when not paused. */
  screen: PauseScreen | ''
  /** The row under the pause menu's cursor. */
  menuIndex: number
  /** The banner on screen, '' for none. */
  banner: string
  /** The rival whose versus card is holding the level, '' for none. */
  versus: string
  /** The scale its picture is drawn at on the card (2 or 3), 0 before the card is drawn or with no picture. */
  versusScale: number
  tally: TallyStage | ''
  /** Under a minute: the music is hurried. */
  hurry: boolean
  /** Ticks played in this visit before the attempt now running. */
  visitTicks: number
}

export type PlayScene = Scene & { readonly world: World | null; readonly renderer: WorldRenderer | null; state(): PlayState }

/** Points for each second left on the clock at the exit. */
export const TIME_BONUS_PER_SECOND = 20
/** How much faster the song plays under a minute. */
export const HURRY_TEMPO = 1.25

/** Ticks the flop and the grimed jingle get before the life is taken. */
const LOST_TICKS = 170
/** The shortest victory walk and pose before the tally, whatever the fanfare. */
const CLEAR_MIN_TICKS = 170
/** Ticks the tally waits after the fanfare has ended. */
const CLEAR_AFTER_TICKS = 8
/** From here on confirm brings the tally at once (the walk itself is about 80 ticks). */
const CLEAR_SKIP_TICKS = 96
const OPEN_TICKS = 20
const CLOSE_TICKS = 22
/** Ticks of darkening before a pipe or door cut, and of clearing after it. */
const SHADE_TICKS = 8

// These leave silence behind them: what plays next is the tally's business, or the next attempt's.
const THEN_QUIET: { thenMusic: MusicId | null } = { thenMusic: null }
const QUIET_AFTER: ReadonlySet<JingleId> = new Set<JingleId>(['clear', 'secret', 'grimed', 'gameover'])
const RESTART = { restart: true }

/** The bosses and rivals: what a level with one of them in it will ask for, so it is rendered before the fight. */
const FIGHT_SOUNDS: Record<string, (MusicId | JingleId)[]> = {
  mudslinger: ['versus', 'boss', 'rivalDown'],
  mudzilla: ['versus', 'boss'],
  bill: ['versus', 'rival', 'rivalDown', 'champion'],
  streaks: ['versus', 'rival', 'rivalDown', 'champion'],
  ollie: ['versus', 'rival', 'rivalDown', 'champion'],
  nick: ['versus', 'rival', 'rivalDown', 'champion'],
}
const RESUME = { resume: true }

/** How long a jingle plays, in ticks; 0 while it has no song. */
function jingleTicks(id: JingleId): number {
  const song = Object.prototype.hasOwnProperty.call(SONGS, id) ? SONGS[id] : null
  return song && song.ok ? Math.ceil(songSeconds(song) * STEP_HZ) : 0
}

function noActions(): ActionState {
  const s = {} as ActionState
  for (const a of ACTIONS) s[a] = false
  return s
}
/** Nothing pressed: what the level gets while a transition covers the screen. */
const IDLE: InputFrame = { held: noActions(), pressed: noActions(), released: noActions(), repeat: noActions(), axisX: 0, axisY: 0, device: 'keyboard' }

function anyPressed(input: InputFrame): boolean {
  for (let i = 0; i < ACTIONS.length; i++) if (input.pressed[ACTIONS[i]]) return true
  return false
}

/** `from` with spray let go, written into `out` (the shell's frame is not ours to change). */
function withoutSpray(from: InputFrame, out: InputFrame): InputFrame {
  for (let i = 0; i < ACTIONS.length; i++) {
    const a = ACTIONS[i]
    out.held[a] = from.held[a]
    out.pressed[a] = from.pressed[a]
    out.released[a] = from.released[a]
    out.repeat[a] = from.repeat[a]
  }
  out.held.spray = out.pressed.spray = false
  out.axisX = from.axisX
  out.axisY = from.axisY
  out.device = from.device
  return out
}

const st: TextStyle = {}

export function createPlayScene(): PlayScene {
  let level: LevelDef | null = null
  let world: World | null = null
  let renderer: WorldRenderer | null = null
  let hud: Hud | null = null
  let banner: Banner | null = null
  let pause: PauseMenu | null = null
  const versus = createVersus()
  const tally = createTally()

  let phase: PlayPhase = 'leave'
  let phaseT = 0
  let cardTicks = CARD_TICKS
  let retryCard = false
  let paused = false
  // The shell asked for a pause (the player left) at a moment with nothing to pause: it waits
  // for the level, until the player is back (any button) or the level is on.
  let wantPause = false
  let hiss = false
  let hurry = false
  let shadeT = 0
  let visitTicks = 0
  let tick = 0
  let versusAt = -1
  /** The clear, paid and saved, waiting for its tally; and how long its victory walk lasts. */
  let cleared: TallyData | null = null
  let victoryTicks = CLEAR_MIN_TICKS
  /** This clear finished the game for the first time: the ending follows its tally, not the map. */
  let firstFinish = false
  // B is cancel as well as spray, and backs out of the pause menu: the press that resumes must
  // not also spray for as long as it is held. Spray stays off until the button is let go.
  let sprayHeldOver = false
  const unsprayed: InputFrame = { held: noActions(), pressed: noActions(), released: noActions(), repeat: noActions(), axisX: 0, axisY: 0, device: 'keyboard' }
  let entry: Session = { lives: 0, score: 0, coins: 0, pips: 0, turbo: false }
  let devStart: WorldOpts['checkpoint'] = null
  let boxes = false
  let readout = false
  let readoutText = ''
  let readoutAt = -1
  let irisX = VIEW_W / 2
  let irisY = VIEW_H / 2

  // The spray loop is told only when it changes.
  function setHiss(game: GameCtx, on: boolean): void {
    if (on === hiss) return
    hiss = on
    game.audio.spray(on)
  }

  /** Where Maxx is on screen: the middle of every iris. Kept inside the picture when he has fallen out of it. */
  function findMaxx(w: World): void {
    const p = w.player
    irisX = Math.max(0, Math.min(VIEW_W, Math.round(p.x) - Math.round(w.camera.x) + MAXX_W / 2))
    irisY = Math.max(0, Math.min(VIEW_H, Math.round(p.y) - Math.round(w.camera.y) + MAXX_H / 2))
  }

  function makeRenderer(game: GameCtx): void {
    // Shake on: drain() leaves the shake events out while the setting is off, so OPTIONS can switch it either way mid-level.
    renderer = createWorldRenderer(game.sprites, { shake: true, debug: boxes })
    if (world) renderer.reset(world)
  }

  /** A new world: a first visit from the level's start, or the next attempt from the checkpoint. */
  function build(game: GameCtx, how: 'fresh' | 'retry'): void {
    const lv = level
    if (!lv) return
    const opts: WorldOpts = { session: game.session }
    if (how === 'retry' && world) {
      opts.checkpoint = world.checkpoint
      opts.flags = world.flags
      opts.tokens = world.stats.tokens
    } else {
      const rec = recordOf(game.save, lv.id)
      if (rec) opts.tokens = [rec.tokens[0], rec.tokens[1], rec.tokens[2]]
      if (lv.id === RIVALS_ID) opts.flags = { rivalsBeaten: game.save.data.rivalsBeaten }
      if (devStart) opts.checkpoint = devStart
    }
    world = createWorld(lv, opts)
    renderer?.reset(world)
    hud?.reset(world)
    banner?.clear()
    versus.stop()
    hurry = false
    shadeT = 0
    cleared = null
    firstFinish = false
    sprayHeldOver = false
    setHiss(game, false)
  }

  function showCard(retry: boolean, ticks = retry ? RETRY_CARD_TICKS : CARD_TICKS): void {
    phase = 'card'
    phaseT = 0
    retryCard = retry
    cardTicks = ticks
  }

  function openLevel(game: GameCtx, w: World): void {
    phase = 'open'
    phaseT = 0
    game.audio.music(areaMusic(w), RESTART)
  }

  function setPaused(game: GameCtx, on: boolean): void {
    paused = on
    if (on) {
      setHiss(game, false)
      pause?.open(game)
    }
    game.audio.setPaused(on)
    game.audio.sfx(on ? 'pause' : 'unpause')
  }

  function leave(game: GameCtx, to: SceneId, params: SceneParams, how: Transition): void {
    phase = 'leave'
    paused = false
    setHiss(game, false)
    game.audio.setPaused(false)
    game.audio.setTempoScale(1)
    game.audio.music(null)
    noteScore(game.save, game.session.score)
    game.go(to, params, how)
  }

  /**
   * RESTART LEVEL and EXIT TO MAP undo the visit: its points, coins and power-ups go, and so
   * do lives it won, but not lives it lost (or quitting would be a way to win them back).
   */
  function undoVisit(game: GameCtx): void {
    const s = game.session
    const lives = Math.min(entry.lives, s.lives)
    Object.assign(s, entry)
    s.lives = lives
  }

  function restart(game: GameCtx): void {
    undoVisit(game)
    paused = false
    // A versus or rivalDown jingle the pause was holding must not play on over the level card.
    game.audio.stopJingle()
    game.audio.setPaused(false)
    game.audio.setTempoScale(1)
    game.audio.music(null)
    visitTicks = 0
    build(game, 'fresh')
    showCard(false)
  }

  function playJingle(game: GameCtx, id: JingleId): void {
    if (id === 'versus') {
      // A rival may ask for its jingle as well as its card: one is enough.
      if (versusAt === tick) return
      versusAt = tick
    }
    game.audio.jingle(id, QUIET_AFTER.has(id) ? THEN_QUIET : undefined)
  }

  function drain(game: GameCtx, w: World): void {
    const r = renderer
    const events = w.events
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      switch (ev.type) {
        case 'sfx':
          game.audio.sfx(ev.id)
          break
        case 'music':
          game.audio.music(ev.id)
          // A new song starts at its own tempo.
          if (hurry) game.audio.setTempoScale(HURRY_TEMPO)
          break
        case 'jingle':
          playJingle(game, ev.id)
          break
        case 'rumble':
          game.input.rumble(ev.strong, ev.weak, ev.ms)
          break
        case 'banner':
          // GRIMED! and TIME UP! stay up until the iris has shut on them.
          banner?.show(ev.text, w.status === 'grimed' || w.status === 'timeup' ? lostTicks(game) + CLOSE_TICKS + 20 : ev.ticks)
          break
        case 'versus':
          versus.start(ev.name, ev.tagline, entityById(w, ev.id), w)
          playJingle(game, 'versus')
          setHiss(game, false)
          break
        case 'area':
          // The renderer resets itself on this event; the scene darkens the cut.
          shadeT = SHADE_TICKS
          break
        case 'checkpoint':
          banner?.show('CHECKPOINT!', 84)
          break
        case 'secret':
          // Up until the tally takes over (secretFound is still as it was: the save is written after this).
          banner?.show(findsHiddenRoad(w.level.id) && !game.save.data.secretFound ? 'A SECRET ROAD OPENS' : 'SECRET EXIT!', Math.max(CLEAR_MIN_TICKS, jingleTicks('secret') + CLEAR_AFTER_TICKS) + 30)
          break
        case 'shake':
          if (!game.save.data.settings.shake) continue
          break
      }
      r?.event(ev, w)
    }
    events.length = 0
  }

  /**
   * How long the flop lasts before the life is taken. With lives left the grimed jingle plays on
   * over the iris and the lives card; on the last one it plays out before GAME OVER takes over.
   */
  function lostTicks(game: GameCtx): number {
    return game.session.lives <= 1 ? Math.max(LOST_TICKS, jingleTicks('grimed') + CLEAR_AFTER_TICKS) : LOST_TICKS
  }

  function lose(game: GameCtx, w: World): void {
    const s = game.session
    s.lives = Math.max(0, s.lives - 1)
    if (s.lives > 0) {
      phase = 'close'
      phaseT = 0
      return
    }
    findMaxx(w)
    game.irisAt(irisX, irisY)
    leave(game, 'gameover', { from: w.level.id }, 'iris')
  }

  /** On the tick of a clear: pay the bonuses into the session, write the save, and keep the numbers for the tally. */
  function payClear(game: GameCtx, w: World): void {
    const s = game.session
    const spotless = isSpotless(w)
    const sessionBefore = s.score
    // The level's score is what the whole visit earned: an attempt from a checkpoint alone would
    // leave out everything before the checkpoint.
    const baseScore = Math.max(0, s.score - entry.score)
    const bonus = Math.ceil(w.timeLeft / 60) * TIME_BONUS_PER_SECOND + (spotless ? TUNING.spotlessBonus : 0)
    s.score = Math.min(TUNING.maxScore, s.score + bonus)
    w.stats.score = Math.min(TUNING.maxScore, w.stats.score + bonus)
    const exit = w.exit ?? 'goal'
    // Read before writeClear sets it: going back to MW08 for its tokens must not mean the whole ending again.
    firstFinish = w.level.id === LAST_LEVEL_ID && !game.save.data.finished
    const news = writeClear(game.save, {
      levelId: w.level.id,
      exit,
      score: Math.min(TUNING.maxScore, baseScore + bonus),
      ticks: visitTicks + w.tick,
      tokens: w.stats.tokens,
      spotless,
      sessionScore: s.score,
    })
    cleared = {
      // Rival Row's site is '???': its tally says RIVAL ROW CLEAR! instead.
      site: /[A-Z0-9]/i.test(w.level.site) ? w.level.site : w.level.name,
      exit,
      roadOpened: news.roadOpened,
      carsWashed: w.stats.carsWashed,
      carsTotal: w.stats.carsTotal,
      spotless,
      spotlessBonus: TUNING.spotlessBonus,
      tokens: [w.stats.tokens[0], w.stats.tokens[1], w.stats.tokens[2]],
      timeLeft: w.timeLeft,
      timeRate: TIME_BONUS_PER_SECOND,
      baseScore,
      prevBest: news.prevBest,
      sessionBefore,
    }
    // The bonuses are counted into the HUD's score by the tally, not shown all at once now.
    hud?.showScore(sessionBefore)
    victoryTicks = Math.max(CLEAR_MIN_TICKS, jingleTicks(exit === 'secret' ? 'secret' : 'clear') + CLEAR_AFTER_TICKS)
    // A secret exit has its own words already (the 'secret' event).
    if (exit === 'goal') banner?.show('CLEAR!', victoryTicks + 30)
  }

  function beginTally(data: TallyData): void {
    tally.start(data)
    banner?.clear()
    phase = 'tally'
    phaseT = 0
  }

  /** One tick of the level itself. */
  function run(game: GameCtx, input: InputFrame, w: World): void {
    const menu = pause
    if (paused && menu) {
      // The shell asking again while it is already paused changes nothing.
      wantPause = false
      const choice = menu.update(game, input)
      // A pause press that is neither confirm nor cancel (the P key, a touch button) resumes. The shell's own never does.
      const bare = input.pressed.pause && !game.autoPause && !input.pressed.confirm && !input.pressed.cancel && menu.screen === 'menu'
      if (choice === 'resume' || (choice === null && bare)) {
        setPaused(game, false)
        sprayHeldOver = input.held.spray
      } else if (choice === 'restart') restart(game)
      else if (choice === 'exit') {
        undoVisit(game)
        // Not heard again under the fade: the shell would only cut it at the switch.
        game.audio.stopJingle()
        leave(game, 'map', { from: w.level.id, exit: 'quit' }, 'fade')
      }
      return
    }
    // The player's own press only counts while the level is on; the shell's waits for that.
    if ((wantPause || (input.pressed.pause && !game.autoPause)) && w.status === 'play') {
      wantPause = false
      setPaused(game, true)
      return
    }

    if (versus.active) {
      // Start is pause as well as confirm: it pauses, it does not skip.
      const skipped = versus.skipped
      if (versus.update(!game.transitioning && input.pressed.confirm && !input.pressed.pause)) {
        game.audio.sfx('thunder')
        game.input.rumble(0.9, 0.7, 260)
      }
      // Skipped: the rest of the jingle would hold the fight's song back, so the fight's song comes in now.
      if (versus.skipped && !skipped) game.audio.stopJingle(RESUME)
      renderer?.update(w)
      return
    }

    let frame = input
    if (sprayHeldOver) {
      if (input.held.spray) frame = withoutSpray(input, unsprayed)
      else sprayHeldOver = false
    }
    stepWorld(w, frame)
    drain(game, w)
    renderer?.update(w)
    hud?.update(w)
    banner?.update()
    if (shadeT > 0) shadeT--
    setHiss(game, w.player.spraying && w.status === 'play' && !versus.active)
    if (w.level.id === RIVALS_ID) noteRivals(game.save, w.flags.rivalsBeaten ?? 0)

    if (w.status === 'play') {
      if (!hurry && w.timeLeft < HURRY_TICKS) {
        hurry = true
        game.audio.sfx('timeWarn')
        game.audio.setTempoScale(HURRY_TEMPO)
        banner?.show('HURRY UP!', 100)
      } else if (hurry && w.timeLeft >= HURRY_TICKS) {
        // The clock was topped up (Mudzilla gives a fresh five minutes): back to the song's own tempo.
        hurry = false
        game.audio.setTempoScale(1)
      }
    } else if (w.status === 'clear') {
      if (!cleared) payClear(game, w)
      if (cleared && (w.statusT >= victoryTicks || (w.statusT >= CLEAR_SKIP_TICKS && input.pressed.confirm))) beginTally(cleared)
    } else if (w.statusT >= lostTicks(game)) {
      lose(game, w)
    }
  }

  /** How dark the picture is for a pipe or door trip: darkening into the cut, clearing after it. */
  function shadeOf(w: World): number {
    const wp = w.warp
    if (wp && wp.phase === 'out') {
      const left = wp.ticks - wp.t
      if (left < SHADE_TICKS) return 1 - left / SHADE_TICKS
    }
    return shadeT / SHADE_TICKS
  }

  return {
    get world() {
      return world
    },

    /** The level's world renderer, for shot.mjs --native playfield (the level without the HUD). */
    get renderer() {
      return renderer
    },

    state() {
      return {
        level: level ? level.id : '',
        phase,
        phaseT,
        retryCard: phase === 'card' && retryCard,
        paused,
        screen: paused && pause ? pause.screen : '',
        menuIndex: paused && pause ? pause.index : 0,
        banner: banner ? banner.text : '',
        versus: versus.active ? versus.name : '',
        versusScale: versus.active ? versus.scale : 0,
        tally: tally.active ? tally.stage : '',
        hurry,
        visitTicks,
      }
    },

    enter(game, params) {
      const id = typeof params.level === 'string' ? params.level : ''
      level = id ? levelById(id) : null
      world = null
      if (!level) {
        // No such level (yet): back to the map, which says so.
        phase = 'leave'
        game.go('map', { from: id, exit: 'quit' }, 'cut')
        return
      }
      if (!(game.session.lives > 0)) game.resetSession()
      entry = { ...game.session }
      visitTicks = 0
      tick = 0
      readoutAt = -1
      paused = wantPause = false
      readout = game.debug && params.readout !== false
      boxes = game.debug && params.boxes === true
      devStart = null
      if (game.debug && typeof params.col === 'number') {
        const area = level.areas.find((a) => a.id === params.area) ?? level.areas[0]
        const row = typeof params.row === 'number' ? params.row : area.rows.length - 2
        devStart = { areaId: area.id, x: params.col * TILE + TILE / 2, y: row * TILE }
      }

      hud = createHud(game.sprites)
      banner = createBanner(game.sprites)
      pause = createPauseMenu(game)
      makeRenderer(game)

      const songs = new Set<MusicId | JingleId>([level.music, 'clear', 'grimed'])
      let wax = false
      let secret = false
      for (const area of level.areas) {
        if (area.music) songs.add(area.music)
        if (area.rows.some((row) => row.includes('W'))) wax = true
        for (const spec of Object.values(area.legend ?? {})) {
          if (spec.kind === 'wax') wax = true
          if (spec.kind === 'secretExit') secret = true
          const fight = Object.prototype.hasOwnProperty.call(FIGHT_SOUNDS, spec.kind) ? FIGHT_SOUNDS[spec.kind] : null
          if (fight) for (const id of fight) songs.add(id)
        }
      }
      if (wax) songs.add('wax')
      if (secret) songs.add('secret')
      game.audio.preload([...songs])
      // The card is quiet; the level's song starts as it opens.
      game.audio.music(null)

      build(game, 'fresh')
      if (params.card === false) showCard(false, 0)
      else showCard(false)
    },

    update(game, frame) {
      const w = world
      if (!w) return
      tick++
      if (phase === 'leave') {
        renderer?.update(w)
        return
      }
      const live = !game.transitioning
      const input = live ? frame : IDLE
      // The player went away: pause as soon as there is a level on to pause, never toggle one back.
      // A button of their own means they are back, and nothing needs pausing for them.
      if (game.autoPause) {
        if (input.pressed.pause && !paused) wantPause = true
      } else if (wantPause && anyPressed(input)) {
        wantPause = false
      }

      switch (phase) {
        case 'card':
          // The shell's fade does not eat into the card's time.
          if (live) phaseT++
          if (phaseT >= cardTicks || (live && phaseT > CARD_MIN_TICKS && input.pressed.confirm)) openLevel(game, w)
          break
        case 'open':
          renderer?.update(w)
          hud?.update(w)
          if (++phaseT >= OPEN_TICKS) {
            phase = 'run'
            phaseT = 0
          }
          break
        case 'run':
          phaseT++
          run(game, input, w)
          break
        case 'close':
          renderer?.update(w)
          hud?.update(w)
          banner?.update()
          if (++phaseT >= CLOSE_TICKS) {
            visitTicks += w.tick
            build(game, 'retry')
            showCard(true)
          }
          break
        case 'tally':
          phaseT++
          renderer?.update(w)
          if (tally.update(game, live ? input : null, wantPause)) {
            hud?.showScore(null)
            hud?.showClock(null)
            hud?.reset(w)
            findMaxx(w)
            game.irisAt(irisX, irisY)
            leave(game, firstFinish ? 'ending' : 'map', { from: w.level.id, exit: w.exit ?? 'goal' }, 'iris')
          } else {
            hud?.showScore(tally.sessionShown)
            hud?.showClock(tally.clockShown)
            hud?.update(w)
          }
          break
      }
    },

    render(game, g) {
      const w = world
      const lv = level
      if (!w || !lv || !renderer || !hud) {
        g.fillStyle = COVER
        g.fillRect(0, 0, VIEW_W, VIEW_H)
        return
      }
      if (phase === 'card') {
        if (retryCard) drawRetryCard(g, game.sprites, lv, game.session.lives, phaseT, !!w.checkpoint)
        else drawLevelCard(g, game.sprites, lv, recordOf(game.save, lv.id), game.session.lives, phaseT)
        return
      }
      renderer.draw(g, w)
      // A pipe or door darkens the level, not the HUD over it.
      const shade = shadeOf(w)
      if (shade > 0) drawShade(g, shade)
      hud.draw(g, w)
      banner?.draw(g)
      versus.draw(g, game.sprites)
      if (phase === 'tally') tally.draw(g, game.sprites)
      if (phase === 'open' || phase === 'close') {
        findMaxx(w)
        const k = phase === 'open' ? phaseT / OPEN_TICKS : 1 - phaseT / CLOSE_TICKS
        drawIris(g, irisX, irisY, irisFar(irisX, irisY) * k)
      }
      if (paused) pause?.draw(game, g, lv)
      if (readout && !paused) {
        // Rebuilt a few times a second, not every frame.
        if (readoutAt < 0 || tick < readoutAt || tick - readoutAt >= 10) {
          const p = w.player
          readoutAt = tick
          readoutText = `FPS ${game.fps}  ${w.area.id.toUpperCase()}  X ${Math.round(p.x)} Y ${Math.round(p.y)}  T ${w.tick}`
        }
        st.color = PAL.white
        st.shadow = PAL.black
        st.align = 'right'
        drawText(g, readoutText, VIEW_W - 8, 28, st)
      }
    },

    exit(game) {
      setHiss(game, false)
      game.audio.setPaused(false)
      game.audio.setTempoScale(1)
      game.audio.music(null)
    },
  }
}
