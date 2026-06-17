// analyze-market-deals — Supabase Edge Function (Deno).
// Compares a competitor market_research record (with its attached deals) to the
// operator's own sales/performance signals, asks Claude for 2-5 actionable
// counter-strategy moves, and persists them to market_research_suggestions.
//
// Secrets required (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY   — Claude API key (function returns 503 'no_key' if absent)
// Auto-provided by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

const SYSTEM_PROMPT = `You are a competitive strategy analyst for car wash businesses. Compare the competitor's observed deals to the operator's sales and performance signals, then propose 2 to 5 short, specific, actionable counter-strategy moves the operator can make this month. Use real numbers from the data when relevant. Return ONLY a JSON array, no markdown fences: [{"severity": "info"|"warning"|"critical", "text": "..."}]. Use critical only for a genuine pricing race or membership erosion threat.`

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return json({ error: 'no_key', message: 'ANTHROPIC_API_KEY is not configured.' }, 503, origin)
    }

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData } = await userClient.auth.getUser()
    const uid = userData.user?.id
    if (!uid) return json({ error: 'unauthorized' }, 401, origin)

    const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

    const { data: profile } = await svc
      .from('users')
      .select('account_id, role')
      .eq('id', uid)
      .single()
    if (!profile) return json({ error: 'unauthorized' }, 401, origin)
    if (profile.role !== 'owner' && profile.role !== 'manager') {
      return json({ error: 'forbidden' }, 403, origin)
    }
    const accountId = profile.account_id

    let body: { market_research_id?: string } = {}
    try { body = await req.json() } catch { /* allow empty */ }
    const researchId = body.market_research_id
    if (!researchId || typeof researchId !== 'string') {
      return json({ error: 'bad_request', message: 'market_research_id is required.' }, 400, origin)
    }

    const { data: research } = await svc
      .from('market_research')
      .select('*')
      .eq('id', researchId)
      .maybeSingle()
    if (!research) return json({ error: 'not_found' }, 404, origin)
    if (research.account_id !== accountId) return json({ error: 'forbidden' }, 403, origin)

    const { data: deals } = await svc
      .from('market_research_deals')
      .select('*')
      .eq('market_research_id', researchId)
      .order('created_at', { ascending: true })

    const accountContext = await buildAccountContext(svc, accountId)

    const researchOut: Record<string, unknown> = { ...research }
    if (typeof research.content === 'string') {
      const trimmed = research.content.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { researchOut.content = JSON.parse(trimmed) } catch { /* leave as string */ }
      }
    }

    const bundle = {
      research: researchOut,
      deals: deals ?? [],
      account_context: accountContext,
    }

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Generate counter-strategy. Bundle:\n${JSON.stringify(bundle)}`,
        },
      ],
    })

    const block = message.content.find((b) => b.type === 'text')
    const raw = block && 'text' in block ? block.text : '[]'
    const parsed = parseSuggestions(raw)

    const saved: unknown[] = []
    for (const s of parsed) {
      const severity = (s.severity === 'warning' || s.severity === 'critical') ? s.severity : 'info'
      const { data: row, error } = await svc
        .from('market_research_suggestions')
        .insert({
          account_id: accountId,
          market_research_id: researchId,
          severity,
          suggestion_text: s.text,
          model: MODEL,
        })
        .select()
        .single()
      if (!error && row) saved.push(row)
    }

    return json({ ok: true, generated: saved.length, suggestions: saved }, 200, origin)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return json({ error: 'internal', message }, 500, origin)
  }
})

// deno-lint-ignore no-explicit-any
type DB = any

async function buildAccountContext(svc: DB, accountId: string) {
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const since90 = new Date(Date.now() - 90 * 86400_000).toISOString()

  const { data: account } = await svc
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle()

  const { data: locs } = await svc
    .from('locations')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('archived', false)
  const locById = new Map<string, string>((locs ?? []).map((l: DB) => [l.id, l.name]))
  const locationIds = (locs ?? []).map((l: DB) => l.id)
  const locationCount = locationIds.length

  let recentCloseoutsSummary: Record<string, unknown> = { count: 0, sum_total_sales: 0, avg_total_sales: 0, top_locations: [] }
  if (locationIds.length > 0) {
    const { data: closeouts } = await svc
      .from('closeouts')
      .select('location_id, date, total_sales, cash_amount, card_amount, sales_data')
      .in('location_id', locationIds)
      .gte('date', since30)
      .order('date', { ascending: false })
    const rows = closeouts ?? []
    let sum = 0
    const byLoc = new Map<string, { sum: number; count: number }>()
    for (const r of rows) {
      const t = Number(r.total_sales ?? 0)
      sum += t
      const cur = byLoc.get(r.location_id) ?? { sum: 0, count: 0 }
      cur.sum += t
      cur.count += 1
      byLoc.set(r.location_id, cur)
    }
    const topLocations = Array.from(byLoc.entries())
      .map(([id, v]) => ({ location_id: id, location_name: locById.get(id) ?? null, total_sales: v.sum, days: v.count }))
      .sort((a, b) => b.total_sales - a.total_sales)
      .slice(0, 5)
    recentCloseoutsSummary = {
      count: rows.length,
      sum_total_sales: Number(sum.toFixed(2)),
      avg_total_sales: rows.length ? Number((sum / rows.length).toFixed(2)) : 0,
      top_locations: topLocations,
      sample: rows.slice(0, 10).map((r: DB) => ({
        date: r.date,
        location_name: locById.get(r.location_id) ?? null,
        total_sales: r.total_sales,
        cash_amount: r.cash_amount,
        card_amount: r.card_amount,
        sales_data: r.sales_data,
      })),
    }
  }

  let recentAiInsights: unknown[] = []
  try {
    const { data: insights, error } = await svc
      .from('ai_insights')
      .select('id, category, severity, insight_text, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(5)
    if (!error && insights) recentAiInsights = insights
  } catch {
    recentAiInsights = []
  }

  const { data: invoices } = await svc
    .from('ops_invoices')
    .select('vendor_name, amount, submitted_at')
    .eq('account_id', accountId)
    .gte('submitted_at', since90)
  const vendorMap = new Map<string, { count: number; sum: number }>()
  for (const inv of invoices ?? []) {
    const name = inv.vendor_name ?? 'Unknown'
    const cur = vendorMap.get(name) ?? { count: 0, sum: 0 }
    cur.count += 1
    cur.sum += Number(inv.amount ?? 0)
    vendorMap.set(name, cur)
  }
  const topVendors = Array.from(vendorMap.entries())
    .map(([vendor_name, v]) => ({ vendor_name, count: v.count, sum_amount: Number(v.sum.toFixed(2)) }))
    .sort((a, b) => b.sum_amount - a.sum_amount)
    .slice(0, 5)

  return {
    account_name: account?.name ?? null,
    location_count: locationCount,
    recent_closeouts_summary: recentCloseoutsSummary,
    recent_ai_insights: recentAiInsights,
    recent_invoices_summary: { top_vendors: topVendors, window_days: 90 },
  }
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
