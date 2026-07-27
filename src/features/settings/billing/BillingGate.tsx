import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { isBillingHidden } from '@/lib/accountFlags'

// Blocks direct navigation to Billing for accounts where it is hidden, so the
// route matches the sidebar + Settings-tab visibility.
export function BillingGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  if (isBillingHidden(profile?.account_id)) return <Navigate to="/app/settings/team" replace />
  return <>{children}</>
}
