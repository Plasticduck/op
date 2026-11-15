import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import type { BufferGeometry, InstancedMesh, Material, Object3D, Texture } from 'three'
import { createBlobPool } from './kit/blobs'
import type { BlobOpts } from './kit/blobs'
import { createFoamBrush } from './kit/brush'
import type { FoamBrush, FoamBrushOpts } from './kit/brush'
import { bentPath, cylGeo, gussetGeo, hosePath, plateGeo, roundedBoxGeo, spanBetween, sweepGeo } from './kit/geometry'
import type { V3 } from './kit/geometry'
import { createSignAtlas } from './kit/labels'
import type { Paint, Swatch } from './kit/labels'
import { createMaterials } from './kit/materials'
import type { LookTweak, Materials } from './kit/materials'
import { mergeMoving, mergeStatic } from './kit/merge'
import { COLORS, KEY_DIR, LAYER, PALETTES, RIM_DIR, SHADOW_SLIDE } from './kit/palette'
import type { Palette } from './kit/palette'
import { airCylinder, basePlate, bearing, motor, portalFrame } from './kit/parts'
import type { AirCylinder, BasePlateOpts, MotorOpts, PortalOpts } from './kit/parts'
import { createSpray, createSprayMaterial } from './kit/spray'
import type { Spray, SprayOpts } from './kit/spray'
import { createTextures } from './kit/textures'
import type { Textures } from './kit/textures'
import type { ThemeName } from './types'

// The kit: everything machines share. One palette, one set of materials, one way to make
// a frame, a pipe, a motor, a brush, water. A model is written as calls into the kit
// (see models/wrap.ts for the pattern), which is what keeps forty machines looking like
// one product line and inside the budget.
//
// The rules for a model:
//   - Take materials from kit.mat. Never change one, and never assign mesh.material after
//     the model is built (the status layer swaps looks and remembers what each mesh wore).
//     To switch a light on and off use kit.lamp, or set .visible on a part of your own.
//   - Build shapes with the helpers below: beveled boxes, chamfered cylinders, bent tube.
//   - Put parts that never move in one group and call kit.mergeStatic(group). Put parts
//     that move in another and call kit.mergeMoving(group, [the groups you animate]).
//   - Say where the pointer can hit with kit.pickBox / kit.pickCylinder.
//   - Parts that move cast no real shadow (the shadow map is drawn once). Give each a
//     kit.blob with cast set to its height, or, if it only spins in place, a
//     kit.shadowOnly stand-in.
//
// THE BUDGET, for the whole scene on a desktop: 250 draw calls and 250k triangles (a
// phone: 160 and 120k). With about forty machines that is 4 to 6 calls each: one merged
// mesh per material for the fixed parts (aim for 3 or fewer: paint small accents from the
// sign atlas with kit.paint so they share one), one or two for the moving parts, one per
// brush, one per spray. Check with hud=1 in the preview: it counts a frame's main pass,
// not the shadow map, which is redrawn only when something that casts moves.
//
// What merges leave alone, and how to mark your own:
//   userData.keep = true   on any object: mergeStatic and mergeMoving skip it and what's
//                          under it (it has its own shader, or you move it by hand).
//   userData.fx = true     an effect with no solid look (spray): merges skip it and the
//                          status layer never swaps its material.
// Brushes, spray, lamps, blobs, pick shapes and shadow stand-ins made by the kit are
// already marked.

export { COLORS, KEY_DIR, LAYER, RIM_DIR, SHADOW_SLIDE }
export type { AirCylinder, BasePlateOpts, BlobOpts, FoamBrush, FoamBrushOpts, LookTweak, Materials, MotorOpts, Paint, Palette, PortalOpts, Spray, SprayOpts, Swatch, Textures, V3 }

// A small indicator light a model switches on and off.
export type Lamp = {
  root: Group
  set(on: boolean): void
}

export type TubeOpts = {
  // Radius of the rounded corners. 0 keeps them sharp.
  bend?: number
  radial?: number
  caps?: boolean
}

