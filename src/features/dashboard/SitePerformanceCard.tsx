import { Activity } from 'lucide-react'

// Per-site dashboard section for Site Performance. Placeholder while the live
// feed is paused; swap the body for real metrics when it returns.
export function SitePerformanceCard({ locationName }: { locationName: string }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <header className="mb-2 flex items-center gap-2">
        <Activity className="size-4 text-ink-muted" />
        <h2 className="text-sm font-semibold text-ink">Site Performance</h2>
      </header>
      <p className="text-sm text-ink-muted">
        Coming soon. Live performance metrics for {locationName} will appear here.
      </p>
    </section>
  )
}
