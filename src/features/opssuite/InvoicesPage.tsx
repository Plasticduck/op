import { useMemo, useState, type ReactNode } from 'react'
import { currency, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'

// Email-forwarded payables inbox. Invoices sent to payables@washlyfe.com land
// here and move through the status pipeline below. The forwarding + sorting
// pipeline is wired up separately; this screen is the dashboard it feeds.
const PAYABLES_EMAIL = 'payables@washlyfe.com'

type InvoiceStatus =
  | 'unassigned'
  | 'queue'
  | 'assigned'
  | 'approved'
  | 'exported'
  | 'needs_attention'
  | 'cancelled'

type InvoiceRow = {
  id: string
  vendor: string | null
  sites: string[]
  approvers: string[]
  amount: number
  detail: string | null
  submitted_at: string | null
  status: InvoiceStatus
}

type TabDef = {
  key: InvoiceStatus
  label: string
  subtitle: string
  empty: string
}

const TABS: TabDef[] = [
  {
    key: 'unassigned',
    label: 'Unassigned',
    subtitle: `Invoices emailed to ${PAYABLES_EMAIL}. Open one, set site(s) and approver(s), and add it to the queue.`,
    empty: `No emailed-in invoices waiting. New invoices can be forwarded to ${PAYABLES_EMAIL}`,
  },
  {
    key: 'queue',
    label: 'Queue',
    subtitle: 'Invoices with site(s) and approver(s) set, ready to send for approval.',
    empty: 'Nothing in the queue yet.',
  },
  {
    key: 'assigned',
    label: 'Assigned',
    subtitle: 'Invoices sent to approvers and awaiting their decision.',
    empty: 'No assigned invoices.',
  },
  {
    key: 'approved',
    label: 'Approved',
    subtitle: 'Approved invoices, ready to export to accounting.',
    empty: 'No approved invoices yet.',
  },
  {
    key: 'exported',
    label: 'Exported',
    subtitle: 'Invoices exported to accounting.',
    empty: 'No exported invoices yet.',
  },
  {
    key: 'needs_attention',
    label: 'Needs Attention',
    subtitle: 'Invoices that need a fix before they can move forward.',
    empty: 'Nothing needs attention right now.',
  },
  {
    key: 'cancelled',
    label: 'Cancelled',
    subtitle: 'Invoices that were cancelled.',
    empty: 'No cancelled invoices.',
  },
]

export default function InvoicesPage() {
  const [activeKey, setActiveKey] = useState<InvoiceStatus>('unassigned')
  const [vendorQuery, setVendorQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // No rows until the email pipeline is wired up.
  const [rows] = useState<InvoiceRow[]>([])

  const active = TABS.find((t) => t.key === activeKey) ?? TABS[0]

  const counts = useMemo(() => {
    const c = {} as Record<InvoiceStatus, number>
    for (const t of TABS) c[t.key] = 0
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const inTab = rows.filter((r) => r.status === activeKey)

  const filtered = inTab.filter((r) => {
    if (vendorQuery && !(r.vendor ?? '').toLowerCase().includes(vendorQuery.toLowerCase())) {
      return false
    }
    if (from && (!r.submitted_at || r.submitted_at < from)) return false
    if (to && (!r.submitted_at || r.submitted_at > to)) return false
    return true
  })

  const totalAmount = filtered.reduce((sum, r) => sum + r.amount, 0)
  const clearFilters = () => {
    setVendorQuery('')
    setFrom('')
    setTo('')
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{active.label}</h1>
        <p className="mt-1 text-sm text-ink-muted">{active.subtitle}</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border">
        {TABS.map((t) => {
          const isActive = t.key === activeKey
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveKey(t.key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 pb-2 pt-1 text-sm font-medium transition',
                isActive
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                  t.key === 'needs_attention' && counts[t.key] > 0
                    ? 'bg-danger text-white'
                    : isActive
                      ? 'bg-accent text-white'
                      : 'bg-ink/10 text-ink-muted',
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="In this tab" value={String(filtered.length)} />
        <StatCard label="Total amount" value={currency(totalAmount)} />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 items-end gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
        <FilterField label="Vendor">
          <input
            type="text"
            value={vendorQuery}
            onChange={(e) => setVendorQuery(e.target.value)}
            placeholder="Search vendor..."
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </FilterField>
        <FilterField label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </FilterField>
        <FilterField label="To">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </FilterField>
        <button
          type="button"
          onClick={clearFilters}
          className="h-10 rounded-md border border-border bg-card px-4 text-sm font-medium text-ink-muted transition hover:bg-content hover:text-ink"
        >
          Clear
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Site(s)</th>
              <th className="px-4 py-3 font-medium">Approver(s)</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Detail</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-ink-muted">
                  {active.empty}
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-4 py-3 text-ink-muted">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-ink">{r.vendor ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.sites.length ? r.sites.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.approvers.length ? r.approvers.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink">{currency(r.amount)}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.detail ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.submitted_at ? shortDate(r.submitted_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted">—</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <span className="block h-1 w-8 rounded-full bg-border" />
      <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{value}</p>
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
        {label}
      </label>
      {children}
    </div>
  )
}
