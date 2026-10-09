import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BadgeDollarSign, Loader2, Trash2, Download, CheckCircle2, Send, CornerUpLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { perDiem, type PerDiemRequest } from '@/lib/queries/perDiem'

// Per Diem reimbursement submission (mirrors Corpay's Per Diem expense flow) with
// an Invoice-Approval-style workflow: a user submits a request, it lands in an
// AP-only Requests queue, AP double-checks it and marks it approved, and approved
// requests collect in a Complete tab for CSV export into QuickBooks.
//
// Policy and Category are still PLACEHOLDERS to finalize with AP; Policy will
// ultimately be assigned per person by role. Department and Business Unit are the
// finalized lists from AP.
const POLICIES = ['MW Executive Team', 'MW Regional Managers', 'MW General Managers', 'MW Support Staff']
const CATEGORIES = ['Meals', 'Lodging', 'Travel', 'Incidentals', 'Other']
const DEPARTMENTS = [
  '#19 General Manager', 'AP', 'Admin', 'Directors', 'Exec Team', 'General Managers',
  'IT', 'Maintenance', 'Operations', 'Sales & Marketing',
]
const BUSINESS_UNITS = [
  '01-LBK 82nd', '02 - Odessa Kermit', '03 - Midland Loop 250', '04 - Andrews',
  '05 - LBK 19th St', '06 - Big Spring', '07 - LBK Loop 289', '08 - IBA', '09 - LBK 50th',
  '10 - LBK 80th University', '11 - LBK 114th Quaker', '12 - Midland 4110 North',
  '13 - Midland 1103 And.', '14 - Sweetwater', '15 - Odessa 52nd St.', '16 - Carlsbad Canyon St.',
  '17 - Hobbs Joe Harvey', '18 - Hobbs Bender St', '19 - Hobbs Lube', '20 - IN-BAY', '21 - Lovington',
  '22 - 87th and Evans Odessa', '23 - Carlsbad 1600 Skyline', '24 - Midland Briarwood',
  '25 - Grandview', '26 - Artesia', '27 - Valley Mills', '28 - Robinson', '29 - Killeen',
  '30 - Harker Heights', '31 - 2800 Midland', '33 - Dalhart', '34 - Hereford',
  'Corporate', 'Misc Reimbursement', 'Spotless',
]
const CURRENCIES = ['USD']

