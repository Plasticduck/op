import { Box3, MeshBasicMaterial } from 'three'
import type { Mesh, Object3D } from 'three'
import type { TunnelSide } from '@/lib/queries/miTunnel'
import { expressTemplate } from '../../expressTemplate'
import { shapeFor } from '../../shapes'
import { CAR } from '../car'
import { LAYER } from '../kit'
import { activityAt } from '../life'
import { buildModel } from '../models'
import { createStage, freeArea } from '../stage'
import { createTunnelScene } from '../TunnelScene'
import type { CameraPreset, ColorBy, Inset, RunState, SceneEvents, ThemeName, TunnelSceneApi } from '../types'
import { createVehicle } from '../vehicle'
import type { CarState } from '../vehicle'
import { sampleTunnel } from './fixtures'
import type { Fixture } from './fixtures'
import { kitSampler } from './sampler'

// The 3D tunnel's dev preview: http://localhost:5199/dev/tunnel3d.html (npx vite --port
// 5199 --strictPort). No sign-in, sample data. Screenshot it with
//   node scripts/tunnel3d-shot.mjs --out shot.png --q "<query>"
//
// THE WHOLE TUNNEL (default). Query parameters:
//   theme=light|dark      default: the system's
//   colorBy=status|usage|wos|sticker
//   mode=preview          the showroom (everything runs, nothing selectable, slow turn)
//   cam=overview|entrance|top
//   pose=px,py,pz,tx,ty,tz   camera position and target, in feet
//   t=<seconds>           jump scene time to t and hold there (repeatable shots: the car
//                         is at about -23 + 3.6 t ft; t=14.5 puts it in the first wraps)
//   play=0                start paused
//   select=<label>        select the item with this label, e.g. select=Wrap%20DS1
//   hover=<label>         light it as if hovered
//   fly=<label>           glide the camera to it
//   ride=1                the ride-through camera
//   move=1                move mode on
//   detail=low            the phone quality tier
//   linked=0              no machines linked (every shape a ghost)
//   strict=1              mount, dispose, mount again, as React StrictMode does in dev
//
// ONE MODEL (kind=<kind>): the model alone on a bare slab.
//   kind=wrap             any kind from shapes.tsx. kind=_kit shows the whole kit instead:
//                         every material, shape, brush and spray (dev/sampler.ts)
//   label= match=         the item's label and match type. Either one left out comes from
//                         the template's first row of that kind, even when the other is
//                         given: label= alone keeps that row's match, so
//                         kind=equipment&label=Customer%20Air is built with the match of
//                         the first equipment row (Hydra Flex). Add match= with nothing
//                         after it for none.
//   w= h= side= y=        footprint (ft), side (ds|ps|center|both|outside), where it sits
//                         across the tunnel. Defaults come from the express template.
//   rot=0|90|180|270      the shape's rotation, handled as the scene does: in the tunnel
//                         w and h swap and the model isn't turned; outside it is turned
//   tall=1                props.tall
//   run=0|1               RunState.running (default 1)
//   activity=0..1         RunState.activity (default: 1, or what the scene would work out
//                         from the car when carDx or pass is given)
//   carDx=<feet>          put the demo car there and pass it to the model
//   pass=1                the car drives past on a loop, activity as the scene works it out
//   t=<seconds>           hold at that moment (with pass=1: where the car is in its loop)
//   az= el=               camera angles in degrees (az: from the passenger side toward
//                         the entrance; el: up from the floor). zoom= backs off (>1) or closes in.
//   pose=px,py,pz,tx,ty,tz   or put the camera exactly
//
//   picks=1               draw the pick shapes
//
// BOTH: hud=1 shows draw calls and frames drawn.
//   inset=t,r,b,l         the canvas edges the widget's HTML would cover, in CSS pixels
//                         (TunnelSceneApi.setInset, Stage.setInset), e.g. inset=60,0,0,380.
//                         A dashed outline shows the free area as the camera applies it
//                         (clamped to the canvas), with a cross at its middle.
//
// window.__t3d = { ready, scene, stage, data, events, frames(), stats(), edges(), setInset() }:
// ready turns true once the first frame is on screen; scene is the TunnelSceneApi (null in
// the one-model view); data is the sample drawing the scene was given (change a copy and
// call scene.setData to try things); events lists what the scene has reported; edges()
// resolves with how far the canvas's border pixels are from the page color (0 to 255: it
// must be 0 on the overview and top presets, or the canvas shows as a rectangle);
// setInset({ top, right, bottom, left }) changes the inset later, outline included (null:
// none).

