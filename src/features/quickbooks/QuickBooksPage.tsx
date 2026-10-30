import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Download, KeyRound, Loader2, RefreshCw, Send, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import type { OpsInvoice } from '@/lib/queries/opsInvoices'
import { quickbooks, type QbConnection, type QbJob, type QbJobStatus, type QbListItem } from '@/lib/queries/quickbooks'
import { indexLists, prepareBill, type PreparedBill } from '@/lib/quickbooks/match'

// QuickBooks: approved invoices go into QuickBooks Enterprise as bills through
// Intuit's Web Connector (qbwc edge function, migration 0199). Set up the
// Web Connector once; after that, pick bills here and they go in at its next
// check-in. Kevan only for now.

const LIVE: QbJobStatus[] = ['queued', 'sent', 'posted', 'unknown']
const STATUS: Record<QbJobStatus, { label: string; tone: 'accent' | 'ok' | 'danger' | 'warn' | 'neutral' }> = {
  queued: { label: 'Waiting for the Web Connector', tone: 'accent' },
  sent: { label: 'Sending', tone: 'accent' },
  posted: { label: 'In QuickBooks', tone: 'ok' },
  failed: { label: "Didn't go in", tone: 'danger' },
  unknown: { label: 'Check QuickBooks', tone: 'warn' },
  canceled: { label: 'Canceled', tone: 'neutral' },
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : 'never')
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

// The file that adds Operator to the Web Connector (File > Add an application).
function qwcFile(c: QbConnection): string {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbwc`
  const guid = (u: string) => `{${u.toUpperCase()}}`
  return `<?xml version="1.0"?>
<QBWCXML>
  <AppName>Operator</AppName>
  <AppID></AppID>
  <AppURL>${url}</AppURL>
  <AppDescription>Sends approved invoices from Operator to QuickBooks as bills.</AppDescription>
  <AppSupport>${url}?support=1</AppSupport>
  <UserName>${c.username}</UserName>
  <OwnerID>${guid(c.owner_id)}</OwnerID>
  <FileID>${guid(c.file_id)}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>15</RunEveryNMinutes>
  </Scheduler>
  <IsReadOnly>false</IsReadOnly>
</QBWCXML>
`
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function QuickBooksPage() {
  const { profile } = useAuth()
  const [conn, setConn] = useState<QbConnection | null>(null)
  const [items, setItems] = useState<QbListItem[]>([])
  const [invoices, setInvoices] = useState<OpsInvoice[]>([])
  const [jobs, setJobs] = useState<QbJob[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [c, l, inv, j] = await Promise.all([quickbooks.connection(), quickbooks.listItems(), quickbooks.approvedInvoices(), quickbooks.jobs()])
    const err = c.error ?? l.error ?? inv.error ?? j.error
    setError(err)
    setConn(c.data)
    setItems(l.data ?? [])
    setInvoices(inv.data)
    setJobs(j.data)
    setLoaded(true)
  }, [])
  useEffect(() => { void load() }, [load])
  // While bills wait on the Web Connector, look again every 30 seconds.
  const waiting = jobs.some((j) => j.status === 'queued' || j.status === 'sent')
  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(t)
  }, [waiting, load])

  const lists = useMemo(() => indexLists(items), [items])
  const listsReady = !!conn?.lists_synced_at
  const liveInvoices = useMemo(() => new Set(jobs.filter((j) => LIVE.includes(j.status as QbJobStatus)).map((j) => j.invoice_id)), [jobs])
  const bills = useMemo(
    () => invoices.filter((i) => !liveInvoices.has(i.id)).map((i) => prepareBill(i, lists)),
    [invoices, liveInvoices, lists],
  )
  const ready = bills.filter((b) => !b.problems.length)
  const picked = ready.filter((b) => selected.has(b.invoice.id))

  const send = async () => {
    if (!profile || !picked.length) return
    setBusy(true)
    setError(null)
    const { error: err } = await quickbooks.queueBills(picked.map((b) => ({
      account_id: profile.account_id, invoice_id: b.invoice.id, payload: b.payload!,
    })))
    setBusy(false)
    if (err) { setError(err.message); return }
    setSelected(new Set())
    setFlash(`${picked.length} bill${picked.length === 1 ? '' : 's'} queued. They go into QuickBooks at the Web Connector's next check-in.`)
    void load()
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="QuickBooks" subtitle="Send approved invoices to QuickBooks Enterprise as bills, through Intuit's Web Connector." />
      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {!loaded ? (
        <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : (
        <div className="mt-5 space-y-6">
          <Connection conn={conn} counts={lists.counts} onChanged={(m) => { if (m) setFlash(m); void load() }} />

          <section className="rounded-lg border border-border bg-card">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">Ready to send</h2>
                <p className="text-xs text-ink-muted">Approved invoices from Invoice Approval that aren't in QuickBooks yet.</p>
              </div>
              <Button onClick={() => void send()} disabled={!picked.length || busy || !listsReady} className="sm:w-auto">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {picked.length ? `Send ${picked.length} to QuickBooks` : 'Send to QuickBooks'}
              </Button>
            </div>
            {!listsReady ? (
              <p className="px-4 py-6 text-sm text-ink-muted">
                Waiting for your QuickBooks lists (vendors, accounts and classes). They come with the Web Connector's first check-in, and each bill is checked against them before it can go.
              </p>
            ) : bills.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-muted">Nothing waiting. Approved invoices show up here.</p>
            ) : (
              <>
                {ready.length > 1 && (
                  <label className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm text-ink-muted">
                    <input type="checkbox" checked={picked.length === ready.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(ready.map((b) => b.invoice.id)) : new Set())}
                      className="size-4 rounded border-border text-accent focus:ring-accent" />
                    All {ready.length} ready
                  </label>
                )}
                <ul className="divide-y divide-border">
                  {bills.map((b) => (
                    <BillRow key={b.invoice.id} bill={b} checked={selected.has(b.invoice.id)}
                      onToggle={() => setSelected((s) => { const n = new Set(s); if (n.has(b.invoice.id)) n.delete(b.invoice.id); else n.add(b.invoice.id); return n })} />
                  ))}
                </ul>
              </>
            )}
          </section>

          <Sent jobs={jobs} onChanged={(m) => { setFlash(m); void load() }} onError={setError} onRefresh={() => void load()} />
        </div>
      )}
    </div>
  )
}

