import { supabase } from '@/lib/supabase'
import { currency, shortDate, dateTime } from '@/lib/format'
import type { ReportResult } from './types'

const hoursBetween = (a: string, b: string | null) =>
  b ? (new Date(b).getTime() - new Date(a).getTime()) / 3600000 : 0

async function employeesFor(locs: string[]) {
  const { data } = await supabase
    .from('employees')
    .select('id, first_name, last_name, hourly_rate, role_title')
    .in('location_id', locs)
  return ((data as { id: string; first_name: string; last_name: string; hourly_rate: number | null; role_title: string | null }[] | null) ?? [])
}

// ---- OPS -------------------------------------------------------------------
export async function checklistCompletion(locs: string[], start: string, end: string): Promise<ReportResult> {
  const { data: cls } = await supabase.from('checklists').select('id, name, frequency').in('location_id', locs)
  const { data: comps } = await supabase
    .from('checklist_completions')
    .select('checklist_id, completed_at')
    .in('location_id', locs)
    .gte('completed_at', start)
    .lte('completed_at', end)
  const list = (cls as { id: string; name: string; frequency: string }[] | null) ?? []
  const completions = (comps as { checklist_id: string; completed_at: string }[] | null) ?? []
  const rows = list.map((c) => {
    const cc = completions.filter((x) => x.checklist_id === c.id)
    const last = cc.map((x) => x.completed_at).sort().at(-1)
    return { name: c.name, frequency: c.frequency, completions: cc.length, last: last ? shortDate(last) : '—' }
  })
  return {
    rows,
    stats: [
      { label: 'Completions', value: completions.length },
      { label: 'Checklists', value: list.length },
      { label: 'Avg / checklist', value: list.length ? (completions.length / list.length).toFixed(1) : '0' },
    ],
  }
}

export async function workOrderReport(locs: string[], start: string, end: string): Promise<ReportResult> {
  const { data } = await supabase
    .from('work_orders')
    .select('title, status, priority, cost, created_at, closed_at')
    .in('location_id', locs)
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: false })
  const wos = (data as { title: string; status: string; priority: string; cost: number; created_at: string; closed_at: string | null }[] | null) ?? []
  const closed = wos.filter((w) => w.closed_at)
  const avgDays = closed.length
    ? closed.reduce((a, w) => a + (new Date(w.closed_at!).getTime() - new Date(w.created_at).getTime()) / 86400000, 0) / closed.length
    : 0
  const rows = wos.map((w) => ({
    title: w.title,
    status: w.status.replace('_', ' '),
    priority: w.priority,
    cost: currency(w.cost),
    opened: shortDate(w.created_at),
    closed: w.closed_at ? shortDate(w.closed_at) : '—',
  }))
  return {
    rows,
    stats: [
      { label: 'Opened', value: wos.length },
      { label: 'Closed', value: closed.length },
      { label: 'Avg days to close', value: avgDays.toFixed(1) },
      { label: 'Total cost', value: currency(wos.reduce((a, w) => a + w.cost, 0)) },
    ],
  }
}

export async function downtimeReport(locs: string[], start: string, end: string): Promise<ReportResult> {
  const { data } = await supabase
    .from('downtime_events')
    .select('reason, reason_category, started_at, ended_at, equipment(name)')
    .in('location_id', locs)
    .gte('started_at', start)
    .lte('started_at', end)
    .order('started_at', { ascending: false })
  const evs = (data as unknown as { reason: string | null; reason_category: string | null; started_at: string; ended_at: string | null; equipment: { name: string } | null }[]) ?? []
  const totalHours = evs.reduce((a, e) => a + hoursBetween(e.started_at, e.ended_at ?? new Date().toISOString()), 0)
  const rows = evs.map((e) => ({
    equipment: e.equipment?.name ?? '—',
    category: e.reason_category ?? '—',
    reason: e.reason ?? '—',
    started: dateTime(e.started_at),
    hours: hoursBetween(e.started_at, e.ended_at ?? new Date().toISOString()).toFixed(1),
  }))
  return {
    rows,
    stats: [
      { label: 'Events', value: evs.length },
      { label: 'Total hours', value: totalHours.toFixed(1) },
      { label: 'Avg / event', value: evs.length ? (totalHours / evs.length).toFixed(1) : '0' },
    ],
  }
}

