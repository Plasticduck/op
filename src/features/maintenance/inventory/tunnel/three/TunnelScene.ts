import { Box3, MathUtils, Spherical, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { TunnelItem } from '@/lib/queries/miTunnel'
import { shapeFor } from '../shapes'
import { CAR } from './car'
import type { Bounds } from './floor'
import { attachInteraction } from './interaction'
import { clickSlop } from './interactionMath'
import { activityAt, carAt, carTrip, PARKED_NOSE_X } from './life'
import type { CarAt, CarTrip } from './life'
import { buildModel } from './models'
import { cleanInset, createStage, freeArea, webglAvailable } from './stage'
import { createStatusLayer } from './status'
import type { CameraPose, CameraPreset, DragState, Inset, LiveItem, RunState, SceneContext, SceneData, SceneEvents, SceneOptions, TunnelSceneApi } from './types'
import { createVehicle } from './vehicle'
import type { CarState, Vehicle } from './vehicle'

// The 3D tunnel's engine. It keeps the scene in step with the drawing (a model per
// shape, moved or rebuilt only when it changed), runs the life loop (the demo car and
// what it wakes up), and drives the camera. It is an orchestrator: drawing lives in
// stage.ts and the models, the pointer in interaction.ts, status visuals in status.ts.
// Those two get a SceneContext and nothing else.

export { webglAvailable }

const DROP_FT = 2.4
const DROP_MS = 520
const RIDE_FOV = 52
// ms. A preset's glide, which a change of the free area also takes on a preset; under a
// pose of the person's own only the picture's middle moves, a little quicker.
const GLIDE_MS = 700
const INSET_OWN_MS = 450
// Seconds. While the loop sleeps between a stack light's edges, how late a frame may come
// and scene time still catch up with the clock.
const DOZE_LATE = 0.25
// Concrete around what stands on it, in feet.
const PAD = 2.5
// Past the passenger side wall the slab carries the tape measure and the zone names.
const NAMES = 7.5

const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2)
const easeOut = (v: number) => 1 - Math.pow(1 - v, 4)
const grid = (v: number, up: boolean) => (up ? Math.ceil(v / 2.5) : Math.floor(v / 2.5)) * 2.5

const inTunnel = (i: TunnelItem) => i.side !== 'outside'
const turned = (i: TunnelItem) => i.rotation === 90 || i.rotation === 270

// What a model is built from. When this changes the model is rebuilt; anything else
// (where it stands along the tunnel, the machine it's linked to) only moves or redresses it.
function signature(i: TunnelItem, tunnelWidth: number): string {
  // A machine in the tunnel is shaped by where it stands across it (legs reach for the
  // walls). One beside the tunnel only cares which side it's on.
  const across = inTunnel(i) ? Number(i.y_ft) : Math.sign(Number(i.y_ft))
  return [i.kind, i.w_ft, i.h_ft, i.rotation, i.side, i.label, i.match_type, JSON.stringify(i.props ?? {}), across, tunnelWidth].join('|')
}

// Where the concrete goes: one slab under the tunnel and whatever stands right beside
// it, and a pad under each group of things that stand apart (a room and the machines in
// it). A pad near the tunnel reaches over to its slab, so they read as one piece.
function floorPlan(length: number, width: number, zones: ReadonlyArray<{ x_from: number; x_to: number }>, items: ReadonlyArray<LiveItem>): { main: Bounds; pads: Bounds[] } {
  const half = width / 2
  let x0 = 0
  let x1 = length
  for (const z of zones) {
    x0 = Math.min(x0, Number(z.x_from))
    x1 = Math.max(x1, Number(z.x_to))
  }
  // While the conveyor is down the car waits short of the entrance (life.ts): there is
  // concrete under it, however little is drawn before the tunnel.
  if (items.some((it) => it.item.kind === 'conveyor')) x0 = Math.min(x0, PARKED_NOSE_X - CAR.length - 1)
  let z0 = -(half + 3.5)
  let z1 = half + NAMES
  const apart: Bounds[] = []
  for (const it of items) {
    const b = { minX: it.x - it.w / 2, maxX: it.x + it.w / 2, minZ: it.y - it.h / 2, maxZ: it.y + it.h / 2 }
    if (inTunnel(it.item)) {
      x0 = Math.min(x0, b.minX)
      x1 = Math.max(x1, b.maxX)
      // The editor lets a shape in the tunnel be dragged or typed past a wall: the slab
      // reaches out under it. Between the walls this changes nothing.
      z0 = Math.min(z0, b.minZ - PAD)
      z1 = Math.max(z1, b.maxZ + PAD)
    } else if (Math.abs(it.y) <= half + 8 && b.maxX > x0 - 8 && b.minX < x1 + 8) {
      // Right beside the tunnel (a prep station): it shares the tunnel's slab.
      x0 = Math.min(x0, b.minX)
      x1 = Math.max(x1, b.maxX)
      z0 = Math.min(z0, b.minZ - PAD)
      z1 = Math.max(z1, b.maxZ + PAD)
    } else apart.push({ minX: b.minX - PAD, maxX: b.maxX + PAD, minZ: b.minZ - PAD, maxZ: b.maxZ + PAD })
  }
  // On a grid, so a small move doesn't repaint the floor.
  const main = { minX: grid(x0 - PAD, false), maxX: grid(x1 + PAD, true), minZ: grid(z0, false), maxZ: grid(z1, true) }
  if (main.maxX - main.minX < 20) {
    main.minX -= 10
    main.maxX += 10
  }
  // Things that touch or nearly touch share a pad.
  const pads: Bounds[] = []
  for (const b of apart) {
    let grown = b
    for (let again = true; again;) {
      again = false
      for (let k = pads.length - 1; k >= 0; k--) {
        const o = pads[k]
        if (grown.minX > o.maxX + 1 || grown.maxX < o.minX - 1 || grown.minZ > o.maxZ + 1 || grown.maxZ < o.minZ - 1) continue
        grown = { minX: Math.min(grown.minX, o.minX), maxX: Math.max(grown.maxX, o.maxX), minZ: Math.min(grown.minZ, o.minZ), maxZ: Math.max(grown.maxZ, o.maxZ) }
        pads.splice(k, 1)
        again = true
      }
    }
    pads.push(grown)
  }
  const out: Bounds[] = []
  for (const b of pads) {
    const pad = { minX: grid(b.minX, false), maxX: grid(b.maxX, true), minZ: grid(b.minZ, false), maxZ: grid(b.maxZ, true) }
    // Close to the tunnel's slab: reach over and join it.
    const beside = pad.maxX > main.minX && pad.minX < main.maxX
    if (beside && pad.minZ > main.maxZ - 0.01 && pad.minZ - main.maxZ < 9) pad.minZ = main.maxZ - 2.5
    if (beside && pad.maxZ < main.minZ + 0.01 && main.minZ - pad.maxZ < 9) pad.maxZ = main.minZ + 2.5
    const within = pad.minX >= main.minX && pad.maxX <= main.maxX && pad.minZ >= main.minZ && pad.maxZ <= main.maxZ
    if (!within) out.push(pad)
  }
  // The ground can shade eight slabs. A drawing with more islands than that gets one
  // pad around them all.
  if (out.length > 7) {
    const all = out.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) }))
    return { main, pads: [all] }
  }
  return { main, pads: out }
}

