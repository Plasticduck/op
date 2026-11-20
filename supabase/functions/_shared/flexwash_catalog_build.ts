// Builds Operator AI's FlexWash catalog from FlexWash's published partner API docs
// (https://api.flexwash.com/rest-docs/external/). Used two ways:
//   - flexwash-catalog-sync (daily) keeps the live catalog current in the
//     flexwash_catalog table, which ask-operator reads.
//   - scripts/gen-flexwash-catalog.mjs writes ask-operator/flexwash_catalog.ts,
//     the copy bundled with ask-operator for when the table is empty.
//
// Only read endpoints are kept, and only ones whose name says they read (get,
// list, search, ...). Anything else FlexWash adds is held back for a person to
// review (HELD), since the catalog now updates without anyone looking at it.
// Each kept endpoint gets a `scope` saying how a manager is kept to their own car
// washes (see ask-operator/flexwash.ts):
//   carWashIds / carWashId / filters.carWashIds  the input names the car washes
//   customer  keyed by customerId: the customer's home car wash is checked first
//   order     the returned order's car wash is checked
//   vehicle   the returned vehicle's customer is checked
//   search    results from other car washes are dropped
//   open      company settings with no site or customer data (promotions, leaderboards)
//   admin     company-wide or unscoped: Admins only. New unscoped endpoints land here.
// deno-lint-ignore-file no-explicit-any
type Any = any

export const FLEX_DOCS_URL = 'https://api.flexwash.com/rest-docs/external/swagger-ui-init.js'

export type FlexScope = 'carWashIds' | 'carWashId' | 'filters.carWashIds' | 'customer' | 'order' | 'vehicle' | 'search' | 'open' | 'admin'
export type FlexEndpoint = {
  path: string
  summary: string
  signature: string
  scope: FlexScope
  noBody: boolean
  description: string
  schema: unknown
}
export type FlexCatalogBuild = {
  endpoints: Record<string, FlexEndpoint>
  // Endpoints left out because their name doesn't say they only read.
  held: { name: string; path: string; summary: string }[]
}

// Writes and things Operator AI must not call. Anything templated or GET is a
// file or webhook-style endpoint, not a report.
const WRITE = /(create|update|submit|add-vehicle-to|access-token|resolve-vehicle|customer-identity|audio-recordings|organization-logo)/i
// Endpoints the company key can't use, so they would always fail:
// - salesLeaderboard_getStatsForSalesLeaderboard only works from a leaderboard display session.
// - The two membership-roster endpoints answer "No organization selected" even with
//   ?organizationId (checked 2026-11-09); they need a signed-in FlexWash user. Take
//   them out of this list if FlexWash fixes that.
const EXCLUDE = new Set([
  'salesLeaderboard_getStatsForSalesLeaderboard',
  'membershipRoster_getMembershipRoster',
  'membershipRoster_getBillDayProjection',
])
const OPEN = new Set(['salesLeaderboard_getSalesLeaderboard', 'promotions_getPromotions', 'promotions_getPromotion'])
const RECORD: Record<string, FlexScope> = { orders_getOrder: 'order', vehicles_getVehicle: 'vehicle', customers_searchCustomers: 'search' }
// The part after the area must start with a reading verb (or end in Preview, like
// vehicles_addVehicleSubscriptionPreview, which prices a change without making it).
const READS = /^(get|list|search|load|preview|current|find|count|lookup)[A-Z]|Preview$/

