import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowDown, ArrowUp, Bookmark, Check as CheckIcon, Columns3, Download, Factory, Layers, ListFilter, Loader2, MapPin, Plus, Printer,
  RefreshCw, ScanLine, Search, ShieldAlert, SquareCheck, Sticker, Trash2, Archive, Upload, X,
} from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { downloadCsv } from '@/lib/csv'
import { miEquipment, type EquipmentList as ListData, type EquipmentRow, type SavedView } from '@/lib/queries/miEquipment'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { errText } from '../format'
import { LabelsDialog, type LabelItem } from '../LabelsDialog'
import { BulkDialog, type BulkKind } from './BulkActions'
import { COLUMNS, compareValues, DEFAULT_COLS, type Col, type ColCtx } from './columns'
import { EquipmentForm } from './EquipmentForm'
import { DEFAULT_VIEWS, FILTER_KEYS, matches, panelCount, readFilters, type EquipmentFilters, type ViewParams } from './filters'
import { cars, CRIT, EQUIPMENT_BASE, needsSticker, shortName, STATUS } from './format'
import { ScanCollect } from './ScanCollect'

// The equipment list: every machine at the caller's sites, one search box, filters in
// the URL, saved views, columns, CSV, and a selection (tap or scan stickers) for bulk
// changes. Opens on machines only; components are a click away. Enter on an exact
// sticker tag (what a USB scanner types) opens that machine.

const PAGE = 200

