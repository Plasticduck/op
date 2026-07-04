// send-invite-email — Supabase Edge Function (Deno).
// Emails a freshly created team invitation to the invitee with a secure link to
// set their password and join. The invitation row is written client-side; this
// function is a best-effort side-effect, so a missing Resend key just returns
// 503 { error: 'no_key' } and the caller keeps the invite (the link is still
// copyable from the Pending invitations list).
//
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM, APP_URL.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  technician: 'Technician',
  employee: 'Employee',
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    return json({ error: 'no_key', message: 'Email is not configured.' }, 503, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const appUrl = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'
  const fromAddr =
    Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@operator.washlyfe.com>'

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const callerId = u.user?.id
  if (!callerId) return json({ error: 'unauthorized' }, 401, origin)

  let body: { invitation_id?: string } = {}
  try { body = await req.json() } catch { /* allow empty */ }
  const invitationId = body.invitation_id
  if (!invitationId || typeof invitationId !== 'string') {
    return json({ error: 'bad_request' }, 400, origin)
  }

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Only owners/managers of the same account may trigger the invite email.
  const { data: caller } = await svc
    .from('users')
    .select('account_id, role, name')
    .eq('id', callerId)
    .maybeSingle()
  if (!caller || (caller.role !== 'owner' && caller.role !== 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }

  const { data: invite } = await svc
    .from('invitations')
    .select('id, email, role, token, account_id, status, expires_at')
    .eq('id', invitationId)
    .maybeSingle()
  if (!invite || invite.account_id !== caller.account_id) {
    return json({ error: 'not_found' }, 404, origin)
  }

  const { data: account } = await svc
    .from('accounts')
    .select('name')
    .eq('id', invite.account_id)
    .maybeSingle()

  const company = account?.name?.trim() || 'your team'
  const inviterName = caller.name?.trim() || 'A teammate'
  const roleLabel = ROLE_LABEL[invite.role] ?? 'team member'
  const inviteLink = `${appUrl}/invite/${invite.token}`

  const subject = `${inviterName} invited you to join ${company} on WashLyfe Operator`
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">You're invited to WashLyfe Operator</h2>
      <p style="margin:0 0 16px;">${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(company)}</strong> as a <strong>${escapeHtml(roleLabel)}</strong>.</p>
      <p style="margin:0 0 24px;">Click below to set your password and get started. This link expires in 72 hours.</p>
      <p style="margin:0 0 24px;">
        <a href="${inviteLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;">Accept invitation</a>
      </p>
      <p style="margin:0 0 8px;color:#666;font-size:13px;">Or paste this link into your browser:</p>
      <p style="margin:0 0 24px;word-break:break-all;"><a href="${inviteLink}" style="color:#2563eb;font-size:13px;">${escapeHtml(inviteLink)}</a></p>
      <p style="margin:0;color:#888;font-size:12px;">If you weren't expecting this invitation, you can ignore this email.</p>
    </div>
  `

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: [invite.email],
      subject,
      html,
    })
    if (error) {
      const msg = (error as { message?: string }).message ?? 'send_failed'
      return json({ ok: false, error: msg }, 502, origin)
    }
    return json({ ok: true }, 200, origin)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'send_failed'
    return json({ ok: false, error: msg }, 502, origin)
  }
})
