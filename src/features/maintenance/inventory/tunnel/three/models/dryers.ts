import { CylinderGeometry, Group } from 'three'
import type { BufferGeometry, Mesh } from 'three'
import { CAR, CAR_PROFILE, carHeightAt } from '../car'
import { COLORS } from '../kit'
import type { AirCylinder, Paint, SprayOpts, V3 } from '../kit'
import type { ModelBuilder } from '../types'
import { awayFromTunnel, lightCylinder } from './archParts'
import { boxGeo, ductGeo, inletGeo, motorGeo, mouthGeo, part, scrollGeo, wheelGeo } from './dryerParts'
import type { DuctSection } from './dryerParts'

// The dryers (MacNeil Tech 21): not one machine but a package. A row of gantry arches,
// each carrying "producers": a black molded snail-shell housing with a motor on its back,
// a small round inlet on its face and an outlet that runs on, tangent to the shell, into a
// long nozzle that flattens into a slot. Three ride on top of each arch (one over the
// middle of the car, two at the shoulders turned 45 degrees) and one hugs each leg, low or
// at door height, aimed at the flank. The first arch's middle nozzle is hinged: an air
// cylinder swings it down over the hood and back up for the roof.
//
// From across the room a round black drum facing the camera reads as a tire, so what a
// producer must show at a distance is its outline: shell and nozzle as one long shape
// pointing at the car. The inlet is small, dark and set back.
//
// The footprint is the whole drying zone: w along the tunnel sets how many arches, h how
// far apart the legs stand. A footprint that sits to one side of the car becomes a row of
// posts with side producers only. Beside the tunnel there is no car to reach, so the
// package is drawn whole on its own footprint, around a car it only imagines (standIn).
//
// Everything top-mounted stays above CLEAR_Y, the roof plus a margin, wherever it stands,
// so only the legs and the side producers need to be kept out of the lane.

const TUBE = 0.42 // 5 in square tube
const HEADER = 10 // top of the cross beam
const SPACING = 8 // feet of drying zone per arch
// The housing: its wall winds out from R0 to R1 in one turn. THICK along the shaft.
const R0 = 0.76
const R1 = 1.3
const THICK = 1.15
// The outlet's depth, measured in from the outer wall.
const OUTLET = 0.7
// The inlet's radius.
const EYE = 0.34
const MOTOR_R = 0.46
const MOTOR_LEN = 1.0
// The motor's can and fan cowl, end to end.
const MOTOR_RUN = MOTOR_LEN + 0.3
// A housing hangs this far upstream of its arch, so its motor lands on the header.
const STANDOFF = 0.3
// Top producers' shaft: the motor stands on a saddle on the header.
const SHAFT = HEADER + 0.14 + MOTOR_R
// Nothing fixed hangs lower than this over the lane.
const CLEAR_Y = CAR.height + 0.6
const MOUTH_Y = 6.9
const SHOULDER_Y = 7.3
// A nozzle's slot: half its length, half its width (2.8 ft by 3 in).
const SLOT = 1.4
const SLIT = 0.13
// Side nozzles stop this far from the paint.
const SIDE_GAP = 0.65
// Room a full-size side producer needs between its leg and the car.
const SIDE_ROOM = 2 * R1 + 0.12 + 0.7
// A leg stands this far in from the footprint's edge, and at least this far off the car.
const LEG_IN = 0.5
const LEG_CLEAR = 0.95
// The hinged nozzle: its pivot, its length, half the width of the drum it turns on,
// where its tip rides and the pin the cylinder pushes.
const HINGE_Y = 8.5
const NOZZLE = 3.2
const DRUM = 0.78
const TIP_REST = CLEAR_Y + 0.25
// Down, it still rakes back a little: it blows toward the tail.
const TIP_LOW = HINGE_Y - NOZZLE * Math.cos(0.2)
const TIP_OVER = 0.85
// The stretch along the tunnel its tip sweeps, measured from the hinge, and how early
// it starts to lift for a roof that is still on its way: feet of height per foot.
const SWEEP_BACK = 2.8
const SWEEP_AHEAD = 0.5
const LIFT_EARLY = 0.3
const LUG_X = 0.42
const LUG_Y = 0.9
// Resting raked back, the hinged nozzle's tip and slot reach RAKE upstream of its arch.
// Every arch's saddles reach SADDLE_BACK downstream of it.
const RAKE = STANDOFF + THICK / 2 + Math.sqrt(NOZZLE * NOZZLE - (HINGE_Y - TIP_REST) ** 2) + 0.25
const SADDLE_BACK = 1.2
// Wheels turn far slower than the real 3,500 rpm, so the eye can follow them.
const SPIN = 2.2 * Math.PI * 2
const HALF = Math.SQRT1_2

