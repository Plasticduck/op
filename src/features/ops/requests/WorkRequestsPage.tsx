import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, Inbox, LinkIcon, Plus, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { workOrders } from '@/lib/queries/workOrders'
import { workRequests, portalUrl, type WorkRequestRow, type PortalRow } from '@/lib/queries/workRequests'

type Tab = 'pending' | 'all' | 'portals'

export default function WorkRequestsPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('pending')
  const [reqs, setReqs] = useState<WorkRequestRow[]>([])
  const [portals, setPortals] = useState<PortalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [creatingPortal, setCreatingPortal] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: r }, { data: p }] = await Promise.all([
      workRequests.list(tab === 'portals' ? 'all' : tab),
      workRequests.portals(),
    ])
    setReqs((r as WorkRequestRow[] | null) ?? [])
    setPortals((p as PortalRow[] | null) ?? [])
    setLoading(false)
  }, [tab])
  useEffect(() => { void load() }, [load])

  const flashMsg = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 3000) }

  const approve = async (r: WorkRequestRow) => {
    if (!profile) return
    setBusyId(r.id)
    const { data: wo, error } = await workOrders.create({
      account_id: r.account_id,
      location_id: r.location_id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      equipment_id: r.equipment_id,
      created_by: profile.id,
      created_by_name: (profile.name ?? '').trim() || profile.email,
      requested_by_name: r.requester_name || 'Work request',
    })
    if (error || !wo) { setBusyId(null); return flashMsg(error?.message ?? 'Could not create work order') }
    await workRequests.review(r.id, { status: 'approved', work_order_id: wo.id, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    setBusyId(null)
    navigate(`/app/work-orders/${wo.id}`)
  }

  const decline = async (r: WorkRequestRow) => {
    if (!profile) return
    setBusyId(r.id)
    await workRequests.review(r.id, { status: 'declined', reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    setBusyId(null)
    void load()
  }

  const copyLink = async (token: string) => {
    try { await navigator.clipboard.writeText(portalUrl(token)); setCopied(token); setTimeout(() => setCopied(null), 2000) } catch { /* ignore */ }
  }

  const removePortal = async (id: string) => {
    if (!window.confirm('Delete this request link? It will stop working.')) return
    await workRequests.removePortal(id)
    void load()
  }

  const statusTone = (s: string) => (s === 'approved' ? 'ok' : s === 'declined' ? 'neutral' : 'warn')

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 lg:px-8">
      <PageHeader
        title="Work Requests"
        subtitle="Review requests from staff and turn them into work orders."
        actions={tab === 'portals' ? <Button onClick={() => setCreatingPortal(true)}><Plus className="size-4" /> New Link</Button> : undefined}
      />

      {flash && <div className="mt-3 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">{flash}</div>}

      <div className="mt-3 inline-flex overflow-hidden rounded-md border border-border">
        {(['pending', 'all', 'portals'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('border-l border-border px-4 py-1.5 text-sm font-medium capitalize first:border-l-0', tab === t ? 'bg-accent-soft text-accent' : 'bg-card text-ink-muted hover:text-ink')}>
            {t === 'portals' ? 'Request Links' : t}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-ink-muted">Loading...</p>
        ) : tab === 'portals' ? (
          <div className="flex flex-col gap-2">
            {portals.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
                <LinkIcon className="mx-auto mb-2 size-8 text-ink-subtle/60" />
                No request links yet. Create one to share a public form.
              </div>
            ) : portals.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                    {!p.active && <Badge tone="neutral">Off</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-ink-subtle">{portalUrl(p.token)}{p.location ? ` · ${p.location.name}` : ' · All sites'}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="secondary" size="sm" onClick={() => void copyLink(p.token)}>{copied === p.token ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void removePortal(p.id)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        ) : reqs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
            <Inbox className="mx-auto mb-2 size-8 text-ink-subtle/60" />
            No {tab === 'pending' ? 'pending ' : ''}requests.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {reqs.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{r.title}</span>
                    {r.priority !== 'none' && <Badge tone={r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warn' : 'ok'}>{r.priority}</Badge>}
                    {r.status !== 'pending' && <Badge tone={statusTone(r.status)}>{r.status}</Badge>}
                  </div>
                  {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{r.description}</p>}
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-ink-subtle">
                    <span>{r.location?.name ?? 'Site'}</span>
                    {r.requester_name && <span>From {r.requester_name}</span>}
                    <span>{format(new Date(r.created_at), 'MMM d, h:mm a')}</span>
                    {r.work_order_id && <button onClick={() => navigate(`/app/work-orders/${r.work_order_id}`)} className="text-accent hover:underline">View work order</button>}
                  </div>
                </div>
                {r.status === 'pending' && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" disabled={busyId === r.id} onClick={() => void approve(r)}><Check className="size-3.5" /> Approve</Button>
                    <Button variant="ghost" size="sm" disabled={busyId === r.id} onClick={() => void decline(r)}><X className="size-3.5" /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {creatingPortal && (
        <NewPortalModal
          accountId={profile?.account_id ?? ''}
          onClose={() => setCreatingPortal(false)}
          onCreated={() => { setCreatingPortal(false); void load() }}
        />
      )}
    </div>
  )
}

function NewPortalModal({ accountId, onClose, onCreated }: { accountId: string; onClose: () => void; onCreated: () => void }) {
  const { locations } = useLocations()
  const [name, setName] = useState('Work Requests')
  const [locationId, setLocationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    if (!name.trim()) return setError('Enter a name')
    setBusy(true)
    const { error: err } = await workRequests.createPortal({ account_id: accountId, name: name.trim(), location_id: locationId || null })
    setBusy(false)
    if (err) return setError(err.message)
    onCreated()
  }
  return (
    <Modal open onClose={onClose} title="New request link">
      <div className="flex flex-col gap-4">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Site">{(id) => (
          <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All sites (requester picks)</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy}>Create link</Button>
        </div>
      </div>
    </Modal>
  )
}