export async function partsReport(locs: string[]): Promise<ReportResult> {
  const { data } = await supabase
    .from('parts_inventory')
    .select('name, sku, quantity_on_hand, reorder_threshold, unit_cost')
    .in('location_id', locs)
    .order('name')
  const parts = (data as { name: string; sku: string | null; quantity_on_hand: number; reorder_threshold: number; unit_cost: number }[] | null) ?? []
  const rows = parts.map((p) => ({
    name: p.name,
    sku: p.sku ?? '—',
    on_hand: p.quantity_on_hand,
    reorder: p.reorder_threshold,
    value: currency(p.quantity_on_hand * p.unit_cost),
    status: p.quantity_on_hand <= p.reorder_threshold ? 'LOW' : 'OK',
  }))
  return {
    rows,
    stats: [
      { label: 'Distinct parts', value: parts.length },
      { label: 'Below reorder', value: parts.filter((p) => p.quantity_on_hand <= p.reorder_threshold).length },
      { label: 'Inventory value', value: currency(parts.reduce((a, p) => a + p.quantity_on_hand * p.unit_cost, 0)) },
    ],
  }
}

export async function closeoutSummary(locs: string[], start: string, end: string): Promise<ReportResult> {
  const startDate = start.slice(0, 10)
  const endDate = end.slice(0, 10)
  const { data } = await supabase
    .from('closeouts')
    .select('date, total_sales, cash_amount, card_amount, deposit_amount')
    .in('location_id', locs)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })
  const cos = (data as { date: string; total_sales: number; cash_amount: number; card_amount: number; deposit_amount: number }[] | null) ?? []
  const total = cos.reduce((a, c) => a + c.total_sales, 0)
  const rows = cos.map((c) => ({
    date: shortDate(c.date),
    total: currency(c.total_sales),
    cash: currency(c.cash_amount),
    card: currency(c.card_amount),
    deposit: currency(c.deposit_amount),
  }))
  return {
    rows,
    stats: [
      { label: 'Total sales', value: currency(total) },
      { label: 'Days', value: cos.length },
      { label: 'Avg / day', value: currency(cos.length ? total / cos.length : 0) },
      { label: 'Cash %', value: total ? `${((cos.reduce((a, c) => a + c.cash_amount, 0) / total) * 100).toFixed(0)}%` : '—' },
    ],
  }
}

// ---- PEOPLE ----------------------------------------------------------------
async function timeEntriesByEmployee(locs: string[], start: string, end: string) {
  const { data } = await supabase
    .from('time_entries')
    .select('employee_id, clock_in, clock_out, auto_closed, edited_at')
    .in('location_id', locs)
    .gte('clock_in', start)
    .lte('clock_in', end)
  return ((data as { employee_id: string; clock_in: string; clock_out: string | null; auto_closed: boolean; edited_at: string | null }[] | null) ?? [])
}

export async function hoursReport(locs: string[], start: string, end: string): Promise<ReportResult> {
  const [emps, entries] = await Promise.all([employeesFor(locs), timeEntriesByEmployee(locs, start, end)])
  const rows = emps.map((e) => {
    const total = entries.filter((t) => t.employee_id === e.id).reduce((a, t) => a + hoursBetween(t.clock_in, t.clock_out), 0)
    const ot = Math.max(0, total - 40)
    return { name: `${e.first_name} ${e.last_name}`, total: total.toFixed(1), regular: (total - ot).toFixed(1), overtime: ot.toFixed(1) }
  }).filter((r) => Number(r.total) > 0)
  const allHours = rows.reduce((a, r) => a + Number(r.total), 0)
  return {
    rows,
    stats: [
      { label: 'Total hours', value: allHours.toFixed(1) },
      { label: 'Employees', value: rows.length },
      { label: 'Overtime hours', value: rows.reduce((a, r) => a + Number(r.overtime), 0).toFixed(1) },
    ],
  }
}

export async function attendanceReport(locs: string[], start: string, end: string): Promise<ReportResult> {
  const [emps, entries] = await Promise.all([employeesFor(locs), timeEntriesByEmployee(locs, start, end)])
  const name = (id: string) => { const e = emps.find((x) => x.id === id); return e ? `${e.first_name} ${e.last_name}` : '—' }
  const flagged = entries.filter((t) => t.auto_closed || t.edited_at)
  const rows = flagged.map((t) => ({
    name: name(t.employee_id),
    in: dateTime(t.clock_in),
    flag: t.auto_closed ? 'Auto-clockout' : 'Edited',
  }))
  return {
    rows,
    stats: [
      { label: 'Flagged entries', value: flagged.length },
      { label: 'Auto-clockouts', value: entries.filter((t) => t.auto_closed).length },
      { label: 'Edited entries', value: entries.filter((t) => t.edited_at).length },
    ],
  }
}