export type Kit = {
  readonly theme: ThemeName
  readonly detail: 'high' | 'low'
  readonly palette: Palette
  // Shared materials, made on first use. Read only.
  readonly mat: Materials
  readonly tex: Textures
  // Seconds of scene time, shared by every kit shader. The scene advances it.
  readonly time: { value: number }

  // ---- Shapes. Each returns a mesh that casts and receives shadow, centered on its
  // own origin unless it says otherwise. Sizes in feet. ----

  // A box with eased edges (r is the edge radius, default about half an inch).
  box(w: number, h: number, d: number, material: Material, r?: number): Mesh
  // A square or rectangular tube from a to b. size is one side, or [across, deep].
  beam(a: V3, b: V3, size: number | readonly [number, number], material: Material, r?: number): Mesh
  // A chamfered cylinder along Y. r2 tapers the top.
  cyl(r: number, len: number, material: Material, opts?: { bevel?: number; radial?: number; r2?: number }): Mesh
  // A round bar from a to b.
  rod(a: V3, b: V3, r: number, material: Material): Mesh
  // Round tube through the points, corners rounded to opts.bend: pipe arches, conduit.
  tube(points: ReadonlyArray<V3>, r: number, material: Material, opts?: TubeOpts): Mesh
  // A hose hanging between two points. sag: how far the middle drops, as a share of the span.
  hose(a: V3, b: V3, r: number, material: Material, sag?: number): Mesh
  // A flat plate w by d lying on the floor plane, top at y = t.
  plate(w: number, d: number, t: number, material: Material, r?: number): Mesh
  // A right-triangle plate: legs along +X and +Y, thickness along Z.
  gusset(size: number, thickness: number, material: Material): Mesh

  // ---- Assemblies (groups of plain meshes, for the model to merge). ----
  basePlate(w: number, d: number, opts?: BasePlateOpts): Group
  portalFrame(opts: PortalOpts): Group
  motor(opts?: MotorOpts): Group
  airCylinder(opts: { body: number; stroke: number; bore?: number; mat?: Material; rodMat?: Material }): AirCylinder
  bearing(r: number, material?: Material): Group
  // A name plate w by h, facing +Z, in the shared sign material.
  sign(text: string, w: number, h: number): Mesh
  // Points a geometry's uvs at a flat color of the sign atlas, so it can use mat.sign.
  // color is a named swatch or any hex color ('#ff9ec4').
  swatch<T extends BufferGeometry>(geo: T, color: Paint): T
  // Recolors a part from the atlas and moves it to the sign material. For small accents
  // (hoses, fittings, nozzles): any number of colors, one draw call between them.
  paint(mesh: Mesh, color: Paint): Mesh
  // An indicator lens of radius r feet, standing on y = 0 and pointing up +Y. It starts
  // dark; set(true) lights it. Two meshes shown in turn, so no material is reassigned.
  lamp(color: 'green' | 'amber' | 'red', r?: number): Lamp

  // ---- Fewer draw calls. Both work in place and return the group. ----
  mergeStatic<T extends Object3D>(group: T): T
  mergeMoving<T extends Object3D>(group: T, movers: Object3D[]): T

  // ---- Things that move in a shader. ----
  foamBrush(opts: FoamBrushOpts): FoamBrush
  spray(opts: SprayOpts): Spray

  // ---- Pointer targets and contact shadows. ----
  // Invisible shapes the pointer hits (never the drawn meshes, so an arch you can see
  // through doesn't block what's behind it). x, y, z is the shape's center.
  pickBox(parent: Object3D, w: number, h: number, d: number, x?: number, y?: number, z?: number): Mesh
  pickCylinder(parent: Object3D, r: number, len: number, x?: number, y?: number, z?: number, axis?: 'x' | 'y' | 'z'): Mesh
  // A stand-in shadow on the floor under parent that follows it. w by d is the footprint
  // of the thing itself in feet. Set opts.cast to its height and the blob stretches away
  // from the light like a real shadow. Scale the returned anchor to grow or shrink it.
  blob(parent: Object3D, w: number, d: number, opts?: BlobOpts): Object3D
  // Turns a mesh into a shadow-only stand-in: it is drawn into the shadow map and nowhere
  // else. For something whose own shadow can't be used but which stays put (a brush that
  // spins in place: give it a plain cylinder). Returns the mesh.
  shadowOnly(mesh: Mesh): Mesh

  // ---- Looks. ----
  // A copy of a material wearing one look or several, in order. 'lit' (hover glow) and
  // 'ghost' (not linked) are built in. One copy per material and list, owned by the kit
  // and kept in step with the theme.
  variant(material: Material, looks: string | ReadonlyArray<string>): Material
  // Adds a look (or replaces one): a function that changes a fresh copy of a material.
  // See kit/materials.ts for the rules.
  defineLook(name: string, tweak: LookTweak): void

  // ---- For the stage and the scene. ----
  readonly blobMesh: InstancedMesh
  syncBlobs(): void
  // Lets go of what the kit tracks under a model that's being removed.
  release(root: Object3D): void
  // The slabs of the floor, so stand-in shadows stop at the concrete's edge.
  setFloor(slabs: ReadonlyArray<{ minX: number; maxX: number; minZ: number; maxZ: number }>): void
  setTheme(theme: ThemeName): void
  // The environment map, for the metals to mirror.
  setEnvironment(map: Texture | null): void
  // Sizes given in feet (spray drops) need the canvas's shape to become pixels.
  setViewport(heightPx: number, fovDeg: number, aspect?: number): void
  dispose(): void
}

