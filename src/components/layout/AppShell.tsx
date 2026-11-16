import { type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar, pageForPath } from '@/components/layout/Sidebar'
import { useCompany } from '@/lib/company'
import { pageAllowed } from '@/lib/permissions'
import { permRole } from '@/lib/rbac'
import { PageAccessProvider, usePageAccess } from '@/lib/pageAccess'
import { BottomNav } from '@/components/layout/BottomNav'
import { CommandPalette } from '@/components/layout/CommandPalette'
import PresentationMode from '@/components/layout/PresentationMode'
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
  /^\/app\/ask($|\/)/,
  /^\/app\/market-explorer($|\/)/,
  /^\/app\/fleet-map($|\/)/,
  /^\/app\/corenav-map($|\/)/,
  /^\/app\/messages($|\/)/,
  /^\/app\/work-orders($|\/)/,
  /^\/app\/work-orders-new($|\/)/,
  /^\/app\/assets($|\/)/,
  /^\/app\/parts($|\/)/,
  /^\/app\/categories($|\/)/,
  /^\/app\/vendors($|\/)/,
  /^\/app\/teams($|\/)/,
  /^\/app\/procedures($|\/)/,
  /^\/app\/it-inventory\/(audits\/)?[0-9a-f]{8}-/,
  /^\/app\/maintenance-inventory\/equipment\/[0-9a-f]{8}-/,
]

// Enforce page permissions on direct navigation. Maps the current path to its
// page and redirects to the dashboard if that page is turned off for this person:
// a super admin's block (page_access) first, then the role and Team page rules.
// A super admin's grant lets the page through here; the route's own guard checks
// the same grant. Named-people lists are left to the route guards. Dashboard is
// never restricted, so this can't loop.
function PagePermissionGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { settings } = useCompany()
  const { mine, loading } = usePageAccess()
  const location = useLocation()
  if (!profile) return <>{children}</>
  const match = pageForPath(location.pathname)
  if (!match || match.to === '/app/dashboard') return <>{children}</>
  const over = mine(match.to)
  if (over === true) return <>{children}</>
  if (over === false) return <Navigate to="/app/dashboard" replace />
  const allowed = pageAllowed(permRole(profile.role, profile.role_category), match.to, match.roles, {
    rolePerms: settings.pagePermissions,
    userId: profile.id,
    userPerms: settings.userPermissions,
    optInRoles: match.optIn,
  })
  if (allowed) return <>{children}</>
  // A grant may still be loading; wait for it before turning the person away.
  if (loading) return null
  return <Navigate to="/app/dashboard" replace />
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
      <PageAccessProvider>
      <LocationProvider>
        <NotificationsProvider>
          <div className="flex h-dvh w-full bg-content text-ink">
            <Sidebar role={permRole(profile.role, profile.role_category)} />
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
            <BottomNav role={permRole(profile.role, profile.role_category)} />
            <CommandPalette />
            <MessageNotifier />
            <PresentationMode />
          </div>
        </NotificationsProvider>
      </LocationProvider>
      </PageAccessProvider>
      </CompanyProvider>
    </BillingGate>
  )
}
