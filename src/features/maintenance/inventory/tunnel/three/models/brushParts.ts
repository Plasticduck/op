import { Box3, BoxGeometry, BufferAttribute, CylinderGeometry, Group, LatheGeometry, Matrix4, Mesh, Vector3 } from 'three'
import type { BufferGeometry, InstancedMesh, Material, Object3D } from 'three'
import { CAR, CAR_PROFILE, carHalfWidthAt, carHeightAt } from '../car'
import { COLORS } from '../kit'
import type { FoamBrush, Kit, Paint } from '../kit'
import type { ModelInput, RunState } from '../types'

// What the friction machines in brushes.ts share: the demo car's outline as something a
// brush can lean on, the two mechanisms most of them are built from (an upright brush on
// a floor swing arm, and a low brush lying along the tunnel on parallel arms), the passes
// (slim) that keep them and the wraps inside the draw call and triangle budget, and how
// a spare beside the tunnel is parked on its footprint (park).
//
// HOW A BRUSH MEETS THE CAR. A brush on an arm has one way to move (the arm's angle). The
// car pushes it one way and gravity or an air cylinder pulls it back, so at any moment it
// sits as close to the car as the car's outline allows. That spot is worked out from
// car.ts alone (sideGap, planGap) for every position of the car when the model is built,
// and kept as a table (track): update() only looks it up, so a frame costs nothing and
// any moment can be drawn on its own. Where the car lets go of a brush all at once (a top
// brush coming off the tail) the table eases it back, as the real machine's damper does.

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const smooth = (v: number) => {
  const c = clamp(v, 0, 1)
  return c * c * (3 - 2 * c)
}

export function at<T extends Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z)
  return o
}

// ---- The car's outline ------------------------------------------------------------------

export const CAR_HALF = CAR.length / 2

// The side view (along the tunnel, up) and one flank of the plan view (along the tunnel,
// out from the centerline) as corner points, nose at +x.
const SIDE: number[] = []
for (const [x, y] of CAR_PROFILE) SIDE.push(x, y)
const PLAN: number[] = [CAR_HALF, 0]
const ENDS = [0.001, 0.35, 0.7, 1.05, 1.4, 1.75]
for (const back of ENDS) PLAN.push(CAR_HALF - back, carHalfWidthAt(CAR_HALF - back))
for (const back of [...ENDS].reverse()) PLAN.push(-CAR_HALF + back, carHalfWidthAt(-CAR_HALF + back))
PLAN.push(-CAR_HALF, 0)

