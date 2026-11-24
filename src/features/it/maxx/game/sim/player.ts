// Maxx's controller: analog run with skids, variable-height jump with coyote
// time and a jump buffer, hover on the prep gun, head bumps, floors, hazards.
import { DT, MAXX_H, MAXX_W, TILE } from '../contract'
import type { InputFrame } from '../contract'
import { areaMusic, bumpTile, downHeld, fx, grimePlayer, hurtPlayer, music, rumble, sfx, upHeld } from './api'
import { F_HIDDEN, F_SOLIDS, F_TILES, feetTop, rideOn, sweepX, sweepY, tileCode, tileFlags } from './physics'
import { TILE_BY_CODE, TILE_INFO, T_FLOOR, T_HAZARD, T_HIDDEN, T_ONEWAY, T_SOLID } from './tiles'
import { TUNING as T } from './tuning'
import type { Entity, Player, World } from './types'

const MOVE = F_TILES | F_SOLIDS | F_HIDDEN
const EPS = 0.001
/** Overlap with a 'full' entity, on every side, that counts as being squeezed by it. */
const SQUEEZE = 2

/** A fresh Maxx standing with the middle of his feet at (feetX, feetY). */
export function makePlayer(feetX: number, feetY: number, pips: number, turbo: boolean): Player {
  const x = feetX - MAXX_W / 2
  const y = feetY - MAXX_H
  return {
    x,
    y,
    w: MAXX_W,
    h: MAXX_H,
    vx: 0,
    vy: 0,
    onGround: false,
    hitWall: 0,
    hitCeil: false,
    facing: 1,
    state: 'normal',
    stateT: 0,
    pips,
    invuln: 0,
    wax: 0,
    turbo,
    spraying: false,
    aim: 'fwd',
    hover: T.hoverTicks,
    hovering: false,
    runDist: 0,
    ridingId: 0,
    airT: 0,
    floor: '',
    skidding: false,
    px: x,
    py: y,
    jumpBuf: 0,
    // None to start with: a world can begin with him in mid-air, and that is not a ledge he ran off.
    coyote: 0,
    jumping: false,
    jumpCut: false,
    sprayAcc: 1,
  }
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target)
}

/** A stick reading made safe: -1..1, and 0 for anything that is not a number. */
function axis(v: number): number {
  return v >= -1 && v <= 1 ? v : v > 1 ? 1 : v < -1 ? -1 : 0
}

/** Is there floor one step to his right? (The victory walk goes right.) */
function tileAhead(w: World, p: Player): boolean {
  const f = tileFlags(w, Math.floor((p.x + p.w + 4) / TILE), Math.floor((p.y + p.h + 1) / TILE))
  return (f & (T_SOLID | T_ONEWAY)) !== 0
}

