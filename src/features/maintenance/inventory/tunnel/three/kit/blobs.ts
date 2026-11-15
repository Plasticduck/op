import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Object3D, PlaneGeometry, ShaderMaterial, Vector4 } from 'three'
import { SHADOW_SLIDE } from './palette'

// Stand-in shadows. The real shadow map is drawn once and never again, so anything that
// moves (a swinging brush, the car) can't cast into it: it gets a blob that follows it
// instead. Every blob in the scene is one instance of one mesh, so they cost a single
// draw call between them.
//
// A blob is an empty anchor inside a model. Wherever the anchor ends up, its blob lies on
// the floor under it: a soft-edged patch the size of the footprint, and, when it is told
// how tall the thing is (cast), stretched away from the key light the way a real shadow
// would fall, so it lines up with the frame shadows around it. Lift the anchor off the
// floor and the blob slides out from under it and softens.

export type BlobOpts = {
  // Where the anchor sits in its parent. Default: the parent's origin.
  x?: number
  y?: number
  z?: number
  // 'round' for anything turned on a shaft, 'box' for a body with a rectangular footprint.
  shape?: 'round' | 'box'
  // The height in feet of what stands over the footprint: the blob reaches that far away
  // from the light. Default 0: a contact patch only, for things already in the shadow map.
  cast?: number
  // 1 is as dark as a real shadow. Default 1.
  opacity?: number
  // How dark the ring is where the thing meets the floor, next to its shadow. Default
  // 1.5; more for something heavy that sits low (a car), 0 for none.
  contact?: number
  // Width of the soft edge in feet. Default: a fifth of the smaller side, 0.35 to 1.1.
  soft?: number
}

export type BlobPool = {
  mesh: InstancedMesh
  // w by d is the footprint of the thing itself: the soft edge is added around it.
  add(parent: Object3D, w: number, d: number, opts?: BlobOpts): Object3D
  // Forgets the blobs under a model that's being removed.
  release(root: Object3D): void
  // Lays every blob under its anchor. Call once before each frame is drawn.
  sync(): void
  // How dark a blob of opacity 1 is: set per theme to match the shadow map on concrete.
  setStrength(v: number): void
  // Where there is concrete to fall on (up to eight slabs): a shadow stops at its edge.
  setFloor(slabs: ReadonlyArray<{ minX: number; maxX: number; minZ: number; maxZ: number }>): void
  dispose(): void
}

const CAPACITY = 256
const FLOOR_Y = 0.014
const MAX_SLABS = 8

type Entry = { anchor: Object3D; hw: number; hd: number; r: number; soft: number; cast: number; opacity: number; contact: number }