const AIR = '#dbe9f6'
const SLOT_DARK = '#0a0b0d'
// The inlet's rolled lip and the wheel inside it: dark, so the face stays one black
// shape and the wheel only shows when you look for it.
const RING = '#2a2e34'
const BLADE = '#7b838c'
const HUB = '#3a3f46'
const PLATE = '#202328'

type Mouth = {
  at: V3
  // The way it blows, and the way its slot is long. Unit vectors.
  dir: V3
  wide: V3
  half: number
  thin: number
}

// The hinged nozzle: the part that swings, the cylinder that swings it (pinned to the
// frame at ax, ay), and where they are.
type Hinged = { nozzle: Group; ram: AirCylinder; x: number; ramZ: number; ax: number; ay: number }

type Spec = {
  // The housing's back face (the motor stands off it, downstream) and its shaft.
  x: number
  y: number
  z: number
  // The way the outlet leaves the housing, in the plane across the tunnel. A unit vector.
  fy: number
  fz: number
  // Which way round the housing winds: it decides which side of the shaft the outlet is.
  hand: 1 | -1
  // Size, 1 for a full 15 HP producer.
  k: number
  mouth: Mouth
  // False: the duct ends where something else takes over (the hinged nozzle's drum).
  open: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / len, a[1] / len, a[2] / len]
}

// How much footprint a post and its side producer of size k need across: from the edge
// the post stands LEG_IN in from to the far side of the housing or of the slot (whose lip
// sticks out 0.15 ft past its middle), whichever is farther.
const postReach = (k: number) => LEG_IN + TUBE / 2 + Math.max(2 * R1 * k + 0.12, SIDE_ROOM * k - SIDE_GAP + 0.15)

// Beside the tunnel: where the imagined car runs (in the model's own z) and how the
// package stands around it. Gantry arches when their legs fit on the footprint around a
// car on its middle, and it is long enough for the first arch with its hinged nozzle
// resting in front of it and its saddles behind (a longer one gets more arches, never
// closer together than that). Otherwise posts on the edge away from the tunnel, so the
// producers blow toward it, each the biggest that has room before the far edge.
type StandIn = { carZ: number; spans: boolean; s: 1 | -1; zLeg: number }
function standIn(w: number, h: number, y: number, rotation: number): StandIn {
  if (h / 2 - LEG_IN >= CAR.width / 2 + LEG_CLEAR && w >= RAKE + SADDLE_BACK) return { carZ: 0, spans: true, s: 1, zLeg: 0 }
  const s = awayFromTunnel(y, rotation)
  let k = 1
  while (k > 0.63 && postReach(k) > h) k -= 0.02
  // On a footprint too small for even the smallest, the whole thing is centered on it.
  const zLeg = s * (Math.max(h, postReach(k)) / 2 - LEG_IN)
  const zIn = zLeg - (s * TUBE) / 2
  return { carZ: zIn - s * (SIDE_ROOM * k + CAR.width / 2), spans: false, s, zLeg }
}

// The duct's cross-sections, from the outlet at `from` (leaving along f, with n the side
// of it that faces away from the shaft) to the mouth. It leaves as the housing's fat
// rectangle, thins early into a long neck and only spreads into the slot near its end,
// so shell and nozzle read as one tapering shape.
function ductPath(from: V3, f: V3, n: V3, k: number, mouth: Mouth, steps: number): DuctSection[] {
  const reach = Math.hypot(mouth.at[0] - from[0], mouth.at[1] - from[1], mouth.at[2] - from[2])
  const pull = reach * 0.9
  const wide = dot(n, mouth.wide) < 0 ? add([0, 0, 0], mouth.wide, -1) : mouth.wide
  // It keeps its shape until it is clear of the housing.
  const clear = Math.min(0.45, (0.8 * k) / reach)
  const ha0 = (OUTLET / 2) * k
  const hb0 = THICK * 0.45 * k
  // The first section is inside the housing, so the two overlap.
  const out: DuctSection[] = [{ at: add(from, f, -0.4 * k), a: n, b: cross(f, n), ha: ha0, hb: hb0 }]
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const t2 = t * t
    const t3 = t2 * t
    const at: [number, number, number] = [0, 0, 0]
    const tan: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      at[i] = (2 * t3 - 3 * t2 + 1) * from[i] + (t3 - 2 * t2 + t) * f[i] * pull + (3 * t2 - 2 * t3) * mouth.at[i] + (t3 - t2) * mouth.dir[i] * pull
      tan[i] = (6 * t2 - 6 * t) * from[i] + (3 * t2 - 4 * t + 1) * f[i] * pull + (6 * t - 6 * t2) * mouth.at[i] + (3 * t2 - 2 * t) * mouth.dir[i] * pull
    }
    const along = unit(tan)
    const e = clamp((t - clear) / (1 - clear), 0, 1)
    const lean: V3 = [lerp(n[0], wide[0], e), lerp(n[1], wide[1], e), lerp(n[2], wide[2], e)]
    const a = unit(add(lean, along, -dot(lean, along)))
    out.push({ at, a, b: cross(along, a), ha: lerp(ha0, mouth.half, e * e), hb: lerp(hb0, mouth.thin, Math.sqrt(e)) })
  }
  return out
}

