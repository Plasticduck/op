import { Box3, Group } from 'three'
import { CAR } from '../car'
import { COLORS } from '../kit'
import type { Model, ModelBuilder, ModelInput } from '../types'
import { at, badge, CAR_HALF, clamp, CORE, foot, gearmotor, lay, LIMP, limpBox, park, PRESS, pressedRadius, sideGap, sidePress, slim, smooth, swingUnit, tip, tireUnit, track } from './brushParts'
import type { Unit } from './brushParts'

// The friction equipment other than wraps, as Mighty Wash runs it (MacNeil):
//   top_brush     RS-1000 Evolution: a brush across the lane that rides the roofline
//   side_brush    RS-301 "Van High" side washer (props.tall), the Gloss Boss tire shine
//                 applicator (by name), or a plain mid-height side washer
//   short_brush   RS-400 low side washers: a pair of squat drums on the rocker panels
//   wheel_brush   Wheel Boss: a long low brush that scrubs the wheels
// They follow the pattern set out in wrap.ts. brushParts.ts holds what they share: how a
// brush finds the car's skin, the two floor-mounted mechanisms, and how a spare drawn
// beside the tunnel is parked on its footprint.

const BLUE = [COLORS.cloth, COLORS.cloth, COLORS.clothLight]

// Which side of the car a machine stands on: +1 passenger, -1 driver. Beside the tunnel,
// the side of the tunnel it is on, as the scene tells them apart.
const sideOf = (input: ModelInput): 1 | -1 =>
  input.side === 'ps' ? 1 : input.side === 'ds' ? -1 : input.y >= (input.side === 'outside' ? 0 : CAR.z) ? 1 : -1

// A shape drawn across the whole lane stands for a pair, one machine each side of the car.
const sidesOf = (input: ModelInput): Array<1 | -1> =>
  (input.side === 'center' || input.side === 'both') && input.h >= CAR.width + 1.5 ? [-1, 1] : [sideOf(input)]

// Turns one or two floor units into a model: merges their parts and runs them together.
// A spare beside the tunnel is built into a group of its own, then parked on its footprint.
function floorModel(name: string, input: ModelInput, height: number, build: (s: 1 | -1, k: number, root: Group, fixed: Group, moving: Group) => Unit): Model {
  const { kit } = input
  const root = new Group()
  root.name = name
  const body = input.side === 'outside' ? new Group() : root
  const fixed = new Group()
  const moving = new Group()
  const units = sidesOf(input).map((s, k) => build(s, k, body, fixed, moving))
  slim(kit, fixed, moving)
  body.add(kit.mergeStatic(fixed), kit.mergeMoving(moving, units.flatMap((u) => u.movers)))
  // The light goes on the passenger side's post, the one the overview camera sees.
  const lit = units[units.length - 1]
  let beacon = lit.beacon
  if (body !== root) {
    root.add(body)
    beacon = park(body, input.w, input.h, units.reduce((box, u) => box.union(u.limp), new Box3()), beacon)
  }
  return {
    root,
    height,
    beacon,
    update(st) {
      for (const u of units) u.update(st)
    },
    dispose() {
      for (const u of units) u.brush.dispose()
    },
  }
}

// ---- Top brush --------------------------------------------------------------------------
// One post and a header cantilevered over the lane (the single leg is what tells an
// RS-1000 from an arch). Under the header a swing frame hangs from two bearings: arms
// trailing toward the exit with the brush between their ends, short tails with
// counterweights behind the pivot so the brush rests on the car lightly, and an air
// cylinder from the header that lifts the frame clear. The brush waits low. The nose
// pushes it up its arc, it rides the hood, the windshield and the roof, and comes down
// behind the tail. Switched off it is parked up out of the way, foam hanging like a mop.

