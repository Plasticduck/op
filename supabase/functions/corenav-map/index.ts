// corenav-map — Supabase Edge Function (Deno).
// Data for Operations - Admin > CoreNav Map, drawn on Operator's own map. It
// reads CoreNav through the person's own CoreNav connection (Operator AI >
// Connections; tokens in Vault, see _shared/connect.ts), with CoreNav's MCP
// tools: describe, map_config, query and record. Read-only.
//
// Body { action, universe? }:
//   setup     -> { universes, universe, config, labels }  CoreNav's map setup
//                (map_config) for the universe asked for, else the one with a saved
//                map, else the default; labels are CoreNav's column labels.
//   points    -> { columns, rows, truncated }  The map's points: CoreNav's points SQL,
//                paged through its query tool (5,000 rows a page).
//   site { site_id, entity_id } -> { tabs }  One site's sidebar, built from CoreNav's
//                own sidebar setup: field lists, the site scorecard, tables (people),
//                monthly series and the typical-week traffic grid.
//   areas { site_id } -> { areas }  That site's drive-time areas and mile rings
//                (CoreNav's `areas` table, GeoJSON), for the map and its competitors.
//   layer { kind: 'shape' | 'overlay', id, bbox?: { w, s, e, n } } -> { columns, rows,
//                truncated }  One demand shading (map_config.shapes) or road/places
//                overlay (map_config.overlays), run with CoreNav's own SQL and limited
//                to the area on screen (bbox) where the table has bounds columns.
//   record { entity_id } -> { record }  One company in full.
//   describe, query (service role only, for checks).
//
// Auth: a signed-in person on the Mighty Wash account, not the shared office
// login; their CoreNav login decides what they can see. The service role may
// pass { as_user } (tests and checks only; it can already read the tokens).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { CONNECT_ACCOUNT, PROVIDERS, ReconnectNeeded, openSession } from '../_shared/connect.ts'
import type { McpSession } from '../_shared/mcp.ts'

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
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

// deno-lint-ignore no-explicit-any
type Json = any
const MAX_POINTS = 25_000
const MAX_PAGES = 8

// A CoreNav tool's answer as JSON (its text is JSON; errors come back as text).
async function tool(s: McpSession, name: string, args: Record<string, unknown>): Promise<Json> {
  const r = await s.callByName(name, args, 8_000_000)
  if (r.isError) throw new Error(r.text.slice(0, 500) || `CoreNav ${name} failed.`)
  try { return JSON.parse(r.text) } catch { return { text: r.text } }
}

// SQL pieces. Table and column names come from CoreNav's own map setup; they are
// still checked to be plain names. Values are quoted.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const ident = (s: unknown): string => {
  const v = String(s ?? '')
  if (!NAME.test(v)) throw new Error(`Unexpected name in CoreNav's map setup: ${v.slice(0, 40)}`)
  return `"${v}"`
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

// Run tasks a few at a time (one MCP connection; be kind to CoreNav).
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

