// The test bed: the simulation on the sandbox level, drawn as plain boxes with a debug
// readout. It proves the simulation, input, sprites, text and audio work together, and
// is where to look first when one of them does not. Maxx himself is drawn the way the
// real renderer has to: frame by state and the atlas's own timings, behind the tiles in
// a pipe, dirt for lost shine. scripts/maxx/checks/sandbox.mjs plays it through.
import { MAXX_H, MAXX_W, MAX_PIPS, TILE, VIEW_H, VIEW_W } from '../contract'
import type { GameCtx, InputFrame, LevelDef, Scene, SceneParams, Sprites } from '../contract'
import { ACTIONS } from '../contract'
import type { ShellCtx } from '../engine/game'
import { drawText, wrapText } from '../engine/text'
import { METER, PAL, clockText, counter, meter, textPanel } from '../engine/ui'
import type { MeterOpts } from '../engine/ui'
import { levelById, sandboxLevel } from '../levels'
import { TUNING, createWorld, stepWorld } from '../sim'
import type { Entity, Player, World } from '../sim/types'

/** Ticks to look at GRIMED! or the clear before the level starts over. */
const RESTART_TICKS = 150
const POPUP_TICKS = 50
const SPARK_TICKS = 18
/** Pixels of running per run frame, unless the maxx atlas says otherwise in meta.runStride. */
const RUN_STRIDE = 14
/** Ticks per frame of an animation the maxx atlas gives no timing for in meta.ticks. */
const FRAME_TICKS = 8
/** Running over a one-tile gap takes him off the ground for about 3 ticks: no fall pose before this many. */
const FALL_AFTER = 5
/** How high a bumped block hops, in pixels. */
const BUMP_HOP = 6

const SKY = '#5cc8ff'
const TILE_COLORS: Record<string, string> = {
  '#': '#7a4a1a',
  '%': '#4b4f5c',
  B: '#a9afbd',
  C: '#767b8a',
  '?': '#109ff9',
  '!': '#1456b8',
  W: '#f5c518',
  L: '#49b23c',
  H: '#109ff9',
  h: '#49b23c',
  U: '#2e3038',
  X: '#16161d',
  '=': '#b96e23',
  '<': '#5b3fa0',
  '>': '#9a7fe0',
  I: '#a8d8f0',
  O: '#2e1f5e',
  M: '#6b4522',
  g: '#4a2f17',
  '~': '#2b1a0e',
  '^': '#f51924',
  P: '#6fb3dd',
  '|': '#767b8a',
}

type Popup = { text: string; x: number; y: number; t: number }
type Spark = { x: number; y: number; t: number }

const say = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function maxxAnim(p: Player): string {
  if (p.state === 'grimed') return 'grimed'
  if (p.state === 'hurt') return 'hurt'
  if (p.state === 'warp') return 'idle'
  const moving = Math.abs(p.vx) > 12
  // The victory walk is a run; the cheer starts once he stands.
  if (p.state === 'clear') return moving ? 'run' : 'win'
  const air = !p.onGround && (p.vy < 0 || p.airT >= FALL_AFTER)
  const pose = air ? (p.vy < 0 ? 'Jump' : 'Fall') : moving ? 'Run' : 'Idle'
  if (!p.spraying) return p.skidding && p.onGround ? 'skid' : pose.toLowerCase()
  if (p.aim === 'down') return 'sprayDown'
  return (p.aim === 'up' ? 'sprayUp' : 'spray') + pose
}

/**
 * Which frame of a timed animation shows after `t` ticks. `ticks[i]` is how long frame i
 * stays (the maxx atlas ships these in meta.ticks); 0 holds that frame for good, so
 * 'grimed' plays once and stays down while the others loop.
 */
function timedFrame(ticks: readonly number[], t: number): number {
  const hold = ticks.findIndex((n) => n <= 0)
  let total = 0
  for (let i = 0; i < (hold < 0 ? ticks.length : hold); i++) total += ticks[i]
  let left = hold < 0 ? t % total : t
  for (let i = 0; i < ticks.length; i++) {
    if (i === hold || left < ticks[i]) return i
    left -= ticks[i]
  }
  return ticks.length - 1
}