/** One tick of Maxx while the level is being played, or of his victory walk once it is won. */
export function stepPlayer(w: World, input: InputFrame): void {
  const p = w.player
  p.px = p.x
  p.py = p.y
  p.stateT++
  if (p.invuln > 0) p.invuln--
  // Once the level is over the tally's own tune is playing: the wax just runs out quietly.
  if (p.wax > 0 && --p.wax === 0 && w.status === 'play') music(w, areaMusic(w))
  if (p.state === 'hurt' && p.stateT >= T.hurtTicks) {
    p.state = 'normal'
    p.stateT = 0
  }
  // Before his state is read: being squeezed in here can hurt him.
  carry(w, p)
  const st = p.state

  let dir = 0
  // How far the stick is pushed, whichever way it leans.
  let lean = 0
  let jumpPressed = false
  let jumpHeld = false
  let up = false
  let down = false
  let spray = false
  if (st === 'normal') {
    dir = axis(input.axisX)
    if (dir === 0) dir = (input.held.right ? 1 : 0) - (input.held.left ? 1 : 0)
    // Leaning up or down counts toward the push too, so run-and-aim-up on the stick is a full run.
    // engine/input.ts hands the stick's up and down over as a switch (axisY 0 or -1/1), so on a
    // pad any run while up or down is on goes at full speed; the walk is for a level stick.
    const tilt = axis(input.axisY)
    lean = Math.min(1, Math.sqrt(dir * dir + tilt * tilt))
    jumpPressed = input.pressed.jump
    jumpHeld = input.held.jump
    up = upHeld(w)
    down = downHeld(w)
    spray = input.held.spray
  } else if (st === 'clear') {
    // The victory walk stops at a drop rather than strolling off it.
    dir = w.clearWalk && p.stateT <= T.clearWalkTicks && !(p.onGround && !tileAhead(w, p)) ? T.clearWalkAxis : 0
    lean = dir
  }

  const grounded = p.onGround
  const floor = grounded && p.floor !== '' ? TILE_INFO[p.floor] : undefined
  const grip = floor ? floor.grip : 1
  const hoverWanted = st === 'normal' && !grounded && down && spray && p.hover > 0
  // The hover's budget is a stretch of time, not a count of presses: from its first tick in an
  // airtime it runs down every tick, held or not, and the slow drift holds all that while. So
  // tapping it cannot stretch it out, and no pattern of presses goes further than a hold begun on
  // the same tick (the hover search in sim.mjs fails on any that does).
  const hoverRunning = !grounded && p.hover > 0 && p.hover < T.hoverTicks

  let top = T.runSpeed * (floor ? floor.speed : 1)
  if (grounded && spray) top = Math.min(top, T.spraySpeed)
  if ((hoverWanted && p.vy > 0) || hoverRunning) top = Math.min(top, T.hoverSpeed)
  if (dir !== 0) top *= Math.max(T.analogMin, lean)

  const wasSkidding = p.skidding
  p.skidding = false
  if (st === 'hurt') {
    if (grounded) p.vx = approach(p.vx, 0, T.groundDecel * grip * DT)
  } else if (dir !== 0) {
    const s = dir > 0 ? 1 : -1
    p.facing = s
    if (p.vx * s < 0) {
      if (grounded && Math.abs(p.vx) > T.skidMinSpeed) {
        p.skidding = true
        if (!wasSkidding && Math.abs(p.vx) > T.skidSfxSpeed) {
          sfx(w, 'skid')
          fx(w, 'dust', p.x + p.w / 2, p.y + p.h, 3, -s)
        }
      }
      p.vx = approach(p.vx, s * top, (grounded ? T.skidDecel * grip : T.airTurn) * DT)
    } else if (Math.abs(p.vx) > top) {
      p.vx = approach(p.vx, s * top, (grounded ? T.groundDecel * grip : T.airDecel) * DT)
    } else {
      p.vx = approach(p.vx, s * top, (grounded ? T.groundAccel * grip : T.airAccel) * DT)
    }
  } else {
    p.vx = approach(p.vx, 0, (grounded ? T.groundDecel * grip : T.airDecel) * DT)
  }

  if (jumpPressed) p.jumpBuf = T.jumpBufferTicks + 1
  if (p.jumpBuf > 0) {
    if (st === 'normal' && (grounded || p.coyote > 0)) {
      const run = Math.min(1, Math.abs(p.vx) / T.runSpeed)
      // A coyote jump is off the floor he just left: off the edge of mud it is still a mud jump.
      const from = floor ?? (p.floor !== '' ? TILE_INFO[p.floor] : undefined)
      p.vy = -(T.jumpSpeed + T.jumpRunBonus * run) * (from ? from.jump : 1)
      p.jumping = true
      p.jumpCut = false
      p.jumpBuf = 0
      p.onGround = false
      p.coyote = 0
      p.ridingId = 0
      sfx(w, 'jump')
    } else {
      p.jumpBuf--
    }
  }

  // Trapezoid step: the apex comes out the same as the textbook v^2 / 2g, whatever the tick rate.
  if (p.jumping && !jumpHeld) p.jumpCut = true
  const vy0 = p.vy
  const gravity = vy0 < 0 ? (p.jumping && p.jumpCut ? T.gravCut : T.gravRise) : T.gravFall
  p.vy = Math.min(vy0 + gravity * DT, T.fallCap)
  if (p.vy >= 0) p.jumping = false
  let dy = (vy0 + p.vy) * 0.5 * DT

  const wasHovering = p.hovering
  p.hovering = false
  if (hoverWanted && p.vy > T.hoverFall) {
    p.vy = T.hoverFall
    dy = T.hoverFall * DT
    p.hovering = true
    if (!wasHovering) sfx(w, 'hover')
  }
  if (p.hovering || hoverRunning) p.hover--

  const fallSpeed = p.vy
  const dx = p.vx * DT
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / T.maxStep))
  let sx = dx / steps
  let sy = dy / steps
  let landed = false
  p.hitWall = 0
  p.hitCeil = false
  for (let i = 0; i < steps; i++) {
    if (sx !== 0) {
      const x0 = p.x
      let hit = sweepX(w, p, sx, MOVE)
      if (hit !== 0 && ontoLedge(w, p, hit)) {
        p.x = x0
        hit = sweepX(w, p, sx, MOVE)
      }
      if (hit !== 0) {
        p.hitWall = hit
        p.vx = 0
        sx = 0
      }
    }
    if (sy !== 0) {
      const hit = sy < 0 ? rise(w, p, sy) : sweepY(w, p, sy, MOVE)
      if (hit === 1) {
        landed = true
        p.vy = 0
        sy = 0
      } else if (hit === -1) {
        p.hitCeil = true
        p.vy = T.bumpRebound
        p.jumping = false
        sy = 0
      }
    }
  }

  let minX = 0
  let maxX = w.grid.w * TILE - p.w
  const arena = w.camBounds
  if (arena) {
    // A locked arena holds him in but never drags him: from outside he can only walk in.
    minX = Math.max(minX, Math.min(arena.x0, p.px))
    maxX = Math.min(maxX, Math.max(arena.x1 - p.w, p.px))
  }
  if (p.x < minX) {
    p.x = minX
    p.hitWall = -1
    if (p.vx < 0) p.vx = 0
  } else if (p.x > maxX) {
    p.x = maxX
    p.hitWall = 1
    if (p.vx > 0) p.vx = 0
  }

  if (landed) {
    if (!grounded && p.airT > 8 && fallSpeed > T.landSfxSpeed) {
      sfx(w, 'land')
      fx(w, 'dust', p.x + p.w / 2, p.y + p.h, 4)
      if (fallSpeed >= T.fallCap) rumble(w, 0.3, 0.2, 80)
    }
    p.onGround = true
    p.airT = 0
    p.coyote = T.coyoteTicks + 1
    p.hover = T.hoverTicks
    p.jumpCut = false
    p.ridingId = standingOn(w, p)
    p.floor = p.ridingId !== 0 ? '' : floorUnder(w, p)
    p.runDist += Math.abs(p.vx) * DT
  } else {
    p.onGround = false
    p.ridingId = 0
    p.airT++
    if (p.coyote > 0) p.coyote--
    // Kept while a coyote jump is still owed (see the jump above); nothing else reads it in the air.
    if (p.coyote === 0) p.floor = ''
  }

  p.spraying = st === 'normal' && spray
  p.aim = !p.onGround && down ? 'down' : up ? 'up' : 'fwd'

  if (st === 'normal' || st === 'hurt') hazards(w, p)
}

