import { Box3, Group } from 'three'
import { CAR } from '../car'
import { COLORS } from '../kit'
import type { ModelBuilder } from '../types'
import { CORE, foot, gearmotor, LIMP, limpBox, park, slim } from './brushParts'

// A wrap-around (MacNeil RS-701 SuperFlex): a tall foam brush on a two-piece swinging
// arm, hung from a portal frame. It washes half the car's front, one whole side and half
// its rear: the brush waits near the car's centerline, the nose pushes it aside, it rides
// along the side, then swings in behind the tail. A driver's side and a passenger side
// wrap mirror each other. Off, or with no car near, the arm folds back along the wall
// and the foam hangs limp.
//
// THE PATTERN every model follows:
//   1. Work out the few numbers the shape depends on (side, where the walls are).
//   2. Build the parts that never move into one group and merge it (kit.mergeStatic).
//   3. Build the parts that move into groups you keep hold of, pose them at rest, and
//      merge them too (kit.mergeMoving): the merged mesh follows those groups.
//   4. Add pick shapes around the solid parts, and a blob under what moves (it casts no
//      real shadow): kit.blob with cast set to its height.
//   5. In update(), turn RunState into a pose with plain arithmetic: no allocation, and
//      no memory of the last frame, so any moment can be drawn on its own. Never assign
//      a material there: show and hide parts instead.
//   6. In dispose(), free what only this model owns (the brush). The scene frees the
//      geometry, the kit the shared materials.
//
// The scene never turns a machine that stands in the tunnel, so local +X is always the
// way cars go and local z = world z - input.y (see `local` below).
//
// Beside the tunnel a wrap is a spare, or one waiting to be put in: no car to reach for.
// It is drawn whole and parked on its own footprint (brushParts.ts, park): the portal as
// wide as the footprint instead of the tunnel, the arm folded inside it, the foam still.

