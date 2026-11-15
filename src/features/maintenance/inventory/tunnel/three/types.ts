import type { Group, Object3D, PerspectiveCamera, Scene } from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { TunnelAsset, TunnelItem, TunnelLayout, TunnelSide } from '@/lib/queries/miTunnel'
import type { ColorBy } from '../TunnelDiagram'
import type { Kit } from './kit'

// The 3D tunnel's shared contract: what a machine's model is, what the scene is told and
// what it reports back. Models, the scene and the React wrapper are written against this
// file and nothing else of each other's.
//
// WORLD SPACE. One unit is one foot. Y is up, the floor is y = 0.
//   world X = layout x_ft: along the tunnel, cars travel toward +X, the entrance is x = 0
//             (the prep lane is negative x).
//   world Z = layout y_ft: across the tunnel from its centerline. The driver's side is -Z,
//             the passenger side +Z.
// The default camera stands on the passenger side looking back across the tunnel, so the
// entrance is on the left, as in the 2D diagram.

export type ThemeName = 'light' | 'dark'
export type { ColorBy }

// ---- Models -------------------------------------------------------------------------

// What a model is told each time the scene works out a moment (every frame while it
// plays, and once whenever something changes while it's paused, with dt = 0).
export type RunState = {
  // Seconds of scene time (stops while paused) and seconds since the last frame (capped;
  // 0 when the scene is paused or jumping to a moment).
  t: number
  dt: number
  // False when the machine is down, retired or not linked: it stands still, cloth hangs
  // limp, spray is off, and it stays that way as the car passes.
  running: boolean
  // 0 to 1: how hard the machine is working this instant. In the tunnel it rises as the
  // demo car comes into the machine's reach and falls after it leaves, and it is 0 while
  // the car is parked (the conveyor is down). Beside the tunnel it is 1 whenever the
  // machine is running. Always 0 when not running.
  activity: number
  // The demo car's center minus the model's center, along the tunnel, in feet (negative:
  // the car hasn't reached the machine yet). null when there is no car, and for machines
  // beside the tunnel. See car.ts for the car's size and roofline.
  carDx: number | null
}

export type Model = {
  // LOCAL SPACE of root: the origin is the center of the footprint, on the floor.
  // In the tunnel root is never turned: +X is the way cars go, +Z is toward the passenger
  // side, +Y up, whatever the shape's rotation (see ModelInput.rotation).
  // The scene places root; a model never moves root itself.
  root: Group
  // The highest point of the model in feet, for the status light and labels.
  height: number
  // Where the status light goes, in local space. Default: above the model's center.
  beacon?: { x: number; y: number; z: number }
  // Where the tone cap goes (the usage, work order and sticker views), in local space. A cap
  // reads as the machine's only if it sits on it: give one when the light stands off the
  // machine to be seen (on the floor beside the lane). Default: beacon.
  cap?: { x: number; y: number; z: number }
  // Pose the moving parts for this moment. The pose must follow from RunState alone, by
  // plain arithmetic: no easing that remembers the last frame, so any moment can be drawn
  // on its own and a paused scene (dt = 0) still comes to rest. The one thing that may
  // build up is a phase nobody can see in a still (a brush's angle). Must not allocate.
  // After the model is built, never assign mesh.material and never add or remove meshes:
  // the status layer swaps materials for hover, ghost and clay looks and remembers what
  // each mesh wore. To switch something on and off, set .visible (kit.lamp does this).
  update?: (s: RunState) => void
  // Free what the model alone owns (its own materials or textures, a foam brush). The
  // scene disposes every geometry under root itself, and the kit owns shared materials.
  dispose?: () => void
}

export type ModelInput = {
  item: Pick<TunnelItem, 'kind' | 'label' | 'match_type' | 'props'>
  // The footprint in feet. In the tunnel: w along the tunnel, h across it, as the shape
  // lies (a shape turned 90 degrees arrives with them already swapped). Beside the
  // tunnel: the shape's own w and h, and the scene turns root.
  w: number
  h: number
  side: TunnelSide
  // Where the footprint's center sits across the tunnel (layout y_ft), so a model can
  // reach for the car (see CAR.z) or the nearest wall from wherever it stands. In the
  // tunnel, local z = world z - y.
  y: number
  // How the shape is turned in the drawing: 0, 90, 180 or 270 degrees clockwise seen
  // from above. In the tunnel (side is not 'outside') it is already folded into w and h
  // and root is not turned, because a machine there faces the car whichever way it was
  // drawn. Beside the tunnel the scene turns root by it.
  rotation: number
  // The tunnel's width between its walls, in feet.
  tunnelWidth: number
  // Fewer pieces for phones.
  detail: 'high' | 'low'
  // The shared materials, shapes, brushes and spray every model is built from.
  kit: Kit
}

export type ModelBuilder = (input: ModelInput) => Model

// ---- The scene ----------------------------------------------------------------------

