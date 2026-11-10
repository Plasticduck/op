import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ExternalLink, Layers, Link2, Loader2, RotateCw, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { connections } from '@/lib/queries/connections'
import {
  CoreNavMapError, corenavMap, groupFor,
  type CnArea, type CnBox, type CnHeat, type CnLayerRows, type CnLens, type CnOverlay, type CnPoints, type CnSetup, type CnShape, type CnTab,
} from '@/lib/queries/corenavMap'
import { SitePanel, type Competitors, type PanelHead } from './corenav/SitePanel'
import { HeatLayer, type HeatPoint } from './corenav/heat'
import { RAMP, bbox, classOf, fmtLayer, inside, miles, quintiles, scaled, type GeoPolygon } from './corenav/geo'
import { ROAD_CLASSES, asPolygon, controlStyle, esc, lineLatLngs, parseGeom, permitPopup, polygonLatLngs, roadStyle } from './corenav/draw'
import { labelFor, showValue } from './corenav/format'

// Operations - Admin > CoreNav Map, on Operator's own map (Leaflet + OpenStreetMap,
// like Market Explorer). Everything comes through the person's own CoreNav
// connection (Operator AI > Connections) and is drawn the way CoreNav's own map
// is set up (its map_config): washes coloured by format, Mighty Wash sites marked,
// target tiers ringed, heat layers, demand shading, drive times around the picked
// site (and the washes inside them), roads and places, and CoreNav's lenses.
// Tapping a site opens CoreNav's sidebar for it.

const CORENAV_MAP_URL = 'https://expand.corenav.ai/map'
const BOTTOM_NAV = 'bottom-[calc(3.25rem+env(safe-area-inset-bottom))] lg:bottom-0'
// Demand shading loads once the map shows a metro area or less (square degrees on
// screen), so a pan never asks CoreNav for a whole state of block groups.
const SHAPE_MAX_AREA = 12
const PAD = 0.3 // fetch a bit past the screen edge, so small pans don't refetch

// Survives leaving the page and coming back (14,000+ sites is a big download).
const cache = new Map<string, { setup: CnSetup; points: CnPoints }>()
const areaCache = new Map<string, CnArea[]>()
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

type ShapeFeat = { g: GeoPolygon; bb: [number, number, number, number]; value: number | null; latlngs: L.LatLng[][] | L.LatLng[][][]; row: unknown[] }
type LayerEntry = { box: CnBox | null; data: CnLayerRows } // box null = the whole layer
type Hover = { title: string; value: string; extra: { label: string; value: string }[] }

const mwIcon = L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  html:
    '<div style="width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid #2563eb;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;overflow:hidden">' +
    '<img src="/mw-logo.png" alt="" style="width:24px;height:24px;object-fit:contain"/></div>',
})

const boxOf = (b: L.LatLngBounds): CnBox => ({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() })
const covers = (outer: CnBox | null, inner: CnBox) => !outer || (outer.w <= inner.w && outer.e >= inner.e && outer.s <= inner.s && outer.n >= inner.n)
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const hasBox = (sql: string) => /\{[wsen]\}/.test(sql)
const tableOf = (sql: string) => /\bfrom\s+"?([a-z0-9_]+)"?/i.exec(sql)?.[1] ?? ''

