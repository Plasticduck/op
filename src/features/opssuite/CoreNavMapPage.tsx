import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ExternalLink, Layers, Link2, Loader2, RotateCw, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { connections } from '@/lib/queries/connections'
import { CoreNavMapError, corenavMap, groupFor, type CnPoints, type CnSetup, type CnTab } from '@/lib/queries/corenavMap'
import { SitePanel, type PanelHead } from './corenav/SitePanel'

// Operations - Admin > CoreNav Map, on Operator's own map (Leaflet + OpenStreetMap,
// like Market Explorer). CoreNav's sites come through the person's own CoreNav
// connection (Operator AI > Connections), styled the way CoreNav's own map is set
// up (its map_config): colour by format, Mighty Wash sites marked, target tiers
// ringed, closed sites hidden. Tapping a site opens CoreNav's sidebar for it.
// Not drawn here yet: CoreNav's heat layers, demand shading, drive-time areas and
// road overlays (Open in CoreNav has them).

const CORENAV_MAP_URL = 'https://expand.corenav.ai/map'
const BOTTOM_NAV = 'bottom-[calc(3.25rem+env(safe-area-inset-bottom))] lg:bottom-0'

// Survives leaving the page and coming back (14,000+ sites is a big download).
const cache = new Map<string, { setup: CnSetup; points: CnPoints }>()
let lastUniverse: string | undefined

type Pt = {
  id: string
  entity: string | null
  name: string
  sub: string
  lat: number
  lng: number
  group: string
  format: string
  closed: boolean
  mw: boolean
  tier: string | null
  radius: number
  row: unknown[]
}

const mwIcon = L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  html:
    '<div style="width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid #2563eb;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;overflow:hidden">' +
    '<img src="/mw-logo.png" alt="" style="width:24px;height:24px;object-fit:contain"/></div>',
})

