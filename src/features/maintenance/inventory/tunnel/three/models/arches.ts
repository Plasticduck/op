import { CylinderGeometry, Group, Mesh } from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CAR, carHalfWidthAt } from '../car'
import { COLORS } from '../kit'
import type { Paint, Spray, V3 } from '../kit'
import type { ModelBuilder } from '../types'
import { awayFromTunnel, block, chip, legSpan, lightCylinder, namePlates, nozzle, paintAll, plateLength, seedOf, strut, stub } from './archParts'
import type { Nozzle } from './archParts'

// Spray arches and applicators: what wets, soaps, blasts, waxes and rinses the car without
// touching it, and the one low machine that dresses its tires. They follow models/wrap.ts:
// fixed parts merged per material, moving parts on bones, spray from the kit, a pose that
// is plain arithmetic on RunState. Everything but a bare metal hoop is painted from the
// sign atlas, steel included, so a machine at rest is one or two meshes (plus one for
// what moves) and each spray adds one while it runs.
//
// A machine in the tunnel is never turned: +X is the way cars go, and a leg's z is
// measured from the footprint's center (see legSpan in archParts.ts).

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const TAU = Math.PI * 2

// Activity starts rising when the car is still 8 ft off (life.ts). The water waits for
// the second half of that, when the nose is about as far away as the spray reaches, and
// stops as soon after the tail: an arch never sprays an empty lane.
const flowOf = (activity: number) => {
  const c = clamp((activity - 0.5) / 0.5, 0, 1)
  return c * c * (3 - 2 * c)
}

// ---- arch: presoak, protectant and rinse arches ----------------------------------------
//
// One 3 in tube bent into a hoop with round shoulders (MacNeil RW-111, RW-112), told apart
// by what hangs inside it:
//   presoak     a bright aluminum hoop carrying a black anodized manifold on standoffs,
//               nozzles down both legs and across the top, laying white foam in fans
//   protectant  a gray coated hoop with a rain bar under the crown that drops a curtain of
//               colored foam, and a sign box on top. The one with color.
//   rinse       a bare stainless pipe that is its own manifold: clear water fans. R.O. has
//               a blue tag and nozzles on 1 ft centers; spot free is the last arch, square
//               shouldered, teal tagged, fewer nozzles and a fine mist, so the two are not
//               twins even from across the room.

const ARCH_TOP = 9.5
const ARCH_FOOT = 0.42
const HOSE = 0.032

type ArchStyle = 'presoak' | 'protectant' | 'ro' | 'spotfree' | 'rinse'

function archStyle(text: string | null | undefined): ArchStyle | null {
  const s = (text ?? '').toLowerCase()
  if (/protect|wax|seal|ceramic|triple|tri[\s-]?foam|lava|rain|polish|shield|glaze|clear\s?coat/.test(s)) return 'protectant'
  if (/soak|soap|foam|detergent|chem|pre[\s-]?wash|bug/.test(s)) return 'presoak'
  if (/spot|final/.test(s)) return 'spotfree'
  if (/(^|[^a-z])r\.?\s?o\.?([^a-z]|$)|osmosis/.test(s)) return 'ro'
  if (/rinse/.test(s)) return 'rinse'
  return null
}

// The three foams of a protectant arch: what the lines and drip tips are painted, and
// what falls from them.
const TRI_FOAM: ReadonlyArray<{ part: Paint; foam: string }> = [
  { part: '#ff5fa2', foam: '#ff6fae' },
  { part: 'hoseBlue', foam: '#5a98ff' },
  { part: 'yellow', foam: '#ffd84a' },
]
const LAVA_FOAM: ReadonlyArray<{ part: Paint; foam: string }> = [
  { part: 'hoseRed', foam: '#ff5a3c' },
  { part: '#ff8a1f', foam: '#ff9a2e' },
  { part: 'yellow', foam: '#ffd84a' },
]
const SPOT_FREE_TAG: Paint = '#14a3b8'

