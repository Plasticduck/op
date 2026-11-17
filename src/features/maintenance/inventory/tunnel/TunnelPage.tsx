import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Box, ChevronDown, ChevronRight, LayoutList, Loader2, Map as MapIcon, Pencil, RotateCw, Save, Sparkles, Undo2, type LucideIcon } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { miTunnel, type TunnelAsset, type TunnelData, type TunnelItem, type TunnelLayout } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { day, errText } from '../format'
import { ErrorNote } from '../ui'
import { cars, EQUIPMENT_BASE, shortName, STATUS } from '../equipment/format'
import { ApplyTemplateDialog } from './ApplyTemplateDialog'
import { expressTemplate } from './expressTemplate'
import type { Orientation } from './geometry'
import { NotLinked } from './NotLinked'
import { shapeFor } from './shapes'
import { Tunnel3DHost } from './Tunnel3DHost'
import { DiagramLegend, ToneSquare, TunnelDiagram } from './TunnelDiagram'
import { TunnelEditor } from './TunnelEditor'
import { TunnelPanel } from './TunnelPanel'
import { HEAT_TONES, heatStep, maxCarsOf, toneFor, type ColorBy, type Tone } from './tones'
import { useTunnelMoves, type TunnelMoves } from './useTunnelMoves'
import type { Tunnel3DFail } from './view3d'

// A site's tunnel, three ways: in 3D (walk it, pick a machine, slide machines along it),
// as the flat diagram from above, and as a list. Color any of them by status, use, open
// work orders or stickers. Every site's drawing starts as a copy of a template and is
// then adjusted to match the real tunnel. The page owns everything that has to outlive
// the 3D view (the site, the selection, unsaved moves), so if 3D can't run the diagram
// takes over and nothing is lost.

const STORE_SITE = 'mi.tunnel.site'
const STORE_COLOR = 'mi.tunnel.color'
const STORE_VIEW = 'mi.tunnel.view'

type View = '3d' | 'diagram' | 'list'
const VIEWS: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: '3d', label: '3D', icon: Box },
  { id: 'diagram', label: 'Diagram', icon: MapIcon },
  { id: 'list', label: 'List', icon: LayoutList },
]
const asView = (v: string | null): View | null => (v === '3d' || v === 'diagram' || v === 'list' ? v : null)

