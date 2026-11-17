import { BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { BELT, BELT_HALF, BELT_MID, BELT_PITCH } from '../../conveyorType'
import { CAR } from '../car'
import { COLORS } from '../kit'
import type { Kit } from '../kit'
import type { ModelBuilder } from '../types'
import { boltHead, chip, put } from './conveyorParts'

// The belt conveyor: a dual 30 inch modular plastic belt, the layout every maker of tunnel
// belts sells as standard (Tommy's Transporter, Sonny's FlowLine WB30, MINDA Glide XD, AVW
// Dual Belt). Two flat belts set flush in the floor, one under each side's tires, with a
// strip of fiberglass grating between them and a thin steel channel along every belt edge.
// The car is carried, not pushed: rows of short lugs cross the belts so it can't roll back.
// At each end the belt turns over a drum under a diamond plate whose edge is combed so the
// lugs dive through it; the drive is a gearmotor in the pit at the exit, under a low cover
// between the belts. There are no rollers, no guide rail and no correlator, and nothing
// stands up beside it.
//
// The belts always run under the car's wheels (CAR.z and the wheel spread in
// conveyorType.ts), wherever the shape is drawn across the tunnel, so the car always rides
// on them. The editor keeps a belt's shape on that line too (acrossLocked), so its status
// pad and the 2D drawing sit on the belts.
//
// Everything here is flush with the floor, a hair over the floor's paint, which is drawn
// pulled toward the camera and would show through. So the deck and the belts are drawn
// after the paint instead (see FLOOR_ORDER), not with a depth offset of their own: an
// offset would also swallow whatever other machines lay on this part of the floor (the
// truck bed sensor's target plate).

// The top of the belts and the deck: just under the car's contact shadow (kit/blobs.ts
// lays it at 0.014), so the shadow still falls on the belts. The tires stand at the
// floor's level and sink a hair into them.
const TOP = 0.012
// Between the floor's paint (-3) and the contact shadows (-2), with the status pads (-1)
// still to come: drawn in the see-through pass, at full opacity.
const FLOOR_ORDER = -2.5
// The diamond plate at each end, and the gap between it and the belt's end.
const PLATE = 1.25
const END_GAP = 0.08
// The drums the belt turns over, and how far along it a lug travels from the end of the
// belt until it has dived out of sight in its slot (a sixth of a turn).
const DRUM = 0.33
const DIVE = (DRUM * Math.PI) / 3
// A pusher lug, and how far a row's lugs spread across their belt (18 in). Rows alternate
// two inch and one inch lugs, as AVW builds them.
const LUG = { len: 0.07, wide: 0.18, tall: 0.167, short: 0.083 } as const
const LUG_SPREAD = 1.5
// The slots in the plates' edge that the lugs pass through.
const SLOT = { wide: 0.22, deep: 0.3 } as const
// The take-up cover at the entrance and the drive cover at the exit, along the tunnel.
const TAKEUP = 2.6
const DRIVE = { len: 3.0, wide: 1.5, tall: 0.21, back: 0.2 } as const

// AVW's standard colors: a blue belt with blue edging and yellow lugs, over a dark grating
// (one of their options) that keeps the blue belts readable.
const BELT_BLUE = '#2b5d9b'
const HINGE = '#1c4473'
const EDGING = '#3569a8'
const GRATE_BAR = '#4a5058'
const GRATE_HOLE = '#15181b'
const DIAMOND = '#aeb4ba'
// The flat colors on the deck's picture, one block each along its bottom quarter.
// The frame is kept close to the channel's tone: darker, it reads as a curb from low down.
const FLAT = { rail: '#b9c0c7', frame: '#a9b0b7', edge: '#7d858d', pit: '#101215', yellow: COLORS.yellow, joint: '#3a3f45' } as const
const FLATS = Object.keys(FLAT) as Array<keyof typeof FLAT>
// The grating's picture spans 14 cells across its strip (1.5 in molded grid) and 56 along
// the tunnel before it repeats.
const GRATE_CELLS = 14
const GRATE_REPEAT = (56 * (2 * BELT.grate)) / GRATE_CELLS

type UV = (x: number, z: number) => readonly [number, number]

// Flat quads facing up, gathered into one geometry: the deck is a few dozen of them.
function sheet() {
  const pos: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  return {
    add(xa: number, xb: number, za: number, zb: number, uv: UV) {
      if (xb - xa < 1e-4 || zb - za < 1e-4) return
      const k = pos.length / 3
      for (const [x, z] of [[xa, za], [xb, za], [xb, zb], [xa, zb]] as const) {
        pos.push(x, TOP, z)
        uvs.push(...uv(x, z))
      }
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2)
    },
    build(): BufferGeometry {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
      g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
      g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
      g.setIndex(idx)
      return g
    },
  }
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d')!)
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  t.wrapS = RepeatWrapping
  t.wrapT = ClampToEdgeWrapping
  return t
}