type Section = Json
// One sidebar section for one site, from CoreNav's sidebar setup.
async function siteSection(s: McpSession, u: Record<string, unknown>, sec: Section, siteTables: Set<string>, siteId: string, entityId: string) {
  const title: string | null = sec.title ?? null
  try {
    const table = String(sec.table ?? '')
    const from = table === '' ? 'universe_wide' : ident(table)
    const where = table === '' ? `id = ${lit(entityId)}`
      : siteTables.has(table) ? `site_id = ${lit(siteId)}` : `entity_id = ${lit(entityId)}`
    const run = async (cols: string[], tail = 'limit 1') => {
      const r = await tool(s, 'query', { ...u, sql: `select ${cols.map(ident).join(', ')} from ${from} where ${where} ${tail}` })
      return { columns: (r.columns ?? []) as string[], rows: (r.rows ?? []) as unknown[][] }
    }
    const one = (res: { columns: string[]; rows: unknown[][] }) =>
      res.rows[0] ? Object.fromEntries(res.columns.map((c, i) => [c, res.rows[0][i]])) : null

    if (sec.view === 'scorecard') {
      const factors: string[] = (sec.factors ?? []).filter((f: string) => NAME.test(f))
      const cols = [sec.score, sec.max, sec.raw].filter(Boolean).concat(factors.flatMap((f) => [`${f}_pts`, `${f}_basis`]))
      const row = one(await run(cols))
      if (!row) return { kind: 'empty', title }
      return {
        kind: 'scorecard', title,
        score: row[sec.score] ?? null, max: sec.max ? row[sec.max] ?? null : null, raw: sec.raw ? row[sec.raw] ?? null : null,
        factors: factors.map((f) => ({ id: f, pts: row[`${f}_pts`] ?? null, basis: row[`${f}_basis`] ?? null })),
      }
    }
    // Dates are sometimes text ("10/31/2024"); sort on the real date.
    const sortKey = (col: string) => /date|_at$|^month$/i.test(col)
      ? `coalesce(try_cast(${ident(col)} as date), try_strptime(cast(${ident(col)} as varchar), '%m/%d/%Y')::date)`
      : ident(col)
    // "sort": a column, "-column" for newest/largest first.
    const order = (sort: unknown) => {
      const v = String(sort ?? '')
      if (!v) return ''
      return v.startsWith('-') ? `order by ${sortKey(v.slice(1))} desc nulls last` : `order by ${sortKey(v)} nulls last`
    }
    if (sec.view === 'table') {
      const res = await run(sec.columns ?? [], `${order(sec.sort)} limit 25`)
      return res.rows.length ? { kind: 'table', title, columns: res.columns, rows: res.rows } : { kind: 'empty', title }
    }
    if (sec.view === 'timeline') {
      const cols = [sec.date, sec.headline, sec.detail, sec.url].filter(Boolean)
      const res = await run(cols, `order by ${sortKey(String(sec.date))} desc nulls last limit 40`)
      const at = (row: unknown[], c: unknown) => (c ? row[res.columns.indexOf(String(c))] ?? null : null)
      return res.rows.length
        ? { kind: 'timeline', title, rows: res.rows.map((r) => ({ date: at(r, sec.date), headline: at(r, sec.headline), detail: at(r, sec.detail), url: at(r, sec.url) })) }
        : { kind: 'empty', title }
    }
    if (sec.view === 'series') {
      const cols = [sec.x, sec.bars, sec.line].filter(Boolean)
      const res = await run(cols, `order by ${ident(sec.x)} limit 120`)
      return res.rows.length ? { kind: 'series', title, x: sec.x, bars: sec.bars ?? null, line: sec.line ?? null, columns: res.columns, rows: res.rows } : { kind: 'empty', title }
    }
    if (sec.view === 'week') {
      // Summed over directions: one value per day and hour.
      const r = await tool(s, 'query', {
        ...u,
        sql: `select ${ident(sec.day)} as day, ${ident(sec.hour)} as hour, sum(${ident(sec.value)}) as value from ${from} where ${where} group by 1, 2 order by 1, 2`,
      })
      return (r.rows ?? []).length ? { kind: 'week', title, rows: r.rows } : { kind: 'empty', title }
    }
    if (Array.isArray(sec.fields) && sec.fields.length) {
      const row = one(await run(sec.fields))
      return row ? { kind: 'fields', title, table, values: row } : { kind: 'empty', title }
    }
    return { kind: 'unsupported', title, view: sec.view ?? null }
  } catch (e) {
    return { kind: 'error', title, message: e instanceof Error ? e.message.slice(0, 300) : String(e) }
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: {
    action?: string; universe?: string | null; sql?: string; site_id?: string; entity_id?: string
    table?: string; cursor?: string; as_user?: string
    kind?: string; id?: string; bbox?: { w?: number; s?: number; e?: number; n?: number }
  } = {}
  try { body = await req.json() } catch { /* empty */ }

  const authHeader = req.headers.get('Authorization') ?? ''
  let uid: string
  const asService = jwtRole(authHeader) === 'service_role'
  if (asService) {
    if (!body.as_user) return json({ error: 'bad_request', message: 'as_user is required for the service role.' }, 400, origin)
    uid = body.as_user
  } else {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await userClient.auth.getUser()
    if (!u.user) return json({ error: 'unauthorized' }, 401, origin)
    uid = u.user.id
    const { data: profile } = await svc.from('users').select('account_id, role_category').eq('id', uid).single()
    if (!profile || profile.account_id !== CONNECT_ACCOUNT || profile.role_category === 'corporate_display') {
      return json({ error: 'not_available', message: 'CoreNav is not available on this login.' }, 403, origin)
    }
  }

  let session: McpSession | null = null
  try {
    session = await openSession(svc, uid, PROVIDERS.corenav)
    if (!session) return json({ error: 'not_connected', message: 'Connect CoreNav first.' }, 409, origin)
    const universe = body.universe ?? null
    const u = universe ? { universe } : {}

    if (body.action === 'setup') {
      const catalog = await tool(session, 'describe', {})
      const universes: { universe: string; label: string; default: boolean; saved: boolean }[] =
        (catalog.universes ?? []).map((x: Json) => ({ universe: String(x.universe), label: String(x.label ?? x.universe), default: !!x.default, saved: false }))
      const s = session
      const configs = await Promise.all(universes.map((x) => tool(s, 'map_config', { universe: x.universe }).catch(() => null)))
      universes.forEach((x, i) => { x.saved = configs[i]?.source === 'saved' })
      const pick = (universe && universes.find((x) => x.universe === universe))
        ?? universes.find((x) => x.saved) ?? universes.find((x) => x.default) ?? universes[0]
      if (!pick) return json({ error: 'no_universe', message: 'Your CoreNav workspace has nothing to map.' }, 422, origin)
      const config = configs[universes.indexOf(pick)]?.config ?? null
      // CoreNav's column labels (relation.name -> label), for the sidebar.
      const labels: Record<string, string> = {}
      try {
        const r = await tool(session, 'query', { universe: pick.universe, sql: 'select relation, name, label from columns' })
        for (const [rel, name, label] of (r.rows ?? []) as string[][]) if (label) labels[`${rel}.${name}`] = label
      } catch { /* labels are a nicety */ }
      return json({ universes, universe: pick.universe, config, labels }, 200, origin)
    }

    if (body.action === 'site') {
      const siteId = String(body.site_id ?? '')
      const entityId = String(body.entity_id ?? '')
      if (!siteId) return json({ error: 'bad_request', message: 'site_id is required.' }, 400, origin)
      const s = session
      const [cfg, keys] = await Promise.all([
        tool(s, 'map_config', u),
        tool(s, 'query', { ...u, sql: "select distinct table_name from information_schema.columns where column_name = 'site_id'" }),
      ])
      const siteTables = new Set<string>(((keys.rows ?? []) as string[][]).map((r) => r[0]))
      const sidebar: Json[] = cfg?.config?.sidebar ?? []
      const jobs = sidebar.flatMap((tab: Json, t: number) => (tab.sections ?? []).map((sec: Json, k: number) => ({ t, k, sec })))
      const done = await pool(jobs, 6, (j: Json) => siteSection(s, u, j.sec, siteTables, siteId, entityId))
      const tabs = sidebar.map((tab: Json, t: number) => ({
        tab: String(tab.tab ?? ''),
        sections: jobs.map((j: Json, i: number) => (j.t === t ? done[i] : null)).filter(Boolean),
      }))
      return json({ tabs }, 200, origin)
    }

    if (body.action === 'areas') {
      const siteId = String(body.site_id ?? '')
      if (!siteId) return json({ error: 'bad_request', message: 'site_id is required.' }, 400, origin)
      const cfg = await tool(session, 'map_config', u)
      const table = cfg?.config?.areas?.table ?? 'areas'
      const key = cfg?.config?.areas?.key ?? 'site_id'
      const r = await tool(session, 'query', {
        ...u,
        sql: `select kind, minutes, miles, geometry from ${ident(table)} where ${ident(key)} = ${lit(siteId)} and kind <> 'site_pin'`,
      })
      const areas = ((r.rows ?? []) as unknown[][]).map(([kind, minutes, miles, geometry]) => {
        let g: unknown = null
        try { g = typeof geometry === 'string' ? JSON.parse(geometry) : geometry } catch { /* skip a broken shape */ }
        return { kind, minutes, miles, geometry: g }
      }).filter((a) => a.geometry)
      return json({ areas }, 200, origin)
    }

    if (body.action === 'layer') {
      const cfg = (await tool(session, 'map_config', u))?.config ?? {}
      const list: Json[] = body.kind === 'shape' ? cfg.shapes ?? [] : body.kind === 'overlay' ? cfg.overlays ?? [] : []
      const def = list.find((x: Json) => x.id === body.id)
      if (!def?.sql) return json({ error: 'bad_request', message: 'Unknown layer.' }, 400, origin)
      const b = body.bbox ?? {}
      const box = [b.w, b.s, b.e, b.n].map(Number)
      const hasBox = box.every((x) => Number.isFinite(x)) && box[0] < box[2] && box[1] < box[3]
      const [w, s, e, n] = box.map((x) => Math.round(x * 1e5) / 1e5)
      let sql = String(def.sql)
      if (/\{[wsen]\}/.test(sql)) {
        // CoreNav's overlays name the screen's edges; they need a box.
        if (!hasBox) return json({ error: 'bad_request', message: 'This layer needs the map area.' }, 400, origin)
        sql = sql.replace(/\{w\}/g, String(w)).replace(/\{e\}/g, String(e)).replace(/\{s\}/g, String(s)).replace(/\{n\}/g, String(n))
      } else if (hasBox) {
        // A shading over a table with bounds columns: keep what's on screen.
        const m = sql.match(/^\s*select\s+[\s\S]+\s+from\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i)
        if (m) sql = `${sql} where max_lon >= ${w} and min_lon <= ${e} and max_lat >= ${s} and min_lat <= ${n}`
      }
      const cap = body.kind === 'shape' ? 15_000 : 20_000
      let columns: string[] | null = null
      const rows: unknown[] = []
      let cursor: string | undefined
      let truncated = false
      for (let page = 0; page < 5; page++) {
        const r = await tool(session, 'query', { ...u, sql, ...(cursor ? { cursor } : {}) })
        columns ??= r.columns ?? null
        rows.push(...(r.rows ?? []))
        cursor = r.next_cursor ?? undefined
        if (!cursor) break
        if (rows.length >= cap || page === 4) { truncated = true; break }
      }
      return json({ columns, rows, truncated }, 200, origin)
    }

    if (body.action === 'describe' && asService) {
      return json(await tool(session, 'describe', { ...u, ...(body.table ? { table: body.table } : {}) }), 200, origin)
    }

    if (body.action === 'query' && asService) {
      if (!body.sql) return json({ error: 'bad_request', message: 'sql is required.' }, 400, origin)
      return json(await tool(session, 'query', { ...u, sql: body.sql, ...(body.cursor ? { cursor: body.cursor } : {}) }), 200, origin)
    }

    if (body.action === 'record') {
      if (!body.entity_id) return json({ error: 'bad_request', message: 'entity_id is required.' }, 400, origin)
      return json({ record: await tool(session, 'record', { ...u, entity_id: String(body.entity_id) }) }, 200, origin)
    }

    if (body.action === 'points') {
      let sql = body.sql
      if (!sql) {
        const config = await tool(session, 'map_config', u)
        sql = config?.points?.sql ?? config?.config?.points?.sql
        if (!sql) return json({ error: 'no_points', message: "CoreNav's map setup has no points query." }, 422, origin)
      }
      let columns: string[] | null = null
      const rows: unknown[] = []
      let cursor: string | undefined
      let truncated = false
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await tool(session, 'query', { ...u, sql, ...(cursor ? { cursor } : {}) })
        columns ??= r.columns ?? null
        rows.push(...(r.rows ?? []))
        cursor = r.next_cursor ?? undefined
        if (!cursor) break
        if (rows.length >= MAX_POINTS) { truncated = true; break }
        if (page === MAX_PAGES - 1) truncated = true
      }
      return json({ columns, rows, truncated, sql }, 200, origin)
    }

    return json({ error: 'bad_request', message: 'Unknown action.' }, 400, origin)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return json({ error: e instanceof ReconnectNeeded ? 'reconnect' : 'failed', message }, e instanceof ReconnectNeeded ? 401 : 502, origin)
  } finally {
    await session?.close()
  }
})
