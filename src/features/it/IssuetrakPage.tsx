import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { LifeBuoy, Plug, Plus, RefreshCw, Search, Ticket } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/lib/auth'
import {
  issuetrak,
  refName,
  ticketSite,
  type ItBootstrap,
  type ItIssue,
} from '@/lib/queries/issuetrak'

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : format(d, 'MMM d, yyyy h:mm a')
}

function issueNo(i: ItIssue): string {
  return `#${i.issueNumber ?? i.id ?? i.iid}`
}

// The connect-state message the proxy returns when ISSUETRAK_API_KEY is unset.
const NOT_CONNECTED = 'not connected'

export default function IssuetrakPage() {
  const { profile } = useAuth()
  const [connErr, setConnErr] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [boot, setBoot] = useState<ItBootstrap | null>(null)
  const [issues, setIssues] = useState<ItIssue[]>([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [diag, setDiag] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [b, l] = await Promise.all([issuetrak.bootstrap(), issuetrak.list()])
      setBoot(b)
      setIssues(l.issues)
      setConnErr(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.toLowerCase().includes(NOT_CONNECTED)) setConnErr(true)
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return issues
    return issues.filter(
      (i) =>
        String(i.issueNumber ?? i.id ?? i.iid).includes(term) ||
        (i.subject ?? '').toLowerCase().includes(term) ||
        ticketSite(i).toLowerCase().includes(term),
    )
  }, [issues, q])

  if (connErr) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Issuetrak"
          subtitle="IT help desk. Submit tickets and track their status."
        />
        <EmptyState
          icon={Plug}
          title="Issuetrak not connected yet"
          description="Add the Issuetrak API token to connect. Once connected, your open tickets load here."
        />
        <div className="mx-auto flex max-w-md items-center gap-2 text-xs text-ink-subtle">
          <LifeBuoy className="size-4" />
          Set the ISSUETRAK_API_KEY secret to turn this into a live help-desk queue.
        </div>
      </div>
    )
  }

  const canSubmit = (boot?.sites.length ?? 0) > 0

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Issuetrak"
        subtitle={
          boot?.isAdmin
            ? 'IT help desk. All open tickets across sites.'
            : 'IT help desk. Open tickets for your site.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  setDiag(JSON.stringify(await issuetrak.diag(), null, 2))
                } catch (e) {
                  setDiag(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Diagnostics
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)} disabled={!canSubmit}>
              <Plus className="size-4" />
              New ticket
            </Button>
          </div>
        }
      />

      {error && (
        <div className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          <div className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  setDiag(JSON.stringify(await issuetrak.diag(), null, 2))
                } catch (e) {
                  setDiag(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Run diagnostics
            </Button>
          </div>
        </div>
      )}

      {!error && boot && !canSubmit && (
        <div className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
          No matching site was found between Operator and Issuetrak, so submitting is disabled. Click
          Diagnostics to see the site names Issuetrak reports.
        </div>
      )}

      {diag && (
        <pre className="overflow-x-auto rounded-md border border-border bg-card p-2 text-xs text-ink">
          {diag}
        </pre>
      )}

      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by number, subject, or site"
          className="pl-9"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
        {/* List */}
        <div className="flex flex-col gap-2">
          {loading && issues.length === 0 ? (
            <div className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-ink-muted">
              Loading tickets…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Ticket} title="No open tickets" description="Nothing matches the current view." />
          ) : (
            filtered.map((i) => (
              <button
                key={i.iid}
                onClick={() => setSelected(i.iid)}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  selected === i.iid
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-card hover:bg-content'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-ink-subtle">{issueNo(i)}</span>
                  {i.subStatus?.name ? (
                    <Badge tone="accent">{i.subStatus.name}</Badge>
                  ) : (
                    <Badge tone="ok">Open</Badge>
                  )}
                </div>
                <div className="mt-1 line-clamp-2 text-sm font-medium text-ink">
                  {i.subject || '(no subject)'}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-subtle">
                  {boot?.isAdmin && <span>{ticketSite(i)}</span>}
                  {i.priority?.name && <span>{i.priority.name}</span>}
                  <span>{fmtDate(i.enteredDate)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail */}
        <div>
          {selected == null ? (
            <div className="flex h-full min-h-48 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-ink-subtle">
              Select a ticket to view details.
            </div>
          ) : (
            <IssueDetail key={selected} iid={selected} showSite={boot?.isAdmin ?? false} />
          )}
        </div>
      </div>

      {newOpen && boot && (
        <NewTicketModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          boot={boot}
          onCreated={() => {
            setNewOpen(false)
            void load()
          }}
          requesterName={profile?.name ?? ''}
        />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  )
}

function IssueDetail({ iid, showSite }: { iid: number; showSite: boolean }) {
  const [issue, setIssue] = useState<ItIssue | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    issuetrak
      .get(iid)
      .then((r) => {
        if (!cancelled) setIssue(r.issue)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [iid])

  if (loading) {
    return (
      <div className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-ink-muted">
        Loading ticket…
      </div>
    )
  }
  if (!issue) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
        {err ?? 'Could not load ticket.'}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-ink-subtle">{issueNo(issue)}</div>
          <h2 className="mt-0.5 text-lg font-semibold text-ink">{issue.subject || '(no subject)'}</h2>
        </div>
        {issue.subStatus?.name ? (
          <Badge tone="accent">{issue.subStatus.name}</Badge>
        ) : (
          <Badge tone="ok">Open</Badge>
        )}
      </div>

      {issue.description && (
        <div className="whitespace-pre-wrap rounded-md bg-content px-3 py-2 text-sm text-ink">
          {issue.description}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">{issue.subStatus?.name ?? (issue.isOpen === false ? 'Closed' : 'Open')}</Field>
        <Field label="Priority">{refName(issue.priority)}</Field>
        <Field label="Type">{refName(issue.issueType)}</Field>
        {showSite && <Field label="Site">{ticketSite(issue)}</Field>}
        <Field label="Submitted by">{refName(issue.submittedByUser)}</Field>
        <Field label="Entered">{fmtDate(issue.enteredDate)}</Field>
        <Field label="Target">{fmtDate(issue.targetDate)}</Field>
      </div>

      {issue.solution && (
        <Field label="Solution">
          <span className="whitespace-pre-wrap">{issue.solution}</span>
        </Field>
      )}

      <p className="border-t border-border pt-3 text-xs text-ink-subtle">
        IT works this ticket in Issuetrak. Status here updates when you refresh.
      </p>
    </div>
  )
}

function NewTicketModal({
  open,
  onClose,
  boot,
  onCreated,
  requesterName,
}: {
  open: boolean
  onClose: () => void
  boot: ItBootstrap
  onCreated: () => void
  requesterName: string
}) {
  const [siteNumber, setSiteNumber] = useState(boot.sites.length === 1 ? String(boot.sites[0].number) : '')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [issueTypeIid, setIssueTypeIid] = useState('')
  const [priorityIid, setPriorityIid] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!siteNumber || !subject.trim() || !description.trim() || !issueTypeIid) {
      setErr('Site, subject, description, and issue type are required.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await issuetrak.create({
        siteNumber: Number(siteNumber),
        subject: subject.trim(),
        description: description.trim(),
        issueTypeIid: Number(issueTypeIid),
        priorityIid: priorityIid ? Number(priorityIid) : undefined,
      })
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New ticket" size="md">
      <div className="flex flex-col gap-3">
        {requesterName && <div className="text-xs text-ink-subtle">Submitted by {requesterName}</div>}
        {err && (
          <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
            {err}
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Site
          <Select value={siteNumber} onChange={(e) => setSiteNumber(e.target.value)}>
            <option value="">— select —</option>
            {boot.sites.map((s) => (
              <option key={s.number} value={s.number}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Subject
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Describe the issue"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Issue type <span className="text-danger">*</span>
            <Select value={issueTypeIid} onChange={(e) => setIssueTypeIid(e.target.value)}>
              <option value="">— select —</option>
              {boot.issueTypes.map((t) => (
                <option key={t.iid} value={t.iid}>
                  {t.name ?? t.iid}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Priority
            <Select value={priorityIid} onChange={(e) => setPriorityIid(e.target.value)}>
              <option value="">—</option>
              {boot.priorities.map((p) => (
                <option key={p.iid} value={p.iid}>
                  {p.name ?? p.iid}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Submitting…' : 'Submit ticket'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
