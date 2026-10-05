// clock-in-alert-email — Supabase Edge Function (Deno).
// Every morning at 6:00 AM Central, emails an "unusual clock-ins" report: people
// still clocked in on an OPEN iSolved punch that has run longer than a normal
// shift (the same "check punch" flag the On the Clock view shows), grouped by
// site. These are almost always missed clock-outs from the day before.
//
// Scheduled by pg_cron at 11:00 & 12:00 UTC (= 6:00 AM CDT / CST); the function
// only proceeds at 6 AM Central unless { force: true }.
//
// Body: { force?: boolean, to?: string, dryRun?: boolean, thresholdHours?: number }
// Auth: service role (cron) or an owner of the Mighty Wash account (manual test).
// Secrets: RESEND_API_KEY (required), RESEND_FROM (optional), ISOLVED_* .

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// deno-lint-ignore no-explicit-any
type Any = any
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const DEFAULT_TO = ['kjowers@mighty-wash.com', 'lkeith@mighty-wash.com']
const DEFAULT_THRESHOLD_H = 14 // an open punch running this long = likely missed clock-out
const LOOKBACK_DAYS = 3 // catch open punches opened in the last few days

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

function siteLabel(code: string): string {
  if (!code) return 'Unassigned'
  if (/^\d+$/.test(code)) return 'MW' + code.padStart(2, '0')
  const u = code.toUpperCase()
  if (u === 'COR') return 'Corporate'
  if (u === 'SPO') return 'Spotless'
  return code
}
const siteNumOf = (label: string): number => { const m = label.match(/^MW(\d+)$/); return m ? parseInt(m[1], 10) : 9999 }

