// sms-optin — Supabase Edge Function (Deno). PUBLIC (verify_jwt = false).
// Backs the /text-alerts/:token page that the opt-in invite email links to.
// The token in the link is the only credential: it identifies one user and can
// only read/change that user's mobile number and SMS opt-in, until it expires.
//
// Body: { action: 'info' | 'save' | 'optout', token, phone?, consent? }

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

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// US mobile numbers only, stored as E.164 like the signup flow does.
function toE164(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (d.length !== 10 || d[0] === '0' || d[0] === '1') return null
  return '+1' + d
}

// Only the last four digits ever leave the server, in case a link is forwarded.
const maskPhone = (p: string | null) => (p ? `(•••) •••-${p.slice(-4)}` : null)

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin)

  let body: { action?: string; token?: string; phone?: string; consent?: boolean } = {}
  try { body = await req.json() } catch { /* handled below */ }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token || token.length < 20) return json({ error: 'invalid_link', message: 'This link is not valid.' }, 400, origin)

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: link } = await svc
    .from('sms_optin_tokens')
    .select('token_hash, user_id, expires_at')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle()
  if (!link) return json({ error: 'invalid_link', message: 'This link is not valid.' }, 404, origin)
  if (new Date(link.expires_at).getTime() < Date.now()) {
    return json({ error: 'expired', message: 'This link has expired. Ask your admin to send a new one.' }, 410, origin)
  }

  const { data: user } = await svc
    .from('users')
    .select('id, name, phone, sms_opt_in')
    .eq('id', link.user_id)
    .maybeSingle()
  if (!user) return json({ error: 'invalid_link', message: 'This link is not valid.' }, 404, origin)

  const firstName = String(user.name ?? '').trim().split(/\s+/)[0] || null

  if (body.action === 'info') {
    return json({ first_name: firstName, phone_masked: maskPhone(user.phone), opted_in: !!user.sms_opt_in }, 200, origin)
  }

  if (body.action === 'save') {
    if (body.consent !== true) {
      return json({ error: 'consent_required', message: 'Check the box to agree to receive text alerts.' }, 400, origin)
    }
    const phone = toE164(String(body.phone ?? ''))
    if (!phone) return json({ error: 'bad_phone', message: 'Enter a 10-digit US mobile number.' }, 400, origin)
    const { error } = await svc
      .from('users')
      .update({ phone, sms_opt_in: true, sms_opt_in_at: new Date().toISOString(), sms_opt_in_source: 'email_link' })
      .eq('id', user.id)
    if (error) return json({ error: 'save_failed', message: 'Could not save. Please try again.' }, 500, origin)
    // The link stays usable until it expires so a typo can be corrected.
    await svc.from('sms_optin_tokens').update({ used_at: new Date().toISOString() }).eq('token_hash', link.token_hash)
    return json({ first_name: firstName, phone_masked: maskPhone(phone), opted_in: true }, 200, origin)
  }

  if (body.action === 'optout') {
    const { error } = await svc.from('users').update({ sms_opt_in: false }).eq('id', user.id)
    if (error) return json({ error: 'save_failed', message: 'Could not save. Please try again.' }, 500, origin)
    return json({ first_name: firstName, phone_masked: maskPhone(user.phone), opted_in: false }, 200, origin)
  }

  return json({ error: 'bad_request', message: 'Unknown action.' }, 400, origin)
})
