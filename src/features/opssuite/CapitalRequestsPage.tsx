import { useEffect, useMemo, useState } from 'react'
import { Building2, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { shortDate, currency } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { capitalRequests, type CapitalRequest } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'

type Row = CapitalRequest & { location: { name: string } | null }
type Filter = 'pending' | 'approved' | 'rejected' | 'completed' | 'all'

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Title', value: (r) => r.title },
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Category', value: (r) => r.category },
  { header: 'Est. cost', value: (r) => (r.estimated_cost != null ? currency(r.estimated_cost) : '') },
  { header: 'Priority', value: (r) => r.priority },
  { header: 'Status', value: (r) => r.status },
  { header: 'Requested by', value: (r) => r.requested_by_name },
  { header: 'Requested', value: (r) => shortDate(r.created_at) },
]

const STATUS_TONE: Record<string, 'warn' | 'ok' | 'danger' | 'accent' | 'neutral'> = {
  pending: 'warn', approved: 'ok', rejected: 'danger', completed: 'accent',
}
const PRIORITY_TONE: Record<string, 'neutral' | 'warn' | 'danger'> = {
  low: 'neutral', medium: 'warn', high: 'danger',
}
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

export default function CapitalRequestsPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('pending')
  const [open, setOpen] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)

  const load = () =>
    capitalRequests.list().then(({ data }) => {
      setRows((data as unknown as Row[]) ?? [])
      setLoading(false)
    })
  useEffect(() => { void load() }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, approved: 0, rejected: 0, completed: 0, all: rows.length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const table = useOpsTable(visible, (r) => r.created_at)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Capital Improvement Requests"
        subtitle="Capital projects and equipment requests, with approval workflow."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> New request</Button>}
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
        onExportPdf={() => exportPdf('Capital Improvement Requests', EXPORT_COLUMNS, table.rows)}
        onExportExcel={() => exportExcel('capital-requests', EXPORT_COLUMNS, table.rows)}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={Building2} title="No requests" description="Capital requests in this state and timeframe will appear here." action={<Button onClick={() => setAdding(true)}>New request</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Title</th>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium text-right">Est. cost</th>
                <th className="px-3 py-2.5 font-medium">Priority</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Requested by</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{r.title}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.location?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.estimated_cost != null ? currency(r.estimated_cost) : '—'}</td>
                  <td className="px-3 py-2.5"><Badge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</Badge></td>
                  <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge></td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.requested_by_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right"><Button variant="ghost" size="sm" onClick={() => setOpen(r)}>View</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <RequestDetail
          request={open}
          deciderId={profile?.id ?? null}
          deciderName={profile?.name ?? null}
          onClose={() => setOpen(null)}
          onDecided={() => { setOpen(null); void load() }}
        />
      )}
      {adding && (
        <AddRequest
          accountId={profile?.account_id ?? ''}
          requesterId={profile?.id ?? null}
          requesterName={profile?.name ?? null}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load() }}
        />
      )}
    </div>
  )
}

function RequestDetail({ request, deciderId, deciderName, onClose, onDecided }: {
  request: Row; deciderId: string | null; deciderName: string | null; onClose: () => void; onDecided: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = async (status: 'approved' | 'rejected' | 'completed') => {
    setError(null)
    if (status === 'rejected' && !reason.trim()) return setError('Add a reason when rejecting')
    setBusy(true)
    const { error: err } = await capitalRequests.decide(request.id, status, deciderId ?? '', deciderName ?? '', reason.trim() || null)
    setBusy(false)
    if (err) return setError(err.message)
    onDecided()
  }

  return (
    <Modal open onClose={onClose} title={request.title} size="lg">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Detail label="Site" value={request.location?.name} />
          <Detail label="Category" value={request.category} />
          <Detail label="Estimated cost" value={request.estimated_cost != null ? currency(request.estimated_cost) : null} />
          <Detail label="Priority" value={request.priority} />
          <Detail label="Requested by" value={request.requested_by_name} />
          <Detail label="Requested" value={shortDate(request.created_at)} />
        </dl>
        {request.description && <p className="whitespace-pre-wrap text-sm text-ink">{request.description}</p>}

        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Status</span>
          <Badge tone={STATUS_TONE[request.status] ?? 'neutral'}>{request.status}</Badge>
        </div>

        {request.status !== 'pending' && request.status !== 'approved' ? (
          <div className="rounded-md border border-border bg-content px-3 py-2.5 text-sm">
            <p className="text-ink">{request.status} by {request.decided_by_name ?? '—'}{request.decided_at ? ` · ${shortDate(request.decided_at)}` : ''}</p>
            {request.decision_reason && <p className="mt-1 text-ink-muted">{request.decision_reason}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <Field label="Note" hint="Required to reject; optional otherwise.">
              {(id) => (
                <textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
              )}
            </Field>
            {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              {request.status === 'pending' && <Button variant="danger" disabled={busy} onClick={() => decide('rejected')}>Reject</Button>}
              {request.status === 'pending' && <Button variant="secondary" disabled={busy} onClick={() => decide('approved')}>Approve</Button>}
              {request.status === 'approved' && <Button disabled={busy} onClick={() => decide('completed')}>Mark completed</Button>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function AddRequest({ accountId, requesterId, requesterName, onClose, onSaved }: {
  accountId: string; requesterId: string | null; requesterName: string | null; onClose: () => void; onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [cost, setCost] = useState('')
  const [priority, setPriority] = useState('medium')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!title.trim()) return setError('Enter a title')
    const { error: err } = await capitalRequests.create({
      account_id: accountId,
      location_id: locationId || null,
      title: title.trim(),
      category: category.trim() || null,
      estimated_cost: cost.trim() ? Number(cost) : null,
      priority,
      description: description.trim() || null,
      requested_by: requesterId,
      requested_by_name: requesterName,
    })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New capital request">
      <div className="flex flex-col gap-4">
        <Field label="Title" required>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Site">
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">— None —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">{(id) => <Input id={id} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Equipment, Building…" />}</Field>
          <Field label="Estimated cost">{(id) => <Input id={id} type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        </div>
        <Field label="Description">
          {(id) => (
            <textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
          )}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Submit request</Button></div>
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
