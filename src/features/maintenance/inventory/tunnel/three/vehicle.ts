import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Group, LatheGeometry, Mesh, Path, Shape, Vector2 } from 'three'
import type { Material } from 'three'
import { CAR, CAR_PROFILE, carHeightAt } from './car'
import { COLORS } from './kit'
import type { Kit, Paint } from './kit'

// The demo car that rides the conveyor: a white mid-size SUV.
//
// The exported signature is the contract and is frozen: createVehicle(kit) -> Vehicle
// { root, update(car), dispose() }. TunnelScene decides where the car is and whether
// there is one (root.visible); everything else about it is the vehicle's: update() puts
// root at car.x, shows how much of the car is there (car.presence) and turns the wheels.
// It moves, so it casts no real shadow: it has a kit.blob with cast set.
//
// HOW THE BODY IS MADE. Brushes follow the numbers in car.ts (the roofline, the width,
// the wheels), so the body is built from those numbers and not beside them. It is one
// skin stretched over cross-sections: at each station along the car, section() gives half
// of the outline there, from the keel out to the sill, up the door, in along the glass
// and over the roof to the centerline. The top of every section is car.ts's roofline at
// that station (corners eased), which is what makes the windshield, the hood and the
// tailgate. Sections get a notch where a wheel is, which makes the arches and the wells
// behind them. Then every patch of that skin is given a material by where it lies:
// paint, glass, black cladding, a lamp. So the windows, pillars, grille and lights are
// regions of the one surface and always fit it.

// Where the demo car is this frame. One object, reused: don't keep it.
export type CarState = {
  // The car's center along the tunnel, in feet.
  x: number
  // Seconds of scene time, and since the last frame (0 while paused).
  t: number
  dt: number
  // Feet per second right now: CAR.speed on the conveyor, 0 while it's parked short of
  // the entrance because the conveyor is down.
  speed: number
  // How much of the car is there: it grows in from 0 at the start of each pass (a touch
  // over 1 as it lands) and shrinks away at the end, since there is no road beyond the slab.
  presence: number
}

export type Vehicle = {
  // Nose toward +X. The scene adds it to the world.
  root: Group
  update(car: CarState): void
  dispose(): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smooth = (v: number) => {
  const c = clamp(v, 0, 1)
  return c * c * (3 - 2 * c)
}

const AXLE = CAR.wheelbase / 2
const WHEEL_Y = CAR.wheelRadius
// Each wheel's center from the car's centerline. The conveyor carries the driver's side
// pair, so this and CAR.z fix where the car sits on it.
const WHEEL_Z = CAR.width / 2 - 0.5
const TIRE_WIDE = 0.82
// Clearance under the sills.
const CLEAR = 0.82
// The wheel arch's opening and the black flare around it, as radii from the wheel's center.
const ARCH = CAR.wheelRadius + 0.3
const FLARE = ARCH + 0.24
// Half the arch's width where it meets the sill.
const ARCH_FOOT = Math.sqrt(ARCH * ARCH - (WHEEL_Y - CLEAR) * (WHEEL_Y - CLEAR))
// The wheel well's inner wall.
const WELL = 2.0
// Top of the black cladding along the sills.
const CLAD = 1.42
// How far the side glass leans in per foot of height.
const TUMBLE = 0.27
// The roof's edge sits this far under its middle: the corner's radius and the crown.
const CORNER = 0.33

// How much each corner of car.ts's roofline is eased, in feet either side of it. Small:
// the body stays within an inch or so of the outline brushes follow.
const EASE = [0, 0.02, 0.12, 0.25, 1.2, 0.3, 0.25, 0.3, 0.06, 0]

// The top of the body at x: car.ts's roofline with its corners eased.
function roofAt(x: number): number {
  for (let k = 1; k < CAR_PROFILE.length - 1; k++) {
    const c = EASE[k]
    const [vx, vy] = CAR_PROFILE[k]
    if (Math.abs(x - vx) >= c) continue
    const ya = carHeightAt(vx - c)
    const yb = carHeightAt(vx + c)
    const t = (x - (vx - c)) / (2 * c)
    return (1 - t) * (1 - t) * ya + 2 * t * (1 - t) * vy + t * t * yb
  }
  return carHeightAt(x)
}

// The underside: level between the wheels, rising toward the bumpers.
const bottomAt = (x: number) => CLEAR + 0.3 * smooth((Math.abs(x) - 6.2) / 1.3)

// Half the body's width: full between the wheels, a little proud over them, drawn in
// around the nose and tail (inside carHalfWidthAt everywhere).
function widthAt(x: number): number {
  const a = Math.abs(x)
  const end = clamp((a - 6.1) / 1.68, 0, 1)
  const over = clamp((a - AXLE) / 1.9, -1, 1)
  return 3.05 - 0.55 * Math.pow(end, 2.4) + 0.06 * (1 - over * over) * (1 - over * over)
}

const beltAt = (x: number) => 3.8 - 0.017 * x

// Where the body's skin ends: the stations at which the roofline comes down to the
// underside, just inside the nose and the tail.
function skinEnd(dir: 1 | -1): number {
  let lo = dir * 7.5
  let hi = dir * (CAR.length / 2)
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (roofAt(mid) > bottomAt(mid) + 0.05) lo = mid
    else hi = mid
  }
  return lo
}

