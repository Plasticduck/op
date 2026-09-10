import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Search, X, Loader2, MapPin, Maximize2, Users, Building2, Circle, Car } from 'lucide-react'
import { searchPlaces, censusDemographics } from '@/lib/queries/places'
import { useLocations } from '@/lib/locations'
import { useAuth } from '@/lib/auth'

const MW_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

// Market Explorer — a touchscreen kiosk map for scoping trade areas on a large
// screen. Two capabilities, both on free/no-key public data so there is nothing
// to provision:
//   1. Tap the map for demographics (US Census Bureau ACS 5-year), resolved to
//      the incorporated place, falling back to the county for unincorporated land.
//   2. Search businesses ("car washes", "gas stations", a name, or a city) via
//      OpenStreetMap. Business pins come from Overpass; a city name flies the map.
// Overpass rate-limits hard, so the fetch rotates through mirrors with failover
// and remembers the one that answered (this is the "search service is busy" fix).

const START = { center: [31.85, -102.4] as [number, number], zoom: 9 } // West Texas
const ACS = '2023' // ACS 5-year vintage; stable and widely available

// Census ACS variables we surface, in display order.
const CENSUS_VARS = [
  { code: 'B01003_001E', label: 'Population', fmt: 'int' },
  { code: 'B01002_001E', label: 'Median age', fmt: 'age' },
  { code: 'B25010_001E', label: 'Household size', fmt: 'dec' },
  { code: 'B19013_001E', label: 'Median household income', fmt: 'money' },
  { code: 'B25077_001E', label: 'Median home value', fmt: 'money' },
  { code: 'B25064_001E', label: 'Median gross rent', fmt: 'money' },
] as const

// Overpass mirrors, tried in order. The first that answers is remembered and
// promoted for subsequent searches so a healthy server stays sticky.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
let preferredMirror = 0

// Business categories: a label, the synonyms that select it, the Google Places
// type(s) for the primary search, and the OSM tag filters for the free fallback
// (applied to both nodes and ways). Car washes lead, for obvious reasons.
type Category = { key: string; label: string; synonyms: string[]; google: string[]; filters: string[] }
const CATEGORIES: Category[] = [
  { key: 'car_wash', label: 'Car washes', synonyms: ['car wash', 'carwash', 'car washes', 'wash'], google: ['car_wash'], filters: ['amenity=car_wash'] },
  { key: 'fuel', label: 'Gas stations', synonyms: ['gas', 'gas station', 'fuel', 'petrol', 'gas stations'], google: ['gas_station'], filters: ['amenity=fuel'] },
  { key: 'restaurant', label: 'Restaurants', synonyms: ['restaurant', 'restaurants', 'food', 'dining'], google: ['restaurant'], filters: ['amenity=restaurant', 'amenity=fast_food'] },
  { key: 'grocery', label: 'Grocery', synonyms: ['grocery', 'groceries', 'supermarket', 'market'], google: ['supermarket', 'grocery_store'], filters: ['shop=supermarket', 'shop=convenience'] },
  { key: 'bank', label: 'Banks', synonyms: ['bank', 'banks', 'atm'], google: ['bank'], filters: ['amenity=bank'] },
  { key: 'hotel', label: 'Hotels', synonyms: ['hotel', 'hotels', 'motel', 'lodging'], google: ['hotel', 'motel'], filters: ['tourism=hotel', 'tourism=motel'] },
  { key: 'auto_repair', label: 'Auto repair', synonyms: ['auto repair', 'mechanic', 'repair', 'car repair'], google: ['car_repair'], filters: ['shop=car_repair'] },
  { key: 'dealership', label: 'Dealerships', synonyms: ['dealer', 'dealership', 'dealerships', 'car dealer'], google: ['car_dealer'], filters: ['shop=car'] },
  { key: 'coffee', label: 'Coffee', synonyms: ['coffee', 'cafe', 'coffee shop'], google: ['coffee_shop', 'cafe'], filters: ['amenity=cafe', 'shop=coffee'] },
]

type Demo = {
  name: string
  scope: 'place' | 'county'
  stats: { label: string; value: string }[]
}

