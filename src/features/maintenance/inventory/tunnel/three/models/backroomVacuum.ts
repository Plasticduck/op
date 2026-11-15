import { Group } from 'three'
import { ground, plateWidth, power, setNeedle, spin, stainless, TONE } from './backroomParts'
import type { Design } from './backroomParts'

// The vacuum plant: the turbine producers and the station customers vacuum at.
// backroom.ts picks and fits them.

// A central vacuum producer: a multistage turbine on a skid (motor, coupling, ribbed
// blower drum, an upright silencer on its outlet) and beside it the tall filter
// separator the dirty air passes through first. Air comes in from the lot through a pipe
// that rises out of the floor, spins the dirt out in the separator, and goes over the top
// into the turbine. The whole skid hums: it trembles a little while it runs.
export const turbine: Design = {
  need: [6.0, 5.0],
  build(r, f) {
    const { fixed, moving, movers, chip, strut, cyl, peg, tube, tank, band, gauge, motor, cabinet, plate, pilot } = r
    const steel = stainless(r)
    const sx = f.mirror
    const X = (x: number) => sx * x
    const sz = 1.0
    for (const z of [sz - 0.85, sz + 0.85]) chip(fixed, 4.9, 0.3, 0.2, 'frame', X(-0.4), 0.15, z)
    for (const x of [-2.75, -1.1, 0.6, 1.95]) chip(fixed, 0.2, 0.26, 1.5, 'frame', X(x), 0.15, sz)
    chip(fixed, 4.7, 0.06, 1.7, 'frame', X(-0.4), 0.33, sz)

    // Everything bolted to the skid rides in one group, so it can tremble together.
    const set = new Group()
    moving.add(set)
    movers.push(set)
    const by = 1.62
    const bx = 0.6
    tank(set, 1.0, 2.3, TONE.slate, X(bx), by, sz, 'x', { head: 0.12, ribs: [0.14, 0.38, 0.62, 0.86] })
    for (const x of [-0.6, 0.6]) chip(set, 0.25, 0.42, 1.5, TONE.slate, X(bx + x), 0.57, sz)
    for (const x of [-1.27, 1.27]) cyl(set, 0.3, 0.3, 'dark', X(bx + x), by, sz, 'x')
    chip(set, 1.3, 0.57, 1.0, 'frame', X(-1.65), 0.645, sz)
    const fan = motor(set, X(-1.65), by, sz, 0.55, 1.5, sx > 0 ? '+x' : '-x', { fan: set })!
    chip(set, 0.34, 0.5, 0.6, TONE.orange, X(-0.72), by, sz)
    // Air in at the far end, out at the motor end into the silencer.
    const inX = X(bx + 0.95)
    const outX = X(bx - 0.95)
    peg(set, 0.3, 0.55, TONE.slate, inX, by + 1.2, sz, 'y', 14)
    peg(set, 0.38, 0.06, TONE.slate, inX, by + 1.47, sz, 'y', 14)
    peg(set, 0.3, 0.5, TONE.slate, outX, by + 1.2, sz, 'y', 14)
    cyl(set, 0.48, 2.5, 'frame', outX, by + 2.65, sz, 'y', { bevel: 0.12 })
    peg(set, 0.26, 0.5, 'frame', outX, by + 4.1, sz, 'y', 12)
    cyl(set, 0.42, 0.1, 'frame', outX, by + 4.42, sz, 'y', { r2: 0.3 })
    plate(set, f.label, plateWidth(f.label, 1.3, 1.7), 0.42, X(bx), by, sz + 1.055)

    // The separator: a stainless canister on legs, cone below, a bucket under the cone.
    const cx = X(1.55)
    const cz = -1.25
    tank(fixed, 1.0, 3.6, steel, cx, 4.2, cz, 'y', { head: 0.35 })
    cyl(fixed, 0.3, 1.1, steel, cx, 2.0, cz, 'y', { r2: 0.98 })
    band(fixed, 1.0, 1.05, 0.1, steel, cx, 5.6, cz)
    for (const ex of [-1, 1]) for (const ez of [-1, 1]) strut(fixed, [cx + ex * 0.76, 0.04, cz + ez * 0.76], [cx + ex * 0.76, 3.0, cz + ez * 0.76], 0.12, 'frame')
    band(fixed, 1.0, 1.07, 0.12, 'frame', cx, 2.95, cz)
    chip(fixed, 0.5, 0.08, 0.5, 'mid', cx, 1.42, cz)
    cyl(fixed, 0.55, 1.1, 'dark', cx, 0.6, cz, 'y', { r2: 0.62 })
    const hand = gauge(cx, 4.6, cz + 1.08, 0.2, '+z')
    // Over the top into the turbine.
    tube(fixed, [[cx, 5.95, cz], [cx, 6.6, cz], [cx, 6.6, sz], [cx, by + 1.52, sz]], 0.29, steel, { bend: 0.55 })
    // In from the lot: along the top of the canister's side and down into the floor.
    const [ux, uz] = f.lot === '+x' ? [sx, 0] : f.lot === '-x' ? [-sx, 0] : f.lot === '+z' ? [0, 1] : [0, -1]
    const off = 0.86
    const px = 1.55 + uz * off
    const pz = cz - ux * off
    const run = ux ? f.W / 2 - 0.55 - ux * 1.55 : f.D / 2 - 0.55 - uz * cz
    const ex = px + ux * run
    const ez = pz + uz * run
    tube(fixed, [[X(px - ux * 0.5), 5.1, pz - uz * 0.5], [X(ex), 5.1, ez], [X(ex), 0.02, ez]], 0.29, steel, { bend: 0.55 })
    peg(fixed, 0.42, 0.06, steel, X(ex), 0.03, ez, 'y', 14)
    // The starter, on a post behind the motor.
    const bxp = X(-1.9)
    strut(fixed, [bxp, 0.04, -1.3], [bxp, 2.85, -1.3], 0.12, 'frame')
    chip(fixed, 0.44, 0.04, 0.44, 'dark', bxp, 0.02, -1.3)
    cabinet(fixed, 1.3, 1.6, 0.4, 'body', bxp, 3.6, -1.3)
    const lamp = pilot('green', bxp - 0.35, 4.05, -1.08, 0.07)
    chip(fixed, 0.3, 0.44, 0.03, 'yellow', bxp + 0.2, 3.5, -1.08)
    chip(fixed, 0.09, 0.3, 0.07, 'red', bxp + 0.2, 3.5, -1.05)

    spin(r, fan, 17, bx)
    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      setNeedle(hand, on * (0.58 + 0.015 * Math.sin(s.t * 5)))
      set.position.y = on * 0.005 * Math.sin(s.t * 47)
      set.position.z = on * 0.003 * Math.sin(s.t * 31)
    })
    r.kit.pickBox(f.body, 5.2, 2.9, 2.2, X(-0.4), 1.45, sz)
    r.kit.pickCylinder(f.body, 0.56, 3.6, outX, 4.5, sz)
    r.kit.pickCylinder(f.body, 1.1, 6.1, cx, 3.05, cz)
    r.kit.pickBox(f.body, 1.4, 4.4, 0.6, bxp, 2.2, -1.25)
    ground(r, f, 4.7, 1.7, X(-0.4), sz)
    ground(r, f, 1.9, 1.9, cx, cz, true)
    return { height: 6.9, beacon: [bxp, 4.4, -1.3] }
  },
}

