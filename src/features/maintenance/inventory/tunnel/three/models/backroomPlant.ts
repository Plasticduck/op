import type { Group } from 'three'
import type { Lamp } from '../kit'
import { clamp, ground, plateWidth, power, setNeedle, spin, stainless, TONE } from './backroomParts'
import type { Design } from './backroomParts'

// The rest of the equipment room: the chemical wall, hydraulics, pumps, reclaim, the
// electrical cabinet, and the plain machine skid for anything else. backroom.ts picks and
// fits them.

// ---- Chemical: the Hydra Flex wall -----------------------------------------------------

const HUES = ['red', TONE.orange, 'yellow', 'green', TONE.teal, 'blue', TONE.purple, TONE.pink] as const

// The chemical dispensing wall: a stainless backboard on two posts carrying the valve
// panel, a manifold of color-coded injectors, each drawing its chemical up a line of its
// own color from the blue drums standing on a spill deck below, and the booster pump at
// the end. The wall is as wide as the shape: a wider one holds more drums and injectors.
export const hydraFlex: Design = {
  need: [4.4, 3.7],
  build(r, f) {
    const { fixed, box, chip, strut, beam, cyl, peg, tube, drum, gauge, plate, pilot, motorUp } = r
    const steel = TONE.steel
    const W = clamp(f.W - 0.8, 4, 12)
    const zb = -1.05
    const face = zb + 0.14
    const posts = W > 8.5 ? [-W / 2 + 0.08, 0, W / 2 - 0.08] : [-W / 2 + 0.08, W / 2 - 0.08]
    for (const x of posts) {
      strut(fixed, [x, 0.05, zb], [x, 6.75, zb], 0.16, steel)
      chip(fixed, 0.5, 0.05, 0.9, 'dark', x, 0.025, zb - 0.15)
      beam(fixed, [x, 2.7, zb - 0.06], [x, 0.06, zb - 0.55], 0.1, steel)
    }
    box(fixed, W, 3.35, 0.06, steel, 0, 4.98, zb + 0.11, 0.02)

    // The valve panel, with the bank of solenoids it switches under it.
    const vx = -W / 2 + 1.0
    box(fixed, 1.5, 2.0, 0.34, 'dark', vx, 5.45, face + 0.17, 0.04)
    chip(fixed, 1.2, 0.16, 0.02, 'mid', vx, 6.2, face + 0.35)
    chip(fixed, 0.5, 0.36, 0.03, 'black', vx - 0.3, 5.42, face + 0.35)
    for (let k = 0; k < 6; k++) chip(fixed, 0.07, 0.07, 0.02, k < 4 ? 'green' : 'yellow', vx - 0.5 + k * 0.2, 5.9, face + 0.35)
    const lamp = pilot('green', vx + 0.45, 5.42, face + 0.34, 0.07)
    peg(fixed, 0.05, 1.4, steel, vx, 3.98, face + 0.2, 'x')
    for (let k = 0; k < 6; k++) {
      peg(fixed, 0.065, 0.24, 'black', vx - 0.55 + k * 0.22, 4.15, face + 0.2)
      chip(fixed, 0.1, 0.07, 0.1, 'blue', vx - 0.55 + k * 0.22, 4.3, face + 0.2)
    }

    // The booster pump stands at the far end and feeds the manifold from below.
    const px = W / 2 - 0.45
    const pz = zb + 1.25
    const my = 4.62
    const mz = face + 0.22
    chip(fixed, 0.6, 0.1, 0.6, 'dark', px, 0.05, pz)
    cyl(fixed, 0.2, 2.1, steel, px, 1.15, pz)
    cyl(fixed, 0.25, 0.2, 'dark', px, 2.3, pz)
    motorUp(fixed, px, 2.4, pz, 0.26, 0.9)
    tube(fixed, [[px, 1.9, pz - 0.18], [px, 1.9, mz], [px, my, mz]], 0.05, steel, { bend: 0.15 })
    const hand = gauge(px, my + 0.36, mz, 0.16, '+z')

    // Drums on their spill deck, each with a label in its chemical's color.
    const count = Math.max(1, Math.floor((W - 0.95 + 0.01) / 2.05))
    const deckW = count * 2.05 + 0.2
    const deckX = -W / 2 + 0.05 + deckW / 2
    const dz = zb + 1.42
    box(fixed, deckW, 0.42, 2.3, 'yellow', deckX, 0.21, dz, 0.05)
    chip(fixed, deckW - 0.16, 0.04, 2.14, 'black', deckX, 0.43, dz)
    const drumX = (j: number) => -W / 2 + 1.175 + j * 2.05
    for (let j = 0; j < count; j++) {
      drum(fixed, drumX(j), 0.45, dz)
      chip(fixed, 0.62, 0.52, 0.02, 'white', drumX(j), 1.95, dz + 0.97)
      chip(fixed, 0.62, 0.16, 0.025, HUES[(j * 3) % HUES.length], drumX(j), 2.13, dz + 0.97)
    }

    // The manifold and its injectors. Each sends its mix up into the tubing tray and
    // draws its chemical up from a drum.
    const m0 = -W / 2 + 2.05
    peg(fixed, 0.075, px - m0, steel, (m0 + px) / 2, my, mz, 'x', 10)
    box(fixed, px - m0 - 0.1, 0.2, 0.2, 'body', (m0 + px) / 2 - 0.1, 5.5, face + 0.12, 0.03)
    const n = Math.max(2, Math.floor((px - m0 - 0.5) / (r.low ? 0.62 : 0.4)))
    for (let i = 0; i < n; i++) {
      const x = m0 + 0.25 + (i * (px - m0 - 0.75)) / (n - 1)
      const hue = HUES[i % HUES.length]
      chip(fixed, 0.15, 0.32, 0.15, hue, x, my - 0.24, mz)
      peg(fixed, 0.035, 0.12, 'white', x, my - 0.46, mz, 'y', 6)
      peg(fixed, 0.022, 0.75, hue, x, my + 0.44, mz - 0.1, 'y', 4)
      const j = Math.min(count - 1, Math.floor((i / n) * count))
      const bung = drumX(j) + ((i % 4) - 1.5) * 0.18
      tube(fixed, [[x, my - 0.5, mz], [x, 3.95, mz + 0.25], [bung, 3.62, dz - 0.25], [bung, 3.3, dz - 0.25]], 0.022, hue, { bend: 0.2, radial: 4 })
    }
    // The mixed lines leave the tray in a bundle, up over the board and off to the arches.
    for (let k = 0; k < (r.low ? 4 : 6); k++) {
      const x = m0 + 0.3 + k * 0.075
      tube(fixed, [[x, 5.6, face + 0.12], [x, 6.95, face + 0.12], [x, 6.95, zb - 0.6]], 0.024, HUES[(k * 3 + 1) % HUES.length], { bend: 0.25, radial: 4 })
    }
    const pw = Math.min(plateWidth(f.label, 1.6, 2.6), W - 2.3)
    plate(fixed, f.label, pw, 0.5, W / 2 - 0.3 - pw / 2, 6.22, face + 0.02)

    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      setNeedle(hand, on * (0.5 + 0.015 * Math.sin(s.t * 2.7)))
    })
    r.kit.pickBox(f.body, W, 3.7, 0.7, 0, 5.05, zb + 0.2)
    r.kit.pickBox(f.body, deckW, 3.4, 2.3, deckX, 1.7, dz)
    r.kit.pickCylinder(f.body, 0.4, 3.5, px, 1.75, pz)
    ground(r, f, deckW, 2.3, deckX, dz)
    return { height: 7.0, beacon: [-W / 2 + 0.08, 6.75, zb] }
  },
}

