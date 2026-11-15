import { useEffect, type RefObject } from 'react'
import type { CameraPreset } from '../types'
import type { NudgeSize } from './machines'

// The 3D view's keys: M move mode, Space play / pause, R ride, 1 2 3 the camera presets,
// Escape backs out, Left / Right nudge a machine while arranging. They are the view's
// while focus is inside it, or while the pointer rests on it (or it fills the screen) and
// nothing else on the page has focus. Never while someone is typing, and never with Ctrl
// or Cmd (the browser's and the page's own shortcuts).

export type KeyActions = {
  expanded: boolean
  // Left / Right while arranging. False when there is nothing that can move.
  nudgeKey: (dir: -1 | 1, size: NudgeSize) => boolean
  // Back out one step. False when there was nothing to back out of.
  escape: () => boolean
  togglePlay: () => void
  toggleMove: () => void
  toggleRide: () => void
  toPreset: (p: CameraPreset) => void
  // A machine is in someone's hand, or was put down a moment ago: the scene takes Escape
  // then (it puts the machine back), and that press is spent.
  dragging: () => boolean
}

// `actions` is read at each key press, so the one listener always sees the latest props.
export function useViewKeys(root: RefObject<HTMLElement | null>, actions: RefObject<KeyActions | null>) {
  useEffect(() => {
    const box = root.current
    if (!box) return
    let over = false
    const onEnter = () => { over = true }
    const onLeave = () => { over = false }

    const onKey = (e: KeyboardEvent) => {
      const c = actions.current
      if (!c || e.defaultPrevented || e.ctrlKey || e.metaKey) return
      const t = e.target instanceof HTMLElement ? e.target : null
      const inside = !!t && box.contains(t)
      const idle = !t || t === document.body || t === document.documentElement
      if (!inside && !((over || c.expanded) && idle)) return
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return

      const along = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (along) {
        if (c.nudgeKey(along, e.altKey ? 'fine' : e.shiftKey ? 'big' : 'step')) e.preventDefault()
        return
      }
      if (e.altKey) return
      if (e.key === 'Escape') {
        if (c.dragging()) return
        if (c.escape()) e.preventDefault()
        return
      }
      if (e.key === ' ') {
        // On a button or a link Space presses it.
        if (t && /^(BUTTON|A)$/.test(t.tagName)) return
        e.preventDefault()
        if (!e.repeat) c.togglePlay()
        return
      }
      if (e.shiftKey || e.repeat) return
      const k = e.key.toLowerCase()
      if (k === 'm') c.toggleMove()
      else if (k === 'r') c.toggleRide()
      else if (k === '1') c.toPreset('overview')
      else if (k === '2') c.toPreset('entrance')
      else if (k === '3') c.toPreset('top')
      else return
      e.preventDefault()
    }

    box.addEventListener('pointerenter', onEnter)
    box.addEventListener('pointerleave', onLeave)
    window.addEventListener('keydown', onKey)
    return () => {
      box.removeEventListener('pointerenter', onEnter)
      box.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
    }
  }, [root, actions])
}
