import { Group } from 'three'
import { ground, plateWidth, power, setNeedle, stainless, TONE } from './backroomParts'
import type { Design } from './backroomParts'

// The water side of the equipment room: the R.O. unit, the softener, the water heater.
// backroom.ts picks and fits them.

// A reverse osmosis skid: a stainless frame carrying four membrane housings, the
// high-pressure pump, prefilters and a panel of gauges and flow meters, with the tall
// poly tank the spot-free water is stored in beside it and the small pump that sends it
// on to the tunnel.
export const roUnit: Design = {
  need: [7.7, 4.6],
  build(r, f) {
    const { fixed, moving, movers, box, chip, strut, cyl, peg, tube, tank, gauge, plate, pilot, motor, motorUp } = r
    const steel = TONE.steel
    const x0 = -3.7
    const x1 = 0.1
    const z0 = -1.0
    const z1 = 0.8
    const top = 4.5
    for (const x of [x0, x1]) {
      for (const z of [z0, z1]) {
        strut(fixed, [x, 0.05, z], [x, top, z], 0.14, steel)
        chip(fixed, 0.32, 0.05, 0.32, 'dark', x, 0.025, z)
      }
    }
    for (const y of [0.42, 2.2, top - 0.06]) {
      for (const z of [z0, z1]) strut(fixed, [x0, y, z], [x1, y, z], 0.12, steel)
      if (y !== 2.2) for (const x of [x0, x1]) strut(fixed, [x, y, z0], [x, y, z1], 0.12, steel)
    }
    // The membrane housings: white pressure tubes racked up the back, joined end to end.
    const mz = z0 + 0.32
    const mid = (x0 + x1) / 2
    for (let k = 0; k < 4; k++) {
      const y = 1.22 + k * 0.8
      cyl(fixed, 0.2, 3.44, 'white', mid, y, mz, 'x', { bevel: 0.03 })
      for (const x of [x0 + 0.13, x1 - 0.13]) cyl(fixed, 0.23, 0.14, 'dark', x, y, mz, 'x')
    }
    for (const x of [x0 + 1.0, x1 - 1.0]) chip(fixed, 0.1, top - 0.5, 0.05, steel, x, top / 2 + 0.2, mz - 0.24)
    const jump = (x: number, dir: number, ya: number) => tube(fixed, [[x, ya, mz], [x + dir * 0.3, ya, mz], [x + dir * 0.3, ya + 0.8, mz], [x, ya + 0.8, mz]], 0.05, 'mid', { bend: 0.16 })
    jump(x1 - 0.06, 1, 1.22)
    jump(x0 + 0.06, -1, 2.02)
    jump(x1 - 0.06, 1, 2.82)

    // The high-pressure pump: a stainless column with its motor standing on top.
    const px = x1 - 0.62
    const pz = z1 - 0.42
    chip(fixed, 0.5, 0.14, 0.5, 'dark', px, 0.55, pz)
    cyl(fixed, 0.17, 1.35, steel, px, 1.3, pz)
    cyl(fixed, 0.22, 0.2, 'dark', px, 2.07, pz)
    motorUp(fixed, px, 2.17, pz, 0.24, 0.8)
    peg(fixed, 0.07, 0.5, steel, px - 0.3, 0.8, pz, 'x')
    // Two blue prefilters hang from the front rail.
    for (const x of [x0 + 0.5, x0 + 1.15]) {
      cyl(fixed, 0.22, 1.4, TONE.drum, x, 1.3, z1 + 0.3, 'y', { bevel: 0.08 })
      cyl(fixed, 0.25, 0.18, 'black', x, 2.08, z1 + 0.3)
      chip(fixed, 0.3, 0.1, 0.34, 'dark', x, 2.2, z1 + 0.14)
    }
    peg(fixed, 0.05, 1.5, 'mid', x0 + 0.825, 2.08, z1 + 0.3, 'x')

    // The panel: two gauges, two flow meters with floats that ride the flow, the name.
    const cx = x0 + 1.25
    const face = z1 + 0.27
    box(fixed, 2.1, 1.7, 0.26, 'body', cx, 3.45, z1 + 0.13, 0.03)
    const feed = gauge(cx - 0.7, 3.95, face + 0.05, 0.17, '+z')
    const reject = gauge(cx - 0.25, 3.95, face + 0.05, 0.17, '+z')
    const floats: Group[] = []
    for (const x of [cx + 0.36, cx + 0.7]) {
      peg(fixed, 0.055, 0.8, 'white', x, 3.78, face + 0.05)
      for (const y of [3.36, 4.2]) chip(fixed, 0.17, 0.07, 0.13, 'dark', x, y, face + 0.04)
      const float = new Group()
      float.position.set(x, 3.44, face + 0.06)
      moving.add(float)
      movers.push(float)
      chip(float, 0.125, 0.07, 0.125, 'red', 0, 0, 0)
      floats.push(float)
    }
    const lamp = pilot('green', cx - 0.7, 3.42, face, 0.06)
    chip(fixed, 0.13, 0.13, 0.05, 'dark', cx - 0.3, 3.42, face + 0.02)
    plate(fixed, f.label, plateWidth(f.label, 1.3, 1.8), 0.38, cx, 2.9, face + 0.02)

    // The storage tank, with a sight tube up its front and a marker at the water level.
    const tx = 2.45
    const tz = -0.1
    const TR = 1.3
    tank(fixed, TR, 6, 'white', tx, 3, tz, 'y', { flat: true, head: 0.45, ribs: [0.3, 0.7] })
    cyl(fixed, 0.42, 0.12, 'dark', tx, 6.02, tz)
    const sz = tz + TR + 0.09
    peg(fixed, 0.03, 4.3, 'hoseWhite', tx, 2.75, sz, 'y', 6)
    for (const y of [0.6, 4.9]) chip(fixed, 0.1, 0.08, 0.16, 'dark', tx, y, sz - 0.05)
    const level = new Group()
    level.position.set(tx, 1.2, sz + 0.01)
    moving.add(level)
    movers.push(level)
    chip(level, 0.14, 0.11, 0.08, 'red', 0, 0, 0)
    // The pump that sends the stored water on, and the lines between the three.
    chip(fixed, 1.0, 0.08, 0.5, 'dark', 0.9, 0.04, 1.3)
    motor(fixed, 0.72, 0.33, 1.3, 0.2, 0.5, '+x')
    cyl(fixed, 0.2, 0.26, steel, 1.22, 0.33, 1.3, 'x')
    tube(fixed, [[1.34, 0.33, 1.3], [1.85, 0.33, 1.3], [1.85, 0.33, 0.9]], 0.06, 'mid', { bend: 0.15 })
    tube(fixed, [[1.22, 0.5, 1.3], [1.22, 1.3, 1.3], [0.62, 1.3, 1.3], [0.62, 1.3, -2.1]], 0.05, 'mid', { bend: 0.18 })
    tube(fixed, [[x1 - 0.35, 3.82, mz], [x1 - 0.35, 6.32, mz], [tx - 0.55, 6.32, mz], [tx - 0.55, 6.32, tz - 0.25], [tx - 0.55, 5.85, tz - 0.25]], 0.06, 'mid', { bend: 0.22 })

    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      setNeedle(feed, on * (0.64 + 0.012 * Math.sin(s.t * 3.1)))
      setNeedle(reject, on * (0.42 + 0.012 * Math.sin(s.t * 2.3 + 1)))
      floats[0].position.y = 3.44 + on * (0.42 + 0.03 * Math.sin(s.t * 2.1))
      floats[1].position.y = 3.44 + on * (0.22 + 0.02 * Math.sin(s.t * 1.6 + 2))
      // The tank fills and is drawn down, slowly. Down, the marker rests near the bottom.
      level.position.y = 1.2 + on * (2.2 + Math.sin(s.t * 0.11))
    })
    r.kit.pickBox(f.body, 3.95, top, 2.5, mid, top / 2, 0.05)
    r.kit.pickCylinder(f.body, TR + 0.08, 6.1, tx, 3.05, tz)
    ground(r, f, 3.8, 1.8, mid, -0.1)
    ground(r, f, 2.3, 2.3, tx, tz, true)
    return { height: 6.4, beacon: [x0, top, z1] }
  },
}

