import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Hammer, Plus, MapPin, Loader2, Trash2, Send, CircleUser } from 'lucide-react'
import { format } from 'date-fns'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { listUsers, type AccountUser } from '@/lib/queries/account'
import { facilities, type FacilityRequest, type FacilityUpdate } from '@/lib/queries/facilities'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/layout/PageHeader'

const STATUSES = [
  { key: 'new', label: 'New', cls: 'bg-warn-soft text-warn' },
  { key: 'in_progress', label: 'In Progress', cls: 'bg-accent-soft text-accent' },
  { key: 'on_hold', label: 'On Hold', cls: 'bg-ink/10 text-ink-muted' },
  { key: 'completed', label: 'Completed', cls: 'bg-ok-soft text-ok' },
] as const
const PRIORITIES = [
  { key: 'urgent', label: 'Urgent', cls: 'bg-danger-soft text-danger' },
  { key: 'high', label: 'High', cls: 'bg-warn-soft text-warn' },
  { key: 'normal', label: 'Normal', cls: 'bg-ink/10 text-ink-muted' },
  { key: 'low', label: 'Low', cls: 'bg-ink/5 text-ink-subtle' },
] as const
const CATEGORIES = ['General', 'Plumbing', 'Electrical', 'HVAC', 'Building', 'Grounds', 'Equipment', 'Safety', 'IT / Tech', 'Signage', 'Other']