function reachTo(line: ArrayLike<number>, px: number, py: number): number {
  let best = Infinity
  for (let k = 0; k + 3 < line.length; k += 2) {
    const ax = line[k]
    const ay = line[k + 1]
    const dx = line[k + 2] - ax
    const dy = line[k + 3] - ay
    const len = dx * dx + dy * dy
    const t = len > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0
    const ex = px - ax - dx * t
    const ey = py - ay - dy * t
    const d = ex * ex + ey * ey
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

// How far a point is from the car's skin, in feet: negative inside the car. u is measured
// along the tunnel from the car's center. Side view: y is the height. Plan view: q is the
// distance out from the car's centerline.
export function sideGap(u: number, y: number): number {
  const d = reachTo(SIDE, u, y)
  return Math.abs(u) < CAR_HALF && y < carHeightAt(u) ? -d : d
}
export function planGap(u: number, q: number): number {
  const out = Math.abs(q)
  const d = reachTo(PLAN, u, out)
  return out < carHalfWidthAt(u) ? -d : d
}

// What a brush is pressed against: one flat plane, which is all a foam brush can fold
// along. It has to keep the whole brush out of the car, not just its nearest strip, so it
// is the plane through the nearest point of everything the brush could touch (the hull of
// the car's skin within the foam's reach): on a roof that is the roof, in the corner
// under a windshield it bridges the hood and the glass.
export const PRESS = { hit: false, nx: 0, ny: 0, d: 0 }
const ENDS_OF = new Float64Array(128)

function pressOn(line: ArrayLike<number>, ox: number, oy: number, reach: number): void {
  const r2 = reach * reach
  let n = 0
  for (let k = 0; k + 3 < line.length; k += 2) {
    const ax = line[k] - ox
    const ay = line[k + 1] - oy
    const dx = line[k + 2] - line[k]
    const dy = line[k + 3] - line[k + 1]
    const a = dx * dx + dy * dy
    if (a < 1e-9) continue
    // The stretch of this edge that lies within reach.
    const b = ax * dx + ay * dy
    const disc = b * b - a * (ax * ax + ay * ay - r2)
    if (disc <= 0) continue
    const root = Math.sqrt(disc)
    const t0 = Math.max(0, (-b - root) / a)
    const t1 = Math.min(1, (-b + root) / a)
    if (t0 >= t1) continue
    ENDS_OF[n++] = ax + dx * t0
    ENDS_OF[n++] = ay + dy * t0
    ENDS_OF[n++] = ax + dx * t1
    ENDS_OF[n++] = ay + dy * t1
  }
  PRESS.hit = n > 0
  if (!n) return
  let vx = ENDS_OF[0]
  let vy = ENDS_OF[1]
  for (let k = 2; k < n; k += 2) {
    if (ENDS_OF[k] * ENDS_OF[k] + ENDS_OF[k + 1] * ENDS_OF[k + 1] < vx * vx + vy * vy) {
      vx = ENDS_OF[k]
      vy = ENDS_OF[k + 1]
    }
  }
  const nearX = vx
  const nearY = vy
  // Walk toward the hull's nearest point: step to whichever point lies furthest back
  // along the current guess, then to the nearest point of the line between them.
  for (let step = 0; step < 12; step++) {
    const vv = vx * vx + vy * vy
    let low = vv
    let sx = vx
    let sy = vy
    for (let k = 0; k < n; k += 2) {
      const dot = ENDS_OF[k] * vx + ENDS_OF[k + 1] * vy
      if (dot < low) {
        low = dot
        sx = ENDS_OF[k]
        sy = ENDS_OF[k + 1]
      }
    }
    if (vv - low < 1e-5) break
    const ex = sx - vx
    const ey = sy - vy
    const t = clamp(-(vx * ex + vy * ey) / (ex * ex + ey * ey), 0, 1)
    vx += ex * t
    vy += ey * t
  }
  let d = Math.hypot(vx, vy)
  // Wedged with the car on both sides (it never should be): lean on the nearest point.
  if (d < 0.05) {
    vx = nearX
    vy = nearY
    d = Math.hypot(vx, vy)
  }
  PRESS.nx = vx / d
  PRESS.ny = vy / d
  PRESS.d = d
}

// Fills PRESS for a brush whose shaft is at that point of the side or plan view and whose
// foam reaches `reach` feet: the plane's normal (toward the car) and its distance.
export function sidePress(u: number, y: number, reach: number): void {
  pressOn(SIDE, u, y, reach)
}
export function planPress(u: number, q: number, reach: number): void {
  pressOn(PLAN, u, q, reach)
}

// ---- A mechanism's position for every position of the car -------------------------------

export type Track = { at(carDx: number | null): number }

// Tabulates held(carDx), how far the car holds a mechanism off its resting place, from
// `from` to `to` feet. The car can push as fast as it likes but the mechanism comes back
// no faster than `back` per foot the car travels, and it starts to give way a little
// early (`ahead` per foot), which is what a brush with some weight does.
export function track(from: number, to: number, held: (carDx: number) => number, back: number, ahead: number): Track {
  const STEP = 0.1
  const n = Math.max(2, Math.ceil((to - from) / STEP) + 1)
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) v[i] = held(from + i * STEP)
  for (let i = 1; i < n; i++) v[i] = Math.max(v[i], v[i - 1] - back * STEP)
  for (let i = n - 2; i >= 0; i--) v[i] = Math.max(v[i], v[i + 1] - ahead * STEP)
  return {
    at(carDx) {
      if (carDx == null || carDx <= from) return v[0]
      const f = (carDx - from) / STEP
      const i = Math.floor(f)
      return i >= n - 1 ? v[n - 1] : v[i] + (v[i + 1] - v[i]) * (f - i)
    },
  }
}

// ---- Parts ------------------------------------------------------------------------------

// Foam is fixed to an 8 in drum.
export const CORE = 0.33
// Pressed against the car, foam is squeezed to a little over half its reach.
export const pressedRadius = (radius: number, core = CORE) => core + (radius - core) * 0.55

// ---- Fewer draw calls and triangles -------------------------------------------------------
// The friction machines are a lot of small parts, and there are thirteen of them in a
// tunnel. Three passes keep them inside the budget without changing what they look like.

// What the merges leave alone (kit.ts), left alone here too.
const keptPart = (o: Object3D) => !!(o.userData.keep || o.userData.blob || o.userData.pick || o.userData.fx)

function walkParts(group: Object3D, visit: (m: Mesh) => void): void {
  const walk = (o: Object3D) => {
    if (o !== group && keptPart(o)) return
    const m = o as Mesh
    if (m.isMesh && !(m as InstancedMesh).isInstancedMesh) visit(m)
    for (const c of [...o.children]) walk(c)
  }
  walk(group)
}

// 1. The fixed parts are the ones drawn into the shadow map, and they cost a draw call
// per material twice over (the picture and the shadow). Only the frame is big enough for
// its shadow to matter, so everything else (painted accents, stainless pipe, bolt heads)
// moves over to the moving group. There it rides on no mover and stands still.
export function settle(kit: Kit, fixed: Group, moving: Group): void {
  fixed.updateMatrixWorld(true)
  moving.updateMatrixWorld(true)
  const out: Mesh[] = []
  walkParts(fixed, (m) => {
    if (m.material !== kit.mat.frame) out.push(m)
  })
  for (const m of out) moving.attach(m)
}

// 2. The kit bevels every box and chamfers every cylinder, for parts seen up close. Small
// blocks and thin plates get plain boxes and small round parts fewer facets. On phones
// every box is plain, every cylinder coarse, and parts under about an inch (bolt heads,
// cap screws) go.
function facets(r: number, fine: boolean): number {
  if (fine) return r < 0.15 ? 8 : r < 0.3 ? 10 : r < 0.5 ? 12 : 16
  return r < 0.15 ? 6 : r < 0.4 ? 8 : 10
}

function thinner(geo: BufferGeometry, fine: boolean): BufferGeometry | 'drop' | null {
  if (geo.type === 'RoundedBoxGeometry') {
    const { width: w, height: h, depth: d } = (geo as BoxGeometry).parameters
    const big = Math.max(w, h, d)
    if (!fine && big < 0.1) return 'drop'
    return !fine || big <= 0.22 || Math.min(w, h, d) <= 0.1 ? new BoxGeometry(w, h, d) : null
  }
  if (geo.type === 'LatheGeometry') {
    const { points, segments } = (geo as LatheGeometry).parameters
    let r = 0
    let lo = Infinity
    let hi = -Infinity
    for (const p of points) {
      r = Math.max(r, p.x)
      lo = Math.min(lo, p.y)
      hi = Math.max(hi, p.y)
    }
    if (!fine && Math.max(2 * r, hi - lo) < 0.1) return 'drop'
    if (fine && r >= 0.06) {
      const n = facets(r, true)
      return n < segments ? new LatheGeometry(points, n) : null
    }
    // Too small or too far for a chamfer to show: a plain cylinder (or cone) as tall.
    const mid = (lo + hi) / 2
    let r0 = 0
    let r1 = 0
    for (const p of points) {
      if (p.y <= mid) r0 = Math.max(r0, p.x)
      else r1 = Math.max(r1, p.x)
    }
    const cyl = new CylinderGeometry(r1, r0, hi - lo, r < 0.06 ? 6 : facets(r, false))
    cyl.translate(0, mid, 0)
    return cyl
  }
  if (geo.type === 'CylinderGeometry' && !fine) {
    const p = (geo as CylinderGeometry).parameters
    if (Math.max(2 * Math.max(p.radiusTop, p.radiusBottom), p.height) < 0.13) return 'drop'
  }
  return null
}

export function lighten(kit: Kit, group: Object3D): void {
  const fine = kit.detail === 'high'
  const gone: Mesh[] = []
  walkParts(group, (m) => {
    const next = thinner(m.geometry, fine)
    if (next === 'drop') {
      if (!m.children.length) gone.push(m)
    } else if (next) {
      // A painted part reads one spot of the sign atlas: the new shape reads it too.
      const uv = m.geometry.attributes.uv
      if (m.material === kit.mat.sign && uv) {
        const spot = new Float32Array(next.attributes.position.count * 2)
        for (let k = 0; k < spot.length; k += 2) {
          spot[k] = uv.getX(0)
          spot[k + 1] = uv.getY(0)
        }
        next.setAttribute('uv', new BufferAttribute(spot, 2))
      }
      if (!m.geometry.userData.shared) m.geometry.dispose()
      m.geometry = next
    }
  })
  for (const m of gone) m.removeFromParent()
}

// 3. Moving parts painted from the sign atlas share one draw call with the accents. The
// motor black always: the sign material is as rough, and in the motor's own color it
// reads the same even up close. On phones everything that moves: arms, pins and all. The
// fixed frame keeps its material, and with it its shadow.
export function paintMoving(kit: Kit, group: Object3D): void {
  const m = kit.mat
  const swatch = new Map<Material, Paint>([[m.motor, COLORS.motor]])
  if (kit.detail === 'low') {
    swatch.set(m.frame, 'frame')
    swatch.set(m.stainless, COLORS.stainless)
    swatch.set(m.aluminum, COLORS.aluminum)
  }
  walkParts(group, (mesh) => {
    const color = swatch.get(mesh.material as Material)
    if (color) kit.paint(mesh, color)
  })
}

// All three, in order, on a model's two groups just before they are merged.
export function slim(kit: Kit, fixed: Group, moving: Group): void {
  settle(kit, fixed, moving)
  lighten(kit, fixed)
  lighten(kit, moving)
  paintMoving(kit, moving)
}

// A gearmotor. On phones just its case, can and fan cowl: the fins are the expensive part.
export function gearmotor(kit: Kit, r: number, len: number): Group {
  if (kit.detail === 'high') return kit.motor({ r, len })
  const m = kit.mat.motor
  const g = new Group()
  const gh = r * 1.5
  g.add(at(kit.box(r * 2.3, gh, r * 2.3, m), 0, gh / 2, 0))
  g.add(at(kit.cyl(r, len, m), 0, gh + 0.08 + len / 2, 0))
  g.add(at(kit.cyl(r * 1.06, r * 0.75, m, { r2: r * 0.9 }), 0, gh + 0.08 + len + r * 0.36, 0))
  return g
}

// A bolted floor plate. The plate is frame-colored and goes with the fixed parts; its
// bolt heads (only where there is detail to see them) go in `loose`, the moving group.
export function foot(kit: Kit, fixed: Group, loose: Group, x: number, z: number, w: number, d: number): void {
  const t = 0.06
  fixed.add(at(kit.box(w, t, d, kit.mat.frame, 0.02), x, t / 2, z))
  if (kit.detail !== 'high') return
  const inset = Math.min(0.16, w * 0.2, d * 0.2)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const bolt = new Mesh(new CylinderGeometry(0.055, 0.055, 0.07, 6), kit.mat.stainless)
      // Shadow flags as on the kit's own parts: the merges keep meshes whose flags differ apart.
      bolt.castShadow = true
      bolt.receiveShadow = true
      loose.add(at(bolt, x + sx * (w / 2 - inset), t + 0.035, z + sz * (d / 2 - inset)))
    }
  }
}

