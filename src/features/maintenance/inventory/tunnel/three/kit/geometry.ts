import { BufferAttribute, BufferGeometry, CatmullRomCurve3, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Matrix4, Shape, Vector2, Vector3 } from 'three'
import type { Object3D } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// Shapes that make up every machine. Nothing here knows about materials: see parts.ts.
// All sizes are feet.

export type V3 = readonly [x: number, y: number, z: number]

const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _m = new Matrix4()
const UP = new Vector3(0, 1, 0)

// A box with eased edges. Real steel and plastic never have razor edges, and the bevel
// is what catches the light.
export function roundedBoxGeo(w: number, h: number, d: number, r = 0.04): BufferGeometry {
  const radius = Math.min(r, w / 2, h / 2, d / 2)
  return new RoundedBoxGeometry(w, h, d, 1, radius)
}

// A cylinder along Y with chamfered ends, centered. r2 tapers the top.
export function cylGeo(r: number, len: number, opts: { bevel?: number; radial?: number; r2?: number } = {}): BufferGeometry {
  const top = opts.r2 ?? r
  const b = Math.min(opts.bevel ?? Math.min(r, top) * 0.12, len / 3, Math.min(r, top) * 0.5)
  const radial = opts.radial ?? (Math.max(r, top) > 0.5 ? 24 : Math.max(r, top) > 0.12 ? 16 : 10)
  const pts = [
    new Vector2(0, -len / 2),
    new Vector2(r - b, -len / 2),
    new Vector2(r, -len / 2 + b),
    new Vector2(top, len / 2 - b),
    new Vector2(top - b, len / 2),
    new Vector2(0, len / 2),
  ]
  return new LatheGeometry(pts, radial)
}

// Turns an object so its own Y runs from a to b and puts it halfway between. The cross
// section stays level (one side horizontal), so a square tube never looks twisted.
export function spanBetween(o: Object3D, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  _y.set(bx - ax, by - ay, bz - az)
  const len = _y.length()
  if (len < 1e-6) _y.set(0, 1, 0)
  else _y.divideScalar(len)
  if (Math.abs(_y.y) > 0.999) _x.set(1, 0, 0)
  else _x.crossVectors(UP, _y).normalize()
  _z.crossVectors(_x, _y)
  _m.makeBasis(_x, _y, _z)
  o.quaternion.setFromRotationMatrix(_m)
  o.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
  return len
}

// Points along a path through the given corners, each corner rounded to the bend radius.
// Straight runs get one segment and bends get several, so a pipe arch is smooth where it
// turns and cheap everywhere else.
export function bentPath(points: ReadonlyArray<V3>, bend: number, arcSegs = 6): Vector3[] {
  const p = points.map(([x, y, z]) => new Vector3(x, y, z))
  if (p.length < 3 || bend <= 0) return p
  const out: Vector3[] = [p[0].clone()]
  for (let k = 1; k < p.length - 1; k++) {
    const a = p[k - 1]
    const b = p[k]
    const c = p[k + 1]
    const inLen = a.distanceTo(b)
    const outLen = b.distanceTo(c)
    const cut = Math.min(bend, inLen * 0.48, outLen * 0.48)
    const from = b.clone().lerp(a, cut / inLen)
    const to = b.clone().lerp(c, cut / outLen)
    for (let s = 0; s <= arcSegs; s++) {
      const t = s / arcSegs
      // A quadratic curve from one cut point to the other, pulled toward the corner.
      const q = from.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(b, 2 * (1 - t) * t).addScaledVector(to, t * t)
      out.push(q)
    }
  }
  out.push(p[p.length - 1].clone())
  return out
}

// A hose hanging between two points: sag is how far the middle drops, as a share of
// the span.
export function hosePath(a: V3, b: V3, sag = 0.1, segs = 12): Vector3[] {
  const va = new Vector3(a[0], a[1], a[2])
  const vb = new Vector3(b[0], b[1], b[2])
  const mid = va.clone().lerp(vb, 0.5)
  mid.y -= va.distanceTo(vb) * sag
  return new CatmullRomCurve3([va, mid, vb], false, 'catmullrom', 0.5).getPoints(segs)
}

