import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, Type, BookmarkCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

// Adopt a signature: draw it with a finger, stylus or mouse, or type a name and
// see it in a signature style. Either way the result is a PNG, so what the signer
// sees is exactly what goes on the record.
export type PadValue = { kind: 'drawn' | 'typed'; image: string } | null

const INK = '#0b1f4d'
const FONT = 'OperatorSignature'
let fontReady: Promise<void> | null = null

function loadFont(): Promise<void> {
  if (!fontReady) {
    fontReady = (async () => {
      try {
        const face = new FontFace(FONT, 'url(/fonts/esign/DancingScript.ttf)', { weight: '400 700' })
        await face.load()
        document.fonts.add(face)
      } catch { /* falls back to the browser's cursive font */ }
    })()
  }
  return fontReady
}

type Pt = { x: number; y: number }

export function SignaturePad({ name, onChange, saved }: {
  name: string
  onChange: (v: PadValue) => void
  saved?: { kind: 'drawn' | 'typed'; image: string } | null
}) {
  const [mode, setMode] = useState<'draw' | 'type' | 'saved'>(saved ? 'saved' : 'draw')
  const strokes = useRef<Pt[][]>([])
  const [inked, setInked] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const typedRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  const redraw = useCallback(() => {
    const c = canvasRef.current
    const wrap = wrapRef.current
    if (!c || !wrap) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const w = wrap.clientWidth
    const h = 170
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    paint(g, strokes.current, 0, 0)
  }, [])

  useEffect(() => {
    if (mode !== 'draw') return
    redraw()
    const ro = new ResizeObserver(() => redraw())
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [mode, redraw])

  const exportDrawn = useCallback(() => {
    const all = strokes.current.flat()
    const length = strokes.current.reduce((s, st) => s + st.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - st[i].x, p.y - st[i].y), 0), 0)
    if (!all.length || length < 40) { onChange(null); return }
    const pad = 8
    const minX = Math.min(...all.map((p) => p.x)) - pad
    const minY = Math.min(...all.map((p) => p.y)) - pad
    const w = Math.max(...all.map((p) => p.x)) - minX + pad
    const h = Math.max(...all.map((p) => p.y)) - minY + pad
    const scale = Math.min(2, 1200 / w, 400 / h)
    const out = document.createElement('canvas')
    out.width = Math.ceil(w * scale)
    out.height = Math.ceil(h * scale)
    const g = out.getContext('2d')!
    g.setTransform(scale, 0, 0, scale, 0, 0)
    paint(g, strokes.current, minX, minY)
    onChange({ kind: 'drawn', image: out.toDataURL('image/png') })
  }, [onChange])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    strokes.current.push([pos(e)])
    redraw()
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    e.preventDefault()
    const st = strokes.current[strokes.current.length - 1]
    const p = pos(e)
    const last = st[st.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return
    st.push(p)
    redraw()
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    setInked(strokes.current.length > 0)
    exportDrawn()
  }
  const clear = () => {
    strokes.current = []
    setInked(false)
    redraw()
    onChange(null)
  }

  // Typed: render the name in the signature style whenever it or the mode changes.
  useEffect(() => {
    if (mode !== 'type') return
    let live = true
    void loadFont().then(() => {
      if (!live) return
      const text = name.trim()
      const c = typedRef.current
      if (!c) return
      const size = 64
      const font = `600 ${size}px ${FONT}, "Segoe Script", "Brush Script MT", cursive`
      const g0 = c.getContext('2d')!
      g0.font = font
      const tw = Math.max(40, g0.measureText(text || ' ').width)
      const scale = 2
      c.width = Math.ceil((tw + 32) * scale)
      c.height = Math.ceil(size * 1.6 * scale)
      const g = c.getContext('2d')!
      g.setTransform(scale, 0, 0, scale, 0, 0)
      g.clearRect(0, 0, c.width, c.height)
      g.font = font
      g.fillStyle = INK
      g.textBaseline = 'alphabetic'
      g.fillText(text, 16, size * 1.1)
      onChange(text.length >= 2 ? { kind: 'typed', image: c.toDataURL('image/png') } : null)
    })
    return () => { live = false }
  }, [mode, name, onChange])

  useEffect(() => {
    if (mode === 'saved' && saved) onChange(saved)
    if (mode === 'draw') exportDrawn()
  }, [mode, saved, onChange, exportDrawn])

  const tab = (key: typeof mode, label: string, Icon: typeof PenLine) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === key}
      onClick={() => setMode(key)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
        mode === key ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
      )}
    >
      <Icon className="size-4" /> {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label="How to sign" className="inline-flex w-fit gap-1 rounded-lg bg-content p-1">
        {saved && tab('saved', 'Saved', BookmarkCheck)}
        {tab('draw', 'Draw', PenLine)}
        {tab('type', 'Type', Type)}
      </div>

      {mode === 'draw' && (
        <div ref={wrapRef} className="relative rounded-md border border-border bg-white">
          <canvas
            ref={canvasRef}
            aria-label="Draw your signature here"
            data-testid="signature-canvas"
            className="block h-[170px] w-full cursor-crosshair touch-none select-none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
          <div className="pointer-events-none absolute inset-x-6 bottom-9 flex items-end gap-2 text-slate-400">
            <span className="text-lg leading-none">×</span>
            <span className="h-px flex-1 bg-slate-300" />
          </div>
          {!inked && (
            <span className="pointer-events-none absolute inset-x-0 top-5 text-center text-sm text-slate-400">Sign here with your finger, stylus or mouse</span>
          )}
          {inked && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Eraser className="size-3.5" /> Clear
            </button>
          )}
        </div>
      )}

      {mode === 'type' && (
        <div className="flex min-h-[120px] items-center overflow-x-auto rounded-md border border-border bg-white px-2">
          <canvas ref={typedRef} aria-label="Your typed signature" className="h-[86px] max-w-none" style={{ height: 86 }} />
          {name.trim().length < 2 && <span className="text-sm text-slate-400">Type your full name above to see your signature.</span>}
        </div>
      )}

      {mode === 'saved' && saved && (
        <div className="flex min-h-[120px] items-center justify-center rounded-md border border-border bg-white p-3">
          <img src={saved.image} alt="Your saved signature" className="max-h-[96px] max-w-full" />
        </div>
      )}
    </div>
  )
}

function paint(g: CanvasRenderingContext2D, strokes: Pt[][], ox: number, oy: number) {
  g.strokeStyle = INK
  g.fillStyle = INK
  g.lineWidth = 2.4
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const st of strokes) {
    if (st.length === 1) {
      g.beginPath()
      g.arc(st[0].x - ox, st[0].y - oy, 1.3, 0, Math.PI * 2)
      g.fill()
      continue
    }
    g.beginPath()
    g.moveTo(st[0].x - ox, st[0].y - oy)
    for (let i = 1; i < st.length - 1; i++) {
      const mx = (st[i].x + st[i + 1].x) / 2
      const my = (st[i].y + st[i + 1].y) / 2
      g.quadraticCurveTo(st[i].x - ox, st[i].y - oy, mx - ox, my - oy)
    }
    const last = st[st.length - 1]
    g.lineTo(last.x - ox, last.y - oy)
    g.stroke()
  }
}
