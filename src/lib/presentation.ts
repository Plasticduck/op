import { useEffect, useState } from 'react'

// App-wide presentation mode: a full-screen, TV-legible view of a site or
// region's live numbers. Modeled on lib/theme.ts (a module-level flag broadcast
// over a window event) so any component can read or flip it. Not persisted: a
// reload should drop back to the normal app.
let active = false
const EVENT = 'wl:presentationchange'

export function isPresenting(): boolean {
  return active
}

export function setPresenting(v: boolean): void {
  if (active === v) return
  active = v
  // Lock background scroll while the overlay is up.
  document.documentElement.classList.toggle('overflow-hidden', v)
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function togglePresenting(): void {
  setPresenting(!active)
}

export function usePresentationMode(): { active: boolean; toggle: () => void; exit: () => void } {
  const [state, setState] = useState(active)
  useEffect(() => {
    const h = () => setState(active)
    window.addEventListener(EVENT, h)
    return () => window.removeEventListener(EVENT, h)
  }, [])
  return { active: state, toggle: togglePresenting, exit: () => setPresenting(false) }
}
