// it-reminders — Supabase Edge Function (Deno).
// Every morning at 8 AM Central, texts and emails people what's coming up in
// IT Inventory: warranties and end of life, audits, subscription renewals (on
// the cancel-by date when they renew by themselves) and supplies that ran low.
//
// The rules (days before, text and/or email, who, digest) are per account in
// it_reminder_rules, and nothing goes out for an account until an admin turns
// reminders on (it_settings.reminders_enabled). A reminder is sent once per
// item, threshold, person and channel: each one is claimed in the
// it_reminder_sends ledger (unique key) before it's sent, so a second run the
// same day sends nothing, and a failed send is un-claimed to retry tomorrow.
// Thresholds are crossings, not exact days: an item first seen 5 days out gets
// the 7-day reminder only, and a missed morning catches up the next day.
//
// Digest (the default): one text and one email per person per day listing
// everything due. Rules with digest off send one message per item.
//
// Scheduled twice by pg_cron (13:00 and 14:00 UTC); the hour guard lets only
// the 8 AM Central call through, whichever daylight saving is in effect.
//
// Body: { force?, preview?, test?, account_id? }
//   preview  what would go out today, per person, with the text and email,
//            sending and recording nothing (works with reminders off).
//   test     sends the caller (an admin) their own reminders now, or a sample
//            if nothing is due, without recording them.
// Auth: service role (cron, any account via account_id) or an Admin (owner)
// of the account (preview and test only, own account).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// deno-lint-ignore no-explicit-any
type Any = any

const APP_URL = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'
const TZ = 'America/Chicago'
const SEND_HOUR = 8
const SMS_BUDGET = 480 // characters of item lines in one text, before "+N more"
const KINDS = ['warranty', 'subscription_renewal', 'audit_due', 'eol', 'low_stock'] as const
type Kind = (typeof KINDS)[number]

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

