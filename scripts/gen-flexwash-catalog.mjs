// Builds supabase/functions/ask-operator/flexwash_catalog.ts from FlexWash's
// published partner API docs (https://api.flexwash.com/rest-docs/external/).
// Operator AI reads FlexWash through these endpoints with the company key, so
// this is its list of FlexWash tools. Rerun when FlexWash adds endpoints:
//
//   node scripts/gen-flexwash-catalog.mjs
//
// Only read endpoints are included. Each gets a `scope` saying how a manager is
// kept to their own car washes (see flexwash.ts in ask-operator):
//   carWashIds / carWashId / filters.carWashIds  the input names the car washes
//   customer  keyed by customerId: the customer's home car wash is checked first
//   order     the returned order's car wash is checked
//   vehicle   the returned vehicle's customer is checked
//   search    results from other car washes are dropped
//   open      company settings with no site or customer data (promotions, leaderboards)
//   admin     company-wide or unscoped: Admins only. New unscoped endpoints land here.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DOCS = 'https://api.flexwash.com/rest-docs/external/swagger-ui-init.js'
const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'supabase', 'functions', 'ask-operator', 'flexwash_catalog.ts')

const js = await (await fetch(DOCS)).text()
const m = js.match(/"swaggerDoc":\s*(\{[\s\S]*\})\s*,\s*"customOptions"/)
if (!m) throw new Error('Could not find the OpenAPI document in the docs page.')
const doc = JSON.parse(m[1])
const comps = doc.components?.schemas ?? {}

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
const RECORD = { orders_getOrder: 'order', vehicles_getVehicle: 'vehicle', customers_searchCustomers: 'search' }

const resolve = (s, seen = new Set()) => {
  if (!s || typeof s !== 'object') return s
  if (s.$ref) {
    const key = s.$ref.split('/').pop()
    return seen.has(key) ? { type: 'object' } : resolve(comps[key], new Set([...seen, key]))
  }
  const out = Array.isArray(s) ? [] : {}
  for (const [k, v] of Object.entries(s)) out[k] = typeof v === 'object' ? resolve(v, seen) : v
  return out
}
// FlexWash marks "left out" with a {$type: "undefined"} variant and accepts a
// date as "YYYY-MM-DD" or an object; keep the plain forms.
const isUndef = (x) => x && typeof x === 'object' && x.const && typeof x.const === 'object' && x.const.$type === 'undefined'
const isLocalDate = (s) => Array.isArray(s?.anyOf) && s.anyOf.some((a) => a.type === 'string' && /date/i.test(a.description ?? ''))
const clean = (s) => {
  if (Array.isArray(s)) return s.map(clean)
  if (!s || typeof s !== 'object') return s
  if (isLocalDate(s)) return { type: 'string', description: 'date, YYYY-MM-DD' }
  const o = {}
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
const sig = (s, depth = 0) => {
  if (!s) return 'any'
  if (s.const !== undefined) return JSON.stringify(s.const)
  if (s.enum) return s.enum.length > 6 ? `${s.enum.slice(0, 6).map((e) => JSON.stringify(e)).join('|')}|...` : s.enum.map((e) => JSON.stringify(e)).join('|')
  if (s.anyOf || s.oneOf) return [...new Set((s.anyOf ?? s.oneOf).map((a) => sig(a, depth)))].join('|')
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : []
  const nullable = types.includes('null')
  const t = types.filter((x) => x !== 'null')[0]
  if (!t && nullable && !s.properties) return 'null'
  let r
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
const nameOf = (p) => p.replace(/^\/external\//, '').split('/').map((seg) => seg.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())).join('_')

const out = {}
for (const [p, ops] of Object.entries(doc.paths)) {
  if (!ops.post || WRITE.test(p) || p.includes('{')) continue
  const name = nameOf(p)
  if (EXCLUDE.has(name)) continue
  const op = ops.post
  const raw = resolve(op.requestBody?.content?.['application/json']?.schema ?? null)
  const schema = raw ? clean(raw) : { type: 'object', properties: {} }
  const props = schema.properties ?? {}
  let scope
  if (props.carWashIds) scope = 'carWashIds'
  else if (props.carWashId) scope = 'carWashId'
  else if (props.filters?.properties?.carWashIds) scope = 'filters.carWashIds'
  else if (RECORD[name]) scope = RECORD[name]
  else if (OPEN.has(name)) scope = 'open'
  else if (props.customerId && !props.id) scope = 'customer'
  else scope = 'admin'
  out[name] = {
    path: p,
    summary: (op.summary ?? '').trim(),
    signature: raw ? sig(schema) : '{}',
    scope,
    // FlexWash rejects any body (even {}) on these.
    noBody: !raw,
    description: (op.description ?? '').trim(),
    schema,
  }
}

const names = Object.keys(out).sort()
const sorted = Object.fromEntries(names.map((n) => [n, out[n]]))
const header = `// GENERATED by scripts/gen-flexwash-catalog.mjs from ${DOCS.replace('swagger-ui-init.js', '')}
// on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand; rerun the script.
// ${names.length} read endpoints of the FlexWash partner API, for Operator AI.

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
`
writeFileSync(OUT, `${header}\nexport const FLEX_ENDPOINTS: Record<string, FlexEndpoint> = ${JSON.stringify(sorted, null, 1)}\n`)
const count = {}
for (const e of Object.values(sorted)) count[e.scope] = (count[e.scope] ?? 0) + 1
console.log(`Wrote ${names.length} endpoints to ${path.relative(process.cwd(), OUT)}`, count)
