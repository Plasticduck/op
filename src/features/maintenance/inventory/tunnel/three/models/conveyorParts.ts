import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Material, Object3D } from 'three'
import { CAR } from '../car'
import { COLORS } from '../kit'
import type { AirCylinder, Kit, Paint } from '../kit'
import { spanBetween } from '../kit/geometry'

// What the conveyor and the two roller assemblies at its ends agree on: the track's cross
// section, where the trap doors are, and where a pusher roller rides behind each of the
// car's tires. The three are separate shapes in the drawing, so each model works these
// out for itself from the same numbers here and they line up when the shapes do.

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const smooth = (v: number) => {
  const c = clamp(v, 0, 1)
  return c * c * (3 - 2 * c)
}

// The track, in feet from its own centerline. Real proportions (a 13 in tire slot between
// two low guide rails), whatever the footprint's width.
export const TRACK = {
  // Top of the steel deck the tire rides on.
  deck: 0.045,
  // Inner face of each guide rail, and the rail's width and height.
  rail: 0.55,
  railWide: 0.13,
  railTop: 0.27,
  // Half the width of the slot the chain runs in.
  slot: 0.065,
  // Half the track's whole width, yellow edges included.
  half: 0.8,
} as const

// A trap door: its length along the track and its width across it.
export const DOOR = { len: 0.8, wide: 0.92 } as const
// How far a pusher sinks below the deck, and over which stretch (measured from a door's
// upstream edge to the pusher's axle) it comes up at the entrance and goes down at the
// exit. It surfaces late, at the door's far end, because the tire it follows is still
// standing on the near end.
export const PUSHER = { r: 0.15, depth: 0.34, riseFrom: 0.5, riseTo: 1.0, diveFrom: 0.15, diveTo: 0.75 } as const
// A pusher touches the back of its tire: this far behind the wheel's center.
export const BEHIND = 2 * Math.sqrt(CAR.wheelRadius * PUSHER.r)
// Where the two pushers ride, measured from the car's center: behind the front tire and
// behind the rear one.
export const PUSHERS = [CAR.wheelbase / 2 - BEHIND, -CAR.wheelbase / 2 - BEHIND] as const
// Pushers hang from the chain this far apart. Half a wheelbase, so both of a car's
// pushers sit on one.
export const PUSHER_PITCH = CAR.wheelbase / 2

// From each end of a conveyor to the middle of its trap door.
export function doorInset(length: number): number {
  return Math.min(3, length * 0.3)
}

// Which way is away from the car, across the tunnel: -1 toward the driver's side wall.
// Anything that stands up beside the track goes on that side.
export function outboard(y: number): 1 | -1 {
  return y > CAR.z ? 1 : -1
}

// The least distance from the track's centerline, on the outboard side, at which
// something tall stands clear of the car's body as it passes.
export function clearOfCar(y: number, margin = 0.3): number {
  return Math.max(0, CAR.width / 2 + margin - Math.abs(y - CAR.z))
}

export function put<T extends Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z)
  return o
}

// Small parts with plain square edges, a tenth the triangles of the kit's beveled shapes:
// for joints, slots, bolt heads and pipes too small for a bevel to show. They carry the
// same shadow flags as the kit's shapes, so they merge with them.
function plain(geo: BoxGeometry | CylinderGeometry, material: Material): Mesh {
  const mesh = new Mesh(geo, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// A plain box in a flat color from the sign atlas.
export function chip(kit: Kit, w: number, h: number, d: number, color: Paint): Mesh {
  return plain(kit.swatch(new BoxGeometry(w, h, d), color), kit.mat.sign)
}

// On the phone tier bare steel is painted from the atlas as well, so it shares the sign
// material's draw call (and its shadow's): the reflection it buys is a few pixels there.
// Call on a group before merging it.
export function flatSteel<T extends Object3D>(kit: Kit, group: T): T {
  if (kit.detail !== 'low') return group
  const { stainless, galvanized } = kit.mat
  group.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    if (mesh.material === stainless) kit.paint(mesh, COLORS.stainless)
    else if (mesh.material === galvanized) kit.paint(mesh, COLORS.galvanized)
  })
  return group
}

// A plain upright bar in a flat color, centered: a post, a stem, a button.
export function peg(kit: Kit, r: number, len: number, color: Paint, radial = 6): Mesh {
  return plain(kit.swatch(new CylinderGeometry(r, r, len, radial), color), kit.mat.sign)
}

// A plain box in one of the kit's materials.
export function block(w: number, h: number, d: number, material: Material): Mesh {
  return plain(new BoxGeometry(w, h, d), material)
}