function centralParts(d: Date): { date: string; iso: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value
  const hh = p.hour === '24' ? '00' : p.hour
  return { date: `${p.year}-${p.month}-${p.day}`, iso: `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}` }
}
const addDays = (dateStr: string, n: number): string => new Date(new Date(dateStr + 'T00:00:00Z').getTime() + n * 86400_000).toISOString().slice(0, 10)
const diffHours = (fromIso: string, toIso: string): number => (Date.parse(toIso + 'Z') - Date.parse(fromIso + 'Z')) / 3600_000
const isMidnight = (iso: string): boolean => /T00:00:00$/.test(iso)
function clockMoment(iso: string): string {
  // "Sun 4:12 PM" for an open punch's in-time (naive Central ISO).
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return iso
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).getUTCDay()]
  let h = parseInt(m[4], 10); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12
  return `${dow} ${h}:${m[5]} ${ap}`
}
const fmtElapsed = (h: number): string => {
  const mins = Math.round(h * 60)
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function getToken(base: string, cid: string, secret: string): Promise<string> {
  const res = await fetch(base + '/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(cid + ':' + secret) },
    body: 'grant_type=client_credentials',
  })
  const j = (await res.json()) as Any
  if (!res.ok || !j.access_token) throw new Error('token failed ' + res.status)
  return j.access_token as string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key', message: 'Email is not configured.' }, 503)
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: service-role (cron) or an owner of Mighty Wash (manual test).
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const uc = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await uc.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner' || p.account_id !== MW_ACCOUNT) return json({ error: 'forbidden' }, 403)
  }

  let body: { force?: boolean; to?: string; dryRun?: boolean; thresholdHours?: number } = {}
  try { body = await req.json() } catch { /* empty */ }

  // Time guard: only send at 6 AM Central unless forced.
  const chicagoHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()))
  if (!body.force && chicagoHour !== 6) return json({ skipped: true, reason: 'not 6am Central', chicagoHour }, 200)

  const threshold = Number.isFinite(body.thresholdHours) ? Math.max(1, body.thresholdHours!) : DEFAULT_THRESHOLD_H

  const base = Deno.env.get('ISOLVED_BASE_URL')
  const cid = Deno.env.get('ISOLVED_CLIENT_ID')
  const secret = Deno.env.get('ISOLVED_API_SECRET')
  const client = Deno.env.get('ISOLVED_CLIENT')
  const legal = Deno.env.get('ISOLVED_LEGAL')
  if (!base || !cid || !secret || !client || !legal) return json({ error: 'no_key', message: 'iSolved is not configured.' }, 503)

  const now = new Date()
  const cNow = centralParts(now)
  const today = cNow.date
  const start = addDays(today, -LOOKBACK_DAYS)

  // Pull punches and find OPEN ones (clocked in, no out) running past the shift
  // threshold. The iSolved API is 0-indexed; page from 0 until an empty page.
  type Flag = { name: string; site: string; clockInAt: string; elapsedHours: number }
  const flags: Flag[] = []
  try {
    let token = await getToken(base, cid, secret)
    const getJson = async (pageUrl: string): Promise<Any> => {
      let res = await fetch(pageUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      if (res.status === 401) { token = await getToken(base, cid, secret); res = await fetch(pageUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }) }
      if (!res.ok) throw new Error(`isolved ${res.status}`)
      return await res.json()
    }
    for (let page = 0; page < 60; page++) {
      const d = await getJson(`${base}/api/clients/${client}/legals/${legal}/timecardData?startDate=${start}&endDate=${today}&pageSize=100&page=${page}`)
      const results = d.results ?? []
      if (results.length === 0) break
      for (const r of results) {
        const name = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').trim() || String(r.employeeNumber ?? '')
        for (const t of r.timecardData ?? []) {
          const inEff = String(t.inPunchDateTimeEffective ?? '')
          const open = (t.outPunchId == null || !t.outPunchDateTimeEffective) && inEff && !isMidnight(inEff)
          if (!open) continue
          const elapsed = Math.max(0, diffHours(inEff, cNow.iso))
          if (elapsed < threshold) continue
          const loc = (t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
          flags.push({ name, site: siteLabel(String(loc)), clockInAt: inEff, elapsedHours: Math.round(elapsed * 100) / 100 })
        }
      }
    }
  } catch (e) {
    return json({ error: 'isolved_error', message: e instanceof Error ? e.message : String(e) }, 502)
  }

  // Group by site, worst (longest) first.
  const bySite = new Map<string, Flag[]>()
  for (const f of flags) { const a = bySite.get(f.site) ?? []; a.push(f); bySite.set(f.site, a) }
  const sites = [...bySite.entries()]
    .map(([site, list]) => ({ site, list: list.sort((a, b) => b.elapsedHours - a.elapsedHours) }))
    .sort((a, b) => siteNumOf(a.site) - siteNumOf(b.site))

  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })

  const headline = flags.length === 0
    ? `<p style="margin:0 0 8px;font-size:15px;color:#047857;font-weight:600;">✓ No unusual clock-ins this morning.</p>
       <p style="margin:0;color:#555;font-size:14px;">Everyone is clocked out or within a normal shift (open punches under ${threshold}h).</p>`
    : `<p style="margin:0 0 4px;font-size:16px;color:#b91c1c;font-weight:700;">${flags.length} unusual clock-in${flags.length === 1 ? '' : 's'} across ${sites.length} site${sites.length === 1 ? '' : 's'}.</p>
       <p style="margin:0 0 16px;color:#555;font-size:13px;">Open punches running longer than ${threshold}h — likely missed clock-outs. Review and correct in iSolved.</p>`

  const siteBlocks = sites.map((s) => `
    <div style="margin:0 0 14px;">
      <div style="font-weight:700;color:#111;font-size:14px;border-bottom:1px solid #e4e7eb;padding-bottom:4px;margin-bottom:6px;">${esc(s.site)} <span style="color:#888;font-weight:600;">· ${s.list.length}</span></div>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        ${s.list.map((f) => `<tr>
          <td style="padding:4px 10px 4px 0;color:#111;font-weight:600;">${esc(f.name)}</td>
          <td style="padding:4px 10px;color:#666;">in ${esc(clockMoment(f.clockInAt))}</td>
          <td style="padding:4px 0;color:#b91c1c;font-weight:700;text-align:right;white-space:nowrap;">${esc(fmtElapsed(f.elapsedHours))}</td>
        </tr>`).join('')}
      </table>
    </div>`).join('')

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 2px;font-size:20px;">Unusual Clock-Ins</h2>
      <p style="margin:0 0 16px;color:#888;font-size:13px;">${esc(dateLabel)} · 6:00 AM report</p>
      ${headline}
      ${flags.length ? `<div style="margin-top:18px;">${siteBlocks}</div>` : ''}
      <p style="margin:22px 0 0;color:#888;font-size:12px;">An "unusual clock-in" is an open iSolved punch still running after ${threshold}+ hours. Sent from WashLyfe Operator.</p>
    </div>`

  if (body.dryRun) return json({ ok: true, dryRun: true, count: flags.length, sites: sites.map((s) => ({ site: s.site, n: s.list.length })) }, 200)

  const to = body.to ? [body.to] : DEFAULT_TO
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const resend = new Resend(resendKey)
  try {
    const { error: sendErr } = await resend.emails.send({
      from, to,
      subject: `Unusual Clock-Ins — ${dateLabel}${flags.length ? ` (${flags.length})` : ' (all clear)'}`,
      html,
    })
    if (sendErr) return json({ ok: false, error: (sendErr as { message?: string }).message ?? 'send_failed' }, 502)
    return json({ ok: true, to, count: flags.length }, 200)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502)
  }
})
