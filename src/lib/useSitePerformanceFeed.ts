import { useEffect, useState } from 'react'
import { fetchSitePerformance, type SitePerformanceFeed } from '@/lib/queries/sitePerformance'

// Shared, cached access to the Site Performance feed. Several dashboard sections
// (scorecard, per-site card, region tables) need the same feed, so one fetch is
// cached for a short window and reused instead of each firing its own call.
let cache: { feed: SitePerformanceFeed; at: number } | null = null
let inflight: Promise<SitePerformanceFeed> | null = null
const TTL = 60_000

function load(): Promise<SitePerformanceFeed> {
  const fresh = cache && Date.now() - cache.at < TTL
  if (fresh) return Promise.resolve(cache!.feed)
  if (!inflight) {
    inflight = fetchSitePerformance()
      .then((f) => { cache = { feed: f, at: Date.now() }; return f })
      .finally(() => { inflight = null })
  }
  return inflight
}

export function useSitePerformanceFeed(enabled: boolean) {
  const [feed, setFeed] = useState<SitePerformanceFeed | null>(cache?.feed ?? null)
  const [loading, setLoading] = useState(enabled && !cache)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let active = true
    setError(false)
    if (!cache) setLoading(true)
    load()
      .then((f) => { if (active) { setFeed(f); setLoading(false) } })
      .catch(() => { if (active) { setError(true); setLoading(false) } })
    return () => { active = false }
  }, [enabled])

  return { feed, loading, error }
}