export function EquipmentList() {
  const { me, refs, accountId, userId } = useMi()
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<ListData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>((routerLocation.state as { flash?: string } | null)?.flash ?? null)
  const [showFilters, setShowFilters] = useState(false)
  const [menu, setMenu] = useState<null | 'views' | 'columns'>(null)
  const [views, setViews] = useState<SavedView[]>([])
  const [savingView, setSavingView] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<BulkKind | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [labels, setLabels] = useState<LabelItem[] | null>(null)

  const f = readFilters(params)
  const sortKey = params.get('sort') ?? 'item'
  const sortDir = params.get('dir') === 'desc' ? 'desc' : 'asc'
  const wantRetired = f.status === 'retired' || f.status === 'any'
  const setParam = (patch: Record<string, string>) =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      return next
    }, { replace: true })

  const load = useCallback(async () => {
    try {
      setData(await miEquipment.list(wantRetired))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [wantRetired])
  useEffect(() => {
    void load()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])
  const loadViews = useCallback(() => { void miEquipment.savedViews().then(setViews).catch(() => setViews([])) }, [])
  useEffect(() => { loadViews() }, [loadViews])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const siteName = useMemo(() => new Map(refs.sites.map((s) => [s.id, s.name])), [refs.sites])
  const zoneById = useMemo(() => new Map((data?.areas ?? []).map((a) => [a.id, a.name])), [data])
  const rowName = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows])
  const ctx: ColCtx = useMemo(() => ({ siteName, zoneName: (id?: string) => (id ? zoneById.get(id) : undefined), rowName, showSite: f.site === 'all' }), [siteName, zoneById, rowName, f.site])
  const colKeys = params.get('cols')?.split(',').filter(Boolean) ?? DEFAULT_COLS
  const shownCols = COLUMNS.filter((c) => colKeys.includes(c.key) && !(c.key === 'site' && f.site !== 'all'))

  const haystack = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) {
      m.set(r.id, [r.name, r.type, r.tag, r.serial_number, r.model, r.manufacturer, r.asset_number, siteName.get(r.location_id),
        r.area_id ? zoneById.get(r.area_id) : null, r.parent_id ? rowName.get(r.parent_id) : null].filter(Boolean).join(' ').toLowerCase())
    }
    return m
  }, [rows, siteName, zoneById, rowName])

  const filterKey = FILTER_KEYS.map((k) => f[k]).join('|')
  const sorted = useMemo(() => {
    const list = rows.filter((r) => matches(r, f, ctx, haystack.get(r.id) ?? ''))
    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0]
    return list.sort((a, b) => {
      const va = col.get(a, ctx)
      const vb = col.get(b, ctx)
      const c = compareValues(va, vb)
      return va == null || vb == null ? c : sortDir === 'desc' ? -c : c
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filterKey, ctx, haystack, sortKey, sortDir])
  useEffect(() => { setLimit(PAGE) }, [filterKey, sortKey, sortDir])

  const inSite = useMemo(() => (f.site === 'all' ? rows : rows.filter((r) => r.location_id === f.site)), [rows, f.site])
  const stickerCount = useMemo(() => inSite.filter(needsSticker).length, [inSite])
  const zoneNames = useMemo(() => [...new Set((data?.areas ?? []).filter((a) => f.site === 'all' || a.site_id === f.site).map((a) => a.name))].sort(), [data, f.site])
  const typeNames = useMemo(() => [...new Set(inSite.map((r) => r.type).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [inSite])
  const mfrNames = useMemo(() => [...new Set(inSite.map((r) => r.manufacturer).filter((t): t is string => !!t))].sort(), [inSite])

  const open = (id: string) => navigate(`${EQUIPMENT_BASE}/${id}`, { state: { back: routerLocation.search } })

  const jump = () => {
    const v = f.q.trim().toUpperCase()
    if (!v) return
    const hit = rows.find((r) => r.tag === v) ?? rows.find((r) => r.serial_number?.toUpperCase() === v)
    if (hit) open(hit.id)
  }

  const clearFilters = () => setParam(Object.fromEntries(FILTER_KEYS.filter((k) => k !== 'site').map((k) => [k, ''])))
  const sortBy = (key: string) => setParam({ sort: key, dir: sortKey === key && sortDir === 'asc' ? 'desc' : '' })
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
    for (const [k, v] of params.entries()) if (v && k !== 'site') out[k] = v
    return out
  }

  const exportCsv = () => {
    const cols = shownCols.length ? shownCols : COLUMNS.slice(0, 3)
    downloadCsv(`maintenance-equipment-${format(new Date(), 'yyyy-MM-dd')}`, [
      ['Site', ...cols.filter((c) => c.key !== 'site').map((c) => c.label)],
      ...sorted.map((r) => [siteName.get(r.location_id) ?? '', ...cols.filter((c) => c.key !== 'site').map((c) => c.get(r, ctx))]),
    ])
  }

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected])
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()) }
  const finishBulk = (message: string) => {
    setBulk(null)
    stopSelecting()
    setFlash(message)
    void load()
  }
  const printFor = (list: EquipmentRow[]) => setLabels(list.filter((r) => r.status !== 'retired').map((r) => ({ type: 'asset', id: r.id, name: shortName(r.name), site: siteName.get(r.location_id) })))

  const canEdit = me.rank >= 2
  const nPanel = panelCount(f)

  return (
    <div className="flex flex-col gap-3">
      {flash && (
        <div className="flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load the equipment: {error}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_190px_190px_auto]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={f.q} onChange={(e) => setParam({ q: e.target.value })} className="pl-9" onKeyDown={(e) => { if (e.key === 'Enter') jump() }}
            placeholder="Search name, type, sticker, serial, model" aria-label="Search equipment" />
        </div>
        <Select value={f.site} onChange={(e) => setParam({ site: e.target.value === 'all' ? '' : e.target.value, zone: '' })} aria-label="Site">
          <option value="all">All sites</option>
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select value={f.level} onChange={(e) => setParam({ level: e.target.value })} aria-label="Machines or components">
          <option value="">Machines</option>
          <option value="all">Machines and components</option>
          <option value="components">Components only</option>
        </Select>
        <Select value={f.status} onChange={(e) => setParam({ status: e.target.value })} aria-label="Status">
          <option value="">In service</option>
          <option value="down">Down (either kind)</option>
          {(['online', 'offline_planned', 'offline_unplanned'] as const).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          <option value="retired">Retired</option>
          <option value="any">Any status</option>
        </Select>
        <div className="flex gap-2">
          {me.rank >= 4 && (
            <Button variant="secondary" onClick={() => navigate('/app/maintenance-inventory/import')} aria-label="Import from a spreadsheet"><Upload className="size-4" /><span className="lg:hidden xl:inline"> Import</span></Button>
          )}
          {canEdit && <Button onClick={() => setAdding(true)} className="flex-1"><Plus className="size-4" /> Add</Button>}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={nPanel || showFilters ? 'primary' : 'secondary'} onClick={() => setShowFilters((v) => !v)}>
            <ListFilter className="size-4" /> Filters{nPanel ? ` (${nPanel})` : ''}
          </Button>
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setMenu(menu === 'views' ? null : 'views')}><Bookmark className="size-4" /> Views</Button>
            {menu === 'views' && (
              <ViewsMenu views={views} userId={userId} onApply={applyView} onClose={() => setMenu(null)}
                onSave={() => { setMenu(null); setSavingView(true) }}
                onDelete={(v) => void miEquipment.deleteView(v.id).then(loadViews).catch((e) => setError(errText(e)))} />
            )}
          </div>
          <div className="relative hidden lg:block">
            <Button size="sm" variant="secondary" onClick={() => setMenu(menu === 'columns' ? null : 'columns')}><Columns3 className="size-4" /> Columns</Button>
            {menu === 'columns' && (
              <Menu onClose={() => setMenu(null)}>
                <div className="max-h-80 overflow-y-auto py-1">
                  {COLUMNS.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-content">
                      <input type="checkbox" checked={colKeys.includes(c.key)} className="size-4 rounded border-border text-accent focus:ring-accent"
                        onChange={(e) => setParam({ cols: (e.target.checked ? COLUMNS.map((x) => x.key).filter((k) => k === c.key || colKeys.includes(k)) : colKeys.filter((k) => k !== c.key)).join(',') })} />
                      {c.label}
                    </label>
                  ))}
                </div>
                <button type="button" onClick={() => setParam({ cols: '' })} className="w-full border-t border-border px-3 py-2 text-left text-sm text-accent hover:bg-content">Reset columns</button>
              </Menu>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!sorted.length}><Download className="size-4" /> Export</Button>
          {stickerCount > 0 && (
            <button type="button" onClick={() => setParam({ sticker: f.sticker === 'needs' ? '' : 'needs' })}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition',
                f.sticker === 'needs' ? 'border-warn bg-warn-soft text-warn' : 'border-border bg-card text-ink-muted hover:text-ink')}>
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
          ) : canEdit ? (
            <Button size="sm" variant="secondary" onClick={() => setSelecting(true)}><SquareCheck className="size-4" /> Select</Button>
          ) : null}
        </div>
      )}

      {showFilters && (
        <section className="rounded-md border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect f={f} k="zone" label="Zone" setParam={setParam} options={[['-', 'No zone'], ...zoneNames.map((z) => [z, z] as [string, string])]} />
            <FilterSelect f={f} k="type" label="Type" setParam={setParam} options={typeNames.map((t) => [t, t])} />
            <FilterSelect f={f} k="crit" label="Criticality" setParam={setParam} options={[['A', CRIT.A.label], ['B', CRIT.B.label], ['C', CRIT.C.label], ['-', 'Not set']]} />
            <FilterSelect f={f} k="wo" label="Work orders" setParam={setParam} options={[['open', 'Has open work orders'], ['none', 'No open work orders']]} />
            <FilterSelect f={f} k="sticker" label="Sticker" setParam={setParam} options={[['needs', 'Needs a sticker'], ['printed', 'Printed'], ['faded', 'Faded'], ['missing', 'Missing'], ['damaged', 'Damaged']]} />
            <FilterSelect f={f} k="usage" label="Use counter" setParam={setParam} options={[['counted', 'Counting cars'], ['unset', 'No start date yet']]} />
            <FilterSelect f={f} k="warranty" label="Warranty" setParam={setParam} options={[['active', 'Under warranty'], ['expiring', 'Ending in 60 days'], ['expired', 'Ended'], ['none', 'No warranty date']]} />
            <FilterSelect f={f} k="mfr" label="Manufacturer" setParam={setParam} options={mfrNames.map((m) => [m, m])} />
          </div>
          <div className="mt-3 flex justify-end"><Button size="sm" variant="ghost" onClick={clearFilters}><X className="size-4" /> Clear all filters</Button></div>
        </section>
      )}

      {!data && !error ? (
        <div className="grid place-items-center rounded-md border border-border bg-card py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : rows.length === 0 && !error ? (
        <EmptyState icon={Factory} title="No equipment yet"
          description="Add the machines at your sites. Each gets a sticker you can scan, a history, and a place on the tunnel diagram."
          action={canEdit ? <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add the first one</Button> : undefined} />
      ) : sorted.length === 0 ? (
        <EmptyState icon={Search} title="Nothing matches" description={f.site !== 'all' ? 'Try All sites, or clear the filters.' : undefined}
          action={<Button variant="secondary" onClick={clearFilters}><X className="size-4" /> Clear filters</Button>} />
      ) : (
        <>
          <Cards rows={sorted.slice(0, limit)} ctx={ctx} onOpen={open} sel={{ on: selecting, ids: selected, toggle }} />
          <Table rows={sorted.slice(0, limit)} cols={shownCols} ctx={ctx} onOpen={open} sel={{ on: selecting, ids: selected, toggle }} sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
          {sorted.length > limit && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, sorted.length - limit)} more ({sorted.length - limit} left)</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
            <span>{sorted.length} of {inSite.length} {f.site === 'all' ? 'across your sites' : `at ${siteName.get(f.site) ?? 'this site'}`}</span>
            {!selecting && f.status !== 'retired' && (
              <button type="button" onClick={() => printFor(sorted)} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                <Printer className="size-3.5" /> Print stickers for these {sorted.length}
              </button>
            )}
          </div>
        </>
      )}

      {selecting && selected.size > 0 && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 pr-[4.5rem] lg:bottom-4 lg:pr-0">
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-md">
            <span className="mr-1 text-sm font-medium text-ink">{selected.size} selected</span>
            <Button size="sm" onClick={() => setBulk('status')}><RefreshCw className="size-4" /> Status</Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk('zone')}><Layers className="size-4" /> Zone</Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk('crit')}><ShieldAlert className="size-4" /> Criticality</Button>
            <Button size="sm" variant="secondary" onClick={() => printFor(selectedRows)}><Printer className="size-4" /> Stickers</Button>
            {me.rank >= 4 && <Button size="sm" variant="secondary" onClick={() => setBulk('site')}><MapPin className="size-4" /> Move site</Button>}
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setBulk('retire')}><Archive className="size-4" /> Retire</Button>
          </div>
        </div>
      )}

      {bulk && <BulkDialog kind={bulk} ids={[...selected]} label={`${selected.size} item${selected.size === 1 ? '' : 's'}`} areas={data?.areas ?? []} onClose={() => setBulk(null)} onDone={finishBulk} />}
      {collecting && (
        <ScanCollect count={selected.size} onClose={() => setCollecting(false)} onScan={(tag) => {
          const hit = rows.find((r) => r.tag === tag)
          if (!hit) return 'unknown'
          if (selected.has(hit.id)) return 'again'
          setSelected((s) => new Set(s).add(hit.id))
          return 'added'
        }} />
      )}
      {labels && <LabelsDialog items={labels} onClose={() => { setLabels(null); void load() }} />}
      {adding && (
        <EquipmentForm m={{ mode: 'add', siteId: f.site !== 'all' ? f.site : undefined }} onClose={() => setAdding(false)}
          onSaved={(s) => { setAdding(false); navigate(`${EQUIPMENT_BASE}/${s.ids[0].id}`, { state: { flash: `${s.message} Print its sticker when you're ready.` } }) }} />
      )}
      {savingView && (
        <SaveViewDialog canShare={me.rank >= 2} onClose={() => setSavingView(false)} onSave={async (name, shared) => {
          try {
            await miEquipment.saveView({ account_id: accountId, name, params: currentParams(), is_shared: shared })
            setSavingView(false)
            setFlash(`Saved "${name}". Find it under Views.`)
            loadViews()
            return null
          } catch (e) {
            return errText(e)
          }
        }} />
      )}
    </div>
  )
}

