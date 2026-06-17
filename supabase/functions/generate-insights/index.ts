// generate-insights — Supabase Edge Function (Deno).
// Pulls the last 30 days of an account's operational data, asks Claude to
// surface a few specific, actionable insights per category, and upserts them
// into ai_insights. Invoked by an authenticated owner/manager via the UI
// ("Refresh Insights") and by a nightly cron.
//
// Secrets required (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY   — Claude API key (function returns 503 'no_key' if absent)
// Auto-provided by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'
const CATEGORIES = ['ops', 'people', 'financial'] as const
type Category = (typeof CATEGORIES)[number]

// Restrict browser CORS to the known origins. JWT verification below is still
// the real auth gate; this just keeps the surface tighter and avoids returning
// an Access-Control-Allow-Origin echo for arbitrary attacker pages.
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

// Stable across every call — first in the prefix so it can be cached.
const SYSTEM_PROMPT = `You are an operations analyst for car wash businesses using TunnelSync.
You are given a JSON snapshot of one account's data for a single category over the last 30 days.
Return ONLY a JSON array of insight objects — no prose, no markdown fences. Schema:
[{"category": "ops"|"people"|"financial", "severity": "info"|"warning"|"critical", "text": "..."}]

Rules:
- 1 to 4 insights. Fewer is better than padding with filler.
- Each "text" must be specific and actionable, citing concrete numbers from the data.
- Use "critical" only for safety, large financial discrepancies, or repeated equipment failures.
- Use "warning" for trends worth attention; "info" for neutral observations.
- If the data shows nothing noteworthy, return an empty array [].
- Never invent data not present in the snapshot.`

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'no_key', message: 'ANTHROPIC_API_KEY is not configured.' }, 503, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Identify the caller from their JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
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
  if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }
  const accountId = profile.account_id

  // Rate limit: one full refresh per account per hour. Use the insert itself as
  // the gate — a unique index on (account_id, date_trunc('hour', created_at))
  // makes a duplicate insert fail with code 23505, closing the previous
  // check-then-insert race that let concurrent calls both pass and double-spend
  // on the Claude API.
  const { error: gateErr } = await svc.from('ai_insights_refresh_log').insert({ account_id: accountId })
  // deno-lint-ignore no-explicit-any
  if (gateErr && (gateErr as any).code === '23505') {
    return json({ error: 'rate_limited', message: 'Insights can refresh once per hour.' }, 429, origin)
  }
  if (gateErr) {
    return json({ error: 'internal', message: 'Could not acquire rate-limit slot.' }, 500, origin)
  }

  const { data: locs } = await svc
    .from('locations')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('archived', false)
  const locationIds = (locs ?? []).map((l) => l.id)
  if (locationIds.length === 0) return json({ generated: 0, insights: [] }, 200, origin)

  const anthropic = new Anthropic({ apiKey })
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()

  // Optional single-category mode; default to all three.
  let only: Category | null = null
  try {
    const body = await req.json()
    if (body?.category && CATEGORIES.includes(body.category)) only = body.category
  } catch {
    // no body — generate all categories
  }
  const categories = only ? [only] : CATEGORIES

  const generated: { category: string; severity: string; text: string }[] = []

  for (const category of categories) {
    const snapshot = await buildSnapshot(svc, category, locationIds, since)
    const insights = await callClaude(anthropic, category, snapshot)
    for (const ins of insights) {
      const { error } = await svc.from('ai_insights').insert({
        account_id: accountId,
        location_id: null,
        category: ins.category ?? category,
        severity: ins.severity ?? 'info',
        insight_text: ins.text,
      })
      if (!error) generated.push(ins)
    }
  }

  return json({ generated: generated.length, insights: generated }, 200, origin)
})

// deno-lint-ignore no-explicit-any
type DB = any

async function buildSnapshot(svc: DB, category: Category, locs: string[], since: string) {
  if (category === 'ops') {
    const [equip, wo, downtime, parts] = await Promise.all([
      svc.from('equipment').select('name, status').in('location_id', locs),
      svc.from('work_orders').select('title, status, priority, cost, created_at, closed_at').in('location_id', locs).gte('created_at', since),
      svc.from('downtime_events').select('reason, started_at, ended_at, equipment(name)').in('location_id', locs).gte('started_at', since),
      svc.from('parts_inventory').select('name, quantity_on_hand, reorder_threshold').in('location_id', locs),
    ])
    return {
      equipment: equip.data,
      work_orders: wo.data,
      downtime_events: downtime.data,
      low_stock_parts: (parts.data ?? []).filter((p: DB) => p.quantity_on_hand <= p.reorder_threshold),
    }
  }
  if (category === 'people') {
    const { data: emps } = await svc.from('employees').select('id, first_name, last_name, hourly_rate').in('location_id', locs)
    const ids = (emps ?? []).map((e: DB) => e.id)
    const [time, reviews, counseling] = await Promise.all([
      svc.from('time_entries').select('employee_id, clock_in, clock_out, auto_closed, edited_at').in('location_id', locs).gte('clock_in', since),
      ids.length ? svc.from('reviews').select('employee_id, review_date, status').in('employee_id', ids) : Promise.resolve({ data: [] }),
      ids.length ? svc.from('counseling_records').select('employee_id, type, date').in('employee_id', ids).gte('date', since.slice(0, 10)) : Promise.resolve({ data: [] }),
    ])
    return { employees: emps, time_entries: time.data, reviews: reviews.data, counseling_records: counseling.data }
  }
  // financial
  const { data: closeouts } = await svc
    .from('closeouts')
    .select('date, total_sales, cash_amount, card_amount, deposit_amount')
    .in('location_id', locs)
    .gte('date', since.slice(0, 10))
    .order('date')
  return { closeouts }
}

async function callClaude(
  anthropic: Anthropic,
  category: Category,
  snapshot: unknown,
): Promise<{ category?: string; severity?: string; text: string }[]> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    // System prompt is identical across all three category calls — caching the
    // prefix saves cost on the 2nd and 3rd calls of each refresh.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Category: ${category}\nData (last 30 days):\n${JSON.stringify(snapshot)}`,
      },
    ],
  })

  const block = message.content.find((b) => b.type === 'text')
  const raw = block && 'text' in block ? block.text : '[]'
  return parseInsights(raw)
}

function parseInsights(raw: string): { category?: string; severity?: string; text: string }[] {
  // Strip markdown fences if the model added them despite instructions.
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
