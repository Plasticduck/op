// FlexWash for Operator AI, two ways in, behind the same two tools:
//
//   Their own FlexWash login (Connect to FlexWash; see _shared/connect.ts). When a
//   person has connected it, FlexWash calls go through FlexWash's MCP server as
//   them, and FlexWash decides what they can see. It also has what the partner
//   API can't do (the member roster, bill-day projection, tags).
//   The company connection: the FlexWash partner API with Mighty Wash's company
//   key (FLEXWASH_CLIENT_ID / FLEXWASH_CLIENT_SECRET, the same key the `flexwash`
//   function uses). Nobody signs in, and Operator's own rules decide who sees what
//   (below). It answers for everyone who hasn't connected their login, covers
//   endpoints their login doesn't have, and steps in if their login doesn't answer.
//
// Two tools: flexwash_describe (one endpoint's full description and input) and
// flexwash_call (run one read endpoint). The partner API's endpoint list is
// generated from FlexWash's docs into flexwash_catalog.ts
// (scripts/gen-flexwash-catalog.mjs); only read endpoints are in it. A connected
// login adds its own read-only tools (same names as the API's where both exist).
//
// Who sees what through the company connection:
//   Admins (owner): every FlexWash car wash and the company-wide endpoints.
//   Managers / Regional Managers: only the FlexWash car washes at their sites.
//     Endpoints that name car washes are checked or filled in; customer lookups
//     check the customer's home car wash first; an order or vehicle is checked
//     after it comes back; customer search drops other sites' customers; the
//     company-wide endpoints (scope "admin") are refused.
//   The shared office login also can't read commission detail (pay).
//
// FlexWash tokens last 24h and FlexWash caps new ones at 75 a day, so the
// company token is cached in service_tokens (shared with the `flexwash` function).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import type { McpSession } from '../_shared/mcp.ts'
import { FLEX_ENDPOINTS, type FlexEndpoint } from './flexwash_catalog.ts'

const FLEX_BASE = 'https://api.flexwash.com'
const PROVIDER = 'flexwash'
const MAX_RESULT_CHARS = 20000
// Pay: hidden from the shared office login, like pay everywhere else in Operator AI.
const PAY_ENDPOINTS = new Set(['accounting_getCommissionDetail'])

export type FlexSite = { carWashId: string; siteNumber: number; label: string }
export type FlexAccess = {
  sites: FlexSite[] // the FlexWash car washes this user may see
  all: boolean // Admin: every car wash plus company-wide endpoints
  noPay: boolean // shared office login
}
// deno-lint-ignore no-explicit-any
type Json = any

export const FLEX_DESCRIBE_TOOL: Anthropic.Tool = {
  name: 'flexwash_describe',
  description:
    "Get one FlexWash endpoint's full description and input format. Use it before calling an endpoint when its one-line catalog entry isn't enough (nested filters, cohorts, roster filters, what a field means).",
  input_schema: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', description: 'Endpoint name from the FlexWash catalog, e.g. memberships_getChurnPercentages.' },
    },
    required: ['endpoint'],
  },
}

export const FLEX_CALL_TOOL: Anthropic.Tool = {
  name: 'flexwash_call',
  description:
    'Run one read-only FlexWash endpoint from the FlexWash catalog and get its JSON back. Nothing in FlexWash can be changed with it.',
  input_schema: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', description: 'Endpoint name from the FlexWash catalog.' },
      input: { type: 'object', description: "The endpoint's input as JSON, matching its catalog entry." },
    },
    required: ['endpoint', 'input'],
  },
}