// ---- Power: hydraulics, pumps, reclaim, the electrical cabinet --------------------------

// A hydraulic power pack: the oil reservoir on legs, the motor standing on its lid over
// the pump inside, a valve block with its hoses, and the fan-cooled oil cooler on the end.
export const powerPack: Design = {
  need: [5.2, 3.8],
  build(r, f) {
    const { fixed, moving, box, chip, cyl, peg, tube, rod, band, rotor, gauge, cabinet, plate, pilot, motorUp } = r
    const top = 2.2
    box(fixed, 3.4, 1.7, 2.0, TONE.slate, 0.2, 1.35, 0, 0.06)
    box(fixed, 3.52, 0.07, 2.12, 'dark', 0.2, top + 0.035, 0, 0.02)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) chip(fixed, 0.2, 0.5, 0.2, 'dark', 0.2 + sx * 1.5, 0.25, sz * 0.8)
    chip(fixed, 0.14, 0.9, 0.03, 'white', -1.15, 1.4, 1.015)
    chip(fixed, 0.08, 0.5, 0.035, 'brass', -1.15, 1.2, 1.016)
    cyl(fixed, 0.42, 0.34, 'dark', -0.5, top + 0.24, 0)
    const motorTop = motorUp(fixed, -0.5, top + 0.41, 0, 0.42, 1.25)
    cyl(fixed, 0.13, 0.22, 'yellow', -1.2, top + 0.18, -0.65, 'y', { bevel: 0.05 })
    cyl(fixed, 0.17, 0.5, 'white', 0.5, top + 0.32, -0.6)
    chip(fixed, 0.36, 0.14, 0.36, 'dark', 0.5, top + 0.62, -0.6)
    // The valve block: three solenoid valves across its top, a gauge on a riser, and
    // the hoses leaving its back for the conveyor.
    box(fixed, 0.9, 0.42, 0.6, 'body', 1.2, top + 0.28, 0.25, 0.03)
    for (let k = 0; k < 3; k++) {
      const x = 0.92 + k * 0.28
      chip(fixed, 0.2, 0.2, 0.5, 'dark', x, top + 0.59, 0.25)
      peg(fixed, 0.08, 0.22, 'black', x, top + 0.59, 0.61, 'z')
      chip(fixed, 0.07, 0.07, 0.03, 'red', x, top + 0.59, 0.73)
      tube(fixed, [[x + 0.03, top + 0.3, -0.05], [x + 0.03, top + 0.3, -1.3 - k * 0.08], [x + 0.03, 0.08, -1.3 - k * 0.08], [x + 0.03, 0.08, -1.8]], 0.05, 'hoseBlack', { bend: 0.25 })
    }
    peg(fixed, 0.04, 0.4, 'brass', 1.8, top + 0.4, 0.25, 'y', 6)
    const hand = gauge(1.8, top + 0.88, 0.25, 0.17, '+z')
    // The oil cooler faces the entrance, its fan in an open shroud.
    box(fixed, 0.28, 1.1, 1.1, 'dark', -1.86, 1.35, 0, 0.03)
    for (const sz of [-0.4, 0.4]) chip(fixed, 0.3, 0.08, 0.08, 'dark', -1.6, 1.6, sz)
    band(fixed, 0.45, 0.51, 0.16, 'dark', -2.07, 1.35, 0, 'x')
    const fan = rotor(moving, -2.08, 1.35, 0, 0.43, 'x', { blades: 6, skin: 'mid', thick: 0.08 })
    rod(fixed, [-2.16, 0.85, 0], [-2.16, 1.85, 0], 0.014, 'dark')
    rod(fixed, [-2.16, 1.35, -0.5], [-2.16, 1.35, 0.5], 0.014, 'dark')
    // The starter on the tank's front.
    cabinet(fixed, 0.9, 0.9, 0.26, 'body', 1.3, 1.3, 1.13)
    const lamp = pilot('green', 1.1, 1.52, 1.29, 0.06)
    chip(fixed, 0.1, 0.1, 0.04, 'red', 1.1, 1.22, 1.3)
    plate(fixed, f.label, plateWidth(f.label, 1.3, 1.7), 0.42, -0.14, 1.75, 1.016)

    spin(r, fan, 16)
    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      setNeedle(hand, on * (0.7 + 0.015 * Math.sin(s.t * 13)))
    })
    r.kit.pickBox(f.body, 4.1, 2.9, 2.3, 0, 1.45, 0)
    r.kit.pickCylinder(f.body, 0.55, motorTop - 2.2, -0.5, (motorTop + 2.2) / 2, 0)
    ground(r, f, 3.3, 1.9, 0.2, 0)
    return { height: motorTop, beacon: [1.8, top + 0.07, -0.9] }
  },
}

