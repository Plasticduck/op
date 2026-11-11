import { useState } from 'react'
import { format } from 'date-fns'
import { Gauge, Loader2, RotateCcw } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { miEquipment, type EquipmentDetail } from '@/lib/queries/miEquipment'
import { day, errText } from '../format'
import { ErrorNote } from '../ui'
import { cars, shortName, usageHeadline } from './format'

// How hard this machine has worked: cars washed at its site since it went in or was last
// replaced. "Replaced" logs the job and starts the count again from that day.

export function UsageCard({ d, onChanged, compact }: { d: EquipmentDetail; onChanged: () => void; compact?: boolean }) {
  const u = d.usage
  const [resetting, setResetting] = useState(false)
  const head = usageHeadline(u)
  const counting = u && u.state === 'ok'
  const retired = d.asset.status === 'retired'
  return (
    <section className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><Gauge className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Use count</div>
          <div className="text-2xl font-semibold tabular-nums text-ink">{head.value}</div>
          <p className="text-xs text-ink-muted">
            {head.sub}
            {u?.since && u.state === 'ok' && <> {day(u.since)}.</>}
          </p>
        </div>
        {!retired && u?.state !== 'not_counted' && (
          <Button size="sm" variant="secondary" onClick={() => setResetting(true)} title="Log a replacement and start the count again">
            <RotateCcw className="size-3.5" /> Replaced
          </Button>
        )}
      </div>
      {counting && !compact && (
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2 text-center">
          <Stat label="Today" value={cars(u.cars_today)} />
          <Stat label="Last 30 days" value={cars(u.cars_30d)} />
          <Stat label="Last 12 months" value={cars(u.cars_12m)} />
        </dl>
      )}
      {counting && !compact && (
        <p className="mt-2 text-[11px] text-ink-subtle">
          Every car washed at {d.asset.site_name} (DRB less test cars, plus FlexWash), counted by day through {day(u.data_through)}.
          {u.basis === 'packages' && ' Package-only counting is coming; this counts every car for now.'}
        </p>
      )}
      {d.resets.length > 0 && !compact && (
        <div className="mt-2 border-t border-border pt-2 text-xs text-ink-muted">
          Replaced {d.resets.map((r) => day(r.on)).join(', ')}
        </div>
      )}
      {resetting && <ResetDialog d={d} onClose={() => setResetting(false)} onDone={() => { setResetting(false); onChanged() }} />}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-subtle">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  )
}

function ResetDialog({ d, onClose, onDone }: { d: EquipmentDetail; onClose: () => void; onDone: () => void }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [on, setOn] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await miEquipment.resetUsage(d.asset.id, on === today ? null : on, note)
      onDone()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`Replaced ${shortName(d.asset.name)}?`} size="sm"
      description="Logs the replacement in the Maintenance Log and starts the use count again from that day. Voiding the log entry puts the old count back.">
      <div className="flex flex-col gap-3">
        <Field label="Replaced on">{(id) => <Input id={id} type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} />}</Field>
        <Field label="Note (optional)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="New cloth bundle" />}</Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !on} onClick={() => void run()}>{busy && <Loader2 className="size-4 animate-spin" />} Restart the count</Button>
        </div>
      </div>
    </Modal>
  )
}
