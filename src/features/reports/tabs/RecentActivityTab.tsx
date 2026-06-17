import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { reporting, type DateRange } from '@/lib/queries/reporting'
import { cn } from '@/lib/utils'

type Activity = {
  id: string
  body: string
  kind: 'comment' | 'system'
  user_name: string
  created_at: string
  work_order: { id: string; number: number; title: string } | null
}

export function RecentActivityTab({ range }: { range: DateRange }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [showComments, setShowComments] = useState(true)
  const [showSystem, setShowSystem] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void reporting.recentActivity(range, 200).then(({ data }) => {
      if (!alive) return
      setRows((data as unknown as Activity[]) ?? [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [range])

  const visible = rows.filter((r) => (r.kind === 'comment' ? showComments : showSystem))

  // Group by work order id so each WO collapses its events together.
  const groups: Array<{ wo: Activity['work_order']; items: Activity[] }> = []
  for (const r of visible) {
    const last = groups[groups.length - 1]
    if (last && last.wo?.id === r.work_order?.id) last.items.push(r)
    else groups.push({ wo: r.work_order, items: [r] })
  }

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-ink-muted" /></div>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-4 text-sm">
        <Toggle on={showComments} onChange={setShowComments} label="Show Comments" />
        <Toggle on={showSystem} onChange={setShowSystem} label="Show All Updates" />
      </div>

      {groups.length === 0 ? (
        <p className="rounded-md border border-border bg-card px-3 py-4 text-sm text-ink-muted">
          No activity in the selected range.
        </p>
      ) : (
        groups.map((g, gi) => (
          <section key={gi} className="rounded-md border border-border bg-card p-3">
            {g.wo && (
              <button
                type="button"
                onClick={() => navigate(`/app/work-orders/${g.wo!.id}`)}
                className="mb-2 block text-left text-sm font-medium text-ink hover:text-accent"
              >
                In Work Order <span className="text-accent">#{g.wo.number}</span> - {g.wo.title}
              </button>
            )}
            <div className="flex flex-col gap-2">
              {g.items.map((it) => (
                <div key={it.id} className={cn(
                  'flex items-start gap-2.5 rounded-md px-2 py-1.5',
                  it.kind === 'system' ? 'bg-ok-soft/40' : 'bg-content/40',
                )}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
                    {it.user_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px]">
                      <span className="font-semibold text-ink">{it.user_name}</span>
                      <span className="ml-2 text-ink-subtle">{format(new Date(it.created_at), 'M/d/yyyy, h:mm a')}</span>
                    </div>
                    <p className={cn('text-sm', it.kind === 'system' ? 'italic text-ok' : 'text-ink')}>{it.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-ink-muted">
      <span
        onClick={() => onChange(!on)}
        className={cn('inline-block h-5 w-9 shrink-0 rounded-full p-0.5 transition', on ? 'bg-accent' : 'bg-border')}
      >
        <span className={cn('block size-4 rounded-full bg-white transition', on ? 'translate-x-4' : '')} />
      </span>
      <span>{label}</span>
    </label>
  )
}
