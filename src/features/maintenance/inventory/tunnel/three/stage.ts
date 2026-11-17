import { Color, DirectionalLight, Fog, Group, MathUtils, Matrix4, MOUSE, NeutralToneMapping, PCFShadowMap, PerspectiveCamera, PMREMGenerator, Scene, Timer, Vector3, WebGLRenderer } from 'three'
import type { Mesh, WebGLRenderTarget } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildFloor, SLAB_THICKNESS } from './floor'
import type { Bounds, Floor, FloorLayout } from './floor'
import { createKit, KEY_DIR, LAYER, RIM_DIR } from './kit'
import type { Kit } from './kit'
import type { CameraPose, CameraPreset, Inset, ThemeName } from './types'

// The stage: the renderer, the camera and its controls, the light, the slab, and the
// loop that decides when a frame is drawn. It knows nothing about machines. TunnelScene
// puts them on it; the dev gallery puts one model on it.
//
// Frames are drawn on demand. invalidate() asks for one; the loop keeps going only
// while the tick says something is still moving or the camera is still gliding, and it
// stops altogether when the tab is hidden or the canvas is off screen.
//
// createStage throws if the browser can't give it WebGL2, leaving nothing behind.

export type StageLayout = FloorLayout & {
  // The tallest thing on the slab, for fitting the camera and the shadow.
  height: number
}

export type StageOptions = {
  theme: ThemeName
  detail?: 'high' | 'low'
  // WebGL was lost and didn't come back.
  onLost?: () => void
}

export type Stage = {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly controls: OrbitControls
  readonly dom: HTMLCanvasElement
  readonly kit: Kit
  readonly detail: 'high' | 'low'
  // Models go in world. Pads, rulers and the like go in overlay.
  readonly world: Group
  readonly overlay: Group
  readonly layout: StageLayout | null
  // Everything the floor covers: the tunnel's slab and every pad beside it.
  readonly bounds: Bounds
  setLayout(l: StageLayout): void
  setTheme(theme: ThemeName): void
  // Where a preset puts the camera for the current drawing and canvas shape. az (degrees,
  // as in fitPose) sees the overview or the top view from another angle, fitted for it:
  // the showroom's turn. The entrance is one fixed pose and ignores it.
  presetPose(p: CameraPreset, az?: number): CameraPose
  // A pose looking from the given angles (degrees: az swings from the passenger side
  // toward the entrance, el is up from the floor), backed off until the box fits.
  fitPose(az: number, el: number, box?: { min: [number, number, number]; max: [number, number, number] }, margin?: number): CameraPose
  // The fitted overview's distance: the scale the zoom limits and fog are set from.
  readonly reach: number
  // The canvas edges the widget's HTML covers, in CSS pixels (see freeArea for what is made
  // of odd values). The picture is shifted so the camera looks at the middle of what is
  // left, and fitPose and presetPose fit into it. Applied at once: easing is the caller's.
  setInset(inset: Inset): void
  // How much of the canvas's height the free area offers a picture (1: all of it), for the
  // given inset or the current one: what a view sized by the canvas height is scaled by.
  fill(inset?: Inset): number
  invalidate(): void
  refreshShadows(): void
  // Compiles the shaders of whatever is in the scene now without blocking the page, and
  // draws nothing until they're ready. Call after adding models or new materials.
  compile(): Promise<void>
  // Called at the start of each frame with seconds since the last one. Return true to
  // keep the loop running.
  setTick(fn: ((dt: number, now: number) => boolean) | null): void
  setAfterRender(fn: (() => void) | null): void
  // Called when the canvas changes size, after the camera has its new shape.
  setOnResize(fn: (() => void) | null): void
  // How many frames have been drawn, and what the last one cost: its main pass, without
  // the shadow map it may have redrawn, so the numbers are the steady state's.
  frames(): number
  stats(): { calls: number; triangles: number; frameMs: number; frames: number; pixelRatio: number }
  size(): { w: number; h: number }
  dispose(): void
}

