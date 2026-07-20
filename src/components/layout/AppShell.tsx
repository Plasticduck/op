import { type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar, NAV_GROUPS } from '@/components/layout/Sidebar'
import { useCompany } from '@/lib/company'
import { pageAllowed } from '@/lib/permissions'
import type { Role } from '@/lib/rbac'
import { BottomNav } from '@/components/layout/BottomNav'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { MessageNotifier } from '@/lib/messageNotifier'
import { TopBar } from '@/components/layout/TopBar'
import { TrialBanner } from '@/components/layout/TrialBanner'
import { DemoBanner } from '@/components/layout/DemoBanner'
import { LocationProvider } from '@/lib/locations'
import { CompanyProvider } from '@/lib/company'
import { NotificationsProvider } from '@/lib/notifications'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { BillingGate } from '@/components/layout/BillingGate'

// Routes that should fill the entire main scroll container with no outer
// padding so they can manage their own scroll (chat threads, side-by-side
// list+detail pages). On mobile they also tuck under the BottomNav via
// pb-[5rem] inside the page itself, since `main` no longer adds bottom space.
// /app/reports/:reportKey is the legacy per-report page which lives inside
// the padded wrapper. The new tabbed /app/reports is also padded since its
// content is normal scrolling charts, not a chat thread.
const FULL_BLEED_PATTERNS = [
  /^\/app\/messages($|\/)/,
  /^\/app\/work-orders($|\/)/,
  /^\/app\/assets($|\/)/,
  /^\/app\/parts($|\/)/,
  /^\/app\/categories($|\/)/,
  /^\/app\/vendors($|\/)/,
]

// Enforce per-role page permissions on direct navigation. Maps the current path
// to its nav page and redirects to the dashboard if that page is turned off for
// the role. Dashboard is never restricted, so this can't loop.
function PagePermissionGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { settings } = useCompany()
  const location = useLocation()
  if (!profile) return <>{children}</>
  let match: { to: string; roles: Role[]; optIn?: Role[] } | null = null
  for (const g of NAV_GROUPS) {
    for (const i of g.items) {
      if (location.pathname === i.to || location.pathname.startsWith(i.to + '/')) {
        if (!match || i.to.length > match.to.length) match = { to: i.to, roles: i.roles, optIn: i.optIn }
      }
    }
  }
  if (
    match &&
    match.to !== '/app/dashboard' &&
    !pageAllowed(profile.role, match.to, match.roles, {
      rolePerms: settings.pagePermissions,
      userId: profile.id,
      userPerms: settings.userPermissions,
      optInRoles: match.optIn,
    })
  ) {
    return <Navigate to="/app/dashboard" replace />
  }
  return <>{children}</>
}

export function AppShell() {
  const { profile } = useAuth()
  const location = useLocation()
  // RequireAuth guarantees a profile before this renders.
  if (!profile) return null

  const isFullBleed = FULL_BLEED_PATTERNS.some((re) => re.test(location.pathname))

  return (
    // BillingGate replaces the whole shell with a paywall when the account's
    // trial has ended (or it's canceled / past due). Wrapping outside the
    // providers means a locked account never spins up realtime subscriptions.
    <BillingGate>
      <CompanyProvider>
      <LocationProvider>
        <NotificationsProvider>
          <div className="flex h-dvh w-full bg-content text-ink">
            <Sidebar role={profile.role} />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />
              <DemoBanner />
              <TrialBanner />
              <main className={cn(
                'flex-1 min-h-0',
                isFullBleed ? 'overflow-hidden' : 'overflow-y-auto',
              )}>
                <PagePermissionGate>
                  {isFullBleed ? (
                    <Outlet />
                  ) : (
                    // Padded wrapper: bottom padding leaves room for the BottomNav
                    // on mobile so the content can scroll above it without being
                    // covered.
                    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-8">
                      <Outlet />
                    </div>
                  )}
                </PagePermissionGate>
              </main>
            </div>
            <BottomNav role={profile.role} />
            <CommandPalette />
            <MessageNotifier />
          </div>
        </NotificationsProvider>
      </LocationProvider>
      </CompanyProvider>
    </BillingGate>
  )
}