export const nameOf = (p: string) =>
  p.replace(/^\/external\//, '').split('/').map((seg) => seg.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())).join('_')

export function readsOnly(name: string): boolean {
  const op = name.split('_').pop() ?? ''
  return READS.test(op)
}

// The OpenAPI document embedded in FlexWash's docs page script.
export function parseDocs(js: string): Any {
  const m = js.match(/"swaggerDoc":\s*(\{[\s\S]*\})\s*,\s*"customOptions"/)
  if (!m) throw new Error('Could not find the OpenAPI document in the docs page.')
  return JSON.parse(m[1])
}

export function buildFlexCatalog(doc: Any): FlexCatalogBuild {
  const comps = doc.components?.schemas ?? {}
  const resolve = (s: Any, seen = new Set<string>()): Any => {
    if (!s || typeof s !== 'object') return s
    if (s.$ref) {
      const key = String(s.$ref).split('/').pop()!
      return seen.has(key) ? { type: 'object' } : resolve(comps[key], new Set([...seen, key]))
    }
    const out: Any = Array.isArray(s) ? [] : {}
    for (const [k, v] of Object.entries(s)) out[k] = typeof v === 'object' ? resolve(v, seen) : v
    return out
  }
  // FlexWash marks "left out" with a {$type: "undefined"} variant and accepts a
  // date as "YYYY-MM-DD" or an object; keep the plain forms.
  const isUndef = (x: Any) => x && typeof x === 'object' && x.const && typeof x.const === 'object' && x.const.$type === 'undefined'
  const isLocalDate = (s: Any) => Array.isArray(s?.anyOf) && s.anyOf.some((a: Any) => a.type === 'string' && /date/i.test(a.description ?? ''))
  const clean = (s: Any): Any => {
    if (Array.isArray(s)) return s.map(clean)
    if (!s || typeof s !== 'object') return s
    if (isLocalDate(s)) return { type: 'string', description: 'date, YYYY-MM-DD' }
    const o: Any = {}
    for (const [k, v] of Object.entries(s)) {
      if (k === '$schema') continue
      if ((k === 'anyOf' || k === 'oneOf') && Array.isArray(v)) {
        const kept = v.filter((x) => !isUndef(x)).map(clean)
        if (kept.length === 1 && typeof kept[0] === 'object') { Object.assign(o, kept[0]); continue }
        o[k] = kept
        continue
      }
      o[k] = typeof v === 'object' ? clean(v) : v
    }
    return o
  }
  // A short one-line input signature for the catalog.
  const sig = (s: Any, depth = 0): string => {
    if (!s) return 'any'
    if (s.const !== undefined) return JSON.stringify(s.const)
    if (s.enum) return s.enum.length > 6 ? `${s.enum.slice(0, 6).map((e: Any) => JSON.stringify(e)).join('|')}|...` : s.enum.map((e: Any) => JSON.stringify(e)).join('|')
    if (s.anyOf || s.oneOf) return [...new Set((s.anyOf ?? s.oneOf).map((a: Any) => sig(a, depth)))].join('|')
    const types: string[] = Array.isArray(s.type) ? s.type : s.type ? [s.type] : []
    const nullable = types.includes('null')
    const t = types.filter((x) => x !== 'null')[0]
    if (!t && nullable && !s.properties) return 'null'
    let r: string
    if (t === 'array') r = `${sig(s.items, depth)}[]`
    else if (t === 'object' || s.properties) {
      const props = s.properties ?? {}
      const keys = Object.keys(props)
      if (!keys.length) r = 'object'
      else if (keys.length === 2 && props.start && props.end) r = '{start,end}'
      else if (keys.length === 2 && props.limit && props.offset) r = '{limit,offset}'
      else if (depth >= 2) r = '{...}'
      else {
        const req = new Set(s.required ?? [])
        r = '{' + keys.map((k) => `${k}${req.has(k) ? '' : '?'}: ${sig(props[k], depth + 1)}`).join(', ') + '}'
      }
    } else if (t === 'string' && /YYYY-MM-DD/.test(s.description ?? '')) r = 'date'
    else r = t === 'integer' ? 'int' : t ?? 'any'
    return nullable ? `${r}|null` : r
  }

  const endpoints: Record<string, FlexEndpoint> = {}
  const held: FlexCatalogBuild['held'] = []
  for (const [p, ops] of Object.entries(doc.paths ?? {}) as [string, Any][]) {
    if (!ops.post || WRITE.test(p) || p.includes('{')) continue
    const name = nameOf(p)
    if (EXCLUDE.has(name)) continue
    const op = ops.post
    if (!readsOnly(name)) {
      held.push({ name, path: p, summary: String(op.summary ?? '').trim() })
      continue
    }
    const raw = resolve(op.requestBody?.content?.['application/json']?.schema ?? null)
    const schema = raw ? clean(raw) : { type: 'object', properties: {} }
    const props = schema.properties ?? {}
    let scope: FlexScope
    if (props.carWashIds) scope = 'carWashIds'
    else if (props.carWashId) scope = 'carWashId'
    else if (props.filters?.properties?.carWashIds) scope = 'filters.carWashIds'
    else if (RECORD[name]) scope = RECORD[name]
    else if (OPEN.has(name)) scope = 'open'
    else if (props.customerId && !props.id) scope = 'customer'
    else scope = 'admin'
    endpoints[name] = {
      path: p,
      summary: String(op.summary ?? '').trim(),
      signature: raw ? sig(schema) : '{}',
      scope,
      // FlexWash rejects any body (even {}) on these.
      noBody: !raw,
      description: String(op.description ?? '').trim(),
      schema,
    }
  }
  const sorted = Object.fromEntries(Object.keys(endpoints).sort().map((n) => [n, endpoints[n]]))
  return { endpoints: sorted, held: held.sort((a, b) => a.name.localeCompare(b.name)) }
}

// JSON with object keys sorted, so a catalog read back from jsonb (which reorders
// keys) compares equal to a freshly built one.
export function canon(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon((v as Any)[k])).join(',') + '}'
  }
  return JSON.stringify(v) ?? 'null'
}

export type FlexCatalogChanges = {
  added: string[]
  removed: string[]
  changed: string[]
  // Inputs that became required, or endpoints that went away: these can break
  // Operator's own FlexWash pages, which call some of these reports directly.
  breaking: { name: string; path: string; detail: string }[]
}

export function diffFlexCatalog(prev: Record<string, FlexEndpoint>, next: Record<string, FlexEndpoint>): FlexCatalogChanges {
  const out: FlexCatalogChanges = { added: [], removed: [], changed: [], breaking: [] }
  const req = (e: FlexEndpoint) => new Set<string>(((e.schema as Any)?.required ?? []) as string[])
  for (const n of Object.keys(next)) if (!prev[n]) out.added.push(n)
  for (const n of Object.keys(prev)) {
    if (!next[n]) {
      out.removed.push(n)
      out.breaking.push({ name: n, path: prev[n].path, detail: 'is gone from the docs' })
      continue
    }
    const a = prev[n], b = next[n]
    if (canon([a.path, a.signature, a.scope, a.noBody, a.description, a.schema]) !== canon([b.path, b.signature, b.scope, b.noBody, b.description, b.schema])) {
      out.changed.push(n)
    }
    const newly = [...req(b)].filter((k) => !req(a).has(k))
    if (newly.length) out.breaking.push({ name: n, path: b.path, detail: `now requires ${newly.join(', ')}` })
  }
  return out
}
