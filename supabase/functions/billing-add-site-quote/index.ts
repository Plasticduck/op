// billing-add-site-quote — Supabase Edge Function (Deno).
// Returns the per-site Multi-Site price (monthly + yearly) and the account's
// current billing interval, so the app can show an accurate "you're agreeing to
// $X per site" confirmation before adding a location. Any account member may
// call it (read-only). Deploy with --no-verify-jwt (auth done here).

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'

const MULTI_PRICE_MONTHLY =
  Deno.env.get('STRIPE_PRICE_MULTI_SITE') ?? 'price_1ToaLIAPyEiCoyu4oH73HTmd'
const MULTI_PRICE_YEARLY =
  Deno.env.get('STRIPE_PRICE_MULTI_SITE_YEARLY') ?? 'price_1ToayPAPyEiCoyu4qwAAUPe4'

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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secret) return json({ error: 'no_key' }, 503)

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
    .select('stripe_subscription_id')
    .eq('id', profile.account_id)
    .single()

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })

  const [m, y] = await Promise.all([
    stripe.prices.retrieve(MULTI_PRICE_MONTHLY).catch(() => null),
    stripe.prices.retrieve(MULTI_PRICE_YEARLY).catch(() => null),
  ])

  // The account's current billing interval (from its subscription, if any).
  let interval: 'month' | 'year' | null = null
  const hasSubscription = !!acct?.stripe_subscription_id
  if (acct?.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(acct.stripe_subscription_id)
      const iv = sub.items.data[0]?.price?.recurring?.interval
      if (iv === 'month' || iv === 'year') interval = iv
    } catch {
      interval = null
    }
  }

  return json({
    perSiteMonthly: m?.unit_amount ?? null,
    perSiteYearly: y?.unit_amount ?? null,
    currency: m?.currency ?? y?.currency ?? 'usd',
    interval,
    hasSubscription,
  })
})
