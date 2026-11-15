import { Raycaster, Vector3 } from 'three'
import type { Intersection, Material, Mesh, MeshStandardMaterial, Object3D } from 'three'
import { maxCarsOf, toneFor } from '../tones'
import type { Tone } from '../tones'
import { CAR } from './car'
import type { LookTweak } from './kit'
import { createMarkMaterial, createMarks, createStackLights, createToneCaps, STATUS_COLORS, tonePaint } from './statusParts'
import type { StackLights, ToneCaps, TonePaint } from './statusParts'
import type { LiveItem, SceneContext, StatusLayer } from './types'

// How a machine's state is drawn on top of its model. The exported signature is the
// contract and is frozen (see types.ts):
//   createStatusLayer(ctx) -> StatusLayer { sync(), setLit(ids), update(dt, now), nextChange(t), dispose() }
//
// It works on any model, knowing only its meshes and their materials, userData.pick / fx
// / blob, model.height, model.beacon and model.cap. Which tone a machine has is decided in
// ../tones.ts, the same rules the 2D diagram uses, so the two views always agree.
//
// WHAT IT DRAWS
//   Lit (hover, keyboard focus, selection): the machine glows in the accent color and an
//     accent pad lights the floor under it, eased in and out over about 120 ms. Every
//     shape linked to the same machine lights together. The selected shape glows a little
//     stronger and gets four corner brackets that stay while it is selected.
//   Not linked (site mode): a translucent ghost with a dashed outline on the floor, no
//     shadow. In preview mode everything is solid.
//   Color by status: real materials. A machine that is down gets a pad (broken: red and
//     hatched; planned: a solid amber band) and a stack light at model.beacon (broken: the
//     red lens on top, double flash; planned: the amber lens in the middle, steady).
//   Color by usage, work orders, sticker: bodies turn neutral clay, and each linked
//     machine carries its tone as a floor pad and as a cap on top of it.
//   Retired: darker matte clay, a dashed gray pad, no light.
//   Move mode: a foot ruler along the tape the floor already paints, a thin outline around
//     everything that can be picked up, an outline where a moved machine is saved with a
//     line back to it, and while dragging: where it was picked up, a guide along its
//     travel, and amber on whatever it overlaps.
//
// HOW
//   Looks. A mesh never has its own material changed: it is handed the kit's copy of it
//     in a list of looks (kit.variant), a body look ('ghost', 'clay', 'retired' or none)
//     followed by a glow step, and what it wore when first seen is kept, so every mode
//     gives back exactly the materials the model was built with.
//   Floor shapes. All steady ones are one mesh, redrawn only when something they show
//     changes; lit pads and brackets are a second, small one, redrawn while they ease.
//   Stack lights are three instanced draws between them, caps one. None of it is drawn
//     (or made) while nothing is lit, down or toned. Far off, a light or cap stands up to
//     twice its size so it still reads from the overview (statusParts.ts).
//   Time. Glow and pads ease on real time; update() returns true only while they do. The
//     flash runs on scene time and update() never asks for frames for it: nextChange()
//     tells the scene when the light next changes, and when nothing else moves the scene
//     draws a frame only then. Unless scene time runs by itself (ctx.timeRunning: not
//     paused, not under reduced motion) a broken machine's light simply stays on.

// What goes under the glow: nothing (the model's own materials), or one body look.
type Base = '' | 'ghost' | 'clay' | 'retired'

// The glow, in quarter steps of the kit's 'lit' look. Hover eases up to 'lit' (step 4);
// the selection goes two further.
const STEPS = ['', 'lit1', 'lit2', 'lit3', 'lit', 'lit5', 'lit6'] as const
const HOVER_STEP = 4
// The kit's 'lit' emissive strength, which the other steps are fractions of.
const GLOW = 0.22
const EASE_MS = 120

