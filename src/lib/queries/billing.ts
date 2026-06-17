import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type Account = Database['public']['Tables']['accounts']['Row']

export type PlanKey = 'single_monthly' | 'single_yearly' | 'multi_monthly'

export const billing = {
  account: () => supabase.from('accounts').select('*').single(),
  checkout: (plan: PlanKey) =>
    supabase.functions.invoke('create-checkout-session', { body: { plan } }),
  portal: () => supabase.functions.invoke('create-portal-session', { body: {} }),
}

export const PLANS: { key: PlanKey; name: string; price: string; blurb: string }[] = [
  { key: 'single_monthly', name: 'Single location', price: '$99/mo', blurb: 'One site, billed monthly.' },
  { key: 'single_yearly', name: 'Single location, annual', price: '$990/yr', blurb: 'Two months free.' },
  { key: 'multi_monthly', name: 'Multi-location', price: '$79/loc/mo', blurb: 'Two or more sites.' },
]
