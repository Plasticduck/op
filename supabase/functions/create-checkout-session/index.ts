// create-checkout-session — Supabase Edge Function (Deno).
// Owner starts a subscription. Creates (or reuses) a Stripe customer for the
// account, then returns a Checkout URL. Inert (503 'no_key') until secrets set.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_SINGLE_MONTHLY,
//   STRIPE_PRICE_SINGLE_YEARLY, STRIPE_PRICE_PER_LOCATION_MONTHLY,
//   APP_URL (e.g. http://localhost:5174)

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
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  // Per-request closure so json() responses carry the right Access-Control-Allow-Origin.
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secret) return json({ error: 'no_key', message: 'Stripe is not configured.' }, 503)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5174'

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await svc.from('users').select('account_id, role, email').eq('id', u.user.id).single()
  if (!profile || profile.role !== 'owner') return json({ error: 'forbidden' }, 403)

  const { plan } = (await req.json().catch(() => ({}))) as { plan?: string }
  const priceMap: Record<string, string | undefined> = {
    single_monthly: Deno.env.get('STRIPE_PRICE_SINGLE_MONTHLY'),
    single_yearly: Deno.env.get('STRIPE_PRICE_SINGLE_YEARLY'),
    multi_monthly: Deno.env.get('STRIPE_PRICE_PER_LOCATION_MONTHLY'),
  }
  const price = priceMap[plan ?? '']
  if (!price) return json({ error: 'invalid_plan' }, 400)

  const { data: acct } = await svc.from('accounts').select('id, name, stripe_customer_id').eq('id', profile.account_id).single()
  const { count: locCount } = await svc
    .from('locations')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', profile.account_id)
    .eq('archived', false)
  const quantity = plan === 'multi_monthly' ? Math.max(2, locCount ?? 1) : 1

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })

  let customerId = acct?.stripe_customer_id ?? null
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: acct?.name ?? undefined,
      email: profile.email,
      metadata: { account_id: profile.account_id },
    })
    customerId = customer.id
    await svc.from('accounts').update({ stripe_customer_id: customerId }).eq('id', profile.account_id)
  }

  // Stripe-side 14-day trial. Card is collected at checkout (default
  // payment_method_collection: 'always') so when the trial ends the first
  // invoice charges cleanly. The trial_settings block tells Stripe to cancel
  // the subscription if no payment method is on file at trial end, which can't
  // actually happen with the default collection mode but is a safety net for
  // future portal-side card removals.
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity }],
    client_reference_id: profile.account_id,
    subscription_data: {
      trial_period_days: 14,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: { account_id: profile.account_id },
    },
    success_url: `${appUrl}/app/settings/billing?checkout=success`,
    cancel_url: `${appUrl}/app/settings/billing?checkout=cancelled`,
  })

  return json({ url: session.url })
})
