// stripe-webhook — Supabase Edge Function (Deno).
// Stripe → TunnelSync sync. Verifies the signature, then maps subscription
// state onto accounts.{billing_status, plan, subscription_quantity,
// stripe_subscription_id}. Deploy with --no-verify-jwt (Stripe calls it, not a
// logged-in user). Inert (503 'no_key') until secrets are set.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'

const STATUS_MAP: Record<string, 'active' | 'past_due' | 'canceled'> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!secret || !webhookSecret) {
    return new Response(JSON.stringify({ error: 'no_key' }), { status: 503 })
  }

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })
  const sig = req.headers.get('stripe-signature') ?? ''
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch (err) {
    return new Response(`Bad signature: ${(err as Error).message}`, { status: 400 })
  }

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const syncSubscription = async (sub: Stripe.Subscription) => {
    const accountId = (sub.metadata?.account_id as string | undefined) ?? null
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    const quantity = sub.items.data[0]?.quantity ?? 1

    // Reflect the plan tier onto site_plan, which gates adding locations. Match
    // by product name: the Multi-Site product is the only one containing "Multi"
    // (Single Site and the Maintenance add-on do not).
    let sitePlan: 'single' | 'multi' = 'single'
    for (const it of sub.items.data) {
      const pp = it.price?.product
      let name = ''
      if (pp && typeof pp === 'object' && 'name' in pp) {
        name = (pp as { name?: string }).name ?? ''
      } else if (typeof pp === 'string') {
        try {
          name = (await stripe.products.retrieve(pp)).name ?? ''
        } catch {
          name = ''
        }
      }
      if (/multi/i.test(name)) {
        sitePlan = 'multi'
        break
      }
    }

    const patch = {
      billing_status: STATUS_MAP[sub.status] ?? 'canceled',
      plan: quantity > 1 ? 'multi' : 'single',
      site_plan: sitePlan,
      subscription_quantity: quantity,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
    }
    const q = svc.from('accounts').update(patch)
    if (accountId) await q.eq('id', accountId)
    else await q.eq('stripe_customer_id', customerId)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)
        if (!sub.metadata?.account_id && session.client_reference_id) {
          sub.metadata = { ...sub.metadata, account_id: session.client_reference_id }
        }
        await syncSubscription(sub)
      }
      break
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.created':
      await syncSubscription(event.data.object as Stripe.Subscription)
      break
    default:
      break
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