// The vacuum accessories station, where a customer vacuums the car: a post with two
// arms under a small canopy, a hose hanging from each arm to a nozzle holstered on the
// post, the stainless separator at its foot, a bin for trash and a rack to hang floor
// mats on. The hoses stir a little while the vacuum is on.
export const accessories: Design = {
  need: [6.2, 4.8],
  build(r, f) {
    const { fixed, moving, movers, box, chip, strut, cyl, peg, tube, plate, pilot } = r
    const steel = TONE.steel
    const pz = -0.9
    chip(fixed, 1.0, 0.06, 1.0, 'dark', 0, 0.03, pz)
    box(fixed, 0.36, 8.2, 0.36, 'frame', 0, 4.16, pz, 0.04)
    // The canopy: a slab on the arms with a fascia across the front for the name.
    const cz = pz + 0.4
    box(fixed, 5.2, 0.1, 2.4, 'blue', 0, 8.6, cz, 0.04)
    box(fixed, 5.2, 0.62, 0.1, 'blue', 0, 8.36, cz + 1.2, 0.03)
    for (const s of [-1, 1]) chip(fixed, 0.08, 0.3, 2.3, 'blue', s * 2.52, 8.44, cz)
    plate(fixed, f.label, plateWidth(f.label, 1.8, 3.2), 0.44, 0, 8.36, cz + 1.27)
    chip(fixed, 0.3, 0.5, 0.12, 'dark', 0, 5.2, pz + 0.24)
    const lamp = pilot('green', 0, 5.3, pz + 0.3, 0.07)

    // An arm each side, and a hose from its tip down in a loop to the holster.
    const sway: Group[] = []
    for (const s of [-1, 1]) {
      tube(fixed, [[0, 7.0, pz], [0, 8.3, pz], [s * 2.2, 8.3, pz]], 0.11, steel, { bend: 0.9 })
      peg(fixed, 0.12, 0.2, 'dark', s * 2.2, 8.15, pz, 'y', 10)
      chip(fixed, 0.26, 0.3, 0.2, 'dark', s * 0.3, 3.75, pz + 0.24)
      const hose = new Group()
      hose.position.set(s * 2.2, 8.05, pz)
      moving.add(hose)
      movers.push(hose)
      tube(hose, [[0, 0, 0], [0, -5.6, 0.3], [-s * 0.9, -6.5, 0.45], [-s * 1.85, -5.4, 0.36], [-s * 1.85, -4.3, 0.3]], 0.085, 'hoseBlack', { bend: 0.6, radial: r.low ? 6 : 8 })
      peg(hose, 0.1, 0.5, 'yellow', -s * 1.85, -4.08, 0.3, 'y', 10)
      peg(hose, 0.1, 0.24, 'yellow', 0, -0.2, 0, 'y', 10)
      // Its shadow: the hose moves, so it isn't in the shadow map.
      r.kit.blob(hose, 1.3, 0.4, { x: -s * 0.9, y: -8.05, z: 0.4, cast: 1.5, opacity: 0.8 })
      sway.push(hose)
    }

    // The separator at the post's foot, with its round door, piped into the post.
    const sxp = 0.98
    cyl(fixed, 0.55, 2.3, steel, sxp, 1.5, pz, 'y', { bevel: 0.1 })
    cyl(fixed, 0.2, 0.3, steel, sxp, 0.3, pz, 'y', { r2: 0.5 })
    for (const a of [0.5, 2.6, 4.7]) strut(fixed, [sxp + Math.cos(a) * 0.5, 0, pz + Math.sin(a) * 0.5], [sxp + Math.cos(a) * 0.5, 0.6, pz + Math.sin(a) * 0.5], 0.07, 'dark')
    cyl(fixed, 0.3, 0.06, 'dark', sxp, 1.6, pz + 0.55, 'z')
    chip(fixed, 0.06, 0.2, 0.06, 'mid', sxp + 0.2, 1.6, pz + 0.6)
    tube(fixed, [[sxp, 2.6, pz], [sxp, 3.2, pz], [0.2, 3.2, pz]], 0.1, steel, { bend: 0.3 })
    // The trash bin, with a domed lid and a flap.
    cyl(fixed, 0.72, 2.5, 'mid', -1.9, 1.25, 0.95, 'y', { bevel: 0.08 })
    cyl(fixed, 0.74, 0.5, 'dark', -1.9, 2.75, 0.95, 'y', { r2: 0.42, bevel: 0.1 })
    chip(fixed, 0.5, 0.22, 0.05, 'black', -1.9, 2.72, 1.56).rotation.x = -0.5
    // The mat rack: a frame with a clamp bar, a rubber mat hanging in it.
    for (const x of [1.2, 3.0]) {
      strut(fixed, [x, 0.04, 1.0], [x, 3.7, 1.0], 0.1, steel)
      chip(fixed, 0.14, 0.04, 0.9, 'dark', x, 0.02, 1.0)
    }
    strut(fixed, [1.2, 3.65, 1.0], [3.0, 3.65, 1.0], 0.1, steel)
    strut(fixed, [1.2, 0.7, 1.0], [3.0, 0.7, 1.0], 0.08, steel)
    chip(fixed, 1.6, 0.12, 0.14, 'dark', 2.1, 3.42, 1.05)
    const mat = box(fixed, 1.5, 2.2, 0.05, 'hoseBlack', 2.1, 2.3, 1.1, 0.02)
    mat.rotation.x = 0.05
    if (!r.low) for (let k = 0; k < 4; k++) chip(fixed, 1.3, 0.04, 0.02, 'dark', 2.1, 1.6 + k * 0.4, 1.16 - (k - 1.5) * 0.02)

    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      sway[0].rotation.z = on * 0.012 * Math.sin(s.t * 0.9)
      sway[1].rotation.z = on * 0.012 * Math.sin(s.t * 0.8 + 2)
    })
    r.kit.pickBox(f.body, 0.9, 8.3, 0.9, 0, 4.15, pz)
    r.kit.pickBox(f.body, 5.3, 0.9, 2.6, 0, 8.4, cz)
    r.kit.pickCylinder(f.body, 0.65, 2.8, sxp, 1.4, pz)
    r.kit.pickCylinder(f.body, 0.8, 3.0, -1.9, 1.5, 0.95)
    r.kit.pickBox(f.body, 2.0, 3.7, 0.5, 2.1, 1.85, 1.05)
    ground(r, f, 1.0, 1.0, 0, pz)
    ground(r, f, 1.4, 1.4, -1.9, 0.95, true)
    ground(r, f, 1.1, 1.1, sxp, pz, true)
    return { height: 8.7, beacon: [-2.45, 8.65, cz + 1.0] }
  },
}
