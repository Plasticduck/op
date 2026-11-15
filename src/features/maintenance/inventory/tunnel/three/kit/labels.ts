import { BufferAttribute, CanvasTexture, PlaneGeometry, SRGBColorSpace } from 'three'
import type { BufferGeometry } from 'three'
import { COLORS } from './palette'

// Name plates. Every plate in the scene is a rectangle cut from one shared picture (an
// atlas), so forty labeled machines need one texture and one material. The same picture
// holds flat color swatches: a shape whose uvs point at a swatch can share the sign
// material too, which lets a simple model be a single draw call, label included. The
// swatches below have names; any other color (a CSS hex) gets a slot the first time it
// is asked for.

export const SWATCHES = {
  body: '#b9bfc7',
  frame: COLORS.frame,
  mid: '#8d949e',
  dark: '#2b3038',
  black: '#17191d',
  white: '#eef0f2',
  yellow: COLORS.yellow,
  blue: COLORS.conveyorBlue,
  pad: '#aab0b8',
  red: COLORS.red,
  brass: COLORS.brass,
  hoseWhite: COLORS.hoseWhite,
  hoseRed: COLORS.hoseRed,
  hoseBlue: COLORS.hoseBlue,
  hoseBlack: COLORS.hoseBlack,
  green: COLORS.hoseGreen,
} as const
export type Swatch = keyof typeof SWATCHES
// What kit.paint and kit.swatch take: a named swatch or any hex color.
export type Paint = Swatch | `#${string}`

export type SignAtlas = {
  texture: CanvasTexture
  // A plate w by h feet, standing in the XY plane and facing +Z, showing the text.
  signGeo(text: string, w: number, h: number): BufferGeometry
  // Points every uv of a shape at one flat color. Returns the same geometry.
  paint<T extends BufferGeometry>(geo: T, color: Paint): T
  dispose(): void
}

export function createSignAtlas(detail: 'high' | 'low'): SignAtlas {
  const size = detail === 'high' ? 2048 : 1024
  const cols = 4
  const rows = 32
  const cw = size / cols
  const ch = size / rows
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = COLORS.signPlate
  g.fillRect(0, 0, size, size)
  // Colors fill the top two rows, one small block each: the named ones first, then any
  // other color in the order it's first asked for.
  const perRow = 32
  const colorRows = 2
  const sw = size / perRow
  const slots = new Map<string, number>()
  const slotFor = (color: string): number => {
    const css = (SWATCHES as Record<string, string>)[color] ?? color
    const key = css.toLowerCase()
    let k = slots.get(key)
    if (k != null) return k
    if (slots.size >= perRow * colorRows) {
      console.warn(`[tunnel3d] the sign atlas is out of color slots: "${color}" is drawn as "mid"`)
      return slotFor('mid')
    }
    k = slots.size
    slots.set(key, k)
    g.fillStyle = css
    g.fillRect((k % perRow) * sw, Math.floor(k / perRow) * ch, sw, ch)
    return k
  }
  for (const name of Object.keys(SWATCHES)) slotFor(name)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8

  const cells = new Map<string, { col: number; row: number; frac: number }>()
  let next = 0
  const total = cols * (rows - colorRows)

  const cellFor = (text: string, aspect: number) => {
    // The plate uses the middle of its cell, as wide as its own shape allows.
    const frac = Math.min(1, Math.max(0.2, (aspect * ch) / cw))
    const key = `${text}|${frac.toFixed(2)}`
    let cell = cells.get(key)
    if (cell) return cell
    // Out of cells: start over from the first. A drawing would need over a hundred
    // different names to get here.
    if (next >= total) {
      next = 0
      cells.clear()
    }
    cell = { col: next % cols, row: colorRows + Math.floor(next / cols), frac }
    next++
    cells.set(key, cell)
    const x = cell.col * cw
    const y = cell.row * ch
    g.fillStyle = COLORS.signPlate
    g.fillRect(x, y, cw, ch)
    const w = cw * frac
    g.fillStyle = COLORS.signInk
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    let px = ch * 0.56
    const label = text.toUpperCase()
    g.font = `600 ${px}px "Inter", "Segoe UI", system-ui, sans-serif`
    const fit = (w * 0.88) / Math.max(1, g.measureText(label).width)
    if (fit < 1) {
      px *= fit
      g.font = `600 ${px}px "Inter", "Segoe UI", system-ui, sans-serif`
    }
    g.fillText(label, x + cw / 2, y + ch / 2 + px * 0.04)
    texture.needsUpdate = true
    return cell
  }

  return {
    texture,
    signGeo(text, w, h) {
      const cell = cellFor(text, w / h)
      const geo = new PlaneGeometry(w, h)
      const uv = geo.attributes.uv as BufferAttribute
      const u0 = (cell.col + 0.5 - cell.frac / 2) / cols
      const u1 = (cell.col + 0.5 + cell.frac / 2) / cols
      // Half a pixel in from the cell's edges, so the next cell never bleeds in.
      const v0 = 1 - (cell.row + 1) / rows + 0.5 / size
      const v1 = 1 - cell.row / rows - 0.5 / size
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) < 0.5 ? u0 : u1, uv.getY(k) < 0.5 ? v0 : v1)
      return geo
    },
    paint(geo, color) {
      const before = slots.size
      const k = slotFor(color)
      if (slots.size !== before) texture.needsUpdate = true
      // Every vertex gets the same uv, so the texture is always read at full size and a
      // small block never bleeds into its neighbors.
      const u = (((k % perRow) + 0.5) * sw) / size
      const v = 1 - ((Math.floor(k / perRow) + 0.5) * ch) / size
      const count = geo.attributes.position.count
      const uv = new Float32Array(count * 2)
      for (let i = 0; i < count; i++) {
        uv[i * 2] = u
        uv[i * 2 + 1] = v
      }
      geo.setAttribute('uv', new BufferAttribute(uv, 2))
      return geo
    },
    dispose() {
      texture.dispose()
      cells.clear()
    },
  }
}
