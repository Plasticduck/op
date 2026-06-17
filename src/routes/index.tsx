/* eslint-disable react-refresh/only-export-components -- route config: lazy() refs + router export, not an HMR component module */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RouteProgress } from '@/components/feedback/TopLoadingBar'
import { RequireAuth, RequireRole, RedirectIfAuthed } from '@/routes/guards'
import { RouteStub } from '@/routes/RouteStub'

// Lazily load a route chunk, but if the fetch fails because the chunk no longer
// exists at that URL (a new deploy rotated the hashed filenames, or the dev
// server re-optimized) reload the page once to pull the fresh build instead of
// throwing "Failed to fetch dynamically imported module". Guarded so it can't
// loop on a genuinely missing chunk.
function retryImport<T>(factory: () => Promise<T>): Promise<T> {
  return factory().catch((err) => {
    const KEY = 'chunk-reloaded-at'
    const last = Number(sessionStorage.getItem(KEY) || '0')
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(KEY, String(Date.now()))
      window.location.reload()
      return new Promise<T>(() => {}) // stay pending until the reload lands
    }
    throw err
  })
}
function lz<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => retryImport(factory))
}

// Friendly fallback if a route still errors after the reload guard.
function RouteError() {
  return (
    <div className="grid min-h-dvh place-items-center bg-content px-4 text-center">
      <div className="max-w-sm">
        <p className="text-base font-medium text-ink">Something went wrong loading this page.</p>
        <p className="mt-1 text-sm text-ink-muted">Reloading usually fixes it.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Reload
        </button>
      </div>
    </div>
  )
}

