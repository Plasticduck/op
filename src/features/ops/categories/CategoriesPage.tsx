import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Pencil, Plus, Search, Tag, Trash2 } from 'lucide-react'
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
import {
  workOrderCategories,
  type WorkOrderCategory,
  type WorkOrderStatus,
} from '@/lib/queries/workOrders'

type CategoryWithCount = WorkOrderCategory & { wo_count: number }
type RelatedWO = {
  id: string
  number: number
  title: string
  status: WorkOrderStatus
  priority: string
  completed_at: string | null
  created_at: string
  assignees: Array<{ user_name: string }>
}

const PRESET_COLORS = ['#dc2626', '#eab308', '#8b5cf6', '#94a3b8', '#22c55e', '#f97316', '#0ea5e9', '#ef4444', '#64748b', '#a855f7', '#2563eb', '#10b981']

export default function CategoriesPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [cats, setCats] = useState<CategoryWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [related, setRelated] = useState<RelatedWO[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<WorkOrderCategory | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('work_order_categories')
      .select('*, links:work_order_category_links(count)')
      .order('name')
    const rows = (data as Array<WorkOrderCategory & { links: { count: number }[] }> | null) ?? []
    setCats(rows.map((r) => ({ ...r, wo_count: r.links?.[0]?.count ?? 0 })))
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const loadRelated = useCallback(async (categoryId: string) => {
    setRelatedLoading(true)
    const { data } = await supabase
      .from('work_order_category_links')
      .select('work_order:work_orders(id, number, title, status, priority, completed_at, created_at, assignees:work_order_assignees(user_name))')
      .eq('category_id', categoryId)
    const rows = ((data as Array<{ work_order: RelatedWO | null }> | null) ?? [])
      .map((r) => r.work_order)
      .filter((w): w is RelatedWO => !!w)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setRelated(rows)
    setRelatedLoading(false)
  }, [])

  useEffect(() => {
    if (activeId) void loadRelated(activeId)
  }, [activeId, loadRelated])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cats
    return cats.filter((c) => c.name.toLowerCase().includes(q))
  }, [cats, search])

  const active = cats.find((c) => c.id === activeId) ?? null

  const removeCategory = async (c: WorkOrderCategory) => {
    if (!window.confirm(`Delete "${c.name}"? Work orders in this category stay but lose the tag.`)) return
    await workOrderCategories.remove(c.id)
    if (activeId === c.id) setActiveId(null)
    void load()
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4">
      <div className="hidden lg:block lg:pb-4">
        <PageHeader
          title="Categories"
          subtitle="Tag work orders so you can group, filter, and report on them."
          actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Category</Button>}
        />
      </div>

      <div className="grid h-full min-h-0 flex-1 gap-0 lg:gap-4 lg:grid-cols-[340px_1fr]">
        {/* List */}
        <div className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border',
          activeId ? 'hidden lg:flex' : 'flex',
        )}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 lg:hidden">
            <h1 className="text-lg font-semibold text-ink">Categories</h1>
            <button
              onClick={() => setCreating(true)}
              className="grid size-9 place-items-center rounded-full bg-accent text-white hover:bg-accent-hover"
              aria-label="New category"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories..." className="h-9 pl-8 text-sm" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {loading ? (
              <p className="px-3 py-4 text-sm text-ink-muted">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-muted">No categories yet.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-left transition',
                    activeId === c.id ? 'bg-accent-soft' : 'hover:bg-content',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-subtle">{c.wo_count}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className={cn(
          'min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border',
          activeId ? 'flex' : 'hidden lg:flex',
        )}>
          {active ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-2 py-2.5 sm:px-4 sm:py-3">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content lg:hidden"
                  aria-label="Back"
                >
                  <ArrowLeft className="size-5" />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="size-4 shrink-0 rounded-full" style={{ backgroundColor: active.color }} />
                  <h2 className="truncate text-lg font-semibold text-ink">{active.name}</h2>
                  <span className="hidden rounded-full bg-content px-2 py-0.5 text-xs font-medium text-ink-muted sm:inline">{active.wo_count} work orders</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(active)}><Pencil className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => void removeCategory(active)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                <h3 className="mb-3 text-sm font-semibold text-ink">Work Order History</h3>
                {relatedLoading ? (
                  <p className="text-sm text-ink-muted"><Loader2 className="inline size-4 animate-spin" /> Loading...</p>
                ) : related.length === 0 ? (
                  <p className="text-sm text-ink-muted">No work orders in this category yet.</p>
                ) : (
                  <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {related.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => navigate(`/app/work-orders/${w.id}`)}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-content"
                      >
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
                <Tag className="mx-auto mb-2 size-10 text-ink-subtle/60" />
                Pick a category to see its work orders.
              </div>
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && (
        <CategoryEditModal
          accountId={profile?.account_id ?? ''}
          category={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); void load() }}
        />
      )}
    </div>
  )
}

function CategoryEditModal({
  accountId, category, onClose, onSaved,
}: {
  accountId: string
  category: WorkOrderCategory | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? '#2563eb')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!name.trim()) return setError('Enter a name')
    setBusy(true)
    if (category) {
      const { error: err } = await workOrderCategories.update(category.id, { name: name.trim(), color })
      if (err) { setBusy(false); return setError(err.message) }
    } else {
      const { error: err } = await workOrderCategories.create({ account_id: accountId, name: name.trim(), color })
      if (err) { setBusy(false); return setError(err.message) }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={category ? 'Edit category' : 'New category'}>
      <div className="flex flex-col gap-4">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Color</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn('size-7 rounded-full border-2 transition', color === c ? 'border-ink' : 'border-transparent hover:border-ink/30')}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{category ? 'Save' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}
