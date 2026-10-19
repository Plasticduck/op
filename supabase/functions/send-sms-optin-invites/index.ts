// send-sms-optin-invites — Supabase Edge Function (Deno).
// Emails existing users a personal link to opt in to SMS alerts. Each link
// (/text-alerts/:token, handled by the sms-optin function) works without a login
// and expires after 7 days. The email itself is not consent; consent is the
// checkbox on the linked page.
//
// Body:
//   { account_id, mode: 'dry_run' }             list who would be invited, send nothing
//   { account_id, mode: 'send', exclude_emails } invite everyone not yet opted in
//   { mode: 'test', user_id }                    invite one user regardless of opt-in;
//                                                 returns the link so it can be checked
// Users invited in the last 3 days are skipped in 'send' mode, so a repeated run
// can't double-email anyone.
//
// Auth: service role or an account owner. Secrets: RESEND_API_KEY (required),
// RESEND_FROM, APP_URL (optional).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

const LINK_DAYS = 7
const REINVITE_COOLDOWN_DAYS = 3

const json = (b: unknown, s: number) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function emailHtml(firstName: string, email: string, link: string, appUrl: string): string {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:20px 20px 8px;color:#0f172a;">
    <img src="${appUrl}/mighty-max-in-flight.png" alt="Mighty Wash" width="135" style="display:block;border:0;width:135px;height:auto;margin-bottom:18px;">
    <div style="font-size:20px;font-weight:700;margin-bottom:12px;">Get important alerts by text</div>
    <p style="font-size:15px;line-height:1.55;margin:0 0 12px;">Hi ${esc(firstName)},</p>
    <p style="font-size:15px;line-height:1.55;margin:0 0 12px;">Operator can now text you the alerts that need your attention, like approvals waiting on you, labor alerts for your sites, and account or security notices.</p>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px;">Text alerts are optional. To turn them on, add your mobile number and agree to receive texts. It takes less than a minute, and you don't need to log in.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 20px;"><tr><td style="background:#2563eb;border-radius:8px;">
      <a href="${link}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Turn on text alerts</a>
    </td></tr></table>
    <p style="font-size:13px;line-height:1.55;color:#475569;margin:0 0 18px;">This link is personal to you and expires in ${LINK_DAYS} days. You can turn text alerts off anytime by replying STOP to any text.</p>
    <div style="border-top:1px solid #e2e8f0;padding-top:12px;font-size:11px;line-height:1.6;color:#94a3b8;">
      Message frequency varies. Message &amp; data rates may apply. Reply STOP to opt out, HELP for help.
      <a href="${appUrl}/mighty-wash/sms-privacy" style="color:#94a3b8;">SMS Privacy Policy</a> &middot;
      <a href="${appUrl}/mighty-wash/sms-terms" style="color:#94a3b8;">SMS Terms</a><br>
      Sent from WashLyfe Operator to ${esc(email)}.
    </div>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key', message: 'RESEND_API_KEY is not configured.' }, 503)

  const url = Deno.env.get('SUPABASE_URL')!
  const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: { mode?: string; account_id?: string; user_id?: string; exclude_emails?: string[] } = {}
  try { body = await req.json() } catch { /* empty */ }

  // Auth: service role (CLI/cron) or an owner, who is limited to their own account.
  const auth = req.headers.get('Authorization') ?? ''
  let accountId = typeof body.account_id === 'string' ? body.account_id : ''
  if (jwtRole(auth) !== 'service_role') {
    const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: u } = await uc.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden' }, 403)
    accountId = p.account_id
  }

  const mode = body.mode
  type Recipient = { id: string; email: string; name: string | null; account_id: string }
  let recipients: Recipient[] = []

  if (mode === 'test') {
    if (!body.user_id) return json({ error: 'bad_request', message: 'user_id is required for test mode.' }, 400)
    const { data } = await svc.from('users').select('id, email, name, account_id').eq('id', body.user_id).maybeSingle()
    if (!data?.email) return json({ error: 'not_found' }, 404)
    if (accountId && data.account_id !== accountId) return json({ error: 'forbidden' }, 403)
    recipients = [data as Recipient]
  } else if (mode === 'dry_run' || mode === 'send') {
    if (!accountId) return json({ error: 'bad_request', message: 'account_id is required.' }, 400)
    const exclude = new Set((body.exclude_emails ?? []).map((e) => e.trim().toLowerCase()))
    const { data: users } = await svc
      .from('users')
      .select('id, email, name, account_id')
      .eq('account_id', accountId)
      .eq('sms_opt_in', false)
      .not('email', 'is', null)
      .order('email')
    const since = new Date(Date.now() - REINVITE_COOLDOWN_DAYS * 86_400_000).toISOString()
    const { data: recent } = await svc.from('sms_optin_tokens').select('user_id').eq('account_id', accountId).gte('created_at', since)
    const recentlyInvited = new Set((recent ?? []).map((r) => r.user_id))
    recipients = ((users ?? []) as Recipient[]).filter((u) => !exclude.has(u.email.toLowerCase()) && !recentlyInvited.has(u.id))
    if (mode === 'dry_run') {
      return json({ count: recipients.length, recipients: recipients.map((r) => r.email), skipped_recently_invited: recentlyInvited.size }, 200)
    }
  } else {
    return json({ error: 'bad_request', message: "mode must be 'dry_run', 'send', or 'test'." }, 400)
  }

  const appUrl = (Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com').replace(/\/$/, '')
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const resend = new Resend(resendKey)
  const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString()

  const sent: string[] = []
  const failed: Array<{ email: string; error: string }> = []
  let testLink: string | null = null

  for (const r of recipients) {
    const token = newToken()
    const tokenHash = await sha256Hex(token)
    const { error: insErr } = await svc
      .from('sms_optin_tokens')
      .insert({ token_hash: tokenHash, user_id: r.id, account_id: r.account_id, expires_at: expiresAt })
    if (insErr) { failed.push({ email: r.email, error: 'token: ' + insErr.message }); continue }

    const link = `${appUrl}/text-alerts/${token}`
    if (mode === 'test') testLink = link
    const firstName = String(r.name ?? '').trim().split(/\s+/)[0] || 'there'
    try {
      const { error } = await resend.emails.send({
        from,
        to: [r.email],
        subject: 'Turn on text alerts from Mighty Wash',
        html: emailHtml(firstName, r.email, link, appUrl),
      })
      if (error) throw new Error((error as { message?: string }).message ?? 'send_failed')
      sent.push(r.email)
    } catch (e) {
      // Don't leave a live link behind for an email that never went out.
      await svc.from('sms_optin_tokens').delete().eq('token_hash', tokenHash)
      failed.push({ email: r.email, error: e instanceof Error ? e.message : String(e) })
    }
    // Stay under Resend's per-second rate limit.
    await new Promise((res) => setTimeout(res, 600))
  }

  return json({ sent_count: sent.length, sent, failed, ...(testLink ? { test_link: testLink } : {}) }, 200)
})