// A pump station: one pump or more side by side on a skid, each motor at the front with
// its fan toward you, the pumps behind lifting water from a low header into a high one,
// and the control panel on a stand at the end. A wider shape gets more pumps.
export const pumpStation: Design = {
  need: [4.6, 4.5],
  build(r, f) {
    const { fixed, moving, chip, strut, cyl, peg, tube, tank, gauge, motor, cabinet, valve, plate, pilot } = r
    const steel = stainless(r)
    const n = f.W >= 10.6 ? 3 : f.W >= 7.3 ? 2 : 1
    const Wk = n * 2.5 + 1.9
    const xL = -Wk / 2
    for (const z of [-1.45, 1.45]) chip(fixed, Wk, 0.26, 0.2, 'frame', 0, 0.13, z)
    for (let k = 0; k <= n + 1; k++) chip(fixed, 0.2, 0.22, 2.7, 'frame', xL + 0.1 + (k * (Wk - 0.2)) / (n + 1), 0.13, 0)
    const my = 0.32 + 0.42 * 1.25
    const lamps: Lamp[] = []
    const hands: Array<Group | null> = []
    const cxp = Wk / 2 - 0.62
    for (let i = 0; i < n; i++) {
      const cx = xL + 1.35 + i * 2.5
      chip(fixed, 1.5, 0.06, 2.7, 'frame', cx, 0.29, -0.05)
      spin(r, motor(fixed, cx, my, 0.45, 0.42, 1.2, '-z', { fan: moving })!, 15, i * 1.3)
      chip(fixed, 0.36, 0.34, 0.36, TONE.orange, cx, my, -0.42)
      chip(fixed, 0.5, my - 0.62, 0.4, 'frame', cx, 0.32 + (my - 0.62) / 2, -0.85)
      cyl(fixed, 0.5, 0.36, TONE.drum, cx, my, -0.85, 'z', { bevel: 0.08 })
      cyl(fixed, 0.22, 0.3, TONE.drum, cx, my, -0.6, 'z')
      peg(fixed, 0.16, 0.4, steel, cx, my, -1.2, 'z', 12)
      // Up from the pump through a check valve and a shut-off to the discharge header.
      peg(fixed, 0.12, 2.75 - my - 0.4, steel, cx, (2.75 + my + 0.4) / 2, -0.85, 'y', 10)
      cyl(fixed, 0.18, 0.3, steel, cx, 1.7, -0.85)
      valve(fixed, cx, 2.2, -0.85, 'y', 0.09)
      peg(fixed, 0.03, 0.34, 'brass', cx + 0.26, 2.42, -0.85, 'x', 6)
      hands.push(gauge(cx + 0.44, 2.66, -0.85, 0.15, '+z'))
      lamps.push(pilot('green', cxp - 0.3 + i * 0.3, 4.0, 1.25 + 0.24, 0.06, '+z', lamps[0]))
    }
    peg(fixed, 0.17, Wk - 0.7, steel, 0, my, -1.42, 'x', 12)
    peg(fixed, 0.15, Wk - 1.9, steel, -0.25, 2.75, -0.85, 'x', 12)
    tube(fixed, [[Wk / 2 - 1.3, 2.75, -0.85], [Wk / 2 - 0.5, 2.75, -0.85], [Wk / 2 - 0.5, 2.75, -1.95]], 0.15, steel, { bend: 0.3 })
    // A bladder tank to steady the pressure.
    tank(fixed, 0.45, 1.7, TONE.drum, Wk / 2 - 0.6, 1.3, 0.15, 'y', { head: 0.25 })
    peg(fixed, 0.36, 0.2, 'dark', Wk / 2 - 0.6, 0.36, 0.15, 'y', 12)
    peg(fixed, 0.04, 1.0, 'brass', Wk / 2 - 0.6, 2.25, -0.35, 'z', 6)
    // The panel on its stand: a run light for each pump, the disconnect, the name.
    for (const s of [-1, 1]) strut(fixed, [cxp + s * 0.42, 0.26, 1.25], [cxp + s * 0.42, 2.72, 1.25], 0.1, 'frame')
    cabinet(fixed, 1.1, 1.6, 0.4, 'body', cxp, 3.5, 1.25)
    chip(fixed, 0.22, 0.32, 0.03, 'yellow', cxp - 0.25, 3.35, 1.47)
    chip(fixed, 0.08, 0.26, 0.06, 'red', cxp - 0.25, 3.35, 1.5)
    const pw = Math.min(plateWidth(f.label, 1.6, 2.6), Wk - 2.2)
    for (const s of [-1, 1]) chip(fixed, 0.05, 0.32, 0.05, 'frame', -0.25 + s * (pw / 2 - 0.2), 3.02, -0.72)
    plate(fixed, f.label, pw, 0.44, -0.25, 3.38, -0.68)

    r.ticks.push((s) => {
      const on = power(s)
      for (let i = 0; i < n; i++) {
        lamps[i].set(on > 0.5)
        setNeedle(hands[i], on * (0.62 + 0.02 * Math.sin(s.t * 9 + i * 2)))
      }
    })
    r.kit.pickBox(f.body, Wk, 3.2, 3.1, 0, 1.6, 0)
    r.kit.pickBox(f.body, 1.2, 4.3, 0.8, cxp, 2.15, 1.3)
    ground(r, f, Wk, 3.0)
    return { height: 4.3, beacon: [cxp, 4.3, 1.25] }
  },
}