export const arch: ModelBuilder = (input) => {
  const { kit } = input
  const m = kit.mat
  const low = input.detail === 'low'
  const label = input.item.label || 'Arch'
  const style = archStyle(input.item.label) ?? archStyle(input.item.match_type) ?? 'rinse'
  const sp = legSpan(input, ARCH_FOOT, CAR.width / 2 + 1.1)
  const mid = (sp.lo + sp.hi) / 2
  const curtain = style === 'protectant' && sp.over
  const coated = style === 'protectant'
  const R = style === 'presoak' || coated ? 0.125 : 0.11
  const topY = ARCH_TOP - R
  const bend = Math.min(style === 'spotfree' ? 0.45 : 1.5, (sp.hi - sp.lo) * 0.3)
  const hoopMat = style === 'presoak' ? m.aluminum : m.stainless
  // What the feet and fittings are painted to match the hoop.
  const hoopPaint: Paint = coated ? 'frame' : style === 'presoak' ? COLORS.aluminum : COLORS.stainless
  const foams = /lava/i.test(`${input.item.label} ${input.item.match_type ?? ''}`) ? LAVA_FOAM : TRI_FOAM
  const tag: Paint = style === 'ro' ? 'hoseBlue' : style === 'spotfree' ? SPOT_FREE_TAG : style === 'presoak' ? 'green' : 'hoseWhite'
  const pitch = (style === 'spotfree' ? 1.5 : style === 'ro' ? 1.0 : style === 'presoak' ? 1.1 : 1.25) * (low ? 1.5 : 1)

  // ---- The hoop and its feet ----
  const fixed = new Group()
  const hoop = kit.tube([[0, 0.05, sp.lo], [0, topY, sp.lo], [0, topY, sp.hi], [0, 0.05, sp.hi]], R, hoopMat, { bend, radial: low ? 8 : 10 })
  fixed.add(coated ? kit.paint(hoop, 'frame') : hoop)
  // Feet are painted to match, so they ride in the fittings' draw call.
  const plateX = clamp(input.w - 0.1, 0.5, 0.74)
  for (const z of [sp.lo, sp.hi]) {
    fixed.add((low ? block(kit, plateX, 0.06, 0.74, hoopPaint) : kit.paint(kit.box(plateX, 0.06, 0.74, m.frame, 0.02), hoopPaint)).translateY(0.03).translateZ(z))
    if (low) continue
    const collar = kit.cyl(R + 0.06, 0.16, hoopMat, { radial: 10 }).translateY(0.14).translateZ(z)
    fixed.add(coated ? kit.paint(collar, 'frame') : collar)
  }

  // ---- Nozzles ----
  // A leg sprays from the side that faces the car: `face` is which way that is. A hoop
  // that stands beside the car instead of over it only has one such leg.
  const legs = sp.over
    ? [{ z: sp.lo, face: 1 }, { z: sp.hi, face: -1 }]
    : sp.carZ < sp.lo ? [{ z: sp.lo, face: -1 }] : [{ z: sp.hi, face: 1 }]
  // Presoak carries its nozzles on a separate manifold, this far inside the hoop.
  const inset = style === 'presoak' ? 0.3 : 0
  const pipe = inset ? 0.05 : R
  const look = { pipe, cap: coated ? foams[0].part : tag, low }
  // Where the manifold's own bend starts, measured from its corner (as kit.tube cuts it).
  const cut = Math.min(Math.max(0.2, bend - inset * 0.6), (topY - inset - 1) * 0.48, (sp.hi - sp.lo - inset * 2) * 0.48)
  const nozzles: Nozzle[] = []
  // Everything leans a little toward the car that is arriving.
  const LEAN = -0.1
  if (!curtain) {
    const legTop = Math.min(6.9, topY - inset - cut - 0.15)
    for (const l of legs) {
      const z = l.z + l.face * inset
      for (let y = 1.5; y <= legTop; y += pitch) {
        nozzles.push({ at: nozzle(kit, fixed, [0, y, z], 0, 0, l.face, look), dir: [LEAN, -0.08, l.face] })
      }
      if (inset) {
        // Standoffs from the hoop to the manifold.
        const gap = inset - pipe - R
        for (const y of low ? [1.3, 6.3] : [1.3, 3.8, 6.3]) fixed.add(chip(kit, 0.09, 0.07, gap + 0.04, 'body', 0, y, l.z + l.face * (R + gap / 2)))
        if (!sp.over) fixed.add(kit.paint(kit.tube([[0, 1, z], [0, 7.2, z]], pipe, m.stainless, { radial: low ? 6 : 8 }), 'black'))
      }
    }
  }
  if (sp.over && !curtain) {
    const y = topY - inset
    if (inset) {
      const lo = sp.lo + inset
      const hi = sp.hi - inset
      fixed.add(kit.paint(kit.tube([[0, 1, lo], [0, y, lo], [0, y, hi], [0, 1, hi]], pipe, m.stainless, { bend: cut, radial: low ? 6 : 8 }), 'black'))
      const gap = inset - pipe - R
      for (const dz of low ? [0] : [-3.3, 0, 3.3]) {
        const z = sp.carZ + dz
        if (z > lo + cut && z < hi - cut) fixed.add(chip(kit, 0.09, gap + 0.04, 0.07, 'body', 0, topY - R - gap / 2, z))
      }
    }
    // One at each shoulder, pointing down and in.
    for (const l of legs) {
      const d = Math.SQRT1_2
      const at: V3 = [0, y - cut * 0.25, l.z + l.face * (inset + cut * 0.25)]
      nozzles.push({ at: nozzle(kit, fixed, at, 0, -d, l.face * d, look), dir: [LEAN, -d, l.face * d] })
    }
    // Across the top, over the car.
    const reach = CAR.width / 2 + 0.9
    const from = Math.max(sp.lo + inset + cut + 0.4, sp.carZ - reach)
    const to = Math.min(sp.hi - inset - cut - 0.4, sp.carZ + reach)
    const count = Math.floor((to - from) / pitch) + 1
    for (let k = 0; k < count; k++) {
      const z = (from + to) / 2 + (k - (count - 1) / 2) * pitch
      nozzles.push({ at: nozzle(kit, fixed, [0, y, z], 0, -1, 0, look), dir: [LEAN, -1, 0], across: [0, 0, 1] })
    }
  }

  // ---- The rain bar: a pipe hung under the crown, drilled along its length ----
  const drips: Nozzle[][] = [[], [], []]
  const barY = topY - R - 0.62
  // No wider than the car, or the outer foams fall past its sides onto the floor.
  const barLo = Math.max(sp.lo + bend + 0.2, sp.carZ - CAR.width / 2 - 0.15)
  const barHi = Math.min(sp.hi - bend - 0.2, sp.carZ + CAR.width / 2 + 0.15)
  if (curtain) {
    // Painted stainless, so the whole coated arch is one draw call.
    fixed.add(kit.paint(kit.tube([[0, barY, barLo], [0, barY, barHi]], 0.085, m.sign, { radial: low ? 8 : 10 }), COLORS.stainless))
    // Each foam has its own third of the bar, so the car leaves in three stripes. The
    // hangers clamp it where one third ends and the next begins.
    for (const f of [1 / 3, 2 / 3]) {
      const z = barLo + (barHi - barLo) * f
      const hang = topY - R + 0.03 - (barY + 0.04)
      fixed.add(block(kit, 0.14, hang, 0.04, COLORS.stainless).translateY(barY + 0.04 + hang / 2).translateZ(z))
      fixed.add(stub(kit, [0, barY, z - 0.04], [0, barY, z + 0.04], 0.105, 'dark', low ? 8 : 10))
    }
    const tips = Math.max(3, Math.round((barHi - barLo - 0.4) / (low ? 0.55 : 0.33)) + 1)
    for (let k = 0; k < tips; k++) {
      const z = barLo + 0.2 + ((barHi - barLo - 0.4) * k) / (tips - 1)
      const band = Math.min(2, Math.floor((k * 3) / tips))
      fixed.add(stub(kit, [0, barY - 0.07, z], [0, barY - 0.16, z], 0.034, foams[band].part, low ? 4 : 6, true))
      drips[band].push({ at: [0, barY - 0.18, z], dir: [LEAN * 0.3, -1, 0], across: [0, 0, 1] })
    }
  }

  // ---- Supply lines, zip-tied up the leg on the passenger side ----
  // (The leg away from the car, when the hoop stands beside it.)
  const plumbed = sp.over || legs[0].z === sp.lo ? { z: sp.hi, out: 1 } : { z: sp.lo, out: -1 }
  const lines: Paint[] = coated ? foams.map((f) => f.part) : style === 'presoak' ? ['green', 'hoseBlue'] : [tag]
  const zo = plumbed.z + plumbed.out * (R + HOSE + 0.004)
  const lineX = (k: number) => (k - (lines.length - 1) / 2) * (HOSE * 2 + 0.014)
  const bundle = Math.max(R * 2, lines.length * (HOSE * 2 + 0.014)) + 0.04
  // Presoak and protectant lines ride over the shoulder to where they feed in near the
  // crown. Rinse water stops at a solenoid valve on the leg and enters the pipe there.
  const overTop = sp.over && (style === 'presoak' || coated)
  const plateLen = plateLength(label, 1.5, clamp(sp.hi - sp.lo - bend * 2 - 0.4, 1.2, 3.4))
  const yTop = ARCH_TOP + HOSE + 0.004
  // Where the first line leaves the bundle: the ties stop there.
  let firstEnd = mid
  // A foam's line runs on to its own third of the rain bar. The nearest third's line
  // rides in the middle, so the other two pass either side of the sign's posts.
  const nearest = plumbed.out > 0 ? 2 : 0
  lines.forEach((color, k) => {
    const x = lineX(curtain ? (k === nearest ? 1 : k === 1 ? 2 : 0) : k)
    if (!overTop) {
      fixed.add(kit.paint(kit.tube([[x, 0.03, zo], [x, 6.25, zo]], HOSE, m.stainless, { radial: low ? 4 : 6 }), color))
      return
    }
    const end = curtain
      ? barLo + ((k + 0.5) * (barHi - barLo)) / 3
      : mid + plumbed.out * (plateLen / 2 + 0.4 + 0.32 * k)
    if ((end - firstEnd) * plumbed.out > 0) firstEnd = end
    fixed.add(kit.paint(kit.tube([[x, 0.03, zo], [x, yTop, zo], [x, yTop, end]], HOSE, m.stainless, { bend: bend + R + HOSE, radial: low ? 4 : 6 }), color))
    if (curtain) {
      // Down the far side of the hoop and into the rain bar.
      fixed.add(kit.paint(kit.tube([[x, yTop, end], [0.26, yTop, end], [0.26, barY + 0.3, end], [0, barY + 0.07, end]], HOSE * 0.85, m.stainless, { bend: 0.12, radial: low ? 4 : 6 }), color))
    } else {
      // A brass drop from the line, around the hoop and into the manifold.
      const side = x < 0 ? -1 : 1
      fixed.add(chip(kit, 0.12, 0.1, 0.14, 'dark', x, yTop, end))
      fixed.add(kit.paint(kit.tube([[x, yTop, end], [side * (R + 0.07), yTop, end], [side * (R + 0.07), topY - inset, end], [0, topY - inset, end]], 0.024, m.stainless, { bend: 0.07, radial: low ? 4 : 6 }), 'brass'))
    }
  })
  if (!overTop) {
    // The valve: body, coil in the tag color, a brass union under it.
    const vz = zo + plumbed.out * 0.03
    fixed.add(chip(kit, bundle - 0.02, 0.3, 0.17, 'dark', 0, 6.4, vz))
    fixed.add(stub(kit, [0, 6.55, vz], [0, 6.74, vz], 0.062, tag, 8))
    fixed.add(stub(kit, [0, 6.17, zo], [0, 6.26, zo], 0.046, 'brass', 6))
    // A pipe marker band, the way plant piping is tagged.
    if (!coated && style !== 'presoak') fixed.add(stub(kit, [0, 4.82, plumbed.z], [0, 5.16, plumbed.z], R + 0.012, tag, low ? 8 : 10, true))
  }
  // The stub-up the lines come out of the floor through.
  fixed.add(chip(kit, bundle + 0.06, 0.16, 0.2, 'mid', 0, 0.14, zo + plumbed.out * 0.03))
  if (!low) {
    for (const y of overTop ? [1.3, 2.9, 4.5, 6.1] : [1.3, 2.9, 4.5]) {
      fixed.add(chip(kit, bundle, 0.04, R * 2 + HOSE * 2 + 0.03, 'black', 0, y, plumbed.z + plumbed.out * HOSE))
    }
    if (overTop) {
      const from = plumbed.z - plumbed.out * (bend + 0.4)
      const to = firstEnd + plumbed.out * 0.35
      const runs = Math.max(1, Math.round(Math.abs(from - to) / 1.5))
      for (let k = 0; k <= runs; k++) {
        if ((from - to) * plumbed.out > 0) fixed.add(chip(kit, bundle, R * 2 + HOSE * 2 + 0.03, 0.04, 'black', 0, topY + HOSE, from + ((to - from) * k) / runs))
      }
    }
  }

  // ---- The name ----
  let height: number
  if (coated) {
    // A sign box on the crown, with a bar of each foam's color along its foot.
    const boxLen = plateLen + 0.5
    const boxY = ARCH_TOP + 0.5
    fixed.add(kit.paint(kit.box(0.16, 0.66, boxLen, m.frame, 0.04), 'dark').translateY(boxY).translateZ(mid))
    for (const dz of [-boxLen * 0.36, boxLen * 0.36]) fixed.add(chip(kit, 0.07, 0.2, 0.07, 'frame', 0, ARCH_TOP + 0.08, mid + dz))
    namePlates(kit, fixed, label, plateLen, 0.36, boxY + 0.08, mid, 0.16, false)
    const bar = (boxLen - 0.3) / 3
    for (const dir of [-1, 1]) {
      foams.forEach((f, k) => fixed.add(chip(kit, 0.02, 0.07, bar - 0.05, f.part, dir * 0.085, boxY - 0.22, mid + (k - 1) * bar)))
    }
    height = boxY + 0.33
  } else {
    namePlates(kit, fixed, label, plateLen, 0.32, topY + 0.1, mid, R * 2 + 0.02)
    height = topY + 0.31
  }

  // ---- Water and foam ----
  const seed = seedOf(label)
  const sprays: Spray[] = []
  if (curtain) {
    foams.forEach((f, k) => {
      if (drips[k].length) sprays.push(kit.spray({ kind: 'foam', nozzles: drips[k], reach: 3.1, spread: 0.07, perNozzle: 64, color: f.foam, size: 0.21, seed: seed + k }))
    })
  } else if (nozzles.length) {
    // Foam is laid on thick (in the first foam's color, for a protectant hoop that stands
    // beside the car and has no curtain). Presoak's is white with a breath of shade in
    // it, or it could not be seen against a white car on a white page. Rinse water is
    // fine and clear.
    const foam = style === 'presoak' ? '#e2ecf7' : coated ? foams[0].foam : null
    if (foam) sprays.push(kit.spray({ kind: 'fan', nozzles, reach: 4.3, spread: 0.52, perNozzle: 84, color: foam, size: 0.78, seed }))
    else if (style === 'spotfree') {
      // Final rinse: a soft wide fan inside a cloud of fine mist.
      sprays.push(kit.spray({ kind: 'fan', nozzles, reach: 4.2, spread: 0.6, perNozzle: 56, size: 0.3, seed }))
      sprays.push(kit.spray({ kind: 'mist', nozzles, reach: 3.6, perNozzle: 16, seed: seed + 1 }))
    } else sprays.push(kit.spray({ kind: 'fan', nozzles, reach: 4.6, spread: 0.46, perNozzle: 84, size: 0.36, seed }))
  }

  const root = new Group()
  root.name = `arch:${style}`
  root.add(kit.mergeStatic(fixed))
  for (const s of sprays) root.add(s.root)

  // What the pointer can hit: the two legs and the top, nothing in between.
  for (const z of [sp.lo, sp.hi]) kit.pickBox(root, 0.7, ARCH_TOP - 0.4, 0.7, 0, (ARCH_TOP - 0.4) / 2, z)
  const crown = curtain ? 1.5 : 0.9
  kit.pickBox(root, 0.8, crown + (height - ARCH_TOP), sp.hi - sp.lo, 0, (height + ARCH_TOP - crown) / 2, mid)

  return {
    root,
    height,
    // On the passenger side shoulder, where the top run starts.
    beacon: { x: 0, y: ARCH_TOP + (overTop ? HOSE * 2 : 0), z: sp.hi - Math.min(bend + 0.35, (sp.hi - sp.lo) / 2) },
    update(st) {
      const flow = st.running ? flowOf(st.activity) : 0
      for (let k = 0; k < sprays.length; k++) sprays[k].setActivity(flow)
    },
  }
}

