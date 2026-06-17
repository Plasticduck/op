import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { progress } from '@/lib/progress'

// A slim NProgress-style bar pinned to the very top of the window. It trickles
// toward ~90% while loading, snaps to 100% on completion, then fades out.
export function TopLoadingBar() {
  const [active, setActive] = useState(false)
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => progress.subscribe(setActive), [])

  useEffect(() => {
    let trickle: ReturnType<typeof setInterval> | undefined
    let hide: ReturnType<typeof setTimeout> | undefined

    if (active) {
      setVisible(true)
      setWidth(8)
      trickle = setInterval(() => {
        setWidth((w) => (w < 90 ? w + (90 - w) * 0.12 : w))
      }, 200)
    } else {
      setWidth(100)
      hide = setTimeout(() => {
        setVisible(false)
        setWidth(0)
      }, 350)
    }

    return () => {
      if (trickle) clearInterval(trickle)
      if (hide) clearTimeout(hide)
    }
  }, [active])

  if (!visible) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div
        className="h-full bg-accent transition-[width] duration-200 ease-out"
        style={{ width: `${width}%`, boxShadow: '0 0 10px 0 rgba(37, 99, 235, 0.7)' }}
      />
    </div>
  )
}

// Suspense fallback for lazy route chunks: drives the top bar while the chunk
// loads and keeps the existing centered spinner for the content area.
export function RouteProgress() {
  useEffect(() => {
    progress.start()
    return () => progress.done()
  }, [])
  return (
    <div className="grid h-dvh place-items-center bg-content text-ink-muted">
      <Loader2 className="size-6 animate-spin" />
    </div>
  )
}
