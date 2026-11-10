import { useState } from 'react'
import { ExternalLink, KeyRound, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'

// Operations - Admin > CoreNav Map: CoreNav's own expansion map
// (https://expand.corenav.ai/map), shown inside Operator as CoreNav suggested.
//
// How CoreNav's map signs in (read from its code, 2026-11-10): it keeps its own
// sign-in in the browser's local storage, not cookies, so it works in a frame.
// Two ways in, both on CoreNav's card inside the map:
//   Workspace key: typed into the card (or ?key= in the map's address); CoreNav
//     remembers it in this browser, so it's entered once. This is the way that
//     works inside Operator.
//   Sign in: goes through CoreNav's Google sign-in, which Google won't show
//     inside another site's frame. That works in Open in CoreNav (a new tab).
// Local storage in a frame is kept per site, so a key entered here is
// remembered for the map inside Operator, separately from CoreNav's own site.

const MAP_URL = 'https://expand.corenav.ai/map'

export default function CoreNavMapPage() {
  const [frameKey, setFrameKey] = useState(0)
  const [loading, setLoading] = useState(true)

  const reload = () => { setLoading(true); setFrameKey((k) => k + 1) }
  const btn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-ink transition hover:border-accent/50'

  return (
    <div className="flex h-full w-full flex-col bg-content pb-[calc(3.25rem+env(safe-area-inset-bottom))] lg:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-2.5">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <h1 className="text-[15px] font-semibold text-ink">CoreNav Map</h1>
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <KeyRound className="size-3.5 shrink-0 text-ink-subtle" />
            <span>Enter your CoreNav workspace key on the map. This browser remembers it.</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={reload} className={btn} title="Reload the map">
            <RotateCw className={cn('size-3.5', loading && 'animate-spin')} /> Reload map
          </button>
          <a href={MAP_URL} target="_blank" rel="noopener noreferrer" className={btn}>
            <ExternalLink className="size-3.5" /> Open in CoreNav
          </a>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <iframe
          key={frameKey}
          src={MAP_URL}
          title="CoreNav map"
          onLoad={() => setLoading(false)}
          allow="fullscreen; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0 bg-card"
        />
      </div>

      <p className="border-t border-border bg-card px-4 py-1.5 text-[11px] text-ink-subtle">
        CoreNav's Sign in button uses Google, which won't open inside Operator. To sign in with Google instead of a workspace key, use Open in CoreNav.
      </p>
    </div>
  )
}