const POST = 0.5 // 6 in square tube
const HEAD = 10.4 // top of the header
const DROP = 1.05 // the pivot hangs this far under the header
const REST = 0.436 // the arms hang 25 degrees back from straight down while it waits
const TOP = 1.5 // as far up as the arms swing
const TAIL = 0.65
const LUG = 1.6
// Radians per foot of travel: how fast it comes down once the car is gone.
const FALL = 0.3

export const topBrush: ModelBuilder = (input) => {
  const { kit, h, tunnelWidth } = input
  const m = kit.mat
  const fine = input.detail === 'high'
  // A spare beside the tunnel is built at rest around its own brush (see park): the brush
  // runs along the footprint's long side, the post stands just clear of it, and with no
  // air to hold the swing frame back it hangs plumb.
  const beside = input.side === 'outside'
  // The post stands on the driver's side unless the shape is drawn on the other: the
  // overview camera looks from the passenger side, and this way sees the brush whole.
  // Beside the tunnel it follows the side of the tunnel, as the scene tells them apart.
  const sp = input.side === 'ps' ? 1 : input.side === 'ds' ? -1 : beside ? (input.y >= 0 ? 1 : -1) : input.y > 0.5 ? 1 : -1
  // The brush is centered on the car, not on the footprint.
  const lane = beside ? 0 : CAR.z - input.y
  const R = clamp((beside ? Math.min(input.w, h) : input.w) + 0.5, 3.6, 4.8) / 2
  const rp = pressedRadius(R)
  // A spare's brush leaves room on its footprint for the post and the far end's gearmotor.
  const bw = clamp(Math.min(7, beside ? Math.max(input.w, h) - 4.8 : h - 4), 3.5, 7)
  const zPost = beside ? sp * (bw / 2 + 1.9) : sp * Math.max(Math.min(h / 2 - 0.3, tunnelWidth / 2 - sp * input.y - 0.45), sp * lane + bw / 2 + 1.9)
  const zFree = lane - sp * (bw / 2 + 1.15)
  const zArm = [lane + sp * (bw / 2 + 0.32), lane - sp * (bw / 2 + 0.32)]

  // ---- The arc the brush moves on ----
  const py = HEAD - POST - DROP
  // Waiting, the foam's lowest tips are 2.5 ft off the floor.
  const L = (py - (2.5 + R)) / Math.cos(REST)
  const px = L * Math.sin(REST)
  // Parked: high enough that limp foam clears the roof.
  const PARK = Math.acos(clamp((py - (CAR.height + 0.45 + CORE + (R - CORE) * 1.06)) / L, 0.02, 1))
  const gapAt = (th: number, c: number) => sideGap(-px + L * Math.sin(th) - c, py - L * Math.cos(th)) - rp
  // Gravity holds the brush down on the car, so where it sits is found from above: swing
  // down from the top until the foam would be squeezed past rp.
  const ride = beside ? null : track(-CAR_HALF - rp - 2.2, CAR_HALF + L - px + rp + (TOP - REST) / FALL + 0.5, (c) => {
    if (c + CAR_HALF < -rp - 0.2 || c - CAR_HALF > L - px + rp + 0.2) return REST
    let ok = TOP
    for (let i = 1; i <= 40; i++) {
      const th = TOP + ((REST - TOP) * i) / 40
      if (gapAt(th, c) < 0) {
        let bad = th
        for (let j = 0; j < 8; j++) {
          const half = (ok + bad) / 2
          if (gapAt(half, c) < 0) bad = half
          else ok = half
        }
        return ok
      }
      ok = th
    }
    return REST
  }, FALL, 0.6)

  // ---- Parts that never move: the post, the header and what hangs on them ----
  const fixed = new Group()
  const moving = new Group()
  const headY = HEAD - POST / 2
  fixed.add(kit.beam([-px, 0.06, zPost], [-px, HEAD - POST, zPost], POST, m.frame))
  fixed.add(kit.beam([-px, headY, zPost + (sp * POST) / 2], [-px, headY, zFree], POST, m.frame))
  foot(kit, fixed, moving, -px, zPost, 1.5, 1.35)
  // A cantilever needs its corner held: a knee brace and a gusset plate.
  fixed.add(kit.beam([-px, HEAD - POST - 2.3, zPost - sp * 0.2], [-px, HEAD - POST - 0.05, zPost - sp * 2.5], [0.26, 0.26], m.frame))
  const corner = kit.gusset(1.1, 0.06, m.frame)
  corner.position.set(-px, HEAD - POST, zPost - (sp * POST) / 2)
  corner.rotation.y = (sp * Math.PI) / 2
  corner.scale.y = -1
  fixed.add(corner)
  if (fine) {
    for (const dir of [-1, 1]) {
      const web = kit.gusset(0.5, 0.05, m.frame)
      web.position.set(-px, 0.06, zPost + (dir * POST) / 2)
      web.rotation.y = (-dir * Math.PI) / 2
      fixed.add(web)
    }
  }
  // The two hangers the swing frame's bearings are bolted to.
  const zHang = [zArm[0] + sp * 0.3, zArm[1] - sp * 0.3]
  for (const z of zHang) fixed.add(kit.beam([-px, HEAD - POST + 0.02, z], [-px, py - 0.28, z], [0.3, 0.14], m.frame))
  // The lift cylinder's bracket, on the header's downstream face beside the post-side arm.
  const zRam = zArm[0] + sp * 0.26
  const ramX = -px + 0.42
  const ramY = headY
  fixed.add(at(kit.box(0.3, 0.3, 0.14, m.frame, 0.02), -px + 0.34, ramY, zRam))
  // The spray bar that keeps the foam wet: a stainless pipe along the header, fed by a
  // white poly line that runs down the post.
  const barX = -px + POST / 2 + 0.14
  const barY = HEAD - POST - 0.1
  const bar0 = lane + sp * (bw / 2 - 0.2)
  const bar1 = lane - sp * (bw / 2 - 0.2)
  moving.add(kit.tube([[barX, barY, bar0], [barX, barY, bar1]], 0.05, m.stainless, { radial: 8 }))
  const tips = fine ? Math.max(3, Math.round(bw / 1.5)) : 0
  for (let k = 0; k < tips; k++) {
    const z = bar0 + ((bar1 - bar0) * (k + 0.5)) / tips
    tip(kit, fixed, barX, barY, z, 0.5, -1, 0)
    if (k % 2 === 0) fixed.add(kit.beam([barX, barY + 0.04, z + 0.2], [-px + POST / 2 - 0.02, barY + 0.14, z + 0.2], [0.07, 0.1], m.frame, 0.015))
  }
  if (fine) {
    fixed.add(at(lay(kit.paint(kit.cyl(0.07, 0.16, m.stainless, { radial: 10 }), 'red'), 'z'), barX, barY, bar0 + sp * 0.08))
    const feedZ = zPost - sp * (POST / 2 + 0.06)
    fixed.add(kit.paint(kit.tube([[barX, barY, bar0 + sp * 0.16], [barX, barY, feedZ], [-px + 0.12, barY - 0.4, feedZ], [-px + 0.12, 0.3, feedZ]], 0.03, m.stainless, { bend: 0.3, radial: 6 }), 'hoseWhite'))
    // The air line to the cylinder loops down from the header.
    fixed.add(kit.paint(kit.hose([-px + 0.2, HEAD - POST - 0.02, zRam + sp * 0.5], [ramX + 0.05, ramY - 0.45, zRam + sp * 0.12], 0.026, m.stainless, 0.22), 'hoseBlue'))
    moving.add(kit.tube([[-px - POST / 2 - 0.05, 5.2, zPost], [-px - POST / 2 - 0.05, HEAD - POST - 0.1, zPost]], 0.028, m.stainless, { radial: 6 }))
  }
  // Controls: a junction box on the post's upstream face.
  fixed.add(at(kit.paint(kit.box(0.2, 0.7, 0.5, m.frame, 0.03), 'dark'), -px - POST / 2 - 0.09, 4.85, zPost))
  // The name on the header, over the lane, facing cars as they arrive.
  badge(kit, fixed, input.item.label || 'Top Brush', -px - POST / 2, headY, lane, 3.2)

  // ---- The swing frame. Built hanging straight down from its pivot, then swung. ----
  const swing = new Group()
  swing.position.set(-px, py, 0)
  swing.add(at(lay(kit.cyl(0.15, Math.abs(zHang[1] - zHang[0]) + 0.3, m.frame, { bevel: 0.02 }), 'z'), 0, 0, (zHang[0] + zHang[1]) / 2))
  swing.add(kit.beam([0, -L * 0.34, zArm[0]], [0, -L * 0.34, zArm[1]], 0.18, m.frame))
  zArm.forEach((z, k) => {
    const out = k === 0 ? sp : -sp
    swing.add(kit.beam([0, 0.1, z], [0, -L - 0.26, z], [0.34, 0.2], m.frame))
    swing.add(kit.beam([0, 0, z], [0, TAIL + 0.1, z], [0.28, 0.18], m.frame))
    // Counterweights: a stack of cast plates on each tail.
    swing.add(at(kit.box(0.46, 0.4, 0.3, m.motor, 0.04), 0, TAIL - 0.02, z))
    // The pivot bearing (on the hanger) and the bearing the brush's shaft turns in.
    swing.add(at(lay(kit.cyl(0.24, 0.12, m.motor, { bevel: 0.03, radial: 14 }), 'z'), 0, 0, z + out * 0.3))
    swing.add(at(lay(kit.cyl(0.13, 0.2, m.motor, { bevel: 0.02, radial: 10 }), 'z'), 0, 0, z + out * 0.3))
    // (The free end's is inside the gearmotor.)
    if (k === 0) {
      const shaft = kit.bearing(0.21)
      shaft.rotation.x = Math.PI / 2
      swing.add(at(shaft, 0, -L, z + out * 0.14))
    }
  })
  // The drum the foam is fixed to, its end caps and the shaft through it.
  swing.add(at(lay(kit.cyl(CORE, bw + 0.1, m.motor, { bevel: 0.04 }), 'z'), 0, -L, lane))
  for (const end of [-1, 1]) swing.add(at(lay(kit.cyl(0.47, 0.07, m.motor), 'z'), 0, -L, lane + end * (bw / 2 + 0.07)))
  swing.add(kit.rod([0, -L, zArm[0] + sp * 0.26], [0, -L, zArm[1] - sp * 0.2], 0.07, m.stainless))
  // The gearmotor on the free end, where it is easy to get at.
  const gear = gearmotor(kit, 0.26, 0.62)
  gear.rotation.set((-sp * Math.PI) / 2, sp < 0 ? Math.PI : 0, 0)
  gear.position.set(0, -L, zArm[1] - sp * 0.12)
  swing.add(gear)
  // The lug the cylinder pulls on.
  swing.add(at(kit.box(0.22, 0.2, 0.2, m.frame, 0.02), 0.1, -LUG, zArm[0] + sp * 0.18))
  swing.add(at(lay(kit.cyl(0.05, 0.3, m.stainless, { radial: 8 }), 'z'), 0.1, -LUG, zRam))

  const length = bw
  const brush = kit.foamBrush({
    axis: 'z', length, diameter: R * 2, core: CORE * 2, tiers: Math.round(length / 0.58), perTier: 30,
    colors: BLUE, bandTiers: 1, jitter: 0.7,
    // The underside runs against the car, which helps the brush climb. A second top
    // brush turns the other way.
    dir: /2\s*$/.test(input.item.label) ? -1 : 1, rps: 1.4, drum: false, seed: sp > 0 ? 5 : 11,
  })
  // The foam and its shadow ride on the arms' ends without turning with them.
  const head = new Group()
  head.add(brush.root)
  const shade = kit.blob(head, R * 2, bw, { shape: 'box', y: -R, cast: R * 2 })

  // The cylinder is sized to the swing it has to make.
  const lugX = (th: number) => -px + LUG * Math.sin(th) + 0.1 * Math.cos(th)
  const lugY = (th: number) => py - LUG * Math.cos(th) + 0.1 * Math.sin(th)
  const span = (th: number) => Math.hypot(lugX(th) - ramX, lugY(th) - ramY)
  const hang = beside ? 0 : REST
  const ram = kit.airCylinder({ body: span(TOP) - 0.5, stroke: span(hang) - span(TOP) + 0.1, bore: 0.085, mat: m.stainless })
  moving.add(swing, ram.root)

  let bx = 0
  let by = 0
  const pose = (th: number) => {
    swing.rotation.z = th
    bx = -px + L * Math.sin(th)
    by = py - L * Math.cos(th)
    head.position.set(bx, by, lane)
    ram.aim(ramX, ramY, zRam, lugX(th), lugY(th), zRam)
  }
  pose(hang)
  shade.scale.set(0.45, 1, 1)

  const root = new Group()
  root.name = 'top-brush'
  const body = beside ? new Group() : root
  slim(kit, fixed, moving)
  body.add(kit.mergeStatic(fixed), kit.mergeMoving(moving, [swing, ram.root, ram.rod]), head)

  kit.pickBox(body, 0.95, HEAD, 0.95, -px, HEAD / 2, zPost)
  kit.pickBox(body, 0.85, 0.9, Math.abs(zFree - zPost), -px, headY, (zPost + zFree) / 2)
  for (const z of zArm) kit.pickBox(swing, 0.6, L + 0.4, 0.5, 0, -L / 2, z)
  // A spare's foam hangs in a narrow column, and its pick keeps to it.
  kit.pickCylinder(head, beside ? 2 * LIMP : Math.max(1.2, R * 0.72), bw + 1.6, 0, 0, sp < 0 ? 0.5 : -0.5, 'z')
  let beacon = { x: -px, y: HEAD, z: zPost }
  if (body !== root) {
    root.add(body)
    beacon = park(body, input.w, h, limpBox(brush, 'z', length, 2 * LIMP, new Box3()), beacon)
  }

  return {
    root,
    height: HEAD,
    beacon,
    update(st) {
      // A spare just hangs there.
      const th = beside ? hang : !st.running ? PARK : ride ? ride.at(st.carDx) : REST
      pose(th)
      // It keeps turning until it is back down, even after the car has left its patch.
      const busy = smooth((th - REST) / 0.25) * Math.min(1, st.activity * 8)
      const spin = st.running && !beside ? Math.max(st.activity, busy) : 0
      brush.setSpin(spin)
      brush.advance(st.dt)
      let pressed = false
      if (st.running && ride && st.carDx != null) {
        sidePress(bx - st.carDx, by, R + 0.35)
        if (PRESS.hit && PRESS.d < R + 0.25) {
          brush.setContact(PRESS.nx, PRESS.ny, 0, Math.max(CORE + 0.22, PRESS.d - 0.15))
          pressed = true
        }
      }
      if (!pressed) brush.clearContact()
      shade.scale.set(0.45 + 0.55 * (1 - (1 - spin) * (1 - spin)), 1, 1)
    },
    dispose() {
      brush.dispose()
    },
  }
}