// A short input signature from a JSON Schema, for tools that come from a
// connected login (the API catalog has its own, generated ahead of time).
function sigOf(s: Json, depth = 0): string {
  if (!s || typeof s !== 'object') return 'any'
  if (s.const !== undefined) return JSON.stringify(s.const)
  if (Array.isArray(s.enum)) return s.enum.length > 6 ? `${s.enum.slice(0, 6).map((e: unknown) => JSON.stringify(e)).join('|')}|...` : s.enum.map((e: unknown) => JSON.stringify(e)).join('|')
  const alts = s.anyOf ?? s.oneOf
  if (Array.isArray(alts)) {
    const parts = alts.filter((a: Json) => !(a?.const && typeof a.const === 'object')).map((a: Json) => sigOf(a, depth))
    return [...new Set(parts)].join('|')
  }
  const types: string[] = Array.isArray(s.type) ? s.type : s.type ? [s.type] : []
  const t = types.find((x) => x !== 'null')
  const nullable = types.includes('null') ? '|null' : ''
  if (!t && types.includes('null')) return 'null'
  if (t === 'array') return `${sigOf(s.items, depth)}[]${nullable}`
  if (t === 'object' || s.properties) {
    const props = s.properties ?? {}
    const keys = Object.keys(props)
    if (!keys.length) return `object${nullable}`
    if (keys.length === 2 && props.start && props.end) return `{start,end}${nullable}`
    if (keys.length === 2 && props.limit && props.offset) return `{limit,offset}${nullable}`
    if (depth >= 2) return `{...}${nullable}`
    const req = new Set<string>(s.required ?? [])
    return '{' + keys.map((k) => `${k}${req.has(k) ? '' : '?'}: ${sigOf(props[k], depth + 1)}`).join(', ') + '}' + nullable
  }
  return (t === 'integer' ? 'int' : t ?? 'any') + nullable
}
const firstSentence = (s: string) => (s.trim().split(/(?<=\.)\s|\n/)[0] ?? '').slice(0, 160)

// The catalog this user gets: their own login's tools first, then the company
// connection's endpoints their login doesn't have (Admin-only ones for Admins).
// Stable per user, so it caches as its own system block.
export function flexCatalog(access: FlexAccess | null, mcp: McpSession | null): string {
  const lines = new Map<string, string>()
  for (const t of mcp?.tools ?? []) {
    const api = FLEX_ENDPOINTS[t.name]
    lines.set(t.name, api
      ? `${t.name}(${api.signature}) - ${api.summary}`
      : `${t.name}(${sigOf(t.inputSchema)}) - ${firstSentence(t.description.replace(/^FlexWash: /, ''))}`)
  }
  if (access) {
    for (const [n, e] of Object.entries(FLEX_ENDPOINTS)) {
      if (lines.has(n) || (e.scope === 'admin' && !access.all)) continue
      lines.set(n, `${n}(${e.signature}) - ${e.summary}`)
    }
  }
  return [...lines.keys()].sort().map((k) => lines.get(k)).join('\n')
}

export function flexPrompt(catalog: string, ownLogin: boolean): string {
  const ids = ownLogin
    ? '- carWashIds are FlexWash car wash IDs (strings). Name the ones you want: carWash_getCarWashes with carWashIds null lists every car wash this user can see, and the next system note maps Operator sites to IDs when there is one.'
    : '- carWashIds are FlexWash car wash IDs (strings), listed in the next system note with their Operator site. Leave carWashIds as [] to mean every car wash this user can see.'
  return `FlexWash is the point-of-sale and membership system at the FlexWash sites. Two tools read it live:
- flexwash_call(endpoint, input) runs one read-only endpoint from the catalog below.
- flexwash_describe(endpoint) gives that endpoint's full description and input format. Use it when the catalog line isn't enough.

Use FlexWash for anything inside the FlexWash point of sale: memberships (active, new, frozen, reactivated, churn and its reasons, lifetime value), customers and their vehicles (find them with customers_searchCustomers), orders and receipts, payments and failed cards, discounts, promotions, upsells and downsells, gift cards and wash books, sales by employee and commissions, fleet accounts, labor cost, accounting and deposits, license plate reads, and suspicious activity (manual gate opens, $0 washes, skipped queues, plate changes). FlexWash only covers the FlexWash sites; for SiteWatch sites, and for car counts and sales history across every site, keep using the other tools.

Rules for FlexWash:
- Dates are "YYYY-MM-DD". A dateRange {start, end} includes both days, in each car wash's local time.
${ids}
- FlexWash money is usually integer cents (fields ending in Cents, and the accounting endpoints say so). Convert to dollars in your answer.
- Paged endpoints take paginationOpts {limit, offset}. Ask for what you need (limit 25 to 100), and read totalCount rather than paging through rows to count them.
- For totals, prefer a stats or summary endpoint over listing orders.
- If an endpoint returns an error, read it, check the input with flexwash_describe, and try again.
- These tools only read. If asked to change a customer, membership, vehicle or order, say it has to be done in FlexWash itself.
- Customer details (names, phones, emails, plates, card last four) are for the business: show only what the question needs.

FlexWash catalog, as name(input) - what it returns:
${catalog}`
}