// ---- blaster: the high pressure arch ----------------------------------------------------
//
// MacNeil Magnum style: a square tube portal, heavier than a rinse hoop, carrying three
// black manifolds of rotating zero-degree nozzles: one hung under the header and one
// standing inside each leg. An air cylinder rocks each manifold on its own axis, so the
// pencil jets sweep along the car from nose to tail and back. High pressure hose comes up
// the passenger side leg and drops to each manifold's swivel; a yellow hoop keeps wheels
// off the low nozzles.

const BL_TOP = 10
const BL_TUBE = 0.42
// How far the manifolds rock either way, in radians, and how often.
const BL_SWEEP = 0.5
const BL_HZ = 0.8
const BL_CRANK = 0.4
const BL_TOP_Y = 8.35 // the top manifold's axis
const BL_RAM_Y = 6.95 // where the side manifolds' cylinders push

export const blaster: ModelBuilder = (input) => {
  const { kit } = input
  const m = kit.mat
  const low = input.detail === 'low'
  const label = input.item.label || 'Blaster'
  const sp = legSpan(input, 0.5, CAR.width / 2 + 2.2)
  const mid = (sp.lo + sp.hi) / 2
  const fixed = new Group()
  const moving = new Group()
  const root = new Group()
  root.name = 'blaster'
  const turbo = { pipe: 0.07, cap: 'red' as Paint, turbo: true, low }
  // The steel is painted from the atlas too, so everything that stands still is one draw
  // call and everything that rocks is another.
  if (low) {
    fixed.add(block(kit, BL_TUBE, BL_TUBE, sp.hi - sp.lo + BL_TUBE, 'frame').translateY(BL_TOP - BL_TUBE / 2).translateZ(mid))
    for (const z of [sp.lo, sp.hi]) {
      fixed.add(block(kit, BL_TUBE, BL_TOP - BL_TUBE, BL_TUBE, 'frame').translateY((BL_TOP - BL_TUBE) / 2).translateZ(z))
      fixed.add(block(kit, BL_TUBE + 0.62, 0.06, BL_TUBE + 0.5, 'frame').translateY(0.03).translateZ(z))
    }
  } else fixed.add(paintAll(kit, kit.portalFrame({ z1: sp.lo, z2: sp.hi, height: BL_TOP, tube: BL_TUBE }), 'frame'))
  // Kickers fore and aft of each leg: this arch takes the push of its own jets.
  const kick = clamp(input.w / 2 - 0.3, 0.5, 1.2)
  for (const z of [sp.lo, sp.hi]) {
    for (const dir of [-1, 1]) {
      fixed.add(strut(kit, [dir * kick, 0.05, z], [dir * 0.12, 2.3, z], [0.16, 0.16], 'frame'))
      fixed.add(chip(kit, 0.44, 0.05, 0.5, 'frame', dir * kick, 0.025, z))
    }
  }

  // The cylinder that rocks a manifold, painted so it rides in the same mesh as the
  // manifold, its nozzles and its crank.
  const cylinder = () => lightCylinder(kit, { body: 0.6, stroke: 0.46, bore: 0.055, color: COLORS.aluminum, rodColor: COLORS.stainless })
  // The manifolds turn in place, so plain bars stand in for their shadows: one mesh for
  // all of them.
  const shades: BufferGeometry[] = []
  const shade = (len: number, x: number, y: number, z: number, along: 'y' | 'z') => {
    const g = new CylinderGeometry(0.08, 0.08, len, 5, 1, true)
    if (along === 'z') g.rotateX(Math.PI / 2)
    shades.push(g.translate(x, y, z))
  }

  // ---- The side manifolds ----
  const sides = (sp.over
    ? [{ z: sp.lo, d: 1 }, { z: sp.hi, d: -1 }]
    : sp.carZ < sp.lo ? [{ z: sp.lo, d: -1 }] : [{ z: sp.hi, d: 1 }]
  ).map(({ z, d }) => {
    const zm = z + d * 0.8
    for (const y of [0.92, 7.46]) {
      const za = z + (d * BL_TUBE) / 2
      const zb = zm + d * 0.16
      fixed.add(block(kit, 0.2, 0.1, Math.abs(zb - za), 'frame').translateY(y).translateZ((za + zb) / 2))
      // The pillow block the manifold turns in.
      const yb = y + (y < 4 ? 0.1 : -0.1)
      fixed.add(stub(kit, [0, yb - 0.06, zm], [0, yb + 0.06, zm], 0.13, 'dark', low ? 6 : 8))
    }
    // The outrigger its cylinder is pinned to.
    const ramZ = zm - d * BL_CRANK
    fixed.add(block(kit, 1.5 - BL_TUBE / 2, 0.12, 0.22, 'frame').translateX(-(1.5 + BL_TUBE / 2) / 2).translateY(BL_RAM_Y - 0.17).translateZ(z + d * 0.32))
    fixed.add(chip(kit, 0.12, 0.2, 0.1, 'dark', -1.3, BL_RAM_Y - 0.04, ramZ))
    const g = new Group()
    g.position.set(0, 0, zm)
    g.add(stub(kit, [0, 1.05, 0], [0, 7.35, 0], 0.07, 'black', low ? 6 : 8))
    g.add(stub(kit, [0, 7.33, 0], [0, 7.62, 0], 0.05, 'brass', low ? 5 : 6))
    g.add(block(kit, 0.14, 0.07, BL_CRANK + 0.14, 'black').translateY(BL_RAM_Y).translateZ((-d * BL_CRANK) / 2))
    g.add(stub(kit, [0, BL_RAM_Y - 0.08, -d * BL_CRANK], [0, BL_RAM_Y + 0.1, -d * BL_CRANK], 0.03, 'body', 5))
    const jets: Nozzle[] = []
    for (const y of low ? [1.5, 3.2, 4.9, 6.5] : [1.5, 2.55, 3.6, 4.65, 5.7, 6.6]) {
      jets.push({ at: nozzle(kit, g, [0, y, 0], 0, 0, d, turbo), dir: [0, -0.04, d] })
    }
    const spray = kit.spray({ kind: 'jet', nozzles: jets, reach: 4.4, spread: 0.05, seed: seedOf(label) + (d > 0 ? 1 : 2) })
    g.add(spray.root)
    shade(6.3, 0, 4.2, zm, 'y')
    const ram = cylinder()
    moving.add(g, ram.root)
    // A hoop on the floor between the wheels and the low nozzles.
    const gz = zm + d * 0.62
    const gx = clamp(input.w / 2 - 0.35, 0.6, 1.15)
    fixed.add(kit.paint(kit.tube([[-gx, 0.03, gz], [-gx, 1, gz], [gx, 1, gz], [gx, 0.03, gz]], 0.065, m.frame, { bend: 0.3, radial: low ? 5 : 6 }), 'yellow'))
    for (const x of [-gx, gx]) fixed.add(stub(kit, [x, 0, gz], [x, 0.05, gz], 0.14, 'yellow', 8))
    return { g, ram, spray, d, z, zm, ramZ }
  })

  // ---- The top manifold ----
  const topLo = Math.max(sp.lo + 1.5, sp.carZ - 4.2)
  const topHi = Math.min(sp.hi - 1.5, sp.carZ + 4.2)
  const buildTop = () => {
    const hangers = [topLo + 0.35, topHi - 0.35]
    if (topHi - topLo > 5) hangers.push(sp.carZ + 0.55)
    for (const z of hangers) {
      const hang = BL_TOP - BL_TUBE - (BL_TOP_Y + 0.1)
      fixed.add(block(kit, 0.14, hang, 0.1, 'frame').translateY(BL_TOP_Y + 0.1 + hang / 2).translateZ(z))
      fixed.add(stub(kit, [0, BL_TOP_Y, z - 0.06], [0, BL_TOP_Y, z + 0.06], 0.13, 'dark', low ? 6 : 8))
    }
    const ramZ = topLo + 0.1
    fixed.add(block(kit, 1.5 - BL_TUBE / 2, 0.2, 0.12, 'frame').translateX(-(1.5 + BL_TUBE / 2) / 2).translateY(BL_TOP - BL_TUBE / 2).translateZ(ramZ))
    const drop = BL_TOP - BL_TUBE / 2 - (BL_TOP_Y + BL_CRANK - 0.1)
    fixed.add(block(kit, 0.12, drop, 0.12, 'frame').translateX(-1.3).translateY(BL_TOP_Y + BL_CRANK - 0.1 + drop / 2).translateZ(ramZ))
    const g = new Group()
    g.position.set(0, BL_TOP_Y, 0)
    g.add(stub(kit, [0, 0, topLo], [0, 0, topHi], 0.07, 'black', low ? 6 : 8))
    g.add(stub(kit, [0, 0, topHi - 0.02], [0, 0, topHi + 0.22], 0.05, 'brass', low ? 5 : 6))
    g.add(block(kit, 0.07, BL_CRANK + 0.14, 0.14, 'black').translateY(BL_CRANK / 2).translateZ(ramZ))
    g.add(stub(kit, [0, BL_CRANK, ramZ - 0.09], [0, BL_CRANK, ramZ + 0.09], 0.03, 'body', 5))
    const jets: Nozzle[] = []
    const pitch = low ? 1.65 : 1.1
    const count = Math.max(1, Math.floor((Math.min(topHi - 0.5, sp.carZ + 3.4) - Math.max(topLo + 0.7, sp.carZ - 3.4)) / pitch) + 1)
    for (let k = 0; k < count; k++) {
      const z = sp.carZ + (k - (count - 1) / 2) * pitch
      jets.push({ at: nozzle(kit, g, [0, 0, z], 0, -1, 0, turbo), dir: [0, -1, 0] })
    }
    const spray = kit.spray({ kind: 'jet', nozzles: jets, reach: 5, spread: 0.05, seed: seedOf(label) })
    g.add(spray.root)
    shade(topHi - topLo, 0, BL_TOP_Y, (topLo + topHi) / 2, 'z')
    const ram = cylinder()
    moving.add(g, ram.root)
    return { g, ram, spray, ramZ }
  }
  const top = sp.over && topHi - topLo > 2.4 ? buildTop() : null

  // ---- High pressure hose ----
  // Up the outside of the passenger side leg (the leg away from the car, when the frame
  // stands beside it), around it under the header, then along the header's underside
  // with a drop to each manifold's swivel.
  const hoseR = 0.045
  const plumbed = sp.over || sides[0].z === sp.lo ? { z: sp.hi, out: 1 } : { z: sp.lo, out: -1 }
  const zo = plumbed.z + plumbed.out * (BL_TUBE / 2 + hoseR + 0.004)
  const under = BL_TOP - BL_TUBE - hoseR - 0.02
  // Where each drop leaves the header: over its manifold, or as near as the header goes.
  const drops = sides.map((s) => clamp(s.zm, sp.lo + 0.3, sp.hi - 0.3))
  let far = plumbed.z - plumbed.out * 1.2
  for (const z of drops) if ((far - z) * plumbed.out > 0) far = z
  fixed.add(kit.paint(kit.tube([[0, 0.03, zo], [0, 9.2, zo], [0.32, 9.2, zo], [0.32, 9.2, plumbed.z - plumbed.out * 0.4], [0.13, under, plumbed.z - plumbed.out * 0.95], [0.13, under, far]], hoseR, m.frame, { bend: 0.16, radial: low ? 5 : 6 }), 'hoseBlack'))
  if (!low) for (const y of [1.6, 4.2, 6.8]) fixed.add(chip(kit, 0.16, 0.06, 0.13, 'body', 0, y, zo))
  sides.forEach((s, k) => {
    fixed.add(kit.paint(kit.tube([[0.13, under, drops[k]], [0.13, 7.95, s.zm], [0, 7.62, s.zm]], hoseR * 0.85, m.frame, { bend: 0.16, radial: low ? 5 : 6 }), 'hoseBlack'))
  })
  if (top) {
    const z = topHi + 0.5
    fixed.add(kit.paint(kit.tube([[0.13, under, z], [0.13, BL_TOP_Y, z], [0, BL_TOP_Y, topHi + 0.2]], hoseR * 0.85, m.frame, { bend: 0.16, radial: low ? 5 : 6 }), 'hoseBlack'))
  }

  // The name on the header, facing both ways along the tunnel.
  namePlates(kit, fixed, label, plateLength(label, 1.8, clamp(sp.hi - sp.lo - 3, 1.4, 3.4)), 0.34, BL_TOP - BL_TUBE / 2, mid, BL_TUBE, false)

  // The pose: `side` and `over` are how far the side and top manifolds are turned.
  const pose = (side: number, over: number) => {
    for (let k = 0; k < sides.length; k++) {
      const s = sides[k]
      // Mirrored, so both sides aim up the tunnel together.
      const a = side * s.d
      s.g.rotation.y = a
      s.ram.aim(-1.3, BL_RAM_Y, s.ramZ, -s.d * BL_CRANK * Math.sin(a), BL_RAM_Y, s.zm - s.d * BL_CRANK * Math.cos(a))
    }
    if (top) {
      top.g.rotation.z = over
      top.ram.aim(-1.3, BL_TOP_Y + BL_CRANK, top.ramZ, -BL_CRANK * Math.sin(over), BL_TOP_Y + BL_CRANK * Math.cos(over), top.ramZ)
    }
  }
  pose(0, 0)
  const movers = sides.flatMap((s) => [s.g, s.ram.root, s.ram.rod])
  if (top) movers.push(top.g, top.ram.root, top.ram.rod)
  root.add(kit.mergeStatic(fixed), kit.mergeMoving(moving, movers))
  if (shades.length) {
    const merged = mergeGeometries(shades, false)
    for (const g of shades) g.dispose()
    root.add(kit.shadowOnly(new Mesh(merged, m.frame)))
  }

  // The legs with what stands inside them, and the header with what hangs under it.
  for (const s of sides) kit.pickBox(root, 1, BL_TOP, 1.7, 0, BL_TOP / 2, s.zm - s.d * 0.4)
  if (!sp.over) kit.pickBox(root, 0.8, BL_TOP, 0.8, 0, BL_TOP / 2, sides[0].d < 0 ? sp.hi : sp.lo)
  kit.pickBox(root, 0.9, top ? 2.1 : 0.8, sp.hi - sp.lo, 0, BL_TOP - (top ? 1.05 : 0.4), mid)

  return {
    root,
    height: BL_TOP,
    // On the passenger side corner: the hose turns in under the header, short of it.
    beacon: { x: 0, y: BL_TOP, z: sp.hi },
    update(st) {
      const a = st.running ? flowOf(st.activity) : 0
      // The swing grows with the flow, so the manifolds come to rest square.
      const phase = st.t * TAU * BL_HZ
      pose(BL_SWEEP * a * Math.sin(phase), BL_SWEEP * a * Math.sin(phase + 1.9))
      for (let k = 0; k < sides.length; k++) sides[k].spray.setActivity(a)
      if (top) top.spray.setActivity(a)
    },
  }
}

