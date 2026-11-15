import { BoxGeometry, Group, Mesh } from 'three'
import type { BufferGeometry, Material } from 'three'
import { boltGeo, cylGeo, gussetGeo, plateGeo, roundedBoxGeo, spanBetween } from './geometry'
import type { Materials } from './materials'

// Ready-made assemblies every machine shares: the square-tube portal, a base plate with
// its anchor bolts, a gearmotor, an air cylinder, a bearing. One visual language.
// Everything is returned as plain meshes for the model to merge.

function mk(geo: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, material)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export type BasePlateOpts = { t?: number; mat?: Material; boltMat?: Material; bolts?: boolean }

// A floor plate w (along X) by d, top at y = t, with a hex anchor bolt in each corner.
export function basePlate(mat: Materials, w: number, d: number, opts: BasePlateOpts = {}): Group {
  const t = opts.t ?? 0.06
  const g = new Group()
  g.add(mk(plateGeo(w, d, t, 0.1), opts.mat ?? mat.galvanized))
  if (opts.bolts !== false) {
    const inset = Math.min(0.16, w * 0.2, d * 0.2)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        g.add(mk(boltGeo(0.055, 0.07), opts.boltMat ?? mat.stainless, sx * (w / 2 - inset), t, sz * (d / 2 - inset)))
      }
    }
  }
  return g
}

export type PortalOpts = {
  // Where the two legs stand across the tunnel (their centers), and the top of the header.
  z1: number
  z2: number
  height: number
  // Side of the square tube. Default 5 in.
  tube?: number
  mat?: Material
  // Base plates and their bolts. Default: galvanized plates, stainless bolts.
  plateMat?: Material
  boltMat?: Material
  gussets?: boolean
  feet?: boolean
}

// The frame most tunnel equipment hangs from: two square legs, a header across them,
// gussets welded into the corners, each leg on a bolted base plate. It stands in the
// plane x = 0.
export function portalFrame(mat: Materials, o: PortalOpts): Group {
  const tube = o.tube ?? 0.42
  const m = o.mat ?? mat.frame
  const g = new Group()
  const plateT = o.feet === false ? 0 : 0.06
  const lo = Math.min(o.z1, o.z2)
  const hi = Math.max(o.z1, o.z2)
  const legH = o.height - tube - plateT
  g.add(mk(roundedBoxGeo(tube, tube, hi - lo + tube, 0.035), m, 0, o.height - tube / 2, (lo + hi) / 2))
  for (const z of [lo, hi]) {
    g.add(mk(roundedBoxGeo(tube, legH, tube, 0.035), m, 0, plateT + legH / 2, z))
    if (o.feet !== false) {
      const foot = basePlate(mat, tube + 0.62, tube + 0.5, { t: plateT, mat: o.plateMat, boltMat: o.boltMat })
      foot.position.set(0, 0, z)
      g.add(foot)
    }
    if (o.gussets !== false) {
      const inward = z === lo ? 1 : -1
      const gus = mk(gussetGeo(Math.min(0.95, (hi - lo) * 0.2), 0.05), m, 0, o.height - tube, z + (inward * tube) / 2)
      // The triangle's legs run inward along the header and down the leg.
      gus.rotation.y = (-inward * Math.PI) / 2
      gus.scale.y = -1
      g.add(gus)
    }
  }
  return g
}

export type MotorOpts = { r?: number; len?: number; gearbox?: boolean }