const HEADER = 10.2 // top of the cross beam
const TUBE = 0.42 // 5 in square tube
const ARM_Y = 8.42 // the main arm's centerline
const FORE_Y = 8.0 // the second arm's, one step lower
const FOAM_LO = 0.5
const FOAM_HI = 7.5
// The car's corners, as far as the brush's path is concerned. Rounder than the real
// thing so the brush swings around them in one smooth motion.
const CORNER = 2.0
// How far past the car's centerline the brush waits, in feet.
const HOME_PAST = 0.5

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const wrap: ModelBuilder = (input) => {
  const { kit, tunnelWidth } = input
  const m = kit.mat
  const beside = input.side === 'outside'
  // +1: this wrap hangs from the passenger side. -1: the driver's side. Beside the tunnel,
  // the side of the tunnel it is on.
  const s = input.side === 'ps' ? 1 : input.side === 'ds' ? -1 : input.y >= 0 ? 1 : -1
  // The model's origin is its footprint's center, which is off the tunnel's centerline.
  const local = (zWorld: number) => zWorld - input.y
  const radius = clamp(Math.min(input.w, input.h), 3.5, 6) / 2
  // Pressed against the car the foam is squeezed to about half its reach.
  const press = radius * 0.5
  const carZ = local(CAR.z)
  // A spare's legs stand on the footprint's edges, their plates just inside, with room
  // between them for the folded brush whatever the footprint.
  const span = Math.max(input.h / 2 - 0.46, 1.6)
  const legNear = beside ? s * span : local(s * (tunnelWidth / 2 - 0.5))
  const legFar = beside ? -s * span : local(-s * (tunnelWidth / 2 - 0.5))
  const shoulderZ = beside ? legNear - s : local(s * (tunnelWidth / 2 - 1.5))

  // ---- The brush's path around the car ----
  // Measured from the car: u along it from its center (nose at +halfLen), q out from its
  // centerline toward this wrap's wall. The path is the car's outline pushed out by
  // `press`: across half the nose, around the corner, down the side, around the tail.
  const halfLen = CAR.length / 2
  const halfWid = CAR.width / 2
  const A = halfLen + press
  const B = halfWid + press
  const bend = CORNER + press
  const face = halfWid - CORNER + HOME_PAST
  const arc = (bend * Math.PI) / 2
  const flank = 2 * (halfLen - CORNER)
  const nose = face + arc
  // The car travels 2A while the brush is on it. The brush gets around the nose in the
  // first part of that and the tail in the last, drifting downstream with the car each
  // time and making it back upstream along the side.
  const travel = 2 * A
  const d1 = travel * 0.29
  const d3 = travel * 0.27
  const d2 = travel - d1 - d3

  // ---- The arm ----
  // Long enough to reach the waiting spot past the centerline. The passenger side arm
  // comes out longer because the car rides nearer the driver's side. A spare's folds
  // inside its footprint: the main arm reaches nearly to one end, the cylinder's
  // outrigger to the other.
  const homeIn = -s * (carZ - s * HOME_PAST - shoulderZ)
  const reach = beside ? clamp((input.w / 2 - 0.36) / 0.59, 3.4, 7.5) : Math.hypot(homeIn, 1.5) + 0.35
  const L1 = reach * 0.59
  const L2 = reach * 0.41
  // Folded: the main arm along the wall, the second arm doubled back beside it.
  const FOLD = 0.35
  const restX = L1 - L2 * Math.cos(FOLD)
  const restZ = shoulderZ - s * L2 * Math.sin(FOLD)
  // Where the air cylinder pushes the main arm: a lug partway along, standing off its side.
  const LUG = L1 * 0.35
  const TAB = 0.42
  const ramX = beside ? -Math.min(2.4, L1) : -2.4
  const ramZ = legNear - s * 0.42

  // The pose, worked out by solve() and applied by pose(): where the brush's shaft is
  // (bx, bz), which way the two arms point (th1, th2), the elbow (ex, ez), the lug the
  // cylinder pushes (lugX, lugZ), and the plane the foam is pressed against (cnx, cnz:
  // its normal, cd: how far from the shaft). Kept as plain numbers so a frame allocates
  // nothing.
  let bx = 0
  let bz = 0
  let th1 = 0
  let th2 = 0
  let ex = 0
  let ez = 0
  let lugX = 0
  let lugZ = 0
  let cnx = 0
  let cnz = 0
  let cd = 1e4

  const solve = (carDx: number | null, activity: number) => {
    // Where the path wants the brush. Before and after the car it's the waiting spot.
    let wx = 0
    let wq = -HOME_PAST
    if (carDx != null) {
      const p = carDx + A
      if (p > 0 && p < travel) {
        const along = p < d1 ? (p / d1) * nose : p < d1 + d2 ? nose + ((p - d1) / d2) * flank : nose + flank + ((p - d1 - d2) / d3) * nose
        let u: number
        if (along < face) {
          u = A
          wq = -HOME_PAST + along
        } else if (along < nose) {
          const f = (along - face) / bend
          u = halfLen - CORNER + bend * Math.cos(f)
          wq = halfWid - CORNER + bend * Math.sin(f)
        } else if (along < nose + flank) {
          u = halfLen - CORNER - (along - nose)
          wq = B
        } else if (along < nose + flank + arc) {
          const f = Math.PI / 2 + (along - nose - flank) / bend
          u = -(halfLen - CORNER) + bend * Math.cos(f)
          wq = halfWid - CORNER + bend * Math.sin(f)
        } else {
          u = -A
          wq = halfWid - CORNER - (along - nose - flank - arc)
        }
        wx = carDx + u
      }
    }
    // activity swings the arm between folded (0) and on the path (1).
    const k = activity * activity * (3 - 2 * activity)
    let x = restX + (wx - restX) * k
    let z = restZ + (carZ + s * wq - restZ) * k

    // Two-link arm: the shoulder is fixed, find the elbow. `in` runs from the shoulder
    // toward the middle of the tunnel.
    let tIn = -s * (z - shoulderZ)
    let tx = x
    const want = Math.hypot(tIn, tx)
    const dist = clamp(want, Math.abs(L1 - L2) + 0.05, L1 + L2 - 0.02)
    if (want > 1e-6 && dist !== want) {
      tIn *= dist / want
      tx *= dist / want
      x = tx
      z = shoulderZ - s * tIn
    }
    // The elbow always sits downstream of the line from shoulder to brush, so the arm
    // trails the way cars travel.
    th1 = Math.atan2(tx, tIn) + Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1))
    const eIn = L1 * Math.cos(th1)
    ex = L1 * Math.sin(th1)
    ez = shoulderZ - s * eIn
    th2 = Math.atan2(tx - ex, tIn - eIn)
    bx = x
    bz = z
    lugX = LUG * Math.sin(th1) + TAB * Math.cos(th1)
    lugZ = shoulderZ - s * (LUG * Math.cos(th1) - TAB * Math.sin(th1))

    // What the foam is pressed against: the nearest point of the car's outline, as a
    // plane facing the brush.
    cd = 1e4
    if (carDx != null) {
      const u = bx - carDx
      const v = bz - carZ
      const ax = Math.abs(u) - (halfLen - CORNER)
      const az = Math.abs(v) - (halfWid - CORNER)
      let gx = 0
      let gz = 0
      let gap: number
      if (ax > 0 && az > 0) {
        const len = Math.hypot(ax, az)
        gap = len - CORNER
        gx = (Math.sign(u) * ax) / len
        gz = (Math.sign(v) * az) / len
      } else if (ax > az) {
        gap = ax - CORNER
        gx = Math.sign(u)
      } else {
        gap = az - CORNER
        gz = Math.sign(v)
      }
      if (gap < radius + 0.5) {
        cnx = -gx
        cnz = -gz
        // A little shy of the paint, and never folded flat onto the drum.
        cd = Math.max(0.55, gap - 0.12)
      }
    }
  }

  // ---- Parts that never move ----
  const fixed = new Group()
  const moving = new Group()
  // The legs stand on plain plates: the kit's, with their rounded corners, cost more
  // triangles than the legs and header together.
  fixed.add(kit.portalFrame({ z1: legNear, z2: legFar, height: HEADER, tube: TUBE, feet: false }))
  for (const z of [legNear, legFar]) foot(kit, fixed, moving, 0, z, TUBE + 0.62, TUBE + 0.5)
  // The hanger the arm pivots under, with a gusset back to the header.
  const hangTop = HEADER - TUBE
  fixed.add(kit.beam([0, ARM_Y + 0.2, shoulderZ], [0, hangTop, shoulderZ], 0.34, m.frame))
  const hangGusset = kit.gusset(0.6, 0.05, m.frame)
  hangGusset.position.set(0, hangTop, shoulderZ - s * 0.17)
  hangGusset.rotation.y = (s * Math.PI) / 2
  hangGusset.scale.y = -1
  fixed.add(hangGusset)
  // The outrigger the air cylinder is pinned to, braced back to the leg.
  fixed.add(kit.beam([-TUBE / 2, ARM_Y, legNear - s * 0.16], [ramX - 0.25, ARM_Y, legNear - s * 0.16], [0.2, 0.2], m.frame))
  fixed.add(kit.beam([ramX, ARM_Y - 0.1, legNear - s * 0.16], [-TUBE / 2, ARM_Y - 1.5, legNear - s * 0.16], [0.14, 0.14], m.frame))
  fixed.add(kit.box(0.16, 0.26, 0.2, m.frame, 0.02).translateX(ramX).translateY(ARM_Y).translateZ(legNear - s * 0.34))

  // The spray bar on the near leg: a stainless pipe with a row of nozzles aimed at the
  // brush, fed by a white poly line that comes down from the header.
  const barX = -TUBE / 2 - 0.16
  const barZ = legNear - s * (TUBE / 2 + 0.14)
  fixed.add(kit.tube([[barX, 1.1, barZ], [barX, 7.3, barZ]], 0.05, m.stainless, { radial: 10 }))
  const aim = Math.hypot(0.35, 1)
  const nozzles: Array<{ at: [number, number, number]; dir: [number, number, number] }> = []
  for (let k = 0; k < 5; k++) {
    const y = 1.6 + k * 1.3
    const dx = 0.35 / aim
    const dz = -s / aim
    fixed.add(kit.paint(kit.rod([barX, y, barZ], [barX + dx * 0.2, y, barZ + dz * 0.2], 0.035, m.stainless), 'brass'))
    nozzles.push({ at: [barX + dx * 0.22, y, barZ + dz * 0.22], dir: [dx, -0.06, dz] })
    if (k % 2 === 0) fixed.add(kit.beam([barX, y + 0.45, barZ], [-TUBE / 2 + 0.02, y + 0.45, legNear - s * (TUBE / 2 - 0.02)], [0.07, 0.1], m.frame, 0.015))
  }
  // Small colored parts are painted from the sign atlas (kit.paint), so the red
  // fitting, the brass nozzles and the hoses share one draw call.
  fixed.add(kit.paint(kit.cyl(0.07, 0.16, m.stainless, { radial: 10 }), 'red').translateX(barX).translateY(7.38).translateZ(barZ))
  const feedY = hangTop - 0.12
  const feed = kit.tube([[barX, 7.46, barZ], [barX, feedY, barZ], [barX, feedY, barZ - s * 2.2], [barX + 0.25, feedY, barZ - s * 2.6]], 0.03, m.stainless, { bend: 0.3, radial: 6 })
  fixed.add(kit.paint(feed, 'hoseWhite'))
  // The air line to the cylinder hangs in a loop from the header.
  fixed.add(kit.paint(kit.hose([-0.1, hangTop - 0.04, shoulderZ + s * 0.45], [ramX + 0.2, ARM_Y + 0.14, ramZ], 0.028, m.stainless, 0.16), 'hoseBlue'))
  // Its controls: a small junction box on the leg and the conduit up to the header.
  const boxZ = legNear - s * (TUBE / 2 + 0.1)
  fixed.add(kit.paint(kit.box(0.5, 0.7, 0.2, m.frame, 0.03), 'dark').translateX(0.02).translateY(4.7).translateZ(boxZ))
  fixed.add(kit.tube([[0.1, 5.05, boxZ], [0.1, hangTop - 0.05, boxZ]], 0.028, m.stainless, { radial: 6 }))
  // The machine's name on the header, facing cars as they arrive. A spare's short header
  // has it in the middle.
  const plateLen = Math.min(beside ? 2 * span - 0.8 : 3.4, Math.max(2, input.item.label.length * 0.34))
  const plate = kit.sign(input.item.label || 'Wrap', plateLen, 0.36)
  plate.position.set(-TUBE / 2 - 0.012, HEADER - TUBE / 2, beside ? 0 : shoulderZ - s * (plateLen / 2 + 0.9))
  plate.rotation.y = -Math.PI / 2
  fixed.add(plate)

  // ---- Parts that move ----
  // The main arm, built along its own +X from the shoulder pin.
  const arm = new Group()
  arm.position.set(0, ARM_Y, shoulderZ)
  arm.add(kit.beam([-0.28, 0, 0], [L1 + 0.24, 0, 0], [0.24, 0.32], m.frame))
  arm.add(kit.bearing(0.26).translateY(0.2))
  arm.add(kit.box(0.22, 0.2, TAB + 0.1, m.frame, 0.02).translateX(LUG).translateZ((s * (TAB + 0.1)) / 2))
  arm.add(kit.cyl(0.05, 0.36, m.stainless, { radial: 8 }).translateX(LUG).translateZ(s * TAB))
  // The second arm, from the elbow pin to the brush shaft.
  const fore = new Group()
  fore.add(kit.beam([-0.24, 0, 0], [L2 + 0.3, 0, 0], [0.2, 0.26], m.frame))
  fore.add(kit.bearing(0.22).translateY(0.21))
  fore.add(kit.cyl(0.3, 0.1, m.frame).translateX(L2).translateY(0.16))
  // The head: the shaft and its drum, the gearmotor on top, the foam.
  const head = new Group()
  head.add(kit.rod([0, FOAM_LO - 0.22, 0], [0, FORE_Y + 0.2, 0], 0.075, m.stainless))
  head.add(kit.cyl(0.33, FOAM_HI - FOAM_LO + 0.2, m.motor, { bevel: 0.05 }).translateY((FOAM_LO + FOAM_HI) / 2))
  head.add(kit.cyl(0.42, 0.07, m.motor).translateY(FOAM_LO - 0.14))
  head.add(kit.cyl(0.2, 0.3, m.motor, { r2: 0.15 }).translateY(FOAM_HI + 0.24))
  head.add(gearmotor(kit, 0.26, 0.62).translateY(FORE_Y + 0.21))
  const brush = kit.foamBrush({
    axis: 'y', length: FOAM_HI - FOAM_LO, diameter: radius * 2, core: 0.66, tiers: 12, perTier: 40,
    colors: [COLORS.cloth, COLORS.cloth, COLORS.clothLight], bandTiers: 1, jitter: 0.7,
    // The face against the car wipes toward the exit, so the two sides turn opposite ways.
    dir: s > 0 ? 1 : -1, rps: 1.15, drum: false, floor: (FOAM_LO + FOAM_HI) / 2 - 0.05, seed: s > 0 ? 3 : 9,
  })
  brush.root.position.y = (FOAM_LO + FOAM_HI) / 2
  head.add(brush.root)
  // The brush casts no real shadow (it moves): its blob is the foam's footprint, thrown
  // as far as a column that tall would throw it.
  const shade = kit.blob(head, radius * 2, radius * 2, { cast: FOAM_HI })
  // The air cylinder that swings the arm.
  const ram = kit.airCylinder({ body: 2.0, stroke: 1.6, bore: 0.085, mat: m.stainless })
  moving.add(arm, fore, head, ram.root)

  const pose = () => {
    arm.rotation.y = Math.atan2(s * Math.cos(th1), Math.sin(th1))
    fore.position.set(ex, FORE_Y, ez)
    fore.rotation.y = Math.atan2(s * Math.cos(th2), Math.sin(th2))
    head.position.set(bx, 0, bz)
    ram.aim(ramX, ARM_Y, ramZ, lugX, ARM_Y, lugZ)
    if (cd < 1e3) brush.setContact(cnx, 0, cnz, cd)
    else brush.clearContact()
  }
  // Rest is the pose the moving parts are merged in.
  solve(null, 0)
  pose()
  shade.scale.set(0.42, 1, 0.42)

  const water = kit.spray({ kind: 'fan', nozzles, reach: 4.4, spread: 0.4 })

  const root = new Group()
  root.name = 'wrap'
  // A spare is built into a group of its own, then parked on its footprint.
  const body = beside ? new Group() : root
  // Fewer draw calls and triangles, same look: see brushParts.ts.
  slim(kit, fixed, moving)
  body.add(kit.mergeStatic(fixed), kit.mergeMoving(moving, [arm, fore, head, ram.root, ram.rod]), water.root)

  // What the pointer can hit: the two legs, the header, the brush wherever it is (a
  // spare's foam hangs in a narrow column, and its pick keeps to it). Limp strips long
  // enough to reach the floor spread out a little there.
  const limpOut = CORE + LIMP + 0.2
  kit.pickBox(body, 0.9, HEADER, 0.9, 0, HEADER / 2, legNear)
  kit.pickBox(body, 0.9, HEADER, 0.9, 0, HEADER / 2, legFar)
  kit.pickBox(body, 0.8, 0.9, Math.abs(legFar - legNear), 0, HEADER - TUBE / 2, (legNear + legFar) / 2)
  kit.pickCylinder(head, beside ? limpOut : Math.max(1.3, radius * 0.6), FOAM_HI + 1.6, 0, (FOAM_HI + 1.6) / 2, 0)
  let beacon = { x: 0, y: HEADER, z: legNear }
  if (body !== root) {
    root.add(body)
    beacon = park(body, input.w, input.h, limpBox(brush, 'y', FOAM_HI - FOAM_LO, limpOut, new Box3()), beacon)
  }

  return {
    root,
    height: HEADER,
    beacon,
    update(st) {
      // A spare stays folded and still.
      const a = beside ? 0 : st.activity
      solve(beside ? null : st.carDx, a)
      pose()
      brush.setSpin(a)
      brush.advance(st.dt)
      // Limp, the foam hangs in a column well under half as wide as it flies.
      const flare = 0.42 + 0.58 * (1 - (1 - a) * (1 - a))
      shade.scale.set(flare, 1, flare)
      water.setActivity(a)
    },
    dispose() {
      brush.dispose()
    },
  }
}