// Per-user note: how FlexWash reaches them, which car washes, and any limits.
export function flexUserNote(access: FlexAccess | null, ownLogin: boolean): string {
  const parts: string[] = []
  if (ownLogin) {
    parts.push('This user connected their own FlexWash login: FlexWash calls go through it, and FlexWash decides what they can see.')
    if (access) parts.push("The company connection fills in endpoints their login doesn't have and steps in if their login doesn't answer.")
  }
  if (access) {
    const list = access.sites.map((s) => `${s.label} = "${s.carWashId}"`).join(', ')
    parts.push(`FlexWash car washes${ownLogin ? ' through the company connection' : ' this user can see'} (Operator site = FlexWash car wash ID): ${list}.`)
    if (!access.all) parts.push('Through the company connection this user only sees these car washes; other FlexWash car washes and the company-wide endpoints are refused.')
    if (access.noPay) parts.push('This login cannot see commission detail (accounting_getCommissionDetail).')
  }
  return parts.join(' ')
}

async function getToken(svc: SupabaseClient, force = false): Promise<string> {
  if (!force) {
    const { data: cached } = await svc.from('service_tokens').select('token, expires_at').eq('provider', PROVIDER).maybeSingle()
    if (cached && new Date(cached.expires_at as string).getTime() > Date.now() + 60_000) return cached.token as string
  }
  const clientId = Deno.env.get('FLEXWASH_CLIENT_ID')
  const clientSecret = Deno.env.get('FLEXWASH_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('FlexWash is not configured.')
  const res = await fetch(`${FLEX_BASE}/external/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.accessToken) throw new Error(`FlexWash sign-in failed (${res.status}).`)
  await svc.from('service_tokens').upsert(
    {
      provider: PROVIDER,
      token: j.accessToken,
      expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'provider' },
  )
  return j.accessToken as string
}

// The company token carries no organization, and the customer, analytics and
// promotion endpoints need one, so every call names it. Mighty Wash's FlexWash
// organization is 275 (found 2026-11-02; member-lookup keeps it in service_tokens
// as "flexwash_org"); FLEXWASH_ORG_ID overrides.
let orgIdCache: string | null = null
async function getOrgId(svc: SupabaseClient): Promise<string> {
  if (orgIdCache) return orgIdCache
  const env = Deno.env.get('FLEXWASH_ORG_ID')
  if (env) return (orgIdCache = env)
  const { data } = await svc.from('service_tokens').select('token').eq('provider', 'flexwash_org').maybeSingle()
  return (orgIdCache = (data?.token as string | undefined) || '275')
}

// `body` undefined sends no body: some endpoints reject even {}.
async function post(svc: SupabaseClient, path: string, body: unknown): Promise<Json> {
  let token = await getToken(svc)
  const url = `${FLEX_BASE}${path}?organizationId=${encodeURIComponent(await getOrgId(svc))}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: body === undefined
        ? { Authorization: `Bearer ${token}` }
        : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data: Json = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    // A rejected cached token: mint one fresh token and retry once.
    if (res.status === 401 && attempt === 0) { token = await getToken(svc, true); continue }
    if (!res.ok) {
      const msg = typeof data === 'object' && data ? (data.message ?? data.error ?? JSON.stringify(data)) : String(data ?? '')
      throw new Error(`FlexWash ${res.status}: ${String(msg).slice(0, 600)}`)
    }
    return data
  }
  throw new Error('FlexWash rejected the sign-in.')
}

// Every car wash ID a FlexWash record mentions (carWashId fields and carWash.id).
function carWashIdsIn(v: Json, out = new Set<string>(), depth = 0): Set<string> {
  if (!v || typeof v !== 'object' || depth > 6) return out
  if (Array.isArray(v)) { for (const x of v) carWashIdsIn(x, out, depth + 1); return out }
  for (const [k, x] of Object.entries(v)) {
    if (k === 'carWashId' && (typeof x === 'string' || typeof x === 'number')) out.add(String(x))
    else if (k === 'carWash' && x && typeof x === 'object' && 'id' in x && (x as Json).id != null) out.add(String((x as Json).id))
    if (x && typeof x === 'object') carWashIdsIn(x, out, depth + 1)
  }
  return out
}

function rowCount(data: Json): number {
  if (Array.isArray(data)) return data.length
  if (data && typeof data === 'object') {
    for (const v of Object.values(data)) if (Array.isArray(v)) return v.length
    return 1
  }
  return data == null ? 0 : 1
}

type Poster = (path: string, body: unknown) => Promise<Json>

const rowsOfText = (text: string): number => {
  try { return rowCount(JSON.parse(text)) } catch { return text.trim() ? 1 : 0 }
}

export class FlexWash {
  private customerSite = new Map<string, string | null>()
  private post: Poster
  // access: the company connection's rules for this user, or null when they have
  // no company access. mcp: their own FlexWash login's session, when connected.
  // `poster` replaces the company connection's network call in tests.
  constructor(svc: SupabaseClient, private access: FlexAccess | null, poster?: Poster, private mcp: McpSession | null = null) {
    this.post = poster ?? ((path, body) => post(svc, path, body))
  }

  // Their own login is in use (connected, with read-only tools to offer).
  get ownLogin(): boolean {
    return !!this.mcp && this.mcp.tools.length > 0
  }

  // The company connection's rules; throws when this user has none.
  private get api(): FlexAccess {
    if (!this.access) throw new Error("FlexWash's company connection isn't available to this user, and their own FlexWash login doesn't have that.")
    return this.access
  }
  private get allowed(): Set<string> {
    return new Set(this.api.sites.map((s) => s.carWashId))
  }
  private notYours(ids: string[]): Error {
    const list = this.api.sites.map((s) => `${s.label} = "${s.carWashId}"`).join(', ')
    return new Error(`Car wash ${ids.join(', ')} isn't at this user's sites. They can see: ${list}.`)
  }
  // Whether the company connection can answer this for this user.
  private apiCan(name: string): boolean {
    const e = FLEX_ENDPOINTS[name]
    return !!e && !!this.access && (e.scope !== 'admin' || this.access.all) && !(this.access.noPay && PAY_ENDPOINTS.has(name))
  }

  describe(endpoint: string): string {
    const t = this.mcp?.byName.get(endpoint)
    if (t) {
      return JSON.stringify({
        endpoint,
        via: 'their own FlexWash login',
        description: t.description.replace(/^FlexWash: /, ''),
        input_schema: t.inputSchema,
      })
    }
    const e = this.endpoint(endpoint)
    return JSON.stringify({
      endpoint,
      summary: e.summary,
      input: e.signature,
      description: e.description,
      input_schema: e.schema,
    })
  }

  private endpoint(name: string): FlexEndpoint {
    const e = FLEX_ENDPOINTS[name]
    if (!e) throw new Error(`There is no FlexWash endpoint named "${name}". Use a name from the FlexWash catalog.`)
    const a = this.api
    if (a.noPay && PAY_ENDPOINTS.has(name)) throw new Error('Commission detail is pay, which this login cannot see.')
    if (e.scope === 'admin' && !a.all) {
      throw new Error('That FlexWash endpoint covers every site, so only Admins can use it. Use a per-car-wash endpoint instead.')
    }
    return e
  }

  // Runs one endpoint for this user: their own login when it has it, otherwise
  // (or if it doesn't answer) the company connection.
  async call(name: string, rawInput: unknown): Promise<{ text: string; rows: number; input: Json; via: 'login' | 'company' }> {
    let fellBack = ''
    if (this.mcp?.byName.has(name)) {
      const input: Json = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {}
      let r: { text: string; isError: boolean } | null = null
      try {
        r = await this.mcp.callByName(name, input, MAX_RESULT_CHARS)
      } catch (e) {
        if (!this.apiCan(name)) throw e
        fellBack = ` (Their FlexWash login didn't answer (${e instanceof Error ? e.message : String(e)}), so this came from the company connection.)`
      }
      if (r) {
        // FlexWash answered with an error about the request: no point asking again another way.
        if (r.isError) throw new Error(r.text.slice(0, 600) || 'FlexWash returned an error.')
        return { text: r.text, rows: rowsOfText(r.text), input, via: 'login' }
      }
    }
    const res = await this.callApi(name, rawInput)
    return { ...res, text: res.text + fellBack, via: 'company' }
  }

  // The customer's home car wash, checked against this user's sites.
  private async checkCustomer(customerId: unknown): Promise<void> {
    if (this.api.all) return
    const id = String(customerId ?? '').trim()
    if (!id) throw new Error('Pass a customerId.')
    if (!this.customerSite.has(id)) {
      const d = await this.post(FLEX_ENDPOINTS.customers_getCustomerDetails.path, { customerId: id })
      const c = d?.customer ?? d
      const site = c?.carWashId ?? c?.carWash?.id
      this.customerSite.set(id, site != null ? String(site) : null)
    }
    const site = this.customerSite.get(id)
    if (!site || !this.allowed.has(site)) throw new Error("That customer's home car wash isn't at this user's sites.")
  }

  private scopeIds(holder: Json, key: string): void {
    const a = this.api
    const ids = holder[key]
    if (!Array.isArray(ids) || ids.length === 0) {
      holder[key] = a.sites.map((s) => s.carWashId)
      return
    }
    holder[key] = ids.map((x: unknown) => String(x))
    if (!a.all) {
      const bad = (holder[key] as string[]).filter((x) => !this.allowed.has(x))
      if (bad.length) throw this.notYours(bad)
    }
  }

  // The company connection: runs one endpoint under Operator's rules for this
  // user and returns text for the model plus a row count.
  private async callApi(name: string, rawInput: unknown): Promise<{ text: string; rows: number; input: Json }> {
    const e = this.endpoint(name)
    const a = this.api
    const input: Json = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? structuredClone(rawInput) : {}
    let note = ''

    if (e.scope === 'carWashIds') this.scopeIds(input, 'carWashIds')
    else if (e.scope === 'filters.carWashIds') {
      if (!input.filters || typeof input.filters !== 'object') input.filters = {}
      this.scopeIds(input.filters, 'carWashIds')
    } else if (e.scope === 'carWashId') {
      const v = input.carWashId
      if (v == null || v === '') {
        if (!a.all && a.sites.length === 1) input.carWashId = a.sites[0].carWashId
        else if (!a.all) throw new Error('Pass carWashId, one of this user\'s car washes.')
      } else {
        input.carWashId = String(v)
        if (!a.all && !this.allowed.has(input.carWashId)) throw this.notYours([input.carWashId])
      }
    } else if (e.scope === 'customer') {
      await this.checkCustomer(input.customerId)
    }

    let data = await this.post(e.path, e.noBody ? undefined : input)

    if (!a.all) {
      if (e.scope === 'order') {
        const ids = [...carWashIdsIn(data)]
        if (!ids.length || ids.some((x) => !this.allowed.has(x))) throw new Error("That order isn't from this user's sites.")
      } else if (e.scope === 'vehicle') {
        await this.checkCustomer(data?.customerId ?? data?.vehicle?.customerId)
      } else if (e.scope === 'search' && Array.isArray(data?.customers)) {
        const before = data.customers.length
        const kept = data.customers.filter((c: Json) => {
          const ids = [...carWashIdsIn({ carWashId: c?.carWashId, carWash: c?.carWash })]
          return ids.length > 0 && ids.every((x) => this.allowed.has(x))
        })
        data = { ...data, customers: kept }
        if (kept.length < before) {
          note = ` (${before - kept.length} matching customer(s) at other sites were left out; totalCount still counts them)`
        }
      }
    }

    let text = JSON.stringify(data)
    if (text.length > MAX_RESULT_CHARS) {
      text = `${text.slice(0, MAX_RESULT_CHARS)}…(truncated: ${text.length.toLocaleString('en-US')} characters in all. Ask for fewer days, fewer car washes, a smaller page, or a summary endpoint.)`
    }
    return { text: text + note, rows: rowCount(data), input }
  }
}
