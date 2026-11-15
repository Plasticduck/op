import { Color, DoubleSide, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Sphere, Vector3, Vector4 } from 'three'
import type { ColorRepresentation, Material, Texture } from 'three'
import { cylGeo } from './geometry'
import { COLORS } from './palette'
import { rng } from './textures'

// A cloth or foam brush: a few hundred strips around a core, drawn as one instanced
// mesh. Each strip is bent in the vertex shader, so a brush costs the CPU nothing.
// One number drives it. spin 0: stopped, every strip hangs limp under gravity. spin 1:
// full speed, the strips fly out to the full diameter, trailing the rotation a little.
// In between it sags, which is what a brush spinning up looks like.

export type FoamBrushOpts = {
  // Which way the shaft runs, in the returned root's own space. 'y': upright (wraps,
  // side washers). 'z': across the tunnel (top brush). 'x': along it (wheel brushes).
  axis: 'x' | 'y' | 'z'
  // Length of the foam along the shaft and the diameter at full speed, in feet.
  length: number
  diameter: number
  // Diameter of the drum the strips are fixed to.
  core?: number
  // Rows of strips along the shaft, and strips in each row.
  tiers?: number
  perTier?: number
  // One color per band. Bands repeat along the shaft, bandTiers rows each.
  colors?: ColorRepresentation[]
  bandTiers?: number
  // How much each strip's lightness wanders from its band's color, 0 to 1.
  jitter?: number
  stripWidth?: number
  // Turns per second at full speed and which way (1: clockwise seen from the +axis
  // end, so on an upright brush the side facing +Z moves toward -X).
  rps?: number
  dir?: 1 | -1
  // Leave the drum out when the model draws its own shaft.
  drum?: boolean
  // How far below the middle of the shaft the floor is. Limp strips that reach it pile
  // up on it instead of hanging through.
  floor?: number
  seed?: number
}

export type FoamBrush = {
  // Centered on the middle of the shaft. Add it to a part that doesn't spin: the
  // rotation happens in the shader.
  root: Group
  strips: InstancedMesh
  setSpin(v: number): void
  // Advances the rotation. Call once a frame while the scene runs.
  advance(dt: number): void
  // Something solid the foam presses against (a car's side): a plane in root space,
  // normal pointing from the brush toward it, d feet from the shaft. Strips that would
  // pass through are folded back along it. clearContact() removes it.
  setContact(nx: number, ny: number, nz: number, d: number): void
  clearContact(): void
  dispose(): void
}

const VERT_PARS = /* glsl */ `
attribute vec4 aRoot;
attribute vec4 aRand;
uniform float uSpin;
uniform float uAngle;
uniform float uDir;
uniform float uCore;
uniform float uTime;
uniform vec3 uGrav;
uniform vec4 uContact;
uniform float uFloor;
vec3 foamPos;
`

