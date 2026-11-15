import { Color, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import type { Material, Texture } from 'three'
import { COLORS } from './palette'
import type { Palette } from './palette'
import type { Textures } from './textures'

// The shared materials. Every model draws from this one set, which is what makes forty
// machines look like one product line and lets the renderer batch them. They are made
// the first time they're asked for and belong to the kit: a model must never change one
// (use kit.variant for a copy in another look).

type Spec = {
  color: string
  rough: number
  metal?: number
  // 'brushed' adds the fine scratch roughness map.
  finish?: 'brushed'
  emissive?: number
}

const SPECS = {
  // Rougher than it reads: its color map doubles as the roughness map and takes some off.
  concrete: { color: '#c9ccd1', rough: 1 },
  concreteEdge: { color: '#b1b5bb', rough: 0.95 },
  curb: { color: '#d4d7db', rough: 0.8 },
  galvanized: { color: COLORS.galvanized, rough: 0.48, metal: 0.7 },
  frame: { color: COLORS.frame, rough: 0.5, metal: 0.2 },
  frameDark: { color: COLORS.frameDark, rough: 0.5, metal: 0.25 },
  aluminum: { color: COLORS.aluminum, rough: 0.34, metal: 1, finish: 'brushed' },
  stainless: { color: COLORS.stainless, rough: 0.27, metal: 1, finish: 'brushed' },
  chrome: { color: COLORS.chrome, rough: 0.12, metal: 1 },
  yellow: { color: COLORS.yellow, rough: 0.45 },
  conveyorBlue: { color: COLORS.conveyorBlue, rough: 0.5, metal: 0.1 },
  rubber: { color: COLORS.rubber, rough: 0.85 },
  blackPlastic: { color: COLORS.blackPlastic, rough: 0.38 },
  motor: { color: COLORS.motor, rough: 0.55, metal: 0.35 },
  glass: { color: COLORS.glass, rough: 0.06, metal: 0.9 },
  brass: { color: COLORS.brass, rough: 0.35, metal: 1 },
  red: { color: COLORS.red, rough: 0.45 },
  white: { color: COLORS.white, rough: 0.45 },
  drumBlue: { color: COLORS.drumBlue, rough: 0.5 },
  hoseRed: { color: COLORS.hoseRed, rough: 0.6 },
  hoseBlue: { color: COLORS.hoseBlue, rough: 0.6 },
  hoseBlack: { color: COLORS.hoseBlack, rough: 0.7 },
  hoseWhite: { color: COLORS.hoseWhite, rough: 0.5 },
  hoseGreen: { color: COLORS.hoseGreen, rough: 0.6 },
  lensGreen: { color: COLORS.lensGreen, rough: 0.3, emissive: 1.6 },
  lensAmber: { color: COLORS.lensAmber, rough: 0.3, emissive: 1.6 },
  lensRed: { color: COLORS.lensRed, rough: 0.3, emissive: 1.8 },
  lensOff: { color: COLORS.lensOff, rough: 0.3 },
  carPaint: { color: COLORS.carPaint, rough: 0.45 },
  carTrim: { color: COLORS.carTrim, rough: 0.7 },
  clothCore: { color: COLORS.clothCore, rough: 0.8 },
} satisfies Record<string, Spec>

export type MatName = keyof typeof SPECS | 'sign'
export type Materials = Readonly<Record<MatName, MeshStandardMaterial>>

// A look is a named change to a copy of a material. Two are built in: 'lit' (the hover
// and selection glow) and 'ghost' (a shape with no machine linked yet). kit.defineLook
// adds more (a clay body for the usage view, say). kit.variant(material, looks) gives the
// copy wearing one look or several, applied in the order given: ['clay', 'lit'] is a clay
// body that glows.
//
// A tweak is handed a fresh copy of the source material (after the looks before it) and
// the palette. It runs again from a fresh copy whenever the theme changes, so read
// colors from the palette, and it may change anything. To drop a foam brush's per-strip
// colors in a look (a flat clay or ghost brush), add the define T3D_FLAT to the copy.
export type LookTweak = (copy: MeshStandardMaterial, palette: Palette) => void

const BUILT_IN: Record<string, LookTweak> = {
  lit(copy, p) {
    // Lenses already glow in their own color: leave them.
    if (!copy.emissive || copy.userData.glows) return
    copy.emissive.set(p.accent)
    copy.emissiveIntensity = 0.22
  },
  ghost(copy, p) {
    // One even tone whatever a part was made of, as the clay look does: parts painted
    // from the sign atlas (motors, drum cores, name plates) would otherwise ghost darker
    // than the frame around them, and polished steel would mirror the room. So no map, no
    // per-vertex color, and one finish (the frame's) everywhere. A foam strip keeps the
    // mask that cuts it out (alphaMap).
    if (copy.color) copy.color.set(p.ghost)
    copy.map = null
    copy.vertexColors = false
    if (copy.roughness !== undefined) {
      copy.roughness = 0.5
      copy.metalness = 0.2
      copy.roughnessMap = null
      copy.metalnessMap = null
      copy.envMap = null
    }
    const coat = copy as MeshStandardMaterial & { clearcoat?: number }
    if (coat.clearcoat) coat.clearcoat = 0
    copy.transparent = true
    copy.opacity = 0.24
    copy.depthWrite = false
    if (copy.emissive) copy.emissiveIntensity = 0
    // Cut-out materials (foam strips) throw away every pixel fainter than alphaTest,
    // which at this opacity is all of them: scale the cut to match. Hundreds of strips
    // lie over each other, so each is fainter still and loses its shading, or a ghosted
    // brush comes out as the darkest thing in the tunnel.
    if (copy.alphaTest > 0) {
      const cut = copy.alphaTest
      copy.opacity = 0.1
      copy.alphaToCoverage = false
      copy.alphaTest = cut * copy.opacity
    }
    copy.defines = { ...copy.defines, T3D_FLAT: '' }
  },
}

export type MaterialSet = {
  mat: Materials
  variant(m: Material, looks: string | ReadonlyArray<string>): Material
  defineLook(name: string, tweak: LookTweak): void
  // The room metals reflect. They mirror it more strongly than the scene's soft ambient
  // light would let them, or polished steel comes out charcoal.
  setEnvironment(map: Texture | null): void
  setTheme(p: Palette): void
  dispose(): void
}

export function createMaterials(tex: Textures, signMap: () => Texture, palette: Palette): MaterialSet {
  const made = new Map<string, MeshStandardMaterial>()
  const variants = new Map<Material, Map<string, { copy: Material; looks: string[] }>>()
  const tweaks = new Map<string, LookTweak>(Object.entries(BUILT_IN))
  let pal = palette
  let envMap: Texture | null = null

  const reflect = (m: MeshStandardMaterial) => {
    if (m.metalness < 0.6) return
    if ((m.envMap === null) !== (envMap === null)) m.needsUpdate = true
    m.envMap = envMap
    m.envMapIntensity = pal.metalEnv
  }

  const themed = (name: string): string | null =>
    name === 'concrete' ? pal.concrete : name === 'concreteEdge' ? pal.concreteEdge : name === 'curb' ? pal.curb : null

  const make = (name: MatName): MeshStandardMaterial => {
    if (name === 'sign') {
      return new MeshStandardMaterial({ map: signMap(), roughness: 0.55, metalness: 0.1 })
    }
    const s: Spec = SPECS[name]
    if (name === 'carPaint') {
      return new MeshPhysicalMaterial({ color: s.color, roughness: s.rough, clearcoat: 1, clearcoatRoughness: 0.06 })
    }
    const m = new MeshStandardMaterial({ color: themed(name) ?? s.color, roughness: s.rough, metalness: s.metal ?? 0 })
    if (s.finish === 'brushed') m.roughnessMap = tex.brushed
    if (s.emissive) {
      m.emissive = new Color(s.color)
      m.emissiveIntensity = s.emissive
      m.userData.glows = true
    }
    if (name === 'concrete') {
      m.map = tex.concrete
      m.roughnessMap = tex.concrete
    }
    return m
  }

  const mat = {} as Record<MatName, MeshStandardMaterial>
  for (const name of [...Object.keys(SPECS), 'sign'] as MatName[]) {
    Object.defineProperty(mat, name, {
      enumerable: true,
      get: () => {
        let m = made.get(name)
        if (!m) {
          m = make(name)
          m.name = name
          reflect(m)
          made.set(name, m)
        }
        return m
      },
    })
  }

  // Dresses a copy from scratch: back to the source, then each look in turn. A copy keeps
  // the source's shader hooks, so a foam brush's lit copy still flies.
  const dress = (copy: Material, src: Material, looks: string[]) => {
    copy.copy(src)
    copy.onBeforeCompile = src.onBeforeCompile
    copy.customProgramCacheKey = src.customProgramCacheKey
    copy.name = `${src.name}:${looks.join('+')}`
    for (const look of looks) tweaks.get(look)?.(copy as MeshStandardMaterial, pal)
    // A look may switch something the shader is built around (a map, a cut-out): have
    // the renderer check. It reuses the program it has when nothing of the kind changed.
    copy.needsUpdate = true
    reflect(copy as MeshStandardMaterial)
  }

  // One copy per material and list of looks, owned here.
  const variant = (src: Material, looks: string | ReadonlyArray<string>): Material => {
    const list = typeof looks === 'string' ? [looks] : [...looks]
    if (!list.length) return src
    let set = variants.get(src)
    if (!set) {
      set = new Map()
      variants.set(src, set)
      // A brush frees its own material when its model is rebuilt: its copies go with it.
      src.addEventListener('dispose', () => {
        const s = variants.get(src)
        if (!s) return
        for (const v of s.values()) v.copy.dispose()
        variants.delete(src)
      })
    }
    const key = list.join('+')
    const have = set.get(key)
    if (have) return have.copy
    for (const look of list) if (!tweaks.has(look)) console.warn(`[tunnel3d] look "${look}" is not defined (kit.defineLook)`)
    const copy = src.clone()
    dress(copy, src, list)
    set.set(key, { copy, looks: list })
    return copy
  }

  return {
    mat,
    variant,
    defineLook(name, tweak) {
      tweaks.set(name, tweak)
      // Copies already wearing it are dressed again.
      for (const [src, set] of variants) for (const v of set.values()) if (v.looks.includes(name)) dress(v.copy, src, v.looks)
    },
    setEnvironment(map) {
      envMap = map
      for (const m of made.values()) reflect(m)
      for (const set of variants.values()) for (const v of set.values()) reflect(v.copy as MeshStandardMaterial)
    },
    setTheme(p) {
      pal = p
      for (const [name, m] of made) {
        const c = themed(name)
        if (c) m.color.set(c)
        reflect(m)
      }
      for (const [src, set] of variants) for (const v of set.values()) dress(v.copy, src, v.looks)
    },
    dispose() {
      for (const set of variants.values()) for (const v of set.values()) v.copy.dispose()
      variants.clear()
      for (const m of made.values()) m.dispose()
      made.clear()
    },
  }
}
