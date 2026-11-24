// Finds every generated atlas in game/assets, loads its image, and draws frames by name.
import type { AtlasDef, DrawOpts, SpriteFrame, Sprites } from '../contract'

type Source = { image: CanvasImageSource; frame: SpriteFrame }

const NO_FRAMES: string[] = []
const LOAD_TIMEOUT_MS = 15000
// A sheet that fails is asked for again after these pauses: most failures are a passing blip.
const RETRY_MS = [1000, 3000]

/** Every sheet that has loaded on this page, by URL: a later load reuses it, and warmSheets draws it. */
const images = new Map<string, HTMLImageElement>()
const missingOf = new WeakMap<Sprites, readonly string[]>()

function isAtlas(v: unknown): v is AtlasDef {
  const a = v as AtlasDef | null
  return !!a && typeof a === 'object' && typeof a.name === 'string' && typeof a.image === 'string' && !!a.frames && typeof a.frames === 'object'
}

function loadOnce(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS)
    const done = (ok: boolean) => {
      clearTimeout(timer)
      resolve(ok ? img : null)
    }
    img.onload = () => done(img.naturalWidth > 0)
    img.onerror = () => done(false)
    img.src = url
  })
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const known = images.get(url)
  if (known) return known
  for (let i = 0; ; i++) {
    const img = await loadOnce(url)
    if (img) {
      images.set(url, img)
      return img
    }
    if (i >= RETRY_MS.length) return null
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS[i]))
  }
}

/** Builds the Sprites object from atlases whose images are already in hand. An atlas without an image is known but draws nothing. */
export function buildSprites(loaded: ReadonlyArray<{ def: AtlasDef; image: CanvasImageSource | null }>): Sprites {
  const atlases = new Map<string, AtlasDef>()
  const sources = new Map<string, Source>()
  const anims = new Map<string, string[]>()
  for (const { def, image } of loaded) {
    atlases.set(def.name, def)
    if (image) for (const [name, frame] of Object.entries(def.frames)) sources.set(`${def.name}/${name}`, { image, frame })
    for (const [name, frames] of Object.entries(def.anims ?? {})) {
      anims.set(
        `${def.name}/${name}`,
        frames.map((f) => `${def.name}/${f}`),
      )
    }
  }

  return {
    has: (name) => sources.has(name),
    frame: (name) => sources.get(name)?.frame ?? null,
    source: (name) => sources.get(name) ?? null,
    atlas: (name) => atlases.get(name) ?? null,
    anim: (atlas, anim) => anims.get(`${atlas}/${anim}`) ?? NO_FRAMES,
    draw(g: CanvasRenderingContext2D, name: string, x: number, y: number, opts?: DrawOpts) {
      const src = sources.get(name)
      if (!src) return
      const f = src.frame
      const s = Math.max(1, Math.round(opts?.scale ?? 1))
      const px = Math.round(x)
      const py = Math.round(y)
      const ax = (f.ax ?? 0) * s
      const ay = (f.ay ?? 0) * s
      const alpha = opts?.alpha ?? 1
      if (alpha <= 0) return
      const before = g.globalAlpha
      if (alpha < 1) g.globalAlpha = before * alpha
      if (s !== 1 && g.imageSmoothingEnabled) g.imageSmoothingEnabled = false
      if (opts?.flipX) {
        g.save()
        g.translate(px, py)
        g.scale(-1, 1)
        g.drawImage(src.image, f.x, f.y, f.w, f.h, -ax, -ay, f.w * s, f.h * s)
        g.restore()
      } else {
        g.drawImage(src.image, f.x, f.y, f.w, f.h, px - ax, py - ay, f.w * s, f.h * s)
      }
      if (alpha < 1) g.globalAlpha = before
    },
  }
}

export const emptySprites = (): Sprites => buildSprites([])

async function loadAll(): Promise<Sprites> {
  const found = import.meta.glob<Record<string, unknown>>('../assets/*.atlas.ts', { eager: true })
  const defs = Object.values(found)
    .map((m) => m.atlas)
    .filter(isAtlas)
  const got = await Promise.all(defs.map((d) => loadImage(d.image)))
  const missing: string[] = []
  got.forEach((img, i) => {
    if (img) return
    missing.push(defs[i].name)
    console.warn(`[maxx] sprite sheet "${defs[i].name}" did not load: ${defs[i].image}`)
  })
  const sprites = buildSprites(defs.map((def, i) => ({ def, image: got[i] })))
  missingOf.set(sprites, missing)
  return sprites
}

let cache: Promise<Sprites> | null = null

/**
 * Loads once per page: a remount (React StrictMode, coming back to the route) reuses the images.
 * A load with a sheet missing is not kept, so the next call asks again for what is missing.
 */
export function loadSprites(): Promise<Sprites> {
  if (!cache) {
    const p: Promise<Sprites> = loadAll().then(
      (sprites) => {
        if (missingSheets(sprites).length && cache === p) cache = null
        return sprites
      },
      (err: unknown) => {
        if (cache === p) cache = null
        throw err
      },
    )
    cache = p
  }
  return cache
}

/** The names of the sheets this load could not get (empty when all is well). */
export function missingSheets(sprites: Sprites): readonly string[] {
  return missingOf.get(sprites) ?? NO_FRAMES
}

/**
 * Draws one pixel of every sheet loaded so far, so the browser decodes them and hands them to the
 * graphics card now, behind LOADING, and not in the first frame of the level that shows each one
 * (about 100 ms on a slow PC). Whatever draws next covers the pixel.
 */
export function warmSheets(g: CanvasRenderingContext2D): void {
  for (const img of images.values()) {
    try {
      g.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1)
    } catch {
      // Only a head start lost.
    }
  }
}
