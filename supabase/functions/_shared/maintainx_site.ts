// A site's work orders still open in MaintainX (Open, In Progress, On Hold), read
// live from the MaintainX API. Used by site-work-orders (the audit form's list)
// and site-audit-new-notify (the list saved on a submitted audit for its PDF).
//
// Site matching: the site's locations.maintainx_id (backfilled by the 2026-07
// import), else the MaintainX location named "#NN - City" for MWNN (Spotless by
// name), plus every location under it. Locations, users and teams are cached for
// 10 minutes per worker. Needs MAINTAINX_API_TOKEN; MAINTAINX_BASE_URL optional.

// deno-lint-ignore no-explicit-any
type Any = any

export type SiteWorkOrder = {
  id: number
  number: number | null
  title: string
  status: string
  priority: string
  type: string | null
  createdAt: string | null
  dueDate: string | null
  asset: string | null
  location: string | null
  assignees: string[]
  categories: string[]
}

export type SiteWorkOrders = {
  site: string
  // False when the site has no location in MaintainX.
  matched: boolean
  locations: string[]
  workOrders: SiteWorkOrder[]
  fetchedAt: string
}

const DEFAULT_BASE = 'https://api.getmaintainx.com/v1'
const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD']
const PRIORITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 }
const CACHE_MS = 10 * 60 * 1000

export function maintainxToken(): string | null {
  return Deno.env.get('MAINTAINX_API_TOKEN') ?? Deno.env.get('MAINTAINX_API_KEY') ?? null
}

async function mxGetAll(base: string, token: string, path: string, key: string, maxPages = 20): Promise<Any[]> {
  const out: Any[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const url: string = `${base}${path}${path.includes('?') ? '&' : '?'}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`MaintainX ${path.split('?')[0]} ${res.status}`)
    const d: Any = await res.json()
    out.push(...((d?.[key] ?? []) as Any[]))
    cursor = d?.nextCursor ?? null
    pages++
  } while (cursor && pages < maxPages)
  return out
}

type Lookups = { at: number; locations: Map<number, { id: number; name: string; parentId: number | null }>; users: Map<number, string>; teams: Map<number, string> }
let cache: Lookups | null = null

async function lookups(base: string, token: string): Promise<Lookups> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache
  const [locs, users, teams] = await Promise.all([
    mxGetAll(base, token, '/locations', 'locations'),
    mxGetAll(base, token, '/users', 'users').catch(() => []),
    mxGetAll(base, token, '/teams', 'teams').catch(() => []),
  ])
  cache = {
    at: Date.now(),
    locations: new Map(locs.map((l) => [Number(l.id), { id: Number(l.id), name: String(l.name ?? ''), parentId: l.parentId != null ? Number(l.parentId) : null }])),
    users: new Map(users.map((u) => [Number(u.id), [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || 'Someone'])),
    teams: new Map(teams.map((t) => [Number(t.id), String(t.name ?? 'A team')])),
  }
  return cache
}

function siteLocations(site: { name: string; maintainx_id: number | null }, locs: Lookups['locations']): number[] {
  const roots = new Set<number>()
  if (site.maintainx_id && locs.has(Number(site.maintainx_id))) roots.add(Number(site.maintainx_id))
  if (!roots.size) {
    const num = site.name.match(/^MW\s*0*(\d+)$/i)?.[1]
    for (const l of locs.values()) {
      if (num && new RegExp(`^#\\s*0*${num}(?!\\d)`).test(l.name.trim())) roots.add(l.id)
      if (!num && site.name.trim() && l.name.toLowerCase().includes(site.name.trim().toLowerCase())) roots.add(l.id)
    }
  }
  const all = new Set(roots)
  // Children, however deep (bounded so a bad parent loop can't spin).
  for (let pass = 0; pass < 6; pass++) {
    let added = false
    for (const l of locs.values()) if (l.parentId != null && all.has(l.parentId) && !all.has(l.id)) { all.add(l.id); added = true }
    if (!added) break
  }
  return [...all]
}

// Throws when MaintainX can't be reached or the token is missing.
export async function openWorkOrdersForSite(site: { name: string; maintainx_id: number | null }): Promise<SiteWorkOrders> {
  const token = maintainxToken()
  if (!token) throw new Error('MaintainX is not connected')
  const base = (Deno.env.get('MAINTAINX_BASE_URL') ?? DEFAULT_BASE).replace(/\/$/, '')
  const lk = await lookups(base, token)
  const mxIds = siteLocations(site, lk.locations)
  const fetchedAt = new Date().toISOString()
  if (!mxIds.length) return { site: site.name, matched: false, locations: [], workOrders: [], fetchedAt }
  const q = [
    ...mxIds.map((id) => `locations=${id}`),
    ...OPEN_STATUSES.map((st) => `statuses=${st}`),
    'expand=asset', 'expand=assignees', 'expand=categories',
  ].join('&')
  const wos = await mxGetAll(base, token, `/workorders?${q}`, 'workOrders', 5)
  const workOrders: SiteWorkOrder[] = wos
    .filter((w) => OPEN_STATUSES.includes(w.status) && !w.deletedAt)
    .map((w) => ({
      id: w.id,
      number: w.sequentialId ?? null,
      title: String(w.title ?? 'Untitled'),
      status: w.status,
      priority: w.priority ?? 'NONE',
      type: w.type ?? null,
      createdAt: w.createdAt ?? null,
      dueDate: w.dueDate ?? null,
      asset: w.asset?.name ?? null,
      location: lk.locations.get(Number(w.locationId))?.name ?? null,
      assignees: ((w.assignees ?? []) as Any[])
        .map((a) => (a.type === 'TEAM' ? lk.teams.get(Number(a.id)) : lk.users.get(Number(a.id))) ?? null)
        .filter((x): x is string => !!x),
      categories: ((w.categories ?? []) as Any[]).map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean),
    }))
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || String(a.createdAt).localeCompare(String(b.createdAt)))
  return { site: site.name, matched: true, locations: mxIds.map((id) => lk.locations.get(id)?.name ?? '').filter(Boolean), workOrders, fetchedAt }
}
