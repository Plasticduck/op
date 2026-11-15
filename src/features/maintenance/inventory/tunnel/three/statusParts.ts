import { BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Points, PointsMaterial, SRGBColorSpace } from 'three'
import type { PerspectiveCamera } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { HEAT_ALPHA, heatStep } from '../tones'
import type { ColorBy, Tone } from '../tones'
import type { Palette } from './kit'
import type { ThemeName } from './types'

// What the status layer (status.ts) draws with: the colors a tone is painted in, flat
// shapes on the floor (pads, rings, dashes, hatching, brackets, ruler ticks), the stack
// lights that stand on machines that are down, and the caps that carry a tone on top of
// a machine. Everything here is shared between machines: all floor shapes of one kind
// are one mesh, all stack lights three, all caps one.

// ---- Colors ---------------------------------------------------------------------------

// Colors the kit's palette doesn't have. Tones themselves (ok, warn, danger, accent) come
// from kit.palette, which holds the same values as the page's tokens in src/index.css,
// so a pad here and a shape in the 2D diagram are the same color.
export type StatusColors = {
  // Bodies in the usage, work order and sticker views, and retired machines.
  clay: string
  retired: string
  // Outlines with nothing to say (not linked, nothing open, where it was saved). Dark on
  // the light theme's concrete, pale on the dark theme's, which is mid gray.
  mark: string
}

export const STATUS_COLORS: Record<ThemeName, StatusColors> = {
  light: { clay: '#bcc1c9', retired: '#8d939c', mark: '#4b5563' },
  dark: { clay: '#a9afb8', retired: '#565d68', mark: '#eef1f5' },
}

// The lenses of a stack light: lit, and dark. A light is as bright in either theme.
const LENS = {
  red: '#ff4a3d',
  amber: '#ffb224',
  amberGlow: '#ff9410',
  redOff: '#6a2b2b',
  amberOff: '#6a5020',
  greenOff: '#24503f',
  housing: '#2c3138',
  pole: '#4a515b',
} as const

// Two colors mixed the way the browser lays one over the other (in display values, not
// linear light), so a mix here matches a CSS fill at that opacity.
export function mixHex(under: string, over: string, alpha: number): string {
  let out = '#'
  for (let k = 1; k < 7; k += 2) {
    const a = parseInt(under.slice(k, k + 2), 16)
    const b = parseInt(over.slice(k, k + 2), 16)
    out += Math.round(a + (b - a) * alpha).toString(16).padStart(2, '0')
  }
  return out
}

// How a tone is painted on the floor under a machine, and on top of it. Each tone has
// its own pattern as well as its color, so color is never the only thing that tells
// them apart: hatching means act now, a solid band means look at this, a thin line is
// fine, dashes mean there is no machine to speak of.
export type TonePaint = {
  color: string
  // Thickness of the outline in feet, and how opaque it is.
  ring: number
  ringAlpha: number
  // Opacity of the fill inside it (0: none).
  fill: number
  hatch: boolean
  dashed: boolean
  // The cap on top of the machine (null: none).
  cap: string | null
}

