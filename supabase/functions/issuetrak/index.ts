// issuetrak — Supabase Edge Function (Deno).
// Server-enforced gateway to the Issuetrak API v2 (Mighty Wash instance at
// https://mightywash.issuetrak.com/api/v2). Holds the Issuetrak API token
// (X-Api-Key) server-side. Issuetrak is a Mighty-Wash-only integration.
//
// Scope (enforced here, not trusted from the client):
//   - owner / technician  -> ADMIN: see all open tickets, submit for any site.
//   - manager             -> see + submit only for their own Operator site(s).
//   - employee / others   -> 403.
//
// Operator sites are named "MW01".."MW35"; Issuetrak names them "Mighty Wash
// #01" etc. We map by the numeric part. Tickets carry the site as an Issuetrak
// Location or Organization; we auto-detect which and filter/tag accordingly.
//
// Request body: { action, ...args }. Actions: diag, bootstrap, list, get, create.
//
// Secret: ISSUETRAK_API_KEY (required; 503 no_key otherwise).
//         ISSUETRAK_BASE_URL (optional; defaults to the Mighty Wash instance).

import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_BASE = 'https://mightywash.issuetrak.com/api/v2'
const MIGHTY_WASH_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const MAX_ADMIN_PAGES = 10 // safety cap: up to 1000 open tickets

