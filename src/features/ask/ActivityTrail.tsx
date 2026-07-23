import { Check, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

// One line per thing the assistant actually did, appended live off the stream.
// The running step sweeps; finished steps collapse to a muted line with the
// row count so you can see the shape of the work after the answer lands.
export type Activity = {
  id: number
  label: string
  state: 'active' | 'done'
  rows?: number
  error?: string
}

export function ActivityTrail({
  items,
  className,
}: {
  items: Activity[]
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <ol className={cn('space-y-2', className)}>
      {items.map((a) => (
        <li key={a.id} className="ai-rise flex items-start gap-2.5 text-[13px]">
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
            {a.state === 'active' ? (
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-accent" />
              </span>
            ) : a.error ? (
              <TriangleAlert className="size-3.5 text-warn" />
            ) : (
              <Check className="size-3.5 text-ok" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                a.state === 'active' ? 'ai-shimmer font-medium' : 'text-ink-muted',
              )}
            >
              {a.label}
            </span>
            {a.state === 'done' && a.rows != null && !a.error && (
              <span className="ml-1.5 text-ink-subtle">
                · {a.rows} {a.rows === 1 ? 'row' : 'rows'}
              </span>
            )}
            {a.error && <span className="ml-1.5 text-warn">· {a.error}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
