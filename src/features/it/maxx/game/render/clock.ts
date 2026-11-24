// Drawing between two simulation ticks, for a screen faster than 60 Hz.
//
// The simulation ticks 60 times a second whatever the screen does. On a 75, 144 or 165 Hz screen
// some display frames come with no tick, and the last tick's picture shown again is a hitch
// (at 75 Hz, 15 a second, every fifth frame). The shell can draw those frames a fraction of a
// tick behind instead, each moving thing slid from where it was at the tick before toward where
// it is now. That puts the picture up to a tick late, so on a 60 Hz screen, where every frame has
// its own tick, the shell leaves it off and everything is drawn exactly as the last tick left it.
//
// The shell is the only writer of frameClock:
//   frameClock.tick++      at the start of every shell tick, whether the scene steps a world or not
//   frameClock.alpha = a   just before a frame's draw: the part of a tick gone since the last
//                          one (acc / STEP_MS, 0..1); left at 1 on a 60 Hz screen
//   frameClock.alpha = 1   just after that draw, so a tool drawing between frames sees the tick
// Left alone it stays { tick: 0, alpha: 1 }: no renderer ever slides anything.
//
// A renderer keeps a Lerp (createLerp), calls lerpTrack() in its update() and lerpFrame() at the
// top of its draw(), then reads BACK and CAM_X / CAM_Y. It slides nothing unless it was updated
// in the latest shell tick and its world stepped in that update: paused, behind a versus card,
// on a pipe trip or with the level over, the picture is the last tick's, so nothing that stands
// still can wobble. A body that moved more than LERP_MAX in one tick was put there (a respawn, a
// snap of the camera) and is drawn where it is.
//
// Everything lives in a Float64Array: a fraction kept in a closure or handed to or returned from
// a function would be boxed, an allocation every frame.
import type { World } from '../sim/types'

export const frameClock = { tick: 0, alpha: 1 }

// The slots of a Lerp that renderers read, set by lerpFrame().
/** How far back toward the tick before to draw the world's bodies, 0..1; 0 draws the tick as it is. */
export const BACK = 0
/** The same for what moves on every update() whether the world steps or not (particles, popups). */
export const BACK_FX = 1
/** The camera to draw, before rounding and shake. */
export const CAM_X = 2
export const CAM_Y = 3
// The renderer's own bookkeeping.
const SHELL_TICK = 4
const WORLD_TICK = 5
const STEPPED = 6
const NOW_X = 7
const NOW_Y = 8
const WAS_X = 9
const WAS_Y = 10

/** More than this in one tick (px) was a jump cut, not motion: drawn where it is. Faster than any fall, spring or camera slide. */
export const LERP_MAX = 24

export type Lerp = Float64Array

export function createLerp(): Lerp {
  const l = new Float64Array(11)
  l[SHELL_TICK] = -1
  return l
}

/** A new world, or a new area of it: nothing to slide from. */
export function lerpReset(l: Lerp, w: World): void {
  l[SHELL_TICK] = -1
  l[WORLD_TICK] = w.tick
  l[STEPPED] = 0
  l[NOW_X] = l[WAS_X] = w.camera.x
  l[NOW_Y] = l[WAS_Y] = w.camera.y
  l[BACK] = l[BACK_FX] = 0
}

/** In update(), after the world has (or has not) stepped. */
export function lerpTrack(l: Lerp, w: World): void {
  l[STEPPED] = w.tick !== l[WORLD_TICK] ? 1 : 0
  l[WORLD_TICK] = w.tick
  l[SHELL_TICK] = frameClock.tick
  l[WAS_X] = l[NOW_X]
  l[WAS_Y] = l[NOW_Y]
  l[NOW_X] = w.camera.x
  l[NOW_Y] = w.camera.y
}

/** At the top of draw(): sets BACK, BACK_FX, CAM_X and CAM_Y for this frame. */
export function lerpFrame(l: Lerp, w: World): void {
  const a = frameClock.alpha
  // `a >= 0 && a < 1` is false for NaN too.
  const fresh = l[SHELL_TICK] === frameClock.tick && a >= 0 && a < 1
  const back = fresh ? 1 - a : 0
  l[BACK_FX] = back
  // A world stepped since (a tool driving it by hand) has no tick before on record.
  const b = l[STEPPED] === 1 && w.tick === l[WORLD_TICK] ? back : 0
  l[BACK] = b
  const cx = w.camera.x
  const cy = w.camera.y
  const dx = cx - l[WAS_X]
  const dy = cy - l[WAS_Y]
  l[CAM_X] = b > 0 && dx <= LERP_MAX && dx >= -LERP_MAX ? cx - dx * b : cx
  l[CAM_Y] = b > 0 && dy <= LERP_MAX && dy >= -LERP_MAX ? cy - dy * b : cy
}