const FOV = 30
const UP = new Vector3(0, 1, 0)
// A run of frames slower than this (ms apart, on average) lowers the pixel ratio a step.
const SLOW_MS = 26
const SLOW_RUN = 30
// A step is kept only once a run after it comes at least this much faster than the run
// before the first step: frames paced by something other than pixels (a 30 Hz cap, the
// CPU) never do, and the steps are undone.
const STEP_GAIN = 0.9
// Frames this far apart mean they stopped (a hidden tab, the canvas scrolled away), not a
// slow frame: a step waiting to be judged would then be judged on other frames.
const STOPPED_MS = 1000
// Whatever the widget says its HTML covers, at least this share of the canvas stays free
// each way: a picture fitted into nothing would be backed off to infinity.
const MIN_FREE = 0.4

// An inset as numbers the camera can use: negative or NaN is none, Infinity is a lot.
export function cleanInset(i: Inset): Inset {
  const v = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : n > 0 ? 1e6 : 0)
  return { top: v(i.top), right: v(i.right), bottom: v(i.bottom), left: v(i.left) }
}

// The inset as the camera applies it to a canvas w by h (CSS pixels): cleaned, and where
// two opposite edges together leave less than MIN_FREE, both shrunk in proportion.
export function freeArea(i: Inset, w: number, h: number): Inset {
  const c = cleanInset(i)
  const fit = (a: number, b: number, size: number): [number, number] => {
    const most = Math.max(0, size) * (1 - MIN_FREE)
    return a + b > most ? [(a * most) / (a + b), (b * most) / (a + b)] : [a, b]
  }
  const [left, right] = fit(c.left, c.right, w)
  const [top, bottom] = fit(c.top, c.bottom, h)
  return { top, right, bottom, left }
}

// True if this browser can run the 3D tunnel at all. Cheap: asks for a context on a
// scratch canvas and lets go of it.
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!gl
  } catch {
    return false
  }
}

function autoDetail(): 'high' | 'low' {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return coarse || (mem != null && mem <= 4) ? 'low' : 'high'
}

