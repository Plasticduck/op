import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { clickSlop } from '../interactionMath'
import type { Inset, TunnelSceneApi } from '../types'
import { readStore, writeStore } from './env'

// Small things the view does around the canvas, kept out of the way of the main
// component: a passing message, the wheel hint, hiding the name chip while the camera is
// dragged, making room for the phone sheet, and telling the scene what the controls cover.

// A short message in the middle of the canvas that goes away by itself. busy() says
// whether one is showing.
export function useFlash(ms: number) {
  const [text, setText] = useState<string | null>(null)
  const timer = useRef(0)
  const flash = useCallback((next: string) => {
    setText(next)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = 0
      setText(null)
    }, ms)
  }, [ms])
  const busy = useCallback(() => timer.current !== 0, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { text, flash, busy }
}

const HINT_KEY = 'mi.tunnel.wheelhint'
// Without session storage the hint is still shown only twice per page load.
let hintsShown = 0

// The scene says so ('t3d:wheel-passed' from its box, bubbling) when a plain wheel
// scrolled the page past a canvas that hasn't been clicked: say how to zoom, at most
// twice per browser session.
export function useWheelHint(root: RefObject<HTMLElement | null>, flash: (text: string) => void, busy: () => boolean) {
  useEffect(() => {
    const box = root.current
    if (!box) return
    const onPassed = () => {
      if (busy()) return
      const shown = Math.max(hintsShown, Number(readStore('session', HINT_KEY) ?? 0) || 0)
      if (shown >= 2) return
      hintsShown = shown + 1
      writeStore('session', HINT_KEY, String(hintsShown))
      flash('Click the tunnel, then scroll to zoom')
    }
    box.addEventListener('t3d:wheel-passed', onPassed)
    return () => box.removeEventListener('t3d:wheel-passed', onPassed)
  }, [root, flash, busy])
}

// While the camera or a machine is being dragged the name chip would only be in the way.
// A press on the canvas that travels further than the scene allows a click (more for a
// finger than a mouse) sets data-dragging on the view's root until it ends, and CSS hides
// the chip, so no render is needed. The press is watched from a capturing listener above
// the canvas, because the scene may keep it.
export function useDragFlag(root: RefObject<HTMLElement | null>, stage: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const box = root.current
    const canvasBox = stage.current
    if (!box || !canvasBox) return
    let from: { x: number; y: number; id: number; slop: number } | null = null
    const onMove = (e: PointerEvent) => {
      if (from && e.pointerId === from.id && Math.hypot(e.clientX - from.x, e.clientY - from.y) > from.slop) box.dataset.dragging = 'true'
    }
    const stop = () => {
      from = null
      delete box.dataset.dragging
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
    function onUp(e: PointerEvent) {
      if (!from || e.pointerId === from.id) stop()
    }
    const onDown = (e: PointerEvent) => {
      if (from || !(e.target instanceof Node) || !canvasBox.contains(e.target)) return
      from = { x: e.clientX, y: e.clientY, id: e.pointerId, slop: clickSlop(e.pointerType) }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    }
    box.addEventListener('pointerdown', onDown, true)
    return () => {
      box.removeEventListener('pointerdown', onDown, true)
      stop()
    }
  }, [root, stage])
}

// On a narrow canvas the machine card is a sheet over the bottom of the view, right where
// the scene has just framed the machine. Its height goes into --t3d-sheet on the root, and
// the scene's box ends at the sheet's top edge instead (narrow layout only), so the
// machine is framed in what can be seen. Set at once in a layout effect, so a view that
// opens on a selected machine makes its scene (a later, plain effect) in a box that is
// already the right height, and the first frame isn't refitted.
export function useSheetHeight(root: RefObject<HTMLElement | null>, sheet: RefObject<HTMLElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const box = root.current
    const el = sheet.current
    if (!box || !el || !on) return
    const fit = () => box.style.setProperty('--t3d-sheet', `${el.offsetHeight}px`)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => {
      ro.disconnect()
      box.style.removeProperty('--t3d-sheet')
    }
  }, [root, sheet, on])
}

