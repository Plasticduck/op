import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Boxes,
  Check as CheckIcon,
  Columns3,
  Download,
  EllipsisVertical,
  ListFilter,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  SquareCheck,
  Sticker,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { downloadCsv } from '@/lib/csv'
import { useLocations } from '@/lib/locations'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { itInventory, type ItAssetRow, type ItSavedView } from '@/lib/queries/itInventory'
import { AssetForm } from './AssetForm'
import { allColumns, compareValues, defaultColumnKeys, type Col, type ColCtx } from './columns'
import { DEFAULT_VIEWS, FILTER_KEYS, matches, panelCount, readFilters, type AssetFilters, type ViewParams } from './filters'
import { CheckInDialog, CheckOutDialog, MoveDialog, StatusDialog } from './ItemActions'
import { ItIcon } from './ItIcon'
import { PrintDialog } from './PrintDialog'
import { ScanSheet } from './ScanSheet'
import { SectionNav } from './SectionNav'
import { assignmentBadge, friendlyError, healthBadge, needsSticker, notWorking, statusTone, WARRANTY_WINDOW_DAYS } from './format'
import { useItRefs, type ItRefs } from './useItRefs'

// From the overview's "Not working" counts and the like.
const STATUS_TYPE_LABEL: Record<string, string> = {
  deployable: 'Ready to use (any)', pending: 'Being set up (any)', undeployable: 'Not working (any)',
}

// The IT Inventory list. Defaults to the site you're working in (the site
// switcher) with "All sites" for a company-wide view. One search box covers
// tag, name, serial, model, manufacturer, IP, MAC and notes; pressing Enter on
// an exact tag or serial (which is what a USB or Bluetooth barcode scanner
// does) opens it. Filters, columns and sort live in the URL, so the back
// button, shared links and saved views reproduce a view exactly. Long lists
// show PAGE rows at a time.

const PAGE = 200

