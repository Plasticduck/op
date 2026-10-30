import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { renderPdfDataToCanvas } from '@/lib/pdfThumb'
import { cn } from '@/lib/utils'

// Live preview of a generated PDF page. It renders the very bytes that will be
// saved and printed (through pdf.js), so the preview can't drift from the
// output. Renders are queued because pdf.js can't draw twice on one canvas.
export function PdfPagePreview({
  data,
  page = 1,
  maxWidth = 360,
  className,
}: {
  data: ArrayBuffer | null
  page?: number
  maxWidth?: number
  className?: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    if (!data) return
    let alive = true
    setBusy(true)
    queue.current = queue.current.then(async () => {
      if (!alive || !canvas.current || !wrap.current) return
      const width = Math.min(maxWidth, wrap.current.clientWidth || maxWidth)
      await renderPdfDataToCanvas(data, canvas.current, { page, cssWidth: width })
      if (alive) setBusy(false)
    })
    return () => {
      alive = false
    }
  }, [data, page, maxWidth])

  return (
    <div ref={wrap} className={cn('relative w-full', className)}>
      <canvas ref={canvas} className="mx-auto block rounded-sm border border-border-strong bg-white" />
      {busy && (
        <div className="absolute inset-0 grid place-items-center text-ink-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
    </div>
  )
}
