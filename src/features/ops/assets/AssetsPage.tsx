import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Cog, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { useLocations } from '@/lib/locations'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  assets,
  STATUS_LABEL,
  STATUS_TONE,
  CRITICALITY_TONE,
  type AssetRow,
  type AssetStatus,
  type AssetCriticality,
} from '@/lib/queries/assets'
import { NewAssetModal } from './NewAssetModal'
import { AssetDetail } from './AssetDetail'

export default function AssetsPage() {
  const { profile } = useAuth()
  const { activeLocation } = useLocations()
  const { id: routeId } = useParams<{ id?: string }>()
  const navigate = useNavigate()

  const [rows, setRows] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await assets.list({ locationId: activeLocation?.id ?? null })
    setRows((data as unknown as AssetRow[]) ?? [])
    setLoading(false)
  }, [activeLocation?.id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!profile?.account_id) return
    const ch = supabase
      .channel('assets-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [profile?.account_id, load])

  // Build tree: roots (no parent) with children indexed by parent id
  const { roots, childrenByParent } = useMemo(() => {
    const childrenByParent = new Map<string, AssetRow[]>()
    const all: AssetRow[] = []
    const q = search.trim().toLowerCase()
    for (const r of rows) {
      if (q && !r.name.toLowerCase().includes(q) && !String(r.asset_number).includes(q) && !(r.qr_code ?? '').toLowerCase().includes(q)) continue
      all.push(r)
    }
    for (const r of all) {
      if (r.parent_asset_id) {
        const arr = childrenByParent.get(r.parent_asset_id) ?? []
        arr.push(r)
        childrenByParent.set(r.parent_asset_id, arr)
      }
    }
    // If a row's parent isn't in the filtered set, promote it to a root
    const rowIds = new Set(all.map((r) => r.id))
    const roots = all.filter((r) => !r.parent_asset_id || !rowIds.has(r.parent_asset_id))
    return { roots, childrenByParent }
  }, [rows, search])

  const active = rows.find((r) => r.id === routeId) ?? null
  const showListOnMobile = !routeId

  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4">
      <div className="hidden lg:block lg:px-0 lg:pb-4">
        <PageHeader
          title="Assets"
          subtitle="Every piece of equipment, tracked with QR codes."
          actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Asset</Button>}
        />
      </div>

      <div className="grid h-full min-h-0 gap-0 lg:gap-4 lg:grid-cols-[400px_1fr]">
        {/* List pane */}
        <div className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border',
          showListOnMobile ? 'flex' : 'hidden lg:flex',
        )}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 lg:hidden">
            <h1 className="text-lg font-semibold text-ink">Assets</h1>
            <button
              onClick={() => setCreating(true)}
              className="grid size-9 place-items-center rounded-full bg-accent text-white hover:bg-accent-hover"
              aria-label="New asset"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, # or QR..."
                className="h-9 pl-8 text-sm"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {loading ? (
              <p className="px-4 py-6 text-sm text-ink-muted">Loading assets...</p>
            ) : roots.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">No assets yet. Add your first one above.</p>
            ) : (
              roots.map((r) => (
                <AssetTreeRow
                  key={r.id}
                  asset={r}
                  level={0}
                  active={r.id === routeId}
                  expanded={expanded}
                  onToggle={toggle}
                  childrenByParent={childrenByParent}
                  onClick={(id) => navigate(`/app/assets/${id}`)}
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
            <AssetDetail
              assetId={active.id}
              onBack={() => navigate('/app/assets')}
              onChanged={load}
            />
          ) : (
            <div className="grid h-full place-items-center px-4 text-center text-sm text-ink-muted">
              <div>
                <Cog className="mx-auto mb-3 size-10 text-ink-subtle/60" />
                Pick an asset to view its details.
              </div>
            </div>
          )}
        </div>
      </div>

      {creating && (
        <NewAssetModal
          allAssets={rows}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void load(); navigate(`/app/assets/${id}`) }}
        />
      )}
    </div>
  )
}

function AssetTreeRow({
  asset, level, active, expanded, onToggle, childrenByParent, onClick,
}: {
  asset: AssetRow
  level: number
  active: boolean
  expanded: Set<string>
  onToggle: (id: string) => void
  childrenByParent: Map<string, AssetRow[]>
  onClick: (id: string) => void
}) {
  const children = childrenByParent.get(asset.id) ?? []
  const hasChildren = children.length > 0
  const isExpanded = expanded.has(asset.id)
  const subCount = asset.sub_count?.[0]?.count ?? 0
  const openWoCount = asset.open_wo_count?.[0]?.count ?? 0

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2 border-b border-border px-2 py-2.5 text-sm transition',
          active ? 'bg-accent-soft' : 'hover:bg-content',
        )}
        style={{ paddingLeft: 8 + level * 16 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(asset.id)}
            className="grid size-5 shrink-0 place-items-center text-ink-subtle hover:text-ink"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="inline-block size-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onClick(asset.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent/15 text-[10px] font-semibold text-accent">
            #{asset.asset_number}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-ink">{asset.name}</div>
            <div className="flex items-center gap-1.5 truncate text-[11px] text-ink-subtle">
              {asset.location && <span>{asset.location.name}</span>}
              {asset.criticality !== 'none' && (
                <Badge tone={CRITICALITY_TONE[asset.criticality as AssetCriticality]}>{asset.criticality}</Badge>
              )}
              {subCount > 0 && <span className="text-accent">{subCount} sub-asset{subCount === 1 ? '' : 's'}</span>}
            </div>
          </div>
          <StatusDot status={asset.status as AssetStatus} />
          {openWoCount > 0 && (
            <span className="rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">{openWoCount} WO</span>
          )}
        </button>
      </div>
      {hasChildren && isExpanded && children.map((c) => (
        <AssetTreeRow
          key={c.id}
          asset={c}
          level={level + 1}
          active={c.id === asset.id}
          expanded={expanded}
          onToggle={onToggle}
          childrenByParent={childrenByParent}
          onClick={onClick}
        />
      ))}
    </>
  )
}

function StatusDot({ status }: { status: AssetStatus }) {
  const tone = STATUS_TONE[status]
  const cls =
    tone === 'ok' ? 'bg-ok' :
    tone === 'warn' ? 'bg-warn' :
    tone === 'danger' ? 'bg-danger' : 'bg-ink-subtle'
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-ink-muted" title={STATUS_LABEL[status]}>
      <span className={'size-2 rounded-full ' + cls} />
    </span>
  )
}
