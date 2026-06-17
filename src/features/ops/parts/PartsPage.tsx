import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Package, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  parts,
  totalStock,
  needsRestock,
  type PartRow,
} from '@/lib/queries/parts'
import { NewPartModal } from './NewPartModal'
import { PartDetail } from './PartDetail'

type Filter = 'all' | 'needs_restock'

export default function PartsPage() {
  const { profile } = useAuth()
  const { id: routeId } = useParams<{ id?: string }>()
  const navigate = useNavigate()

  const [rows, setRows] = useState<PartRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await parts.list()
    setRows((data as unknown as PartRow[]) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!profile?.account_id) return
    const ch = supabase
      .channel('parts-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts_inventory' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [profile?.account_id, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !String(p.part_number).includes(q)
        && !(p.sku ?? '').toLowerCase().includes(q) && !(p.qr_code ?? '').toLowerCase().includes(q)) return false
      if (filter === 'needs_restock' && !needsRestock(p)) return false
      return true
    })
  }, [rows, search, filter])

  const needsRestockCount = rows.filter(needsRestock).length

  const active = rows.find((r) => r.id === routeId) ?? null
  const showListOnMobile = !routeId

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4">
      <div className="hidden lg:block lg:px-0 lg:pb-4">
        <PageHeader
          title="Parts"
          subtitle="Inventory across every site, with QR codes for the shelf."
          actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Part</Button>}
        />
      </div>

      {needsRestockCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-warn/30 bg-warn-soft/50 px-3 py-2 text-sm text-ink lg:mb-0 lg:hidden">
          <AlertTriangle className="size-4 text-warn" />
          <span className="font-medium text-warn">{needsRestockCount}</span> part{needsRestockCount === 1 ? '' : 's'} below minimum.
        </div>
      )}

      <div className="grid h-full min-h-0 gap-0 lg:gap-4 lg:grid-cols-[400px_1fr]">
        {/* List pane */}
        <div className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border',
          showListOnMobile ? 'flex' : 'hidden lg:flex',
        )}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 lg:hidden">
            <h1 className="text-lg font-semibold text-ink">Parts</h1>
            <button
              onClick={() => setCreating(true)}
              className="grid size-9 place-items-center rounded-full bg-accent text-white hover:bg-accent-hover"
              aria-label="New part"
            >
              <Plus className="size-4" />
            </button>
          </div>

          {needsRestockCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter(filter === 'needs_restock' ? 'all' : 'needs_restock')}
              className={cn(
                'flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm transition',
                filter === 'needs_restock' ? 'bg-warn-soft text-warn' : 'bg-warn-soft/30 text-ink hover:bg-warn-soft/60',
              )}
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warn" />
                <span className="font-medium">Needs Restock</span>
              </span>
              <span className="rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-semibold text-white">{needsRestockCount}</span>
            </button>
          )}

          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, #, SKU, QR..." className="h-9 pl-8 text-sm" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {loading ? (
              <p className="px-4 py-6 text-sm text-ink-muted">Loading parts...</p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">No parts yet. Add your first one above.</p>
            ) : (
              filtered.map((p) => (
                <PartRow_
                  key={p.id}
                  part={p}
                  active={p.id === routeId}
                  onClick={() => navigate(`/app/parts/${p.id}`)}
                />
              ))
            )}
          </div>
        </div>

        {/* Detail pane */}
        <div className={cn(
          'min-h-0 flex-col bg-card lg:rounded-md lg:border lg:border-border',
          routeId ? 'flex' : 'hidden lg:flex',
        )}>
          {active ? (
            <PartDetail
              partId={active.id}
              onBack={() => navigate('/app/parts')}
              onChanged={load}
            />
          ) : (
            <div className="grid h-full place-items-center px-4 text-center text-sm text-ink-muted">
              <div>
                <Package className="mx-auto mb-3 size-10 text-ink-subtle/60" />
                Pick a part to view stock + history.
              </div>
            </div>
          )}
        </div>
      </div>

      {creating && (
        <NewPartModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void load(); navigate(`/app/parts/${id}`) }}
        />
      )}
    </div>
  )
}

function PartRow_({ part, active, onClick }: { part: PartRow; active: boolean; onClick: () => void }) {
  const total = totalStock(part)
  const low = needsRestock(part)
  const locationLabel = part.stock.length === 1
    ? (part.stock[0].location?.name ?? '—')
    : part.stock.length > 1
    ? `${part.stock.length} locations`
    : '—'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition',
        active ? 'bg-accent-soft' : 'hover:bg-content',
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent/15 text-[10px] font-semibold text-accent">
        #{part.part_number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{part.name}</div>
        <div className="truncate text-[11px] text-ink-subtle">At {locationLabel}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn('text-sm font-semibold tabular', total === 0 ? 'text-danger' : low ? 'text-warn' : 'text-ink')}>
          {total}
        </div>
        <div className="text-[10px] text-ink-subtle">{total === 1 ? 'unit' : 'units'}</div>
      </div>
    </button>
  )
}