// Code-splitting: every page is lazy-loaded so visitors only download the
// chunk for the route they're on. The app shell, guards, and stub stay eager.
const LandingPage = lz(() => import('@/features/marketing/LandingPage'))
const PricingPage = lz(() => import('@/features/marketing/PricingPage'))
const DemoLauncher = lz(() => import('@/features/marketing/DemoLauncher'))
const DemoAccess = lz(() => import('@/features/marketing/DemoAccess'))
const TermsPage = lz(() => import('@/features/marketing/Legal').then((m) => ({ default: m.TermsPage })))
const PrivacyPage = lz(() => import('@/features/marketing/Legal').then((m) => ({ default: m.PrivacyPage })))
const LoginPage = lz(() => import('@/features/auth/LoginPage'))
const SignupPage = lz(() => import('@/features/auth/SignupPage'))
const ForgotPasswordPage = lz(() => import('@/features/auth/ForgotPasswordPage'))
const ResetPasswordPage = lz(() => import('@/features/auth/ResetPasswordPage'))
const AcceptInvitePage = lz(() => import('@/features/auth/AcceptInvitePage'))
const DashboardPage = lz(() => import('@/features/dashboard/DashboardPage'))
const SettingsLayout = lz(() => import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsLayout })))
const TeamPage = lz(() => import('@/features/settings/team/TeamPage').then((m) => ({ default: m.TeamPage })))
const LocationsPage = lz(() => import('@/features/settings/locations/LocationsPage').then((m) => ({ default: m.LocationsPage })))
const BillingPage = lz(() => import('@/features/settings/billing/BillingPage').then((m) => ({ default: m.BillingPage })))
const AssetsPage = lz(() => import('@/features/ops/assets/AssetsPage'))
const PartsPage = lz(() => import('@/features/ops/parts/PartsPage'))
const WorkOrdersPage = lz(() => import('@/features/ops/work-orders/WorkOrdersPage'))
const CategoriesPage = lz(() => import('@/features/ops/categories/CategoriesPage'))
const VendorsPage = lz(() => import('@/features/ops/vendors/VendorsPage'))
const DowntimePage = lz(() => import('@/features/ops/downtime/DowntimePage'))
const ChecklistsPage = lz(() => import('@/features/ops/checklists/ChecklistsPage'))
const ChecklistsTemplatesPage = lz(() => import('@/features/ops/checklists/ChecklistsTemplatesPage'))
const ChecklistDetailPage = lz(() => import('@/features/ops/checklists/ChecklistDetailPage'))
const CloseoutsPage = lz(() => import('@/features/ops/closeouts/CloseoutsPage'))
const DocumentsPage = lz(() => import('@/features/ops/documents/DocumentsPage'))
const ContactsPage = lz(() => import('@/features/ops/contacts/ContactsPage'))
const SuppliesPage = lz(() => import('@/features/ops/supplies/SuppliesPage'))
const EmployeesPage = lz(() => import('@/features/people/employees/EmployeesPage'))
const EmployeeDetailPage = lz(() => import('@/features/people/employees/EmployeeDetailPage'))
const SchedulePage = lz(() => import('@/features/people/schedule/SchedulePage'))
const TimeClockPage = lz(() => import('@/features/people/timeclock/TimeClockPage'))
const KioskPage = lz(() => import('@/features/people/timeclock/KioskPage'))
const TimesheetsPage = lz(() => import('@/features/people/timesheets/TimesheetsPage'))
const ReviewsPage = lz(() => import('@/features/people/reviews/ReviewsPage'))
const CounselingPage = lz(() => import('@/features/people/counseling/CounselingPage'))
const InjuriesPage = lz(() => import('@/features/people/injuries/InjuriesPage'))
const UniformsPage = lz(() => import('@/features/people/uniforms/UniformsPage'))
const TimeOffPage = lz(() => import('@/features/people/timeoff/TimeOffPage'))
const CalendarPage = lz(() => import('@/features/people/calendar/CalendarPage'))
const BreaksPage = lz(() => import('@/features/people/breaks/BreaksPage'))
const SiteReviewsPage = lz(() => import('@/features/opssuite/SiteReviewsPage'))
const SiteAuditsPage = lz(() => import('@/features/opssuite/SiteAuditsPage'))
const InvoicesPage = lz(() => import('@/features/opssuite/InvoicesPage'))
const InventoryPage = lz(() => import('@/features/opssuite/InventoryPage'))
const MarketResearchPage = lz(() => import('@/features/opssuite/MarketResearchPage'))
const MarketResearchDetailPage = lz(() => import('@/features/opssuite/MarketResearchDetailPage'))
const SiteViolationsPage = lz(() => import('@/features/opssuite/SiteViolationsPage'))
const ReportingPage = lz(() => import('@/features/reports/ReportingPage'))
const PreBuiltReportPage = lz(() => import('@/features/reports/PreBuiltReportPage'))
const InsightsPage = lz(() => import('@/features/insights/InsightsPage'))
const SocialCalendarPage = lz(() => import('@/features/social/SocialCalendarPage'))
const MessagesPage = lz(() => import('@/features/messages/MessagesPage'))
const TipPage = lz(() => import('@/features/tips/TipPage'))
const TipThanksPage = lz(() => import('@/features/tips/TipPage').then((m) => ({ default: m.TipThanksPage })))
const TipsAdminPage = lz(() => import('@/features/tips/TipsAdminPage'))

const s = (el: ReactNode) => <Suspense fallback={<RouteProgress />}>{el}</Suspense>
const mgr = (el: ReactNode) => (
  <RequireRole allow={['owner', 'manager']}>{s(el)}</RequireRole>
)

