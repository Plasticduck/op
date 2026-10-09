import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, Loader2, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { perDiem, type PerDiemRequest } from '@/lib/queries/perDiem'

// Per Diem reimbursement submission (mirrors Corpay's Per Diem expense flow). These
// option lists are PLACEHOLDERS until the real ones are finalized with AP; Policy
// will ultimately be assigned per person by role.
const POLICIES = ['MW Executive Team', 'MW Regional Managers', 'MW General Managers', 'MW Support Staff']
const CATEGORIES = ['Meals', 'Lodging', 'Travel', 'Incidentals', 'Other']
const DEPARTMENTS = ['Operations', 'Corporate', 'Marketing', 'Maintenance', 'Lube Shop']
const BUSINESS_UNITS = ['Mighty Wash', 'FlexWash', 'Lube Shop', 'Spotless']
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

export default function PerDiemPage() {
  const { profile } = useAuth()
  const isOwner = profile?.role === 'owner'

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
  const [view, setView] = useState<'mine' | 'all'>('mine')

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

  const remove = async (r: PerDiemRequest) => {
    if (!window.confirm('Delete this per diem request?')) return
    await perDiem.remove(r.id)
    void load()
  }

  const visibleRows = useMemo(
    () => (isOwner && view === 'all' ? rows : rows.filter((r) => r.requested_by === profile?.id)),
    [rows, isOwner, view, profile?.id],
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Per Diem"
        subtitle="Submit per diem reimbursement requests to Accounts Payable."
      />

      <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-ink-muted">
        <strong className="text-ink">Early version.</strong> The Policy, Category, Department, and Business Unit options are placeholders — we'll finalize them with AP, and Policy will be set automatically by each person's role.
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
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit to AP
          </Button>
        </div>
      </section>

      {/* Submissions list */}
      <section className="mt-6">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{isOwner && view === 'all' ? 'All per diem requests' : 'My per diem requests'}</h2>
          {isOwner && (
            <div className="flex rounded-md border border-border p-0.5">
              {(['mine', 'all'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={cn('rounded px-2.5 py-0.5 text-xs font-medium capitalize transition', view === v ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink')}>
                  {v === 'mine' ? 'Mine' : 'All'}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Date</th>
                {isOwner && view === 'all' && <th className="px-3 py-2.5 font-medium">Employee</th>}
                <th className="px-3 py-2.5 font-medium">Policy</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Description</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-ink-muted">Loading…</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-ink-muted">No per diem requests yet.</td></tr>
              ) : visibleRows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 text-ink-muted">{fmtDate(r.expense_date)}</td>
                  {isOwner && view === 'all' && <td className="px-3 py-2.5 text-ink">{r.requested_by_name ?? '—'}</td>}
                  <td className="px-3 py-2.5 text-ink-muted">{r.policy ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.category ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted"><span className="line-clamp-1 max-w-[260px]">{r.description ?? '—'}</span></td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular text-ink">{usd(Number(r.amount) || 0)}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={r.status === 'submitted' ? 'accent' : 'neutral'}>{r.status === 'submitted' ? 'Submitted' : 'Draft'}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.requested_by === profile?.id && (
                      <button type="button" onClick={() => void remove(r)} title="Delete"
                        className="grid size-8 place-items-center rounded-md border border-border text-danger hover:bg-danger-soft">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
