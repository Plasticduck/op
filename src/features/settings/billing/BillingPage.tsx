import { useEffect, useState } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { billing, PLANS, type Account, type PlanKey } from '@/lib/queries/billing'

const STATUS_TONE = { trial: 'accent', active: 'ok', past_due: 'warn', canceled: 'danger' } as const

export function BillingPage() {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    const { data } = await billing.account()
    setAccount((data as Account | null) ?? null)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  // Surface ?checkout=success|cancelled from the Stripe redirect.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('checkout')
    if (p === 'success') setNotice('Subscription started — thanks! It may take a moment to reflect.')
    if (p === 'cancelled') setNotice('Checkout cancelled.')
  }, [])

  const handle = async (
    action: 'checkout' | 'portal',
    plan?: PlanKey,
  ) => {
    setBusy(plan ?? 'portal')
    setNotice(null)
    const { data, error } =
      action === 'checkout' ? await billing.checkout(plan!) : await billing.portal()
    setBusy(null)
    if (error) {
      const ctx = (error as unknown as { context?: Response }).context
      let msg = 'Could not start billing.'
      if (ctx) {
        try {
          const body = await ctx.json()
          if (body?.error === 'no_key') msg = 'Stripe is not configured yet (see setup note below).'
          else if (body?.message) msg = body.message
        } catch { /* ignore */ }
      }
      setNotice(msg)
      return
    }
    const res = data as { url?: string }
    if (res?.url) window.location.href = res.url
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>

  const status = account?.billing_status ?? 'trial'
  const hasSubscription = !!account?.stripe_subscription_id
  const trialDays = account?.trial_ends_at
    ? differenceInCalendarDays(new Date(account.trial_ends_at), new Date())
    : null

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div className="rounded-md border border-border bg-accent-soft/50 px-3 py-2 text-sm text-ink">{notice}</div>
      )}

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">Current plan</h2>
              <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE]}>{status.replace('_', ' ')}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {status === 'trial'
                ? trialDays != null && trialDays >= 0
                  ? `Free trial — ${trialDays} day${trialDays === 1 ? '' : 's'} left. No credit card on file.`
                  : 'Your free trial has ended.'
                : `Plan: ${account?.plan ?? '—'}${account?.subscription_quantity && account.subscription_quantity > 1 ? ` · ${account.subscription_quantity} locations` : ''}`}
            </p>
          </div>
          {hasSubscription && (
            <Button variant="secondary" onClick={() => handle('portal')} disabled={busy === 'portal'}>
              {busy === 'portal' && <Loader2 className="size-4 animate-spin" />}
              Manage subscription
            </Button>
          )}
        </div>
      </div>

      {!hasSubscription && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.key} className="flex flex-col rounded-md border border-border bg-card p-4">
              <h3 className="font-medium text-ink">{p.name}</h3>
              <p className="mt-1 text-2xl font-semibold text-ink">{p.price}</p>
              <p className="mt-1 flex-1 text-sm text-ink-muted">{p.blurb}</p>
              <Button className="mt-3" onClick={() => handle('checkout', p.key)} disabled={busy === p.key}>
                {busy === p.key ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Choose plan
              </Button>
            </div>
          ))}
        </div>
      )}

      {notice?.includes('Stripe is not configured') && (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-ink-muted">
          <p className="font-medium text-ink">Enable billing</p>
          <p className="mt-1">Set Stripe secrets, then deploy the functions:</p>
          <pre className="mt-2 overflow-x-auto rounded bg-content p-2 font-mono text-xs text-ink">
{`supabase secrets set STRIPE_SECRET_KEY=sk_test_... \\
  STRIPE_WEBHOOK_SECRET=whsec_... \\
  STRIPE_PRICE_SINGLE_MONTHLY=price_... \\
  STRIPE_PRICE_SINGLE_YEARLY=price_... \\
  STRIPE_PRICE_PER_LOCATION_MONTHLY=price_... \\
  APP_URL=https://operator.washlyfe.com`}
          </pre>
        </div>
      )}
    </div>
  )
}