// ---- Side washers and the Gloss Boss ----------------------------------------------------

// The low brush on parallel arms, as a wheel cleaner or (gloss) a tire shine applicator.
function tireMachine(input: ModelInput, gloss: boolean): Model {
  const beside = input.side === 'outside'
  // A spare's brush runs along its footprint's long side, short enough that the beam's
  // ends and the gearmotor stay on it.
  const length = beside ? clamp(Math.max(input.w, input.h) - 1.25, 2, 9) : clamp(input.w - 1, 2, 9)
  const r = gloss ? 0.5 : 0.6
  const pair = sidesOf(input).length > 1
  return floorModel(gloss ? 'gloss-boss' : 'wheel-boss', input, 2.5, (s, k, root, fixed, moving) => {
    // The brush waits along the footprint's car-side edge. A pair drawn across the lane
    // keeps to the two ends of its footprint. A spare is folded as close as it goes.
    const edge = beside ? -r : pair ? input.h / 2 - 2.3 + s * (input.y - CAR.z) : s * (input.y - CAR.z) - input.h / 2
    return tireUnit(input, { s, gloss, home: edge + r, length, sign: !pair || s > 0 ? input.item.label || null : null, seed: 21 + k + (s > 0 ? 4 : 0) }, root, fixed, moving)
  })
}

