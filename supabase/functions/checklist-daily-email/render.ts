// The nightly checklist email's HTML (checklist-daily-email), kept apart from
// the handler so it can be rendered with sample data in a test.

export const TZ = 'America/Chicago'
export const SEND_HOUR = 20

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// ---- Time ------------------------------------------------------------------

function tzOffsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((x) => [x.type, x.value]),
  )
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime()
}
// The instant it is `hour`:00 on `day` in `tz`.
export function zoned(day: string, hour: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hour)
  let t = guess - tzOffsetMs(new Date(guess), tz)
  t = guess - tzOffsetMs(new Date(t), tz)
  return new Date(t)
}
export const localDay = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const longDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)))
}
export const shortDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)))
}
// "9:00 PM", without the narrow no-break space some runtimes put before PM.
const clock = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(/\s/g, ' ') : ''
const until = (iso: string | null) => (clock(iso) === '12:00 AM' ? 'midnight' : clock(iso))

// ---- Data ------------------------------------------------------------------

export type Row = {
  location_id: string
  location_name: string
  region: string | null
  rm_name: string | null
  checklist_id: string
  checklist_name: string
  opens_at: string
  closes_at: string
  instance_id: string | null
  submitted_at: string | null
  submitted_by_name: string | null
  review_status: string | null
  items_total: number | null
  items_done: number | null
  flagged_count: number
  photo_count: number
  comment_count: number
}
type Status = 'submitted' | 'missed' | 'open' | 'later'

const statusAt = (r: Row, cutoff: number): Status => {
  if (r.submitted_at) return 'submitted'
  if (new Date(r.closes_at).getTime() <= cutoff) return 'missed'
  if (new Date(r.opens_at).getTime() > cutoff) return 'later'
  return 'open'
}
const isLate = (r: Row) => !!r.submitted_at && new Date(r.submitted_at).getTime() > new Date(r.closes_at).getTime()
const bySite = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

// "Bay Attendant Checklist - Opening" -> "Bay Opening", for the table's columns.
function shortLabel(name: string): string {
  const s = name.replace(/\bchecklist\b/gi, ' ').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^weekly store cleaning/i.test(s)) return 'Weekly'
  if (/^month end/i.test(s)) return 'Month End'
  return s.replace(/^Bay Attendant\b/i, 'Bay').replace(/^Management\b/i, 'Mgmt')
}

export type Flagged = {
  location_name: string
  checklist_name: string
  when: string
  items: { label: string; done: boolean; notes: { text: string; by: string | null }[] }[]
}

// ---- Email -----------------------------------------------------------------

export const C = { red: '#b91c1c', redBg: '#fef2f2', redLine: '#fecaca', amber: '#92400e', amberBg: '#fffbeb', amberLine: '#fde68a', green: '#15803d', greenBg: '#f0fdf4', greenLine: '#bbf7d0', ink: '#111827', muted: '#6b7280', line: '#e5e7eb', soft: '#f9fafb' }

