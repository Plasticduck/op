import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  CalendarClock, Check, ChevronLeft, ChevronRight, Flag, Loader2, Pencil, Plus, Target, Trash2, Undo2, X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import {
  execGoals,
  GOAL_CATEGORIES,
  GOAL_EXECS,
  type ExecGoalMilestone,
  type GoalWithDetail,
} from '@/lib/queries/execGoals'
import {
  addDays,
  daysBetween,
  fmtValue,
  isoDay,
  paceOf,
  progressHistory,
  quarterOf,
  quarterRange,
  shiftQuarter,
  STATUS_META,
  toDate,
  type GoalPace,
  type GoalStatus,
} from '@/features/opssuite/goalMath'

// Quarterly Goal Tracker: each executive's goals for the quarter on one timeline.
// Every goal runs from its start to its due date; its bar fills with progress,
// and a pace marker shows where it should be today if progress ran in a straight
// line. The gap between the two becomes "days ahead / behind", which drives the
// status, and each goal's detail charts its check-ins against that ideal line
// with a forecast finish. Goals belong to people by name; Kevan enters them.

const pct = (n: number) => `${Math.round(n * 100)}%`
const fmtDay = (d: Date) => format(d, 'MMM d')

function aheadLabel(p: GoalPace): string {
  if (p.status === 'done') return 'Complete'
  if (p.status === 'dropped') return 'Dropped'
  if (p.status === 'upcoming') return 'Starts later'
  if (p.aheadDays === 0) return 'Right on pace'
  const n = Math.abs(p.aheadDays)
  return `${n} day${n === 1 ? '' : 's'} ${p.aheadDays > 0 ? 'ahead' : 'behind'}`
}

function forecastLabel(g: GoalWithDetail, p: GoalPace): string {
  if (p.status === 'done') return 'Goal reached'
  if (p.status === 'dropped' || p.status === 'upcoming') return '–'
  if (p.forecast.finish) {
    const due = toDate(g.due_date)
    return p.forecast.finish <= due
      ? `On pace to finish ${fmtDay(p.forecast.finish)}`
      : `At this pace, ${pct(p.forecast.reachByDue)} by ${fmtDay(due)}`
  }
  return 'No progress logged yet'
}

export default function GoalTrackerPage() {
  const { profile } = useAuth()
  const today = useMemo(() => new Date(), [])
  const [quarter, setQuarter] = useState(() => quarterOf(new Date()))
  const [goals, setGoals] = useState<GoalWithDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [execFilter, setExecFilter] = useState<string | null>(null)
  const [editing, setEditing] = useState<GoalWithDetail | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const q = quarterRange(quarter)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await execGoals.listQuarter(quarter)
    setGoals(((data ?? []) as unknown as GoalWithDetail[]).map((g) => ({
      ...g,
      milestones: [...(g.milestones ?? [])].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.sort - b.sort),
      checkins: [...(g.checkins ?? [])].sort((a, b) => a.checkin_date.localeCompare(b.checkin_date)),
    })))
    setLoading(false)
  }, [quarter])
  useEffect(() => { void load() }, [load])

  const paces = useMemo(() => new Map(goals.map((g) => [g.id, paceOf(g, today)])), [goals, today])
  const openGoal = openId ? goals.find((g) => g.id === openId) ?? null : null

  const shown = execFilter ? goals.filter((g) => g.owner_name === execFilter) : goals
  const byExec = GOAL_EXECS.map((name) => ({
    name,
    goals: shown.filter((g) => g.owner_name === name).sort((a, b) => a.due_date.localeCompare(b.due_date)),
  })).filter((e) => e.goals.length)

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Quarterly Goal Tracker"
        subtitle="Executive goals for the quarter, tracked against the calendar."
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> New goal</Button>}
      />

      <QuarterClock quarter={quarter} today={today} onShift={(by) => { setQuarter((v) => shiftQuarter(v, by)); setExecFilter(null) }} />

      <Scoreboard goals={goals} paces={paces} active={execFilter} onPick={(n) => setExecFilter((v) => (v === n ? null : n))} />

      <section className="mt-6 rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <CalendarClock className="size-4 text-accent" /> Timeline{execFilter ? `: ${execFilter}` : ''}
          </h2>
          <Legend />
        </div>
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted"><Loader2 className="mx-auto size-5 animate-spin" /></p>
        ) : byExec.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Target className="mx-auto size-8 text-ink-subtle" />
            <p className="mt-2 text-sm text-ink-muted">{execFilter ? `No goals for ${execFilter} in ${q.label} yet.` : `No goals for ${q.label} yet.`}</p>
            <Button className="mt-3" onClick={() => setEditing('new')}><Plus className="size-4" /> Add the first goal</Button>
          </div>
        ) : (
          <Timeline quarter={quarter} today={today} groups={byExec} paces={paces} onOpen={setOpenId} />
        )}
      </section>

      {editing && (
        <GoalFormModal
          goal={editing === 'new' ? null : editing}
          quarter={quarter}
          defaultOwner={execFilter}
          accountId={profile?.account_id ?? ''}
          onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); void load(); if (id) setOpenId(id) }}
        />
      )}
      {openGoal && !editing && (
        <GoalDetailModal
          goal={openGoal}
          pace={paces.get(openGoal.id)!}
          today={today}
          accountId={profile?.account_id ?? ''}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditing(openGoal)}
          onChanged={() => void load()}
          onDeleted={() => { setOpenId(null); void load() }}
        />
      )}
    </div>
  )
}

