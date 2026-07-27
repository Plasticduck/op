import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { teams, type Team, type TeamWithMembers } from '@/lib/queries/teams'
import type { WorkOrderStatus } from '@/lib/queries/workOrders'

type DirUser = { id: string; name: string | null; email: string }
type RelatedWO = {
  id: string
  number: number
  title: string
  status: WorkOrderStatus
  priority: string
  completed_at: string | null
  created_at: string
}

const PRESET_COLORS = ['#2563eb', '#dc2626', '#eab308', '#8b5cf6', '#22c55e', '#f97316', '#0ea5e9', '#64748b', '#a855f7', '#10b981']

export default function TeamsPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<TeamWithMembers[]>([])
  const [dir, setDir] = useState<DirUser[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [related, setRelated] = useState<RelatedWO[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<TeamWithMembers | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: t }, { data: u }] = await Promise.all([
      teams.list(),
      supabase.from('users').select('id, name, email').order('name'),
    ])
    setRows((t as TeamWithMembers[] | null) ?? [])
    setDir((u as DirUser[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const loadRelated = useCallback(async (teamId: string) => {
    setRelatedLoading(true)
    const { data } = await supabase
      .from('work_order_teams')
      .select('work_order:work_orders(id, number, title, status, priority, completed_at, created_at)')
      .eq('team_id', teamId)
    const list = ((data as Array<{ work_order: RelatedWO | null }> | null) ?? [])
      .map((r) => r.work_order)
      .filter((w): w is RelatedWO => !!w)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setRelated(list)
    setRelatedLoading(false)
  }, [])

  useEffect(() => { if (activeId) void loadRelated(activeId) }, [activeId, loadRelated])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((t) => t.name.toLowerCase().includes(q))
  }, [rows, search])

  const active = rows.find((t) => t.id === activeId) ?? null
  const nameOf = (id: string) => dir.find((u) => u.id === id)?.name || dir.find((u) => u.id === id)?.email || 'Member'

  const removeTeam = async (t: Team) => {
    if (!window.confirm(`Delete "${t.name}"? Work orders assigned to it lose the tag.`)) return
    await teams.remove(t.id)
    if (activeId === t.id) setActiveId(null)
    void load()
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4">
      <div className="hidden lg:block lg:pb-4">
        <PageHeader
          title="Teams"
          subtitle="Group people into teams you can assign work orders to."
          actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Team</Button>}
        />
      </div>

      <div className="grid h-full min-h-0 flex-1 gap-0 lg:gap-4 lg:grid-cols-[340px_1fr]">
        {/* List */}
        <div className={cn('flex min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border', activeId ? 'hidden lg:flex' : 'flex')}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 lg:hidden">
            <h1 className="text-lg font-semibold text-ink">Teams</h1>
            <button onClick={() => setCreating(true)} className="grid size-9 place-items-center rounded-full bg-accent text-white hover:bg-accent-hover" aria-label="New team">
              <Plus className="size-4" />
            </button>
          </div>
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teams..." className="h-9 pl-8 text-sm" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {loading ? (
              <p className="px-3 py-4 text-sm text-ink-muted">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-muted">No teams yet.</p>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveId(t.id)}
                  className={cn('flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-left transition', activeId === t.id ? 'bg-accent-soft' : 'hover:bg-content')}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-subtle">{t.members?.length ?? 0}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className={cn('min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border', activeId ? 'flex' : 'hidden lg:flex')}>
          {active ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-2 py-2.5 sm:px-4 sm:py-3">
                <button type="button" onClick={() => setActiveId(null)} className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content lg:hidden" aria-label="Back">
                  <ArrowLeft className="size-5" />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="size-4 shrink-0 rounded-full" style={{ backgroundColor: active.color }} />
                  <h2 className="truncate text-lg font-semibold text-ink">{active.name}</h2>
                  <span className="hidden rounded-full bg-content px-2 py-0.5 text-xs font-medium text-ink-muted sm:inline">{active.members?.length ?? 0} members</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(active)}><Pencil className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => void removeTeam(active)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                {active.description && <p className="mb-4 text-sm text-ink-muted">{active.description}</p>}

                <h3 className="mb-2 text-sm font-semibold text-ink">Members</h3>
                {(active.members?.length ?? 0) === 0 ? (
                  <p className="mb-4 text-sm text-ink-muted">No members yet. Edit the team to add people.</p>
                ) : (
                  <div className="mb-5 flex flex-wrap gap-1.5">
                    {active.members.map((m) => (
                      <span key={m.user_id} className="rounded-full bg-content px-2.5 py-1 text-xs font-medium text-ink">{nameOf(m.user_id)}</span>
                    ))}
                  </div>
                )}

                <h3 className="mb-3 text-sm font-semibold text-ink">Assigned Work Orders</h3>
                {relatedLoading ? (
                  <p className="text-sm text-ink-muted"><Loader2 className="inline size-4 animate-spin" /> Loading...</p>
                ) : related.length === 0 ? (
                  <p className="text-sm text-ink-muted">No work orders assigned to this team yet.</p>
                ) : (
                  <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {related.map((w) => (
                      <button key={w.id} type="button" onClick={() => navigate(`/app/work-orders/${w.id}`)} className="flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-content">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate text-sm font-medium text-ink">{w.title}</span>
                            <span className="text-[10px] text-ink-subtle">#{w.number}</span>
                          </div>
                          {w.completed_at ? (
                            <p className="text-[11px] text-ok">Completed {format(new Date(w.completed_at), 'MM/dd/yyyy')}</p>
                          ) : (
                            <p className="text-[11px] text-ink-subtle">Created {format(new Date(w.created_at), 'MM/dd/yyyy')}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[11px]">
                          {w.priority !== 'none' && <Badge tone={w.priority === 'high' ? 'danger' : w.priority === 'medium' ? 'warn' : 'ok'}>{w.priority}</Badge>}
                          <Badge tone={w.status === 'done' ? 'ok' : w.status === 'on_hold' ? 'warn' : 'accent'}>{w.status.replace('_', ' ')}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-ink-muted">
              <div>
                <Users className="mx-auto mb-2 size-10 text-ink-subtle/60" />
                Pick a team to see its members and work orders.
              </div>
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && (
        <TeamEditModal
          accountId={profile?.account_id ?? ''}
          team={editing}
          dir={dir}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); void load() }}
        />
      )}
    </div>
  )
}

function TeamEditModal({
  accountId, team, dir, onClose, onSaved,
}: {
  accountId: string
  team: TeamWithMembers | null
  dir: DirUser[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(team?.name ?? '')
  const [color, setColor] = useState(team?.color ?? '#2563eb')
  const [description, setDescription] = useState(team?.description ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(team?.members?.map((m) => m.user_id) ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const save = async () => {
    setError(null)
    if (!name.trim()) return setError('Enter a name')
    setBusy(true)
    let teamId = team?.id
    if (team) {
      const { error: err } = await teams.update(team.id, { name: name.trim(), color, description: description.trim() || null })
      if (err) { setBusy(false); return setError(err.message) }
    } else {
      const { data, error: err } = await teams.create({ account_id: accountId, name: name.trim(), color, description: description.trim() || null })
      if (err || !data) { setBusy(false); return setError(err?.message ?? 'Could not create team') }
      teamId = data.id
    }
    if (teamId) await teams.setMembers(teamId, memberIds)
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={team ? 'Edit team' : 'New team'}>
      <div className="flex flex-col gap-4">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Description">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />}</Field>
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Color</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className={cn('size-7 rounded-full border-2 transition', color === c ? 'border-ink' : 'border-transparent hover:border-ink/30')} style={{ backgroundColor: c }} aria-label={c} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Members</div>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
            {dir.length === 0 ? (
              <p className="px-3 py-2 text-sm text-ink-muted">No people found.</p>
            ) : dir.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-content">
                <input type="checkbox" checked={memberIds.includes(u.id)} onChange={() => toggle(u.id)} className="size-4 accent-accent" />
                <span className="text-ink">{u.name || u.email}</span>
              </label>
            ))}
          </div>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{team ? 'Save' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}
