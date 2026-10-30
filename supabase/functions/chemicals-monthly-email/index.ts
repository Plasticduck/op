// chemicals-monthly-email — Supabase Edge Function (Deno), CRON.
// On the 1st of every month at 8 AM Central, builds LAST month's Chemicals
// wash-package report (Maintenance > Chemicals) and emails its PDF to
// RECIPIENTS (Kevan, 2026-10-30).
//
// The numbers and the PDF mirror the page: src/lib/queries/chemicals.ts
// (fetchPackageReport) and src/lib/reports/chemicalsPdf.ts. Change those and
// this together.
//
// Auth: the cron's service-role JWT, or an owner/manager (manual run). The
// caller's token is passed on to site-performance (DRB) and flexwash, which
// accept a service_role JWT or an owner/manager. (This function's own
// SUPABASE_SERVICE_ROLE_KEY is an sb_secret key, which those reject.)
// Body: { force? (skip the 1st-at-8 guard), month? 'YYYY-MM', to? string[]
// (send only to these), dryRun? (build it, send nothing, return the totals) }
//
// Edge functions get about 2 s of CPU a call, and a month of FlexWash line items
// is a lot of JSON, so each FlexWash site is counted by a call to this function
// ({ part: 'flex', carWashId, from, end } -> [{ name, tier, count }]) and only
// the small counts come back. The PDF logo is a small JPEG copy
// (<logo>-pdf.jpg in public/), which jsPDF embeds as is; decoding the full-size
// PNG would use up the CPU too.
// Secrets: RESEND_API_KEY, optional RESEND_FROM, APP_URL.
// Schedule: pg_cron at 13:00 and 14:00 UTC on the 1st; only the run that lands
// at 8 AM Central sends (DST-safe).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'
import { jsPDF } from 'npm:jspdf@4.2.1'
import autoTable from 'npm:jspdf-autotable@5.0.8'

const RECIPIENTS = ['kjowers@mighty-wash.com', 'justin.gamboa@mighty-wash.com', 'josh.roberts@mighty-wash.com']
const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const TZ = 'America/Chicago'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://operator.washlyfe.com'

// deno-lint-ignore no-explicit-any
type Any = any
type TierKey = 'flash' | 'wonder' | 'superShine' | 'mighty' | 'testCar' | 'other'
type PackageTotals = Record<TierKey, number> & { total: number }
type SiteRow = PackageTotals & { site: string; totalOnly?: boolean }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

const centralParts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24 }
}
// Last month (YYYY-MM) as of today in Central.
function lastMonth(now: Date): string {
  const { y, m } = centralParts(now)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, '0')}` }
}
const monthLabel = (ym: string) =>
  new Date(ym + '-01T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// ---- The report (mirrors fetchPackageReport in src/lib/queries/chemicals.ts) ----------

const swName = (n: number) => `MightyWash ${String(n).padStart(3, '0')}`
const emptyRow = (site: string): SiteRow =>
  ({ site, flash: 0, wonder: 0, superShine: 0, mighty: 0, testCar: 0, other: 0, total: 0 })
const tierSum = (r: PackageTotals) => r.flash + r.wonder + r.superShine + r.mighty + r.testCar + r.other
const EXCLUDED_SITES = new Set(['MightyWash 019', 'Mighty Wash Headquarters'])
const SKIP_FLEX_PACKAGE = (name: string) => /wex|voyager/i.test(name)
const OTHER_FLEX_WASH = (name: string) => /grand opening wash/i.test(name)
const FLEX_TIER: Record<string, TierKey> = { Wonder: 'wonder', 'Super Shine': 'superShine', Mighty: 'mighty' }
const siteNum = (name: string) => { const m = name.match(/(\d+)\s*$/); return m ? Number(m[1]) : Number.POSITIVE_INFINITY }

async function callFn(auth: string, name: string, body: unknown): Promise<Any> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${name} answered ${res.status}: ${JSON.stringify(data)?.slice(0, 200)}`)
  return data
}