export function tonePaint(tone: Tone, colorBy: ColorBy, p: Palette, c: StatusColors): TonePaint | null {
  const flat = { hatch: false, dashed: false }
  // Status keeps real materials and puts a stack light on what's down: no caps there.
  const caps = colorBy !== 'status'
  switch (tone) {
    case 'ok':
      // A machine that's up has nothing on the floor in the status view.
      return caps ? { ...flat, color: p.ok, ring: 0.14, ringAlpha: 1, fill: 0.18, cap: p.ok } : null
    case 'warn':
      return { ...flat, color: p.warn, ring: 0.22, ringAlpha: 1, fill: 0.34, cap: caps ? p.warn : null }
    case 'danger':
      return { ...flat, color: p.danger, ring: 0.26, ringAlpha: 1, fill: 0.12, hatch: true, cap: caps ? p.danger : null }
    case 'neutral':
      return { ...flat, color: c.mark, ring: 0.07, ringAlpha: 0.5, fill: 0, cap: null }
    case 'unlinked':
      return { ...flat, color: c.mark, ring: 0.1, ringAlpha: 0.75, fill: 0, dashed: true, cap: null }
    case 'retired':
      return { ...flat, color: c.mark, ring: 0.1, ringAlpha: 0.6, fill: 0.14, dashed: true, cap: null }
    default: {
      // Use: the accent color, as strong as the 2D diagram fills that step. The pad lays
      // it over the concrete; the cap is the same share of it over the clay it stands on,
      // so few cars is barely tinted and many is solid blue in either theme.
      const a = HEAT_ALPHA[Math.max(0, heatStep(tone))]
      return { ...flat, color: p.accent, ring: 0.14, ringAlpha: 1, fill: a, cap: mixHex(c.clay, p.accent, a) }
    }
  }
}

// ---- Flat shapes on the floor -----------------------------------------------------------

// One mesh holding any number of flat colored shapes, redrawn from scratch whenever what
// it shows changes: begin(), draw, end(). Positions are world feet (x along the tunnel, z
// across it). Colors are written per corner with their own opacity, so every shape shares
// one material and the whole mesh is one draw call.
export type Marks = {
  readonly mesh: Mesh
  begin(): void
  // The color and opacity of what is drawn next.
  ink(hex: string, alpha: number): void
  // How high off the floor what is drawn next lies.
  lift(y: number): void
  // A rounded rectangle w by d around (cx, cz), filled.
  fill(cx: number, cz: number, w: number, d: number, r: number): void
  // Its outline, t feet thick, inside that rectangle's edge.
  ring(cx: number, cz: number, w: number, d: number, r: number, t: number): void
  // The same outline in dashes: solid corners, evenly spaced dashes between them.
  dashed(cx: number, cz: number, w: number, d: number, r: number, t: number, dash: number, gap: number): void
  // Diagonal stripes across the rectangle.
  hatch(cx: number, cz: number, w: number, d: number, pitch: number, width: number): void
  // Four L shaped brackets at the rectangle's corners.
  corners(cx: number, cz: number, w: number, d: number, leg: number, t: number): void
  line(x0: number, z0: number, x1: number, z1: number, t: number): void
  dashes(x0: number, z0: number, x1: number, z1: number, t: number, dash: number, gap: number): void
  // A plain rectangle between two corners.
  rect(x0: number, z0: number, x1: number, z1: number): void
  // A whole number painted in bars, h feet tall, centered on x and starting at z.
  number(value: number, x: number, z: number, h: number): void
  // Puts what was drawn on screen. The mesh hides itself when nothing was.
  end(): void
  dispose(): void
}

export function createMarkMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    // A tone's color is data: neither the tone mapping nor the haze may shift it, or it
    // stops matching the legend and the 2D diagram.
    vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    // Flat shapes seen from above, whichever way their corners were listed. In one pass:
    // left to itself the renderer draws a see-through two-sided mesh twice.
    side: DoubleSide, forceSinglePass: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  })
  m.name = 'floor-marks'
  return m
}

// Steps around each rounded corner.
const ARC = 4
const RIM = 4 * (ARC + 1)

// Which of a digit's seven bars are on: top, upper left, upper right, middle, lower left,
// lower right, bottom.
const BARS: Record<string, string> = {
  0: '1110111', 1: '0010010', 2: '1011101', 3: '1011011', 4: '0111010', 5: '1101011', 6: '1101111', 7: '1010010', 8: '1111111', 9: '1111011', '-': '0001000',
}