// A twin water softener: two tall resin tanks, each with a control valve on top, piped
// together behind, and the squat brine tank they draw salt water from. One tank is in
// service while the other stands by, and they trade places.
export const softener: Design = {
  need: [6.9, 3.6],
  build(r, f) {
    const { fixed, box, chip, cyl, peg, tube, tank, gauge, plate, pilot, valve } = r
    const R = 0.75
    const tz = -0.25
    const xs = [-2.45, -0.7]
    const lamps = xs.map((x) => {
      tank(fixed, R, 5.2, TONE.drum, x, 2.72, tz, 'y', { head: 0.42 })
      cyl(fixed, R + 0.03, 0.42, 'black', x, 0.21, tz)
      peg(fixed, 0.2, 0.2, 'black', x, 5.38, tz, 'y', 12)
      box(fixed, 0.66, 0.62, 0.6, 'dark', x, 5.77, tz + 0.02, 0.05)
      chip(fixed, 0.42, 0.28, 0.03, 'mid', x - 0.06, 5.82, tz + 0.33)
      chip(fixed, 0.24, 0.11, 0.035, 'black', x - 0.1, 5.86, tz + 0.335)
      // The valve's two ports reach back to the headers.
      peg(fixed, 0.065, 0.36, 'mid', x - 0.12, 5.91, tz - 0.44, 'z')
      peg(fixed, 0.065, 0.58, 'mid', x + 0.12, 5.65, tz - 0.55, 'z')
      return pilot('green', x + 0.2, 5.64, tz + 0.33, 0.05)
    })
    // Hard water in along one header, soft water out along the other, both dropping to
    // the floor and off toward the tunnel.
    tube(fixed, [[-2.75, 5.91, tz - 0.62], [0.28, 5.91, tz - 0.62], [0.28, 0.3, tz - 0.62], [0.28, 0.3, -1.75]], 0.07, 'mid', { bend: 0.2 })
    tube(fixed, [[-2.75, 5.65, tz - 0.84], [0.58, 5.65, tz - 0.84], [0.58, 0.3, tz - 0.84], [0.58, 0.3, -1.75]], 0.07, 'mid', { bend: 0.2 })
    valve(fixed, 0.28, 3.5, tz - 0.62, 'y', 0.06, 'blue')
    valve(fixed, 0.58, 3.0, tz - 0.84, 'y', 0.06, 'red')
    gauge(-1.575, 6.24, tz - 0.62, 0.15, '+z', false, 0.58)
    // The brine tank, its lid, and the thin line each valve draws brine through.
    const bx = 2.2
    const bz = 0.15
    cyl(fixed, 1.0, 3.0, 'white', bx, 1.5, bz, 'y', { r2: 1.05, bevel: 0.05 })
    cyl(fixed, 1.09, 0.16, 'dark', bx, 3.06, bz, 'y', { bevel: 0.05 })
    peg(fixed, 0.16, 0.12, 'dark', bx + 0.5, 3.18, bz - 0.3)
    tube(fixed, [[bx - 0.5, 3.14, -0.45], [bx - 0.5, 3.55, -0.45], [0.1, 3.55, -0.45], [0.1, 5.7, -0.45], [-0.37, 5.7, -0.45]], 0.025, 'hoseBlack', { bend: 0.15, radial: 4 })
    peg(fixed, 0.025, 1.09, 'hoseBlack', -1.575, 5.7, -0.45, 'x', 4)
    // Bags of salt, stacked by the brine tank.
    for (let k = 0; k < (r.low ? 2 : 3); k++) {
      const x = 0.55 + (k % 2) * 0.08
      const z = 1.15 - (k % 2) * 0.06
      box(fixed, 1.5, 0.3, 0.9, 'white', x, 0.16 + k * 0.3, z, 0.1)
      chip(fixed, 0.5, 0.31, 0.92, 'blue', x, 0.16 + k * 0.3, z)
    }
    plate(fixed, f.label, plateWidth(f.label, 1.5, 2.0), 0.44, -1.575, 3.7, tz + R + 0.04)

    r.ticks.push((s) => {
      const on = power(s) > 0.5
      const lead = Math.floor(s.t / 45) % 2
      lamps[0].set(on && lead === 0)
      lamps[1].set(on && lead === 1)
    })
    for (const x of xs) {
      r.kit.pickCylinder(f.body, R + 0.08, 6.1, x, 3.05, tz)
      ground(r, f, 1.4, 1.4, x, tz, true)
    }
    r.kit.pickCylinder(f.body, 1.12, 3.2, bx, 1.6, bz)
    ground(r, f, 1.9, 1.9, bx, bz, true)
    return { height: 6.4, beacon: [-0.7, 6.08, tz] }
  },
}

