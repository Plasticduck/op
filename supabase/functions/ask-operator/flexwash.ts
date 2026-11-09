// FlexWash for Operator AI. FlexWash's MCP server only accepts a person's own
// FlexWash sign-in, so Operator AI reads the same data through the FlexWash
// partner API with Mighty Wash's company key instead (FLEXWASH_CLIENT_ID /
// FLEXWASH_CLIENT_SECRET, the same key the `flexwash` function uses). Nobody signs
// in to FlexWash, and the key doesn't depend on any one person's login.
//
// Two tools: flexwash_describe (one endpoint's full description and input) and
// flexwash_call (run one read endpoint). The endpoint list is generated from
// FlexWash's docs into flexwash_catalog.ts (scripts/gen-flexwash-catalog.mjs);
// only read endpoints are in it.
//
// Who sees what:
//   Admins (owner): every FlexWash car wash and the company-wide endpoints.
//   Managers / Regional Managers: only the FlexWash car washes at their sites.
//     Endpoints that name car washes are checked or filled in; customer lookups
//     check the customer's home car wash first; an order or vehicle is checked
//     after it comes back; customer search drops other sites' customers; the
//     company-wide endpoints (scope "admin") are refused.
//   The shared office login also can't read commission detail (pay).
//
// FlexWash tokens last 24h and FlexWash caps new ones at 75 a day, so the token
// is cached in service_tokens (shared with the `flexwash` function).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
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

const catalogLines = (admin: boolean) =>
  Object.entries(FLEX_ENDPOINTS)
    .filter(([, e]) => admin || e.scope !== 'admin')
    .map(([n, e]) => `${n}(${e.signature}) - ${e.summary}`)
    .join('\n')

// Stable per access level (Admin or not), so it caches as its own system block.
export function flexPrompt(admin: boolean): string {
  return `FlexWash is the point-of-sale and membership system at the FlexWash sites. Two tools read it live:
- flexwash_call(endpoint, input) runs one read-only endpoint from the catalog below.
- flexwash_describe(endpoint) gives that endpoint's full description and input format. Use it when the catalog line isn't enough.

Use FlexWash for anything inside the FlexWash point of sale: memberships (active, new, frozen, reactivated, churn and its reasons, lifetime value), customers and their vehicles (find them with customers_searchCustomers), orders and receipts, payments and failed cards, discounts, promotions, upsells and downsells, gift cards and wash books, sales by employee and commissions, fleet accounts, labor cost, accounting and deposits, license plate reads, and suspicious activity (manual gate opens, $0 washes, skipped queues, plate changes). FlexWash only covers the FlexWash sites; for SiteWatch sites, and for car counts and sales history across every site, keep using the other tools.

Rules for FlexWash:
- Dates are "YYYY-MM-DD". A dateRange {start, end} includes both days, in each car wash's local time.
- carWashIds are FlexWash car wash IDs (strings), listed in the next system note with their Operator site. Leave carWashIds as [] to mean every car wash this user can see.
- FlexWash money is usually integer cents (fields ending in Cents, and the accounting endpoints say so). Convert to dollars in your answer.
- Paged endpoints take paginationOpts {limit, offset}. Ask for what you need (limit 25 to 100), and read totalCount rather than paging through rows to count them.
- For totals, prefer a stats or summary endpoint over listing orders.
- If an endpoint returns an error, read it, check the input with flexwash_describe, and try again.
- These tools only read. If asked to change a customer, membership, vehicle or order, say it has to be done in FlexWash itself.
- Customer details (names, phones, emails, plates, card last four) are for the business: show only what the question needs.

FlexWash catalog, as name(input) - what it returns:
${catalogLines(admin)}`
}

// Per-user note: which car washes they can see, and any limits.
export function flexUserNote(access: FlexAccess): string {
  const list = access.sites.map((s) => `${s.label} = "${s.carWashId}"`).join(', ')
  let note = `FlexWash car washes this user can see (Operator site = FlexWash car wash ID): ${list}.`
  if (!access.all) {
    note += ' This user only sees these car washes; other FlexWash car washes and the company-wide endpoints are refused.'
  }
  if (access.noPay) note += ' This login cannot see commission detail (accounting_getCommissionDetail).'
  return note
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

export class FlexWash {
  private customerSite = new Map<string, string | null>()
  private post: Poster
  // `poster` replaces the network call in tests.
  constructor(svc: SupabaseClient, private access: FlexAccess, poster?: Poster) {
    this.post = poster ?? ((path, body) => post(svc, path, body))
  }

  private get allowed(): Set<string> {
    return new Set(this.access.sites.map((s) => s.carWashId))
  }
  private notYours(ids: string[]): Error {
    const list = this.access.sites.map((s) => `${s.label} = "${s.carWashId}"`).join(', ')
    return new Error(`Car wash ${ids.join(', ')} isn't at this user's sites. They can see: ${list}.`)
  }

  describe(endpoint: string): string {
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
    if (this.access.noPay && PAY_ENDPOINTS.has(name)) throw new Error('Commission detail is pay, which this login cannot see.')
    if (e.scope === 'admin' && !this.access.all) {
      throw new Error('That FlexWash endpoint covers every site, so only Admins can use it. Use a per-car-wash endpoint instead.')
    }
    return e
  }

  // The customer's home car wash, checked against this user's sites.
  private async checkCustomer(customerId: unknown): Promise<void> {
    if (this.access.all) return
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
    const ids = holder[key]
    if (!Array.isArray(ids) || ids.length === 0) {
      holder[key] = this.access.sites.map((s) => s.carWashId)
      return
    }
    holder[key] = ids.map((x: unknown) => String(x))
    if (!this.access.all) {
      const bad = (holder[key] as string[]).filter((x) => !this.allowed.has(x))
      if (bad.length) throw this.notYours(bad)
    }
  }

  // Runs one endpoint for this user and returns text for the model plus a row count.
  async call(name: string, rawInput: unknown): Promise<{ text: string; rows: number; input: Json }> {
    const e = this.endpoint(name)
    const input: Json = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? structuredClone(rawInput) : {}
    let note = ''

    if (e.scope === 'carWashIds') this.scopeIds(input, 'carWashIds')
    else if (e.scope === 'filters.carWashIds') {
      if (!input.filters || typeof input.filters !== 'object') input.filters = {}
      this.scopeIds(input.filters, 'carWashIds')
    } else if (e.scope === 'carWashId') {
      const v = input.carWashId
      if (v == null || v === '') {
        if (!this.access.all && this.access.sites.length === 1) input.carWashId = this.access.sites[0].carWashId
        else if (!this.access.all) throw new Error('Pass carWashId, one of this user\'s car washes.')
      } else {
        input.carWashId = String(v)
        if (!this.access.all && !this.allowed.has(input.carWashId)) throw this.notYours([input.carWashId])
      }
    } else if (e.scope === 'customer') {
      await this.checkCustomer(input.customerId)
    }

    let data = await this.post(e.path, e.noBody ? undefined : input)

    if (!this.access.all) {
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