export function createMarks(material: MeshBasicMaterial, renderOrder: number): Marks {
  let cap = 2048
  let pos = new Float32Array(cap * 3)
  let col = new Float32Array(cap * 4)
  // The arrays were replaced by bigger ones: the geometry has to be made again.
  let stale = false
  let n = 0
  const c = new Color()
  let alpha = 1
  let y = 0
  const outer = new Float32Array(RIM * 2)
  const inner = new Float32Array(RIM * 2)

  const geometry = (): BufferGeometry => {
    const g = new BufferGeometry()
    const p = new BufferAttribute(pos, 3)
    const q = new BufferAttribute(col, 4)
    p.setUsage(DynamicDrawUsage)
    q.setUsage(DynamicDrawUsage)
    g.setAttribute('position', p)
    g.setAttribute('color', q)
    g.setDrawRange(0, 0)
    return g
  }
  // It has its real attributes from the start, so its shader can be compiled with the
  // scene's, before there is anything to draw.
  const mesh = new Mesh(geometry(), material)
  mesh.name = 'floor-marks'
  // Its shapes are anywhere on the floor and change all the time: never cull it.
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  mesh.visible = false

  const room = (verts: number) => {
    if (n + verts <= cap) return
    while (n + verts > cap) cap *= 2
    const p = new Float32Array(cap * 3)
    const q = new Float32Array(cap * 4)
    p.set(pos.subarray(0, n * 3))
    q.set(col.subarray(0, n * 4))
    pos = p
    col = q
    stale = true
  }
  const vert = (x: number, z: number) => {
    pos[n * 3] = x
    pos[n * 3 + 1] = y
    pos[n * 3 + 2] = z
    col[n * 4] = c.r
    col[n * 4 + 1] = c.g
    col[n * 4 + 2] = c.b
    col[n * 4 + 3] = alpha
    n++
  }
  const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
    room(3)
    vert(ax, az)
    vert(bx, bz)
    vert(cx, cz)
  }
  const quad = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
    room(6)
    vert(ax, az)
    vert(bx, bz)
    vert(cx, cz)
    vert(ax, az)
    vert(cx, cz)
    vert(dx, dz)
  }
  // The points of a rounded rectangle's edge, going round from the +x side.
  const rim = (out: Float32Array, cx: number, cz: number, hw: number, hd: number, r: number) => {
    const rr = Math.max(0, Math.min(r, hw, hd))
    let k = 0
    for (let corner = 0; corner < 4; corner++) {
      const ox = cx + (corner === 0 || corner === 3 ? 1 : -1) * (hw - rr)
      const oz = cz + (corner < 2 ? 1 : -1) * (hd - rr)
      for (let s = 0; s <= ARC; s++) {
        const a = (corner + s / ARC) * (Math.PI / 2)
        out[k++] = ox + Math.cos(a) * rr
        out[k++] = oz + Math.sin(a) * rr
      }
    }
  }
  // An outline needs both edges: the outside one, and one t feet inside it.
  const edges = (cx: number, cz: number, w: number, d: number, r: number, t: number) => {
    const hw = Math.max(0.02, w / 2)
    const hd = Math.max(0.02, d / 2)
    const tt = Math.min(t, hw, hd)
    rim(outer, cx, cz, hw, hd, r)
    rim(inner, cx, cz, hw - tt, hd - tt, Math.max(0, Math.min(r, hw, hd) - tt))
  }
  const band = (a: number, b: number) => quad(outer[a * 2], outer[a * 2 + 1], outer[b * 2], outer[b * 2 + 1], inner[b * 2], inner[b * 2 + 1], inner[a * 2], inner[a * 2 + 1])
  const rect = (x0: number, z0: number, x1: number, z1: number) => quad(x0, z0, x1, z0, x1, z1, x0, z1)
  const line = (x0: number, z0: number, x1: number, z1: number, t: number) => {
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz)
    if (len < 1e-4) return
    const nx = (-dz / len) * (t / 2)
    const nz = (dx / len) * (t / 2)
    quad(x0 + nx, z0 + nz, x1 + nx, z1 + nz, x1 - nx, z1 - nz, x0 - nx, z0 - nz)
  }

  return {
    mesh,
    begin() {
      n = 0
      alpha = 1
      y = 0
    },
    ink(hex, a) {
      c.set(hex)
      alpha = a
    },
    lift(v) {
      y = v
    },
    fill(cx, cz, w, d, r) {
      rim(outer, cx, cz, Math.max(0.02, w / 2), Math.max(0.02, d / 2), r)
      for (let k = 0; k < RIM; k++) {
        const j = (k + 1) % RIM
        tri(cx, cz, outer[k * 2], outer[k * 2 + 1], outer[j * 2], outer[j * 2 + 1])
      }
    },
    ring(cx, cz, w, d, r, t) {
      edges(cx, cz, w, d, r, t)
      for (let k = 0; k < RIM; k++) band(k, (k + 1) % RIM)
    },
    dashed(cx, cz, w, d, r, t, dash, gap) {
      edges(cx, cz, w, d, r, t)
      for (let corner = 0; corner < 4; corner++) {
        const first = corner * (ARC + 1)
        for (let s = 0; s < ARC; s++) band(first + s, first + s + 1)
        // The straight side from this corner's end to the next corner's start.
        const a = first + ARC
        const b = ((corner + 1) % 4) * (ARC + 1)
        const ax = outer[a * 2]
        const az = outer[a * 2 + 1]
        const bx = outer[b * 2]
        const bz = outer[b * 2 + 1]
        const len = Math.hypot(bx - ax, bz - az)
        const count = Math.floor((len - gap) / (dash + gap))
        if (count < 1) continue
        // Spread the dashes so the gaps at both ends match the ones between.
        const space = (len - count * dash) / (count + 1)
        const ix = inner[a * 2]
        const iz = inner[a * 2 + 1]
        const jx = inner[b * 2]
        const jz = inner[b * 2 + 1]
        for (let k = 0; k < count; k++) {
          const u = (space + k * (dash + space)) / len
          const v = u + dash / len
          quad(ax + (bx - ax) * u, az + (bz - az) * u, ax + (bx - ax) * v, az + (bz - az) * v, ix + (jx - ix) * v, iz + (jz - iz) * v, ix + (jx - ix) * u, iz + (jz - iz) * u)
        }
      }
    },
    hatch(cx, cz, w, d, pitch, width) {
      if (w <= 0 || d <= 0) return
      const x0 = cx - w / 2
      const z0 = cz - d / 2
      const x1 = cx + w / 2
      const z1 = cz + d / 2
      // A stripe is the part of the rectangle between two diagonals. Each diagonal is
      // named by u, how far along the two near sides it starts.
      for (let u0 = pitch * 0.35; u0 < w + d; u0 += pitch) {
        const u1 = Math.min(w + d, u0 + width)
        // Where a diagonal leaves the rectangle on the left or far side, and on the near
        // or right side.
        const px0 = u0 <= d ? x0 : x0 + (u0 - d)
        const pz0 = u0 <= d ? z0 + u0 : z1
        const qx0 = u0 <= w ? x0 + u0 : x1
        const qz0 = u0 <= w ? z0 : z0 + (u0 - w)
        const px1 = u1 <= d ? x0 : x0 + (u1 - d)
        const pz1 = u1 <= d ? z0 + u1 : z1
        const qx1 = u1 <= w ? x0 + u1 : x1
        const qz1 = u1 <= w ? z0 : z0 + (u1 - w)
        quad(px0, pz0, qx0, qz0, qx1, qz1, px1, pz1)
        // A stripe that passes a corner of the rectangle takes the corner in.
        if (u0 < w && u1 > w) tri(qx0, qz0, x1, z0, qx1, qz1)
        if (u0 < d && u1 > d) tri(px0, pz0, px1, pz1, x0, z1)
      }
    },
    corners(cx, cz, w, d, leg, t) {
      const hw = w / 2
      const hd = d / 2
      const l = Math.min(leg, hw, hd)
      const tt = Math.min(t, l)
      for (let k = 0; k < 4; k++) {
        const sx = k & 1 ? 1 : -1
        const sz = k & 2 ? 1 : -1
        const x = cx + sx * hw
        const z = cz + sz * hd
        rect(x, z, x - sx * l, z - sz * tt)
        rect(x, z - sz * tt, x - sx * tt, z - sz * l)
      }
    },
    line,
    dashes(x0, z0, x1, z1, t, dash, gap) {
      const len = Math.hypot(x1 - x0, z1 - z0)
      if (len < 1e-4) return
      for (let s = 0; s < len; s += dash + gap) {
        const e = Math.min(len, s + dash)
        line(x0 + ((x1 - x0) * s) / len, z0 + ((z1 - z0) * s) / len, x0 + ((x1 - x0) * e) / len, z0 + ((z1 - z0) * e) / len, t)
      }
    },
    rect,
    number(value, x, z, h) {
      const text = String(Math.round(value))
      const w = h * 0.52
      const t = h * 0.15
      const step = w + h * 0.2
      let left = x - (text.length * step - h * 0.2) / 2
      // Read from the passenger side, as the floor's own numbers are: the top of a digit
      // is toward the tunnel (z), its foot toward the viewer (z + h). An upright bar
      // stops short of a level one that's on, so nothing is painted twice, and runs
      // through where one is off, so a 1 is one stroke.
      const mid = z + h / 2
      for (const ch of text) {
        const on = BARS[ch]
        if (on) {
          const top = on[0] === '1' ? t : 0
          const bar = on[3] === '1' ? t / 2 : 0
          const foot = on[6] === '1' ? t : 0
          if (top) rect(left, z, left + w, z + t)
          if (on[1] === '1') rect(left, z + top, left + t, mid - bar)
          if (on[2] === '1') rect(left + w - t, z + top, left + w, mid - bar)
          if (bar) rect(left, mid - bar, left + w, mid + bar)
          if (on[4] === '1') rect(left, mid + bar, left + t, z + h - foot)
          if (on[5] === '1') rect(left + w - t, mid + bar, left + w, z + h - foot)
          if (foot) rect(left, z + h - t, left + w, z + h)
        }
        left += step
      }
    },
    end() {
      mesh.visible = n > 0
      if (!n) return
      if (stale) {
        mesh.geometry.dispose()
        mesh.geometry = geometry()
        stale = false
      }
      const geo = mesh.geometry
      const p = geo.attributes.position as BufferAttribute
      const q = geo.attributes.color as BufferAttribute
      // Only what was drawn goes to the GPU.
      p.clearUpdateRanges()
      q.clearUpdateRanges()
      p.addUpdateRange(0, n * 3)
      q.addUpdateRange(0, n * 4)
      p.needsUpdate = true
      q.needsUpdate = true
      geo.setDrawRange(0, n)
    },
    dispose() {
      mesh.geometry.dispose()
    },
  }
}