async function siteWatchPerSite(auth: string, start: string, end: string): Promise<SiteRow[]> {
  const sql =
    "SELECT TRIM(sl.SITENAME) AS SITE, (CASE " +
    "WHEN UPPER(it.NAME) LIKE '%MIGHTY PROT%' THEN 'M' " +
    "WHEN UPPER(it.NAME) LIKE '%SUPER SHINE%' THEN 'S' " +
    "WHEN UPPER(it.NAME) LIKE '%FLASH%' THEN 'F' " +
    "WHEN UPPER(it.NAME) LIKE '%TEST CAR%' THEN 'T' ELSE 'W' END) AS TIER, TRIM(it.NAME) AS ITEM, SUM(si.QTY) AS N " +
    "FROM SALEITEMS si " +
    "JOIN SALE s ON s.SITE=si.SITE AND s.OBJID=si.SALEID " +
    "JOIN ITEM it ON it.OBJID=si.ITEM " +
    "JOIN ITEMRPTCATEGORY rc ON rc.OBJID=it.REPORTCATEGORY " +
    "JOIN SITELIST sl ON sl.ID=s.SITE " +
    `WHERE s.LOGDATE>='${start}' AND s.LOGDATE<='${end}' AND si.FLAGS>=0 AND rc.BRANCH='001001001' ` +
    "AND (UPPER(it.NAME) LIKE '%MIGHTY PROT%' OR UPPER(it.NAME) LIKE '%SUPER SHINE%' OR UPPER(it.NAME) LIKE '%WONDER%' " +
    "OR UPPER(it.NAME) LIKE '%FLASH%' OR UPPER(it.NAME) LIKE '%TEST CAR%') " +
    "GROUP BY 1, 2, 3"
  const resp = await callFn(auth, 'site-performance', { api: { path: '/api/custom_query', method: 'POST', body: { sql } } })
  if (resp?.data?.error) throw new Error('The DRB wash-package query failed.')
  const rows = (resp?.data?.rows ?? []) as Array<[string, string, string, number | string]>
  const bySite = new Map<string, SiteRow>()
  for (const [siteRaw, tierRaw, , nRaw] of rows) {
    const site = String(siteRaw).trim()
    const n = Number(nRaw) || 0
    if (n === 0) continue
    const row = bySite.get(site) ?? emptyRow(site)
    const code = String(tierRaw).trim()
    const tier: TierKey = code === 'M' ? 'mighty' : code === 'S' ? 'superShine' : code === 'F' ? 'flash' : code === 'T' ? 'testCar' : 'wonder'
    row[tier] += n
    row.total = tierSum(row)
    bySite.set(site, row)
  }
  return [...bySite.values()]
}

// Cars by package at FlexWash car washes (flexwashSales.lineItemBreakdown's
// carsByPackage with promotional washes): one paid Package line per wash.
async function flexCarsByPackage(auth: string, carWashId: string, start: string, end: string) {
  const resp = await callFn(auth, 'flexwash', {
    path: '/external/accounting/get-line-items-detail', body: { carWashIds: [carWashId], dateRange: { start, end } },
  })
  const items = (resp?.data?.lineItemsDetail ?? []) as Any[]
  const WASH = new Set(['memberWashes', 'singleWashes', 'otherWashes', 'fleetWashes', 'promotionalWashes'])
  const tierOf = (name: string) => {
    const n = name.toLowerCase()
    return n.includes('mighty') ? 'Mighty' : n.includes('super') ? 'Super Shine' : n.includes('wonder') ? 'Wonder' : 'Other'
  }
  const count = new Map<string, number>()
  for (const it of items) {
    if (String(it.type) !== 'Package' || !WASH.has(String(it.orderClassification)) || String((it.order ?? {}).status) !== 'paid') continue
    const name = String(it.name ?? '')
    count.set(name, (count.get(name) ?? 0) + 1)
  }
  return [...count.entries()].map(([name, n]) => ({ name, tier: tierOf(name), count: n }))
}