export type SceneData = {
  layout: Pick<TunnelLayout, 'length_ft' | 'width_ft' | 'zones'>
  // Unsaved moves are already applied to these.
  items: TunnelItem[]
  assets: Record<string, TunnelAsset>
  // Where moved items are saved, so the scene can leave a ghost outline there.
  saved?: Record<string, { x_ft: number; y_ft: number }>
}

export type SceneOptions = {
  theme: ThemeName
  colorBy: ColorBy
  // 'site': a real site's tunnel. 'preview': a template shown as a showroom before a
  // site has a drawing: everything solid and running, names on hover, nothing to select.
  mode: 'site' | 'preview'
  selectedId: string | null
  // True while the person is arranging: dragging a machine moves it.
  moveMode: boolean
  // The demo car, brushes and spray.
  playing: boolean
  reducedMotion: boolean
  // Fills the screen: the wheel always zooms.
  expanded: boolean
  // Quality tier. Left out, the scene picks: 'low' on phones and small devices.
  detail?: 'high' | 'low'
}

export type CameraPreset = 'overview' | 'entrance' | 'top'
export type CameraPose = { position: [number, number, number]; target: [number, number, number] }

export type MoveEvent = {
  id: string
  phase: 'start' | 'move' | 'end' | 'cancel'
  // Snapped, clamped position in layout feet.
  x_ft: number
  y_ft: number
  // Other machines whose footprints it now overlaps.
  overlaps: string[]
}

export type SceneEvents = {
  // The first frame with the drawing in it is on screen. Shaders are compiled off the
  // main thread before it, so until this fires the canvas shows the page color.
  onReady: () => void
  // The machine under the pointer or keyboard focus (null: none).
  onHover: (id: string | null) => void
  // A click or tap on a machine that isn't selected yet, or on empty floor (null).
  onSelect: (id: string | null) => void
  // A click on the machine that's already selected, or a double-click: open its page.
  onOpen: (id: string) => void
  onMove: (e: MoveEvent) => void
  // The camera came to rest after someone moved it (to remember it). Never fired on
  // load or on a resize. preset is the preset it is on (after setPreset: remember that,
  // not the pose, because a preset is refitted to the canvas), or null when the pose is
  // the person's own (an orbit, a zoom, flyTo).
  onCameraRest: (pose: CameraPose, preset: CameraPreset | null) => void
  // The ride-through camera: whether it's on, how far along (0 to 1), and the machine
  // the car is passing. Asking for a ride that can't start (no conveyor, or it's down)
  // answers with active false.
  onRide: (e: { active: boolean; progress: number; nearId: string | null }) => void
  // WebGL was lost and didn't come back: show the 2D diagram instead.
  onLost: () => void
}

export type Inset = { top: number; right: number; bottom: number; left: number }

// createTunnelScene(container, events, options) returns this. It THROWS if the browser
// can't give it WebGL2 (nothing is left in the container): check webglAvailable() first
// or catch, and show the 2D diagram. onLost is for a context lost later.
// After dispose() every method does nothing and no event fires.
export interface TunnelSceneApi {
  setData(d: SceneData): void
  setOptions(o: Partial<SceneOptions>): void
  // Keep an HTML element pinned to a machine as the camera moves (a tooltip, a name
  // chip): the scene sets its transform every frame and data-offscreen when it's out of
  // view. null lets go of it.
  pin(el: HTMLElement, id: string | null, at?: 'top' | 'base'): void
  // Light a machine as if hovered (keyboard focus). null clears it.
  focus(id: string | null): void
  // In the showroom the slow turn runs only while the camera is on a preset: flyTo, zoomBy
  // and setPose (like a press or a zoom on the canvas) stop it for good.
  flyTo(id: string, opts?: { instant?: boolean }): void
  setPreset(p: CameraPreset, opts?: { instant?: boolean }): void
  zoomBy(factor: number): void
  getPose(): CameraPose
  setPose(p: CameraPose): void
  // The canvas edges the widget's own HTML covers (toolbar, a docked card, the page's bar),
  // in CSS pixels. Presets, flyTo and the showroom turn frame the drawing in what is left,
  // and the picture's center moves to the middle of it; picking and pins keep working.
  // All zero (the default) is the whole canvas. Cheap to call with the same values again.
  setInset(inset: Inset): void
  // Ride the conveyor from the entrance to the exit. The car runs for the ride even
  // while the scene is paused.
  ride(on: boolean): void
  dispose(): void
  // For checks: jump scene time, read what the renderer is doing.
  setTime(t: number): void
  // frames counts every frame drawn so far: it must stand still while nothing moves.
  stats(): { calls: number; triangles: number; frameMs: number; frames: number; pixelRatio: number }
}

// ---- Inside the scene ---------------------------------------------------------------
// What TunnelScene hands to the parts built on top of it (interaction.ts, status.ts).