// ---- Stack lights -----------------------------------------------------------------------

// A cylinder standing on y, painted one flat color. shade darkens its side and underside
// a little, for parts drawn without lighting.
function drum(rBottom: number, rTop: number, h: number, y: number, hex: string, radial = 16, shade = false): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, h, radial)
  g.translate(0, y + h / 2, 0)
  const count = g.attributes.position.count
  const normal = g.attributes.normal
  const base = new Color(hex)
  const paint = new Float32Array(count * 3)
  for (let k = 0; k < count; k++) {
    const ny = normal.getY(k)
    const f = !shade ? 1 : ny > 0.5 ? 1 : ny < -0.5 ? 0.55 : 0.8
    paint[k * 3] = base.r * f
    paint[k * 3 + 1] = base.g * f
    paint[k * 3 + 2] = base.b * f
  }
  g.setAttribute('color', new BufferAttribute(paint, 3))
  return g
}

function fuse(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false) as BufferGeometry | null
  if (!merged) return parts[0]
  for (const p of parts) p.dispose()
  return merged
}

// A stack light, from its foot up: a collar, a slim pole, and a head of three lenses
// (green at the bottom, amber, red on top, as on a real machine). About 2.5 ft in all.
const POLE = 1.3
const TIER = 0.3
const TIER_GAP = 0.035
const HEAD_Y = 0.08 + POLE + 0.06
const tierY = (k: number) => HEAD_Y + k * (TIER + TIER_GAP) + TIER / 2
const LIGHT_H = tierY(2) + TIER / 2 + 0.07

