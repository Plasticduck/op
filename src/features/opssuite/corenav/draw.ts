import L from 'leaflet'
import type { GeoPolygon } from './geo'

// Turning CoreNav's layer rows into things Leaflet can draw: GeoJSON text to
// lat/lngs, road colours by traffic, and the pop-up for a new-build permit.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Geo = { type: string; coordinates: any }

// CoreNav sends geometry as GeoJSON text (or already parsed).
export function parseGeom(v: unknown): Geo | null {
  if (v == null || v === '') return null
  if (typeof v === 'object') return (v as Geo).type ? (v as Geo) : null
  try {
    const g = JSON.parse(String(v)) as Geo
    return g && typeof g === 'object' && g.type ? g : null
  } catch {
    return null
  }
}

export function asPolygon(g: Geo | null): GeoPolygon | null {
  return g && (g.type === 'Polygon' || g.type === 'MultiPolygon') ? (g as GeoPolygon) : null
}

export function polygonLatLngs(g: GeoPolygon): L.LatLng[][] | L.LatLng[][][] {
  return g.type === 'Polygon' ? L.GeoJSON.coordsToLatLngs(g.coordinates, 1) : L.GeoJSON.coordsToLatLngs(g.coordinates, 2)
}

export function lineLatLngs(g: Geo | null): L.LatLng[] | L.LatLng[][] | null {
  if (!g) return null
  if (g.type === 'LineString') return L.GeoJSON.coordsToLatLngs(g.coordinates, 0)
  if (g.type === 'MultiLineString') return L.GeoJSON.coordsToLatLngs(g.coordinates, 1)
  return null
}

// Road traffic (vehicles a day): light to dark, thin to thick.
export const ROAD_CLASSES: { upTo: number; color: string; weight: number; label: string }[] = [
  { upTo: 5000, color: '#fcd34d', weight: 1.5, label: 'under 5k' },
  { upTo: 15000, color: '#fb923c', weight: 2, label: '5k to 15k' },
  { upTo: 40000, color: '#ef4444', weight: 3, label: '15k to 40k' },
  { upTo: 100000, color: '#b91c1c', weight: 4, label: '40k to 100k' },
  { upTo: Infinity, color: '#7f1d1d', weight: 5, label: 'over 100k' },
]

export function roadStyle(aadt: number | null): { color: string; weight: number } {
  if (aadt == null || !Number.isFinite(aadt)) return { color: '#9ca3af', weight: 1.25 }
  return ROAD_CLASSES.find((c) => aadt < c.upTo) ?? ROAD_CLASSES[ROAD_CLASSES.length - 1]
}

// Signals, stop signs and speed limits.
export function controlStyle(kind: string): { fill: string; radius: number; label: string } {
  if (kind === 'signal') return { fill: '#f59e0b', radius: 4, label: 'Traffic signal' }
  if (kind === 'stop') return { fill: '#dc2626', radius: 3.5, label: 'Stop sign' }
  if (kind === 'speed') return { fill: '#ffffff', radius: 4, label: 'Speed limit' }
  return { fill: '#6b7280', radius: 3.5, label: kind ? kind.replace(/_/g, ' ') : 'Road control' }
}

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

const money = (v: unknown) => {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? null : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const words = (v: unknown) => (v == null || v === '' ? null : String(v).replace(/_/g, ' '))

// The pop-up for a new-build permit (CoreNav's pipeline overlay).
export function permitPopup(get: (col: string) => unknown, titleCol = 'description'): string {
  const rows: [string, string | null][] = [
    ['Type', words(get('type'))],
    ['Address', [get('address'), get('city'), get('state')].filter((x) => x != null && x !== '').join(', ') || null],
    ['Value', money(get('value'))],
    ['Status', words(get('status'))],
    ['Filed', get('filed_date') ? String(get('filed_date')) : null],
    ['Issued', get('issued_date') ? String(get('issued_date')) : null],
    ['Owner / applicant', get('applicant_owner') ? String(get('applicant_owner')) : null],
    ['Permit', get('record_id') ? String(get('record_id')) : null],
  ]
  const url = get('source_url')
  const link = typeof url === 'string' && /^https?:\/\//i.test(url)
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb">Source record</a>`
    : ''
  return (
    `<div style="max-width:260px;font-size:12px;line-height:1.4">` +
    `<div style="font-weight:600;margin-bottom:4px">${esc(get(titleCol) ?? 'New-build permit')}</div>` +
    rows.filter(([, v]) => v).map(([k, v]) => `<div><span style="color:#6b7280">${esc(k)}:</span> ${esc(v)}</div>`).join('') +
    (link ? `<div style="margin-top:4px">${link}</div>` : '') +
    `</div>`
  )
}
