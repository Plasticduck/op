import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, Mail } from 'lucide-react'
import { currency, shortDate } from '@/lib/format'
import { billing, type Account } from '@/lib/queries/billing'
import { cn } from '@/lib/utils'

// Each wash (account) gets its own unique inbound address,
//   <invoice_inbox_token>@invoices.washlyfe.com
// so invoices emailed there file against THAT wash (all of its sites), replacing
// the single shared payables@washlyfe.com. The inbound-email service must be
// configured to accept *@invoices.washlyfe.com and resolve the account from the
// local-part token (see account_for_invoice_token in migration 0050). This
// screen surfaces the address + shows the invoices it produces.
const INVOICE_INBOX_DOMAIN = 'invoices.washlyfe.com'

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
    subtitle: `Invoices emailed to this wash's invoice inbox. Open one, set site(s) and approver(s), and add it to the queue.`,
    empty: 'No emailed-in invoices waiting. Forward vendor invoices to the address above.',
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

  // This wash's unique inbound invoice address.
  const [account, setAccount] = useState<Account | null>(null)
  useEffect(() => {
    billing.account().then(({ data }) => setAccount((data as Account | null) ?? null))
  }, [])
  const inboxEmail = account?.invoice_inbox_token
    ? `${account.invoice_inbox_token}@${INVOICE_INBOX_DOMAIN}`
    : null

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

      {/* This wash's unique invoice inbox address */}
      {inboxEmail && (
        <div className="rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
              <Mail className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">Forward invoices to this wash</div>
              <p className="mt-0.5 text-xs text-ink-muted">
                Unique to {account?.name ?? 'your wash'}. Any invoice emailed to this address files against
                this wash automatically, across all of its sites. Give it to vendors or set up auto-forwarding.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <code className="break-all rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-sm text-ink">
                  {inboxEmail}
                </code>
                <CopyButton value={inboxEmail} />
              </div>
            </div>
          </div>
        </div>
      )}

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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-content"
    >
      {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
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
