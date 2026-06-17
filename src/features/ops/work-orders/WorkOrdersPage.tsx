import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, Circle, ImageIcon, MessageSquare, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  workOrders,
  type WorkOrderRow,
  type WorkOrderStatus,
  type WorkOrderPriority,
} from '@/lib/queries/workOrders'
import { NewWorkOrderModal } from './NewWorkOrderModal'
import { WorkOrderDetail } from './WorkOrderDetail'

type Tab = 'todo' | 'done'

const PRIORITY_RANK: Record<WorkOrderPriority, number> = { high: 0, medium: 1, low: 2, none: 3 }
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

export default function WorkOrdersPage() {
  const { profile } = useAuth()
  const { activeLocation } = useLocations()
  const { id: routeWoId } = useParams<{ id?: string }>()
  const navigate = useNavigate()

  const [rows, setRows] = useState<WorkOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('todo')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<{ equipment_id?: string; equipment_name?: string; part_id?: string; part_name?: string } | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<WorkOrderPriority | 'all'>('all')

  // The Asset / Part "Use in New Work Order" buttons drop a prefill in
  // sessionStorage and navigate here. Auto-open the modal with those defaults
  // the first time we mount with one waiting.
  useEffect(() => {
    const raw = sessionStorage.getItem('newWO.prefill')
    if (!raw) return
    sessionStorage.removeItem('newWO.prefill')
    try {
      setCreatePrefill(JSON.parse(raw))
      setCreating(true)
    } catch {
      // bad JSON; just ignore
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await workOrders.list({ locationId: activeLocation?.id ?? null })
    setRows((data as unknown as WorkOrderRow[]) ?? [])
    setLoading(false)
  }, [activeLocation?.id])

  useEffect(() => { void load() }, [load])

  // Realtime: any WO change refreshes the list. Detail pane handles itself.
  useEffect(() => {
    if (!profile?.account_id) return
    const ch = supabase
      .channel('work-orders-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_assignees' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_files' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [profile?.account_id, load])

  const myId = profile?.id ?? ''

  const { todoMine, todoAll, doneRows } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = (w: WorkOrderRow) => {
      if (q && !w.title.toLowerCase().includes(q) && !String(w.number).includes(q)) return false
      if (priorityFilter !== 'all' && w.priority !== priorityFilter) return false
      return true
    }
    const open = rows.filter((w) => w.status !== 'done' && w.status !== 'skipped').filter(matches)
    const mine = open.filter((w) => w.assignees.some((a) => a.user_id === myId))
    const others = open.filter((w) => !w.assignees.some((a) => a.user_id === myId))
    const done = rows.filter((w) => w.status === 'done' || w.status === 'skipped').filter(matches)
    const byPriority = (a: WorkOrderRow, b: WorkOrderRow) =>
      (PRIORITY_RANK[a.priority as WorkOrderPriority] ?? 3) - (PRIORITY_RANK[b.priority as WorkOrderPriority] ?? 3)
    return {
      todoMine: mine.sort(byPriority),
      todoAll: others.sort(byPriority),
      doneRows: done,
    }
  }, [rows, search, priorityFilter, myId])

  const active = rows.find((w) => w.id === routeWoId) ?? null
  const showListOnMobile = !routeWoId

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4">
      <div className="hidden lg:block lg:px-0 lg:pb-4">
        <PageHeader
          title="Work Orders"
          subtitle="Create, assign, and track every job."
          actions={
            <Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Work Order</Button>
          }
        />
      </div>

      <div className="grid h-full min-h-0 gap-0 lg:gap-4 lg:grid-cols-[400px_1fr]">
        {/* List pane */}
        <div className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border',
          showListOnMobile ? 'flex' : 'hidden lg:flex',
        )}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 lg:hidden">
            <h1 className="text-lg font-semibold text-ink">Work Orders</h1>
            <button
              onClick={() => setCreating(true)}
              className="grid size-9 place-items-center rounded-full bg-accent text-white hover:bg-accent-hover"
              aria-label="New work order"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="flex border-b border-border">
            <TabButton active={tab === 'todo'} onClick={() => setTab('todo')}>
              To Do <span className="ml-1.5 rounded-full bg-content px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">{todoMine.length + todoAll.length}</span>
            </TabButton>
            <TabButton active={tab === 'done'} onClick={() => setTab('done')}>
              Done <span className="ml-1.5 rounded-full bg-content px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">{doneRows.length}</span>
            </TabButton>
          </div>

          <div className="border-b border-border p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search work orders..."
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="text-[11px] uppercase tracking-wider text-ink-subtle">Priority:</span>
              {(['all', 'high', 'medium', 'low', 'none'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriorityFilter(p)}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium transition',
                    priorityFilter === p ? 'bg-accent text-white' : 'bg-content text-ink-muted hover:text-ink',
                  )}
                >
                  {p === 'all' ? 'All' : (p[0].toUpperCase() + p.slice(1))}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {loading ? (
              <p className="px-4 py-6 text-sm text-ink-muted">Loading work orders...</p>
            ) : tab === 'todo' ? (
              (todoMine.length + todoAll.length === 0) ? (
                <div className="px-4 py-8 text-center text-sm text-ink-muted">No open work orders. Create one above.</div>
              ) : (
                <>
                  {todoMine.length > 0 && (
                    <ListSection title={`Assigned to Me (${todoMine.length})`}>
                      {todoMine.map((w) => (
                        <WorkOrderListRow key={w.id} wo={w} active={w.id === routeWoId} onClick={() => navigate(`/app/work-orders/${w.id}`)} />
                      ))}
                    </ListSection>
                  )}
                  {todoAll.length > 0 && (
                    <ListSection title={`All Open Work Orders (${todoAll.length})`}>
                      {todoAll.map((w) => (
                        <WorkOrderListRow key={w.id} wo={w} active={w.id === routeWoId} onClick={() => navigate(`/app/work-orders/${w.id}`)} />
                      ))}
                    </ListSection>
                  )}
                </>
              )
            ) : (
              doneRows.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-ink-muted">Nothing completed yet.</div>
              ) : (
                doneRows.map((w) => (
                  <WorkOrderListRow key={w.id} wo={w} active={w.id === routeWoId} onClick={() => navigate(`/app/work-orders/${w.id}`)} />
                ))
              )
            )}
          </div>
        </div>

        {/* Detail pane */}
        <div className={cn(
          'min-h-0 flex-col bg-card lg:rounded-md lg:border lg:border-border',
          routeWoId ? 'flex' : 'hidden lg:flex',
        )}>
          {active ? (
            <WorkOrderDetail
              workOrderId={active.id}
              onBack={() => navigate('/app/work-orders')}
              onChanged={load}
            />
          ) : (
            <div className="grid h-full place-items-center px-4 text-center text-sm text-ink-muted">
              Pick a work order to view its details.
            </div>
          )}
        </div>
      </div>

      {creating && (
        <NewWorkOrderModal
          prefill={createPrefill ?? undefined}
          onClose={() => { setCreating(false); setCreatePrefill(null) }}
          onCreated={(id) => { setCreating(false); setCreatePrefill(null); void load(); navigate(`/app/work-orders/${id}`) }}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 border-b-2 px-4 py-2.5 text-sm font-medium transition',
        active ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function ListSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-content/60 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted hover:text-ink"
      >
        <span>{title}</span>
        <ChevronDown className={cn('size-3.5 transition', open ? '' : '-rotate-90')} />
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

function WorkOrderListRow({ wo, active, onClick }: { wo: WorkOrderRow; active: boolean; onClick: () => void }) {
  const photoCount = wo.photo_count?.[0]?.count ?? 0
  const commentCount = wo.comment_count?.[0]?.count ?? 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition',
        active ? 'bg-accent-soft' : 'hover:bg-content',
      )}
    >
      <Circle className={cn('mt-1 size-3 fill-current shrink-0', PRIORITY_TONE[wo.priority as WorkOrderPriority])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate text-[15px] font-medium text-ink">{wo.title}</div>
          <span className="shrink-0 text-[11px] text-ink-subtle">#{wo.number}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-subtle">
          {wo.location && <span className="truncate">{wo.location.name}</span>}
          {wo.equipment && <><span>.</span><span className="truncate">{wo.equipment.name}</span></>}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', STATUS_TONE[wo.status as WorkOrderStatus])}>
              {wo.status === 'open' ? 'Open'
               : wo.status === 'on_hold' ? 'On Hold'
               : wo.status === 'in_progress' ? 'In Progress'
               : wo.status === 'done' ? 'Done' : 'Skipped'}
            </span>
            {wo.priority !== 'none' && (
              <span className={cn('text-[10px] font-medium', PRIORITY_TONE[wo.priority as WorkOrderPriority])}>
                {wo.priority[0].toUpperCase() + wo.priority.slice(1)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-ink-subtle">
            {wo.assignees.length > 0 && (
              <div className="flex -space-x-1">
                {wo.assignees.slice(0, 3).map((a) => (
                  <span
                    key={a.user_id}
                    title={a.user_name}
                    className="grid size-4 place-items-center rounded-full bg-accent/15 text-[8px] font-semibold text-accent ring-1 ring-card"
                  >
                    {a.user_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                ))}
                {wo.assignees.length > 3 && <span className="text-[9px]">+{wo.assignees.length - 3}</span>}
              </div>
            )}
            {photoCount > 0 && <span className="inline-flex items-center gap-0.5"><ImageIcon className="size-3" /> {photoCount}</span>}
            {commentCount > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" /> {commentCount}</span>}
          </div>
        </div>
      </div>
    </button>
  )
}
