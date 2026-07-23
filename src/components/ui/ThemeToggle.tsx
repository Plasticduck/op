import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

// Light/dark switch. `icon` is the compact top-bar affordance; `pill` is the
// labeled version the dashboard shows so the setting is findable without
// hunting through the top bar.
export function ThemeToggle({
  variant = 'icon',
  className,
}: {
  variant?: 'icon' | 'pill'
  className?: string
}) {
  const { resolved, setTheme } = useTheme()
  const dark = resolved === 'dark'
  const Icon = dark ? Sun : Moon
  const label = dark ? 'Light mode' : 'Dark mode'

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={label}
      className={cn(
        variant === 'icon'
          ? 'rounded-md p-1.5 text-ink-muted hover:bg-content hover:text-ink'
          : 'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:border-accent hover:text-ink',
        className,
      )}
    >
      <Icon className={variant === 'icon' ? 'size-5' : 'size-4'} />
      {variant === 'pill' && <span>{label}</span>}
    </button>
  )
}
