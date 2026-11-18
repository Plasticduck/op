// checklist-daily-email — Supabase Edge Function (Deno).
// Mighty Wash's nightly checklist email, 8pm Central, to the Regional Managers,
// Kevan Jowers and Laramie Keith (Kevan, 2026-11-18). It leads with the
// checklists that weren't submitted, then every site's checklists for the day,
// then the items the sites flagged (not done, or commented on).
//
// Closing checklists are still open at 8pm, so tonight's email lists them as
// still open, and tomorrow night's email reports how they ended ("Last night").
// The checklists due come from the templates (checklist_day_report), so a site
// that never opened the page still shows as not submitted.
//
// Scheduled by pg_cron at 01:00 and 02:00 UTC; the function only sends when the
// America/Chicago hour is 20, so it fires once at 8pm whether CDT or CST. It
// claims the day in checklist_daily_emails first, so a retry can't send twice.
//
// Body (optional): { force?, dryRun?, preview?, to?, date? }
//   force   skips the 8pm guard and the once-a-day claim (manual test)
//   dryRun  returns the counts and recipients without sending
//   preview returns the email's HTML without sending
//   to      sends only to this address (test)
//   date    the report day, YYYY-MM-DD (default: today in Central)
//   lastNight  include last night's late checklists even if no email went last night (test)
//
// Secrets: RESEND_API_KEY (required). Optional: RESEND_FROM, APP_URL.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'
import { SEND_HOUR, TZ, addDays, buildHtml, localDay, shortDay, zoned, type Flagged, type Row } from './render.ts'

const ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6' // Mighty Wash
const FIXED_TO = ['kjowers@mighty-wash.com', 'lkeith@mighty-wash.com'] // Kevan Jowers, Laramie Keith

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