// A plain round bar along X. open leaves off the end caps, for bars whose ends sit in
// something.
export function pipe(r: number, len: number, material: Material, radial = 8, open = false): Mesh {
  const geo = new CylinderGeometry(r, r, len, radial, 1, open)
  geo.rotateZ(Math.PI / 2)
  return plain(geo, material)
}

// An air cylinder like kit.airCylinder (same pins, same aim) at an eighth of the
// triangles: square-edged caps and an open barrel whose ends hide in them. The roller-up
// has two of these under a cover plate, a few inches tall.
export function ram(o: { body: number; stroke: number; bore: number; mat: Material }): AirCylinder {
  const { bore, mat } = o
  const cap = bore * 2.5
  const root = new Group()
  const bar = (r: number, len: number, y: number, radial: number) => {
    const geo = new CylinderGeometry(r, r, len, radial, 1, true)
    return put(plain(geo, mat), 0, y, 0)
  }
  root.add(put(block(cap * 0.55, 0.16, cap * 0.4, mat), 0, 0.04, 0))
  root.add(put(block(cap, 0.1, cap, mat), 0, 0.16, 0))
  root.add(bar(bore, o.body, 0.2 + o.body / 2, 10))
  root.add(put(block(cap, 0.1, cap, mat), 0, 0.24 + o.body, 0))
  const rod = new Group()
  const rodLen = o.stroke + 0.3
  rod.add(bar(bore * 0.36, rodLen, -rodLen / 2 - 0.08, 6))
  rod.add(put(block(bore * 1.1, 0.2, bore * 0.9, mat), 0, -0.04, 0))
  root.add(rod)
  const closed = 0.3 + o.body + 0.16
  return {
    root,
    rod,
    aim(ax, ay, az, bx, by, bz) {
      const len = spanBetween(root, ax, ay, az, bx, by, bz)
      root.position.set(ax, ay, az)
      rod.position.y = Math.min(closed + o.stroke, Math.max(closed, len))
    },
  }
}

// A hex bolt head in a flat color, standing on y = 0 of wherever it is put.
export function boltHead(kit: Kit, color: Paint = 'mid', r = 0.03): Mesh {
  const geo = new CylinderGeometry(r, r, 0.02, 6)
  geo.translate(0, 0.01, 0)
  return plain(kit.swatch(geo, color), kit.mat.sign)
}

// The chain as a picture: one stretch from pusher to pusher, repeated along the slot and
// slid along it by the model. A strip of texture, not three hundred links, because the
// slot is an inch and a half wide and a hundred and forty feet long.
export function chainTexture(links: number): CanvasTexture {
  const W = 512
  const H = 32
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!
  g.fillStyle = '#0b0d10'
  g.fillRect(0, 0, W, H)
  const pitch = W / links
  const bar = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color
    g.beginPath()
    g.roundRect(x, y, w, h, h / 2)
    g.fill()
  }
  for (let k = 0; k < links; k++) {
    const x = k * pitch
    if (k === 0) {
      // The link a pusher hangs from: a solid block with its pin.
      bar(x + 3, 3, pitch - 6, H - 6, '#b9a04a')
      g.fillStyle = '#2a2e35'
      g.beginPath()
      g.arc(x + pitch / 2, H / 2, 5, 0, Math.PI * 2)
      g.fill()
      continue
    }
    if (k % 2) {
      bar(x - 5, 3, pitch + 10, 7, '#6c737d')
      bar(x - 5, H - 10, pitch + 10, 7, '#6c737d')
    } else {
      bar(x - 4, 9, pitch + 8, 14, '#454b54')
    }
    g.fillStyle = '#a3aab3'
    g.beginPath()
    g.arc(x, H / 2, 3.5, 0, Math.PI * 2)
    g.fill()
  }
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  t.wrapS = RepeatWrapping
  return t
}

// A pusher: the roller assembly that comes up behind a tire. Four UHMW wheels on one
// axle, either side of the link that carries it down through the slot. Its axle is the
// group's origin, lying across the track.
export function pusher(kit: Kit): Group {
  const m = kit.mat
  const g = new Group()
  const wheel = (z: number, wide: number) => {
    const w = kit.paint(kit.cyl(PUSHER.r, wide, m.frame, { bevel: 0.03, radial: kit.detail === 'high' ? 10 : 7 }), '#e7e4da')
    w.rotation.x = Math.PI / 2
    w.position.z = z
    g.add(w)
  }
  wheel(-0.38, 0.2)
  wheel(-0.17, 0.14)
  wheel(0.17, 0.14)
  wheel(0.38, 0.2)
  const axle = kit.swatch(new CylinderGeometry(0.04, 0.04, 1, 6, 1, true), 'dark')
  axle.rotateX(Math.PI / 2)
  g.add(plain(axle, m.sign))
  g.add(put(chip(kit, 0.36, 0.2, 0.09, 'dark'), 0, -0.07, 0))
  return g
}

