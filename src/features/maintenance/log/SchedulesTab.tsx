import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { ml, type ScheduleDetail, type ScheduleRow } from '@/lib/queries/maintenanceLog'
import { useMi } from '../inventory/context'
import { day, dayTime, errText, qty } from '../inventory/format'
import { Card, Chips, ErrorNote, Loading, Muted, SearchBox, useDebounced } from '../inventory/ui'
import { LOG_CHANGED, logChanged, useLog } from './context'
import { dueText, everyText, RESULT, STATUS, TASK_TYPE } from './labels'
import { ScheduleCard } from './ScheduleCard'

const BASE = '/app/maintenance-log'
const INV = '/app/maintenance-inventory'

export default function SchedulesTab() {
  const { id } = useParams()
  return id ? <SchedulePage id={id} /> : <ScheduleList />
}

type Filter = 'all' | 'attention' | 'paused'

function ScheduleList() {
  const { refs, me } = useMi()
  const { openSchedule } = useLog()
  const [site, setSite] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [rows, setRows] = useState<ScheduleRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await ml.schedules({ site: site || null, status: filter === 'all' ? null : filter, q: dq }))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [site, filter, dq])
  useEffect(() => {
    void load()
    window.addEventListener(LOG_CHANGED, load)
    return () => window.removeEventListener(LOG_CHANGED, load)
  }, [load])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => setSite(e.target.value)} className="w-full sm:w-44" aria-label="Site">
          <option value="">All my sites</option>
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <SearchBox value={q} onChange={setQ} placeholder="Search schedules or machines" className="min-w-[200px] flex-1" />
        {me.rank >= 2 && <Button onClick={() => openSchedule({ site_id: site || null })}><CalendarPlus className="size-4" /> New schedule</Button>}
      </div>
      <Chips value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'attention', label: 'Needs attention' }, { value: 'paused', label: 'Paused' }]} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && (
        <Muted>
          {filter === 'all' && !dq ? `No schedules yet. A schedule says how often something needs doing, by the calendar or by cars washed, and which parts it takes.${me.rank >= 2 ? ' Start one with New schedule.' : ''}` : 'None match.'}
        </Muted>
      )}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((s) => (
            <li key={s.id}>
              <Link to={`${BASE}/schedules/${s.id}`} className="flex min-h-14 items-start gap-3 px-3 py-2.5 hover:bg-content">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-ink">{s.title}</span>
                    {s.is_sample && <Badge>Sample</Badge>}
                  </div>
                  <p className="truncate text-xs text-ink-muted">{[site ? null : s.site_name, s.asset_name, everyText(s)].filter(Boolean).join(' · ')}</p>
                  <p className="text-xs text-ink">{dueText(s)}</p>
                </div>
                <Badge tone={STATUS[s.status].tone} className="shrink-0">{STATUS[s.status].label}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SchedulePage({ id }: { id: string }) {
  const { notify } = useMi()
  const { openSchedule } = useLog()
  const navigate = useNavigate()
  const [d, setD] = useState<ScheduleDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const load = useCallback(async () => {
    try {
      setD(await ml.schedule(id))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [id])
  useEffect(() => {
    void load()
    window.addEventListener(LOG_CHANGED, load)
    return () => window.removeEventListener(LOG_CHANGED, load)
  }, [load])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  const s = d.schedule

  const togglePause = async () => {
    try {
      await ml.saveSchedule({
        id: s.id, title: s.title, task_type: s.task_type, priority: s.priority, instructions: s.instructions ?? '', asset_id: s.asset_id,
        every_n: s.every_n, every_unit: s.every_unit, every_cars: s.every_cars, soon_days: s.soon_days, assigned_user_id: s.assigned_user_id,
        auto_work_order: s.auto_work_order, next_due_date: s.next_due_date, active: !s.active,
      })
      notify(s.active ? 'Paused. It won\'t come due until it\'s resumed.' : 'Resumed.')
      logChanged()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  const remove = async () => {
    try {
      await ml.archiveSchedule(s.id)
      notify('Schedule removed. Its history stays in the log.')
      logChanged()
      navigate(`${BASE}/schedules`)
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to={`${BASE}/schedules`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Schedules</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">{s.title}</h1>
          <p className="text-sm text-ink-muted">
            {s.site_name}
            {s.asset_id && <> · <Link to={`${INV}/equipment/${s.asset_id}`} className="text-accent hover:underline">{s.asset_name}</Link></>}
            {' · '}{TASK_TYPE[s.task_type]}{s.priority !== 'medium' ? `, ${s.priority} priority` : ''}
          </p>
        </div>
        {d.can_manage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => openSchedule({ existing: s })}><Pencil className="size-4" /> Edit</Button>
            <Button variant="ghost" onClick={() => void togglePause()}>{s.active ? <><Pause className="size-4" /> Pause</> : <><Play className="size-4" /> Resume</>}</Button>
            <Button variant="ghost" onClick={() => setRemoving(true)} aria-label="Remove schedule"><Trash2 className="size-4" /></Button>
          </div>
        )}
      </div>

      <ScheduleCard s={s} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="How it runs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-muted">How often</dt><dd className="text-ink">{everyText(s)}</dd>
            {s.next_due_date && <><dt className="text-ink-muted">Next by date</dt><dd className="text-ink">{day(s.next_due_date)}</dd></>}
            {s.every_cars && (
              <>
                <dt className="text-ink-muted">Cars so far</dt>
                <dd className="text-ink">{Math.round(Number(s.cars_since ?? 0)).toLocaleString('en-US')} of {s.every_cars.toLocaleString('en-US')}{s.cars_pct != null ? ` (${s.cars_pct}%)` : ''}</dd>
                <dt className="text-ink-muted">Site's cars a day</dt><dd className="text-ink">{s.daily_cars ? Math.round(Number(s.daily_cars)).toLocaleString('en-US') : 'No counts yet'}</dd>
              </>
            )}
            <dt className="text-ink-muted">Warns</dt><dd className="text-ink">{s.soon_days} day{s.soon_days === 1 ? '' : 's'} ahead</dd>
            <dt className="text-ink-muted">Work order</dt><dd className="text-ink">{s.auto_work_order ? 'Opens one by itself when it\'s coming up' : 'Only when someone opens one'}</dd>
            <dt className="text-ink-muted">Assigned to</dt><dd className="text-ink">{s.assigned_name ?? 'Nobody in particular'}</dd>
            <dt className="text-ink-muted">Last done</dt><dd className="text-ink">{s.last_done_at ? dayTime(s.last_done_at) : 'Not yet'}</dd>
          </dl>
          {s.instructions && <p className="mt-3 whitespace-pre-wrap border-t border-border pt-3 text-sm text-ink">{s.instructions}</p>}
        </Card>
        <Card title="Parts each time">
          {s.parts.length === 0 ? <Muted>None listed.</Muted> : s.parts.map((p) => (
            <div key={p.part_id} className="flex items-baseline justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <Link to={`${INV}/parts/${p.part_id}`} className="min-w-0 truncate text-accent hover:underline">{p.part_name}</Link>
              <span className="shrink-0 tabular-nums text-ink-muted">x{qty(p.qty)}, <span className={Number(p.available) < Number(p.qty) ? 'text-danger' : ''}>{qty(p.available)} free at the site</span></span>
            </div>
          ))}
        </Card>
      </div>

      <Card title={`History (${d.history.length})`}>
        {d.history.length === 0 ? <Muted>Not done yet.</Muted> : (
          <ul className="flex flex-col divide-y divide-border">
            {d.history.map((h) => (
              <li key={h.id}>
                <Link to={`${BASE}/entries/${h.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm hover:bg-content">
                  <span className={h.voided ? 'text-ink-muted line-through' : 'text-ink'}>
                    {dayTime(h.performed_at)}{h.who ? `, ${h.who}` : ''}{h.work_order_number ? `, WO #${h.work_order_number}` : ''}
                  </span>
                  <span className="flex gap-1">
                    {h.result !== 'ok' && <Badge tone={RESULT[h.result].tone}>{RESULT[h.result].label}</Badge>}
                    {h.on_time === false && <Badge tone="warn">Late</Badge>}
                    {h.on_time === true && <Badge tone="ok">On time</Badge>}
                  </span>
                  {h.notes && <p className="w-full truncate text-xs text-ink-muted">{h.notes}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {removing && (
        <Modal open onClose={() => setRemoving(false)} title="Remove this schedule?" size="sm">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">It stops coming due. Everything already logged against it stays in the log.{s.open_work_order ? ` Work order #${s.open_work_order.number} stays open.` : ''}</p>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRemoving(false)}>Keep it</Button><Button variant="danger" onClick={() => void remove()}>Remove</Button></div>
          </div>
        </Modal>
      )}
    </div>
  )
}
