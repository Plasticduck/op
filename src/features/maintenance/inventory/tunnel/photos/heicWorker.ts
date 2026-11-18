// The HEIC reader (heic.ts), off the page's thread: a 12 MP iPhone photo takes a second or
// more to open, and hundreds of them would freeze the dialog. heic-to runs libheif (compiled
// to plain JavaScript, no separate .wasm file) in a worker of its own, started from here, so
// ending this worker when the dialog closes ends that one too and gives back its memory.
// Only this file imports heic-to, so its 3 MB is only fetched once a HEIC needs it. The csp
// build is used because it needs no eval; its 'bitmap' output works in a worker. It does
// start its libheif worker from a blob: URL, so a Content Security Policy added to the app
// later must allow `worker-src 'self' blob:` (no wasm-unsafe-eval: there is no wasm).
// The notice below is a legal (/*!) comment so the minifier keeps it in the built worker.
/*! heic-to 1.6.7 (https://github.com/hoppergee/heic-to), with libheif 1.23.7
    (https://github.com/strukturag/libheif) and libde265 (https://github.com/strukturag/libde265):
    free software under the GNU Lesser General Public License v3.0 or later,
    https://www.gnu.org/licenses/lgpl-3.0.html */
import { heicTo } from 'heic-to/csp'

export type HeicAsk = { id: number; file: Blob }
export type HeicReply =
  | { id: number; bitmap: ImageBitmap }
  // bad: libheif couldn't read the file. load: heic-to's own worker didn't start.
  | { id: number; error: 'bad' | 'load'; detail: string }

// Whether the file stops before its last box does: a copy that didn't finish. libheif opens
// one anyway, with the missing tiles of a phone photo's grid filled in green, and that green
// would be sent to be read as part of the tunnel.
async function cutShort(file: Blob): Promise<boolean> {
  let at = 0
  while (at + 8 <= file.size) {
    const head = new DataView(await file.slice(at, at + 16).arrayBuffer())
    let size = head.getUint32(0)
    if (size === 1 && head.byteLength >= 16) size = Number(head.getBigUint64(8))
    // 0: the last box, to the end of the file.
    if (size === 0) return false
    if (size < 8) return true
    at += size
  }
  return at > file.size
}

// How much of the photo is one flat, pure green. libheif doesn't fail on a file whose
// picture data is damaged but still full length (a cloud copy that never finished
// downloading, a broken import off the phone): every tile it can't read comes out as YCbCr
// zero, a flat green (0,136,0 for an iPhone's colours), with no error. Real photos have no
// flat pure-green patch anywhere near this size: across 36 real phone and test HEICs none
// had any, against 0.42 for an iPhone photo half zeroed. A shrunk copy is enough to
// see it, and quick. Without OffscreenCanvas (none in a worker) the photo goes as it is.
function flatGreen(bitmap: ImageBitmap): number {
  if (typeof OffscreenCanvas !== 'function') return 0
  const k = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * k))
  const h = Math.max(1, Math.round(bitmap.height * k))
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  ctx.drawImage(bitmap, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  // By green level, since the fill's exact green depends on the file's colour matrix.
  const count = new Uint32Array(258)
  for (let o = 0; o < d.length; o += 4) {
    if (d[o] <= 4 && d[o + 2] <= 4 && d[o + 1] >= 60 && d[o + 1] <= 200) count[d[o + 1] + 1]++
  }
  let most = 0
  for (let g = 1; g < 257; g++) most = Math.max(most, count[g - 1] + count[g] + count[g + 1])
  return most / (w * h)
}
// One 512 px tile of an iPhone photo's 48 is 2% of it.
const GREEN_LIMIT = 0.005

self.onmessage = async (e: MessageEvent<HeicAsk>) => {
  const { id, file } = e.data
  try {
    if (await cutShort(file)) return self.postMessage({ id, error: 'bad', detail: 'cut short' } satisfies HeicReply)
    // libheif applies the file's turn and mirror (irot, imir) and crop as it decodes, so the
    // bitmap is upright, and the primary image is the one decoded (not a thumbnail, depth or
    // gain map).
    const bitmap = await heicTo({ blob: file, type: 'bitmap' })
    if (flatGreen(bitmap) > GREEN_LIMIT) {
      bitmap.close()
      return self.postMessage({ id, error: 'bad', detail: 'unreadable tiles' } satisfies HeicReply)
    }
    self.postMessage({ id, bitmap } satisfies HeicReply, { transfer: [bitmap] })
  } catch (err) {
    // heic-to passes libheif's failures on as a string; its worker failing to start gives
    // nothing.
    const detail = typeof err === 'string' ? err : err instanceof Error ? err.message : ''
    self.postMessage({ id, error: detail ? 'bad' : 'load', detail } satisfies HeicReply)
  }
}
