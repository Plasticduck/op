import { Group } from 'three'
import type { V3 } from '../kit'
import { beltLoop, ground, plateWidth, power, setNeedle, smooth, TONE, TURN } from './backroomParts'
import type { Design, Rig, Skin } from './backroomParts'

// The air compressors of the equipment room: the shop compressors on their horizontal
// receivers, and the customer air unit. backroom.ts picks and fits them.

// A compressor pumps until its tank is full, rests while the air is used, then starts
// again. Both follow from scene time alone: 1 while pumping, eased at each end.
const CYCLE = 36
const PUMPING = 24
function pumping(t: number, offset: number): number {
  const c = (((t + offset) % CYCLE) + CYCLE) % CYCLE
  return smooth(c / 1.2) * (1 - smooth((c - PUMPING) / 1.5))
}
// Tank pressure over the same cycle, as a share of the gauge.
function pressure(t: number, offset: number): number {
  const c = (((t + offset) % CYCLE) + CYCLE) % CYCLE
  return c < PUMPING ? 0.56 + 0.26 * (c / PUMPING) : 0.82 - 0.26 * ((c - PUMPING) / (CYCLE - PUMPING))
}

// The pump and motor on a compressor's deck: a finned pump (V-twin or single), its
// flywheel, the motor beside it, the belt between them and a wire guard around the belt.
// The belt runs out past the deck's front edge, where the flywheel has room to turn.
// Returns how high the pump stands.
function pumpSet(r: Rig, x0: number, deckY: number, z0: number, sx: number, size: number, twin: boolean, skin: Skin, offset: number): number {
  const { fixed, moving, box, chip, cyl, peg, tube, rod, rotor, motor } = r
  const px = x0 + sx * 0.85 * size
  const mx = x0 - sx * 0.95 * size
  const crankY = deckY + 0.34 * size
  box(fixed, 0.78 * size, 0.64 * size, 0.7 * size, skin, px, crankY - 0.02 * size, z0, 0.06)
  for (const lean of twin ? [-0.52, 0.52] : [0]) {
    const jug = new Group()
    jug.position.set(px, crankY + 0.2 * size, z0)
    jug.rotation.z = -lean
    fixed.add(jug)
    cyl(jug, 0.19 * size, 0.56 * size, skin, 0, 0.36 * size, 0)
    if (!r.low) for (let k = 0; k < 4; k++) chip(jug, 0.54 * size, 0.024, 0.5 * size, skin, 0, (0.18 + k * 0.11) * size, 0)
    box(jug, 0.46 * size, 0.14 * size, 0.44 * size, skin, 0, 0.7 * size, 0, 0.03)
    peg(jug, 0.11 * size, 0.2 * size, 'black', 0, 0.86 * size, -0.1 * size)
  }
  const wheelR = (twin ? 0.62 : 0.5) * size
  const pulleyR = 0.16 * size
  const wz = z0 + 0.74 * size
  const motorR = 0.33 * size
  const motorY = deckY + motorR * 1.25
  peg(fixed, 0.055 * size, 0.42 * size, 'mid', px, crankY, z0 + 0.53 * size, 'z')
  motor(fixed, mx, motorY, z0 - 0.05 * size, motorR, 0.9 * size, '+z')
  const wheel = rotor(moving, px, crankY, wz, wheelR, 'z', { rim: true, blades: 5, thick: 0.11 * size })
  const pulley = rotor(moving, mx, motorY, wz, pulleyR, 'z', { rim: true, blades: 3, thick: 0.11 * size })
  tube(fixed, beltLoop(px, crankY, wheelR - 0.01, mx, motorY, pulleyR - 0.005, wz, r.low ? 5 : 8), 0.028 * size, 'black', { radial: 4, caps: false })

  // The guard: two wire hoops around the belt's path, tied together, with a few bars
  // across the front. Open, so the flywheel shows through it.
  const gap = 0.1 * size
  const g0 = wz - 0.16 * size
  const g1 = wz + 0.16 * size
  for (const gz of [g0, g1]) tube(fixed, beltLoop(px, crankY, wheelR + gap, mx, motorY, pulleyR + gap, gz, r.low ? 4 : 6), 0.02, 'yellow', { radial: 4, caps: false })
  const ties = beltLoop(px, crankY, wheelR + gap, mx, motorY, pulleyR + gap, g0, 2)
  for (let k = 0; k < 6; k++) rod(fixed, ties[k], [ties[k][0], ties[k][1], g1], 0.016, 'yellow')
  for (const t of r.low ? [0.5] : [0.2, 0.5, 0.8]) {
    const x = px + (mx - px) * t
    const reach = wheelR + gap + (pulleyR - wheelR) * t
    const y = crankY + (motorY - crankY) * t
    rod(fixed, [x, y - reach, g1], [x, y + reach, g1], 0.016, 'yellow')
  }
  chip(fixed, 0.5 * size, 0.05, 0.16 * size, 'yellow', (px + mx) / 2, deckY - 0.03, z0 + 0.6 * size)

  let turn = offset
  r.ticks.push((s) => {
    turn += s.dt * power(s) * pumping(s.t, offset) * 9
    wheel.rotation.y = turn % TURN
    pulley.rotation.y = (turn * (wheelR / pulleyR)) % TURN
  })
  return deckY + (twin ? 1.42 : 1.6) * size
}

