import type { EarnedBadge } from '@/lib/queries/badges'
import { cn } from '@/lib/utils'

const TONE: Record<string, string> = {
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-content text-ink-muted',
}

// Earned badges shown inline next to an employee's name. Compact by default
// (emoji only, name on hover); `showLabels` spells them out for detail views.
export function BadgeChips({
  badges,
  max = 4,
  showLabels = false,
  className,
}: {
  badges: EarnedBadge[]
  max?: number
  showLabels?: boolean
  className?: string
}) {
  if (badges.length === 0) return null
  const shown = badges.slice(0, max)
  const extra = badges.length - shown.length

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1 align-middle', className)}>
      {shown.map((b) => (
        <span
          key={b.key}
          title={b.description ? `${b.name} — ${b.description}` : b.name}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none',
            TONE[b.tone] ?? TONE.accent,
          )}
        >
          <span aria-hidden>{b.emoji ?? '★'}</span>
          {showLabels && <span>{b.name}</span>}
          {!showLabels && <span className="sr-only">{b.name}</span>}
        </span>
      ))}
      {extra > 0 && (
        <span
          title={badges.slice(max).map((b) => b.name).join(', ')}
          className="rounded-full bg-content px-1.5 py-0.5 text-[11px] font-medium leading-none text-ink-muted"
        >
          +{extra}
        </span>
      )}
    </span>
  )
}
