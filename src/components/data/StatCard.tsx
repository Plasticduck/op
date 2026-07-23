import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatCardProps = {
  label: ReactNode
  value: ReactNode
  delta?: { value: number; suffix?: string; direction?: 'up-good' | 'up-bad' }
  hint?: string
  className?: string
}

export function StatCard({
  label,
  value,
  delta,
  hint,
  className,
}: StatCardProps) {
  const dir = delta?.value === 0 ? 'flat' : delta && delta.value > 0 ? 'up' : 'down'
  const direction = delta?.direction ?? 'up-good'
  const tone =
    dir === 'flat'
      ? 'text-ink-muted'
      : (dir === 'up' && direction === 'up-good') ||
          (dir === 'down' && direction === 'up-bad')
        ? 'text-ok'
        : 'text-danger'

  const DeltaIcon =
    dir === 'flat' ? Minus : dir === 'up' ? ArrowUpRight : ArrowDownRight

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card p-4',
        className,
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="tabular text-2xl font-semibold text-ink">{value}</span>
        {delta && (
          <span
            className={cn(
              'tabular inline-flex items-center gap-0.5 text-xs font-medium',
              tone,
            )}
          >
            <DeltaIcon className="size-3.5" />
            {Math.abs(delta.value)}
            {delta.suffix ?? '%'}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}
