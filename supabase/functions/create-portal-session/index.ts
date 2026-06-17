// create-portal-session — Supabase Edge Function (Deno).
// Owner opens the Stripe Customer Portal to manage their subscription.
// Inert (503 'no_key') until STRIPE_SECRET_KEY is set.

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
  const { data: profile } = await svc.from('users').select('account_id, role').eq('id', u.user.id).single()
  if (!profile || profile.role !== 'owner') return json({ error: 'forbidden' }, 403)

  const { data: acct } = await svc
    .from('accounts')
    .select('stripe_customer_id')
    .eq('id', profile.account_id)
    .single()
  if (!acct?.stripe_customer_id) return json({ error: 'no_customer', message: 'No subscription yet.' }, 400)

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() })
  const session = await stripe.billingPortal.sessions.create({
    customer: acct.stripe_customer_id,
    return_url: `${appUrl}/app/settings/billing`,
  })

  return json({ url: session.url })
})
