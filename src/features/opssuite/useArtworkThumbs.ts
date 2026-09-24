import { useEffect, useState } from 'react'
import { signage } from '@/lib/queries/signage'
import { renderPdfThumb } from '@/lib/pdfThumb'

// Loads gallery thumbnails for a set of artwork paths. Prefers the pre-generated
// static JPG (`<path>.jpg`), which loads instantly; only for artwork missing a
// thumbnail does it fall back to rendering the PDF's first page (the old, slow
// path). Returns a map of artwork path -> displayable image URL.
export function useArtworkThumbs(paths: string[]): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const key = paths.join('|')

  useEffect(() => {
    if (!paths.length) return
    let alive = true
    void (async () => {
      const jpg = await signage.thumbUrls(paths)
      if (!alive) return
      if (Object.keys(jpg).length) setThumbs((prev) => ({ ...prev, ...jpg }))
      // Render only the ones without a static thumbnail.
      const missing = paths.filter((p) => !jpg[p])
      if (!missing.length) return
      const pdfUrls = await signage.artworkUrls(missing)
      for (const p of missing) {
        if (!alive) return
        const url = pdfUrls[p]
        if (!url) continue
        const img = await renderPdfThumb(url, p)
        if (alive && img) setThumbs((prev) => (prev[p] ? prev : { ...prev, [p]: img }))
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return thumbs
}