// ---- Quarter clock ----------------------------------------------------------

function QuarterClock({ quarter, today, onShift }: { quarter: string; today: Date; onShift: (by: number) => void }) {
  const q = quarterRange(quarter)
  const total = daysBetween(q.start, q.end) + 1
  const elapsed = Math.max(0, Math.min(total, daysBetween(q.start, today) + 1))
  const left = total - elapsed
  const frac = elapsed / total
  const months = [0, 1, 2].map((i) => new Date(q.start.getFullYear(), q.start.getMonth() + i, 1, 12))
  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onShift(-1)} aria-label="Previous quarter"
            className="grid size-8 place-items-center rounded-md border border-border text-ink-muted hover:text-ink"><ChevronLeft className="size-4" /></button>
          <div>
            <div className="text-lg font-bold text-ink">{q.label}</div>
            <div className="text-xs text-ink-muted">{format(q.start, 'MMM d')} to {format(q.end, 'MMM d, yyyy')}</div>
          </div>
          <button type="button" onClick={() => onShift(1)} aria-label="Next quarter"
            className="grid size-8 place-items-center rounded-md border border-border text-ink-muted hover:text-ink"><ChevronRight className="size-4" /></button>
        </div>
        <div className="flex items-baseline gap-4 text-sm">
          <span><span className="text-2xl font-extrabold tabular-nums text-ink">{left}</span> <span className="text-ink-muted">days left</span></span>
          <span className="text-ink-muted"><span className="font-semibold tabular-nums text-ink">{pct(frac)}</span> of the quarter gone</span>
        </div>
      </div>
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-content">
        <div className="h-full rounded-full bg-accent/70" style={{ width: `${frac * 100}%` }} />
        {months.slice(1).map((m) => (
          <span key={m.getMonth()} className="absolute top-0 h-full w-px bg-card" style={{ left: `${(daysBetween(q.start, m) / total) * 100}%` }} />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-ink-subtle">
        {months.map((m) => (
          <span key={m.getMonth()} className="absolute" style={{ left: `${(daysBetween(q.start, m) / total) * 100}%` }}>{format(m, 'MMMM')}</span>
        ))}
      </div>
    </section>
  )
}

// ---- Scoreboard -------------------------------------------------------------

function Ring({ value, status }: { value: number; status: GoalStatus | null }) {
  const r = 18
  const c = 2 * Math.PI * r
  const color = status ? STATUS_META[status].text : 'text-ink-subtle'
  return (
    <svg viewBox="0 0 44 44" className="size-12 shrink-0 -rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" className="stroke-current text-content" />
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`} className={cn('stroke-current transition-all', color)} />
      <text x="22" y="22" transform="rotate(90 22 22)" textAnchor="middle" dominantBaseline="central"
        className="fill-current text-ink" style={{ fontSize: 11, fontWeight: 700 }}>{Math.round(value * 100)}</text>
    </svg>
  )
}

const RANK: GoalStatus[] = ['missed', 'off_track', 'at_risk', 'on_track', 'upcoming', 'done', 'dropped']

function Scoreboard({ goals, paces, active, onPick }: {
  goals: GoalWithDetail[]
  paces: Map<string, GoalPace>
  active: string | null
  onPick: (name: string) => void
}) {
  return (
    <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {GOAL_EXECS.map((name) => {
        const mine = goals.filter((g) => g.owner_name === name && g.status_override !== 'dropped')
        const ps = mine.map((g) => paces.get(g.id)!)
        const avg = ps.length ? ps.reduce((a, p) => a + p.progress, 0) / ps.length : 0
        // The ring takes the color of the exec's most urgent goal.
        const worst = RANK.find((s) => ps.some((p) => p.status === s)) ?? null
        const count = (s: GoalStatus) => ps.filter((p) => p.status === s).length
        return (
          <button key={name} type="button" onClick={() => onPick(name)}
            className={cn('flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-accent',
              active === name ? 'border-accent ring-2 ring-accent/30' : 'border-border')}>
            <Ring value={avg} status={ps.length ? worst : null} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{name}</div>
              <div className="text-xs text-ink-muted">{mine.length ? `${mine.length} goal${mine.length === 1 ? '' : 's'}` : 'No goals yet'}</div>
              {ps.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-semibold">
                  {count('done') > 0 && <span className="rounded bg-ok-soft px-1 text-ok">{count('done')} done</span>}
                  {count('on_track') > 0 && <span className="rounded bg-accent-soft px-1 text-accent">{count('on_track')} on track</span>}
                  {count('at_risk') > 0 && <span className="rounded bg-warn-soft px-1 text-warn">{count('at_risk')} at risk</span>}
                  {count('off_track') + count('missed') > 0 && <span className="rounded bg-danger-soft px-1 text-danger">{count('off_track') + count('missed')} behind</span>}
                </div>
              )}
            </div>
          </button>
        )
      })}
    </section>
  )
}

// ---- Timeline ---------------------------------------------------------------

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded-full bg-accent" /> progress</span>
      <span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-ink" /> pace today</span>
      <span className="inline-flex items-center gap-1"><span className="size-2 rotate-45 border border-ink-muted bg-card" /> milestone</span>
      <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-ink-muted" /> check-in</span>
    </div>
  )
}

function Timeline({ quarter, today, groups, paces, onOpen }: {
  quarter: string
  today: Date
  groups: { name: string; goals: GoalWithDetail[] }[]
  paces: Map<string, GoalPace>
  onOpen: (id: string) => void
}) {
  const q = quarterRange(quarter)
  const total = daysBetween(q.start, q.end) + 1
  const pos = (d: Date) => Math.max(0, Math.min(100, (daysBetween(q.start, d) / total) * 100))
  const months = [0, 1, 2].map((i) => new Date(q.start.getFullYear(), q.start.getMonth() + i, 1, 12))
  const todayIn = today >= q.start && today <= addDays(q.end, 1)
  const todayPos = pos(today)

  // Faint month boundaries and the today line, repeated on every row so they
  // read as continuous lines down the timeline.
  const Guides = () => (
    <>
      {months.slice(1).map((m) => <span key={m.getMonth()} className="absolute inset-y-0 w-px bg-border" style={{ left: `${pos(m)}%` }} />)}
      {todayIn && <span className="absolute inset-y-0 w-px bg-danger/60" style={{ left: `${todayPos}%` }} />}
    </>
  )

  return (
    <div className="px-4 pb-4">
      {/* Axis */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] md:gap-4">
        <div className="hidden md:block" />
        <div className="relative h-7 text-[11px] font-medium text-ink-subtle">
          {months.map((m) => <span key={m.getMonth()} className="absolute bottom-1" style={{ left: `${pos(m)}%` }}>{format(m, 'MMM')}</span>)}
          {todayIn && (
            <span className="absolute bottom-1 -translate-x-1/2 rounded bg-danger px-1 text-[10px] font-semibold text-white" style={{ left: `${todayPos}%` }}>Today</span>
          )}
        </div>
      </div>

      {groups.map((grp) => (
        <div key={grp.name} className="mt-2">
          <div className="border-t border-border pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{grp.name}</div>
          {grp.goals.map((g) => {
            const p = paces.get(g.id)!
            const meta = STATUS_META[p.status]
            const s = toDate(g.start_date)
            const d = toDate(g.due_date)
            const left = pos(s)
            const width = Math.max(1.5, pos(addDays(d, 1)) - left)
            return (
              <button key={g.id} type="button" onClick={() => onOpen(g.id)}
                className="grid w-full grid-cols-1 items-center text-left hover:bg-content/60 md:grid-cols-[260px_1fr] md:gap-4">
                <div className="flex min-w-0 items-center gap-2 pt-2 md:py-2">
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', meta.bg, meta.text)}>{meta.label}</span>
                  <span className="truncate text-sm text-ink" title={g.title}>{g.title}</span>
                </div>
                <div className="relative h-10">
                  <Guides />
                  {/* The goal's window, filled with progress. */}
                  <div className="absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full border border-border bg-content"
                    style={{ left: `${left}%`, width: `${width}%` }}>
                    <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${p.progress * 100}%` }} />
                  </div>
                  {/* Pace: where it should be today. */}
                  {(p.status === 'on_track' || p.status === 'at_risk' || p.status === 'off_track') && (
                    <span className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded bg-ink" title={`Pace today: ${pct(p.expected)}`}
                      style={{ left: `calc(${left}% + ${p.expected} * ${width}%)` }} />
                  )}
                  {g.milestones.filter((m) => m.due_date).map((m) => {
                    const md = toDate(m.due_date!)
                    const late = !m.done_at && md < today
                    return (
                      <span key={m.id} title={`${m.title} (${fmtDay(md)})${m.done_at ? ', done' : late ? ', overdue' : ''}`}
                        className={cn('absolute top-1 size-2.5 -translate-x-1/2 rotate-45 border',
                          m.done_at ? 'border-ok bg-ok' : late ? 'border-danger bg-danger' : 'border-ink-muted bg-card')}
                        style={{ left: `${pos(md)}%` }} />
                    )
                  })}
                  {g.checkins.map((c) => (
                    <span key={c.id} title={`Check-in ${fmtDay(toDate(c.checkin_date))}${c.note ? `: ${c.note}` : ''}`}
                      className="absolute bottom-0.5 size-1.5 -translate-x-1/2 rounded-full bg-ink-muted" style={{ left: `${pos(toDate(c.checkin_date))}%` }} />
                  ))}
                  <span className={cn('absolute top-1/2 -translate-y-1/2 pl-1.5 text-[11px] font-semibold tabular-nums', meta.text)}
                    style={{ left: `${Math.min(92, left + width)}%` }}>{pct(p.progress)}</span>
                </div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ---- Goal detail ------------------------------------------------------------

function BurnUp({ goal, pace, today }: { goal: GoalWithDetail; pace: GoalPace; today: Date }) {
  const W = 600, H = 220, L = 54, R = 14, T = 14, B = 28
  const s = toDate(goal.start_date)
  const d = toDate(goal.due_date)
  const span = Math.max(1, daysBetween(s, d))
  const x = (dt: Date) => L + (Math.max(0, Math.min(span, daysBetween(s, dt))) / span) * (W - L - R)
  const y = (p: number) => T + (1 - Math.max(0, Math.min(1, p))) * (H - T - B)

  const hist = progressHistory(goal)
  const pts = [...hist]
  const t = today < s ? s : today > d ? d : today
  if (today >= s && pace.progress !== pts[pts.length - 1].p) pts.push({ date: t, p: pace.progress })
  // Step line: progress holds until the next check-in.
  let path = `M${x(pts[0].date)},${y(pts[0].p)}`
  for (let i = 1; i < pts.length; i++) path += ` H${x(pts[i].date)} V${y(pts[i].p)}`

  const isNum = goal.kind === 'metric'
  const yLabel = (p: number) => {
    if (!isNum) return pct(p)
    const sv = Number(goal.start_value ?? 0), tv = Number(goal.target_value ?? 0)
    return fmtValue(sv + (tv - sv) * p, goal.unit)
  }
  const showForecast = pace.status !== 'done' && pace.status !== 'dropped' && today >= s && today <= d && pace.progress > 0
  const fEnd = pace.forecast.finish && pace.forecast.finish <= d
    ? { date: pace.forecast.finish, p: 1 }
    : { date: d, p: pace.forecast.reachByDue }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Progress over time against the ideal pace">
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} className="stroke-current text-border" strokeWidth="1" />
          <text x={L - 6} y={y(p)} textAnchor="end" dominantBaseline="central" className="fill-current text-ink-subtle" style={{ fontSize: 10 }}>{yLabel(p)}</text>
        </g>
      ))}
      {[s, addDays(s, Math.round(span / 2)), d].map((dt, i) => (
        <text key={i} x={x(dt)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="fill-current text-ink-subtle" style={{ fontSize: 10 }}>{fmtDay(dt)}</text>
      ))}
      {/* Ideal pace. */}
      <line x1={x(s)} y1={y(0)} x2={x(d)} y2={y(1)} className="stroke-current text-ink-subtle" strokeWidth="1.5" strokeDasharray="5 4" />
      {/* Today. */}
      {today >= s && today <= d && (
        <line x1={x(today)} x2={x(today)} y1={T} y2={H - B} className="stroke-current text-danger/60" strokeWidth="1" />
      )}
      {/* Forecast from today at the pace so far. */}
      {showForecast && (
        <line x1={x(t)} y1={y(pace.progress)} x2={x(fEnd.date)} y2={y(fEnd.p)} className={cn('stroke-current', STATUS_META[pace.status].text)} strokeWidth="1.5" strokeDasharray="2 4" />
      )}
      {/* Actual. */}
      <path d={path} fill="none" className={cn('stroke-current', STATUS_META[pace.status].text)} strokeWidth="2.5" strokeLinejoin="round" />
      {pts.slice(1).map((pt, i) => (
        <circle key={i} cx={x(pt.date)} cy={y(pt.p)} r="3.5" className={cn('fill-current', STATUS_META[pace.status].text)} />
      ))}
    </svg>
  )
}