type Rule = {
  id: string
  account_id: string
  kind: Kind
  days_before: number[]
  channels: string[]
  recipients: { roles?: string[]; user_ids?: string[] } | null
  digest: boolean
}
type Candidate = {
  kind: Kind
  entity_type: 'asset' | 'subscription' | 'consumable'
  entity_id: string
  location_id: string | null
  site: string | null
  due_date: string
  info: Record<string, Any>
}
type Person = {
  id: string
  name: string
  email: string | null
  phone: string | null
  sms_opt_in: boolean | null
  role: string
  location_ids: string[] | null
}
type Due = { rule: Rule; cand: Candidate; threshold: number; days: number }
type Claim = {
  account_id: string
  rule_id: string
  kind: string
  entity_type: string
  entity_id: string
  due_date: string
  threshold_days: number
  recipient_id: string
  channel: 'sms' | 'email'
}

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const localHour = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(d)) % 24
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400_000)
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const inDays = (n: number) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`)
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
const CYCLE: Record<string, string> = { monthly: '/mo', quarterly: '/qtr', annual: '/yr' }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

// The smallest threshold the item has crossed, or null if it's not due yet.
// Low stock has no countdown: it's due the day it ran low.
function crossed(rule: Rule, days: number): number | null {
  if (rule.kind === 'low_stock') return 0
  const hits = (rule.days_before ?? []).filter((t) => t >= days).sort((a, b) => a - b)
  return hits.length ? hits[0] : null
}

// Who can open IT Inventory while it rolls out. Same list as
// src/features/it/inventory/access.ts; change both together. While there is
// a list, reminders go to exactly these people (Kevan, 2026-10-30) and the
// rule's roles and names don't apply. null = everyone by the rule.
const ACCESS_EMAILS: string[] | null = [
  'kevan@washlyfe.com',
  'jjowers@mighty-wash.com',
  'ncarter@mighty-wash.com',
  'blake@mighty-wash.com',
  'nkerstell@mighty-wash.com',
]
const ACCESS = ACCESS_EMAILS ? new Set(ACCESS_EMAILS) : null

// Managers hear about their own sites; Admins and technicians about every
// site. People named on the rule, and a subscription's owner, are included
// if they can see the item.
function recipients(rule: Rule, c: Candidate, people: Person[]): Person[] {
  const roles = rule.recipients?.roles ?? ['owner', 'manager']
  const named = new Set(rule.recipients?.user_ids ?? [])
  if (c.info.owner_user_id) named.add(String(c.info.owner_user_id))
  const allSites = (p: Person) => p.role === 'owner' || p.role === 'technician'
  const atSite = (p: Person) => !!c.location_id && (p.location_ids ?? []).includes(c.location_id)
  if (ACCESS) {
    return people.filter((p) => ACCESS.has((p.email ?? '').toLowerCase()) && p.role !== 'employee'
      && (c.location_id === null || allSites(p) || atSite(p)))
  }
  return people.filter((p) => {
    if (named.has(p.id)) return c.location_id === null || allSites(p) || atSite(p)
    if (!roles.includes(p.role) || p.role === 'employee') return false
    return allSites(p) || (p.role === 'manager' && atSite(p))
  })
}

function line(d: Due): { text: string; link: string } {
  const { cand: c, days } = d
  const i = c.info
  const where = c.site ?? 'every site'
  const asset = `${i.tag ?? ''} ${i.name ?? ''}`.trim()
  switch (c.kind) {
    case 'warranty':
      return { text: `Warranty ends ${fmtDay(c.due_date)} (${inDays(days)}): ${asset}, ${where}`, link: `/app/it-inventory/${c.entity_id}` }
    case 'eol':
      return { text: `End of life ${fmtDay(c.due_date)} (${inDays(days)}): ${asset}, ${where}`, link: `/app/it-inventory/${c.entity_id}` }
    case 'audit_due':
      return { text: `Audit due ${fmtDay(c.due_date)} (${inDays(days)}): ${asset}, ${where}`, link: `/app/it-inventory/${c.entity_id}` }
    case 'subscription_renewal': {
      const cost = i.cost != null && CYCLE[i.cycle] ? ` (${money(Number(i.cost))}${CYCLE[i.cycle]})` : ''
      const what = `${i.name}${i.provider ? ` from ${i.provider}` : ''}, ${where}${cost}`
      const text = i.cancel_by
        ? `Cancel by ${fmtDay(c.due_date)} (${inDays(days)}) or it renews ${fmtDay(i.renewal_date)}: ${what}`
        : i.auto_renew
          ? `Renews ${fmtDay(c.due_date)} (${inDays(days)}): ${what}`
          : `Ends ${fmtDay(c.due_date)} (${inDays(days)}) unless renewed: ${what}`
      return { text, link: `/app/it-inventory/subscriptions?id=${c.entity_id}` }
    }
    case 'low_stock':
      return { text: `Low: ${i.name} at ${where}, ${i.qty} left (minimum ${i.min})`, link: `/app/it-inventory/supplies?site=${c.location_id}` }
  }
}

function smsText(items: Due[]): string {
  const lines = items.map((d) => line(d).text)
  if (lines.length === 1) return `Operator IT: ${lines[0]}\n${APP_URL}${line(items[0]).link}`
  const shown: string[] = []
  let used = 0
  for (const l of lines) {
    if (shown.length && used + l.length > SMS_BUDGET) break
    shown.push(`- ${l}`)
    used += l.length + 3
  }
  const more = lines.length - shown.length
  return [`Operator IT: ${lines.length} things coming up`, ...shown, ...(more ? [`+${more} more`] : []), `${APP_URL}/app/it-inventory/overview`].join('\n')
}

const HEAD: Record<Kind, string> = {
  subscription_renewal: 'Subscriptions',
  warranty: 'Warranties',
  eol: 'End of life',
  audit_due: 'Audits',
  low_stock: 'Low supplies',
}

function emailHtml(person: Person, items: Due[], note?: string): string {
  const sections = KINDS.filter((k) => items.some((d) => d.cand.kind === k)).map((k) => {
    const rows = items.filter((d) => d.cand.kind === k).map((d) => {
      const l = line(d)
      return `<tr><td style="padding:6px 0;border-bottom:1px solid #eee"><a href="${APP_URL}${l.link}" style="color:#1d4ed8;text-decoration:none">${esc(l.text)}</a></td></tr>`
    }).join('')
    return `<h3 style="margin:20px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#555">${HEAD[k]}</h3><table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>`
  }).join('')
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#111">
<p style="font-size:15px">Hi ${esc(person.name.split(' ')[0] ?? person.name)},</p>
${note ? `<p style="font-size:14px;color:#555">${esc(note)}</p>` : ''}
<p style="font-size:15px">${items.length === 1 ? 'One thing is' : `${items.length} things are`} coming up in IT Inventory.</p>
${sections}
<p style="margin-top:24px"><a href="${APP_URL}/app/it-inventory/overview" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px">Open IT Inventory</a></p>
<p style="font-size:12px;color:#888;margin-top:24px">${ACCESS ? 'You get these because you can open IT Inventory on Operator.' : `You get these as ${person.role === 'owner' ? 'an Admin' : `a ${person.role}`} on Operator.`} An admin can change what they cover, and when, in IT Inventory &gt; Settings.</p>
</div>`
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
    const d = await res.json().catch(() => null)
    return res.ok ? { ok: true } : { ok: false, error: d?.message ?? `twilio_${res.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'email_not_configured' }
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  try {
    const { error } = await new Resend(key).emails.send({ from, to: [to], subject, html })
    return error ? { ok: false, error: (error as { message?: string }).message ?? 'send_failed' } : { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const subjectFor = (items: Due[], today: string) =>
  `IT Inventory: ${items.length === 1 ? '1 thing' : `${items.length} things`} coming up (${fmtDay(today)})`

// Everything due today for one account, per person and channel.
async function plan(svc: Any, accountId: string, today: string) {
  const { data: rulesRaw, error: rErr } = await svc.from('it_reminder_rules')
    .select('id, account_id, kind, days_before, channels, recipients, digest')
    .eq('account_id', accountId).eq('enabled', true).in('kind', KINDS as unknown as string[])
  if (rErr) throw new Error(rErr.message)
  const rules = new Map<string, Rule>((rulesRaw ?? []).map((r: Rule) => [r.kind, r]))
  if (!rules.size) return { people: [] as Person[], perPerson: new Map<string, Due[]>(), rules }
  const horizon = Math.max(60, ...[...rules.values()].flatMap((r) => r.days_before ?? []))
  const [{ data: cands, error: cErr }, { data: people, error: pErr }] = await Promise.all([
    svc.rpc('it_reminder_candidates', { p_account: accountId, p_today: today, p_horizon: horizon }),
    svc.from('users').select('id, name, email, phone, sms_opt_in, role, location_ids').eq('account_id', accountId),
  ])
  if (cErr) throw new Error(cErr.message)
  if (pErr) throw new Error(pErr.message)
  const perPerson = new Map<string, Due[]>()
  for (const cand of (cands ?? []) as Candidate[]) {
    const rule = rules.get(cand.kind)
    if (!rule) continue
    const days = dayDiff(today, cand.due_date)
    const threshold = crossed(rule, days)
    if (threshold === null) continue
    for (const p of recipients(rule, cand, people as Person[])) {
      perPerson.set(p.id, [...(perPerson.get(p.id) ?? []), { rule, cand, threshold, days }])
    }
  }
  for (const list of perPerson.values()) list.sort((a, b) => KINDS.indexOf(a.cand.kind) - KINDS.indexOf(b.cand.kind) || a.days - b.days)
  return { people: people as Person[], perPerson, rules }
}

const canText = (p: Person) => !!(p.sms_opt_in && p.phone)
const channelsFor = (p: Person, items: Due[]) => ({
  sms: canText(p) && items.some((d) => d.rule.channels.includes('sms')),
  email: !!p.email && items.some((d) => d.rule.channels.includes('email')),
})

// Messages for one person and channel: one digest for digest rules, one each otherwise.
function batches(items: Due[], channel: 'sms' | 'email'): Due[][] {
  const mine = items.filter((d) => d.rule.channels.includes(channel))
  const digest = mine.filter((d) => d.rule.digest)
  return [...(digest.length ? [digest] : []), ...mine.filter((d) => !d.rule.digest).map((d) => [d])]
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { force?: boolean; preview?: boolean; test?: boolean; account_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  // Service role (cron) or an Admin of the account (preview / test only).
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const isService = jwtRole(authHeader) === 'service_role' || (!!token && token === serviceKey)
  let caller: Person & { account_id: string } | null = null
  if (!isService) {
    const { data: u } = await svc.auth.getUser(token)
    if (!u?.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users')
      .select('id, account_id, name, email, phone, sms_opt_in, role, location_ids').eq('id', u.user.id).maybeSingle()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden', message: 'Only an admin can do this.' }, 403)
    if (!body.preview && !body.test) return json({ error: 'forbidden', message: 'Choose preview or test.' }, 403)
    caller = p
  }

  const now = new Date()
  const today = localDate(now)

  // ---- Preview and test: one account, nothing recorded -------------------------
  if (body.preview || body.test) {
    const accountId = caller?.account_id ?? body.account_id
    if (!accountId) return json({ error: 'account_id required' }, 400)
    let planned
    try { planned = await plan(svc, accountId, today) } catch (e) { return json({ error: 'plan_failed', message: String(e) }, 500) }

    if (body.preview) {
      const out = [...planned.perPerson.entries()].map(([id, items]) => {
        const p = planned.people.find((x) => x.id === id)!
        const ch = channelsFor(p, items)
        return {
          id, name: p.name, role: p.role,
          text: ch.sms ? batches(items, 'sms').map(smsText) : [],
          email: ch.email ? { to: p.email, subject: subjectFor(items, today) } : null,
          no_text_reason: ch.sms || !items.some((d) => d.rule.channels.includes('sms')) ? null : (p.phone ? 'not opted in to texts' : 'no mobile number'),
          items: items.map((d) => ({ kind: d.cand.kind, threshold: d.threshold, text: line(d).text })),
        }
      }).sort((a, b) => a.name.localeCompare(b.name))
      const { data: s } = await svc.from('it_settings').select('reminders_enabled').eq('account_id', accountId).maybeSingle()
      return json({ ok: true, today, enabled: !!s?.reminders_enabled, people: out }, 200)
    }

    // test: the caller's own reminders (or a sample) to their own phone and email.
    if (!caller) return json({ error: 'test is for a signed-in admin' }, 400)
    let items = planned.perPerson.get(caller.id) ?? []
    let note: string | undefined = 'This is a test from IT Inventory settings. Nothing was recorded.'
    if (!items.length) {
      note = 'This is a test from IT Inventory settings. Nothing is due for you today, so here is what a reminder looks like.'
      const sample: Candidate = {
        kind: 'warranty', entity_type: 'asset', entity_id: '00000000-0000-0000-0000-000000000000', location_id: null,
        site: 'Your site', due_date: today, info: { tag: 'IT-000123', name: 'Lobby tablet' },
      }
      items = [{ rule: { id: '', account_id: caller.account_id, kind: 'warranty', days_before: [30], channels: ['sms', 'email'], recipients: null, digest: true }, cand: { ...sample, due_date: new Date(Date.parse(today) + 30 * 86400_000).toISOString().slice(0, 10) }, threshold: 30, days: 30 }]
    }
    const result: Record<string, Any> = {}
    result.sms = canText(caller)
      ? await sendSms(caller.phone!, `[Test] ${smsText(items)}`)
      : { ok: false, error: caller.phone ? 'You are not opted in to texts.' : 'There is no mobile number on your profile.' }
    result.email = caller.email
      ? await sendEmail(caller.email, `[Test] ${subjectFor(items, today)}`, emailHtml(caller, items, note))
      : { ok: false, error: 'There is no email on your profile.' }
    return json({ ok: true, ...result }, 200)
  }

  // ---- The morning run ----------------------------------------------------------------
  if (!body.force && localHour(now) !== SEND_HOUR) return json({ skipped: true, reason: `not ${SEND_HOUR} AM Central` }, 200)

  let q = svc.from('it_settings').select('account_id').eq('reminders_enabled', true)
  if (body.account_id) q = q.eq('account_id', body.account_id)
  const { data: accounts, error: aErr } = await q
  if (aErr) return json({ error: 'settings_failed', message: aErr.message }, 500)

  const report: Any[] = []
  for (const { account_id: accountId } of accounts ?? []) {
    const summary = { account_id: accountId, people: 0, texts: 0, emails: 0, already_sent: 0, failed: [] as string[] }
    try {
      const planned = await plan(svc, accountId, today)
      for (const [personId, items] of planned.perPerson) {
        const p = planned.people.find((x) => x.id === personId)!
        const ch = channelsFor(p, items)
        let any = false
        for (const channel of ['sms', 'email'] as const) {
          if (!ch[channel]) continue
          for (const batch of batches(items, channel)) {
            // Claim first: only reminders this run inserted get sent.
            const claims: Claim[] = batch.map((d) => ({
              account_id: accountId, rule_id: d.rule.id, kind: d.cand.kind, entity_type: d.cand.entity_type,
              entity_id: d.cand.entity_id, due_date: d.cand.due_date, threshold_days: d.threshold, recipient_id: p.id, channel,
            }))
            const { data: claimed, error: clErr } = await svc.from('it_reminder_sends')
              .upsert(claims, { onConflict: 'rule_id,entity_id,due_date,threshold_days,recipient_id,channel', ignoreDuplicates: true })
              .select('id, rule_id, entity_id')
            if (clErr) { summary.failed.push(`${p.name} ${channel}: ${clErr.message}`); continue }
            const got = new Set((claimed ?? []).map((r: { rule_id: string; entity_id: string }) => `${r.rule_id}:${r.entity_id}`))
            summary.already_sent += batch.length - got.size
            const fresh = batch.filter((d) => got.has(`${d.rule.id}:${d.cand.entity_id}`))
            if (!fresh.length) continue
            const sent = channel === 'sms'
              ? await sendSms(p.phone!, smsText(fresh))
              : await sendEmail(p.email!, subjectFor(fresh, today), emailHtml(p, fresh))
            if (sent.ok) {
              any = true
              if (channel === 'sms') summary.texts++
              else summary.emails++
            } else {
              summary.failed.push(`${p.name} ${channel}: ${sent.error}`)
              await svc.from('it_reminder_sends').delete().in('id', (claimed ?? []).map((r: { id: string }) => r.id))
            }
          }
        }
        if (any) summary.people++
      }
    } catch (e) {
      summary.failed.push(e instanceof Error ? e.message : String(e))
    }
    report.push(summary)
  }
  return json({ ok: true, today, accounts: report }, 200)
})