async function buildReport(auth: string, svc: Any, ym: string) {
  const { start, end } = monthRange(ym)
  const [{ data: flexSites }, sw] = await Promise.all([
    svc.from('flexwash_sites').select('site_number, car_wash_id, start_date').eq('account_id', MW_ACCOUNT).eq('active', true),
    siteWatchPerSite(auth, start, end),
  ])
  let flex: SiteRow[] = []
  let flexIncluded = false
  let flexError: string | null = null
  // A few sites at a time, each tried twice: FlexWash slows down under a burst.
  const countSite = async (carWashId: string, from: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await callFn(auth, 'chemicals-monthly-email', { part: 'flex', carWashId, from, end }) as
          { name: string; tier: string; count: number }[]
      } catch (e) {
        if (attempt >= 2) throw e
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }
  try {
    const active = ((flexSites ?? []) as Any[]).filter((s) => s.car_wash_id && s.start_date && s.start_date <= end)
    const queue = [...active]
    const worker = async () => {
      for (let st = queue.shift(); st; st = queue.shift()) flex.push(await siteRow(st))
    }
    const siteRow = async (st: Any): Promise<SiteRow> => {
      const from = st.start_date > start ? st.start_date : start
      const row = emptyRow(swName(st.site_number))
      let counts
      try {
        counts = await countSite(st.car_wash_id, from)
      } catch (e) {
        throw new Error(`MW${String(st.site_number).padStart(2, '0')}: ${String((e as Error)?.message ?? e).slice(0, 200)}`)
      }
      for (const p of counts) {
        if (SKIP_FLEX_PACKAGE(p.name)) continue
        const tier: TierKey | undefined = FLEX_TIER[p.tier]
          ?? (/flash/i.test(p.name) ? 'flash' : OTHER_FLEX_WASH(p.name) ? 'other' : undefined)
        if (!tier) continue
        row[tier] += p.count
      }
      row.total = tierSum(row)
      return row
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    flexIncluded = true
  } catch (e) {
    // Like the page: any FlexWash site failing leaves FlexWash out (and says so).
    flex = []
    flexError = String((e as Error)?.message ?? e).slice(0, 300)
    console.error('[chemicals-monthly-email] FlexWash left out:', flexError)
  }

  const merged = new Map<string, SiteRow>()
  for (const r of [...sw, ...flex]) {
    const m = merged.get(r.site)
    if (!m) { merged.set(r.site, { ...r }); continue }
    m.flash += r.flash; m.wonder += r.wonder; m.superShine += r.superShine; m.mighty += r.mighty
    m.testCar += r.testCar; m.other += r.other; m.total += r.total
  }
  // Sites with no package data anywhere: their monthly total from the car count sheet.
  const { data: months } = await svc.from('site_performance_months').select('site_number, month, cars')
    .eq('account_id', MW_ACCOUNT).gte('month', start).lte('month', end)
  const monthly = new Map<number, number>()
  for (const r of (months ?? []) as Any[]) {
    const [y, mo] = String(r.month).split('-').map(Number)
    const lastDay = `${String(r.month).slice(0, 8)}${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`
    if (lastDay > end) continue
    monthly.set(r.site_number, (monthly.get(r.site_number) ?? 0) + (Number(r.cars) || 0))
  }
  for (const [n, cars] of monthly) {
    const site = swName(n)
    if (merged.has(site) || cars <= 0) continue
    merged.set(site, { ...emptyRow(site), total: cars, totalOnly: true })
  }
  const sites = [...merged.values()]
    .filter((r) => !EXCLUDED_SITES.has(r.site))
    .sort((a, b) => siteNum(a.site) - siteNum(b.site) || a.site.localeCompare(b.site))
  const grand = sites.reduce<PackageTotals>((a, r) => ({
    flash: a.flash + r.flash, wonder: a.wonder + r.wonder, superShine: a.superShine + r.superShine, mighty: a.mighty + r.mighty,
    testCar: a.testCar + r.testCar, other: a.other + r.other, total: a.total + r.total,
  }), { flash: 0, wonder: 0, superShine: 0, mighty: 0, testCar: 0, other: 0, total: 0 })
  return { sites, grand, flexIncluded, flexError }
}

// ---- The PDF (mirrors exportChemicalsPdf in src/lib/reports/chemicalsPdf.ts) ----------

const nf = (n: number) => n.toLocaleString('en-US')
const fileSafe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()

// Width and height from a JPEG's frame header, or null if it isn't a JPEG.
function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3])
  }
  return null
}
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function buildPdf(label: string, report: { sites: SiteRow[]; grand: PackageTotals; flexIncluded: boolean }, logoUrl: string | null) {
  const doc = new jsPDF() as Any
  // The brand logo top-right, 42 mm wide (placePdfLogo's default), from its
  // small JPEG copy; no copy, no logo.
  if (logoUrl) {
    try {
      const res = await fetch(new URL(logoUrl.replace(/\.png$/i, '-pdf.jpg'), APP_URL))
      const bytes = new Uint8Array(await res.arrayBuffer())
      const size = res.ok ? jpegSize(bytes) : null
      if (size) {
        const w = 42
        const h = w * (size.h / size.w)
        doc.addImage(bytes, 'JPEG', doc.internal.pageSize.getWidth() - 14 - w, 8, w, h)
      }
    } catch (e) {
      console.error('[chemicals-monthly-email] logo left off:', String((e as Error)?.message ?? e))
    }
  }
  const generated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ })
  doc.setFontSize(15)
  doc.text('Wash Package Report', 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`${label} · every wash by package, excluding MW19 and Headquarters · Generated ${generated}`, 14, 22)
  doc.setTextColor(0)
  const { sites, grand } = report
  autoTable(doc, {
    startY: 28,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235] },
    footStyles: { fillColor: [237, 240, 245], textColor: 20, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
    head: [['Site', 'Flash', 'Wonder', 'Super Shine', 'Mighty Protector', 'Test Car', 'Other', 'Total']],
    body: sites.map((r) => r.totalOnly
      ? [`${r.site} †`, '—', '—', '—', '—', '—', '—', nf(r.total)]
      : [r.site, r.flash ? nf(r.flash) : '—', nf(r.wonder), nf(r.superShine), nf(r.mighty),
        r.testCar ? nf(r.testCar) : '—', r.other ? nf(r.other) : '—', nf(r.total)]),
    foot: [['Grand total', ...[grand.flash, grand.wonder, grand.superShine, grand.mighty, grand.testCar, grand.other, grand.total]
      .map((n) => ({ content: nf(n), styles: { halign: 'right' } }))]],
    showFoot: 'lastPage',
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [i, { halign: 'right' }])),
  })
  const notes: string[] = []
  if (sites.some((r) => r.totalOnly)) {
    notes.push('† Not on DRB or FlexWash: the month\'s total washes from the car count sheet, with no package split. Included in the grand total, not the package totals.')
  }
  if (!report.flexIncluded) notes.push('Note: the FlexWash sites could not be loaded and are not included in these totals.')
  if (notes.length) {
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(notes, 14, (doc.lastAutoTable?.finalY ?? 28) + 8)
    doc.setTextColor(0)
  }
  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
}