/** One tick of the flop after he is grimed: a hop, then he drops and lies there (or sinks). */
export function stepFlop(w: World): void {
  const p = w.player
  p.px = p.x
  p.py = p.y
  p.stateT++
  if (p.y > w.grid.h * TILE + 2 * TILE) return
  p.vy = Math.min(p.vy + T.gravFall * DT, T.fallCap)
  if (inSludge(w, p)) p.vy = Math.min(p.vy, 30)
  const dy = p.vy * DT
  const steps = Math.max(1, Math.ceil(Math.abs(dy) / T.maxStep))
  p.onGround = false
  for (let i = 0; i < steps; i++) {
    const hit = sweepY(w, p, dy / steps, F_TILES | F_SOLIDS)
    if (hit !== 0) {
      p.vy = 0
      p.onGround = hit === 1
      break
    }
  }
}

function inSludge(w: World, p: Player): boolean {
  const code = tileCode(w, Math.floor((p.x + p.w / 2) / TILE), Math.floor((p.y + p.h - 4) / TILE))
  return TILE_BY_CODE[code]?.hazard === 'sludge'
}

/** Whatever he stands on moves him: the lift or washed car he rides, a conveyor, a 'full' entity shoving him. */
function carry(w: World, p: Player): void {
  const solids = w.solids
  if (p.onGround && p.ridingId !== 0) {
    let s: Entity | null = null
    for (let i = 0; i < solids.length; i++) {
      if (solids[i].id === p.ridingId) {
        s = solids[i]
        break
      }
    }
    if (!s || s.dead || s.solid === 'none') {
      p.ridingId = 0
    } else {
      rideOn(w, p, s)
    }
  }
  if (p.onGround && p.floor !== '') {
    const belt = TILE_INFO[p.floor].conveyor
    if (belt !== 0) sweepX(w, p, belt * T.conveyorSpeed * DT, F_TILES | F_SOLIDS)
  }
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    if (s.solid !== 'full' || s.dead) continue
    const left = p.x + p.w - s.x
    const right = s.x + s.w - p.x
    const above = p.y + p.h - feetTop(s, s.x, s.y, p)
    const below = s.y + s.h - p.y
    if (left <= 0 || right <= 0 || above <= 0 || below <= 0) continue
    // It moved onto him: out by the shortest way, as far as the walls let him go.
    const least = Math.min(left, right, above, below)
    if (least === above) sweepY(w, p, -above, F_TILES)
    else if (least === left) sweepX(w, p, -left, F_TILES)
    else if (least === right) sweepX(w, p, right, F_TILES)
    else sweepY(w, p, below, F_TILES)
    // Still well inside it: a wall was in the way and he is squeezed. It costs a pip, and
    // he is left where he is (the thing passes over him) rather than pushed into the wall.
    if (p.x + p.w - s.x > SQUEEZE && s.x + s.w - p.x > SQUEEZE && p.y + p.h - feetTop(s, s.x, s.y, p) > SQUEEZE && s.y + s.h - p.y > SQUEEZE) {
      hurtPlayer(w, { fromX: s.x + s.w / 2 })
    }
  }
}

