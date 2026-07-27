// accept-invite — Supabase Edge Function (Deno), public (no JWT).
// Completes an invitation from the accept page. Unlike the old client-side
// signUp + accept_invitation RPC, this handles the case where the invited email
// ALREADY has a login (an earlier signup, or a previously removed profile): it
// sets the password on that login and creates the profile, instead of failing
// and leaving the person with a login but no account. Deploy with --no-verify-jwt.
//
// Body: { token: string, password: string }
// Response: { ok: true } | { ok: true, alreadyMember: true } | { error, message }

import { createClient } from 'npm:@supabase/supabase-js@2'

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
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { token?: string; password?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const token = String(body.token ?? '')
  const password = String(body.password ?? '')
  if (!token) return json({ error: 'bad_request', message: 'Missing invitation token.' }, 400, origin)
  if (password.length < 8) return json({ error: 'bad_request', message: 'Password must be at least 8 characters.' }, 400, origin)

  // Validate the invitation.
  const { data: inv } = await svc
    .from('invitations')
    .select('email, name, status, expires_at, account_id')
    .eq('token', token)
    .maybeSingle()
  if (!inv || inv.status !== 'pending' || new Date(inv.expires_at) < new Date()) {
    return json({ error: 'invalid', message: 'This invitation is invalid, already used, or expired.' }, 400, origin)
  }
  const email = String(inv.email)

  // Resolve or create the auth user for this email.
  const { data: existingId } = await svc.rpc('_auth_user_id_by_email', { p_email: email })
  let userId = (existingId as string | null) ?? null

  if (userId) {
    // If they already have a profile, don't touch their password.
    const { data: prof } = await svc.from('users').select('account_id').eq('id', userId).maybeSingle()
    if (prof) {
      if (prof.account_id !== inv.account_id) {
        return json({ error: 'other_account', message: 'This email already belongs to another account. Sign in with that account instead.' }, 403, origin)
      }
      // Already a member of this account: consume the invite, ask them to sign in.
      await svc.rpc('admin_accept_invitation', { p_token: token, p_user_id: userId, p_user_name: inv.name ?? undefined })
      return json({ ok: true, alreadyMember: true }, 200, origin)
    }
    // Orphaned login (no profile): set the password they just chose.
    const { error } = await svc.auth.admin.updateUserById(userId, { password, email_confirm: true })
    if (error) return json({ error: 'auth_failed', message: error.message }, 500, origin)
  } else {
    const { data: created, error } = await svc.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name: inv.name ?? undefined },
    })
    if (error || !created.user) return json({ error: 'auth_failed', message: error?.message ?? 'Could not create the login.' }, 500, origin)
    userId = created.user.id
  }

  // Create the profile + link roster, mark the invitation accepted.
  const { error: accErr } = await svc.rpc('admin_accept_invitation', { p_token: token, p_user_id: userId, p_user_name: inv.name ?? undefined })
  if (accErr) return json({ error: 'accept_failed', message: accErr.message }, 500, origin)

  return json({ ok: true }, 200, origin)
})
