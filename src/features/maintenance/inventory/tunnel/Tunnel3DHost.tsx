import { Component, lazy, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { FRAME } from './three/ui/frame'
import { LoadingVeil } from './three/ui/Loading'
import { canWebGL2, type Tunnel3DFail, type Tunnel3DProps } from './view3d'

// The 3D view's doorway, small enough to load with the Tunnel page: it asks whether the
// browser can draw 3D at all, fetches the view's own chunk (three.js lives there) only
// if it can, holds the canvas's place while that loads, and tells the page when anything
// goes wrong so the page can show the diagram instead. Nothing here imports three.js.

// How long a reload may take to happen before the page gives up on it and shows the
// diagram instead.
const RELOAD_WAIT_MS = 3000

// Failures to fetch the view's chunk, told apart from errors in the view itself.
const fetchFailures = new WeakSet<object>()

function loadView() {
  return import('./Tunnel3D').catch((err: unknown) => {
    // React.lazy keeps a failed import for good, so the next view to mount gets a new one
    // and fetches the chunk again ("Try 3D again", or 3D picked once more), also when the
    // view that started this fetch is long gone. A view already on the page keeps the one
    // it mounted with (Tunnel3DHost), so its render retries see this same failure and
    // can't start another fetch.
    Tunnel3D = lazy(loadView)
    if (typeof err === 'object' && err) fetchFailures.add(err)
    throw err
  })
}
let Tunnel3D = lazy(loadView)

// A deploy while the page was open renames the chunk, and the old name 404s: one reload
// picks up the new names. The same guard, on the same key, as the router's lazy pages
// (routes/index.tsx), so the two never take turns reloading. Only for a view that is on
// the page when the fetch fails (the Boundary is told): one the page has already let go
// of (List or Diagram picked while the chunk was on its way) reloads nothing. Not in
// development: there a failed fetch is a file someone is still saving (Vite answers 500),
// a reload only loops, and the diagram with "Try 3D again" lets them carry on.
const RELOADED_AT = 'chunk-reloaded-at'
function mayReload(err: unknown): boolean {
  if (import.meta.env.DEV || typeof err !== 'object' || !err || !fetchFailures.has(err)) return false
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOADED_AT) || '0') > 10_000
  } catch {
    // No session storage to remember the reload in: don't risk a loop.
    return false
  }
}

type BoundaryProps = { onFail: (reason: Tunnel3DFail) => void; waiting: ReactNode; children: ReactNode }

// Whatever throws inside the view (the chunk failing to load, a model that can't be
// built) ends here: the page is told, and nothing is drawn in its place. A chunk that
// can't be fetched may reload the page first (above).
class Boundary extends Component<BoundaryProps, { failed: boolean; reloading: boolean }> {
  state = { failed: false, reloading: false }
  timer = 0

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, reloading: mayReload(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (this.state.reloading) {
      try {
        sessionStorage.setItem(RELOADED_AT, String(Date.now()))
        window.location.reload()
        // Wait for the reload, but not for ever: the page's own "Leave site?" prompt
        // (unsaved moves) can stop it, and then the page has to show the diagram as for
        // any other failure. On a slow network the diagram may show for a moment before
        // the reloaded page arrives.
        this.timer = window.setTimeout(() => this.props.onFail('error'), RELOAD_WAIT_MS)
        return
      } catch {
        // The reload couldn't be remembered: no reload, as above.
      }
    }
    console.error('The 3D tunnel view failed', error, info.componentStack)
    this.props.onFail('error')
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer)
  }

  render() {
    if (!this.state.failed) return this.props.children
    // Still loading, as far as the person can tell, while the page reloads.
    return this.state.reloading ? this.props.waiting : null
  }
}

export function Tunnel3DHost(props: Tunnel3DProps) {
  const { onFail } = props
  // Asked each time the view is shown: after a lost GPU the answer can change.
  const [able] = useState(canWebGL2)
  // The chunk's loader as it stood when this view mounted (see loadView), for as long as
  // it stays mounted.
  const [View] = useState(() => Tunnel3D)
  const told = useRef(false)
  useEffect(() => {
    if (able || told.current) return
    told.current = true
    onFail('unsupported')
  }, [able, onFail])

  if (!able) return null
  const waiting = <div className={cn(FRAME, props.className)}><LoadingVeil /></div>
  return (
    <Boundary onFail={onFail} waiting={waiting}>
      <Suspense fallback={waiting}>
        <View {...props} />
      </Suspense>
    </Boundary>
  )
}
