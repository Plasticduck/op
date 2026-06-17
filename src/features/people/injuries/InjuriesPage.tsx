import { useCallback, useEffect, useState } from 'react'
import { HardHat, Plus } from 'lucide-react'
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
import { employees as empQ, injuries as injuriesQ, type Employee, type InjuryReport } from '@/lib/queries/people'
import { exportOsha300, exportOsha301Summary } from '@/lib/reports/oshaExport'

type Row = InjuryReport & { employee: { first_name: string; last_name: string } | null }

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const [emps, setEmps] = useState<Employee[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: e }, { data: r }] = await Promise.all([empQ.list(locationId), injuriesQ.list(locationId)])
    setEmps((e as Employee[] | null) ?? [])
    setRows((r as unknown as Row[]) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const since30 = Date.now() - 30 * 24 * 3600 * 1000
  const recent = rows.filter((r) => new Date(r.incident_date).getTime() >= since30)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Injury reports"
        subtitle="OSHA-style incident log — managers and owners only."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => exportOsha301Summary(rows)} disabled={rows.length === 0}>Export details (CSV)</Button>
            <Button variant="secondary" onClick={() => exportOsha300(rows, { year: new Date().getFullYear(), establishmentName: 'WashLyfe' })} disabled={rows.length === 0}>Export OSHA 300</Button>
            <Button onClick={() => setCreating(true)}><Plus className="size-4" /> Report incident</Button>
          </div>
        }
      />

      <StatCardRow
        items={[
          { label: 'Total incidents', value: rows.length },
          { label: 'Last 30 days', value: recent.length },
          { label: 'Required treatment', value: rows.filter((r) => r.medical_treatment_required).length },
        ]}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={HardHat} title="No incidents reported" description="Document workplace injuries here for OSHA compliance." action={<Button onClick={() => setCreating(true)}>Report incident</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Employee</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Body part</th>
                <th className="px-3 py-2.5 font-medium">Treatment</th>
                <th className="px-3 py-2.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{r.employee?.first_name} {r.employee?.last_name}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(r.incident_date)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.body_part_affected ?? '—'}</td>
                  <td className="px-3 py-2.5">{r.medical_treatment_required ? <Badge tone="danger">Required</Badge> : <Badge tone="ok">None</Badge>}</td>
                  <td className="px-3 py-2.5 max-w-xs truncate text-ink-muted">{r.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <ReportModal locationId={locationId} employees={emps} reporterId={profile?.id ?? null} reporterName={profile?.name ?? null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load() }} />}
    </div>
  )
}