// The machine's name on a dark plate bolted to a face that looks upstream, where cars
// (and the overview camera) come from. x is that face. edge: a z the plate keeps short of,
// sliding along the face to do it (a spare's plate keeps to its footprint).
export function badge(kit: Kit, fixed: Group, text: string, x: number, y: number, z: number, widest = 2.2, edge?: number): void {
  const w = clamp(text.length * 0.2 + 0.35, 1.1, widest)
  const half = (w + 0.12) / 2
  if (edge != null) z = edge > z ? Math.min(z, edge - half) : Math.max(z, edge + half)
  fixed.add(at(kit.paint(kit.box(0.05, 0.44, w + 0.12, kit.mat.frame, 0.015), 'dark'), x - 0.025, y, z))
  const plate = at(kit.sign(text, w, 0.34), x - 0.053, y, z)
  plate.rotation.y = -Math.PI / 2
  fixed.add(plate)
}

// A brass spray tip on a bar, aimed along (dx, dy, dz).
export function tip(kit: Kit, fixed: Group, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
  const len = Math.hypot(dx, dy, dz) || 1
  const k = 0.17 / len
  fixed.add(kit.paint(kit.rod([x, y, z], [x + dx * k, y + dy * k, z + dz * k], 0.034, kit.mat.stainless), 'brass'))
}

// A cylinder whose shaft lies along the tunnel (x) or across it (z) instead of standing up.
export function lay(mesh: Mesh, axis: 'x' | 'z'): Mesh {
  if (axis === 'x') mesh.rotation.z = -Math.PI / 2
  else mesh.rotation.x = Math.PI / 2
  return mesh
}

// ---- Beside the tunnel ------------------------------------------------------------------
// A machine drawn beside the tunnel is a spare, or one waiting to be put in. There is no
// car to reach for (RunState.carDx is null there), so it is drawn whole and parked: arm
// folded, foam hanging still, everything on its own footprint. Each model builds it at
// rest around its own origin, its arm and rail no longer than the footprint needs, and
// park() then lays it the long way along the footprint and centers it there. None of it
// depends on where across the floor the footprint is, only on which side of the tunnel
// (the scene rebuilds a model beside the tunnel only when that changes).

// Limp strips stand out from the drum by up to 0.42 ft before they turn down (kit/brush.ts),
// and twist a little: this far past the drum covers them. On a lying drum the strips on
// top can only fall sideways, over a half turn: twice as far.
export const LIMP = 0.5

type Point = { x: number; y: number; z: number }

const _v = new Vector3()
const _w = new Vector3()
const _box = new Box3()
const _inv = new Matrix4()
const _rel = new Matrix4()

// Adds a limp brush to `into`, in the model's own space while it is being built (its root
// hasn't been placed yet). The meshes can't say where the foam is: the strips are bent in
// the shader. Upright, they hang in a column `out` feet round the shaft; lying, they hang
// down from it, so they stand out sideways only, and just past its ends.
export function limpBox(brush: FoamBrush, axis: 'x' | 'y' | 'z', length: number, out: number, into: Box3): Box3 {
  const ax = axis === 'x' ? 0.2 : out
  const az = axis === 'z' ? 0.2 : out
  brush.root.updateWorldMatrix(true, false)
  for (const end of [-1, 1]) {
    brush.root.localToWorld(_v.set(0, 0, 0).setComponent(axis === 'x' ? 0 : axis === 'y' ? 1 : 2, (end * length) / 2))
    into.expandByPoint(_w.set(_v.x - ax, _v.y, _v.z - az))
    into.expandByPoint(_w.set(_v.x + ax, _v.y, _v.z + az))
  }
  return into
}

