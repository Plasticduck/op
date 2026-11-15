import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Texture } from 'three'

// Textures painted on a canvas at startup: there are no image files. Color maps are
// tagged sRGB; data maps (roughness) are left untagged, or three reads them wrong.

// A small seeded generator, so every load paints the same concrete.
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function colorTex(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping
  return t
}

function dataTex(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = NoColorSpace
  t.anisotropy = 4
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping
  return t
}

// For surfaces whose uvs are in feet: one tile covers this many feet.
function perFoot(t: CanvasTexture, feet: number): CanvasTexture {
  t.repeat.set(1 / feet, 1 / feet)
  return t
}

// Troweled concrete, tileable: near white, so the material's color sets the tone.
function paintConcrete(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size, size)
  const r = rng(7)
  g.fillStyle = '#ebebeb'
  g.fillRect(0, 0, size, size)
  // Draw a shape again across each edge it crosses, so the tile has no seam.
  const wrapped = (x: number, y: number, rad: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        if (x + dx + rad < 0 || x + dx - rad > size || y + dy + rad < 0 || y + dy - rad > size) continue
        draw(x + dx, y + dy)
      }
    }
  }
  const blotch = (n: number, rMin: number, rMax: number, alpha: number) => {
    for (let k = 0; k < n; k++) {
      const rad = (rMin + r() * (rMax - rMin)) * (size / 1024)
      const tone = r() < 0.5 ? '0,0,0' : '255,255,255'
      wrapped(r() * size, r() * size, rad, (x, y) => {
        const grad = g.createRadialGradient(x, y, 0, x, y, rad)
        grad.addColorStop(0, `rgba(${tone},${alpha})`)
        grad.addColorStop(1, `rgba(${tone},0)`)
        g.fillStyle = grad
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
      })
    }
  }
  blotch(34, 140, 340, 0.022)
  blotch(220, 10, 46, 0.022)
  for (let k = 0; k < 9000 * (size / 1024) ** 2; k++) {
    const dark = r() < 0.6
    g.fillStyle = `rgba(${dark ? '0,0,0' : '255,255,255'},${0.04 + r() * 0.1})`
    const s = r() < 0.85 ? 1 : 2
    g.fillRect(r() * size, r() * size, s, s)
  }
  return c
}

// Fine parallel scratches: as a roughness map it fakes brushed metal.
function paintBrushed(): HTMLCanvasElement {
  const [c, g] = canvas(256, 256)
  const r = rng(11)
  g.fillStyle = '#c4c4c4'
  g.fillRect(0, 0, 256, 256)
  for (let k = 0; k < 520; k++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + r() * 0.07})`
    g.fillRect(0, Math.floor(r() * 256), 256, 1)
  }
  return c
}

// One foam strip, as two pictures. The mask cuts it into three fingers joined at the root
// (the bottom of the picture), each ending in a round tip. The shade is darker toward the
// root, where strips shade each other. They are kept apart because a canvas forgets the
// color of a transparent pixel, which would leave a dark fringe around every finger.
function paintClothMask(): HTMLCanvasElement {
  const W = 64
  const H = 256
  const [c, g] = canvas(W, H)
  const r = rng(23)
  g.fillStyle = '#000'
  g.fillRect(0, 0, W, H)
  const fingers = 3
  const gap = 4
  const fw = (W - 4 - gap * (fingers - 1)) / fingers
  g.fillStyle = '#fff'
  g.fillRect(2, H * 0.7, W - 4, H * 0.3)
  for (let k = 0; k < fingers; k++) {
    const x = 2 + k * (fw + gap)
    const tip = 4 + r() * 18
    g.beginPath()
    g.moveTo(x - 1.2, H * 0.74)
    g.lineTo(x + 0.4, tip + fw / 2)
    g.arc(x + fw / 2, tip + fw / 2, fw / 2 - 0.4, Math.PI, 0)
    g.lineTo(x + fw + 1.2, H * 0.74)
    g.closePath()
    g.fill()
  }
  return c
}

function paintClothShade(): HTMLCanvasElement {
  const W = 64
  const H = 256
  const [c, g] = canvas(W, H)
  const r = rng(29)
  const grad = g.createLinearGradient(0, H, 0, 0)
  grad.addColorStop(0, '#4e4e4e')
  grad.addColorStop(0.28, '#959595')
  grad.addColorStop(0.6, '#dedede')
  grad.addColorStop(1, '#ffffff')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  for (let k = 0; k < 30; k++) {
    g.fillStyle = `rgba(${r() < 0.55 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.06})`
    g.fillRect(Math.floor(r() * W), r() * H * 0.4, 1 + Math.floor(r() * 2), H * (0.4 + r() * 0.6))
  }
  return c
}

// Yellow and black at 45 degrees, tileable.
function paintHazard(yellow: string, black: string): HTMLCanvasElement {
  const S = 128
  const [c, g] = canvas(S, S)
  g.fillStyle = yellow
  g.fillRect(0, 0, S, S)
  g.fillStyle = black
  for (let k = -1; k < 2; k++) {
    g.beginPath()
    g.moveTo(k * S, S)
    g.lineTo(k * S + S / 2, S)
    g.lineTo(k * S + S * 1.5, 0)
    g.lineTo(k * S + S, 0)
    g.closePath()
    g.fill()
  }
  return c
}

export type Textures = {
  // The slab's color, also used as its roughness (one upload, not two). One tile is 20 ft.
  concrete: Texture
  brushed: Texture
  // A foam strip: its shading, and the mask that cuts it into fingers (an alphaMap).
  cloth: Texture
  clothMask: Texture
  hazard: Texture
  dispose(): void
}

export function createTextures(detail: 'high' | 'low', yellow: string, black: string): Textures {
  const made = new Map<string, CanvasTexture>()
  const lazy = (name: string, make: () => CanvasTexture): CanvasTexture => {
    let t = made.get(name)
    if (!t) {
      t = make()
      made.set(name, t)
    }
    return t
  }
  return {
    get concrete() { return lazy('concrete', () => perFoot(colorTex(paintConcrete(detail === 'high' ? 1024 : 512), true), 20)) },
    get brushed() { return lazy('brushed', () => dataTex(paintBrushed(), true)) },
    get cloth() { return lazy('cloth', () => colorTex(paintClothShade())) },
    get clothMask() { return lazy('clothMask', () => dataTex(paintClothMask())) },
    get hazard() { return lazy('hazard', () => colorTex(paintHazard(yellow, black), true)) },
    dispose() {
      for (const t of made.values()) t.dispose()
      made.clear()
    },
  }
}
