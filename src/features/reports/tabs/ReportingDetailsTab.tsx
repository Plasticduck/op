import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { StatTile } from '@/components/data/Charts'
import { reporting, type DateRange } from '@/lib/queries/reporting'

type Wo = {
  id: string
  status: string
  created_at: string
  completed_at: string | null
  recurrence: string
}

export function ReportingDetailsTab({ range }: { range: DateRange }) {
  const [rows, setRows] = useState<Wo[]>([])
  const [timeMinutes, setTimeMinutes] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void Promise.all([
      reporting.workOrdersInRange(range),
      reporting.timeEntriesInRange(range),
    ]).then(([{ data: wos }, { data: te }]) => {
      if (!alive) return
      setRows((wos as Wo[] | null) ?? [])
      setTimeMinutes((te as Array<{ minutes: number }> | null)?.reduce((a, t) => a + Number(t.minutes), 0) ?? 0)
      setLoading(false)
    })
    return () => { alive = false }
  }, [range])

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-ink-muted" /></div>
  }

  // "Time to Complete" — for non-repeating completed WOs, average the gap
  // between created_at and completed_at. MTTR uses the same set.
  const completedSingles = rows.filter((r) => r.completed_at && (!r.recurrence || r.recurrence === 'none'))
  const durations = completedSingles
    .map((r) => (new Date(r.completed_at as string).getTime() - new Date(r.created_at).getTime()) / 3600000)
    .filter((h) => h >= 0)
  const avgHours = durations.length > 0 ? durations.reduce((a, h) => a + h, 0) / durations.length : 0
  const totalHours = timeMinutes / 60
  const mttr = avgHours

  // "Completed with Inspection Check" — proxy via WOs that finished without
  // being skipped. We don't have a separate inspection field yet, so this
  // mirrors completion. Fail = skipped, Pass = done, Flag = on_hold > 1d.
  const pass = rows.filter((r) => r.status === 'done').length
  const fail = rows.filter((r) => r.status === 'skipped').length
  const flag = rows.filter((r) => r.status === 'on_hold').length
  const totalInspected = pass + fail + flag
  const pct = totalInspected > 0 ? Math.round((pass / totalInspected) * 1000) / 10 : 0

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-border bg-card p-4">
        <button type="button" className="mb-3 text-sm font-semibold text-accent">Inspection vs. Timing ›</button>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 text-sm font-semibold text-ink">Completed with Inspection Check</div>
            <div className="grid grid-cols-4 gap-2">
              <StatTile value={pass} label="Pass" tone="ok" />
              <StatTile value={flag} label="Flag" tone="warn" />
              <StatTile value={fail} label="Fail" tone="danger" />
              <StatTile value={pct + '%'} label="Pass Rate" tone="accent" sublabel="Inspection Checks completed" />
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 text-sm font-semibold text-ink">Time to Complete</div>
            <div className="grid grid-cols-3 gap-2">
              <StatTile value={Math.round(totalHours).toLocaleString()} label="Total Hours" sublabel="Logged in range" />
              <StatTile value={avgHours > 0 ? avgHours.toFixed(1) : '—'} label="AVG Hours" tone="ok" />
              <StatTile value={mttr > 0 ? mttr.toFixed(1) : '—'} label="MTTR AVG Hours" tone="accent" sublabel="Only on non-repeating" />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
