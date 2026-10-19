import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlarmClock, CalendarClock, CheckCircle2, ChevronDown, CircleDot, Columns3,
  Image as ImageIcon, LayoutList, ListChecks, MessageSquare, Plus, Search, Table2, X,
} from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  workOrders,
  STATUS_OPTIONS,
  WORK_TYPE_OPTIONS,
  type WorkOrderRow,
  type WorkOrderStatus,
  type WorkOrderPriority,
  type WorkOrderUpdate,
} from '@/lib/queries/workOrders'
import { NewWorkOrderModal } from './NewWorkOrderModal'
import { WorkOrderDetail } from './WorkOrderDetail'

// "Work Orders NEW" — a comprehensive, MaintainX-style work-order platform built
// on the SAME work_orders data as the legacy Work Orders page (nothing is moved
// or removed). Adds a KPI header, rich filtering, and List / Table / Board views,
// with full editing (status changes enabled) and local creation. Opens the shared
// WorkOrderDetail in a slide-over so every view keeps full width underneath.

type ViewMode = 'list' | 'table' | 'board'
type DueFilter = 'all' | 'overdue' | 'today' | 'week'
type SortKey = 'updated' | 'due' | 'priority' | 'number' | 'title' | 'status' | 'site'
type SortDir = 'asc' | 'desc'

const PRIORITY_RANK: Record<WorkOrderPriority, number> = { high: 0, medium: 1, low: 2, none: 3 }
const STATUS_RANK: Record<WorkOrderStatus, number> = { open: 0, in_progress: 1, on_hold: 2, done: 3, skipped: 4 }

const STATUS_TONE: Record<WorkOrderStatus, string> = {
  open: 'bg-accent-soft text-accent border-accent/30',
  on_hold: 'bg-warn-soft text-warn border-warn/30',
  in_progress: 'bg-accent-soft text-accent border-accent/30',
  done: 'bg-ok-soft text-ok border-ok/30',
  skipped: 'bg-danger-soft text-danger border-danger/30',
}
const PRIORITY_TONE: Record<WorkOrderPriority, string> = {
  none: 'text-ink-subtle',
  low: 'text-ok',
  medium: 'text-warn',
  high: 'text-danger',
}
const STATUS_LABEL = (s: WorkOrderStatus) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s
const PRIORITY_LABEL = (p: WorkOrderPriority) => (p === 'none' ? 'None' : p[0].toUpperCase() + p.slice(1))

// Columns shown on the Kanban board, in order. Skipped is intentionally left off
// the board (it's a terminal state reached from the detail/menu).
const BOARD_COLUMNS: WorkOrderStatus[] = ['open', 'in_progress', 'on_hold', 'done']

const isOpenish = (s: string) => s !== 'done' && s !== 'skipped'
const initials = (name: string) =>
  name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

