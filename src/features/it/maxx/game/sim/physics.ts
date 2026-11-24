// Box against tiles and solid entities, one axis at a time. Callers split a
// tick's movement into steps of at most TUNING.maxStep pixels, which is what
// keeps anything from tunnelling. Behaviours use moveBody() in api.ts; only
// the player controller calls the sweeps directly.
import { TILE } from '../contract'
import { AIR, TILE_BY_CODE, TILE_FLAGS, T_HIDDEN, T_ONEWAY, T_SOLID } from './tiles'
import { TUNING } from './tuning'
import type { Body, Entity, World } from './types'

/** Stopped by tiles. */
export const F_TILES = 1
/** Stopped by solid entities: lands on 'top' and 'full', walled in by 'full'. */
export const F_SOLIDS = 2
/** Hidden blocks stop it when it comes up from below (Maxx only). */
export const F_HIDDEN = 4
/** Falls through catwalks. */
export const F_NO_ONEWAY = 8

const EPS = 0.001
/** Standing this close to a 'full' entity's top still counts as on it, not beside it. */
const STEP_TOL = 2

export function tileCode(w: World, tx: number, ty: number): number {
  const g = w.grid
  return tx < 0 || ty < 0 || tx >= g.w || ty >= g.h ? AIR : g.t[ty * g.w + tx]
}

/** T_* bits of the tile at a tile position. Outside the area is air. */
export function tileFlags(w: World, tx: number, ty: number): number {
  const g = w.grid
  return tx < 0 || ty < 0 || tx >= g.w || ty >= g.h ? 0 : TILE_FLAGS[g.t[ty * g.w + tx]]
}

/**
 * The top of solid `s`, its box placed at (sx, sy), under the world span x .. x + width: the
 * highest point of its ground profile there (Entity.ground), else its box top. A span of 0 is a
 * point. Infinity when the span misses the profile (nothing of it there to stand on). Pass s.px,
 * s.py to ask where it was at the start of the tick.
 */
export function topAt(s: Entity, sx: number, sy: number, x: number, width: number): number {
  const g = s.ground
  if (g === null || g.length === 0) return sy
  let c0 = Math.floor(x - sx + EPS)
  let c1 = width > 0 ? Math.ceil(x + width - sx - EPS) - 1 : c0
  if (c0 < 0) c0 = 0
  if (c1 > g.length - 1) c1 = g.length - 1
  if (c1 < c0) return Infinity
  let best = g[c0]
  for (let c = c0 + 1; c <= c1; c++) if (g[c] < best) best = g[c]
  return sy + best
}

/** A body stands on a ground profile with its feet: its box less this much on each side (Maxx's boots are the middle 14 of his 22 px). */
const FOOT_INSET = 4

/**
 * Where body `b` stands on solid `s` (its box at sx, sy): the profile's highest point under its
 * feet, Infinity when its feet are not over the profile at all. Without a profile, the box top.
 */
export function feetTop(s: Entity, sx: number, sy: number, b: Body): number {
  if (s.ground === null) return sy
  const inset = b.w > 2 * FOOT_INSET + 1 ? FOOT_INSET : 0
  return topAt(s, sx, sy, b.x + inset, b.w - 2 * inset)
}

