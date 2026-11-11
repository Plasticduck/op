import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LayoutList, Loader2, Map as MapIcon, Pencil, RotateCw, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { miTunnel, type TunnelData, type TunnelItem } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { day, errText } from '../format'
import { ErrorNote } from '../ui'
import { cars, shortName, STATUS } from '../equipment/format'
import { ApplyTemplateDialog } from './ApplyTemplateDialog'
import { expressTemplate } from './expressTemplate'
import type { Orientation } from './geometry'
import { shapeFor } from './shapes'
import { DiagramLegend, TunnelDiagram, type ColorBy } from './TunnelDiagram'
import { TunnelEditor } from './TunnelEditor'
import { TunnelPanel } from './TunnelPanel'

// A site's tunnel from above. Pick a machine to see everything about it beside the
// drawing; color the drawing by status, use, open work orders or stickers. Every site's
// drawing starts as a copy of a template and is then adjusted to match the real tunnel.

const STORE_SITE = 'mi.tunnel.site'
const STORE_COLOR = 'mi.tunnel.color'

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

export default function TunnelPage() {
  const { refs } = useMi()
  const [params, setParams] = useSearchParams()
  const narrow = useNarrow()
  const siteParam = params.get('site')
  const site = (siteParam && refs.sites.some((s) => s.id === siteParam) ? siteParam : null)
    ?? (() => { const s = readStore(STORE_SITE); return s && refs.sites.some((x) => x.id === s) ? s : refs.sites[0]?.id ?? '' })()
  const tunnelNo = Number(params.get('tunnel') ?? 1) || 1
  const selectedId = params.get('item')
  const view = params.get('view') === 'list' ? 'list' : 'diagram'
  const [colorBy, setColorBy] = useState<ColorBy>(() => (readStore(STORE_COLOR) as ColorBy | null) ?? 'status')
  const [turned, setTurned] = useState<boolean | null>(null)
  const orientation: Orientation = (turned ?? narrow) ? 'v' : 'h'
  const [data, setData] = useState<TunnelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState<{ id: string; name: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const editing = params.get('edit') === '1'

  const setParam = useCallback((patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    return next
  }, { replace: true }), [setParams])

  const load = useCallback(async () => {
    if (!site) return
    try {
      setData(await miTunnel.get(site, tunnelNo))
      setError(null)
    } catch (e) {
      setError(errText(e))
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

  const selected = useMemo(() => data?.items.find((i) => i.id === selectedId) ?? null, [data, selectedId])
  const pickSite = (id: string) => { writeStore(STORE_SITE, id); setParam({ site: id, item: null, tunnel: null }) }
  const select = (id: string | null) => setParam({ item: id })

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
    return (
      <TunnelEditor
        layout={data.layout} items={data.items} assets={data.assets} unplaced={data.unplaced} siteId={site} siteName={data.site.name}
        onClose={(saved) => { setParam({ edit: null }); if (saved) void load() }} />
    )
  }

  const linked = data ? data.items.filter((i) => i.asset_id).length : 0
  const linkable = data ? data.items.filter((i) => !shapeFor(i.kind).scenery).length : 0
  const down = data ? Object.values(data.assets).filter((a) => a.status === 'offline_planned' || a.status === 'offline_unplanned') : []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => pickSite(e.target.value)} aria-label="Site" className="w-full sm:w-48">
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        {data && data.tunnels.length > 1 && (
          <Select value={String(tunnelNo)} onChange={(e) => setParam({ tunnel: e.target.value === '1' ? null : e.target.value, item: null })} aria-label="Tunnel" className="w-36">
            {data.tunnels.map((t) => <option key={t.tunnel_no} value={t.tunnel_no}>{t.name}</option>)}
          </Select>
        )}
        {data?.layout && (
          <>
            <Select value={colorBy} onChange={(e) => { setColorBy(e.target.value as ColorBy); writeStore(STORE_COLOR, e.target.value) }} aria-label="Color by" className="w-44">
              <option value="status">Color by status</option>
              <option value="usage">Color by use count</option>
              <option value="wos">Color by open work orders</option>
              <option value="sticker">Color by sticker</option>
            </Select>
            <div className="flex rounded-md border border-border bg-card p-0.5">
              <button type="button" onClick={() => setParam({ view: null })} aria-pressed={view === 'diagram'}
                className={cn('inline-flex h-8 items-center gap-1 rounded px-2.5 text-sm', view === 'diagram' ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
                <MapIcon className="size-4" /> Diagram
              </button>
              <button type="button" onClick={() => setParam({ view: 'list' })} aria-pressed={view === 'list'}
                className={cn('inline-flex h-8 items-center gap-1 rounded px-2.5 text-sm', view === 'list' ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
                <LayoutList className="size-4" /> List
              </button>
            </div>
            {view === 'diagram' && (
              <Button variant="secondary" size="sm" onClick={() => setTurned(orientation === 'h')} title="Turn the drawing">
                <RotateCw className="size-4" /> Turn
              </Button>
            )}
            {data.can_edit && !narrow && (
              <Button variant="secondary" size="sm" onClick={() => setParam({ edit: '1', item: null })}><Pencil className="size-4" /> Edit drawing</Button>
            )}
          </>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <div className="grid place-items-center rounded-md border border-border bg-card py-20 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>}

      {data && !data.layout && (
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
      )}

      {data?.layout && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            <span>{linked} of {linkable} shapes linked to machines</span>
            {data.unplaced.length > 0 && <span>{data.unplaced.length} machine{data.unplaced.length === 1 ? '' : 's'} at this site not on the drawing</span>}
            {data.site.cars_30d != null
              ? <span>{cars(data.site.cars_today)} cars today, {cars(data.site.cars_30d)} in 30 days (through {day(data.site.data_through)})</span>
              : <span>No daily car counts for this site</span>}
            {down.length > 0 && <Badge tone="danger">{down.length} down</Badge>}
          </div>

          <div className={cn('grid grid-cols-1 gap-4', selected && 'lg:grid-cols-[minmax(0,1fr)_400px]')}>
            <div className="min-w-0 rounded-md border border-border bg-card p-2 sm:p-3">
              {view === 'diagram' ? (
                <>
                  <TunnelDiagram layout={data.layout} items={data.items} assets={data.assets} orientation={orientation} colorBy={colorBy}
                    selectedId={selectedId} onSelect={select} onBackgroundPointerDown={() => select(null)} />
                  <div className="mt-2 border-t border-border pt-2"><DiagramLegend colorBy={colorBy} /></div>
                </>
              ) : (
                <ListView data={data} selectedId={selectedId} onSelect={select} />
              )}
            </div>
            {selected && <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-hidden"><TunnelPanel item={selected} siteId={site} canEdit={data.can_edit} onClose={() => select(null)} onChanged={() => void load()} /></div>}
          </div>
          {data.layout.updated_by && <p className="text-[11px] text-ink-subtle">Drawing last changed {day(data.layout.updated_at)} by {data.layout.updated_by}.</p>}
        </>
      )}

      {applying && data && (
        <ApplyTemplateDialog source={applying} sites={[{ id: site, name: data.site.name, has: !!data.layout }]} preselect={[site]}
          onClose={() => setApplying(null)} onDone={() => void load()} />
      )}
    </div>
  )
}

// The same drawing as a table, zone by zone: for screen readers, and for a quick read
// of what's down.
function ListView({ data, selectedId, onSelect }: { data: TunnelData; selectedId: string | null; onSelect: (id: string) => void }) {
  const rows = data.items.filter((i) => !shapeFor(i.kind).scenery).sort((a, b) => Number(a.x_ft) - Number(b.x_ft))
  const zones = [...new Set(rows.map((i) => i.zone ?? 'Other'))]
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
              const a = i.asset_id ? data.assets[i.asset_id] : undefined
              return (
                <tr key={i.id} onClick={() => onSelect(i.id)} className={cn('cursor-pointer', selectedId === i.id ? 'bg-accent-soft' : 'hover:bg-content')}>
                  <td className="px-2 py-2 text-ink">{i.label || shapeFor(i.kind).label}</td>
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