function GoalDetailModal({ goal, pace, today, accountId, onClose, onEdit, onChanged, onDeleted }: {
  goal: GoalWithDetail
  pace: GoalPace
  today: Date
  accountId: string
  onClose: () => void
  onEdit: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const meta = STATUS_META[pace.status]
  const isNum = goal.kind === 'metric'
  const [ciDate, setCiDate] = useState(isoDay(today))
  const [ciValue, setCiValue] = useState(goal.current_value != null ? String(goal.current_value) : '')
  const [ciNote, setCiNote] = useState('')
  const [msTitle, setMsTitle] = useState('')
  const [msDate, setMsDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null } | void>) => {
    setBusy(true)
    setError(null)
    const res = await fn()
    setBusy(false)
    if (res && res.error) { setError(res.error.message); return }
    onChanged()
  }

  const addCheckin = () => run(async () => {
    const v = ciValue.trim() === '' ? null : Number(ciValue)
    if (isNum && v != null && Number.isNaN(v)) return { error: { message: 'Enter a number for the value.' } }
    if (!ciNote.trim() && (v == null || !isNum)) return { error: { message: 'Add a value or a note.' } }
    const { error: err } = await execGoals.addCheckin({ account_id: accountId, goal_id: goal.id, checkin_date: ciDate, value: isNum ? v : null, note: ciNote.trim() || null })
    if (err) return { error: err }
    // The newest check-in sets the goal's current value.
    const latest = goal.checkins.filter((c) => c.value != null).map((c) => c.checkin_date).sort().pop()
    if (isNum && v != null && (!latest || ciDate >= latest)) {
      const { error: e2 } = await execGoals.update(goal.id, { current_value: v })
      if (e2) return { error: e2 }
    }
    setCiNote('')
  })

  const toggleMilestone = (m: ExecGoalMilestone) =>
    run(() => execGoals.updateMilestone(m.id, { done_at: m.done_at ? null : new Date().toISOString() }).then((r) => ({ error: r.error })))
  const addMilestone = () => run(async () => {
    if (!msTitle.trim()) return { error: { message: 'Name the milestone.' } }
    const { error: err } = await execGoals.addMilestones([{ account_id: accountId, goal_id: goal.id, title: msTitle.trim(), due_date: msDate || null, sort: goal.milestones.length }])
    if (err) return { error: err }
    setMsTitle(''); setMsDate('')
  })
  const setOverride = (v: 'done' | 'dropped' | null) =>
    run(() => execGoals.update(goal.id, { status_override: v }).then((r) => ({ error: r.error })))
  const remove = async () => {
    if (!window.confirm(`Delete "${goal.title}"? Its milestones and check-ins go with it.`)) return
    setBusy(true)
    await execGoals.remove(goal.id)
    setBusy(false)
    onDeleted()
  }

  return (
    <Modal open onClose={onClose} title={goal.title} size="lg">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-content px-2 py-0.5 font-semibold text-ink">{goal.owner_name}</span>
          {goal.category && <span className="rounded-full bg-content px-2 py-0.5 text-ink-muted">{goal.category}</span>}
          <span className={cn('rounded-full px-2 py-0.5 font-bold', meta.bg, meta.text)}>{meta.label}</span>
          <span className="text-ink-muted">{fmtDay(toDate(goal.start_date))} to {format(toDate(goal.due_date), 'MMM d, yyyy')}</span>
        </div>
        {goal.description && <p className="whitespace-pre-wrap text-sm text-ink-muted">{goal.description}</p>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Progress" value={pct(pace.progress)} sub={isNum ? `${fmtValue(goal.current_value ?? goal.start_value, goal.unit)} of ${fmtValue(goal.target_value, goal.unit)}` : `${goal.milestones.filter((m) => m.done_at).length} of ${goal.milestones.length} milestones`} />
          <Stat label="Pace today" value={pace.status === 'upcoming' ? '–' : pct(pace.expected)} sub="if progress were even" />
          <Stat label="Versus pace" value={aheadLabel(pace)} tone={pace.aheadDays < 0 && pace.status !== 'done' ? 'bad' : 'good'} />
          <Stat label="Forecast" value={forecastLabel(goal, pace)} small />
        </div>

        <div className="rounded-lg border border-border bg-content/40 p-2">
          <BurnUp goal={goal} pace={pace} today={today} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pb-1 text-[11px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5"><span className={cn('h-0.5 w-4 rounded bg-current', meta.text)} /> actual</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-subtle" /> ideal pace</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn('w-4 border-t-2 border-dotted', meta.text)} /> forecast</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-danger" /> today</span>
          </div>
        </div>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        {/* Check-in */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Check in</h3>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[150px_150px_1fr_auto]">
            <Input type="date" value={ciDate} onChange={(e) => setCiDate(e.target.value)} aria-label="Check-in date" />
            {isNum ? (
              <Input type="number" inputMode="decimal" value={ciValue} onChange={(e) => setCiValue(e.target.value)} placeholder={`Value${goal.unit ? ` (${goal.unit})` : ''}`} aria-label="Current value" />
            ) : <div className="hidden sm:block" />}
            <Input value={ciNote} onChange={(e) => setCiNote(e.target.value)} placeholder="What moved? (optional note)" aria-label="Note" />
            <Button onClick={() => void addCheckin()} disabled={busy}><Check className="size-4" /> Log</Button>
          </div>
          {goal.checkins.length > 0 && (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {[...goal.checkins].reverse().map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span className="w-14 shrink-0 text-xs text-ink-muted">{fmtDay(toDate(c.checkin_date))}</span>
                  {c.value != null && <span className="shrink-0 font-semibold tabular-nums text-ink">{fmtValue(Number(c.value), goal.unit)}</span>}
                  <span className="min-w-0 flex-1 text-ink-muted">{c.note}</span>
                  <button type="button" onClick={() => void run(() => execGoals.removeCheckin(c.id).then((r) => ({ error: r.error })))} aria-label="Delete check-in"
                    className="shrink-0 text-ink-subtle hover:text-danger"><X className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Milestones */}
        <section>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <Flag className="size-3.5" /> Milestones{!isNum && ' (they drive this goal’s progress)'}
          </h3>
          {goal.milestones.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {goal.milestones.map((m) => {
                const late = !m.done_at && m.due_date && toDate(m.due_date) < today
                return (
                  <li key={m.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                    <input type="checkbox" checked={!!m.done_at} onChange={() => void toggleMilestone(m)} className="size-4 accent-accent" aria-label={`Mark ${m.title} done`} />
                    <span className={cn('min-w-0 flex-1', m.done_at ? 'text-ink-muted line-through' : 'text-ink')}>{m.title}</span>
                    {m.due_date && <span className={cn('shrink-0 text-xs', late ? 'font-semibold text-danger' : 'text-ink-muted')}>{late ? 'Overdue · ' : ''}{fmtDay(toDate(m.due_date))}</span>}
                    <button type="button" onClick={() => void run(() => execGoals.removeMilestone(m.id).then((r) => ({ error: r.error })))} aria-label="Delete milestone"
                      className="shrink-0 text-ink-subtle hover:text-danger"><X className="size-4" /></button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px_auto]">
            <Input value={msTitle} onChange={(e) => setMsTitle(e.target.value)} placeholder="New milestone" aria-label="Milestone" />
            <Input type="date" value={msDate} onChange={(e) => setMsDate(e.target.value)} aria-label="Milestone date" />
            <Button variant="secondary" onClick={() => void addMilestone()} disabled={busy}><Plus className="size-4" /> Add</Button>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <button type="button" onClick={() => void remove()} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm text-danger hover:underline"><Trash2 className="size-4" /> Delete goal</button>
          <div className="flex flex-wrap gap-2">
            {goal.status_override ? (
              <Button variant="secondary" onClick={() => void setOverride(null)} disabled={busy}><Undo2 className="size-4" /> Reopen</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => void setOverride('dropped')} disabled={busy}>Drop</Button>
                <Button variant="secondary" onClick={() => void setOverride('done')} disabled={busy}><Check className="size-4" /> Mark done</Button>
              </>
            )}
            <Button onClick={onEdit}><Pencil className="size-4" /> Edit</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value, sub, tone, small }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad'; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className={cn('mt-0.5 font-bold', small ? 'text-sm' : 'text-lg', tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-ok' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-ink-muted">{sub}</div>}
    </div>
  )
}

// ---- Create / edit ----------------------------------------------------------

type MsDraft = { key: string; title: string; due: string }

function GoalFormModal({ goal, quarter, defaultOwner, accountId, onClose, onSaved }: {
  goal: GoalWithDetail | null
  quarter: string
  defaultOwner: string | null
  accountId: string
  onClose: () => void
  onSaved: (id: string | null) => void
}) {
  const q = quarterRange(quarter)
  const [owner, setOwner] = useState(goal?.owner_name ?? defaultOwner ?? '')
  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [category, setCategory] = useState(goal?.category ?? '')
  const [kind, setKind] = useState<'metric' | 'milestones'>((goal?.kind as 'metric' | 'milestones') ?? 'metric')
  const [unit, setUnit] = useState(goal?.unit ?? '')
  const [startValue, setStartValue] = useState(goal?.start_value != null ? String(goal.start_value) : '')
  const [targetValue, setTargetValue] = useState(goal?.target_value != null ? String(goal.target_value) : '')
  const [currentValue, setCurrentValue] = useState(goal?.current_value != null ? String(goal.current_value) : '')
  const [startDate, setStartDate] = useState(goal?.start_date ?? isoDay(q.start))
  const [dueDate, setDueDate] = useState(goal?.due_date ?? isoDay(q.end))
  const [ms, setMs] = useState<MsDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!owner) { setError('Choose whose goal this is.'); return }
    if (!title.trim()) { setError('Give the goal a title.'); return }
    if (dueDate < startDate) { setError('The due date has to be on or after the start date.'); return }
    const num = (s: string) => (s.trim() === '' ? null : Number(s))
    if (kind === 'metric') {
      if (num(startValue) == null || num(targetValue) == null) { setError('Enter a starting value and a target.'); return }
      if (num(startValue) === num(targetValue)) { setError('The target has to differ from the starting value.'); return }
    }
    const newMs = ms.filter((m) => m.title.trim())
    if (!goal && kind === 'milestones' && !newMs.length) { setError('Add at least one milestone.'); return }
    setBusy(true)
    setError(null)
    const fields = {
      owner_name: owner,
      title: title.trim(),
      description: description.trim() || null,
      category: category || null,
      kind,
      unit: kind === 'metric' ? unit.trim() || null : null,
      start_value: kind === 'metric' ? num(startValue) : null,
      target_value: kind === 'metric' ? num(targetValue) : null,
      current_value: kind === 'metric' ? num(currentValue) ?? num(startValue) : null,
      start_date: startDate,
      due_date: dueDate,
    }
    let id = goal?.id ?? null
    if (goal) {
      const { error: err } = await execGoals.update(goal.id, fields)
      if (err) { setError(err.message); setBusy(false); return }
    } else {
      const { data, error: err } = await execGoals.create({ ...fields, account_id: accountId, quarter })
      if (err || !data) { setError(err?.message ?? 'Could not save the goal.'); setBusy(false); return }
      id = data.id
    }
    if (id && newMs.length) {
      const { error: err } = await execGoals.addMilestones(newMs.map((m, i) => ({ account_id: accountId, goal_id: id!, title: m.title.trim(), due_date: m.due || null, sort: i })))
      if (err) { setError(err.message); setBusy(false); return }
    }
    setBusy(false)
    onSaved(id)
  }

  return (
    <Modal open onClose={onClose} title={goal ? 'Edit goal' : `New ${q.label} goal`} size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Executive" required>
            {(id) => (
              <Select id={id} value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Select…</option>
                {GOAL_EXECS.map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Category">
            {(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">None</option>
                {GOAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Goal" required>
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Grow memberships company-wide" />}
        </Field>
        <Field label="Why it matters" hint="Optional context or how it will be measured">
          {(id) => (
            <textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink" />
          )}
        </Field>

        <div>
          <span className="text-sm font-medium text-ink">How it’s measured</span>
          <div className="mt-1.5 inline-flex rounded-lg border border-border p-0.5">
            {([['metric', 'A number target'], ['milestones', 'Milestones']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium', kind === k ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {kind === 'metric' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Unit" hint="$, %, cars, members…">
              {(id) => <Input id={id} value={unit} onChange={(e) => setUnit(e.target.value)} list="goal-units" />}
            </Field>
            <Field label="Starting value" required>
              {(id) => <Input id={id} type="number" inputMode="decimal" value={startValue} onChange={(e) => setStartValue(e.target.value)} />}
            </Field>
            <Field label="Target" required>
              {(id) => <Input id={id} type="number" inputMode="decimal" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />}
            </Field>
            <Field label="Current value" hint="Defaults to the start">
              {(id) => <Input id={id} type="number" inputMode="decimal" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />}
            </Field>
            <datalist id="goal-units">{['$', '%', 'cars', 'members', 'sites', 'people', 'hours'].map((u) => <option key={u} value={u} />)}</datalist>
          </div>
        ) : !goal ? (
          <div>
            <span className="text-sm font-medium text-ink">Milestones</span>
            <div className="mt-1.5 flex flex-col gap-2">
              {ms.map((m) => (
                <div key={m.key} className="grid grid-cols-[1fr_150px_auto] gap-2">
                  <Input value={m.title} onChange={(e) => setMs((p) => p.map((x) => (x.key === m.key ? { ...x, title: e.target.value } : x)))} placeholder="Milestone" />
                  <Input type="date" value={m.due} onChange={(e) => setMs((p) => p.map((x) => (x.key === m.key ? { ...x, due: e.target.value } : x)))} />
                  <button type="button" onClick={() => setMs((p) => p.filter((x) => x.key !== m.key))} aria-label="Remove"
                    className="grid size-10 place-items-center rounded-md border border-border text-ink-subtle hover:text-danger"><X className="size-4" /></button>
                </div>
              ))}
              <Button variant="secondary" className="self-start" onClick={() => setMs((p) => [...p, { key: crypto.randomUUID(), title: '', due: '' }])}>
                <Plus className="size-4" /> Add milestone
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">Add, check off or remove milestones from the goal itself.</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            {(id) => <Input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
          </Field>
          <Field label="Due">
            {(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
        </div>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {goal ? 'Save' : 'Add goal'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