/** Move `b` by dx, stopping at walls. Returns the side it hit: -1 left, 1 right, 0 nothing. */
export function sweepX(w: World, b: Body, dx: number, flags: number): -1 | 0 | 1 {
  if (dx === 0) return 0
  const x0 = b.x
  b.x += dx
  let hit: -1 | 0 | 1 = 0
  if (flags & F_TILES) {
    const ty0 = Math.floor(b.y / TILE)
    const ty1 = Math.floor((b.y + b.h - EPS) / TILE)
    if (dx > 0) {
      const tx = Math.floor((b.x + b.w - EPS) / TILE)
      for (let ty = ty0; ty <= ty1; ty++) {
        if (tileFlags(w, tx, ty) & T_SOLID) {
          b.x = tx * TILE - b.w
          hit = 1
          break
        }
      }
    } else {
      const tx = Math.floor(b.x / TILE)
      for (let ty = ty0; ty <= ty1; ty++) {
        if (tileFlags(w, tx, ty) & T_SOLID) {
          b.x = (tx + 1) * TILE
          hit = -1
          break
        }
      }
    }
  }
  if (flags & F_SOLIDS) {
    const solids = w.solids
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i]
      if (s.solid !== 'full' || s === b || s.dead) continue
      if (b.y + b.h <= topAt(s, s.x, s.y, b.x, b.w) + STEP_TOL || b.y >= s.y + s.h) continue
      if (b.x + b.w <= s.x || b.x >= s.x + s.w) continue
      // Only a body that came from outside is stopped. One already inside (the entity moved onto it) is left alone.
      // Stopped means flush against it, but never further back than it began: the entity may have come
      // toward it this tick, and backing off could put it in the wall behind (the squeeze is dealt with elsewhere).
      const slack = 1 + Math.abs(s.x - s.px)
      if (dx > 0) {
        if (x0 + b.w > s.x + slack) continue
        b.x = Math.max(s.x - b.w, x0)
        hit = 1
      } else {
        if (x0 < s.x + s.w - slack) continue
        b.x = Math.min(s.x + s.w, x0)
        hit = -1
      }
    }
  }
  return hit
}

/** Move `b` by dy. Returns 1 if it landed, -1 if it hit a ceiling, 0 if nothing stopped it. */
export function sweepY(w: World, b: Body, dy: number, flags: number): -1 | 0 | 1 {
  if (dy === 0) return 0
  const prevTop = b.y
  const prevBottom = b.y + b.h
  b.y += dy
  let hit: -1 | 0 | 1 = 0
  if (flags & F_TILES) {
    const tx0 = Math.floor(b.x / TILE)
    const tx1 = Math.floor((b.x + b.w - EPS) / TILE)
    if (dy > 0) {
      const ty = Math.floor((b.y + b.h - EPS) / TILE)
      const top = ty * TILE
      for (let tx = tx0; tx <= tx1; tx++) {
        const f = tileFlags(w, tx, ty)
        if (f & T_SOLID || (f & T_ONEWAY && !(flags & F_NO_ONEWAY) && prevBottom <= top + EPS)) {
          b.y = top - b.h
          hit = 1
          break
        }
      }
    } else {
      const ty = Math.floor(b.y / TILE)
      const bottom = (ty + 1) * TILE
      for (let tx = tx0; tx <= tx1; tx++) {
        const f = tileFlags(w, tx, ty)
        if (f & T_SOLID || (flags & F_HIDDEN && f & T_HIDDEN && prevTop >= bottom - EPS)) {
          b.y = bottom
          hit = -1
          break
        }
      }
    }
  }
  if (flags & F_SOLIDS) {
    const solids = w.solids
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i]
      if (s === b || s.dead || s.solid === 'none') continue
      if (b.x + b.w <= s.x + EPS || b.x >= s.x + s.w - EPS) continue
      // The slack covers a platform that moved toward the body earlier this tick.
      const slack = 2 + Math.abs(s.y - s.py)
      if (dy > 0) {
        const top = feetTop(s, s.x, s.y, b)
        // Walking along a profile it steps up and down with the shape; never below a floor already found.
        const step = s.ground !== null && b.onGround ? TUNING.groundStep : 0
        if (prevBottom <= top + slack + step && b.y + b.h + (hit === 1 ? 0 : step) >= top) {
          const y = top - b.h
          // A platform that rose under it cannot press it up into a ceiling: the platform slips past instead.
          if (y < prevTop && flags & F_TILES && headInTile(w, b, y)) continue
          // A step down a profile goes no further than the tiles let it: a floor or a catwalk on the way catches it.
          if (y > b.y && flags & F_TILES && floorBetween(w, b, b.y + b.h, y + b.h, flags)) continue
          b.y = y
          hit = 1
        }
      } else if (s.solid === 'full') {
        const bottom = s.y + s.h
        if (prevTop >= bottom - slack && b.y < bottom) {
          // Stopped under it, but never pressed lower than it stood: one coming down on it must not drive it into the floor.
          b.y = Math.min(bottom, prevTop)
          hit = -1
        }
      }
    }
  }
  return hit
}

