import { CylinderGeometry, Group, Mesh } from 'three'
import { CAR, carHalfWidthAt, carHeightAt } from '../car'
import { COLORS } from '../kit'
import type { Kit, Paint } from '../kit'
import type { ModelBuilder } from '../types'
import { flatSteel } from './conveyorParts'
import { bar, block, coil, foot, gauge, gaugeAngle, glow, hang, laneSpan, leds, paintAll, put, scanFan, sheet, smallMotor, spareSpan, strut, wand, wrapLabel } from './entranceParts'
import type { LedSpot } from './entranceParts'

// What a car meets before the wash: the photo eyes that see it arrive, the sensor that
// reads its shape, and the attendants' prep stations beside the lane. They are small
// machines, so the detail goes where a mechanic looks: heads, lenses, brackets, conduit.
// Each follows the pattern laid out in wrap.ts.

// ---- Photo eyes ------------------------------------------------------------------------
// Through-beam "gate" eyes: two slim stainless posts at the walls, each carrying two
// Banner-style heads under a spray hood. The upper pair looks across at bumper height,
// the lower pair at the tires' sidewalls; both are dark for as long as any of the car is
// between the posts (with the conveyor's pulses that is the car's length, and the zero
// every machine downstream is timed from). The two beams run in opposite directions, as
// they are wired in a real tunnel so one eye can't see the other's light. The beams
// themselves are invisible in life: here they are drawn, and each stops on the car's
// flank nearest its emitter.

const POST = 0.21 // 2.5 in square tube
const POST_TOP = 4
// Where the two beams cross the lane: above the wheel arches but under the hood line,
// and under the sills, level with the tires' sidewalls.
const BEAM_HI = 2.8
const BEAM_LO = 0.67
// From the post's face out to the rim of a head's lens.
const HEAD_REACH = 0.31
const BEAM_R = 0.028
// How far the tires' outer faces sit inside the body's flank: where the low beam lands.
const TIRE_INSET = 0.09