// Lays a spare's parts (body, a group of root, built at rest around the origin) on a w by h
// footprint: a quarter turn when that fits it better, then centered. What it measures is
// the merged meshes as they stand (their rest pose is their bind pose) and the limp foam;
// pick shapes, blobs and spray are left out. Returns where the status light goes now.
export function park(body: Group, w: number, h: number, foam: Box3, beacon: Point): Point {
  body.updateMatrixWorld(true)
  _inv.copy(body.matrixWorld).invert()
  const box = foam.clone()
  const walk = (o: Object3D) => {
    if (o !== body && keptPart(o)) return
    const mesh = o as Mesh
    if (mesh.isMesh && !(mesh as InstancedMesh).isInstancedMesh) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      box.union(_box.copy(mesh.geometry.boundingBox!).applyMatrix4(_rel.multiplyMatrices(_inv, mesh.matrixWorld)))
    }
    for (const c of o.children) walk(c)
  }
  walk(body)
  const sx = box.max.x - box.min.x
  const sz = box.max.z - box.min.z
  const over = (along: number, across: number) => Math.max(0, along - w) + Math.max(0, across - h)
  const turn = over(sz, sx) < over(sx, sz) - 1e-3
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  // A quarter turn takes (x, z) to (z, -x).
  body.rotation.y = turn ? Math.PI / 2 : 0
  body.position.set(turn ? -cz : -cx, 0, turn ? cx : -cz)
  body.updateMatrix()
  _v.set(beacon.x, beacon.y, beacon.z).applyMatrix4(body.matrix)
  return { x: _v.x, y: _v.y, z: _v.z }
}

// One machine's worth of moving parts, built into the model's shared groups.
export type Unit = {
  // The groups update() turns and slides, for kit.mergeMoving.
  movers: Object3D[]
  brush: FoamBrush
  beacon: Point
  // Where its foam hangs limp at rest, for park().
  limp: Box3
  update(st: RunState): void
}

// ---- An upright brush on a floor swing arm ----------------------------------------------
// MacNeil's side washers (RS-301 high, RS-400 low) are "motor down": nothing overhead. A
// swing arm skims the floor from a pivot by the wall, trailing toward the exit, the
// gearmotor sits on its end and the brush stands on the gearmotor. An air cylinder
// pushes the arm in; the car pushes it back out.

const ARM_Y = 0.36
const RAM_Y = 0.46
const PHI_MAX = 1.08
// Radians of swing per foot the car travels, once the car lets go of the brush.
const SWING_BACK = 0.22

export type SwingSpec = {
  // +1: it stands on the passenger side of the car. -1: the driver's side.
  s: 1 | -1
  // Feet from the car's centerline: where the brush waits out of the way, and where its
  // cylinder holds it when there is no car to stop it. Never nearer than the car allows
  // (0 for a spare beside the tunnel, which is built folded).
  home: number
  press: number
  // The spinning brush's diameter, and where its foam starts and ends above the floor.
  diameter: number
  foamLo: number
  foamHi: number
  // How far the shaft leans toward the car, in radians.
  tilt: number
  // Height of the post by the wall, and the radius of the cap on top of the brush.
  mast: number
  cap: number
  colors: string[]
  seed: number
  // Its name plate, on the post. null: none.
  sign: string | null
}