export function createKit(opts: { theme: ThemeName; detail: 'high' | 'low' }): Kit {
  let theme = opts.theme
  let palette = PALETTES[theme]
  const detail = opts.detail
  const time = { value: 0 }
  const tex = createTextures(detail, COLORS.yellow, COLORS.hazardBlack)
  let atlas: ReturnType<typeof createSignAtlas> | null = null
  const signs = () => (atlas ??= createSignAtlas(detail))
  const materials = createMaterials(tex, () => signs().texture, palette)
  const mat = materials.mat
  let sprayShared: ReturnType<typeof createSprayMaterial> | null = null
  let viewport: [number, number, number] = [800, 30, 1.6]
  const blobs = createBlobPool()
  blobs.setStrength(palette.blob)
  const brushes = new Set<FoamBrush>()

  // Pick shapes are one unit box and one unit cylinder, scaled: no geometry per shape.
  const pickBoxGeo = new BoxGeometry(1, 1, 1)
  const pickCylGeo = new CylinderGeometry(1, 1, 1, 12)
  pickBoxGeo.userData.shared = true
  pickCylGeo.userData.shared = true
  const pickMat = new MeshBasicMaterial({ visible: false })
  const pick = (parent: Object3D, geo: BufferGeometry): Mesh => {
    const m = new Mesh(geo, pickMat)
    m.name = 'pick'
    m.userData.pick = true
    m.layers.set(LAYER.pick)
    parent.add(m)
    return m
  }

  const solid = (geo: BufferGeometry, material: Material): Mesh => {
    const m = new Mesh(geo, material)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  return {
    get theme() { return theme },
    detail,
    get palette() { return palette },
    mat,
    tex,
    time,

    box: (w, h, d, material, r) => solid(roundedBoxGeo(w, h, d, r), material),
    beam(a, b, size, material, r) {
      const [sx, sz] = typeof size === 'number' ? [size, size] : size
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      const m = solid(roundedBoxGeo(sx, len, sz, r ?? 0.035), material)
      spanBetween(m, a[0], a[1], a[2], b[0], b[1], b[2])
      return m
    },
    cyl: (r, len, material, o) => solid(cylGeo(r, len, o), material),
    rod(a, b, r, material) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      const m = solid(cylGeo(r, len, { bevel: Math.min(r * 0.2, 0.02) }), material)
      spanBetween(m, a[0], a[1], a[2], b[0], b[1], b[2])
      return m
    },
    tube: (points, r, material, o = {}) =>
      solid(sweepGeo(bentPath(points, o.bend ?? 0, detail === 'high' ? 7 : 4), r, o.radial ?? (r > 0.08 ? 12 : 8), o.caps !== false), material),
    hose: (a, b, r, material, sag = 0.1) => solid(sweepGeo(hosePath(a, b, sag, detail === 'high' ? 12 : 7), r, 6, true), material),
    plate: (w, d, t, material, r) => solid(plateGeo(w, d, t, r), material),
    gusset: (size, thickness, material) => solid(gussetGeo(size, thickness), material),

    basePlate: (w, d, o) => basePlate(mat, w, d, o),
    portalFrame: (o) => portalFrame(mat, o),
    motor: (o) => motor(mat, o),
    airCylinder: (o) => airCylinder(mat, o),
    bearing: (r, material) => bearing(mat, r, material),
    sign: (text, w, h) => solid(signs().signGeo(text, w, h), mat.sign),
    swatch: (geo, name) => signs().paint(geo, name),
    paint(mesh, name) {
      signs().paint(mesh.geometry, name)
      mesh.material = mat.sign
      return mesh
    },
    lamp(color, r = 0.09) {
      const geo = cylGeo(r, r * 1.2, { bevel: r * 0.45, radial: 12 })
      geo.translate(0, r * 0.6, 0)
      const lit = new Mesh(geo, color === 'green' ? mat.lensGreen : color === 'amber' ? mat.lensAmber : mat.lensRed)
      const dark = new Mesh(geo, mat.lensOff)
      lit.visible = false
      const root = new Group()
      root.name = 'lamp'
      root.userData.keep = true
      root.add(lit, dark)
      return {
        root,
        set(on) {
          lit.visible = on
          dark.visible = !on
        },
      }
    },

    mergeStatic,
    mergeMoving,

    foamBrush(o) {
      const b = createFoamBrush(o, { cloth: tex.cloth, clothMask: tex.clothMask, coreMat: mat.motor, time, detail })
      // A model frees its brush when it's rebuilt. Whatever is left goes with the kit.
      const dispose = b.dispose
      b.dispose = () => {
        brushes.delete(b)
        dispose()
      }
      brushes.add(b)
      return b
    },
    spray(o) {
      if (!sprayShared) {
        sprayShared = createSprayMaterial(time, palette)
        sprayShared.setViewport(viewport[0], viewport[1], viewport[2])
      }
      return createSpray(o, sprayShared, detail)
    },

    pickBox(parent, w, h, d, x = 0, y = h / 2, z = 0) {
      const m = pick(parent, pickBoxGeo)
      m.scale.set(w, h, d)
      m.position.set(x, y, z)
      return m
    },
    pickCylinder(parent, r, len, x = 0, y = len / 2, z = 0, axis = 'y') {
      const m = pick(parent, pickCylGeo)
      m.scale.set(r, len, r)
      m.position.set(x, y, z)
      if (axis === 'x') m.rotation.z = Math.PI / 2
      else if (axis === 'z') m.rotation.x = Math.PI / 2
      return m
    },
    blob: (parent, w, d, o) => blobs.add(parent, w, d, o),
    shadowOnly(mesh) {
      mesh.layers.set(LAYER.shadow)
      mesh.castShadow = true
      mesh.receiveShadow = false
      return mesh
    },

    variant: materials.variant,
    defineLook: materials.defineLook,

    blobMesh: blobs.mesh,
    syncBlobs: blobs.sync,
    release: blobs.release,
    setFloor: blobs.setFloor,
    setTheme(next) {
      theme = next
      palette = PALETTES[next]
      materials.setTheme(palette)
      blobs.setStrength(palette.blob)
      sprayShared?.setTheme(palette)
    },
    setEnvironment: materials.setEnvironment,
    setViewport(h, fov, aspect) {
      viewport = [h, fov, aspect ?? viewport[2]]
      sprayShared?.setViewport(viewport[0], viewport[1], viewport[2])
    },
    dispose() {
      for (const b of [...brushes]) b.dispose()
      blobs.dispose()
      sprayShared?.material.dispose()
      materials.dispose()
      atlas?.dispose()
      tex.dispose()
      pickBoxGeo.dispose()
      pickCylGeo.dispose()
      pickMat.dispose()
    },
  }
}
