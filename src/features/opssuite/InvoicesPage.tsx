import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, Mail, FileText, Send, CheckCircle2, XCircle, FileUp, Ban, Download, CornerUpLeft } from 'lucide-react'
import { currency, shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { billing, type Account } from '@/lib/queries/billing'
import { listUsers, type AccountUser } from '@/lib/queries/account'
import type { CompanySettings } from '@/lib/queries/companySettings'
import { opsInvoices, type OpsInvoice, type OpsInvoiceUpdate } from '@/lib/queries/opsInvoices'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
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
  filePath: string | null
}

const KNOWN_STATUSES = new Set<InvoiceStatus>([
  'unassigned', 'queue', 'assigned', 'approved', 'exported', 'needs_attention', 'cancelled',
])

// Map an ops_invoices row to the table shape. Emailed-in invoices arrive
// 'unassigned' with no site/approver yet; any unrecognized legacy status is
// treated as unassigned so nothing is hidden.
function toRow(r: OpsInvoice, locName: Map<string, string>): InvoiceRow {
  const status = (KNOWN_STATUSES.has(r.status as InvoiceStatus) ? r.status : 'unassigned') as InvoiceStatus
  return {
    id: r.id,
    vendor: r.vendor_name,
    sites: r.location_id ? [locName.get(r.location_id) ?? 'Unknown site'] : [],
    approvers: r.assigned_to_name ? [r.assigned_to_name] : [],
    amount: Number(r.amount) || 0,
    detail: r.email_subject || r.file_name || null,
    submitted_at: r.submitted_at,
    status,
    filePath: r.file_path,
  }
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  unassigned: 'Unassigned', queue: 'Queue', assigned: 'Assigned', approved: 'Approved',
  exported: 'Exported', needs_attention: 'Needs Attention', cancelled: 'Cancelled',
}

const nowIso = () => new Date().toISOString()

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

  const { profile } = useAuth()
  const { locations } = useLocations()

  // Emailed-in invoices, filed by the invoice-inbound pipeline. Live-updates as
  // new mail arrives or an invoice moves through the workflow.
  const [invoices, setInvoices] = useState<OpsInvoice[]>([])
  const [users, setUsers] = useState<AccountUser[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data } = await opsInvoices.list()
      if (active) setInvoices((data as OpsInvoice[] | null) ?? [])
    }
    void load()
    const ch = supabase
      .channel('ops-invoices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops_invoices' }, () => void load())
      .subscribe()
    return () => {
      active = false
      void supabase.removeChannel(ch)
    }
  }, [])

  useEffect(() => {
    void listUsers().then(({ data }) => setUsers((data as AccountUser[] | null) ?? []))
  }, [])

  const locName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  const rows = useMemo(() => invoices.map((inv) => toRow(inv, locName)), [invoices, locName])

  const canManage = profile?.role === 'owner' || profile?.role === 'manager'
  const openInvoice = invoices.find((i) => i.id === openId) ?? null

  const openFile = async (path: string) => {
    const url = await opsInvoices.fileUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  // Apply a workflow transition (or field edit). Realtime reloads the list.
  const act = async (
    id: string,
    patch: OpsInvoiceUpdate,
    opts?: { notify?: boolean; keepOpen?: boolean },
  ) => {
    setBusy(true)
    await opsInvoices.update(id, patch)
    if (opts?.notify) await opsInvoices.notifyAssignment(id)
    setBusy(false)
    if (!opts?.keepOpen) setOpenId(null)
  }

  // This wash's unique inbound invoice address.
  const [account, setAccount] = useState<Account | null>(null)
  useEffect(() => {
    billing.account().then(({ data }) => setAccount((data as Account | null) ?? null))
  }, [])
  // A wash can override the generated inbox with a real mailbox it already
  // receives at (company_settings.invoiceInboxEmail); otherwise fall back to the
  // per-account <token>@invoices.washlyfe.com address.
  const inboxOverride = (account as { company_settings?: CompanySettings | null } | null)
    ?.company_settings?.invoiceInboxEmail?.trim()
  const inboxEmail = inboxOverride
    ? inboxOverride
    : account?.invoice_inbox_token
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
      <div className="rounded-md border border-warn/40 bg-warn-soft px-4 py-2.5 text-center text-sm font-medium text-warn">
        Emailed-in invoices now arrive automatically on the Unassigned tab. The approval workflow (assigning sites and approvers, routing for approval) is still being built.
      </div>
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={clearFilters}
            className="h-10 rounded-md border border-border bg-card px-4 text-sm font-medium text-ink-muted transition hover:bg-content hover:text-ink"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => downloadCsv(active.label, filtered)}
            disabled={filtered.length === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-medium text-ink-muted transition hover:bg-content hover:text-ink disabled:opacity-50"
          >
            <Download className="size-4" /> CSV
          </button>
        </div>
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
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer border-t border-border hover:bg-content">
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
                  <td className="px-4 py-3 text-right">
                    {r.filePath ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void openFile(r.filePath!) }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-content"
                      >
                        <FileText className="size-3.5" /> View
                      </button>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openInvoice && (
        <InvoiceModal
          invoice={openInvoice}
          users={users}
          locName={locName}
          currentUserId={profile?.id ?? null}
          currentUserName={profile?.name ?? ''}
          isOwner={profile?.role === 'owner'}
          canManage={canManage}
          busy={busy}
          onClose={() => setOpenId(null)}
          onFile={openFile}
          act={act}
        />
      )}
    </div>
  )
}