function readStore(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStore(key: string, v: string) {
  try { localStorage.setItem(key, v) } catch { /* private mode */ }
}

function useNarrow() {
  const q = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const isDown = (a: TunnelAsset | undefined) => a?.status === 'offline_planned' || a?.status === 'offline_unplanned'
// Entrance to exit, driver's side first: the order the diagram tabs through.
const tunnelOrder = (a: TunnelItem, b: TunnelItem) => Number(a.x_ft) - Number(b.x_ft) || Number(a.y_ft) - Number(b.y_ft)

export default function TunnelPage() {
  const { refs, notify, userId } = useMi()
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const narrow = useNarrow()
  const siteParam = params.get('site')
  const site = (siteParam && refs.sites.some((s) => s.id === siteParam) ? siteParam : null)
    ?? (() => { const s = readStore(STORE_SITE); return s && refs.sites.some((x) => x.id === s) ? s : refs.sites[0]?.id ?? '' })()
  const tunnelNo = Number(params.get('tunnel') ?? 1) || 1
  const selectedId = params.get('item')
  // The view asked for (the link's, else the last one picked, else 3D) and the one shown:
  // if 3D failed on this visit the diagram stands in, without touching what's remembered.
  const want: View = asView(params.get('view')) ?? asView(readStore(STORE_VIEW)) ?? '3d'
  const [failed, setFailed] = useState<Tunnel3DFail | null>(null)
  const view: View = want === '3d' && failed ? 'diagram' : want
  const [colorBy, setColorBy] = useState<ColorBy>(() => (readStore(STORE_COLOR) as ColorBy | null) ?? 'status')
  const [turned, setTurned] = useState<boolean | null>(null)
  const orientation: Orientation = (turned ?? narrow) ? 'v' : 'h'
  const [data, setData] = useState<TunnelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState<{ id: string; name: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [moveMode, setMoveMode] = useState(false)
  // In 3D the machine's card sits in the canvas; the side panel opens only when asked for.
  const [detailsFor, setDetailsFor] = useState<string | null>(null)
  const [switching, setSwitching] = useState<{ site?: string; tunnel?: string } | null>(null)
  const editing = params.get('edit') === '1'
  // What isn't linked, listed under the status line. In the address so a link (the
  // template report's, say) can open it, and so it is open again coming back from a machine.
  const listOpen = params.get('unlinked') === '1'
  const listId = useId()
  const listToggle = useRef<HTMLButtonElement>(null)
  const linkedLine = useRef<HTMLSpanElement>(null)

  const setParam = useCallback((patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    return next
  }, { replace: true }), [setParams])

  // Only the latest request counts: a slow answer for the site just left must not land.
  const asked = useRef(0)
  const load = useCallback(async () => {
    if (!site) return
    const mine = ++asked.current
    try {
      const fresh = await miTunnel.get(site, tunnelNo)
      if (mine !== asked.current) return
      setData(fresh)
      setError(null)
    } catch (e) {
      if (mine === asked.current) setError(errText(e))
    }
  }, [site, tunnelNo])
  useEffect(() => {
    setData(null)
    void load()
  }, [load])
  useEffect(() => {
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  // Moves belong to the person who made them, and only someone who can save has any.
  const moves = useTunnelMoves({ layout: data?.layout ?? null, items: data?.items ?? [], reload: load, owner: data?.can_edit ? userId : null })
  const items = moves.items
  // Closing or reloading the tab with moves pending asks first, with the editor open too:
  // its own warning only counts what was changed in it.
  const pending = moves.count > 0
  useEffect(() => {
    if (!pending) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])
  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId])
  const select = useCallback((id: string | null) => setParam({ item: id }), [setParam])
  useEffect(() => { if (!selectedId) setDetailsFor(null) }, [selectedId])

  const canMove = !!data?.can_edit
  const moving = moveMode && canMove && view === '3d' && !editing
  const { undo } = moves
  useEffect(() => {
    if (!moving) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moving, undo])

  // "View in tunnel" on a machine's page lands here as ?asset=<its id>.
  const assetParam = params.get('asset')
  const fromChecklist = params.get('source') === 'checklist'
  useEffect(() => {
    // With source=checklist the asset belongs to the scanner (MaintenanceInventoryPage).
    if (!assetParam || fromChecklist || !data || data.site.id !== site) return
    const shape = data.items.find((i) => i.asset_id === assetParam && !shapeFor(i.kind).scenery)
    if (shape) setParam({ asset: null, item: shape.id })
    else {
      // The link may also name the shape itself (a component drawn as part of its machine).
      if (data.layout && !data.items.some((i) => i.id === selectedId)) notify("That machine isn't on this site's drawing yet.", 'warn')
      setParam({ asset: null })
    }
  }, [assetParam, fromChecklist, data, site, selectedId, setParam, notify])

  // One shape per machine that's down, entrance to exit.
  const downShapes = useMemo(() => {
    const seen = new Set<string>()
    const out: TunnelItem[] = []
    for (const i of [...items].sort(tunnelOrder)) {
      if (!i.asset_id || seen.has(i.asset_id) || shapeFor(i.kind).scenery || !isDown(data?.assets[i.asset_id])) continue
      seen.add(i.asset_id)
      out.push(i)
    }
    return out
  }, [items, data])
  const unlinkedShapes = useMemo(() => items.filter((i) => !i.asset_id && !shapeFor(i.kind).scenery).sort(tunnelOrder), [items])

  const openMachine = useCallback((item: TunnelItem) => {
    if (!item.asset_id) return
    // Coming back, the machine that was opened is the one selected.
    const back = new URLSearchParams(params)
    back.set('item', item.id)
    navigate(`${EQUIPMENT_BASE}/${item.asset_id}`, { state: { from: { to: `${pathname}?${back}`, label: 'Back to tunnel' } } })
  }, [params, pathname, navigate])
  const showDetails = useCallback((id: string) => {
    setDetailsFor(id)
    if (id !== selectedId) select(id)
  }, [selectedId, select])
  const failed3d = useCallback((reason: Tunnel3DFail) => {
    setFailed(reason)
    setMoveMode(false)
  }, [])

  const pickView = (v: View) => {
    writeStore(STORE_VIEW, v)
    // Only asking for 3D retries it; clearing on List or Diagram would mount the host for one commit and fetch the chunk.
    if (v === '3d') setFailed(null)
    setDetailsFor(null)
    if (v !== '3d') setMoveMode(false)
    setParam({ view: v })
  }
  const goSite = (id: string) => { writeStore(STORE_SITE, id); setMoveMode(false); setParam({ site: id, item: null, tunnel: null }) }
  const goTunnel = (no: string) => { setMoveMode(false); setParam({ tunnel: no === '1' ? null : no, item: null }) }
  // The moves belong to the drawing on screen: leaving it for another one drops them, so ask.
  const pickSite = (id: string) => (moves.count > 0 ? setSwitching({ site: id }) : goSite(id))
  const pickTunnel = (no: string) => (moves.count > 0 ? setSwitching({ tunnel: no }) : goTunnel(no))
  const nextDown = () => {
    const k = downShapes.findIndex((i) => i.id === selectedId)
    select(downShapes[(k + 1) % downShapes.length].id)
  }
  const editDrawing = () => { setMoveMode(false); setParam({ edit: '1', item: null }) }
  // A shape picked from the list opens where it can be linked: in 3D that is the side
  // panel, which otherwise waits to be asked for. The 3D view flies to it either way.
  const pickUnlinked = (id: string) => (view === '3d' ? showDetails(id) : select(id))
  const closeList = () => {
    setParam({ unlinked: null })
    // With nothing left the toggle goes away with the list, and focus would fall to the
    // page: it waits on the count beside it instead.
    if (unlinkedShapes.length > 0 || data?.unplaced.length) listToggle.current?.focus()
    else linkedLine.current?.focus()
  }

  const createStandard = async () => {
    setCreating(true)
    try {
      const r = await miTunnel.save(expressTemplate())
      const fresh = await miTunnel.get(site, tunnelNo)
      setData(fresh)
      setApplying({ id: r.id, name: fresh.templates.find((t) => t.id === r.id)?.name ?? 'the standard template' })
    } catch (e) {
      setError(errText(e))
    } finally {
      setCreating(false)
    }
  }

  if (editing && data?.layout) {
    // The editor opens on the drawing as it looks now, unsaved moves included, so saving
    // there saves them too.
    return (
      <TunnelEditor
        layout={data.layout} items={items} assets={data.assets} unplaced={data.unplaced} siteId={site} siteName={data.site.name}
        onClose={(saved) => {
          setParam({ edit: null })
          if (saved) { moves.clear(); void load() }
        }} />
    )
  }

  const linked = items.filter((i) => i.asset_id).length
  const linkable = items.filter((i) => !shapeFor(i.kind).scenery).length
  const showPanel = !!selected && (view !== '3d' || detailsFor !== null)
  const bar = moves.count > 0 || moves.error || moves.conflict || moves.gone.length > 0 || moves.changed.length > 0 ? <MovesBar moves={moves} floating={view === '3d'} /> : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => pickSite(e.target.value)} aria-label="Site" className="w-full sm:w-48">
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        {data && data.tunnels.length > 1 && (
          <Select value={String(tunnelNo)} onChange={(e) => pickTunnel(e.target.value)} aria-label="Tunnel" className="sm:w-36">
            {data.tunnels.map((t) => <option key={t.tunnel_no} value={t.tunnel_no}>{t.name}</option>)}
          </Select>
        )}
        {data?.layout && (
          <>
            <Select value={colorBy} onChange={(e) => { setColorBy(e.target.value as ColorBy); writeStore(STORE_COLOR, e.target.value) }} aria-label="Color by" className="sm:w-44">
              <option value="status">Color by status</option>
              <option value="usage">Color by use count</option>
              <option value="wos">Color by open work orders</option>
              <option value="sticker">Color by sticker</option>
            </Select>
            <div className="flex rounded-md border border-border bg-card p-0.5" role="group" aria-label="Show the tunnel as">
              {VIEWS.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => pickView(id)} aria-pressed={view === id}
                  className={cn('inline-flex h-8 items-center gap-1 rounded px-2.5 text-sm', view === id ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
            {view === 'diagram' && (
              <Button variant="secondary" size="sm" onClick={() => setTurned(orientation === 'h')} title="Turn the drawing">
                <RotateCw className="size-4" /> Turn
              </Button>
            )}
            {data.can_edit && !narrow && (
              <Button variant="secondary" size="sm" onClick={editDrawing}><Pencil className="size-4" /> Edit drawing</Button>
            )}
          </>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <div className="grid place-items-center rounded-md border border-border bg-card py-20 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>}

      {data && !data.layout && (
        <>
          <Showroom key={data.templates[0]?.id ?? 'standard'} templateId={data.templates[0]?.id ?? null} />
          <EmptyState icon={MapIcon} title={`No tunnel diagram for ${data.site.name} yet`}
            description={data.templates.length > 0
              ? 'Start from a template. Each shape links to this site\'s machine of the same type, and you can move things to match the real tunnel afterwards.'
              : data.can_edit_templates
                ? 'There are no templates yet. Create the standard express tunnel (built from the machines MaintainX lists at every Mighty Wash site), then set this site up from it.'
                : 'There are no templates yet. A corporate maintenance director or admin can create one.'}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {data.can_edit && data.templates.map((t) => (
                  <Button key={t.id} onClick={() => setApplying({ id: t.id, name: t.name })}>Start from {t.name}</Button>
                ))}
                {data.can_edit_templates && data.templates.length === 0 && (
                  <Button disabled={creating} onClick={() => void createStandard()}>{creating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Create the standard template</Button>
                )}
              </div>
            } />
        </>
      )}

      {data?.layout && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            <span className="inline-flex flex-wrap items-baseline gap-x-2">
              <span ref={linkedLine} tabIndex={-1} className="focus:outline-none">{linked} of {linkable} shapes linked to machines</span>
              {/* Also while the list is open with nothing left in it, so it can still be closed from here.
                  The padding is for a finger on a phone; the margin keeps the line its height. */}
              {(listOpen || unlinkedShapes.length > 0 || data.unplaced.length > 0) && (
                <button ref={listToggle} type="button" onClick={() => (listOpen ? closeList() : setParam({ unlinked: '1' }))}
                  aria-expanded={listOpen} aria-controls={listOpen ? listId : undefined}
                  className="-my-1 rounded-sm py-1 font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {listOpen ? "Hide what's not linked" : "See what's not linked"}
                </button>
              )}
            </span>
            {data.unplaced.length > 0 && <span>{data.unplaced.length} machine{data.unplaced.length === 1 ? '' : 's'} at this site not on the drawing</span>}
            {data.site.cars_30d != null
              ? <span>{cars(data.site.cars_today)} cars today, {cars(data.site.cars_30d)} in 30 days (through {day(data.site.data_through)})</span>
              : <span>No daily car counts for this site</span>}
            {downShapes.length > 0 && (
              <button type="button" onClick={nextDown} title="Show the machines that are down"
                className="inline-flex items-center rounded-full bg-danger-soft py-0.5 pl-2 pr-1 text-xs font-medium text-danger hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
                {downShapes.length} down <ChevronRight className="size-3.5" />
              </button>
            )}
          </div>

          {listOpen && (
            <NotLinked id={listId} shapes={unlinkedShapes} unplaced={data.unplaced} assets={data.assets} selectedId={selectedId} canEdit={data.can_edit}
              onPick={pickUnlinked} onPlace={data.can_edit && !narrow ? editDrawing : undefined} onClose={closeList} />
          )}

          <div className={cn('grid grid-cols-1 gap-4', showPanel && 'lg:grid-cols-[minmax(0,1fr)_400px]')}>
            {view === '3d' ? (
              // The canvas paints the page color and draws its own legend, so it sits
              // straight on the page: no card around it.
              <Tunnel3DHost className="min-w-0" layout={data.layout} items={items} assets={data.assets} saved={moves.saved} mode="site" memoryKey={data.layout.id}
                colorBy={colorBy} selectedId={selectedId} onSelect={select} onOpen={openMachine} onDetails={showDetails}
                canMove={canMove} moveMode={moving} onMoveMode={setMoveMode} onMove={moves.move} footer={bar ?? undefined} onFail={failed3d} />
            ) : (
              <div className="flex min-w-0 flex-col gap-3">
                {want === '3d' && failed && (
                  <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-ink-muted">
                    <span>{failed === 'unsupported' ? "This device can't show the 3D view, so here is the diagram." : 'The 3D view stopped, so here is the diagram.'}</span>
                    {failed !== 'unsupported' && <Button size="sm" variant="secondary" onClick={() => setFailed(null)}>Try 3D again</Button>}
                  </div>
                )}
                {bar}
                <div className="min-w-0 rounded-md border border-border bg-card p-2 sm:p-3">
                  {view === 'diagram' ? (
                    <TunnelDiagram layout={data.layout} items={items} assets={data.assets} orientation={orientation} colorBy={colorBy}
                      selectedId={selectedId} onSelect={select} onBackgroundPointerDown={() => select(null)} />
                  ) : (
                    <ListView items={items} assets={data.assets} colorBy={colorBy} selectedId={selectedId} onSelect={select} />
                  )}
                  <div className="mt-2 border-t border-border pt-2"><DiagramLegend colorBy={colorBy} /></div>
                </div>
              </div>
            )}
            {showPanel && selected && (
              <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-hidden">
                {/* In 3D closing the panel leaves the machine picked: its card is still in the canvas. */}
                <TunnelPanel item={selected} siteId={site} canEdit={data.can_edit} onClose={() => (view === '3d' ? setDetailsFor(null) : select(null))} onChanged={() => void load()} />
              </div>
            )}
          </div>
          {data.layout.updated_by && <p className="text-[11px] text-ink-subtle">Drawing last changed {day(data.layout.updated_at)} by {data.layout.updated_by}.</p>}
        </>
      )}

      {applying && data && (
        <ApplyTemplateDialog source={applying} sites={[{ id: site, name: data.site.name, has: !!data.layout }]} preselect={[site]}
          onClose={() => setApplying(null)} onDone={() => void load()} />
      )}

      {moves.count > 0 && <LeaveGuard count={moves.count} />}
      <ConfirmDialog open={!!switching} title={`You have ${plural(moves.count, 'unsaved move')}`}
        description={`Going to another ${switching?.tunnel ? 'tunnel' : 'site'} puts those machines back where they were saved. Save first to keep the moves.`}
        confirmLabel="Go without saving" cancelLabel="Stay here" destructive
        onCancel={() => setSwitching(null)}
        onConfirm={() => {
          const to = switching
          setSwitching(null)
          moves.clear()
          if (to?.site) goSite(to.site)
          else if (to?.tunnel) goTunnel(to.tunnel)
        }} />
    </div>
  )
}

// Going elsewhere in the app with unsaved moves asks first. Two ways out are let through: a
// change to this page's own search params, and a machine's page opened from here, which
// carries the way back (the moves wait in sessionStorage either way). Mounted only while
// there are moves and the editor is closed: the router takes one blocker at a time, and
// the editor brings its own. Closing the tab is the page's beforeunload.
function LeaveGuard({ count }: { count: number }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname) return false
    const back = (nextLocation.state as { from?: { to?: unknown } } | null)?.from?.to
    return !(nextLocation.pathname.startsWith(`${EQUIPMENT_BASE}/`) && typeof back === 'string' && back.split('?')[0] === currentLocation.pathname)
  })
  return (
    <ConfirmDialog open={blocker.state === 'blocked'} title="Leave without saving?"
      description={`You moved ${plural(count, 'machine')} and haven't saved. The moves will still be here if you come back on this tab, but they aren't on the drawing until you save.`}
      confirmLabel="Leave" cancelLabel="Stay"
      onCancel={() => { if (blocker.state === 'blocked') blocker.reset() }}
      onConfirm={() => { if (blocker.state === 'blocked') blocker.proceed() }} />
  )
}

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

