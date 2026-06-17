import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import type { Role } from '@/lib/rbac'

function FullScreenLoader() {
  return (
    <div className="grid h-dvh place-items-center bg-content text-ink-muted">
      <Loader2 className="size-6 animate-spin" />
    </div>
  )
}

// Session exists but no profile row yet. Normally this is the brief window
// during signup before signup_account creates the row — we retry once and the
// page re-renders into the app as soon as the profile loads. If it never
// resolves (orphaned auth user), offer a way out instead of hanging forever.
function ProfilePending() {
  const { refreshProfile, signOut } = useAuth()
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    void refreshProfile()
    const t = setTimeout(() => setStuck(true), 6000)
    return () => clearTimeout(t)
  }, [refreshProfile])

  if (!stuck) return <FullScreenLoader />
  return (
    <div className="grid h-dvh place-items-center bg-content px-4 text-center">
      <div className="max-w-sm">
        <p className="text-sm text-ink">We couldn't finish loading your account.</p>
        <p className="mt-1 text-sm text-ink-muted">
          Your sign-up may not have completed. Try signing in again.
        </p>
        <Button className="mt-4" onClick={() => void signOut()}>
          Back to sign in
        </Button>
      </div>
    </div>
  )
}

// Gates /app/* — requires a session AND a loaded profile.
export function RequireAuth() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoader />
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (!profile) return <ProfilePending />
  return <Outlet />
}

export function RequireRole({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return null
  if (!allow.includes(profile.role)) {
    return <Navigate to="/app/dashboard" replace />
  }
  return <>{children}</>
}

// Public auth pages bounce already-onboarded users into the app. We require a
// *profile*, not just a session — during signup the session flips to
// authenticated before the account row exists, and redirecting on session alone
// would yank the user off the signup form mid-submit.
export function RedirectIfAuthed() {
  const { session, profile, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (session && profile) return <Navigate to="/app/dashboard" replace />
  return <Outlet />
}