// A water reclaim system: the stainless settling tank on legs, a pair of cyclone
// separators on a stand dropping their grit into a drum, the pump that drives them, and
// the control box on its post.
export const reclaim: Design = {
  need: [7.4, 4.3],
  build(r, f) {
    const { fixed, moving, chip, strut, cyl, peg, tube, tank, band, drum, gauge, motor, cabinet, valve, plate, pilot } = r
    const steel = stainless(r)
    for (const z of [-1.55, 1.55]) chip(fixed, 7.0, 0.2, 0.2, 'frame', 0, 0.1, z)
    for (const x of [-3.4, -1.0, 1.3, 3.4]) chip(fixed, 0.2, 0.18, 2.9, 'frame', x, 0.1, 0)
    // The tank: dished top, cone bottom, a drain at its tip.
    const tx = -2.2
    const tz = -0.3
    const TR = 1.05
    tank(fixed, TR, 3.6, steel, tx, 3.6, tz, 'y', { head: 0.4 })
    cyl(fixed, 0.16, 1.0, steel, tx, 1.6, tz, 'y', { r2: TR * 0.98 })
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut(fixed, [tx + sx * 0.78, 0.2, tz + sz * 0.78], [tx + sx * 0.78, 2.5, tz + sz * 0.78], 0.12, 'frame')
    band(fixed, TR, TR + 0.06, 0.12, 'frame', tx, 2.44, tz)
    cyl(fixed, 0.4, 0.12, steel, tx, 5.42, tz)
    peg(fixed, 0.08, 0.9, steel, tx, 0.65, tz)
    valve(fixed, tx, 0.8, tz, 'y', 0.07)
    // The cyclones: a cylinder over a long cone, fed from the side, clean water leaving
    // the top, grit falling from the tip.
    const cz = -0.7
    const sx0 = 0.275
    for (const ex of [-0.9, 0.9]) for (const ez of [-0.45, 0.45]) strut(fixed, [sx0 + ex, 0.2, cz + ez], [sx0 + ex, 3.9, cz + ez], 0.1, 'frame')
    for (const ez of [-0.45, 0.45]) strut(fixed, [sx0 - 0.9, 3.85, cz + ez], [sx0 + 0.9, 3.85, cz + ez], 0.1, 'frame')
    for (const x of [-0.2, 0.75]) {
      cyl(fixed, 0.3, 0.9, steel, x, 4.25, cz)
      cyl(fixed, 0.07, 1.6, steel, x, 3.0, cz, 'y', { r2: 0.3 })
      peg(fixed, 0.09, 0.45, steel, x, 4.9, cz, 'y', 10)
      peg(fixed, 0.09, 0.5, steel, x, 4.45, cz + 0.4, 'z', 10)
    }
    chip(fixed, 1.5, 0.3, 0.5, 'dark', sx0, 2.05, cz)
    peg(fixed, 0.07, 0.2, 'dark', sx0, 1.84, cz)
    drum(fixed, sx0, 0.2, cz, 'dark', 0.58)
    peg(fixed, 0.1, 2.05, 'mid', -0.22, 5.12, cz, 'x', 10)
    // The pump, its fan toward the entrance, and the lines to and from it.
    const my = 0.3 + 0.38 * 1.25
    chip(fixed, 1.9, 0.1, 0.9, 'frame', 2.55, 0.25, 0.7)
    spin(r, motor(fixed, 2.35, my, 0.7, 0.38, 1.1, '+x', { fan: moving })!, 15)
    cyl(fixed, 0.45, 0.32, TONE.drum, 3.15, my, 0.7, 'x', { bevel: 0.08 })
    tube(fixed, [[3.15, my + 0.3, 0.7], [3.15, 4.45, 0.7], [3.15, 4.45, cz + 0.62], [-0.45, 4.45, cz + 0.62]], 0.1, 'mid', { bend: 0.3 })
    tube(fixed, [[tx + 0.5, 1.9, tz + 0.85], [tx + 0.5, 1.9, 1.25], [tx + 0.5, 0.55, 1.25], [3.15, 0.55, 1.25], [3.15, 0.55, 0.95]], 0.1, 'mid', { bend: 0.25 })
    const hand = gauge(1.6, 4.82, cz + 0.62, 0.16, '+z')
    // The control box on its post.
    strut(fixed, [-0.9, 0.2, 1.3], [-0.9, 2.7, 1.3], 0.12, 'frame')
    cabinet(fixed, 1.2, 1.5, 0.4, 'body', -0.9, 3.4, 1.3)
    chip(fixed, 0.6, 0.4, 0.03, 'black', -1.0, 3.7, 1.53)
    const lamp = pilot('green', -0.55, 3.75, 1.52, 0.06)
    chip(fixed, 0.1, 0.1, 0.04, 'red', -0.55, 3.5, 1.53)
    plate(fixed, f.label, plateWidth(f.label, 1.0, 1.1), 0.34, -0.9, 3.0, 1.54)

    r.ticks.push((s) => {
      const on = power(s)
      lamp.set(on > 0.5)
      setNeedle(hand, on * (0.55 + 0.02 * Math.sin(s.t * 7)))
    })
    r.kit.pickCylinder(f.body, TR + 0.1, 5.5, tx, 2.75, tz)
    r.kit.pickBox(f.body, 2.1, 5.2, 1.3, sx0, 2.6, cz)
    r.kit.pickBox(f.body, 2.1, 1.4, 1.1, 2.6, 0.7, 0.7)
    r.kit.pickBox(f.body, 1.3, 4.2, 0.6, -0.9, 2.1, 1.35)
    ground(r, f, 7.0, 3.1)
    return { height: 5.5, beacon: [-0.9, 4.15, 1.3] }
  },
}

