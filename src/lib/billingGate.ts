import type { Account } from '@/lib/queries/billing'

// Single source of truth for "is this account allowed to use the app?"
//
// Locked when:
//   - trial: the free trial's end date has passed
//   - canceled: subscription was canceled
//   - past_due: a payment failed
// Never locked when:
//   - is_demo: the public demo account always works
//   - active: paid or comped (e.g. a granted plan with no Stripe subscription)
//   - trial that hasn't expired yet
//
// Client-side gate: it blocks the entire app UI, which is the product intent
// (force plan selection). Data stays RLS-protected regardless.

export type LockReason = 'trial_expired' | 'canceled' | 'past_due'

export type LockState =
  | { locked: false }
  | { locked: true; reason: LockReason }

export function accountLockState(account: Pick<Account, 'billing_status' | 'trial_ends_at' | 'is_demo'> | null): LockState {
  if (!account) return { locked: false }
  if (account.is_demo) return { locked: false }

  switch (account.billing_status) {
    case 'active':
      return { locked: false }
    case 'canceled':
      return { locked: true, reason: 'canceled' }
    case 'past_due':
      return { locked: true, reason: 'past_due' }
    case 'trial': {
      const ends = account.trial_ends_at ? new Date(account.trial_ends_at).getTime() : null
      if (ends != null && ends < Date.now()) return { locked: true, reason: 'trial_expired' }
      return { locked: false }
    }
    default:
      return { locked: false }
  }
}

export const LOCK_COPY: Record<LockReason, { title: string; body: string }> = {
  trial_expired: {
    title: 'Your free trial has ended',
    body: 'Choose a plan to restore full access to your account, or contact us for custom pricing.',
  },
  canceled: {
    title: 'Your subscription was canceled',
    body: 'Pick a plan to reactivate your account, or contact us for custom pricing.',
  },
  past_due: {
    title: 'Your payment is past due',
    body: 'Update your plan to restore access, or contact us if you need a hand.',
  },
}
