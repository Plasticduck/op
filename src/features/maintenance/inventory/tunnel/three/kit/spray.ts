import { BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial, Sphere, Vector3 } from 'three'
import type { ColorRepresentation } from 'three'
import type { V3 } from './geometry'
import type { Palette } from './palette'
import { rng } from './textures'

// Water. Every arch and nozzle in the scene shares one material, and each drop's flight
// is worked out in the vertex shader from the shared clock, so spray costs one draw call
// per machine and nothing on the CPU. A drop in flight is drawn as a short streak along
// its path, a bright core inside a tinted rim: the rim shows on a light page, the core on
// a dark one. A few slow, wide, faint puffs among the drops give the spray its body.

export type SprayKind = 'fan' | 'jet' | 'mist' | 'foam'

export type Nozzle = {
  at: V3
  // Which way it points.
  dir: V3
  // For a fan: the direction the fan opens along. Default: up and down.
  across?: V3
}

export type SprayOpts = {
  // 'fan': a flat sheet from each nozzle. 'jet': a pencil-thin stream. 'mist': a slow
  // cloud. 'foam': fat white drops falling from a rain bar.
  kind: SprayKind
  nozzles: Nozzle[]
  // How far the water flies before it fades, in feet.
  reach: number
  // Half the angle of the fan or cone, radians.
  spread?: number
  perNozzle?: number
  // A color other than water (a pink wax, a blue soap).
  color?: ColorRepresentation
  // Length of a drop's streak (or width of a puff) in feet.
  size?: number
  seed?: number
}