// What to say under the buttons: why a save didn't go through, or which moves fell away.
// short is the line a phone shows until it is tapped open.
function movesNote(m: TunnelMoves): { text: string; short: string; tone: 'warn' | 'danger' } | null {
  const lost = m.gone.length + m.changed.length
  const dropped = [
    m.changed.length ? `${m.conflict ? 'They' : 'Someone else'} moved ${list(m.changed)}${m.conflict ? '' : ' in the meantime'}, so your ${m.changed.length === 1 ? 'move of it was' : 'moves of them were'} dropped.` : '',
    m.gone.length ? `${list(m.gone)} ${m.gone.length === 1 ? 'is' : 'are'} no longer on the drawing, so ${m.gone.length === 1 ? 'that move was' : 'those moves were'} dropped.` : '',
  ].filter(Boolean).join(' ')
  const lostShort = plural(lost, 'move')
  if (m.conflict) {
    const mine = m.count > 0 ? ` Your ${plural(m.count, 'move')} ${m.count === 1 ? 'is' : 'are'} on top of the latest version: save again, or reset.` : ''
    return { text: `Someone else changed this drawing.${mine}${dropped && ` ${dropped}`}`, short: `Someone else saved first${lost ? `, ${lostShort} dropped` : ''}.`, tone: 'warn' }
  }
  if (m.error) return { text: `${m.error}${dropped && ` ${dropped}`}`, short: `Not saved${lost ? `, ${lostShort} dropped` : ''}.`, tone: 'danger' }
  return dropped ? { text: dropped, short: `${lostShort} dropped.`, tone: 'warn' } : null
}