// Points on half a cross-section, and the bands between them (band k runs from point k
// to point k + 1).
const RING = 17
const BAND = { floor: 0, wellWall: 1, wellRoof: 2, lip: 3, cladding: 4, door: 5, doorTop: 6, shoulder: 7, belt: 8, glass: 9, rail: 10, corner: 11, top: 12 } as const

// Half the body's cross-section at x, as [z, y] pairs from the keel around to the middle
// of the roof. Always RING points, so sections join into one skin.
function section(x: number, out: Float32Array): Float32Array {
  const H = roofAt(x)
  const G = Math.min(bottomAt(x), H - 0.03)
  const W = widthAt(x)
  const tall = H - G
  const cr = Math.min(CORNER, tall * 0.42)
  // The roof's edge (the top of the side glass), and the beltline under it. Where the
  // roofline is below the belt (hood, tail) the two meet and there is no glass.
  const E = H - cr
  const belt = Math.min(beltAt(x), E)
  const fromAxle = Math.abs(Math.abs(x) - AXLE)
  const notch = fromAxle < ARCH_FOOT ? WHEEL_Y - G + Math.sqrt(ARCH * ARCH - fromAxle * fromAxle) : 0
  let clad = CLAD + 0.45 * smooth((Math.abs(x) - 6.2) / 1.0)
  if (fromAxle < FLARE) clad = Math.max(clad, WHEEL_Y + Math.sqrt(FLARE * FLARE - fromAxle * fromAxle))
  const gap = Math.min(0.03, tall / 16)

  const set = (k: number, z: number, y: number) => {
    out[k * 2] = z
    out[k * 2 + 1] = y
  }
  set(0, 0, G)
  set(1, Math.min(WELL, W - 0.5), G)
  set(2, Math.min(WELL, W - 0.5), G + notch)
  set(3, W - 0.16, G + notch)
  // Up the side: each height is where it wants to be, squeezed between the sill (or the
  // arch) below and the roof's edge above.
  const want = [G + notch + Math.min(0.1, tall * 0.15), clad, 2.55, belt - 0.3, belt - 0.05, belt]
  const zs = [W - 0.06, W + 0.03, W, W - 0.01, W - 0.045, W - 0.085]
  for (let k = 1; k < want.length; k++) want[k] = Math.max(want[k], want[k - 1] + gap)
  want[5] = Math.min(want[5], belt)
  for (let k = 4; k >= 0; k--) want[k] = Math.min(want[k], want[k + 1] - gap)
  for (let k = 0; k < want.length; k++) set(4 + k, zs[k], Math.max(want[k], G + notch))
  // In along the glass, round the corner, across the roof.
  const zE = zs[5] - (E - belt) * TUMBLE
  set(10, zE, E)
  set(11, zE - cr * 0.2, E + cr * 0.42)
  const zT = zE - cr * 0.62
  set(12, zT, E + cr * 0.76)
  set(13, zT * 0.8, H - cr * 0.09)
  set(14, zT * 0.55, H - cr * 0.03)
  set(15, zT * 0.28, H - cr * 0.006)
  set(16, 0, H)
  return out
}