const MAX_LIGHTS = 96
const HALO_FT = 2.3

// Seen from the overview a 2.5 ft light is a speck a few pixels wide, and the person
// scanning for what's down would miss it. Far off, a light and a cap stand taller (up to
// GROW_MAX times their size) to stay this many pixels tall; up close they're true to size.
const LIGHT_PX = 30
const CAP_PX = 10
const GROW_MAX = 2

// How many times its size a marker must stand, d feet away, for `size` feet of it to
// cover px pixels, k being pixels per foot one foot from the camera.
const growth = (d: number, k: number, size: number, px: number) => Math.min(GROW_MAX, Math.max(1, (px * d) / (size * k)))

// Pixels per foot one foot in front of the camera, on a canvas `height` CSS pixels tall.
const pixelsPerFoot = (camera: PerspectiveCamera, height: number) => (height / 2) * camera.projectionMatrix.elements[5]

export type StackLights = {
  readonly root: Group
  // How many are standing. They are numbered from 0.
  setCount(n: number): void
  // Stands light i with its foot at a point. broken: the red lens on top, which flashes.
  // Otherwise the amber one in the middle, which stays on.
  set(i: number, x: number, y: number, z: number, broken: boolean): void
  // Whether the red lenses are in the lit part of their flash.
  flash(on: boolean): void
  // Sizes them for the camera: halos are given in feet, and far off a light grows so it
  // never shrinks to a speck. height is the canvas's, in CSS pixels.
  view(camera: PerspectiveCamera, height: number): void
  dispose(): void
}