// An electrical cabinet (a controller, a motor control center, a drive panel): tall
// enclosures side by side on a plinth, a disconnect and run lights on the first door, a
// screen, conduit leaving the top, and an exhaust fan turning on the roof. A wider shape
// gets more sections.
export const controlCabinet: Design = {
  need: [3.0, 2.8],
  build(r, f) {
    const { fixed, moving, box, chip, peg, tube, rod, band, rotor, plate, pilot } = r
    const steel = stainless(r)
    const n = clamp(Math.round((f.W - 0.5) / 2.5), 1, 5)
    const sw = Math.min(2.6, (f.W - 0.5) / n)
    const total = n * sw
    const zc = -0.25
    const depth = 1.6
    const H = 6.3
    const base = 0.3
    const front = zc + depth / 2
    box(fixed, total - 0.1, base, depth - 0.15, 'dark', 0, base / 2, zc, 0.02)
    for (let i = 0; i < n; i++) {
      const x = -total / 2 + sw * (i + 0.5)
      box(fixed, sw - 0.03, H, depth, 'body', x, base + H / 2, zc, 0.05)
      box(fixed, sw - 0.2, H - 0.25, 0.04, 'body', x, base + H / 2, front + 0.012, 0.02)
      chip(fixed, 0.06, 0.8, 0.07, 'dark', x + sw / 2 - 0.22, base + 3.3, front + 0.07)
      for (let k = 0; k < (r.low ? 2 : 4); k++) chip(fixed, sw - 0.7, 0.045, 0.02, 'dark', x, base + 0.5 + k * 0.13, front + 0.035)
    }
    // The first door: the name across the top, run lights, the disconnect.
    const x0 = -total / 2 + sw / 2
    plate(fixed, f.label, Math.min(plateWidth(f.label, 1.3, 2.6), sw - 0.5), 0.44, x0, base + H - 0.5, front + 0.05)
    const lamp = pilot('green', x0 - 0.5, base + 5.15, front + 0.03, 0.07)
    for (const k of [1, 2]) peg(fixed, 0.07, 0.06, 'dark', x0 - 0.5 + k * 0.26, base + 5.15, front + 0.05, 'z', 10)
    chip(fixed, 0.36, 0.52, 0.03, 'yellow', x0 + sw / 2 - 0.55, base + 4.3, front + 0.045)
    chip(fixed, 0.1, 0.36, 0.08, 'red', x0 + sw / 2 - 0.55, base + 4.3, front + 0.09)
    // The screen, on the second door when there is one.
    const hx = n > 1 ? x0 + sw : x0 - 0.3
    const hy = base + (n > 1 ? 4.6 : 4.3)
    chip(fixed, 1.05, 0.75, 0.03, 'dark', hx, hy, front + 0.045)
    chip(fixed, 0.92, 0.62, 0.035, 'black', hx, hy, front + 0.05)
    // On the roof: a wireway with conduit bending away to the tunnel, and the fan.
    chip(fixed, Math.max(0.8, total - 1.6), 0.22, 0.45, 'mid', -0.5, base + H + 0.11, zc - 0.4)
    for (let k = 0; k < (r.low ? 2 : 3); k++) {
      const x = -total / 2 + 0.5 + k * 0.3
      tube(fixed, [[x, base + H + 0.2, zc - 0.4], [x, base + H + 0.75 + k * 0.1, zc - 0.4], [x, base + H + 0.75 + k * 0.1, zc - 1.05]], 0.06, steel, { bend: 0.25 })
    }
    const fx = total / 2 - 0.65
    const fz = zc + 0.2
    band(fixed, 0.37, 0.43, 0.2, 'dark', fx, base + H + 0.1, fz)
    const fan = rotor(moving, fx, base + H + 0.12, fz, 0.34, 'y', { blades: 5, skin: 'mid', thick: 0.07 })
    rod(fixed, [fx - 0.42, base + H + 0.21, fz], [fx + 0.42, base + H + 0.21, fz], 0.014, 'dark')
    rod(fixed, [fx, base + H + 0.21, fz - 0.42], [fx, base + H + 0.21, fz + 0.42], 0.014, 'dark')

    spin(r, fan, 11)
    r.ticks.push((s) => lamp.set(power(s) > 0.5))
    r.kit.pickBox(f.body, total, base + H, depth + 0.1, 0, (base + H) / 2, zc)
    ground(r, f, total, depth, 0, zc)
    return { height: base + H + 1.0, beacon: [-total / 2 + 0.25, base + H, front - 0.25] }
  },
}

