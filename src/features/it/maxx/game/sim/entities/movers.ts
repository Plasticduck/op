// Things Maxx rides: spring, lift.
//
//   spring  a tire stack. Land on it and it throws him up. props.power scales the throw (1).
//   lift    a moving platform. It travels from where it is placed to (dx, dy)
//           tiles away and back.  props: dx, dy (tiles), speed (px/s, 60),
//           wait (ticks at each end, 30), w (width in tiles, 3).
//           Its character marks the middle tile of the platform (the left of
//           the two middle tiles for an even width); its top is that tile's top.
//
// For the renderer (box w x h, states):
//   spring  28 x 22            'idle' | 'boing' (14 ticks after a launch)
//   lift    (32 x tiles) x 12  'move' | 'wait'
import { TILE } from '../../contract'
import { fx, launchPlayer, propNum, registerEntity, rumble, setBox, setState, sfx, shuttle } from '../api'
import { TUNING as T } from '../tuning'

registerEntity('spring', {
  init(e) {
    setBox(e, 28, 22)
    e.solid = 'top'
    e.gravity = 0
    e.collides = false
  },
  update(e, w) {
    if (e.state === 'boing' && e.stateT > 14) setState(e, 'idle')
    const p = w.player
    if (p.ridingId !== e.id || (p.state !== 'normal' && p.state !== 'hurt')) return
    launchPlayer(w, T.springSpeed * propNum(e, 'power', 1))
    setState(e, 'boing')
    e.stateT = 0
    sfx(w, 'spring')
    fx(w, 'dust', e.x + e.w / 2, e.y, 4)
    rumble(w, 0.4, 0.3, 90)
  },
})

registerEntity('lift', {
  alwaysActive: true,
  init(e) {
    const tiles = Math.max(1, Math.round(propNum(e, 'w', 3)))
    e.w = tiles * TILE
    e.h = 12
    e.x = e.x - TILE / 2 - Math.floor((tiles - 1) / 2) * TILE
    e.y -= TILE
    e.solid = 'top'
    e.gravity = 0
    e.collides = false
    e.state = 'move'
    // How far along its run it is (0..1), which way it is going, and ticks left to wait.
    e.vars.t = 0
    e.vars.dir = 1
    e.vars.wait = 0
  },
  update(e) {
    shuttle(e, propNum(e, 'dx', 0) * TILE, propNum(e, 'dy', 0) * TILE, propNum(e, 'speed', T.liftSpeed), propNum(e, 'wait', T.liftWait))
    setState(e, e.vars.wait > 0 ? 'wait' : 'move')
  },
})
