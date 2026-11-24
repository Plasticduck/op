// Gates and the floor button: the way on, opened by a level flag.
//
//   gate    a roll-up shutter. A wall for Maxx, cars and critters (solid 'full'), and water
//           splashes on it. props: flag (the flag's name), min (1), w (tiles, 1), h (tiles, 3).
//           Its character marks the gate's bottom-left tile: it fills w tiles to the right
//           and h tiles up from there, standing on the floor of that tile.
//           Once getFlag(w, flag) >= min and the gate is on screen it rolls up (OPEN_TICKS)
//           and is gone for good. A world that starts with the flag already there (a retry
//           from a checkpoint) has it open from the first tick. With no flag it never opens.
//           It is always awake: a sleeping solid is not solid, and a car or critter that is
//           still awake off screen must not drive through a gate the camera has not reached.
//   button  a floor button. Maxx steps on it and it raises props.flag to props.value (1);
//           it never lowers a flag. Already down if the flag is there when the area loads.
//
// Bosses and rivals open gates by setting a flag (see the protocol in the design bible);
// the button is for puzzles and test rooms.
//
// For the renderer:
//   gate    'shut' | 'opening' | 'open'. The top of the box stays put and e.h is the
//           curtain's length: props.h * 32 when shut, shrinking to GATE_TOP (the drum
//           housing) while it rolls; vars.t goes 0..1 with it. vars.push counts the ticks
//           Maxx has been leaning on it while shut (rattle it). z 0. Open, the drum is all
//           that is left in the box: not solid (solid 'none', which the bosses' tests rely on),
//           but water splashes on it.
//   button  24 x 8, 'up' | 'down', z 0.
import { TILE } from '../../contract'
import { fx, getFlag, inView, propNum, propStr, registerEntity, rumble, setBox, setFlag, setState, sfx } from '../api'
import type { Entity, World } from '../types'

/** Height of the drum housing at the top of a gate: what is left of it once it is open. */
export const GATE_TOP = 12
/** Ticks the shutter takes to roll up. */
export const OPEN_TICKS = 48
/** Ticks of leaning on a shut gate before it buzzes. */
const PUSH_BUZZ = 8

function gateFlagMet(e: Entity, w: World): boolean {
  const flag = propStr(e, 'flag', '')
  return flag !== '' && getFlag(w, flag) >= propNum(e, 'min', 1)
}

/** Is Maxx standing against the shutter and pushing into it? */
function pushing(e: Entity, w: World): boolean {
  const p = w.player
  if (p.state !== 'normal' || p.y >= e.y + e.h || p.y + p.h <= e.y) return false
  const ax = w.input.axisX
  if (ax > 0) return Math.abs(p.x + p.w - e.x) <= 1
  if (ax < 0) return Math.abs(p.x - (e.x + e.w)) <= 1
  return false
}

function setOpen(e: Entity): void {
  e.state = 'open'
  e.vars.t = 1
  e.h = GATE_TOP
  e.solid = 'none'
}

registerEntity('gate', {
  alwaysActive: true,
  init(e, w) {
    const wide = Math.max(1, Math.round(propNum(e, 'w', 1)))
    const tall = Math.max(1, Math.round(propNum(e, 'h', 3)))
    // The spawn point is the bottom-centre of the character's tile, the gate's bottom-left one.
    e.x -= TILE / 2
    e.w = wide * TILE
    e.h = tall * TILE
    e.y -= e.h
    e.gravity = 0
    e.collides = false
    e.solid = 'full'
    e.state = 'shut'
    e.vars.t = 0
    e.vars.push = 0
    if (gateFlagMet(e, w)) setOpen(e)
  },
  update(e, w) {
    if (e.state === 'shut') {
      // Leaning on it rattles the shutter and buzzes once, so it reads as a gate that wants opening, not a plain wall.
      e.vars.push = pushing(e, w) ? e.vars.push + 1 : 0
      if (e.vars.push === PUSH_BUZZ) sfx(w, 'locked')
      if (!gateFlagMet(e, w) || !inView(e, w)) return
      e.vars.push = 0
      setState(e, 'opening')
      sfx(w, 'gate')
      rumble(w, 0.3, 0.2, 400)
      fx(w, 'dust', e.x + e.w / 2, e.y + e.h, 6)
      fx(w, 'sparkle', e.x + e.w / 2, e.y + GATE_TOP / 2, 4)
    }
    if (e.state !== 'opening') return
    const full = Math.max(1, Math.round(propNum(e, 'h', 3))) * TILE
    const k = Math.min(1, e.stateT / OPEN_TICKS)
    // Slow to start, then the spring in the drum takes it.
    const ease = k * k * (3 - 2 * k)
    e.vars.t = ease
    e.h = Math.max(GATE_TOP, full - (full - GATE_TOP) * ease)
    if (k >= 1) {
      setState(e, 'open')
      setOpen(e)
      sfx(w, 'bump')
    }
  },
  onSpray(_e, w, d) {
    // Shut, the curtain takes it; open, only the drum is left in the box, and it splashes there too.
    fx(w, 'splash', d.x, d.y, 2)
    return true
  },
})

registerEntity('button', {
  init(e, w) {
    setBox(e, 24, 8)
    e.gravity = 0
    e.collides = false
    e.state = 'up'
    const flag = propStr(e, 'flag', '')
    if (flag !== '' && getFlag(w, flag) >= propNum(e, 'value', 1)) e.state = 'down'
  },
  update() {},
  onTouch(e, w) {
    if (e.state === 'down' || !w.player.onGround) return true
    setState(e, 'down')
    const flag = propStr(e, 'flag', '')
    const value = propNum(e, 'value', 1)
    if (flag !== '' && getFlag(w, flag) < value) setFlag(w, flag, value)
    sfx(w, 'click')
    fx(w, 'dust', e.x + e.w / 2, e.y + e.h, 4)
    rumble(w, 0.4, 0.2, 80)
    return true
  },
})
