import { BoxGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three'
import type { Object3D } from 'three'
import { CAR } from '../car'
import type { AirCylinder, Kit, Paint, SprayOpts, V3 } from '../kit'
import { spanBetween } from '../kit/geometry'
import type { ModelInput } from '../types'

// What the spray arches, the blaster, the tire shine and the dryers share: where a
// frame's legs may stand, which way a machine beside the tunnel faces, and the small
// parts (nozzles, clamps, ties, light members, a slim air cylinder) that are too many
// and too small to spend a beveled shape on.
// Everything here is painted from the sign atlas, so a machine's fittings, hoses, steel
// and name plate are one draw call between them.

export type Nozzle = SprayOpts['nozzles'][number]

export type Span = {
  // The two legs' centers across the tunnel, in the model's own z: lo is the one nearer
  // the driver's side, hi the one nearer the passenger side.
  lo: number
  hi: number
  // The car's centerline in the model's own z.
  carZ: number
  // True when the frame stands over the car. False: it stands beside it.
  over: boolean
}

// Where a frame's two legs stand. They follow the footprint (foot is how far a leg's
// center sits in from its edge), except that a leg never stands where the car drives:
// a footprint drawn too narrow, or off to one side, still gives a frame the car clears
// by `clearance` feet from its centerline.
export function legSpan(input: Pick<ModelInput, 'h' | 'y' | 'side'>, foot: number, clearance: number): Span {
  const half = Math.max(0.6, input.h / 2 - foot)
  // Beside the tunnel there is no car to stand clear of: it stands as it is drawn.
  if (input.side === 'outside') return { lo: -half, hi: half, carZ: 0, over: true }
  let lo = input.y - half
  let hi = input.y + half
  // Over the car: the footprint reaches across its centerline, or is centered under it.
  const over = (input.y - input.h / 2 < CAR.z && input.y + input.h / 2 > CAR.z) || Math.abs(input.y - CAR.z) < CAR.width / 2
  if (over) {
    lo = Math.min(lo, CAR.z - clearance)
    hi = Math.max(hi, CAR.z + clearance)
  } else if (input.y >= CAR.z) {
    lo = Math.max(lo, CAR.z + clearance)
    hi = Math.max(hi, lo + 1.6)
  } else {
    hi = Math.min(hi, CAR.z - clearance)
    lo = Math.min(lo, hi - 1.6)
  }
  return { lo: lo - input.y, hi: hi - input.y, carZ: CAR.z - input.y, over }
}

// Beside the tunnel, which of the model's own sides is away from the tunnel: +1 its +z.
// The scene turns the shape clockwise by its rotation, so turned half round the sides
// swap; turned a quarter, both face along the tunnel and it keeps the unturned answer.
// It reads only which side y is on, as the scene's rebuild key does.
export const awayFromTunnel = (y: number, rotation: number): 1 | -1 => ((y >= 0) === (Math.cos((rotation * Math.PI) / 180) > -0.5) ? 1 : -1)

// Paints every mesh of a kit assembly (a base plate, a bearing, an air cylinder) from
// the atlas, so it joins the model's painted parts instead of bringing its own material.
export function paintAll<T extends Object3D>(kit: Kit, o: T, color: Paint): T {
  o.traverse((c) => {
    const mesh = c as Mesh
    if (mesh.isMesh) kit.paint(mesh, color)
  })
  return o
}

const UP = new Vector3(0, 1, 0)
const _dir = new Vector3()
const _aim = new Vector3()

const solid = (mesh: Mesh): Mesh => {
  // The same shadow flags as the kit's shapes, so they merge into one mesh with them.
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// A plain painted cylinder from a to b. For fittings a couple of inches across, where a
// chamfer could never be seen: a fifth of the triangles of kit.rod. open leaves the ends
// off, for one whose ends are buried in something else (half its triangles).
export function stub(kit: Kit, a: V3, b: V3, r: number, color: Paint, sides = 6, open = false): Mesh {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = Math.max(1e-4, _dir.length())
  const mesh = solid(new Mesh(kit.swatch(new CylinderGeometry(r, r, len, sides, 1, open), color), kit.mat.sign))
  mesh.quaternion.setFromUnitVectors(UP, _dir.divideScalar(len))
  mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
  return mesh
}

// A square-edged painted box: a member too small, or seen from too far, for kit.box's
// eased edges to show (12 triangles instead of 108).
export function block(kit: Kit, w: number, h: number, d: number, color: Paint): Mesh {
  return solid(new Mesh(kit.swatch(new BoxGeometry(w, h, d), color), kit.mat.sign))
}

// The same as a member from a to b, size across by deep, laid the way kit.beam lays one.
export function strut(kit: Kit, a: V3, b: V3, size: readonly [number, number], color: Paint): Mesh {
  const mesh = block(kit, size[0], 1, size[1], color)
  mesh.scale.y = spanBetween(mesh, a[0], a[1], a[2], b[0], b[1], b[2])
  return mesh
}

// A slim air cylinder made of painted stubs, for linkages that are small on screen: the
// kit's has eased end caps and costs ten times the triangles. Same use as kit.airCylinder:
// the barrel's base pin is root's origin and it points along its own +Y; aim() swings it
// from one pin to the other and slides the rod out to reach.
export function lightCylinder(kit: Kit, o: { body: number; stroke: number; bore: number; color: Paint; rodColor: Paint }): AirCylinder {
  const root = new Group()
  const cap = o.bore * 1.3
  root.add(stub(kit, [0, 0, 0], [0, 0.08, 0], cap, o.color, 6))
  root.add(stub(kit, [0, 0.06, 0], [0, 0.06 + o.body, 0], o.bore, o.color, 8, true))
  root.add(stub(kit, [0, o.body, 0], [0, o.body + 0.1, 0], cap, o.color, 6))
  const rod = new Group()
  const rodLen = o.stroke + o.body * 0.5
  rod.add(stub(kit, [0, -rodLen, 0], [0, 0, 0], o.bore * 0.36, o.rodColor, 5, true))
  rod.add(stub(kit, [0, -0.07, 0], [0, 0.03, 0], o.bore * 0.7, o.rodColor, 5))
  root.add(rod)
  const closed = o.body + 0.14
  return {
    root,
    rod,
    aim(ax, ay, az, bx, by, bz) {
      _aim.set(bx - ax, by - ay, bz - az)
      const len = _aim.length()
      if (len > 1e-6) root.quaternion.setFromUnitVectors(UP, _aim.divideScalar(len))
      root.position.set(ax, ay, az)
      // Never drawn shorter than the barrel or longer than the rod.
      rod.position.y = Math.min(closed + o.stroke, Math.max(closed, len))
    },
  }
}

// A plain painted block centered on x, y, z: zip ties, clamps, lugs.
export function chip(kit: Kit, w: number, h: number, d: number, color: Paint, x = 0, y = 0, z = 0): Mesh {
  const mesh = solid(new Mesh(kit.swatch(new BoxGeometry(w, h, d), color), kit.mat.sign))
  mesh.position.set(x, y, z)
  return mesh
}

export type NozzleLook = {
  // How far the pipe's surface is from its centerline.
  pipe: number
  // The threaded body, then the tip that sets the pattern.
  stem?: Paint
  cap: Paint
  // A fatter, longer body: a rotating high pressure nozzle.
  turbo?: boolean
  low?: boolean
}

// One nozzle screwed into a pipe: `at` is a point on the pipe's centerline and nx, ny, nz
// the way it points (unit length). Returns where the water leaves it.
export function nozzle(kit: Kit, into: Object3D, at: V3, nx: number, ny: number, nz: number, look: NozzleLook): V3 {
  const p = (d: number): V3 => [at[0] + nx * d, at[1] + ny * d, at[2] + nz * d]
  const r0 = look.pipe
  // Each piece's buried end needs no face: the stem's in the pipe, the body's in the tip.
  if (look.turbo) {
    if (!look.low) into.add(stub(kit, p(r0 - 0.01), p(r0 + 0.12), 0.03, look.stem ?? 'brass', 5, true))
    into.add(stub(kit, p(r0 + (look.low ? -0.01 : 0.1)), p(r0 + 0.34), 0.06, 'body', look.low ? 6 : 8, true))
    into.add(stub(kit, p(r0 + 0.3), p(r0 + 0.4), 0.068, look.cap, look.low ? 6 : 8))
    return p(r0 + 0.42)
  }
  if (!look.low) into.add(stub(kit, p(r0 - 0.01), p(r0 + 0.1), 0.028, look.stem ?? 'brass', 5, true))
  into.add(stub(kit, p(r0 + (look.low ? -0.01 : 0.08)), p(r0 + 0.16), 0.042, look.cap, look.low ? 5 : 6, look.low))
  return p(r0 + 0.18)
}

// The machine's name on a plate that reads from both ends of the tunnel: two plates
// back to back, `gap` apart (so they can clamp either side of a pipe or a beam), centered
// on x = 0 at height y.
export function namePlates(kit: Kit, into: Object3D, text: string, len: number, tall: number, y: number, z: number, gap: number, backing = true): void {
  for (const dir of [-1, 1]) {
    if (backing) into.add(chip(kit, 0.03, tall + 0.07, len + 0.1, 'dark', dir * (gap / 2 + 0.015), y, z))
    const plate = kit.sign(text, len, tall)
    // A clear half inch off what it is fixed to, or the two flicker from far away.
    plate.position.set(dir * (gap / 2 + (backing ? 0.042 : 0.012)), y, z)
    plate.rotation.y = (dir * Math.PI) / 2
    into.add(plate)
  }
}

// A name plate's length for a label, between two limits.
export function plateLength(text: string, min: number, max: number): number {
  return Math.min(max, Math.max(min, text.length * 0.27 + 0.5))
}

// Scene time is the only clock a model has. A label's letters make a number that differs
// from one machine to the next, so twin arches don't spray in step.
export function seedOf(text: string): number {
  let n = 7
  for (let k = 0; k < text.length; k++) n = (n * 31 + text.charCodeAt(k)) % 9973
  return n + 1
}
