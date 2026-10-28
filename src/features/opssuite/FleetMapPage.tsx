import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Loader2, RefreshCw, Search, X, List, Tag } from 'lucide-react'
import { fleet, type FleetLive, type FleetVehicle } from '@/lib/queries/fleet'
import { useLocations } from '@/lib/locations'

// Fleet Map: live positions of Mighty Wash vehicles from Verizon Connect Reveal
// (reveal-fleet edge function). Pre-launch: kevan@washlyfe.com only.
//
// Reveal plots a moving vehicle about every 30 seconds (sometimes up to 90), so
// the page polls every 15 seconds while anything is moving (30 otherwise) and
// glides each marker from where it is to its new plot over the time between
// the two plots. Movement stays continuous without guessing ahead: the
// reported speed is a single instant reading and swings 0 to 50+ in town.

const REFRESH_MS = 30_000
const MOVING_REFRESH_MS = 15_000
const GLIDE_MIN_MS = 5_000
const GLIDE_MAX_MS = 45_000
// A jump this far (bad plot, long gap) snaps instead of sliding across the map.
const SNAP_METERS = 30_000
// A vehicle whose last GPS update is older than this is drawn faded. Parked
// vehicles stop reporting, so this means "hasn't moved in a while", not offline.
const OLD_MS = 7 * 24 * 3600_000

type Kind = 'moving' | 'idle' | 'stopped'
const KIND: Record<Kind, { label: string; color: string }> = {
  moving: { label: 'Moving', color: '#16a34a' },
  idle: { label: 'Idle', color: '#d97706' },
  stopped: { label: 'Stopped', color: '#475569' },
}
const KIND_ORDER: Kind[] = ['moving', 'idle', 'stopped']

function kindOf(v: FleetVehicle): Kind {
  if (v.status === 'Moving') return 'moving'
  if (v.status === 'Idle') return 'idle'
  return 'stopped'
}
const ageMs = (v: FleetVehicle) => (v.updated_at ? Date.now() - Date.parse(v.updated_at) : Infinity)

// "just now" / "5 min ago" / "3 hr ago" / "4 days ago".
function ago(iso: string | null): string {
  if (!iso) return 'unknown'
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hr ago`
  return `${Math.round(h / 24)} days ago`
}
function agoShort(iso: string | null): string {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// Round badge in the status color; moving vehicles get an arrow pointing the
// way they're headed (Reveal's Direction is degrees from north).
function vehicleIcon(v: FleetVehicle): L.DivIcon {
  const k = kindOf(v)
  const faded = ageMs(v) > OLD_MS
  const inner =
    k === 'moving' && v.direction != null
      ? `<svg width="16" height="16" viewBox="0 0 24 24" style="transform:rotate(${v.direction}deg)"><path d="M12 2l7 19-7-4-7 4z" fill="#fff"/></svg>`
      : '<div style="width:9px;height:9px;border-radius:50%;background:#fff"></div>'
  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
    tooltipAnchor: [0, 14],
    html:
      `<div style="width:30px;height:30px;border-radius:50%;background:${KIND[k].color};border:2px solid #fff;` +
      `box-shadow:0 1px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:${faded ? 0.55 : 1}">${inner}</div>`,
  })
}

function popupHtml(v: FleetVehicle): string {
  const k = kindOf(v)
  const moving = k === 'moving' && v.speed_mph != null
  const line = (text: string, color = '#334155') => `<div style="font-size:13px;color:${color};margin-top:2px">${text}</div>`
  return (
    '<div style="min-width:210px">' +
    `<div style="font-size:15px;font-weight:700">${escapeHtml(v.name)}</div>` +
    (v.vehicle ? line(escapeHtml(v.vehicle), '#64748b') : '') +
    `<div style="font-size:13px;margin-top:6px"><span style="color:${KIND[k].color};font-weight:700">${KIND[k].label}</span>` +
    (moving ? ` &middot; ${v.speed_mph} mph${v.heading ? ` ${escapeHtml(v.heading)}` : ''}` : '') +
    '</div>' +
    (v.driver ? line(`Driver: ${escapeHtml(v.driver)}`) : '') +
    (v.address ? line(escapeHtml(v.address)) : '') +
    (v.geofence ? line(`Geofence: ${escapeHtml(v.geofence)}`) : '') +
    line(`Updated ${ago(v.updated_at)}`, '#64748b') +
    `<a href="https://www.google.com/maps?q=${v.lat},${v.lng}" target="_blank" rel="noopener" style="font-size:12px;display:inline-block;margin-top:6px">Open in Google Maps</a>` +
    '</div>'
  )
}