type Part = 'paint' | 'glass' | 'trim' | 'red' | 'white' | 'amber'

// Which material the patch of skin at x, in a band, wears.
function wear(x: number, band: number): Part {
  if (band <= BAND.cladding) return 'trim'
  // The two bumpers are black from the ground to here, all the way round their corners.
  const face = x >= 7.56 || x < -7.745
  if (face && roofAt(x) <= 1.95) return 'trim'
  if (band <= BAND.shoulder) return 'paint'
  // The black line under the glass.
  if (band === BAND.belt) return x > -6.2 && x < 3.28 ? 'trim' : 'paint'
  if (band === BAND.glass) {
    if (x < -6.2 || x > 3.28) return 'paint'
    // The pillars between the doors.
    if ((x > -3.7 && x < -3.48) || (x > 0.05 && x < 0.3)) return 'trim'
    return 'glass'
  }
  const corner = band <= BAND.corner
  const outer = band === BAND.top
  // The nose, below the hood's lip: lamps at the corners with the grille between them,
  // the grille carrying on a little way down the face.
  if (x > 7.15 && x < 7.56) {
    if (band === BAND.top + 1) return 'paint'
    if (!corner && !outer) return 'trim'
    // A dark lamp with a bright running light across it, the turn signal at the corner.
    if (x > 7.25 && x < 7.34) return 'white'
    return band === BAND.rail && x > 7.34 ? 'amber' : 'glass'
  }
  if (face) return x >= 7.56 && x < 7.63 && band > BAND.top + 1 ? 'trim' : 'paint'
  // The tail lamps stand up the rear corners, beside the glass.
  if (x < -7.42) {
    if (corner || outer) return x > -7.68 ? 'red' : 'paint'
    return x > -7.55 ? 'glass' : 'paint'
  }
  if (x < -6.72) return corner || outer ? 'paint' : 'glass'
  if (x > 1.72 && x < 3.42) return corner ? 'paint' : 'glass'
  // The black rail over the doors' glass.
  if (band === BAND.rail && x > -6.2 && x < 1.6) return 'trim'
  return 'paint'
}

// Stations along the car: every place something starts or ends, each wheel arch closely
// spaced, and enough in between for the skin to follow the curves. The phone tier keeps
// only the edges that change what the skin wears (lamps, pillars, glass) and rounds the
// nose, tail and arches more coarsely: it is a few dozen pixels long there.
function stations(low: boolean, tail: number, nose: number): number[] {
  const xs: number[] = low
    ? [
        tail, -7.762, -7.752, -7.72, -7.6, -7.48, -7.42, -7.15, -6.72, -6.2,
        -3.7, -3.48, 0.05, 0.3, 1.45, 1.72, 3.28, 3.42, 3.6, 3.85,
        6.75, 7.03, 7.15, 7.25, 7.34, 7.56, 7.63, 7.66, nose,
      ]
    : [
        tail, -7.772, -7.762, -7.752, -7.745, -7.72, -7.68, -7.6, -7.55, -7.48, -7.42, -7.3, -7.15, -7.0, -6.85, -6.72, -6.6, -6.45, -6.3, -6.2,
        -3.7, -3.48, 0.05, 0.3, 1.3, 1.45, 1.6, 1.72, 1.9, 3.28, 3.42, 3.5, 3.6, 3.72, 3.85,
        6.6, 6.75, 6.9, 7.03, 7.15, 7.25, 7.34, 7.47, 7.56, 7.6, 7.63, 7.66, 7.69, nose,
      ]
  const steps = low ? 6 : 10
  const reach = Math.asin(ARCH_FOOT / ARCH)
  for (const ax of [-AXLE, AXLE]) {
    for (let k = 0; k <= steps; k++) xs.push(ax + ARCH * Math.sin(-reach + (2 * reach * k) / steps))
    for (const s of [-1, 1]) {
      // The arch's foot is a step in the section: a station either side of it.
      xs.push(ax + s * (ARCH_FOOT + 0.0015))
      for (const d of low ? [FLARE - 0.01] : [1.52, 1.6, 1.68, FLARE - 0.01]) xs.push(ax + s * d)
    }
  }
  xs.sort((a, b) => a - b)
  const out: number[] = []
  const most = low ? 1.8 : 0.9
  for (const x of xs) {
    const last = out[out.length - 1]
    if (last != null && x - last < 0.001) continue
    if (last != null && x - last > most) {
      const n = Math.ceil((x - last) / most)
      for (let k = 1; k < n; k++) out.push(last + ((x - last) * k) / n)
    }
    out.push(x)
  }
  return out
}