// A gas water heater: the tall jacketed tank, its burner box at the bottom, the flue off
// the top, and the hot line running out past a red circulator pump.
export const waterHeater: Design = {
  need: [5.2, 3.9],
  build(r, f) {
    const { fixed, box, chip, strut, cyl, peg, tube, tank, band, gauge, plate, pilot, valve } = r
    const steel = stainless(r)
    const tx = -0.9
    const tz = -0.25
    const R = 1.05
    cyl(fixed, R - 0.08, 0.36, 'dark', tx, 0.18, tz)
    tank(fixed, R, 5, 'hoseWhite', tx, 2.86, tz, 'y', { head: 0.22, flat: true })
    for (const y of [1.9, 4.5]) band(fixed, R - 0.02, R + 0.015, 0.06, 'mid', tx, y, tz)
    const fz = tz + R
    box(fixed, 1.0, 0.85, 0.5, 'dark', tx, 0.95, fz + 0.12, 0.05)
    const lamp = pilot('green', tx - 0.28, 1.15, fz + 0.38, 0.06)
    chip(fixed, 0.3, 0.2, 0.03, 'mid', tx + 0.18, 1.14, fz + 0.375)
    chip(fixed, 0.5, 0.1, 0.03, 'black', tx, 0.72, fz + 0.375)
    // Gas comes in yellow pipe.
    tube(fixed, [[tx + 0.5, 0.9, fz + 0.15], [tx + 1.45, 0.9, fz + 0.15], [tx + 1.45, 0.9, -1.85]], 0.05, 'yellow', { bend: 0.2 })
    valve(fixed, tx + 1.0, 0.9, fz + 0.15, 'x', 0.05)
    const hand = gauge(tx, 3.15, fz + 0.08, 0.17, '+z')
    box(fixed, 1.5, 0.5, 0.3, 'dark', tx, 4.15, fz - 0.135, 0.02)
    plate(fixed, f.label, plateWidth(f.label, 1.1, 1.4), 0.4, tx, 4.15, fz + 0.035)
    // The draft hood and the flue, over the back toward the wall.
    cyl(fixed, 0.42, 0.3, steel, tx, 5.6, tz, 'y', { r2: 0.28 })
    tube(fixed, [[tx, 5.7, tz], [tx, 6.75, tz], [tx, 6.75, -1.85]], 0.26, steel, { bend: 0.5 })
    // Cold in, hot out. The hot line runs across to a riser with the circulator on it.
    tube(fixed, [[tx - 0.55, 5.3, tz], [tx - 0.55, 6.05, tz], [tx - 0.55, 6.05, -1.85]], 0.06, TONE.copper, { bend: 0.2 })
    chip(fixed, 0.15, 0.2, 0.15, 'blue', tx - 0.55, 5.62, tz)
    const hx = tx + 2.6
    tube(fixed, [[tx + 0.55, 5.3, tz], [tx + 0.55, 5.9, tz], [hx, 5.9, tz], [hx, 1.2, tz], [hx, 1.2, -1.85]], 0.06, TONE.copper, { bend: 0.2 })
    chip(fixed, 0.15, 0.2, 0.15, 'red', tx + 0.55, 5.62, tz)
    strut(fixed, [hx + 0.22, 0.04, tz - 0.16], [hx + 0.22, 4.6, tz - 0.16], 0.12, 'frame')
    chip(fixed, 0.4, 0.04, 0.4, 'dark', hx + 0.22, 0.02, tz - 0.16)
    for (const y of [1.6, 4.4]) chip(fixed, 0.3, 0.06, 0.2, 'frame', hx + 0.1, y, tz - 0.08)
    cyl(fixed, 0.22, 0.3, 'red', hx, 3.0, tz + 0.02, 'z', { bevel: 0.05 })
    cyl(fixed, 0.17, 0.36, 'dark', hx, 3.0, tz + 0.34, 'z')
    chip(fixed, 0.2, 0.16, 0.14, 'dark', hx, 3.24, tz + 0.34)
    valve(fixed, hx, 4.1, tz, 'y', 0.06)
    valve(fixed, hx, 2.0, tz, 'y', 0.06)
    // The expansion tank hangs from the hot line; the relief valve drains down the side.
    tank(fixed, 0.42, 1.1, TONE.slate, tx + 1.75, 5.15, tz, 'y', { head: 0.2 })
    peg(fixed, 0.04, 0.2, 'brass', tx + 1.75, 5.78, tz, 'y', 6)
    peg(fixed, 0.06, 0.2, 'brass', tx + R + 0.06, 4.7, tz, 'x', 6)
    tube(fixed, [[tx + R + 0.16, 4.7, tz], [tx + R + 0.16, 0.3, tz]], 0.035, TONE.copper)

    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      setNeedle(hand, on * (0.66 + 0.012 * Math.sin(s.t * 0.7)))
    })
    r.kit.pickCylinder(f.body, R + 0.1, 5.8, tx, 2.9, tz)
    r.kit.pickBox(f.body, 0.9, 6, 0.9, hx + 0.1, 3, tz)
    ground(r, f, 1.9, 1.9, tx, tz, true)
    return { height: 7.0, beacon: [hx + 0.22, 4.6, tz - 0.16] }
  },
}
