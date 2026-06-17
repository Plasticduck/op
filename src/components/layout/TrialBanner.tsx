import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { billing, type Account } from '@/lib/queries/billing'
import { cn } from '@/lib/utils'

// Thin banner for owners: nudges trial conversion as it nears expiry and flags
// past-due payments. Renders nothing otherwise.
export function TrialBanner() {
  const { profile } = useAuth()
  const [account, setAccount] = useState<Account | null>(null)

  useEffect(() => {
    if (profile?.role !== 'owner') return
    billing.account().then(({ data }) => setAccount((data as Account | null) ?? null))
  }, [profile?.role])

  if (!account || account.is_demo) return null

  const status = account.billing_status
  const days = account.trial_ends_at
    ? differenceInCalendarDays(new Date(account.trial_ends_at), new Date())
    : null

  let message: string | null = null
  let tone: 'warn' | 'danger' = 'warn'

  if (status === 'past_due') {
    message = 'Your payment is past due. Update your billing to avoid interruption.'
    tone = 'danger'
  } else if (status === 'trial' && days != null) {
    if (days < 0) {
      message = 'Your free trial has ended. Choose a plan to keep full access.'
      tone = 'danger'
    } else if (days <= 5) {
      message = `Your free trial ends in ${days} day${days === 1 ? '' : 's'}.`
      tone = 'warn'
    }
  }

  if (!message) return null

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-2 text-sm',
        tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn',
      )}
    >
      <span className="inline-flex items-center gap-2">
        <AlertTriangle className="size-4" />
        {message}
      </span>
      <Link
        to="/app/settings/billing"
        className="shrink-0 font-medium underline underline-offset-2"
      >
        Choose a plan
      </Link>
    </div>
  )
}
