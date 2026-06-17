import { useCallback, useEffect, useState } from 'react'
import { CalendarOff, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { employees as empQ, timeOff, type Employee, type TimeOffRequest } from '@/lib/queries/people'

type Row = TimeOffRequest & { employee?: { first_name: string; last_name: string } | null }
const TONE = { pending: 'warn', approved: 'ok', denied: 'danger' } as const

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const isManager = profile?.role !== 'employee'
  const [rows, setRows] = useState<Row[]>([])
  const [emp, setEmp] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    if (isManager) {
      const { data } = await timeOff.forLocation(locationId)
      setRows((data as unknown as Row[]) ?? [])
    } else if (profile) {
      const { data: e } = await empQ.byUser(profile.id)
      const employee = (e as Employee | null) ?? null
      setEmp(employee)
      if (employee) {
        const { data } = await timeOff.forEmployee(employee.id)
        setRows((data as Row[] | null) ?? [])
      }
    }
    setLoading(false)
  }, [isManager, locationId, profile])

  useEffect(() => { void load() }, [load])

  const decide = async (id: string, status: 'approved' | 'denied') => {
    if (!profile) return
    await timeOff.decide(id, status, profile.id)
    void load()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Time off"
        subtitle={isManager ? 'Review and decide time-off requests.' : 'Request time off and track your requests.'}
        actions={!isManager ? <Button onClick={() => setRequesting(true)}><Plus className="size-4" /> Request time off</Button> : undefined}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="No time-off requests"
          description={isManager ? 'Requests from your team show up here.' : 'Submit a request and track its status here.'}
          action={!isManager ? <Button onClick={() => setRequesting(true)}>Request time off</Button> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                {isManager && <th className="px-3 py-2.5 font-medium">Employee</th>}
                <th className="px-3 py-2.5 font-medium">Dates</th>
                <th className="px-3 py-2.5 font-medium">Reason</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  {isManager && <td className="px-3 py-2.5 font-medium text-ink">{r.employee?.first_name} {r.employee?.last_name}</td>}
                  <td className="px-3 py-2.5 text-ink">{shortDate(r.start_date)} – {shortDate(r.end_date)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.reason ?? '—'}</td>
                  <td className="px-3 py-2.5"><Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge></td>
                  <td className="px-3 py-2.5 text-right">
                    {isManager && r.status === 'pending' && (
                      <div className="flex justify-end gap-1">
                        <Button variant="secondary" size="sm" onClick={() => decide(r.id, 'approved')}>Approve</Button>
                        <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => decide(r.id, 'denied')}>Deny</Button>
                      </div>
                    )}
                    {!isManager && r.status === 'pending' && (
                      <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={async () => { await timeOff.remove(r.id); void load() }}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requesting && emp && (
        <RequestModal
          locationId={locationId}
          employeeId={emp.id}
          onClose={() => setRequesting(false)}
          onSaved={() => { setRequesting(false); void load() }}
        />
      )}
      {requesting && !emp && (
        <Modal open onClose={() => setRequesting(false)} title="No employee record" size="sm">
          <p className="text-sm text-ink-muted">Your login isn't linked to an employee record yet. Ask your manager to link it before requesting time off.</p>
          <div className="mt-4 flex justify-end"><Button onClick={() => setRequesting(false)}>Close</Button></div>
        </Modal>
      )}
    </div>
  )
}

function RequestModal({ locationId, employeeId, onClose, onSaved }: {
  locationId: string; employeeId: string; onClose: () => void; onSaved: () => void
}) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!start || !end) return setError('Pick start and end dates')
    if (end < start) return setError('End date must be after the start date')
    const { error: err } = await timeOff.create({
      location_id: locationId, employee_id: employeeId,
      start_date: start, end_date: end, reason: reason.trim() || null,
    })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Request time off">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" required>{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="End date" required>{(id) => <Input id={id} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacation, appointment…" />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Submit request</Button></div>
      </div>
    </Modal>
  )
}

export default function TimeOffPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
