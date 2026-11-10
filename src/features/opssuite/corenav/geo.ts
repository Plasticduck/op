// Map maths for the CoreNav Map: which washes sit inside a drive-time area, the
// colour classes for demand shading, and how CoreNav's layer values read.

type Ring = number[][] // [lng, lat][]
export type GeoPolygon = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  if (!rings.length || !inRing(lng, lat, rings[0])) return false
  for (let k = 1; k < rings.length; k++) if (inRing(lng, lat, rings[k])) return false // a hole
  return true
}

export function inside(lat: number, lng: number, g: GeoPolygon): boolean {
  if (g.type === 'Polygon') return inPolygon(lng, lat, g.coordinates)
  return g.coordinates.some((poly) => inPolygon(lng, lat, poly))
}

// Bounding box [w, s, e, n] of a polygon, for a quick first check.
export function bbox(g: GeoPolygon): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
  for (const ring of rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y }
  return [w, s, e, n]
}

// Miles between two points (great circle).
export function miles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(a))
}

// Five shades, light to dark, for demand shading.
export const RAMP = ['#e0ecff', '#a9c8fb', '#5d9cf2', '#2563eb', '#173a8f']

// Class breaks at the quintiles of what's on screen (4 breaks for 5 classes).
export function quintiles(values: number[]): number[] {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return []
  return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))])
}

export function classOf(value: number, breaks: number[]): number {
  let k = 0
  while (k < breaks.length && value > breaks[k]) k++
  return k
}

// How a CoreNav layer value reads: format is number, money, percent or flag.
export function fmtLayer(format: string | undefined, v: unknown): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (format === 'flag') return n ? 'Yes' : 'No'
  if (!Number.isFinite(n)) return String(v)
  if (format === 'money') return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  if (format === 'percent') return `${Math.round(n <= 1 ? n * 100 : n)}%`
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 })
}

// A weight 0..1 for each value, scaled between the 5th and 95th percentile.
export function scaled(values: (number | null)[]): (number | null)[] {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return values.map(() => null)
  const lo = v[Math.floor(0.05 * (v.length - 1))]
  const hi = v[Math.floor(0.95 * (v.length - 1))]
  const span = hi - lo || 1
  return values.map((x) => (x == null || !Number.isFinite(x) ? null : Math.max(0, Math.min(1, (x - lo) / span))))
}