export default function CoreNavMapPage() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const pickRef = useRef<L.CircleMarker | null>(null)
  const rendererRef = useRef<L.Canvas | null>(null) // washes and everything you can tap
  const shapeRendererRef = useRef<L.Canvas | null>(null)
  const driveRendererRef = useRef<L.Canvas | null>(null)
  const shapeGroupRef = useRef<L.LayerGroup | null>(null)
  const driveGroupRef = useRef<L.LayerGroup | null>(null)
  const overlayGroupRef = useRef<L.LayerGroup | null>(null)
  const heatRef = useRef<HeatLayer | null>(null)
  const siteReq = useRef(0)
  const viewSetFor = useRef<string | null>(null)
  const inflight = useRef(new Map<string, CnBox | null>())
  const seq = useRef(new Map<string, number>())

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
  // CoreNav's other layers.
  const [heatId, setHeatId] = useState<string | null>(null)
  const [shapeId, setShapeId] = useState<string | null>(null)
  const [overlaysOn, setOverlaysOn] = useState<Set<string>>(new Set())
  const [showDrive, setShowDrive] = useState(true)
  const [lens, setLens] = useState<string | null>(null)
  const [view, setView] = useState({ zoom: 6, area: Infinity, tick: 0 })
  const [layerData, setLayerData] = useState<Record<string, LayerEntry>>({})
  const [layerErr, setLayerErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [areas, setAreas] = useState<{ id: string; list: CnArea[] | null; error: string | null } | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)

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
    if (universe) {
      // Another universe has its own layers.
      viewSetFor.current = null
      setHeatId(null)
      setShapeId(null)
      setOverlaysOn(new Set())
      setLens(null)
    } else {
      setLayerData({})
      setLayerErr({})
      areaCache.clear()
    }
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

  const config = setup?.config
  const cfg = config?.points
  const accent = config?.accent ?? '#24a9e0'
  const accent2 = config?.accent2 ?? '#d32a2a'
  const headings = config?.headings ?? {}
  const heatCfgs = useMemo(() => (Array.isArray(config?.heat) ? (config.heat as CnHeat[]) : []), [config])
  const shapeCfgs = useMemo(() => (Array.isArray(config?.shapes) ? (config.shapes as CnShape[]) : []), [config])
  const overlayCfgs = useMemo(() => (Array.isArray(config?.overlays) ? (config.overlays as CnOverlay[]) : []), [config])
  const lenses = useMemo(() => (Array.isArray(config?.lenses) ? (config.lenses as CnLens[]) : []), [config])
  const areaCfg = config?.areas as { drive?: number[]; rings?: boolean; compete?: number } | undefined
  const shape = shapeCfgs.find((s) => s.id === shapeId) ?? null
  const quiet = !!lenses.find((l) => l.id === lens)?.quiet
  const soft = !!heatId && heatCfgs.some((h) => h.id === heatId) // lighter washes, so the heat shows through
  const shapeGated = view.area > SHAPE_MAX_AREA
  const overlayGated = useCallback((o: CnOverlay) => o.min_zoom != null && view.zoom < o.min_zoom, [view.zoom])

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

  // One site's CoreNav sidebar (again on Try again).
  const loadSite = useCallback((p: Pt) => {
    setSiteTabs(null)
    setSiteError(null)
    setSiteLoading(true)
    const req = ++siteReq.current
    if (!setup) return
    corenavMap.site(setup.universe, p.id, p.entity)
      .then((r) => { if (req === siteReq.current) setSiteTabs(r.tabs) })
      .catch((e) => { if (req === siteReq.current) setSiteError(e instanceof Error ? e.message : "Couldn't load that site.") })
      .finally(() => { if (req === siteReq.current) setSiteLoading(false) })
  }, [setup])

  const pick = useCallback((p: Pt) => {
    setSelected(p)
    loadSite(p)
    const map = mapRef.current
    if (map && window.innerWidth < 1024) {
      // On a phone the sheet covers the lower part of the map: keep the site above it.
      map.panTo([p.lat, p.lng], { animate: false })
      map.panBy([0, Math.round(window.innerHeight * 0.27)], { animate: true })
    } else if (map && !map.getBounds().contains([p.lat, p.lng])) {
      map.panTo([p.lat, p.lng])
    }
  }, [loadSite])

  // Try again on the site panel: its sidebar, and its drive times if they failed too.
  const [areaTry, setAreaTry] = useState(0)
  const retrySite = () => {
    if (!selected) return
    loadSite(selected)
    setAreaTry((n) => n + 1)
  }

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
    // Under the washes: demand shading, then heat, then drive times. Only the
    // washes' canvas takes taps, so these never get in the way of a tap.
    for (const [name, z] of [['cnShapes', 350], ['cnHeat', 360], ['cnDrive', 370]] as const) {
      const pane = map.createPane(name)
      pane.style.zIndex = String(z)
      pane.style.pointerEvents = 'none'
    }
    shapeRendererRef.current = L.canvas({ pane: 'cnShapes', padding: 0.3 })
    driveRendererRef.current = L.canvas({ pane: 'cnDrive', padding: 0.3 })
    rendererRef.current = L.canvas({ padding: 0.5 })
    shapeGroupRef.current = L.layerGroup().addTo(map)
    driveGroupRef.current = L.layerGroup().addTo(map)
    overlayGroupRef.current = L.layerGroup().addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    let t: ReturnType<typeof setTimeout> | undefined
    const onMove = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const b = map.getBounds()
        setView((v) => ({ zoom: map.getZoom(), area: (b.getEast() - b.getWest()) * (b.getNorth() - b.getSouth()), tick: v.tick + 1 }))
      }, 250)
    }
    map.on('moveend', onMove)
    setTimeout(() => { map.invalidateSize(); onMove() }, 200)
    return () => { clearTimeout(t); map.remove(); mapRef.current = null }
  }, [])

  // CoreNav's starting view, once per universe.
  useEffect(() => {
    const map = mapRef.current
    const v = setup?.config?.view
    if (!map || !setup || viewSetFor.current === setup.universe) return
    viewSetFor.current = setup.universe
    if (v?.center) map.setView([v.center[1], v.center[0]], Math.round((v.zoom ?? 6) * 4) / 4)
  }, [setup])

  // Draw the washes.
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
      const target = !!p.tier && tierValues.has(p.tier)
      const dim = quiet && !target
      if (showTiers && target) {
        const ring = p.tier === 'C' ? 0.45 : 0.7
        L.circleMarker([p.lat, p.lng], { renderer, radius: p.radius + 4, color: accent2, weight: p.tier === 'A' ? 2 : 1.25, opacity: soft ? ring * 0.5 : ring, fill: false, interactive: false }).addTo(layer)
      }
      L.circleMarker([p.lat, p.lng], {
        renderer,
        radius: dim ? Math.max(2, p.radius * 0.6) : soft ? Math.max(2.5, p.radius * 0.75) : p.radius,
        color: '#ffffff',
        weight: dim ? 0.5 : 1,
        opacity: dim ? 0.3 : soft ? 0.6 : 1,
        fillColor: colorOf(p.group),
        fillOpacity: dim ? 0.2 : soft ? 0.45 : 0.9,
      })
        .on('click', () => pick(p))
        .bindTooltip(`${esc(p.name)}${p.sub ? ` · ${esc(p.sub)}` : ''}`, { direction: 'top', offset: [0, -4] })
        .addTo(layer)
    }
    if (showMw) {
      for (const p of mw) {
        L.marker([p.lat, p.lng], { icon: mwIcon, zIndexOffset: 1000, title: p.name }).on('click', () => pick(p)).addTo(layer)
      }
    }
  }, [pts, hidden, showMw, showTiers, visible, colorOf, tierValues, accent2, pick, quiet, soft])

  // Ring the picked site (on the washes' canvas, so it never covers a tap).
  useEffect(() => {
    const map = mapRef.current
    pickRef.current?.remove()
    pickRef.current = null
    if (!map || !selected || !rendererRef.current) return
    pickRef.current = L.circleMarker([selected.lat, selected.lng], { renderer: rendererRef.current, radius: 16, color: accent, weight: 3, fill: false, interactive: false }).addTo(map)
  }, [selected, accent])

  // Heat: CoreNav's heat layers, worked out from the washes already loaded.
  useEffect(() => {
    const map = mapRef.current
    const h = heatCfgs.find((x) => x.id === heatId)
    if (!map || !h || !points) {
      heatRef.current?.remove()
      heatRef.current = null
      return
    }
    heatRef.current ??= new HeatLayer({ pane: 'cnHeat', radius: 14, blur: 16, opacity: 0.7 })
    if (!map.hasLayer(heatRef.current)) heatRef.current.addTo(map)
    const live = pts.filter((p) => !p.closed)
    let hp: HeatPoint[] = []
    if (h.weights) {
      for (const p of live) { const w = h.weights[p.group] ?? 0; if (w > 0) hp.push([p.lat, p.lng, w]) }
    } else if (h.column) {
      const i = points.columns.indexOf(h.column)
      const mi = h.min ? points.columns.indexOf(h.min.column) : -1
      const use = i < 0 ? [] : live.filter((p) => mi < 0 || (num(p.row[mi]) ?? 0) >= (h.min?.value ?? 0))
      const sc = scaled(use.map((p) => num(p.row[i])))
      hp = use.flatMap((p, k) => { const w = sc[k]; return w != null && w > 0 ? [[p.lat, p.lng, w] as HeatPoint] : [] })
    }
    heatRef.current.setPoints(hp)
  }, [heatId, heatCfgs, pts, points])

  // Fetch demand shading and road/place overlays for what's on screen.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !setup || phase !== 'ready') return
    const universe = setup.universe
    const b = map.getBounds()
    const vb = boxOf(b)
    const jobs: { key: string; kind: 'shape' | 'overlay'; id: string; whole: boolean }[] = []
    if (shape && !shapeGated) jobs.push({ key: `${universe}|shape:${shape.id}`, kind: 'shape', id: shape.id, whole: false })
    for (const o of overlayCfgs) {
      if (overlaysOn.has(o.id) && !overlayGated(o)) jobs.push({ key: `${universe}|overlay:${o.id}`, kind: 'overlay', id: o.id, whole: !hasBox(o.sql) })
    }
    for (const j of jobs) {
      const have = layerData[j.key]
      if (have && (j.whole || covers(have.box, vb))) continue
      if (inflight.current.has(j.key)) {
        const fly = inflight.current.get(j.key) ?? null
        if (j.whole || covers(fly, vb)) continue
      }
      const box = j.whole ? null : boxOf(b.pad(PAD))
      inflight.current.set(j.key, box)
      const req = (seq.current.get(j.key) ?? 0) + 1
      seq.current.set(j.key, req)
      setBusy((s) => new Set(s).add(j.key))
      corenavMap.layer(universe, j.kind, j.id, box ?? undefined)
        .then((data) => {
          if (seq.current.get(j.key) !== req) return
          setLayerData((d) => ({ ...d, [j.key]: { box, data } }))
          setLayerErr((x) => { if (!(j.key in x)) return x; const n = { ...x }; delete n[j.key]; return n })
        })
        .catch((e) => {
          if (seq.current.get(j.key) !== req) return
          setLayerErr((x) => ({ ...x, [j.key]: e instanceof Error ? e.message : "Couldn't load that CoreNav layer." }))
        })
        .finally(() => {
          if (seq.current.get(j.key) !== req) return
          inflight.current.delete(j.key)
          setBusy((s) => { const n = new Set(s); n.delete(j.key); return n })
        })
    }
  }, [view.tick, setup, phase, shape, shapeGated, overlayCfgs, overlaysOn, overlayGated, layerData])

  // Demand shading.
  const shapeEntry = shape && setup ? layerData[`${setup.universe}|shape:${shape.id}`] : undefined
  const shapeFeats = useMemo<ShapeFeat[]>(() => {
    if (!shape || !shapeEntry) return []
    const cols = shapeEntry.data.columns
    const ig = cols.indexOf('geometry'), iv = cols.indexOf(shape.value)
    if (ig < 0) return []
    const out: ShapeFeat[] = []
    for (const r of shapeEntry.data.rows) {
      const g = asPolygon(parseGeom(r[ig]))
      if (!g) continue
      out.push({ g, bb: bbox(g), value: iv >= 0 ? num(r[iv]) : null, latlngs: polygonLatLngs(g), row: r })
    }
    return out
  }, [shape, shapeEntry])
  const isFlag = shape?.format === 'flag'
  const breaks = useMemo(() => (isFlag ? [] : quintiles(shapeFeats.map((f) => f.value).filter((v): v is number => v != null))), [shapeFeats, isFlag])

  useEffect(() => {
    const group = shapeGroupRef.current
    const renderer = shapeRendererRef.current
    if (!group || !renderer) return
    group.clearLayers()
    if (!shape || shapeGated) return
    for (const f of shapeFeats) {
      if (f.value == null || (isFlag && !f.value)) continue
      L.polygon(f.latlngs, {
        renderer, interactive: false, weight: 0.4, color: '#ffffff', opacity: 0.6,
        fillColor: isFlag ? RAMP[3] : RAMP[classOf(f.value, breaks)], fillOpacity: 0.5,
      }).addTo(group)
    }
  }, [shape, shapeGated, shapeFeats, breaks, isFlag])

  // What's under the pointer (or the tap) on the demand shading.
  useEffect(() => {
    const map = mapRef.current
    setHover(null)
    if (!map || !shape || shapeGated || !shapeFeats.length || !shapeEntry) return
    const cols = shapeEntry.data.columns
    const table = tableOf(shape.sql)
    const skip = new Set(['geometry', 'geoid', shape.value])
    const extraCols = cols.map((c, i) => ({ c, i })).filter(({ c }) => !skip.has(c)).slice(0, 5)
    let last: ShapeFeat | null | undefined
    let frame = 0
    const at = (ll: L.LatLng) => {
      const f = shapeFeats.find((x) => ll.lng >= x.bb[0] && ll.lng <= x.bb[2] && ll.lat >= x.bb[1] && ll.lat <= x.bb[3] && inside(ll.lat, ll.lng, x.g)) ?? null
      if (f === last) return
      last = f
      if (!f) { setHover(null); return }
      setHover({
        title: shape.label,
        value: fmtLayer(shape.format, f.value),
        extra: extraCols
          .filter(({ i }) => f.row[i] != null && f.row[i] !== '')
          .map(({ c, i }) => ({ label: labelFor(setup?.labels ?? {}, table, c), value: showValue(c, f.row[i]).text })),
      })
    }
    const onMove = (e: L.LeafletMouseEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => at(e.latlng))
    }
    const onOut = () => { cancelAnimationFrame(frame); last = undefined; setHover(null) }
    map.on('mousemove', onMove)
    map.on('click', onMove)
    map.on('mouseout', onOut)
    return () => {
      cancelAnimationFrame(frame)
      map.off('mousemove', onMove)
      map.off('click', onMove)
      map.off('mouseout', onOut)
    }
  }, [shape, shapeGated, shapeFeats, shapeEntry, setup])

  // Roads and places.
  useEffect(() => {
    const group = overlayGroupRef.current
    const renderer = rendererRef.current
    if (!group || !renderer || !setup) return
    group.clearLayers()
    const stack: L.Path[][] = [] // bottom to top
    for (const o of overlayCfgs) {
      if (!overlaysOn.has(o.id) || overlayGated(o)) continue
      const entry = layerData[`${setup.universe}|overlay:${o.id}`]
      if (!entry) continue
      const cols = entry.data.columns
      const col = (r: unknown[], name: string) => { const i = cols.indexOf(name); return i >= 0 ? r[i] : null }
      const iLat = cols.indexOf('lat'), iLng = cols.includes('lng') ? cols.indexOf('lng') : cols.indexOf('lon')
      const made: L.Path[] = []
      for (const r of entry.data.rows) {
        if (o.kind === 'line') {
          const ll = lineLatLngs(parseGeom(col(r, 'geometry')))
          if (!ll) continue
          const v = num(col(r, o.value ?? 'aadt'))
          const yr = col(r, 'aadt_year'), mph = num(col(r, 'speed_limit')), lanes = num(col(r, 'through_lanes'))
          const tip = [
            v != null ? `${Math.round(v).toLocaleString()} vehicles a day${yr ? ` (${esc(yr)})` : ''}` : 'Traffic count not on file',
            mph ? `${mph} mph` : null,
            lanes ? `${lanes} lane${lanes === 1 ? '' : 's'}` : null,
          ].filter(Boolean).join(' · ')
          made.push(L.polyline(ll, { renderer, ...roadStyle(v), opacity: 0.85, lineCap: 'round' }).bindTooltip(tip, { sticky: true }))
          continue
        }
        const lat = num(r[iLat]), lng = num(r[iLng])
        if (lat == null || lng == null) continue
        if (o.kind === 'signs') {
          const kind = String(col(r, 'kind') ?? '')
          const s = controlStyle(kind)
          const mph = num(col(r, 'mph'))
          made.push(L.circleMarker([lat, lng], { renderer, radius: s.radius, color: '#111827', weight: 1, fillColor: s.fill, fillOpacity: 1 })
            .bindTooltip(kind === 'speed' && mph ? `Speed limit ${mph} mph` : s.label, { direction: 'top' }))
        } else if (o.kind === 'markers') {
          const title = String(col(r, o.title ?? 'description') ?? 'New-build permit')
          made.push(L.circleMarker([lat, lng], { renderer, radius: 5.5, color: '#ffffff', weight: 1.5, fillColor: '#7c3aed', fillOpacity: 0.95 })
            .bindTooltip(esc(title.length > 70 ? `${title.slice(0, 70)}…` : title), { direction: 'top' })
            .bindPopup(permitPopup((c) => col(r, c), o.title ?? 'description')))
        } else {
          const g = String(col(r, o.color_by ?? 'group') ?? '')
          const name = String(col(r, o.title ?? 'name') ?? '')
          const brand = col(r, 'brand'), cat = col(r, 'category')
          const tip = [name || (brand ? String(brand) : 'Place'), brand && brand !== name ? `(${String(brand)})` : null, cat ? `· ${String(cat).replace(/_/g, ' ')}` : null].filter(Boolean).join(' ')
          made.push(L.circleMarker([lat, lng], { renderer, radius: 3.5, color: '#ffffff', weight: 1, fillColor: o.colors?.[g] ?? '#9ca3af', fillOpacity: 0.95 })
            .bindTooltip(esc(tip), { direction: 'top' }))
        }
      }
      for (const m of made) m.addTo(group)
      stack.push(made)
    }
    // Keep them all under the washes: send the top layer back first, the bottom one last.
    for (let k = stack.length - 1; k >= 0; k--) for (let m = stack[k].length - 1; m >= 0; m--) stack[k][m].bringToBack()
  }, [setup, overlayCfgs, overlaysOn, overlayGated, layerData])

  // Drive times around the picked site.
  useEffect(() => {
    if (!selected || !setup || !areaCfg) return
    const key = `${setup.universe}|${selected.id}`
    const hit = areaCache.get(key)
    if (hit) { setAreas({ id: selected.id, list: hit, error: null }); return }
    setAreas({ id: selected.id, list: null, error: null })
    let live = true
    corenavMap.areas(setup.universe, selected.id)
      .then((r) => { areaCache.set(key, r.areas); if (live) setAreas({ id: selected.id, list: r.areas, error: null }) })
      .catch((e) => { if (live) setAreas({ id: selected.id, list: null, error: e instanceof Error ? e.message : "Couldn't load that site's drive times." }) })
    return () => { live = false }
  }, [selected, setup, areaCfg, areaTry])

  const siteAreas = selected && areas?.id === selected.id ? areas.list : null

  useEffect(() => {
    const group = driveGroupRef.current
    const renderer = driveRendererRef.current
    if (!group || !renderer) return
    group.clearLayers()
    if (!showDrive || !siteAreas) return
    const drive = siteAreas.filter((a) => a.kind === 'drive_time').sort((a, b) => Number(b.minutes) - Number(a.minutes))
    drive.forEach((a, k) => {
      const g = asPolygon(parseGeom(a.geometry))
      if (!g) return
      L.polygon(polygonLatLngs(g), { renderer, interactive: false, color: accent, weight: 1.5, opacity: 0.85, fillColor: accent, fillOpacity: 0.08 + 0.05 * k }).addTo(group)
    })
    if (areaCfg?.rings !== false) {
      for (const a of siteAreas.filter((x) => x.kind === 'radius_ring')) {
        const g = asPolygon(parseGeom(a.geometry))
        if (g) L.polygon(polygonLatLngs(g), { renderer, interactive: false, color: '#334155', weight: 1.25, opacity: 0.8, dashArray: '5 5', fill: false }).addTo(group)
      }
    }
  }, [showDrive, siteAreas, accent, areaCfg])

  // Washes inside the picked site's drive area (CoreNav's "competitors" view).
  const pickById = useCallback((id: string) => {
    const p = pts.find((x) => x.id === id)
    if (p) pick(p)
  }, [pts, pick])

  const competitors = useMemo<Competitors | null>(() => {
    const minutes = areaCfg?.compete
    if (!selected || !minutes || !cfg) return null
    const base = { minutes, onPick: pickById }
    if (!areas || areas.id !== selected.id || (!areas.list && !areas.error)) return { ...base, loading: true, error: null, rows: [] }
    if (areas.error || !areas.list) return { ...base, loading: false, error: areas.error ?? "Couldn't load that site's drive times.", rows: [] }
    const a = areas.list.find((x) => x.kind === 'drive_time' && Number(x.minutes) === minutes)
    const g = a ? asPolygon(parseGeom(a.geometry)) : null
    if (!g) return { ...base, loading: false, error: `CoreNav has no ${minutes}-minute drive area for this site.`, rows: [] }
    const [w, s, e, n] = bbox(g)
    const words = cfg.color?.words ?? {}
    const iRating = cfg.rating && points ? points.columns.indexOf(cfg.rating.column) : -1
    const rows = pts
      .filter((p) => p.id !== selected.id && !p.closed && p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n && inside(p.lat, p.lng, g))
      .map((p) => {
        const r = iRating >= 0 ? num(p.row[iRating]) : null
        return {
          id: p.id,
          name: p.name,
          sub: p.sub,
          format: words[p.format] ?? p.format.replace(/_/g, ' '),
          rating: r != null && r > 0 ? r : null,
          tier: p.tier && tierValues.has(p.tier) ? p.tier : null,
          mi: miles(selected.lat, selected.lng, p.lat, p.lng),
          mw: p.mw,
        }
      })
      .sort((x, y) => x.mi - y.mi)
    return { ...base, loading: false, error: null, rows }
  }, [selected, areaCfg, cfg, areas, pts, points, tierValues, pickById])

  const zoomToMatches = () => {
    const map = mapRef.current
    if (!map || !needle) return
    const hits = pts.filter((p) => visible(p)).slice(0, 500)
    if (!hits.length) return
    if (hits.length === 1) { map.setView([hits[0].lat, hits[0].lng], 14); pick(hits[0]); return }
    map.fitBounds(L.latLngBounds(hits.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 14 })
  }

  const applyLens = (l: CnLens) => {
    if (lens === l.id) {
      setLens(null)
      setHeatId(null)
      setShapeId(null)
      setOverlaysOn(new Set())
      return
    }
    setLens(l.id)
    setHeatId(l.heat ?? null)
    setShapeId(l.shape ?? null)
    setOverlaysOn(new Set(l.overlays ?? []))
    if (l.rings) setShowTiers(true)
  }

  const toggleOverlay = (id: string) => setOverlaysOn((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

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
    const fmt = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)).toLocaleString())
    const stats = [
      { label: 'Est. cars / yr', value: fmt(col('cars_mid')) },
      { label: 'Reviews, 12 mo', value: fmt(col('velocity_12m')) },
      { label: 'Road traffic', value: fmt(col('aadt_latest')) },
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
  const uni = setup?.universe ?? ''
  const shapeKey = shape ? `${uni}|shape:${shape.id}` : ''
  const shapeTruncated = !!shapeEntry?.data.truncated
  const heat = heatCfgs.find((h) => h.id === heatId)
  const loadingLayers = busy.size > 0
  const sectionTitle = 'text-[10.5px] font-semibold uppercase tracking-wide text-ink-subtle'

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
            <div data-testid="cn-layers" className="-mx-2.5 mt-2.5 max-h-[calc(100dvh-14.5rem)] space-y-2 overflow-y-auto border-t border-border px-2.5 pt-2.5 text-[12.5px] lg:max-h-[calc(100dvh-10rem)]">
              {universes.length > 1 && (
                <select value={uni} onChange={(e) => reload(e.target.value)} aria-label="CoreNav universe"
                  className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[12.5px] leading-tight text-ink">
                  {universes.map((u) => <option key={u.universe} value={u.universe}>{u.label}</option>)}
                </select>
              )}

              {lenses.length > 0 && (
                <div className="space-y-1.5">
                  <div className={sectionTitle}>Views</div>
                  <div className="flex flex-wrap gap-1.5">
                    {lenses.map((l) => (
                      <button key={l.id} type="button" onClick={() => applyLens(l)} aria-pressed={lens === l.id}
                        className={cn('rounded-full border px-2.5 py-1 text-[12px] font-medium',
                          lens === l.id ? 'border-accent bg-accent text-white' : 'border-border text-ink hover:border-accent/50')}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={cn(sectionTitle, lenses.length > 0 && 'border-t border-border pt-2')}>{headings.points ?? 'Washes'}</div>
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
                {quiet && <p className="text-[11px] text-ink-subtle">Other washes are faded so the targets stand out.</p>}
              </div>

              {heatCfgs.length > 0 && (
                <div className="space-y-1.5 border-t border-border pt-2">
                  <div className={sectionTitle}>{headings.heat ?? 'Heat'}</div>
                  <select value={heatId ?? ''} onChange={(e) => setHeatId(e.target.value || null)} aria-label="Heat layer"
                    className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[12.5px] leading-tight text-ink">
                    <option value="">None</option>
                    {heatCfgs.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
                  </select>
                  {heat && (
                    <div>
                      <div className="h-2 rounded-full" style={{ background: 'linear-gradient(to right, #2563eb, #06b6d4, #84cc16, #f59e0b, #dc2626)' }} />
                      <div className="mt-0.5 flex justify-between text-[10.5px] text-ink-subtle"><span>Less</span><span>More</span></div>
                      {heat.min && <p className="text-[11px] text-ink-subtle">Washes with at least {heat.min.value} {heat.min.column.replace(/_/g, ' ')}.</p>}
                    </div>
                  )}
                </div>
              )}

              {shapeCfgs.length > 0 && (
                <div className="space-y-1.5 border-t border-border pt-2">
                  <div className="flex items-center gap-1.5">
                    <span className={sectionTitle}>{headings.shapes ?? 'Demand'}</span>
                    {busy.has(shapeKey) && <Loader2 className="size-3 animate-spin text-accent" />}
                  </div>
                  <select value={shapeId ?? ''} onChange={(e) => setShapeId(e.target.value || null)} aria-label="Demand shading"
                    className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[12.5px] leading-tight text-ink">
                    <option value="">None</option>
                    {shapeCfgs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  {shape && shapeGated && <p className="text-[11px] text-ink-subtle">Zoom in to a metro area to see this.</p>}
                  {shape && !shapeGated && layerErr[shapeKey] && <p className="text-[11px] text-danger">{layerErr[shapeKey]}</p>}
                  {shape && !shapeGated && shapeFeats.length > 0 && (
                    <div data-testid="cn-demand-legend" className="space-y-0.5">
                      {isFlag ? (
                        <div className="flex items-center gap-2 text-[11.5px] text-ink"><span className="h-2.5 w-4 rounded-sm" style={{ background: RAMP[3], opacity: 0.7 }} /> Yes</div>
                      ) : (
                        RAMP.map((c, k) => {
                          if (k > breaks.length) return null
                          const lo = k > 0 ? breaks[k - 1] : null, hi = k < breaks.length ? breaks[k] : null
                          const text = lo == null ? `up to ${fmtLayer(shape.format, hi)}` : hi == null ? `over ${fmtLayer(shape.format, lo)}` : `${fmtLayer(shape.format, lo)} to ${fmtLayer(shape.format, hi)}`
                          return <div key={c} className="flex items-center gap-2 text-[11.5px] text-ink"><span className="h-2.5 w-4 rounded-sm" style={{ background: c, opacity: 0.75 }} /> {text}</div>
                        })
                      )}
                      <p className="text-[11px] text-ink-subtle">{shapeTruncated ? 'Showing part of this view. Zoom in for all of it. ' : ''}Point at an area to see its numbers.</p>
                    </div>
                  )}
                </div>
              )}

              {areaCfg && (
                <div className="space-y-1.5 border-t border-border pt-2">
                  <div className={sectionTitle}>{headings.areas ?? 'Drive time'}</div>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" checked={showDrive} onChange={() => setShowDrive((v) => !v)} className="accent-accent mt-0.5" />
                    <span className="text-ink">
                      {(areaCfg.drive ?? [5, 10, 15]).join(', ')} minute drive times around the picked site{areaCfg.rings !== false ? ', with 1, 3 and 5 mile rings' : ''}
                    </span>
                  </label>
                  {showDrive && !selected && <p className="text-[11px] text-ink-subtle">Tap a wash to see them.</p>}
                  {showDrive && selected && areas?.id === selected.id && areas.error && <p className="text-[11px] text-danger">{areas.error}</p>}
                </div>
              )}

              {overlayCfgs.length > 0 && (
                <div className="space-y-1.5 border-t border-border pt-2">
                  <div className={sectionTitle}>{headings.overlays ?? 'Roads and places'}</div>
                  {overlayCfgs.map((o) => {
                    const key = `${uni}|overlay:${o.id}`
                    const on = overlaysOn.has(o.id)
                    const entry = layerData[key]
                    return (
                      <div key={o.id}>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={on} onChange={() => toggleOverlay(o.id)} className="accent-accent" />
                          {o.kind === 'markers' && <span className="size-2.5 shrink-0 rounded-full" style={{ background: '#7c3aed' }} />}
                          {o.kind === 'line' && <span className="h-1 w-3.5 shrink-0 rounded-full" style={{ background: '#ef4444' }} />}
                          {o.kind === 'signs' && <span className="size-2.5 shrink-0 rounded-full border border-gray-900" style={{ background: '#f59e0b' }} />}
                          {o.kind === 'points' && <span className="size-2.5 shrink-0 rounded-full" style={{ background: Object.values(o.colors ?? {})[0] ?? '#9ca3af' }} />}
                          <span className="min-w-0 flex-1 truncate text-ink">{o.label}</span>
                          {busy.has(key) && <Loader2 className="size-3 animate-spin text-accent" />}
                          {on && !busy.has(key) && entry && !overlayGated(o) && <span className="tabular text-ink-subtle">{entry.data.rows.length.toLocaleString()}{entry.data.truncated ? '+' : ''}</span>}
                        </label>
                        {on && overlayGated(o) && <p className="ml-6 text-[11px] text-ink-subtle">Zoom in closer to see these.</p>}
                        {on && layerErr[key] && <p className="ml-6 text-[11px] text-danger">{layerErr[key]}</p>}
                        {on && !overlayGated(o) && o.kind === 'line' && (
                          <div className="ml-6 mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] text-ink-subtle">
                            {ROAD_CLASSES.map((c) => <span key={c.label} className="inline-flex items-center gap-1"><span className="inline-block h-1 w-3 rounded-full" style={{ background: c.color }} />{c.label}</span>)}
                            <span>vehicles a day</span>
                          </div>
                        )}
                        {on && !overlayGated(o) && o.kind === 'points' && o.colors && (
                          <div className="ml-6 mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] text-ink-subtle">
                            {Object.entries(o.colors).map(([g, c]) => <span key={g} className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: c }} />{g.replace(/_/g, ' ')}</span>)}
                          </div>
                        )}
                        {on && !overlayGated(o) && o.kind === 'signs' && (
                          <div className="ml-6 mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] text-ink-subtle">
                            {(['signal', 'stop', 'speed'] as const).map((k) => { const s = controlStyle(k); return <span key={k} className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-full border border-gray-900" style={{ background: s.fill }} />{s.label.toLowerCase()}</span> })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-ink-subtle">
                {pts.length.toLocaleString()} sites from CoreNav{points?.truncated ? ' (first part only)' : ''}. <a href={CORENAV_MAP_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">CoreNav's own map</a> has the same data.
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

      {/* Layers loading. */}
      {phase === 'ready' && loadingLayers && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-[500] -translate-x-1/2 lg:top-3">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1 text-[12px] text-ink-muted shadow">
            <Loader2 className="size-3.5 animate-spin text-accent" /> Loading CoreNav layers…
          </div>
        </div>
      )}

      {/* What's under the pointer on the demand shading. */}
      {hover && (
        <div data-testid="cn-hover" className={cn('pointer-events-none absolute left-3 z-[500] max-w-[16rem] rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur',
          'bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:left-[20.75rem]', selected && 'hidden lg:block')}>
          <div className="text-[11px] text-ink-subtle">{hover.title}</div>
          <div className="text-[15px] font-semibold tabular text-ink">{hover.value}</div>
          {hover.extra.length > 0 && (
            <dl className="mt-1 space-y-0.5 text-[11px]">
              {hover.extra.map((x) => <div key={x.label} className="flex justify-between gap-3"><dt className="text-ink-subtle">{x.label}</dt><dd className="tabular text-ink">{x.value}</dd></div>)}
            </dl>
          )}
        </div>
      )}

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
          <SitePanel key={selected.id} head={head} tabs={siteTabs} loading={siteLoading} error={siteError} onRetry={retrySite}
            labels={setup?.labels ?? {}} openUrl={CORENAV_MAP_URL} onClose={() => setSelected(null)} competitors={competitors} />
        </div>
      )}
    </div>
  )
}