/**
 * Stopped by the lip of a ledge with his feet only just below its top: put him on it.
 * True if it did, and the caller takes the step again.
 */
function ontoLedge(w: World, p: Player, side: -1 | 1): boolean {
  if (p.vy < 0) return false
  const bottom = p.y + p.h
  const ty = Math.floor((bottom - EPS) / TILE)
  const top = ty * TILE
  if (bottom - top > T.ledgeNudge) return false
  const edge = side > 0 ? p.x + p.w : p.x
  const col = Math.round(edge / TILE)
  // Flush against a solid entity, not a tile: nothing to step onto.
  if (Math.abs(edge - col * TILE) > 0.01) return false
  const tx = side > 0 ? col : col - 1
  if (!(tileFlags(w, tx, ty) & T_SOLID)) return false
  // Room for all of him on top of it?
  const y = top - p.h
  const ty0 = Math.floor(y / TILE)
  for (let r = ty0; r < ty; r++) if (tileFlags(w, tx, r) & T_SOLID) return false
  const tx1 = Math.floor((p.x + p.w - EPS) / TILE)
  for (let c = Math.floor(p.x / TILE); c <= tx1; c++) if (tileFlags(w, c, ty0) & T_SOLID) return false
  p.y = y
  return true
}

/** A step upward. A clipped corner lets him slide past; a square hit bumps the block. */
function rise(w: World, p: Player, sy: number): -1 | 0 | 1 {
  const x0 = p.x
  const y0 = p.y
  const hit = sweepY(w, p, sy, MOVE)
  if (hit !== -1) return hit
  const stoppedAt = p.y
  const ty = Math.floor((y0 + sy) / TILE)
  const tx0 = Math.floor(p.x / TILE)
  const tx1 = Math.floor((p.x + p.w - EPS) / TILE)
  const b0 = blocksHead(w, tx0, ty, y0)
  const b1 = tx1 !== tx0 && blocksHead(w, tx1, ty, y0)
  // Neither column is a block: it was a solid entity overhead.
  if (!b0 && !b1) return -1
  if (tx0 !== tx1 && b0 !== b1) {
    const over = b0 ? (tx0 + 1) * TILE - p.x : p.x + p.w - tx1 * TILE
    if (over <= T.cornerNudge) {
      p.y = y0
      if (sweepX(w, p, b0 ? over : -over, F_TILES | F_SOLIDS) === 0) {
        const again = sweepY(w, p, sy, MOVE)
        if (again !== -1) return again
      }
      p.x = x0
      p.y = stoppedAt
    }
  }
  const txc = Math.floor((p.x + p.w / 2) / TILE)
  bumpTile(w, blocksHead(w, txc, ty, y0) ? txc : b0 ? tx0 : tx1, ty)
  return -1
}

