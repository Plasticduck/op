import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { LifeBuoy, Plug, Plus, RefreshCw, Search, Send, Ticket } from 'lucide-react'
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
  nameMap,
  type ItIssue,
  type ItLookups,
  type ItNote,
} from '@/lib/queries/issuetrak'

const EMPTY_LOOKUPS: ItLookups = {
  priorities: [],
  substatuses: [],
  issueTypes: [],
  classes: [],
  organizations: [],
  users: [],
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : format(d, 'MMM d, yyyy h:mm a')
}

function issueNo(i: ItIssue): string {
  return `#${i.id ?? i.iid}`
}

// The connect-state message the proxy returns when ISSUETRAK_API_KEY is unset.
const NOT_CONNECTED = 'not connected'

export default function IssuetrakPage() {
  const { profile } = useAuth()
  const [connErr, setConnErr] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<ItIssue[]>([])
  const [lookups, setLookups] = useState<ItLookups>(EMPTY_LOOKUPS)
  const [q, setQ] = useState('')
  const [openOnly, setOpenOnly] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const priorityName = useMemo(() => nameMap(lookups.priorities), [lookups])
  const substatusName = useMemo(() => nameMap(lookups.substatuses), [lookups])
  const typeName = useMemo(() => nameMap(lookups.issueTypes), [lookups])
  const classNameMap = useMemo(() => nameMap(lookups.classes), [lookups])
  const orgName = useMemo(() => nameMap(lookups.organizations), [lookups])
  const userName = useMemo(() => nameMap(lookups.users), [lookups])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [res, lk] = await Promise.all([
        issuetrak.searchIssues({ pageNumber: 1, pageSize: 100 }),
        issuetrak.lookups(),
      ])
      const sorted = [...res.issues].sort((a, b) => {
        const ta = a.enteredDate ? new Date(a.enteredDate).getTime() : 0
        const tb = b.enteredDate ? new Date(b.enteredDate).getTime() : 0
        return tb - ta
      })
      setIssues(sorted)
      setLookups(lk)
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
    return issues.filter((i) => {
      if (openOnly && i.isOpen === false) return false
      if (!term) return true
      return (
        String(i.id ?? i.iid).includes(term) ||
        (i.subject ?? '').toLowerCase().includes(term)
      )
    })
  }, [issues, q, openOnly])

  if (connErr) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Issuetrak"
          subtitle="IT help desk. Submit and track support tickets through Issuetrak."
        />
        <EmptyState
          icon={Plug}
          title="Issuetrak not connected yet"
          description="Add the Issuetrak API token to connect. Once connected, tickets load here: submit, assign, and track issues through to resolved."
        />
        <div className="mx-auto flex max-w-md items-center gap-2 text-xs text-ink-subtle">
          <LifeBuoy className="size-4" />
          Set the ISSUETRAK_API_KEY secret to turn this into a live help-desk queue.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Issuetrak"
        subtitle="IT help desk. Submit and track support tickets through Issuetrak."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" />
              New issue
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by number or subject"
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
            className="size-4 accent-accent"
          />
          Open only
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
        {/* List */}
        <div className="flex flex-col gap-2">
          {loading && issues.length === 0 ? (
            <div className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-ink-muted">
              Loading issues…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Ticket} title="No issues" description="Nothing matches the current filter." />
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
                  {i.isOpen === false ? (
                    <Badge tone="neutral">Closed</Badge>
                  ) : i.substatusIid != null && substatusName.get(i.substatusIid) ? (
                    <Badge tone="accent">{substatusName.get(i.substatusIid)}</Badge>
                  ) : (
                    <Badge tone="ok">Open</Badge>
                  )}
                </div>
                <div className="mt-1 line-clamp-2 text-sm font-medium text-ink">
                  {i.subject || '(no subject)'}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-subtle">
                  {i.priorityIid != null && priorityName.get(i.priorityIid) && (
                    <span>{priorityName.get(i.priorityIid)}</span>
                  )}
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
              Select an issue to view details.
            </div>
          ) : (
            <IssueDetail
              key={selected}
              iid={selected}
              priorityName={priorityName}
              substatusName={substatusName}
              typeName={typeName}
              classNameMap={classNameMap}
              orgName={orgName}
              userName={userName}
              substatuses={lookups.substatuses}
              users={lookups.users}
              onChanged={() => void load()}
            />
          )}
        </div>
      </div>

      {newOpen && (
        <NewIssueModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          lookups={lookups}
          defaultSubject=""
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  )
}