// A gearmotor standing on its output shaft (y = 0, shaft pointing down): gear case,
// finned can, fan cowl, terminal box. Turn the group to point it elsewhere.
export function motor(mat: Materials, o: MotorOpts = {}): Group {
  const r = o.r ?? 0.28
  const len = o.len ?? 0.8
  const g = new Group()
  let y = 0
  if (o.gearbox !== false) {
    const gh = r * 1.5
    g.add(mk(roundedBoxGeo(r * 2.3, gh, r * 2.3, 0.05), mat.motor, 0, gh / 2, 0))
    g.add(mk(cylGeo(r * 0.8, 0.08, { bevel: 0.015 }), mat.motor, 0, gh + 0.04, 0))
    y = gh + 0.08
  }
  g.add(mk(cylGeo(r, len, { bevel: 0.03 }), mat.motor, 0, y + len / 2, 0))
  // Cooling fins along the can.
  const fins = 14
  const fin = new BoxGeometry(0.03, len * 0.82, 0.07)
  for (let k = 0; k < fins; k++) {
    const a = (k / fins) * Math.PI * 2
    const f = mk(fin, mat.motor, Math.cos(a) * (r + 0.02), y + len / 2, Math.sin(a) * (r + 0.02))
    f.rotation.y = -a + Math.PI / 2
    g.add(f)
  }
  g.add(mk(cylGeo(r * 1.06, r * 0.75, { r2: r * 0.9, bevel: 0.05 }), mat.motor, 0, y + len + r * 0.36, 0))
  g.add(mk(roundedBoxGeo(r * 0.9, r * 0.8, r * 0.5, 0.03), mat.motor, 0, y + len * 0.55, r + r * 0.2))
  return g
}

export type AirCylinder = {
  // The barrel. Its base pin is the group's origin and it points along its own +Y.
  root: Group
  // The piston rod, a child of root that slides along it.
  rod: Group
  // Pins the base at a and the rod's end at b (in the space root was added to). Call it
  // each frame the two ends move. Allocates nothing.
  aim(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void
}

// A pneumatic cylinder between two pins: the thing that swings an arm in and out.
// body is the barrel's length, stroke how far the rod can come out of it.
export function airCylinder(mat: Materials, o: { body: number; stroke: number; bore?: number; mat?: Material; rodMat?: Material }): AirCylinder {
  const bore = o.bore ?? 0.1
  const m = o.mat ?? mat.aluminum
  const rodMat = o.rodMat ?? mat.stainless
  const root = new Group()
  const cap = bore * 2.5
  root.add(mk(roundedBoxGeo(cap * 0.55, 0.16, cap * 0.4, 0.02), m, 0, 0.04, 0))
  root.add(mk(roundedBoxGeo(cap, 0.1, cap, 0.02), m, 0, 0.16, 0))
  root.add(mk(cylGeo(bore, o.body, { bevel: 0.01 }), m, 0, 0.2 + o.body / 2, 0))
  root.add(mk(roundedBoxGeo(cap, 0.1, cap, 0.02), m, 0, 0.24 + o.body, 0))
  const rod = new Group()
  const rodLen = o.stroke + 0.3
  rod.add(mk(cylGeo(bore * 0.36, rodLen, { radial: 8 }), rodMat, 0, -rodLen / 2 - 0.08, 0))
  rod.add(mk(roundedBoxGeo(bore * 1.1, 0.2, bore * 0.9, 0.02), rodMat, 0, -0.04, 0))
  root.add(rod)
  const closed = 0.3 + o.body + 0.16
  return {
    root,
    rod,
    aim(ax, ay, az, bx, by, bz) {
      const len = spanBetween(root, ax, ay, az, bx, by, bz)
      root.position.set(ax, ay, az)
      // Never drawn shorter than the barrel or longer than the rod.
      rod.position.y = Math.min(closed + o.stroke, Math.max(closed, len))
    },
  }
}

// A flange bearing: the round housing a shaft or pivot pin turns in. Lies in the XZ
// plane, its pin along Y.
export function bearing(mat: Materials, r: number, material?: Material): Group {
  const m = material ?? mat.motor
  const g = new Group()
  g.add(mk(cylGeo(r, r * 0.4, { bevel: r * 0.08 }), m, 0, 0, 0))
  g.add(mk(cylGeo(r * 0.55, r * 0.75, { bevel: r * 0.06 }), m, 0, 0, 0))
  g.add(mk(cylGeo(r * 0.24, r * 1.0, { bevel: r * 0.04, radial: 8 }), mat.stainless, 0, 0, 0))
  return g
}
