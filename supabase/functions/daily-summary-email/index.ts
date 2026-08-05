// daily-summary-email — Supabase Edge Function (Deno).
// Sends the Mighty Wash morning digest (car counts, sales, recharge, membership,
// churn/conversion) with comparisons to the same weekday last week + the monthly
// membership trend. Scheduled by pg_cron at 12:40 & 13:40 UTC; the function only
// actually sends when it is 7:50am Central (guards on the America/Chicago hour),
// so it fires exactly once whether Central is on CDT or CST.
//
// Body (optional): { force?: true, to?: "override@…" }  — force bypasses the
// time guard for manual testing; to overrides the recipient.
//
// Secrets: RESEND_API_KEY (required). Optional: RESEND_FROM, SUMMARY_EMAIL_TO.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

const DEFAULT_TO = 'kjowers@mighty-wash.com'

// --- Mighty Wash dashboard (guided query) --------------------------------
// Daily membership sales, conversion, churn, and year-over-year come from the
// live dashboard (same source as Site Performance), not the SQL archive.
const DASH_BASE = (Deno.env.get('MW_DASHBOARD_URL') ?? 'https://dashboard.tail1e050b.ts.net').replace(/\/$/, '')
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

async function dashLogin(password: string): Promise<string> {
  const res = await fetch(`${DASH_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
    body: `password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  })
  const m = (res.headers.get('set-cookie') ?? '').match(/session=[^;]+/)
  if (!m) throw new Error(`dashboard login failed (${res.status})`)
  return m[0]
}