// One stretch of belt from a row of lugs to the next, repeated along the belts and slid
// by the model. Fourteen two inch modules on hinge pins, laid like bricks, with the row
// the lugs stand on a shade darker and centered on the picture's left edge, so u = 0 is
// where a row of lugs stands.
function beltTexture(w: number): CanvasTexture {
  const h = w / 2
  return canvasTexture(w, h, (g) => {
    g.fillStyle = BELT_BLUE
    g.fillRect(0, 0, w, h)
    const mods = 14
    const mw = w / mods
    g.fillStyle = '#24507f'
    g.fillRect(0, 0, mw / 2, h)
    g.fillRect(w - mw / 2, 0, mw / 2, h)
    const line = Math.max(1, w / 256)
    for (let k = 0; k < mods; k++) {
      const x = (k + 0.5) * mw
      // A hinge: the dark gap, and the next module's lit edge.
      g.fillStyle = HINGE
      g.fillRect(x - line, 0, line * 2, h)
      g.fillStyle = '#3d74b3'
      g.fillRect(x + line, 0, line, h)
      // Five modules across the belt, staggered half a module on every other row.
      g.fillStyle = HINGE
      const from = k * mw - mw / 2
      for (let j = 0; j <= 5; j++) {
        const y = ((j + (k % 2) * 0.5) * h) / 5
        g.fillRect(from, y - line / 2, mw, line)
        if (from < 0) g.fillRect(from + w, y - line / 2, mw, line)
      }
    }
    // The edging strip along both sides.
    const edge = Math.max(2, (0.04 / BELT.wide) * h)
    g.fillStyle = EDGING
    g.fillRect(0, 0, w, edge)
    g.fillRect(0, h - edge, w, edge)
  })
}

// The fixed deck's picture, in three bands: the grating at the top (repeating along the
// tunnel), the diamond plate under it (drawn once, the plates' whole width), and a row of
// flat colors along the bottom for the channels, the frame, the pit and the nosing.
function deckTexture(w: number): CanvasTexture {
  const h = w / 2
  return canvasTexture(w, h, (g) => {
    const gh = h / 2
    const cell = gh / GRATE_CELLS
    const bar = Math.max(1.5, cell * 0.25)
    g.fillStyle = GRATE_HOLE
    g.fillRect(0, 0, w, gh)
    for (let k = 0; k <= 56; k++) {
      g.fillStyle = GRATE_BAR
      g.fillRect(k * cell - bar / 2, 0, bar, gh)
    }
    for (let k = 0; k <= GRATE_CELLS; k++) {
      g.fillStyle = GRATE_BAR
      g.fillRect(0, k * cell - bar / 2, w, bar)
      // Light catches the near edge of each bar, so the grid reads as molded bars.
      g.fillStyle = '#5d646d'
      g.fillRect(0, k * cell - bar / 2, w, Math.max(1, bar / 3))
    }

    // Diamond plate: raised lozenges, each turned the other way from its neighbors.
    const top = gh
    const ph = h / 4
    g.fillStyle = DIAMOND
    g.fillRect(0, top, w, ph)
    const sx = w / (2 * BELT_HALF)
    const sy = ph / PLATE
    const step = 0.16
    const cols = Math.round((2 * BELT_HALF) / step)
    const rows = Math.round(PLATE / step)
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        g.save()
        g.translate((i + 0.5) * (w / cols), top + (j + 0.5) * (ph / rows))
        g.scale(sx, sy)
        g.rotate(((i + j) % 2 ? 1 : -1) * (Math.PI / 4))
        g.fillStyle = '#80878f'
        g.beginPath()
        g.roundRect(-0.055 + 0.008, -0.018 + 0.008, 0.11, 0.036, 0.018)
        g.fill()
        g.fillStyle = '#ccd1d6'
        g.beginPath()
        g.roundRect(-0.055, -0.018, 0.11, 0.036, 0.018)
        g.fill()
        g.restore()
      }
    }

    FLATS.forEach((name, k) => {
      g.fillStyle = FLAT[name]
      g.fillRect((k * w) / FLATS.length, top + ph, w / FLATS.length, h - top - ph)
    })
  })
}

