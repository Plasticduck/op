import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, CircleCheck, RefreshCw, TriangleAlert, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { shortDate, timeAgo } from '@/lib/format'
import type { MxPriority, MxStatus, MxWorkOrder } from '@/lib/queries/siteWorkOrders'
import type { WorkOrdersState } from './useSiteWorkOrders'

// The site's open MaintainX work orders, for reference while auditing: a summary
// line at the top of the form, a button in the score bar that stays on screen,
// and both open the full list in a drawer (a bottom sheet on phones).

const PRIORITY: Record<MxPriority, { label: string; cls: string }> = {
  HIGH: { label: 'High', cls: 'bg-danger-soft text-danger' },
  MEDIUM: { label: 'Medium', cls: 'bg-warn-soft text-warn' },
  LOW: { label: 'Low', cls: 'bg-accent-soft text-accent' },
  NONE: { label: 'No priority', cls: 'bg-content text-ink-muted' },
}
const STATUS: Record<MxStatus, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold' }

const countHigh = (wos: MxWorkOrder[]) => wos.filter((w) => w.priority === 'HIGH').length

// One line in the audit's header card.
export function WorkOrdersSummary({ state, siteName, onOpen, onRetry }: {
  state: WorkOrdersState
  siteName: string
  onOpen: () => void
  onRetry: () => void
}) {
  const shell = 'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm'
  if (state.kind === 'loading') {
    return (
      <div className={cn(shell, 'border-border bg-content text-ink-muted')}>
        <Wrench className="size-4 shrink-0 animate-pulse" /> Checking MaintainX for open work orders…
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className={cn(shell, 'border-border bg-content')}>
        <TriangleAlert className="size-4 shrink-0 text-warn" />
        <span className="min-w-0 flex-1 text-ink-muted">Couldn't load work orders from MaintainX.</span>
        <button type="button" onClick={onRetry} className="shrink-0 font-medium text-accent hover:underline">Try again</button>
      </div>
    )
  }
  const { data } = state
  if (!data.matched) {
    return (
      <div className={cn(shell, 'border-border bg-content text-ink-muted')}>
        <Wrench className="size-4 shrink-0" /> {siteName} isn't set up in MaintainX yet, so there are no work orders to show.
      </div>
    )
  }
  const n = data.workOrders.length
  if (!n) {
    return (
      <div className={cn(shell, 'border-ok/30 bg-ok-soft/60 text-ink')}>
        <CircleCheck className="size-4 shrink-0 text-ok" /> No open work orders at {siteName}.
      </div>
    )
  }
  const high = countHigh(data.workOrders)
  return (
    <button type="button" onClick={onOpen} className={cn(shell, 'group border-accent/30 bg-accent-soft/60 transition hover:bg-accent-soft')}>
      <Wrench className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-ink">{n} open work order{n === 1 ? '' : 's'}</span>
        <span className="text-ink-muted"> at {siteName}</span>
        {high > 0 && <span className="ml-2 rounded-md bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">{high} high</span>}
      </span>
      <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-accent">
        View <ChevronRight className="size-4 transition group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}

// The small button in the score bar, so the list is a tap away anywhere in the form.
export function WorkOrdersChip({ state, onOpen }: { state: WorkOrdersState; onOpen: () => void }) {
  if (state.kind !== 'ready' || !state.data.matched) return null
  const n = state.data.workOrders.length
  const high = countHigh(state.data.workOrders)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${n} open work orders`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition',
        high ? 'border-danger/30 bg-danger-soft text-danger hover:bg-danger-soft/70' : 'border-border bg-card text-ink-muted hover:text-ink',
      )}
    >
      <Wrench className="size-3.5" /> {n} <span className="hidden sm:inline">WO{n === 1 ? '' : 's'}</span>
    </button>
  )
}

type Filter = 'ALL' | MxPriority

export function WorkOrdersDrawer({ open, onClose, state, siteName, onRefresh }: {
  open: boolean
  onClose: () => void
  state: WorkOrdersState
  siteName: string
  onRefresh: () => void
}) {
  const [filter, setFilter] = useState<Filter>('ALL')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const wos = useMemo(() => (state.kind === 'ready' ? state.data.workOrders : []), [state])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: wos.length, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 }
    for (const w of wos) c[w.priority] = (c[w.priority] ?? 0) + 1
    return c
  }, [wos])
  const shown = filter === 'ALL' ? wos : wos.filter((w) => w.priority === filter)

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end sm:items-stretch">
      <button type="button" aria-label="Close work orders" onClick={onClose} className="absolute inset-0 bg-shell/40 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Open work orders at ${siteName}`}
        className="relative z-10 flex max-h-[85dvh] w-full flex-col rounded-t-xl border border-border bg-card shadow-xl sm:max-h-none sm:max-w-md sm:rounded-none sm:border-y-0 sm:border-r-0"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Wrench className="size-4 text-accent" /> Open work orders</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {siteName} · from MaintainX
              {state.kind === 'ready' && <> · updated {timeAgo(state.data.fetchedAt)}</>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onRefresh} disabled={state.kind === 'loading'} aria-label="Refresh" className="rounded-md p-2 text-ink-muted hover:bg-content hover:text-ink disabled:opacity-50">
              <RefreshCw className={cn('size-4', state.kind === 'loading' && 'animate-spin')} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 text-ink-muted hover:bg-content hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {wos.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
            {(['ALL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as Filter[]).filter((f) => f === 'ALL' || counts[f] > 0).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition',
                  filter === f ? 'border-accent bg-accent text-white' : 'border-border bg-card text-ink-muted hover:text-ink',
                )}
              >
                {f === 'ALL' ? 'All' : PRIORITY[f].label} {counts[f]}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {state.kind === 'loading' && <p className="py-6 text-center text-sm text-ink-muted">Loading work orders…</p>}
          {state.kind === 'error' && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.message}</p>}
          {state.kind === 'ready' && !state.data.matched && (
            <p className="py-6 text-center text-sm text-ink-muted">{siteName} isn't set up in MaintainX yet.</p>
          )}
          {state.kind === 'ready' && state.data.matched && wos.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-muted">No open work orders at {siteName}.</p>
          )}
          <ul className="flex flex-col gap-2">
            {shown.map((w) => <WorkOrderCard key={w.id} w={w} />)}
          </ul>
        </div>
      </div>
    </div>
  )
}

