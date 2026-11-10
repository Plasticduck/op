// Labels and values for CoreNav's fields, for the CoreNav Map sidebar. CoreNav
// gives labels for some columns (its `columns` catalog); the rest are spelled out
// from the column name.

const WORDS: Record<string, string> = {
  aadt: 'AADT', hh: 'households', mw: 'Mighty Wash', cad: 'CAD', osm: 'OSM', poi: 'places', pct: '%',
  dt: 'drive time to', min: 'min', mi: 'miles', sqft: 'sq ft', svc: '', yoy: 'year over year', cagr: 'CAGR',
  n: 'count', rev: 'revenue', acq: '', url: 'website', hpms: '', '0p5pct': '0.5%', '12m': '(12 mo)', '10': '(10 min)',
}

export function labelFor(labels: Record<string, string>, table: string, field: string): string {
  const rel = table === '' ? 'universe' : table
  const known = labels[`${rel}.${field}`] ?? labels[`universe.${field}`]
  if (known) return known
  const words = field.split('_').map((w) => (w in WORDS ? WORDS[w] : w)).filter(Boolean)
  const s = words.join(' ').replace(/\s+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : field
}

const MONEY = /(^|_)(rev|revenue|value|price|cost|income|ticket|base|top|single|member_min|member_top|premium)(_|$)/i
const SHARE = /(share|_rate|ratio)(_|$)/i
const PERCENT = /(_pct|percent)(_|$)/i
const COUNTS = /(^|_)(n|count|reviews|cars|pop|hh|workers|jobs|aadt|households|sqft)(_|$)/i
const nf = (n: number, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits })

export type Shown = { text: string; href?: string }

export function showValue(field: string, v: unknown): Shown {
  if (v == null || v === '') return { text: '—' }
  if (typeof v === 'boolean') return { text: v ? 'Yes' : 'No' }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { text: '—' }
    if (/(^|_)(year|yr)(_|$)/i.test(field) && Number.isInteger(v)) return { text: String(v) } // 2025, not 2,025
    if (PERCENT.test(field)) return { text: `${nf(v, 1)}%` }
    if (SHARE.test(field) && Math.abs(v) <= 1) return { text: `${nf(v * 100, 0)}%` }
    if (MONEY.test(field) && !/member_n$/.test(field)) {
      return { text: v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }) }
    }
    if (COUNTS.test(field)) return { text: nf(v) }
    return { text: nf(v, Math.abs(v) < 10 ? 2 : 1) }
  }
  if (Array.isArray(v)) return { text: v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') || '—' }
  if (typeof v === 'object') return { text: JSON.stringify(v) }
  const s = String(v)
  if (/^https?:\/\//i.test(s)) return { text: s.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), href: s }
  // Code-like values ("express_tunnel") read better with spaces.
  return { text: /^[a-z0-9_]+$/.test(s) ? s.replace(/_/g, ' ') : s }
}
