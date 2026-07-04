// billing-upgrade-multi — Supabase Edge Function (Deno).
// Upgrades a subscribed account from the Single-Site plan to the per-site
// Multi-Site plan: swaps the base plan item's price to the multi price and sets
// quantity = the account's active location count, keeping any add-ons (e.g.
// maintenance). Owner-only. Deploy with --no-verify-jwt (auth done here).

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'

const MULTI_PRICE_MONTHLY =
  Deno.env.get('STRIPE_PRICE_MULTI_SITE') ?? 'price_1ToaLIAPyEiCoyu4oH73HTmd'
const MULTI_PRICE_YEARLY =
  Deno.env.get('STRIPE_PRICE_MULTI_SITE_YEARLY') ?? 'price_1ToayPAPyEiCoyu4qwAAUPe4'
const MULTI_MAINT_MONTHLY =
  Deno.env.get('STRIPE_PRICE_MULTI_MAINTENANCE') ?? 'price_1TotbpAPyEiCoyu4SuP2euHT'
const MULTI_MAINT_YEARLY =
  Deno.env.get('STRIPE_PRICE_MULTI_MAINTENANCE_YEARLY') ?? 'price_1TotcNAPyEiCoyu4h2eZYGGc'

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
    .select('account_id, role')
    .eq('id', u.user.id)
    .single()
  if (!profile || profile.role !== 'owner') return json({ error: 'forbidden' }, 403)

  const { data: acct } = await svc
    .from('accounts')
    .select('id, stripe_subscription_id, company_settings')
    .eq('id', profile.account_id)
    .single()
  if (!acct?.stripe_subscription_id) return json({ error: 'no_subscription' }, 400)

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })
  const sub = await stripe.subscriptions.retrieve(acct.stripe_subscription_id, {
    expand: ['items.data.price.product'],
  })

  // Pick the base plan item to swap (the Single-Site item), keeping add-ons.
  const items = sub.items.data
  let base =
    items.find((i) => /single/i.test(productName(i.price?.product))) ??
    items.find(
      (i) =>
        !/maintenance/i.test(productName(i.price?.product)) &&
        !/multi/i.test(productName(i.price?.product)),
    ) ??
    items[0]
  if (!base) return json({ error: 'no_plan_item' }, 400)

  // Preserve the customer's billing interval: yearly single -> yearly multi.
  const targetPrice =
    base.price?.recurring?.interval === 'year' ? MULTI_PRICE_YEARLY : MULTI_PRICE_MONTHLY

  // Active location count = the per-site quantity. Multi-Site is only for
  // accounts with more than one site, so a 1-site account can't switch to it
  // (which would just lower their price without adding a billed location).
  const { count } = await svc
    .from('locations')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', profile.account_id)
    .eq('archived', false)
  const quantity = count ?? 0
  if (quantity < 2) {
    return json(
      { error: 'need_more_sites', message: 'Multi-Site requires more than one location.' },
      400,
    )
  }

  // The maintenance add-on (if present) has its own multi-site per-site price.
  const isYear = base.price?.recurring?.interval === 'year'
  const maint = sub.items.data.find((i) => /maintenance/i.test(productName(i.price?.product)))

  // Remember the single-site prices we're swapping away from, so an automatic
  // downgrade (locations back below 2) can revert to the exact same prices.
  const cs = (acct.company_settings ?? {}) as Record<string, unknown>
  const billingCfg = {
    ...((cs.billing as Record<string, unknown> | undefined) ?? {}),
    priorSinglePrice: base.price?.id ?? null,
    priorInterval: base.price?.recurring?.interval ?? null,
    priorMaintPrice: maint?.price?.id ?? null,
  }

  const updateItems: { id: string; price: string; quantity: number }[] = [
    { id: base.id, price: targetPrice, quantity },
  ]
  if (maint) {
    updateItems.push({
      id: maint.id,
      price: isYear ? MULTI_MAINT_YEARLY : MULTI_MAINT_MONTHLY,
      quantity, // maintenance is also per-site
    })
  }

  await stripe.subscriptions.update(sub.id, {
    items: updateItems,
    proration_behavior: 'create_prorations',
  })

  // Reflect immediately (the webhook will also sync).
  await svc
    .from('accounts')
    .update({
      site_plan: 'multi',
      plan: 'multi',
      subscription_quantity: quantity,
      company_settings: { ...cs, billing: billingCfg },
    })
    .eq('id', profile.account_id)

  return json({ ok: true, quantity })
})