export function AssetList({ onScan }: { onScan: () => void }) {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const { profile } = useAuth()
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
  const [showFilters, setShowFilters] = useState(false)
  const [menu, setMenu] = useState<null | 'views' | 'columns' | 'more'>(null)
  const [views, setViews] = useState<ItSavedView[]>([])
  const [savingView, setSavingView] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  // Selection for bulk actions: pick rows, or scan stickers to pick them.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<null | 'checkout' | 'checkin' | 'status' | 'move' | 'remove'>(null)
  const [collecting, setCollecting] = useState(false)

  const f = readFilters(params, activeLocation?.id ?? 'all')
  const sortKey = params.get('sort') ?? 'tag'
  const sortDir = params.get('dir') === 'desc' ? 'desc' : 'asc'
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
  const loadViews = useCallback(async () => {
    const { data } = await itInventory.savedViews()
    setViews(data ?? [])
  }, [])
  useEffect(() => { void loadViews() }, [loadViews])
  const wantArchived = f.status === 'archived' || f.status === 'all'
  useEffect(() => {
    if (wantArchived && archivedRows === null) {
      void itInventory.listAssets({ archived: true }).then(({ data }) => setArchivedRows(data))
    }
  }, [wantArchived, archivedRows])

  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  const ctx: ColCtx | null = useMemo(() => (refs ? { refs, siteName } : null), [refs, siteName])
  const columns = useMemo(() => (refs ? allColumns(refs) : []), [refs])
  const colKeys = params.get('cols')?.split(',').filter(Boolean) ?? (refs ? defaultColumnKeys(refs) : [])
  const shownCols = columns.filter((c) => colKeys.includes(c.key))

  // Lowercased search text per asset, built once per load.
  const haystack = useMemo(() => {
    const m = new Map<string, string>()
    if (!refs) return m
    for (const r of [...rows, ...(archivedRows ?? [])]) {
      const model = r.model_id ? refs.model.get(r.model_id) : undefined
      const custom = Object.values((r.custom_values as Record<string, unknown> | null) ?? {}).map(String)
      m.set(r.id, [
        r.asset_tag, r.name, r.serial, model?.name, model?.model_number,
        model?.manufacturer_id ? refs.manufacturer.get(model.manufacturer_id)?.name : null,
        r.ip_address as string | null, r.mac_address as string | null, r.hostname, r.notes, r.assigned_label,
        r.area_id ? refs.area.get(r.area_id)?.name : null, siteName.get(r.location_id),
        refs.category.get(r.category_id)?.name, ...custom,
      ].filter(Boolean).join(' ').toLowerCase())
    }
    return m
  }, [rows, archivedRows, refs, siteName])

  const isArchivedType = useCallback((r: ItAssetRow) => refs?.status.get(r.status_label_id)?.type === 'archived', [refs])
  const base = useMemo(() => {
    if (f.status === 'archived') return [...rows.filter(isArchivedType), ...(archivedRows ?? [])]
    if (f.status === 'all') return [...rows, ...(archivedRows ?? [])]
    return rows
  }, [rows, archivedRows, f.status, isArchivedType])
  const inSite = useMemo(() => (f.site === 'all' ? base : base.filter((r) => r.location_id === f.site)), [base, f.site])

  const filterKey = FILTER_KEYS.map((k) => f[k]).join('|')
  const sorted = useMemo(() => {
    if (!refs || !ctx) return []
    const list = base.filter((r) => matches(r, f, refs, haystack.get(r.id) ?? ''))
    const col = columns.find((c) => c.key === sortKey) ?? columns[0]
    if (!col) return list
    return list.sort((a, b) => {
      const va = col.get(a, ctx)
      const vb = col.get(b, ctx)
      const c = compareValues(va, vb)
      return va == null || vb == null ? c : sortDir === 'desc' ? -c : c
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, filterKey, refs, ctx, haystack, columns, sortKey, sortDir])
  useEffect(() => { setLimit(PAGE) }, [filterKey, sortKey, sortDir])

  const stickerCount = useMemo(
    () => inSite.filter((r) => !isArchivedType(r) && !r.deleted_at && needsSticker(r)).length,
    [inSite, isArchivedType],
  )

  const open = (id: string) => navigate(`/app/it-inventory/${id}`, { state: { back: routerLocation.search } })

  // Enter on an exact tag or serial opens it; a blank pre-printed tag opens Add.
  const jump = async () => {
    const v = f.q.trim().toUpperCase()
    if (!v) return
    const hit = rows.find((r) => r.asset_tag === v) ?? rows.find((r) => r.serial?.toUpperCase() === v)
    if (hit) { open(hit.id); return }
    const res = await itInventory.resolveTag(null, v)
    if (res?.result === 'asset') open(res.asset_id)
    else if (res?.result === 'unused') { setParam({ q: '' }); setAdding({ tag: res.tag }) }
  }

  const clearFilters = () => setParam(Object.fromEntries(FILTER_KEYS.filter((k) => k !== 'site').map((k) => [k, ''])))
  const sortBy = (key: string) => setParam({ sort: key, dir: sortKey === key && sortDir === 'asc' ? 'desc' : '' })
  const setCols = (keys: string[]) => setParam({ cols: keys.join(',') })

  // A view replaces the filters, columns and sort, and keeps the site unless
  // the view names one.
  const applyView = (p: ViewParams) => {
    setMenu(null)
    setParams(() => {
      const next = new URLSearchParams()
      if (params.has('site')) next.set('site', params.get('site') ?? '')
      for (const [k, v] of Object.entries(p)) if (v) next.set(k, v)
      return next
    }, { replace: true })
  }
  const currentParams = (): ViewParams => {
    const out: ViewParams = {}
    for (const [k, v] of params.entries()) if (v && k !== 'add' && k !== 'tag') out[k] = v
    return out
  }

  const exportCsv = () => {
    if (!ctx) return
    const cols = shownCols.length ? shownCols : columns.slice(0, 2)
    downloadCsv(`it-inventory-${format(new Date(), 'yyyy-MM-dd')}`, [
      cols.map((c) => c.label),
      ...sorted.map((r) => cols.map((c) => c.get(r, ctx))),
    ])
  }

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

  const nPanel = panelCount(f)
  const staff = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'

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
            {staff && (
              <div className="relative">
                <button type="button" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label="More"
                  className="grid size-10 place-items-center rounded-md text-ink-muted hover:bg-border/40 hover:text-ink">
                  <EllipsisVertical className="size-4" />
                </button>
                {menu === 'more' && (
                  <Menu onClose={() => setMenu(null)} align="right">
                    <MenuButton icon={Wrench} onClick={() => navigate('/app/it-inventory/repairs')}>Repairs and service</MenuButton>
                    <MenuButton icon={Upload} onClick={() => navigate('/app/it-inventory/import')}>Import from a spreadsheet</MenuButton>
                    <MenuButton icon={Settings} onClick={() => navigate('/app/it-inventory/settings')}>Settings and custom fields</MenuButton>
                  </Menu>
                )}
              </div>
            )}
          </>
        }
      />
      <SectionNav className="mt-4" />

      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load the inventory: {friendlyError(error)}</p>}

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_200px_200px_200px]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={f.q} onChange={(e) => setParam({ q: e.target.value })} className="pl-9"
            onKeyDown={(e) => { if (e.key === 'Enter') void jump() }}
            placeholder="Search tag, name, serial, model, IP, MAC" aria-label="Search the inventory" />
        </div>
        <Select value={f.site} onChange={(e) => setParam({ site: e.target.value, area: '' })} aria-label="Site">
          <option value="all">All sites</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select value={f.cat} onChange={(e) => setParam({ cat: e.target.value, model: '' })} aria-label="Category">
          <option value="">All categories</option>
          {refs?.categories.filter((c) => c.kind === 'asset').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={f.status} onChange={(e) => setParam({ status: e.target.value })} aria-label="Status">
          <option value="">Active (not retired)</option>
          {refs?.statuses.filter((s) => s.type !== 'archived').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {f.status.startsWith('name:') && <option value={f.status}>{f.status.slice(5)}</option>}
          {f.status.startsWith('type:') && <option value={f.status}>{STATUS_TYPE_LABEL[f.status.slice(5)] ?? f.status.slice(5)}</option>}
          <option value="archived">Retired and archived</option>
          <option value="all">Any status</option>
        </Select>
      </div>

      {rows.length > 0 && refs && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={nPanel || showFilters ? 'primary' : 'secondary'} onClick={() => setShowFilters((v) => !v)}>
            <ListFilter className="size-4" /> Filters{nPanel ? ` (${nPanel})` : ''}
          </Button>
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setMenu(menu === 'views' ? null : 'views')}>
              <Bookmark className="size-4" /> Views
            </Button>
            {menu === 'views' && (
              <ViewsMenu views={views} userId={profile?.id} onApply={applyView} onClose={() => setMenu(null)}
                onSave={() => { setMenu(null); setSavingView(true) }}
                onDelete={(v) => void itInventory.deleteView(v.id).then(() => loadViews())} />
            )}
          </div>
          <div className="relative hidden lg:block">
            <Button size="sm" variant="secondary" onClick={() => setMenu(menu === 'columns' ? null : 'columns')}>
              <Columns3 className="size-4" /> Columns
            </Button>
            {menu === 'columns' && (
              <Menu onClose={() => setMenu(null)}>
                <div className="max-h-80 overflow-y-auto py-1">
                  {columns.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-content">
                      <input type="checkbox" checked={colKeys.includes(c.key)}
                        className="size-4 rounded border-border text-accent focus:ring-accent"
                        onChange={(e) => setCols(e.target.checked ? columns.map((x) => x.key).filter((k) => k === c.key || colKeys.includes(k)) : colKeys.filter((k) => k !== c.key))} />
                      {c.label}
                    </label>
                  ))}
                </div>
                <button type="button" onClick={() => setParam({ cols: '' })} className="w-full border-t border-border px-3 py-2 text-left text-sm text-accent hover:bg-content">
                  Reset columns
                </button>
              </Menu>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!sorted.length}>
            <Download className="size-4" /> Export
          </Button>
          {stickerCount > 0 && (
            <button type="button" onClick={() => setParam({ sticker: f.sticker === 'needs' ? '' : 'needs' })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition',
                f.sticker === 'needs' ? 'border-warn bg-warn-soft text-warn' : 'border-border bg-card text-ink-muted hover:text-ink',
              )}>
              <Sticker className="size-4" /> Needs a sticker ({stickerCount})
            </button>
          )}
          <span className="flex-1" />
          {selecting ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(sorted.map((r) => r.id)))}>Select all {sorted.length}</Button>
              <Button size="sm" variant="secondary" onClick={() => { primeScanSound(); setCollecting(true) }}><ScanLine className="size-4" /> Scan to select</Button>
              <Button size="sm" variant="ghost" onClick={stopSelecting}>Cancel</Button>
            </>
          ) : staff ? (
            <Button size="sm" variant="secondary" onClick={() => setSelecting(true)}><SquareCheck className="size-4" /> Select</Button>
          ) : null}
        </div>
      )}

      {showFilters && refs && <FilterPanel f={f} refs={refs} setParam={setParam} onClear={clearFilters} />}

      <div className="mt-3">
        {loading || !refs || !ctx ? (
          <div className="grid place-items-center rounded-md border border-border bg-card py-16 text-ink-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 && !error ? (
          <EmptyState
            icon={Boxes}
            title="Nothing here yet"
            description="Add your pay stations, POS, cameras, network gear and tablets one at a time, or bring in a spreadsheet. Each one gets a sticker tag you can scan later."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setAdding({})}><Plus className="size-4" /> Add the first one</Button>
                {staff && <Button variant="secondary" onClick={() => navigate('/app/it-inventory/import')}><Upload className="size-4" /> Import a spreadsheet</Button>}
              </div>
            }
          />
        ) : sorted.length === 0 ? (
          <EmptyState icon={Search} title="Nothing matches"
            description={f.site !== 'all' ? 'Try All sites, or clear the filters.' : undefined}
            action={<Button variant="secondary" onClick={clearFilters}><X className="size-4" /> Clear filters</Button>} />
        ) : (
          <>
            <AssetCards rows={sorted.slice(0, limit)} refs={refs} siteName={siteName} showSite={f.site === 'all'} onOpen={open} sel={sel} />
            <AssetTable rows={sorted.slice(0, limit)} cols={shownCols} ctx={ctx} onOpen={open} sel={sel}
              sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
            {sorted.length > limit && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                  Show {Math.min(PAGE, sorted.length - limit)} more ({sorted.length - limit} left)
                </Button>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>{sorted.length} of {inSite.length} {f.site === 'all' ? 'across all sites' : `at ${siteName.get(f.site) ?? 'this site'}`}</span>
              {f.status !== 'archived' && !selecting && (
                <button type="button" onClick={() => setPrinting(sorted)} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  <Printer className="size-3.5" /> Print stickers for these {sorted.length}
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

      {refs && bulk === 'checkout' && <CheckOutDialog refs={refs} assets={selectedRows} onClose={() => setBulk(null)} onDone={finishBulk} />}
      {refs && bulk === 'checkin' && <CheckInDialog refs={refs} assets={selectedRows} onClose={() => setBulk(null)} onDone={finishBulk} />}
      {refs && bulk === 'status' && <StatusDialog refs={refs} assets={selectedRows} onClose={() => setBulk(null)} onDone={finishBulk} />}
      {refs && bulk === 'move' && <MoveDialog refs={refs} assets={selectedRows} onClose={() => setBulk(null)} onDone={finishBulk} />}
      <ConfirmDialog
        open={bulk === 'remove'}
        title={`Remove ${selected.size} item${selected.size === 1 ? '' : 's'}?`}
        description="For things added by mistake or twice. They leave the lists and their tags are never reused; you can restore them from Retired and archived. If they're worn out or gone, change their status to Retired instead."
        confirmLabel="Remove"
        destructive
        onCancel={() => setBulk(null)}
        onConfirm={() => {
          void itInventory.archiveMany([...selected]).then(({ data, error: err }) => {
            if (err) { setBulk(null); setError(err.message); return }
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

      {savingView && profile && (
        <SaveViewDialog
          onClose={() => setSavingView(false)}
          onSave={async (name, shared) => {
            const { error: err } = await itInventory.saveView({
              account_id: profile.account_id, user_id: profile.id, entity: 'asset', name,
              filters: currentParams(), is_shared: shared,
            })
            if (err) return err.message
            setSavingView(false)
            setFlash(`Saved "${name}". Find it under Views.`)
            void loadViews()
            return null
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
          defaultSiteId={f.site !== 'all' ? f.site : activeLocation?.id}
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

// ---- Filters panel --------------------------------------------------------------------

function FilterPanel({ f, refs, setParam, onClear }: {
  f: AssetFilters
  refs: ItRefs
  setParam: (p: Record<string, string>) => void
  onClear: () => void
}) {
  const sel = (key: keyof AssetFilters, label: string, options: [string, string][]) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={f[key]} onChange={(e) => setParam({ [key]: e.target.value })}>
          <option value="">Any</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      )}
    </Field>
  )
  const models = refs.models.filter((m) => !f.cat || m.category_id === f.cat)
  const fields = refs.fields.filter((x) => x.field_type !== 'secret')
  return (
    <section className="mt-3 rounded-md border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {f.site !== 'all' && sel('area', 'Area', refs.areas.filter((a) => a.location_id === f.site).map((a) => [a.id, a.name]))}
        {sel('model', 'Model', models.map((m) => [m.id, m.name]))}
        {sel('mfr', 'Manufacturer', refs.manufacturers.map((m) => [m.id, m.name]))}
        {sel('out', 'Checked out', [['out', 'Checked out'], ['in', 'Not checked out'], ['user', 'To a person'], ['area', 'To an area'], ['asset', 'To another device'], ['site', 'To another site']])}
        {sel('health', 'Working order', [['offline', 'Not working'], ['unknown', 'No problem reported']])}
        {sel('warranty', 'Warranty', [['active', 'Under warranty'], ['expiring', `Ending in ${WARRANTY_WINDOW_DAYS} days`], ['expired', 'Expired'], ['none', 'No warranty date']])}
        {sel('audit', 'Audit', [['overdue', 'Overdue'], ['due', 'Due soon'], ['ok', 'Not due yet']])}
        {sel('sticker', 'Sticker', [['needs', 'Needs a sticker'], ['faded', 'Faded'], ['missing', 'Missing'], ['ok', 'Readable']])}
        <Field label="Bought on or after">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setParam({ from: e.target.value })} />}</Field>
        <Field label="Bought on or before">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setParam({ to: e.target.value })} />}</Field>
        {fields.length > 0 && (
          <>
            {sel('cf', 'Custom field', fields.map((x) => [x.key, x.name]))}
            {f.cf && (
              <Field label="Contains">{(id) => <Input id={id} value={f.cfv} onChange={(e) => setParam({ cfv: e.target.value })} placeholder="Any value" />}</Field>
            )}
          </>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClear}><X className="size-4" /> Clear all filters</Button>
      </div>
    </section>
  )
}

// ---- Views ------------------------------------------------------------------------------

function ViewsMenu({ views, userId, onApply, onSave, onDelete, onClose }: {
  views: ItSavedView[]
  userId: string | undefined
  onApply: (p: ViewParams) => void
  onSave: () => void
  onDelete: (v: ItSavedView) => void
  onClose: () => void
}) {
  const mine = views.filter((v) => v.user_id === userId)
  const shared = views.filter((v) => v.user_id !== userId)
  const group = (title: string, items: { id: string; name: string; params: ViewParams; view?: ItSavedView }[]) => items.length > 0 && (
    <div className="py-1">
      <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</div>
      {items.map((v) => (
        <div key={v.id} className="flex items-center hover:bg-content">
          <button type="button" onClick={() => onApply(v.params)} className="min-w-0 flex-1 truncate px-3 py-1.5 text-left text-sm text-ink">{v.name}</button>
          {v.view && v.view.user_id === userId && (
            <button type="button" aria-label={`Delete ${v.name}`} onClick={() => onDelete(v.view!)}
              className="grid size-8 place-items-center text-ink-subtle hover:text-danger"><Trash2 className="size-3.5" /></button>
          )}
        </div>
      ))}
    </div>
  )
  const asItems = (vs: ItSavedView[]) => vs.map((v) => ({ id: v.id, name: v.name, params: (v.filters ?? {}) as ViewParams, view: v }))
  return (
    <Menu onClose={onClose} wide>
      {group('Built in', DEFAULT_VIEWS)}
      {group('Yours', asItems(mine))}
      {group('Shared with everyone', asItems(shared))}
      <button type="button" onClick={onSave} className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-accent hover:bg-content">
        <Plus className="size-4" /> Save what you're looking at
      </button>
    </Menu>
  )
}

function SaveViewDialog({ onClose, onSave }: { onClose: () => void; onSave: (name: string, shared: boolean) => Promise<string | null> }) {
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal open onClose={onClose} title="Save this view" description="Keeps the filters, columns and sort you have now." size="sm">
      <div className="space-y-3">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lubbock cameras" autoFocus />}</Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-4 rounded border-border text-accent focus:ring-accent" />
          Share it with everyone on the IT side
        </label>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !name.trim()} onClick={() => {
            setBusy(true)
            void onSave(name.trim(), shared).then((err) => { setBusy(false); setError(err) })
          }}>{busy && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </div>
      </div>
    </Modal>
  )
}

// ---- Small menu primitives -----------------------------------------------------------------

function Menu({ children, onClose, align = 'left', wide }: { children: ReactNode; onClose: () => void; align?: 'left' | 'right'; wide?: boolean }) {
  return (
    <>
      <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={onClose} />
      <div className={cn('absolute top-full z-30 mt-1 rounded-md border border-border bg-card shadow-md',
        align === 'right' ? 'right-0' : 'left-0', wide ? 'w-72' : 'w-60')}>
        {children}
      </div>
    </>
  )
}

function MenuButton({ icon: Icon, children, onClick }: { icon: typeof Plus; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-content">
      <Icon className="size-4 text-ink-muted" /> {children}
    </button>
  )
}

// ---- Rows ------------------------------------------------------------------------------------

type Selection = { on: boolean; ids: Set<string>; toggle: (id: string) => void }

function Check({ on }: { on: boolean }) {
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-white' : 'border-border-strong bg-card')}>
      {on && <CheckIcon className="size-3.5" strokeWidth={3} />}
    </span>
  )
}

// Phones: one card per item, the three badges under the name.
function AssetCards({ rows, refs, siteName, showSite, onOpen, sel }: {
  rows: ItAssetRow[]; refs: ItRefs; siteName: Map<string, string>; showSite: boolean; onOpen: (id: string) => void; sel: Selection
}) {
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
                {notWorking(r.health_state) && <Badge tone={health.tone}>{health.label}</Badge>}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function AssetTable({ rows, cols, ctx, onOpen, sel, sortKey, sortDir, onSort }: {
  rows: ItAssetRow[]; cols: Col[]; ctx: ColCtx; onOpen: (id: string) => void; sel: Selection
  sortKey: string; sortDir: 'asc' | 'desc'; onSort: (key: string) => void
}) {
  return (
    <div className="hidden overflow-x-auto rounded-md border border-border bg-card lg:block">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
          <tr>
            {sel.on && <th className="w-10 px-3 py-2" />}
            {cols.map((c) => (
              <th key={c.key} className={cn('px-3 py-2 font-medium', c.right && 'text-right')}>
                <button type="button" onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 uppercase hover:text-ink">
                  {c.label}
                  {sortKey === c.key && (sortDir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} onClick={() => (sel.on ? sel.toggle(r.id) : onOpen(r.id))}
              className={cn('cursor-pointer', sel.ids.has(r.id) ? 'bg-accent-soft' : 'hover:bg-content')}>
              {sel.on && <td className="px-3 py-2.5"><Check on={sel.ids.has(r.id)} /></td>}
              {cols.map((c) => {
                const v = c.cell ? c.cell(r, ctx) : c.get(r, ctx)
                return (
                  <td key={c.key} className={cn('px-3 py-2.5', c.mono && 'whitespace-nowrap font-mono text-xs text-ink-muted', c.right && 'text-right tabular-nums')}>
                    {v == null || v === '' ? <span className="text-ink-subtle">–</span> : v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