/** Would the top of the body be inside a solid tile if its box started at `y`? */
function headInTile(w: World, b: Body, y: number): boolean {
  const ty = Math.floor(y / TILE)
  const tx1 = Math.floor((b.x + b.w - EPS) / TILE)
  for (let tx = Math.floor(b.x / TILE); tx <= tx1; tx++) if (tileFlags(w, tx, ty) & T_SOLID) return true
  return false
}

/** Feet going down from y0 to y1 under the body's width: is there a solid tile, or the top of a catwalk it would land on, in the way? */
function floorBetween(w: World, b: Body, y0: number, y1: number, flags: number): boolean {
  const tx0 = Math.floor(b.x / TILE)
  const tx1 = Math.floor((b.x + b.w - EPS) / TILE)
  const ty1 = Math.floor((y1 - EPS) / TILE)
  for (let ty = Math.floor((y0 - EPS) / TILE); ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const f = tileFlags(w, tx, ty)
      if (f & T_SOLID || (f & T_ONEWAY && !(flags & F_NO_ONEWAY) && y0 <= ty * TILE + EPS && y1 > ty * TILE)) return true
    }
  }
  return false
}

/** The conveyor under the middle of the body's feet: -1 carries left, 1 right, 0 none. */
export function conveyorUnder(w: World, b: Body): -1 | 0 | 1 {
  const code = tileCode(w, Math.floor((b.x + b.w / 2) / TILE), Math.floor((b.y + b.h + 1) / TILE))
  return TILE_BY_CODE[code]?.conveyor ?? 0
}

/**
 * If `b` stands on a solid entity, move it along with that entity. Solid
 * entities are updated before everything else each tick, so the difference
 * between where the carrier is and where it started the tick is exactly what
 * the rider is owed. Returns the carrier's id, else 0.
 */
export function carryRider(w: World, b: Body): number {
  const solids = w.solids
  const bottom = b.y + b.h
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    if (s === b || s.dead || s.solid === 'none') continue
    if (b.x + b.w <= s.px || b.x >= s.px + s.w) continue
    if (Math.abs(bottom - feetTop(s, s.px, s.py, b)) > 1.5) continue
    rideOn(w, b, s)
    return s.id
  }
  return 0
}

/**
 * Move `b`, which stood on solid `s` at the start of the tick, by as much as `s` has moved since.
 * On a ground profile it keeps to the shape under it: up as far as the shape rises under it (a
 * wall held it while the car drove on, the car turned round), down by at most TUNING.groundStep
 * (further, and it is left in the air to fall). Tiles can end the ride: a lift that sinks through
 * a floor leaves its rider on the floor.
 */
export function rideOn(w: World, b: Body, s: Entity): void {
  const before = feetTop(s, s.px, s.py, b) - s.py
  const dx = s.x - s.px
  if (dx !== 0) sweepX(w, b, dx, F_TILES)
  let inset = feetTop(s, s.x, s.y, b) - s.y
  // Its feet now off the end, or over a drop too deep to step down: it keeps its height and falls.
  if (!(inset - before <= TUNING.groundStep)) inset = before
  // Never stood on it (no number to keep): only the carrier's own move.
  if (!Number.isFinite(inset)) inset = b.y + b.h - s.py
  sweepY(w, b, s.y + inset - b.h - b.y, F_TILES)
}
