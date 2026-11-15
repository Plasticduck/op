import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, Vector2, Vector3 } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { COLORS } from '../kit'
import type { Kit, Lamp, Paint, V3 } from '../kit'
import { bentPath, spanBetween } from '../kit/geometry'
import type { ModelInput, RunState } from '../types'

// What the back room's machines are built from: tanks, drums, motors, gauges, fans,
// control boxes, pilot lights, and what every design shares. The designs in
// backroomAir.ts, backroomWater.ts, backroomPlant.ts and backroomVacuum.ts arrange them
// into machines. Everything is made from the kit's shapes and materials, so the back room
// looks like the same product line as the tunnel.
//
// Three habits keep a machine cheap. Painted parts (frames, tanks, motors, plastic) take a
// flat color from the sign atlas, so they all share the sign material and one draw call;
// only bare metal uses a material of its own. Small parts are plain boxes and cylinders,
// not beveled ones: a bevel nobody can see is wasted. And small parts cast no shadow: in a
// shadow map spread over the whole drawing theirs would be a speck, and the triangles of
// everything that does cast are drawn a second time for it.

// A flat color from the sign atlas (a named swatch or a hex), or one of the kit's materials.
export type Skin = Paint | Material
export type Axis = 'x' | 'y' | 'z'
// Which way a part faces across the floor.
export type Heading = '+x' | '-x' | '+z' | '-z'
export type Tick = (s: RunState) => void

// The few colors the back room adds to the atlas's named ones.
export const TONE = {
  drum: COLORS.drumBlue,
  // Stainless, painted: the same color without a material (and a draw call) of its own.
  steel: COLORS.stainless,
  copper: '#b0764a',
  orange: '#e8792b',
  purple: '#7c3aed',
  teal: '#1fa5b8',
  pink: '#e86aa6',
  slate: '#5b7699',
} as const

const HALF = Math.PI / 2
// How far a gauge's needle swings either side of straight up.
const SWEEP = 2.25
const UP = new Vector3(0, 1, 0)
const _dir = new Vector3()

const YAW: Record<Heading, number> = { '+x': 0, '-x': Math.PI, '+z': -HALF, '-z': HALF }
export const DIR: Record<Heading, readonly [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }

// The path of a belt around two pulleys that turn in a plane of constant z.
export function beltLoop(ax: number, ay: number, ra: number, bx: number, by: number, rb: number, z: number, steps = 8): V3[] {
  const base = Math.atan2(by - ay, bx - ax)
  const lean = Math.asin(Math.min(1, Math.max(-1, (ra - rb) / Math.hypot(bx - ax, by - ay))))
  const pts: V3[] = []
  const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
    for (let k = 0; k <= steps; k++) {
      const a = from + ((to - from) * k) / steps
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z])
    }
  }
  arc(ax, ay, ra, base + HALF - lean, base + 3 * HALF + lean)
  arc(bx, by, rb, base - HALF + lean, base + HALF - lean)
  pts.push(pts[0])
  return pts
}

export type Rig = ReturnType<typeof createRig>