// A pilot light: kit.lamp's lens, but the dark one is painted into the model's fixed
// parts and only the lit one stands apart, so the light costs a draw call only while it
// is on. Show and hide the group it returns. turnX tips the lens (it points up +Y) about X.
export function pilotLamp(kit: Kit, fixed: Group, r: number, at: readonly [number, number, number], turnX: number): Group {
  const lens = (k: number) => {
    const mesh = kit.cyl(r * k, r * 1.2 * k, kit.mat.lensGreen, { bevel: r * 0.45 * k, radial: kit.detail === 'high' ? 10 : 6 })
    mesh.geometry.translate(0, r * 0.6 * k, 0)
    mesh.rotation.x = turnX
    return put(mesh, at[0], at[1], at[2])
  }
  // A touch smaller, so the lit lens hides it completely.
  fixed.add(kit.paint(lens(0.9), COLORS.lensOff))
  const lit = new Group()
  lit.name = 'pilot'
  lit.userData.keep = true
  const on = lens(1)
  on.castShadow = false
  lit.add(on)
  lit.visible = false
  return lit
}

export type PitOpts = {
  // The footprint, and how much of its middle the track takes up.
  w: number
  h: number
  bolts: boolean
}

// The floor over a roller pit: removable steel cover plates either side of the track,
// inside a yellow frame. Flat enough to drive over, so the plates are plain boxes painted
// from the atlas (an eased edge an inch high shows from nowhere), and they share the sign
// material's draw call with the rest of the assembly.
export function pitCovers(kit: Kit, o: PitOpts): Group {
  const g = new Group()
  const inner = TRACK.half + 0.04
  const outer = Math.max(inner + 0.3, o.h / 2 - 0.09)
  const wide = outer - inner
  const x0 = -o.w / 2 + 0.09
  const x1 = o.w / 2 - 0.09
  const panels = Math.max(1, Math.round((x1 - x0) / 2))
  const len = (x1 - x0) / panels
  for (const s of [-1, 1]) {
    const zc = s * (inner + wide / 2)
    for (let k = 0; k < panels; k++) {
      const xc = x0 + (k + 0.5) * len
      g.add(put(chip(kit, len - 0.03, 0.05, wide, COLORS.galvanized), xc, 0.025, zc))
      // The slot a hook goes in to lift the plate.
      g.add(put(chip(kit, 0.26, 0.012, 0.05, 'black'), xc, 0.046, zc + s * (wide / 2 - 0.14)))
      if (o.bolts) {
        for (const bx of [-1, 1]) {
          for (const bz of [-1, 1]) {
            g.add(put(boltHead(kit, 'mid', 0.028), xc + bx * (len / 2 - 0.12), 0.05, zc + bz * (wide / 2 - 0.08)))
          }
        }
      }
    }
    // The frame: along the outside, and across each end as far as the track.
    g.add(put(chip(kit, o.w, 0.062, 0.08, 'yellow'), 0, 0.031, s * (outer + 0.045)))
    for (const x of [-o.w / 2 + 0.04, o.w / 2 - 0.04]) g.add(put(chip(kit, 0.08, 0.062, wide + 0.05, 'yellow'), x, 0.031, zc))
  }
  return g
}

export type TrapDoor = {
  // Turns about its upstream edge, which is the group's origin: rotation.z lifts the far end.
  flap: Group
  // The surround and the dark opening under the flap. Never moves.
  frame: Group
}

// A trap door in the track. The flap lies a hair above the conveyor's own deck, so it
// covers the plain plate the conveyor draws there.
export function trapDoor(kit: Kit): TrapDoor {
  const m = kit.mat
  const flap = new Group()
  flap.add(put(block(DOOR.len, 0.026, DOOR.wide, m.stainless), DOOR.len / 2, 0.013, 0))
  const barrel = pipe(0.024, DOOR.wide, m.stainless, 6, true)
  barrel.rotation.y = Math.PI / 2
  flap.add(put(barrel, 0, 0.012, 0))
  // Two stiffening ribs, which is what catches the light when it lifts.
  for (const z of [-0.26, 0.26]) flap.add(put(block(DOOR.len - 0.14, 0.012, 0.05, m.stainless), DOOR.len / 2 + 0.02, 0.03, z))
  flap.position.y = TRACK.deck + 0.007

  const frame = new Group()
  // What shows when the flap is up: the dark of the pit.
  frame.add(put(chip(kit, DOOR.len - 0.03, 0.004, DOOR.wide - 0.03, 'black'), DOOR.len / 2, TRACK.deck + 0.003, 0))
  return { flap, frame }
}
