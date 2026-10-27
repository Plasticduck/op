import type { GoalWithDetail } from '@/lib/queries/execGoals'

// The math behind the Quarterly Goal Tracker: progress, pace (where a goal should
// be today if progress ran in a straight line from its start to its due date),
// how many days ahead or behind that pace it is, and a forecast finish.

const DAY = 86_400_000
export const toDate = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00')
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY)
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)

// Quarter keys look like '2026-Q4'.
export function quarterOf(d: Date): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
}
export function quarterRange(q: string): { start: Date; end: Date; label: string } {
  const [y, qn] = [Number(q.slice(0, 4)), Number(q.slice(-1))]
  const start = new Date(y, (qn - 1) * 3, 1, 12)
  const end = new Date(y, qn * 3, 0, 12)
  return { start, end, label: `Q${qn} ${y}` }
}
export function shiftQuarter(q: string, by: number): string {
  const [y, qn] = [Number(q.slice(0, 4)), Number(q.slice(-1))]
  const idx = y * 4 + (qn - 1) + by
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`
}

export type GoalStatus = 'done' | 'dropped' | 'upcoming' | 'on_track' | 'at_risk' | 'off_track' | 'missed'

export const STATUS_META: Record<GoalStatus, { label: string; text: string; bg: string; bar: string }> = {
  done: { label: 'Done', text: 'text-ok', bg: 'bg-ok-soft', bar: 'bg-ok' },
  on_track: { label: 'On track', text: 'text-accent', bg: 'bg-accent-soft', bar: 'bg-accent' },
  at_risk: { label: 'At risk', text: 'text-warn', bg: 'bg-warn-soft', bar: 'bg-warn' },
  off_track: { label: 'Off track', text: 'text-danger', bg: 'bg-danger-soft', bar: 'bg-danger' },
  missed: { label: 'Missed', text: 'text-danger', bg: 'bg-danger-soft', bar: 'bg-danger' },
  upcoming: { label: 'Not started', text: 'text-ink-muted', bg: 'bg-content', bar: 'bg-ink-subtle' },
  dropped: { label: 'Dropped', text: 'text-ink-subtle', bg: 'bg-content', bar: 'bg-ink-subtle' },
}

// Progress 0..1. A number goal runs start -> target (either direction, so a
// "lower churn" goal works too); a milestone goal is the share of milestones done.
export function progressOf(g: GoalWithDetail): number {
  if (g.status_override === 'done') return 1
  if (g.kind === 'milestones') {
    const ms = g.milestones
    return ms.length ? ms.filter((m) => m.done_at).length / ms.length : 0
  }
  const s = Number(g.start_value ?? 0)
  const t = Number(g.target_value ?? 0)
  const c = Number(g.current_value ?? s)
  if (t === s) return c === t ? 1 : 0
  return Math.max(0, Math.min(1, (c - s) / (t - s)))
}

export type GoalPace = {
  progress: number
  expected: number      // where it should be today, 0..1
  aheadDays: number     // + ahead of pace, - behind
  status: GoalStatus
  forecast: { finish: Date | null; reachByDue: number } // linear projection
}

export function paceOf(g: GoalWithDetail, today = new Date()): GoalPace {
  const start = toDate(g.start_date)
  const due = toDate(g.due_date)
  const span = Math.max(1, daysBetween(start, due))
  const elapsed = Math.max(0, Math.min(span, daysBetween(start, today)))
  const progress = progressOf(g)
  const expected = elapsed / span
  const aheadDays = Math.round(progress * span - elapsed)

  let status: GoalStatus
  if (g.status_override === 'dropped') status = 'dropped'
  else if (progress >= 1) status = 'done'
  else if (today < start) status = 'upcoming'
  else if (today > due) status = 'missed'
  else if (expected - progress <= 0.05) status = 'on_track'
  else if (expected - progress <= 0.15) status = 'at_risk'
  else status = 'off_track'

  // Straight-line forecast from the start date at the pace so far.
  let finish: Date | null = null
  let reachByDue = progress
  if (progress >= 1) finish = null
  else if (elapsed > 0 && progress > 0) {
    const perDay = progress / elapsed
    finish = addDays(start, Math.ceil(1 / perDay))
    reachByDue = Math.min(1, perDay * span)
  }
  return { progress, expected, aheadDays, status, forecast: { finish, reachByDue } }
}

// Progress points over time for the chart: check-ins (number goals) or completed
// milestones (milestone goals), starting from 0 at the start date.
export function progressHistory(g: GoalWithDetail): { date: Date; p: number }[] {
  const start = toDate(g.start_date)
  const pts: { date: Date; p: number }[] = [{ date: start, p: 0 }]
  if (g.kind === 'milestones') {
    const total = g.milestones.length || 1
    const done = g.milestones.filter((m) => m.done_at).map((m) => new Date(m.done_at!)).sort((a, b) => a.getTime() - b.getTime())
    done.forEach((d, i) => pts.push({ date: d, p: (i + 1) / total }))
    return pts
  }
  const s = Number(g.start_value ?? 0)
  const t = Number(g.target_value ?? 0)
  const toP = (v: number) => (t === s ? (v === t ? 1 : 0) : Math.max(0, Math.min(1, (v - s) / (t - s))))
  for (const c of [...g.checkins].filter((c) => c.value != null).sort((a, b) => a.checkin_date.localeCompare(b.checkin_date))) {
    pts.push({ date: toDate(c.checkin_date), p: toP(Number(c.value)) })
  }
  return pts
}

export function fmtValue(v: number | null | undefined, unit: string | null | undefined): string {
  if (v == null) return '–'
  const n = Number(v)
  const num = Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  const u = (unit ?? '').trim()
  if (u === '$') return `$${num}`
  if (u === '%') return `${num}%`
  return u ? `${num} ${u}` : num
}