export default function CoreNavMapPage() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const pickRef = useRef<L.CircleMarker | null>(null)
  const rendererRef = useRef<L.Canvas | null>(null)
  const siteReq = useRef(0)
  const viewSetFor = useRef<string | null>(null)

  const [phase, setPhase] = useState<'loading' | 'not_connected' | 'reconnect' | 'error' | 'ready'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [setup, setSetup] = useState<CnSetup | null>(null)
  const [points, setPoints] = useState<CnPoints | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [showMw, setShowMw] = useState(true)
  const [showTiers, setShowTiers] = useState(true)
  const [showClosed, setShowClosed] = useState(false)
  const [q, setQ] = useState('')
  const [legendOpen, setLegendOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const [connecting, setConnecting] = useState(false)
  const [selected, setSelected] = useState<Pt | null>(null)
  const [siteTabs, setSiteTabs] = useState<CnTab[] | null>(null)
  const [siteLoading, setSiteLoading] = useState(false)
  const [siteError, setSiteError] = useState<string | null>(null)

  const load = useCallback(async (universe?: string, fresh = false) => {
    try {
      const key = universe ?? lastUniverse ?? ''
      let hit = fresh ? undefined : cache.get(key)
      if (!hit) {
        const s = await corenavMap.setup(universe)
        const p = await corenavMap.points(s.universe)
        hit = { setup: s, points: p }
        cache.set(s.universe, hit)
        if (!universe) cache.set('', hit)
      }
      lastUniverse = hit.setup.universe
      setSetup(hit.setup)
      setPoints(hit.points)
      setPhase('ready')
    } catch (e) {
      const code = e instanceof CoreNavMapError ? e.code : undefined
      if (code === 'not_connected') setPhase('not_connected')
      else if (code === 'reconnect') setPhase('reconnect')
      else { setPhase('error'); setMessage(e instanceof Error ? e.message : "Couldn't load CoreNav's map.") }
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const reload = (universe?: string) => {
    setPhase('loading')
    setSelected(null)
    if (universe) viewSetFor.current = null
    void load(universe ?? setup?.universe, true)
  }

  const connect = async () => {
    setConnecting(true)
    try {
      try { sessionStorage.setItem('connect.back', '/app/corenav-map') } catch { /* private mode */ }
      const { url } = await connections.start('corenav')
      window.location.assign(url)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't start the CoreNav sign-in.")
      setConnecting(false)
    }
  }

  const cfg = setup?.config?.points
  const accent = setup?.config?.accent ?? '#24a9e0'
  const accent2 = setup?.config?.accent2 ?? '#d32a2a'

  // Points, the way CoreNav's map setup describes them.
  const pts = useMemo<Pt[]>(() => {
    if (!points || !cfg) return []
    const at = (name?: string) => (name ? points.columns.indexOf(name) : -1)
    const iId = at(cfg.id), iEnt = at(cfg.entity), iName = at(cfg.title ?? 'name')
    const iLat = at('lat'), iLng = points.columns.includes('lng') ? at('lng') : at('lon')
    const iFmt = at(cfg.color?.column), iHide = at(cfg.hide?.column), iMark = at(cfg.mark?.column)
    const iTier = at(cfg.tiers?.column), iSize = at(cfg.size?.column)
    const iSub = (cfg.subtitle ?? []).map(at).filter((i) => i >= 0)
    const hideVals = new Set((cfg.hide?.values ?? []).map(String))
    const out: Pt[] = []
    for (const r of points.rows) {
      const lat = Number(r[iLat]), lng = Number(r[iLng])
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const fmt = iFmt >= 0 ? String(r[iFmt] ?? '') : ''
      const size = iSize >= 0 ? Number(r[iSize]) || 0 : 0
      out.push({
        id: String(r[iId]),
        entity: iEnt >= 0 && r[iEnt] != null ? String(r[iEnt]) : null,
        name: String(r[iName] ?? 'Unnamed'),
        sub: iSub.map((i) => r[i]).filter(Boolean).join(', '),
        lat, lng,
        group: groupFor(cfg.color, fmt),
        format: fmt,
        closed: iHide >= 0 && hideVals.has(String(r[iHide])),
        mw: iMark >= 0 && r[iMark] === true,
        tier: iTier >= 0 && r[iTier] != null ? String(r[iTier]) : null,
        radius: Math.max(3, Math.min(10, 3 + Math.sqrt(size) * 0.3)),
        row: r,
      })
    }
    return out
  }, [points, cfg])

  const colorOf = useCallback((g: string) => {
    const grp = cfg?.color?.groups.find((x) => x.id === g)
    return (grp?.color ?? cfg?.color?.other?.color ?? ['#9ca3af'])[0]
  }, [cfg])
  const tierValues = useMemo(() => new Set(cfg?.tiers?.values ?? []), [cfg])
  const needle = q.trim().toLowerCase()
  const visible = useCallback((p: Pt) =>
    (showClosed || !p.closed) && (!needle || p.name.toLowerCase().includes(needle) || p.sub.toLowerCase().includes(needle)),
  [showClosed, needle])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of pts) if (!p.mw && visible(p)) c[p.group] = (c[p.group] ?? 0) + 1
    return c
  }, [pts, visible])

  const pick = useCallback((p: Pt) => {
    setSelected(p)
    setSiteTabs(null)
    setSiteError(null)
    setSiteLoading(true)
    // On a phone the sheet covers the lower part of the map: keep the site above it.
    const map = mapRef.current
    if (map && window.innerWidth < 1024) {
      map.panTo([p.lat, p.lng], { animate: false })
      map.panBy([0, Math.round(window.innerHeight * 0.27)], { animate: true })
    }
    const req = ++siteReq.current
    if (!setup) return
    corenavMap.site(setup.universe, p.id, p.entity)
      .then((r) => { if (req === siteReq.current) setSiteTabs(r.tabs) })
      .catch((e) => { if (req === siteReq.current) setSiteError(e instanceof Error ? e.message : "Couldn't load that site.") })
      .finally(() => { if (req === siteReq.current) setSiteLoading(false) })
  }, [setup])

  // The map, once.
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return
    const map = L.map(wrapRef.current, { center: [31.6, -99.3], zoom: 6, zoomControl: true, zoomSnap: 0.25, preferCanvas: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · data: CoreNav',
    }).addTo(map)
    map.zoomControl.setPosition('bottomright')
    rendererRef.current = L.canvas({ padding: 0.5 })
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 200)
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // CoreNav's starting view, once per universe.
  useEffect(() => {
    const map = mapRef.current
    const v = setup?.config?.view
    if (!map || !setup || viewSetFor.current === setup.universe) return
    viewSetFor.current = setup.universe
    if (v?.center) map.setView([v.center[1], v.center[0]], Math.round((v.zoom ?? 6) * 4) / 4)
  }, [setup])

  // Draw.
  useEffect(() => {
    const layer = layerRef.current
    const renderer = rendererRef.current
    if (!layer || !renderer) return
    layer.clearLayers()
    const mw: Pt[] = []
    for (const p of pts) {
      if (!visible(p)) continue
      if (p.mw) { mw.push(p); continue }
      if (hidden.has(p.group)) continue
      if (showTiers && p.tier && tierValues.has(p.tier)) {
        L.circleMarker([p.lat, p.lng], { renderer, radius: p.radius + 4, color: accent2, weight: p.tier === 'A' ? 2 : 1.25, opacity: p.tier === 'C' ? 0.45 : 0.7, fill: false, interactive: false }).addTo(layer)
      }
      L.circleMarker([p.lat, p.lng], { renderer, radius: p.radius, color: '#ffffff', weight: 1, fillColor: colorOf(p.group), fillOpacity: 0.9 })
        .on('click', () => pick(p))
        .bindTooltip(`${p.name}${p.sub ? ` · ${p.sub}` : ''}`, { direction: 'top', offset: [0, -4] })
        .addTo(layer)
    }
    if (showMw) {
      for (const p of mw) {
        L.marker([p.lat, p.lng], { icon: mwIcon, zIndexOffset: 1000, title: p.name }).on('click', () => pick(p)).addTo(layer)
      }
    }
  }, [pts, hidden, showMw, showTiers, visible, colorOf, tierValues, accent2, pick])

  // Ring the picked site.
  useEffect(() => {
    const map = mapRef.current
    pickRef.current?.remove()
    pickRef.current = null
    if (!map || !selected) return
    pickRef.current = L.circleMarker([selected.lat, selected.lng], { radius: 16, color: accent, weight: 3, fill: false, interactive: false }).addTo(map)
  }, [selected, accent])

  const zoomToMatches = () => {
    const map = mapRef.current
    if (!map || !needle) return
    const hits = pts.filter((p) => visible(p)).slice(0, 500)
    if (!hits.length) return
    if (hits.length === 1) { map.setView([hits[0].lat, hits[0].lng], 14); pick(hits[0]); return }
    map.fitBounds(L.latLngBounds(hits.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 14 })
  }

  const head = useMemo<PanelHead | null>(() => {
    if (!selected || !points || !cfg) return null
    const col = (name: string) => { const i = points.columns.indexOf(name); return i >= 0 ? selected.row[i] : null }
    const words = cfg.color?.words ?? {}
    const badges: PanelHead['badges'] = []
    if (selected.mw) badges.push({ text: cfg.mark?.label?.replace(/s$/, '') ?? 'Mighty Wash site', tone: 'accent' })
    if (selected.format) badges.push({ text: words[selected.format] ?? selected.format.replace(/_/g, ' ') })
    if (selected.tier && tierValues.has(selected.tier)) {
      const rank = cfg.tiers?.rank ? col(cfg.tiers.rank) : null
      badges.push({ text: `Tier ${selected.tier}${rank != null ? ` · rank ${rank}` : ''}`, tone: 'warn' })
    }
    if (selected.closed) badges.push({ text: 'Closed' })
    const rating = cfg.rating ? Number(col(cfg.rating.column)) : NaN
    const count = cfg.rating?.count ? Number(col(cfg.rating.count)) : NaN
    const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)).toLocaleString())
    const stats = [
      { label: 'Est. cars / yr', value: num(col('cars_mid')) },
      { label: 'Reviews, 12 mo', value: num(col('velocity_12m')) },
      { label: 'Road traffic', value: num(col('aadt_latest')) },
    ].filter((s): s is { label: string; value: string } => s.value != null)
    return {
      name: selected.name,
      subtitle: selected.sub,
      badges,
      rating: Number.isFinite(rating) && rating > 0 ? { value: rating, count: Number.isFinite(count) ? count : null } : null,
      stats,
    }
  }, [selected, points, cfg, tierValues])

  const groups = cfg?.color?.groups ?? []
  const universes = setup?.universes ?? []

  return (
    <div className="relative h-full w-full overflow-hidden bg-content">
      <div ref={wrapRef} className={cn('absolute inset-x-0 top-0 z-0', BOTTOM_NAV)} />

      {/* Top-left: title, search, layers. */}
      <div className="absolute left-3 top-3 z-[500] w-[min(19rem,calc(100vw-7rem))] space-y-2">
        <div className="rounded-xl border border-border bg-card/95 p-2.5 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">CoreNav Map</h1>
            {phase === 'ready' && (
              <button type="button" onClick={() => setLegendOpen((v) => !v)} aria-expanded={legendOpen}
                className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium', legendOpen ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-content')}>
                <Layers className="size-3.5" /> Layers
              </button>
            )}
          </div>
          {phase === 'ready' && (
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') zoomToMatches() }}
                placeholder="Search a wash or city" aria-label="Search CoreNav sites"
                className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-7 text-[13px] text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
              {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"><X className="size-3.5" /></button>}
            </div>
          )}
          {phase === 'ready' && legendOpen && (
            <div className="mt-2.5 space-y-2 border-t border-border pt-2.5 text-[12.5px]">
              {universes.length > 1 && (
                <select value={setup?.universe} onChange={(e) => reload(e.target.value)} aria-label="CoreNav universe"
                  className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[12.5px] leading-tight text-ink">
                  {universes.map((u) => <option key={u.universe} value={u.universe}>{u.label}</option>)}
                </select>
              )}
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-subtle">{setup?.config?.headings?.points ?? 'Washes'}</div>
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={!hidden.has(g.id)} className="accent-accent"
                    onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n })} />
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: g.color[0] }} />
                  <span className="min-w-0 flex-1 truncate text-ink">{g.label}</span>
                  <span className="tabular text-ink-subtle">{(counts[g.id] ?? 0).toLocaleString()}</span>
                </label>
              ))}
              {cfg?.color?.other && (
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={!hidden.has('other')} className="accent-accent"
                    onChange={() => setHidden((h) => { const n = new Set(h); if (n.has('other')) n.delete('other'); else n.add('other'); return n })} />
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: cfg.color.other.color[0] }} />
                  <span className="min-w-0 flex-1 truncate text-ink">{cfg.color.other.label}</span>
                  <span className="tabular text-ink-subtle">{(counts.other ?? 0).toLocaleString()}</span>
                </label>
              )}
              <div className="space-y-1.5 border-t border-border pt-2">
                {cfg?.mark && (
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showMw} onChange={() => setShowMw((v) => !v)} className="accent-accent" /><img src="/mw-logo.png" alt="" className="size-3.5" /> {cfg.mark.label}</label>
                )}
                {cfg?.tiers && (
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showTiers} onChange={() => setShowTiers((v) => !v)} className="accent-accent" /><span className="size-2.5 rounded-full border-2" style={{ borderColor: accent2 }} /> {cfg.tiers.label}</label>
                )}
                {cfg?.hide && (
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showClosed} onChange={() => setShowClosed((v) => !v)} className="accent-accent" /> Show {cfg.hide.label.toLowerCase()}</label>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-ink-subtle">
                {pts.length.toLocaleString()} sites from CoreNav{points?.truncated ? ' (first part only)' : ''}. Heat, demand shading, drive times and road layers are on <a href={CORENAV_MAP_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">CoreNav's own map</a>.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Top-right: reload, open in CoreNav. */}
      <div className="absolute right-3 top-3 z-[500] flex gap-2">
        {phase === 'ready' && (
          <button type="button" onClick={() => reload()} title="Reload from CoreNav"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-medium text-ink shadow-sm hover:border-accent/50">
            <RotateCw className="size-3.5" /><span className="hidden sm:inline">Reload</span>
          </button>
        )}
        <a href={CORENAV_MAP_URL} target="_blank" rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-medium text-ink shadow-sm hover:border-accent/50">
          <ExternalLink className="size-3.5" /><span className="hidden sm:inline">Open in CoreNav</span>
        </a>
      </div>

      {/* States over the map. */}
      {phase !== 'ready' && (
        <div className={cn('absolute inset-x-0 top-0 z-[600] flex items-center justify-center bg-content/70 p-4 backdrop-blur-[2px]', BOTTOM_NAV)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-center shadow-xl">
            {phase === 'loading' && (
              <>
                <Loader2 className="mx-auto size-7 animate-spin text-accent" />
                <p className="mt-3 text-sm font-medium text-ink">Loading CoreNav's sites…</p>
                <p className="mt-1 text-xs text-ink-muted">Over 14,000 washes. The first load takes a few seconds.</p>
              </>
            )}
            {(phase === 'not_connected' || phase === 'reconnect') && (
              <>
                <Link2 className="mx-auto size-7 text-accent" />
                <p className="mt-3 text-sm font-semibold text-ink">{phase === 'reconnect' ? 'Your CoreNav sign-in expired' : 'Connect CoreNav to see its map here'}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">Sign in once with your mighty-wash.com Google account. Operator then reads CoreNav with your own login, here and in Operator AI.</p>
                <button type="button" onClick={() => void connect()} disabled={connecting}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {connecting ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                  {phase === 'reconnect' ? 'Reconnect CoreNav' : 'Connect to CoreNav'}
                </button>
                {message && <p className="mt-3 text-xs text-danger">{message}</p>}
              </>
            )}
            {phase === 'error' && (
              <>
                <p className="text-sm font-semibold text-ink">CoreNav's map didn't load</p>
                <p className="mt-1 text-xs text-ink-muted">{message}</p>
                <button type="button" onClick={() => reload()} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink hover:border-accent/50">
                  <RotateCw className="size-4" /> Try again
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* The picked site's CoreNav sidebar. */}
      {selected && head && (
        <div className={cn('absolute z-[550] overflow-hidden border border-border shadow-2xl',
          'inset-x-0 h-[62%] rounded-t-2xl', BOTTOM_NAV.replace('lg:bottom-0', ''),
          'lg:inset-x-auto lg:bottom-3 lg:right-3 lg:top-14 lg:h-auto lg:w-[380px] lg:rounded-2xl')}>
          <SitePanel key={selected.id} head={head} tabs={siteTabs} loading={siteLoading} error={siteError}
            labels={setup?.labels ?? {}} openUrl={CORENAV_MAP_URL} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}
