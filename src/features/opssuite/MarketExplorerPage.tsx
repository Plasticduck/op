import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Search, X, Loader2, MapPin, Maximize2, Users, Building2 } from 'lucide-react'
import { searchPlaces, censusDemographics } from '@/lib/queries/places'

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
// Which categories get a quick-tap button, in order.
const QUICK = ['car_wash', 'fuel', 'restaurant', 'grocery', 'bank', 'hotel']

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

export default function MarketExplorerPage() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const pinsRef = useRef<L.LayerGroup | null>(null)
  const tapRef = useRef<L.Marker | null>(null)

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [demo, setDemo] = useState<Demo | null>(null)
  const [demoLoading, setDemoLoading] = useState(false)

  // Resolve a tapped point to Census demographics. The lookup runs in an edge
  // function (the Census geocoder sends no CORS headers, so a direct browser
  // fetch is blocked); it returns raw ACS values that we format here.
  const loadDemographics = useCallback(async (lat: number, lon: number) => {
    setDemo(null)
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
      const values = data.values
      setDemo({
        name: data.name,
        scope: data.scope ?? 'place',
        stats: CENSUS_VARS.map((v) => ({ label: v.label, value: fmtCensus(values[v.code] ?? null, v.fmt) })),
      })
    } catch {
      setStatus('Could not reach the Census service. Check the connection and try again.')
    } finally {
      setDemoLoading(false)
    }
  }, [])

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

    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      if (tapRef.current) tapRef.current.setLatLng(e.latlng)
      else tapRef.current = L.marker(e.latlng).addTo(map)
      void loadDemographics(lat, lng)
    })

    mapRef.current = map
    // The container mounts inside a flex/full-bleed layout; nudge Leaflet to
    // remeasure once the browser has settled the size.
    setTimeout(() => map.invalidateSize(), 200)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [loadDemographics])

  const dropPins = useCallback((items: Array<{ lat: number; lon: number; name: string; addr: string }>) => {
    const layer = pinsRef.current
    const map = mapRef.current
    if (!layer || !map) return
    layer.clearLayers()
    for (const it of items) {
      L.marker([it.lat, it.lon], { icon: businessIcon })
        .bindPopup(
          `<div style="font-size:15px;font-weight:700;margin-bottom:2px">${escapeHtml(it.name)}</div>` +
            (it.addr ? `<div style="font-size:13px;color:#555">${escapeHtml(it.addr)}</div>` : ''),
        )
        .addTo(layer)
    }
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

        <div className="pointer-events-auto flex max-w-3xl flex-wrap justify-center gap-2">
          {QUICK.map((key) => {
            const cat = CATEGORIES.find((c) => c.key === key)!
            return (
              <button
                key={key}
                onClick={() => {
                  setQuery(cat.label)
                  setBusy(true)
                  setStatus(null)
                  setDemo(null)
                  runCategory(cat)
                    .catch(() => setStatus('Search service is busy right now. Give it a moment and try again.'))
                    .finally(() => setBusy(false))
                }}
                disabled={busy}
                className="rounded-full bg-card px-5 py-3 text-base font-medium text-ink shadow-lg ring-1 ring-border hover:bg-accent-soft disabled:opacity-60"
              >
                {cat.label}
              </button>
            )
          })}
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
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