export const photoEye: ModelBuilder = (input) => {
  const { kit } = input
  const m = kit.mat
  const low = input.detail === 'low'
  const name = input.item.label || 'Photo eyes'
  // Beside the tunnel (a spare) there is no lane to look across: the pair stands on its
  // own footprint, just far enough apart for the heads to face each other with a beam
  // between them. No car passes there, so the beams never break.
  const spare = input.side === 'outside' ? spareSpan(input, 0.5, 0.9) : null
  const { lo, hi } = spare ?? laneSpan(input, 0.5)
  const carZ = CAR.z - input.y

  // ---- Parts that never move ----
  const fixed = new Group()
  const green: LedSpot[] = []
  const amber: LedSpot[] = []
  for (const s of [-1, 1]) {
    const z = s > 0 ? hi : lo
    // Feet out from the post's lane-side face, toward the lane.
    const out = (d: number) => z - s * (POST / 2 + d)
    const back = z + (s * POST) / 2
    fixed.add(put(foot(kit, 0.62, 0.62, { mat: m.stainless, bolts: !low }), 0, 0, z))
    fixed.add(strut(kit, [0, 0.05, z], [0, POST_TOP - 0.04, z], POST, m.stainless, 0.02))
    fixed.add(put(block(kit, POST + 0.07, 0.045, POST + 0.07, m.stainless, 0.015), 0, POST_TOP - 0.022, z))
    for (const beamY of [BEAM_HI, BEAM_LO]) {
      // The head: a yellow sensor block on a mounting plate, its lens in the upper half,
      // under a folded stainless hood that keeps spray off the glass.
      const y = beamY - 0.05
      fixed.add(put(sheet(0.3, 0.4, 0.025, m.stainless), 0, y, out(0.0125)))
      fixed.add(put(kit.paint(block(kit, 0.2, 0.3, 0.24, m.frame, 0.025), 'yellow'), 0, y, out(0.145)))
      const lens = kit.paint(kit.cyl(0.07, 0.05, m.frame, { radial: 8, bevel: 0.012 }), 'black')
      lens.rotation.x = Math.PI / 2
      fixed.add(put(lens, 0, beamY, out(HEAD_REACH - 0.025)))
      fixed.add(put(sheet(0.31, 0.02, 0.46, m.stainless), 0, y + 0.2, out(0.23)))
      if (!low) {
        for (const x of [-0.145, 0.145]) fixed.add(put(sheet(0.02, 0.11, 0.46, m.stainless), x, y + 0.145, out(0.23)))
        // Its cord drops in a drip loop before it goes into the post.
        fixed.add(kit.paint(kit.tube([[0, y - 0.14, out(0.17)], [0, y - 0.38, out(0.15)], [0, y - 0.36, out(0)]], 0.02, m.frame, { bend: 0.1, radial: 5 }), 'hoseBlack'))
      }
    }
    // The junction box on the wall side, tagged with the machine's name, and the conduit
    // that takes the cable into the floor.
    fixed.add(put(kit.paint(block(kit, 0.44, 0.54, 0.2, m.frame, 0.03), 'mid'), 0, 1.6, back + s * 0.1))
    fixed.add(put(kit.paint(sheet(0.37, 0.47, 0.016, m.frame), 'body'), 0, 1.6, back + s * 0.207))
    const tag = put(kit.sign(name, 0.34, 0.1), 0, 1.72, back + s * 0.217)
    if (s < 0) tag.rotation.y = Math.PI
    fixed.add(tag)
    fixed.add(kit.paint(bar(kit, [0.1, 1.34, back + s * 0.1], [0.1, 0.02, back + s * 0.1], 0.04, m.frame), 'mid'))
    if (!low) fixed.add(kit.paint(bar(kit, [0.1, 1.26, back + s * 0.1], [0.1, 1.34, back + s * 0.1], 0.058, m.frame), 'dark'))
    // Twin LEDs on the upper hood: green while the lane is clear, amber while a car is
    // in the eyes.
    green.push({ at: [-0.07, BEAM_HI + 0.16, out(0.2)] })
    amber.push({ at: [0.07, BEAM_HI + 0.16, out(0.2)] })
  }
  const clear = leds(kit, 'green', 0.045, green, fixed)
  const blocked = leds(kit, 'amber', 0.045, amber, fixed)

  // ---- The beams ----
  // Each is a foot of glowing rod stretched from its emitter's lens to wherever it
  // lands, with a dot of light on what it hits. The high beam leaves the passenger side
  // post, the low one the driver's side post.
  const fromHi = hi - POST / 2 - HEAD_REACH
  const fromLo = lo + POST / 2 + HEAD_REACH
  const span = fromHi - fromLo
  const red = glow(kit, 'red')
  const light = new Group()
  const beam = (y: number, from: number, toward: number) => {
    const g = put(new Group(), 0, y, from)
    if (toward < 0) g.rotation.y = Math.PI
    const rod = kit.cyl(BEAM_R, 1, red.material, { radial: 6, bevel: 0.005 })
    rod.rotation.x = Math.PI / 2
    rod.position.z = 0.5
    g.add(rod)
    light.add(g)
    return g
  }
  const dot = (y: number) => {
    const g = put(new Group(), 0, y, 0)
    const d = kit.cyl(0.08, 0.02, red.material, { radial: 8, bevel: 0.006 })
    d.rotation.x = Math.PI / 2
    g.add(d)
    light.add(g)
    return g
  }
  const beamHi = beam(BEAM_HI, fromHi, -1)
  const beamLo = beam(BEAM_LO, fromLo, 1)
  const dotHi = dot(BEAM_HI)
  const dotLo = dot(BEAM_LO)
  kit.mergeMoving(light, [beamHi, beamLo, dotHi, dotLo])
  // Light, not a body: it keeps its red in every look the status layer puts on.
  light.traverse((o) => { if ((o as Mesh).isMesh) o.userData.fx = true })

  const pose = (on: boolean, carDx: number | null) => {
    light.visible = on
    red.sync()
    let hiLen = span
    let loLen = span
    if (on && carDx != null) {
      // Where the eyes stand, measured from the car's center.
      const half = carHalfWidthAt(-carDx)
      if (half > 0) {
        hiLen = fromHi - (carZ + half)
        loLen = carZ - (half - TIRE_INSET) - fromLo
      }
    }
    const hiCut = hiLen < span
    const loCut = loLen < span
    beamHi.scale.z = hiLen
    beamLo.scale.z = loLen
    dotHi.position.z = fromHi - hiLen + 0.012
    dotLo.position.z = fromLo + loLen - 0.012
    dotHi.scale.setScalar(hiCut ? 1 : 1e-4)
    dotLo.scale.setScalar(loCut ? 1 : 1e-4)
    clear.visible = on && !hiCut && !loCut
    blocked.visible = on && (hiCut || loCut)
  }
  pose(false, null)

  const body = new Group()
  body.add(kit.mergeStatic(flatSteel(kit, fixed)), light, clear, blocked)
  if (spare?.turned) body.rotation.y = Math.PI / 2
  const root = new Group()
  root.name = 'photo-eye'
  root.add(body)

  // What the pointer can hit: the two posts, and a thin line where the high beam runs,
  // so pointing at the beam finds the eyes.
  for (const z of [lo, hi]) kit.pickBox(body, 1.1, POST_TOP + 0.3, 1.2, 0, (POST_TOP + 0.3) / 2, z)
  kit.pickBox(body, 0.4, 0.4, span, 0, BEAM_HI, (fromHi + fromLo) / 2)

  return {
    root,
    height: POST_TOP,
    // On the passenger side post (a turned spare: the post at +x).
    beacon: spare?.turned ? { x: hi, y: POST_TOP, z: 0 } : { x: 0, y: POST_TOP, z: hi },
    // Eyes watch whenever the machine is up, car or no car: activity plays no part.
    update: (st) => pose(st.running, st.carDx),
    dispose: () => red.material.dispose(),
  }
}

// ---- Truck bed sensor -----------------------------------------------------------------
// The overhead profiler that finds an open pickup bed, so the top brushes lift and the
// dryers hold off over it. A light galvanized gantry (slim legs, a laced truss for a
// header: nothing like the square portals the brushes hang from, or a spray arch's bent
// pipe) carries the heads over the car's centerline: a scanner that looks down through a
// slot and a sonar horn beside it as its check. Under them is the solid plate the sonar
// needs for a clean echo off the floor. The scanner's light is drawn as a thin fan along
// the lane that lands on the car as it passes and takes the shape of its roofline.

const TRUSS_TOP = 9.9
const TRUSS_DEEP = 0.62 // between the two chords' centerlines
const CHORD = 0.15
const LEG = 0.25 // 3 in square tube
// The scanner's window: where the fan starts.
const HEAD_Y = 8.4
// Half the fan's angle (as a slope), fore and aft.
const FAN_TAN = 0.27
const PLATE_T = 0.035