// ---- tire_shine: a tire dressing applicator -----------------------------------------------
//
// A long low black housing bolted to the floor along the wheel line, like a curb. A strip
// of blue foam pads on an aluminum bar waits against it under a drip rail that keeps it
// wet with dressing. As each wheel comes by, an air cylinder throws a pair of folding
// arms open and the strip slides out, level, until it wipes the tire's sidewall; then it
// folds back. The pads sit below the car's sills, so the body never touches them.

const TS_REST = 0.3 // how far the bar stands off the housing, folded
const TS_PAD = 0.33 // bar plus foam, front to back
const TS_TOP = 0.91
// The arms and the cylinder are stacked so they can fold over each other.
const TS_Y = { a1: 0.75, a2: 0.69, ram: 0.57, b2: 0.43, b1: 0.37 } as const
// Feet of car travel over which the strip goes out to meet a wheel.
const TS_RAMP = 2.6

export const tireShine: ModelBuilder = (input) => {
  const { kit } = input
  const m = kit.mat
  const low = input.detail === 'low'
  const label = input.item.label || 'Tire Shine'
  // +1: it stands on the passenger side and reaches toward the driver's side. -1: the mirror.
  // Beside the tunnel it stands on the side away from the tunnel and reaches toward it.
  const s = input.side === 'ps' ? 1 : input.side === 'ds' ? -1 : input.side === 'outside' ? awayFromTunnel(input.y, input.rotation) : input.y >= CAR.z ? 1 : -1
  const len = clamp(input.w, 2.4, 12) - 0.2
  const depth = clamp(input.h * 0.4, 0.4, 0.7)
  const zOuter = s * (input.h / 2 - 0.05)
  const zHouse = zOuter - (s * depth) / 2
  // The line the arms pivot on, just off the housing's inner face.
  const zPivot = zOuter - s * (depth + 0.06)

  // How far the bar has to travel for the foam to touch the tire's sidewall.
  const tire = CAR.z + s * (carHalfWidthAt(CAR.wheelbase / 2) - 0.08)
  // Beside the tunnel there is no tire: running, it holds the strip out as far as its own
  // footprint goes (up to 1.6 ft), so the pads stop at its far edge.
  const want = input.side === 'outside' ? Math.min(1.6, input.h / 2 + s * zPivot - TS_PAD) : s * (input.y + zPivot - tire) - TS_PAD
  const a = len / 2 - 0.3
  // Each arm is two links of this length, hinged in the middle.
  const L = clamp(want / 1.9, 0.55, len - 0.35)
  const far = clamp(want, TS_REST, L * 1.9)
  // The cylinder pushes the first link a little way out from its pivot. Farther out it
  // would need more stroke than its barrel is long.
  const ramBase = Math.min(1.8, a * 2 - 0.1)
  const angle = (r: number) => Math.atan2(r / 2, Math.sqrt(L * L - (r * r) / 4))
  const ramLen = (c: number, r: number) => Math.sqrt(ramBase * ramBase + c * c - 2 * ramBase * c * Math.cos(angle(r)))
  let ramAt = 0.6
  while (ramAt > 0.25 && ramLen(ramAt, far) - ramLen(ramAt, TS_REST) + 0.04 > ramLen(ramAt, TS_REST) - 0.6) ramAt -= 0.05
  // Folded, the cylinder is closed: its barrel plus 0.14 ft (see lightCylinder).
  const ramBody = Math.max(0.3, ramLen(ramAt, TS_REST) - 0.16)
  const ramStroke = Math.max(0.1, ramLen(ramAt, far) - ramLen(ramAt, TS_REST) + 0.04)

  // ---- The housing ----
  const fixed = new Group()
  // Eased edges where they catch the light up close, plain boxes on a phone.
  const shell = (w: number, h: number, d: number, r: number, color: Paint) => (low ? block(kit, w, h, d, color) : kit.paint(kit.box(w, h, d, m.frame, r), color))
  fixed.add(shell(len + 0.14, 0.06, depth + 0.24, 0.02, 'mid').translateY(0.03).translateZ(zHouse))
  fixed.add(shell(len, 0.78, depth, 0.05, 'dark').translateY(0.45).translateZ(zHouse))
  fixed.add(shell(len + 0.05, 0.07, depth + 0.06, 0.03, 'black').translateY(TS_TOP - 0.035).translateZ(zHouse))
  // Yellow ends: it is a curb people walk past.
  for (const dir of [-1, 1]) fixed.add(shell(0.1, 0.66, depth + 0.03, 0.03, 'yellow').translateX(dir * (len / 2)).translateY(0.42).translateZ(zHouse))
  // The lugs the arms and the cylinder are pinned to.
  for (const x of [-a, a]) fixed.add(chip(kit, 0.18, 0.52, 0.1, 'black', x, 0.56, zPivot + s * 0.03))
  fixed.add(chip(kit, 0.14, 0.16, 0.1, 'black', -a + ramBase, TS_Y.ram, zPivot + s * 0.03))
  // The drip rail over the pads' resting place, and the dressing line that feeds it.
  const zDrip = zPivot - s * (TS_REST + 0.2)
  const dripX = len / 2 - 0.25
  fixed.add(kit.paint(kit.tube([[-dripX, 1.02, zDrip], [dripX, 1.02, zDrip]], 0.024, m.frame, { radial: 6 }), 'body'))
  for (const x of [-dripX + 0.25, dripX - 0.25]) {
    fixed.add(chip(kit, 0.05, 0.14, 0.05, 'black', x, TS_TOP + 0.05, zPivot + s * 0.12))
    fixed.add(chip(kit, 0.05, 0.04, Math.abs(zPivot + s * 0.12 - zDrip) + 0.05, 'black', x, 1.02, (zPivot + s * 0.12 + zDrip) / 2))
  }
  if (!low) {
    const tips = Math.max(2, Math.round((dripX * 2) / 0.45))
    for (let k = 0; k < tips; k++) {
      const x = -dripX + 0.2 + ((dripX * 2 - 0.4) * k) / (tips - 1)
      fixed.add(stub(kit, [x, 1.0, zDrip], [x, 0.93, zDrip], 0.016, 'brass', 5, true))
    }
  }
  const lineX = -dripX + 0.06
  fixed.add(kit.paint(kit.tube([[lineX, 0.03, zOuter + s * 0.03], [lineX, 1.02, zOuter + s * 0.03], [lineX, 1.02, zDrip]], 0.02, m.frame, { bend: 0.1, radial: 6 }), 'green'))
  // The air regulator, and the line from it to the cylinder.
  const regX = len / 2 - 0.4
  fixed.add(shell(0.4, 0.26, Math.min(0.32, depth - 0.1), 0.03, 'body').translateX(regX).translateY(TS_TOP + 0.13).translateZ(zHouse))
  fixed.add(stub(kit, [regX, TS_TOP + 0.26, zHouse], [regX, TS_TOP + 0.29, zHouse], 0.075, 'white', low ? 6 : 8))
  fixed.add(kit.paint(kit.tube([[regX - 0.1, TS_TOP + 0.1, zHouse - s * 0.1], [regX - 0.1, TS_TOP + 0.1, zPivot - s * 0.03], [-a + ramBase + 0.05, TS_Y.ram + 0.06, zPivot - s * 0.03]], 0.016, m.frame, { bend: 0.06, radial: 5 }), 'hoseBlue'))
  // The name lies on the lid, to be read from the passenger side.
  const signLen = Math.min(len - 0.9, plateLength(label, 1.2, 2.3))
  const sign = kit.sign(label, signLen, 0.24)
  sign.rotation.x = -Math.PI / 2
  sign.position.set(Math.min(0, regX - 0.3 - signLen / 2), TS_TOP + 0.012, zHouse)
  fixed.add(sign)

  // ---- The pad strip and what carries it ----
  const moving = new Group()
  // The bar's origin is on the line its two wrists are pinned on.
  const strip = new Group()
  // The bar is painted aluminum, so all that moves is one draw call.
  strip.add(shell(len, 0.54, 0.07, 0.015, COLORS.aluminum).translateY(0.53).translateZ(-s * 0.035))
  const pads = low ? 1 : Math.max(3, Math.round(len / 0.7))
  for (let k = 0; k < pads; k++) {
    const x = -len / 2 + (len / pads) * (k + 0.5)
    strip.add(shell(len / pads - 0.035, 0.5, TS_PAD - 0.07, 0.07, COLORS.cloth).translateX(x).translateY(0.53).translateZ(-s * (0.07 + (TS_PAD - 0.07) / 2)))
  }
  for (const x of [-a, a]) strip.add(chip(kit, 0.14, 0.5, 0.06, 'black', x, 0.56, s * 0.02))
  // A link is a flat bar built along its own +X from the pin it turns on.
  const link = (y: number) => {
    const g = new Group()
    g.position.y = y
    g.add(block(kit, L + 0.14, 0.055, 0.14, 'black').translateX(L / 2))
    g.add(stub(kit, [0, -0.04, 0], [0, 0.04, 0], 0.035, 'body', low ? 5 : 6), stub(kit, [L, -0.04, 0], [L, 0.04, 0], 0.035, 'body', low ? 5 : 6))
    return g
  }
  const a1 = link(TS_Y.a1)
  const a2 = link(TS_Y.a2)
  const b1 = link(TS_Y.b1)
  const b2 = link(TS_Y.b2)
  a1.position.set(-a, TS_Y.a1, zPivot)
  b1.position.set(a, TS_Y.b1, zPivot)
  a1.add(stub(kit, [ramAt, TS_Y.ram - TS_Y.a1 - 0.06, 0], [ramAt, 0, 0], 0.024, 'body', 5))
  const ram = lightCylinder(kit, { body: ramBody, stroke: ramStroke, bore: 0.05, color: COLORS.aluminum, rodColor: COLORS.stainless })
  moving.add(strip, a1, a2, b1, b2, ram.root)
  kit.blob(strip, len, TS_PAD, { shape: 'box', cast: 0.8, z: (-s * TS_PAD) / 2 })

  // ext 0: folded against the housing. 1: out against the tire.
  const pose = (ext: number) => {
    const r = TS_REST + (far - TS_REST) * ext
    const run = Math.sqrt(L * L - (r * r) / 4)
    const half = (s * r) / 2
    const out = Math.atan2(half, run)
    const back = Math.atan2(half, -run)
    a1.rotation.y = out
    a2.position.set(-a + run, TS_Y.a2, zPivot - half)
    a2.rotation.y = back
    b1.rotation.y = back
    b2.position.set(a - run, TS_Y.b2, zPivot - half)
    b2.rotation.y = out
    strip.position.z = zPivot - s * r
    ram.aim(-a + ramBase, TS_Y.ram, zPivot, -a + (ramAt * run) / L, TS_Y.ram, zPivot - (ramAt * half) / L)
  }
  pose(0)

  const root = new Group()
  root.name = 'tire-shine'
  root.add(kit.mergeStatic(fixed), kit.mergeMoving(moving, [strip, a1, a2, b1, b2, ram.root, ram.rod]))
  kit.pickBox(root, len + 0.1, 1.1, depth + TS_REST + TS_PAD + 0.1, 0, 0.55, zOuter - (s * (depth + TS_REST + TS_PAD + 0.1)) / 2)
  kit.pickBox(strip, len, 0.7, TS_PAD + 0.1, 0, 0.5, (-s * TS_PAD) / 2)

  const axle = CAR.wheelbase / 2
  // A wheel's hub is this far off when the strip starts out for it.
  const reach = len / 2 + CAR.wheelRadius + TS_RAMP
  return {
    root,
    height: TS_TOP + 0.3,
    beacon: { x: -len / 2 + 0.3, y: TS_TOP, z: zHouse },
    update(st) {
      let ext = st.running ? st.activity : 0
      if (ext > 0 && st.carDx != null) {
        // Out for the nearer wheel, back in between the two.
        const near = Math.min(Math.abs(st.carDx + axle), Math.abs(st.carDx - axle))
        const k = clamp((reach - near) / TS_RAMP, 0, 1)
        ext *= k * k * (3 - 2 * k)
      }
      pose(ext)
    },
  }
}
