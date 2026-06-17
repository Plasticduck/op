import { useEffect, useState } from 'react'
import { NotebookPen, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { opsNotes, type OpsNote } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'

type Row = OpsNote & { location: { name: string } | null }

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Department', value: (r) => r.department },
  { header: 'Type', value: (r) => r.note_type },
  { header: 'Note', value: (r) => r.additional_notes },
  { header: 'Submitted by', value: (r) => r.submitted_by_name },
  { header: 'Date', value: (r) => shortDate(r.created_at) },
]

export default function OpsNotesPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)

  const load = () => opsNotes.list().then(({ data }) => { setRows((data as unknown as Row[]) ?? []); setLoading(false) })
  useEffect(() => { void load() }, [])
  const table = useOpsTable(rows, (r) => r.created_at)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Staffing & Culture Notes"
        subtitle="Leadership, staffing, and culture observations across sites."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add note</Button>}
      />
      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf('Staffing & Culture Notes', EXPORT_COLUMNS, table.rows)}
        onExportExcel={() => exportExcel('staffing-culture-notes', EXPORT_COLUMNS, table.rows)}
      />
      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={NotebookPen} title="No notes" description="Add a staffing, leadership, or culture note." action={<Button onClick={() => setAdding(true)}>Add note</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Department</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Submitted by</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((n) => (
                <tr key={n.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{n.location?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{n.department ?? '—'}</td>
                  <td className="px-3 py-2.5">{n.note_type ? <Badge tone="neutral">{n.note_type}</Badge> : '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{n.submitted_by_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(n.created_at)}</td>
                  <td className="px-3 py-2.5 text-right"><Button variant="ghost" size="sm" onClick={() => setOpen(n)}>View</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal open onClose={() => setOpen(null)} title={`Note · ${open.location?.name ?? 'Site'}`}>
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-ink-muted">{[open.department, open.note_type].filter(Boolean).join(' · ')}</p>
            {open.other_description && <p className="text-ink">{open.other_description}</p>}
            <p className="whitespace-pre-wrap text-ink">{open.additional_notes ?? '—'}</p>
            <p className="mt-2 text-xs text-ink-subtle">{open.submitted_by_name ?? '—'} · {shortDate(open.created_at)}</p>
          </div>
        </Modal>
      )}

      {adding && <AddNote profileId={profile?.id ?? null} accountId={profile?.account_id ?? ''} submitterName={profile?.name ?? null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load() }} />}
    </div>
  )
}

function AddNote({ accountId, profileId, submitterName, onClose, onSaved }: {
  accountId: string; profileId: string | null; submitterName: string | null; onClose: () => void; onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [department, setDepartment] = useState('')
  const [noteType, setNoteType] = useState('General')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!text.trim()) return setError('Enter a note')
    const { error: err } = await opsNotes.create({
      account_id: accountId,
      location_id: locationId || null,
      department: department.trim() || null,
      note_type: noteType,
      additional_notes: text.trim(),
      submitted_by: profileId,
      submitted_by_name: submitterName,
    })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Add note">
      <div className="flex flex-col gap-4">
        <Field label="Site">
          {(id) => (
            <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">— None —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">{(id) => <Input id={id} value={department} onChange={(e) => setDepartment(e.target.value)} />}</Field>
          <Field label="Type">
            {(id) => (
              <Select id={id} value={noteType} onChange={(e) => setNoteType(e.target.value)}>
                <option>General</option><option>Staffing</option><option>Leadership</option><option>Culture</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Note" required>
          {(id) => (
            <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
          )}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save note</Button></div>
      </div>
    </Modal>
  )
}