// A due date at exactly midnight UTC is a whole day, so it's read as that calendar
// date (in Central it would show the day before); any other time is a moment.
function dueDay(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?Z)?$/)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59) : new Date(iso)
}

function WorkOrderCard({ w }: { w: MxWorkOrder }) {
  const p = PRIORITY[w.priority] ?? PRIORITY.NONE
  const due = w.dueDate ? dueDay(w.dueDate) : null
  const overdue = !!due && due.getTime() < Date.now()
  const days = w.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(w.createdAt).getTime()) / 86_400_000)) : null
  const meta = [
    w.asset,
    w.assignees.length ? w.assignees.join(', ') : 'Unassigned',
    w.createdAt ? `Opened ${shortDate(w.createdAt)}${days == null ? '' : days === 0 ? ' (today)' : ` (${days} day${days === 1 ? '' : 's'})`}` : null,
  ].filter(Boolean)
  return (
    <li className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {w.number != null && <span className="font-mono font-semibold text-ink-muted">#{w.number}</span>}
        <span className={cn('rounded-md px-1.5 py-0.5 font-semibold', p.cls)}>{p.label}</span>
        <span className="rounded-md bg-content px-1.5 py-0.5 font-medium text-ink-muted">{STATUS[w.status] ?? w.status}</span>
        {due && (
          <span className={cn('ml-auto font-medium', overdue ? 'text-danger' : 'text-ink-muted')}>
            {overdue ? 'Overdue' : 'Due'} {shortDate(due)}
          </span>
        )}
      </div>
      <p className="mt-1 font-medium leading-snug text-ink">{w.title}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{meta.join(' · ')}</p>
    </li>
  )
}
