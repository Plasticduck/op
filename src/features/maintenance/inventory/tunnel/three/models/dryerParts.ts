import { BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, CylinderGeometry, LatheGeometry, Mesh, PlaneGeometry, Vector2 } from 'three'
import type { Material } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { V3 } from '../kit'

// The shapes a dryer is made of that the kit has no helper for: the molded snail-shell
// housing, the duct that leaves it and flattens into a nozzle, the nozzle's mouth, the
// inlet ring and the wheel that turns behind it. Geometry only (plus `part`, which makes a
// mesh the way the kit does): models/dryers.ts gives them materials and places them. All
// sizes are feet.
//
// A producer's own frame: its shaft runs along X (the motor toward +X, the inlet toward
// -X), and seen from the inlet the housing is a spiral in the YZ plane.

const TAU = Math.PI * 2

// A mesh that casts and takes shadow, like every shape the kit makes.
export function part(geo: BufferGeometry, material: Material): Mesh {
  const mesh = new Mesh(geo, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

type Soup = { pos: number[]; idx: number[] }

// Turns the triangles added since `first` to face away from `inside` (or toward it).
// Measuring it once per band is what lets the same code build a duct along any path,
// mirrored or not, without a face ever coming out inside out.
function face(s: Soup, first: number, inside: V3, inward: boolean): void {
  const p = s.pos
  for (let t = first; t < s.idx.length; t += 3) {
    const a = s.idx[t] * 3
    const b = s.idx[t + 1] * 3
    const c = s.idx[t + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const wx = p[c] - p[a]
    const wy = p[c + 1] - p[a + 1]
    const wz = p[c + 2] - p[a + 2]
    const nx = uy * wz - uz * wy
    const ny = uz * wx - ux * wz
    const nz = ux * wy - uy * wx
    const out = nx * ((p[a] + p[b] + p[c]) / 3 - inside[0]) + ny * ((p[a + 1] + p[b + 1] + p[c + 1]) / 3 - inside[1]) + nz * ((p[a + 2] + p[b + 2] + p[c + 2]) / 3 - inside[2])
    // A sliver, or a face seen edge on from `inside`, says nothing: ask the next one.
    if (Math.abs(out) < 1e-9) continue
    if (out < 0 !== inward) {
      for (let q = first; q < s.idx.length; q += 3) {
        const keep = s.idx[q + 1]
        s.idx[q + 1] = s.idx[q + 2]
        s.idx[q + 2] = keep
      }
    }
    return
  }
}

// Joins two rings of n points (wound the same way) with a band of quads.
function band(s: Soup, a: number, b: number, n: number, inside: V3, inward = false): void {
  const first = s.idx.length
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n
    s.idx.push(a + k, b + k, a + k1, a + k1, b + k, b + k1)
  }
  face(s, first, inside, inward)
}

// Closes a ring of n points with a fan to a point in its middle.
function fan(s: Soup, ring: number, n: number, center: V3, inside: V3): void {
  const first = s.idx.length
  const c = s.pos.length / 3
  s.pos.push(center[0], center[1], center[2])
  for (let k = 0; k < n; k++) s.idx.push(c, ring + k, ring + ((k + 1) % n))
  face(s, first, inside, false)
}

function finish(s: Soup): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(s.pos), 3))
  g.setIndex(s.idx)
  // Rings that should meet at a hard edge are stored twice, so averaging the normals of
  // shared points rounds only what is meant to be round.
  g.computeVertexNormals()
  return g
}

export type ScrollOpts = {
  // The wall's radius where the spiral starts, behind the outlet, and where it ends.
  r0: number
  r1: number
  thick: number
  // Radius of the round inlet.
  eye: number
  bevel: number
  // Points around the wall.
  around: number
  // How deep the inlet goes before its floor.
  throat: number
}

// How much of the turn the wall takes to step back out from r0 to r1 behind the outlet.
// The duct covers it.
const TONGUE = 0.5