// ---- Workflow modal --------------------------------------------------------

function InvoiceModal({
  invoice, users, locName, currentUserId, currentUserName, isOwner, canManage, busy, onClose, onFile, act,
}: {
  invoice: OpsInvoice
  users: AccountUser[]
  locName: Map<string, string>
  currentUserId: string | null
  currentUserName: string
  isOwner: boolean
  canManage: boolean
  busy: boolean
  onClose: () => void
  onFile: (path: string) => void
  act: (id: string, patch: OpsInvoiceUpdate, opts?: { notify?: boolean; keepOpen?: boolean }) => Promise<void>
}) {
  const [vendor, setVendor] = useState(invoice.vendor_name ?? '')
  const [amount, setAmount] = useState(String(invoice.amount ?? ''))
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoice_date ?? '')
  const [gl, setGl] = useState(invoice.gl_code ?? '')
  const [siteId, setSiteId] = useState(invoice.location_id ?? '')
  const [approverId, setApproverId] = useState(invoice.assigned_to ?? '')
  const [reason, setReason] = useState('')

  const status = (KNOWN_STATUSES.has(invoice.status as InvoiceStatus) ? invoice.status : 'unassigned') as InvoiceStatus
  const editable = canManage && (status === 'unassigned' || status === 'queue' || status === 'needs_attention')
  const approvers = users.filter((u) => u.role === 'owner' || u.role === 'manager')
  const canApprove = status === 'assigned' && (isOwner || invoice.assigned_to === currentUserId)
  // Site + GL code are required, and the approver can correct them while
  // reviewing (not just the manager during assignment).
  const siteGlEditable = editable || canApprove
  const missingRequired = !siteId || !gl.trim()
  const id = invoice.id

  const fieldPatch = (): OpsInvoiceUpdate => ({
    vendor_name: vendor.trim() || null,
    amount: Number(amount) || 0,
    invoice_date: invoiceDate || null,
    gl_code: gl.trim() || null,
    location_id: siteId || null,
  })
  const approverName = (uid: string) => users.find((u) => u.id === uid)?.name ?? null

  return (
    <Modal open onClose={onClose} title="Invoice" size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill status={status} />
          {invoice.file_path && (
            <Button variant="secondary" size="sm" onClick={() => onFile(invoice.file_path!)}>
              <FileText className="size-4" /> View file{invoice.file_name ? ` (${invoice.file_name})` : ''}
            </Button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor">
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Amount">
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Invoice date">
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={!editable} />
          </Field>
          <Field label="GL code" required>
            <Input value={gl} onChange={(e) => setGl(e.target.value)} disabled={!siteGlEditable} placeholder="Required" invalid={siteGlEditable && !gl.trim()} />
          </Field>
          <Field label="Site" required>
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!siteGlEditable} invalid={siteGlEditable && !siteId}>
              <option value="">Select a site...</option>
              {[...locName.entries()].map(([lid, name]) => (
                <option key={lid} value={lid}>{name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Approver">
            <Select value={approverId} onChange={(e) => setApproverId(e.target.value)} disabled={!editable}>
              <option value="">Select an approver...</option>
              {approvers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        {invoice.email_from && (
          <p className="text-xs text-ink-subtle">
            Emailed in from {invoice.email_from}{invoice.email_subject ? ` — "${invoice.email_subject}"` : ''}.
          </p>
        )}

        {status === 'needs_attention' && invoice.decision_reason && (
          <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            Sent back by {invoice.decided_by_name ?? 'an approver'}: {invoice.decision_reason}
          </div>
        )}
        {status === 'assigned' && (
          <p className="text-sm text-ink-muted">
            Waiting on <span className="font-medium text-ink">{invoice.assigned_to_name ?? 'the approver'}</span>.
          </p>
        )}
        {status === 'approved' && (
          <p className="text-sm text-ok">Approved by {invoice.decided_by_name ?? 'an approver'}. Ready to export.</p>
        )}
        {status === 'exported' && (
          <p className="text-sm text-ink-muted">Exported by {invoice.exported_by_name ?? 'a teammate'}{invoice.exported_at ? ` on ${shortDate(invoice.exported_at)}` : ''}.</p>
        )}

        {canApprove && (
          <Field label="Rejection reason (if sending back)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it needs a fix..." />
          </Field>
        )}

        {siteGlEditable && missingRequired && (
          <p className="text-xs text-danger">Site and GL code are required before this invoice can move forward.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            {canManage && status !== 'exported' && status !== 'cancelled' && (
              <Button variant="ghost" size="sm" className="text-danger" disabled={busy} onClick={() => void act(id, { status: 'cancelled' })}>
                <Ban className="size-4" /> Cancel invoice
              </Button>
            )}
            {editable && (status === 'queue' || status === 'needs_attention') && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(id, { ...fieldPatch(), status: 'unassigned', assigned_to: null, assigned_to_name: null })}>
                <CornerUpLeft className="size-4" /> Back to unassigned
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>Close</Button>

            {(editable || canApprove) && (
              <Button variant="secondary" disabled={busy} onClick={() => void act(id, editable ? { ...fieldPatch(), assigned_to: approverId || null, assigned_to_name: approverId ? approverName(approverId) : null } : { location_id: siteId || null, gl_code: gl.trim() || null }, { keepOpen: true })}>
                Save
              </Button>
            )}
            {canManage && (status === 'unassigned' || status === 'needs_attention') && (
              <Button
                disabled={busy || missingRequired || !approverId}
                onClick={() => void act(id, { ...fieldPatch(), assigned_to: approverId, assigned_to_name: approverName(approverId), status: 'queue' })}
              >
                Add to queue
              </Button>
            )}
            {canManage && status === 'queue' && (
              <Button disabled={busy || missingRequired || !approverId} onClick={() => void act(id, { ...fieldPatch(), assigned_to: approverId, assigned_to_name: approverName(approverId), status: 'assigned', assigned_at: nowIso() }, { notify: true })}>
                <Send className="size-4" /> Send for approval
              </Button>
            )}
            {canApprove && (
              <>
                <Button variant="secondary" className="text-danger" disabled={busy || !reason.trim()} onClick={() => void act(id, { location_id: siteId || null, gl_code: gl.trim() || null, status: 'needs_attention', decided_by: currentUserId, decided_by_name: currentUserName, decided_at: nowIso(), decision_reason: reason.trim() })}>
                  <XCircle className="size-4" /> Send back
                </Button>
                <Button disabled={busy || missingRequired} onClick={() => void act(id, { location_id: siteId || null, gl_code: gl.trim() || null, status: 'approved', decided_by: currentUserId, decided_by_name: currentUserName, decided_at: nowIso(), decision_reason: null })}>
                  <CheckCircle2 className="size-4" /> Approve
                </Button>
              </>
            )}
            {canManage && status === 'approved' && (
              <Button disabled={busy} onClick={() => void act(id, { status: 'exported', exported_by: currentUserId, exported_by_name: currentUserName, exported_at: nowIso() })}>
                <FileUp className="size-4" /> Export to accounting
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-ink-muted">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  )
}

function StatusPill({ status }: { status: InvoiceStatus }) {
  const tone =
    status === 'approved' || status === 'exported' ? 'bg-ok-soft text-ok'
      : status === 'needs_attention' || status === 'cancelled' ? 'bg-danger-soft text-danger'
        : status === 'assigned' ? 'bg-accent-soft text-accent'
          : 'bg-ink/10 text-ink-muted'
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', tone)}>{STATUS_LABEL[status]}</span>
}

// Download the current tab's rows as a CSV for accounting.
function downloadCsv(tabLabel: string, rows: InvoiceRow[]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const header = ['Vendor', 'Site(s)', 'Approver(s)', 'Amount', 'Detail', 'Submitted', 'Status']
  const lines = rows.map((r) => [
    r.vendor ?? '', r.sites.join('; '), r.approvers.join('; '), r.amount,
    r.detail ?? '', r.submitted_at ? shortDate(r.submitted_at) : '', STATUS_LABEL[r.status],
  ].map(esc).join(','))
  const csv = [header.map(esc).join(','), ...lines].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `invoices-${tabLabel.toLowerCase().replace(/\s+/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
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
