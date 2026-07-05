import { useEffect, useState } from 'react'
import { Check, Loader2, Lock, LogOut, Mail } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { billing, PLANS, type Account, type PlanKey } from '@/lib/queries/billing'
import { accountLockState, LOCK_COPY, type LockReason } from '@/lib/billingGate'
import { fnErrorMessage } from '@/lib/fnError'

const CONTACT_EMAIL = 'info@washlyfe.com'

// Wraps the whole authenticated app. If the account's trial has ended (or it's
// canceled / past due), the app is replaced with a paywall: owners pick a plan
// or request custom pricing; everyone else is told to ask the owner. Until the
// account loads we render nothing app-side to avoid flashing the UI then
// yanking it.
export function BillingGate({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth()
  const [account, setAccount] = useState<Account | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    billing.account().then(({ data }) => {
      if (!alive) return
      setAccount((data as Account | null) ?? null)
      setLoaded(true)
    })
    return () => { alive = false }
  }, [])

  // Brief loader while we resolve billing state.
  if (!loaded) {
    return (
      <div className="grid h-dvh place-items-center bg-content">
        <Loader2 className="size-6 animate-spin text-ink-subtle" />
      </div>
    )
  }

  const lock = accountLockState(account)
  if (!lock.locked) return <>{children}</>

  const isOwner = profile?.role === 'owner'
  return (
    <Paywall
      reason={lock.reason}
      isOwner={isOwner}
      accountName={account?.name ?? ''}
      onSignOut={() => void signOut()}
    />
  )
}

function Paywall({
  reason, isOwner, accountName, onSignOut,
}: {
  reason: LockReason
  isOwner: boolean
  accountName: string
  onSignOut: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const copy = LOCK_COPY[reason]

  const checkout = async (plan: PlanKey) => {
    setBusy(plan)
    setError(null)
    const { data, error: err } = await billing.checkout(plan)
    const url = (data as { url?: string } | null)?.url
    if (err || !url) {
      setBusy(null)
      setError(await fnErrorMessage(err, data as { message?: string; error?: string } | null, 'Could not start checkout.'))
      return
    }
    window.location.assign(url)
  }

  const contactHref =
    `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Custom pricing for ${accountName || 'my car wash'}`)}` +
    `&body=${encodeURIComponent(`Hi, I run ${accountName || 'a car wash'} and would like to talk about pricing for Operator.`)}`

  return (
    <div className="min-h-dvh overflow-y-auto bg-content">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
        <div className="flex items-center justify-between">
          <Logo size="md" />
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>

        <div className="mt-10 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-warn-soft">
            <Lock className="size-6 text-warn" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{copy.title}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{copy.body}</p>
        </div>

        {isOwner ? (
          <>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {PLANS.map((p) => (
                <div key={p.key} className="flex flex-col rounded-lg border border-border bg-card p-5">
                  <div className="text-sm font-semibold text-ink">{p.name}</div>
                  <div className="mt-1 text-2xl font-semibold text-ink">{p.price}</div>
                  <p className="mt-1 text-xs text-ink-muted">{p.blurb}</p>
                  <Button
                    className="mt-4 w-full"
                    onClick={() => void checkout(p.key)}
                    disabled={busy !== null}
                  >
                    {busy === p.key ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    Choose
                  </Button>
                </div>
              ))}
            </div>

            {error && (
              <p className="mx-auto mt-4 max-w-md rounded-md bg-danger-soft px-3 py-2 text-center text-sm text-danger">{error}</p>
            )}

            <div className="mt-8 rounded-lg border border-border bg-card p-5 text-center">
              <div className="text-sm font-semibold text-ink">Running a large group or need special pricing?</div>
              <p className="mt-1 text-sm text-ink-muted">We work with multi-site operators on custom plans.</p>
              <a
                href={contactHref}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-content"
              >
                <Mail className="size-4" /> Contact us for special pricing
              </a>
            </div>

            <p className="mt-6 text-center text-xs text-ink-subtle">
              Your data is safe. Access resumes the moment a plan is active.
            </p>
          </>
        ) : (
          <div className="mx-auto mt-10 max-w-md rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-ink">
              Ask the account admin for {accountName || 'your car wash'} to choose a plan to restore access.
            </p>
            <a
              href={contactHref}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
            >
              <Mail className="size-4" /> Or contact us
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
