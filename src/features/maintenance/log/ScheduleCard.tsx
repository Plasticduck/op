import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardList, SkipForward, User } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ml, type ScheduleRow } from '@/lib/queries/maintenanceLog'
import { cn } from '@/lib/utils'
import { useMi } from '../inventory/context'
import { errText, qty } from '../inventory/format'
import { logChanged, useLog } from './context'
import { dueText, everyText, STATUS } from './labels'

const BASE = '/app/maintenance-log'
const INV = '/app/maintenance-inventory'

// One scheduled task: when it's due, whether the site has its parts, and the buttons to
// do it, hand it to a work order, or skip it.
export function ScheduleCard({ s, showSite = true }: { s: ScheduleRow; showSite?: boolean }) {
  const { me, notify } = useMi()
  const { openLog } = useLog()
  const [busy, setBusy] = useState(false)
  const short = s.parts.filter((p) => Number(p.available) < Number(p.qty))

  const openWo = async () => {
    setBusy(true)
    try {
      const r = await ml.scheduleWorkOrder(s.id)
      notify(r.already_open ? `Work order #${r.number} is already open.` : `Work order #${r.number} opened.`)
      logChanged()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={cn('flex flex-col gap-2 rounded-lg border bg-card p-3',
      s.status === 'overdue' ? 'border-danger/50' : s.status === 'due' ? 'border-warn/50' : 'border-border')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`${BASE}/schedules/${s.id}`} className="font-medium text-ink hover:text-accent hover:underline">{s.title}</Link>
          <p className="truncate text-sm text-ink-muted">{[showSite ? s.site_name : null, s.asset_name].filter(Boolean).join(' · ') || 'Whole site'}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {s.is_sample && <Badge>Sample</Badge>}
          <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
        </div>
      </div>
      <p className={cn('text-sm', s.status === 'overdue' ? 'text-danger' : s.status === 'due' ? 'text-warn' : 'text-ink')}>{dueText(s)}</p>
      <p className="text-xs text-ink-muted">
        {everyText(s)}{s.last_done_at ? `. Last done ${new Date(s.last_done_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '. Not done yet'}
      </p>
      {s.parts.length > 0 && (
        <p className={cn('text-xs', short.length ? 'text-danger' : 'text-ok')}>
          {short.length
            ? `Short at this site: ${short.map((p) => `${p.part_name} (need ${qty(p.qty)}, ${qty(p.available)} free)`).join(', ')}`
            : `Parts ready: ${s.parts.map((p) => `${p.part_name} x${qty(p.qty)}`).join(', ')}`}
        </p>
      )}
      {s.assigned_name && <p className="flex items-center gap-1 text-xs text-ink-muted"><User className="size-3.5" /> {s.assigned_name}</p>}
      {s.status !== 'paused' && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" onClick={() => openLog({ schedule: s })}><CheckCircle2 className="size-4" /> Mark done</Button>
          {s.open_work_order ? (
            <Link to={`${INV}/work-orders/${s.open_work_order.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-sm text-ink hover:bg-content">
              <ClipboardList className="size-4" /> WO #{s.open_work_order.number}
            </Link>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void openWo()} disabled={busy}><ClipboardList className="size-4" /> Work order</Button>
          )}
          {me.rank >= 2 && <Button size="sm" variant="ghost" onClick={() => openLog({ schedule: s, skip: true })}><SkipForward className="size-4" /> Skip</Button>}
        </div>
      )}
    </article>
  )
}
