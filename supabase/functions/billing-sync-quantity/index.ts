// billing-sync-quantity — Supabase Edge Function (Deno).
// Keeps a per-site Multi-Site subscription's quantity in sync with the account's
// active location count. Called after locations are added/removed. No-op unless
// the account has a subscription with a Multi-Site item. Any account member may
// call it (it only reconciles quantity to the true site count). Deploy with
// --no-verify-jwt (auth done here).

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'

const MULTI_PRICES = new Set([
  Deno.env.get('STRIPE_PRICE_MULTI_SITE') ?? 'price_1ToaLIAPyEiCoyu4oH73HTmd',
  Deno.env.get('STRIPE_PRICE_MULTI_SITE_YEARLY') ?? 'price_1ToayPAPyEiCoyu4qwAAUPe4',
])

// Single-Site prices to revert to when dropping below 2 sites (fallback when
// the original price wasn't recorded).
const SINGLE_MONTHLY = Deno.env.get('STRIPE_PRICE_SINGLE_MONTHLY') ?? ''
const SINGLE_YEARLY = Deno.env.get('STRIPE_PRICE_SINGLE_YEARLY') ?? ''

const ALLOWED_ORIGINS = new Set<string>([
  'https://operator.washlyfe.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return {
    'Access-Control-Allow-Origin': allow,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function productName(pp: unknown): string {
  if (pp && typeof pp === 'object' && 'name' in pp) return (pp as { name?: string }).name ?? ''
  return ''
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secret) return json({ ok: true, skipped: 'no_key' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await svc
    .from('users')
    .select('account_id')
    .eq('id', u.user.id)
    .single()
  if (!profile) return json({ error: 'no_profile' }, 400)

  const { data: acct } = await svc
    .from('accounts')
    .select('id, stripe_subscription_id, company_settings')
    .eq('id', profile.account_id)
    .single()
  // Active site count drives everything.
  const { count } = await svc
    .from('locations')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', profile.account_id)
    .eq('archived', false)
  const active = count ?? 0

  // Trial / no subscription: just keep site_plan honest.
  if (!acct?.stripe_subscription_id) {
    const desired = active >= 2 ? 'multi' : 'single'
    await svc.from('accounts').update({ site_plan: desired }).eq('id', profile.account_id)
    return json({ ok: true, noSub: true, sitePlan: desired })
  }

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })
  const sub = await stripe.subscriptions.retrieve(acct.stripe_subscription_id, {
    expand: ['items.data.price.product'],
  })

  // The plan item is the non-add-on item (the add-on is "Maintenance").
  const planItem =
    sub.items.data.find((i) => !/maintenance/i.test(productName(i.price?.product))) ??
    sub.items.data[0]
  if (!planItem) return json({ ok: true, skipped: 'no_plan_item' })

  const onMulti =
    (planItem.price?.id && MULTI_PRICES.has(planItem.price.id)) ||
    /multi/i.test(productName(planItem.price?.product))
  const interval = planItem.price?.recurring?.interval

  if (active >= 2) {
    // Keep the per-site quantity in sync (only when already on the multi plan).
    if (onMulti && (planItem.quantity ?? 1) !== active) {
      try {
        await stripe.subscriptions.update(sub.id, {
          items: [{ id: planItem.id, quantity: active }],
          proration_behavior: 'create_prorations',
        })
      } catch {
        /* best effort */
      }
    }
    await svc
      .from('accounts')
      .update({ site_plan: 'multi', plan: 'multi', subscription_quantity: active })
      .eq('id', profile.account_id)
    return json({ ok: true, sitePlan: 'multi', quantity: active })
  }

  // Below 2 sites: revert to Single-Site. Prefer the exact price we upgraded
  // from; fall back to the env single price for the interval. The Stripe swap is
  // best-effort — the app always moves to single so the account isn't stuck.
  if (onMulti) {
    const billingCfg = ((acct.company_settings ?? {}) as Record<string, unknown>).billing as
      | { priorSinglePrice?: string | null; priorInterval?: string | null }
      | undefined
    const fallback = interval === 'year' ? SINGLE_YEARLY : SINGLE_MONTHLY
    const singlePrice =
      (billingCfg?.priorInterval === interval ? billingCfg?.priorSinglePrice : null) ||
      billingCfg?.priorSinglePrice ||
      fallback
    if (singlePrice) {
      try {
        await stripe.subscriptions.update(sub.id, {
          items: [{ id: planItem.id, price: singlePrice, quantity: 1 }],
          proration_behavior: 'create_prorations',
        })
      } catch {
        /* price swap failed (e.g. archived); app still moves to single below */
      }
    }
  }
  await svc
    .from('accounts')
    .update({ site_plan: 'single', plan: 'single', subscription_quantity: 1 })
    .eq('id', profile.account_id)
  return json({ ok: true, sitePlan: 'single' })
})