const siteIcon = L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -16],
  html:
    '<div style="width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid #2563eb;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;overflow:hidden">' +
    '<img src="/mw-logo.png" alt="" style="width:24px;height:24px;object-fit:contain"/></div>',
})

const MISSING_REASON: Record<string, string> = {
  no_vehicle_number: 'No vehicle number in Reveal',
  no_data: 'No GPS data yet',
  private: 'Marked private in Reveal',
}

export default function FleetMapPage() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const vehiclesRef = useRef<L.LayerGroup | null>(null)
  const sitesRef = useRef<L.LayerGroup | null>(null)
  const markersRef = useRef(new Map<string, L.Marker>())
  const fittedRef = useRef(false)
  // Plot time each marker is showing or gliding to, the glides in progress, and
  // the animation frame driving them.
  const plotRef = useRef(new Map<string, string | null>())
  const glidesRef = useRef(new Map<string, { m: L.Marker; from: L.LatLng; to: L.LatLng; start: number; dur: number }>())
  const rafRef = useRef<number | null>(null)
  const anyMovingRef = useRef(false)

  const { locations } = useLocations()
  const [data, setData] = useState<FleetLive | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Kind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [showNames, setShowNames] = useState(true)
  const [listOpen, setListOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024)
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const live = await fleet.live()
      anyMovingRef.current = live.vehicles.some((v) => v.status === 'Moving')
      setData(live)
      setError(null)
    } catch (e) {
      // invoke() puts the HTTP status on the error's context Response.
      const status = (e as { context?: { status?: number } })?.context?.status
      setError(
        status === 401
          ? 'Your sign-in has expired. Sign out and back in to load vehicles.'
          : status === 403
            ? 'Your account does not have access to the fleet map.'
            : 'Could not reach Verizon Connect. It will try again shortly.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll while the tab is visible (faster while anything is moving); refresh
  // right away on coming back.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const tick = async () => {
      if (!document.hidden) await load()
      if (!stopped) timer = setTimeout(tick, anyMovingRef.current ? MOVING_REFRESH_MS : REFRESH_MS)
    }
    void tick()
    const onVis = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  // Step every in-progress glide; runs only while something is gliding.
  const startGlides = useCallback(() => {
    if (rafRef.current != null) return
    const frame = () => {
      const now = performance.now()
      for (const [num, g] of glidesRef.current) {
        const t = Math.min(1, (now - g.start) / g.dur)
        g.m.setLatLng([g.from.lat + (g.to.lat - g.from.lat) * t, g.from.lng + (g.to.lng - g.from.lng) * t])
        if (t >= 1) glidesRef.current.delete(num)
      }
      rafRef.current = glidesRef.current.size ? requestAnimationFrame(frame) : null
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [])

  // Keep the "x min ago" labels current between refreshes.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  // Init the map once.
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return
    const map = L.map(wrapRef.current, { center: [33.0, -102.5], zoom: 7, zoomControl: true, tap: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    map.zoomControl.setPosition('bottomright')
    sitesRef.current = L.layerGroup().addTo(map)
    vehiclesRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    const markers = markersRef.current
    const plots = plotRef.current
    const glides = glidesRef.current
    setTimeout(() => map.invalidateSize(), 200)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      glides.clear()
      plots.clear()
      map.remove()
      mapRef.current = null
      markers.clear()
    }
  }, [])

  // Mighty Wash sites, for context.
  useEffect(() => {
    const layer = sitesRef.current
    if (!layer) return
    layer.clearLayers()
    for (const s of locations) {
      if (s.latitude == null || s.longitude == null) continue
      L.marker([s.latitude, s.longitude], { icon: siteIcon, title: s.name, zIndexOffset: -500 })
        .bindPopup(`<div style="font-size:15px;font-weight:700">${escapeHtml(s.name)}</div>`)
        .addTo(layer)
    }
  }, [locations])

  const vehicles = useMemo(() => data?.vehicles ?? [], [data])
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { moving: 0, idle: 0, stopped: 0 }
    for (const v of vehicles) c[kindOf(v)]++
    return c
  }, [vehicles])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vehicles
      .filter((v) => filter === 'all' || kindOf(v) === filter)
      .filter((v) => !q || [v.name, v.driver, v.vehicle, v.city, v.address].some((s) => s?.toLowerCase().includes(q)))
      .sort(
        (a, b) =>
          KIND_ORDER.indexOf(kindOf(a)) - KIND_ORDER.indexOf(kindOf(b)) ||
          ageMs(a) - ageMs(b) ||
          a.name.localeCompare(b.name),
      )
  }, [vehicles, filter, query])

  // Sync markers with the shown vehicles: move existing ones in place so an
  // open popup stays open across refreshes. A new plot starts a glide from
  // wherever the marker is now (mid-glide included) to the new position.
  useEffect(() => {
    const layer = vehiclesRef.current
    const map = mapRef.current
    if (!layer || !map) return
    const markers = markersRef.current
    const plots = plotRef.current
    const glides = glidesRef.current
    const keep = new Set<string>()
    for (const v of shown) {
      keep.add(v.number)
      let m = markers.get(v.number)
      if (!m) {
        m = L.marker([v.lat, v.lng], { icon: vehicleIcon(v), title: v.name, zIndexOffset: kindOf(v) === 'moving' ? 1000 : 0 })
        m.bindPopup(popupHtml(v))
        markers.set(v.number, m)
        plots.set(v.number, v.updated_at)
        m.addTo(layer)
      } else {
        const prevPlot = plots.get(v.number)
        if (prevPlot !== v.updated_at) {
          plots.set(v.number, v.updated_at)
          const from = m.getLatLng()
          const to = L.latLng(v.lat, v.lng)
          if (from.equals(to) || from.distanceTo(to) > SNAP_METERS) {
            glides.delete(v.number)
            m.setLatLng(to)
          } else {
            const gap = prevPlot && v.updated_at ? Date.parse(v.updated_at) - Date.parse(prevPlot) : REFRESH_MS
            const dur = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, Number.isFinite(gap) ? gap : REFRESH_MS))
            glides.set(v.number, { m, from, to, start: performance.now(), dur })
            startGlides()
          }
        }
        m.setIcon(vehicleIcon(v))
        m.setZIndexOffset(kindOf(v) === 'moving' ? 1000 : 0)
        m.setPopupContent(popupHtml(v))
        if (!layer.hasLayer(m)) m.addTo(layer)
      }
      m.unbindTooltip()
      if (showNames) m.bindTooltip(escapeHtml(v.name), { permanent: true, direction: 'bottom', className: 'text-xs' })
    }
    for (const [num, m] of markers) {
      if (!keep.has(num)) layer.removeLayer(m)
    }
    // Frame the whole fleet once, on the first load.
    if (!fittedRef.current && vehicles.length) {
      fittedRef.current = true
      map.fitBounds(L.latLngBounds(vehicles.map((v) => [v.lat, v.lng] as [number, number])), { padding: [60, 60], maxZoom: 13 })
    }
  }, [shown, vehicles, showNames, startGlides])

  const focus = (v: FleetVehicle) => {
    const map = mapRef.current
    const m = markersRef.current.get(v.number)
    if (!map || !m) return
    map.flyTo([v.lat, v.lng], Math.max(map.getZoom(), 15), { duration: 0.6 })
    setTimeout(() => m.openPopup(), 650)
    if (window.innerWidth < 1024) setListOpen(false)
  }

  const chip = (key: Kind | 'all', label: string, n: number, color?: string) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
        filter === key ? 'bg-accent text-white' : 'bg-content text-ink hover:bg-accent-soft'
      }`}
    >
      {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
      {label} <span className={filter === key ? 'text-white/80' : 'text-ink-subtle'}>{n}</span>
    </button>
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-content">
      <div ref={wrapRef} className="absolute inset-x-0 top-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-0 lg:bottom-0" />

      {/* Map controls, top-right. */}
      <div className="absolute right-3 top-3 z-[500] flex gap-2">
        <button
          onClick={() => setShowNames((s) => !s)}
          className={`flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold shadow-lg ring-1 ring-border ${
            showNames ? 'bg-accent text-white' : 'bg-card text-ink hover:bg-content'
          }`}
          title="Show names on the map"
        >
          <Tag className="h-4 w-4" /> Names
        </button>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-card px-3 text-sm font-semibold text-ink shadow-lg ring-1 ring-border hover:bg-content disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {!listOpen && (
        <button
          onClick={() => setListOpen(true)}
          className="absolute left-3 top-3 z-[500] flex h-10 items-center gap-1.5 rounded-xl bg-card px-3 text-sm font-semibold text-ink shadow-lg ring-1 ring-border hover:bg-content"
        >
          <List className="h-4 w-4" /> Vehicles {vehicles.length ? `(${vehicles.length})` : ''}
        </button>
      )}

      {listOpen && (
        <div className="absolute left-3 right-3 top-3 z-[500] flex max-h-[60%] flex-col rounded-2xl bg-card shadow-2xl ring-1 ring-border lg:bottom-3 lg:right-auto lg:max-h-none lg:w-[23rem]">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 pb-3 pt-3">
            <div>
              <h1 className="text-lg font-bold text-ink">Fleet Map</h1>
              <p className="text-xs text-ink-subtle">
                Verizon Connect Reveal{data ? ` · updated ${ago(data.fetched_at)}` : ''}
              </p>
            </div>
            <button
              onClick={() => setListOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-subtle hover:bg-content"
              aria-label="Hide vehicle list"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-2 border-b border-border px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              {chip('all', 'All', vehicles.length)}
              {KIND_ORDER.map((k) => chip(k, KIND[k].label, counts[k], KIND[k].color))}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-content px-3">
              <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, driver, city"
                className="h-9 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search" className="text-ink-subtle">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {error && <div className="mx-4 mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!data && loading && (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-subtle">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading vehicles...
              </div>
            )}
            {data && shown.length === 0 && <div className="px-4 py-6 text-sm text-ink-subtle">No vehicles match.</div>}
            <ul className="divide-y divide-border">
              {shown.map((v) => {
                const k = kindOf(v)
                return (
                  <li key={v.number}>
                    <button onClick={() => focus(v)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-content">
                      <span
                        className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                        style={{ background: KIND[k].color, opacity: ageMs(v) > OLD_MS ? 0.55 : 1 }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{v.name}</span>
                        <span className="block truncate text-xs text-ink-subtle">
                          {KIND[k].label}
                          {k === 'moving' && v.speed_mph != null ? ` ${v.speed_mph} mph` : ''}
                          {v.city ? ` · ${v.city}` : ''}
                          {v.driver && !v.name.toLowerCase().includes(v.driver.split(' ')[0].toLowerCase()) ? ` · ${v.driver}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 pt-0.5 text-xs text-ink-subtle">{agoShort(v.updated_at)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {data && data.missing.length > 0 && (
              <div className="border-t border-border px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Not on the map ({data.missing.length})
                </div>
                <ul className="mt-1.5 space-y-1">
                  {data.missing.map((m, i) => (
                    <li key={`${m.name}-${i}`} className="text-sm text-ink">
                      {m.name || 'Unnamed vehicle'}{' '}
                      <span className="text-xs text-ink-subtle">· {MISSING_REASON[m.reason] ?? m.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
