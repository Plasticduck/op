import { BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, NoColorSpace } from 'three'
import { COLORS } from '../kit'
import type { Kit, Paint } from '../kit'
import type { ModelBuilder, ModelInput } from '../types'
import { clamp, DIR, towardTunnel } from './backroomParts'
import type { Heading } from './backroomParts'

// The scenery beside the tunnel: rooms and lines of text painted on the floor. Never
// picked, lit or moved.

const CURB_W = 0.5
const CURB_H = 0.3
const POST_H = 3

// Floor lettering reads from where the default camera stands, off the passenger side:
// along the tunnel, its top toward the driver's side, whichever way its shape was turned
// (the 2D diagram keeps its names upright the same way). These map the world's own
// directions, about the shape's center, into the shape's space, which the scene turned.
function upright(input: ModelInput) {
  const th = input.side === 'outside' ? (input.rotation * Math.PI) / 180 : 0
  const c = Math.round(Math.cos(th))
  const s = Math.round(Math.sin(th))
  const at = (X: number, Z: number): readonly [number, number] => [X * c + Z * s, -X * s + Z * c]
  // The shape's footprint along the world's x and z.
  const W = s ? input.h : input.w
  const D = s ? input.w : input.h
  // Letters filling the world-aligned rectangle X0..X1, Z0..Z1, reading along +x, or
  // along +z (top toward +x) when `down`: from the overview that leans the right way.
  const letters = (paint: FloorPaint, X0: number, Z0: number, X1: number, Z1: number, down = false) => {
    const [ax, az] = at(X0, Z0)
    const [bx, bz] = at(X1, Z1)
    const [hx, hz] = down ? at(0, 1) : at(1, 0)
    const dir: Heading = hx > 0.5 ? '+x' : hx < -0.5 ? '-x' : hz > 0 ? '+z' : '-z'
    paint.letters(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), 'ink', dir)
  }
  return { W, D, letters }
}