/** The frame to draw Maxx with, or '' when the maxx atlas has nothing usable. */
function maxxFrame(sprites: Sprites, p: Player, tick: number): string {
  const anim = maxxAnim(p)
  const meta = sprites.atlas('maxx')?.meta
  // His own states time themselves; the world's clock stands still once the level is over.
  const t = p.state === 'normal' ? tick : p.stateT
  // An atlas still missing a spray pose falls back to the plain one.
  const plain = anim.replace(/^spray(Up)?/, '').toLowerCase()
  for (const name of [anim, anim.replace('sprayUp', 'spray'), plain, 'idle']) {
    const frames = sprites.anim('maxx', name)
    if (!frames.length) continue
    let i: number
    if (/run$/i.test(name)) {
      i = Math.floor(Math.abs(p.runDist) / (Number(meta?.runStride) || RUN_STRIDE))
    } else {
      const timing = (meta?.ticks as Record<string, unknown> | undefined)?.[name]
      const ok = Array.isArray(timing) && timing.length === frames.length && timing.every((n) => typeof n === 'number')
      i = ok ? timedFrame(timing as number[], t) : Math.floor(t / FRAME_TICKS)
    }
    const frame = frames[i % frames.length]
    if (sprites.has(frame)) return frame
  }
  return ''
}

/** The dirt he wears for the shine he has lost: an overlay frame of the maxx atlas, or ''. */
function maxxGrime(p: Player): string {
  if (p.state === 'grimed' || p.pips >= MAX_PIPS) return ''
  return p.pips >= MAX_PIPS - 1 ? 'maxx/grime1' : 'maxx/grime2'
}

