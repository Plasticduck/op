// get-billing-summary — Supabase Edge Function (Deno).
// Returns billing info straight from Stripe so the Billing page reflects real
// Stripe state:
//   - subscription: the account's live subscription (plan, price, quantity,
//     status, renewal, payment method, next invoice), or null.
//   - plans: the configured checkout prices (single monthly/yearly, per-location
//     monthly), resolved live from Stripe so the plan cards show real prices.
// Inert (503 'no_key') until STRIPE_SECRET_KEY is set. Owner-only (checked here).

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'

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

const PLAN_ENV: { key: string; env: string }[] = [
  { key: 'single_monthly', env: 'STRIPE_PRICE_SINGLE_MONTHLY' },
  { key: 'single_yearly', env: 'STRIPE_PRICE_SINGLE_YEARLY' },
  { key: 'multi_monthly', env: 'STRIPE_PRICE_PER_LOCATION_MONTHLY' },
]

async function loadPlans(stripe: Stripe) {
  const plans = []
  for (const p of PLAN_ENV) {
    const priceId = Deno.env.get(p.env)
    if (!priceId) continue
    try {
      const price = await stripe.prices.retrieve(priceId, { expand: ['product'] })
      const product = price.product
      plans.push({
        key: p.key,
        priceId,
        productName:
          product && typeof product === 'object' && 'name' in product ? product.name : null,
        unitAmount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval ?? null,
        intervalCount: price.recurring?.interval_count ?? 1,
      })
    } catch {
      // Skip a price that can't be retrieved (bad id / archived).
    }
  }
  return plans
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
  if (!secret) return json({ error: 'no_key', message: 'Stripe is not configured.' }, 503)

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
    .select('account_id, role')
    .eq('id', u.user.id)
    .single()
  if (!profile || profile.role !== 'owner') return json({ error: 'forbidden' }, 403)

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })

  // Configured plan prices, live from Stripe (independent of any subscription).
  const plans = await loadPlans(stripe)

  const { data: acct } = await svc
    .from('accounts')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('id', profile.account_id)
    .single()

  if (!acct?.stripe_customer_id) return json({ subscription: null, plans })

  // Prefer the known subscription id; otherwise grab the customer's latest.
  // Wrapped so a bad customer id / mode mismatch can't wipe out the plans.
  const expand = ['items.data.price.product', 'default_payment_method']
  let sub: Stripe.Subscription | null = null
  try {
    if (acct.stripe_subscription_id) {
      sub = await stripe.subscriptions.retrieve(acct.stripe_subscription_id, { expand })
    } else {
      const list = await stripe.subscriptions.list({
        customer: acct.stripe_customer_id,
        status: 'all',
        limit: 1,
        expand: expand.map((e) => `data.${e}`),
      })
      sub = list.data[0] ?? null
    }
  } catch {
    sub = null
  }

  if (!sub) return json({ subscription: null, plans })

  // A subscription can have several line items (base plan + add-ons). Build a
  // breakdown and a real total instead of only reading the first item.
  const lineItems = sub.items.data.map((it) => {
    const p = it.price
    const prod = p?.product
    const name =
      prod && typeof prod === 'object' && 'name' in prod
        ? prod.name
        : (p?.nickname ?? 'Item')
    const qty = it.quantity ?? 1
    return {
      name,
      unitAmount: p?.unit_amount ?? null,
      quantity: qty,
      amount: (p?.unit_amount ?? 0) * qty,
      interval: p?.recurring?.interval ?? null,
    }
  })
  const total = lineItems.reduce((s, li) => s + li.amount, 0)

  const item = sub.items.data[0]
  const price = item?.price
  const product = price?.product
  const productName =
    product && typeof product === 'object' && 'name' in product ? product.name : null

  const pm = sub.default_payment_method
  const card =
    pm && typeof pm === 'object' && 'card' in pm && pm.card
      ? { brand: pm.card.brand, last4: pm.card.last4 }
      : null

  let upcoming: { amountDue: number; date: number } | null = null
  try {
    const inv = await stripe.invoices.retrieveUpcoming({ customer: acct.stripe_customer_id })
    upcoming = { amountDue: inv.amount_due, date: inv.next_payment_attempt ?? inv.period_end }
  } catch {
    upcoming = null
  }

  return json({
    subscription: {
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: sub.current_period_end,
      quantity: item?.quantity ?? 1,
      interval: price?.recurring?.interval ?? null,
      intervalCount: price?.recurring?.interval_count ?? 1,
      unitAmount: price?.unit_amount ?? null,
      currency: price?.currency ?? 'usd',
      productName,
      priceNickname: price?.nickname ?? null,
      paymentMethod: card,
      upcomingInvoice: upcoming,
      items: lineItems,
      total,
    },
    plans,
  })
})