function ReportModal({ locationId, employees, reporterId, reporterName, onClose, onSaved }: {
  locationId: string; employees: Employee[]; reporterId: string | null; reporterName: string | null; onClose: () => void; onSaved: () => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [areaDescription, setAreaDescription] = useState('')
  const [bodyPart, setBodyPart] = useState('')
  const [severity, setSeverity] = useState('minor')
  const [cause, setCause] = useState('')
  const [treatment, setTreatment] = useState(false)
  const [treatmentGiven, setTreatmentGiven] = useState('')
  const [doctorVisit, setDoctorVisit] = useState(false)
  const [oshaRecordable, setOshaRecordable] = useState(false)
  const [daysLost, setDaysLost] = useState('')
  const [witnesses, setWitnesses] = useState('')
  const [description, setDescription] = useState('')
  const [caseNumber, setCaseNumber] = useState('')
  const [jobTitleSnapshot, setJobTitleSnapshot] = useState('')
  const [classification, setClassification] = useState('')
  const [illnessType, setIllnessType] = useState('')
  const [daysRestricted, setDaysRestricted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onEmployeeChange = (id: string) => {
    setEmployeeId(id)
    const emp = employees.find((e) => e.id === id)
    if (emp && !jobTitleSnapshot) setJobTitleSnapshot(emp.role_title ?? '')
  }

  const save = async () => {
    setError(null)
    if (!employeeId) return setError('Select an employee')
    if (!date) return setError('Pick the incident date')
    setBusy(true)
    const { error: err } = await injuriesQ.create({
      location_id: locationId,
      employee_id: employeeId,
      reported_by: reporterId,
      reported_by_name: reporterName,
      incident_date: date,
      incident_time: time || null,
      area_description: areaDescription.trim() || null,
      body_part_affected: bodyPart.trim() || null,
      severity,
      cause: cause.trim() || null,
      medical_treatment_required: treatment,
      treatment_given: treatmentGiven.trim() || null,
      doctor_visit: doctorVisit,
      osha_recordable: oshaRecordable,
      days_lost: daysLost ? Number(daysLost) : null,
      witness_names: witnesses.trim() || null,
      description: description.trim() || null,
      case_number: caseNumber.trim() || null,
      job_title_snapshot: jobTitleSnapshot.trim() || null,
      days_restricted: daysRestricted ? Number(daysRestricted) : null,
      classification: classification || null,
      illness_type: illnessType || null,
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Report incident" size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Employee" required>
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => onEmployeeChange(e.target.value)}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Incident date" required>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Time of incident">{(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
        <Field label="Area / location on site">{(id) => <Input id={id} value={areaDescription} onChange={(e) => setAreaDescription(e.target.value)} placeholder="e.g. Bay 2 conveyor, equipment room" />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Body part affected">{(id) => <Input id={id} value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} />}</Field>
          <Field label="Severity">
            {(id) => (
              <Select id={id} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="major">Major</option>
                <option value="severe">Severe</option>
              </Select>
            )}
          </Field>
          <Field label="Days lost">{(id) => <Input id={id} type="number" min="0" step="1" value={daysLost} onChange={(e) => setDaysLost(e.target.value)} />}</Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Case number">{(id) => <Input id={id} value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} />}</Field>
          <Field label="Job title at time of incident">{(id) => <Input id={id} value={jobTitleSnapshot} onChange={(e) => setJobTitleSnapshot(e.target.value)} />}</Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="OSHA classification">
            {(id) => (
              <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value)}>
                <option value="">None</option>
                <option value="death">Death</option>
                <option value="days_away">Days away from work</option>
                <option value="job_transfer">Job transfer or restriction</option>
                <option value="other_recordable">Other recordable case</option>
              </Select>
            )}
          </Field>
          <Field label="Illness / injury type">
            {(id) => (
              <Select id={id} value={illnessType} onChange={(e) => setIllnessType(e.target.value)}>
                <option value="">None</option>
                <option value="injury">Injury</option>
                <option value="skin">Skin disorder</option>
                <option value="respiratory">Respiratory condition</option>
                <option value="poisoning">Poisoning</option>
                <option value="hearing">Hearing loss</option>
                <option value="other_illness">Other illness</option>
              </Select>
            )}
          </Field>
          <Field label="Days on job transfer/restriction">{(id) => <Input id={id} type="number" min="0" step="1" value={daysRestricted} onChange={(e) => setDaysRestricted(e.target.value)} />}</Field>
        </div>
        <Field label="What happened (description)">
          {(id) => (
            <textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
          )}
        </Field>
        <Field label="Cause / contributing factors">
          {(id) => (
            <textarea id={id} value={cause} onChange={(e) => setCause(e.target.value)} rows={2}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
          )}
        </Field>
        <Field label="Treatment given on-site">
          {(id) => (
            <textarea id={id} value={treatmentGiven} onChange={(e) => setTreatmentGiven(e.target.value)} rows={2}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="First aid given, ice, etc." />
          )}
        </Field>
        <Field label="Witnesses">{(id) => <Input id={id} value={witnesses} onChange={(e) => setWitnesses(e.target.value)} />}</Field>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={treatment} onChange={(e) => setTreatment(e.target.checked)} />
            Medical treatment required
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={doctorVisit} onChange={(e) => setDoctorVisit(e.target.checked)} />
            Doctor / ER visit
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={oshaRecordable} onChange={(e) => setOshaRecordable(e.target.checked)} />
            OSHA-recordable
          </label>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save report'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function InjuriesPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
