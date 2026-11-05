import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Camera, Pencil } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { mi } from '@/lib/queries/maintenanceInventory'
import { ml, type EntryDetail, type EntryResult, type EntryType } from '@/lib/queries/maintenanceLog'
import { shrinkPhoto } from '@/lib/shrinkPhoto'
import { useMi } from '../inventory/context'
import { day, dayTime, errText, money, qty } from '../inventory/format'
import { Card, ErrorNote, Loading, Muted, Thumb, WarnNote } from '../inventory/ui'
import { LOG_CHANGED, logChanged } from './context'
import { ASSET_STATUS, ENTRY_TYPE, ENTRY_TYPES, localInputValue, minutesText, RESULT } from './labels'
import { Textarea } from './pickers'

const BASE = '/app/maintenance-log'
const INV = '/app/maintenance-inventory'

export default function EntryPage() {
  const { id = '' } = useParams()
  const { accountId, notify } = useMi()
  const [d, setD] = useState<EntryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    try {
      setD(await ml.entry(id))
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
  const e = d.entry

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const paths: string[] = []
      for (const f of Array.from(files)) {
        const small = await shrinkPhoto(f, 1600).catch(() => f)
        paths.push(await mi.upload(accountId, 'log', small, f.name || 'photo.jpg'))
      }
      await ml.update(e.id, { photos: paths })
      notify(`${paths.length} photo${paths.length === 1 ? '' : 's'} added.`)
      void load()
    } catch (err) {
      notify(errText(err), 'danger')
    } finally {
      setUploading(false)
    }
  }
  const open = async (path: string) => {
    const url = await mi.fileUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const facts: Array<[string, ReactNode]> = [
    ['Site', e.site_name],
    ['Machine', e.asset_id ? <Link to={`${BASE}?asset=${e.asset_id}`} className="text-accent hover:underline">{e.asset_name}</Link> : 'None'],
    ['When', dayTime(e.performed_at)],
    ['Who', e.performed_by_name ?? '-'],
    ['Kind of work', ENTRY_TYPE[e.entry_type]],
  ]
  if (e.schedule_id) facts.push(['Schedule', <Link key="s" to={`${BASE}/schedules/${e.schedule_id}`} className="text-accent hover:underline">{e.schedule_title ?? 'Open'}</Link>])
  if (e.due_date) facts.push(['Was due', `${day(e.due_date)}${e.on_time == null ? '' : e.on_time ? ', on time' : ', late'}`])
  if (e.cars_since_last != null) facts.push(['Cars since last time', Math.round(Number(e.cars_since_last)).toLocaleString('en-US')])
  if (e.work_order) facts.push(['Work order', <Link key="w" to={`${INV}/work-orders/${e.work_order.id}`} className="text-accent hover:underline">#{e.work_order.number} ({e.work_order.status.replace(/_/g, ' ')})</Link>])
  if (e.follow_up) facts.push(['Follow-up', <Link key="f" to={`${INV}/work-orders/${e.follow_up.id}`} className="text-accent hover:underline">#{e.follow_up.number} ({e.follow_up.status.replace(/_/g, ' ')})</Link>])
  if (e.labor_minutes != null) facts.push(['Time spent', minutesText(e.labor_minutes)])
  if (e.downtime_minutes != null) facts.push(['Machine down', minutesText(e.downtime_minutes)])
  if (e.vendor_name) facts.push(['Vendor', e.vendor_name])
  if (e.outside_cost != null) facts.push(['Outside cost', money(e.outside_cost)])
  if (e.asset_status) facts.push(['Machine now', ASSET_STATUS[e.asset_status] ?? e.asset_status])

  return (
    <div className="flex flex-col gap-4">
      <Link to={BASE} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Log</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className={`text-xl font-semibold text-ink ${e.voided_at ? 'line-through' : ''}`}>{e.title}</h1>
            <Badge tone={RESULT[e.result].tone}>{RESULT[e.result].label}</Badge>
            {e.is_sample && <Badge>Sample</Badge>}
          </div>
          <p className="text-sm text-ink-muted">{[e.site_name, e.asset_name, dayTime(e.performed_at)].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {e.can_edit && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
          {e.can_void && <Button variant="ghost" onClick={() => setVoiding(true)}>Void</Button>}
        </div>
      </div>
      {e.voided_at && <WarnNote>Voided {dayTime(e.voided_at)}{e.voided_by_name ? ` by ${e.voided_by_name}` : ''}: {e.void_reason}</WarnNote>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="min-w-0 break-words text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {e.notes && <p className="mt-3 whitespace-pre-wrap border-t border-border pt-3 text-sm text-ink">{e.notes}</p>}
        </Card>

        <Card title={`Parts used${d.parts.length ? `: ${money(d.parts_cost)}` : ''}`}>
          {d.parts.length === 0 ? <Muted>No parts recorded.</Muted> : d.parts.map((p, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <div className="min-w-0">
                {p.part_id ? <Link to={`${INV}/parts/${p.part_id}`} className="text-accent hover:underline">{p.part_name}</Link> : <span className="text-ink">{p.part_name}</span>}
                <span className="text-ink-muted"> x{qty(p.qty)}{p.location_name ? `, from ${p.location_name}` : ''}</span>
              </div>
              <span className="shrink-0 tabular-nums text-ink-muted">{money(p.cost)}</span>
            </div>
          ))}
          {e.work_order && d.parts.length > 0 && <p className="mt-2 text-xs text-ink-muted">These are the parts on work order #{e.work_order.number}.</p>}
        </Card>
      </div>

      <Card title="Photos" actions={!e.voided_at ? (
        <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border px-3 text-sm text-ink hover:bg-content">
          <Camera className="size-4" /> {uploading ? 'Adding...' : 'Add'}
          <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(ev) => { void addPhotos(ev.target.files); ev.target.value = '' }} />
        </label>
      ) : undefined}>
        {d.photos.length === 0 ? <Muted>No photos.</Muted> : (
          <div className="flex flex-wrap gap-2">
            {d.photos.map((p) => (
              <button key={p.id} type="button" onClick={() => void open(p.storage_path)} aria-label={`Open ${p.file_name ?? 'photo'}`}>
                <Thumb path={p.storage_path} className="size-24" />
              </button>
            ))}
          </div>
        )}
      </Card>

      {editing && <EditEntry d={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); notify('Saved.'); logChanged() }} />}
      {voiding && <VoidEntry id={e.id} hasParts={d.parts.length > 0 && !e.work_order} onClose={() => setVoiding(false)} onDone={() => { setVoiding(false); notify('Voided.'); logChanged() }} />}
    </div>
  )
}

function EditEntry({ d, onClose, onSaved }: { d: EntryDetail; onClose: () => void; onSaved: () => void }) {
  const { refs } = useMi()
  const e = d.entry
  const [title, setTitle] = useState(e.title)
  const [etype, setEtype] = useState<EntryType>(e.entry_type)
  const [result, setResult] = useState<EntryResult>(e.result)
  const [notes, setNotes] = useState(e.notes ?? '')
  const [when, setWhen] = useState(localInputValue(new Date(e.performed_at)))
  const [labor, setLabor] = useState(e.labor_minutes?.toString() ?? '')
  const [downtime, setDowntime] = useState(e.downtime_minutes?.toString() ?? '')
  const [vendor, setVendor] = useState(e.vendor_id ?? '')
  const [outside, setOutside] = useState(e.outside_cost?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    try {
      await ml.update(e.id, {
        title, entry_type: etype, result, notes,
        ...(when !== localInputValue(new Date(e.performed_at)) ? { performed_at: new Date(when).toISOString() } : {}),
        labor_minutes: labor.trim() ? Number(labor) : null,
        downtime_minutes: downtime.trim() ? Number(downtime) : null,
        vendor_id: vendor || null,
        outside_cost: outside.trim() ? Number(outside) : null,
      })
      onSaved()
    } catch (err) {
      setError(errText(err))
    }
  }
  return (
    <Modal open onClose={onClose} title="Edit entry" size="lg">
      <div className="flex flex-col gap-3">
        <Field label="What was done">{(id) => <Input id={id} value={title} onChange={(ev) => setTitle(ev.target.value)} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kind of work">
            {(id) => <Select id={id} value={etype} onChange={(ev) => setEtype(ev.target.value as EntryType)}>{ENTRY_TYPES.map((t) => <option key={t} value={t}>{ENTRY_TYPE[t]}</option>)}</Select>}
          </Field>
          <Field label="How it went">
            {(id) => (
              <Select id={id} value={result} onChange={(ev) => setResult(ev.target.value as EntryResult)} disabled={e.result === 'skipped'}>
                {(e.result === 'skipped' ? ['skipped'] : ['ok', 'follow_up', 'failed']).map((r) => <option key={r} value={r}>{RESULT[r as EntryResult].label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="When">{(id) => <Input id={id} type="datetime-local" value={when} max={localInputValue()} onChange={(ev) => setWhen(ev.target.value)} />}</Field>
          <Field label="Time spent (minutes)">{(id) => <Input id={id} inputMode="numeric" value={labor} onChange={(ev) => setLabor(ev.target.value.replace(/[^0-9]/g, ''))} />}</Field>
          <Field label="Machine down (minutes)">{(id) => <Input id={id} inputMode="numeric" value={downtime} onChange={(ev) => setDowntime(ev.target.value.replace(/[^0-9]/g, ''))} />}</Field>
          <Field label="Vendor">
            {(id) => (
              <Select id={id} value={vendor} onChange={(ev) => setVendor(ev.target.value)}>
                <option value="">No, our team</option>
                {refs.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Outside cost ($)">{(id) => <Input id={id} inputMode="decimal" value={outside} onChange={(ev) => setOutside(ev.target.value.replace(/[^0-9.]/g, ''))} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Textarea id={id} value={notes} onChange={setNotes} rows={4} />}</Field>
        <p className="text-xs text-ink-muted">Parts used can't be changed here. If some went back on the shelf, use Return on the part's page.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  )
}

function VoidEntry({ id, hasParts, onClose, onDone }: { id: string; hasParts: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    try {
      await ml.void(id, reason)
      onDone()
    } catch (err) {
      setError(errText(err))
    }
  }
  return (
    <Modal open onClose={onClose} title="Void this entry" size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink">It stays in the history, crossed out. If it finished a scheduled task, the schedule goes back to how it was.</p>
        {hasParts && <WarnNote>The parts stay used. If they went back on the shelf, use Return on each part's page.</WarnNote>}
        <Field label="Why" required>{(fid) => <Input id={fid} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Logged on the wrong machine" />}</Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => void go()} disabled={!reason.trim()}>Void it</Button></div>
      </div>
    </Modal>
  )
}
