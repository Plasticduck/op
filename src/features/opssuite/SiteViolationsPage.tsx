import { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldAlert, Plus, Trash2, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { AttachmentViewer } from '@/components/data/AttachmentViewer'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { siteViolations, type SiteViolation } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { supabase } from '@/lib/supabase'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

type Row = SiteViolation & { location: { name: string } | null }
type Filter = 'open' | 'resolved' | 'all'

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Type', value: (r) => r.violation_type },
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Department', value: (r) => r.department },
  { header: 'Severity', value: (r) => r.severity },
  { header: 'Status', value: (r) => r.status },
  { header: 'Due', value: (r) => (r.due_date ? shortDate(r.due_date) : '') },
  { header: 'Reported by', value: (r) => r.reported_by_name },
  { header: 'Reported', value: (r) => shortDate(r.reported_at) },
]

const SEVERITY_TONE: Record<string, 'neutral' | 'warn' | 'danger'> = {
  minor: 'neutral', major: 'warn', critical: 'danger',
}
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
]

function isOverdue(r: Row) {
  return r.status === 'open' && r.due_date != null && new Date(r.due_date) < new Date()
}

export default function SiteViolationsPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('open')
  const [open, setOpen] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)

  const load = () =>
    siteViolations.list().then(({ data }) => {
      setRows((data as unknown as Row[]) ?? [])
      setLoading(false)
    })
  useEffect(() => { void load() }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, resolved: 0, all: rows.length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const table = useOpsTable(visible, (r) => r.reported_at ?? r.created_at)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Site Violations"
        subtitle="Track compliance and safety violations through resolution."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Log violation</Button>}
      />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={
              'rounded-md px-3 py-1.5 text-sm font-medium transition ' +
              (filter === f.key ? 'bg-accent text-white' : 'bg-card border border-border text-ink-muted hover:bg-content')
            }
          >
            {f.label} <span className="ml-1 opacity-70">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf('Site Violations', EXPORT_COLUMNS, table.rows)}
        onExportExcel={() => exportExcel('site-violations', EXPORT_COLUMNS, table.rows)}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No violations" description="Violations in this state and timeframe will appear here." action={<Button onClick={() => setAdding(true)}>Log violation</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Department</th>
                <th className="px-3 py-2.5 font-medium">Severity</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Due</th>
                <th className="px-3 py-2.5 font-medium">Reported by</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{r.violation_type ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.location?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.department ?? '—'}</td>
                  <td className="px-3 py-2.5"><Badge tone={SEVERITY_TONE[r.severity] ?? 'neutral'}>{r.severity}</Badge></td>
                  <td className="px-3 py-2.5"><Badge tone={r.status === 'resolved' ? 'ok' : 'warn'}>{r.status}</Badge></td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.due_date ? <span className={isOverdue(r) ? 'text-danger font-medium' : ''}>{shortDate(r.due_date)}</span> : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.reported_by_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right"><Button variant="ghost" size="sm" onClick={() => setOpen(r)}>View</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <ViolationDetail
          violation={open}
          resolverId={profile?.id ?? null}
          resolverName={profile?.name ?? null}
          onClose={() => setOpen(null)}
          onResolved={() => { setOpen(null); void load() }}
        />
      )}
      {adding && (
        <AddViolation
          accountId={profile?.account_id ?? ''}
          reporterId={profile?.id ?? null}
          reporterName={profile?.name ?? null}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load() }}
        />
      )}
    </div>
  )
}