// Feet. How far a pad reaches past the footprint, and how high floor shapes lie.
const TONE_MARGIN = 0.45
// No further than the curbs along the walls are wide, or a machine that spans the tunnel
// shows a sliver of its pad on their far side.
const LIT_MARGIN = 0.6
const BRACKET_MARGIN = 0.9
const CORNER = 0.5
const MARK_Y = 0.03
// Where floor.ts paints its tape measure: this far outside the passenger side wall line
// (its curb plus a gap). It has a tick every 5 ft and a number every 10, from 0 to the
// tunnel's length. The ruler here adds to it and never repeats it.
const TAPE = 0.9
// A machine lower than this shows its pad from every side: it needs no cap on top.
const CAP_MIN_HEIGHT = 1.5

type Wore = { material: Material | Material[]; cast: boolean }

type Rec = {
  item: LiveItem
  // The model these were gathered from: a rebuilt model starts over.
  root: Object3D
  meshes: Mesh[]
  blobs: Object3D[]
  // What the meshes wear now.
  base: Base
  step: number
  // Hover and selection, 0 to 1, and where each is heading.
  h: number
  hTo: number
  s: number
  sTo: number
  tone: Tone | null
  paint: TonePaint | null
  // Where the floor shapes were last drawn for it, and how high the floor is there.
  x: number
  y: number
  ground: number
  groundAt: string
  // Its stack light or cap (-1: none), where on the model it stands, and where the model
  // was when it was last placed.
  light: number
  cap: number
  bx: number
  by: number
  bz: number
  px: number
  py: number
  pz: number
  pr: number
  pass: number
}

const glow = (share: number): LookTweak => (copy, p) => {
  // Lenses already glow in their own color: leave them, as 'lit' does.
  if (!copy.emissive || copy.userData.glows) return
  copy.emissive.set(p.accent)
  copy.emissiveIntensity = GLOW * share
}

// Matte, one color, nothing mirrored: the model reads as a clay maquette, so the tones
// on the floor and on top are the only color in the picture.
const clay = (body: () => string): LookTweak => (copy) => {
  // A model may bring a material of its own that isn't a standard one: only what it has
  // is changed, and one with no color (a custom shader) is left as it is.
  const m = copy as Material & Partial<Pick<MeshStandardMaterial, 'color' | 'map' | 'emissive' | 'emissiveIntensity' | 'roughness' | 'metalness' | 'roughnessMap' | 'metalnessMap' | 'envMap'>> & { clearcoat?: number }
  if (!m.color?.isColor) return
  m.color.set(body())
  // Foam keeps its cloth map, which only shades the strips root to tip.
  if (m.map && !(m.alphaTest > 0)) m.map = null
  m.vertexColors = false
  if (m.emissive) m.emissiveIntensity = 0
  if (m.roughness !== undefined) {
    m.roughness = 0.94
    m.metalness = 0
    m.roughnessMap = null
    m.metalnessMap = null
    m.envMap = null
  }
  if (m.clearcoat) m.clearcoat = 0
  // Foam brushes drop their per-strip colors.
  m.defines = { ...m.defines, T3D_FLAT: '' }
}

const smooth = (v: number) => v * v * (3 - 2 * v)
const toward = (v: number, to: number, by: number) => (v < to ? Math.min(to, v + by) : Math.max(to, v - by))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
// Equal, counting two missing numbers as equal (a bad row must not redraw forever).
const same = (a: number, b: number) => a === b || (a !== a && b !== b)
const movable = (it: LiveItem) => !it.scenery && it.item.kind !== 'conveyor'
const stepOf = (rec: Rec) => Math.round((rec.h + 0.5 * rec.s) * HOVER_STEP)

// Two flashes, then dark, every 1.1 s: lit from 0 to 0.2 s and from 0.32 to 0.52 s.
const CYCLE = 1.1
const EDGES = [0.2, 0.32, 0.52, CYCLE] as const
const phase = (t: number) => ((t % CYCLE) + CYCLE) % CYCLE
const flashing = (t: number) => {
  const at = phase(t)
  return at < EDGES[0] || (at >= EDGES[1] && at < EDGES[2])
}
// The scene time of the flash's next edge after t, a hair past it: a frame drawn then is
// past the edge whatever the rounding, or it would see no change and ask again at once.
const nextEdge = (t: number) => {
  const at = phase(t)
  const edge = EDGES.find((e) => e > at) ?? CYCLE
  return t + (edge - at) + 1e-4
}