const ALLOWED_ORIGINS = new Set<string>([
  'https://operator.washlyfe.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return {
    'Access-Control-Allow-Origin': allow,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

// Extract the site number from a name like "Mighty Wash #01", "MW01", or "#1".
function siteNumberFromName(name: unknown): number | null {
  const s = String(name ?? '')
  const m = s.match(/#\s*0*(\d+)/) || s.match(/\bMW\s*0*(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

type ItResult = { status: number; ok: boolean; data: any } // deno-lint-ignore-line no-explicit-any

async function itFetch(
  base: string,
  apiKey: string,
  path: string,
  opts?: { method?: string; body?: unknown },
): Promise<ItResult> {
  const headers: Record<string, string> = { 'X-Api-Key': apiKey, Accept: 'application/json' }
  const init: RequestInit = { method: opts?.method ?? 'GET', headers }
  if (init.method !== 'GET' && opts?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }
  const res = await fetch(`${base}${path}`, init)
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, ok: res.ok, data }
}

// deno-lint-ignore no-explicit-any
function values(r: ItResult): any[] {
  const d = r.data
  if (Array.isArray(d)) return d
  return d?.values ?? []
}

type Site = { number: number; name: string; locationIid?: number; organizationIid?: number }

// Pull Issuetrak Locations + Organizations and index the "Mighty Wash #NN"
// entries by site number. siteKind indicates where tickets carry the site.
async function siteDirectory(base: string, apiKey: string) {
  const [locs, orgs] = await Promise.all([
    itFetch(base, apiKey, '/Locations?PageSize=100').catch(() => null),
    itFetch(base, apiKey, '/Organizations?PageSize=100').catch(() => null),
  ])
  const map = new Map<number, Site>()
  for (const l of locs && locs.ok ? values(locs) : []) {
    const n = siteNumberFromName(l.name)
    if (n == null) continue
    const e = map.get(n) ?? { number: n, name: l.name }
    e.locationIid = l.iid
    map.set(n, e)
  }
  for (const o of orgs && orgs.ok ? values(orgs) : []) {
    const n = siteNumberFromName(o.name)
    if (n == null) continue
    const e = map.get(n) ?? { number: n, name: o.name }
    e.organizationIid = o.iid
    if (!e.name) e.name = o.name
    map.set(n, e)
  }
  const anyLocation = [...map.values()].some((e) => e.locationIid != null)
  const siteKind: 'location' | 'organization' = anyLocation ? 'location' : 'organization'
  return { map, siteKind }
}

// The site number of a ticket, from whichever reference carries it.
function ticketSiteNumber(issue: any): number | null {
  return siteNumberFromName(issue?.location?.name) ?? siteNumberFromName(issue?.organization?.name)
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const rawKey = Deno.env.get('ISSUETRAK_API_KEY')
  if (!rawKey) return json({ error: 'no_key', message: 'Issuetrak is not connected yet.' }, 503, origin)
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '')
  const base = (Deno.env.get('ISSUETRAK_BASE_URL') ?? DEFAULT_BASE).replace(/\/$/, '')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: owner/manager/technician in the Mighty Wash account.
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
  const { data: p } = await svc
    .from('users')
    .select('role, account_id, location_ids')
    .eq('id', u.user.id)
    .single()
  if (!p) return json({ error: 'forbidden' }, 403, origin)
  if (p.account_id !== MIGHTY_WASH_ACCOUNT) {
    return json({ error: 'forbidden', message: 'Issuetrak is available for Mighty Wash only.' }, 403, origin)
  }
  const role = p.role as string
  const isAdmin = role === 'owner' || role === 'technician'
  if (!isAdmin && role !== 'manager') {
    return json({ error: 'forbidden', message: 'Issuetrak is not available for your role.' }, 403, origin)
  }

  let body: { action?: string; [k: string]: unknown } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const action = body.action ?? ''

  // Site numbers a manager is scoped to (from their Operator locations).
  async function allowedSiteNumbers(): Promise<number[]> {
    const ids = (p.location_ids as string[] | null) ?? []
    if (ids.length === 0) return []
    const { data: locs } = await svc.from('locations').select('name').in('id', ids)
    const nums = new Set<number>()
    for (const l of locs ?? []) {
      const n = siteNumberFromName((l as { name: string }).name)
      if (n != null) nums.add(n)
    }
    return [...nums]
  }

  try {
    // --- diag: token-shape + live auth test + site directory (temporary) ---
    if (action === 'diag') {
      const [test, locs, orgs, types, prios, issues] = await Promise.all([
        itFetch(base, apiKey, '/Authenticate/test'),
        itFetch(base, apiKey, '/Locations?PageSize=100').catch(() => null),
        itFetch(base, apiKey, '/Organizations?PageSize=100').catch(() => null),
        itFetch(base, apiKey, '/IssueTypes?PageSize=100').catch(() => null),
        itFetch(base, apiKey, '/Priorities?PageSize=100').catch(() => null),
        itFetch(base, apiKey, '/Issues/Search', {
          method: 'POST',
          body: { pageNumber: 1, pageSize: 5, filter: { isOpen: { type: 'IsTrue' } } },
        }).catch(() => null),
      ])
      const { map, siteKind } = await siteDirectory(base, apiKey).catch(() => ({ map: new Map(), siteKind: 'location' as const }))
      const allowed = isAdmin ? null : await allowedSiteNumbers()
      // Site names carried on actual tickets (a fallback source when the
      // Locations/Organizations lists are permission-blocked).
      const ticketSites = (issues && issues.ok ? values(issues) : [])
        .flatMap((i) => [i?.location?.name, i?.organization?.name])
        .filter(Boolean)
      return json(
        {
          ok: true,
          cleanLen: apiKey.length,
          prefix: apiKey.slice(0, 3),
          suffix: apiKey.slice(-3),
          role,
          isAdmin,
          statuses: {
            authTest: test.status,
            locations: locs?.status ?? null,
            organizations: orgs?.status ?? null,
            issueTypes: types?.status ?? null,
            priorities: prios?.status ?? null,
            issuesSearch: issues?.status ?? null,
          },
          openIssuesTotal: issues?.data?.pagingInformation?.itemTotal ?? null,
          ticketSiteNamesSample: [...new Set(ticketSites)].slice(0, 20),
          locationNamesSample: (locs && locs.ok ? values(locs) : []).slice(0, 40).map((l) => l.name),
          organizationNamesSample: (orgs && orgs.ok ? values(orgs) : []).slice(0, 40).map((o) => o.name),
          issueTypeNames: (types && types.ok ? values(types) : []).map((t) => t.name),
          siteKind,
          matchedSites: [...map.values()].sort((a, b) => a.number - b.number),
          allowedSiteNumbers: allowed,
        },
        200,
        origin,
      )
    }

    // --- bootstrap: everything the page needs to render --------------------
    if (action === 'bootstrap') {
      const { map, siteKind } = await siteDirectory(base, apiKey)
      let sites = [...map.values()].sort((a, b) => a.number - b.number)
      if (!isAdmin) {
        const allowed = new Set(await allowedSiteNumbers())
        sites = sites.filter((s) => allowed.has(s.number))
      }
      const [types, prios] = await Promise.all([
        itFetch(base, apiKey, '/IssueTypes?PageSize=100'),
        itFetch(base, apiKey, '/Priorities?PageSize=100'),
      ])
      return json(
        {
          ok: true,
          isAdmin,
          role,
          siteKind,
          sites,
          issueTypes: values(types).map((t) => ({ iid: t.iid, name: t.name })),
          priorities: values(prios).map((p2) => ({ iid: p2.iid, name: p2.name })),
        },
        200,
        origin,
      )
    }

    // --- list: open tickets, scoped ---------------------------------------
    if (action === 'list') {
      // deno-lint-ignore no-explicit-any
      const filter: Record<string, any> = { isOpen: { type: 'IsTrue' } }
      if (!isAdmin) {
        const allowed = await allowedSiteNumbers()
        if (allowed.length === 0) return json({ ok: true, issues: [], total: 0 }, 200, origin)
        const { map, siteKind } = await siteDirectory(base, apiKey)
        const iids = allowed
          .map((n) => map.get(n))
          .filter(Boolean)
          .map((s) => (siteKind === 'location' ? s!.locationIid : s!.organizationIid))
          .filter((x): x is number => typeof x === 'number')
        if (iids.length === 0) return json({ ok: true, issues: [], total: 0 }, 200, origin)
        filter[siteKind] = { iid: { type: 'MatchAny', values: iids } }
      }

      const collected: any[] = [] // deno-lint-ignore-line no-explicit-any
      let itemTotal = 0
      for (let page = 1; page <= MAX_ADMIN_PAGES; page++) {
        const r = await itFetch(base, apiKey, '/Issues/Search', {
          method: 'POST',
          body: {
            sortField: 'EnteredDate',
            sortDirection: 'Desc',
            pageNumber: page,
            pageSize: 100,
            filter,
          },
        })
        if (!r.ok) return json({ ok: false, status: r.status, data: r.data }, 200, origin)
        const vals = values(r)
        collected.push(...vals)
        itemTotal = r.data?.pagingInformation?.itemTotal ?? collected.length
        if (collected.length >= itemTotal || vals.length < 100) break
      }
      return json({ ok: true, issues: collected, total: itemTotal }, 200, origin)
    }

    // --- get: one ticket (scope-checked) ----------------------------------
    if (action === 'get') {
      const iid = Number(body.iid)
      if (!iid) return json({ error: 'bad_request', message: 'iid required' }, 400, origin)
      const r = await itFetch(base, apiKey, `/Issues/${iid}`)
      if (!r.ok) return json({ ok: false, status: r.status, data: r.data }, 200, origin)
      if (!isAdmin) {
        const allowed = new Set(await allowedSiteNumbers())
        const n = ticketSiteNumber(r.data)
        if (n == null || !allowed.has(n)) return json({ error: 'not_found' }, 404, origin)
      }
      return json({ ok: true, issue: r.data }, 200, origin)
    }

    // --- create: submit a ticket tagged to a site -------------------------
    if (action === 'create') {
      const subject = String(body.subject ?? '').trim()
      const description = String(body.description ?? '').trim()
      const issueTypeIid = Number(body.issueTypeIid)
      if (!subject || !description || !issueTypeIid) {
        return json({ error: 'bad_request', message: 'subject, description, and issue type are required' }, 400, origin)
      }
      // Site is OPTIONAL: it lets us tag the ticket to a Location/Organization,
      // but Issuetrak does not require one to create an issue, and the token may
      // not be able to read the site directory. A ticket still posts without it.
      const siteNumber = body.siteNumber ? Number(body.siteNumber) : null

      // deno-lint-ignore no-explicit-any
      const payload: Record<string, any> = { subject, description, issueTypeIid }
      if (body.priorityIid) payload.priorityIid = Number(body.priorityIid)

      if (siteNumber) {
        if (!isAdmin) {
          const allowed = new Set(await allowedSiteNumbers())
          if (!allowed.has(siteNumber)) return json({ error: 'forbidden', message: 'That site is outside your scope.' }, 403, origin)
        }
        const { map } = await siteDirectory(base, apiKey)
        const site = map.get(siteNumber)
        if (site?.locationIid != null) payload.locationIid = site.locationIid
        if (site?.organizationIid != null) payload.organizationIid = site.organizationIid
      }

      const r = await itFetch(base, apiKey, '/Issues/Create', { method: 'POST', body: payload })
      if (!r.ok) return json({ ok: false, status: r.status, data: r.data }, 200, origin)
      return json({ ok: true, issue: r.data }, 200, origin)
    }

    return json({ error: 'bad_request', message: `unknown action ${action}` }, 400, origin)
  } catch (e) {
    return json({ error: 'upstream_error', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