// A sensible default policy for the person's role until policies are configured.
function defaultPolicy(role: string | undefined, category: string | null | undefined): string {
  if (category === 'executive' || role === 'owner') return 'MW Executive Team'
  if (category === 'regional_manager') return 'MW Regional Managers'
  return POLICIES[0]
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const today = () => new Date().toISOString().slice(0, 10)

// --- CSV export (Complete tab) ---------------------------------------------
// Labeled columns for now; we'll tailor the exact header set to QuickBooks'
// expected import format once that's nailed down.
const CSV_HEADERS = [
  'Employee', 'Policy', 'Category', 'Department', 'Business Unit',
  'Date', 'Amount', 'Currency', 'Description', 'Submitted', 'Approved By', 'Approved Date',
] as const
const csvEsc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const mdY = (s: string | null) => {
  if (!s) return ''
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US')
}
function perDiemCsv(rows: PerDiemRequest[]): string {
  const lines = rows.map((r) => [
    r.requested_by_name ?? '', r.policy ?? '', r.category ?? '', r.department ?? '', r.business_unit ?? '',
    mdY(r.expense_date), String(Number(r.amount) || 0), r.currency ?? 'USD', r.description ?? '',
    mdY(r.submitted_at), r.approved_by_name ?? '', mdY(r.approved_at),
  ].map(csvEsc).join(','))
  return [CSV_HEADERS.map(csvEsc).join(','), ...lines].join('\r\n') + '\r\n'
}
function downloadCsv(filename: string, text: string) {
  // UTF-8 BOM so Excel reads it as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
function csvFilename(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `PERDIEM-${mm}${now.getFullYear()}-${String(now.getTime()).slice(-6)}.csv`
}

type AdminTab = 'requests' | 'complete'

export default function PerDiemPage() {
  const { profile } = useAuth()
  // AP reviewers: account owners and the finance team. They see every request;
  // everyone else only ever sees their own.
  const isAP = profile?.role === 'owner' || profile?.role_category === 'finance'

  const [policy, setPolicy] = useState(() => defaultPolicy(profile?.role, profile?.role_category))
  const [expenseDate, setExpenseDate] = useState(today)
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [department, setDepartment] = useState('')
  const [businessUnit, setBusinessUnit] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const [rows, setRows] = useState<PerDiemRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<AdminTab>('requests')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await perDiem.list()
    setRows((data as PerDiemRequest[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const resetForm = () => {
    setAmount(''); setDescription(''); setCategory(''); setDepartment(''); setBusinessUnit('')
    setExpenseDate(today())
  }

  const submit = async (status: 'draft' | 'submitted') => {
    setError(null); setSaved(null)
    const amt = Number(amount)
    if (status === 'submitted') {
      if (!policy) return setError('Choose a policy.')
      if (!expenseDate) return setError('Choose a date.')
      if (!(amt > 0)) return setError('Enter a total amount.')
      if (!description.trim()) return setError('Add a description.')
      if (!category || !department || !businessUnit) return setError('Choose a category, department, and business unit.')
    }
    setBusy(true)
    const { error: err } = await perDiem.create({
      account_id: profile?.account_id ?? '',
      requested_by: profile?.id ?? null,
      requested_by_name: profile?.name ?? null,
      policy, expense_date: expenseDate, currency,
      amount: Number.isFinite(amt) ? amt : 0,
      description: description.trim() || null,
      category: category || null, department: department || null, business_unit: businessUnit || null,
      status,
      submitted_at: status === 'submitted' ? new Date().toISOString() : null,
    })
    setBusy(false)
    if (err) return setError(err.message)
    setSaved(status === 'submitted' ? 'Submitted to AP.' : 'Draft saved.')
    resetForm()
    void load()
  }

  // Submit an existing draft (from the My drafts list).
  const submitDraft = async (r: PerDiemRequest) => {
    setBusy(true)
    await perDiem.update(r.id, { status: 'submitted', submitted_at: new Date().toISOString() })
    setBusy(false)
    void load()
  }

  // AP marks a request approved; it moves to the Complete tab.
  const approve = async (r: PerDiemRequest) => {
    setBusy(true)
    await perDiem.update(r.id, {
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: profile?.id ?? null,
      approved_by_name: profile?.name ?? null,
    })
    setBusy(false)
    setOpenId(null)
    void load()
  }

  // AP sends an approved request back to the Requests queue.
  const unapprove = async (r: PerDiemRequest) => {
    setBusy(true)
    await perDiem.update(r.id, { status: 'submitted', approved_at: null, approved_by: null, approved_by_name: null })
    setBusy(false)
    setOpenId(null)
    void load()
  }

  const remove = async (r: PerDiemRequest) => {
    if (!window.confirm('Delete this per diem request? This cannot be undone.')) return
    setBusy(true)
    await perDiem.remove(r.id)
    setBusy(false)
    setOpenId(null)
    void load()
  }

  const myId = profile?.id ?? null
  const myRows = useMemo(() => rows.filter((r) => r.requested_by === myId), [rows, myId])
  const myDrafts = useMemo(() => myRows.filter((r) => r.status === 'draft'), [myRows])
  const submitted = useMemo(() => rows.filter((r) => r.status === 'submitted'), [rows])
  const approved = useMemo(() => rows.filter((r) => r.status === 'approved'), [rows])

  const exportComplete = () => {
    if (approved.length === 0) return
    downloadCsv(csvFilename(), perDiemCsv(approved))
  }

  const openRow = openId ? rows.find((r) => r.id === openId) ?? null : null

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Per Diem"
        subtitle="Submit per diem reimbursement requests to Accounts Payable."
      />

      <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-ink-muted">
        <strong className="text-ink">Early version.</strong> The Policy and Category options are still placeholders — we'll finalize them with AP, and Policy will be set automatically by each person's role.
      </div>

      {/* Submission form */}
      <section className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><BadgeDollarSign className="size-4 text-accent" /> New per diem request</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Employee">
            {(id) => <Input id={id} value={profile?.name ?? ''} readOnly className="bg-content text-ink-muted" />}
          </Field>
          <Field label="Policy" required>
            {(id) => (
              <Select id={id} value={policy} onChange={(e) => setPolicy(e.target.value)}>
                {POLICIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Date" required>
            {(id) => <Input id={id} type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Total amount" required>
              {(id) => <Input id={id} type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />}
            </Field>
            <Field label="Currency">
              {(id) => (
                <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description" required>
              {(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Per diem — regional site visits, Oct 7–9" />}
            </Field>
          </div>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Expense allocations</h3>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Category" required>
              {(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select…</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Department" required>
              {(id) => (
                <Select id={id} value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">Select…</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Business unit" required>
              {(id) => (
                <Select id={id} value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)}>
                  <option value="">Select…</option>
                  {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              )}
            </Field>
          </div>
        </div>

        {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {saved && <p className="mt-4 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">{saved}</p>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void submit('draft')} disabled={busy}>Save draft</Button>
          <Button onClick={() => void submit('submitted')} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Submit to AP
          </Button>
        </div>
      </section>

      {/* My drafts — shown to everyone who has unsent drafts. */}
      {myDrafts.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink">My drafts</h2>
          <RequestTable
            rows={myDrafts}
            loading={false}
            columns={['date', 'policy', 'category', 'amount', 'status']}
            empty="No drafts."
            renderActions={(r) => (
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => void submitDraft(r)} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-content disabled:opacity-50">
                  <Send className="size-3.5" /> Submit
                </button>
                <IconDelete onClick={() => void remove(r)} />
              </div>
            )}
          />
        </section>
      )}

      {/* Non-AP submitters: a read-only view of their own submitted/approved requests. */}
      {!isAP && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink">My requests</h2>
          <RequestTable
            rows={myRows.filter((r) => r.status !== 'draft')}
            loading={loading}
            columns={['date', 'policy', 'category', 'description', 'amount', 'status']}
            empty="You haven't submitted any per diem requests yet."
          />
        </section>
      )}

      {/* AP review workflow. */}
      {isAP && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border">
            <TabButton active={tab === 'requests'} onClick={() => setTab('requests')} label="Requests" count={submitted.length} />
            <TabButton active={tab === 'complete'} onClick={() => setTab('complete')} label="Complete" count={approved.length} />
          </div>

          {tab === 'requests' ? (
            <div className="mt-4">
              <p className="mb-3 text-sm text-ink-muted">Submitted per diem requests awaiting your review. Open one to double-check the entry, then mark it approved.</p>
              <RequestTable
                rows={submitted}
                loading={loading}
                columns={['date', 'employee', 'policy', 'category', 'description', 'amount']}
                empty="No requests waiting for review."
                onRowClick={(r) => setOpenId(r.id)}
              />
            </div>
          ) : (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-muted">Approved per diem requests, ready to export for QuickBooks.</p>
                <Button variant="secondary" onClick={exportComplete} disabled={approved.length === 0}>
                  <Download className="size-4" /> Export to CSV
                </Button>
              </div>
              <RequestTable
                rows={approved}
                loading={loading}
                columns={['date', 'employee', 'policy', 'category', 'amount', 'approvedBy']}
                empty="No approved per diem requests yet."
                onRowClick={(r) => setOpenId(r.id)}
              />
            </div>
          )}
        </section>
      )}

      {/* AP review / detail modal */}
      {isAP && openRow && (
        <ReviewModal
          row={openRow}
          busy={busy}
          onClose={() => setOpenId(null)}
          onApprove={() => void approve(openRow)}
          onUnapprove={() => void unapprove(openRow)}
          onDelete={() => void remove(openRow)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

type Col = 'date' | 'employee' | 'policy' | 'category' | 'description' | 'amount' | 'status' | 'approvedBy'
const COL_LABEL: Record<Col, string> = {
  date: 'Date', employee: 'Employee', policy: 'Policy', category: 'Category',
  description: 'Description', amount: 'Amount', status: 'Status', approvedBy: 'Approved by',
}

function statusBadge(status: string) {
  if (status === 'approved') return <Badge tone="ok">Approved</Badge>
  if (status === 'submitted') return <Badge tone="accent">Submitted</Badge>
  return <Badge tone="neutral">Draft</Badge>
}

function RequestTable({
  rows, loading, columns, empty, onRowClick, renderActions,
}: {
  rows: PerDiemRequest[]
  loading: boolean
  columns: Col[]
  empty: string
  onRowClick?: (r: PerDiemRequest) => void
  renderActions?: (r: PerDiemRequest) => ReactNode
}) {
  const colSpan = columns.length + (renderActions ? 1 : 0)
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            {columns.map((c) => (
              <th key={c} className={cn('px-3 py-2.5 font-medium', c === 'amount' && 'text-right')}>{COL_LABEL[c]}</th>
            ))}
            {renderActions && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-ink-muted">Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-ink-muted">{empty}</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn('border-t border-border hover:bg-content', onRowClick && 'cursor-pointer')}>
              {columns.map((c) => <td key={c} className={cn('px-3 py-2.5', cellClass(c))}>{cell(r, c)}</td>)}
              {renderActions && <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>{renderActions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function cellClass(c: Col): string {
  if (c === 'amount') return 'text-right font-semibold tabular text-ink'
  if (c === 'employee') return 'text-ink'
  return 'text-ink-muted'
}
function cell(r: PerDiemRequest, c: Col): ReactNode {
  switch (c) {
    case 'date': return fmtDate(r.expense_date)
    case 'employee': return r.requested_by_name ?? '—'
    case 'policy': return r.policy ?? '—'
    case 'category': return r.category ?? '—'
    case 'description': return <span className="line-clamp-1 max-w-[260px]">{r.description ?? '—'}</span>
    case 'amount': return usd(Number(r.amount) || 0)
    case 'status': return statusBadge(r.status)
    case 'approvedBy': return r.approved_by_name ?? '—'
  }
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('-mb-px flex items-center gap-2 border-b-2 pb-2 pt-1 text-sm font-medium transition',
        active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
      {label}
      <span className={cn('inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
        active ? 'bg-accent text-white' : 'bg-ink/10 text-ink-muted')}>{count}</span>
    </button>
  )
}

function IconDelete({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Delete"
      className="grid size-8 place-items-center rounded-md border border-border text-danger hover:bg-danger-soft">
      <Trash2 className="size-4" />
    </button>
  )
}

function ReviewModal({
  row, busy, onClose, onApprove, onUnapprove, onDelete,
}: {
  row: PerDiemRequest
  busy: boolean
  onClose: () => void
  onApprove: () => void
  onUnapprove: () => void
  onDelete: () => void
}) {
  const isApproved = row.status === 'approved'
  return (
    <Modal open onClose={onClose} title="Per diem request" size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          {statusBadge(row.status)}
          <span className="text-2xl font-semibold tabular text-ink">{usd(Number(row.amount) || 0)}</span>
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Detail label="Employee" value={row.requested_by_name ?? '—'} />
          <Detail label="Policy" value={row.policy ?? '—'} />
          <Detail label="Date" value={fmtDate(row.expense_date)} />
          <Detail label="Currency" value={row.currency ?? 'USD'} />
          <Detail label="Category" value={row.category ?? '—'} />
          <Detail label="Department" value={row.department ?? '—'} />
          <Detail label="Business unit" value={row.business_unit ?? '—'} />
          <Detail label="Submitted" value={fmtDate(row.submitted_at)} />
          <div className="sm:col-span-2">
            <Detail label="Description" value={row.description ?? '—'} />
          </div>
          {isApproved && (
            <div className="sm:col-span-2">
              <Detail label="Approved" value={`${row.approved_by_name ?? 'AP'} • ${fmtDate(row.approved_at)}`} />
            </div>
          )}
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button variant="ghost" className="text-danger hover:bg-danger-soft" onClick={onDelete} disabled={busy}>
            <Trash2 className="size-4" /> Delete
          </Button>
          <div className="flex gap-2">
            {isApproved ? (
              <Button variant="secondary" onClick={onUnapprove} disabled={busy}>
                <CornerUpLeft className="size-4" /> Move back to Requests
              </Button>
            ) : (
              <Button onClick={onApprove} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Mark approved
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  )
}
