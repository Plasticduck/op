// verify-checklist-photo — Supabase Edge Function (Deno).
// Compares a checklist photo submission against the per-site baseline photo for
// that task using Claude vision, then writes the verdict back onto the
// submission row. Best effort: a missing key or baseline degrades gracefully.
//
// Required secret: ANTHROPIC_API_KEY. Optional: ANTHROPIC_MODEL.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

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
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// Split a data URI into a Claude image source. Falls back to jpeg.
function parseDataUri(uri: string): { media_type: string; data: string } | null {
  const m = uri.match(/^data:([^;]+);base64,(.*)$/s)
  if (!m) return null
  return { media_type: m[1] || 'image/jpeg', data: m[2] }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401)

  let body: { submission_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const submissionId = body.submission_id
  if (!submissionId) return json({ error: 'bad_request' }, 400)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: sub } = await svc
    .from('checklist_submissions')
    .select('id, item_id, location_id, data_uri')
    .eq('id', submissionId)
    .maybeSingle()
  if (!sub) return json({ error: 'not_found' }, 404)

  // Caller must belong to the account that owns this task.
  const { data: caller } = await svc.from('users').select('account_id').eq('id', u.user.id).maybeSingle()
  const { data: loc } = await svc.from('locations').select('account_id').eq('id', sub.location_id).maybeSingle()
  if (!caller || !loc || caller.account_id !== loc.account_id) return json({ error: 'forbidden' }, 403)

  const finish = async (status: string, notes: string) => {
    await svc
      .from('checklist_submissions')
      .update({ ai_status: status, ai_notes: notes, ai_model: MODEL })
      .eq('id', sub.id)
    return json({ ai_status: status, ai_notes: notes })
  }

  if (!apiKey) return finish('unclear', 'AI verification is not configured yet.')

  const { data: baseline } = await svc
    .from('checklist_item_baselines')
    .select('data_uri')
    .eq('item_id', sub.item_id)
    .eq('location_id', sub.location_id)
    .maybeSingle()
  if (!baseline?.data_uri) {
    return finish('unclear', 'No baseline photo has been set for this task at this site yet.')
  }

  const { data: item } = await svc
    .from('checklist_items')
    .select('label')
    .eq('id', sub.item_id)
    .maybeSingle()
  const task = item?.label ?? 'the task'

  const baseImg = parseDataUri(baseline.data_uri)
  const subImg = parseDataUri(sub.data_uri)
  if (!baseImg || !subImg) return finish('error', 'Could not read one of the images.')

  const prompt =
    `You verify a car wash cleaning/maintenance task from photos.\n` +
    `Task: "${task}".\n\n` +
    `Image 1 is the APPROVED BASELINE (the task done correctly at this site).\n` +
    `Image 2 is the EMPLOYEE SUBMISSION.\n\n` +
    `Judge whether the submission shows the task completed to the same standard as the baseline. ` +
    `List specific discrepancies visible in the submission versus the baseline (missing, not done, dirty, out of place). ` +
    `Respond ONLY with strict JSON, no prose, no code fences: ` +
    `{"verdict":"pass"|"discrepancy"|"unclear","summary":"one short sentence","discrepancies":["..."]}. ` +
    `Use "unclear" only if the submission is too dark, blurry, or does not show the relevant area.`

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'text', text: 'Image 1 (baseline):' },
              { type: 'image', source: { type: 'base64', media_type: baseImg.media_type, data: baseImg.data } },
              { type: 'text', text: 'Image 2 (submission):' },
              { type: 'image', source: { type: 'base64', media_type: subImg.media_type, data: subImg.data } },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    return finish('error', e instanceof Error ? e.message : 'AI request failed')
  }
  if (!res.ok) {
    return finish('error', `AI request failed (${res.status}).`)
  }

  const payload = await res.json()
  const text: string = (payload?.content ?? [])
    .filter((c: { type?: string }) => c.type === 'text')
    .map((c: { text?: string }) => c.text ?? '')
    .join('\n')
    .trim()

  let parsed: { verdict?: string; summary?: string; discrepancies?: string[] } = {}
  try {
    const jsonStr = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(jsonStr)
  } catch {
    return finish('unclear', text.slice(0, 500) || 'Could not interpret the AI response.')
  }

  const verdict =
    parsed.verdict === 'pass' || parsed.verdict === 'discrepancy' || parsed.verdict === 'unclear'
      ? parsed.verdict
      : 'unclear'
  const discrepancies = Array.isArray(parsed.discrepancies) ? parsed.discrepancies : []
  const notes = [parsed.summary, ...discrepancies.map((d) => `• ${d}`)]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000)

  return finish(verdict, notes || 'No notes returned.')
})
