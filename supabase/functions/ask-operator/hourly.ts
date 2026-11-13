// Operator AI's hourly_cars tool: cars washed by hour of the day per Mighty Wash
// site (site-local time), from site_hourly_cars (sync-site-hourly, migration 0235),
// counted like Site Performance (DRB + FlexWash, test cars out).
// Before answering it refreshes today from DRB and FlexWash when the stored copy
// is more than a few minutes old, and reads DRB live for days before the stored
// history begins (a month at a time), saving them so the next question has them.

import type Anthropic from 'npm:@anthropic-ai/sdk'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { MW_ACCOUNT, addDays, centralToday, minDate, syncHourly } from '../_shared/hourly_cars.ts'

export const HOURLY_TOOL: Anthropic.Tool = {
  name: 'hourly_cars',
  description:
    "Cars washed by HOUR of the day at Mighty Wash sites, in each site's local time, from DRB SiteWatch and FlexWash (whichever the site used on each day). Counts match Site Performance's car counts (test cars left out); today is refreshed live. Use for busiest/slowest hours, hourly car counts on a day, hourly traffic over a period, a typical week by weekday and hour, or staffing by hour. view: 'hours' = each day hour by hour; 'by_hour' = total and average per day for each hour of the day over the range; 'typical_week' = average cars per weekday and hour. Default: 'hours' for 7 days or fewer, else 'by_hour'. sites: names or numbers (omit for every site the user can see). combine: add the sites together into one series (default true when more than one site; false gives each site its own rows).",
  input_schema: {
    type: 'object',
    properties: {
      start: { type: 'string', description: 'Start date YYYY-MM-DD.' },
      end: { type: 'string', description: 'End date YYYY-MM-DD (today at the latest).' },
      view: { type: 'string', enum: ['hours', 'by_hour', 'typical_week'], description: 'How to shape the result (see the tool description).' },
      sites: { type: 'array', items: { type: 'string' }, description: 'Optional site names or numbers, e.g. ["MW16", "23"].' },
      combine: { type: 'boolean', description: 'Add the sites together (default true for more than one site).' },
    },
    required: ['start', 'end'],
  },
}

// The table is backfilled from here; earlier days are read live on request.
const STORED_FROM = '2026-01-01'
const LIVE_HISTORY_DAYS = 31
const FRESH_MS = 10 * 60_000
const MAX_ROWS = 600
const MAX_RANGE_DAYS = 400
const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000) + 1

type Input = { start?: string; end?: string; view?: string; combine?: boolean }
type Row = { site_number: number | null; date: string | null; weekday: number | null; hour: number; cars: number; days: number; avg_cars: number | null }