export function createStackLights(): StackLights {
  const bodyGeo = fuse([
    drum(0.17, 0.12, 0.08, 0, LENS.housing),
    drum(0.045, 0.045, POLE, 0.08, LENS.pole, 10),
    drum(0.15, 0.19, 0.06, 0.08 + POLE, LENS.housing),
    drum(0.17, 0.17, TIER, tierY(0) - TIER / 2, LENS.greenOff),
    drum(0.185, 0.185, TIER_GAP, tierY(0) + TIER / 2, LENS.housing),
    drum(0.17, 0.17, TIER, tierY(1) - TIER / 2, LENS.amberOff),
    drum(0.185, 0.185, TIER_GAP, tierY(1) + TIER / 2, LENS.housing),
    drum(0.17, 0.17, TIER, tierY(2) - TIER / 2, LENS.redOff),
    drum(0.19, 0.14, 0.07, tierY(2) + TIER / 2, LENS.housing),
  ])
  const bodyMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.1 })
  bodyMat.name = 'stack-light'
  const body = new InstancedMesh(bodyGeo, bodyMat, MAX_LIGHTS)
  // The lit lens is a sleeve over its dark one, in a color that ignores the room's light.
  const lensGeo = new CylinderGeometry(0.178, 0.178, TIER, 16)
  const lensMat = new MeshBasicMaterial({ toneMapped: false, fog: false })
  lensMat.name = 'stack-lens'
  const lens = new InstancedMesh(lensGeo, lensMat, MAX_LIGHTS)
  // The glow around it: what makes a light read as lit from across the tunnel.
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')!
  const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  fade.addColorStop(0, 'rgba(255,255,255,1)')
  fade.addColorStop(0.22, 'rgba(255,255,255,0.8)')
  fade.addColorStop(0.55, 'rgba(255,255,255,0.2)')
  fade.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = fade
  g.fillRect(0, 0, 64, 64)
  const glow = new CanvasTexture(canvas)
  glow.colorSpace = SRGBColorSpace
  const haloPos = new BufferAttribute(new Float32Array(MAX_LIGHTS * 3), 3)
  const haloCol = new BufferAttribute(new Float32Array(MAX_LIGHTS * 4), 4)
  const haloGrow = new BufferAttribute(new Float32Array(MAX_LIGHTS).fill(1), 1)
  haloPos.setUsage(DynamicDrawUsage)
  haloCol.setUsage(DynamicDrawUsage)
  haloGrow.setUsage(DynamicDrawUsage)
  const haloGeo = new BufferGeometry()
  haloGeo.setAttribute('position', haloPos)
  haloGeo.setAttribute('color', haloCol)
  haloGeo.setAttribute('grow', haloGrow)
  const haloMat = new PointsMaterial({ map: glow, size: HALO_FT, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, fog: false })
  haloMat.name = 'stack-halo'
  // Points share one size: each halo grows with its own light.
  haloMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('uniform float size;', 'uniform float size;\nattribute float grow;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * grow;')
  }
  const halo = new Points(haloGeo, haloMat)

  const root = new Group()
  root.name = 'stack-lights'
  root.visible = false
  for (const o of [body, lens, halo]) {
    // They follow machines around: their bounds are never right for long.
    o.frustumCulled = false
    root.add(o)
  }
  body.count = 0
  lens.count = 0
  haloGeo.setDrawRange(0, 0)

  const broken = new Uint8Array(MAX_LIGHTS)
  const at = new Float32Array(MAX_LIGHTS * 3)
  const grow = new Float32Array(MAX_LIGHTS).fill(1)
  let count = 0
  let lit = true
  const m = new Matrix4()
  const red = new Color(LENS.red)
  const amber = new Color(LENS.amber)
  // An amber glow as pale as its lens all but vanishes on the light theme's concrete.
  const amberGlow = new Color(LENS.amberGlow)

  // The lens and halo of light i, as its state has it now.
  const lensAt = (i: number) => {
    const on = !broken[i] || lit
    const s = grow[i]
    const x = at[i * 3]
    const y = at[i * 3 + 1] + tierY(broken[i] ? 2 : 1) * s
    const z = at[i * 3 + 2]
    // A lens that's off shrinks to nothing, which shows the dark one under it.
    m.makeScale(on ? s : 0, on ? s : 0, on ? s : 0).setPosition(x, y, z)
    lens.setMatrixAt(i, m)
    lens.setColorAt(i, broken[i] ? red : amber)
    haloPos.setXYZ(i, x, y, z)
    // Between flashes a faint glow stays, or from across the tunnel a broken machine's
    // light reads as no light most of the time.
    const g = broken[i] ? red : amberGlow
    haloCol.setXYZW(i, g.r, g.g, g.b, on ? (broken[i] ? 0.8 : 0.9) : 0.22)
    haloGrow.setX(i, s)
  }
  const place = (i: number) => {
    const s = grow[i]
    m.makeScale(s, s, s).setPosition(at[i * 3], at[i * 3 + 1], at[i * 3 + 2])
    body.setMatrixAt(i, m)
    lensAt(i)
  }
  const commit = () => {
    body.instanceMatrix.needsUpdate = true
    lens.instanceMatrix.needsUpdate = true
    if (lens.instanceColor) lens.instanceColor.needsUpdate = true
    haloPos.needsUpdate = true
    haloCol.needsUpdate = true
    haloGrow.needsUpdate = true
  }

  return {
    root,
    setCount(n) {
      count = Math.min(MAX_LIGHTS, n)
      body.count = count
      lens.count = count
      haloGeo.setDrawRange(0, count)
      root.visible = count > 0
    },
    set(i, x, y, z, isBroken) {
      if (i >= MAX_LIGHTS) return
      at[i * 3] = x
      at[i * 3 + 1] = y
      at[i * 3 + 2] = z
      broken[i] = isBroken ? 1 : 0
      place(i)
      commit()
    },
    flash(on) {
      if (on === lit) return
      lit = on
      for (let i = 0; i < count; i++) if (broken[i]) lensAt(i)
      commit()
    },
    view(camera, height) {
      // A point's size is given as if the lens were 90 degrees wide: scale it to this one.
      haloMat.size = HALO_FT * camera.projectionMatrix.elements[5]
      const k = pixelsPerFoot(camera, height)
      const eye = camera.position
      let changed = false
      for (let i = 0; i < count; i++) {
        const d = Math.hypot(at[i * 3] - eye.x, at[i * 3 + 1] + LIGHT_H / 2 - eye.y, at[i * 3 + 2] - eye.z)
        const s = growth(d, k, LIGHT_H, LIGHT_PX)
        if (Math.abs(s - grow[i]) < 0.005) continue
        grow[i] = s
        place(i)
        changed = true
      }
      if (changed) commit()
    },
    dispose() {
      bodyGeo.dispose()
      bodyMat.dispose()
      lensGeo.dispose()
      lensMat.dispose()
      haloGeo.dispose()
      haloMat.dispose()
      glow.dispose()
      body.dispose()
      lens.dispose()
    },
  }
}

