import { PHOTO_LIMITS } from '@/lib/queries/miTunnel'

// A picked photo, made ready to send: a JPEG no more than 1568 px on its long side (as
// large as Claude looks at a photo; anything bigger is scaled down there anyway), turned
// the way the camera held it, as base64 without the data: prefix. A phone photo comes in
// at 3 to 5 MB and leaves at a few hundred KB. Nothing here is uploaded or kept: the
// result lives in the dialog until it closes.

const LONG_SIDE = 1568
const QUALITY = 0.82

export type PreparedPhoto = {
  // Base64 JPEG, no prefix.
  data: string
  // The JPEG as an object URL, for the thumbnail. The caller revokes it.
  url: string
  width: number
  height: number
}

// What a person sees when a photo can't be used.
export class PhotoError extends Error {}

// The photo drawn upright. createImageBitmap reads the EXIF turn itself when asked
// ('from-image'); where it can't open the file (or isn't there), an <img> does, since
// browsers apply EXIF orientation to images by default. A format the browser can't decode
// (HEIC on a desktop, a RAW file) fails both.
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() }
    } catch { /* try an <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('decode'))
      im.src = url
    })
    await img.decode().catch(() => {})
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new PhotoError(/\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type)
      ? "This browser can't open HEIC photos. Pick it on the phone that took it, or save it as a JPEG first."
      : "This file couldn't be opened as a photo.")
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result ?? '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(r.error ?? new Error('read'))
    r.readAsDataURL(blob)
  })
}

// maxChars is how long the base64 may be: the function's limit for one photo, or less when
// many photos have to share the request's whole budget. A busy photo that comes out longer
// is saved again at a lower quality, then smaller, until it fits.
export async function preparePhoto(file: File, maxChars: number = PHOTO_LIMITS.chars): Promise<PreparedPhoto> {
  const { blob, ...rest } = await encode(file, maxChars)
  return { ...rest, url: URL.createObjectURL(blob) }
}

// The same, smaller, for a photo over its share of the request: only the base64, since the
// thumbnail it already has will do. An object URL here would only be one more to revoke.
export async function shrinkPhoto(file: File, maxChars: number): Promise<string> {
  return (await encode(file, maxChars)).data
}

async function encode(file: File, maxChars: number): Promise<Omit<PreparedPhoto, 'url'> & { blob: Blob }> {
  const img = await decode(file)
  try {
    if (!img.width || !img.height) throw new PhotoError("This file couldn't be opened as a photo.")
    let scale = Math.min(1, LONG_SIDE / Math.max(img.width, img.height))
    let quality = QUALITY
    for (let tries = 0; tries < 8; tries++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new PhotoError("This browser couldn't get the photo ready. Try another browser.")
      // A PNG's see-through parts would turn black as a JPEG.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height)
      const blob = await toBlob(canvas, quality)
      if (!blob) throw new PhotoError("This browser couldn't get the photo ready. Try another browser.")
      const data = await base64(blob)
      if (data.length <= maxChars) return { data, blob, width: canvas.width, height: canvas.height }
      if (quality > 0.6) quality = Math.max(0.6, quality - 0.1)
      else scale *= 0.8
    }
    throw new PhotoError('This photo is too detailed to send. Try another one.')
  } finally {
    img.done()
  }
}
