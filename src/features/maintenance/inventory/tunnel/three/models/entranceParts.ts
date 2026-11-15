import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, DynamicDrawUsage, Group, Mesh, MeshBasicMaterial, Sphere, Vector3 } from 'three'
import type { Material, Object3D } from 'three'
import { CAR, carHeightAt } from '../car'
import { COLORS } from '../kit'
import type { BasePlateOpts, Kit, Paint, V3 } from '../kit'
import { hosePath, sweepGeo } from '../kit/geometry'
import type { ModelInput, ThemeName } from '../types'

// Small parts the entrance models share: sheet metal, indicator LEDs, the light a sensor
// looks with, and what hangs on a prep station (wand, coiled hose, pressure gauge).

// How far a post stands clear of the car's flank, at the least.
const CLEAR = 1.2

// Where a pair of posts stands across the lane, in the model's own z: at the two ends of
// the footprint, pushed out if need be so neither stands where the car passes. A shape
// drawn against one wall still gets a post on each side of the lane, because what it
// carries has to look across (or down on) the car.
export function laneSpan(input: Pick<ModelInput, 'y' | 'h'>, inset: number): { lo: number; hi: number } {
  const lo = Math.min(input.y - input.h / 2 + inset, CAR.z - CAR.width / 2 - CLEAR)
  const hi = Math.max(input.y + input.h / 2 - inset, CAR.z + CAR.width / 2 + CLEAR)
  return { lo: lo - input.y, hi: hi - input.y }
}

// The same pair beside the tunnel, where there is no car to clear: a spare stands on its
// own footprint, its posts at the two ends of the longer side, but never closer to the
// middle than `least`, or what it carries has no room between them. The posts are laid
// out along z as in the tunnel; turned says the longer side is w, so the model turns the
// whole of itself a quarter turn to lie along x instead.
export function spareSpan(input: Pick<ModelInput, 'w' | 'h'>, inset: number, least: number): { lo: number; hi: number; turned: boolean } {
  const half = Math.max(least, Math.max(input.w, input.h) / 2 - inset)
  return { lo: -half, hi: half, turned: input.w > input.h }
}

export function put<T extends Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z)
  return o
}

// Sheet metal, tags and covers: parts too thin for an eased edge to show. A plain box is
// a ninth of the triangles of kit.box.
export function sheet(w: number, h: number, d: number, material: Material): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

// kit.box, kit.beam and kit.basePlate for small parts: on the phone tier they come
// without eased edges or anchor bolts, at a ninth of the triangles. These machines are a
// few pixels across there, and the edges are the first thing nobody can see.
export function block(kit: Kit, w: number, h: number, d: number, material: Material, r?: number): Mesh {
  return kit.detail === 'low' ? sheet(w, h, d, material) : kit.box(w, h, d, material, r)
}

// Tube up to this thick (about an inch and a half) is square edged on every tier: its
// eased edge is narrower than a pixel from anywhere the camera goes.
const THIN = 0.14

export function strut(kit: Kit, a: V3, b: V3, size: number | readonly [number, number], material: Material, r?: number): Mesh {
  const [sx, sz] = typeof size === 'number' ? [size, size] : size
  const m = kit.beam(a, b, size, material, r)
  if (kit.detail === 'low' || Math.max(sx, sz) < THIN) {
    m.geometry.dispose()
    m.geometry = new BoxGeometry(sx, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), sz)
  }
  return m
}

// A base plate. Big ones are the kit's, with eased corners; a post's foot is a plain
// square plate with four hex bolts, as most are, at a third of the triangles.
export function foot(kit: Kit, w: number, d: number, opts: BasePlateOpts = {}): Group {
  if (kit.detail !== 'low' && Math.max(w, d) > 1) return kit.basePlate(w, d, opts)
  const t = opts.t ?? 0.06
  const g = new Group()
  g.add(put(sheet(w, t, d, opts.mat ?? kit.mat.galvanized), 0, t / 2, 0))
  if (kit.detail !== 'low' && opts.bolts !== false) {
    const inset = Math.min(0.14, w * 0.2, d * 0.2)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const bolt = new Mesh(new CylinderGeometry(0.045, 0.045, 0.05, 6), opts.boltMat ?? kit.mat.stainless)
        bolt.castShadow = true
        bolt.receiveShadow = true
        g.add(put(bolt, sx * (w / 2 - inset), t + 0.025, sz * (d / 2 - inset)))
      }
    }
  }
  return g
}

