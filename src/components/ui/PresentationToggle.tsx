import { MonitorPlay } from 'lucide-react'
import { usePresentationMode } from '@/lib/presentation'
import { cn } from '@/lib/utils'

// Enters/exits the full-screen presentation view. `icon` is the compact top-bar
// affordance next to the theme toggle; `pill` is the labeled version.
export function PresentationToggle({
  variant = 'icon',
  className,
}: {
  variant?: 'icon' | 'pill'
  className?: string
}) {
  const { active, toggle } = usePresentationMode()
  const label = active ? 'Exit presentation' : 'Presentation mode'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        variant === 'icon'
          ? cn('rounded-md p-1.5 hover:bg-content hover:text-ink', active ? 'text-accent' : 'text-ink-muted')
          : 'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:border-accent hover:text-ink',
        className,
      )}
    >
      <MonitorPlay className={variant === 'icon' ? 'size-5' : 'size-4'} />
      {variant === 'pill' && <span>{label}</span>}
    </button>
  )
}