function ViolationDetail({ violation, resolverId, resolverName, onClose, onResolved }: {
  violation: Row; resolverId: string | null; resolverName: string | null; onClose: () => void; onResolved: () => void
}) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolve = async () => {
    setError(null)
    setBusy(true)
    const { error: err } = await siteViolations.resolve(violation.id, resolverId ?? '', resolverName ?? '', notes.trim() || null)
    setBusy(false)
    if (err) return setError(err.message)
    onResolved()
  }

  return (
    <Modal open onClose={onClose} title={violation.violation_type ?? 'Violation'} size="lg">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Detail label="Site" value={violation.location?.name} />
          <Detail label="Department" value={violation.department} />
          <Detail label="Severity" value={violation.severity} />
          <Detail label="Reported by" value={violation.reported_by_name} />
          <Detail label="Reported" value={shortDate(violation.reported_at)} />
          <Detail label="Due date" value={violation.due_date ? shortDate(violation.due_date) : null} />
        </dl>
        {violation.description && <p className="whitespace-pre-wrap text-sm text-ink">{violation.description}</p>}
        <AttachmentViewer entityType="violation" entityId={violation.id} />

        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Status</span>
          <Badge tone={violation.status === 'resolved' ? 'ok' : 'warn'}>{violation.status}</Badge>
        </div>

        {violation.status === 'resolved' ? (
          <div className="rounded-md border border-border bg-content px-3 py-2.5 text-sm">
            <p className="text-ink">Resolved by {violation.resolved_by_name ?? '—'}{violation.resolved_at ? ` · ${shortDate(violation.resolved_at)}` : ''}</p>
            {violation.resolution_notes && <p className="mt-1 text-ink-muted">{violation.resolution_notes}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <Field label="Resolution notes">
              {(id) => (
                <textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
              )}
            </Field>
            {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex justify-end"><Button disabled={busy} onClick={resolve}>Mark resolved</Button></div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// MightyOps-style violation types and departments (carried over from the old app
// data so categorization is consistent).
const VIOLATION_TYPES = [
  'Cash Count/GSR Violation',
  'Payroll Violation',
  'Company Card Violation',
  'Expense Report Violation',
  'Improper/Lack of Ticket Submission Violation',
  'Procedural Violation',
  'Onboarding Violation',
  'Timepunch Errors Violation',
  'Site Appearance Violation',
  'Compliance Violation',
  'Safety Protocol Violation',
  'Other',
]
const DEPARTMENTS = ['Accounting', 'Human Resources', 'Operations', 'IT', 'Safety']

function AddViolation({ accountId, reporterId, reporterName, onClose, onSaved }: {
  accountId: string; reporterId: string | null; reporterName: string | null; onClose: () => void; onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [type, setType] = useState('Cash Count/GSR Violation')
  const [department, setDepartment] = useState('Accounting')
  const [severity, setSeverity] = useState('minor')
  const [dueDate, setDueDate] = useState('')
  const [description, setDescription] = useState('')
  const [otherDescription, setOtherDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const save = async () => {
    setError(null)
    const effectiveType = type === 'Other' ? (otherDescription.trim() || 'Other') : type
    if (!effectiveType) return setError('Pick a violation type')
    setBusy(true)
    const { data, error: err } = await siteViolations.create({
      account_id: accountId,
      location_id: locationId || null,
      violation_type: effectiveType,
      department,
      severity,
      due_date: dueDate || null,
      description: description.trim() || null,
      reported_by: reporterId,
      reported_by_name: reporterName,
    })
    if (err) {
      setBusy(false)
      return setError(err.message)
    }
    const newId = (data as { id?: string } | null)?.id
    if (newId && pendingFiles.length > 0) {
      for (const file of pendingFiles) {
        const dataUri = await fileToDataUri(file)
        const { error: upErr } = await supabase.from('ops_attachments').insert({
          account_id: accountId,
          entity_type: 'violation',
          entity_id: newId,
          file_name: file.name,
          file_type: file.type,
          data_uri: dataUri,
        })
        if (upErr) {
          setBusy(false)
          return setError(upErr.message)
        }
      }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Log violation">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Department" required>
            {(id) => (
              <Select id={id} value={department} onChange={(e) => setDepartment(e.target.value)}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Site">
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">— None —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Violation type" required>
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
              {VIOLATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}
        </Field>
        {type === 'Other' && (
          <Field label="If Other, describe">
            {(id) => <Input id={id} value={otherDescription} onChange={(e) => setOtherDescription(e.target.value)} />}
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Severity">
            {(id) => (
              <Select id={id} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option>
              </Select>
            )}
          </Field>
          <Field label="Due date">{(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        </div>
        <Field label="Additional notes">
          {(id) => (
            <textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
          )}
        </Field>
        <Field label="Add photo or PDF (optional)">
          {() => (
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  if (files.length > 0) setPendingFiles((prev) => [...prev, ...files])
                  e.target.value = ''
                }}
              />
              <div>
                <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                  Choose files
                </Button>
              </div>
              {pendingFiles.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md border border-border bg-content px-3 py-2 text-sm">
                  {pendingFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink">{f.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="size-4" /> Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : 'Log violation'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-ink">{value || '—'}</dd>
    </div>
  )
}
