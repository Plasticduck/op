// suggest-schedule — Supabase Edge Function (Deno).
// AI-assisted weekly schedule. Loads the location's active employees + their
// recent shift history, asks Claude for a draft schedule, and returns the
// suggestions. Does NOT mutate the schedule — the UI previews and lets the
// manager apply.
//
// Secrets: ANTHROPIC_API_KEY (returns 503 no_key if absent).
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'
const CONTEXT_WEEKS = 4

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

// Stable system prompt — first in the prefix so it can be ephemeral-cached.
const SYSTEM_PROMPT = `You build draft weekly shift schedules for car wash teams.

You receive a JSON snapshot for one location: the active employees (id, name, role, hourly_rate, recent_avg_hours, typical_shifts_by_weekday), and the week's Monday date. Days run Monday=0 .. Sunday=6. Times are 24-hour "HH:mm".

Return ONLY a JSON object with this exact shape — no markdown, no prose, no fences:
{"shifts":[{"employee_id":"<uuid>","day_index":0,"start_time":"HH:mm","end_time":"HH:mm","role_label":"<short string or null>","rationale":"<one short line>"}]}

Rules:
- Use ONLY employee_ids that appear in the input.
- Mirror the team's history: start/end times and which weekdays each employee tends to work.
- Aim for ~40 hours/week per full-timer; for part-timers use their recent_avg_hours as the target.
- No overlapping shifts for the same employee on the same day.
- Skip employees with no recent history rather than guess.
- "rationale" is one short sentence (why this employee on this day).
- If signal is too thin to produce a useful draft, return {"shifts":[]}.
- Never invent ids, times outside 00:00–23:59, or end_time before start_time.`

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'no_key', message: 'ANTHROPIC_API_KEY is not configured.' }, 503)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Identify caller from their JWT and verify they're a manager/owner.
  const auth = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const uid = u.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await svc.from('users').select('account_id, role').eq('id', uid).single()
  if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) return json({ error: 'forbidden' }, 403)

  let body: { location_id?: string; week_start?: string } = {}
  try { body = await req.json() } catch { /* allow empty */ }
  const locationId = body.location_id
  const weekStart = body.week_start
  if (!locationId || !weekStart) return json({ error: 'bad_request', message: 'location_id and week_start are required' }, 400)

  const { data: loc } = await svc.from('locations').select('id, name, account_id').eq('id', locationId).single()
  if (!loc || loc.account_id !== profile.account_id) return json({ error: 'forbidden' }, 403)

  const { data: emps } = await svc
    .from('employees')
    .select('id, first_name, last_name, role_title, hourly_rate')
    .eq('location_id', locationId)
    .eq('status', 'active')
  if (!emps || emps.length === 0) {
    return json({ suggestions: [], employees: [], model: MODEL, week_start: weekStart })
  }

  // Pull the last CONTEXT_WEEKS weeks of shifts for this location to build a
  // history snapshot Claude can mimic.
  const startD = new Date(weekStart + 'T00:00:00Z')
  const sinceD = new Date(startD.getTime() - CONTEXT_WEEKS * 7 * 86400_000)
  const since = sinceD.toISOString().slice(0, 10)
  const { data: scheds } = await svc
    .from('schedules')
    .select('id, week_start_date')
    .eq('location_id', locationId)
    .gte('week_start_date', since)
  const schedIds = (scheds ?? []).map((s) => s.id)
  // deno-lint-ignore no-explicit-any
  const shifts: any[] = schedIds.length
    ? ((await svc
        .from('shifts')
        .select('schedule_id, employee_id, date, start_time, end_time, role_label')
        .in('schedule_id', schedIds)).data ?? [])
    : []

  // Aggregate per-employee history.
  type EmpAgg = {
    id: string
    name: string
    role_title: string | null
    hourly_rate: number | null
    recent_avg_hours: number
    typical_shifts_by_weekday: Record<string, { start: string; end: string; count: number }>
  }
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const byEmp: Record<string, EmpAgg> = {}
  for (const e of emps) {
    byEmp[e.id] = {
      id: e.id,
      name: `${e.first_name} ${e.last_name}`,
      role_title: e.role_title,
      hourly_rate: e.hourly_rate,
      recent_avg_hours: 0,
      typical_shifts_by_weekday: {},
    }
  }
  const empWeekHours: Record<string, { hours: number; weeks: Set<string> }> = {}
  for (const s of shifts) {
    if (!byEmp[s.employee_id]) continue
    const dt = new Date(s.date + 'T00:00:00Z')
    const wd = dayName[dt.getUTCDay()]
    const [sh, sm] = String(s.start_time).split(':').map(Number)
    const [eh, em] = String(s.end_time).split(':').map(Number)
    const hours = Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60)
    const t = byEmp[s.employee_id].typical_shifts_by_weekday
    if (!t[wd]) t[wd] = { start: String(s.start_time).slice(0, 5), end: String(s.end_time).slice(0, 5), count: 0 }
    t[wd].count += 1
    empWeekHours[s.employee_id] ??= { hours: 0, weeks: new Set() }
    empWeekHours[s.employee_id].hours += hours
    const w = scheds?.find((x) => x.id === s.schedule_id)?.week_start_date
    if (w) empWeekHours[s.employee_id].weeks.add(w)
  }
  for (const id of Object.keys(byEmp)) {
    const t = empWeekHours[id]
    byEmp[id].recent_avg_hours = t && t.weeks.size > 0 ? Math.round(t.hours / t.weeks.size) : 0
  }

  const snapshot = {
    location: loc.name,
    week_start_monday: weekStart,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    employees: Object.values(byEmp),
    history_window_weeks: CONTEXT_WEEKS,
  }

  const anthropic = new Anthropic({ apiKey })
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      { role: 'user', content: 'Build a draft week of shifts for this location. Snapshot:\n\n' + JSON.stringify(snapshot) },
    ],
  })

  const raw = msg.content
    // deno-lint-ignore no-explicit-any
    .filter((b: any) => b.type === 'text')
    // deno-lint-ignore no-explicit-any
    .map((b: any) => b.text)
    .join('\n')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
  // deno-lint-ignore no-explicit-any
  let parsed: any = {}
  try { parsed = JSON.parse(raw) } catch { parsed = {} }

  const validIds = new Set(emps.map((e) => e.id))
  const HH = /^\d{2}:\d{2}$/
  // deno-lint-ignore no-explicit-any
  const safe = (Array.isArray(parsed?.shifts) ? parsed.shifts : []).filter((s: any) =>
    s &&
    typeof s.employee_id === 'string' && validIds.has(s.employee_id) &&
    Number.isInteger(s.day_index) && s.day_index >= 0 && s.day_index <= 6 &&
    typeof s.start_time === 'string' && HH.test(s.start_time) &&
    typeof s.end_time === 'string' && HH.test(s.end_time) &&
    s.start_time < s.end_time,
  )

  return json({
    suggestions: safe,
    employees: emps.map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` })),
    model: MODEL,
    week_start: weekStart,
  })
})
