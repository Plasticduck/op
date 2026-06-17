import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Receipt, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/forms/Field'
import { AttachmentViewer } from '@/components/data/AttachmentViewer'
import { shortDate, currency } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { opsInvoices, type OpsInvoice } from '@/lib/queries/opsSuite'
import { listUsers } from '@/lib/queries/account'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
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

type Row = OpsInvoice & { location: { name: string } | null }
type Filter = 'pending' | 'approved' | 'rejected' | 'all'

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Vendor', value: (r) => r.vendor_name },
  { header: 'Amount', value: (r) => currency(r.amount) },
  { header: 'Invoice date', value: (r) => (r.invoice_date ? shortDate(r.invoice_date) : '') },
  { header: 'GL code', value: (r) => r.gl_code },
  { header: 'Status', value: (r) => r.status },
  { header: 'Submitted by', value: (r) => r.submitted_by_name },
  { header: 'Submitted', value: (r) => shortDate(r.submitted_at) },
]

const TONE: Record<string, 'warn' | 'ok' | 'danger' | 'neutral'> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

export default function InvoicesPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('pending')
  const [open, setOpen] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)

  const load = () =>
    opsInvoices.list().then(({ data }) => {
      setRows((data as unknown as Row[]) ?? [])
      setLoading(false)
    })
  useEffect(() => { void load() }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, approved: 0, rejected: 0, all: rows.length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const table = useOpsTable(visible, (r) => r.submitted_at)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoice Approval"
        subtitle="Review, approve, and reject vendor invoices."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add invoice</Button>}
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
        onExportPdf={() => exportPdf('Invoices', EXPORT_COLUMNS, table.rows)}
        onExportExcel={() => exportExcel('invoices', EXPORT_COLUMNS, table.rows)}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices" description="Invoices in this state and timeframe will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Vendor</th>
                <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                <th className="px-3 py-2.5 font-medium">Invoice date</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Submitted by</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((iv) => (
                <tr key={iv.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{iv.location?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{iv.vendor_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{currency(iv.amount)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(iv.invoice_date)}</td>
                  <td className="px-3 py-2.5"><Badge tone={TONE[iv.status] ?? 'neutral'}>{iv.status}</Badge></td>
                  <td className="px-3 py-2.5 text-ink-muted">{iv.submitted_by_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right"><Button variant="ghost" size="sm" onClick={() => setOpen(iv)}>View</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <InvoiceDetail
          invoice={open}
          deciderId={profile?.id ?? null}
          deciderName={profile?.name ?? null}
          onClose={() => setOpen(null)}
          onDecided={() => { setOpen(null); void load() }}
        />
      )}
      {adding && (
        <AddInvoice
          accountId={profile?.account_id ?? ''}
          submitterId={profile?.id ?? null}
          submitterName={profile?.name ?? null}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load() }}
        />
      )}
    </div>
  )
}