// A shop compressor on a horizontal receiver: the tank on two saddles, the pump set on a
// deck welded to its top, the pressure switch and its pilot light beside the motor.
export const compressor = (tankSkin: Skin, pumpSkin: Skin, offset: number): Design => ({
  need: [6.2, 3.6],
  build(r, f) {
    const { fixed, box, chip, peg, tube, tank, band, gauge, plate, pilot, valve } = r
    const sx = f.mirror
    const R = 0.95
    const cy = 0.55 + R
    tank(fixed, R, 5.3, tankSkin, 0, cy, 0, 'x', { head: 0.42 })
    for (const x of [-1.95, 1.95]) band(fixed, R - 0.02, R + 0.014, 0.05, tankSkin, x, cy, 0, 'x')
    for (const x of [-1.55, 1.55]) {
      box(fixed, 0.2, 0.78, 1.5, tankSkin, x, 0.44, 0, 0.03)
      chip(fixed, 0.46, 0.05, 1.8, 'dark', x, 0.025, 0)
    }
    const deckY = cy + R + 0.11
    box(fixed, 3.7, 0.08, 1.2, tankSkin, 0, deckY - 0.04, 0, 0.02)
    for (const x of [-1.3, 1.3]) chip(fixed, 0.1, 0.16, 1.0, tankSkin, x, deckY - 0.13, 0)
    const top = pumpSet(r, 0, deckY, 0, sx, 1, true, pumpSkin, offset)

    // The discharge line: copper, from the pump head over the back and into the tank.
    const px = sx * 0.85
    tube(fixed, [[px, deckY + 0.95, -0.36], [px, deckY + 0.95, -0.92], [px, cy + 0.42, -0.92], [px, cy + 0.42, -0.8]], 0.035, TONE.copper, { bend: 0.14 })
    peg(fixed, 0.06, 0.16, 'brass', px, cy + 0.42, -0.86, 'z', 6)
    // The pressure switch on the deck's end, the pilot light on its face, and the tank
    // gauge beyond it.
    const bx = -sx * 1.62
    chip(fixed, 0.36, 0.52, 0.32, 'dark', bx, deckY + 0.26, 0.3)
    const lamp = pilot('green', bx, deckY + 0.36, 0.46, 0.06)
    chip(fixed, 0.12, 0.05, 0.03, 'red', bx, deckY + 0.14, 0.47)
    const hand = gauge(-sx * 2.15, cy + 1.2, 0.3, 0.17, '+z')
    // The relief valve, the drain, and the outlet with its air line going off to the tunnel.
    peg(fixed, 0.05, 0.22, 'brass', sx * 1.98, cy + 0.9, -0.28, 'y', 6)
    peg(fixed, 0.045, 0.14, 'brass', 0, cy - R - 0.05, 0, 'y', 6)
    const ox = sx * 2.25
    peg(fixed, 0.05, 0.36, 'mid', ox, cy + 0.98, -0.1)
    valve(fixed, ox, cy + 1.0, -0.1, 'y', 0.045)
    tube(fixed, [[ox, cy + 1.14, -0.1], [ox, cy + 1.5, -0.1], [ox, cy + 1.5, -1.25], [ox, 0.07, -1.25], [ox, 0.07, -1.7]], 0.045, 'hoseRed', { bend: 0.22 })
    plate(fixed, f.label, plateWidth(f.label, 1.7, 2.8), 0.46, 0, cy - 0.04, R + 0.014)

    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      setNeedle(hand, on * pressure(s.t, offset))
    })
    r.kit.pickBox(f.body, 5.5, 2.5, 2.0, 0, 1.25, 0)
    r.kit.pickBox(f.body, 3.9, top - 2.4, 2.0, 0, (top + 2.4) / 2, 0.15)
    ground(r, f, 4.4, 1.7)
    return { height: top, beacon: [bx, deckY + 0.53, 0.3] }
  },
})

