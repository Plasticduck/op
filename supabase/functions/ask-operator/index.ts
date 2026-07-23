// ask-operator — Supabase Edge Function (Deno).
// A read-only data assistant: the user asks a plain-English question about their
// Operator data, Claude writes SELECT queries against the Postgres schema, we run
// them via the operator_ask_sql RPC (SECURITY INVOKER, so row-level security
// scopes every result to the caller's account + locations), and Claude turns the
// rows into an answer. The client never sees SQL unless it asks; the model can
// never reach another tenant's data because it runs under the user's own RLS.
//
// Secrets required (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY   — Claude API key (function returns 503 'no_key' if absent)
// Auto-provided by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'
const MAX_STEPS = 6 // safety cap on tool-use rounds per question

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

// Compact schema of the tables the assistant may query. Every table is scoped by
// row-level security to the caller's account and locations, so the model must not
// filter by account_id/location ownership itself. Stable text -> cached prefix.
const SCHEMA = `Tables (Postgres, snake_case). Money columns are numeric dollars unless noted.
accounts(id, name, account_type, plan, is_demo, gm_bonus_enabled, site_performance_enabled)
locations(id, account_id, name, address, timezone, archived, latitude, longitude, google_rating, google_rating_count)
users(id, account_id, location_ids uuid[], role, name, email, last_seen_at)
employees(id, location_id, first_name, last_name, email, phone, start_date, role_title, hourly_rate, status)
work_orders(id, account_id, location_id, number, title, status, priority, work_type, due_at, start_at, completed_at, equipment_id, created_at)
work_order_time_entries(work_order_id, user_name, minutes, hourly_rate, created_at)
work_order_parts(work_order_id, part_name, quantity, unit_cost)
work_order_other_costs(work_order_id, description, amount)
equipment(id, location_id, name, type, status, criticality, last_serviced_at, service_interval_days, manufacturer, model)
downtime_events(id, location_id, equipment_id, reason, reason_category, started_at, ended_at)
parts(id, account_id, part_number, name, sku, unit_cost, manufacturer, vendor_id)
parts_inventory(id, location_id, name, sku, quantity_on_hand, reorder_threshold, minimum_in_stock, unit_cost, vendor)
inventory_items(id, account_id, category, brand, item, division, value)
inventory_counts(id, account_id, location_id, category, brand, item, quantity, division, created_at)
checklists(id, location_id, account_id, name, frequency, days_of_week text[], roles text[], archived)
checklist_instances(id, checklist_id, location_id, instance_date, status, opens_at, closes_at)
checklist_completions(id, checklist_id, location_id, completed_by, completed_at)
closeouts(id, location_id, date, total_sales, cash_amount, card_amount, deposit_amount, notes)
time_entries(id, location_id, employee_id, clock_in, clock_out, auto_closed, notes)
time_off_requests(id, location_id, employee_id, start_date, end_date, reason, status)
reviews(id, employee_id, reviewed_by, review_date, due_date, rating, status)
counseling_records(id, employee_id, date, type, category, description, follow_up_date)
injury_reports(id, employee_id, location_id, incident_date, description, body_part_affected, osha_recordable, severity, days_lost)
site_audits(id, account_id, location_id, submitted_by_name, created_at)
site_violations(id, account_id, location_id, violation_type, severity, description, status, due_date, department, created_at)
ops_invoices(id, account_id, location_id, vendor_name, invoice_date, amount, gl_code, status, assigned_to_name)
capital_requests(id, account_id, location_id, title, category, estimated_cost, priority, status, requested_by_name, created_at)
tips(id, account_id, location_id, amount_cents int, status, tipped_at)
vendors(id, account_id, name, kind, email, phone)
contacts(id, location_id, name, company, phone, email, category)
gm_bonus_months(id, account_id, location_id, period date, mighty_count, super_count, wonder_count, avg_mos, churn_pct, conversion_pct, gm_override, agm_override)
ai_insights(id, account_id, location_id, category, insight_text, severity, generated_at, acknowledged, archived)
supplies_requests(id, location_id, requested_by, item, quantity, status, created_at)
uniform_requests(id, employee_id, item, size, quantity, status, requested_at)
social_posts(id, account_id, post_date, platform, status, title, ai_generated)
calendar_events(id, location_id, title, start_at, end_at, all_day)
documents(id, location_id, name, category, archived, created_at)
notes: joins are by the *_id columns. Use locations.name to label sites; join via location_id. Employee names are first_name + last_name. work_orders.status values include 'open','in_progress','on_hold','done'. Dates are timestamptz unless typed date.`

