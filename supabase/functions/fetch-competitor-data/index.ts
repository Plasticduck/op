// fetch-competitor-data — Supabase Edge Function (Deno).
// Scrapes a competitor's public URLs (website + social), records each fetch
// attempt in competitor_snapshots, then asks Claude for 1 to 4 short, specific
// suggestions and inserts them into competitor_suggestions.
//
// Invocation modes (POST JSON body):
//   { competitor_id: string }   single-competitor scan, triggered from the UI
//   { scan_all: true }          daily-cron path, scans every competitor in
//                               every account whose last_scanned_at is null or
//                               older than 23h ago (soft cap 50 per run)
//
// Auth:
//   - competitor_id path: requires an authenticated owner or manager whose
//     account_id matches the competitor's account_id.
//   - scan_all path: requires EITHER an Authorization: Bearer <service-role-key>
//     header OR an x-cron-secret header matching env CRON_SECRET. If neither is
//     present (or CRON_SECRET is unset and no service-role JWT is sent), the
//     request is denied.
//
// Secrets required (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY   — Claude API key (returns 503 'no_key' if absent)
//   CRON_SECRET         — optional shared secret for the scan_all path
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'
const SCAN_ALL_CAP = 50
const STALE_MS = 23 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const SOURCES = ['website', 'facebook', 'instagram', 'x'] as const
type Source = (typeof SOURCES)[number]

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
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

const SYSTEM_PROMPT = `You are a competitive analyst for car wash businesses. Compare this competitor's harvested data to the operator's wash and return 1 to 4 short, specific, actionable suggestions. Return ONLY a JSON array: [{"severity": "info"|"warning"|"critical", "text": "..."}]. Use critical only for genuine threats (pricing race, new location nearby). Use warning for noticeable trends. Never fabricate numbers not in the data.`

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'no_key', message: 'ANTHROPIC_API_KEY is not configured.' }, 503, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: { competitor_id?: string; scan_all?: boolean; scan_account?: boolean } = {}
  try { body = await req.json() } catch { /* allow empty */ }

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const anthropic = new Anthropic({ apiKey })

  // Cron / service-role path: scan every competitor across all accounts where
  // last_scanned_at is null or older than 23h. Capped per invocation.
  if (body.scan_all) {
    const authHeader = req.headers.get('Authorization') ?? ''
    const cronSecretHeader = req.headers.get('x-cron-secret')
    const cronSecret = Deno.env.get('CRON_SECRET')
    const hasServiceJwt = authHeader === `Bearer ${serviceKey}`
    const hasCronSecret = !!cronSecret && cronSecretHeader === cronSecret
    if (!hasServiceJwt && !hasCronSecret) {
      return json({ error: 'unauthorized' }, 401, origin)
    }

    const cutoff = new Date(Date.now() - STALE_MS).toISOString()
    const { data: stale, error: staleErr } = await svc
      .from('competitors')
      .select('id, account_id, name, website_url, facebook_url, instagram_url, x_url, last_scanned_at')
      .or(`last_scanned_at.is.null,last_scanned_at.lt.${cutoff}`)
      .order('last_scanned_at', { ascending: true, nullsFirst: true })
      .limit(SCAN_ALL_CAP)
    if (staleErr) return json({ error: 'internal', message: staleErr.message }, 500, origin)

    const seen = new Set<string>()
    let scanned = 0
    let suggestions = 0
    for (const c of stale ?? []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      const result = await scanCompetitor(svc, anthropic, c)
      scanned += 1
      suggestions += result.suggestions
    }
    return json({ ok: true, scanned, suggestions }, 200, origin)
  }

  // Everything below requires a manager+ JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData } = await userClient.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401, origin)

  const { data: profile } = await svc
    .from('users')
    .select('account_id, role')
    .eq('id', uid)
    .single()
  if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }

  // Force-scan path: re-scan every competitor in the caller's account
  // regardless of last_scanned_at. Driven by the "Force scan all" button.
  if (body.scan_account) {
    const { data: list, error: listErr } = await svc
      .from('competitors')
      .select('id, account_id, name, website_url, facebook_url, instagram_url, x_url, last_scanned_at')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: true })
      .limit(SCAN_ALL_CAP)
    if (listErr) return json({ error: 'internal', message: listErr.message }, 500, origin)

    let scanned = 0
    let suggestions = 0
    for (const c of list ?? []) {
      const result = await scanCompetitor(svc, anthropic, c)
      scanned += 1
      suggestions += result.suggestions
    }
    return json({ ok: true, scanned, suggestions }, 200, origin)
  }

  if (!body.competitor_id || typeof body.competitor_id !== 'string') {
    return json({ error: 'bad_request' }, 400, origin)
  }

  const { data: competitor, error: cErr } = await svc
    .from('competitors')
    .select('id, account_id, name, website_url, facebook_url, instagram_url, x_url, last_scanned_at')
    .eq('id', body.competitor_id)
    .maybeSingle()
  if (cErr) return json({ error: 'internal', message: cErr.message }, 500, origin)
  if (!competitor) return json({ error: 'not_found' }, 404, origin)
  if (competitor.account_id !== profile.account_id) {
    return json({ error: 'forbidden' }, 403, origin)
  }

  const result = await scanCompetitor(svc, anthropic, competitor)
  return json(
    { ok: true, competitor_id: competitor.id, snapshots: result.snapshots, suggestions: result.suggestions },
    200,
    origin,
  )
})

// deno-lint-ignore no-explicit-any
type DB = any

