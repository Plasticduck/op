// mi-alerts — Supabase Edge Function (Deno).
// Sends Maintenance Inventory's alerts as texts (docs/maintenance-inventory), through
// Twilio directly, the same call send-sms makes.
//
// The database decides what's worth an alert and dedupes it (mi__raise_alert: one per
// thing per 24 hours). This decides who hears about it and when:
//   dispatch  every minute from pg_cron while anything is waiting. Texts pending alerts.
//             Holds non-urgent ones through quiet hours; a critical part at zero goes
//             right away. With texts switched off for the account (the default),
//             pending alerts are just marked off, so turning them on later doesn't
//             send a backlog.
//   nightly   evaluates every reorder point, overdue tools, scheduled counts and
//             maintenance schedules (mi__nightly), then rolls non-critical low stock
//             and maintenance that's due into one text per person.
//   preview   what's waiting and who would get it, sending nothing. Any admin.
//
// Body: { action: 'dispatch' | 'nightly' | 'preview' }
// Auth: service role (cron), or a Maintenance Inventory admin for preview.
// Secrets: TWILIO_* (see send-sms). Without them everything is left waiting.

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

async function sendSms(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const keySid = Deno.env.get('TWILIO_API_KEY_SID')
  const keySecret = Deno.env.get('TWILIO_API_KEY_SECRET')
  const fromNum = Deno.env.get('TWILIO_FROM')
  const messagingServiceSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')
  if (!accountSid || !keySid || !keySecret || (!fromNum && !messagingServiceSid)) return { ok: false, error: 'twilio_not_configured' }
  if (!/^\+\d{8,15}$/.test(to)) return { ok: false, error: 'bad_number' }
  const form = new URLSearchParams()
  form.set('To', to)
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid)
  else form.set('From', fromNum as string)
  form.set('Body', text)
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${keySid}:${keySecret}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    if (res.ok) return { ok: true }
    const d = await res.json().catch(() => null)
    return { ok: false, error: d?.message ?? `twilio_${res.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function inQuietHours(s: Any, now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: s.timezone ?? 'America/Chicago', hour: 'numeric', hour12: false }).format(now)) % 24
  const a = Number(s.quiet_start_hour)
  const b = Number(s.quiet_end_hour)
  if (a === b) return false
  return a < b ? hour >= a && hour < b : hour >= a || hour < b
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { action?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const action = body.action ?? 'dispatch'

  const auth = req.headers.get('Authorization') ?? ''
  let adminAccount: string | null = null
  if (jwtRole(auth) !== 'service_role') {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: m } = await svc.from('mi_members').select('role, account_id').eq('user_id', u.user.id).maybeSingle()
    if (!m || (m as Any).role !== 'admin' || action !== 'preview') return json({ error: 'forbidden' }, 403, origin)
    adminAccount = (m as Any).account_id
  }

  const recipients = async (alertId: string): Promise<Any[]> => {
    const { data, error } = await svc.rpc('mi__alert_recipients', { p_alert: alertId })
    if (error) throw new Error(error.message)
    return (data ?? []) as Any[]
  }

  if (action === 'preview') {
    const q = svc.from('mi_alerts').select('id, kind, message, created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(30)
    const { data: pending } = adminAccount ? await q.eq('account_id', adminAccount) : await q
    const out = []
    for (const a of (pending ?? []) as Any[]) out.push({ ...a, recipients: (await recipients(a.id)).map((r) => ({ name: r.name, sms_ok: r.sms_ok })) })
    return json({ ok: true, pending: out }, 200, origin)
  }

  const { data: settingsRows } = await svc.from('mi_settings').select('*')
  const settings = new Map<string, Any>(((settingsRows ?? []) as Any[]).map((s) => [s.account_id, s]))

  if (action === 'dispatch') {
    const { data: pending } = await svc.from('mi_alerts').select('*').eq('status', 'pending').order('created_at').limit(100)
    let sent = 0, off = 0, held = 0, none = 0, failed = 0
    for (const a of (pending ?? []) as Any[]) {
      const s = settings.get(a.account_id)
      if (!s?.sms_enabled) {
        await svc.from('mi_alerts').update({ status: 'off' }).eq('id', a.id)
        off++
        continue
      }
      if (!a.bypass_quiet && inQuietHours(s)) { held++; continue }
      const people = (await recipients(a.id)).filter((r) => r.sms_ok)
      if (people.length === 0) {
        await svc.from('mi_alerts').update({ status: 'no_recipient' }).eq('id', a.id)
        none++
        continue
      }
      const results = []
      for (const p of people) results.push({ name: p.name, ...(await sendSms(p.phone, a.message)) })
      const anyOk = results.some((r) => r.ok)
      await svc.from('mi_alerts').update({ status: anyOk ? 'sent' : 'failed', sent_at: new Date().toISOString(), detail: { results } }).eq('id', a.id)
      if (anyOk) sent++
      else failed++
    }
    return json({ ok: true, sent, off, held, no_recipient: none, failed }, 200, origin)
  }

  if (action === 'nightly') {
    const out: Any[] = []
    for (const [account, s] of settings) {
      const { data: run, error } = await svc.rpc('mi__nightly', { p_account: account })
      if (error) { out.push({ account, error: error.message }); continue }
      // Low stock and maintenance that's due go out as one text per person, not one per
      // part or task.
      const { data: lows } = await svc.from('mi_alerts').select('id, kind').eq('account_id', account).eq('status', 'digest').limit(500)
      const byPerson = new Map<string, { phone: string; name: string; parts: number; tasks: number; sms_ok: boolean }>()
      for (const a of (lows ?? []) as Any[]) {
        for (const r of await recipients(a.id)) {
          const cur = byPerson.get(r.user_id) ?? { phone: r.phone, name: r.name, parts: 0, tasks: 0, sms_ok: r.sms_ok }
          if (a.kind === 'maintenance_due') cur.tasks++
          else cur.parts++
          byPerson.set(r.user_id, cur)
        }
      }
      let texts = 0
      if (s.sms_enabled) {
        for (const p of byPerson.values()) {
          if (!p.sms_ok) continue
          const bits: string[] = []
          if (p.parts) bits.push(`${p.parts} part${p.parts === 1 ? '' : 's'} at your locations ${p.parts === 1 ? 'is' : 'are'} at the reorder point. Check the Reorder screen.`)
          if (p.tasks) bits.push(`${p.tasks} maintenance task${p.tasks === 1 ? ' is' : 's are'} due or overdue. Check the Maintenance Log.`)
          const res = await sendSms(p.phone, `Maintenance Inventory: ${bits.join(' ')}`)
          if (res.ok) texts++
        }
      }
      if ((lows ?? []).length) {
        await svc.from('mi_alerts').update({ status: s.sms_enabled ? 'sent' : 'off', sent_at: new Date().toISOString() }).in('id', ((lows ?? []) as Any[]).map((a) => a.id))
      }
      out.push({ account, run, digest_rows: (lows ?? []).length, digest_texts: texts })
    }
    return json({ ok: true, accounts: out }, 200, origin)
  }

  return json({ error: 'bad_request' }, 400, origin)
})