// The snail shell: a drum whose wall winds outward by one turn, with a round inlet in
// its front face. The outlet leaves at the top of the turn, along -Y from (y 0, z r1):
// the duct (ductGeo) is laid over it there. Flat faces and a tight chamfer: a molded
// housing, not a tire, which is what a round black drum reads as from across the room.
export function scrollGeo(o: ScrollOpts): BufferGeometry {
  const s: Soup = { pos: [], idx: [] }
  const n = o.around
  const hx = o.thick / 2
  const wall = (k: number, count: number): number => {
    const a = (k / count) * TAU
    const spiral = o.r0 + (o.r1 - o.r0) * (1 - a / TAU)
    const t = (a - (TAU - TONGUE)) / TONGUE
    return t <= 0 ? spiral : spiral + (o.r1 - spiral) * t * t * (3 - 2 * t)
  }
  const ring = (x: number, radius: (k: number, count: number) => number, count = n): number => {
    const start = s.pos.length / 3
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU
      const r = radius(k, count)
      s.pos.push(x, r * Math.sin(a), r * Math.cos(a))
    }
    return start
  }
  const mid: V3 = [0, 0, 0]
  const inset = (k: number, count: number) => wall(k, count) - o.bevel
  const eye = () => o.eye
  // Round parts need fewer points than the wall, which has the spiral to show.
  const m = Math.max(8, Math.round(n * 0.5))
  band(s, ring(-hx, eye), ring(-hx, inset), n, mid)
  // The wall, chamfered either side (bevel 0: square edges, two bands fewer). Each band
  // has its own points, so the wall shades flat across.
  const strip = (x0: number, r0: (k: number, count: number) => number, x1: number, r1: (k: number, count: number) => number) => band(s, ring(x0, r0), ring(x1, r1), n, mid)
  if (o.bevel > 0) strip(-hx, inset, -hx + o.bevel, wall)
  strip(-hx + o.bevel, wall, hx - o.bevel, wall)
  if (o.bevel > 0) strip(hx - o.bevel, wall, hx, inset)
  fan(s, ring(hx, inset), n, [hx, 0, 0], mid)
  // The inlet's own wall and floor, so nobody sees through the shell.
  const floor = -hx + o.throat
  band(s, ring(-hx, eye, m), ring(floor, eye, m), m, [floor, 0, 0], true)
  fan(s, ring(floor, eye, m), m, [floor, 0, 0], [hx, 0, 0])
  return finish(s)
}

// One cross-section of a duct: a rounded rectangle centered on `at`, ha either way along
// the unit vector a and hb either way along b.
export type DuctSection = { at: V3; a: V3; b: V3; ha: number; hb: number }

function sectionRing(s: Soup, c: DuctSection, corner: number, round: number, grow = 0, shift: V3 = [0, 0, 0]): number {
  const start = s.pos.length / 3
  const ha = Math.max(0.01, c.ha + grow)
  const hb = Math.max(0.01, c.hb + grow)
  const rr = Math.min(ha, hb) * round
  for (let q = 0; q < 4; q++) {
    const sa = q === 0 || q === 3 ? 1 : -1
    const sb = q < 2 ? 1 : -1
    for (let j = 0; j <= corner; j++) {
      const ang = ((q + j / corner) * Math.PI) / 2
      const pa = sa * (ha - rr) + rr * Math.cos(ang)
      const pb = sb * (hb - rr) + rr * Math.sin(ang)
      s.pos.push(
        c.at[0] + shift[0] + c.a[0] * pa + c.b[0] * pb,
        c.at[1] + shift[1] + c.a[1] * pa + c.b[1] * pb,
        c.at[2] + shift[2] + c.a[2] * pa + c.b[2] * pb,
      )
    }
  }
  return start
}

// A duct skinned over its cross-sections, open at both ends. corner is how many steps
// round each of its four corners; round is how far the corners are eased (1: the short
// side becomes a half circle).
export function ductGeo(sections: ReadonlyArray<DuctSection>, corner = 2, round = 0.6): BufferGeometry {
  const s: Soup = { pos: [], idx: [] }
  const n = 4 * (corner + 1)
  let last = -1
  for (let k = 0; k < sections.length; k++) {
    const ringAt = sectionRing(s, sections[k], corner, round)
    if (k > 0) {
      const p = sections[k - 1].at
      const q = sections[k].at
      band(s, last, ringAt, n, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2])
    }
    last = ringAt
  }
  return finish(s)
}

