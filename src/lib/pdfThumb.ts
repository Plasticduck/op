// Render the first page of a PDF (by URL) to a PNG data URL, so we can show a
// real thumbnail that fits the whole page. pdf.js is heavy, so it (and its
// worker) load on demand as their own chunk the first time a thumbnail renders.

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })()
  }
  return pdfjsPromise
}

// Draw one page of an in-memory PDF onto a canvas at `cssWidth` CSS pixels
// wide (sharp on high-DPI screens). Used for live previews of generated PDFs,
// so what's on screen is the exact file that prints.
export async function renderPdfDataToCanvas(
  data: ArrayBuffer,
  canvas: HTMLCanvasElement,
  opts: { page?: number; cssWidth: number },
): Promise<{ pages: number } | null> {
  try {
    const pdfjs = await loadPdfjs()
    // pdf.js takes ownership of the buffer it's given; hand it a copy.
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise
    const page = await doc.getPage(Math.min(opts.page ?? 1, doc.numPages))
    const base = page.getViewport({ scale: 1 })
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const viewport = page.getViewport({ scale: (opts.cssWidth / base.width) * dpr })
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    canvas.style.width = `${opts.cssWidth}px`
    canvas.style.height = `${Math.round(viewport.height / dpr)}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) { void doc.destroy(); return null }
    await page.render({ canvasContext: ctx, viewport, background: 'white' }).promise
    const pages = doc.numPages
    void doc.destroy()
    return { pages }
  } catch {
    return null
  }
}

// Cache by URL's path so thumbnails survive re-renders and re-visits. Keyed on
// the storage path (signed URLs change), passed in as `cacheKey`.
const cache = new Map<string, string>()

// Render the first PDF page to a JPEG blob, for storing a static thumbnail
// (`<path>.jpg`) so galleries can load an image instead of rendering the PDF.
export async function renderPdfToJpegBlob(url: string, maxWidth = 600): Promise<Blob | null> {
  try {
    const pdfjs = await loadPdfjs()
    const doc = await pdfjs.getDocument({ url }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2, maxWidth / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) { void doc.destroy(); return null }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, background: 'white' }).promise
    void doc.destroy()
    return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.82))
  } catch {
    return null
  }
}

export async function renderPdfThumb(url: string, cacheKey: string, maxWidth = 480): Promise<string | null> {
  const hit = cache.get(cacheKey)
  if (hit) return hit
  try {
    const pdfjs = await loadPdfjs()
    const doc = await pdfjs.getDocument({ url }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2, maxWidth / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) { doc.destroy(); return null }
    await page.render({ canvasContext: ctx, viewport, background: 'white' }).promise
    const dataUrl = canvas.toDataURL('image/png')
    void doc.destroy()
    cache.set(cacheKey, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}
