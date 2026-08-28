import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Mail, FileText, Send, CheckCircle2, XCircle, Download, CornerUpLeft, TriangleAlert, ChevronDown, Trash2, RotateCcw, ShieldCheck } from 'lucide-react'
import { currency, shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { billing, type Account } from '@/lib/queries/billing'
import { listUsers, type AccountUser } from '@/lib/queries/account'
import type { CompanySettings } from '@/lib/queries/companySettings'
import { opsInvoices, type OpsInvoice, type OpsInvoiceUpdate } from '@/lib/queries/opsInvoices'
import { invoiceVendors } from '@/lib/queries/invoiceVendors'
import { invoiceGlCodes } from '@/lib/queries/invoiceGlCodes'
import { invoiceClasses } from '@/lib/queries/invoiceClasses'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

// Each wash (account) gets its own unique inbound address,
//   <invoice_inbox_token>@invoices.washlyfe.com
// so invoices emailed there file against THAT wash (all of its sites), replacing
// the single shared payables@washlyfe.com. The inbound-email service must be
// configured to accept *@invoices.washlyfe.com and resolve the account from the
// local-part token (see account_for_invoice_token in migration 0050). This
// screen surfaces the address + shows the invoices it produces.
const INVOICE_INBOX_DOMAIN = 'invoices.washlyfe.com'

// The approver dropdown is restricted to MW's official "Invoice Approvers List"
// (matched by email, case-insensitive). Anyone not on this list is hidden even
// if they're an owner/manager. People on the list who don't yet have a login
// simply won't appear until their account exists. Accounts with no matching
// user (e.g. non-MW washes, demo) fall back to all owners/managers so the
// dropdown is never empty. (Staci Wyatt is staci@mymightywash.com per the list;
// her account email must match this for her to appear.)
const INVOICE_APPROVER_EMAILS = new Set([
  'berhl@mighty-wash.com', 'hmurry@mighty-wash.com', 'kstaton@mighty-wash.com',
  'ernest@mighty-wash.com', 'justin.gamboa@mighty-wash.com', 'mcanales@mighty-wash.com',
  'rbreed@mighty-wash.com', 'lester@mighty-wash.com', 'isabel@mighty-wash.com',
  'djones@mighty-wash.com', 'josh.roberts@mighty-wash.com', 'kellyspiller@mighty-wash.com',
  'gwatson@mighty-wash.com', 'shelbi@mighty-wash.com', 'kjowers@mighty-wash.com',
  'ncarter@mighty-wash.com', 'staci@mymightywash.com',
  'kwatson@mighty-wash.com', 'debra@mighty-wash.com',
])

// Invoice-approval tab access is scoped to the Mighty Wash account. Within MW,
// only these people see every tab; everyone else who can reach the page is an
// "approver" and sees just their own Assigned tab + Invoice History. Other
// accounts keep the default (owners/managers see every tab).
const MW_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
// Kevan's manager login (kjowers@mighty-wash.com) is intentionally NOT here: it's
// a restricted approver. His owner login (kevan@washlyfe.com) keeps full access.
const INVOICE_FULL_ACCESS_EMAILS = new Set([
  'kevan@washlyfe.com', 'hmurry@mighty-wash.com',
  'epineda@mighty-wash.com', 'becca.jowers@mighty-wash.com', 'rhipp@mighty-wash.com',
  'mikala@mighty-wash.com',
])

type InvoiceStatus =
  | 'unassigned'
  | 'assigned'
  | 'approved'
  | 'exported'
  | 'needs_attention'

type InvoiceRow = {
  id: string
  vendor: string | null
  sites: string[]
  approvers: string[]
  amount: number
  detail: string | null
  dueDate: string | null
  submitted_at: string | null
  status: InvoiceStatus
  filePath: string | null
  duplicateOf: string | null
  sentBack: boolean
  secondaryPending: boolean
}

const KNOWN_STATUSES = new Set<InvoiceStatus>([
  'unassigned', 'assigned', 'approved', 'exported', 'needs_attention',
])

// Map an ops_invoices row to the table shape. Emailed-in invoices arrive
// 'unassigned' with no site/approver yet; any unrecognized legacy status is
// treated as unassigned so nothing is hidden.
function toRow(r: OpsInvoice, locName: Map<string, string>): InvoiceRow {
  const status = (KNOWN_STATUSES.has(r.status as InvoiceStatus) ? r.status : 'unassigned') as InvoiceStatus
  // Sites are QuickBooks classes (class_names). Fall back to legacy location
  // names for older rows.
  const legacyIds = r.location_ids?.length ? r.location_ids : (r.location_id ? [r.location_id] : [])
  const siteLabels = r.class_names?.length ? r.class_names : legacyIds.map((sid) => locName.get(sid) ?? 'Unknown site')
  const approverNames = r.approver_names?.length ? r.approver_names : (r.assigned_to_name ? [r.assigned_to_name] : [])
  return {
    id: r.id,
    vendor: r.vendor_name,
    sites: siteLabels,
    approvers: approverNames,
    amount: Number(r.amount) || 0,
    // A trailing '*' on the invoice number flags an "Ask My Accountant" GL code.
    detail: r.invoice_number
      ? r.invoice_number + (usesAskAccountant(r) ? '*' : '')
      : (r.email_subject || r.file_name || null),
    dueDate: r.due_date,
    submitted_at: r.submitted_at,
    status,
    filePath: r.file_path,
    duplicateOf: r.duplicate_of,
    // Show the "Sent Back for Approval" label while it's waiting to be (re)assigned
    // or is back with the approver.
    sentBack: !!r.resubmit_note && (status === 'assigned' || status === 'unassigned'),
    // Waiting on the second-level approver after the first approval.
    secondaryPending: !!r.awaiting_secondary && status === 'assigned',
  }
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  unassigned: 'Unassigned', assigned: 'Assigned', approved: 'Approved',
  exported: 'Exported', needs_attention: 'Needs Attention',
}

const nowIso = () => new Date().toISOString()

// 'history' is a read-only archive spanning multiple statuses, not a real status.
type TabKey = InvoiceStatus | 'history'

type TabDef = {
  key: TabKey
  label: string
  subtitle: string
  empty: string
}

// Statuses that count as "approved and submitted" for the Invoice History tab.
const HISTORY_STATUSES = new Set<InvoiceStatus>(['approved', 'exported'])

const TABS: TabDef[] = [
  {
    key: 'unassigned',
    label: 'Unassigned',
    subtitle: `Invoices emailed to this wash's invoice inbox. Open one, choose the approver, and send it straight to them for approval. The approver applies the site and GL code.`,
    empty: 'No emailed-in invoices waiting. Forward vendor invoices to the address above.',
  },
  {
    key: 'assigned',
    label: 'Assigned',
    subtitle: 'Invoices sent to approvers and awaiting their decision.',
    empty: 'No assigned invoices.',
  },
  {
    key: 'needs_attention',
    label: 'Needs Attention',
    subtitle: 'Invoices that need a fix before they can move forward.',
    empty: 'Nothing needs attention right now.',
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
    key: 'history',
    label: 'Invoice History',
    subtitle: 'A record of the invoices you approved, kept for future reference.',
    empty: 'No approved invoices yet.',
  },
]

export default function InvoicesPage() {
  const [activeKey, setActiveKey] = useState<TabKey>('unassigned')
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
  const [warnOpen, setWarnOpen] = useState(false)
  // Approved tab: invoices ticked for export. Cleared whenever the tab changes.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  useEffect(() => { setSelectedIds(new Set()) }, [activeKey])

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

  const [vendorNames, setVendorNames] = useState<string[]>([])
  useEffect(() => {
    void invoiceVendors.list().then(({ data }) => setVendorNames(((data as { name: string }[] | null) ?? []).map((v) => v.name)))
  }, [])

  const [glCodes, setGlCodes] = useState<string[]>([])
  useEffect(() => {
    void invoiceGlCodes.list().then(({ data }) => setGlCodes(((data as { code: string }[] | null) ?? []).map((g) => g.code)))
  }, [])

  const [classes, setClasses] = useState<string[]>([])
  useEffect(() => {
    void invoiceClasses.list().then(({ data }) => setClasses(((data as { class: string }[] | null) ?? []).map((c) => c.class)))
  }, [])

  const locName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  const rows = useMemo(() => invoices.map((inv) => toRow(inv, locName)), [invoices, locName])

  const canManage = profile?.role === 'owner' || profile?.role === 'manager'
  const openInvoice = invoices.find((i) => i.id === openId) ?? null

  // Tab access. In the MW account only the full-access list sees every tab;
  // everyone else is a restricted approver limited to Assigned + Invoice History,
  // each scoped to invoices that are theirs. Other accounts are unaffected.
  const currentUserId = profile?.id ?? null
  const fullAccess = profile?.account_id !== MW_ACCOUNT_ID
    || INVOICE_FULL_ACCESS_EMAILS.has((profile?.email ?? '').toLowerCase())
  // Invoice History is an approver-only tab: full-access users (who assign and see
  // every workflow tab) don't get it.
  const visibleTabs = fullAccess
    ? TABS.filter((t) => t.key !== 'history')
    : TABS.filter((t) => t.key === 'assigned' || t.key === 'history')
  const myIds = useMemo(() => {
    const s = new Set<string>()
    if (!currentUserId) return s
    for (const i of invoices) {
      if ((i.approver_ids ?? []).includes(currentUserId)
        || (i.secondary_approver_ids ?? []).includes(currentUserId)
        || i.assigned_to === currentUserId
        || i.decided_by === currentUserId) s.add(i.id)
    }
    return s
  }, [invoices, currentUserId])

  // Fall back to the first visible tab when the stored key is hidden for this
  // user (e.g. a restricted approver whose default would be Unassigned).
  const activeKeyEff: TabKey = visibleTabs.some((t) => t.key === activeKey) ? activeKey : (visibleTabs[0]?.key ?? 'assigned')

  const openFile = async (path: string) => {
    const url = await opsInvoices.fileUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  // Force a download of the attachment (signed URL carries a Content-Disposition
  // attachment header, so the anchor click saves the file rather than navigating).
  const downloadFile = async (path: string) => {
    const url = await opsInvoices.downloadUrl(path)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener'
    a.click()
  }

  // Apply a workflow transition (or field edit). Realtime reloads the list.
  // Approvers are no longer emailed on assignment: a single daily digest
  // (daily-approver-digest, 5pm Central) summarizes everything assigned to them.
  const act = async (
    id: string,
    patch: OpsInvoiceUpdate,
    opts?: { keepOpen?: boolean },
  ) => {
    setBusy(true)
    await opsInvoices.update(id, patch)
    setBusy(false)
    if (!opts?.keepOpen) setOpenId(null)
  }

  // Hard-delete (Needs Attention > Delete Invoice). Realtime removes the row.
  const del = async (invId: string, filePath: string | null) => {
    setBusy(true)
    await opsInvoices.remove(invId, filePath)
    setBusy(false)
    setOpenId(null)
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

  const active = TABS.find((t) => t.key === activeKeyEff) ?? TABS[0]

  // Restricted approvers only ever count/see invoices that are theirs.
  const scoped = (list: typeof rows) => (fullAccess ? list : list.filter((r) => myIds.has(r.id)))

  const counts = useMemo(() => {
    const c = {} as Record<TabKey, number>
    for (const t of TABS) c[t.key] = 0
    for (const r of rows) {
      if (!fullAccess && !myIds.has(r.id)) continue
      c[r.status] = (c[r.status] ?? 0) + 1
      if (HISTORY_STATUSES.has(r.status)) c.history += 1
    }
    return c
  }, [rows, fullAccess, myIds])

  const inTab = scoped(rows.filter((r) => (activeKeyEff === 'history' ? HISTORY_STATUSES.has(r.status) : r.status === activeKeyEff)))

  const filtered = inTab.filter((r) => {
    if (vendorQuery && !(r.vendor ?? '').toLowerCase().includes(vendorQuery.toLowerCase())) {
      return false
    }
    if (from && (!r.submitted_at || r.submitted_at < from)) return false
    if (to && (!r.submitted_at || r.submitted_at > to)) return false
    return true
  })

  const totalAmount = filtered.reduce((sum, r) => sum + r.amount, 0)
  // Local YYYY-MM-DD for flagging past-due invoices in the Unassigned tab.
  const todayStr = new Date().toLocaleDateString('en-CA')
  const clearFilters = () => {
    setVendorQuery('')
    setFrom('')
    setTo('')
  }

  // Full invoice rows behind the currently-shown (filtered) tab rows.
  const filteredInvoices = filtered
    .map((r) => invoices.find((i) => i.id === r.id))
    .filter((i): i is OpsInvoice => Boolean(i))

  // Per-invoice export selection, shown on the Exported tab so a user can
  // re-download specific invoices (despite the duplicate-export warning).
  // Selecting none is treated as "all shown" so the button always does something.
  const selectable = activeKeyEff === 'exported'
  const allSelected = selectable && filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filtered.map((r) => r.id)))
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // Approved tab: download the QuickBooks CSV for the shown approved invoices,
  // then mark them exported so they move to the Exported tab.
  const exportApproved = async () => {
    if (filteredInvoices.length === 0) return
    // Memo is now captured while the invoice is unassigned (required before it can
    // be sent for approval), so approved invoices already carry one.
    downloadCsv(qbFilename(), quickbooksCsv(filteredInvoices))
    const ids = filteredInvoices.map((i) => i.id)
    const idSet = new Set(ids)
    const at = nowIso()
    setBusy(true)
    await opsInvoices.updateMany(ids, {
      status: 'exported', exported_at: at, exported_by: profile?.id ?? null, exported_by_name: profile?.name ?? null,
    })
    // Reflect immediately so the batch leaves Approved for Exported without
    // waiting on the realtime round-trip.
    setInvoices((prev) => prev.map((i) => idSet.has(i.id)
      ? { ...i, status: 'exported', exported_at: at, exported_by: profile?.id ?? null, exported_by_name: profile?.name ?? null }
      : i))
    setSelectedIds(new Set())
    setBusy(false)
  }

  // Exported tab: re-download the CSV for the ticked invoices (all shown when
  // none are ticked), after the double-entry warning.
  const downloadExported = () => {
    setWarnOpen(false)
    const toExport = selectedIds.size ? filteredInvoices.filter((i) => selectedIds.has(i.id)) : filteredInvoices
    if (toExport.length === 0) return
    downloadCsv(qbFilename(), quickbooksCsv(toExport))
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Invoice Approval</h1>
        <p className="mt-1 text-sm text-ink-muted">{active.subtitle}</p>
      </div>

      {/* This wash's unique invoice inbox address (intake, hidden from approvers) */}
      {fullAccess && inboxEmail && (
        <div className="rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
              <Mail className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">Forward invoices to this email</div>
              <p className="mt-0.5 text-xs text-ink-muted">
                Unique to {account?.name ?? 'your wash'}. Any invoice emailed to this address files against
                this wash automatically, across all of its sites.
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
        {visibleTabs.map((t) => {
          const isActive = t.key === activeKeyEff
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
          {activeKeyEff === 'approved' && canManage && (
            <button
              type="button"
              onClick={() => void exportApproved()}
              disabled={filtered.length === 0 || busy}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
            >
              <Download className="size-4" /> {selectedIds.size ? `Export ${selectedIds.size} to CSV` : 'Export to CSV'}
            </button>
          )}
          {activeKeyEff === 'exported' && (
            <button
              type="button"
              onClick={() => setWarnOpen(true)}
              disabled={filtered.length === 0}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-medium text-ink-muted transition hover:bg-content hover:text-ink disabled:opacity-50"
            >
              <Download className="size-4" /> {selectedIds.size ? `Export ${selectedIds.size}` : 'Export CSV'}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              {selectable && (
                <th className="px-4 py-3 font-medium">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all invoices"
                    className="size-4 cursor-pointer accent-accent"
                  />
                </th>
              )}
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Site(s)</th>
              <th className="px-4 py-3 font-medium">Approver(s)</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              {activeKeyEff === 'unassigned' && <th className="px-4 py-3 font-medium">Due date</th>}
              <th className="px-4 py-3 font-medium">Detail</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8 + (activeKeyEff === 'unassigned' ? 1 : 0) + (selectable ? 1 : 0)} className="px-4 py-8 text-center text-sm text-ink-muted">
                  {active.empty}
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer border-t border-border hover:bg-content">
                  {selectable && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        aria-label={`Select ${r.vendor ?? 'invoice'}`}
                        className="size-4 cursor-pointer accent-accent"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-ink-muted">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-ink">
                    <div className="flex items-center gap-2">
                      <span>{r.vendor ?? '—'}</span>
                      {r.sentBack && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                          <RotateCcw className="size-3" /> Sent Back for Approval
                        </span>
                      )}
                      {r.secondaryPending && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                          <ShieldCheck className="size-3" /> Secondary approval required
                        </span>
                      )}
                      {r.duplicateOf && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
                          <TriangleAlert className="size-3" /> Duplicate
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.sites.length ? r.sites.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.approvers.length ? r.approvers.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink">{currency(r.amount)}</td>
                  {activeKeyEff === 'unassigned' && (
                    <td className={cn('px-4 py-3 whitespace-nowrap', r.dueDate && r.dueDate < todayStr ? 'font-medium text-danger' : 'text-ink-muted')}>
                      {r.dueDate ? new Date(r.dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-ink-muted">{r.detail ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.submitted_at ? shortDate(r.submitted_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.filePath ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void openFile(r.filePath!) }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-content"
                        >
                          <FileText className="size-3.5" /> View
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void downloadFile(r.filePath!) }}
                          title="Download attachment"
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-content"
                        >
                          <Download className="size-3.5" /> Download
                        </button>
                      </div>
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
          duplicateOfInvoice={openInvoice.duplicate_of ? (invoices.find((i) => i.id === openInvoice.duplicate_of) ?? null) : null}
          users={users}
          vendors={vendorNames}
          glCodes={glCodes}
          classes={classes}
          currentUserId={profile?.id ?? null}
          currentUserName={profile?.name ?? ''}
          isOwner={profile?.role === 'owner'}
          canManage={canManage}
          isDeleteAdmin={(profile?.email ?? '').toLowerCase() === 'kevan@washlyfe.com'}
          busy={busy}
          onClose={() => setOpenId(null)}
          onFile={openFile}
          onDownload={downloadFile}
          act={act}
          onDelete={del}
        />
      )}

      {warnOpen && (
        <Modal open onClose={() => setWarnOpen(false)} title="Already exported">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-md border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm text-warn">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" />
              <p>
                {(() => { const n = selectedIds.size || filteredInvoices.length; return `These ${n} invoice${n === 1 ? ' has' : 's have'}` })()} already been exported to accounting. Re-importing this file may create <span className="font-semibold">duplicate bill entries</span> in QuickBooks. Only download another copy if you are sure.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setWarnOpen(false)}>Cancel</Button>
              <Button onClick={downloadExported}><Download className="size-4" /> Export anyway</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ---- Workflow modal --------------------------------------------------------

function InvoiceModal({
  invoice, duplicateOfInvoice, users, vendors, glCodes, classes, currentUserId, currentUserName, isOwner, canManage, isDeleteAdmin, busy, onClose, onFile, onDownload, act, onDelete,
}: {
  invoice: OpsInvoice
  duplicateOfInvoice: OpsInvoice | null
  users: AccountUser[]
  vendors: string[]
  glCodes: string[]
  classes: string[]
  currentUserId: string | null
  currentUserName: string
  isOwner: boolean
  canManage: boolean
  isDeleteAdmin: boolean
  busy: boolean
  onClose: () => void
  onFile: (path: string) => void
  onDownload: (path: string) => void
  act: (id: string, patch: OpsInvoiceUpdate, opts?: { keepOpen?: boolean }) => Promise<void>
  onDelete: (id: string, filePath: string | null) => Promise<void>
}) {
  const status = (KNOWN_STATUSES.has(invoice.status as InvoiceStatus) ? invoice.status : 'unassigned') as InvoiceStatus
  const editable = canManage && (status === 'unassigned' || status === 'needs_attention')
  // Restrict to the official approver list; fall back to owners/managers when no
  // listed user exists on this account (non-MW washes, demo) so it's never empty.
  const listedApprovers = users.filter((u) => u.email && INVOICE_APPROVER_EMAILS.has(u.email.toLowerCase()))
  const approverUsers = listedApprovers.length ? listedApprovers : users.filter((u) => u.role === 'owner' || u.role === 'manager')

  // Sites are QuickBooks classes (from the Class List), stored on class_names.
  const initClasses = invoice.class_names?.length ? invoice.class_names : []
  const initApprovers = invoice.approver_ids?.length ? invoice.approver_ids : (invoice.assigned_to ? [invoice.assigned_to] : [])

  const [vendor, setVendor] = useState(invoice.vendor_name ?? '')
  const [amount, setAmount] = useState(String(invoice.amount ?? ''))
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoice_date ?? '')
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoice_number ?? '')
  // Default the due date to 30 days after the invoice date (which is auto-filled),
  // unless one was already set.
  const [dueDate, setDueDate] = useState(
    invoice.due_date ?? (invoice.invoice_date ? addDays(invoice.invoice_date, 30) : ''),
  )
  // GL is applied by the approver, who can split across multiple GL codes.
  const initGl = ((invoice.gl_allocations as GlAlloc[] | null) ?? [])
  const [glList, setGlList] = useState<string[]>(
    initGl.length ? initGl.map((g) => g.gl_code) : (invoice.gl_code ? [invoice.gl_code] : []),
  )
  const [glAlloc, setGlAlloc] = useState<Record<string, string>>(
    Object.fromEntries(initGl.map((g) => [g.gl_code, String(g.amount)])),
  )
  const setGlSelection = (next: string[]) => {
    setGlList(next)
    setGlAlloc((p) => {
      const m = { ...p }
      for (const k of Object.keys(m)) if (!next.includes(k)) delete m[k]
      return m
    })
  }
  const [siteClasses, setSiteClasses] = useState<string[]>(initClasses)
  const [approverIds, setApproverIds] = useState<string[]>(initApprovers)
  const [reason, setReason] = useState('')
  // The approver must open and view the invoice file before approving.
  const [viewed, setViewed] = useState(false)
  // Manager's note when returning a Needs-Attention invoice to Unassigned, plus
  // a two-step guard for the hard delete.
  const [resubmitNote, setResubmitNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Mandatory memo, entered while the invoice is still unassigned and required
  // before it can be sent for approval. Flows into the QuickBooks Memo column.
  const [memo, setMemo] = useState(invoice.memo ?? '')
  // Optional second-level approver, named by accounting while unassigned.
  const [secondaryApproverIds, setSecondaryApproverIds] = useState<string[]>(invoice.secondary_approver_ids ?? [])

  // Any assigned approver (or an owner) can approve; the first to do so
  // finalizes it and enters the per-site split.
  const canApprove = status === 'assigned' && (isOwner || initApprovers.includes(currentUserId ?? ''))
  // Two-level approval: when a secondary approver was named, the first approval
  // hands off to them (awaiting_secondary) instead of finalizing.
  const hasSecondary = (invoice.secondary_approver_ids?.length ?? 0) > 0
  const atSecondaryStage = !!invoice.awaiting_secondary
  const forwardToSecondary = hasSecondary && !atSecondaryStage
  // Sites are editable during assignment and by the approver at review, required
  // at the approver stage. GL is now approver-only (the manager no longer sets it).
  const siteGlEditable = editable || canApprove
  const requireSiteGl = canApprove
  const glEditable = canApprove
  const multiSite = siteClasses.length > 1
  // When an invoice has a file, the approver has to open it before approving.
  const mustView = canApprove && !!invoice.file_path && !viewed
  const id = invoice.id

  // Per-site dollar split the approver enters at approval; prefill an even split
  // (or whatever was saved earlier).
  const [alloc, setAlloc] = useState<Record<string, string>>(() => {
    const saved = (invoice.site_allocations as Alloc[] | null) ?? []
    return saved.length
      ? Object.fromEntries(saved.map((a) => [a.name, String(a.amount)]))
      : evenSplit(Number(invoice.amount) || 0, initClasses)
  })

  const total = Number(amount) || 0
  const allocSum = siteClasses.reduce((s, cls) => s + (Number(alloc[cls]) || 0), 0)
  const balanced = Math.abs(allocSum - total) < 0.005
  // GL split: when more than one GL code is chosen, every code needs a positive
  // amount and the amounts must sum to the invoice total before approving.
  const multiGl = glList.length > 1
  const glAllocSum = glList.reduce((s, c) => s + (Number(glAlloc[c]) || 0), 0)
  const glAllEntered = glList.every((c) => (Number(glAlloc[c]) || 0) > 0)
  const glBalanced = Math.abs(glAllocSum - total) < 0.005
  const missingRequired = siteClasses.length === 0 || glList.length === 0
  const approveBlocked = missingRequired || (multiSite && !balanced) || (multiGl && (!glAllEntered || !glBalanced))

  const nameOf = (uid: string) => users.find((u) => u.id === uid)?.name ?? null
  const namesOf = (ids: string[]) => ids.map(nameOf).filter((n): n is string => Boolean(n))

  // Allocations are always written at approval: a single site gets the whole
  // amount, so the QuickBooks export can rely on them for every approved invoice.
  const allocations = (): Alloc[] =>
    siteClasses.map((cls) => ({
      name: cls,
      amount: multiSite ? (Number(alloc[cls]) || 0) : total,
    }))
  // Same for GL: a single GL gets the whole amount; multiple carry their splits.
  const glAllocations = (): GlAlloc[] =>
    glList.map((c) => ({ gl_code: c, amount: multiGl ? (Number(glAlloc[c]) || 0) : total }))

  // Fields the manager sets when assigning (also saved via Save).
  const assignPatch = (): OpsInvoiceUpdate => ({
    vendor_name: vendor.trim() || null,
    amount: total,
    invoice_date: invoiceDate || null,
    invoice_number: invoiceNumber.trim() || null,
    due_date: dueDate || null,
    class_names: siteClasses,
    location_id: null,
    location_ids: [],
    approver_ids: approverIds,
    approver_names: namesOf(approverIds),
    assigned_to: approverIds[0] ?? null,
    assigned_to_name: namesOf(approverIds)[0] ?? null,
    memo: memo.trim() || null,
    // Second-level approval plan (optional); reset the handoff state on (re)assign.
    secondary_approver_ids: secondaryApproverIds,
    secondary_approver_names: namesOf(secondaryApproverIds),
    awaiting_secondary: false,
    first_approved_by: null,
    first_approved_by_name: null,
    first_approved_at: null,
  })
  // Fields the approver can touch at review (sites, GL codes + splits).
  const reviewPatch = (): OpsInvoiceUpdate => ({
    gl_code: glList.join(', ') || null,
    gl_allocations: glAllocations() as unknown as OpsInvoiceUpdate['gl_allocations'],
    class_names: siteClasses,
    site_allocations: allocations() as unknown as OpsInvoiceUpdate['site_allocations'],
  })

  return (
    <Modal open onClose={onClose} title="Invoice" size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill status={status} />
          {invoice.file_path && (
            <div className="flex items-center gap-2">
              <Button variant={mustView ? 'primary' : 'secondary'} size="sm" onClick={() => { setViewed(true); onFile(invoice.file_path!) }}>
                <FileText className="size-4" /> View file{invoice.file_name ? ` (${invoice.file_name})` : ''}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onDownload(invoice.file_path!)}>
                <Download className="size-4" /> Download
              </Button>
            </div>
          )}
        </div>

        {invoice.duplicate_of && (
          <div className="flex items-start gap-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" />
            <p>
              <span className="font-semibold">Possible duplicate.</span>{' '}
              {duplicateOfInvoice
                ? <>The same invoice number{duplicateOfInvoice.invoice_number ? <> (<span className="font-semibold">#{duplicateOfInvoice.invoice_number}</span>)</> : ''} from {duplicateOfInvoice.vendor_name ?? 'this vendor'} already came in{duplicateOfInvoice.submitted_at ? ` on ${shortDate(duplicateOfInvoice.submitted_at)}` : ''}.</>
                : 'The same invoice number from this vendor already came in.'}{' '}
              Review before approving, or cancel this one.
            </p>
          </div>
        )}

        {status === 'assigned' && invoice.resubmit_note && (
          <div className="flex items-start gap-3 rounded-md border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm text-warn">
            <RotateCcw className="mt-0.5 size-5 shrink-0" />
            <p>
              <span className="font-semibold">Sent back for approval.</span>{' '}
              {invoice.resubmit_by_name ? `${invoice.resubmit_by_name} ` : ''}returned this for another look: {invoice.resubmit_note}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor">
            <Combobox value={vendor} onChange={setVendor} options={vendors} disabled={!editable} placeholder="Type or pick a vendor" />
          </Field>
          <Field label="Amount">
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Invoice date">
            <Input
              type="date"
              value={invoiceDate}
              onChange={(e) => {
                const v = e.target.value
                setInvoiceDate(v)
                // Due date defaults to 30 days after the invoice date.
                if (v) setDueDate(addDays(v, 30))
              }}
              disabled={!editable}
            />
          </Field>
          <Field label="Invoice #">
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} disabled={!editable} placeholder="From the invoice" />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={!editable} />
            {editable && <p className="mt-1 text-xs text-ink-subtle">Defaults to 30 days after the invoice date.</p>}
          </Field>
        </div>

        <Field label="Approver(s)">
          <CheckList
            options={approverUsers.map((u) => ({ id: u.id, label: u.name ?? u.email ?? 'User' }))}
            selected={approverIds}
            onChange={setApproverIds}
            disabled={!editable}
            empty="No managers or owners"
          />
        </Field>

        {/* Site(s): chosen by the approver (not by the manager during assignment). */}
        {!editable && (
          <Field label="Site(s)" required={requireSiteGl}>
            <CheckList
              options={classes.map((c) => ({ id: c, label: c }))}
              selected={siteClasses}
              onChange={setSiteClasses}
              disabled={!siteGlEditable}
              empty="No classes available"
            />
          </Field>
        )}

        {/* GL code(s): applied by the approver, who can split across several codes. */}
        {!editable && (
          <Field label="GL code(s)" required={glEditable}>
            {glEditable ? (
              <div className="flex flex-col gap-3">
                <CheckList
                  options={glCodes.map((c) => ({ id: c, label: c }))}
                  selected={glList}
                  onChange={setGlSelection}
                  empty="No GL codes available"
                />
                {multiGl && (
                  <div className="rounded-md border border-border bg-content p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink">Amount per GL code</span>
                      <button type="button" onClick={() => setGlAlloc(evenSplit(total, glList))} className="text-xs font-medium text-accent hover:underline">
                        Split evenly
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      {glList.map((c) => (
                        <div key={c} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{c}</span>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">$</span>
                            <input
                              type="number"
                              step="0.01"
                              value={glAlloc[c] ?? ''}
                              onChange={(e) => setGlAlloc((p) => ({ ...p, [c]: e.target.value }))}
                              className="h-9 w-32 rounded-md border border-border bg-card pl-5 pr-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className={cn('mt-2 flex items-center justify-between text-xs', glAllEntered && glBalanced ? 'text-ok' : 'text-danger')}>
                      <span>Allocated {currency(glAllocSum)} of {currency(total)}</span>
                      <span>{!glAllEntered ? 'Enter each amount' : glBalanced ? 'Balanced' : `${currency(Math.abs(total - glAllocSum))} ${glAllocSum > total ? 'over' : 'left'}`}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1 text-sm text-ink">
                {initGl.length ? (
                  initGl.map((g) => (
                    <div key={g.gl_code} className="flex items-center justify-between">
                      <span>{g.gl_code}</span>
                      {initGl.length > 1 && <span className="text-ink-muted">{currency(g.amount)}</span>}
                    </div>
                  ))
                ) : invoice.gl_code ? (
                  <span>{invoice.gl_code}</span>
                ) : (
                  <span className="text-ink-subtle">Not set yet.</span>
                )}
              </div>
            )}
          </Field>
        )}

        {editable && (
          <Field label="Second-level approver(s)">
            <CheckList
              options={approverUsers.map((u) => ({ id: u.id, label: u.name ?? u.email ?? 'User' }))}
              selected={secondaryApproverIds}
              onChange={setSecondaryApproverIds}
              disabled={!editable}
              empty="No managers or owners"
            />
            <p className="mt-1 text-xs text-ink-subtle">Optional. If set, the invoice goes to them for a final approval after the first approver signs off.</p>
          </Field>
        )}

        {editable && (
          <Field label="Memo" required>
            <Input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Required before sending for approval — goes in the QuickBooks Memo column"
              invalid={!memo.trim()}
            />
          </Field>
        )}

        {/* Approver enters the per-site split when an invoice spans >1 site. */}
        {canApprove && multiSite && (
          <div className="rounded-md border border-border bg-content p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">Split amount across sites</span>
              <button type="button" onClick={() => setAlloc(evenSplit(total, siteClasses))} className="text-xs font-medium text-accent hover:underline">
                Split evenly
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {siteClasses.map((cls) => (
                <div key={cls} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{cls}</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={alloc[cls] ?? ''}
                      onChange={(e) => setAlloc((p) => ({ ...p, [cls]: e.target.value }))}
                      className="h-9 w-32 rounded-md border border-border bg-card pl-5 pr-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className={cn('mt-2 flex items-center justify-between text-xs', balanced ? 'text-ok' : 'text-danger')}>
              <span>Allocated {currency(allocSum)} of {currency(total)}</span>
              <span>{balanced ? 'Balanced' : `${currency(Math.abs(total - allocSum))} ${allocSum > total ? 'over' : 'left'}`}</span>
            </div>
          </div>
        )}

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
        {status === 'assigned' && atSecondaryStage && (
          <div className="flex items-start gap-3 rounded-md border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm text-warn">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" />
            <p>
              <span className="font-semibold">Secondary approval required.</span>{' '}
              {invoice.first_approved_by_name ? `${invoice.first_approved_by_name} gave first-level approval. ` : ''}
              A second-level approver must sign off before this can move to Approved.
            </p>
          </div>
        )}
        {status === 'assigned' && (
          <p className="text-sm text-ink-muted">
            Waiting on <span className="font-medium text-ink">{(invoice.approver_names?.length ? invoice.approver_names.join(', ') : invoice.assigned_to_name) ?? 'the approver'}</span>{atSecondaryStage ? ' (second-level)' : ''}.
            {!atSecondaryStage && hasSecondary && (
              <span className="text-ink-subtle"> Then a second-level approval by {(invoice.secondary_approver_names ?? []).join(', ') || 'the named approver'} is required.</span>
            )}
          </p>
        )}
        {status === 'approved' && (
          <p className="text-sm text-ok">Approved by {invoice.decided_by_name ?? 'an approver'}. Export from the Approved tab.</p>
        )}
        {status === 'exported' && (
          <p className="text-sm text-ink-muted">Exported by {invoice.exported_by_name ?? 'a teammate'}{invoice.exported_at ? ` on ${shortDate(invoice.exported_at)}` : ''}.</p>
        )}

        {canApprove && (
          <Field label="Rejection reason (if sending back)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it needs a fix..." />
          </Field>
        )}

        {editable && status === 'needs_attention' && (
          <Field label="Reason for sending back to Unassigned (the approver will see this)">
            <Input value={resubmitNote} onChange={(e) => setResubmitNote(e.target.value)} placeholder="What you changed / why it's going back for approval..." />
          </Field>
        )}

        {editable && approverIds.length > 0 && !memo.trim() && (
          <p className="text-xs text-danger">Add a Memo before sending for approval.</p>
        )}
        {requireSiteGl && missingRequired && (
          <p className="text-xs text-danger">Set at least one site and at least one GL code before approving.</p>
        )}
        {canApprove && multiSite && !balanced && (
          <p className="text-xs text-danger">The per-site amounts must add up to {currency(total)} before approving.</p>
        )}
        {canApprove && multiGl && (!glAllEntered || !glBalanced) && (
          <p className="text-xs text-danger">Enter a dollar amount for every GL code, adding up to {currency(total)}, before approving.</p>
        )}
        {mustView && (
          <p className="text-xs text-danger">Open and view the invoice file (button up top) before approving.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            {/* Needs Attention offers Back-to-unassigned + Delete. */}
            {editable && status === 'needs_attention' && (
              <Button variant="ghost" size="sm" disabled={busy || !resubmitNote.trim()} onClick={() => void act(id, { ...assignPatch(), status: 'unassigned', approver_ids: [], approver_names: [], assigned_to: null, assigned_to_name: null, resubmit_note: resubmitNote.trim(), resubmit_by_name: currentUserName || null, decision_reason: null })}>
                <CornerUpLeft className="size-4" /> Back to unassigned
              </Button>
            )}
            {((canManage && status === 'needs_attention') || isDeleteAdmin) && (
              confirmDelete ? (
                <>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => void onDelete(id, invoice.file_path)}>
                    <Trash2 className="size-4" /> Confirm delete
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep</Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" className="text-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4" /> {status === 'exported' ? 'Delete export' : 'Delete Invoice'}
                </Button>
              )
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>Close</Button>

            {(editable || canApprove) && (
              <Button variant="secondary" disabled={busy} onClick={() => void act(id, editable ? assignPatch() : reviewPatch(), { keepOpen: true })}>
                Save
              </Button>
            )}
            {canManage && (status === 'unassigned' || status === 'needs_attention') && (
              <Button
                disabled={busy || approverIds.length === 0 || !memo.trim()}
                onClick={() => void act(id, { ...assignPatch(), status: 'assigned', assigned_at: nowIso() })}
              >
                <Send className="size-4" /> Send for approval
              </Button>
            )}
            {canApprove && (
              <>
                {/* Send back needs ONLY a rejection reason — none of the
                    approve-side gates (view file, sites, GL, split). It goes
                    solid the moment a reason is typed. */}
                <Button variant={reason.trim() ? 'danger' : 'secondary'} className={reason.trim() ? undefined : 'text-danger'} disabled={busy || !reason.trim()} onClick={() => void act(id, { ...reviewPatch(), status: 'needs_attention', decided_by: currentUserId, decided_by_name: currentUserName, decided_at: nowIso(), decision_reason: reason.trim() })}>
                  <XCircle className="size-4" /> Send back
                </Button>
                <Button disabled={busy || approveBlocked || mustView} onClick={() => void act(id, forwardToSecondary
                  ? { ...reviewPatch(), approver_ids: invoice.secondary_approver_ids, approver_names: invoice.secondary_approver_names, assigned_to: invoice.secondary_approver_ids?.[0] ?? null, assigned_to_name: invoice.secondary_approver_names?.[0] ?? null, assigned_at: nowIso(), awaiting_secondary: true, first_approved_by: currentUserId, first_approved_by_name: currentUserName, first_approved_at: nowIso() }
                  : { ...reviewPatch(), status: 'approved', decided_by: currentUserId, decided_by_name: currentUserName, decided_at: nowIso(), decision_reason: null, awaiting_secondary: false })}>
                  <CheckCircle2 className="size-4" /> {forwardToSecondary ? 'Approve & send to 2nd approver' : 'Approve'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// A per-site allocation stored on ops_invoices.site_allocations. `name` is the
// QuickBooks class (the Site); legacy rows may also carry location_id.
type Alloc = { name: string; amount: number; location_id?: string | null }
// Approver's GL split: one entry per chosen GL code with its dollar amount.
type GlAlloc = { gl_code: string; amount: number }

// A YYYY-MM-DD date shifted by n days (used to default a due date 30 days out).
function addDays(iso: string, n: number): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

// Even split of a dollar total across ids, in whole cents, remainder to the
// first sites so the parts always sum back to the total.
function evenSplit(total: number, ids: string[]): Record<string, string> {
  const n = ids.length
  if (!n) return {}
  const cents = Math.round((Number(total) || 0) * 100)
  const base = Math.floor(cents / n)
  const rem = cents - base * n
  const out: Record<string, string> = {}
  ids.forEach((id, i) => { out[id] = ((base + (i < rem ? 1 : 0)) / 100).toFixed(2) })
  return out
}

// Editable combobox: type to filter, or click the arrow to open the FULL list
// regardless of what's in the field (the native <datalist> filters itself down
// to the current value, which is why the arrow felt broken). Free text is still
// allowed. Used for both the vendor field and the GL-code field.
function Combobox({ value, onChange, options, disabled, placeholder = 'Type or pick…', invalid }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  disabled?: boolean
  placeholder?: string
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Arrow / just-opened => the whole list; typing => filter by what's typed.
  const q = value.trim().toLowerCase()
  const shown = showAll || !q ? options : options.filter((o) => o.toLowerCase().includes(q))

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => { onChange(e.target.value); setShowAll(false); setOpen(true) }}
          onFocus={() => { if (!disabled) { setShowAll(true); setOpen(true) } }}
          className={cn(
            'h-10 w-full rounded-md border bg-card pl-3 pr-9 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60',
            invalid ? 'border-danger' : 'border-border',
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Show options"
          onClick={() => { if (disabled) return; setShowAll(true); setOpen((o) => !o) }}
          className="absolute right-0 top-0 grid h-10 w-9 place-items-center text-ink-muted hover:text-ink disabled:opacity-40"
        >
          <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
        </button>
      </div>
      {open && !disabled && shown.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg">
          {shown.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setShowAll(false); setOpen(false) }}
              className={cn(
                'block w-full px-3 py-1.5 text-left text-sm hover:bg-content',
                o === value ? 'font-medium text-accent' : 'text-ink',
              )}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Compact multi-select: a scrollable checkbox list. Used for both the sites and
// the approvers on an invoice.
function CheckList({ options, selected, onChange, disabled, empty }: {
  options: { id: string; label: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  empty?: string
}) {
  const toggle = (oid: string) => {
    if (disabled) return
    onChange(selected.includes(oid) ? selected.filter((s) => s !== oid) : [...selected, oid])
  }
  return (
    <div className={cn('max-h-44 overflow-y-auto rounded-md border border-border bg-card p-1', disabled && 'opacity-60')}>
      {options.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-ink-subtle">{empty ?? 'None'}</p>
      ) : (
        options.map((o) => (
          <label key={o.id} className={cn('flex items-center gap-2 rounded px-2 py-1.5 text-sm', !disabled && 'cursor-pointer hover:bg-content')}>
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={() => toggle(o.id)}
              disabled={disabled}
              className="size-4 rounded border-border accent-accent"
            />
            <span className="text-ink">{o.label}</span>
          </label>
        ))
      )}
    </div>
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
      : status === 'needs_attention' ? 'bg-danger-soft text-danger'
        : status === 'assigned' ? 'bg-accent-soft text-accent'
          : 'bg-ink/10 text-ink-muted'
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', tone)}>{STATUS_LABEL[status]}</span>
}

// QuickBooks Desktop bill-import columns, in exact order (note the deliberate
// double spaces in "Expense  Memo" and "Product/Service  Class").
// Only the columns we actually populate; the empty QuickBooks template columns
// (Terms, Email, addresses, Product/Service, etc.) are omitted.
const QB_HEADERS = [
  'Bill No', 'Vendor', 'Date', 'Due Date', 'Memo',
  'Expense Account', 'Expense Amount', 'Expense Class', 'Currency',
]

const csvEsc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

// 'YYYY-MM-DD' -> 'M/D/YYYY' (no leading zeros), matching the template.
function mdY(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return y && m && d ? `${m}/${d}/${y}` : ''
}

// True when any GL code chosen for this invoice is QuickBooks' "Ask My
// Accountant" placeholder. Those invoices get a trailing '*' on the bill number,
// in both the export and the tables, to flag them for accounting follow-up.
function usesAskAccountant(inv: OpsInvoice): boolean {
  const codes = ((inv.gl_allocations as GlAlloc[] | null) ?? []).map((g) => String(g.gl_code ?? ''))
  if (inv.gl_code) codes.push(inv.gl_code)
  return codes.some((c) => /ask\s*my\s*accountant/i.test(c))
}

// Bill number: the AI-extracted invoice number first, then the email subject
// ("Invoice #INV-4821" -> INV-4821), then the attachment filename. Gets a
// trailing '*' (no space) when the invoice uses the "Ask My Accountant" GL code.
function billNoOf(inv: OpsInvoice): string {
  const base = (() => {
    if (inv.invoice_number?.trim()) return inv.invoice_number.trim()
    const subj = inv.email_subject ?? ''
    const m = subj.match(/#\s*([A-Za-z0-9][\w-]*)/) ?? subj.match(/\b(INV[-\s]?[A-Za-z0-9-]+)\b/i)
    if (m) return m[1].replace(/\s+/g, '')
    if (inv.file_name) return inv.file_name.replace(/\.[^.]+$/, '')
    return ''
  })()
  return base && usesAskAccountant(inv) ? base + '*' : base
}

// Build the QuickBooks CSV for a set of invoices. Fields we hold map to their QB
// columns (Vendor, Date, GL -> Expense Account, amount -> Expense Amount, site ->
// Expense Class); the rest stay blank, exactly like the template. An invoice
// split across sites produces one line per site (its own amount + Class) so the
// per-site cost allocation carries into accounting.
function quickbooksCsv(invs: OpsInvoice[]): string {
  const rows: string[] = []
  for (const inv of invs) {
    const base: Record<string, string> = {
      'Bill No': billNoOf(inv),
      Vendor: inv.vendor_name ?? '',
      Date: mdY(inv.invoice_date) || mdY(inv.submitted_at),
      'Due Date': mdY(inv.due_date),
      Memo: inv.memo ?? '',
      Currency: 'USD',
    }
    const glAllocs = (inv.gl_allocations as GlAlloc[] | null) ?? []
    const siteAllocs = (inv.site_allocations as Alloc[] | null) ?? []
    let lines: Record<string, string>[]
    if (Array.isArray(glAllocs) && glAllocs.length > 1) {
      // Multiple GL codes: one line per code (its account + allocated amount). A
      // single site is the Class for every line. When the site split lines up 1:1
      // with the GL split (same count and matching amounts), each GL line takes
      // its paired site's Class, so a multi-site invoice still carries the class.
      const singleCls = inv.class_names?.length === 1 ? String(inv.class_names[0]) : ''
      const paired =
        Array.isArray(siteAllocs) && siteAllocs.length === glAllocs.length && siteAllocs.length > 1 &&
        glAllocs.every((g, i) => Math.abs((Number(g.amount) || 0) - (Number(siteAllocs[i]?.amount) || 0)) < 0.005)
      lines = glAllocs.map((g, i) => ({
        ...base,
        'Expense Account': String(g.gl_code ?? ''),
        'Expense Amount': String(Number(g.amount) || 0),
        'Expense Class': paired ? String(siteAllocs[i]?.name ?? '') : singleCls,
      }))
    } else {
      const acct = glAllocs.length ? String(glAllocs[0].gl_code ?? '') : (inv.gl_code ?? '')
      const b2 = { ...base, 'Expense Account': acct }
      lines = Array.isArray(siteAllocs) && siteAllocs.length
        ? siteAllocs.map((a) => ({ ...b2, 'Expense Amount': String(Number(a.amount) || 0), 'Expense Class': String(a.name ?? '') }))
        : [{ ...b2, 'Expense Amount': String(Number(inv.amount) || 0) }]
    }
    for (const cell of lines) rows.push(QB_HEADERS.map((h) => csvEsc(cell[h] ?? '')).join(','))
  }
  return [QB_HEADERS.map(csvEsc).join(','), ...rows].join('\r\n') + '\r\n'
}

// Filename shaped like the template: INV-QUICKBOOKSDESKTOP-<batch>-<MMYYYY>.csv
function qbFilename(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const batch = String(now.getTime()).slice(-6)
  return `INV-QUICKBOOKSDESKTOP-${batch}-${mm}${now.getFullYear()}.csv`
}

function downloadCsv(filename: string, text: string) {
  // Prepend a UTF-8 BOM so Excel reads the file as UTF-8 (otherwise the middle dot
  // in GL accounts like "20002 · Inventory" shows up as "Â·").
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
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