function emailHtml(label: string, grand: PackageTotals, flexIncluded: boolean): string {
  const row = (k: string, v: number) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555">${k}</td><td style="padding:4px 0;text-align:right;font-variant-numeric:tabular-nums">${nf(v)}</td></tr>`
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111">
<p style="font-size:15px">The Wash Package Report for <b>${label}</b> is attached: every wash by package at each Mighty Wash site (MW19 and Headquarters left out).</p>
<table style="font-size:14px;border-collapse:collapse;margin:8px 0">
${row('Flash', grand.flash)}${row('Wonder', grand.wonder)}${row('Super Shine', grand.superShine)}${row('Mighty Protector', grand.mighty)}${row('Test Car', grand.testCar)}${row('Other', grand.other)}
<tr><td style="padding:6px 12px 4px 0;font-weight:bold;border-top:1px solid #ddd">Grand total washes</td><td style="padding:6px 0 4px;text-align:right;font-weight:bold;border-top:1px solid #ddd">${nf(grand.total)}</td></tr>
</table>
${flexIncluded ? '' : '<p style="font-size:13px;color:#b45309">The FlexWash sites could not be loaded this time, so they are not in these totals.</p>'}
<p style="margin-top:20px"><a href="${APP_URL}/app/chemicals" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px">Open Chemicals in Operator</a></p>
<p style="font-size:12px;color:#888;margin-top:24px">Sent by Operator on the 1st of every month.</p>
</div>`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: {
    force?: boolean; month?: string; to?: string[]; dryRun?: boolean
    part?: 'flex'; carWashId?: string; from?: string; end?: string
  } = {}
  try { body = await req.json() } catch { /* cron sends {} */ }

  // Service role (the cron) or an owner/manager of Mighty Wash running it by hand.
  const auth = req.headers.get('Authorization') ?? ''
  if (jwtRole(auth) !== 'service_role') {
    const { data: u } = await svc.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
    if (!u?.user) return json({ error: 'unauthorized' }, 401)
    const { data: p } = await svc.from('users').select('role, account_id').eq('id', u.user.id).maybeSingle()
    if (!p || p.account_id !== MW_ACCOUNT || (p.role !== 'owner' && p.role !== 'manager')) return json({ error: 'forbidden' }, 403)
  }

  // One FlexWash site's counts, for the main run (see the top).
  if (body.part === 'flex') {
    if (!body.carWashId || !body.from || !body.end) return json({ error: 'bad_request' }, 400)
    try {
      return json(await flexCarsByPackage(auth, body.carWashId, body.from, body.end))
    } catch (e) {
      return json({ error: 'flex_failed', message: String((e as Error)?.message ?? e).slice(0, 300) }, 502)
    }
  }

  const now = new Date()
  const c = centralParts(now)
  if (!body.force && !(c.d === 1 && c.h === 8)) return json({ skipped: 'not_the_1st_at_8am_central', central: c })

  const ym = body.month && /^\d{4}-\d{2}$/.test(body.month) ? body.month : lastMonth(now)
  const label = monthLabel(ym)
  const to = Array.isArray(body.to) && body.to.length ? body.to.map(String) : RECIPIENTS

  let report
  try {
    report = await buildReport(auth, svc, ym)
  } catch (e) {
    const why = String((e as Error)?.message ?? e).slice(0, 500)
    console.error('[chemicals-monthly-email] report failed:', why)
    return json({ error: 'report_failed', message: why }, 502)
  }
  const { data: acct } = await svc.from('accounts').select('brand_logo_url').eq('id', MW_ACCOUNT).maybeSingle()
  const pdf = await buildPdf(label, report, acct?.brand_logo_url ?? null)
  const filename = `mighty-wash-packages-${fileSafe(label)}.pdf`

  if (body.dryRun) {
    return json({
      month: ym, to, filename, pdf_bytes: pdf.length, sites: report.sites.length, grand: report.grand,
      flexIncluded: report.flexIncluded, flexError: report.flexError, pdf_base64: toBase64(pdf),
    })
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key', message: 'Email is not configured.' }, 503)
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const { data: sent, error } = await new Resend(resendKey).emails.send({
    from,
    to,
    subject: `Wash Package Report: ${label}`,
    html: emailHtml(label, report.grand, report.flexIncluded),
    attachments: [{ filename, content: toBase64(pdf) }],
  })
  if (error) return json({ error: 'send_failed', message: error.message }, 502)
  return json({ ok: true, month: ym, to, id: sent?.id, sites: report.sites.length, grand: report.grand, flexIncluded: report.flexIncluded, flexError: report.flexError })
})