// A nozzle's mouth, to close the open end of a duct at section c, which blows along dir.
// lip: a trim band around the end and the face of the slot's edge. cap: the dark inside
// of the slot. With trim 0 there is no lip and the cap covers the whole end.
export function mouthGeo(c: DuctSection, dir: V3, trim: number, corner = 2, round = 0.6): { lip: BufferGeometry | null; cap: BufferGeometry } {
  const n = 4 * (corner + 1)
  const along = (d: number): V3 => [dir[0] * d, dir[1] * d, dir[2] * d]
  const behind: V3 = [c.at[0] - dir[0], c.at[1] - dir[1], c.at[2] - dir[2]]
  const capSoup: Soup = { pos: [], idx: [] }
  if (trim <= 0) {
    fan(capSoup, sectionRing(capSoup, c, corner, round), n, c.at, behind)
    return { lip: null, cap: finish(capSoup) }
  }
  const s: Soup = { pos: [], idx: [] }
  const out = along(0.025)
  // The band around the outside, then its face.
  band(s, sectionRing(s, c, corner, round, trim, along(-0.16)), sectionRing(s, c, corner, round, trim, out), n, c.at)
  band(s, sectionRing(s, c, corner, round, trim, out), sectionRing(s, c, corner, round, -trim, out), n, behind)
  fan(capSoup, sectionRing(capSoup, c, corner, round, -trim, out), n, [c.at[0] + out[0], c.at[1] + out[1], c.at[2] + out[2]], behind)
  return { lip: finish(s), cap: finish(capSoup) }
}

// The rolled lip of the inlet: a ring standing `lift` proud of the housing's front face
// (the plane x = 0), opening toward -X, its inside running back into the throat.
export function inletGeo(eye: number, width: number, lift: number, radial: number): BufferGeometry {
  const g = new LatheGeometry([
    new Vector2(eye + width, 0),
    new Vector2(eye + width * 0.4, lift),
    new Vector2(eye, -0.05),
  ], radial)
  g.rotateZ(Math.PI / 2)
  return g
}

// The wheel seen down the inlet: a back plate, a ring of raked blades near its rim and a
// hub, turning about X with its nose toward -X. Only its front is ever seen (the housing
// is behind it), so the blades are single sheets. tint colors each piece before they are
// joined.
export function wheelGeo(r: number, blades: number, depth: number, tint: (g: BufferGeometry, piece: 'blade' | 'hub' | 'plate') => BufferGeometry): BufferGeometry {
  const parts: BufferGeometry[] = [
    tint(new CircleGeometry(r, 10).rotateY(-Math.PI / 2).translate(depth / 2, 0, 0), 'plate'),
    tint(new CylinderGeometry(r * 0.14, r * 0.3, depth * 0.8, 6, 1, true).rotateZ(Math.PI / 2), 'hub'),
  ]
  for (let k = 0; k < blades; k++) {
    parts.push(tint(new PlaneGeometry(r * 0.22, r * 0.55).rotateY(-Math.PI / 2 + 0.55).translate(0, r * 0.66, 0).rotateX((k * TAU) / blades), 'blade'))
  }
  return mergeGeometries(parts, false)
}

// A motor lying along +X from the origin: its can, the fan cowl stepping out at the far
// end (cowl long) and the terminal box on top.
export function motorGeo(r: number, len: number, cowl: number, radial: number): BufferGeometry {
  const edge = 0.05
  const body = new LatheGeometry([
    new Vector2(0, 0),
    new Vector2(r - edge, 0),
    new Vector2(r, edge),
    new Vector2(r, len),
    new Vector2(r * 1.06, len + 0.02),
    new Vector2(r * 0.9, len + cowl),
    new Vector2(0, len + cowl),
  ], radial).rotateZ(-Math.PI / 2)
  return mergeGeometries([body, new BoxGeometry(0.36, 0.2, 0.32).translate(len * 0.45, r + 0.07, 0)], false)
}

// A plain box, for parts too small for anyone to see an eased edge on.
export function boxGeo(w: number, h: number, d: number): BufferGeometry {
  return new BoxGeometry(w, h, d)
}
