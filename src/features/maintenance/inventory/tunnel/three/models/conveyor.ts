import { Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import type { BufferAttribute } from 'three'
import { conveyorType } from '../../conveyorType'
import { CAR } from '../car'
import { COLORS } from '../kit'
import type { Paint } from '../kit'
import type { ModelBuilder } from '../types'
import { conveyorBelt } from './conveyorBelt'
import { BEHIND, block, boltHead, chainTexture, chip, clamp, clearOfCar, doorInset, DOOR, flatSteel, outboard, peg, pilotLamp, pitCovers, pusher, PUSHER, PUSHER_PITCH, PUSHERS, pipe, put, ram, smooth, TRACK, trapDoor } from './conveyorParts'

// The conveyor and the two roller assemblies at its ends (MacNeil XR1000 style): an
// over-under chain conveyor that pushes the car by its driver's side tires.
//
// How the real thing works, which is what these three draw. The chain runs the length of
// the tunnel in a narrow slot down the middle of a steel deck, between two low guide
// rails. Pusher rollers hang from it every few feet and ride UNDER the deck. When a car
// has rolled onto the track, the roller-up at the entrance lifts one pusher through a
// trap door so it lands on the deck behind the tire, and that one pusher walks the car
// through the tunnel. At the exit it tips a second trap door, drops, and goes back
// underneath. So the top of the track is not a row of rollers: there is one behind each
// tire of the car and nothing else but the chain creeping along its slot.
//
// Three shapes, three models, one machine. They share the track's numbers
// (conveyorParts.ts) and each works out from the car where its pushers are, so the
// conveyor's pusher comes up exactly where the roller-up's door is lifting, as long as
// the shapes stand where they do on a real conveyor: a roller shape centered doorInset()
// from each end. Everything in the track's line is low enough to drive over; whatever
// stands up (the entrance pedestal, the drive) is outboard of the car.

// Chain links from one pusher to the next.
const LINKS = 12
const COVER: Paint = '#aab0b8'
const DOOR_STEEL: Paint = '#c6cbd1'
const GEARBOX: Paint = '#4b6a99'

// kind 'conveyor': the track, the chain in it and the pushers on it. A shape set to Belt
// (props.conveyor_type) is a different machine with its own model, conveyorBelt.ts; it
// keeps the kind, so the car, the ride and everything else that looks for the conveyor
// still finds it.
export const conveyor: ModelBuilder = (input) => {
  if (conveyorType(input.item.props) === 'belt') return conveyorBelt(input)
  const { kit } = input
  const m = kit.mat
  const high = input.detail === 'high'
  const length = Math.max(6, input.w)
  const x0 = -length / 2
  const x1 = length / 2
  const inset = doorInset(length)
  // The middles of the two trap doors.
  const xu = x0 + inset
  const xd = x1 - inset
  const out = outboard(input.y)
  const doorHalf = DOOR.len / 2 + 0.03
  // The guide rails start this far in: ahead of them the yellow lead-ins funnel the tire.
  const flare = clamp(inset - doorHalf - 0.1, 0.8, 2.6)
  const deckFrom = xu + doorHalf
  const deckTo = xd - doorHalf
  const bed = TRACK.half - 0.13
  const deckWide = bed - TRACK.slot
  const railZ = TRACK.rail + TRACK.railWide / 2

  // ---- Parts that never move ----
  // All of it painted from the sign atlas, so the fixed track is one draw call (and one
  // in the shadow pass). The deck and the edging are plain boxes: they are an inch or two
  // tall and nobody sees their edges. The rail keeps its eased edge, which is the line of
  // light that runs the length of the tunnel.
  const fixed = new Group()
  for (const s of [-1, 1]) {
    // Safety yellow along both edges of the track.
    fixed.add(put(chip(kit, length, 0.07, 0.13, 'yellow'), 0, 0.035, s * (TRACK.half - 0.065)))
    // The deck: a painted steel plate either side of the chain's slot.
    fixed.add(put(chip(kit, deckTo - deckFrom, TRACK.deck, deckWide, 'blue'), (deckFrom + deckTo) / 2, TRACK.deck / 2, s * (TRACK.slot + deckWide / 2)))
    // The guide rail: a low bar on a narrow web, so it throws a line of shadow under it.
    const from = x0 + flare
    const to = x1 - 0.3
    fixed.add(put(kit.paint(kit.box(to - from, 0.15, TRACK.railWide, m.frame, 0.04), 'blue'), (from + to) / 2, TRACK.railTop - 0.075, s * railZ))
    fixed.add(put(chip(kit, to - from - 0.3, 0.09, 0.05, 'blue'), (from + to) / 2, TRACK.deck + 0.04, s * railZ))
    // Under the rails the deck carries on past the doors and covers.
    for (const [a, b] of [[x0 + 0.02, deckFrom], [deckTo, x1 - 0.02]]) {
      fixed.add(put(chip(kit, b - a, TRACK.deck, bed - DOOR.wide / 2 - 0.02, 'blue'), (a + b) / 2, TRACK.deck / 2, s * (bed + DOOR.wide / 2 + 0.02) / 2))
    }
    // The lead-in: a bent yellow pipe from the floor to the rail's nose, which catches a
    // tire that arrives off line and walks it onto the track.
    const mouth = TRACK.half + 0.42
    fixed.add(kit.paint(kit.tube(
      [[x0 - 0.12, 0, s * mouth], [x0 - 0.12, 0.195, s * mouth], [x0 + flare * 0.5, 0.195, s * (railZ + 0.16)], [x0 + flare + 0.3, 0.195, s * railZ]],
      0.062, m.frame, { bend: 0.24, radial: high ? 8 : 6 },
    ), 'yellow'))
    fixed.add(put(kit.paint(kit.cyl(0.13, 0.024, m.frame, { radial: high ? 10 : 7, bevel: 0.006 }), 'yellow'), x0 - 0.12, 0.012, s * mouth))
    fixed.add(put(peg(kit, 0.036, 0.16, 'yellow'), x0 + flare * 0.5, 0.08, s * (railZ + 0.16)))
    // The track is bolted together from ten foot lengths: a joint in the deck and the rail.
    if (high) {
      for (let x = deckFrom + 10; x < deckTo - 3; x += 10) {
        fixed.add(put(chip(kit, 0.028, 0.012, deckWide - 0.03, 'dark'), x, TRACK.deck - 0.003, s * (TRACK.slot + deckWide / 2)))
        fixed.add(put(chip(kit, 0.022, 0.156, TRACK.railWide + 0.006, 'dark'), x, TRACK.railTop - 0.075, s * railZ))
      }
    }
  }

  // Each end: a steel cover over the sprocket, then the trap door a pusher comes up (or
  // goes down) through. The doors here are plain plates; the roller shapes lay their
  // working doors over them.
  const ends: Array<[from: number, to: number, door: number]> = [[x0 + 0.02, xu - doorHalf, xu], [xd + doorHalf, x1 - 0.02, xd]]
  for (const [a, b, door] of ends) {
    const len = b - a
    if (len > 0.3) {
      fixed.add(put(chip(kit, len, TRACK.deck, DOOR.wide, COVER), (a + b) / 2, TRACK.deck / 2, 0))
      if (high) {
        for (const bx of [a + 0.12, b - 0.12]) for (const bz of [-1, 1]) fixed.add(put(boltHead(kit, 'mid', 0.026), bx, TRACK.deck, bz * (DOOR.wide / 2 - 0.1)))
      }
    }
    // The dark of the pit shows around the door plate.
    fixed.add(put(chip(kit, doorHalf * 2, 0.02, DOOR.wide, 'black'), door, 0.01, 0))
    fixed.add(put(chip(kit, DOOR.len, TRACK.deck, DOOR.wide - 0.04, DOOR_STEEL), door, TRACK.deck / 2, 0))
  }

  // The maker's plate, on the take-up cover where the tire rolls over it.
  const coverLen = xu - doorHalf - x0
  if (coverLen > 1.2) {
    const plateLen = Math.min(1.7, coverLen - 0.5)
    const plate = kit.sign(input.item.label || 'Conveyor', plateLen, Math.min(0.3, plateLen * 0.2))
    plate.rotation.x = -Math.PI / 2
    fixed.add(put(plate, x0 + coverLen / 2, TRACK.deck + 0.004, 0))
  }

  // Where the status light stands: on a floor plate beside the track near the entrance,
  // outboard, where the car's body never reaches.
  const beacon = { x: x0 + Math.min(9, length * 0.15), y: 0.05, z: out * Math.max(TRACK.half + 0.3, clearOfCar(input.y, 0.5)) }
  fixed.add(put(kit.paint(kit.plate(0.56, 0.56, 0.05, m.frame, 0.09), COVER), beacon.x, 0, beacon.z))
  if (high) for (const bx of [-1, 1]) for (const bz of [-1, 1]) fixed.add(put(boltHead(kit), beacon.x + bx * 0.19, 0.05, beacon.z + bz * 0.19))

  // ---- The chain ----
  // One strip of picture down the slot. It belongs to this model alone, so the model
  // may slide it (the kit's shared materials are never touched).
  const chainFrom = deckFrom - 0.05
  const chainLen = deckTo - deckFrom + 0.1
  const chainGeo = new PlaneGeometry(chainLen, TRACK.slot * 2 + 0.02)
  chainGeo.rotateX(-Math.PI / 2)
  const uv = chainGeo.attributes.uv as BufferAttribute
  for (let k = 0; k < uv.count; k++) uv.setX(k, (uv.getX(k) * chainLen) / PUSHER_PITCH)
  const chainTex = chainTexture(LINKS)
  const chainMat = new MeshStandardMaterial({ map: chainTex, roughness: 0.42, metalness: 0.45 })
  chainMat.name = 'conveyor-chain'
  const chain = new Mesh(chainGeo, chainMat)
  chain.receiveShadow = true
  chain.position.set(chainFrom + chainLen / 2, TRACK.deck - 0.016, 0)

  // ---- The pushers ----
  const moving = new Group()
  const pushers = [pusher(kit), pusher(kit)]
  for (const p of pushers) {
    moving.add(p)
    kit.blob(p, 0.3, 0.96, { shape: 'box', cast: PUSHER.r * 2, soft: 0.16, contact: 1 })
  }

  const root = new Group()
  root.name = 'conveyor'
  root.add(kit.mergeStatic(fixed), chain, kit.mergeMoving(moving, pushers))
  kit.pickBox(root, length + 0.3, 0.4, TRACK.half * 2 + 0.1, 0, 0.2, 0)

  const rise = PUSHER.riseTo - PUSHER.riseFrom
  const dive = PUSHER.diveTo - PUSHER.diveFrom
  const upHinge = xu - DOOR.len / 2
  const downHinge = xd - DOOR.len / 2
  const pose = (running: boolean, t: number, carDx: number | null) => {
    // The chain keeps step with the car, which it is carrying: the link a pusher hangs
    // from stays under the pusher. With no car it simply runs.
    const travel = carDx != null ? carDx + PUSHERS[0] - chainFrom : running ? t * CAR.speed : 0
    const u = travel / PUSHER_PITCH - 0.5 / LINKS
    chainTex.offset.x = Math.floor(u) - u
    // A pusher is on the deck only near the two doors: the rest of the time the pair is
    // under it and costs nothing.
    moving.visible = false
    for (let k = 0; k < pushers.length; k++) {
      const p = pushers[k]
      const x = carDx == null ? 0 : carDx + PUSHERS[k]
      const up = x - upHinge
      const down = x - downHinge
      if (!running || carDx == null || up < PUSHER.riseFrom || down > PUSHER.diveTo) {
        // Under the deck, out of sight: small enough that its shadow goes too.
        p.position.set(x0, -2, 0)
        p.scale.setScalar(0.0004)
        continue
      }
      const sunk = 1 - smooth((up - PUSHER.riseFrom) / rise) + smooth((down - PUSHER.diveFrom) / dive)
      p.position.set(x, TRACK.deck + PUSHER.r - PUSHER.depth * sunk, 0)
      p.scale.setScalar(1)
      moving.visible = true
    }
  }
  pose(false, 0, null)

  return {
    root,
    height: TRACK.railTop + 0.05,
    beacon,
    update: (st) => pose(st.running, st.t, st.carDx),
    dispose() {
      chainTex.dispose()
      chainMat.dispose()
    },
  }
}

// How far the entrance door lifts for a pusher whose axle is r feet past the door's
// upstream edge. It opens as the pusher climbs out under its far end and claps shut
// behind it, and it never lifts into the tire the pusher is following.
const OPEN = 0.66
function flapAngle(r: number): number {
  const want = OPEN * smooth((r - 0.35) / 0.55) * (1 - smooth((r - 1.0) / 0.22))
  if (want <= 0) return 0
  // From the door's free edge to the wheel's center, and how high the tire's back
  // stands there.
  const gap = r + BEHIND - DOOR.len
  if (gap >= CAR.wheelRadius) return want
  const room = CAR.wheelRadius - Math.sqrt(CAR.wheelRadius * CAR.wheelRadius - gap * gap) - 0.03
  return Math.min(want, Math.asin(clamp(room / DOOR.len, 0, 1)))
}

// The fork that lifts a pusher is called up a moment before the pusher reaches the door
// and let go once it is through.
function forkCall(r: number): number {
  return smooth((r + 1.3) / 0.3) * (1 - smooth((r - 1.05) / 0.35))
}

// kind 'roller_up': the entrance end. A correlator the tire slides sideways on, the pit
// covers, the trap door a pusher comes up through, the air cylinders that call it, and
// the attendant's pedestal.
export const rollerUp: ModelBuilder = (input) => {
  const { kit } = input
  const m = kit.mat
  const high = input.detail === 'high'
  const w = Math.max(3, input.w)
  const h = Math.max(2.2, input.h)
  const out = outboard(input.y)
  const hinge = -DOOR.len / 2

  const fixed = new Group()
  fixed.add(pitCovers(kit, { w, h, bolts: high }))
  const door = trapDoor(kit)
  door.frame.position.x = hinge
  door.flap.position.x = hinge
  fixed.add(door.frame)

  // The correlator, upstream of the pit: a flush bed of stainless rollers lying along
  // the lane, so a tire that arrives off line slides sideways onto the track's line.
  const bedLen = 6
  const bedTo = -w / 2 - 0.3
  const bedFrom = bedTo - bedLen
  const bedHalf = 1.04
  const bays = high ? 3 : 2
  const perBay = high ? 7 : 4
  const bayLen = bedLen / bays
  fixed.add(put(chip(kit, bedLen - 0.1, 0.012, bedHalf * 2 - 0.1, 'black'), (bedFrom + bedTo) / 2, 0.006, 0))
  for (const s of [-1, 1]) fixed.add(put(chip(kit, bedLen, 0.1, 0.09, 'yellow'), (bedFrom + bedTo) / 2, 0.05, s * bedHalf))
  for (let b = 0; b <= bays; b++) fixed.add(put(chip(kit, 0.1, 0.1, bedHalf * 2 - 0.09, 'yellow'), bedFrom + b * bayLen + (b === 0 ? 0.05 : b === bays ? -0.05 : 0), 0.05, 0))
  for (let b = 0; b < bays; b++) {
    for (let k = 0; k < perBay; k++) {
      // The ends of each roller sit in the frame: no caps.
      fixed.add(put(pipe(0.042, bayLen - 0.1, m.stainless, high ? 7 : 5, true), bedFrom + (b + 0.5) * bayLen, 0.054, -bedHalf + 0.15 + (k * (bedHalf * 2 - 0.3)) / (perBay - 1)))
    }
  }
  // Its side guides: low yellow pipes that open out toward the cars coming in.
  for (const s of [-1, 1]) {
    fixed.add(kit.paint(kit.tube(
      [[bedFrom - 0.45, 0, s * (bedHalf + 0.5)], [bedFrom - 0.45, 0.2, s * (bedHalf + 0.5)], [bedFrom + 1.5, 0.2, s * bedHalf], [bedFrom + bedLen * 0.62, 0.2, s * bedHalf], [bedFrom + bedLen * 0.62, 0.06, s * bedHalf]],
      0.05, m.frame, { bend: 0.2, radial: 6 },
    ), 'yellow'))
  }

  // The fork's air cylinders, outboard of the door. They push a crank on the cross shaft
  // that lifts the fork under the deck.
  const zc = out * Math.max(TRACK.half + 0.38, clearOfCar(input.y, 0.3) + 0.2)
  const sx = hinge + 0.15
  const sy = 0.24
  const ARM = 0.28
  const REST = 0.42
  const FIRED = -0.3
  const baseX = sx - 1.62
  const baseY = sy + 0.26
  const shaftFrom = out * (TRACK.half + 0.06)
  const shaftTo = zc + out * 0.34
  const shaft = pipe(0.04, Math.abs(shaftTo - shaftFrom), m.stainless, high ? 8 : 6)
  shaft.rotation.y = Math.PI / 2
  fixed.add(put(shaft, sx, sy, (shaftFrom + shaftTo) / 2))
  for (const z of [shaftFrom + out * 0.05, shaftTo - out * 0.05]) {
    fixed.add(put(chip(kit, 0.24, sy + 0.06, 0.09, 'dark'), sx, (sy + 0.06) / 2 + 0.05, z))
  }
  fixed.add(put(chip(kit, 0.2, baseY - 0.05, 0.5, COLORS.galvanized), baseX - 0.02, 0.05 + (baseY - 0.05) / 2, zc))
  const moving = new Group()
  const crank = new Group()
  crank.position.set(sx, sy, 0)
  // Two rams, as MacNeil builds it; one does the job on a phone.
  const rams = (high ? [-0.13, 0.13] : [0]).map((dz) => {
    const z = zc + dz
    crank.add(put(block(0.07, ARM + 0.12, 0.045, m.stainless), 0, ARM / 2, z))
    const r = ram({ body: 0.95, stroke: 0.32, bore: 0.07, mat: m.stainless })
    moving.add(r.root)
    return { ram: r, z }
  })
  moving.add(crank, door.flap)
  // Their air: a black line along the plate from the valve on the pedestal.
  const px = w / 2 - 0.7
  const pz = out * Math.max(h / 2 - 0.2, clearOfCar(input.y, 0.7))
  fixed.add(kit.paint(kit.tube([[px - 0.12, 0.75, pz], [px - 0.12, 0.09, pz], [baseX - 0.16, 0.09, pz], [baseX - 0.16, 0.09, zc], [baseX - 0.16, baseY, zc]], 0.022, m.frame, { bend: 0.12, radial: 5 }), 'hoseBlack'))

  // The pedestal: where the attendant stands to load cars, with the roller-up button
  // and an emergency stop.
  const POST = 3.0
  const BOX = 0.8
  const boxY = POST + BOX / 2 - 0.1
  const top = POST + BOX - 0.06
  // The buttons face the lane.
  const face = -out
  const faceZ = pz + face * 0.15
  fixed.add(put(kit.basePlate(0.62, 0.62, { mat: m.stainless, bolts: high }), px, 0, pz))
  fixed.add(kit.beam([px, 0.06, pz], [px, POST, pz], 0.2, m.stainless))
  fixed.add(put(kit.box(0.62, BOX, 0.3, m.stainless, 0.03), px, boxY, pz))
  fixed.add(put(block(0.72, 0.04, 0.42, m.stainless), px, top, pz + face * 0.03))
  fixed.add(put(chip(kit, 0.3, 0.34, 0.22, 'dark'), px, 0.78, pz))
  const button = (x: number, y: number, r: number, depth: number, color: Paint) => {
    const b = peg(kit, r, depth, color, high ? 10 : 6)
    b.rotation.x = (face * Math.PI) / 2
    fixed.add(put(b, x, y, faceZ + face * (depth / 2)))
  }
  button(px + 0.15, boxY - 0.17, 0.095, 0.012, 'yellow')
  button(px + 0.15, boxY - 0.17, 0.062, 0.08, 'red')
  button(px - 0.15, boxY - 0.17, 0.055, 0.05, 'green')
  if (high) button(px - 0.15, boxY + 0.03, 0.035, 0.04, 'black')
  const plate = kit.sign(input.item.label || 'Roller Up', 0.54, 0.15)
  plate.rotation.y = face > 0 ? 0 : Math.PI
  fixed.add(put(plate, px, boxY + 0.25, faceZ + face * 0.004))
  // A pilot light on the box: lit while the fork is up. Its dark lens goes in with the
  // fixed parts, so it costs a draw call only while it is lit.
  const pilot = pilotLamp(kit, fixed, 0.042, [px + 0.15, boxY + 0.03, faceZ], (face * Math.PI) / 2)

  const pose = (open: number, call: number) => {
    door.flap.rotation.z = open
    const a = REST + (FIRED - REST) * call
    crank.rotation.z = a
    const pinX = sx - ARM * Math.sin(a)
    const pinY = sy + ARM * Math.cos(a)
    for (let k = 0; k < rams.length; k++) rams[k].ram.aim(baseX, baseY, rams[k].z, pinX, pinY, rams[k].z)
    pilot.visible = call > 0.5
  }
  // Rest is the pose the moving parts are merged in.
  pose(0, 0)

  const root = new Group()
  root.name = 'roller-up'
  root.add(kit.mergeStatic(flatSteel(kit, fixed)), kit.mergeMoving(flatSteel(kit, moving), [crank, door.flap, ...rams.flatMap((r) => [r.ram.root, r.ram.rod])]), pilot)
  // The plates (a little taller than the conveyor's own shape, so a pointer over them
  // finds this machine), the correlator, the pedestal.
  kit.pickBox(root, w, 0.6, h, 0, 0.3, 0)
  kit.pickBox(root, bedLen + 0.6, 0.45, bedHalf * 2 + 0.5, (bedFrom + bedTo) / 2 - 0.2, 0.225, 0)
  kit.pickBox(root, 0.8, top, 0.6, px, top / 2, pz)

  return {
    root,
    height: top + 0.02,
    beacon: { x: px, y: top + 0.02, z: pz },
    update(st) {
      let open = 0
      let call = 0
      if (st.running && st.carDx != null) {
        for (let k = 0; k < PUSHERS.length; k++) {
          const r = st.carDx + PUSHERS[k] - hinge
          open = Math.max(open, flapAngle(r))
          call = Math.max(call, forkCall(r))
        }
      }
      pose(open, call)
    },
  }
}

// How far the exit door tips for a pusher r feet past its upstream edge: it gives way
// under the pusher, which rolls down it into the pit, and swings back up behind.
function tipAngle(r: number): number {
  if (r <= PUSHER.diveFrom) return 0
  const drop = PUSHER.depth * smooth((r - PUSHER.diveFrom) / (PUSHER.diveTo - PUSHER.diveFrom))
  return Math.atan2(drop, Math.max(r, 0.3)) * (1 - smooth((r - 0.85) / 0.45))
}

// The drive sprocket's radius: 15 inches across.
const SPROCKET = 0.625

// kind 'roller_down': the exit end. The pit covers, the trap door pushers drop through,
// and the drive: the sprocket shaft coming out from under the track to a right-angle gear
// reducer and its motor, with the toothed wheel the pulse switch counts.
export const rollerDown: ModelBuilder = (input) => {
  const { kit } = input
  const m = kit.mat
  const high = input.detail === 'high'
  const w = Math.max(3, input.w)
  const h = Math.max(2.2, input.h)
  const out = outboard(input.y)
  const hinge = -DOOR.len / 2

  const fixed = new Group()
  fixed.add(pitCovers(kit, { w, h, bolts: high }))
  const door = trapDoor(kit)
  door.frame.position.x = hinge
  door.flap.position.x = hinge
  fixed.add(door.frame)

  // The drive, outboard of the track and of the car. Along the shaft from the track:
  // the sprocket's guard, a bearing, the pulse wheel, the reducer. The motor lies along
  // the tunnel, pointing back upstream.
  const zMin = Math.max(TRACK.half + 0.04, clearOfCar(input.y, 0.3))
  const sx = clamp(w / 2 - 1.45, DOOR.len / 2 + 0.45, 1.55)
  const sy = 0.42
  const zBearing = out * (zMin + 0.13)
  const zWheel = out * (zMin + 0.32)
  const zGear = out * (zMin + 0.74)
  // All of the drive is painted from the sign atlas (the motor included), so the fixed
  // parts are one draw call. Only the parts that stand up keep an eased edge.
  const galv = COLORS.galvanized
  fixed.add(put(kit.paint(kit.box(0.74, 0.36, 0.12, m.frame, 0.04), 'yellow'), sx, 0.18, out * (TRACK.half + 0.02)))
  const zFrom = out * (TRACK.half - 0.02)
  const zTo = zGear - out * 0.28
  const shaft = peg(kit, 0.055, Math.abs(zTo - zFrom), DOOR_STEEL, high ? 10 : 6)
  shaft.rotation.x = Math.PI / 2
  fixed.add(put(shaft, sx, sy, (zFrom + zTo) / 2))
  // The bearing on its riser.
  fixed.add(put(chip(kit, 0.4, sy - 0.2, 0.16, galv), sx, 0.05 + (sy - 0.2) / 2, zBearing))
  fixed.add(put(chip(kit, 0.36, 0.2, 0.13, 'dark'), sx, sy - 0.06, zBearing))
  const housing = peg(kit, 0.15, 0.15, 'dark', high ? 12 : 8)
  housing.rotation.x = Math.PI / 2
  fixed.add(put(housing, sx, sy, zBearing))
  // The reducer, on a plate with the motor.
  fixed.add(put(chip(kit, 2.0, 0.05, 0.74, galv), sx - 0.62, 0.087, zGear))
  if (high) for (const bx of [-1.5, 0.28]) for (const bz of [-0.3, 0.3]) fixed.add(put(boltHead(kit), sx + bx, 0.112, zGear + bz))
  fixed.add(put(kit.paint(kit.box(0.6, 0.6, 0.56, m.frame, 0.08), GEARBOX), sx, sy, zGear))
  const flange = peg(kit, 0.2, 0.07, GEARBOX, high ? 12 : 8)
  flange.rotation.x = Math.PI / 2
  fixed.add(put(flange, sx, sy, zGear - out * 0.3))
  const adapter = peg(kit, 0.22, 0.08, GEARBOX, high ? 12 : 8)
  adapter.rotation.z = Math.PI / 2
  fixed.add(put(adapter, sx - 0.33, sy, zGear))
  if (high) fixed.add(put(peg(kit, 0.035, 0.07, 'brass'), sx + 0.12, sy + 0.33, zGear))
  for (const bx of [-0.2, 0.2]) fixed.add(put(chip(kit, 0.14, 0.08, 0.66, GEARBOX), sx + bx, 0.15, zGear))
  // The motor lies down, its shaft into the reducer, its terminal box toward the lane.
  const motor = high ? kit.motor({ r: 0.23, len: 0.78, gearbox: false }) : new Group().add(put(peg(kit, 0.24, 0.9, COLORS.motor, 8), 0, 0.45, 0))
  motor.traverse((o) => { if ((o as Mesh).isMesh) kit.paint(o as Mesh, COLORS.motor) })
  motor.rotation.set(out > 0 ? Math.PI : 0, 0, Math.PI / 2)
  fixed.add(put(motor, sx - 0.37, sy, zGear))
  fixed.add(put(chip(kit, 0.46, sy - 0.33, 0.36, galv), sx - 0.85, 0.11 + (sy - 0.33) / 2, zGear))
  // Power: flexible conduit from the terminal box to the floor.
  const tbx = sx - 0.37 - 0.78 * 0.55
  const tbz = zGear - out * 0.32
  fixed.add(kit.paint(kit.tube([[tbx, sy + 0.02, tbz], [tbx, sy + 0.3, tbz - out * 0.1], [tbx - 0.75, sy + 0.25, tbz], [tbx - 0.95, 0.06, tbz]], 0.03, m.frame, { bend: 0.2, radial: 5 }), 'hoseBlack'))
  // The pulse switch: a proximity sensor looking at the wheel's teeth.
  fixed.add(put(chip(kit, 0.05, sy + 0.12, 0.05, galv), sx + 0.44, 0.05 + (sy + 0.12) / 2, zWheel))
  const eye = peg(kit, 0.032, 0.2, '#f08a24')
  eye.rotation.z = Math.PI / 2
  fixed.add(put(eye, sx + 0.38, sy, zWheel))

  // The label lies on the inboard cover, where there is nothing else.
  const inner = TRACK.half + 0.04
  const coverWide = Math.max(inner + 0.3, h / 2 - 0.09) - inner
  const plateLen = Math.min(1.8, w - 1)
  const plate = kit.sign(input.item.label || 'Roller Down', plateLen, Math.min(0.3, coverWide - 0.16))
  plate.rotation.x = -Math.PI / 2
  fixed.add(put(plate, -w / 2 + plateLen / 2 + 0.5, 0.054, -out * (inner + coverWide / 2)))

  // ---- What moves: the door and the pulse wheel ----
  const moving = new Group()
  const wheel = new Group()
  wheel.position.set(sx, sy, zWheel)
  const disc = kit.cyl(0.21, 0.04, m.stainless, { radial: high ? 14 : 8, bevel: 0.008 })
  disc.rotation.x = Math.PI / 2
  wheel.add(disc)
  const hub = pipe(0.09, 0.09, m.stainless, high ? 8 : 6)
  hub.rotation.y = Math.PI / 2
  wheel.add(hub)
  const teeth = high ? 8 : 6
  for (let k = 0; k < teeth; k++) {
    const a = (k / teeth) * Math.PI * 2
    const tooth = block(0.09, 0.07, 0.04, m.stainless)
    tooth.rotation.z = a
    wheel.add(put(tooth, Math.cos(a) * 0.235, Math.sin(a) * 0.235, 0))
  }
  moving.add(wheel, door.flap)

  const root = new Group()
  root.name = 'roller-down'
  root.add(kit.mergeStatic(fixed), kit.mergeMoving(flatSteel(kit, moving), [wheel, door.flap]))
  kit.pickBox(root, w, 0.6, h, 0, 0.3, 0)
  kit.pickBox(root, 2.2, sy + 0.5, 1.0, sx - 0.6, (sy + 0.5) / 2, zGear - out * 0.1)

  return {
    root,
    height: sy + 0.36,
    // In the tunnel the status light stands on the floor at the exit end, beside the lane
    // on the passenger side, clear of the car and its mirrors even at the size it grows to
    // from far off. The overview looks down the tunnel from the entrance end on the
    // passenger side, and the Dryers always stand just upstream: on the drive, or anywhere
    // near it on the driver's side, the light hid behind them. Beside the tunnel root
    // stands at the spare's own y and turns with it, so a spot measured from the lane
    // would land back in the tunnel; a spare has no car or Dryers to clear, so its light
    // sits on its own reducer.
    beacon: input.side === 'outside' ? { x: sx, y: sy + 0.3, z: zGear } : { x: w / 2 + 0.5, y: 0, z: CAR.z + CAR.width / 2 + 1 - input.y },
    // The tone cap has nothing to be seen past: it stays on the reducer, where it reads as
    // this machine's. At the light's spot in the tunnel it stood on the floor across the
    // lane from the pad.
    cap: { x: sx, y: sy + 0.3, z: zGear },
    update(st) {
      let tip = 0
      if (st.running && st.carDx != null) {
        for (let k = 0; k < PUSHERS.length; k++) tip = Math.max(tip, tipAngle(st.carDx + PUSHERS[k] - hinge))
      }
      door.flap.rotation.z = -tip
      // The wheel turns with the chain, which keeps step with the car it carries.
      if (st.running) wheel.rotation.z = -(st.carDx ?? st.t * CAR.speed) / SPROCKET
    },
  }
}