// Anything else: a machine skid. A cabinet with doors and a control panel, a motor and
// whatever it drives on the open end of the skid, conduit between them, a vent fan on
// the roof, and the name across the front.
export const skidUnit: Design = {
  need: [4.4, 3.4],
  build(r, f) {
    const { fixed, moving, box, chip, peg, tube, rod, band, rotor, motor, plate, pilot } = r
    const steel = stainless(r)
    const W = clamp(f.W - 0.7, 3.6, 12)
    const D = clamp(f.D - 0.7, 2.6, 5)
    for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) chip(fixed, W, 0.3, 0.2, 'frame', 0, 0.15, z)
    for (const x of [-W / 2 + 0.1, 0, W / 2 - 0.1]) chip(fixed, 0.2, 0.26, D - 0.4, 'frame', x, 0.15, 0)
    // The cabinet, at the back of the skid's closed end.
    const bw = Math.min(W * 0.58, 5.2)
    const bh = clamp(2.4 + D * 0.45, 3.2, 4.6)
    const bd = Math.min(D - 0.5, 3.2)
    const bx = -W / 2 + bw / 2 + 0.15
    const bz = -D / 2 + 0.25 + bd / 2
    const front = bz + bd / 2
    const roof = 0.3 + bh
    box(fixed, bw, bh, bd, 'body', bx, 0.3 + bh / 2, bz, 0.08)
    const dw = bw / 2 - 0.14
    for (const s of [-1, 1]) {
      box(fixed, dw, bh - 1.0, 0.04, 'body', bx + s * (dw / 2 + 0.04), 0.3 + (bh - 1.0) / 2 + 0.2, front + 0.012, 0.02)
      chip(fixed, 0.05, 0.5, 0.06, 'dark', bx + s * 0.14, 0.3 + bh * 0.42, front + 0.06)
    }
    for (let k = 0; k < (r.low ? 2 : 4); k++) chip(fixed, dw - 0.4, 0.045, 0.02, 'dark', bx - dw / 2 - 0.04, 0.85 + k * 0.13, front + 0.035)
    plate(fixed, f.label, Math.min(plateWidth(f.label, 1.3, 2.8), bw - 0.4), 0.44, bx, roof - 0.42, front + 0.03)
    // The controls on the right-hand door: a screen, a run light, an emergency stop.
    const cx = bx + dw / 2 + 0.04
    chip(fixed, Math.min(0.9, dw - 0.3), 0.6, 0.03, 'dark', cx, roof - 1.5, front + 0.045)
    chip(fixed, Math.min(0.78, dw - 0.42), 0.48, 0.035, 'black', cx, roof - 1.5, front + 0.05)
    const lamp = pilot('green', cx - 0.22, roof - 2.1, front + 0.03, 0.06)
    chip(fixed, 0.2, 0.2, 0.02, 'yellow', cx + 0.2, roof - 2.1, front + 0.04)
    peg(fixed, 0.07, 0.08, 'red', cx + 0.2, roof - 2.1, front + 0.09, 'z', 10)
    for (const s of [-1, 1]) chip(fixed, 0.08, 0.16, 0.3, 'frame', bx + s * (bw / 2 - 0.3), roof + 0.06, bz)
    band(fixed, 0.37, 0.43, 0.2, 'dark', bx - bw / 4, roof + 0.1, bz)
    const vent = rotor(moving, bx - bw / 4, roof + 0.12, bz, 0.34, 'y', { blades: 5, skin: 'mid', thick: 0.07 })
    rod(fixed, [bx - bw / 4 - 0.42, roof + 0.21, bz], [bx - bw / 4 + 0.42, roof + 0.21, bz], 0.014, 'dark')
    // The open end: a motor, its fan toward you, driving a gear case with a pipe off the top.
    const free = W / 2 - (bx + bw / 2)
    const mx = W / 2 - free / 2
    const mr = Math.min(0.42, free * 0.26)
    const my = 0.36 + mr * 1.25
    const mz = D * 0.14
    chip(fixed, free - 0.2, 0.06, D - 0.5, 'frame', mx, 0.33, 0)
    const fan = motor(fixed, mx, my, mz, mr, mr * 2.8, '-z', { fan: moving })!
    const gz = mz - mr * 2.6
    box(fixed, mr * 2.4, mr * 2.4, mr * 1.9, 'frame', mx, my, gz, 0.05)
    tube(fixed, [[mx, my + mr, gz], [mx, my + mr + 1.3, gz], [mx, my + mr + 1.3, -D / 2 - 0.15]], mr * 0.42, steel, { bend: 0.3 })
    tube(fixed, [[bx + bw / 2 - 0.3, roof, bz + 0.3], [bx + bw / 2 - 0.3, roof + 0.4, bz + 0.3], [mx + mr * 0.5, roof + 0.4, bz + 0.3], [mx + mr * 0.5, roof + 0.4, mz], [mx + mr * 0.5, my + mr * 1.4, mz]], 0.045, steel, { bend: 0.2 })

    spin(r, vent, 11)
    spin(r, fan, 15)
    r.ticks.push((s) => lamp.set(power(s) > 0.5))
    r.kit.pickBox(f.body, bw, roof, bd, bx, roof / 2, bz)
    r.kit.pickBox(f.body, free, my + mr + 1.4, D - 0.4, mx, (my + mr + 1.4) / 2, 0)
    ground(r, f, W, D)
    return { height: roof + 0.5, beacon: [bx - bw / 2 + 0.25, roof, front - 0.25] }
  },
}