export function swingUnit(input: ModelInput, spec: SwingSpec, root: Group, fixed: Group, moving: Group): Unit {
  const { kit } = input
  const m = kit.mat
  const fine = input.detail === 'high'
  // A spare: no car, built at rest around its own brush (see park).
  const beside = input.side === 'outside'
  const { s } = spec
  const R = spec.diameter / 2
  const rp = pressedRadius(R)
  const mid = (spec.foamLo + spec.foamHi) / 2
  const length = spec.foamHi - spec.foamLo
  // A leaning shaft's middle is nearer the car than its foot. Distances from the car are
  // measured at the middle, where the foam meets the door.
  const sinT = Math.sin(spec.tilt)
  const cosT = Math.cos(spec.tilt)
  const lean = sinT * (mid - ARM_Y)
  const wall = input.tunnelWidth / 2 - s * CAR.z

  const home = Math.max(spec.home, CAR.width / 2 + rp + 0.15)
  // A spare has no car: the line distances are measured from goes where it brings the
  // brush to the origin.
  const carZ = beside ? -s * home : CAR.z - input.y
  const zAt = (q: number) => carZ + s * q
  const press = Math.min(spec.press, home)
  // The pivot stands back from the waiting brush, as far as the wall leaves room. On a
  // spare, as far as the footprint's narrow side leaves room after the brush (the leaning
  // top's cap or limp foam) and the post with its plate (0.9 ft behind the pivot).
  const long = Math.max(input.w, input.h)
  const short = Math.min(input.w, input.h)
  const back = beside
    ? clamp(short - 1 - lean - Math.max(spec.cap, CORE + LIMP) - sinT * (spec.foamHi - mid), 0.45, 1)
    : clamp(wall - home - lean - 0.85, 0.45, 1.4)
  const reach = home + back
  // A spare's arm lies along the footprint's long side: the post's plate takes 0.5 ft
  // behind it and the gearmotor 1 ft past the brush.
  const La = beside ? clamp(Math.hypot(long - 1.6, back), 1.6, 2.6) : Math.max(2.6, (reach - press) / Math.sin(PHI_MAX))
  const phiAt = (q: number) => Math.asin(clamp((reach - q) / La, -1, 1))
  const phiHome = phiAt(home)
  const phiPress = phiAt(press)
  const xPivot = -La * Math.cos(phiHome)
  const zPivot = zAt(reach + lean)
  const zPost = zAt(reach + lean + 0.42)

  // How far the car holds the arm short of where the cylinder wants it, for every
  // position of the car: swing in from home until the foam would be squeezed past rp.
  const gapAt = (phi: number, c: number) => {
    const q = reach - La * Math.sin(phi)
    return q - rp >= CAR.width / 2 ? 1 : planGap(xPivot + La * Math.cos(phi) - c, q) - rp
  }
  const xIn = xPivot + La * Math.cos(phiPress)
  const held = beside ? null : track(xIn - CAR_HALF - rp - 2.5, CAR_HALF + rp + 1 + (phiPress - phiHome) / SWING_BACK, (c) => {
    if (c < xIn - CAR_HALF - rp - 0.3 || c > CAR_HALF + rp + 0.3) return 0
    let ok = phiHome
    for (let i = 1; i <= 20; i++) {
      const phi = phiHome + ((phiPress - phiHome) * i) / 20
      if (gapAt(phi, c) < 0) {
        let bad = phi
        for (let j = 0; j < 7; j++) {
          const half = (ok + bad) / 2
          if (gapAt(half, c) < 0) bad = half
          else ok = half
        }
        return phiPress - ok
      }
      ok = phi
    }
    return 0
  }, SWING_BACK, 0.8)

  // ---- Parts that never move: the post, a floor rail along the wall, the clevis ----
  // A spare's rail stops under its gearmotor.
  const railEnd = beside ? Math.min(xPivot + 3.1, 0.75) : xPivot + 3.1
  fixed.add(kit.beam([xPivot, 0.06, zPost], [xPivot, spec.mast, zPost], 0.36, m.frame))
  foot(kit, fixed, moving, xPivot, zPost, 1.0, 0.95)
  fixed.add(kit.beam([xPivot + 0.1, 0.17, zPost], [railEnd, 0.17, zPost], [0.3, 0.26], m.frame))
  foot(kit, fixed, moving, railEnd - 0.12, zPost, 0.7, 0.8)
  for (const y of [ARM_Y - 0.22, ARM_Y + 0.22]) fixed.add(at(kit.box(0.5, 0.07, 0.72, m.frame, 0.02), xPivot, y, zAt(reach + lean + 0.1)))
  moving.add(kit.rod([xPivot, 0.08, zPivot], [xPivot, ARM_Y + 0.36, zPivot], 0.06, m.stainless))
  // The cylinder's own clevis, on the far end of the rail.
  const ramX = railEnd - 0.2
  fixed.add(at(kit.box(0.2, 0.34, 0.2, m.frame, 0.02), ramX, 0.44, zPost))
  // The spray bar that keeps the foam wet, up the post, with its feed line.
  const barX = xPivot + 0.27
  const barZ = zPost - s * 0.27
  const barLo = spec.foamLo + 0.45
  const barHi = Math.min(spec.mast - 0.5, spec.foamHi - 0.15)
  moving.add(kit.tube([[barX, barLo, barZ], [barX, barHi, barZ]], 0.045, m.stainless, { radial: 8 }))
  const tips = fine ? Math.max(2, Math.round((barHi - barLo) / 1.4)) : 0
  for (let k = 0; k < tips; k++) {
    const y = barLo + 0.25 + ((barHi - barLo - 0.5) * k) / Math.max(1, tips - 1)
    tip(kit, fixed, barX, y, barZ, 0.8, -0.05, -s * 0.6)
    if (k % 2 === 0) fixed.add(kit.beam([barX, y + 0.3, barZ], [xPivot + 0.12, y + 0.3, zPost - s * 0.12], [0.06, 0.09], m.frame, 0.015))
  }
  if (fine) {
    fixed.add(at(kit.paint(kit.cyl(0.065, 0.15, m.stainless, { radial: 10 }), 'red'), barX, barLo - 0.07, barZ))
    fixed.add(kit.paint(kit.tube([[barX, barLo - 0.14, barZ], [barX, 0.42, barZ], [barX - 0.1, 0.34, barZ + s * 0.5]], 0.028, m.stainless, { bend: 0.22, radial: 6 }), 'hoseWhite'))
    // The air line down to the cylinder.
    fixed.add(kit.paint(kit.tube([[xPivot + 0.2, 1.5, zPost], [xPivot + 0.2, 0.42, zPost + s * 0.02], [ramX - 0.2, 0.36, zPost + s * 0.02]], 0.022, m.stainless, { bend: 0.2, radial: 6 }), 'hoseBlue'))
  }
  // Controls: a junction box on the post's upstream face.
  fixed.add(at(kit.paint(kit.box(0.16, 0.56, 0.42, m.frame, 0.03), 'dark'), xPivot - 0.26, Math.min(2.5, spec.mast - 1.1), zPost))
  // A spare's plate comes no further back than the post's floor plate.
  if (spec.sign) badge(kit, fixed, spec.sign, xPivot - 0.18, spec.mast - 0.32, zPost, 1.9, beside ? zPost + s * 0.475 : undefined)

  // ---- Parts that move ----
  const arm = new Group()
  arm.position.set(xPivot, 0, zPivot)
  arm.add(kit.beam([-0.22, ARM_Y, 0], [La + 0.12, ARM_Y, 0], [0.3, 0.3], m.frame))
  arm.add(at(kit.bearing(0.25), 0, ARM_Y + 0.2, 0))
  const LUG = 1.2
  const TAB = 0.34
  arm.add(at(kit.box(0.2, 0.16, TAB + 0.08, m.frame, 0.02), LUG, RAM_Y, (s * (TAB + 0.08)) / 2))
  arm.add(at(kit.cyl(0.042, 0.3, m.stainless, { radial: 8 }), LUG, RAM_Y, s * TAB))

  // The head: gearmotor on the arm's end, the drum standing on it, the cap on top.
  const head = new Group()
  head.rotation.x = -s * spec.tilt
  const up = (y: number) => y - ARM_Y
  head.add(at(kit.box(0.8, 0.08, 0.8, m.frame, 0.03), 0, up(0.53), 0))
  const gear = gearmotor(kit, 0.25, 0.6)
  gear.rotation.z = -Math.PI / 2
  gear.position.set(-0.19, up(0.86), 0)
  head.add(gear)
  head.add(at(kit.cyl(0.24, spec.foamLo - 1.1, m.motor, { bevel: 0.03 }), 0, up((spec.foamLo + 1.1) / 2), 0))
  head.add(at(kit.cyl(0.44, 0.07, m.motor), 0, up(spec.foamLo - 0.08), 0))
  head.add(at(kit.cyl(CORE, length + 0.2, m.motor, { bevel: 0.05 }), 0, up(mid), 0))
  head.add(at(kit.cyl(spec.cap, 0.09, m.frame, { bevel: 0.025 }), 0, up(spec.foamHi + 0.12), 0))
  head.add(at(kit.cyl(0.1, 0.14, m.stainless), 0, up(spec.foamHi + 0.22), 0))
  if (fine) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      head.add(at(kit.cyl(0.04, 0.05, m.stainless, { radial: 6 }), Math.cos(a) * spec.cap * 0.76, up(spec.foamHi + 0.18), Math.sin(a) * spec.cap * 0.76))
    }
  }
  const brush = kit.foamBrush({
    axis: 'y', length, diameter: R * 2, core: CORE * 2, tiers: Math.max(3, Math.round(length / 0.58)), perTier: 32,
    colors: spec.colors, bandTiers: 1, jitter: 0.7,
    // As on the wraps, the face against the car wipes toward the exit.
    dir: s > 0 ? 1 : -1, rps: 1.5, drum: false, floor: mid - 0.05, seed: spec.seed,
  })
  brush.root.position.y = up(mid)
  head.add(brush.root)
  const shade = kit.blob(head, R * 2, R * 2, { y: -ARM_Y, cast: spec.foamHi })

  // The cylinder is sized to the swing it has to make.
  const lugAt = (phi: number, out: { x: number; z: number }) => {
    const c = Math.cos(phi)
    const sn = Math.sin(phi)
    out.x = xPivot + LUG * c + TAB * sn
    out.z = zPivot - s * (LUG * sn - TAB * c)
    return out
  }
  const lug = { x: 0, z: 0 }
  const span = (phi: number) => {
    lugAt(phi, lug)
    return Math.hypot(lug.x - ramX, lug.z - zPost)
  }
  const shortest = Math.min(span(phiHome), span(phiPress))
  const ram = kit.airCylinder({ body: Math.max(0.5, shortest - 0.5), stroke: Math.abs(span(phiPress) - span(phiHome)) + 0.1, bore: 0.075, mat: m.stainless })
  moving.add(arm, head, ram.root)

  // The pose: where the middle of the shaft is, along the tunnel and out from the car.
  let bx = 0
  let bq = home
  const pose = (phi: number) => {
    arm.rotation.y = s * phi
    bx = xPivot + La * Math.cos(phi)
    bq = reach - La * Math.sin(phi)
    head.position.set(bx, ARM_Y, zAt(bq + lean))
    lugAt(phi, lug)
    ram.aim(ramX, RAM_Y, zPost, lug.x, RAM_Y, lug.z)
  }
  pose(phiHome)
  shade.scale.set(0.42, 1, 0.42)

  kit.pickBox(root, 0.8, spec.mast, 0.8, xPivot, spec.mast / 2, zPost)
  kit.pickBox(root, railEnd - xPivot + 0.1, 0.7, 0.8, (xPivot + railEnd) / 2, 0.35, zPost)
  // A spare's foam hangs in a narrow column, and its pick keeps to it.
  kit.pickCylinder(head, beside ? CORE + LIMP : Math.max(1.1, R * 0.62), spec.foamHi + 0.2, 0, up((spec.foamHi + 0.2) / 2), 0)

  return {
    movers: [arm, head, ram.root, ram.rod],
    brush,
    beacon: { x: xPivot, y: spec.mast, z: zPost },
    limp: limpBox(brush, 'y', length, CORE + LIMP, new Box3()),
    update(st) {
      // activity swings the arm between waiting by the wall and working. A spare never works.
      const a = beside ? 0 : st.activity
      const want = phiPress - (held ? held.at(st.carDx) : phiPress - phiHome)
      pose(phiHome + (want - phiHome) * smooth(a))
      let pressed = false
      if (held && st.carDx != null) {
        planPress(bx - st.carDx, bq, R + 0.4 + sinT * length * 0.5)
        if (PRESS.hit && PRESS.d < R + 0.25) {
          // The plane, turned into the leaning head's own space.
          const nz = s * PRESS.ny
          brush.setContact(PRESS.nx, -s * sinT * nz, cosT * nz, Math.max(CORE + 0.22, PRESS.d - 0.1))
          pressed = true
        }
      }
      if (!pressed) brush.clearContact()
      brush.setSpin(a)
      brush.advance(st.dt)
      const flare = 0.42 + 0.58 * (1 - (1 - a) * (1 - a))
      shade.scale.set(flare, 1, flare)
    },
  }
}