// The customer air unit: a smaller compressor on an upright receiver, with the
// refrigerated dryer beside it and the service post the yellow coil hose hangs from.
export const customerAir: Design = {
  need: [5.6, 3.6],
  build(r, f) {
    const { fixed, box, chip, cyl, peg, tube, strut, tank, band, gauge, plate, pilot, valve } = r
    const sx = f.mirror
    const tx = -sx * 1.6
    const R = 0.9
    tank(fixed, R, 4.5, 'mid', tx, 2.55, 0, 'y', { head: 0.4 })
    for (const y of [0.85, 4.25]) band(fixed, R - 0.02, R + 0.014, 0.05, 'mid', tx, y, 0)
    cyl(fixed, 0.72, 0.34, 'dark', tx, 0.17, 0)
    peg(fixed, 0.26, 0.14, 'mid', tx, 4.8, 0, 'y', 12)
    const deckY = 4.9
    box(fixed, 1.9, 0.07, 1.0, 'mid', tx, deckY - 0.035, 0, 0.02)
    const top = pumpSet(r, tx, deckY, 0, sx, 0.72, false, 'dark', 5)
    // The pressure switch on the tank's front, the gauge standing on it.
    chip(fixed, 0.4, 0.5, 0.16, 'dark', tx, 3.7, R + 0.06)
    const lamp = pilot('green', tx - 0.09, 3.8, R + 0.14, 0.055)
    const hand = gauge(tx + 0.06, 4.17, R + 0.07, 0.16, '+z')

    // The dryer: a cabinet with a control strip across the top and louvers below.
    const dx = sx * 1.15
    const front = 0.05 + 0.65
    box(fixed, 1.6, 2.1, 1.3, 'body', dx, 1.17, 0.05, 0.05)
    for (const ex of [-0.65, 0.65]) for (const ez of [-0.5, 0.6]) chip(fixed, 0.14, 0.12, 0.14, 'dark', dx + ex, 0.06, ez)
    chip(fixed, 1.4, 0.34, 0.03, 'dark', dx, 1.97, front + 0.012)
    pilot('green', dx - 0.5, 1.97, front + 0.03, 0.05, '+z', lamp)
    gauge(dx + 0.42, 1.97, front + 0.06, 0.11, '+z', false, 0.4)
    for (let k = 0; k < (r.low ? 3 : 5); k++) chip(fixed, 1.1, 0.04, 0.02, 'dark', dx, 0.45 + k * 0.13, front + 0.01)
    plate(fixed, f.label, plateWidth(f.label, 1.1, 1.45), 0.36, dx, 1.45, front + 0.022)

    // Air goes from the tank through the dryer to the service post.
    tube(fixed, [[tx + sx * 0.86, 3.3, 0], [dx - sx * 0.4, 3.3, 0], [dx - sx * 0.4, 2.2, 0]], 0.045, TONE.copper, { bend: 0.2 })
    valve(fixed, (tx + dx) / 2 + sx * 0.2, 3.3, 0, 'x', 0.045)
    const ox = dx + sx * 1.25
    strut(fixed, [ox, 0.04, 0.2], [ox, 4.3, 0.2], 0.14, 'frame')
    chip(fixed, 0.44, 0.04, 0.44, 'dark', ox, 0.02, 0.2)
    tube(fixed, [[dx + sx * 0.4, 2.2, 0.2], [dx + sx * 0.4, 2.95, 0.2], [ox, 2.95, 0.2]], 0.045, TONE.copper, { bend: 0.2 })
    // Filter and regulator on the post, a gauge above them, the coil hose on its hook.
    peg(fixed, 0.1, 0.36, 'dark', ox, 3.3, 0.37)
    peg(fixed, 0.08, 0.2, 'mid', ox, 3.02, 0.37)
    gauge(ox, 3.78, 0.3, 0.12, '+z', false, 0.55)
    chip(fixed, 0.05, 0.05, 0.3, 'dark', ox, 2.62, 0.4)
    const coil: V3[] = [[ox, 3.1, 0.5], [ox, 2.75, 0.52]]
    const turns = r.low ? 5 : 7
    const per = r.low ? 6 : 8
    for (let k = 0; k <= turns * per; k++) {
      const a = (k / per) * TURN
      coil.push([ox + Math.sin(a) * 0.15, 2.6 - (k / (turns * per)) * 1.25, 0.52 + (1 - Math.cos(a)) * 0.15])
    }
    coil.push([ox, 1.2, 0.56])
    tube(fixed, coil, 0.026, 'yellow', { radial: 4 })
    peg(fixed, 0.04, 0.2, 'brass', ox, 1.12, 0.56, 'y', 6)

    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      setNeedle(hand, on * pressure(s.t, 5))
    })
    r.kit.pickCylinder(f.body, 1.0, top, tx, top / 2, 0)
    r.kit.pickBox(f.body, 1.7, 2.3, 1.4, dx, 1.15, 0.05)
    r.kit.pickBox(f.body, 0.6, 4.3, 0.8, ox, 2.15, 0.35)
    ground(r, f, 1.5, 1.5, tx, 0, true)
    ground(r, f, 1.6, 1.3, dx, 0.05)
    return { height: top, beacon: [ox, 4.3, 0.2] }
  },
}
