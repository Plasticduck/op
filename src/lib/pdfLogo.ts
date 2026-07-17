type JsPdf = import('jspdf').jsPDF

export type PdfLogo = { dataUrl: string; w: number; h: number }

// Load a brand logo into a data URL so jsPDF can embed it. Same-origin (public/)
// so the canvas is not tainted. Returns null on any failure so an export never
// breaks over a missing logo.
export async function loadPdfLogo(url?: string | null): Promise<PdfLogo | null> {
  if (!url) return null
  try {
    return await new Promise<PdfLogo>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('no canvas context'))
          ctx.drawImage(img, 0, 0)
          resolve({ dataUrl: canvas.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight })
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('logo load failed'))
      img.src = url
    })
  } catch {
    return null
  }
}

// Place the logo in the top-right corner, preserving aspect ratio.
export function placePdfLogo(
  doc: JsPdf,
  logo: PdfLogo | null,
  opts?: { width?: number; margin?: number; y?: number },
) {
  if (!logo) return
  const width = opts?.width ?? 42
  const margin = opts?.margin ?? 14
  const y = opts?.y ?? 8
  const height = width * (logo.h / logo.w)
  const pageW = doc.internal.pageSize.getWidth()
  doc.addImage(logo.dataUrl, 'PNG', pageW - margin - width, y, width, height)
}
