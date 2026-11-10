import L from 'leaflet'

// A small heat-map layer for Leaflet: soft blobs drawn on a canvas, added up,
// then coloured on a gradient (the technique simpleheat / leaflet.heat use).
// Written here rather than adding a package. Points are [lat, lng, weight 0..1].

export type HeatPoint = [number, number, number]
type Opts = { radius?: number; blur?: number; pane?: string; opacity?: number }

const GRADIENT: [number, string][] = [[0.15, '#2563eb'], [0.4, '#06b6d4'], [0.6, '#84cc16'], [0.8, '#f59e0b'], [1, '#dc2626']]

function palette(): Uint8ClampedArray {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  for (const [stop, color] of GRADIENT) g.addColorStop(stop, color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1, 256)
  return ctx.getImageData(0, 0, 1, 256).data
}

function stamp(r: number, blur: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const full = r + blur
  c.width = c.height = full * 2
  const ctx = c.getContext('2d')!
  ctx.shadowOffsetX = ctx.shadowOffsetY = full * 2
  ctx.shadowBlur = blur
  ctx.shadowColor = 'black'
  ctx.beginPath()
  ctx.arc(-full, -full, r, 0, Math.PI * 2, true)
  ctx.closePath()
  ctx.fill()
  return c
}

export class HeatLayer extends L.Layer {
  private points: HeatPoint[] = []
  private canvas: HTMLCanvasElement | null = null
  private grad: Uint8ClampedArray | null = null
  private blob: HTMLCanvasElement | null = null
  private o: Required<Pick<Opts, 'radius' | 'blur' | 'opacity'>> & { pane: string }

  constructor(opts: Opts = {}) {
    super()
    this.o = { radius: opts.radius ?? 16, blur: opts.blur ?? 14, opacity: opts.opacity ?? 0.75, pane: opts.pane ?? 'overlayPane' }
  }

  setPoints(points: HeatPoint[]): this {
    this.points = points
    this.redraw()
    return this
  }

  onAdd(map: L.Map): this {
    this.canvas = L.DomUtil.create('canvas', 'leaflet-layer') as HTMLCanvasElement
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.opacity = String(this.o.opacity)
    map.getPane(this.o.pane)!.appendChild(this.canvas)
    map.on('moveend resize zoomend', this.redraw, this)
    map.on('zoomstart', this.hide, this)
    this.redraw()
    return this
  }

  onRemove(map: L.Map): this {
    map.off('moveend resize zoomend', this.redraw, this)
    map.off('zoomstart', this.hide, this)
    this.canvas?.remove()
    this.canvas = null
    return this
  }

  private hide() {
    if (this.canvas) this.canvas.style.visibility = 'hidden'
  }

  redraw() {
    const map = (this as unknown as { _map?: L.Map })._map
    const canvas = this.canvas
    if (!map || !canvas) return
    const size = map.getSize()
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
    canvas.width = size.x
    canvas.height = size.y
    canvas.style.visibility = 'visible'
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx || !this.points.length) return
    this.grad ??= palette()
    // Bigger blobs when zoomed in, so a town still reads as one patch.
    const z = map.getZoom()
    const k = Math.max(0.9, Math.min(2.4, (z - 3) / 3))
    const r = Math.round(this.o.radius * k)
    const blur = Math.round(this.o.blur * k)
    this.blob = stamp(r, blur)
    const full = r + blur
    const bounds = map.getBounds().pad(0.15)
    for (const [lat, lng, w] of this.points) {
      if (w <= 0 || !bounds.contains([lat, lng])) continue
      const p = map.latLngToContainerPoint([lat, lng])
      ctx.globalAlpha = Math.min(1, Math.max(0.05, w * 0.45))
      ctx.drawImage(this.blob, p.x - full, p.y - full)
    }
    const img = ctx.getImageData(0, 0, size.x, size.y)
    const px = img.data
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3]
      if (a < 4) { px[i + 3] = 0; continue }
      const j = a * 4
      px[i] = this.grad[j]
      px[i + 1] = this.grad[j + 1]
      px[i + 2] = this.grad[j + 2]
      px[i + 3] = Math.min(255, 50 + a * 1.6)
    }
    ctx.putImageData(img, 0, 0)
  }
}