export function createStage(container: HTMLElement, opts: StageOptions): Stage {
  const detail = opts.detail ?? autoDetail()
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  let theme = opts.theme
  let disposed = false

  const canvas = document.createElement('canvas')
  // Hidden until the first frame is in it: an empty WebGL canvas is a black rectangle.
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none;opacity:0'
  // The scene is a picture to assistive tech: the page offers buttons and a list instead.
  canvas.setAttribute('aria-hidden', 'true')
  container.appendChild(canvas)
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  } catch (e) {
    canvas.remove()
    throw e
  }
  // ACES dulls the safety yellow and the cloth blue: Neutral keeps them.
  renderer.toneMapping = NeutralToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  // The shadow map is drawn when something that casts moves, not every frame.
  renderer.shadowMap.autoUpdate = false
  // It is drawn inside render(), into the same counters as the frame. stats() is what a
  // frame costs at rest, the main pass alone, so the shadow pass is counted on its own
  // and taken off. Set up again when a lost context comes back: three makes a new
  // shadow map then.
  const shadowPass = { calls: 0, triangles: 0, ms: 0 }
  let counted: object | null = null
  const countShadowPass = () => {
    const shadowMap = renderer.shadowMap
    if (shadowMap === counted) return
    counted = shadowMap
    const draw = shadowMap.render.bind(shadowMap)
    shadowMap.render = (lights, s, c) => {
      const info = renderer.info.render
      const calls = info.calls
      const triangles = info.triangles
      const t0 = performance.now()
      draw(lights, s, c)
      shadowPass.calls += info.calls - calls
      shadowPass.triangles += info.triangles - triangles
      shadowPass.ms += performance.now() - t0
    }
  }
  countShadowPass()
  // The most pixels per CSS pixel we'll draw. A run of slow frames lowers it, for good
  // once a step has shown it helps.
  let cap = coarse ? 1.5 : 2
  let pixelRatio = Math.min(window.devicePixelRatio || 1, cap)
  renderer.setPixelRatio(pixelRatio)

  const kit = createKit({ theme, detail })
  const scene = new Scene()
  const camera = new PerspectiveCamera(FOV, 1, 1, 4000)
  camera.position.set(-60, 60, 120)
  const world = new Group()
  world.name = 'world'
  const overlay = new Group()
  overlay.name = 'overlay'
  scene.add(world, overlay, kit.blobMesh)

  // ---- Light ----
  let envRT: WebGLRenderTarget | null = null
  const makeEnvironment = (afterLoss = false) => {
    // After a lost context the old target is already gone with it.
    if (!afterLoss) envRT?.dispose()
    const pmrem = new PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    envRT = pmrem.fromScene(room, 0.04)
    scene.environment = envRT.texture
    kit.setEnvironment(envRT.texture)
    room.dispose()
    pmrem.dispose()
  }
  // The key comes over the viewer's left shoulder, warm, so the faces toward the
  // default camera are lit and shadows fall away behind. The rim is cool, low and from
  // behind. Both stand where kit/palette.ts says (contact shadows lean by the same numbers).
  const key = new DirectionalLight('#ffffff', 2)
  key.castShadow = true
  // 2048 is about an inch a texel over a whole tunnel. A 4096 map would be sharper but
  // takes over 100 MB of GPU memory with its depth texture.
  const shadowSize = detail === 'low' ? 1024 : 2048
  key.shadow.mapSize.set(shadowSize, shadowSize)
  key.shadow.bias = -0.0004
  key.shadow.normalBias = shadowSize >= 2048 ? 0.05 : 0.1
  // Wider and the five-tap filter shows as grain on pale paint.
  key.shadow.radius = 2.2
  // Shadow-only stand-ins (kit.shadowOnly) live on their own layer: the light sees them,
  // the camera doesn't.
  key.shadow.camera.layers.enable(LAYER.shadow)
  const rim = new DirectionalLight('#ffffff', 0.6)
  scene.add(key, key.target, rim, rim.target)
  const fog = new Fog('#ffffff', 100, 1000)
  scene.fog = fog
  const backdrop = new Color()
  scene.background = backdrop

  const applyTheme = () => {
    const p = kit.palette
    backdrop.set(p.backdrop)
    fog.color.set(p.backdrop)
    key.color.set(p.key)
    key.intensity = p.keyIntensity
    key.shadow.intensity = p.shadow
    rim.color.set(p.rim)
    rim.intensity = p.rimIntensity
    scene.environmentIntensity = p.env
    renderer.toneMappingExposure = p.exposure
    renderer.setClearColor(backdrop, 1)
  }
  applyTheme()

  // ---- Camera ----
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minPolarAngle = MathUtils.degToRad(5)
  controls.maxPolarAngle = MathUtils.degToRad(85)
  controls.minDistance = 12
  controls.screenSpacePanning = false
  // Holding the middle button slides the view over the floor, as in most 3D programs
  // (OrbitControls' own default there is a zoom, which the wheel already does). The right
  // button, and Ctrl, Cmd or Shift with the left, slide it too. interaction.ts keeps the
  // browser's middle-click autoscroll off the canvas.
  controls.mouseButtons.MIDDLE = MOUSE.PAN
  controls.rotateSpeed = 0.7
  controls.zoomSpeed = 0.9

  let layout: StageLayout | null = null
  let floor: Floor | null = null
  let reach = 200
  let bounds: Bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  // What the widget's HTML covers, as asked (cleaned), and as applied to this canvas.
  let inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 }
  let free: Inset = inset

  // Shifts the picture so the camera's line of sight lands in the middle of the free area.
  // The full view stays the canvas's own size, so pixels per foot, picking and pins (they go
  // through the projection matrix) and the drawing buffer's pixel ratio are untouched by it.
  const applyView = () => {
    free = freeArea(inset, w, h)
    if (w > 0 && h > 0 && (free.top || free.right || free.bottom || free.left)) camera.setViewOffset(w, h, (free.right - free.left) / 2, (free.bottom - free.top) / 2, w, h)
    else camera.clearViewOffset()
  }
  // The share of the canvas height a picture sized by height gets in the free area. A free
  // area narrower than it is tall counts by its width, measured as a portrait canvas's
  // width is: with no inset this is 1 on any canvas.
  const fillOf = (f: Inset) => {
    if (!w || !h) return 1
    return MathUtils.clamp(Math.min(h - f.top - f.bottom, (w - f.left - f.right) * Math.max(1, h / w)) / h, MIN_FREE, 1)
  }

  const _dir = new Vector3()
  const _right = new Vector3()
  const _up = new Vector3()
  const _flat = new Vector3()
  const _rel = new Vector3()
  const _target = new Vector3()

  // fitPose for a given field of view: the camera's, or the stage's own (see fitLimits).
  const fitAt = (fov: number, az: number, el: number, box?: Parameters<Stage['fitPose']>[2], margin = 1.07): CameraPose => {
    const a = MathUtils.degToRad(az)
    const e = MathUtils.degToRad(el)
    const b = box ?? { min: [bounds.minX, 0, bounds.minZ], max: [bounds.maxX, layout?.height ?? 10, bounds.maxZ] }
    // From the target back to the camera.
    _dir.set(-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
    _right.crossVectors(UP, _dir).normalize()
    _up.crossVectors(_dir, _right)
    _flat.set(-_dir.x, 0, -_dir.z).normalize()
    _target.set((b.min[0] + b.max[0]) / 2, Math.min(3, b.max[1] * 0.3), (b.min[2] + b.max[2]) / 2)
    // Into the free area: the line of sight already lands in its middle (applyView), so the
    // view to fit is the canvas's, cut down to the free share each way.
    const tan = Math.tan(MathUtils.degToRad(fov / 2)) / margin
    const tanV = tan * (h ? (h - free.top - free.bottom) / h : 1)
    const tanH = tan * camera.aspect * (w ? (w - free.left - free.right) / w : 1)
    let dist = 10
    // Back off until every corner is inside the view, then slide the target so the
    // drawing sits in the middle of it. A few rounds settle it.
    for (let round = 0; round < 5; round++) {
      dist = 0
      for (let k = 0; k < 8; k++) {
        _rel.set(k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]).sub(_target)
        const depth = -_rel.dot(_dir)
        dist = Math.max(dist, Math.abs(_rel.dot(_right)) / tanH - depth, Math.abs(_rel.dot(_up)) / tanV - depth)
      }
      let minU = Infinity
      let maxU = -Infinity
      let minV = Infinity
      let maxV = -Infinity
      for (let k = 0; k < 8; k++) {
        _rel.set(k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]).sub(_target)
        const depth = dist - _rel.dot(_dir)
        const u = _rel.dot(_right) / (depth * tanH)
        const v = _rel.dot(_up) / (depth * tanV)
        minU = Math.min(minU, u)
        maxU = Math.max(maxU, u)
        minV = Math.min(minV, v)
        maxV = Math.max(maxV, v)
      }
      _target.addScaledVector(_right, ((minU + maxU) / 2) * dist * tanH)
      _target.addScaledVector(_flat, (((minV + maxV) / 2) * dist * tanV) / Math.max(0.3, Math.sin(e)))
    }
    return {
      position: [_target.x + _dir.x * dist, _target.y + _dir.y * dist, _target.z + _dir.z * dist],
      target: [_target.x, _target.y, _target.z],
    }
  }
  const fitPose: Stage['fitPose'] = (az, el, box, margin) => fitAt(camera.fov, az, el, box, margin)

  // The overview: from the passenger side, swung toward the entrance. On an upright
  // phone it swings further and looks down the tunnel, or the tunnel is a thin strip
  // across the middle of a tall canvas. Which way it (and the top view) faces follows the
  // canvas, not the free area: a card coming and going must not swing the drawing round.
  const overviewPose = (fov = camera.fov, az?: number): CameraPose => {
    const upright = MathUtils.clamp((1.3 - camera.aspect) / 0.7, 0, 1)
    return fitAt(fov, az ?? 35 + 41 * upright, 28 + 8 * upright)
  }

  const presetPose = (p: CameraPreset, az?: number): CameraPose => {
    // From above the entrance is on the left; on an upright phone it's at the top with
    // the driver's side on the right, as the 2D diagram draws it there.
    if (p === 'top') return fitPose(az ?? (camera.aspect < 0.8 ? -90 : 0), 85)
    if (p === 'entrance' && layout) {
      // Standing in the prep lane, a little to the passenger side, looking down the tunnel.
      // A smaller free area sees the same view from as much further back.
      const back = Math.max(30, layout.width * 2.1)
      const target: [number, number, number] = [Math.min(layout.length * 0.3, 40), 1.6, -0.8]
      const position: [number, number, number] = [-back, 12.5, layout.width * 0.9]
      const k = 1 / fillOf(free)
      if (k !== 1) for (let a = 0; a < 3; a++) position[a] = target[a] + (position[a] - target[a]) * k
      return { position, target }
    }
    return overviewPose(camera.fov, az)
  }

  // ---- Shadow ----
  const _look = new Matrix4()
  const _corner = new Vector3()
  const fitShadow = () => {
    const h = (layout?.height ?? 12) + 1
    const cx = (bounds.minX + bounds.maxX) / 2
    const cz = (bounds.minZ + bounds.maxZ) / 2
    const far = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
    key.target.position.set(cx, 0, cz)
    key.position.set(cx + KEY_DIR[0] * far, KEY_DIR[1] * far, cz + KEY_DIR[2] * far)
    rim.target.position.set(cx, 0, cz)
    rim.position.set(cx + RIM_DIR[0] * far, RIM_DIR[1] * far, cz + RIM_DIR[2] * far)
    key.updateMatrixWorld()
    key.target.updateMatrixWorld()
    // The light's view of the drawing: fit the shadow camera to exactly that box, so
    // every texel of the map lands on the slab.
    _look.lookAt(key.position, key.target.position, UP).setPosition(key.position).invert()
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let k = 0; k < 8; k++) {
      _corner.set(k & 1 ? bounds.maxX + 1 : bounds.minX - 1, k & 2 ? h : -SLAB_THICKNESS, k & 4 ? bounds.maxZ + 1 : bounds.minZ - 1).applyMatrix4(_look)
      minX = Math.min(minX, _corner.x)
      maxX = Math.max(maxX, _corner.x)
      minY = Math.min(minY, _corner.y)
      maxY = Math.max(maxY, _corner.y)
      minZ = Math.min(minZ, _corner.z)
      maxZ = Math.max(maxZ, _corner.z)
    }
    const c = key.shadow.camera
    c.left = minX
    c.right = maxX
    c.bottom = minY
    c.top = maxY
    c.near = Math.max(1, -maxZ - 2)
    c.far = -minZ + 2
    c.updateProjectionMatrix()
  }

  let shadowDirty = true
  const refreshShadows = () => {
    shadowDirty = true
    invalidate()
  }

  // How far out the camera may go, and how deep it sees, follow from the distance the
  // overview needs: that depends on the drawing and on the canvas's shape. Always at the
  // stage's own field of view: a resize during the ride's wider one would otherwise pull
  // the limits and the fog in by half, and nothing refits them after it.
  const fitLimits = () => {
    const pose = overviewPose(FOV)
    reach = Math.hypot(pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2])
    controls.maxDistance = reach * 2.2
    camera.far = reach * 12
    camera.near = Math.max(0.5, reach / 400)
    camera.updateProjectionMatrix()
  }

  const setLayout = (l: StageLayout) => {
    layout = l
    bounds = { ...l.box }
    for (const pad of l.pads ?? []) {
      bounds.minX = Math.min(bounds.minX, pad.minX)
      bounds.maxX = Math.max(bounds.maxX, pad.maxX)
      bounds.minZ = Math.min(bounds.minZ, pad.minZ)
      bounds.maxZ = Math.max(bounds.maxZ, pad.maxZ)
    }
    if (floor) {
      scene.remove(floor.group)
      floor.dispose()
    }
    floor = buildFloor(kit, l)
    kit.setFloor([l.box, ...(l.pads ?? [])])
    floor.setViewport(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio))
    scene.add(floor.group)
    fitLimits()
    fitShadow()
    refreshShadows()
  }

  // Keep the point the camera circles inside the drawing, so it can't be lost.
  const _before = new Vector3()
  const _back = new Vector3()
  controls.addEventListener('change', () => {
    const t = controls.target
    _before.copy(t)
    t.x = MathUtils.clamp(t.x, bounds.minX, bounds.maxX)
    t.z = MathUtils.clamp(t.z, bounds.minZ, bounds.maxZ)
    t.y = MathUtils.clamp(t.y, 0, (layout?.height ?? 12) + 2)
    if (!_before.equals(t)) camera.position.add(_before.sub(t).negate())
    // OrbitControls works the distance out from the position on every update. At a zoom
    // limit it can come out a hair past it: the clamp then counts as a zoom, and it
    // reports a change on every frame for good, so the loop never idles and the camera
    // never comes to rest. A hair inside the limits there's nothing to clamp. (Along the
    // camera's own line of sight, so it still looks where it did.)
    _back.copy(camera.position).sub(t)
    const d = _back.length()
    const near = controls.minDistance * (1 + 1e-9)
    const far = controls.maxDistance * (1 - 1e-9)
    if (d > 0 && d < near) camera.position.copy(t).addScaledVector(_back, near / d)
    else if (d > far) camera.position.copy(t).addScaledVector(_back, far / d)
    invalidate()
  })

  // ---- The loop ----
  const timer = new Timer()
  timer.connect(document)
  let raf = 0
  let dirty = true
  let lost = false
  let onScreen = true
  // Shaders are compiling: nothing is drawn until they're ready.
  let holds = 0
  let tick: ((dt: number, now: number) => boolean) | null = null
  // The tick is running: this frame is drawn after it anyway.
  let ticking = false
  let afterRender: (() => void) | null = null
  let onResize: (() => void) | null = null
  let frameCount = 0
  let lastStats = { calls: 0, triangles: 0, frameMs: 0 }
  let w = 0
  let h = 0
  // For spotting a slow GPU: when the last busy frame was drawn, and the run so far.
  // Nothing is counted until the scene has been up for a moment: the first frames
  // upload everything and redraw the shadows as the machines drop in.
  let lastBusyAt = 0
  let slowSum = 0
  let slowN = 0
  let measureFrom = Infinity
  // A step down is a trial, judged on the run after it: how slow the run before the first
  // step was, the cap to go back to, and whether the frames stopped (the scene went still,
  // the tab was hidden) before a run could judge it. Such a step is undone unjudged.
  let trial: { avg: number; cap: number; stopped: boolean } | null = null
  // Off once even the fewest pixels made no difference: they aren't what sets the pace here.
  let stepping = true
  const timers = new Set<number>()

  // Nothing is drawn before there is a floor to draw.
  const canRun = () => !disposed && !lost && !holds && !!layout && onScreen && document.visibilityState !== 'hidden' && w > 0 && h > 0

  function invalidate() {
    dirty = true
    // Asked for during the tick (a stack light that just changed), this very frame is
    // drawn: asking for another would only run the tick again for nothing.
    if (!raf && !ticking && canRun()) raf = requestAnimationFrame(frame)
  }

  const render = () => {
    const t0 = performance.now()
    // Fog thickens with distance from wherever the camera is, so zooming out never
    // washes the slab out.
    const d = camera.position.distanceTo(controls.target)
    fog.near = d * 0.9
    fog.far = d * 0.9 + reach * 4.5
    scene.updateMatrixWorld()
    kit.syncBlobs()
    if (shadowDirty) {
      renderer.shadowMap.needsUpdate = true
      shadowDirty = false
    }
    shadowPass.calls = 0
    shadowPass.triangles = 0
    shadowPass.ms = 0
    renderer.render(scene, camera)
    const calls = renderer.info.render.calls - shadowPass.calls
    const triangles = renderer.info.render.triangles - shadowPass.triangles
    if (!frameCount) {
      canvas.style.opacity = '1'
      measureFrom = t0 + 2500
    }
    frameCount++
    afterRender?.()
    lastStats = { calls, triangles, frameMs: performance.now() - t0 - shadowPass.ms }
  }

  // Building the environment map compiles shaders of its own and blocks for a moment:
  // it gets a task to itself, right after the stage is made, so the page can paint in
  // between. Nothing is drawn or compiled before it's there (shaders depend on it).
  holds++
  const environment = new Promise<void>((resolve) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      if (!disposed && !lost) makeEnvironment()
      holds = Math.max(0, holds - 1)
      resolve()
      if (!holds) invalidate()
    }, 0)
    timers.add(id)
  })

  const compileNow = (): Promise<void> => {
    if (disposed || lost) return Promise.resolve()
    holds++
    let done = false
    const release = () => {
      if (done) return
      done = true
      clearTimeout(giveUp)
      timers.delete(giveUp)
      holds = Math.max(0, holds - 1)
      if (!holds) invalidate()
    }
    // Should the driver never report back, draw anyway (and compile the old, blocking way).
    const giveUp = window.setTimeout(release, 4000)
    timers.add(giveUp)
    scene.updateMatrixWorld()
    return renderer.compileAsync(scene, camera).then(release, release)
  }
  const compile = (): Promise<void> => environment.then(compileNow)

  const setCap = (next: number, now: number) => {
    cap = next
    resize(true)
    // The frames right after a resize are slow in any case: the next run starts after them.
    measureFrom = now + 300
  }

  function frame(now: number) {
    raf = 0
    if (!canRun()) return
    // The media query below can miss a change of pixel ratio (a browser zoom on some
    // browsers): catch it here, on the next frame anything asks for.
    if (Math.min(window.devicePixelRatio || 1, cap) !== pixelRatio) resize()
    timer.update(now)
    const dt = Math.min(timer.getDelta(), 0.05)
    let busy: boolean
    ticking = true
    try {
      busy = tick ? tick(dt, now) : false
    } finally {
      ticking = false
    }
    const gliding = controls.enabled ? controls.update(dt) : false
    if (dirty || busy || gliding) {
      dirty = false
      render()
    }
    if (busy || gliding) {
      // A slow GPU shows as animation frames arriving far apart (the time spent inside
      // render() says nothing: the GPU works after it returns). Averaged over a run of
      // frames in a row, so one hiccup doesn't count.
      const gap = now - lastBusyAt
      if (trial && lastBusyAt && gap >= STOPPED_MS) trial.stopped = true
      if (lastBusyAt && gap < 250 && now > measureFrom) {
        if (trial?.stopped) {
          setCap(trial.cap, now)
          trial = null
        } else {
          slowSum += gap
          if (++slowN >= SLOW_RUN) {
            const avg = slowSum / slowN
            slowSum = 0
            slowN = 0
            if (trial) {
              // A GPU short of fill rate draws fewer pixels faster, but where frames wait
              // for vsync a frame only comes sooner once it fits a shorter slot: one step
              // may show nothing and the next one a lot. So a step that shows nothing
              // leads to the next, judged against the run before the first, and only when
              // even ratio 1 comes no faster is the pace set by something else: a 30 Hz
              // cap (Low Power Mode, Energy Saver, a 30 Hz display) or the CPU. Then the
              // sharpness goes back and stepping stops.
              if (avg <= trial.avg * STEP_GAIN) trial = null
              else if (pixelRatio > 1) setCap(Math.max(1, pixelRatio - 0.25), now)
              else {
                stepping = false
                setCap(trial.cap, now)
                trial = null
              }
            } else if (stepping && avg > SLOW_MS && pixelRatio > 1) {
              trial = { avg, cap, stopped: false }
              setCap(Math.max(1, pixelRatio - 0.25), now)
            }
          }
        }
      } else {
        slowSum = 0
        slowN = 0
      }
      lastBusyAt = now
      if (!raf) raf = requestAnimationFrame(frame)
    } else {
      lastBusyAt = 0
      if (trial) trial.stopped = true
    }
  }

  // ---- Size and visibility ----
  function resize(force = false) {
    const nw = container.clientWidth
    const nh = container.clientHeight
    // The window may have moved to another screen, or the page been zoomed.
    const ratio = Math.min(window.devicePixelRatio || 1, cap)
    if (!force && nw === w && nh === h && ratio === pixelRatio) return
    w = nw
    h = nh
    if (ratio !== pixelRatio) {
      pixelRatio = ratio
      renderer.setPixelRatio(ratio)
    }
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // The offset is in CSS pixels of this canvas: set again for its new size.
    applyView()
    if (layout) fitLimits()
    kit.setViewport(h * pixelRatio, camera.fov, w / h)
    floor?.setViewport(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio))
    onResize?.()
    // Sizing the canvas wipes it. Draw again now, in the same task: waiting for the next
    // animation frame would put a blank frame on screen at every step of a resize.
    if (frameCount > 0 && canRun()) {
      dirty = false
      render()
    } else {
      if (frameCount > 0 && !lost && !disposed) renderer.clear()
      invalidate()
    }
  }
  const ro = new ResizeObserver(() => resize())
  ro.observe(container)
  const io = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting
    if (onScreen) invalidate()
  })
  io.observe(container)
  const onVisibility = () => { if (document.visibilityState !== 'hidden') invalidate() }
  document.addEventListener('visibilitychange', onVisibility)
  // A change of device pixel ratio fires no resize: watch for it. The query matches
  // only the current ratio, so it has to be set up again each time it changes.
  let dprQuery: MediaQueryList | null = null
  const onDpr = () => {
    watchDpr()
    resize()
  }
  function watchDpr() {
    dprQuery?.removeEventListener('change', onDpr)
    dprQuery = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null
    dprQuery?.addEventListener('change', onDpr)
  }
  watchDpr()
  resize(true)

  // ---- Losing the GPU ----
  let lostTimer = 0
  const onContextLost = (e: Event) => {
    // Without this the browser never tries to give the context back.
    e.preventDefault()
    lost = true
    holds = 0
    cancelAnimationFrame(raf)
    raf = 0
    lostTimer = window.setTimeout(() => { if (lost && !disposed) opts.onLost?.() }, 3000)
  }
  const onContextRestored = () => {
    clearTimeout(lostTimer)
    lost = false
    // Everything three uploaded comes back by itself except what was rendered to a
    // texture: the environment and the shadow map.
    makeEnvironment(true)
    countShadowPass()
    refreshShadows()
  }
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)

  return {
    renderer, scene, camera, controls, dom: canvas, kit, detail, world, overlay,
    get layout() { return layout },
    get bounds() { return bounds },
    get reach() { return reach },
    setLayout,
    setTheme(next) {
      if (next === theme) return
      theme = next
      kit.setTheme(next)
      applyTheme()
      // The ground and the paint are drawn in the theme's colors: remake them.
      if (layout) setLayout(layout)
      refreshShadows()
    },
    presetPose,
    fitPose,
    setInset(next) {
      const c = cleanInset(next)
      if (c.top === inset.top && c.right === inset.right && c.bottom === inset.bottom && c.left === inset.left) return
      inset = c
      applyView()
      // The zoom limits and the fog follow the overview, which is fitted into the free area.
      if (layout) fitLimits()
      invalidate()
    },
    fill: (i) => fillOf(i ? freeArea(i, w, h) : free),
    invalidate,
    refreshShadows,
    compile,
    setTick(fn) { tick = fn },
    setAfterRender(fn) { afterRender = fn },
    setOnResize(fn) { onResize = fn },
    frames: () => frameCount,
    stats: () => ({ ...lastStats, frames: frameCount, pixelRatio }),
    size: () => ({ w, h }),
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      clearTimeout(lostTimer)
      for (const id of timers) clearTimeout(id)
      timers.clear()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      dprQuery?.removeEventListener('change', onDpr)
      // Before forcing the context away below, or that would look like a real loss.
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      controls.dispose()
      timer.dispose()
      floor?.dispose()
      // Whatever is still on the stage: geometry is owned by whoever made the mesh,
      // except the kit's shared shapes, which the kit frees.
      scene.traverse((o) => {
        const m = o as Mesh
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose()
        const sk = (o as { skeleton?: { dispose(): void } }).skeleton
        if (sk) sk.dispose()
      })
      key.shadow.dispose()
      key.dispose()
      rim.dispose()
      envRT?.dispose()
      kit.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
