// clock-in-alert-email — Supabase Edge Function (Deno).
// Every morning at 6:00 AM Central, emails an "unusual clock-ins" report: people
// still clocked in on an OPEN iSolved punch that has run longer than a normal
// shift (the same "check punch" flag the On the Clock view shows), grouped by
// site. These are almost always missed clock-outs from the day before. It also
// lists yesterday's double clock-ins not yet corrected (findDoubleClockIns below),
// by email and text.
//
// Runs in two phases, each scheduled twice by pg_cron so one lands on the right
// Central time year-round (the hour guard lets only the 6 AM Central call through):
//   { phase: 'email' }  11:00 & 12:00 UTC = 6:00 AM Central -> the email
//   { phase: 'sms' }    11:30 & 12:30 UTC = 6:30 AM Central -> the texts
// With no phase (manual runs), it does both. Unless { force: true }, it only
// proceeds during the 6 AM Central hour.
//
// Regional managers also get a text on mornings their region has a flag, listing
// only their sites. "Their sites" comes from Company settings (Regions, plus the
// Regional manager name assigned to each region for the current quarter), not
// from login access: RMs can open every site. RMs are matched by name and must be
// opted in to texts with a phone on file.
//
// Body: { force?: boolean, to?: string, dryRun?: boolean, thresholdHours?: number,
//         rmPreview?: boolean, doublesDate?: 'YYYY-MM-DD' }  rmPreview returns each
//         RM's text without sending anything (no email, no texts). dryRun returns
//         the flags, the email and the text, sending nothing. doublesDate looks at
//         that day's double clock-ins instead of yesterday's (for checking).
// Auth: service role (cron) or an owner of the Mighty Wash account (manual test).
// Secrets: RESEND_API_KEY (required), RESEND_FROM (optional), ISOLVED_* .

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// deno-lint-ignore no-explicit-any
type Any = any
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const DEFAULT_TO = ['kjowers@mighty-wash.com', 'lkeith@mighty-wash.com']
// Who gets the report as a TEXT (resolved to their users.phone at send time).
const SMS_EMAILS = ['lkeith@mighty-wash.com', 'kevan@washlyfe.com']
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

// --- Double clock-ins ------------------------------------------------------
// Clock-in punches in a row with no clock-out between. iSolved only counts hours
// from the last clock-in to the clock-out and leaves the earlier in-punch with no
// hours (out time == in time, no outPunchId), so the time before the last clock-in
// goes missing until someone corrects it. Seen: in 11:58 AM, in 3:26 PM, in 3:54 PM,
// out 7:02 PM counted 3.1 hours.
//
// Only an in-punch still unmatched on the timecard can start a double: one iSolved
// paired with a clock-out has its hours, and a manager's fix (a clock-out added, or
// the stray in removed) leaves no unmatched in, so it drops off. Seen: in 7:24 AM,
// in 10:59 AM, out 10:59 AM paired 7:24 to 10:59, with nothing missing.
//
// timecardData pairs punches into entries, so this rebuilds the person's punches in
// order: an inPunchId is a clock-in, an outPunchId a clock-out, and a block with no
// punch ids (manual or scheduled) counts as a clock-out at its end time, like the
// "genuine clock-out" rule the open-punch check uses. Punch ids break ties, so an
// in and an out in the same minute (a lone out-punch entry) stay in order and don't
// read as a double. Midnight in-times are day splits, not punches. A chain is
// reported on the day its repeat clock-in happened.
type DoubleChain = { ins: string[]; outAt: string | null; loc: string; gapHours: number }
function findDoubleClockIns(entries: Any[], date: string, nowIso: string): DoubleChain[] {
  type Ev = { at: string; kind: 'in' | 'out'; id: number; punch: boolean; loc: string; unmatched?: boolean }
  const evs: Ev[] = []
  const seen = new Set<string>()
  const once = (key: string) => { if (seen.has(key)) return false; seen.add(key); return true }
  for (const t of entries) {
    const i = String(t.inPunchDateTimeEffective ?? '')
    const o = String(t.outPunchDateTimeEffective ?? '')
    const loc = String((t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? '')
    if (t.inPunchId != null && i && !isMidnight(i) && once(`i${t.inPunchId}`)) {
      evs.push({ at: i, kind: 'in', id: Number(t.inPunchId), punch: true, loc, unmatched: t.outPunchId == null && !(o > i) })
    }
    if (t.outPunchId != null && o) {
      if (once(`o${t.outPunchId}`)) evs.push({ at: o, kind: 'out', id: Number(t.outPunchId), punch: true, loc })
    } else if (o && o > i) {
      evs.push({ at: o, kind: 'out', id: 0, punch: false, loc })
    }
  }
  const ordered = evs.filter((e) => e.at <= nowIso)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id))
  const out: DoubleChain[] = []
  let chain: Ev[] = []
  const close = (closer: Ev | null) => {
    if (chain.length > 1 && chain.slice(1).some((e) => e.at.slice(0, 10) === date)) {
      const ins = chain.map((e) => e.at)
      out.push({
        ins,
        outAt: closer?.punch ? closer.at : null,
        loc: chain[chain.length - 1].loc,
        gapHours: Math.round(diffHours(ins[0], ins[ins.length - 1]) * 100) / 100,
      })
    }
    chain = []
  }
  for (const e of ordered) {
    if (e.kind === 'out') close(e)
    else if (e.unmatched || chain.length) chain.push(e)
  }
  close(null)
  return out
}
// "1:17 PM, 2:05 PM, out 2:28 PM": the day is dropped when every punch shares one.
function doubleTimes(d: DoubleChain, labels = false): string {
  const all = d.outAt ? [...d.ins, d.outAt] : d.ins
  const oneDay = all.every((a) => a.slice(0, 10) === all[0].slice(0, 10))
  const when = (a: string, n: number) => (oneDay && n > 0 ? clockMoment(a).replace(/^\w+ /, '') : clockMoment(a))
  const ins = d.ins.map((a, n) => (labels ? (n ? 'in again ' : 'in ') : '') + when(a, n)).join(', ')
  return ins + (d.outAt ? `, out ${when(d.outAt, d.ins.length)}` : labels ? ', no clock-out yet' : '')
}

