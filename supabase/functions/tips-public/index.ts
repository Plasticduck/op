// tips-public — Supabase Edge Function (Deno). Deployed with --no-verify-jwt:
// customers scanning the site's QR code are anonymous.
//
// Tips run as DIRECT CHARGES on each location's own Stripe Connect Express
// account, so the money settles straight into the site's bank account — the
// platform never holds it.
//
// Actions (POST {action, ...}):
//   info     {location_id}                    -> {name, tips_enabled}
//   checkout {location_id, amount_cents}      -> {url}  (Stripe Checkout)
//   record   {location_id, session_id}        -> {ok}   (insert paid session)
//
// Secrets: STRIPE_SECRET_KEY, APP_URL

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

const MIN_CENTS = 100        // $1
const MAX_CENTS = 50_000     // $500 — sanity cap for fat-finger / abuse

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secret) return json({ error: 'no_key' }, 503)
  const appUrl = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  let body: { action?: string; location_id?: string; amount_cents?: number; session_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const { action, location_id } = body
  if (!action || !location_id) return json({ error: 'bad_request' }, 400)

  const { data: loc } = await svc
    .from('locations')
    .select('id, name, account_id, tips_enabled, stripe_connect_account_id, archived')
    .eq('id', location_id)
    .maybeSingle()
  if (!loc || loc.archived) return json({ error: 'not_found' }, 404)

  if (action === 'info') {
    return json({ name: loc.name, tips_enabled: loc.tips_enabled && !!loc.stripe_connect_account_id })
  }

  if (!loc.tips_enabled || !loc.stripe_connect_account_id) {
    return json({ error: 'tips_not_enabled' }, 409)
  }
  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })
  const connectedAccount = { stripeAccount: loc.stripe_connect_account_id }

  if (action === 'checkout') {
    const cents = Math.round(Number(body.amount_cents))
    if (!Number.isFinite(cents) || cents < MIN_CENTS || cents > MAX_CENTS) {
      return json({ error: 'bad_amount', message: 'Tip must be between $1 and $500.' }, 400)
    }
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: cents,
            product_data: { name: `Tip for the crew at ${loc.name}` },
          },
          quantity: 1,
        }],
        payment_intent_data: {
          description: `Tip — ${loc.name}`,
          metadata: { location_id: loc.id, kind: 'tip' },
        },
        metadata: { location_id: loc.id, kind: 'tip' },
        submit_type: 'donate',
        success_url: `${appUrl}/tip/${loc.id}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/tip/${loc.id}`,
      },
      connectedAccount,
    )
    return json({ url: session.url })
  }

  if (action === 'record') {
    const sessionId = body.session_id
    if (!sessionId || !/^cs_/.test(sessionId)) return json({ error: 'bad_request' }, 400)
    const session = await stripe.checkout.sessions.retrieve(sessionId, connectedAccount)
    if (session.payment_status !== 'paid') return json({ ok: false, status: session.payment_status })
    if (session.metadata?.location_id !== loc.id) return json({ error: 'mismatch' }, 400)
    // Idempotent: unique index on stripe_session_id makes replays no-ops.
    await svc.from('tips').upsert({
      account_id: loc.account_id,
      location_id: loc.id,
      amount_cents: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      stripe_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      tipped_at: new Date((session.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    }, { onConflict: 'stripe_session_id', ignoreDuplicates: true })
    return json({ ok: true, amount_cents: session.amount_total })
  }

  return json({ error: 'unknown_action' }, 400)
})
