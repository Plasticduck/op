import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FileSearch, FileSignature, ListChecks, Plus, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { currency, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { listUsers, type AccountUser } from '@/lib/queries/account'
import { invoiceVendors } from '@/lib/queries/invoiceVendors'
import { invoiceGlCodes } from '@/lib/queries/invoiceGlCodes'
import { invoiceClasses } from '@/lib/queries/invoiceClasses'
import { purchaseRequests, type ApprovalRule, type PurchaseRequest, type Recipient } from '@/lib/queries/purchaseRequests'
import { VerifyPdfModal } from '@/components/esign/VerifyPdfModal'
import { EsignSettingsModal } from '@/components/esign/EsignSettingsModal'
import { eligibleSigners, isAccountsPayable, prNumber } from './access'
import { StatusPill } from './shared'
import { progressOf } from './logic'
import { RequestEditor } from './RequestEditor'
import { SendForSignature } from './SendForSignature'
import { RequestDetail } from './RequestDetail'
import { ApprovalRulesModal } from './ApprovalRulesModal'

type RecipLite = Pick<Recipient, 'id' | 'envelope_id' | 'user_id' | 'name' | 'email' | 'role' | 'label' | 'routing_order' | 'status' | 'sent_at' | 'signed_at' | 'declined_at' | 'required_by_rule'>
type TabKey = 'to_sign' | 'drafts' | 'pending' | 'approved' | 'purchased' | 'closed'

const TABS: { key: TabKey; label: string; subtitle: (ap: boolean) => string; empty: string }[] = [
  { key: 'to_sign', label: 'To Sign', subtitle: () => 'Purchase requests waiting for your signature. Open one to review it, then sign or decline.', empty: 'Nothing is waiting for your signature.' },
  { key: 'drafts', label: 'Drafts', subtitle: () => 'Requests you started but have not sent. Finish one and send it for signature.', empty: 'No drafts. Start a new request with the button above.' },
  { key: 'pending', label: 'Awaiting Approval', subtitle: (ap) => (ap ? 'Every request out for signature, and whose turn it is.' : 'Your requests, and the ones you are signing, that are out for signature.'), empty: 'Nothing is out for signature.' },
  { key: 'approved', label: 'Approved', subtitle: (ap) => (ap ? 'Signed by everyone and sealed. Mark each one purchased once it is bought.' : 'Signed by everyone and sealed.'), empty: 'No approved requests waiting to be bought.' },
  { key: 'purchased', label: 'Purchased', subtitle: () => 'Approved requests that have been bought.', empty: 'Nothing purchased yet.' },
  { key: 'closed', label: 'Declined & Voided', subtitle: () => 'Requests that were declined or voided. The requester can edit one and send it again.', empty: 'Nothing declined or voided.' },
]

const inTab = (key: TabKey, pr: PurchaseRequest, me: string, myTurn: boolean) =>
  key === 'to_sign' ? myTurn
    : key === 'drafts' ? pr.status === 'draft' && pr.requester_id === me
      : key === 'closed' ? pr.status === 'declined' || pr.status === 'voided'
        : pr.status === key

export default function PurchaseRequestsPage() {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const me = profile?.id ?? ''
  const isAP = isAccountsPayable(profile)
  const isOwner = profile?.role === 'owner'

  const [rows, setRows] = useState<PurchaseRequest[]>([])
  const [recips, setRecips] = useState<RecipLite[]>([])
  const [loaded, setLoaded] = useState(false)
  const [users, setUsers] = useState<AccountUser[]>([])
  const [rules, setRules] = useState<ApprovalRule[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [glCodes, setGlCodes] = useState<string[]>([])
  const [classes, setClasses] = useState<string[]>([])
  const [tab, setTab] = useState<TabKey | null>(null)
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [editing, setEditing] = useState<PurchaseRequest | 'new' | null>(null)
  const [sending, setSending] = useState<PurchaseRequest | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [modal, setModal] = useState<'rules' | 'verify' | 'settings' | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const load = useCallback(async () => {
    const [{ data: prs }, { data: rs }] = await Promise.all([purchaseRequests.list(), purchaseRequests.allRecipients()])
    setRows((prs ?? []) as unknown as PurchaseRequest[])
    setRecips((rs ?? []) as RecipLite[])
    setLoaded(true)
  }, [])
  const loadRules = useCallback(() => purchaseRequests.rules().then(({ data }) => setRules(data ?? [])), [])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    void load()
    void loadRules()
    void listUsers().then(({ data }) => setUsers((data as AccountUser[] | null) ?? []))
    void invoiceVendors.list().then(({ data }) => setVendors(((data as { name: string }[] | null) ?? []).map((v) => v.name)))
    void invoiceGlCodes.list().then(({ data }) => setGlCodes(((data as { code: string }[] | null) ?? []).map((g) => g.code)))
    void invoiceClasses.list().then(({ data }) => setClasses(((data as { class: string }[] | null) ?? []).map((c) => c.class)))
    const soon = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void load(), 300) }
    const ch = supabase
      .channel('purchase-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_requests' }, soon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'esign_events' }, soon)
      .subscribe()
    return () => { void supabase.removeChannel(ch); if (timer.current) clearTimeout(timer.current) }
  }, [load, loadRules])

  // Open a request from a link (?r=<id>), e.g. the "Review and sign" email button.
  useEffect(() => {
    const r = searchParams.get('r')
    if (!r) return
    setOpenId(r)
    const next = new URLSearchParams(searchParams)
    next.delete('r')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const signers = useMemo(() => eligibleSigners(users), [users])
  const sites = useMemo(() => (classes.length ? classes : locations.map((l) => l.name)), [classes, locations])

  const recipsByEnv = useMemo(() => {
    const m = new Map<string, RecipLite[]>()
    for (const r of recips) {
      const list = m.get(r.envelope_id) ?? []
      list.push(r)
      m.set(r.envelope_id, list)
    }
    return m
  }, [recips])

  const enriched = useMemo(() => rows.map((pr) => {
    const rs = pr.envelope_id ? recipsByEnv.get(pr.envelope_id) ?? [] : []
    const prog = progressOf(rs)
    return { pr, prog, myTurn: pr.status === 'pending' && prog.current.some((r) => r.user_id === me) }
  }), [rows, recipsByEnv, me])

  const counts = useMemo(() => {
    const c = Object.fromEntries(TABS.map((t) => [t.key, 0])) as Record<TabKey, number>
    for (const e of enriched) for (const t of TABS) if (inTab(t.key, e.pr, me, e.myTurn)) c[t.key] += 1
    return c
  }, [enriched, me])

  // Land on To Sign when something is waiting, otherwise the first tab with rows.
  const activeKey: TabKey = tab ?? (counts.to_sign ? 'to_sign' : (TABS.find((t) => t.key !== 'to_sign' && counts[t.key])?.key ?? 'pending'))
  const active = TABS.find((t) => t.key === activeKey)!

  const filtered = enriched.filter(({ pr, myTurn }) => {
    if (!inTab(activeKey, pr, me, myTurn)) return false
    const q = query.trim().toLowerCase()
    if (q && ![prNumber(pr.number), pr.title, pr.vendor, pr.site, pr.requester_name].some((v) => (v ?? '').toLowerCase().includes(q))) return false
    const day = (pr.submitted_at ?? pr.created_at).slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })
  const totalAmount = filtered.reduce((s, e) => s + Number(e.pr.total || 0), 0)

  const exportCsv = () => {
    const head = ['Number', 'Title', 'Vendor', 'Site', 'Category', 'GL code', 'Requested by', 'Total', 'Status', 'Sent', 'Approved', 'Purchased', 'PO number', 'Amount paid']
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const lines = filtered.map(({ pr }) => [
      prNumber(pr.number), pr.title, pr.vendor, pr.site, pr.category, pr.gl_code, pr.requester_name, Number(pr.total).toFixed(2), pr.status,
      pr.submitted_at?.slice(0, 10), pr.approved_at?.slice(0, 10), pr.purchased_at?.slice(0, 10), pr.po_number, pr.actual_amount,
    ].map(esc).join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\r\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `purchase-requests-${activeKey}-${new Date().toLocaleDateString('en-CA')}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
  }

  const openRow = (pr: PurchaseRequest) => {
    if (pr.status === 'draft' && pr.requester_id === me) setEditing(pr)
    else setOpenId(pr.id)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Purchase Request</h1>
          <p className="mt-1 text-sm text-ink-muted">{active.subtitle(isAP)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModal('settings')}><Settings2 className="size-4" /> E-signature</Button>
          <Button variant="secondary" onClick={() => setModal('verify')}><FileSearch className="size-4" /> Verify a PDF</Button>
          {isOwner && <Button variant="secondary" onClick={() => setModal('rules')}><ListChecks className="size-4" /> Approval rules</Button>}
          <Button onClick={() => setEditing('new')} data-testid="pr-new"><Plus className="size-4" /> New request</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border" role="tablist">
        {TABS.map((t) => {
          const isActive = t.key === activeKey
          return (
            <button key={t.key} type="button" role="tab" aria-selected={isActive} onClick={() => setTab(t.key)}
              className={cn('-mb-px flex items-center gap-2 border-b-2 pb-2 pt-1 text-sm font-medium transition',
                isActive ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
              {t.label}
              <span className={cn('inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                t.key === 'to_sign' && counts[t.key] > 0 ? 'bg-danger text-white'
                  : t.key === 'approved' && counts[t.key] > 0 && isAP ? 'bg-warn-soft text-warn'
                    : isActive ? 'bg-accent text-white' : 'bg-ink/10 text-ink-muted')}>
                {counts[t.key]}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="In this tab" value={String(filtered.length)} />
        <StatCard label="Total amount" value={currency(totalAmount)} />
      </div>

      <div className="grid grid-cols-1 items-end gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
        <FilterField label="Search">
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Number, title, vendor, site, person…"
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
        </FilterField>
        <FilterField label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
        </FilterField>
        <FilterField label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
        </FilterField>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setQuery(''); setFrom(''); setTo('') }}
            className="h-10 rounded-md border border-border bg-card px-4 text-sm font-medium text-ink-muted transition hover:bg-content hover:text-ink">Clear</button>
          <button type="button" onClick={exportCsv} disabled={!filtered.length}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-medium text-ink-muted transition hover:bg-content hover:text-ink disabled:opacity-50">
            <Download className="size-4" /> CSV
          </button>
        </div>
      </div>

      {/* Phones: cards */}
      <div className="flex flex-col gap-3 md:hidden" data-testid="pr-cards">
        {!loaded ? <p className="py-8 text-center text-sm text-ink-muted">Loading…</p>
          : filtered.length === 0 ? <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-ink-muted">{active.empty}</p>
            : filtered.map(({ pr, prog, myTurn }) => (
              <button key={pr.id} type="button" onClick={() => openRow(pr)}
                className={cn('flex flex-col gap-1.5 rounded-lg border bg-card p-4 text-left transition hover:bg-content', myTurn ? 'border-accent/50' : 'border-border')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-muted">{prNumber(pr.number)}</span>
                  <StatusPill status={pr.status} />
                </div>
                <div className="font-medium text-ink">{pr.title || 'Untitled request'}</div>
                <div className="text-sm text-ink-muted">{[pr.vendor, pr.site].filter(Boolean).join(' · ') || 'No vendor yet'}</div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold tabular-nums text-ink">{currency(Number(pr.total))}</span>
                  {prog.total > 0 && <span className="text-xs text-ink-muted">{prog.signed} of {prog.total} signed</span>}
                </div>
                {myTurn && <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white"><FileSignature className="size-3.5" /> Review and sign</span>}
              </button>
            ))}
      </div>

      {/* Larger screens: table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table className="w-full min-w-[900px] text-sm" data-testid="pr-table">
          <thead className="border-b border-border bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Request</th>
              <th className="px-4 py-3 font-medium">Site</th>
              <th className="px-4 py-3 font-medium">Requested by</th>
              <th className="px-4 py-3 font-medium">Approvals</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">{activeKey === 'drafts' ? 'Updated' : 'Sent'}</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-ink-muted">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-ink-muted">{active.empty}</td></tr>
            ) : filtered.map(({ pr, prog, myTurn }) => (
              <tr key={pr.id} onClick={() => openRow(pr)} className="cursor-pointer border-t border-border hover:bg-content">
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{prNumber(pr.number)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-medium text-ink">
                    <span>{pr.title || 'Untitled request'}</span>
                    {pr.priority === 'urgent' && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">Urgent</span>}
                  </div>
                  <div className="text-xs text-ink-muted">{pr.vendor || 'No vendor yet'}</div>
                </td>
                <td className="px-4 py-3 text-ink-muted">{pr.site || '—'}</td>
                <td className="px-4 py-3 text-ink-muted">{pr.requester_name}</td>
                <td className="px-4 py-3 text-ink-muted">
                  {prog.total ? (
                    <div>
                      <div className="text-ink">{prog.signed} of {prog.total} signed</div>
                      {pr.status === 'pending' && prog.current.length > 0 && <div className="text-xs">Waiting on {prog.current.map((r) => r.name).join(', ')}</div>}
                    </div>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 tabular-nums text-ink">{currency(Number(pr.total))}</td>
                <td className="px-4 py-3 text-ink-muted">{shortDate(activeKey === 'drafts' ? pr.updated_at : (pr.submitted_at ?? pr.created_at))}</td>
                <td className="px-4 py-3"><StatusPill status={pr.status} /></td>
                <td className="px-4 py-3 text-right">
                  {myTurn ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white"><FileSignature className="size-3.5" /> Sign</span>
                  ) : (
                    <span className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-ink">{pr.status === 'draft' && pr.requester_id === me ? 'Edit' : 'Open'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && profile && (
        <RequestEditor
          request={editing === 'new' ? null : editing}
          accountId={profile.account_id}
          vendors={vendors}
          glCodes={glCodes}
          sites={sites}
          onClose={() => { setEditing(null); void load() }}
          onSaved={() => { setEditing(null); setTab('drafts'); void load() }}
          onContinue={(pr) => { setEditing(null); setSending(pr) }}
          onDeleted={() => { setEditing(null); void load() }}
        />
      )}
      {sending && (
        <SendForSignature
          request={sending}
          signers={signers}
          rules={rules}
          meId={me}
          onClose={() => { setSending(null); void load() }}
          onBack={() => { setEditing(sending); setSending(null) }}
          onSent={() => { const id = sending.id; setSending(null); setTab('pending'); void load(); setOpenId(id) }}
        />
      )}
      {openId && (
        <RequestDetail
          key={openId}
          requestId={openId}
          meId={me}
          isAP={isAP}
          onClose={() => { setOpenId(null); void load() }}
          onEdit={(pr) => { setOpenId(null); setEditing(pr) }}
          onSend={(pr) => { setOpenId(null); setSending(pr) }}
        />
      )}
      {modal === 'rules' && profile && (
        <ApprovalRulesModal accountId={profile.account_id} rules={rules} signers={signers}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); void loadRules() }} />
      )}
      {modal === 'verify' && <VerifyPdfModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <EsignSettingsModal onClose={() => setModal(null)} />}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </label>
  )
}