const statusMeta = (s: string | null) => STATUSES.find((x) => x.key === s) ?? { key: s ?? 'new', label: s ?? 'New', cls: 'bg-ink/10 text-ink-muted' }
const priorityMeta = (p: string | null) => PRIORITIES.find((x) => x.key === p) ?? { key: p ?? 'normal', label: p ?? 'Normal', cls: 'bg-ink/10 text-ink-muted' }
const Badge = ({ cls, children }: { cls: string; children: ReactNode }) => (
  <span className={cn('inline-block w-fit rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>{children}</span>
)

export default function ServiceBoardPage() {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const [rows, setRows] = useState<FacilityRequest[]>([])
  const [team, setTeam] = useState<AccountUser[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const canManage = ['owner', 'manager', 'technician'].includes(profile?.role ?? '')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await facilities.list()
    setRows((data as FacilityRequest[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void listUsers().then(({ data }) => setTeam(((data ?? []) as AccountUser[]).filter((u) => ['owner', 'manager', 'technician'].includes(u.role))))
  }, [])

  const open = rows.find((r) => r.id === openId) ?? null
  const byStatus = useMemo(() => {
    const m: Record<string, FacilityRequest[]> = {}
    for (const s of STATUSES) m[s.key] = []
    for (const r of rows) if (m[r.status ?? 'new']) m[r.status ?? 'new'].push(r)
    return m
  }, [rows])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Service Board"
        subtitle="Requests for facilities service. Submit a request and track it from New to Completed."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New request</Button>}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /> Loading requests…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Hammer className="mx-auto size-8 text-ink-subtle" />
          <p className="mt-3 font-medium text-ink">No service requests yet</p>
          <p className="mt-1 text-sm text-ink-muted">Click “New request” to submit the first one. The facilities team will pick it up and post progress here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((s) => (
            <div key={s.key} className="flex min-w-0 flex-col rounded-xl border border-border bg-content/40">
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Badge cls={s.cls}>{s.label}</Badge></span>
                <span className="text-xs font-medium text-ink-subtle">{byStatus[s.key].length}</span>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {byStatus[s.key].length === 0 && <p className="px-2 py-4 text-center text-xs text-ink-subtle">Nothing here</p>}
                {byStatus[s.key].map((r) => {
                  const pm = priorityMeta(r.priority)
                  return (
                    <button
                      key={r.id}
                      onClick={() => setOpenId(r.id)}
                      className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-left shadow-sm hover:border-accent"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-ink">{r.title}</span>
                        {r.priority !== 'normal' && <Badge cls={pm.cls}>{pm.label}</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                        <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{r.location?.name ?? 'All sites'}</span>
                        <span>{r.category}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-ink-subtle">
                        <span className="inline-flex items-center gap-1"><CircleUser className="size-3.5" />{r.assigned_to_name || 'Unassigned'}</span>
                        <span>{timeAgo(r.created_at)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <NewRequestModal
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void load() }}
          currentUser={{ id: profile?.id ?? null, name: profile?.name ?? '', accountId: profile?.account_id ?? '' }}
        />
      )}

      {open && (
        <DetailModal
          request={open}
          team={team}
          canManage={canManage}
          currentUser={{ id: profile?.id ?? null, name: profile?.name ?? '', accountId: profile?.account_id ?? '' }}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onDeleted={() => { setOpenId(null); void load() }}
        />
      )}
    </div>
  )
}

type CurrentUser = { id: string | null; name: string; accountId: string }

function NewRequestModal({ locations, currentUser, onClose, onCreated }: {
  locations: { id: string; name: string }[]
  currentUser: CurrentUser
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [locationId, setLocationId] = useState('')
  const [category, setCategory] = useState('General')
  const [priority, setPriority] = useState('normal')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim() || !currentUser.accountId) return
    setSaving(true)
    await facilities.create({
      account_id: currentUser.accountId,
      location_id: locationId || null,
      title: title.trim(),
      description: description.trim() || null,
      category,
      priority,
      status: 'new',
      requested_by: currentUser.id,
      requested_by_name: currentUser.name || null,
    })
    setSaving(false)
    onCreated()
  }

  return (
    <Modal open onClose={onClose} title="New service request" size="md">
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-ink">
          What needs service?
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lobby light out, dumpster gate broken" className="mt-1" autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-ink">
            Site
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink">
              <option value="">All sites</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <label className="text-sm font-medium text-ink">
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink">
            {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">
          Details
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Anything the facilities team should know." className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink" />
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !title.trim()} onClick={() => void submit()}>{saving ? 'Submitting…' : 'Submit request'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function DetailModal({ request, team, canManage, currentUser, onClose, onChanged, onDeleted }: {
  request: FacilityRequest
  team: AccountUser[]
  canManage: boolean
  currentUser: CurrentUser
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [updates, setUpdates] = useState<FacilityUpdate[] | null>(null)
  const [note, setNote] = useState('')
  const [posting, setPosting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pm = priorityMeta(request.priority)
  const sm = statusMeta(request.status)

  const loadUpdates = useCallback(async () => {
    const { data } = await facilities.updates(request.id)
    setUpdates((data as FacilityUpdate[] | null) ?? [])
  }, [request.id])
  useEffect(() => { void loadUpdates() }, [loadUpdates])

  const logStatus = async (label: string, status: string) => {
    if (!currentUser.accountId) return
    await facilities.addUpdate({ request_id: request.id, account_id: currentUser.accountId, author_id: currentUser.id, author_name: currentUser.name || null, note: label, status })
  }

  const setStatus = async (status: string) => {
    await facilities.update(request.id, { status, completed_at: status === 'completed' ? new Date().toISOString() : null })
    await logStatus(`Status set to ${statusMeta(status).label}`, status)
    await loadUpdates()
    onChanged()
  }
  const setPriority = async (priority: string) => { await facilities.update(request.id, { priority }); onChanged() }
  const setAssignee = async (userId: string) => {
    const u = team.find((t) => t.id === userId)
    await facilities.update(request.id, { assigned_to: userId || null, assigned_to_name: u?.name ?? null })
    onChanged()
  }
  const postUpdate = async () => {
    if (!note.trim() || !currentUser.accountId) return
    setPosting(true)
    await facilities.addUpdate({ request_id: request.id, account_id: currentUser.accountId, author_id: currentUser.id, author_name: currentUser.name || null, note: note.trim(), status: null })
    setNote('')
    setPosting(false)
    await loadUpdates()
  }
  const del = async () => { await facilities.remove(request.id); onDeleted() }

  const selectCls = 'rounded-md border border-border bg-card px-2 py-1.5 text-sm text-ink'

  return (
    <Modal open onClose={onClose} title={request.title} size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge cls={sm.cls}>{sm.label}</Badge>
          <Badge cls={pm.cls}>{pm.label} priority</Badge>
          <span className="inline-flex items-center gap-1 text-sm text-ink-muted"><MapPin className="size-4" />{request.location?.name ?? 'All sites'}</span>
          <span className="text-sm text-ink-muted">· {request.category}</span>
        </div>

        {request.description && <p className="whitespace-pre-wrap rounded-lg bg-content p-3 text-sm text-ink">{request.description}</p>}

        <div className="text-xs text-ink-subtle">
          Requested by {request.requested_by_name || 'someone'} · {format(new Date(request.created_at), 'PPp')}
        </div>

        {canManage && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-ink-subtle">
              Status
              <select value={request.status ?? 'new'} onChange={(e) => void setStatus(e.target.value)} className={cn('mt-1 block w-full', selectCls)}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="text-xs font-medium text-ink-subtle">
              Priority
              <select value={request.priority ?? 'normal'} onChange={(e) => void setPriority(e.target.value)} className={cn('mt-1 block w-full', selectCls)}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-ink-subtle">
              Assigned to
              <select value={request.assigned_to ?? ''} onChange={(e) => void setAssignee(e.target.value)} className={cn('mt-1 block w-full', selectCls)}>
                <option value="">Unassigned</option>
                {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {/* Progress log */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Progress</div>
          <div className="flex flex-col gap-2">
            {updates === null ? (
              <div className="flex items-center gap-2 text-sm text-ink-subtle"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            ) : updates.length === 0 ? (
              <p className="text-sm text-ink-subtle">No updates yet.</p>
            ) : (
              updates.map((u) => (
                <div key={u.id} className="rounded-lg border border-border bg-card p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2 text-xs text-ink-subtle">
                    <span className="font-medium text-ink-muted">{u.author_name || 'Someone'}</span>
                    <span>{timeAgo(u.created_at)}</span>
                  </div>
                  <div className="mt-0.5 text-ink">{u.status ? <Badge cls={statusMeta(u.status).cls}>{u.note}</Badge> : u.note}</div>
                </div>
              ))
            )}
          </div>
          <div className="mt-2 flex items-end gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Add a progress update or comment…"
              className="min-h-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-ink"
            />
            <Button size="sm" disabled={posting || !note.trim()} onClick={() => void postUpdate()}><Send className="size-4" /> Post</Button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          {canManage ? (
            confirmDelete ? (
              <span className="flex items-center gap-2">
                <Button variant="danger" size="sm" onClick={() => void del()}><Trash2 className="size-4" /> Delete request</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" /> Delete</Button>
            )
          ) : <span />}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}
