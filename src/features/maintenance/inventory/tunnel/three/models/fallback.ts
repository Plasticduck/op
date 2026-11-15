import { Group } from 'three'
import type { Mesh } from 'three'
import { CAR } from '../car'
import type { Swatch } from '../kit'
import type { Model, ModelInput } from '../types'

// The stand-in for any kind without a model of its own (and for kinds nobody has
// thought of yet): a plain, labeled shape that respects the footprint and stays out of
// the car's way. It picks one of four forms:
//   pad     rooms and text: a low floor pad with the name on it
//   plate   things in the car's path (conveyor, roller plates): a low plate to drive over
//   portal  things that span the tunnel: posts and a header the car passes under
//   box     everything else: a machine cabinet on a plinth
// Every part uses the sign material (flat swatches plus the name plate), so a fallback is
// one draw call.

const HEADROOM = 9.2

export function fallback(input: ModelInput): Model {
  const { kit, w, h } = input
  const name = input.item.label || input.item.kind.replace(/_/g, ' ')
  const parts = new Group()
  const root = new Group()
  root.name = `fallback:${input.item.kind}`
  const mat = kit.mat.sign

  const add = (m: Mesh, swatch: Swatch | null, x: number, y: number, z: number): Mesh => {
    if (swatch) kit.swatch(m.geometry, swatch)
    m.position.set(x, y, z)
    parts.add(m)
    return m
  }

  const kind = input.item.kind
  const scenery = kind === 'room' || kind === 'label'
  // In the car's way: its footprint reaches well under the body, not just a brush's
  // width into the lane.
  const reach = CAR.width / 2 - 1.2
  const inLane = input.side !== 'outside' && input.y - h / 2 < CAR.z + reach && input.y + h / 2 > CAR.z - reach
  const spans = inLane && h >= CAR.width + 2
  let height: number

  if (scenery) {
    // A floor pad the room's machines stand on, with its name along the far edge.
    height = 0.08
    if (kind === 'room') add(kit.box(w, 0.07, h, mat, 0.03), 'pad', 0, 0.035, 0)
    const sw = Math.min(w - 1, Math.max(4, name.length * 0.62))
    const sign = add(kit.sign(name, sw, 0.9), null, kind === 'room' ? -w / 2 + sw / 2 + 0.6 : 0, 0.085, kind === 'room' ? -h / 2 + 0.95 : 0)
    sign.rotation.x = -Math.PI / 2
  } else if (spans) {
    height = HEADROOM + 0.4
    const post = 0.36
    const legs = [-(h / 2 - post / 2), h / 2 - post / 2]
    const frames = w > 6 ? [-(w / 2 - 0.6), w / 2 - 0.6] : [0]
    for (const x of frames) {
      for (const z of legs) {
        add(kit.box(post, HEADROOM, post, mat, 0.04), 'frame', x, HEADROOM / 2, z)
        add(kit.box(post + 0.5, 0.08, post + 0.5, mat, 0.03), 'dark', x, 0.04, z)
        kit.pickBox(root, post + 0.6, HEADROOM, post + 0.6, x, HEADROOM / 2, z)
      }
      add(kit.box(post, post, h, mat, 0.04), 'frame', x, HEADROOM + post / 2, 0)
      kit.pickBox(root, post + 0.4, post + 0.6, h, x, HEADROOM + post / 2, 0)
    }
    if (frames.length > 1) {
      for (const z of legs) add(kit.box(w - 1.2, post * 0.7, post * 0.7, mat, 0.04), 'frame', 0, HEADROOM + post / 2, z)
    }
    // The name on the header, facing both ways along the tunnel.
    const sw = Math.min(h - 2, Math.max(3, name.length * 0.5))
    for (const dir of [-1, 1]) {
      const x = frames[dir < 0 ? 0 : frames.length - 1] + dir * (post / 2 + 0.07)
      add(kit.box(0.08, 0.95, sw + 0.3, mat, 0.03), 'dark', x - dir * 0.03, HEADROOM - 0.35, 0)
      const sign = add(kit.sign(name, sw, 0.7), null, x + dir * 0.015, HEADROOM - 0.35, 0)
      sign.rotation.y = (dir * Math.PI) / 2
    }
  } else if (inLane) {
    height = kind === 'conveyor' ? 0.32 : 0.14
    add(kit.box(w, height, h, mat, 0.05), kind === 'conveyor' ? 'blue' : 'mid', 0, height / 2, 0)
    kit.pickBox(root, w, 0.6, Math.max(h, 1.2), 0, 0.3, 0)
  } else {
    const bw = Math.max(0.8, w - 0.7)
    const bd = Math.max(0.8, h - 0.7)
    const bh = Math.min(5, Math.max(2.4, Math.min(w, h) * 0.95))
    height = bh + 0.3
    add(kit.box(bw - 0.3, 0.3, bd - 0.3, mat, 0.03), 'dark', 0, 0.15, 0)
    add(kit.box(bw, bh, bd, mat, 0.12), 'body', 0, 0.3 + bh / 2, 0)
    add(kit.box(bw * 0.5, 0.12, bd * 0.5, mat, 0.04), 'mid', 0, 0.3 + bh + 0.06, 0)
    const sw = Math.min(bw - 0.5, Math.max(1.6, name.length * 0.36))
    for (const dir of [-1, 1]) {
      const sign = add(kit.sign(name, sw, Math.min(0.62, sw * 0.24)), null, 0, 0.3 + bh * 0.72, dir * (bd / 2 + 0.012))
      if (dir < 0) sign.rotation.y = Math.PI
    }
    kit.pickBox(root, bw, bh + 0.3, bd, 0, (bh + 0.3) / 2, 0)
    // It stands still and is in the shadow map: only a faint patch where it meets the floor.
    kit.blob(root, bw, bd, { shape: 'box', opacity: 0.5, soft: 0.7 })
  }

  root.add(kit.mergeStatic(parts))
  return { root, height }
}
