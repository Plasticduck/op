// Photos for the tunnel reading. A pick opens each photo once (readPhoto): that checks the
// browser can, keeps a small copy for its tile, and makes the JPEG that is sent, for the
// share of the request it has with the photos picked so far. The full-size photo isn't
// kept, since hundreds of camera photos held at full size would fill a phone's memory, and
// it isn't opened a second time just to send it: with hundreds of camera photos on a phone,
// that second opening alone is many minutes. Only a photo whose share has changed since (more
// photos added, or many removed) is made again from its file (encodePhoto). The JPEG is
// base64 without the data: prefix: turned the way the camera held it, no more than 1568 px
// on its long side, and within its share. Nothing here is uploaded or kept: it all lives in
// the dialog until it closes. A HEIC the browser can't open is read on the device too
// (heic.ts), never sent anywhere to be converted.

import { decodeHeic, HeicError, isHeic, type HeicFailure } from './heic'

// Enough to make out the machines. Claude would take more, but every pixel costs time and
// money, and with more than 20 photos in a request it takes no more than 3000.
const LONG_SIDE = 1568
// The tile's copy: enough for a tile at twice the screen's density.
const THUMB_SIDE = 400
const QUALITY = 0.82
// Below this a JPEG's blocks start to hide what Claude reads, so a photo still over its share
// here is made smaller instead.
const LOW_QUALITY = 0.6
const UNREADABLE = "This file couldn't be opened as a photo."
const NO_CANVAS = "This browser couldn't get the photo ready. Try another browser."
// It opened when it was picked, so its file has been moved or deleted since, or (on a cloud
// drive) isn't on the device any more.
const GONE = "This photo couldn't be opened again. Remove it and add it again."
// Why a HEIC this browser couldn't open itself couldn't be read either (heic.ts).
const HEIC: Record<HeicFailure, string> = {
  bad: "This HEIC photo couldn't be opened. It may be damaged, or only partly copied.",
  load: "This browser couldn't load what it needs to open HEIC photos. Check the connection, then remove this photo and add it again.",
  // Reloading is the only way back, and it loses the photos in the dialog, so it isn't done
  // for them.
  stale: 'Operator was updated since this page was opened. Reload the page, then add the HEIC photos again.',
  slow: 'This HEIC photo took too long to open. Remove it and add it again.',
  closed: "This HEIC photo couldn't be opened. Remove it and add it again.",
}

// What a person sees when a photo can't be used.
export class PhotoError extends Error {}

// What Claude counts a photo as: one visual token for every 28 by 28 px square, a square
// that is only started counting whole.
export const visualTokens = (width: number, height: number) => Math.ceil(width / 28) * Math.ceil(height / 28)

// The size a photo is sent at when nothing has to give.
export function fullSize(width: number, height: number): { width: number; height: number } {
  const s = Math.min(1, LONG_SIDE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) }
}

// A photo's share of one request: the base64 it may take, and the visual tokens.
export type Share = { chars: number; tokens: number }

export type PickedPhoto = {
  // A small JPEG for the tile, as an object URL. The caller revokes it.
  thumb: string
  // The JPEG to send, for the share it was picked with.
  photo: EncodedPhoto
}

export type EncodedPhoto = {
  // Base64 JPEG, no prefix.
  data: string
  width: number
  height: number
  tokens: number
  // Nothing had to give (full size, full quality): it is what any share it fits would get.
  full: boolean
}

type Decoded = { source: CanvasImageSource; width: number; height: number; done: () => void }

// The photo drawn upright. createImageBitmap reads the EXIF turn itself when asked
// ('from-image'); where it can't open the file (or isn't there), an <img> does, since
// browsers apply EXIF orientation to images by default. A HEIC the browser can't open
// (anywhere but Safari) is read by libheif instead (heic.ts), which turns it upright from the
// file's own turn (irot), so nothing here turns it again. Anything else that fails both (a
// RAW file, not a photo) can't be used. closed: the dialog has gone, so no HEIC worker is
// started for it.
async function decode(file: File, closed?: AbortSignal): Promise<Decoded> {
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
  }
  if (!(await isHeic(file))) throw new PhotoError(UNREADABLE)
  let bmp: ImageBitmap
  try {
    bmp = await decodeHeic(file, closed)
  } catch (e) {
    throw new PhotoError(e instanceof HeicError ? HEIC[e.kind] : HEIC.bad)
  }
  return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() }
}

