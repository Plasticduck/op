import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { BarChart, Donut, StatTile, TwoLineChart } from '@/components/data/Charts'
import {
  reporting,
  statusCounts,
  workTypeCounts,
  repeatingCounts,
  bucketByWeek,
  bucketCompletedByWeek,
  type DateRange,
} from '@/lib/queries/reporting'

type Wo = {
  id: string
  status: string
  priority: string
  work_type: string
  recurrence: string
  created_at: string
  completed_at: string | null
}

export function WorkOrdersTab({ range }: { range: DateRange }) {
  const [rows, setRows] = useState<Wo[]>([])
  const [completed, setCompleted] = useState<Array<{ created_at: string; completed_at: string | null; work_type: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void Promise.all([
      reporting.workOrdersInRange(range),
      reporting.workOrdersCompletedInRange(range),
    ]).then(([{ data: wos }, { data: doneWos }]) => {
      if (!alive) return
      setRows((wos as Wo[] | null) ?? [])
      setCompleted((doneWos as typeof completed | null) ?? [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [range])

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-ink-muted" /></div>
  }

  const status = statusCounts(rows)
  const types = workTypeCounts(rows)
  const repeating = repeatingCounts(rows)
  const created = bucketByWeek(rows, range.from, range.to)
  const doneBuckets = bucketCompletedByWeek(completed, range.from, range.to)
  const merged = created.map((b, i) => ({
    weekStart: b.weekStart,
    created: b.count,
    completed: doneBuckets[i]?.count ?? 0,
  }))

  const totalCreated = rows.length
  const totalCompleted = completed.length
  const completionPct = totalCreated > 0 ? Math.round((totalCompleted / totalCreated) * 1000) / 10 : 0
  const preventive = types['preventive'] ?? 0
  const reactive = types['reactive'] ?? 0
  const inspection = types['inspection'] ?? 0
  const project = types['project'] ?? 0
  const other = types['other'] ?? 0
  const preventiveRatio = totalCreated > 0 ? Math.round((preventive / totalCreated) * 1000) / 10 : 0
  const repeatingRatio = totalCreated > 0 ? Math.round((repeating.repeating / totalCreated) * 1000) / 10 : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Created vs Completed */}
      <Card title="Created vs. Completed">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <BigNum value={totalCreated} label="Created" tone="accent" />
          <BigNum value={totalCompleted} label="Completed" tone="ok" />
          <BigNum value={completionPct + '%'} label="Percent Completed" />
        </div>
        <TwoLineChart buckets={merged} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Work Orders by Type */}
        <Card title="Work Orders by Type">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <BigNum value={preventive} label="Preventive" tone="ok" />
            <BigNum value={reactive} label="Reactive" tone="warn" />
            <BigNum value={inspection + project + other} label="Other" />
          </div>
          <div className="text-right text-xs text-ink-muted">
            <span className="font-semibold text-ink">{preventiveRatio}%</span> Total Preventive Ratio
          </div>
          <div className="mt-2">
            <BarChart
              data={[
                { label: 'Preventive', value: preventive },
                { label: 'Reactive', value: reactive },
                { label: 'Inspection', value: inspection },
                { label: 'Project', value: project },
                { label: 'Other', value: other },
              ]}
            />
          </div>
        </Card>

        {/* Status */}
        <Card title="Status">
          <div className="mb-3 grid grid-cols-5 gap-1.5">
            <BigNum value={status.open} label="Open" tone="accent" size="sm" />
            <BigNum value={status.on_hold} label="On Hold" tone="warn" size="sm" />
            <BigNum value={status.in_progress} label="In Progress" tone="accent" size="sm" />
            <BigNum value={status.done} label="Done" tone="ok" size="sm" />
            <BigNum value={status.skipped} label="Skipped" tone="danger" size="sm" />
          </div>
          <div className="flex justify-center">
            <Donut
              segments={[
                { label: 'Open', value: status.open, color: '#2563eb' },
                { label: 'On Hold', value: status.on_hold, color: '#eab308' },
                { label: 'In Progress', value: status.in_progress, color: '#0ea5e9' },
                { label: 'Done', value: status.done, color: '#22c55e' },
                { label: 'Skipped', value: status.skipped, color: '#ef4444' },
              ]}
              label={String(totalCreated)}
              sublabel="Work Orders"
            />
          </div>
        </Card>
      </div>

      {/* Non-Repeating vs. Repeating */}
      <Card title="Non-Repeating vs. Repeating">
        <div className="grid grid-cols-3 gap-3">
          <BigNum value={repeating.nonRepeating} label="Non-Repeating" tone="accent" />
          <BigNum value={repeating.repeating} label="Repeating" tone="accent" />
          <BigNum value={repeatingRatio + '%'} label="Repeating Ratio" />
        </div>
      </Card>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <button type="button" className="mb-3 text-sm font-semibold text-accent">{title} ›</button>
      {children}
    </section>
  )
}

type BigNumProps = { value: React.ReactNode; label: string; tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'neutral'; size?: 'sm' | 'md' }
function BigNum({ value, label, tone, size = 'md' }: BigNumProps) {
  return <StatTile value={size === 'sm' ? <span className="text-xl">{value}</span> : value} label={label} tone={tone} />
}