export const blower: ModelBuilder = (input) => {
  const { kit, w, h } = input
  const m = kit.mat
  const fine = input.detail === 'high'
  // Ducts are octagons in section: from any distance a rounder one costs half again as
  // much and looks the same.
  const corner = 1
  // The model's origin is its footprint's center, wherever that is across the tunnel.
  // Beside the tunnel the car is an imagined one, placed on the footprint.
  const stand = input.side === 'outside' ? standIn(w, h, input.y, input.rotation) : null
  const carZ = stand ? stand.carZ : CAR.z - input.y
  const carLo = carZ - CAR.width / 2
  const carHi = carZ + CAR.width / 2

  const fixed = new Group()
  const moving = new Group()
  const root = new Group()
  root.name = 'blower'
  const fans: Group[] = []
  const jets: SprayOpts['nozzles'] = []
  let top = 0

  // One of each shape, shared by every producer.
  const scroll = scrollGeo({ r0: R0, r1: R1, thick: THICK, eye: EYE, bevel: fine ? 0.04 : 0, around: fine ? 24 : 16, throat: 0.42 })
  const inlet = fine ? kit.swatch(inletGeo(EYE, 0.09, 0.05, 14), RING) : null
  const tint = (g: BufferGeometry, piece: 'blade' | 'hub' | 'plate') => kit.swatch(g, piece === 'blade' ? BLADE : piece === 'hub' ? HUB : PLATE)
  const wheel = wheelGeo(EYE - 0.03, fine ? 7 : 5, 0.16, tint)
  const motorShape = kit.swatch(motorGeo(MOTOR_R, MOTOR_LEN, MOTOR_RUN - MOTOR_LEN, fine ? 12 : 8), COLORS.motor)

  // Small colored parts, the motors and the gray steel are painted from the sign atlas,
  // so everything but the black housings is one draw call.
  const painted = (mesh: Mesh, color: Paint, x: number, y: number, z: number): Mesh => {
    kit.paint(mesh, color).position.set(x, y, z)
    return mesh
  }
  const steel = (mesh: Mesh): Mesh => kit.paint(mesh, 'frame')
  // Gray steel: eased edges up close, plain boxes on a phone.
  const bar = (bw: number, bh: number, bd: number, r = 0.035): Mesh => steel(fine ? kit.box(bw, bh, bd, m.frame, r) : part(boxGeo(bw, bh, bd), m.frame))
  const foot = (x: number, z: number) => {
    fixed.add(bar(TUBE + 0.62, 0.06, TUBE + 0.5, 0.02).translateX(x).translateY(0.03).translateZ(z))
  }

  // ---- One producer: housing, inlet, wheel, motor, duct and nozzle ----
  const producer = (p: Spec): void => {
    const k = p.k
    const front = p.x - THICK * k
    const mid = p.x - (THICK * k) / 2
    const shell = part(scroll, m.blackPlastic)
    shell.position.set(mid, p.y, p.z)
    // The housing is built with its outlet leaving straight down: turn it to leave
    // along f, mirrored first if it winds the other way.
    shell.rotation.x = Math.atan2(-p.fz, -p.fy)
    shell.scale.set(k, k, p.hand * k)
    fixed.add(shell)
    if (inlet) {
      const ring = part(inlet, m.sign)
      ring.position.set(front, p.y, p.z)
      ring.scale.setScalar(k)
      fixed.add(ring)
    }
    // The wheel, set back in the inlet. It is the one part of a producer that moves.
    const fan = new Group()
    fan.position.set(front + 0.24 * k, p.y, p.z)
    const blades = part(wheel, m.sign)
    blades.scale.setScalar(k)
    fan.add(blades)
    moving.add(fan)
    fans.push(fan)

    // The motor, lying along the shaft behind the housing.
    const motor = part(motorShape, m.sign)
    motor.position.set(p.x, p.y, p.z)
    motor.scale.setScalar(k)
    fixed.add(motor)

    // The duct, from the side of the housing to the mouth.
    const f: V3 = [0, p.fy, p.fz]
    const n: V3 = [0, p.hand * p.fz, -p.hand * p.fy]
    const off = (R1 - OUTLET / 2) * k
    const sections = ductPath([mid, p.y + n[1] * off, p.z + n[2] * off], f, n, k, p.mouth, fine ? 6 : 3)
    fixed.add(part(ductGeo(sections, corner), m.blackPlastic))
    if (p.open) {
      const end = sections[sections.length - 1]
      const mouth = mouthGeo(end, p.mouth.dir, fine ? 0.03 : 0, corner)
      if (mouth.lip) fixed.add(kit.paint(part(mouth.lip, m.sign), COLORS.stainless))
      fixed.add(kit.paint(part(mouth.cap, m.sign), SLOT_DARK))
      for (const q of [-0.5, 0.5]) jets.push({ at: add(add(p.mouth.at, end.a, q * p.mouth.half), p.mouth.dir, 0.06), dir: p.mouth.dir })
    }
    kit.pickCylinder(root, (R1 + 0.06) * k, (THICK + MOTOR_RUN) * k, p.x + ((MOTOR_RUN - THICK) * k) / 2, p.y, p.z, 'x')
    top = Math.max(top, p.y + R1 * k)
  }

  // ---- A side producer, on a shelf off a leg whose inner face is at zIn ----
  // s is the side the leg is on (+1 passenger), feedY how high its conduit runs up the
  // leg (null: to just above the housing). Returns the height it reaches, or 0 when there
  // is no room for one between the leg and the car.
  const sideProducer = (xa: number, s: 1 | -1, zIn: number, low: boolean, feedY: number | null): number => {
    const gap = s > 0 ? zIn - carHi : carLo - zIn
    const k = Math.min(1, gap / SIDE_ROOM)
    if (k < 0.6) return 0
    const zs = zIn - s * (R1 * k + 0.12)
    const off = (R1 - OUTLET / 2) * k
    const half = SLOT * 0.8 * k
    // Low: the slot covers rockers and wheels. Otherwise it is centered at door height.
    const slotY = low ? 0.75 + half : 4.5
    const ys = low ? slotY + off : slotY - off
    const x = xa - STANDOFF
    producer({
      x, y: ys, z: zs, fy: 0, fz: -s, hand: low ? s : (-s as 1 | -1), k, open: true,
      mouth: { at: [x - (THICK * k) / 2 - 0.5 * k, slotY, carZ + s * (CAR.width / 2 + SIDE_GAP)], dir: unit([-0.45, 0, -s]), wide: [0, 1, 0], half, thin: SLIT },
    })
    // The shelf its motor sits on: an arm off the leg, braced underneath.
    const shelf = ys - MOTOR_R * k - 0.05
    const tip = zs - s * 0.5 * k
    fixed.add(painted(part(boxGeo(1.0, 0.05, 0.95 * k), m.frame), 'frame', xa + 0.32, shelf, zs))
    fixed.add(painted(part(boxGeo(0.24, 0.26, Math.abs(tip - zIn)), m.frame), 'frame', xa, shelf - 0.15, (tip + zIn) / 2))
    const brace = kit.gusset(Math.min(0.8, Math.abs(tip - zIn) * 0.6), 0.05, m.frame)
    brace.position.set(xa, shelf - 0.28, zIn)
    brace.rotation.y = (s * Math.PI) / 2
    brace.scale.y = -1
    fixed.add(steel(brace))
    // Power: conduit up the leg from the motor's box.
    if (fine) {
      const cz = zIn + s * 0.12
      fixed.add(kit.paint(kit.tube([[xa + 0.25, ys + MOTOR_R * k + 0.5, cz], [xa + 0.25, feedY ?? ys + R1 * k + 0.3, cz]], 0.035, m.sign, { radial: 6 }), COLORS.stainless))
    }
    return ys + R1 * k
  }

  const count = clamp(Math.round(w / SPACING), 1, 6)
  // The footprint reaches across the lane: gantry arches. Otherwise it stands to one
  // side of the car and gets posts.
  const spans = stand ? stand.spans : -h / 2 < carLo + 1 && h / 2 > carHi - 1
  let beacon = { x: 0, y: HEADER, z: 0 }
  // The hinged nozzle's parts, when there is one.
  const rig: { hinged: Hinged | null } = { hinged: null }

  if (spans) {
    // Legs at the footprint's edges, pushed out if that would put one in the lane.
    const legLo = Math.min(-h / 2 + LEG_IN, carLo - LEG_CLEAR)
    const legHi = Math.max(h / 2 - LEG_IN, carHi + LEG_CLEAR)
    const pitch = w / count
    // Beside the tunnel the arches move downstream as far as the first one's hinged
    // nozzle needs to stay on the footprint while it rests raked back. standIn only
    // builds a gantry where the last one's saddles still fit after that. In the tunnel
    // the footprint's ends are no wall.
    const shift = stand ? Math.max(0.15, RAKE - pitch / 2) : 0.15
    const xs = Array.from({ length: count }, (_, i) => (i + 0.5) * pitch - w / 2 + shift)
    // A shoulder producer's shaft: 5.3 ft off the car's centerline, or as far out as its
    // leg lets it stand.
    const shoulderZ = (s: 1 | -1) => (s > 0 ? Math.min(carZ + 5.3, legHi - TUBE / 2 - R1 - 0.1) : Math.max(carZ - 5.3, legLo + TUBE / 2 + R1 + 0.1))
    // The middle producer's outlet drops on the car's centerline, so its shaft is off to
    // one side of it: the driver's side, unless a narrow gantry only has room for all
    // three with it on the other.
    const beside = (hand: 1 | -1) => carZ - hand * (R1 - OUTLET / 2)
    const room = (hand: 1 | -1) => shoulderZ(1) - R1 >= beside(hand) + R1 + 0.2 && shoulderZ(-1) + R1 <= beside(hand) - R1 - 0.2
    const hand0: 1 | -1 = room(1) || !room(-1) ? 1 : -1
    const z0 = beside(hand0)
    beacon = { x: xs[0], y: HEADER, z: legHi }

    // What a top producer's motor stands on.
    const saddle = (xa: number, z: number) => {
      fixed.add(painted(part(boxGeo(1.5, 0.06, 1.1), m.frame), 'frame', xa + 0.42, HEADER + 0.03, z))
      fixed.add(painted(part(boxGeo(1.0, 0.1, 0.7), m.sign), COLORS.motor, xa + 0.42, HEADER + 0.11, z))
    }

    xs.forEach((xa, i) => {
      // The arch: two legs, a header across them, feet and corner gussets.
      fixed.add(bar(TUBE, TUBE, legHi - legLo + TUBE).translateX(xa).translateY(HEADER - TUBE / 2).translateZ((legLo + legHi) / 2))
      for (const z of [legLo, legHi]) {
        fixed.add(bar(TUBE, HEADER - TUBE - 0.06, TUBE).translateX(xa).translateY((HEADER - TUBE + 0.06) / 2).translateZ(z))
        foot(xa, z)
        if (fine) {
          const inward = z === legLo ? 1 : -1
          const gus = kit.gusset(0.95, 0.05, m.frame)
          gus.position.set(xa, HEADER - TUBE, z + (inward * TUBE) / 2)
          gus.rotation.y = (-inward * Math.PI) / 2
          gus.scale.y = -1
          fixed.add(steel(gus))
        }
      }
      kit.pickBox(root, 0.9, HEADER, 0.9, xa, HEADER / 2, legLo)
      kit.pickBox(root, 0.9, HEADER, 0.9, xa, HEADER / 2, legHi)
      kit.pickBox(root, 0.8, 0.8, legHi - legLo, xa, HEADER - TUBE / 2, (legLo + legHi) / 2)
      if (fine) fixed.add(kit.paint(kit.tube([[xa + 0.27, HEADER - 0.08, legLo], [xa + 0.27, HEADER - 0.08, legHi]], 0.035, m.sign, { radial: 6 }), COLORS.stainless))
      const x = xa - STANDOFF
      const mid = x - THICK / 2

      // The middle producer. On the first arch its duct ends on a drum and the nozzle
      // below swings on it.
      const smart = i === 0
      saddle(xa, z0)
      producer({
        x, y: SHAFT, z: z0, fy: -1, fz: 0, hand: hand0, k: 1, open: !smart,
        mouth: smart
          ? { at: [mid, HINGE_Y + 0.2, carZ], dir: [0, -1, 0], wide: [0, 0, 1], half: DRUM - 0.06, thin: 0.42 }
          : { at: [mid - 0.9, MOUTH_Y, carZ], dir: unit([-0.5, -0.87, 0]), wide: [0, 0, 1], half: SLOT, thin: SLIT },
      })
      if (!smart) kit.pickBox(root, 0.8, SHAFT - MOUTH_Y - 1.2, SLOT * 1.5, mid - 0.35, (SHAFT - 1.2 + MOUTH_Y) / 2, carZ)
      if (smart) {
        const drum = kit.cyl(0.4, DRUM * 2, m.blackPlastic, { bevel: 0.05, radial: fine ? 12 : 8 })
        drum.rotation.x = Math.PI / 2
        drum.position.set(mid, HINGE_Y, carZ)
        fixed.add(drum)
        const nozzle = new Group()
        nozzle.position.set(mid, HINGE_Y, carZ)
        const across: V3 = [0, 0, 1]
        const thin: V3 = [-1, 0, 0]
        const cut = (drop: number, ha: number, hb: number): DuctSection => ({ at: [0, -drop, 0], a: across, b: thin, ha, hb })
        const sections = [cut(-0.16, DRUM - 0.04, 0.46), cut(0.32, DRUM - 0.02, 0.46), cut(0.9, 0.62, 0.36), cut(1.9, 0.75, 0.26), cut(2.7, 1.1, 0.18), cut(NOZZLE, SLOT, SLIT)]
        // Painted the housings' black, so the swinging parts are one draw call.
        nozzle.add(kit.paint(part(ductGeo(sections, corner), m.sign), COLORS.blackPlastic))
        const mouth = mouthGeo(sections[sections.length - 1], [0, -1, 0], fine ? 0.03 : 0, corner)
        if (mouth.lip) nozzle.add(kit.paint(part(mouth.lip, m.sign), COLORS.stainless))
        nozzle.add(kit.paint(part(mouth.cap, m.sign), SLOT_DARK))
        // The cheeks it pivots on, and the pin the cylinder pushes.
        const ramZ = DRUM + 0.24
        for (const side of [-1, 1]) {
          const cheek = part(new CylinderGeometry(0.5, 0.5, 0.07, fine ? 12 : 8), m.sign)
          cheek.rotation.x = Math.PI / 2
          nozzle.add(painted(cheek, 'black', 0, 0, side * (DRUM + 0.035)))
        }
        nozzle.add(painted(part(boxGeo(0.3, 0.3, 0.3), m.sign), 'mid', LUG_X - 0.08, -LUG_Y, ramZ - 0.15))
        // It moves, so the shadow map never sees it: a faint patch on the floor instead.
        kit.blob(nozzle, 1.2, SLOT * 1.6, { y: -NOZZLE * 0.6, shape: 'box', opacity: 0.8, contact: 0 })
        kit.pickBox(nozzle, 0.9, NOZZLE + 0.5, SLOT * 1.6, 0, -NOZZLE / 2 + 0.2, 0)
        const ram = lightCylinder(kit, { body: 1.7, stroke: 0.5, bore: 0.075, color: 'body', rodColor: COLORS.stainless })
        // Its bracket hangs under the header.
        const ax = xa - 0.1
        const ay = HEADER - TUBE - 0.2
        fixed.add(painted(part(boxGeo(0.3, 0.34, 0.16), m.frame), 'frame', ax, HEADER - TUBE - 0.13, carZ + ramZ))
        moving.add(nozzle, ram.root)
        rig.hinged = { nozzle, ram, x: mid, ramZ: carZ + ramZ, ax, ay }
      }

      // The shoulder producers, turned to blow down and in at 45 degrees. Their ducts
      // pass under their own bellies.
      for (const s of [-1, 1] as const) {
        const zk = shoulderZ(s)
        if (s > 0 ? zk - R1 < z0 + R1 + 0.2 : zk + R1 > z0 - R1 - 0.2) continue
        const off = R1 - OUTLET / 2
        const fromY = SHAFT - HALF * off
        const fromZ = zk + s * HALF * off
        const run = (fromY - SHOULDER_Y) / HALF
        saddle(xa, zk)
        producer({
          x, y: SHAFT, z: zk, fy: -HALF, fz: -s * HALF, hand: s, k: 1, open: true,
          mouth: { at: [mid - 0.6, SHOULDER_Y, fromZ - s * HALF * run], dir: unit([-0.45, -HALF, -s * HALF]), wide: [0, -HALF, s * HALF], half: SLOT * 0.8, thin: SLIT },
        })
      }

      // One on each leg, low on one arch and at door height on the next. A long gantry
      // carries them on every other arch, so the car shows between them.
      const every = count > 2 ? 2 : 1
      if (i % every === 0) for (const s of [-1, 1] as const) sideProducer(xa, s, (s > 0 ? legHi : legLo) - (s * TUBE) / 2, (i / every) % 2 === 0, HEADER - 0.2)
    })

    if (count > 1) {
      // Rails tie the arches into one gantry. The passenger side one carries the feed.
      for (const z of [legLo, legHi]) fixed.add(bar(xs[count - 1] - xs[0], 0.3, 0.3).translateX((xs[0] + xs[count - 1]) / 2).translateY(HEADER - TUBE / 2).translateZ(z))
      if (fine) fixed.add(kit.paint(kit.tube([[xs[0] + 0.27, HEADER + 0.04, legHi], [xs[count - 1] + 0.27, HEADER + 0.04, legHi]], 0.035, m.sign, { radial: 6 }), COLORS.stainless))
    }

    // The disconnect on the first passenger side leg, facing the wall, and its conduit.
    const boxZ = legHi + TUBE / 2 + 0.15
    fixed.add(painted(kit.box(0.7, 1.1, 0.3, m.sign, 0.04), 'dark', xs[0], 4.7, boxZ))
    fixed.add(painted(part(boxGeo(0.09, 0.3, 0.07), m.sign), 'red', xs[0] + 0.2, 4.85, boxZ + 0.17))
    fixed.add(painted(part(boxGeo(0.26, 0.2, 0.02), m.sign), 'yellow', xs[0] - 0.12, 4.95, boxZ + 0.155))
    if (fine) fixed.add(kit.paint(kit.tube([[xs[0] + 0.27, 5.25, boxZ], [xs[0] + 0.27, HEADER + 0.04, boxZ], [xs[0] + 0.27, HEADER + 0.04, legHi]], 0.035, m.sign, { bend: 0.2, radial: 6 }), COLORS.stainless))

    // The package's name on the first header, facing cars as they arrive, in the wider
    // gap between the middle housing and a shoulder one.
    const plateLen = Math.min(2.6, Math.max(1.8, input.item.label.length * 0.32))
    const plate = kit.sign(input.item.label || 'Dryers', plateLen, 0.34)
    const plateZ = z0 + hand0 * (R1 + 0.35 + plateLen / 2)
    plate.position.set(xs[0] - TUBE / 2 - 0.012, HEADER - TUBE / 2, clamp(plateZ, legLo + 1 + plateLen / 2, legHi - 1 - plateLen / 2))
    plate.rotation.y = -Math.PI / 2
    fixed.add(plate)
    top = Math.max(top, HEADER)
  } else {
    // Posts down the side the footprint is on, each with one side producer, low and at
    // door height in turn.
    const s: 1 | -1 = stand ? stand.s : input.side === 'ps' ? 1 : input.side === 'ds' ? -1 : carZ <= 0 ? 1 : -1
    const posts = clamp(Math.round(w / 4), 1, 6)
    const pitch = w / posts
    // In the tunnel: at the footprint's far edge, or farther if a producer wouldn't fit
    // before the car.
    const room = SIDE_ROOM * 0.62 + TUBE / 2
    const zLeg = stand ? stand.zLeg : s > 0 ? Math.max(h / 2 - LEG_IN, carHi + room) : Math.min(-h / 2 + LEG_IN, carLo - room)
    for (let i = 0; i < posts; i++) {
      const xa = (i + 0.5) * pitch - w / 2 + 0.15
      const low = i % 2 === 0
      const reach = sideProducer(xa, s, zLeg - (s * TUBE) / 2, low, null)
      const height = Math.max(4, reach + 0.4)
      fixed.add(bar(TUBE, height - 0.06, TUBE).translateX(xa).translateY((height + 0.06) / 2).translateZ(zLeg))
      foot(xa, zLeg)
      kit.pickBox(root, 0.9, height, 0.9, xa, height / 2, zLeg)
      top = Math.max(top, height)
      if (i > 0) continue
      beacon = { x: xa, y: height, z: zLeg }
      // The name runs down the first post, facing cars as they arrive.
      const plateLen = Math.min(2.2, Math.max(1.4, input.item.label.length * 0.3))
      const plate = kit.sign(input.item.label || 'Dryer', plateLen, 0.3)
      plate.rotation.set(0, -Math.PI / 2, -Math.PI / 2)
      plate.position.set(xa - TUBE / 2 - 0.012, height - 0.3 - plateLen / 2, zLeg)
      fixed.add(plate)
    }
  }

  // ---- The hinged nozzle's pose ----
  // phi is how far it is swung back from hanging straight down.
  let phi = 0
  const solve = (carDx: number | null, activity: number, x: number) => {
    // The tallest bit of car under the nozzle's sweep. Car that is still coming, or has
    // just left, counts for less the farther off it is, so the nozzle rises and settles
    // over a few feet of travel instead of snapping. The car's outline is straight
    // lines, so looking at its corners and the two ends of the sweep finds the most.
    let under = 0
    if (carDx != null) {
      const lo = x - SWEEP_BACK
      const hi = x + SWEEP_AHEAD
      under = Math.max(carHeightAt(lo - carDx), carHeightAt(hi - carDx))
      for (let i = 0; i < CAR_PROFILE.length; i++) {
        const at = carDx + CAR_PROFILE[i][0]
        const off = at > hi ? at - hi : at < lo ? lo - at : 0
        under = Math.max(under, CAR_PROFILE[i][1] - off * LIFT_EARLY)
      }
    }
    const want = clamp(under + TIP_OVER, TIP_LOW, TIP_REST)
    const ease = activity * activity * (3 - 2 * activity)
    phi = Math.acos(clamp((HINGE_Y - lerp(TIP_REST, want, ease)) / NOZZLE, -1, 1))
  }
  const hinged = rig.hinged
  const pose = () => {
    if (!hinged) return
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)
    hinged.nozzle.rotation.z = -phi
    hinged.ram.aim(hinged.ax, hinged.ay, hinged.ramZ, hinged.x + LUG_X * cos - LUG_Y * sin, HINGE_Y - LUG_X * sin - LUG_Y * cos, hinged.ramZ)
  }
  // Rest, parked up out of the lane, is the pose the moving parts are merged in.
  solve(null, 0, hinged ? hinged.x : 0)
  pose()

  // ---- Air ----
  // Thin fast streaks from every mouth. It is air, so there are few of them and they
  // are nearly white.
  const wind = jets.length ? kit.spray({ kind: 'jet', nozzles: jets, reach: 3.2, spread: 0.07, perNozzle: 9, size: 0.55, color: AIR, seed: 11 }) : null
  const gust = hinged
    ? kit.spray({ kind: 'jet', nozzles: [-0.5, 0.5].map((q) => ({ at: [0, -NOZZLE - 0.06, q * SLOT] as const, dir: [0, -1, 0] as const })), reach: 2.6, spread: 0.07, perNozzle: 9, size: 0.55, color: AIR, seed: 12 })
    : null
  if (gust && hinged) hinged.nozzle.add(gust.root)
  // The water it chases off: a few drops flung back from the roof's trailing edge and
  // the tail. They ride with the car.
  const tail = -CAR.length / 2
  const across: V3 = [0, 0, 1]
  const drops = kit.spray({
    kind: 'fan', reach: 2.2, spread: 0.35, perNozzle: fine ? 12 : 7, size: 0.3, seed: 13,
    nozzles: [
      { at: [tail + 1.2, CAR.height - 0.1, carZ - 1.3], dir: [-1, 0.3, 0], across },
      { at: [tail + 1.2, CAR.height - 0.1, carZ + 1.3], dir: [-1, 0.3, 0], across },
      { at: [tail + 0.05, 3.2, carZ - 2.1], dir: [-1, 0.2, -0.2], across },
      { at: [tail + 0.05, 3.2, carZ + 2.1], dir: [-1, 0.2, 0.2], across },
    ],
  })

  const movers: Group[] = [...fans]
  if (hinged) movers.push(hinged.nozzle, hinged.ram.root, hinged.ram.rod)
  root.add(kit.mergeStatic(fixed), kit.mergeMoving(moving, movers), drops.root)
  if (wind) root.add(wind.root)

  // The car is wet when its nose reaches the footprint and dry when its tail leaves it.
  const wetFrom = -w / 2 - CAR.length / 2
  const wetSpan = w + CAR.length
  // The one thing that builds up from frame to frame: the wheels' angle.
  let spin = 0

  return {
    root,
    height: top + 0.05,
    beacon,
    update(st) {
      const act = st.running ? st.activity : 0
      spin = (spin + st.dt * SPIN * act) % (Math.PI * 2000)
      // Each wheel starts at its own angle, and neighbors turn opposite ways.
      for (let k = 0; k < fans.length; k++) fans[k].rotation.x = (k % 2 ? -spin : spin) + k * 0.9
      if (hinged) {
        solve(st.carDx, act, hinged.x)
        pose()
      }
      // No air until the wheels are well up to speed.
      const flow = clamp((act - 0.3) / 0.7, 0, 1)
      wind?.setActivity(flow)
      gust?.setActivity(flow)
      if (st.carDx == null || flow === 0) {
        // Off, they wait where they were built, so a machine that is down stays still.
        drops.root.position.x = 0
        drops.setActivity(0)
      } else {
        const through = clamp((st.carDx - wetFrom) / wetSpan, 0, 1)
        drops.root.position.x = st.carDx
        drops.setActivity(flow * Math.min(1, through * 8) * (1 - through))
      }
    },
  }
}