type Probe = {
  ready: boolean
  scene: TunnelSceneApi | null
  stage: ReturnType<typeof createStage> | null
  data: Fixture | null
  events: Array<{ type: string; detail: unknown }>
  frames: () => number
  stats: () => { calls: number; triangles: number; frameMs: number; frames: number; pixelRatio: number }
  edges: () => Promise<number>
  setInset: (i: Inset | null) => void
}

const q = new URLSearchParams(location.search)
const num = (name: string): number | null => {
  const v = q.get(name)
  return v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)
}
const theme: ThemeName = q.get('theme') === 'dark' || q.get('theme') === 'light'
  ? (q.get('theme') as ThemeName)
  : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
const detail = q.get('detail') === 'low' ? 'low' : q.get('detail') === 'high' ? 'high' : undefined
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const root = document.getElementById('root')!
root.style.cssText = 'position:fixed;inset:0'
document.body.style.margin = '0'
document.body.style.background = theme === 'dark' ? '#0d1219' : '#f7f8fa'

const backdrop = theme === 'dark' ? [13, 18, 25] : [247, 248, 250]
// Asks for a frame, then reads the canvas in the same animation frame (a WebGL canvas is
// blank once its frame has been shown) and compares its border with the page color.
let poke = () => {}
const edges = (): Promise<number> => new Promise((resolve) => {
  poke()
  requestAnimationFrame(() => {
    const gl = root.querySelector('canvas')
    if (!gl || !gl.width || !gl.height) return resolve(255)
    const copy = document.createElement('canvas')
    copy.width = gl.width
    copy.height = gl.height
    const g = copy.getContext('2d')!
    g.drawImage(gl, 0, 0)
    const px = g.getImageData(0, 0, copy.width, copy.height).data
    let worst = 0
    const look = (x: number, y: number) => {
      const k = (y * copy.width + x) * 4
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(px[k + c] - backdrop[c]))
    }
    for (let x = 0; x < copy.width; x++) {
      look(x, 0)
      look(x, copy.height - 1)
    }
    for (let y = 0; y < copy.height; y++) {
      look(0, y)
      look(copy.width - 1, y)
    }
    resolve(worst)
  })
})

// The free area's outline, drawn as the camera clamps it, for the inset last given.
let outlined: Inset | null = null
const outline = document.createElement('div')
const middle = document.createElement('div')
outline.appendChild(middle)
const drawOutline = () => {
  if (!outlined) return outline.remove()
  const f = freeArea(outlined, root.clientWidth, root.clientHeight)
  outline.style.cssText = `position:fixed;z-index:2;pointer-events:none;box-sizing:border-box;border:1px dashed #ff3d7f;left:${f.left}px;top:${f.top}px;right:${f.right}px;bottom:${f.bottom}px`
  middle.style.cssText = 'position:absolute;left:50%;top:50%;width:15px;height:15px;margin:-7px 0 0 -7px;background:linear-gradient(#ff3d7f,#ff3d7f) center/1px 100% no-repeat,linear-gradient(#ff3d7f,#ff3d7f) center/100% 1px no-repeat'
  if (!outline.isConnected) document.body.appendChild(outline)
}
window.addEventListener('resize', drawOutline)
const askedInset = (): Inset | null => {
  const v = q.get('inset')?.split(',').map(Number)
  return v?.length === 4 && v.every((n) => !Number.isNaN(n)) ? { top: v[0], right: v[1], bottom: v[2], left: v[3] } : null
}
const ZERO: Inset = { top: 0, right: 0, bottom: 0, left: 0 }
// Hands the inset to whatever is on the page (scene or stage) and draws its outline.
let applyInset: (i: Inset) => void = () => {}
const setInset = (i: Inset | null) => {
  outlined = i
  drawOutline()
  applyInset(i ?? ZERO)
}

const probe: Probe = { ready: false, scene: null, stage: null, data: null, events: [], frames: () => 0, stats: () => ({ calls: 0, triangles: 0, frameMs: 0, frames: 0, pixelRatio: 1 }), edges, setInset }
;(window as unknown as { __t3d: Probe }).__t3d = probe

