// How the objects look: pickups, prizes, the checkpoint, the exit arch, doors, gates,
// buttons, springs, lifts and signs. Art: the 'items' atlas (scripts/maxx/art-items.mjs).
// The states each one draws are written in the header of its simulation file:
// sim/entities/pickups.ts, fixtures.ts, warps.ts, movers.ts, gates.ts.
//
// Everything collectible moves while it waits: coins spin in a wave along a row, the
// token turns slowly and bobs, the bubble wobbles, the nozzle flashes, the wax tin gleams,
// the 1UP blinks, and the grounded ones give a little hop now and then.
import { TILE, VIEW_W } from '../../contract'
import type { DrawOpts } from '../../contract'
import { drawText } from '../../engine/text'
import type { TextStyle } from '../../engine/text'
import { textPanel } from '../../engine/ui'
import type { TextPanelOpts } from '../../engine/ui'
import { GATE_TOP } from '../../sim/entities/gates'
import { RATTLE_TICKS, UNLOCK_TICKS } from '../../sim/entities/warps'
import type { Entity, World } from '../../sim/types'
import { registerRenderer, renderedKinds } from '../registry'
import type { RenderCtx } from '../registry'

const A = 'items/'
const seq = (name: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${A}${name}${i}`)

const COIN = seq('coin', 6)
const TOKEN = seq('token', 6)
const GLINT = seq('glint', 5)
const BUBBLE = seq('bubble', 4)
const TURBO = seq('turbo', 4)
const WAX = seq('wax', 4)
const ONEUP = seq('oneup', 2)
const CP_FLAG = seq('cpFlag', 4)
const SPRING = seq('spring', 4)
const DOOR = seq('door', 3)
const DOOR_LOCK = seq('doorLock', 4)
const DOOR_LAMP = seq('doorLamp', 3)
const SECRET = seq('secret', 3)
const SECRET_LAMP = seq('secretLamp', 3)
const GOAL_HEAD = seq('goalHead', 3)
const GOAL_LIGHT = seq('goalLight', 3)
const BUTTON = seq('button', 2)
const SIGN = seq('sign', 2)
const LIFT_L = A + 'liftL'
const LIFT_M = A + 'liftM'
const LIFT_R = A + 'liftR'
const LIFT_1 = A + 'lift1'
const LIFT_TRUCK = A + 'liftTruck'
const RAIL_DOT = A + 'railDot'
const RAIL_END = A + 'railEnd'
const TOKEN_GHOST = A + 'tokenGhost'
const PADLOCK = A + 'padlock'
const CP_POST = [A + 'cpPost0', A + 'cpPost1']
const CP_LIMP = A + 'cpFlagLimp'
const GOAL_LEGS = A + 'goalLegs'
const GOAL_NEAR = A + 'goalNear'
const GATE_TOP_SHUT = A + 'gateTop0'
const GATE_TOP_OPEN = A + 'gateTop1'
const GATE_SLATS = A + 'gateSlats'
const GATE_FOOT = A + 'gateFoot'
const GATE_RAIL = A + 'gateRail'

/** Ticks per frame of the looping animations (the atlas meta says the same). */
const T_COIN = 5
const T_TOKEN = 9
const T_BUBBLE = 9
const T_TURBO = 5
const T_GLINT = 3
const T_FLAG = 7
const T_BULBS = 14
/** Where the checkpoint flag meets the pole (atlas meta.checkpoint). */
const FLAG_X = 2
const FLAG_LOW = 30
const FLAG_HIGH = 51
/** Ticks the flag takes to run up the pole when it is taken. */
const FLAG_RISE = 34
/** Pixels apart of the dots along a lift's rail. */
const RAIL_STEP = 12
const OUTLINE = '#1e0d06'

const FLIP: DrawOpts = { flipX: true }
/** Reused for every faded draw: set alpha, then draw. */
const FADE: DrawOpts = { alpha: 1 }
const PROMPT: TextStyle = { align: 'center', color: '#f7f4f8', outline: OUTLINE }
const PROMPT_LOCK: TextStyle = { align: 'center', color: '#ffe866', outline: OUTLINE }

/** A per-thing offset, so a row of coins spins as a wave and two tokens never wink together. */
function phaseOf(e: Entity): number {
  return Math.floor(e.spawnX / TILE) * 3
}

/** The twinkle: plays once at `t` 0..14, nothing outside that. */
function glint(rc: RenderCtx, t: number, x: number, y: number): void {
  if (t < 0) return
  const i = Math.floor(t / T_GLINT)
  if (i < GLINT.length) rc.draw(GLINT[i], x, y)
}

/** Feet of the box, where every standing sprite is anchored. */
const footX = (e: Entity): number => e.x + e.w / 2
const footY = (e: Entity): number => e.y + e.h

/**
 * How far up (pixels, 0 or more) a grounded pickup is lifted this tick: a hop every so often
 * while it waits, a trot while it slides along, a bounce just after it popped out of a block.
 */
function hop(e: Entity, tick: number): number {
  if (e.state === 'pop') return 0
  if (e.vars.popped === 1 && e.stateT < 12) return Math.round(Math.sin((e.stateT / 12) * Math.PI) * 4)
  if (e.state === 'walk') return Math.round(Math.abs(Math.sin(e.stateT * 0.26)) * 3)
  const t = (tick + phaseOf(e) * 7) % 72
  return t < 10 ? Math.round(Math.sin((t / 10) * Math.PI) * 3) : 0
}

/** While a prize rises out of its block, twinkles burst off the block's top corners. */
function popGlint(e: Entity, rc: RenderCtx): void {
  if (e.state !== 'pop') return
  const blockTop = e.spawnY + e.h - TILE
  const x = footX(e)
  glint(rc, e.stateT - 1, x + 15, blockTop - 4)
  glint(rc, e.stateT - 5, x - 16, blockTop - 9)
  glint(rc, e.stateT - 9, x + 12, blockTop - 20)
}

/* ------------------------------------------------------------------ */
/* Pickups                                                             */
/* ------------------------------------------------------------------ */

registerRenderer('coin', (_g, e, rc) => {
  const ph = phaseOf(e)
  const x = footX(e)
  const y = footY(e)
  rc.draw(COIN[Math.floor((rc.tick + ph) / T_COIN) % COIN.length], x, y)
  // Now and then the light catches the face.
  glint(rc, (rc.tick + ph * 11) % 150, x - 4, y - 14)
})

registerRenderer('token', (_g, e, rc) => {
  const ph = phaseOf(e)
  const x = footX(e)
  const y = footY(e) - Math.round(Math.sin((rc.tick + ph * 9) * 0.07) * 2)
  if (e.state === 'owned') {
    // Already in the save: only its outline is left, breathing faintly.
    FADE.alpha = 0.55 + 0.12 * Math.sin((rc.tick + ph) * 0.05)
    rc.draw(TOKEN_GHOST, x, y, FADE)
    return
  }
  const s = (rc.tick + ph * 5) % (T_TOKEN * TOKEN.length)
  rc.draw(TOKEN[Math.floor(s / T_TOKEN)], x, y)
  // A glint each time it turns face on, and a second, smaller one across the rim.
  glint(rc, s, x - 5, y - 16)
  glint(rc, s - 20, x + 6, y - 6)
})

registerRenderer('bubble', (_g, e, rc) => {
  rc.draw(BUBBLE[Math.floor((rc.tick + phaseOf(e)) / T_BUBBLE) % BUBBLE.length], footX(e), footY(e))
  popGlint(e, rc)
})

registerRenderer('turbo', (_g, e, rc) => {
  const x = footX(e)
  const y = footY(e) - hop(e, rc.tick)
  rc.draw(TURBO[Math.floor(rc.tick / T_TURBO) % TURBO.length], x, y)
  glint(rc, (rc.tick + phaseOf(e) * 5) % 90, x - 3, y - 15)
  popGlint(e, rc)
})

registerRenderer('wax', (_g, e, rc) => {
  // A gleam runs across the tin about once a second.
  const s = (rc.tick + phaseOf(e) * 5) % 64
  const frame = s < 12 ? 1 + Math.floor(s / 4) : 0
  rc.draw(WAX[frame], footX(e), footY(e) - hop(e, rc.tick))
  popGlint(e, rc)
})

registerRenderer('oneup', (_g, e, rc) => {
  // He blinks, and looks the way he slides.
  const blink = (rc.tick + phaseOf(e) * 13) % 110 < 7 ? 1 : 0
  rc.draw(ONEUP[blink], footX(e), footY(e) - hop(e, rc.tick), e.state === 'walk' && e.facing < 0 ? FLIP : undefined)
  popGlint(e, rc)
})

/* ------------------------------------------------------------------ */
/* Checkpoint, sign                                                    */
/* ------------------------------------------------------------------ */

registerRenderer('checkpoint', (_g, e, rc) => {
  const x = footX(e)
  const y = footY(e)
  const on = e.state === 'on'
  rc.draw(CP_POST[on ? 1 : 0], x, y)
  if (!on) {
    rc.draw(CP_LIMP, x + FLAG_X, y - FLAG_LOW)
    return
  }
  // Taken on this attempt: the flag runs up the pole, then waves.
  // Slow off the mark, so most of the climb comes once he has run on past the pole and it can be seen.
  let rise = 1
  if (e.vars.fresh === 1 && e.stateT < FLAG_RISE) {
    const k = e.stateT / FLAG_RISE
    rise = k * k * (3 - 2 * k)
  }
  const fy = y - Math.round(FLAG_LOW + (FLAG_HIGH - FLAG_LOW) * rise)
  rc.draw(CP_FLAG[Math.floor(rc.tick / T_FLAG) % CP_FLAG.length], x + FLAG_X, fy)
  // A sparkle on the lamp as it lights, then now and then while it burns.
  const lampY = y - 56
  if (e.vars.fresh === 1 && e.stateT < 40) {
    glint(rc, e.stateT, x, lampY)
    glint(rc, e.stateT - 10, x + 14, fy - 2)
    glint(rc, e.stateT - 18, x + 22, fy + 8)
  } else {
    glint(rc, (rc.tick + phaseOf(e)) % 80, x - 1, lampY - 1)
  }
})

const SIGN_WIDTH = 240
const SIGN_PANEL: TextPanelOpts = { style: 'sign', anchor: 'bottom', maxWidth: SIGN_WIDTH }
/** The board drops in when he comes near: pixels above its resting place, tick by tick. */
const SIGN_DROP = [-10, -7, -4, -1, 1, 2, 1, 0]

registerRenderer('sign', (g, e, rc) => {
  const near = e.state === 'near'
  // The post gives a little hop as its board comes up.
  const hopT = near && e.stateT < 8 ? e.stateT : 8
  rc.draw(SIGN[near ? 1 : 0], footX(e), footY(e) - (hopT > 0 && hopT < 5 ? 1 : 0))
  const text = e.props.text
  if (!near || typeof text !== 'string' || text === '') return
  // The board floats over Maxx's head and stays on screen.
  const cx = Math.max(SIGN_WIDTH / 2 + 4, Math.min(VIEW_W - SIGN_WIDTH / 2 - 4, rc.sx(footX(e))))
  const drop = e.stateT < SIGN_DROP.length ? SIGN_DROP[e.stateT] : 0
  textPanel(g, text, cx, rc.sy(e.y) - 56 + drop, SIGN_PANEL)
})

/* ------------------------------------------------------------------ */
/* The exit arch and the employees' door                              */
/* ------------------------------------------------------------------ */

registerRenderer('goal', (_g, e, rc) => {
  const x = footX(e)
  const y = footY(e)
  const open = e.state === 'open'
  let head = Math.floor(rc.tick / T_BULBS) % 2
  if (open) {
    // He made it: the bulbs chase for a moment, then all burn.
    const t = rc.world.statusT
    head = t < 90 && Math.floor(t / 5) % 2 === 1 ? Math.floor(t / 10) % 2 : 2
  }
  rc.draw(GOAL_LEGS, x, y)
  rc.draw(GOAL_HEAD[head], x, y)
  rc.draw(GOAL_LIGHT[open ? 1 : 0], x, y)
  // The green lamp twinkles.
  if (open) glint(rc, rc.world.statusT % 40, x - 2, y - 89)
})

// The near pillar, made by the goal itself (z 1): Maxx walks behind it.
registerRenderer('goalFront', (_g, e, rc) => {
  rc.draw(GOAL_NEAR, footX(e), footY(e))
})

// Through the employees' door, by world.statusT: it swings open, he coasts into the doorway,
// from SECRET_IN the dark takes him (over SECRET_FADE ticks), and SECRET_SHUT ticks after
// that the door shuts on him.
const SECRET_IN = 18
const SECRET_FADE = 8
const SECRET_SHUT = 14

registerRenderer('secretExit', (_g, e, rc) => {
  const x = footX(e)
  const y = footY(e)
  if (e.state === 'open') {
    rc.draw(SECRET[rc.world.statusT < 6 ? 1 : 2], x, y)
    rc.draw(SECRET_LAMP[2], x, y)
    return
  }
  rc.draw(SECRET[0], x, y)
  // A slow red blink over the door: something is back there.
  rc.draw(SECRET_LAMP[(rc.tick + phaseOf(e)) % 70 < 35 ? 1 : 0], x, y)
})

// The same door drawn again in front of Maxx (z 1) once he is inside, so it can shut on him.
registerRenderer('secretFront', (_g, e, rc) => {
  if (e.state !== 'open') return
  const t = rc.world.statusT - SECRET_IN
  if (t < 0) return
  const x = footX(e)
  const y = footY(e)
  if (t < SECRET_FADE) {
    FADE.alpha = (t + 1) / (SECRET_FADE + 1)
    rc.draw(SECRET[2], x, y, FADE)
    return
  }
  rc.draw(SECRET[t < SECRET_SHUT ? 2 : t < SECRET_SHUT + 5 ? 1 : 0], x, y)
  rc.draw(SECRET_LAMP[2], x, y)
  glint(rc, t - SECRET_SHUT - 4, x + 1, y - 72)
})

/* ------------------------------------------------------------------ */
/* Doors                                                               */
/* ------------------------------------------------------------------ */

/** Is Maxx standing in front of this door, where up would take him through? (as warps.ts atDoor) */
function atDoor(e: Entity, w: World): boolean {
  const p = w.player
  if (p.state !== 'normal' || !p.onGround) return false
  const cx = p.x + p.w / 2
  return cx >= e.x && cx <= e.x + e.w && p.y + p.h > e.y && p.y < e.y + e.h
}

function doorFrame(e: Entity, w: World): number {
  const trip = w.warp
  if (trip && trip.mode === 'door') {
    const p = w.player
    const mine = Math.abs(p.x + p.w / 2 - footX(e)) < e.w / 2 + 4 && Math.abs(p.y + p.h - footY(e)) < TILE
    if (mine) {
      // Swinging open as he goes in, shutting behind him as he comes out.
      if (trip.phase === 'out') return trip.t < 4 ? 1 : 2
      return trip.t < trip.ticks / 2 ? 2 : 1
    }
  }
  if (e.state === 'open') return e.stateT < 8 ? 2 : e.stateT < 16 ? 1 : 0
  return 0
}

registerRenderer('door', (g, e, rc) => {
  const w = rc.world
  const x = footX(e)
  const y = footY(e)
  const barred = typeof e.props.flag === 'string' && e.props.flag !== ''
  if (e.state === 'locked') {
    rc.draw(DOOR[0], x, y)
    const rattle = e.vars.rattle > 0 ? (Math.floor(e.vars.rattle / 2) % 2 === 0 ? 1 : -1) : 0
    rc.draw(DOOR_LOCK[0], x + (e.vars.rattle > RATTLE_TICKS / 2 ? rattle : 0), y)
    rc.draw(PADLOCK, x + rattle, y - 30)
    // The red lamp sits above his head, so it still says locked while he hides the padlock. A try makes it flash.
    const on = e.vars.rattle > 0 ? Math.floor(e.vars.rattle / 2) % 2 === 0 : (rc.tick + phaseOf(e)) % 56 < 44
    rc.draw(DOOR_LAMP[on ? 1 : 0], x, y)
    if (atDoor(e, w) && w.warp === null) drawPrompt(g, rc, e, '{lock}', rattle)
    return
  }
  if (e.state === 'unlock') {
    const k = Math.min(1, e.stateT / UNLOCK_TICKS)
    rc.draw(DOOR[0], x, y)
    rc.draw(DOOR_LOCK[Math.min(3, 1 + Math.floor(k * 3))], x, y)
    // The padlock springs open and drops away.
    const t = e.stateT
    FADE.alpha = Math.max(0, 1 - k * 1.4)
    if (FADE.alpha > 0) rc.draw(PADLOCK, x + Math.round(t * 0.3), y - 30 + Math.round(t * t * 0.05) - (t < 4 ? t : 4), FADE)
    // The lamp flickers from red to green.
    rc.draw(DOOR_LAMP[t > 14 || Math.floor(t / 3) % 2 === 1 ? 2 : 0], x, y)
    glint(rc, t - 12, x + 1, y - 68)
    glint(rc, t, x - 6, y - 36)
    glint(rc, t - 8, x + 9, y - 22)
    return
  }
  rc.draw(DOOR[doorFrame(e, w)], x, y)
  // A door that was locked keeps the brackets its bars slid into, and its lamp burns green.
  if (barred) {
    rc.draw(DOOR_LOCK[3], x, y)
    rc.draw(DOOR_LAMP[2], x, y)
  }
  // Only a door that leads somewhere asks for up (one that is just an arrival point does not).
  const leads = typeof e.props.to === 'string' && e.props.to !== ''
  if (leads && e.state === 'idle' && w.warp === null && !w.warpLock && atDoor(e, w)) drawPrompt(g, rc, e, '{up}', 0)
})

/** A small bobbing prompt over a door Maxx stands at: up to go in, a yellow padlock (shaken by a try) when it is barred. */
function drawPrompt(g: CanvasRenderingContext2D, rc: RenderCtx, e: Entity, text: string, shake: number): void {
  const bob = Math.floor(rc.tick / 12) % 2
  drawText(g, text, rc.sx(footX(e)) + shake, rc.sy(e.y) - 29 - bob, text === '{lock}' ? PROMPT_LOCK : PROMPT)
}

/* ------------------------------------------------------------------ */
/* Gates and buttons                                                   */
/* ------------------------------------------------------------------ */

registerRenderer('gate', (g, e, rc) => {
  const slats = rc.sprites.source(GATE_SLATS)
  const tall = Math.max(1, Math.round(typeof e.props.h === 'number' ? e.props.h : 3)) * TILE
  const left = rc.sx(e.x)
  const top = rc.sy(e.y)
  const cols = Math.max(1, Math.round(e.w / TILE))
  const curtain = Math.round(e.h)
  const shut = e.state === 'shut'
  // Leaning on a shut gate rattles the curtain.
  const shake = shut && e.vars.push > 0 ? (Math.floor(rc.tick / 3) % 2 === 0 ? 1 : -1) : 0
  if (slats && curtain > GATE_TOP + 8) {
    const f = slats.frame
    // The slats scroll up with the bottom edge, as if wound on to the drum.
    const rolled = tall - curtain
    for (let c = 0; c < cols; c++) {
      const dx = left + c * TILE + shake
      let y = top + GATE_TOP
      let rest = curtain - GATE_TOP - 8
      let row = rolled % f.h
      while (rest > 0) {
        const n = Math.min(f.h - row, rest)
        g.drawImage(slats.image, f.x, f.y + row, f.w, n, dx, y, f.w, n)
        y += n
        rest -= n
        row = 0
      }
      rc.draw(GATE_FOOT, e.x + c * TILE + shake, e.y + curtain - 8)
    }
  }
  // Guide rails down both sides, the whole height, then the drum housing over all.
  for (let y = GATE_TOP; y < tall; y += 8) {
    rc.draw(GATE_RAIL, e.x, e.y + y)
    rc.draw(GATE_RAIL, e.x + e.w - 3, e.y + y)
  }
  for (let c = 0; c < cols; c++) rc.draw(shut ? GATE_TOP_SHUT : GATE_TOP_OPEN, e.x + c * TILE, e.y)
  g.fillStyle = OUTLINE
  g.fillRect(left, top, 1, GATE_TOP)
  g.fillRect(left + e.w - 1, top, 1, GATE_TOP)
  if (e.state === 'opening') glint(rc, e.stateT, e.x + e.w / 2, e.y + 6)
})

registerRenderer('button', (_g, e, rc) => {
  rc.draw(BUTTON[e.state === 'down' ? 1 : 0], footX(e), footY(e))
})

/* ------------------------------------------------------------------ */
/* Things he rides                                                     */
/* ------------------------------------------------------------------ */

registerRenderer('spring', (_g, e, rc) => {
  let frame = 0
  if (e.state === 'boing') frame = e.stateT <= 3 ? 1 : e.stateT <= 8 ? 2 : 3
  // At rest it breathes now and then, so it looks like it wants to be jumped on.
  else if ((rc.tick + phaseOf(e) * 7) % 100 < 8) frame = 3
  rc.draw(SPRING[frame], footX(e), footY(e))
})

registerRenderer('lift', (_g, e, rc) => {
  const dx = (typeof e.props.dx === 'number' ? e.props.dx : 0) * TILE
  const dy = (typeof e.props.dy === 'number' ? e.props.dy : 0) * TILE
  const run = Math.sqrt(dx * dx + dy * dy)
  if (run > 0) {
    // The rail it rides, from one end of its run to the other, behind it.
    const x0 = e.spawnX + e.w / 2
    const y0 = e.spawnY + 6
    const n = Math.max(1, Math.round(run / RAIL_STEP))
    for (let i = 1; i < n; i++) rc.draw(RAIL_DOT, x0 + (dx * i) / n, y0 + (dy * i) / n)
    rc.draw(RAIL_END, x0, y0)
    rc.draw(RAIL_END, x0 + dx, y0 + dy)
  }
  const tiles = Math.max(1, Math.round(e.w / TILE))
  if (tiles === 1) rc.draw(LIFT_1, e.x, e.y)
  else for (let i = 0; i < tiles; i++) rc.draw(i === 0 ? LIFT_L : i === tiles - 1 ? LIFT_R : LIFT_M, e.x + i * TILE, e.y)
  // The carriage that runs on the rail, under the middle of the deck.
  if (tiles > 1) rc.draw(LIFT_TRUCK, e.x + e.w / 2, e.y + 12)
}, {
  // The rail runs the whole way: on screen while the lift itself is at the far end of a long run.
  margin: (e) => (Math.abs(typeof e.props.dx === 'number' ? e.props.dx : 0) + Math.abs(typeof e.props.dy === 'number' ? e.props.dy : 0)) * TILE,
})

/* ------------------------------------------------------------------ */
/* Invisible ones                                                      */
/* ------------------------------------------------------------------ */

const NOTHING = (): void => {}
registerRenderer('marker', NOTHING)
registerRenderer('pipe', NOTHING)
// The spawner belongs to the cars: if their renderer is already in, it stays.
if (!renderedKinds().includes('spawner')) registerRenderer('spawner', NOTHING)