export function createTunnelScene(container: HTMLElement, events: SceneEvents, options: SceneOptions): TunnelSceneApi {
  const opts: SceneOptions = { ...options }
  let disposed = false
  const stage = createStage(container, { theme: opts.theme, detail: opts.detail, onLost: () => { if (!disposed) events.onLost() } })
  const { kit, camera, controls } = stage
  const baseFov = camera.fov

  let data: SceneData = { layout: { length_ft: 0, width_ft: 16, zones: [] }, items: [], assets: {} }
  const items: LiveItem[] = []
  const byId = new Map<string, LiveItem>()
  const builtFrom = new Map<string, string>()
  let tunnelSlab: Bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  let layoutKey = ''
  let hoverId: string | null = null
  let focusId: string | null = null
  let drag: DragState | null = null
  // Scene time starts a moment into the car's first pass, so it's already on the slab.
  let t = 1
  // False while the two layers are still being made: they can't be told anything yet.
  let live = false

  // ---- What the layers are handed ----
  const ctx: SceneContext = {
    dom: stage.dom,
    container,
    camera,
    controls,
    scene: stage.scene,
    overlay: stage.overlay,
    kit,
    events,
    get items() { return items },
    get options() { return opts },
    get data() { return data },
    get bounds() { return stage.bounds },
    get tunnelSlab() { return tunnelSlab },
    get time() { return t },
    get timeRunning() { return riding || (opts.playing && (moves || flashes)) },
    get drag() { return drag },
    item: (id) => byId.get(id),
    moveItem(id, x_ft, y_ft, lift = 0) {
      const it = byId.get(id)
      if (!it || disposed) return
      it.x = x_ft
      it.y = y_ft
      it.model.root.position.set(x_ft, lift, y_ft)
      stage.refreshShadows()
    },
    setDrag(d) {
      if (disposed || !live) return
      const ended = !!drag && !d
      drag = d
      // The floor was left alone while the machine was in the air: lay it now.
      if (ended) plan()
      status.sync()
      stage.invalidate()
    },
    overlapsOf(id, x_ft, y_ft) {
      const me = byId.get(id)
      const out: string[] = []
      if (!me) return out
      for (const o of items) {
        if (o === me || o.scenery || o.item.kind === 'conveyor') continue
        // Standing edge to edge is not overlapping.
        if (Math.abs(o.x - x_ft) < (o.w + me.w) / 2 - 0.05 && Math.abs(o.y - y_ft) < (o.h + me.h) / 2 - 0.05) out.push(o.id)
      }
      return out
    },
    setHover(id) {
      if (disposed || !live) return
      hoverId = id
      relight()
    },
    invalidate: stage.invalidate,
    refreshShadows: stage.refreshShadows,
    compile: stage.compile,
    stopCamera() {
      const driven = !!tween || controls.autoRotate
      tween = null
      // A press that cuts a glide short or stops the showroom's turn leaves the camera
      // where it stopped: the person's own pose, remembered once it rests.
      if (driven) {
        own()
        owe()
      }
    },
  }
  const status = createStatusLayer(ctx)
  const interaction = attachInteraction(ctx)
  live = true

  function relight() {
    const ids: string[] = []
    for (const id of [hoverId, focusId, opts.mode === 'preview' ? null : opts.selectedId]) {
      if (id && !ids.includes(id)) ids.push(id)
    }
    status.setLit(ids)
  }

  // ---- Keeping the scene in step with the drawing ----
  const _box = new Box3()
  const _size = new Vector3()
  const _center = new Vector3()

  const isRunning = (it: LiveItem) => opts.mode === 'preview' || it.asset?.status === 'online'

  const removeModel = (it: LiveItem) => {
    stage.world.remove(it.model.root)
    kit.release(it.model.root)
    it.model.dispose?.()
    it.model.root.traverse((o) => {
      const mesh = o as { geometry?: { dispose(): void; userData: Record<string, unknown> }; skeleton?: { dispose(): void } }
      if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose()
      mesh.skeleton?.dispose()
    })
  }

  const place = (it: LiveItem) => {
    const i = it.item
    it.w = Number(turned(i) ? i.h_ft : i.w_ft)
    it.h = Number(turned(i) ? i.w_ft : i.h_ft)
    const root = it.model.root
    // A machine in the tunnel faces the car however its shape was turned: its model was
    // built to the footprint as it lies. Beside the tunnel the model is turned instead.
    // (The drawing turns clockwise seen from above, which is a negative turn about +Y.)
    root.rotation.y = inTunnel(i) ? 0 : -MathUtils.degToRad(i.rotation)
    // A machine in someone's hand stays there, whatever the page last heard.
    if (drag?.id === it.id) return
    it.x = Number(i.x_ft)
    it.y = Number(i.y_ft)
    root.position.x = it.x
    root.position.z = it.y
  }

  let tallest = 11
  let trip: CarTrip | null = null
  let conveyorItem: LiveItem | null = null
  let vehicle: Vehicle | null = null

  // Lays the floor for where everything stands now, and works out the car's trip on it.
  function plan() {
    const width = Number(data.layout.width_ft) || 16
    const length = Number(data.layout.length_ft) || 0
    const zones = data.layout.zones ?? []
    const conveyor = items.find((it) => it.item.kind === 'conveyor') ?? null
    // Not while a machine is being dragged: the floor would be relaid under it at every step.
    if (!drag) {
      const { main, pads } = floorPlan(length, width, zones, items)
      const key = JSON.stringify([length, width, zones, main, pads, !!conveyor, Math.ceil(tallest)])
      if (key !== layoutKey) {
        layoutKey = key
        tunnelSlab = main
        stage.setLayout({ length, width, zones, box: main, pads, markings: true, carLine: conveyor ? CAR.z : null, height: Math.ceil(tallest) })
        // Until someone moves the camera it stays on its preset, refitted to the drawing.
        refit()
      }
    }
    trip = conveyor ? carTrip(conveyor.x - conveyor.w / 2, conveyor.x + conveyor.w / 2, tunnelSlab.minX, tunnelSlab.maxX) : null
    conveyorItem = conveyor
    if (trip && !vehicle) {
      vehicle = createVehicle(kit)
      stage.world.add(vehicle.root)
    }
    if (vehicle) vehicle.root.visible = !!trip
  }

  let readyWanted = false
  let readySaid = false

  const setData = (d: SceneData) => {
    if (disposed) return
    data = d
    const width = Number(d.layout.width_ft) || 16
    const first = items.length === 0
    let built = false

    const seen = new Set<string>()
    tallest = 11
    for (const item of d.items) {
      seen.add(item.id)
      const sig = signature(item, width)
      let it = byId.get(item.id)
      if (!it || builtFrom.get(item.id) !== sig) {
        if (it) removeModel(it)
        const scenery = !!shapeFor(item.kind).scenery
        const lies = inTunnel(item) && turned(item)
        const model = buildModel({
          item, w: Number(lies ? item.h_ft : item.w_ft), h: Number(lies ? item.w_ft : item.h_ft), side: item.side, y: Number(item.y_ft),
          rotation: Number(item.rotation) || 0, tunnelWidth: width, detail: stage.detail, kit,
        })
        const picks: Object3D[] = []
        if (!scenery) {
          model.root.traverse((o) => { if (o.userData.pick) picks.push(o) })
          // A model that names no pick shapes gets one box around all of it.
          if (!picks.length) {
            _box.setFromObject(model.root)
            if (!_box.isEmpty()) {
              _box.getSize(_size)
              _box.getCenter(_center)
              picks.push(kit.pickBox(model.root, Math.max(_size.x, 1), Math.max(_size.y, 1), Math.max(_size.z, 1), _center.x, _center.y, _center.z))
            }
          }
          for (const p of picks) p.userData.itemId = item.id
        }
        const fresh: LiveItem = { id: item.id, key: item.asset_id ?? item.id, item, asset: null, scenery, model, picks, x: Number(item.x_ft), y: Number(item.y_ft), w: 0, h: 0, running: false }
        if (it) items[items.indexOf(it)] = fresh
        else items.push(fresh)
        it = fresh
        byId.set(item.id, it)
        builtFrom.set(item.id, sig)
        stage.world.add(model.root)
        built = true
      }
      it.item = item
      it.key = item.asset_id ?? item.id
      it.asset = item.asset_id ? d.assets[item.asset_id] ?? null : null
      it.running = isRunning(it)
      place(it)
      tallest = Math.max(tallest, it.model.height)
    }
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k]
      if (seen.has(it.id)) continue
      removeModel(it)
      items.splice(k, 1)
      byId.delete(it.id)
      builtFrom.delete(it.id)
    }
    // The machine being dragged was deleted from under the drag.
    if (drag && !byId.has(drag.id)) drag = null

    plan()
    if (first && items.length && !opts.reducedMotion) startSettle()
    status.sync()
    relive()
    interaction.sync()
    relight()
    refresh(0)
    stage.refreshShadows()
    // New models may bring shaders the GPU hasn't seen: compile them off the main
    // thread. Nothing is drawn until they're ready, so the page never freezes on them.
    if (built || !readyWanted) void stage.compile()
    readyWanted = true
    stage.invalidate()
  }

  // ---- Life: the car and what it wakes up ----
  const car: CarAt = { x: 0, scale: 1, progress: 0 }
  const carState: CarState = { x: 0, t: 0, dt: 0, speed: 0, presence: 1 }
  let carOn = false
  const run: RunState = { t: 0, dt: 0, running: false, activity: 0, carDx: null }

  // What follows scene time while the scene plays. moves: the car (its conveyor is up) or
  // a machine that's up (its model may animate with no car near it). flashes: a broken
  // machine's stack light, which the status layer flashes on scene time (it says when the
  // light next changes). With neither, every frame would be the same picture: the loop
  // idles while playing, as it does paused. With only the light, a frame is drawn at each
  // of its edges and the loop sleeps in between (see the loop). Worked out again whenever
  // the data or the options change, after the status layer has caught up with them.
  let moves = false
  let flashes = false
  const relive = () => {
    moves = (!!trip && !!conveyorItem?.running) || items.some((it) => it.running && !!it.model.update)
    flashes = Number.isFinite(status.nextChange?.(t) ?? Infinity)
  }

  // Sleeping between the light's edges: one timer, for the next one. Whichever frame comes
  // first, that timer's or one asked for by anything else, ends the doze and the loop
  // decides afresh. t and now are the scene time and frame time it fell asleep at; until
  // is the scene time of the edge; due once the timer has fired.
  type Doze = { t: number; now: number; until: number; due: boolean }
  let doze: Doze | null = null
  let dozeTimer = 0
  const rouse = () => {
    clearTimeout(dozeTimer)
    dozeTimer = 0
    doze = null
  }
  const sleepUntil = (until: number, now: number) => {
    const d: Doze = { t, now, until, due: false }
    doze = d
    dozeTimer = window.setTimeout(() => {
      dozeTimer = 0
      d.due = true
      stage.invalidate()
    }, Math.max(0, (until - t) * 1000))
  }

  // Puts the car where it is at time t and tells every model what it should be doing.
  const refresh = (dt: number) => {
    kit.time.value = t
    carOn = false
    let moving = false
    if (trip && vehicle) {
      moving = !!conveyorItem && conveyorItem.running
      if (moving) carAt(trip, t, car)
      else {
        // The conveyor is down: the car waits short of the entrance and nothing wakes.
        car.x = PARKED_NOSE_X - CAR.length / 2
        car.scale = 1
        car.progress = 0
      }
      carOn = true
      carState.x = car.x
      carState.t = t
      carState.dt = dt
      carState.speed = moving ? CAR.speed : 0
      carState.presence = car.scale
      vehicle.update(carState)
    }
    run.t = t
    run.dt = dt
    for (const it of items) {
      if (!it.model.update) continue
      run.running = it.running
      if (inTunnel(it.item)) {
        run.carDx = carOn ? car.x - it.x : null
        // A parked car wakes nothing.
        run.activity = it.running && moving ? activityAt(car.x - it.x, it.w / 2) : 0
      } else {
        // Beside the tunnel the car is out of reach: a machine that's up simply runs.
        run.carDx = null
        run.activity = it.running ? 1 : 0
      }
      it.model.update(run)
    }
  }

  // ---- First load: machines drop into place, entrance first ----
  let settle: { from: number; delay: Map<string, number>; total: number } | null = null
  const startSettle = () => {
    const order = [...items].sort((a, b) => a.x - b.x)
    const step = Math.min(24, 760 / Math.max(1, order.length))
    const delay = new Map<string, number>()
    order.forEach((it, k) => delay.set(it.id, k * step))
    // The clock starts once the first frame is on screen, or the drop would be over
    // before anyone saw it.
    settle = { from: -1, delay, total: order.length * step + DROP_MS }
    stepSettle(0)
  }
  const stepSettle = (now: number): boolean => {
    if (!settle) return false
    if (settle.from < 0 && stage.frames() > 0) settle.from = now
    const elapsed = settle.from < 0 ? 0 : now - settle.from
    for (const it of items) {
      if (drag?.id === it.id) continue
      const p = MathUtils.clamp((elapsed - (settle.delay.get(it.id) ?? 0)) / DROP_MS, 0, 1)
      it.model.root.position.y = (1 - easeOut(p)) * DROP_FT
    }
    // Shadows follow the machines down.
    stage.refreshShadows()
    if (elapsed >= settle.total) settle = null
    return true
  }
  const endSettle = () => {
    if (!settle) return
    settle = null
    for (const it of items) if (drag?.id !== it.id) it.model.root.position.y = 0
    stage.refreshShadows()
  }

  // ---- Camera ----
  let preset: CameraPreset = 'overview'
  // True once the person (or a saved pose) has put the camera somewhere of their own.
  let userMoved = false
  // The showroom's slow turn has been stopped by a press, or by the pose becoming the
  // person's own while it ran.
  let showroomStopped = false
  // Someone moved the camera and the page hasn't been told where it came to rest yet.
  let restOwed = false
  const _sph = new Spherical()
  const _off = new Vector3()
  // e is how far along its easing the camera was last put; e0 how far along it was when
  // the glide set off from where it starts (0, unless it was re-aimed in flight). to, for a
  // glide to a preset or a machine: where it is headed as things fit now (see refit).
  type Tween = { from: number; ms: number; e0: number; e: number; t0: Vector3; t1: Vector3; r0: number; r1: number; th0: number; th1: number; ph0: number; ph1: number; fov0: number; fov1: number; done?: () => void; to?: () => CameraPose }
  let tween: Tween | null = null

  const getPose = (): CameraPose => ({
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
  })

  // The scene is putting the camera somewhere itself: not the person's doing, even with
  // a finger resting on the canvas.
  let placing = false
  const applyPose = (p: CameraPose) => {
    camera.position.set(p.position[0], p.position[1], p.position[2])
    controls.target.set(p.target[0], p.target[1], p.target[2])
    camera.lookAt(controls.target)
    placing = true
    controls.update()
    placing = false
    stage.invalidate()
  }

  const setFov = (fov: number) => {
    if (camera.fov === fov) return
    camera.fov = fov
    camera.updateProjectionMatrix()
    kit.setViewport(stage.size().h * stage.renderer.getPixelRatio(), fov)
  }

  // A glide sets off from wherever the camera is now.
  const setOff = (tw: Tween) => {
    tw.e0 = tw.e
    tw.t0.copy(controls.target)
    _sph.setFromVector3(_off.copy(camera.position).sub(controls.target))
    tw.r0 = _sph.radius
    tw.th0 = _sph.theta
    tw.ph0 = _sph.phi
    tw.fov0 = camera.fov
  }
  // Where a glide is headed.
  const aim = (tw: Tween, p: CameraPose) => {
    tw.t1.set(p.target[0], p.target[1], p.target[2])
    _sph.setFromVector3(_off.set(p.position[0], p.position[1], p.position[2]).sub(tw.t1))
    // Turn the short way round.
    let th1 = _sph.theta
    while (th1 - tw.th0 > Math.PI) th1 -= Math.PI * 2
    while (th1 - tw.th0 < -Math.PI) th1 += Math.PI * 2
    tw.r1 = _sph.radius
    tw.th1 = th1
    tw.ph1 = _sph.phi
  }

  // Glide from where the camera is to a pose: the target slides, and the camera swings
  // around it (angle and distance each eased) so it never cuts through the machines.
  const glide = (p: CameraPose, ms: number, fov = camera.fov, done?: () => void, to?: () => CameraPose) => {
    if (ms <= 0 || opts.reducedMotion) {
      tween = null
      setFov(fov)
      applyPose(p)
      done?.()
      return
    }
    const tw: Tween = { from: performance.now(), ms, e0: 0, e: 0, t0: new Vector3(), t1: new Vector3(), r0: 0, r1: 0, th0: 0, th1: 0, ph0: 0, ph1: 0, fov0: 0, fov1: fov, done, to }
    setOff(tw)
    aim(tw, p)
    tween = tw
    stage.invalidate()
  }
  const stepTween = (now: number): boolean => {
    const tw = tween
    if (!tw) return false
    const p = MathUtils.clamp((now - tw.from) / tw.ms, 0, 1)
    tw.e = easeInOut(p)
    // Re-aimed in flight, the rest of the easing carries it from where it was then.
    const e = p >= 1 || tw.e0 >= 1 ? 1 : MathUtils.clamp((tw.e - tw.e0) / (1 - tw.e0), 0, 1)
    controls.target.lerpVectors(tw.t0, tw.t1, e)
    _sph.set(MathUtils.lerp(tw.r0, tw.r1, e), MathUtils.lerp(tw.ph0, tw.ph1, e), MathUtils.lerp(tw.th0, tw.th1, e))
    camera.position.setFromSpherical(_sph).add(controls.target)
    camera.lookAt(controls.target)
    setFov(MathUtils.lerp(tw.fov0, tw.fov1, e))
    // The controls hear of each step here, as the scene's doing. Left to the stage's own
    // update after the tick, the last step would reach them with the glide already over,
    // and count as the person's if a button is resting on the canvas.
    placing = true
    controls.update()
    placing = false
    if (p >= 1) {
      tween = null
      tw.done?.()
    }
    return true
  }

  // The canvas, the floor or the free area changed. A camera on its preset is fitted to it
  // again, and one gliding to its preset or to a machine is re-aimed in flight: it lands
  // where that fits now, when it would have landed. A pose of the person's own stays; the
  // ride refits as it ends.
  const refit = () => {
    if (riding || !stage.layout) return
    if (tween?.to) {
      setOff(tween)
      aim(tween, tween.to())
      stage.invalidate()
    } else if (!userMoved && !tween) applyPose(presetNow())
  }

  // ---- The free area ----
  // The widget's HTML covers some of the canvas (setInset). The stage shifts the picture so
  // its middle is the middle of what's left and fits presets into it; here the change is
  // eased, so the picture never jumps. On a preset the camera is fitted to the free area as
  // it is at each step (a glide to a preset is re-aimed at each step), so the two move as
  // one. Under a pose of the person's own only the middle slides over. A glide to a machine
  // sizes it for the free area it will end in, and is re-aimed once when that changes. The
  // ride honors it too: what the car rides toward stays in the middle of what can be seen.
  // None of it is the person moving the camera: no own(), no rest owed.
  const ZERO: Inset = { top: 0, right: 0, bottom: 0, left: 0 }
  // As asked (cleaned), what the stage shows now, and the easing between.
  let insetTo = ZERO
  let insetShown = ZERO
  let insetEase: { from: Inset; to: Inset; t0: number; ms: number } | null = null
  const showInset = (i: Inset) => {
    insetShown = i
    stage.setInset(i)
  }
  // At each step of the easing: the camera follows the free area as it is now.
  const follow = () => {
    if (riding || !stage.layout) return
    if (tween?.to) aim(tween, tween.to())
    // The showroom's turn fits itself at each step (followTurn); at the entrance, a close
    // view that ignores the angle, only the middle moves.
    else if (!tween && !userMoved && !controls.autoRotate) applyPose(presetNow())
  }
  const stepInset = (now: number): boolean => {
    const ie = insetEase
    if (!ie) return false
    const p = MathUtils.clamp((now - ie.t0) / ie.ms, 0, 1)
    if (p >= 1) {
      insetEase = null
      // As asked, so a resize clamps it afresh to the new canvas.
      showInset(insetTo)
    } else {
      const e = easeInOut(p)
      const at = (k: keyof Inset) => MathUtils.lerp(ie.from[k], ie.to[k], e)
      showInset({ top: at('top'), right: at('right'), bottom: at('bottom'), left: at('left') })
    }
    follow()
    return true
  }
  const setInset = (i: Inset) => {
    if (disposed) return
    const next = cleanInset(i)
    if (next.top === insetTo.top && next.right === insetTo.right && next.bottom === insetTo.bottom && next.left === insetTo.left) return
    insetTo = next
    // Nothing on screen yet, or no motion wanted: there is nothing to ease from.
    if (stage.frames() === 0 || opts.reducedMotion) {
      insetEase = null
      showInset(next)
      refit()
      return
    }
    // Eased between the insets as this canvas applies them: an inset far larger than the
    // canvas would otherwise reach its clamp in the first instant.
    const { w, h } = stage.size()
    insetEase = { from: freeArea(insetShown, w, h), to: freeArea(next, w, h), t0: performance.now(), ms: !userMoved && !riding ? GLIDE_MS : INSET_OWN_MS }
    // A glide to a machine is headed for the free area it will end in: re-aimed now. A
    // camera at rest is left to follow() (refit would put a turning showroom back on its
    // entrance pose in one step).
    if (tween?.to) refit()
    stage.invalidate()
  }

  // The showroom turns the camera about the drawing (OrbitControls' autoRotate). A pose
  // fitted for one angle runs off the canvas a quarter turn later, so a camera on its
  // preset is fitted again for the angle the turn has reached, before each step. A pose
  // of the person's own can't be fitted again without undoing what they did (their zoom,
  // slide or tilt), so the turn only ever runs on the preset.
  const applyTurn = () => {
    controls.autoRotate = opts.mode === 'preview' && !opts.reducedMotion && !showroomStopped && !riding && !userMoved
    controls.autoRotateSpeed = 0.3
  }
  // The pose is the person's own from here: a gesture, a zoom, a fly-to, a saved pose put
  // back. A turn that was running stops for good, as it does for a press (a saved pose came
  // from one); one that wasn't (the site view) may start once a preset is picked again.
  const own = () => {
    userMoved = true
    if (controls.autoRotate) {
      controls.autoRotate = false
      showroomStopped = true
    }
  }
  const turnedTo = () => {
    _off.copy(camera.position).sub(controls.target)
    return MathUtils.radToDeg(Math.atan2(-_off.x, _off.z))
  }
  const presetNow = () => stage.presetPose(preset, controls.autoRotate ? turnedTo() : undefined)
  const followTurn = () => {
    const p = presetNow()
    // Not applyPose: the controls take their step from here after the tick, and an update
    // of its own would add a second one.
    camera.position.set(p.position[0], p.position[1], p.position[2])
    controls.target.set(p.target[0], p.target[1], p.target[2])
  }

  // The camera came to rest: tell the page once it has been still for a moment, and only
  // when someone moved it (an orbit, a zoom, a preset, a fly-to). Loading, a resize and
  // setPose tell the page nothing it doesn't know. Not while the camera is being driven
  // (a glide, the ride, the showroom's turn).
  let restTimer = 0
  const armRest = () => {
    clearTimeout(restTimer)
    if (!restOwed || riding || controls.autoRotate) return
    restTimer = window.setTimeout(() => {
      if (disposed || !restOwed) return
      // Still gliding: the next change event tries again.
      if (tween || riding) return armRest()
      restOwed = false
      events.onCameraRest(getPose(), userMoved ? null : preset)
    }, 260)
  }
  // Every press on the canvas starts one of the controls' gestures ('start'), a click to
  // deselect or a tap included. The pose becomes the person's own only once the gesture
  // moves the camera; until then it stays on its preset, refitted to the canvas. A glide
  // is the scene's doing even if a gesture's 'end' never came.
  let gesture = false
  const onControlStart = () => { gesture = true }
  const onControlEnd = () => { gesture = false }
  const onControlChange = () => {
    // A zoom (the wheel, a trackpad pinch) needs no press, so it can come while the
    // showroom turns: own() stops the turn here, and the rest is told as for any gesture.
    if (gesture && !placing && !tween) {
      own()
      restOwed = true
    }
    armRest()
  }
  controls.addEventListener('start', onControlStart)
  controls.addEventListener('end', onControlEnd)
  controls.addEventListener('change', onControlChange)

  // A finger never comes down and up quite still, and a mouse not always. A press that
  // stays within a click's few pixels (clickSlop) is a click or a tap, and the camera
  // doesn't turn or slide for it: otherwise every tap would nudge the view and make the
  // pose the person's own. So the controls' turn and slide are held from the press's first
  // move until it travels further. OrbitControls keeps the point the press began at, so
  // its next move then brings the camera the whole way at once. interaction.ts holds the
  // turn for an undecided inline swipe the same way: each side gives back only what it took.
  let press: { id: number; x: number; y: number; type: string } | null = null
  let held: { rotate: boolean; pan: boolean } | null = null
  const hold = () => {
    if (held || !controls.enabled) return
    held = { rotate: controls.enableRotate, pan: controls.enablePan }
    controls.enableRotate = false
    controls.enablePan = false
  }
  const unhold = () => {
    if (!held) return
    if (held.rotate) controls.enableRotate = true
    if (held.pan) controls.enablePan = true
    held = null
  }
  // On the canvas's parent, capturing, so it runs before OrbitControls hears the press and
  // decides from those flags what it does: anything a lost release left held goes back
  // first. A second finger makes it a pinch, which is always the camera's.
  const onPressDown = (e: PointerEvent) => {
    unhold()
    press = e.target === stage.dom && e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType } : null
  }
  // On the canvas, which has the pointer while OrbitControls has the press: this runs
  // before its own listener, on the document, hears the move.
  const onPressMove = (e: PointerEvent) => {
    const p = press
    if (!p || p.id !== e.pointerId) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= clickSlop(p.type)) return hold()
    press = null
    unhold()
  }
  const onPressEnd = (e: PointerEvent) => {
    if (press && press.id !== e.pointerId) return
    press = null
    unhold()
  }
  container.addEventListener('pointerdown', onPressDown, true)
  stage.dom.addEventListener('pointermove', onPressMove)
  stage.dom.addEventListener('pointerup', onPressEnd)
  stage.dom.addEventListener('pointercancel', onPressEnd)

  const owe = () => {
    restOwed = true
    armRest()
  }

  const setPreset = (p: CameraPreset, o: { instant?: boolean } = {}) => {
    if (disposed) return
    if (riding) ride(false)
    preset = p
    userMoved = false
    // Back on a preset, the showroom may turn again, unless a press stopped it.
    applyTurn()
    glide(stage.presetPose(p), o.instant ? 0 : GLIDE_MS, camera.fov, undefined, () => stage.presetPose(preset))
    owe()
  }

  // Where flyTo puts the camera for a machine, looking along dir: it comes in until the
  // machine fills about half the height of the free area it will end in.
  const flyPose = (it: LiveItem, dir: Vector3): CameraPose => {
    const size = Math.max(it.model.height, Math.hypot(it.w, it.h) * 0.8, 6)
    const half = Math.tan(MathUtils.degToRad(camera.fov / 2)) * stage.fill(insetTo)
    const dist = MathUtils.clamp(size / 0.46 / (2 * half), controls.minDistance, controls.maxDistance * 0.7)
    const ty = Math.min(it.model.height * 0.42, 4.6)
    return { position: [it.x + dir.x * dist, ty + dir.y * dist, it.y + dir.z * dist], target: [it.x, ty, it.y] }
  }

  const flyTo = (id: string, o: { instant?: boolean } = {}) => {
    const it = byId.get(id)
    if (!it || disposed) return
    if (riding) ride(false)
    // Keep the angle the person is looking from: move the point they circle.
    const dir = camera.position.clone().sub(controls.target).normalize()
    // From straight overhead a machine is a rectangle: tip down to a three-quarter view.
    if (dir.y > 0.94) dir.set(dir.x, 0.94, dir.z).normalize()
    let pose = flyPose(it, dir)
    // Re-aimed (refit), it heads for the machine as it stands and fits then.
    const to = () => {
      const now = byId.get(id)
      if (now) pose = flyPose(now, dir)
      return pose
    }
    own()
    const far = Math.hypot(pose.target[0] - controls.target.x, pose.target[1] - controls.target.y, pose.target[2] - controls.target.z)
    glide(pose, o.instant ? 0 : MathUtils.clamp(450 + far * 3, 450, 900), camera.fov, undefined, to)
    owe()
  }

  const zoomBy = (factor: number) => {
    if (riding || disposed) return
    _off.copy(camera.position).sub(controls.target)
    const dist = MathUtils.clamp(_off.length() * factor, controls.minDistance, controls.maxDistance)
    _off.setLength(dist).add(controls.target)
    own()
    glide({ position: [_off.x, _off.y, _off.z], target: [controls.target.x, controls.target.y, controls.target.z] }, 220)
    owe()
  }

  // ---- The ride: the camera on the car's hood ----
  // The car runs for the ride even while the scene is paused: asking for it is asking
  // for motion.
  let riding = false
  let rideBack: CameraPose | null = null
  let rideSaid = ''
  // Where the car was when the ride began: progress is measured from there to the exit.
  let rideFromX = 0
  const _eye = new Vector3()
  const _aim = new Vector3()
  const rideCamera = () => {
    _eye.set(car.x + 2.6, 5.05, CAR.z)
    _aim.set(car.x + 40, 4.2, CAR.z)
    camera.position.copy(_eye)
    controls.target.copy(_aim)
    camera.lookAt(_aim)
  }
  const nearest = (): string | null => {
    let best: string | null = null
    let bestGap = 9
    for (const it of items) {
      if (it.scenery || it.item.kind === 'conveyor' || !inTunnel(it.item)) continue
      const gap = Math.abs(it.x - (car.x + CAR.length / 2))
      if (gap < bestGap) {
        bestGap = gap
        best = it.id
      }
    }
    return best
  }
  const sayRide = () => {
    const near = riding ? nearest() : null
    const progress = riding && trip ? MathUtils.clamp((car.x - rideFromX) / Math.max(1, trip.to - rideFromX), 0, 1) : 0
    const said = `${riding}|${Math.round(progress * 200)}|${near}`
    if (said === rideSaid) return
    rideSaid = said
    events.onRide({ active: riding, progress, nearId: near })
  }
  const ride = (on: boolean) => {
    if (disposed || on === riding) return
    if (on && (!trip || !conveyorItem?.running)) {
      // Nothing to ride: say so, or the page's button would stay pressed.
      events.onRide({ active: false, progress: 0, nearId: null })
      return
    }
    riding = on
    tween = null
    // The ride sets scene time itself.
    rouse()
    if (on) {
      rideBack = getPose()
      controls.enabled = false
      applyTurn()
      endSettle()
      // Start the pass over, a few feet before the entrance.
      t = Math.max(0, (-CAR.length - (trip?.from ?? 0)) / CAR.speed)
      setFov(RIDE_FOV)
      refresh(0)
      rideFromX = car.x
      rideCamera()
    } else {
      controls.enabled = true
      setFov(baseFov)
      // The canvas or the floor may have changed during the ride, and their refits wait
      // for it: a camera on its preset is fitted again, a pose of the person's own is put back.
      if (!userMoved && stage.layout) applyPose(stage.presetPose(preset))
      else if (rideBack) applyPose(rideBack)
      rideBack = null
      // A showroom on its preset turns on from there; nothing stopped it but the ride.
      applyTurn()
    }
    sayRide()
    stage.invalidate()
  }

  // ---- Pinned HTML ----
  const pins = new Map<HTMLElement, { id: string; at: 'top' | 'base' }>()
  const _pin = new Vector3()
  const placePins = () => {
    if (!pins.size) return
    const { w, h } = stage.size()
    for (const [el, pin] of pins) {
      const it = byId.get(pin.id)
      let off = true
      if (it) {
        _pin.set(it.model.root.position.x, it.model.root.position.y + (pin.at === 'top' ? it.model.height + 0.5 : 0), it.model.root.position.z).project(camera)
        off = _pin.z < -1 || _pin.z > 1 || Math.abs(_pin.x) > 1 || Math.abs(_pin.y) > 1
        el.style.transform = `translate3d(${((_pin.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-_pin.y * 0.5 + 0.5) * h).toFixed(1)}px,0)`
      }
      el.dataset.offscreen = off ? 'true' : 'false'
    }
  }
  stage.setAfterRender(() => {
    placePins()
    if (readyWanted && !readySaid) {
      readySaid = true
      events.onReady()
    }
  })

  // ---- The loop ----
  stage.setTick((dt, now) => {
    // Whatever woke the loop, a doze is over: this frame decides afresh.
    const dozed = doze
    rouse()
    // Playing, and nothing follows scene time but a broken machine's stack light.
    const lightOnly = !riding && opts.playing && !moves && flashes
    // Before the glide's step: it may be re-aimed at the free area as it is this frame.
    let busy = stepInset(now)
    if (stepTween(now)) busy = true
    if (stepSettle(now)) busy = true
    if (riding || (opts.playing && moves)) {
      t += dt
      refresh(dt)
      busy = true
      if (riding) {
        rideCamera()
        // One pass and the ride is over.
        if (!conveyorItem?.running || car.progress > 0.985) ride(false)
        else sayRide()
      }
    } else if (lightOnly) {
      // Frames come far apart now, so scene time keeps up with the clock rather than the
      // capped dt: at least to the edge the doze was for once its timer has fired, and no
      // further past it than a late frame (a tab hidden for minutes lands on the edge).
      // Nothing else on the slab follows time here: the car stands, and so does every
      // machine that's up, so the models are not told.
      if (!dozed) t += dt
      else t = MathUtils.clamp(dozed.t + (now - dozed.now) / 1000, dozed.due ? dozed.until : dozed.t, dozed.until + DOZE_LATE)
    }
    if (controls.autoRotate) {
      // The turn only runs on a preset (applyTurn), and follows it; a glide is left to turn
      // as it is, and so is the entrance, a close view that ignores the angle.
      if (!userMoved && !tween && preset !== 'entrance') followTurn()
      busy = true
    }
    // The layers ease on real time, so they keep going while the scene is paused.
    if (interaction.update(dt, now)) busy = true
    if (status.update(dt, now)) busy = true
    // Nothing else wants the next frame: rather than draw the same picture at the
    // display's rate, sleep until the light next changes.
    if (lightOnly && !busy) {
      const until = status.nextChange?.(t) ?? Infinity
      if (Number.isFinite(until)) sleepUntil(until, now)
    }
    return busy
  })
  stage.setOnResize(refit)

  applyTurn()
  applyPose(stage.presetPose(preset))

  return {
    setData,
    setOptions(o) {
      if (disposed) return
      const was = { ...opts }
      Object.assign(opts, o)
      if (opts.theme !== was.theme) stage.setTheme(opts.theme)
      if (opts.mode !== was.mode) {
        for (const it of items) it.running = isRunning(it)
      }
      if (opts.reducedMotion && !was.reducedMotion) endSettle()
      // Into the showroom, or motion allowed again: it turns if the camera is on its preset.
      if (opts.mode !== was.mode || opts.reducedMotion !== was.reducedMotion) applyTurn()
      status.sync()
      interaction.sync()
      relight()
      relive()
      // A machine that went down while paused, or while nothing else moves, still has to
      // come to rest: the loop won't do it.
      if (!opts.playing || !moves) refresh(0)
      stage.invalidate()
    },
    pin(el, id, at = 'top') {
      if (disposed) return
      if (id == null) pins.delete(el)
      else pins.set(el, { id, at })
      stage.invalidate()
    },
    focus(id) {
      if (disposed) return
      focusId = id
      relight()
    },
    flyTo,
    setPreset,
    zoomBy,
    getPose,
    setPose(p) {
      if (disposed) return
      if (riding) ride(false)
      tween = null
      own()
      applyPose(p)
    },
    setInset,
    ride,
    setTime(time) {
      if (disposed) return
      // A doze would carry on from the time it fell asleep at.
      rouse()
      // Everything that eases finishes at once, and the models get a short run-up to
      // the moment so anything with momentum (a brush's angle) is where it would be.
      if (insetEase) stepInset(insetEase.t0 + insetEase.ms)
      if (tween) {
        const tw = tween
        stepTween(tw.from + tw.ms)
      }
      endSettle()
      const steps = 40
      const dt = 1 / 20
      for (let k = steps; k >= 0; k--) {
        t = Math.max(0, time - k * dt)
        refresh(k === steps ? 0 : dt)
      }
      if (riding) rideCamera()
      stage.invalidate()
    },
    stats: stage.stats,
    dispose() {
      if (disposed) return
      disposed = true
      clearTimeout(restTimer)
      rouse()
      controls.removeEventListener('change', onControlChange)
      controls.removeEventListener('start', onControlStart)
      controls.removeEventListener('end', onControlEnd)
      container.removeEventListener('pointerdown', onPressDown, true)
      stage.dom.removeEventListener('pointermove', onPressMove)
      stage.dom.removeEventListener('pointerup', onPressEnd)
      stage.dom.removeEventListener('pointercancel', onPressEnd)
      unhold()
      interaction.dispose()
      status.dispose()
      for (const it of items) removeModel(it)
      items.length = 0
      byId.clear()
      pins.clear()
      if (vehicle) {
        stage.world.remove(vehicle.root)
        vehicle.dispose()
      }
      stage.dispose()
    },
  }
}