// One shape of the drawing, alive in the scene.
export type LiveItem = {
  id: string
  // Shapes linked to the same machine light together: asset_id ?? id.
  key: string
  item: TunnelItem
  asset: TunnelAsset | null
  // Rooms and labels: drawn, but never lit, picked or moved.
  scenery: boolean
  model: Model
  // The model's pick shapes (kit.pickBox / pickCylinder). Each carries userData.itemId.
  picks: Object3D[]
  // Where it stands now, in layout feet (a drag changes this before the page saves it).
  x: number
  y: number
  // Its footprint along and across the tunnel, after rotation.
  w: number
  h: number
  // Its machine is up: linked and online, or anything at all in preview mode.
  running: boolean
}

// A machine being dragged. interaction.ts sets it (ctx.setDrag), status.ts draws from it
// (the ghost at `from`, the amber pad when `overlaps` isn't empty), and while it is set
// the scene leaves that machine where the drag put it, whatever setData says.
export type DragState = {
  id: string
  // Where it stood when it was picked up, in layout feet.
  from: { x_ft: number; y_ft: number }
  // Where it is now: snapped and clamped.
  x_ft: number
  y_ft: number
  // Other machines whose footprints it overlaps there (ctx.overlapsOf).
  overlaps: string[]
}

export type SceneContext = {
  dom: HTMLCanvasElement
  container: HTMLElement
  camera: PerspectiveCamera
  controls: OrbitControls
  scene: Scene
  // Where the layers add objects of their own (pads, rulers, ghosts). World space.
  overlay: Group
  kit: Kit
  events: SceneEvents
  // Live views of the scene's state: read them when needed, don't keep copies.
  readonly items: ReadonlyArray<LiveItem>
  readonly options: Readonly<SceneOptions>
  readonly data: SceneData
  // The floor's extent in world feet (every slab), and the tunnel's own slab.
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  readonly tunnelSlab: { minX: number; maxX: number; minZ: number; maxZ: number }
  // Seconds of scene time: it stands still while the scene is paused.
  readonly time: number
  // Whether scene time is moving on by itself: the scene plays and something on it follows
  // time (the car, a machine, a flashing light), or the ride is on. Frames may then come
  // far apart (see StatusLayer.nextChange). False while paused (a jump with setTime too)
  // and while nothing on the slab follows time.
  readonly timeRunning: boolean
  readonly drag: DragState | null
  item(id: string): LiveItem | undefined
  // Put a shape somewhere else (layout feet). lift raises it off the floor, for a drag.
  moveItem(id: string, x_ft: number, y_ft: number, lift?: number): void
  // Say what is being dragged (null: nothing). Tells the status layer (sync) and asks
  // for a frame. Call it on pick-up, on every move and on drop or cancel.
  setDrag(d: DragState | null): void
  // The machines whose footprints the shape would overlap if it stood at x, y. Scenery
  // and the conveyor (everything in the tunnel stands over it) never count.
  overlapsOf(id: string, x_ft: number, y_ft: number): string[]
  // What the pointer is over. The scene lights it, with the focused and selected ones.
  setHover(id: string | null): void
  // Ask for a frame. Nothing is drawn unless something asks.
  invalidate(): void
  // Redraw the shadow map after something that casts a shadow moved or changed.
  refreshShadows(): void
  // Call after putting a material on screen that the scene hasn't drawn before (a new
  // look from kit.variant): its shaders are compiled off the main thread and the next
  // frame waits for them, so the page never freezes. Cheap when nothing is new.
  compile(): Promise<void>
  // Stop a camera glide where it is (any press on the canvas should).
  stopCamera(): void
}

// The two layers on top of the scene. Their modules export a factory taking a
// SceneContext and returning these, and nothing else of theirs is called.
//   sync()            the data, the options or the drag changed: catch up.
//   update(dt, now)   once per frame, before it is drawn, also while the scene is paused.
//                     dt is real seconds since the last frame (capped), now is
//                     performance.now(). Return true while something of yours is still
//                     easing: the scene keeps drawing frames until every part says
//                     false. A steady state must return false, or the scene never idles.
//                     To start an animation from an event, change your state and call
//                     ctx.invalidate().
// Inside the factory itself only read from ctx and add listeners: setHover and setDrag
// are ignored until both layers exist.
export type Interaction = {
  sync(): void
  update(dt: number, now: number): boolean
  dispose(): void
}

export type StatusLayer = {
  sync(): void
  // The items to light: hover, keyboard focus and the selection, already merged.
  setLit(ids: string[]): void
  update(dt: number, now: number): boolean
  // What the layer shows on scene time (a broken machine's flashing stack light): the
  // scene time, after sceneTime, at which it next looks different if time runs, or
  // Infinity when nothing of the layer follows scene time. Answers from the last sync().
  // When it is the only thing on screen that changes, the scene draws a frame then and
  // sleeps in between, instead of drawing the same picture at the display's rate.
  nextChange?(sceneTime: number): number
  dispose(): void
}
