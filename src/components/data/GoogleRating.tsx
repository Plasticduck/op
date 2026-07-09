import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

// A 5-star row with fractional fill. Gold overlay is clipped to the rating's
// percentage over a muted base row, so a 4.7 shows 94% gold.
function StarRow({ rating, className }: { rating: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100))
  return (
    <span className={cn('relative inline-block leading-none tracking-tight', className)} aria-hidden>
      <span className="text-ink-subtle/25">★★★★★</span>
      <span className="absolute inset-0 overflow-hidden text-warn" style={{ width: `${pct}%` }}>
        ★★★★★
      </span>
    </span>
  )
}

// Compact inline badge, e.g. on the all-sites site cards: "★ 4.7".
export function GoogleRatingBadge({ rating }: { rating: number | null }) {
  if (rating == null) return null
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
      <span aria-hidden>★</span>
      {rating.toFixed(1)}
    </span>
  )
}

// Full dashboard tile for a single site.
export function GoogleRatingTile({
  rating,
  count,
  syncedAt,
  loading,
}: {
  rating: number | null
  count: number | null
  syncedAt: string | null
  loading: boolean
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Google rating</h2>
        {syncedAt && !loading && (
          <span className="text-xs text-ink-subtle">
            updated {formatDistanceToNow(new Date(syncedAt), { addSuffix: true })}
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-ink-muted">Loading rating...</p>
      ) : rating == null ? (
        <p className="mt-3 text-sm text-ink-muted">
          Not linked to a Google listing yet.
        </p>
      ) : (
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-4xl font-semibold tabular-nums text-ink">{rating.toFixed(1)}</span>
          <div className="flex flex-col gap-0.5">
            <StarRow rating={rating} className="text-lg" />
            <span className="text-xs text-ink-muted">
              {count != null ? `${count.toLocaleString()} reviews` : 'Google reviews'}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
