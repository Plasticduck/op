import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  MoreVertical,
  Paperclip,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/auth'
import { currency } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  workOrders,
  type WorkOrderStatus,
  type WorkOrderPriority,
  type WorkOrderWorkType,
  type WorkOrderRecurrence,
  type WorkOrderComment,
  type WorkOrderPart,
  type WorkOrderFile,
  type WorkOrderTimeEntry,
  type WorkOrderOtherCost,
  PRIORITY_OPTIONS,
  WORK_TYPE_OPTIONS,
  RECURRENCE_OPTIONS,
  STATUS_OPTIONS,
} from '@/lib/queries/workOrders'

// Hydrated detail shape returned by workOrders.byId — keeps inline so callers
// (this file is the only one) don't have to import from queries.
type Detail = {
  id: string
  account_id: string
  location_id: string
  number: number
  title: string
  description: string | null
  status: WorkOrderStatus
  priority: WorkOrderPriority
  work_type: WorkOrderWorkType
  recurrence: WorkOrderRecurrence
  estimated_minutes: number | null
  due_at: string | null
  start_at: string | null
  created_at: string
  updated_at: string
  created_by_name: string | null
  requested_by_name: string | null
  completed_at: string | null
  completed_by_name: string | null
  location: { id: string; name: string } | null
  equipment: { id: string; name: string } | null
  assignees: Array<{ user_id: string; user_name: string }>
  categories: Array<{ category: { id: string; name: string; color: string; icon: string | null } | null }>
  vendors: Array<{ vendor: { id: string; name: string } | null }>
  parts: WorkOrderPart[]
  time_entries: WorkOrderTimeEntry[]
  other_costs: WorkOrderOtherCost[]
  files: WorkOrderFile[]
  comments: WorkOrderComment[]
  sub_work_orders: Array<{ id: string; number: number; title: string; status: WorkOrderStatus; priority: WorkOrderPriority }>
}

