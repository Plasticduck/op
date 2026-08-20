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

// Cache by URL's path so thumbnails survive re-renders and re-visits. Keyed on
// the storage path (signed URLs change), passed in as `cacheKey`.
const cache = new Map<string, string>()

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