// kind 'room': a named bay of floor (scenery). Open on top so nothing hides the machines
// in it: the same low curbs that mark the tunnel's walls run around it, with a yellow
// post at each corner and a doorway left open on the side that faces the tunnel. The
// floor inside wears a coat of sealer, the doorway a hatched keep-clear patch, and the
// room's name is lettered on the apron along the edge nearest the overview camera, the
// way zone names run along the tunnel.
export const room: ModelBuilder = (input) => {
  const { kit, w, h } = input
  const m = kit.mat
  const root = new Group()
  root.name = 'room'
  const parts = new Group()
  const paint = createFloorPaint(kit, input.item.label.trim() || 'Room')
  const [tx, tz] = towardTunnel(input)
  const hw = w / 2
  const hd = h / 2
  const inset = CURB_W / 2
  const low = kit.detail === 'low'
  const sides = low ? 8 : 10

  const ring = (r: number, len: number, color: Paint, y: number, x: number, z: number) => {
    const mesh = kit.paint(new Mesh(new CylinderGeometry(r, r, len, sides), m.sign), color)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.position.set(x, y, z)
    parts.add(mesh)
  }
  // One bollard: a yellow post with a black band, on a dark collar at the floor.
  const post = (x: number, z: number) => {
    if (low) ring(0.19, POST_H, 'yellow', POST_H / 2, x, z)
    else {
      const body = kit.paint(kit.cyl(0.19, POST_H, m.sign, { bevel: 0.07, radial: sides }), 'yellow')
      body.position.set(x, POST_H / 2, z)
      parts.add(body)
      ring(0.27, 0.12, 'dark', 0.06, x, z)
    }
    ring(0.196, 0.26, 'black', POST_H - 0.62, x, z)
  }
  // A run of curb from a to b along one edge (along x when alongX, else along z). Square
  // edged on a phone.
  const curb = (alongX: boolean, at: number, a: number, b: number, yellow = false) => {
    if (b - a < 0.05) return
    const [cw, cd] = alongX ? [b - a, CURB_W] : [CURB_W, b - a]
    const c = low ? new Mesh(new BoxGeometry(cw, CURB_H, cd), yellow ? m.sign : m.curb) : kit.box(cw, CURB_H, cd, yellow ? m.sign : m.curb, 0.06)
    c.castShadow = true
    c.receiveShadow = true
    if (yellow) kit.paint(c, 'yellow')
    c.position.set(alongX ? (a + b) / 2 : at, CURB_H / 2, alongX ? at : (a + b) / 2)
    parts.add(c)
  }

  // The four edges. The one facing the tunnel has the doorway: yellow curb ends either
  // side of the gap, a post at each, and yellow stripes across the threshold.
  for (const [alongX, sign] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
    const half = alongX ? hw : hd
    const at = sign * ((alongX ? hd : hw) - inset)
    // Curbs along z stop short of the corners, which the curbs along x fill.
    const end = alongX ? half : half - CURB_W
    const door = alongX ? tz === sign && tx === 0 : tx === sign && tz === 0
    if (!door) {
      curb(alongX, at, -end, end)
      continue
    }
    const gap = Math.min(clamp(half * 2 * 0.2, 3.5, 7), half) / 2
    const jamb = Math.min(1.2, (end - gap) / 2)
    for (const s of [-1, 1]) {
      curb(alongX, at, s < 0 ? -end : gap + jamb, s < 0 ? -gap - jamb : end)
      curb(alongX, at, s < 0 ? -gap - jamb : gap, s < 0 ? -gap : gap + jamb, true)
      if (alongX) post(s * (gap + 0.19), at)
      else post(at, s * (gap + 0.19))
    }
    const depth = CURB_W + 0.9
    const outer = sign * (alongX ? hd : hw)
    const inner = outer - sign * depth
    const stripe = 0.42
    const lean = depth * 0.6
    for (let u = -gap + 0.15; u + stripe + lean < gap - 0.1; u += stripe * 2.1) {
      if (alongX) paint.quad(u, outer, u + stripe, outer, u + stripe + lean, inner, u + lean, inner, 'yellow', 0.92)
      else paint.quad(outer, u, outer, u + stripe, inner, u + stripe + lean, inner, u + lean, 'yellow', 0.92)
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(sx * (hw - inset), sz * (hd - inset))

  // The sealed floor inside the curbs, and the name on the apron: at the left end of the
  // edge toward the passenger side of the drawing, within the 2.5 ft of slab the scene
  // leaves around a room.
  paint.rect(-hw + CURB_W, -hd + CURB_W, hw - CURB_W, hd - CURB_W, 'coat', 0.2)
  const u = upright(input)
  const cap = Math.min(2, (u.W - 0.8) / paint.aspect)
  const x0 = -u.W / 2 + 0.35
  u.letters(paint, x0, u.D / 2 + 0.2, x0 + cap * paint.aspect, u.D / 2 + 0.2 + cap)

  root.add(kit.mergeStatic(parts), paint.build())
  return { root, height: POST_H, update: paint.retheme, dispose: paint.dispose }
}

// kind 'label': a line of text painted flat on the floor (scenery), as large as its
// shape allows, reading from the passenger side whichever way the shape is turned. As in
// the 2D diagram, a long narrow shape runs its text along its length.
export const label: ModelBuilder = (input) => {
  const { kit } = input
  const root = new Group()
  root.name = 'label'
  const paint = createFloorPaint(kit, input.item.label.trim() || 'Text')
  const u = upright(input)
  const down = u.D > u.W * 2.2 && u.D > 6
  const along = down ? u.D : u.W
  const across = down ? u.W : u.D
  const cap = Math.max(0.2, Math.min(across * 0.86, (along * 0.96) / paint.aspect))
  const half = (cap * paint.aspect) / 2
  if (down) u.letters(paint, -cap / 2, -half, cap / 2, half, true)
  else u.letters(paint, -half, -cap / 2, half, cap / 2)
  root.add(paint.build())
  return { root, height: 0.05, update: paint.retheme, dispose: paint.dispose }
}

// ---- Paint on the floor ----------------------------------------------------------------
// A room's name, its boundary, a label someone typed: flat paint lying on the concrete,
// lettered like the tunnel's zone names (floor.ts) so it reads as the same paint job.
// Each piece of paint is one mesh with a small picture of its own for the lettering.
// The picture is only a mask (white letters on black): the color comes from the
// vertices, so the theme can change without repainting it.

type PaintTone = 'ink' | 'line' | 'yellow' | 'coat'

type FloorPaint = {
  // Width over height of the lettering.
  readonly aspect: number
  // A solid rectangle from x0 to x1 and z0 to z1.
  rect(x0: number, z0: number, x1: number, z1: number, tone: PaintTone, alpha?: number): void
  // A solid shape with four corners, given in order around it.
  quad(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number, tone: PaintTone, alpha?: number): void
  // The lettering, filling the rectangle and reading along `dir` (default +x), its top
  // to the left of the way it reads, seen from above.
  letters(x0: number, z0: number, x1: number, z1: number, tone: PaintTone, dir?: Heading): void
  // Call once everything is laid out.
  build(): Mesh
  // Recolors for the kit's theme, if it changed. Allocates nothing.
  retheme(): void
  dispose(): void
}

function createFloorPaint(kit: Kit, text: string): FloorPaint {
  const label = text.trim().replace(/\s+/g, ' ').toUpperCase() || ' '
  const px = kit.detail === 'high' ? 96 : 64
  const font = `800 ${px}px "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif`
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')!
  g.font = font
  g.letterSpacing = `${px * 0.08}px`
  const tw = Math.ceil(g.measureText(label).width + px * 0.3)
  const th = Math.ceil(px * 1.14)
  // A white block for solid paint, then the lettering under it.
  const blockH = 24
  canvas.width = Math.max(64, tw + 4)
  canvas.height = blockH + th + 6
  g.fillStyle = '#000'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 40, blockH - 4)
  g.font = font
  g.letterSpacing = `${px * 0.08}px`
  g.textBaseline = 'middle'
  g.textAlign = 'left'
  const ty = blockH + 2
  g.fillText(label, 2 + px * 0.15, ty + th * 0.54)
  // Worn paint: small flecks knocked out of the letters, the same on every load.
  let seed = 7 + label.length * 131
  const r = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let n = 0; n < (tw * th) / 700; n++) {
    g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.4})`
    const s = 1 + r() * 1.6
    g.fillRect(2 + r() * tw, ty + r() * th, s, s)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = NoColorSpace
  texture.anisotropy = 8
  const W = canvas.width
  const H = canvas.height
  const solid = { u0: 8 / W, u1: 30 / W, v0: 1 - 14 / H, v1: 1 - 4 / H }
  const cell = { u0: 2 / W, u1: (2 + tw) / W, v0: 1 - (ty + th) / H, v1: 1 - ty / H }

  const material = new MeshStandardMaterial({
    alphaMap: texture, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.78, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  material.name = 'room-paint'

  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const tones: Array<{ tone: PaintTone; alpha: number }> = []
  let colors: BufferAttribute | null = null
  let painted: string | null = null
  const c = new Color()

  const add = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number, at: typeof solid, tone: PaintTone, alpha: number) => {
    const base = pos.length / 3
    pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz, dx, 0, dz)
    uv.push(at.u0, at.v0, at.u1, at.v0, at.u1, at.v1, at.u0, at.v1)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    tones.push({ tone, alpha })
  }

  const retheme = () => {
    if (!colors || painted === kit.theme) return
    painted = kit.theme
    const p = kit.palette
    const dark = kit.theme === 'dark'
    for (let k = 0; k < tones.length; k++) {
      const t = tones[k]
      c.set(t.tone === 'ink' ? p.paintInk : t.tone === 'line' ? p.paint : t.tone === 'yellow' ? COLORS.yellow : dark ? '#2b3644' : '#5d6c82')
      for (let v = 0; v < 4; v++) colors.setXYZW(k * 4 + v, c.r, c.g, c.b, t.alpha)
    }
    colors.needsUpdate = true
  }

  return {
    aspect: tw / th,
    rect: (x0, z0, x1, z1, tone, alpha = 1) => add(x0, z1, x1, z1, x1, z0, x0, z0, solid, tone, alpha),
    quad(ax, az, bx, bz, cx, cz, dx, dz, tone, alpha = 1) {
      // Whichever way round the corners were given, the paint faces up.
      if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) add(ax, az, dx, dz, cx, cz, bx, bz, solid, tone, alpha)
      else add(ax, az, bx, bz, cx, cz, dx, dz, solid, tone, alpha)
    },
    letters(x0, z0, x1, z1, tone, dir = '+x') {
      // The corners in the order the picture's are (bottom left, bottom right, top right,
      // top left), found from the way the text reads and the way its top faces. Turning
      // the text keeps them going round the same way, so it still faces up.
      const [rx, rz] = DIR[dir]
      const corner = (along: number, up: number) => [along * rx + up * rz > 0 ? x1 : x0, along * rz - up * rx > 0 ? z1 : z0] as const
      const [ax, az] = corner(-1, -1)
      const [bx, bz] = corner(1, -1)
      const [cx, cz] = corner(1, 1)
      const [dx, dz] = corner(-1, 1)
      add(ax, az, bx, bz, cx, cz, dx, dz, cell, tone, 1)
    },
    build() {
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
      geo.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3))
      colors = new BufferAttribute(new Float32Array((pos.length / 3) * 4), 4)
      geo.setAttribute('color', colors)
      geo.setIndex(idx)
      retheme()
      const mesh = new Mesh(geo, material)
      mesh.name = 'room-paint'
      // Just above the tunnel's own floor paint, under the contact shadows.
      mesh.position.y = 0.008
      mesh.renderOrder = -3
      mesh.receiveShadow = true
      return mesh
    },
    retheme,
    dispose() {
      material.dispose()
      texture.dispose()
    },
  }
}
