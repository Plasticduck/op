import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { day } from '../../../format'
import { cars } from '../../../equipment/format'
import { openOrders, statusOf, type Machine } from './machines'

// The name chip over the machine the pointer or the keyboard is on: what the diagram's
// tooltip says. In the showroom there is no data behind the shapes, so only the name.
// opens: it is the selected machine, and one more click opens its page.
export function HoverChip({ m, preview, ring, opens }: { m: Machine; preview: boolean; ring: boolean; opens: boolean }) {
  const a = preview ? null : m.asset
  return (
    <div data-t3d="chip" className={cn('w-max max-w-60 rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-xs shadow-md backdrop-blur-sm', ring && 'ring-2 ring-accent')}>
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-semibold text-ink">{m.name}</span>
        {a && <Badge tone={statusOf(a).tone} className="shrink-0">{statusOf(a).short}</Badge>}
        {!preview && !a && <span className="shrink-0 text-ink-subtle">Not linked</span>}
      </div>
      {a && (a.cars_since != null || a.open_wos > 0) && (
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-ink-muted">
          {a.cars_since != null && <span>{cars(a.cars_since)} cars since {a.usage_since ? day(a.usage_since) : 'its start date'}</span>}
          {a.open_wos > 0 && <span className="font-medium text-warn">{openOrders(a.open_wos)}</span>}
        </div>
      )}
      {opens && (
        <div className="mt-0.5 text-ink-subtle">
          <span className="pointer-coarse:hidden">Click</span><span className="hidden pointer-coarse:inline">Tap</span> again to open its page
        </div>
      )}
    </div>
  )
}
