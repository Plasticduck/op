// Ways between areas: pipe, door, marker.
//
//   pipe    put its character in the air cell just above a pipe's top row ('P' tiles).
//           It covers the whole width of that pipe. Maxx stands on the pipe and
//           presses down.  props.to = 'areaId:markerName'.
//   door    Maxx stands in front of it and presses up.  props.to as above.
//           LOCKED with props.flag (and props.min, default 1): barred until
//           getFlag(w, flag) >= min. Pressing up at it then only plays 'locked'.
//           It unlocks, with a little show, once the flag is there and the door is
//           on screen; on a retry with the flag already set it starts unlocked.
//   marker  props.name: where a warp arrives. A marker sitting on a pipe's top
//           row makes Maxx rise out of that pipe.
// A pipe or door with props.name is an arrival point too, so one entity can
// serve a two-way pipe: { kind: 'pipe', props: { name: 'a', to: 'bonus:b' } }.
//
// For the renderer: pipe and marker draw nothing (the 'P' tiles are the pipe;
// the pipe entity is an 8 px strip across its mouth, state 'idle' | 'used').
// door is 28 x 56, z -1, 'locked' | 'unlock' (UNLOCK_TICKS: the bars slide away and the
// padlock drops) | 'idle' | 'open' (40 ticks after he goes through). vars.rattle counts
// down from RATTLE_TICKS after he tries a locked door. During a trip world.warp is set and
// player.state is 'warp', and no entity updates: time the door swinging with world.warp.t.
// For mode 'pipe' draw Maxx behind the tiles, he slides down into the pipe ('out') and up
// out of the far one ('in').
import { TILE } from '../../contract'
import { downHeld, fx, getFlag, inView, pipeSpan, propNum, propStr, registerEntity, rumble, setBox, setState, sfx, upPressed, warpTo } from '../api'
import type { Entity, World } from '../types'

/** Ticks a door spends in 'unlock' before it can be used. */
export const UNLOCK_TICKS = 30
/** Ticks the padlock shakes after a try at a locked door. */
export const RATTLE_TICKS = 14

registerEntity('pipe', {
  init(e, w) {
    // The spawn point is the bottom of the cell above the pipe, which is the pipe's top edge.
    const span = pipeSpan(w, Math.floor(e.x / TILE), Math.floor(e.y / TILE))
    e.w = span ? span.w : TILE
    e.x = span ? span.x : e.x - TILE / 2
    e.h = 8
    e.y -= e.h
    e.gravity = 0
    e.collides = false
    e.z = -1
  },
  update(e, w) {
    if (e.state === 'used' && e.stateT > 40) setState(e, 'idle')
    const p = w.player
    if (p.state !== 'normal' || !p.onGround) return
    if (!downHeld(w)) return
    if (Math.abs(p.y + p.h - (e.y + e.h)) > 1) return
    const cx = p.x + p.w / 2
    if (cx < e.x + 6 || cx > e.x + e.w - 6) return
    const to = propStr(e, 'to', '')
    if (to !== '' && warpTo(w, to, 'pipe', e.x + e.w / 2)) setState(e, 'used')
  },
})

function doorLocked(e: Entity, w: World): boolean {
  const flag = propStr(e, 'flag', '')
  return flag !== '' && getFlag(w, flag) < propNum(e, 'min', 1)
}

/** Is Maxx standing in front of the door, able to use it? */
function atDoor(e: Entity, w: World): boolean {
  const p = w.player
  if (p.state !== 'normal' || !p.onGround) return false
  const cx = p.x + p.w / 2
  return cx >= e.x && cx <= e.x + e.w && p.y + p.h > e.y && p.y < e.y + e.h
}

registerEntity('door', {
  init(e, w) {
    setBox(e, 28, 56)
    e.gravity = 0
    e.collides = false
    e.z = -1
    e.vars.rattle = 0
    if (doorLocked(e, w)) e.state = 'locked'
  },
  update(e, w) {
    if (e.vars.rattle > 0) e.vars.rattle--
    if (e.state === 'locked') {
      if (!doorLocked(e, w)) {
        // Wait until he can see it happen.
        if (!inView(e, w)) return
        setState(e, 'unlock')
        e.vars.rattle = 0
        sfx(w, 'unlock')
        fx(w, 'sparkle', e.x + e.w / 2, e.y + e.h / 2, 8)
        rumble(w, 0.2, 0.3, 90)
      } else if (upPressed(w) && atDoor(e, w)) {
        sfx(w, 'locked')
        e.vars.rattle = RATTLE_TICKS
      }
      return
    }
    if (e.state === 'unlock') {
      if (e.stateT < UNLOCK_TICKS) return
      setState(e, 'idle')
    }
    if (e.state === 'open' && e.stateT > 40) setState(e, 'idle')
    // A fresh push, not a hold: holding up must not walk him straight back through.
    if (!upPressed(w) || !atDoor(e, w)) return
    const to = propStr(e, 'to', '')
    if (to !== '' && warpTo(w, to, 'door')) setState(e, 'open')
  },
})

registerEntity('marker', {
  init(e) {
    setBox(e, 0, 0)
    e.gravity = 0
    e.collides = false
  },
  update() {},
})
