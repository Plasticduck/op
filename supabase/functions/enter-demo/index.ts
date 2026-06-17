// enter-demo — Supabase Edge Function (Deno).
// Replaces the previous flow that hardcoded the demo account's password in the
// client bundle (anyone could grep the deployed JS and log in directly). The
// new flow:
//   1) Visitor submits the demo form (name/email/phone) → `demo_requests` row +
//      magic-link sent to their email.
//   2) They click the link, Supabase signs them in as themselves.
//   3) /demo/access calls this function with their JWT and the lead id.
//   4) We verify the JWT's email matches the lead, then service-role mints a
//      one-time magic-link verify URL for the demo account and returns it.
//   5) The client navigates to that URL → Supabase swaps in the demo session.
// The demo password never leaves the server (it lives only as a project secret).
//
// Two entry modes:
//   { lead }            initial entry — caller's JWT email must match the lead's
//                       email; target = DEMO_OWNER_EMAIL
//   { role }            in-app role switch — caller must already be signed into
//                       one of the demo emails; target = the requested role's
//                       demo email
//
// Required secrets:
//   DEMO_OWNER_EMAIL      (default: owner@demo.washlyfe.com)
//   DEMO_MANAGER_EMAIL    (default: manager@demo.washlyfe.com)
//   DEMO_EMPLOYEE_EMAIL   (default: employee@demo.washlyfe.com)
//   APP_URL               public origin to land on after sign-in (e.g. https://operator.washlyfe.com)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Browser fetches come from these origins; anything else is rejected at the
// CORS layer. JWT validation below is still the real auth gate.
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

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const demoByRole: Record<'owner' | 'manager' | 'employee', string> = {
    owner: Deno.env.get('DEMO_OWNER_EMAIL') ?? 'owner@demo.washlyfe.com',
    manager: Deno.env.get('DEMO_MANAGER_EMAIL') ?? 'manager@demo.washlyfe.com',
    employee: Deno.env.get('DEMO_EMPLOYEE_EMAIL') ?? 'employee@demo.washlyfe.com',
  }
  const demoEmails = new Set(Object.values(demoByRole).map((e) => e.toLowerCase()))
  const appUrl = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'

  // The caller must already be authenticated via either their own magic link
  // (initial entry) or the current demo session (role switch).
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const callerEmail = u.user?.email?.toLowerCase()
  if (!callerEmail) return json({ error: 'unauthorized' }, 401, origin)

  let body: { lead?: string; role?: 'owner' | 'manager' | 'employee' } = {}
  try { body = await req.json() } catch { /* allow empty */ }

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let targetEmail: string | null = null

  if (body.role) {
    // Role switch: caller must already be on one of the demo accounts.
    if (!demoEmails.has(callerEmail)) return json({ error: 'forbidden' }, 403, origin)
    targetEmail = demoByRole[body.role] ?? null
    if (!targetEmail) return json({ error: 'bad_request' }, 400, origin)
  } else if (body.lead) {
    // Initial entry: lead must exist AND its email must match the caller's JWT
    // email so a visitor with a valid magic-link session for ANY email can't
    // ride someone else's lead id into the demo.
    if (typeof body.lead !== 'string' || body.lead.length > 64) {
      return json({ error: 'bad_request' }, 400, origin)
    }
    const { data: row } = await svc
      .from('demo_requests')
      .select('email')
      .eq('id', body.lead)
      .maybeSingle()
    if (!row || row.email.toLowerCase() !== callerEmail) {
      return json({ error: 'forbidden' }, 403, origin)
    }
    targetEmail = demoByRole.owner
  } else {
    return json({ error: 'bad_request' }, 400, origin)
  }

  // Mint a one-time magic-link verify URL for the target demo email. Navigating
  // to it replaces the visitor's session with the target's session — the demo
  // password never leaves the server.
  // deno-lint-ignore no-explicit-any
  const { data: link, error } = await (svc.auth.admin as any).generateLink({
    type: 'magiclink',
    email: targetEmail,
    options: { redirectTo: `${appUrl}/app/dashboard` },
  })
  if (error || !link?.properties?.action_link) {
    return json({ error: 'demo_unavailable' }, 500, origin)
  }

  return json({ url: link.properties.action_link }, 200, origin)
})