export const sideBrush: ModelBuilder = (input) => {
  const { item } = input
  const tall = item.props?.tall === true
  // MacNeil's Gloss Boss is filed under side brushes, but it is a tire shine applicator.
  if (!tall && /gloss[\s-]*boss/i.test(`${item.label} ${item.match_type ?? ''}`)) return tireMachine(input, true)
  const diameter = clamp(Math.min(input.w, input.h) + 0.5, 3.6, 5)
  const pair = sidesOf(input).length > 1
  // Van High: the tall washer, two foam sections on a shaft that leans in so the top
  // reaches a van's upper sides. Otherwise a plain mid-height washer, standing straight.
  const foamHi = tall ? 6.5 : 4.9
  const mast = foamHi + 0.8
  return floorModel(tall ? 'van-high' : 'side-washer', input, mast, (s, k, root, fixed, moving) => swingUnit(input, {
    s,
    home: input.side === 'outside' ? 0 : pair ? input.h / 2 - diameter / 2 + s * (input.y - CAR.z) : s * (input.y - CAR.z),
    // Held just inside the line of the doors, so the car's corners push it out and it
    // follows them back in.
    press: (CAR.width / 2) * 0.86 + pressedRadius(diameter / 2) - 0.2,
    diameter,
    foamLo: 1.25,
    foamHi,
    tilt: tall ? 0.175 : 0,
    mast,
    cap: tall ? 0.5 : 0.55,
    colors: tall
      ? [COLORS.cloth, COLORS.clothDark, COLORS.cloth, COLORS.cloth, COLORS.clothLight, COLORS.clothLight, COLORS.cloth, COLORS.clothLight, COLORS.clothLight]
      : BLUE,
    seed: 31 + k + (s > 0 ? 4 : 0),
    sign: !pair || s > 0 ? item.label || null : null,
  }, root, fixed, moving))
}