// One machine under construction: the group of parts that never move, the group of
// parts that do, and the shapes both are made of. Every shape takes the group it goes
// into first, then its size, its skin and where its center sits. finish() merges it all.
export function createRig(kit: Kit, detail: 'high' | 'low') {
  const low = detail === 'low'
  const fixed = new Group()
  const moving = new Group()
  // Small parts hung on the fixed group: fittings, gauges, thin lines, name plates. They
  // ride in the moving mesh, which casts no shadow, or in the fixed one when nothing
  // moves, because a draw call of their own would cost more than their shadow does.
  const fine = new Group()
  const movers: Object3D[] = []
  const ticks: Tick[] = []
  const lights: Group[] = []
  const lightOf = new Map<Lamp, Group>()

  const matOf = (skin: Skin): Material => (typeof skin === 'string' ? kit.mat.sign : skin)
  const dress = (mesh: Mesh, skin: Skin): Mesh => {
    if (typeof skin === 'string') kit.swatch(mesh.geometry, skin)
    return mesh
  }
  const put = (p: Object3D, mesh: Mesh, x: number, y: number, z: number): Mesh => {
    mesh.position.set(x, y, z)
    p.add(mesh)
    return mesh
  }
  const solid = (geo: BufferGeometry, skin: Skin): Mesh => {
    const mesh = dress(new Mesh(geo, matOf(skin)), skin)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
  // Lays something built along +Y along another axis.
  const lay = <T extends Object3D>(o: T, axis: Axis): T => {
    if (axis === 'x') o.rotation.z = -HALF
    else if (axis === 'z') o.rotation.x = HALF
    return o
  }
  // A small part hung straight on the fixed group goes with the small parts.
  const home = (p: Object3D, small: boolean): Object3D => (small && p === fixed ? fine : p)
  // Fewer sides on round things for phones.
  const seg = (n: number) => (low ? Math.max(6, Math.round(n * 0.6)) : n)
  const sides = (r: number) => seg(r > 0.6 ? 24 : r > 0.3 ? 16 : r > 0.12 ? 12 : 8)
  const thin = (n: number) => (low ? Math.max(3, Math.round(n * 0.7)) : n)

  // A beveled box: for anything big enough to catch the light on its edges. A thin one,
  // or a small one on a phone, keeps square edges.
  const box = (p: Object3D, w: number, h: number, d: number, skin: Skin, x: number, y: number, z: number, r?: number) =>
    Math.min(w, h, d) < 0.12 || (low && Math.max(w, h, d) < 1.6)
      ? put(p, solid(new BoxGeometry(w, h, d), skin), x, y, z)
      : put(p, dress(kit.box(w, h, d, matOf(skin), r), skin), x, y, z)
  // A plain box: fins, brackets, handles, feet.
  const chip = (p: Object3D, w: number, h: number, d: number, skin: Skin, x: number, y: number, z: number) =>
    put(home(p, Math.max(w, h, d) < 0.4), solid(new BoxGeometry(w, h, d), skin), x, y, z)
  // A square member between two points that differ along one axis only: frame legs, rails.
  const strut = (p: Object3D, a: V3, b: V3, size: number, skin: Skin) =>
    put(p, solid(new BoxGeometry(Math.abs(b[0] - a[0]) || size, Math.abs(b[1] - a[1]) || size, Math.abs(b[2] - a[2]) || size), skin), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
  // A round part with chamfered ends. A smaller one with no bevel or taper asked for is
  // a plain cylinder: its chamfer would be under a pixel.
  const cyl = (p: Object3D, r: number, len: number, skin: Skin, x: number, y: number, z: number, axis: Axis = 'y', o: { r2?: number; bevel?: number; radial?: number } = {}) => {
    const n = o.radial ?? sides(Math.max(r, o.r2 ?? r))
    const mesh = r < 0.3 && o.bevel === undefined && o.r2 === undefined
      ? solid(new CylinderGeometry(r, r, len, n), skin)
      : dress(kit.cyl(r, len, matOf(skin), { ...o, radial: n }), skin)
    return put(home(p, (r < 0.12 && len < 0.6) || (r < 0.3 && len < 0.25)), lay(mesh, axis), x, y, z)
  }
  // Round line through the points, its corners rounded to o.bend. The corners are rounded
  // here, in fewer steps than the kit's own: a thin line needs three to look bent.
  const tube = (p: Object3D, pts: ReadonlyArray<V3>, r: number, skin: Skin, o: { bend?: number; radial?: number; caps?: boolean } = {}) => {
    const bend = o.bend ?? 0
    const path: ReadonlyArray<V3> = bend > 0
      ? bentPath(pts, bend, r > 0.12 ? (low ? 3 : 5) : (low ? 2 : 3)).map((v): V3 => [v.x, v.y, v.z])
      : pts
    const radial = thin(o.radial ?? (r > 0.2 ? 12 : r > 0.1 ? 10 : r > 0.05 ? 6 : 4))
    const mesh = dress(kit.tube(path, r, matOf(skin), { bend: 0, radial, caps: o.caps }), skin)
    home(p, r < 0.05).add(mesh)
    return mesh
  }
  // A square member from a to b at any angle: braces. A thin one has square edges.
  const beam = (p: Object3D, a: V3, b: V3, size: number, skin: Skin) => {
    let mesh: Mesh
    if (size < 0.15) {
      mesh = solid(new BoxGeometry(size, 1, size), skin)
      mesh.scale.y = spanBetween(mesh, a[0], a[1], a[2], b[0], b[1], b[2])
    } else mesh = dress(kit.beam(a, b, size, matOf(skin), 0.02), skin)
    p.add(mesh)
    return mesh
  }
  // A plain cylinder with square ends (well under half the triangles of a chamfered one):
  // stems, shafts, bungs, anything too small for its edge to show.
  const peg = (p: Object3D, r: number, len: number, skin: Skin, x: number, y: number, z: number, axis: Axis = 'y', radial = 8) =>
    put(home(p, r < 0.1 && len < 0.6), lay(solid(new CylinderGeometry(r, r, len, thin(radial)), skin), axis), x, y, z)
  // The same from a to b: guard wires, stand-offs, legs.
  const rod = (p: Object3D, a: V3, b: V3, r: number, skin: Skin) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const mesh = solid(new CylinderGeometry(r, r, len, thin(r > 0.05 ? 8 : 5)), skin)
    mesh.quaternion.setFromUnitVectors(UP, _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).divideScalar(len || 1))
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
    home(p, r < 0.03).add(mesh)
    return mesh
  }

  // A pressure vessel: a cylinder with dished ends. ribs are raised hoops, each given as
  // a share of the way along the straight wall (left off on phones). flat leaves the
  // bottom end square.
  const tank = (p: Object3D, r: number, len: number, skin: Skin, x: number, y: number, z: number, axis: Axis = 'y', o: { head?: number; radial?: number; ribs?: ReadonlyArray<number>; flat?: boolean } = {}) => {
    const head = Math.min(o.head ?? r * 0.5, len / 2)
    const steps = low ? 2 : 4
    const pts: Vector2[] = []
    if (o.flat) pts.push(new Vector2(0, -len / 2), new Vector2(r - 0.05, -len / 2), new Vector2(r, -len / 2 + 0.05))
    else {
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * HALF
        pts.push(new Vector2(Math.sin(a) * r, -len / 2 + head * (1 - Math.cos(a))))
      }
    }
    const from = -len / 2 + (o.flat ? 0.05 : head)
    const wall = len / 2 - head - from
    for (const t of low ? [] : (o.ribs ?? [])) {
      const at = from + wall * t
      pts.push(new Vector2(r, at - 0.09), new Vector2(r + 0.04, at - 0.05), new Vector2(r + 0.04, at + 0.05), new Vector2(r, at + 0.09))
    }
    for (let k = steps; k >= 0; k--) {
      const a = (k / steps) * HALF
      pts.push(new Vector2(Math.sin(a) * r, len / 2 - head * (1 - Math.cos(a))))
    }
    const n = o.radial ?? (r > 0.7 ? (low ? 14 : 24) : (low ? 10 : 16))
    return put(p, lay(solid(new LatheGeometry(pts, n), skin), axis), x, y, z)
  }

  // A hollow ring: a fan shroud, a wheel's rim, a pipe collar.
  const band = (p: Object3D, inner: number, outer: number, len: number, skin: Skin, x: number, y: number, z: number, axis: Axis = 'y') => {
    const pts = [new Vector2(inner, -len / 2), new Vector2(outer, -len / 2), new Vector2(outer, len / 2), new Vector2(inner, len / 2), new Vector2(inner, -len / 2)]
    return put(p, lay(solid(new LatheGeometry(pts, seg(outer > 0.5 ? 16 : 12)), skin), axis), x, y, z)
  }

  // A 55 gallon drum standing on y: two rolling hoops and a rim (a plain can on phones),
  // and a bung or two.
  const drum = (p: Object3D, x: number, y: number, z: number, skin: Skin = TONE.drum, scale = 1) => {
    const r = 0.96 * scale
    const h = 2.9 * scale
    const hoop = (at: number) => [new Vector2(r, h * (at - 0.03)), new Vector2(r + 0.035, h * at), new Vector2(r, h * (at + 0.03))]
    const pts = low
      ? [new Vector2(0, 0), new Vector2(r, 0), new Vector2(r, h), new Vector2(r - 0.08, h - 0.07), new Vector2(0, h - 0.07)]
      : [
          new Vector2(0, 0), new Vector2(r - 0.04, 0), new Vector2(r, 0.05),
          ...hoop(0.34), ...hoop(0.66),
          new Vector2(r, h - 0.05), new Vector2(r - 0.03, h), new Vector2(r - 0.09, h - 0.07), new Vector2(0, h - 0.07),
        ]
    put(p, solid(new LatheGeometry(pts, low ? 10 : 16), skin), x, y, z)
    peg(p, 0.11 * scale, 0.07, 'white', x - r * 0.55, y + h - 0.04, z)
    if (!low) peg(p, 0.06 * scale, 0.06, 'white', x + r * 0.55, y + h - 0.04, z, 'y', 6)
    return h
  }

  // A dial gauge facing `face`, on a short stem. With needle true it returns the needle
  // for setNeedle below; otherwise the needle is painted on, standing at `at` (0 to 1).
  const gauge = (x: number, y: number, z: number, r: number, face: Heading = '+z', needle = true, at = 0.6): Group | null => {
    const g = new Group()
    g.position.set(x, y, z)
    g.rotation.y = YAW[face] + HALF
    fine.add(g)
    const n = low ? 8 : 12
    put(g, lay(solid(new CylinderGeometry(r, r, r * 0.5, n), 'dark'), 'z'), 0, 0, 0)
    put(g, solid(new CircleGeometry(r * 0.84, n), 'white'), 0, 0, r * 0.25 + 0.003)
    peg(g, r * 0.2, r * 0.7, 'brass', 0, -r * 1.3, 0, 'y', 6)
    if (!needle) {
      chip(g, r * 0.1, r * 0.74, 0.008, 'red', 0, 0, r * 0.25 + 0.014).rotation.z = SWEEP - 2 * SWEEP * at
      return null
    }
    const hold = new Group()
    hold.position.copy(g.position)
    hold.rotation.copy(g.rotation)
    moving.add(hold)
    const hand = new Group()
    hand.position.z = r * 0.25 + 0.014
    hold.add(hand)
    chip(hand, r * 0.1, r * 0.78, 0.008, 'red', 0, r * 0.28, 0)
    hand.rotation.z = SWEEP
    movers.push(hand)
    return hand
  }

  // Something that spins about `axis`: a fan (pitched blades) or, with rim, a spoked
  // wheel. p must be the moving group or a group inside it. Turn the returned group
  // about its own y.
  const rotor = (p: Object3D, x: number, y: number, z: number, r: number, axis: Axis, o: { blades?: number; thick?: number; skin?: Skin; rim?: boolean } = {}): Group => {
    const hold = lay(new Group(), axis)
    hold.position.set(x, y, z)
    p.add(hold)
    const spin = new Group()
    hold.add(spin)
    movers.push(spin)
    const skin = o.skin ?? 'dark'
    const t = o.thick ?? r * 0.2
    const n = o.blades ?? 5
    peg(spin, r * 0.24, t * 1.4, skin, 0, 0, 0, 'y', 10)
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      const blade = chip(spin, r * 0.74, t * (o.rim ? 0.6 : 0.2), r * (o.rim ? 0.15 : 0.36), skin, Math.cos(a) * r * 0.55, 0, Math.sin(a) * r * 0.55)
      // Pitch first, about the blade's own length, then swing it out to its place.
      blade.rotation.set(o.rim ? 0 : 0.55, -a, 0, 'YXZ')
    }
    if (o.rim) band(spin, r * 0.84, r, t, skin, 0, 0, 0, 'y')
    return spin
  }

  // An electric motor lying down, its shaft pointing along `shaft`: finned can, end bells,
  // terminal box, feet. With fan set to a group (the moving group or one inside it) the
  // cowl at the back is open and the cooling fan in it is returned, to spin. Give the
  // same parent as p when p moves.
  const motor = (p: Object3D, x: number, y: number, z: number, r: number, len: number, shaft: Heading, o: { skin?: Skin; fan?: Object3D; feet?: boolean } = {}): Group | null => {
    const skin = o.skin ?? 'dark'
    const g = new Group()
    g.position.set(x, y, z)
    g.rotation.y = YAW[shaft]
    p.add(g)
    cyl(g, r, len, skin, 0, 0, 0, 'x', { bevel: r * 0.1 })
    cyl(g, r * 0.55, r * 0.3, skin, len / 2 + r * 0.12, 0, 0, 'x')
    peg(g, r * 0.16, r * 0.7, 'mid', len / 2 + r * 0.5, 0, 0, 'x')
    if (!low) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        chip(g, len * 0.78, 0.025, r * 0.16, skin, 0, Math.cos(a) * (r + 0.02), Math.sin(a) * (r + 0.02)).rotation.x = a - HALF
      }
    }
    chip(g, r * 0.95, r * 0.5, r * 0.8, skin, len * 0.05, r + r * 0.18, 0)
    if (o.feet !== false) {
      for (const sx of [-1, 1]) chip(g, r * 0.3, r * 0.3, r * 2.1, skin, sx * len * 0.3, -r - r * 0.1, 0)
    }
    if (!o.fan) {
      cyl(g, r * 1.04, r * 0.6, skin, -len / 2 - r * 0.24, 0, 0, 'x', { bevel: r * 0.22 })
      return null
    }
    band(g, r * 0.9, r * 1.04, r * 0.6, skin, -len / 2 - r * 0.26, 0, 0, 'x')
    const [dx, dz] = DIR[shaft]
    const back = len / 2 + r * 0.3
    return rotor(o.fan, x - dx * back, y, z - dz * back, r * 0.86, dx ? 'x' : 'z', { skin: 'mid', blades: 6, thick: r * 0.3 })
  }

  // The same motor standing on end, shaft down, as on a vertical pump.
  const motorUp = (p: Object3D, x: number, y: number, z: number, r: number, len: number, skin: Skin = 'dark') => {
    cyl(p, r, len, skin, x, y + len / 2, z, 'y', { bevel: r * 0.1 })
    cyl(p, r * 1.04, r * 0.6, skin, x, y + len + r * 0.24, z, 'y', { bevel: r * 0.22 })
    if (!low) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        chip(p, 0.025, len * 0.78, r * 0.16, skin, x + Math.cos(a) * (r + 0.02), y + len / 2, z + Math.sin(a) * (r + 0.02)).rotation.y = -a + HALF
      }
    }
    chip(p, r * 0.8, r * 0.95, r * 0.5, skin, x, y + len * 0.55, z + r + r * 0.18)
    return y + len + r * 0.54
  }

  // A control box facing +z: body, a door standing a little proud of it, a handle.
  const cabinet = (p: Object3D, w: number, h: number, d: number, skin: Skin, x: number, y: number, z: number, o: { door?: boolean; handle?: boolean } = {}) => {
    box(p, w, h, d, skin, x, y, z, 0.03)
    if (o.door !== false) box(p, w - 0.12, h - 0.12, 0.04, skin, x, y, z + d / 2 + 0.012, 0.015)
    if (o.handle !== false) chip(p, 0.05, Math.min(0.5, h * 0.3), 0.05, 'dark', x + w / 2 - 0.16, y, z + d / 2 + 0.06)
  }

  // A quarter-turn valve on a pipe that runs along `along`, with a lever in its color.
  const valve = (p: Object3D, x: number, y: number, z: number, along: Axis, size: number, color: Paint = 'red') => {
    const q = home(p, true)
    peg(q, size * 1.5, size * 2.6, 'mid', x, y, z, along)
    peg(q, size * 0.7, size * 1.6, 'mid', x, y + (along === 'y' ? 0 : size * 1.6), z + (along === 'y' ? size * 1.6 : 0), along === 'y' ? 'z' : 'y', 6)
    if (along === 'y') chip(q, size * 0.8, size * 5, size * 0.5, color, x, y + size * 2, z + size * 2.6)
    else chip(q, along === 'x' ? size * 5 : size * 0.8, size * 0.5, along === 'x' ? size * 0.8 : size * 5, color, x + (along === 'x' ? size * 2 : 0), y + size * 2.6, z + (along === 'z' ? size * 2 : 0))
  }

  // The machine's name on a plate with a backing, facing `face`.
  const plate = (p: Object3D, text: string, w: number, h: number, x: number, y: number, z: number, face: Heading = '+z') => {
    const g = new Group()
    g.position.set(x, y, z)
    g.rotation.y = YAW[face] + HALF
    home(p, true).add(g)
    chip(g, w + 0.07, h + 0.07, 0.03, 'black', 0, 0, -0.018)
    g.add(kit.sign(text, w, h))
  }

  // A pilot light facing `face` (or straight up). Lit, its lens is a mesh of its own, out
  // of the merge so it can glow; dark, that mesh hides and the dark lens painted under it
  // shows, so a light that's off costs nothing. Lenses that always switch together can
  // share one light (pass the first as `join`): one draw call between them.
  const pilot = (color: 'green' | 'amber' | 'red', x: number, y: number, z: number, r = 0.07, face: Heading | 'up' = '+z', join?: Lamp): Lamp => {
    const at = (parent: Object3D) => {
      const g = new Group()
      g.position.set(x, y, z)
      if (face !== 'up') {
        g.rotation.order = 'YXZ'
        g.rotation.set(HALF, YAW[face] + HALF, 0)
      }
      parent.add(g)
      return g
    }
    const n = low ? 8 : 12
    put(at(fine), solid(new CylinderGeometry(r, r, r * 0.9, n), COLORS.lensOff), 0, r * 0.45, 0)
    let light = join ? lightOf.get(join) : undefined
    let lamp = join
    if (!light || !lamp) {
      const g = new Group()
      g.name = 'pilot'
      g.userData.keep = true
      g.visible = false
      fixed.add(g)
      lights.push(g)
      light = g
      lamp = { root: g, set: (on) => { g.visible = on } }
      lightOf.set(lamp, g)
    }
    const lens = new Mesh(new CylinderGeometry(r * 1.06, r * 1.06, r * 0.96, n), color === 'green' ? kit.mat.lensGreen : color === 'amber' ? kit.mat.lensAmber : kit.mat.lensRed)
    put(at(light), lens, 0, r * 0.48, 0)
    return lamp
  }

  // Merges the machine into `into`: the fixed parts into one mesh per material, the
  // moving and small parts into one skinned mesh (it casts no shadow), each light's
  // lenses into one mesh.
  const finish = (into: Object3D) => {
    for (const light of lights) kit.mergeStatic(light)
    ;(movers.length ? moving : fixed).add(fine)
    into.add(kit.mergeStatic(fixed))
    if (movers.length) into.add(kit.mergeMoving(moving, movers))
  }

  return { kit, low, fixed, moving, movers, ticks, seg, box, chip, strut, cyl, peg, tube, beam, rod, tank, band, drum, gauge, rotor, motor, motorUp, cabinet, valve, plate, pilot, finish }
}

