import { useCallback, useEffect, useState } from 'react'
import { Plus, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { employees as empQ, counseling as counselingQ, type Employee, type CounselingRecord } from '@/lib/queries/people'

const TYPE_TONE = { verbal: 'neutral', written: 'warn', final: 'danger', pip: 'danger' } as const

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const [emps, setEmps] = useState<Employee[]>([])
  const [rows, setRows] = useState<CounselingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const empName = (eid: string) => {
    const e = emps.find((x) => x.id === eid)
    return e ? `${e.first_name} ${e.last_name}` : '—'
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: e } = await empQ.list(locationId)
    const list = (e as Employee[] | null) ?? []
    setEmps(list)
    if (list.length) {
      const { data } = await counselingQ.list(list.map((x) => x.id))
      setRows((data as CounselingRecord[] | null) ?? [])
    } else setRows([])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Counseling & discipline"
        subtitle="Confidential records — visible to managers and owners only."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New record</Button>}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No records" description="Document verbal, written, final, or PIP counseling sessions." action={<Button onClick={() => setCreating(true)}>New record</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Employee</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Acknowledged</th>
                <th className="px-3 py-2.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{empName(c.employee_id)}</td>
                  <td className="px-3 py-2.5"><Badge tone={TYPE_TONE[c.type as keyof typeof TYPE_TONE]}>{c.type}</Badge></td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(c.date)}</td>
                  <td className="px-3 py-2.5">{c.employee_acknowledged ? <Badge tone="ok">Yes</Badge> : <Badge tone="neutral">No</Badge>}</td>
                  <td className="px-3 py-2.5 max-w-xs truncate text-ink-muted">{c.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <RecordModal employees={emps} recorderId={profile?.id ?? null} recorderName={profile?.name ?? null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load() }} />}
    </div>
  )
}

const COUNSELING_CATEGORIES = ['Attendance', 'Performance', 'Conduct', 'Policy', 'Safety', 'Other']

function RecordModal({ employees, recorderId, recorderName, onClose, onSaved }: {
  employees: Employee[]; recorderId: string | null; recorderName: string | null; onClose: () => void; onSaved: () => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [type, setType] = useState('verbal')
  const [category, setCategory] = useState('Attendance')
  const [date, setDate] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [description, setDescription] = useState('')
  const [actionPlan, setActionPlan] = useState('')
  const [witnesses, setWitnesses] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError(null)
    if (!employeeId) return setError('Select an employee')
    if (!date) return setError('Pick a date')
    setBusy(true)
    const { error: err } = await counselingQ.create({
      employee_id: employeeId,
      recorded_by: recorderId,
      recorded_by_name: recorderName,
      type, category, date,
      follow_up_date: followUp || null,
      description: description.trim() || null,
      action_plan: actionPlan.trim() || null,
      witnesses: witnesses.trim() || null,
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New counseling record" size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Employee" required>
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="verbal">Verbal</option>
                <option value="written">Written</option>
                <option value="final">Final</option>
                <option value="pip">PIP</option>
              </Select>
            )}
          </Field>
          <Field label="Category">
            {(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {COUNSELING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Date" required>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <Field label="Description / issue">
          {(id) => (
            <textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="What happened, when, and the impact." />
          )}
        </Field>
        <Field label="Action plan / required improvement">
          {(id) => (
            <textarea id={id} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} rows={3}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="What the employee must do, by when, to resolve this." />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Follow-up date">{(id) => <Input id={id} type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />}</Field>
          <Field label="Witnesses">{(id) => <Input id={id} value={witnesses} onChange={(e) => setWitnesses(e.target.value)} placeholder="Names of anyone present" />}</Field>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save record'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function CounselingPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
