import { createElement, useEffect, useState } from 'react'
import { differenceInCalendarDays, format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { currency } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { setSitePlan } from '@/lib/queries/companySettings'
import { billing, type Account, type BillingSummary, type StripeSubscription } from '@/lib/queries/billing'

const STATUS_TONE = { trial: 'accent', active: 'ok', past_due: 'warn', canceled: 'danger' } as const

// Multi-site table (offers the multi-location plan). Used for accounts that
// already have more than one location.
const PRICING_TABLE_MULTI = 'prctbl_1TotitAPyEiCoyu4cSa18lhI'
// Single-location-only table, shown to single-site accounts so they can't buy
// the multi-site plan.
const PRICING_TABLE_SINGLE = 'prctbl_1TpUXLAPyEiCoyu4fc4TxK64'
const PUBLISHABLE_KEY =
  'pk_live_51TfMqvAPyEiCoyu4D6eGtyNqakiOPmw7HzT8nz8627uvMdXq9TDzaYRkvSbpRuprs0B2onSn2Hp0Fkd0sprso95b00Pt8SmiV5'

// Stripe's hosted pricing table (web component). Renders your products/prices
// straight from Stripe, so this stays in sync with whatever you configure there.
function StripePricingTable({
  pricingTableId,
  clientReferenceId,
  customerEmail,
}: {
  pricingTableId: string
  clientReferenceId?: string
  customerEmail?: string
}) {
  useEffect(() => {
    const src = 'https://js.stripe.com/v3/pricing-table.js'
    if (!document.querySelector(`script[src="${src}"]`)) {
      const s = document.createElement('script')
      s.src = src
      s.async = true
      document.head.appendChild(s)
    }
  }, [])

  const props: Record<string, string> = {
    'pricing-table-id': pricingTableId,
    'publishable-key': PUBLISHABLE_KEY,
  }
  if (clientReferenceId) props['client-reference-id'] = clientReferenceId
  if (customerEmail) props['customer-email'] = customerEmail

  return createElement('stripe-pricing-table', props as never)
}

export function BillingPage() {
  const { profile } = useAuth()
  const { sitePlan, reload: reloadCompany } = useCompany()
  const [account, setAccount] = useState<Account | null>(null)
  const [sub, setSub] = useState<StripeSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    const { data } = await billing.account()
    setAccount((data as Account | null) ?? null)
    setLoading(false)
    // Live Stripe subscription details (best-effort).
    const { data: sum, error: sumErr } = await billing.summary()
    if (!sumErr) setSub((sum as BillingSummary | null)?.subscription ?? null)
  }
  useEffect(() => { void load() }, [])

  const upgradeToMulti = async () => {
    if (!account) return
    setUpgrading(true)
    await setSitePlan(account.id, 'multi')
    await reloadCompany()
    await load()
    setUpgrading(false)
  }

  const openPortal = async () => {
    setBusy(true)
    setNotice(null)
    const { data, error } = await billing.portal()
    setBusy(false)
    if (error) {
      setNotice('Could not open the billing portal. Please try again.')
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
        <div className="flex flex-wrap items-center justify-between gap-3">
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
            <Button variant="secondary" onClick={openPortal} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Manage subscription
            </Button>
          )}
        </div>
      </div>

      {sub && (
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-ink">Subscription details</h2>
          <p className="mb-3 text-xs text-ink-muted">Live from Stripe.</p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Plan" value={sub.productName ?? sub.priceNickname ?? '—'} />
            <Detail label="Status" value={sub.status.replace('_', ' ')} />
            <Detail label="Total" value={priceLabel(sub)} />
            <Detail
              label="Quantity"
              value={`${sub.quantity} ${sub.quantity === 1 ? 'location' : 'locations'}`}
            />
            <Detail
              label={sub.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}
              value={fmtUnix(sub.currentPeriodEnd)}
            />
            <Detail
              label="Payment method"
              value={
                sub.paymentMethod
                  ? `${cap(sub.paymentMethod.brand)} ···· ${sub.paymentMethod.last4}`
                  : '—'
              }
            />
            {sub.upcomingInvoice && (
              <Detail
                label="Next invoice"
                value={`${currency(sub.upcomingInvoice.amountDue / 100)} on ${fmtUnix(sub.upcomingInvoice.date)}`}
              />
            )}
          </dl>

          {sub.items && sub.items.length > 1 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs uppercase tracking-wide text-ink-muted">Includes</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {sub.items.map((li, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="text-ink">
                      {li.name}
                      {li.quantity > 1 ? ` × ${li.quantity}` : ''}
                    </span>
                    <span className="tabular-nums text-ink-muted">
                      {currency(li.amount / 100)}
                      {li.interval ? ` / ${li.interval}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sub.cancelAtPeriodEnd && (
            <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
              This subscription is set to cancel at the end of the current period.
            </p>
          )}
        </div>
      )}

      {!hasSubscription && sitePlan === 'single' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-4 py-3">
          <p className="text-sm text-ink-muted">
            Single-location account. Have more than one site? Switch to Multi-Site.
          </p>
          <Button variant="secondary" onClick={upgradeToMulti} disabled={upgrading}>
            {upgrading && <Loader2 className="size-4 animate-spin" />}
            Upgrade to Multi-Site
          </Button>
        </div>
      )}

      {!hasSubscription && (
        <div className="rounded-md border border-border bg-card p-4">
          <StripePricingTable
            // Single-site accounts get the single-location-only table so they
            // can't buy the multi-site plan; multi-site accounts get the full one.
            pricingTableId={sitePlan === 'multi' ? PRICING_TABLE_MULTI : PRICING_TABLE_SINGLE}
            clientReferenceId={account?.id}
            customerEmail={profile?.email}
          />
        </div>
      )}
    </div>
  )
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const fmtUnix = (unix: number) => format(new Date(unix * 1000), 'MMM d, yyyy')

function priceLabel(sub: StripeSubscription): string {
  // Prefer the summed total across all line items (base + add-ons).
  const cents = sub.total ?? sub.unitAmount
  if (cents == null) return '—'
  const amt = currency(cents / 100)
  if (!sub.interval) return amt
  const every = sub.intervalCount > 1 ? `${sub.intervalCount} ` : ''
  return `${amt} / ${every}${sub.interval}`
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-ink">{value || '—'}</dd>
    </div>
  )
}