// The unsaved moves: how many, and what to do with them. In 3D it floats over the bottom
// of the canvas (the 3D view places it); elsewhere it sits above the drawing. Under 480 px
// the buttons never wrap and a note is one short line that opens on a tap, so the bar
// stays small over a phone's canvas and doesn't push the machine card into scrolling.
function MovesBar({ moves, floating }: { moves: TunnelMoves; floating: boolean }) {
  const note = movesNote(moves)
  // Which note was tapped open: a new one starts short again.
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = !!note && openFor === note.text
  const toneText = note?.tone === 'danger' ? 'text-danger' : 'text-warn'
  return (
    <div role="group" aria-label="Unsaved moves" className={cn('flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2 max-[480px]:gap-1 max-[480px]:px-2.5 max-[480px]:py-1.5', floating && 'shadow-lg')}>
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 max-[480px]:flex-nowrap">
        <span className="mr-auto text-sm font-medium text-ink max-[480px]:min-w-0 max-[480px]:truncate" aria-live="polite">
          {moves.count > 0 ? (
            // A phone shows "2 moved" (the full count doesn't fit beside the buttons at
            // 360 px); a screen reader always hears it whole.
            <><span className="max-[480px]:sr-only">{plural(moves.count, 'machine')} moved</span><span aria-hidden className="min-[480px]:hidden">{moves.count} moved</span></>
          ) : 'No unsaved moves'}
        </span>
        {moves.count > 0 ? (
          // The buttons stay together: short of room they go under the count, to the right
          // (on a phone they stay beside it). There Undo is just its arrow and Save loses
          // its icon, so they fit.
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={moves.undo} disabled={!moves.canUndo || moves.saving} aria-label="Undo" title="Undo"
              className="max-sm:px-2"><Undo2 className="size-4" /><span className="max-sm:hidden">Undo</span></Button>
            <Button size="sm" variant="secondary" onClick={moves.reset} disabled={moves.saving}>Reset</Button>
            <Button size="sm" onClick={() => void moves.save()} disabled={moves.saving}>
              {moves.saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4 max-sm:hidden" />} Save
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={moves.dismiss} className="shrink-0">OK</Button>
        )}
      </div>
      {note && (
        <>
          {/* The whole note is always read out; on a phone it is drawn by the line below. */}
          <p role="alert" className={cn('text-xs max-[480px]:sr-only', toneText)}>{note.text}</p>
          {note.short === note.text ? (
            <p aria-hidden className={cn('truncate text-xs min-[480px]:hidden', toneText)}>{note.text}</p>
          ) : (
            <button type="button" aria-expanded={open} title={note.text} onClick={() => setOpenFor(open ? null : note.text)}
              className={cn('flex min-w-0 items-start gap-1 rounded-sm text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent min-[480px]:hidden', toneText)}>
              <span className={cn('min-w-0', !open && 'truncate')}>{open ? note.text : note.short}</span>
              <ChevronDown className={cn('mt-px size-3.5 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
            </button>
          )}
        </>
      )}
    </div>
  )
}

// What a site's tunnel could look like, before it has a drawing: the account's first
// template (or the standard express tunnel when there are none yet) as a 3D showroom.
type Preview = { layout: Pick<TunnelLayout, 'length_ft' | 'width_ft' | 'zones'>; items: TunnelItem[] }
const previews = new Map<string, Promise<Preview>>()
let standard: Preview | null = null

function standardPreview(): Preview {
  if (!standard) {
    const t = expressTemplate()
    standard = {
      layout: { length_ft: t.length_ft ?? 134, width_ft: t.width_ft ?? 16, zones: t.zones ?? [] },
      items: (t.items ?? []).map((i, k) => ({ ...i, id: `preview-${k}` })),
    }
  }
  return standard
}

// One request per template, however many empty sites are looked at.
function templatePreview(id: string): Promise<Preview> {
  let p = previews.get(id)
  if (!p) {
    p = miTunnel.template(id).then((t) => ({ layout: t.layout, items: t.items }))
    p.catch(() => previews.delete(id))
    previews.set(id, p)
  }
  return p
}

const NO_ASSETS: Record<string, TunnelAsset> = {}
const nothing = () => {}

function Showroom({ templateId }: { templateId: string | null }) {
  const [preview, setPreview] = useState<Preview | null>(() => (templateId ? null : standardPreview()))
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!templateId) return
    let alive = true
    templatePreview(templateId)
      .then((p) => { if (alive) setPreview(p) })
      .catch(() => { if (alive) setPreview(standardPreview()) })
    return () => { alive = false }
  }, [templateId])
  if (hidden || !preview) return null
  return (
    // Shorter than a site's own view (the ! beats the view's usual height), so the title
    // and the buttons under it are on screen without scrolling.
    <Tunnel3DHost className="h-[min(40svh,320px)]! md:h-[clamp(300px,40vh,480px)]!"
      layout={preview.layout} items={preview.items} assets={NO_ASSETS} mode="preview" memoryKey="preview" colorBy="status"
      selectedId={null} onSelect={nothing} onOpen={nothing} canMove={false} moveMode={false} onMoveMode={nothing} onMove={nothing} onFail={() => setHidden(true)} />
  )
}

