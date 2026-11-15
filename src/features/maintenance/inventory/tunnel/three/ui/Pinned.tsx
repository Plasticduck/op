import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { TunnelSceneApi } from '../types'

// Something that follows a machine around the canvas: a name chip above it, a ring at its
// feet. The scene moves the outer element itself, every frame it draws (scene.pin), so
// React is never asked to. The inner element is ours: it sits above, below or on the
// point, is nudged back inside the canvas when the machine is near an edge, and steps
// out from under the controls that float over the canvas.
//
// Must be rendered inside a box that covers the canvas exactly (the scene's numbers are
// pixels from the canvas's top left corner).

type Props = {
  scene: TunnelSceneApi | null
  id: string | null
  at: 'top' | 'base'
  // Where the content sits relative to the point.
  place?: 'above' | 'below' | 'center'
  // Pixels between the point and the content.
  gap?: number
  // Keep the content inside the canvas and clear of the controls (a ring stays on its
  // machine instead).
  contain?: boolean
  // Changes whenever a control over the canvas appears, opens or closes: the controls are
  // measured again (they are not watched frame by frame).
  controls?: string
  // Told once each time it is put on a machine, when the scene has placed it: whether
  // that machine is out of view.
  onPlaced?: (offscreen: boolean) => void
  className?: string
  children: ReactNode
}

const EDGE = 6
const XY = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/
// Controls over the canvas mark themselves with this, under the view's root.
const KEEP_OUT = '[data-t3d-keepout]'
const ROOT = '[data-t3d="root"]'

type Box = { left: number; top: number; right: number; bottom: number }

export function Pinned({ scene, id, at, place = 'above', gap = 10, contain = true, controls, onPlaced, className, children }: Props) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  // Just put on a machine and not placed by the scene yet.
  const fresh = useRef(false)
  const placed = useRef(onPlaced)
  useEffect(() => { placed.current = onPlaced })

  useEffect(() => {
    const el = outer.current
    if (!scene || !el || !id) return
    // Out of sight until the scene has put it on its new machine, or it would show for a
    // frame where the last one stood.
    el.dataset.offscreen = 'true'
    fresh.current = true
    scene.pin(el, id, at)
    return () => scene.pin(el, null)
  }, [scene, id, at])

  useEffect(() => {
    const el = outer.current
    const box = inner.current
    if (!el || !box) return
    // Where the controls are, in the canvas's own pixels. Measured when this is put on a
    // machine and when sizes change, never per frame.
    let keep: Box[] = []
    // Watches this content and the canvas (below), and the controls themselves as they
    // are found: the page's bar grows and shrinks with its text, the card wraps. Each
    // control once, as observing it again would report it again.
    const ro = new ResizeObserver(() => {
      measure()
      fit()
    })
    const watched = new Set<Element>()
    const measure = () => {
      keep = []
      const host = el.offsetParent
      if (!host || !contain) return
      const o = host.getBoundingClientRect()
      for (const k of el.closest(ROOT)?.querySelectorAll(KEEP_OUT) ?? []) {
        if (!watched.has(k)) {
          watched.add(k)
          ro.observe(k)
        }
        const r = k.getBoundingClientRect()
        if (r.width && r.height) keep.push({ left: r.left - o.left, top: r.top - o.top, right: r.right - o.left, bottom: r.bottom - o.top })
      }
    }
    const fit = () => {
      const m = XY.exec(el.style.transform)
      const host = el.offsetParent
      const w = box.offsetWidth
      const h = box.offsetHeight
      let dx = -w / 2
      let dy = place === 'above' ? -h - gap : place === 'below' ? gap : -h / 2
      if (m && host && contain) {
        const x = Number(m[1])
        const y = Number(m[2])
        const maxLeft = Math.max(EDGE, host.clientWidth - w - EDGE)
        const maxTop = Math.max(EDGE, host.clientHeight - h - EDGE)
        let left = Math.min(Math.max(x + dx, EDGE), maxLeft)
        let top = Math.min(Math.max(y + dy, EDGE), maxTop)
        const under = (l: number, t: number) => keep.some((k) => l < k.right && l + w > k.left && t < k.bottom && t + h > k.top)
        if (under(left, top)) {
          // Under a control: go to the nearest spot inside the canvas that is clear of them
          // all, lined up with their edges: beside, above or below one, or both at once
          // (right of the card and below the page's bar, on a crowded canvas). The toolbar
          // in the top right corner sends it left or down, the card in the bottom left
          // corner up or right.
          const xs = [left, EDGE, maxLeft]
          const ys = [top, EDGE, maxTop]
          for (const k of keep) {
            xs.push(k.left - EDGE - w, k.right + EDGE)
            ys.push(k.top - EDGE - h, k.bottom + EDGE)
          }
          let best: readonly [number, number] | null = null
          let cost = Infinity
          for (const l of xs) {
            if (l < EDGE || l > maxLeft) continue
            for (const t of ys) {
              const d = Math.abs(l - left) + Math.abs(t - top)
              if (d < cost && t >= EDGE && t <= maxTop && !under(l, t)) {
                best = [l, t]
                cost = d
              }
            }
          }
          if (best) [left, top] = best
          // No such spot (a small canvas, crowded): step down past each one in turn.
          else {
            for (const k of keep) {
              if (left < k.right && left + w > k.left && top < k.bottom && top + h > k.top) top = Math.min(k.bottom + EDGE, maxTop)
            }
          }
        }
        dx = left - x
        dy = top - y
      }
      box.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`
    }
    const follow = () => {
      if (fresh.current) measure()
      fit()
      if (!fresh.current) return
      fresh.current = false
      placed.current?.(el.dataset.offscreen === 'true')
    }
    // The scene writes the outer element's transform when it draws a frame: follow it.
    // Nothing fires while the scene is still.
    const mo = new MutationObserver(follow)
    mo.observe(el, { attributes: true, attributeFilter: ['style'] })
    // The content can change size without the machine moving (another machine's name),
    // and the canvas can change size under it.
    ro.observe(box)
    if (el.offsetParent) ro.observe(el.offsetParent)
    measure()
    fit()
    return () => {
      mo.disconnect()
      ro.disconnect()
    }
  }, [place, gap, contain, controls])

  return (
    <div ref={outer} data-offscreen="true" className="absolute left-0 top-0 will-change-transform data-[offscreen=true]:invisible">
      <div ref={inner} className={cn('absolute left-0 top-0', className)}>{children}</div>
    </div>
  )
}