function IssueDetail({
  iid,
  priorityName,
  substatusName,
  typeName,
  classNameMap,
  orgName,
  userName,
  substatuses,
  users,
  onChanged,
}: {
  iid: number
  priorityName: Map<number, string>
  substatusName: Map<number, string>
  typeName: Map<number, string>
  classNameMap: Map<number, string>
  orgName: Map<number, string>
  userName: Map<number, string>
  substatuses: ItLookups['substatuses']
  users: ItLookups['users']
  onChanged: () => void
}) {
  const [issue, setIssue] = useState<ItIssue | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setIssue(await issuetrak.getIssue(iid))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [iid])

  useEffect(() => {
    void reload()
  }, [reload])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      await reload()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-ink-muted">
        Loading issue…
      </div>
    )
  }
  if (!issue) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
        {err ?? 'Could not load issue.'}
      </div>
    )
  }

  const notes: ItNote[] = Array.isArray(issue.notes) ? issue.notes : []

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-ink-subtle">#{issue.id ?? issue.iid}</div>
          <h2 className="mt-0.5 text-lg font-semibold text-ink">{issue.subject || '(no subject)'}</h2>
        </div>
        {issue.isOpen === false ? (
          <Badge tone="neutral">Closed</Badge>
        ) : (
          <Badge tone="ok">Open</Badge>
        )}
      </div>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {err}
        </div>
      )}

      {issue.description && (
        <div className="whitespace-pre-wrap rounded-md bg-content px-3 py-2 text-sm text-ink">
          {issue.description}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          {issue.priorityIid != null ? priorityName.get(issue.priorityIid) ?? issue.priorityIid : '—'}
        </Field>
        <Field label="Substatus">
          {issue.substatusIid != null ? substatusName.get(issue.substatusIid) ?? issue.substatusIid : '—'}
        </Field>
        <Field label="Type">
          {issue.issueTypeIid != null ? typeName.get(issue.issueTypeIid) ?? issue.issueTypeIid : '—'}
        </Field>
        <Field label="Class">
          {issue.classIid != null ? classNameMap.get(issue.classIid) ?? issue.classIid : '—'}
        </Field>
        <Field label="Organization">
          {issue.organizationIid != null ? orgName.get(issue.organizationIid) ?? issue.organizationIid : '—'}
        </Field>
        <Field label="Assigned to">
          {issue.assignedToUserIid != null ? userName.get(issue.assignedToUserIid) ?? issue.assignedToUserIid : 'Unassigned'}
        </Field>
        <Field label="Entered">{fmtDate(issue.enteredDate)}</Field>
        <Field label="Target">{fmtDate(issue.targetDate)}</Field>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
        <label className="flex flex-col gap-1 text-xs text-ink-subtle">
          Substatus
          <Select
            value={issue.substatusIid ?? ''}
            disabled={busy}
            onChange={(e) =>
              void run(() =>
                issuetrak.setSubstatus(iid, e.target.value === '' ? null : Number(e.target.value)),
              )
            }
          >
            <option value="">— none —</option>
            {substatuses.map((s) => (
              <option key={s.iid} value={s.iid}>
                {substatusName.get(s.iid) ?? s.iid}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-subtle">
          Assigned to
          <Select
            value={issue.assignedToUserIid ?? ''}
            disabled={busy}
            onChange={(e) =>
              void run(() => issuetrak.assign(iid, e.target.value === '' ? null : Number(e.target.value)))
            }
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.iid} value={u.iid}>
                {userName.get(u.iid) ?? u.iid}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {/* Notes */}
      <div className="border-t border-border pt-3">
        <div className="text-xs uppercase tracking-wide text-ink-subtle">Notes</div>
        <div className="mt-2 flex flex-col gap-2">
          {notes.length === 0 ? (
            <div className="text-sm text-ink-subtle">No notes yet.</div>
          ) : (
            notes.map((n, idx) => (
              <div key={n.iid ?? idx} className="rounded-md bg-content px-3 py-2 text-sm text-ink">
                <div className="whitespace-pre-wrap">{n.note ?? n.body ?? ''}</div>
                <div className="mt-1 text-xs text-ink-subtle">
                  {n.enteredByUserIid != null ? (userName.get(n.enteredByUserIid) ?? '') + ' · ' : ''}
                  {fmtDate(n.enteredDate)}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-3 flex items-start gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <Button
            size="sm"
            disabled={busy || !note.trim()}
            onClick={() =>
              void run(async () => {
                await issuetrak.addNote(iid, note.trim())
                setNote('')
              })
            }
          >
            <Send className="size-4" />
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}

function NewIssueModal({
  open,
  onClose,
  lookups,
  defaultSubject,
  onCreated,
  requesterName,
}: {
  open: boolean
  onClose: () => void
  lookups: ItLookups
  defaultSubject: string
  onCreated: () => void
  requesterName: string
}) {
  const [subject, setSubject] = useState(defaultSubject)
  const [description, setDescription] = useState('')
  const [priorityIid, setPriorityIid] = useState('')
  const [issueTypeIid, setIssueTypeIid] = useState('')
  const [classIid, setClassIid] = useState('')
  const [organizationIid, setOrganizationIid] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const priorityName = useMemo(() => nameMap(lookups.priorities), [lookups])
  const typeName = useMemo(() => nameMap(lookups.issueTypes), [lookups])
  const classNameMap = useMemo(() => nameMap(lookups.classes), [lookups])
  const orgName = useMemo(() => nameMap(lookups.organizations), [lookups])

  async function submit() {
    if (!subject.trim() || !description.trim()) {
      setErr('Subject and description are required.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = {
        subject: subject.trim(),
        description: description.trim(),
      }
      if (priorityIid) body.priorityIid = Number(priorityIid)
      if (issueTypeIid) body.issueTypeIid = Number(issueTypeIid)
      if (classIid) body.classIid = Number(classIid)
      if (organizationIid) body.organizationIid = Number(organizationIid)
      await issuetrak.createIssue(body)
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New issue" size="md">
      <div className="flex flex-col gap-3">
        {requesterName && (
          <div className="text-xs text-ink-subtle">Submitted by {requesterName}</div>
        )}
        {err && (
          <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
            {err}
          </div>
        )}
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
            Priority
            <Select value={priorityIid} onChange={(e) => setPriorityIid(e.target.value)}>
              <option value="">—</option>
              {lookups.priorities.map((p) => (
                <option key={p.iid} value={p.iid}>
                  {priorityName.get(p.iid) ?? p.iid}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Type
            <Select value={issueTypeIid} onChange={(e) => setIssueTypeIid(e.target.value)}>
              <option value="">—</option>
              {lookups.issueTypes.map((t) => (
                <option key={t.iid} value={t.iid}>
                  {typeName.get(t.iid) ?? t.iid}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Class
            <Select value={classIid} onChange={(e) => setClassIid(e.target.value)}>
              <option value="">—</option>
              {lookups.classes.map((c) => (
                <option key={c.iid} value={c.iid}>
                  {classNameMap.get(c.iid) ?? c.iid}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Organization
            <Select value={organizationIid} onChange={(e) => setOrganizationIid(e.target.value)}>
              <option value="">—</option>
              {lookups.organizations.map((o) => (
                <option key={o.iid} value={o.iid}>
                  {orgName.get(o.iid) ?? o.iid}
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
            {busy ? 'Creating…' : 'Create issue'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