// Runs before three's own normal and position code. Works in the brush's own space,
// where the shaft is +Y. A strip leaves the drum pointing straight out, bends over a
// short arc toward wherever it's being pulled (down when stopped, outward when
// spinning), then runs straight.
const VERT_MAIN = /* glsl */ `
float fU = position.y;
float fFlare = uSpin;
float fTh = aRoot.x + uAngle;
vec3 fR = vec3(cos(fTh), 0.0, sin(fTh));
vec3 fTan = vec3(-fR.z, 0.0, fR.x);
vec3 fShaft = vec3(0.0, 1.0, 0.0);
float fFlutter = sin(uTime * 7.0 + aRand.x * 40.0) * fFlare;
vec3 fPull = normalize(mix(uGrav, fR + uGrav * (0.16 + aRand.w * 0.5) + fShaft * fFlutter * 0.05, fFlare));
float fCos = clamp(dot(fR, fPull), -1.0, 1.0);
float fBend = acos(fCos);
vec3 fE = fPull - fR * fCos;
float fEl = length(fE);
// A strip pointing straight up has no side to fall to: tip it over sideways.
fE = fEl > 1e-4 ? fE / fEl : fTan * (aRand.x > 0.5 ? 1.0 : -1.0);
float fRho = aRand.z;
float fAlong = fU * aRoot.z;
float fArc = fRho * fBend;
float fPhi = min(fAlong, fArc) / fRho;
vec3 fC = fR * (fRho * sin(fPhi)) + fE * (fRho * (1.0 - cos(fPhi)));
vec3 fT = fR * cos(fPhi) + fE * sin(fPhi);
fC += fT * max(fAlong - fArc, 0.0);
// Limp, a strip lies flat against the column. Flying, it stands on edge like a paddle.
vec3 fBn = cross(fR, fE);
vec3 fWl = dot(fBn, fShaft) < 0.0 ? -fBn : fBn;
vec3 fWf = fShaft - fT * dot(fShaft, fT);
float fWfl = length(fWf);
fWf = fWfl > 1e-3 ? fWf / fWfl : fWl;
vec3 fW = normalize(mix(fWl, fWf, fFlare));
float fTw = aRand.y * (0.4 + 0.6 * fFlare) + fFlutter * 0.22 * fU;
vec3 fN0 = cross(fW, fT);
fW = normalize(fW * cos(fTw) + fN0 * sin(fTw));
vec3 fP = fR * uCore + fShaft * aRoot.y + fC + fW * (position.x * aRoot.w);
vec3 fN = cross(fW, fT);
// The tips trail the rotation.
float fLag = -uDir * 0.32 * fU * fU * fFlare;
float fCl = cos(fLag);
float fSl = sin(fLag);
fP.xz = vec2(fP.x * fCl - fP.z * fSl, fP.x * fSl + fP.z * fCl);
fN.xz = vec2(fN.x * fCl - fN.z * fSl, fN.x * fSl + fN.z * fCl);
// Pressed against something solid: fold back along its face, the way the drum turns.
float fOver = dot(fP, uContact.xyz) - uContact.w;
if (fOver > 0.0) {
  vec3 fSlide = cross(uContact.xyz, fShaft) * uDir;
  fP += -uContact.xyz * fOver + fSlide * fOver * 0.75;
  fN = normalize(mix(fN, uContact.xyz, 0.6));
}
// Resting on the floor: the strip lies down and spreads outward.
float fSunk = dot(fP, uGrav) - uFloor;
if (fSunk > 0.0) {
  fP += -uGrav * fSunk + fR * fSunk * 0.12;
  fN = normalize(mix(fN, -uGrav, 0.7));
}
foamPos = fP;
vec3 objectNormal = normalize(fN);
`

function patch(m: MeshStandardMaterial, uniforms: Record<string, { value: unknown }>): void {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', VERT_MAIN)
      .replace('#include <begin_vertex>', 'vec3 transformed = foamPos;')
      // A ghosted brush is one flat color: drop the per-strip tint.
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef T3D_FLAT\nvColor = vec4(1.0);\n#endif')
  }
  m.customProgramCacheKey = () => 'foam-v1'
}

const _c = new Color()
const _hsl = { h: 0, s: 0, l: 0 }
const IDENTITY = new Matrix4()

