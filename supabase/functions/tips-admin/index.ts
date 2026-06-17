// tips-admin — Supabase Edge Function (Deno). JWT-verified, manager+ only.
//
// Actions (POST {action, location_id, ...}):
//   onboard   -> create the location's Stripe Connect Express account (if
//                missing) and return an onboarding link. The site owner
//                completes bank details on Stripe; money settles with them.
//   status    -> re-check the connected account; when charges are enabled,
//                flip locations.tips_enabled on and return {ready: true}.
//   reconcile {from, to} -> pull paid Checkout Sessions from the connected
//                account for the window and upsert any missing tips rows
//                (covers customers who paid but never hit the thanks page).
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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secret) return json({ error: 'no_key' }, 503)
  const appUrl = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Caller must be a signed-in manager/owner with access to the location.
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const uid = u.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await svc.from('users').select('account_id, role, location_ids').eq('id', uid).single()
  if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: { action?: string; location_id?: string; from?: string; to?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const { action, location_id } = body
  if (!action || !location_id) return json({ error: 'bad_request' }, 400)

  const { data: loc } = await svc
    .from('locations')
    .select('id, name, account_id, tips_enabled, stripe_connect_account_id')
    .eq('id', location_id)
    .maybeSingle()
  if (!loc || loc.account_id !== profile.account_id) return json({ error: 'not_found' }, 404)
  if (profile.role !== 'owner' && !(profile.location_ids ?? []).includes(loc.id)) {
    return json({ error: 'forbidden' }, 403)
  }

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })

  if (action === 'onboard') {
    let acctId = loc.stripe_connect_account_id
    if (!acctId) {
      try {
        // Minimal prefill: the site owner picks business type, bank details,
        // etc. during Stripe's hosted onboarding. Less prefill = fewer
        // live-mode validation failure modes.
        const acct = await stripe.accounts.create({
          type: 'express',
          metadata: { location_id: loc.id, account_id: loc.account_id },
          business_profile: { name: loc.name, product_description: 'Car wash customer tips' },
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        })
        acctId = acct.id
        await svc.from('locations').update({ stripe_connect_account_id: acctId }).eq('id', loc.id)
      } catch (e) {
        // Most common live-mode failure: Connect isn't activated on the
        // platform account yet. Surface Stripe's message so the owner knows
        // what to fix in the Stripe Dashboard.
        return json({ error: 'connect_unavailable', message: (e as Error).message }, 502)
      }
    }
    const link = await stripe.accountLinks.create({
      account: acctId,
      type: 'account_onboarding',
      refresh_url: `${appUrl}/app/tips?onboard=refresh`,
      return_url: `${appUrl}/app/tips?onboard=done`,
    })
    return json({ url: link.url })
  }

  if (action === 'status') {
    if (!loc.stripe_connect_account_id) return json({ ready: false, reason: 'no_account' })
    const acct = await stripe.accounts.retrieve(loc.stripe_connect_account_id)
    const ready = !!acct.charges_enabled
    if (ready && !loc.tips_enabled) {
      await svc.from('locations').update({ tips_enabled: true }).eq('id', loc.id)
    }
    return json({
      ready,
      details_submitted: !!acct.details_submitted,
      payouts_enabled: !!acct.payouts_enabled,
    })
  }

  if (action === 'reconcile') {
    if (!loc.stripe_connect_account_id) return json({ ok: true, found: 0 })
    const from = body.from ? Math.floor(new Date(body.from).getTime() / 1000) : Math.floor(Date.now() / 1000) - 7 * 86400
    const to = body.to ? Math.floor(new Date(body.to).getTime() / 1000) : Math.floor(Date.now() / 1000)
    const connected = { stripeAccount: loc.stripe_connect_account_id }
    let found = 0
    let startingAfter: string | undefined
    // Two pages max (200 sessions) — far beyond a day of tips at one site.
    for (let page = 0; page < 2; page++) {
      const res = await stripe.checkout.sessions.list(
        { created: { gte: from, lte: to }, limit: 100, starting_after: startingAfter },
        connected,
      )
      for (const s of res.data) {
        if (s.payment_status !== 'paid') continue
        if (s.metadata?.kind !== 'tip') continue
        await svc.from('tips').upsert({
          account_id: loc.account_id,
          location_id: loc.id,
          amount_cents: s.amount_total ?? 0,
          currency: s.currency ?? 'usd',
          stripe_session_id: s.id,
          stripe_payment_intent_id: typeof s.payment_intent === 'string' ? s.payment_intent : null,
          tipped_at: new Date(s.created * 1000).toISOString(),
        }, { onConflict: 'stripe_session_id', ignoreDuplicates: true })
        found++
      }
      if (!res.has_more) break
      startingAfter = res.data[res.data.length - 1]?.id
    }
    return json({ ok: true, found })
  }

  return json({ error: 'unknown_action' }, 400)
})
