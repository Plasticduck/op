import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

// The module's four screens, as a segmented control under the page title.
// Stickers, import and settings are tools reached from these.
const TABS = [
  { to: '/app/it-inventory/overview', label: 'Overview', end: false },
  { to: '/app/it-inventory', label: 'Equipment', end: true },
  { to: '/app/it-inventory/subscriptions', label: 'Subscriptions', end: false },
  { to: '/app/it-inventory/supplies', label: 'Supplies', end: false },
]

export function SectionNav({ className }: { className?: string }) {
  return (
    <nav aria-label="IT Inventory"
      className={cn('flex w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-card p-0.5 sm:w-fit', className)}>
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end}
          className={({ isActive }) => cn(
            'flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center text-sm font-medium transition sm:flex-none sm:px-3',
            isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink',
          )}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
