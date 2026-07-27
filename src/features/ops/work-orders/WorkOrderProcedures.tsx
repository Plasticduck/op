import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ClipboardList, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import {
  procedures,
  type TemplateWithCount,
  type WorkOrderProcedureItem,
  type WorkOrderProcedureWithItems,
} from '@/lib/queries/procedures'

const INSPECTION = [
  { v: 'pass', label: 'Pass', tone: 'bg-ok-soft text-ok' },
  { v: 'fail', label: 'Fail', tone: 'bg-danger-soft text-danger' },
  { v: 'flag', label: 'Flag', tone: 'bg-warn-soft text-warn' },
]

export function WorkOrderProcedures({ workOrderId, canEdit }: { workOrderId: string; canEdit: boolean }) {
  const { profile } = useAuth()
  const [procs, setProcs] = useState<WorkOrderProcedureWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await procedures.forWorkOrder(workOrderId)
    const rows = (data as WorkOrderProcedureWithItems[] | null) ?? []
    rows.forEach((p) => p.items?.sort((a, b) => a.order_index - b.order_index))
    setProcs(rows)
    setLoading(false)
  }, [workOrderId])
  useEffect(() => { void load() }, [load])

  const saveItem = async (itemId: string, value: string | null) => {
    await procedures.setItemValue(itemId, value, profile?.id ?? null)
    setProcs((prev) =>
      prev.map((p) => ({ ...p, items: p.items.map((it) => (it.id === itemId ? { ...it, value } : it)) })),
    )
  }

  const progress = (p: WorkOrderProcedureWithItems) => {
    const fillable = p.items.filter((i) => i.type !== 'section')
    const done = fillable.filter((i) => i.value != null && i.value !== '').length
    return { done, total: fillable.length }
  }

  if (loading) return null
  if (procs.length === 0 && !canEdit) return null

  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Procedures</div>
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add</Button>
        )}
      </div>

      {procs.length === 0 ? (
        <p className="text-sm text-ink-muted">No procedures attached.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {procs.map((p) => {
            const { done, total } = progress(p)
            return (
              <div key={p.id} className="rounded-md border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ClipboardList className="size-4 shrink-0 text-ink-subtle" />
                    <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-subtle">{done}/{total}</span>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={async () => { await procedures.setCompleted(p.id, !p.completed_at); void load() }}
                        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', p.completed_at ? 'bg-ok-soft text-ok' : 'bg-content text-ink-muted hover:text-ink')}
                      >
                        <CheckCircle2 className="size-3.5" /> {p.completed_at ? 'Completed' : 'Mark done'}
                      </button>
                      <button type="button" onClick={async () => { if (window.confirm('Remove this procedure from the work order?')) { await procedures.detach(p.id); void load() } }} className="text-ink-subtle hover:text-danger" aria-label="Remove procedure"><Trash2 className="size-4" /></button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col divide-y divide-border">
                  {p.items.map((it) => (
                    <ItemRow key={it.id} item={it} canEdit={canEdit} onSave={saveItem} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <AddProcedureModal
          workOrderId={workOrderId}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); void load() }}
        />
      )}
    </section>
  )
}

function ItemRow({ item, canEdit, onSave }: { item: WorkOrderProcedureItem; canEdit: boolean; onSave: (id: string, v: string | null) => void }) {
  const [text, setText] = useState(item.value ?? '')

  if (item.type === 'section') {
    return <div className="bg-content px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{item.label}</div>
  }

  const opts = (item.options as string[]) ?? []
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0 flex-1 text-sm text-ink">
        {item.label}{item.required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      <div className="shrink-0">
        {item.type === 'checkbox' && (
          <input type="checkbox" disabled={!canEdit} checked={item.value === 'true'} onChange={(e) => onSave(item.id, e.target.checked ? 'true' : 'false')} className="size-5 accent-accent" />
        )}
        {item.type === 'inspection' && (
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {INSPECTION.map((o) => (
              <button key={o.v} type="button" disabled={!canEdit} onClick={() => onSave(item.id, item.value === o.v ? null : o.v)} className={cn('border-l border-border px-2.5 py-1 text-xs font-medium first:border-l-0', item.value === o.v ? o.tone : 'bg-card text-ink-muted hover:text-ink')}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        {item.type === 'multiple_choice' && (
          <Select value={item.value ?? ''} disabled={!canEdit} onChange={(e) => onSave(item.id, e.target.value || null)} className="h-8 text-sm">
            <option value="">—</option>
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        )}
        {(item.type === 'text') && (
          <Input value={text} disabled={!canEdit} onChange={(e) => setText(e.target.value)} onBlur={() => text !== (item.value ?? '') && onSave(item.id, text || null)} className="h-8 w-44 text-sm" />
        )}
        {(item.type === 'number' || item.type === 'amount') && (
          <Input type="number" value={text} disabled={!canEdit} onChange={(e) => setText(e.target.value)} onBlur={() => text !== (item.value ?? '') && onSave(item.id, text || null)} className="h-8 w-28 text-sm" />
        )}
        {item.type === 'date' && (
          <Input type="date" value={text} disabled={!canEdit} onChange={(e) => { setText(e.target.value); onSave(item.id, e.target.value || null) }} className="h-8 w-40 text-sm" />
        )}
      </div>
    </div>
  )
}

function AddProcedureModal({ workOrderId, onClose, onAdded }: { workOrderId: string; onClose: () => void; onAdded: () => void }) {
  const [templates, setTemplates] = useState<TemplateWithCount[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { void (async () => { const { data } = await procedures.templates(); setTemplates((data as TemplateWithCount[] | null) ?? []) })() }, [])
  const attach = async (t: TemplateWithCount) => {
    setBusy(true)
    await procedures.attach(workOrderId, { id: t.id, name: t.name })
    setBusy(false)
    onAdded()
  }
  return (
    <Modal open onClose={onClose} title="Add procedure">
      <div className="flex flex-col gap-2">
        {templates.length === 0 ? (
          <p className="text-sm text-ink-muted">No procedures yet. Create one under Maintenance &gt; Procedures.</p>
        ) : (
          templates.map((t) => (
            <button key={t.id} type="button" disabled={busy} onClick={() => void attach(t)} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-content disabled:opacity-50">
              <span className="text-sm font-medium text-ink">{t.name}</span>
              <span className="text-[11px] text-ink-subtle">{t.fields?.[0]?.count ?? 0} fields</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}
