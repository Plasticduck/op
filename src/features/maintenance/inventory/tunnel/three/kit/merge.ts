import { BufferAttribute, Matrix4, Mesh, Skeleton, SkinnedMesh } from 'three'
import type { Bone, BufferGeometry, Material, Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LAYER } from './palette'

// Collapses a model's parts into one mesh per material. A wrap is about a hundred small
// parts in five materials: drawn one by one that is a hundred draw calls, merged it is a
// handful. mergeStatic is for parts that never move. mergeMoving is for parts that do:
// it keeps the groups the model animates and makes the merged mesh follow them (rigid
// skinning), so an arm, a forearm and a motor still cost one draw call per material.

const _inv = new Matrix4()
const _rel = new Matrix4()

// What is left alone: anything with its own shader or purpose, or that isn't a plain mesh.
function kept(o: Object3D): boolean {
  if (o.userData.keep || o.userData.blob || o.userData.pick || o.userData.fx) return true
  const m = o as Mesh
  if (!m.isMesh) return (o as { isPoints?: boolean }).isPoints === true || (o as { isLine?: boolean }).isLine === true
  return (m as { isInstancedMesh?: boolean }).isInstancedMesh === true || (m as { isSkinnedMesh?: boolean }).isSkinnedMesh === true
    || Array.isArray(m.material) || m.layers.mask !== 1 << LAYER.draw
}

// Position, normal and uv only, always indexed: mergeGeometries refuses a mix of indexed
// and non-indexed inputs (rounded boxes and extrusions are non-indexed, the rest are
// indexed) or of different attribute sets.
function normalized(src: BufferGeometry, m: Matrix4, bone: number): BufferGeometry {
  const g = src.clone()
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
  }
  g.morphAttributes = {}
  g.clearGroups()
  const count = g.attributes.position.count
  if (!g.attributes.normal) g.computeVertexNormals()
  if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
  if (!g.index) {
    const idx = count > 65535 ? new Uint32Array(count) : new Uint16Array(count)
    for (let k = 0; k < count; k++) idx[k] = k
    g.setIndex(new BufferAttribute(idx, 1))
  }
  g.applyMatrix4(m)
  // A mirrored part (scale -1 on one axis) comes out inside out: turn its faces back.
  if (m.determinant() < 0) {
    const idx = g.index!
    for (let k = 0; k < idx.count; k += 3) {
      const a = idx.getX(k)
      idx.setX(k, idx.getX(k + 2))
      idx.setX(k + 2, a)
    }
  }
  if (bone >= 0) {
    const si = new Uint16Array(count * 4)
    const sw = new Float32Array(count * 4)
    for (let k = 0; k < count; k++) {
      si[k * 4] = bone
      sw[k * 4] = 1
    }
    g.setAttribute('skinIndex', new BufferAttribute(si, 4))
    g.setAttribute('skinWeight', new BufferAttribute(sw, 4))
  }
  return g
}

type Bucket = { material: Material; cast: boolean; receive: boolean; parts: BufferGeometry[] }

// Gathers every plain mesh under group into buckets by material, removing it from the
// tree. boneOf says which mover a mesh rides on (-1: none).
function collect(group: Object3D, boneOf: (o: Object3D) => number): Map<string, Bucket> {
  group.updateMatrixWorld(true)
  _inv.copy(group.matrixWorld).invert()
  const buckets = new Map<string, Bucket>()
  const gone: Mesh[] = []
  const walk = (o: Object3D) => {
    if (o !== group && kept(o)) return
    const mesh = o as Mesh
    if (mesh.isMesh) {
      const material = mesh.material as Material
      const key = `${material.uuid}:${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`
      let b = buckets.get(key)
      if (!b) {
        b = { material, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] }
        buckets.set(key, b)
      }
      _rel.multiplyMatrices(_inv, mesh.matrixWorld)
      b.parts.push(normalized(mesh.geometry, _rel, boneOf(mesh)))
      gone.push(mesh)
    }
    for (const c of o.children) walk(c)
  }
  walk(group)
  for (const mesh of gone) {
    // A mesh can carry kept children (a blob anchor): hand them to its parent in place.
    for (const c of [...mesh.children]) mesh.parent?.attach(c)
    mesh.removeFromParent()
    if (!mesh.geometry.userData.shared) mesh.geometry.dispose()
  }
  return buckets
}

function fuse(b: Bucket): BufferGeometry | null {
  if (b.parts.length === 1) return b.parts[0]
  const merged = mergeGeometries(b.parts, false)
  for (const p of b.parts) p.dispose()
  return merged
}

// Merges every plain mesh under group, in place, and returns the group. Parts made by
// the kit that animate themselves (brushes, spray, pick shapes, blobs) are left as they are.
export function mergeStatic<T extends Object3D>(group: T): T {
  for (const b of collect(group, () => -1).values()) {
    const geo = fuse(b)
    if (!geo) continue
    const mesh = new Mesh(geo, b.material)
    mesh.castShadow = b.cast
    mesh.receiveShadow = b.receive
    group.add(mesh)
  }
  return group
}

// The same for parts that move. movers are the groups the model turns and slides each
// frame; they stay in the tree, emptied, and the merged meshes follow them. A mesh rides
// on its nearest mover. Build the group at rest first: that pose is what gets bound.
export function mergeMoving<T extends Object3D>(group: T, movers: Object3D[]): T {
  const index = new Map<Object3D, number>()
  movers.forEach((m, k) => index.set(m, k + 1))
  const boneOf = (o: Object3D): number => {
    for (let p: Object3D | null = o; p && p !== group; p = p.parent) {
      const k = index.get(p)
      if (k != null) return k
    }
    return 0
  }
  const buckets = collect(group, boneOf)
  if (!buckets.size) return group
  // Bone 0 is the group itself, for parts that ride on no mover. The bind pose is taken
  // in the group's own space so the model can be built anywhere.
  const bones = [group, ...movers]
  const inverses = bones.map((b) => new Matrix4().copy(b.matrixWorld).invert().multiply(group.matrixWorld))
  const skeleton = new Skeleton(bones as unknown as Bone[], inverses)
  for (const b of buckets.values()) {
    const geo = fuse(b)
    if (!geo) continue
    const mesh = new SkinnedMesh(geo, b.material)
    mesh.castShadow = false
    mesh.receiveShadow = b.receive
    // Its bounds are the rest pose, which the parts leave: never cull it by them.
    mesh.frustumCulled = false
    group.add(mesh)
    mesh.bind(skeleton, new Matrix4())
  }
  return group
}
