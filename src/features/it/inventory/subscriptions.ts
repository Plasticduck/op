import type { ItSubscription } from '@/lib/queries/itInventory'
import { daysUntil, fmtDay, type Tone } from './format'

// Subscription math shared by the list, the asset page and the overview. Same
// rules as the database (it_overview, it_reminder_candidates).

export const CYCLES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Every 3 months' },
  { key: 'annual', label: 'Yearly' },
  { key: 'other', label: 'Other' },
] as const

export const CYCLE_SHORT: Record<string, string> = { monthly: '/mo', quarterly: '/qtr', annual: '/yr' }

// What it costs per month, or null when the cycle is "other" or there's no cost.
export function monthlyCost(s: Pick<ItSubscription, 'cost' | 'billing_cycle'>): number | null {
  if (s.cost == null) return null
  if (s.billing_cycle === 'monthly') return s.cost
  if (s.billing_cycle === 'quarterly') return s.cost / 3
  if (s.billing_cycle === 'annual') return s.cost / 12
  return null
}

// The last day to cancel before it renews by itself, if there's a notice period.
export function cancelBy(s: Pick<ItSubscription, 'renewal_date' | 'auto_renew' | 'cancel_notice_days'>): string | null {
  if (!s.renewal_date || !s.auto_renew || !s.cancel_notice_days) return null
  const d = new Date(s.renewal_date + 'T12:00:00')
  d.setDate(d.getDate() - s.cancel_notice_days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The date that needs action: cancel-by when it renews by itself with notice,
// otherwise the renewal (or end) date.
export function actBy(s: Pick<ItSubscription, 'renewal_date' | 'auto_renew' | 'cancel_notice_days'>): string | null {
  return cancelBy(s) ?? s.renewal_date
}

export const RENEWAL_WINDOW_DAYS = 60

export function renewalBadge(s: Pick<ItSubscription, 'renewal_date' | 'auto_renew' | 'cancel_notice_days'>): { label: string; tone: Tone } | null {
  const due = actBy(s)
  if (!due) return null
  const days = daysUntil(due)
  const cb = cancelBy(s)
  if (cb) {
    if (days < 0) return daysUntil(s.renewal_date!) < 0 ? { label: 'Renewed', tone: 'neutral' } : { label: 'Too late to cancel', tone: 'neutral' }
    if (days <= RENEWAL_WINDOW_DAYS) return { label: days === 0 ? 'Cancel by today' : `Cancel within ${days}d`, tone: days <= 7 ? 'danger' : 'warn' }
    return { label: 'Renews by itself', tone: 'ok' }
  }
  if (days < 0) return { label: s.auto_renew ? 'Renewed' : 'Ended', tone: s.auto_renew ? 'neutral' : 'danger' }
  if (days <= RENEWAL_WINDOW_DAYS) return { label: s.auto_renew ? `Renews in ${days}d` : `Ends in ${days}d`, tone: days <= 7 ? 'danger' : 'warn' }
  return { label: s.auto_renew ? 'Renews by itself' : 'Active', tone: 'ok' }
}

// The next renewal date after this one, one billing cycle on.
export function nextRenewal(s: Pick<ItSubscription, 'renewal_date' | 'billing_cycle'>): string | null {
  if (!s.renewal_date) return null
  const months = s.billing_cycle === 'monthly' ? 1 : s.billing_cycle === 'quarterly' ? 3 : s.billing_cycle === 'annual' ? 12 : 0
  if (!months) return null
  const [y, m, d] = s.renewal_date.split('-').map(Number)
  const next = new Date(y, m - 1 + months, 1)
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(d, last))
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

export const fmtMaybeDay = (d: string | null) => (d ? fmtDay(d) : null)
