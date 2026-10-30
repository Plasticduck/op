import type { StickerLogo } from './labelPdf'

// A logo made fit for sticker printers: solid black on white (thermal printers
// can't print gray, and dithered logos come out muddy), trimmed to its ink so
// it fills the space it gets. Anything that isn't near-white prints black, so
// a colored logo becomes a solid silhouette and white lettering inside a
// colored shape stays white.

const MAX_PX = 900
// Luminance (0-1, over white) below which a pixel prints black. Lower keeps
// mid colors white (a detailed logo then prints as outlines), higher turns
// everything but near-white black.
export const DEFAULT_INK = 0.82

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error("That image couldn't be opened. Use a PNG, JPG or SVG."))
    im.src = url
  })
}

const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the logo."))), 'image/png'))

// Any image (PNG, JPG, SVG, WebP) -> a trimmed black-and-white PNG.
export async function stickerLogoFrom(src: Blob, ink = DEFAULT_INK): Promise<Blob> {
  const url = URL.createObjectURL(src)
  try {
    const img = await loadImage(url)
    // SVGs without a set size report 0; draw them at a usable size.
    const w0 = img.naturalWidth || 600
    const h0 = img.naturalHeight || 600
    const scale = Math.min(1, MAX_PX / Math.max(w0, h0))
    const W = Math.max(1, Math.round(w0 * scale))
    const H = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error("Couldn't prepare the logo.")
    // Transparent parts count as white.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(img, 0, 0, W, H)
    const px = ctx.getImageData(0, 0, W, H)
    const d = px.data
    let minX = W, minY = H, maxX = -1, maxY = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const black = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255 < ink
        const v = black ? 0 : 255
        d[i] = v
        d[i + 1] = v
        d[i + 2] = v
        d[i + 3] = 255
        if (black) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) throw new Error('That logo is too light to print. Use a dark version of it.')
    ctx.putImageData(px, 0, 0)
    const out = document.createElement('canvas')
    out.width = maxX - minX + 1
    out.height = maxY - minY + 1
    const octx = out.getContext('2d')
    if (!octx) throw new Error("Couldn't prepare the logo.")
    octx.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height)
    return await toBlob(out)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// A stored logo, ready for buildLabelsPdf.
export async function readStickerLogo(png: Blob): Promise<StickerLogo> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(png)
  })
  const img = await loadImage(dataUrl)
  return { dataUrl, aspect: (img.naturalWidth || 1) / (img.naturalHeight || 1) }
}