export function createStatusLayer(ctx: SceneContext): StatusLayer {
  const { kit } = ctx
  STEPS.forEach((name, k) => {
    if (name && name !== 'lit') kit.defineLook(name, glow(k / HOVER_STEP))
  })
  kit.defineLook('clay', clay(() => STATUS_COLORS[kit.theme].clay))
  kit.defineLook('retired', clay(() => STATUS_COLORS[kit.theme].retired))

  // What each mesh wore, and whether it cast a shadow, when this layer first saw it.
  const wore = new WeakMap<Mesh, Wore>()
  const recs = new Map<string, Rec>()
  // The same records in the scene's order, so a frame can walk them without allocating.
  const list: Rec[] = []
  let pass = 0
  let lit = new Set<string>()
  const litKeys = new Set<string>()
  // Something is still easing.
  let busy = false
  let easedAt = -1
  // Materials whose shaders the scene has drawn or is compiling. A body look brings new
  // shaders the first time it's worn; a glow step on top of it never does.
  const known = new WeakSet<Material>()
  let fresh = false

  const markMat = createMarkMaterial()
  // On the floor's paint and contact shadows, under anything see-through above them:
  // steady shapes first, lit ones over them.
  const marks = createMarks(markMat, -1)
  const litMarks = createMarks(markMat, -0.5)
  marks.mesh.name = 'status-marks'
  litMarks.mesh.name = 'status-lit'
  ctx.overlay.add(marks.mesh, litMarks.mesh)
  let marksKey = ''
  let lights: StackLights | null = null
  let caps: ToneCaps | null = null
  let lightCount = 0
  // How many of the lights are a broken machine's, the red one that flashes.
  let brokenCount = 0
  let flashOn = true
  // A resize draws its frame at once, without update(): lights and caps sized for the old
  // canvas ask for one more.
  let seenHeight = ctx.dom.clientHeight
  const resized = new ResizeObserver(() => {
    if (ctx.dom.clientHeight === seenHeight) return
    seenHeight = ctx.dom.clientHeight
    if (lightCount || caps?.mesh.visible) ctx.invalidate()
  })
  resized.observe(ctx.container)

  // ---- Looks ----

  const looks = new Map<string, string[]>()
  const looksFor = (base: Base, step: number): string[] => {
    const key = `${base}:${step}`
    let l = looks.get(key)
    if (!l) {
      l = [base, STEPS[step]].filter((name) => name !== '')
      looks.set(key, l)
    }
    return l
  }

  const dressed = (src: Material, base: Base, names: string[]): Material => {
    // The copy without the glow is the one whose shaders matter.
    const body = base ? kit.variant(src, base) : src
    if (!known.has(body)) {
      known.add(body)
      fresh = true
    }
    return names.length > (base ? 1 : 0) ? kit.variant(src, names) : body
  }

  const wear = (rec: Rec, base: Base, step: number) => {
    const names = looksFor(base, step)
    const ghost = base === 'ghost'
    for (const mesh of rec.meshes) {
      const was = wore.get(mesh)
      if (!was) continue
      mesh.material = Array.isArray(was.material) ? was.material.map((m) => dressed(m, base, names)) : dressed(was.material, base, names)
      // Something you can see through throws no solid shadow.
      mesh.castShadow = ghost ? false : was.cast
    }
    // Nor a stand-in one.
    for (const b of rec.blobs) b.visible = !ghost
    rec.base = base
    rec.step = step
  }

  const record = (item: LiveItem, old: Rec | undefined): Rec => {
    const meshes: Mesh[] = []
    const blobs: Object3D[] = []
    const walk = (o: Object3D) => {
      // Pick shapes aren't drawn, and an effect (spray) has no solid state to swap to.
      if (o.userData.pick || o.userData.fx) return
      if (o.userData.blob) blobs.push(o)
      const mesh = o as Mesh
      if (mesh.isMesh) {
        meshes.push(mesh)
        if (!wore.has(mesh)) wore.set(mesh, { material: mesh.material, cast: mesh.castShadow })
      }
      for (const c of o.children) walk(c)
    }
    // Scenery is never dressed.
    if (!item.scenery) walk(item.model.root)
    return {
      item, root: item.model.root, meshes, blobs, base: '', step: 0,
      // A model rebuilt while it's lit stays lit.
      h: old?.h ?? 0, hTo: old?.hTo ?? 0, s: old?.s ?? 0, sTo: old?.sTo ?? 0,
      tone: null, paint: null, x: Number.NaN, y: Number.NaN, ground: 0, groundAt: '',
      light: -1, cap: -1, bx: 0, by: 0, bz: 0, px: 0, py: 0, pz: 0, pr: 0, pass: 0,
    }
  }

  // ---- The floor under a machine ----
  // A room has a floor of its own, a little above the slab: shapes drawn for a machine
  // standing in one lie on that, or they'd be under it.
  const ray = new Raycaster()
  ray.camera = ctx.camera
  const DOWN = new Vector3(0, -1, 0)
  const from = new Vector3()
  const hits: Intersection[] = []
  let floorKey = ''
  let floorVersion = 0

  const groundUnder = (x: number, z: number): number => {
    let ground = 0
    for (const rec of list) {
      const it = rec.item
      if (!it.scenery || Math.abs(x - it.x) > it.w / 2 || Math.abs(z - it.y) > it.h / 2) continue
      rec.root.updateWorldMatrix(true, true)
      hits.length = 0
      from.set(x, 60, z)
      ray.set(from, DOWN)
      ray.intersectObject(rec.root, true, hits)
      // Measured from the room's own origin (it may be in the air, dropping in). The
      // highest thing near the floor is the floor: a wall's top or a sign overhead is not.
      for (const hit of hits) {
        const y = hit.point.y - rec.root.position.y
        if (y < 0.6 && y > ground) ground = y
      }
    }
    return ground
  }

  // ---- Stack lights and caps ----

  // Where on its model a machine's light or cap stands.
  const spot = (rec: Rec) => {
    const it = rec.item
    const b = (rec.cap >= 0 && it.model.cap) || it.model.beacon
    rec.bx = b ? b.x : 0
    rec.by = b ? b.y : it.model.height
    rec.bz = b ? b.z : 0
    // A low model in the car's path that names no place (a roller plate): a pole on its
    // middle would be driven through. Stand the light on the floor beside the lane.
    if (!b && rec.light >= 0 && it.item.side !== 'outside' && it.model.height < CAR.height + 0.8) {
      const clear = CAR.width / 2 + 0.7
      if (Math.abs(it.y - CAR.z) < clear) {
        rec.bz = CAR.z + (it.y <= CAR.z ? -clear : clear) - it.y
        rec.by = 0
      }
    }
  }

  const stand = (rec: Rec) => {
    const root = rec.root
    const p = root.position
    const turn = root.rotation.y
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    rec.px = p.x
    rec.py = p.y
    rec.pz = p.z
    rec.pr = turn
    const x = p.x + rec.bx * cos + rec.bz * sin
    const y = p.y + rec.by
    const z = p.z - rec.bx * sin + rec.bz * cos
    if (rec.light >= 0) lights?.set(rec.light, x, y, z, rec.tone === 'danger')
    if (rec.cap >= 0 && rec.paint?.cap) caps?.set(rec.cap, x, y, z, rec.paint.cap)
  }

  const layout = () => {
    const o = ctx.options
    const site = o.mode === 'site'
    let nl = 0
    let nc = 0
    let nb = 0
    for (const rec of list) {
      rec.light = -1
      rec.cap = -1
      const it = rec.item
      if (!site || it.scenery) continue
      if (o.colorBy === 'status') {
        if (rec.tone === 'danger' || rec.tone === 'warn') rec.light = nl++
        if (rec.tone === 'danger') nb++
      } else if (rec.paint?.cap && (it.model.cap || it.model.beacon || it.model.height >= CAP_MIN_HEIGHT)) rec.cap = nc++
    }
    if (nl && !lights) {
      lights = createStackLights()
      lights.flash(flashOn)
      ctx.overlay.add(lights.root)
      fresh = true
    }
    if (nc && !caps) {
      caps = createToneCaps()
      ctx.overlay.add(caps.mesh)
      fresh = true
    }
    lightCount = nl
    brokenCount = nb
    lights?.setCount(nl)
    caps?.setCount(nc)
    for (const rec of list) {
      if (rec.light < 0 && rec.cap < 0) continue
      spot(rec)
      stand(rec)
    }
  }

  // ---- Floor shapes ----

  const drawMarks = () => {
    const o = ctx.options
    const site = o.mode === 'site'
    const drag = ctx.drag
    const saved = ctx.data.saved
    const slab = ctx.tunnelSlab
    const length = Number(ctx.data.layout.length_ft) || 0
    const half = (Number(ctx.data.layout.width_ft) || 16) / 2
    // Everything the shapes depend on. Unchanged: nothing to redraw.
    let key = `${kit.theme}|${o.mode}|${o.colorBy}|${o.moveMode ? 1 : 0}|${slab.minX},${slab.maxX}|${length},${half}|${floorVersion}`
    if (drag) key += `|drag,${drag.id},${drag.from.x_ft},${drag.from.y_ft},${drag.overlaps.join('+')}`
    for (const rec of list) {
      const it = rec.item
      rec.x = it.x
      rec.y = it.y
      if (it.scenery) continue
      const at = `${floorVersion}|${it.x}|${it.y}`
      if (at !== rec.groundAt) {
        rec.groundAt = at
        rec.ground = groundUnder(it.x, it.y)
      }
      const was = saved?.[it.id]
      key += `|${it.id},${it.x},${it.y},${it.w},${it.h},${rec.tone ?? ''},${was ? `${was.x_ft},${was.y_ft}` : ''}`
    }
    if (key === marksKey) return
    marksKey = key

    const pal = kit.palette
    const colors = STATUS_COLORS[kit.theme]
    marks.begin()
    if (site) {
      for (const rec of list) {
        const it = rec.item
        if (it.scenery) continue
        marks.lift(rec.ground + MARK_Y)
        const p = rec.paint
        const w = it.w + TONE_MARGIN * 2
        const d = it.h + TONE_MARGIN * 2
        if (p) {
          if (p.fill > 0) {
            marks.ink(p.color, p.fill)
            marks.fill(it.x, it.y, w, d, CORNER)
          }
          if (p.hatch) {
            const inset = (p.ring + 0.14) * 2
            marks.ink(p.color, 0.72)
            marks.hatch(it.x, it.y, w - inset, d - inset, 0.95, 0.4)
          }
          marks.ink(p.color, p.ringAlpha)
          if (p.dashed) marks.dashed(it.x, it.y, w, d, CORNER, p.ring, 0.62, 0.42)
          else marks.ring(it.x, it.y, w, d, CORNER, p.ring)
        }
        // What can be picked up.
        if (o.moveMode && movable(it)) {
          marks.ink(pal.accent, 0.6)
          marks.ring(it.x, it.y, it.w + 0.3, it.h + 0.3, 0.25, 0.07)
        }
        // Moved and not saved yet: an outline where it is saved, and a line back to it.
        const was = saved?.[it.id]
        if (was && (Math.abs(Number(was.x_ft) - it.x) > 0.01 || Math.abs(Number(was.y_ft) - it.y) > 0.01)) {
          const sx = Number(was.x_ft)
          const sz = Number(was.y_ft)
          marks.ink(colors.mark, 0.08)
          marks.fill(sx, sz, it.w + 0.3, it.h + 0.3, 0.25)
          marks.ink(colors.mark, 0.85)
          marks.dashed(sx, sz, it.w + 0.3, it.h + 0.3, 0.25, 0.1, 0.5, 0.36)
          marks.ink(colors.mark, 0.7)
          marks.dashes(sx, sz, it.x, it.y, 0.09, 0.4, 0.32)
        }
      }
    }
    if (site && o.moveMode) {
      // The ruler: a tick every foot along the floor's tape, its 5 and 10 ft ticks picked
      // out in the accent color, and the numbers the floor doesn't paint (before the
      // entrance and past the last ten).
      const z0 = half + TAPE
      const first = Math.ceil(slab.minX + 1.5)
      const last = Math.floor(slab.maxX - 1.5)
      marks.lift(MARK_Y)
      marks.ink(pal.accent, 0.9)
      marks.rect(first - 0.03, z0 - 0.1, last + 0.03, z0 - 0.03)
      for (let x = first; x <= last; x++) {
        const ten = x % 10 === 0
        const five = x % 5 === 0
        const wide = five ? 0.07 : 0.03
        marks.rect(x - wide, z0, x + wide, z0 + (ten ? 0.8 : five ? 0.45 : 0.24))
        if (ten && (x < 0 || x > length)) marks.number(x, x, z0 + 1.0, 1.2)
      }
    }
    const held = drag ? recs.get(drag.id) : undefined
    if (site && drag && held) {
      const it = held.item
      marks.lift(held.ground + MARK_Y)
      // Where it was picked up, unless that is the saved spot already outlined above.
      const fx = Number(drag.from.x_ft)
      const fz = Number(drag.from.y_ft)
      const was = saved?.[it.id]
      const atSaved = !!was && Math.abs(Number(was.x_ft) - fx) < 0.01 && Math.abs(Number(was.y_ft) - fz) < 0.01
      if (!atSaved && (Math.abs(fx - it.x) > 0.01 || Math.abs(fz - it.y) > 0.01)) {
        marks.ink(pal.accent, 0.07)
        marks.fill(fx, fz, it.w + 0.3, it.h + 0.3, 0.25)
        marks.ink(pal.accent, 0.75)
        marks.dashed(fx, fz, it.w + 0.3, it.h + 0.3, 0.25, 0.08, 0.5, 0.36)
      }
      // What it overlaps: a warning, not a block.
      for (const id of drag.overlaps) {
        const other = recs.get(id)
        if (!other) continue
        const b = other.item
        marks.lift(other.ground + MARK_Y)
        marks.ink(pal.warn, 0.3)
        marks.fill(b.x, b.y, b.w + 1.2, b.h + 1.2, CORNER)
        marks.ink(pal.warn, 0.95)
        marks.ring(b.x, b.y, b.w + 1.2, b.h + 1.2, CORNER, 0.2)
      }
      // In the tunnel a machine only slides along it: a line along its travel, and one
      // across to the ruler to read its place from.
      if (it.item.side !== 'outside') {
        const z0 = half + TAPE
        const color = drag.overlaps.length ? pal.warn : pal.accent
        marks.lift(MARK_Y)
        marks.ink(color, 0.5)
        marks.line(slab.minX + 1.5, it.y, slab.maxX - 1.5, it.y, 0.05)
        marks.line(it.x, it.y, it.x, z0 - 0.1, 0.05)
        marks.ink(color, 1)
        marks.rect(it.x - 0.1, z0 - 0.28, it.x + 0.1, z0 + 1.0)
      }
    }
    marks.end()
  }

  const drawLit = () => {
    const pal = kit.palette
    const drag = ctx.drag
    litMarks.begin()
    for (let k = 0; k < list.length; k++) {
      const rec = list[k]
      if (rec.h <= 0 && rec.s <= 0) continue
      const it = rec.item
      const a = smooth(Math.max(rec.h, rec.s))
      const s = smooth(rec.s)
      // In someone's hand and over another machine: amber.
      const color = drag && drag.id === it.id && drag.overlaps.length ? pal.warn : pal.accent
      litMarks.lift(rec.ground + MARK_Y + 0.004)
      // The pad grows a touch as it lights.
      const margin = LIT_MARGIN - 0.2 * (1 - a)
      const w = it.w + margin * 2
      const d = it.h + margin * 2
      litMarks.ink(color, (0.1 + 0.08 * s) * a)
      litMarks.fill(it.x, it.y, w, d, CORNER + 0.15)
      litMarks.ink(color, (0.8 + 0.18 * s) * a)
      litMarks.ring(it.x, it.y, w, d, CORNER + 0.15, 0.09 + 0.05 * s)
      if (s > 0) {
        // Brackets close in around the footprint as the selection lands.
        const out = BRACKET_MARGIN + 0.6 * (1 - s)
        litMarks.ink(color, s)
        litMarks.corners(it.x, it.y, it.w + out * 2, it.h + out * 2, clamp(0.18 * Math.min(it.w, it.h) + 0.5, 0.7, 1.5), 0.16)
      }
      // A thin line to the next shape of the same machine, so they read as one.
      for (let j = k + 1; j < list.length; j++) {
        const next = list[j]
        if (next.item.key !== it.key || (next.h <= 0 && next.s <= 0)) continue
        litMarks.ink(pal.accent, 0.55 * a)
        litMarks.line(it.x, it.y, next.item.x, next.item.y, 0.08)
        break
      }
    }
    litMarks.end()
  }

  // ---- What is lit ----

  const retarget = () => {
    const o = ctx.options
    const drag = ctx.drag
    const selected = o.mode === 'site' ? o.selectedId : null
    // Lighting one shape lights every shape linked to the same machine.
    litKeys.clear()
    for (const id of lit) {
      const it = ctx.item(id)
      if (it && !it.scenery) litKeys.add(it.key)
    }
    busy = false
    for (const rec of list) {
      const it = rec.item
      const dragged = !!drag && drag.id === it.id
      rec.hTo = !it.scenery && (dragged || litKeys.has(it.key)) ? 1 : 0
      rec.sTo = !it.scenery && (dragged || it.id === selected) ? 1 : 0
      if (rec.h !== rec.hTo || rec.s !== rec.sTo) busy = true
    }
    if (!busy) easedAt = -1
  }

  // Moves every level to where it's heading by a share of the way (1: all the way).
  const ease = (by: number) => {
    busy = false
    for (const rec of list) {
      if (rec.h === rec.hTo && rec.s === rec.sTo) continue
      rec.h = toward(rec.h, rec.hTo, by)
      rec.s = toward(rec.s, rec.sTo, by)
      const step = stepOf(rec)
      if (step !== rec.step) wear(rec, rec.base, step)
      if (rec.h !== rec.hTo || rec.s !== rec.sTo) busy = true
    }
    if (!busy) easedAt = -1
  }

  const settle = (made: boolean) => {
    // A look seen for the first time brings new shaders: have them compiled off the main
    // thread before the next frame. When models were just built the scene does that
    // itself, for everything, right after this.
    if (fresh && !made) void ctx.compile()
    fresh = false
    ctx.invalidate()
  }

  const sync = () => {
    const o = ctx.options
    const site = o.mode === 'site'
    const pal = kit.palette
    const colors = STATUS_COLORS[kit.theme]
    const maxCars = site ? maxCarsOf(ctx.data.items, ctx.data.assets) : 0
    let made = false
    let shadows = false
    let floor = ''
    pass++
    list.length = 0
    for (const item of ctx.items) {
      let rec = recs.get(item.id)
      const isNew = !rec || rec.root !== item.model.root
      if (!rec || isNew) {
        rec = record(item, rec)
        recs.set(item.id, rec)
        made = true
      }
      rec.item = item
      rec.pass = pass
      list.push(rec)
      if (item.scenery) {
        floor += `${rec.root.id},${item.x},${item.y},${item.w},${item.h};`
        continue
      }
      const tone = site ? toneFor(item.asset, o.colorBy, maxCars) : null
      rec.tone = tone
      rec.paint = tone ? tonePaint(tone, o.colorBy, pal, colors) : null
      const base: Base = !tone ? '' : tone === 'unlinked' ? 'ghost' : tone === 'retired' ? 'retired' : o.colorBy === 'status' ? '' : 'clay'
      // A new model in its own materials: the scene compiles those itself.
      if (isNew && !base) {
        for (const mesh of rec.meshes) {
          const was = wore.get(mesh)
          if (!was) continue
          if (Array.isArray(was.material)) for (const m of was.material) known.add(m)
          else known.add(was.material)
        }
      }
      const step = stepOf(rec)
      if (base !== rec.base || step !== rec.step) {
        // The shadow map changes when a ghost comes or goes.
        if ((base === 'ghost') !== (rec.base === 'ghost')) shadows = true
        wear(rec, base, step)
      }
    }
    for (const [id, rec] of recs) if (rec.pass !== pass) recs.delete(id)
    if (floor !== floorKey) {
      floorKey = floor
      floorVersion++
    }
    retarget()
    if (o.reducedMotion && busy) ease(1)
    layout()
    drawMarks()
    drawLit()
    if (shadows) ctx.refreshShadows()
    settle(made)
  }

  return {
    sync,
    setLit(ids) {
      lit = new Set(ids)
      retarget()
      if (ctx.options.reducedMotion && busy) {
        ease(1)
        drawLit()
      }
      settle(false)
    },
    update(_dt, now) {
      const t = ctx.time
      let changed = false
      let relit = false
      if (busy) {
        // On real time, counted from the first frame after something was lit (frames
        // aren't drawn while the scene idles, so the gap before it means nothing).
        const ms = easedAt < 0 ? 16 : Math.min(50, now - easedAt)
        easedAt = now
        ease(ms / EASE_MS)
        relit = true
        changed = true
      }
      // Machines move without a sync while one is dragged or dropping in: pads follow
      // where they stand, lights and caps ride on the model itself.
      let moved = false
      for (const rec of list) {
        const it = rec.item
        if (!same(it.x, rec.x) || !same(it.y, rec.y)) moved = true
        if (rec.light < 0 && rec.cap < 0) continue
        const p = rec.root.position
        if (!same(p.x, rec.px) || !same(p.y, rec.py) || !same(p.z, rec.pz) || !same(rec.root.rotation.y, rec.pr)) {
          stand(rec)
          changed = true
        }
      }
      if (moved) {
        drawMarks()
        relit = true
        changed = true
      }
      if (relit) drawLit()
      // Sized for this frame's camera, which only moves on frames that are drawn anyway.
      const height = ctx.dom.clientHeight
      if (lights && lightCount) {
        // The flash follows scene time while that runs by itself, however far apart the
        // frames come (the scene sleeps between the flash's edges when nothing else moves).
        // Otherwise (paused, reduced motion, a jump to a moment while paused) the light
        // simply stays on, so a broken machine is never caught dark.
        const running = !ctx.options.reducedMotion && ctx.timeRunning
        const on = !running || flashing(t)
        if (on !== flashOn) {
          flashOn = on
          lights.flash(on)
          changed = true
        }
        lights.view(ctx.camera, height)
      }
      if (caps?.mesh.visible) caps.view(ctx.camera, height)
      if (fresh) settle(false)
      // Whatever changed outside an ease still has to reach the screen: ask for this
      // frame to be drawn, without asking for another.
      else if (changed && !busy) ctx.invalidate()
      return busy
    },
    nextChange(t) {
      // Only a broken machine's red lens follows scene time; amber is steady.
      return brokenCount && !ctx.options.reducedMotion ? nextEdge(t) : Infinity
    },
    dispose() {
      resized.disconnect()
      for (const rec of list) if (rec.base || rec.step) wear(rec, '', 0)
      ctx.overlay.remove(marks.mesh, litMarks.mesh)
      marks.dispose()
      litMarks.dispose()
      markMat.dispose()
      if (lights) {
        ctx.overlay.remove(lights.root)
        lights.dispose()
      }
      if (caps) {
        ctx.overlay.remove(caps.mesh)
        caps.dispose()
      }
      recs.clear()
      list.length = 0
    },
  }
}