// A round tube swept along path points, with smooth normals and optional flat end caps.
export function sweepGeo(path: Vector3[], radius: number, radial = 10, caps = true): BufferGeometry {
  const n = path.length
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const tan = new Vector3()
  const normal = new Vector3()
  const binormal = new Vector3()
  const prevTan = new Vector3()
  const axis = new Vector3()
  let dist = 0
  for (let i = 0; i < n; i++) {
    // The direction at a point is the average of the runs either side of it.
    tan.set(0, 0, 0)
    if (i > 0) tan.add(_x.subVectors(path[i], path[i - 1]).normalize())
    if (i < n - 1) tan.add(_x.subVectors(path[i + 1], path[i]).normalize())
    tan.normalize()
    if (i === 0) {
      normal.set(Math.abs(tan.y) > 0.9 ? 1 : 0, Math.abs(tan.y) > 0.9 ? 0 : 1, 0)
      normal.addScaledVector(tan, -normal.dot(tan)).normalize()
    } else {
      // Carry the ring's orientation forward without twisting it.
      axis.crossVectors(prevTan, tan)
      const s = axis.length()
      if (s > 1e-6) {
        axis.divideScalar(s)
        normal.applyAxisAngle(axis, Math.atan2(s, prevTan.dot(tan)))
      }
      dist += path[i].distanceTo(path[i - 1])
    }
    binormal.crossVectors(tan, normal)
    prevTan.copy(tan)
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const cx = Math.cos(a)
      const sy = Math.sin(a)
      _y.set(0, 0, 0).addScaledVector(normal, cx).addScaledVector(binormal, sy)
      pos.push(path[i].x + _y.x * radius, path[i].y + _y.y * radius, path[i].z + _y.z * radius)
      nor.push(_y.x, _y.y, _y.z)
      uv.push(j / radial, dist)
    }
  }
  const ring = radial + 1
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j
      const b = a + ring
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  if (caps) {
    for (const end of [0, n - 1]) {
      const dir = end === 0 ? -1 : 1
      tan.set(0, 0, 0)
      if (end === 0) tan.subVectors(path[1], path[0]).normalize()
      else tan.subVectors(path[n - 1], path[n - 2]).normalize()
      const center = pos.length / 3
      pos.push(path[end].x, path[end].y, path[end].z)
      nor.push(tan.x * dir, tan.y * dir, tan.z * dir)
      uv.push(0.5, 0.5)
      const first = pos.length / 3
      for (let j = 0; j <= radial; j++) {
        const src = (end * ring + j) * 3
        pos.push(pos[src], pos[src + 1], pos[src + 2])
        nor.push(tan.x * dir, tan.y * dir, tan.z * dir)
        uv.push(0.5, 0.5)
      }
      for (let j = 0; j < radial; j++) {
        if (end === 0) idx.push(center, first + j + 1, first + j)
        else idx.push(center, first + j, first + j + 1)
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  return g
}

// A right triangle plate (legs along +X and +Y, thickness along Z, centered on Z): the
// gusset welded into a frame's corner.
export function gussetGeo(size: number, thickness: number): BufferGeometry {
  const s = new Shape()
  s.moveTo(0, 0)
  s.lineTo(size, 0)
  s.lineTo(0, size)
  s.closePath()
  const g = new ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false })
  g.translate(0, 0, -thickness / 2)
  return g
}

// A rectangle with rounded corners, as an outline to extrude.
export function roundedRectShape(x0: number, y0: number, x1: number, y1: number, r: number): Shape {
  const s = new Shape()
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2)
  s.moveTo(x0 + rr, y0)
  s.lineTo(x1 - rr, y0)
  s.absarc(x1 - rr, y0 + rr, rr, -Math.PI / 2, 0, false)
  s.lineTo(x1, y1 - rr)
  s.absarc(x1 - rr, y1 - rr, rr, 0, Math.PI / 2, false)
  s.lineTo(x0 + rr, y1)
  s.absarc(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI, false)
  s.lineTo(x0, y0 + rr)
  s.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false)
  return s
}

// A flat plate with rounded corners lying on the floor plane (XZ), its top at y = t.
export function plateGeo(w: number, d: number, t: number, r = 0.08): BufferGeometry {
  const s = roundedRectShape(-w / 2, -d / 2, w / 2, d / 2, r)
  const bevel = Math.min(0.015, t * 0.3)
  const g = new ExtrudeGeometry(s, { depth: t - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 })
  // Extruded along +Z: stand it up so the thickness runs along +Y.
  g.rotateX(-Math.PI / 2)
  g.translate(0, bevel, 0)
  return g
}

// A hex bolt head standing on y = 0.
export function boltGeo(r = 0.05, h = 0.06): BufferGeometry {
  const g = new CylinderGeometry(r, r, h, 6)
  g.translate(0, h / 2, 0)
  return g
}