function whenDrawn() {
  const check = () => {
    if (probe.frames() > 0) probe.ready = true
    else requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

function hud() {
  if (q.get('hud') !== '1') return
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;left:12px;bottom:10px;font:12px/1.4 ui-monospace,monospace;color:${theme === 'dark' ? '#9aa4b2' : '#5b6470'};pointer-events:none`
  document.body.appendChild(el)
  setInterval(() => {
    const s = probe.stats()
    el.textContent = `${s.calls} draw calls  ${Math.round(s.triangles / 1000)}k triangles  ${s.frameMs.toFixed(1)} ms  ${s.frames} frames  x${s.pixelRatio}`
  }, 300)
}

// Draws the pick shapes as wire boxes, to check they wrap the right parts.
function showPicks(scene: Object3D, camera: { layers: { enable(n: number): void } }) {
  if (q.get('picks') !== '1') return
  const wire = new MeshBasicMaterial({ color: '#ff3d7f', wireframe: true })
  scene.traverse((o) => { if (o.userData.pick) (o as Mesh).material = wire })
  camera.layers.enable(LAYER.pick)
}

function wholeTunnel() {
  const fixture = sampleTunnel({ linked: q.get('linked') !== '0' })
  const byLabel = (label: string | null) => fixture.items.find((i) => i.label.toLowerCase() === (label ?? '').toLowerCase())?.id ?? null
  let scene: TunnelSceneApi
  const log = (type: string, detail: unknown) => {
    probe.events.push({ type, detail })
    if (probe.events.length > 200) probe.events.shift()
  }
  const events: SceneEvents = {
    onReady: () => log('ready', null),
    onHover: (id) => log('hover', id),
    onSelect: (id) => {
      log('select', id)
      scene.setOptions({ selectedId: id })
      if (id) scene.flyTo(id)
    },
    onOpen: (id) => log('open', id),
    onMove: (e) => log('move', e),
    onCameraRest: (pose, preset) => log('rest', { pose, preset }),
    onRide: (e) => log('ride', e),
    onLost: () => log('lost', null),
  }
  const hold = num('t')
  const mount = () => createTunnelScene(root, events, {
    theme,
    colorBy: (q.get('colorBy') as ColorBy) ?? 'status',
    mode: q.get('mode') === 'preview' ? 'preview' : 'site',
    selectedId: byLabel(q.get('select')),
    moveMode: q.get('move') === '1',
    playing: q.get('play') !== '0' && hold == null && !reducedMotion,
    reducedMotion,
    expanded: true,
    detail,
  })
  scene = mount()
  if (q.get('strict') === '1') {
    scene.setData(fixture)
    scene.dispose()
    scene = mount()
  }
  applyInset = (i) => scene.setInset(i)
  const inset = askedInset()
  if (inset) setInset(inset)
  scene.setData(fixture)
  const cam = q.get('cam')
  if (cam === 'overview' || cam === 'entrance' || cam === 'top') scene.setPreset(cam as CameraPreset, { instant: true })
  const pose = q.get('pose')?.split(',').map(Number)
  if (pose?.length === 6 && pose.every((v) => !Number.isNaN(v))) scene.setPose({ position: [pose[0], pose[1], pose[2]], target: [pose[3], pose[4], pose[5]] })
  const hover = byLabel(q.get('hover'))
  if (hover) scene.focus(hover)
  const fly = byLabel(q.get('fly'))
  if (fly) scene.flyTo(fly, { instant: true })
  if (q.get('ride') === '1') scene.ride(true)
  if (hold != null) scene.setTime(hold)
  probe.scene = scene
  probe.data = fixture
  probe.frames = () => scene.stats().frames
  probe.stats = () => scene.stats()
  // Pinning nothing changes nothing, but asks the scene for a frame.
  poke = () => scene.pin(root, null)
}

function oneModel(kind: string) {
  const sampler = kind === '_kit'
  const def = shapeFor(kind)
  const row = (expressTemplate().items ?? []).find((i) => i.kind === kind)
  const side = sampler ? 'outside' : (q.get('side') as TunnelSide) ?? row?.side ?? def.side
  const w = num('w') ?? (sampler ? 48 : Number(row?.w_ft ?? def.w))
  const h = num('h') ?? (sampler ? 30 : Number(row?.h_ft ?? def.h))
  const tunnelWidth = 16
  const y = num('y') ?? (q.get('side') ? (side === 'ps' ? 4.6 : side === 'ds' ? -4.6 : 0) : Number(row?.y_ft ?? 0))
  const outside = side === 'outside'
  const rot = num('rot') ?? 0
  // In the tunnel a turned shape arrives with its sides swapped and isn't turned.
  const lies = !outside && (rot === 90 || rot === 270)
  const running = q.get('run') !== '0'
  const fixedDx = num('carDx')
  const pass = q.get('pass') === '1'
  const hold = num('t')

  const stage = createStage(root, { theme, detail })
  const kit = stage.kit
  const model = (sampler ? kitSampler : buildModel)({
    item: { kind, label: q.get('label') ?? row?.label ?? def.label, match_type: q.get('match') ?? row?.match_type ?? null, props: q.get('tall') === '1' ? { tall: true } : row?.props ?? {} },
    w: lies ? h : w, h: lies ? w : h, side, y: outside ? 0 : y, rotation: rot, tunnelWidth, detail: stage.detail, kit,
  })
  // The tunnel's centerline is z = 0, as in the real scene, so the car lines up.
  model.root.position.set(0, 0, outside ? 0 : y)
  if (outside) model.root.rotation.y = -(rot * Math.PI) / 180
  stage.world.add(model.root)
  const vehicle = fixedDx != null || pass ? createVehicle(kit) : null
  if (vehicle) stage.world.add(vehicle.root)

  const box = new Box3().setFromObject(model.root)
  box.min.y = 0
  const span = Math.max(w / 2 + 5, 11, pass ? 26 : 0, fixedDx != null ? Math.abs(fixedDx) + CAR.length / 2 + 2 : 0)
  const reach = outside ? Math.max(h / 2 + 5, 8) : tunnelWidth / 2 + 4
  stage.setLayout({ length: 0, width: tunnelWidth, zones: [], box: { minX: -span, maxX: span, minZ: -reach, maxZ: reach }, markings: false, carLine: null, height: Math.max(8, model.height) })
  // Before the pose is fitted, which fits into the free area. A later change only moves
  // the picture's middle: this view has no presets to fit again.
  applyInset = stage.setInset
  const inset = askedInset()
  if (inset) setInset(inset)
  const zoom = num('zoom') ?? 1
  const view = stage.fitPose(num('az') ?? 35, num('el') ?? 20, { min: [box.min.x, 0, box.min.z], max: [box.max.x, Math.max(box.max.y, model.height), box.max.z] }, 1.12 * zoom)
  const pose = q.get('pose')?.split(',').map(Number)
  const placed = pose?.length === 6 && pose.every((v) => !Number.isNaN(v))
  stage.camera.position.set(...(placed ? ([pose[0], pose[1], pose[2]] as const) : view.position))
  stage.controls.target.set(...(placed ? ([pose[3], pose[4], pose[5]] as const) : view.target))
  stage.controls.update()

  const st: RunState = { t: 0, dt: 0, running, activity: 0, carDx: null }
  const car: CarState = { x: 0, t: 0, dt: 0, speed: 0, presence: 1 }
  const advance = (t: number, dt: number) => {
    st.t = t
    st.dt = dt
    kit.time.value = t
    st.carDx = pass ? -24 + ((t * CAR.speed) % 48) : fixedDx
    if (vehicle && st.carDx != null) {
      car.x = st.carDx
      car.t = t
      car.dt = dt
      car.speed = pass ? CAR.speed : 0
      vehicle.update(car)
    }
    // As the scene does it: beside the tunnel a machine that's up simply runs.
    if (outside) st.carDx = null
    const auto = st.carDx != null ? activityAt(st.carDx, (lies ? h : w) / 2) : 1
    st.activity = !running ? 0 : num('activity') ?? auto
    model.update?.(st)
  }
  let t = 0
  if (hold != null || q.get('play') === '0' || reducedMotion) {
    // A short run-up to the moment, so parts with momentum are where they would be.
    const at = hold ?? 0
    for (let k = 40; k >= 0; k--) advance(Math.max(0, at - k * 0.05), k === 40 ? 0 : 0.05)
  } else {
    advance(0, 0)
    stage.setTick((dt) => {
      t += dt
      advance(t, dt)
      return true
    })
  }
  showPicks(stage.scene, stage.camera)
  void stage.compile()
  stage.invalidate()
  poke = stage.invalidate
  probe.stage = stage
  probe.frames = stage.frames
  probe.stats = stage.stats
}

const kind = q.get('kind')
if (kind) oneModel(kind)
else wholeTunnel()
hud()
whenDrawn()