export function createSandboxScene(): Scene & { readonly world: World | null; readonly events: readonly string[]; readonly frame: string } {
  let level: LevelDef = sandboxLevel
  let world: World | null = null
  let problem = ''
  let paused = false
  let banner = { text: '', ticks: 0 }
  let shake = { ticks: 0, mag: 0 }
  let lastInput: InputFrame | null = null
  let hiss = false
  // The maxx frame last drawn, for the readout and for tests.
  let shown = ''
  // Where a body frame and its grime overlay are put together before they go on screen.
  let scratch: HTMLCanvasElement | null = null
  const popups: Popup[] = []
  const sparks: Spark[] = []
  // The newest events, as text, for the readout and for tests.
  const events: string[] = []

  const note = (text: string) => {
    events.push(text)
    if (events.length > 40) events.shift()
  }

  // The spray loop is told only when it changes.
  function setHiss(game: GameCtx, on: boolean) {
    if (on === hiss) return
    hiss = on
    game.audio.spray(on)
  }

  function start(game: GameCtx, fresh: boolean) {
    popups.length = 0
    sparks.length = 0
    banner = { text: '', ticks: 0 }
    shake = { ticks: 0, mag: 0 }
    paused = false
    game.audio.setPaused(false)
    setHiss(game, false)
    try {
      if (fresh || game.session.lives <= 0) game.resetSession()
      world = createWorld(level, { session: game.session, seed: 1 })
      problem = ''
      game.audio.music(world.area.music ?? level.music, { restart: true })
    } catch (err) {
      world = null
      problem = say(err)
    }
  }

  function drain(game: GameCtx, w: World) {
    for (const e of w.events) {
      switch (e.type) {
        case 'sfx':
          game.audio.sfx(e.id)
          note(`sfx ${e.id}`)
          break
        case 'music':
          game.audio.music(e.id)
          note(`music ${e.id ?? 'off'}`)
          break
        case 'jingle':
          game.audio.jingle(e.id)
          note(`jingle ${e.id}`)
          break
        case 'rumble':
          game.input.rumble(e.strong, e.weak, e.ms)
          note(`rumble ${e.ms}ms`)
          break
        case 'popup':
          popups.push({ text: e.text, x: e.x, y: e.y, t: 0 })
          break
        case 'banner':
          banner = { text: e.text, ticks: e.ticks }
          note(`banner ${e.text}`)
          break
        case 'shake':
          if (game.save.data.settings.shake) shake = { ticks: e.ticks, mag: e.mag }
          break
        case 'fx':
          sparks.push({ x: e.x, y: e.y, t: 0 })
          break
        case 'versus':
          banner = { text: e.name, ticks: 120 }
          note(`versus ${e.name}`)
          break
        case 'area':
          note(`area ${e.areaId}`)
          break
        default:
          note(e.type)
      }
    }
    w.events.length = 0
  }

  function drawTiles(g: CanvasRenderingContext2D, w: World, camX: number, camY: number) {
    const grid = w.grid
    const tx0 = Math.max(0, Math.floor(camX / TILE))
    const tx1 = Math.min(grid.w - 1, Math.floor((camX + VIEW_W) / TILE))
    const ty0 = Math.max(0, Math.floor(camY / TILE))
    const ty1 = Math.min(grid.h - 1, Math.floor((camY + VIEW_H) / TILE))
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const code = grid.t[ty * grid.w + tx]
        if (code === 32) continue
        const ch = String.fromCharCode(code)
        const x = tx * TILE - camX
        let y = ty * TILE - camY
        // A block that was just bumped hops (world.bumps keeps each for TUNING.bumpTicks).
        for (const b of w.bumps) if (b.tx === tx && b.ty === ty) y -= Math.round(Math.sin((b.t / TUNING.bumpTicks) * Math.PI) * BUMP_HOP)
        g.fillStyle = TILE_COLORS[ch] ?? '#e85aa0'
        if (ch === '=') g.fillRect(x, y, TILE, 8)
        else if (ch === '^') g.fillRect(x, y + TILE - 8, TILE, 8)
        else if (ch === '|') g.fillRect(x + 12, y, 8, TILE)
        else if (ch === 'H' || ch === 'h') g.fillRect(x, y, TILE, 2)
        else {
          g.fillRect(x, y, TILE, TILE)
          g.fillStyle = '#1e0d06'
          g.fillRect(x, y + TILE - 1, TILE, 1)
          g.fillRect(x + TILE - 1, y, 1, TILE)
        }
        if (ch !== '#' && ch !== '%' && ch !== '=') drawText(g, ch, x + 12, y + 12, { color: '#f7f4f8', shadow: '#1e0d06' })
      }
    }
  }

  /** The entities of one layer: -1 behind Maxx and the tiles, 0 with him, 1 in front (the sign of Entity.z). */
  function drawThings(g: CanvasRenderingContext2D, w: World, camX: number, camY: number, layer: number) {
    for (const e of w.entities) {
      if (e.dead || Math.sign(e.z) !== layer) continue
      const x = Math.round(e.x) - camX
      const y = Math.round(e.y) - camY
      if (x > VIEW_W || y > VIEW_H || x + e.w < 0 || y + e.h < 0) continue
      g.strokeStyle = !e.active ? '#767b8a' : e.harmful ? '#f51924' : e.solid !== 'none' ? '#1456b8' : '#1f7a34'
      g.lineWidth = 1
      g.strokeRect(x + 0.5, y + 0.5, Math.max(1, e.w - 1), Math.max(1, e.h - 1))
      if (e.solid !== 'none') {
        g.fillStyle = '#1456b8'
        g.fillRect(x, y, e.w, 2)
      }
      const label = e.variant ? `${e.kind} ${e.variant}` : e.kind
      drawText(g, label.toUpperCase(), x + e.w / 2, y - 10, { align: 'center', color: '#1e0d06' })
      if (e.maxHp > 1) drawText(g, `${Math.ceil(e.hp)}/${e.maxHp}`, x + e.w / 2, y + e.h / 2 - 4, { align: 'center', color: '#1e0d06' })
    }
  }

  function drawMaxx(game: GameCtx, g: CanvasRenderingContext2D, w: World, camX: number, camY: number) {
    const p = w.player
    const px = Math.round(p.x) - camX
    const py = Math.round(p.y) - camY
    const hidden = p.invuln > 0 && p.state !== 'grimed' && (w.tick >> 1) % 2 === 0
    shown = maxxFrame(game.sprites, p, w.tick)
    if (!hidden && shown) {
      const x = px + MAXX_W / 2
      const y = py + MAXX_H
      const flipX = p.facing < 0
      const grime = maxxGrime(p)
      const f = game.sprites.frame(shown)
      const s = grime && f && game.sprites.has(grime) ? (scratch ??= document.createElement('canvas')).getContext('2d') : null
      if (s && f && scratch) {
        // The dirt may only land on him, so body and overlay meet on a canvas of their own first.
        const ax = f.ax ?? 0
        const ay = f.ay ?? 0
        if (scratch.width !== f.w || scratch.height !== f.h) {
          scratch.width = f.w
          scratch.height = f.h
        }
        s.globalCompositeOperation = 'source-over'
        s.clearRect(0, 0, f.w, f.h)
        game.sprites.draw(s, shown, ax, ay)
        s.globalCompositeOperation = 'source-atop'
        game.sprites.draw(s, grime, ax, ay)
        g.save()
        g.translate(x, y)
        if (flipX) g.scale(-1, 1)
        g.drawImage(scratch, -ax, -ay)
        g.restore()
      } else {
        game.sprites.draw(g, shown, x, y, { flipX })
      }
    } else if (!hidden) {
      g.fillStyle = '#d10713'
      g.fillRect(px, py, MAXX_W, MAXX_H)
      g.fillStyle = '#f7f4f8'
      g.fillRect(p.facing < 0 ? px + 2 : px + MAXX_W - 8, py + 10, 6, 6)
    }
    if (game.debug) {
      g.strokeStyle = '#ffe866'
      g.lineWidth = 1
      g.strokeRect(px + 0.5, py + 0.5, MAXX_W - 1, MAXX_H - 1)
    }
  }

  /** What a sign says, on a board above it, while Maxx stands near (the sign's state is 'near'). */
  function drawSign(g: CanvasRenderingContext2D, e: Entity, camX: number, camY: number) {
    const text = e.props.text
    if (e.dead || e.kind !== 'sign' || e.state !== 'near' || typeof text !== 'string') return
    const maxWidth = 240
    const cx = Math.max(maxWidth / 2 + 4, Math.min(VIEW_W - maxWidth / 2 - 4, Math.round(e.x + e.w / 2) - camX))
    textPanel(g, text, cx, Math.round(e.y) - camY - 56, { style: 'sign', anchor: 'bottom', maxWidth })
  }

  function drawWorld(game: GameCtx, g: CanvasRenderingContext2D, w: World) {
    // A deterministic rattle, so a screenshot taken twice matches.
    const rattle = shake.ticks > 0 ? Math.round(shake.mag) : 0
    const camX = Math.round(w.camera.x) + (rattle ? ((w.tick * 7) % (2 * rattle + 1)) - rattle : 0)
    const camY = Math.round(w.camera.y) + (rattle ? ((w.tick * 13) % (2 * rattle + 1)) - rattle : 0)
    // In a pipe he is behind the tiles: he sinks into it, and rises out of the far one.
    const inPipe = w.warp?.mode === 'pipe'

    drawThings(g, w, camX, camY, -1)
    if (inPipe) drawMaxx(game, g, w, camX, camY)
    drawTiles(g, w, camX, camY)
    drawThings(g, w, camX, camY, 0)
    // The boards are part of the world: Maxx jumping or riding past one stays in front of it.
    for (const e of w.entities) drawSign(g, e, camX, camY)
    if (!inPipe) drawMaxx(game, g, w, camX, camY)
    drawThings(g, w, camX, camY, 1)

    // A droplet's position is a point; Maxx's anchor lies between two pixel columns. An even
    // size centred on the point keeps the stream the same distance off the nozzle both ways.
    g.fillStyle = '#b9ecff'
    for (const d of w.droplets) g.fillRect(Math.round(d.x) - camX - 2, Math.round(d.y) - camY - 2, 4, 4)

    for (const s of sparks) {
      const x = Math.round(s.x) - camX
      const y = Math.round(s.y) - camY
      const r = 2 + (s.t >> 2)
      g.strokeStyle = '#f7f4f8'
      g.strokeRect(x - r + 0.5, y - r + 0.5, r * 2, r * 2)
    }
    for (const pop of popups) {
      drawText(g, pop.text, Math.round(pop.x) - camX, Math.round(pop.y) - camY - Math.floor(pop.t / 2), { align: 'center', color: '#ffe866', outline: '#1e0d06' })
    }
  }

  function drawReadout(game: GameCtx, g: CanvasRenderingContext2D, w: World) {
    const shell = game as Partial<ShellCtx> & GameCtx
    const p = w.player
    const s = w.session
    const yn = (v: boolean) => (v ? 'Y' : 'N')
    const lines = [
      `LIVES ${s.lives}  SCORE ${counter(s.score, 7)}  COINS ${s.coins}  TIME ${clockText(w.timeLeft)}  CARS ${w.stats.carsWashed}/${w.stats.carsTotal}  TOKENS ${w.stats.tokens.filter(Boolean).length}/3  AREA ${w.area.id.toUpperCase()}`,
      `STATE ${p.state.toUpperCase()}  FRAME ${shown.replace('maxx/', '').toUpperCase() || '-'}  GROUND ${yn(p.onGround)}  SPRAY ${yn(p.spraying)}  AIM ${p.aim.toUpperCase()}  TURBO ${yn(p.turbo)}`,
      `X ${Math.round(p.x)}  Y ${Math.round(p.y)}  VX ${Math.round(p.vx)}  VY ${Math.round(p.vy)}  THINGS ${w.entities.length}  DROPS ${w.droplets.length}`,
      `FPS ${shell.fps ?? 0}  TICK ${w.tick}  INPUT ${game.input.device.toUpperCase()}  PAD ${(shell.input?.padName || (game.input.gamepadConnected ? 'CONNECTED' : 'NONE')).toUpperCase()}`,
    ]
    // Out of his way: the readout drops to the bottom while he is up at the top of the screen.
    const top = Math.round(p.y) - Math.round(w.camera.y) < 64 ? VIEW_H - 16 - lines.length * 10 : 0
    g.globalAlpha = 0.6
    g.fillStyle = '#16161d'
    g.fillRect(0, top, VIEW_W, 4 + lines.length * 10)
    g.globalAlpha = 1
    lines.forEach((line, i) => drawText(g, line, 4, top + 3 + i * 10, { color: '#f7f4f8' }))

    const bars: Array<[string, number, MeterOpts]> = [
      ['SHINE', p.pips / MAX_PIPS, { ...METER.shine, segments: MAX_PIPS }],
      ['HOVER', p.hover / TUNING.hoverTicks, METER.water],
    ]
    if (p.wax > 0) bars.push(['WAX', p.wax / TUNING.waxTicks, METER.wax])
    if (w.boss) bars.push([w.boss.name.toUpperCase(), w.boss.hp / Math.max(1, w.boss.maxHp), METER.boss])
    let bx = VIEW_W - 4
    for (let i = bars.length - 1; i >= 0; i--) {
      const [label, value, look] = bars[i]
      meter(g, bx - 48, VIEW_H - 12, 48, 9, value, look)
      drawText(g, label, bx - 52, VIEW_H - 11, { align: 'right', color: PAL.white, shadow: PAL.black })
      bx -= 104
    }

    if (lastInput) {
      const held = ACTIONS.filter((a) => lastInput?.held[a]).join(' ')
      drawText(g, `HELD ${held.toUpperCase() || '-'}  AXIS ${lastInput.axisX.toFixed(2)} ${lastInput.axisY.toFixed(2)}`, 4, VIEW_H - 11, { color: '#f7f4f8', shadow: '#16161d' })
    }
    events.slice(-6).forEach((line, i) => drawText(g, line.toUpperCase(), VIEW_W - 4, 48 + i * 10, { align: 'right', color: '#1e0d06' }))
  }

  return {
    get world() {
      return world
    },
    get events() {
      return events
    },
    get frame() {
      return shown
    },
    enter(game: GameCtx, params: SceneParams) {
      level = (typeof params.level === 'string' ? levelById(params.level) : null) ?? sandboxLevel
      start(game, true)
    },
    update(game, input) {
      lastInput = input
      // View button or Tab: start over.
      if (input.pressed.select) return start(game, true)
      if (!world) {
        if (input.pressed.confirm) start(game, true)
        else if (input.pressed.cancel) game.go('title')
        return
      }
      if (input.pressed.pause) {
        // The shell's own press (tab hidden, controller gone) may only pause, never resume.
        const auto = (game as Partial<ShellCtx>).autoPause === true
        if (!(auto && paused)) {
          paused = !paused
          game.audio.setPaused(paused)
          game.audio.sfx(paused ? 'pause' : 'unpause')
        }
      }
      if (paused) return

      try {
        stepWorld(world, input)
      } catch (err) {
        problem = say(err)
        world = null
        setHiss(game, false)
        return
      }
      drain(game, world)
      setHiss(game, world.player.spraying && world.status === 'play')

      if (banner.ticks > 0) banner.ticks--
      if (shake.ticks > 0) shake.ticks--
      for (let i = popups.length - 1; i >= 0; i--) if (++popups[i].t > POPUP_TICKS) popups.splice(i, 1)
      for (let i = sparks.length - 1; i >= 0; i--) if (++sparks[i].t > SPARK_TICKS) sparks.splice(i, 1)

      if (world.status !== 'play' && world.statusT >= RESTART_TICKS) {
        // The play scene's job in the real game: a grime or the clock running out costs a life.
        if (world.status !== 'clear') game.session.lives--
        start(game, false)
      }
    },
    render(game, g) {
      g.fillStyle = SKY
      g.fillRect(0, 0, VIEW_W, VIEW_H)
      if (world) {
        try {
          drawWorld(game, g, world)
          drawReadout(game, g, world)
        } catch (err) {
          problem = say(err)
          world = null
        }
      }
      if (!world) {
        g.fillStyle = '#16161d'
        g.fillRect(0, 0, VIEW_W, VIEW_H)
        drawText(g, 'SANDBOX', VIEW_W / 2, 70, { scale: 3, align: 'center', color: '#5cc8ff' })
        drawText(g, 'THE SIMULATION IS NOT RUNNING', VIEW_W / 2, 120, { scale: 2, align: 'center', color: '#ff6b6b' })
        drawText(g, wrapText(problem, VIEW_W - 80).slice(0, 10).join('\n'), VIEW_W / 2, 160, { align: 'center', color: '#d6dae3' })
        drawText(g, '{confirm} TRY AGAIN     {cancel} TITLE', VIEW_W / 2, 290, { align: 'center', color: '#ffe866' })
        drawText(g, `INPUT ${game.input.device.toUpperCase()}`, VIEW_W / 2, 320, { align: 'center', color: '#767b8a' })
        return
      }
      if (banner.ticks > 0) drawText(g, banner.text, VIEW_W / 2, 130, { scale: 4, align: 'center', color: '#ffe866', outline: '#1e0d06' })
      if (paused) textPanel(g, 'PAUSED\n{pause} RESUME   {select} START OVER', VIEW_W / 2, 190, { scale: 2, anchor: 'middle', maxWidth: 420 })
    },
    exit(game) {
      setHiss(game, false)
      game.audio.setPaused(false)
    },
  }
}