// --- Regional manager targeting ------------------------------------------
const normName = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
// First day of the quarter containing a YYYY-MM-DD date, e.g. 2026-10-22 -> 2026-10-01.
function quarterStart(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
}
// Regional manager names are effective-dated by quarter (latest entry on or
// before the quarter wins); a legacy flat string applies to every quarter.
function effectiveManager(val: unknown, quarter: string): string | null {
  if (typeof val === 'string') return val.trim() || null
  if (!val || typeof val !== 'object') return null
  const keys = Object.keys(val as Record<string, string>).filter((k) => k <= quarter).sort()
  const name = keys.length ? (val as Record<string, string>)[keys[keys.length - 1]] : null
  return name?.trim() || null
}

type RmTarget = { name: string; phone: string; regions: string[]; sites: Set<string> }
async function regionalTargets(svc: Any, today: string): Promise<{ targets: RmTarget[]; unmatched: string[]; notOptedIn: string[] }> {
  const { data: acct } = await svc.from('accounts').select('company_settings').eq('id', MW_ACCOUNT).single()
  const settings = (acct?.company_settings ?? {}) as Any
  const regions: Array<{ name: string; siteIds?: string[] }> = Array.isArray(settings.regions) ? settings.regions : []
  const managers: Record<string, unknown> = settings.regionalManagers ?? {}
  const { data: locs } = await svc.from('locations').select('id, name').eq('account_id', MW_ACCOUNT)
  const locName = new Map<string, string>((locs ?? []).map((l: Any) => [l.id as string, String(l.name).trim().toUpperCase()]))
  const { data: rms } = await svc
    .from('users')
    .select('name, phone, sms_opt_in')
    .eq('account_id', MW_ACCOUNT)
    .eq('role_category', 'regional_manager')
  const byName = new Map<string, Any>((rms ?? []).map((u: Any) => [normName(u.name), u]))

  const quarter = quarterStart(today)
  const out = new Map<string, RmTarget>()
  const unmatched: string[] = []
  const notOptedIn: string[] = []
  for (const r of regions) {
    const mgr = effectiveManager(managers[r.name], quarter)
    if (!mgr) continue
    const u = byName.get(normName(mgr))
    if (!u) { unmatched.push(`${r.name}: "${mgr}" matches no Regional Manager login`); continue }
    if (!u.sms_opt_in || !u.phone) { notOptedIn.push(`${r.name}: ${u.name}`); continue }
    const t = out.get(u.phone) ?? { name: u.name, phone: u.phone, regions: [], sites: new Set<string>() }
    t.regions.push(r.name)
    for (const id of r.siteIds ?? []) { const n = locName.get(id); if (n) t.sites.add(n) }
    out.set(u.phone, t)
  }
  return { targets: [...out.values()], unmatched, notOptedIn }
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

  let body: { force?: boolean; to?: string; dryRun?: boolean; thresholdHours?: number; smsTo?: string | string[]; smsOnly?: boolean; rmPreview?: boolean; phase?: string; doublesDate?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const doEmail = body.phase !== 'sms' && !body.smsOnly
  const doSms = body.phase !== 'email'

  // Send an SMS via Twilio directly (the same call send-sms makes). Inlined rather
  // than hopping through send-sms so it doesn't depend on the service key format.
  const sendSms = async (to: string, text: string): Promise<Any> => {
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const keySid = Deno.env.get('TWILIO_API_KEY_SID')
    const keySecret = Deno.env.get('TWILIO_API_KEY_SECRET')
    const fromNum = Deno.env.get('TWILIO_FROM')
    const messagingServiceSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')
    if (!accountSid || !keySid || !keySecret || (!fromNum && !messagingServiceSid)) return { to, ok: false, error: 'twilio_not_configured' }
    if (!/^\+\d{8,15}$/.test(to)) return { to, ok: false, error: 'bad_number' }
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
      if (!res.ok) return { to, ok: false, status: res.status, code: d?.code, error: d?.message ?? 'twilio_error' }
      return { to, ok: true, sid: d?.sid, status: d?.status }
    } catch (e) {
      return { to, ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

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
  // Double clock-ins are reported the morning after, once the whole day is in, so
  // each shows up once (a time-of-day cutoff would trip over Mountain-time sites).
  const doublesDate = /^\d{4}-\d{2}-\d{2}$/.test(body.doublesDate ?? '') ? body.doublesDate! : addDays(today, -1)
  const start = [addDays(today, -LOOKBACK_DAYS), addDays(doublesDate, -LOOKBACK_DAYS)].sort()[0]

  // Pull punches and find OPEN ones (clocked in, no out) running past the shift
  // threshold, and double clock-ins. The iSolved API is 0-indexed; page from 0
  // until an empty page.
  type Flag = { name: string; site: string; clockInAt: string; elapsedHours: number }
  type DoubleFlag = DoubleChain & { name: string; site: string }
  const flags: Flag[] = []
  const doubles: DoubleFlag[] = []
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
        const name = [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || String(r.employeeNumber ?? '')
        // Latest genuine clock-OUT (out TIME after the in) for this person. iSolved
        // stores completed blocks with null punch IDs but real times, and leaves
        // stale in-punches whose out == in; key off the out time, not the punch id.
        let latestOut = ''
        for (const t of r.timecardData ?? []) {
          const i = String(t.inPunchDateTimeEffective ?? '')
          const o = String(t.outPunchDateTimeEffective ?? '')
          if (o && (t.outPunchId != null || o > i) && o > latestOut) latestOut = o
        }
        // A double clock-in leaves two open in-punches: one line per person, the
        // longest (the double itself is listed below).
        let longest: Flag | null = null
        for (const t of r.timecardData ?? []) {
          const inEff = String(t.inPunchDateTimeEffective ?? '')
          const outEff = String(t.outPunchDateTimeEffective ?? '')
          const hasOut = !!outEff && (t.outPunchId != null || outEff > inEff)
          const open = !!inEff && !isMidnight(inEff) && !hasOut
            && (!latestOut || inEff > latestOut)
          if (!open) continue
          const elapsed = Math.max(0, diffHours(inEff, cNow.iso))
          if (elapsed < threshold) continue
          const loc = (t.labors ?? []).find((l: Any) => l.laborTitle === 'Location')?.laborValue ?? ''
          const flag: Flag = { name, site: siteLabel(String(loc)), clockInAt: inEff, elapsedHours: Math.round(elapsed * 100) / 100 }
          if (!longest || flag.elapsedHours > longest.elapsedHours) longest = flag
        }
        if (longest) flags.push(longest)
        for (const d of findDoubleClockIns(r.timecardData ?? [], doublesDate, cNow.iso)) {
          doubles.push({ ...d, name, site: siteLabel(d.loc) })
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
  // Doubles by site, biggest gap first.
  const byDoubleSite = new Map<string, DoubleFlag[]>()
  for (const d of doubles) { const a = byDoubleSite.get(d.site) ?? []; a.push(d); byDoubleSite.set(d.site, a) }
  const doubleSites = [...byDoubleSite.entries()]
    .map(([site, list]) => ({ site, list: list.sort((a, b) => b.gapHours - a.gapHours) }))
    .sort((a, b) => siteNumOf(a.site) - siteNumOf(b.site))
  const total = flags.length + doubles.length

  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
  const doubleDay = new Date(doublesDate + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })

  const allClear = `<p style="margin:0 0 8px;font-size:15px;color:#047857;font-weight:600;">✓ No unusual clock-ins this morning.</p>
       <p style="margin:0;color:#555;font-size:14px;">Everyone is clocked out or within a normal shift (open punches under ${threshold}h), and no double clock-ins from ${esc(doubleDay)} are waiting to be corrected.</p>`
  const openHead = `<p style="margin:0 0 4px;font-size:16px;color:#b91c1c;font-weight:700;">${flags.length} unusual clock-in${flags.length === 1 ? '' : 's'} across ${sites.length} site${sites.length === 1 ? '' : 's'}.</p>
       <p style="margin:0 0 16px;color:#555;font-size:13px;">Open punches running longer than ${threshold}h: likely missed clock-outs. Review and correct in iSolved.</p>`
  const doubleHead = `<p style="margin:0 0 4px;font-size:16px;color:#b45309;font-weight:700;">${doubles.length} double clock-in${doubles.length === 1 ? '' : 's'} on ${esc(doubleDay)}, across ${doubleSites.length} site${doubleSites.length === 1 ? '' : 's'}.</p>
       <p style="margin:0 0 16px;color:#555;font-size:13px;">Clocked in again without clocking out first. iSolved only counts hours from the last clock-in, so the gap is missing until it's corrected in iSolved.</p>`

  const doubleBlocks = doubleSites.map((s) => `
    <div style="margin:0 0 14px;">
      <div style="font-weight:700;color:#111;font-size:14px;border-bottom:1px solid #e4e7eb;padding-bottom:4px;margin-bottom:6px;">${esc(s.site)} <span style="color:#888;font-weight:600;">· ${s.list.length}</span></div>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        ${s.list.map((d) => `<tr>
          <td style="padding:4px 10px 4px 0;color:#111;font-weight:600;">${esc(d.name)}</td>
          <td style="padding:4px 10px;color:#666;">${esc(doubleTimes(d, true))}</td>
          <td style="padding:4px 0;color:#b45309;font-weight:700;text-align:right;white-space:nowrap;">${esc(fmtElapsed(d.gapHours))} gap</td>
        </tr>`).join('')}
      </table>
    </div>`).join('')

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
      ${total === 0 ? allClear : ''}
      ${flags.length ? `${openHead}<div style="margin-top:18px;">${siteBlocks}</div>` : ''}
      ${doubles.length ? `<div style="margin-top:${flags.length ? '26px' : '0'};">${doubleHead}<div style="margin-top:18px;">${doubleBlocks}</div></div>` : ''}
      <p style="margin:22px 0 0;color:#888;font-size:12px;">An "unusual clock-in" is an open iSolved punch still running after ${threshold}+ hours. A double clock-in is two or more clock-ins in a row with no clock-out between that hasn't been corrected in iSolved yet. Sent from WashLyfe Operator.</p>
    </div>`

  // Compact SMS version of the report, for all sites or one RM's subset.
  const shortDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })
  const buildSms = (open: typeof sites, dbl: typeof doubleSites, scope?: string): string => {
    const nOpen = open.reduce((a, s) => a + s.list.length, 0)
    const nDouble = dbl.reduce((a, s) => a + s.list.length, 0)
    const head = `Unusual Clock-Ins ${shortDate}${scope ? ` (${scope})` : ''}`
    if (nOpen + nDouble === 0) return `${head}: all clear, no open punches over ${threshold}h or double clock-ins.`
    const counts: string[] = []
    if (nOpen) counts.push(`${nOpen} open punch${nOpen === 1 ? '' : 'es'} over ${threshold}h`)
    if (nDouble) counts.push(`${nDouble} double clock-in${nDouble === 1 ? '' : 's'} yesterday`)
    const items: string[] = []
    for (const s of open) for (const f of s.list) items.push(`${s.site} ${f.name} ${fmtElapsed(f.elapsedHours)}`)
    for (const s of dbl) for (const d of s.list) items.push(`${s.site} ${d.name} double: ${doubleTimes(d)}`)
    const shown = items.slice(0, 12)
    const extra = items.length - shown.length
    return `${head}: ${counts.join(', ')}.\n`
      + shown.join('\n') + (extra > 0 ? `\n+${extra} more` : '') + '\nReview in iSolved.'
  }
  const smsText = buildSms(sites, doubleSites)

  if (body.dryRun) {
    return json({
      ok: true, dryRun: true, count: flags.length, sites: sites.map((s) => ({ site: s.site, n: s.list.length })),
      doublesDate, doubleCount: doubles.length,
      doubles: doubles.map((d) => ({ name: d.name, site: d.site, ins: d.ins, outAt: d.outAt, gapHours: d.gapHours })),
      html, sms: smsText,
    }, 200)
  }

  // Each RM's slice of the report: only the flagged sites in their region(s).
  const rm = await regionalTargets(svc, today)
  const rmPlans = rm.targets.map((t) => {
    const inRegion = (s: { site: string }) => t.sites.has(s.site.toUpperCase())
    const open = sites.filter(inRegion)
    const dbl = doubleSites.filter(inRegion)
    const count = [...open, ...dbl].reduce((a, s) => a + s.list.length, 0)
    return { target: t, count, text: buildSms(open, dbl, t.regions.join(' + ')) }
  })
  if (body.rmPreview) {
    const covered = new Set(rm.targets.flatMap((t) => [...t.sites]))
    return json({
      ok: true,
      preview: true,
      count: flags.length,
      doubleCount: doubles.length,
      regional: rmPlans.map((p) => ({
        name: p.target.name,
        phone: '•••' + p.target.phone.slice(-4),
        regions: p.target.regions,
        sites: [...p.target.sites].sort(),
        count: p.count,
        willSend: p.count > 0,
        text: p.text,
      })),
      unmatched: rm.unmatched,
      notOptedIn: rm.notOptedIn,
      flaggedSitesWithNoRm: [...new Set([...sites, ...doubleSites].map((s) => s.site))].filter((site) => !covered.has(site.toUpperCase())),
    }, 200)
  }

  // Email (default recipients), unless this is an SMS-only test.
  let email: Any = { skipped: true }
  if (doEmail) {
    const to = body.to ? [body.to] : DEFAULT_TO
    const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
    const resend = new Resend(resendKey)
    try {
      const { error: sendErr } = await resend.emails.send({
        from, to,
        subject: `Unusual Clock-Ins: ${dateLabel}${total ? ` (${total})` : ' (all clear)'}`,
        html,
      })
      email = sendErr ? { ok: false, error: (sendErr as { message?: string }).message ?? 'send_failed' } : { ok: true, to }
    } catch (e) {
      email = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Text the report to Laramie on alert mornings. All-clear stays email-only
  // unless this is a test (smsTo override), which always sends so it can be seen.
  const isTest = !!body.smsTo
  const sms: Any[] = []
  if (doSms && (isTest || total > 0)) {
    let recipients: string[]
    if (body.smsTo) {
      recipients = (Array.isArray(body.smsTo) ? body.smsTo : [body.smsTo]).map((s) => String(s).trim()).filter(Boolean)
    } else {
      const { data: us } = await svc.from('users').select('phone').in('email', SMS_EMAILS).not('phone', 'is', null)
      recipients = (us ?? []).map((u: Any) => String(u.phone).trim()).filter(Boolean)
    }
    for (const r of recipients) sms.push(await sendSms(r, smsText))
  }

  // Regional managers: only on the real scheduled run (never during a manual test
  // with smsTo / to / smsOnly), and only when their own sites have a flag.
  const regional: Any[] = []
  if (doSms && !body.smsTo && !body.to && !body.smsOnly) {
    for (const p of rmPlans) {
      if (p.count === 0) continue
      regional.push({ name: p.target.name, regions: p.target.regions, count: p.count, ...(await sendSms(p.target.phone, p.text)) })
    }
  }

  return json({ ok: true, count: flags.length, doubleCount: doubles.length, email, sms, regional, unmatched: rm.unmatched }, 200)
})
