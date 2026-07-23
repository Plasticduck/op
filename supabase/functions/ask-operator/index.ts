// ask-operator — Supabase Edge Function (Deno).
// A read-only data assistant: the user asks a plain-English question about their
// Operator data, and Claude answers using two tools:
//   run_sql              — SELECT against Postgres via operator_ask_sql (SECURITY
//                          INVOKER, so row-level security scopes every result to
//                          the caller's account + locations).
//   get_site_performance — the live Mighty Wash dashboard feed (cars, cars/hour,
//                          labor %, conversion, recharge revenue, churn), pulled
//                          through the site-performance function and scoped to the
//                          sites the caller can see. Only offered to owner/manager
//                          on accounts with site performance enabled.
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
weather_days(id, account_id, location_id, date, weather_code, conditions, temp_max, temp_min, precip_in): archived daily weather per site. conditions is a label (Clear, Partly cloudy, Overcast, Fog, Drizzle, Rain, Snow, Showers, Snow showers, Storm). temp in fahrenheit, precip_in in inches. Use this to explain a day's results (rain/snow suppress car counts).
site_performance_days(id, account_id, site, site_number, date, cars, hours, cars_per_hour, sales, labor_cost, labor_pct, recharge): archived DAILY per-site performance. This is the historical store behind Site Performance and covers ALL sites including the FlexWash sites (17, 18). site_number ties to a site (e.g. 17 = Mighty Wash #17); sales and recharge are dollars. Use this for historical car counts, sales, recharge, cars per hour, and labor % by date range. FlexWash sites have cars/sales/recharge but no hours/labor. This is separate from the live get_site_performance tool (which is today/recent only).
notes: joins are by the *_id columns. Use locations.name to label sites; join via location_id. Employee names are first_name + last_name. work_orders.status values include 'open','in_progress','on_hold','done'. Dates are timestamptz unless typed date.`

const SYSTEM = `You are the data assistant inside Operator (a.k.a. WashLyfe), operations software for car wash companies. You answer questions about the user's own business data.

You have two tools:

1. run_sql — executes a single read-only SELECT and returns rows as JSON. Row-level security automatically restricts every query to the current user's account and the locations they can see, so:
   - NEVER add account_id filters or ownership checks yourself; just query the tables.
   - If a query returns [] it means there is no data the user can see, not that none exists.
   Rules for SQL:
   - One statement, SELECT (or WITH ... SELECT) only. No writes. No semicolons except an optional trailing one.
   - Alias every output column to a unique, human-readable name (the result is wrapped, so duplicate names error).
   - Join to locations for site names; build employee names as first_name || ' ' || last_name. Aggregate and limit sensibly.
   - If a query errors, read the error and try a corrected query.

2. get_site_performance — the LIVE operations feed from the Mighty Wash dashboard. This is the ONLY source for these metrics (they are NOT in the SQL database):
   - Car counts (cars washed) per day and per site
   - cars_per_hour (cars per labor hour — "cars per manpower")
   - labor_pct (labor cost as a percent of sales) and labor hours
   - conversion_pct (membership conversion) — today and month-to-date
   - recharge revenue (member recharge dollars) — month-to-date and daily
   - churn (voluntary_churn_pct, cc_churn_pct) per site
   Call it with no arguments to get a month-to-date/rolling summary for every site the user can see (window_totals covers roughly the last 30 days). Pass {"site": "<name or number>"} to get that one site's day-by-day detail (cars, hours, cars_per_hour, sales, labor_pct, recharge). Optionally pass {"days": N}.

Choosing a tool:
- Use get_site_performance for anything about cars washed, car counts, cars per hour/manpower, labor %, membership conversion, recharge revenue, or churn (today / recent daily detail).
- Use query_dashboard to compare ONE tracked metric across ALL sites totaled over a specific date range (e.g. "cars washed per site last month", "plans sold - Mighty by site this quarter", "revenue by site 6/1 to 6/30"). It returns one row per site. Pick the closest metric key.
- Use run_sql for everything else (work orders, equipment, inventory, checklists, staff, invoices, audits, violations, tips, bonuses, weather, etc.).
- Combine both when a question spans them.

Diagnosing WHY a day or period was low (or high): do not stop at a single factor. When asked why car counts (or sales) were low on a date at a site, first get that site's numbers from get_site_performance, then investigate the likely operational drivers with run_sql and report the ones that actually stand out, citing specifics:
  - Weather: weather_days for that location and date (heavy rain, snow, or storms suppress volume; note precip_in and conditions).
  - Equipment down: equipment at that site whose status is out of service / down, especially high criticality (a down wash line or tunnel cuts throughput).
  - Downtime: downtime_events at that location whose started_at..ended_at overlaps the date, and for how long.
  - Open work: active work_orders at the site around that date (status not 'done'), especially high priority or tied to equipment (equipment_id).
  Match a site to its location_id via the site name/number in locations.name. Then explain the drivers together (e.g. "it rained 1.2 inches and 2 bays were down ~4 hours"). If nothing notable turns up, say the data shows no obvious operational or weather cause.

Answering:
- Give a concise, direct answer in plain language. Use short markdown tables or bullet lists when helpful.
- Cite concrete numbers. Never invent data. If the data cannot answer the question, say so and suggest what is available.
- Keep it brief and business-focused. Do not describe your SQL or tools unless asked.

Schema for run_sql:
${SCHEMA}`

const RUN_SQL_TOOL: Anthropic.Tool = {
  name: 'run_sql',
  description:
    "Run a single read-only Postgres SELECT against the user's data and return rows as JSON (max 1000 rows). Results are already scoped to the user by row-level security.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A single SELECT or WITH...SELECT statement.' },
    },
    required: ['query'],
  },
}

const PERF_TOOL: Anthropic.Tool = {
  name: 'get_site_performance',
  description:
    'Get live Mighty Wash site performance metrics (car counts, cars_per_hour, labor_pct, conversion, recharge revenue, churn). No arguments = summary for all visible sites. Pass "site" (name or number) for one site\'s daily detail. Optional "days" (default 30).',
  input_schema: {
    type: 'object',
    properties: {
      site: { type: 'string', description: 'Optional site name or number to drill into.' },
      days: { type: 'number', description: 'Optional trailing-day window (1-31, default 30).' },
    },
  },
}

const DASHBOARD_METRICS = [
  'cars', 'revenue', 'recharge', 'conversion_pct',
  'plans_mighty', 'plans_super', 'plans_wonder', 'plans_mvp', 'plans_total',
  'hustles', 'intro_mvp_sales', 'mighty_mvp_sales', 'extras',
  'churn_voluntary', 'churn_cc',
]

const QUERY_DASHBOARD_TOOL: Anthropic.Tool = {
  name: 'query_dashboard',
  description:
    "Run the Mighty Wash dashboard's guided query: get one tracked business metric for EVERY site, totaled over a date range. Returns { columns, rows } with one row per site. Use this for cross-site comparisons of a metric over a period (e.g. cars washed per site last month, conversion % by site, plans sold by tier). Metric keys: cars (cars washed), revenue (gross sales $), recharge (recharge $), conversion_pct, plans_mighty/plans_super/plans_wonder/plans_mvp/plans_total (plans sold by tier), hustles (detail upsells), intro_mvp_sales, mighty_mvp_sales, extras (details $), churn_voluntary, churn_cc (last-month churn %). For daily detail or one site, prefer get_site_performance or site_performance_days instead.",
  input_schema: {
    type: 'object',
    properties: {
      metric: { type: 'string', description: `One metric key: ${DASHBOARD_METRICS.join(', ')}.` },
      start: { type: 'string', description: 'Start date YYYY-MM-DD.' },
      end: { type: 'string', description: 'End date YYYY-MM-DD.' },
    },
    required: ['metric', 'start', 'end'],
  },
}

type Step = { sql?: string; tool?: string; rowCount?: number; error?: string }

// First run of digits in a site name: "MightyWash 001" -> 1, "Mighty Wash #24" -> 24.
function siteNum(name: unknown): number | null {
  const m = String(name ?? '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}
function findByNum<T>(rec: Record<string, T> | null | undefined, n: number | null): T | undefined {
  if (!rec || n == null) return undefined
  for (const [k, v] of Object.entries(rec)) if (siteNum(k) === n) return v
  return undefined
}
function round(x: unknown, d = 0): number | null {
  const v = typeof x === 'number' ? x : Number(x)
  return Number.isFinite(v) ? Number(v.toFixed(d)) : null
}

// deno-lint-ignore no-explicit-any
function buildPerf(feed: any, allowed: Set<number> | null, siteFilter: string | null, days: number) {
  const report = feed?.report?.sites ?? {}
  const msaRows = (feed?.msa?.rows ?? []) as any[] // deno-lint-ignore-line no-explicit-any
  const rechargeSites = feed?.recharge_revenue?.sites ?? {}
  const rechargeMtd = feed?.recharge_revenue?.mtd_by_site ?? {}
  const churnSites = feed?.churn?.sites ?? {}

  // Union of site numbers -> a display name.
  const byNum = new Map<number, string>()
  for (const name of Object.keys(report)) {
    const n = siteNum(name)
    if (n != null && !byNum.has(n)) byNum.set(n, name)
  }
  for (const r of msaRows) {
    const n = siteNum(r.site)
    if (n != null && !byNum.has(n)) byNum.set(n, r.site)
  }

  const filterNum = siteFilter != null && /\d/.test(siteFilter) ? siteNum(siteFilter) : null
  const filterText = siteFilter != null && filterNum == null ? siteFilter.toLowerCase() : null

  const drill = siteFilter != null
  const out: unknown[] = []
  for (const [n, name] of byNum) {
    if (allowed && !allowed.has(n)) continue
    if (filterNum != null && n !== filterNum) continue
    if (filterText != null && !String(name).toLowerCase().includes(filterText)) continue

    const seriesAll = (findByNum<any[]>(report, n) ?? []) as any[] // deno-lint-ignore-line no-explicit-any
    const series = seriesAll.slice(-days)
    const msa = msaRows.find((r) => siteNum(r.site) === n)
    const churn = findByNum<any>(churnSites, n) // deno-lint-ignore-line no-explicit-any
    const totals = series.reduce(
      (a: any, d: any) => ({ // deno-lint-ignore-line no-explicit-any
        cars: a.cars + (Number(d.cars) || 0),
        sales: a.sales + (Number(d.sales) || 0),
        hours: a.hours + (Number(d.hours) || 0),
        labor_cost: a.labor_cost + (Number(d.labor_cost) || 0),
      }),
      { cars: 0, sales: 0, hours: 0, labor_cost: 0 },
    )
    const latest = series.length ? series[series.length - 1] : null

    const entry: Record<string, unknown> = {
      site: name,
      number: n,
      window_days: series.length,
      latest: latest && {
        date: latest.date,
        cars: latest.cars,
        sales: round(latest.sales),
        cars_per_hour: latest.cars_per_hour,
        labor_pct: latest.labor_pct,
        hours: latest.hours,
      },
      window_totals: {
        cars: totals.cars,
        sales: round(totals.sales),
        hours: round(totals.hours, 1),
        cars_per_hour: totals.hours ? round(totals.cars / totals.hours, 2) : null,
        labor_pct: totals.sales ? round((100 * totals.labor_cost) / totals.sales, 1) : null,
      },
      mtd: msa && {
        conversion_pct: msa.mtd_conversion_pct,
        eligible_washes: msa.mtd_eligible_washes,
        sales: round(msa.mtd_sales),
        days_worked: msa.mtd_days_worked ?? null,
      },
      today: msa && {
        conversion_pct: msa.today_conversion_pct,
        eligible_washes: msa.today_eligible_washes,
        sales: round(msa.today_sales),
        hours_worked: msa.today_hours_worked ?? null,
      },
      recharge_mtd: round(findByNum<number>(rechargeMtd, n)),
      churn: churn && {
        voluntary_churn_pct: churn.voluntary_churn_pct,
        cc_churn_pct: churn.cc_churn_pct,
      },
    }
    if (drill) {
      entry.days = series.map((d: any) => ({ // deno-lint-ignore-line no-explicit-any
        date: d.date,
        cars: d.cars,
        hours: d.hours,
        cars_per_hour: d.cars_per_hour,
        sales: round(d.sales),
        labor_pct: d.labor_pct,
      }))
      const rc = (findByNum<any[]>(rechargeSites, n) ?? []) as any[] // deno-lint-ignore-line no-explicit-any
      entry.recharge_days = rc.slice(-days).map((d: any) => ({ date: d.date, amount: round(d.amount) })) // deno-lint-ignore-line no-explicit-any
    }
    out.push(entry)
  }
  return out
}

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
  const authHeader = req.headers.get('Authorization') ?? ''

  // The user client carries the caller's JWT so the RPC (and site-performance
  // proxy) run under their identity and RLS.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData } = await userClient.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await svc
    .from('users')
    .select('account_id, role, location_ids')
    .eq('id', uid)
    .single()
  if (!profile) return json({ error: 'no_profile' }, 400, origin)

  // Site performance is a Mighty-Wash-only, owner/manager feature. Offer that
  // tool only when it applies, and scope a manager's view to their own sites.
  const { data: acct } = await svc
    .from('accounts')
    .select('site_performance_enabled')
    .eq('id', profile.account_id)
    .single()
  const isManagerPlus = profile.role === 'owner' || profile.role === 'manager'
  const perfAvailable = !!acct?.site_performance_enabled && isManagerPlus

  let allowedNumbers: Set<number> | null = null // null = all sites (owner)
  if (perfAvailable && profile.role === 'manager') {
    const ids = (profile.location_ids ?? []) as string[]
    const { data: locs } = await svc
      .from('locations')
      .select('name')
      .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    allowedNumbers = new Set(
      (locs ?? []).map((l) => siteNum(l.name)).filter((n): n is number => n != null),
    )
  }

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
  const tools = perfAvailable
    ? [RUN_SQL_TOOL, PERF_TOOL, QUERY_DASHBOARD_TOOL]
    : [RUN_SQL_TOOL]

  const messages: Anthropic.MessageParam[] = []
  for (const h of (body.history ?? []).slice(-8)) {
    if (h?.content && (h.role === 'user' || h.role === 'assistant')) {
      messages.push({ role: h.role, content: h.content })
    }
  }
  messages.push({ role: 'user', content: question })

  const steps: Step[] = []
  // deno-lint-ignore no-explicit-any
  let feedCache: any = undefined // fetch the site-performance feed at most once per request

  const perfNote = perfAvailable
    ? 'The get_site_performance and query_dashboard tools ARE available for this user.'
    : 'The get_site_performance tool is NOT available (site performance is not enabled for this account, or the user is not a manager). If asked about car counts, recharge, conversion, or churn, tell them live site-performance data is not enabled for their account.'

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: [
          { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `Today is ${today}. Answer for this user's data only. ${perfNote}` },
        ],
        tools,
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

      messages.push({ role: 'assistant', content: resp.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue

        if (block.name === 'run_sql') {
          const query = String((block.input as { query?: string })?.query ?? '')
          const step: Step = { tool: 'run_sql', sql: query }
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
          continue
        }

        if (block.name === 'get_site_performance' && perfAvailable) {
          const input = (block.input ?? {}) as { site?: string; days?: number }
          const days = Math.max(1, Math.min(31, Math.round(input.days ?? 30)))
          const step: Step = { tool: 'get_site_performance' }
          let content: string
          try {
            if (feedCache === undefined) {
              const { data, error } = await userClient.functions.invoke('site-performance', {
                body: {},
              })
              if (error || (data && (data as { error?: string }).error)) {
                throw new Error(
                  (data as { message?: string })?.message ?? 'Could not load site performance.',
                )
              }
              feedCache = data
            }
            const site = input.site != null ? String(input.site) : null
            const summary = buildPerf(feedCache, allowedNumbers, site, days)
            step.rowCount = summary.length
            let text = JSON.stringify({ as_of: feedCache?.fetched_at, sites: summary })
            if (text.length > 18000) text = text.slice(0, 18000) + '…(truncated)'
            content = text
          } catch (e) {
            step.error = e instanceof Error ? e.message : String(e)
            content = `ERROR: ${step.error}`
          }
          steps.push(step)
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content })
          continue
        }

        if (block.name === 'query_dashboard' && perfAvailable) {
          const input = (block.input ?? {}) as { metric?: string; start?: string; end?: string }
          const step: Step = { tool: 'query_dashboard' }
          let content: string
          try {
            const { data, error } = await userClient.functions.invoke('site-performance', {
              body: {
                api: {
                  path: '/api/guided_query',
                  method: 'POST',
                  body: { metric: input.metric, sites: [], start: input.start, end: input.end },
                },
              },
            })
            if (error) throw new Error('Dashboard query failed.')
            const res = (data as { data?: { columns?: string[]; rows?: unknown[]; error?: string } })?.data
            if (res?.error) throw new Error(res.error)
            step.rowCount = res?.rows?.length ?? 0
            let text = JSON.stringify(res ?? {})
            if (text.length > 18000) text = text.slice(0, 18000) + '…(truncated)'
            content = text
          } catch (e) {
            step.error = e instanceof Error ? e.message : String(e)
            content = `ERROR: ${step.error}`
          }
          steps.push(step)
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content })
          continue
        }

        // Unknown / unavailable tool.
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'ERROR: that tool is not available.',
          is_error: true,
        })
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