// What the controls hide of the canvas, for the scene to frame the drawing in the rest
// (TunnelSceneApi.setInset), in whole CSS pixels. Only controls that hide the drawing
// count, each marked data-t3d-inset:
//   top     the toolbar's camera row: the rest of the toolbar shares its band, or on a
//           phone stands down the left edge, which the overview leaves free
//   bottom  the page's unsaved-moves bar and the showroom's note, wide boxes along the
//           bottom edge, where the top view and a phone's upright views reach. Each counts
//           only if it crosses the middle of what is left, where the picture is centered
//           (the bar standing on the docked card leaves that alone). The phone's sheet
//           counts here too, for the strip of it over the canvas: the canvas ends at its
//           top edge (useSheetHeight)
//   corner  the docked card, and the legend in the top view, whose rooms reach into the
//           bottom right corner. Each gives up its side or its height, whichever leaves
//           the larger free area: the card's width beside a wide canvas, its height under
//           a narrower one.
// Otherwise the legend is left out, as are the folded legend button and the phone's
// column of buttons: small boxes in corners the drawing mostly leaves alone, and framing
// around them would shrink every view for them.
export function insetOf(root: HTMLElement, canvas: HTMLElement): Inset {
  const c = canvas.getBoundingClientRect()
  const out = { top: 0, right: 0, bottom: 0, left: 0 }
  if (!c.width || !c.height) return out
  const lows: DOMRect[] = []
  const corners: DOMRect[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[data-t3d-inset]')) {
    const r = el.getBoundingClientRect()
    // Not shown (display: none) or not over the canvas.
    if (!r.width || !r.height || r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) continue
    const side = el.dataset.t3dInset
    if (side === 'top') out.top = Math.max(out.top, r.bottom - c.top)
    else if (side === 'corner' && r.width < c.width * 0.9) corners.push(r)
    else lows.push(r)
  }
  // Every way of giving the corners their side or their height (two corners at most).
  let most = -Infinity
  for (let mask = 0; mask < 1 << corners.length; mask++) {
    let left = 0
    let right = 0
    let bottom = 0
    corners.forEach((k, n) => {
      if (!(mask & (1 << n))) bottom = Math.max(bottom, c.bottom - k.top)
      else if (k.left + k.right < c.left + c.right) left = Math.max(left, k.right - c.left)
      else right = Math.max(right, c.right - k.left)
    })
    const mid = c.left + (left + c.width - right) / 2
    for (const r of lows) if (r.left < mid && r.right > mid) bottom = Math.max(bottom, c.bottom - r.top)
    const area = (c.width - left - right) * (c.height - out.top - bottom)
    if (area > most) {
      most = area
      Object.assign(out, { left, right, bottom })
    }
  }
  return { top: Math.round(out.top), right: Math.round(out.right), bottom: Math.round(out.bottom), left: Math.round(out.left) }
}

// Sends the scene what the controls cover now, unless it already has those numbers.
const sentTo = new WeakMap<TunnelSceneApi, string>()
export function sendInset(scene: TunnelSceneApi, root: HTMLElement, canvas: HTMLElement) {
  const i = insetOf(root, canvas)
  const key = `${i.top} ${i.right} ${i.bottom} ${i.left}`
  if (sentTo.get(scene) === key) return
  sentTo.set(scene, key)
  scene.setInset(i)
}

// Keeps the scene's inset up to date: measured again when the canvas or any marked
// control changes size, and when one appears or goes (layout changes then). The scene
// eases the picture over, so nothing jumps.
export function useInset(root: RefObject<HTMLElement | null>, canvas: RefObject<HTMLElement | null>, scene: TunnelSceneApi | null, layout: string) {
  useLayoutEffect(() => {
    const box = root.current
    const stage = canvas.current
    if (!scene || !box || !stage) return
    const publish = () => sendInset(scene, box, stage)
    const ro = new ResizeObserver(publish)
    ro.observe(stage)
    for (const el of box.querySelectorAll('[data-t3d-inset]')) ro.observe(el)
    publish()
    return () => ro.disconnect()
  }, [root, canvas, scene, layout])
}