function FilterSelect({ f, k, label, options, setParam }: { f: EquipmentFilters; k: keyof EquipmentFilters; label: string; options: Array<[string, string]>; setParam: (p: Record<string, string>) => void }) {
  return (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={f[k]} onChange={(e) => setParam({ [k]: e.target.value })}>
          <option value="">Any</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      )}
    </Field>
  )
}

function ViewsMenu({ views, userId, onApply, onSave, onDelete, onClose }: {
  views: SavedView[]; userId: string; onApply: (p: ViewParams) => void; onSave: () => void; onDelete: (v: SavedView) => void; onClose: () => void
}) {
  const group = (title: string, items: Array<{ id: string; name: string; params: ViewParams; view?: SavedView }>) => items.length > 0 && (
    <div className="py-1">
      <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</div>
      {items.map((v) => (
        <div key={v.id} className="flex items-center hover:bg-content">
          <button type="button" onClick={() => onApply(v.params)} className="min-w-0 flex-1 truncate px-3 py-1.5 text-left text-sm text-ink">{v.name}</button>
          {v.view && v.view.user_id === userId && (
            <button type="button" aria-label={`Delete ${v.name}`} onClick={() => onDelete(v.view!)} className="grid size-8 place-items-center text-ink-subtle hover:text-danger"><Trash2 className="size-3.5" /></button>
          )}
        </div>
      ))}
    </div>
  )
  const asItems = (vs: SavedView[]) => vs.map((v) => ({ id: v.id, name: v.name, params: v.params ?? {}, view: v }))
  return (
    <Menu onClose={onClose} wide>
      {group('Built in', DEFAULT_VIEWS)}
      {group('Yours', asItems(views.filter((v) => v.user_id === userId)))}
      {group('Shared', asItems(views.filter((v) => v.user_id !== userId)))}
      <button type="button" onClick={onSave} className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-accent hover:bg-content">
        <Plus className="size-4" /> Save what you're looking at
      </button>
    </Menu>
  )
}