// sites: site numbers already resolved and limited to what the user may see
// (null = all of them).
export async function hourlyCars(
  input: Input,
  sites: number[] | null,
  ctx: { svc: SupabaseClient; userClient: SupabaseClient },
): Promise<string> {
  const today = centralToday()
  if (!isDate(input.start) || !isDate(input.end)) throw new Error('start and end must be YYYY-MM-DD dates.')
  const start = input.start
  const end = minDate(input.end, today)
  if (start > end) throw new Error(start > today ? 'That range is in the future.' : 'start must be on or before end.')
  if (daysBetween(start, end) > MAX_RANGE_DAYS) throw new Error(`Ask for ${MAX_RANGE_DAYS} days or fewer at a time.`)
  const view = input.view === 'hours' || input.view === 'by_hour' || input.view === 'typical_week'
    ? input.view
    : daysBetween(start, end) <= 7 ? 'hours' : 'by_hour'
  const combine = input.combine ?? !(sites && sites.length === 1)
  const notes: string[] = [
    "Hours are local time at each site (Mountain for the New Mexico sites, Central for the rest); 7 = 7:00 to 7:59 AM.",
    'Counts match Site Performance (DRB + FlexWash, test cars left out).',
  ]

  // Today, fresh.
  let asOf: string | null = null
  if (end === today) {
    const { data } = await ctx.svc.from('site_hourly_cars').select('updated_at').eq('account_id', MW_ACCOUNT).eq('date', today)
      .order('updated_at', { ascending: false }).limit(1)
    const last = data?.[0]?.updated_at ? Date.parse(data[0].updated_at as string) : 0
    if (Date.now() - last > FRESH_MS) {
      const r = await syncHourly(ctx.svc, today, today).catch((e) => ({ errors: [String(e)] }))
      if (r.errors.length) notes.push(`Today's refresh partly failed (${r.errors.slice(0, 2).join('; ').slice(0, 200)}); today may be missing the latest hour.`)
      asOf = new Date().toISOString()
    } else asOf = new Date(last).toISOString()
  }

  // Days before the stored history: read DRB live (a month at a time) and keep them.
  if (start < STORED_FROM) {
    const gapEnd = minDate(end, addDays(STORED_FROM, -1))
    const { data: have } = await ctx.svc.from('site_hourly_cars').select('date').eq('account_id', MW_ACCOUNT).eq('source', 'drb')
      .gte('date', start).lte('date', gapEnd).limit(5000)
    const got = new Set((have ?? []).map((r) => String(r.date)))
    const missing: string[] = []
    for (let d = start; d <= gapEnd; d = addDays(d, 1)) if (!got.has(d)) missing.push(d)
    if (missing.length > LIVE_HISTORY_DAYS) {
      notes.push(`Hourly history before ${STORED_FROM} is not stored, and ${missing.length} of the days asked for are before it. Ask for ${LIVE_HISTORY_DAYS} days or fewer before ${STORED_FROM} at a time; only stored days are included below.`)
    } else if (missing.length) {
      const r = await syncHourly(ctx.svc, missing[0], missing[missing.length - 1], 'drb').catch((e) => ({ errors: [String(e)] }))
      if (r.errors.length) notes.push(`Reading older days from SiteWatch partly failed (${r.errors.slice(0, 2).join('; ').slice(0, 200)}).`)
    }
  }

  const rows: Row[] = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await ctx.userClient.rpc('site_hourly_summary', {
      p_start: start, p_end: end, p_sites: sites, p_view: view, p_combine: combine,
    }).range(from, from + 999)
    if (error) throw new Error(error.message)
    // An hour whose only wash was a test car nets to 0; leave it out.
    rows.push(...((data ?? []) as Row[]).filter((r) => Number(r.cars) !== 0))
    if (!data || data.length < 1000) break
  }
  if (!rows.length) notes.push('No hourly car counts for those sites and dates.')

  const site = (r: Row) => (r.site_number == null ? 'all' : `MW${String(r.site_number).padStart(2, '0')}`)
  const n = (v: unknown) => Math.round(Number(v) * 10) / 10
  let columns: string[]
  let out: unknown[][]
  if (view === 'hours') {
    columns = combine ? ['date', 'weekday', 'hour', 'cars'] : ['site', 'date', 'weekday', 'hour', 'cars']
    out = rows.map((r) => [...(combine ? [] : [site(r)]), r.date, WEEKDAYS[r.weekday ?? 0], r.hour, n(r.cars)])
  } else if (view === 'by_hour') {
    columns = [...(combine ? [] : ['site']), 'hour', 'total_cars', 'days_with_cars', 'avg_cars_per_day']
    out = rows.map((r) => [...(combine ? [] : [site(r)]), r.hour, n(r.cars), r.days, r.avg_cars == null ? null : n(r.avg_cars)])
  } else {
    columns = [...(combine ? [] : ['site']), 'weekday', 'hour', 'total_cars', 'days_with_cars', 'avg_cars_per_day']
    out = rows.map((r) => [...(combine ? [] : [site(r)]), WEEKDAYS[r.weekday ?? 0], r.hour, n(r.cars), r.days, r.avg_cars == null ? null : n(r.avg_cars)])
  }
  if (out.length > MAX_ROWS) {
    notes.push(`Showing the first ${MAX_ROWS} of ${out.length} rows. Narrow the dates or sites, set combine, or use by_hour / typical_week for a summary.`)
    out = out.slice(0, MAX_ROWS)
  }
  return JSON.stringify({
    view, start, end, combine,
    sites: sites ? sites.map((s) => `MW${String(s).padStart(2, '0')}`) : 'every site the user can see',
    ...(asOf ? { today_as_of: asOf } : {}),
    notes, columns, rows: out,
  })
}