// One row of lugs across both belts (lugZ: where they stand on one belt, out from the
// centerline), standing on y = 0, one foot tall: each instance scales it to its height.
function lugRow(kit: Kit, lugZ: readonly number[]): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (const s of [-1, 1]) {
    for (const z of lugZ) {
      const g = new BoxGeometry(LUG.len, 1, LUG.wide)
      g.translate(0, 0.5, 0)
      // Narrower at the top, as a molded lug is: the slope catches the light.
      const p = g.attributes.position as BufferAttribute
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0.5) {
          p.setX(i, p.getX(i) * 0.55)
          p.setZ(i, p.getZ(i) * 0.86)
        }
      }
      g.computeVertexNormals()
      g.translate(0, 0, s * z)
      parts.push(g)
    }
  }
  const row = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  return kit.swatch(row, 'yellow')
}

// kind 'conveyor' with props.conveyor_type 'belt'.
export const conveyorBelt: ModelBuilder = (input) => {
  const { kit } = input
  const m = kit.mat
  const high = input.detail === 'high'
  const length = Math.max(6, input.w)
  const x0 = -length / 2
  const x1 = length / 2
  // The car's centerline in this model's space. Beside the tunnel there is no car: the
  // conveyor keeps to its own footprint.
  const c = input.side === 'outside' ? 0 : CAR.z - input.y
  // From the centerline out: the grating, the inner channel, the belt's inner and outer
  // edges, the outer channel, the frame.
  const zRail = BELT.grate + BELT.rail
  const zBelt = zRail + BELT.gap
  const zBeltOut = zBelt + BELT.wide
  const zRailOut = zBeltOut + BELT.gap
  const zFrame = zRailOut + BELT.rail
  // Where the plates meet the deck, and where the belts start and end between them.
  const xa = x0 + PLATE
  const xb = x1 - PLATE
  const bx0 = xa + END_GAP
  const bx1 = xb - END_GAP
  const run = bx1 - bx0
  const covers = length >= 14
  const perBelt = high ? 5 : 3
  const lugZ = Array.from({ length: perBelt }, (_, k) => BELT_MID + (perBelt > 1 ? (k / (perBelt - 1) - 0.5) * (LUG_SPREAD - LUG.wide) : 0))

  // ---- The deck: everything flush that never moves ----
  // One mesh in a picture of its own: the grating repeats along the tunnel, the plates
  // show their diamond pattern, and the rest point at flat blocks (one uv per quad, so the
  // block is sampled at full size and never blurs into its neighbors).
  const deckPx = high ? 1024 : 512
  const deckTex = deckTexture(deckPx)
  const flat = (name: keyof typeof FLAT): UV => {
    const u = (FLATS.indexOf(name) + 0.5) / FLATS.length
    return () => [u, 0.125] as const
  }
  const deck = sheet()
  // The bands' uvs stay a hair inside them, so a neighbor never bleeds in at the edges.
  const grateUV: UV = (x, z) => [x / GRATE_REPEAT, 0.998 - 0.496 * ((z - c + BELT.grate) / (2 * BELT.grate))] as const
  const plateUV = (from: number): UV => (x, z) => [0.001 + 0.998 * ((z - c + BELT_HALF) / (2 * BELT_HALF)), 0.495 - 0.24 * (Math.abs(x - from) / PLATE)] as const
  // Along each side, from the centerline out. null is the belt itself.
  const strips: Array<[from: number, to: number, uv: UV | null, jointed?: true]> = [
    [BELT.grate, zRail, flat('rail'), true],
    [zRail, zBelt, flat('pit')],
    [zBelt, zBeltOut, null],
    [zBeltOut, zRailOut, flat('pit')],
    [zRailOut, zFrame, flat('rail'), true],
    [zFrame, BELT_HALF - 0.03, flat('frame')],
    [BELT_HALF - 0.03, BELT_HALF, flat('edge')],
  ]
  // The channels are bolted together from ten foot lengths, the first 3 ft 7 in long (the
  // take-up section): a dark joint across each.
  const joints: number[] = []
  if (high) for (let x = x0 + 3.6; x < xb - 1; x += 10) if (x > xa + 0.1) joints.push(x)
  for (const s of [-1, 1]) {
    const zs = (a: number, b: number): [number, number] => (s > 0 ? [c + a, c + b] : [c - b, c - a])
    for (const [from, to, uv, jointed] of strips) {
      const [za, zb] = zs(from, to)
      if (!uv) {
        // Under the belt: only the dark gaps between its ends and the plates.
        deck.add(xa, bx0, za, zb, flat('pit'))
        deck.add(bx1, xb, za, zb, flat('pit'))
        continue
      }
      let x = xa
      for (const j of jointed ? joints : []) {
        deck.add(x, j - 0.012, za, zb, uv)
        deck.add(j - 0.012, j + 0.012, za, zb, flat('joint'))
        x = j + 0.012
      }
      deck.add(x, xb, za, zb, uv)
    }
  }
  // The grating, from the take-up cover (or the entrance plate) to the exit plate. The
  // drive cover stands on it.
  const grateFrom = covers ? xa + TAKEUP : xa
  deck.add(grateFrom, xb, c - BELT.grate, c + BELT.grate, grateUV)

  // The plates: diamond plate full width, a yellow nosing where the concrete meets it, and
  // the comb on the belt side: a slot for each lug.
  const slots: Array<[number, number]> = []
  for (const s of [-1, 1]) for (const z of lugZ) slots.push([c + s * z - SLOT.wide / 2, c + s * z + SLOT.wide / 2])
  slots.sort((a, b) => a[0] - b[0])
  for (const [outer, edge, dir] of [[x0, xa, 1], [x1, xb, -1]] as const) {
    const uv = plateUV(outer)
    const nose = outer + dir * 0.06
    const comb = edge - dir * SLOT.deep
    const lo = (a: number, b: number) => Math.min(a, b)
    const hi = (a: number, b: number) => Math.max(a, b)
    deck.add(lo(outer, nose), hi(outer, nose), c - BELT_HALF, c + BELT_HALF, flat('yellow'))
    deck.add(lo(nose, comb), hi(nose, comb), c - BELT_HALF, c + BELT_HALF, uv)
    let z = c - BELT_HALF
    for (const [za, zb] of slots) {
      deck.add(lo(comb, edge), hi(comb, edge), z, za, uv)
      deck.add(lo(comb, edge), hi(comb, edge), za, zb, flat('pit'))
      z = zb
    }
    deck.add(lo(comb, edge), hi(comb, edge), z, c + BELT_HALF, uv)
  }
  const deckMat = new MeshStandardMaterial({ map: deckTex, roughness: 0.62, metalness: 0.2, transparent: true })
  deckMat.name = 'conveyor-belt-deck'
  const deckMesh = new Mesh(deck.build(), deckMat)
  deckMesh.name = 'belt-deck'
  deckMesh.receiveShadow = true
  deckMesh.renderOrder = FLOOR_ORDER

  // ---- The belts ----
  // Both belts in one mesh with one picture, which the model alone owns, so it may slide
  // it (the kit's shared materials are never touched).
  const beltTex = beltTexture(high ? 512 : 256)
  const belts = sheet()
  for (const s of [-1, 1]) {
    const za = s > 0 ? c + zBelt : c - zBeltOut
    belts.add(bx0, bx1, za, za + BELT.wide, (x, z) => [(x - bx0) / BELT_PITCH, (Math.abs(z - c) - zBelt) / BELT.wide] as const)
  }
  // Matte: any glossier and the far belt washes out pale where the camera looks along it.
  const beltMat = new MeshStandardMaterial({ map: beltTex, roughness: 0.75, metalness: 0, transparent: true })
  beltMat.name = 'conveyor-belt'
  const beltMesh = new Mesh(belts.build(), beltMat)
  beltMesh.name = 'belts'
  beltMesh.receiveShadow = true
  beltMesh.renderOrder = FLOOR_ORDER

  // ---- What stands up a little, painted from the sign atlas ----
  const fixed = new Group()
  if (covers) {
    // The take-up cover over the idler drum, where the maker's plate goes.
    const tx = xa + TAKEUP / 2
    fixed.add(put(chip(kit, TAKEUP, 0.03, 2 * BELT.grate + 0.02, COLORS.galvanized), tx, 0.015, c))
    if (high) for (const bx of [-1, 1]) for (const bz of [-1, 1]) fixed.add(put(boltHead(kit, 'mid', 0.026), tx + bx * (TAKEUP / 2 - 0.15), 0.03, c + bz * (BELT.grate - 0.12)))
    const plateLen = Math.min(1.8, TAKEUP - 0.6)
    const plate = kit.sign(input.item.label || 'Conveyor', plateLen, 0.3)
    plate.rotation.x = -Math.PI / 2
    fixed.add(put(plate, tx, 0.034, c))
    // The drive cover at the exit: two and a half inches tall, low enough for any car to
    // pass over, with the gearmotor in the pit under it.
    const dx = xb - DRIVE.back - DRIVE.len / 2
    fixed.add(put(kit.paint(kit.box(DRIVE.len, DRIVE.tall, DRIVE.wide, m.frame, 0.04), COLORS.galvanized), dx, DRIVE.tall / 2, c))
    if (high) for (const bx of [-1, 0, 1]) for (const bz of [-1, 1]) fixed.add(put(boltHead(kit, 'mid', 0.026), dx + bx * (DRIVE.len / 2 - 0.2), DRIVE.tall, c + bz * (DRIVE.wide / 2 - 0.15)))
  }

  // Where the status light stands: on a floor plate beside the conveyor near the entrance,
  // on the driver's side, where the car's body never reaches.
  const beacon = { x: x0 + Math.min(9, length * 0.15), y: 0.05, z: c - (BELT_HALF + 0.55) }
  fixed.add(put(kit.paint(kit.plate(0.56, 0.56, 0.05, m.frame, 0.09), 'pad'), beacon.x, 0, beacon.z))
  if (high) for (const bx of [-1, 1]) for (const bz of [-1, 1]) fixed.add(put(boltHead(kit), beacon.x + bx * 0.19, 0.05, beacon.z + bz * 0.19))

  // ---- The lugs ----
  // Every row is one instance of one row-shaped mesh. They ride an endless loop: along the
  // top between the plates, over the drum and out of sight at the exit, and back up over
  // the drum at the entrance. An even number of rows, so the tall and short ones alternate
  // all the way round.
  let rows = Math.ceil((run + 2 * DIVE) / BELT_PITCH) + 2
  rows += rows % 2
  const loop = rows * BELT_PITCH
  const lugs = new InstancedMesh(lugRow(kit, lugZ), m.sign, rows)
  lugs.name = 'belt-lugs'
  lugs.userData.keep = true
  lugs.instanceMatrix.setUsage(DynamicDrawUsage)
  lugs.castShadow = false
  lugs.receiveShadow = true
  // The count changes as rows dive and surface: bounds worked out once would be wrong.
  lugs.frustumCulled = false

  const root = new Group()
  root.name = 'conveyor-belt'
  root.add(kit.mergeStatic(fixed), deckMesh, beltMesh, lugs)
  kit.pickBox(root, length + 0.3, 0.4, BELT_HALF * 2 + 0.1, 0, 0.2, c)

  const mat = new Matrix4()
  const pose = (running: boolean, t: number, carDx: number | null) => {
    // The belts keep step with the car they carry, with both tires halfway between two
    // rows of lugs. With no car they simply run.
    const travel = carDx != null ? carDx + CAR.wheelbase / 2 + BELT_PITCH / 2 : running ? t * CAR.speed : 0
    const u = (travel - bx0) / BELT_PITCH
    beltTex.offset.x = Math.floor(u) - u
    let n = 0
    for (let k = 0; k < rows; k++) {
      // How far round the loop this row is, from where it surfaces at the entrance.
      let s = (travel + k * BELT_PITCH - (bx0 - DIVE)) % loop
      if (s < 0) s += loop
      let x: number
      let y = TOP
      let turn = 0
      if (s < DIVE) {
        turn = (DIVE - s) / DRUM
        x = bx0 - DRUM * Math.sin(turn)
        y = TOP - DRUM * (1 - Math.cos(turn))
      } else if (s <= DIVE + run) {
        x = bx0 + s - DIVE
      } else if (s < run + 2 * DIVE) {
        turn = -(s - DIVE - run) / DRUM
        x = bx1 - DRUM * Math.sin(turn)
        y = TOP - DRUM * (1 - Math.cos(turn))
      } else continue
      const h = k % 2 ? LUG.short : LUG.tall
      const cos = Math.cos(turn)
      const sin = Math.sin(turn)
      mat.set(cos, -sin * h, 0, x, sin, cos * h, 0, y, 0, 0, 1, c, 0, 0, 0, 1)
      lugs.setMatrixAt(n++, mat)
    }
    lugs.count = n
    lugs.instanceMatrix.needsUpdate = true
  }
  pose(false, 0, null)

  return {
    root,
    height: DRIVE.tall + 0.04,
    beacon,
    update: (st) => pose(st.running, st.t, st.carDx),
    dispose() {
      deckTex.dispose()
      deckMat.dispose()
      beltTex.dispose()
      beltMat.dispose()
      // Its per-row matrices live on the GPU apart from the geometry the scene frees.
      lugs.dispose()
    },
  }
}