export const router = createBrowserRouter([
  // Public marketing
  { path: '/', element: s(<LandingPage />) },
  { path: '/pricing', element: s(<PricingPage />) },
  { path: '/demo', element: s(<DemoLauncher />) },
  { path: '/demo/access', element: s(<DemoAccess />) },
  { path: '/terms', element: s(<TermsPage />) },
  { path: '/privacy', element: s(<PrivacyPage />) },

  // Public per-site tip pages (reached by QR code — no login)
  { path: '/tip/:locationId', element: s(<TipPage />) },
  { path: '/tip/:locationId/thanks', element: s(<TipThanksPage />) },

  // Auth — bounce signed-in users away from these
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/login', element: s(<LoginPage />) },
      { path: '/signup', element: s(<SignupPage />) },
      { path: '/forgot-password', element: s(<ForgotPasswordPage />) },
    ],
  },
  { path: '/reset-password', element: s(<ResetPasswordPage />) },
  { path: '/invite/:token', element: s(<AcceptInvitePage />) },

  // Authenticated app
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/app',
        element: <AppShell />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Navigate to="/app/dashboard" replace /> },
          { path: 'dashboard', element: s(<DashboardPage />) },

          { path: 'insights', element: mgr(<InsightsPage />) },
          { path: 'reports', element: mgr(<ReportingPage />) },
          { path: 'reports/:reportKey', element: mgr(<PreBuiltReportPage />) },

          { path: 'checklists', element: s(<ChecklistsPage />) },
          { path: 'checklists/templates', element: mgr(<ChecklistsTemplatesPage />) },
          { path: 'checklists/templates/:id', element: mgr(<ChecklistDetailPage />) },
          { path: 'work-orders', element: mgr(<WorkOrdersPage />) },
          { path: 'work-orders/:id', element: mgr(<WorkOrdersPage />) },
          { path: 'categories', element: mgr(<CategoriesPage />) },
          { path: 'vendors', element: mgr(<VendorsPage />) },
          { path: 'assets', element: mgr(<AssetsPage />) },
          { path: 'assets/:id', element: mgr(<AssetsPage />) },
          // Legacy equipment URLs redirect to /assets so old bookmarks keep working.
          { path: 'equipment', element: <Navigate to="/app/assets" replace /> },
          { path: 'equipment/:id', element: <Navigate to="/app/assets" replace /> },
          { path: 'downtime', element: mgr(<DowntimePage />) },
          { path: 'parts', element: mgr(<PartsPage />) },
          { path: 'parts/:id', element: mgr(<PartsPage />) },
          { path: 'closeouts', element: mgr(<CloseoutsPage />) },
          { path: 'documents', element: s(<DocumentsPage />) },
          { path: 'contacts', element: mgr(<ContactsPage />) },
          { path: 'supplies', element: s(<SuppliesPage />) },

          { path: 'site-reviews', element: mgr(<SiteReviewsPage />) },
          { path: 'site-audits', element: mgr(<SiteAuditsPage />) },
          { path: 'invoices', element: mgr(<InvoicesPage />) },
          { path: 'inventory', element: mgr(<InventoryPage />) },
          { path: 'market-research', element: mgr(<MarketResearchPage />) },
          { path: 'market-research/:id', element: mgr(<MarketResearchDetailPage />) },
          { path: 'violations', element: mgr(<SiteViolationsPage />) },

          { path: 'employees', element: mgr(<EmployeesPage />) },
          { path: 'employees/:id', element: mgr(<EmployeeDetailPage />) },
          { path: 'schedule', element: s(<SchedulePage />) },
          { path: 'timeclock', element: mgr(<TimeClockPage />) },
          { path: 'timeclock/kiosk', element: mgr(<KioskPage />) },
          { path: 'timesheets', element: mgr(<TimesheetsPage />) },
          { path: 'reviews', element: mgr(<ReviewsPage />) },
          { path: 'counseling', element: mgr(<CounselingPage />) },
          { path: 'injuries', element: mgr(<InjuriesPage />) },
          { path: 'uniforms', element: s(<UniformsPage />) },
          { path: 'time-off', element: s(<TimeOffPage />) },
          { path: 'calendar', element: s(<CalendarPage />) },
          { path: 'social-calendar', element: mgr(<SocialCalendarPage />) },
          { path: 'messages', element: s(<MessagesPage />) },
          { path: 'tips', element: mgr(<TipsAdminPage />) },
          { path: 'messages/:conversationId', element: s(<MessagesPage />) },
          { path: 'breaks', element: mgr(<BreaksPage />) },

          {
            path: 'settings',
            element: (
              <RequireRole allow={['owner']}>{s(<SettingsLayout />)}</RequireRole>
            ),
            children: [
              { index: true, element: <Navigate to="/app/settings/team" replace /> },
              { path: 'team', element: s(<TeamPage />) },
              { path: 'locations', element: s(<LocationsPage />) },
              { path: 'billing', element: s(<BillingPage />) },
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <RouteStub title="Not found" phase="—" /> },
])
