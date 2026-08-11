// daily-summary-email — Supabase Edge Function (Deno).
// Sends the Mighty Wash morning digest (car counts, sales, recharge, membership,
// churn/conversion) with comparisons to the same weekday last week + the monthly
// membership trend. Scheduled by pg_cron at 12:40 & 13:40 UTC; the function only
// actually sends when it is 7:50am Central (guards on the America/Chicago hour),
// so it fires exactly once whether Central is on CDT or CST.
//
// Body (optional): { force?: true, to?: "override@…", subjectTag?: "Corrected" }
// force bypasses the time guard for manual testing; to overrides the recipient;
// subjectTag appends " (tag)" to the subject (e.g. a corrected re-send).
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
// null on any failure so the email still sends. `sites` defaults to [] (the
// dashboard's current roster); pass explicit "MightyWash 0NN" names to include
// sites the roster drops, e.g. former SiteWatch sites now on FlexWash whose
// last-year history is still queryable.
// deno-lint-ignore no-explicit-any
async function gq(cookie: string, metric: string, day: string, sites: string[] = []): Promise<any | null> {
  try {
    const r = await fetch(`${DASH_BASE}/api/guided_query`, {
      method: 'POST',
      headers: { Cookie: cookie, 'User-Agent': BROWSER_UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric, sites, start: day, end: day }),
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) return null
    const j = await r.json()
    // An explicit-sites request rejects an unknown site with { error }; treat
    // that as "no data" rather than letting it poison the caller.
    if (j && typeof j === 'object' && 'error' in j) return null
    return j
  } catch { return null }
}
// Sites the default roster drops but that were on SiteWatch previously, so their
// same-day-last-year cars are still available when named explicitly. The
// dashboard silently omits any of these with no data for the requested date.
const LY_EXTRA_SITES = ['MightyWash 017', 'MightyWash 018', 'MightyWash 029', 'MightyWash 030']
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
// Conversions tab "Day by Day" per-site daily conversion %, from the dashboard's
// rinsed report: { sites: { "Mighty Wash #N": { days: [{date, conversion_pct}] } } }.
// deno-lint-ignore no-explicit-any
async function fetchRinsed(cookie: string): Promise<any | null> {
  try {
    const r = await fetch(`${DASH_BASE}/api/rinsed_report`, {
      headers: { Cookie: cookie, 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
// EXACT SiteWatch daily figures straight from the POS ledger, so Net Sales
// equals the General Sales Report's "TOTAL TO ACCOUNT FOR" to the penny.
//   ttaf     = -SUM(AMT) over the Tenders (001008) + Deposits (001005) report
//              categories = the money to account for (all tenders collected).
//   recharge = SUM(AMT) over the ARM Plans Recharged category (001004006) =
//              the report's "ARM PLANS RECHARGED".
// Date-bounded by SALE.LOGDATE, so it's a hard end-of-day cutoff (no bleed past
// midnight of the reporting day). Verified exact on 2026-08-04..07.
async function fetchSiteWatchLedger(cookie: string, day: string): Promise<{ ttaf: number; recharge: number } | null> {
  const sql =
    "SELECT -SUM(CASE WHEN (rc.BRANCH STARTING WITH '001008' OR rc.BRANCH STARTING WITH '001005') THEN si.AMT ELSE 0 END) AS TTAF, " +
    "SUM(CASE WHEN rc.BRANCH STARTING WITH '001004006' THEN si.AMT ELSE 0 END) AS RECHARGE " +
    "FROM SALEITEMS si JOIN SALE s ON s.SITE=si.SITE AND s.OBJID=si.SALEID " +
    "JOIN ITEM it ON it.OBJID=si.ITEM JOIN ITEMRPTCATEGORY rc ON rc.OBJID=it.REPORTCATEGORY " +
    `WHERE s.LOGDATE='${day}'`
  try {
    const r = await fetch(`${DASH_BASE}/api/custom_query`, {
      method: 'POST',
      headers: { Cookie: cookie, 'User-Agent': BROWSER_UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) return null
    const j = await r.json()
    const row = j?.rows?.[0]
    if (!row || row[0] == null) return null
    return { ttaf: Number(row[0]) || 0, recharge: Number(row[1]) || 0 }
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

  let body: { force?: boolean; to?: string; subjectTag?: string; dryRun?: boolean; date?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  // Time guard: only send at 7am Central unless forced.
  const chicagoHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()))
  if (!body.force && chicagoHour !== 7) return json({ skipped: true, reason: 'not 7am Central', chicagoHour }, 200)

  // Optional reporting-day override (backfill / re-send a past day). When set we
  // pin the RPC to that date and must NOT write the retail snapshot, since it
  // would overwrite that historical day's month-to-date baseline with today's.
  const dateOverride = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null
  // deno-lint-ignore no-explicit-any
  const { data: d, error } = (dateOverride
    ? await svc.rpc('mw_daily_summary', { p_day: dateOverride })
    : await svc.rpc('mw_daily_summary')) as { data: any; error: unknown }
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
  // Billed recharge = the POS "ARM PLANS RECHARGED" (from the ledger) + FlexWash.
  let rechargeDay: number | null = null
  // Net Sales = actual money in. For SiteWatch sites it equals the General Sales
  // Report's TOTAL TO ACCOUNT FOR (exact, from the ledger); FlexWash adds on top.
  let netSales: number | null = null
  // Same-basis year-over-year for Net Sales and Retail: last year's ledger figures
  // for the same calendar date (FlexWash sites are new, so LY is SiteWatch only).
  let netSalesLy: number | null = null
  let retailLy: number | null = null
  // Per-site actual money (net of redemptions), keyed by site number. SiteWatch
  // sites via per-site TTAF delta; FlexWash sites are already net. Empty until a
  // baseline snapshot exists, in which case the per-site column falls back to gross.
  const siteNet = new Map<number, number>()
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
          const ttafMtdNow = rows.reduce((s, x) => (flexNums.has(Number(x.site_number)) ? s : s + (Number(x.ttaf) || 0)), 0)
          // Per-site month-to-date TTAF (SiteWatch only), for the per-site delta.
          const siteTtafNow: Record<string, number> = {}
          for (const x of rows) {
            const n = Number(x.site_number)
            if (!flexNums.has(n)) siteTtafNow[String(n)] = Number(x.ttaf) || 0
          }
          const flexSites = sites.filter((s) => flexNums.has(s.n))
          const flexRetail = flexSites.reduce((a, s) => a + Math.max(0, (Number(s.sales) || 0) - (Number(s.recharge) || 0)), 0)
          const flexRecharge = flexSites.reduce((a, s) => a + (Number(s.recharge) || 0), 0)
          const flexActualDay = flexSites.reduce((a, s) => a + (Number(s.sales) || 0), 0)

          // EXACT SiteWatch figures from the POS ledger (= the General Sales Report
          // to the penny), plus FlexWash on top. All three cards reconcile:
          // Net = Recharge + Retail = SiteWatch TTAF + FlexWash.
          const ledger = await fetchSiteWatchLedger(cookie, rday)
          if (ledger) {
            rechargeDay = ledger.recharge + flexRecharge
            retailDay = Math.max(0, ledger.ttaf - ledger.recharge) + flexRetail
            netSales = ledger.ttaf + flexActualDay
          }
          // Last year's ledger (same calendar day) for the Net Sales / Retail YoY.
          const ledgerLy = await fetchSiteWatchLedger(cookie, lyStr)
          if (ledgerLy) {
            netSalesLy = ledgerLy.ttaf
            retailLy = Math.max(0, ledgerLy.ttaf - ledgerLy.recharge)
          }

          // Per-site SiteWatch net still uses the per-site TTAF month-to-date delta
          // (the ledger total is exact, but per-site needs the internal-site map).
          const { data: prev } = await svc
            .from('ttaf_retail_snapshots')
            .select('month_key, site_ttaf')
            .eq('account_id', MW_ACCOUNT)
            .lt('snapshot_date', rday)
            .order('snapshot_date', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (prev) {
            const sameMonth = prev.month_key === monthKey
            const prevSite = (sameMonth ? (prev.site_ttaf as Record<string, number> | null) : null) ?? null
            if (prevSite) {
              for (const [k, v] of Object.entries(siteTtafNow)) {
                if (prevSite[k] != null) siteNet.set(Number(k), Math.max(0, v - Number(prevSite[k])))
              }
            }
          }
          // FlexWash sites already report actual money.
          for (const s of flexSites) siteNet.set(s.n, Number(s.sales) || 0)

          // Skip the snapshot write on a backdated re-send: the TTAF month-to-date
          // read is as-of-now, so upserting it into a past day's row would corrupt
          // that day's baseline and throw off subsequent daily retail deltas.
          if (!dateOverride) {
            await svc.from('ttaf_retail_snapshots').upsert(
              { account_id: MW_ACCOUNT, snapshot_date: rday, month_key: monthKey, retail_mtd: retailMtdNow, ttaf_mtd: ttafMtdNow, site_ttaf: siteTtafNow, updated_at: new Date().toISOString() },
              { onConflict: 'account_id,snapshot_date' },
            )
          }
        }
      } catch { /* best-effort */ }

      const [carsLy, carsLyExtra, revLy, rechLy, plansT, plansM, plansS, plansW, cvol, ccc] = await Promise.all([
        gq(cookie, 'cars', lyStr), gq(cookie, 'cars', lyStr, LY_EXTRA_SITES), gq(cookie, 'revenue', lyStr), gq(cookie, 'recharge', lyStr),
        gq(cookie, 'plans_total', rday), gq(cookie, 'plans_mighty', rday), gq(cookie, 'plans_super', rday), gq(cookie, 'plans_wonder', rday),
        gq(cookie, 'churn_voluntary', rday), gq(cookie, 'churn_cc', rday),
      ])
      // Per-site MONTHLY conversion %: the Conversions tab's month-to-date average
      // (`avg_to_date` in /api/rinsed_report), keyed by store number. We use the
      // monthly figure (not the single reporting day) so every site has a value —
      // the daily value lags a few days for the slower-settling sites. Covers
      // #17/#18/#29/#30 via FlexWash.
      const rinsed = await fetchRinsed(cookie)
      const convBySite = new Map<string, number>()
      if (rinsed?.sites) {
        // deno-lint-ignore no-explicit-any
        for (const [nm, obj] of Object.entries(rinsed.sites as Record<string, any>)) {
          const num = Number(String(nm).match(/#\s*(\d+)/)?.[1] ?? NaN)
          if (!Number.isFinite(num)) continue
          if (obj?.avg_to_date != null) {
            convBySite.set('MightyWash ' + String(num).padStart(3, '0'), Number(obj.avg_to_date))
          }
        }
      }
      // Headline conversion = the dashboard's own month-to-date company average
      // (rinsed `company_avg`), which is volume-weighted and the authoritative
      // number. Fall back to a simple mean of the per-site values only if the
      // dashboard didn't provide it. A plain per-site mean over-weights low-volume
      // outliers (e.g. the Lube & Tune site), so it is the fallback, not the source.
      const convVals = sites
        .map((s) => convBySite.get('MightyWash ' + String(s.n).padStart(3, '0')))
        .filter((v): v is number => v != null)
      const companyAvg = rinsed && typeof rinsed.company_avg === 'number' ? rinsed.company_avg : null
      const conversionAvg = companyAvg ?? (convVals.length ? convVals.reduce((a, b) => a + b, 0) / convVals.length : null)
      const churnVolBySite = gqMap(cvol)
      const churnCcBySite = gqMap(ccc)
      // Same-day-last-year cars: the default roster plus the explicitly-named
      // former-SiteWatch sites (17/18/29/...), so their per-site "vs LY" fills in
      // wherever last-year history exists.
      const carsLyBySite = gqMap(carsLy)
      for (const [k, v] of gqMap(carsLyExtra)) carsLyBySite.set(k, v)
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
      // Headline last-year cars = the roster total plus any extra former-SiteWatch
      // sites, matching this year's all-sites count for a fair comparison.
      const yoyCarsBase = gqTotal(carsLy)
      const yoyCars = yoyCarsBase == null ? null : yoyCarsBase + (gqTotal(carsLyExtra) ?? 0)
      dash = {
        yoyCars, yoyRevenue: gqTotal(revLy), yoyRecharge: gqTotal(rechLy),
        plansTotal, plansMighty, plansSuper, plansWonder,
        conversion: conversionAvg, churnVol: chAvg.vol, churnCc: chAvg.cc,
        convBySite, churnVolBySite, churnCcBySite, carsLyBySite,
      }
    } catch { dash = null }
  }
  const yoySub = (cur: number, prev: number | null | undefined) => (prev != null ? `${delta(cur, prev)} vs last year` : '')

  const memTotal = (m: { mighty: number; super: number; wonder: number }) => m.mighty + m.super + m.wonder

  // Cards live in table-layout:fixed rows so every client (incl. Gmail mobile)
  // gives each card an equal share of the width and none get hidden. Kept compact
  // so four fit side by side on a phone without wrapping or clipping the number.
  const kpi = (label: string, value: string, sub: string) => `
    <td style="padding:3px;vertical-align:top;">
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:9px 8px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.02em;color:#64748b;">${label}</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:2px;">${value}</div>
        <div style="font-size:11px;color:#475569;margin-top:3px;line-height:1.25;">${sub}</div>
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
  const siteRows = [...sites]
    // Hide sites with no store number AND no activity (e.g. a not-yet-open
    // location that's in the feed but reported 0 cars / $0) — otherwise it
    // renders as "MightyWash null" and sorts to the top.
    .filter((s) => s.n != null || (Number(s.cars) || 0) > 0 || (Number(s.sales) || 0) > 0)
    .sort((a, b) => a.n - b.n).map((s) => {
    const cn = siteName(s.n)
    return `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${esc(cn)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${nf(s.cars)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${delta(s.cars, dash?.carsLyBySite.get(cn))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${money(siteNet.has(s.n) ? siteNet.get(s.n)! : s.sales)}</td>
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
    <table role="presentation" width="100%" style="border-collapse:collapse;table-layout:fixed;">
      <tr>
        ${kpi('Plans sold', nf(dash.plansTotal), `Mighty ${nf(dash.plansMighty ?? 0)} · Super ${nf(dash.plansSuper ?? 0)} · Wonder ${nf(dash.plansWonder ?? 0)}`)}
        ${kpi('Monthly Conversion', dash.conversion != null ? dash.conversion.toFixed(1) + '%' : 'n/a', 'company average, month to date')}
        ${kpi('Monthly Churn', dash.churnVol != null || dash.churnCc != null ? ((dash.churnVol ?? 0) + (dash.churnCc ?? 0)).toFixed(1) + '%' : 'n/a', `voluntary ${dash.churnVol != null ? dash.churnVol.toFixed(1) : 'n/a'}% + credit-card ${dash.churnCc != null ? dash.churnCc.toFixed(1) : 'n/a'}%, trailing month`)}
      </tr>
    </table>
    ${churnNote}
  ` : (mem ? `
    <h3 style="font-size:14px;color:#0f172a;margin:22px 0 8px;">Membership for ${new Date(mem.period + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} (latest monthly)</h3>
    <table role="presentation" width="100%" style="border-collapse:collapse;table-layout:fixed;">
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
    <table role="presentation" style="border-collapse:collapse;padding:20px 8px 4px;">
      <tr>
        <td style="padding:16px 12px 4px 8px;vertical-align:middle;white-space:nowrap;">
          <img src="https://operator.washlyfe.com/mighty-max-in-flight.png" alt="Mighty Wash" width="135" height="48" style="display:block;border:0;width:135px;height:auto;" />
        </td>
        <td style="padding:16px 8px 4px 0;vertical-align:middle;">
          <div style="font-size:20px;font-weight:700;">Daily Summary</div>
          <div style="font-size:13px;color:#64748b;">${dateLabel}</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" style="border-collapse:collapse;table-layout:fixed;">
      <tr>
        ${kpi('Cars', nf(day.cars), yoySub(day.cars, dash?.yoyCars))}
        ${kpi('Net Sales', netSales != null ? money(netSales) : money(day.sales), netSales != null ? yoySub(netSales, netSalesLy) : 'gross this day; net figure available tomorrow')}
        ${kpi('Recharge', money(rechargeDay ?? day.recharge), yoySub(rechargeDay ?? day.recharge, dash?.yoyRecharge))}
        ${kpi('Retail', retailDay != null ? money(retailDay) : 'n/a', retailDay != null ? yoySub(retailDay, retailLy) : '')}
      </tr>
    </table>
    ${netSales != null ? `<div style="font-size:12px;color:#475569;padding:2px 8px;">Net Sales = actual money in = total to account for (matches the POS report).</div>` : ''}
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
          <th style="padding:6px 8px;text-align:right;">Net Sales</th>
          <th style="padding:6px 8px;text-align:right;">Recharge</th>
          <th style="padding:6px 8px;text-align:right;">Monthly Conversion %</th>
          <th style="padding:6px 8px;text-align:right;">Monthly Churn %</th>
        </tr>
      </thead>
      <tbody>${siteRows}</tbody>
    </table>

    <div style="font-size:11px;color:#94a3b8;padding:12px 8px 24px;">
      "vs last year" compares the same calendar date last year. Per-site Monthly Conversion % is the month-to-date average; Churn % is combined voluntary + credit-card churn (a trailing-month figure). Membership data is pulled live from the dashboard. Reply with tweaks and we'll adjust. Sent from WashLyfe Operator.
    </div>
  </div>`

  // dryRun returns the computed conversion numbers without sending, for verifying
  // the per-site data source against the dashboard.
  if (body.dryRun) {
    return json({
      reporting_date: rday,
      net_sales: netSales,
      recharge: rechargeDay ?? day.recharge,
      retail: retailDay,
      recharge_plus_retail: (rechargeDay != null && retailDay != null) ? rechargeDay + retailDay : null,
      conversion_avg: dash?.conversion ?? null,
    }, 200)
  }

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
      subject: `Mighty Wash Daily Summary for ${dateLabel}${body.subjectTag ? ` (${body.subjectTag})` : ''}`,
      html,
    })
    if (sendErr) return json({ ok: false, error: (sendErr as { message?: string }).message ?? 'send_failed' }, 502)
    return json({ ok: true, to, reporting_date: d.reporting_date }, 200)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502)
  }
})
