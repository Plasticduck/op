import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { ml, type EveryUnit, type ScheduleInput, type TaskType } from '@/lib/queries/maintenanceLog'
import { cn } from '@/lib/utils'
import { useMi } from '../inventory/context'
import { errText } from '../inventory/format'
import { Chips, ErrorNote } from '../inventory/ui'
import type { AssetRef, ScheduleFormInit } from './context'
import { addInterval, isoDay, TASK_TYPE } from './labels'
import { AssetPicker, PartSearch, Textarea } from './pickers'

const TASKS = Object.keys(TASK_TYPE) as TaskType[]

// Set up or change a schedule. A new one can go to several sites at once: each gets its
// own copy, on its own machine of the same type.
export default function ScheduleForm({ init, onClose, onSaved }: { init: ScheduleFormInit; onClose: () => void; onSaved: () => void }) {
  const { refs, notify } = useMi()
  const ex = init.existing ?? null
  const today = isoDay()
  const [title, setTitle] = useState(ex?.title ?? (init.part ? `Replace ${init.part.name}` : ''))
  const [task, setTask] = useState<TaskType>(ex?.task_type ?? (init.part ? 'replace' : 'inspect'))
  const [sites, setSites] = useState<string[]>(() => {
    if (ex) return [ex.site_id]
    const first = init.asset?.site_id ?? init.site_id ?? refs.sites[0]?.id
    return first ? [first] : []
  })
  const [asset, setAsset] = useState<AssetRef | null>(() => (ex?.asset_id ? { id: ex.asset_id, name: ex.asset_name ?? 'Machine', site_id: ex.site_id } : init.asset ?? null))
  const [byTime, setByTime] = useState(ex ? !!ex.every_n : true)
  const [n, setN] = useState(String(ex?.every_n ?? 1))
  const [unit, setUnit] = useState<EveryUnit>(ex?.every_unit ?? 'months')
  const [byCars, setByCars] = useState(!!ex?.every_cars)
  const [cars, setCars] = useState(ex?.every_cars ? String(ex.every_cars) : '')
  const [lastDone, setLastDone] = useState('')
  const [nextDue, setNextDue] = useState<string | null>(ex?.next_due_date ?? null)
  const [startDate, setStartDate] = useState(today)
  const [soon, setSoon] = useState(String(ex?.soon_days ?? 7))
  const [parts, setParts] = useState<Array<{ part_id: string; part_name: string; qty: string }>>(() =>
    ex ? ex.parts.map((p) => ({ part_id: p.part_id, part_name: p.part_name, qty: String(Number(p.qty)) })) : init.part ? [{ part_id: init.part.id, part_name: init.part.name, qty: '1' }] : [])
  const [assignee, setAssignee] = useState(ex?.assigned_user_id ?? '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(ex?.priority ?? 'medium')
  const [instructions, setInstructions] = useState(ex?.instructions ?? '')
  const [autoWo, setAutoWo] = useState(ex?.auto_work_order ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Until someone picks a date, the first due date follows the interval and last done.
  const suggestedDue = useMemo(() => {
    const k = Number(n)
    if (!byTime || !k || k <= 0) return null
    return addInterval(lastDone || (ex?.last_done_at ? isoDay(new Date(ex.last_done_at)) : today), k, unit)
  }, [byTime, n, unit, lastDone, today, ex])
  const dueValue = nextDue ?? suggestedDue ?? ''
  const pickerSite = asset?.site_id ?? sites[0] ?? ''

  const toggleSite = (id: string) => {
    const next = sites.includes(id) ? sites.filter((x) => x !== id) : [...sites, id]
    setSites(next)
    if (asset && !next.includes(asset.site_id)) setAsset(null)
  }

  const save = async () => {
    setError(null)
    if (!title.trim()) { setError('Give it a name.'); return }
    if (!ex && sites.length === 0) { setError('Pick at least one site.'); return }
    if (!byTime && !byCars) { setError('Set how often: by the calendar, by cars washed, or both.'); return }
    if (byTime && !(Number(n) > 0)) { setError('Enter how many days, weeks or months.'); return }
    if (byCars && !(Number(cars) > 0)) { setError('Enter how many cars.'); return }
    setBusy(true)
    try {
      const input: ScheduleInput = {
        ...(ex ? { id: ex.id } : { site_ids: sites }),
        title: title.trim(),
        task_type: task,
        priority,
        instructions,
        asset_id: asset?.id ?? null,
        every_n: byTime ? Number(n) : null,
        every_unit: byTime ? unit : null,
        every_cars: byCars ? Math.round(Number(cars)) : null,
        soon_days: Math.max(0, Math.min(90, Number(soon) || 0)),
        next_due_date: byTime ? dueValue || null : null,
        start_date: byCars && !lastDone ? startDate : null,
        last_done_on: lastDone || null,
        assigned_user_id: assignee || null,
        auto_work_order: autoWo,
        parts: parts.filter((p) => Number(p.qty) > 0).map((p) => ({ part_id: p.part_id, qty: Number(p.qty) })),
      }
      const r = await ml.saveSchedule(input)
      const bits = [ex ? 'Schedule saved.' : r.created > 1 ? `Schedule set up at ${r.created} sites.` : 'Schedule set up.']
      if (r.missing_assets) bits.push(`${r.missing_assets} site${r.missing_assets === 1 ? ' has' : 's have'} no machine of that type, so ${r.missing_assets === 1 ? 'its schedule covers' : 'theirs cover'} the whole site.`)
      notify(bits.join(' '), r.missing_assets ? 'warn' : 'ok')
      onSaved()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const allSelected = sites.length === refs.sites.length

  return (
    <Modal open onClose={onClose} title={ex ? 'Edit schedule' : 'New maintenance schedule'} size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Grease the conveyor bearings" />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Kind of task</span>
          <Chips value={task} onChange={setTask} options={TASKS.map((t) => ({ value: t, label: TASK_TYPE[t] }))} />
        </div>

        {ex ? (
          <p className="text-sm text-ink-muted">Site: <span className="text-ink">{ex.site_name}</span></p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Sites <span className="font-normal text-ink-muted">({sites.length} picked)</span></span>
              {refs.sites.length > 1 && (
                <button type="button" className="text-sm text-accent hover:underline" onClick={() => { setSites(allSelected ? [] : refs.sites.map((s) => s.id)); if (allSelected) setAsset(null) }}>
                  {allSelected ? 'Clear' : 'All my sites'}
                </button>
              )}
            </div>
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-3">
              {refs.sites.map((s) => (
                <label key={s.id} className={cn('flex min-h-9 items-center gap-2 rounded-md px-2 text-sm', sites.includes(s.id) ? 'bg-accent-soft text-accent' : 'text-ink')}>
                  <input type="checkbox" checked={sites.includes(s.id)} onChange={() => toggleSite(s.id)} className="size-4" />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Machine <span className="font-normal text-ink-muted">(optional)</span></span>
          {pickerSite ? <AssetPicker siteId={pickerSite} value={asset} onChange={setAsset} /> : <p className="text-sm text-ink-muted">Pick a site first.</p>}
          {!ex && asset && sites.length > 1 && <p className="text-xs text-ink-muted">At the other sites it goes on their own machine of the same type.</p>}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <span className="text-sm font-medium text-ink">How often</span>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={byTime} onChange={(e) => setByTime(e.target.checked)} className="size-4" /> By the calendar
          </label>
          {byTime && (
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <span className="text-sm text-ink-muted">Every</span>
              <div className="w-20">
                <Input aria-label="How many" inputMode="numeric" value={n} onChange={(e) => { setN(e.target.value.replace(/[^0-9]/g, '')); setNextDue(null) }} className="text-center" />
              </div>
              <div className="w-32">
                <Select aria-label="Days, weeks or months" value={unit} onChange={(e) => { setUnit(e.target.value as EveryUnit); setNextDue(null) }}>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </Select>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={byCars} onChange={(e) => setByCars(e.target.checked)} className="size-4" /> By cars washed at the site
          </label>
          {byCars && (
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <span className="text-sm text-ink-muted">Every</span>
              <div className="w-32">
                <Input aria-label="How many cars" inputMode="numeric" value={cars} onChange={(e) => setCars(e.target.value.replace(/[^0-9]/g, ''))} placeholder="75000" className="text-center" />
              </div>
              <span className="text-sm text-ink-muted">cars</span>
            </div>
          )}
          {byTime && byCars && <p className="text-xs text-ink-muted">Whichever comes first.</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Last done on (if you know)" hint="Counting starts from here.">
            {(id) => <Input id={id} type="date" value={lastDone} max={today} onChange={(e) => { setLastDone(e.target.value); setNextDue(null) }} />}
          </Field>
          {byTime && (
            <Field label="Next due">
              {(id) => <Input id={id} type="date" value={dueValue} onChange={(e) => setNextDue(e.target.value)} />}
            </Field>
          )}
          {byCars && !lastDone && !ex && (
            <Field label="Count cars from">
              {(id) => <Input id={id} type="date" value={startDate} max={today} onChange={(e) => setStartDate(e.target.value)} />}
            </Field>
          )}
          <Field label="Warn this many days ahead">
            {(id) => <Input id={id} inputMode="numeric" value={soon} onChange={(e) => setSoon(e.target.value.replace(/[^0-9]/g, ''))} />}
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Parts it uses each time</span>
          {parts.length === 0 && <p className="text-xs text-ink-muted">Listing them pre-fills Mark done, checks the site has them, and feeds the parts forecast.</p>}
          {parts.map((p) => (
            <div key={p.part_id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.part_name}</span>
              <div className="w-20 shrink-0">
                <Input aria-label={`How many ${p.part_name}`} inputMode="decimal" value={p.qty} onFocus={(e) => e.target.select()}
                  onChange={(e) => setParts((ps) => ps.map((x) => (x.part_id === p.part_id ? { ...x, qty: e.target.value } : x)))} className="text-center" />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${p.part_name}`} onClick={() => setParts((ps) => ps.filter((x) => x.part_id !== p.part_id))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <PartSearch onPick={(p) => setParts((ps) => [...ps, { part_id: p.id, part_name: p.name, qty: '1' }])} exclude={parts.map((p) => p.part_id)} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Assigned to">
            {(id) => (
              <Select id={id} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Nobody in particular</option>
                {refs.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Instructions">
          {(id) => <Textarea id={id} value={instructions} onChange={setInstructions} rows={3} placeholder="Steps, settings, torque values, where the grease points are" />}
        </Field>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={autoWo} onChange={(e) => setAutoWo(e.target.checked)} className="mt-0.5 size-4" />
          <span>Open a work order by itself when it's coming up<span className="block text-xs text-ink-muted">Its parts go on as suggestions. Closing the work order logs the job here.</span></span>
        </label>

        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="sticky bottom-0 -mx-5 -mb-4 flex justify-end gap-2 border-t border-border bg-card px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving...' : ex ? 'Save' : sites.length > 1 ? `Set up at ${sites.length} sites` : 'Set it up'}</Button>
        </div>
      </div>
    </Modal>
  )
}
