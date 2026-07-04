import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type Account = Database['public']['Tables']['accounts']['Row']

export type PlanKey = 'single_monthly' | 'single_yearly' | 'multi_monthly'

// Live subscription details fetched from Stripe (via the get-billing-summary
// edge function). `subscription` is null when the account has no Stripe
// subscription yet.
export type StripeSubscription = {
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: number
  quantity: number
  interval: 'day' | 'week' | 'month' | 'year' | null
  intervalCount: number
  unitAmount: number | null
  currency: string
  productName: string | null
  priceNickname: string | null
  paymentMethod: { brand: string; last4: string } | null
  upcomingInvoice: { amountDue: number; date: number } | null
  // All line items (base plan + add-ons) and the summed recurring total (cents).
  items?: {
    name: string
    unitAmount: number | null
    quantity: number
    amount: number
    interval: 'day' | 'week' | 'month' | 'year' | null
  }[]
  total?: number
}
// A checkout price configured in Stripe, resolved live so the plan cards
// reflect real Stripe pricing.
export type StripePlan = {
  key: PlanKey
  priceId: string
  productName: string | null
  unitAmount: number | null
  currency: string
  interval: 'day' | 'week' | 'month' | 'year' | null
  intervalCount: number
}
export type BillingSummary = {
  subscription: StripeSubscription | null
  plans?: StripePlan[]
}

export const billing = {
  account: () => supabase.from('accounts').select('*').single(),
  summary: () => supabase.functions.invoke('get-billing-summary', { body: {} }),
  checkout: (plan: PlanKey) =>
    supabase.functions.invoke('create-checkout-session', { body: { plan } }),
  portal: () => supabase.functions.invoke('create-portal-session', { body: {} }),
}

export const PLANS: { key: PlanKey; name: string; price: string; blurb: string }[] = [
  { key: 'single_monthly', name: 'Single location', price: '$99/mo', blurb: 'One site, billed monthly.' },
  { key: 'single_yearly', name: 'Single location, annual', price: '$990/yr', blurb: 'Two months free.' },
  { key: 'multi_monthly', name: 'Multi-location', price: '$79/loc/mo', blurb: 'Two or more sites.' },
]