const DAY = 86_400_000
type DueState = { label: string; tone: 'danger' | 'warn' | 'neutral'; overdue: boolean } | null
function dueInfo(due_at: string | null, status: string, now: number): DueState {
  if (!due_at) return null
  const t = new Date(due_at).getTime()
  const done = status === 'done' || status === 'skipped'
  const days = Math.floor((t - now) / DAY)
  if (!done && t < now) return { label: days === 0 ? 'Due today' : `${Math.abs(days)}d overdue`, tone: 'danger', overdue: true }
  if (!done && days <= 2) return { label: days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days}d`, tone: 'warn', overdue: false }
  return { label: format(new Date(due_at), 'MMM d'), tone: 'neutral', overdue: false }
}

export default function WorkOrdersNewPage() {
  const { profile } = useAuth()
  const { activeLocation } = useLocations()
  const { id: routeWoId } = useParams<{ id?: string }>()
  const navigate = useNavigate()

  const [rows, setRows] = useState<WorkOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const [view, setView] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [statuses, setStatuses] = useState<Set<WorkOrderStatus>>(new Set())
  const [priorities, setPriorities] = useState<Set<WorkOrderPriority>>(new Set())
  const [workType, setWorkType] = useState<string>('all')
  const [assignee, setAssignee] = useState<string>('all') // 'all' | 'me' | 'unassigned' | user_id
  const [due, setDue] = useState<DueFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await workOrders.list({ locationId: activeLocation?.id ?? null })
    setRows((data as unknown as WorkOrderRow[]) ?? [])
    setLoading(false)
  }, [activeLocation?.id])

  useEffect(() => { void load() }, [load])

  // Realtime: any WO / assignee / file change refreshes the list.
  useEffect(() => {
    if (!profile?.account_id) return
    const ch = supabase
      .channel('work-orders-new-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_assignees' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_files' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [profile?.account_id, load])

  const myId = profile?.id ?? ''
  const now = Date.now()

  // KPIs across every loaded work order (before filtering).
  const kpis = useMemo(() => {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    let open = 0, overdue = 0, dueWeek = 0, doneMonth = 0, highOpen = 0
    for (const w of rows) {
      const openish = isOpenish(w.status)
      if (openish) open++
      if (openish && w.priority === 'high') highOpen++
      if (openish && w.due_at) {
        const t = new Date(w.due_at).getTime()
        if (t < now) overdue++
        else if (t <= now + 7 * DAY) dueWeek++
      }
      if (w.status === 'done') {
        const c = w.completed_at ? new Date(w.completed_at).getTime() : new Date(w.updated_at).getTime()
        if (c >= monthStart) doneMonth++
      }
    }
    return { open, overdue, dueWeek, doneMonth, highOpen }
  }, [rows, now])

  // Assignees present in the data, for the assignee filter dropdown.
  const assigneeOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of rows) for (const a of w.assignees) m.set(a.user_id, a.user_name)
    return [...m.entries()].map(([user_id, user_name]) => ({ user_id, user_name })).sort((a, b) => a.user_name.localeCompare(b.user_name))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const compare = (a: WorkOrderRow, b: WorkOrderRow): number => {
      let n = 0
      switch (sortKey) {
        case 'updated': n = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(); break
        case 'due': n = (a.due_at ? new Date(a.due_at).getTime() : Infinity) - (b.due_at ? new Date(b.due_at).getTime() : Infinity); break
        case 'priority': n = (PRIORITY_RANK[a.priority as WorkOrderPriority] ?? 3) - (PRIORITY_RANK[b.priority as WorkOrderPriority] ?? 3); break
        case 'number': n = a.number - b.number; break
        case 'title': n = a.title.localeCompare(b.title); break
        case 'status': n = (STATUS_RANK[a.status as WorkOrderStatus] ?? 9) - (STATUS_RANK[b.status as WorkOrderStatus] ?? 9); break
        case 'site': n = (a.location?.name ?? '').localeCompare(b.location?.name ?? ''); break
      }
      return sortDir === 'asc' ? n : -n
    }
    return rows
      .filter((w) => {
        if (q && !w.title.toLowerCase().includes(q) && !String(w.number).includes(q) && !(w.description ?? '').toLowerCase().includes(q)) return false
        if (statuses.size > 0 && !statuses.has(w.status as WorkOrderStatus)) return false
        if (priorities.size > 0 && !priorities.has(w.priority as WorkOrderPriority)) return false
        if (workType !== 'all' && w.work_type !== workType) return false
        if (assignee === 'me' && !w.assignees.some((a) => a.user_id === myId)) return false
        else if (assignee === 'unassigned' && w.assignees.length > 0) return false
        else if (assignee !== 'all' && assignee !== 'me' && assignee !== 'unassigned' && !w.assignees.some((a) => a.user_id === assignee)) return false
        if (due !== 'all') {
          if (!w.due_at || !isOpenish(w.status)) return false
          const t = new Date(w.due_at).getTime()
          if (due === 'overdue' && !(t < now)) return false
          if (due === 'today' && !(t >= now - DAY && t < now + DAY)) return false
          if (due === 'week' && !(t <= now + 7 * DAY)) return false
        }
        return true
      })
      .sort(compare)
  }, [rows, search, statuses, priorities, workType, assignee, due, sortKey, sortDir, myId, now])

  const activeFilterCount =
    (statuses.size) + (priorities.size) + (workType !== 'all' ? 1 : 0) +
    (assignee !== 'all' ? 1 : 0) + (due !== 'all' ? 1 : 0) + (search.trim() ? 1 : 0)

  const clearFilters = () => {
    setSearch(''); setStatuses(new Set()); setPriorities(new Set())
    setWorkType('all'); setAssignee('all'); setDue('all')
  }

  const toggleStatus = (s: WorkOrderStatus) =>
    setStatuses((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n })
  const togglePriority = (p: WorkOrderPriority) =>
    setPriorities((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n })

  const setSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'title' || key === 'site' || key === 'due' ? 'asc' : 'desc') }
  }

  // Status change from the board (optimistic). Mirrors the detail's done/undone
  // handling so completed_at/by stay consistent.
  const changeStatus = async (id: string, status: WorkOrderStatus) => {
    const wo = rows.find((r) => r.id === id)
    if (!wo || wo.status === status) return
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    const patch: WorkOrderUpdate = { status }
    if (status === 'done') {
      patch.completed_at = new Date().toISOString()
      patch.completed_by = profile?.id ?? null
      patch.completed_by_name = profile?.name ?? null
    } else {
      patch.completed_at = null
      patch.completed_by = null
      patch.completed_by_name = null
    }
    const { error } = await workOrders.update(id, patch)
    if (error) void load()
  }

  const openWo = (id: string) => navigate(`/app/work-orders-new/${id}`)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-4 lg:px-8">
        <PageHeader
          title="Work Orders NEW"
          subtitle="Comprehensive work-order management — assign, schedule, track, and complete."
          actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Work Order</Button>}
        />

        {/* KPI header */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard icon={<ListChecks className="size-4" />} label="Open" value={kpis.open} tone="accent"
            onClick={() => { clearFilters(); setStatuses(new Set(['open', 'in_progress', 'on_hold'])) }} />
          <KpiCard icon={<AlarmClock className="size-4" />} label="Overdue" value={kpis.overdue} tone="danger"
            onClick={() => { clearFilters(); setDue('overdue') }} />
          <KpiCard icon={<CalendarClock className="size-4" />} label="Due this week" value={kpis.dueWeek} tone="warn"
            onClick={() => { clearFilters(); setDue('week') }} />
          <KpiCard icon={<CircleDot className="size-4" />} label="High priority" value={kpis.highOpen} tone="danger"
            onClick={() => { clearFilters(); setPriorities(new Set(['high'])); setStatuses(new Set(['open', 'in_progress', 'on_hold'])) }} />
          <KpiCard icon={<CheckCircle2 className="size-4" />} label="Done this month" value={kpis.doneMonth} tone="ok"
            onClick={() => { clearFilters(); setStatuses(new Set(['done'])) }} />
        </div>

        {/* Toolbar */}
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, number, or description…" className="h-9 pl-8 text-sm" />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-content p-0.5">
              <ViewTab active={view === 'list'} onClick={() => setView('list')} icon={<LayoutList className="size-4" />} label="List" />
              <ViewTab active={view === 'table'} onClick={() => setView('table')} icon={<Table2 className="size-4" />} label="Table" />
              <ViewTab active={view === 'board'} onClick={() => setView('board')} icon={<Columns3 className="size-4" />} label="Board" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <FilterGroup label="Status">
              {(['open', 'in_progress', 'on_hold', 'done', 'skipped'] as WorkOrderStatus[]).map((s) => (
                <Chip key={s} active={statuses.has(s)} onClick={() => toggleStatus(s)}>{STATUS_LABEL(s)}</Chip>
              ))}
            </FilterGroup>
            <FilterGroup label="Priority">
              {(['high', 'medium', 'low', 'none'] as WorkOrderPriority[]).map((p) => (
                <Chip key={p} active={priorities.has(p)} onClick={() => togglePriority(p)} tone={PRIORITY_TONE[p]}>{PRIORITY_LABEL(p)}</Chip>
              ))}
            </FilterGroup>
            <FilterGroup label="Due">
              {(['all', 'overdue', 'today', 'week'] as DueFilter[]).map((d) => (
                <Chip key={d} active={due === d} onClick={() => setDue(d)}>
                  {d === 'all' ? 'Any' : d === 'overdue' ? 'Overdue' : d === 'today' ? 'Today' : 'This week'}
                </Chip>
              ))}
            </FilterGroup>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="text-[11px] uppercase tracking-wider text-ink-subtle">Assignee</span>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-lg border border-border bg-content py-1.5 pl-2.5 pr-8 text-sm leading-normal text-ink">
                <option value="all">Anyone</option>
                <option value="me">Me</option>
                <option value="unassigned">Unassigned</option>
                {assigneeOptions.map((a) => <option key={a.user_id} value={a.user_id}>{a.user_name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="text-[11px] uppercase tracking-wider text-ink-subtle">Type</span>
              <select value={workType} onChange={(e) => setWorkType(e.target.value)} className="rounded-lg border border-border bg-content py-1.5 pl-2.5 pr-8 text-sm leading-normal text-ink">
                <option value="all">All</option>
                {WORK_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            {view !== 'board' && (
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="text-[11px] uppercase tracking-wider text-ink-subtle">Sort</span>
                <select value={sortKey} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border border-border bg-content py-1.5 pl-2.5 pr-8 text-sm leading-normal text-ink">
                  <option value="updated">Last updated</option>
                  <option value="due">Due date</option>
                  <option value="priority">Priority</option>
                  <option value="number">Number</option>
                  <option value="title">Title</option>
                </select>
              </label>
            )}
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink">
                <X className="size-3.5" /> Clear ({activeFilterCount})
              </button>
            )}
            <span className="ml-auto text-xs text-ink-subtle">{filtered.length} shown</span>
          </div>
        </div>
      </div>

      {/* Views */}
      <div className="mt-3 min-h-0 flex-1 overflow-hidden px-4 pb-4 lg:px-8">
        {loading ? (
          <p className="px-1 py-6 text-sm text-ink-muted">Loading work orders…</p>
        ) : filtered.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center text-sm text-ink-muted">
            No work orders match these filters.
          </div>
        ) : view === 'list' ? (
          <ListView rows={filtered} now={now} onOpen={openWo} />
        ) : view === 'table' ? (
          <TableView rows={filtered} now={now} onOpen={openWo} sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
        ) : (
          <BoardView rows={filtered} now={now} onOpen={openWo} onMove={changeStatus} />
        )}
      </div>

      {/* Detail slide-over */}
      {routeWoId && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => navigate('/app/work-orders-new')} />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col bg-card shadow-2xl lg:border-l lg:border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wider text-ink-subtle">Work Order</span>
              <button onClick={() => navigate('/app/work-orders-new')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-content hover:text-ink">
                <X className="size-4" /> Close
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <WorkOrderDetail
                workOrderId={routeWoId}
                statusEditEnabled
                onBack={() => navigate('/app/work-orders-new')}
                onChanged={load}
              />
            </div>
          </div>
        </div>
      )}

      {creating && (
        <NewWorkOrderModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void load(); navigate(`/app/work-orders-new/${id}`) }}
        />
      )}
    </div>
  )
}

// ---------- shared bits ----------------------------------------------------

function KpiCard({ icon, label, value, tone, onClick }: {
  icon: React.ReactNode; label: string; value: number
  tone: 'accent' | 'danger' | 'warn' | 'ok'; onClick: () => void
}) {
  const toneCls = {
    accent: 'text-accent bg-accent-soft',
    danger: 'text-danger bg-danger-soft',
    warn: 'text-warn bg-warn-soft',
    ok: 'text-ok bg-ok-soft',
  }[tone]
  return (
    <button onClick={onClick} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-accent/50">
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', toneCls)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xl font-bold tabular-nums text-ink">{value}</div>
        <div className="truncate text-[11px] text-ink-subtle">{label}</div>
      </div>
    </button>
  )
}

function ViewTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition', active ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}>
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] uppercase tracking-wider text-ink-subtle">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

function Chip({ active, onClick, children, tone }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium transition', active ? 'bg-accent text-white' : cn('bg-content hover:text-ink', tone ?? 'text-ink-muted'))}>
      {children}
    </button>
  )
}

function Avatars({ assignees }: { assignees: WorkOrderRow['assignees'] }) {
  if (assignees.length === 0) return <span className="text-[10px] text-ink-subtle">Unassigned</span>
  return (
    <div className="flex -space-x-1">
      {assignees.slice(0, 3).map((a) => (
        <span key={a.user_id} title={a.user_name} className="grid size-5 place-items-center rounded-full bg-accent/15 text-[8px] font-semibold text-accent ring-1 ring-card">
          {initials(a.user_name)}
        </span>
      ))}
      {assignees.length > 3 && <span className="ml-1.5 text-[10px] text-ink-subtle">+{assignees.length - 3}</span>}
    </div>
  )
}

function PriorityDot({ p }: { p: WorkOrderPriority }) {
  return <span className={cn('inline-block size-2.5 shrink-0 rounded-full', { none: 'bg-ink-subtle/40', low: 'bg-ok', medium: 'bg-warn', high: 'bg-danger' }[p])} />
}

function DueBadge({ due_at, status, now }: { due_at: string | null; status: string; now: number }) {
  const d = dueInfo(due_at, status, now)
  if (!d) return null
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
      d.tone === 'danger' ? 'bg-danger-soft text-danger' : d.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-content text-ink-muted')}>
      <CalendarClock className="size-3" /> {d.label}
    </span>
  )
}

function MetaRow({ wo }: { wo: WorkOrderRow }) {
  const photoCount = wo.photo_count?.[0]?.count ?? 0
  const commentCount = wo.comment_count?.[0]?.count ?? 0
  return (
    <div className="flex items-center gap-2 text-[10px] text-ink-subtle">
      {wo.categories.slice(0, 1).map((c, i) => c.category && (
        <span key={i} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5" style={{ backgroundColor: c.category.color + '22', color: c.category.color }}>{c.category.name}</span>
      ))}
      {photoCount > 0 && <span className="inline-flex items-center gap-0.5"><ImageIcon className="size-3" /> {photoCount}</span>}
      {commentCount > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" /> {commentCount}</span>}
    </div>
  )
}

// ---------- List view ------------------------------------------------------

function ListView({ rows, now, onOpen }: { rows: WorkOrderRow[]; now: number; onOpen: (id: string) => void }) {
  // Group by status in a sensible order.
  const groups = BOARD_COLUMNS.concat('skipped' as WorkOrderStatus)
    .map((s) => ({ status: s, items: rows.filter((r) => r.status === s) }))
    .filter((g) => g.items.length > 0)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        {groups.map((g) => (
          <Section key={g.status} title={STATUS_LABEL(g.status)} count={g.items.length} status={g.status}>
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {g.items.map((w) => (
                <button key={w.id} onClick={() => onOpen(w.id)} className="flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-content">
                  <div className="mt-1"><PriorityDot p={w.priority as WorkOrderPriority} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate text-[15px] font-medium text-ink">{w.title}</div>
                      <span className="shrink-0 text-[11px] text-ink-subtle">#{w.number}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-subtle">
                      {w.location && <span className="truncate">{w.location.name}</span>}
                      {w.equipment && <><span>·</span><span className="truncate">{w.equipment.name}</span></>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <DueBadge due_at={w.due_at} status={w.status} now={now} />
                      <MetaRow wo={w} />
                      <div className="ml-auto"><Avatars assignees={w.assignees} /></div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Section>
        ))}
      </div>
    </div>
  )
}

function Section({ title, count, status, children }: { title: string; count: number; status: WorkOrderStatus; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="mb-1.5 flex w-full items-center gap-2 text-left">
        <ChevronDown className={cn('size-4 text-ink-subtle transition', open ? '' : '-rotate-90')} />
        <span className={cn('rounded border px-1.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[status])}>{title}</span>
        <span className="text-xs text-ink-subtle">{count}</span>
      </button>
      {open && children}
    </div>
  )
}

// ---------- Table view -----------------------------------------------------

function SortTh({ k, label, align = 'left', sortKey, sortDir, onSort }: {
  k?: SortKey; label: string; align?: 'left' | 'right'
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void
}) {
  return (
    <th className={cn('px-3 py-2 font-medium', align === 'right' ? 'text-right' : 'text-left')}>
      {k ? (
        <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-ink">
          {label}{sortKey === k && <ChevronDown className={cn('size-3', sortDir === 'asc' ? 'rotate-180' : '')} />}
        </button>
      ) : label}
    </th>
  )
}

function TableView({ rows, now, onOpen, sortKey, sortDir, onSort }: {
  rows: WorkOrderRow[]; now: number; onOpen: (id: string) => void
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void
}) {
  const th = { sortKey, sortDir, onSort }
  return (
    <div className="h-full overflow-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="sticky top-0 z-10 bg-content text-[11px] uppercase tracking-wide text-ink-subtle">
          <tr>
            <SortTh k="number" label="#" {...th} />
            <SortTh k="title" label="Title" {...th} />
            <SortTh k="status" label="Status" {...th} />
            <SortTh k="priority" label="Priority" {...th} />
            <SortTh k="site" label="Site" {...th} />
            <SortTh label="Asset" {...th} />
            <SortTh label="Assignees" {...th} />
            <SortTh k="due" label="Due" {...th} />
            <SortTh k="updated" label="Updated" align="right" {...th} />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((w) => (
            <tr key={w.id} onClick={() => onOpen(w.id)} className="cursor-pointer transition hover:bg-content">
              <td className="px-3 py-2 text-[11px] text-ink-subtle tabular-nums">#{w.number}</td>
              <td className="px-3 py-2"><div className="flex items-center gap-2"><PriorityDot p={w.priority as WorkOrderPriority} /><span className="font-medium text-ink">{w.title}</span></div></td>
              <td className="px-3 py-2"><span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', STATUS_TONE[w.status as WorkOrderStatus])}>{STATUS_LABEL(w.status as WorkOrderStatus)}</span></td>
              <td className={cn('px-3 py-2 text-[12px] font-medium', PRIORITY_TONE[w.priority as WorkOrderPriority])}>{PRIORITY_LABEL(w.priority as WorkOrderPriority)}</td>
              <td className="px-3 py-2 text-ink-muted">{w.location?.name ?? '—'}</td>
              <td className="px-3 py-2 text-ink-muted">{w.equipment?.name ?? '—'}</td>
              <td className="px-3 py-2"><Avatars assignees={w.assignees} /></td>
              <td className="px-3 py-2"><DueBadge due_at={w.due_at} status={w.status} now={now} /></td>
              <td className="px-3 py-2 text-right text-[11px] text-ink-subtle">{format(new Date(w.updated_at), 'MMM d')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Board view -----------------------------------------------------

function BoardView({ rows, now, onOpen, onMove }: {
  rows: WorkOrderRow[]; now: number; onOpen: (id: string) => void
  onMove: (id: string, status: WorkOrderStatus) => void
}) {
  const [dragOver, setDragOver] = useState<WorkOrderStatus | null>(null)
  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-2">
      {BOARD_COLUMNS.map((col) => {
        const items = rows.filter((r) => r.status === col)
        return (
          <div
            key={col}
            onDragOver={(e) => { e.preventDefault(); setDragOver(col) }}
            onDragLeave={() => setDragOver((c) => (c === col ? null : c))}
            onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) onMove(id, col) }}
            className={cn('flex w-[280px] shrink-0 flex-col rounded-xl border bg-content/40', dragOver === col ? 'border-accent' : 'border-border')}
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className={cn('rounded border px-1.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[col])}>{STATUS_LABEL(col)}</span>
              <span className="text-xs text-ink-subtle">{items.length}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {items.map((w) => (
                <div
                  key={w.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', w.id)}
                  onClick={() => onOpen(w.id)}
                  className="cursor-pointer rounded-lg border border-border bg-card p-2.5 shadow-sm transition hover:border-accent/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5"><PriorityDot p={w.priority as WorkOrderPriority} /><span className="text-[10px] text-ink-subtle">#{w.number}</span></div>
                    <DueBadge due_at={w.due_at} status={w.status} now={now} />
                  </div>
                  <div className="mt-1 line-clamp-2 text-[13px] font-medium text-ink">{w.title}</div>
                  <div className="mt-0.5 truncate text-[11px] text-ink-subtle">{w.location?.name}{w.equipment ? ` · ${w.equipment.name}` : ''}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <MetaRow wo={w} />
                    <Avatars assignees={w.assignees} />
                  </div>
                </div>
              ))}
              {items.length === 0 && <div className="px-2 py-6 text-center text-[11px] text-ink-subtle">Drop here</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