export const sensor: ModelBuilder = (input) => {
  const { kit } = input
  const m = kit.mat
  const low = input.detail === 'low'
  const name = input.item.label || 'Sensor'
  // Beside the tunnel (a spare) there is no car to look down on: the gantry stands on its
  // own footprint, just wide enough for the heads to hang between its legs, and the fan
  // is narrowed to land on its own target plate.
  const spare = input.side === 'outside' ? spareSpan(input, 0.5, 1.1) : null
  const { lo, hi } = spare ?? laneSpan(input, 0.5)
  // Where the scanner hangs across the lane: over the car's centerline, or on a spare
  // where its head plate (0.28 ft further toward hi) comes out in the middle.
  const headZ = spare ? -0.28 : CAR.z - input.y
  const tan = spare ? Math.min(FAN_TAN, Math.max(0.03, (Math.min(input.w, input.h) / 2 - 0.25) / HEAD_Y)) : FAN_TAN
  const yTop = TRUSS_TOP - CHORD / 2
  const yBot = yTop - TRUSS_DEEP
  const under = yBot - CHORD / 2

  // ---- Parts that never move ----
  const fixed = new Group()
  // The gantry: legs, two chords, and the lacing between them. A short spare has no knee
  // braces: they would run through the head plate, and a frame that small needs none.
  for (const z of [lo, hi]) {
    const inward = z === lo ? 1 : -1
    fixed.add(put(foot(kit, 0.8, 0.8, { boltMat: m.galvanized, bolts: !low }), 0, 0, z))
    fixed.add(strut(kit, [0, 0.05, z], [0, TRUSS_TOP, z], LEG, m.galvanized, 0.025))
    if (!spare || hi - lo > 4.4) fixed.add(strut(kit, [0, under - 1.1, z + (inward * LEG) / 2], [0, under, z + inward * 1.25], 0.11, m.galvanized, 0.015))
  }
  const z0 = lo + LEG / 2
  const z1 = hi - LEG / 2
  for (const y of [yTop, yBot]) fixed.add(strut(kit, [0, y, z0], [0, y, z1], CHORD, m.galvanized, 0.02))
  const panels = Math.max(2, Math.round((z1 - z0) / (low ? 2.6 : 1.5)))
  const pitch = (z1 - z0) / panels
  // The name hangs in the truss over the lane, in place of the lacing there. A short
  // spare's truss has no room for lacing beside it: the name fills it, centered.
  const room = z1 - z0 - 2 * pitch
  const short = !!spare && room < 2.4
  const signW = Math.min(short ? z1 - z0 - 0.3 : room, Math.max(2.4, name.length * 0.27))
  const signZ = short ? (z0 + z1) / 2 : Math.min(z1 - pitch - signW / 2, Math.max(z0 + pitch + signW / 2, headZ))
  const signLo = signZ - signW / 2 - 0.07
  const signHi = signZ + signW / 2 + 0.07
  for (let k = 0; k < panels; k++) {
    const a = z0 + k * pitch
    const b = a + pitch
    if (k > 0 && (a < signLo - 0.05 || a > signHi + 0.05)) fixed.add(put(sheet(0.09, TRUSS_DEEP - CHORD, 0.09, m.galvanized), 0, (yTop + yBot) / 2, a))
    if (b < signLo + 0.12 || a > signHi - 0.12) fixed.add(bar(kit, [0, k % 2 ? yTop : yBot, a], [0, k % 2 ? yBot : yTop, b], 0.035, m.galvanized))
  }
  fixed.add(put(kit.paint(block(kit, 0.09, TRUSS_DEEP - CHORD - 0.02, signHi - signLo, m.frame, 0.02), 'dark'), 0, (yTop + yBot) / 2, signZ))
  for (const dir of [-1, 1]) {
    const plate = put(kit.sign(name, signW, TRUSS_DEEP - CHORD - 0.1), dir * 0.048, (yTop + yBot) / 2, signZ)
    plate.rotation.y = (dir * Math.PI) / 2
    fixed.add(plate)
  }

  // The heads, hung under the truss on a plate with a drip skirt: the scanner over the
  // car's centerline, the sonar beside it.
  const sonarZ = headZ + 0.64
  const plateY = HEAD_Y + 0.46
  const plateZ = headZ + 0.28
  for (const dz of [-0.4, 0.96]) fixed.add(strut(kit, [0, plateY, headZ + dz], [0, under, headZ + dz], 0.1, m.galvanized, 0.012))
  fixed.add(put(sheet(0.74, 0.04, 1.6, m.galvanized), 0, plateY, plateZ))
  if (!low) for (const x of [-0.36, 0.36]) fixed.add(put(sheet(0.02, 0.16, 1.6, m.galvanized), x, plateY - 0.1, plateZ))
  fixed.add(put(kit.paint(block(kit, 0.54, 0.42, 0.66, m.frame, 0.05), 'black'), 0, HEAD_Y + 0.23, headZ))
  fixed.add(put(kit.paint(sheet(0.12, 0.02, 0.5, m.frame), COLORS.glass), 0, HEAD_Y + 0.012, headZ))
  // The laser warning label every scanner wears.
  fixed.add(put(kit.paint(sheet(0.012, 0.14, 0.24, m.frame), 'yellow'), -0.272, HEAD_Y + 0.2, headZ))
  fixed.add(put(kit.paint(kit.cyl(0.1, 0.32, m.frame, { radial: 10 }), 'black'), 0, HEAD_Y + 0.28, sonarZ))
  fixed.add(put(kit.paint(kit.cyl(0.21, 0.24, m.frame, { radial: 12, r2: 0.1, bevel: 0.012 }), 'black'), 0, HEAD_Y, sonarZ))
  fixed.add(put(kit.paint(kit.cyl(0.118, 0.05, m.frame, { radial: 10 }), 'yellow'), 0, HEAD_Y + 0.38, sonarZ))

  // The controller on the passenger side leg, facing cars as they arrive, and the
  // conduit that runs to it along the truss and down the leg.
  const boxX = -(LEG / 2 + 0.15)
  const boxY = 4.7
  fixed.add(put(kit.paint(block(kit, 0.3, 1.0, 0.8, m.frame, 0.04), 'body'), boxX, boxY, hi))
  fixed.add(put(kit.paint(sheet(0.02, 0.9, 0.7, m.frame), 'white'), boxX - 0.156, boxY, hi))
  fixed.add(put(kit.paint(sheet(0.02, 0.16, 0.34, m.frame), COLORS.glass), boxX - 0.162, boxY + 0.06, hi + 0.1))
  fixed.add(put(kit.paint(sheet(0.03, 0.14, 0.05, m.frame), 'black'), boxX - 0.17, boxY - 0.05, hi - 0.3))
  const tag = put(kit.sign(name, 0.62, 0.13), boxX - 0.168, boxY + 0.31, hi)
  tag.rotation.y = -Math.PI / 2
  fixed.add(tag)
  const runX = -(CHORD / 2 + 0.04)
  const legX = -(LEG / 2 + 0.04)
  fixed.add(kit.paint(kit.tube([[runX, plateY + 0.02, headZ + 0.2], [runX, yBot, headZ + 0.2], [runX, yBot, hi - LEG / 2 - 0.05], [legX, yBot, hi], [legX, boxY + 0.5, hi]], 0.04, m.frame, { bend: 0.16, radial: 6 }), 'mid'))
  // Green: watching. Amber: a vehicle is under the heads.
  const ledAt = (dz: number): LedSpot => ({ at: [boxX - 0.166, boxY - 0.2, hi + dz], turn: [0, 0, Math.PI / 2] })
  const ready = leds(kit, 'green', 0.045, [ledAt(0.22)], fixed)
  const sees = leds(kit, 'amber', 0.045, [ledAt(0.08)], fixed)

  // The target plate on the floor, between the wheel tracks (on a spare, between its
  // legs' feet).
  const target = foot(kit, 2 * HEAD_Y * tan + 0.5, spare ? Math.min(1.8, hi - lo - 0.9) : 1.8, { t: PLATE_T, boltMat: m.galvanized, bolts: !low })
  fixed.add(put(target, 0, 0, spare ? 0 : headZ))

  const fan = scanFan(kit, { apex: HEAD_Y, z: headZ, tan, floor: PLATE_T, segments: low ? 8 : 16 })

  const body = new Group()
  body.add(kit.mergeStatic(flatSteel(kit, fixed)), fan.mesh, ready, sees)
  if (spare?.turned) body.rotation.y = Math.PI / 2
  const root = new Group()
  root.name = 'sensor'
  root.add(body)

  // What the pointer can hit: the legs, the truss, the heads and the controller.
  for (const z of [lo, hi]) kit.pickBox(body, 0.9, TRUSS_TOP, 0.9, 0, TRUSS_TOP / 2, z)
  kit.pickBox(body, 0.7, TRUSS_DEEP + 0.5, hi - lo, 0, (yTop + yBot) / 2, (lo + hi) / 2)
  kit.pickBox(body, 1, 1.1, 1.9, 0, HEAD_Y + 0.3, plateZ)
  kit.pickBox(body, 0.7, 1.2, 1.0, boxX, boxY, hi)

  return {
    root,
    height: TRUSS_TOP,
    // Over the passenger side leg (a turned spare: the leg at +x).
    beacon: spare?.turned ? { x: hi, y: TRUSS_TOP, z: 0 } : { x: 0, y: TRUSS_TOP, z: hi },
    update(st) {
      // The sensor looks all the time it is up: faintly at the bare floor, brightly
      // once the car is coming.
      fan.update(st.carDx, st.t, st.running ? 0.42 + 0.58 * st.activity : 0)
      const over = st.running && st.carDx != null && carHeightAt(-st.carDx) > 0
      ready.visible = st.running && !over
      sees.visible = over
    },
    dispose: fan.dispose,
  }
}

