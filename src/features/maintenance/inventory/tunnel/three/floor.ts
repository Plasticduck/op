import { BufferAttribute, BufferGeometry, CanvasTexture, Color, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, Vector4 } from 'three'
import type { TunnelZone } from '@/lib/queries/miTunnel'
import { roundedRectShape } from './kit/geometry'
import { rng } from './kit/textures'
import type { Kit } from './kit'

// The ground the tunnel stands on: beveled concrete slabs floating on the page (one under
// the tunnel, one under each room beside it), the pool of light under them, and
// everything painted on them. The paint is generated from the drawing: zone names
// stenciled along the passenger side, a tick every 5 ft and a number every 10 along the
// tunnel, hazard bands across the entrance and exit, and the tunnel's two wall lines as
// low painted curbs (there are no walls or roof to hide the machines).

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }

export type FloorLayout = {
  // The tunnel: from x = 0 to length, width across, centered on z = 0.
  length: number
  width: number
  zones: TunnelZone[]
  // The slab under the tunnel.
  box: Bounds
  // More slabs, under whatever stands apart from the tunnel (rooms, vacuums). They may
  // overlap the tunnel's slab: together they read as one piece of concrete.
  pads?: Bounds[]
  // False for a bare slab (the single-model gallery).
  markings: boolean
  // Where the car's centerline runs, for the arrows in the prep lane. null: no arrows.
  carLine: number | null
}

export type Floor = {
  group: Group
  // The canvas's size in real pixels: the pool of light fades out toward its edges.
  setViewport(wPx: number, hPx: number): void
  dispose(): void
}

export const SLAB_THICKNESS = 0.8

// ---- Paint -----------------------------------------------------------------------

type Cell = { u0: number; v0: number; u1: number; v1: number; aspect: number }
// A piece of lettering, and how tall its letters are drawn on the full-size picture.
type Label = { text: string; px: number }

