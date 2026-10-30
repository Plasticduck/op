// A barcode detector for QR and Code 128, made on first use. Uses the
// browser's own BarcodeDetector where it reads both formats (Android Chrome),
// otherwise zxing-wasm (iOS Safari, desktop): the same engine the sticker scan
// test (scripts/test-label-scans.mjs) decodes with. It loads only when a
// scanner opens, and its wasm file is served from our own origin, from the same
// package as its JS glue so the two can never drift apart.

export type DetectedCode = { rawValue: string; format: string }
export type Detector = { detect(source: HTMLVideoElement): Promise<DetectedCode[]> }

const NATIVE_FORMATS = ['qr_code', 'code_128']
// Frames are scaled to this width before decoding: plenty for a sticker
// filling the viewfinder, and keeps each read fast on older phones.
const MAX_WIDTH = 960

let detector: Promise<Detector> | null = null

type NativeCtor = {
  new (opts: { formats: string[] }): { detect(source: CanvasImageSource): Promise<DetectedCode[]> }
  getSupportedFormats?: () => Promise<string[]>
}

async function nativeDetector(): Promise<Detector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeCtor }).BarcodeDetector
  if (!Native?.getSupportedFormats) return null
  try {
    const supported = await Native.getSupportedFormats()
    if (!NATIVE_FORMATS.every((f) => supported.includes(f))) return null
    const d = new Native({ formats: NATIVE_FORMATS })
    return { detect: (v) => d.detect(v) }
  } catch {
    return null
  }
}

async function zxingDetector(): Promise<Detector> {
  const [{ readBarcodes, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('No canvas')
  return {
    detect: async (v) => {
      const scale = Math.min(1, MAX_WIDTH / v.videoWidth)
      canvas.width = Math.round(v.videoWidth * scale)
      canvas.height = Math.round(v.videoHeight * scale)
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      const found = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
        formats: ['QRCode', 'Code128'],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      })
      return found.filter((r) => r.isValid && r.text).map((r) => ({ rawValue: r.text, format: r.format }))
    },
  }
}

export function getDetector(): Promise<Detector> {
  if (!detector) {
    detector = (async () => (await nativeDetector()) ?? (await zxingDetector()))().catch((e) => {
      detector = null // let the next scanner try again
      throw e
    })
  }
  return detector
}
