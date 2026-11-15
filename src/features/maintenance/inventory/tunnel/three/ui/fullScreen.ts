import { useEffect, type RefObject } from 'react'

// While the view fills the screen, nothing behind it may scroll or take focus. Locking
// the body is not enough: the app scrolls inside its own <main> (AppShell), and a key
// press or a focus change there would scroll the page under the view. So every box around
// the view that scrolls is held still, and everything beside the view's branch of the
// page (the sidebar, the top bar, the bottom bar, the page's own buttons) is made inert,
// which keeps Tab inside the view and hides the rest from screen readers.
//
// The browser's Back leaves full screen first: the page may answer it with a dialog
// (unsaved moves), and that dialog sits below the full-screen view.
export function useFullScreen(on: boolean, root: RefObject<HTMLElement | null>, setOn: (on: boolean) => void) {
  useEffect(() => {
    const el = root.current
    if (!on || !el) return
    const undo: Array<() => void> = []
    let child: HTMLElement = el
    for (let parent = el.parentElement; parent; child = parent, parent = parent.parentElement) {
      const box = parent
      const s = getComputedStyle(box)
      if (box === document.body || box === document.documentElement || /auto|scroll/.test(`${s.overflowY} ${s.overflowX}`)) {
        const was = box.style.overflow
        box.style.overflow = 'hidden'
        undo.push(() => { box.style.overflow = was })
      }
      for (const sib of box.children) {
        if (sib === child || !(sib instanceof HTMLElement) || sib.inert) continue
        sib.inert = true
        undo.push(() => { sib.inert = false })
      }
    }
    const onBack = () => setOn(false)
    window.addEventListener('popstate', onBack)
    return () => {
      window.removeEventListener('popstate', onBack)
      for (const u of undo.reverse()) u()
    }
  }, [on, root, setOn])
}