// The low side washers: squat drums under a flat cap, one each side of the car. Working,
// they wait nearly touching in the middle of the lane and the car's nose parts them.
export const shortBrush: ModelBuilder = (input) => {
  const pair = sidesOf(input).length > 1
  const diameter = pair ? clamp(0.45 * input.h, 3.2, 5) : clamp(Math.min(input.w, input.h) + 0.5, 3.2, 5)
  const foamHi = 3.75
  return floorModel('short-brush', input, foamHi + 0.75, (s, k, root, fixed, moving) => swingUnit(input, {
    s,
    // One drum at each end of the footprint, or a single one where it is drawn.
    home: input.side === 'outside' ? 0 : pair ? input.h / 2 + s * (input.y - CAR.z) : s * (input.y - CAR.z),
    press: diameter / 2 + 1.35,
    diameter,
    foamLo: 1.25,
    foamHi,
    tilt: 0,
    mast: foamHi + 0.75,
    cap: 0.82,
    colors: [COLORS.cloth, COLORS.clothLight, COLORS.cloth, COLORS.cloth],
    seed: 41 + k + (s > 0 ? 4 : 0),
    sign: !pair || s > 0 ? input.item.label || null : null,
  }, root, fixed, moving))
}

export const wheelBrush: ModelBuilder = (input) => tireMachine(input, false)