const VERT = /* glsl */ `
attribute vec4 aShape;
attribute vec4 aCast;
varying vec2 vP;
varying vec2 vAt;
varying vec4 vShape;
varying vec4 vCast;
void main() {
  // The quad's own size in feet, so the fragment shader can measure in feet too.
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  vP = position.xz * size;
  vShape = aShape;
  vCast = aCast;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vAt = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

// The footprint is a rounded rectangle. A cast shadow is that rectangle dragged along a
// line (from under the thing to where its top's shadow lands): the distance to it is the
// nearest of a few copies along the line, which is exact enough under a soft edge.
const FRAG = /* glsl */ `
uniform float uStrength;
uniform vec4 uSlabs[${MAX_SLABS}];
uniform int uCount;
varying vec2 vP;
varying vec2 vAt;
varying vec4 vShape;
varying vec4 vCast;
float sdBox(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 h = vShape.xy;
  float r = vShape.z;
  float soft = vShape.w;
  vec2 sweep = vCast.xy;
  float d = 1e5;
  for (int i = 0; i < 7; i++) d = min(d, sdBox(vP - sweep * (float(i) / 6.0 - 0.5), h, r));
  float all = 1.0 - smoothstep(-0.5 * soft, soft, d);
  // Where the thing meets the floor it is dark all the way round, light or no light:
  // that ring is what plants it on the ground when its shadow falls away from the viewer.
  float near = 1.0 - smoothstep(-0.3 * soft, 1.7 * soft, sdBox(vP + sweep * 0.5, h, r));
  float a = uStrength * vCast.z * max(all * 0.85, near * near * vCast.w);
  // Off the edge of the concrete there is nothing for a shadow to fall on.
  float off = uCount > 0 ? 1e5 : -1.0;
  for (int i = 0; i < ${MAX_SLABS}; i++) {
    if (i >= uCount) break;
    off = min(off, sdBox(vAt - uSlabs[i].xy, uSlabs[i].zw, 1.4));
  }
  a *= 1.0 - smoothstep(-0.25, 0.0, off);
  // A pixel of noise, or the wide soft edge shows as rings.
  a += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 1.0));
}
`

// True when the anchor is in a scene and nothing above it is hidden.
function shown(o: Object3D): boolean {
  let top: Object3D = o
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false
    top = p
  }
  return (top as { isScene?: boolean }).isScene === true
}

export function createBlobPool(): BlobPool {
  const geo = new PlaneGeometry(1, 1)
  geo.rotateX(-Math.PI / 2)
  geo.userData.shared = true
  const aShape = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const aCast = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  aShape.setUsage(DynamicDrawUsage)
  aCast.setUsage(DynamicDrawUsage)
  geo.setAttribute('aShape', aShape)
  geo.setAttribute('aCast', aCast)
  const uniforms = {
    uStrength: { value: 0.3 },
    uSlabs: { value: Array.from({ length: MAX_SLABS }, () => new Vector4()) },
    uCount: { value: 0 },
  }
  const mat = new ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  })
  mat.name = 'blob'
  const mesh = new InstancedMesh(geo, mat, CAPACITY)
  mesh.name = 'contact-blobs'
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count = 0
  mesh.frustumCulled = false
  // With the floor's paint, before anything else see-through (spray, ghosts).
  mesh.renderOrder = -2
  mesh.userData.keep = true

  let entries: Entry[] = []
  return {
    mesh,
    add(parent, w, d, opts = {}) {
      const anchor = new Object3D()
      anchor.name = 'blob'
      anchor.userData.blob = true
      anchor.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0)
      parent.add(anchor)
      const hw = Math.max(0.05, w / 2)
      const hd = Math.max(0.05, d / 2)
      const least = Math.min(hw, hd)
      entries.push({
        anchor, hw, hd,
        r: opts.shape === 'box' ? least * 0.35 : least,
        soft: opts.soft ?? Math.min(1.1, Math.max(0.35, least * 0.4)),
        cast: Math.max(0, opts.cast ?? 0),
        opacity: opts.opacity ?? 1,
        contact: opts.contact ?? 1.5,
      })
      return anchor
    },
    release(root) {
      const under = (o: Object3D): boolean => {
        for (let p: Object3D | null = o; p; p = p.parent) if (p === root) return true
        return false
      }
      entries = entries.filter((e) => !under(e.anchor))
    },
    sync() {
      const m = mesh.instanceMatrix.array
      const sh = aShape.array
      const ca = aCast.array
      let n = 0
      for (const e of entries) {
        if (n >= CAPACITY) break
        if (!shown(e.anchor)) continue
        const w = e.anchor.matrixWorld.elements
        const lift = Math.max(0, w[13])
        const yaw = Math.atan2(-w[2], w[0])
        const cos = Math.cos(yaw)
        const sin = Math.sin(yaw)
        // A model that's scaled (the car popping in) takes its blob with it. The anchor's
        // own scale counts too: across for the footprint (a brush flaring out), up for
        // the height.
        const scale = Math.hypot(w[0], w[1], w[2])
        const tall = Math.hypot(w[4], w[5], w[6])
        if (scale < 1e-3 || tall < 1e-3) continue
        const hw = e.hw * scale
        const hd = e.hd * Math.hypot(w[8], w[9], w[10])
        // Off the floor the shadow softens and thins, as the light gets in under it.
        const soft = e.soft * (1 + lift * 0.3)
        // The shadow runs from where the bottom's lands to where the top's does.
        const y0 = lift
        const y1 = lift + e.cast * tall
        const wx = SHADOW_SLIDE[0] * (y1 - y0)
        const wz = SHADOW_SLIDE[1] * (y1 - y0)
        // That run, in the blob's own turned frame.
        const lx = wx * cos - wz * sin
        const lz = wx * sin + wz * cos
        const sx = hw * 2 + Math.abs(lx) + soft * 3.6
        const sz = hd * 2 + Math.abs(lz) + soft * 3.6
        const o = n * 16
        // A flat quad turned by yaw and stretched to cover the whole shadow, written
        // straight into the instance buffer (column-major) so nothing is allocated.
        m.fill(0, o, o + 16)
        m[o] = cos * sx
        m[o + 2] = -sin * sx
        m[o + 5] = 1
        m[o + 8] = sin * sz
        m[o + 10] = cos * sz
        m[o + 12] = w[12] + SHADOW_SLIDE[0] * (y0 + y1) * 0.5
        m[o + 13] = FLOOR_Y
        m[o + 14] = w[14] + SHADOW_SLIDE[1] * (y0 + y1) * 0.5
        m[o + 15] = 1
        const k = n * 4
        sh[k] = hw
        sh[k + 1] = hd
        sh[k + 2] = e.r * scale
        sh[k + 3] = soft
        ca[k] = lx
        ca[k + 1] = lz
        ca[k + 2] = (e.opacity * Math.min(1, tall)) / (1 + lift * 0.5)
        ca[k + 3] = e.contact
        n++
      }
      if (n !== mesh.count || n > 0) {
        mesh.count = n
        mesh.instanceMatrix.needsUpdate = true
        aShape.needsUpdate = true
        aCast.needsUpdate = true
      }
    },
    setStrength(v) {
      uniforms.uStrength.value = v
    },
    setFloor(slabs) {
      const n = Math.min(MAX_SLABS, slabs.length)
      for (let k = 0; k < n; k++) {
        const b = slabs[k]
        uniforms.uSlabs.value[k].set((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2)
      }
      uniforms.uCount.value = n
    },
    dispose() {
      entries = []
      geo.dispose()
      mat.dispose()
      mesh.dispose()
    },
  }
}