const SYSTEM = `You are the data assistant inside Operator (a.k.a. WashLyfe), operations software for car wash companies. You answer questions about the user's own business data by querying a read-only Postgres database.

You have one tool, run_sql, which executes a single read-only SELECT and returns rows as JSON. Row-level security automatically restricts every query to the current user's account and the locations they are allowed to see, so:
- NEVER add account_id filters or ownership checks yourself; just query the tables.
- If a query returns [] it means there is no data the user can see, not necessarily that none exists.

Rules for writing SQL:
- One statement, SELECT (or WITH ... SELECT) only. No semicolons except an optional trailing one. No writes.
- Alias every output column to a unique, human-readable name (the result is wrapped, so duplicate column names error).
- Prefer readable labels: join to locations for site names, build employee names as first_name || ' ' || last_name.
- Aggregate and limit sensibly. Do not select huge raw tables; summarize.
- For "this week/month/last month" use the provided current date and Postgres date functions.
- If a query errors, read the error and try a corrected query (up to a few attempts).

Answering:
- After you have the data, give a concise, direct answer in plain language. Use short markdown tables or bullet lists when it helps.
- Cite the concrete numbers you found. Never invent data. If the data cannot answer the question, say so plainly and suggest what is available.
- Keep it business-focused and brief. Do not describe your SQL unless asked.

Schema:
${SCHEMA}`

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'run_sql',
    description:
      'Run a single read-only Postgres SELECT against the user\'s data and return rows as JSON (max 1000 rows). Results are already scoped to the user by row-level security.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A single SELECT or WITH...SELECT statement.' },
      },
      required: ['query'],
    },
  },
]

type Step = { sql: string; rowCount?: number; error?: string }

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'no_key', message: 'ANTHROPIC_API_KEY is not configured.' }, 503, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // The user client carries the caller's JWT so the RPC runs under their RLS.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData } = await userClient.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401, origin)

  let body: { question?: string; history?: { role: 'user' | 'assistant'; content: string }[] } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const question = (body.question ?? '').trim()
  if (!question) return json({ error: 'bad_request', message: 'Ask a question.' }, 400, origin)

  const today = new Date().toISOString().slice(0, 10)
  const anthropic = new Anthropic({ apiKey })

  // Rebuild the conversation from prior plain-text turns for context, then add
  // the new question. Tool exchanges live only within this request.
  const messages: Anthropic.MessageParam[] = []
  for (const h of (body.history ?? []).slice(-8)) {
    if (h?.content && (h.role === 'user' || h.role === 'assistant')) {
      messages.push({ role: h.role, content: h.content })
    }
  }
  messages.push({ role: 'user', content: question })

  const steps: Step[] = []

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: [
          { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `Today is ${today}. Answer for this user's data only.` },
        ],
        tools: TOOLS,
        messages,
      })

      if (resp.stop_reason !== 'tool_use') {
        const answer = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        return json({ answer: answer || 'I could not find an answer.', steps }, 200, origin)
      }

      // Execute each requested query and feed results back to the model.
      messages.push({ role: 'assistant', content: resp.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of resp.content) {
        if (block.type !== 'tool_use' || block.name !== 'run_sql') continue
        const query = String((block.input as { query?: string })?.query ?? '')
        const step: Step = { sql: query }
        let content: string
        const { data, error } = await userClient.rpc('operator_ask_sql', { query })
        if (error) {
          step.error = error.message
          content = `ERROR: ${error.message}`
        } else {
          const rows = (data ?? []) as unknown[]
          step.rowCount = rows.length
          let text = JSON.stringify(rows)
          if (text.length > 16000) text = text.slice(0, 16000) + '…(truncated)'
          content = text
        }
        steps.push(step)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content })
      }
      messages.push({ role: 'user', content: toolResults })
    }

    return json(
      { answer: 'That took too many steps to work out. Try narrowing the question.', steps },
      200,
      origin,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return json({ error: 'internal', message, steps }, 500, origin)
  }
})
