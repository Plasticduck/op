// Things that stand in a level: checkpoint, goal, secretExit, sign.
//
// For the renderer (box w x h, states; all stand on the floor of their tile):
//   checkpoint  24 x 56   'idle' | 'on'     z -1. vars.fresh is 1 when it was taken on this
//                                           attempt (the flag runs up the pole); on a retry
//                                           that starts here or further on in its area it is
//                                           'on' from the first tick
//   goal        96 x 160  'idle' | 'open'   z -1: the arch, three tiles wide and five tall,
//                                           centred on its tile. He must step between its
//                                           pillars (GOAL_REACH px either side of the middle)
//   goalFront   96 x 160  'idle' | 'open'   z 1: the arch's near pillar, made by the goal itself
//                                           so that Maxx walks behind it. Never place one
//   secretExit  32 x 64   'idle' | 'open'   z -1: the frame, the way in and the lamp. Maxx must
//                                           step to within 16 px of its middle (4 px in the air).
//                                           He does no victory walk: he coasts to a stop in the
//                                           doorway, or drops straight down into it
//   secretFront 32 x 64   'idle' | 'open'   z 1: the door's leaf, made by the secretExit itself,
//                                           so it can swing shut in front of him. Never place one
//   sign        24 x 32   'idle' | 'near'   z 0. Show props.text while 'near': Maxx within props.range
//                                           px (default 56) sideways and 72 up or down. Once near it
//                                           stays near through a full jump. stateT counts from the moment
//                                           it became near (the board drops in)
// The level is over the moment an exit opens, and entities stop updating: time an 'open'
// animation with world.statusT, not stateT. vars.front is the id of a goal's or a
// secretExit's front piece.
import { completeLevel, dxToPlayer, entityById, fx, nearPlayer, propNum, registerEntity, setBox, setCheckpoint, setState, spawn } from '../api'
import { TUNING as T } from '../tuning'
import type { Entity } from '../types'

/** How far from the middle of the arch, in pixels, still counts as between its pillars. */
const GOAL_REACH = 20
/**
 * How near the middle of the employees' door he must be to go in while in the air. Twice this is
 * more than a tick of his top speed (215 px/s, 3.6 px), so a jump through the doorway never skips it.
 */
const SECRET_AIR_REACH = 4

function scenery(e: Entity, width: number, height: number): void {
  setBox(e, width, height)
  e.gravity = 0
  e.collides = false
  e.z = -1
}

/* checkpoint: the wash station flag. State 'on' once Maxx has touched it. */

registerEntity('checkpoint', {
  init(e, w) {
    scenery(e, 24, 56)
    const cp = w.checkpoint
    // A retry finds its own flag already up, and every one before it in its area too: walking back
    // over a flag already passed never moves the next retry back to it. (Areas run left to right,
    // and a level with several checkpoints has them all in one area.)
    if (cp && cp.areaId === w.area.id && e.x + e.w / 2 <= cp.x + 1) e.state = 'on'
  },
  update() {},
  onTouch(e, w) {
    if (!setState(e, 'on')) return true
    e.vars.fresh = 1
    setCheckpoint(w, e.x + e.w / 2, e.y + e.h)
    fx(w, 'sparkle', e.x + e.w / 2, e.y + 8, 8)
    return true
  },
})

/* goal: the wash exit arch. State 'open' once he is through. */

registerEntity('goal', {
  init(e, w) {
    // Its near pillar is a thing of its own, in front of Maxx, so he is seen to walk through the arch.
    const front = spawn(w, 'goalFront', e.x, e.y)
    scenery(e, 96, 160)
    e.vars.front = front ? front.id : 0
  },
  update() {},
  onTouch(e, w) {
    // He has to step into the arch, not brush its post.
    if (Math.abs(dxToPlayer(e, w)) > GOAL_REACH) return true
    setState(e, 'open')
    const front = entityById(w, e.vars.front)
    if (front) setState(front, 'open')
    completeLevel(w, 'goal')
    fx(w, 'confetti', e.x + e.w / 2, e.y + 40, 16)
    return true
  },
})

registerEntity('goalFront', {
  init(e) {
    scenery(e, 96, 160)
    e.z = 1
  },
  update() {},
})

/* secretExit: the hidden way out, to Rival Row */

registerEntity('secretExit', {
  init(e, w) {
    // Its door shuts behind him: the leaf is a thing of its own, drawn in front of Maxx.
    const front = spawn(w, 'secretFront', e.x, e.y)
    scenery(e, 32, 64)
    e.vars.front = front ? front.id : 0
  },
  update() {},
  onTouch(e, w) {
    // In the air he would drift on past the doorway, so there it takes him only right in the middle.
    if (Math.abs(dxToPlayer(e, w)) > (w.player.onGround ? e.w / 2 : SECRET_AIR_REACH)) return true
    setState(e, 'open')
    const front = entityById(w, e.vars.front)
    if (front) setState(front, 'open')
    // He goes in, not past: no victory walk, and he coasts to a stop in the middle of the
    // doorway so the door can shut in front of him (in the air he is already over the middle,
    // see SECRET_AIR_REACH, and drops straight down into it).
    completeLevel(w, 'secret', { walk: false, stopAt: e.x + e.w / 2 })
    fx(w, 'star', e.x + e.w / 2, e.y + 16, 16)
    return true
  },
})

registerEntity('secretFront', {
  init(e) {
    scenery(e, 32, 64)
    e.z = 1
  },
  update() {},
})

/* sign: props.text is shown by the renderer while state is 'near' */

/** How far up a sign still counts Maxx as near once its board is showing: past a full jump, so a hop by it never blinks the board out. */
const SIGN_KEEP_UP = 200
/** And how much further sideways, so standing right at the edge of its range does not flicker it. */
const SIGN_KEEP_SIDE = 12

registerEntity('sign', {
  init(e) {
    scenery(e, 24, 32)
    // Its board of text has to show over the tiles.
    e.z = 0
  },
  update(e, w) {
    const range = propNum(e, 'range', T.signRange)
    const near = e.state === 'near' ? nearPlayer(e, w, range + SIGN_KEEP_SIDE, SIGN_KEEP_UP) : nearPlayer(e, w, range, 72)
    setState(e, near ? 'near' : 'idle')
  },
})
