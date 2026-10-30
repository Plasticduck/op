import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatCardProps = {
  label: ReactNode
  value: ReactNode
  delta?: { value: number; suffix?: string; direction?: 'up-good' | 'up-bad' }
  hint?: string
  // Makes the whole card a link (to the list it counts).
  to?: string
  className?: string
}

export function StatCard({
  label,
  value,
  delta,
  hint,
  to,
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

  const cls = cn(
    'rounded-md border border-border bg-card p-4',
    to && 'block transition hover:border-border-strong hover:bg-content/40',
    className,
  )
  const body = (
    <>
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
    </>
  )
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
