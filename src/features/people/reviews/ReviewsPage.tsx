import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { employees as empQ, reviews as reviewsQ, type Employee, type Review } from '@/lib/queries/people'

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const [emps, setEmps] = useState<Employee[]>([])
  const [rows, setRows] = useState<Review[]>([])
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
      const { data } = await reviewsQ.list(list.map((x) => x.id))
      setRows((data as Review[] | null) ?? [])
    } else setRows([])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const scheduled = rows.filter((r) => r.status === 'scheduled')
  const completed = rows.filter((r) => r.status === 'completed')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Performance Reviews"
        subtitle="Schedule and record employee reviews."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New review</Button>}
      />

      <StatCardRow
        items={[
          { label: 'Completed', value: completed.length },
          { label: 'Scheduled', value: scheduled.length },
          { label: 'Avg rating', value: completed.length ? (completed.reduce((a, r) => a + (r.rating ?? 0), 0) / completed.length).toFixed(1) : '—' },
        ]}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No reviews yet" description="Schedule or record a performance review." action={<Button onClick={() => setCreating(true)}>New review</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Employee</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Rating</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{empName(r.employee_id)}</td>
                  <td className="px-3 py-2.5"><Badge tone={r.status === 'completed' ? 'ok' : 'warn'}>{r.status}</Badge></td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.rating ? `${r.rating}/5` : '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(r.review_date ?? r.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <ReviewModal employees={emps} reviewerId={profile?.id ?? null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load() }} />}
    </div>
  )
}

function ReviewModal({ employees, reviewerId, onClose, onSaved }: {
  employees: Employee[]; reviewerId: string | null; onClose: () => void; onSaved: () => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [mode, setMode] = useState<'completed' | 'scheduled'>('completed')
  const [rating, setRating] = useState('5')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!employeeId) return setError('Select an employee')
    const { error: err } = await reviewsQ.create(
      mode === 'completed'
        ? { employee_id: employeeId, reviewed_by: reviewerId, rating: Number(rating), review_date: date || null, notes: notes.trim() || null, status: 'completed' }
        : { employee_id: employeeId, reviewed_by: reviewerId, due_date: date || null, status: 'scheduled' },
    )
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New review">
      <div className="flex flex-col gap-4">
        <Field label="Employee" required>
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Type">
          {(id) => (
            <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as 'completed' | 'scheduled')}>
              <option value="completed">Record completed review</option>
              <option value="scheduled">Schedule a review</option>
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {mode === 'completed' && (
            <Field label="Rating">{(id) => <Select id={id} value={rating} onChange={(e) => setRating(e.target.value)}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}</Select>}</Field>
          )}
          <Field label={mode === 'completed' ? 'Review date' : 'Due date'}>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        {mode === 'completed' && <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></div>
      </div>
    </Modal>
  )
}

export default function ReviewsPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