// ---- Tone caps ----------------------------------------------------------------------------

const MAX_CAPS = 256

// A cap is a short colored drum on a neck, standing on top of a machine: its tone, seen
// from any side. All of them are one mesh.
export type ToneCaps = {
  readonly mesh: InstancedMesh
  setCount(n: number): void
  set(i: number, x: number, y: number, z: number, hex: string): void
  // Far off a cap grows, as a stack light does. height is the canvas's, in CSS pixels.
  view(camera: PerspectiveCamera, height: number): void
  dispose(): void
}

// A cap's drum is a foot across: what has to stay readable is its width.
const CAP_W = 1

export function createToneCaps(): ToneCaps {
  // Painted white and tinted per cap. The shading is baked in, because a cap is drawn
  // without lighting so its top is exactly the tone's color.
  const geo = fuse([drum(0.13, 0.13, 0.14, 0, '#6b6b6b', 10), drum(0.5, 0.5, 0.4, 0.14, '#ffffff', 24, true)])
  const mat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
  mat.name = 'tone-cap'
  const mesh = new InstancedMesh(geo, mat, MAX_CAPS)
  mesh.name = 'tone-caps'
  mesh.frustumCulled = false
  mesh.count = 0
  mesh.visible = false
  const m = new Matrix4()
  const c = new Color()
  const at = new Float32Array(MAX_CAPS * 3)
  const grow = new Float32Array(MAX_CAPS).fill(1)
  const place = (i: number) => {
    const s = grow[i]
    m.makeScale(s, s, s).setPosition(at[i * 3], at[i * 3 + 1], at[i * 3 + 2])
    mesh.setMatrixAt(i, m)
  }
  return {
    mesh,
    setCount(n) {
      mesh.count = Math.min(MAX_CAPS, n)
      mesh.visible = mesh.count > 0
    },
    set(i, x, y, z, hex) {
      if (i >= MAX_CAPS) return
      at[i * 3] = x
      at[i * 3 + 1] = y
      at[i * 3 + 2] = z
      place(i)
      mesh.setColorAt(i, c.set(hex))
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    },
    view(camera, height) {
      const k = pixelsPerFoot(camera, height)
      const eye = camera.position
      let changed = false
      for (let i = 0; i < mesh.count; i++) {
        const d = Math.hypot(at[i * 3] - eye.x, at[i * 3 + 1] - eye.y, at[i * 3 + 2] - eye.z)
        const s = growth(d, k, CAP_W, CAP_PX)
        if (Math.abs(s - grow[i]) < 0.005) continue
        grow[i] = s
        place(i)
        changed = true
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true
    },
    dispose() {
      geo.dispose()
      mat.dispose()
      mesh.dispose()
    },
  }
}