// One guided-query metric for every site over a single day. Returns the raw
// { columns, rows } (rows end with a ["TOTAL", n] row for count metrics), or
// null on any failure so the email still sends.
// deno-lint-ignore no-explicit-any
async function gq(cookie: string, metric: string, day: string): Promise<any | null> {
  try {
    const r = await fetch(`${DASH_BASE}/api/guided_query`, {
      method: 'POST',
      headers: { Cookie: cookie, 'User-Agent': BROWSER_UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric, sites: [], start: day, end: day }),
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
// Monthly TTAF report (per-site recharge + retail dollars), keyed "YYYY-MM".
// deno-lint-ignore no-explicit-any
async function fetchTtaf(cookie: string): Promise<any | null> {
  try {
    const r = await fetch(`${DASH_BASE}/api/ttaf_report`, {
      headers: { Cookie: cookie, 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
// deno-lint-ignore no-explicit-any
function gqTotal(res: any): number | null {
  const rows = res?.rows as [string, number][] | undefined
  if (!rows) return null
  const t = rows.find((r) => String(r[0]).toUpperCase() === 'TOTAL')
  return t ? Number(t[1]) : rows.reduce((s, r) => s + Number(r[1] || 0), 0)
}
// deno-lint-ignore no-explicit-any
function gqAvg(res: any): number | null {
  const rows = (res?.rows as [string, number][] | undefined)?.filter((r) => String(r[0]).toUpperCase() !== 'TOTAL')
  if (!rows || rows.length === 0) return null
  return rows.reduce((s, r) => s + Number(r[1] || 0), 0) / rows.length
}
// Per-site values keyed by the dashboard's site name (already "MightyWash 0NN").
// deno-lint-ignore no-explicit-any
function gqMap(res: any): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of (res?.rows as [string, number][] | undefined) ?? []) {
    if (String(r[0]).toUpperCase() !== 'TOTAL') m.set(String(r[0]), Number(r[1]))
  }
  return m
}
function mapAvg(m: Map<string, number>): number | null {
  if (m.size === 0) return null
  let s = 0
  for (const v of m.values()) s += v
  return s / m.size
}

// Company churn = average of voluntary and credit-card churn across sites,
// skipping any site whose combined churn is 0. A 0% reading is almost always a
// missing/failed data point, not a real value, and would otherwise deflate the
// average. Both halves are averaged over the same set of valid sites.
function churnAverages(vol: Map<string, number>, cc: Map<string, number>): { vol: number | null; cc: number | null } {
  const keys = new Set<string>([...vol.keys(), ...cc.keys()])
  let sv = 0, sc = 0, n = 0
  for (const k of keys) {
    const v = vol.get(k) ?? 0
    const c = cc.get(k) ?? 0
    if (v + c <= 0) continue
    sv += v
    sc += c
    n++
  }
  return n === 0 ? { vol: null, cc: null } : { vol: sv / n, cc: sc / n }
}

// The FlexWash sites (17, 18) aren't in the SiteWatch dashboard, so their churn
// and new-membership numbers come from FlexWash instead. We call FlexWash
// DIRECTLY (a function-to-function call through the flexwash proxy silently
// fails — sync-flexwash hit the same). Token is cached in service_tokens (24h).
// carWashId 352 = MW17, 350 = MW18.
const FLEX_BASE = 'https://api.flexwash.com'
const FLEX_SITES = [{ n: 17, cw: '352' }, { n: 18, cw: '350' }, { n: 29, cw: '423' }, { n: 30, cw: '424' }]
// deno-lint-ignore no-explicit-any
async function flexToken(svc: any): Promise<string | null> {
  const { data: cached } = await svc.from('service_tokens').select('token, expires_at').eq('provider', 'flexwash').maybeSingle()
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) return cached.token as string
  const id = Deno.env.get('FLEXWASH_CLIENT_ID')
  const secret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  if (!id || !secret) return null
  try {
    const res = await fetch(`${FLEX_BASE}/external/access-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: id, clientSecret: secret }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.accessToken) return null
    await svc.from('service_tokens').upsert(
      { provider: 'flexwash', token: j.accessToken, expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'provider' },
    )
    return j.accessToken as string
  } catch { return null }
}
// deno-lint-ignore no-explicit-any
async function flexCall(token: string, path: string, body: unknown): Promise<any | null> {
  try {
    const r = await fetch(`${FLEX_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}
const json = (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

const nf = (n: number) => Math.round(n).toLocaleString('en-US')
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// A signed percentage-change chip, coloured green up / red down.
function delta(cur: number, base: number | null | undefined): string {
  if (base == null || base === 0) return '<span style="color:#94a3b8">n/a</span>'
  const pct = ((cur - base) / base) * 100
  const up = pct >= 0
  const c = up ? '#16a34a' : '#dc2626'
  return `<span style="color:${c};font-weight:600">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`
}
function deltaPts(cur: number, base: number, goodUp: boolean): string {
  const d = cur - base
  const good = goodUp ? d >= 0 : d <= 0
  const c = good ? '#16a34a' : '#dc2626'
  const sign = d >= 0 ? '+' : ''
  return `<span style="color:${c};font-weight:600">${sign}${d.toFixed(2)} pts</span>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key' }, 503)
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: service-role (cron) or an owner of the account (manual test).
  const authHeader = req.headers.get('Authorization') ?? ''
  if (jwtRole(authHeader) !== 'service_role') {
    const uc = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await uc.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users').select('role').eq('id', u.user.id).single()
    if (!p || p.role !== 'owner') return json({ error: 'forbidden' }, 403)
  }

  let body: { force?: boolean; to?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  // Time guard: only send at 7am Central unless forced.
  const chicagoHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()))
  if (!body.force && chicagoHour !== 7) return json({ skipped: true, reason: 'not 7am Central', chicagoHour }, 200)

  // deno-lint-ignore no-explicit-any
  const { data: d, error } = await svc.rpc('mw_daily_summary') as { data: any; error: unknown }
  if (error || !d) return json({ error: 'data_failed', detail: String(error) }, 500)

  const day = d.day, prev = d.prev_day
  const mem = d.membership, memPrev = d.membership_prev
  const sites: Array<{ site: string; n: number; cars: number; sales: number; recharge: number; cph: number | null; cars_lw: number | null }> = d.sites ?? []
  const rdate = new Date(d.reporting_date + 'T12:00:00')
  const dateLabel = rdate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })

  // Live dashboard enrichment: daily membership sales, conversion, churn, and
  // same-day-last-year for YoY. Best-effort — the email still sends if the
  // dashboard is unreachable (it falls back to the monthly membership block).
  const rday = d.reporting_date as string
  const lyDate = new Date(d.reporting_date + 'T12:00:00'); lyDate.setFullYear(lyDate.getFullYear() - 1)
  const lyStr = lyDate.toISOString().slice(0, 10)
  let dash: {
    yoyCars: number | null; yoyRevenue: number | null; yoyRecharge: number | null; plansTotal: number | null
    plansMighty: number | null; plansSuper: number | null; plansWonder: number | null
    conversion: number | null; churnVol: number | null; churnCc: number | null
    convBySite: Map<string, number>; churnVolBySite: Map<string, number>; churnCcBySite: Map<string, number>
    carsLyBySite: Map<string, number>
  } | null = null
  // Yesterday's retail (non-membership, non-recharge sales): the day-over-day
  // increase in the TTAF month-to-date retail. Null until a baseline snapshot
  // exists (first run) or if the dashboard is unreachable.
  let retailDay: number | null = null
  // Actual-money Sales (member-wash value removed): SiteWatch sites use TTAF
  // (recharge + retail) via the day-over-day month-to-date delta; FlexWash sites
  // already report actual money. Null until a baseline snapshot exists.
  let netSales: number | null = null
  const dashPw = Deno.env.get('MW_DASHBOARD_PASSWORD')
  if (dashPw) {
    try {
      const cookie = await dashLogin(dashPw)

      // Retail + actual-money: sum this month's retail_dollars and ttaf across
      // SiteWatch sites (month-to-date), diff against the previous day's
      // snapshot, then store today's snapshot.
      try {
        const ttaf = await fetchTtaf(cookie)
        const monthKey = rday.slice(0, 7)
        const bucket = ttaf?.months?.[monthKey]
        if (bucket) {
          const flexNums = new Set(FLEX_SITES.map((s) => s.n))
          // deno-lint-ignore no-explicit-any
          const rows = Object.values(bucket as Record<string, any>)
          const retailMtdNow = rows.reduce((s, x) => s + (Number(x.retail_dollars) || 0), 0)
          // Exclude FlexWash site numbers so they aren't double-counted (their
          // actual money is added from FlexWash below).
          const ttafMtdNow = rows.reduce((s, x) => (flexNums.has(Number(x.site_number)) ? s : s + (Number(x.ttaf) || 0)), 0)
          const flexActualDay = sites.filter((s) => flexNums.has(s.n)).reduce((a, s) => a + (Number(s.sales) || 0), 0)

          const { data: prev } = await svc
            .from('ttaf_retail_snapshots')
            .select('month_key, retail_mtd, ttaf_mtd')
            .eq('account_id', MW_ACCOUNT)
            .lt('snapshot_date', rday)
            .order('snapshot_date', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (prev) {
            // Same month -> subtract prior cumulative; new month -> the whole
            // (small) new-month total is the day's figure.
            retailDay = Math.max(0, retailMtdNow - (prev.month_key === monthKey ? Number(prev.retail_mtd) : 0))
            if (prev.ttaf_mtd != null) {
              const siteWatchActual = Math.max(0, ttafMtdNow - (prev.month_key === monthKey ? Number(prev.ttaf_mtd) : 0))
              netSales = siteWatchActual + flexActualDay
            }
          }
          await svc.from('ttaf_retail_snapshots').upsert(
            { account_id: MW_ACCOUNT, snapshot_date: rday, month_key: monthKey, retail_mtd: retailMtdNow, ttaf_mtd: ttafMtdNow, updated_at: new Date().toISOString() },
            { onConflict: 'account_id,snapshot_date' },
          )
        }
      } catch { /* best-effort */ }

      const [carsLy, revLy, rechLy, plansT, plansM, plansS, plansW, conv, cvol, ccc] = await Promise.all([
        gq(cookie, 'cars', lyStr), gq(cookie, 'revenue', lyStr), gq(cookie, 'recharge', lyStr),
        gq(cookie, 'plans_total', rday), gq(cookie, 'plans_mighty', rday), gq(cookie, 'plans_super', rday), gq(cookie, 'plans_wonder', rday),
        gq(cookie, 'conversion_pct', rday), gq(cookie, 'churn_voluntary', rday), gq(cookie, 'churn_cc', rday),
      ])
      const convBySite = gqMap(conv)
      const churnVolBySite = gqMap(cvol)
      const churnCcBySite = gqMap(ccc)
      const carsLyBySite = gqMap(carsLy)
      let plansTotal = gqTotal(plansT) ?? 0
      let plansMighty = gqTotal(plansM) ?? 0
      let plansSuper = gqTotal(plansS) ?? 0
      let plansWonder = gqTotal(plansW) ?? 0

      // Fold in the FlexWash sites (17, 18): churn (trailing 30 days, per site,
      // returned as fractions -> percentages) and new memberships (by tier).
      try {
        const flexTok = await flexToken(svc)
        if (flexTok) {
          const since30 = new Date(new Date(rday + 'T12:00:00').getTime() - 30 * 86400000).toISOString().slice(0, 10)
          for (const fs of FLEX_SITES) {
            const key = 'MightyWash ' + String(fs.n).padStart(3, '0')
            const ch = await flexCall(flexTok, '/external/memberships/get-churn-percentages', {
              carWashIds: [fs.cw], dateRange: { start: since30, end: rday },
            })
            if (ch) {
              churnVolBySite.set(key, Number(ch.voluntaryChurnPercent || 0) * 100)
              churnCcBySite.set(key, Number(ch.involuntaryChurnPercent || 0) * 100)
            }
          }
          const nm = await flexCall(flexTok, '/external/memberships/get-new-membership-stats', {
            carWashIds: FLEX_SITES.map((s) => s.cw), dateRange: { start: rday, end: rday },
          })
          if (nm) {
            plansTotal += Number(nm.count || 0)
            for (const p of (nm.byPackageTemplate ?? []) as Array<{ packageTemplateName?: string; count?: number }>) {
              const name = String(p.packageTemplateName || '')
              const c = Number(p.count || 0)
              if (/mighty/i.test(name)) plansMighty += c
              else if (/super/i.test(name)) plansSuper += c
              else if (/wonder/i.test(name)) plansWonder += c
            }
          }
        }
      } catch { /* FlexWash is best-effort */ }

      const chAvg = churnAverages(churnVolBySite, churnCcBySite)
      dash = {
        yoyCars: gqTotal(carsLy), yoyRevenue: gqTotal(revLy), yoyRecharge: gqTotal(rechLy),
        plansTotal, plansMighty, plansSuper, plansWonder,
        conversion: mapAvg(convBySite), churnVol: chAvg.vol, churnCc: chAvg.cc,
        convBySite, churnVolBySite, churnCcBySite, carsLyBySite,
      }
    } catch { dash = null }
  }
  const yoySub = (cur: number, prev: number | null | undefined) => (prev != null ? `${delta(cur, prev)} vs last year` : '')

  const memTotal = (m: { mighty: number; super: number; wonder: number }) => m.mighty + m.super + m.wonder

  const kpi = (label: string, value: string, sub: string) => `
    <td style="padding:8px;">
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;">${label}</div>
        <div style="font-size:24px;font-weight:700;color:#0f172a;margin-top:2px;">${value}</div>
        <div style="font-size:12px;color:#475569;margin-top:4px;">${sub}</div>
      </div>
    </td>`

  // Uniform display name from the site number (normalizes the FlexWash
  // "Mighty Wash #17" names to match the rest), listed in site-number order.
  const siteName = (n: number) => 'MightyWash ' + String(n).padStart(3, '0')
  const pct = (v: number | undefined) => (v != null ? v.toFixed(1) + '%' : 'n/a')
  // Combined churn = voluntary + credit-card for a site.
  const combinedChurn = (cn: string) => {
    const v = dash?.churnVolBySite.get(cn)
    const c = dash?.churnCcBySite.get(cn)
    if (v == null && c == null) return 'n/a'
    const total = (v ?? 0) + (c ?? 0)
    // A 0% reading is treated as missing, not a real value.
    return total > 0 ? total.toFixed(1) + '%' : 'n/a'
  }
  const siteRows = [...sites].sort((a, b) => a.n - b.n).map((s) => {
    const cn = siteName(s.n)
    return `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${esc(cn)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${nf(s.cars)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${delta(s.cars, dash?.carsLyBySite.get(cn))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${money(s.sales)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${money(s.recharge)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${pct(dash?.convBySite.get(cn))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${combinedChurn(cn)}</td>
    </tr>`
  }).join('')

  // Churn coverage: the headline churn is an average across only the sites that
  // reported a churn figure. When most sites are missing (dashboard outage), that
  // average is unrepresentative, so flag it near the churn card.
  const churnCovered = sites.filter((s) => combinedChurn(siteName(s.n)) !== 'n/a').length
  const churnSparse = sites.length > 0 && churnCovered * 2 < sites.length
  const churnNote = churnSparse
    ? `<div style="font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin:6px 8px 0;">Churn data is currently unavailable for most sites (${churnCovered} of ${sites.length} reporting). The average above reflects only the sites with data and may not represent the company.</div>`
    : ''

  // Preferred: daily membership metrics from the live dashboard. Falls back to
  // the monthly GM-bonus figures only if the dashboard was unreachable.
  const memBlock = (dash && dash.plansTotal != null) ? `
    <h3 style="font-size:14px;color:#0f172a;margin:22px 0 8px;">Membership (${dateLabel})</h3>
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr>
        ${kpi('Plans sold', nf(dash.plansTotal), `Mighty ${nf(dash.plansMighty ?? 0)} · Super ${nf(dash.plansSuper ?? 0)} · Wonder ${nf(dash.plansWonder ?? 0)}`)}
        ${kpi('Conversion', dash.conversion != null ? dash.conversion.toFixed(1) + '%' : 'n/a', 'avg across sites, reporting day')}
        ${kpi('Monthly Churn', dash.churnVol != null || dash.churnCc != null ? ((dash.churnVol ?? 0) + (dash.churnCc ?? 0)).toFixed(1) + '%' : 'n/a', `voluntary ${dash.churnVol != null ? dash.churnVol.toFixed(1) : 'n/a'}% + credit-card ${dash.churnCc != null ? dash.churnCc.toFixed(1) : 'n/a'}%, trailing month`)}
      </tr>
    </table>
    ${churnNote}
  ` : (mem ? `
    <h3 style="font-size:14px;color:#0f172a;margin:22px 0 8px;">Membership for ${new Date(mem.period + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} (latest monthly)</h3>
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr>
        ${kpi('Total members', nf(memTotal(mem)), memPrev ? `${delta(memTotal(mem), memTotal(memPrev))} vs last month` : '')}
        ${kpi('Monthly Churn', mem.churn.toFixed(2) + '%', memPrev ? `${deltaPts(mem.churn, memPrev.churn, false)} vs last month` : '')}
        ${kpi('Conversion', mem.conversion.toFixed(2) + '%', memPrev ? `${deltaPts(mem.conversion, memPrev.conversion, true)} vs last month` : '')}
      </tr>
    </table>
    <div style="font-size:12px;color:#475569;margin-top:6px;">Mighty ${nf(mem.mighty)} · Super ${nf(mem.super)} · Wonder ${nf(mem.wonder)}. Churn/conversion are averages across sites and update monthly.</div>
  ` : '')

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;color:#0f172a;">
    <div style="padding:20px 8px 4px;">
      <div style="font-size:20px;font-weight:700;">Mighty Wash Daily Summary</div>
      <div style="font-size:13px;color:#64748b;">${dateLabel} · ${day.sites} sites reporting</div>
    </div>

    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr>
        ${kpi('Total cars', nf(day.cars), yoySub(day.cars, dash?.yoyCars))}
        ${kpi('Net Sales', netSales != null ? money(netSales) : money(day.sales), netSales != null ? 'recharge + retail (excludes member washes)' : 'gross this day; net not available yet')}
        ${kpi('Recharge', money(day.recharge), yoySub(day.recharge, dash?.yoyRecharge))}
        ${kpi('Retail', retailDay != null ? money(retailDay) : 'n/a', 'sales, excludes memberships + recharge')}
      </tr>
    </table>
    <div style="font-size:12px;color:#475569;padding:2px 8px;">
      Prior day: ${nf(prev?.cars ?? 0)} cars. 4-week ${rdate.toLocaleDateString('en-US', { weekday: 'long' })} average: ${nf(Math.round(d.avg4_cars ?? 0))} cars (${delta(day.cars, d.avg4_cars)}).
    </div>

    ${memBlock}

    <h3 style="font-size:14px;color:#0f172a;margin:22px 8px 8px;">By site (${dateLabel})</h3>
    <table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px;margin:0 0 8px;">
      <thead>
        <tr style="background:#f8fafc;color:#64748b;font-size:11px;text-transform:uppercase;">
          <th style="padding:6px 8px;text-align:left;">Site</th>
          <th style="padding:6px 8px;text-align:right;">Cars</th>
          <th style="padding:6px 8px;text-align:right;">vs LY</th>
          <th style="padding:6px 8px;text-align:right;">Sales</th>
          <th style="padding:6px 8px;text-align:right;">Recharge</th>
          <th style="padding:6px 8px;text-align:right;">Conv %</th>
          <th style="padding:6px 8px;text-align:right;">Monthly Churn %</th>
        </tr>
      </thead>
      <tbody>${siteRows}</tbody>
    </table>

    <div style="font-size:11px;color:#94a3b8;padding:12px 8px 24px;">
      "vs last year" compares the same calendar date last year. Per-site Conv % is the reporting day's conversion; Churn % is combined voluntary + credit-card churn (a trailing-month figure). Membership data is pulled live from the dashboard. Reply with tweaks and we'll adjust. Sent from WashLyfe Operator.
    </div>
  </div>`

  // body.to overrides for one-off tests; otherwise the scheduled send goes to
  // the comma-separated SUMMARY_EMAIL_TO list (falling back to the default).
  const to = body.to
    ? [body.to]
    : (Deno.env.get('SUMMARY_EMAIL_TO') || DEFAULT_TO).split(',').map((s) => s.trim()).filter(Boolean)
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const resend = new Resend(resendKey)
  try {
    const { error: sendErr } = await resend.emails.send({
      from, to,
      subject: `Mighty Wash Daily Summary for ${dateLabel}`,
      html,
    })
    if (sendErr) return json({ ok: false, error: (sendErr as { message?: string }).message ?? 'send_failed' }, 502)
    return json({ ok: true, to, reporting_date: d.reporting_date }, 200)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502)
  }
})
