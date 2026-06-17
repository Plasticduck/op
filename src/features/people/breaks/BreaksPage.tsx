import { useCallback, useEffect, useState } from 'react'
import { Coffee, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { TimeSelect } from '@/components/forms/TimeSelect'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { durationHm } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { breaks, employees as empQ, type Break, type Employee } from '@/lib/queries/people'

type Row = Break & { employee: { first_name: string; last_name: string } | null }

function statusOf(b: Break): { label: string; tone: 'neutral' | 'warn' | 'ok' } {
  if (b.ended_at) return { label: 'completed', tone: 'ok' }
  if (b.started_at) return { label: 'on break', tone: 'warn' }
  return { label: 'scheduled', tone: 'neutral' }
}

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [emps, setEmps] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const [{ data: br }, { data: e }] = await Promise.all([
      breaks.forLocation(locationId, todayStart.toISOString()),
      empQ.listActive(locationId),
    ])
    setRows((br as unknown as Row[]) ?? [])
    setEmps((e as Employee[] | null) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Breaks"
        subtitle="Schedule and track employee breaks."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Schedule break</Button>}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Coffee} title="No breaks scheduled" description="Schedule breaks for your team — they'll see a timer and reminders." action={<Button onClick={() => setAdding(true)}>Schedule break</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Employee</th>
                <th className="px-3 py-2.5 font-medium">Scheduled</th>
                <th className="px-3 py-2.5 font-medium">Length</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const st = statusOf(b)
                return (
                  <tr key={b.id} className="border-t border-border hover:bg-content">
                    <td className="px-3 py-2.5 font-medium text-ink">{b.employee?.first_name} {b.employee?.last_name}</td>
                    <td className="px-3 py-2.5 text-ink-muted">
                      {format(new Date(b.scheduled_start), 'EEE h:mm a')} – {format(new Date(b.scheduled_end), 'h:mm a')}
                    </td>
                    <td className="px-3 py-2.5 tabular text-ink-muted">{durationHm(b.scheduled_start, b.scheduled_end)}</td>
                    <td className="px-3 py-2.5"><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={async () => { await breaks.remove(b.id); void load() }} className="text-ink-subtle hover:text-danger" aria-label="Delete break">
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <BreakModal locationId={locationId} employees={emps} createdBy={profile?.id ?? null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load() }} />
      )}
    </div>
  )
}

function BreakModal({ locationId, employees, createdBy, onClose, onSaved }: {
  locationId: string; employees: Employee[]; createdBy: string | null; onClose: () => void; onSaved: () => void
}) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState(today)
  const [start, setStart] = useState('12:00')
  const [minutes, setMinutes] = useState('30')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!employeeId) return setError('Select an employee')
    const startAt = new Date(`${date}T${start}`)
    const endAt = new Date(startAt.getTime() + Number(minutes) * 60000)
    const { error: err } = await breaks.create({
      location_id: locationId,
      employee_id: employeeId,
      scheduled_start: startAt.toISOString(),
      scheduled_end: endAt.toISOString(),
      notes: notes.trim() || null,
      created_by: createdBy,
    })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Schedule break">
      <div className="flex flex-col gap-4">
        <Field label="Employee" required>
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Start">{(id) => <TimeSelect id={id} value={start} onChange={setStart} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Minutes">{(id) => <Input id={id} type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Schedule</Button></div>
      </div>
    </Modal>
  )
}

export default function BreaksPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