// Points a gauge's needle: v runs from 0 (resting on its pin) to 1 (full scale).
export function setNeedle(hand: Object3D | null, v: number) {
  if (hand) hand.rotation.z = SWEEP - 2 * SWEEP * Math.min(1, Math.max(0, v))
}

// ---- Designs ---------------------------------------------------------------------------
// What every machine design shares: the floor it is given, what it hands back, and the
// habits of a machine that runs (a flywheel turns, a needle holds, a light is lit).

export const TURN = Math.PI * 2

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const smooth = (v: number) => {
  const c = clamp(v, 0, 1)
  return c * c * (3 - 2 * c)
}
// How hard a machine is running: 0 when it is down, whatever else the state says.
export const power = (s: RunState) => (s.running ? s.activity : 0)

export type Frame = {
  // The floor the design may fill, in its own feet: W along its x, D along its z.
  W: number
  D: number
  label: string
  // -1 builds the mirror image, so twins standing side by side face each other.
  mirror: 1 | -1
  // Which way the lot lies (away from the tunnel), as the design sees it.
  lot: Heading
  // Where pick shapes and contact shadows go (it carries the fit).
  body: Group
}
export type Built = { height: number; beacon: V3 }
export type Design = {
  // The floor the design needs at full size, wide by deep.
  need: readonly [number, number]
  build(r: Rig, f: Frame): Built
}