// The skin, cut into one geometry per material.
function buildBody(low: boolean): Partial<Record<Part, BufferGeometry>> {
  const tail = skinEnd(-1)
  const nose = skinEnd(1)
  const xs = stations(low, tail, nose)
  const around = (RING - 1) * 2
  // A closed end: one more ring at each end, squeezed flat.
  const rows = xs.length + 2
  const pos = new Float32Array(rows * around * 3)
  const half = new Float32Array(RING * 2)
  for (let i = 0; i < rows; i++) {
    const x = xs[clamp(i - 1, 0, xs.length - 1)]
    section(x, half)
    const shut = i === 0 || i === rows - 1
    const mid = (half[1] + half[(RING - 1) * 2 + 1]) / 2
    for (let r = 0; r < around; r++) {
      const h = r < RING ? r : around - r
      const o = (i * around + r) * 3
      pos[o] = x
      pos[o + 1] = shut ? mid : half[h * 2 + 1]
      pos[o + 2] = (r < RING ? 1 : -1) * half[h * 2]
    }
  }
  const index: Record<Part, number[]> = { paint: [], glass: [], trim: [], red: [], white: [], amber: [] }
  const all: number[] = []
  for (let i = 0; i < rows - 1; i++) {
    const xm = (xs[clamp(i - 1, 0, xs.length - 1)] + xs[clamp(i, 0, xs.length - 1)]) / 2
    for (let r = 0; r < around; r++) {
      const band = r < RING - 1 ? r : around - 1 - r
      const a = i * around + r
      const b = i * around + ((r + 1) % around)
      const c = a + around
      const d = b + around
      const list = index[i === 0 || i === rows - 2 ? 'trim' : wear(xm, band)]
      list.push(a, c, d, a, d, b)
      all.push(a, c, d, a, d, b)
    }
  }
  // Normals from the whole skin, so shading runs unbroken from paint into glass.
  const whole = new BufferGeometry()
  whole.setAttribute('position', new BufferAttribute(pos, 3))
  whole.setIndex(all)
  whole.computeVertexNormals()
  const nor = whole.attributes.normal.array as Float32Array
  whole.dispose()

  const out: Partial<Record<Part, BufferGeometry>> = {}
  for (const part of Object.keys(index) as Part[]) {
    const idx = index[part]
    if (!idx.length) continue
    // Only the points this part uses.
    const map = new Map<number, number>()
    const p: number[] = []
    const n: number[] = []
    const tri: number[] = []
    for (const v of idx) {
      let k = map.get(v)
      if (k == null) {
        k = map.size
        map.set(v, k)
        p.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
        n.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2])
      }
      tri.push(k)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(n), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array((p.length / 3) * 2), 2))
    g.setIndex(tri)
    out[part] = g
  }
  return out
}