// ---- Prep stations --------------------------------------------------------------------
// Where an attendant works a car over before it goes in. Two kinds share the shape:
//   the prep gun station   a high pressure pump skid (a motor belt-driving a triplex
//                          pump, a float tank on top, the unloader and its gauge on the
//                          manifold) feeding trigger guns: one from an overhead reel,
//                          one from a hose coiled on the end of the skid
//   the bug prep station   a low pressure chemical applicator: a blue drum on a spill
//                          pallet, and a panel with an air pump and its regulator
//                          feeding one wand
// Both are open stands, so the works show from either side, and each is built facing +Z
// and then turned so its wands face the lane. Nothing on one moves but a gauge needle
// and a pilot light: the attendant does the work.

// The station as it is modeled, in feet. A footprint of another size scales it.
const STATION = { w: 5, d: 3.5 }

type Station = {
  height: number
  // The top of a post, for the status light.
  beacon: [number, number, number]
  needle: Mesh
  // What the gauge reads while the station is up, 0 to 1.
  reading: number
  pilot: LedSpot
  picks: Array<{ w: number; h: number; d: number; x: number; z: number }>
  // The heavy things, for their patch of contact shadow.
  pads: Array<{ w: number; d: number; x: number; z: number }>
}

function gunStation(kit: Kit, fixed: Group, name: string, low: boolean): Station {
  const m = kit.mat
  // The skid: an open stainless frame, the left of its top decked for the tank.
  const X0 = -2.05
  const X1 = 0.95
  const Z0 = -1.5
  const Z1 = 0.5
  const TOP = 3
  const T = 0.13
  const xs = [X0 + T / 2, X1 - T / 2]
  const zs = [Z0 + T / 2, Z1 - T / 2]
  const zc = (Z0 + Z1) / 2
  for (const x of xs) {
    for (const z of zs) {
      fixed.add(strut(kit, [x, 0.04, z], [x, TOP, z], T, m.stainless, 0.02))
      if (!low) fixed.add(kit.paint(bar(kit, [x, 0, z], [x, 0.05, z], 0.1, m.frame), 'black'))
    }
  }
  for (const y of [0.45, TOP - T / 2]) {
    for (const z of zs) fixed.add(strut(kit, [xs[0] + T / 2, y, z], [xs[1] - T / 2, y, z], T * 0.9, m.stainless, 0.02))
    for (const x of xs) fixed.add(strut(kit, [x, y, zs[0] + T / 2], [x, y, zs[1] - T / 2], T * 0.9, m.stainless, 0.02))
  }
  fixed.add(put(sheet(X1 - X0 - 0.1, 0.03, Z1 - Z0 - 0.1, m.stainless), (X0 + X1) / 2, 0.525, zc))
  fixed.add(put(sheet(1.72, 0.03, Z1 - Z0 - 0.04, m.stainless), X0 + 0.88, TOP + 0.015, zc))

  // The motor at the back, lying along the skid, and the pump in front of it: a blue
  // crankcase with a brass head toward the attendant. A belt joins them under the guard
  // at the right hand end.
  const motorZ = Z0 + 0.6
  const pumpZ = Z1 - 0.62
  const motor = low ? new Group().add(put(kit.cyl(0.34, 1.15, m.frame, { radial: 12, bevel: 0.05 }), 0, 0.575, 0)) : smallMotor(kit, 0.33, 0.9)
  paintAll(kit, motor, COLORS.motor)
  motor.rotation.z = Math.PI / 2
  fixed.add(put(motor, X0 + 2.4, 0.97, motorZ))
  fixed.add(put(kit.paint(sheet(0.9, 0.1, 0.56, m.frame), 'dark'), X0 + 1.9, 0.59, motorZ))
  fixed.add(put(kit.paint(block(kit, 0.6, 0.44, 0.48, m.frame, 0.05), COLORS.drumBlue), X0 + 2, 0.82, pumpZ))
  fixed.add(put(kit.paint(block(kit, 0.56, 0.3, 0.2, m.frame, 0.03), 'brass'), X0 + 2, 0.8, pumpZ + 0.34))
  if (!low) {
    fixed.add(kit.paint(bar(kit, [X0 + 2, 1.03, pumpZ], [X0 + 2, 1.1, pumpZ], 0.05, m.frame), 'yellow'))
    for (const dx of [-0.18, 0, 0.18]) fixed.add(kit.paint(bar(kit, [X0 + 2 + dx, 0.94, pumpZ + 0.34], [X0 + 2 + dx, 1.01, pumpZ + 0.34], 0.055, m.frame), 'brass'))
  }
  const guardX = X0 + 2.56
  const sheave = (r: number, y: number, z: number) => {
    const c = kit.cyl(r, 0.2, m.stainless, { radial: low ? 10 : 14, bevel: 0.03 })
    c.rotation.z = Math.PI / 2
    return put(c, guardX, y, z)
  }
  fixed.add(sheave(0.42, 0.97, motorZ), sheave(0.3, 0.84, pumpZ))
  fixed.add(put(block(kit, 0.2, 0.58, pumpZ - motorZ, m.stainless, 0.03), guardX, 0.9, (motorZ + pumpZ) / 2))

  // Off the head: a riser to the unloader valve, and the gauge above it.
  const riserX = X0 + 1.8
  const riserZ = pumpZ + 0.34
  fixed.add(kit.paint(bar(kit, [riserX, 0.94, riserZ], [riserX, 1.86, riserZ], 0.035, m.frame), 'brass'))
  fixed.add(put(kit.paint(block(kit, 0.2, 0.2, 0.18, m.frame, 0.03), 'brass'), riserX, 1.45, riserZ))
  fixed.add(kit.paint(bar(kit, [riserX - 0.1, 1.45, riserZ], [riserX - 0.27, 1.45, riserZ], 0.06, m.frame), 'black'))
  const needle = gauge(kit, fixed, [riserX, 2.15, riserZ - 0.045], 0.19)

  // The float tank, with the station's name front and back.
  const tankX = X0 + 0.88
  fixed.add(put(block(kit, 1.5, 0.95, 1.6, m.stainless, 0.05), tankX, TOP + 0.505, zc))
  fixed.add(put(block(kit, 1.56, 0.045, 1.66, m.stainless, 0.02), tankX, TOP + 1.0, zc))
  fixed.add(put(kit.paint(sheet(0.4, 0.05, 0.08, m.frame), 'black'), tankX, TOP + 1.045, zc))
  for (const dir of [-1, 1]) {
    const plate = put(kit.sign(name, 1.3, 0.3), tankX, TOP + 0.6, zc + dir * 0.806)
    if (dir < 0) plate.rotation.y = Math.PI
    fixed.add(plate)
  }
  // Water in at the back, down through the strainer and round to the pump.
  fixed.add(kit.paint(kit.tube([[X0 + 0.3, TOP + 0.75, Z0 + 0.2], [X0 + 0.3, TOP + 0.75, Z0 - 0.06], [X0 + 0.3, 0.03, Z0 - 0.06]], 0.035, m.frame, { bend: 0.1, radial: 6 }), 'hoseBlue'))
  const strainerZ = zc + 0.2
  fixed.add(put(kit.paint(kit.cyl(0.16, 0.5, m.frame, { radial: 10 }), 'hoseWhite'), X0 + 0.6, 0.8, strainerZ))
  fixed.add(put(kit.paint(kit.cyl(0.18, 0.1, m.frame, { radial: 10 }), 'black'), X0 + 0.6, 1.1, strainerZ))
  fixed.add(kit.paint(bar(kit, [X0 + 0.6, TOP, strainerZ], [X0 + 0.6, 1.15, strainerZ], 0.05, m.frame), 'hoseBlack'))
  if (!low) fixed.add(kit.paint(hang(kit, [X0 + 0.76, 0.9, strainerZ], [X0 + 1.72, 0.78, pumpZ + 0.34], 0.05, m.frame, 0.14), 'hoseBlack'))

  // The starter on the front right leg: start, stop and a pilot light, and the flex
  // conduit down to the motor.
  const boxX = X1 - 0.43
  const boxZ = Z1 + 0.11
  fixed.add(put(kit.paint(block(kit, 0.5, 0.6, 0.22, m.frame, 0.03), 'body'), boxX, 2.3, boxZ))
  const button = (r: number, color: 'green' | 'red', x: number) => {
    const b = kit.paint(kit.cyl(r, 0.05, m.frame, { radial: 8 }), color)
    b.rotation.x = Math.PI / 2
    return put(b, x, 2.2, boxZ + 0.125)
  }
  fixed.add(button(0.045, 'green', boxX - 0.11), button(0.058, 'red', boxX + 0.11))
  if (!low) fixed.add(kit.paint(kit.tube([[boxX, 2.02, boxZ - 0.06], [boxX, 1.5, boxZ - 0.3], [X0 + 1.92, 1.42, motorZ + 0.4], [X0 + 1.92, 1.15, motorZ + 0.4]], 0.03, m.frame, { bend: 0.25, radial: 5 }), 'hoseBlack'))

  // The mast at the right hand end: the reel overhead, and under it the first gun in
  // its holster, on the hose that drops from the reel.
  const mastX = 1.72
  const mastZ = -1.25
  const MAST = 6.3
  fixed.add(put(foot(kit, 0.7, 0.7, { mat: m.stainless, bolts: !low }), mastX, 0, mastZ))
  fixed.add(strut(kit, [mastX, 0.05, mastZ], [mastX, MAST, mastZ], 0.21, m.stainless, 0.02))
  fixed.add(put(block(kit, 0.28, 0.045, 0.28, m.stainless, 0.015), mastX, MAST + 0.022, mastZ))
  const reelY = 5.35
  const reelZ = mastZ + 0.48
  const round = (r: number, len: number, z: number, radial: number, color?: Paint) => {
    const c = kit.cyl(r, len, color ? m.frame : m.stainless, { radial, bevel: Math.min(0.03, len * 0.3) })
    c.rotation.x = Math.PI / 2
    if (color) kit.paint(c, color)
    return put(c, mastX, reelY, z)
  }
  // The reel's flanges are thin pressed discs: a chamfer on them would never show.
  for (const dz of [-0.27, 0.27]) {
    const flange = new Mesh(new CylinderGeometry(0.7, 0.7, 0.04, low ? 12 : 20), m.stainless)
    flange.castShadow = true
    flange.receiveShadow = true
    flange.rotation.x = Math.PI / 2
    fixed.add(put(flange, mastX, reelY, reelZ + dz))
  }
  fixed.add(round(0.52, 0.5, reelZ, low ? 10 : 14, 'hoseBlue'), round(0.13, 0.66, reelZ, low ? 6 : 8, 'dark'))
  fixed.add(strut(kit, [mastX, reelY, mastZ + 0.08], [mastX, reelY, reelZ - 0.27], 0.16, m.stainless, 0.02))
  const holster = (x: number, y: number, z: number, toX: number, toZ: number) => {
    fixed.add(put(kit.cyl(0.085, 0.42, m.stainless, { radial: 8 }), x, y, z))
    fixed.add(put(sheet(Math.abs(toX - x) + 0.06, 0.14, Math.abs(toZ - z) + 0.06, m.stainless), (x + toX) / 2, y, (z + toZ) / 2))
  }
  const holsterZ = mastZ + 0.24
  const gunA = wand(kit, { lance: 3, hp: true })
  fixed.add(put(gunA.root, mastX, 0.75, holsterZ))
  holster(mastX, 2.35, holsterZ, mastX, mastZ + 0.1)
  fixed.add(kit.paint(hang(kit, [mastX - 0.52, reelY - 0.1, reelZ], [mastX + gunA.inlet[0], 0.75 + gunA.inlet[1], holsterZ + gunA.inlet[2]], 0.035, m.frame, 0.42), 'hoseBlue'))
  // High pressure from the unloader across to the mast and up to the reel's swivel.
  if (!low) {
    fixed.add(kit.paint(kit.tube([[riserX + 0.1, 1.45, riserZ], [X1 + 0.2, 1.45, riserZ], [mastX - 0.14, 1.45, mastZ + 0.14], [mastX - 0.14, reelY, mastZ + 0.14], [mastX - 0.14, reelY, reelZ - 0.3]], 0.03, m.frame, { bend: 0.2, radial: 4 }), 'hoseBlack'))
  }

  // The second gun on the left hand end of the skid, next to the hook its hose is
  // coiled on.
  const gunB = wand(kit, { lance: 3, hp: true })
  const gunX = X0 - 0.16
  const gunZ = zs[1]
  fixed.add(put(gunB.root, gunX, 0.6, gunZ))
  holster(gunX, 2.2, gunZ, X0 + 0.03, gunZ)
  const coilX = X0 - 0.19
  const coilZ = zc - 0.3
  const hung = coil(kit, { r: 0.45, turns: 3.5, pitch: 0.08, hose: 0.035, axis: 'x', material: m.frame })
  fixed.add(put(kit.paint(hung, 'hoseBlue'), coilX, 2.3, coilZ))
  fixed.add(bar(kit, [X0 + 0.02, 2.78, coilZ], [X0 - 0.38, 2.8, coilZ], 0.03, m.stainless))
  fixed.add(kit.paint(hang(kit, [coilX + 0.16, 2.3, coilZ + 0.45], [gunX + gunB.inlet[0], 0.6 + gunB.inlet[1], gunZ + gunB.inlet[2]], 0.035, m.frame, 0.3), 'hoseBlue'))

  return {
    height: MAST + 0.05,
    beacon: [mastX, MAST + 0.05, mastZ],
    needle,
    reading: 0.63,
    pilot: { at: [boxX, 2.42, boxZ + 0.11], turn: [Math.PI / 2, 0, 0] },
    picks: [
      { w: X1 - X0 + 0.8, h: 4.3, d: Z1 - Z0 + 0.6, x: (X0 + X1) / 2 - 0.2, z: zc + 0.2 },
      { w: 1.5, h: MAST + 0.1, d: 1.3, x: mastX, z: mastZ + 0.4 },
    ],
    pads: [{ w: X1 - X0, d: Z1 - Z0, x: (X0 + X1) / 2, z: zc }],
  }
}