export function buildHtml(opts: {
  day: string
  cutoff: number
  today: Row[]
  lastNight: Row[]
  flagged: Flagged[]
  appUrl: string
}): { html: string; subject: string; counts: Record<string, number> } {
  const { day, cutoff, today, lastNight, flagged, appUrl } = opts
  const st = new Map(today.map((r) => [r, statusAt(r, cutoff)]))
  const missedToday = today.filter((r) => st.get(r) === 'missed')
  const missedLast = lastNight.filter((r) => !r.submitted_at)
  const submittedToday = today.filter((r) => st.get(r) === 'submitted')
  const openToday = today.filter((r) => st.get(r) === 'open')
  const flaggedItems = submittedToday.reduce((s, r) => s + (r.flagged_count || 0), 0)
  const missedTotal = missedToday.length + missedLast.length

  const tile = (label: string, value: number, color: string, bg: string) => `
    <td style="padding:4px;width:25%;">
      <div style="background:${bg};border-radius:8px;padding:10px 8px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
        <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:.03em;">${label}</div>
      </div>
    </td>`

  // The alert: every checklist not submitted, by site.
  const missedBySite = (rows: Row[]) => {
    const m = new Map<string, Row[]>()
    for (const r of rows) m.set(r.location_name, [...(m.get(r.location_name) ?? []), r])
    return [...m.entries()].sort((a, b) => bySite(a[0], b[0])).map(([site, rs]) => {
      const rm = rs[0].rm_name ? ` <span style="color:${C.muted};">(${esc(rs[0].rm_name)})</span>` : ''
      const names = rs.sort((a, b) => a.opens_at.localeCompare(b.opens_at)).map((r) => esc(r.checklist_name)).join(', ')
      return `<tr><td style="padding:4px 8px 4px 0;vertical-align:top;white-space:nowrap;font-weight:600;">${esc(site)}${rm}</td><td style="padding:4px 0;">${names}</td></tr>`
    }).join('')
  }
  const alert = missedTotal > 0
    ? `
      <div style="border:1px solid ${C.redLine};background:${C.redBg};border-radius:10px;padding:14px 16px;margin:0 0 18px;">
        <div style="font-size:16px;font-weight:700;color:${C.red};margin:0 0 6px;">&#9888; ${missedTotal} checklist${missedTotal === 1 ? ' was' : 's were'} not submitted</div>
        ${missedToday.length ? `
          <div style="font-size:12px;font-weight:700;color:${C.red};text-transform:uppercase;letter-spacing:.03em;margin:10px 0 2px;">Today (closed without a submission)</div>
          <table style="border-collapse:collapse;font-size:13px;color:${C.ink};">${missedBySite(missedToday)}</table>` : ''}
        ${missedLast.length ? `
          <div style="font-size:12px;font-weight:700;color:${C.red};text-transform:uppercase;letter-spacing:.03em;margin:10px 0 2px;">Last night (${esc(shortDay(addDays(day, -1)))}, still open at the last email)</div>
          <table style="border-collapse:collapse;font-size:13px;color:${C.ink};">${missedBySite(missedLast)}</table>` : ''}
      </div>`
    : `
      <div style="border:1px solid ${C.greenLine};background:${C.greenBg};border-radius:10px;padding:14px 16px;margin:0 0 18px;font-size:14px;color:${C.green};font-weight:600;">
        Every checklist that has closed so far was submitted.
      </div>`

  // Still open at send time, one line per checklist.
  const openByName = new Map<string, Row[]>()
  for (const r of openToday) openByName.set(r.checklist_name, [...(openByName.get(r.checklist_name) ?? []), r])
  const openBlock = openByName.size
    ? `
      <div style="border:1px solid ${C.amberLine};background:${C.amberBg};border-radius:10px;padding:12px 16px;margin:0 0 18px;font-size:13px;color:${C.ink};">
        <div style="font-weight:700;color:${C.amber};margin:0 0 4px;">Still open as of ${esc(clock(new Date(cutoff).toISOString()))}</div>
        ${[...openByName.entries()].sort((a, b) => a[1][0].closes_at.localeCompare(b[1][0].closes_at)).map(([name, rs]) => {
          const last = rs.map((r) => r.closes_at).sort().at(-1) ?? null
          return `<div style="margin:2px 0;">${esc(name)}: <b>${rs.length}</b> site${rs.length === 1 ? '' : 's'} not in yet (open until ${esc(until(last))})</div>`
        }).join('')}
        <div style="color:${C.muted};margin-top:4px;">Tomorrow night's email reports how these ended.</div>
      </div>`
    : ''

  // Every site's checklists for the day, grouped by region.
  // In the order they open, with the all-day ones (weekly, month end) last.
  const allDay = (r: Row) => new Date(r.closes_at).getTime() - new Date(r.opens_at).getTime() >= 20 * 3_600_000
  const cols = [...new Map(today.map((r) => [r.checklist_name, r])).values()]
    .sort((a, b) => Number(allDay(a)) - Number(allDay(b)) || a.opens_at.localeCompare(b.opens_at) || a.checklist_name.localeCompare(b.checklist_name))
    .map((r) => r.checklist_name)
  const cell = (r: Row | undefined) => {
    const base = 'padding:5px 3px;text-align:center;border-bottom:1px solid ' + C.line + ';font-size:11px;white-space:nowrap;'
    if (!r) return `<td style="${base}color:#d1d5db;">-</td>`
    const s = st.get(r)
    if (s === 'submitted') {
      const allDone = (r.items_done ?? 0) === (r.items_total ?? 0)
      const color = allDone ? C.green : C.amber
      const bg = allDone ? C.greenBg : C.amberBg
      return `<td style="${base}background:${bg};color:${color};font-weight:600;">&#10003; ${r.items_done ?? 0}/${r.items_total ?? 0}${isLate(r) ? '<br><span style="font-weight:400;font-size:10px;">late</span>' : ''}</td>`
    }
    if (s === 'missed') return `<td style="${base}background:${C.redBg};color:${C.red};font-weight:700;">&#10007; Missed</td>`
    if (s === 'open') return `<td style="${base}color:${C.muted};">Open</td>`
    return `<td style="${base}color:${C.muted};">Later</td>`
  }
  const sites = new Map<string, Row[]>()
  for (const r of today) sites.set(r.location_name, [...(sites.get(r.location_name) ?? []), r])
  const regions = new Map<string, { rm: string | null; sites: string[] }>()
  for (const [site, rs] of sites) {
    const key = rs[0].region ?? 'No region'
    const g = regions.get(key) ?? { rm: rs[0].rm_name, sites: [] }
    g.sites.push(site)
    regions.set(key, g)
  }
  const regionOrder = [...regions.keys()].sort((a, b) => (a === 'No region' ? 1 : b === 'No region' ? -1 : a.localeCompare(b)))
  const matrixRows = regionOrder.map((reg) => {
    const g = regions.get(reg)!
    const head = `<tr><td colspan="${cols.length + 1}" style="padding:10px 6px 4px;font-size:12px;font-weight:700;color:${C.ink};background:${C.soft};border-bottom:1px solid ${C.line};">${esc(reg)}${g.rm ? ` <span style="font-weight:400;color:${C.muted};">· RM ${esc(g.rm)}</span>` : reg === 'No region' ? '' : ` <span style="font-weight:400;color:${C.muted};">· no RM</span>`}</td></tr>`
    const body = g.sites.sort(bySite).map((site) => {
      const rs = sites.get(site)!
      return `<tr><td style="padding:5px 6px;border-bottom:1px solid ${C.line};font-size:12px;font-weight:600;white-space:nowrap;">${esc(site)}</td>${cols.map((name) => cell(rs.find((r) => r.checklist_name === name))).join('')}</tr>`
    }).join('')
    return head + body
  }).join('')
  const matrix = today.length
    ? `
      <h3 style="font-size:15px;margin:22px 0 6px;">Every site, today</h3>
      <p style="margin:0 0 8px;font-size:12px;color:${C.muted};">&#10003; submitted, with items checked off out of the total (amber when some weren't done). &#10007; Missed: closed without a submission. Open: still open now.</p>
      <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;width:100%;min-width:${70 + cols.length * 56}px;">
          <thead><tr>
            <th style="padding:6px;text-align:left;font-size:11px;color:${C.muted};border-bottom:2px solid ${C.line};">Site</th>
            ${cols.map((n) => `<th title="${esc(n)}" style="padding:6px 4px;text-align:center;font-size:11px;color:${C.muted};border-bottom:2px solid ${C.line};">${esc(shortLabel(n))}</th>`).join('')}
          </tr></thead>
          <tbody>${matrixRows}</tbody>
        </table>
      </div>
      <p style="margin:6px 0 0;font-size:11px;color:${C.muted};">${cols.map((n) => `<b>${esc(shortLabel(n))}</b>: ${esc(n)}`).join(' &nbsp;·&nbsp; ')}</p>`
    : ''

  // Last night's late checklists that did come in.
  const lastIn = lastNight.filter((r) => r.submitted_at).sort((a, b) => bySite(a.location_name, b.location_name))
  const lastInBlock = lastIn.length
    ? `
      <h3 style="font-size:15px;margin:22px 0 6px;">Last night's late checklists that came in</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        ${lastIn.map((r) => `<tr>
          <td style="padding:4px 6px;border-bottom:1px solid ${C.line};font-weight:600;white-space:nowrap;">${esc(r.location_name)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid ${C.line};">${esc(r.checklist_name)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid ${C.line};white-space:nowrap;color:${(r.items_done ?? 0) === (r.items_total ?? 0) ? C.green : C.amber};">${r.items_done ?? 0}/${r.items_total ?? 0}</td>
          <td style="padding:4px 6px;border-bottom:1px solid ${C.line};white-space:nowrap;color:${C.muted};">${esc(clock(r.submitted_at))}${isLate(r) ? ' (late)' : ''}</td>
        </tr>`).join('')}
      </table>`
    : ''

  // What the sites flagged: items not done, or with a comment.
  const flaggedBlock = flagged.length
    ? `
      <h3 style="font-size:15px;margin:22px 0 6px;">What the sites flagged (${flaggedItems + flagged.filter((f) => f.when !== 'today').reduce((s, f) => s + f.items.length, 0)})</h3>
      ${flagged.sort((a, b) => bySite(a.location_name, b.location_name) || a.checklist_name.localeCompare(b.checklist_name)).map((f) => `
        <div style="border:1px solid ${C.line};border-radius:8px;padding:10px 12px;margin:0 0 8px;">
          <div style="font-size:13px;font-weight:700;">${esc(f.location_name)} <span style="font-weight:400;color:${C.muted};">· ${esc(f.checklist_name)}${f.when !== 'today' ? ` · ${esc(f.when)}` : ''}</span></div>
          ${f.items.map((it) => `
            <div style="margin:6px 0 0;font-size:13px;">
              <span style="font-weight:600;color:${it.done ? C.amber : C.red};">${it.done ? '&#10003; Done, with a comment' : '&#10007; Not done'}:</span> ${esc(it.label)}
              ${it.notes.map((n) => `<div style="margin:2px 0 0 14px;color:#374151;">&ldquo;${esc(n.text)}&rdquo;${n.by ? ` <span style="color:${C.muted};">${esc(n.by)}</span>` : ''}</div>`).join('')}
            </div>`).join('')}
        </div>`).join('')}`
    : ''

  const total = today.length
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${C.ink};max-width:720px;margin:0 auto;padding:20px;">
      <h2 style="margin:0 0 2px;font-size:20px;">Checklists: ${esc(longDay(day))}</h2>
      <p style="margin:0 0 14px;color:${C.muted};font-size:13px;">Mighty Wash · ${total} checklist${total === 1 ? '' : 's'} due across ${sites.size} site${sites.size === 1 ? '' : 's'} today</p>
      <table style="border-collapse:collapse;width:100%;margin:0 0 14px;"><tr>
        ${tile('Not submitted', missedTotal, missedTotal ? C.red : C.green, missedTotal ? C.redBg : C.greenBg)}
        ${tile('Submitted', submittedToday.length, C.ink, C.soft)}
        ${tile('Still open', openToday.length, C.amber, C.amberBg)}
        ${tile('Flagged items', flaggedItems, flaggedItems ? C.amber : C.ink, flaggedItems ? C.amberBg : C.soft)}
      </tr></table>
      ${alert}
      ${openBlock}
      ${matrix}
      ${lastInBlock}
      ${flaggedBlock}
      <p style="margin:22px 0 0;">
        <a href="${esc(appUrl)}/app/checklists?tab=rm_audit" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Open RM Audit</a>
      </p>
      <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">Sent at 8 PM Central every night to the Regional Managers, Kevan Jowers and Laramie Keith by WashLyfe Operator.</p>
    </div>`
  const subject = missedTotal > 0
    ? `Checklists ${shortDay(day)}: ${missedTotal} not submitted`
    : `Checklists ${shortDay(day)}: all submitted so far`
  return {
    html,
    subject,
    counts: { due: total, submitted: submittedToday.length, missed_today: missedToday.length, missed_last_night: missedLast.length, still_open: openToday.length, flagged_items: flaggedItems },
  }
}
