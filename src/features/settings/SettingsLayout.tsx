import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const tabs = [
  { to: '/app/settings/team', label: 'Team', ownerOnly: false },
  { to: '/app/settings/locations', label: 'Locations', ownerOnly: false },
  { to: '/app/settings/billing', label: 'Billing', ownerOnly: true },
]

export function SettingsLayout() {
  const { profile } = useAuth()
  const visibleTabs = tabs.filter((t) => !t.ownerOnly || profile?.role === 'owner')
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Account settings
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Manage your team, locations, and subscription.
        </p>
      </div>

      <nav className="flex gap-1 border-b border-border">
        {visibleTabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  )
}