function bugStation(kit: Kit, fixed: Group, name: string, low: boolean): Station {
  const m = kit.mat
  // The drum of bug remover, on a spill pallet.
  const drumX = -1.2
  const drumZ = -0.3
  const DECK = 0.45
  const DRUM_R = 0.96
  const DRUM_H = 2.9
  fixed.add(put(kit.paint(block(kit, 2.3, DECK - 0.03, 2.3, m.frame, 0.06), 'yellow'), drumX, (DECK - 0.03) / 2, drumZ))
  fixed.add(put(kit.paint(sheet(2.08, 0.03, 2.08, m.frame), 'black'), drumX, DECK - 0.015, drumZ))
  if (!low) for (const dx of [-0.55, 0.55]) fixed.add(put(kit.paint(sheet(0.6, 0.16, 0.02, m.frame), 'black'), drumX + dx, 0.12, drumZ + 1.152))
  const radial = low ? 12 : 18
  fixed.add(put(kit.paint(kit.cyl(DRUM_R, DRUM_H, m.frame, { radial, bevel: 0.07 }), COLORS.drumBlue), drumX, DECK + DRUM_H / 2, drumZ))
  for (const f of [0.34, 0.66]) fixed.add(put(kit.paint(kit.cyl(DRUM_R + 0.03, 0.09, m.frame, { radial, bevel: 0.03 }), COLORS.drumBlue), drumX, DECK + DRUM_H * f, drumZ))
  const drumTop = DECK + DRUM_H
  for (const dx of [-0.55, 0.55]) fixed.add(put(kit.paint(kit.cyl(0.12, 0.07, m.frame, { radial: 6 }), 'white'), drumX + dx, drumTop + 0.03, drumZ))
  // Its label, toward the attendant: white, with the maker's band and a hazard mark.
  const label = (h: number, arc: number, y: number, turn: number, color: Paint, proud: number) => {
    const patch = kit.paint(wrapLabel(DRUM_R + proud, h, arc, m.frame), color)
    patch.rotation.y = turn
    fixed.add(put(patch, drumX, DECK + DRUM_H * y, drumZ))
  }
  label(0.62, 1.1, 0.5, 0.25, 'white', 0.006)
  if (!low) {
    label(0.14, 1.1, 0.575, 0.25, 'dark', 0.012)
    label(0.2, 0.22, 0.455, -0.1, 'red', 0.012)
  }
  // The suction stinger in one bung, and the line that carries the chemical to the pump.
  const stingX = drumX + 0.55
  fixed.add(kit.paint(bar(kit, [stingX, drumTop + 0.05, drumZ], [stingX, drumTop + 0.55, drumZ], 0.045, m.frame), 'mid'))

  // The panel: a stainless board on two legs, the name across its top, front and back.
  const legs = [0.55, 2.1]
  const boardX = (legs[0] + legs[1]) / 2
  const boardZ = -1.3
  const TOP = 4.9
  for (const x of legs) {
    fixed.add(put(foot(kit, 0.5, 0.5, { mat: m.stainless, bolts: !low }), x, 0, boardZ))
    fixed.add(strut(kit, [x, 0.05, boardZ], [x, TOP, boardZ], 0.15, m.stainless, 0.02))
  }
  fixed.add(strut(kit, [legs[0], 1.3, boardZ], [legs[1], 1.3, boardZ], 0.1, m.stainless, 0.015))
  fixed.add(put(block(kit, legs[1] - legs[0] + 0.2, 2.3, 0.05, m.stainless, 0.02), boardX, 3.65, boardZ))
  const face = boardZ + 0.025
  for (const dir of [-1, 1]) {
    const plate = put(kit.sign(name, 1.5, 0.34), boardX, dir > 0 ? 4.55 : 4.3, boardZ + dir * 0.027)
    if (dir < 0) plate.rotation.y = Math.PI
    fixed.add(plate)
  }

  // On the board: an air diaphragm pump (two white chambers on a dark center), the
  // timer box over it, and the air regulator with its gauge.
  const pumpX = 1.0
  const pumpY = 3.15
  const pumpZ = face + 0.17
  fixed.add(put(kit.paint(block(kit, 0.3, 0.4, 0.3, m.frame, 0.04), 'dark'), pumpX, pumpY, pumpZ))
  for (const dx of [-0.24, 0.24]) {
    const chamber = kit.paint(kit.cyl(0.21, 0.18, m.frame, { radial: low ? 8 : 10, bevel: 0.05 }), 'white')
    chamber.rotation.z = Math.PI / 2
    fixed.add(put(chamber, pumpX + dx, pumpY, pumpZ))
  }
  for (const dy of [-0.26, 0.26]) fixed.add(kit.paint(bar(kit, [pumpX - 0.3, pumpY + dy, pumpZ], [pumpX + 0.3, pumpY + dy, pumpZ], 0.055, m.frame), 'white'))
  fixed.add(put(kit.paint(block(kit, 0.5, 0.36, 0.2, m.frame, 0.03), 'body'), pumpX, 3.98, face + 0.1))
  fixed.add(kit.paint(bar(kit, [pumpX + 0.12, 3.98, face + 0.19], [pumpX + 0.12, 3.98, face + 0.24], 0.05, m.frame), 'black'))
  const regX = 1.74
  const regY = 3.5
  const regZ = face + 0.1
  fixed.add(put(kit.paint(kit.cyl(0.09, 0.3, m.frame, { radial: 8 }), 'dark'), regX, regY, regZ))
  fixed.add(kit.paint(bar(kit, [regX, regY + 0.15, regZ], [regX, regY + 0.29, regZ], 0.07, m.frame), 'black'))
  fixed.add(put(kit.paint(kit.cyl(0.075, 0.24, m.frame, { radial: 8, bevel: 0.03 }), 'hoseWhite'), regX, regY - 0.27, regZ))
  const needle = gauge(kit, fixed, [regX, regY, face + 0.19], 0.17)
  // Chemical from the drum in green, shop air in blue.
  fixed.add(kit.paint(hang(kit, [stingX, drumTop + 0.55, drumZ], [pumpX - 0.3, pumpY - 0.26, pumpZ], 0.03, m.frame, 0.12), 'green'))
  if (!low) {
    fixed.add(kit.paint(hang(kit, [regX - 0.09, regY, regZ], [pumpX + 0.1, pumpY + 0.18, pumpZ + 0.13], 0.02, m.frame, 0.22), 'hoseBlue'))
    fixed.add(kit.paint(kit.tube([[regX + 0.09, regY, regZ], [1.97, regY, regZ], [1.97, 0.03, regZ]], 0.02, m.frame, { bend: 0.08, radial: 5 }), 'hoseBlue'))
  }

  // The wand in its holster on the right hand leg, and its hose coiled on a hook under
  // the board.
  const wandZ = boardZ + 0.2
  const lance = wand(kit, { lance: 2.4, hp: false })
  fixed.add(put(lance.root, legs[1], 1.25, wandZ))
  fixed.add(put(kit.cyl(0.085, 0.42, m.stainless, { radial: 8 }), legs[1], 2.3, wandZ))
  const coilZ = boardZ + 0.3
  const hung = coil(kit, { r: 0.46, turns: 3.5, pitch: 0.075, hose: 0.032, axis: 'z', material: m.frame })
  fixed.add(put(kit.paint(hung, 'hoseBlack'), boardX - 0.1, 1.86, coilZ))
  fixed.add(bar(kit, [boardX - 0.1, 2.36, boardZ], [boardX - 0.1, 2.34, coilZ + 0.22], 0.03, m.stainless))
  fixed.add(put(sheet(0.1, 0.2, 0.1, m.stainless), boardX - 0.1, 2.44, boardZ))
  fixed.add(kit.paint(hang(kit, [pumpX + 0.3, pumpY + 0.26, pumpZ], [boardX - 0.1, 2.32, coilZ - 0.1], 0.03, m.frame, 0.1), 'hoseBlack'))
  fixed.add(kit.paint(hang(kit, [boardX + 0.36, 1.86, coilZ + 0.14], [legs[1] + lance.inlet[0], 1.25 + lance.inlet[1], wandZ + lance.inlet[2]], 0.032, m.frame, 0.28), 'hoseBlack'))

  return {
    height: TOP,
    beacon: [legs[1], TOP, boardZ],
    needle,
    reading: 0.4,
    pilot: { at: [pumpX - 0.12, 3.98, face + 0.2], turn: [Math.PI / 2, 0, 0] },
    picks: [
      { w: 2.4, h: drumTop + 0.6, d: 2.4, x: drumX, z: drumZ },
      { w: legs[1] - legs[0] + 0.7, h: TOP, d: 1.1, x: boardX, z: boardZ + 0.3 },
    ],
    pads: [{ w: 2.3, d: 2.3, x: drumX, z: drumZ }],
  }
}