const nf = new Intl.NumberFormat('en-US')
const mf = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
function fmtCensus(raw: string | null, fmt: string): string {
  if (raw == null) return '—'
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return '—' // Census nulls are large negatives
  if (fmt === 'int') return nf.format(Math.round(n))
  if (fmt === 'age') return `${n.toFixed(1)} yrs`
  if (fmt === 'dec') return n.toFixed(2)
  if (fmt === 'money') return mf.format(n)
  return String(n)
}

// A gold teardrop pin drawn inline so there are no Leaflet marker image assets to
// bundle. Anchored at the tip.
const businessIcon = L.divIcon({
  className: '',
  iconSize: [30, 40],
  iconAnchor: [15, 40],
  popupAnchor: [0, -36],
  html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z" fill="#d4a017" stroke="#7a5c00" stroke-width="1.5"/>
    <circle cx="15" cy="15" r="6" fill="#fff8e1"/>
  </svg>`,
})

// Mighty Wash site marker: the MW logo in a white circular badge, centered on
// the point so it reads as "our site here". Drawn as a divIcon so there's no
// Leaflet image-asset bundling to worry about.
const mwSiteIcon = L.divIcon({
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -22],
  html:
    '<div style="width:40px;height:40px;border-radius:50%;background:#fff;border:2px solid #2563eb;' +
    'box-shadow:0 1px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;overflow:hidden">' +
    '<img src="/mw-logo.png" alt="Mighty Wash" style="width:32px;height:32px;object-fit:contain"/></div>',
})

// Replace a layer's markers with a gold business pin per item (name + address
// popup). Shared by the category search and the trade-area tool.
function addBusinessMarkers(layer: L.LayerGroup, items: Array<{ lat: number; lon: number; name: string; addr: string }>): void {
  layer.clearLayers()
  for (const it of items) {
    L.marker([it.lat, it.lon], { icon: businessIcon })
      .bindPopup(
        `<div style="font-size:15px;font-weight:700;margin-bottom:2px">${escapeHtml(it.name)}</div>` +
          (it.addr ? `<div style="font-size:13px;color:#555">${escapeHtml(it.addr)}</div>` : ''),
      )
      .addTo(layer)
  }
}

async function fetchJson(url: string, ms = 15000): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(String(res.status))
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

// POST an Overpass query, rotating through mirrors starting from the last good
// one. Throws only after every mirror fails.
async function overpass(query: string): Promise<Array<Record<string, unknown>>> {
  const order = [preferredMirror, ...OVERPASS_MIRRORS.map((_, i) => i).filter((i) => i !== preferredMirror)]
  let lastErr: unknown
  for (const idx of order) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch(OVERPASS_MIRRORS[idx], {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { elements?: Array<Record<string, unknown>> }
      preferredMirror = idx
      return data.elements ?? []
    } catch (e) {
      lastErr = e
    } finally {
      clearTimeout(t)
    }
  }
  throw lastErr ?? new Error('overpass failed')
}

function matchCategory(q: string): Category | null {
  const n = q.trim().toLowerCase()
  for (const c of CATEGORIES) if (c.synonyms.some((s) => n === s || n.includes(s))) return c
  return null
}

// Distance from the map center to a corner, in meters, capped at the Google
// Places maximum search radius.
function boundsRadius(map: L.Map): number {
  const b = map.getBounds()
  return Math.min(map.distance(b.getCenter(), b.getNorthEast()), 50000)
}

function addressOf(tags: Record<string, unknown>): string {
  const num = tags['addr:housenumber']
  const street = tags['addr:street']
  const city = tags['addr:city']
  const parts = [[num, street].filter(Boolean).join(' '), city].filter(Boolean)
  return parts.join(', ')
}

const MILES_PER_M = 1 / 1609.34
function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Build the demographics panel model from a raw Census response (shared by the
// tap lookup and the trade-area tool).
function toDemo(data: { name?: string; scope?: 'place' | 'county'; values?: Record<string, string>; error?: string } | null | undefined): Demo | null {
  if (!data || data.error || !data.values || !data.name) return null
  const values = data.values
  return {
    name: data.name,
    scope: data.scope ?? 'place',
    stats: CENSUS_VARS.map((v) => ({ label: v.label, value: fmtCensus(values[v.code] ?? null, v.fmt) })),
  }
}

type Trade = {
  center: string
  miles: number
  demo: Demo | null
  ourSites: { name: string; miles: number }[]
  competitors: { name: string; addr: string; miles: number }[]
}

export default function MarketExplorerPage() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const pinsRef = useRef<L.LayerGroup | null>(null)
  const sitesRef = useRef<L.LayerGroup | null>(null)
  const tapRef = useRef<L.Marker | null>(null)

  const { locations } = useLocations()
  const { profile } = useAuth()
  const isMightyWash = profile?.account_id === MW_ACCOUNT_ID

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [demo, setDemo] = useState<Demo | null>(null)
  const [demoLoading, setDemoLoading] = useState(false)

  const circleRef = useRef<L.Circle | null>(null)
  const [radiusMode, setRadiusMode] = useState(false)
  const [radiusMiles, setRadiusMiles] = useState(3)
  const [trade, setTrade] = useState<Trade | null>(null)
  const [tradeLoading, setTradeLoading] = useState(false)
  // Refs so the map's one-time click handler always reads the latest values.
  const radiusModeRef = useRef(radiusMode)
  const radiusMilesRef = useRef(radiusMiles)
  const runTradeAreaRef = useRef<(lat: number, lon: number) => void>(() => {})
  const loadDemographicsRef = useRef<(lat: number, lon: number) => void>(() => {})
  useEffect(() => { radiusModeRef.current = radiusMode }, [radiusMode])
  useEffect(() => { radiusMilesRef.current = radiusMiles }, [radiusMiles])

  // Resolve a tapped point to Census demographics. The lookup runs in an edge
  // function (the Census geocoder sends no CORS headers, so a direct browser
  // fetch is blocked); it returns raw ACS values that we format here.
  const loadDemographics = useCallback(async (lat: number, lon: number) => {
    setDemo(null)
    setTrade(null)
    setDemoLoading(true)
    setStatus(null)
    try {
      const { data, error } = await censusDemographics(lat, lon)
      if (error) throw error
      if (data?.error === 'no_area') {
        setStatus('No Census area found for that spot. Try tapping a town or city.')
        return
      }
      if (!data || data.error || !data.values || !data.name) {
        setStatus('Census has no data for that area yet.')
        return
      }
      const built = toDemo(data)
      if (!built) {
        setStatus('Census has no data for that area yet.')
        return
      }
      setDemo(built)
    } catch {
      setStatus('Could not reach the Census service. Check the connection and try again.')
    } finally {
      setDemoLoading(false)
    }
  }, [])
  useEffect(() => { loadDemographicsRef.current = loadDemographics }, [loadDemographics])

  // Init the map once.
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return
    const map = L.map(wrapRef.current, { center: START.center, zoom: START.zoom, zoomControl: true, tap: true })
    // Standard OpenStreetMap tiles: keyless and watermark-free (CARTO's free
    // basemap started serving an "API key required" watermark tile).
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    map.zoomControl.setPosition('bottomright')
    pinsRef.current = L.layerGroup().addTo(map)
    sitesRef.current = L.layerGroup().addTo(map)

    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      if (radiusModeRef.current) {
        runTradeAreaRef.current(lat, lng)
        return
      }
      if (tapRef.current) tapRef.current.setLatLng(e.latlng)
      else tapRef.current = L.marker(e.latlng).addTo(map)
      loadDemographicsRef.current(lat, lng)
    })

    mapRef.current = map
    // The container mounts inside a flex/full-bleed layout; nudge Leaflet to
    // remeasure once the browser has settled the size.
    setTimeout(() => map.invalidateSize(), 200)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Drop the Mighty Wash logo at each current MW site. Kept in its own layer so a
  // business search never clears it. MW-gated so other tenants aren't branded.
  useEffect(() => {
    const layer = sitesRef.current
    if (!layer || !mapRef.current) return
    layer.clearLayers()
    if (!isMightyWash) return
    for (const s of locations) {
      if (s.latitude == null || s.longitude == null) continue
      L.marker([s.latitude, s.longitude], { icon: mwSiteIcon, zIndexOffset: 1000, title: s.name })
        .bindPopup(
          `<div style="font-size:15px;font-weight:700;margin-bottom:2px">${escapeHtml(s.name)}</div>` +
            '<div style="font-size:12px;color:#2563eb;font-weight:600">Mighty Wash site</div>',
        )
        .addTo(layer)
    }
  }, [locations, isMightyWash])

  // Trade-area analysis: draw a circle of the chosen radius at the tapped point
  // and summarize what's inside (center demographics, our sites, competitor car
  // washes). Runs on tap while radius mode is on.
  const runTradeArea = useCallback(
    async (lat: number, lon: number) => {
      const map = mapRef.current
      if (!map) return
      const miles = radiusMilesRef.current
      const meters = miles * 1609.34
      setDemo(null)
      setStatus(null)
      setTrade(null)
      setTradeLoading(true)

      if (circleRef.current) circleRef.current.setLatLng([lat, lon]).setRadius(meters)
      else
        circleRef.current = L.circle([lat, lon], {
          radius: meters, color: '#2563eb', weight: 2, fillColor: '#2563eb', fillOpacity: 0.08,
        }).addTo(map)
      map.fitBounds(circleRef.current.getBounds(), { padding: [40, 40] })

      try {
        const [censusRes, placesOut] = await Promise.all([
          censusDemographics(lat, lon),
          searchPlaces({ includedTypes: ['car_wash'], lat, lon, radius: Math.min(meters, 50000) }),
        ])

        const ourSites = locations
          .filter((s) => s.latitude != null && s.longitude != null && haversineMeters(lat, lon, s.latitude, s.longitude) <= meters)
          .map((s) => ({ name: s.name, miles: haversineMeters(lat, lon, s.latitude as number, s.longitude as number) * MILES_PER_M }))
          .sort((a, b) => a.miles - b.miles)

        // Car washes inside the circle, excluding our own sites (matched by
        // proximity so it works regardless of how Google names them).
        const compFull = (placesOut.ok ? placesOut.hits : [])
          .map((h) => ({ name: h.name, addr: h.address, miles: haversineMeters(lat, lon, h.lat, h.lon) * MILES_PER_M, lat: h.lat, lon: h.lon }))
          .filter((h) => h.miles <= miles + 0.01)
          .filter((h) => !locations.some((s) => s.latitude != null && s.longitude != null && haversineMeters(h.lat, h.lon, s.latitude, s.longitude) <= 200))
          .sort((a, b) => a.miles - b.miles)

        // Drop a pin on the map for each competitor car wash in the circle. (Our
        // own MW sites already show their logo pins.)
        if (pinsRef.current) addBusinessMarkers(pinsRef.current, compFull.map((c) => ({ lat: c.lat, lon: c.lon, name: c.name, addr: c.addr })))

        const competitors = compFull.map(({ name, addr, miles }) => ({ name, addr, miles }))
        setTrade({ center: toDemo(censusRes.data)?.name ?? 'this point', miles, demo: toDemo(censusRes.data), ourSites, competitors })
      } catch {
        setStatus('Could not analyze that area. Please try again.')
      } finally {
        setTradeLoading(false)
      }
    },
    [locations],
  )
  useEffect(() => { runTradeAreaRef.current = runTradeArea }, [runTradeArea])

  const clearTradeArea = useCallback(() => {
    setTrade(null)
    setTradeLoading(false)
    pinsRef.current?.clearLayers()
    if (circleRef.current && mapRef.current) {
      mapRef.current.removeLayer(circleRef.current)
      circleRef.current = null
    }
  }, [])

  const dropPins = useCallback((items: Array<{ lat: number; lon: number; name: string; addr: string }>) => {
    const layer = pinsRef.current
    const map = mapRef.current
    if (!layer || !map) return
    addBusinessMarkers(layer, items)
  }, [])

  // Free OpenStreetMap category search. Used as the fallback when Google Places
  // isn't configured, so the page still works with no key.
  const runCategoryOsm = useCallback(
    async (cat: Category) => {
      const map = mapRef.current
      if (!map) return
      const b = map.getBounds()
      const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`
      const body = cat.filters
        .flatMap((f) => {
          const [k, v] = f.split('=')
          return [`node["${k}"="${v}"](${bbox});`, `way["${k}"="${v}"](${bbox});`]
        })
        .join('')
      const q = `[out:json][timeout:25];(${body});out center 250;`
      const els = await overpass(q)
      const items = els
        .map((el) => {
          const tags = (el.tags ?? {}) as Record<string, unknown>
          const lat = (el.lat as number) ?? (el.center as { lat: number } | undefined)?.lat
          const lon = (el.lon as number) ?? (el.center as { lon: number } | undefined)?.lon
          if (lat == null || lon == null) return null
          return { lat, lon, name: (tags.name as string) ?? cat.label.replace(/s$/, ''), addr: addressOf(tags) }
        })
        .filter((x): x is { lat: number; lon: number; name: string; addr: string } => x != null)
      dropPins(items)
      setStatus(
        items.length
          ? `Found ${items.length} ${cat.label.toLowerCase()} in view. Tap a pin for details.`
          : `No ${cat.label.toLowerCase()} found here. Zoom out or pan, then search again.`,
      )
    },
    [dropPins],
  )

  // Category search: Google Places first (richer listings), OpenStreetMap when
  // Google isn't configured.
  const runCategory = useCallback(
    async (cat: Category) => {
      const map = mapRef.current
      if (!map) return
      const c = map.getBounds().getCenter()
      const out = await searchPlaces({ includedTypes: cat.google, lat: c.lat, lon: c.lng, radius: boundsRadius(map) })
      if (!out.ok) {
        if (out.reason === 'nokey') return runCategoryOsm(cat)
        throw new Error(out.message ?? 'Places error')
      }
      const items = out.hits.map((h) => ({ lat: h.lat, lon: h.lon, name: h.name, addr: h.address }))
      dropPins(items)
      setStatus(
        items.length
          ? `Found ${items.length} ${cat.label.toLowerCase()} nearby. Tap a pin for details.`
          : `No ${cat.label.toLowerCase()} found here. Zoom out or pan, then search again.`,
      )
    },
    [dropPins, runCategoryOsm],
  )

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim()
      if (!q || busy) return
      const map = mapRef.current
      if (!map) return
      setBusy(true)
      setStatus(null)
      setDemo(null)
      try {
        const cat = matchCategory(q)
        if (cat) {
          await runCategory(cat)
          return
        }
        // Not a category: ask Nominatim. A place flies the map; otherwise treat
        // the text as a business name and drop pins on the matches.
        const b = map.getBounds()
        const viewbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`
        const results = (await fetchJson(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=${encodeURIComponent(q)}` +
            `&viewbox=${viewbox}`,
        )) as Array<{ lat: string; lon: string; display_name: string; class: string; type: string; name?: string }>
        if (!results.length) {
          setStatus(`Nothing found for "${q}". Try a category like "car washes" or a city name.`)
          return
        }
        const top = results[0]
        const isPlace =
          top.class === 'place' ||
          top.class === 'boundary' ||
          ['city', 'town', 'village', 'hamlet', 'administrative'].includes(top.type)
        if (isPlace) {
          if (pinsRef.current) pinsRef.current.clearLayers()
          map.flyTo([Number(top.lat), Number(top.lon)], 12, { duration: 0.8 })
          setStatus(`Moved to ${top.display_name.split(',').slice(0, 2).join(',')}. Tap the map for demographics.`)
          return
        }
        // A business name: Google Places first, OpenStreetMap (the Nominatim
        // matches we already have) when Google isn't configured.
        const c = map.getCenter()
        const out = await searchPlaces({ textQuery: q, lat: c.lat, lon: c.lng, radius: boundsRadius(map) })
        if (out.ok) {
          if (!out.hits.length) {
            setStatus(`Nothing found for "${q}". Try a category like "car washes" or a city name.`)
            return
          }
          dropPins(out.hits.map((h) => ({ lat: h.lat, lon: h.lon, name: h.name, addr: h.address })))
          setStatus(`Found ${out.hits.length} match${out.hits.length === 1 ? '' : 'es'} for "${q}". Tap a pin for details.`)
        } else if (out.reason === 'nokey') {
          dropPins(
            results.map((r) => ({
              lat: Number(r.lat),
              lon: Number(r.lon),
              name: r.name || r.display_name.split(',')[0],
              addr: r.display_name.split(',').slice(1, 4).join(',').trim(),
            })),
          )
          setStatus(`Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${q}". Tap a pin for details.`)
        } else {
          throw new Error(out.message ?? 'Places error')
        }
      } catch {
        setStatus('Search service is busy right now. Give it a moment and try again.')
      } finally {
        setBusy(false)
      }
    },
    [busy, dropPins, runCategory],
  )

  const goFullscreen = () => {
    const el = wrapRef.current?.parentElement
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-content">
      <div ref={wrapRef} className="absolute inset-0 z-0" />

      {/* Search + quick categories, floating top-center. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-col items-center gap-3 p-4">
        <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl bg-card p-2 shadow-2xl ring-1 ring-border">
          <Search className="ml-2 h-6 w-6 shrink-0 text-ink-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch(query)
            }}
            placeholder='Search "car washes", a business, or a city'
            className="h-16 flex-1 bg-transparent text-xl text-ink outline-none placeholder:text-ink-subtle"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="grid h-12 w-12 place-items-center rounded-xl text-ink-subtle hover:bg-content"
              aria-label="Clear"
            >
              <X className="h-6 w-6" />
            </button>
          )}
          <button
            onClick={() => void runSearch(query)}
            disabled={busy}
            className="flex h-14 items-center gap-2 rounded-xl bg-accent px-6 text-lg font-semibold text-white disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            Search
          </button>
        </div>

      </div>

      {/* Fullscreen toggle for kiosk mode. */}
      <button
        onClick={goFullscreen}
        className="absolute right-4 top-28 z-[500] grid h-14 w-14 place-items-center rounded-xl bg-card text-ink shadow-lg ring-1 ring-border hover:bg-content"
        aria-label="Toggle fullscreen"
      >
        <Maximize2 className="h-6 w-6" />
      </button>

      {/* Trade-area (radius) tool, top-left. */}
      <div className="absolute left-4 top-28 z-[500] flex flex-col items-start gap-2">
        <button
          onClick={() =>
            setRadiusMode((m) => {
              const next = !m
              setStatus(next ? `Tap the map to analyze a ${radiusMiles} mile trade area.` : null)
              return next
            })
          }
          className={`flex h-14 items-center gap-2 rounded-xl px-4 text-base font-semibold shadow-lg ring-1 ring-border ${
            radiusMode ? 'bg-accent text-white' : 'bg-card text-ink hover:bg-content'
          }`}
        >
          <Circle className="h-5 w-5" /> Trade Area
        </button>
        {radiusMode && (
          <div className="w-64 rounded-xl bg-card p-3 shadow-lg ring-1 ring-border">
            <div className="px-1 pb-1 text-xs font-medium text-ink-subtle">Radius</div>
            <div className="flex gap-1">
              {[1, 3, 5, 10].map((mi) => (
                <button
                  key={mi}
                  onClick={() => {
                    setRadiusMiles(mi)
                    setStatus(`Tap the map to analyze a ${mi} mile trade area.`)
                  }}
                  className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold ${
                    mi === radiusMiles ? 'bg-accent text-white' : 'bg-content text-ink hover:bg-accent-soft'
                  }`}
                >
                  {mi}
                </button>
              ))}
            </div>
            {/* Custom radius: drag for any value (touch-friendly for the kiosk). */}
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={0.5}
                max={25}
                step={0.5}
                value={radiusMiles}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setRadiusMiles(v)
                  setStatus(`Tap the map to analyze a ${v} mile trade area.`)
                }}
                aria-label="Custom radius"
                className="h-2 flex-1 cursor-pointer accent-[#2563eb]"
              />
              <span className="w-14 shrink-0 text-right text-sm font-semibold text-ink">{radiusMiles} mi</span>
            </div>
          </div>
        )}
      </div>

      {/* Status toast. */}
      {status && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[500] flex justify-center px-4">
          <div className="pointer-events-auto max-w-2xl rounded-xl bg-shell px-5 py-3 text-center text-base text-ink-invert shadow-2xl">
            {status}
          </div>
        </div>
      )}

      {/* Demographics slide-in panel. */}
      {(demo || demoLoading) && (
        <div className="absolute inset-y-0 right-0 z-[600] flex w-full max-w-md flex-col bg-card shadow-2xl ring-1 ring-border">
          <div className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
                {demo?.scope === 'county' ? <Building2 className="h-6 w-6" /> : <MapPin className="h-6 w-6" />}
              </span>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {demoLoading ? 'Loading' : demo?.scope === 'county' ? 'County' : 'City / Place'}
                </div>
                <div className="text-lg font-bold leading-tight text-ink">{demo?.name ?? 'Fetching demographics'}</div>
              </div>
            </div>
            <button
              onClick={() => {
                setDemo(null)
                setDemoLoading(false)
                if (tapRef.current && mapRef.current) {
                  mapRef.current.removeLayer(tapRef.current)
                  tapRef.current = null
                }
              }}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-ink-subtle hover:bg-content"
              aria-label="Close"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {demoLoading ? (
            <div className="flex flex-1 items-center justify-center text-ink-subtle">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3">
                {demo?.stats.map((s) => (
                  <div key={s.label} className="rounded-xl bg-content p-4">
                    <div className="text-sm text-ink-subtle">{s.label}</div>
                    <div className="mt-1 text-2xl font-bold text-ink">{s.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-start gap-2 text-xs text-ink-subtle">
                <Users className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  US Census Bureau, American Community Survey {ACS} 5-year estimates.
                  {demo?.scope === 'county' ? ' Shown at county level (unincorporated area).' : ''}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trade-area (radius) results panel. */}
      {(trade || tradeLoading) && (
        <div className="absolute inset-y-0 right-0 z-[600] flex w-full max-w-md flex-col bg-card shadow-2xl ring-1 ring-border">
          <div className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
                <Circle className="h-6 w-6" />
              </span>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {tradeLoading ? 'Analyzing' : `${trade?.miles} mile trade area`}
                </div>
                <div className="text-lg font-bold leading-tight text-ink">{trade?.center ?? 'Analyzing area'}</div>
              </div>
            </div>
            <button
              onClick={clearTradeArea}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-ink-subtle hover:bg-content"
              aria-label="Close"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {tradeLoading ? (
            <div className="flex flex-1 items-center justify-center text-ink-subtle">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5">
              {/* Car-wash competition inside the circle. */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-accent-soft p-4">
                  <div className="text-sm text-accent">Your sites in area</div>
                  <div className="mt-1 text-3xl font-bold text-ink">{trade?.ourSites.length ?? 0}</div>
                </div>
                <div className="rounded-xl bg-content p-4">
                  <div className="text-sm text-ink-subtle">Competitor washes</div>
                  <div className="mt-1 text-3xl font-bold text-ink">{trade?.competitors.length ?? 0}</div>
                </div>
              </div>

              {trade && trade.ourSites.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Your sites</div>
                  <ul className="space-y-1">
                    {trade.ourSites.map((s) => (
                      <li key={s.name} className="flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 font-medium text-ink"><MapPin className="h-4 w-4 text-accent" />{s.name}</span>
                        <span className="shrink-0 text-ink-subtle">{s.miles.toFixed(1)} mi</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <Car className="h-4 w-4" /> Competitor car washes
                </div>
                {trade && trade.competitors.length > 0 ? (
                  <ul className="space-y-1">
                    {trade.competitors.slice(0, 15).map((c, i) => (
                      <li key={c.name + i} className="flex items-start justify-between gap-2 rounded-lg bg-content px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{c.name}</span>
                          {c.addr && <span className="block truncate text-xs text-ink-subtle">{c.addr}</span>}
                        </span>
                        <span className="shrink-0 text-ink-subtle">{c.miles.toFixed(1)} mi</span>
                      </li>
                    ))}
                    {trade.competitors.length > 15 && (
                      <li className="px-3 py-1 text-xs text-ink-subtle">+ {trade.competitors.length - 15} more</li>
                    )}
                  </ul>
                ) : (
                  <div className="rounded-lg bg-content px-3 py-2 text-sm text-ink-subtle">No competitor car washes in this radius.</div>
                )}
              </div>

              {/* Area demographics (the city/county containing the center point). */}
              {trade?.demo && (
                <div className="mt-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    Demographics · {trade.demo.name}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {trade.demo.stats.map((s) => (
                      <div key={s.label} className="rounded-xl bg-content p-4">
                        <div className="text-sm text-ink-subtle">{s.label}</div>
                        <div className="mt-1 text-2xl font-bold text-ink">{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-start gap-2 text-xs text-ink-subtle">
                    <Users className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Census ACS {ACS} 5-year for {trade.demo.name}
                      {trade.demo.scope === 'county' ? ' (county)' : ''}, the area containing the center point.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