// Color-by in the list: each row gets a square painted as its shape is in the diagram
// (the diagram's own ToneSquare), named for a screen reader.
const TONE_SAYS: Record<ColorBy, Partial<Record<Tone, string>>> = {
  status: { ok: 'Running', warn: 'Down for maintenance', danger: 'Broken down' },
  wos: { neutral: 'No open work orders', warn: 'One open work order', danger: 'Two or more open work orders' },
  sticker: { ok: 'Sticker printed', warn: 'Tag made, not printed', danger: 'No sticker' },
  usage: { neutral: 'No start date' },
}

function ToneSwatch({ tone, colorBy }: { tone: Tone; colorBy: ColorBy }) {
  const heat = heatStep(tone)
  const says = tone === 'unlinked' ? 'Not linked to a machine' : tone === 'retired' ? 'Retired'
    : heat >= 0 ? `Use, shade ${heat + 1} of ${HEAT_TONES.length} (darker is more cars)` : TONE_SAYS[colorBy][tone] ?? ''
  return (
    <ToneSquare tone={tone} role="img" aria-label={says}>
      <title>{says}</title>
    </ToneSquare>
  )
}

// The same drawing as a table, zone by zone: for screen readers, and for a quick read
// of what's down.
function ListView({ items, assets, colorBy, selectedId, onSelect }: { items: TunnelItem[]; assets: Record<string, TunnelAsset>; colorBy: ColorBy; selectedId: string | null; onSelect: (id: string) => void }) {
  const rows = items.filter((i) => !shapeFor(i.kind).scenery).sort((a, b) => Number(a.x_ft) - Number(b.x_ft))
  const zones = [...new Set(rows.map((i) => i.zone ?? 'Other'))]
  // Use is shaded against the busiest machine on the whole drawing, as in the diagram.
  const maxCars = useMemo(() => maxCarsOf(items, assets), [items, assets])
  // A row picked from somewhere else (the "down" button, a link) may be off screen.
  const picked = useRef<HTMLTableRowElement>(null)
  useEffect(() => { picked.current?.scrollIntoView({ block: 'nearest' }) }, [selectedId])
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-ink-subtle">
          <tr><th className="px-2 py-1.5 font-medium">Shape</th><th className="px-2 py-1.5 font-medium">Machine</th><th className="px-2 py-1.5 font-medium">Status</th><th className="px-2 py-1.5 text-right font-medium">Cars since</th><th className="px-2 py-1.5 text-right font-medium">Open WOs</th></tr>
        </thead>
        {zones.map((z) => (
          <tbody key={z} className="divide-y divide-border">
            <tr><td colSpan={5} className="bg-content px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{z}</td></tr>
            {rows.filter((i) => (i.zone ?? 'Other') === z).map((i: TunnelItem) => {
              const a = i.asset_id ? assets[i.asset_id] : undefined
              const on = selectedId === i.id
              return (
                <tr key={i.id} ref={on ? picked : undefined} onClick={() => onSelect(i.id)} className={cn('cursor-pointer', on ? 'bg-accent-soft' : 'hover:bg-content')}>
                  <td className="px-2 py-2 text-ink">
                    <span className="flex items-center gap-2">
                      <ToneSwatch tone={toneFor(a, colorBy, maxCars)} colorBy={colorBy} />
                      {/* The row takes a click; the button is how a keyboard or a screen reader picks it. */}
                      <button type="button" aria-pressed={on} onClick={(e) => { e.stopPropagation(); onSelect(i.id) }}
                        className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        {i.label || shapeFor(i.kind).label}
                      </button>
                    </span>
                  </td>
                  <td className="px-2 py-2">{a ? shortName(a.name) : <span className="text-ink-subtle">Not linked</span>}</td>
                  <td className="px-2 py-2">{a && <Badge tone={STATUS[a.status]?.tone ?? 'neutral'}>{STATUS[a.status]?.short ?? a.status}</Badge>}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-muted">{a?.cars_since != null ? cars(a.cars_since) : '–'}</td>
                  <td className={cn('px-2 py-2 text-right tabular-nums', a?.open_wos ? 'font-medium text-warn' : 'text-ink-subtle')}>{a?.open_wos || '–'}</td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}