export function createFoamBrush(opts: FoamBrushOpts, env: { cloth: Texture; clothMask: Texture; coreMat: Material; time: { value: number }; detail: 'high' | 'low' }): FoamBrush {
  const coreR = (opts.core ?? 0.67) / 2
  const reach = Math.max(0.3, opts.diameter / 2 - coreR)
  const stripW = opts.stripWidth ?? 0.42
  const low = env.detail === 'low'
  const tiers = Math.max(1, Math.round((opts.tiers ?? Math.max(2, Math.round(opts.length / 0.6))) * (low ? 0.75 : 1)))
  const per = Math.max(6, Math.round((opts.perTier ?? 36) * (low ? 0.7 : 1)))
  const count = tiers * per
  const r = rng(opts.seed ?? 1)
  const colors = (opts.colors ?? [COLORS.cloth]).map((c) => new Color(c))
  const band = Math.max(1, opts.bandTiers ?? 1)
  const jitter = opts.jitter ?? 0.5

  const geo = new PlaneGeometry(1, 1, 1, low ? 5 : 7)
  geo.translate(0, 0.5, 0)
  const aRoot = new Float32Array(count * 4)
  const aRand = new Float32Array(count * 4)
  const pitch = opts.length / tiers
  let k = 0
  for (let t = 0; t < tiers; t++) {
    for (let p = 0; p < per; p++, k++) {
      // Rows are offset half a step so strips don't line up into columns.
      aRoot[k * 4] = ((p + (t % 2) * 0.5 + (r() - 0.5) * 0.5) / per) * Math.PI * 2
      aRoot[k * 4 + 1] = -opts.length / 2 + pitch * (t + 0.5) + (r() - 0.5) * pitch * 0.95
      aRoot[k * 4 + 2] = reach * (0.86 + r() * 0.2)
      aRoot[k * 4 + 3] = stripW * (0.85 + r() * 0.3)
      aRand[k * 4] = r()
      aRand[k * 4 + 1] = (r() - 0.5) * 1.5
      // How far a limp strip stands off the drum before it turns down.
      aRand[k * 4 + 2] = 0.16 + r() * 0.26
      aRand[k * 4 + 3] = r()
    }
  }
  geo.setAttribute('aRoot', new InstancedBufferAttribute(aRoot, 4))
  geo.setAttribute('aRand', new InstancedBufferAttribute(aRand, 4))
  // The strips move in the shader, so say how far they can reach or the brush is
  // culled as if it were one strip at the origin.
  const far = Math.hypot(opts.length / 2 + reach, coreR + reach) + 0.5
  geo.boundingSphere = new Sphere(new Vector3(), far)

  const uniforms = {
    uSpin: { value: 0 },
    uAngle: { value: 0 },
    uDir: { value: opts.dir ?? 1 },
    uCore: { value: coreR },
    uTime: env.time,
    uGrav: { value: new Vector3(0, -1, 0) },
    uContact: { value: new Vector4(1, 0, 0, 1e4) },
    uFloor: { value: opts.floor ?? 1e4 },
  }
  const mat = new MeshStandardMaterial({ map: env.cloth, alphaMap: env.clothMask, alphaTest: 0.5, alphaToCoverage: true, side: DoubleSide, roughness: 0.92, metalness: 0 })
  mat.name = 'foam'
  patch(mat, uniforms)

  const strips = new InstancedMesh(geo, mat, count)
  for (let i = 0; i < count; i++) {
    strips.setMatrixAt(i, IDENTITY)
    const tier = Math.floor(i / per)
    _c.copy(colors[Math.floor(tier / band) % colors.length])
    _c.getHSL(_hsl)
    _c.setHSL(_hsl.h + (r() - 0.5) * 0.02 * jitter, _hsl.s, Math.min(0.9, Math.max(0.04, _hsl.l + (r() - 0.5) * 0.2 * jitter)))
    strips.setColorAt(i, _c)
  }
  strips.receiveShadow = true
  strips.userData.keep = true

  const root = new Group()
  root.name = 'foam-brush'
  root.userData.keep = true
  // The shader's shaft is +Y. Lay the mesh over for the other two, and tell the shader
  // which way is down from there.
  const turned = new Group()
  if (opts.axis === 'x') {
    turned.rotation.z = -Math.PI / 2
    uniforms.uGrav.value.set(1, 0, 0)
  } else if (opts.axis === 'z') {
    turned.rotation.x = Math.PI / 2
    uniforms.uGrav.value.set(0, 0, 1)
  }
  turned.add(strips)
  if (opts.drum !== false) {
    const drum = new Mesh(cylGeo(coreR, opts.length + 0.3, { bevel: 0.05 }), env.coreMat)
    drum.receiveShadow = true
    turned.add(drum)
  }
  root.add(turned)

  let spin = 0
  const rps = opts.rps ?? 0.9
  return {
    root,
    strips,
    setSpin(v) {
      spin = Math.min(1, Math.max(0, v))
      // Cloth flies out well before full speed.
      uniforms.uSpin.value = 1 - (1 - spin) * (1 - spin)
    },
    advance(dt) {
      uniforms.uAngle.value = (uniforms.uAngle.value + dt * spin * rps * Math.PI * 2 * uniforms.uDir.value) % (Math.PI * 2)
    },
    setContact(nx, ny, nz, d) {
      // Root space to the shader's space (the inverse of the turn above).
      const c = uniforms.uContact.value
      if (opts.axis === 'x') c.set(-ny, nx, nz, d)
      else if (opts.axis === 'z') c.set(nx, nz, -ny, d)
      else c.set(nx, ny, nz, d)
    },
    clearContact() {
      uniforms.uContact.value.w = 1e4
    },
    dispose() {
      mat.dispose()
      strips.dispose()
    },
  }
}