// One picture holding everything painted on the floor: a white block for lines, a
// hazard tile, and each piece of lettering (cells[k] is labels[k]). Vertex colors tint
// it. The lettering is laid out before anything is drawn, so the picture can be made
// to hold all of it.
function createPaintAtlas(detail: 'high' | 'low', labels: ReadonlyArray<Label>) {
  const W = detail === 'high' ? 2048 : 1024
  const k = W / 2048
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')!
  const r = rng(31)
  const font = (size: number) => {
    g.font = `800 ${size}px "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif`
    g.letterSpacing = `${size * 0.08}px`
  }
  const measure = (label: string, size: number) => {
    font(size)
    return Math.ceil(g.measureText(label).width + size * 0.3)
  }

  // Lettering goes on shelves below the block and the tile. A label wider than the
  // picture (zone names have no length limit) is lettered smaller to fit: cut off at the
  // canvas's edge, its last column would smear across the rest of its quad.
  type Slot = { x: number; y: number; w: number; h: number; size: number }
  const lay = (scale: number) => {
    const slots: Slot[] = []
    let cx = 0
    let cy = 200 * k
    let shelf = 0
    for (const l of labels) {
      let size = l.px * k * scale
      let w = measure(l.text, size)
      for (let n = 0; w > W && n < 4; n++) {
        size *= (W / w) * 0.98
        w = measure(l.text, size)
      }
      w = Math.min(w, W)
      const h = Math.ceil(size * 1.14)
      if (cx + w > W) {
        cx = 0
        cy += shelf + 6
        shelf = 0
      }
      slots.push({ x: cx, y: cy, w, h, size })
      cx += w + 6
      shelf = Math.max(shelf, h)
    }
    return { slots, bottom: cy + shelf }
  }
  // Half as tall as it is wide holds a usual drawing's lettering. More of it (a long
  // tunnel, many zones) makes the picture square, and past that every letter is drawn
  // smaller: lettering laid out below the bottom edge would simply be missing.
  let scale = 1
  let plan = lay(scale)
  for (let n = 0; plan.bottom > W && n < 8; n++) {
    scale *= Math.max(0.5, Math.sqrt((W - 200 * k) / (plan.bottom - 200 * k)) * 0.97)
    plan = lay(scale)
  }
  const H = plan.bottom > W / 2 ? W : W / 2
  canvas.width = W
  canvas.height = H
  const cell = (x: number, y: number, w: number, h: number): Cell => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H, aspect: w / h })

  g.fillStyle = '#fff'
  g.fillRect(0, 0, 48 * k, 48 * k)
  const solid = cell(8 * k, 8 * k, 32 * k, 32 * k)

  // The hazard tile is drawn larger than the part that's used, so mipmaps and filtering
  // at its edges pick up more stripes, not the neighbors.
  const hz = 128 * k
  const pad = 24 * k
  const hx = 64 * k
  g.save()
  g.beginPath()
  g.rect(hx, 0, hz + pad * 2, hz + pad * 2)
  g.clip()
  g.fillStyle = '#f5b800'
  g.fillRect(hx, 0, hz + pad * 2, hz + pad * 2)
  g.fillStyle = '#1a1d21'
  for (let s = -3; s < 4; s++) {
    const x0 = hx + pad + s * hz
    g.beginPath()
    g.moveTo(x0, pad + hz)
    g.lineTo(x0 + hz / 2, pad + hz)
    // Up and across by the same amount: 45 degrees, so stripes meet at the tile seams.
    g.lineTo(x0 + hz * 1.5 + pad * 2, -pad)
    g.lineTo(x0 + hz + pad * 2, -pad)
    g.closePath()
    g.fill()
    g.beginPath()
    g.moveTo(x0, pad + hz)
    g.lineTo(x0 + hz / 2, pad + hz)
    g.lineTo(x0 + hz / 2 - pad * 2, pad * 3 + hz)
    g.lineTo(x0 - pad * 2, pad * 3 + hz)
    g.closePath()
    g.fill()
  }
  g.restore()
  const hazard = cell(hx + pad, pad, hz, hz)

  // The lettering, where it was laid out.
  const cells = plan.slots.map(({ x, y, w, h, size }, i): Cell => {
    font(size)
    g.fillStyle = '#fff'
    g.textBaseline = 'middle'
    g.textAlign = 'left'
    g.fillText(labels[i].text, x + size * 0.15, y + h * 0.54)
    // Worn paint: knock small flecks out of the lettering.
    g.globalCompositeOperation = 'destination-out'
    for (let n = 0; n < (w * h) / 700; n++) {
      g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.4})`
      const s = 1 + r() * 1.6 * k
      g.fillRect(x + r() * w, y + r() * h, s, s)
    }
    g.globalCompositeOperation = 'source-over'
    return cell(x, y, w, h)
  })

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return { texture, solid, hazard, cells }
}

// Collects flat quads on the floor into one geometry.
function quadBuilder() {
  const pos: number[] = []
  const uv: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color()
  // Corners in order: near-left, near-right, far-right, far-left as seen from +Z (so
  // the picture's bottom edge is the a-b side).
  const quad = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number, cell: Cell, color: string, y = 0) => {
    const base = pos.length / 3
    pos.push(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz)
    uv.push(cell.u0, cell.v0, cell.u1, cell.v0, cell.u1, cell.v1, cell.u0, cell.v1)
    c.set(color)
    for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  // An upright rectangle from x0 to x1, z0 (far) to z1 (near).
  const rect = (x0: number, z0: number, x1: number, z1: number, cell: Cell, color: string) => quad(x0, z1, x1, z1, x1, z0, x0, z0, cell, color)
  const build = (): BufferGeometry => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3))
    geo.setIndex(idx)
    return geo
  }
  return { quad, rect, build }
}

// ---- The ground -------------------------------------------------------------------

const MAX_SLABS = 8
const CORNER = 1.4

const GROUND_VERT = /* glsl */ `
varying vec2 vAt;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vAt = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

// Everything is measured from the nearest slab's edge: the pool of light fades with that
// distance, and so does the soft shadow the slabs leave on the ground. Colors come in
// already in display values and go out untouched, so where the pool has faded to nothing
// the pixel is exactly the page color. It also fades toward the canvas's own edges, so
// the canvas never shows as a rectangle however the camera is placed.
const GROUND_FRAG = /* glsl */ `
uniform vec4 uSlabs[${MAX_SLABS}];
uniform int uCount;
uniform vec3 uBackdrop;
uniform vec3 uPool;
uniform vec3 uShade;
uniform float uGlow;
uniform float uShadow;
uniform float uBlur;
uniform vec2 uRes;
varying vec2 vAt;
float sdBox(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = 1e5;
  for (int i = 0; i < ${MAX_SLABS}; i++) {
    if (i >= uCount) break;
    d = min(d, sdBox(vAt - uSlabs[i].xy, uSlabs[i].zw, ${CORNER.toFixed(1)}));
  }
  float pool = 1.0 - smoothstep(0.0, uGlow, d);
  pool *= pool;
  float shade = 1.0 - smoothstep(-0.5, uBlur, d);
  shade = uShadow * shade * shade;
  vec2 px = min(gl_FragCoord.xy, uRes - gl_FragCoord.xy);
  float inside = smoothstep(0.0, 0.14 * min(uRes.x, uRes.y), min(px.x, px.y));
  pool *= inside;
  shade *= inside;
  vec3 col = mix(mix(uBackdrop, uPool, pool), uShade, shade);
  // A pixel of noise where anything was added, or the long fade shows as rings.
  float any = step(0.001, pool + shade);
  col += any * (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`

// A hex color as the display values it stands for (no conversion to linear light).
function display(css: string): Vector3 {
  return new Vector3(parseInt(css.slice(1, 3), 16) / 255, parseInt(css.slice(3, 5), 16) / 255, parseInt(css.slice(5, 7), 16) / 255)
}

// ---- The floor --------------------------------------------------------------------

export function buildFloor(kit: Kit, l: FloorLayout): Floor {
  const group = new Group()
  group.name = 'floor'
  const owned: Array<{ dispose(): void }> = []
  const p = kit.palette
  const { minX, maxX } = l.box
  const half = l.width / 2
  const slabs = [l.box, ...(l.pads ?? [])].slice(0, MAX_SLABS)

  // The slabs, top face at y = 0. Their uvs are in feet, which the concrete texture
  // expects, so where two overlap they show the very same concrete.
  const bevel = 0.1
  for (const b of slabs) {
    const slabGeo = new ExtrudeGeometry(roundedRectShape(b.minX, -b.maxZ, b.maxX, -b.minZ, CORNER), {
      depth: SLAB_THICKNESS - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8,
    })
    slabGeo.rotateX(-Math.PI / 2)
    slabGeo.translate(0, -(SLAB_THICKNESS - bevel), 0)
    const slab = new Mesh(slabGeo, [kit.mat.concrete, kit.mat.concreteEdge])
    slab.name = 'slab'
    slab.receiveShadow = true
    group.add(slab)
    owned.push(slabGeo)
  }

  // The ground: a pool of light around the slabs that fades into the page, with their
  // soft shadow on it.
  let gx0 = Infinity
  let gx1 = -Infinity
  let gz0 = Infinity
  let gz1 = -Infinity
  for (const b of slabs) {
    gx0 = Math.min(gx0, b.minX)
    gx1 = Math.max(gx1, b.maxX)
    gz0 = Math.min(gz0, b.minZ)
    gz1 = Math.max(gz1, b.maxZ)
  }
  const glow = Math.min(46, Math.max(14, Math.max(gx1 - gx0, gz1 - gz0) * 0.24))
  const dark = kit.theme === 'dark'
  const uniforms = {
    uSlabs: { value: Array.from({ length: MAX_SLABS }, (_, k) => {
      const b = slabs[k] ?? slabs[0]
      return new Vector4((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2)
    }) },
    uCount: { value: slabs.length },
    uBackdrop: { value: display(p.backdrop) },
    uPool: { value: display(p.pool) },
    uShade: { value: display(dark ? '#04070b' : '#aab3c2') },
    uGlow: { value: glow },
    uShadow: { value: dark ? 0.8 : 0.62 },
    uBlur: { value: 6.5 },
    uRes: { value: new Vector2(1440, 810) },
  }
  const groundMat = new ShaderMaterial({ uniforms, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, depthWrite: false, fog: false, toneMapped: false })
  groundMat.name = 'ground'
  const groundGeo = new PlaneGeometry(gx1 - gx0 + glow * 2, gz1 - gz0 + glow * 2)
  groundGeo.rotateX(-Math.PI / 2)
  const ground = new Mesh(groundGeo, groundMat)
  ground.name = 'ground'
  ground.position.set((gx0 + gx1) / 2, -SLAB_THICKNESS + 0.01, (gz0 + gz1) / 2)
  // First of all: it writes no depth, so everything else must be drawn over it.
  ground.renderOrder = -4
  group.add(ground)
  owned.push(groundMat, groundGeo)
  const setViewport = (wPx: number, hPx: number) => uniforms.uRes.value.set(Math.max(1, wPx), Math.max(1, hPx))

  // Paint. The lettering is known first, so the atlas can be made to hold all of it: a
  // number every 10 ft of the tape measure, and each zone's name where it has room.
  const tens: number[] = []
  const named: Array<{ name: string; k: number; from: number; to: number }> = []
  if (l.markings) {
    for (let x = 0; x <= l.length + 0.01; x += 10) tens.push(x)
    l.zones.forEach((zone, k) => {
      const from = Math.max(minX + 1.5, Number(zone.x_from))
      const to = Math.min(maxX - 1.5, Number(zone.x_to))
      if (to - from >= 3) named.push({ name: zone.name.toUpperCase(), k, from, to })
    })
  }
  const atlas = createPaintAtlas(kit.detail, [...tens.map((x) => ({ text: String(x), px: 64 })), ...named.map((z) => ({ text: z.name, px: 84 }))])
  const q = quadBuilder()
  const joint = `#${new Color(p.concrete).multiplyScalar(0.62).getHexString()}`

  // Saw-cut joints: what makes a slab read as poured concrete and gives it scale. They
  // sit on one grid across every slab, so they line up where slabs meet.
  const bay = 15
  slabs.forEach((b, k) => {
    for (let x = Math.ceil((b.minX + 4) / bay) * bay; x < b.maxX - 4; x += bay) q.rect(x - 0.035, b.minZ + 0.25, x + 0.035, b.maxZ - 0.25, atlas.solid, joint)
    for (let z = Math.ceil((b.minZ + 4) / bay) * bay; z < b.maxZ - 4; z += bay) {
      // Not down the middle of the tunnel, where the conveyor runs.
      if (k === 0 && l.markings && Math.abs(z) < half) continue
      q.rect(b.minX + 0.25, z - 0.035, b.maxX - 0.25, z + 0.035, atlas.solid, joint)
    }
  })

  const finish = (): Floor => {
    const paintGeo = q.build()
    const paintMat = new MeshStandardMaterial({
      map: atlas.texture, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.78, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })
    const paint = new Mesh(paintGeo, paintMat)
    paint.name = 'floor-paint'
    paint.position.y = 0.006
    paint.receiveShadow = true
    // Paint, then contact shadows, then the status pads: the floor's layers are drawn
    // before anything see-through that stands on it (spray, ghosts).
    paint.renderOrder = -3
    group.add(paint)
    owned.push(paintGeo, paintMat, atlas.texture)
    return { group, setViewport, dispose: () => owned.forEach((o) => o.dispose()) }
  }

  if (!l.markings) return finish()

  // Curbs along the two wall lines, outside them, with yellow ends.
  const curbs = new Group()
  const curbW = 0.6
  const curbH = 0.3
  const endLen = Math.min(3, l.length * 0.1)
  for (const side of [-1, 1]) {
    const z = side * (half + curbW / 2)
    const body = kit.box(l.length - endLen * 2 - 0.02, curbH, curbW, kit.mat.curb, 0.06)
    body.position.set(l.length / 2, curbH / 2, z)
    curbs.add(body)
    for (const x of [endLen / 2, l.length - endLen / 2]) {
      const end = kit.box(endLen, curbH, curbW, kit.mat.yellow, 0.06)
      end.position.set(x, curbH / 2, z)
      curbs.add(end)
    }
  }
  group.add(kit.mergeStatic(curbs))
  curbs.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) owned.push(m.geometry)
  })

  // Hazard bands across the two open ends.
  const band = 1.5
  for (const x0 of [-band - 0.15, l.length + 0.15]) {
    for (let z = -half; z < half - 0.01; z += band) {
      const z1 = Math.min(half, z + band)
      const part = (z1 - z) / band
      const c = { ...atlas.hazard, v0: atlas.hazard.v1 - (atlas.hazard.v1 - atlas.hazard.v0) * part }
      q.rect(x0, z, x0 + band, z1, c, '#ffffff')
    }
  }

  // The prep lane: dashed edges and arrows showing which way cars go.
  const prepFrom = Math.min(0, ...l.zones.map((z) => Number(z.x_from)))
  if (prepFrom < -6) {
    for (const side of [-1, 1]) {
      for (let x = prepFrom + 1; x < -band - 1.2; x += 3.4) q.rect(x, side * half - 0.14, Math.min(x + 2, -band - 0.4), side * half + 0.14, atlas.solid, p.paint)
    }
    if (l.carLine != null) {
      const z = l.carLine
      for (let x = prepFrom + 5; x < -band - 4; x += 5) {
        // A chevron: two bars meeting at the tip.
        const tip = x + 1.5
        q.quad(x, z + 1.5, x + 0.55, z + 1.5, tip + 0.55, z, tip, z, atlas.solid, p.paint)
        q.quad(tip, z, tip + 0.55, z, x + 0.55, z - 1.5, x, z - 1.5, atlas.solid, p.paint)
      }
    }
  }

  // The tape measure along the passenger side: feet from the entrance.
  const z0 = half + curbW + 0.3
  let number = 0
  for (let x = 0; x <= l.length + 0.01; x += 5) {
    const ten = x % 10 === 0
    q.rect(x - 0.07, z0, x + 0.07, z0 + (ten ? 0.8 : 0.45), atlas.solid, p.paintTick)
    if (ten) {
      // Big enough to read from the overview.
      const c = atlas.cells[number++]
      const h = 1.2
      const w = h * c.aspect
      q.rect(x - w / 2, z0 + 1.0, x + w / 2, z0 + 1.0 + h, c, p.paintTick)
    }
  }

  // Zone names, with a line across the tunnel where one zone hands over to the next.
  const nameZ = z0 + 2.55
  const nameH = 2.1
  named.forEach(({ k, from, to }, j) => {
    if (k > 0 && from > minX + 2) q.rect(from - 0.07, -half, from + 0.07, nameZ + nameH, atlas.solid, p.paintTick)
    const c = atlas.cells[tens.length + j]
    const h = Math.min(nameH, ((to - from - 1.6) / c.aspect))
    const w = h * c.aspect
    const x = from + 0.9
    q.rect(x, nameZ + (nameH - h) / 2, x + w, nameZ + (nameH + h) / 2, c, p.paintInk)
  })

  return finish()
}
