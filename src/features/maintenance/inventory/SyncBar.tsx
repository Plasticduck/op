import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { discardQueued, flushQueue, usePendingSync } from './offline'

// Shows only when there's no signal or something is waiting to sync. Used by
// Maintenance Inventory and the Maintenance Log, which share the offline queue.
export function SyncBar() {
  const { items, online, failed, waiting } = usePendingSync()
  if (online && items.length === 0) return null
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm">
      {!online && <p className="flex items-center gap-2 text-warn"><CloudOff className="size-4" /> No signal. Scans, stock actions and log entries save on this phone until it's back.</p>}
      {waiting.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink">{waiting.length} action{waiting.length === 1 ? '' : 's'} waiting to sync</span>
          {online && <Button variant="secondary" size="sm" onClick={() => void flushQueue()}><RefreshCw className="size-4" /> Sync now</Button>}
        </div>
      )}
      {failed.map((f) => (
        <div key={f.id} className="flex items-start gap-2 text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{f.label}: {f.error}</span>
          <Button variant="ghost" size="sm" onClick={() => void discardQueued(f.id)}>Dismiss</Button>
        </div>
      ))}
    </div>
  )
}