function AddInvoice({ accountId, submitterId, submitterName, onClose, onSaved }: {
  accountId: string; submitterId: string | null; submitterName: string | null; onClose: () => void; onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [vendor, setVendor] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [amount, setAmount] = useState('')
  const [glCode, setGlCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const save = async () => {
    setError(null)
    if (!vendor.trim()) return setError('Enter a vendor')
    if (!amount.trim() || isNaN(Number(amount))) return setError('Enter a valid amount')
    setBusy(true)
    const { data, error: err } = await opsInvoices.create({
      account_id: accountId,
      location_id: locationId || null,
      vendor_name: vendor.trim(),
      invoice_date: invoiceDate || null,
      amount: Number(amount),
      gl_code: glCode.trim() || null,
      status: 'pending',
      submitted_by: submitterId,
      submitted_by_name: submitterName,
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
          entity_type: 'invoice',
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
    <Modal open onClose={onClose} title="Add invoice">
      <div className="flex flex-col gap-4">
        <Field label="Vendor" required>{(id) => <Input id={id} value={vendor} onChange={(e) => setVendor(e.target.value)} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Site">
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">— None —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Invoice date">{(id) => <Input id={id} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />}</Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Amount (USD)" required>{(id) => <Input id={id} type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="GL code">{(id) => <Input id={id} value={glCode} onChange={(e) => setGlCode(e.target.value)} />}</Field>
        </div>
        <Field label="Add attachments (optional)">
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
            {busy ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : 'Add invoice'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function InvoiceDetail({ invoice, deciderId, deciderName, onClose, onDecided }: {
  invoice: Row; deciderId: string | null; deciderName: string | null; onClose: () => void; onDecided: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assigneeId, setAssigneeId] = useState(invoice.assigned_to ?? '')
  const [teammates, setTeammates] = useState<Array<{ id: string; name: string | null; email: string | null; role: string }>>([])
  const [assignBusy, setAssignBusy] = useState(false)
  const [notifyResult, setNotifyResult] = useState<string | null>(null)

  useEffect(() => { void listUsers().then(({ data }) => setTeammates(data ?? [])) }, [])

  const decide = async (status: 'approved' | 'rejected') => {
    setError(null)
    if (status === 'rejected' && !reason.trim()) return setError('Add a reason when rejecting')
    setBusy(true)
    const { error: err } = await opsInvoices.decide(invoice.id, status, deciderId ?? '', deciderName ?? '', reason.trim() || null)
    setBusy(false)
    if (err) return setError(err.message)
    onDecided()
  }

  const assignAndNotify = async () => {
    setNotifyResult(null)
    const picked = teammates.find((t) => t.id === assigneeId)
    if (!picked) return setNotifyResult('Pick a teammate to assign.')
    setAssignBusy(true)
    const { error: assignErr } = await opsInvoices.assign(invoice.id, picked.id, picked.name ?? picked.email ?? 'Teammate')
    if (assignErr) {
      setAssignBusy(false)
      setNotifyResult('Assignment saved but email failed.')
      return
    }
    const { data, error: fnErr } = await supabase.functions.invoke('notify-invoice-assignment', { body: { invoice_id: invoice.id } })
    if (fnErr || (data as { error?: string } | null)?.error === 'no_key') {
      await opsInvoices.setNotifyStatus(invoice.id, 'no_key')
      setNotifyResult('Assigned. Email skipped (Resend not configured yet).')
    } else if ((data as { ok?: boolean } | null)?.ok === true) {
      await opsInvoices.setNotifyStatus(invoice.id, 'sent')
      setNotifyResult('Assigned and emailed.')
    } else {
      await opsInvoices.setNotifyStatus(invoice.id, 'failed')
      setNotifyResult('Assigned but email delivery failed.')
    }
    setAssignBusy(false)
  }

  const notifyLabel =
    invoice.notify_status === 'sent' ? 'emailed'
    : invoice.notify_status === 'failed' ? 'email failed'
    : invoice.notify_status === 'no_key' ? 'email pending key'
    : null
  const assignedDisplay = invoice.assigned_to_name
    ? `${invoice.assigned_to_name}${notifyLabel ? ` (${notifyLabel})` : ''}`
    : null

  return (
    <Modal open onClose={onClose} title={`Invoice · ${invoice.vendor_name ?? 'Vendor'}`} size="lg">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Detail label="Site" value={invoice.location?.name} />
          <Detail label="Amount" value={currency(invoice.amount)} />
          <Detail label="Invoice date" value={shortDate(invoice.invoice_date)} />
          <Detail label="GL code" value={invoice.gl_code} />
          <Detail label="Submitted by" value={invoice.submitted_by_name} />
          <Detail label="Submitted" value={shortDate(invoice.submitted_at)} />
          <Detail label="Assigned to" value={assignedDisplay} />
          <Detail label="File" value={invoice.file_name} />
        </dl>

        <AttachmentViewer entityType="invoice" entityId={invoice.id} />

        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Status</span>
          <Badge tone={TONE[invoice.status] ?? 'neutral'}>{invoice.status}</Badge>
        </div>

        {invoice.status !== 'pending' ? (
          <div className="rounded-md border border-border bg-content px-3 py-2.5 text-sm">
            <p className="text-ink">
              {invoice.status === 'approved' ? 'Approved' : 'Rejected'} by {invoice.decided_by_name ?? '—'}
              {invoice.decided_at ? ` · ${shortDate(invoice.decided_at)}` : ''}
            </p>
            {invoice.decision_reason && <p className="mt-1 text-ink-muted">{invoice.decision_reason}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <Field label="Assign to">
              {(id) => (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select id={id} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="sm:flex-1">
                    <option value="">— Unassigned —</option>
                    {teammates.map((t) => (
                      <option key={t.id} value={t.id}>{(t.name ?? t.email ?? 'Teammate')} ({t.role})</option>
                    ))}
                  </Select>
                  <Button variant="secondary" disabled={assignBusy || !assigneeId} onClick={assignAndNotify}>
                    {assignBusy ? 'Assigning…' : 'Assign & notify'}
                  </Button>
                </div>
              )}
            </Field>
            {notifyResult && <p className="text-xs text-ink-muted">{notifyResult}</p>}
            <Field label="Reason" hint="Required to reject; optional to approve.">
              {(id) => (
                <textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
              )}
            </Field>
            {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="danger" disabled={busy} onClick={() => decide('rejected')}>Reject</Button>
              <Button disabled={busy} onClick={() => decide('approved')}>Approve</Button>
            </div>
          </div>
        )}
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