type CompetitorRow = {
  id: string
  account_id: string
  name: string
  website_url: string | null
  facebook_url: string | null
  instagram_url: string | null
  x_url: string | null
  last_scanned_at: string | null
}

type SourceResult =
  | { status: 'ok'; data: Record<string, unknown> }
  | { status: 'no_url' }
  | { status: 'blocked'; error_message: string }

async function scanCompetitor(
  svc: DB,
  anthropic: Anthropic,
  competitor: CompetitorRow,
): Promise<{ snapshots: number; suggestions: number }> {
  const urls: Record<Source, string | null> = {
    website: competitor.website_url,
    facebook: competitor.facebook_url,
    instagram: competitor.instagram_url,
    x: competitor.x_url,
  }

  const sourceResults: Partial<Record<Source, SourceResult>> = {}
  for (const source of SOURCES) {
    const target = urls[source]
    let result: SourceResult
    if (!target || target.trim() === '') {
      result = { status: 'no_url' }
    } else {
      try {
        result = await fetchAndExtract(target.trim())
      } catch (e) {
        result = { status: 'blocked', error_message: errMsg(e) }
      }
    }
    sourceResults[source] = result

    const insert: Record<string, unknown> = {
      competitor_id: competitor.id,
      source,
      status: result.status,
    }
    if (result.status === 'ok') insert.data = result.data
    if (result.status === 'blocked') insert.error_message = result.error_message
    try {
      await svc.from('competitor_snapshots').insert(insert)
    } catch {
      // snapshot insert failure should not abort other sources
    }
  }

  const { data: account } = await svc
    .from('accounts')
    .select('name')
    .eq('id', competitor.account_id)
    .maybeSingle()
  const { count: siteCount } = await svc
    .from('locations')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', competitor.account_id)
    .eq('archived', false)

  const bundle = {
    competitor_name: competitor.name,
    urls,
    snapshots: Object.fromEntries(
      SOURCES.map((s) => {
        const r = sourceResults[s]!
        if (r.status === 'ok') return [s, r.data]
        if (r.status === 'blocked') return [s, { status: 'blocked', error: r.error_message }]
        return [s, { status: 'no_url' }]
      }),
    ),
  }
  const accountContext = {
    wash_brand: account?.name ?? '',
    site_count: siteCount ?? 0,
  }

  let suggestionsInserted = 0
  try {
    const suggestions = await askClaude(anthropic, competitor.name, accountContext, bundle)
    for (const s of suggestions) {
      if (!s || typeof s.text !== 'string' || !s.text.trim()) continue
      const severity = s.severity === 'critical' || s.severity === 'warning' ? s.severity : 'info'
      const { error } = await svc.from('competitor_suggestions').insert({
        account_id: competitor.account_id,
        competitor_id: competitor.id,
        severity,
        suggestion_text: s.text.trim(),
        model: MODEL,
      })
      if (!error) suggestionsInserted += 1
    }
  } catch {
    // Claude failure should not block the snapshot write or last_scanned_at bump.
  }

  await svc
    .from('competitors')
    .update({ last_scanned_at: new Date().toISOString() })
    .eq('id', competitor.id)

  return { snapshots: SOURCES.length, suggestions: suggestionsInserted }
}

async function fetchAndExtract(target: string): Promise<SourceResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'WashLyfeCompetitorBot/1.0 (+https://operator.washlyfe.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    })
    if (!res.ok) {
      return { status: 'blocked', error_message: `HTTP ${res.status}` }
    }
    const contentType = res.headers.get('content-type') ?? ''
    if (!/html/i.test(contentType)) {
      return { status: 'blocked', error_message: `non-html content-type: ${contentType || 'unknown'}` }
    }
    const html = await res.text()
    const extracted = extractFromHtml(html)
    return {
      status: 'ok',
      data: { ...extracted, fetched_url: res.url || target },
    }
  } finally {
    clearTimeout(timer)
  }
}

function extractFromHtml(html: string) {
  const title = matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const description = metaContent(html, 'name', 'description')
  const ogTitle = metaContent(html, 'property', 'og:title')
  const ogDescription = metaContent(html, 'property', 'og:description')
  const ogImage = metaContent(html, 'property', 'og:image')

  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()

  return {
    title: title ? decodeBasic(title.trim()) : null,
    description,
    og_title: ogTitle,
    og_description: ogDescription,
    og_image: ogImage,
    text_excerpt: stripped.slice(0, 5000),
  }
}

function metaContent(html: string, attr: 'name' | 'property', key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${escaped}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) return decodeBasic(m[1].trim())
  }
  return null
}

function matchFirst(s: string, re: RegExp): string | null {
  const m = s.match(re)
  return m ? m[1] : null
}

function decodeBasic(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

async function askClaude(
  anthropic: Anthropic,
  competitorName: string,
  accountContext: { wash_brand: string; site_count: number },
  bundle: unknown,
): Promise<{ severity?: string; text: string }[]> {
  const userText =
    `Competitor: ${competitorName} (operator: ${accountContext.wash_brand}, ${accountContext.site_count} sites).\n\n` +
    `HARVEST:\n${JSON.stringify(bundle)}`
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
  })
  const block = message.content.find((b) => b.type === 'text')
  const raw = block && 'text' in block ? block.text : '[]'
  return parseSuggestions(raw)
}

function parseSuggestions(raw: string): { severity?: string; text: string }[] {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) {
      return parsed.filter((x) => x && typeof x.text === 'string')
    }
  } catch {
    // fall through
  }
  return []
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.name === 'AbortError' ? 'timeout' : e.message
  return String(e)
}