// ---- Handler ---------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: service-role (cron) or a Mighty Wash owner (manual test).
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const uc = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await uc.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner' || p.account_id !== ACCOUNT_ID) return json({ error: 'forbidden' }, 403)
  }

  let body: { force?: boolean; dryRun?: boolean; preview?: boolean; to?: string; date?: string; lastNight?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }

  const now = new Date()
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(now))
  if (!body.force && !body.dryRun && !body.preview && hour !== SEND_HOUR) {
    return json({ skipped: true, reason: 'not 8pm Central', hour })
  }
  if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return json({ error: 'bad_date' }, 400)
  const day = body.date ?? localDay(now, TZ)
  const yesterday = addDays(day, -1)
  // What counts as "closed" tonight: now, or 8pm for a past day.
  const cutoff = body.date ? Math.min(now.getTime(), zoned(day, SEND_HOUR, TZ).getTime()) : now.getTime()
  const lastCutoff = zoned(yesterday, SEND_HOUR, TZ).getTime()

  const [a, b, prev] = await Promise.all([
    svc.rpc('checklist_day_report', { p_account: ACCOUNT_ID, p_date: day }),
    svc.rpc('checklist_day_report', { p_account: ACCOUNT_ID, p_date: yesterday }),
    svc.from('checklist_daily_emails').select('sent_at').eq('account_id', ACCOUNT_ID).eq('report_date', yesterday).maybeSingle(),
  ])
  if (a.error || b.error) return json({ error: 'report_failed', detail: (a.error ?? b.error)?.message }, 500)
  const today = (a.data ?? []) as Row[]
  // Last night: yesterday's checklists still open when last night's email went.
  // Only when it went (not on the first night, or after a night it failed).
  const lastSent = !!prev.data?.sent_at || !!body.lastNight
  const yesterdayRows = lastSent ? ((b.data ?? []) as Row[]) : []
  const lastNight = yesterdayRows.filter((r) => {
    const closes = new Date(r.closes_at).getTime()
    if (closes <= lastCutoff) return false
    return !r.submitted_at || new Date(r.submitted_at).getTime() > lastCutoff
  })
  if (today.length === 0 && lastNight.length === 0) return json({ skipped: true, reason: 'nothing due', day })

  // The flagged items, with what the site said about each when they submitted.
  const flaggedRows = [
    ...today.filter((r) => r.submitted_at && r.flagged_count > 0).map((r) => ({ r, when: 'today' })),
    ...lastNight.filter((r) => r.submitted_at && r.flagged_count > 0).map((r) => ({ r, when: `last night (${shortDay(yesterday)})` })),
  ]
  const flagged: Flagged[] = []
  if (flaggedRows.length) {
    const ids = flaggedRows.map((f) => f.r.instance_id as string)
    const [inst, com] = await Promise.all([
      svc.from('checklist_instances').select('id, snapshot, flagged_items, submitted_at').in('id', ids),
      svc.from('checklist_item_comments').select('instance_id, item_id, author_name, body, created_at').in('instance_id', ids).order('created_at'),
    ])
    if (inst.error || com.error) return json({ error: 'flagged_failed', detail: (inst.error ?? com.error)?.message }, 500)
    const byId = new Map((inst.data ?? []).map((i) => [i.id as string, i]))
    for (const { r, when } of flaggedRows) {
      const i = byId.get(r.instance_id as string)
      if (!i) continue
      const items = ((i.snapshot as { items?: { id: string; label: string; done: boolean }[] } | null)?.items ?? [])
        .filter((it) => (i.flagged_items as string[]).includes(it.id))
        .map((it) => ({
          label: it.label,
          done: it.done,
          notes: (com.data ?? [])
            .filter((c) => c.instance_id === i.id && c.item_id === it.id && (!i.submitted_at || c.created_at <= i.submitted_at))
            .map((c) => ({
              text: String(c.body).length > 300 ? String(c.body).slice(0, 300) + '…' : String(c.body),
              by: (c.author_name as string | null) ?? null,
            })),
        }))
      if (items.length) flagged.push({ location_name: r.location_name, checklist_name: r.checklist_name, when, items })
    }
  }

  const appUrl = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'
  const { html, subject, counts } = buildHtml({ day, cutoff, today, lastNight, flagged, appUrl })

  // Recipients: the Regional Managers' logins, plus Kevan and Laramie.
  const { data: rmUsers, error: rmErr } = await svc.from('users').select('email')
    .eq('account_id', ACCOUNT_ID).eq('role_category', 'regional_manager')
  if (rmErr) return json({ error: 'recipients_failed', detail: rmErr.message }, 500)
  const recipients = [...new Set([...FIXED_TO, ...(rmUsers ?? []).map((u) => String(u.email ?? '').trim().toLowerCase())].filter((e) => e.includes('@')))]
  const to = body.to ? [body.to] : recipients

  if (body.preview) return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  if (body.dryRun) return json({ dryRun: true, day, subject, counts, recipients, would_send_to: to, flagged_checklists: flagged.length, last_night_included: lastSent })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key' }, 503)

  // Once a day: claim it (a test to one address doesn't claim).
  const claims = !body.force && !body.to
  if (claims) {
    const { data: claimed, error: cErr } = await svc.from('checklist_daily_emails')
      .insert({ account_id: ACCOUNT_ID, report_date: day }).select('report_date')
    if (cErr && cErr.code !== '23505') return json({ error: 'claim_failed', detail: cErr.message }, 500)
    if (!claimed?.length) return json({ skipped: true, reason: 'already sent', day })
  }

  const resend = new Resend(resendKey)
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const results: { to: string; id?: string; error?: string }[] = []
  for (const addr of to) {
    try {
      const { data, error } = await resend.emails.send({ from, to: [addr], subject, html })
      results.push(error ? { to: addr, error: (error as { message?: string }).message ?? 'send_failed' } : { to: addr, id: data?.id })
    } catch (e) {
      results.push({ to: addr, error: e instanceof Error ? e.message : 'send_failed' })
    }
    // Resend allows a few sends a second.
    await new Promise((r) => setTimeout(r, 300))
  }
  const sent = results.filter((r) => r.id).length
  if (claims) {
    if (sent === 0) await svc.from('checklist_daily_emails').delete().eq('account_id', ACCOUNT_ID).eq('report_date', day)
    else await svc.from('checklist_daily_emails').update({ sent_at: new Date().toISOString(), result: { counts, results } }).eq('account_id', ACCOUNT_ID).eq('report_date', day)
  }
  return json({ ok: sent > 0, day, subject, counts, sent, results })
})