function SaveViewDialog({ canShare, onClose, onSave }: { canShare: boolean; onClose: () => void; onSave: (name: string, shared: boolean) => Promise<string | null> }) {
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal open onClose={onClose} title="Save this view" description="Keeps the filters, columns and sort you have now. The site stays whatever you pick." size="sm">
      <div className="space-y-3">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brushes down" autoFocus />}</Field>
        {canShare && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-4 rounded border-border text-accent focus:ring-accent" />
            Share it with everyone in Maintenance Inventory
          </label>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !name.trim()} onClick={() => { setBusy(true); void onSave(name.trim(), shared).then((err) => { setBusy(false); setError(err) }) }}>
            {busy && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Menu({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <>
      <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={onClose} />
      <div className={cn('absolute left-0 top-full z-30 mt-1 rounded-md border border-border bg-card shadow-md', wide ? 'w-72' : 'w-60')}>{children}</div>
    </>
  )
}

type Selection = { on: boolean; ids: Set<string>; toggle: (id: string) => void }

function Check({ on }: { on: boolean }) {
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-white' : 'border-border-strong bg-card')}>
      {on && <CheckIcon className="size-3.5" strokeWidth={3} />}
    </span>
  )
}

// Phones: one card per machine.
function Cards({ rows, ctx, onOpen, sel }: { rows: EquipmentRow[]; ctx: ColCtx; onOpen: (id: string) => void; sel: Selection }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card lg:hidden">
      {rows.map((r) => {
        const picked = sel.ids.has(r.id)
        const s = STATUS[r.status]
        return (
          <button key={r.id} type="button" onClick={() => (sel.on ? sel.toggle(r.id) : onOpen(r.id))} aria-pressed={sel.on ? picked : undefined}
            className={cn('flex w-full items-start gap-3 px-3 py-3 text-left', picked ? 'bg-accent-soft' : 'hover:bg-content')}>
            {sel.on && <span className="pt-0.5"><Check on={picked} /></span>}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                {r.tag && <span className="font-mono text-[11px] text-ink-subtle">{r.tag}</span>}
                {needsSticker(r) && <Sticker className="size-3.5 text-warn" aria-label="Needs a sticker" />}
              </span>
              <span className="block truncate font-medium text-ink">{ctx.showSite ? r.name : shortName(r.name)}</span>
              <span className="block truncate text-xs text-ink-muted">
                {[ctx.showSite ? ctx.siteName.get(r.location_id) : null, ctx.zoneName(r.area_id),
                  r.parent_id ? `Part of ${shortName(ctx.rowName.get(r.parent_id) ?? '')}` : r.children ? `${r.children} components` : null].filter(Boolean).join(' · ')}
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {r.status !== 'online' && <Badge tone={s.tone}>{s.short}</Badge>}
                {r.crit_class && <Badge tone={CRIT[r.crit_class].tone}>Crit. {r.crit_class}</Badge>}
                {r.open_wos > 0 && <Badge tone="warn">{r.open_wos} open WO{r.open_wos === 1 ? '' : 's'}</Badge>}
                {r.cars_since != null && <Badge tone="accent">{cars(r.cars_since)} cars</Badge>}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Table({ rows, cols, ctx, onOpen, sel, sortKey, sortDir, onSort }: {
  rows: EquipmentRow[]; cols: Col[]; ctx: ColCtx; onOpen: (id: string) => void; sel: Selection; sortKey: string; sortDir: 'asc' | 'desc'; onSort: (key: string) => void
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
            <tr key={r.id} onClick={() => (sel.on ? sel.toggle(r.id) : onOpen(r.id))} className={cn('cursor-pointer', sel.ids.has(r.id) ? 'bg-accent-soft' : 'hover:bg-content')}>
              {sel.on && <td className="px-3 py-2.5"><Check on={sel.ids.has(r.id)} /></td>}
              {cols.map((c) => {
                const v = c.cell ? c.cell(r, ctx) : c.get(r, ctx)
                return (
                  <td key={c.key} className={cn('max-w-[320px] px-3 py-2.5', c.mono && 'whitespace-nowrap font-mono text-xs text-ink-muted', c.right && 'text-right tabular-nums')}>
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
