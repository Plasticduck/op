// daily-summary-email — Supabase Edge Function (Deno).
// Sends the Mighty Wash morning digest (car counts, sales, recharge, membership,
// churn/conversion) with comparisons to the same weekday last week + the monthly
// membership trend. Scheduled by pg_cron at 12:40 & 13:40 UTC; the function only
// actually sends when it is 7:40am Central (guards on the America/Chicago hour),
// so it fires exactly once whether Central is on CDT or CST.
//
// Body (optional): { force?: true, to?: "override@…" }  — force bypasses the
// time guard for manual testing; to overrides the recipient.
//
// Secrets: RESEND_API_KEY (required). Optional: RESEND_FROM, SUMMARY_EMAIL_TO.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

const DEFAULT_TO = 'kjowers@mighty-wash.com'

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

  const day = d.day, prev = d.prev_day, lw = d.last_week
  const mem = d.membership, memPrev = d.membership_prev
  const sites: Array<{ site: string; n: number; cars: number; sales: number; recharge: number; cph: number | null; cars_lw: number | null }> = d.sites ?? []
  const rdate = new Date(d.reporting_date + 'T12:00:00')
  const dateLabel = rdate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })

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
  const siteRows = [...sites].sort((a, b) => a.n - b.n).map((s) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${esc(siteName(s.n))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${nf(s.cars)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${delta(s.cars, s.cars_lw)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${money(s.sales)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${money(s.recharge)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${s.cph != null ? s.cph.toFixed(1) : 'n/a'}</td>
    </tr>`).join('')

  const memBlock = mem ? `
    <h3 style="font-size:14px;color:#0f172a;margin:22px 0 8px;">Membership for ${new Date(mem.period + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} (latest monthly)</h3>
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr>
        ${kpi('Total members', nf(memTotal(mem)), memPrev ? `${delta(memTotal(mem), memTotal(memPrev))} vs last month` : '')}
        ${kpi('Churn', mem.churn.toFixed(2) + '%', memPrev ? `${deltaPts(mem.churn, memPrev.churn, false)} vs last month` : '')}
        ${kpi('Conversion', mem.conversion.toFixed(2) + '%', memPrev ? `${deltaPts(mem.conversion, memPrev.conversion, true)} vs last month` : '')}
      </tr>
    </table>
    <div style="font-size:12px;color:#475569;margin-top:6px;">Mighty ${nf(mem.mighty)} · Super ${nf(mem.super)} · Wonder ${nf(mem.wonder)}. Churn/conversion are averages across sites and update monthly.</div>
  ` : ''

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;color:#0f172a;">
    <div style="padding:20px 8px 4px;">
      <div style="font-size:20px;font-weight:700;">Mighty Wash Daily Summary</div>
      <div style="font-size:13px;color:#64748b;">${dateLabel} · ${day.sites} sites reporting</div>
    </div>

    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr>
        ${kpi('Total cars', nf(day.cars), `${delta(day.cars, lw?.cars)} vs same day last week`)}
        ${kpi('Sales', money(day.sales), `${delta(day.sales, lw?.sales)} vs same day last week`)}
        ${kpi('Recharge', money(day.recharge), `${delta(day.recharge, lw?.recharge)} vs same day last week`)}
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
          <th style="padding:6px 8px;text-align:right;">vs LW</th>
          <th style="padding:6px 8px;text-align:right;">Sales</th>
          <th style="padding:6px 8px;text-align:right;">Recharge</th>
          <th style="padding:6px 8px;text-align:right;">Cars/hr</th>
        </tr>
      </thead>
      <tbody>${siteRows}</tbody>
    </table>

    <div style="font-size:11px;color:#94a3b8;padding:12px 8px 24px;">
      Comparisons use the same weekday one week prior. Year-over-year will be included once a full year of performance history has accrued (data currently starts April 2026). Reply with tweaks and we'll adjust. Sent from WashLyfe Operator.
    </div>
  </div>`

  const to = body.to || Deno.env.get('SUMMARY_EMAIL_TO') || DEFAULT_TO
  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const resend = new Resend(resendKey)
  try {
    const { error: sendErr } = await resend.emails.send({
      from, to: [to],
      subject: `Mighty Wash Daily Summary for ${dateLabel}`,
      html,
    })
    if (sendErr) return json({ ok: false, error: (sendErr as { message?: string }).message ?? 'send_failed' }, 502)
    return json({ ok: true, to, reporting_date: d.reporting_date }, 200)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502)
  }
})