// ---- A low brush along the tunnel, on parallel arms ---------------------------------------
// MacNeil's Wheel Boss (wheel cleaner) and Gloss Boss (tire shine applicator) are the
// same machine with different brushes: a long brush at tire height, carried on a beam
// that swings out from a base by the wall on two parallel arms, so it stays square to
// the car. An air cylinder under the arms sets the side pressure. It waits by the wall,
// comes out alongside the car and leans in on each wheel as it rolls past.

const LINK_Y = 0.62
const BEAM_Y = 0.86
// The arms' angle off the tunnel's line, waiting and at full reach. Waiting, they fold
// along the base but not flat: two bars in one plane need room beside each other.
const A_HOME = 0.2
const A_MAX = 1.25

export type TireSpec = {
  s: 1 | -1
  // Gloss Boss: a dense black applicator a little lower, with its dressing manifold.
  gloss: boolean
  // Where the brush's shaft waits, in feet from the car's centerline. Never nearer than
  // the car allows (0 for a spare beside the tunnel, which is built folded).
  home: number
  // The brush's length along the tunnel.
  length: number
  sign: string | null
  seed: number
}

export function tireUnit(input: ModelInput, spec: TireSpec, root: Group, fixed: Group, moving: Group): Unit {
  const { kit } = input
  const m = kit.mat
  const fine = input.detail === 'high'
  // A spare: no car, built at rest around its own brush (see park).
  const beside = input.side === 'outside'
  const { s, gloss } = spec
  const R = gloss ? 0.5 : 0.6
  const core = gloss ? 0.2 : 0.24
  const axisY = gloss ? 0.82 : 1.0
  const bl = spec.length
  const flank = CAR.width / 2
  const wall = input.tunnelWidth / 2 - s * CAR.z

  const home = Math.max(spec.home, flank + R + 0.3)
  // A spare has no car: the line distances are measured from goes where it brings the
  // brush to the origin.
  const carZ = beside ? -s * home : CAR.z - input.y
  const zAt = (q: number) => carZ + s * q
  // Alongside the car the bristles just clear the paint; on a wheel they are pressed in.
  const ready = Math.min(home, flank + R + 0.12)
  const pressed = Math.min(home, flank + R - 0.2)
  // A spare's arms are only as long as its footprint is deep: the brush, the beam behind
  // it and the base's floor plates take about 2 ft of it whatever they are.
  const Lk = beside
    ? clamp((Math.min(input.w, input.h) - 2.05) / Math.sin(A_HOME), 0.9, 1.3)
    : Math.max(1.3, (home - pressed) / (Math.sin(A_MAX) - Math.sin(A_HOME)))
  const alphaAt = (q: number) => Math.asin(clamp(Math.sin(A_HOME) + (home - q) / Lk, -1, 1))
  const qBeam = home + Math.max(R + 0.34, 0.96)
  const zBeam = zAt(qBeam)
  const zAxis = zAt(home)
  const zBase = zAt(qBeam + Lk * Math.sin(A_HOME))
  // The arms trail toward the exit: their base pins stand upstream of the beam's.
  const xc1 = bl / 2 + 0.35
  const pitch = clamp(bl * 0.5, 1.2, 1.8)
  const xb1 = xc1 - Lk * Math.cos(A_HOME)
  const xb2 = xb1 - pitch
  // Coming out, the beam also swings upstream. Where the brush's middle ends up by the car.
  const xReady = Lk * (Math.cos(alphaAt(ready)) - Math.cos(A_HOME))

  // ---- Parts that never move: a floor rail with the two base pins, and a stanchion ----
  fixed.add(kit.beam([xb2 - 0.45, 0.14, zBase], [xb1 + 0.45, 0.14, zBase], [0.34, 0.24], m.frame))
  foot(kit, fixed, moving, xb2 - 0.2, zBase, 0.8, 0.85)
  foot(kit, fixed, moving, xb1 + 0.2, zBase, 0.8, 0.85)
  for (const x of [xb1, xb2]) {
    fixed.add(at(kit.cyl(0.16, LINK_Y - 0.32, m.frame), x, (0.26 + LINK_Y - 0.06) / 2, zBase))
    moving.add(kit.rod([x, 0.26, zBase], [x, LINK_Y + 0.2, zBase], 0.05, m.stainless))
  }
  const STAND = 2.5
  const xStand = xb2 - 0.3
  fixed.add(kit.beam([xStand, 0.26, zBase], [xStand, STAND, zBase], 0.2, m.frame))
  fixed.add(at(kit.paint(kit.box(0.2, 0.52, 0.46, m.frame, 0.03), 'dark'), xStand - 0.2, 1.62, zBase))
  // A spare's plate comes no further back than the base's floor plates.
  if (spec.sign) badge(kit, fixed, spec.sign, xStand - 0.1, STAND - 0.3, zBase, 1.7, beside ? zBase + s * 0.425 : undefined)
  if (fine) fixed.add(kit.paint(kit.tube([[xStand + 0.12, 1.4, zBase], [xStand + 0.12, 0.34, zBase], [xb2 + 0.5, 0.3, zBase]], 0.022, m.stainless, { bend: 0.15, radial: 6 }), 'hoseBlue'))
  if (gloss) {
    // The dressing: a pail by the wall and the line up to the pump in the box. A spare's
    // stands just behind its base.
    const room = beside ? 1.3 : wall - (qBeam + Lk * Math.sin(A_HOME))
    const qPail = qBeam + Lk * Math.sin(A_HOME) + clamp(room - 0.75, 0.1, 0.95)
    const xPail = xStand + 0.45
    fixed.add(at(kit.paint(kit.cyl(0.36, 0.92, m.frame, { bevel: 0.05, radial: 16 }), 'blue'), xPail, 0.46, zAt(qPail)))
    fixed.add(at(kit.paint(kit.cyl(0.38, 0.06, m.frame, { bevel: 0.02, radial: 16 }), 'white'), xPail, 0.94, zAt(qPail)))
    // Being painted, the pail is drawn with the moving parts (see settle), which cast no
    // real shadow: it gets a blob instead.
    kit.blob(root, 0.76, 0.76, { x: xPail, z: zAt(qPail), cast: 0.97 })
    if (fine) fixed.add(kit.paint(kit.tube([[xPail, 0.96, zAt(qPail)], [xPail, 1.25, zAt(qPail)], [xStand - 0.1, 1.5, zBase + s * 0.1], [xStand - 0.2, 1.4, zBase]], 0.02, m.stainless, { bend: 0.2, radial: 6 }), 'hoseWhite'))
  }

  // ---- Parts that move ----
  const link = (x: number) => {
    const g = new Group()
    g.position.set(x, LINK_Y, zBase)
    g.add(kit.beam([-0.14, 0, 0], [Lk + 0.14, 0, 0], [0.2, 0.12], m.frame, 0.03))
    g.add(at(kit.bearing(0.15), 0, 0.07, 0))
    g.add(at(kit.cyl(0.13, 0.1, m.motor, { radial: 12 }), Lk, 0.09, 0))
    return g
  }
  const link1 = link(xb1)
  const link2 = link(xb2)
  const LUG = Math.min(0.9, Lk * 0.6)
  link1.add(at(kit.box(0.14, 0.22, 0.14, m.frame, 0.02), LUG, -0.13, 0))

  // The carriage, built where it waits: the beam, the brush in its brackets, the guard.
  const carriage = new Group()
  carriage.add(kit.beam([-(bl / 2 + 0.42), BEAM_Y, zBeam], [bl / 2 + 0.55, BEAM_Y, zBeam], [0.26, 0.3], m.frame))
  // End plates: they hold the shaft off the beam and carry the cover over the brush.
  const top = axisY + R + 0.2
  const hold = qBeam - home + 0.37
  for (const end of [-1, 1]) {
    carriage.add(at(kit.box(0.09, 0.46, hold, m.frame, 0.02), end * (bl / 2 + 0.11), axisY, zAt(home + hold / 2 - 0.24)))
    carriage.add(at(kit.box(0.09, top - axisY - 0.2, 0.66, m.frame, 0.02), end * (bl / 2 + 0.11), (top + axisY + 0.2) / 2, zAt(home + 0.09)))
    carriage.add(at(lay(kit.cyl(core + 0.1, 0.05, m.motor, { radial: 12 }), 'x'), end * (bl / 2 + 0.01), axisY, zAxis))
  }
  const pillow = kit.bearing(0.17)
  pillow.rotation.z = Math.PI / 2
  carriage.add(at(pillow, -(bl / 2 + 0.2), axisY, zAxis))
  carriage.add(kit.rod([-(bl / 2 + 0.32), axisY, zAxis], [bl / 2 + 0.2, axisY, zAxis], 0.055, m.stainless))
  carriage.add(at(lay(kit.cyl(core, bl, m.motor, { bevel: 0.02 }), 'x'), 0, axisY, zAxis))
  // The cover: a plate over the top of the brush with a lip sloping down toward the car
  // and a short flange behind. The back is left open, as on the real one, so the brush
  // shows from the wall side too.
  const wide = bl + 0.36
  carriage.add(at(kit.box(wide, 0.05, 0.84, m.frame, 0.02), 0, top, zAt(home + 0.1)))
  carriage.add(at(kit.box(wide, 0.16, 0.05, m.frame, 0.02), 0, top - 0.07, zAt(home + 0.5)))
  const lip = at(kit.box(wide, 0.05, 0.34, m.frame, 0.02), 0, top - 0.095, zAt(home - 0.44))
  lip.rotation.x = -s * 0.61
  carriage.add(lip)
  // The gearmotor on the downstream end, its can lying back toward the wall.
  const gear = gearmotor(kit, 0.19, 0.4)
  gear.rotation.set((s * Math.PI) / 2, s > 0 ? Math.PI : 0, 0)
  gear.position.set(bl / 2 + 0.4, axisY, zAt(home - 0.14))
  carriage.add(gear)
  if (gloss) {
    // The dressing manifold: a thin tube under the guard's lip, dripping onto the brush.
    const zDrip = zAt(home - 0.22)
    carriage.add(kit.tube([[-bl / 2 + 0.1, top - 0.1, zDrip], [bl / 2 - 0.1, top - 0.1, zDrip]], 0.03, m.stainless, { radial: 6 }))
    const drips = fine ? Math.max(3, Math.round(bl / 0.8)) : 0
    for (let k = 0; k < drips; k++) {
      const x = -bl / 2 + 0.3 + ((bl - 0.6) * k) / (drips - 1)
      carriage.add(kit.rod([x, top - 0.1, zDrip], [x, top - 0.24, zDrip], 0.022, m.stainless))
    }
  }
  const brush = kit.foamBrush(gloss
    ? {
      // Dense, even, feather-tipped nylon, black and wet with dressing.
      axis: 'x', length: bl - 0.1, diameter: R * 2, core: core * 2, tiers: Math.max(5, Math.round(bl / 0.3)), perTier: 22, stripWidth: 0.19,
      colors: ['#15171b', '#1d2026'], jitter: 0.35, dir: s > 0 ? 1 : -1, rps: 1.25, drum: false, floor: axisY - 0.03, seed: spec.seed,
    }
    : {
      // Black bristle with blue bands, turning down into the tire and visibly faster.
      axis: 'x', length: bl - 0.1, diameter: R * 2, core: core * 2, tiers: Math.max(5, Math.round(bl / 0.38)), perTier: 22, stripWidth: 0.24,
      colors: ['#17191d', '#17191d', '#2f4fd0'], bandTiers: 1, jitter: 0.45, dir: s > 0 ? 1 : -1, rps: 2.4, drum: false, floor: axisY - 0.03, seed: spec.seed,
    })
  brush.root.position.set(0, axisY, zAxis)
  carriage.add(brush.root)
  kit.blob(carriage, bl + 0.7, R * 2 + 0.75, { shape: 'box', cast: top, x: 0.1, z: zAt(home + 0.35) })

  // The cylinder runs under the arms, from the upstream base pin to a lug on the other arm.
  const ramX = xb2 + 0.14
  const lug = { x: 0, z: 0 }
  const lugAt = (alpha: number) => {
    lug.x = xb1 + LUG * Math.cos(alpha)
    lug.z = zBase - s * LUG * Math.sin(alpha)
  }
  const span = (alpha: number) => {
    lugAt(alpha)
    return Math.hypot(lug.x - ramX, lug.z - zBase)
  }
  const far = span(A_HOME)
  const near = span(alphaAt(pressed))
  const ram = kit.airCylinder({ body: Math.max(0.4, near - 0.5), stroke: far - near + 0.08, bore: 0.07, mat: m.stainless })
  moving.add(link1, link2, carriage, ram.root)

  let xNow = 0
  const pose = (q: number) => {
    const alpha = alphaAt(q)
    link1.rotation.y = s * alpha
    link2.rotation.y = s * alpha
    xNow = Lk * (Math.cos(alpha) - Math.cos(A_HOME))
    carriage.position.set(xNow, 0, s * (q - home))
    lugAt(alpha)
    ram.aim(ramX, RAM_Y, zBase, lug.x, RAM_Y, lug.z)
  }
  pose(home)

  kit.pickBox(root, xb1 - xb2 + 1.4, 0.8, beside ? 0.85 : 0.9, (xb1 + xb2) / 2, 0.4, zBase)
  kit.pickBox(root, 0.6, STAND, 0.6, xStand, STAND / 2, zBase)
  // A spare's keeps to the beam's ends and the brush's face, where its footprint ends.
  if (beside) kit.pickBox(carriage, bl + 1.02, top + 0.1, R * 2 + 0.6, 0.09, (top + 0.1) / 2, zAt(home + 0.35))
  else kit.pickBox(carriage, bl + 1.3, top + 0.1, R * 2 + 0.7, 0.15, (top + 0.1) / 2, zAt(home + 0.3))

  // The wheels, from the car's center.
  const axle = CAR.wheelbase / 2
  return {
    movers: [link1, link2, carriage, ram.root, ram.rod],
    brush,
    beacon: { x: xStand, y: STAND, z: zBase },
    // Its strips are too short to fall further out than the brush's own radius.
    limp: limpBox(brush, 'x', bl - 0.1, R, new Box3()),
    update(st) {
      // A spare never works.
      const a = beside ? 0 : st.activity
      const k = smooth(a)
      // It leans in while a wheel is somewhere along the brush.
      let lean = 0
      if (st.carDx != null && !beside) {
        const front = Math.abs(st.carDx + axle - xReady)
        const rear = Math.abs(st.carDx - axle - xReady)
        lean = smooth(1 - (Math.min(front, rear) - (bl / 2 - 0.2)) / 1.5)
      }
      const q = home + (ready - home) * k + (pressed - ready) * lean * k
      pose(q)
      // Bristles stop at the tire's face and the sill.
      if (st.carDx != null && !beside && Math.abs(xNow - st.carDx) < CAR_HALF + bl / 2 && q - flank < R + 0.1) brush.setContact(0, 0, -s, Math.max(core + 0.08, q - flank - 0.03))
      else brush.clearContact()
      brush.setSpin(a)
      brush.advance(st.dt)
    },
  }
}