// A hose hanging between two points, like kit.hose, with half the segments and fewer
// sides: the hoses here are an inch across.
export function hang(kit: Kit, a: V3, b: V3, r: number, material: Material, sag = 0.1): Mesh {
  const m = new Mesh(sweepGeo(hosePath(a, b, sag, kit.detail === 'high' ? 7 : 5), r, 5, true), material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

// An electric motor lying along +Y from its foot, like kit.motor without the gearbox, at
// half the triangles: fewer cooling fins, a plain can, a square terminal box.
export function smallMotor(kit: Kit, r: number, len: number): Group {
  const m = kit.mat.motor
  const g = new Group()
  const can = new Mesh(new CylinderGeometry(r, r, len, 12), m)
  g.add(put(can, 0, len / 2, 0))
  const fins = 8
  const fin = new BoxGeometry(0.03, len * 0.82, 0.07)
  for (let k = 0; k < fins; k++) {
    const a = ((k + 0.5) / fins) * Math.PI * 2
    const f = put(new Mesh(fin.clone(), m), Math.cos(a) * (r + 0.02), len / 2, Math.sin(a) * (r + 0.02))
    f.rotation.y = -a + Math.PI / 2
    g.add(f)
  }
  fin.dispose()
  g.add(put(kit.cyl(r * 1.06, r * 0.75, m, { r2: r * 0.9, bevel: 0.05, radial: 12 }), 0, len + r * 0.36, 0))
  g.add(put(sheet(r * 0.9, r * 0.8, r * 0.5, m), 0, len * 0.55, r + r * 0.2))
  g.traverse((o) => {
    o.castShadow = true
    o.receiveShadow = true
  })
  return g
}

// A thin round bar from a to b with few sides: lacing, lances, hooks. A fifth of the
// triangles of kit.rod, for parts no wider than a finger.
export function bar(kit: Kit, a: V3, b: V3, r: number, material: Material): Mesh {
  return kit.tube([a, b], r, material, { radial: 6 })
}

// Recolors every mesh of an assembly from the sign atlas, so a kit part (a motor) can
// share the painted parts' draw call.
export function paintAll<T extends Object3D>(kit: Kit, part: T, color: Paint): T {
  part.traverse((o) => {
    const mesh = o as Mesh
    if (mesh.isMesh) kit.paint(mesh, color)
  })
  return part
}

// A label wrapped round a drum of radius r: a strip of its wall h tall and arc radians
// wide, facing +Z until it is turned.
export function wrapLabel(r: number, h: number, arc: number, material: Material): Mesh {
  const m = new Mesh(new CylinderGeometry(r, r, h, Math.max(3, Math.round(arc * 8)), 1, true, -arc / 2, arc), material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export type LedSpot = {
  at: V3
  // Euler angles. A lens points up +Y until it is turned.
  turn?: V3
}

// Indicator LEDs that light together, shaped like kit.lamp's lens. The lit lenses are one
// mesh the model shows and hides as a whole; under each sits a dark lens that goes in
// with the model's fixed parts. So a bank costs one draw call while it is lit and none
// while it is dark, however many LEDs are in it.
export function leds(kit: Kit, color: 'green' | 'amber' | 'red', r: number, spots: ReadonlyArray<LedSpot>, fixed: Group): Group {
  const lit = new Group()
  lit.name = 'leds'
  lit.userData.keep = true
  const glass = color === 'green' ? kit.mat.lensGreen : color === 'amber' ? kit.mat.lensAmber : kit.mat.lensRed
  for (const spot of spots) {
    for (const on of [true, false]) {
      // The dark lens is a touch smaller, so the lit one hides it completely.
      const k = on ? 1 : 0.9
      const lens = kit.cyl(r * k, r * 1.2 * k, glass, { bevel: r * 0.45 * k, radial: 8 })
      lens.geometry.translate(0, r * 0.6 * k, 0)
      lens.position.set(spot.at[0], spot.at[1], spot.at[2])
      if (spot.turn) lens.rotation.set(spot.turn[0], spot.turn[1], spot.turn[2])
      if (on) lit.add(lens)
      else fixed.add(kit.paint(lens, COLORS.lensOff))
    }
  }
  kit.mergeStatic(lit)
  // A light throws no shadow of its own.
  lit.traverse((o) => { o.castShadow = false })
  lit.visible = false
  return lit
}

// ---- Light ----------------------------------------------------------------------------

export type Glow = {
  material: MeshBasicMaterial
  // Call from update(): keeps the color in step with the theme.
  sync(): void
}

// The flat color a sensor's light is drawn in. On the white page a beam can't be brighter
// than what is behind it, so it is drawn deep and saturated there, and bright on the dark
// one. The material belongs to the model (dispose it), and whatever wears it should carry
// userData.fx so the status layer leaves it alone.
export function glow(kit: Kit, tone: 'red' | 'green', vertexAlpha = false): Glow {
  const color = () => (tone === 'green' ? kit.palette.ok : kit.theme === 'light' ? COLORS.red : kit.palette.danger)
  const material = new MeshBasicMaterial({ color: color(), transparent: true, depthWrite: false, side: DoubleSide, vertexColors: vertexAlpha, toneMapped: false })
  material.name = `glow-${tone}`
  let seen: ThemeName = kit.theme
  return {
    material,
    sync() {
      if (seen === kit.theme) return
      seen = kit.theme
      material.color.set(color())
    },
  }
}

export type ScanFan = {
  mesh: Mesh
  // Lays the light over whatever is under it now. carDx as in RunState; t is scene time
  // (the bright ray sweeps with it); strength is the whole fan's opacity, 0 to 1.
  update(carDx: number | null, t: number, strength: number): void
  dispose(): void
}

const FAN_STEPS = 12
const FAN_LIFT = 0.04
// Half the width of a drawn ray, how far the bright line where the light lands fades
// back up the beam, and half the width of the strip it lays on the surface.
const RAY_W = 0.022
const LINE_FADE = 0.14
const LAY_W = 0.045

// A profiling sensor's light: a fan that opens along the tunnel from a head above the
// car's centerline and lands on whatever passes under it, so where it lands takes the
// shape of the hood, the windshield and the roof as they go by. It is drawn as a detail,
// not a sheet: a breath of light under the head that is gone before it reaches the car, a
// few thin rays, a fine bright line where the light lands (with a strip lying flat on the
// surface so the line shows from above too) and one brighter ray sweeping back and forth.
// A single mesh whose corners are moved each frame (nothing is allocated).
//   apex: the head's height. z: where the fan stands across the tunnel (the model's own
//   z). tan: tangent of half the fan's angle. floor: the height of what it lands on when
//   there is no car. segments: how finely the landing line follows the profile; a ray is
//   drawn at every fourth of them.
export function scanFan(kit: Kit, o: { apex: number; z: number; tan: number; floor: number; segments: number }): ScanFan {
  const { apex, z, tan } = o
  const n = o.segments
  const every = 4
  const rays = Math.floor(n / every) + 1
  // Corners, in order: the head, then five rows of n + 1 along where the light lands
  // (the glow's lower edge; the bright line and where it fades out above; the two edges
  // of the flat strip), then the rays and the sweeping ray (a ribbon each, in the fan's
  // own plane) and the spot where the sweeping ray lands. Nothing of it stands across the
  // lane: the ride camera passes right under the head, and a ribbon facing it there fills
  // the middle of the picture.
  const rim = 1
  const line = rim + n + 1
  const fade = line + n + 1
  const lay0 = fade + n + 1
  const lay1 = lay0 + n + 1
  const fixedRays = lay1 + n + 1
  const ray = fixedRays + rays * 4
  const spot = ray + 4
  const count = spot + 4
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 4).fill(1)
  const idx: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d)
  // The glow under the head: its lower edge is only a third of the way down.
  col[3] = 0.1
  for (let k = 0; k <= n; k++) {
    col[(rim + k) * 4 + 3] = 0
    col[(line + k) * 4 + 3] = 0.9
    col[(fade + k) * 4 + 3] = 0
    col[(lay0 + k) * 4 + 3] = 0.7
    col[(lay1 + k) * 4 + 3] = 0.7
    if (k === n) break
    idx.push(0, rim + k, rim + k + 1)
    quad(line + k, line + k + 1, fade + k + 1, fade + k)
    quad(lay0 + k, lay0 + k + 1, lay1 + k + 1, lay1 + k)
  }
  // Each ray: brighter at the head, fainter where it lands.
  for (let r = 0; r < rays; r++) {
    const at = fixedRays + r * 4
    col[at * 4 + 3] = col[(at + 1) * 4 + 3] = 0.42
    col[(at + 2) * 4 + 3] = col[(at + 3) * 4 + 3] = 0.16
    quad(at, at + 1, at + 3, at + 2)
  }
  for (let k = 0; k < 4; k++) col[(ray + k) * 4 + 3] = 0.75
  quad(ray, ray + 1, ray + 3, ray + 2)
  quad(spot, spot + 1, spot + 2, spot + 3)

  const geo = new BufferGeometry()
  const position = new BufferAttribute(pos, 3)
  position.setUsage(DynamicDrawUsage)
  geo.setAttribute('position', position)
  geo.setAttribute('color', new BufferAttribute(col, 4))
  geo.setIndex(idx)
  // The corners move every frame: the bounds are the most the fan can ever cover.
  geo.boundingSphere = new Sphere(new Vector3(0, apex / 2, z), Math.hypot(apex / 2, apex * tan) + 1)

  const light = glow(kit, 'green', true)
  const mesh = new Mesh(geo, light.material)
  mesh.name = 'scan-fan'
  mesh.userData.fx = true
  mesh.visible = false

  const reach = apex - o.floor - FAN_LIFT
  // Nothing of the car is higher than its roof: the search for it starts there.
  const start = Math.max(0, apex - CAR.height - 0.2)
  // How far below the head a beam leaning by slope (feet along the tunnel per foot of
  // drop) lands: on the car if it is in the way, else on the floor. It steps down the
  // beam to the first step inside the car's outline, then closes in on the surface.
  const land = (slope: number, carDx: number | null): number => {
    if (carDx == null || start >= reach) return reach
    let above = start
    for (let i = 1; i <= FAN_STEPS; i++) {
      const d = start + ((reach - start) * i) / FAN_STEPS
      if (carHeightAt(d * slope - carDx) < apex - d) {
        above = d
        continue
      }
      let inside = d
      for (let j = 0; j < 5; j++) {
        const mid = (above + inside) / 2
        if (carHeightAt(mid * slope - carDx) < apex - mid) above = mid
        else inside = mid
      }
      return above - FAN_LIFT
    }
    return reach
  }
  const set = (i: number, x: number, y: number, zz: number) => {
    pos[i * 3] = x
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = zz
  }
  // A ray from the head to (x, y): a ribbon half a width w wide, square to the ray.
  const beam = (at: number, x: number, y: number, slope: number, w: number) => {
    const across = w / Math.sqrt(1 + slope * slope)
    set(at, -across, apex - across * slope, z)
    set(at + 1, across, apex + across * slope, z)
    set(at + 2, x - across, y - across * slope, z)
    set(at + 3, x + across, y + across * slope, z)
  }

  return {
    mesh,
    update(carDx, t, strength) {
      mesh.visible = strength > 0.01
      if (!mesh.visible) return
      light.sync()
      light.material.opacity = strength
      // The car is nowhere under the fan: every beam reaches the floor.
      const near = carDx != null && Math.abs(carDx) < CAR.length / 2 + apex * tan ? carDx : null
      set(0, 0, apex, z)
      for (let k = 0; k <= n; k++) {
        const slope = tan * ((2 * k) / n - 1)
        const d = land(slope, near)
        const x = d * slope
        const y = apex - d
        set(rim + k, x / 3, apex - d / 3, z)
        set(line + k, x, y, z)
        // The line fades out over an inch or two back up the beam.
        const up = Math.min(0.5, LINE_FADE / (d * Math.sqrt(1 + slope * slope)))
        set(fade + k, x * (1 - up), y + d * up, z)
        set(lay0 + k, x, y, z - LAY_W)
        set(lay1 + k, x, y, z + LAY_W)
        if (k % every === 0) beam(fixedRays + (k / every) * 4, x, y, slope, RAY_W)
      }
      const slope = tan * 0.9 * Math.sin(t * 2.4)
      const d = land(slope, near)
      const x = d * slope
      const y = apex - d
      beam(ray, x, y, slope, RAY_W * 1.4)
      set(spot, x - 0.09, y + 0.01, z - 0.09)
      set(spot + 1, x + 0.09, y + 0.01, z - 0.09)
      set(spot + 2, x + 0.09, y + 0.01, z + 0.09)
      set(spot + 3, x - 0.09, y + 0.01, z + 0.09)
      position.needsUpdate = true
    },
    dispose() {
      light.material.dispose()
    },
  }
}

// ---- What hangs on a prep station ------------------------------------------------------

export type Wand = {
  root: Group
  // Where the hose goes on, in the wand's own space.
  inlet: V3
}

// A spray wand standing nozzle down, the way it sits in its holster. The origin is the
// nozzle's tip and the grip points toward +Z. hp: a trigger gun on an insulated steel
// lance (the high pressure prep gun). Otherwise a low pressure chemical wand: a poly
// lance with a lever valve and a flat fan tip.
export function wand(kit: Kit, o: { lance: number; hp: boolean }): Wand {
  const m = kit.mat
  const g = new Group()
  const len = o.lance
  if (o.hp) {
    g.add(kit.paint(bar(kit, [0, 0, 0], [0, 0.12, 0], 0.034, m.frame), 'brass'))
    g.add(bar(kit, [0, 0.11, 0], [0, len, 0], 0.026, m.stainless))
    g.add(kit.paint(bar(kit, [0, len - 0.78, 0], [0, len - 0.06, 0], 0.05, m.frame), 'black'))
    g.add(put(kit.paint(sheet(0.11, 0.32, 0.14, m.frame), 'black'), 0, len + 0.15, 0))
    g.add(kit.paint(strut(kit, [0, len + 0.2, 0.03], [0, len + 0.34, 0.4], [0.1, 0.12], m.frame, 0.03), 'black'))
    g.add(kit.paint(bar(kit, [0, len + 0.07, 0.08], [0, len + 0.2, 0.3], 0.018, m.frame), 'red'))
    g.add(kit.paint(bar(kit, [0, len + 0.33, 0.37], [0, len + 0.37, 0.48], 0.035, m.frame), 'brass'))
    return { root: g, inlet: [0, len + 0.37, 0.48] }
  }
  g.add(put(kit.paint(sheet(0.13, 0.07, 0.04, m.frame), 'yellow'), 0, 0.035, 0))
  g.add(kit.paint(bar(kit, [0, 0.06, 0], [0, len, 0], 0.028, m.frame), 'hoseWhite'))
  g.add(kit.paint(bar(kit, [0, len - 0.55, 0], [0, len - 0.05, 0], 0.046, m.frame), 'black'))
  g.add(kit.paint(bar(kit, [0, len - 0.02, 0], [0, len + 0.14, 0], 0.052, m.frame), 'brass'))
  g.add(kit.paint(strut(kit, [0, len + 0.08, 0.04], [0, len - 0.2, 0.2], [0.035, 0.05], m.frame, 0.01), 'green'))
  return { root: g, inlet: [0, len + 0.14, 0] }
}

// A hose coiled on a hook: a helix around the given axis, centered on the origin.
export function coil(kit: Kit, o: { r: number; turns: number; pitch: number; hose: number; axis: 'x' | 'z'; material: Material }): Mesh {
  const per = kit.detail === 'high' ? 11 : 7
  const n = Math.round(o.turns * per)
  const pts: V3[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / per) * Math.PI * 2
    const along = (i / n - 0.5) * o.turns * o.pitch
    const u = o.r * Math.sin(a)
    const v = o.r * Math.cos(a)
    pts.push(o.axis === 'x' ? [along, v, u] : [u, v, along])
  }
  return kit.tube(pts, o.hose, o.material, { radial: 5 })
}

// A pressure gauge facing +Z, its dial centered on `at`: the case, the white face and
// the stem it screws on by go into `fixed`; the needle comes back on its own, turning
// about its pivot, for the model to move (rotation.z, see gaugeAngle).
export function gauge(kit: Kit, fixed: Group, at: V3, r: number): Mesh {
  const m = kit.mat
  const face = (mesh: Mesh, z: number) => {
    mesh.rotation.x = Math.PI / 2
    return put(mesh, at[0], at[1], at[2] + z)
  }
  const radial = kit.detail === 'high' ? 12 : 8
  fixed.add(face(kit.paint(kit.cyl(r, 0.09, m.frame, { radial, bevel: 0.015 }), 'black'), 0.045))
  fixed.add(face(kit.paint(kit.cyl(r * 0.86, 0.012, m.frame, { radial, bevel: 0 }), 'white'), 0.088))
  fixed.add(face(kit.paint(kit.cyl(r * 0.13, 0.03, m.frame, { radial: 6 }), 'black'), 0.098))
  fixed.add(kit.paint(bar(kit, [at[0], at[1] - r - 0.12, at[2] + 0.045], [at[0], at[1] - r + 0.02, at[2] + 0.045], 0.035, m.frame), 'brass'))
  const needle = kit.paint(sheet(r * 0.1, r * 0.8, 0.008, m.frame), 'red')
  needle.geometry.translate(0, r * 0.27, 0)
  needle.castShadow = false
  return put(needle, at[0], at[1], at[2] + 0.102)
}

// Where a gauge's needle points for a reading of 0 to 1: three quarters of a turn, from
// lower left round over the top to lower right, as on a real dial.
export function gaugeAngle(reading: number): number {
  return (0.75 - 1.5 * Math.min(1, Math.max(0, reading))) * Math.PI
}
