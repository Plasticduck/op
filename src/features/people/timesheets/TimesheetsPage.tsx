import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Pencil } from 'lucide-react'
import { addDays, format } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { AuditHistory } from '@/components/data/AuditHistory'
import { dateTime } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { timeEntries } from '@/lib/queries/people'

type Entry = {
  id: string
  employee_id: string
  clock_in: string
  clock_out: string | null
  auto_closed: boolean
  edited_at: string | null
  notes: string | null
  employee: { first_name: string; last_name: string } | null
}

const hrs = (e: Entry) =>
  e.clock_out ? (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3600000 : 0

function Inner({ locationId }: { locationId: string }) {
  const [periodDays, setPeriodDays] = useState(14)
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Entry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const start = addDays(new Date(), -periodDays).toISOString()
    const end = new Date().toISOString()
    const { data } = await timeEntries.forPeriod(locationId, start, end)
    setRows((data as unknown as Entry[]) ?? [])
    setLoading(false)
  }, [locationId, periodDays])

  useEffect(() => { void load() }, [load])

  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; total: number; flagged: number }>()
    for (const e of rows) {
      const name = e.employee ? `${e.employee.first_name} ${e.employee.last_name}` : 'Unknown'
      const cur = map.get(e.employee_id) ?? { name, total: 0, flagged: 0 }
      cur.total += hrs(e)
      if (e.auto_closed || e.edited_at) cur.flagged += 1
      map.set(e.employee_id, cur)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [rows])

  const totalHours = byEmployee.reduce((a, e) => a + e.total, 0)
  const otEmployees = byEmployee.filter((e) => e.total > 40).length

  const exportCsv = () => {
    const header = 'Employee,Total Hours,Regular,Overtime\n'
    const lines = byEmployee.map((e) => {
      const ot = Math.max(0, e.total - 40)
      return `"${e.name}",${e.total.toFixed(2)},${(e.total - ot).toFixed(2)},${ot.toFixed(2)}`
    })
    const blob = new Blob([header + lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `timesheet-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Timesheets"
        subtitle="Pay-period hours, overtime, and payroll export."
        actions={<Button variant="secondary" onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>}
      />

      <div className="flex items-center gap-2">
        <Select value={String(periodDays)} onChange={(e) => setPeriodDays(Number(e.target.value))} className="w-44">
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
        </Select>
      </div>

      <StatCardRow
        items={[
          { label: 'Total hours', value: totalHours.toFixed(1) },
          { label: 'Employees', value: byEmployee.length },
          { label: 'Over 40h', value: otEmployees },
          { label: 'Flagged entries', value: rows.filter((r) => r.auto_closed || r.edited_at).length },
        ]}
      />

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Summary by employee</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="py-1.5 font-medium">Employee</th>
              <th className="py-1.5 font-medium numeric">Total</th>
              <th className="py-1.5 font-medium numeric">Regular</th>
              <th className="py-1.5 font-medium numeric">OT</th>
            </tr>
          </thead>
          <tbody>
            {byEmployee.map((e) => {
              const ot = Math.max(0, e.total - 40)
              return (
                <tr key={e.name} className="border-t border-border">
                  <td className="py-1.5 text-ink">{e.name}</td>
                  <td className="py-1.5 numeric tabular text-ink">{e.total.toFixed(1)}</td>
                  <td className="py-1.5 numeric tabular text-ink-muted">{(e.total - ot).toFixed(1)}</td>
                  <td className="py-1.5 numeric tabular">{ot > 0 ? <span className="font-medium text-warn">{ot.toFixed(1)}</span> : <span className="text-ink-muted">0.0</span>}</td>
                </tr>
              )
            })}
            {byEmployee.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-ink-muted">No time entries in this period.</td></tr>}
          </tbody>
        </table>
      </section>

      {loading ? null : rows.length > 0 && (
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Entries</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="py-1.5 font-medium">Employee</th>
                  <th className="py-1.5 font-medium">In</th>
                  <th className="py-1.5 font-medium">Out</th>
                  <th className="py-1.5 font-medium numeric">Hours</th>
                  <th className="py-1.5 font-medium">Flags</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-1.5 text-ink">{e.employee?.first_name} {e.employee?.last_name}</td>
                    <td className="py-1.5 text-ink-muted">{dateTime(e.clock_in)}</td>
                    <td className="py-1.5 text-ink-muted">{e.clock_out ? dateTime(e.clock_out) : <Badge tone="warn">open</Badge>}</td>
                    <td className="py-1.5 numeric tabular text-ink-muted">{hrs(e).toFixed(2)}</td>
                    <td className="py-1.5">
                      {e.auto_closed && <Badge tone="warn">auto</Badge>}
                      {e.edited_at && <Badge tone="neutral">edited</Badge>}
                    </td>
                    <td className="py-1.5 text-right">
                      {e.edited_at && <AuditHistory rowId={e.id} />}
                      <Button variant="ghost" size="sm" onClick={() => setEditing(e)}><Pencil className="size-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing && <EditEntryModal entry={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    </div>
  )
}

function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

function EditEntryModal({ entry, onClose, onSaved }: { entry: Entry; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [clockIn, setClockIn] = useState(toLocalInput(entry.clock_in))
  const [clockOut, setClockOut] = useState(toLocalInput(entry.clock_out))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!reason.trim()) return setError('A reason is required (logged to the audit trail)')
    const { error: err } = await timeEntries.update(entry.id, {
      clock_in: new Date(clockIn).toISOString(),
      clock_out: clockOut ? new Date(clockOut).toISOString() : null,
      edited_by: profile?.id ?? null,
      edited_at: new Date().toISOString(),
      notes: reason.trim(),
    })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Edit time entry">
      <div className="flex flex-col gap-4">
        <Field label="Clock in">{(id) => <Input id={id} type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />}</Field>
        <Field label="Clock out">{(id) => <Input id={id} type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />}</Field>
        <Field label="Reason for edit" hint="Recorded in the audit trail" required>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save edit</Button></div>
      </div>
    </Modal>
  )
}

export default function TimesheetsPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
