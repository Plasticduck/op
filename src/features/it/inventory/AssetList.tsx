import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Boxes,
  Check as CheckIcon,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  SquareCheck,
  Sticker,
  X,
} from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useLocations } from '@/lib/locations'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { itInventory, type ItAssetRow } from '@/lib/queries/itInventory'
import { AssetForm } from './AssetForm'
import { CheckInDialog, CheckOutDialog, MoveDialog, StatusDialog } from './ItemActions'
import { ItIcon } from './ItIcon'
import { PrintDialog } from './PrintDialog'
import { ScanSheet } from './ScanSheet'
import { assignmentBadge, friendlyError, healthBadge, needsSticker, statusTone, warrantyState } from './format'
import { useItRefs, type ItRefs } from './useItRefs'

// The IT Inventory list. Defaults to the site you're working in (the site
// switcher), like other site pages, with "All sites" for a company-wide view.
// One search box covers tag, name, serial, model, manufacturer, IP, MAC and
// notes; pressing Enter on an exact tag or serial (which is what a USB or
// Bluetooth barcode scanner does) jumps straight to that item. Filters live in
// the URL so the back button and shared links keep them.

export function AssetList({ onScan }: { onScan: () => void }) {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const { locations, activeLocation } = useLocations()
  const { refs, error: refsError, reload: reloadRefs } = useItRefs()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<ItAssetRow[]>([])
  const [archivedRows, setArchivedRows] = useState<ItAssetRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<null | { tag?: string }>(null)
  const [printing, setPrinting] = useState<ItAssetRow[] | null>(null)
  const [flash, setFlash] = useState<string | null>((routerLocation.state as { flash?: string } | null)?.flash ?? null)
  // Selection for bulk actions: pick rows, or scan stickers to pick them.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<null | 'checkout' | 'checkin' | 'status' | 'move' | 'remove'>(null)
  const [collecting, setCollecting] = useState(false)

  const q = params.get('q') ?? ''
  const site = params.get('site') ?? activeLocation?.id ?? 'all'
  const cat = params.get('cat') ?? ''
  const status = params.get('status') ?? '' // '' active, 'archived', or a status label id
  const stickerOnly = params.get('sticker') === '1'
  const setParam = (patch: Record<string, string>) =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      return next
    }, { replace: true })

  // A blank sticker scanned anywhere (even while this list is open) lands
  // here as ?add=1&tag=...
  const addParam = params.get('add')
  useEffect(() => {
    if (addParam === '1') {
      setAdding({ tag: params.get('tag') ?? undefined })
      setParam({ add: '', tag: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam])

  const load = useCallback(async () => {
    const { data, error: err } = await itInventory.listAssets()
    setError(err ? err.message : null)
    setRows(data)
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (status === 'archived' && archivedRows === null) {
      void itInventory.listAssets({ archived: true }).then(({ data }) => setArchivedRows(data))
    }
  }, [status, archivedRows])

  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  // Lowercased search text per asset, built once per load.
  const haystack = useMemo(() => {
    const m = new Map<string, string>()
    if (!refs) return m
    for (const r of [...rows, ...(archivedRows ?? [])]) {
      const model = r.model_id ? refs.model.get(r.model_id) : undefined
      m.set(r.id, [
        r.asset_tag, r.name, r.serial, model?.name, model?.model_number,
        model?.manufacturer_id ? refs.manufacturer.get(model.manufacturer_id)?.name : null,
        r.ip_address, r.mac_address, r.hostname, r.notes, r.assigned_label,
        r.area_id ? refs.area.get(r.area_id)?.name : null, siteName.get(r.location_id),
        refs.category.get(r.category_id)?.name,
      ].filter(Boolean).join(' ').toLowerCase())
    }
    return m
  }, [rows, archivedRows, refs, siteName])

  const isArchivedType = useCallback(
    (r: ItAssetRow) => refs?.status.get(r.status_label_id)?.type === 'archived',
    [refs],
  )

  const inSite = useMemo(() => {
    const base = status === 'archived' ? [...rows.filter(isArchivedType), ...(archivedRows ?? [])] : rows
    return site === 'all' ? base : base.filter((r) => r.location_id === site)
  }, [rows, archivedRows, status, site, isArchivedType])

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return inSite.filter((r) => {
      if (cat && r.category_id !== cat) return false
      if (status === '' && isArchivedType(r)) return false
      if (status && status !== 'archived' && r.status_label_id !== status) return false
      if (stickerOnly && !needsSticker(r)) return false
      if (words.length) {
        const h = haystack.get(r.id) ?? ''
        if (!words.every((w) => h.includes(w))) return false
      }
      return true
    })
  }, [inSite, q, cat, status, stickerOnly, haystack, isArchivedType])

  const stickerCount = useMemo(
    () => inSite.filter((r) => !isArchivedType(r) && !r.deleted_at && needsSticker(r)).length,
    [inSite, isArchivedType],
  )

  const open = (id: string) => navigate(`/app/it-inventory/${id}`, { state: { back: routerLocation.search } })

  // Enter on an exact tag or serial opens it; a blank pre-printed tag opens Add.
  const jump = async () => {
    const v = q.trim().toUpperCase()
    if (!v) return
    const hit = rows.find((r) => r.asset_tag === v) ?? rows.find((r) => r.serial?.toUpperCase() === v)
    if (hit) { open(hit.id); return }
    const res = await itInventory.resolveTag(null, v)
    if (res?.result === 'asset') open(res.asset_id)
    else if (res?.result === 'unused') { setParam({ q: '' }); setAdding({ tag: res.tag }) }
  }

  const clearFilters = () => setParam({ q: '', cat: '', status: '', sticker: '' })

  const selectedRows = useMemo(
    () => [...rows, ...(archivedRows ?? [])].filter((r) => selected.has(r.id)),
    [rows, archivedRows, selected],
  )
  const sel: Selection = {
    on: selecting,
    ids: selected,
    toggle: (id) => setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    }),
  }
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()) }
  const finishBulk = (message: string) => {
    setBulk(null)
    stopSelecting()
    setFlash(message)
    void load()
  }

  if (refsError) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="IT Inventory" />
        <EmptyState className="mt-6" icon={Boxes} title="IT Inventory isn't ready" description={refsError} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="IT Inventory"
        subtitle="Every device at your sites, its sticker, and its history."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/app/it-inventory/stickers')}>
              <Sticker className="size-4" /> Stickers
            </Button>
            {/* Phones get the floating Scan button instead. */}
            <Button variant="secondary" onClick={onScan} className="hidden lg:inline-flex">
              <ScanLine className="size-4" /> Scan
            </Button>
            <Button onClick={() => setAdding({})} disabled={!refs}><Plus className="size-4" /> Add</Button>
          </>
        }
      />

      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load the inventory: {error}</p>}

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_200px_200px_200px]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setParam({ q: e.target.value })} className="pl-9"
            onKeyDown={(e) => { if (e.key === 'Enter') void jump() }}
            placeholder="Search tag, name, serial, model, IP, MAC" aria-label="Search the inventory" />
        </div>
        <Select value={site} onChange={(e) => setParam({ site: e.target.value })} aria-label="Site">
          <option value="all">All sites</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select value={cat} onChange={(e) => setParam({ cat: e.target.value })} aria-label="Category">
          <option value="">All categories</option>
          {refs?.categories.filter((c) => c.kind === 'asset').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setParam({ status: e.target.value })} aria-label="Status">
          <option value="">Active (not retired)</option>
          {refs?.statuses.filter((s) => s.type !== 'archived').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="archived">Retired and archived</option>
        </Select>
      </div>

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {stickerCount > 0 && (
            <button type="button" onClick={() => setParam({ sticker: stickerOnly ? '' : '1' })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition',
                stickerOnly ? 'border-warn bg-warn-soft text-warn' : 'border-border bg-card text-ink-muted hover:text-ink',
              )}>
              <Sticker className="size-4" /> Needs a sticker ({stickerCount})
            </button>
          )}
          <span className="flex-1" />
          {selecting ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(filtered.map((r) => r.id)))}>Select all {filtered.length}</Button>
              <Button size="sm" variant="secondary" onClick={() => { primeScanSound(); setCollecting(true) }}><ScanLine className="size-4" /> Scan to select</Button>
              <Button size="sm" variant="ghost" onClick={stopSelecting}>Cancel</Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setSelecting(true)}><SquareCheck className="size-4" /> Select</Button>
          )}
        </div>
      )}

      <div className="mt-3">
        {loading || !refs ? (
          <div className="grid place-items-center rounded-md border border-border bg-card py-16 text-ink-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 && !error ? (
          <EmptyState
            icon={Boxes}
            title="Nothing here yet"
            description="Add your pay stations, POS, cameras, network gear and tablets. Each one gets a sticker tag you can scan later."
            action={<Button onClick={() => setAdding({})}><Plus className="size-4" /> Add the first one</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title="Nothing matches"
            description={site !== 'all' ? 'Try All sites, or clear the filters.' : undefined}
            action={<Button variant="secondary" onClick={clearFilters}><X className="size-4" /> Clear filters</Button>} />
        ) : (
          <>
            <AssetCards rows={filtered} refs={refs} siteName={siteName} showSite={site === 'all'} onOpen={open} sel={sel} />
            <AssetTable rows={filtered} refs={refs} siteName={siteName} onOpen={open} sel={sel} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>{filtered.length} of {inSite.length} {site === 'all' ? 'across all sites' : `at ${siteName.get(site) ?? 'this site'}`}</span>
              {status !== 'archived' && !selecting && (
                <button type="button" onClick={() => setPrinting(filtered)} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  <Printer className="size-3.5" /> Print stickers for these {filtered.length}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {selecting && selected.size > 0 && (
        // Above the phone bottom nav; leaves room for the floating Scan button.
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mt-3 pr-[4.5rem] lg:bottom-4 lg:pr-0">
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-md">
            <span className="mr-1 text-sm font-medium text-ink">{selected.size} selected</span>
            <Button size="sm" onClick={() => setBulk('checkout')}><LogOut className="size-4" /> Check out</Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk('checkin')}><LogIn className="size-4" /> Check in</Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk('status')}><RefreshCw className="size-4" /> Status</Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk('move')}><MapPin className="size-4" /> Move</Button>
            <Button size="sm" variant="secondary" onClick={() => setPrinting(selectedRows)}><Printer className="size-4" /> Print</Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setBulk('remove')}><X className="size-4" /> Remove</Button>
          </div>
        </div>
      )}

      {refs && bulk === 'checkout' && (
        <CheckOutDialog refs={refs} assets={selectedRows} onClose={() => setBulk(null)} onDone={finishBulk} />
      )}
      {refs && bulk === 'checkin' && (
        <CheckInDialog refs={refs} assets={selectedRows} onClose={() => setBulk(null)} onDone={finishBulk} />
      )}
      {refs && bulk === 'status' && (
        <StatusDialog refs={refs} assets={selectedRows} onClose={() => setBulk(null)} onDone={finishBulk} />
      )}
      {refs && bulk === 'move' && (
        <MoveDialog refs={refs} assets={selectedRows} onClose={() => setBulk(null)} onDone={finishBulk} />
      )}
      <ConfirmDialog
        open={bulk === 'remove'}
        title={`Remove ${selected.size} item${selected.size === 1 ? '' : 's'}?`}
        description="For things added by mistake or twice. They leave the lists and their tags are never reused; you can restore them from Retired and archived. If they're worn out or gone, change their status to Retired instead."
        confirmLabel="Remove"
        destructive
        onCancel={() => setBulk(null)}
        onConfirm={() => {
          void itInventory.archiveMany([...selected]).then(({ data, error: err }) => {
            if (err) { setBulk(null); setError(friendlyError(err.message)); return }
            finishBulk(`Removed ${data?.length ?? 0}.`)
          })
        }}
      />
      {collecting && (
        <ScanSheet
          onClose={() => setCollecting(false)}
          collect={{
            count: selected.size,
            onAdd: (assetId) => {
              if (selected.has(assetId)) return false
              setSelected((s) => new Set(s).add(assetId))
              return true
            },
          }}
        />
      )}

      {printing && refs && (
        <PrintDialog refs={refs} assets={printing} onClose={() => setPrinting(null)}
          onPrinted={(m) => { setPrinting(null); setFlash(m); void load() }} />
      )}

      {adding && refs && (
        <AssetForm
          mode="add"
          refs={refs}
          initialTag={adding.tag}
          defaultSiteId={site !== 'all' ? site : activeLocation?.id}
          onClose={() => setAdding(null)}
          onRefsChanged={() => void reloadRefs()}
          onSaved={(created) => {
            setAdding(null)
            if (created.length === 1) {
              navigate(`/app/it-inventory/${created[0].id}`, {
                state: { back: routerLocation.search, flash: `Added ${created[0].asset_tag}. Print its sticker now, or later from the print queue.` },
              })
              return
            }
            void load()
            setFlash(`Added ${created.length}: ${created.map((c) => c.asset_tag).join(', ')}. Their stickers are waiting in the print queue.`)
          }}
        />
      )}
    </div>
  )
}

