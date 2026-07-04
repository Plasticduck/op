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
  if (!acct?.stripe_subscription_id) return json({ ok: true, skipped: 'no_subscription' })

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })
  const sub = await stripe.subscriptions.retrieve(acct.stripe_subscription_id, {
    expand: ['items.data.price.product'],
  })

  // Find the per-site Multi-Site item (by price id, or product name fallback).
  const item = sub.items.data.find(
    (i) =>
      (i.price?.id && MULTI_PRICES.has(i.price.id)) ||
      /multi/i.test(productName(i.price?.product)),
  )
  if (!item) return json({ ok: true, skipped: 'not_multi' })

  const { count } = await svc
    .from('locations')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', profile.account_id)
    .eq('archived', false)
  const active = count ?? 0

  // Below 2 sites: revert to the Single-Site plan (per-site multi no longer
  // applies). Prefer the exact price we upgraded from; fall back to the env
  // single price matching the current interval.
  if (active < 2) {
    const interval = item.price?.recurring?.interval
    const billingCfg = ((acct.company_settings ?? {}) as Record<string, unknown>).billing as
      | { priorSinglePrice?: string | null; priorInterval?: string | null }
      | undefined
    const fallback = interval === 'year' ? SINGLE_YEARLY : SINGLE_MONTHLY
    const singlePrice =
      (billingCfg?.priorInterval === interval ? billingCfg?.priorSinglePrice : null) ||
      billingCfg?.priorSinglePrice ||
      fallback

    if (singlePrice) {
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: singlePrice, quantity: 1 }],
        proration_behavior: 'create_prorations',
      })
      await svc
        .from('accounts')
        .update({ site_plan: 'single', plan: 'single', subscription_quantity: 1 })
        .eq('id', profile.account_id)
      return json({ ok: true, downgraded: true })
    }
    // No single price available to revert to; leave as-is.
    return json({ ok: true, skipped: 'no_single_price' })
  }

  const quantity = active
  if ((item.quantity ?? 1) !== quantity) {
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, quantity }],
      proration_behavior: 'create_prorations',
    })
    await svc
      .from('accounts')
      .update({ subscription_quantity: quantity })
      .eq('id', profile.account_id)
  }

  return json({ ok: true, quantity })
})
