// decor: scenery that dresses a level (cones, vacuum stations, signs, curtains). It does
// nothing at all: never harmful, never solid, no gravity, no collision, water flies through.
//
//   legend: { kind: 'decor', props: { sprite: 'decor_cone', front: false, flip: false } }
//
//   sprite  'decor_<name>': frame 'tiles/decor_<name>', or the animation 'decor_<name>'
//           (atlas.meta.decor lists every prop with its size and themes)
//   front   true: drawn in front of Maxx and everything else (z 1), e.g. mitter curtains.
//           Default false: scenery behind the tiles and everything that moves (z -1), like
//           the goal arch and the doors, so a tall prop goes up behind a catwalk or a ceiling
//   flip    true: mirrored
//
// For the renderer (render/entities/decor.ts): the box is the tile it is placed in
// (32 x 32), and the prop stands on the floor of that tile, centred on it.
import { TILE } from '../../contract'
import { propBool, registerEntity, setBox } from '../api'

registerEntity('decor', {
  init(e) {
    setBox(e, TILE, TILE)
    e.gravity = 0
    e.collides = false
    e.harmful = false
    e.solid = 'none'
    e.z = propBool(e, 'front', false) ? 1 : -1
  },
  update() {},
})