// A strip laid on the skin between two points of the section, from station x to x + wide:
// a door's shut line.
function seam(x: number, wide: number, from: number, to: number, proud: number): BufferGeometry {
  const a = section(x, new Float32Array(RING * 2))
  const b = section(x + wide, new Float32Array(RING * 2))
  const pos: number[] = []
  const idx: number[] = []
  for (const side of [1, -1]) {
    const base = pos.length / 3
    for (let k = from; k <= to; k++) {
      pos.push(x, a[k * 2 + 1], side * (a[k * 2] + proud), x + wide, b[k * 2 + 1], side * (b[k * 2] + proud))
    }
    for (let k = 0; k < to - from; k++) {
      const p = base + k * 2
      if (side > 0) idx.push(p, p + 1, p + 3, p, p + 3, p + 2)
      else idx.push(p, p + 3, p + 1, p, p + 2, p + 3)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// A tire, lying on the wheel's axis (Z): tread, rounded shoulders, sidewalls.
function tireGeo(low: boolean): BufferGeometry {
  const R = CAR.wheelRadius
  const w = TIRE_WIDE / 2
  const side: Array<[number, number]> = [[0.7, 0.35], [0.9, w], [1.1, 0.39], [R - 0.025, 0.33], [R, 0.24]]
  const pts: Vector2[] = []
  for (const [r, a] of side) pts.push(new Vector2(r, -a))
  for (let k = side.length - 1; k >= 0; k--) pts.push(new Vector2(side[k][0], side[k][1]))
  const g = new LatheGeometry(pts, low ? 12 : 20)
  g.rotateX(Math.PI / 2)
  return g
}

// The alloy's face: a disc with five windows cut in it, which leaves five spokes.
function rimGeo(low: boolean): BufferGeometry {
  const spokes = 5
  const face = new Shape()
  for (let k = 0; k < spokes; k++) face.absarc(0, 0, 0.73, (k / spokes) * Math.PI * 2, ((k + 1) / spokes) * Math.PI * 2, false)
  for (let k = 0; k < spokes; k++) {
    const a0 = ((k + 0.5) / spokes) * Math.PI * 2 - 0.44
    const a1 = ((k + 0.5) / spokes) * Math.PI * 2 + 0.44
    const hole = new Path()
    hole.absarc(0, 0, 0.6, a0, a1, false)
    // Narrower toward the hub, so the spokes widen where they meet it.
    hole.absarc(0, 0, 0.26, a1 - 0.2, a0 + 0.2, true)
    hole.closePath()
    face.holes.push(hole)
  }
  // Square edged: a bevel on every window's edge triples the walls, and from outside the
  // tunnel the spokes read the same without it.
  return new ExtrudeGeometry(face, { depth: 0.08, bevelEnabled: false, curveSegments: low ? 1 : 3 })
}

export function createVehicle(kit: Kit): Vehicle {
  const m = kit.mat
  const low = kit.detail === 'low'
  const parts = new Group()
  // The same shadow flags as the kit's shapes, so each material merges into one mesh.
  const solid = (geo: BufferGeometry, material: Material) => {
    const mesh = new Mesh(geo, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parts.add(mesh)
    return mesh
  }
  const at = <T extends Mesh>(mesh: T, x: number, y: number, z: number): T => {
    mesh.position.set(x, y, z)
    parts.add(mesh)
    return mesh
  }
  // A square-edged box, for parts too thin for a bevel to show.
  const slab = (w: number, h: number, d: number, material: Material) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
  const flat = (w: number, h: number, d: number, color: Paint) => {
    const mesh = slab(w, h, d, m.sign)
    kit.swatch(mesh.geometry, color)
    return mesh
  }

  // ---- The body ----
  // The black trim, the lamps and the small bright parts are all painted from the sign
  // atlas, so the whole body is three draw calls: paint, glass and the rest.
  const trim = COLORS.carTrim
  const dark = (mesh: Mesh) => kit.paint(mesh, trim)
  const body = buildBody(low)
  const lamps: Record<'red' | 'white' | 'amber', Paint> = { red: '#d4261c', white: '#dbe9ff', amber: '#f0a030' }
  for (const part of Object.keys(body) as Part[]) {
    const geo = body[part]!
    if (part === 'paint') solid(geo, m.carPaint)
    else if (part === 'glass') solid(geo, m.glass)
    else solid(kit.swatch(geo, part === 'trim' ? trim : lamps[part]), m.sign)
  }

  const sec = new Float32Array(RING * 2)
  if (!low) {
    // Shut lines: the doors, kept faint.
    for (const x of [3.02, 0.17, -3.08]) solid(kit.swatch(seam(x - 0.009, 0.018, 5, 8, 0.004), trim), m.sign)
    // Door handles, in the body's color.
    for (const x of [0.78, -2.72]) {
      section(x, sec)
      for (const s of [-1, 1]) at(slab(0.42, 0.075, 0.06, m.carPaint), x, sec[7 * 2 + 1] + 0.02, s * (sec[7 * 2] + 0.012))
    }
  }
  // Mirrors, on the doors at the foot of the windshield pillars.
  section(2.74, sec)
  for (const s of [-1, 1]) {
    at(dark(kit.box(0.2, 0.1, 0.36, m.sign, 0.04)), 2.78, sec[9 * 2 + 1] + 0.1, s * (sec[9 * 2] + 0.12))
    at(kit.box(0.26, 0.36, 0.46, m.carPaint, 0.1), 2.7, sec[9 * 2 + 1] + 0.26, s * (sec[9 * 2] + 0.36))
    at(slab(0.03, 0.26, 0.36, m.glass), 2.575, sec[9 * 2 + 1] + 0.26, s * (sec[9 * 2] + 0.36))
  }
  // Roof rails.
  const railPts = [-5.9, -5.55, -2.6, 0.45, 0.8]
  for (const s of [-1, 1]) {
    parts.add(dark(kit.tube(railPts.map((x, k) => {
      section(x, sec)
      const foot = k === 0 || k === railPts.length - 1
      return [x, sec[13 * 2 + 1] + (foot ? -0.04 : 0.15), s * (sec[12 * 2] - 0.16)] as const
    }), 0.045, m.sign, { bend: 0.14, radial: low ? 4 : 6 })))
  }
  // Plates, and the skid plate under the nose.
  at(flat(0.03, 0.42, 1.0, '#eef0f2'), faceAt(-1, 2.3) - 0.004, 2.3, 0)
  at(flat(0.03, 0.34, 0.95, '#eef0f2'), faceAt(1, 2.12) + 0.004, 2.12, 0)
  at(flat(0.05, 0.3, 2.2, '#b9bfc7'), faceAt(1, 1.3) - 0.01, 1.3, 0)
  // Bright bars across the grille, and the tailgate's handle strip between the lamps.
  for (const x of [7.27, 7.41, 7.545]) {
    section(x, sec)
    at(flat(0.035, 0.035, sec[14 * 2] * 2 - 0.1, '#c3c8ce'), x + 0.012, roofAt(x) + 0.004, 0)
  }
  at(dark(kit.box(0.05, 0.13, 3.5, m.sign, 0.03)), faceAt(-1, 3.2) - 0.012, 3.2, 0)
  at(flat(0.04, 0.05, 1.1, '#d4261c'), faceAt(-1, 5.28) - 0.01, 5.28, 0)
  // Wipers parked along the foot of the windshield, and the aerial's fin.
  if (!low) {
    for (const z of [-1.25, 0.55]) {
      const wiper = flat(0.05, 0.035, 1.5, trim)
      wiper.rotation.y = 0.06
      at(wiper, 3.36, roofAt(3.36) + 0.03, z)
    }
  }
  at(dark(kit.box(0.5, 0.15, 0.12, m.sign, 0.05)), -5.5, roofAt(-5.5) + 0.05, 0)

  // ---- The wheels ----
  const wheels: Group[] = []
  const rolling = new Group()
  const tire = tireGeo(low)
  const rim = rimGeo(low)
  // On the phone tier the wheels are painted from the atlas too, a draw call fewer: a
  // wheel is a dozen pixels across there.
  const rubber = low ? m.sign : m.rubber
  const alloy = low ? m.sign : m.aluminum
  if (low) {
    kit.swatch(tire, COLORS.rubber)
    kit.swatch(rim, COLORS.aluminum)
  }
  for (const x of [AXLE, -AXLE]) {
    for (const s of [-1, 1]) {
      const wheel = new Group()
      wheel.position.set(x, WHEEL_Y, s * WHEEL_Z)
      // Built for the passenger side and mirrored for the other.
      const inner = new Group()
      inner.scale.z = s
      const add = (mesh: Mesh) => {
        mesh.castShadow = true
        mesh.receiveShadow = true
        inner.add(mesh)
        return mesh
      }
      add(new Mesh(tire, rubber))
      // The barrel behind the spokes, and the brake.
      const barrelGeo = new CylinderGeometry(0.71, 0.71, 0.6, low ? 10 : 14)
      barrelGeo.rotateX(Math.PI / 2)
      if (low) kit.swatch(barrelGeo, COLORS.rubber)
      add(new Mesh(barrelGeo, rubber)).position.z = -0.04
      add(new Mesh(rim, alloy)).position.z = 0.27
      const cap = add(kit.cyl(0.13, 0.06, alloy, { radial: low ? 6 : 8, bevel: 0.02 }))
      if (low) kit.swatch(cap.geometry, COLORS.aluminum)
      cap.rotation.x = Math.PI / 2
      cap.position.z = 0.37
      wheel.add(inner)
      rolling.add(wheel)
      wheels.push(wheel)
    }
  }

  const root = new Group()
  root.name = 'vehicle'
  root.add(kit.mergeStatic(parts), kit.mergeMoving(rolling, wheels))
  tire.dispose()
  rim.dispose()
  // It moves, so it can't cast into the shadow map (drawn once): it gets a blob instead.
  root.traverse((o) => {
    o.castShadow = false
    o.receiveShadow = true
  })
  kit.blob(root, CAR.length - 0.5, CAR.width - 0.3, { shape: 'box', cast: CAR.height - 0.9, soft: 1, contact: 2.3 })
  root.position.z = CAR.z

  return {
    root,
    update(car) {
      // There is no road beyond the slab, so the car is set down at the start of a pass
      // and picked up at the end: it comes down the last couple of feet as it grows to
      // size, and settles on its tires.
      const k = clamp(car.presence, 0, 1)
      const up = 1 - k
      const size = 1 - up * up * up
      const settle = Math.sin(Math.PI * clamp((k - 0.82) / 0.18, 0, 1))
      root.position.set(car.x, up * up * 2.4, CAR.z)
      root.scale.set(Math.max(0.001, size) * (1 + 0.012 * settle), Math.max(0.001, size) * (1 - 0.035 * settle), Math.max(0.001, size) * (1 + 0.012 * settle))
      // The wheels turn exactly as far as the car has come.
      const turn = -car.x / CAR.wheelRadius
      for (let i = 0; i < wheels.length; i++) wheels[i].rotation.z = turn
    },
    dispose() {
      kit.release(root)
      // The wheels are skinned (kit.mergeMoving): their bone textures go too.
      root.traverse((o) => {
        const mesh = o as Mesh & { skeleton?: { dispose(): void } }
        if (mesh.isMesh) mesh.geometry.dispose()
        mesh.skeleton?.dispose()
      })
    },
  }
}

// Where the body's face is at a height, at the nose (dir 1) or the tail (dir -1).
function faceAt(dir: 1 | -1, y: number): number {
  let lo = dir * 6
  let hi = dir * (CAR.length / 2)
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (roofAt(mid) > y) lo = mid
    else hi = mid
  }
  return hi
}