function blocksHead(w: World, tx: number, ty: number, prevTop: number): boolean {
  const f = tileFlags(w, tx, ty)
  return (f & T_SOLID) !== 0 || ((f & T_HIDDEN) !== 0 && prevTop >= (ty + 1) * TILE - EPS)
}

/** The solid entity under his feet, unless a tile under the middle of him is doing the holding. */
function standingOn(w: World, p: Player): number {
  const solids = w.solids
  if (solids.length === 0) return 0
  const bottom = p.y + p.h
  let id = 0
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    if (s.dead || s.solid === 'none') continue
    if (p.x + p.w <= s.x || p.x >= s.x + s.w || Math.abs(bottom - feetTop(s, s.x, s.y, p)) > 0.01) continue
    id = s.id
    break
  }
  if (id === 0) return 0
  const f = tileFlags(w, Math.floor((p.x + p.w / 2) / TILE), Math.floor((bottom + 1) / TILE))
  return f & (T_SOLID | T_ONEWAY) && bottom % TILE === 0 ? 0 : id
}

/** Slick, oil, mud or a conveyor under him: the tile character, else ''. */
export function floorUnder(w: World, p: Player): string {
  const ty = Math.floor((p.y + p.h + 1) / TILE)
  let tx = Math.floor((p.x + p.w / 2) / TILE)
  let f = tileFlags(w, tx, ty)
  if (!(f & (T_SOLID | T_ONEWAY))) {
    tx = Math.floor(p.x / TILE)
    f = tileFlags(w, tx, ty)
    if (!(f & (T_SOLID | T_ONEWAY))) {
      tx = Math.floor((p.x + p.w - EPS) / TILE)
      f = tileFlags(w, tx, ty)
    }
  }
  return f & T_FLOOR ? String.fromCharCode(tileCode(w, tx, ty)) : ''
}

function hazards(w: World, p: Player): void {
  if (p.y > w.grid.h * TILE + 8) {
    grimePlayer(w)
    return
  }
  const bottom = p.y + p.h
  const tx0 = Math.floor((p.x + 4) / TILE)
  const tx1 = Math.floor((p.x + p.w - 4) / TILE)
  const ty0 = Math.floor((p.y + 8) / TILE)
  const ty1 = Math.floor((bottom - EPS) / TILE)
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!(tileFlags(w, tx, ty) & T_HAZARD)) continue
      if (TILE_BY_CODE[tileCode(w, tx, ty)]?.hazard === 'sludge') {
        if (bottom - ty * TILE < T.sludgeDepth) continue
        grimePlayer(w)
        // No hop out of sludge: he sinks.
        p.vy = 0
        return
      }
      if (p.invuln > 0 || p.wax > 0 || bottom <= (ty + 1) * TILE - T.spikeHeight) continue
      if (hurtPlayer(w, { fromX: tx * TILE + TILE / 2 })) return
    }
  }
}