// Which way the tunnel lies from a shape beside it, in the shape's own turned space.
export function towardTunnel(input: ModelInput): readonly [number, number] {
  const side = input.y >= 0 ? -1 : 1
  // The scene turns a shape beside the tunnel clockwise by its rotation.
  const th = input.side === 'outside' ? -(input.rotation * Math.PI) / 180 : 0
  return [Math.round(-side * Math.sin(th)), Math.round(side * Math.cos(th))]
}

// How wide a name plate needs to be for its text, within limits.
export const plateWidth = (label: string, lo: number, hi: number) => clamp(label.length * 0.19 + 0.5, lo, hi)

// Bare stainless, where it's what the machine is known by (a separator, a reclaim tank).
// It is a material of its own, so it costs a draw call and a shadow pass: on a phone it
// is painted the same color instead.
export const stainless = (r: Rig): Skin => (r.low ? TONE.steel : r.kit.mat.stainless)

// The patch of shadow where a machine meets the floor. It stands still and is in the
// shadow map, so this is only the dark line under its feet.
export const ground = (r: Rig, f: Frame, w: number, d: number, x = 0, z = 0, round = false) =>
  r.kit.blob(f.body, w, d, { x, z, shape: round ? 'round' : 'box', opacity: 0.5, soft: 0.7 })

// A fan or flywheel that turns while the machine runs. The angle is the one thing a
// machine remembers between frames, and nobody can see it in a still.
export function spin(r: Rig, part: Group, speed: number, start = 0) {
  let a = start
  r.ticks.push((s) => {
    a = (a + s.dt * power(s) * speed) % TURN
    part.rotation.y = a
  })
}