export function WorkOrderDetail({
  workOrderId, onBack, onChanged,
}: {
  workOrderId: string
  onBack: () => void
  onChanged: () => void
}) {
  const { profile } = useAuth()
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingStatus, setSavingStatus] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await workOrders.byId(workOrderId)
    setD(data as unknown as Detail)
    setLoading(false)
  }, [workOrderId])

  useEffect(() => { void load() }, [load])

  // Realtime: refresh on any change to this WO or its children.
  useEffect(() => {
    const ch = supabase
      .channel('work-order-' + workOrderId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `id=eq.${workOrderId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_comments', filter: `work_order_id=eq.${workOrderId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_files', filter: `work_order_id=eq.${workOrderId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_parts', filter: `work_order_id=eq.${workOrderId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_time_entries', filter: `work_order_id=eq.${workOrderId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_other_costs', filter: `work_order_id=eq.${workOrderId}` }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [workOrderId, load])

  const setStatus = async (s: WorkOrderStatus) => {
    if (!d || d.status === s) return
    setSavingStatus(true)
    await workOrders.setStatus(d.id, s)
    setSavingStatus(false)
    onChanged()
  }

  const markDone = () => setStatus(d?.status === 'done' ? 'open' : 'done')
  const removeWO = async () => {
    if (!d) return
    if (!window.confirm(`Delete Work Order #${d.number}? This cannot be undone.`)) return
    await workOrders.remove(d.id)
    onChanged()
    onBack()
  }

  if (loading || !d) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  const partsCost = d.parts.reduce((a, p) => a + Number(p.quantity) * Number(p.unit_cost ?? 0), 0)
  const laborCost = d.time_entries.reduce((a, t) => a + (Number(t.minutes) / 60) * Number(t.hourly_rate ?? 0), 0)
  const otherCost = d.other_costs.reduce((a, c) => a + Number(c.amount), 0)
  const totalCost = partsCost + laborCost + otherCost
  const totalMinutes = d.time_entries.reduce((a, t) => a + Number(t.minutes), 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-2.5 sm:px-3">
        <button
          type="button"
          onClick={onBack}
          className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content lg:hidden"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-ink-subtle">#{d.number}</span>
            <span className="text-[11px] text-ink-subtle">. Created {format(new Date(d.created_at), 'MM/dd/yyyy')}</span>
          </div>
          <h1 className="truncate text-[17px] font-semibold text-ink">{d.title}</h1>
        </div>
        <Button
          variant={d.status === 'done' ? 'secondary' : 'primary'}
          onClick={() => void markDone()}
          disabled={savingStatus}
          size="sm"
        >
          {savingStatus ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {d.status === 'done' ? 'Reopen' : 'Mark as Done'}
        </Button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content"
            aria-label="More"
          >
            <MoreVertical className="size-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-border bg-card py-1 shadow-md">
              <button
                onClick={() => { setMenuOpen(false); void removeWO() }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger hover:bg-content"
              >
                <Trash2 className="size-4" /> Delete work order
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {/* Status pipeline */}
        <section className="mb-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Status</div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.filter((s) => s.value !== 'skipped').map((s) => (
              <StatusButton
                key={s.value}
                active={d.status === s.value}
                onClick={() => void setStatus(s.value)}
                label={s.label}
                value={s.value}
              />
            ))}
            <StatusButton
              active={d.status === 'skipped'}
              onClick={() => void setStatus('skipped')}
              label="Skipped"
              value="skipped"
            />
          </div>
        </section>

        {/* Photos */}
        <FilesSection
          workOrderId={d.id}
          accountId={d.account_id}
          files={d.files}
          onChanged={load}
        />

        {/* Description */}
        {d.description && (
          <section className="mb-4">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Description</div>
            <p className="whitespace-pre-wrap text-sm text-ink">{d.description}</p>
          </section>
        )}

        {/* Field grid */}
        <section className="mb-4 grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-border bg-content/40 p-3 sm:grid-cols-2">
          <FieldRow label="Work Order ID" value={`#${d.number}`} />
          <FieldRow label="Location" value={d.location?.name ?? '—'} />
          <FieldRow label="Equipment" value={d.equipment?.name ?? '—'} />
          <FieldRow label="Priority" value={
            <Badge tone={d.priority === 'high' ? 'danger' : d.priority === 'medium' ? 'warn' : d.priority === 'low' ? 'ok' : 'neutral'}>
              {d.priority === 'none' ? 'None' : d.priority[0].toUpperCase() + d.priority.slice(1)}
            </Badge>
          } />
          <FieldRow label="Work Type" value={WORK_TYPE_OPTIONS.find((w) => w.value === d.work_type)?.label ?? d.work_type} />
          <FieldRow label="Recurrence" value={RECURRENCE_OPTIONS.find((r) => r.value === d.recurrence)?.label ?? d.recurrence} />
          <FieldRow label="Due Date" value={d.due_at ? format(new Date(d.due_at), 'MM/dd/yyyy') : '—'} />
          <FieldRow label="Start Date" value={d.start_at ? format(new Date(d.start_at), 'MM/dd/yyyy') : '—'} />
          <FieldRow label="Estimated Time" value={d.estimated_minutes != null ? formatMinutes(d.estimated_minutes) : '—'} />
          <FieldRow label="Requested By" value={d.requested_by_name ?? d.created_by_name ?? '—'} />
        </section>

        {/* Assignees */}
        <section className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Assigned To</div>
          {d.assignees.length === 0 ? (
            <p className="text-sm text-ink-muted">Unassigned</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {d.assignees.map((a) => (
                <span key={a.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-content px-2 py-1 text-xs text-ink">
                  <span className="grid size-5 place-items-center rounded-full bg-accent/15 text-[9px] font-semibold text-accent">
                    {a.user_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  {a.user_name}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Categories + Vendors */}
        {(d.categories.length > 0 || d.vendors.length > 0) && (
          <section className="mb-4 flex flex-wrap gap-1.5">
            {d.categories.map((c) =>
              c.category ? (
                <span
                  key={c.category.id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ backgroundColor: c.category.color + '20', color: c.category.color }}
                >
                  {c.category.name}
                </span>
              ) : null,
            )}
            {d.vendors.map((v) =>
              v.vendor ? (
                <span key={v.vendor.id} className="inline-flex items-center gap-1 rounded-full bg-content px-2 py-0.5 text-[11px] text-ink-muted">
                  {v.vendor.name}
                </span>
              ) : null,
            )}
          </section>
        )}

        {/* Sub-work orders */}
        {d.sub_work_orders.length > 0 && (
          <section className="mb-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Sub-Work Orders ({d.sub_work_orders.length})
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              {d.sub_work_orders.map((sw) => (
                <div key={sw.id} className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-ink">{sw.title}</div>
                    <div className="text-[10px] text-ink-subtle">#{sw.number} . {sw.status.replace('_', ' ')}</div>
                  </div>
                  <Badge tone={sw.status === 'done' ? 'ok' : sw.status === 'on_hold' ? 'warn' : 'accent'}>{sw.status.replace('_', ' ')}</Badge>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Time & Cost Tracking */}
        <section className="mb-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold text-ink">Time &amp; Cost Tracking</h3>
            <span className="text-xs text-ink-muted">Total: <span className="font-semibold text-ink">{currency(totalCost)}</span></span>
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <TrackingSection
              title="Parts"
              right={partsCost > 0 ? currency(partsCost) : null}
              empty={d.parts.length === 0}
              addLabel="Add part"
              onAdd={() => setOpenPartModal(true)}
            >
              {d.parts.map((p) => (
                <TrackingRow
                  key={p.id}
                  primary={p.part_name}
                  secondary={`Qty ${p.quantity}${p.unit_cost ? ' . ' + currency(Number(p.unit_cost)) + ' ea' : ''}`}
                  amount={currency(Number(p.quantity) * Number(p.unit_cost ?? 0))}
                  onDelete={() => void workOrders.removePart(p.id).then(onChanged)}
                />
              ))}
            </TrackingSection>
            <TrackingSection
              title="Time"
              right={totalMinutes > 0 ? formatMinutes(totalMinutes) + (laborCost > 0 ? ' . ' + currency(laborCost) : '') : null}
              empty={d.time_entries.length === 0}
              addLabel="Log time"
              onAdd={() => setOpenTimeModal(true)}
            >
              {d.time_entries.map((t) => (
                <TrackingRow
                  key={t.id}
                  primary={`${t.user_name} . ${formatMinutes(Number(t.minutes))}`}
                  secondary={t.notes ?? (t.hourly_rate ? currency(Number(t.hourly_rate)) + '/hr' : null)}
                  amount={t.hourly_rate ? currency((Number(t.minutes) / 60) * Number(t.hourly_rate)) : null}
                  onDelete={() => void workOrders.removeTimeEntry(t.id).then(onChanged)}
                />
              ))}
            </TrackingSection>
            <TrackingSection
              title="Other Costs"
              right={otherCost > 0 ? currency(otherCost) : null}
              empty={d.other_costs.length === 0}
              addLabel="Add cost"
              onAdd={() => setOpenCostModal(true)}
              last
            >
              {d.other_costs.map((c) => (
                <TrackingRow
                  key={c.id}
                  primary={c.description}
                  amount={currency(Number(c.amount))}
                  onDelete={() => void workOrders.removeOtherCost(c.id).then(onChanged)}
                />
              ))}
            </TrackingSection>
          </div>
        </section>

        {/* Created by / last updated */}
        <section className="mb-4 space-y-1 border-t border-border pt-3 text-[12px] text-ink-muted">
          <div>Created by <span className="font-medium text-ink">{d.created_by_name ?? 'Unknown'}</span> on {format(new Date(d.created_at), 'MM/dd/yyyy, h:mm a')}</div>
          <div>Last updated {formatDistanceToNowStrict(new Date(d.updated_at))} ago</div>
          {d.completed_at && (
            <div>Completed by <span className="font-medium text-ink">{d.completed_by_name ?? 'Unknown'}</span> on {format(new Date(d.completed_at), 'MM/dd/yyyy, h:mm a')}</div>
          )}
        </section>

        {/* Comments */}
        <CommentsSection
          workOrderId={d.id}
          accountId={d.account_id}
          comments={d.comments}
          currentUserId={profile?.id ?? ''}
          currentUserName={profile?.name ?? profile?.email ?? 'You'}
          onChanged={load}
        />
      </div>

      <DetailModals
        workOrderId={d.id}
        accountId={d.account_id}
        currentUserId={profile?.id ?? ''}
        currentUserName={profile?.name ?? profile?.email ?? 'You'}
        onChanged={load}
      />
    </div>
  )
}

// ---- Modal state lives at file scope via a tiny event bus so the buttons in
// ---- TrackingSection don't need to thread refs around the file. -----------

const modalEvents = new EventTarget()
function setOpenPartModal(open: boolean) { modalEvents.dispatchEvent(new CustomEvent('part', { detail: open })) }
function setOpenTimeModal(open: boolean) { modalEvents.dispatchEvent(new CustomEvent('time', { detail: open })) }
function setOpenCostModal(open: boolean) { modalEvents.dispatchEvent(new CustomEvent('cost', { detail: open })) }

function DetailModals({
  workOrderId, accountId, currentUserId, currentUserName, onChanged,
}: {
  workOrderId: string
  accountId: string
  currentUserId: string
  currentUserName: string
  onChanged: () => void
}) {
  void accountId; void currentUserId
  const [showPart, setShowPart] = useState(false)
  const [showTime, setShowTime] = useState(false)
  const [showCost, setShowCost] = useState(false)

  useEffect(() => {
    const onPart = (e: Event) => setShowPart((e as CustomEvent).detail as boolean)
    const onTime = (e: Event) => setShowTime((e as CustomEvent).detail as boolean)
    const onCost = (e: Event) => setShowCost((e as CustomEvent).detail as boolean)
    modalEvents.addEventListener('part', onPart)
    modalEvents.addEventListener('time', onTime)
    modalEvents.addEventListener('cost', onCost)
    return () => {
      modalEvents.removeEventListener('part', onPart)
      modalEvents.removeEventListener('time', onTime)
      modalEvents.removeEventListener('cost', onCost)
    }
  }, [])

  return (
    <>
      {showPart && (
        <AddPartModal
          workOrderId={workOrderId}
          onClose={() => setShowPart(false)}
          onSaved={() => { setShowPart(false); onChanged() }}
        />
      )}
      {showTime && (
        <AddTimeModal
          workOrderId={workOrderId}
          defaultName={currentUserName}
          onClose={() => setShowTime(false)}
          onSaved={() => { setShowTime(false); onChanged() }}
        />
      )}
      {showCost && (
        <AddCostModal
          workOrderId={workOrderId}
          onClose={() => setShowCost(false)}
          onSaved={() => { setShowCost(false); onChanged() }}
        />
      )}
    </>
  )
}

// ---- Small layout helpers -------------------------------------------------

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  )
}

function StatusButton({ active, onClick, label, value }: {
  active: boolean; onClick: () => void; label: string; value: WorkOrderStatus
}) {
  const tone = STATUS_OPTIONS.find((s) => s.value === value)?.tone ?? 'neutral'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-3 py-1.5 text-xs font-medium transition',
        active
          ? (tone === 'ok' ? 'border-ok bg-ok-soft text-ok'
             : tone === 'warn' ? 'border-warn bg-warn-soft text-warn'
             : tone === 'danger' ? 'border-danger bg-danger-soft text-danger'
             : 'border-accent bg-accent-soft text-accent')
          : 'border-border bg-card text-ink-muted hover:border-accent/40 hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}

function TrackingSection({
  title, right, empty, addLabel, onAdd, children, last,
}: {
  title: string; right: string | null; empty: boolean; addLabel: string; onAdd: () => void; children: React.ReactNode; last?: boolean
}) {
  return (
    <div className={cn(last ? '' : 'border-b border-border')}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="font-semibold text-ink">{title}</div>
        <div className="flex items-center gap-3">
          {right && <span className="text-xs text-ink-muted">{right}</span>}
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:text-accent-hover"
          >
            <Plus className="size-3" /> {addLabel}
          </button>
        </div>
      </div>
      {!empty && <div className="border-t border-border">{children}</div>}
    </div>
  )
}

function TrackingRow({ primary, secondary, amount, onDelete }: {
  primary: string; secondary?: string | null; amount: string | null; onDelete: () => void
}) {
  return (
    <div className="group flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
      <div className="min-w-0">
        <div className="truncate text-ink">{primary}</div>
        {secondary && <div className="truncate text-[11px] text-ink-subtle">{secondary}</div>}
      </div>
      <div className="flex items-center gap-2">
        {amount && <span className="tabular text-ink-muted">{amount}</span>}
        <button
          type="button"
          onClick={onDelete}
          className="hidden text-ink-subtle hover:text-danger group-hover:block"
          aria-label="Remove"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function formatMinutes(min: number): string {
  if (min < 60) return min + 'm'
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? h + 'h' : h + 'h ' + m + 'm'
}

// ---- Files / photos -------------------------------------------------------

const FILE_URL_CACHE = new Map<string, { url: string; exp: number }>()

function FilesSection({
  workOrderId, accountId, files, onChanged,
}: {
  workOrderId: string
  accountId: string
  files: WorkOrderFile[]
  onChanged: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const photos = files.filter((f) => f.kind === 'photo')
  const docs = files.filter((f) => f.kind === 'file')

  const onPick = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    const kind: 'photo' | 'file' = file.type.startsWith('image/') ? 'photo' : 'file'
    await workOrders.uploadFile(accountId, workOrderId, file, kind)
    setBusy(false)
    onChanged()
  }

  if (photos.length === 0 && docs.length === 0) {
    return (
      <section className="mb-4">
        <input ref={fileRef} type="file" hidden onChange={(e) => void onPick(e.target.files?.[0] ?? null)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-accent-soft/30 py-3 text-sm font-medium text-accent hover:bg-accent-soft/60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
          Add or drag pictures
        </button>
      </section>
    )
  }

  return (
    <section className="mb-4">
      <input ref={fileRef} type="file" hidden onChange={(e) => void onPick(e.target.files?.[0] ?? null)} />
      {photos.length > 0 && (
        <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <FileThumb key={p.id} file={p} onChanged={onChanged} />
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="aspect-square rounded-md border-2 border-dashed border-border text-ink-subtle hover:border-accent hover:text-accent"
          >
            {busy ? <Loader2 className="mx-auto size-4 animate-spin" /> : <Plus className="mx-auto size-4" />}
          </button>
        </div>
      )}
      {docs.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          {docs.map((f) => (
            <DocRow key={f.id} file={f} onChanged={onChanged} />
          ))}
        </div>
      )}
    </section>
  )
}

function FileThumb({ file, onChanged }: { file: WorkOrderFile; onChanged: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const cached = FILE_URL_CACHE.get(file.storage_path)
    if (cached && cached.exp > Date.now()) { setUrl(cached.url); return }
    let alive = true
    void (async () => {
      const { url: signed } = await workOrders.fileSignedUrl(file.storage_path, 3600)
      if (!alive || !signed) return
      FILE_URL_CACHE.set(file.storage_path, { url: signed, exp: Date.now() + 50 * 60 * 1000 })
      setUrl(signed)
    })()
    return () => { alive = false }
  }, [file.storage_path])

  return (
    <div className="group relative aspect-square overflow-hidden rounded-md bg-content">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Photo" className="size-full object-cover" /></a>
      ) : (
        <div className="grid size-full place-items-center"><Loader2 className="size-4 animate-spin text-ink-subtle" /></div>
      )}
      <button
        type="button"
        onClick={async () => {
          if (window.confirm('Delete this photo?')) {
            await workOrders.removeFile(file.id, file.storage_path)
            onChanged()
          }
        }}
        className="absolute right-1 top-1 hidden rounded-full bg-card p-1 text-ink-muted hover:text-danger group-hover:block"
        aria-label="Delete"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

function DocRow({ file, onChanged }: { file: WorkOrderFile; onChanged: () => void }) {
  const open = async () => {
    const { url } = await workOrders.fileSignedUrl(file.storage_path, 3600)
    if (url) window.open(url, '_blank', 'noopener')
  }
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm last:border-0">
      <button type="button" onClick={() => void open()} className="flex min-w-0 items-center gap-2 truncate text-ink hover:text-accent">
        <Paperclip className="size-3.5 shrink-0" /> {file.file_name ?? 'Attachment'}
      </button>
      <button
        type="button"
        onClick={async () => { if (window.confirm('Delete this file?')) { await workOrders.removeFile(file.id, file.storage_path); onChanged() } }}
        className="text-ink-subtle hover:text-danger"
        aria-label="Delete"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// ---- Comments + activity log ---------------------------------------------

function CommentsSection({
  workOrderId, accountId, comments, currentUserId, currentUserName, onChanged,
}: {
  workOrderId: string
  accountId: string
  comments: WorkOrderComment[]
  currentUserId: string
  currentUserName: string
  onChanged: () => void
}) {
  void accountId
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const send = async () => {
    const t = body.trim()
    if (!t || sending) return
    setSending(true)
    await workOrders.addComment({
      work_order_id: workOrderId,
      user_id: currentUserId,
      user_name: currentUserName,
      kind: 'comment',
      body: t,
    })
    setSending(false)
    setBody('')
    onChanged()
  }

  const sorted = [...comments].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <section className="mt-2">
      <h3 className="mb-2 text-[15px] font-semibold text-ink">Comments</h3>
      <div className="rounded-md border border-border bg-card">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Write a comment..."
          className="w-full resize-none rounded-t-md border-0 bg-transparent px-3 py-2 text-sm text-ink focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
          <span />
          <Button onClick={() => void send()} disabled={!body.trim() || sending} size="sm">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-3.5" />}
            Send
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {sorted.map((c) => (
          <div key={c.id} className="flex gap-2">
            <span className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold',
              c.kind === 'system' ? 'bg-content text-ink-subtle' : 'bg-accent/15 text-accent',
            )}>
              {c.user_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">{c.user_name}</span>
                <span className="text-[11px] text-ink-subtle">{format(new Date(c.created_at), 'MM/dd/yyyy, h:mm a')}</span>
              </div>
              <p className={cn('whitespace-pre-wrap text-sm', c.kind === 'system' ? 'italic text-ink-muted' : 'text-ink')}>{c.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- Parts / Time / Cost add modals --------------------------------------

function AddPartModal({ workOrderId, onClose, onSaved }: {
  workOrderId: string; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    await workOrders.addPart({
      work_order_id: workOrderId,
      part_name: name.trim(),
      quantity: Number(qty) || 1,
      unit_cost: cost ? Number(cost) : null,
    })
    setBusy(false)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Add part">
      <div className="flex flex-col gap-3">
        <Field label="Part name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">{(id) => <Input id={id} type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
          <Field label="Unit cost">{(id) => <Input id={id} type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>Add</Button>
        </div>
      </div>
    </Modal>
  )
}

function AddTimeModal({ workOrderId, defaultName, onClose, onSaved }: {
  workOrderId: string; defaultName: string; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(defaultName)
  const [hours, setHours] = useState('0')
  const [minutes, setMinutes] = useState('30')
  const [rate, setRate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    const totalMin = (Number(hours) || 0) * 60 + (Number(minutes) || 0)
    if (totalMin <= 0) return
    setBusy(true)
    await workOrders.addTimeEntry({
      work_order_id: workOrderId,
      user_name: name.trim(),
      minutes: totalMin,
      hourly_rate: rate ? Number(rate) : null,
      notes: notes.trim() || null,
    })
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Log time">
      <div className="flex flex-col gap-3">
        <Field label="Worked by">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Hours">{(id) => <Input id={id} type="number" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />}</Field>
          <Field label="Minutes">{(id) => <Input id={id} type="number" min="0" max="59" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
          <Field label="$/hr">{(id) => <Input id={id} type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>Log</Button>
        </div>
      </div>
    </Modal>
  )
}

function AddCostModal({ workOrderId, onClose, onSaved }: {
  workOrderId: string; onClose: () => void; onSaved: () => void
}) {
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!desc.trim() || !amount) return
    setBusy(true)
    await workOrders.addOtherCost({
      work_order_id: workOrderId,
      description: desc.trim(),
      amount: Number(amount),
    })
    setBusy(false)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Add other cost">
      <div className="flex flex-col gap-3">
        <Field label="Description" required>{(id) => <Input id={id} value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus />}</Field>
        <Field label="Amount" required>{(id) => <Input id={id} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>Add</Button>
        </div>
      </div>
    </Modal>
  )
}

void PRIORITY_OPTIONS; void Select