// The photo on a canvas of this size. A PNG's see-through parts would turn black as a JPEG,
// so it goes on white.
function draw(img: Decoded, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PhotoError(NO_CANVAS)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  // A camera photo drawn at a tenth of its size shimmers without it.
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img.source, 0, 0, width, height)
  return canvas
}

// A canvas holds its pixels until it is collected, and Safari counts them against a limit
// for the whole page: hundreds of photos in a row would reach it.
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
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

// A photo just picked, opened once: one the browser can't open is turned away now with the
// reason, and the rest are drawn small for the tile and made into the JPEG for this share.
// The full-size photo isn't kept.
export async function readPhoto(file: File, share: Share, closed?: AbortSignal): Promise<PickedPhoto> {
  const img = await decode(file, closed)
  let thumb: string | null = null
  try {
    if (!img.width || !img.height) throw new PhotoError(UNREADABLE)
    const s = Math.min(1, THUMB_SIDE / Math.max(img.width, img.height))
    const canvas = draw(img, Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s)))
    const blob = await toBlob(canvas, 0.75)
    release(canvas)
    if (!blob) throw new PhotoError(NO_CANVAS)
    thumb = URL.createObjectURL(blob)
    return { thumb, photo: await encode(img, share) }
  } catch (e) {
    if (thumb) URL.revokeObjectURL(thumb)
    throw e
  } finally {
    img.done()
  }
}

// A photo made again for a new share, from its file.
export async function encodePhoto(file: File, share: Share, closed?: AbortSignal): Promise<EncodedPhoto> {
  let img: Decoded
  try {
    img = await decode(file, closed)
  } catch (e) {
    // The HEIC reader not starting (offline, or Operator updated since the page loaded) isn't
    // about this photo, and removing it wouldn't help, so that reason is passed on.
    if (e instanceof PhotoError && (e.message === HEIC.stale || e.message === HEIC.load)) throw e
    throw new PhotoError(GONE)
  }
  try {
    return await encode(img, share)
  } finally {
    img.done()
  }
}

// The largest size of this shape, no bigger than it is, that costs no more than tokens.
function fitTokens(width: number, height: number, tokens: number): { width: number; height: number } {
  if (visualTokens(width, height) <= tokens) return { width, height }
  // The first guess covers exactly the area the tokens do, which the squares only started
  // make a little large, so the long side comes down from there a pixel at a time (a square's
  // worth at most).
  const long = Math.max(width, height)
  for (let side = Math.min(long - 1, Math.floor(long * Math.sqrt((tokens * 784) / (width * height)))); side > 1; side--) {
    const w = Math.max(1, Math.round((width * side) / long))
    const h = Math.max(1, Math.round((height * side) / long))
    if (visualTokens(w, h) <= tokens) return { width: w, height: h }
  }
  return { width: 1, height: 1 }
}

// The photo as it is sent, within its share. The visual tokens set the largest size it can
// be; a busy photo whose JPEG still comes out longer than its share of characters is saved
// again at a lower quality, then smaller, until it fits.
async function encode(img: Decoded, share: Share): Promise<EncodedPhoto> {
  if (!img.width || !img.height) throw new PhotoError(UNREADABLE)
  const top = fullSize(img.width, img.height)
  let { width, height } = fitTokens(top.width, top.height, share.tokens)
  let quality = QUALITY
  let canvas: HTMLCanvasElement | null = null
  try {
    for (let tries = 0; tries < 12; tries++) {
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        if (canvas) release(canvas)
        canvas = draw(img, width, height)
      }
      const blob = await toBlob(canvas, quality)
      if (!blob) throw new PhotoError(NO_CANVAS)
      const data = await base64(blob)
      if (data.length <= share.chars) {
        return { data, width, height, tokens: visualTokens(width, height), full: quality === QUALITY && width === top.width && height === top.height }
      }
      const ratio = share.chars / data.length
      if (quality > LOW_QUALITY) {
        // Quality first: a near miss takes one step down, a far one goes to the floor at once.
        quality = ratio > 0.85 && quality - 0.1 > LOW_QUALITY + 0.05 ? quality - 0.1 : LOW_QUALITY
      } else {
        // A JPEG's length goes roughly with its area, so each side shrinks by the root of
        // what has to give, a little more so it lands inside.
        const s = Math.min(0.9, Math.sqrt(ratio) * 0.95)
        width = Math.max(1, Math.round(width * s))
        height = Math.max(1, Math.round(height * s))
        if (Math.max(width, height) < 64) break
      }
    }
  } finally {
    if (canvas) release(canvas)
  }
  throw new PhotoError('This photo is too detailed to send. Try another one.')
}