export async function laborCostReport(locs: string[], start: string, end: string): Promise<ReportResult> {
  const [emps, entries] = await Promise.all([employeesFor(locs), timeEntriesByEmployee(locs, start, end)])
  const rows = emps.map((e) => {
    const hours = entries.filter((t) => t.employee_id === e.id).reduce((a, t) => a + hoursBetween(t.clock_in, t.clock_out), 0)
    const rate = e.hourly_rate ?? 0
    return { name: `${e.first_name} ${e.last_name}`, role: e.role_title ?? '—', hours: hours.toFixed(1), rate: currency(rate), cost: currency(hours * rate), _cost: hours * rate }
  }).filter((r) => Number(r.hours) > 0)
  return {
    rows: rows.map(({ _cost, ...r }) => { void _cost; return r }),
    stats: [
      { label: 'Total labor', value: currency(rows.reduce((a, r) => a + r._cost, 0)) },
      { label: 'Employees', value: rows.length },
    ],
  }
}

export async function counselingReport(locs: string[], start: string, end: string): Promise<ReportResult> {
  const emps = await employeesFor(locs)
  const ids = emps.map((e) => e.id)
  if (ids.length === 0) return { rows: [], stats: [{ label: 'Records', value: 0 }] }
  const { data } = await supabase
    .from('counseling_records')
    .select('employee_id, type, date')
    .in('employee_id', ids)
    .gte('date', start.slice(0, 10))
    .lte('date', end.slice(0, 10))
    .order('date', { ascending: false })
  const recs = (data as { employee_id: string; type: string; date: string }[] | null) ?? []
  const name = (id: string) => { const e = emps.find((x) => x.id === id); return e ? `${e.first_name} ${e.last_name}` : '—' }
  const rows = recs.map((r) => ({ name: name(r.employee_id), type: r.type, date: shortDate(r.date) }))
  return {
    rows,
    stats: [
      { label: 'Total records', value: recs.length },
      { label: 'Written+', value: recs.filter((r) => r.type !== 'verbal').length },
      { label: 'PIP / Final', value: recs.filter((r) => r.type === 'pip' || r.type === 'final').length },
    ],
  }
}

export async function injuryReport(locs: string[], start: string, end: string): Promise<ReportResult> {
  const { data } = await supabase
    .from('injury_reports')
    .select('incident_date, body_part_affected, medical_treatment_required, employee:employee_id(first_name, last_name)')
    .in('location_id', locs)
    .gte('incident_date', start.slice(0, 10))
    .lte('incident_date', end.slice(0, 10))
    .order('incident_date', { ascending: false })
  const inj = (data as unknown as { incident_date: string; body_part_affected: string | null; medical_treatment_required: boolean; employee: { first_name: string; last_name: string } | null }[]) ?? []
  const rows = inj.map((i) => ({
    name: i.employee ? `${i.employee.first_name} ${i.employee.last_name}` : '—',
    date: shortDate(i.incident_date),
    body_part: i.body_part_affected ?? '—',
    treatment: i.medical_treatment_required ? 'Required' : 'None',
  }))
  return {
    rows,
    stats: [
      { label: 'Incidents', value: inj.length },
      { label: 'Required treatment', value: inj.filter((i) => i.medical_treatment_required).length },
    ],
  }
}

export async function reviewCompletion(locs: string[]): Promise<ReportResult> {
  const emps = await employeesFor(locs)
  const ids = emps.map((e) => e.id)
  if (ids.length === 0) return { rows: [], stats: [{ label: 'Employees', value: 0 }] }
  const { data } = await supabase
    .from('reviews')
    .select('employee_id, review_date, status')
    .in('employee_id', ids)
    .eq('status', 'completed')
  const reviews = (data as { employee_id: string; review_date: string | null }[] | null) ?? []
  const now = Date.now()
  let overdue = 0
  const rows = emps.map((e) => {
    const last = reviews.filter((r) => r.employee_id === e.id && r.review_date).map((r) => r.review_date!).sort().at(-1)
    const days = last ? Math.floor((now - new Date(last).getTime()) / 86400000) : null
    if (days === null || days > 180) overdue += 1
    return { name: `${e.first_name} ${e.last_name}`, last_review: last ? shortDate(last) : 'Never', days_since: days === null ? '—' : String(days) }
  })
  return {
    rows,
    stats: [
      { label: 'Employees', value: emps.length },
      { label: 'Reviewed', value: emps.length - overdue },
      { label: 'Overdue (180d)', value: overdue },
    ],
  }
}