export type Spray = {
  root: Points
  // 0 hides it, 1 is full flow: fewer drops are drawn in between.
  setActivity(v: number): void
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uMaxPx;
uniform float uAspect;
attribute vec3 aVel;
attribute vec4 aSeed;
attribute vec4 aLook;
attribute vec2 aStyle;
varying float vFade;
varying vec4 vLook;
varying vec3 vShape;
void main() {
  float age = fract(uTime / aSeed.y + aSeed.x);
  float tt = age * aSeed.y;
  vec3 p = position + aVel * tt;
  p.y -= 16.0 * aSeed.w * tt * tt;
  vec3 vel = aVel;
  vel.y -= 32.0 * aSeed.w * tt;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  // Drops that reach the floor stay on it for the rest of their life, as splash.
  float landed = step(wp.y, 0.04);
  wp.y = max(wp.y, 0.04);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  // Which way the drop is moving on screen, to draw it as a streak along that.
  vec4 ahead = projectionMatrix * viewMatrix * (wp + vec4(mat3(modelMatrix) * vel * 0.02, 0.0));
  vec2 dir = (ahead.xy / ahead.w - gl_Position.xy / gl_Position.w) * vec2(uAspect, 1.0);
  float dl = length(dir);
  // A drop right in front of the camera (the ride passes through the spray) would fill
  // the screen: cap its size and let it fade out as it gets close.
  float px = min(max(2.0, aSeed.z * uScale / -mv.z), uMaxPx);
  gl_PointSize = px;
  // Far away a streak would be thinner than a pixel: let it shorten into a dot.
  float stretch = mix(clamp(px / 1.6, 1.0, aStyle.y), 1.0, landed);
  vShape = vec3(dl > 1e-6 ? dir / dl : vec2(0.0, 1.0), stretch);
  vFade = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.6, 1.0, age)) * aStyle.x * (1.0 - landed * 0.4) * smoothstep(1.2, 4.5, -mv.z);
  vLook = aLook;
}
`

const FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uRim;
uniform float uOpacity;
varying float vFade;
varying vec4 vLook;
varying vec3 vShape;
void main() {
  vec2 pc = (gl_PointCoord - 0.5) * 2.0;
  pc.y = -pc.y;
  float along = dot(pc, vShape.xy);
  float across = dot(pc, vec2(-vShape.y, vShape.x)) * vShape.z;
  float d = length(vec2(along, across));
  if (d > 1.0) discard;
  float body = 1.0 - smoothstep(0.35, 1.0, d);
  vec3 water = mix(uRim, uCore, 1.0 - smoothstep(0.0, 0.8, d));
  vec3 col = mix(water, vLook.rgb, vLook.a);
  gl_FragColor = vec4(col, body * vFade * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export type SprayShared = {
  material: ShaderMaterial
  setTheme(p: Palette): void
  // Drop sizes are in feet: the shader needs the viewport to turn them into pixels.
  setViewport(heightPx: number, fovDeg: number, aspect: number): void
}

export function createSprayMaterial(time: { value: number }, palette: Palette): SprayShared {
  const uniforms = {
    uTime: time,
    uScale: { value: 1200 },
    uMaxPx: { value: 130 },
    uAspect: { value: 1.6 },
    uCore: { value: new Color(palette.waterCore) },
    uRim: { value: new Color(palette.waterRim) },
    uOpacity: { value: 0.9 },
  }
  const material = new ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: NormalBlending })
  material.name = 'spray'
  return {
    material,
    setTheme(p) {
      uniforms.uCore.value.set(p.waterCore)
      uniforms.uRim.value.set(p.waterRim)
    },
    setViewport(h, fov, aspect) {
      uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360))
      uniforms.uMaxPx.value = Math.max(48, h * 0.16)
      uniforms.uAspect.value = aspect
    },
  }
}

// size is a drop's streak length in feet (or a puff's width), stretch how many times
// longer than wide it is drawn, puffs the share of drops that are mist instead.
type Look = { per: number; spread: number; speed: number; size: number; stretch: number; gravity: number; alpha: number; puffs: number }
const LOOKS: Record<SprayKind, Look> = {
  fan: { per: 90, spread: 0.5, speed: 15, size: 0.5, stretch: 9, gravity: 0.5, alpha: 0.8, puffs: 0.12 },
  jet: { per: 56, spread: 0.035, speed: 30, size: 0.8, stretch: 13, gravity: 0.15, alpha: 0.9, puffs: 0.08 },
  mist: { per: 16, spread: 0.6, speed: 3.2, size: 1.3, stretch: 1, gravity: -0.012, alpha: 0.09, puffs: 0 },
  foam: { per: 34, spread: 0.12, speed: 2.4, size: 0.22, stretch: 1.5, gravity: 0.55, alpha: 0.92, puffs: 0 },
}

export function createSpray(opts: SprayOpts, shared: SprayShared, detail: 'high' | 'low'): Spray {
  const look = LOOKS[opts.kind]
  const per = Math.max(4, Math.round((opts.perNozzle ?? look.per) * (detail === 'low' ? 0.5 : 1)))
  const n = per * opts.nozzles.length
  const r = rng(opts.seed ?? 5)
  const spread = opts.spread ?? look.spread
  const size = opts.size ?? look.size
  const tint = opts.color != null ? new Color(opts.color) : opts.kind === 'foam' ? new Color('#ffffff') : null

  const pos = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  const seed = new Float32Array(n * 4)
  const lookAttr = new Float32Array(n * 4)
  const style = new Float32Array(n * 2)
  // Drops are stored in a shuffled order, so drawing the first half thins every nozzle
  // evenly instead of switching half the nozzles off.
  const order = Array.from({ length: n }, (_, k) => k)
  for (let k = n - 1; k > 0; k--) {
    const j = Math.floor(r() * (k + 1))
    const t = order[k]
    order[k] = order[j]
    order[j] = t
  }
  const d = new Vector3()
  const a = new Vector3()
  const b = new Vector3()
  const v = new Vector3()
  // The farthest a drop gets from its nozzle: the fastest, longest-lived one, plus how
  // far it falls (never farther than to the floor). The bounding sphere is sized from it.
  const life = opts.reach / look.speed
  const flight = opts.reach * 1.45 + Math.min(16 * Math.abs(look.gravity) * (life * 1.2) ** 2, 14)
  let far = 0
  let slot = 0
  for (const nz of opts.nozzles) {
    d.set(nz.dir[0], nz.dir[1], nz.dir[2]).normalize()
    if (nz.across) a.set(nz.across[0], nz.across[1], nz.across[2])
    else a.set(0, 1, 0)
    // Keep the fan's opening square to where the nozzle points.
    a.addScaledVector(d, -a.dot(d))
    if (a.lengthSq() < 1e-6) a.set(1, 0, 0).addScaledVector(d, -d.x)
    a.normalize()
    b.crossVectors(d, a)
    far = Math.max(far, Math.hypot(nz.at[0], nz.at[1], nz.at[2]) + flight)
    for (let k = 0; k < per; k++, slot++) {
      const i = order[slot]
      const puff = r() < look.puffs
      // A fan is wide one way and thin the other. Everything else is a cone.
      const wide = (r() * 2 - 1) * spread
      const thin = opts.kind === 'fan' ? (r() - 0.5) * 0.07 : (r() * 2 - 1) * spread
      const speed = look.speed * (0.82 + r() * 0.36) * (puff ? 0.4 : 1)
      v.copy(d).addScaledVector(a, Math.tan(wide)).addScaledVector(b, Math.tan(thin)).normalize().multiplyScalar(speed)
      pos[i * 3] = nz.at[0]
      pos[i * 3 + 1] = nz.at[1]
      pos[i * 3 + 2] = nz.at[2]
      vel[i * 3] = v.x
      vel[i * 3 + 1] = v.y
      vel[i * 3 + 2] = v.z
      seed[i * 4] = r()
      seed[i * 4 + 1] = life * (0.8 + r() * 0.4) * (puff ? 1.6 : 1)
      seed[i * 4 + 2] = puff ? 0.7 + r() * 0.7 : size * (0.6 + r() * 0.9)
      seed[i * 4 + 3] = puff ? look.gravity * 0.15 : look.gravity
      if (tint) {
        lookAttr[i * 4] = tint.r
        lookAttr[i * 4 + 1] = tint.g
        lookAttr[i * 4 + 2] = tint.b
        lookAttr[i * 4 + 3] = opts.kind === 'foam' && opts.color == null ? 0.82 : 0.9
      }
      style[i * 2] = puff ? 0.025 + r() * 0.035 : look.alpha * (0.6 + r() * 0.4)
      style[i * 2 + 1] = puff ? 1 : look.stretch
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('aVel', new BufferAttribute(vel, 3))
  geo.setAttribute('aSeed', new BufferAttribute(seed, 4))
  geo.setAttribute('aLook', new BufferAttribute(lookAttr, 4))
  geo.setAttribute('aStyle', new BufferAttribute(style, 2))
  geo.boundingSphere = new Sphere(new Vector3(), far)
  geo.setDrawRange(0, 0)

  const root = new Points(geo, shared.material)
  root.name = 'spray'
  root.userData.fx = true
  root.visible = false
  return {
    root,
    setActivity(val) {
      const count = Math.round(n * Math.min(1, Math.max(0, val)))
      root.visible = count > 0
      geo.setDrawRange(0, count)
    },
  }
}