type Selection = { on: boolean; ids: Set<string>; toggle: (id: string) => void }
type ListProps = { rows: ItAssetRow[]; refs: ItRefs; siteName: Map<string, string>; onOpen: (id: string) => void; sel: Selection }

function Check({ on }: { on: boolean }) {
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-white' : 'border-border-strong bg-card')}>
      {on && <CheckIcon className="size-3.5" strokeWidth={3} />}
    </span>
  )
}

// Phones: one card per item, the three badges under the name.
function AssetCards({ rows, refs, siteName, showSite, onOpen, sel }: ListProps & { showSite: boolean }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card lg:hidden">
      {rows.map((r) => {
        const c = refs.category.get(r.category_id)
        const s = refs.status.get(r.status_label_id)
        const health = healthBadge(r.health_state)
        const picked = sel.ids.has(r.id)
        return (
          <button key={r.id} type="button" onClick={() => (sel.on ? sel.toggle(r.id) : onOpen(r.id))}
            aria-pressed={sel.on ? picked : undefined}
            className={cn('flex w-full items-start gap-3 px-3 py-3 text-left', picked ? 'bg-accent-soft' : 'hover:bg-content')}>
            {sel.on && <span className="pt-2.5"><Check on={picked} /></span>}
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent/15 text-accent"><ItIcon name={c?.icon} className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] text-ink-subtle">{r.asset_tag}</span>
                {needsSticker(r) && <Sticker className="size-3.5 text-warn" aria-label="Needs a sticker" />}
              </span>
              <span className="block truncate font-medium text-ink">{r.name}</span>
              <span className="block truncate text-xs text-ink-muted">
                {[showSite ? siteName.get(r.location_id) : null, r.area_id ? refs.area.get(r.area_id)?.name : null, c?.name].filter(Boolean).join(' · ')}
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                <Badge tone={statusTone(s)}>{s?.name ?? 'Status'}</Badge>
                {r.assigned_type && <Badge tone="accent">{assignmentBadge(r).label}</Badge>}
                {r.health_state !== 'unknown' && <Badge tone={health.tone}>{health.label}</Badge>}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function AssetTable({ rows, refs, siteName, onOpen, sel }: ListProps) {
  return (
    <div className="hidden overflow-x-auto rounded-md border border-border bg-card lg:block">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
          <tr>
            {sel.on && <th className="w-10 px-3 py-2" />}
            <th className="px-3 py-2 font-medium">Tag</th>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Site</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Checked out to</th>
            <th className="px-3 py-2 font-medium">Health</th>
            <th className="px-3 py-2 font-medium">Warranty</th>
            <th className="px-3 py-2 font-medium">Serial</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const c = refs.category.get(r.category_id)
            const s = refs.status.get(r.status_label_id)
            const model = r.model_id ? refs.model.get(r.model_id) : undefined
            const w = warrantyState(r.warranty_end_date)
            const health = healthBadge(r.health_state)
            return (
              <tr key={r.id} onClick={() => (sel.on ? sel.toggle(r.id) : onOpen(r.id))}
                className={cn('cursor-pointer', sel.ids.has(r.id) ? 'bg-accent-soft' : 'hover:bg-content')}>
                {sel.on && <td className="px-3 py-2.5"><Check on={sel.ids.has(r.id)} /></td>}
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink-muted">
                  <span className="inline-flex items-center gap-1.5">
                    {r.asset_tag}
                    {needsSticker(r) && <Sticker className="size-3.5 text-warn" aria-label="Needs a sticker" />}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/15 text-accent"><ItIcon name={c?.icon} className="size-4" /></span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{r.name}</div>
                      <div className="truncate text-xs text-ink-muted">{[c?.name, model && model.name !== r.name ? model.name : null].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-ink">{siteName.get(r.location_id) ?? 'Archived site'}</div>
                  {r.area_id && <div className="text-xs text-ink-muted">{refs.area.get(r.area_id)?.name}</div>}
                </td>
                <td className="px-3 py-2.5"><Badge tone={statusTone(s)}>{s?.name ?? '–'}</Badge></td>
                <td className="px-3 py-2.5 text-ink-muted">{r.assigned_label ?? <span className="text-ink-subtle">–</span>}</td>
                <td className="px-3 py-2.5">
                  {r.health_state === 'unknown' ? <span className="text-ink-subtle">–</span> : <Badge tone={health.tone}>{health.label}</Badge>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {w.days === null ? <span className="text-ink-subtle">–</span>
                    : <span className={cn('text-xs font-medium', w.tone === 'danger' ? 'text-danger' : w.tone === 'warn' ? 'text-warn' : 'text-ok')}>{w.label}</span>}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-ink-muted">{r.serial ?? <span className="text-ink-subtle">–</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
