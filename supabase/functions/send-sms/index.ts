// send-sms — Supabase Edge Function (Deno). Sends an SMS via Twilio.
// Reusable primitive: other functions (cron/alerts) call it with the service-role
// key; an owner can also call it directly (e.g. a test send).
//
// Secrets (set these in Supabase; the API key never lives in the repo):
//   TWILIO_ACCOUNT_SID          — your account SID, "AC..."
//   TWILIO_API_KEY_SID          — API key SID, "SK..."
//   TWILIO_API_KEY_SECRET       — API key secret (shown once)
//   and ONE sender:
//   TWILIO_MESSAGING_SERVICE_SID — "MG..." (preferred; handles 10DLC + number pool)
//   or TWILIO_FROM              — a Twilio number in E.164, e.g. +18065551234
//
// Body: { to: "+1XXXXXXXXXX", body: "message text" }
// Auth: service-role (internal callers) or an account owner.

import { createClient } from 'npm:@supabase/supabase-js@2'
// deno-lint-ignore no-explicit-any
type Any = any

const ALLOWED_ORIGINS = new Set<string>(['https://operator.washlyfe.com', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return { 'Access-Control-Allow-Origin': allow, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: service-role (internal callers) or an account owner.
  const auth = req.headers.get('Authorization') ?? ''
  if (jwtRole(auth) !== 'service_role') {
    if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (!p || (p as Any).role !== 'owner') return json({ error: 'forbidden' }, 403, origin)
  }

  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const keySid = Deno.env.get('TWILIO_API_KEY_SID')
  const keySecret = Deno.env.get('TWILIO_API_KEY_SECRET')
  const from = Deno.env.get('TWILIO_FROM')
  const messagingServiceSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')
  if (!accountSid || !keySid || !keySecret || (!from && !messagingServiceSid)) {
    return json({ error: 'no_key', message: 'Twilio is not fully configured. Need TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, and TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID.' }, 503, origin)
  }

  let payload: { to?: string; body?: string } = {}
  try { payload = await req.json() } catch { /* */ }
  const to = String(payload.to ?? '').trim()
  const text = String(payload.body ?? '').trim()
  if (!/^\+\d{8,15}$/.test(to)) return json({ error: 'bad_request', message: 'to must be an E.164 number, e.g. +18065551234.' }, 400, origin)
  if (!text) return json({ error: 'bad_request', message: 'body (message text) is required.' }, 400, origin)

  // Twilio Messages API, authenticated with the API key (SID:secret) Basic auth.
  const form = new URLSearchParams()
  form.set('To', to)
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid)
  else form.set('From', from as string)
  form.set('Body', text)

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${keySid}:${keySecret}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  const data = (await res.json().catch(() => null)) as Any
  if (!res.ok) {
    return json({ error: 'twilio_error', status: res.status, code: data?.code, message: data?.message ?? 'Twilio send failed.' }, 502, origin)
  }
  return json({ ok: true, sid: data?.sid, status: data?.status, to: data?.to }, 200, origin)
})
