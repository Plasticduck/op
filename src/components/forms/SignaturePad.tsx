import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser } from 'lucide-react'

// Finger or stylus signature on a phone (mouse works too). Ink is drawn in the
// current text color so it reads in light and dark mode; toBlob() exports it
// as black on white for the record.

export type SignaturePadHandle = {
  isEmpty: () => boolean
  clear: () => void
  toBlob: () => Promise<Blob | null>
}

export const SignaturePad = forwardRef<SignaturePadHandle, { label?: string }>(function SignaturePad(
  { label = 'Sign here' },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Array<Array<[number, number]>>>([])
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  const redraw = useCallback(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.strokeStyle = getComputedStyle(c).color
    ctx.lineWidth = 2.2 * (window.devicePixelRatio || 1)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokes.current) {
      ctx.beginPath()
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
  }, [])

  // Match the canvas to its on-screen size (sharp on high-DPI screens).
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      c.width = Math.round(c.clientWidth * dpr)
      c.height = Math.round(c.clientHeight * dpr)
      redraw()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(c)
    return () => ro.disconnect()
  }, [redraw])

  const point = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => strokes.current.length === 0,
    clear: () => {
      strokes.current = []
      setEmpty(true)
      redraw()
    },
    toBlob: async () => {
      const c = canvas.current
      if (!c || !strokes.current.length) return null
      const out = document.createElement('canvas')
      out.width = c.width
      out.height = c.height
      const ctx = out.getContext('2d')
      if (!ctx) return null
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 2.2 * (window.devicePixelRatio || 1)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const s of strokes.current) {
        ctx.beginPath()
        s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
      }
      return await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
    },
  }), [redraw])

  return (
    <div className="relative">
      <canvas
        ref={canvas}
        aria-label={label}
        className="block h-32 w-full touch-none rounded-md border border-border bg-card text-ink"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          strokes.current.push([point(e)])
          setEmpty(false)
          redraw()
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          strokes.current[strokes.current.length - 1].push(point(e))
          redraw()
        }}
        onPointerUp={() => { drawing.current = false }}
        onPointerCancel={() => { drawing.current = false }}
      />
      {empty ? (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-ink-subtle">{label}</span>
      ) : (
        <button type="button" aria-label="Clear signature"
          onClick={() => { strokes.current = []; setEmpty(true); redraw() }}
          className="absolute right-2 top-2 grid size-8 place-items-center rounded-md text-ink-muted hover:bg-content">
          <Eraser className="size-4" />
        </button>
      )}
    </div>
  )
})