function BillRow({ bill: b, checked, onToggle }: { bill: PreparedBill; checked: boolean; onToggle: () => void }) {
  const ok = !b.problems.length
  const classes = [...new Set(b.lines.map((l) => l.cls).filter(Boolean))]
  return (
    <li className="flex gap-3 px-4 py-3">
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={!ok} aria-label={`Send ${b.refNumber || b.vendor}`}
        className="mt-1 size-4 shrink-0 rounded border-border text-accent focus:ring-accent disabled:opacity-40" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-medium text-ink">{b.vendor || 'No vendor'}</span>
          <span className="font-medium tabular-nums text-ink">{money(b.total)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-muted">
          <span>Bill {b.refNumber || '(no number)'}</span>
          {b.date && <span>{day(b.date)}</span>}
          <span>{b.lines.length} line{b.lines.length === 1 ? '' : 's'}</span>
          {classes.length > 0 && <span className="truncate">{classes.join(', ')}</span>}
        </div>
        {ok ? (
          <Badge tone="ok" className="mt-1.5"><Check className="size-3" /> Ready</Badge>
        ) : (
          <ul className="mt-1.5 space-y-0.5 text-xs text-warn">
            {b.problems.map((p) => <li key={p} className="flex gap-1.5"><AlertTriangle className="mt-px size-3.5 shrink-0" />{p}</li>)}
          </ul>
        )}
      </div>
    </li>
  )
}

function Connection({ conn, counts, onChanged }: {
  conn: QbConnection | null
  counts: { vendor: number; account: number; class: number }
  onChanged: (message?: string) => void
}) {
  const [open, setOpen] = useState(!conn?.last_contact_at)
  const [login, setLogin] = useState<{ username: string; password: string } | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const makePassword = async () => {
    setConfirmNew(false)
    setBusy(true)
    setError(null)
    const { data, error: err } = await quickbooks.newPassword()
    setBusy(false)
    if (err || !data) { setError(err ?? "Couldn't make a password."); return }
    setLogin(data)
    onChanged()
  }
  const refresh = async () => {
    setBusy(true)
    const { error: err } = await quickbooks.requestLists()
    setBusy(false)
    if (err) setError(err.message)
    else onChanged('Asked for fresh lists. They come with the next check-in.')
  }

  const status = !conn ? 'Not set up yet.'
    : !conn.last_contact_at ? "Waiting for the Web Connector's first check-in."
      : `Last check-in ${ago(conn.last_contact_at)}${conn.company_file ? `, company file ${conn.company_file}` : ''}.`

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            Web Connector
            {conn?.last_contact_at ? <Badge tone="ok">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
          </h2>
          <p className="mt-1 break-words text-sm text-ink-muted">{status}</p>
          {conn?.lists_synced_at && (
            <p className="mt-1 text-sm text-ink-muted">
              QuickBooks lists: {counts.vendor.toLocaleString()} vendors, {counts.account.toLocaleString()} accounts, {counts.class.toLocaleString()} classes, from {ago(conn.lists_synced_at)}.
              {conn.lists_requested_at && conn.lists_requested_at > conn.lists_synced_at && ' Fresh ones come with the next check-in.'}
            </p>
          )}
        </div>
        {conn?.last_contact_at && (
          <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh lists
          </Button>
        )}
      </div>
      {conn?.last_error && (
        <p className="mt-3 flex gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{conn.last_error}</p>
      )}
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-3 flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Set up the Web Connector
      </button>
      {open && (
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-ink">
          <li>
            <span>Make a Web Connector password. It's shown once; you'll type it into the Web Connector.</span>
            <div className="mt-2">
              <Button variant="secondary" size="sm" onClick={() => (conn ? setConfirmNew(true) : void makePassword())} disabled={busy}>
                <KeyRound className="size-4" /> {conn ? 'Make a new password' : 'Make the password'}
              </Button>
            </div>
            {login && (
              <div className="mt-2 space-y-1.5 rounded-md border border-border bg-content p-3">
                <Secret label="User name" value={login.username} />
                <Secret label="Password" value={login.password} />
                <p className="text-xs text-ink-muted">Copy the password now. It won't be shown again.</p>
              </div>
            )}
          </li>
          <li>
            <span>Download the Web Connector file.</span>
            <div className="mt-2">
              <Button variant="secondary" size="sm" disabled={!conn} onClick={() => conn && download('operator-quickbooks.qwc', qwcFile(conn))}>
                <Download className="size-4" /> Download operator-quickbooks.qwc
              </Button>
            </div>
          </li>
          <li>On the computer with QuickBooks Enterprise, open the company file and sign in as the Admin.</li>
          <li>
            Open the Web Connector (File &gt; Update Web Services). If it isn't there, install Intuit's free QuickBooks Web Connector first.
          </li>
          <li>Click Add an application and pick the file you downloaded.</li>
          <li>
            QuickBooks asks whether to let Operator in. Choose "Yes, always; allow access even if QuickBooks is not running", and
            sign in as the Admin (or a user who can enter bills).
          </li>
          <li>In the Web Connector, type the password into Operator's Password box and save it.</li>
          <li>Tick Operator and turn on Auto-Run (every 15 minutes), then click Update Selected to check in now.</li>
          <li className="text-ink-muted">
            The computer has to be on for the Web Connector to check in. Bills you send wait here until it does.
          </li>
        </ol>
      )}
      <ConfirmDialog
        open={confirmNew}
        title="Make a new password?"
        description="The Web Connector stops working until you type the new password into it."
        confirmLabel="Make a new password"
        onCancel={() => setConfirmNew(false)}
        onConfirm={() => void makePassword()}
      />
    </section>
  )
}

function Secret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-ink-muted">{label}</span>
      <code className="rounded bg-card px-2 py-0.5 font-mono text-ink">{value}</code>
      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

type Payload = { vendor?: { name?: string }; ref_number?: string; txn_date?: string; lines?: { amount?: number }[] }

function Sent({ jobs, onChanged, onError, onRefresh }: {
  jobs: QbJob[]
  onChanged: (message: string) => void
  onError: (message: string) => void
  onRefresh: () => void
}) {
  const { profile } = useAuth()
  const [again, setAgain] = useState<QbJob | null>(null)
  const found = async (j: QbJob) => {
    if (!profile) return
    const { error } = await quickbooks.confirmPosted(j, { id: profile.id, name: profile.name })
    if (error) onError(error)
    else onChanged('Marked as in QuickBooks. The invoice is exported.')
  }
  const set = async (j: QbJob, status: 'queued' | 'canceled') => {
    setAgain(null)
    const { error } = await quickbooks.setJobStatus(j.id, status)
    if (error) onError(error.message)
    else onChanged(status === 'queued' ? 'Queued again. It goes at the next check-in.' : 'Taken off. The invoice is back in the list to send.')
  }
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Sent</h2>
        <Button variant="ghost" size="sm" onClick={onRefresh}><RefreshCw className="size-4" /> Refresh</Button>
      </div>
      {jobs.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">Nothing sent yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((j) => {
            const p = (j.payload ?? {}) as Payload
            const total = (p.lines ?? []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
            const st = STATUS[j.status as QbJobStatus] ?? STATUS.queued
            return (
              <li key={j.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium text-ink">{p.vendor?.name ?? 'Bill'}</span>
                  <span className="font-medium tabular-nums text-ink">{money(total)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <span>Bill {p.ref_number || '(no number)'}</span>
                  {p.txn_date && <span>{day(p.txn_date)}</span>}
                  <span>Queued {ago(j.created_at)}</span>
                  {j.done_at && j.status !== 'canceled' && <span>{j.status === 'posted' ? 'Entered' : 'Answered'} {ago(j.done_at)}</span>}
                </div>
                {j.error && j.status !== 'posted' && <p className={cn('mt-1.5 text-xs', j.status === 'unknown' ? 'text-warn' : 'text-danger')}>{j.error}</p>}
                {(j.status === 'queued' || j.status === 'failed' || j.status === 'unknown') && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {j.status === 'failed' && <Button variant="secondary" size="sm" onClick={() => void set(j, 'queued')}>Send again</Button>}
                    {j.status === 'unknown' && <Button variant="secondary" size="sm" onClick={() => void found(j)}>It's in QuickBooks</Button>}
                    {j.status === 'unknown' && <Button variant="secondary" size="sm" onClick={() => setAgain(j)}>It's not: send again</Button>}
                    {j.status !== 'unknown' && (
                      <Button variant="ghost" size="sm" onClick={() => void set(j, 'canceled')}>
                        {j.status === 'queued' ? 'Cancel' : 'Back to the list'}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!again}
        title="Send it again?"
        description="Only if you've checked QuickBooks and the bill isn't there. Otherwise it'll be in QuickBooks twice."
        confirmLabel="Send again"
        onCancel={() => setAgain(null)}
        onConfirm={() => { if (again) void set(again, 'queued') }}
      />
    </section>
  )
}