export const prepUnit: ModelBuilder = (input) => {
  const { kit } = input
  const low = input.detail === 'low'
  const name = input.item.label || 'Prep'
  // Which station it is: the machine type it is matched to says so if it can, then the
  // name someone gave it. Anything else is a gun station.
  const says = (text: string | null) => (/bug|chem|applicat/i.test(text ?? '') ? 'bug' : /gun|wand|pressure/i.test(text ?? '') ? 'gun' : null)
  const bug = (says(input.item.match_type) ?? says(input.item.label)) === 'bug'

  // The station is laid out along the footprint's long side, and of the two ways round
  // that leaves, it takes the one that faces its wands toward the tunnel (a station
  // lying across the lane faces the cars as they arrive). Beside the tunnel the scene has
  // turned root by the shape's rotation, so "toward the tunnel" is worked out in root's
  // own axes. In the tunnel root is never turned (the rotation is already in w and h).
  const turn = input.side === 'outside' ? (input.rotation * Math.PI) / 180 : 0
  const toward = input.y > 0 ? -1 : 1
  const laneX = toward * Math.sin(turn) - 0.01 * Math.cos(turn)
  const laneZ = toward * Math.cos(turn) + 0.01 * Math.sin(turn)
  const along = input.w >= input.h
  const yaw = along ? (laneZ >= 0 ? 0 : Math.PI) : laneX >= 0 ? Math.PI / 2 : -Math.PI / 2
  const k = Math.min(1.2, Math.max(0.75, Math.min(Math.max(input.w, input.h) / STATION.w, Math.min(input.w, input.h) / STATION.d)))

  const fixed = new Group()
  const st = bug ? bugStation(kit, fixed, name, low) : gunStation(kit, fixed, name, low)
  const pilot = leds(kit, 'green', 0.05, [st.pilot], fixed)
  // On the phone tier the needle is a few pixels: it is merged in where it reads at work,
  // and the station costs one draw call fewer.
  const rest = gaugeAngle(0)
  st.needle.rotation.z = low ? gaugeAngle(st.reading) : rest
  if (low) fixed.add(st.needle)

  const station = new Group()
  station.rotation.y = yaw
  station.scale.setScalar(k)
  station.add(kit.mergeStatic(flatSteel(kit, fixed)), pilot)
  if (!low) station.add(st.needle)
  for (const p of st.picks) kit.pickBox(station, p.w, p.h, p.d, p.x, p.h / 2, p.z)
  // Everything here stands still and is in the shadow map: only a faint patch where the
  // heavy parts meet the floor.
  for (const p of st.pads) kit.blob(station, p.w, p.d, { x: p.x, z: p.z, shape: 'box', opacity: 0.5, soft: 0.6 })

  const root = new Group()
  root.name = bug ? 'bug-prep' : 'prep-guns'
  root.add(station)

  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const [bx, by, bz] = st.beacon
  return {
    root,
    height: st.height * k,
    beacon: { x: (bx * cos + bz * sin) * k, y: by * k, z: (-bx * sin + bz * cos) * k },
    update(s) {
      // Up to pressure and holding: the needle only trembles with the pump.
      if (!low) {
        const tremble = 0.012 * Math.sin(s.t * 7.3) + 0.007 * Math.sin(s.t * 17.9 + 1)
        st.needle.rotation.z = s.running ? gaugeAngle(s.activity * (st.reading + tremble)) : rest
      }
      pilot.visible = s.running
    },
  }
}
